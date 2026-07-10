# Claude Code Hub (claude-dashboard)

A zero-dependency, local-only Node.js hub for **working with Claude in this
project from the browser** — send prompts to the `claude` CLI and watch the
answer stream in live, browse run history, render run-produced charts/reports
inline, upload documents for runs to process — plus the original monitoring
surface: agents, skills, commands, hooks, MCP servers, session transcripts,
Ruflo swarm status, and the graphify code graph.

No npm install. No build step. Plain Node + static assets.

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
server.js          boot + router + static assets + hub-token guard
lib/util.js        shared helpers (fs, spawn-without-shell, body reading)
lib/core.js        monitor/library endpoints (overview, sessions, swarm, graph…)
lib/runs.js        run engine: spawn claude CLI, SSE streaming, history, artifacts
lib/files.js       upload inbox (vanilla multipart parser)
index.html         markup shell (token injected at serve time)
assets/app.js      SPA core + Overview/Swarm/Sessions/Library/Config tabs
assets/run.js      Run tab (chat, history, artifact rendering)
assets/files.js    Files tab
assets/graph.js    Graph tab + canvas force-directed viz
data/              runtime, gitignored: runs/<id>/…, inbox/
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
  decision streams into the chat as `auto → <model> (<reason>)`. Verified
  saving: trivial prompts $0.037 on haiku vs $0.158 on the default model.
  Permission mode defaults to `acceptEdits` so runs can write files; Cancel
  kills the process tree; 2 runs execute concurrently, up to 5 more queue. Every run is
  persisted under `data/runs/<id>/` (`prompt.txt`, `output.jsonl`, `meta.json`,
  `artifacts/`) and listed in the history panel — click to replay, and the
  conversation can be resumed from there. Runs are told (via an appended hint)
  to write visual outputs into their `artifacts/` folder; the chat renders
  each artifact inline — HTML/SVG in a sandboxed iframe, images inline,
  anything else as a download link.
- **Files** — drag-drop upload inbox (`data/inbox/`, 50 MB cap, sanitized
  names, overwrite confirmation). Per file: download, delete, and
  **Process with Claude**, which pre-fills the Run prompt with the file path.
- **Sessions** — this project's Claude Code transcript files; click a row for
  the last 50 conversation events.

**MONITOR**
- **Overview** — stat cards, status pills, active hook types, and a live
  activity feed of the newest session transcript.
- **Swarm** — Ruflo swarm status + launcher (simple goal box or five-section
  structured goal builder).
- **Graph** — graphify stats, query/explain box, and an interactive canvas map.

**LIBRARY**
- **Agents / Skills / Commands** — definitions under `.claude/`, filterable,
  click for raw markdown. **Config** — `.mcp.json`, `settings.json`, CLAUDE.md.

Keyboard: `1–9`/`0` switch tabs (nav order), `R` refreshes, `/` focuses filter,
`Ctrl+Enter` sends the Run prompt.

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/`, `/assets/*` | GET | The SPA (hub token injected into `index.html`) |
| `/api/run` | POST | `{prompt, model?, permissionMode?, resume?}` → `{id}`; spawns the CLI |
| `/api/run/stream?id=` | GET (SSE) | `line` events (stream-json, with ids for reconnect dedupe) + `done` |
| `/api/run/cancel` | POST | `{id}` → taskkill the run's process tree |
| `/api/runs` | GET | Run history metas, newest first |
| `/api/run/transcript?id=` | GET | `{meta, prompt, lines}` for replay |
| `/api/run/artifacts?id=` | GET | Files under the run's `artifacts/` |
| `/api/run/artifact?id=&file=` | GET | Serve one artifact (MIME-typed, CSP-sandboxed) |
| `/api/files` | GET / POST | List inbox / multipart upload (`?overwrite=1` after 409) |
| `/api/files/download?name=` | GET | Download one inbox file |
| `/api/files/delete` | POST | `{name}` → remove from inbox |
| `/api/overview`, `/api/agents`, `/api/skills`, `/api/commands`, `/api/config`, `/api/sessions`, `/api/session-tail`, `/api/activity`, `/api/detail` | GET | Monitor/library data |
| `/api/swarm/status`, `/api/swarm/launch` (POST), `/api/graph/stats`, `/api/graph/data`, `/api/graph/query` (POST) | — | Swarm + graph |

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
  directly — they can never read the hub token or call guarded endpoints.
- **No shell spawns** — all child processes use argv arrays with
  `shell: false`; the claude CLI is spawned via its native `claude.exe`, npx
  via npm's `npx-cli.js` through Node. User text is never shell-interpreted.
- **Path-safe ids** — run ids `^[a-z0-9-]+$`, session ids `^[a-f0-9-]+$`,
  artifact paths normalized and prefix-checked, inbox filenames sanitized to a
  safe character set. No request can escape the intended folders.
- **Bounded input** — prompts ≤ 20 k, uploads ≤ 50 MB, JSON bodies capped;
  subprocesses run with timeouts (runs are user-cancellable instead).

## CLI prerequisites

- **Node.js** — the only hard requirement; the server has zero dependencies.
- **claude CLI** (Run tab) — expects
  `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
  (override with `HUB_CLAUDE_EXE`), logged in via subscription or
  `ANTHROPIC_API_KEY`.
- **Ruflo** (Swarm tab) — fetched on demand via `npx -y ruflo@latest`; first
  status call can take ~10 s.
- **graphify** (Graph tab) — binary at `C:\Users\logto\.local\bin\graphify.exe`
  and a graph at `claude-dashboard/graphify-out/graph.json`
  (`graphify extract <project> --code-only`). Without it the tab shows a hint.
