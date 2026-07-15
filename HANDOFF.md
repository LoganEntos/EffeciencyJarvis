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
lib/memory.js            Engram semantic memory (typed records, lexical recall, NO vectors)
lib/sources.js sharepoint.js admin.js personas.js teams.js   Sources tab / SharePoint / Tools / personas / agent teams
index.html               markup shell (token injected at serve time)
assets/*.js  style.css   SPA modules (app/run/tasks/files/graph/agentviz/memory/voice/…)
vendor/                  LOCAL asset library: fonts + 4 icon sprites (~9.8k) + css + manifest.json
.claude/skills/          curated active skills; skills-library/ = full 278 ECC set (not auto-loaded)
.claude/agents/          14 curated model-tiered local specialists (never a bulk library)
data/                    runtime: runs/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
docs/roadmap.md          the plan · improvement-backlog.md the live find-fix list · jarvis-soul.md the persona
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

**O1. Jarvis tab error hunt (P1 — user report 2026-07-15).** The user reports
"loads of errors" persisting on the Jarvis tab; the run that was diagnosing it
was cancelled, so **no error catalog exists yet**. Step 1: open the live hub →
Jarvis tab with the browser console and catalog every error (tab load, persona
switch, tap-to-talk, hold-for-call, soul editor save). Step 2: fix. User
directive: **stop patching blind — research more sophisticated open-source
prior art** for the voice/persona loop (OpenPersona is already adopted;
open-jarvis/OpenJarvis sits unevaluated in the Sources intake list) and adopt a
proven pattern natively (zero-dep, port the idea not the framework). Constraint:
voice behavior itself (barge-in, Kokoro self-heal, reply queue) is now exactly
as the user wants — fix the tab without touching that.

**O2. Finish the skills-layer cleanup** (`docs/agent-skill-efficiency-report.md`,
steps 4–6; steps 1–3 shipped in `bd09b68` + the global CLAUDE.md is clean).
Remaining: consolidate the design suite ~6→2 (keep `ui-ux-pro-max` as reference
DB + `slides`; fold/drop `banner-design`, `brand`, `design`, `design-system`),
decide the borderline three (`autonomous-loops`, `team-agent-orchestration`,
`verification-loop` — keep only if actually invoked), check `data/teams.json`
for references before deleting, then smoke + one hub run + optional
`context-budget` before/after. ⚠ A background Fable 5 run was tasked with "ECC
skills" on 07-15 — `git log` first and reconcile; don't duplicate its work.
Ask the user whether the 5 logistics skills move to a separate work profile.

**O3. Verify the unverified.** (a) Wake-word "Suzy" gate — needs a real-mic
test with the user. (b) R5: schedules have never been stress-tested — create a
near-future schedule, assert it fires into run history, tear down. (c) Projects
tab — browser-verify at 375px.

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
- Housekeeping: `ECC-main.zip` + `ECC-main/` at the repo root are the gitignored raw
  download (adopted copy is committed) — delete when convenient.
