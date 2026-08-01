# Agentic-Stack Charter — 2026-08-01

Source: one warden full-scrutiny pass (all 19 `data/todos/*.md` lists, all 19
`.claude/agents/*.md` files, `lib/teams.js`, the skills census) + one parallel
web-research pass on multi-agent orchestration best practices. Scope, per the
user's own framing: what the *agentic stack* needs to fully support this
app's growth — not feature work on any individual screen (e.g. the Overview
rework is known and deliberately out of scope here).

## Framing

Build-and-review coverage is strong (19 agents split cleanly across making
changes, checking changes, and mechanical support). What's missing is three
operational competencies with no owner: **dispatch/routing intelligence**,
**evaluation/efficiency measurement**, and **library curation at scale**.
Evidence: code-reviewer has 3653 dispatches, frontend-engineer 1813; two
"you are the orchestrator" meta-runs errored with zero output tokens; three
agents have zero dispatches across 343 runs; nothing today can say which of
300+ skills have ever fired. Almost the entire gap closes within the
existing ceiling (1 fable + 2 opus) via one pre-approved opus build, three
brief widenings, four skills, and two-of-three retirement calls — not new
senior agents.

## Research grounding (validates the shape already in place)

- Anthropic and Cognition converge: split agents by **context/tool boundary**
  (different trust level, different tool scope, different model tier), not
  by "type of work" on the same sequential task. The builder/reviewer/warden
  split already matches this.
- **Don't let agents self-certify.** The verifier pattern — separate agent,
  fresh context, concrete success criteria — is what code-reviewer (bugs)
  and warden (does the claimed outcome actually match reality) already do,
  for genuinely different failure modes. Keep them separate; don't fold one
  into the other.
- Autonomous-loop safety literature: hard budget caps enforced by the
  *runner* not the agent, an external verifier as exit condition, and a kill
  switch independent of the loop. This is exactly what the cut-and-chop
  cost-discipline fix (one fable call per pass, hard-capped) already
  implements — a self-discovered instance of the most common loop-engineering
  mistake, now fixed at the protocol level.
- New-role-vs-scope-creep: justified only when tool scope, trust level, or
  model tier genuinely differs, or when one brief would otherwise hold two
  conflicting mental models (permissive builder vs. adversarial reviewer).
  Otherwise it's scope creep — widen an existing brief.
- At 300+ skills, discovery quality depends on description quality, not
  content; Anthropic's own answer at that scale is categorization + opt-in
  subsets, not one flat directory, plus lifecycle management (usage
  tracking → staleness → archival) as an ongoing process, not a one-time
  cleanup — which is exactly librarian's now-expanded role.

## Screen-by-screen coverage verdict

| Screen | Verdict | Fix |
|---|---|---|
| jarvis | NO OWNER for routing/orchestration logic | crew-chief absorbs it |
| run | Builder-only; session-lifecycle waste is code, not agent gaps | resume-lock code fix (shipped 08-01) + handoff-writer skill |
| live | Owned | none |
| tasks | Best brief-to-domain match in the roster (agentops-engineer) | none |
| files | Owned | none |
| projects | Builder-only but working; blocker is human decisions, not capability | vpp-extraction skill (awaiting sign-off) |
| sharepoint | Thin — routine checks currently cost a fable-tier call | sharepoint-recon skill + librarian freshness bookkeeping |
| sessions | Builder-only, code fixes | handoff-writer skill |
| memory | Owned for reconciliation (librarian) | add hygiene sweep |
| overview | No owner; explicitly research-gated already | crew-chief owns the data model only, not the rework |
| graph | Owned | none |
| health | Builder-only, watchlist only checked on-demand | scheduled sweep via existing schedules engine |
| agents | Owned (librarian + future crew-chief) | retirement calls below |
| skills | No owner for curation at 300+ scale | librarian curation duty + skill-stocktake |
| commands | Same shape as skills | same fix |
| assets | Owned | none |
| sources | Builder-only; license-verification bug is code | none new |
| tools | Owned (security-auditor) | none new |
| config | Owned | none new |

## Proposed: build `crew-chief` (opus — pre-approved slot, no new approval needed)

One-line mandate: owns dispatch intelligence — who does what work at what
tier, and whether it worked. Absorbs four currently-ownerless domains: team
composition/ROSTER changes, routing/classifier quality, delegation-scoreboard
interpretation, and the Overview efficiency ledger's data model (not the
rework itself). No existing agent fits: agentops-engineer owns unattended
*execution*, a different hazard profile from dispatch *policy*; architect
does one-off design, not ongoing monitoring; warden is advisory-only and
fable-priced. Keep it Agent-tool-only initially, same deliberate friction as
warden, until it has a track record.

**Opus slot 2 stays unfilled.** The `session-quartermaster` candidate from
the earlier agents.md proposal is withdrawn — the continue-tax root cause
was a plan-mode workflow bug, already fixed at the CLAUDE.md level; what's
left (resume lock, handoff waste) is a code fix + a skill, not a standing
agent. `intake-editor` stays deferred, no exemption requested — the
zero-added-latency constraint hasn't been met by any sketched design yet.

## Brief widenings (no new headcount)

- **librarian**: add SharePoint index-freshness bookkeeping, skill-library
  curation (≥15 skills duplicated between `.claude/skills/` and
  `.claude/skills-library/` — reconcile one way), and scheduled hygiene
  sweeps (health watchlist, memory-junk checks) via the existing schedules
  engine.
- **agentops-engineer**: write the SharePoint index refresh and autopilot
  failure-memory/attempt-journaling items into its charter explicitly —
  already its domain in spirit, not yet in writing.
- **warden**: no widening. Resolved: stays out of `lib/teams.js` ROSTER and
  all presets, Agent-tool-only — matches the deliberate-friction rationale
  already on record and the one-fable-call-per-pass cost rule.

## New skills

1. **vpp-extraction** — codify the proven method (already awaiting the
   user's sign-off per `projects.md` Step 8): `pdftotext -table`,
   printed-Amount-as-truth + float-guard, page-break dedup by sequence
   number, the 10 known format-variant fixes, 0-rows-parsed = NEEDS-REVIEW
   never silent-skip.
2. **sharepoint-recon** — how to call the reconcile endpoint, interpret its
   five statuses, when staleness invalidates a claim — makes this
   tier-portable instead of fable-only knowledge.
3. **handoff-writer** — generate handoffs in a fresh cheap session from
   `HANDOFF.md`/docs/run metadata, never by resuming a mega-session. Targets
   the ~$17 measured waste pattern directly.
4. **skill-stocktake** — promote from `.claude/skills-library/` rather than
   rebuilding; librarian's first curation pass.

Gated for later (promote only once the Overview rework actually starts):
`agent-eval`, `eval-harness`, `cost-tracking`, `token-budget-advisor`.

New team preset: **"Autonomy ops"** (agentops-engineer, backend-builder,
code-reviewer, test-runner) — autopilot/schedule/queue work is a recurring
mode with no preset today.

## Explicitly out of scope

The Overview rework itself; any autopilot flag flips; the 7 human-blocked
VPP orders; per-tab UI/bug items the builder agents already cover; the
input-layer/voice module (on hold); Playwright/E2E and MCP intake decisions
(parked, awaiting the user).

## Needs your call

1. Build `crew-chief` now (opus slot 1, pre-approved role, leave slot 2
   unfilled)?
2. Sign off on the `vpp-extraction` skill (already pending from `projects.md`
   Step 8)?
3. Retirement calls: retire `commit-captain` (0 dispatches in 343 runs)?
   Recommend keeping `excel-formatter` and `voice-engineer` — both anchor
   live domains (Excel-ops preset; the still-unresolved voice-interrupt
   complaint) despite zero dispatches so far.
