# Jarvis pipeline trace — two-layer persona + voice modules

Data flow and code path only. Traced from source 2026-07-22.

## A. Persona composition (two-layer) — server-side, once per run

```
UI (Run tab sendPrompt / voice turn)
  └─ POST /api/run  { prompt, model, engine, projectId, ... }
       │
lib/runs.js  (start of run build, ~L194)
  ├─ engine==='claude' ?
  │     ├─ persona     = personas.activePrefix()   // lib/personas.js
  │     └─ personaName = personas.activeName()
  │
  ▼
lib/personas.js  activePrefix()  (~L248)
  ├─ getActiveId()      → reads data/personas.json  → { active: "jarvis-wit" }
  │                        (unset ⇒ defaults to "jarvis"; null/"none" ⇒ OFF, returns '')
  ├─ guidelines()       → reads personas/_guidelines.md   ......... LAYER 1 (output contract)
  │                        (missing/empty ⇒ built-in DEFAULT_GUIDELINES)
  ├─ load(activeId)     → reads personas/jarvis-wit.md    ......... LAYER 2 (character)
  │                        parse() splits frontmatter {name,tagline,tone,ack} | body
  └─ takeHandoff(id)    → reads data/personas.json .handoff, renders once, clears it
        │
        ▼ returns exactly:
   <output-contract>\n{LAYER 1 guidelines}\n</output-contract>\n\n
   <persona name="{name}">\n{LAYER 2 body}\n</persona>\n\n
   {handoff block or ''}
```

Compose + dispatch:

```
lib/runs.js  (~L229)
  fullPrompt = persona                     // ← the two composed layers, PREPENDED
             + projectPrefix               // <project> standing instructions (Projects tab)
             + recalled.block              // global memory recall
             + projRecall.block            // project-scoped recall
             + prompt                      // the user's actual words
             + imgBlock + fileBlock        // attachment paths (Read-tool refs)
             + team.text + hint
  (~L245)
  args = ['-p', fullPrompt, '--output-format','stream-json','--verbose', ...]
  if opus-tier: args.push('--append-system-prompt', GOD_PROMPT)   // Fable-5, SYSTEM layer
  spawn claude CLI (argv array, no shell) → stream-json → SSE → UI
```

**Key fact:** the persona (both layers) rides in the **user turn** (prefix of `-p`).
The ONLY thing in the true system layer is the Fable-5 god prompt, and only on
opus-tier runs. Persona is re-sent every turn, incl. `--resume` threads.

**Live edit surface** (lib/personas.js `handle()`):
`GET /api/personas` (list+active+guidelines) · `POST /api/personas/active` ·
`/guidelines` (layer 1) · `/get` `/save` `/delete` `/rename` `/order` (layer 2).
State persisted in `data/personas.json` → `{ active, handoff, order }` (merge-write).

## B. Voice modules — load order, role, wiring

index.html `<script>` order (each later one depends on the earlier):

```
app.js → run.js → voicetts.js → voiceconvo.js → voice.js → voicecfg.js → jarvispersona.js
```

| Module | Kind | Role |
|---|---|---|
| `assets/voicetts.js` | factory `window.HubVoiceTTS(ctx)` | **TTS reply queue.** `synth(text,onDone)` → neural `csmFetch()` POSTs `/api/voice/tts?engine=kokoro`; browser speechSynthesis fallback (iOS keep-alive pause/resume). Plays block-by-block; on drain → `onReplyDone`. |
| `assets/voiceconvo.js` | factory `window.HubVoiceConvo(ctx)` | **Conversation state machine.** wake "Jarvis" → persona **ack** → open window → capture → `sendPrompt()` (Run tab's own send) → thinking → speaking → re-open; closes on held silence. Echo-guard via `replyTail`. |
| `assets/voice.js` | instantiator | Builds both factories with shared `ctx`/state and wires them together (mic, orb state). |
| `assets/voicecfg.js` | settings UI | Engine pick / speaker / neural toggle. |
| `lib/voice.js` | server proxy | `/api/voice/tts\|status\|start\|stop\|open-folder`. Loopback-only validation. Warm-starts Kokoro at boot (`warmStart`); `ensureReady()` self-heals a dead sidecar before forwarding. Kokoro sidecar = 127.0.0.1:8791 (`scripts/kokoro-server.py`, `.kokoro/venv`). |

**Persona ↔ voice link:**
- `voiceconvo.js` fetches `/api/personas`, pulls the active persona's **`ack`**
  frontmatter (jarvis-wit → "You rang?") and speaks it on wake. `_guidelines.md`
  and the persona body do NOT reach the voice layer directly.
- The spoken **reply text** is produced by a normal run — so the two persona
  layers are injected server-side exactly as in section A — then handed to
  `voicetts` to vocalize. Voice never composes the persona itself.

`lib/distill.js` is unrelated to voice (prompt-cleanup "distiller", `/api/jarvis/distill`).
```
