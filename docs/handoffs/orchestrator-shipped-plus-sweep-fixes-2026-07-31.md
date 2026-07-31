# Orchestrator phases shipped + 19-tab sweep fixes — handoff (2026-07-31)

Read this before doing anything else if you're picking up cold. Companion
reading, still accurate as background: `docs/jarvis-orchestrator-plan.md`
(now mostly SHIPPED, see below — read its status markers, don't re-derive),
`docs/jarvis-orchestrator-deliberation-2026-07-30.md`, and
`docs/handoffs/jarvis-tiering-voice-ux-sweep-2026-07-31.md` (the PRIOR
session's plan-mode handoff — this session resolved most of its section 5
open questions; treat that doc's open items as answered by this one where
they overlap, not as still-live questions).

**Everything below actually shipped** — 13 commits, each built on a
throwaway `:5758` instance (5757 never touched), smoke-tested, code-reviewed
(real bugs caught and fixed pre-commit on at least six of them — see "Bugs
review actually caught" below, don't skip that section), then committed to
`master`. Nothing here is a plan; it's a record of what's real right now.

## 1. How this session started, and the operating-mode correction mid-session

The prior session (`jarvis-tiering-voice-ux-sweep-2026-07-31.md`) ended in
deliberate plan-mode with a long list of open questions and zero shipped
code beyond two small agent files. This session picked up with the user
pushing hard, across many turns, to actually decide and build — including an
explicit directive to route the real rework through opus/fable subagents
(architect, security-auditor, agentops-engineer, backend-builder) with
`warden` doing a senior review pass after, and only then have the main
session (sonnet) apply small follow-up fixes directly.

**Mid-session correction, worth carrying forward:** after roughly a dozen
single-item "continue" round-trips, the user pushed back hard — paraphrased,
"nothing has been built," "you should understand what needs to be done next
and orchestrate until usage is depleted or I tell you to stop, not make me
say continue 20 times." The complaint about pacing was fair (each round had
been one scoped fix, stop, wait for "continue"); the complaint that
"nothing was built" was checked against `git log` and found factually wrong
for this thread specifically (ten real commits existed by that point) — the
likely actual cause was a stale hub process on :5757 that hadn't been
restarted since most of the server-side commits landed (confirmed: the live
process's creation time was ~3 minutes after the last commit at the moment
this was raised, meaning a restart had *just* happened). **Lesson for
whoever picks this up:** (a) don't let a long work session go by without
periodically stating, concretely, what's shipped (commit hashes, not vague
summaries) — the user has no other way to know; (b) if the user reports "X
still isn't fixed" for something you know you shipped server-side, check
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` for the live
:5757 process's `CreationDate` against your commit timestamps before
re-diagnosing — a stale unrestarted process is a real, recurring failure
mode in this project (also noted in the user's own memory as
`pdf-preview-stale-server`); (c) once a backlog is genuinely safe (no
destructive action, no client data, no decision only the user can make),
keep moving through it without stopping for a "continue" between every
single item — verify and review each one, but don't treat pacing itself as
a safety measure when it isn't buying anything.

## 2. What shipped, in commit order

`03d31bc` and earlier — pre-existing, not this session's work.

- **`3113105`** Escalate-hazard fix + fable-tier grouping + delegation
  scoreboard + task project-binding. The Projects tab's "Escalate to Run
  tab" button let a claude-kind (imported workspace) project bind into the
  Run tab, reintroducing the exact wrong-directory hazard the inline chat
  panel is disabled to prevent — fixed client-side (button removed for
  claude-kind) AND server-side (`lib/runs.js`'s `startRun()` now refuses the
  injection regardless of client state, `pr.kind !== 'claude'` gate). Also:
  Agents-tab library view gave fable its own "Fable · top" section instead
  of lumping it into "Opus · heavy"; `fileCount` badge stopped lying (was
  hardcoded 0) for claude-kind projects; cross-run delegation scoreboard
  (aggregate `byType` view, the per-run view already existed) added to the
  Jarvis tab; `projectId` now threads through `lib/tasks.js`
  (`enqueue→runTask/runAll→startRun`) — inert plumbing until something sets
  it.
- **`d0213b8`** Run tab clear button + collapsible history (pre-existing
  work from earlier the same day, committed in this session's cleanup pass).
- **`62e0e18`** Fable-gate decision + autopilot Phase 2. Decided (per
  explicit user direction): the opus-only GOD_PROMPT gate in `lib/runs.js`
  is correct BY DESIGN — the playbook targets opus specifically, it's not a
  bug that it doesn't also fire for the hub's separate "fable" model tier.
  Fixed the one real gap: `agentops-engineer.md` was the only opus/fable
  agent file missing the hand-copied discipline block (architect,
  security-auditor, warden already had it) — added it. Built autopilot
  **Phase 2**: `pickNext()` reads `data/todos/projects.md`'s open checklist
  lines as a third source, gated behind a NEW `state.projectsBacklogEnabled`
  (default false, no UI/route to flip it), in addition to the existing
  global `state.enabled` (also still false, untouched). Reviewed by
  `warden`: sound, provably inert.
- **`8256deb`** Gap G: SharePoint reconciliation. `lib/reconcile.js` (new,
  144 lines) joins `pairProject()`'s local state against the offline
  SharePoint index — the literal mechanism for "track conversion completion
  against SharePoint." Full pipeline: `architect` designed it, a real bug in
  the design (deepest-folder keying instead of depth-2; assuming folder
  names were bare order ids when they're multi-token prose) was caught by
  `warden` actually reading the real 54-folder index instead of trusting an
  unverified assumption, revised directly against that real data (47/54
  folders resolve to a single `22xxx`-shaped order-id token; the remaining 7
  are the already-known hard cases and correctly land in `ambiguous`), then
  `backend-builder` implemented it, `security-auditor` audited it clean, and
  `warden` gave a final sound verdict after independently reproducing the
  real-index counts. New route: `GET /api/projects/reconcile?id=<projectId>`.
  Read-only — opens no PDF, calls no Graph endpoint, pulls no bytes.
- **`5ed4fb4`** api() error-shape bug, scoped fix. `assets/app.js`'s `api()`
  resolves an `{error}` object on HTTP 4xx/5xx instead of rejecting — known,
  filed finding. Deliberately did NOT change `api()` itself (too large a
  blast radius to audit every caller in one pass); instead fixed the four
  tabs actually named in the finding (Sessions, Overview, Memory, Health) at
  their call sites. code-reviewer caught a real regression in the first
  pass (a `.catch()` added to Sessions' fetch accidentally swallowed genuine
  network failures too, breaking the tab's existing auto-retry-on-revisit
  via `app.js`'s `load()`) — fixed by NOT catching network failures, only
  the HTTP-error-response case.
- **`906c7e8`** Projects pairing panel: Step 7's safe half ("organize/
  regroup," not "archive/delete-all" — that half stays unbuilt, see §3).
  Completed orders now collapse into a "N complete orders" section (same
  `.histSection` pattern as the Run tab's history collapse) instead of
  burying the orders that still need attention. code-reviewer caught the
  first pass using a single global localStorage key for the collapsed
  state — since this panel is per-project, that would leak one project's
  expanded state into every other project's panel — fixed to key per-slug.
- **`dd99764`** SharePoint Graphify in-flight guard + task delete
  confirmation. The `#spGraphify` button fired a full-priced Opus run with
  no guard against a double-click firing two — fixed with module-level state
  (`SP.graphifying`, not just the DOM `disabled` attribute, because
  `spRenderIndex()` fully rebuilds the button on every status re-render and
  a DOM-only guard would get silently replaced). code-reviewer caught two
  real issues in the first pass (a missing `catch` that would leave the
  button disabled forever on a network failure, and the exact
  concurrent-re-render race just described) — both fixed and independently
  re-verified clean. Also: task delete now confirms, matching schedule
  delete's existing pattern.
- **`14d766f`** Sessions "Re-summarize" silent no-op + in-flight guard. The
  button's `force`/`spin` flag was threaded nowhere — not read client-side,
  not sent in the POST body, not read server-side — so `runSweep()`'s
  cache-if-size-unchanged check always short-circuited, and the button
  flashed "Summarizing…" then redisplayed the identical cached text,
  looking like it worked while never re-running anything. Fixed end to end
  (`lib/sessionsum.js` now reads `body.force`). code-reviewer caught the
  in-flight guard being scoped to the render closure instead of module
  state — reset to empty on every tab refresh, so clicking Refresh
  mid-request then Re-summarize again still fired a genuine duplicate real
  Claude debrief. Fixed by moving `resumInFlight` to module scope.
- **`242d3da`** Memory tab pagination. `GET /api/memory` hardcoded
  `list.slice(0, 100)` with no pagination while the header chip claimed
  "all N" — confirmed live against this hub's own 450-record store (100
  shown, chip said "all 450"). Added `?limit=`/`total` server-side and a
  "Load N more" client affordance. code-reviewer caught a second-order bug:
  past the server's 500-item hard cap, "Load more" would silently dead-end
  forever while still claiming more was available — fixed with a static
  "showing the newest 500 of N" message instead of a lying button, past the
  cap.
- **`c800dd9`** Live tab graceful degrade + memory delete confirmation.
  `renderers.live()`'s initial fetch had no try/catch (unlike its sibling
  functions), so a failure blanked the WHOLE tab including the Active-tasks
  board, which doesn't actually need the session list — now degrades just
  the session-feed section. `tickActiveTasks`/`tickLive` swallowed even the
  FIRST fetch failure silently, freezing both panels on their literal
  "Loading…" placeholder forever with zero indication — now surfaces a
  visible error+retry, but only on a genuine first-load failure (a later
  transient poll blip still self-corrects silently, unchanged). code-
  reviewer caught a real follow-on bug: the error catch never invalidated
  `liveActiveSig`, and since the hub's common idle state (zero active runs)
  computes the same empty-string sig the dedup key starts at, recovering
  into that state could leave the error message stuck even after the server
  came back — fixed by invalidating the sig on failure. **This fix's final
  independent re-verification pass was interrupted mid-run (agent process
  stopped, not a finding) — the fix was traced by hand against the exact
  failure scenario before committing, and the smoke script had already
  passed with this code in place, but flag that the very last automated
  pass didn't complete if anyone wants to re-run it for full confidence.**

### Bugs review actually caught (don't skip re-reading this if you're tempted to trust a first pass blind)

Every one of these was a real, live-verified defect in a change that had
already passed its own author's testing:
1. Escalate hazard — client-side fix alone left the server-side injection
   point wide open to a direct API call; needed the `runs.js` gate too.
2. api() error-shape fix — the "obvious" fix (add `.catch`) broke an
   unrelated existing behavior (tab-revisit auto-retry) that wasn't part of
   the bug being fixed.
3. Pairing-panel collapse — copied a single-instance pattern (Run tab
   history) onto a per-instance panel (Projects) without noticing the state
   would leak across instances.
4. Gap G design — an entire matching-key algorithm was designed against an
   untested assumption about upstream folder naming; the real data
   contradicted it in two separate, load-bearing ways.
5. SharePoint Graphify guard — first pass fixed the double-click but broke
   recoverability on network failure, and didn't survive a concurrent
   re-render.
6. Sessions re-summarize guard — first pass's in-flight tracking reset on
   every tab refresh, defeating its own purpose.
7. Memory pagination — first pass's "Load more" would dead-end silently
   past a hard server cap while still claiming more was available.
8. Live tab error handling — first pass's error catch didn't invalidate the
   polling dedup key, so recovery could get silently swallowed.

The pattern: every one of these was a plausible-looking fix that a
first-pass author (including opus-tier agents on #4) believed was complete
and correct. None of them were caught by the author's own testing — all
were caught by an independent adversarial review pass. **Do not skip the
review step to move faster; it is where most of the real bugs in this
project get caught, not before it.**

## 3. What's deliberately still open, and exactly why

- **Second opus agent's role** (the "agentic-teams specialist" is the first
  of two planned opus agents and IS named/confirmed; the second is not).
  Genuinely not invented — the user has repeatedly said don't guess this.
  Two candidate sketches were offered mid-session (a prompt/persona-
  architecture specialist, and a routing/dispatch-quality specialist) but
  neither was built. If picking this up: either get the user to name it, or
  present those two candidates again for a pick.
- **Step 7's destructive half** ("archive/delete-all" in the Projects
  pairing panel) — nothing in this project's history specifies exactly what
  it should delete (all `complete` orders' files? only ones past some age?
  does it need type-to-confirm?). Not guessed at. Needs a concrete answer
  before it's scoped, let alone built.
- **Step 9 — VPP historical batch conversion.** Real client business data.
  Progress is 7/54 orders reconciled (5 originally proven + 22611/22612
  fixed same day for a 3-decimal-pricing method gap). Two Tier-1 orders
  (22359, `SPL002`/010763) need a human to look at genuinely ambiguous
  source PDFs and pick the authoritative one — not a code fix. Tier 2/3 (47
  orders, 2022-2024, higher risk per `data/todos/projects.md`'s own notes)
  need an explicit go-ahead before any further processing.
- **Autopilot's actual re-arm** (`state.enabled` flipping true, or the new
  `state.projectsBacklogEnabled` flipping true) — both exist, both work,
  both are provably inert (default off, no UI path to flip either). Never
  flipped this session, on purpose — this is the exact mechanism behind the
  2026-07-27 incident (`HANDOFF.md` §"Current truth") where unattended
  autopilot saturated both run slots and committed mid-debug. **Known
  pre-flight gap if this is ever turned on:** `warden`'s review of Phase 2
  flagged that the only two open items in `data/todos/projects.md` right
  now (Step 7, Step 9) both explicitly say in their own text that they need
  a human call first — flipping `projectsBacklogEnabled` today would
  dispatch exactly the two items that shouldn't be. Needs an eligibility
  marker/skip-rule in `parseProjectsBacklog()`/`pickNext()`
  (`lib/autopilot.js`) before this flag is ever turned on. Filed in
  `data/todos/jarvis.md`, not built.
- **Candidate next fix** (flagged, not started): `data/todos/*.md` across
  the other tabs (Files, Skills/Commands/Assets/Sources, Tools, Config) still
  has similar-shaped small bugs from the same 19-tab sweep — missing loading
  states, a Tools-tab editor that discards unsaved edits with no warning,
  etc. Same safe, no-invention, no-client-data character as everything
  fixed this session. Good next batch if continuing this exact kind of work.

## 4. Reference — files most load-bearing for this session

`docs/jarvis-orchestrator-plan.md` (now mostly SHIPPED — Phases 0-2 done,
gap G done, gaps C/D/F still just plans), `.claude/agents/warden.md`
(SharePoint caveat updated now that `reconcileProject` exists),
`.claude/agents/agentops-engineer.md` (discipline block added),
`lib/reconcile.js`, `lib/autopilot.js`, `lib/tasks.js`, `lib/sessionsum.js`,
`lib/memory.js`, `assets/live.js`, `assets/lists.js`, `assets/sharepoint.js`,
`assets/projectpairs.js`, `data/todos/projects.md`, `data/todos/jarvis.md`,
`data/todos/config.md`, `data/todos/sessions.md`, `data/todos/memory.md`,
`data/todos/live.md`.
