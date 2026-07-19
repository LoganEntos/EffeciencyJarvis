# Autonomy log — 2026-07-19 (Fable 5 → Opus 6h improvement run)

Ground truth for the Fable 5 orchestrator. One entry per queue item. Never
claim what the commit doesn't show.

---

## R3 — Auto session summaries ✅ shipped

**Commit:** `970a3a9`

**What shipped.** The Sessions view no longer needs a manual "Summarize with
Claude" click (which just prefilled a full run). New server module
`lib/sessionsum.js` runs a cheap Haiku one-shot over each session's transcript
tail and writes a 2-3 sentence debrief, cached on disk in
`data/session-summaries.json` keyed by id + size — so a closed/unchanged session
is never re-summarized. Two fill paths: a low-frequency background idle sweep on
boot (`startSweep`, wired in `server.js`, idle sessions only so the live session
isn't re-summarized on a timer), and the Sessions tab which auto-POSTs any
on-screen session missing a summary when opened (zero clicks). Endpoints:
`GET /api/session-summaries`, `POST /api/session-summaries/build {ids}` (token-
guarded, capped 12). Client renderer in `assets/app.js` shows the summary inline
under each row with a "Summarizing…" placeholder that fills in, plus a
"↻ Re-summarize" affordance. `core.js` now exports `sessions` + `sessionTail`.

**Gotcha found + fixed (important for the next worker).** The hub's own headless
one-shots — this summarizer AND the distiller (`lib/distill.js`) — each spawn
`claude -p` with `cwd = PROJECT_DIR`, which makes the CLI write a transcript into
this project's session folder. Those show up as "sessions" whose only content is
our system prompt echoed back, so summarizing them fed our prompt to Haiku, which
then refused ("please paste the actual transcript"). Fixed by detecting those
internal one-shots via marker text and labeling them ("Hub internal one-shot
(distill/summary) — not a coding session.") instead of calling Haiku, plus a
refusal regex that drops any residual pushback rather than caching it. Real
coding sessions get accurate debriefs (verified: the live session summarized its
own R3 work correctly).

**Verification.** `node claude-dashboard/server.js 5759` throwaway instance;
built real summaries via the tokened endpoint (Haiku calls succeeded); browser
screenshot of `?tab=sessions` (via scrapling) shows summaries rendering inline
under each row with the clean-dark amber theme intact. Smoke script green on
5759 with two new checks added (`GET /api/session-summaries`,
`POST …/build` 403-without-token). 5757 (user's live server) left untouched;
throwaway stopped after verifying.

**Follow-up left for later (not done — out of R3 scope).** The Sessions list is
noisy: the hub's distill/summary one-shots pile up as extra "sessions." They're
now cleanly labeled, but a future item could filter hub-internal one-shots out
of `sessions()` (core.js) entirely so the list only shows real coding sessions —
this would also declutter the Overview activity feed. Left untouched to avoid
regressing `/api/sessions` / `/api/activity` mid-item.

---

## R4 — Files: image thumbnails + day grouping ✅ (already shipped + enhanced)

**Commit:** `__R4_HASH__` (enhancement) — core was already shipped in `b63479c`.

**Found already done.** The queue lists R4 as pending, but its acceptance
criteria were already met and committed in `b63479c`: `assets/files.js` groups
the inbox by upload day (Today / Yesterday / weekday / date via `dayLabel`) and
renders image thumbnails through the traversal-guarded, CSP-sandboxed
`/api/files/view` endpoint in `lib/files.js`. CSS (`.file-daygroup`,
`.file-thumb`) was in place. Verified in-browser on 5759 with 92 inbox files
spanning several days: day-group headers and thumbnails render, theme intact.

**Enhancement shipped this pass.** The one real gap vs R4's stated intent ("you
must be able to see what context the AI was given") was that thumbnails were
32×32 — too small to recognize. Bumped to 44px with a hover cue, and made them
**click-to-enlarge** into a full-size lightbox (`#imgLightbox`, backdrop/Esc to
close), served through the same `/view` path. Confirmed the endpoint serves the
full image (200 image/svg+xml), still blocks traversal (404) and non-images
(400). Smoke green on 5759.

**Note for orchestrator.** R4 needed no server changes — the endpoint and guards
already existed. Two temporary test SVGs were added to `data/inbox/` for the
browser check and deleted afterward (inbox is back to the user's real files).
