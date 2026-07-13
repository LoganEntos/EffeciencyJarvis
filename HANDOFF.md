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

## Syncing across machines (this PC <-> laptop)
The repo lives on a **private GitHub remote** (`origin`). To sync in either
direction, one command handles it:
```
powershell -File scripts\sync.ps1              # pull --rebase --autostash, then push
powershell -File scripts\sync.ps1 -Message "wip"   # commit tracked changes first, then sync
```
It never clobbers the other machine (rebases local work on top of remote).
Not synced (gitignored, per-machine): `claude-dashboard/data/` (run history,
inbox, tasks, schedules), `.claude/settings.local.json` (permission allowlist),
and anything else in `.gitignore`. Copy `data/` over manually (or via Tailscale)
if you want run history on the other machine. Global `~/.claude/` skills/memory
also live per-machine — the project rules that matter are in-repo (this file +
`CLAUDE.md`).

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
lib/agentgraph.js        run stream → persona-named agent crew graph (hermes runs = Maestro + crew ring)
lib/files.js             upload inbox (vanilla multipart) + zero-dep xlsx preview (/api/files/xlsx)
lib/voice.js             CSM voice: loopback-only proxy /api/voice/tts + /status + /start (spawns sidecar)
index.html               markup shell (token injected at serve time)
assets/app.js            SPA core + Overview/Sessions/Library/Config + ◐ theme toggle
assets/run.js  tasks.js  files.js  graph.js  agentviz.js  assetlib.js  memory.js  voice.js  voicecfg.js  style.css
vendor/                  LOCAL asset library: 18 font faces, Lucide sprite, normalize (manifest.json = sources+licenses)
.claude/skills/          59 active skills (41 pre-ECC + 18 curated ECC); ui-design = the design library
.claude/skills-library/  all 278 ECC skills (MIT, NOT auto-loaded; README = promote/demote recipe)
data/                    runtime: runs/<id>/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
.csm/                    CSM-1B runtime: venv + weights + server.log (~10 GB, gitignored)
docs/roadmap.md          the prioritized plan (single source of truth)
docs/voice-csm.md        CSM voice architecture, measured perf, pins, rebuild recipe
scripts/csm-server.py    CSM-1B TTS sidecar (127.0.0.1:8790; csm-requirements.txt = pinned deps)
scripts/verify-dashboard.ps1   endpoint smoke test (41 checks)
scripts/install-autostart.ps1  user-run logon task
```
Nav order: Run · **Live** · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · **Sources** · Tools · Config.
(`assets/live.js` = Live tab; `assets/sources.js` = Sources tab; `assets/admin.js` = Tools tab; `assets/teams.js` = teams UI on the Agents tab.)
Graph tab: "Agents" live crew view by default (persona names: Maestro/Poet/Dart
models, Scout/Scribe/Wrench/etc tool crews). Codebase map behind a chip, with
its own Modules (file-level, default) / All-symbols sub-views.
`assets/voice.js` = N9 voice module (mic orb, browser+CSM engines, chunked CSM
playback, barge-in); `assets/voicecfg.js` = its Config settings panel (split
out for the 500-line rule; attaches HubVoice.renderSettings via HubVoice._cfg).

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
  gemini-3-flash via nous. H1/H2/H3 SHIPPED (engine selector in the Run
  composer + agent-graph personas, live-verified 2026-07-11); H4 gateway is
  the next build. See `docs/hermes-adoption.md`.
- **Agent roster = curated ~20, NEVER a bulk library** (user, 2026-07-10 late
  eve). 8 live hermes roles (read from config) + 14 hand-picked local
  specialists in `.claude/agents/`, EVERY one with explicit `model:`
  frontmatter (haiku for mechanical, sonnet for build/review, opus only for
  security-auditor/architect). Tier chips on the Agents tab. Do not restore
  the deleted claude-flow catalog.
- **Voice = hermes's job + a hub loop** (user, 2026-07-10 late eve). N9 Track A
  SHIPPED (`assets/voice.js`, browser-native, zero-dep). Track B (hermes
  gateway voice notes) pairs with H4. Full plan: `docs/voice-plan.md`.
- **Sesame CSM-1B = the hub's local neural voice** (user, 2026-07-11 "now").
  Runs natively (Windows + RTX 3060, no WSL2) in gitignored `.csm/`;
  transformers **pinned <5** (5.x babbles — audio-embed weight fails to map,
  whisper-verified both ways); weights from ungated `unsloth/csm-1b` mirror
  (official repo is HF-gated; used first if HF_TOKEN set). Known floor:
  ~0.4× realtime on this GPU → ~6 s to first word via chunked playback; if
  that ever grates, Kokoro/Piper are the faster-but-less-natural fallbacks.
- **ECC skills = curated-active + full library** (user choice, 2026-07-11).
  All 278 from affaan-m/ecc (MIT) live in `.claude/skills-library/` (not
  auto-loaded); 18 curated actives in `.claude/skills/` (activating all would
  tax every run ~15-18k tokens). NO ECC agents adopted (curated-roster rule).
- **The user drives parallel work through the hub's own Run tab** (Fable 5
  acceptEdits runs editing this very repo, often by voice). Before editing,
  check `git status` + `/api/runs` for an active run on the same files —
  reconcile, don't clobber. Hub-run replies must stay SHORT (2-4 sentences)
  because they're spoken aloud (see memory + S25 chunking).
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
- **Permission allowlist for hub runs (blocks execution otherwise).** Hub runs —
  and any auto-mode agent — cannot execute `node` / `curl` / `powershell` / web
  research until these are in `.claude/settings.json` → `permissions.allow`:
  `Bash(node:)`, `Bash(curl:)`, `Bash(powershell:)`, `WebSearch`,
  `WebFetch(domain:github.com)`, `WebFetch(domain:api.github.com)`,
  `WebFetch(domain:raw.githubusercontent.com)`. **An agent can't add these
  itself** — the auto-mode classifier blocks self-widening of execution
  permissions on instruction alone (anti-prompt-injection). The USER must
  hand-edit the file, use `/permissions` in a terminal `claude`, or set the hub's
  run mode to `bypassPermissions`.
- **H4 needs a Telegram bot token** (from @BotFather) — 2 minutes, unblocks the
  phone voice/text bridge.
- Autostart: `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`
  (hub only — the CSM sidecar starts from Config → Voice → ⚡ Start engine).
- Mobile: install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- Q1 Playwright: quick "yes" to install (dev-only) and I'll build the E2E net.
- Housekeeping: `ECC-main.zip` + `ECC-main/` in the repo root are the raw
  download (gitignored; adopted copy is committed) — delete when convenient.
- Optional: accept the `sesame/csm-1b` terms on HF + set HF_TOKEN to pull the
  official weights instead of the mirror.
- Obsidian export (roadmap Q-Obsidian): confirm they want it + give a vault path.

## ⚡ CURRENT STATE (2026-07-12, newest) — Sources library (N11) + crawl4ai intake SKIP
> Newest section — supersedes everything below (kept as history). This session's
> commits: N11 Sources tab (`1151de6`), license verification (`d6ff52c`),
> crawl4ai eval → skip (`c77bf97`), pattern.css URL canonicalize (`36b0062`),
> HANDOFF (`58f3b2d`), intake additions + `declined` status (`135127c`).
> **Both queued hub tasks are now DONE — the task queue (`data/tasks.json`) is
> empty.** Smoke green (added a `/api/sources` check).
>
> **⚠ This repo has NO git remote and never has** (`git remote -v` empty; a prior
> thread confirmed "this repo has no GitHub remote"). The GitHub URLs the user
> provides in threads are repos to *incorporate*, NOT a push target — don't
> conflate them. To push, a remote URL must be supplied (gh CLI isn't installed).
> 7 commits sit local, ready to push once a remote exists.

1. **N11 Sources library SHIPPED.** New **Sources** Library tab
   (`assets/sources.js`) → `/api/sources` (`lib/sources.js`, zero-dep, GET-only).
   A provenance collator: vendored assets read from `vendor/manifest.json` (font
   faces folded to one row per family, icon sprites, CSS — enriched with upstream
   repo links via a `repoMap`) + non-vendored references from a curated
   `lib/sources.json` (adapted skills, agent-tool siblings, queued-to-incorporate).
   Grouped by kind (vendored asset / adapted skill / agent tool / queued) with
   license badges, deprecated/queued status pills, and clickable repo links.
   **27 sources / 15 linked repos.** Nav sits between Assets and Tools. New
   GitHub-intake pulls land in the manifest or `sources.json` and surface here
   automatically. `lib/sources.json` is the one place to keep the non-vendored
   list truthful.
2. **Every source link + license VERIFIED against the GitHub API** (`spdx_id`,
   not README claims). All 15 repo URLs resolve; all 9 curated licenses confirmed.
   Corrections: `browser-use/browser-harness` = MIT; hermes repo located =
   **NousResearch/hermes-agent** (MIT); **`karpathy/llm-council` has NO license
   declared (all rights reserved)** → flagged in-tab with a red badge as an
   incorporation BLOCKER (reference-only until the author adds a license —
   relevant to N10 Council). `pattern.css` URL canonicalized (`bansal-io` →
   `bansal`). NB: Lucide (`NOASSERTION`) and pattern.css (`NO-LICENSE`) in the API
   are just GitHub's classifier failing on non-standard LICENSE files — the
   manifest's ISC / MIT are correct and stand.
3. **crawl4ai intake → EVALUATED, SKIP** (`docs/crawl4ai-evaluation.md`). License
   cleared (Apache-2.0, API-confirmed) but it overlaps Scrapling heavily (both
   Playwright-based, both ship an MCP, both fetch/markdown/crawl). The
   GitHub-intake team's real need — pull *specific* files from a repo/CDN — is
   already met by Scrapling + one-time curl; crawl4ai's edge (LLM-markdown, deep
   crawls, RAG extraction) isn't needed, and a second always-on scraper MCP would
   tax every run's context for zero new capability. **Not installed.** Revisit
   only as an *on-demand CLI* (never an always-on MCP) IF a deep-crawl /
   docs→markdown RAG-ingestion feature is greenlit. Roadmap "GitHubs to
   incorporate" updated with the decision.
4. **Memory/thread sweep → 3 repos added to the Sources intake list.** Swept
   past session transcripts + memory for every GitHub referenced; the only
   *untracked* one was **open-jarvis/OpenJarvis** (user "add this in", Apache-2.0)
   — now in the roadmap + Sources. Also surfaced `zcaceres/markdownify-mcp`
   (MIT, roadmap Q2) and `eyaltoledano/claude-task-master` (**MIT + Commons
   Clause**, source-available — restricts selling; roadmap Q3 declined-as-MCP)
   into Sources. New **`declined`** status (red badge) added; crawl4ai +
   task-master carry it. Sources now 30 entries / 18 repos.
5. **Personas feature FINISHED + LIVE** (`34c0d38`). A parallel hub run had built
   most of it but was blocked (couldn't execute node/curl to verify — see the
   permission-allowlist item above). Completed here: **`lib/personas.js`** →
   `/api/personas` + `/api/personas/active` (swappable personas from
   `personas/<id>.md`, traversal-guarded; `data/personas.json` holds the active
   id, default = Jarvis); **`lib/runs.js`** injects the active persona's directive
   ahead of each Claude run (token-neutral when off); the missing piece I added =
   a **Config → Communication persona** selector (off / Jarvis). Separately, the
   run composer's **✦ Jarvis** toggle (`assets/jarvis.js`) is CLIENT-side
   prompt-buffering + complexity routing — a different layer, same name. Verified
   end-to-end (endpoints, selector, traversal guard, smoke) and the hub was
   restarted so it's live on 5757 (→ phone via Tailscale). ⚠ **The restart also
   loaded `assets/voice.js`, which is a SEPARATE uncommitted change** (voice module
   re-enabled: CSM→browser default, Kokoro opt-in, mobile auto-read) — left
   uncommitted as the user's own in-flight work; commit it separately when ready.

## ⚡ CURRENT STATE (2026-07-12) — Live tab, Assets library, efficiency Overview, GitHub-intake team
> Superseded by the section above (kept as history). This session's
> commits: Tabler+pattern.css vendor (`390bc35`), Bootstrap Icons + browsable
> Assets (`44b6b93`), Pixelarticons + sortable sets (`254b0b9`), Overview
> money→efficiency+context (`eb3f319`), Live tab (`0ce1531`), Live cursor
> (`cfcf3fb`), Teams/GitHub-intake + team-display + bronze (`fd9d0cb`). Smoke green.

1. **Live tab — watch Claude Code run in real time (mobile-first).** New tab
   (`assets/live.js`) tails the newest `~/.claude/projects/…` transcript (ANY
   Claude Code session — hub-launched OR a terminal `claude` in this project),
   polling `/api/sessions` + `/api/session-tail` every 2 s while visible,
   auto-following the tail; session picker + Auto(newest) mode; blinking amber
   cursor while active. **Header ● Live badge** (green pulsing dot) shows
   active/idle from every tab (incl. mobile) and taps through to Live. No new
   endpoint. Verified live streaming its own tool calls at desktop + 375 px.
2. **Assets library = a real, browsable, sortable icon/pattern catalog.** Four
   vendored icon sprites now (all MIT/permissive, LOCAL, zero runtime CDN):
   Lucide 1746 (ISC) · Tabler 5093 · Bootstrap 2078 · Pixelart 877 = ~9.8k
   icons, + pattern.css (14 bg patterns × 4 sizes). `assetlib.js` is
   **manifest-driven**: any `type:icons` entry in `vendor/manifest.json` with a
   sibling `<base>-index.json` auto-surfaces. Assets tab: sticky jump-nav,
   set **toggle**, **sort sets** (name/count/size), per-set icon A→Z/Z→A,
   live result count, pattern size toggle, click-to-copy. `core.js` returns a
   generic `iconSets[]`; `lib/util.js` run hint advertises all four sprites.
3. **Overview = efficiency + context, NO monetary values.** Hero shows
   context-window utilization of the current chat (latest run) vs the model's
   window (all Claude = 200K); "Current chat · analytics" card (model/tier,
   window, tokens in→out, memories, duration, routing reason); efficiency stat
   cards (Success / Routing / Lean-models / Avg run / Active) + model-mix bar
   replace the old $ cards/breakdown. **`runs.js` now captures `result.usage`
   → `tokensIn` (input+cache) / `tokensOut`**, so context analytics fills in for
   all Claude CLI runs going forward (was dropped before → most history has none).
4. **Agent teams: GitHub-intake team is ACTIVE.** `lib/teams.js` BUILTINS gained
   **`github` "GitHub intake"** (agents: scraper, web-researcher, backend-builder,
   json-wrangler, librarian, code-reviewer) — hint steers: eval repo+LICENSE →
   fetch (Scrapling MCP / one-time curl, NO runtime CDN) → vendor locally under
   `vendor/` + update `manifest.json` → review. **It is the currently-selected
   active team** (`settings.active='github'`). The **scraper = Scrapling** (the
   ONLY MCP in `.mcp.json`, `scraper` haiku agent); "774x/774b" the user asked
   about does not exist anywhere in the app.
5. **Active team is now shown on Run / Sessions / Tasks.** `runs.js` records the
   active team name in run `meta.team`; `tasks.js` enrich surfaces it. Displayed
   as: per-run pill in Run history, per-thread pill on Sessions rows (mapped by
   `sessionId`→run), active-team header pill on Sessions + Tasks. (Old runs
   pre-date `meta.team`, so their pills are blank — populates going forward.)
6. **Transcript tool lines dimmed amber→bronze/grey** (`--bronze` var, all
   themes) so Claude's messages (amber accent) read distinctly from tool calls
   in the Live/Overview/Sessions feeds. `KIND_COLOR.tool = var(--bronze)`.
7. **Browser-pane tooling flaky all session:** screenshots + long multi-await
   `javascript_tool` calls TIME OUT on this heavy SPA (esp. after big sprite
   parses) — verification done via single-shot computed-style reads instead
   (reliable). Not an app bug.

## ⚡ CURRENT STATE (2026-07-12, late) — Claude-only pivot + redesign shipped
> This supersedes the dated sections below (kept as history). Mirrors the
> reorganized auto-memory (`engine-claude-only`, `redesign-clean-dark`).

1. **Engine = Claude ONLY.** The versatile/cheap stack is Claude Code's own:
   auto model-routing (haiku/sonnet/opus) + the 14 model-tiered subagents +
   **agent teams** (`lib/teams.js`: Lean default / Excel ops, each injects a
   delegation hint). **hermes was DEPRECATED as too expensive** — not deleted,
   just hidden behind a Config toggle (`settings.hermesEnabled`, default off;
   engine option hidden in the composer, roles off the Agents tab). If ever
   re-enabled it needs a terminal-launched hub (ACP hangs headless →
   `HUB_HERMES_ENGINE=oneshot`); for real hermes work use **Hermes Desktop**.
   ruflo/claude-flow retired long ago. `lib/liveness.js` (orphan reaper + 5s
   heartbeat → ◉ live / ⚠ stalled / process-gone) is engine-agnostic, covers
   Claude runs.
2. **Redesign SHIPPED — clean-dark "amber-agent-orb".** Ported 1:1 from the
   user's Lovable reference (`amber-agent-orb.lovable.app`) by reading its live
   computed styles. Exact tokens (`#0c0b0a` / `#17140f` / amber `#e8a33d`) +
   Bricolage Grotesque / JetBrains Mono / Instrument Serif (all in `/vendor/`).
   Clean-dark is the DEFAULT (◐ toggles warm). Every tab done: Run, Overview
   (Instrument-Serif usage hero + plan-usage bars + stat cards), Agents (tier
   labels + teams), Graph (live crew canvas), list/utility tabs.
3. **New surfaces:** **Tools tab** (MCP connectors / site file-editor / git —
   `lib/admin.js`), **Config → Providers/Council** groundwork (specced, not
   wired), **plan-usage** numbers on Overview (Claude has no usage API →
   user-maintained in Config, `settings.plan`, always-fresh cache-invalidated).
4. **Code health:** `app.js` split (611→347 → `overview.js`+`config.js`),
   `run.js` split (557→471 → `runhistory.js`); every source file back under the
   500-line cap. Files tab gained image thumbnails + day-grouped uploads (R4).
5. **⚠ Parallel-run hazard is real:** the user fires acceptEdits runs from the
   Run tab that commit + leave uncommitted work (one botched a `run.js` refactor
   and broke the Run tab). Before editing: `git status` + check `/api/runs` for
   active runs; reconcile, don't clobber (memory `parallel-hub-runs`).

**Next / not yet wired:** N10 Council mode (Claude-only fan-out + synthesis;
needs `lib/council.js`) and the Providers/Council live-API wiring (paste OpenAI/
Perplexity keys). See `docs/roadmap.md`.

## Current state (2026-07-11, end of session)
All S1–S26 shipped and browser-verified (see roadmap table). **Smoke script
green (41 checks).** This session's commits: all-Claude-versions model picker
(`98774ec`), CSM-1B voice engine (`cd81339`), ECC skills Q4 (`6d6c499`),
H2+H3+N5+N4+N6 batch (`56ab84c`), N2 mobile audit (`2149124`), CSM cutoff/
latency/silent-death fixes (`62ebc7a`), perf docs (`22ad9e7`), handoff (HEAD).

Snapshot of what's true right now:
- **Hermes v0.18.2 OPERATIONAL + IN THE COMPOSER (H2/H3)** — "engine: claude |
  hermes" selector; hermes runs spawn `hermes -z --usage-file` into the same
  history/SSE/cost accounting (live-verified: $0.0557 run). Graph tab shows
  Maestro + crew ring for hermes runs. No resume yet (H2.5: usage.json carries
  a session_id). `/api/hermes` shows **ready**.
- **Voice is TWO engines**: browser speechSynthesis (instant) + Sesame CSM-1B
  local neural (Config → Voice → TTS engine). CSM verified end-to-end and
  then FIXED after live use: the shipped 10 s generation cap caused
  mid-sentence cutoffs (now scales with text), chunked playback brings first
  word to ~6 s (hard floor: ~0.4× realtime on the 3060), spoken text capped
  at 400 chars + "the rest is on screen", and a swallowed audio.play()
  rejection that silently killed replies now recovers. All measured numbers
  in `docs/voice-csm.md`. Sidecar must be running (Config shows a status
  pill + ⚡ Start engine; it does NOT autostart with the hub).
- **Run tab**: every Claude version pinnable (Fable 5 / Opus 4.8/4.7 /
  Sonnet 5/4.6 / Haiku 4.5) alongside auto-routing; ⚖ routing-accuracy chip
  (`/api/routing`) flags over/under-routed auto picks.
- **Skills = 59 active** (41 + 18 curated ECC) with the other 260 ECC skills
  promotable from `.claude/skills-library/` (see its README). Files tab has
  ▦ xlsx sheet/dimension preview; header has ◐ dark/light toggle; all 12 tabs
  clean at 375 px.
- **Agents tab = 22 roster** (8 hermes roles + 14 curated locals with tier
  chips) — unchanged, and the curated-roster rule still stands.
- **Mic capture** works only in the user's real Chrome/Edge (the Browser pane
  sandbox blocks mic — not a bug). Voice-run replies must stay SHORT (TTS).

**Next up (see EXECUTE NEXT above):** H4 gateway + N9 Track B (🙋 Telegram
token) → H2.5 hermes resume → Q1 Playwright (🙋 nod) → N2 real-phone pass
(🙋 Tailscale). Queued (don't build until asked): N7 SharePoint Breakdown,
N8 iPhone.
