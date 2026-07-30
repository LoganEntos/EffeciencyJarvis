# Orchestration efficacy — Projects tab clearout (2026-07-30)

First real run of the two-thread `Workflow` pattern (backend-builder track +
frontend-engineer track in parallel, then code-reviewer, then test-runner) on
this repo. Recorded so the next tab clearout (Files, Sessions, etc.) starts
from what worked instead of re-deriving it.

## What worked

- **Splitting by file ownership, not by feature.** Backend track only ever
  touched `lib/*.js`; frontend track only ever touched `assets/*.js` +
  `index.html`. Zero merge conflicts across 3 interrupted/resumed runs,
  because the two tracks never raced on the same file. This is a stronger
  guarantee than `isolation:'worktree'` for this repo's shape (server/client
  split) and free (no worktree setup cost).
- **"Investigate first, only fix if real" instructions paid off twice.** Two
  of seven track tasks (files.js "jitter", slug-guard "promote to modal?")
  were phrased as open questions in the todo, not confirmed bugs. Both
  agents found the todo's framing was slightly wrong (no keystroke re-render;
  a modal wasn't actually more accessible than a focus fix) and fixed the
  *real* underlying gap instead of building what was asked. Prompts that say
  "make the pragmatic call yourself, report your decision and why" instead of
  "do X" avoid scope creep on ambiguous backlog items.
- **Concrete split plans transfer directly into agent prompts.** The todo
  file already had an exact extraction list for `projectdetail.js` (function
  names, line ranges) from a prior session's audit. Pasting that verbatim
  into the agent prompt produced a correct split on the first pass — no
  review findings on either split.
- **Schema'd review/verify stages caught the one real gap.** code-reviewer's
  structured findings flagged that the new `projectFiles` run-meta field has
  no frontend reader yet — true, and worth tracking, but correctly scored
  `minor`/non-blocking rather than triggering a needless fix pass (the task
  was explicitly scoped to backend persistence only).

## What broke — and the fix

- **The workflow got killed 3 times mid-run** (host process/run cycling,
  unrelated to the workflow itself — each stop left an orphaned throwaway
  `node server.js 5758` process once). `Workflow({scriptPath,
  resumeFromRunId})` replayed every completed agent() call from cache and
  only re-ran the interrupted/unstarted ones — no wasted work, no duplicate
  edits. **Lesson for next time:** treat a `status: stopped` task
  notification as "resume," not "restart" — check `git status` +
  `journal.jsonl` first to see what already landed, kill any orphaned
  throwaway-port process, then resume with the same `runId`. Never re-launch
  the full script from scratch after an interruption.
- **A user-facing "I don't see 2 threads running" message during an
  interruption window is a legitimate signal, not noise** — the background
  task really had gone quiet. The right response was concrete evidence
  (diffstat, line-count deltas, verified endpoints) plus an honest "this is
  the Nth interruption" status, not reassurance without proof.

## Reusable shape for the next tab

1. Read the tab's `data/todos/<tab>.md` in full before scoping anything.
2. Split remaining open items into backend (`lib/`) vs frontend
   (`assets/`+`index.html`) buckets; anything that touches both stays
   sequential within one track rather than forcing a fake parallel split.
3. Flag genuinely ambiguous items (needs a security/scope decision) instead
   of guessing — this run deferred "directory tracker" and left Step 3/7/9
   alone rather than inventing scope for items already marked "needs a user
   call."
4. One `code-reviewer` pass + one `test-runner` pass (throwaway :5758,
   `verify-dashboard.ps1` + functional API smoke) closes the loop; only spawn
   a fix pass if findings are `blocking`/`should-fix`.
5. Update the todo file with dated, evidence-bearing notes (what was
   verified, not just "done") so the next session — human or agent — doesn't
   re-litigate a closed item.
