# Hermes adoption — the hub's second agent stack (user decision, 2026-07-10 evening)

**Decision:** the Claude Code native subagent library was purged (91 claude-flow
agent definitions deleted — every one silently ran on the session's default
frontier model; "why send a JSON with Fable 5?"). The replacement agentic stack
is **[nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)**
(MIT, 213k stars), chosen by the user over re-adopting ruflo. This supersedes
the "hermes stays parked" state of ISSUE-5.

## Why hermes fits the requirement

- **Per-task model tiering built in**: `model.default` for the main loop,
  independent `auxiliary.compression` / `auxiliary.vision` (etc.) blocks each
  with their own provider+model — cheap models for mechanical work.
- `hermes model [provider:model]` switches the main model any time; 300+
  models via Nous Portal / OpenRouter / Anthropic / OpenAI / custom endpoints.
- Extras that align with the hub: cron scheduler, skills-from-experience,
  FTS5 session memory, messaging gateway (Telegram/Discord/Slack/WhatsApp/
  Signal) — the gateway is exactly the ISSUE-5 "thin messaging bridge with a
  mobile toggle" the user always wanted.

## Install (USER action — the agent's installer run was permission-blocked)

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Installer is self-contained (uv, Python 3.11, Node, ripgrep, ffmpeg, portable
Git Bash; no admin). Then:

1. Put an API key in `~/.hermes/.env` — `ANTHROPIC_API_KEY=` or
   `OPENROUTER_API_KEY=` (**none is currently set on this machine**; the
   claude CLI subscription does NOT carry over — hermes bills per API call).
2. Copy `scripts/hermes-config.yaml` over `~/.hermes/config.yaml` (tiered
   models: sonnet main brain, haiku for compression/vision).
3. `hermes` to launch the TUI; `hermes gateway` later for the messaging bridge.

## Integration plan with the hub (after install)

1. **H1 — presence**: Overview pill + Library "Agents" tab report hermes
   (installed version, configured models) instead of the deleted .md library.
2. **H2 — run routing**: optional "engine: claude | hermes" selector in the Run
   composer; hermes runs land in the same run history (spawn `hermes` with
   argv arrays, same security invariants).
3. **H3 — graph**: hermes runs feed `lib/agentgraph.js` personas like claude
   runs do.
4. **H4 — gateway (old ISSUE-5)**: `hermes gateway` + on/off toggle in the hub
   = mobile messaging bridge, without any custom Python.

Keep the hub's own `routeModel()` (haiku/sonnet/opus by complexity) — hermes
complements it for agentic/scheduled work, it does not replace the run engine.
