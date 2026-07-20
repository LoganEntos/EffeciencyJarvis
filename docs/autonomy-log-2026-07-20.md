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

## Next targets (queued)
- `assets/voice.js` (474L) and `assets/jarvistab.js` (469L) — near the ceiling;
  split before the next edit pushes either over.
- Bug-hunt scout dispatched across lib/*.js + assets/*.js for high-confidence
  correctness defects; findings dispatched to workers as they land.
