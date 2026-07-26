/*
 * ACP (Agent Client Protocol) client for hermes runs.
 *
 * WHY: hermes -z prints only final text — no mid-run visibility. `hermes acp`
 * speaks line-delimited JSON-RPC 2.0 over stdio (the same protocol Zed/VS Code
 * use) and streams real per-step events: agent text, thoughts, tool calls +
 * results, and a plan. We spawn it per run, drive the handshake, auto-approve
 * permission requests (hub runs are autonomous), and translate each
 * `session/update` into the SAME stream-json shapes the Run tab + agent graph
 * already render for claude — so hermes lights up with a real live crew.
 *
 * Wire facts (verified against hermes 0.18.2 acp_adapter source):
 *  - stdout = JSON-RPC messages (one JSON object per line); stderr = human logs
 *  - initialize -> session/new (or session/resume) -> session/prompt
 *  - session/new result carries the session id at _meta.hermes.sessionProvenance
 *    .acpSessionId (and/or a top-level sessionId)
 *  - agent -> client request `session/request_permission` MUST be answered or it
 *    blocks ~60s then auto-denies; we answer {outcome:{outcome:'selected',
 *    optionId:'allow_always'}}
 *  - session/prompt result = {stopReason, usage:{inputTokens,outputTokens,...}}
 *    (tokens only — ACP reports no USD cost)
 */
'use strict';
const { spawn } = require('child_process');
const U = require('./util');

// hermes ACP tool kind (+ title) -> claude-style tool name, so agentgraph's
// persona map (Scout/Scribe/Wrench/…) and the Run tab tool blocks light up.
function toolName(kind, title) {
  if (/^delegate/i.test(title || '')) return 'Task'; // subagent, not a shell tool
  switch (kind) {
    case 'read': return 'Read';
    case 'edit': return 'Edit';
    case 'search': return 'Grep';
    case 'execute': return 'Bash';
    case 'fetch': return 'WebFetch';
    default: return 'Tool';
  }
}

function textOf(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).filter(Boolean).join('\n');
  if (content.type === 'text') return content.text || '';
  if (content.type === 'content' && content.content) return textOf(content.content);
  if (content.type === 'diff') return '(edit: ' + (content.path || 'file') + ')';
  return '';
}

// opts: { exe, cwd, prompt, resume }
// cb:   { onEvent(streamJsonObj), onSession(id), onStderr(text), onDone({stopReason,usage,error,code}) }
function run(opts, cb) {
  let child;
  try {
    child = spawn(opts.exe, ['acp', '--accept-hooks'], { cwd: opts.cwd, windowsHide: true });
  } catch (e) { cb.onDone({ error: 'spawn failed: ' + e.message }); return { cancel() {}, child: null }; }

  let buf = '', nextId = 100, sessionId = null, finished = false, sawWork = false;
  const pending = new Map(); // our request id -> {resolve, reject}

  // Stall watchdog: hermes over ACP hangs on the inference call when the hub
  // SERVER is launched headless (Task Scheduler autostart / any no-console
  // parent) — a Windows worker-thread quirk that does NOT affect a terminal-
  // launched server. Rather than hang forever, fail the run with a clear,
  // actionable message once no real work has streamed for STALL_FAIL ms.
  const STALL_FAIL = 75000;
  let watchdog = null;
  const armWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => {
    if (!sawWork && !finished) finish({ error: 'hermes produced no output within 75s. This is the known headless-spawn hang: hermes ACP streams fine when the hub is started from a terminal (node claude-dashboard/server.js) but stalls when the server runs headless (e.g. the Task Scheduler autostart). Launch the hub from a terminal for hermes runs.' });
  }, STALL_FAIL); };
  const disarmWatchdog = () => { clearTimeout(watchdog); watchdog = null; };

  child.stdin.on('error', () => {}); // ignore EPIPE if the tree is already gone
  const write = obj => { try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch {} };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    write({ jsonrpc: '2.0', id, method, params });
  });

  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) { let m; try { m = JSON.parse(line); } catch { continue; } dispatch(m); }
    }
  });
  child.stderr.on('data', d => { if (cb.onStderr) cb.onStderr(U.stripAnsi(d.toString())); });
  child.on('error', e => finish({ error: e.message }));
  child.on('close', code => finish({ code }));

  function dispatch(m) {
    // response to one of our requests
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(m.error) : p.resolve(m.result);
      return;
    }
    // request FROM the agent -> must answer or it blocks
    if (m.id !== undefined && m.method) {
      if (m.method === 'session/request_permission') {
        write({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'selected', optionId: 'allow_always' } } });
      } else {
        // fs/read_text_file, fs/write_text_file, anything else — we declared no
        // client fs capability, so refuse rather than hang.
        write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported by hub client' } });
      }
      return;
    }
    // notification
    if (m.method === 'session/update') onUpdate((m.params && m.params.update) || {});
  }

  const WORK_UPDATES = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan']);
  function onUpdate(u) {
    if (WORK_UPDATES.has(u.sessionUpdate)) { sawWork = true; disarmWatchdog(); } // real progress — cancel the stall watchdog
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        cb.onEvent({ type: 'hermes_text', text: textOf(u.content) }); break;
      case 'agent_thought_chunk':
        cb.onEvent({ type: 'hermes_thought', text: textOf(u.content) }); break;
      case 'tool_call': {
        const name = toolName(u.kind, u.title);
        const input = name === 'Task'
          ? { subagent_type: 'crew', description: u.title || 'delegate', title: u.title }
          : { title: u.title || '' };
        cb.onEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', id: u.toolCallId, name, input }] } });
        break;
      }
      case 'tool_call_update':
        if (u.status === 'completed' || u.status === 'failed') {
          cb.onEvent({ type: 'user', message: { content: [{
            type: 'tool_result', tool_use_id: u.toolCallId,
            content: textOf(u.content), is_error: u.status === 'failed',
          }] } });
        }
        break;
      case 'plan':
        cb.onEvent({ type: 'hermes_plan', entries: (u.entries || []).map(e => ({ content: e.content, status: e.status })) });
        break;
      default: break; // usage_update / available_commands_update / user_message_chunk — ignored
    }
  }

  function sidOf(r) {
    if (!r) return null;
    if (r.sessionId) return r.sessionId;
    try { return r._meta.hermes.sessionProvenance.acpSessionId || null; } catch { return null; }
  }

  // `hermes acp` is a PERSISTENT JSON-RPC server — it does not exit when a
  // prompt turn ends. If we only close our stdin it lingers, and on Windows a
  // plain child.kill() leaves its Python subprocess tree alive. Both leak
  // orphans that then contend on hermes's shared SQLite session store and hang
  // the NEXT run after session/prompt. So every terminal path taskkills the
  // whole tree.
  function killTree() {
    if (!child || !child.pid) return;
    try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }); } catch {}
  }

  function finish(info) {
    if (finished) return; finished = true;
    disarmWatchdog();
    for (const p of pending.values()) { try { p.reject(new Error('acp closed')); } catch {} }
    pending.clear();
    killTree();
    cb.onDone(info || {});
  }

  (async () => {
    try {
      armWatchdog(); // arm BEFORE the first request: a hang during initialize/session/new/resume must time out too (the orphan reaper skips live runs, so nothing else would ever sweep it)
      await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
      let sid = null;
      if (opts.resume) {
        try { sid = sidOf(await request('session/resume', { sessionId: opts.resume, cwd: opts.cwd, mcpServers: [] })) || opts.resume; }
        catch { sid = null; }
      }
      if (!sid) sid = sidOf(await request('session/new', { cwd: opts.cwd, mcpServers: [] }));
      sessionId = sid;
      if (sid) cb.onSession(sid);
      armWatchdog(); // start the stall timer once the turn is requested
      const res = await request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: opts.prompt }] });
      finish({ stopReason: res && res.stopReason, usage: res && res.usage });
    } catch (e) {
      // if the process already closed, finish() was called; otherwise surface it
      finish({ error: (e && (e.message || e.data)) || 'acp protocol error' });
    }
  })();

  return {
    sessionId: () => sessionId,
    cancel() {
      if (finished) return;
      if (sessionId) write({ jsonrpc: '2.0', id: nextId++, method: 'session/cancel', params: { sessionId } });
      // give hermes a moment to unwind the turn gracefully, then force the tree
      setTimeout(() => finish({ stopReason: 'cancelled' }), 500);
    },
    kill() { finish({ error: 'killed' }); },
    child,
  };
}

module.exports = { run, toolName };
