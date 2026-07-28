# Contamination cleanup — 2026-07-28

Executed from `docs/handoffs/cleanup-contamination-2026-07-28.md`. Recorded here
so a future audit doesn't have to rediscover any of it.

## Stage 1 — Foreign "Personal Jarvis" package quarantined out of the inbox ✅

`claude-dashboard/data/inbox/` root held **15 files from an unrelated project** —
an OpenAI-Codex "Personal Jarvis" handoff bundle (carrying a legacy crypto/trading
Jarvis archive), sitting there since 2026-07-12. Because they lived inside the
project directory, hub runs and agent context could read them as if they were
real project docs — a direct hallucination source.

Moved all 15 to a new **gitignored** `_quarantine-personal-jarvis-package/` at
repo root (`.gitignore` entry added; verified `git status` no longer surfaces
them, so 145 KB of foreign `.docx` can't slip into a future `git add -A`):

    AGENTS.md, ARCHITECTURE.md, CODEX_START_HERE.md, ENVIRONMENT_TEMPLATE.md,
    FIRST_CODEX_PROMPT.md, JARVIS_COMMAND_CHARTER.docx,
    JARVIS_EXECUTION_CHECKLIST.md, JARVIS_RECOVERY_AUDIT.md, JARVIS_SOUL_DRAFT.md,
    LEGACY_TRADING_JARVIS_ARCHIVE.md, PROJECT_STATE.md, README.md,
    RECOVERED_ARTIFACT_INDEX.md, SOURCE_MANIFEST.md,
    jarvis-ai-subscription-api-setup.pplx.md

Each file's identity was confirmed by header before moving (all read
"Personal Jarvis / Codex …"). Real business data left untouched: the invoice
PDFs (IV PO 872912…, PI 877690…, PI SPL 877687… 1of2/2of2, PI_SLP 872912…,
Signed_PI_006435…) and the `vpp-historical-import-test/` folder. Post-move: Files
API returns only genuine business files; smoke test 100% green on :5757.
Commit `2e859e0`.

## Stage 2 — Claude Flow V3 helpers: REPORTED, not deleted ⚠ (needs a user call)

The handoff said delete `.claude/helpers/` only if nothing live references it,
else stop and report. **A live reference exists, so it was left in place:**

- `.claude/settings.json` → `statusLine.command` actively `require()`s
  `.claude/helpers/statusline.cjs` (a "RuFlo V3 Statusline"). Deleting the dir
  would break the user's Claude Code status line.
- The whole directory *is* the Claude Flow V3 leftover the handoff targeted — its
  own `README.md` opens "# Claude Flow V3 Helpers". No git hooks are installed
  (`.git/hooks/` has only `*.sample`), so the other helper scripts (`v3.sh`,
  `update-v3-progress.sh`, `swarm-*.sh`, etc.) are dormant, not wired.
- Broader: `.claude/settings.json` itself is CF-V3-contaminated beyond the
  statusline — an entire `claudeFlow` block (v3.0.0: daemon/swarm/neural/learning,
  all with `autoStart:false`), `env.CLAUDE_FLOW_V3_ENABLED` / `CLAUDE_FLOW_HOOKS_ENABLED:false`,
  and permission entries `Bash(npx claude-flow*)` / `mcp__claude-flow__*`.
  (`env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:"1"` is the one live, legitimate flag.)

**Decision for the user:** to fully purge CF-V3, the statusline must first be
either retired or reimplemented as a standalone `.cjs` (independent of the
`v3.sh`/swarm scaffolding), *then* `.claude/helpers/` can be deleted and the
`claudeFlow` block + claude-flow permission/env entries stripped from
`settings.json`. Not done here because it touches the live harness config and
was explicitly out of the "delete only if unreferenced" scope.

## Stage 3 — Repo-wide contamination re-scan: CLEAN ✅

Case-insensitive scan for trading / crypto / bitcoin / forex / "stock market" /
"power bi" / tmdl / "semantic model" across the whole repo. Every hit is
legitimate:

- `crypto` = Node's built-in `crypto` module (token/id generation), not currency.
- "Power BI / TMDL / semantic-model" appear only as the **anti**-contamination
  guardrail lines in CLAUDE.md / HANDOFF.md / AGENTS.md ("There is NO Power BI …
  never invent or reference …") — kept as-is.
- `customs-trade-compliance` matches "trad" — a legitimate logistics skill.

No dormant trading/crypto/prediction packs from `.claude/skills-library/` were
promoted into the active `.claude/skills/` set. Nothing removed.

## Stage 4 — Doc-staleness precision fixes ✅

Verified every architecture claim in CLAUDE.md / HANDOFF.md against the tree —
all referenced `lib/*.js` and `assets/*.js` modules exist; no dead references;
`/api/spend/today` absent from live docs (correctly replaced by
`/api/stats/today`). Concrete drift corrected (numbers only, no tone/structure):

- HANDOFF.md: `.claude/agents/` holds **18** specialists, not 14 (two spots).
- Size-guard snapshots refreshed: HANDOFF "largest components.css 478" → 482;
  roadmap "448 / 410 / 396 — none within 50 of the cap" → "482 / 455 / 426 —
  components.css + jarvistab.js now within 50 (still all < 500)".

Commit `f763ca1`. (The active skill set is 28 dirs, not the "18" the handoff
prose assumed — those SKILL.md files are third-party ECC definitions documenting
their own domains, not this repo's code, so a code-drift check doesn't apply.)

## Net

Inbox is clean of foreign data; live source + core docs verified contamination-free
and accurate. One item awaits a user decision: the Claude Flow V3 leftover in
`.claude/helpers/` + `settings.json`, which can't be safely auto-purged while the
statusline depends on it.
