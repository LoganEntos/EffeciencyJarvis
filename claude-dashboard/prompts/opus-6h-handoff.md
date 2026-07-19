# Autonomous improvement run — handoff from Fable 5 (2026-07-19)

Authored by Fable 5 after reviewing the repo at commit `ef347b2` (god prompt on
opus runs + ULTRA CODE effort tiers shipped today; Jarvis chat parity, live
voice orb, and the persona manager shipped earlier this session). You are an
Opus run dispatched by the hub — the Fable 5 playbook is already in your
system prompt; work to it. A Fable 5 orchestrator checks in hourly: it reads
`docs/autonomy-log-2026-07-19.md` and run history, and dispatches the next
worker when you finish. You are not the last run of the night — leave the tree
clean and the log honest.

## Mission

Work the queue below top-down for as long as your run lasts. One item at a
time, browser-verified, committed, logged. Do not bundle items into one
commit. If an item turns out to be blocked or bigger than it looks, write that
in the log with what you learned and move to the next — an honest skip beats a
half-landed feature.

## Non-negotiable context (supersedes anything stale you find in docs/)

- Claude is the ONLY engine. hermes is deprecated/hidden — do zero hermes work,
  even where roadmap items (R0/R1) still mention it. Reinterpret those items
  Claude-only.
- NEVER display dollar costs anywhere in the UI. Tokens + completion/routing %
  are the metrics. `meta.costUsd` stays recorded but never shown.
- All CLAUDE.md hard rules: zero npm deps, files under 500 lines, localhost
  bind only, X-Hub-Token on every non-GET, path-traversal guards, argv-array
  spawns only, no secrets in commits, no Co-Authored-By trailers.
- The design language is the shipped clean-dark amber theme (#0c0b0a / #e8a33d,
  Bricolage Grotesque + JetBrains Mono + Instrument Serif, /vendor/ assets, no
  CDNs). Match it; consult .claude/skills/ui-design for anything new.
- Jarvis spoken replies stay under ~1 minute, casual, no jargon — don't touch
  the persona layer-1 contract.
- Do not push to origin. Local commits only; the user drives push.

## Work queue (top-down)

1. **R3 — auto session summaries.** Sessions must stop requiring a manual
   "summarize with Claude" click. A cheap haiku pass writes a short debrief for
   each session that lacks one (on session close or a low-frequency batch
   sweep), cached on disk so it never re-summarizes. Follow the shape of
   lib/distill.js for the child-process call. Acceptance: open the Sessions
   view, every listed session shows a summary with zero clicks, smoke green.

2. **R4 — Files tab: image thumbnails + day grouping.** Uploaded images render
   as visible thumbnails (you must be able to see what context the AI was
   given), and the inbox list groups by upload day. Serve thumbnails through
   the existing file-serving path with its traversal guards — no new static
   roots. Acceptance: browser shows thumbnails + day headers with 10+ files.

3. **R2 — navigable libraries.** Skills (~59), Commands, and Agents tabs get
   search + grouping/sorting so they stop being flat dumps. One consistent
   filter UI across the three. Acceptance: typing in the filter narrows lists
   live; groups collapse/expand; no layout drift from the design language.

4. **Council + Providers panels.** The Lovable port left these two panels
   unwired (see memory/redesign notes). Either wire them to real data
   (Providers: the models/engines actually available; Council: hide it —
   roadmap N10 deprioritized it) or remove the dead chrome cleanly. A dead
   panel that looks alive is worse than no panel.

5. **N4 — Schedules UI polish.** Surface what the backend already records:
   nextDue countdown, lastRun status chip linking to the run, enabled toggle
   state made obvious. Also surface the new `meta.effort` and `meta.fable5`
   badges on run-history rows so ULTRA CODE / god-prompt runs are identifiable.

6. **N2 — mobile ergonomic pass.** The hub is used from a phone over Tailscale
   (PWA). Sweep the main tabs at 375px: tap targets, overflow, the runbar
   selector row wrapping, composer usability. CSS-only where possible.

7. **Stretch — Overview efficiency (R0 reframed, Claude-only).** Real token
   metrics: tokens by model tier per day, burn rate, completion %. Tokens and
   percentages ONLY — no dollars, no remaining-quota guesswork (quota wiring
   is a separate future step).

## Per-item loop

1. Read the actual modules involved before editing (files under 500 lines —
   split before crossing).
2. Build. Browser-verify on your own throwaway instance: start
   `node claude-dashboard/server.js 5759` (alt port — 5757 is the user's live
   server, leave it alone), check the change, then STOP that process. Never
   leave orphan servers.
3. Run `scripts/verify-dashboard.ps1 -Port 5759` while it's up; keep it green
   and extend it if you add endpoints.
4. Update docs/roadmap.md (shipped table) — then `git add` the exact files and
   commit with a short message.
5. Append to `docs/autonomy-log-2026-07-19.md`: item id, what shipped or why
   skipped, commit hash, anything the next worker or the orchestrator needs.
   Create the file on first write. This log is the orchestrator's ground truth
   — never claim something the commit doesn't show.

## Coordination

Other runs may commit while you work (the user fires runs from the dashboard).
Before each item: `git status` + `git log --oneline -5`; if the tree moved,
rebase your mental model — reconcile, don't clobber. If `git status` shows
uncommitted changes you didn't make, leave them untouched and note them in the
log.
