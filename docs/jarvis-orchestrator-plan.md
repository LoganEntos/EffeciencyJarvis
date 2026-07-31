# Jarvis-as-orchestrator — implementation plan (drafted 2026-07-30)

Planning doc only — no code shipped against this yet. Grounded in the actual
substrate (`lib/autopilot.js`, `lib/tasks.js`, `lib/teams.js`, `lib/runs.js`,
`lib/project-context.js`), not a hypothetical design; every gap below was
verified by reading the current code, not assumed.

## Standing tension — read first

`HANDOFF.md` (2026-07-28, still the canonical status doc) scopes current work
to Inbox · Projects · Run and says explicitly: **"token viz / broad UI polish
/ orchestrator work are deferred"** until the VPP PDF→CSV workflow is stable.
Recent commits (`efda7d8`, `180a4b3`, `0e30e0c`) show that Projects work is now
substantially shipped. This plan assumes the user is deliberately electing to
resume orchestrator work now — if that's not the intent, this plan should wait
behind whatever's still open in `docs/handoffs/vpp-frontend-workflow-2026-07-28.md`.

## Reframe

"Jarvis orchestrating Projects" is not a new subsystem. The hub already has an
unattended dispatch loop (`lib/autopilot.js`) sitting on a durable task queue
(`lib/tasks.js`) that feeds the same run engine every prompt uses. What it
lacks is: more than one place to look for work, a way to bind a dispatched run
to a project's context, a way to force the right specialist team per dispatch,
any memory of *why* a past attempt failed, and any visible trail of what it
actually did. None of that requires a new engine — it requires generalizing
the one that exists. Below are the concrete gaps, each verified against the
current code, in build order.

## Gaps found (verified, not assumed)

**A — Single queue source.** `autopilot.pickNext()` (`lib/autopilot.js:79`)
reads only `docs/improvement-backlog.md`, falling back to the generic
`tasks.js` FIFO queue. It has zero awareness of the per-tab TODO checklists
(`data/todos/*.md`, shipped this session) or any project-level backlog. To
"work Projects" unattended, it needs a third source: parse
`data/todos/projects.md` the same way `parseBacklog()` already parses the
hub's own table — checklist lines (`- [ ] ...`) instead of table rows.

**B — No project binding on dispatched runs.** `runs.startRun()`
(`lib/runs.js:123`) already accepts `projectId` and, when given one, injects
the project's instructions + file manifest (`lib/project-context.js`) into the
prompt. But `tasks.js`'s `enqueue()` / `runTask()` / `runAll()` never carry or
pass a `projectId` — it's dropped at the task layer. This is one field of
plumbing, not a redesign: add `projectId` to the task schema and thread it
`enqueue → runTask/runAll → startRun`. Without this, a dispatched "fix the
Projects pairing bug" run executes with no idea which project's files it
concerns.

**C — No per-dispatch team selection.** `teams.activeHint()`
(`lib/teams.js:114`) reads one global "active team," whatever the user last
picked in the UI — it can drift or be wrong by the time autopilot fires hours
later. `autopilot.dispatch()` already overrides model/effort per item
(`model: 'opus', effort: 'high'`, `lib/autopilot.js:204`) but not team. A
Projects-tab item should force the UI/frontend (or a future "Projects") team
hint regardless of whatever's globally selected, the same way it already
forces model/effort.

**D — No failure memory or escalation.** A failed item retries the *identical*
prompt up to `MAX_ATTEMPTS` (2, `lib/autopilot.js:43`), then silently parks as
`stuck`. `state.dispatched[id]` stores only the latest status and an error
string — nothing about *why* it failed (wrong tier? missing context? genuinely
hard?) survives to inform the retry. This is already an open item in
`data/todos/jarvis.md`; this plan gives it a concrete shape: keep a per-item
`history[]` of `{attempt, errorExcerpt, at}`, feed the last entry back into the
next dispatch's prompt ("attempt 1 failed because X — try a different
approach"), and escalate effort/model tier on the second attempt instead of
repeating verbatim.

**E — No delegation visibility.** Already scoped as its own item in
`data/todos/jarvis.md` ("Delegation visibility — scoreboard," added
2026-07-29/30) — extracting `Agent` tool_use events from
`data/runs/<id>/output.jsonl`. Verified against real run data this session:
the tool is named `Agent` (not `Task`), carries `{description, subagent_type,
prompt}`, and every line a subagent produces is tagged with
`parent_tool_use_id` + `subagent_type` + `task_description` — enough to
reconstruct what was delegated and how many tool calls it took. No per-
delegation token/duration exists in the stream (CLI limitation) — first
version tracks *what* happened, not yet its cost. This is the prerequisite for
"seeing" whether any of A–D actually work.

**F — No cross-source prioritization.** `pickNext()` is pure FIFO scan order
today: backlog table order, then task-queue creation order. Nothing weighs
urgency, risk, or a standing directive like HANDOFF's "VPP takes priority."
Once there are multiple queue sources (A), naive concatenation isn't good
enough — needs at least a static source-priority list (user-typed tasks >
active project backlog > per-tab todos > hub self-improvement backlog).

**G — No cross-reference to SharePoint completion state (added 2026-07-30,
user directive).** `lib/pairing.js`'s `pairProject(slug)` already computes a
per-order local state (`'complete' | 'pdf-only' | 'unmatched'`,
`lib/pairing.js:158`) from what's physically in the project's inbox folder.
`lib/sharepoint.js` separately maintains an index of the SharePoint drive
(`data/sharepoint-index.json`, `searchIndex()`/`buildIndex()`) but the two
never talk to each other — pairing only ever sees what's already been pulled
locally. An order that exists upstream in SharePoint but was never pulled
looks identical to "doesn't exist" today; Jarvis can't currently answer "is
this project's SharePoint-side backlog actually done" without a human
manually diffing the SharePoint folder against the project folder. Overseeing
a project's conversion completion means reconciling `pairProject()`'s local
state against `searchIndex()`'s upstream listing for that project's known
source folder — genuinely new integration work, not a plumbing gap like B.
Needs its own design pass once phases 0–2 below are live (don't design the
reconciliation logic against zero real examples of it running).

## Test-before-hardcode (user question 2026-07-30 — yes, and here's why)

Prototyping the oversight flow as a manual one-off run, in a fresh thread,
before writing any of phases 1–4 into `lib/autopilot.js`, is the right call —
for a concrete reason, not just general caution: **none of the phases below
require new code to observe.** The run engine, project binding
(`projectId` on `runs.startRun`), the team-hint mechanism, and personas are
all already live. A manual test just means firing a normal prompt at Jarvis —
through the Run or Tasks tab, in a clean session so it isn't carrying this
planning conversation's context — that asks it to actually do the oversight
job in one shot: open a specific project, read its files, check
`pairProject()`'s state (or just look at the file list) against what
SharePoint has, and report back pass/fail per order. Whatever it gets wrong
(skips files, hallucinates completion, doesn't check SharePoint at all
without being told to explicitly) tells you exactly which of gaps A–G actually
matter versus which were solved already by context injection alone — real
signal instead of designing all four phases against guesses. Once phase 0's
delegation scoreboard exists, that same test run's transcript becomes
inspectable evidence, not just a vibe.

## Overview scope — output vs. efficiency (user question 2026-07-30)

Correct direction, matches the vision already sitting in `data/todos/
jarvis.md`'s Overview section — with one refinement: keep **output**
(did the run do the correct, complete thing — a verification question) and
**efficiency** (was the cost proportionate to the task — a cost question) as
two separate signals, not one blended score. A correct-but-slow opus run on a
genuinely hard task and a fast-but-wrong haiku run are both "bad" in different
ways that a single number would hide. Don't calibrate the efficiency half
until phase 0's scoreboard has real dispatch examples to define "proportionate
cost" against — same reasoning as gap F above.

## Build order (each phase independently shippable + browser-verified before the next)

**Phase 0 — SHIPPED 2026-07-31.** Delegation-visibility scoreboard (gap E).
Per-run view already existed (`lib/delegations.js` + `assets/delegations.js`,
mounted in the run transcript). The cross-run aggregate (`listRecent()`'s
`byType` breakdown) existed server-side but had no UI consumer — added
`renderDelegScoreboard()`/`mountJarvisDelegScoreboard()`, a collapsed-by-
default strip in the Jarvis tab. Verified live on :5758 (real data), smoke
script green, code-reviewed. No browser click-test — no browser automation
tool available this session; verified via API-level checks instead.

**Phase 1 — SHIPPED 2026-07-31 (plumbing, gap B).** `projectId` now threads
through `tasks.js`'s `enqueue()`/`runTask()`/`runAll()` into
`runs.startRun()`. `enqueue()` validates against `projects.get()` — an
unknown id is silently dropped, not stored. Deliberately does NOT gate on
project `kind` here (that hazard guard lives in `runs.js`'s `startRun()`,
added the same session — see `data/todos/projects.md`'s Escalate-hazard
entry). Verified live: a claude-kind projectId stores fine (kind-gating is
dispatch-time, not storage-time), a bogus id is dropped. Still genuinely
inert — nothing in the Tasks tab UI sets `projectId` yet; that's Phase 2+
territory and needs its own go-ahead per the standing plan-mode discipline.

**Phase 2 — second queue source (gap A).** Teach `pickNext()` to also read
`data/todos/projects.md` as pickable items. Ships behind its **own** enable
flag, separate from the hub's global `autopilot.enabled` (which stays off by
default per the existing 2026-07-27 caution) — turning on "work my Projects
backlog unattended" must be a distinct, deliberate decision from "let autopilot
fix the hub's own bugs."

**Phase 3 — dispatch quality (gaps C + D).** Per-dispatch team override, and
failure-memory/escalation. These are what make dispatched runs actually good,
not just possible.

**Phase 4 — prioritization (gap F).** Only build this once phases 1–3 are
live and phase 0's scoreboard has real dispatch history to check against —
same reasoning as "don't build the Overview efficiency score without real
examples first": a ranking model designed on guesses is worse than none.

## What this deliberately does NOT include

- No change to `autopilot.json`'s default-off posture — every new capability
  here ships behind its own flag, same convention as the existing loop.
- No efficiency *scoring* (that's the separate, research-gated Overview
  rework already noted in `data/todos/jarvis.md` — out of scope here).
- No new engine, MCP, or dependency — this is entirely `lib/autopilot.js` +
  `lib/tasks.js` + `lib/teams.js` generalization, zero-dep as always.
