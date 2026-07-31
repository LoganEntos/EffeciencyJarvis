# Jarvis-as-orchestrator — implementation plan (drafted 2026-07-30)

Planning doc only — no code shipped against this yet. Grounded in the actual
substrate (`lib/autopilot.js`, `lib/tasks.js`, `lib/teams.js`, `lib/runs.js`,
`lib/project-context.js`), not a hypothetical design; every gap below was
verified by reading the current code, not assumed.

## Standing tension — read first

`HANDOFF.md` (2026-07-28, still the canonical status doc) scopes current work
to Inbox · Projects · Run and says explicitly: **"token viz / broad UI polish
/ orchestrator work are deferred"** until the VPP PDF→CSV workflow is stable.
Recent commits (`efda7d8`, `180a4b3`, `0e30e0c`) show that Projects work is now
substantially shipped. This plan assumes the user is deliberately electing to
resume orchestrator work now — if that's not the intent, this plan should wait
behind whatever's still open in `docs/handoffs/vpp-frontend-workflow-2026-07-28.md`.

## Reframe

"Jarvis orchestrating Projects" is not a new subsystem. The hub already has an
unattended dispatch loop (`lib/autopilot.js`) sitting on a durable task queue
(`lib/tasks.js`) that feeds the same run engine every prompt uses. What it
lacks is: more than one place to look for work, a way to bind a dispatched run
to a project's context, a way to force the right specialist team per dispatch,
any memory of *why* a past attempt failed, and any visible trail of what it
actually did. None of that requires a new engine — it requires generalizing
the one that exists. Below are the concrete gaps, each verified against the
current code, in build order.

## Gaps found (verified, not assumed)

**A — Single queue source.** `autopilot.pickNext()` (`lib/autopilot.js:79`)
reads only `docs/improvement-backlog.md`, falling back to the generic
`tasks.js` FIFO queue. It has zero awareness of the per-tab TODO checklists
(`data/todos/*.md`, shipped this session) or any project-level backlog. To
"work Projects" unattended, it needs a third source: parse
`data/todos/projects.md` the same way `parseBacklog()` already parses the
hub's own table — checklist lines (`- [ ] ...`) instead of table rows.

**B — No project binding on dispatched runs.** `runs.startRun()`
(`lib/runs.js:123`) already accepts `projectId` and, when given one, injects
the project's instructions + file manifest (`lib/project-context.js`) into the
prompt. But `tasks.js`'s `enqueue()` / `runTask()` / `runAll()` never carry or
pass a `projectId` — it's dropped at the task layer. This is one field of
plumbing, not a redesign: add `projectId` to the task schema and thread it
`enqueue → runTask/runAll → startRun`. Without this, a dispatched "fix the
Projects pairing bug" run executes with no idea which project's files it
concerns.

**C — No per-dispatch team selection.** `teams.activeHint()`
(`lib/teams.js:114`) reads one global "active team," whatever the user last
picked in the UI — it can drift or be wrong by the time autopilot fires hours
later. `autopilot.dispatch()` already overrides model/effort per item
(`model: 'opus', effort: 'high'`, `lib/autopilot.js:204`) but not team. A
Projects-tab item should force the UI/frontend (or a future "Projects") team
hint regardless of whatever's globally selected, the same way it already
forces model/effort.

**D — No failure memory or escalation.** A failed item retries the *identical*
prompt up to `MAX_ATTEMPTS` (2, `lib/autopilot.js:43`), then silently parks as
`stuck`. `state.dispatched[id]` stores only the latest status and an error
string — nothing about *why* it failed (wrong tier? missing context? genuinely
hard?) survives to inform the retry. This is already an open item in
`data/todos/jarvis.md`; this plan gives it a concrete shape: keep a per-item
`history[]` of `{attempt, errorExcerpt, at}`, feed the last entry back into the
next dispatch's prompt ("attempt 1 failed because X — try a different
approach"), and escalate effort/model tier on the second attempt instead of
repeating verbatim.

**E — No delegation visibility.** Already scoped as its own item in
`data/todos/jarvis.md` ("Delegation visibility — scoreboard," added
2026-07-29/30) — extracting `Agent` tool_use events from
`data/runs/<id>/output.jsonl`. Verified against real run data this session:
the tool is named `Agent` (not `Task`), carries `{description, subagent_type,
prompt}`, and every line a subagent produces is tagged with
`parent_tool_use_id` + `subagent_type` + `task_description` — enough to
reconstruct what was delegated and how many tool calls it took. No per-
delegation token/duration exists in the stream (CLI limitation) — first
version tracks *what* happened, not yet its cost. This is the prerequisite for
"seeing" whether any of A–D actually work.

**F — No cross-source prioritization.** `pickNext()` is pure FIFO scan order
today: backlog table order, then task-queue creation order. Nothing weighs
urgency, risk, or a standing directive like HANDOFF's "VPP takes priority."
Once there are multiple queue sources (A), naive concatenation isn't good
enough — needs at least a static source-priority list (user-typed tasks >
active project backlog > per-tab todos > hub self-improvement backlog).

**G — No cross-reference to SharePoint completion state (added 2026-07-30,
user directive).** `lib/pairing.js`'s `pairProject(slug)` already computes a
per-order local state (`'complete' | 'pdf-only' | 'unmatched'`,
`lib/pairing.js:158`) from what's physically in the project's inbox folder.
`lib/sharepoint.js` separately maintains an index of the SharePoint drive
(`data/sharepoint-index.json`, `searchIndex()`/`buildIndex()`) but the two
never talk to each other — pairing only ever sees what's already been pulled
locally. An order that exists upstream in SharePoint but was never pulled
looks identical to "doesn't exist" today; Jarvis can't currently answer "is
this project's SharePoint-side backlog actually done" without a human
manually diffing the SharePoint folder against the project folder. Overseeing
a project's conversion completion means reconciling `pairProject()`'s local
state against `searchIndex()`'s upstream listing for that project's known
source folder — genuinely new integration work, not a plumbing gap like B.
Needs its own design pass once phases 0–2 below are live (don't design the
reconciliation logic against zero real examples of it running).

## Test-before-hardcode (user question 2026-07-30 — yes, and here's why)

Prototyping the oversight flow as a manual one-off run, in a fresh thread,
before writing any of phases 1–4 into `lib/autopilot.js`, is the right call —
for a concrete reason, not just general caution: **none of the phases below
require new code to observe.** The run engine, project binding
(`projectId` on `runs.startRun`), the team-hint mechanism, and personas are
all already live. A manual test just means firing a normal prompt at Jarvis —
through the Run or Tasks tab, in a clean session so it isn't carrying this
planning conversation's context — that asks it to actually do the oversight
job in one shot: open a specific project, read its files, check
`pairProject()`'s state (or just look at the file list) against what
SharePoint has, and report back pass/fail per order. Whatever it gets wrong
(skips files, hallucinates completion, doesn't check SharePoint at all
without being told to explicitly) tells you exactly which of gaps A–G actually
matter versus which were solved already by context injection alone — real
signal instead of designing all four phases against guesses. Once phase 0's
delegation scoreboard exists, that same test run's transcript becomes
inspectable evidence, not just a vibe.

## Overview scope — output vs. efficiency (user question 2026-07-30)

Correct direction, matches the vision already sitting in `data/todos/
jarvis.md`'s Overview section — with one refinement: keep **output**
(did the run do the correct, complete thing — a verification question) and
**efficiency** (was the cost proportionate to the task — a cost question) as
two separate signals, not one blended score. A correct-but-slow opus run on a
genuinely hard task and a fast-but-wrong haiku run are both "bad" in different
ways that a single number would hide. Don't calibrate the efficiency half
until phase 0's scoreboard has real dispatch examples to define "proportionate
cost" against — same reasoning as gap F above.

## Build order (each phase independently shippable + browser-verified before the next)

**Phase 0 — SHIPPED 2026-07-31.** Delegation-visibility scoreboard (gap E).
Per-run view already existed (`lib/delegations.js` + `assets/delegations.js`,
mounted in the run transcript). The cross-run aggregate (`listRecent()`'s
`byType` breakdown) existed server-side but had no UI consumer — added
`renderDelegScoreboard()`/`mountJarvisDelegScoreboard()`, a collapsed-by-
default strip in the Jarvis tab. Verified live on :5758 (real data), smoke
script green, code-reviewed. No browser click-test — no browser automation
tool available this session; verified via API-level checks instead.

**Phase 1 — SHIPPED 2026-07-31 (plumbing, gap B).** `projectId` now threads
through `tasks.js`'s `enqueue()`/`runTask()`/`runAll()` into
`runs.startRun()`. `enqueue()` validates against `projects.get()` — an
unknown id is silently dropped, not stored. Deliberately does NOT gate on
project `kind` here (that hazard guard lives in `runs.js`'s `startRun()`,
added the same session — see `data/todos/projects.md`'s Escalate-hazard
entry). Verified live: a claude-kind projectId stores fine (kind-gating is
dispatch-time, not storage-time), a bogus id is dropped. Still genuinely
inert — nothing in the Tasks tab UI sets `projectId` yet; that's Phase 2+
territory and needs its own go-ahead per the standing plan-mode discipline.

**Phase 2 — SHIPPED 2026-07-31 (second queue source, gap A), reviewed by
`warden`: sound, provably inert.** `pickNext()` now also reads
`data/todos/projects.md`'s open checklist lines as a third pickable source
(`lib/autopilot.js`'s `parseProjectsBacklog()`), behind its **own** new
`state.projectsBacklogEnabled` flag (default `false`, no UI/route to flip it —
hand-edit `data/autopilot.json` only), checked in addition to the hub's global
`state.enabled` (also default `false`, unchanged). Both must be true to reach
the new source; `tick()` still bails before anything else runs if `!enabled`.
`dispatch()`'s close-the-loop prompt was also made source-aware (it previously
hardcoded "edit docs/improvement-backlog.md" for every item, which was wrong
for a `projects.md`-sourced one — `agentops-engineer`'s own self-review caught
this, fixed same-session).

**Known gap before this flag should ever be flipped (filed, not built):** the
only two open items in `data/todos/projects.md` today are Step 7 ("do LAST,
depends on pairing being trusted") and Step 9 (the VPP historical batch —
client business data, its own text says Tiers 2/3 "need a separate go-ahead").
Flipping `projectsBacklogEnabled` today would dispatch exactly the two items
that declare in their own text that they need a human call first, wrapped in a
prompt that still frames everything as an unattended code fix. Needs an
eligibility marker (or a skip rule for "needs a user call" items) in
`parseProjectsBacklog()`/`pickNext()` before this flag is ever turned on —
tracked in `data/todos/jarvis.md`'s Autopilot section, not built yet.

**Phase 3 — dispatch quality (gaps C + D).** Per-dispatch team override, and
failure-memory/escalation. These are what make dispatched runs actually good,
not just possible.

**Phase 4 — prioritization (gap F).** Only build this once phases 1–3 are
live and phase 0's scoreboard has real dispatch history to check against —
same reasoning as "don't build the Overview efficiency score without real
examples first": a ranking model designed on guesses is worse than none.

## What this deliberately does NOT include

- No change to `autopilot.json`'s default-off posture — every new capability
  here ships behind its own flag, same convention as the existing loop.
- No efficiency *scoring* (that's the separate, research-gated Overview
  rework already noted in `data/todos/jarvis.md` — out of scope here).
- No new engine, MCP, or dependency — this is entirely `lib/autopilot.js` +
  `lib/tasks.js` + `lib/teams.js` generalization, zero-dep as always.

## Gap G — reconciliation design (decided 2026-07-31)

Design pass only — no code shipped. Greenlit to start early (in parallel with
phases 0–1), per the deliberation doc's own devil's-advocate point 4
(`docs/jarvis-orchestrator-deliberation-2026-07-30.md` §8b.4: deferring gap G
to dead last inverts the user's stated top priority). Every claim below was
verified against code read this session (`lib/pairing.js`, `lib/sharepoint.js`,
`lib/projects.js`, `data/todos/projects.md`'s Step-9 scoping) — file/line
cited where load-bearing. Implementation still waits for phase 2.

### The decision, in one line

Add one small module, `lib/reconcile.js`, that joins `pairProject()`'s local
per-order state against the already-built offline SharePoint index — keyed on
**order id, extracted from the upstream order-*folder* name** — and returns a
per-order status list. It **flags**, never pulls. One new GET route
(`/api/projects/reconcile?id=…`). The `warden` agent is its first consumer.

### 1. Matching key — REVISED 2026-07-31 after `warden` review, verified against the real index

**The first version of this section was wrong on two mechanics — `warden`
caught both by actually reading `data/sharepoint-index.json` (2.5MB, on disk
the whole time; the original design flagged the check as pending and never
ran it). Corrected below, and every claim in this revision was independently
re-verified against the live index (`idx.sites[].drives[].files[].p`) before
being written, not re-inferred from `data/todos/projects.md` alone.**

**What was wrong:**
1. "Deepest folder" as the join level is wrong — order folders are not leaves.
   843 files under `Closed Order History/` span 186 distinct parent paths for
   only 54 orders (subfolders like `Confidential`, `Shipping Docs`, `MBS
   Invoice`, `Inspection Reports` sit under nearly every order). The correct
   level is **depth-2**, i.e. `<year>/<order-folder>` — confirmed this is
   exactly 54 groups for 54 known orders.
2. "Folder name is a clean id token" is wrong for most of 2025 and all of
   2023 — real folder names are multi-token prose, e.g. `ETA 7.31 867131
   Ningbo Re-order 2hole Cop 22358`, `ETA 09.20 848991 inv22141`, `ETA
   23.05.24 819775 Wood Seats 22.11`. A folder typically carries 2-3 numeric
   tokens (a supplier PO/reference number *and* the local order id), so
   `normalizeOrderId` needed a disambiguation rule, not just a token-shape
   regex.

**The fix, verified against the real 54-folder tree:** the hub's own local
order ids are consistently 5-digit numbers in the `22xxx` range (matches
every id already used elsewhere in this project — `22439`, `22610`-`22613`,
`22355`, `22358`/`22359`, `22443`, …). Extracting every unanchored `22\d{3}`
substring from a folder name (no word-boundary requirement, so it also
catches glued forms like `Inv22220`, `inv22157`, `E22082`) and keeping the
distinct set resolves **47 of 54 folders (87%) to exactly one candidate**,
plus a `VPP\d+` special case for the two 2022 pioneers (`VPP1`/`VPP2`, which
carry no `22xxx` token at all). The 7 that don't resolve to a single token are
not a rule failure — they're precisely the already-documented hard cases:
one multi-order batch folder (`3x Stud Guard Orders`), five 2023-era folders
whose only numeric fragment is a date-shaped `22.10`/`22.11` (the real order
id lives inside a filename, not the folder name — matches Step-9's own "Tier
3, no single obvious authority" flag), and the one confirmed
out-of-method domestic order (`SPL002`/`010763`, no import PI at all). All
seven correctly fall into the `ambiguous` bucket below rather than mis-keying.

**Rule, concretely:** for each depth-2 folder name — (a) if it matches
`^VPP\d+`, that's the id verbatim; (b) else collect the distinct set of
`22\d{3}` substrings; if the set has exactly one member, that's the id; (c)
if the set is empty or has 2+ members, classify `ambiguous` and surface the
raw folder name (plus every candidate token found) for a human/warden pick —
never guess. `normalizeOrderId(folderName)` in `reconcile.js` implements
exactly this three-way branch; the broader `[A-Za-z]{0,4}\d{3,6}(-\d+)?`
token family from the first draft is dropped — it over-matched supplier
reference numbers and is not needed now that the `22xxx` convention is
confirmed sufficient.

**Citation correction:** the first draft cited a cross-coded-file example
backwards — it said `PI 22359 SPL867131 (869165) Signed.pdf` sits inside
order **22358**'s folder. Re-checked against the live index: it actually
sits inside order **22359**'s folder (`2026/Paid 3.14 869165 Inv 22359
Copper & Brass Press Fittings 240CUFT/`), while the *same* supplier PI number
`SPL867131` is independently used inside order 22358's own folder (`PI 22358
SPL867131 Signed.pdf`, `PI 22358 SPL867131.pdf`). The underlying point still
holds and is now correctly grounded: a supplier PI/reference number is reused
across two different local orders, so filename-matching would inherit that
collision — folder-name (order-id) matching does not, because 22358 and
22359 are different `22xxx` tokens even though they share a PI number.

Still genuinely a duplicate-key case worth knowing: two 2026 folders both
contain the token `22439` (need a second look before implementation treats
"exactly one `22xxx` token" as sufficient uniqueness across the *whole* tree,
not just within one folder — dedupe at the id level, not just within a single
folder name).

### 2. Upstream-only orders — FLAG, never auto-pull

An order whose folder exists upstream but whose id never appears locally is the
whole point of gap G ("indistinguishable from doesn't-exist today"). The design
**flags** it (`status: 'upstream-only'`) and stops. It does not pull.

Three grounded reasons, not caution-for-its-own-sake:
- CLAUDE.md hard rule: no client/business data "unless explicitly prompted in
  that conversation." An auto-pull triggered by a reconciliation scan is not
  that explicit prompt.
- The existing "Sync now" button (`syncSharepointFolder`, `lib/projects.js:129`)
  was *deliberately* made a manual click for this exact reason
  (`data/todos/projects.md`, "Added 2026-07-30": "a silent per-run pull would
  violate the hub's rule; a manual click IS that explicit prompt"). Reconcile
  reuses that decision — it never adds a second, quieter pull path.
- The remedy already exists and is already the explicit-prompt click: the human
  (or Jarvis, on an authorized turn) clicks **Sync now** to pull an upstream-only
  order in, then the existing "Convert missing CSV" one-click
  (`assets/projectpairs.js`) handles conversion. Reconcile adds *visibility*,
  not a new action.

Reconciliation itself is safe to run unattended/on-demand because it reads
**only** the offline `data/sharepoint-index.json` (metadata: paths, sizes,
dates, ids) and local filenames — it opens no PDF, calls no Graph endpoint,
and pulls no bytes. The output therefore carries `indexBuiltAt` + a `stale`
flag (the index was 3 days stale during Step-9 scoping); reconcile surfaces
staleness but never auto-triggers a rebuild (a rebuild is a live Graph crawl —
that stays the user's existing manual button).

### 3. Where it lives + output shape — `lib/reconcile.js`, one join module

New module, not an extension of either existing file:
- **Not `lib/pairing.js`** — its header contract is pure/local/no-network/
  stateless ("never opens a PDF… read-only", lines 1–16). Teaching it to read
  the SharePoint index breaks that separation and pushes a 295-line file toward
  the 500 cap.
- **Not `lib/sharepoint.js`** — already 434 lines (roadmap flags it at the size
  ceiling) and single-purpose as the Graph/auth/index-build layer. Reconcile is
  a *consumer* of the index, not more Graph plumbing.
- **`lib/reconcile.js`** imports both and owns the join — mirroring how
  `lib/projects.js` already imports both `pairing` and `sharepoint` to do the
  cross-cutting sync. Small, deletable, single job.

One ~15-line read-only helper is added to `sharepoint.js` and exported:
`indexFilesUnder(driveId, prefix)` → flat `[{ p, name, parent, size, modified,
id }]` for every indexed file whose path starts with `prefix`. This keeps the
index-file format (`{p,s,m,id}`, `loadIndex()`) encapsulated in sharepoint.js
rather than leaking it into reconcile.js. (`browseIndex` is single-level —
it collapses deeper paths into folder counts — so it can't return the recursive
flat list the join needs; hence a sibling helper, not a reuse.)

`reconcile.js` exports `reconcileProject(id)`:

```
reconcileProject(id) -> {
  ok: true, projectId, slug,
  bound: { driveId, path, name },        // from p.sharepointFolder
  indexBuiltAt: '2026-07-27T…' | null,
  stale: bool,                            // indexBuiltAt older than ~2 days (advisory)
  counts: { complete, localIncomplete, upstreamOnly, localOnly, ambiguous },
  orders: [{
    orderId,                              // normalized join key (null when ambiguous)
    folderName,                           // raw upstream folder name (null when local-only)
    year,                                 // advisory (maps to Tier 1/2/3); null if not derivable
    upstream: { fileCount, files:[{ name, id, size, modified }] } | null,
    local:    { state, pdfs, csvs, authoritativePdf, decision } | null,  // subset of pairProject order
    status: 'complete' | 'local-incomplete' | 'upstream-only' | 'local-only' | 'ambiguous',
    candidateTokens: [string] | null,     // ambiguous rows only — every 22xxx token found, so a
  }, …]                                  // human/warden pick isn't guessing from folderName alone
}
```

Status semantics:
- `complete` — id matched both sides, local `state === 'complete'`. Done.
- `local-incomplete` — matched both, local present but `pdf-only`/`csv-only`/
  `review`. File is already local; the remaining work is conversion, not a pull.
- `upstream-only` — upstream folder exists, no local id match. The invisible
  backlog. Remedy: Sync now (§2).
- `local-only` — local order with no upstream folder. Flag (folder renamed
  upstream? manually-added local order?) — worth a human look, low volume.
- `ambiguous` — upstream folder name yields no clean id, or ≥2 folders collapse
  to one id. Never auto-anything; surface raw names for a human/warden pick.

Error branches reuse existing message families: `{error:'not found'}` (bad id),
`{error:'no SharePoint folder is bound to this project yet'}` (no binding — same
string as `syncSharepointFolder`), `{error:'no index yet — build it first'}`
(same string as `searchIndex`/`browseIndex`). No `kind` gate needed — requiring
a binding already excludes claude-kind workspaces (they never have one).

### 4. API route — one GET, in `lib/projects.js`

`GET /api/projects/reconcile?id=<projectId>` → `reconcileProject(id)`. Keyed on
project **id** (not slug like `/api/projects/pairs`) because the join needs
`p.sharepointFolder`, which lives on the project record and is looked up by id —
matching the existing `/api/projects/sync-sharepoint` convention (`lib/projects.js:360`).
Route handler lives in `projects.js`'s `handle()` beside `sync-sharepoint`
(that module already imports both `pairing` and `sharepoint`; adding a
`require('./reconcile')` is consistent). GET only — reconcile is a pure read;
the *actions* it points at already have routes (`sync-sharepoint` to pull,
`prefillRun` to convert). No new POST, no new pull surface, no token change
beyond the standing GET policy.

### First consumer + what this unblocks — SHIPPED 2026-07-31

Implemented by `backend-builder` (`lib/reconcile.js`, `sharepoint.js`'s
`indexFilesUnder`, the `GET /api/projects/reconcile` route), security-audited
clean by `security-auditor` (read-only confirmed by tracing the call graph, no
traversal/ReDoS/circular-require issue), and reviewed sound by `warden`
(matches the revised §1 spec field-for-field; independently re-ran the real
54-folder index and reproduced the exact counts). `.claude/agents/warden.md`'s
SharePoint caveat is updated to point at this route instead of the old
"don't yet cross-reference" warning — this is the literal mechanism for the
user's stated top requirement, "track the conversion of files for completion
from the SharePoint."

### Cost + the rejected alternative

**Cost:** one new ~120-line module, ~15 lines added to `sharepoint.js`, one GET
route, one UI consumer (a reconcile panel, or just the warden agent) later. The
real maintenance risk is `normalizeOrderId` drifting as new orders are added
with folder-naming habits that break the single-`22xxx`-token assumption —
bounded by the `ambiguous` bucket (unmatched/duplicate names surface for a
human instead of mismatching silently). Zero new dependency, zero Graph
surface, zero write path.

**Rejected — extend `syncSharepointFolder` to diff-and-report instead of a
separate reconcile module.** Tempting (sync already enumerates the bound folder
and skips-by-name, so it "almost" knows what's missing). Rejected because sync
is single-level and file-keyed (it pulls *loose files* in the bound folder,
skipping by filename), while reconciliation is folder-keyed and needs the
recursive order-folder tree — a different traversal and a different key. Bolting
a reporting mode onto a pull function would either force sync to grow the
recursive folder logic it doesn't need, or force reconcile to inherit sync's
flat file-name model that can't see the per-order folder structure. Keeping the
read-only join in its own module leaves both functions single-purpose and
deletable.
