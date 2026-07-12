# AGENTS.md — rules for any agent working in this repo (hermes, etc.)

You are working in **Claude Code Hub** (`claude-dashboard/`): a zero-dependency
local web app that is the user's front end for working with Claude — prompt runs
with automatic model allocation, live SSE streaming, run history, a file inbox,
tasks, schedules, memory, and monitoring tabs. This repo is ONE thing. There is
**no Power BI, no client data, no other product** here — never invent or
reference such work.

> Read `HANDOFF.md` first for current state, then `docs/roadmap.md` for the plan.
> The full rules live in `CLAUDE.md`; this file is the short, binding version.

## Hard rules (do NOT violate — these protect a working system)

1. **App runtime stays zero-dependency.** Plain Node built-ins + vanilla JS/CSS
   only. NO npm packages added to the app. Dev-only tooling (a test runner, etc.)
   needs the user's explicit OK before any install.
2. **Localhost only.** The server binds `127.0.0.1`. Never widen the bind, add
   CORS, or expose it publicly. Remote access is the user's own Tailscale — never
   a tunnel you create.
3. **Every file stays under 500 lines.** Split a module before it crosses 500.
4. **Security invariants — never regress:**
   - per-boot `X-Hub-Token` required on ALL non-GET requests;
   - run artifacts served under a CSP sandbox;
   - path-traversal guards on every id/file parameter;
   - spawn processes with an **argv array, never a shell string** (no shell
     interpolation).
5. **No client/business data.** Never read, fetch, or process the user's business
   data unless explicitly asked in that conversation. Don't call M365/SharePoint.
6. **Never present output as an HTML web page/artifact.** Reports, audits,
   improvement lists, and status go in the chat reply as concise plain text, or —
   when they must persist — as a plain Markdown doc in `docs/`. Do NOT build
   styled HTML pages to present findings. (The dashboard's own UI is the product
   and is exempt.)
7. **Read a file before editing it. Never commit secrets.**
8. **Verify in a real browser and run the smoke script before committing.** Commit
   at each working, browser-verified stage. Do NOT add `Co-Authored-By` trailers.
9. **UI/redesign work = edit the REAL source in place** (`claude-dashboard/assets/*.js`,
   `assets/style.css`, `index.html`, the tab renderers). Do NOT create standalone
   or "preview" HTML mockups — the change must be visible live at
   `http://127.0.0.1:5757`. For UI, follow the anti-"AI slop" design language in
   `CLAUDE.md` (distinctive fonts — never Inter/Roboto/Arial/system; dominant-color
   palettes; depth, not flat fills; one staggered load animation).

## Coordination (important)

This repo is **also edited by Claude Code and by the hub's own run engine**.
Before editing, check `git status` and reconcile — don't clobber concurrent work.
Commit small, working stages so parallel agents can rebase cleanly.

## Architecture (detail in `claude-dashboard/README.md`)

- `claude-dashboard/server.js` — boot + router + static + `/vendor/` + token guard
- `claude-dashboard/lib/*.js` — server modules: `util` `core` `runs` `hermes`
  `acp` `liveness` `artifacts` `files` `tasks` `schedules` `memory` `agentgraph`
  `voice`
- `claude-dashboard/assets/*.js` + `style.css` — the vanilla-JS SPA
- `claude-dashboard/vendor/` — LOCAL asset library (fonts/icons/css); prefer
  `/vendor/` over CDNs in any generated UI (external CDNs are CSP-blocked)
- `claude-dashboard/data/` — runtime state (gitignored)

## Run + verify

```
node claude-dashboard/server.js            # http://127.0.0.1:5757 (port arg optional)
powershell -File scripts/verify-dashboard.ps1 -Port 5757   # smoke test — keep it GREEN
```

Extend the smoke script with every new endpoint. If tests fail, say so with the
output — don't claim done until it's browser-verified and the smoke script passes.
