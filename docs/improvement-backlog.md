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
| C42 | lib/agentgraph.js:83 | hermes-vs-ACP engine detection is a substring regex over the ENTIRE raw output.jsonl: `!/"tool_use"\|"type":"assistant"/.test(raw)` — a legacy -z oneshot whose answer TEXT happens to contain `"tool_use"` or `"type":"assistant"` (e.g. the user asked about Anthropic API message shapes) skips buildHermesGraph; the claude-builder then finds no assistant/user events (real shape is hermes_out) and the Graph tab renders a bare root instead of the Maestro+crew ring | parse lines as JSON and test `o.type` values instead of a whole-file substring match | S | low | ⬜ |
| U20 | assets/jarvistab.js:32,59 | loadPersonas() and switchPersona() `await api(…)` with no try/catch (pollTranscript in the same file guards its calls — these were missed). A transient /api/personas failure while opening the Jarvis tab throws out of renderers.jarvis, and app.js load()'s catch-all replaces the ENTIRE built tab (orb canvas, composer, controls) with the bare "Couldn't load this tab" box; a failed activate POST from a persona card (jarvispersonacards.js calls activate with no .catch) becomes an unhandled rejection — the card silently does nothing, no flash | try/catch both: loadPersonas falls back to `J.personas = []` + flash; switchPersona failure → `flash('✗ …', true)` | S | low | ✅ 2026-07-26 |
| U21 | assets/files.js:10-18 | #dropzone is mouse-only: `onclick → fi.click()` with no tabindex/role/keydown, it matches nothing in app.js CLICKABLE_SEL (line 163) so the auto-a11y observer never upgrades it, and the backing #fileIn is display:none (unfocusable) — keyboard-only users cannot open the file picker on the Files tab at all | give the dropzone `role="button" tabindex="0"` + Enter/Space → fi.click() (mirror the .fcard-head.can pattern at files.js:117), or add `.dropzone` to CLICKABLE_SEL | S | low | ✅ 2026-07-26 |
