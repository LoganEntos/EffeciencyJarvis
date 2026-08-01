---
name: vpp-extraction
description: >
  Proven method for converting VPP historical order PDFs (proforma
  invoices/PIs) to reconciled CSVs. TRIGGER: converting a VPP order PDF to
  CSV, reconciling a VPP order, or any work inside a VPP project's
  historical-import task. Codifies the method proven 2026-07-30/31 against
  61 real orders (42+ reconciled to the cent) — use this instead of
  re-deriving the parsing approach from scratch.
---

# VPP order PDF → CSV extraction

Proven against real VPP historical orders. This is the actual method —
follow it, don't improvise a new one. If a step below fails for an order,
that order needs a human, not a workaround (see "When to stop" at the end).

## Extraction

- Use `pdftotext -table`, never `-layout` — `-layout` has been confirmed to
  float the Amount column onto the wrong row on real orders (22439 class of
  bug). `-table` is the validated method.
- Row regex has only been validated against 2025-2026-era PI documents.
  Older layouts (pre-2025) are unverified — treat a 0-rows-parsed result as
  "needs a human look," never as "this order has no line items."

## The truth rule: printed Amount, not qty×price

- `line_total` = the PDF's own printed Amount column, NOT a computed
  `qty × unit_price`. Real PIs print unit prices rounded to 2 decimals while
  the true per-piece price is 3 decimals (e.g. `166.80/300 = $0.556` shown
  as `$0.56`) — computing from the displayed price bakes in a rounding
  error across the whole row.
- Gate this with a float-guard: printed Amount ÷ qty must fall within ~$0.01
  of the displayed unit price. If the guard fails, fall back to computed
  `qty × price` AND flag the order NEEDS-REVIEW — never trust an
  out-of-tolerance printed number blindly either.

## Page-break dedup

- `pdftotext -table` re-prints a row at the top of the next page when a
  table spans pages — this is a genuine pagination artifact, not a
  duplicate line item, on every case verified so far (confirmed by
  byte-identical qty/price/amount between the original and the repeat).
- Dedupe by sequence number, keeping the first occurrence. Only treat a
  repeat as a REAL conflict (and flag NEEDS-REVIEW) if the repeated rows
  ever disagree with each other — don't silently drop a genuine duplicate.

## Known format variants (10 confirmed fixes — check for these before assuming a parse failure is a new bug)

- Optional row-period in the row number.
- Unit variants: `PC` / `PCS` / `PCES` / `SETS`.
- `$`-with-space before the amount.
- Subtotal/PCS totals printed in varying line orders, including
  slash-joined mixed units and templates that split a total across two
  lines.
- `GRAND TOTAL` used as the Subtotal fallback when no separate fee line
  exists.

## Reconciliation checks (an order isn't "done" until all of these pass)

1. Row count = number of PDF line items.
2. Σ qty = the PDF's own printed PCS/quantity total.
3. Σ line_total = the PDF's own printed subtotal.
4. Per-row cross-check: `qty × unit_price ≈ amount` (within the float-guard
   tolerance) for every line, not just the totals.

Zero mismatches on all four is what "reconciles to the cent" means in this
project's todos — don't report an order as done on partial agreement.

## SharePoint year-folder attribution (if labeling which archive year an order belongs to)

SharePoint buckets orders by paid/closed date, NOT the PI's own printed
`order_date` — confirmed mismatch on real orders (e.g. a PI dated Aug 2025
living under SharePoint's 2026 folder). Cross-reference the full-tenant
index by basename, not by any date parsed out of the CSV. Filenames differ
cosmetically between the SharePoint copy and the local copy (spaces vs.
underscores, `&` vs `_`) — match on a stripped-to-alphanumeric basename, not
an exact string.

## Risk by era (stratify before batch-processing a folder)

- **Recent (2025-2026)** — lowest risk, the method above is validated
  directly against this era.
- **2022-2024** — higher risk: multiple candidate PI/invoice files per
  order are common (revisions, proforma vs. signed, mixed supplier codes)
  with no single obvious authoritative file. Picking the wrong one is a
  real failure mode. The extraction method itself is unverified against
  pre-2025 layouts.

## When to stop and ask a human (never guess past these)

- **0 rows parsed** — don't skip silently, don't assume "no line items."
- **Multiple candidate PI/invoice files in one order's folder with no
  obvious authoritative pick** — a human must decide which document(s)
  constitute the order; this is not a parsing problem.
- **A document that isn't actually a supplier PI** (e.g. a domestic
  purchase order, a commercial invoice with a service-fee model) — out of
  this method's scope, needs a different template or a human call.
- **The order's own printed subtotal disagrees with the sum of its own line
  items** — a source-document inconsistency, not a bug in this method;
  every row can individually verify against its own math and the order
  still isn't reconcilable.
