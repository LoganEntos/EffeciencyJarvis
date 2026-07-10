# Claude Code Hub — Project Instructions

> **New session? Read `HANDOFF.md` first** — current state, ground rules, and the
> ordered list of what to build next. `docs/roadmap.md` has the full plan.

This repo is ONE thing: a zero-dependency local web app (`claude-dashboard/`)
that is the user's front end for working with Claude — prompt runs with
automatic model allocation (haiku/sonnet/opus by task complexity), live SSE
streaming, run history with metrics and artifacts, a file inbox, and
monitoring tabs. There is NO Power BI, no client data, and no other product
in this repo. Never invent or reference Power BI/TMDL/semantic-model work here.

## Hard rules

- **No client/business data.** Never read, fetch, or process the user's
  business data unless explicitly prompted in that conversation.
- **Zero npm dependencies** in the app. Plain Node (built-ins only) + vanilla
  JS/CSS single-page UI. Dev-only tooling (e.g. a test runner) may be proposed
  but needs the user's explicit OK before any install.
- **Localhost only.** The server binds 127.0.0.1. Never widen the bind, add
  CORS, or expose it publicly. Remote access happens via the user's own
  Tailscale, never via tunnels you set up.
- **Keep every file under 500 lines.** Split modules before they cross it.
- **Security invariants** (do not regress): per-boot `X-Hub-Token` required on
  all non-GET; artifacts served with CSP sandbox; path-traversal guards on all
  id/file params; no shell-interpreted spawns (argv arrays only).
- ALWAYS read a file before editing it. NEVER commit secrets.
- Commit at each working, browser-verified stage. No Co-Authored-By trailers.

## Architecture (see claude-dashboard/README.md for detail)

- `server.js` — boot + router + static + token guard
- `lib/util.js` `lib/core.js` `lib/runs.js` `lib/files.js` `lib/tasks.js` — server modules
- `assets/app.js` `run.js` `tasks.js` `files.js` `graph.js` `style.css` — SPA modules
- `data/` — runtime (runs history, inbox, tasks.json), gitignored
- `.claude/skills/ui-design/` — zero-dep design library; consult it for any UI
  work (font pairings, palettes, anti-slop rules)
- Start: `node claude-dashboard/server.js [port]` (5757 default; launch.json
  has `claude-dashboard` 5757 and `claude-dashboard-alt` 5758)
- Smoke test: `scripts/verify-dashboard.ps1 [-Port]` — keep it green and
  extend it with every new endpoint

## Design language (from Anthropic's frontend-aesthetics cookbook — follow for ALL UI work)

Claude converges on generic "AI slop" design without explicit pressure. When
building or restyling any UI in this repo (the hub itself, artifacts, mockups):

- **Typography**: distinctive fonts, never Inter/Roboto/Arial/Open Sans/Lato/
  system defaults (and don't reflex-pick Space Grotesk). Pair with high
  contrast (display + mono, serif + geometric sans). Use extreme weights
  (100/200 vs 800/900) and 3x+ size jumps, not timid 400-vs-600 steps.
- **Color**: commit to one cohesive aesthetic; dominant color + sharp accents
  beats evenly-distributed palettes. CSS variables for everything. Draw from
  IDE themes / cultural aesthetics. Banned cliché: purple gradient on white.
- **Motion**: one well-orchestrated page-load with staggered reveals
  (`animation-delay`) beats scattered micro-interactions. CSS-only.
- **Backgrounds**: depth and atmosphere (layered gradients, subtle geometric
  patterns), never flat solid fills.
- Make context-specific, unexpected choices; state the design intent before
  coding it.

## Working style

- The user gives "vibe code" feedback — plain-language impressions of what
  looks/feels wrong. Translate into concrete UI/UX work, browser-verify with
  screenshots, iterate.
- Roadmap lives in `docs/roadmap.md` — check it before proposing work (avoid
  re-doing or re-proposing done/deferred items), update it after shipping.
- Verify in a real browser before claiming done; run the smoke script before
  committing.
