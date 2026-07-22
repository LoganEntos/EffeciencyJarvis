# Handoff: Persona manager — wire CRUD into the Jarvis tab

**Status: READY — UNBLOCKED (user priority #4, 2026-07-17).** The Lovable
port shipped (`c30fa91` + `fbc1fee`), so the persona cards exist; this wires
the missing verbs into them. Backend DONE + live-verified since 2026-07-15.
Model: Opus 4.8.

UI notes for the shipped design: add a small `✕` (delete, two-step confirm)
and `✎` (rename id) affordance to each `.jcard` on hover, drag-to-reorder the
cards row → POST the id array to `/api/personas/order`, and a `＋` ghost card
at the end that opens the soul editor in new-persona mode.

## What the user asked for

Personas must be **addable, removable, editable, and organizable** from the
UI. Persona = one markdown file in `claude-dashboard/personas/` (frontmatter
`name`/`tagline`/`tone` + body = the injected soul). The backend for all four
verbs exists and is tested — this handoff is only the front end.

## Endpoints (all live, token-guarded, verified end-to-end)

| verb | call | payload → result |
| --- | --- | --- |
| list | `GET /api/personas` | `{personas:[…in saved display order], active}` |
| read | `GET /api/personas/get?id=x` | full persona incl. `body` |
| add / edit | `POST /api/personas/save` | `{id,name,tagline,tone,body}` — new id creates, existing overwrites; body ≤ 24 KB |
| remove | `POST /api/personas/delete` | `{id}` — deleting the active persona switches personas OFF (plain Claude) |
| rename id | `POST /api/personas/rename` | `{id,newId}` — re-points active/order/handoff |
| organize | `POST /api/personas/order` | `{ids:[…]}` — persisted display order; unlisted ids sort last |
| activate | `POST /api/personas/active` | `{id}` (or `null`/`"none"` = off) |

Ids: `^[a-z0-9][a-z0-9_-]{0,63}$`. Every error comes back as `{error}` with
HTTP 400 — surface it in the UI verbatim.

## UI expectations (shape to the final Lovable design)

- Persona cards: add (＋ card), delete (confirm first — it removes the file),
  inline rename, drag-to-reorder → POST the full id array to `/order`.
- Editor: the existing soul editor (jarvistab.js `save` flow) already POSTs
  to `/save`; keep it, extend for tagline/tone.
- The "Off — plain Claude" card maps to `active: null`, never a file.
- Persona switch already emits the OpenPersona-style soul handoff on the next
  run — don't duplicate that client-side.

## Verify before commit

CRUD each verb from the real UI (add → rename → reorder → delete a throwaway
persona), confirm `data/personas.json` holds `{active, handoff, order}` with
no field dropped, smoke script green, 375px check, code-reviewer pass.
