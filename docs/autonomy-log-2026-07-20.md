# Autonomy log — 2026-07-20

Continuous improvement loop (Fable-5 orchestrated). Each cycle = one
browser/smoke-verified, code-reviewed, committed improvement. Ground rules:
zero-dep, localhost-only, <500-line files, security invariants, no `$` figures.
Server changes verified on throwaway port 5758, never by touching live 5757.

## Cycle 1 — run.js over the 500-line rule (`723f243`)
- **Found:** `assets/run.js` at 619 lines (hard-rule violation).
- **Fix:** extracted the message-render layer (markdown, error formatting, the
  stream-json line renderer + chat-log DOM helpers) verbatim into new
  `assets/runrender.js` (140L), wired into index.html before run.js. run.js → 485L.
- **Verify:** node --check clean; smoke 100% green on 5758; code-reviewer clean.
- Also noted: the live-server smoke "failure" on the session-summaries listing
  was a STALE-SERVER false alarm (200 on a fresh 5758 boot) — clears on the
  user's next restart, not a code bug.
- Reusable cycle handoff written: `docs/handoffs/improvement-cycle.md` (`a0747bf`).

## Cycle 2 — app.js at the 500-line ceiling (`857edb8`)
- **Found:** `assets/app.js` at 499 lines (one line from breach).
- **Fix:** extracted the generic list renderer + agents/skills/commands/sessions
  tab renderers + detail overlay into new `assets/lists.js` (195L), loaded right
  after app.js. app.js → 310L.
- **Verify:** node --check clean; smoke 100% green on 5758; code-reviewer: SHIP.

## Cycle 3 — hermes trailing-line drop (`505a405`)
- **Found (via bug-hunt scout):** `lib/hermes.js` close handler never flushed a
  trailing partial stdout line — if hermes' final output wasn't newline-
  terminated, that last chunk was silently dropped from the chat. Deprecated
  engine path, no crash.
- **Fix:** flush the remaining buffer on close, guarded exactly like the read
  loop. node --check clean; smoke green on 5758.

## Scout verdict + loop status
- Full bug-hunt sweep across server.js + all lib/*.js + assets/*.js: **no other
  high-confidence correctness bugs.** Security invariants intact (token guard on
  all non-GET, traversal guards, loopback-only voice, argv-array spawns). Every
  file under 500 lines after cycles 1–2.
- Remaining near-ceiling files — `assets/voice.js` (474L), `assets/jarvistab.js`
  (469L) — are UNDER the limit; splitting them now would be speculative, so
  they're left for the edit that actually pushes one over (per the cycle rule).
- **Loop paused: out of high-confidence improvements.** Reusable continuation
  prompt: `docs/handoffs/improvement-cycle.md`.
