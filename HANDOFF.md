# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` — the ONE canonical status + plan doc.
Work happens in **this repo** (`C:\Users\logto\Documents\claude-hub`).

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
docs/roadmap.md          THE canonical status+plan doc · jarvis-soul.md the persona · archive/ history
docs/handoffs/           live work orders for hub runs (resolved ones → docs/archive/handoffs/)
```
Nav: Run · Live · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Sources · Tools · Config (+ SharePoint).

## Current truth (2026-07-25)

- **The self-improvement loop is code-complete and hardened** (C14–C18,
  `90c7b92`): autopilot falls back to the hub task queue FIFO, retries
  errored/gone tasks (capped), follows continuation-on-death relinks, and the
  claude CLI is auto-discovered (npm global → desktop-app bundle). The scout
  schedule is seeded but DISABLED, autopilot toggle OFF.
- **Desktop node (Desktop\claudecodeproject\EffeciencyJarvis): hub runs are
  blocked on auth** — the CLI here has never been logged in (desktop-app auth
  doesn't reach headless spawns; every run ends "Not logged in"). One-time fix
  by the USER: run `claude` in a terminal once and `/login`, then arm autopilot
  + the scout schedule from Config. Everything else is verified working (95/95
  smoke, run engine spawns the CLI fine).

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


## Latest work shipped

**2026-07-26 session:** chat items 4+5 (attachments/project click-open, discard on navigate — `0ce6ed4`), persona-pipeline fixes (system injection, dual contracts — `ac5b833`), schedules UI polish + autopilot integration (`9a61682`).
Code quality: style.css split to 176 lines + components.css 433 (`156a920`), jarvistab.js split (`67c4004`), autopilot loop hardening C14–C18 (`90c7b92`).
Everything older is archived verbatim in `docs/archive/handoff-shipped-log-2026-07.md` and `docs/archive/roadmap-2026-07-19-full.md`.

## What's next

**→ `docs/roadmap.md` is the single source of truth** — current state, the
NOW queue (finish `docs/handoffs/chat-stop-attach-project-fixes.md` items 4–5,
then `docs/handoffs/schedules-verify.md`, then N2 mobile), pending USER
verifications (real-mic pass, persona-card pass, Q1 Playwright yes), and the
deferred list. Read it before proposing or starting any work.
