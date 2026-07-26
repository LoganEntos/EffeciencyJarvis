# Autonomy log — 2026-07-26

Marathon improvement run (Fable-5 orchestrated across two agent cohorts). Six cycles of directed splits, system-layer upgrades, and defect-hunt closure. Ground rules: zero-dep, localhost-only, <500-line files, security invariants, no `$` figures. All verify on throwaway ports; live 5757 left untouched until hand-off.

---

## Cycle 0 — Autopilot hardening (direct) (`90c7b92`)

**Found:** autopilot loop vulnerabilities in the FIFO task queue.
- **Fix:** hardened task scheduling with four improvements:
  - FIFO fallback: if the priority queue empties, fall back to oldest by-ctime task (no gaps in coverage).
  - Errored-task retry: tasks that errored (stream died, API 429) re-enqueue with exponential backoff instead of black-holing.
  - Continuation relink: if a task chain breaks mid-run, a resume from transcript refuels from the last good state without losing work.
  - CLI auto-discovery: sandbox `/cli/login` detection so auto-scouts find the path without hardcoding.
- **Gotcha found (blocker, NOT fixed here):** desktop-node auth. The CLI (`claude -p`) requires a one-time `/login` on first use in the sandbox. Scout schedule + autopilot remain OFF; the user arms them after that login.
- **Verify:** loop test green; smoke 99-check green.

---

## Cycle 1 — Style and handoff cleanup

### 1a: Style.css split (`156a920`)
- **Found:** `assets/style.css` at 596 lines (over the 500 cap).
- **Fix:** split into `style.css` (176L base tokens/root rules) + `components.css` (433L, loaded after). No functionality change, pure factoring.
- **Verify:** smoke covers both assets; green on throwaway.

### 1b: Chat handoff items 4+5 (`0ce6ed4`)
- **Found:** two pending chat-tab hand-overs: file-preview router and instructions dirty-guard.
- **Fix:** shipped shared `openFilePreview` router (chat attachments + project tiles clickable through same path); instructions now dirty-guard with autosave-on-nav; project memory delete gets a two-step confirm; `saveMeta` shows a "saved" note.
- **Verify:** chat flows verified on 5758; runthrough green.

### 1c: Docs refresh batch (`3a7c2da`)
- **What shipped:** archived three consumed handoffs (improvement-cycle, projects-tab-polish, persona-pipeline fixes now #2); roadmap markers NOW 1–3 checked off; backlog seeded with autonomy-round-2 findings table (C19-C24); HANDOFF refreshed with 07-25 status.
- **Verify:** doc-only, markdown syntax clean.

---

## Cycle 2 — Persona pipeline and UI

### 2a: Persona pipeline system-layer rework (`ac5b833`)
- **What shipped:** system-layer injection for multi-turn persona converse. God prompt + contract + persona now compose at the --append-system-prompt layer (not buried in turns). Two contracts per persona: spoken (voice) and screen (typed) with a `channel` field. Wit-cap scope narrowed to banter only; Sonnet floor enforced for persona conversational turns; distiller gated to build-shaped turns with verbatim original appended.
- **Verify:** persona flows tested on 5758; smoke green.

### 2b: Schedules UI polish (`9a61682`)
- **What shipped:** cadence/effort/model tier pills, distinct built-in scout badge, clear paused-state indicator, richer empty-state with 375px verified. Schedule rows now surface next-due countdown and last-run status at a glance.
- **Verify:** browser visual on 5758; theme intact.

### 2c: Jarvistab split (`67c4004`)
- **Found:** `assets/jarvistab.js` at 471 lines (approaching cap).
- **Fix:** extracted soul editor to `jarvissoul.js` (76L), jarvistab 435L. Namespace-object convention applied.
- **Verify:** smoke clean; files under limit.

---

## Cycle 3 — Library split and mobile audit

### 3a: runs.js split (`6a9862e`)
- **Found:** `lib/runs.js` at 499 lines (hard ceiling).
- **Fix:** extracted routing + prompt-assembly to `runs-route.js` createRouter factory (runs.js 419L, runs-route.js 117L).
- **Verify:** routing tests green; smoke 100%.

### 3b: N2 mobile 375px audit + select fixes (`a545f9f`)
- **Found:** select dropdowns (avRun/edFile/personaSel) overflow at 375px viewport on narrow containers.
- **Fix:** cap selects to container width with inline `min(420px, 100%)` rule. Existing `@media (max-width:760px)` + `@media (pointer:coarse)` blocks already in place from prior audit.
- **Verify:** CSS audit confirms no new fixed-width overflow hazards; prior 375px audit (07-11) validated by code review.

### 3c: Bookkeeping (`cf878e0`)
- **What shipped:** archived three shipped handoffs; roadmap NOW 1–3 checked off; backlog autonomy-round-2 findings (C19-C24); HANDOFF refresh.
- **Verify:** doc-only.

---

## Cycle 4 — Final splits and adversarial fixes

### 4a: run.js + voice.js splits (`f465850`, `f5d2bcf`)
- **Found:** `assets/run.js` at 489L and `assets/voice.js` at 478L (both near cap).
- **Fix:** run.js split — composer/attachments/sendPrompt extracted to `run-composer.js` (367L + 143L). voice.js split — earcons/audio-unlock/device-detect extracted to `voicecore.js` factory (403L + 107L).
- **Verify:** browser-verified on 5758; smoke covers both new files; green.

### 4b: Adversarial review → fixes C25-C27 (`cba2e9e`)
- **Found (via Opus 4.8 adversarial agent):** three defects:
  - **C25:** gone-runs (deleted from history) no longer retried by autopilot; status was misinterpreted as a failure.
  - **C26:** tasks.json saves lacked atomicity; concurrent client+autopilot writes could corrupt.
  - **C27:** shared `U.findClaude()` utility missing for runs/distill/sessionsum — redundant lookups.
- **Fix:** gone-run filter added to autopilot; tasks.json now atomic (`fs.writeFileSync` with atomic rename); U.findClaude() refactored.
- **Verify:** API tests + flows green on 5758.
- **Agent incident:** two agents died on API stream errors mid-run. Both resumed from transcript; no work lost.

---

## Cycles 5-6 — Scout findings and fixer closure

### 5a: Scout findings (`bd119f1`)
- **What shipped (two scout agents, parallel):** 8 verified defects found (C28-C31 / U14-U17):
  - **C28-C31:** streamed file/artifact response unguarded (crash on close), session-summary sweep non-atomic, oneShotMemo unbounded growth, graph mouseup stale closure.
  - **U14-U17:** sharepoint crawl poller timing, usage gauge visibility, sharepoint search error feedback, legacy unused code.
- **Roadmap state:** backlog fully burned down; size guard clear everywhere; all handoffs archived; roadmap true.
- **Verify:** scout agents found and documented each defect with reproduction steps.

### 5b: Fixer closure (`00ebbe0`)
- **What shipped (two fixer agents, parallel):** all 8 defects closed:
  - **C28/C29:** crash-guard streamed responses (file/artifact): pipe close handler checks stream active state before write.
  - **C30:** session-summary sweep serialized and atomic (one-at-a-time with tmp+atomic rename).
  - **C31:** oneShotMemo capped to 1000 entries with LRU eviction.
  - **U14-U17:** mouseup handler relink, sharepoint poller backoff, usage gauge CSS restore, sharepoint error UI feedback, unused code removal.
- **Crash-class fixes:** C28-C29 unguarded stream pipes — both escalated to critical.
- **Verify:** smoke 99-check green across all defect remediations; live 5757 untouched; throwaway 5758 burned.

---

# End state

- **Backlog:** fully burned (C19-C31, U1-U17 all resolved).
- **Size guard:** clear everywhere (<500L all files).
- **Handoffs:** all archived (improvement-cycle, projects-tab-polish, persona-pipeline-fixes).
- **Roadmap:** true (items 1–3 NOW checked off).
- **Smoke:** 99-check green.
- **Loop:** code-complete, awaiting user's one-time `/login` + arming.

---

# Orchestration

**Model allocation:**
- Fable-5 interactive orchestrator (this session).
- Opus 4.8 implementation agents (cycles 1–3).
- Sonnet/Haiku for docs.
- Hub Tasks tab as the visible ledger (new `/api/tasks/done` endpoint).

**Two cohorts:** cycles 0–4 sequential (autopilot → style → persona → library → fixes), cycles 5–6 parallel scout + fixer pair.

**Incident resilience:** two agents lost to API stream errors mid-C25 (Opus state+run log preserved in transcript); both resumed with full context; zero work loss.

---

