/*
 * Claude Code Hub — Local Management Hub
 * Zero-dependency Node HTTP server. Binds to 127.0.0.1 only (personal/local tool).
 * Start:  node server.js   (optionally PORT=5757)
 *
 * Boot + router only — routes live in lib/core.js (monitor/library),
 * lib/runs.js (run Claude from the browser), lib/files.js (upload inbox).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./lib/util');
const core = require('./lib/core');
const runs = require('./lib/runs');
const files = require('./lib/files');
const tasks = require('./lib/tasks');
const memory = require('./lib/memory');
const schedules = require('./lib/schedules');
const agentgraph = require('./lib/agentgraph');
const voice = require('./lib/voice');
const autopilot = require('./lib/autopilot');
const usage = require('./lib/usage');
const settings = require('./lib/settings');
const admin = require('./lib/admin');
const teams = require('./lib/teams');
const sources = require('./lib/sources');
const personas = require('./lib/personas');
const projects = require('./lib/projects');
const sharepoint = require('./lib/sharepoint');
const clientlog = require('./lib/clientlog');
const distill = require('./lib/distill');

const PORT = parseInt(process.argv[2] || process.env.PORT || '5757', 10);
const HOST = '127.0.0.1';

// Supervised-restart handshake (see /api/restart). A restart child writes its
// PID here in its own listen callback once it is actually serving; the old
// process waits for that proof before exiting, and resumes serving if it
// never appears — so a self-edit that breaks server code can never leave a
// dead port (the working old process just keeps running).
const RESTART_READY_FILE = path.join(__dirname, 'data', 'restart-ready');
const IS_RESTART_CHILD = process.env.HUB_RESTART === '1';

// CSRF guard: random per-boot token, injected into the served index.html and
// required (X-Hub-Token header) on every state-changing request. A foreign
// web page can fire requests at 127.0.0.1 but can never read this token.
const TOKEN = crypto.randomBytes(16).toString('hex');

const ASSETS = path.join(__dirname, 'assets');
const ASSET_MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const VENDOR = path.join(__dirname, 'vendor');
const VENDOR_MIME = {
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

function badOrigin(req) {
  const o = req.headers.origin;
  if (!o) return false; // same-origin fetches and EventSource send no Origin (or it's checked below)
  // Localhost (direct) OR the user's own Tailscale HTTPS URL (phone access via
  // `tailscale serve` — it still proxies to 127.0.0.1, so the localhost BIND
  // invariant holds; only the tailnet can reach it, and the per-boot X-Hub-Token
  // remains the real CSRF guard on every mutating request).
  if (o === 'http://127.0.0.1' || o === 'http://localhost'
    || o.startsWith('http://127.0.0.1:') || o.startsWith('http://localhost:')) return false;
  let u; try { u = new URL(o); } catch { return true; }
  // The user's own tailnet, reached any way the phone connects: MagicDNS
  // (*.ts.net) over http OR https, or a raw Tailscale CGNAT IP (100.64.0.0/10).
  // `tailscale serve` still proxies to the 127.0.0.1 bind, and the per-boot
  // X-Hub-Token stays the real CSRF guard on every mutating request.
  if (/(^|\.)ts\.net$/.test(u.hostname)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(u.hostname)) return false;
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;
  try {
    if (badOrigin(req)) return U.sendJson(res, { error: 'forbidden origin' }, 403);

    if (p === '/' || p === '/index.html') {
      const html = (U.safeRead(path.join(__dirname, 'index.html')) || '<h1>index.html missing</h1>')
        .replace('__HUB_TOKEN__', TOKEN);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    if (p.startsWith('/assets/')) {
      const name = p.slice('/assets/'.length);
      const ext = path.extname(name).toLowerCase();
      if (!/^[a-z0-9._-]+$/i.test(name) || !ASSET_MIME[ext]) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      const body = U.safeRead(path.join(ASSETS, name));
      if (body === null) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': ASSET_MIME[ext], 'Cache-Control': 'no-store' });
      return res.end(body);
    }

    // local asset library (fonts/icons/css) — read-only, traversal-guarded,
    // cacheable (files are immutable snapshots; the manifest records origins)
    if (p.startsWith('/vendor/')) {
      const rel = p.slice('/vendor/'.length);
      const ext = path.extname(rel).toLowerCase();
      if (!/^[a-z0-9._/-]+$/i.test(rel) || rel.includes('..') || !VENDOR_MIME[ext]) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      const full = path.normalize(path.join(VENDOR, rel));
      if (!full.startsWith(VENDOR + path.sep)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('forbidden'); }
      let st; try { st = fs.statSync(full); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      if (!st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': VENDOR_MIME[ext], 'Content-Length': st.size,
        'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(full).pipe(res);
    }

    // PWA manifest — served from root so start_url/scope stay "/" (installs the
    // whole hub, not a subpath). GET-only, no secrets, safe before the token guard.
    if (p === '/manifest.webmanifest') {
      const manifest = {
        name: 'Claude Code Hub', short_name: 'Claude Hub',
        description: 'Local front end for working with Claude — runs, tasks, files, memory.',
        start_url: '/', scope: '/', display: 'standalone', orientation: 'any',
        background_color: '#0e0d0b', theme_color: '#0e0d0b',
        icons: [{ src: '/vendor/icons/hub-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      };
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(manifest));
    }

    // every mutating endpoint requires the boot token
    if (req.method !== 'GET' && req.headers['x-hub-token'] !== TOKEN) {
      return U.sendJson(res, { error: 'missing or bad X-Hub-Token' }, 403);
    }

    // Restart the hub from the browser (button beside the theme toggle).
    // SUPERVISED handover — the old process does not exit until the new one
    // proves it is listening; if the replacement crashes on boot or hangs,
    // the old process resumes serving. See supervisedRestart().
    if (p === '/api/restart' && req.method === 'POST') {
      U.sendJson(res, { ok: true });
      supervisedRestart();
      return;
    }

    if (await runs.handle(req, res, url)) return;
    if (await tasks.handle(req, res, url)) return;
    if (await schedules.handle(req, res, url)) return;
    if (await agentgraph.handle(req, res, url)) return;
    if (await memory.handle(req, res, url)) return;
    if (await voice.handle(req, res, url)) return;
    if (await autopilot.handle(req, res, url)) return;
    if (await usage.handle(req, res, url)) return;
    if (await settings.handle(req, res, url)) return;
    if (await admin.handle(req, res, url)) return;
    if (await teams.handle(req, res, url)) return;
    if (await sources.handle(req, res, url)) return;
    if (await personas.handle(req, res, url)) return;
    if (await distill.handle(req, res, url)) return;
    if (await clientlog.handle(req, res, url)) return;
    if (await projects.handle(req, res, url)) return;
    if (await sharepoint.handle(req, res, url)) return;
    if (await files.handle(req, res, url)) return;
    if (await core.handle(req, res, url)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (e) {
    try { U.sendJson(res, { error: e.message }, 500); } catch {}
  }
});

// Supervised self-restart. Spawn a replacement, free the port, and wait for the
// child to confirm it is listening (it writes its PID to RESTART_READY_FILE in
// its own listen callback). Only then does this process exit. If the child
// crashes on boot — the real hazard when the hub edits its own server code — or
// never comes up in time, this process re-binds and keeps serving, so a bad
// self-edit degrades to "change didn't take effect", never to a dead port.
let restarting = false;   // a handover is in flight
let recovering = false;   // this (old) process is re-taking the port after a failed handover
function supervisedRestart() {
  if (restarting) return;
  restarting = true;
  try { fs.unlinkSync(RESTART_READY_FILE); } catch {}
  console.log('\n  Restart requested — spawning replacement; will hand off only once it is listening…\n');

  let child;
  try {
    child = require('child_process').spawn(
      process.execPath, [__filename, String(PORT)],
      { cwd: __dirname, detached: true, stdio: 'ignore',
        env: Object.assign({}, process.env, { HUB_RESTART: '1' }) });
  } catch (e) { restarting = false; console.error('  Restart failed to spawn: ' + e.message); return; }

  let settled = false;
  // the child is "up" only when the ready file holds exactly its PID (guards
  // against a stale file from an earlier handover)
  const childUp = () => {
    try { return fs.readFileSync(RESTART_READY_FILE, 'utf8').trim() === String(child.pid); }
    catch { return false; }
  };
  const handoff = () => {
    if (settled) return; settled = true;
    clearInterval(poll); clearTimeout(giveUp);
    try { child.unref(); } catch {}
    console.log('  Replacement is serving — old process exiting cleanly.');
    setTimeout(() => process.exit(0), 150);
  };
  const recover = (why) => {
    if (settled) return; settled = true;
    clearInterval(poll); clearTimeout(giveUp);
    restarting = false; recovering = true;
    console.error(`\n  Restart aborted (${why}) — resuming service on the current (working) process.\n`);
    if (!server.listening) { try { server.listen(PORT, HOST); } catch {} }
  };

  // free the listening socket so the child can bind (open connections drain on
  // their own; we exit explicitly once the child is confirmed)
  try { server.close(); } catch {}

  const poll = setInterval(() => { if (childUp()) handoff(); }, 250);
  const giveUp = setTimeout(() => recover('replacement did not start within 12s'), 12000);
  child.on('exit', (code) => { if (!childUp()) recover('replacement exited on boot (code ' + code + ')'); });
  child.on('error', (e) => recover('replacement could not be spawned: ' + e.message));
}

// Bind with retry: a restart child spawns while the old process is still
// freeing the port. Retry EADDRINUSE briefly so the handover succeeds.
let bindTries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // A recovering old process that finds the port taken means the replacement
    // grabbed it after all — step aside cleanly rather than fighting for it.
    if (recovering) { console.log('  Port taken by the replacement — old process exiting.'); return process.exit(0); }
    if (bindTries < 40) {
      bindTries++;
      if (bindTries === 1) console.log(`  Port ${PORT} busy (restart handover) — retrying…`);
      return setTimeout(() => server.listen(PORT, HOST), 250);
    }
  }
  console.error(`\n  Cannot bind ${HOST}:${PORT} — ${e.message}\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  bindTries = 0;
  schedules.startTicker(); // scheduled runs fire only while the hub is up
  autopilot.startTicker(); // self-improvement loop — no-op unless enabled in Config
  voice.autoStart();       // warm the Kokoro sidecar — mobile auto-read depends on it
  // tell the old process (if this is a supervised restart) that we're serving
  if (IS_RESTART_CHILD) {
    try {
      fs.mkdirSync(path.dirname(RESTART_READY_FILE), { recursive: true });
      fs.writeFileSync(RESTART_READY_FILE, String(process.pid));
    } catch {}
  }
  console.log(`\n  Claude Code Hub running at  http://${HOST}:${PORT}`
    + `\n  Project: ${core.PROJECT_DIR}`
    + `\n  Hub token (auto-injected into the page): ${TOKEN}`
    + `\n  (Ctrl+C to stop)\n`);
});
