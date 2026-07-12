/*
 * Artifact serving for runs: count/list files a run produced under
 * data/runs/<id>/artifacts/, and stream one back under a strict CSP sandbox.
 * Split out of runs.js to keep that module under the 500-line budget.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const RUNS_DIR = path.join(path.resolve(__dirname, '..'), 'data', 'runs');
const okId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && id.length < 64;

function countArtifacts(id) {
  let n = 0;
  (function walk(d) {
    for (const e of U.listDir(d)) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile()) n++;
    }
  })(path.join(RUNS_DIR, id, 'artifacts'));
  return n;
}

function listArtifacts(id) {
  if (!okId(id)) return null;
  const base = path.join(RUNS_DIR, id, 'artifacts');
  const out = [];
  (function walk(d, rel) {
    for (const e of U.listDir(d)) {
      const full = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        out.push({ file: r, size: st.size });
      }
    }
  })(base, '');
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv', '.pdf': 'application/pdf',
};

function serveArtifact(res, id, file) {
  if (!okId(id) || !file) return U.sendJson(res, { error: 'bad request' }, 400);
  const base = path.join(RUNS_DIR, id, 'artifacts');
  const full = path.normalize(path.join(base, file));
  if (full !== base && !full.startsWith(base + path.sep)) return U.sendJson(res, { error: 'forbidden' }, 403);
  let st; try { st = fs.statSync(full); } catch { return U.sendJson(res, { error: 'not found' }, 404); }
  if (!st.isFile()) return U.sendJson(res, { error: 'not found' }, 404);
  const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime, 'Content-Length': st.size, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // opaque origin even when opened directly — an artifact page must never be
    // able to read the hub token or call token-guarded endpoints. The ONLY
    // reachable http path is the read-only local asset library under /vendor/.
    'Content-Security-Policy': "sandbox allow-scripts; default-src 'unsafe-inline' data: blob:; "
      + "font-src data: http://127.0.0.1:*/vendor/ http://localhost:*/vendor/; "
      + "style-src 'unsafe-inline' http://127.0.0.1:*/vendor/ http://localhost:*/vendor/; "
      + "img-src data: blob: http://127.0.0.1:*/vendor/ http://localhost:*/vendor/",
  });
  fs.createReadStream(full).pipe(res);
}

module.exports = { countArtifacts, listArtifacts, serveArtifact };
