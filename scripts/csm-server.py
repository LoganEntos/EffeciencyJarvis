#!/usr/bin/env python
"""Sesame CSM-1B local TTS sidecar for the Claude Code Hub.

Serves neural text-to-speech on localhost only. The hub's Node server proxies
browser requests here (lib/voice.js -> /api/voice/*), so the page never talks
to this port directly and the hub app itself stays zero-dependency.

  GET  /health -> {"status": "loading"|"ready"|"error", "device": ..., ...}
  POST /tts    {"text": "...", "speaker": 0} -> audio/wav (24 kHz mono)

Run inside the repo venv:
  .csm/venv/Scripts/python.exe scripts/csm-server.py [port]   # default 8790

Model: Sesame CSM-1B (Apache-2.0) via transformers' CsmForConditionalGeneration.
The official repo (sesame/csm-1b) is GATED on Hugging Face — set HF_TOKEN after
accepting its terms to use it; otherwise the ungated mirror unsloth/csm-1b
(same weights, Apache-2.0 permits redistribution) is used automatically.
Weights live in .csm/hf-cache (~2.5 GB, gitignored). Generation holds a lock:
one utterance at a time on the GPU.
"""
import io
import os
import sys
import threading
import time

from tts_sidecar import serve  # shared HTTP scaffold (scripts/tts_sidecar.py)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
# first candidate that loads wins; env override goes to the front of the line
MODEL_CANDIDATES = ([os.environ["CSM_MODEL"]] if os.environ.get("CSM_MODEL") else []) \
    + ["sesame/csm-1b", "unsloth/csm-1b"]
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# keep model weights inside the repo's gitignored .csm/ dir, not the user
# profile, so the install is self-contained and easy to delete
os.environ.setdefault("HF_HOME", os.path.join(REPO_ROOT, ".csm", "hf-cache"))

STATE = {"status": "loading", "device": None, "error": None, "model": None,
         "loaded_in_s": None, "started": time.time()}
GEN_LOCK = threading.Lock()
BUNDLE = {}  # model, processor, sample_rate — set by the loader thread


def load_model():
    t0 = time.time()
    errors = []
    try:
        import torch
        from transformers import AutoProcessor, CsmForConditionalGeneration

        device = "cuda" if torch.cuda.is_available() else "cpu"
        STATE["device"] = device
        # TF32 is free accuracy-adequate speed on Ampere for any fp32 matmuls
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        for model_id in MODEL_CANDIDATES:
            try:
                processor = AutoProcessor.from_pretrained(model_id)
                # bf16 halves VRAM + speeds up Ampere; fall back to full precision
                try:
                    model = CsmForConditionalGeneration.from_pretrained(
                        model_id, device_map=device, dtype=torch.bfloat16)
                except Exception:
                    model = CsmForConditionalGeneration.from_pretrained(
                        model_id, device_map=device)
                model.eval()
                BUNDLE["model"] = model
                BUNDLE["processor"] = processor
                BUNDLE["sample_rate"] = getattr(
                    getattr(model.config, "codec_config", None), "sampling_rate", 24000) or 24000
                STATE["model"] = model_id
                STATE["dtype"] = str(next(model.parameters()).dtype)
                try:  # warmup: absorb kernel/cudnn init so the first real
                    synthesize("Ready.")  # utterance doesn't pay it
                except Exception:
                    pass
                STATE["loaded_in_s"] = round(time.time() - t0, 1)
                STATE["status"] = "ready"
                print(f"[csm] {model_id} ready on {device} ({STATE['dtype']}) "
                      f"in {STATE['loaded_in_s']}s", flush=True)
                return
            except Exception as e:
                errors.append(f"{model_id}: {type(e).__name__}: {e}")
                print(f"[csm] {model_id} failed, trying next candidate", flush=True)
        raise RuntimeError(" | ".join(errors)[:1000])
    except Exception as e:  # surfaced via /health; hub shows it in Config
        STATE["status"] = "error"
        STATE["error"] = f"{type(e).__name__}: {e}"[:1000]
        print(f"[csm] LOAD FAILED: {STATE['error']}", flush=True)


def synthesize(text, speaker=0):
    """text -> WAV bytes (mono, model sample rate). Raises on failure."""
    import torch

    model, processor = BUNDLE["model"], BUNDLE["processor"]
    sr = BUNDLE["sample_rate"]
    prompt = f"[{speaker}]{text}"  # CSM speaker tag; no audio context
    inputs = processor(prompt, add_special_tokens=True, return_tensors="pt").to(model.device)
    # the shipped generation_config caps max_new_tokens at 125 audio frames =
    # exactly 10 s — anything longer was cut off MID-SENTENCE. Scale the cap
    # to the text instead: ~12.5 frames/s of audio, speech ≈ 15 chars/s, with
    # 2x headroom; ceiling 1250 frames (100 s) as a runaway guard.
    max_frames = min(1250, max(125, int(len(text) * 1.7)))
    with GEN_LOCK, torch.no_grad():
        audio = model.generate(**inputs, output_audio=True, max_new_tokens=max_frames)
    wav = audio[0] if isinstance(audio, (list, tuple)) else audio
    wav = wav.to(torch.float32).cpu().numpy().squeeze()

    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def main():
    serve("csm", PORT, load_model, synthesize, STATE)


if __name__ == "__main__":
    main()
