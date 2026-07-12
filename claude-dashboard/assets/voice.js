/* Voice module (N9 Track A + hands-free call) — talk to the hub, it talks back.
   Zero-dependency, browser-native: webkitSpeechRecognition for the mic,
   speechSynthesis for the reply, WebAudio for turn earcons, a small canvas orb
   in the header for state. No server cost: speech never leaves the browser
   except through the vendor's own speech service.

   Two ways to talk:
     • One-shot  — click the orb (or press V): speak once, it sends & replies.
     • Call mode — a hands-free loop: after Claude finishes speaking, the mic
       re-opens automatically so you can go back and forth without the keyboard.
       Start with Shift+click / long-press the orb (or when "hands-free" is on in
       Config, a normal click starts it). End with Esc, a click, or two silences.

   Public surface (window.HubVoice):
     init()                    - inject the orb + wire hotkeys (called from boot)
     onRunStart()              - a run began → orb goes "thinking"
     onRunDone(text, meta)     - a run ended → orb idle; speak text if talkback/call
     renderSettings(container) - Config-tab settings block
*/
'use strict';
(function () {
  // ---- KILL SWITCH (user, 2026-07-11 late night) --------------------------
  // "the voice module is absolutely awful and needs to be disabled and
  // reassessed much later." Hard-disabled by default: no orb, no hotkey, no
  // auto-talkback, regardless of any localStorage flags left over from
  // earlier sessions. Flip VOICE_DISABLED back to false to bring it back for
  // re-evaluation — the engine code below is untouched, just gated off.
  const VOICE_DISABLED = true;
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
    get wake() { try { return (localStorage.getItem('hub.voice.wake') || 'Suzy').trim() || 'Suzy'; } catch { return 'Suzy'; } },
    set wake(v) { try { localStorage.setItem('hub.voice.wake', String(v || '').trim()); } catch {} },
    // wake-word gate on/off (default ON — user asked: don't interrupt unless named)
    get wakeGate() { try { const v = localStorage.getItem('hub.voice.wakegate'); return v === null ? true : v === '1'; } catch { return true; } },
    set wakeGate(v) { try { localStorage.setItem('hub.voice.wakegate', v ? '1' : '0'); } catch {} },
  };
  const silenceMs = () => Math.round(store.pause * 1000);

  // Wake-word gate. In a hands-free call the mic re-opens between turns, so room
  // noise or my own talk-back bleeding back through the speakers used to get
  // transcribed and fired as a spurious turn — "you interrupted yourself" with
  // nothing actually said. With the gate on, a re-listened utterance is only
  // acted on if it addresses me by name (default "Suzy"); the name is then
  // stripped from the prompt. Matches the name as a whole word, tolerant of the
  // common misrecognitions of "Suzy". A custom wake word matches literally.
  function wakeRe() {
    const w = store.wake || 'Suzy';
    const body = /^suzy$/i.test(w) ? '(?:suzy|susie|suzie|susy|soozy|sussy)'
                                   : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + body + '\\b', 'i');
  }
  function stripWake(text) {
    return String(text || '').replace(wakeRe(), ' ')
      .replace(/\s+/g, ' ').replace(/^[\s,.:;!?—-]+/, '').trim();
  }

  // V.call = hands-free loop active; V.silence = consecutive empty listens;
  // V.reTimer = pending re-open timer; V.press = long-press timer on the orb.
  const V = { state: 'idle', rec: null, listening: false, call: false, silence: 0,
    reTimer: null, press: null, raf: null, canvas: null, ctx: null, t0: performance.now(),
    // CSM audio: csmGen invalidates in-flight fetches on barge-in
    audioEl: null, audioUrl: null, csmGen: 0, csmPending: false };

  function css(name, fb) { return (getComputedStyle(document.documentElement).getPropertyValue(name) || fb).trim() || fb; }

  // ---- earcons (WebAudio) — a soft rising blip when the mic opens for your
  // turn, a falling one when the call hangs up. Purely cosmetic; fails silent.
  let actx = null;
  function tone(freqs, step) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime;
      freqs.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
        const s = t + i * step;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.06, s + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, s + step + 0.05);
        o.start(s); o.stop(s + step + 0.08);
      });
    } catch {}
  }
  const earOpen = () => tone([620, 880], 0.09);   // "your turn"
  const earClose = () => tone([560, 360], 0.10);   // "hanging up"

  // Surface a message in the chat log so mic problems are never silent.
  function say(msg, cls) {
    try { goTab('run'); ensureRunUI(); if (typeof addMsg === 'function') addMsg(msg, cls || 'sys'); } catch {}
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
    // Long-press (400ms) starts a hands-free call; a plain tap is one-shot.
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
      if (V.call) { endCall(); return; }                    // click hangs up a call
      if (V.state === 'speaking') { stopSpeak(); return; }
      const blocked = micBlockReason();
      if (blocked) { say(blocked, 'errmsg'); return; }        // tell the user why, don't sit silent
      if (e.shiftKey) { beginCall(); return; }               // Shift+click = start call
      if (V.listening) { stopListen(); return; }
      store.conv ? beginCall() : startListen();              // hands-free pref → call
    };
    loop();
  }

  function orbTitle() {
    if (!SR) return 'Voice input needs Chrome or Edge (desktop) · talk-back works everywhere';
    if (V.call) return 'In a call — click or press Esc to hang up';
    return 'Voice — tap to talk once · Shift+click or long-press for a hands-free call (V)';
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

  // ---- speech-to-text ------------------------------------------------------
  function startListen() {
    const blocked = micBlockReason();
    if (blocked) { say(blocked, 'errmsg'); if (V.call) endCall(); return; }
    if (speakingNow()) stopSpeak();
    const rec = new SR();
    // continuous=true so a pause mid-thought doesn't end the turn; we decide when
    // you're done ourselves via a silence timer, so you never get cut off.
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    V.rec = rec; V.listening = true; V.sentByTimer = false; setState('listening');
    goTab('run'); ensureRunUI();
    const ta = $('#promptIn'); const pre = ta ? ta.value : '';
    rec.onresult = (e) => {
      // rebuild the whole transcript each event (results accumulate with continuous)
      let full = '';
      for (let i = 0; i < e.results.length; i++) full += e.results[i][0].transcript;
      full = full.replace(/\s+/g, ' ').trim();
      if (ta) ta.value = (pre ? pre + ' ' : '') + full;
      V.finalText = full;
      // restart the "you've stopped talking" countdown on every bit of speech
      clearTimeout(V.silTimer);
      if (full) V.silTimer = setTimeout(() => { V.sentByTimer = true; try { V.rec && V.rec.stop(); } catch {} }, silenceMs());
    };
    rec.onerror = (e) => {
      V.listening = false;
      const reason = ({
        'not-allowed': 'Microphone permission denied. Click the 🔒/mic icon in the address bar → Allow, and check Windows Settings → Privacy → Microphone (both "apps" and "desktop apps" toggles on).',
        'service-not-allowed': 'Speech service blocked — usually an insecure origin or a Windows mic-privacy setting.',
        'audio-capture': 'No microphone found. Plug one in / enable it in Windows Sound settings, then try again.',
        'no-speech': "Didn't catch anything — speak a moment after the blip.",
        'network': 'Speech-recognition network error (Chrome/Edge send audio to their speech service — needs internet).',
        'aborted': '',
      })[e && e.error] || ('Voice input error: ' + ((e && e.error) || 'unknown'));
      // don't spam "didn't catch anything" every quiet turn of a call
      if (reason && !(V.call && e && e.error === 'no-speech')) say(reason, 'errmsg');
      // a real failure (not just silence) should end a call rather than loop on the error
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture')) { endCall(); return; }
      if (V.call) reListenSoon(600); else if (V.state === 'listening') setState('idle');
    };
    rec.onend = () => {
      V.listening = false;
      clearTimeout(V.silTimer);
      const heard = V.finalText;
      V.finalText = '';
      let send = heard;
      // Wake-word gate (call mode only): unless the utterance names me, treat it
      // as noise — don't send, don't cut off my reply. Say "Suzy …" to talk.
      if (heard && V.call && store.wakeGate) {
        send = wakeRe().test(heard) ? stripWake(heard) : '';
      }
      // keep the composer in sync with what will actually be sent (noise → clear)
      if (ta) ta.value = send ? ((pre ? pre + ' ' : '') + send) : pre;
      // sendPrompt() reads #promptIn and self-guards on an already-running chat
      if (send && typeof sendPrompt === 'function') {
        V.silence = 0; setState('thinking'); sendPrompt();
      } else if (V.call) {
        // nothing for me this turn (silence, or noise without the wake word).
        // When gated, be slower to hang up — she's clearly around, just not
        // addressing me; keep the line open longer before giving up.
        if (++V.silence >= (store.wakeGate ? 6 : 2)) endCall(true);
        else reListenSoon(400);
      } else setState('idle');
    };
    try { rec.start(); } catch { if (V.call) reListenSoon(600); else stopListen(); }
  }
  function stopListen() {
    V.listening = false;
    clearTimeout(V.silTimer);
    try { V.rec && V.rec.stop(); } catch {}
    if (V.state === 'listening') setState('idle');
  }

  // ---- hands-free call loop ------------------------------------------------
  // A call is: listen → send → speak reply → (re-open mic) → repeat, until the
  // user hangs up (Esc/click) or two turns of silence. Talk-back is implied.
  function reListenSoon(ms) {
    clearTimeout(V.reTimer);
    if (!V.call) return;
    V.reTimer = setTimeout(() => {
      if (!V.call || (typeof chat === 'object' && chat.running)) return;
      earOpen();
      startListen();
    }, ms);
  }
  function beginCall() {
    if (V.call) return;
    const blocked = micBlockReason();
    if (blocked) { say(blocked, 'errmsg'); return; }
    V.call = true; V.silence = 0; kickVoice();
    earOpen();
    startListen();
  }
  function endCall(fromSilence) {
    if (!V.call) return;
    V.call = false; V.silence = 0;
    clearTimeout(V.reTimer);
    stopListen();
    earClose();
    setState('idle');
  }

  // ---- text-to-speech ------------------------------------------------------
  function pickVoice() {
    if (!SS) return null;
    const voices = SS.getVoices();
    if (!voices.length) return null;
    if (store.voiceURI) { const m = voices.find(v => v.voiceURI === store.voiceURI); if (m) return m; }
    return voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || voices[0];
  }
  // speak(text) → true iff it will produce audio (the call loop relies on this)
  function speak(text) {
    let clean = String(text || '').replace(/```[\s\S]*?```/g, ' (code block) ').replace(/[*_`#>]/g, '').trim();
    // CSM generates at ~0.4x realtime on this GPU, so its spoken cap is much
    // tighter: long replies would take longer to synthesize than anyone waits.
    // Kokoro is fast (near-realtime) so it gets the full browser-sized cap.
    // Full text is always on screen regardless.
    const cap = store.engine === 'csm' ? 400 : 700;
    if (clean.length > cap) {
      // never cut mid-word: end the spoken part at the last sentence that fits
      const head = clean.slice(0, cap);
      const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'));
      // close with a spoken hand-off so truncation sounds intentional, not like a cutoff
      clean = (end > Math.min(250, cap * 0.5) ? head.slice(0, end + 1) : head) + ' The rest is on screen.';
    }
    if (!clean) return false;
    return store.neural ? speakCSM(clean) : speakBrowser(clean);
  }
  function speakBrowser(clean) {
    if (!SS || !clean) return false;
    SS.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(); if (v) u.voice = v;
    u.rate = store.rate; u.onstart = () => setState('speaking');
    u.onend = u.onerror = () => {
      if (V.call) reListenSoon(200);        // reply finished → your turn again
      else if (V.state === 'speaking') setState('idle');
    };
    SS.speak(u);
    return true;
  }

  // ---- Sesame CSM-1B — always via the hub's same-origin proxy (never the
  // python server directly: CORS stays closed, loopback enforced server-side).
  function csmFetch(text, engine) {
    const eng = engine || (store.neural ? store.engine : 'kokoro');
    return fetch('/api/voice/tts?engine=' + eng, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Token': (typeof HUB_TOKEN !== 'undefined' ? HUB_TOKEN : '') },
      body: JSON.stringify({ text, speaker: store.csmSpeaker, engine: eng }),
    }).then(async r => {
      if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch {} throw new Error(m || ('HTTP ' + r.status)); }
      return r.blob();
    });
  }
  function playBlob(blob, onDone) {
    if (V.audioUrl) { try { URL.revokeObjectURL(V.audioUrl); } catch {} }
    V.audioUrl = URL.createObjectURL(blob);
    const el = V.audioEl = V.audioEl || new Audio();
    el.onplay = () => setState('speaking');
    el.onended = el.onerror = () => { if (onDone) onDone(); };
    el.src = V.audioUrl;
    // a rejected play() (autoplay policy, device change) must still advance
    // the chunk pipeline — otherwise `playing` stays true and the reply dies
    // silently ("not replying at all")
    return el.play().catch(() => { if (onDone) onDone(); });
  }
  // CSM synthesis on this GPU costs ~4.5 s fixed per request + ~0.07 s/char,
  // while the audio itself plays at ~0.065 s/char — generation barely keeps up,
  // so every chunk boundary risks a silence roughly the size of the NEXT
  // chunk's synthesis minus the CURRENT chunk's audio. Sizing therefore ramps:
  // first sentence alone (fast start), then a small chunk (short first gap),
  // then larger ones (fewer boundaries → less total silence). Fetches run
  // back-to-back so the GPU never idles.
  function csmChunks(text) {
    const sents = text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+\s*$/g) || [text];
    const out = []; let cur = '';
    for (const s of sents) {
      if (!out.length && !cur) { out.push(s.trim()); continue; } // first sentence ships alone
      if (cur && cur.length + s.length > (out.length === 1 ? 130 : 260)) { out.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.length ? out : [text];
  }
  let csmWarned = false;
  // Returns true optimistically (the wav arrives async). If the FIRST chunk
  // fails, falls back to browser TTS for the whole utterance so the call loop
  // stays alive; a mid-utterance failure just ends the reply early.
  function speakCSM(clean) {
    stopSpeak();
    const gen = ++V.csmGen;
    V.csmPending = true; // stays true across inter-chunk gaps (barge-in guard)
    const chunks = csmChunks(clean);
    const ready = [];               // blobs by chunk index, filled as fetches land
    let fetchIdx = 0, playIdx = 0, playing = false;

    const done = () => {
      if (gen !== V.csmGen) return;
      V.csmPending = false;
      if (V.call) reListenSoon(200);
      else if (V.state === 'speaking') setState('idle');
    };
    function playNext() {
      if (gen !== V.csmGen) return;
      if (playIdx >= chunks.length) { done(); return; }
      const blob = ready[playIdx];
      if (!blob) { playing = false; return; } // not synthesized yet — fetch cb resumes us
      playing = true;
      playBlob(blob, playNext);
      ready[playIdx] = null; playIdx++;
    }
    function fetchNext() {
      if (gen !== V.csmGen || fetchIdx >= chunks.length) return;
      const i = fetchIdx++;
      csmFetch(chunks[i]).then(blob => {
        if (gen !== V.csmGen) return;
        ready[i] = blob;
        fetchNext();                          // keep the GPU busy on the next chunk
        if (!playing && playIdx === i) playNext();
      }).catch(e => {
        if (gen !== V.csmGen) return;
        if (!csmWarned) { csmWarned = true; say('CSM voice unavailable — using the browser voice instead. (' + String((e && e.message) || e).slice(0, 120) + ')', 'errmsg'); }
        if (i === 0 && !playing) {            // nothing spoken yet — full fallback
          V.csmPending = false;
          if (!speakBrowser(clean)) {
            if (V.call) reListenSoon(400);
            else if (V.state === 'speaking' || V.state === 'thinking') setState('idle');
          }
        } else {                              // mid-reply — stop after what's queued
          chunks.length = Math.min(chunks.length, i);
          if (!playing) playNext();
        }
      });
    }
    fetchNext();
    return true;
  }

  // True while ANY engine is (or is about to be) talking — barge-in guard.
  const speakingNow = () => (SS && SS.speaking) || V.csmPending || (V.audioEl && !V.audioEl.paused);
  // The one place speech dies (SS + in-flight CSM fetch + CSM audio element);
  // every barge-in path — typing, Esc, run start, orb click — funnels here.
  function stopSpeak() {
    if (SS) SS.cancel();
    V.csmGen++; V.csmPending = false;
    if (V.audioEl) { try { V.audioEl.onended = V.audioEl.onerror = null; V.audioEl.pause(); V.audioEl.currentTime = 0; } catch {} }
    if (V.audioUrl) { try { URL.revokeObjectURL(V.audioUrl); } catch {} V.audioUrl = null; }
    if (V.state === 'speaking') setState('idle');
  }

  // ---- run lifecycle hooks (called from run.js) ----------------------------
  // Any new prompt — typed OR spoken — silences an in-progress reply at once.
  function onRunStart() { if (!VOICE_DISABLED) { if (speakingNow()) stopSpeak(); if (!V.listening) setState('thinking'); } }
  function onRunDone(text) {
    if (VOICE_DISABLED) return;
    // During a call, always talk back (it's a conversation) and keep the loop
    // alive even when a run returns no text (error/cancel) by re-opening the mic.
    if (V.call) {
      // speak's onend re-opens the mic; if there's nothing to say, re-open directly
      if (!(text && speak(text))) reListenSoon(500);
      return;
    }
    if (store.talk && text) speak(text);
    else if (V.state === 'thinking') setState('idle');
  }

  function init() {
    if (VOICE_DISABLED) return; // see kill switch note at top of file
    if (!SR && !SS) return; // nothing available at all
    buildOrb();
    const orb = $('#voiceOrb');
    if (orb && !store.mic) orb.style.display = 'none';
    if (SS && SS.onvoiceschanged === null) SS.onvoiceschanged = () => {}; // prime async voice list
    // The moment you start texting me, I go quiet — stop the reply mid-sentence.
    // (Barge-in rule; the spoken-input half arrives when we keep the mic open
    //  during talk-back — see startListen's SS.cancel for the manual version.)
    document.addEventListener('input', e => {
      const t = e.target;
      if (t && t.id === 'promptIn' && speakingNow()) stopSpeak();
    });
    document.addEventListener('keydown', e => {
      // Esc always kills talk-back (both engines), even when a call isn't active
      if (e.key === 'Escape' && speakingNow()) stopSpeak();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && V.call) { e.preventDefault(); endCall(); return; }
      if (e.key !== 'v' && e.key !== 'V') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!store.mic || !SR) return;
      e.preventDefault();
      if (V.call) { endCall(); return; }
      if (e.shiftKey) { beginCall(); return; }
      V.listening ? stopListen() : (store.conv ? beginCall() : startListen());
    });
  }

  window.HubVoice = {
    init, onRunStart, onRunDone, speak, beginCall, endCall,
    _state: () => V.state, _call: () => V.call,
    _disabled: VOICE_DISABLED,
    // closure internals for the Config settings panel (assets/voicecfg.js,
    // loaded right after this file — it attaches HubVoice.renderSettings)
    _cfg: { SS, SR, store, speakBrowser, csmFetch, playBlob, stopSpeak, setState, V, micBlockReason },
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
