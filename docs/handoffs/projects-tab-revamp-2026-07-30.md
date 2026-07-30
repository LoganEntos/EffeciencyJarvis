# Handoff: Projects tab — full revamp + SharePoint-driven VPP conversion

**Model:** Opus 4.8 · high/xhigh for the planning pass, per-track default for
implementation (matches the file-ownership-split pattern that already worked
this session — see "Standing constraint" below). **Perms:** bypassPermissions
for read/plan; confirm before any SharePoint pull or destructive Projects
action. **Toggle the ✦ Jarvis distiller OFF** before pasting (long prompt).

## Why this exists

Consolidates everything decided and verified in the 2026-07-30 Projects-tab
session — the todo clearout, the live SharePoint scoping for VPP's historical
orders, and the proposed autonomous-conversion architecture — into one
orchestration order. Whoever picks this up (Jarvis, or a fresh Claude session)
should not have to re-derive the SharePoint folder structure, re-run the
"which years/folders matter" investigation, or re-litigate decisions already
made. Read `data/todos/projects.md` in full alongside this file — it is the
line-item source of truth; this doc is the narrative + sequencing on top of it.

## Standing constraint — read before fanning out anything

The user has previously flagged orchestration on this project as **weak**:
workers sent out without adequate verification, and progress reports that
didn't reflect what actually happened. Two concrete standing instructions
from that feedback, binding on this handoff:

1. **Do not send out workers before presenting a plan and getting a
   checkpoint.** Report status in plain text first; wait for direction before
   a large fan-out. Small, well-scoped single-agent tasks (a single split, a
   single bug fix) don't need this — multi-agent fan-outs and anything
   touching real SharePoint/client data do.
2. **Verification must be real, not claimed.** Every diff gets a
   `code-reviewer` pass; every server-touching change gets verified on a
   throwaway port (never 5757) with `scripts/verify-dashboard.ps1` plus
   functional checks, not just a syntax check. If a browser-automation tool
   genuinely isn't available in the environment, say so explicitly rather
   than implying a click-test happened.

The pattern that worked this session (2026-07-30): split remaining work by
file ownership — `lib/*.js` vs `assets/*.js`+`index.html` — run those two
threads concurrently (no merge conflicts because no shared files), then one
`code-reviewer` pass + one `test-runner` pass before commit. Reuse that shape;
it survived three mid-run interruptions cleanly via `Workflow`'s
`resumeFromRunId` cache-replay.

## Current state (2026-07-30, verified against code + `data/todos/projects.md`)

Nearly everything file/UX-scoped in the Projects tab is done and verified
this session: preview consistency, the two 500-line-cap splits
(`projectdetail.js`→`projectfiles.js`, `lib/projects.js`→`lib/project-claude.js`),
project-run file manifest (persisted + surfaced in run replay), files.js
scroll-jitter fix, slug-reuse-guard a11y, and a storage-only `sharepointFolder`
field on project metadata. Full line-item history is in `data/todos/projects.md`
(everything checked `[x]` there is done and verified — trust it over memory).

**UPDATE 2026-07-30 (later same day):** the user explicitly delegated all four blocked calls plus Tier-1 VPP go-ahead in one turn ("go 1-4, you are the orchestrator"). All four were resolved and three are shipped/code-reviewed; only Step 7 remains genuinely sequenced-last. See `claude-dashboard/data/todos/projects.md` for the authoritative per-item detail — the table below is left as historical record of what was blocking what, not current status.

**What was open, and why each one was blocked on a decision, not effort:**

| Item | Blocker | Resolution |
|---|---|---|
| Step 3 — Projects vs Files vs Run tab ownership | Product decision. Recommended approach: an `architect` agent (or 2-3-way judge panel) produces 2-3 concrete proposals with tradeoffs; user picks. Nobody should just guess an architecture here. | **DECIDED + SHIPPED.** `architect` produced 3 proposals; Proposal C picked (Files = intake-only, Projects = workspace owner, Run = execution). Implemented as the Files-tab "N files unfiled" counter. |
| Step 7 — destructive cleanup controls (organize/archive/delete-all) | Explicitly sequenced last; also depends on pairing being trusted at scale (duplicate detection has real code but no live-positive case yet — see the synthetic-duplicate verification task below, which is unblocked and doable now). | **Still last in sequence** — but its blocker (dup detection unproven live) is now cleared: first live-positive confirmed via a synthetic test, no bug found. Closer to unblocked than before. |
| Directory tracker ("help specify where files are instead of adding every one manually") | Genuinely two different features with different security surfaces: (A) a cosmetic label/pointer — trivial — vs (B) real read access to a folder outside `data/inbox/` — a new path-traversal-adjacent attack surface that needs a `security-auditor` pass on the sandboxing contract *before* any code. Needs the user to pick A or B. | **DECIDED (A) + SHIPPED.** Cosmetic `project.sourceNote` field, never touches fs — code-reviewer confirmed. Option B still not built. |
| SharePoint folder binding — UI + sync trigger | The storage-only field exists (`lib/projects.js`). No UI surfaces it yet, and "auto-syncs into its runs" (the original ask) has no defined trigger — on every run? A manual "sync now" button? Needs a design decision, not just wiring. | **DECIDED (manual button) + SHIPPED.** `POST /api/projects/sync-sharepoint` + a "⟲ Sync now" header button — auto-sync-on-every-run rejected as incompatible with the hub's no-silent-business-data rule. Code-reviewed (SHIP), verified on :5758. |
| Step 9 — VPP historical backlog conversion | Fully scoped (see below) but the actual pull-and-convert work is gated on the user's go-ahead, tier by tier. | **Tier 1 (4 orders) authorized and executed 2026-07-30.** Tier 2/3 (47 orders) still gated on a separate go-ahead — see `data/todos/projects.md` for per-order results. |

## VPP historical-conversion pipeline (SharePoint-driven)

This is the "SharePoint theory" from this session, verified against the live
index, not assumed. Full detail (including the false leads ruled out —
`Clients/VPP`, the VPP Digital Asset Management Library, `Orders VersiPro`)
is in `data/todos/projects.md` under Step 9, and the corrected extraction
method + source path is written into the `vpp-historical-import-test`
project's own `instructions` field (visible in its Projects-tab detail page —
every run started in that project carries it automatically).

**Source:** `/Operations/Orders/Orders VPP/Closed Order History/<year>/` — 54
closed orders, 2022-2026 (2/9/15/21/7 per year). Confirmed complete range, not
a crawl gap (continuous whole-drive file-date histogram 2015-2026; first two
orders are literally named `VPP1`/`VPP2`, 2022-02-18).

**Progress:** 5/54 converted + reconciled to the cent (22439, 22443, 22610,
22610-2, 22613 — all 2026-era). 49 remain, tiered by risk:

- **Tier 1** (4 more 2026 orders: 22359, SPL002/010763, 22611, 22612) — same
  document era as what's proven. Lowest risk. **This is the next canary —
  ready to fire on the user's go-ahead, no further scoping needed.**
- **Tier 2** (21 orders, 2025) — format likely close but unverified.
- **Tier 3** (26 orders, 2022-2024) — higher risk: sampled folders have
  multiple candidate PI/invoice files per order with no single obvious
  authoritative one, and the `pdftotext -table` extraction has never been
  validated against pre-2025 layouts. A 0-rows-parsed result must be treated
  as "needs a human look," never silently skipped.

**Proposed architecture (not built — needs sign-off):** one task per order in
the existing task queue (`lib/tasks.js`), Tier-ordered, dispatched via
`lib/autopilot.js` rather than a bespoke script. This directly extends
**gap B** in `docs/jarvis-orchestrator-plan.md` (project binding is already
threaded through `runs.startRun`, just not through `tasks.js` yet) and sets
up **gap G** in the same doc (reconciling `lib/pairing.js`'s local state
against `lib/sharepoint.js`'s upstream index) once there's a real project with
a known SharePoint source folder to reconcile against — this project is
exactly that test case.

## Start here — the first work order (paste into a fresh thread)

```
Read, in order: this handoff (docs/handoffs/projects-tab-revamp-2026-07-30.md),
data/todos/projects.md, docs/jarvis-orchestrator-plan.md, and CLAUDE.md +
HANDOFF.md for the hard rules (zero-dep, localhost-only, <500-line files,
security invariants, no client/business data processed unless prompted, never
report status as an HTML artifact, always verify on a throwaway port and never
touch 5757).

Do NOT start implementing yet. This session's standing feedback was that prior
orchestration sent out workers without enough verification or a clear plan —
don't repeat that. Instead, produce a short plain-text status + plan covering:

1. Confirm data/todos/projects.md still matches what you find in the code —
   flag anything stale before acting on it.
2. For the four blocked items (tab ownership, destructive controls, directory
   tracker, SharePoint binding UI), do NOT guess an answer. List the specific
   open question for each one and wait for the user's call.
3. For Step 9 Tier 1 (the 4 remaining 2026-era VPP orders): if the user has
   given the go-ahead in this conversation, propose the concrete task-queue
   wiring (which fields on the task schema, what the per-order prompt should
   contain, what "flag NEEDS-REVIEW" means operationally) before writing any
   code, and confirm before it touches real SharePoint files.
4. For anything that IS unblocked and safe to just do (e.g. the synthetic
   duplicate-detection test that de-risks Step 7, or small doc/UI
   consistency fixes) — do it directly, verify it live, and report what you
   did rather than asking permission for something this low-risk.

When multi-agent work is warranted, split by file ownership (lib/ vs assets/)
the same way the 2026-07-30 session did, run tracks concurrently, and close
with one code-reviewer pass + one test-runner pass before any commit.
```

## Notes for whoever fires this

- **Don't re-run the SharePoint investigation.** The folder structure, year
  range, and false leads are settled — re-verifying "are there more years" a
  second time is wasted tokens; the evidence is in `data/todos/projects.md`.
- **`data/sharepoint-index.json` was 3 days stale (built 2026-07-27) as of
  this session.** Refresh it before trusting it for a real Tier 1+ batch run.
- **The four blocked items are blocked on a person, not on missing analysis.**
  Resist the urge to pick an answer for the user on tab ownership, the
  directory-tracker security boundary, or when to greenlight destructive
  controls — that's explicitly out of scope for an unattended or semi-
  autonomous session.
