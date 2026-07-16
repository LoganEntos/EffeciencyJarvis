# Handoff: Distill latency (optional — do last)

**Status: OPTIONAL — only after the READY handoffs are done.** Model: Opus 4.8.

`POST /api/jarvis/distill` (lib/distill.js) measured ~12.6 s cold on
2026-07-15; each call spawns a fresh `claude.exe -p --model haiku`. The UI
blocks sends behind "✦ Shaping…" for that long, which will feel broken in
voice use.

## Investigate first, then implement the cheapest win

- **Measure**: 5 sequential distill calls; separate spawn/CLI-boot time from
  API time (wrap the spawn with timestamps). If warm calls are already ≤4 s,
  document that and stop — no code change.
- Candidate fixes, in preference order (zero-dep, pick ONE):
  1. Boot-time warm-up: fire one throwaway distill ~10 s after server start
     to prime the OS file cache (costs ~a cent per boot; trivial code).
  2. Trim the flow: `--strict-mcp-config --mcp-config '{}'`-style flags (or
     whatever the installed CLI supports) to skip MCP/skill loading for this
     one-shot — check `claude --help` first; wrong flags = silent failure.
  3. Drop `DISTILL_MIN_WORDS` gate handling client-side to show partial
     status (cosmetic; last resort).
- Do NOT introduce a resident sidecar process for this without asking the
  user — that's a standing-resource decision.

Constraint: distill must keep returning `''` on any failure so runs are
never blocked. Verify with a live UI send (>25-word Jarvis-mode prompt) and
the smoke script; review pipeline per README.
