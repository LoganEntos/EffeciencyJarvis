# Claude Hub — Roadmap

Single source of truth for what to build next. Ordering rule: items that make
every later item cheaper/better ship first. **Token efficiency is the north
star** — prefer zero-dep, avoid always-on MCPs (they tax every run).

> **Architecture decision log: `docs/open-issues.md`** — ALL six ISSUES
> resolved 2026-07-10: 1/2/3/4/6 by retiring ruflo; ISSUE-5 by ADOPTING hermes
> as the second agentic stack (installed + operational; H2–H4 wire it into the
> hub, the gateway toggle is the mobile bridge). No open architecture issues.

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
| S26 | **H2+H3+N5+N4+N6 batch (2026-07-11)** — **H2**: "engine: claude \| hermes" selector in the Run composer; hermes runs spawn `hermes -z <prompt> --usage-file` (argv array, no shell), plain-text stdout wrapped as `hermes_out` events into the same SSE/history path, one growing assistant bubble client-side, cost/model read from usage.json into meta (verified live: $0.0557 run, "engine works" reply, ⬡ hermes history tag). Model/perm selectors grey out on hermes (it self-governs); no resume yet (-z exposes no session id — usage.json carries one for a future H2.5). **H3**: hermes runs render in the agent graph as Maestro + standing crew ring (Crew/Scribe/Falcon/Scout/Archivist) pulsing while live. **N5**: ◐ header theme toggle flips `data-theme` (light vars from S16) + persists. **N4**: `GET /api/routing` — zero-cost routing-accuracy heuristics over run history (haiku error = under-routed; opus fast+cheap = over-routed) + ⚖ chip in Run history stats w/ suspect tooltip. **N6**: `GET /api/files/xlsx` — zero-dep xlsx structural preview (own ZIP central-directory reader + inflateRawSync; sheet names from workbook.xml + `<dimension>` per sheet, no cell values) + ▦ Sheets toggle per inbox row (verified: 2-sheet test book → Orders 250×8, Summary 12×3). Smoke +2 (41 checks) | `lib/runs.js`, `lib/agentgraph.js`, `lib/files.js`, `assets/run.js`, `assets/files.js`, `assets/app.js`, `index.html`, `scripts/verify-dashboard.ps1` |
| S25 | **N9 CSM voice engine — INSTALLED & VERIFIED end-to-end (optional, default OFF)** — Sesame CSM-1B as a second TTS engine, running **natively on Windows + the RTX 3060** (no WSL2). `assets/voice.js`: engine selector (browser speechSynthesis default \| CSM local) + speaker id (0–9); `speakCSM()` posts to same-origin `/api/voice/tts` (X-Hub-Token), plays the wav, auto-falls-back to the browser voice on any error so the call loop never dies; unified `stopSpeak()` barge-in kills both engines. `assets/voicecfg.js` (settings panel split out for the 500-line rule): engine status pill + one-click **⚡ Start engine** + ▶ Test round-trip. `lib/voice.js`: token-guarded proxy → `HUB_CSM_URL` (default `http://127.0.0.1:8790/tts`), **loopback-only target validation** (no SSRF), plus `/api/voice/status` (health) and `/api/voice/start` (spawns the sidecar — argv array, no shell). Runtime: `scripts/csm-server.py` in the gitignored `.csm/` venv — torch 2.6.0+cu124, **transformers pinned <5** (under 5.x the audio-embed weight fails to map and the model babbles; whisper-verified both ways), weights from the ungated `unsloth/csm-1b` mirror (official `sesame/csm-1b` is HF-gated; tried first when HF_TOKEN is set). Verified: model loads ~14 s on cuda, gen ≈1.2× audio duration, faster-whisper transcribed generated speech back to the requested text, full browser→hub→sidecar round-trip + Config UI browser-checked. Smoke +5 checks | `lib/voice.js`, `assets/voice.js`, `assets/voicecfg.js`, `scripts/csm-server.py`, `scripts/csm-requirements.txt`, `docs/voice-csm.md`, `server.js` |
| S24 | **N9 voice module Track A (late eve)** — `assets/voice.js`: header mic orb (Web Speech API → transcript → auto-routed run), talk-back (speechSynthesis reads replies), amber canvas orb state machine, Config settings (toggles default OFF + voice picker/rate). Zero-dep, zero server cost; run.js lifecycle hooks; browser-verified (orb, states, TTS speaking, STT available, no console errors); smoke 34/34 | `assets/voice.js`, `index.html`, `assets/run.js`, `assets/app.js` |
| S23 | **Hermes operational + agent bench + graph visual (late eve)** — hermes v0.18.2 installed (git+uv, venv rebuilt on winget CPython 3.11.9), Nous OAuth done, end-to-end verified; subagents pinned to gemini-3-flash. Agents tab roster = 8 live hermes roles + 14 curated local specialists, every one with explicit model frontmatter + tier chips (research-grounded: haiku for mechanical, sonnet for build/review, opus only for security-auditor/architect). Codebase graph defaults to a module-level view (~20 file nodes, weighted links, warm curated palette); voice plan written (`docs/voice-plan.md`) | `.claude/agents/`, `lib/core.js`, `assets/graph.js`, `docs/` |
| S22 | **Agent purge + Graph fixes (user decision, eve)** — all 91 claude-flow agent .md definitions deleted (every one ran on the session default = Fable 5; model tiering is the requirement). Replacement stack chosen: **hermes-agent** (see `docs/hermes-adoption.md`, install pending user). Graph tab: codebase map was a day stale (31 nodes) → regenerated (277 nodes/484 edges/18 communities); big-graph label declutter (top-48 by degree; hover/search labels the rest); live Agents view verified working via simulated running run | `.claude/`, `assets/graph.js`, `graphify-out/` |
| S21 | **ui-ux-pro-max skills adopted (user request)** — 6 MIT skills from nextlevelbuilder/ui-ux-pro-max-skill copied into `.claude/skills/`: ui-ux-pro-max (1.4MB CSV design DB), design, design-system, brand, banner-design, slides; hub adaptation note (no Python → Grep the CSVs, map fonts to /vendor/, vanilla CSS output); skipped ui-styling (React/Tailwind + duplicate TTFs). Library: 41 skills | `.claude/skills/` |

---

## ✅ SHIPPED — hermes per-step streaming over ACP (2026-07-12, commit 7b1eac2)

hermes now runs over **`hermes acp`** (JSON-RPC/stdio) instead of `-z`, so its
real work streams live — agent text, thoughts, tool calls + results, plan — into
the same Run-tab + agent-graph rendering as claude (real live crew). Model +
token usage captured; acp session id returned (future resume). `lib/acp.js` is
the client; **verified live end-to-end** (text run + Bash-tool run, both stream +
complete with token accounting) when the hub is **terminal-launched**.

**⚠ KNOWN LIMITATION — headless-spawn hang (Windows).** ACP completes the
handshake + logs `conversation turn`, then the nous inference (hermes worker
thread) HANGS — but ONLY when the hub **server** runs headless (the preview/dev
tool, and the Task Scheduler autostart). Terminal-launched (`node
claude-dashboard/server.js`, the documented path) works. A **75s stall watchdog**
fails headless runs with a clear "launch from a terminal" message instead of
hanging forever. `-z` used to work headless, so it's ACP-worker-thread specific.
Next options: an asyncio env-var fix, `hermes serve` gateway, or a
`HUB_HERMES_ENGINE=oneshot` fallback for headless. See memory
`hermes-acp-headless-hang`.

## ✅ RESOLVED — Hermes/agent runs are now visible mid-run (fixed 2026-07-11, commit cebfe6a)

**Fixed** via `lib/liveness.js` (wired into `runs.js`; UI in `run.js`/`style.css`),
covering all three fix-path items below at once:
1. **Orphan reaper** (boot + every 60s) — any run left `running`/`queued` on disk
   but absent from the live map is a crash/restart orphan → rewritten to a
   terminal `error` (`orphaned:true`). Zombies can no longer masquerade as active.
2. **Heartbeat** — a 5s SSE `heartbeat` event (elapsed/idle/procAlive/stalled);
   the Run tab shows `◉ running` / `⚠ stalled` (no output >120s) / `process gone`,
   and `/api/runs` rows carry the same flags. Applies to BOTH stacks.
3. **Hermes log tail** — for `-z` runs the hub follows `hermes logs agent -f` and
   streams the filtered activity lines as `hermes_log` events, so the run's real
   work (model calls, tool use) surfaces live despite `-z` printing only final text.

**Live-verified (2026-07-11, ~$0.06 hermes run):** the heartbeat streamed
correctly (procAlive/idle/stalled) — STATUS is fully fixed; a working run is now
visibly distinct from stalled/dead. This unblocks R0/R1.

**Caveat found live — hermes mid-run CONTENT is NOT solved by the log tail:** a
`-z` run writes only boot plugin-registration to agent.log (no tool/model/step
lines at default level, no log-level knob). So `hermes logs agent -f` yields
nothing useful mid-run (its header banner is now filtered); the tail is kept as
harmless best-effort. **Real per-step hermes visibility needs the `hermes acp`
(Agent Client Protocol) or `serve` event stream** — parse it like claude's
stream-json. Fold that into **H4 (gateway)**. Until then: hermes "current work" =
heartbeat liveness only; claude runs remain fully streamed.

<details><summary>Original blocker writeup (kept for context)</summary>

**The problem (elevated to a top priority by the user):** a running Hermes run
shows **no live progress at all** — you cannot see what it is doing, whether
it is working, stalled, or dead. Root cause: the hub spawns hermes in `-z`
one-shot mode, which by design prints **only the final text at completion** —
zero streaming, no tool events, no step log. So its `output.jsonl` stays empty
for the entire run.

**Why this is serious, not cosmetic:**
- **Indistinguishable from failure.** On 2026-07-12 the redesign build ran 6+
  minutes with an empty output file — identical on screen to two ZOMBIE runs
  still marked "running" from crashes hours earlier (18:40 and 23:04, no
  usage.json, process long dead). Working, stalled, and dead all look the same.
- **Blocks R0 + R1** — you can't build an efficiency dashboard or a truthful
  live agent graph for an engine that emits no telemetry. Everything
  Hermes-first depends on fixing this FIRST.
- **Trust.** We're handing Hermes multi-minute autonomous builds of the app
  itself; flying blind on those is unacceptable.

**Fix path (investigate, in order):**
1. Does `hermes` have a **streaming / JSON event mode** (not `-z`)? Check
   `hermes chat`, `--tui`, verbose/`--dev`, `--pass-session-id`, or the
   gateway/`serve`/ACP event streams. If any emits structured turn/tool events,
   switch the run engine to that and parse it like claude's stream-json.
2. If not: poll `hermes`'s own session store (it has FTS5 session memory /
   `hermes sessions`) mid-run for the live transcript, and surface a heartbeat.
3. Minimum viable now: a **liveness/zombie guard** — mark a "running" run as
   stalled/dead when its process is gone or it's produced nothing for N minutes,
   so zombies stop masquerading as active (this alone removes the worst
   confusion and should ship regardless).

</details>

## 🗣️ USER REVIEW BACKLOG (2026-07-11 walkthrough) — highest priority

Direction shift: **Hermes is now the default/always-on engine.** Everything
below is framed by that — Hermes efficiency + observability is the theme.
**Observability blocker RESOLVED (see above) — R0/R1 are unblocked.**

**R0. Hermes-first + efficiency metrics (PRIORITY 1).** Make hermes the default
engine. Build REAL efficiency tracking on Overview — the current mockup metrics
(Runs Today, Total Tokens, Median Latency) are vanity counts, useless for
tuning. What actually matters (user, 2026-07-11), in priority order:
  1. **Usage remaining — today & this week (THE hero metric).** On a
     subscription with daily/weekly caps, remaining allowance is the #1
     scheduling/delegation signal: run now vs defer vs delegate to a cheaper
     tier. Show as prominent gauges + burn rate / projection ("at this rate the
     weekly cap hits Thursday"). Wiring real quota is a separate step (Claude
     Code usage file/`/status`; hermes usage via Nous Portal).
  2. Where tokens & $ go — split by tier (main vs aux vs subagent) and per task.
  3. Bottlenecks — time per step, which agent/tool is the slow path.
  4. Wasted work — redundant/failed tool calls, retries, re-reads, cache misses.
  5. Outcome per dollar — first-try success vs rework, at what cost.
**Design direction (user, 2026-07-11): CLEAN & MINIMAL, not corny.** Strip the
editorial magazine headlines and the big Fraunces serif display; drop the
over-"designed"/marketed feel. Restrained dark theme, few colors + one accent,
generous whitespace, information-first but calm. Type: clean grotesque (Hanken
Grotesk / Archivo) + JetBrains Mono for data — no serif display. Depends on R1
(truthful hermes graph) + R2 (clean libraries).

**R1. Live run debrief + truthful agent graph.** Clicking a running task/prompt
must show a live DEBRIEF (what it's doing, step by step), not just "running".
The Graph must depict the ACTUAL agents for the active engine (claude vs
hermes — today hermes `-z` one-shot emits no tool telemetry, so the graph
shows only a static crew ring → need hermes structured/verbose event output to
show real live agents, who's active, how they hand off), rendered in a vibrant,
attractive web. **Blocker to investigate:** does `hermes` expose a
streaming/JSON event mode (not `-z`)? If not, this is the gating技术 problem.

**R2. Navigable libraries + rethink Assets.** Skills (59), Commands, Agents
libraries need real sorting/grouping/search — currently a flat dump, hard to
find anything (the ECC adoption made Skills much bigger). Assets tab needs a
practicality rethink: it's design-example fonts/icons/css with NO website-
creation feature wired into the app to consume them — decide if it earns its
place or becomes a run-artifact style palette that's actually used.

**R3. Auto session summaries (no manual click).** Sessions must NOT require
clicking "summarize with Claude". A cheap model (haiku/sonnet) auto-scans every
session and writes an exact debrief — improves memory, makes old sessions
scannable. Run it on session close / on a cheap batch, cache the summary.

**R4. Files: image thumbnails + day grouping.** Show a visual thumbnail of every
uploaded image (you must see the context the AI is given). Group/sort by upload
day; >10 images is unrememberable without categorization.

**R5. Scheduled tasks are UNTESTED — no stress testing done** (`lib/schedules.js`,
`data/schedules.json`). NOTHING has verified they actually fire. Fold
scheduled-task testing into the self-improvement/autopilot loop (create a
near-future schedule, assert it fires + lands in run history, tear down).

## 🔜 DO NEXT — autonomous, no user action needed (execute top-down)

> **North star / definition of done:** the hub is a token-efficient, voice-
> capable local cockpit where (1) every prompt lands on the cheapest capable
> model — hub `routeModel()` for claude runs, hermes tiering for agentic runs;
> (2) you can run work by **typing OR talking**, on desktop and phone;
> (3) the whole system is observable (runs, spend, live agent graph, memory);
> (4) it survives regressions (smoke + Playwright). The list below is what
> remains to reach that; H2→H4 and N9 Track B are the load-bearing items.

### H1–H4. Hermes integration (H1 ✅ shipped; credentials ✅ done; H2–H4 next)
hermes-agent IS the second agentic stack (model tiering: cheap models for
mechanical work). Full plan in `docs/hermes-adoption.md`. Installed +
configured + authenticated + verified end-to-end (see S23). H1 ✅ shipped:
`/api/hermes` + Hermes stack card + 8 live hermes roles in the Agents roster.
Remaining, in order:
- **H2** — "engine: claude | hermes" selector in the Run composer; hermes runs
  spawn via argv arrays (same security invariants), land in the same run
  history + Engram memory. THE next build.
- **H3** — hermes runs feed `lib/agentgraph.js` personas like claude runs do
  (Maestro/Crew/etc. light up in the live graph).
- **H4** — `hermes gateway` on/off toggle + status in the hub = the mobile
  messaging bridge (old ISSUE-5). Pairs with N9 Track B. 🙋 needs the user's
  Telegram bot token when we get there.

### N9 Jarvis voice module — Track A ✅ SHIPPED (2026-07-10 late eve)
Full plan in **`docs/voice-plan.md`**. **Track A DONE**: `assets/voice.js` —
mic orb in the header (Web Speech API → transcript → auto-routed run) +
talk-back (speechSynthesis reads Claude's reply) + amber canvas orb state
machine (idle/listening/thinking/speaking) + Config settings (both toggles
default OFF, voice picker, rate). Zero-dep, zero server cost; browser-verified;
smoke script covers voice.js (34 checks). Remaining: **Track B** = hermes-native
voice notes via gateway (faster-whisper STT + Edge TTS, both free/built-in,
pairs with H4); **Track C** parked (wake word, full duplex). Live mic capture
is the one manual check (needs a real microphone).
**CSM engine (S25)** is fully installed and verified end-to-end — native
Windows CUDA runtime in `.csm/` (venv + weights, ~10 GB, gitignored), sidecar
started from Config → Voice (⚡ Start engine), speech content whisper-verified.
Browser voice stays the default; flip Config → Voice → TTS engine to
"Sesame CSM-1B (local)" to use it. Setup/rebuild notes: `docs/voice-csm.md`.

### N7. Library: SharePoint Breakdown (user request 2026-07-10 — QUEUED, do not build yet)
New Library item: a full breakdown of every file directory with an
embedding/summary of what each file contains, kept up to date so any new
thread gets instant file-level orientation. Build it ONCE with Fable 5 (much
more efficient at the initial sweep), then hand maintenance to Opus 4.8.
Shape TBD: likely `data/breakdown.json` + a Library tab section; refresh via a
scheduled run (S17). **User said: to-do list only for now.**

### N10. Council mode (user link 2026-07-12: karpathy/llm-council — SCOPED, not built yet)
Prior art: llm-council fans a query out to several LLMs, has each anonymously
rank the others' answers, then a "Chairman" model synthesizes a final answer.
Mapped onto the hub (Claude-only, no cross-provider keys — see
`engine-claude-only` memory): a "Council" run mode fires the same prompt to 2-3
parallel Claude model tiers (e.g. haiku + sonnet + opus, or auto vs pinned),
renders each answer in a tab (same shape as run history), then a cheap model
(haiku) synthesizes/picks the best into one final reply. **Blocked on scope,
not on the idea:** `lib/runs.js` is already at 472/500 lines with no headroom
for concurrent-process orchestration, and `assets/run.js` is already over the
500-line cap (557 — see the split below). Do this AFTER both are split:
add `lib/council.js` (spawn N runs via the existing argv-array run primitives,
fan-in) + `assets/council.js` (tabbed responses + synthesis). Matches the
already-planned "Council" panel referenced in `redesign-clean-dark` memory.

### N11. assets/run.js split ✅ DONE 2026-07-12
`run.js` was 557 lines (over the 500 cap). Split per the `app.js` pattern:
the run-history list (fetch, filter chips, stat pills, run rows + replay/delete)
moved to **`assets/runhistory.js`** (91 lines); composer + SSE streaming +
liveness badges + artifacts stay in `run.js` (now 471). Loaded after run.js;
zero behavior change — verified (history renders, filter works, no errors).
(A parallel run had attempted this split and left it broken; redone cleanly.)

## 📥 GitHubs to incorporate (user-curated, not built yet)

External repos the user has flagged to fold into the hub. Incorporate the
IDEA/method natively (zero-dep, in the hub's stack) — do NOT drop foreign
frameworks in wholesale (the hermes lesson). Build only on the user's go-ahead.

- **karpathy/llm-council → Council mode** — see N10 below (3-stage panel:
  opinions → peer review → chairman synthesis). Member set still TBD (user has
  Claude + hermes via subs; ChatGPT/Perplexity would need API keys).
- **browser-use/browser-harness** (2026-07-12, user reversed the earlier
  decline — INCLUDE). Tagline: *"Connect an LLM directly to your real browser
  with a thin, editable CDP harness."* Python 3.12 / `uv`, ~1k lines, connects
  to a local Chrome via CDP (`--remote-debugging-port`); **self-healing** — the
  agent writes + persists its own reusable browser-helper code as a **skill**
  (`browser-harness skill`). Optional Browser Use Cloud free tier (3 concurrent
  browsers) for stealth/headless. **Why it's back in scope:** its
  skill-authoring loop is the capability `scrapling` lacks — the agent building
  and keeping reusable site-specific automation across sessions. **How to
  incorporate:** it's Python (violates the app's zero-dep runtime), so run it
  as a **sibling tool the hub drives** (like Hermes Desktop / the CSM sidecar),
  or port just the CDP-harness pattern into a hub skill — decide at build time.
  Needs a real Chrome with remote debugging; no cloud account required for local
  use.
- **unclecode/crawl4ai** — ⛔ **EVALUATED → SKIP (2026-07-12).** License cleared
  (Apache-2.0, confirmed via the GitHub API). But it overlaps Scrapling heavily
  (both Playwright-based, both ship an MCP, both fetch/markdown/crawl), and the
  GitHub-intake team's real need — pull *specific* files from a repo/CDN and
  vendor them — is already met by Scrapling + one-time curl/WebFetch. crawl4ai's
  edge (LLM-markdown, deep crawls, RAG extraction) isn't what intake needs, and a
  second always-on scraper MCP taxes every run's context for zero new capability.
  **Not installed.** Revisit only as an *on-demand CLI* (never an always-on MCP)
  IF a deep-crawl / docs→markdown RAG-ingestion feature is greenlit. Full
  rationale + capability table: `docs/crawl4ai-evaluation.md`.

### N11. Sources library — "what GitHubs power this hub" ✅ DONE 2026-07-12
Shipped: **Sources** Library tab (`assets/sources.js`) → `/api/sources`
(`lib/sources.js`, zero-dep). Collates vendored assets from `vendor/manifest.json`
(fonts folded to one row per family, icon sprites, CSS — enriched with upstream
repo links via a `repoMap`) + non-vendored references from `lib/sources.json`
(adapted skills, agent-tool siblings, queued-to-incorporate). Grouped by kind
with license badges (a `?` marks a license not confirmed from the repo's LICENSE),
status pills (deprecated/queued), and clickable repo links. 27 sources / 14 repos.
Smoke check added. New GitHub-intake pulls land in the manifest or `sources.json`
and surface here automatically.

<details><summary>original spec</summary>
A new Library tab (or an Assets-tab section) that lists **every external GitHub
repo the hub uses or references**, with repo link, license, and what it's used
for. Data already exists, scattered: `vendor/manifest.json` `source` fields (the
4 icon sprites + pattern.css + fonts + normalize), the adapted skills
(ibelick/ui-skills, affaan-m/ecc, nextlevelbuilder/ui-ux-pro-max-skill,
bansal-io/pattern.css, twbs/icons, tabler, lucide, halfmage/pixelarticons), the
incorporate list above (browser-harness, crawl4ai, llm-council), and the tool
siblings (Scrapling, hermes, CSM). **Build:** a `lib/` provenance collator (start
from manifest `source` + a small curated JSON of the non-vendored references) →
`/api/sources` → a tab that groups by kind (vendored asset / skill / agent tool /
queued-to-incorporate) with license badges + "used for" text. Zero-dep, reads
existing manifest; keep the curated reference list in one JSON so it stays
truthful. Pairs naturally with the GitHub-intake team (new intakes append here).
</details>

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

### Q4. affaan-m/ecc — adopt its skills  ✅ DONE 2026-07-11 (curated-active + full library)
Unblocked by the user downloading the repo locally (`ECC-main.zip`, now
gitignored). 278 skills (MIT) adopted as a **two-tier install** — activating
all would have added ~15-18k tokens of skill descriptions to EVERY session and
hub run (incl. the voice loop), so the user chose curated-active when asked:
- **`.claude/skills-library/`** (committed): all 278 + LICENSE + README with
  provenance, the active list, skip reasons, and a one-command promote/demote
  recipe. Not auto-loaded — Claude Code only reads `.claude/skills/`.
- **`.claude/skills/`** (active, 41 → 59): 18 curated — hub dev
  (make-interfaces-feel-better, browser-qa, e2e-testing, verification-loop,
  security-review, api-design, backend-patterns), agents/workflows
  (prompt-optimizer, team-agent-orchestration, autonomous-loops, search-first,
  context-budget), business/logistics for the Entos work (market-research,
  customs-trade-compliance, logistics-exception-management,
  inventory-demand-planning, carrier-relationship-management,
  returns-reverse-logistics).
- Skipped-from-active: `deep-research` (needs firecrawl/exa MCPs),
  `cost-tracking`/`continuous-learning*`/`skill-comply`/`ck` (need ECC's own
  hooks/scripts infra), `frontend-design-direction` (would override this
  repo's design language), `design-system` (name-collision with the
  ui-ux-pro-max adoption), ~250 stack packs irrelevant here.
- Active set grep-audited (network/exec/injection patterns — clean; hits were
  teaching examples in the security docs). Hub Skills tab verified at 59.
ECC's `agents/*` were NOT adopted — the curated-~20-agent-roster decision
stands (never a bulk library).

---

## 🙋 Pending USER actions (agent will not do these — system/network/installs)

- ~~**Hermes credentials**~~ ✅ DONE 2026-07-10 late eve: user completed
  `hermes auth add nous` (Nous Portal OAuth device-code → auth.json). Verified
  end-to-end: `hermes -z` one-shot answered through Nous; delegation pair
  (subagents → `gemini-3-flash` via nous) activated in config; Agents-tab
  Hermes card shows **ready**. H2–H4 are fully unblocked.
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
