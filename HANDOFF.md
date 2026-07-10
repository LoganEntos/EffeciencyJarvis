# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` for the plan and `docs/open-issues.md`
for the deliberate architecture decisions (ruflo↔engine overlap, dual memory,
parked hermes). Everything you need to continue is here. Work happens in **this repo** (`C:\Users\logto\Documents\claude-hub`) —
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
server.js                boot + router + static + /vendor/ + X-Hub-Token guard
lib/util.js              shared helpers (fs, no-shell spawn, body reader)
lib/core.js              overview / library / assets / sessions / graph endpoints
lib/runs.js              run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js             hub-native task queue (feeds prompts to the run engine)
lib/schedules.js         scheduled runs: hub-native cron → run engine (data/schedules.json)
lib/agentgraph.js        run stream → persona-named agent crew graph (Graph tab live view)
lib/files.js             upload inbox (vanilla multipart)
index.html               markup shell (token injected at serve time)
assets/app.js            SPA core + Overview/Sessions/Library/Config
assets/run.js  tasks.js  files.js  graph.js  agentviz.js  assetlib.js  memory.js  style.css
vendor/                  LOCAL asset library: 18 font faces, Lucide sprite, normalize (manifest.json = sources+licenses)
.claude/skills/ui-design/  zero-dep design library (consult for UI work)
data/                    runtime: runs/<id>/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
docs/roadmap.md          the prioritized plan (single source of truth)
scripts/verify-dashboard.ps1   endpoint smoke test
scripts/install-autostart.ps1  user-run logon task
```
Nav order: Run · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Config.
Graph tab = "Agents" live crew view by default (persona names: Maestro/Poet/Dart
models, Scout/Scribe/Wrench/etc tool crews); codebase map behind a chip.

`lib/memory.js` = Engram-style semantic memory (SEMANTIC OVER VECTORS): typed
records, lexical+tag+recency+importance recall, NO embeddings/vector-DB. Captures
runs automatically; `assets/memory.js` = Memory tab. N3.5 SHIPPED: opt-in
"◇ memory recall" toggle in the Run composer (default OFF) injects top-3
memories into the prompt; rule-based failure-pattern distillation included.

## Key decisions already made (don't relitigate)
- **ruflo → RETIRED** (user, 2026-07-10): one agent stack only — the Claude Code
  native one (run engine + in-run Agent-tool subagents). Swarm tab, /api/swarm/*,
  and the claude-flow MCP entry are gone. Multi-agent work is visualized in the
  Graph tab's Agents view instead.
- **hermes → still liked, still PARKED** (ISSUE-5): when revisited, it's a thin
  messaging bridge with an on/off toggle, never the full Python stack.
- **Assets library is a first-class Library tab** (user, 2026-07-10): vendor/
  fonts+icons+css, locally saved, advertised to every run; prefer /vendor/ over
  CDNs in all generated UI.
- **task-master → NOT an always-on MCP** (per-run tax). Hub-native queue (`lib/tasks.js`) covers it. CLI-only if ever wanted.
- **UI/UX skill → baked in free** as `.claude/skills/ui-design` (the upstream was an npm+Python CLI).
- **hermes-agent → don't adopt**; harvested its scheduling idea → roadmap N3.
- **Base44 / 21st.dev / Tavily / damon-ade / charlie-labs → not adopted** (see roadmap deferred table for why + triggers).
- **Frontend-aesthetics cookbook → adopted**; rules in CLAUDE.md + auto-injected into run artifact hints.
- **ruflo daemons → killed** (were draining tokens in the background); their state is gitignored. `.mcp.json` claude-flow is `autoStart:false` (lazy, no daemon).

## EXECUTE NEXT — clear list to knock out instantly (detail in docs/roadmap.md)
Autonomous, no user action, in order (N1/N3/N3.5 shipped 2026-07-10 → S16–S18):
1. **N2 Mobile polish** — audit all tabs at 375px; touch targets, overflow, composer.
2. **N4 Routing-accuracy feedback** — compare routed model vs outcome; tune `routeModel()`.
3. **N5 Dark/light theme toggle** — header toggle + persistence (light CSS vars already shipped in S16).
4. **N6 xlsx preview in Files** — zero-dep sheet/dimension preview.

Needs a dependency install (weigh token cost, get a quick nod):
7. **Q1 Playwright E2E** (dev-only, no run tax) — recommended first install; regression safety net.
8. **Q2 markdownify-MCP** — only when document workflows are active (MCP tax).

## Pending USER actions (remind them; you can't do these)
- Autostart: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`
- Mobile: install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- Obsidian export (roadmap Q-Obsidian): confirm they want it + give a vault path.

## Current state
All S1–S20 shipped and browser-verified (see roadmap table). 2026-07-10 evening:
N1 restyle (`eae41ba`), N3 schedules (`363246f`), N3.5 recall (`d60da34`),
Assets library (`8feb670`), ruflo retired + live agent graph (`3bc872f`).
Working tree clean, smoke script green (32 checks). Overview reads: 90 agents ·
35 skills · 166 commands · MCP scrapling only · engram memories counted.
ISSUE-1 is RESOLVED (ruflo retired, user decision); ISSUE-5 hermes bridge is
the only parked item. Next up: N2 mobile polish, N4 routing feedback, N5 theme
toggle, N6 xlsx preview.
