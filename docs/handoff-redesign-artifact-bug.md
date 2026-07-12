# HANDOFF — "redesign produces HTML mockups instead of changing the real UI"

**Start a fresh thread with this.** Symptom the user reported: Hermes runs asked
to revamp the hub UI keep producing **standalone HTML preview documents** (e.g.
`overview-r0-preview.html` in a run's `artifacts/`) instead of editing the live
dashboard. The real UI does not change.

## Confirmed root cause
`claude-dashboard/lib/runs.js` (~line 124) appends a `hint` to **every** run
prompt that says: *"If this task produces visual output … save those files into
this exact directory: {artDir} — the dashboard renders every file there."*

For a "redesign the dashboard's own UI" task this **actively misdirects** the
agent into writing a self-contained HTML mockup in `artifacts/` rather than
editing `claude-dashboard/assets/*.css` / `*.js` and the tab renderers.

**Evidence:** run `data/runs/2026-07-12t02-43-32-7fc13d/` produced only
`artifacts/overview-r0-preview.html` (a standalone `<!DOCTYPE html>` page with
its own `<style>`), and `git diff HEAD` on `assets/`/`lib/` was empty for that
run. NOTE: the mechanism itself works — commit `0b0f687` (usage-remaining hero)
proves Hermes can edit + commit real files. The hint is the misdirection, not a
broken toolchain.

## The fix (do these in order)

### 1. Reword the artifact hint so it never applies to editing the hub's own UI
In `lib/runs.js`, change the `hint` string so it distinguishes deliverables from
self-modification. Intended meaning:
- If the user asked you to **generate a report / chart / document**, save it as a
  file in `{artDir}` (artifacts render inline). Keep the /vendor/ + anti-slop
  guidance for that case.
- If the user asked you to **change this dashboard's own interface**, EDIT the
  real source under `claude-dashboard/assets/` (style.css, app.js, run.js,
  files.js, graph.js, agentviz.js, memory.js, voicecfg.js, tasks.js) and the
  tab renderers — **do NOT create standalone/preview HTML**. Verify in the
  browser at http://127.0.0.1:5757 and keep every file < 500 lines.

Keep it one paragraph; the current hint is fine for the report case — just add
the "editing the hub itself → edit real files, no preview artifacts" branch.

### 2. Fix the redesign PROMPT to be explicit (the prompt also invited a mockup)
Kick off the build with something like:
> "EDIT the real dashboard source to apply the clean-dark redesign — files under
> `claude-dashboard/assets/` (style.css tokens already exist under
> `:root[data-theme=\"dark\"]`; app.js, run.js, etc.) and the tab renderers. Do
> NOT create HTML preview/mockup artifacts. Change one real tab at a time,
> reload http://127.0.0.1:5757 to verify, run `scripts/verify-dashboard.ps1`,
> commit per working tab. Start with the Overview tab (the real
> `renderers.overview` in assets/app.js), matching `overview-r0-preview.html`."

### 3. Ship the Hermes-visibility fix + zombie guard (already a top blocker)
See `docs/roadmap.md` → "🚨 SERIOUS BLOCKER — Hermes runs are INVISIBLE".
Without this you cannot see a run go down the wrong path. Minimum: mark a
"running" run as stalled/dead when its process is gone or nothing streams for N
minutes, so zombies stop showing as active.

## Cleanup before rebuilding
- **Zombie runs** still falsely "running" from earlier crashes:
  `2026-07-11t18-40-34-d6ae3a`, `2026-07-11t23-04-26-071cb8` (no usage.json,
  process dead). Delete them (Run history ✕) or via `/api/run/delete`.
- The in-flight redesign run `2026-07-12t02-43-32-7fc13d` is producing mockups —
  cancel it, apply fix #1 + #2, then relaunch.
- The artifact `overview-r0-preview.html` is a good VISUAL TARGET for the real
  Overview — keep it as reference, don't ship it as the app.

## Context to load
- `docs/design-reference/redesign-build-brief.md` — full clean-dark spec.
- `docs/roadmap.md` R0–R5 + the SERIOUS BLOCKER.
- Clean-dark theme tokens already live in `assets/style.css`
  (`:root[data-theme="dark"]`), toggled by the ◐ header button.
- Hard rules unchanged: zero deps, vanilla JS/CSS, localhost, <500 lines/file,
  security invariants, browser-verify + smoke before commit.
