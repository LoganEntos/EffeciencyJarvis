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
- `GET /api/spend/today`, `GET /api/routing` — header chips
- Voice: existing `HubVoice` API + `/api/voice/*` (status/start/stop/tts, open-folder)

## Hard constraints

- **Do not touch voice behavior** — barge-in, Kokoro self-heal, reply queue
  are exactly as the user wants (HANDOFF.md, 2026-07-14).
- Zero dependencies; every file < 500 lines (split modules); vendored assets
  only; X-Hub-Token on all non-GET (use the existing `api()` helper).
- Run the review pipeline in `docs/handoffs/README.md` before each commit.
