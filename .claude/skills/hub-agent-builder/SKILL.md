---
name: hub-agent-builder
description: >
  Checklist for creating a new .claude/agents/*.md specialist agent for this
  hub. TRIGGER: an explicit ask to create/add a new agent, "build an agent
  for X", or "make Jarvis's overseer/input-layer its own agent". Walks
  frontmatter, model-tier choice, the opus/fable GOD_PROMPT gotcha, and
  optional teams.js ROSTER wiring — the parts that get skipped by hand and
  produce half-wired agents.
---

# Hub Agent Builder — add a new specialist agent correctly

Before writing anything: read `.claude/agents/architect.md` in full as the
reference shape, and skim the existing roster (18 files under
`.claude/agents/`) plus the "Available agent types" system reminder so the
new agent doesn't duplicate an existing one's scope.

## Ground rules (non-negotiable)

- One agent = one `.claude/agents/<name>.md` file. Nothing else is required
  for it to exist and be dispatchable via the Agent tool.
- `description` is the ONLY thing another Claude instance sees when deciding
  whether to route to this agent — front-load what it does and when to use
  it, and call out what NOT to use it for if it's adjacent to a neighbor.
- Match, don't invent: model tier, tools list, and body-prompt shape should
  mirror the closest existing agent, not a generic template.

## Step-by-step

1. **Pick the model tier** — matches this project's existing convention:
   - `haiku` — cheap/mechanical: data munging, docs, library/memory
     bookkeeping, formatting (`json-wrangler.md`, `doc-scribe.md`,
     `librarian.md`).
   - `sonnet` — default workhorse: most build/logic/UI work
     (`frontend-engineer.md`, `backend-builder.md`).
   - `opus` — expensive/deliberate: architecture, security audits,
     autonomy-loop judgment calls only (`architect.md`,
     `security-auditor.md`, `agentops-engineer.md`). Don't reach for opus
     for routine work.
   - `fable` — top/senior tier. Selectable today (`model` param on the
     Agent tool; `MODEL_PERSONA.fable` in
     `claude-dashboard/lib/agentgraph.js`) but **zero agents currently use
     it**. Reserve for a deliberately senior role — read the gotcha in
     step 4 before shipping one.

2. **Write the frontmatter + body** — copy `.claude/agents/architect.md`'s
   shape:
   ```yaml
   ---
   name: <kebab-case, matches filename>
   description: <what it does + when to use it, one line, no scope overlap>
   model: haiku|sonnet|opus|fable
   ---
   ```
   Body: role statement, numbered rules, output contract. Keep it as tight
   as the shortest existing agent doing a comparable job.

3. **Tools — least privilege.** Match a same-shaped existing agent, don't
   default to "All tools":
   - Read-only analysis (`code-reviewer`, `security-auditor`): `Read, Grep,
     Glob, Bash, Skill`
   - Builders (`frontend-engineer`, `backend-builder`, `voice-engineer`):
     `Read, Edit, Write, Grep, Glob, Bash, Skill`
   - Only genuinely general-purpose roles get every tool.

4. **⚠️ GOD_PROMPT gotcha — opus and fable tiers only.** The hub's
   working-discipline system prompt
   (`claude-dashboard/prompts/fable5-god-prompt.md`) is auto-injected ONLY
   for `isOpusTier(model)` runs (`claude-dashboard/lib/runs.js`). That gate
   does **not** currently cover `model: fable`, despite the file's name.
   - **opus-tier agent:** copy the condensed "Fable 5 playbook discipline"
     block from `architect.md` or `security-auditor.md` into the new
     agent's body — the existing (if awkward) workaround; both current
     opus agents already hand-carry it.
   - **fable-tier agent:** gets **no automatic discipline injection at
     all** right now. Either hand-carry the same block into the body
     (recommended until the gate is fixed) or explicitly accept it runs
     without that layer — don't silently assume fable inherits it. This is
     a known, logged gap (`claude-dashboard/data/todos/jarvis.md`,
     2026-07-31 entries) — reference it in your handoff notes rather than
     re-discovering it.

5. **Optional — team-hint routing.** To make the agent eligible for a team
   preset to proactively suggest (`claude-dashboard/lib/teams.js`'s
   `ROSTER` array + `activeHint()`), add its name to `ROSTER`. Skip this
   and the agent still works standalone via the Agent tool, it just won't
   be surfaced by a team preset. Known gap: some ROSTER-listed agents
   (excel-formatter, voice-engineer per `data/todos/agents.md`) have zero
   real dispatches — being in ROSTER makes suggestion possible, it doesn't
   guarantee use. `commit-captain` was retired 2026-08-01 for exactly this
   reason (0 dispatches across 343 runs) — don't let a new agent sit unused
   that long before either using it or retiring it.

6. **Nothing else needs registration.** The Agents tab (#13) roster
   (`agentList()` in `claude-dashboard/lib/core.js`) and the Graph tab's
   live-run persona view both pick up the new agent automatically — the
   graph shows a persona by MODEL TIER (Maestro/Poet/Dart/Bard), not by
   individual agent identity, so no per-agent graph config is needed.

7. **Verify before calling it done:**
   - New file doesn't collide with a built-in name (`general-purpose`,
     `Explore`, `Plan`, `statusline-setup`) or duplicate an existing
     agent's `description` scope.
   - Shows up in the Agents tab (#13) after the next server restart.
   - If opus/fable tier: confirm the discipline block was actually copied
     in (step 4) — don't ship a senior-tier agent silently missing it.

## Common failure this skill prevents

Half-wired agents: a `.md` file that exists and shows in the roster but (a)
is silently missing the opus/fable discipline block, so it behaves less
carefully than its siblings, or (b) was never added to `ROSTER`, so it's
invisible to team-preset suggestions and only reachable if someone
remembers its exact name.
