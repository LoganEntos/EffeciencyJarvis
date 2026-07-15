/*
 * Voice engines — proxy + lifecycle for the local TTS sidecars.
 *
 * Two interchangeable neural engines, same contract, selected per-request:
 *   • kokoro — Kokoro-82M, FAST (~0.1-0.3 s/sentence on the 3060). scripts/
 *     kokoro-server.py in .kokoro/venv, port 8791. The recommended default.
 *   • csm    — Sesame CSM-1B, most natural but slow (~6 s first word).
 *     scripts/csm-server.py in .csm/venv, port 8790.
 *
 *   POST /api/voice/tts?engine=kokoro   { text, speaker } -> audio/wav
 *   GET  /api/voice/status?engine=kokoro -> sidecar /health + installed flag
 *   POST /api/voice/start   { engine }   -> spawn that sidecar (argv, no shell)
 * The `engine` param defaults to "csm" for backward compatibility.
 *
 * Why a proxy instead of the browser calling the python server directly:
 * same-origin keeps CORS closed and the localhost invariant intact — the page
 * only ever talks to the hub, and the hub only ever talks to loopback.
 *
 * SECURITY: each engine's target host is validated to be loopback ONLY
 * (127.0.0.1 / localhost / ::1); anything else is rejected — no SSRF. Token
 * guard: server.js rejects every non-GET without X-Hub-Token before this runs.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const U = require('./util');

const TTS_TIMEOUT_MS = 120000; // first CSM call is slow; Kokoro is quick but share the ceiling
const PROJECT_DIR = path.resolve(__dirname, '..', '..');

// Per-engine config. `dir` is the gitignored venv/weights folder under the repo
// root; `url` is overridable via env but always validated to loopback.
const ENGINES = {
  kokoro: { dir: '.kokoro', script: 'kokoro-server.py', port: 8791, urlEnv: 'HUB_KOKORO_URL' },
  csm:    { dir: '.csm',    script: 'csm-server.py',    port: 8790, urlEnv: 'HUB_CSM_URL' },
};
const children = {}; // engine -> child spawned by this hub boot (may also run standalone)

function engineKey(v) { return (v === 'kokoro' || v === 'csm') ? v : 'csm'; }
function venvPy(engine) { return path.join(PROJECT_DIR, ENGINES[engine].dir, 'venv', 'Scripts', 'python.exe'); }
function sidecarPath(engine) { return path.join(PROJECT_DIR, 'scripts', ENGINES[engine].script); }
function logFile(engine) { return path.join(PROJECT_DIR, ENGINES[engine].dir, 'server.log'); }

// Parse + validate an engine's server URL. Returns a URL or null if it is not a
// plain-http loopback address (the only thing this proxy will ever talk to).
function targetFor(engine) {
  const e = ENGINES[engine];
  const dflt = 'http://127.0.0.1:' + e.port + '/tts';
  let u;
  try { u = new URL(process.env[e.urlEnv] || dflt); } catch { return null; }
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

// Spawn an engine's sidecar inside its venv. Fixed argv array (venv python +
// repo script + validated loopback port) — no shell, no user input.
function startSidecar(engine, target) {
  const py = venvPy(engine), script = sidecarPath(engine);
  if (!fs.existsSync(py)) return { error: ENGINES[engine].dir + ' venv missing — see docs/voice-csm.md (Kokoro: docs/voice-kokoro.md)' };
  if (!fs.existsSync(script)) return { error: 'scripts/' + ENGINES[engine].script + ' missing' };
  const cur = children[engine];
  if (cur && cur.exitCode === null) return { ok: true, note: 'already starting/running' };
  let log = 'ignore';
  try { log = fs.openSync(logFile(engine), 'a'); } catch {}
  try {
    const c = spawn(py, [script, String(target.port || ENGINES[engine].port)], {
      cwd: PROJECT_DIR, windowsHide: true, stdio: ['ignore', log, log],
    });
    c.on('error', () => { children[engine] = null; });
    c.on('close', () => { children[engine] = null; });
    children[engine] = c;
    return { ok: true, pid: c.pid, note: engine === 'kokoro' ? 'starting — first run downloads the model (~340 MB), then loads in a few s' : 'starting — model loads in ~15-30 s' };
  } catch (e) {
    return { error: 'spawn failed: ' + e.message };
  }
}

// Kill any process LISTENING on a loopback port. Windows-only best effort:
// fixed argv arrays (netstat, then taskkill by PID) — no shell, no user input,
// the port is an integer from our own ENGINES table. Fire-and-forget; used to
// clear a sidecar this hub boot didn't spawn (e.g. a leftover from an earlier
// process) so "Stop" actually frees the port rather than only our own child.
function killByPort(port) {
  execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, out) => {
    if (err || !out) return;
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && parseInt(m[1], 10) === port && m[2] !== '0' && m[2] !== String(process.pid)) pids.add(m[2]);
    }
    for (const pid of pids) { try { execFile('taskkill', ['/PID', pid, '/F', '/T'], { windowsHide: true }, () => {}); } catch {} }
  });
}

// Sidecar /health statuses are "loading" | "ready" | "error" (see scripts/
// kokoro-server.py); "ready" is the only serving state.
const isUp = (h) => !!h && h.status === 'ready';

// Poll an engine's /health every 500 ms until it serves or `ms` elapses.
function waitReady(target, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function tick() {
      health(target).then(h => {
        if (isUp(h)) return resolve(true);
        if (Date.now() - t0 >= ms) return resolve(false);
        setTimeout(tick, 500);
      });
    })();
  });
}

// Make sure an engine is serving before a TTS request is forwarded: already
// healthy → true; installed but offline → spawn it and wait for the model to
// load. Mobile auto-read depends on Kokoro (iOS blocks async speechSynthesis),
// so a dead sidecar must self-heal rather than leave the phone silent.
async function ensureUp(engine, target) {
  if (isUp(await health(target))) return true;
  if (!fs.existsSync(venvPy(engine))) return false;
  const r = startSidecar(engine, target);
  if (r.error) return false;
  return waitReady(target, engine === 'kokoro' ? 25000 : 60000);
}

// Boot-time warm start: bring Kokoro up as soon as the hub is listening (when
// installed), so the first spoken reply doesn't pay the model-load wait.
// Fire-and-forget; CSM stays manual — it's slow, heavy, and opt-in.
function autoStart() {
  const target = targetFor('kokoro');
  if (!target || !fs.existsSync(venvPy('kokoro'))) return;
  health(target).then(h => { if (!isUp(h)) startSidecar('kokoro', target); });
}

// Stop an engine's sidecar: kill the child this hub spawned (if any), then clear
// any other listener still holding the port. So the UI's "Stop" reliably takes
// the engine offline regardless of who started it.
function stopSidecar(engine) {
  const cur = children[engine];
  let killed = false;
  if (cur && cur.exitCode === null) { try { cur.kill(); killed = true; } catch {} }
  children[engine] = null;
  try { killByPort(ENGINES[engine].port); } catch {}
  return { ok: true, killed };
}

async function handle(req, res, url) {
  if (url.pathname === '/api/voice/status' && req.method === 'GET') {
    const engine = engineKey(url.searchParams.get('engine'));
    const target = targetFor(engine);
    const j = target ? await health(target) : { status: 'offline', error: 'bad ' + ENGINES[engine].urlEnv };
    j.engine = engine;
    j.installed = fs.existsSync(venvPy(engine));
    j.spawnedByHub = !!(children[engine] && children[engine].exitCode === null);
    U.sendJson(res, j);
    return true;
  }
  if (url.pathname === '/api/voice/start' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4 * 1024) || '{}'); } catch {}
    const engine = engineKey(b.engine || url.searchParams.get('engine'));
    const target = targetFor(engine);
    const r = target ? startSidecar(engine, target) : { error: ENGINES[engine].urlEnv + ' must be a loopback http URL' };
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (url.pathname === '/api/voice/stop' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4 * 1024) || '{}'); } catch {}
    const engine = engineKey(b.engine || url.searchParams.get('engine'));
    U.sendJson(res, stopSidecar(engine));
    return true;
  }
  if (url.pathname !== '/api/voice/tts' || req.method !== 'POST') return false;

  let b = {};
  try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
  const text = (typeof b.text === 'string' ? b.text : '').trim().slice(0, 1200);
  if (!text) { U.sendJson(res, { error: 'text required' }, 400); return true; }
  let speaker = parseInt(b.speaker, 10);
  if (isNaN(speaker) || speaker < 0 || speaker > 9) speaker = 0;
  const engine = engineKey(b.engine || url.searchParams.get('engine'));

  const target = targetFor(engine);
  if (!target) {
    U.sendJson(res, { error: ENGINES[engine].urlEnv + ' must be a loopback http URL (127.0.0.1 / localhost / ::1)' }, 400);
    return true;
  }

  // Self-heal: if the sidecar died (or was never started), spawn it and wait
  // for /health before forwarding — otherwise phones sit silent with no way
  // to press the desktop Start button. Falls through on failure so the client
  // still gets the clean 502 it uses to fall back to browser TTS.
  await ensureUp(engine, target);

  const payload = JSON.stringify({ text, speaker });
  await new Promise((resolve) => {
    const fwd = http.request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: TTS_TIMEOUT_MS,
    }, (up) => {
      if (up.statusCode !== 200) {
        let msg = '';
        up.on('data', d => { if (msg.length < 2000) msg += d; });
        up.on('end', () => {
          U.sendJson(res, { error: `${engine} server error ${up.statusCode}: ${msg.slice(0, 300)}` }, 502);
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
    fwd.on('timeout', () => fwd.destroy(new Error('timed out after ' + TTS_TIMEOUT_MS / 1000 + 's')));
    fwd.on('error', (e) => {
      // headersSent = failure mid-stream; otherwise a clean JSON error the
      // client uses to fall back to browser TTS.
      if (!res.headersSent) {
        U.sendJson(res, { error: `${engine} server unreachable at ${target.href} (${e.message}) — start it from Config → Voice` }, 502);
      } else { try { res.end(); } catch {} }
      resolve();
    });
    fwd.end(payload);
  });
  return true;
}

module.exports = { handle, targetFor, autoStart };
