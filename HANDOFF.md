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
lib/runs.js  runs-engine.js  runs-query.js   run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
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

## Latest work shipped (2026-07-19)
1. **F1 split (2026-07-19, commits 53c6747/3c6eabe):** `lib/runs.js` process
   lifecycle extracted to new `lib/runs-engine.js` via createEngine factory
   (386+179 lines, zero behavior change).
2. **Jarvis chat parity (2026-07-19, commits b73ba5a/1c7ca98):** chat owns
   `#jconv`; transcript tail moved to collapsed "▸ live activity" strip; ▷
   run-this fires in-tab with ⤴ run-tab secondary; file attach (new
   `assets/jarvisattach.js`) via paste/drop/📎; session badge; send() returns
   honest true/false.
3. **Distill latency (2026-07-19, commits 20a43cd/477c1fc):** root cause was
   child stdin left open; fixed with stdio ignore; ~12.6s → 6-8s typical.
4. **Voice orb live (2026-07-19, commits 9421d61/8ae1c87):** mic-driven orb
   waveform (shared AnalyserNode, `jarvisOrb.setAudio`), real RTT badge
   (end-of-speech → first TTS audio, rolling last-3, `HubVoice._rtt`), ◐ think
   one-shot → `--effort max` mapped in `lib/runs.js`, timeline dots jump (new
   `assets/jarvistimeline.js`).
5. **Persona manager UI (2026-07-19, commits eeccf1a/272282f):** new
   `assets/jarvispersonacards.js` (206 L): hover ✎/✕ with two-step delete
   confirm, inline rename-id, drag-to-reorder → `/api/personas/order`, ＋ ghost
   card → soul editor new-persona mode.
6. **Spoken-reply contract tightened (2026-07-19, commit 6dbea80):**
   `personas/_guidelines.md` + `lib/personas.js` DEFAULT_GUIDELINES — under
   1 min of speech, casual friend tone, no jargon, updates only when they
   matter.

## Latest work shipped (2026-07-14 → 07-17)
2026-07-17 (commit `36bd72d`, planned + approved): **voice conversation
engine** — new `assets/voiceconvo.js` state machine fixes "Jarvis doesn't
reply after being woken": passive wake-listening on the Jarvis tab (hot mic,
everything but the wake word discarded), bare "Jarvis" gets a persona-flavored
spoken ack (`ack:` frontmatter, editable in the soul editor), an OPEN
conversation needs no wake word between turns and closes itself after a
configurable window of held silence (default 5 s), endpointing with
trailing-connector grace so pauses never cut speech off, name-only barge-in
with a self-echo filter, and spoken turns route through the in-tab Jarvis
chat. Headless-verified via `HubVoiceConvo._ingest`; **real-mic pass still
needed from the user**. `60ccb93` set the wake word to "Jarvis" (+ STT
misrecognition variants).

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

## EXECUTE NEXT — agent-team queue

**Status:** items 2–6 from the 2026-07-17 queue SHIPPED 2026-07-19. Work orders
live in `docs/handoffs/` — read its README first. Each is sized for one hub run
and carries the mandatory review pipeline (verify → smoke → code-reviewer →
commit). The Lovable Jarvis+Overview ports are DONE (`c30fa91`, `682c63e`,
`fbc1fee`); the Projects inline chat is DONE with its P1 projectId fix
(`639b317`). Scope rule still stands: only Jarvis + Overview were ported from
the Lovable build — the other tabs' Lovable screens "need work", don't port
them.

**Next queue (execute top-to-bottom):**
0. ⭐ `docs/handoffs/chat-stop-attach-project-fixes.md` — **NEW, TOP PRIORITY
   (2026-07-21 audit).** Chat has no stop control (server cancel exists,
   unwired in both chats — orphans a running turn, burns tokens); double-send
   race; overwrite-retry uploads nothing; attachments/project files aren't
   click-to-open; instructions discard silently on navigate-away; double heavy
   fetch on run-done. Full specifics + line refs in
   `docs/audit-2026-07-21-chat-attach-projects.md`.
1. ~~`docs/handoffs/projects-tab-polish.md`~~ — ✅ SHIPPED in `f77ffff` (all six
   parts: per-project model select, thread-resume clarity, in-place run refresh,
   ✦ distiller toggle, runs-table `overflow-x:auto`, empty-state reorder). The
   prior "PENDING" marker was stale; verified present 2026-07-19.
2. Real-mic pass on **voice-orb-live** (orb waveform + RTT badge listen-through,
   Bluetooth-headset contention check — user interactive verification only).
3. Real-browser drag/keyboard-nav pass on **persona cards** (headless browser
   can't spawn in run sandbox — user verification).
4. `docs/handoffs/schedules-verify.md` — schedules UI polish + R5 stress test.

Standing constraints for every item: ⚠ voice CONVERSATION behavior is now the
`36bd72d` engine (`assets/voiceconvo.js` — wake→ack→open window→close on held
silence; the old "don't touch the call loop" note is superseded by that
user-approved rebuild; Kokoro self-heal + the TTS reply queue remain as-is) ·
no `$` anywhere (tokens + % only) · zero-dep · <500-line files · check
`/api/runs` + `git status` before editing.

Interactive verifications that still need the USER: wake-word "Jarvis"
real-mic test (default flipped from "Suzy" 2026-07-17, with jarvis/jervis/
javis misrecognition variants); a real-mic pass on the orb waveform once
voice-orb-live ships.

**Then the roadmap queue** (`docs/roadmap.md`): N2 mobile ergonomic pass, R3
auto session summaries (cheap-model, cached), R4 image thumbnails + day
grouping in Files, N8 iPhone polish (Tailscale PWA already live). 🙋 Q1
Playwright still awaits the user's yes. **N10 Council is lowest priority —
build last, if ever** (user call 2026-07-15).

## Pending USER actions (interactive verifications)
- **Real-mic pass on voice orb** — once voice-orb-live ships, test the mic-driven
  waveform, RTT badge, and think toggle with a real microphone and Bluetooth-headset
  scenarios.
- **Real-browser persona-card pass** — drag-to-reorder, rename inline, delete confirm,
  and ＋ new-persona flow on the Jarvis tab at desktop + 375px. (Headless browser
  can't spawn interactive runs in the run sandbox.)
- **Mobile:** install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- **Autostart:** `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`.
- **Q1 Playwright** (dev-only, no run tax): a quick "yes" and the E2E net gets built.
