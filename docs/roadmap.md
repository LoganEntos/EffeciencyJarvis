# Claude Hub — Roadmap (prioritized for snowball value)

Ordering rule: items that make every LATER item cheaper/better ship first.
Statuses: ✅ done · 🔜 next · ⬜ queued · 🔮 deferred (needs trigger/user OK)

## ✅ P0 — Standalone repo (2026-07-10)
App extracted from the Power BI project into this clean repo. App-only
CLAUDE.md so hub runs never inherit PBI/swarm context (was the hallucination
source). Old project left intact at `bigplans.SemanticModel` for the user to
archive when ready.

## 🔜 P1 — UI/UX skill pack (github.com/nextlevelbuilder/ui-ux-pro-max-skill)
Install as a Claude skill (markdown only, zero deps, free). Every future UI
iteration — including vibe-code fixes — gets professional design guidance
baked in. Highest leverage per unit effort; improves everything after it.

## 🔜 P2 — Mobile polish + Tailscale access
User will access the hub from a phone via their own Tailscale
(`tailscale serve --bg 5757`). App work: audit every tab at 375px, touch
targets, composer ergonomics. Cheap now, multiplies daily usefulness.
USER ACTION: install Tailscale on PC + phone (agent never touches VPN/network).

## ⬜ P3 — Playwright E2E suite (playwright.dev)
Now possible because the repo is standalone. Dev-only dependency (NEEDS USER
OK — app runtime stays zero-dep): drive real browser flows (send prompt →
bubble renders; upload → process; artifact renders) in CI-able form. Locks in
every future change against regressions → permanent velocity gain. Replaces
nothing: extends scripts/verify-dashboard.ps1 (endpoint smoke) with UI truth.

## ⬜ P4 — Task queue for autonomous improvement loops
Option A (zero-dep, preferred first): hub-native "Tasks" tab — a queue of
improvement items the Run tab works through one per run, with status/history.
Option B: claude-task-master (github.com/eyaltoledano/claude-task-master) as
MCP — mature PRD→tasks breakdown, but adds an npm global + MCP schema token
cost to every run (NEEDS USER OK). Decide after A proves the workflow.

## ⬜ P5 — Document→markdown intake (github.com/zcaceres/markdownify-mcp)
Upgrades the Files inbox: convert uploaded PDF/DOCX/XLSX/images to markdown
before a run processes them → dramatically fewer tokens per document task.
Needs pnpm + uv deps (NEEDS USER OK). Pairs with P4 for batch document jobs.

## 🔮 P6 — Tavily search API (tavily.com)
Web search for hub runs. DEFERRED: the claude CLI already ships WebSearch and
this project has Scrapling available; Tavily adds an API key + per-call cost
for marginal gain. Trigger: research-heavy runs start failing on search quality.

## 🔮 P7 — 21st.dev component library
React/Tailwind component marketplace — conflicts with the zero-dependency
vanilla rule. Trigger: only if a deliberate React rewrite is ever chosen
(e.g. Base44-style visual builder direction). Until then: reference for
visual inspiration only.

## ⬜ P2.5 — Hub restyle per the frontend-aesthetics cookbook
Anthropic's cookbook (platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics)
adopted 2026-07-10: distilled rules live in CLAUDE.md (Design language) and are
auto-injected into every run's artifact hint (lib/runs.js). The hub's own UI
currently violates two call-outs — Segoe UI system font + purple gradient
accent — so a restyle pass (distinctive font, dominant-color palette,
staggered load reveal, layered background) is queued; fold into P1/P2 UI work.

## ⬜ P4.5 — Scheduled runs (idea mined from nousresearch/hermes-agent)
Hub-native cron: define recurring prompts (e.g. "every Monday 9am: summarize
last week's runs and errors into a report artifact") stored in data/, executed
by the run engine with auto-routing. Zero-dep (setInterval + persisted
schedule). Combined with P4's task queue this completes the autonomous
improvement loop. We do NOT adopt hermes-agent itself: it's a parallel
Python agent stack (own harness/models/gateway) that duplicates the claude
CLI and violates the no-trial-install rule.

## ⬜ P5.5 — Markdown export / Obsidian handoff (obsidian.md)
Runs and session summaries exported as plain .md files into a user-chosen
folder (an Obsidian vault works out of the box — local, private, no deps;
writing files is all it takes). Gives run history a durable, searchable,
linkable knowledge layer outside the hub. AWAITING USER: confirm they use
(or want) Obsidian and the vault path before building.

## 🔮 Evaluated, no action (2026-07-10)
- **per-simmons/damon-ade** — agentic dev environment, macOS Apple Silicon
  ONLY; user is on Windows 10. Reference for UI inspiration at most.
- **charlie-labs** — commercial autonomous engineering agent (GitHub/Linear/
  Slack); a product, not an adoptable tool. Their "instructions + daemons
  catalog" pattern is prior art for P4's task queue design.

## ⬜ Backlog (earlier ideas, still valid)
- Routing-accuracy feedback loop: compare auto-routed model vs run outcome,
  tune the heuristic from real data.
- xlsx structural preview in the Files tab (zero-dep zip/xml parse).
- Dark/light theme with system preference detection.
- Interactive permission approvals (bidirectional `--input-format
  stream-json` runs) — big; unlocks mid-run questions from Claude.
- Library tab polish (user: fine for now).
