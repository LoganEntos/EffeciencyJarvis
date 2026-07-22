# Redesign build brief — for the Hermes crew / Fable 5 build

**Goal:** move the hub's UI to a **clean, minimal, dark** aesthetic while keeping
100% of the current functionality. Design target: the `amber-agent-orb.lovable.app`
mockup (clean-dark version). **Build incrementally — never wholesale-replace
working code.** The mockup shows ~10% of what the app actually does; treat it as
a *look-and-layout reference*, not a source to import.

## Golden rule
The real app already has: Run (claude+hermes engines, SSE streaming, history,
spend, routing chip), Tasks queue, Files inbox + xlsx preview, Sessions, Memory
(Engram), Overview, live Agent Graph, Agents/Skills/Commands/Assets libraries,
voice (browser + local CSM-1B), scheduled runs, supervised self-restart. The
redesign RE-SKINS and RE-ORGANIZES these; it does not remove them.

## Design tokens (the clean-dark / "sleek" theme — already wired)
The `◐` header button toggles **warm (default) ↔ clean-dark** (`data-theme="dark"`).
Tokens are live in `assets/style.css` under `:root[data-theme="dark"]`:

| token | value |
|---|---|
| background | `#0b0b0c` (flat, no amber grid/glow) |
| panels | `#17171a` / `#111113` |
| border | `#1f1f22` |
| text / muted / dim | `#ececec` / `#7a7a7d` / `#55555a` |
| accent (single, sparing) | muted gold `#d4a24c` |
| UI/body font | **Hanken Grotesk** (in `/vendor/`) |
| data/number font | **JetBrains Mono** (in `/vendor/`) |

**Kill "corny":** no editorial/magazine headlines ("Two engines, one throttle"),
no big serif display, no over-designed feel. Plain functional labels
("Overview", "Run"). Generous whitespace, calm, information-first — not busy.

## Metrics overhaul (Overview) — priority order
The current metrics (Runs Today, Total Tokens, Median Latency) are **vanity
counts — replace them.** What matters:
1. **USAGE REMAINING — today & this week (THE hero metric).** On a capped
   subscription this is the #1 scheduling/delegation signal (run now vs defer vs
   delegate to a cheaper tier). Two gauges + burn-rate + projection ("at this
   pace the weekly limit is reached Thursday 14:20"). Wiring real quota is a
   separate task (Claude Code usage file/`/status`; hermes usage via Nous Portal).
2. Where tokens & $ go — split by engine and by hermes tier (main/aux/subagent),
   plus cost-per-task.
3. Bottlenecks — time per step, slowest agent/tool.
4. Wasted work — redundant/failed tool calls, retries, cache misses.
5. Outcome per dollar — first-try success vs rework, at what cost.

## Other screens (see docs/roadmap.md R0–R5 for detail)
- **Agent Graph (hero):** truthfully depict the ACTIVE engine's agents, who's
  live, how they hand off, in a vibrant but restrained web. NOTE the real
  blocker: hermes `-z` one-shot emits no tool telemetry, so a truthful live
  hermes graph needs hermes structured/streaming events first.
- **Run:** clicking a running task shows a live step-by-step DEBRIEF, not just
  "running".
- **Libraries (Skills/Commands/Agents):** real category grouping + search +
  filters + tier badges. Rethink **Assets** — it's design-example fonts/icons
  with no consumer in the app; decide if it earns its place.
- **Sessions:** auto-summary by a cheap model (no manual "summarize" click).
- **Files:** image thumbnails + day grouping.
- **Scheduled tasks are UNTESTED** — fold stress testing into the autopilot loop.

## Reference material (in this repo)
- Current-app mobile screenshots: `claude-dashboard/data/inbox/IMG_2751–2760.png`
  (the Files tab). These show the app AS BUILT — the functionality to preserve.
- Live design target: `https://amber-agent-orb.lovable.app` (clean-dark version).
- This brief is also mirrored into the Files inbox.

## Engine
Hermes is the intended default engine. Optimize + instrument it (R0).
