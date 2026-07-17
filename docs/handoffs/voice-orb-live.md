# Handoff 3: Voice orb — wire every dead control live

**Status: READY (user priority #3, 2026-07-17).** Model: Opus 4.8.
User decision: wire ALL the dead Jarvis-tab controls, don't cut them.

## The work (in order)

1. **Mic-driven orb waveform.** `jarvisorb.js pullAudio()` reads
   `O.audio.analyser` but nothing ever assigns `O.audio`. When the user
   grants a mic (voice.js already acquires the stream for STT/calls), create
   ONE shared `AudioContext` + `AnalyserNode` (fftSize 128) on that stream
   and hand it over: `window.jarvisOrb && jarvisOrb.setAudio({ analyser, buf: new Uint8Array(analyser.frequencyBinCount) })`.
   Add the tiny `setAudio` setter to jarvisorb.js. Release on call end.
   ⚠ Wire from where voice.js ALREADY holds the stream — do not change how
   voice acquires/uses the mic (barge-in etc. untouchable).
2. **Real rtt badge.** `#jrtt` never updates (`HubVoice._rtt` doesn't
   exist). Measure what the user feels: time from end-of-speech (STT final)
   to first TTS audio of the reply, keep a rolling last-3 average in
   voice.js, expose `HubVoice._rtt()` → "1.8s". Update the badge on each
   turn. If measuring inside voice.js risks touching guarded code paths,
   measure in jarvischat (send→first assistant text) as "reply 1.8s" instead.
3. **◐ think → extended thinking.** Make it a toggle that adds
   "ultrathink" handling to the NEXT in-tab send: pill lights up, the send
   passes a `think: true` flag, `lib/runs.js` maps it to the CLI's thinking
   budget (check `claude --help` for the current flag; if none exists,
   prepend the prompt with an ultrathink directive). One-shot: auto-clears
   after the send.
4. **Timeline dots → jump.** The thread-timeline dots (`renderTimeline`)
   are decorative. Make each dot scroll `#jconv` to that turn (store an
   element ref per turn as they render; dot click → scrollIntoView + a
   brief highlight). The → end-cap scrolls to bottom.

## Constraints
Voice module behavior (barge-in, Kokoro self-heal, reply queue, statuses) is
EXACTLY as the user wants — additive wiring only, never restructure voice.js
flows. Zero-dep; file caps; smoke + browser verify (real mic test needs the
user — flag it in your final reply if you can't exercise it headless).
