# Claude Code Hub (claude-dashboard)

A zero-dependency, local-only Node.js hub for **working with Claude in this
project from the browser** — send prompts to the `claude` CLI and watch the
answer stream in live, queue tasks the hub runs itself, schedule recurring
runs, browse run history, render run-produced charts/reports inline, upload
documents for runs to process, watch the live agent crew on the Graph tab —
plus the monitoring surface: Engram memory, agents, skills, commands, the
local asset library, session transcripts, and the graphify code graph.

No npm install. No build step. Plain Node + static assets. Styled as a
terminal-amber instrument panel (JetBrains Mono + IBM Plex Sans, served from
the local `/vendor/` font library — fully offline).

## Start it

```
cd claude-dashboard
node server.js            # port 5757
node server.js 5758       # or any port (also honors PORT=)
```

Then open http://127.0.0.1:5757. The project ships `.claude/launch.json`
configurations `claude-dashboard` (5757) and `claude-dashboard-alt` (5758)
that Claude Code's preview tooling can start directly.

Smoke test a running server: `scripts\verify-dashboard.ps1 [-Port 5757]`.

## Layout

```
server.js            boot + router + static assets + /vendor/ + hub-token guard
lib/util.js          shared helpers (fs, spawn-without-shell, body reading)
lib/core.js          overview / library / assets / sessions / graph endpoints
lib/runs.js          run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js         task queue (durable prompts the hub runs itself)
lib/schedules.js     scheduled runs: interval/daily/weekly cron → run engine
lib/memory.js        Engram semantic memory (typed records, no vectors) + recall
lib/agentgraph.js    run stream → persona-named agent crew graph
lib/files.js         upload inbox (vanilla multipart parser)
index.html           markup shell (token injected at serve time)
assets/app.js        SPA core + Overview/Sessions/Library/Config tabs
assets/run.js        Run tab (chat, recall toggle, history, artifact rendering)
assets/tasks.js      Tasks tab (queue + scheduled runs)
assets/memory.js     Memory tab (browse/search/add typed memories)
assets/files.js      Files tab
assets/graph.js      Graph tab dispatcher + codebase canvas viz
assets/agentviz.js   Graph tab "Agents" live radial crew view
assets/assetlib.js   Assets tab (font specimens, icon grid)
vendor/              local asset library: 18 font faces, Lucide sprite (1,746
                     icons), modern-normalize — manifest.json = sources+licenses
data/                runtime, gitignored: runs/<id>/…, inbox/, tasks.json,
                     schedules.json, memory.json
```

## Tabs

**WORK**
- **Run** (landing tab) — a real chat with the `claude` CLI. Each send spawns
  `claude -p <prompt> --output-format stream-json --verbose` with the project
  as cwd and streams the transcript back over SSE: assistant bubbles, collapsed
  tool-call blocks (with results), and a result badge (duration / turns /
  tokens / cost). Follow-up prompts resume the same CLI session (`--resume`).
  Model selector defaults to **auto**: each prompt is routed to the cheapest
  capable model (haiku for short/simple, sonnet for standard coding, opus for
  complex/architectural work — resumed conversations keep their model), and the
  decision streams into the chat as `auto → <model> (<reason>)`. An optional
  **◇ memory recall** toggle (default off) injects the top-3 relevant Engram
  memories into the prompt. Permission mode defaults to `bypassPermissions` —
  hub runs are headless, so any stricter mode silently DENIES Bash/MCP tool
  calls (there is no prompt to approve them); the hub is localhost/tailnet-only
  so full permissions is the intended default. Cancel
  kills the process tree; 2 runs execute concurrently, up to 5 more queue.
  Every run is persisted under `data/runs/<id>/` (`prompt.txt`, `output.jsonl`,
  `meta.json`, `artifacts/`) and listed in the history panel — click to replay
  or resume. Runs are told (via an appended hint) to write visual outputs into
  `artifacts/` and to use the local `/vendor/` fonts/icons; the chat renders
  each artifact inline — HTML/SVG in a sandboxed iframe, images inline,
  anything else as a download link.
- **Tasks** — a durable queue of prompts the hub works through as auto-routed
  runs, plus **Scheduled runs**: interval / daily / weekly prompts persisted in
  `data/schedules.json` and fired by a 30 s ticker through the run engine
  (inheriting routing, streaming, history, spend, and memory capture).
- **Files** — drag-drop upload inbox (`data/inbox/`, 50 MB cap, sanitized
  names, overwrite confirmation). Per file: download, delete, and
  **Process with Claude**, which pre-fills the Run prompt with the file path.
- **Sessions** — this project's Claude Code transcript files; peek at raw
  activity or have Claude summarize a session.

**MONITOR**
- **Memory** — Engram-style semantic memory: typed records (episodic /
  semantic / procedural) recalled by keyword + tag + recency + importance.
  Runs are captured automatically; failure patterns distill into standing
  semantic records; add your own notes.
- **Overview** — stat cards (runs/spend/success/failures/artifacts/inbox),
  status pills (Engram count, auth, MCP, library), recent runs, live session
  feed.
- **Graph** — two views. **Agents (default)**: a live radial map of the
  current run's crew — the routed model persona at center (Maestro 🎼 opus,
  Poet ✒️ sonnet, Dart 🎯 haiku), tool crews orbiting (Scout reads, Bloodhound
  searches, Scribe writes, Wrench runs commands, Falcon fetches the web,
  Spellbook invokes skills, Envoy talks to MCP servers), recruited subagents,
  and a Gallery node for artifacts. Active workers pulse and links flow while
  a run executes; the view auto-follows new runs; click a node to inspect it,
  click the center to open the run. Polls a local disk-read endpoint — zero
  tokens. **Codebase**: graphify stats, query/explain box, force-directed map.

**LIBRARY**
- **Agents / Skills / Commands** — definitions under `.claude/`, filterable,
  click for raw markdown.
- **Assets** — the local website-creation library under `vendor/`: font
  specimens rendered in their real faces (click to copy the CSS), a searchable
  click-to-copy grid over 1,746 Lucide icons, and CSS foundations. Everything
  vendored with source + license in `manifest.json`; advertised to every run.
- **Config** — `.mcp.json`, `settings.json`, CLAUDE.md.

Keyboard: `1–9`/`0` switch tabs (nav order), `R` refreshes, `/` focuses filter,
`Ctrl+Enter` sends the Run prompt.

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/`, `/assets/*` | GET | The SPA (hub token injected into `index.html`) |
| `/vendor/*` | GET | Local asset library (fonts/icons/css; traversal-guarded, cacheable) |
| `/api/run` | POST | `{prompt, model?, permissionMode?, resume?, recall?}` → `{id}`; spawns the CLI |
| `/api/run/stream?id=` | GET (SSE) | `line` events (stream-json, with ids for reconnect dedupe) + `done` |
| `/api/run/cancel`, `/api/run/delete` | POST | Cancel a live run / delete a finished run |
| `/api/runs`, `/api/run/transcript?id=`, `/api/run/artifacts?id=`, `/api/run/artifact?id=&file=` | GET | History, replay, artifacts |
| `/api/tasks` (+`/run`, `/run-all`, `/delete`) | GET/POST | Task queue |
| `/api/schedules` (+`/toggle`, `/run-now`, `/delete`) | GET/POST | Scheduled runs |
| `/api/memory` (+`/search`, `/delete`, `/reindex`) | GET/POST | Engram memory |
| `/api/agentgraph?id=` | GET | Persona-named agent crew graph for a run (no id → newest/live) |
| `/api/assets` | GET | Vendor library manifest + icon index |
| `/api/files` (+`/download`, `/delete`) | GET/POST | Upload inbox |
| `/api/overview`, `/api/agents`, `/api/skills`, `/api/commands`, `/api/config`, `/api/sessions`, `/api/session-tail`, `/api/activity`, `/api/detail` | GET | Monitor/library data |
| `/api/graph/stats`, `/api/graph/data`, `/api/graph/query` (POST) | — | Codebase graph |

Unknown paths return 404. Errors return `{error}` JSON.

## Security notes

- **Localhost only** — binds to `127.0.0.1`; never reachable from the network.
- **Hub token (CSRF guard)** — a random per-boot token is printed at start and
  injected into the served page; **every non-GET request must carry it** in
  `X-Hub-Token`. A foreign website can fire requests at 127.0.0.1 but can
  never read the token. Cross-site `Origin` headers are rejected outright.
- **Sandboxed artifacts** — run-produced HTML/SVG is embedded with
  `sandbox="allow-scripts"` **and** served with a `Content-Security-Policy:
  sandbox` header, so artifact pages get an opaque origin even when opened
  directly — they can never read the hub token or call guarded endpoints. The
  only http source the CSP allows is the read-only `/vendor/` asset library.
- **No shell spawns** — all child processes use argv arrays with
  `shell: false`; the claude CLI is spawned via its native `claude.exe`.
  User text is never shell-interpreted.
- **Path-safe ids** — run ids `^[a-z0-9-]+$`, session ids `^[a-f0-9-]+$`,
  artifact and vendor paths normalized and prefix-checked, inbox filenames
  sanitized to a safe character set. No request can escape intended folders.
- **Bounded input** — prompts ≤ 20 k, uploads ≤ 50 MB, JSON bodies capped;
  subprocesses run with timeouts (runs are user-cancellable instead).

## CLI prerequisites

- **Node.js** — the only hard requirement; the server has zero dependencies.
- **claude CLI** (Run tab) — expects
  `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
  (override with `HUB_CLAUDE_EXE`), logged in via subscription or
  `ANTHROPIC_API_KEY`.
- **graphify** (Graph tab, Codebase view) — binary at
  `C:\Users\logto\.local\bin\graphify.exe` and a graph at
  `claude-dashboard/graphify-out/graph.json`
  (`graphify extract <project> --code-only`). Without it the view shows a hint.
