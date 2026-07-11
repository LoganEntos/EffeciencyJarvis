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

## Install — ✅ DONE 2026-07-10 late eve (manual git+uv path)

The official remote-script installer was permission-blocked, so hermes was
installed the manual way from the user-named repo:
`winget install astral-sh.uv` → `git clone` to `~/.hermes/hermes-agent` →
uv-managed Python 3.11 venv at `~/.hermes/venvs/hermes` →
`uv pip install -e ".[all]"`. Verified: **Hermes Agent v0.18.2** boots;
`hermes` is on the user PATH (new shells; exe at
`~/.hermes/venvs/hermes/Scripts/hermes.exe`).

**Windows gotcha:** HERMES_HOME is `%LOCALAPPDATA%\hermes`, NOT `~/.hermes`
(which only holds the clone + venv). Config deployed to
`%LOCALAPPDATA%\hermes\config.yaml` (mirror: `scripts/hermes-config.yaml`);
verified via `hermes config` (model `anthropic/claude-sonnet-5`, max_turns 60).

**Remaining USER step — credentials (either):**
- `hermes auth add nous` — Nous Portal OAuth, persisted to
  `%LOCALAPPDATA%\hermes\auth.json`, no key handling; or
- `ANTHROPIC_API_KEY=` / `OPENROUTER_API_KEY=` in `%LOCALAPPDATA%\hermes\.env`.
The claude CLI subscription does NOT carry over — hermes bills per API call.
After credentials, uncomment the matching `delegation:` pair in config.yaml
so subagents run on a cheap model.

## Integration plan with the hub

1. **H1 — presence** ✅ (2026-07-10): `GET /api/hermes` (install/version/
   model/credentials detection in `lib/core.js`) + Hermes stack card atop the
   Agents tab with a ready/needs-credentials pill; in the smoke script.
2. **H2 — run routing**: optional "engine: claude | hermes" selector in the Run
   composer; hermes runs land in the same run history (spawn `hermes` with
   argv arrays, same security invariants).
3. **H3 — graph**: hermes runs feed `lib/agentgraph.js` personas like claude
   runs do.
4. **H4 — gateway (old ISSUE-5)**: `hermes gateway` + on/off toggle in the hub
   = mobile messaging bridge, without any custom Python.

Keep the hub's own `routeModel()` (haiku/sonnet/opus by complexity) — hermes
complements it for agentic/scheduled work, it does not replace the run engine.
