# Handoff: schedules UI polish

**Status: READY.** Model: Opus 4.8 (or Sonnet — this is mostly UI, no
protocol design needed).

The fire-test scope of this handoff is DONE — R5 schedules were proven to
fire end-to-end against the live hub on 07-18 (`d7cb3c7`; recorded in
`docs/handoffs/README.md` and `docs/roadmap.md`). What remains is the
schedules half of the Tasks tab UI, which has had no polish pass since it
shipped.

1. Review the schedules list rendered in `assets/tasks.js` against the
   Tasks queue it sits alongside: schedule rows should read at a glance
   (next-fire time, last-run outcome, cadence) with the same visual weight
   the queue rows get, not as an afterthought below them.
2. Consider the timeline reframe sketched in
   `docs/archive/ui-roadmap.md` item 10: queue as queued → running → done,
   schedules as a "next fire" strip — makes the autopilot loop's activity
   legible at a glance instead of requiring a read of raw records.
3. Fold recurring schedule health checks (does a schedule with a past
   `next` time actually have a queued/running/done outcome, not silently
   stalled) into the autopilot loop rather than treating verification as a
   one-off manual pass.
4. Any create/edit affordances for schedules (interval picker, model/effort
   selection, delete/pause) should match the visual language of the rest of
   the Tasks tab — no ad hoc controls.

Left OUT of this handoff (needs an interactive session with the user):
wake-word "Jarvis" real-mic test; Projects tab at 375px. Note them in your
final reply as still-pending.

## Constraints
Zero-dep; `assets/tasks.js` stays under 500 lines — check current line
count before editing, split first if already close to the cap; no `$`
figures anywhere; preserve `X-Hub-Token` + path-traversal guards (no
`lib/schedules.js` protocol changes are in scope here — the fire mechanism
is already proven). Review pipeline per `docs/handoffs/README.md`:
browser-verify at 5757 (desktop AND 375px) + smoke green + code-reviewer
agent over the diff before commit. Do NOT stop/restart the 5757 listener —
verify any server-side change on a throwaway 5758 instance.

When this ships, record the outcome in `docs/roadmap.md`'s NOW entry for
this handoff (not `HANDOFF.md`) and mark this file DONE at the top; review
pipeline per `docs/handoffs/README.md`.
