/*
 * File inbox: browser uploads land in data/inbox/ for Claude runs to consume.
 * Vanilla multipart/form-data parsing — no dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

// ---- N6: zero-dep xlsx preview -------------------------------------------
// An .xlsx is a ZIP; we read just the central directory + the two XML kinds
// needed for a structural preview: workbook.xml (sheet names) and each
// worksheet's <dimension> tag (grid size). No cell values are parsed.

// ZIP central directory → [{ name, method, csize, usize, offset }]
function zipEntries(buf) {
  // EOCD signature 0x06054b50, scan the last 64KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && pos + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const csize = buf.readUInt32LE(pos + 20);
    const usize = buf.readUInt32LE(pos + 24);
    const nlen = buf.readUInt16LE(pos + 28), elen = buf.readUInt16LE(pos + 30), clen = buf.readUInt16LE(pos + 32);
    const name = buf.slice(pos + 46, pos + 46 + nlen).toString('utf8');
    out.push({ name, method, csize, usize, offset: buf.readUInt32LE(pos + 42) });
    pos += 46 + nlen + elen + clen;
  }
  return out;
}

function zipRead(buf, entry) {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) return null;
  const nlen = buf.readUInt16LE(p + 26), elen = buf.readUInt16LE(p + 28);
  const data = buf.slice(p + 30 + nlen + elen, p + 30 + nlen + elen + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method === 8) { try { return zlib.inflateRawSync(data); } catch { return null; } }
  return null;
}

const colToNum = c => c.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);

function xlsxInfo(full) {
  let buf; try { buf = fs.readFileSync(full); } catch { return { error: 'unreadable' }; }
  const entries = zipEntries(buf);
  if (!entries) return { error: 'not a valid xlsx (zip directory missing)' };
  const wbEntry = entries.find(e => e.name === 'xl/workbook.xml');
  if (!wbEntry) return { error: 'not an xlsx workbook (no xl/workbook.xml)' };
  const wb = (zipRead(buf, wbEntry) || Buffer.alloc(0)).toString('utf8');
  const names = [...wb.matchAll(/<sheet[^>]*\bname="([^"]*)"/g)].map(m => m[1]);
  // worksheets in numeric order pair with workbook sheet order in the common case
  const sheetEntries = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => parseInt(a.name.match(/\d+/)[0], 10) - parseInt(b.name.match(/\d+/)[0], 10));
  const sheets = sheetEntries.map((e, i) => {
    const out = { name: names[i] || e.name.replace(/^xl\/worksheets\//, ''), rows: null, cols: null, ref: null };
    if (e.usize > 40 * 1024 * 1024) { out.note = 'sheet too large to inspect'; return out; }
    const xml = (zipRead(buf, e) || Buffer.alloc(0)).toString('utf8');
    const dim = xml.match(/<dimension ref="([A-Z]+\d+(?::([A-Z]+)(\d+))?)"/);
    if (dim) {
      out.ref = dim[1];
      if (dim[2]) { out.cols = colToNum(dim[2]); out.rows = parseInt(dim[3], 10); }
      else { out.cols = 1; out.rows = 1; }
    } else {
      out.rows = (xml.match(/<row[ >]/g) || []).length; // fallback: count row tags
    }
    return out;
  });
  return { sheetCount: sheets.length, sheets };
}

// R4: inline image preview (thumbnails in the Files tab). Restricted to a
// known-safe image allowlist and served WITHOUT Content-Disposition:attachment
// so <img> can render it; <img> never executes scripts even for image/svg+xml.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };

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
