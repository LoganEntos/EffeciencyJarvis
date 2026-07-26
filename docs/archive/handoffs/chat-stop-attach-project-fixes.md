# Handoff: chat stop control + attachment interaction + project editing fixes

**Status: IN PROGRESS (2026-07-21).** Model: Opus 4.8.
Source audit: `docs/audit-2026-07-21-chat-attach-projects.md` (full specifics,
line refs). This is the execution order. Do them top-to-bottom; each is small.

**Done so far:** items 1, 2, 3, 6 shipped — stop button + newChat-cancels +
double-send guard (`7263f68`, backend-verified running→cancelled on 5758),
overwrite-retry upload bug + run-done double-fetch collapse (`185d2f6`).
**Remaining:** items 4 (attachment/file click-to-open) and 5 (project editing
safety). Item 5's instructions dirty-guard still needs a real browser to verify
the navigate-away warning; item 4 reuses the Files-tab inline preview (`ba20015`).

## The work (in order)

1. ✅ **Stop button — Jarvis chat + project chat (P1, biggest win).**
   The server already has a working cancel: `POST /api/run/cancel` with `{id}`
   → taskkill of the whole CLI tree (`lib/runs.js` cancelRun, 291-314). The Run
   tab wires it (`run.js` #cancelBtn). Neither `jarvischat.js` nor
   `projectchat.js` exposes it — once a turn dispatches, the only escape is
   "＋ new", which just closes the EventSource while the run keeps burning
   tokens server-side to completion.
   - Add a Stop control to both composers, visible only while `S.running`,
     that POSTs `/api/run/cancel` with `S.runId`.
   - Make `newChat()` in both modules cancel the active run if `S.running`
     before wiping state (today it orphans it).
   - Voice turns (`voiceconvo.js` → `jarvisChat.send`) inherit the fix for free.

2. **Double-send race (P2).** Both `send()`s check `if (S.running) return` but
   only set `S.running = true` AFTER `await api('/api/run')` resolves
   (`jarvischat.js` 127-134, `projectchat.js` 185-191). Two fast Enters dispatch
   two runs. Set a synchronous in-flight guard (or disable the input) BEFORE the
   POST, clear it on error.

3. **Overwrite-retry uploads nothing (P3 bug, 1-line).** `projUpload`
   (`projectdetail.js` 251-268) retries the confirm-overwrite path with the
   original `fileList`, but picker uploads clear `fin.value=''` right after the
   first call (line 131), emptying the live FileList — so overwrite silently
   uploads zero files. Snapshot `[...fileList]` once at entry and retry with the
   snapshot.

4. **Attachments are click-dead (P3).** The Files tab got click-to-expand inline
   preview (commit `ba20015`); it never reached chat attachments or project file
   tiles.
   - Jarvis chat: non-image attachments render as a dead `📎 name` row
     (`jarvischat.js` 118). Make sent attachments clickable → open the same
     preview/lightbox path images use; give images a lightbox.
   - Project file tiles (`projectdetail.js` projFileTile): only images open.
     Route non-image tiles through the Files-tab inline preview instead of
     download-only.

5. **Project editing safety (P4).**
   - Instructions only persist on explicit Save; leaving the view (back button,
     tab switch) silently discards edits. Add a dirty flag + warn-or-autosave on
     navigate-away.
   - Name/description save on blur with no feedback (`saveMeta` called without a
     note) — surface a "saved ✓".
   - Project memory items (`memTile`) are append-only. Add delete (two-step
     confirm, matching the file-remove pattern).

6. **Fetch waste on run-done (P5).** On project-chat `done`, both `loadHistory()`
   and `refreshProjectRuns()` each call the full `/api/projects/get`
   (files+memory+sessions+runs) to update two small strips — two identical heavy
   fetches. Collapse to one shared fetch, or add a `?only=runs` param to
   `/api/projects/get`.

## Constraints
Zero-dep; every file <500 lines (`projectdetail.js` 331, `jarvischat.js` 194,
`projectchat.js` 277 — split before crossing); no `$` anywhere (tokens + % only);
X-Hub-Token via `api()`; preserve path-traversal guards. Review pipeline per
`docs/handoffs/README.md`: browser-verify at 5757 + smoke green +
code-reviewer before commit. Do NOT stop/restart the 5757 listener — verify
server changes on a throwaway 5758 instance.
