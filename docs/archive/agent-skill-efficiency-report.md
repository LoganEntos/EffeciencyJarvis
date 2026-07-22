# Agent / Team / Skill / Command Efficiency Report

*Generated 2026-07-15 from a live inventory of `.claude/agents`, `.claude/skills`,
`.claude/commands`, `~/.claude/`, and `claude-dashboard/lib/teams.js`.*

## Verdict in one line

The agent and team layer is lean and well-engineered; the skills and commands
layer is carrying roughly **190 dead or redundant entries** left over from the
retired claude-flow/ruflo stack, and they tax every single session — including
every headless hub run — before any work starts.

---

## 1. Agents — healthy (14 specialists, correctly tiered)

`.claude/agents/` defines 14 project agents with deliberate model allocation:

| Tier | Agents | Rationale |
|---|---|---|
| haiku (×7) | commit-captain, doc-scribe, excel-formatter, json-wrangler, librarian, scraper, test-runner | Mechanical work; never burns a frontier model |
| sonnet (×5) | backend-builder, code-reviewer, data-analyst, ui-designer, web-researcher | Judgment work at mid cost |
| opus (×2) | architect, security-auditor | Explicitly marked "expensive — use deliberately" |

Descriptions are crisp, scoped to the hub's real workloads, and non-overlapping.
This mirrors the hub's own run-engine philosophy (auto model routing) and is the
strongest part of the setup. **No changes recommended.**

## 2. Teams — healthy (cost-aware by design)

`claude-dashboard/lib/teams.js` ships two built-ins plus custom teams in
`data/teams.json`:

- **Lean** (default): 7-agent general crew, empty steering hint → **zero token
  overhead** on default runs. The hint is only injected when non-empty.
- **Excel ops**: data-analyst / excel-formatter / json-wrangler / librarian plus
  the workbook-formatting skills.

The roster constant matches `.claude/agents/` exactly (14/14). The
token-neutral-by-default design is exactly right. **No changes recommended**,
beyond adding new teams only when a recurring mode of work justifies one.

## 3. Skills — 64 directories (3.3 MB), roughly half dead weight

### Keep — hub-core and actively earning their context cost
`ui-design`, `frontend-design`, `baseline-ui`, `make-interfaces-feel-better`,
`fixing-accessibility`, `fixing-motion-performance`, `security-review`,
`api-design`, `backend-patterns`, `browser-qa`, `e2e-testing`, `context-budget`,
`skill-builder`, `search-first`, `prompt-optimizer`, `market-research`,
plus global `graphify`.

### Keep — Entos domain expertise (used outside the hub codebase)
`carrier-relationship-management`, `customs-trade-compliance`,
`inventory-demand-planning`, `logistics-exception-management`,
`returns-reverse-logistics`. Legitimate, but consider whether they belong in
this repo's `.claude/skills/` or in a separate work profile — they load into
every hub session that will never touch logistics.

### Cull — claude-flow / ruflo era, references retired infrastructure (~27)
`agentdb-advanced`, `agentdb-learning`, `agentdb-memory-patterns`,
`agentdb-optimization`, `agentdb-vector-search`, `flow-nexus-neural`,
`flow-nexus-platform`, `flow-nexus-swarm`, `v3-cli-modernization`,
`v3-core-implementation`, `v3-ddd-architecture`, `v3-integration-deep`,
`v3-mcp-optimization`, `v3-memory-unification`, `v3-performance-optimization`,
`v3-security-overhaul`, `v3-swarm-coordination`, `swarm-advanced`,
`swarm-orchestration`, `sparc-methodology`, `stream-chain`, `hooks-automation`,
`reasoningbank-agentdb`, `reasoningbank-intelligence`, `verification-quality`,
`pair-programming`, `browser`, `dual-mode`. These assume claude-flow MCP
servers, AgentDB, flow-nexus cloud, and ruv-swarm hooks — none installed;
engine policy is Claude-only. Invoking any of them fails or misleads.

### Consolidate — design suite overlap (~6 → keep 2)
`banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-ux-pro-max`
overlap heavily with each other and with `ui-design`/`frontend-design` (the two
this repo's CLAUDE.md actually mandates). Recommend keeping `ui-ux-pro-max` as
the reference database and `slides` if presentations recur; fold or drop the rest.

### Borderline
`autonomous-loops`, `team-agent-orchestration`, `verification-loop`: concepts
are sound and engine-agnostic; keep only if actually invoked, since native
Agent-tool teams + the built-in `/loop` and `verify` skills now cover most of it.

## 4. Commands — 166 files (733 KB), effectively 100% dead

The entire `.claude/commands/` tree is claude-flow scaffolding: `sparc:*` (30+),
`swarm:*`, `hive-mind:*`, `agents:*`, `coordination:*`, `hooks:*`, `training:*`,
`flow-nexus`-dependent `github:*` swarms, `truth:*`, `verify:*`, `pair:*`,
`claude-flow-help/memory/swarm`. Every one of these ~166 entries is injected
into the available-skills list of **every session and every headless hub run**,
and every one depends on MCP tools that are no longer installed. This is the
single largest inefficiency in the environment: pure context tax plus a real
misrouting risk (e.g. the model picking `sparc:code` or `swarm:development`
instead of doing the work natively).

## 5. Stale global instruction

`~/.claude/CLAUDE.md` still contains the auto-generated **"Ruflo Integration"**
block telling every session to use ruflo MCP tools (`memory_store`,
`swarm_init`, `agent_spawn`). Ruflo is retired per project memory. This block
actively misleads all sessions across all projects and should be deleted.

## 6. Estimated impact

The skills/commands listing alone is on the order of 8–12k tokens of system
context per session. Removing the ~166 dead commands and ~27 dead skills would
cut roughly two-thirds of that on every run the hub fires, reduce tool-choice
noise, and cost nothing functionally. The `context-budget` skill can produce a
precise before/after measurement if wanted.

## 7. Recommended order of operations

1. Delete (or archive outside the repo) `.claude/commands/` claude-flow tree — biggest win, zero loss.
2. Delete the ~27 claude-flow-era skills listed above.
3. Remove the "Ruflo Integration" block from `~/.claude/CLAUDE.md`.
4. Consolidate the design-skill overlap.
5. Re-run the smoke script + one hub run to confirm nothing referenced the removed trees.
6. Optionally run `context-budget` for a measured before/after.

## Open questions (left open on purpose)

- Should the five logistics domain skills live in this repo, or in a separate
  Entos-work profile so hub sessions stay lean?
- Are any claude-flow *concepts* (agent Kanban, verification loops with truth
  scoring) worth reimplementing natively as hub features, now that the
  scaffolding is gone? Candidates would go on `docs/roadmap.md`, not back into
  skills.
- Does anything in `data/teams.json` (custom teams) reference skills slated for
  removal? Check before deleting.
