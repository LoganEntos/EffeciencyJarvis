/* Run tab: a real chat with the claude CLI. POST /api/run spawns a print-mode
   run streaming stream-json; we render it as bubbles over SSE, persist history,
   and render run-produced artifacts (HTML/SVG/PNG) inline. */
'use strict';

const chat = { sessionId: null, runId: null, es: null, running: false, t0: 0, timer: null, seen: -1, probe: null, probeFails: 0 };
// renderUsageGauge() lives in assets/rungauge.js (loaded just before this file).

// The CLI session id is the only thread continuity there is, and app.js reloads
// the page whenever the per-boot X-Hub-Token goes stale (i.e. every hub
// restart) — which used to silently drop the thread and make the next prompt a
// cold session. Persist it so a reload rejoins the same conversation.
const RUN_SESS_KEY = 'hub.sess.run';
try { chat.sessionId = localStorage.getItem(RUN_SESS_KEY) || null; } catch {}

// Shown/hidden by clearComposer() (run-composer.js) and anything that changes
// the textarea or pendingFiles — re-queries fresh so it's safe to call from
// either file regardless of load order.
function updateTaClear() {
  const ta = $('#promptIn'), btn = $('#taClear');
  if (!ta || !btn) return;
  const hasAttach = chat.pendingFiles && chat.pendingFiles.length > 0;
  btn.classList.toggle('hidden', !(ta.value.trim() || hasAttach));
}

function ensureRunUI() {
  if ($('#chatLog')) return;
  $('#run').innerHTML = `
    <h2>Run — work with Claude in this project</h2>
    <div class="looprow" id="loopRow">
      <button id="loopBtn" class="loopbtn" aria-pressed="false"
        title="Arm the hub's unattended self-improvement loop — it picks the next open backlog item (or waiting task), runs it, and commits, checking every few minutes. Toggle it here without leaving the Run tab.">
        <span class="loopdot"></span><span class="looptxt">AUTONOMOUS LOOP</span></button>
      <span class="pill neutral" id="loopState">off</span>
      <button class="ghost" id="loopNow" title="Run a loop check right now" style="padding:5px 11px;font-size:11px">▶ Check now</button>
      <span class="loopmeta muted" id="loopMeta"></span>
    </div>
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
      <select id="runEffort" title="effort — the five Fable-5-era utilization tiers (claude --effort). Tier 5 'Ultra Code' (max) = deepest reasoning + longest turns; default lets the CLI decide. Sticks across reloads.">
        <option value="">effort: CLI default</option>
        <option value="low">effort 1 · low</option>
        <option value="medium">effort 2 · medium</option>
        <option value="high">effort 3 · high</option>
        <option value="xhigh">effort 4 · xhigh</option>
        <option value="max">effort 5 · ULTRA CODE</option>
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
      <div class="ta-wrap">
        <textarea id="promptIn" placeholder="Ask Claude to do something in this project… (paste, drop, or 📎 attach files)"></textarea>
        <button id="taClear" class="taClear hidden" type="button" title="Clear everything in the box" aria-label="Clear prompt">✕</button>
      </div>
      <input type="file" id="fileIn" multiple hidden>
      <div class="btns">
        <button id="micBtn" title="Dictate your prompt — click, speak, click again to stop. Chrome/Edge only.">🎤 Speak</button>
        <button id="attachBtn" class="ghost" title="Attach files to this run">📎 Attach</button>
        <button id="rereadBtn" class="ghost" title="Read the last reply aloud again">↻ Read again</button>
        <button id="sendBtn">Send ▷</button>
        <button id="cancelBtn" class="danger hidden">Cancel ✕</button>
      </div>
    </div>
    <details class="histSection" id="histSection" style="margin-top:30px">
      <summary>Run history <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click a run to replay it</span></summary>
      <div class="histbody">
        <div class="flex" id="histStats" style="margin:12px 0"></div>
        <input class="search" id="histFilter" placeholder="Filter runs by prompt…">
        <div id="runHistory"><div class="muted">Loading…</div></div>
      </div>
    </details>`;
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
  // Mic dictation + the AUTONOMOUS LOOP override live in run-composer.js so this
  // file stays under the 500-line cap.
  $('#micBtn').onclick = () => runComposer.toggleDictation();
  $('#loopBtn').onclick = () => runComposer.toggleLoop();
  $('#loopNow').onclick = () => runComposer.loopCheckNow();
  runComposer.refreshLoop();
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
  // Clear-box control: an explicit way to wipe the composer (text + any
  // pending attachments) without select-all/backspace — visible only when
  // there's actually something to clear.
  ta.oninput = updateTaClear;
  $('#taClear').onclick = () => runComposer.clearComposer();
  updateTaClear();
  const comp = ta.closest('.composer');
  comp.ondragover = e => { e.preventDefault(); comp.classList.add('drag'); };
  comp.ondragleave = () => comp.classList.remove('drag');
  comp.ondrop = e => {
    e.preventDefault(); comp.classList.remove('drag');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) attachFiles(files);
  };
  $('#histFilter').oninput = renderHistory;
  // Collapsed by default so token-usage-heavy history doesn't dominate the
  // tab; remembers the user's last open/closed choice.
  const histSection = $('#histSection');
  try { histSection.open = localStorage.getItem('hub.histOpen') === '1'; } catch {}
  histSection.ontoggle = () => { try { localStorage.setItem('hub.histOpen', histSection.open ? '1' : '0'); } catch {} };
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
    const ef = localStorage.getItem('hub.effort');
    if (ef !== null) $('#runEffort').value = ef;
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
  $('#runEffort').onchange = e => { try { localStorage.setItem('hub.effort', e.target.value); } catch {} };
  $('#runRecall').onchange = e => { try { localStorage.setItem('hub.recall', e.target.checked ? '1' : '0'); } catch {} };
  $('#jarvisToggle').onchange = e => { try { localStorage.setItem('hub.jarvis', e.target.checked ? '1' : '0'); } catch {} initJarvis(); };
  // A session restored from localStorage outlives the transcript (which is
  // memory-only), so re-arm the badge and say the thread is still live —
  // otherwise an empty log after a reload reads as a silent reset.
  if (chat.sessionId) {
    setSession(chat.sessionId);
    addMsg(`⟲ resuming CLI session ${chat.sessionId.slice(0, 8)}… — earlier turns aren't shown here, but Claude still has them. Press ＋ new chat for a clean thread.`, 'sys');
  }
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

renderers.run = async function () {
  ensureRunUI();
  if (window.runThreads) runThreads.tick(true); // other-active-threads strip — assets/run-threads.js
  await renderUsageGauge();
  await refreshHistory();
};
renderers.run.noSkeleton = true; // never wipe an in-flight chat with a skeleton

function prefillRun(text) {
  goTab('run');
  ensureRunUI();
  $('#promptIn').value = text;
  $('#promptIn').focus();
  updateTaClear();
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

// ---- composer send + attachments ----
// sendPrompt() and the attachment block (attachFiles/removeFile/
// renderAttachStrip, chat.pendingFiles) live in assets/run-composer.js
// (loaded right after this file — it needs `chat` declared above).

// ---- live run flow ----
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
    // Claim the session id from the INIT event, not just the terminal result:
    // a cancel/stream-drop/restart never emits `result`, and waiting for it left
    // the whole thread unresumable (every cancelled run has sessionId=null).
    if (o.type === 'system' && o.subtype === 'init' && o.session_id) setSession(o.session_id);
    const result = renderLine(o);
    if (result && result.session_id) setSession(result.session_id);
  });
  es.addEventListener('heartbeat', e => {
    try { chat.hb = JSON.parse(e.data); } catch { return; }
    renderRunStatus();
  });
  es.addEventListener('done', async e => {
    es.close(); chat.es = null;
    clearProbe();
    let meta = {}; try { meta = JSON.parse(e.data); } catch {}
    // Sleep safeguard: the server auto-resumed this dead run (connection loss /
    // context cutoff) — follow the continuation instead of showing a dead thread.
    if (meta.continuedBy && chat.running) { followContinuation(meta); return; }
    if (meta.sessionId) setSession(meta.sessionId);
    finishRun(meta);
    await showArtifacts(id);
    renderDelegations(id); // any subagents this run dispatched, once it's finished
    refreshHistory();
  });
  // A dropped stream is NOT a dead run: EventSource auto-reconnects and the
  // server replays via Last-Event-ID (the line handler dedupes). Screen-off /
  // sleep used to land here and insta-kill the thread as "connection lost".
  // Now: keep the stream retrying, show "reconnecting", and probe run state as
  // a backstop — only a probe that says the run truly ended (or a hub that
  // stays unreachable ~5min) finishes the UI.
  es.onopen = () => { clearProbe(); chat.probeFails = 0; };
  es.onerror = () => {
    if (!chat.running) { if (chat.es) { try { chat.es.close(); } catch {} chat.es = null; } return; }
    const el = $('#runStatus');
    if (el) el.innerHTML = '<span class="pill warn">reconnecting…</span>';
    if (!chat.probe) chat.probe = setTimeout(() => probeRun(id), 8000);
  };
}

function clearProbe() { if (chat.probe) { clearTimeout(chat.probe); chat.probe = null; } }

// Backstop while the stream is down: ask the hub what the run's real status is.
// Still running → keep waiting (the ES retry will replay everything missed).
// Ended → finish with the REAL meta; ended-and-continued → follow the chain.
async function probeRun(id) {
  chat.probe = null;
  if (!chat.running || chat.runId !== id) return;
  let meta = null;
  try {
    const rows = await api('/api/runs');
    meta = (Array.isArray(rows) ? rows : []).find(r => r.id === id) || null;
    chat.probeFails = 0;
  } catch {
    if (++chat.probeFails >= 40) { // hub gone ~5min — give up honestly
      if (chat.es) { try { chat.es.close(); } catch {} chat.es = null; }
      finishRun({ id, status: 'connection lost' });
      return;
    }
  }
  if (meta && meta.status !== 'running' && meta.status !== 'queued') {
    if (chat.es) { try { chat.es.close(); } catch {} chat.es = null; }
    if (meta.continuedBy) { followContinuation(meta); return; }
    if (meta.sessionId) setSession(meta.sessionId);
    finishRun(meta);
    await showArtifacts(id);
    renderDelegations(id);
    refreshHistory();
    return;
  }
  chat.probe = setTimeout(() => probeRun(id), 8000);
}

// The server auto-resumed a dead run (lib/runs.js continueRun) — hop this
// chat onto the continuation run so the thread just keeps going.
function followContinuation(meta) {
  renderLine({ type: 'hub_status', text: `⟲ ${meta.connLost ? 'connection lost mid-run (machine slept?)' : 'run was cut off'} — auto-resumed, continuing in run ${meta.continuedBy}` });
  chat.runId = meta.continuedBy;
  chat.seen = -1; // fresh run, line ids restart at 0
  attachStream(meta.continuedBy);
  refreshHistory();
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
  try { sid ? localStorage.setItem(RUN_SESS_KEY, sid) : localStorage.removeItem(RUN_SESS_KEY); } catch {}
  const b = $('#chatSession');
  if (!b) return;
  if (!sid) { b.classList.add('hidden'); return; }
  b.textContent = '⟲ resumes ' + sid.slice(0, 8) + '…';
  b.classList.remove('hidden');
}

function newChat() {
  if (chat.es) { chat.es.close(); chat.es = null; }
  clearInterval(chat.timer); chat.timer = null;
  setSession(null); chat.runId = null; chat.running = false; chat.seen = -1;
  chat.hermesEl = null; chat.hermesText = '';
  $('#chatSession').classList.add('hidden');
  $('#runStatus').innerHTML = '';
  $('#sendBtn').disabled = false;
  $('#cancelBtn').classList.add('hidden');
  $('#chatLog').innerHTML = '<div class="msg sys">New conversation — the next prompt starts a fresh CLI session.</div>';
  // Drop tool_use→<pre> refs; #chatLog was just replaced, so keeping them
  // pins detached DOM (unbounded leak over a long multi-run session). C67.
  for (const k in toolEls) delete toolEls[k];
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
  renderDelegations(id); // aggregated subagent dispatches, above the transcript (fire-and-forget)
  if (t.prompt) addMsg(t.prompt, 'user');
  for (const line of t.lines || []) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    renderLine(o);
  }
  appendProjectFilesToggle(t.meta); // no-op when unbound/undefined/no anchor line — see runrender.js
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
