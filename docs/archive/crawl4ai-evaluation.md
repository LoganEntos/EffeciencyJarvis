# crawl4ai — intake evaluation (2026-07-12)

**Question (task t-b7527e3d):** should `unclecode/crawl4ai` be incorporated as a
fetch tool for the GitHub-intake team — as a sibling tool / MCP the hub drives —
or skipped, given the existing Scrapling MCP?

**Decision: SKIP for now.** Do **not** install it, and do **not** add a second
always-on scraper MCP. Keep Scrapling as the sole scraper. Revisit only as an
**on-demand CLI** (never an always-on MCP) *if* a deep-crawl / docs→markdown
RAG-ingestion feature is ever greenlit. No install performed.

## License — cleared

`unclecode/crawl4ai` is **Apache-2.0** (confirmed from the repo's
`license.spdx_id` via the GitHub API, not just the README claim). Permissive;
compatible with the hub's accept-list (MIT/OFL/ISC/Apache-2.0/BSD/CC0). License
is **not** the blocker.

## What crawl4ai is

Async, LLM-oriented web crawler. Turns pages into "clean, LLM-ready Markdown"
("Fit Markdown" heuristic filtering), with CSS **and** LLM-driven extraction
strategies, schema-based JSON extraction, deep crawling (BFS/DFS/Best-First with
`resume_state` crash recovery), full-page/infinite-scroll scanning, and media
extraction. Ships a Dockerized FastAPI server and an MCP integration. **Requires
Playwright** (Chromium/Firefox/WebKit) — `crawl4ai-setup` pulls browser binaries;
Docker image wants `--shm-size=1g`. Heavy Python dependency footprint.

## Overlap with Scrapling — HIGH

The hub already runs **Scrapling** (BSD-3-Clause) as its only MCP
(`scrapling.exe mcp`, `.mcp.json`), driven by the `scraper` haiku agent. The two
tools overlap on nearly every axis the GitHub-intake team uses:

| Capability                    | Scrapling (installed)                          | crawl4ai (proposed)                     |
|-------------------------------|------------------------------------------------|-----------------------------------------|
| Browser engine                | Playwright (Dynamic/StealthyFetcher)           | Playwright (multi-browser)              |
| Ships an MCP server           | **Yes — the hub uses it**                       | Yes                                     |
| Fetch a raw file from a repo/CDN | Yes (`fetch`/`get`)                          | Yes                                     |
| Markdown export               | Yes (`scrapling extract` → .md)                | Yes (its headline feature, richer)      |
| Crawl / follow links          | Yes (Scrapy-like spider, pause/resume)         | Yes (BFS/DFS/Best-First)                |
| Extraction                    | CSS/XPath/regex + adaptive selectors           | CSS + **LLM-driven** + schema JSON      |
| Anti-bot / stealth            | **Strong** (Turnstile bypass, fingerprint spoof, TLS impersonation) | Basic managed-browser/proxy |

**Where each genuinely leads:**
- **Scrapling** wins on *resilient stealth fetching* — Cloudflare Turnstile
  bypass, fingerprint spoofing, adaptive selectors that survive site changes.
- **crawl4ai** wins on *LLM-corpus building* — Fit-Markdown + LLM/schema
  extraction + deep-crawl strategies, i.e. RAG ingestion pipelines.

## Why skip

1. **The GitHub-intake team's actual need is already met.** That workflow fetches
   *specific, known* files from a repo or CDN (sprites, a CSS/JS file, a JSON) and
   vendors them locally. Scrapling's `fetch`/`get` (+ one-time `curl`/WebFetch)
   covers this completely. crawl4ai's edge — LLM-markdown, deep crawls, RAG
   extraction — is not what "download this sprite and update the manifest" needs.
2. **Per-run context tax (hard ground rule).** Every entry in `.mcp.json` loads
   its tool schemas into *every* run's context. A second scraper MCP taxes all
   runs for a capability the first already provides — exactly what the ground
   rules and the task itself warn against ("don't add a second always-on scraper
   MCP just to have it").
3. **Install weight for no new capability.** Playwright browser binaries + a
   large Python dep tree (Scrapling's Playwright is already installed), all to
   duplicate fetch/markdown/crawl that Scrapling does — with weaker anti-bot,
   which is the dimension that actually matters for protected supplier/freight
   pages the scraper hits.
4. **Zero-dep app invariant.** It's Python, so it could only ever run as an
   out-of-process sibling — never bundled. That's fine in principle, but points 1–3
   mean there's nothing to run it *for* today.

## When to revisit (the conditional keep)

Add crawl4ai **only** if the hub gains a feature that genuinely needs
LLM-corpus crawling — e.g. a "docs ingestion" / knowledge-base builder that deep-
crawls a documentation site into markdown for memory/RAG. Even then, prefer an
**on-demand CLI** invoked per-task (spawned like the CSM sidecar / Hermes
Desktop) over an always-on MCP, so it costs zero per-run context until used.
Trigger to reopen this doc: a greenlit deep-crawl or site→markdown ingestion
feature. Until then, Scrapling + one-time curl/WebFetch is the answer.
