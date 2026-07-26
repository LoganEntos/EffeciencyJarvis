/* Voice module (N9 Track A + hands-free call) — talk to the hub, it talks back.
   Zero-dependency, browser-native: webkitSpeechRecognition for the mic,
   speechSynthesis for the reply, WebAudio for turn earcons, a small canvas orb
   in the header for state. No server cost: speech never leaves the browser
   except through the vendor's own speech service.

   Talking is a CONVERSATION (state machine in assets/voiceconvo.js):
     • Say "Jarvis" on the Jarvis tab (passive wake listening) or tap the orb /
       press V — the conversation opens (persona-flavored ack on a bare wake).
     • While open, no wake word is needed; each utterance auto-sends when you
       stop speaking, and the conversation closes itself after N seconds of
       held silence (Config → conversation window). Esc/click closes any time.
     • While a reply is speaking, saying the name barges in (self-echo filtered).

   Public surface (window.HubVoice):
     init()                    - inject the orb + wire hotkeys (called from boot)
     onRunStart()              - a run began → orb goes "thinking"
     onRunDone(text, meta)     - a run ended → orb idle; speak text if talkback/call
     renderSettings(container) - Config-tab settings block
*/
'use strict';
(function () {
  // ---- KILL SWITCH (re-enabled 2026-07-13) --------------------------------
  // Was hard-disabled while Sesame CSM-1B (the old neural default) proved too
  // slow (~6 s to first word). CSM is now retired as the default: the module
  // ships with the instant browser engine as default, Kokoro-82M as the fast
  // local-neural option. Any stale localStorage 'csm' engine setting is
  // migrated to 'browser' in init(). Set back to true to fully gate the module.
  const VOICE_DISABLED = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SS = window.speechSynthesis;
  const store = {
    // orb visible by default so voice is discoverable; user can hide it in Config
    get mic() { try { const v = localStorage.getItem('hub.voice.mic'); return v === null ? true : v === '1'; } catch { return true; } },
    set mic(v) { try { localStorage.setItem('hub.voice.mic', v ? '1' : '0'); } catch {} },
    get talk() { try { return localStorage.getItem('hub.voice.talk') === '1'; } catch { return false; } },
    set talk(v) { try { localStorage.setItem('hub.voice.talk', v ? '1' : '0'); } catch {} },
    get conv() { try { return localStorage.getItem('hub.voice.conv') === '1'; } catch { return false; } },
    set conv(v) { try { localStorage.setItem('hub.voice.conv', v ? '1' : '0'); } catch {} },
    get voiceURI() { try { return localStorage.getItem('hub.voice.uri') || ''; } catch { return ''; } },
    set voiceURI(v) { try { localStorage.setItem('hub.voice.uri', v); } catch {} },
    get rate() { try { return parseFloat(localStorage.getItem('hub.voice.rate')) || 1; } catch { return 1; } },
    set rate(v) { try { localStorage.setItem('hub.voice.rate', String(v)); } catch {} },
    // seconds of silence before a spoken prompt is considered finished + sent
    get pause() { try { return parseFloat(localStorage.getItem('hub.voice.pause')) || 2.5; } catch { return 2.5; } },
    set pause(v) { try { localStorage.setItem('hub.voice.pause', String(v)); } catch {} },
    // TTS engine: 'browser' (default, instant) | 'kokoro' (local, fast neural)
    // | 'csm' (local Sesame CSM-1B, most natural but slow). Neural engines both
    // go through /api/voice/tts (the hub proxies to the right sidecar by ?engine).
    get engine() { try { const v = localStorage.getItem('hub.voice.engine'); return (v === 'csm' || v === 'kokoro') ? v : 'browser'; } catch { return 'browser'; } },
    set engine(v) { try { localStorage.setItem('hub.voice.engine', (v === 'csm' || v === 'kokoro') ? v : 'browser'); } catch {} },
    get neural() { return this.engine === 'csm' || this.engine === 'kokoro'; },
    get csmSpeaker() { try { const n = parseInt(localStorage.getItem('hub.voice.csmspk'), 10); return isNaN(n) ? 0 : Math.max(0, Math.min(9, n)); } catch { return 0; } },
    set csmSpeaker(v) { try { localStorage.setItem('hub.voice.csmspk', String(v)); } catch {} },
    // wake word — during a call, only speech that addresses me by name counts
    get wake() { try { return (localStorage.getItem('hub.voice.wake') || 'Jarvis').trim() || 'Jarvis'; } catch { return 'Jarvis'; } },
    set wake(v) { try { localStorage.setItem('hub.voice.wake', String(v || '').trim()); } catch {} },
    // wake-word gate on/off (default ON — user asked: don't interrupt unless named)
    get wakeGate() { try { const v = localStorage.getItem('hub.voice.wakegate'); return v === null ? true : v === '1'; } catch { return true; } },
    set wakeGate(v) { try { localStorage.setItem('hub.voice.wakegate', v ? '1' : '0'); } catch {} },
    // conversation window — seconds of held silence before an open conversation closes
    get window() { try { const v = parseFloat(localStorage.getItem('hub.voice.window')); return isNaN(v) ? 5 : Math.max(2, Math.min(15, v)); } catch { return 5; } },
    set window(v) { try { localStorage.setItem('hub.voice.window', String(v)); } catch {} },
    // hot mic — passively listen for the wake word while the Jarvis tab is visible
    get hotmic() { try { const v = localStorage.getItem('hub.voice.hotmic'); return v === null ? true : v === '1'; } catch { return true; } },
    set hotmic(v) { try { localStorage.setItem('hub.voice.hotmic', v ? '1' : '0'); } catch {} },
  };

  // Wake-word gate. In a hands-free call the mic re-opens between turns, so room
  // noise or my own talk-back bleeding back through the speakers used to get
  // transcribed and fired as a spurious turn — "you interrupted yourself" with
  // nothing actually said. With the gate on, a re-listened utterance is only
  // acted on if it addresses me by name (default "Jarvis"); the name is then
  // stripped from the prompt. Matches the name as a whole word, tolerant of the
  // common misrecognitions of "Jarvis" (and legacy "Suzy" for anyone who kept
  // it). Any other custom wake word matches literally.
  function wakeRe() {
    const w = store.wake || 'Jarvis';
    const body = /^jarvis$/i.test(w) ? '(?:jarvis|jarvas|jervis|jarves|javis|jarvus|travis)'
      : /^suzy$/i.test(w) ? '(?:suzy|susie|suzie|susy|soozy|sussy)'
      : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + body + '\\b', 'i');
  }
  function stripWake(text) {
    return String(text || '').replace(wakeRe(), ' ')
      .replace(/\s+/g, ' ').replace(/^[\s,.:;!?—-]+/, '').trim();
  }

  // V.call = a conversation is open (voiceconvo.js drives it); V.voiceTurn =
  // the in-flight run was voice-initiated (its reply always speaks);
  // V.press = long-press timer on the orb.
  const V = { state: 'idle', rec: null, listening: false, call: false, voiceTurn: false,
    press: null, raf: null, canvas: null, ctx: null, t0: performance.now(),
    // CSM audio: csmGen invalidates in-flight fetches on barge-in
    audioEl: null, audioUrl: null, csmGen: 0, csmPending: false };

  function css(name, fb) { return (getComputedStyle(document.documentElement).getPropertyValue(name) || fb).trim() || fb; }

  // ---- low-level audio plumbing (assets/voicecore.js) ----------------------
  // The WebAudio turn earcons (mic-open / hang-up blips), the mobile autoplay
  // gesture-unlock (primeAudio + its silent-WAV helper), and the coarse
  // mobile-device check were lifted into voicecore.js to keep this file under
  // the 500-line rule. All three share one AudioContext. earOpen/earClose feed
  // the conversation engine (voiceconvo.js), isMobileDevice the TTS engine
  // (voicetts.js), primeAudio the first-gesture unlock wired in init().
  const { earOpen, earClose, primeAudio, isMobileDevice } = window.HubVoiceCore({ SS, V });

  // Surface a message in the chat log so mic problems are never silent. On the
  // Jarvis tab, stay put (it IS a voice surface) and flash its status line too.
  function say(msg, cls) {
    try {
      ensureRunUI(); if (typeof addMsg === 'function') addMsg(msg, cls || 'sys');
      if (typeof currentTab !== 'undefined' && currentTab === 'jarvis') {
        const j = $('#jmsg'); if (j) { j.textContent = msg; j.style.color = cls === 'errmsg' ? 'var(--red)' : 'var(--muted)'; }
      } else goTab('run');
    } catch {}
  }
  // Why the mic can't run right now (null = it can). The #1 cause is an
  // insecure origin — Web Speech only works on https or localhost/127.0.0.1.
  function micBlockReason() {
    if (!SR) return 'This browser has no speech recognition — use Chrome or Edge on desktop. (Talk-back still works everywhere.)';
    if (!window.isSecureContext) return 'The mic is blocked because this page is not a secure context. Open the hub at http://localhost:5757 or http://127.0.0.1:5757 — not a Tailscale IP/hostname over plain http. (Over Tailscale, use its HTTPS "serve" URL.)';
    return null;
  }

  // ---- orb -----------------------------------------------------------------
  function buildOrb() {
    if ($('#voiceOrb')) return;
    const btn = document.createElement('button');
    btn.id = 'voiceOrb';
    btn.className = 'iconbtn';
    btn.title = orbTitle();
    btn.style.cssText = 'padding:0;width:32px;height:32px;display:inline-grid;place-items:center';
    const cv = document.createElement('canvas');
    const DPR = window.devicePixelRatio || 1;
    cv.width = 26 * DPR; cv.height = 26 * DPR; cv.style.cssText = 'width:26px;height:26px';
    btn.appendChild(cv);
    const ref = $('#refreshTab');
    ref.parentNode.insertBefore(btn, ref);
    V.canvas = cv; V.ctx = cv.getContext('2d'); V.ctx.scale(DPR, DPR);
    // A tap opens (or closes) a conversation; while a reply is speaking, a tap
    // just hushes it (you stay in the conversation). Long-press also opens.
    btn.onpointerdown = (e) => {
      if (e.button && e.button !== 0) return;
      V.longPressed = false;
      clearTimeout(V.press);
      V.press = setTimeout(() => { V.longPressed = true; if (SR && !V.call) beginCall(); }, 400);
    };
    btn.onpointerup = btn.onpointercancel = () => clearTimeout(V.press);
    btn.onclick = (e) => {
      clearTimeout(V.press);
      if (V.longPressed) { V.longPressed = false; return; } // long-press already acted
      if (queueBusy()) { stopSpeak(); if (convo) convo.onReplyDone(); return; } // hush, stay in the conversation
      if (V.call) { endCall(); return; }                    // click closes the conversation
      const blocked = micBlockReason();
      if (blocked) { say(blocked, 'errmsg'); return; }        // tell the user why, don't sit silent
      beginCall();                                           // open a conversation
    };
    loop();
  }

  function orbTitle() {
    if (!SR) return 'Voice input needs Chrome or Edge (desktop) · talk-back works everywhere';
    if (V.call) return 'Conversation open — click or press Esc to close it';
    return `Voice — tap to talk (closes after ${store.window}s of silence) · V`;
  }
  function setState(s) { V.state = s; const b = $('#voiceOrb'); if (b) b.title = orbTitle(); kickVoice(); }

  function loop() {
    const ctx = V.ctx; if (!ctx) { V.raf = null; return; }
    const t = (performance.now() - V.t0) / 1000;
    const amber = css('--accent', '#e8a33d'), listen = css('--amber', '#e0a63f');
    const muted = css('--muted', '#a89e8a');
    ctx.clearRect(0, 0, 26, 26);
    const cx = 13, cy = 13;
    let color = muted, base = 5.6, pulse = 0;
    // "listening" uses the amber listen-tone, not green — green is reserved for
    // success states elsewhere in the app (U4: this orb used to paint green here).
    if (V.state === 'listening') { color = listen; pulse = 2.1 * (0.5 + 0.5 * Math.sin(t * 7)); base = 5.6; }
    else if (V.state === 'thinking') { color = amber; pulse = 1.9 * (0.5 + 0.5 * Math.sin(t * 4)); }
    else if (V.state === 'speaking') { color = amber; pulse = 2.8 * Math.abs(Math.sin(t * 11)); }
    else { color = SR ? amber : muted; pulse = 0; } // idle is static — no perpetual 60fps breath loop
    // outer ring
    ctx.beginPath(); ctx.arc(cx, cy, base + pulse + 2.8, 0, 6.2832);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.1; ctx.stroke();
    // core
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cx, cy, base + pulse, 0, 6.2832);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = V.state === 'idle' ? 3 : 8;
    ctx.fill(); ctx.shadowBlur = 0;
    // mic notch when idle+ready so it reads as a mic
    if (V.state === 'idle' && SR) {
      ctx.fillStyle = css('--bg', '#0e0d0b'); ctx.globalAlpha = 0.9;
      ctx.fillRect(cx - 1.1, cy - 2.6, 2.2, 4.3); ctx.globalAlpha = 1;
    }
    // persistent outer ring while on a hands-free call — the "line is open" tell
    if (V.call) {
      ctx.beginPath(); ctx.arc(cx, cy, 11.3, 0, 6.2832);
      ctx.strokeStyle = listen; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3);
      ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // animate only during active voice (listening/thinking/speaking/call); the
    // idle orb is drawn once and the loop stops — no perpetual 60fps repaint.
    V.raf = (V.call || V.state !== 'idle') ? requestAnimationFrame(loop) : null;
  }
  function kickVoice() { if (V.raf == null && V.ctx) V.raf = requestAnimationFrame(loop); }

  // ---- conversation engine (assets/voiceconvo.js) ---------------------------
  // The mic, wake word, attention window, endpointing, echo filter, and turn
  // routing all live in the HubVoiceConvo state machine. voice.js keeps the
  // orb, earcons, TTS glue, and hotkeys, and delegates the old call API to it.
  let convo = null; // assigned below, after the TTS factory provides speak/stopSpeak

  // ---- text-to-speech (engines live in assets/voicetts.js) -----------------
  // The browser + neural TTS engines, the ChunkPipeline, and the single
  // stopSpeak() barge-in path were lifted into voicetts.js to keep this file
  // under the 500-line rule. reListenSoon (the after-reply hook) now hands the
  // turn back to the conversation engine instead of blindly re-opening the mic.
  const _tts = window.HubVoiceTTS({ SS, store, V, setState, say, isMobileDevice,
    reListenSoon: () => { if (convo) convo.onReplyDone(); else setState('idle'); },
    // rtt: stamps the moment audio actually starts (speakBrowser's u.onstart /
    // playBlob's el.onplay) — see markRttEnd below. Hoisted function decl, so
    // this reference is valid even though markRttEnd is defined further down.
    markRttEnd: () => markRttEnd() });
  // The reply speech queue + run-reply hooks (replyStart/Text/Done) live in
  // voicetts.js alongside the engines they drive; voice.js keeps the orb and
  // hotkeys. stopSpeak here is the queue-aware barge-in.
  const { speak, speakBrowser, stopSpeak, speakingNow, queueBusy, csmFetch, playBlob,
          replyStart, replyText, replyDone } = _tts;

  // Build the conversation engine now that speak/stopSpeak/queueBusy exist.
  convo = window.HubVoiceConvo = window.HubVoiceConvoFactory({
    SR, store, V, setState, say, micBlockReason, earOpen, earClose,
    wakeRe, stripWake, speak, stopSpeak, queueBusy,
  });
  // Legacy call API — every existing call site (orb, jarvistab, hotkeys) keeps
  // working; a "call" is now an open conversation with the silence window.
  function beginCall() { convo.open(); }
  function endCall() { convo.close(); }

  // ---- shared mic analyser for the orb waveform (assets/jarvisorb.js) ------
  // SpeechRecognition (voiceconvo.js's mic) exposes no raw audio — the Web
  // Speech API only ever hands back a transcript — so the orb's waveform
  // corona needs its OWN tap on the mic purely for visualization. This is a
  // second, independent getUserMedia() stream (fftSize 128 AnalyserNode,
  // never connected to a destination — capture only, no echo). It is
  // additive: it never touches SR/voiceconvo's recognition lifecycle, and it
  // is acquired/released purely off V.call so it's live only while a
  // conversation is actually open, same as the browser's own mic light.
  let micStream = null, analyserCtx = null, analyser = null, analyserBuf = null, analyserBusy = false;
  async function ensureAnalyser() {
    if (analyser || analyserBusy || !navigator.mediaDevices) return;
    analyserBusy = true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      analyserCtx = analyserCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (analyserCtx.state === 'suspended') analyserCtx.resume();
      const src = analyserCtx.createMediaStreamSource(micStream);
      analyser = analyserCtx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser); // capture only — no connect(analyserCtx.destination)
      analyserBuf = new Uint8Array(analyser.frequencyBinCount);
      if (window.jarvisOrb) jarvisOrb.setAudio({ analyser, buf: analyserBuf });
    } catch {
      // mic denied/unavailable — the orb just falls back to its synthetic
      // breathing motion, same as before this feature existed.
    }
    analyserBusy = false;
  }
  function releaseAnalyser() {
    if (!micStream && !analyser) return;
    try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
    micStream = null; analyser = null; analyserBuf = null;
    if (window.jarvisOrb) jarvisOrb.setAudio(null);
  }
  // 400ms watcher, same cadence as jarvisorb.js's own visibility watcher —
  // acquire the instant a conversation opens, release the instant it closes.
  setInterval(() => { if (!VOICE_DISABLED) (V.call ? ensureAnalyser() : releaseAnalyser()); }, 400);

  // ---- rtt: end-of-turn → first spoken audio, rolling last-3 average -------
  // "End of turn" is approximated by onRunStart() (fires right after the
  // conversation engine posts /api/run — a few ms after STT's endpoint, the
  // soonest safe hook without touching voiceconvo.js's recognition timers).
  // "First audio" is the existing onstart/onplay hooks inside voicetts.js
  // (speakBrowser / playBlob) — passed in via markRttEnd so this stays a
  // pure timestamp read, no change to the speak/queue control flow.
  let rttStart = 0;
  const rttSamples = [];
  function markRttStart() { rttStart = performance.now(); }
  function markRttEnd() {
    if (!rttStart) return;
    const dt = (performance.now() - rttStart) / 1000;
    rttStart = 0;
    rttSamples.push(dt); if (rttSamples.length > 3) rttSamples.shift();
    const el = $('#jrtt'); if (el) el.textContent = 'rtt ' + rttText();
  }
  function rttText() {
    if (!rttSamples.length) return '';
    const avg = rttSamples.reduce((a, b) => a + b, 0) / rttSamples.length;
    return avg.toFixed(1) + 's';
  }

  // ---- run lifecycle hooks (called from run.js) ----------------------------
  // Thin wrappers over the reply queue in voicetts.js. onRunStart opens a fresh
  // queue (barge-in on the previous reply); onAssistantText speaks each block as
  // it streams (progress narration + the answer) so long CLI wind-down doesn't
  // read as lag; onRunDone closes the queue so the mic/orb transitions once.
  function onRunStart() { if (!VOICE_DISABLED) { markRttStart(); replyStart(); } }
  function onAssistantText(text) {
    if (VOICE_DISABLED) return;
    if (convo) convo.noteReply(text); // feed the self-echo filter BEFORE audio plays
    replyText(text);
  }
  function onRunDone(text) {
    if (VOICE_DISABLED) return;
    if (convo && text) convo.noteReply(text);
    replyDone(text);
  }

  function init() {
    if (VOICE_DISABLED) return; // see kill switch note at top of file
    if (!SR && !SS) return; // nothing available at all
    // Reroute off Sesame: anyone left on the retired CSM default from earlier
    // testing falls back to the instant browser engine (Kokoro stays opt-in).
    if (store.engine === 'csm') store.engine = 'browser';
    buildOrb();
    const orb = $('#voiceOrb');
    if (orb && !store.mic) orb.style.display = 'none';
    if (SS && SS.onvoiceschanged === null) SS.onvoiceschanged = () => {}; // prime async voice list
    // Unlock speech on the first user gesture so mobile auto-read isn't blocked
    // by the browser's autoplay policy (see primeAudio). Passive + once each.
    ['pointerdown', 'touchend', 'keydown'].forEach(ev =>
      document.addEventListener(ev, primeAudio, { once: true, passive: true }));
    // Mobile auto-read depends on the Kokoro sidecar (speak() routes phones
    // through the neural audio-element path because iOS blocks async
    // speechSynthesis, and the browser fallback is that same blocked path).
    // The hub self-heals the sidecar (boot warm-start + on-demand respawn in
    // lib/voice.js); if the probe still finds it down, nudge it awake so the
    // first reply doesn't pay the model-load wait. Only a missing INSTALL is
    // worth a message — that needs the PC once.
    if (isMobileDevice() && store.engine === 'browser') {
      fetch('/api/voice/status?engine=kokoro').then(r => r.json()).then(s => {
        // health statuses: "loading" | "ready" | "error" — "ready" serves.
        // (the old check here compared against 'ok', which the sidecar never
        // reports, so phones were told to start an engine that WAS running)
        if (!s || s.status === 'ready' || s.status === 'loading') return;
        if (s.installed) fetch('/api/voice/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Hub-Token': (typeof HUB_TOKEN !== 'undefined' ? HUB_TOKEN : '') },
          body: JSON.stringify({ engine: 'kokoro' }),
        }).catch(() => {});
        else say('Spoken replies need the Kokoro voice engine, which isn\'t installed yet — see Config → Voice on the PC (one-time ~340 MB setup).', 'sys');
      }).catch(() => {});
    }
    // The moment you start texting me, I go quiet — stop the reply mid-sentence.
    // (Spoken barge-in is the conversation engine's name-based interrupt.)
    document.addEventListener('input', e => {
      const t = e.target;
      if (t && t.id === 'promptIn' && queueBusy()) stopSpeak();
    });
    document.addEventListener('keydown', e => {
      // Esc always kills talk-back (both engines + the queue), even when a call isn't active
      if (e.key === 'Escape' && queueBusy()) stopSpeak();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && V.call) { e.preventDefault(); endCall(); return; }
      if (e.key !== 'v' && e.key !== 'V') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!store.mic || !SR) return;
      e.preventDefault();
      convo ? convo.toggle() : beginCall();
    });
  }

  window.HubVoice = {
    init, onRunStart, onRunDone, onAssistantText, speak, beginCall, endCall,
    _state: () => V.state, _call: () => V.call,
    // True while an in-flight run was voice-initiated (set by voiceconvo before
    // routeSend, cleared on convo close). run.js reads it to send the 'spoken'
    // output-contract channel when a voice turn is routed through the Run tab.
    _voiceTurn: () => V.voiceTurn,
    // rolling last-3-turn avg, end-of-turn → first spoken audio; '' until a
    // voice turn has actually spoken once (jarvistab.js only shows the badge
    // when this returns something).
    _rtt: () => rttText(),
    _disabled: VOICE_DISABLED,
    // closure internals for the Config settings panel (assets/voicecfg.js,
    // loaded right after this file — it attaches HubVoice.renderSettings)
    _cfg: { SS, SR, store, speakBrowser, csmFetch, playBlob, stopSpeak, setState, V, micBlockReason, wakeRe, stripWake },
    renderSettings: (container) => {
      if (VOICE_DISABLED && container) {
        container.innerHTML = `<h2 style="font-size:12px;margin-top:22px">Voice</h2>
          <div class="note">Disabled for now — the voice module needs a rebuild before it's worth using
          (mic reliability, wake-word gate, and CSM latency all need rework). Code is intact in
          <span class="mono">assets/voice.js</span>; flip the <span class="mono">VOICE_DISABLED</span>
          flag at the top of that file to bring it back for testing.</div>`;
        return;
      }
    }, // real renderSettings attaches below when not disabled
  };
  if (!VOICE_DISABLED) window.HubVoice.renderSettings = () => {}; // voicecfg.js overwrites this
})();
