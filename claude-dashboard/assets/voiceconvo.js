/* Voice conversation engine — the state machine between the mic and the run.
   Replaces the old per-utterance wake gate with a real conversation:

     idle ──(tab visible + hot-mic pref)──▶ passive   wake-listening, all else discarded
     passive ──"Jarvis" alone──▶ ack ▶ open           persona-flavored "Yes?"
     passive ──"Jarvis, do X"──▶ send X ▶ thinking
     open ──speech──▶ capturing ──endpoint──▶ send ▶ thinking ▶ speaking ▶ open
     open ──window s of held silence──▶ close earcon ▶ passive/idle

   While SPEAKING the mic stays hot but only the wake word barges in, and a
   fuzzy self-echo filter stops Jarvis's own TTS (which may contain "Jarvis")
   from triggering him. Endpointing never cuts speech: the silence timer only
   runs after speech, and a trailing connector ("and", "so", …) buys extra
   grace. Turns on the Jarvis tab route through jarvisChat (visible in-tab);
   elsewhere through the Run tab's sendPrompt. Voice turns ALWAYS speak back.

   Factory pattern (same as voicetts.js): voice.js instantiates with its
   closure internals and exposes the result as window.HubVoiceConvo.
   Zero deps; loaded before voice.js in index.html. */
'use strict';
window.HubVoiceConvoFactory = function (ctx) {
  const { SR, store, V, setState, say, micBlockReason, earOpen, earClose,
          wakeRe, stripWake, speak, stopSpeak, queueBusy } = ctx;

  // phase = the conversation's own state; thinking/speaking are observed from
  // the run/TTS layer (V.state + queueBusy) rather than duplicated here.
  const S = { phase: 'idle', rec: null, running: false, deliberate: false,
    full: '', consumed: 0, pre: '', silTimer: null, wakeTimer: null,
    windowTimer: null, watch: null, restartAt: 0, fails: 0,
    replyTail: '', ackUntil: 0, acks: { def: 'Yes?' } };

  const CONNECT_RE = /(?:\b(?:and|but|or|so|then|also|plus|um|uh|like|because)\s*|,)$/i;
  const jarvisVisible = () => {
    try { return typeof currentTab !== 'undefined' && currentTab === 'jarvis' && !document.hidden; } catch { return false; }
  };
  const runBusy = () => {
    try {
      if (typeof chat === 'object' && chat && chat.running) return true;
      if (window.jarvisChat && jarvisChat.isRunning && jarvisChat.isRunning()) return true;
    } catch {}
    return false;
  };
  const inConvo = () => S.phase === 'open' || S.phase === 'capturing';

  // ---- persona ack ----------------------------------------------------------
  // Refresh the active persona's ack line whenever a conversation could start.
  async function refreshAck() {
    try {
      const d = await api('/api/personas');
      const p = (d.personas || []).find(x => x.id === d.active);
      S.acks.def = (p && p.ack) || 'Yes?';
    } catch {}
  }

  // ---- self-echo filter ------------------------------------------------------
  // Normalized-substring check against what Jarvis recently said, so speaker
  // bleed (including his own name in a reply) never reads as the user talking.
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function noteReply(text) {
    S.replyTail = (S.replyTail + ' ' + norm(text)).slice(-600);
  }
  function isEcho(text) {
    const n = norm(text);
    if (n.length < 6) return false;             // too short to judge — let the wake gate decide
    return S.replyTail.includes(n) || n.includes(S.replyTail.slice(-Math.max(24, n.length)));
  }

  // ---- captions ---------------------------------------------------------------
  // Live interim transcript into the visible composer so capture is never blind.
  function captionTarget() {
    if (jarvisVisible()) { const j = $('#jchatIn'); if (j) return j; }
    try { ensureRunUI(); } catch {}
    return $('#promptIn');
  }
  function caption(text) {
    const ta = captionTarget(); if (!ta) return;
    ta.value = text ? ((S.pre ? S.pre + ' ' : '') + text) : S.pre;
  }

  // ---- turn routing ------------------------------------------------------------
  function routeSend(text) {
    V.voiceTurn = true;                          // voice in → voice out, always
    caption('');
    if (jarvisVisible() && window.jarvisChat && jarvisChat.sendText) { jarvisChat.sendText(text); return; }
    try { ensureRunUI(); } catch {}
    const ta = $('#promptIn');
    if (ta) ta.value = (S.pre ? S.pre + ' ' : '') + text;
    if (typeof sendPrompt === 'function') sendPrompt();
  }

  // ---- recognition lifecycle ---------------------------------------------------
  function desiredMic() {
    if (!SR || micBlockReason()) return false;
    if (runBusy() && !queueBusy()) return false;           // thinking — mic closed
    if (queueBusy()) return inConvo() || S.phase === 'passive'; // speaking — hot, name-only
    if (inConvo()) return true;
    if (S.phase === 'passive') return store.hotmic && jarvisVisible();
    return false;
  }
  function startRec() {
    if (S.running || !SR) return;
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    S.rec = rec; S.running = true; S.full = ''; S.consumed = 0;
    V.listening = true; // voicetts checks this before painting 'thinking' over an open mic
    rec.onresult = e => {
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      S.full = full.replace(/\s+/g, ' ').trim();
      onSpeech();
    };
    rec.onerror = e => {
      const err = (e && e.error) || '';
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        // Hard failure — latch it so the passive watcher doesn't re-request the
        // mic (and re-toast the error) every tick. A manual open() retries.
        if (!S.micDenied) say(err === 'audio-capture' ? 'No microphone found — check Windows Sound settings.'
          : 'Microphone permission denied — allow the mic for this site, then try again.', 'errmsg');
        S.micDenied = true; S.deliberate = true; S.phase = 'idle'; reflect();
      }
      // 'no-speech'/'aborted'/'network' → onend fires next; the watcher restarts.
    };
    rec.onend = () => {
      S.running = false; S.rec = null; V.listening = false;
      // Chrome ends continuous recognition on its own (~60s / after quiet).
      // Unless we stopped it deliberately, the watcher restarts with backoff.
      if (!S.deliberate) S.restartAt = performance.now() + Math.min(2000, 250 * ++S.fails);
      S.deliberate = false;
    };
    try { rec.start(); S.fails = 0; } catch { S.running = false; S.rec = null; S.restartAt = performance.now() + 800; }
  }
  function stopRec() {
    if (!S.running) return;
    S.deliberate = true;
    try { S.rec && S.rec.stop(); } catch {}
    S.running = false; S.rec = null; V.listening = false;
    clearTimeout(S.silTimer); clearTimeout(S.wakeTimer);
  }

  // ---- speech handling -----------------------------------------------------------
  function utterance() { return S.full.slice(S.consumed).trim(); }
  function consume() { S.consumed = S.full.length; }

  function onSpeech() {
    const delta = utterance();
    if (!delta) return;
    // SPEAKING: only the wake word (and never his own echo) barges in.
    if (queueBusy()) {
      if (isEcho(delta)) { consume(); return; }
      if (wakeRe().test(delta)) {
        stopSpeak();
        const rest = stripWake(delta);
        if (rest) { consume(); routeSend(rest); toPhase('open'); }
        else { consume(); toPhase('open'); armWindow(); }
      } else consume();                          // room noise while speaking — drop it
      return;
    }
    if (S.phase === 'passive') {
      clearTimeout(S.wakeTimer);
      if (!wakeRe().test(delta)) {
        // not for me — discard once it settles so it never pollutes a real turn
        S.wakeTimer = setTimeout(consume, 1500);
        return;
      }
      const rest = stripWake(delta);
      if (rest) { armEndpoint(); return toPhase('capturing'); }  // "Jarvis, do X…" — capture to the endpoint
      // bare "Jarvis" — ack fast (700ms of nothing more) instead of dead air
      S.wakeTimer = setTimeout(() => {
        if (!utterance() || !stripWake(utterance())) {
          consume();
          openConvo(true);
        }
      }, 700);
      return;
    }
    if (S.phase === 'open') toPhase('capturing');
    if (S.phase === 'capturing') {
      clearTimeout(S.windowTimer);
      caption(S.phase === 'capturing' ? (queueBusy() ? '' : stripWake(delta) || delta) : '');
      armEndpoint();
    }
  }

  // Endpoint: silence after speech ends the utterance; a trailing connector
  // ("and", "so", ",", …) buys +1.2s so a mid-thought pause never cuts you off.
  function armEndpoint() {
    clearTimeout(S.silTimer);
    const grace = CONNECT_RE.test(utterance()) ? 1200 : 0;
    S.silTimer = setTimeout(endpoint, Math.round(store.pause * 1000) + grace);
  }
  function endpoint() {
    let text = utterance();
    consume();
    // a turn opened from passive may still carry the name — strip it
    if (text && wakeRe().test(text)) text = stripWake(text) || text;
    if (text) { toPhase('open'); routeSend(text); }
    else { toPhase('open'); armWindow(); }
  }

  // ---- conversation window ----------------------------------------------------
  // The 5s (configurable) held-silence close. Only counts down while truly idle:
  // speech, a running turn, or TTS all put it on hold.
  function armWindow() {
    clearTimeout(S.windowTimer);
    S.windowTimer = setTimeout(() => {
      if (!inConvo()) return;
      if (runBusy() || queueBusy() || utterance()) return armWindow();  // busy — check again
      closeConvo();
    }, Math.round((store.window || 5) * 1000));
  }

  // ---- phase management ----------------------------------------------------------
  function toPhase(p) { S.phase = p; reflect(); }
  function reflect() {
    // V.state keeps its legacy vocabulary for the header orb + run hooks;
    // richer phases (passive/open) are read via HubVoiceConvo.state().
    if (queueBusy()) { V.call = inConvo(); return; }
    if (inConvo()) { V.call = true; setState('listening'); }
    else { V.call = false; setState('idle'); }
  }
  function openConvo(withAck) {
    if (micBlockReason()) { say(micBlockReason(), 'errmsg'); return; }
    const t = captionTarget(); S.pre = t ? t.value : '';
    refreshAck();
    toPhase('open');
    earOpen();
    if (withAck) { noteReply(S.acks.def); speak(S.acks.def); } // ack speaks; onReplyDone re-arms the window
    armWindow();
  }
  function closeConvo() {
    clearTimeout(S.silTimer); clearTimeout(S.windowTimer); clearTimeout(S.wakeTimer);
    caption('');
    earClose();
    V.voiceTurn = false;
    toPhase(store.hotmic && jarvisVisible() && SR ? 'passive' : 'idle');
  }

  // ---- public surface -------------------------------------------------------------
  // Called by voicetts after the reply queue drains: your turn again.
  function onReplyDone() {
    if (inConvo()) { toPhase('open'); earOpen(); armWindow(); }
    else if (S.phase === 'passive' || S.phase === 'idle') reflect();
  }
  function open() {                              // orb tap / ☎ / V — user-initiated, no ack needed
    if (inConvo()) return;
    S.micDenied = false;                         // a real gesture may re-prompt for the mic
    if (queueBusy()) stopSpeak();
    openConvo(false);
  }
  function close() { if (inConvo()) closeConvo(); else reflect(); }
  function toggle() { inConvo() ? closeConvo() : open(); }

  // The watcher reconciles the mic with the desired state (mirrors the orb's
  // own 400ms watcher pattern) and handles passive-eligibility + SR restarts.
  function startWatch() {
    if (S.watch) return;
    S.watch = setInterval(() => {
      // passive eligibility follows the Jarvis tab + pref (and a mic that works)
      if (S.phase === 'idle' && store.hotmic && !S.micDenied && jarvisVisible() && SR && !micBlockReason()) { S.phase = 'passive'; refreshAck(); }
      else if (S.phase === 'passive' && (!store.hotmic || !jarvisVisible())) S.phase = 'idle';
      const want = desiredMic();
      if (want && !S.running && performance.now() >= S.restartAt) startRec();
      else if (!want && S.running) stopRec();
    }, 350);
  }
  startWatch();

  // Debug/verify hook: feed a fake transcript through the SAME decision path.
  function _ingest(text) { S.full = (S.full ? S.full + ' ' : '') + String(text).trim(); onSpeech(); }

  return { open, close, toggle, onReplyDone, noteReply,
    state: () => (queueBusy() ? 'speaking' : runBusy() && inConvo() ? 'thinking' : S.phase),
    _ingest, _S: S };
};
