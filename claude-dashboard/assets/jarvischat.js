/* Jarvis tab — in-tab live chat. Own /api/run + SSE. Streams assistant text
   into #jconv as a growing bubble with a ▍ caret, renders tool_use blocks,
   and resumes the CLI session across turns. #jconv is this module's alone —
   the session-tail poller in jarvistab.js renders into a separate #jactBody
   strip, so the two never clobber each other. Split out of jarvistab.js to
   keep both files under the 500-line cap; talks to jarvistab via
   window.jarvisHooks (refresh holding grid) and window.jarvisTimeline
   (redraw the thread-timeline dots after each turn), reads window.jarvisThink
   (the ◐ think toggle, one-shot), and talks to assets/jarvisattach.js
   (pending file chips → images/files refs on the run payload). */
'use strict';
(function () {
  // S.log mirrors every #jconv entry so the transcript survives a tab re-render
  // (renderers.jarvis blows away #jarvis wholesale) — same shape projectchat.js
  // already uses. S.bubbleIdx is the log slot the streaming bubble writes into,
  // so a replay can re-point S.bubble at the live element.
  const S = { es: null, running: false, sending: false, runId: null, seen: -1, sessionId: null,
    bubble: null, bubbleIdx: -1, activityIdx: -1, buf: '', turnCount: 0, log: [] };
  const recallOn = () => { try { return localStorage.getItem('hub.recall') === '1'; } catch { return false; } };
  // The CLI session id is the ONLY thread continuity we have, and the page
  // reloads itself on a stale per-boot token (app.js) — so a hub restart used to
  // silently start every following prompt from scratch. Persist it.
  const SESS_KEY = 'hub.sess.jarvis';
  function setSessionId(sid) {
    S.sessionId = sid || null;
    try { sid ? localStorage.setItem(SESS_KEY, sid) : localStorage.removeItem(SESS_KEY); } catch {}
  }
  try { S.sessionId = localStorage.getItem(SESS_KEY) || null; } catch {}
  const timeOf = iso => { try { return new Date(iso).toLocaleTimeString(undefined, { hour12: false }); } catch { return ''; } };

  // ---- session badge (panel header): short id when resumed, a plain status
  // note when fresh. This is a read-only status pill — NOT a control. It used
  // to read "＋ new" in the fresh state, which duplicated the working "＋ new"
  // button in the composer row (#jchatNew, wired below) with no click handler
  // of its own. Keep the label unambiguously non-actionable so there's only
  // one "start a fresh session" affordance.
  function renderSessBadge() {
    const el = $('#jsessBadge'); if (!el) return;
    if (S.sessionId) {
      el.textContent = 'sess · ' + S.sessionId.slice(0, 8);
      el.title = 'resumed CLI session ' + S.sessionId;
      el.classList.add('on');
    } else {
      el.textContent = 'no session yet';
      el.title = 'fresh CLI session — the next prompt starts it';
      el.classList.remove('on');
    }
  }

  // Mount log slot i into #jconv. Every visible entry goes through here so a
  // replay after a re-render reproduces the feed exactly.
  function mountEntry(i) {
    const feed = $('#jconv'); if (!feed) return null;
    const e = S.log[i]; if (!e) return null;
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const wrap = document.createElement('div');
    wrap.className = e.cls;
    wrap.innerHTML = e.html;
    wrap.dataset.logi = String(i);
    feed.appendChild(wrap);
    if (stick) feed.scrollTop = feed.scrollHeight;
    return wrap;
  }
  function jconvAppend(html, cls) {
    S.log.push({ html, cls: cls || 'jmsg' });
    return mountEntry(S.log.length - 1);
  }
  // Rebuild the whole feed from S.log — called on every mount (wire()), which
  // is what makes a Jarvis-tab re-render non-destructive.
  function replayLog() {
    const feed = $('#jconv'); if (!feed) return;
    if (!S.log.length) return;             // nothing to restore; keep the placeholder
    feed.innerHTML = '';
    let live = null;
    for (let i = 0; i < S.log.length; i++) {
      const el = mountEntry(i);
      if (i === S.bubbleIdx) live = el;
    }
    if (live) S.bubble = live;             // re-point the streaming bubble
    feed.scrollTop = feed.scrollHeight;
  }
  function jmsgHtml(kind, textHtml) {
    const av = kind === 'user' ? `<div class="java user">you</div>`
      : kind === 'tool' ? `<div class="java assistant">⚒</div>`
      : `<div class="java assistant">◉</div>`;
    const who = kind === 'user' ? 'you' : (kind === 'tool' ? 'tool' : 'jarvis');
    return `${av}<div class="jmsg-body">
      <div class="jmsg-meta">${esc(who)} · ${esc(timeOf(new Date().toISOString()))}</div>
      <div class="jmsg-text">${textHtml}</div></div>`;
  }
  // Append an assistant bubble AND remember which log slot it owns, so streamed
  // text keeps updating the right entry across a re-render.
  function openBubble(html) {
    S.bubble = jconvAppend(jmsgHtml('assistant', html), 'jmsg assistant');
    S.bubbleIdx = S.log.length - 1;
    return S.bubble;
  }
  function setBubble(text, streaming) {
    const b = S.bubble; if (!b) return;
    const body = b.querySelector('.jmsg-text');
    // mdToHtml is defined in run.js and loaded before this file; fall back to
    // an escaped plain-text render if it's ever missing.
    const html = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text);
    if (body) body.innerHTML = html + (streaming ? '<span class="jcaret">▍</span>' : '');
    // Mirror the rendered bubble back into the log so a replay shows the reply,
    // not the "thinking…" shimmer it started as.
    if (S.bubbleIdx >= 0 && S.log[S.bubbleIdx]) S.log[S.bubbleIdx].html = b.innerHTML;
    const feed = $('#jconv');
    if (feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200) feed.scrollTop = feed.scrollHeight;
  }
  // One activity indicator per run (not per tool call) — a long agentic turn
  // routinely calls dozens of tools, and appending a fresh "⚒ tool" line +
  // fresh "working…" bubble for EACH one used to bury the user's own message
  // under a wall of near-identical entries within seconds. This grows in
  // place instead: collapsed shows a live count + the latest tool name,
  // expand (click, delegated in wire()) reveals the full chronological list.
  // Reset per turn in send()/newChat() (S.activityIdx = -1) so the NEXT run
  // starts its own fresh indicator rather than appending to a finished one.
  function activityHtml(state) {
    const n = state.calls.length;
    const last = state.calls[n - 1];
    const summary = `⚒ working&hellip; <span class="dim">${n} tool call${n === 1 ? '' : 's'}${last ? ' · latest: ' + esc(last.name) : ''}</span>`;
    const list = state.expanded
      ? `<div class="jact-list">${state.calls.map(c => `<div class="jact-item">⚒ ${esc(c.name)}${c.summ ? ' · <span class="dim">' + esc(c.summ) + '</span>' : ''}</div>`).join('')}</div>`
      : '';
    return `<div class="java assistant">⚒</div><div class="jmsg-body">
      <button type="button" class="jact-toggle" aria-expanded="${state.expanded ? 'true' : 'false'}">${summary} <span class="jact-caret">${state.expanded ? '▾' : '▸'}</span></button>
      ${list}</div>`;
  }
  function openActivity() {
    const state = { calls: [], expanded: false };
    const idx = S.log.length;
    S.log.push({ html: activityHtml(state), cls: 'jmsg tool', state });
    mountEntry(idx);
    S.activityIdx = idx;
  }
  function logToolCall(name, summ) {
    if (S.activityIdx < 0 || !S.log[S.activityIdx] || !S.log[S.activityIdx].state) openActivity();
    const entry = S.log[S.activityIdx];
    entry.state.calls.push({ name, summ });
    entry.html = activityHtml(entry.state);
    const feed = $('#jconv');
    const wrap = feed && feed.querySelector(`[data-logi="${S.activityIdx}"]`);
    if (wrap) {
      wrap.innerHTML = entry.html;
      if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200) feed.scrollTop = feed.scrollHeight;
    }
  }
  function renderLine(o) {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'system' && o.subtype === 'init' && o.session_id) { setSessionId(o.session_id); renderSessBadge(); }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text) {
          S.buf = (S.buf ? S.buf + '\n\n' : '') + b.text.trim();
          if (!S.bubble) openBubble('');
          setBubble(S.buf, true);
          // speak each block as it streams — same voice path as the Run tab
          try { if (window.HubVoice && HubVoice.onAssistantText) HubVoice.onAssistantText(b.text.trim()); } catch {}
        } else if (b.type === 'tool_use') {
          const summ = (b.input && b.input.title) ? b.input.title : '';
          logToolCall(b.name || 'tool', summ);
          S.buf = '';
          S.bubble = null; // next text block (if any) lazily starts a fresh bubble
        }
      }
    }
    if (o.type === 'result') {
      const secs = o.duration_ms ? (o.duration_ms / 1000).toFixed(1) + 's' : '';
      const ok = o.subtype === 'success';
      jconvAppend(`<div class="jmsg-meta">${ok ? '✓ done' : '✗ ' + esc(o.subtype || 'error')} ${esc(secs)}</div>`, 'jmsg result');
    }
  }
  // Returns true once a run has actually been dispatched, false on any no-op
  // (already running, an attachment still uploading, or nothing to send) —
  // callers (jarvistab.js runShaped, voiceconvo.js) use this to avoid a false
  // "sent" flash when the click/turn didn't actually go anywhere.
  // Reflect running-state in the composer: swap send↔stop, block re-entry.
  function setRunningUI(on) {
    const send = $('#jchatSend'), stop = $('#jchatStop');
    if (send) { send.disabled = on; send.classList.toggle('hidden', on); }
    if (stop) stop.classList.toggle('hidden', !on);
  }
  // Cancel the in-flight run server-side (kills the CLI tree) — the stream's
  // own 'done'/onerror does the local cleanup.
  async function cancel() {
    if (!S.runId) return;
    try { await api('/api/run/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: S.runId }) }); } catch {}
  }
  async function send(textArg) {
    if (S.running || S.sending) return false;
    const ta = $('#jchatIn');
    let prompt = (typeof textArg === 'string' && textArg.trim()) || (ta ? ta.value.trim() : '');
    // Attachments: same inbox path as the Run tab (assets/jarvisattach.js).
    // Block while one is still uploading; allow an attachment-only send.
    const attList = window.jarvisAttach ? jarvisAttach.pending() : [];
    if (attList.some(c => c.pending)) {
      jconvAppend(`<div class="jmsg-meta">still uploading an attachment — try again in a moment.</div>`, 'jmsg result');
      return false;
    }
    const atts = attList.filter(c => c.ref);
    const imgs = atts.filter(c => c.isImage);
    const docs = atts.filter(c => !c.isImage);
    if (!prompt && !atts.length) return false;
    if (!prompt && atts.length) {
      const noun = imgs.length && !docs.length ? ('image' + (imgs.length > 1 ? 's' : '')) : ('file' + (atts.length > 1 ? 's' : ''));
      prompt = 'Take a look at the attached ' + noun + '.';
    }
    // Drop the empty-state placeholder on the first real turn. Keyed off the log
    // being empty — the old `.jmsg-meta[style]` probe also matched a rendered
    // attach-error row, so any such row made EVERY later send wipe the feed.
    const feed = $('#jconv');
    if (feed && !S.log.length) feed.innerHTML = '';
    if (ta) { ta.value = ''; ta.style.height = 'auto'; } S.buf = '';
    // thread timeline (assets/jarvistimeline.js): tag this turn's user bubble
    // so a dot can scrollIntoView it later; the count also drives the dots.
    S.turnCount++;
    const turnEl = jconvAppend(jmsgHtml('user', esc(prompt)), 'jmsg user');
    if (turnEl) turnEl.dataset.turn = String(S.turnCount);
    if (window.jarvisTimeline) jarvisTimeline.render(S.turnCount);
    // Sent attachments are clickable: images open the lightbox, docs/sheets open
    // the same inline preview the Files tab uses (delegated handler in wire()).
    // Render images off the server view URL so they survive jarvisAttach.clear()
    // revoking the local blob URLs.
    if (imgs.length) jconvAppend(imgs.map(c => `<img src="/api/files/view?name=${encodeURIComponent(c.previewName || '')}" alt="attached image" class="jattach-img" data-preview="${esc(c.previewName || '')}" style="cursor:zoom-in">`).join(''), 'jmsg attachimgs');
    if (docs.length) jconvAppend(jmsgHtml('user', docs.map(c => `<span class="jattach-doc" data-preview="${esc(c.previewName || '')}" style="cursor:pointer">📎 ${esc(c.name)}</span>`).join('<br>')), 'jmsg user');
    S.activityIdx = -1; // fresh turn — a new tool-call burst gets its own indicator
    openBubble('<span class="jshimmer">thinking…</span>');
    const model = ($('#runModel') && $('#runModel').value) || 'auto';
    const perm = ($('#runPerm') && $('#runPerm').value) || 'bypassPermissions';
    // ◐ think toggle (jarvistab.js #jThinkBtn): one-shot — armed for exactly
    // this send, then cleared regardless of outcome.
    const think = window.jarvisThink ? jarvisThink.get() : false;
    if (window.jarvisThink) jarvisThink.clear();
    let r;
    // Guard synchronously BEFORE the await so a second Enter can't slip through
    // the S.running check (which only flips once the POST resolves).
    S.sending = true;
    try {
      r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, engine: 'claude', model, permissionMode: perm, think, channel: 'spoken',
          resume: S.sessionId || '', recall: recallOn(), images: imgs.map(c => c.ref), files: docs.map(c => c.ref) }) });
    } catch (e) { S.sending = false; setBubble('✗ run failed to start: ' + (e.message || 'network error'), false); return false; }
    if (r.error) { S.sending = false; setBubble('✗ ' + r.error, false); return false; }
    if (window.jarvisAttach) jarvisAttach.clear();
    S.running = true; S.sending = false; S.seen = -1;
    setRunningUI(true);
    setBubble('', true);
    try { if (window.HubVoice && HubVoice.onRunStart) HubVoice.onRunStart(); } catch {}
    attachRun(r.id);
    return true;
  }

  // Attach the SSE stream for run `id`. Factored out of send() so a probe (or
  // a server auto-resume continuation) can re-attach mid-thread. A dropped
  // stream is NOT a dead run — phone screen off / laptop sleep lands here —
  // EventSource auto-reconnects and the server replays via Last-Event-ID
  // (S.seen dedupes); only a probe that says the run truly ended (or a hub
  // unreachable ~5min) settles the bubble.
  function attachRun(id) {
    if (S.es) { try { S.es.close(); } catch {} }
    S.runId = id;
    const es = new EventSource(`/api/run/stream?id=${encodeURIComponent(id)}`);
    S.es = es;
    es.addEventListener('line', ev => {
      const idx = parseInt(ev.lastEventId, 10);
      if (!isNaN(idx)) { if (idx <= S.seen) return; S.seen = idx; }
      let o; try { o = JSON.parse(ev.data); } catch { return; }
      renderLine(o);
    });
    es.addEventListener('done', ev => {
      es.close(); S.es = null;
      let meta = {}; try { meta = JSON.parse(ev.data); } catch {}
      settle(meta);
    });
    es.onopen = () => { if (S.probe) { clearTimeout(S.probe); S.probe = null; } S.probeFails = 0; };
    es.onerror = () => {
      if (!S.running) { if (S.es) { try { S.es.close(); } catch {} S.es = null; } return; }
      if (!S.probe) S.probe = setTimeout(() => probeRun(id), 8000);
    };
  }

  async function probeRun(id) {
    S.probe = null;
    if (!S.running || S.runId !== id) return;
    try {
      const rows = await api('/api/runs');
      const m = (Array.isArray(rows) ? rows : []).find(x => x.id === id);
      S.probeFails = 0;
      if (m && m.status !== 'running' && m.status !== 'queued') {
        if (S.es) { try { S.es.close(); } catch {} S.es = null; }
        settle(m);
        return;
      }
    } catch {
      if ((S.probeFails = (S.probeFails || 0) + 1) >= 40) { // hub gone ~5min
        if (S.es) { try { S.es.close(); } catch {} S.es = null; }
        settle({ status: 'connection lost' });
        return;
      }
    }
    S.probe = setTimeout(() => probeRun(id), 8000);
  }

  // Terminal handling — or a hop onto the server's auto-resume continuation
  // (sleep safeguard: the engine sets meta.continuedBy when it revived a run).
  function settle(meta) {
    if (meta.continuedBy && S.running) { S.seen = -1; attachRun(meta.continuedBy); return; }
    S.running = false;
    if (meta.sessionId) setSessionId(meta.sessionId);
    // A turn that ends right after a tool call (no trailing text) leaves
    // S.bubble null (see renderLine) — lazily create one so the final status
    // always has somewhere to render instead of silently no-op'ing.
    if (!S.bubble) openBubble('');
    setBubble(S.buf || (meta.status === 'done' ? '(no reply)' : '✗ ' + (meta.status || 'connection lost — see transcript')), false);
    try { if (window.HubVoice && HubVoice.onRunDone) HubVoice.onRunDone(S.buf); } catch {}
    setRunningUI(false);
    renderSessBadge();
    if (window.jarvisHooks && window.jarvisHooks.renderHolding) window.jarvisHooks.renderHolding();
  }
  function newChat() {
    if (S.running) cancel(); // don't orphan a live run when starting fresh
    if (S.es) { try { S.es.close(); } catch {} S.es = null; }
    S.running = false; S.sending = false; S.runId = null; S.seen = -1;
    setSessionId(null); S.bubble = null; S.bubbleIdx = -1; S.activityIdx = -1; S.buf = ''; S.turnCount = 0; S.log = [];
    const feed = $('#jconv'); if (feed) feed.innerHTML = '<div class="jmsg-meta" style="padding:4px">new conversation — the next prompt starts a fresh CLI session</div>';
    if (window.jarvisAttach) jarvisAttach.clear();
    if (window.jarvisTimeline) jarvisTimeline.render(0);
    renderSessBadge();
    setRunningUI(false);
  }
  function wire() {
    const ci = $('#jchatIn');
    if (ci) {
      ci.oninput = () => { ci.style.height = 'auto'; ci.style.height = Math.min(120, ci.scrollHeight) + 'px'; };
      ci.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    }
    const sb = $('#jchatSend'); if (sb) sb.onclick = send;
    const nb = $('#jchatNew'); if (nb) nb.onclick = newChat;
    const st = $('#jchatStop'); if (st) st.onclick = cancel;
    // Delegated: click any sent attachment (image or 📎 doc row) to preview it,
    // or a "⚒ working…" activity indicator to expand/collapse its call list.
    // Delegated (not attached per-render) since both kinds of target get their
    // innerHTML replaced repeatedly while a run streams.
    const feed = $('#jconv');
    if (feed) feed.onclick = e => {
      const t = e.target.closest && e.target.closest('[data-preview]');
      if (t && t.dataset.preview && typeof openFilePreview === 'function') { openFilePreview(t.dataset.preview); return; }
      const toggleBtn = e.target.closest && e.target.closest('.jact-toggle');
      if (toggleBtn) {
        const wrap = toggleBtn.closest('[data-logi]');
        const idx = wrap ? +wrap.dataset.logi : -1;
        const entry = S.log[idx];
        if (entry && entry.state) {
          entry.state.expanded = !entry.state.expanded;
          entry.html = activityHtml(entry.state);
          wrap.innerHTML = entry.html;
        }
      }
    };
    // renderers.jarvis rebuilds #jarvis wholesale (refresh button, R key, retry),
    // which used to destroy the conversation with no way back. Restore it.
    replayLog();
    if (window.jarvisTimeline) jarvisTimeline.render(S.turnCount);
    // Session survived a page reload but the transcript didn't (it lives in
    // memory only) — say so rather than looking like a silent reset.
    if (S.sessionId && !S.log.length) {
      if (feed) feed.innerHTML = '';   // drop the empty-state placeholder first
      jconvAppend(`<div class="jmsg-meta">⟲ resuming CLI session ${esc(S.sessionId.slice(0, 8))}… — earlier turns aren't shown, but Jarvis still has them. Press ＋ new for a clean thread.</div>`, 'jmsg result');
    }
    renderSessBadge();
  }
  // sendText = programmatic entry for the voice conversation engine
  // (assets/voiceconvo.js): spoken turns render in-tab like typed ones.
  window.jarvisChat = { wire, send, sendText: t => send(t), newChat,
    isRunning: () => S.running, sessionId: () => S.sessionId, turnCount: () => S.turnCount };
})();
