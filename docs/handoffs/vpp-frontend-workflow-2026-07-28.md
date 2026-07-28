> **PROGRESS 2026-07-28 (same-day execution):** steps 2 and 4 are now ✅ DONE —
> README fully rewritten to the current product (`bd45350`), and the PDF↔CSV
> pairing model is BUILT: read-only pairing engine + `GET /api/projects/pairs`
> (`2218d53`) and the pairing panel in the Projects detail view (`9f8efdd`).
> All 5 canonical test orders pair complete (incl. the 22610/22610-2 split via
> manifest); smoke suite 106 checks green; both diffs code-reviewed SHIP.
> Live after the user's next hub restart. Remaining: steps 3 (tab ownership),
> 6 (dedicated refresh + surface the move/import action in Files/Projects),
> 5 (preview consistency pass), 8 (sample-batch validation), 9 (backlog runs).

# Handoff: VPP front-end workflow — make the PDF→CSV pipeline reliable

**Model:** Opus 4.8 · xhigh (multi-module product work). **Perms:**
bypassPermissions. **Toggle the ✦ Jarvis distiller OFF** before pasting (long prompt).

## Why this exists

The user's standing goal for the hub is **not** a redesign — it's a stable
front-end workflow for processing **VPP historical PDF→CSV** orders at volume
(the "Friday push"). The full directive is `docs/vpp-frontend-cleanup-plan.md`
(the user's own words, preserved verbatim). Scope is deliberately narrow:
**Inbox · Projects · Run**, plus Jarvis only where it materially helps. Token
viz, broad UI polish, and orchestrator work are **deferred** until the core
flow is stable.

## What is ALREADY done (verified against code 2026-07-28)

Mapped to the plan's Required Sequence (`docs/vpp-frontend-cleanup-plan.md` §Required Sequence):

| # | Plan step | Status | Notes |
|---|-----------|--------|-------|
| 1 | Lock scope to VPP throughput | directive only | the plan file is the directive |
| 2 | **Rewrite README + notes to match product** | ❌ NOT started | `claude-dashboard/README.md` last changed 2026-07-13; predates Projects, Jarvis/voice, personas, Health tab. **The plan's first item, still stale.** |
| 3 | Simplify tab ownership | ❌ NOT started | 18 tabs; no consolidation |
| 4 | **PDF↔CSV pairing logic in Projects** | ❌ NOT built | no pair/match/unmatched logic anywhere in `lib/projects.js` or the project client. Plan calls this the dependency for steps 5+. |
| 5 | Attachments + previews in Projects | ✅ mostly done | `projectdetail.js`: attached files + upload + inline preview (`openFilePreview` → doc viewer / sheet grid); PDF inline preview `b2d64e0` |
| 6 | Refresh + Import-Inbox-to-Project | 🟡 partial | auto-refresh on upload/delete + global "refresh current tab"; no dedicated Inbox/Projects refresh. "Import" today = SharePoint pull writes into the project folder, or a pasted prompt template (`projectsxfer.js`) = the "manual workaround" the plan wants replaced. **NEW this session: `POST /api/files/move` (root inbox file → project folder, one click) exists — it's the missing one-click transfer primitive, currently surfaced only in the Health tab.** |
| 7 | Cleanup/organization controls | ❌ NOT started | plan says do last |
| 8 | Validate on small VPP batch | 🟡 partial | `data/inbox/vpp-historical-import-test/` sample project exists; per its notes 22443 + 22613 extract exactly, 22439/22610 need bbox parse. Not a formal front-end validation pass. |
| 9 | Process historical backlog | ❌ NOT started | — |
| 10 | Audit automation / broad UI / numbering | 🔮 deferred | autopilot audit agent exists, deliberately OFF |

**Headline:** backend strong; previews/attachments largely work; the two items
the plan sequences FIRST — a current README and PDF↔CSV pairing — are the two
that don't exist yet.

## Also shipped this session (2026-07-28, adjacent to this workstream)

- **Contamination cleanup** (`2e859e0`, `f763ca1`, `dfc5584`) — quarantined a
  15-file foreign "Personal Jarvis"/crypto-trading package out of `data/inbox/`
  (it made Inbox a clean intake point, serving plan step 1); doc-staleness
  fixes; full record in `docs/archive/cleanup-2026-07-28-contamination.md`.
  ⚠ **Open user decision recorded there:** the Claude Flow V3 leftover in
  `.claude/helpers/` + `settings.json` can't be auto-purged while the statusline
  live-references it.
- **Health tab** (`1b42358`, `5a1b92f`, `8aef9b2`) — Monitor-group transparency
  tab (`lib/health.js` + `assets/health.js`): unassigned-inbox view with inline
  delete + **move-into-project**, doc health, live size guard, skills, backlog.
  Goes live on the user's next hub restart (server was on older code, not
  restarted mid-run). Adjacent to this plan's scope — reuse its `/api/files/move`
  for step 6, but don't expand the Health surface further under this workstream.

## Start here — the first work order (paste into a fresh Run-tab thread)

```
Read docs/vpp-frontend-cleanup-plan.md (the user's directive) and
docs/handoffs/vpp-frontend-workflow-2026-07-28.md (current status) first, plus
CLAUDE.md + HANDOFF.md for the hard rules (zero-dep, localhost-only, <500-line
files, security invariants, no client business data processed unless prompted,
no $ figures, no HTML-report artifacts).

Follow the plan's own instruction: PRODUCE A PLAN BEFORE CHANGING FILES, then
wait for my confirmation. Do NOT start implementing yet. Deliver, as concise
plain text in the reply (not an HTML artifact):

1. README REWRITE PLAN (plan step 2). Read claude-dashboard/README.md and the
   actual current code. List concretely what's stale/missing (Projects, Jarvis
   voice, personas, Health tab, the real tab responsibilities, how attachments
   and previews work across tabs, how Projects should pair files by identifier)
   and propose the corrected README's section outline. Do not rewrite it yet.

2. PDF↔CSV PAIRING MODEL DESIGN (plan step 4 — the dependency for everything
   after it). Propose the exact rule that links each PDF to its matching CSV by
   shared identifier / filename logic for the VPP case (look at the real
   filenames in data/inbox/vpp-historical-import-test/ and the loose invoice
   PDFs at inbox root for the identifier pattern — e.g. the order/PI number).
   Specify: how a pair is detected, the four visible states (complete / PDF-only
   / CSV-only / duplicate-or-unmatched), where this lives (server in lib/projects.js
   vs a new lib/pairing.js; client in the Projects detail view), and how it
   reuses the existing POST /api/files/move primitive rather than reinventing
   file transfer. Read-only introspection over data/inbox/<slug>/ — no new
   persistent state, no business-data processing.

Present both as options/recommendations for my approval. When I approve, we do
README first (rewrite → I confirm → update docs), THEN the pairing model, THEN
the plan's later steps (6 refresh/import, 5 preview consistency, 8 validation),
in the plan's Required Sequence. Commit per working, browser-verified stage,
no Co-Authored-By trailer; verify with scripts/verify-dashboard.ps1 -Port 5757
(100% green) and test server changes on a throwaway port 5758+ — never kill the
5757 listener.
```

## Notes for whoever fires this
- **Sequence discipline:** the plan is explicit — README (2) → tab clarity (3)
  → pairing (4) → import/refresh (6) → preview consistency (5) → validation (8)
  → backlog (9). Pairing (4) is the real technical dependency; the README (2) is
  quick and the plan puts it first, so front-load both in the planning pass above.
- **Reuse, don't rebuild:** `POST /api/files/move`, `importInbox()`
  (`lib/projects.js:109`), `openFilePreview` / doc viewer / sheetgrid, and the
  SharePoint pull-into-project path already exist. The pairing work is mostly a
  read-only matching layer + UI states on top of these, not new plumbing.
- **Stay in scope:** defer token viz, broad UI polish, Health-surface expansion,
  numbering strategy, and audit automation. Throughput for VPP is the only bar.
