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
import os
import sys
import threading
import time
import urllib.request

from tts_sidecar import serve  # shared HTTP scaffold (scripts/tts_sidecar.py)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
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


def _device_label(providers):
    """Friendly /health device string from ORT's active provider order."""
    p = providers[0] if providers else "CPUExecutionProvider"
    return {"DmlExecutionProvider": "gpu (directml)",
            "CUDAExecutionProvider": "gpu (cuda)"}.get(p, "cpu")


def load_model():
    t0 = time.time()
    try:
        if not os.path.exists(MODEL_PATH):
            _download(MODEL_URL, MODEL_PATH)
        if not os.path.exists(VOICES_PATH):
            _download(VOICES_URL, VOICES_PATH)

        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        def _build(provs):
            """Load Kokoro on `provs` and prove it by rendering a warmup line.
            Returns (kokoro, active_providers). RAISES if this provider set can't
            actually synthesize — a provider that *loads* but fails at inference
            (e.g. DirectML on Kokoro's ConvTranspose) is caught here, not left to
            500 every live request. Warmup also spares the first real call the
            kernel-init cost."""
            sess = ort.InferenceSession(MODEL_PATH, providers=provs)
            try:
                k = Kokoro.from_session(sess, VOICES_PATH)
            except (AttributeError, TypeError):  # older kokoro-onnx: no from_session
                os.environ.setdefault("ONNX_PROVIDER", provs[0])  # lib honours this
                k = Kokoro(MODEL_PATH, VOICES_PATH)
            k.create("Ready.", voice=VOICE_MAP[0], speed=1.0, lang=DEFAULT_LANG)
            return k, sess.get_providers()

        # Prefer a GPU execution provider, each paired with CPU as the per-op
        # fallback, then plain CPU. We warmup-gate every GPU attempt so a broken
        # GPU kernel demotes to CPU instead of poisoning the whole sidecar. CPU
        # always serves. (C43 — DirectML is present but incompatible with this
        # model's ConvTranspose as of ORT 1.24, so it fails the gate and we land
        # on CPU here; CUDA is adopted automatically wherever its runtime exists.)
        avail = ort.get_available_providers()
        gpu = [p for p in ("DmlExecutionProvider", "CUDAExecutionProvider") if p in avail]
        kokoro = active = None
        for g in gpu:
            try:
                kokoro, active = _build([g, "CPUExecutionProvider"])
                break
            except Exception as e:
                print(f"[kokoro] {g} unusable ({type(e).__name__}) — trying next", flush=True)
        if kokoro is None:
            kokoro, active = _build(["CPUExecutionProvider"])
        STATE["device"] = _device_label(active)
        STATE["providers"] = active
        BUNDLE["kokoro"] = kokoro
        BUNDLE["sample_rate"] = 24000
        STATE["loaded_in_s"] = round(time.time() - t0, 1)
        STATE["status"] = "ready"
        print(f"[kokoro] ready on {STATE['device']} in {STATE['loaded_in_s']}s "
              f"(providers={active})", flush=True)
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


def main():
    serve("kokoro", PORT, load_model, synthesize, STATE)


if __name__ == "__main__":
    main()
