/*
 * Voice engine (Sesame CSM-1B) — proxy + lifecycle for the local TTS sidecar
 * (scripts/csm-server.py running in the gitignored .csm/ venv).
 *
 *   POST /api/voice/tts    { text, speaker } -> audio/wav streamed back
 *   GET  /api/voice/status -> sidecar /health + installed flag ("offline" if down)
 *   POST /api/voice/start  -> spawn the sidecar if not running (argv array, no shell)
 *
 * Why a proxy instead of the browser calling the python server directly:
 * same-origin keeps CORS closed and the localhost invariant intact — the
 * page only ever talks to the hub, and the hub only ever talks to loopback.
 *
 * Target URL: HUB_CSM_URL env var, default http://127.0.0.1:8790/tts.
 * SECURITY: the target host is validated to be loopback ONLY (127.0.0.1 /
 * localhost / ::1); anything else is rejected — no SSRF, no remote fetch.
 * Token guard: server.js already rejects every non-GET without X-Hub-Token
 * before this module is reached.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');

const DEFAULT_CSM = 'http://127.0.0.1:8790/tts';
const CSM_TIMEOUT_MS = 120000; // model inference is slow, esp. the first call

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const VENV_PY = path.join(PROJECT_DIR, '.csm', 'venv', 'Scripts', 'python.exe');
const SIDECAR = path.join(PROJECT_DIR, 'scripts', 'csm-server.py');
const LOG_FILE = path.join(PROJECT_DIR, '.csm', 'server.log');
let child = null; // sidecar spawned by this hub boot (it may also run standalone)

// Parse + validate the CSM server URL. Returns a URL or null if it is not a
// plain-http loopback address (the only thing this proxy will ever talk to).
function csmTarget() {
  let u;
  try { u = new URL(process.env.HUB_CSM_URL || DEFAULT_CSM); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // [::1] → ::1
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
  return u;
}

// GET the sidecar's /health (never throws — "offline" when unreachable).
function health(target) {
  return new Promise((resolve) => {
    const req = http.request({ host: target.hostname, port: target.port, path: '/health', method: 'GET', timeout: 3000 }, (up) => {
      let body = '';
      up.on('data', d => { if (body.length < 4096) body += d; });
      up.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ status: 'offline' }); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 'offline' }));
    req.end();
  });
}

// Spawn scripts/csm-server.py inside the .csm venv. Fixed argv array (venv
// python + repo script + validated loopback port) — no shell, no user input.
function startSidecar(target) {
  if (!fs.existsSync(VENV_PY)) return { error: '.csm venv missing — see docs/voice-csm.md for the one-time setup' };
  if (!fs.existsSync(SIDECAR)) return { error: 'scripts/csm-server.py missing' };
  if (child && child.exitCode === null) return { ok: true, note: 'already starting/running' };
  let log = 'ignore';
  try { log = fs.openSync(LOG_FILE, 'a'); } catch {}
  try {
    child = spawn(VENV_PY, [SIDECAR, String(target.port || 8790)], {
      cwd: PROJECT_DIR, windowsHide: true, stdio: ['ignore', log, log],
    });
    child.on('error', () => { child = null; });
    child.on('close', () => { child = null; });
  } catch (e) {
    return { error: 'spawn failed: ' + e.message };
  }
  return { ok: true, pid: child.pid, note: 'starting — model loads in ~15-30 s' };
}

async function handle(req, res, url) {
  if (url.pathname === '/api/voice/status' && req.method === 'GET') {
    const target = csmTarget();
    const j = target ? await health(target) : { status: 'offline', error: 'bad HUB_CSM_URL' };
    j.installed = fs.existsSync(VENV_PY);
    j.spawnedByHub = !!(child && child.exitCode === null);
    U.sendJson(res, j);
    return true;
  }
  if (url.pathname === '/api/voice/start' && req.method === 'POST') {
    const target = csmTarget();
    const r = target ? startSidecar(target) : { error: 'HUB_CSM_URL must be a loopback http URL' };
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (url.pathname !== '/api/voice/tts' || req.method !== 'POST') return false;

  let b = {};
  try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
  const text = (typeof b.text === 'string' ? b.text : '').trim().slice(0, 1200);
  if (!text) { U.sendJson(res, { error: 'text required' }, 400); return true; }
  let speaker = parseInt(b.speaker, 10);
  if (isNaN(speaker) || speaker < 0 || speaker > 9) speaker = 0;

  const target = csmTarget();
  if (!target) {
    U.sendJson(res, { error: 'HUB_CSM_URL must be a loopback http URL (127.0.0.1 / localhost / ::1)' }, 400);
    return true;
  }

  const payload = JSON.stringify({ text, speaker });
  await new Promise((resolve) => {
    const fwd = http.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: CSM_TIMEOUT_MS,
    }, (up) => {
      if (up.statusCode !== 200) {
        let msg = '';
        up.on('data', d => { if (msg.length < 2000) msg += d; });
        up.on('end', () => {
          U.sendJson(res, { error: `CSM server error ${up.statusCode}: ${msg.slice(0, 300)}` }, 502);
          resolve();
        });
        return;
      }
      res.writeHead(200, {
        'Content-Type': up.headers['content-type'] || 'audio/wav',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      up.pipe(res);
      up.on('end', resolve);
      up.on('error', () => { try { res.end(); } catch {} resolve(); });
    });
    fwd.on('timeout', () => fwd.destroy(new Error('timed out after ' + CSM_TIMEOUT_MS / 1000 + 's')));
    fwd.on('error', (e) => {
      // headersSent = failure mid-stream; otherwise a clean JSON error the
      // client uses to fall back to browser TTS.
      if (!res.headersSent) {
        U.sendJson(res, { error: `CSM server unreachable at ${target.href} (${e.message}) — start it from Config → Voice, or run scripts/csm-server.py` }, 502);
      } else { try { res.end(); } catch {} }
      resolve();
    });
    fwd.end(payload);
  });
  return true;
}

module.exports = { handle, csmTarget };
