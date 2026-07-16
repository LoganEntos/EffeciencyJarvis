# Handoff: Jarvis tab error hunt (O1 — finish the fix)

**Status: DONE (2026-07-16).** Beacon confirmed live and working — it caught the
one real defect (the `run.js` `jarvisNote` crash, fixed in `6c09bd7`). At close,
`data/clientlog.json` held exactly that one (now-stale) record and
`GET /api/clientlog?tab=jarvis` returned `{count:0}` — **zero Jarvis-tab errors
captured**. Static re-pass over `jarvistab.js` was clean: script order
`clientlog→app→voice→jarvistab` is correct, every global it uses (`$`, `esc`,
`api`, `renderers`) is defined before use, and `/api/personas` + `/api/personas/get`
answer healthy. No blind patch was made (the handoff forbids it). Remaining
interactive exercise (real-browser/phone load · persona switch · tap-talk ·
hold-call · soul save) stays user-side — the beacon will catch anything new.

**Status: READY — the diagnostic is LIVE.** The 5757 hub was restarted
2026-07-15 evening, so `assets/clientlog.js` + `/api/clientlog` are now
serving (verified: `GET /api/clientlog?tab=jarvis` → `{count:0,records:[]}`).
Model: Opus 4.8.

## Background

The user reported "loads of errors" on the Jarvis tab (2026-07-15). A full
static pass over `jarvistab.js` / `voice.js` / `personas.js` / index wiring
found the code clean — the errors are runtime/browser-specific, which is why
the `e844d02` client-error beacon exists (it works from the phone; no
devtools needed).

## First catch (2026-07-15, already FIXED — commit `6c09bd7`)

The beacon's first record was tab **run**, not jarvis: a leftover
`jarvisNote` reference crashed every Jarvis-mode send after the POST but
before `attachLiveRun` (the user's "code stuck"). Fixed and verified with a
live run. The Jarvis-tab errors the user originally reported are still
uncataloged — proceed below.

## Steps

1. Exercise the Jarvis tab in a real browser: load, switch persona,
   tap-to-talk, hold-for-call, soul-editor save. If the user has been using
   the hub, records may already be waiting — check first.
2. `GET /api/clientlog?tab=jarvis` (or read `data/clientlog.json`) and fix
   the **captured** errors precisely — don't patch blind.
3. Research open-source prior art for anything structural in the
   voice/persona loop (OpenPersona already adopted; OpenJarvis queued in
   `lib/sources.json`, unevaluated) and port ideas natively, zero-dep.

## Constraint

Voice behavior (barge-in, Kokoro self-heal, reply queue, ok-vs-ready status)
is **exactly as the user wants** — fix the tab without touching it. Review
pipeline per `docs/handoffs/README.md`.
