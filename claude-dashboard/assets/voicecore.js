/* Voice low-level audio plumbing — split out of voice.js to keep every file
   under the repo's 500-line rule. Holds the WebAudio turn earcons, the mobile
   autoplay gesture-unlock (primeAudio + its silent-WAV helper), and the
   coarse mobile-device check they share. All three are browser audio-capability
   concerns that hang off one shared AudioContext (actx), so they live together.

   The old CSM chunk pipeline the 07-14 backlog sketch paired with the earcons
   was already lifted into voicetts.js (csmChunks/speakCSM/playBlob/ChunkPipeline)
   in an earlier split, so this module takes the earcons + audio-unlock seam that
   actually remains in voice.js.

   Factory pattern (same as voicetts.js / voiceconvo.js): voice.js instantiates
   with the shared state it needs (SS, V) and wires the returned functions back
   into its closure — earOpen/earClose are handed to the conversation engine,
   isMobileDevice to the TTS engine, primeAudio to the first-gesture unlock.
   Loaded BEFORE voice.js so the HubVoiceCore factory global exists when
   voice.js's IIFE runs. */
'use strict';
window.HubVoiceCore = function (ctx) {
  const { SS, V } = ctx;

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

  // ---- gesture unlock (mobile autoplay) ------------------------------------
  // Mobile browsers (iOS Safari especially, Android Chrome too) only let
  // speechSynthesis produce sound if a *prior* SS.speak() ran inside a real
  // user gesture. Our auto-read fires later, from an async run-completion
  // callback with no gesture on the stack, so it's silently blocked. The fix:
  // on the very first tap/key, speak a zero-volume blank to open the channel
  // (and resume any suspended AudioContext for the earcons). Once → done.
  let speechPrimed = false;
  function primeAudio() {
    if (speechPrimed) return;
    speechPrimed = true;
    try {
      // The AUDIBLE primer is a mobile-only need: iOS Safari only opens the
      // speech channel when an audible utterance runs inside a real gesture —
      // a volume:0 primer never unlocks it, so async auto-reads stayed silent
      // on phones. Desktop has no such block, and the faint blip there could
      // clip the first earcon — so desktop keeps only the silent unlocks below.
      if (SS && isMobileDevice()) {
        const u = new SpeechSynthesisUtterance('.');
        u.volume = 0.05; u.rate = 2;
        SS.cancel(); SS.speak(u); SS.resume();
      }
    } catch {}
    try { if (actx && actx.state === 'suspended') actx.resume(); } catch {}
    // Unlock the <audio> element too: iOS only lets HTMLAudioElement.play() run
    // programmatically later if it was first played inside a gesture. Play a
    // silent (inaudible-content) clip now so neural TTS auto-read works on phones.
    try {
      const el = V.audioEl = V.audioEl || new Audio();
      el.src = silentWavUrl();
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
      Promise.resolve(p).finally(() => { try { el.pause(); el.currentTime = 0; } catch {} });
    } catch {}
  }
  // A tiny, valid, silent WAV as a blob URL — used only to unlock the audio
  // element on the first user gesture (see primeAudio). Built at runtime so we
  // never ship a base64 blob that some browser rejects.
  function silentWavUrl() {
    const n = 256, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, n, true);
    for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128); // 8-bit PCM midpoint = silence
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  // On a phone the hub is voice-first: read replies aloud automatically, no
  // talk-back toggle needed. Gated on a coarse pointer AND no hover — not a
  // pixel width, which broke on an iPhone in landscape (~844px > the old
  // 820px cap, so rotating the phone silently turned auto-read off). Touch
  // laptops still fail the test (their primary pointer is fine + they hover).
  function isMobileDevice() {
    try {
      return !!(window.matchMedia
        && window.matchMedia('(pointer: coarse)').matches
        && window.matchMedia('(hover: none)').matches);
    } catch { return false; }
  }

  return { earOpen, earClose, primeAudio, isMobileDevice };
};
