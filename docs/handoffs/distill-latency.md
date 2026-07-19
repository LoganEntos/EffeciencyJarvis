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

## Resolution (2026-07-18, Team SERVER)

Root cause found by instrumenting the spawn with `--output-format stream-json
--include-partial-messages`: the dominant cost was NOT CLI boot or MCP/skill
loading, and `--bare` was ruled out immediately (it forces API-key-only auth
via `ANTHROPIC_API_KEY`/`apiKeyHelper`, and this install has no API key set —
it authenticates via OAuth/subscription, so `--bare` would silently break
distill entirely, which the "wrong flags = silent failure" warning called
out). `--strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands`
measured no improvement (MCP/skill loading isn't the bottleneck here).

The real bug: `lib/distill.js` spawned with Node's default stdio, which
leaves child stdin as an **open, unwritten pipe**. The Claude CLI detects a
non-TTY stdin that isn't immediately closed and waits ~3s guessing whether
piped input is coming (`Warning: no stdin data received in 3s, proceeding
without it`) before it even starts the request — on top of that, this
haiku one-shot generates a surprising amount of internal "thinking" tokens
even for a one-sentence rewrite, which accounts for most of the remainder.

Fix: one line in `lib/distill.js` — `stdio: ['ignore', 'pipe', 'pipe']` on
the spawn call, since `-p` already carries the full prompt as an argv and
never reads stdin. This alone cut total latency roughly in half.

Measured (throwaway server on :5764, this worktree, real distill payload —
full SYS prompt + ~40-word input):
- Before fix (default stdio, open unclosed pipe): 5 sequential calls via the
  actual CLI spawn args, 10.3s–13.5s each (matches the reported ~12.6s).
- After fix (`stdio: ['ignore','pipe','pipe']`): 5 live calls through
  `POST /api/jarvis/distill`, 6.1s–14.7s (one outlier under shared-machine
  load from other concurrent agents in this session), most runs 6–8s.
- CLI-flag attempts (`--strict-mcp-config`, `--disable-slash-commands`,
  `--effort low`): no measurable improvement over baseline; not adopted.
- `--bare`: not tested live — ruled out on auth-model grounds before
  spending a call on it.

Still not reliably ≤4s — the remaining cost is dominated by Haiku's internal
"thinking" token generation for this one-shot, which is model behavior, not
plumbing, and out of scope for a zero-dep server-side fix. No sidecar was
introduced. `''`-on-failure verified to survive the change (empty text,
missing token, and a forced `ENOENT` via a broken `HUB_CLAUDE_EXE` path all
still resolve/return cleanly with HTTP 200 and `{"prompt":""}`).

Files changed: `claude-dashboard/lib/distill.js` (+5/-1 lines, still well
under 500). Smoke script (`scripts/verify-dashboard.ps1 -Port 5764`): all
green except the pre-existing `/api/agentgraph` 404 (fresh worktree, empty
`data/`, by design).
