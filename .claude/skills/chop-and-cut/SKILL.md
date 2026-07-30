---
name: chop-and-cut
description: >
  Full audit-and-populate pass over the hub's 19 per-tab TODO lists. TRIGGER:
  the phrase "Chop and Cut" (any casing), or "chop and cut the todos", or an
  explicit ask to audit memory + project and refresh every tab's to-do list.
  Reads the entire hub memory, sweeps docs + code health in parallel, then
  merges findings into data/todos/*.md in priority order.
---

# Chop and Cut — audit → populate every per-tab TODO list

One trigger word runs the whole pipeline. Proven end-to-end 2026-07-30.

## Ground rules (non-negotiable)

- **Merge, never clobber.** Read each existing `claude-dashboard/data/todos/<tab>.md`
  first; preserve every `- [x]` line and any item you didn't produce. Append or
  reorder — never rewrite away the user's own entries.
- **Priority = order.** The drawer UI drag-reorders lines; top of file = do
  first. Put user-directed items first and say `(user-directed)` in the text.
- **Priority tabs get depth:** jarvis, run, projects, agents. Others stay tight
  (2–10 items). Every one of the 19 lists must end non-empty.
- **Item syntax** (the drawer round-trips exactly this):
  `- [ ] task text` — one line, concrete, file:line when known.
  `  > note` lines directly under a task = its note (multi-line allowed).
  `# / ## headings` group sections. Nothing else.
- **Standing user directive:** every error or logic flaw found *while doing any
  work* gets filed into the owning tab's list under a
  `## Found while working (<date>)` section — even outside this skill.
- Report results as plain text in the chat reply. Never an HTML page.

## The 19 tabs (must match lib/todos.js TABS + index.html nav — verify first)

jarvis run live tasks files projects sharepoint sessions memory overview
graph health agents skills commands assets sources tools config

Tab→module map for attribution: jarvis→jarvistab/jarvischat + lib/distill,
personas · run→run/run-composer/runrender + lib/runs* · tasks→tasks +
lib/tasks/schedules/autopilot · files→files + lib/files · projects→project*.js
+ lib/projects/pairing · sharepoint→lib/sharepoint · memory→memory +
lib/memory · graph→graph/agentviz · health→health + lib/health ·
agents/skills/commands/assets/sources/tools/config→lists/assetlib/sources/
tools/config + lib/core/admin/teams. Server-wide items go to the closest tab
(run engine→run, autopilot→tasks, global helpers/app.js→config,
size-guard/repo hygiene→health).

## Pipeline

**Step 1 — memory sweep (inline, cheap).** `data/memory.json` is a flat array
(`{type: episodic|semantic, title, text, tags, importance, createdAt}`). No
embeddings exist — recall is lexical; don't go looking for vectors.

```
node -e "const m=require('./claude-dashboard/data/memory.json');
m.filter(r=>r.type==='semantic').forEach(r=>console.log(r.createdAt,r.title,r.text))"
node -e "const m=require('./claude-dashboard/data/memory.json');
const re=/to.?do|improv|fix|priorit|clean|rework|build|jarvis|agent|project|skill|overview/i;
m.filter(r=>r.type==='episodic'&&re.test(r.title+r.text))
 .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
 .slice(0,120).forEach(r=>console.log(r.createdAt.slice(5,10),r.title.slice(0,110)))"
```

Pull the user's standing directives from the newest episodic titles (they are
the user's own prompts). Also skim the persistent-memory MEMORY.md index.

**Step 2 — parallel project review (two background Explore agents, launched in
one message).**

- *Docs sweep:* mine `docs/roadmap.md`, `docs/handoffs/*.md`, the plan docs
  (`vpp-*`, `jarvis-orchestrator-*`), `HANDOFF.md` "What's next", and the
  existing `data/todos/*.md` for OPEN items only (skip docs/archive/). One line
  per item, attributed to exactly one tab, source-tagged, priority flagged.
  Return one `## <tab>` section per tab, all 19.
- *Code sweep:* line-count every `claude-dashboard/**/*.js` + `assets/*.css`
  (>430 lines ⇒ "plan the split" item, 500 is the hard limit); TODO/FIXME
  markers; dead routes (compare `/api/` strings in assets/ vs routes in
  lib/*.js); unguarded fetch/parse patterns — only what you can cite file:line.
  Same 19-section return format.

**Step 3 — merge and write.** Combine memory + docs + code findings, dedupe
against what each list already holds, write the 19 files. Structure:
`# <Tab> — TODO`, a one-line `Source:` note with the date, `##` sections
(priority/user-directed first, then backlog, then `## Found while working`),
notes on any item needing context.

**Step 4 — verify + report.** `GET /api/todos/counts` on the live hub (5757,
read-only) to confirm every tab counts >0, then reply in chat with: per-tab
item counts, the handful of genuinely new defects found, and which items need
a USER CALL. Nothing else.

## Cost discipline

Steps 1 and 3 are inline. Step 2 is exactly two Explore agents — not a
workflow, not per-tab agents. The whole pass should stay in one turn.
