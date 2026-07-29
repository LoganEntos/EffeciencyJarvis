/* Projects tab — inline run creation + live SSE streaming, mounted into the
   project detail view. Adapted directly from jarvischat.js: same SSE loop,
   same jmsg bubble language (reuses jarvis.css's global .jmsg/.jconv/.jchat-row
   rules so it reads as one more instrument panel, not a bolted-on widget), same
   disable/enable-on-send/done/error dance. Differences: payload carries
   projectId so lib/runs.js auto-injects this project's instructions + a file
   manifest + engram memory (no client-side re-injection; file contents are
   never inlined — Claude reads files itself via the manifest's absolute
   paths); a history strip up top seeds
   from /api/projects/get; state survives remounts of the SAME project (the
   caller re-renders the whole detail view on `done`, which would otherwise
   wipe the transcript out from under the user right as the reply lands). */
'use strict';
(function () {
  const S = { es: null, running: false, sending: false, runId: null, seen: -1, sessionId: null,
    bubbleEntry: null, buf: '', project: null, log: [], model: 'auto', distill: false, distilling: false };
  // Swap send↔stop in the composer while a run is live.
  function setRunningUI(on) {
    const send = $('#pchatSend'), stop = $('#pchatStop');
    if (send) { send.disabled = on; send.classList.toggle('hidden', on); }
    if (stop) stop.classList.toggle('hidden', !on);
  }
  async function cancel() {
    if (!S.runId) return;
    try { await api('/api/run/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: S.runId }) }); } catch {}
  }
  const timeOf = iso => { try { return new Date(iso).toLocaleTimeString(undefined, { hour12: false }); } catch { return ''; } };

  // Per-project composer prefs live in localStorage under hub.proj.<id>.<key>.
  const MODELS = ['auto', 'opus', 'sonnet', 'haiku'];
  const lsKey = (id, k) => `hub.proj.${id}.${k}`;
  function loadPrefs(id) {
    let m = 'auto', d = false;
    try { m = localStorage.getItem(lsKey(id, 'model')) || 'auto'; } catch {}
    try { d = localStorage.getItem(lsKey(id, 'distill')) === '1'; } catch {}
    S.model = MODELS.includes(m) ? m : 'auto';
    S.distill = d;
  }
  const savePref = (k, v) => { if (S.project) { try { localStorage.setItem(lsKey(S.project.id, k), v); } catch {} } };

  function jmsgHtml(kind, textHtml) {
    const av = kind === 'user' ? `<div class="java user">you</div>`
      : kind === 'tool' ? `<div class="java assistant">⚒</div>`
      : `<div class="java assistant">◉</div>`;
    const who = kind === 'user' ? 'you' : (kind === 'tool' ? 'tool' : 'claude');
    return `${av}<div class="jmsg-body">
      <div class="jmsg-meta">${esc(who)} · ${esc(timeOf(new Date().toISOString()))}</div>
      <div class="jmsg-text">${textHtml}</div></div>`;
  }
  // Entries are {cls, build()} so the transcript can be fully rebuilt from
  // module state when the detail view re-renders and hands us a fresh
  // container — the DOM dies, S.log doesn't.
  function convAppend(cls, build, scroll) {
    const entry = { cls, build };
    S.log.push(entry);
    renderEntry(entry, scroll !== false);
    return entry;
  }
  function renderEntry(entry, scroll) {
    const feed = $('#pchatConv'); if (!feed) return null;
    const stick = scroll && (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80);
    const wrap = document.createElement('div');
    wrap.className = entry.cls;
    wrap.innerHTML = entry.build();
    feed.appendChild(wrap);
    entry.el = wrap;
    if (stick) feed.scrollTop = feed.scrollHeight;
    return wrap;
  }
  function updateEntry(entry) {
    if (!entry) return;
    if (entry.el) entry.el.innerHTML = entry.build();
    const feed = $('#pchatConv');
    if (feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200) feed.scrollTop = feed.scrollHeight;
  }
  function addAssistantBubble(shimmerLabel) {
    const state = { text: '', streaming: true, raw: `<span class="jshimmer">${esc(shimmerLabel)}</span>` };
    const entry = convAppend('jmsg assistant', () => jmsgHtml('assistant',
      state.raw != null ? state.raw
        : ((typeof mdToHtml === 'function' ? mdToHtml(state.text) : esc(state.text)) + (state.streaming ? '<span class="jcaret">▍</span>' : ''))));
    entry.state = state;
    return entry;
  }
  function setBubble(text, streaming) {
    const entry = S.bubbleEntry; if (!entry || !entry.state) return;
    entry.state.raw = null; entry.state.text = text; entry.state.streaming = streaming;
    updateEntry(entry);
  }
  function renderLine(o) {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'system' && o.subtype === 'init' && o.session_id) S.sessionId = o.session_id;
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text) {
          S.buf = (S.buf ? S.buf + '\n\n' : '') + b.text.trim();
          setBubble(S.buf, true);
        } else if (b.type === 'tool_use') {
          const summ = (b.input && b.input.title) ? b.input.title : (b.name || 'tool');
          convAppend('jmsg tool', () => jmsgHtml('tool', `⚒ ${esc(b.name || 'tool')} · <span class="dim">${esc(summ)}</span>`));
          S.buf = '';
          S.bubbleEntry = addAssistantBubble('working…');
        }
      }
    }
    if (o.type === 'result') {
      const secs = o.duration_ms ? (o.duration_ms / 1000).toFixed(1) + 's' : '';
      const ok = o.subtype === 'success';
      convAppend('jmsg result', () => `<div class="jmsg-meta">${ok ? '✓ done' : '✗ ' + esc(o.subtype || 'error')} ${esc(secs)}</div>`);
    }
  }

  function histPill(r) {
    const tok = (r.tokensIn || r.tokensOut) ? fmtTok((r.tokensIn || 0) + (r.tokensOut || 0)) : '—';
    const when = r.startedAt ? rel(r.startedAt) : '';
    return `<div class="pchat-hpill" data-id="${esc(r.id)}" title="${esc(r.prompt || '')}">
      <span class="pill neutral" style="margin:0">${esc(r.model)}</span>
      <span class="pchat-hwhen">${esc(when)}</span>
      <span class="pchat-htok">${tok}</span>
      <span class="pchat-hprompt">${esc((r.prompt || '').slice(0, 80))}</span></div>`;
  }
  // preRuns lets a caller that already fetched the project feed the strip
  // without a second round-trip (see refreshAfterRun).
  async function loadHistory(preRuns) {
    const host = $('#pchatHist'); if (!host || !S.project) return;
    let runs = preRuns;
    if (!runs) {
      let d;
      try { d = await api('/api/projects/get?runsOnly=1&id=' + encodeURIComponent(S.project.id)); }
      catch { host.innerHTML = ''; return; }
      runs = (d && d.runs) || [];
    }
    const resuming = S.sessionId ? `<span class="pchat-resuming" title="Next message continues this thread"><span class="dim">↺ resuming</span> ${esc((S.runId || '').slice(0,8))}</span>` : '';
    host.innerHTML = (runs.length ? runs.slice(0, 8).map(histPill).join('')
      : '<span class="muted" style="font-size:11px">no runs yet — send the first message below</span>') + resuming;
    host.querySelectorAll('.pchat-hpill[data-id]').forEach(p => p.onclick = () => openThread(p.dataset.id));
  }
  // After a run ends: ONE /api/projects/get feeds both the history strip and
  // the runs table (each used to fetch the full project payload separately).
  async function refreshAfterRun() {
    if (!S.project) return;
    let d; try { d = await api('/api/projects/get?runsOnly=1&id=' + encodeURIComponent(S.project.id)); } catch { return; }
    if (!d || d.error) return;
    loadHistory(d.runs || []);
    if (typeof refreshProjectRuns === 'function') refreshProjectRuns(S.project.id, d.runs || []);
  }

  // Load a past run into THIS panel: replay its transcript, set sessionId so
  // the next send resumes the same CLI session instead of starting fresh.
  async function openThread(runId) {
    if (S.running) return;
    let t;
    try { t = await api('/api/run/transcript?id=' + encodeURIComponent(runId), { timeoutMs: 30000 }); }
    catch (e) { const f = $('#pchatConv'); if (f) f.innerHTML = '<div class="jmsg-meta" style="color:var(--danger,#c66)">failed to load thread: ' + esc(e.message || 'network error') + '</div>'; return; }
    if (t.error) { const f = $('#pchatConv'); if (f) f.innerHTML = '<div class="jmsg-meta" style="color:var(--danger,#c66)">' + esc(t.error) + '</div>'; return; }
    // reset panel state, keep project
    S.log = []; S.buf = ''; S.bubbleEntry = null; S.sessionId = null; S.runId = runId; S.seen = -1;
    const feed = $('#pchatConv'); if (feed) feed.innerHTML = '';
    // A run only resumes if its transcript carried a CLI sessionId. When it
    // didn't, this is a read-only replay and the next message would silently
    // start fresh — say so plainly instead of implying continuity.
    const resumable = !!(t.meta && t.meta.sessionId);
    if (resumable) S.sessionId = t.meta.sessionId;
    const trunc = t.truncated ? ' · long transcript truncated' : '';
    convAppend('jmsg meta', () => `<div class="jmsg-meta">${resumable
      ? '↺ resuming run ' + esc(runId.slice(0, 8)) + ' · next message continues this thread'
      : '⟲ read-only replay of ' + esc(runId.slice(0, 8)) + ' · next message starts fresh'}${trunc}</div>`);
    if (t.prompt) convAppend('jmsg user', () => jmsgHtml('user', esc(t.prompt)));
    // Replay assistant/tool/result lines through renderLine so bubbles reuse
    // the same builder — S.bubbleEntry gets seeded so mid-turn tool blocks work.
    S.bubbleEntry = addAssistantBubble('replaying…');
    for (const line of (t.lines || [])) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      renderLine(o);
    }
    setBubble(S.buf || '(no reply captured)', false);
    loadHistory();
  }

  async function send() {
    const ta = $('#pchatIn'); if (!ta || !S.project) return;
    let prompt = ta.value.trim();
    if (!prompt || S.running || S.sending || S.distilling) return;
    const btn = $('#pchatSend');
    // ✦ distiller: a long vibe-dump gets a Haiku pre-pass (the same gate the Run
    // tab uses); short prompts get only the instant local cleanup. The refined
    // text BECOMES the visible turn, so what you see is what runs.
    if (S.distill && typeof jarvisDistill === 'function') {
      const words = prompt.split(/\s+/).filter(Boolean).length;
      if (words > (typeof DISTILL_MIN_WORDS === 'number' ? DISTILL_MIN_WORDS : 25)) {
        S.distilling = true;
        const label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '✦ Shaping…'; }
        const refined = await jarvisDistill(prompt);
        S.distilling = false;
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (S.running) return; // a send slipped in while we were distilling
        if (refined) prompt = refined;
        else if (typeof jarvisTransform === 'function') { const tr = jarvisTransform(prompt); if (tr) prompt = tr.buffered; }
      } else if (typeof jarvisTransform === 'function') {
        const tr = jarvisTransform(prompt); if (tr) prompt = tr.buffered;
      }
    }
    const feed = $('#pchatConv');
    if (feed && S.log.length === 0) feed.innerHTML = '';
    ta.value = ''; ta.style.height = 'auto'; S.buf = '';
    convAppend('jmsg user', () => jmsgHtml('user', esc(prompt)));
    S.bubbleEntry = addAssistantBubble('thinking…');
    if (btn) btn.disabled = true;
    let r;
    // Guard synchronously before the await — S.running only flips post-POST.
    S.sending = true;
    try {
      r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, engine: 'claude', model: S.model || 'auto', permissionMode: 'bypassPermissions',
          channel: 'screen', resume: S.sessionId || '', projectId: S.project.id }) });
    } catch (e) { S.sending = false; setBubble('✗ run failed to start: ' + (e.message || 'network error'), false); if (btn) btn.disabled = false; return; }
    if (r.error) { S.sending = false; setBubble('✗ ' + r.error, false); if (btn) btn.disabled = false; return; }
    S.running = true; S.sending = false; S.runId = r.id; S.seen = -1;
    setRunningUI(true);
    setBubble('', true);
    const es = new EventSource(`/api/run/stream?id=${encodeURIComponent(r.id)}`);
    S.es = es;
    es.addEventListener('line', ev => {
      const idx = parseInt(ev.lastEventId, 10);
      if (!isNaN(idx)) { if (idx <= S.seen) return; S.seen = idx; }
      let o; try { o = JSON.parse(ev.data); } catch { return; }
      renderLine(o);
    });
    es.addEventListener('done', ev => {
      es.close(); S.es = null; S.running = false;
      let meta = {}; try { meta = JSON.parse(ev.data); } catch {}
      if (meta.sessionId) S.sessionId = meta.sessionId;
      setBubble(S.buf || '(no reply)', false);
      setRunningUI(false);
      // Refresh ONLY the runs table + history strip in place — a full
      // renderProjectDetail() reloads files/memory/sessions and jumps scroll.
      refreshAfterRun();
    });
    // jarvischat's known bug: onerror only reset the button when !S.running,
    // so a mid-stream drop left "send" disabled forever. Always reset here.
    es.onerror = () => {
      if (S.es) { try { S.es.close(); } catch {} S.es = null; }
      if (S.running) { S.running = false; setBubble(S.buf || '✗ connection lost', false); }
      setRunningUI(false);
      refreshAfterRun();
    };
  }

  function newChat() {
    if (S.running) cancel(); // don't orphan a live run when starting fresh
    if (S.es) { try { S.es.close(); } catch {} S.es = null; }
    S.running = false; S.sending = false; S.runId = null; S.seen = -1; S.sessionId = null; S.bubbleEntry = null; S.buf = ''; S.log = [];
    const feed = $('#pchatConv'); if (feed) feed.innerHTML = '<div class="jmsg-meta" style="padding:4px">new conversation — the next message starts a fresh CLI session</div>';
    setRunningUI(false);
  }

  function wire() {
    const ta = $('#pchatIn');
    if (ta) {
      ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    }
    const sb = $('#pchatSend'); if (sb) sb.onclick = send;
    const nb = $('#pchatNew'); if (nb) nb.onclick = newChat;
    const st = $('#pchatStop'); if (st) st.onclick = cancel;
    setRunningUI(S.running);
    const ms = $('#pchatModel');
    if (ms) { ms.value = S.model; ms.onchange = () => { S.model = MODELS.includes(ms.value) ? ms.value : 'auto'; savePref('model', S.model); }; }
    const dt = $('#pchatDistill');
    if (dt) { dt.checked = S.distill; dt.onchange = () => { S.distill = dt.checked; savePref('distill', dt.checked ? '1' : '0'); }; }
  }

  function mount(container, project) {
    if (!container || !project) return;
    const sameProject = S.project && S.project.id === project.id;
    if (!sameProject) {
      if (S.es) { try { S.es.close(); } catch {} S.es = null; }
      S.running = false; S.runId = null; S.seen = -1; S.sessionId = null; S.bubbleEntry = null; S.buf = ''; S.log = [];
    }
    S.project = project;
    loadPrefs(project.id);
    container.innerHTML = `<div class="pchat-panel">
      <div class="pchat-hist" id="pchatHist"><span class="muted" style="font-size:11px">loading recent runs…</span></div>
      <div class="jconv pchat-conv" id="pchatConv"></div>
      <div class="jchat-row pchat-row">
        <textarea id="pchatIn" rows="1" placeholder="Ask Claude to work in this project… (Enter to send, Shift+Enter for newline)"></textarea>
        <label class="pchat-distill" title="✦ Distill — route long vibe-prompts through Haiku before running"><input type="checkbox" id="pchatDistill"> ✦</label>
        <select id="pchatModel" class="pchat-model" title="Model — auto routes by complexity">
          <option value="auto">auto</option><option value="opus">opus</option>
          <option value="sonnet">sonnet</option><option value="haiku">haiku</option></select>
        <button class="jp-ghost" id="pchatNew" title="Start a fresh CLI session">＋ new</button>
        <button class="jp-ghost danger hidden" id="pchatStop" title="Stop this run">■ stop</button>
        <button class="jp-btn" id="pchatSend">▷ Run in project</button>
      </div></div>`;
    const feed = $('#pchatConv');
    if (S.log.length) { S.log.forEach(e => renderEntry(e, false)); if (feed) feed.scrollTop = feed.scrollHeight; }
    else if (feed) feed.innerHTML = '<div class="jmsg-meta" style="padding:4px">start a chat below — instructions, a file manifest and project memory ride every message</div>';
    wire();
    loadHistory();
  }

  function destroy() {
    if (S.es) { try { S.es.close(); } catch {} S.es = null; }
  }

  window.projectChat = { mount, send, newChat, destroy };
})();
