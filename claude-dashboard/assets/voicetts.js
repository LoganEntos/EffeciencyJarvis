/* Voice text-to-speech engines — split out of voice.js to keep every file
   under the repo's 500-line rule. Holds the browser (speechSynthesis) voice,
   the neural pipeline (Kokoro / Sesame CSM via the hub's /api/voice/tts proxy),
   the fetch-ahead ChunkPipeline, and the single stopSpeak() barge-in path.

   voice.js owns STT, the orb, the hands-free call loop and lifecycle hooks; it
   builds this module by calling window.HubVoiceTTS(ctx) with the shared state
   it needs (V, store, setState, reListenSoon, say, isMobileDevice) and wires
   the returned functions back into its closure. Loaded BEFORE voice.js so the
   HubVoiceTTS factory global exists when voice.js's IIFE runs. */
'use strict';
window.HubVoiceTTS = function (ctx) {
  const { SS, store, V, setState, reListenSoon, say, isMobileDevice } = ctx;

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
    // On phones, browser speechSynthesis can't auto-read from an async reply
    // (iOS blocks speak() outside a live gesture — priming doesn't cure it).
    // Route mobile auto-read through the neural audio-element path instead,
    // which iOS honors once the element is unlocked on first tap (primeAudio).
    // speakCSM's csmFetch defaults to Kokoro when the stored engine is browser.
    const mobileNeural = isMobileDevice() && store.engine === 'browser';
    return (store.neural || mobileNeural) ? speakCSM(clean) : speakBrowser(clean);
  }
  // iOS/Chrome both suspend speechSynthesis after ~15 s, cutting long replies
  // off mid-sentence; a periodic pause()+resume() keeps the queue alive.
  function stopTtsKeepAlive() { if (V.ttsKA) { clearInterval(V.ttsKA); V.ttsKA = null; } }
  function speakBrowser(clean) {
    if (!SS || !clean) return false;
    SS.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(); if (v) u.voice = v;
    u.rate = store.rate;
    u.onstart = () => { setState('speaking'); stopTtsKeepAlive(); V.ttsKA = setInterval(() => { try { if (SS.speaking) { SS.pause(); SS.resume(); } } catch {} }, 9000); };
    u.onend = u.onerror = () => {
      stopTtsKeepAlive();
      if (V.call) reListenSoon(200);        // reply finished → your turn again
      else if (V.state === 'speaking') setState('idle');
    };
    SS.speak(u); SS.resume();               // resume: iOS parks the queue post-gesture
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
  // A generic fetch-ahead → play-in-order pipeline. Given ordered `chunks`, it
  // fetches each (opts.fetch → Promise<blob>) back-to-back so the synth engine
  // never idles, and plays them strictly in order (opts.play(blob, next)) the
  // moment each lands. This is the chunk/fetch/play interleaving that used to
  // live tangled inside speakCSM; the CSM-specific policy is injected:
  //   opts.isStale()  → abort every callback on barge-in (a newer reply began)
  //   opts.onDone()   → the last chunk finished playing
  //   opts.onError(e, firstUnplayed) → a fetch rejected. firstUnplayed means
  //     chunk 0 failed before any audio, so the caller does a full fallback;
  //     otherwise the pipeline truncates to what already played and stops.
  function ChunkPipeline(chunks, opts) {
    const ready = [];               // blobs by chunk index, filled as fetches land
    let fetchIdx = 0, playIdx = 0, playing = false, len = chunks.length;
    function playNext() {
      if (opts.isStale()) return;
      if (playIdx >= len) { opts.onDone(); return; }
      const blob = ready[playIdx];
      if (!blob) { playing = false; return; } // not synthesized yet — a fetch cb resumes us
      playing = true;
      opts.play(blob, playNext);
      ready[playIdx] = null; playIdx++;
    }
    function fetchNext() {
      if (opts.isStale() || fetchIdx >= len) return;
      const i = fetchIdx++;
      opts.fetch(chunks[i]).then(blob => {
        if (opts.isStale()) return;
        ready[i] = blob;
        fetchNext();                          // keep the engine busy on the next chunk
        if (!playing && playIdx === i) playNext();
      }).catch(e => {
        if (opts.isStale()) return;
        const firstUnplayed = (i === 0 && !playing);
        opts.onError(e, firstUnplayed);
        if (!firstUnplayed) {                 // mid-reply — stop after what's queued
          len = Math.min(len, i);
          if (!playing) playNext();
        }
      });
    }
    return { start: fetchNext };
  }

  let csmWarned = false;
  // Returns true optimistically (the wav arrives async). Drives a ChunkPipeline:
  // if the FIRST chunk fails, falls back to browser TTS for the whole utterance
  // so the call loop stays alive; a mid-utterance failure just ends the reply.
  function speakCSM(clean) {
    stopSpeak();
    const gen = ++V.csmGen;
    V.csmPending = true; // stays true across inter-chunk gaps (barge-in guard)
    const stale = () => gen !== V.csmGen;
    ChunkPipeline(csmChunks(clean), {
      isStale: stale,
      fetch: (chunk) => csmFetch(chunk),
      play: (blob, next) => playBlob(blob, next),
      onDone: () => {
        if (stale()) return;
        V.csmPending = false;
        if (V.call) reListenSoon(200);
        else if (V.state === 'speaking') setState('idle');
      },
      onError: (e, firstUnplayed) => {
        if (!csmWarned) {
          csmWarned = true;
          const eng = store.neural ? store.engine : 'kokoro'; // mirrors csmFetch's default
          say((eng === 'csm' ? 'CSM' : 'Kokoro') + ' voice unavailable — using the browser voice instead. (' + String((e && e.message) || e).slice(0, 120) + ')', 'errmsg');
        }
        if (firstUnplayed) {                  // nothing spoken yet — full fallback
          V.csmPending = false;
          if (!speakBrowser(clean)) {
            if (V.call) reListenSoon(400);
            else if (V.state === 'speaking' || V.state === 'thinking') setState('idle');
          }
        }
      },
    }).start();
    return true;
  }

  // True while ANY engine is (or is about to be) talking — barge-in guard.
  const speakingNow = () => (SS && SS.speaking) || V.csmPending || (V.audioEl && !V.audioEl.paused);
  // The one place speech dies (SS + in-flight CSM fetch + CSM audio element);
  // every barge-in path — typing, Esc, run start, orb click — funnels here.
  function stopSpeak() {
    stopTtsKeepAlive();
    if (SS) SS.cancel();
    V.csmGen++; V.csmPending = false;
    if (V.audioEl) { try { V.audioEl.onended = V.audioEl.onerror = null; V.audioEl.pause(); V.audioEl.currentTime = 0; } catch {} }
    if (V.audioUrl) { try { URL.revokeObjectURL(V.audioUrl); } catch {} V.audioUrl = null; }
    if (V.state === 'speaking') setState('idle');
  }

  return { speak, speakBrowser, speakCSM, stopSpeak, speakingNow, csmFetch, playBlob };
};
