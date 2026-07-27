# Improvement Backlog

> Plain-text backlog. **Rule (user, 2026-07-11):** never render reports as HTML
> webpages/artifacts — findings live here as Markdown or as concise text in the
> reply. Genuine dashboard UI work is exempt (that's the product).
>
> **Format rule (2026-07-23) — read before appending.** Autopilot
> (`lib/autopilot.js parseBacklog()`) only reads open items written as a
> **7-column table row**:
>
> ```
> | id | file:line | issue | fix | effort | risk | ⬜ |
> ```
>
> The `id` must match `^[A-Z]\d+$` (e.g. `C14`, `U14`), the status glyph is `⬜`
> for open and `✅ <date>` for done, and the row must sit inside a Markdown table.
> Bullet lists are **history/prose only — the parser is blind to them.** A scout
> or audit adding new work MUST append table rows (or enqueue hub tasks); a fix
> closes an item by flipping its glyph to `✅` in place.

## Self-improvement round — 2026-07-14 — ✅ CLOSED (Fable 5 pass, same day)

Fresh source trace of `server.js` + `lib/*.js` + `assets/*.js`. On execution,
6 of 15 items turned out ALREADY fixed by the C/U rounds (the trace predated
them); the other 9 were fixed in this pass. Every item below is closed —
resolution noted per item.

### P1 — correctness / security / hard-rule

- ✅ ALREADY FIXED (C10/C13 split into assets/voicetts.js; voice.js ~465) — [P1] voice.js is 603 lines, over the 500-line hard rule — `assets/voice.js:1-603` — CLAUDE.md forbids files >500; it blocks the "split before the next voice edit" carryover (C13) and is now +103 over — extract the earcons + the whole CSM chunk pipeline (`csmChunks`/`speakCSM`/`playBlob`) into a new `assets/voicecore.js` loaded before voice.js.
- ✅ FIXED (renderUsageGauge → new assets/rungauge.js, loaded before run.js; run.js ~470) — [P1] run.js is 501 lines, 1 over the hard rule — `assets/run.js:1-501` — same 500-line invariant; any further edit pushes it further over — move `renderUsageGauge()` (or the artifacts block `showArtifacts`) into its own helper file.
- ✅ ALREADY FIXED (attachLiveRun() resets chat.lastText on every run start) — [P1] Stale voice talk-back: `chat.lastText` is never cleared between prompts — `assets/run.js:347 sendPrompt / 410 finishRun / 436 newChat` — a run that ends with only tool_use and no final text bubble leaves `chat.lastText` holding the PREVIOUS reply, so mobile auto-read / call mode speaks the old answer aloud — set `chat.lastText=''` in `sendPrompt()` (and `newChat()`).
- ✅ ALREADY FIXED (KEY_TABS off each <kbd>; this pass also removed the dead index-based ‘0’ fallback) — [P1] Number-key tab shortcuts are off-by-one after SharePoint — `assets/app.js:97,146-147` vs `index.html:38-55` — `TABS` is built from every `nav a` (SharePoint included, but it has no `<kbd>`), so key `5`→SharePoint (label says Sessions), `6`→Sessions, … `0`→Agents (label says Skills); every printed hint from 5 onward is wrong — drive the shortcut off each anchor's own `<kbd>` digit instead of array index.
- ✅ ALREADY FIXED (/api/files/view sends CSP sandbox + nosniff) — [P1] Uploaded SVG served inline, script-executable, same-origin — `lib/files.js:168-180` (`/api/files/view`) — an `.svg` in the inbox is returned as `image/svg+xml` with no CSP/sandbox and no `Content-Disposition`; opening its URL directly runs the SVG's inline `<script>` in the hub's own origin, where it can read the token-bearing index.html and fire mutating calls — drop `svg` from the inline-view allowlist (force it through `/api/files/download`) or send the artifact-style `Content-Security-Policy: sandbox`.

### P2 — mobile / voice / notable UX

- ✅ FIXED (init() probes kokoro status once on phones + posts a start/install notice; fallback warning now names the real engine) — [P2] Mobile auto-read silently dies when the Kokoro sidecar is offline — `assets/voice.js:337-338, 406-453` — on a phone with the default `browser` engine, `speak()` routes to `speakCSM`→Kokoro; if Kokoro isn't installed/running (needs a 340 MB download + venv) the first-chunk `.catch` falls back to `speakBrowser`, which is exactly the iOS-blocked async path — so the "we fixed iOS auto-read" path produces no sound and no message — probe `/api/voice/status?engine=kokoro` once on mobile and surface a one-time "install/start Kokoro for spoken replies" notice instead of a dead fallback.
- ✅ FIXED (audible primer gated behind isMobileDevice(); desktop keeps silent unlocks) — [P2] primeAudio speaks an audible primer on every device, incl. desktop — `assets/voice.js:477-503` — it fires `SS.cancel()` + a `volume:0.05` utterance on the first gesture unconditionally; on desktop that's an unnecessary faint blip that can also clip the first earcon — gate the audible-primer branch behind `isMobileDevice()` (desktop can keep the silent audio-element unlock only).
- ✅ FIXED (now pointer:coarse + hover:none; 820px width test gone) — [P2] `isMobileDevice()` keys off `max-width:820px` — `assets/voice.js:521-527` — an iPhone in landscape (~844px) fails the width test, so auto-read turns itself off when the phone is rotated — test `(pointer:coarse) and (hover:none)` instead of a pixel width.
- ✅ ALREADY FIXED (U3 segmented control shipped) — [P2] Voice engine picker (Browser/Kokoro/CSM) is still a buried `<select>` — `assets/voicecfg.js:45-49` — the most consequential voice setting sits mid-row in a dense flex block (backlog U3, still open) — promote to a labelled segmented control.
- ✅ ALREADY FIXED (U2 inline Lucide sprite shipped) — [P2] Nav still renders raw Unicode glyphs (▷ ☰ ⇪ ⊞ …) — `index.html:38-55` — 1700+ Lucide icons are vendored at `/vendor/icons/lucide-sprite.svg` but the primary nav uses inconsistent-weight typographic glyphs (backlog U2, still open) — swap to `<svg><use href="/vendor/icons/lucide-sprite.svg#…"/></svg>`.

### P3 — polish

- ✅ FIXED (cache_creation_input_tokens added to the result line) — [P3] Result token count under-reports input — `assets/run.js:270` — the chat result line sums `input_tokens + cache_read_input_tokens` but omits `cache_creation_input_tokens` (server-side meta at runs.js:294 includes it), so the displayed `→tok` disagrees with history — add the cache-creation term.
- ✅ FIXED (live runs first, then newest-first walk with early return) — [P3] `sessionModel()` disk-scans every run on each `auto` resume — `lib/runs.js:66-74` — reads every `runs/*/meta.json` synchronously to find one sessionId; fine now, O(n) as history grows — index sessionId→model or read newest-first and break.
- ✅ FIXED (delete rmdirs the parent if emptied; rmdir refuses non-empty) — [P3] Deleting the last file in a project subfolder orphans the empty folder — `lib/files.js:223-231` — `/api/files/delete` unlinks the file but leaves `inbox/<project>/`, so the project keeps showing in `listFiles()` groupings — `rmdir` the parent if it's emptied.
- ✅ RESOLVED (voice.js 820px gone with the pointer-based test; app.js + style.css agree on 760) — [P3] Mobile width thresholds inconsistent across modules — `assets/app.js:52 (760) vs assets/voice.js:525 (820) vs style.css:349 (760)` — "is this a phone" is decided three different ways — settle on one shared breakpoint/helper.
- ✅ ALREADY FIXED (nav toggle = #nv-menu icon, Tasks = #nv-list-todo) — [P3] Header nav toggle glyph `☰` duplicates the Tasks tab glyph `☰` — `index.html:23,40` — same symbol for two different affordances reads as a mistake on desktop — differentiate.


Two audits ran 2026-07-11 (code-reviewer + ui-designer subagents over
`claude-dashboard/`). Ranked, most valuable first. Status: ⬜ todo · ✅ done.

## Code quality / robustness

| # | File:line | Issue | Fix | Effort | Risk | Status |
|---|-----------|-------|-----|--------|------|--------|
| C1 | lib/runs.js (509 lines) | Over the hard 500-line rule | Split read-side (artifact list/serve, transcript, routingStats) into `lib/runs-query.js` | L | med | ✅ 2026-07-14 |
| C2 | lib/runs.js `launch()` (~90 lines) | Tangles spawn + stdout parsing + close handler | Extract `onStdoutLine()` / `onExit()` | M | med | ✅ 2026-07-14 |
| C3 | lib/agentgraph.js:105 | Persona lookup was exact-key, so pinned model versions (claude-opus-4-8, fable-5) mislabeled "Claude / default" in Graph | Substring resolver `personaFor()` (+fable persona) | S | low | ✅ 2026-07-11 |
| C4 | lib/memory.js | Episodic-record object built identically in `captureRun()` and `reindexRuns()` | Extract `buildEpisodicRecord(meta, prompt)` | S | low | ✅ 2026-07-14 |
| C5 | runs.js / tasks.js / schedules.js | Model allowlist hand-copied 3×; a new pinned model never becomes selectable elsewhere | Export one `SIMPLE_MODELS` (or MODELS) and import | S | low | ✅ 2026-07-14 |
| C6 | assets/graph.js `drawGraphViz()` (~185 lines) | Mixes physics/render/hit-test/tooltip/inspector | Extract `runForceLayout()` + `NodeInspector` | L | med | ✅ 2026-07-14 |
| C7 | lib/agentgraph.js | Artifacts-node + star-links copy-pasted between the two graph builders | Extract `makeArtifactsNode()` / `starLinks()` | S | low | ✅ 2026-07-14 |
| C8 | assets/run.js | Queued-timer/attach block duplicated in `sendPrompt()` and `openRun()` | Extract `attachLiveRun(id, opts)` | S | low | ✅ 2026-07-14 |
| C9 | lib/tasks.js `runAll()` | Dead `continue` branch that can never fire | Delete it | S | low | ✅ 2026-07-14 |
| C10 | assets/voice.js `speakCSM()` | Interleaves chunk/fetch/play/fallback | Extract a `ChunkPipeline` helper | M | med | ✅ 2026-07-14 |
| C11 | lib/util.js `run()` | Fragile `finish(-1, out += ...)` relying on a discarded arg | Two statements | S | low | ✅ 2026-07-14 |
| C12 | lib/voice.js + scripts/*.py | csm/kokoro sidecar HTTP boilerplate duplicated | Share a tiny handler base if a 3rd engine lands | M | low | ✅ 2026-07-14 |
| C13 | assets/voice.js (498 lines) | Near the 500-line limit after voice work — no more may go in | Move a block out (e.g. into voicecfg or a helper) before next voice edit | S | low | ✅ 2026-07-14 |

## UI / UX

| # | File:line | Issue | Fix | Effort | Impact | Status |
|---|-----------|-------|-----|--------|--------|--------|
| U1 | index.html:24-37 + clickable cards/chips | Not keyboard-reachable — nav `<a>` has no href; clickable cards/chips/filters are bare div/span with only `onclick`, no tabindex/role/focus ring | Real `<button>`/`role`+`tabindex`+focus styles | M | high | ✅ 2026-07-14 |
| U2 | index.html:24-37 | Nav uses raw Unicode glyphs (▷ ☰ ⇪ …) despite 1700 vendored Lucide icons already shipped | Swap to `/vendor/icons/lucide-sprite.svg#…` | M | med | ✅ 2026-07-14 |
| U3 | assets/voicecfg.js:43-56 | Voice engine selector (Browser/Kokoro/CSM) — the most consequential voice setting — is an undersized plain `<select>` buried in a dense row | Promote to a prominent segmented control | S | med | ✅ 2026-07-14 |
| U4 | assets/voice.js:170 vs style.css:3 | Mic orb paints "listening" GREEN, violating the app's own "green = success only" rule; 38×38 orb breaks the 32×32 header rhythm | Distinct non-green listening color; align size | S | med | ✅ 2026-07-14 |
| U5 | assets/style.css:91 | One flat 12px `h2` for both page titles and subsections — no tab gets a hero moment (against "big size jumps" rule) | Add a page-title scale | M | med | ✅ 2026-07-14 |
| U6 | — | 7 more ranked UI findings + a "what's working" section (from the audit) | Captured below (U7–U13 + "What's working") | S | — | ✅ 2026-07-14 |
| U7 | assets/app.js:102 `goTab()` | Switching tabs never moves focus into the revealed `<section>` — keyboard/SR users stay parked on the nav item and must re-traverse the whole page; nothing announces the panel changed | Give each `<section>` `tabindex="-1"` and `.focus()` it in `goTab()` (and/or wrap `<main>` in `aria-live="polite"`) | S | high | ✅ 2026-07-14 |
| U8 | assets/app.js:121 | Hrefless nav anchors are tagged `role="link"` but never navigate to a URL and activate on Space like buttons — a screen reader mis-announces "link", and links don't normally fire on Space | These are a tab set: use `role="tab"` + `aria-selected` inside a `role="tablist"`, or fall back to `role="button"` | S | med | ✅ 2026-07-14 |
| U9 | index.html:52-53 | `#statusBadge` (server live/down) and `#liveBadge` (idle↔live) mutate their text silently — no `aria-live`, so non-visual users never hear "server down" or "run started" | Add `aria-live="polite"` to both badges | S | med | ✅ 2026-07-14 |
| U10 | assets/style.css:145-150 | The single page-load stagger is misaligned after SharePoint + the Library group were added: the `nth-child` delays assume `.navlabel` divs at children 6/11, but they now sit at 8/12 — so SharePoint (child 6), Graph (child 11) and Assets/Sources/Tools/Config (16-19) reveal with **zero** delay while a label div gets a delay it can't use | Re-key the reveal to the anchors themselves — e.g. `nav a{animation-delay:calc(var(--i)*.03s)}` with an index set in JS, so it survives future nav edits | S | low | ✅ 2026-07-14 |
| U11 | assets/style.css:406 | Mobile bottom-bar tab labels render at **8.5px** `.txt`, below the legibility floor the rest of the M1 mobile pass raised everything else to; the accompanying comment ("15 tabs / row 2 centers the remaining 7") is also stale — there are now 16 tabs, an even 8+8 | Bump label size (≥10px) or drop the label under the active tab only; refresh the stale comment | S | low | ✅ 2026-07-14 |
| U12 | assets/style.css:125,180 | `nav .navlabel` and `.card .l` render weight-200 mono at 10px in `--dim` (~#6d6455 on #0c0b0a ≈ 3:1), under WCAG's 4.5:1 for text — the "extreme weights" rule shouldn't cost readability on functional labels | Raise those two label roles to `--muted`, or lift size/weight until they clear 4.5:1 | S | low | ✅ 2026-07-14 |
| U13 | assets/style.css:190 (runbar selects) | The Run-tab engine/model/perms pickers are still bare native `<select>`s — only the TTS engine got the U3 segmented control; their OS popup ignores the amber theme and mono font, the same "buried select" critique U3 raised | Add a custom chevron/affordance to the closed control, or promote the most-used picker (perms) to a segmented control for consistency | S | low | ✅ 2026-07-14 |

### What's working (audit positives — keep these, don't regress)

- **Self-maintaining keyboard a11y (U1).** The `MutationObserver` in `app.js:150`
  that grants `tabindex`/`role="button"` to any clickable as it renders, plus one
  delegated Enter/Space handler, means new clickables are covered for free — a
  genuinely elegant pattern, not a per-site patch.
- **Disciplined motion budget.** One staggered page-load reveal (`rise`) is the
  whole animation budget, and `prefers-reduced-motion` is honoured on every
  keyframe (nav, cursor, live-pulse, shimmer). No scattered micro-interactions.
- **Cohesive token system.** Amber-on-near-black with full light / warm-dark /
  clean-dark theming driven entirely by CSS variables; green is now correctly
  reserved for success states only (post-U4). No AI-slop palette.
- **Mobile shell is robust.** The bottom-tab rebuild keeps every tab visible with
  zero dependence on JS toggle state, and safe-area insets stop the phone status
  bar from overlapping the title — both prior bug reports stay fixed.
- **Distinctive typography.** Bricolage Grotesque / JetBrains Mono / Instrument
  Serif with real weight and size jumps and `tabular-nums` on data — no Inter,
  Roboto, or system-font slop.
- **Correct number-key shortcuts.** Tab hotkeys are driven off each anchor's own
  `<kbd>` (`app.js:101`), not DOM index, so the post-SharePoint off-by-one can't
  recur.
- **Consistent, shape-hugging focus ring.** `:focus-visible` gives one accent ring
  across nav, buttons, chips, rows and inputs, with per-shape `border-radius`
  overrides so it hugs pills and cards correctly.

## Voice engine (this session — UNVERIFIED, pending user install)
- Kokoro-82M fast engine added (scripts/kokoro-server.py, generalized lib/voice.js
  ENGINES table, 3-way picker in Config). Needs `.kokoro/venv` install + browser test.
- Wake-word gate ("Jarvis" — default flipped from "Suzy" 07-17) added to the call loop. Needs real-mic test.

## Autonomy round — 2026-07-25 (desktop node, interactive Fable-5 session)

Loop-hardening pass so autopilot can run unattended for hours. All fixed and
smoke-verified same session.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C14 | lib/autopilot.js:90 | A2 task-queue fallback iterated load() raw (newest-first — enqueue unshifts), so old tasks starve | pickNext sorts queue oldest-first (FIFO by createdAt) | S | low | ✅ 2026-07-25 |
| C15 | lib/autopilot.js:91 | Errored/gone tasks invisible to autopilot (skip on any runId) — a failed task was never retried | retry tasks whose run settled error/gone, capped by MAX_ATTEMPTS; cancelled stays human-final | S | low | ✅ 2026-07-25 |
| C16 | lib/runs.js:139 | A5 continuation left the owning task pointing at the dead run — retry + continuation could double-dispatch the same item | continueRun relinks task.runId to the resumed run (tasks.relinkRun); refreshDispatched follows the relink | M | low | ✅ 2026-07-25 |
| C17 | lib/runs.js:26 | CLAUDE_EXE hardcoded to the global-npm path — on desktop-app-only nodes every run fails "claude CLI not found" | findClaude(): HUB_CLAUDE_EXE env → npm global → newest %APPDATA%\Claude\claude-code\<ver>\claude.exe | S | low | ✅ 2026-07-25 |
| C18 | lib/tasks.js:29 | No way to mark a task completed out-of-band — an interactive session working the queue left tasks looking never-run (autopilot would re-dispatch them) | done:true marker respected by enrich/runAll/pickNext/queueOpen | S | low | ✅ 2026-07-25 |

**Blocker found on this node (needs USER, one-time):** the hub CLI is not
authenticated here — desktop-app auth does not reach headless spawns, so every
hub run ends `error: Not logged in`. Fix: open a terminal, run `claude` in any
folder once and `/login`. Autopilot + the scout schedule stay OFF until then.

## Autonomy round 2 — 2026-07-26

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C19 | assets/run.js + lib/tasks.js | Chat item 4+5: attachments/project files click-to-open, project instructions discard on navigate | Implement file open handler + instruction cleanup on tab switch | M | low | ✅ 2026-07-25 |
| C20 | assets/style.css:1-180 | style.css at 643 lines, over the 500-line hard rule | Split theme + core layout into style.css (176) + components.css (433) | M | low | ✅ 2026-07-25 |
| C21 | lib/distill.js + lib/personas.js | Persona pipeline: system-layer injection, spoken/screen dual contracts, wit-cap scoping | Refactor persona layer (system injection) + output contracts per mode | M | med | ✅ 2026-07-25 |
| C22 | assets/schedules.js + lib/autopilot.js | Schedules UI polish: fold recurring checks into autopilot loop, verify R5 fire test | Integrate schedule checks as native autopilot tasks, verify recurring behavior | S | low | ✅ 2026-07-25 |
| C23 | assets/jarvistab.js | jarvistab.js at 445 lines, nearing the 500-line cap | Extract soul editor into jarvissoul.js, load before jarvistab.js | M | low | ✅ 2026-07-25 |
| C24 | lib/runs.js:1-509 | runs.js at 509 lines, 9 over the hard 500-line rule — carryover from C1 (split read-side 2026-07-14 but C1 was only partial) | Complete split: extract artifact/transcript queries into runs-query.js; extract launch handler into runs-exec.js | M | med | ✅ 2026-07-26 (runs-route.js extracted, runs.js 419L) |

## Adversarial review round — 2026-07-26 (session diff 58ad57d..f465850)

Opus reviewer verified 3 findings; all fixed same session. Ruled out: sonnet-floor
edges, channel defaulting, --append-system-prompt escaping, runs-route factory
state, relink chain drift, security invariants, listener stacking, css cascade.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C25 | lib/autopilot.js:97 | 'gone' (user deleted run history) counted as retryable — autopilot would re-execute a FINISHED task's prompt unattended | retry only status 'error'; gone = settled unknown outcome (pickNext + queueOpen) | S | low | ✅ 2026-07-26 |
| C26 | lib/tasks.js:19 | tasks.json whole-file writes race out-of-band writers (lost-update reverts runId/done marks) | atomic temp+rename save; new POST /api/tasks/done as the sanctioned out-of-band completion path (smoke-covered) | M | low | ✅ 2026-07-26 |
| C27 | lib/distill.js:23 | C17 CLI auto-discovery fixed runs.js only — distill + sessionsum still hardcode the npm-global path (silent ENOENT on desktop-app-only nodes) | one shared U.findClaude() in util.js; all three spawn sites use it | S | low | ✅ 2026-07-26 |

## Scout round — 2026-07-26 (server libs)

Read-only sweep of the untouched server modules (core/sharepoint/memory/agentgraph/
liveness/files/projects/sources/teams/admin/xlsxcells/hermes/acp/clientlog/usage/
settings/diagnose/artifacts/sessionsum). 4 verified defects below. Ruled out — see
final note.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C28 | lib/files.js:123,194 | `fs.createReadStream(f.full).pipe(res)` in /api/files/view + /api/files/download has NO stream 'error' handler. A read that fails mid-stream (file deleted while streaming to a slow/paused client, or a disk error) emits an unhandled 'error' on the ReadStream → uncaughtException → the whole hub process crashes. There is no process-level uncaughtException handler anywhere, and server.js's per-request try/catch cannot catch an error emitted on a later tick | attach `.on('error', e => { res.destroy(); })` (and 404/500 only if `!res.headersSent`) to each stream before piping | S | med | ✅ 2026-07-26 |
| C29 | lib/artifacts.js:70 | Same unguarded `fs.createReadStream(full).pipe(res)` in serveArtifact() — an artifact file deleted or erroring mid-stream crashes the server (same uncaught-'error' class as C28) | same stream 'error' guard on the ReadStream | S | med | ✅ 2026-07-26 |
| C30 | lib/sessionsum.js:86-108 | sweep() lost-update race: the 15-min background interval sweep and a client /api/session-summaries/build POST each `load()` their OWN cache copy, then `await summarizeOne()` (≤30s) BETWEEN the read and the `save()`. The later save writes its stale copy back, silently dropping summaries the other sweep just computed and cached (wasted Haiku tokens + missing entries). Same class C26 fixed for tasks.json, but here real awaits sit inside the critical section | serialize sweeps with an in-flight flag, or reload+merge the cache immediately before each `save()` (atomic temp+rename like C26) | M | low | ✅ 2026-07-26 |
| C31 | lib/core.js:126-151 | oneShotMemo Map grows unbounded. sessions() calls isInternalOneShot(id,size) for every transcript on every call and memoizes by `id:size`; the LIVE session file grows continuously, so every poll at a new size inserts a fresh key that is never evicted — a slow memory leak over a long-lived server that is polled by the activity tab + the summary sweeps | cap/evict the memo (simple LRU or clear when size > N), or don't memoize the newest/still-growing transcript | S | low | ✅ 2026-07-26 |

## Scout round — 2026-07-26 (SPA assets)

Read-only sweep of the untouched SPA modules (app/lists/graph/agentviz/overview/
memory/live/sheetgrid/sharepoint/sources/assetlib/clientlog/jarvisorb/jarvispersona/
jarvistimeline/voicecfg/voiceconvo/voicetts/projects/projectsxfer/rungauge/runrender/
runhistory). 4 verified defects below. Ruled out — see final note.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| U14 | assets/graph.js:277 | `window.addEventListener('mouseup', …)` is registered fresh inside `drawGraphViz()` on EVERY Codebase-map render — each Modules⇄All-symbols view toggle and each Graph-tab re-render adds another permanent document-level mouseup listener that is never removed (the `.gtip` tooltips ARE cleaned at line 149, this handler is not). Stale closures keep firing on every mouseup for the rest of the session, each touching a disconnected canvas's `layout`/`inspector` | move the mouseup handler off `window` (attach to the canvas, which dies with the render) or register it once at module scope and read the live instance via a shared ref | S | low | ✅ 2026-07-26 |
| U15 | assets/sharepoint.js:184,97 | `spPollCrawl()` starts a new uncleared 2s `setInterval` with NO module-level guard (unlike `spSearchT`). `spRenderIndex()` calls it whenever `running` is true, and `spStatus()` re-runs on the header Refresh button (force reload) mid-crawl and from `spPollCrawl`'s own `else spStatus()` branch — so overlapping pollers stack and hammer `/api/sharepoint/index/status` in parallel for the crawl's duration | store the interval id in a module var and clear-before-start (or early-return if one is already live) | S | low | ✅ 2026-07-26 |
| U16 | assets/rungauge.js:12,32 vs 18 | `renderUsageGauge()` sets `el.style.display='none'` when `/api/usage` errors or returns no runs, but the SUCCESS path (line 18) only writes `innerHTML` and never restores `el.style.display=''`. run.js calls this on tab render and after every run, so a single transient `/api/usage` failure hides the Today gauge permanently for the session — later successful renders write content into a still-`display:none` element and stay invisible until page reload | set `el.style.display=''` at the top of the success branch before writing innerHTML | S | low | ✅ 2026-07-26 |
| U17 | assets/sharepoint.js:110-114 | `spDoSearch()` does `const r = await api('/api/sharepoint/index/search?q=…')` with NO try/catch (every other sharepoint fetch uses `.catch`). A network error/timeout from `api()` rejects unhandled (only the clientlog beacon sees it), and `#spHits` is left showing stale results with no error feedback — the search box silently stops responding | wrap in try/catch and render a `pill err` into `#spHits` on failure, mirroring `spDoSearch`'s own `r.error` branch | S | low | ✅ 2026-07-26 |

## Scout round 2 — 2026-07-26 (engine core)

Read-only sweep of the engine core (server.js, runs-engine/query/route.js, schedules.js, util.js, personas.js, teams.js, voice.js, autopilot.js) with runs.js read for shared-state context. 2 verified defects below. Ruled out — see final note.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C32 | lib/runs-engine.js:59 | startRun (runs.js:256-264) pushes ALL opening hub_status lines (auto-route reason, memory-recall, team, persona, project, think/effort, fable5, queue-position) via pushLine BEFORE launch(). pushLine only persists `if (st.out)`, but st.out is created in markRunning INSIDE launch — so those lines land in st.lines (memory) but never in output.jsonl. Once the finished run is evicted from `active` (30s), /api/run/transcript and the SSE disk-replay (runs.js:337-340) read output.jsonl and silently omit them: a run viewed from history is missing the status banners it streamed live. The underlying facts survive in meta.* (routedReason/persona/team/effort), so badges still render, but the transcript record is incomplete/inconsistent live-vs-history | open st.out (or flush the buffered st.lines into it) as soon as the run dir is created in startRun, or write the already-buffered st.lines when markRunning creates the append stream | S | low | ✅ 2026-07-26 |
| C33 | lib/schedules.js:89 | Continuation-on-death (runs-engine.js:103-107) fires for source:'schedule' runs too, but continueRun (runs.js:102-104) only relinks TASKS — schedules have no relink, so s.lastRunId keeps pointing at the errored original while the continuation runs untracked. If nextDue comes due while that continuation is still running (plausible on a 15-min interval schedule whose original errored partway), tick()'s "prev still running → defer" guard reads getRunMeta(lastRunId)=error=settled and fires a FRESH scheduled run — stacking a 2nd concurrent run for that schedule and overwriting lastRunId, orphaning the real continuation from the schedule's own enrich()/history | stamp a scheduleId on the run meta so continueRun can repoint schedule.lastRunId to the continuation, or in tick() treat an active source:'schedule' run resumed from lastRunId's session as unsettled | M | low | ✅ 2026-07-26 |

## Deployment-context round — 2026-07-26 (autostart task)

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C34 | lib/util.js:findClaude | Desktop-app CLI lives in MSIX-virtualized AppData — visible only to processes inside the package context; the autostart scheduled task (and any plain terminal) got ENOENT and every hub run failed "claude CLI not found" | findClaude probes %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code too; CLAUDE_EXE resolution moved from load-time const to call-time claudeExe() in runs/runs-engine/distill/sessionsum so a stale path self-heals | M | low | ✅ 2026-07-26 |

## Scout round 3 — 2026-07-26 (fix-diff review + least-covered modules + CLI prior art)

Four-agent replenishment sweep: (a) diff review of the C28–C34 fix commits, (b) server
modules prior rounds covered least (hermes/acp/tasks/teams/projects/distill/xlsxcells),
(c) chat/project SPA modules, (d) external Claude CLI changelog pass. 6 queued rows below.

Also verified but DEFERRED (prose only — promote to rows in a later round if wanted):
runrender.js:37 module-scope `toolEls` map never cleared on newChat/openRun (detached-DOM
leak over a long session); graph.js:277 C28's canvas-scoped `onmouseup` means releasing a
node-drag outside the canvas leaves the node stuck to the cursor (`layout.drag` never
cleared); lib/tasks.js:74 `runAll` silently skips tasks whose linked run was deleted
(`getRunMeta` null fails both retry branches — per-task Run button works); lib/teams.js:85 +
lib/projects.js:31 persist via plain `writeFileSync` instead of the atomic temp+rename
pattern tasks.js uses; projectdetail.js:219 dead `showTab` fallback (function doesn't
exist — rename leftover); the `!res.headersSent` JSON-500 branch in the C28/C29 stream
guards is unreachable (writeHead is synchronous) — crash guard still works, branch is dead
code. Ruled out: no XSS (all render helpers route through esc()), distill.js + xlsxcells.js
clean, scheduleId/relink chain + hub_status flush + findClaude call-time resolution all
verified correct.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| U18 | assets/run.js:273 | SSE `es.onerror` only cleans up when `!chat.running` — a stream drop MID-run (network blip, server restart) never closes `es` or calls `finishRun()`, so the Run tab's composer stays disabled and Cancel stays up forever; only "New chat" (discarding the transcript) recovers. The exact bug was already diagnosed and fixed in jarvischat.js:175 and projectchat.js:240 — the primary Run tab never got the same fix | mirror projectchat's onerror: unconditionally close `es`, and if `chat.running` was true reset it + `finishRun()` so the composer re-enables | S | low | ✅ 2026-07-25 |
| C35 | server.js:119 | The C28/C29 crash-guard pass missed the `/vendor/` static route: `fs.createReadStream(full).pipe(res)` with no stream 'error' handler — a vendor file deleted/AV-locked mid-stream emits an unhandled 'error' and crashes the whole hub process (same class C28 fixed in files.js/artifacts.js) | attach the same `rs.on('error', () => res.destroy())` guard before piping | S | low | ✅ 2026-07-26 |
| C36 | lib/hermes.js:53 | Close handler uses truthy `else if (info.code)` — a hermes-acp child killed by signal (`code=null`) or exiting 0 abnormally falls through to `st.meta.status='done'`, recording a crashed/killed run as a successful completion in history/metrics (verified: `child.kill()` → close fires with code=null, signal='SIGTERM') | `else if (info.code != null)`, or treat close-without-stopReason as error (it IS the abnormal path); same truthy check paired at lib/acp.js:91 | S | low | ✅ 2026-07-26 |
| C37 | lib/acp.js:69 | Stall watchdog is armed only before `session/prompt` — a hermes process that hangs during `initialize` or `session/new`/`session/resume` has no timeout, the run sits status "running" forever, and liveness.js:37's orphan reaper explicitly skips anything still in the live `active` map, so nothing ever sweeps it | call `armWatchdog()` before the first request (initialize), not just before session/prompt | S | low | ✅ 2026-07-26 |
| U19 | assets/app.js CLICKABLE_SEL + projectdetail.js:216,150 + projectchat.js:134 | Three project-UI click targets are mouse-only: `.prun` recent-run rows, `.projTile` file/image tiles, and `.pchat-hpill` history pills carry no role/tabindex/keydown and none match app.js's CLICKABLE_SEL, so the MutationObserver auto-a11y pass never covers them — keyboard users can't open a project's runs, files, or past chat threads | add `.prun, .projTile[data-img], .projTile[data-doc], .pchat-hpill` to CLICKABLE_SEL (one-line fix; observer grants role/tabindex/keys for free) | S | low | ✅ 2026-07-26 |
| C38 | lib/runs-engine.js spawn args | Headless spawns have no runaway guardrails — confirmed current CLI (code.claude.com/docs/en/cli-reference) ships `--max-budget-usd <amt>` (hard spend cap, kills subagents at limit) and `--max-turns <n>` (turn cap), both print-mode which matches the hub's `-p` usage; unattended autopilot/scheduled runs currently have no ceiling on a runaway prompt | add both flags (values from settings.json with sane defaults) to the spawn argv; gate on CLI version or drop the flag if the spawned CLI errors on it. Prior art also confirmed for later rounds: `--json-schema` (validated structured output), `--fork-session` (branch a past session), `--agents '<json>'` (dynamic subagent defs), `--forward-subagent-text` (subagent text in stream-json for agentviz) | S | med | ✅ 2026-07-26 |

## Scout round 4 — 2026-07-26 (never-swept modules)

Two-agent sweep of the modules no prior round touched: lib (sharepoint.js,
liveness.js, memory.js, agentgraph.js, files.js) and SPA (jarvistab.js,
voice.js, files.js). 6 verified rows below, every claim re-checked against
source by the orchestrator.

Also verified but DEFERRED (prose only): assets/files.js:41 upload precheck is
per-file only while lib/files.js readRaw caps the whole multipart body at 50 MB
combined — a 3×20 MB selection transfers fully then 413s (sum sizes client-side
before posting; error DOES surface, so no stuck UI). Ruled out this round:
sharepoint/memory/files token-guard + traversal params all correct (okId /
sanitizeSeg / inboxFile verified against call sites); memory.js load→save cycles
are synchronous, no C26/C30-class race; all spawns argv-only; files.js read
streams already carry the C28 guard; jarvisOrb.init() re-entrancy, J.txTimer,
jarvischat double-send, and stale-FileList overwrite retry all correctly guarded;
no unescaped innerHTML in jarvistab/voice/files.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C39 | lib/sharepoint.js:106-139 | startDeviceLogin race: the polling setInterval closes over the shared module-level `device` var, not per-flow state. Double-clicking Connect Microsoft 365 (no client-side disable in assets/sharepoint.js:60) starts two flows — both pass the line-108 guard while `device` is still null/old, then the second overwrites `device`, so the first flow's interval reads the OTHER flow's expiresAt/timer each tick: on expiry it clearIntervals the LIVE flow's timer and writes 'code expired — start again' onto the object the user is watching, and since clearInterval(device.timer) never targets the orphan itself, that interval keeps polling Microsoft's token endpoint every 5s for the process lifetime | capture per-flow state locally (`const mine = …; const myTimer = setInterval(…)`) and start each tick with `if (device !== mine) { clearInterval(myTimer); return; }` | M | med | ✅ 2026-07-26 |
| C40 | lib/liveness.js:120 | startHermesTail registers `child.stdout.on('data', …)` with NO stdout 'error' handler — `child.on('error')` at line 134 covers spawn failure only (different emitter). A broken pipe / fd error on the hermes log tail's stdout emits an unhandled 'error' event and crashes the whole hub process, killing every in-flight run; same class C28/C29/C35 fixed for read streams but never applied here | add `child.stdout.on('error', () => {})` beside the data handler | S | low | ✅ 2026-07-26 |
| C41 | lib/memory.js:218 | addNote() persists uncapped — `save(list)` — while captureRun (line 69) and reindexRuns (line 86) both `save(list.slice(0, 2000))`. Every POST /api/memory grows data/memory.json forever, and load() re-parses the whole file synchronously on every memory route (GET/search/delete/POST), so all of them degrade with no eviction ever applied to notes | `save(list.slice(0, 2000))` in addNote (and in distill's `save(list)` at line 205 for the same reason) | S | low | ✅ 2026-07-26 |
| C42 | lib/agentgraph.js:83 | hermes-vs-ACP engine detection is a substring regex over the ENTIRE raw output.jsonl: `!/"tool_use"\|"type":"assistant"/.test(raw)` — a legacy -z oneshot whose answer TEXT happens to contain `"tool_use"` or `"type":"assistant"` (e.g. the user asked about Anthropic API message shapes) skips buildHermesGraph; the claude-builder then finds no assistant/user events (real shape is hermes_out) and the Graph tab renders a bare root instead of the Maestro+crew ring | parse lines as JSON and test `o.type` values instead of a whole-file substring match | S | low | ✅ 2026-07-26 |
| U20 | assets/jarvistab.js:32,59 | loadPersonas() and switchPersona() `await api(…)` with no try/catch (pollTranscript in the same file guards its calls — these were missed). A transient /api/personas failure while opening the Jarvis tab throws out of renderers.jarvis, and app.js load()'s catch-all replaces the ENTIRE built tab (orb canvas, composer, controls) with the bare "Couldn't load this tab" box; a failed activate POST from a persona card (jarvispersonacards.js calls activate with no .catch) becomes an unhandled rejection — the card silently does nothing, no flash | try/catch both: loadPersonas falls back to `J.personas = []` + flash; switchPersona failure → `flash('✗ …', true)` | S | low | ✅ 2026-07-26 |
| U21 | assets/files.js:10-18 | #dropzone is mouse-only: `onclick → fi.click()` with no tabindex/role/keydown, it matches nothing in app.js CLICKABLE_SEL (line 163) so the auto-a11y observer never upgrades it, and the backing #fileIn is display:none (unfocusable) — keyboard-only users cannot open the file picker on the Files tab at all | give the dropzone `role="button" tabindex="0"` + Enter/Space → fi.click() (mirror the .fcard-head.can pattern at files.js:117), or add `.dropzone` to CLICKABLE_SEL | S | low | ✅ 2026-07-26 |

## Voice round — 2026-07-26 (Kokoro install)

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C43 | scripts/kokoro-server.py:81 | Kokoro sidecar runs CPU-only (health reports device:cpu) — sentence render ~1.8s where the RTX 3060 would do ~0.1-0.3s | pip install onnxruntime-directml into .kokoro/venv and pass providers=['DmlExecutionProvider','CPUExecutionProvider'] (or kokoro-onnx's session override) so the GPU renders; verify /health reports a GPU device and TTS latency drops under 0.5s; keep CPU fallback | M | low | ⚠️ 2026-07-26 — see note |
| C44 | lib/voice.js:143 | Kokoro boot warm-start raced the dying predecessor after the supervised /api/restart: health-probe saw the old sidecar still up, skipped spawning, then the orphan died — kokoro stayed offline until a manual start | after a supervised restart, re-probe health ~10s after boot (second chance) or have startSidecar kill/adopt an orphaned sidecar on port 8791 before spawning | S | low | ✅ 2026-07-26 |

**C43 note (2026-07-26).** The suggested DirectML path does not work for Kokoro,
and the box's premise was off. Findings:
- The GPU here is an **RTX 3050 Ti Laptop** (not a 3060), driver 555.97, with **no
  CUDA toolkit / cuDNN runtime** installed (`nvcc` absent; no `cudart64_12.dll` /
  `cudnn64_9.dll` on PATH).
- `onnxruntime-directml` installs and `DmlExecutionProvider` loads, but inference
  crashes on Kokoro-82M's `/encoder/F0.1/pool/ConvTranspose` node
  (`RUNTIME_EXCEPTION … The parameter is incorrect`, ORT 1.24) — reproduced with
  and without `disable_metacommands`. So DirectML is a dead end for this model.
- `onnxruntime-gpu` (CUDAExecutionProvider) *would* drive the 3050 Ti, but needs
  the CUDA 12 + cuDNN 9 runtime DLLs installed first — a heavier, out-of-scope
  system change for an unattended run.

**What shipped instead** (`scripts/kokoro-server.py`): the loader now prefers a
GPU execution provider (DML → CUDA), **warmup-gates each attempt with a real
render**, and falls back to CPU if the GPU can't actually synthesize — so it will
auto-adopt the GPU the moment a working EP exists, and never lands in a
"health=ready but every /tts 500s" state. `/health` now reports the true device
(`gpu (cuda)` / `gpu (directml)` / `cpu`) plus the `providers` list.
`kokoro-requirements.txt` documents the CUDA-vs-DirectML tradeoff and pins plain
`onnxruntime` as the default. **Net on this box: still CPU (~1.1–1.8 s/sentence);
the sub-0.5 s GPU win is blocked until the CUDA runtime is installed.**

## Promotion round — 2026-07-26 (verified-deferred → fixed)

Backlog was fully burned after C42; promoted two already-verified deferred items
from Scout round 3 (atomic-write consistency) and fixed them.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C45 | lib/projects.js:31 | save() used plain writeFileSync — a concurrent reader can see a torn projects.json (same class C26 fixed for tasks.json) | atomic temp+rename mirroring lib/tasks.js save() | S | low | ✅ 2026-07-26 |
| C46 | lib/teams.js:85 | saveState() used plain writeFileSync — same torn-read class as C45 | atomic temp+rename mirroring lib/tasks.js save() | S | low | ✅ 2026-07-26 |

## Jarvis latency + communication round — 2026-07-26 (user-reported: "poor communication, slow response")

Subagent root-cause analysis of the distill pre-pass, persona contracts, and the
spoken/screen output channels. Highest-impact latency + comms fixes shipped this
session (L2/L3/C1/C2/C3); the rest are queued rows for the autonomous loop.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| L2 | lib/distill.js:67 | Distill blocking timeout was 20s — a hung Haiku pre-pass could add up to 20s of dead wait before the real run | cut default to 8s; falls back to instant local cleanup | S | low | ✅ 2026-07-26 |
| L3 | assets/run-composer.js:96 | User's message bubble was only drawn AFTER distill+POST resolved — chat sat empty behind a "Shaping…" button, inflating perceived latency | render the user bubble optimistically before the await; reconcile in place to what runs | S | low | ✅ 2026-07-26 |
| C1 | lib/personas.js:50 + personas/_guidelines.md:5 | Spoken contract's absolute ban on naming any variable/function/file/flag/config out loud forced every technical voice reply into vague paraphrase — the core "unclear" complaint | soften: prefer plain words but name the thing when that's the clearest answer; answer the question asked | S | low | ✅ 2026-07-26 |
| C2 | personas/jarvis.md:20 | Persona hard-coded "two or three sentences is your home" even on the screen channel, clipping typed replies against the contract's "length scales to the deliverable" | make the length rule channel-aware; defer to the contract on screen | S | low | ✅ 2026-07-26 |
| C3 | assets/jarvis.js:53 | bufferPrompt stripped meaning-bearing words (like/just/really/actually) globally, so "look like Stripe"→"look Stripe", "just the header"→"the header" — silently distorting intent AND showing the user words they didn't type | strip only true discourse markers; keep meaning-bearing words | S | low | ✅ 2026-07-26 |
| L1 | assets/run-composer.js:96 + lib/distill.js:83 | Synchronous distill pre-pass spawns a whole extra `claude -p` cold-start that blocks before the real run's own cold-start — two serialized CLI boots of added wall-clock before first token | make distill non-blocking (fire the run on the raw prompt, use distill for display only) or raise DISTILL_MIN_WORDS well above 25 | M | med | ✅ 2026-07-26 |
| L4 | lib/runs.js:157 | Persona floor bumps every conversational auto-routed turn haiku→sonnet — slower model on the simplest turns purely to "hold the voice" | keep the floor only for turns that do real work; let trivial chit-chat stay on haiku | S | low | ✅ 2026-07-26 |
| L5 | assets/voicetts.js warmup | Spoken first-word latency: CSM ~4.5s fixed; Kokoro sidecar pays a cold warmup on first call | pre-warm the chosen sidecar at tab-open/run-start so the first chunk isn't also paying warmup | M | med | ✅ 2026-07-26 |
| C4 | lib/distill.js:93 | Distill appends the verbatim original under the rewrite, so the agent receives TWO versions of the ask and can act on the wrong one or hedge | send one prompt; if confidence in the rewrite is low, skip distill entirely rather than shipping both | S | low | ✅ 2026-07-26 |
| C5 | assets/voicetts.js:36 | Spoken replies hard-cap at 400 (CSM)/700 (Kokoro) chars + "The rest is on screen" — a substantive answer gets clipped mid-thought | raise the Kokoro cap and/or split long replies into queued ChunkPipeline chunks instead of truncating | S | low | ✅ 2026-07-26 |

## Audit round — 2026-07-26 (replenishment: recent-diff + least-swept modules)

Four-agent read-only sweep after the L1–L5/C1–C5 latency+comms marathon: (a) code-reviewer
over the last 8 commits' diff, (b) functionality-gap sweep (every SPA api()/fetch() endpoint
matched to a live server route), (c) least-swept large modules (projects/xlsxcells/core/
projectdetail/projectchat/overview/assetlib), (d) security pass on the new mic-dictation +
AUTONOMOUS LOOP button. Two regressions from THIS session's own C4/L3 work found + two
older items; every row re-verified against current source by the orchestrator.

**Clean (no findings):** SPA↔server endpoint contract is fully consistent — ~90 distinct
endpoints, zero 404-class mismatch, no dead nav/buttons (all in CLICKABLE_SEL wired).
Security invariants intact on the changed surface — token guard on all non-GET, argv-only
spawns (distill/sessionsum/runs-engine), traversal guards (inboxFile/resolveImages/safeDir/
serveArtifact) all hold, CSP+nosniff on artifacts/uploads. No new stream-'error' crash class
in the swept files (they use readFileSync, not createReadStream.pipe).

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C47 | assets/jarvistab.js:134 | Stale `J.shaped` runs the WRONG prompt after C4's new confidence-gated distill returns `''` (now common). `shape()` only sets `J.shaped` on success and never clears it on the `!out` failure path (line 134 flashes + returns); `shapedPrompt()` (line 141) reads `J.shaped || value`. Scenario: user shapes a long build request (J.shaped set), edits the box to a different short/ambiguous ask, clicks Shape → Haiku returns low-confidence `''`, user sees only "distiller returned nothing"; clicking ▷ run then fires the OLD shaped prompt silently. The other two jarvisDistill callers (run-composer.js:110, projectchat.js:196) got a jarvisTransform fallback this round — this caller was missed | on `!out`, `J.shaped = ''` (or fall back to `jarvisTransform(src)`) so shapedPrompt() uses the live textarea | S | med | ⬜ |
| C48 | assets/run-composer.js:131-132 | L3's optimistic user bubble is orphaned + composer left empty on POST failure. Line 103 renders `optimisticEl` and clears `ta.value`; the line-108 "run slipped in" race restores both, but the `catch` (131) and `r.error` (132) branches do NOT — they `addMsg(err)` and return, leaving a bubble that looks sent above an error, with the user's >60-word prompt gone from the box. Regressed from pre-L3 (bubble was drawn only after a successful POST) | in both failure branches: if `optimisticEl`, remove it (or mark failed) and `ta.value = prompt` before returning, mirroring line 108 | S | low | ✅ 2026-07-26 |
| C49 | lib/projects.js:340 + assets/projectchat.js:127 | `/api/projects/get` synchronously `readFileSync`+`JSON.parse`s EVERY .jsonl transcript in a claude-kind workspace (projectSessions, projects.js:225) on each call — and a detail-open fires it twice back-to-back (projectdetail.js:30 then projectchat mount→loadHistory at :127, which only wants `d.runs` and discards `sessions`); every project run calls it again (refreshAfterRun). On a large workspace (40+ multi-MB sessions) each call blocks the single-threaded event loop, stalling live SSE streams | add a runs-only path (`?runsOnly=1` skipping projectSessions, or a `/api/projects/runs` endpoint) for loadHistory/refreshAfterRun; chat panel never consumes `sessions` | M | low | ✅ 2026-07-26 |
| U22 | assets/overview.js:52 | `api('/api/overview')` is the only one of four parallel Overview calls without a `.catch` (runs/routing/usage all have one at :52-57). A transient 500/blip on /api/overview rejects the whole Promise.all → renderers.overview throws → app.js load() shows the generic "Couldn't load this tab" box, defeating the sibling calls' deliberate partial-render degradation | `.catch(() => ({}))` on the overview call + null-guard the `d.*` reads, mirroring the siblings | S | low | ✅ 2026-07-26 |

## Audit round — secondary pass 2026-07-26 (autopilot loop + voice subsystem + admin/utility + un-swept SPA)

Second four-agent read-only sweep over the territory the first pass didn't touch: the
self-improvement engine (autopilot/schedules/tasks — the code that dispatches these very
audits), the full client voice subsystem, the admin/utility endpoints, and the un-swept SPA
render modules. Headline finds (all re-verified against current source by the orchestrator):
the autopilot loop can DEADLOCK on a deleted run, will dispatch the deliberately-BLOCKED C43
first the moment it's armed, and the "commit all" button can stage `.mcp.json` MCP-env secrets
into git. C56 + C67 are promotions of prior verified-but-deferred prose items.

**Also verified, filed as prose (low-value / by-design, not rows):** voice.js:311 voice turns
paint the orb 'listening' not 'thinking' during model latency (cosmetic, recovers);
clientlog.js:33 non-atomic write is best-effort by the sink's own contract (bounded, self-heals);
schedules.js:32 + autopilot.js:50 saveState() use plain writeFileSync but have no out-of-band
reader so no torn-read could be constructed (consistency gap only, unlike C26/C45/C46).

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C50 | lib/autopilot.js:118 | `inflightCount()` counts a deleted/gone run as inflight FOREVER → whole loop deadlocks. When `d.runId` is set but `getRunMeta()` returns null (run deleted from history), `m` is null so `settled = !d.runId = false` → counted inflight; `dispatched[]` is never pruned so the count never drops. Scenario: two backlog items finish `done`, user deletes those runs → next tick `inflightCount()` returns 2 ≥ MAX_INFLIGHT, `tick()` returns before `pickNext()` permanently. The C25 "gone=settled" fix was applied to pickNext but not here | treat a set runId with missing meta as settled: `d.runId ? (m ? SETTLED.includes(m.status) : true) : true` | S | med | ✅ 2026-07-26 |
| C51 | lib/autopilot.js:65 | The `⚠️` blocked/needs-user glyph is read as OPEN, so autopilot burns runs on a known-unfixable item first. `done: /✅/.test(status)` treats anything without a ✅ as open; row C43 has status `⚠️ 2026-07-26 — see note` (fix blocked until a CUDA runtime is installed, which a run cannot do) → done=false → it's the first non-✅ table row so `pickNext()` returns it before C47/C49/U22. Guaranteed the moment autopilot is armed | open only if `/⬜/.test(status) && !/✅/.test(status)`; skip `⚠️`/blocked rows | S | low | ✅ 2026-07-26 |
| C52 | lib/autopilot.js:60 | `parseBacklog()` silently drops any row whose issue/fix/loc cell contains a `|` (raw `||`, a `/x|y/` regex, or escaped `\|`). The regex uses `([^|]*)` per column anchored on exactly 8 pipes; a 9th pipe fails the `^…$` match and the row vanishes — never dispatched, never counted in backlogOpen. The scout prompt actively tells agents to append rows describing code, so a queued fix mentioning a pipe is invisible forever | split the row on unescaped `|` (or handle `\|`) instead of one all-columns `[^|]*` regex | M | low | ⬜ |
| C53 | lib/autopilot.js:151 | Infra-error attempt-refund can defeat MAX_ATTEMPTS → unbounded retries on a genuinely broken item. On an `error` run whose excerpt matches INFRA_RE (ECONNRESET/ETIMEDOUT/rate-limit/503/529/"Unable to connect to API"…) one attempt is refunded, guarded only per-runId; re-dispatch builds a fresh dispatched[] with a new runId that doesn't carry the credit forward, so attempts oscillate 1→0→1→0. A fix whose failing verify output legitimately echoes one of those tokens re-dispatches every INFRA_BACKOFF window forever, burning opus/high budget | cap cumulative infra refunds per item, or classify infra only from CLI-level stderr not the model's result text | M | med | ✅ 2026-07-26 |
| C54 | lib/autopilot.js:82 | A human-cancelled backlog run is re-dispatched, overriding the cancel. The backlog retry set is `['error','cancelled','gone']` — includes `cancelled`, so a user who watches autopilot dispatch an item and cancels it gets it re-dispatched next tick (up to MAX_ATTEMPTS). Directly contradicts the A2 task branch (line 102: "cancelled stays skipped — that was a human decision") | drop `cancelled` from the backlog retry set at line 82, matching the task branch | S | low | ✅ 2026-07-26 |
| C55 | lib/autopilot.js:184 | Autopilot-created tasks are never pruned → tasks.json grows without bound over long unattended operation. Every backlog dispatch + retry calls `enqueue({source:'autopilot'})`; nothing deletes them, and `enrich()` (tasks.js:33) does a `getRunMeta` disk read per row on each `/api/tasks` GET, so the Tasks tab degrades linearly | cap/evict old settled source:'autopilot' tasks (keep last N), or don't persist a per-retry task | S | low | ✅ 2026-07-26 |
| C56 | lib/tasks.js:79 | `runAll()` silently skips any task whose linked run was deleted (prior DEFERRED — Scout round 3 — confirmed real, promoting). `m = t.runId ? getRunMeta(t.runId) : null; if (!t.runId || (m && settled && status!=='done'))` — if runId is set but the run was deleted, `m` is null so both branches are false: the task is never re-run by Run-all (the per-task Run button works, so it's stuck invisibly) | run when `!t.runId || !m || (settled(m.status) && m.status!=='done')` | S | low | ⬜ |
| C57 | lib/admin.js:105 | The "commit all" button stages MCP secrets into git history. `gitCommit()` runs `git add -A` (blanket-stages everything non-gitignored) then commits; `.mcp.json` is NOT gitignored (tracked, in listEditable) and `addMcp()` (admin.js:70) writes MCP `env` blocks — which routinely hold API keys — verbatim. User adds a connector with a key via Config → clicks commit → key lands in git history and any push. Commit-message path itself is safe (argv, no shell) | add `.mcp.json` to `.gitignore` (and/or keep MCP env out of the committed file); consider replacing `git add -A` with an explicit staged set + diff-before-commit | M | med | ✅ 2026-07-26 |
| C58 | lib/sessionsum.js:85 | Spawned Haiku child's stdout/stderr have no `'error'` handler (same crash class as C40). `child.on('error')` (line 87) is on the ChildProcess emitter (spawn failure only), not the stream emitters; a broken-pipe/fd 'error' on stdout is unhandled → uncaughtException → whole hub crashes. The sweep runs unattended on a 15-min timer + at boot | add `child.stdout.on('error',()=>{})` + `child.stderr.on('error',()=>{})` beside the data handlers (mirror C40) | S | low | ✅ 2026-07-26 |
| C59 | lib/settings.js:37 | `save()` uses plain `writeFileSync` (non-atomic) — missed by the C26/C45/C46 atomic-write sweep. A concurrent GET load() during a POST write can read half-written settings.json → safeJson null → app transiently falls back to DEFAULTS (hermesEnabled:false, plan snapshot resets); two concurrent POSTs lose one update; and `catch {}` swallows a failed write while returning the merged object so the client sees false success | atomic temp+rename mirroring lib/tasks.js save(); surface write failure instead of swallowing | S | low | ✅ 2026-07-26 |
| C60 | assets/voicetts.js:190 | iOS Kokoro-failure fallback starves the queue → conversation + orb stick. When a neural reply's first chunk fetch rejects mid-session, `speakCSM`'s onError calls `speakBrowser` — on iOS that async `speechSynthesis.speak()` is silently dropped, but speakBrowser returns true so drainSpeak waits on onend/onerror that never fire → `Q.active` stays true, `afterReply()` never runs, orb stuck on speaking/thinking, armWindow never closes. Only the wake word or a reload recovers | on mobile drive onDone off a max-duration timeout, or skip the browser fallback on isMobileDevice() and call onDone() directly so the queue drains | M | med | ✅ 2026-07-26 |
| C61 | assets/voiceconvo.js:148 | Bare-wake barge-in doesn't stick while the source run is still streaming — TTS resumes. Saying just "Jarvis" during speaking runs stopSpeak() + toPhase('open'), but a still-generating run's next onAssistantText → replyText still passes `text && wantSpeak()` (V.call true) → enqueueSpeak restarts speaking a beat later | mark the in-flight run/generation muted on barge-in (a per-run flag replyText checks), not just clear the queue | M | med | ✅ 2026-07-26 |
| C62 | assets/voiceconvo.js:149 | Jarvis interrupts himself when STT returns a fuzzy near-miss of his own name. `isEcho()` self-bleed filter is exact-substring vs replyTail, but the wake gate `wakeRe()` matches variants (jarvas/jervis/javis/…); when he speaks "Jarvis" and the recognizer hears "jarvas", isEcho misses it while wakeRe matches → self-barge-in cuts his own reply | run the self-echo check through the same fuzzy name-normalization as wakeRe (or normalize wake variants before the echo compare) | S | low | ✅ 2026-07-27 |
| C63 | assets/voicecfg.js:80 | Switching TTS engine mid-reply mixes voices + injects a cold-start gap. `#vEngine.onchange` sets store.engine but never calls stopSpeak(); a Kokoro reply mid-ChunkPipeline keeps draining and each later chunk re-reads store.engine at call time, so played chunks are Kokoro while the remainder switch to CSM — half-and-half reply + CSM ~4.5s cold-start silence mid-sentence | call stopSpeak() in the engine onchange handler (mirrors Start/Stop/Test) | S | low | ✅ 2026-07-27 |
| C64 | assets/voicecfg.js:76 | The browser "Test voice" button bypasses the queue/barge-in. `#vTest.onclick` calls speakBrowser directly; if a neural reply is draining, SS.cancel() doesn't touch the CSM audio element so the test overlaps the live reply with two voices, and its onend can desync the orb from the still-running queue | route the test through stopSpeak() first (as #vCsmTest does) or through the queue | S | low | ✅ 2026-07-27 |
| C65 | assets/voicetts.js:112 | A single sentence longer than the server's 1200-char slice is silently truncated with no "rest on screen" hand-off. Client cap (2400) applies first, then csmChunks splits on sentence boundaries; one long boundary-less sentence becomes a >1200-char chunk that `/api/voice/tts` slice(0,1200)s server-side, dropping the tail with no spoken marker (the affordance only fires on the 2400 cap). Contradicts the C5 anti-clip intent | hard-split chunks to ≤~1000 chars in csmChunks before fetch, or relax the server slice for chunked callers | S | low | ✅ 2026-07-27 |
| C66 | assets/voicecore.js:75 | primeAudio can raise an unhandled rejection on the first mobile gesture. `const p=el.play(); if(p&&p.catch)p.catch(()=>{})` handles p, but `Promise.resolve(p).finally(...)` creates a separate derived promise with no rejection handler; if play() rejects (autoplay/device-change) that derivation rejects unhandled | chain the .finally onto the already-caught promise, or wrap in .catch(()=>{}) | S | low | ✅ 2026-07-27 |
| C67 | assets/runrender.js:37 | Module-scope `toolEls` (tool_use id → detached `<pre>`) is never cleared on newChat/openRun → detached-DOM leak (prior DEFERRED — confirmed real, promoting). newChat resets #chatLog via innerHTML but nothing deletes toolEls entries, so every tool_use across every run this page-session keeps a live ref to a now-detached node; slow unbounded memory climb over a long multi-run session | clear toolEls in newChat() (and at top of openRun's replay): `for (const k in toolEls) delete toolEls[k]`, or hang the map off `chat` so it dies with the conversation | S | low | ✅ 2026-07-27 |

## Scout round — 2026-07-27 (replenishment: sharepoint/xlsx + projects/persona + core engine)

Three parallel read-only reviewers over territory the 07-26 rounds didn't finish: the
SharePoint/Excel subsystem, the projects/persona/distill pipeline, and the core run engine
post-C57..C61. Headline: the unhandled stream-'error' crash class (fixed piecemeal in
C28/C29/C35/C40/C58) is still open at FOUR more spawn/request sites — including the main
claude-run child itself, where a simple run-cancel taskkill can crash the whole hub.
Verified against current source before filing. Low-value finds left as prose: files.js:18
dead `^\.+$` regex inside the sanitizer OR-chain and the files.js vs sharepoint.js
sanitizer near-duplication (cosmetic; fold into util.js whenever either is next touched).

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C68 | lib/runs-engine.js:170 | Main claude-CLI child's stdout/stderr streams have no 'error' handler (child.on('error') covers spawn failure only) — cancelling a run force-taskkills the tree mid-write and an unhandled pipe 'error' is an uncaughtException that crashes the whole hub, killing every other in-flight run. Same class as C28/C40/C58, missed on the highest-traffic spawn path | add child.stdout.on('error',()=>{}) and child.stderr.on('error',()=>{}) beside the data handlers | S | low | ✅ 2026-07-27 |
| C69 | lib/acp.js:81 + lib/util.js:102 + lib/distill.js:93 | Same missing stream-'error' guard at the three remaining spawn sites: hermes ACP child (cancel/killTree races a mid-flight turn), shared U.run() helper (timeout kill() races flushing output), and the distill Haiku child — any pipe/fd error downs the hub | same one-line stdout/stderr 'error' no-op guards at each site, mirroring sessionsum.js:90 | S | low | ✅ 2026-07-27 |
| C70 | lib/sharepoint.js:43 | Graph request() wires req.on('error') but the response stream gets only data/end listeners — a connection drop mid-response (VPN reconnect, proxy RST) during any Graph call, device-code poll, or chunked upload emits an unhandled 'error' on res and crashes the hub; download() at :77 already carries the guard | add res.on('error', reject) inside the https.request callback | S | low | ⬜ |
| C71 | lib/personas.js:92 | writeState() plain-writeFileSyncs data/personas.json — a crash/kill mid-write leaves a truncated file, safeJson reads null, and the hub silently reverts to the default jarvis persona losing active-persona choice, display order, and any pending handoff. Same torn-write class as C26/C45/C46/C59, missed here | atomic temp+rename mirroring lib/tasks.js save() | S | low | ⬜ |
| C72 | lib/sharepoint.js:218 | indexStats/indexTree/browseIndex/searchIndex each readFileSync+JSON.parse the full sharepoint-index.json per call — searchIndex fires per debounced keystroke and the status poll every 3s during device-code login, so a multi-MB index re-parses on the event loop several times a second, stalling live SSE run streams | cache the parsed index in memory keyed by file mtime; invalidate when buildIndex() rewrites it | M | low | ⬜ |
| C73 | lib/xlsxcells.js:1 (via lib/files.js:128) | Every /api/files/xlsx sheet request fully re-unzips the workbook and synchronously re-parses sharedStrings/styles/theme (up to 40MB) — switching sheet tabs on a large workbook blocks the single-threaded hub each time, stalling any concurrent run's SSE stream | cache parsed zip entries + sharedStrings/styles per path+mtime and reuse across sheet requests | M | med | ⬜ |

## Scout round 2 — 2026-07-27 (replenishment: C61-C64 diff review + never-swept SPA/lib modules)

Three parallel read-only reviewers: (a) diff review of the C61-C64 voice-fix commits,
(b) never-swept SPA modules (live/lists/sheetgrid/agentviz/runhistory/jarvischat/memory/
graph non-viz), (c) least-swept lib modules (usage/diagnose/sources/clientlog/hermes/
agentgraph/runs-query/runs-route). Headline: C62's own fix introduced a regression — the
fuzzy wake-variant list contains "travis", so a reply mentioning the name Travis poisons
the self-echo tail and swallows the user's next genuine "Jarvis" wake word. Verified but
NOT queued (prose only): assets/live.js:59-84 stale poll response can repaint the feed
with the previous session for up to one 2s tick after a session switch (self-corrects);
lib/clientlog.js:41 non-atomic read-modify-write can drop one error record under
concurrent POSTs (diagnostic-only ring buffer — accepted risk, matches prior round's
call). Ruled out: sheetgrid/runhistory/lists/memory/jarvischat clean (listeners, catches,
CLICKABLE_SEL coverage all verified); usage/diagnose/sources clean; C61 mute-flag
lifecycle, C63/C64 stopSpeak routing, and CSM chunk staleness all verified correct;
okId/traversal guards consistent across agentgraph/runs-route.

| id | file:line | issue | fix | effort | risk | status |
|----|-----------|-------|-----|--------|------|--------|
| C74 | assets/voiceconvo.js:58-70 + assets/voice.js:79 | C62 regression: noteReply canonicalizes the assistant's own reply through the FULL fuzzy wake list, which includes "travis" — a reply mentioning the name Travis writes "jarvis" into S.replyTail, so the user's next bare "Jarvis" wake word matches isEcho() (checked before the wake test in onSpeech) and is consumed instead of barging in; before C62 that false positive could not occur | canonicalize the reply tail with only the exact configured wake word (no misrecognition variants), or drop real-word collisions like "travis" from the echo-side fuzzy list | S | low | ⬜ |
| C75 | lib/hermes.js:83-92 | launchOneshot wires child.on('error') only — stdout/stderr stream emitters have no 'error' handler, so with HUB_HERMES_ENGINE=oneshot (the documented headless config) an EPIPE/fd error on either pipe is an uncaughtException that crashes the whole hub. Same class as C58/C69, missed on this spawn path | add child.stdout.on('error',()=>{}) and child.stderr.on('error',()=>{}) beside the data handlers, mirroring sessionsum.js | S | low | ⬜ |
| C76 | lib/agentgraph.js:204-215 + lib/runs-route.js:90-96 | Two unbounded synchronous full-history scans: the /api/agentgraph no-id branch (hit every 3s by the Graph tab's default unpinned poll) readdirs RUNS_DIR and readFileSync+parses EVERY run's meta.json — nothing ever prunes data/runs, so the stall grows monotonically and blocks SSE streams; sessionModel's disk fallback in runs-route does the same full walk on a no-match sessionId | bound both scans to the newest N run dirs (names are ISO timestamps — reverse-sorted slice), mirroring statsToday's date-prefix approach | S | low | ⬜ |
| C77 | assets/graph.js:79 | api('/api/graph/data').then(...) has no .catch — a 15s timeout or transient server blip rejects unhandled and #graphViz sits on "Loading graph…" forever with no retry (the sibling ask() in the same file try/catches and shows a message) | wrap in try/catch and render an error/retry state into #graphViz, mirroring ask() | S | low | ⬜ |
| U23 | assets/graph.js:9-22 + assets/app.js:166 | The Agents/Codebase mode toggle and Modules/All-symbols view toggle are plain spans with only onclick using data-m/data-v, which match nothing in CLICKABLE_SEL — the auto-a11y observer never grants tabindex/role/keys, so keyboard users cannot switch Graph views at all | add .pill[data-m],.pill[data-v] to CLICKABLE_SEL (observer covers the rest for free) | S | low | ⬜ |
| U24 | assets/agentviz.js:16-47 | renderAgentViz stops the old poll, then awaits fetchAgentGraph, then installs aviz.poll — switching to Codebase map during that await means setMode's stopAgentViz fires before the interval exists, and the resolved await installs an orphaned 3s /api/agentgraph poller that runs until Agents mode is next entered; rapid toggles stack several | after the await, bail out (skip poll+drawLoop) if #avCanvas is no longer in the DOM | S | low | ⬜ |
