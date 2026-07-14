# Improvement Backlog

> Plain-text backlog. **Rule (user, 2026-07-11):** never render reports as HTML
> webpages/artifacts — findings live here as Markdown or as concise text in the
> reply. Genuine dashboard UI work is exempt (that's the product).

Two audits ran 2026-07-11 (code-reviewer + ui-designer subagents over
`claude-dashboard/`). Ranked, most valuable first. Status: ⬜ todo · ✅ done.

## Code quality / robustness

| # | File:line | Issue | Fix | Effort | Risk | Status |
|---|-----------|-------|-----|--------|------|--------|
| C1 | lib/runs.js (509 lines) | Over the hard 500-line rule | Split read-side (artifact list/serve, transcript, routingStats) into `lib/runs-query.js` | L | med | ✅ 2026-07-14 |
| C2 | lib/runs.js `launch()` (~90 lines) | Tangles spawn + stdout parsing + close handler | Extract `onStdoutLine()` / `onExit()` | M | med | ✅ 2026-07-14 |
| C3 | lib/agentgraph.js:105 | Persona lookup was exact-key, so pinned model versions (claude-opus-4-8, fable-5) mislabeled "Claude / default" in Graph | Substring resolver `personaFor()` (+fable persona) | S | low | ✅ 2026-07-11 |
| C4 | lib/memory.js | Episodic-record object built identically in `captureRun()` and `reindexRuns()` | Extract `buildEpisodicRecord(meta, prompt)` | S | low | ⬜ |
| C5 | runs.js / tasks.js / schedules.js | Model allowlist hand-copied 3×; a new pinned model never becomes selectable elsewhere | Export one `SIMPLE_MODELS` (or MODELS) and import | S | low | ⬜ |
| C6 | assets/graph.js `drawGraphViz()` (~185 lines) | Mixes physics/render/hit-test/tooltip/inspector | Extract `runForceLayout()` + `NodeInspector` | L | med | ⬜ |
| C7 | lib/agentgraph.js | Artifacts-node + star-links copy-pasted between the two graph builders | Extract `makeArtifactsNode()` / `starLinks()` | S | low | ⬜ |
| C8 | assets/run.js | Queued-timer/attach block duplicated in `sendPrompt()` and `openRun()` | Extract `attachLiveRun(id, opts)` | S | low | ⬜ |
| C9 | lib/tasks.js `runAll()` | Dead `continue` branch that can never fire | Delete it | S | low | ⬜ |
| C10 | assets/voice.js `speakCSM()` | Interleaves chunk/fetch/play/fallback | Extract a `ChunkPipeline` helper | M | med | ⬜ |
| C11 | lib/util.js `run()` | Fragile `finish(-1, out += ...)` relying on a discarded arg | Two statements | S | low | ⬜ |
| C12 | lib/voice.js + scripts/*.py | csm/kokoro sidecar HTTP boilerplate duplicated | Share a tiny handler base if a 3rd engine lands | M | low | ⬜ |
| C13 | assets/voice.js (498 lines) | Near the 500-line limit after voice work — no more may go in | Move a block out (e.g. into voicecfg or a helper) before next voice edit | S | low | ⬜ |

## UI / UX

| # | File:line | Issue | Fix | Effort | Impact | Status |
|---|-----------|-------|-----|--------|--------|--------|
| U1 | index.html:24-37 + clickable cards/chips | Not keyboard-reachable — nav `<a>` has no href; clickable cards/chips/filters are bare div/span with only `onclick`, no tabindex/role/focus ring | Real `<button>`/`role`+`tabindex`+focus styles | M | high | ⬜ |
| U2 | index.html:24-37 | Nav uses raw Unicode glyphs (▷ ☰ ⇪ …) despite 1700 vendored Lucide icons already shipped | Swap to `/vendor/icons/lucide-sprite.svg#…` | M | med | ⬜ |
| U3 | assets/voicecfg.js:43-56 | Voice engine selector (Browser/Kokoro/CSM) — the most consequential voice setting — is an undersized plain `<select>` buried in a dense row | Promote to a prominent segmented control | S | med | ⬜ |
| U4 | assets/voice.js:170 vs style.css:3 | Mic orb paints "listening" GREEN, violating the app's own "green = success only" rule; 38×38 orb breaks the 32×32 header rhythm | Distinct non-green listening color; align size | S | med | ⬜ |
| U5 | assets/style.css:91 | One flat 12px `h2` for both page titles and subsections — no tab gets a hero moment (against "big size jumps" rule) | Add a page-title scale | M | med | ⬜ |
| U6 | — | 7 more ranked UI findings + a "what's working" section (from the audit) | see reply notes | — | — | ⬜ |

## Voice engine (this session — UNVERIFIED, pending user install)
- Kokoro-82M fast engine added (scripts/kokoro-server.py, generalized lib/voice.js
  ENGINES table, 3-way picker in Config). Needs `.kokoro/venv` install + browser test.
- Wake-word gate ("Suzy") added to the call loop. Needs real-mic test.
