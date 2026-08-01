# Handoff — Overview efficiency-scoring research + full project context (2026-08-01)

Written per `handoff-writer` skill's guidance (from existing state, not a
resumed session). This thread is at full usage — read this first in the new
one, then `HANDOFF.md` → `docs/roadmap.md` for anything not covered here.

## Part 1 — the research task to send out

**Question:** what is the best scoring/evaluation system for measuring
whether an agentic AI stack (a multi-agent, multi-model-tier system like
this hub's) is being used *efficiently* — not just whether tasks succeed,
but whether the right agent/model tier was used for the task, and whether
the cost was proportionate to the value produced?

**Why this matters here, concretely:** this hub already has real
uncertainty logged in its own history — sessions have burned real money on
misdirected dispatches (a senior review agent invoked twice in one pass,
~25% of a session's spend; 19 "continue" resume-replays costing ~$106 in
one stretch; opus/sonnet used on trivial tasks in some runs). A live
per-run delegation log already exists (`lib/delegations.js`, `GET
/api/delegations` — agent type, tool-call count, outcome, per dispatch) but
there is currently **no scoring model on top of it** — no agreed definition
of what "efficient" means per process type, no way to say "this dispatch
was worth it" vs. "this was overkill" in a structured, repeatable way.

**Ground rules already decided (don't relitigate, build within them):**
- **OUTPUT (did it work) and EFFICIENCY (was the cost proportionate) must
  stay two separate signals, never blended into one score.** A failed
  cheap-tier run on a trivial task is a different failure than a failed
  expensive-tier run on a hard task — collapsing both into one number
  destroys the signal.
- Model tiers in play: haiku (cheap/mechanical), sonnet (default
  workhorse), opus (expensive/deliberate — architecture, security,
  autonomy-loop judgment), and one top/senior tier reserved for genuinely
  senior oversight, used at most once per work session by explicit rule
  (a real, learned cost-discipline constraint from this project's own
  history).
- The scoring model needs to consume the SAME data the delegation log
  already produces (agent type dispatched, tool-call count, tokens, outcome)
  — don't propose a system that requires re-instrumenting everything from
  scratch.
- This feeds a planned "Overview" screen rework that is explicitly
  **research-gated** — nothing gets implemented until this research lands
  and a concrete metric model is chosen. Don't scope the rework itself,
  just the scoring/evaluation methodology question.

**What "good" looks like for the research output:** a decision-ready
comparison of real evaluation frameworks/methodologies for multi-agent
systems (not just "log more data" — actual scoring approaches), each with:
what it measures, what data it needs, its failure modes, and how well it
fits a solo-operator/local system (not an enterprise MLOps platform with a
dedicated eval team). Cite sources. A prior research pass this session
already touched the edges of this (Anthropic's own agent-engineering
writeups, arXiv papers on agent evaluation/loop-engineering, verification-
gate patterns) — build on that rather than starting from zero; ask the new
thread to pull the prior research summary from this session's history if
available, or re-derive it if not.

**Ready-to-paste research task prompt:**
> Research evaluation/scoring methodologies for measuring efficiency (not
> just success/failure) in a multi-agent AI system with tiered models
> (cheap/default/expensive/senior-reserved) and a per-dispatch log of agent
> type, tool-call count, and outcome already available. Keep "did it work"
> and "was the cost proportionate" as separate signals. Compare 3-5 real
> approaches with sources, each scored on: what data it needs, its known
> failure modes, and fit for a solo-operator local system (not enterprise
> MLOps). Decision-ready summary, not a survey.

## Part 2 — full project context for any future research/work task

**What this project is:** a zero-dependency local web dashboard
(`claude-dashboard/`) that is the user's front end for working with Claude
Code — prompt runs, live streaming, run history, a file inbox, project
management (including a real business VPP order-conversion workflow synced
to SharePoint), and monitoring tabs (19 total nav tabs). Runs on the user's
own machine, localhost only, no cloud backend.

**Where the rules live:** `CLAUDE.md` (hard rules: no client data without
explicit prompt, zero npm deps, 500-line file cap, security invariants,
localhost-only) and `HANDOFF.md` (current state + doc map). Read both
before doing anything in this repo.

**The agent roster (19, as of today):** a mix of haiku (cheap/mechanical:
`librarian`, `doc-scribe`, `json-wrangler`, `test-runner`, `scraper`,
`excel-formatter`), sonnet (default build/logic work: `frontend-engineer`,
`backend-builder`, `ui-designer`, `code-reviewer`, `node-perf-engineer`,
`voice-engineer`, `data-analyst`, `web-researcher`), opus (expensive/
deliberate: `architect`, `security-auditor`, `agentops-engineer`,
`crew-chief` — the last one built today, owns dispatch intelligence/
routing/roster health), and one senior/top tier (`warden` — read-only
project-completion auditor, invoked at most once per work session by
learned rule). Full definitions in `.claude/agents/*.md`; team presets
(which agents + what steering hint get bundled per session type) in
`claude-dashboard/lib/teams.js`.

**Skills:** ~34 active in `.claude/skills/`, ~275 more parked in
`.claude/skills-library/` (not auto-loadable — promote into `.claude/
skills/` if actually needed, don't reference a parked one from an agent
brief without promoting it first, that was a real bug fixed today).

**What shipped today (2026-08-01), roughly in order:** a full audit
populating all 19 tabs' todo lists; a long-standing Run-tab mic/speak
button size/position bug finally fixed (verified, not just claimed); five
Jarvis-tab UX bugs fixed; a session-resume concurrency lock + a safe
port-only hub-teardown script (`scripts/kill-port.ps1`) after an incident
where a test cleanup killed the wrong hub process; an autopilot safety gate
excluding human-decision-flagged items from ever being auto-dispatched; two
file splits (`lib/core.js` → `core.js`/`library.js`/`graph.js`;
`components.css` → `components.css`/`components-tabs.css`) done proactively
before hitting the hard 500-line cap; a Run-tab panel showing other
concurrently-active threads; a revision to this project's own audit
protocol (`chop-and-cut` skill) capping senior-tier calls at one per pass
after a real cost overrun (~25% of one session); a full agentic-stack
charter (`docs/agentic-stack-charter-2026-08-01.md`) and its execution
(`crew-chief` built, `commit-captain` retired for zero real usage, three
new skills — `vpp-extraction`, `sharepoint-recon`, `handoff-writer`); two
newly-reported Run-tab bugs logged with root cause already traced (mic
button doesn't interrupt Jarvis's speech; mic button needs multiple clicks
to turn off due to a UI-state bug); and this handoff.

**Known open, real issues (not yet fixed, no action needed unless asked):**
- `lib/runs.js` (server) is AT the exact 500-line hard cap — must be split
  before its next edit.
- `assets/run.js` (client) has 2 lines of headroom before the same cap.
- The two newly-logged mic-button bugs above (root cause traced, fix not
  yet built).
- Voice-interrupt/barge-in: a complaint resurfaced 2026-08-01 that
  post-dates all known shipped fixes for that bug class — needs a live
  reproduction with a real microphone before any further fix attempt
  (can't be verified without one).
- A second senior-tier (opus) agent slot is deliberately unfilled — no
  concrete gap has named itself yet; don't invent one.
- An input-layer agent (speech/prompt cleanup before dispatch) is
  deliberately on hold — no design sketched so far avoids adding latency
  to every reply, which is a hard constraint the user set.

**Real business-data caution:** the Projects tab includes a live VPP
(client) order-conversion workflow synced to SharePoint — real invoices,
real reconciliation math. Never touch business data unless the task
explicitly hands it over in that conversation, per `CLAUDE.md`.

**Where to look next:** `docs/roadmap.md` (the one canonical plan doc),
`claude-dashboard/data/todos/*.md` (per-tab open items, all 19 refreshed
today), `docs/agentic-stack-charter-2026-08-01.md` (the agent/skill
architecture reasoning), git log for exact commits.
