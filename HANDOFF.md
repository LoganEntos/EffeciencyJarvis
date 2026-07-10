# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` for the full plan. Everything you need
to continue is here. Work happens in **this repo** (`C:\Users\logto\Documents\claude-hub`) —
NOT in `bigplans.SemanticModel` (that's the separate Power BI project; leave it alone).

## What this is (30 seconds)
A zero-dependency Node web app that is the user's front end for working with
Claude: prompt runs with **automatic model allocation** (haiku/sonnet/opus by
task complexity) for token efficiency, live streaming, run history, a task
queue the hub works through itself, a file inbox, and monitoring tabs. The
user bookmarked **http://127.0.0.1:5757** and drives it from the browser.

## Run it
```
cd C:\Users\logto\Documents\claude-hub
"C:\Program Files\nodejs\node.exe" claude-dashboard\server.js        # port 5757
```
Smoke test (keep green, extend per new endpoint):
```
powershell -File scripts\verify-dashboard.ps1 -Port 5757
```
Server accepts a port arg (`server.js 5758`). Never use Bash to run it in a way
that blocks — start detached or via the Browser preview tooling.

## Ground rules (non-negotiable)
1. **No client/business data** without an explicit prompt in that conversation. M365 has never been called; keep it that way.
2. **No-install rule is LIFTED** (user, 2026-07-10) — installs are allowed to enhance the hub. BUT **token efficiency still governs**: prefer zero-dep, and do NOT add always-on MCPs (every MCP in `.mcp.json` taxes every run's context).
3. **Localhost only** (127.0.0.1). Never widen the bind, add CORS, or expose publicly. Remote = the user's own Tailscale, never a tunnel you create.
4. **App runtime stays zero-dependency** (plain Node built-ins + vanilla JS/CSS). Dev-only deps (e.g. Playwright) are fine.
5. **Every file < 500 lines.** Split before crossing.
6. **Security invariants** (don't regress): X-Hub-Token on all non-GET; CSP-sandboxed artifacts; path-traversal guards; argv-array spawns (no shell).
7. **Verify in a real browser + run the smoke script before committing.** Commit at each working stage. No `Co-Authored-By` trailers.
8. **UI work:** consult `.claude/skills/ui-design` and the Design-language section in `CLAUDE.md` (anti-"AI slop": distinctive fonts, dominant-color palettes, depth, one staggered load animation).
9. **Usage discipline:** the user watches token usage closely. Don't fire hub test runs to "check" things unless needed; a free local `curl http://127.0.0.1:5757/api/...` reads state at zero cost. Ask before large verification batches.

## Architecture
```
server.js                boot + router + static + X-Hub-Token guard
lib/util.js              shared helpers (fs, no-shell spawn, body reader)
lib/core.js              overview / library / sessions / swarm / graph endpoints
lib/runs.js              run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js             hub-native task queue (feeds prompts to the run engine)
lib/files.js             upload inbox (vanilla multipart)
index.html               markup shell (token injected at serve time)
assets/app.js            SPA core + Overview/Swarm/Sessions/Library/Config
assets/run.js  tasks.js  files.js  graph.js  style.css
.claude/skills/ui-design/  zero-dep design library (consult for UI work)
data/                    runtime: runs/<id>/, inbox/, tasks.json (gitignored)
docs/roadmap.md          the prioritized plan (single source of truth)
scripts/verify-dashboard.ps1   endpoint smoke test
scripts/install-autostart.ps1  user-run logon task
```
Nav order (keyboard 1-9,0): Run · Tasks · Files · Sessions · Overview · Swarm · Graph · Agents · Skills · Commands · Config.

## Key decisions already made (don't relitigate)
- **task-master → NOT an always-on MCP** (per-run tax). Hub-native queue (`lib/tasks.js`) covers it. CLI-only if ever wanted.
- **UI/UX skill → baked in free** as `.claude/skills/ui-design` (the upstream was an npm+Python CLI).
- **hermes-agent → don't adopt**; harvested its scheduling idea → roadmap N3.
- **Base44 / 21st.dev / Tavily / damon-ade / charlie-labs → not adopted** (see roadmap deferred table for why + triggers).
- **Frontend-aesthetics cookbook → adopted**; rules in CLAUDE.md + auto-injected into run artifact hints.
- **ruflo daemons → killed** (were draining tokens in the background); their state is gitignored. `.mcp.json` claude-flow is `autoStart:false` (lazy, no daemon).

## EXECUTE NEXT — clear list to knock out instantly (detail in docs/roadmap.md)
Autonomous, no user action, in order:
1. **N1 Hub restyle** — kill the system font + purple gradient; apply the ui-design skill to `assets/style.css`.
2. **N2 Mobile polish** — audit all tabs at 375px; touch targets, overflow, composer.
3. **N3 Scheduled runs** — hub-native cron feeding the run engine (`data/schedules.json`); completes the autonomous loop.
4. **N4 Routing-accuracy feedback** — compare routed model vs outcome; tune `routeModel()`.
5. **N5 Dark/light theme toggle** — system detection + header toggle.
6. **N6 xlsx preview in Files** — zero-dep sheet/dimension preview.

Needs a dependency install (weigh token cost, get a quick nod):
7. **Q1 Playwright E2E** (dev-only, no run tax) — recommended first install; regression safety net.
8. **Q2 markdownify-MCP** — only when document workflows are active (MCP tax).

## Pending USER actions (remind them; you can't do these)
- Autostart: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`
- Mobile: install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- Obsidian export (roadmap Q-Obsidian): confirm they want it + give a vault path.

## Current state
All S1–S14 shipped and browser-verified (see roadmap table). Latest commits on
`master`: library restore (`6f3cca6`), task queue + ui-design (`144394a`),
cookbook adoption + daemon kill (`7fd5bcb`/`285cb1f`). Working tree clean.
Overview reads: 90 agents · 35 skills · 166 commands · MCP claude-flow+scrapling.
