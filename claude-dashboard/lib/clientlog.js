/*
 * Client-error sink — the missing eye on the browser.
 *
 * The hub is driven by voice and from a phone, where there is no DevTools
 * console to read. When a tab throws (the Jarvis-tab "loads of errors" report
 * is the motivating case), the error is invisible server-side. This module is
 * the zero-dep fix: assets/clientlog.js installs window.onerror +
 * unhandledrejection handlers that beacon each error here, and we keep a small
 * capped ring in data/clientlog.json that a run (or the user) can read back.
 *
 *   POST /api/clientlog        { kind, msg, src, line, col, stack, tab }  -> { ok }
 *   GET  /api/clientlog        [?tab=&limit=]  -> { count, records }  (newest first)
 *   POST /api/clientlog/clear                  -> { ok, cleared }
 *
 * Diagnostic aid only — no secrets, no client data; localhost + X-Hub-Token
 * (on the POSTs) already gate it. Capped so it can never grow unbounded.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const FILE = path.resolve(__dirname, '..', 'data', 'clientlog.json');
const CAP = 200;                 // keep only the most recent N records
const MAX_STR = 4000;            // clamp any single field (stacks can be huge)

const clip = (v, n = 400) => (v == null ? '' : String(v).slice(0, n));

function read() {
  const d = U.safeJson(FILE);
  return Array.isArray(d) ? d : [];
}
function write(list) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list.slice(-CAP), null, 0));
  } catch { /* diagnostic sink — never fail a request over it */ }
}

function add(rec, ua) {
  const list = read();
  list.push({
    t: new Date().toISOString(),
    kind: clip(rec.kind, 24) || 'error',
    tab: clip(rec.tab, 40),
    msg: clip(rec.msg, MAX_STR),
    src: clip(rec.src, 300),
    line: Number.isFinite(rec.line) ? rec.line : null,
    col: Number.isFinite(rec.col) ? rec.col : null,
    stack: clip(rec.stack, MAX_STR),
    ua: clip(ua, 200),
  });
  write(list);
}

async function handle(req, res, url) {
  if (url.pathname === '/api/clientlog' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    add(b, req.headers['user-agent']);
    U.sendJson(res, { ok: true });
    return true;
  }
  if (url.pathname === '/api/clientlog' && req.method === 'GET') {
    let list = read();
    const tab = url.searchParams.get('tab');
    if (tab) list = list.filter(r => r.tab === tab);
    const limit = Math.min(CAP, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || CAP));
    U.sendJson(res, { count: list.length, records: list.slice(-limit).reverse() });
    return true;
  }
  if (url.pathname === '/api/clientlog/clear' && req.method === 'POST') {
    const n = read().length;
    write([]);
    U.sendJson(res, { ok: true, cleared: n });
    return true;
  }
  return false;
}

module.exports = { handle };
