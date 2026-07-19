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

**Commit:** `0306a45` (enhancement) — core was already shipped in `b63479c`.

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

---

## R2 — Navigable libraries ✅ shipped

**Commit:** `46dfc67`

**What shipped.** Agents, Skills, and Commands were already filterable but flat.
All three share one function (`listView` in `assets/app.js`), so enhancing it
once gives the "one consistent filter UI across the three" the item asked for.
Now each tab has: a toolbar (live filter + A→Z/Z→A sort toggle + collapse/
expand-all), and **collapsible groups** with per-group counts. Grouping is
per-type via `libGroup`: Agents group by model tier (Haiku·cheap / Sonnet /
Opus·heavy / Other — the list is already tier-colored), Skills and Commands by
first letter (A–Z, non-alpha under `#`). Group order respects the sort
direction; rows still click through to the definition. CSS added under a new
`.lib-toolbar` / `.lib-group` / `.lib-ghead` block in `assets/style.css`.
`app.js` landed at exactly 499 lines (under the 500 cap).

**Verification.** Browser on 5759: Agents shows "HAIKU · CHEAP (7)" collapsible
group with tier pills; Skills shows A/B/C letter groups with counts (api-design,
backend-patterns…). Sort + collapse controls render, theme intact. Client-only
change (no new endpoints); smoke green on 5759, 5757 untouched.

---

## Council + Providers panels — ✅ resolved (verified no-op, no code change)

**Finding.** There is **no** Council or Providers chrome in the hub — grep across
`index.html`, `assets/*.js`, `assets/*.css` for council/provider returns only two
unrelated hits (a hermes-config regex in `core.js`, a log-noise filter in
`liveness.js`). The 18 nav tabs contain neither. The memory note
`redesign-clean-dark` confirms these were only ever **Lovable specs** ("specced
for Lovable — build them native when the user provides keys"), and the Lovable
port only brought Jarvis + Overview. So the handoff's worry ("a dead panel that
looks alive is worse than no panel") does not apply — there is no dead panel to
wire or remove.

**Decision (no code change, on purpose).** Council = roadmap N10, deprioritized
to the very bottom (build last if ever) — nothing to do. A Providers panel as
OpenAI/Perplexity chrome would violate the non-negotiable **Claude-ONLY engine**
mandate, so it must NOT be built that way; the "engines actually available" are
just the Claude tiers, and those are already surfaced by the Agents tier groups
(shipped in R2 above) + the Config tab. Correcting a wrong item with a clean skip
beats inventing chrome. Updated the `redesign-clean-dark` memory with a
2026-07-19 verification so the next worker doesn't re-chase this.

---

## N4 — Schedules polish + run-history tier badges ✅ shipped

**Commit:** `__N4_HASH__`

**What shipped (two parts).**
1. *Run-history tier badges* (the clearly-missing piece): rows now surface the
   run's `meta.effort` and `meta.fable5`. Max-effort shows a filled `⚡ ULTRA
   CODE` pill, lower tiers `▲ effort N/5`, and god-prompt runs `⟡ fable5`, so
   ULTRA CODE / Fable-5 runs are identifiable at a glance. No server change —
   `liveness.annotate` already spreads the whole meta, so effort/fable5 reach
   `/api/runs`; badges added in `assets/runhistory.js` (`.pill.accent` for
   ULTRA CODE, `.pill.neutral` otherwise — no new CSS).
2. *Schedules polish*: the schedule row's `nextDue` is now a prominent green
   `◷ next in Xm` countdown pill (paused shows `⏸ paused`), so enabled/disabled
   reads instantly; the last-run status chip is now clickable (reuses the
   existing `.sOpen` → openRun handler, + keyboard activation) and the redundant
   separate "last run" button was dropped. `assets/tasks.js`.

**Verification (live DOM on 5759 via scrapling).** Run rows rendered
`▲ effort 4/5`, `⟡ fable5`, and `⚡ ULTRA CODE`; the enabled F5-orchestrator
schedule rendered `◷ next in 32m`. Smoke green; 5757 untouched. The clickable
last-run chip couldn't be exercised live (the only schedule hasn't fired yet, so
`lastRunId` is null) but reuses a previously-verified handler.
