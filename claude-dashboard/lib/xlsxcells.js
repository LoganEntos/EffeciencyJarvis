/*
 * Zero-dependency .xlsx reader: ZIP central-directory walk + raw-inflate, then
 * regex/index scanning of the OOXML parts. Two exports:
 *   xlsxInfo(full)                         → sheet names + dimensions (metadata)
 *   xlsxSheetCells(full, idx, maxR, maxC)  → a capped grid of cell values+fills
 * No XML parser, no npm deps — everything is string/index work over the
 * inflated part buffers. Fill colors resolve rgb + indexed fully, theme
 * best-effort; a cell whose fill can't be resolved simply gets no color.
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---- ZIP (shared with files.js via require) --------------------------------
// EOCD signature 0x06054b50, scan the last 64KB back for it, then walk the
// central directory to enumerate entries.
function zipEntries(buf) {
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
const MAX_USIZE = 40 * 1024 * 1024;

// ---- workbook cache --------------------------------------------------------
// Switching sheet tabs re-hit /api/files/xlsx(/cells) on the same file. Without
// a cache each request re-reads the whole workbook (up to 40MB), re-walks the
// zip, and re-inflates+re-parses sharedStrings/styles/theme — a synchronous
// event-loop stall that starves any concurrent run's SSE stream. Cache the read
// buffer + parsed zip entries per path, keyed on mtime+size so an edited file
// is picked up, and memoize the shared/theme/style parses lazily (xlsxInfo
// needs none of them). Bounded by count and total bytes; LRU by Map order.
const WB_CACHE = new Map(); // full -> { mtimeMs, size, buf, entries, _shared, _theme, _themeDone, _xfFills }
const WB_CACHE_MAX = 4;
const WB_CACHE_MAX_BYTES = 96 * 1024 * 1024;

function evictWorkbooks() {
  let total = 0;
  for (const v of WB_CACHE.values()) total += v.size;
  while (WB_CACHE.size > WB_CACHE_MAX || (total > WB_CACHE_MAX_BYTES && WB_CACHE.size > 1)) {
    const oldest = WB_CACHE.keys().next().value;
    total -= WB_CACHE.get(oldest).size;
    WB_CACHE.delete(oldest);
  }
}

function loadWorkbook(full) {
  let st; try { st = fs.statSync(full); } catch { return { error: 'unreadable' }; }
  const hit = WB_CACHE.get(full);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    WB_CACHE.delete(full); WB_CACHE.set(full, hit); // bump to most-recent
    return hit;
  }
  let buf; try { buf = fs.readFileSync(full); } catch { return { error: 'unreadable' }; }
  const entries = zipEntries(buf);
  if (!entries) return { error: 'not a valid xlsx (zip directory missing)' };
  const wb = { mtimeMs: st.mtimeMs, size: st.size, buf, entries,
    _shared: null, _theme: null, _themeDone: false, _xfFills: null };
  WB_CACHE.set(full, wb);
  evictWorkbooks();
  return wb;
}

function sharedOf(wb) {
  if (wb._shared == null) wb._shared = parseSharedStrings(wb.buf, wb.entries);
  return wb._shared;
}
function themeOf(wb) {
  if (!wb._themeDone) { wb._theme = parseTheme(wb.buf, wb.entries); wb._themeDone = true; }
  return wb._theme;
}
function xfFillsOf(wb) {
  if (wb._xfFills == null) wb._xfFills = parseStyleFills(wb.buf, wb.entries, themeOf(wb));
  return wb._xfFills;
}

// ---- metadata (moved verbatim from files.js) -------------------------------
function sheetEntriesOf(entries) {
  return entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => parseInt(a.name.match(/\d+/)[0], 10) - parseInt(b.name.match(/\d+/)[0], 10));
}

function xlsxInfo(full) {
  const wb0 = loadWorkbook(full);
  if (wb0.error) return { error: wb0.error };
  const { buf, entries } = wb0;
  const wbEntry = entries.find(e => e.name === 'xl/workbook.xml');
  if (!wbEntry) return { error: 'not an xlsx workbook (no xl/workbook.xml)' };
  const wb = (zipRead(buf, wbEntry) || Buffer.alloc(0)).toString('utf8');
  const names = [...wb.matchAll(/<sheet[^>]*\bname="([^"]*)"/g)].map(m => decodeXml(m[1]));
  const sheetEntries = sheetEntriesOf(entries);
  const sheets = sheetEntries.map((e, i) => {
    const out = { name: names[i] || e.name.replace(/^xl\/worksheets\//, ''), rows: null, cols: null, ref: null };
    if (e.usize > MAX_USIZE) { out.note = 'sheet too large to inspect'; return out; }
    const xml = (zipRead(buf, e) || Buffer.alloc(0)).toString('utf8');
    const dim = xml.match(/<dimension ref="([A-Z]+\d+(?::([A-Z]+)(\d+))?)"/);
    if (dim) {
      out.ref = dim[1];
      if (dim[2]) { out.cols = colToNum(dim[2]); out.rows = parseInt(dim[3], 10); }
      else { out.cols = 1; out.rows = 1; }
    } else {
      out.rows = (xml.match(/<row[ >]/g) || []).length;
    }
    return out;
  });
  return { sheetCount: sheets.length, sheets };
}

// ---- XML helpers -----------------------------------------------------------
function decodeXml(s) {
  if (s == null) return '';
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>'
      : e === 'quot' ? '"' : e === 'apos' ? "'" : m;
  });
}

// Concatenate every <t>…</t> run inside a shared-string or inline block.
function collectText(block) {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(block))) out += decodeXml(m[1] || '');
  return out;
}

// ---- shared strings --------------------------------------------------------
function parseSharedStrings(buf, entries) {
  const e = entries.find(x => x.name === 'xl/sharedStrings.xml');
  if (!e || e.usize > MAX_USIZE) return [];
  const xml = (zipRead(buf, e) || Buffer.alloc(0)).toString('utf8');
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) out.push(collectText(m[1] || ''));
  return out;
}

// ---- indexed colour palette (ECMA-376 legacy 64-entry table) ---------------
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

// ---- theme colours (best effort) -------------------------------------------
// clrScheme children order: dk1 lt1 dk2 lt2 accent1..6 hlink folHlink.
// Excel theme index maps 0→lt1,1→dk1,2→lt2,3→dk2,4→accent1… (0/1 and 2/3 swap).
function parseTheme(buf, entries) {
  const e = entries.find(x => x.name === 'xl/theme/theme1.xml');
  if (!e) return null;
  const xml = (zipRead(buf, e) || Buffer.alloc(0)).toString('utf8');
  const scheme = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/);
  if (!scheme) return null;
  const raw = [];
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g;
  let m;
  while ((m = re.exec(scheme[0]))) {
    const inner = m[2];
    const srgb = inner.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/);
    const sys = inner.match(/<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/);
    raw.push(srgb ? srgb[1] : sys ? sys[1] : null);
  }
  // raw = [dk1,lt1,dk2,lt2,accent1..6,hlink,folHlink]
  return [raw[1], raw[0], raw[3], raw[2], raw[4], raw[5], raw[6], raw[7], raw[8], raw[9], raw[10], raw[11]];
}

function applyTint(hex, tint) {
  if (!hex || !tint) return hex;
  const n = parseInt(hex, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = ch => {
    const v = tint < 0 ? ch * (1 + tint) : ch * (1 - tint) + 255 * tint;
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  r = f(r); g = f(g); b = f(b);
  return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase();
}

// ---- styles: build xfIndex → "#RRGGBB" | null ------------------------------
function parseStyleFills(buf, entries, theme) {
  const e = entries.find(x => x.name === 'xl/styles.xml');
  if (!e || e.usize > MAX_USIZE) return [];
  const xml = (zipRead(buf, e) || Buffer.alloc(0)).toString('utf8');

  // fills → color per fillId (index order)
  const fillsBlock = (xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/) || [, ''])[1];
  const fillColors = [];
  const fillRe = /<fill>([\s\S]*?)<\/fill>/g;
  let fm;
  while ((fm = fillRe.exec(fillsBlock))) {
    const inner = fm[1];
    const solid = /patternType="solid"/.test(inner);
    if (!solid) { fillColors.push(null); continue; }
    const fg = inner.match(/<fgColor\b([^>]*)\/?>/);
    fillColors.push(fg ? colorFromAttrs(fg[1], theme) : null);
  }

  // cellXfs → fillId per xf (index order)
  const xfsBlock = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ''])[1];
  const out = [];
  const xfRe = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  let xm;
  while ((xm = xfRe.exec(xfsBlock))) {
    const attrs = xm[1];
    const fid = attrs.match(/\bfillId="(\d+)"/);
    // fillId 0 (none) and 1 (gray125) are reserved → no colour
    const id = fid ? parseInt(fid[1], 10) : 0;
    out.push(id > 1 ? (fillColors[id] || null) : null);
  }
  return out;
}

function colorFromAttrs(attrs, theme) {
  const rgb = attrs.match(/\brgb="([0-9A-Fa-f]{6,8})"/);
  if (rgb) {
    const hex = rgb[1].length === 8 ? rgb[1].slice(2) : rgb[1];
    return '#' + hex.toUpperCase();
  }
  const idx = attrs.match(/\bindexed="(\d+)"/);
  if (idx) { const h = INDEXED[parseInt(idx[1], 10)]; return h ? '#' + h : null; }
  const th = attrs.match(/\btheme="(\d+)"/);
  if (th && theme) {
    let base = theme[parseInt(th[1], 10)];
    if (!base) return null;
    const tint = attrs.match(/\btint="(-?[0-9.]+)"/);
    if (tint) base = applyTint(base, parseFloat(tint[1]));
    return '#' + base.toUpperCase();
  }
  return null;
}

// ---- the grid --------------------------------------------------------------
// Parse one <row>…</row> body into cells placed by column index (0-based),
// capped at maxCols. Returns an array of length up to maxCols.
function parseRow(body, shared, xfFills, maxCols) {
  const cells = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(body))) {
    const attrs = m[1], inner = m[2] || '';
    const rref = attrs.match(/\br="([A-Z]+)(\d+)"/);
    const col = rref ? colToNum(rref[1]) - 1 : cells.length;
    if (col >= maxCols) continue;
    const t = (attrs.match(/\bt="([^"]+)"/) || [, ''])[1];
    let v = '';
    if (t === 'inlineStr') {
      v = collectText(inner);
    } else {
      const vm = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const raw = vm ? decodeXml(vm[1]) : '';
      if (t === 's') { const si = parseInt(raw, 10); v = shared[si] != null ? shared[si] : ''; }
      else if (t === 'b') v = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
      else v = raw; // str / number / date-serial
    }
    const cell = { v };
    const s = attrs.match(/\bs="(\d+)"/);
    if (s) { const c = xfFills[parseInt(s[1], 10)]; if (c) cell.c = c; }
    cells[col] = cell;
  }
  // normalise sparse holes to empty cells so column alignment holds
  for (let i = 0; i < cells.length; i++) if (!cells[i]) cells[i] = { v: '' };
  return cells;
}

function xlsxSheetCells(full, sheetIndex, maxRows, maxCols) {
  maxRows = Math.max(1, Math.min(maxRows || 200, 500));
  maxCols = Math.max(1, Math.min(maxCols || 40, 100));
  const wbc = loadWorkbook(full);
  if (wbc.error) return { error: wbc.error };
  const { buf, entries } = wbc;
  const wbEntry = entries.find(e => e.name === 'xl/workbook.xml');
  if (!wbEntry) return { error: 'not an xlsx workbook (no xl/workbook.xml)' };
  const wb = (zipRead(buf, wbEntry) || Buffer.alloc(0)).toString('utf8');
  const names = [...wb.matchAll(/<sheet[^>]*\bname="([^"]*)"/g)].map(m => decodeXml(m[1]));
  const sheetEntries = sheetEntriesOf(entries);
  if (!sheetEntries.length) return { error: 'no worksheets' };
  const idx = Math.max(0, Math.min(sheetIndex | 0, sheetEntries.length - 1));
  const sEntry = sheetEntries[idx];
  const sheetName = names[idx] || sEntry.name.replace(/^xl\/worksheets\//, '');
  if (sEntry.usize > MAX_USIZE) {
    return { sheet: idx, sheetName, rows: [], totalRows: null, totalCols: null,
      shownRows: 0, shownCols: 0, truncated: true, note: 'sheet too large to inspect' };
  }
  const xml = (zipRead(buf, sEntry) || Buffer.alloc(0)).toString('utf8');

  // totals from dimension
  let totalRows = null, totalCols = null;
  const dim = xml.match(/<dimension ref="[A-Z]+\d+(?::([A-Z]+)(\d+))?"/);
  if (dim && dim[1]) { totalCols = colToNum(dim[1]); totalRows = parseInt(dim[2], 10); }

  const conditional = /<conditionalFormatting\b/.test(xml);
  const shared = sharedOf(wbc);
  const xfFills = xfFillsOf(wbc); // memoized; internally resolves theme

  // walk <row> elements in document order, stop once maxRows collected
  const rows = [];
  let widest = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    if (rows.length >= maxRows) break;
    const cells = parseRow(rm[2] || '', shared, xfFills, maxCols);
    if (cells.length > widest) widest = cells.length;
    rows.push(cells);
  }
  const shownCols = Math.min(widest, maxCols);
  // pad every row to shownCols for a rectangular grid
  for (const r of rows) { while (r.length < shownCols) r.push({ v: '' }); r.length = shownCols; }
  if (totalRows == null) totalRows = rows.length;
  if (totalCols == null) totalCols = shownCols;

  const truncated = (totalRows > rows.length) || (totalCols > shownCols);
  return { sheet: idx, sheetName, rows, totalRows, totalCols,
    shownRows: rows.length, shownCols, truncated, conditional };
}

module.exports = { zipEntries, zipRead, colToNum, xlsxInfo, xlsxSheetCells };
