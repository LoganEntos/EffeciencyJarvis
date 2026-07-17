# Handoff 2: Jarvis chat — Run-tab parity + chat-first panel

**Status: READY (user priority #2, 2026-07-17).** Model: Opus 4.8.
User decisions (2026-07-17 Q&A): the in-tab chat behaves "just like the Run
tab" — run-this fires in-tab, replies are spoken aloud, files attach by
paste/drop — and the chat OWNS the conversation panel.

## The work (in order)

1. **Chat-first panel ownership.** Today the desktop-session transcript tail
   (`pollTranscript`) and the in-tab chat share `#jconv` and can overwrite
   each other (poller pauses on send, resumes on done — resuming can clobber
   an on-screen chat with the session tail). Restructure: the chat owns
   `#jconv` permanently; the transcript tail moves to a **collapsed "live
   activity" strip** (a one-line `▸ live activity` toggle under the panel,
   like Overview's server-event tail) that expands to its own scroll area.
   Kill the pause/resume hooks entirely once the containers are separate.
2. **▷ run this → in-tab.** `jarvistab.js runShaped()` currently jumps to
   the Run tab and fires there. Change it to feed the shaped prompt into the
   in-tab chat (`jarvisChat.send` path) so the user never leaves Jarvis.
   Keep a small "⤴ run tab" secondary affordance for when they want the big
   composer.
3. **✅ DONE (`36bd72d`) — Speak replies aloud.** jarvischat now streams
   every assistant block through `HubVoice.onAssistantText` and closes with
   `onRunDone` (the same queue the Run tab uses), and gained `sendText()` —
   the voice conversation engine (`assets/voiceconvo.js`) routes spoken
   turns through it. ⚠ Constraint update: the conversation loop is now the
   voiceconvo state machine (user-approved rebuild) — coordinate with it,
   don't reintroduce a second mic path. Kokoro self-heal + the TTS reply
   queue in voicetts.js remain untouchable.
4. **File attach.** Paste/drop/📎 on the Jarvis chat composer, same inbox
   upload path as the Run tab (`attachFiles` pattern in run.js: images via
   clipboard items, docs via files; POST /api/files; pass refs in the run
   payload's `images`/`files`). Show attached chips above the composer.
5. **Session badge.** Show the in-tab session id (short) + a "＋ new" state
   in the panel header so the user can tell a resumed thread from a fresh one.

## Constraints
`jarvistab.js` is at 404 lines and `jarvischat.js` ~130 — attach + activity
strip will push growth: split rather than cross 500 (e.g. `jarvisattach.js`).
Voice behavior untouchable. Zero-dep. Review pipeline per README; verify by
sending a real prompt with a pasted image and hearing the reply speak.
