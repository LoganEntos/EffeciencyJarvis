/*
 * Run engine: process lifecycle for a spawned run — SSE event formatting,
 * meta persistence, the claude-CLI child process (spawn/stdout/exit), and the
 * queue drain. Split out of runs.js (F1: keep every file under the hard
 * 500-line rule). createEngine() binds the shared state (active Map, queue
 * array, exe paths) so both modules see the same runs; startRun/cancelRun/
 * streamRun stay in runs.js since they own request/route handling.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const liveness = require('./liveness');
const hermes = require('./hermes');
const memory = require('./memory');
const { diagnose } = require('./diagnose');
const { countArtifacts } = require('./artifacts');

function createEngine({ active, queue, MAX_ACTIVE, runningCount, CLAUDE_EXE, PROJECT_DIR, HERMES_EXE }) {
  // Every line event carries `id:` = its index in the run, so EventSource
  // auto-reconnects (which send Last-Event-ID) never duplicate rendered lines.
  function sseLine(res, idx, line) { res.write(`event: line\nid: ${idx}\ndata: ${line}\n\n`); }
  function broadcast(st, event, data, idx) {
    for (const res of st.listeners) {
      try {
        if (event === 'line') sseLine(res, idx, data);
        else res.write(`event: ${event}\ndata: ${data}\n\n`);
      } catch {}
    }
  }

  function writeMeta(st) {
    try { fs.writeFileSync(path.join(st.dir, 'meta.json'), JSON.stringify(st.meta, null, 2)); } catch {}
  }

  function pushLine(st, line) {
    st.lines.push(line);
    st.lastLineAt = Date.now(); // liveness: proof the run is doing something
    if (st.out) st.out.write(line + '\n');
    broadcast(st, 'line', line, st.lines.length - 1);
  }

  function launch(st) {
    if (st.meta.engine === 'hermes') {
      markRunning(st);
      return hermes.launch(st, { HERMES_EXE, PROJECT_DIR, pushLine, finalize: finalizeRun });
    }
    return launchClaude(st);
  }

  // Mark a run live: status/timestamps/output stream/heartbeat. Shared by both
  // engines so the liveness layer (heartbeat + reaper + stalled detection) covers
  // them identically.
  function markRunning(st) {
    st.meta.status = 'running';
    st.meta.startedAt = new Date().toISOString();
    st.lastLineAt = Date.now();
    writeMeta(st);
    st.out = fs.createWriteStream(path.join(st.dir, 'output.jsonl'), { flags: 'a' });
    liveness.startHeartbeat(st, broadcast);
  }

  // Common terminal handling for a finished run (both engines): error excerpt,
  // persist, episodic memory capture, notify listeners, free the slot.
  function finalizeRun(st) {
    liveness.stopHeartbeat(st);
    st.meta.endedAt = st.meta.endedAt || new Date().toISOString();
    if (st.meta.startedAt && st.meta.durationMs == null) {
      st.meta.durationMs = Date.parse(st.meta.endedAt) - Date.parse(st.meta.startedAt);
    }
    if (st.meta.status === 'error' && st.stderr.trim()) {
      pushLine(st, JSON.stringify({ type: 'hub_stderr', text: st.stderr.trim().slice(0, 4000) }));
    }
    if (st.meta.status === 'error' && !st.meta.errorExcerpt) {
      let ex = st.stderr.trim().slice(0, 300);
      if (!ex) {
        try {
          const last = JSON.parse(st.lines[st.lines.length - 1] || '{}');
          if (last.type === 'result' && last.result) ex = String(last.result).slice(0, 300);
        } catch {}
      }
      st.meta.errorExcerpt = ex || `exit code ${st.meta.exitCode}`;
    }
    if (st.meta.status === 'error') {
      // Append an actionable diagnosis (lib/diagnose.js) — raw excerpt stays intact.
      const hint = diagnose(st.stderr + '\n' + (st.meta.errorExcerpt || ''), st.meta.exitCode);
      if (hint && !(st.meta.errorExcerpt || '').includes(hint)) {
        st.meta.errorExcerpt = ((st.meta.errorExcerpt || '') + '\nlikely cause: ' + hint).trim();
      }
    }
    if (st.out) st.out.end();
    // Freeze the artifact count into meta now that the run can't write more —
    // so listing history never re-walks every run's artifact tree on each poll.
    try { st.meta.artifactCount = countArtifacts(st.meta.id); } catch {}
    writeMeta(st);
    try { memory.captureRun(st.meta); } catch {} // engram-style episodic capture (rule-based, no LLM)
    broadcast(st, 'done', JSON.stringify(st.meta));
    for (const res of st.listeners) { try { res.end(); } catch {} }
    st.listeners.clear();
    setTimeout(() => active.delete(st.meta.id), 30000); // grace for late SSE attach
    dequeueNext();
  }

  // One complete stdout line from the claude CLI. Sniff the terminal `result`
  // event for session id / cost / duration / token usage before persisting the
  // line verbatim. Parse failures are swallowed — a malformed line still streams.
  function onStdoutLine(st, line) {
    if (line.includes('"type":"result"')) {
      try {
        const r = JSON.parse(line);
        if (r.type === 'result') {
          st.meta.sessionId = r.session_id || st.meta.sessionId;
          st.meta.costUsd = r.total_cost_usd ?? null;
          st.meta.durationMs = r.duration_ms ?? null;
          // usage → context analytics: tokensIn = full input context on the
          // final turn (fresh + cached), tokensOut = generated tokens.
          const u = r.usage || (r.message && r.message.usage);
          if (u) {
            const cin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            st.meta.tokensIn = cin || st.meta.tokensIn;
            st.meta.tokensOut = u.output_tokens ?? st.meta.tokensOut;
          }
        }
      } catch {}
    }
    pushLine(st, line);
  }

  // Process close: map exit code to terminal status (cancel wins over code) and
  // run the shared finalizer.
  function onExit(st, code) {
    st.meta.exitCode = code;
    st.meta.status = st.cancelled ? 'cancelled' : (code === 0 ? 'done' : 'error');
    finalizeRun(st);
  }

  function launchClaude(st) {
    let child;
    try {
      child = spawn(CLAUDE_EXE, st.args, { cwd: PROJECT_DIR, windowsHide: true });
    } catch (e) {
      st.meta.status = 'error';
      st.meta.endedAt = new Date().toISOString();
      st.stderr += '\nspawn error: ' + e.message;
      finalizeRun(st);
      return;
    }
    st.child = child;
    markRunning(st);

    // Reassemble newline-delimited stream-json across chunk boundaries, then hand
    // each complete line to onStdoutLine.
    let buf = '';
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.trim()) onStdoutLine(st, line);
      }
    });
    child.stderr.on('data', d => { if (st.stderr.length < 20000) st.stderr += d; });
    child.on('error', e => { st.stderr += '\nspawn error: ' + e.message; });
    child.on('close', code => onExit(st, code));
  }

  function dequeueNext() {
    while (queue.length && runningCount() < MAX_ACTIVE) {
      const id = queue.shift();
      const st = active.get(id);
      if (st && st.meta.status === 'queued' && !st.cancelled) launch(st);
    }
  }

  return { launch, pushLine, broadcast, sseLine, writeMeta };
}

module.exports = { createEngine };
