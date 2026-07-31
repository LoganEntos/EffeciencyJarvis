# Jarvis tiering, voice-module scope, and 19-tab UX sweep — handoff (2026-07-31)

Consolidated record of a long deliberation + verification session, written for
a fresh session (ideally a higher-reasoning model) to pick up cold. Companion
reading: `docs/jarvis-orchestrator-deliberation-2026-07-30.md` and
`docs/jarvis-orchestrator-plan.md` (the prior session's Jarvis-as-Projects-
overseer plan — still the standing plan for that track, not superseded by
this doc). This session ran almost entirely in plan/deliberation mode by
explicit user directive — most of what's below is analysis and cataloging,
not shipped code. What actually shipped is called out explicitly in section 4.

## 1. Agent-tiering deliberation — where it landed

The user is designing a 4-tier agent hierarchy on top of the existing
haiku/sonnet/opus roster: a new top ("fable") tier for senior judgment work,
with opus repositioned as a "mid" reasoning/coordination tier in spirit
(though the three existing opus agents were NOT repositioned — see below).

**Decided:**
- Overseer and "input-layer" (voice/prompt intake) are two SEPARATE agents,
  not one Jarvis wearing two hats, and not a repurpose of the existing three
  opus agents (`architect`, `security-auditor`, `agentops-engineer` — they
  keep their current jobs).
- Fresh-build preferred over promoting existing agents.
- Hard limit for now: **one fable agent (built) + two opus agents (not yet
  built).** Do not create more agents past this ceiling without a fresh
  explicit go-ahead.
- One of the two pending opus agents is specifically an **agentic-teams
  specialist** — confirmed this session that nothing today does this job:
  `lib/teams.js`'s `ROSTER`/`BUILTINS` are a static list + two static presets
  a human picks in the UI; nothing dynamically monitors team performance or
  reworks composition. This is a genuine new agent, not a duplicate.
- The **second opus agent's role is explicitly TBD** — don't invent one, wait
  for the user to name it.
- `warden` (`.claude/agents/warden.md`) is built: fable-tier, read-only tools
  (Read/Grep/Glob/Bash/Skill), advisory-only (never edits, never fires runs).
  Reviews project completion + delegation quality. Approved as designed by
  the user. **Not yet added to `lib/teams.js` ROSTER** — open call: should a
  team preset proactively suggest Warden, or does it stay Agent-tool-only
  (deliberate friction so a senior review pass doesn't fire on every routine
  task)? Also not yet exercised on a real run — same "test before hardcoding"
  caution as everything else in this doc.

**Blocker discovered, not yet fixed:** the working-discipline system prompt
(`claude-dashboard/prompts/fable5-god-prompt.md`, "GOD_PROMPT") only injects
on `isOpusTier(model)` (`claude-dashboard/lib/runs.js`) — despite the
filename, it does NOT fire for `model: fable`. Warden currently hand-carries
a condensed copy of the discipline block in its own body as a workaround
(matching how `architect.md`/`security-auditor.md` already do this for
opus). Any future opus/fable agent needs the same manual copy until the gate
is widened, OR until the separately-flagged "single unified per-persona
system prompt instead of runtime concatenation" redesign ships (that redesign
question predates this session — see `data/todos/jarvis.md`'s "Added
2026-07-30" section — and is now sharper given a real fable tier exists).

**New tooling shipped to support this:** `.claude/skills/hub-agent-builder/`
— a checklist skill for wiring a new `.claude/agents/*.md` specialist
correctly (frontmatter, tier choice, least-privilege tools, the GOD_PROMPT
gotcha above, optional `ROSTER` registration). Built because agent creation
was, by the user's own read (and independently confirmed — no such checklist
existed anywhere), undocumented tribal knowledge.

**UI bug found and logged (not fixed):** the Agents tab doesn't actually give
fable its own section — `assets/lists.js:94` groups `fable` into the same
bucket as `opus` (`if (/opus|fable/.test(m)) return 'Opus · heavy';`), and
the pill-badge logic at `lists.js:136` colors fable the same red as opus but
only appends the "· heavy" qualifier for an actual opus match — so Warden's
row shows bare "fable" sitting inside a section literally labeled "Opus ·
heavy." Filed in `data/todos/agents.md`. Verified live against the running
server's own `/api/agents` response (see section 4) — Warden IS present and
correctly tagged `model: fable` server-side; this is purely a client-side
grouping/label bug, not a data problem.

## 2. Voice-module scope — what got untangled

The user originally framed "restructure Jarvis" as one big ask (an "entirety
voice module protocol" owning speech input, autocorrect, and prompt
enhancement). Two real distinctions emerged this session that materially
change what gets built and when:

**A. Overseer vs. input-layer are different jobs** (see section 1) — this was
the first untangling.

**B. The input-layer idea itself splits into two DIFFERENT problems that were
being treated as one, only one of which the user actually wants right now:**

1. **Barge-in / interrupt reliability** — "stop talking when I talk over it,"
   or saying "hey, shut up" and having it actually, instantly work. This is
   an EXISTING subsystem (`Q.muted`, `stopSpeak()` in
   `claude-dashboard/assets/voicetts.js`; wake-word/typing/Esc handlers in
   `claude-dashboard/assets/voice.js`), not something to build from scratch.
   Costs ZERO added latency per turn, because it never touches a model — it's
   just reliably killing audio playback. **This is the cheap, real, available
   win** — a scoped audit/fix candidate whenever the user wants to pick it up.
2. **Semantic ASR correction** — "understand what I meant even when the mic
   mis-hears me." This genuinely requires a model in the loop (either a
   pre-pass run before the main Jarvis run each turn, or folding into the
   existing fast heuristic classifier in `distill.js`'s `isBuildShaped`/
   `isConversational`, which is pattern-matching, not understanding). This
   COSTS latency per turn. **Explicit user directive: zero added latency per
   turn, no exceptions.** Combined with "neither option sketched is
   functional enough yet, building either now is wasted directive" — **this
   whole line of work is ON HOLD.** A sophisticated voice module is still
   wanted eventually, built in segments, but not started.

**Net effect:** don't build ASR/prompt-enhancement logic next. If picking up
voice-module work again, the barge-in reliability fix is the one item that's
actually ready to scope and ships with zero tradeoffs — everything else in
that space stays parked.

## 3. Full 19-tab UX/functionality sweep — what's now tracked

A read-only, source-level audit (no live browser was available this session —
flagged explicitly to the user rather than faking browser verification) swept
every nav tab, cross-checked against each tab's existing `data/todos/<tab>.md`
to avoid duplicate findings, and filed everything new directly into those
files. Full detail lives in the per-tab TODOs; this section is pointers +
what actually matters most.

**Two findings are real severity, not polish — read these before anything
else in the list:**

- **`data/todos/projects.md`** — the "Escalate to Run tab" button on an
  imported Claude Code workspace project has no guard against the exact
  hazard the inline chat panel was deliberately disabled to prevent: it still
  injects that project's files into a run that executes in the hub's own
  directory, not the real one. Compounding: `fileCount` is hardcoded to 0 for
  those same projects even though upload/SharePoint/pairing all work
  normally underneath — the file count badge actively lies while the hazard
  sits unguarded next to it.
- **`data/todos/agents.md`** — the fable-tier grouping bug from section 1.

**A systemic root cause, not five separate bugs:** the shared client fetch
helper (`api()` in `claude-dashboard/assets/app.js`) resolves an `{error}`
object on HTTP 4xx/5xx instead of rejecting. Sessions, Overview, Memory, and
Health each have their own flavor of "server error renders as a fake clean
result" because of this one behavior. Already logged as a one-line
central fix candidate in `data/todos/config.md` — worth doing once there
instead of patching each tab's symptom separately.

**Everything else, by tab (see the named file for exact file:line detail):**
`jarvis.md` (a dead session-badge control sitting next to a working one, a
per-keystroke model readout that doesn't drive what actually fires),
`run.md` (closing chat mid-run abandons the run server-side instead of
stopping it; cancel button swallows real failures; one stale TODO item
corrected — delegation rendering already shipped via
`assets/delegations.js`, checked off), `live.md` (three separate stale/frozen-
state gaps in the polling), `tasks.md` (deleting a queued task has no
confirmation, unlike everything else that deletes; no edit action anywhere),
`files.md` (a dotfile upload disappears with zero feedback either way; no
search on the root inbox list), `sharepoint.md` (a double-click on Graphify
can fire two full-priced Opus runs), `sessions.md` (re-summarize can be a
silent no-op that looks like it worked), `memory.md` (browse list caps at 100
while its own stat chip claims the full total), `skills.md`/`commands.md`/
`assets.md`/`sources.md` (no loading state anywhere — blank screen during
every fetch), `tools.md` (site editor discards unsaved edits with zero
warning, including real server code), `config.md` (three panels fail dead
silent on error). `graph.md` had nothing new — already thoroughly covered by
the prior chop-and-cut pass.

**Nothing in this section was fixed.** All of it is sitting in the per-tab
lists, held per the same plan-mode directive as the voice-module work.

## 4. What actually shipped this session (the small part that isn't planning)

Given the user's own meta-question this session ("how much are you creating
versus spending on planning/deliberation") — an honest accounting:

- `.claude/agents/warden.md` — new agent, real file, not yet exercised on a
  real run.
- `.claude/skills/hub-agent-builder/SKILL.md` — new skill, real file.
- **Run tab, verified working (throwaway server on :5758, smoke script green,
  code-reviewer pass with one bug found and fixed before shipping):**
  - A "✕ clear" button next to the prompt textarea — wipes text + pending
    attachments + stops active dictation, visible only when there's
    something to clear. Wired through every place that programmatically sets
    the textarea's value (`updateTaClear()` in `assets/run.js`, called from
    `run-composer.js`'s send flow and mic-dictation handler, `prefillRun()`,
    and `voiceconvo.js`'s live-caption/routeSend paths — the last of these
    was the one bug code-reviewer caught: `routeSend()` wasn't calling it,
    now fixed).
  - Run history (stats chips + filter + row list) is now a collapsed-by-
    default `<details>` section, persisting open/closed state to
    localStorage, so token-usage-heavy history no longer dominates the tab
    on load.
  - **Caveat: no live browser was available this session**, so these were
    verified by full source tracing + a green smoke-test run + an
    independent code-reviewer pass catching one real bug pre-ship — not by
    actually clicking the button in a browser. Worth an actual click-through
    whenever browser access is available.
  - **New size-guard state:** `assets/components.css` is now exactly 500
    lines (the hard limit) and `assets/run.js` is 497 — both filed in
    `data/todos/health.md`. The NEXT edit to either file needs a split
    first, not another append.

**Everything else this session** — the entire 19-tab sweep, the 4-tier agent
architecture discussion, the voice-module untangling — was analysis,
verification, and cataloging. Real, load-bearing groundwork (several of the
findings are genuine bugs, not busywork), but zero app behavior changed as a
result of it beyond what's listed above.

## 5. Open questions for the next session

1. Fix the fable-tier Agents-tab grouping bug (section 1) — small, isolated,
   no design decision needed, just do it.
2. Decide the GOD_PROMPT/fable gate (section 1) before building either
   pending opus agent, since both may end up senior-tier enough to need it.
3. Name the second opus agent, or confirm it stays unbuilt indefinitely.
4. Decide whether Warden joins `lib/teams.js` ROSTER or stays deliberate-
   invoke-only.
5. Prioritization call: the Projects "Escalate" hazard (section 3) is the
   highest-severity item on the entire board right now — worth deciding
   whether it jumps the queue ahead of the plan-mode hold, given it's a
   correctness/safety bug rather than a feature.
6. Whenever voice-module work resumes: scope the barge-in reliability fix
   first (section 2) — it's the one item that's actually ready, zero-
   latency-cost, and doesn't require resolving the semantic-ASR-correction
   architecture question first.
7. Central `api()` error-shape fix (section 3) — one change in
   `claude-dashboard/assets/app.js` that resolves the same-root-cause
   symptom across four tabs at once.

## Reference — most load-bearing files for this deliberation

`.claude/agents/warden.md`, `.claude/skills/hub-agent-builder/SKILL.md`,
`claude-dashboard/lib/teams.js`, `claude-dashboard/lib/runs.js`,
`claude-dashboard/prompts/fable5-god-prompt.md`,
`claude-dashboard/assets/lists.js`, `claude-dashboard/assets/voicetts.js`,
`claude-dashboard/assets/voice.js`, `claude-dashboard/assets/distill.js`,
`claude-dashboard/assets/app.js` (`api()`), `data/todos/jarvis.md`,
`data/todos/agents.md`, `data/todos/projects.md`, `data/todos/health.md`,
`docs/jarvis-orchestrator-plan.md`,
`docs/jarvis-orchestrator-deliberation-2026-07-30.md`.
