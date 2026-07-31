# Handoffs — run these from the hub UI

Each file in this folder is a **self-contained work order** sized for one hub
run. Fire it from the **Run tab**: pin the model it names (usually **Opus 4.8**),
perms `bypassPermissions` (headless runs silently deny Bash/MCP under anything
less), then paste this as the prompt:

```
Read docs/handoffs/<name>.md and execute it. Follow HANDOFF.md ground rules.
Commit at each working, browser-verified stage.
```

## Review pipeline (every handoff, no exceptions)

1. **Before editing** — `git status` + check `/api/runs` for an active run on
   the same files (parallel-run hazard); read every file before touching it.
2. **Build** in stages small enough to verify.
3. **Verify** — `powershell -File scripts\verify-dashboard.ps1 -Port 5757`
   must be 100% green; browser-check UI work at desktop AND 375px; server
   (`lib/*.js`) changes are tested on a throwaway port (5758+), never by
   killing the 5757 listener.
4. **Review** — run the `code-reviewer` agent over the diff; fix what it
   confirms before committing.
5. **Commit** per working stage (no Co-Authored-By trailers); update
   `HANDOFF.md` + `docs/roadmap.md` when the handoff closes; mark the handoff
   file DONE at the top rather than deleting it.

## Current handoffs (execute top-to-bottom — queue in `docs/roadmap.md`)

| # | file | status | model |
| --- | --- | --- | --- |
| −1 | `orchestrator-shipped-plus-sweep-fixes-2026-07-31.md` | ✅ DONE 2026-07-31 — record, not a work order (nothing left to execute from it). Read §3 before starting new work: 3 items explicitly blocked on the user (name the 2nd opus agent, spec the Step-7 destructive control, VPP doc-picks + Tier 2/3 go-ahead). Otherwise the 19-tab sweep backlog is the ready next batch. | n/a |
| 0 | `fix-all-2026-07-23.md` | READY — loop rebuild (Phase A) + full task-queue sprint (Phase B); supersedes 1–2 while it runs | Opus 4.8 · xhigh |
| 1 | `cleanup-contamination-2026-07-28.md` | ✅ DONE 2026-07-28 — foreign package quarantined; scan clean; doc fixes. Claude Flow V3 helpers left for a user call (statusline live-references them). See `docs/archive/cleanup-2026-07-28-contamination.md`. | Opus 4.8 · xhigh |
| 2 | `project-transparency-tab-2026-07-28.md` | ✅ DONE 2026-07-28 — Health tab shipped (`1b42358`,`5a1b92f`,`8aef9b2`); live on next hub restart. | Opus 4.8 · xhigh |
| 3 | `vpp-frontend-workflow-2026-07-28.md` | READY — make the VPP PDF→CSV front-end workflow reliable (Inbox/Projects/Run only). Directive: `docs/vpp-frontend-cleanup-plan.md`. Starts with a plan-before-code pass: README rewrite + PDF↔CSV pairing model. **Fire this next.** | Opus 4.8 · xhigh |
| ∞ | `improvement-cycle.md` | repeatable — one improvement per run, fire on a loop anytime | Fable 5 |

Completed work orders were moved verbatim to `docs/archive/handoffs/`
(projects-tab-polish, jarvis-chat-parity, voice-orb-live, persona-manager-ui,
distill-latency, jarvis-tab-finalize, jarvis-ui-port, jarvis-error-hunt,
skills-cleanup, file-viewer-visual-preview, master-fable5-handoff,
chat-stop-attach-project-fixes, persona-pipeline-fixes, schedules-verify).
When a handoff closes: mark it DONE at the top, update `HANDOFF.md` +
`docs/roadmap.md`, then `git mv` it into the archive.

⚠ Since 2026-07-15 the hub shows **no dollar figures anywhere** — tokens +
completion/routing % are the metrics (`39e6ed6`). Any handoff that touches UI
or run metadata must respect this; `/api/spend/today` is gone
(→ `/api/stats/today`), and `meta.costUsd` is recorded but never displayed.

⚠ When pasting a work-order prompt into the Run tab, **turn the ✦ Jarvis
toggle OFF** — otherwise the >25-word paste goes through the Haiku distiller
and gets rewritten before it runs.

Ground rules that override everything here: `HANDOFF.md` + `CLAUDE.md`
(zero-dep, localhost-only, <500-line files, security invariants, no HTML
report artifacts).
