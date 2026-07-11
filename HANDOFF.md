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
Nav order: Run · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Config.
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
