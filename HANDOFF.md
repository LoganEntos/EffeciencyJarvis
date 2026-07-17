# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` (the plan) and `docs/improvement-backlog.md`
(the live find-fix list). Work happens in **this repo**
(`C:\Users\logto\Documents\claude-hub`).

## What this is (30 seconds)
A **zero-dependency** local Node web app that is the user's front end for working
with Claude: prompt runs with **automatic model allocation** (haiku/sonnet/opus by
complexity), live SSE streaming, run history + metrics, a task queue the hub works
through itself, scheduled runs, a file inbox, a voice module, and monitoring tabs.
The user drives it in the browser at **http://127.0.0.1:5757** (and from a phone
over their own Tailscale). No client/business data, no Power BI — just the hub.

## Run it
```
"C:\Program Files\nodejs\node.exe" claude-dashboard\server.js        # port 5757 (arg overrides)
powershell -File scripts\verify-dashboard.ps1 -Port 5757             # smoke test — keep green
```
Never block on the server from Bash — start it detached or from a terminal. Some
engines (hermes ACP) only work when the hub is **terminal-launched**, not headless.

## Ground rules (non-negotiable)
1. **No client/business data** without an explicit prompt in that conversation. M365/SharePoint indexes are searched from `data/sharepoint-index.json`, never live-enumerated.
2. **App runtime stays zero-dependency** — plain Node built-ins + vanilla JS/CSS. Dev-only deps (e.g. Playwright) are fine with the user's OK. Installs are allowed to enhance the hub, but **token efficiency governs**: prefer zero-dep, never add always-on MCPs (each one taxes every run's context — scrapling is the only one).
3. **Localhost only** (127.0.0.1). Never widen the bind, add CORS, or expose publicly. Remote = the user's own Tailscale, never a tunnel you create.
4. **Every file < 500 lines.** Split before crossing.
5. **Security invariants** (don't regress): `X-Hub-Token` on all non-GET; CSP-sandboxed artifacts; path-traversal guards on every id/file param; argv-array spawns (no shell).
6. **Never present outputs as HTML pages/artifacts.** Reports/audits/lists go in the chat reply as plain text, or as a committed `.md` in `docs/`. The dashboard's own UI is the exception (that IS the product).
7. **Read a file before editing. Never commit secrets. No `Co-Authored-By` trailers.** Verify in a real browser + run the smoke script before committing; commit at each working stage.
8. **UI work:** consult `.claude/skills/ui-design` + the Design-language section in `CLAUDE.md` (distinctive fonts, dominant-color palette, depth, one staggered load animation — no AI-slop).
9. **Parallel-run hazard is real:** the user fires acceptEdits runs from the Run tab that edit this very repo (often by voice). Before editing, `git status` + check `/api/runs` for an active run on the same files — reconcile, don't clobber.

## Architecture
```
server.js                boot + router + static + /vendor/ + X-Hub-Token guard
lib/util.js              shared helpers (fs, no-shell spawn, body reader, MODELS allowlist)
lib/core.js              overview / library / assets / sessions / graph endpoints
lib/runs.js  runs-query.js   run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js schedules.js    hub-native task queue + cron → run engine (data/*.json)
lib/agentgraph.js liveness.js run stream → persona crew graph; orphan reaper + heartbeat
lib/files.js             upload inbox (vanilla multipart) + zero-dep xlsx preview
lib/voice.js             TTS proxy /api/voice/* (loopback-only; spawns CSM/Kokoro sidecar)
lib/distill.js           Jarvis prompt distiller: POST /api/jarvis/distill (Haiku one-shot)
lib/memory.js            Engram semantic memory (typed records, lexical recall, NO vectors)
lib/sources.js sharepoint.js admin.js personas.js teams.js   Sources tab / SharePoint / Tools / personas / agent teams
index.html               markup shell (token injected at serve time)
assets/*.js  style.css   SPA modules (app/run/tasks/files/graph/agentviz/memory/voice/…)
vendor/                  LOCAL asset library: fonts + 4 icon sprites (~9.8k) + css + manifest.json
.claude/skills/          curated active skills; skills-library/ = full 278 ECC set (not auto-loaded)
.claude/agents/          14 curated model-tiered local specialists (never a bulk library)
data/                    runtime: runs/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
docs/roadmap.md          the plan · improvement-backlog.md the live find-fix list · jarvis-soul.md the persona
docs/handoffs/           self-contained work orders for hub runs (one Opus 4.8 run each)
```
Nav: Run · Live · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Sources · Tools · Config (+ SharePoint).

## Current truth (2026-07-15)
- **Engine = Claude ONLY.** The stack is Claude Code's own: auto model-routing +
  14 model-tiered subagents + agent teams (`lib/teams.js`). **hermes is DEPRECATED
  as too expensive** — not deleted, hidden behind `settings.hermesEnabled` (default
  off); for real hermes work use Hermes Desktop. ruflo/claude-flow retired long ago.
- **Design = clean-dark "amber-agent-orb"**, ported 1:1 from the user's Lovable
  reference. Tokens `#0c0b0a` / `#17140f` / amber `#e8a33d`; Bricolage Grotesque /
  JetBrains Mono / Instrument Serif (all vendored). Clean-dark is the default; ◐
  toggles warm/light. All tabs done.
- **Voice** has three TTS engines: browser speechSynthesis (default, instant),
  Kokoro-82M (fast, `.kokoro/` sidecar), and Sesame CSM-1B (most natural but ~6 s
  first word on the 3060, `.csm/` sidecar). Sidecars are gitignored, started from
  Config → Voice → ⚡ Start engine; they do NOT autostart with the hub.
- **Memory** = `lib/memory.js` semantic-over-vectors: auto-captures runs, opt-in
  "◇ memory recall" toggle injects top-3 memories into a prompt (default off).
- **Git:** a private remote now exists (`origin` →
  `github.com/LoganEntos/EffeciencyJarvis.git`). `scripts/sync.ps1` does
  pull-rebase-then-push. `data/`, `.claude/settings.local.json`, and the sidecar
  dirs are gitignored (per-machine). The user drives push; don't push unprompted.

## Latest work shipped (2026-07-14 → 07-15)
2026-07-15 night (commits `045ee51`→`39e6ed6` — reconcile of the background
handoff run + the no-dollars directive):
- **NO DOLLAR FIGURES ANYWHERE, EVER (user directive).** `39e6ed6` swept every
  `$` out of the app: header badge, run result lines, history chips/rows, the
  Run-tab gauge (now a completion-% ring), Config (budget inputs deleted),
  Tasks/Schedules/Projects/Memory/Agents. Metrics are **tokens** (`fmtTok`:
  85 / 12.4k / 1.3M) **+ completion/routing %**. `/api/spend/today` →
  `/api/stats/today`; `/api/usage` returns token windows + completionPct (the
  whole $-budget concept incl. `POST /api/usage/config` is deleted).
  `meta.costUsd` is still recorded in run history, just never displayed.
- **Jarvis tab → operator console** (`045ee51`, from the background handoff
  run, reviewed + bug-fixed): persona cards row, LIVE CONVERSATION pane (orb +
  session-transcript tail) + PROMPT WORKSPACE pane (distiller surfaced with
  refine chips, copy, run-this). Review caught a real crash: `pollTranscript`
  called an undefined `fmtEvent` — added the missing formatter, verified live.
- **Overview: plan-usage bars deleted** (they were manual Config numbers the
  hub couldn't verify) → model-distribution + success-rate panel computed from
  real run history; in-app editable "Lovable prompt" panel
  (`docs/lovable-prompts/overview-tab.md`).
- **O2 skills cleanup DONE** (`573212a`): design suite 6→2 (`ui-ux-pro-max` +
  `slides`), borderline three deleted after a zero-refs check. Logistics
  skills untouched (open user question).
- **O1 error hunt DONE** (`d212169`, background run): beacon works; zero
  Jarvis-tab errors captured beyond the already-fixed `6c09bd7` crash.

2026-07-15 evening (commits `4b0b0e3`, `1fb6cd4` — reconcile + orchestration session):
- **Jarvis distiller landed** (`lib/distill.js`, `POST /api/jarvis/distill`):
  Haiku one-shot rewrites >25-word "vibe" prompts; the refined prompt becomes
  the visible turn. Probe: ~3–13 s, falls back to local cleanup on any miss.
- **Run history RESTORED on the Run tab** — the distiller session's run.js
  edit had dropped it (the user's "no previous threads" report). Verified:
  200 rows + stats chips + filter render, zero client errors.
- **Persona CRUD backend complete** (`lib/personas.js`): delete / rename /
  display-order endpoints join save+active; `data/personas.json` is
  merge-written ({active, handoff, order}). Full cycle verified live. UI
  wiring deliberately deferred — **the user is redesigning the Jarvis tab on
  Lovable; do NOT restyle it speculatively.**
- **5757 hub restarted** via supervised `/api/restart` → distill + clientlog
  beacon + persona CRUD routes are LIVE. Smoke extended to 84 checks, all green.
- **Handoff pipeline created: `docs/handoffs/`** — self-contained work orders
  (jarvis-ui-port · persona-manager-ui · jarvis-error-hunt) sized for one
  Opus 4.8 hub run each, with the mandatory review pipeline in its README.
- **Cleanup:** ECC-main.zip + ECC-main/ + `.claude-flow/` + `__pycache__`
  deleted (~73 MB); `docs/jarvis-persona.yml` → `docs/personas/jarvis-voice.yml`.

2026-07-15 late (commits `e844d02`→`5dc783b`, Opus 4.8 voice session):
- **O1 diagnostics — client-error beacon (`e844d02`).** The Jarvis-tab error hunt
  was blocked: no console access from a voice/phone session, so no catalog. Added
  a zero-dep black-box recorder — `assets/clientlog.js` (loaded FIRST) traps
  `window.onerror` + unhandledrejection + a console.error tap, tags each with the
  visible tab, beacons to `lib/clientlog.js` (200-record capped ring in
  `data/clientlog.json`, gitignored; POST token-guarded, GET reads back w/ `?tab=`).
  **Static pass over jarvistab.js / voice.js / personas.js / index wiring was clean
  — the errors are runtime/browser-specific.** ⚠ **NOT YET ACTIVE:** the 5757 hub
  must restart to serve the new route + asset. NEXT SESSION: after a restart, open
  Jarvis, exercise it (load, persona switch, tap-to-talk, hold-call, soul save),
  then `GET /api/clientlog?tab=jarvis` (or read `data/clientlog.json`) and fix the
  real errors precisely. Smoke +3 (all green on a throwaway 5772 instance).
- **Token-efficiency protocol processed + wired (`502d57e`, `5dc783b`).** User
  uploaded `PULSE-TOKEN-EFFICIENCY-COMPACTOR.md` (a portable protocol from another
  agent system). ~80% was already the hub's ethos; distilled the coding-behavior
  deltas to `docs/token-efficiency.md`, then wired a terse ≈60-token "Token
  discipline" clause into `buildRunHint()` (`lib/util.js`) so every run gets it
  (don't re-read context/just-written files, read slices not whole files, diffs
  over rewrites, dense code, no preamble).
- **OpenJarvis** already tracked in `lib/sources.json` (queued, Apache-2.0); user's
  link carried an `mcp_token` credential — stripped, not stored.

2026-07-16: **Jarvis-tab overhaul finalized** — the main tab split into three
modules (`jarvistab.js` 404 L + `jarvisorb.js` 186 L + `jarvischat.js` 130 L)
while `jarvis.js` (112 L) remains the cross-tab helper (initJarvis,
analyzePromptComplexity, jarvisDistill, DISTILL_MIN_WORDS, JARVIS_HUE table,
jarvisHueOf). Four defects fixed: transcript poller resumes after chat send,
send button re-enables on error, holding-in-context panel anchors correctly,
duplicate HUE/hueOf hoisted. Smoke extended to 88 checks, all green. **If
jarvistab.js grows past ~450 L, next splits:** soul editor → jarvissoul.js
(~60 L) or persona-card render → jarvispersonas.js (~50 L).

2026-07-14: **C1–C13 code-health** + **U1–U13 UI/a11y** rounds done; the 15-item
P1/P2/P3 find-fix round closed; **N7 SharePoint Breakdown** shipped — see
`docs/improvement-backlog.md` (all ✅) and `docs/roadmap.md`.
2026-07-15 (commits `8627af2`→`310ef9d`):
- **Jarvis tab** (`assets/jarvistab.js`/`jarvis.css`, `lib/personas.js`) — voice
  face: state orb, persona chips (Jarvis/Dispatch/Sage), soul editor, OpenPersona
  soul handoff on switch. ⚠ See O1 below — user reports it still errors.
- **Voice hardening** — barge-in fix (stopped cutting the user off mid-sentence),
  self-healing Kokoro sidecar (boot warm-start + on-demand respawn), 'ok' vs
  'ready' status bug that muted mobile, streamed reply queue, ↻ Read-again button.
  **The user has voice how they want it — do not regress this behavior.**
- **Latency** — `/api/spend/today`, cached artifact counts.
- **Projects tab overhaul** — run stats + recent-runs + inbox import, inline UI,
  instruction presets, file manifest (`lib/projects.js`, `assets/projects.js`).
- **Run-engine safety hint** — runs must never kill the 5757 listener (orphans
  the run); verify server changes on port 5758 (`lib/util.js`).
- **~190-entry claude-flow purge** (`bd09b68`) — 166 dead commands + 28 dead
  skills removed per `docs/agent-skill-efficiency-report.md`.

## EXECUTE NEXT — Opus 4.8 finish list (ordered; handoff 2026-07-15)

**O0. Work orders live in `docs/handoffs/` — read its README first.** Each is
sized for one hub run and carries the mandatory review pipeline (verify →
smoke → code-reviewer → commit).

**O1. ✅ DONE — Jarvis tab error hunt** (`d212169`; see
`docs/handoffs/jarvis-error-hunt.md`). Beacon stays live — keep reading
`/api/clientlog` after UI changes. Voice behavior still must not change.

**O1.5. Jarvis tab UI port** → `docs/handoffs/jarvis-ui-port.md` +
`docs/handoffs/persona-manager-ui.md`. **BLOCKED: the user is improving the
design on Lovable — do NOT restyle the Jarvis tab until they deliver the
final preview URL.** (An interim operator-console layout shipped in `045ee51`;
the Lovable port supersedes it when the design lands.) The persona-CRUD
backend is live and verified. ⚠ No `$` in any new UI — tokens + % only.

**O2. ✅ DONE — skills-layer cleanup** (`573212a`; see
`docs/handoffs/skills-cleanup.md`). Open user question: do the 5 logistics
skills move to a separate work profile?

**O3. Verify the unverified.** Headless part →
`docs/handoffs/schedules-verify.md` (R5 schedules have never been proven to
fire). Interactive part stays with the user: (a) wake-word "Suzy" real-mic
test, (b) Projects tab at 375px. Optional after all READY handoffs:
`docs/handoffs/distill-latency.md` (~12.6 s cold Shaping… wait).

**O4. Then the roadmap queue** (`docs/roadmap.md`): N2 mobile ergonomic pass,
R3 auto session summaries (cheap-model, cached), R4 image thumbnails + day
grouping in Files, N8 iPhone polish (Tailscale PWA already live). 🙋 Q1
Playwright still awaits the user's yes. **N10 Council is lowest priority —
build last, if ever** (user call 2026-07-15).

## Pending USER actions (remind them; you can't do these)
- **Permission allowlist for hub runs.** Auto-mode agents can't self-widen execution
  perms (anti-injection). For hub runs to execute `node`/`curl`/`powershell`/web, the
  user must set the run mode to `bypassPermissions` (the current default) or hand-add
  the `Bash(…)`/`WebSearch`/`WebFetch(...)` entries in `.claude/settings.json`.
- **Mobile:** install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- **Autostart:** `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`.
- **Q1 Playwright** (dev-only, no run tax): a quick "yes" and the E2E net gets built.
- **Deliver the final Lovable Jarvis-tab design** (preview URL) — unblocks
  `docs/handoffs/jarvis-ui-port.md` + `persona-manager-ui.md`.
