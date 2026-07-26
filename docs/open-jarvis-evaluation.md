# open-jarvis / OpenJarvis — intake evaluation (2026-07-25)

**Question (roadmap queued row):** the user flagged `open-jarvis/OpenJarvis`
"add this in" (2026-07-12). Assess overlap with the hub's local-assistant surface
(voice/runs/schedules/memory) and decide what is worth porting.

**Verdict: SKIP — port nothing. REVISIT-WHEN local/offline (non-Claude)
inference ever becomes a hub goal.** No install, no port; keep it in Sources as
reference/prior-art only.

## License — cleared (not the blocker)

Apache-2.0 (`verified:true` in `lib/sources.json`; on the accept-list). License
is fine — the thesis mismatch is what kills it.

## What OpenJarvis is

A **local-first personal-AI framework** from Stanford (Hazy Research + Scaling
Intelligence, the "Intelligence Per Watt" program; v1.0 ~2026-03, ~8k stars).
Its reason to exist is running **local open-weight models by default, cloud
optional** — models land "within 3.2 pts of the best cloud model at ~800× lower
marginal cost." It decomposes a personal AI into five typed primitives:
**Intelligence** (weights/quant), **Engine** (Ollama/vLLM/SGLang/llama.cpp/
cloud), **Agents** (reasoning loop), **Tools & Memory**, **Learning** (a DSPy
optimizer that tunes the spec from local traces). Ships built-in agents (morning
digest w/ TTS, deep research, continuous monitor, orchestrator, ReAct, OpenHands
code-exec, chat), on-demand/scheduled/continuous modes, a skills catalog
(agentskills.io), a Tauri desktop GUI, Docker, and a `jarvis` CLI. **Stack:
Python ≥3.10 + Rust (Tauri) + TS, Ollama runtime, uv/DSPy.** Heavy dep footprint.

## Feature-by-feature vs the hub

| Capability            | Hub (today)                                            | OpenJarvis                              |
|-----------------------|--------------------------------------------------------|-----------------------------------------|
| Engine / model        | **Claude ONLY**, auto haiku/sonnet/opus routing        | **Local Ollama-first**, cloud optional  |
| Runtime / deps        | **Zero-dep Node built-ins + vanilla JS**               | Python + Rust/Tauri + TS, large dep tree|
| Network posture       | **localhost-only (127.0.0.1)**, Tailscale for remote   | Local-first desktop app / Docker        |
| Scheduled briefing    | Schedules + morning task via task queue                | Morning Digest agent (TTS)              |
| Deep research         | ECC deep-research skill + agent teams                  | Deep Research agent (multi-hop cites)   |
| Continuous/autonomous | Autopilot loop + task queue FIFO; 14 tiered subagents   | Monitor/ReAct/Orchestrator/Operative    |
| Skills                | Curated ~20 ECC skills (278-set library, not loaded)   | agentskills.io + Hermes/OpenClaw (~13k) |
| Memory                | Engram lexical memory (typed, no vectors)              | Tools & Memory primitive (retrieval)    |
| Self-improvement      | Autopilot reads `improvement-backlog.md` at runtime    | DSPy learning loop over local traces    |
| Voice                 | Wake word + 3 TTS engines + conversation orb           | TTS on digest; no comparable voice loop |
| Cost/efficiency ethos | Token efficiency = north star (no $ in UI)             | Energy/FLOPs/latency/$ as 1st-class evals|

**Every surface OpenJarvis offers, the hub already has a Claude-native
equivalent of** — schedules, deep research, an autonomous loop, tiered agents,
skills, memory, voice, and an efficiency north star. The one-to-one overlap is
near-total; OpenJarvis's only genuine *lead* is local on-device inference.

## Why skip

1. **Thesis collides with the north star.** OpenJarvis exists to run **local
   non-Claude models** and optimize energy/FLOPs; the hub is **Claude-only** by
   settled decision-log ruling. Its differentiator is exactly the axis the hub
   chose not to be on — so adopting it means importing dead weight, or importing
   only the parts we already built better.
2. **Zero-dep invariant.** Python + Rust/Tauri + Ollama + DSPy could only run as
   an out-of-process sibling, never bundled — and points 1/3 mean there's nothing
   to run it *for*.
3. **No net-new capability, real per-run risk.** Its skills story (~13k community
   skills) is the *opposite* of "curated ~20, never bulk"; wiring any in taxes
   context for capability we already cover. Its DSPy learning loop maps onto our
   autopilot loop (`lib/autopilot.js` + `improvement-backlog.md`) — same job, no
   Python.

## What is worth taking

Only a **concept, not code**: the five-primitive decomposition (Intelligence /
Engine / Agents / Tools & Memory / Learning) is a clean mental model, and its
"efficiency as a first-class eval constraint" validates the hub's token-efficiency
north star — both already reflected in how the hub is built. Nothing to port.

## When to revisit

Reopen **only** if the hub ever adds **local/offline inference** (a no-cloud,
no-Claude fallback for privacy/air-gapped use). Then OpenJarvis's Engine-primitive
abstraction over Ollama/vLLM/llama.cpp is the reference worth studying — as an
on-demand sibling, never bundled, never an always-on MCP. Until then, Claude-only
+ the hub's existing schedules/autopilot/memory/voice is the answer.
