# Handoff: Continuous improvement cycle (fire on a loop)

**Model:** claude-fable-5 authors/drives; hand heavy fixes to xhigh Opus if needed.
**Perms:** bypassPermissions. **Toggle the ✦ Jarvis distiller OFF** before pasting.

Paste this as the Run-tab prompt (it is self-contained and repeatable — each run
does exactly one improvement, verifies it, commits, and leaves the next target
obvious for the following run):

```
Run ONE improvement cycle on the claude-hub app, then stop.

1. HEALTH: run scripts/verify-dashboard.ps1 -Port 5757. If a check fails,
   first rule out a stale live server — boot a throwaway on 5758
   (node claude-dashboard/server.js 5758) and re-run the smoke there. A route
   that is 200 on 5758 but 404/500 on 5757 is NOT a bug, it just means the
   user's live hub predates the code and needs a restart — note it, don't
   "fix" it. A check that fails on 5758 too IS a real bug — fix it.

2. FIND ONE real improvement (highest value first):
   - Any lib/*.js or assets/*.js over 500 lines (hard rule) — split it, moving
     a cohesive block verbatim into a new sibling file wired into index.html
     before its dependent. Watch files near the edge: app.js, voice.js,
     jarvistab.js all sit in the 460-500 range.
   - A real correctness bug, dead branch, or duplicated logic.
   - An accessibility / UX regression against docs/improvement-backlog.md.
   Pick ONE. Do not batch. Do not invent features.

3. VERIFY: node --check any changed JS; smoke must be 100% green on 5758;
   server-side changes are tested on 5758, NEVER by killing the 5757 listener.

4. REVIEW: run the code-reviewer agent over the staged diff; fix what it
   confirms before committing.

5. COMMIT (no Co-Authored-By trailer) with a message naming what changed and
   why. Then, in your final spoken reply (under 1 min, casual, no code names),
   say what you improved and name the single most obvious next target so the
   next cycle starts there.

Ground rules override everything: HANDOFF.md + CLAUDE.md — zero-dep, localhost
only, <500-line files, security invariants intact, no $ figures anywhere, no
HTML-report artifacts.
```

## Cycle log
- 2026-07-20 (`723f243`): split run.js 619L → 485L; render layer extracted to
  assets/runrender.js. Smoke green, reviewer clean. **Next target: app.js at
  499 lines — the imminent next 500-line breach.**
