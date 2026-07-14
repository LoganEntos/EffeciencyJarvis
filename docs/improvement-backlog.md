# Improvement Backlog

> Plain-text backlog. **Rule (user, 2026-07-11):** never render reports as HTML
> webpages/artifacts — findings live here as Markdown or as concise text in the
> reply. Genuine dashboard UI work is exempt (that's the product).

## Self-improvement round — 2026-07-14

Fresh source trace of `server.js` + `lib/*.js` + `assets/*.js` (no app run, no
sub-subagents). Format: `[P1|P2|P3] title — file:line — failure — fix`.
P1 = correctness/security/hard-rule, P2 = mobile/voice or notable UX, P3 = polish.

### P1 — correctness / security / hard-rule

- [P1] voice.js is 603 lines, over the 500-line hard rule — `assets/voice.js:1-603` — CLAUDE.md forbids files >500; it blocks the "split before the next voice edit" carryover (C13) and is now +103 over — extract the earcons + the whole CSM chunk pipeline (`csmChunks`/`speakCSM`/`playBlob`) into a new `assets/voicecore.js` loaded before voice.js.
- [P1] run.js is 501 lines, 1 over the hard rule — `assets/run.js:1-501` — same 500-line invariant; any further edit pushes it further over — move `renderUsageGauge()` (or the artifacts block `showArtifacts`) into its own helper file.
- [P1] Stale voice talk-back: `chat.lastText` is never cleared between prompts — `assets/run.js:347 sendPrompt / 410 finishRun / 436 newChat` — a run that ends with only tool_use and no final text bubble leaves `chat.lastText` holding the PREVIOUS reply, so mobile auto-read / call mode speaks the old answer aloud — set `chat.lastText=''` in `sendPrompt()` (and `newChat()`).
- [P1] Number-key tab shortcuts are off-by-one after SharePoint — `assets/app.js:97,146-147` vs `index.html:38-55` — `TABS` is built from every `nav a` (SharePoint included, but it has no `<kbd>`), so key `5`→SharePoint (label says Sessions), `6`→Sessions, … `0`→Agents (label says Skills); every printed hint from 5 onward is wrong — drive the shortcut off each anchor's own `<kbd>` digit instead of array index.
- [P1] Uploaded SVG served inline, script-executable, same-origin — `lib/files.js:168-180` (`/api/files/view`) — an `.svg` in the inbox is returned as `image/svg+xml` with no CSP/sandbox and no `Content-Disposition`; opening its URL directly runs the SVG's inline `<script>` in the hub's own origin, where it can read the token-bearing index.html and fire mutating calls — drop `svg` from the inline-view allowlist (force it through `/api/files/download`) or send the artifact-style `Content-Security-Policy: sandbox`.

### P2 — mobile / voice / notable UX

- [P2] Mobile auto-read silently dies when the Kokoro sidecar is offline — `assets/voice.js:337-338, 406-453` — on a phone with the default `browser` engine, `speak()` routes to `speakCSM`→Kokoro; if Kokoro isn't installed/running (needs a 340 MB download + venv) the first-chunk `.catch` falls back to `speakBrowser`, which is exactly the iOS-blocked async path — so the "we fixed iOS auto-read" path produces no sound and no message — probe `/api/voice/status?engine=kokoro` once on mobile and surface a one-time "install/start Kokoro for spoken replies" notice instead of a dead fallback.
- [P2] primeAudio speaks an audible primer on every device, incl. desktop — `assets/voice.js:477-503` — it fires `SS.cancel()` + a `volume:0.05` utterance on the first gesture unconditionally; on desktop that's an unnecessary faint blip that can also clip the first earcon — gate the audible-primer branch behind `isMobileDevice()` (desktop can keep the silent audio-element unlock only).
- [P2] `isMobileDevice()` keys off `max-width:820px` — `assets/voice.js:521-527` — an iPhone in landscape (~844px) fails the width test, so auto-read turns itself off when the phone is rotated — test `(pointer:coarse) and (hover:none)` instead of a pixel width.
- [P2] Voice engine picker (Browser/Kokoro/CSM) is still a buried `<select>` — `assets/voicecfg.js:45-49` — the most consequential voice setting sits mid-row in a dense flex block (backlog U3, still open) — promote to a labelled segmented control.
- [P2] Nav still renders raw Unicode glyphs (▷ ☰ ⇪ ⊞ …) — `index.html:38-55` — 1700+ Lucide icons are vendored at `/vendor/icons/lucide-sprite.svg` but the primary nav uses inconsistent-weight typographic glyphs (backlog U2, still open) — swap to `<svg><use href="/vendor/icons/lucide-sprite.svg#…"/></svg>`.

### P3 — polish

- [P3] Result token count under-reports input — `assets/run.js:270` — the chat result line sums `input_tokens + cache_read_input_tokens` but omits `cache_creation_input_tokens` (server-side meta at runs.js:294 includes it), so the displayed `→tok` disagrees with history — add the cache-creation term.
- [P3] `sessionModel()` disk-scans every run on each `auto` resume — `lib/runs.js:66-74` — reads every `runs/*/meta.json` synchronously to find one sessionId; fine now, O(n) as history grows — index sessionId→model or read newest-first and break.
- [P3] Deleting the last file in a project subfolder orphans the empty folder — `lib/files.js:223-231` — `/api/files/delete` unlinks the file but leaves `inbox/<project>/`, so the project keeps showing in `listFiles()` groupings — `rmdir` the parent if it's emptied.
- [P3] Mobile width thresholds inconsistent across modules — `assets/app.js:52 (760) vs assets/voice.js:525 (820) vs style.css:349 (760)` — "is this a phone" is decided three different ways — settle on one shared breakpoint/helper.
- [P3] Header nav toggle glyph `☰` duplicates the Tasks tab glyph `☰` — `index.html:23,40` — same symbol for two different affordances reads as a mistake on desktop — differentiate.


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
| U10 | assets/style.css:145-150 | The single page-load stagger is misaligned after SharePoint + the Library group were added: the `nth-child` delays assume `.navlabel` divs at children 6/11, but they now sit at 8/12 — so SharePoint (child 6), Graph (child 11) and Assets/Sources/Tools/Config (16-19) reveal with **zero** delay while a label div gets a delay it can't use | Re-key the reveal to the anchors themselves — e.g. `nav a{animation-delay:calc(var(--i)*.03s)}` with an index set in JS, so it survives future nav edits | S | low | ⬜ |
| U11 | assets/style.css:406 | Mobile bottom-bar tab labels render at **8.5px** `.txt`, below the legibility floor the rest of the M1 mobile pass raised everything else to; the accompanying comment ("15 tabs / row 2 centers the remaining 7") is also stale — there are now 16 tabs, an even 8+8 | Bump label size (≥10px) or drop the label under the active tab only; refresh the stale comment | S | low | ⬜ |
| U12 | assets/style.css:125,180 | `nav .navlabel` and `.card .l` render weight-200 mono at 10px in `--dim` (~#6d6455 on #0c0b0a ≈ 3:1), under WCAG's 4.5:1 for text — the "extreme weights" rule shouldn't cost readability on functional labels | Raise those two label roles to `--muted`, or lift size/weight until they clear 4.5:1 | S | low | ⬜ |
| U13 | assets/style.css:190 (runbar selects) | The Run-tab engine/model/perms pickers are still bare native `<select>`s — only the TTS engine got the U3 segmented control; their OS popup ignores the amber theme and mono font, the same "buried select" critique U3 raised | Add a custom chevron/affordance to the closed control, or promote the most-used picker (perms) to a segmented control for consistency | S | low | ⬜ |

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
- Wake-word gate ("Suzy") added to the call loop. Needs real-mic test.
