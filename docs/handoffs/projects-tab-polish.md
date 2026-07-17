# Handoff 1: Projects tab — polish the inline chat + detail view

**Status: READY (user priority #1, 2026-07-17).** Model: Opus 4.8.
Base: commit `639b317` — the inline project chat WORKS (P1 projectId payload
bug fixed + verified end-to-end; runs inject instructions/files/memory and
link to the project). This handoff is the polish pass on top.

## The work (in order)

1. **Chat composer controls.** `projectchat.js send()` hardcodes
   `model:'auto'` + `permissionMode:'bypassPermissions'`. Add a compact
   model select (auto/opus/sonnet/haiku) beside the send button, persisted
   per-project in localStorage (`hub.proj.<id>.model`). Keep bypass as the
   perm (headless runs need it — see `hub-runs-bypass-permissions` memory).
2. **Thread-resume clarity.** After `openThread()`, the "↺ resuming" pill
   only appears if the transcript meta carried a sessionId. When it didn't,
   say so ("read-only replay — next message starts fresh") instead of
   silently starting a new session.
3. **Detail re-render churn.** On `done`, projectchat calls
   `renderProjectDetail()` which reloads the WHOLE view (files, memory,
   sessions) just to refresh the runs table. Refresh only the runs table +
   history strip in place; keep scroll position.
4. **Distiller in project chat.** The ✦ Jarvis toggle exists on the Run tab;
   project chat has nothing. Add a small ✦ toggle to the composer that
   routes >25-word prompts through `jarvisDistill()` (from `jarvis.js`,
   already loaded) before sending.
5. **375px pass.** Browser-verify the whole detail view at 375px: file
   tiles grid, chat row, runs table (it will overflow — wrap it in an
   `overflow-x:auto` container), session rows.
6. **Empty-state + first-run UX.** A brand-new project shows three stacked
   empty sections before the chat. Reorder: chat panel first when a project
   has no files/instructions yet.

## Constraints
Zero-dep; every file <500 lines (projectdetail.js is at 302, projectchat.js
227 — split further before crossing); no `$` anywhere (tokens + % only);
X-Hub-Token via `api()`; review pipeline per `docs/handoffs/README.md`
(smoke green + browser-verify + code-reviewer before commit).
