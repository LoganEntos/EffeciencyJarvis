#!/usr/bin/env python
"""Kokoro-82M local TTS sidecar for the Claude Code Hub — the FAST engine.

Same localhost-only contract as scripts/csm-server.py (the hub's Node server
proxies to it via lib/voice.js -> /api/voice/*), so the browser never talks to
this port directly and the hub app stays zero-dependency.

  GET  /health -> {"status": "loading"|"ready"|"error", "device": ..., ...}
  POST /tts    {"text": "...", "speaker": 0} -> audio/wav (24 kHz mono)

Run inside its own venv:
  .kokoro/venv/Scripts/python.exe scripts/kokoro-server.py [port]   # default 8791

WHY Kokoro instead of CSM-1B: Kokoro is an 82M-param non-autoregressive model
(StyleTTS2 lineage). It renders a whole sentence in one forward pass, so on the
RTX 3060 a sentence takes ~0.1-0.3 s vs CSM's ~6 s first word. That is the fix
for "the default engine almost works better". Quality is a hair below CSM but
far above the browser voice, and it is fast enough to feel real-time.

License: Kokoro weights Apache-2.0 (hexgrad/Kokoro-82M); runtime via the
kokoro-onnx ONNX port (MIT, thewh1teagle/kokoro-onnx) on onnxruntime. NOTE:
the ONNX model + voices files are downloaded once into .kokoro/ (auto-fetched
from the kokoro-onnx GitHub release on first run if absent; override the URLs
or point at local files via env). ~310 MB model + ~26 MB voices, gitignored.
"""
import io
import json
import os
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
HOST = "127.0.0.1"
MAX_CHARS = 700
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KOKORO_DIR = os.path.join(REPO_ROOT, ".kokoro")

# Model + voice-pack files (kokoro-onnx v1.0). Override with env if the release
# layout changes or you already have them somewhere. Auto-downloaded if missing.
MODEL_PATH = os.environ.get("KOKORO_MODEL", os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx"))
VOICES_PATH = os.environ.get("KOKORO_VOICES", os.path.join(KOKORO_DIR, "voices-v1.0.bin"))
_REL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
MODEL_URL = os.environ.get("KOKORO_MODEL_URL", _REL + "/kokoro-v1.0.onnx")
VOICES_URL = os.environ.get("KOKORO_VOICES_URL", _REL + "/voices-v1.0.bin")

# speaker 0-9 -> a curated set of the strongest en-US / en-GB Kokoro voices
VOICE_MAP = ["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir",
             "am_puck", "bf_emma", "bf_isabella", "bm_george", "bm_fable"]
DEFAULT_LANG = os.environ.get("KOKORO_LANG", "en-us")

STATE = {"status": "loading", "device": None, "error": None, "model": "kokoro-82m",
         "loaded_in_s": None, "started": time.time()}
GEN_LOCK = threading.Lock()
BUNDLE = {}  # kokoro instance + sample_rate, set by the loader thread


def _download(url, dest):
    """Fetch a large release asset to dest (atomic via .part). Logs progress."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    print(f"[kokoro] downloading {os.path.basename(dest)} from {url}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as up, open(tmp, "wb") as out:
        while True:
            chunk = up.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    os.replace(tmp, dest)
    print(f"[kokoro] saved {dest} ({os.path.getsize(dest)//(1<<20)} MB)", flush=True)


def load_model():
    t0 = time.time()
    try:
        if not os.path.exists(MODEL_PATH):
            _download(MODEL_URL, MODEL_PATH)
        if not os.path.exists(VOICES_PATH):
            _download(VOICES_URL, VOICES_PATH)

        import onnxruntime
        providers = onnxruntime.get_available_providers()
        STATE["device"] = "cuda" if "CUDAExecutionProvider" in providers else "cpu"

        from kokoro_onnx import Kokoro
        kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
        BUNDLE["kokoro"] = kokoro
        BUNDLE["sample_rate"] = 24000
        try:  # warmup so the first real request doesn't pay kernel init
            synthesize("Ready.")
        except Exception:
            pass
        STATE["loaded_in_s"] = round(time.time() - t0, 1)
        STATE["status"] = "ready"
        print(f"[kokoro] ready on {STATE['device']} in {STATE['loaded_in_s']}s "
              f"(providers={providers})", flush=True)
    except Exception as e:  # surfaced via /health; hub shows it in Config
        STATE["status"] = "error"
        STATE["error"] = f"{type(e).__name__}: {e}"[:1000]
        print(f"[kokoro] LOAD FAILED: {STATE['error']}", flush=True)


def synthesize(text, speaker=0):
    """text -> WAV bytes (mono, 24 kHz). Raises on failure."""
    kokoro = BUNDLE["kokoro"]
    voice = VOICE_MAP[speaker] if 0 <= speaker < len(VOICE_MAP) else VOICE_MAP[0]
    with GEN_LOCK:
        samples, sr = kokoro.create(text, voice=voice, speed=1.0, lang=DEFAULT_LANG)

    import numpy as np
    import soundfile as sf
    wav = np.asarray(samples, dtype="float32").squeeze()
    buf = io.BytesIO()
    sf.write(buf, wav, int(sr or BUNDLE.get("sample_rate", 24000)),
             format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "kokoro-tts/1.0"

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
            print(f"[kokoro] tts {len(text)} chars -> {len(wav)//1024} KB "
                  f"in {round(time.time() - t0, 2)}s", flush=True)
        except Exception as e:
            try:
                self._json({"error": f"{type(e).__name__}: {e}"}, 500)
            except Exception:
                pass


def main():
    threading.Thread(target=load_model, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[kokoro] sidecar listening on http://{HOST}:{PORT} (model loading in background)",
          flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
