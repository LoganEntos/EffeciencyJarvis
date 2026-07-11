# ECC skill library (affaan-m/ecc)

Full skill set from https://github.com/affaan-m/ecc ("Everything Claude
Code"), MIT — see [LICENSE](LICENSE). Adopted 2026-07-11 per roadmap Q4 from
the user's local download (network was gated in earlier sessions).

**This directory is NOT auto-loaded.** Claude Code only loads skills from
`.claude/skills/`. Keeping all 278 active would add ~15-18k tokens of skill
descriptions to every session and every hub run (the user chose curated-active
+ full-library when asked, 2026-07-11).

## Active set (copied into `.claude/skills/`)

18 curated for this user's actual work — hub dev: make-interfaces-feel-better,
browser-qa, e2e-testing, verification-loop, security-review, api-design,
backend-patterns; agents/автоworkflows: prompt-optimizer,
team-agent-orchestration, autonomous-loops, search-first, context-budget;
business/logistics (Entos): market-research, customs-trade-compliance,
logistics-exception-management, inventory-demand-planning,
carrier-relationship-management, returns-reverse-logistics.

Skipped-from-active examples (still here, promotable): `deep-research`
(needs firecrawl/exa MCPs — no always-on MCPs in this repo),
`cost-tracking`/`continuous-learning*`/`skill-comply`/`ck` (depend on ECC's
own hooks/scripts infra), `frontend-design-direction` (imposes ECC's design
language over this repo's), `design-system` (name-collides with the existing
ui-ux-pro-max adoption), plus ~250 stack-specific packs (django, laravel,
kotlin, healthcare, homelab, …) irrelevant to this machine.

## Promote a skill (make it active)

```powershell
Copy-Item -Recurse .claude\skills-library\<name> .claude\skills\<name>
```

Then restart the Claude Code session (skills load at start). Demote by
deleting the copy from `.claude/skills/`. Audit note: active-set files were
grep-scanned for network/exec/injection patterns at adoption (clean —
matches were teaching examples in the security docs); library content beyond
the active set is as-shipped upstream — skim a skill before promoting it.
