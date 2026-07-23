# Audit — why the self-improvement loop dies (2026-07-23)

Verified against source this session: `lib/autopilot.js`, `lib/schedules.js`,
`lib/tasks.js`, `lib/runs.js` L155-282, `lib/runs-engine.js` L60-150,
`prompts/opus-6h-handoff.md`, `docs/improvement-backlog.md`,
`data/autopilot.json`, `data/schedules.json`.

## Headline: the loop isn't broken — it's starving, and nothing refills it

Autopilot is **enabled and ticking right now** (`data/autopilot.json`
lastTick = tonight), but it has dispatched **nothing since 2026-07-14**.
`pickNext()` reads only ⬜ rows from the 7-column markdown table in
`docs/improvement-backlog.md` — all 26 (C1-C13, U1-U13) are ✅. The loop is
**fix-only**: no stage anywhere ever *adds* backlog rows. Discovery lives in
`docs/handoffs/improvement-cycle.md` as a prompt a human must paste. So the
"self-improvement loop" self-terminated 9 days ago and has been silently
idling on a 5-minute timer ever since, with the Config toggle still showing ON.

## The bugs, ranked

1. **No replenishment stage (root cause).** Nothing writes new ⬜ rows.
   *Rewrite:* a standing schedule fires a **scout run** (e.g. every 6-24 h)
   whose only job is the FIND step of `improvement-cycle.md` — sweep the
   repo (and optionally the web via the scraper/web-researcher agents) and
   append new ⬜ table rows to the backlog (or enqueue hub tasks). Loop
   becomes find → fix → verify and self-sustains.

2. **Backlog parser reads only one of the file's two formats.**
   `parseBacklog()` matches the old `| C1 | loc | issue | fix | e | r | status |`
   table; the 2026-07-14 round was written as **bullet lists** the parser
   cannot see. Even if a future audit appends open bullet items, autopilot is
   blind to them. *Rewrite:* either enforce "scout appends table rows only"
   (document it at the top of the backlog) or teach the parser the bullet
   shape. Cheapest: the former.

3. **The orchestrator loop was a one-shot, not a standing agent.**
   The F5→Opus 6h loop ran off a schedule that expired 07-19;
   `data/schedules.json` is now **empty** — the entire scheduling integration
   currently has zero users. *Rewrite:* recreate the hourly orchestrator as a
   permanent schedule (disabled by default, one toggle to arm): it reads the
   autonomy log + run history + task queue, dispatches the next worker, and
   **re-seeds the scout when the backlog runs dry** — the persistence the
   one-shot never had.

4. **No context-overflow / continuation handling.** `onExit()` maps exit
   code → done/error and finalizes; the terminal `result` line's `subtype`
   (e.g. max-turns / context errors) is never inspected, and an autonomous
   run that dies mid-item is never re-fired. Workers only survive overflow if
   they happened to write the log before dying. *Rewrite:* in
   `finalizeRun()`, when the run came from a task/schedule/autopilot source
   and ended `error` with a captured `sessionId`, auto-enqueue ONE
   continuation run with `--resume <sessionId>` and a "context was cut —
   read the log/diff and finish the current item only" prompt, capped at 2
   continuations per origin (store `continuations` on meta to enforce).

5. **Autonomous paths can't reach the new integrations.**
   `startRun()` accepts `effort`, `think`, recall, and picks up the active
   team — but `tasks.runTask()` and `schedules.fire()` pass only
   `{prompt, model, permissionMode}`. There is **no effort field on a task or
   schedule record**, so ULTRA CODE / xhigh workers are Run-tab-only; the god
   prompt (`fable5: isOpusTier` gate) is also skipped whenever `auto` routes
   an autonomous run to sonnet/haiku — which is exactly where autopilot's
   `model:'auto'` fix runs land. *Rewrite:* add optional `effort` (and
   `model` defaults per source) to task + schedule records and thread them
   through; give autopilot dispatches a real default (opus + high effort for
   code fixes). The system-layer god-prompt/persona change is already queued
   in the persona-pipeline task and composes with this.

6. **Three progress trackers, no glue.** improvement-backlog.md (autopilot),
   `data/tasks.json` (user queue), docs/handoffs + roadmap (humans) — and
   autopilot reads only the first. The task queue populated 07-23 is
   invisible to it. *Rewrite (pick one):* (a) autopilot falls back to the
   task queue's never-run items when the backlog is dry, or (b) the scout
   writes into the task queue and the backlog becomes its notebook. (a) is
   ~10 lines in `pickNext()` and makes the Tasks tab the single visible
   queue.

7. **Starvation is silent.** Autopilot's status endpoint knows
   `backlogOpen: 0`, but nothing surfaces "loop is idle — nothing to do" in
   the UI or as a run/notification. *Rewrite:* Config badge + one hub_status
   line when a tick finds an empty backlog while enabled.

## Minor

- `settings.json` plan snapshot is stale (07-12) — any usage gauge fed by it
  is fiction; refresh or hide.
- Web research plays no part in improvement gathering; the scout prompt can
  alternate internal audit with an external pass (prior art, new CLI flags,
  voice/persona patterns) via the existing scraper/web-researcher agents —
  zero new deps.

## Suggested build order

(2) backlog format rule — 5 min, unblocks everything → (6a) autopilot reads
the task queue → (1)+(3) scout + standing orchestrator schedule → (5) effort
through tasks/schedules → (4) continuation-on-overflow → (7) starvation
badge. Items 1+3 together are one work order; 4 and 5 are each small,
self-contained server changes verifiable on a throwaway port.
