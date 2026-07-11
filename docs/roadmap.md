# Claude Hub — Roadmap

Single source of truth for what to build next. Ordering rule: items that make
every later item cheaper/better ship first. **Token efficiency is the north
star** — prefer zero-dep, avoid always-on MCPs (they tax every run).

> **Architecture decision log: `docs/open-issues.md`** — ISSUE-1/2/3/4/6 were
> RESOLVED 2026-07-10 by retiring ruflo (user decision; one agent stack only).
> Only ISSUE-5 remains parked: the hermes thin-messaging-bridge with a mobile
> on/off toggle — the user likes it; build it as ~100 lines on the run engine
> when asked, never as a parallel stack.

Status: ✅ done · 🔜 next (ready to execute) · ⬜ queued · 🔮 deferred (needs a trigger) · 🙋 needs user action

---

## ✅ Shipped (2026-07-10)

| # | Item | Where |
|---|------|-------|
| S1 | **Standalone repo** — app extracted from the Power BI project into `claude-hub`; app-only CLAUDE.md so runs never inherit PBI context | whole repo |
| S2 | **Run tab** — chat with the claude CLI over SSE, `--resume` continuity, cancel, 2-active+5-queued limiter | `assets/run.js`, `lib/runs.js` |
| S3 | **Auto model allocation** — every prompt routed haiku/sonnet/opus by complexity; resumed sessions keep their model; decision streamed to chat. Verified $0.037 haiku vs $0.158 default | `lib/runs.js` routeModel() |
| S4 | **Run history** — metrics chips, error excerpts, filter, per-run delete, inline artifact rendering (sandboxed) | `assets/run.js` |
| S5 | **Files inbox** — drag-drop upload, download, delete, Process-with-Claude | `lib/files.js`, `assets/files.js` |
| S6 | **Overview cockpit** — runs/spend/success/failed/artifacts/inbox cards, recent runs | `assets/app.js` |
| S7 | **Sessions** — relative times + per-session "Summarize with Claude" | `assets/app.js` |
| S8 | **Swarm** — ruflo status parsed into cards + honest empty-state *(removed in S20 — ruflo retired)* | — |
| S9 | **Interactive Graph** — search-highlight, click-to-select inspection panel, neighbor chips | `assets/graph.js` |
| S10 | **UI design library skill** — zero-dep font pairings/palettes/anti-slop rules | `.claude/skills/ui-design/` |
| S11 | **Hub-native Task queue** — durable queue the hub runs itself as auto-routed runs (the usage lever) | `lib/tasks.js`, `assets/tasks.js` |
| S12 | **Frontend-aesthetics cookbook adopted** — rules in CLAUDE.md + auto-injected into run artifact hints | `CLAUDE.md`, `lib/runs.js` |
| S13 | **Full library restored** — 90 agents / 35 skills / 166 commands / claude-flow+scrapling MCP (PBI excluded) | `.claude/`, `.mcp.json` |
| S14 | **Security + hygiene** — X-Hub-Token CSRF, CSP-sandboxed artifacts, traversal guards, smoke script, ruflo daemons killed + state gitignored | `server.js`, `scripts/` |
| S15 | **Engram semantic memory (over vectors)** — typed records (episodic/semantic/procedural), lexical+tag+recency+importance recall, NO embeddings/vector-DB/LLM-in-hot-path. Auto-captures runs, backfills history, Memory tab. Verified: search "artifact chart" ranks the chart run first | `lib/memory.js`, `assets/memory.js` |
| S16 | **N1 Hub restyle** — terminal-amber instrument panel per the aesthetics cookbook: JetBrains Mono (200/800) + IBM Plex Sans via Google Fonts, amber-dominant palette on warm near-black, hairline grid + layered glow background, one staggered load reveal, reduced-motion respected, light-theme CSS vars pre-wired for N5. Purple gradient + Segoe purged from every asset incl. graph canvas. Browser-verified desktop + 375px | `assets/style.css`, `index.html`, all `assets/*.js` |
| S17 | **N3 Scheduled runs** — hub-native cron: interval/daily/weekly schedules in `data/schedules.json`, 30s ticker fires due prompts through the run engine (inherits routing/streaming/history/spend/Engram), busy-defer + no-stacking guards, CRUD endpoints (token-guarded) + Scheduled section in Tasks tab. Verified: ticker fired a live haiku run 20s after due time, nextDue advanced correctly | `lib/schedules.js`, `server.js`, `assets/tasks.js` |
| S18 | **N3.5 Memory auto-recall** — opt-in toggle (default OFF) in the Run composer injects top-3 relevant Engram memories (1.2k char cap) into the CLI prompt; injected count streamed to chat + stored as `recallCount`. Rule-based distillation: 3+ failed runs sharing a tag → standing semantic "failure pattern" record. Verified: haiku answered chart values purely from recalled context ($0.036, 1 turn, no tools) | `lib/memory.js`, `lib/runs.js`, `assets/run.js` |
| S19 | **Assets library (user request)** — `vendor/` with 18 OFL font faces (all 12 ui-design families, latin woff2), Lucide sprite (1,746 icons, ISC), modern-normalize (MIT); manifest.json records every source+license. Guarded `/vendor/` route, `/api/assets`, fifth Library tab (font specimens + searchable click-to-copy icon grid). Hub fonts now fully local (offline, no CDN); artifact CSP allows `/vendor/` only; run hint advertises the library so generated pages use local assets | `vendor/`, `assets/assetlib.js`, `server.js` |
| S20 | **Ruflo retired + live Agent Graph (user decision)** — Swarm tab/endpoints/claude-flow MCP removed (open-issues 1/2/3/4/6 resolved). Graph tab's default view is now a live radial map of the current run's crew: persona-named workers (Maestro/Poet/Dart models; Scout, Bloodhound, Scribe, Wrench, Falcon, Foreman, Spellbook, Envoy crews; recruited subagents; Gallery) with pulsing active nodes, animated links, auto-follow of live runs, click-to-inspect, click-center-to-replay. Codebase map kept behind a chip. Zero-token: polls a local disk-read endpoint | `lib/agentgraph.js`, `assets/agentviz.js`, `assets/graph.js` |
| S22 | **Agent purge + Graph fixes (user decision, eve)** — all 91 claude-flow agent .md definitions deleted (every one ran on the session default = Fable 5; model tiering is the requirement). Replacement stack chosen: **hermes-agent** (see `docs/hermes-adoption.md`, install pending user). Graph tab: codebase map was a day stale (31 nodes) → regenerated (277 nodes/484 edges/18 communities); big-graph label declutter (top-48 by degree; hover/search labels the rest); live Agents view verified working via simulated running run | `.claude/`, `assets/graph.js`, `graphify-out/` |
| S21 | **ui-ux-pro-max skills adopted (user request)** — 6 MIT skills from nextlevelbuilder/ui-ux-pro-max-skill copied into `.claude/skills/`: ui-ux-pro-max (1.4MB CSV design DB), design, design-system, brand, banner-design, slides; hub adaptation note (no Python → Grep the CSVs, map fonts to /vendor/, vanilla CSS output); skipped ui-styling (React/Tailwind + duplicate TTFs). Library: 41 skills | `.claude/skills/` |

---

## 🔜 DO NEXT — autonomous, no user action needed (execute top-down)

*(N1, N3, N3.5 shipped 2026-07-10 → see S16–S18 above.)*

### H1–H4. Hermes integration (H1 ✅ shipped; H2–H4 next once credentials exist)
User decision 2026-07-10 eve: hermes-agent IS the second agentic stack (model
tiering: cheap models for mechanical work). Full plan in
`docs/hermes-adoption.md`. **INSTALLED 2026-07-10 late eve** (v0.18.2, manual
git+uv path after the remote-script installer was permission-blocked): venv at
`~/.hermes/venvs/hermes`, clone at `~/.hermes/hermes-agent`, config at
`%LOCALAPPDATA%\hermes\config.yaml` (NOT ~/.hermes — Windows HERMES_HOME),
mirrored in `scripts/hermes-config.yaml`. `hermes` is on the user PATH (new
shells). H1 ✅: `/api/hermes` + Hermes stack card on the Agents tab
(version/model/credentials pill), smoke-tested. Remaining, in order:
🙋 credentials → H2 hermes engine option in the Run composer → H3 hermes runs
in the agent graph → H4 messaging gateway toggle (the ISSUE-5 mobile bridge).

### N9 → COMMITTED (user, 2026-07-10 late eve): Jarvis voice module
User: "include jarvis voice module in the plan" — N9 below is no longer just
researched, it's committed work. Build right after H2 (or immediately if
credentials stall): mic button → Web Speech API → auto-routed run; talk-back
via speechSynthesis; amber orb state machine in the header. Zero-dep.

### N7. Library: SharePoint Breakdown (user request 2026-07-10 — QUEUED, do not build yet)
New Library item: a full breakdown of every file directory with an
embedding/summary of what each file contains, kept up to date so any new
thread gets instant file-level orientation. Build it ONCE with Fable 5 (much
more efficient at the initial sweep), then hand maintenance to Opus 4.8.
Shape TBD: likely `data/breakdown.json` + a Library tab section; refresh via a
scheduled run (S17). **User said: to-do list only for now.**

### N9. Jarvis voice layer — talk back and forth with the hub (researched 2026-07-10 eve)
External research done (see sources in HANDOFF session notes / this entry).
Studied: isair/jarvis (offline, MCP tools), ethanplusai/jarvis (voice →
`[ACTION:BUILD]` → spawns Claude Code sessions; Chrome Web Speech API + Fish
Audio TTS + Three.js orb), rezaulhreza/jarvis (dashboard + 4-state orb:
idle/listening/speaking/thinking; Whisper/Edge-TTS/browser TTS options),
Julian-Ivanov/jarvis-voice-assistant (web UI + WebSocket + Claude Vision).
Conclusion: the hub already has their entire server side (run engine = action
dispatch, SSE = their WebSocket, Engram = their SQLite memory). The gap is
ONLY the voice loop, and it's achievable **zero-dep, browser-native**:
1. Mic button in the Run composer → `webkitSpeechRecognition` (Chrome/Edge)
   → live transcript → send as a normal auto-routed run.
2. Talk-back toggle: stream the run's final text → `speechSynthesis` (pick a
   good local voice, rate/pitch tuned) — the hub literally answers out loud.
3. A canvas **orb** in the header reflecting state (idle / listening /
   run-active / speaking) in the hub's amber aesthetic — small, always
   visible, doubles as the mic button. (Orb state machine harvested from
   rezaulhreza; skip Three.js.)
Upgrade path later (not now): local Whisper or Edge-TTS for nicer voices.
Pairs with N8 (voice on the phone over Tailscale = true pocket Jarvis).

### N8. iPhone incorporation (user request 2026-07-10 — QUEUED, evaluate options)
Get the hub properly usable from an iPhone — possibly via Base44 or another
app-builder, possibly without one. Options to weigh when picked up:
(a) Tailscale + PWA manifest/icon on the existing hub (zero-dep, already
half-planned in 🙋 Mobile access + N2); (b) a Base44-built front-end that
talks to the hub over the user's Tailscale HTTPS URL (revisits the earlier
"Base44 can't reach localhost" objection — Tailscale changes the math);
(c) a thin native wrapper. Depends on N2 mobile polish either way.

### N2. Mobile polish  (was P2)
Audit every tab at 375px width (the nav already collapses <760px). Fix touch
targets, composer ergonomics, card wrapping, table overflow. Files:
`assets/style.css` + per-tab tweaks. Done when: all 11 tabs usable one-handed on
a phone. (Pairs with the user's Tailscale setup — see 🙋 below.) Spot-check at
375px during S16 showed no regressions; this item is the full ergonomic pass.

### N4. Routing-accuracy feedback loop
Compare each auto-routed model against the run outcome (did haiku succeed, or
error/retry?). Surface a small stat and tune `routeModel()` thresholds from real
data. Files: `lib/runs.js`, a metrics view. Sharpens the core token lever.

### N5. Dark/light theme toggle
System-preference detection + manual toggle in the header. The light-theme
variable set already exists (`:root[data-theme="light"]` in `assets/style.css`,
shipped with S16) — remaining work is just the header toggle + persistence in
`assets/app.js`.

### N6. xlsx structural preview in Files
Zero-dep zip/xml parse to show sheet names + dimensions for uploaded `.xlsx`
before a run reads them. Files: `lib/files.js`, `assets/files.js`.

---

## ⬜ Queued — needs a dependency install (no-install rule LIFTED; still weigh token cost)

### Q1. Playwright E2E suite  (playwright.dev)
Dev-only dependency (app runtime stays zero-dep, **no per-run token tax**). Drive
real browser flows (send→render, upload→process, artifact renders) as repeatable
tests. Extends `scripts/verify-dashboard.ps1` (endpoints) with UI truth. Highest-
value install: locks in every future change against regressions. **Recommended
first install.**

### Q2. markdownify-MCP  (github.com/zcaceres/markdownify-mcp)
Convert uploaded PDF/DOCX/XLSX/images to markdown before a run reads them →
far fewer tokens per document task (usage-POSITIVE for document work). Needs
pnpm + uv. **Caveat:** it's an MCP → schemas load into every run. Add only when
document workflows are actually active; consider scoping it out of lean runs.

### Q3. task-master  (github.com/eyaltoledano/claude-task-master)
PRD→task breakdown. **Decision made: NOT as an always-on MCP** (taxes every run,
fights the token goal — the hub-native queue S11 covers the need). If its
PRD-decomposition is ever wanted, install CLI-only and invoke on demand in
Claude Code; never put it in `.mcp.json`.

---

## 🙋 Pending USER actions (agent will not do these — system/network/installs)

- **Hermes credentials (unblocks H2–H4; install itself is DONE):** either
  `hermes auth add nous` (Nous Portal OAuth — no key pasting, opens browser) or
  put `ANTHROPIC_API_KEY=` / `OPENROUTER_API_KEY=` in `%LOCALAPPDATA%\hermes\.env`.
  Then optionally uncomment the matching `delegation:` pair in
  `%LOCALAPPDATA%\hermes\config.yaml` so subagents run on a cheap model.
  The Agents tab's Hermes card flips from "needs credentials" to "ready".
- **Autostart:** `cd claude-hub; powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1` — hub starts at logon so the bookmark always works.
- **Mobile access:** install Tailscale on PC + phone, then `tailscale serve --bg 5757`; bookmark the private HTTPS URL on the phone. (Agent never touches VPN/network.)
- **Obsidian (for Q-Obsidian below):** confirm you use/want Obsidian and give a vault path.

---

## 🔮 Deferred — evaluated, parked with a clear trigger

| Ref | Verdict | Trigger to revisit |
|-----|---------|--------------------|
| **obsidian.md** | Q-Obsidian: export runs/summaries as `.md` into a vault folder (local, zero-dep — writing files is all it takes). Good fit. | Awaiting user's yes + vault path |
| **tavily.com** | Web search API. Redundant now — claude CLI ships WebSearch + Scrapling is available; Tavily adds an API key + per-call cost. | Research-heavy runs fail on search quality |
| **21st.dev** | React/Tailwind component marketplace — conflicts with the zero-dep vanilla rule. | Only if a deliberate React rewrite is chosen |
| **per-simmons/damon-ade** | Agentic dev env, macOS Apple-Silicon only; user is on Windows. | N/A — reference for UI inspiration only |
| **charlie-labs** | Commercial autonomous eng agent (GitHub/Linear/Slack); a product, not a tool. Their instructions/daemons catalog is prior art for the task queue. | N/A |
| **nousresearch/hermes-agent** | ✅ ADOPTED 2026-07-10 eve (user picked it as the replacement agentic stack after the claude-flow agent purge — per-task model tiering is the draw). No longer parked; see `docs/hermes-adoption.md` and H1–H4 above. Install itself is a 🙋 user action. | done (decision) |
| **nextlevelbuilder/ui-ux-pro-max** | ✅ ADOPTED 2026-07-10 (user re-sent link; upstream now ships real Claude skills). Copied 6 skills into `.claude/skills/`: **ui-ux-pro-max** (1.4MB CSV design DB: 50+ styles, 161 palettes, 57 font pairings, 161 product types, 99 UX rules, per-stack guides), design, design-system, brand, banner-design, slides. Hub adaptation note added (no Python → Grep the CSVs; map fonts to /vendor/). Skipped **ui-styling** (React/shadcn/Tailwind stack + 5.6MB TTFs — conflicts with zero-dep rule, fonts already vendored). MIT, LICENSE kept. | done |
| **Base44** | Cloud app-builder; can't reach a localhost server that spawns the CLI without exposing it publicly (bad). The hub already IS the web app. | N/A — don't link |

---

## Interactive-permission approvals (big, deferred)
Bidirectional `--input-format stream-json` runs so Claude can ask mid-run
questions in the hub. Large; unlocks true interactivity but reworks the run
engine. Revisit once the autonomous loop (S11 + N3) is proven.
