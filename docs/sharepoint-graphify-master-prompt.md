# SharePoint Graphify — Master Prompt (hand-off to Fable 5)

> **Status: ROUGH DRAFT.** This is the hand-off spec for completely graphifying
> the entire Entos SharePoint estate. A draft/proof run has already been fired
> on the hub to prove the pipeline; the full 11,912-file build is the job below.
> Refine this prompt, then run it (ideally as a hub run so it shows in history).

---

## Paste-ready prompt

You can hand the block below to Fable 5 (in Claude Code or as a hub Run). Everything
it needs already exists on disk — do not re-crawl SharePoint.

```
Graphify the entire Entos SharePoint estate into a persistent, queryable knowledge
graph, kept SEPARATE from this repo's existing code graph.

INPUTS (already prepared — do not call Microsoft Graph, do not re-scan SharePoint):
- Corpus:  claude-dashboard/data/sharepoint-graphify-corpus/   (12 markdown docs)
    - 00-OVERVIEW.md ....... god-node backbone: every site + library with counts
    - NN-<site>.md ......... one doc per site: libraries -> folders -> files
                             (name, size, modified date)
    - manifest.json ........ document list + per-site file counts
- Raw index (source of truth, if you need item ids / paths):
    claude-dashboard/data/sharepoint-index.json
    shape: { builtAt, sites:[{ id,name,webUrl, drives:[{ id,name,webUrl,fileCount,
             files:[{ p:path, s:sizeBytes, m:"YYYY-MM-DD", id:itemId }] }] }], counts }
- Totals: 11 sites, 16 libraries, 11,912 files, 9,061 folders.

CRITICAL — DO NOT CLOBBER THE CODE GRAPH:
- The repo root already has graphify-out/ = the claude-hub CODEBASE graph. Do NOT
  overwrite it. Build the SharePoint graph in its own output location by running
  graphify with the corpus folder as the working directory, so the output lands at
  claude-dashboard/data/sharepoint-graphify-corpus/graphify-out/.

BUILD:
1. Run:  /graphify claude-dashboard/data/sharepoint-graphify-corpus --mode deep --directed
   (from a cwd such that graphify-out is written INSIDE the corpus folder, not repo root).
2. Internal Hub is 9,893 of the 12k files — expect it to dominate. If the run is too
   large for one pass, build incrementally: graphify 00-OVERVIEW.md + the small sites
   first, then add the big site with --update. Keep each batch within a sane token budget.
3. Communities should fall out along site / library / project-folder lines. Verify god
   nodes correspond to the 11 sites.

VERIFY (must pass before declaring done):
- graphify query "where do the VPP digital assets live"      -> points at VPP library
- graphify query "what invoices exist for FX007"             -> returns real paths
- graphify path "Internal Hub" "Shipping Docs"               -> a real folder chain
- Spot-check 5 returned paths against sharepoint-index.json (they must be real).

WIRE-UP (so the graph actually saves tokens later):
- Leave GRAPH_REPORT.md and graph.json in the SharePoint graphify-out.
- Update docs so future hub runs know: for SharePoint discovery, query THIS graph or
  search claude-dashboard/data/sharepoint-index.json — never enumerate SharePoint live.

CONSTRAINTS:
- Zero new npm deps in the app. Token efficiency is the goal — this graph exists so we
  stop paying to rediscover the tree on every pull.
- Do not touch business data content beyond what's in the prepared corpus/index.
```

---

## Notes for whoever runs this

- **Why a corpus of markdown, not the raw JSON?** graphify ingests a *folder of
  documents*. The prep script (`scripts/sharepoint-graphify-prep.js`, deterministic /
  zero-token) already shaped the index into per-site docs so communities and god nodes
  form along the real site/library/folder structure. Re-run that script after any
  future re-crawl to refresh the corpus.
- **Refreshing the index** happens from the hub's **SharePoint** tab → *Build index*
  (delta crawl, ~1 min for this tenant). Then re-run the prep script, then re-graphify
  with `--update`.
- **Cost control**: the deterministic prep is free; only the `/graphify` extraction
  costs tokens. Draft first (overview + small sites), confirm quality, then commit to
  the full Internal Hub pass.
- **Where this leaves the hub**: the SharePoint tab already lets you browse/pull/push
  and search the index with zero tokens today. The graph is the richer "explain /
  relationships" layer on top.

## Open refinements (finish before the real run)
- [ ] Decide directed vs. undirected (draft used `--directed` to preserve folder→file).
- [ ] Decide whether to split Internal Hub by top-level folder for cleaner communities.
- [ ] Decide final home for the SharePoint graph + how hub runs auto-discover it
      (candidate: a `--mcp` graphify server, or a documented query path in CLAUDE.md).
