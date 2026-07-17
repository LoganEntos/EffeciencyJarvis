# Handoff: Jarvis tab — 1:1 port of the user's Lovable design

**Status: BLOCKED — the user is still improving the design on lovable.com.**
Do NOT restyle the Jarvis tab speculatively. When the user hands over the
final Lovable preview URL (or screenshots), this becomes the top-priority UI
handoff. Model: **Opus 4.8**.

## The port method (proven on the clean-dark redesign)

1. Open the user's Lovable preview URL in the browser tools.
2. Read the **live DOM's computed styles** — real hex values, font stacks,
   spacing, radii — never eyeball from a screenshot alone.
3. Port 1:1 into `assets/jarvistab.js` + `assets/jarvis.css` using CSS
   variables; reuse the existing clean-dark tokens (`#0c0b0a` / `#17140f` /
   amber `#e8a33d`; Bricolage Grotesque / JetBrains Mono / Instrument Serif —
   all in `vendor/`, never a CDN).
4. Browser-verify desktop AND 375px (the user drives this tab from a phone
   over Tailscale).

## What the last-seen design contains (2026-07-15 screenshot)

Persona cards row (Jarvis active + others + an "Off — plain Claude" card,
each with name/tagline/tone chips) · LIVE CONVERSATION panel with the amber
state orb, `hold to talk` / `open call` / `think` / `barge in` controls, rtt
badge, transcript strip · PROMPT IN PROGRESS panel (intent chip, routed-model
chip, ctx-files chip, the distilled prompt as editable text, REFINE chips —
shorter / more technical / add constraints / add examples / trim context —
plus `copy` and `run this`) · HOLDING IN CONTEXT panel (anchor chips: goal /
stack / decision / avoid / file / tier, token count, `pin moment`) · THREAD
TIMELINE below · header chips (today runs + spend, % routed ok, rtt,
`memory recall · on`, `customize`). Treat the final design the user delivers
as the source of truth over this list.

## Backend surface already live for this UI (all verified 2026-07-15)

- `GET  /api/personas` → `{personas:[{id,name,tagline,tone,bytes}], active}` (saved display order)
- `GET  /api/personas/get?id=` → full persona incl. body
- `POST /api/personas/save|delete|rename|order|active` — full CRUD (see `lib/personas.js` header)
- `POST /api/jarvis/distill {text}` → `{prompt}` — Haiku prompt-shaper (~3–13 s; '' on failure)
- `GET  /api/clientlog?tab=jarvis` — client-error beacon (live)
- `GET /api/stats/today` (runs · tokens · completion%), `GET /api/routing` — header chips.
  ⚠ **No dollar figures anywhere** (user directive 2026-07-15): tokens + % rates only.
- Voice: existing `HubVoice` API + `/api/voice/*` (status/start/stop/tts, open-folder)

## Hard constraints

- **Do not touch voice behavior** — barge-in, Kokoro self-heal, reply queue
  are exactly as the user wants (HANDOFF.md, 2026-07-14).
- Zero dependencies; every file < 500 lines (split modules); vendored assets
  only; X-Hub-Token on all non-GET (use the existing `api()` helper).
- Run the review pipeline in `docs/handoffs/README.md` before each commit.

## Postscript: Module split finalized (2026-07-16)

The Jarvis tab overhaul completed with a three-way split to maintain the 500-line
ceiling:
- **`jarvistab.js`** (404 L) — main tab: persona-cards row, live-conversation pane,
  prompt-workspace pane, holding-in-context panel, thread timeline, header metrics.
- **`jarvisorb.js`** (186 L) — audio-driven canvas orb: state machine (idle/listening/
  thinking/speaking), mirroring HubVoice, reusable across tabs.
- **`jarvischat.js`** (130 L) — in-tab live chat: session transcript, send/receive,
  liveness.

**`jarvis.js` (112 L) remains the cross-tab helper** — shared by both run.js and
jarvistab.js. Owns: `initJarvis()`, `analyzePromptComplexity()`, `jarvisDistill()`,
`DISTILL_MIN_WORDS`, **`JARVIS_HUE` table** (single source of truth for per-persona
orb hue), **`jarvisHueOf(id)`**.

**Four defects fixed in the finalization:**
1. Transcript poller now resumes after a chat send completes/errors (was stuck paused).
2. Chat send button re-enables on stream error (was stuck disabled).
3. Holding-in-context panel anchors to in-tab chat session id, falls back to Run-tab chat.
4. Duplicate HUE/hueOf definitions hoisted to jarvis.js (single source).

**Smoke script extended** with GET checks for `jarvisorb.js` and `jarvischat.js` —
**all 88 checks green**. The UI port (jarvistab.js + jarvis.css) remains blocked
pending the final Lovable design; the backend + voice mechanics are stable.
