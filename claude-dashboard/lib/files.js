/*
 * File inbox: browser uploads land in data/inbox/ for Claude runs to consume.
 * Vanilla multipart/form-data parsing — no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const INBOX = path.join(DASH_DIR, 'data', 'inbox');
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// Keep only safe filename characters; no traversal, no leading dots.
function sanitizeName(name) {
  const base = path.basename((name || '').trim()).replace(/[^A-Za-z0-9 ._()\-\[\]]/g, '_');
  if (!base || /^\.+$/.test(base) || base.startsWith('.')) return null;
  return base.slice(0, 150);
}

// Collect the raw request body as a Buffer, hard-capped.
function readRaw(req, cap) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > cap) { req.destroy(); return reject(new Error('too large')); }
    const chunks = [];
    let size = 0;
    req.on('data', d => {
      size += d.length;
      if (size > cap) { req.destroy(); return reject(new Error('too large')); }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Minimal multipart parser: returns [{ filename, data }] for file parts.
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const parts = [];
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const next = body.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    // part = [boundary]\r\n headers \r\n\r\n data \r\n [next boundary]
    const chunk = body.slice(pos + boundary.length + 2, next - 2); // strip leading \r\n and trailing \r\n
    const headEnd = chunk.indexOf('\r\n\r\n');
    if (headEnd !== -1) {
      const head = chunk.slice(0, headEnd).toString('utf8');
      const fn = /filename="([^"]*)"/i.exec(head);
      if (fn && fn[1]) parts.push({ filename: fn[1], data: chunk.slice(headEnd + 4) });
    }
    pos = next;
  }
  return parts;
}

function listFiles() {
  return U.listDir(INBOX).filter(e => e.isFile()).map(e => {
    let st; try { st = fs.statSync(path.join(INBOX, e.name)); } catch { st = {}; }
    return { name: e.name, size: st.size || 0, modified: st.mtime || null, path: path.join(INBOX, e.name) };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function inboxFile(name) {
  const safe = sanitizeName(name);
  if (!safe) return null;
  const full = path.join(INBOX, safe);
  return { safe, full, exists: fs.existsSync(full) };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/files' && req.method === 'GET') { U.sendJson(res, listFiles()); return true; }
  if (p === '/api/files' && req.method === 'POST') {
    let body;
    try { body = await readRaw(req, MAX_BYTES); }
    catch { U.sendJson(res, { error: 'upload too large (50 MB cap) or aborted' }, 413); return true; }
    const parts = parseMultipart(body, req.headers['content-type']);
    if (!parts || !parts.length) { U.sendJson(res, { error: 'no file in upload' }, 400); return true; }
    const overwrite = url.searchParams.get('overwrite') === '1';
    fs.mkdirSync(INBOX, { recursive: true });
    const saved = [], conflicts = [];
    for (const part of parts) {
      const f = inboxFile(part.filename);
      if (!f) continue;
      if (f.exists && !overwrite) { conflicts.push(f.safe); continue; }
      fs.writeFileSync(f.full, part.data);
      saved.push({ name: f.safe, size: part.data.length });
    }
    if (conflicts.length && !saved.length) { U.sendJson(res, { error: 'exists', conflicts }, 409); return true; }
    U.sendJson(res, { saved, conflicts });
    return true;
  }
  if (p === '/api/files/download') {
    const f = inboxFile(url.searchParams.get('name') || '');
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const st = fs.statSync(f.full);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${f.safe}"`, 'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(f.full).pipe(res);
    return true;
  }
  if (p === '/api/files/delete' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const f = inboxFile((b.name || '').toString());
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    try { fs.unlinkSync(f.full); U.sendJson(res, { ok: true }); }
    catch (e) { U.sendJson(res, { error: e.message }, 500); }
    return true;
  }
  return false;
}

module.exports = { handle };
