#!/usr/bin/env python
"""Shared HTTP scaffold for the Claude Code Hub's local TTS sidecars.

Both neural engines — Sesame CSM-1B (scripts/csm-server.py) and Kokoro-82M
(scripts/kokoro-server.py) — expose the exact same localhost-only contract:

  GET  /health -> {"status": "loading"|"ready"|"error", ...}  (the STATE dict)
  POST /tts    {"text": "...", "speaker": 0} -> audio/wav

Only model-load + synthesize differ per engine, so everything else — the request
handler, request-size/field validation, the loopback bind, and the background
loader thread — lives here and is shared. Add a 3rd engine by writing a small
server that supplies load_model()/synthesize()/STATE and calls serve().

Zero third-party deps (stdlib http.server only); each engine's own venv brings
its model runtime. Binds 127.0.0.1 exclusively — never widen it (localhost
invariant). Reached only via the hub's Node proxy (lib/voice.js -> /api/voice/*).
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
MAX_CHARS = 700  # matches the talk-back clamp in assets/voice.js


def make_handler(name, state, synthesize):
    """Build a BaseHTTPRequestHandler bound to one engine's STATE + synth fn."""

    class Handler(BaseHTTPRequestHandler):
        server_version = name + "-tts/1.0"

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
                return self._json(state)
            return self._json({"error": "not found"}, 404)

        def do_POST(self):
            if self.path != "/tts":
                return self._json({"error": "not found"}, 404)
            if state["status"] != "ready":
                return self._json({"error": f"model {state['status']}",
                                   "detail": state.get("error")}, 503)
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
                print(f"[{name}] tts {len(text)} chars -> {len(wav)//1024} KB "
                      f"in {round(time.time() - t0, 2)}s", flush=True)
            except Exception as e:
                try:
                    self._json({"error": f"{type(e).__name__}: {e}"}, 500)
                except Exception:
                    pass

    return Handler


def serve(name, port, load_model, synthesize, state):
    """Start the background model loader + the loopback HTTP server (blocks)."""
    threading.Thread(target=load_model, daemon=True).start()
    handler = make_handler(name, state, synthesize)
    srv = ThreadingHTTPServer((HOST, port), handler)
    print(f"[{name}] sidecar listening on http://{HOST}:{port} "
          f"(model loading in background)", flush=True)
    srv.serve_forever()
