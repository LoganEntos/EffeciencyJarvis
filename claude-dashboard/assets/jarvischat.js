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
  const S = { es: null, running: false, runId: null, seen: -1, sessionId: null, bubble: null, buf: '', turnCount: 0 };
  const recallOn = () => { try { return localStorage.getItem('hub.recall') === '1'; } catch { return false; } };
  const timeOf = iso => { try { return new Date(iso).toLocaleTimeString(undefined, { hour12: false }); } catch { return ''; } };

  // ---- session badge (panel header): short id when resumed, "＋ new" when fresh
  function renderSessBadge() {
    const el = $('#jsessBadge'); if (!el) return;
    if (S.sessionId) {
      el.textContent = 'sess · ' + S.sessionId.slice(0, 8);
      el.title = 'resumed CLI session ' + S.sessionId;
      el.classList.add('on');
    } else {
      el.textContent = '＋ new';
      el.title = 'fresh CLI session — the next prompt starts it';
      el.classList.remove('on');
    }
  }

  function jconvAppend(html, cls) {
    const feed = $('#jconv'); if (!feed) return null;
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const wrap = document.createElement('div');
    wrap.className = cls || 'jmsg';
    wrap.innerHTML = html;
    feed.appendChild(wrap);
    if (stick) feed.scrollTop = feed.scrollHeight;
    return wrap;
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
  function setBubble(text, streaming) {
    const b = S.bubble; if (!b) return;
    const body = b.querySelector('.jmsg-text');
    // mdToHtml is defined in run.js and loaded before this file; fall back to
    // an escaped plain-text render if it's ever missing.
    const html = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text);
    if (body) body.innerHTML = html + (streaming ? '<span class="jcaret">▍</span>' : '');
    const feed = $('#jconv');
    if (feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200) feed.scrollTop = feed.scrollHeight;
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
          // speak each block as it streams — same voice path as the Run tab
          try { if (window.HubVoice && HubVoice.onAssistantText) HubVoice.onAssistantText(b.text.trim()); } catch {}
        } else if (b.type === 'tool_use') {
          const summ = (b.input && b.input.title) ? b.input.title : (b.name || 'tool');
          jconvAppend(jmsgHtml('tool', `⚒ ${esc(b.name || 'tool')} · <span class="dim">${esc(summ)}</span>`), 'jmsg tool');
          S.bubble = jconvAppend(jmsgHtml('assistant', '<span class="jshimmer">working…</span>'), 'jmsg assistant');
          S.buf = '';
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
  async function send(textArg) {
    if (S.running) return false;
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
    const feed = $('#jconv');
    if (feed && feed.querySelector('.jmsg-meta[style]')) feed.innerHTML = '';
    if (ta) { ta.value = ''; ta.style.height = 'auto'; } S.buf = '';
    // thread timeline (assets/jarvistimeline.js): tag this turn's user bubble
    // so a dot can scrollIntoView it later; the count also drives the dots.
    S.turnCount++;
    const turnEl = jconvAppend(jmsgHtml('user', esc(prompt)), 'jmsg user');
    if (turnEl) turnEl.dataset.turn = String(S.turnCount);
    if (window.jarvisTimeline) jarvisTimeline.render(S.turnCount);
    if (imgs.length) jconvAppend(imgs.map(c => `<img src="${esc(c.url)}" alt="attached image" class="jattach-img">`).join(''), 'jmsg attachimgs');
    if (docs.length) jconvAppend(jmsgHtml('user', '📎 ' + esc(docs.map(c => c.name).join(', '))), 'jmsg user');
    S.bubble = jconvAppend(jmsgHtml('assistant', '<span class="jshimmer">thinking…</span>'), 'jmsg assistant');
    const model = ($('#runModel') && $('#runModel').value) || 'auto';
    const perm = ($('#runPerm') && $('#runPerm').value) || 'bypassPermissions';
    // ◐ think toggle (jarvistab.js #jThinkBtn): one-shot — armed for exactly
    // this send, then cleared regardless of outcome.
    const think = window.jarvisThink ? jarvisThink.get() : false;
    if (window.jarvisThink) jarvisThink.clear();
    let r;
    try {
      r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, engine: 'claude', model, permissionMode: perm, think,
          resume: S.sessionId || '', recall: recallOn(), images: imgs.map(c => c.ref), files: docs.map(c => c.ref) }) });
    } catch (e) { setBubble('✗ run failed to start: ' + (e.message || 'network error'), false); return false; }
    if (r.error) { setBubble('✗ ' + r.error, false); return false; }
    if (window.jarvisAttach) jarvisAttach.clear();
    S.running = true; S.runId = r.id; S.seen = -1;
    const btn = $('#jchatSend'); if (btn) btn.disabled = true;
    setBubble('', true);
    try { if (window.HubVoice && HubVoice.onRunStart) HubVoice.onRunStart(); } catch {}
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
      try { if (window.HubVoice && HubVoice.onRunDone) HubVoice.onRunDone(S.buf); } catch {}
      const b2 = $('#jchatSend'); if (b2) b2.disabled = false;
      renderSessBadge();
      if (window.jarvisHooks && window.jarvisHooks.renderHolding) window.jarvisHooks.renderHolding();
    });
    es.onerror = () => {
      // A stream that drops mid-run (server restart, network blip) never sends
      // a 'done', so recover here instead of hanging: stop, keep whatever
      // streamed, and re-enable send.
      if (S.running) {
        S.running = false;
        try { es.close(); } catch {}
        S.es = null;
        setBubble(S.buf || '✗ connection lost — see transcript', false);
        const b3 = $('#jchatSend'); if (b3) b3.disabled = false;
      }
    };
    return true;
  }
  function newChat() {
    if (S.es) { try { S.es.close(); } catch {} S.es = null; }
    S.running = false; S.runId = null; S.seen = -1;
    S.sessionId = null; S.bubble = null; S.buf = ''; S.turnCount = 0;
    const feed = $('#jconv'); if (feed) feed.innerHTML = '<div class="jmsg-meta" style="padding:4px">new conversation — the next prompt starts a fresh CLI session</div>';
    if (window.jarvisAttach) jarvisAttach.clear();
    if (window.jarvisTimeline) jarvisTimeline.render(0);
    renderSessBadge();
    const btn = $('#jchatSend'); if (btn) btn.disabled = false;
  }
  function wire() {
    const ci = $('#jchatIn');
    if (ci) {
      ci.oninput = () => { ci.style.height = 'auto'; ci.style.height = Math.min(120, ci.scrollHeight) + 'px'; };
      ci.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    }
    const sb = $('#jchatSend'); if (sb) sb.onclick = send;
    const nb = $('#jchatNew'); if (nb) nb.onclick = newChat;
    renderSessBadge();
  }
  // sendText = programmatic entry for the voice conversation engine
  // (assets/voiceconvo.js): spoken turns render in-tab like typed ones.
  window.jarvisChat = { wire, send, sendText: t => send(t), newChat,
    isRunning: () => S.running, sessionId: () => S.sessionId, turnCount: () => S.turnCount };
})();
