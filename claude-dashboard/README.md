# Claude Code Hub (claude-dashboard)

A zero-dependency, local-only Node.js hub for **working with Claude in this project from the browser** — send prompts to the `claude` CLI and stream the answer live, queue tasks the hub runs itself, schedule recurring runs, browse run history, render charts/reports inline, upload documents for processing, and monitor activity via run history, semantic memory, agent crews, and project health. All offline, all on `127.0.0.1`, no build step.

## Start it

```
cd claude-dashboard
node server.js            # port 5757
node server.js 5758       # or any port (also honors PORT=)
```

Then open http://127.0.0.1:5757. The project ships `.claude/launch.json` configurations `claude-dashboard` (5757) and `claude-dashboard-alt` (5758) that Claude Code's preview tooling can start directly.

Smoke test a running server: `scripts\verify-dashboard.ps1 [-Port 5757]`.

## Layout

```
server.js            Boot + router + static assets + /vendor/ library + per-boot CSRF token guard
lib/                 32 backend modules: core (monitor/library), runs (CLI + SSE streaming),
                     files (inbox), tasks/schedules (durable queues), memory (Engram),
                     agentgraph (crew viz), projects (workspace), pairing (file-order matching),
                     health (transparency), voice (TTS routing), plus admin, teams, personas, 
                     distill, sessionsum, autopilot, usage, settings, and integrations
assets/              41+ SPA modules: app core, tabs (run/live/tasks/files/projects/
                     sharepoint/sessions/memory/overview/graph/health/jarvis/config),
                     renderers (runrender, runhistory, sheetgrid), voice pipeline,
                     and design components (voicecore, voicetts, voiceconvo, assetlib)
vendor/              Local asset library: 12 font families (OFL/MIT licensed),
                     4 icon sprite sheets (Lucide 1746 + Tabler 5093 + Bootstrap 2078 +
                     Pixelart 877 ≈ 9,794 icons), CSS reset/pattern library;
                     manifest.json records sources + licenses; offline-first
index.html           Markup shell: nav/header/main (token injected at serve time for CSRF guard)
data/                Runtime (gitignored): runs/<id>/prompt.txt|output.jsonl|meta.json|artifacts/,
                     inbox/<project>/files, projects.json, tasks.json, schedules.json, memory.json
```

## Tabs & Responsibilities

**WORK**
- **Jarvis** — voice-first assistant with personas (Maestro/Poet/Dart), multi-turn memory, and auto-routing. Wake-word "Jarvis" triggers real-time conversation with sidecars (browser TTS, Kokoro, CSM) and optional wake-word detection. Full chat history with memory recall + artifact rendering.

- **Run** — interactive chat with the `claude` CLI. Each send spawns `claude -p <prompt> --output-format stream-json --verbose` with the project cwd and streams the transcript back over SSE: assistant bubbles, collapsed tool blocks with results, and a badge (duration, turns, tokens in/out, completion%). Model defaults to **auto** — each prompt routes to the cheapest capable model (haiku for short/simple, sonnet for standard coding, opus for complex/architectural); routing reason streams into the chat. Optional **◇ memory recall** toggle (default off) injects top-3 relevant Engram records into the prompt. Permission mode defaults to `bypassPermissions` (headless runs need it). 2 concurrent + up to 5 queued. Cancel kills the tree. Every run persists under `data/runs/<id>/` and plays back from history — click to replay or resume. Runs hint Claude to write artifacts into `artifacts/` and use `/vendor/` fonts/icons; HTML/SVG renders inline in sandboxed iframes, images inline, others as links.

- **Live** — SSE stream view: real-time events from the active run (assistant/user turns, tool calls, artifacts) without the chat UI.

- **Tasks** — durable queue of prompts the hub runs itself through the run engine (inheriting auto-routing, streaming, history, and memory capture). Schedule tabs: interval/daily/weekly cron jobs persisted in `data/schedules.json`, fired by a 30 s ticker.

- **Files** — drag-drop inbox upload (`data/inbox/`, 50 MB cap, sanitized names, overwrite confirmation). Per file: download, delete, move into project, **Process with Claude** (pre-fills Run prompt with path). Inline previews: PDFs via browser native viewer, images (<img>), XLSX as metadata + cell-grid (200 rows × 40 cols with fill colors), text/markdown/csv via in-app viewer (capped at 800 KB).

- **Projects** — named workspaces with standing instructions + attached files + project-scoped memory. Each project has a slug (inbox subfolder, e.g., `data/inbox/order-001/`). File pairing model: files group by project; four states: **complete** (both PDF invoice + CSV verified), **PDF-only**, **CSV-only**, **needs-review**. Signed PI invoice is authoritative over plain commercial. Project manifest.csv (when present) is the confirmed ledger. Upload/view/download/delete all reuse inbox mechanisms; project manifest + running history visible in detail panel.

- **SharePoint** — pull/index/search Microsoft 365 site drives. Config pane connects via OAuth, surfaces document hierarchies, indexes into searchable tree, pulls files into inbox projects, and graphifies SharePoint structure for team context.

- **Sessions** — Claude Code CLI transcripts (from `~/.claude/projects/`). Browse raw activity, have Claude summarize, archive into hub memory.

**MONITOR**
- **Memory** — Engram-style semantic memory (episodic/semantic/procedural records) recalled by keyword, tag, recency, importance. Runs auto-capture; failure patterns distill into standing records; add manual notes.

- **Overview** — stat cards (runs/tokens/success/failures/artifacts/inbox), status pills (Engram, auth, MCP, library health), recent runs, live session feed.

- **Graph** — two views. **Agents**: live radial map of the current run's crew — the routed model persona at center (Maestro 🎼 opus, Poet ✒️ sonnet, Dart 🎯 haiku), tool crews orbiting (Scout, Bloodhound, Scribe, Wrench, Falcon, Spellbook, Envoy), recruited subagents, and Gallery (artifacts). Active workers pulse; links flow live; click nodes to inspect or center to open run. Polls disk-read endpoint (zero tokens). **Codebase**: graphify stats/query/explain on force-directed map.

- **Health** — transparency dashboard: unassigned inbox files, project docs (stale-vs-fresh heuristic), lib/asset module counts (warns at 450 lines, caps at 500), active vs dormant skills, backlog status. Filesystem-heavy, cached; `?refresh=1` forces rescan.

**LIBRARY**
- **Agents / Skills / Commands** — definitions under `.claude/`, filterable, click to see raw markdown.
- **Assets** — `/vendor/` library: font specimens in their real typefaces (click copy CSS), searchable icon grid (click copy code), CSS foundations, all with manifest sources + licenses.
- **Sources** — external references (e.g., VPP extraction spec, order templates) indexed by tag.
- **Tools** — MCP server inventory from `.mcp.json`.
- **Config** — `.mcp.json`, `.claude/settings.json`, CLAUDE.md (read-only browsing + inline editing for settings).

Keyboard: `1–9`/`0` switch tabs (nav order), `R` refreshes, `/` focuses filter, `Ctrl+Enter` sends Run prompt.

## Architecture / Module Map

**lib/ core (32 modules)**
- **core.js** — overview, library (agents/skills/commands/assets), config, sessions, graph endpoints
- **runs.js** — run spawning, SSE streaming, CLI output parsing, auto-routing, history; delegates engine to runs-engine.js
- **runs-engine.js** — fork/exec logic, process tree, timeouts, signal handling
- **runs-route.js** — model selection (haiku/sonnet/opus) via token-count + complexity
- **files.js** — inbox upload (multipart parser), download, delete, move, text/xlsx/image/pdf preview
- **tasks.js** — durable task queue (runs that the hub initiates), persisted in data/tasks.json
- **schedules.js** — interval/daily/weekly cron, 30 s ticker, persisted in data/schedules.json
- **memory.js** — Engram semantic memory (no vectors), typed records (episodic/semantic/procedural), recall by keyword/tag/importance/recency
- **agentgraph.js** — parses run stream → persona-named agent crew graph (nodes/links for Graph tab Agents view)
- **projects.js** — workspace creation, file attachment by slug, project-scoped memory recall, Claude Code session import
- **pairing.js** — file-order matching logic (PDF invoice + CSV reconciliation for VPP workflows)
- **health.js** — inbox/docs/structure/skills/backlog scans, cache + `?refresh=1` force-rescan
- **voice.js** — TTS engine router (browser default, Kokoro sidecar, CSM sidecar), wake-word init, status
- **autopilot.js** — self-improvement loop (optional, disabled by default), rate-limiting, run-launched distill
- **distill.js** — Jarvis distillation: summarize runs into semantic memory as standing records
- **sessionsum.js** — auto-session debriefs (cheap Haiku, idle sessions only), lazy sweep
- **usage.js** — token budgets, spend aggregation (internal only; never displayed)
- **settings.js**, **admin.js** — admin config file browsing, .mcp.json editing, git status/commit
- **teams.js** — multi-user team support (stub for enterprise integration)
- **personas.js** — Jarvis persona definitions, active persona selection
- **sharepoint.js** — Microsoft Graph OAuth, drive indexing, file pull/push, search
- **clientlog.js** — browser error capture + server logging
- **artifacts.js, acp.js, diagnose.js, hermes.js, liveness.js, runs-query.js, xlsxcells.js** — specialized utilities

**assets/ SPA (41+ modules)**
- **app.js** — SPA core: tab dispatch, keyboard shortcuts, theme toggle, token injection
- **run.js** — Run tab: chat composer, SSE wiring, transcript replay, artifact iframe sandbox
- **runrender.js** — stream-json line parsing, bubble rendering, tool-call collapsible blocks, artifact inlining
- **runhistory.js** — run list, sort/filter, quick replay, delete UI
- **live.js** — SSE raw event stream (for watching real-time activity)
- **tasks.js** — task queue UI, durable-prompt form, run-all button
- **schedules.js** — schedule form (interval/daily/weekly cron), toggle enable/disable, run-now
- **memory.js** — memory browse/search/add/delete UI, type selector, keyword/tag editor
- **files.js** — upload drop zone, file list, preview toggle (inline vs metadata), download/delete/move UI
- **projects.js**, **projectdetail.js**, **projectchat.js**, **projectsxfer.js** — project CRUD, manifest viewer, run history, file pairing panel
- **sharepoint.js** — config/auth pane, site picker, drive tree browser, pull/push buttons
- **overview.js** — stat cards, status pills, recent runs, live feed
- **graph.js** — dispatch to agentviz (default) or codebase graph
- **agentviz.js** — radial crew map, node inspect, canvas zoom/pan
- **health.js** — transparency dashboard: inbox/docs/structure/skills/backlog tables, refresh button
- **jarvis.js** — Jarvis tab main, persona selector, memory on/off
- **jarvistab.js**, **jarvisorb.js**, **jarvissoul.js**, **jarvispersona.js**, **jarvispersonacards.js**, **jarvistimeline.js**, **jarvisattach.js**, **jarvischat.js** — Jarvis voice conversational UI and state machine
- **voicecore.js**, **voicetts.js**, **voiceconvo.js**, **voicecfg.js** — voice pipeline: SpeechRecognition, TTS engine router, wake-word, barge-in, conversation state
- **config.js** — settings.json browsing/editing, .mcp.json, CLAUDE.md viewer
- **assetlib.js** — font specimens, icon grid (Lucide, Tabler, Bootstrap, Pixelart), CSS foundations
- **sources.js** — external reference library browsing
- **overview.js**, **agentviz.js**, **lists.js**, **rungauge.js**, **sheetgrid.js**, **admin.js** — shared components (status pills, icon picker, progress gauge, spreadsheet grid)

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/`, `/index.html` | GET | SPA shell (hub token injected for CSRF guard) |
| `/assets/*` | GET | Client JavaScript + CSS (no cache; traversal-guarded) |
| `/vendor/*` | GET | Font + icon + CSS library (cached, traversal-guarded, CSP sandbox) |
| `/manifest.webmanifest` | GET | PWA manifest (install as standalone app on phone) |
| `/api/restart` | POST | Supervised restart (old process stays live until new one binds) |
| **Runs** | | |
| `/api/run` | POST | `{prompt, model?, permissionMode?, resume?, recall?, projectSlug?}` → `{id}` |
| `/api/run/stream?id=` | GET (SSE) | Stream-json lines + reconnect dedup; `done` when finished |
| `/api/run/cancel`, `/api/run/delete` | POST | Kill live run or delete finished run + artifacts |
| `/api/runs` | GET | History list (newest-first) |
| `/api/run/transcript?id=`, `/api/run/artifacts?id=`, `/api/run/artifact?id=&file=` | GET | Replay transcript, list artifacts, fetch artifact |
| `/api/stats/today` | GET | Token usage today (in/out, completion %) |
| `/api/routing` | GET | Model-routing stats (how many prompts → each model) |
| **Files** | | |
| `/api/files` | GET/POST | List inbox or upload (multipart) |
| `/api/files/download`, `/api/files/delete` | GET/POST | Download file or delete from inbox |
| `/api/files/move` | POST | Relocate root-level file into project folder |
| `/api/files/view?name=` | GET | Stream PDF/image with proper CSP headers |
| `/api/files/text?name=` | GET | Read text-like file (markdown/csv/txt/json/code) up to 800 KB |
| `/api/files/xlsx?name=` | GET | XLSX metadata (sheets + dimensions) |
| `/api/files/xlsx/cells?name=&sheet=N` | GET | XLSX cell grid (200 rows × 40 cols with fill colors) |
| **Tasks & Schedules** | | |
| `/api/tasks` | GET/POST | List queue or enqueue prompt |
| `/api/tasks/done`, `/api/tasks/delete` | POST | Mark done or delete from queue |
| `/api/tasks/run`, `/api/tasks/run-all` | POST | Run one or drain entire queue |
| `/api/schedules` | GET/POST | List schedules or create new one |
| `/api/schedules/toggle`, `/api/schedules/run-now`, `/api/schedules/delete` | POST | Toggle enable/disable, run immediately, or delete |
| **Memory** | | |
| `/api/memory` | GET/POST | List records or add typed record (episodic/semantic/procedural) |
| `/api/memory/search?q=` | GET | Keyword + tag search |
| `/api/memory/delete` | POST | Remove record |
| `/api/memory/reindex` | POST | Rebuild index (normally automatic) |
| **Projects** | | |
| `/api/projects` | GET/POST | List projects or create new workspace |
| `/api/projects/import` | POST | Adopt inbox folders as projects |
| `/api/projects/claude`, `/api/projects/import-claude` | GET/POST | List Claude Code sessions or import as projects |
| `/api/projects/get?id=` | GET | Fetch project detail + file list + run history |
| `/api/projects/update`, `/api/projects/delete` | POST | Edit project or delete |
| `/api/projects/note` | POST | Add/edit project note |
| `/api/projects/session` | GET | Sessions for a project (Claude Code imports) |
| **Graph & Monitoring** | | |
| `/api/agentgraph?id=` | GET | Persona-named crew graph for run (no id → newest/live) |
| `/api/graph/stats` | GET | Graphify stats from disk |
| `/api/graph/data` | GET | Force-directed codebase graph (nodes/links) |
| `/api/graph/query` | POST | Query graphify database |
| `/api/overview` | GET | Dashboard stat aggregates + system info |
| `/api/activity` | GET | Live session feed (client logs) |
| `/api/detail` | GET | Drill-down details (client-requested) |
| **Library & Config** | | |
| `/api/agents`, `/api/skills`, `/api/commands`, `/api/config`, `/api/sessions`, `/api/assets` | GET | Definition lists + manifest |
| `/api/session-tail?dir=` | GET | Last 100 lines of a session transcript |
| `/api/sources` | GET | External reference index |
| **Health** | | |
| `/api/health` | GET | Transparency: inbox/docs/structure/skills/backlog (cached) |
| `/api/health/doc?path=` | GET | Fetch a project doc for health inspector |
| **Voice** | | |
| `/api/voice/status` | GET | TTS engine status (browser/Kokoro/CSM) |
| `/api/voice/start`, `/api/voice/stop` | POST | Start/stop Kokoro or CSM sidecar |
| `/api/voice/open-folder` | POST | Reveal sidecar data folder in file explorer |
| `/api/voice/tts` | POST | `{text, engine, voice}` → mp3 (buffered) |
| **Admin** | | |
| `/api/admin/mcp` | GET/POST | Read/write .mcp.json (MCP servers) |
| `/api/admin/mcp/remove` | POST | Deactivate a server |
| `/api/admin/file`, `/api/admin/files` | GET/POST | Browse/edit editable project config files |
| `/api/admin/git` | GET/POST | `git status` and `git commit` (hub-managed) |
| **SharePoint** | | |
| `/api/sharepoint/status`, `/api/sharepoint/config` | GET/POST | Auth status + token config |
| `/api/sharepoint/auth/start`, `/api/sharepoint/logout` | POST | OAuth handshake + logout |
| `/api/sharepoint/sites`, `/api/sharepoint/drives`, `/api/sharepoint/children` | GET | Drive hierarchy traversal |
| `/api/sharepoint/index`, `/api/sharepoint/index/status`, `/api/sharepoint/index/search`, `/api/sharepoint/index/tree`, `/api/sharepoint/index/browse` | POST/GET | Index drives, search, render tree |
| `/api/sharepoint/weburl`, `/api/sharepoint/pull`, `/api/sharepoint/push`, `/api/sharepoint/graphify` | GET/POST | Web links, file pull/push, graphify export |
| **Personas** | | |
| `/api/personas` | GET | List available personas |
| `/api/personas/active` | POST | Set active persona for Jarvis |
| `/api/personas/guidelines`, `/api/personas/save`, `/api/personas/get` | POST/GET | Edit persona definitions |
| **Autopilot** | | |
| `/api/autopilot` | GET | Self-improvement loop status (enabled/disabled) |
| `/api/autopilot/toggle`, `/api/autopilot/run-now` | POST | Toggle or trigger immediate run |
| **Teams & Admin** | | |
| `/api/teams` | GET | List team members |
| `/api/teams/select`, `/api/teams/save`, `/api/teams/delete` | POST | Switch team context or manage members |
| `/api/usage` | GET | Token budget aggregates (internal; not displayed) |
| `/api/admin/git` | GET/POST | Repo status + auto-commit interface |

Unknown paths return 404. Errors return `{error, details?}` JSON.

## Design Language

**Default theme: "clean-dark" amber-agent-orb aesthetic** (no $ ever displayed)
- **Color palette**: warm near-black `#0c0b0a` (bg), `#17140f` (panels), amber accent `#e8a33d`, subtle grid overlay
- **Typography**: Bricolage Grotesque (display, warm/human feel), JetBrains Mono (technical data, 200/500/800 weights), Instrument Serif (hero numbers, elegant)
- **Backgrounds**: layered radial gradients (depth) + faint dot-grid pattern (per amber-agent-orb reference)
- **Components**: tight technical radii (4 px cards, 3 px controls), flat panels with inset top highlight, monospace control labels
- **Motion**: one orchestrated page-load reveal with staggered delays; no scattered micro-interactions
- **Offline first**: every asset vendored locally under `/vendor/` with source + license in manifest.json

Token metrics only: **tokens in/out** and **completion %** displayed in run badges and overview. No cost/spend language anywhere (meta.costUsd recorded internally but never surfaced to UI). Focus: transparency into model selection, routing, and resource usage.

## Voice

Three TTS engines: browser default Web Speech API, **Kokoro sidecar** (expressive speech synthesis), and **CSM sidecar** (commercial streaming). Each auto-configured in Config tab with download links. Wake-word **"Jarvis"** triggers conversation. Multi-turn memory + auto-recall. Sidecars gitignored; started on demand from Config. 

Audio pipeline: SpeechRecognition → Jarvis persona → run/memory → TTS selection → play + barge-in (new audio interrupts). ChunkPipeline handles real-time buffering.

## Security Notes

- **Localhost only** — binds to `127.0.0.1`; never reachable from the network.
- **Per-boot CSRF token** — random token printed at startup, injected into the page, and **required on every non-GET request** (X-Hub-Token header). A foreign website can fire requests at 127.0.0.1 but can never read the token.
- **Sandboxed artifacts** — run-produced HTML/SVG embedded with `sandbox="allow-scripts"` AND served with CSP `sandbox` header, so even direct navigation gets an opaque origin. Only `/vendor/` read-only assets whitelisted.
- **No shell spawns** — all child processes use argv arrays with `shell: false`; the `claude` CLI spawned via native exe. User text never shell-interpreted.
- **Path-safe IDs** — run ids `^[a-z0-9-]+$`, session ids `^[a-f0-9-]+$`, artifact/vendor paths normalized + prefix-checked, inbox filenames sanitized to safe charset. No request escapes intended folders.
- **Bounded input** — prompts ≤ 20 KB, uploads ≤ 50 MB, JSON bodies capped; subprocesses run with timeouts (runs user-cancellable instead).
- **Tailscale phone access** — via `tailscale serve` reverse proxy still routes to 127.0.0.1 bind; only tailnet reaches it; per-boot token guards every mutation.

## Prerequisites

- **Node.js** — the only hard requirement; the server has zero npm dependencies.
- **claude CLI** (Run tab) — expects `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` (override with `HUB_CLAUDE_EXE` env var), logged in via subscription or `ANTHROPIC_API_KEY`.
- **graphify** (Graph tab, Codebase view) — optional binary located via `HUB_GRAPHIFY_EXE` env var or default `~/.local/bin/graphify.exe`. Without it the Graph tab shows a hint to run `graphify extract <project> --code-only` first.
