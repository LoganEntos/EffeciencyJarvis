/* Run tab: a real chat with the claude CLI. POST /api/run spawns a print-mode
   run streaming stream-json; we render it as bubbles over SSE, persist history,
   and render run-produced artifacts (HTML/SVG/PNG) inline. */
'use strict';

const chat = { sessionId: null, runId: null, es: null, running: false, t0: 0, timer: null, seen: -1 };

function ensureRunUI() {
  if ($('#chatLog')) return;
  $('#run').innerHTML = `
    <h2>Run — work with Claude in this project</h2>
    <div class="runbar">
      <select id="runEngine" title="engine — claude (this CLI, model+perms below) or hermes (its own model tiering + tool approvals; no resume yet)">
        <option value="claude">engine: claude</option>
        <option value="hermes">engine: hermes</option>
      </select>
      <select id="runModel" title="model — auto routes each prompt to the cheapest capable model; or pin a specific Claude">
        <option value="auto">model: auto (routed)</option>
        <option value="">CLI default</option>
        <optgroup label="Tier alias (current model)">
          <option value="opus">opus</option>
          <option value="sonnet">sonnet</option>
          <option value="haiku">haiku</option>
        </optgroup>
        <optgroup label="Pin a version">
          <option value="claude-fable-5">Fable 5</option>
          <option value="claude-opus-4-8">Opus 4.8</option>
          <option value="claude-opus-4-7">Opus 4.7</option>
          <option value="claude-sonnet-5">Sonnet 5</option>
          <option value="claude-sonnet-4-6">Sonnet 4.6</option>
          <option value="claude-haiku-4-5">Haiku 4.5</option>
        </optgroup>
      </select>
      <select id="runPerm" title="permission mode">
        <option value="acceptEdits">perms: acceptEdits</option>
        <option value="default">perms: default (tools denied)</option>
        <option value="bypassPermissions">perms: bypassPermissions</option>
        <option value="plan">perms: plan</option>
      </select>
      <label class="chk" title="inject the top 3 relevant hub memories into the prompt (costs a few hundred prompt tokens — off by default)">
        <input type="checkbox" id="runRecall"> ◇ memory recall</label>
      <button id="newChatBtn" class="ghost">＋ New chat</button>
      <span class="pill neutral hidden" id="chatSession" title="follow-up prompts resume this CLI session"></span>
    </div>
    <div class="chatlog" id="chatLog"><div class="msg sys">Type a prompt below — the claude CLI runs it inside the project directory and streams back here.</div></div>
    <div class="badgebar" id="runStatus" style="margin-bottom:10px"></div>
    <div class="composer">
      <textarea id="promptIn" placeholder="Ask Claude to do something in this project…"></textarea>
      <div class="btns">
        <button id="sendBtn">Send ▷</button>
        <button id="cancelBtn" class="danger hidden">Cancel ✕</button>
      </div>
    </div>
    <h2 style="margin-top:30px">Run history <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click a run to replay it</span></h2>
    <div class="flex" id="histStats" style="margin-bottom:12px"></div>
    <input class="search" id="histFilter" placeholder="Filter runs by prompt…">
    <div id="runHistory"><div class="muted">Loading…</div></div>`;
  $('#sendBtn').onclick = sendPrompt;
  $('#cancelBtn').onclick = cancelRun;
  $('#newChatBtn').onclick = newChat;
  // Enter sends (the expectation on phones/low-end browsers where Ctrl/Cmd is
  // awkward or absent); Shift+Enter inserts a newline. Ctrl/Cmd+Enter kept as
  // an alias for muscle memory from the old binding.
  $('#promptIn').onkeydown = e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sendPrompt();
  };
  $('#histFilter').oninput = renderHistory;
  // engine/model/permission choices survive reloads
  try {
    const m = localStorage.getItem('hub.model'), p = localStorage.getItem('hub.perm');
    if (m !== null) $('#runModel').value = m;
    if (p !== null) $('#runPerm').value = p;
    $('#runEngine').value = localStorage.getItem('hub.engine') === 'hermes' ? 'hermes' : 'claude';
    $('#runRecall').checked = localStorage.getItem('hub.recall') === '1'; // default OFF
  } catch {}
  applyEngineUI();
  $('#runEngine').onchange = e => { try { localStorage.setItem('hub.engine', e.target.value); } catch {} applyEngineUI(); };
  $('#runModel').onchange = e => { try { localStorage.setItem('hub.model', e.target.value); } catch {} };
  $('#runPerm').onchange = e => { try { localStorage.setItem('hub.perm', e.target.value); } catch {} };
  $('#runRecall').onchange = e => { try { localStorage.setItem('hub.recall', e.target.checked ? '1' : '0'); } catch {} };
}

// hermes governs its own model + tool approvals; grey those controls out so
// it's obvious they don't apply. Memory recall works for both engines.
function applyEngineUI() {
  const hermes = $('#runEngine') && $('#runEngine').value === 'hermes';
  ['#runModel', '#runPerm'].forEach(sel => {
    const el = $(sel);
    if (el) { el.disabled = hermes; el.style.opacity = hermes ? 0.45 : 1; }
  });
}

// Minimal safe markdown for assistant bubbles: escape everything first, then
// re-introduce a small tag set (code fences, inline code, bold/italic,
// headings, bullets, http(s) links). No raw HTML ever passes through.
function mdToHtml(text) {
  let s = esc(text);
  const blocks = [];
  s = s.replace(/```\w*\r?\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${code.replace(/\s+$/, '')}</pre>`);
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/^#{1,4}\s+(.+)$/gm, '<b class="mdh">$1</b>');
  s = s.replace(/^[-*]\s+/gm, '• ');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return s;
}

renderers.run = async function () {
  ensureRunUI();
  await refreshHistory();
};
renderers.run.noSkeleton = true; // never wipe an in-flight chat with a skeleton

function prefillRun(text) {
  goTab('run');
  ensureRunUI();
  $('#promptIn').value = text;
  $('#promptIn').focus();
}

// ---- chat log helpers ----
function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }
function addEl(html, cls) {
  const log = $('#chatLog');
  const stick = nearBottom(log);
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.innerHTML = html;
  log.appendChild(div);
  if (stick) log.scrollTop = log.scrollHeight;
  return div;
}
const addMsg = (text, cls) => addEl(esc(text), 'msg ' + cls);

const toolEls = {}; // tool_use id -> <pre> that receives the tool result
function excerpt(v, n) { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; }

// Turn a raw CLI stderr/crash dump into a one-line plain-English headline +
// a collapsed <pre> with the full text — so a Node stack trace doesn't read
// as an illegible wall of "at Object.<anonymous>" noise in the chat log.
function summarizeError(raw) {
  const text = (raw || '').trim();
  if (!text) return 'The command failed with no output.';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const first = lines[0] || text;
  if (/ENOENT/.test(text)) return "Couldn't find a file or program it needed — " + first;
  if (/EADDRINUSE/.test(text)) return 'That port is already in use by another process.';
  if (/EACCES|permission denied/i.test(text)) return "Permission denied — " + first;
  if (/is not recognized as an internal or external command|command not found/i.test(text)) return 'A required program is missing from PATH — ' + first;
  if (/^(\w*Error|Exception):/.test(first) || /Error:/.test(first)) return first.replace(/^\s*at\s+/, '');
  return first.length > 140 ? first.slice(0, 140) + '…' : first;
}
function errBlock(raw) {
  const headline = esc(summarizeError(raw));
  const full = esc(excerpt(raw, 6000));
  return `<div class="errhead">✗ ${headline}</div>
    <details><summary>show full error</summary><pre>${full}</pre></details>`;
}

// Render one stream-json line into the chat log. Returns the result meta if
// this line was the final result event.
function renderLine(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'system' && o.subtype === 'init') {
    addMsg(`session ${o.session_id || '?'} · model ${o.model || '?'} · ${(o.tools || []).length} tools`, 'sys');
    return null;
  }
  if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
    for (const b of o.message.content) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) { chat.lastText = b.text.trim(); addEl(mdToHtml(b.text.trim()), 'msg assistant'); }
      else if (b.type === 'tool_use') {
        const el = addEl(`<details><summary>⚒ ${esc(b.name || 'tool')} <span class="muted">${esc(excerpt(b.input || {}, 90))}</span></summary>
          <pre>${esc(JSON.stringify(b.input || {}, null, 2))}</pre></details>`, 'toolblk');
        if (b.id) toolEls[b.id] = el.querySelector('pre');
      }
    }
    return null;
  }
  if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
    for (const b of o.message.content) {
      if (b && b.type === 'tool_result' && b.tool_use_id && toolEls[b.tool_use_id]) {
        const txt = Array.isArray(b.content)
          ? b.content.filter(c => c && c.type === 'text').map(c => c.text).join('\n')
          : (typeof b.content === 'string' ? b.content : JSON.stringify(b.content));
        if (txt) toolEls[b.tool_use_id].textContent += '\n── result ──\n' + excerpt(txt, 3000);
      }
    }
    return null;
  }
  if (o.type === 'result') {
    const secs = o.duration_ms ? (o.duration_ms / 1000).toFixed(1) + 's' : '';
    const cost = o.total_cost_usd != null ? '$' + o.total_cost_usd.toFixed(4) : '';
    const turns = o.num_turns ? o.num_turns + ' turns' : '';
    const tok = o.usage ? `${(o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0)}→${o.usage.output_tokens || 0} tok` : '';
    const ok = o.subtype === 'success';
    addMsg(`${ok ? '✓ done' : '✗ ' + (o.subtype || 'error')} ${[secs, turns, tok, cost].filter(Boolean).join(' · ')}`, ok ? 'result' : 'errmsg');
    if (!ok && o.result) addEl(errBlock(o.result), 'errblk');
    return o;
  }
  if (o.type === 'hub_stderr') { addEl(errBlock(o.text), 'errblk'); return null; }
  if (o.type === 'hub_status') { addMsg(o.text, 'sys'); return null; }
  if (o.type === 'hermes_log') {
    // live activity tailed from hermes's own log — -z streams no tool events,
    // so this is the window into what the run is actually doing right now.
    addEl(`<span class="logdot">›</span> ${esc(o.text)}`, 'logline');
    return null;
  }
  if (o.type === 'hermes_out') {
    // hermes -z streams plain text lines — grow them into ONE assistant bubble
    if (!chat.hermesEl || !chat.hermesEl.isConnected) { chat.hermesEl = addEl('', 'msg assistant'); chat.hermesText = ''; }
    chat.hermesText += (chat.hermesText ? '\n' : '') + o.text;
    chat.hermesEl.innerHTML = mdToHtml(chat.hermesText);
    chat.lastText = chat.hermesText.trim(); // feeds voice talk-back like claude runs
    return null;
  }
  return null;
}

// C8: the "queued/running" status-timer + live-stream attach was duplicated
// between sendPrompt() (new run) and openRun() (reattach to one still going).
// Shared here so the label/timer logic only lives in one place.
function attachLiveRun(id, { startedAtMs, queued, seen } = {}) {
  chat.runId = id; chat.running = true; chat.seen = seen != null ? seen : -1;
  chat.t0 = startedAtMs || Date.now();
  chat.queued = !!queued;
  chat.hb = null; chat.lastActivity = Date.now();
  $('#sendBtn').disabled = true;
  $('#cancelBtn').classList.remove('hidden');
  clearInterval(chat.timer);
  chat.timer = setInterval(renderRunStatus, 1000);
  renderRunStatus();
  attachStream(id);
}

// Live status line: elapsed time + a truthful liveness signal so a working run
// is visibly distinct from a stalled/dead one. Driven by the server heartbeat
// (idle/stalled/procAlive) with a client-side idle fallback between beats.
function renderRunStatus() {
  const el = $('#runStatus');
  if (!el || !chat.running) return;
  if (chat.queued) {
    el.innerHTML = `<span class="pill warn">queued — waiting for a slot</span><span class="muted mono">${esc(chat.runId)}</span>`;
    return;
  }
  const elapsed = Math.round((Date.now() - chat.t0) / 1000);
  const idleS = Math.round((chat.hb ? chat.hb.idleMs : Date.now() - chat.lastActivity) / 1000);
  const dead = chat.hb && chat.hb.procAlive === false;
  const stalled = dead || (chat.hb ? chat.hb.stalled : idleS > 120);
  let html = `<span class="pill ${stalled ? 'err' : 'live'}">${stalled ? '⚠ ' : '◉ '}running · ${elapsed}s</span>`;
  if (stalled) html += `<span class="pill err">${dead ? 'process gone' : 'no activity ' + idleS + 's'}</span>`;
  else if (idleS >= 8) html += `<span class="muted mono">idle ${idleS}s</span>`;
  html += `<span class="muted mono">${esc(chat.runId)}</span>`;
  el.innerHTML = html;
}

// ---- live run flow ----
async function sendPrompt() {
  const ta = $('#promptIn');
  const prompt = ta.value.trim();
  if (!prompt || chat.running) return;
  const engine = $('#runEngine') ? $('#runEngine').value : 'claude';
  let r;
  try {
    r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, engine, model: $('#runModel').value, permissionMode: $('#runPerm').value,
        resume: engine === 'hermes' ? '' : (chat.sessionId || ''), recall: $('#runRecall').checked }) });
  } catch (e) { addMsg('Run failed to start: ' + (e.message || 'network error'), 'errmsg'); return; }
  if (r.error) { addMsg(r.error, 'errmsg'); return; }
  ta.value = '';
  addMsg(prompt, 'user');
  chat.hermesEl = null; chat.hermesText = ''; // fresh bubble per hermes reply
  attachLiveRun(r.id, { startedAtMs: Date.now(), queued: r.queued });
  if (window.HubVoice) HubVoice.onRunStart();
}

function attachStream(id) {
  if (chat.es) { chat.es.close(); chat.es = null; }
  const es = new EventSource(`/api/run/stream?id=${encodeURIComponent(id)}`);
  chat.es = es;
  es.addEventListener('line', e => {
    const idx = parseInt(e.lastEventId, 10);
    if (!isNaN(idx)) { if (idx <= chat.seen) return; chat.seen = idx; } // dedupe SSE auto-reconnect replays
    chat.lastActivity = Date.now(); if (chat.hb) chat.hb.idleMs = 0; // any line = fresh activity
    let o; try { o = JSON.parse(e.data); } catch { return; }
    if (chat.queued && o.type === 'system') { chat.queued = false; chat.t0 = Date.now(); } // slot freed — run started
    const result = renderLine(o);
    if (result && result.session_id) setSession(result.session_id);
  });
  es.addEventListener('heartbeat', e => {
    try { chat.hb = JSON.parse(e.data); } catch { return; }
    renderRunStatus();
  });
  es.addEventListener('done', async e => {
    es.close(); chat.es = null;
    let meta = {}; try { meta = JSON.parse(e.data); } catch {}
    if (meta.sessionId) setSession(meta.sessionId);
    finishRun(meta);
    await showArtifacts(id);
    refreshHistory();
  });
  es.onerror = () => { if (!chat.running && chat.es) { chat.es.close(); chat.es = null; } };
}

function finishRun(meta) {
  chat.running = false;
  clearInterval(chat.timer); chat.timer = null;
  $('#sendBtn').disabled = false;
  $('#cancelBtn').classList.add('hidden');
  const s = meta.status || 'done';
  const cls = s === 'done' ? 'ok' : (s === 'cancelled' ? 'warn' : 'err');
  $('#runStatus').innerHTML = `<span class="pill ${cls}">${esc(s)}</span><span class="muted mono">${esc(meta.id || '')}</span>`;
  $('#promptIn').focus();
  if (window.HubVoice) HubVoice.onRunDone(s === 'done' ? chat.lastText : '', meta);
}

async function cancelRun() {
  if (!chat.runId) return;
  try { await api('/api/run/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: chat.runId }) }); }
  catch {}
}

function setSession(sid) {
  chat.sessionId = sid;
  const b = $('#chatSession');
  b.textContent = '⟲ resumes ' + sid.slice(0, 8) + '…';
  b.classList.remove('hidden');
}

function newChat() {
  if (chat.es) { chat.es.close(); chat.es = null; }
  clearInterval(chat.timer); chat.timer = null;
  chat.sessionId = null; chat.runId = null; chat.running = false; chat.seen = -1;
  chat.hermesEl = null; chat.hermesText = '';
  $('#chatSession').classList.add('hidden');
  $('#runStatus').innerHTML = '';
  $('#sendBtn').disabled = false;
  $('#cancelBtn').classList.add('hidden');
  $('#chatLog').innerHTML = '<div class="msg sys">New conversation — the next prompt starts a fresh CLI session.</div>';
  $('#promptIn').focus();
}

// ---- artifacts (W2): render run-produced visuals inline ----
async function showArtifacts(runId) {
  let arts;
  try { arts = await api(`/api/run/artifacts?id=${encodeURIComponent(runId)}`); } catch { return; }
  if (!Array.isArray(arts) || !arts.length) return;
  addMsg(`${arts.length} artifact${arts.length === 1 ? '' : 's'} produced`, 'sys');
  for (const a of arts) {
    const url = `/api/run/artifact?id=${encodeURIComponent(runId)}&file=${encodeURIComponent(a.file)}`;
    const kb = a.size >= 1024 ? Math.round(a.size / 1024) + ' KB' : a.size + ' B';
    const ext = (a.file.split('.').pop() || '').toLowerCase();
    const head = `<div class="ahead"><span>◫ ${esc(a.file)} · ${kb}</span>
      <a class="link" href="${url}" target="_blank" rel="noopener">open ↗</a></div>`;
    let body;
    if (ext === 'html' || ext === 'htm' || ext === 'svg') {
      body = `<iframe sandbox="allow-scripts" src="${url}" title="${esc(a.file)}"></iframe>`;
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      body = `<img src="${url}" alt="${esc(a.file)}">`;
    } else {
      body = `<a class="link" href="${url}" target="_blank" rel="noopener">download ${esc(a.file)}</a>`;
    }
    addEl(head + body, 'artifact');
  }
}

// ---- history (W2) ----
let histRuns = [];
async function refreshHistory() {
  if (!$('#runHistory')) return;
  try { histRuns = await api('/api/runs'); } catch { $('#runHistory').innerHTML = '<div class="muted">History unavailable.</div>'; return; }
  if (!Array.isArray(histRuns)) histRuns = [];
  // (header's own #spendBadge — see app.js updateSpendBadge — already shows
  // today's run count+spend; a second script used to write a longer string
  // into that SAME id, which is what produced the unreadable "today: 52
  // ru…" truncation on narrow phones. Don't duplicate it here.)
  // N4: routing-accuracy chip (auto-routed runs only; suspects in the tooltip)
  try { routing = await api('/api/routing'); } catch { routing = null; }
  renderHistStats();
  renderHistory();
}
let routing = null;

// clickable stat chips: totals + outcome breakdown + per-model spend; clicking
// an outcome chip filters the list to it
let histStatusFilter = '';
function renderHistStats() {
  const el = $('#histStats');
  if (!el) return;
  const by = s => histRuns.filter(m => m.status === s);
  const total = histRuns.reduce((s, m) => s + (m.costUsd || 0), 0);
  const models = {};
  for (const m of histRuns) {
    const k = m.model || 'default';
    models[k] = models[k] || { n: 0, cost: 0 };
    models[k].n++; models[k].cost += m.costUsd || 0;
  }
  const chip = (label, cls, filter) => `<span class="pill ${cls}" data-f="${filter}" style="cursor:pointer${histStatusFilter === filter && filter ? ';outline:2px solid var(--accent-dim)' : ''}">${label}</span>`;
  el.innerHTML =
    chip(`all ${histRuns.length} · $${total.toFixed(2)}`, 'neutral', '') +
    chip(`✓ ${by('done').length} done`, 'ok', 'done') +
    chip(`✗ ${by('error').length} failed`, 'err', 'error') +
    chip(`◌ ${by('cancelled').length} cancelled`, 'warn', 'cancelled') +
    Object.entries(models).map(([k, v]) => `<span class="pill neutral">${esc(k)}: ${v.n} · $${v.cost.toFixed(2)}</span>`).join('') +
    (routing && routing.total ? `<span class="pill ${routing.suspects.length ? 'warn' : 'ok'}" title="${esc(routing.suspects.map(s => `${s.model}: ${s.why} — "${(s.prompt || '').slice(0, 60)}"`).join('\n') || 'every auto-routed pick looks right')}">⚖ auto-routing: ${Math.round(100 * routing.ok / routing.total)}% ok · ${routing.suspects.length} suspect${routing.suspects.length === 1 ? '' : 's'}</span>` : '');
  el.querySelectorAll('[data-f]').forEach(c => c.onclick = () => {
    histStatusFilter = histStatusFilter === c.dataset.f ? '' : c.dataset.f;
    renderHistStats(); renderHistory();
  });
}

function renderHistory() {
  const el = $('#runHistory');
  if (!el) return;
  if (!histRuns.length) { el.innerHTML = '<div class="muted">No runs yet — send your first prompt above.</div>'; return; }
  const q = ($('#histFilter').value || '').toLowerCase();
  const rows = histRuns.filter(m => (!q || (m.promptExcerpt || '').toLowerCase().includes(q))
    && (!histStatusFilter || m.status === histStatusFilter));
  if (!rows.length) { el.innerHTML = '<div class="muted">No runs match the filter.</div>'; return; }
  const pill = s => s === 'done' ? 'ok' : (s === 'running' || s === 'queued' || s === 'cancelled' ? 'warn' : 'err');
  // a "running" row that has gone silent (or whose process is gone) is flagged
  // so a stalled/zombie run is never mistaken for a healthy one at a glance.
  const liveBadge = m => {
    if (m.status !== 'running') return '';
    if (m.procAlive === false) return '<span class="pill err">process gone</span>';
    if (m.stalled) return `<span class="pill err">stalled ${Math.round((m.idleMs || 0) / 1000)}s</span>`;
    return '<span class="pill live">◉ live</span>';
  };
  el.innerHTML = rows.map(m => `
    <div class="row clickable runrow" data-id="${esc(m.id)}">
      <div class="flex" style="justify-content:space-between">
        <span><span class="pill ${pill(m.status)}">${esc(m.status)}</span>${liveBadge(m)}
          <span class="muted" style="font-size:11.5px">${new Date(m.startedAt || m.queuedAt || 0).toLocaleString()}</span></span>
        <span class="muted" style="font-size:11.5px">${m.engine === 'hermes' ? '⬡ hermes · ' : ''}${m.model ? esc(m.model) + (m.routedReason ? ' (auto)' : '') + ' · ' : ''}${m.durationMs ? (m.durationMs / 1000).toFixed(1) + 's' : ''}${m.costUsd != null ? ' · $' + m.costUsd.toFixed(4) : ''}${m.resumedFrom ? ' · ⟲ resumed' : ''}${m.artifactCount ? ' · ◫ ' + m.artifactCount : ''}
          <button class="danger delRunBtn" data-id="${esc(m.id)}" title="delete this run from history" style="padding:2px 9px;font-size:10.5px;margin-left:8px">✕</button></span>
      </div>
      <div class="pex">${esc(m.promptExcerpt || '')}</div>
      ${m.errorExcerpt ? `<div class="pex" style="color:#f0908f;white-space:normal">↳ ${esc(m.errorExcerpt)}</div>` : ''}
    </div>`).join('');
  el.querySelectorAll('.runrow').forEach(r => r.onclick = () => openRun(r.dataset.id));
  el.querySelectorAll('.delRunBtn').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this run (transcript + artifacts) from history?')) return;
    try {
      const r = await api('/api/run/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) });
      if (r.error) addMsg(r.error, 'errmsg');
    } catch {}
    refreshHistory();
  });
}

async function openRun(id) {
  if (chat.running) { addMsg('A run is still active — wait or cancel before replaying history.', 'errmsg'); return; }
  let t;
  try { t = await api(`/api/run/transcript?id=${encodeURIComponent(id)}`, { timeoutMs: 30000 }); }
  catch (e) { addMsg('Failed to load run: ' + (e.message || 'network error'), 'errmsg'); return; }
  if (t.error) { addMsg(t.error, 'errmsg'); return; }
  newChat();
  addMsg(`replaying run ${id}${t.truncated ? ' (long transcript truncated)' : ''}`, 'sys');
  if (t.prompt) addMsg(t.prompt, 'user');
  for (const line of t.lines || []) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    renderLine(o);
  }
  if (t.meta && (t.meta.status === 'running' || t.meta.status === 'queued')) {
    // still-active run (e.g. opened from another tab) — attach live
    attachLiveRun(id, {
      queued: t.meta.status === 'queued',
      startedAtMs: Date.parse(t.meta.startedAt) || Date.now(),
      seen: (t.lines || []).length - 1,
    });
    return;
  }
  await showArtifacts(id);
  if (t.meta && t.meta.sessionId) {
    setSession(t.meta.sessionId);
    addMsg('This conversation can continue — the next prompt you send resumes it.', 'sys');
  }
  $('#chatLog').scrollTop = 0; // replays read top-down
}
