> **DONE 2026-07-28.** S1 quarantined the 15-file foreign package (commit
> `2e859e0`); S2 reported (not deleted — statusline live-references
> `.claude/helpers/`, needs a user call); S3 scan clean; S4 doc fixes (`f763ca1`);
> S5 recorded in `docs/archive/cleanup-2026-07-28-contamination.md`. Full record
> there.

# Handoff: Wipe foreign-project contamination from docs/inbox

**Model:** Opus 4.8 · xhigh. **Perms:** bypassPermissions (headless runs silently
deny Bash/MCP under anything less). **Toggle the ✦ Jarvis distiller OFF** before
pasting — this prompt is long and would get rewritten.

## Why this exists

A 2026-07-28 audit found that `claude-dashboard/data/inbox/` (the Files-tab
attachment root — meant to hold *this Entos business's* uploaded documents) has
15 files flat-mixed in from a completely unrelated project: a "Personal Jarvis"
handoff package originally written for a different OpenAI Codex project, which
itself carries forward an old superseded "crypto/trading Jarvis" archive. Because
these files live inside the project directory, hub runs and agent context can
read them as if they were real project docs — that's a direct hallucination
source and it must be removed, not just noted. Separately, `.claude/helpers/`
is leftover scaffolding from "Claude Flow V3," a framework this repo already
purged per `docs/archive/agent-skill-efficiency-report.md` — the purge never
touched this directory.

Paste this as the Run-tab prompt:

```
Run a full contamination cleanup on the claude-hub repo. Work in stages, verify
and commit each one separately. Read every file before touching or deleting it.

STAGE 1 — Quarantine the foreign "Personal Jarvis" package out of data/inbox/
  The following 15 files in claude-dashboard/data/inbox/ (root level, NOT the
  vpp-historical-import-test/ subfolder) are NOT this project's business data —
  confirm each still exists and its content still matches this description, then
  move all 15 into a new folder OUTSIDE claude-dashboard/data/ entirely, e.g.
  a sibling folder at repo root named `_quarantine-personal-jarvis-package/`
  (gitignored — check .gitignore covers it, add an entry if not):
    AGENTS.md, ARCHITECTURE.md, CODEX_START_HERE.md, ENVIRONMENT_TEMPLATE.md,
    FIRST_CODEX_PROMPT.md, JARVIS_COMMAND_CHARTER.docx,
    JARVIS_EXECUTION_CHECKLIST.md, JARVIS_RECOVERY_AUDIT.md,
    JARVIS_SOUL_DRAFT.md, LEGACY_TRADING_JARVIS_ARCHIVE.md, PROJECT_STATE.md,
    README.md, RECOVERED_ARTIFACT_INDEX.md, SOURCE_MANIFEST.md,
    jarvis-ai-subscription-api-setup.pplx.md
  Do NOT touch anything else in data/inbox/ — the invoice PDFs (IV PO 872912...,
  PI SPL 877687..., PI_SLP 872912..., Signed_PI_006435...) and the
  vpp-historical-import-test/ folder are real business data, leave them exactly
  where they are.
  After moving: confirm via the hub's Files tab (http://127.0.0.1:5757, Files
  tab) that the inbox now shows only real business files, and confirm the app
  still boots/serves fine (nothing referenced these files by path).

STAGE 2 — Remove the Claude Flow V3 leftover
  Grep the whole repo for "claude-flow", "v3.sh", "update-v3-progress" outside
  of .claude/helpers/ and docs/archive/. If nothing live references it (check
  .claude/settings.json's "helpers" key specifically), delete
  .claude/helpers/ entirely. If something does reference it, stop and report
  instead of deleting.

STAGE 3 — Repo-wide contamination re-scan
  Grep case-insensitively across the ENTIRE repo for: trading, crypto,
  bitcoin, forex, "stock market", "power bi", tmdl, "semantic model" (the BI
  kind). For each hit, judge: genuine unrelated-product contamination (fix/
  remove) vs legitimate/benign (e.g. customs-trade-compliance and other
  logistics skill content already known-legitimate, or dormant packs under
  .claude/skills-library/ like ito-*/prediction-market-*/llm-trading-agent-security
  — those are fine to leave AS-IS since they're not auto-loaded, just confirm
  none of them got promoted into .claude/skills/). Report anything new found;
  fix only what's unambiguously contamination, ask before touching anything
  ambiguous.

STAGE 4 — Doc-staleness cross-check
  For HANDOFF.md, docs/roadmap.md, CLAUDE.md, and every SKILL.md under
  .claude/skills/ (the ACTIVE set only, 18 files): verify each doc's claims
  against actual current code/state (grep for referenced files/functions/
  endpoints; check roadmap "done" vs "pending" against git log and the actual
  codebase). Fix anything concretely wrong (a referenced file/function that no
  longer exists, a claim contradicted by the code). Do not rewrite tone or
  restructure — precision fixes only.

STAGE 5 — Record it
  Append a dated entry to docs/archive/README.md (or a new
  docs/archive/cleanup-2026-07-28-contamination.md if the change list is long)
  summarizing exactly what was quarantined/removed/fixed and why, so this
  doesn't need rediscovering by a future audit.

VERIFY at each stage: node --check on any changed JS; run
scripts/verify-dashboard.ps1 -Port 5757 (100% green) — server-side changes
tested on a throwaway port 5758+, NEVER by killing the 5757 listener.

REVIEW: run the code-reviewer agent over each stage's diff before committing.

COMMIT per stage (no Co-Authored-By trailer), descriptive message naming what
was removed/fixed and why.

Ground rules override everything here: HANDOFF.md + CLAUDE.md — zero-dep,
localhost-only, <500-line files, security invariants intact, no client
business data processed unless explicitly prompted (quarantining/deleting the
foreign files does NOT require reading their business content, just confirming
filenames/headers match this description — do not deep-read
LEGACY_TRADING_JARVIS_ARCHIVE.md or JARVIS_COMMAND_CHARTER.docx beyond what's
needed to confirm identity).
```

## Notes for whoever fires this
- This is a deletion/move task on files outside version control (`data/` is
  gitignored) — low risk to the repo itself, but confirm the quarantine folder
  really is gitignored before Stage 1 completes, so 145 KB of unrelated .docx
  doesn't end up staged in a future `git add -A`.
- Stage 2 and Stage 4 are genuinely separable — if this handoff gets split
  across sessions, Stage 1 (the actual user complaint) must go first.
