# Open Architecture Issues — for Fable to solve

Deliberate design problems worth solving carefully (not quick edits). Each has a
problem, why it matters, a proposed direction, and the files involved. Resolve
top-down; #1 unblocks the rest.

Status: 🔴 open · 🟡 in progress · ✅ resolved

---

## ISSUE-1 ✅ RESOLVED 2026-07-10 — ruflo RETIRED (user decision)
**Resolution.** The user chose to retire ruflo entirely: "I just don't want to
confuse multiple agentic stacks while trying to build this app up." Removed the
Swarm tab, `/api/swarm/*` endpoints, the npx bridge, and the claude-flow entry
in `.mcp.json`. The Claude Code native stack is THE stack: run engine executes,
and multi-agent work happens *inside* runs via the CLI's own Agent tool + the
90-agent library. The Graph tab's new "Agents" view (`lib/agentgraph.js`,
`assets/agentviz.js`) visualizes that crew live with persona names.
This also resolves ISSUE-2/3/4/6 below by construction.

<details><summary>Original problem (for the record)</summary>

Ruflo swarm and the hub run engine overlapped instead of cooperating:
**Problem.** Two execution models, two memory systems, two task systems run in
parallel with only a thin CLI bridge:
- Execution: `lib/runs.js` spawns one auto-routed `claude -p` per run (streamed,
  tracked, remembered) — vs ruflo orchestrating many agents in a topology.
- Memory: Engram `data/memory.json` (over-vectors) vs ruflo AgentDB/HNSW
  `memory.db` (vectors).
- Tasks: hub task queue (sequential) vs ruflo `task_orchestrate` (parallel DAG).

Today the Swarm tab just shells out to `npx ruflo swarm <goal>` (`lib/core.js`
`/api/swarm/launch`). That work **bypasses the run engine**: no streaming into
chat, no run history, no Engram capture, no auto-routing, no spend in the Overview
cockpit. Ruflo is a bolted-on parallel universe, not an integrated layer.

**Why it matters.** The user's goal is one coherent, observable, token-efficient
system. Two uncoordinated orchestrators = double the surface area, invisible
spend, and confusion about which to use.

**Proposed direction.** Make them complementary layers:
- Hub run engine = execution + observability (stream/history/artifacts/Engram/
  routing/spend). Ruflo = multi-agent planning/coordination for parallel,
  decomposable work.
- Route swarm agent work THROUGH `lib/runs.js` so each agent step becomes a
  tracked, streamed, remembered run. Ruflo decides who-does-what; the run engine
  executes and observes.
- Bring swarm spend into the Overview cockpit.

**Files.** `lib/core.js` (swarm launch), `lib/runs.js` (startRun as the executor),
`assets/app.js` (Swarm tab), Overview metrics.

**Decision gate for the user:** does the ruflo swarm still earn its keep at all?
It has never spawned an agent (0 ever). If parallel multi-agent isn't a real need,
the simpler resolution is to RETIRE ruflo and let the run engine + task queue be
the whole story. Confirm before building either way.

</details>

---

## ISSUE-2 ✅ RESOLVED 2026-07-10 — Engram is canonical (ruflo retired with its vector store)
**Problem.** The hub now has Engram semantic memory (`lib/memory.js`, no vectors,
the user's chosen direction). Ruflo carries its own AgentDB/HNSW vector memory
(`memory.db`, copied in with the library). Two silos.

**Why it matters.** Memory should be one queryable surface, and the user
explicitly chose "semantic over vectors."

**Proposed direction.** Engram is canonical. Either (a) retire ruflo's vector
memory, or (b) one-way bridge: distill useful ruflo memories into Engram records,
then stop writing to the vector store. No dual-write.

**Files.** `lib/memory.js`, ruflo `memory.db` (read-only import if bridging).

---

## ISSUE-3 ✅ RESOLVED 2026-07-10 — one task surface (queue + schedules), ruflo DAG retired
**Problem.** Sequential hub queue (`lib/tasks.js`) vs ruflo's parallel task DAG.

**Proposed direction.** Define roles explicitly: task queue = simple sequential
improvement items (what the user uses now); swarm/orchestrate = parallel
decomposition of one big goal. Document the rule; consider auto-selecting (a
complex/parallelizable prompt offers "run as swarm"). Depends on ISSUE-1.

---

## ISSUE-4 ✅ RESOLVED 2026-07-10 — moot: one execution path (in-run subagents when needed)
**Problem.** Nothing tells the user (or the auto-router) when a task deserves a
single auto-routed run vs a multi-agent swarm.

**Proposed direction.** A documented heuristic + optional UI hint: parallelizable
/ multi-file / research-heavy → offer swarm; everything else → single run. Fold
into the auto-allocation logic (`lib/runs.js` routeModel neighbourhood).

---

## ISSUE-5 🟡 Hermes stack inclusion — PARKED (ISSUE-1 now resolved; user confirmed 2026-07-10 they still like hermes)
**User request (2026-07-10):** include BOTH the hub stack and the hermes stack,
with a **UI toggle to turn hermes on/off** (for mobile / another device). Then
paused it pending the ruflo↔engine overlap above.

**Why parked.** Adding a third agent orchestrator before the second (ruflo) is
integrated would triple the management surface and duplicate spend/memory/routing.
Hermes also runs on separate API billing (Nous Portal/OpenRouter/OpenAI), not the
Claude subscription the hub uses — a second cost model.

**When revisited, the RIGHT shape (harvest, don't stack):**
- Keep the ONE thing hermes adds that the hub lacks: **multi-channel messaging**
  (Telegram/Slack/WhatsApp/email — async/push access). Everything else hermes
  does, the hub already has or is building (memory=Engram, schedule=N3,
  subagents=ruflo/agent-teams, routing=S3).
- Implement as a **thin messaging bridge** (~100-line webhook → hub run engine →
  reply), NOT the full Python stack. Preserve the user's "toggle for mobile" as a
  simple on/off for that bridge.
- Only adopt the full hermes stack if the vision pivots to an "always-on,
  multi-channel autonomous agent" (a different product than the lean Claude
  cockpit). That's a deliberate fork, not an add-on.

---

## ISSUE-6 ✅ RESOLVED 2026-07-10 — moot: all agent work flows through the run engine (spend on-book)
**Problem.** Overview tracks run spend but not ruflo swarm token cost. Any
multi-agent work is off-book. Resolve as part of ISSUE-1 (route through the run
engine → spend becomes visible automatically).
