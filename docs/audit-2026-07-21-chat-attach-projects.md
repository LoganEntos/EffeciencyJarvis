# Audit 2026-07-21 — chat stop, attachments, project editing, inefficiencies

Scope: jarvischat.js / jarvisattach.js / projectchat.js / projectdetail.js /
lib/runs.js / lib/runs-engine.js. Prioritized; P1 is the one hurting most.

## P1 — No way to stop a chat turn (Jarvis tab + project chat)

The server HAS a working cancel: `POST /api/run/cancel` → taskkill of the whole
CLI process tree (lib/runs.js:291-314), and the Run tab wires it
(run.js `#cancelBtn` → `cancelRun()`). But **neither jarvischat.js nor
projectchat.js exposes any stop control**. Once a turn is dispatched:

- Send is disabled and `S.running` blocks new sends until `done`.
- The only escape is "＋ new", and `newChat()` only closes the EventSource —
  the server-side run keeps executing to completion, burning tokens invisibly.
- Voice conversation turns (voiceconvo → jarvisChat.send) have the same hole.

Fix: a stop button in both composers that POSTs `/api/run/cancel` with
`S.runId`; `newChat()` should also cancel if `S.running`.

## P2 — Double-send race in both chat panels

`send()` checks `if (S.running) return` but only sets `S.running = true` AFTER
`await api('/api/run', …)` resolves (jarvischat.js:127-134,
projectchat.js:185-191). Two fast Enters (or Enter + button click) both pass
the guard and dispatch two runs. Set a guard/disable send *before* the POST.

## P3 — Attached items are fire-and-forget

- In Jarvis chat, once sent, non-image attachments render as a dead
  `📎 name` row — not clickable, no preview, no download (jarvischat.js:118).
  Images render but have no lightbox/zoom.
- Project detail file tiles: only images open (lightbox); every other file
  type has download-only — the Files tab's new click-to-expand inline preview
  (commit ba20015) never reached project tiles or chat attachments.
- **Bug — overwrite retry uploads nothing**: `projUpload` retries with the
  original `fileList` (projectdetail.js:264), but for picker uploads
  `fin.value = ''` runs right after the first call (line 131), emptying the
  live FileList. Confirm-overwrite then silently uploads zero files.
  Fix: snapshot `[...fileList]` once and retry with the snapshot.
- Chip remove buttons use index-based inline onclick — fine solo, shifts
  if removals race a pending upload.

## P4 — Project editing rough edges

- Instructions only persist on the explicit Save click; navigating away
  (back button, tab switch) silently discards edits. No dirty flag, no
  autosave, no warning. The `12000` char count is display-only.
- Name/description save on blur with zero feedback (saveMeta called without
  a note — user can't tell it stuck).
- Project memory items are append-only: no edit, no delete on `memTile` —
  one bad note pollutes recall forever.
- File delete and note add call full `renderProjectDetail()` — reloads
  everything, resets scroll (runs table got an in-place refresh; these didn't).

## P5 — Inefficiencies

- On every project-chat `done`, `loadHistory()` AND `refreshProjectRuns()`
  each call the full `/api/projects/get` (files + memory + sessions + runs) —
  two identical heavy fetches to update two small strips. A `?only=runs`
  param or one shared fetch would halve it.
- Streaming re-renders the ENTIRE markdown buffer through `mdToHtml` on every
  text delta (setBubble) — O(n²) on long replies; noticeable on big turns.
- Jarvis chat transcript + sessionId live only in JS memory: a page reload
  loses the whole visible conversation even though the CLI session is
  resumable and the transcript exists on disk under the run dir.

## Suggested order

1. Stop button (P1) — small change, biggest daily pain.
2. Pre-await running guard (P2) — 2-line fix.
3. Overwrite-retry FileList bug (P3) — 1-line fix.
4. Click-to-open attachments + project file previews (P3).
5. Instructions dirty-guard + memory item delete (P4).
6. Single fetch on run-done + reload-restore chat (P5).
