# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` (the plan) and `docs/improvement-backlog.md`
(the live find-fix list). Work happens in **this repo**
(`C:\Users\logto\Documents\claude-hub`).

## What this is (30 seconds)
A **zero-dependency** local Node web app that is the user's front end for working
with Claude: prompt runs with **automatic model allocation** (haiku/sonnet/opus by
complexity), live SSE streaming, run history + metrics, a task queue the hub works
through itself, scheduled runs, a file inbox, a voice module, and monitoring tabs.
The user drives it in the browser at **http://127.0.0.1:5757** (and from a phone
over their own Tailscale). No client/business data, no Power BI — just the hub.

## Run it
```
"C:\Program Files\nodejs\node.exe" claude-dashboard\server.js        # port 5757 (arg overrides)
powershell -File scripts\verify-dashboard.ps1 -Port 5757             # smoke test — keep green
```
Never block on the server from Bash — start it detached or from a terminal. Some
engines (hermes ACP) only work when the hub is **terminal-launched**, not headless.

## Ground rules (non-negotiable)
1. **No client/business data** without an explicit prompt in that conversation. M365/SharePoint indexes are searched from `data/sharepoint-index.json`, never live-enumerated.
2. **App runtime stays zero-dependency** — plain Node built-ins + vanilla JS/CSS. Dev-only deps (e.g. Playwright) are fine with the user's OK. Installs are allowed to enhance the hub, but **token efficiency governs**: prefer zero-dep, never add always-on MCPs (each one taxes every run's context — scrapling is the only one).
3. **Localhost only** (127.0.0.1). Never widen the bind, add CORS, or expose publicly. Remote = the user's own Tailscale, never a tunnel you create.
4. **Every file < 500 lines.** Split before crossing.
5. **Security invariants** (don't regress): `X-Hub-Token` on all non-GET; CSP-sandboxed artifacts; path-traversal guards on every id/file param; argv-array spawns (no shell).
6. **Never present outputs as HTML pages/artifacts.** Reports/audits/lists go in the chat reply as plain text, or as a committed `.md` in `docs/`. The dashboard's own UI is the exception (that IS the product).
7. **Read a file before editing. Never commit secrets. No `Co-Authored-By` trailers.** Verify in a real browser + run the smoke script before committing; commit at each working stage.
8. **UI work:** consult `.claude/skills/ui-design` + the Design-language section in `CLAUDE.md` (distinctive fonts, dominant-color palette, depth, one staggered load animation — no AI-slop).
9. **Parallel-run hazard is real:** the user fires acceptEdits runs from the Run tab that edit this very repo (often by voice). Before editing, `git status` + check `/api/runs` for an active run on the same files — reconcile, don't clobber.

## Architecture
```
server.js                boot + router + static + /vendor/ + X-Hub-Token guard
lib/util.js              shared helpers (fs, no-shell spawn, body reader, MODELS allowlist)
lib/core.js              overview / library / assets / sessions / graph endpoints
lib/runs.js  runs-query.js   run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js schedules.js    hub-native task queue + cron → run engine (data/*.json)
lib/agentgraph.js liveness.js run stream → persona crew graph; orphan reaper + heartbeat
lib/files.js             upload inbox (vanilla multipart) + zero-dep xlsx preview
lib/voice.js             TTS proxy /api/voice/* (loopback-only; spawns CSM/Kokoro sidecar)
lib/memory.js            Engram semantic memory (typed records, lexical recall, NO vectors)
lib/sources.js sharepoint.js admin.js personas.js teams.js   Sources tab / SharePoint / Tools / personas / agent teams
index.html               markup shell (token injected at serve time)
assets/*.js  style.css   SPA modules (app/run/tasks/files/graph/agentviz/memory/voice/…)
vendor/                  LOCAL asset library: fonts + 4 icon sprites (~9.8k) + css + manifest.json
.claude/skills/          curated active skills; skills-library/ = full 278 ECC set (not auto-loaded)
.claude/agents/          14 curated model-tiered local specialists (never a bulk library)
data/                    runtime: runs/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
docs/roadmap.md          the plan · improvement-backlog.md the live find-fix list · jarvis-soul.md the persona
```
Nav: Run · Live · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Sources · Tools · Config (+ SharePoint).

## Current truth (2026-07-14)
- **Engine = Claude ONLY.** The stack is Claude Code's own: auto model-routing +
  14 model-tiered subagents + agent teams (`lib/teams.js`). **hermes is DEPRECATED
  as too expensive** — not deleted, hidden behind `settings.hermesEnabled` (default
  off); for real hermes work use Hermes Desktop. ruflo/claude-flow retired long ago.
- **Design = clean-dark "amber-agent-orb"**, ported 1:1 from the user's Lovable
  reference. Tokens `#0c0b0a` / `#17140f` / amber `#e8a33d`; Bricolage Grotesque /
  JetBrains Mono / Instrument Serif (all vendored). Clean-dark is the default; ◐
  toggles warm/light. All tabs done.
- **Voice** has three TTS engines: browser speechSynthesis (default, instant),
  Kokoro-82M (fast, `.kokoro/` sidecar), and Sesame CSM-1B (most natural but ~6 s
  first word on the 3060, `.csm/` sidecar). Sidecars are gitignored, started from
  Config → Voice → ⚡ Start engine; they do NOT autostart with the hub.
- **Memory** = `lib/memory.js` semantic-over-vectors: auto-captures runs, opt-in
  "◇ memory recall" toggle injects top-3 memories into a prompt (default off).
- **Git:** a private remote now exists (`origin` →
  `github.com/LoganEntos/EffeciencyJarvis.git`). `scripts/sync.ps1` does
  pull-rebase-then-push. `data/`, `.claude/settings.local.json`, and the sidecar
  dirs are gitignored (per-machine). The user drives push; don't push unprompted.

## Latest work shipped (2026-07-14)
The **C1–C13 code-health** round (split `runs.js`/`run.js`/`graph.js`, shared the
MODELS allowlist, extracted duplicated builders) and the **U1–U13 UI/a11y** round
(keyboard-reachable nav via a MutationObserver, Lucide-sprite nav icons, segmented
voice-engine control, page-title scale, focus management, aria-live badges,
WCAG-contrast label lift, amber runbar selects) are all done — see
`docs/improvement-backlog.md` (every C/U item marked ✅). Smoke green.

## EXECUTE NEXT
The 2026-07-14 find-fix round is **fully closed** (Fable 5 pass, same day): all
15 P1/P2/P3 items are ✅ in `docs/improvement-backlog.md` — 6 were already fixed
by the C/U rounds, 9 fixed in the pass (rungauge.js split, mobile-voice probe +
pointer-based `isMobileDevice()`, token-count, sessionModel scan, inbox rmdir…).
**N7 SharePoint Breakdown SHIPPED** the same day: offline navigable tree under
the SharePoint tab (index/tree + index/browse endpoints), file Open via
SharePoint's own viewers, Pull to inbox, graphify-on-Opus with a last-run stamp.
Next work comes from `docs/roadmap.md` — nothing is queued in the backlog.

Queued (do NOT build until the user greenlights): **N10 Council mode** (Claude-only
fan-out + synthesis, `lib/council.js`), **N7 SharePoint Breakdown** (file-level
index, first sweep by Fable 5), **N8 iPhone** (Tailscale PWA). See `docs/roadmap.md`.

## Pending USER actions (remind them; you can't do these)
- **Permission allowlist for hub runs.** Auto-mode agents can't self-widen execution
  perms (anti-injection). For hub runs to execute `node`/`curl`/`powershell`/web, the
  user must set the run mode to `bypassPermissions` (the current default) or hand-add
  the `Bash(…)`/`WebSearch`/`WebFetch(...)` entries in `.claude/settings.json`.
- **Mobile:** install Tailscale (PC + phone), `tailscale serve --bg 5757`, bookmark the URL.
- **Autostart:** `powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1`.
- **Q1 Playwright** (dev-only, no run tax): a quick "yes" and the E2E net gets built.
- Housekeeping: `ECC-main.zip` + `ECC-main/` at the repo root are the gitignored raw
  download (adopted copy is committed) — delete when convenient.
