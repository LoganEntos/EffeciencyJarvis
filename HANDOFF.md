# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` for the plan and `docs/open-issues.md`
for the architecture decision log (all six ISSUES resolved 2026-07-10: 1–4/6 by
retiring ruflo, ISSUE-5 by ADOPTING hermes as the second stack). Everything you
need to continue is here. Work happens in **this repo**
(`C:\Users\logto\Documents\claude-hub`) — NOT in `bigplans.SemanticModel`
(that's the separate Power BI project; leave it alone).

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
Graph tab: "Agents" live crew view by default (persona names: Maestro/Poet/Dart
models, Scout/Scribe/Wrench/etc tool crews). Codebase map behind a chip, with
its own Modules (file-level, default) / All-symbols sub-views.
`assets/voice.js` = N9 voice module (header mic orb; loaded last in index.html).

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
- **hermes → ADOPTED, INSTALLED, OPERATIONAL as the second agentic stack**
  (user, 2026-07-10 eve; supersedes "parked" — this is the resolution of
  ISSUE-5). The 91 claude-flow agents were deleted — they all ran on the
  session default model (Fable 5); hermes brings per-task model tiering.
  v0.18.2 installed via git+uv; **venv rebuilt on winget CPython 3.11.9**
  (`%LOCALAPPDATA%\Programs\Python\Python311`) after the uv-python-store
  trampoline broke in the user's console. Config at
  `%LOCALAPPDATA%\hermes\config.yaml` (Windows HERMES_HOME — NOT ~/.hermes,
  which only holds the clone+venv), mirror in `scripts/hermes-config.yaml`.
  Authenticated (`hermes auth add nous`, OAuth in auth.json); verified
  end-to-end. Tiering live: main=sonnet, aux=auto-cheap, subagents=
  gemini-3-flash via nous. H1 shipped; H2–H4 are the next builds. See
  `docs/hermes-adoption.md`.
- **Agent roster = curated ~20, NEVER a bulk library** (user, 2026-07-10 late
  eve). 8 live hermes roles (read from config) + 14 hand-picked local
  specialists in `.claude/agents/`, EVERY one with explicit `model:`
  frontmatter (haiku for mechanical, sonnet for build/review, opus only for
  security-auditor/architect). Tier chips on the Agents tab. Do not restore
  the deleted claude-flow catalog.
- **Voice = hermes's job + a hub loop** (user, 2026-07-10 late eve). N9 Track A
  SHIPPED (`assets/voice.js`, browser-native, zero-dep). Track B (hermes
  gateway voice notes) pairs with H4. Full plan: `docs/voice-plan.md`.
- **Assets library is a first-class Library tab** (user, 2026-07-10): vendor/
  fonts+icons+css, locally saved, advertised to every run; prefer /vendor/ over
  CDNs in all generated UI.
- **task-master → NOT an always-on MCP** (per-run tax). Hub-native queue (`lib/tasks.js`) covers it. CLI-only if ever wanted.
- **UI/UX skill → both layers now local**: `.claude/skills/ui-design` (fast anti-slop rules, written here) + 6 skills adopted 2026-07-10 from nextlevelbuilder/ui-ux-pro-max-skill (MIT) — `ui-ux-pro-max` CSV design database (Grep it; no Python on this machine), design, design-system, brand, banner-design, slides. Skipped upstream `ui-styling` (React/Tailwind stack + duplicate fonts).
- **Base44 / 21st.dev / Tavily / damon-ade / charlie-labs → not adopted** (see roadmap deferred table for why + triggers). Base44 may be revisited for N8 iPhone (Tailscale changes the "can't reach localhost" math).
- **Frontend-aesthetics cookbook → adopted**; rules in CLAUDE.md + auto-injected into run artifact hints.
- **ruflo daemons → killed**, then the whole stack **retired** (see above); the claude-flow entry is fully removed from `.mcp.json` (scrapling is the only MCP left). Leftover ruflo state on disk (`.swarm/`, `.claude-flow/`) is gitignored and inert.

## EXECUTE NEXT — the path to "where it needs to be" (detail in docs/roadmap.md)
✅ DONE 2026-07-11 (S25/S26): CSM-1B voice engine (installed+verified), H2
hermes engine in the Run composer (live-verified, $0.06 test run), H3 hermes
in the agent graph, N5 theme toggle, N4 routing-accuracy chip (/api/routing),
N6 xlsx preview (/api/files/xlsx), ECC skills (Q4: 278 library / 18 active).
Remaining, in order (autonomous unless marked 🙋):
1. **H4 Hermes gateway toggle + N9 Track B** — `hermes gateway` on/off in the
   hub = the mobile voice/text bridge. 🙋 needs a Telegram bot token.
2. **N2 Mobile polish** — ✅ audited 2026-07-11: all 12 tabs clean at 375px
   (zero horizontal overflow); coarse-pointer CSS added for touch-sized
   buttons. Remaining: a REAL-phone pass over Tailscale once the user sets it
   up (orb/mic behavior can't be judged in an emulated viewport).
3. **H2.5 hermes resume** (new, optional) — usage.json exposes session_id;
   `--resume` could give hermes chats continuity like claude runs.
4. **Q1 Playwright E2E** (dev-only, no run tax) — regression net; recommended
   install. 🙋 quick nod to install.

Queued (do NOT build until the user greenlights): **N7 SharePoint Breakdown**
(file-level directory index, first sweep by Fable 5), **N8 iPhone incorporation**
(Tailscale PWA vs Base44-over-Tailscale vs native wrapper).

## Pending USER actions (remind them; you can't do these)
- Autostart: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`
- Mobile: install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- Obsidian export (roadmap Q-Obsidian): confirm they want it + give a vault path.

## Current state (2026-07-10, end of late-eve session)
All S1–S24 shipped and browser-verified (see roadmap table). **Working tree
clean; smoke script green (34 checks).** Latest commits: agent purge + graph
fixes (`2cb18f8`), hermes docs (`c288a63`), voice research (`17dcf6e`), hermes
switch + H1 (`8808536`), hermes operational (`f93d855`), Agents roster
(`7c0a3ab`), agent bench + graph visual (`9e4671e`), voice plan (`36463d1`),
N9 voice Track A (`2060af2`).

Snapshot of what's true right now:
- **Hermes v0.18.2 FULLY OPERATIONAL** — installed, configured (main=sonnet,
  aux=auto-cheap, subagents=gemini-3-flash via nous), authenticated (Nous
  OAuth), verified end-to-end. `/api/hermes` shows **ready**.
- **Agents tab = 22 roster**: 8 live hermes roles + 14 curated local
  specialists, all with explicit model tiers + chips. (Overview also reads
  41 skills · 166 commands · MCP scrapling only · Engram memories.)
- **Graph tab**: live Agents crew view default; Codebase map has Modules
  (file-level, warm palette, weighted links) + All-symbols sub-views.
- **Voice N9 Track A SHIPPED**: `assets/voice.js` — header mic orb, Web Speech
  API → auto-routed run, speechSynthesis talk-back, Config settings (both
  toggles default OFF). Live mic capture works only in the user's real
  Chrome/Edge (my Browser pane sandbox blocks mic; that's not a bug).
- **Sesame CSM-1B local neural voice INSTALLED & VERIFIED (S25, 2026-07-11)**:
  second TTS engine, native Windows + RTX 3060 CUDA. Runtime in gitignored
  `.csm/` (venv: torch 2.6.0+cu124, transformers **pinned <5** — 5.x babbles;
  weights from ungated `unsloth/csm-1b` mirror since `sesame/csm-1b` is
  HF-gated). Sidecar `scripts/csm-server.py` :8790 ← `lib/voice.js` proxy
  (`/api/voice/tts|status|start`) ← engine picker + Start button in Config →
  Voice. Whisper-verified round trip. Docs: `docs/voice-csm.md`. Run-tab model
  dropdown also now offers every Claude version (pin Fable 5 / Opus 4.8/4.7 /
  Sonnet 5/4.6 / Haiku 4.5).
- **Heads-up: the user drives parallel work through the hub's own Run tab**
  (Fable 5 runs in acceptEdits editing this very repo). Before editing, check
  `git status` + `/api/runs` for an active run touching the same files —
  reconcile, don't clobber (this session merged one such run's CSM work).

**Next up (see EXECUTE NEXT above):** H2 hermes engine in the Run composer →
H3 hermes in the agent graph → H4 gateway toggle + N9 Track B, then N2 mobile,
N5 theme, N4 routing, N6 xlsx, Q1 Playwright. Queued (don't build until asked):
N7 SharePoint Breakdown, N8 iPhone.
