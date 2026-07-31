# VPP Historical Data Conversion — Project Summary

*Prepared 2026-07-31 for management review.*

## 1. Project Overview

This is a purpose-built tool (a "Projects" module inside the user's local Claude Code Hub dashboard) that converts VPP's historical supplier order documents — PDF proforma invoices and commercial invoices stored in SharePoint — into structured, line-item CSV data, and reconciles that converted data against the source PDFs to the cent. It replaces what was previously manual file-hunting and hand-entry: someone opening each order's PDF, reading line items, and re-keying them.

The tool was built and iterated inside the same local dashboard the user already uses to run Claude Code work (`claude-dashboard/`), started 2026-07-10. As of 2026-07-31, it is mid-conversion on a defined historical backlog, with the bulk of the work complete and a small, well-defined tail remaining that requires human judgment rather than more engineering.

**What it solved:** manually locating, opening, and transcribing line-item data from scattered SharePoint order PDFs into usable structured data — described in the project's own planning notes as "manual file hunting, broken previews, or inconsistent project organization."

## 2. Architecture & How It Works

- **Source:** Microsoft SharePoint, specifically `Operations/Orders/Orders VPP/Closed Order History/<year>/`, covering 54 closed orders from 2022–2026 (2 in 2022, 9 in 2023, 15 in 2024, 21 in 2025, 7 in 2026). Each order folder holds one or more supplier PI/commercial-invoice PDFs.
- **Extraction:** PDFs are converted to CSV using `pdftotext -table` (table-mode extraction, not layout mode). A recurring quirk was identified and corrected: source PDFs print unit price to 2 decimals while the true per-piece price carries 3 decimals, so `qty × displayed price` doesn't reconcile by design — the tool trusts the PDF's own printed line-total instead, with a numeric-guard fallback. A page-break artifact (duplicated rows across page breaks) is also detected and deduplicated.
- **Pairing:** `lib/pairing.js` scans a project's local folder (never opens PDF contents) and matches each PDF to its corresponding `order-<id>.csv` by order-id pattern matching, classifies each PDF (signed PI / commercial invoice / unknown), detects multi-part PI sets, and flags anything ambiguous or duplicated for human review rather than guessing. Every order lands in one of four states: **complete**, **pdf-only**, **csv-only**, or **review**.
- **Reconciliation:** `lib/reconcile.js` (added 2026-07-31) cross-checks the locally converted set against a full offline SharePoint index (`data/sharepoint-index.json`) to surface anything present upstream but missing locally, or vice versa. Line-level reconciliation checks row count, summed quantity, and summed line-total against each PDF's own printed totals — "to the cent."
- **Output format:** a per-order `order-<id>.csv` line-item export, plus a project-level `manifest.csv`, `CHRONOLOGICAL-INDEX.md`, `CONVERSION-CHECKLIST.md`, and `REVIEW.md`. **No "Entos OS"/Tenexity/Graham output template exists or was found in this repo.** The only related mechanism is a manual "uploaded to database" checkbox per order — the tool tracks that a human has pushed the data into Entos OS, but does not integrate with, format for, or write into Entos OS/Supabase itself. That hand-off is currently a separate manual step outside this tool.
- **SharePoint interaction:** read-only by default. A full-tenant file index is built on an explicit "Build index" action (not continuously live-enumerated, by design — the tool's hard rule is no silent/automatic business-data access). Pulling files into a project is a manual "Sync now" action. No Power Automate integration exists; access is via a manual Microsoft Graph sign-in inside the app.
- **Autonomy:** fully manual. There is no autonomous background loop driving VPP conversion — the hub's separate self-improvement/autopilot engine is off by default (deliberately, after an incident on 2026-07-27 where it over-consumed run capacity) and a gated future hook for a "Projects backlog" autonomous queue exists in code but is disabled with no UI to enable it. Every conversion batch to date was run as an explicit, human-authorized pass.

## 3. Use Cases

| Use case | Input → Output | Who benefits | Status |
|---|---|---|---|
| PDF → CSV extraction | Supplier PI/invoice PDF → line-item CSV | Ops/finance needing structured order data | Complete, in production use |
| PDF/CSV pairing & gap detection | Project folder contents → complete/pdf-only/csv-only/review status per order | Whoever is running the conversion pass | Complete |
| Local ↔ SharePoint reconciliation | Local project state + SharePoint index → match/mismatch report | Catching missed or stale files | Shipped 2026-07-31 |
| Line-item totals reconciliation | CSV line items vs. PDF printed totals | Data-quality assurance ("to the cent") | Complete, used on all 47 converted orders |
| Manual SharePoint sync | User-triggered pull of new/updated files | Keeping local project current | Complete (manual trigger only) |
| Entos OS hand-off tracking | Per-order checkbox: "uploaded to database" | Visibility into what's left to push downstream | Tracking only — actual upload/integration not built |

## 4. VPP Historical Data Conversion — Specific Progress

- **47 of 54 historical orders converted and reconciled** as of the most recent status recorded on 2026-07-31 (up from 5 of 54 the day before, after this was prioritized for same-day completion).
- Broken into tiers: **Tier 1** (4 orders, 2026) — 100% complete. **Tier 2** (21 orders, 2025) — 100% complete. **Tier 3** (2022–2024) — turned out to be 27 orders rather than the originally estimated 25; worked through in two passes.
- **10 distinct parser/format bugs** were found and fixed during this pass (unit-of-measure variants like PC/PCS/PCES/SETS, split-document templates, etc.) — each one previously would have caused a silent miscount.
- **7 orders remain unconverted, and each needs a human decision, not more scripting:**
  - 4 have source PDFs with broken OCR/table structure.
  - 1 order (22082) has an unresolved ~120-unit quantity discrepancy between two conflicting source documents.
  - 1 order (22180) has a source PDF whose own printed subtotal doesn't match its own line items.
  - 2 orders (the original 2022 orders) haven't been attempted yet — each has 4–6 candidate source files, the highest ambiguity in the archive.
- **Conversion/success rate:** 47/54 = ~87% complete; the remaining 13% is gated on human document review, not tool capability.
- **Manual process before this tool:** not documented step-by-step anywhere in the project's records, but described directionally as manual file-hunting and inconsistent, ad hoc handling before the Projects tooling existed.

## 5. Scalability & Multi-Client Potential

The underlying pairing engine is generic — it works off any project folder and configurable order-id patterns, not VPP-specific code paths. However, the order-id extraction and folder-shape assumptions used for reconciliation are currently tuned to VPP's specific SharePoint structure. **Onboarding a new client today would require re-deriving that client's folder-naming and order-id conventions** — it is not a one-click reuse yet. No "AMDA" (Account Manager Data Acquisition) process or references were found anywhere in this project's code or documentation; if AMDA is a separate initiative, it has not yet been connected to this tool.

## 6. Time Investment vs. Long-Term Value

Precise hours were not tracked and can't be honestly reconstructed from this session — flagging that rather than guessing. As a rough engineering-activity proxy: the repository's first commit was 2026-07-10 and most recent was 2026-07-31 (three-week span), with 384 total commits and 23 of those touching the core pairing/reconciliation/UI files directly. That undercounts the actual VPP-specific effort, since a large share of the parser bug-fixing and order-by-order reconciliation work happened outside version control (tracked in a working status file, not git).

**Value delivered:** 47 historical orders now have machine-reconciled, cent-accurate structured data where none existed before, with a repeatable, auditable process (not one-off manual transcription) for the remaining orders and any future ones.

## 7. Dependencies & Known Constraints

- No Power Automate flow is involved; all SharePoint access goes through a manual, in-app Microsoft Graph sign-in and manual "Sync"/"Build index" actions — nothing runs automatically in the background.
- Reconciliation accuracy depends on the local SharePoint index being reasonably fresh (it's flagged if stale; was refreshed before the Tier-1 push).
- Each project must have its SharePoint folder explicitly bound before sync/reconcile will work.
- The Entos OS/Supabase hand-off is currently a manual step outside this tool — this is a known gap, not a bug.
- Two open decisions are blocking full completion, both requiring the user's input rather than more engineering: (1) exact semantics for a proposed "archive/delete-all" cleanup action in the pairing panel, and (2) manual review calls on the 7 remaining ambiguous orders.

## 8. Relationship to Entos OS (Graham/Tenexity)

No integration exists yet, and no template specification for Entos OS/Tenexity output was found anywhere in this project. The only connection point is a manual checkbox tracking whether a human has separately uploaded an order's data to that system. If format alignment with Entos OS is a requirement, that spec doesn't currently live in this project and would need to be defined and built as new work — the CSV output today is structured for accuracy/reconciliation, not for a specific downstream schema.

## 9. Next Steps & Roadmap

- Finish the remaining 7 orders — each needs a short human review pass (document selection or discrepancy resolution), not additional engineering.
- Decide the cleanup/archive semantics for completed projects in the pairing panel.
- If Entos OS integration is a priority, scope and build an actual output/upload path — today that hand-off is manual and untracked beyond a checkbox.
- If reuse for another client is desired, budget time to re-derive that client's SharePoint folder/order-id conventions before the pairing engine can be pointed at it.
