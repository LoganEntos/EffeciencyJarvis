# GitHub intake list

**Every external GitHub repo the hub uses or has been asked to look at, + its
incorporation status.** This is the human-editable list — add a row when you find
a new repo. The live **Sources** tab (in the app) renders the same data from
`claude-dashboard/lib/sources.json`; keep the two in sync, or just edit here and
tell me to mirror it.

**Status key:** ✅ incorporated · 🟡 queued (to evaluate) · ⛔ declined/skip · ⚠ blocked (license)

## Incorporated ✅

| Repo | License | Used for |
|------|---------|----------|
| [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | ISC | vendored icon sprite |
| [tabler/tabler-icons](https://github.com/tabler/tabler-icons) | MIT | vendored icon sprite |
| [twbs/icons](https://github.com/twbs/icons) | MIT | vendored icon sprite (Bootstrap) |
| [halfmage/pixelarticons](https://github.com/halfmage/pixelarticons) | MIT | vendored pixel icon sprite |
| [bansal/pattern.css](https://github.com/bansal/pattern.css) | MIT | vendored background patterns |
| [sindresorhus/modern-normalize](https://github.com/sindresorhus/modern-normalize) | MIT | vendored CSS reset |
| [affaan-m/ecc](https://github.com/affaan-m/ecc) | MIT | 278-skill ECC library (18 active) |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | 6 adopted UI skills |
| [ibelick/ui-skills](https://github.com/ibelick/ui-skills) | MIT | ui-design / polish skills |
| [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling) | BSD-3-Clause | the scraper MCP (only MCP wired) |
| [SesameAILabs/csm](https://github.com/SesameAILabs/csm) | Apache-2.0 | CSM-1B local neural voice |
| [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | MIT | 2nd agent stack — **deprecated**, behind Config toggle |

## Queued — to evaluate 🟡

| Repo | License | Notes |
|------|---------|-------|
| [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) | Apache-2.0 | "add this in" — local personal-AI project; assess overlap with hub voice/runs |
| [browser-use/browser-harness](https://github.com/browser-use/browser-harness) | MIT | browser-automation harness; skill-authoring loop Scrapling lacks |
| [zcaceres/markdownify-mcp](https://github.com/zcaceres/markdownify-mcp) | MIT | doc→markdown MCP (roadmap Q2); MCP context-tax caveat |
| [karpathy/llm-council](https://github.com/karpathy/llm-council) | ⚠ **none (all rights reserved)** | N10 Council prior art — reference-only until author adds a license |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | MIT | Subagent-definition structure reference (100+ agents). `frontend-developer` + `websocket-engineer` were the closest analogs when authoring our frontend-engineer/voice-engineer (2026-07-27). Borrow structure, not prose — ours encode project hazards, theirs are generic |
| [wshobson/agents](https://github.com/wshobson/agents) | MIT | Multi-harness agent marketplace (200+). Confirms our opus/sonnet/haiku tiering; ships `performance-engineer` prior art (we wrote our own house-style node-perf-engineer instead of importing its cloud-flavored version) |
| [contains-studio/agents](https://github.com/contains-studio/agents) | ⚠ **license unclear (no LICENSE file)** | Prompt-writing *style* reference only (terse, example-triggered descriptions). Do NOT copy files verbatim until licensing is confirmed |

## Declined / skip ⛔

| Repo | License | Why |
|------|---------|-----|
| [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | Apache-2.0 | overlaps Scrapling; 2nd always-on scraper MCP not worth the per-run tax. Revisit as on-demand CLI only. See `crawl4ai-evaluation.md` |
| [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | MIT + Commons Clause | not as an always-on MCP (roadmap Q3); hub-native task queue covers it |

---

### How to add a future repo
Drop a row in the right table above (Repo link · License · Notes). When you want it
actually wired in, tell me — I'll evaluate the license, decide vendored/sibling/skip,
and mirror it into `claude-dashboard/lib/sources.json` so the Sources tab shows it.
