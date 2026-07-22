# Voice communication plan — talk to the hub, it talks back

User directive (2026-07-10 late eve): plan voice communication; "that's what
the hermes stack is built for." Verified against hermes v0.18.2's shipped
config: `stt:` (local faster-whisper, enabled by default, free) and `tts:`
(Edge TTS default, free; Gemini/ElevenLabs optional) plus a `text_to_speech`
tool in every platform toolset, and voice-message transcription on all
gateway platforms. Voice is native to the stack — we mostly wire surfaces.

## Track A — hub voice loop (N9) — ✅ SHIPPED 2026-07-10 late eve

Built as `assets/voice.js` (self-contained, ~230 lines, zero server cost).
Browser-verified: voice.js served 200; no console errors; SpeechRecognition +
speechSynthesis both available (7 voices); mic orb injects into the header and
toggles from Config; run-lifecycle hooks drive orb state (onRunStart→thinking,
onRunDone+talkback→speaking, no-talkback→idle); talk-back confirmed speaking=
true on a fake reply; `sendPrompt` global present so a final transcript
auto-sends. LIVE mic capture (actual speech → text) needs a real microphone +
user gesture and is the one manual check — the whole pipeline around it is
verified. Settings persist in localStorage; both toggles default OFF.

Original design (as built):

1. **Mic in**: amber orb button in the hub header. Click (or hotkey `V`) →
   `webkitSpeechRecognition` (Chrome/Edge desktop) → live transcript into the
   Run composer → auto-send as a normal auto-routed run.
2. **Voice out**: when a run finishes, feed its final text block to
   `speechSynthesis` (voice picker + rate in Config, persisted in
   localStorage; default OFF so the hub stays silent until asked).
3. **The orb**: canvas state machine — idle (slow amber breath) · listening
   (waveform ring) · thinking (pulse synced to run status) · speaking
   (amplitude flicker). Reuses the agentviz drawing vocabulary.
4. Files: `assets/voice.js` (new, <200 lines), header hook in `index.html`,
   settings row in Config tab. Zero dependencies, zero server cost.

Caveats: Web Speech API needs Chrome/Edge (desktop) — iOS Safari's support is
partial; phone voice arrives properly via Track B. Recognition audio goes
through the browser vendor's speech service (note in Config tooltip).

## Track B — hermes-native voice (pairs with H4 gateway toggle)

The "pocket Jarvis": message hermes a VOICE NOTE from the phone, get a spoken
answer back — no hub UI involved.

1. `hermes gateway` + one platform (Telegram is the least-friction start —
   bot token, no phone pairing). H4 = on/off toggle + status in the hub.
2. STT already on: `stt.enabled: true`, provider local (faster-whisper
   `base`) — voice notes transcribe for free, offline.
3. TTS reply: enable the `tts` tool (Edge TTS, free) so hermes can answer
   with an audio message when asked to "say it".
4. Hub visibility: gateway sessions surface in the Graph tab via Envoy node
   (H3 wiring), and spend stays on hermes's meter (Nous Portal).

## Track C — parked until A+B prove out

- Wake word / always-listening ("Hey hub") — needs local keyword spotting.
- Full-duplex streaming conversation (talk over each other) — heavy.
- `hermes desktop` / `gui` surfaces — evaluate after gateway.
- Better voices: Gemini TTS personas or ElevenLabs (paid) — only if Edge TTS
  grates.

## Order of execution

1. **N9 / Track A** — next build session (all zero-dep, browser-verified).
2. **H4 + Track B** — right after, needs user's Telegram bot token (2 min).
3. Track C — revisit once A+B are daily-driven.
