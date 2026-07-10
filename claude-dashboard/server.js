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

const PORT = parseInt(process.argv[2] || process.env.PORT || '5757', 10);
const HOST = '127.0.0.1';

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
  return !(o.startsWith('http://127.0.0.1:') || o.startsWith('http://localhost:')
    || o === 'http://127.0.0.1' || o === 'http://localhost');
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

    // every mutating endpoint requires the boot token
    if (req.method !== 'GET' && req.headers['x-hub-token'] !== TOKEN) {
      return U.sendJson(res, { error: 'missing or bad X-Hub-Token' }, 403);
    }

    if (await runs.handle(req, res, url)) return;
    if (await tasks.handle(req, res, url)) return;
    if (await schedules.handle(req, res, url)) return;
    if (await agentgraph.handle(req, res, url)) return;
    if (await memory.handle(req, res, url)) return;
    if (await files.handle(req, res, url)) return;
    if (await core.handle(req, res, url)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (e) {
    try { U.sendJson(res, { error: e.message }, 500); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  schedules.startTicker(); // scheduled runs fire only while the hub is up
  console.log(`\n  Claude Code Hub running at  http://${HOST}:${PORT}`
    + `\n  Project: ${core.PROJECT_DIR}`
    + `\n  Hub token (auto-injected into the page): ${TOKEN}`
    + `\n  (Ctrl+C to stop)\n`);
});
