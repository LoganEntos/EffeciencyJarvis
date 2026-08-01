---
name: sharepoint-recon
description: >
  How to check a project's SharePoint-vs-local reconciliation state
  correctly — the real statuses, the staleness rule, and how to read an
  "ambiguous" result. TRIGGER: checking whether a project's conversion work
  is actually complete against SharePoint, reporting completion numbers to
  the user, or any "is X done yet" question about a project synced to
  SharePoint. Use this instead of reasoning about completion from memory or
  from a stale prior report.
---

# SharePoint reconciliation — how to read it correctly

`GET /api/projects/reconcile?id=<projectId>` (read-only) calls
`reconcileProject(id)` in `claude-dashboard/lib/reconcile.js`. This is the
ONLY source of truth for "is this project's SharePoint-vs-local state
actually reconciled" — don't infer completion from a prior session's report
or from counting local files by hand.

## The five real statuses (per order)

- **complete** — matched to an upstream folder AND the local order's own
  state is complete.
- **local-incomplete** — matched to an upstream folder, but the local order
  itself isn't in a complete state yet.
- **upstream-only** — a SharePoint folder with no matching local order at
  all.
- **local-only** — a local order with no matching upstream folder (surfaces
  even when the true upstream match was missed on a case-sensitivity edge,
  by design — see the module's own comments before assuming this means
  "truly missing").
- **ambiguous** — the folder name has no clean order-id token, or its token
  collides with another folder's. An ambiguous row includes every candidate
  token found in the raw folder name — read those candidates, don't just
  report "ambiguous" and move on.

## Staleness — check this before quoting a number

The response includes `stale: true/false`, based on the index's own
`builtAt` timestamp vs. a ~2-day threshold (`STALE_MS` in `reconcile.js`) —
advisory, not a hard block. **If `stale` is true, the completion numbers are
not trustworthy** — rebuild the SharePoint index first
(`claude-dashboard/lib/sharepoint.js`'s crawl), then re-reconcile, before
presenting a completion count to the user. Presenting a stale number as
current is exactly the mistake that produced an incorrect "47/54" report
during the 2026-07-31 VPP work — the real live number at the time was
42/6/5/8/0 against a stale index.

## What this skill does NOT cover

This is a read-only status check, not the extraction/conversion method
itself (see the `vpp-extraction` skill for that) and not the crawl/index
build itself (`lib/sharepoint.js`). Don't rebuild the index from this
skill's instructions — call the existing crawl endpoint and let it run.
