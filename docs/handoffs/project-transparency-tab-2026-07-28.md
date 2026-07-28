# Handoff: A "Health" tab — make the whole project visible from inside the hub

**Model:** Opus 4.8 · xhigh (multi-module design + build — do not undershoot).
**Perms:** bypassPermissions. **Toggle the ✦ Jarvis distiller OFF** before pasting.

## Why this exists

On 2026-07-28 the user asked for a project audit and the findings — stray
foreign-project files sitting in the file inbox, docs that had drifted from
the actual code, dormant vs active skill counts, files near the 500-line cap —
were all things a coding agent had to go dig for by hand. None of it was
visible from the hub UI itself. The user's words: *"the OS does not display
ANY of this... THIS IS A MAJOR PROBLEM... the project should be transparent
and editable from within the OS."* This handoff is the fix: a standing surface
in the hub that shows this information live, at all times, without requiring
anyone to ask an agent to go audit for it — and lets the user act on what it
shows without leaving the browser.

This is a real feature build across server + client, not a doc edit. It is
large enough to warrant using the **Plan** agent (or planning inline) before
writing code — don't skip straight to implementation.

Paste this as the Run-tab prompt:

```
Design and build a new MONITOR-group tab in the claude-dashboard hub called
"Health" that makes the entire project state visible and actionable from the
browser — no more "ask an agent to audit" required. Read CLAUDE.md and
HANDOFF.md first for the hard rules (zero-dep, localhost-only, <500-line
files, security invariants, existing tab/endpoint patterns — study how the
Memory tab (lib/memory.js + assets/memory.js) and Files tab (lib/files.js +
assets/files.js) are structured and match that pattern).

PLAN FIRST. This touches server routing, several new read-only data sources,
and a new tab's worth of UI. Sketch the module boundaries before writing code:
likely a new lib/health.js (server: gather + expose the data below) and a new
assets/health.js (client: render it), wired into server.js's router and
index.html's tab list exactly like every other tab. If lib/health.js would
approach 500 lines, split by concern from the start (e.g. lib/health.js for
routing + lib/healthscan.js for the actual filesystem scans).

The tab must surface, at minimum, and answer "is anything hidden right now?":

1. INBOX TRANSPARENCY — the Files tab currently shows project folders
   (data/inbox/<slug>/) but root-level flat files (not inside any project
   folder) blend in with no distinct callout. Add a clear "Unassigned inbox
   files" list: every file directly in data/inbox/ root, with name, size,
   modified date, and file-type icon. This must have been the exact gap that
   let a 15-file foreign-project package (a different, unrelated "Personal
   Jarvis" handoff bundle with old crypto/trading content) sit unnoticed in
   the inbox for over two weeks — verify it's now empty/clean after the
   companion cleanup-contamination-2026-07-28.md handoff has run, and if it's
   not, that itself is a signal this view is needed.
   ACTIONABLE: each unassigned file gets inline delete + "move into project"
   (reuse/extend existing files.js upload/delete endpoints — do not
   reimplement file-serving from scratch, only add what's missing).

2. DOC HEALTH — enumerate every *.md file in the repo (not just claude-dashboard/)
   with path, size, last-git-modified date (via `git log -1 --format=%ai -- <path>`
   or file mtime if untracked), and a simple staleness signal: flag any doc
   whose last-modified date is more than ~30 days older than the newest commit
   touching the code area it claims to document (best-effort heuristic, not
   perfect — label it as a heuristic in the UI, not a verdict).
   ACTIONABLE: click a doc to view its raw content inline (reuse the existing
   raw-markdown viewer pattern from the Agents/Skills/Commands library tab).

3. STRUCTURE / SIZE GUARD — live line-count table for every file under
   claude-dashboard/{server.js,lib/,assets/} plus index.html, sorted
   descending, with a visible marker at 450 (approaching) and 500 (violation)
   lines — this replaces the manual grep an agent currently has to run every
   audit. Also list any lib/*.js or assets/*.js file never required by
   server.js / never <script>-tagged in index.html (orphan check).

4. SKILLS TRANSPARENCY — active skill count (.claude/skills/, already shown
   in Library tab) PLUS a dormant-library count and name list
   (.claude/skills-library/, currently invisible anywhere in the UI) so it's
   clear at a glance how many skills exist vs are loaded, matching the
   distinction already documented in .claude/skills-library/README.md.

5. BACKLOG / AUDIT STATUS — parse docs/improvement-backlog.md (same parser
   lib/autopilot.js already uses — reuse it, do not write a second parser)
   and show open vs closed item counts, plus the date of the most recent
   closed item, so backlog health is visible without opening the file.

Every section above is READ-ONLY data the server already has access to on
disk — no new persistent state, no client data processing, just filesystem
+ git introspection scoped to this repo. Cache aggressively where a scan is
expensive (e.g. recursive line-counts) and add a manual refresh action rather
than re-scanning on every poll.

VERIFY: node --check every new/changed file; scripts/verify-dashboard.ps1
-Port 5757 100% green plus whatever new checks make sense for the Health
endpoints; server-side work tested on throwaway port 5758+, never by killing
5757. Browser-verify the new tab at desktop AND 375px width with a real
screenshot.

REVIEW: run the code-reviewer agent over the diff; fix what it confirms.

COMMIT in stages (no Co-Authored-By trailer) — e.g. one commit for the server
lib/health.js + endpoints, one for the assets/health.js UI, one for wiring
into index.html/nav. Update docs/roadmap.md when done: this closes the
"transparency" gap the user flagged 2026-07-28.

Ground rules override everything here: HANDOFF.md + CLAUDE.md — zero-dep,
localhost-only, <500-line files, security invariants intact (path-traversal
guards on any new file-path handling, X-Hub-Token on any new POST route), no
$ figures anywhere, no HTML-report artifacts (this IS the dashboard's own UI,
so it's exempt from that rule — build it as a real tab, not a generated page).
```

## Notes for whoever fires this
- This is additive (a new tab + new read-only endpoints) — low risk to
  existing functionality, but it's a genuinely multi-file feature. Don't rush
  it into one commit.
- Fire `cleanup-contamination-2026-07-28.md` first if it hasn't run yet — the
  Health tab's inbox-transparency section is more convincing to build and
  demo against a clean inbox.
- If this runs long, it's fine to land sections 1–3 first (inbox, docs,
  structure — the ones tied directly to the incident) and follow up with 4–5
  (skills, backlog) as a smaller second pass.
