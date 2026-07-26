# Handoff: persona pipeline fixes (system-layer injection, dual contracts, wit cap, routing floor, distill scoping)

**Status: IMPLEMENTED — code complete, browser-verify + commit still pending.** Model: Opus 4.8.
Done: fixes #1+#2 (persona+contract moved to `--append-system-prompt`, composed
GOD_PROMPT→contract→persona; dual `spoken`/`screen` contracts + `channel` on
POST /api/run), #3 (wit-cap scoped to conversational turns), #5 (sonnet floor
for conversational turns when a persona is active), #4 (distill only build-shaped
spoken turns, original words appended verbatim). All edited `.js` pass
`node --check`. Not done here (per execution constraints): browser-verify at
5758, smoke, code-review, commit, and the DONE/roadmap/archive bookkeeping.
Source audit: `docs/audit-2026-07-22-persona-pipeline.md` (full diagnosis,
ranked problems list, line refs — `lib/personas.js`, `lib/runs.js` L155-280,
`lib/distill.js`, `personas/*.md`). This is the execution order per the
audit's "Recommended order": fixes #1+#2 together, then #3, then #5, then #4.

## The work (in order)

1. **System-layer persona injection (P1, biggest win — audit problems #1+#2).**
   Today contract + persona ride as the FIRST thing in a long user-turn
   string; the LAST thing the model reads is ~700 tokens of hub-note
   boilerplate from `buildRunHint()`, so long-prompt recency bias buries the
   persona — worst on opus tier, where GOD_PROMPT is a real system layer
   that outranks a user-turn plea for 30 words.
   - In `lib/runs.js` (~L155-280), move contract + persona out of the user
     turn and into `--append-system-prompt`, composed with GOD_PROMPT on
     opus-tier runs, on EVERY tier (not opus-only). Keep the user turn for
     the user's words + context blocks (project instructions, memory
     recall, attachments, team text).
   - Split the single contract into two layer-1 guidelines files: `spoken`
     (current TTS-shaped text — no file/function names, under a minute, no
     lists) and `screen` (concise, names/tables/file paths allowed for
     typed work orders). Add a `channel` field to `POST /api/run` — the
     client already knows which one it is (voiceconvo/jarvischat → spoken,
     Run tab → screen) — and pick the contract server-side.
   - Bonus, same fix: this also resolves audit problem #6 (persona
     re-sent every turn incl. `--resume`, stacking N copies into a resumed
     thread's history and occasionally getting referenced by the model as
     visible content). A system-layer prompt isn't part of the resumed
     user-turn history, so the leak closes for free.

2. **Scope the wit cap to conversational turns (P2, persona text edit, zero
   code — audit problem #3).** `jarvis-wit`'s "one or two sentences, ~30
   words" stacks with the contract's "two short paragraphs" and a work
   order's own "print a table of everything you touched" — three
   incompatible ceilings, and the wit cap wins by being most specific,
   which is wrong for debriefs. Edit the persona body text only: scope the
   30-word rule explicitly to chat/acks/banter, and state it relaxes to
   "scale to the deliverable" for work debriefs and anything the user
   asked to see in detail.

3. **Sonnet floor when persona is active + turn is conversational (P3, one
   routing guard — audit problem #5).** `routeModel()` scores complexity,
   so short conversational turns — the MOST persona-dependent ones — land
   on haiku, which can't sustain dry Iron-Man wit. Add a floor: when a
   persona is active AND the turn is conversational (not build-shaped),
   route at sonnet minimum regardless of the complexity score.

4. **Distiller scoping (P4 — audit problem #4).** `lib/distill.js`
   currently paraphrases any >25-word spoken prompt through Haiku before
   Jarvis ever sees it; nuance lost there is unrecoverable — fine for
   rambling build asks, wrong for questions and anything precise or
   emotional. Do ONE of:
   - distill only imperative/build-shaped turns (skip the distill step for
     questions/conversational turns), or
   - keep distilling everything but append the original verbatim below the
     rewrite so nothing the user actually said is lost.
   Pick whichever is the smaller, more easily verified change and note the
   choice in the commit message.

## Constraints
Zero-dep; every file stays under 500 lines — check `lib/runs.js` and
`lib/distill.js` current line counts before editing and split first if
already close to the cap; no `$` figures anywhere; X-Hub-Token and
path-traversal guards are unaffected by this work (no route/param shape
changes beyond adding `channel` to the existing `/api/run` body). Review
pipeline per `docs/handoffs/README.md`: browser-verify one real voice turn
and one real Run-tab turn at 5757, smoke green, code-reviewer agent over the
diff before commit. Do NOT stop/restart the 5757 listener — verify
server-side changes on a throwaway 5758 instance. When this ships: mark it
DONE at the top, update `HANDOFF.md` + `docs/roadmap.md`, and retire
`docs/audit-2026-07-22-persona-pipeline.md` to `docs/archive/` per
`docs/cleanup-audit-2026-07-23.md` P6.
