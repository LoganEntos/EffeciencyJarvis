# Handoff: Skills-layer cleanup, steps 4–6 (O2)

**Status: DONE (2026-07-15, committed `573212a`).** Design suite consolidated
6→2 (`ui-ux-pro-max` + `slides`; reusable methodology folded into
`ui-ux-pro-max/references/`); borderline three (`autonomous-loops`,
`team-agent-orchestration`, `verification-loop`) deleted after a
zero-references check; `prompt-optimizer` re-pointed to `verify`. Logistics
skills untouched — **still an open user question** whether they move to a
separate work profile. Original brief below for the record.

---

Finishes `docs/agent-skill-efficiency-report.md` (steps 1–3 shipped in `bd09b68`).

## Before touching anything

- `git log --oneline -15` and reconcile: a background Fable 5 run was tasked
  with "ECC skills" on 07-15 — if its commits already cover a step below,
  skip that step, don't redo it.
- Check `data/teams.json` and `.claude/agents/*.md` for references to any
  skill you intend to remove; re-point or drop the reference in the same
  commit.

## The work

1. **Consolidate the design suite ~6 → 2.** Keep `ui-ux-pro-max` (reference
   DB) and `slides`. Fold anything uniquely useful from `banner-design`,
   `brand`, `design`, `design-system` into the keepers' references, then
   delete the four. `frontend-design` + `ui-design` + `baseline-ui` are NOT
   part of this — they stay (they're the hub's own design system).
2. **Decide the borderline three** — `autonomous-loops`,
   `team-agent-orchestration`, `verification-loop`: grep run history
   (`data/runs/`) and `.claude/` for evidence they are actually invoked; keep
   only what's used, delete the rest and say why in the commit message.
3. **Do NOT touch the 5 logistics skills** (carrier-relationship-management,
   customs-trade-compliance, inventory-demand-planning,
   logistics-exception-management, returns-reverse-logistics). Whether they
   move to a separate work profile is an open USER decision — restate the
   question in your final reply instead.

## Verify

Smoke script green; one cheap hub run end-to-end (haiku, trivial prompt) to
prove the skills layer still loads; optionally run the `context-budget`
skill before/after and put the token delta in the commit message.
