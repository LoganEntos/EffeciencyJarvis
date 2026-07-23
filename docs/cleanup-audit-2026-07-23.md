# Cleanup audit — 2026-07-23

Sweep of HANDOFF.md, docs/, docs/handoffs/, docs/archive/, runtime queues, and
git history. Verdict up front: **the repo is in good shape** — the 07-22
consolidation worked (one canonical roadmap, resolved handoffs archived, empty
task/schedule queues, clean working tree). What remains is one overlooked work
item, a handful of stale references inside live docs, and two archivable files.
Nothing needs deleting; archive discipline is intact.

## Priority order

### P1 — Overlooked work: the persona-pipeline audit has no home in the queue
`docs/audit-2026-07-22-persona-pipeline.md` (commit `47ad3cd`) diagnosed why
Jarvis replies feel off and ends with a ranked fix list sized at "≈ a single
work order" (system-layer persona injection + spoken/screen dual contracts,
wit-cap scoping, sonnet floor for persona turns, distiller scoping). **The
roadmap NOW queue never picked it up** — it's findings without an owner.
→ Action: write `docs/handoffs/persona-pipeline-fixes.md` from the audit's
"Recommended order" section and slot it into `docs/roadmap.md` NOW (case for
placing it right after the chat-fix handoff: it lifts output quality of every
run, whereas N2 mobile is cosmetic).

### P2 — Active work already queued (no change, just confirm)
- `docs/handoffs/chat-stop-attach-project-fixes.md` items **4** (attachment
  click-to-open) and **5** (project-editing safety) remain open. NOW #1.
- Pending USER items (real-mic pass, persona-card pass, Playwright yes,
  autostart, Obsidian) are correctly parked in the roadmap 🙋 section.
- Runtime queues are empty (`tasks.json` / `schedules.json` = `[]`) — no
  forgotten hub tasks or schedules.

### P3 — Rule breach: `assets/style.css` at 614 lines
The only hard-rule violation in the repo (500-line cap). Already roadmap NOW
#5 ("split on next UI pass") — but since it's a standing breach, pull it into
the next improvement-cycle run rather than waiting for a UI pass. Watchlist
unchanged: run.js 485, voice.js 474, jarvistab.js 470.

### P4 — Refresh: `docs/handoffs/schedules-verify.md` contradicts reality
Body still claims schedules "have NEVER been proven to fire" — but the fire
test was proven 07-18 (`d7cb3c7`, per handoffs README + roadmap). It also
instructs recording the outcome on an "O3b line" in HANDOFF.md that no longer
exists. Anyone firing this handoff as-is re-runs a proven test and then can't
follow its own closing instructions.
→ Action: rewrite to cover only the remaining scope (schedules **UI polish**),
drop the O3b reference, point closing updates at roadmap NOW #2.

### P5 — Refresh: two mildly stale live docs
- `docs/handoffs/improvement-cycle.md` cycle log ends 07-20 naming "next
  target: app.js at 499" — app.js was split that same day (`857eb...`). Its
  watchlist also omits style.css 614, the actual breach. Update both so the
  next loop run doesn't chase a done target.
- `AGENTS.md` — header still frames hermes as an expected agent and its
  architecture list is stale (lists `hermes`/`acp`/`artifacts` as core
  modules; missing `distill`/`sources`/`sharepoint`/`personas`/`teams`/
  `runs-engine`/`runs-query`). Sync the module list with HANDOFF.md and note
  hermes is deprecated/hidden.

### P6 — Archive (when convenient; nothing is blocking)
- `docs/lovable-prompts/overview-tab.md` → `docs/archive/` — the Lovable
  Jarvis+Overview port shipped (clean-dark is live on every tab); the prompt
  was consumed. Keep the `lovable-prompts/` folder for future overhauls.
- `docs/audit-2026-07-21-chat-attach-projects.md` → archive **only when**
  chat-fix items 4–5 close (it's the line-ref source for that work). Add the
  same fate to `docs/audit-2026-07-22-persona-pipeline.md` once P1's handoff
  ships.

## Explicitly checked and healthy
- `docs/archive/` + `docs/archive/handoffs/` — all 11 resolved work orders
  present, READMEs accurate.
- `HANDOFF.md` "Current truth" (07-22) matches the code and roadmap.
- `docs/roadmap.md` is genuinely the single source of truth; no competing
  status docs remain outside archive.
- Git: clean tree on master, no stray root files, `.gitignore` covering
  `data/` + sidecars + local settings.
