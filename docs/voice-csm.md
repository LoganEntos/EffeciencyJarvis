# Sesame CSM-1B — local neural voice for the hub

The hub's talk-back can use **Sesame CSM-1B** (Apache-2.0), a 1B-parameter
conversational speech model, running **fully local** on the RTX 3060 — no
cloud TTS, nothing leaves the machine. It replaces the robotic
`speechSynthesis` voice when selected in **Config → Voice → TTS engine**.

Status (2026-07-11): INSTALLED and verified end-to-end on this machine —
native Windows (no WSL2), CUDA via torch 2.6.0+cu124, weights on disk,
round-trip checked by transcribing generated audio with faster-whisper.

## How it fits together

```
browser (assets/voice.js)          hub (Node, zero-dep)              sidecar (.csm venv)
 speakCSM(text) ── POST /api/voice/tts ──> lib/voice.js ── POST /tts ──> scripts/csm-server.py
                                            loopback-only proxy            CSM-1B on cuda, wav out
 Config status pill ─ GET /api/voice/status ─> lib/voice.js ── GET /health ─┘
 Config Start button ─ POST /api/voice/start ─> spawns the sidecar (argv array, no shell)
```

- The page only ever talks to the hub (same origin, `X-Hub-Token` on POSTs).
- The hub only ever talks to loopback (`HUB_CSM_URL`, default
  `http://127.0.0.1:8790/tts`; non-loopback URLs are rejected).
- On any CSM failure the client silently falls back to the browser voice, so
  talk-back and call mode never go quiet.

## Runtime layout (all gitignored under `.csm/`)

| Path | What |
|---|---|
| `.csm/venv/` | Python 3.11 venv: torch 2.6.0+cu124, transformers 4.57.x (<5 pinned), accelerate, soundfile |
| `.csm/hf-cache/` | model weights (~3.9 GB) |
| `.csm/server.log` | sidecar log (load + per-utterance timings) |
| `scripts/csm-server.py` | the sidecar (stdlib http server, 127.0.0.1 only) |
| `scripts/csm-requirements.txt` | pinned deps + rebuild commands |

## Model source

`scripts/csm-server.py` tries, in order:

1. `sesame/csm-1b` — the official repo. It is **gated** on Hugging Face:
   accept the terms on its model page and set `HF_TOKEN` before starting the
   sidecar if you want to pull from it.
2. `unsloth/csm-1b` — ungated mirror of the same Apache-2.0 weights. This is
   what's installed and running today (no token needed).

Override with the `CSM_MODEL` env var.

> **Pin note:** transformers must stay **< 5**. Under 5.x the checkpoint's
> audio-embedding weight fails to map, loads randomly initialized, and the
> model produces fluent babble unrelated to the input text. Verified both
> ways with whisper transcription; 4.57.6 speaks the requested text.

## Using it

1. **Config → Voice → TTS engine → Sesame CSM-1B (local)**.
2. If the status pill says *offline*, click **Start engine** (model loads in
   ~15-30 s; the pill flips to *ready*). First-ever start on a fresh machine
   also downloads the weights.
3. Turn on **Speak Claude's replies out loud** (or use call mode) — replies
   now speak with the CSM voice. **Speaker** 0-9 picks different voices.
4. ▶ **Test CSM voice** does one real round-trip through the whole chain.

Performance on the RTX 3060: model load ~14 s; generation ≈ 1.2× audio
duration (a 5 s reply takes ~6-7 s of GPU before playback starts). The
sidecar generates one utterance at a time (GPU lock) and holds ~4 GB VRAM
while running — stop it (kill the python process) to reclaim.

## Rebuild from scratch

```powershell
cd C:\Users\logto\Documents\claude-hub
& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv .csm\venv
.csm\venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu124
.csm\venv\Scripts\python.exe -m pip install -r scripts\csm-requirements.txt
.csm\venv\Scripts\python.exe scripts\csm-server.py 8790   # or Config → Start engine
```

Delete `.csm/` to fully remove the install (frees ~10 GB).
