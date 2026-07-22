# MASTER HANDOFF — Fable 5 Autonomous Continuation of claude-hub

> **Deploy mode:** `bypassPermissions`. Working dir: `C:\Users\logto\Documents\claude-hub`.
> This is a single self-contained work order. Read it top-to-bottom, then execute.
> You have full tool access (Bash/node/curl/powershell/web). Do not ask the user to
> confirm — this prompt IS the authorization. When you finish a unit, commit and move on.

---

## 0. What you are continuing

A **zero-dependency** local Node web app (`claude-dashboard/`) — the user's front end
for working with Claude. Prompt runs with **auto model allocation** (haiku/sonnet/opus
by complexity), live SSE streaming, run history + metrics, a hub-native task queue,
scheduled cron runs, a file inbox, a voice/Jarvis module, semantic memory, and
monitoring tabs. Runs at **http://127.0.0.1:5757**; reachable from the user's phone over
their own Tailscale. **No client/business data. No Power BI. No other product.**

The app is mature: ~30 lib modules, ~30 asset modules, 88+ green smoke checks, a
clean-dark "amber-agent-orb" design ported 1:1 from the user's Lovable reference. Your
job is to **finish the queued work and scale the app** — not rebuild it.

### Architecture (memorize this map)
```
server.js                boot + router + static + /vendor/ + X-Hub-Token guard
lib/util.js              helpers (fs, no-shell spawn, body reader, MODELS allowlist, buildRunHint)
lib/core.js              overview / library / assets / sessions / graph endpoints
lib/runs.js (535⚠) runs-query.js   run engine: spawn claude CLI, SSE, auto-routing, history
lib/tasks.js schedules.js    hub-native task queue + cron → run engine (data/*.json)
lib/agentgraph.js liveness.js  run stream → persona crew graph; orphan reaper + heartbeat
lib/files.js             upload inbox (vanilla multipart) + zero-dep xlsx preview
lib/voice.js             TTS proxy /api/voice/* (loopback-only; CSM/Kokoro sidecar)
lib/distill.js           Jarvis prompt distiller: POST /api/jarvis/distill (Haiku one-shot)
lib/memory.js            Engram semantic memory (typed records, lexical recall, NO vectors)
lib/personas.js teams.js sources.js sharepoint.js projects.js admin.js  tab backends
lib/hermes.js acp.js     hermes engine (DEPRECATED — behind settings.hermesEnabled, off)
index.html               markup shell (token injected at serve time)
assets/*.js style.css    SPA modules (run/jarvis*/voice*/projects*/tasks/files/graph/…)
vendor/                  LOCAL asset library: fonts + 4 icon sprites + css + manifest.json
data/                    runtime (runs/, inbox/, *.json) — gitignored
.claude/skills/          curated active skills; skills-library/ = full 278 ECC set
.claude/agents/          14 model-tiered local specialists
```
Nav tabs: Run · Live · Tasks · Files · Sessions · Memory · Overview · Graph · Agents ·
Skills · Commands · Assets · Sources · Tools · Config · Jarvis · Projects (+ SharePoint).

---

## 1. Non-negotiable ground rules (regressions = failure)

1. **No client/business data** unless a prompt explicitly asks in that conversation.
   SharePoint/M365 is searched from `data/sharepoint-index.json`, never live-enumerated.
2. **App runtime stays zero-dependency** — plain Node built-ins + vanilla JS/CSS. No npm
   deps in the app. Dev-only tooling needs the user's OK. **Never add always-on MCPs**
   (each taxes every run's context; scrapling is the only allowed one).
3. **Localhost only** (127.0.0.1). Never widen the bind, add CORS, or expose publicly.
4. **Every file < 500 lines.** Split before crossing. ⚠ `lib/runs.js` is at **535 —
   already over.** Splitting it is task **F1** below.
5. **Security invariants:** `X-Hub-Token` on all non-GET; CSP-sandboxed artifacts;
   path-traversal guards on every id/file param; argv-array spawns (never shell strings).
6. **Never present outputs as HTML pages/artifacts.** Reports/audits/lists go as plain
   text in the reply or a committed `.md` in `docs/`. The dashboard UI is the exception.
7. **No `$` figures anywhere, ever** (user directive). Metrics are **tokens** (`fmtTok`:
   85 / 12.4k / 1.3M) **+ completion/routing %**. `meta.costUsd` is recorded, never shown.
8. **Read a file before editing. Never commit secrets. No `Co-Authored-By` trailers.**
   Commit at each working, browser-verified stage.
9. **UI work** follows the Design language (§6). Consult `.claude/skills/frontend-design`
   and `.claude/skills/ui-design` first. Distinctive fonts, dominant-color palette, depth,
   one staggered load animation — no AI-slop.
10. **Never kill the process on port 5757** — it hosts your run; killing it orphans you.
    Verify server changes on a throwaway instance: `node claude-dashboard/server.js 5758`.
11. **Parallel-run hazard:** the user fires acceptEdits runs from the Run tab that edit
    THIS repo, often by voice. **Before editing: `git status` + check `/api/runs` for an
    active run on the same files.** Reconcile, never clobber.
12. **Hub voice replies are short** (1–2 short paragraphs — TTS reads them aloud). Detail
    goes in commits/docs, not the spoken reply.

---

## 2. Autonomous agent teams (spawn these; they work in parallel)

Use the `Agent` tool with the named specialists below. **Independent teams launch in a
single message (multiple tool calls) so they run concurrently.** Each team owns a slice of
the codebase and never edits another team's files without a `git status` reconcile.

Every code-producing team ends its unit with the **mandatory pipeline**:
`verify (drive it live on :5758) → scripts/verify-dashboard.ps1 → code-reviewer agent →
commit`. No unit is "done" until smoke is green and the reviewer is clean.

| Team | Agent type | Owns | Charter |
|------|-----------|------|---------|
| **SERVER** | `backend-builder` | `server.js`, `lib/*.js` | Endpoints, run-engine, lib splits, data schemas. Enforce security invariants + <500 lines. F1 (split runs.js) is theirs. |
| **UI** | `ui-designer` | `index.html`, `assets/*.js`, `assets/*.css` | Tabs, components, layout, theme, motion, 375px. Amber-agent-orb tokens only; no speculative Jarvis restyle beyond the queued handoffs. |
| **VOICE** | `ui-designer` (+ VOICE domain) | `assets/voice*.js`, `jarvis*.js`, `lib/voice.js`, `lib/personas.js` | Jarvis conversation engine, orb, personas, distiller. ⚠ Voice CONVERSATION behavior = the `36bd72d` engine (`voiceconvo.js`); Kokoro self-heal + TTS reply queue are sacred — never regress. |
| **INTEGRATIONS** | `backend-builder` | `lib/sharepoint.js`, `sources.js`, `projects.js`, `schedules.js`, `tasks.js` | SharePoint/M365, Sources intake, Projects, cron/queue. New GitHub intakes append to `lib/sources.json` (never bulk-import frameworks). |
| **TOOLING** | `test-runner` + `security-auditor` | `scripts/`, smoke, agents/skills | Keep smoke green, extend it per new endpoint. Security-audit every new endpoint against the threat model. Q1 Playwright is gated on the user's yes. |
| **DOCS** | `doc-scribe` | `docs/`, `HANDOFF.md`, `README.md`, code comments | Sync docs to reality after every landed feature. Update `roadmap.md` + `HANDOFF.md`; keep `improvement-backlog.md` truthful. |
| **REVIEW** | `code-reviewer` | (cross-cutting) | Reviews every diff before commit: correctness, hub-invariant regressions, needless complexity. Blocks the commit on any invariant breach. |

**Escalation:** for a multi-module design decision (a new engine path, a run-engine
rearchitecture, Council orchestration), spawn `architect` FIRST for a plan, then hand the
plan to SERVER/UI. Reserve `architect` and `security-auditor` for genuinely load-bearing
calls — they are expensive.

---

## 3. Workflow — how the teams run without you

For each work item:
1. **Claim** — `git status` + `GET /api/runs`; confirm no active run touches your files.
2. **Read the handoff** in `docs/handoffs/` (each is self-contained, one unit of work).
3. **Build** on a clean tree, dense diffs (not rewrites), files <500 lines.
4. **Verify live** — start a throwaway `node claude-dashboard/server.js 5758`, drive the
   real flow, screenshot if UI. Never touch 5757.
5. **Smoke** — `powershell -File scripts\verify-dashboard.ps1 -Port 5758`; keep green,
   extend it if you added an endpoint.
6. **Review** — hand the diff to the `code-reviewer` agent; fix what it flags.
7. **Commit** — one working stage, plain-language message, no `Co-Authored-By`.
8. **Doc-sync** — DOCS team updates roadmap/HANDOFF; mark the item shipped.

**Parallelism rule:** SERVER, UI, VOICE, INTEGRATIONS can run concurrently only when their
file sets are disjoint. If two need the same file (e.g. `run.js` for both a composer change
and a streaming change), serialize them. The REVIEW + DOCS + TOOLING teams run after each
landed unit, not in parallel with the edit.

---

## 4. The work queue (execute top-to-bottom)

### F1 — Split `lib/runs.js` (535 → <500). **Do this first — it's an invariant breach.**
Follow the `runs-query.js` / `runhistory.js` precedent. Candidate extraction: the SSE
event formatting + artifact-collection helpers, or `routeModel()` + routing heuristics,
into `lib/runs-engine.js` or `lib/routing.js`. Zero behavior change; verify a full
send→stream→history→artifact cycle live before commit. **Owner: SERVER.**

### Queued handoffs (in `docs/handoffs/`, user-ordered 2026-07-17 — read each file)
1. `projects-tab-polish.md` — composer model select, thread-resume clarity, re-render
   churn, ✦ distiller toggle, 375px, empty-state. **UI + INTEGRATIONS.**
2. `jarvis-chat-parity.md` — chat-first panel (transcript tail → collapsed strip), ▷
   run-this in-tab, spoken replies, file attach. **VOICE.**
3. `voice-orb-live.md` — mic-driven orb waveform, real rtt, ◐ think → extended thinking,
   timeline dots jump. **VOICE.** (Real-mic pass is a user action — flag it.)
4. `persona-manager-ui.md` — delete/rename/reorder/＋new on persona cards (backend live
   since `1fb6cd4`). **VOICE.**
5. `schedules-verify.md` — schedules UI polish + the **R5 stress test** (create a
   near-future schedule, assert it fires + lands in run history, tear down). **INTEGRATIONS
   + TOOLING.**
6. `distill-latency.md` — optional, last. **SERVER.**

### Then the roadmap queue (`docs/roadmap.md` → DO NEXT)
- **N2** mobile ergonomic pass — every tab at 375px, touch targets, composer, overflow. **UI.**
- **R3** auto session summaries — cheap-model (haiku) scans each session on close, caches
  an exact debrief; no manual "summarize" click. **SERVER.**
- **R4** Files: image thumbnails + day grouping. **UI + SERVER.**
- **N8** iPhone polish — Tailscale PWA already live; ergonomic finish. **UI.**
- **N4** routing-accuracy feedback loop — tune `routeModel()` thresholds from real
  outcomes. **SERVER.**
- **N10 Council mode — LOWEST priority, build last if ever** (user call 2026-07-15).
  Blocked until `runs.js` is split (F1 helps). Needs `lib/council.js` + `assets/council.js`.

---

## 5. Decision frameworks

**Roadmap prioritization** — ship the item that makes every later item cheaper/better
first (token efficiency is the north star). Order: (1) invariant breaches (F1), (2)
user-ordered queued handoffs, (3) verify-the-unverified (R5, real-mic, 375px), (4) roadmap
DO-NEXT, (5) deferred/Council last. When two items tie, pick the one the user has waited on
longest or that unblocks the most downstream work.

**Architecture choices** — default to the zero-dep, in-hub-stack native port. Do NOT drop
foreign frameworks in wholesale (the hermes lesson — adopted then deprecated as too
expensive). A new dependency must clear: (a) is it dev-only with no per-run token tax? (b)
does it avoid an always-on MCP? (c) does it earn its complexity vs a 50-line native
version? If any answer is no, port the idea, not the package. GitHub links the user gives
are repos to **incorporate natively** (→ `lib/sources.json`), not push targets.

**When to spawn an agent vs do it inline** — inline for a single-file <50-line change;
spawn a team when the unit spans multiple files, needs isolated verification, or benefits
from an independent reviewer. Spawn `architect`/`security-auditor` only for load-bearing
design/security calls.

**When stuck** — if a task is blocked on a user action (real-mic test, Playwright yes,
Lovable design delivery, permission allowlist), record it in `HANDOFF.md → Pending USER
actions`, skip it, and take the next unblocked item. Never stall the whole queue on one
gate.

---

## 6. Design language (ALL UI work)

Clean-dark "amber-agent-orb" is the default. Tokens: `#0c0b0a` / `#17140f` / amber
`#e8a33d` (in `:root[data-theme="dark"]` in `style.css`); ◐ toggles warm/light. Fonts:
**Bricolage Grotesque / JetBrains Mono / Instrument Serif** (all vendored at `/vendor/`).
- **Typography:** distinctive fonts only — never Inter/Roboto/Arial/system defaults, never
  reflex Space Grotesk. Extreme weights (100/200 vs 800/900), 3x+ size jumps.
- **Color:** one cohesive aesthetic, dominant color + sharp accents. CSS vars for
  everything. Banned: purple gradient on white.
- **Motion:** one orchestrated page-load with staggered `animation-delay` reveals,
  CSS-only, `prefers-reduced-motion` respected.
- **Backgrounds:** layered depth (gradients, subtle geometry), never flat fills.
- State the design intent before coding it. Consult `.claude/skills/ui-ux-pro-max` and
  `ui-design` for palettes/pairings.

---

## 7. Pending USER actions (remind, you can't do these)
- **Permission allowlist / `bypassPermissions`** for hub runs to execute node/curl/psh/web.
- **Real-mic pass** on wake-word "Jarvis" + the voice-orb waveform.
- **Q1 Playwright** — a "yes" unblocks the dev-only E2E net (no run tax).
- **Deliver the final Lovable Jarvis-tab design** to unblock any deeper Jarvis restyle.
- **Mobile:** Tailscale serve + PWA install; **Autostart:** `scripts\install-autostart.ps1`.

---

## 8. Definition of done (the north star you build toward)
A token-efficient, voice-capable local cockpit where (1) every prompt lands on the cheapest
capable model; (2) work runs by typing OR talking, on desktop and phone; (3) the whole
system is observable (runs, spend-as-tokens, live agent graph, memory); (4) it survives
regressions (green smoke + Playwright once approved); (5) every file is <500 lines, zero
app deps, all security invariants intact. Ship toward that, one verified commit at a time.
