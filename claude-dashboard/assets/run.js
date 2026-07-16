/* Run tab: a real chat with the claude CLI. POST /api/run spawns a print-mode
   run streaming stream-json; we render it as bubbles over SSE, persist history,
   and render run-produced artifacts (HTML/SVG/PNG) inline. */
'use strict';

const chat = { sessionId: null, runId: null, es: null, running: false, t0: 0, timer: null, seen: -1 };
// renderUsageGauge() lives in assets/rungauge.js (loaded just before this file).

function ensureRunUI() {
  if ($('#chatLog')) return;
  $('#run').innerHTML = `
    <h2>Run — work with Claude in this project</h2>
    <div class="runbar">
      <select id="runEngine" title="engine — claude (this CLI, model+perms below). hermes is a deprecated paid second stack, hidden unless enabled in Config">
        <option value="claude">engine: claude</option>
        <option value="hermes" id="hermesOpt" hidden>engine: hermes (deprecated)</option>
      </select>
      <label class="chk" title="Jarvis mode: turn your vibe code into clean prompts, with smart model routing">
        <input type="checkbox" id="jarvisToggle"> ✦ Jarvis</label>
      <select id="runModel" title="model — auto routes each prompt to the cheapest capable model; or pin a specific Claude. If Jarvis is on, it will auto-select unless you override here">
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
      <span class="pill neutral hidden" id="jarvisStatus" title="Jarvis model selection"></span>
      <select id="runPerm" title="permission mode — hub runs are headless (no approval prompt exists), so anything below bypassPermissions silently denies Bash/MCP tools">
        <option value="bypassPermissions">perms: full (bypassPermissions)</option>
        <option value="acceptEdits">perms: acceptEdits (Bash/MCP denied)</option>
        <option value="default">perms: default (most tools denied)</option>
        <option value="plan">perms: plan</option>
      </select>
      <label class="chk" title="inject the top 3 relevant hub memories into the prompt (costs a few hundred prompt tokens — off by default)">
        <input type="checkbox" id="runRecall"> ◇ memory recall</label>
      <button id="newChatBtn" class="ghost">＋ New chat</button>
      <span class="pill neutral hidden" id="chatSession" title="follow-up prompts resume this CLI session"></span>
      <span class="pill hidden" id="runProjectTag" title="this chat is bound to a project — its instructions + memory are injected. Click to unbind." style="cursor:pointer;background:var(--accent-dim);color:var(--bg)"></span>
    </div>
    <div id="usageGauge"></div>
    <div class="chatlog" id="chatLog"><div class="msg sys">Type a prompt below — the claude CLI runs it inside the project directory and streams back here.</div></div>
    <div class="badgebar" id="runStatus" style="margin-bottom:10px"></div>
    <div class="composer">
      <div id="attachStrip" class="attachstrip hidden"></div>
      <textarea id="promptIn" placeholder="Ask Claude to do something in this project… (paste, drop, or 📎 attach files)"></textarea>
      <input type="file" id="fileIn" multiple hidden>
      <div class="btns">
        <button id="attachBtn" class="ghost" title="Attach files to this run">📎 Attach</button>
        <button id="rereadBtn" class="ghost" title="Read the last reply aloud again">↻ Read again</button>
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
  // Re-read: speak the last assistant reply again via the same TTS path the run
  // uses. Click is a real user gesture, so mobile autoplay policy is satisfied.
  $('#rereadBtn').onclick = () => {
    const t = (chat.lastText || '').trim();
    if (!t) { addMsg('Nothing to read yet — send a prompt first.', 'sys'); return; }
    if (window.HubVoice && HubVoice.speak) HubVoice.speak(t);
  };
  $('#newChatBtn').onclick = newChat;
  // Enter sends (the expectation on phones/low-end browsers where Ctrl/Cmd is
  // awkward or absent); Shift+Enter inserts a newline. Ctrl/Cmd+Enter kept as
  // an alias for muscle memory from the old binding.
  $('#promptIn').onkeydown = e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sendPrompt();
  };
  // Paste, drop, or 📎 pick → upload to the inbox, attach to the next run.
  // Images come through clipboard `items` (screenshots have no File in `.files`);
  // any other pasted/dropped file is taken as-is so docs/PDFs/CSVs attach too.
  const ta = $('#promptIn');
  ta.onpaste = e => {
    const cd = e.clipboardData; if (!cd) return;
    const imgs = [...(cd.items || [])].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    const docs = [...(cd.files || [])].filter(f => !f.type.startsWith('image/'));
    const all = [...imgs, ...docs];
    if (all.length) { e.preventDefault(); attachFiles(all); }
  };
  $('#attachBtn').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => { const f = [...(e.target.files || [])]; if (f.length) attachFiles(f); e.target.value = ''; };
  const comp = ta.closest('.composer');
  comp.ondragover = e => { e.preventDefault(); comp.classList.add('drag'); };
  comp.ondragleave = () => comp.classList.remove('drag');
  comp.ondrop = e => {
    e.preventDefault(); comp.classList.remove('drag');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) attachFiles(files);
  };
  $('#histFilter').oninput = renderHistory;
  // engine/model/permission choices survive reloads
  try {
    // one-time migration: 'acceptEdits' was the old default, but headless hub
    // runs have no approval prompt, so it silently denied every Bash/MCP call
    // (the "phone can't change anything" bug). Stored copies of the old
    // default upgrade to the new one; an explicit re-pick after this sticks.
    if (localStorage.getItem('hub.permV2') !== '1') {
      if (localStorage.getItem('hub.perm') === 'acceptEdits') localStorage.setItem('hub.perm', 'bypassPermissions');
      localStorage.setItem('hub.permV2', '1');
    }
    const m = localStorage.getItem('hub.model'), p = localStorage.getItem('hub.perm');
    if (m !== null) $('#runModel').value = m;
    if (p !== null) $('#runPerm').value = p;
    $('#runEngine').value = localStorage.getItem('hub.engine') === 'hermes' ? 'hermes' : 'claude';
    $('#runRecall').checked = localStorage.getItem('hub.recall') === '1'; // default OFF
    $('#jarvisToggle').checked = localStorage.getItem('hub.jarvis') === '1'; // default OFF
  } catch {}
  applyEngineUI();
  gateHermesEngine();
  initJarvis();
  $('#runEngine').onchange = e => { try { localStorage.setItem('hub.engine', e.target.value); } catch {} applyEngineUI(); };
  $('#runModel').onchange = e => { try { localStorage.setItem('hub.model', e.target.value); } catch {} updateJarvisStatus(); };
  $('#runPerm').onchange = e => { try { localStorage.setItem('hub.perm', e.target.value); } catch {} };
  $('#runRecall').onchange = e => { try { localStorage.setItem('hub.recall', e.target.checked ? '1' : '0'); } catch {} };
  $('#jarvisToggle').onchange = e => { try { localStorage.setItem('hub.jarvis', e.target.checked ? '1' : '0'); } catch {} initJarvis(); };
}

// hermes is a deprecated paid stack, OFF by default. Reveal the engine option
// only when Config re-enables it; otherwise force the composer to Claude so a
// stale localStorage choice can't keep firing paid hermes runs.
async function gateHermesEngine() {
  let on = false;
  try { on = (await api('/api/settings')).hermesEnabled === true; } catch {}
  const opt = $('#hermesOpt');
  if (opt) opt.hidden = !on;
  if (!on && $('#runEngine') && $('#runEngine').value === 'hermes') {
    $('#runEngine').value = 'claude';
    try { localStorage.setItem('hub.engine', 'claude'); } catch {}
    applyEngineUI();
  }
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
  await renderUsageGauge();
  await refreshHistory();
};
renderers.run.noSkeleton = true; // never wipe an in-flight chat with a skeleton

function prefillRun(text) {
  goTab('run');
  ensureRunUI();
  $('#promptIn').value = text;
  $('#promptIn').focus();
}

// Bind (or clear) the Run tab to a Project — its instructions + project-scoped
// memory ride every prompt sent from here (see lib/runs.js projectId handling).
// Called by the Projects tab's "Start a chat in this project" button.
let runProject = null;
function bindRunProject(p) {
  runProject = p && p.id ? p : null;
  ensureRunUI();
  const tag = $('#runProjectTag');
  if (!tag) return;
  if (runProject) {
    tag.textContent = '▤ ' + runProject.name;
    tag.classList.remove('hidden');
    tag.onclick = () => bindRunProject(null);
  } else { tag.classList.add('hidden'); tag.onclick = null; }
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
      if (b.type === 'text' && b.text && b.text.trim()) {
        chat.lastText = b.text.trim(); addEl(mdToHtml(chat.lastText), 'msg assistant');
        // live runs only (never history replays): voice the reply as it streams
        if (chat.running && window.HubVoice && HubVoice.onAssistantText) HubVoice.onAssistantText(chat.lastText);
      }
      else if (b.type === 'tool_use') {
        // hermes ACP tool calls carry a human title in input.title; prefer it
        const summ = (b.input && b.input.title) ? b.input.title : excerpt(b.input || {}, 90);
        const el = addEl(`<details><summary>⚒ ${esc(b.name || 'tool')} <span class="muted">${esc(summ)}</span></summary>
          <pre>${esc(JSON.stringify(b.input || {}, null, 2))}</pre></details>`, 'toolblk');
        if (b.id) toolEls[b.id] = el.querySelector('pre');
        chat.hermesEl = null; // a tool block ends the current hermes text bubble
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
    const tok = o.usage ? `${(o.usage.input_tokens || 0) + (o.usage.cache_read_input_tokens || 0) + (o.usage.cache_creation_input_tokens || 0)}→${o.usage.output_tokens || 0} tok` : '';
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
  if (o.type === 'hermes_out' || o.type === 'hermes_text') {
    // hermes agent text — grow into ONE assistant bubble. -z (hermes_out) sent
    // whole lines; ACP (hermes_text) sends streaming chunks, so concatenate raw
    // for chunks and newline-join for legacy lines.
    if (!chat.hermesEl || !chat.hermesEl.isConnected) { chat.hermesEl = addEl('', 'msg assistant'); chat.hermesText = ''; }
    chat.hermesText += o.type === 'hermes_text' ? o.text : ((chat.hermesText ? '\n' : '') + o.text);
    chat.hermesEl.innerHTML = mdToHtml(chat.hermesText);
    chat.lastText = chat.hermesText.trim(); // feeds voice talk-back like claude runs
    return null;
  }
  if (o.type === 'hermes_thought') { // ACP agent_thought_chunk — dim, ambient
    addEl(`<span class="logdot">💭</span> ${esc(o.text)}`, 'logline thought');
    return null;
  }
  if (o.type === 'hermes_plan') { // ACP plan update — render as a checklist
    const rows = (o.entries || []).map(e => {
      const icon = e.status === 'completed' ? '✅' : (e.status === 'in_progress' ? '🔄' : '⏳');
      return `${icon} ${esc(e.content || '')}`;
    }).join('<br>');
    if (rows) addEl(`<b>plan</b><br>${rows}`, 'msg sys planblk');
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
  chat.hb = null; chat.lastActivity = Date.now(); chat.lastText = ''; // reset so a text-less run never speaks the previous reply
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

// ---- pasted/dropped/picked attachments (images + documents) ----
// Uploaded to data/inbox/pasted/ so the run can reference their absolute paths;
// held here until the next Send, then cleared. Images keep a thumbnail; other
// files show as a named chip. The run engine tells Claude to Read each path.
chat.pendingFiles = [];
async function attachFiles(files) {
  for (const file of files) {
    const isImage = (file.type || '').startsWith('image/');
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e4);
    // Keep a readable, sanitized name for non-images; stamp-prefix so repeat
    // names don't collide in the shared pasted/ folder.
    const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
    const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const outName = isImage ? `paste-${stamp}.${ext}` : `${stamp}-${safe}`;
    const named = new File([file], outName, { type: file.type || 'application/octet-stream' });
    const fd = new FormData(); fd.append('file', named);
    const chip = { name: file.name || outName, url: isImage ? URL.createObjectURL(file) : null, ref: null, pending: true, isImage };
    chat.pendingFiles.push(chip);
    renderAttachStrip();
    try {
      const r = await api('/api/files?project=pasted&overwrite=1', { method: 'POST', body: fd, timeoutMs: 120000 });
      const saved = r && r.saved && r.saved[0];
      // ref = absolute path when the server sends it, else the inbox-relative
      // name (older servers). Either form the run engine resolves under the inbox.
      const ref = saved && (saved.path || saved.name);
      if (ref) { chip.ref = ref; chip.pending = false; }
      else throw new Error((r && r.error) || 'upload failed');
    } catch (e) {
      chat.pendingFiles = chat.pendingFiles.filter(c => c !== chip);
      addMsg('Attach failed: ' + (e.message || 'upload error'), 'errmsg');
    }
    renderAttachStrip();
  }
}
function removeFile(i) {
  const c = chat.pendingFiles[i];
  if (c) { try { if (c.url) URL.revokeObjectURL(c.url); } catch {} chat.pendingFiles.splice(i, 1); }
  renderAttachStrip();
}
function renderAttachStrip() {
  const el = $('#attachStrip'); if (!el) return;
  const items = chat.pendingFiles;
  el.classList.toggle('hidden', !items.length);
  el.innerHTML = items.map((c, i) => c.isImage
    ? `<span class="attachchip${c.pending ? ' pending' : ''}"><img src="${c.url}" alt="">`
      + `<button class="x" onclick="removeFile(${i})" title="remove">✕</button></span>`
    : `<span class="attachchip file${c.pending ? ' pending' : ''}" title="${esc(c.name)}">`
      + `<span class="ficon">📄</span><span class="fname">${esc(c.name)}</span>`
      + `<button class="x" onclick="removeFile(${i})" title="remove">✕</button></span>`).join('');
}

// ---- live run flow ----
async function sendPrompt() {
  const ta = $('#promptIn');
  let prompt = ta.value.trim();
  if (chat.running || chat.sending) return; // sending = mid-distill (async gap below)
  // Attachments: block while any is still uploading; allow an attachment-only
  // send by supplying a default instruction.
  if (chat.pendingFiles.some(c => c.pending)) { addMsg('Still uploading an attachment — try again in a moment.', 'sys'); return; }
  const atts = chat.pendingFiles.filter(c => c.ref);
  const imgs = atts.filter(c => c.isImage);
  const docs = atts.filter(c => !c.isImage);
  if (!prompt && !atts.length) return;
  if (!prompt && atts.length) {
    const noun = imgs.length && !docs.length ? ('image' + (imgs.length > 1 ? 's' : '')) : ('file' + (atts.length > 1 ? 's' : ''));
    prompt = 'Take a look at the attached ' + noun + '.';
  }
  const engine = $('#runEngine') ? $('#runEngine').value : 'claude';

  // Jarvis mode: buffer prompt + auto-route model. When Jarvis rewrites the
  // prompt we show YOUR words in the user bubble and, right under it, a note
  // with the exact distilled prompt Jarvis actually sent. That note is a 'sys'
  // line — the ONE Jarvis-authored output that is shown but never spoken (the
  // voice queue only ever reads assistant text + the final reply, never 'sys').
  // Jarvis mode. QoL: the refined prompt BECOMES the visible turn (white text) —
  // no separate raw-words bubble + yellow note. And a word-count gate decides how
  // hard to work: long vibe-dumps go through the real Haiku distiller; short ones
  // get only the instant local cleanup (nothing to engineer, no point paying the
  // latency). The distilled/cleaned text is exactly what runs, so what you see is
  // what fires.
  let displayPrompt = prompt;
  const jarvisToggle = $('#jarvisToggle');
  if (jarvisToggle && jarvisToggle.checked && engine === 'claude') {
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    if (wordCount > DISTILL_MIN_WORDS) {
      // Haiku pre-pass takes a couple seconds — show a status + block re-sends.
      const btn = $('#sendBtn'), label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '✦ Shaping…'; }
      chat.sending = true;
      const refined = await jarvisDistill(prompt);
      chat.sending = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (chat.running) return; // a run slipped in while we were distilling
      if (refined) { displayPrompt = prompt = refined; }
      else { const tr = jarvisTransform(prompt); if (tr) displayPrompt = prompt = tr.buffered; } // distill miss → local cleanup
    } else {
      const tr = jarvisTransform(prompt); if (tr) displayPrompt = prompt = tr.buffered;
    }
    // If the user hasn't pinned a model, route on the (now refined) prompt.
    const userModel = $('#runModel').value;
    if (userModel === 'auto' || userModel === '') $('#runModel').value = analyzePromptComplexity(prompt);
  }

  let r;
  try {
    r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, engine, model: $('#runModel').value, permissionMode: $('#runPerm').value,
        resume: engine === 'hermes' ? '' : (chat.sessionId || ''), recall: $('#runRecall').checked,
        projectId: (runProject && runProject.id) || '', images: imgs.map(c => c.ref), files: docs.map(c => c.ref) }) });
  } catch (e) { addMsg('Run failed to start: ' + (e.message || 'network error'), 'errmsg'); return; }
  if (r.error) { addMsg(r.error, 'errmsg'); return; }
  ta.value = '';
  addMsg(displayPrompt, 'user');
  if (atts.length) {
    if (imgs.length) addEl(imgs.map(c => `<img src="${c.url}" alt="attached image">`).join(''), 'msg user attachimgs');
    if (docs.length) addMsg('📎 ' + docs.map(c => c.name).join(', '), 'sys');
    chat.pendingFiles = []; renderAttachStrip();
  }
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
  renderUsageGauge(); // refresh usage after run completes
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
