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

## Current handoffs

| file | status | model |
| --- | --- | --- |
| `jarvis-ui-port.md` | **BLOCKED — waiting on the user's Lovable design** | Opus 4.8 |
| `persona-manager-ui.md` | ready (backend live; UI blocked on same design) | Opus 4.8 |
| `jarvis-error-hunt.md` | ready — beacon is LIVE as of 2026-07-15 restart | Opus 4.8 |

Ground rules that override everything here: `HANDOFF.md` + `CLAUDE.md`
(zero-dep, localhost-only, <500-line files, security invariants, no HTML
report artifacts).
