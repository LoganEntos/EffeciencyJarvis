# HANDOFF — Claude Hub  ⭐ START HERE

Read this first, then `docs/roadmap.md` — the ONE canonical status + plan doc.
Work happens in **this repo**:
`C:\Users\Logan Barker\Desktop\claudecodeproject\EffeciencyJarvis`

**Doc map** (there are only four files you need; everything else in `docs/` is
reference or history):
| File | Answers |
|------|---------|
| `AGENTS.md` | the short, binding rules — read if you read nothing else |
| `CLAUDE.md` | the same rules in full, plus the design language |
| `HANDOFF.md` (this) | what is true right now, and what's blocking |
| `docs/roadmap.md` | what to build next |

`docs/archive/` is history — never a source of current truth. Handoffs in
`docs/handoffs/` are live work orders; resolved ones move to
`docs/archive/handoffs/`.

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
lib/runs.js  runs-engine.js  runs-query.js   run engine: spawn claude CLI, SSE, auto-routing, history, artifacts
lib/tasks.js schedules.js    hub-native task queue + cron → run engine (data/*.json)
lib/agentgraph.js liveness.js run stream → persona crew graph; orphan reaper + heartbeat
lib/files.js             upload inbox (vanilla multipart) + zero-dep xlsx preview
lib/voice.js             TTS proxy /api/voice/* (loopback-only; spawns CSM/Kokoro sidecar)
lib/distill.js           Jarvis prompt distiller: POST /api/jarvis/distill (Haiku one-shot)
lib/memory.js            Engram semantic memory (typed records, lexical recall, NO vectors)
lib/sources.js sharepoint.js admin.js personas.js teams.js   Sources tab / SharePoint / Tools / personas / agent teams
index.html               markup shell (token injected at serve time)
assets/*.js  style.css   SPA modules (app/run/tasks/files/graph/agentviz/memory/voice/…)
vendor/                  LOCAL asset library: fonts + 4 icon sprites (~9.8k) + css + manifest.json
.claude/skills/          curated active skills; skills-library/ = full 278 ECC set (not auto-loaded)
.claude/agents/          18 curated model-tiered local specialists (never a bulk library)
data/                    runtime: runs/, inbox/, tasks.json, schedules.json, memory.json (gitignored)
docs/roadmap.md          THE canonical status+plan doc · jarvis-soul.md the persona · archive/ history
docs/handoffs/           live work orders for hub runs (resolved ones → docs/archive/handoffs/)
```
Nav: Run · Live · Tasks · Files · Sessions · Memory · Overview · Graph · Agents · Skills · Commands · Assets · Sources · Tools · Config (+ SharePoint).

## Current truth (2026-07-28)

**Git: fully pushed and versioned (2026-07-28, user-directed).** `master` on
GitHub is current; the pre-marathon checkpoint is preserved as branch
`checkpoint-2026-07-24-known-good`; the tip is tagged **`v1.0.0`** (first
versioned release — cleanup + Health tab + README rewrite + VPP pairing).
Versioning is now in use: tag stable milestones (v1.x.y), keep historical
checkpoints as named branches. The user still drives pushes — don't push
unprompted.

- **The autonomous loop is OFF, deliberately** (2026-07-27). Autopilot toggle
  off and the seeded scout schedule disabled. It had been dispatching unattended
  opus runs every ~5 min, saturating both run slots (`MAX_ACTIVE = 2`) so user
  prompts queued for minutes or were refused outright, and committing to the
  repo while the user was trying to debug it. Re-arm from Config only
  deliberately, and not while doing hands-on work.
- **Auth is resolved** — the CLI on this node is logged in; runs spawn and
  complete normally. (Older notes saying hub runs end "Not logged in" are stale.)
- **The front-end chat reset is FIXED** (`b866cfa`). Threads now survive
  sequential prompts, a Jarvis tab re-render, and a full page reload; a
  cancelled run stays resumable. Session ids are claimed from the `system/init`
  event and persisted per surface (`hub.sess.jarvis` / `hub.sess.run`). Verified
  live on :5758, smoke 98/98.
- **The `ClaudeCodeHub` scheduled task had a rogue 5-minute repetition —
  removed 2026-07-27.** `scripts/install-autostart.ps1` only ever creates an
  `-AtLogOn` trigger; a `PT5M / P3650D` time trigger had been added outside the
  script (most likely by an autonomous run). Every 5 minutes it launched a
  second `node server.js`, which spent **10 seconds** retrying the bind
  (`server.js` retries EADDRINUSE 40× at 250 ms) before exiting 1 — flashing a
  console window each time, and, more damagingly, running a live second hub
  whose boot-time `reapOrphans()` swept with an empty `active` map and rewrote
  the real hub's in-flight runs to `error + orphaned`. That was the source of
  the corrupted run history and the duplicate autopilot retries. The `hubPid`
  guard in `b866cfa` neutralizes the damage; removing the trigger stops the
  spawning. Task now fires at logon only; crash recovery still comes from its
  own `RestartCount 3 / 1-min` setting. **If a 5-minute repetition ever
  reappears on that task, an agent put it there — take it back off.**
- **Known-good invariants as of today:** no file over 500 lines (largest:
  `components.css` 482), zero npm deps, `127.0.0.1` bind only, all JS files
  parse, index.html script wiring is a 1:1 match with `assets/`.

- **Engine = Claude ONLY.** The stack is Claude Code's own: auto model-routing +
  18 model-tiered subagents + agent teams (`lib/teams.js`). **hermes is DEPRECATED
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


## Latest work shipped

**2026-07-28 — contamination cleanup + Health tab.** (1) Quarantined a 15-file
foreign "Personal Jarvis"/crypto-trading package out of `data/inbox/` into a
gitignored `_quarantine-personal-jarvis-package/`; repo-wide re-scan clean;
doc-staleness fixes (`2e859e0`,`f763ca1`,`dfc5584`; record in
`docs/archive/cleanup-2026-07-28-contamination.md`). ⚠ **Open user decision:**
the Claude Flow V3 leftover in `.claude/helpers/` + `settings.json` can't be
auto-purged while the statusline live-references `statusline.cjs`. (2) New
**Health tab** (Monitor group): `lib/health.js` + `assets/health.js` surface
unassigned inbox files (inline delete + move-into-project), doc health, live
size guard + orphan check, active/dormant skills, backlog — all read-only from
disk (`1b42358`,`5a1b92f`,`8aef9b2`). Goes live on the next hub restart.

**2026-07-27 — stability pass (`b866cfa`).** Fixed the "chat resets after every
prompt and is incoherent" P0. Four independent faults, all in continuity, none
in the `--resume` plumbing (which was verified working): (1) `jarvischat.js`
kept no transcript log, so the Jarvis tab's wholesale re-render destroyed the
conversation — it now mirrors entries into `S.log` and replays on mount, as
`projectchat.js` already did; (2) the session id lived only in memory while
`app.js` reloads the page on a stale per-boot token, so every hub restart
started a cold session — now persisted per surface; (3) the session id was
claimed only from the terminal `result` event, so any cancel / stream drop /
restart left the thread unresumable (every cancelled run before today has
`sessionId: null`) — now claimed from `system/init`; (4) `buildRunHint`'s ~2.9k
chars rode in the user turn of *every* prompt including resumed ones, stacking N
copies against the user's words — resumed turns now get a 155-char continuation
note. Plus: the orphan reaper had no ownership check, so a second hub instance
(the throwaway :5758 verify server) reaped the live hub's in-flight runs and
drove duplicate retries — runs now carry `hubPid` and only their owner reaps
them.

**2026-07-25/26 marathon (21 commits, full log: `docs/archive/autonomy-log-2026-07-26.md`):**
loop hardening C14–C18 (`90c7b92`) → chat items 4+5, persona system-layer,
schedules polish, five size-guard splits → adversarial review fixes C25–C27
(`cba2e9e`) → scout rounds found + fixed C28–C33/U14–U17 (`00ebbe0`,`80f3157`),
incl. two crash-class stream guards and the schedule-continuation stacking fix.
Backlog fully burned; size guard clear; smoke 100-check green.
Everything older is archived verbatim in `docs/archive/handoff-shipped-log-2026-07.md` and `docs/archive/roadmap-2026-07-19-full.md`.

## What's next

**→ PRIMARY WORKSTREAM (user directive 2026-07-28): the VPP front-end
workflow.** Make the hub reliable for high-volume VPP PDF→CSV order processing —
scoped to **Inbox · Projects · Run** only; token viz / broad UI polish /
orchestrator work are deferred. Directive: `docs/vpp-frontend-cleanup-plan.md`
(the user's own words). Work order: `docs/handoffs/vpp-frontend-workflow-2026-07-28.md`
— starts with a plan-before-code pass (README rewrite + PDF↔CSV pairing model).
Status map of what's already done vs missing is in that handoff. **Fire it next.**

`docs/roadmap.md` remains the broader status doc (NOW queue: N2 mobile pass, N8
iPhone polish; pending USER verifications: real-mic, persona-card, Q1 Playwright)
— but the VPP workstream above takes priority until the core flow is stable.
