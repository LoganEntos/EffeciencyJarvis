/*
 * Hermes launch transports. Two modes, chosen by HUB_HERMES_ENGINE:
 *
 *   acp     (default) — `hermes acp` (JSON-RPC/stdio): real per-step streaming
 *                       (text, thoughts, tool calls + results, plan). Best UX,
 *                       but HANGS on the inference call when the hub SERVER is
 *                       launched HEADLESS (Task Scheduler autostart / no-console
 *                       parent) — a Windows worker-thread quirk. Fine from a
 *                       terminal. A 75s stall watchdog (lib/acp.js) fails a hung
 *                       headless run with a clear message instead of hanging.
 *
 *   oneshot           — `hermes -z` (final text only, + the activity-log tail
 *                       and heartbeat for liveness). Works HEADLESS. Set
 *                       HUB_HERMES_ENGINE=oneshot when running the hub as an
 *                       autostart / scheduled task. Streams no tool steps.
 *
 * The caller (runs.js) has already marked the run running (markRunning) so the
 * heartbeat + output stream are live for both modes.
 */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const acp = require('./acp');
const liveness = require('./liveness');

function mode() {
  return (process.env.HUB_HERMES_ENGINE || '').toLowerCase() === 'oneshot' ? 'oneshot' : 'acp';
}

function launch(st, deps) {
  return mode() === 'oneshot' ? launchOneshot(st, deps) : launchAcp(st, deps);
}

// ACP: stream ACP events (already shaped like claude stream-json) via pushLine.
function launchAcp(st, { HERMES_EXE, PROJECT_DIR, pushLine, finalize }) {
  const cfg = st.hermesCfg || { prompt: '', resume: '' };
  st.acp = acp.run({ exe: HERMES_EXE, cwd: PROJECT_DIR, prompt: cfg.prompt, resume: cfg.resume }, {
    onEvent: obj => pushLine(st, JSON.stringify(obj)),
    onSession: sid => { st.meta.sessionId = sid; },
    onStderr: text => {
      if (st.stderr.length < 20000) st.stderr += text;
      if (!st.meta.model) { const m = text.match(/model=([\w./-]+)/); if (m) st.meta.model = m[1]; }
    },
    onDone: info => {
      st.child = null;
      const u = info.usage || {};
      st.meta.tokensIn = u.inputTokens ?? null;
      st.meta.tokensOut = u.outputTokens ?? null;
      if (st.cancelled || info.stopReason === 'cancelled') st.meta.status = 'cancelled';
      else if (info.stopReason) st.meta.status = 'done';
      else if (info.error) { st.meta.status = 'error'; st.meta.errorExcerpt = String(info.error).slice(0, 300); }
      else if (info.code) { st.meta.status = 'error'; st.meta.errorExcerpt = `hermes acp exited (code ${info.code}) before completing`; }
      else st.meta.status = 'done';
      st.meta.exitCode = info.code ?? (info.error ? 1 : 0);
      const tok = (st.meta.tokensIn || st.meta.tokensOut)
        ? ` · ${st.meta.tokensIn || 0}→${st.meta.tokensOut || 0} tok` : '';
      pushLine(st, JSON.stringify({ type: 'hub_status', text: `hermes done · ${st.meta.model || 'config default'}${tok}` }));
      finalize(st);
    },
  });
  st.child = st.acp.child;
}

// oneshot: `hermes -z` — final text on stdout (wrapped as hermes_out), cost from
// --usage-file, and the activity-log tail for whatever hermes logs mid-run.
function launchOneshot(st, { HERMES_EXE, PROJECT_DIR, pushLine, finalize }) {
  const cfg = st.hermesCfg || { prompt: '' };
  const args = ['-z', cfg.prompt, '--usage-file', path.join(st.dir, 'usage.json')];
  let child;
  try { child = spawn(HERMES_EXE, args, { cwd: PROJECT_DIR, windowsHide: true }); }
  catch (e) { st.meta.status = 'error'; st.stderr += '\nspawn error: ' + e.message; finalize(st); return; }
  st.child = child;
  liveness.startHermesTail(st, HERMES_EXE, (s, text) => pushLine(s, JSON.stringify({ type: 'hermes_log', text })));
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.trim()) pushLine(st, JSON.stringify({ type: 'hermes_out', text: U.stripAnsi(line) }));
    }
  });
  child.stderr.on('data', d => { if (st.stderr.length < 20000) st.stderr += d; });
  child.on('error', e => { st.stderr += '\nspawn error: ' + e.message; });
  child.on('close', code => {
    liveness.stopHermesTail(st);
    st.meta.exitCode = code;
    const u = U.safeJson(path.join(st.dir, 'usage.json')) || {};
    if (u.model) st.meta.model = String(u.model);
    st.meta.status = st.cancelled ? 'cancelled' : (code === 0 ? 'done' : 'error');
    pushLine(st, JSON.stringify({
      type: 'hub_status',
      text: `hermes done · ${st.meta.model || 'config default'}`,
    }));
    finalize(st);
  });
}

module.exports = { launch, mode };
