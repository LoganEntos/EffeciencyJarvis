# Handoff — Finalize the Jarvis-tab overhaul

**Status: DONE (2026-07-16, commit `fbc1fee`).** All four defects fixed, HUE
hoisted to `jarvis.js`, smoke extended to 88 checks. Kept for the record.

**Paste everything below the divider into a fresh Claude Code / hub thread.**
Sibling docs to skim first: `jarvis-ui-port.md`, `persona-manager-ui.md`.

---

You are picking up the Jarvis-tab overhaul in `C:/Users/logto/Documents/claude-hub/`. The port from the Lovable amber-agent-orb build already landed (commits `682c63e`, `c30fa91`). A prior review split the tab into modules and produced a finalize plan. Your job is to close it out — fix the small real bugs, answer the five open questions with the user, extend the smoke script, browser-verify at `127.0.0.1:5757`, update docs, and ship one clean commit. No push.

## Pending state in the working tree
```
 M claude-dashboard/assets/jarvis.css        (221 L, +77)
 M claude-dashboard/assets/jarvistab.js      (402 L, heavy rewrite)
 M claude-dashboard/index.html               (+2 script tags)
?? claude-dashboard/assets/jarvischat.js     (122 L, new)
?? claude-dashboard/assets/jarvisorb.js      (186 L, new)
```
`claude-dashboard/assets/jarvis.js` (106 L) is untouched — it is the SHARED helper layer used by both `run.js` and `jarvistab.js` (`initJarvis`, `analyzePromptComplexity`, `jarvisDistill`, `DISTILL_MIN_WORDS`). Do NOT delete it.

## Hard rules (from `CLAUDE.md`)
- Zero npm deps. Vanilla JS/CSS, Node built-ins only.
- Every file &lt; 500 lines. `jarvistab.js` at 402 has 98 lines of runway — do not push it over.
- Security invariants intact: `X-Hub-Token` on all non-GET (use `api()`); artifact CSP sandbox; path-traversal guards; argv-array spawns.
- Localhost only (127.0.0.1). No CORS, no CDNs.
- Read a file before editing it. Never commit secrets.
- Report findings as plain chat text or a committed `.md` — never a styled HTML page.
- Commit message: no `Co-Authored-By` trailer. Do NOT push.
- NEVER kill/restart the process on 5757 (it may be hosting a live run). If you need to verify a server-side change, boot a throwaway on 5758.

## Confirmed clean during review (do not re-litigate)
- No React residue (`useState/useEffect/handleXChange` — 0 hits).
- No CDN URLs, no `eval`, no `new Function`, no `document.write`.
- All `fetch` calls go through `api()` (token wrapper) — jarvistab lines 66, 248; jarvischat line 78.
- All `innerHTML` interpolations are `esc()`-wrapped or hard-coded strings.
- Script order in `index.html` is correct: `jarvisorb → jarvistab → jarvischat` (tab defines `window.jarvisHooks` before chat wires).
- Module naming (`jarvis*.js` cluster) is consistent with existing `voice*.js` / `run*.js` clusters — no rename needed.

## Real defects to fix
1. **Transcript-poller pause never resumes after send.**
   `jarvischat.send()` calls `jarvisHooks.pauseTranscript()`, but the SSE `done` and `onerror` handlers never call `resumeTranscript()`. Only `newChat()` resumes. Add resume in both handlers — one line each.
2. **Send button stays disabled if the stream errors.**
   `btn.disabled = true` is set on send and cleared on `done`. Add a reset inside `es.onerror` (in the `!S.running` branch is fine).
3. **Holding-in-context uses the wrong session id.**
   `jarvistab.js:151` (`renderHolding`) reads `chat.sessionId` (Run-tab chat). Prefer `window.jarvisChat.sessionId() || chat.sessionId` so the panel anchors to the in-tab session when one exists.
4. **Duplicate `HUE`/`hueOf` consts** exist in both `jarvistab.js` (lines 20-21) and `jarvisorb.js` (lines 11-12). Hoist to `jarvis.js` and read from there.

## Five questions to ask the user before committing
Q1. Rename `jarvis.js` (now a cross-tab shared helper, not tab-scoped) to something like `promptshape.js`? Or keep the name.
Q2. Confirm the four defects above are all in-scope for this commit (recommend yes — they're small).
Q3. `jarvisorb.js` `pullAudio()` reads `O.audio.analyser`, but nothing ever assigns `O.audio`. Two paths: (a) leave the dormant hook and file a follow-up to have `voice.js` set `window.jarvisOrb._audio` when a mic is granted; (b) delete the stub now to remove dead code. Which?
Q4. Merge `jarvis.css` into `style.css`? Recommend NO — `style.css` is already 506 L (over cap by 6), merging pushes to 727 L. Keep separate, and file a separate cleanup ticket for the `style.css` overrun. Confirm.
Q5. Commit message shape: `"Jarvis tab: split orb + in-tab chat into own modules; per-persona ambient hue; poller resume fix"` — good, or rewrite?

## Finalization gate (run in order)
1. Extend `scripts/verify-dashboard.ps1` — add two Check lines next to the existing jarvistab/jarvis.css greps (~lines 60-61):
   ```powershell
   Check "GET /assets/jarvisorb.js"  "$base/assets/jarvisorb.js"
   Check "GET /assets/jarvischat.js" "$base/assets/jarvischat.js"
   ```
2. Run `scripts/verify-dashboard.ps1 -Port 5757` — green across the board.
3. Browser verify at `http://127.0.0.1:5757` (server is already running on 5757, DO NOT restart it):
   - DevTools Network: `jarvisorb.js`, `jarvistab.js`, `jarvischat.js` all 200, no console errors, no CSP warnings.
   - Jarvis tab: orb renders, personas populate, switching persona changes ambient hue and nameplate.
   - Distiller: type &gt;25 words, ✦ shape → shaped prompt appears; ▷ run this → jumps to Run tab and fires.
   - In-tab chat: send a short prompt → assistant bubble streams with caret; tool blocks render; ✓ done footer appears. After `done`, confirm the transcript panel keeps refreshing (verifies fix #1).
   - `+ new` → transcript clears, poller resumes.
4. Screenshots in BOTH themes (clean-dark default + warm via `◐`): full Jarvis tab, orb close-up, chat mid-stream, distiller with a shaped prompt. Save under `claude-dashboard/screenshots/` and note file names in the docs update.
5. Docs update:
   - `docs/roadmap.md` — mark Jarvis-tab overhaul row DONE.
   - `docs/handoffs/jarvis-ui-port.md` — postscript: split into `jarvistab + jarvisorb + jarvischat`, with current line counts; note that `jarvis.js` remains the cross-tab helper.
   - `HANDOFF.md` — one-liner summarizing what shipped + the natural next split if `jarvistab.js` grows past ~450 L (extract the soul editor into `jarvissoul.js` ~60 L back, or the persona-card render into `jarvispersonas.js` ~50 L back).
6. `git add` the five files + smoke script + docs, commit with the message from Q5. **Do NOT push.**

## Deliverable
End-of-run reply in chat (plain text, no HTML): the commit sha, the browser-verify screenshot filenames, and a one-line status per defect (fixed / deferred with reason).
