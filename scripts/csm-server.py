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
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
HOST = "127.0.0.1"
# first candidate that loads wins; env override goes to the front of the line
MODEL_CANDIDATES = ([os.environ["CSM_MODEL"]] if os.environ.get("CSM_MODEL") else []) \
    + ["sesame/csm-1b", "unsloth/csm-1b"]
MAX_CHARS = 700  # matches the talk-back clamp in assets/voice.js
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


class Handler(BaseHTTPRequestHandler):
    server_version = "csm-tts/1.0"

    def log_message(self, fmt, *args):  # quiet default access log
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(STATE)
        return self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/tts":
            return self._json({"error": "not found"}, 404)
        if STATE["status"] != "ready":
            return self._json({"error": f"model {STATE['status']}",
                               "detail": STATE.get("error")}, 503)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 64 * 1024:
                return self._json({"error": "bad request size"}, 400)
            body = json.loads(self.rfile.read(n) or b"{}")
            text = str(body.get("text") or "").strip()[:MAX_CHARS]
            if not text:
                return self._json({"error": "text required"}, 400)
            try:
                speaker = max(0, min(9, int(body.get("speaker", 0))))
            except (TypeError, ValueError):
                speaker = 0
            t0 = time.time()
            wav = synthesize(text, speaker)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.send_header("X-Gen-Seconds", str(round(time.time() - t0, 2)))
            self.end_headers()
            self.wfile.write(wav)
            print(f"[csm] tts {len(text)} chars -> {len(wav)//1024} KB "
                  f"in {round(time.time() - t0, 1)}s", flush=True)
        except Exception as e:
            try:
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)
            except Exception:
                pass


def main():
    threading.Thread(target=load_model, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[csm] sidecar listening on http://{HOST}:{PORT} (model loading in background)",
          flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
