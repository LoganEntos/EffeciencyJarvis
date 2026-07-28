# Claude Hub Project Cleanup Plan

## Objective

This project cleanup is focused on one immediate outcome: make the Claude Hub front end reliable enough to process VPP historical PDF-to-CSV work at speed without forcing manual file hunting, broken previews, or inconsistent project organization. The target is not a broad redesign. The target is a stable workflow that lets Logan pull VPP documents, preview them, convert them, pair each PDF with its CSV, and move through the historical backlog fast enough to support the Friday push.

## Scope

The active scope for this cleanup is limited to the workflow that directly supports VPP historical order processing. The relevant surfaces are Inbox, Projects, Run, and Jarvis only where Jarvis materially helps the workflow. Token usage visualization, broader UI polish, major orchestrator redesign, and any feature that does not improve throughput for this use case should be deferred until the core flow is stable.

## Source of Truth

Before any implementation work begins, the README and supporting notes need to be rewritten so the codebase reflects the current product instead of an older version of the app. Claude should be told to read the README first, produce a plan without changing files, wait for confirmation, then implement the approved changes and update the documentation afterward. The documentation must explain the purpose of each tab, the expected behavior for file handling, how attachments and previews are supposed to work across the interface, and how Projects should pair related files by identifier.

## Structural Cleanup

After the documentation is corrected, the next step is to simplify the product structure so each tab has a clear responsibility. Inbox should be the intake point for pulled files. Projects should be the organization and review layer where files are grouped and paired correctly. Run should remain the processing workspace if it is the most stable functional area. Any redundant or half-finished surfaces that confuse ownership between these tabs should either be removed from the active path, hidden, or clearly marked as non-essential until the VPP workflow is complete.

## Pairing Logic

Before adding more controls or cleanup tools, the file-pairing model in Projects must be defined. Claude should implement a clear rule that links each PDF to its matching CSV using a shared identifier or dependable filename logic. The interface should make it obvious when a file pair is complete, when a PDF exists without a CSV, when a CSV exists without a PDF, and when duplicates or unmatched files need review. This is a dependency for nearly every later improvement because cleanup actions become risky if the app does not first know which files belong together.

## Blocking Front-End Fixes

Once the pairing model is clear, Claude should fix the core blocking issues in the order they affect throughput. Projects must support attachments correctly. Projects must support previewing PDFs and output files without forcing downloads wherever possible. Projects and Inbox must have a refresh action so SharePoint pulls and imports can be verified immediately. Import Inbox to Project must become a reliable transfer path rather than a manual workaround. After that, the same attachment and preview behavior should be made consistent across every relevant tab so the workflow does not behave differently depending on which screen the user is on.

## Cleanup Controls

Only after pairing, preview, and import stability are working should batch cleanup actions be added. Organize, regroup, archive, and delete-all style controls should be treated as secondary features because they can destroy useful state if the pairing logic is not stable first. If destructive actions are added, Claude should separate safe cleanup from destructive cleanup so unmatched or unreviewed files are not accidentally removed.

## Validation Pass

Before using the workflow on the full historical backlog, the app should be tested on a small VPP sample set. The test should confirm that files can be pulled into Inbox, imported into Projects, previewed correctly, converted into CSV, paired visibly with the source PDF, and then used in the downstream manual OS process. The goal of the test is to confirm that the front-end path is no longer the bottleneck before processing fifty or more historical files.

## Backlog Execution

After the sample test passes, the historical VPP backlog can be processed in batches. Claude should optimize for throughput and lower token burn where possible, including preferring lighter models such as Sonnet when quality remains acceptable. The system should reduce manual effort around locating, previewing, pairing, and organizing files so the remaining manual OS entry work is the only manual step left in the process.

## Task Consolidation

The cleanup effort overlaps with existing work already open in ClickUp around orders, reorders, uploads, and historical backfill. Claude should treat this as one coordinated execution path rather than a scattered collection of unrelated tasks. The parent workstream should focus on end-to-end order and reorder workflow improvement, with child work sequenced around documentation, file pairing, Projects fixes, import and refresh reliability, validation, and historical backfill.

## Secondary Tracks

The scheduled GitHub audit agent can be useful, but it should be treated as a secondary track that supports the cleanup rather than replacing it. If documentation cleanup and tighter implementation instructions still do not produce reliable front-end results, a separate UI improvements project can be created with screenshots of each tab and state so Claude can work from visual references. Product ID standardization should remain a separate strategic track. It matters operationally, but it should not block the immediate VPP throughput objective.

## Required Sequence

Claude should execute this project in the following order through prose-driven planning and implementation: first lock the scope to VPP throughput, then rewrite the README and project notes, then simplify tab ownership and remove ambiguity in the workflow, then define the PDF-to-CSV pairing logic inside Projects, then restore attachments and previews in Projects, then add refresh and Import Inbox to Project, then add cleanup and organization controls, then validate the workflow on a small VPP batch, then process the historical backlog in controlled batches, and only after that move into audit automation, broader UI cleanup, or numbering strategy work.

## Final Instruction to Claude

Do not redesign the application broadly. Do not spend time on cosmetic improvements that do not improve throughput. Do not expand Jarvis or other orchestration layers unless that work directly helps this VPP pipeline. Read the documentation first, produce a plan before changing files, preserve the existing backend strengths, and focus the front end on a reliable high-volume PDF-to-CSV workflow with strong file organization, clear pairing, working previews, and minimal friction for historical VPP order processing.