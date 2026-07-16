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

## Current handoffs (execute READY ones top-to-bottom)

| # | file | status | model |
| --- | --- | --- | --- |
| ✅ | `jarvis-error-hunt.md` | DONE 07-16 (`d212169`) — beacon works; only catch was the already-fixed `6c09bd7` crash | — |
| ✅ | `skills-cleanup.md` | DONE 07-15 (`573212a`) — design suite 6→2, borderline three deleted | — |
| 1 | `schedules-verify.md` | READY — O3 headless part (R5 never proven) | Opus 4.8 |
| 2 | `distill-latency.md` | OPTIONAL — only after schedules-verify | Opus 4.8 |
| — | `jarvis-ui-port.md` | **BLOCKED — user is finishing the Lovable design** | Opus 4.8 |
| — | `persona-manager-ui.md` | backend DONE; UI blocked on the same design | Opus 4.8 |

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
