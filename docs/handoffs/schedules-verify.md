# Handoff: Stress-test schedules (O3 — the headless-verifiable part)

**Status: READY.** Model: Opus 4.8 (or Sonnet — this is mostly mechanical).

R5 schedules have shipped but have NEVER been proven to fire. Verify the
whole loop against the live 5757 hub via its API (the per-boot token is in
the served `index.html` — fetch `/`, extract, send as `X-Hub-Token`).

1. `POST /api/schedules` — create a one-shot/near-future schedule (2–3 min
   out) with a trivial haiku prompt like "reply with the word ok".
2. Wait past the fire time (poll, don't spin), then assert: a new run
   appears in `/api/runs` attributable to the schedule, status reaches
   `done`, and the schedule's own record updates (lastRun/next).
3. Edge: create a second schedule, delete it BEFORE it fires, assert it
   never fires.
4. Tear down everything you created (schedules AND the test runs via
   `/api/run/delete`) — leave `data/` as you found it.
5. Fix precisely whatever fails (`lib/schedules.js`); server-code changes
   are verified on a throwaway port (5758+), NEVER by killing the 5757
   listener; the fix goes live only via the supervised `POST /api/restart`
   and only when `/api/runs` shows no active run.

Left OUT of this handoff (needs an interactive session with the user):
wake-word "Jarvis" real-mic test; Projects tab at 375px. Note them in your
final reply as still-pending.

Record the outcome in HANDOFF.md (O3b line) + `docs/roadmap.md`; review
pipeline per `docs/handoffs/README.md`.
