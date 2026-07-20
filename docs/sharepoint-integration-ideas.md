# SharePoint × Hub — deep-integration ideas (2026-07-20)

Grounded in what already exists: device-code auth, live browse (sites → drives →
folders), pull/push (50 MB cap, optional project folder), a full-tenant delta
index at `data/sharepoint-index.json` (files carry path/size/modified/id) with
search/tree/browse endpoints, `/weburl` resolution, and `/graphify`. Rule of the
house: runs answer discovery from the **index**, never a live enumeration, and
no file *content* is touched unless the user prompts for it that conversation.

Goal of this list: make SharePoint feel like ambient hub memory — surfaced
automatically, feeding other tabs, and strengthening Claude's answers — not a
walled-off tab.

## A. Auto-surface SharePoint inside conversations (Jarvis proactive)
1. **SharePoint recall toggle** — mirror the existing "◇ memory recall": a
   per-run switch that lexically searches the index for the prompt's keywords and
   injects the top-N matching file paths (+ snippets, see #15) into context.
   Grounds answers in real tenant docs with zero manual attaching. *Why: the
   single highest-leverage move — turns the index into live context.*
2. **Entity-triggered surfacing** — detect project/client/supplier names in the
   prompt and auto-attach the matching folder's file manifest. *Why: "how's the
   Entos rollout" silently gets the Entos folder listing as grounding.*
3. **"Did you mean this doc?"** — fuzzy references ("the Q3 deck") resolve
   against the index; Jarvis offers the exact file with a one-tap pull. *Why:
   kills the "which file?" round-trip.*
4. **Cited answers with web links** — when a reply leans on an indexed file,
   footnote it with the `/weburl` link + last-modified date. *Why: trust and
   click-through; the endpoint already exists.*

## B. Let the tabs feed each other
5. **Files → SharePoint smart push** — every inbox file gets a "push" affordance
   with a suggested destination folder inferred from its name/type vs the index.
6. **Projects ↔ folder binding** — bind a project to a SharePoint folder; its
   manifest auto-syncs and every run in that project sees the folder contents.
   *Why: projects already ride instructions + memory into runs — add docs.*
7. **Memory capture on reference** — when a run pulls or cites a SharePoint doc,
   write a memory record ("the pricing model lives at X"). *Why: next recall is
   instant and offline.*
8. **SharePoint in the Graph tab** — render the index as a navigable
   sites→drives→folders→files graph, reusing the agent-graph viz.
9. **Folders as Sources** — promote frequently-referenced folders to first-class
   pinnable "sources" that can be attached to any run.

## C. Search & discovery UX
10. **Command-bar (Cmd-K) unified search** — one ranked list spanning runs,
    memory, inbox files, AND the SharePoint index. *Why: one muscle-memory search
    for everything the hub knows.*
11. **Content-aware index search** — layer the memory-style lexical recall over
    filenames *plus* cached snippets, not just filename substring.
12. **Relevance ranking** — weight results by last-modified recency and how often
    a file has been referenced in past runs.
13. **Saved smart folders** — persistent filters ("Finance-site xlsx modified
    this month") surfaced as quick chips.

## D. Content extraction / enrichment
14. **Text extraction on pull** — reuse the zero-dep xlsx preview and add
    lightweight docx/pdf text so a pulled file is immediately queryable.
15. **Snippet enrichment during crawl** — pull the first few KB of small
    text/office files into the index so search matches on content, not just names.
16. **Auto-summary on pull** — a cheap-model one-liner per pulled file (like the
    session-summary sweep), shown in Files and fed to runs.

## E. Proactive / automated workflows
17. **Scheduled index refresh** — a nightly delta-crawl cron via the existing
    schedules engine so the index never goes stale.
18. **Watch-folders** — flag folders; a scheduled check surfaces new/changed
    files as a hub notification or a Jarvis nudge.
19. **"New in SharePoint" on Overview** — a recently-modified-files feed so the
    hub doubles as a tenant document-activity dashboard.
20. **Auto-file run artifacts** — when a run emits an artifact, offer to push it
    to the relevant project folder with a suggested name.

## F. Jarvis-native (voice / conversational actions)
21. **Voice pull** — "Jarvis, grab the sixth-floor budget" resolves against the
    index and pulls it into the inbox hands-free.
22. **Conversational push** — "save this to the Ops folder" pushes the last
    artifact/inbox file to a resolved destination, with a spoken confirm.
23. **Inline "where is X"** — the existing index-only discovery rule, but the
    answer lands in chat with folder path + link + last-modified.
24. **Cross-doc synthesis** — ask Jarvis to compare/summarize across several
    indexed docs; it pulls the needed few, extracts, and answers with citations.

## G. Trust & guardrails (non-negotiable given the no-business-data rule)
25. **Content-consent gate** — auto-surfacing *metadata/paths* is free; pulling
    actual file *content* always requires an explicit confirm.
26. **Per-site safe-list** — mark which sites are eligible for auto-surfacing so
    sensitive sites are never injected into a prompt.

## Suggested first three (highest value / lowest risk)
- **#1 SharePoint recall toggle** — biggest payoff, mirrors an existing pattern.
- **#17 scheduled index refresh** — makes everything else trustworthy by keeping
  the index fresh; pure reuse of the schedules engine.
- **#4 cited answers** — cheap, builds trust, `/weburl` already ships.
