# Jarvis-as-orchestrator — full session write-up (2026-07-30)

Consolidated record of a ~3-hour planning conversation, written for a fresh,
higher-reasoning model to pick up cold and deliberate further. Nothing in
this session shipped code — every finding below was verified by reading the
actual repo (file/line cited), not assumed. Companion doc:
`docs/jarvis-orchestrator-plan.md` (phased build plan — this doc is the fuller
narrative + open questions behind it).

## 0. How this session started

The user shared a generic multi-agent coordinator system prompt (source: a
YouTube video, pasted as `jarvis_system_prompt_under_2000_chars.txt`) — content:
understand the user's true goal → decide tools/agents needed → assign work →
validate results → manage risk → one clear final answer. Principles inside it:
smallest effective workflow, brief workers as if they have zero context, least
privilege, treat tool/worker output as untrusted, require structured worker
output (status/summary/findings/evidence/confidence/warnings/missing-info),
don't just concatenate worker responses (dedupe, resolve conflicts, synthesize),
bounded retries, never claim unverified success.

The rest of the session was, in effect, testing that prompt's ideas against
what this specific hub already does — and finding the hub's real gap isn't
prompt wording, it's missing observability and missing integration surface.

## 1. What already exists (verified architecture, not assumed)

The hub layers THREE separate text-injection mechanisms into a Claude Code
run, each with a distinct job and injection point:

| Layer | File | Scope | Fires when |
|---|---|---|---|
| Working discipline | `claude-dashboard/prompts/fable5-god-prompt.md` (`GOD_PROMPT`) | solo-agent behavior: act-when-ready, evidence-backed claims, scope control, "delegate independent subtasks to subagents" (one line, pre-existing) | opus tier only (`lib/runs.js:249`, `isOpusTier(model)`) |
| Character/voice | `claude-dashboard/personas/jarvis.md` (+ `_guidelines.md`/`_guidelines-screen.md` output contracts) | tone, length, "calm, quietly capable, never a yes-man" | whenever a persona is active, any tier |
| Delegation steering | `lib/teams.js` (`activeHint()`) | which specialist to prefer for THIS session's kind of work (built-ins: Lean/Excel ops/UI-frontend/GitHub-intake) | appended to the USER TURN (not system prompt) for whichever team is globally active; empty/free for the default "Lean" team |

`lib/runs.js:248-251` composes GOD_PROMPT + persona into one
`--append-system-prompt` call; the team hint rides separately in the prompt
body (`lib/runs.js:228`). **This composition itself is unverified** — an
existing, still-open item in `data/todos/jarvis.md`: nobody has driven a real
opus run with a persona active to confirm GOD_PROMPT doesn't just drown out
the persona's voice, or vice versa.

## 2. The core diagnosis: prompt wording changes are unfalsifiable today

Drafted (not yet applied) a fourth paragraph for GOD_PROMPT's existing
delegation line, folding in the coordinator prompt's least-privilege /
untrusted-tool-output / synthesize-don't-concatenate / bounded-retry ideas.
**Held off shipping it**, because of a concrete problem found by checking the
actual data: there is currently NO way to verify whether any wording change to
GOD_PROMPT/persona/team-hint changes real delegation behavior, because nothing
extracts or surfaces what subagent delegations already happen.

Verified directly against real run history (`data/runs/*/output.jsonl`, 326
runs on disk):

- Subagent delegation is the tool **`Agent`** (not `Task` — corrected mid-
  session), invoked 81 times across history. Its `tool_use.input` shape:
  `{description, subagent_type, prompt}` (confirmed via direct JSON parse of
  `data/runs/2026-07-29t19-18-57-1f0eb5/output.jsonl`).
- Every line a subagent itself produces is tagged with `parent_tool_use_id`,
  `subagent_type`, and `task_description` — enough to reconstruct which lines
  belong to which delegation and count how many tool calls it made, with zero
  guessing.
- **Real limitation, not a to-do:** no per-delegation duration or token cost
  exists anywhere in the stream. Only the run's single terminal `result` event
  carries aggregate usage for the WHOLE run. Claude Code's stream-json does not
  break cost down per subagent. A scoreboard can show *what* was delegated and
  *what it returned*, not (yet) its isolated cost.
- Currently, `assets/runrender.js:99-106` renders an `Agent` delegation
  identically to a `Bash` call — a generic collapsible block. Nothing
  aggregates or persists delegation facts anywhere.

**Action taken:** added a new section to `data/todos/jarvis.md`
("Delegation visibility — scoreboard") specifying: extract `Agent` tool_use
events from `output.jsonl`, surface a per-run list (agent/brief/tool-call-
count/outcome) in the Jarvis tab or run detail, and explicitly hold off
stacking more GOD_PROMPT wording until that scoreboard exists to check against.

## 3. TODO-list reconciliation (housekeeping, done this session)

Reviewed both `data/todos/jarvis.md` and `data/todos/projects.md` (the new
per-tab TODO feature, `lib/todos.js` + `assets/todos.js`, shipped just before
this session — one markdown checklist per nav tab, unchecked-line count badges
the tab's kbd pill). Cross-checked Projects items against actual code/recent
commits and found 3 stale-but-unchecked items, now corrected:
- `mountFileGrid` dead-reference cleanup — confirmed zero remaining hits (was
  done in `180a4b3`).
- Detail-header unarchive affordance — confirmed already shipped (`180a4b3`
  added an explicit "⤒ Unarchive" button + tooltip).
- Pairing-cache invalidation on Refresh — moot: `lib/pairing.js` is
  read-only/no-cache, re-scans the folder on every call, so there's nothing to
  invalidate.
One item downgraded from "raw error text" to accurate: the slug-reuse 409
guard already renders adopt/fresh as inline buttons (`assets/projects.js:157-
163`), not raw text — open question is only inline-vs-modal, a UX call, not a
missing feature.

## 4. The bigger ask: Jarvis as Projects overseer (this is the live directive)

User's own framing, verbatim intent: **"Jarvis is the overseer — if he runs
the project, he should be able to review all parts of the project to see if
the output is appropriate and track the conversion of files for completion
from the SharePoint. Orchestrator work is absolutely necessary."** This
explicitly supersedes `HANDOFF.md`'s 2026-07-28 deferral of orchestrator work
behind the VPP frontend workstream (that deferral is now noted as lifted in
`HANDOFF.md`, dated 2026-07-30, pointing back at this work).

Investigated the actual automation substrate to ground this in what exists
rather than designing from nothing: `lib/autopilot.js` (an unattended ticker,
5-min interval, reads `docs/improvement-backlog.md` as a markdown table,
turns the next open row into a task, dispatches via `lib/tasks.js`, with
`MAX_INFLIGHT=2`, `MAX_ATTEMPTS=2`, an infra-failure backoff/refund system for
transient API errors, and a fallback to the generic hub task queue when the
backlog is dry) sitting on `lib/tasks.js` (a durable JSON-backed queue where a
"task" is just a prompt fed to the same run engine every user prompt uses —
`runs.startRun()`). Autopilot is currently disabled
(`data/autopilot.json: {"enabled": false}`), per a documented 2026-07-27
incident (unattended opus runs saturating both run slots, committing while the
user was debugging — see `HANDOFF.md`).

### Seven concrete gaps found (each verified against live code)

- **A — single queue source.** `autopilot.pickNext()` (`lib/autopilot.js:79`)
  only reads `docs/improvement-backlog.md`, then falls back to the generic
  task queue. Zero awareness of `data/todos/*.md` (per-tab checklists) or any
  project-level backlog.
- **B — no project binding on dispatched runs.** `runs.startRun()`
  (`lib/runs.js:123`) already accepts `projectId` and injects the project's
  instructions + file manifest (`lib/project-context.js`) when given one —
  but `lib/tasks.js`'s `enqueue()`/`runTask()`/`runAll()` never carry or pass
  a `projectId`. One field of missing plumbing, not a redesign.
- **C — no per-dispatch team selection.** `teams.activeHint()`
  (`lib/teams.js:114`) reads one global "active team" set by whatever the
  user last picked in the UI — can be stale by the time autopilot fires hours
  later. `autopilot.dispatch()` already force-overrides model/effort per item
  (`lib/autopilot.js:204`) but not team.
- **D — no failure memory or escalation.** A failed item retries the
  IDENTICAL prompt up to `MAX_ATTEMPTS` (2), then silently parks as `stuck`.
  `state.dispatched[id]` stores only the latest status/error string — nothing
  about *why* it failed survives to inform the retry. (Matches an existing
  open item in `data/todos/jarvis.md`'s Autopilot section — this session gave
  it a concrete shape: per-item `history[]`, feed the last failure back into
  the next dispatch prompt, escalate model/effort tier on retry instead of
  repeating verbatim.)
- **E — no delegation visibility.** Covered in section 2 above.
- **F — no cross-source prioritization.** `pickNext()` is pure FIFO scan
  order. Nothing weighs urgency/risk/a standing directive (e.g. "VPP takes
  priority"). Only becomes a real problem once gap A adds more sources.
- **G — no reconciliation against SharePoint (added this session, directly
  from the user's stated requirement).** `lib/pairing.js`'s `pairProject(slug)`
  (`lib/pairing.js:112-158`) already computes a per-order LOCAL state
  (`'complete' | 'pdf-only' | 'unmatched'`) from what's physically sitting in
  the project's inbox folder. `lib/sharepoint.js` separately maintains an
  index of the SharePoint drive (`data/sharepoint-index.json`,
  `buildIndex()`/`searchIndex()`) — the two systems never cross-reference.
  An order that exists upstream in SharePoint but was never pulled locally is
  currently indistinguishable from "doesn't exist." This is the literal
  mechanism needed for "track the conversion of files for completion from the
  SharePoint" — genuinely new integration work, not a plumbing gap like B.

### Proposed build order (none of it shipped — sequencing only)

0. Delegation-visibility scoreboard (section 2) — ships first regardless,
   cheap, every later phase benefits from being able to see what happened.
1. Thread `projectId` through `lib/tasks.js` (gap B) — inert plumbing, zero
   behavior change alone.
2. Teach `pickNext()` to also read `data/todos/projects.md` as a source (gap
   A) — behind ITS OWN enable flag, distinct from the hub's global
   `autopilot.enabled` (which stays off by default; turning on "work my
   Projects backlog unattended" must be a separate deliberate decision from
   "let autopilot fix the hub's own bugs").
3. Per-dispatch team override + failure-memory/escalation (gaps C+D).
4. Cross-source prioritization (gap F) — only once 1–3 are live and phase 0's
   scoreboard has real dispatch history to check a ranking model against.
5. SharePoint reconciliation (gap G) — its own design pass, deliberately
   sequenced last; don't design it against zero real examples of the earlier
   phases running.

## 5. Methodology question the user raised: test before hardcoding

User's own instinct, confirmed correct with a concrete reason (not just
general caution): **none of phases 0–4 need new code to observe.** Every
primitive they'd exercise already works today — `runs.startRun` already binds
a project's context, teams/personas already inject, `pairProject()` already
computes local completion state. So the recommended test is a manual one-off:
fire a normal prompt at Jarvis, in a FRESH session (not carrying this
planning conversation's context), asking it to actually do the oversight job
in one shot — open a specific project, check its files against
`pairProject()`'s state (or SharePoint if you want to stress gap G early),
report pass/fail per order. Whatever it gets wrong (skips files, hallucinates
completion, never checks SharePoint unless told to explicitly) is real signal
about which of gaps A–G matter in practice versus which context injection
already solves — evidence instead of a designed-in-the-abstract plan. Once
the phase-0 scoreboard exists, that same test's transcript becomes inspectable
rather than a vibe.

## 6. Overview tab — user's proposed scope, and the refinement made to it

User's proposal: the Overview tab should reflect "output and efficiency."
Confirmed directionally correct — it matches a vision already sitting
unbuilt in `data/todos/jarvis.md`'s Overview section ("record every process,
agent task, skill use, command and their success/output... define what
efficiency means per process type before building the scoring system").
**Refinement added this session:** keep OUTPUT (did the run do the correct,
complete thing — a verification question) and EFFICIENCY (was the cost
proportionate to the task's actual difficulty — a cost question) as two
SEPARATE signals, not one blended score. A correct-but-slow opus run on a
genuinely hard task, and a fast-but-wrong haiku run, are both "bad" in
different ways a single number would hide. Do not calibrate the efficiency
half until the phase-0 scoreboard has real dispatch examples to define
"proportionate cost" against — designing a scoring rubric from guesses now
would just be another unfalsifiable prompt-wording problem in a different
shape.

## 7. Open questions for deeper deliberation (this is the actual ask)

These are the things this session did NOT resolve and flagged as needing a
harder pass:

1. **Escalation policy shape (gap D).** What does "escalate" concretely mean
   on a second attempt — model tier up, effort tier up, reworded prompt with
   failure context, switch to a different subagent type, or some combination?
   Is a flat 2-attempt cap still right once failure reasons are actually
   visible, or should budget scale with how "close" the last attempt got?
2. **Prioritization model (gap F).** Is a static source-priority list
   (user-typed > project backlog > per-tab todos > hub self-improvement)
   sufficient, or does a real ranking need risk/urgency/staleness signals?
   What's the simplest model that isn't just guessed?
3. **SharePoint reconciliation design (gap G).** What's the actual matching
   key between a SharePoint drive item and a local project/order (filename
   convention? a manifest field? something in `lib/sharepoint.js`'s existing
   `pull()`/`push()` plumbing)? What should happen when SharePoint has an
   order the local project has never seen — auto-pull, or just flag it for a
   human?
4. **Does the "Jarvis overseer" role need a new standing primitive**, distinct
   from a one-shot delegated `Agent` call or an autopilot backlog dispatch —
   e.g., a recurring "review pass" per project (schedule-driven,
   `lib/schedules.js` already exists for cron-style recurrence) that produces
   a report rather than a code change? Or does it fold into the existing
   task/autopilot shape as just another kind of dispatched prompt?
5. **GOD_PROMPT/persona composition test** (pre-existing open item, restated
   here because it blocks trusting ANY of this): has anyone actually driven a
   real opus run with a persona active and confirmed the composition works as
   intended? This should happen before or alongside phase 3.
6. **Scope boundary vs. VPP.** The user lifted the deferral, but VPP
   (PDF→CSV throughput, `docs/vpp-frontend-cleanup-plan.md`) is still real,
   substantially-shipped work. Does orchestrator work run fully in parallel,
   or does gap G (SharePoint reconciliation) specifically become the bridge
   that finishes VPP rather than a separate track?

## Reference — files most load-bearing for this deliberation

`lib/autopilot.js`, `lib/tasks.js`, `lib/teams.js`, `lib/runs.js` (esp. lines
123-260), `lib/project-context.js`, `lib/pairing.js`, `lib/sharepoint.js`,
`prompts/fable5-god-prompt.md`, `personas/jarvis.md`, `data/todos/jarvis.md`,
`data/todos/projects.md`, `HANDOFF.md`, `docs/jarvis-orchestrator-plan.md`.

## 8. Devil's-advocate pass + video-claim verification (added 2026-07-30,
user directive — append-only, nothing above edited or removed)

Two files were attached this session: `jarvis_system_prompt_under_2000_chars.txt`
(a generic multi-agent coordinator prompt) and
`eval_driven_agent_improvement_under_2000_chars.txt` (a closed-loop eval/fix
process). Both reviewed in full; findings below.

### 8a. Verification: does either transcript say "don't use a two-prompt system"?

**No.** Read both files in full — neither mentions prompt-file count,
system-prompt composition, or persona layering anywhere. The closest adjacent
material: `jarvis_system_prompt...txt` paragraph 3 ("assume every worker
starts with no context; give each worker its role, objective, inputs,
constraints, allowed tools, output format, completion criteria; do not send
unnecessary history") is about briefing *delegated workers*, not about the
orchestrator's own system-prompt stack. `eval_driven_agent_improvement...txt`
opens with "use the smallest effective workflow," which is about task
decomposition, not prompt architecture. The claim that the source video argued
against composing GOD_PROMPT + persona into one `--append-system-prompt` call
is **not supported by the text available in either excerpt** — likely either
a portion of the original video not captured in these condensed transcripts,
or a conflation with a different point. If a real answer matters, the
specific video segment needs to be pasted/quoted directly.

### 8b. Devil's advocate against the current plan (five points, each aimed at a specific standing decision — argued, not just contrarian)

1. **Composition itself may be the wrong shape, not just untested (sharpens
   open question #5).** The plan's stance has been "test whether GOD_PROMPT
   drowns out the persona." The sharper question: even if the test passes,
   is concatenating two documents with different registers (GOD_PROMPT:
   "be complete, audit every claim" vs. persona: "casual, four sentences")
   ever reliable across arbitrary prompts, or does it just fail *less often*?
   A single unified per-persona system prompt (working discipline folded
   into each persona file, no runtime concatenation) removes the failure
   mode entirely instead of tuning around it. Worth deciding whether the
   composition test is validating the right architecture or just calibrating
   a fragile one.

2. **Phase 0 as scoped captures WHAT, not WHY — which the eval-driven doc
   says is the actual signal.** `eval_driven_agent_improvement...txt`: "judges
   produce explanations... explanations matter most because they describe why
   each response failed." Phase 0's current spec (extract `Agent` tool_use/
   tool_result pairs, list agent/brief/tool-calls/outcome) is a pure activity
   log — it does not capture *why* a delegation succeeded or failed. Shipping
   it as-is risks a false sense of "now we can verify things," when the
   harder, more valuable question (why) still isn't answered. This is exactly
   what `jarvis_system_prompt...txt` paragraph 6's structured-output contract
   (status/summary/findings/evidence/confidence/warnings/missing-info) would
   fix — already flagged this session as a Phase-0 design input, restated here
   because it's the crux of whether Phase 0 is sufficient or just a first
   step.

3. **The plan's own "test-before-hardcode" step risks the exact anti-pattern
   the eval doc warns against.** `eval_driven_agent_improvement...txt`:
   "ignore one-off issues... individual failures may be noise, false
   positives, or judge mistakes. Repeated themes are the signal." Section 5's
   recommended manual test is a single one-off run. Whatever it finds is, by
   the eval doc's own logic, not yet distinguishable from noise. Recommend
   running the manual test 2-3 times across different project types before
   treating its findings as reliable input to phases 2-3's design — one
   anecdote generalized into an architecture decision is the specific mistake
   this doc says to avoid.

4. **Deferring gap G (SharePoint reconciliation) to dead last inverts the
   user's stated priority.** The user's own framing (section 4): "Jarvis is
   the overseer... track the conversion of files for completion from
   SharePoint. Orchestrator work is absolutely necessary." That is gap G, not
   gaps A-F. The current build order ships four phases of infrastructure
   (scoreboard, plumbing, second queue, dispatch quality) before gap G's
   design pass even starts. This is defensible engineering sequencing (each
   phase de-risks the next) but carries real risk of infrastructure-before-
   value drift — scaffolding accumulates while the thing actually asked for
   keeps slipping. Suggest at minimum starting gap G's design pass (open
   question 3: matching key between a SharePoint item and a local
   project/order) in parallel with phases 0-1, even if implementation waits
   for phase 2+.

5. **Nothing bounds live, in-conversation delegation fan-out — and this is
   the exact failure shape that already happened once.** `eval_driven_agent_
   improvement...txt`'s "bounded... agent count, time, cost, and recursion
   depth" and `jarvis_system_prompt...txt`'s same principle are both currently
   satisfied only for *autopilot* dispatch (`MAX_ATTEMPTS=2`, `MAX_INFLIGHT=2`
   in `lib/autopilot.js`). A live Jarvis session firing `Agent` calls inside a
   single user-driven run has no equivalent ceiling. The 2026-07-27 incident
   (HANDOFF.md — autopilot saturating both run slots, committing mid-debug)
   was the unattended version of this; phase 2 re-arms unattended dispatch
   behind a new flag. Recommend an explicit answer to "what stops an
   escalating retry loop from just spending more per item" (phase 3's own
   escalation feature) before phase 2 ships, not after.
