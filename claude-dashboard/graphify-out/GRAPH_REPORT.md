# Graph Report - claude-dashboard  (2026-07-10)

## Corpus Check
- 20 files · ~99,328 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 277 nodes · 484 edges · 18 communities (15 shown, 3 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2c74d913`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- runs.js
- memory.js
- core.js
- schedules.js
- run.js
- app.js
- tasks.js
- util.js
- agentgraph.js
- tasks.js
- agentviz.js
- Claude Code Hub (claude-dashboard)
- assetlib.js
- memory.js
- files.js
- graph.js
- manifest.json

## God Nodes (most connected - your core abstractions)
1. `handle()` - 13 edges
2. `$()` - 11 edges
3. `startRun()` - 10 edges
4. `handle()` - 10 edges
5. `okId()` - 9 edges
6. `attachStream()` - 8 edges
7. `openRun()` - 8 edges
8. `load()` - 8 edges
9. `search()` - 8 edges
10. `handle()` - 8 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (18 total, 3 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.07
Nodes (30): DASH_DIR, fs, handle(), INBOX, inboxFile(), listFiles(), parseMultipart(), path (+22 more)

### Community 1 - "runs.js"
Cohesion: 0.11
Nodes (36): active, broadcast(), cancelRun(), countArtifacts(), crypto, DASH_DIR, deleteRun(), dequeueNext() (+28 more)

### Community 2 - "memory.js"
Cohesion: 0.19
Nodes (24): addNote(), captureRun(), crypto, DASH_DIR, DATA_DIR, distill(), fs, handle() (+16 more)

### Community 3 - "core.js"
Cohesion: 0.14
Nodes (23): activity(), agentList(), assets(), CLAUDE_HOME, commandList(), config(), DASH_DIR, detail() (+15 more)

### Community 4 - "schedules.js"
Cohesion: 0.14
Nodes (23): crypto, DASH_DIR, DATA_DIR, describe(), enrich(), fire(), fs, handle() (+15 more)

### Community 5 - "run.js"
Cohesion: 0.20
Nodes (21): addEl(), addMsg(), attachStream(), chat, ensureRunUI(), excerpt(), finishRun(), histRuns (+13 more)

### Community 6 - "app.js"
Cohesion: 0.23
Nodes (20): api(), boot(), ensureOverlay(), esc(), fmtEvent(), goTab(), KIND_COLOR, listView() (+12 more)

### Community 7 - "tasks.js"
Cohesion: 0.21
Nodes (16): crypto, DASH_DIR, DATA_DIR, enrich(), fs, handle(), load(), newId() (+8 more)

### Community 8 - "util.js"
Cohesion: 0.16
Nodes (12): collectMd(), frontmatter(), fs, listDir(), NODE_BIN, NPX_CLI, path, run() (+4 more)

### Community 9 - "agentgraph.js"
Cohesion: 0.24
Nodes (11): buildGraph(), handle(), MODEL_PERSONA, okId(), path, runs, RUNS_DIR, short() (+3 more)

### Community 10 - "tasks.js"
Cohesion: 0.39
Nodes (8): addSchedule(), addTask(), ensureTasksUI(), refreshSchedules(), refreshTasks(), relFuture(), runAllTasks(), taskState()

### Community 11 - "agentviz.js"
Cohesion: 0.43
Nodes (6): aviz, drawLoop(), fetchAgentGraph(), renderAgentDetail(), renderAgentViz(), stopAgentViz()

### Community 12 - "Claude Code Hub (claude-dashboard)"
Cohesion: 0.25
Nodes (7): API endpoints, Claude Code Hub (claude-dashboard), CLI prerequisites, Layout, Security notes, Start it, Tabs

### Community 13 - "assetlib.js"
Cohesion: 0.47
Nodes (3): copySnippet(), drawIcons(), injectSymbols()

### Community 14 - "memory.js"
Cohesion: 0.67
Nodes (3): ensureMemoryUI(), loadMemory(), MEM_ICON

## Knowledge Gaps
- **98 isolated node(s):** `aviz`, `renderers`, `loaded`, `KIND_COLOR`, `MEM_ICON` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `aviz`, `renderers`, `loaded` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07007575757575757 - nodes in this community are weakly interconnected._
- **Should `runs.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10810810810810811 - nodes in this community are weakly interconnected._
- **Should `core.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._
- **Should `schedules.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14492753623188406 - nodes in this community are weakly interconnected._