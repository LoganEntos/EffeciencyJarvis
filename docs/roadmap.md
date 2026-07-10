# Claude Hub — Roadmap

Single source of truth for what to build next. Ordering rule: items that make
every later item cheaper/better ship first. **Token efficiency is the north
star** — prefer zero-dep, avoid always-on MCPs (they tax every run).

> **Deliberate architecture decisions live in `docs/open-issues.md`** — the
> ruflo-swarm ↔ run-engine overlap, dual memory, and the PARKED hermes
> both-stacks+mobile-toggle idea. Resolve ISSUE-1 before adding any new
> orchestrator (incl. hermes).

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
| S8 | **Swarm** — ruflo status parsed into cards + honest empty-state | `lib/core.js`, `assets/app.js` |
| S9 | **Interactive Graph** — search-highlight, click-to-select inspection panel, neighbor chips | `assets/graph.js` |
| S10 | **UI design library skill** — zero-dep font pairings/palettes/anti-slop rules | `.claude/skills/ui-design/` |
| S11 | **Hub-native Task queue** — durable queue the hub runs itself as auto-routed runs (the usage lever) | `lib/tasks.js`, `assets/tasks.js` |
| S12 | **Frontend-aesthetics cookbook adopted** — rules in CLAUDE.md + auto-injected into run artifact hints | `CLAUDE.md`, `lib/runs.js` |
| S13 | **Full library restored** — 90 agents / 35 skills / 166 commands / claude-flow+scrapling MCP (PBI excluded) | `.claude/`, `.mcp.json` |
| S14 | **Security + hygiene** — X-Hub-Token CSRF, CSP-sandboxed artifacts, traversal guards, smoke script, ruflo daemons killed + state gitignored | `server.js`, `scripts/` |
| S15 | **Engram semantic memory (over vectors)** — typed records (episodic/semantic/procedural), lexical+tag+recency+importance recall, NO embeddings/vector-DB/LLM-in-hot-path. Auto-captures runs, backfills history, Memory tab. Verified: search "artifact chart" ranks the chart run first | `lib/memory.js`, `assets/memory.js` |

---

## 🔜 DO NEXT — autonomous, no user action needed (execute top-down)

### N1. Hub restyle per the aesthetics cookbook  (was P2.5)
The hub's own chrome violates two cookbook call-outs: **Segoe UI system font**
and **purple gradient accent**. Restyle: pick one distinctive font (see
`.claude/skills/ui-design`), a dominant-color palette via CSS variables, a
layered background, and one staggered page-load reveal. Files: `assets/style.css`.
Done when: hub looks intentionally designed, still themeable, browser-verified.

### N2. Mobile polish  (was P2)
Audit every tab at 375px width (the nav already collapses <760px). Fix touch
targets, composer ergonomics, card wrapping, table overflow. Files:
`assets/style.css` + per-tab tweaks. Done when: all 11 tabs usable one-handed on
a phone. (Pairs with the user's Tailscale setup — see 🙋 below.)

### N3. Scheduled runs  (was P4.5, idea from nousresearch/hermes-agent)
Hub-native cron: recurring prompts (e.g. "every Monday: summarize last week's
runs + errors into a report artifact") persisted in `data/schedules.json`,
fired by the run engine with auto-routing. Zero-dep (setInterval + persisted
schedule). New tab or a section under Tasks. Completes the autonomous loop with
S11. Do NOT adopt hermes-agent itself (parallel Python agent stack, duplicates
the claude CLI).

### N3.5 Memory auto-recall into runs  (opt-in, the Engram payoff)
Inject the top-k relevant memories (from `lib/memory.search`) into a new run's
prompt as context — so the hub recalls past decisions/errors without you
re-explaining. This is the token PAYOFF of S15 (ENGRAM reports ~99% fewer tokens
vs vector-RAG) BUT it spends some tokens per run, so ship it as a **toggle in the
Run tab, default off**. Also add semantic/procedural distillation (rule-based, no
LLM) so memory isn't only episodic.

### N4. Routing-accuracy feedback loop
Compare each auto-routed model against the run outcome (did haiku succeed, or
error/retry?). Surface a small stat and tune `routeModel()` thresholds from real
data. Files: `lib/runs.js`, a metrics view. Sharpens the core token lever.

### N5. Dark/light theme toggle
System-preference detection + manual toggle in the header. Files:
`assets/style.css` (CSS-variable theming already in place), `assets/app.js`.

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
| **nousresearch/hermes-agent** | Parallel Python agent stack; duplicates the claude CLI. Idea harvested → N3. User wants both-stacks + a mobile on/off toggle → PARKED as ISSUE-5 in open-issues.md (harvest messaging via a thin bridge, don't stack; resolve ISSUE-1 first). | After ISSUE-1 |
| **nextlevelbuilder/ui-ux-pro-max** | npm+Python CLI, not a free skill. Value baked into `.claude/skills/ui-design` instead. | N/A — done the zero-dep way |
| **Base44** | Cloud app-builder; can't reach a localhost server that spawns the CLI without exposing it publicly (bad). The hub already IS the web app. | N/A — don't link |

---

## Interactive-permission approvals (big, deferred)
Bidirectional `--input-format stream-json` runs so Claude can ask mid-run
questions in the hub. Large; unlocks true interactivity but reworks the run
engine. Revisit once the autonomous loop (S11 + N3) is proven.
