/*
 * File inbox: browser uploads land in data/inbox/ for Claude runs to consume.
 * Vanilla multipart/form-data parsing — no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const X = require('./xlsxcells'); // zero-dep xlsx reader (metadata + cell grid)

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

// The inbox supports ONE level of "project" subfolders (data/inbox/<project>/)
// — created by SharePoint pulls or the project field on upload — so related
// files group into a project a run can be pointed at.
function statEntry(rel) {
  let st; try { st = fs.statSync(path.join(INBOX, rel)); } catch { st = {}; }
  const seg = rel.split(path.sep);
  return { name: seg.join('/'), project: seg.length > 1 ? seg[0] : null,
    size: st.size || 0, modified: st.mtime || null, path: path.join(INBOX, rel) };
}
function listFiles() {
  const out = [];
  for (const e of U.listDir(INBOX)) {
    if (e.isFile()) out.push(statEntry(e.name));
    else if (e.isDirectory() && sanitizeName(e.name)) {
      for (const f of U.listDir(path.join(INBOX, e.name))) {
        if (f.isFile()) out.push(statEntry(path.join(e.name, f.name)));
      }
    }
  }
  return out.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

// name may be "file" or "project/file" — each segment independently sanitized,
// so traversal can never survive (path.basename strips separators and ..).
function inboxFile(name) {
  const segs = (name || '').toString().split('/');
  if (segs.length > 2) return null;
  const safeSegs = segs.map(sanitizeName);
  if (safeSegs.some(s => !s)) return null;
  const safe = safeSegs.join('/');
  const full = path.join(INBOX, ...safeSegs);
  return { safe, full, exists: fs.existsSync(full) };
}

// N6: zero-dep xlsx preview (metadata) + the cell-grid reader both live in
// lib/xlsxcells.js — an .xlsx is a ZIP, read via central-directory walk +
// raw-inflate, then regex/index-scanned. Kept out of this file to stay under
// the 500-line rule. xlsxInfo(full) gives sheet names + dimensions.
const xlsxInfo = X.xlsxInfo;

// R4: inline image preview (thumbnails in the Files tab). Restricted to a
// known-safe image allowlist and served WITHOUT Content-Disposition:attachment
// so <img> can render it; <img> never executes scripts even for image/svg+xml.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };

// Text-like extensions the in-app document viewer will render (via /api/files/text).
const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'log',
  'yml', 'yaml', 'xml', 'html', 'htm', 'ini', 'cfg', 'conf', 'toml', 'env', 'sql', 'rst',
  'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'sh', 'ps1', 'bat']);

async function handle(req, res, url) {
  if (url.pathname === '/api/files/view' && req.method === 'GET') {
    const f = inboxFile(url.searchParams.get('name') || '');
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const ext = (f.safe.split('.').pop() || '').toLowerCase();
    const ctype = IMAGE_TYPES[ext];
    if (!ctype) { U.sendJson(res, { error: 'not a previewable image' }, 400); return true; }
    const st = fs.statSync(f.full);
    // SVG can carry inline <script>; on direct navigation (not <img>) it would
    // run in the hub's own origin. Sandbox it via CSP — harmless to <img> use.
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    fs.createReadStream(f.full).pipe(res);
    return true;
  }
  if (url.pathname === '/api/files/xlsx' && req.method === 'GET') {
    const f = inboxFile(url.searchParams.get('name') || '');
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    if (!/\.(xlsx|xlsm|xltx)$/i.test(f.safe)) { U.sendJson(res, { error: 'not an Excel workbook' }, 400); return true; }
    U.sendJson(res, Object.assign({ name: f.safe }, xlsxInfo(f.full)));
    return true;
  }
  // Cell-grid preview: capped (200 rows × 40 cols) grid of actual cell VALUES
  // with resolved fill colours, so a workbook's verification colour-coding is
  // visible without Excel. Same traversal guard + extension allowlist.
  if (url.pathname === '/api/files/xlsx/cells' && req.method === 'GET') {
    const f = inboxFile(url.searchParams.get('name') || '');
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    if (!/\.(xlsx|xlsm|xltx)$/i.test(f.safe)) { U.sendJson(res, { error: 'not an Excel workbook' }, 400); return true; }
    const sp = url.searchParams.get('sheet');
    const sheet = /^\d+$/.test(sp || '') ? parseInt(sp, 10) : 0; // clamp handled in reader
    const grid = X.xlsxSheetCells(f.full, sheet, 200, 40);
    if (grid.error) { U.sendJson(res, grid, 400); return true; }
    U.sendJson(res, Object.assign({ name: f.safe }, grid));
    return true;
  }
  // In-app document viewer: return UTF-8 text for text-like files so the SPA can
  // render markdown / show csv / show plaintext without a download round-trip.
  // Hard-capped so a giant log can't blow up memory or the client.
  if (url.pathname === '/api/files/text' && req.method === 'GET') {
    const f = inboxFile(url.searchParams.get('name') || '');
    if (!f || !f.exists) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const ext = (f.safe.split('.').pop() || '').toLowerCase();
    if (!TEXT_EXTS.has(ext)) { U.sendJson(res, { error: 'not a text-previewable file' }, 400); return true; }
    const CAP = 800 * 1024;
    let st; try { st = fs.statSync(f.full); } catch { U.sendJson(res, { error: 'unreadable' }, 500); return true; }
    const fd = fs.openSync(f.full, 'r');
    const buf = Buffer.alloc(Math.min(st.size, CAP));
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    U.sendJson(res, { name: f.safe, ext, text: buf.toString('utf8'), truncated: st.size > CAP, bytes: st.size });
    return true;
  }
  const p = url.pathname;
  if (p === '/api/files' && req.method === 'GET') { U.sendJson(res, listFiles()); return true; }
  if (p === '/api/files' && req.method === 'POST') {
    let body;
    try { body = await readRaw(req, MAX_BYTES); }
    catch { U.sendJson(res, { error: 'upload too large (50 MB cap) or aborted' }, 413); return true; }
    const parts = parseMultipart(body, req.headers['content-type']);
    if (!parts || !parts.length) { U.sendJson(res, { error: 'no file in upload' }, 400); return true; }
    const overwrite = url.searchParams.get('overwrite') === '1';
    const project = sanitizeName(url.searchParams.get('project') || '');
    fs.mkdirSync(project ? path.join(INBOX, project) : INBOX, { recursive: true });
    const saved = [], conflicts = [];
    for (const part of parts) {
      const f = inboxFile((project ? project + '/' : '') + part.filename);
      if (!f) continue;
      if (f.exists && !overwrite) { conflicts.push(f.safe); continue; }
      fs.writeFileSync(f.full, part.data);
      saved.push({ name: f.safe, size: part.data.length, path: f.full });
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
    try {
      fs.unlinkSync(f.full);
      // deleting the last file of a project folder shouldn't leave an empty
      // group hanging in the Files tab — rmdir refuses non-empty dirs, so this
      // only ever removes a now-empty project folder
      const dir = path.dirname(f.full);
      if (path.resolve(dir) !== path.resolve(INBOX)) { try { fs.rmdirSync(dir); } catch {} }
      U.sendJson(res, { ok: true });
    }
    catch (e) { U.sendJson(res, { error: e.message }, 500); }
    return true;
  }
  return false;
}

module.exports = { handle };
