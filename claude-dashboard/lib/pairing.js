/*
 * PDF <-> CSV order pairing for a project's inbox folder (VPP-style historical
 * imports: order-<id>.csv line-item exports paired against their source PI /
 * commercial-invoice PDFs). The scan itself is read-only, stateless — every
 * call re-scans the folder from filenames only (never opens a PDF or parses
 * business data out of one, per the hub's "no client/business data" rule).
 *
 * One deliberate exception: a HUMAN DECISION overlay (skip/flag/assign a
 * note on an order — architect proposal 2026-07-30, "Option A: sidecar
 * overlay"). The scan can't know an order is intentionally skipped or who's
 * chasing it down, and that judgment must survive a re-scan/SharePoint
 * re-pull. Persisted as `<slug>/.decisions.json`, a dotfile sibling to
 * manifest.csv — already excluded from the unparsed list by isSupport()
 * below (the `.json` clause), and never touched by sharepoint.js pull()
 * (which only ever writes the one named file it downloads).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const INBOX = path.join(DASH_DIR, 'data', 'inbox');
const SP_INDEX_FILE = path.join(DASH_DIR, 'data', 'sharepoint-index.json');

// Extraction patterns (derived from the real VPP historical-import files —
// see data/inbox/vpp-historical-import-test/ for the canonical examples).
// Order id is normally numeric (invoice #) but not always -- SPL002/010763
// (2026-07-30, a confirmed no-PI order converted from a plain invoice
// template instead) has an alphanumeric one, so this accepts letters+digits,
// not just digits. The optional "-<digits>" suffix (multi-PI orders like
// 22610/22610-2) is unchanged.
const CSV_RE = /^order-([A-Za-z0-9]+(?:-\d+)?)\.csv$/i;
const INVOICE_RE = /invoice[\s_-]+(\d{4,6})/i;
const SIGNED_PI_RE = /\bPI[\s_]/i;
const SIGNED_PI_RE2 = /signed[\s_-]*PI/i;
const COMMERCIAL_RE = /^IV\b|\bIV[\s_]PO\b/i;
const PART_RE = /(\d)\s*of\s*(\d)/i;

// Same charset/traversal policy as files.js sanitizeName, but REJECTING
// (never rewriting) — this slug must exactly match an existing inbox
// directory name, so a slug containing / \ or .. must never reach fs.
function safeSlug(raw) {
  const s = (raw || '').toString().trim();
  if (!s || s.length > 150) return null;
  if (/[\\/]/.test(s) || s.includes('..') || s.startsWith('.')) return null;
  if (!/^[A-Za-z0-9 ._()\-\[\]]+$/.test(s)) return null;
  return s;
}

// ---- human decision overlay (skip/flag/assign, survives re-scans) --------
const DECISION_KINDS = ['skip', 'flag', 'assign'];
const decisionsFile = slug => path.join(INBOX, slug, '.decisions.json');

function loadDecisions(slug) {
  const d = U.safeJson(decisionsFile(slug));
  return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}

// decision === null clears any existing entry for that order. orderId isn't
// filesystem-derived here (it's a JSON object key) but IS used as a raw
// object key, so __proto__/constructor/prototype are rejected — writing
// those would silently reassign map's prototype instead of adding an own
// property, making the save a no-op that still reports ok:true.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function saveDecision(slug, orderId, decision, note, assignee) {
  if (!orderId || UNSAFE_KEYS.has(orderId)) return { error: 'orderId required' };
  if (decision !== null && !DECISION_KINDS.includes(decision)) return { error: 'bad decision kind' };
  const map = loadDecisions(slug);
  if (decision === null) delete map[orderId];
  else map[orderId] = { decision, note: (note || '').toString().slice(0, 500), assignee: (assignee || '').toString().slice(0, 100), at: new Date().toISOString() };
  // tmp + rename (not a direct writeFileSync) — same pattern as tasks.js/
  // settings.js/projects.js — so a crash or AV lock mid-write can never leave
  // .decisions.json truncated. A torn file would JSON.parse-fail on the next
  // load, loadDecisions() would silently fall back to {}, and the next save
  // would then permanently discard every other order's decision in this
  // project — exactly the "must survive a re-scan" guarantee this exists for.
  try {
    const file = decisionsFile(slug), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { return { error: e.message }; }
  return { ok: true, record: map[orderId] || null };
}

// ---- "uploaded to database" overlay (pure metadata tracking) --------------
// Tracks which converted CSVs a human has manually uploaded into the
// downstream database (Entos OS / Supabase -- out of scope for this project;
// nothing here talks to those systems, this just remembers a checkbox state).
// Mirrors the decision overlay above exactly: same tmp+rename write safety,
// same UNSAFE_KEYS guard, same sidecar-dotfile approach, so it survives a
// re-scan/SharePoint re-pull the same way decisions do.
const uploadsFile = slug => path.join(INBOX, slug, '.uploads.json');

function loadUploads(slug) {
  const d = U.safeJson(uploadsFile(slug));
  return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}

function saveUpload(slug, orderId, uploaded) {
  if (!orderId || UNSAFE_KEYS.has(orderId)) return { error: 'orderId required' };
  const map = loadUploads(slug);
  if (uploaded) map[orderId] = { uploaded: true, at: new Date().toISOString() };
  else delete map[orderId];
  try {
    const file = uploadsFile(slug), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { return { error: e.message }; }
  return { ok: true, record: map[orderId] || null };
}

function isSupport(name) {
  const lower = name.toLowerCase();
  if (lower === 'manifest.csv') return true;
  if (lower.endsWith('.csv') && lower.includes('template')) return true;
  return /\.(md|js|json)$/i.test(lower);
}

function classifyPdf(name) {
  const m = INVOICE_RE.exec(name);
  if (!m) return null;
  let kind = 'unknown';
  if (SIGNED_PI_RE.test(name) || SIGNED_PI_RE2.test(name)) kind = 'signed-pi';
  else if (COMMERCIAL_RE.test(name)) kind = 'commercial-invoice';
  const pm = PART_RE.exec(name);
  return { orderId: m[1], kind, part: pm ? `${pm[1]}of${pm[2]}` : null };
}

// manifest.csv is a fixed-shape export (no embedded commas in the columns we
// read), so a plain split is fine. Header column naming has drifted across
// generators -- build.js (the real, in-use one, see vpp-historical-import-test)
// emits 'order_invoice', not the bare 'order' this originally only looked
// for, which silently made this function return null (no manifest override
// ever active) for every project using that script. Accept either.
function parseManifest(dir) {
  const text = U.safeRead(path.join(dir, 'manifest.csv'));
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const orderIdx = header.indexOf('order') !== -1 ? header.indexOf('order') : header.indexOf('order_invoice');
  const docIdx = header.indexOf('source_doc');
  if (orderIdx === -1 || docIdx === -1) return null;
  const map = {}; // orderId -> confirmed source_doc filename
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const orderId = (cols[orderIdx] || '').trim();
    const doc = (cols[docIdx] || '').trim();
    if (orderId && doc) map[orderId] = doc;
  }
  return Object.keys(map).length ? map : null;
}

// ---- SharePoint year-folder attribution ------------------------------------
// The pairing panel's year filter needs to know which SharePoint
// `Orders VPP/Closed Order History/<year>/` folder an order's PDFs actually
// came from -- SharePoint buckets by paid/closed date, NOT by the PI's own
// printed order_date (confirmed 2026-07-30: order 22610's PI is dated Aug
// 2025 but lives under SharePoint's 2026 folder). Cross-reference against the
// full-tenant index (data/sharepoint-index.json, built by lib/sharepoint.js's
// buildIndex()) by basename instead of trusting any date parsed out of a CSV.
//
// Cache keyed by the index file's mtime -- mirrors lib/sharepoint.js's own
// idxCache/loadIndex() pattern exactly. This file is ~2.5MB and pairProject()
// runs on every pairing panel load/refresh (no cache of its own), so
// re-parsing it every call would be wasteful; a stat() is cheap, JSON.parse
// of megabytes is not.
let spYearCache = { mtimeMs: -1, map: null };
const SP_YEAR_FOLDER_RE = /Orders VPP\/Closed Order History\/(\d{4})\//i;
// Match key: lowercased basename with every non-alphanumeric character
// stripped (spaces, underscores, &, ., -, parens, ...). A plain lowercased
// basename is too brittle in practice -- confirmed on the real data, e.g.
// order 22443's SharePoint copy is "Signed_PI 006435_Invoice_22443.pdf"
// (space) vs the local file "Signed_PI_006435_Invoice_22443.pdf" (underscore
// in the same spot), and order 22613's SharePoint copy uses "&" ("...Valves
// & Plastic Seats...") where the local copy has "_" (sharepoint.js's own
// pull() sanitizeSeg() replaces disallowed characters with "_" when saving
// to the inbox, and separately some files were retyped with a different
// separator). Stripping to bare alphanumerics collapses all of these
// cosmetic differences while still requiring every other character
// (invoice #, order #, words) to match exactly, so it stays a precise
// same-file match, not a fuzzy/substring one.
const alnumKey = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function loadSpYearMap() {
  let st;
  try { st = fs.statSync(SP_INDEX_FILE); } catch { spYearCache = { mtimeMs: -1, map: null }; return new Map(); }
  if (st.mtimeMs === spYearCache.mtimeMs && spYearCache.map) return spYearCache.map;
  const map = new Map();
  // Fail open: a missing/unparseable/malformed index must never block or
  // change pairing state -- this is a best-effort UI label, not a data
  // dependency. safeJson() already swallows a parse error and returns null.
  const idx = U.safeJson(SP_INDEX_FILE);
  if (idx && typeof idx === 'object') {
    for (const s of idx.sites || []) {
      for (const d of (s && s.drives) || []) {
        for (const f of (d && d.files) || []) {
          const p = f && f.p;
          if (typeof p !== 'string') continue;
          const m = SP_YEAR_FOLDER_RE.exec(p);
          if (!m) continue;
          const slash = p.lastIndexOf('/');
          const base = alnumKey(slash >= 0 ? p.slice(slash + 1) : p);
          if (base && !map.has(base)) map.set(base, +m[1]);
        }
      }
    }
  }
  spYearCache = { mtimeMs: st.mtimeMs, map };
  return map;
}
// Given one order's local PDF filenames, return the year of the SharePoint
// `Closed Order History/<year>/` folder the first-matching one lives under,
// or null if none of them are in the index yet (e.g. not pulled/indexed, or
// order is entirely local-only). Works for pdf-only orders too (no CSV
// needed) -- a strict improvement over the old CSV-date approach, where
// pdf-only orders always showed year:null and appeared under every filter.
function sharepointYearFor(pdfNames) {
  const map = loadSpYearMap();
  for (const name of pdfNames || []) {
    const year = map.get(alnumKey(name));
    if (year) return year;
  }
  return null;
}

// Best-effort DISPLAY date for an order, read from its own CSV's order_date
// column (row 1) -- the hub's own generated output, same trust level as
// reading manifest.csv above, not a new category of "open the source PDF"
// risk. This is the PI's own printed date (e.g. "Jul. 24, 2024"), shown to
// the user as-is; it is NOT used to bucket by SharePoint year anymore (see
// sharepointYearFor() above) since that assumption was wrong -- SharePoint's
// year folders are paid/closed-date buckets, not PI-date buckets. Never
// blocks/changes pairing state on a miss. orderId already includes any
// `-<digits>` multi-part suffix (CSV_RE's capture group keeps it, e.g.
// "22610-2"), which reconstructs the right filename here since that's
// exactly what build.js named the CSV.
const MONTHS3 = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
// Quote-aware split -- `description` (an earlier column than order_date)
// routinely contains a comma ("PR 5/16 BRASS PLATED CLOSET, BOLTS"), which
// csvCell() wraps in quotes; a plain .split(',') would then misalign every
// column after it, including order_date, and silently read the wrong field.
function splitCsvRow(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function csvOrderDate(dir, orderId) {
  const text = U.safeRead(path.join(dir, `order-${orderId}.csv`));
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(l => l.length);
  if (lines.length < 2) return null;
  const header = splitCsvRow(lines[0]);
  const idx = header.indexOf('order_date');
  if (idx === -1) return null;
  const raw = (splitCsvRow(lines[1])[idx] || '').trim();
  if (!raw) return null;
  let m = /([A-Za-z]{3,})\.?\s+\d{1,2},?\s+(\d{4})/.exec(raw); // "Jul. 24, 2024"
  if (m && MONTHS3[m[1].slice(0, 3).toLowerCase()]) return m[0];
  m = /^\d{1,2}\/\d{1,2}\/(\d{2,4})$/.exec(raw); // "7/8/25" or "12/16/2024"
  if (m) return m[0];
  return null;
}

// Choose the authoritative PDF for one order's PDF set (order already has
// >=1 PDF at the call site). Returns { name, note } or { error } (review).
function pickAuthoritative(orderId, pdfs, manifestMap) {
  if (manifestMap && manifestMap[orderId]) {
    const confirmed = pdfs.find(p => p.name.toLowerCase() === manifestMap[orderId].toLowerCase());
    if (confirmed) {
      const others = pdfs.filter(p => p !== confirmed);
      let note = 'authoritative PDF confirmed by manifest.csv';
      if (others.length) note += `; ${others.map(o => `${o.name} (${o.kind}) noted as reference`).join(', ')}`;
      return { name: confirmed.name, note };
    }
    return { error: `manifest.csv names "${manifestMap[orderId]}" as the source doc for order ${orderId}, but no matching PDF is present (have: ${pdfs.map(p => p.name).join(', ')})` };
  }

  if (pdfs.length === 1) return { name: pdfs[0].name, note: '' };

  const signed = pdfs.filter(p => p.kind === 'signed-pi');
  const commercial = pdfs.filter(p => p.kind === 'commercial-invoice');
  if (signed.length === 1 && signed.length + commercial.length === pdfs.length) {
    const note = commercial.length ? `${commercial.map(c => c.name).join(', ')} noted as reference (commercial invoice)` : '';
    return { name: signed[0].name, note };
  }

  // A complete, non-duplicated part set (e.g. "1of2" + "2of2") for the same
  // kind is a legitimate multi-file PI, not ambiguity — pick the first part
  // as authoritative and note the rest as additional parts.
  const parts = pdfs.map(p => p.part).filter(Boolean);
  const uniqueParts = new Set(parts);
  if (parts.length === pdfs.length && uniqueParts.size === pdfs.length && pdfs.every(p => p.kind === pdfs[0].kind)) {
    const sorted = pdfs.slice().sort((a, b) => a.part.localeCompare(b.part));
    const rest = sorted.slice(1);
    return { name: sorted[0].name, note: `multi-part PI set (${sorted.map(p => p.part).join(', ')}); ${rest.map(r => r.name).join(', ')} noted as additional part(s)` };
  }

  // Genuinely ambiguous: 2+ PDFs for one order that aren't resolved by a
  // manifest, a single signed PI, or a valid multi-part set. These are real
  // duplicates — the caller must not silently pick one and pair it to the
  // CSV, so flag dup:true and let pairProject() surface it on the row.
  return { error: `${pdfs.length} PDFs for order ${orderId} with no clear authority (${pdfs.map(p => `${p.name} [${p.kind}${p.part ? ', ' + p.part : ''}]`).join('; ')})`, dup: true };
}

// withYear: pairSummary() (the grid-tile badge, polled on every Projects
// list load) never reads the year field -- skip the extra per-order CSV
// read there so that bounded, frequently-called route doesn't pay for data
// only the full detail-view pairing panel actually uses.
function pairProject(slug, { withYear = true } = {}) {
  const dir = path.join(INBOX, slug);
  const manifestMap = parseManifest(dir);
  // reverse index: confirmed source_doc filename -> the order it belongs to,
  // used to resolve orders manifest-only regex cannot (e.g. "1of2" -> 22610,
  // "2of2" -> 22610-2, where both filenames regex-infer the same base id).
  const manifestByFile = {};
  if (manifestMap) for (const [orderId, doc] of Object.entries(manifestMap)) manifestByFile[doc.toLowerCase()] = orderId;

  // Object.create(null) -- orders is keyed by attacker/data-controlled ids
  // (a CSV filename's own text, or a manifest.csv column value, now that
  // both accept alphanumeric ids, not just digits). A plain {} lets an id
  // like "constructor" or "toString" read the inherited Object.prototype
  // member instead of creating a bucket, so `.csvs.push` throws and takes
  // down the whole /api/projects/pairs response. Same class of bug the
  // decision overlay's UNSAFE_KEYS guard (above) exists for.
  const orders = Object.create(null);
  const bucket = id => orders[id] || (orders[id] = { pdfs: [], csvs: [] });
  const support = [];
  const unparsed = [];

  for (const e of U.listDir(dir)) {
    // Dotfiles are this module's own overlay sidecars (.decisions.json,
    // .uploads.json) plus lib/projects.js's .pinned.json, all living in the
    // same folder — isSupport()'s /\.json$/ match would otherwise count them
    // as "support files" and list them in the panel's hover tooltip.
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const name = e.name;
    if (isSupport(name)) { support.push(name); continue; }
    if (/\.csv$/i.test(name)) {
      const m = CSV_RE.exec(name);
      if (m) { bucket(m[1]).csvs.push(name); continue; }
      unparsed.push(name); continue;
    }
    if (/\.pdf$/i.test(name)) {
      const info = classifyPdf(name);
      // manifest.csv is checked FIRST regardless of classifyPdf's own regex --
      // a source doc explicitly named there (build.js's authoritative record
      // of what it actually converted) must bucket correctly even when its
      // filename doesn't look like the usual "Invoice <digits>" pattern (e.g.
      // "...June Re-Order.pdf" has no "Invoice" in it at all, and an IV-style
      // commercial-invoice filename for an alphanumeric order id like SPL002
      // doesn't match INVOICE_RE's digits-only capture either).
      const manifestOrderId = manifestByFile[name.toLowerCase()];
      if (info || manifestOrderId) {
        const orderId = manifestOrderId || info.orderId;
        bucket(orderId).pdfs.push({ name, kind: info ? info.kind : 'unknown', part: info ? info.part : null });
        continue;
      }
      unparsed.push(name); continue;
    }
    unparsed.push(name);
  }

  const orderList = Object.keys(orders).sort().map(orderId => {
    const { pdfs, csvs } = orders[orderId];
    let state, authoritativePdf = null, note = '', dup = false, duplicates;
    if (csvs.length > 1) {
      state = 'review';
      note = `multiple CSVs for order ${orderId}: ${csvs.join(', ')}`;
    } else if (!pdfs.length) {
      state = 'csv-only';
    } else {
      const picked = pickAuthoritative(orderId, pdfs, manifestMap);
      if (picked.error) {
        state = 'review'; note = picked.error;
        // pickAuthoritative flags genuine duplicates (2+ unresolvable PDFs for
        // one order). Surface every contesting filename so the UI can render a
        // review row instead of silently pairing one to the CSV.
        if (picked.dup) { dup = true; duplicates = pdfs.map(p => p.name); }
      } else { authoritativePdf = picked.name; note = picked.note || ''; state = csvs.length ? 'complete' : 'pdf-only'; }
    }
    // Gated by withYear too, same as orderDate below — pairSummary() (line
    // ~420, withYear:false) still never reads o.year, so it shouldn't pay for
    // the SharePoint index lookup either (mtime-cached, so the real cost is
    // small, but there's no reason to pay it at all on that bounded route).
    const year = (withYear && pdfs.length) ? sharepointYearFor(pdfs.map(p => p.name)) : null;
    const orderDate = (withYear && csvs.length) ? csvOrderDate(dir, orderId) : null;
    return { orderId, state, pdfs, csvs, authoritativePdf, note, dup, duplicates, year, orderDate };
  });

  // Overlay human decisions last, ON TOP of the computed state — a decision
  // never changes what the scan found (pdfs/csvs/authoritativePdf stay
  // accurate), it just annotates the row so the UI can show/filter it
  // distinctly and it survives the next re-scan untouched.
  const decisions = loadDecisions(slug);
  for (const o of orderList) {
    const dec = decisions[o.orderId];
    if (dec) { o.decision = dec.decision; o.decisionNote = dec.note; o.decisionAssignee = dec.assignee; o.decisionAt = dec.at; }
  }

  // Overlay "uploaded to database" state the same way -- pure metadata, never
  // changes the computed scan, just annotates the row.
  const uploads = loadUploads(slug);
  for (const o of orderList) {
    const u = uploads[o.orderId];
    o.uploaded = !!(u && u.uploaded);
    o.uploadedAt = (u && u.at) || null;
  }

  return { slug, dir: path.join(INBOX, slug), orders: orderList, support, unparsed };
}

// Grid-level counts for a project tile, without shipping the whole order list.
// BOUNDED: pairProject re-scans the folder on every call (no cache), so a caller
// that runs this per-project on a list route must cap it — callers pass the file
// count and skip large folders. Returns null when there are no order rows.
function pairSummary(slug) {
  const { orders } = pairProject(slug, { withYear: false });
  if (!orders.length) return null;
  const s = { complete: 0, pdfOnly: 0, csvOnly: 0, review: 0, dups: 0 };
  for (const o of orders) {
    if (o.state === 'complete') s.complete++;
    else if (o.state === 'pdf-only') s.pdfOnly++;
    else if (o.state === 'csv-only') s.csvOnly++;
    else if (o.state === 'review') s.review++;
    if (o.dup) s.dups++;
  }
  return s;
}

async function handle(req, res, url) {
  if (url.pathname === '/api/projects/pairs' && req.method === 'GET') {
    const slug = safeSlug(url.searchParams.get('slug') || '');
    if (!slug) { U.sendJson(res, { error: 'invalid slug' }, 404); return true; }
    let st; try { st = fs.statSync(path.join(INBOX, slug)); } catch { st = null; }
    if (!st || !st.isDirectory()) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    U.sendJson(res, pairProject(slug));
    return true;
  }
  if (url.pathname === '/api/projects/pairs/decision' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const slug = safeSlug((b.slug || '').toString());
    if (!slug) { U.sendJson(res, { error: 'invalid slug' }, 404); return true; }
    let st; try { st = fs.statSync(path.join(INBOX, slug)); } catch { st = null; }
    if (!st || !st.isDirectory()) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const orderId = (b.orderId || '').toString().trim().slice(0, 60);
    const decision = b.decision === null ? null : (b.decision || '').toString();
    const r = saveDecision(slug, orderId, decision, b.note, b.assignee);
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (url.pathname === '/api/projects/pairs/upload' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const slug = safeSlug((b.slug || '').toString());
    if (!slug) { U.sendJson(res, { error: 'invalid slug' }, 404); return true; }
    let st; try { st = fs.statSync(path.join(INBOX, slug)); } catch { st = null; }
    if (!st || !st.isDirectory()) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const orderId = (b.orderId || '').toString().trim().slice(0, 60);
    const uploaded = b.uploaded === true;
    const r = saveUpload(slug, orderId, uploaded);
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  return false;
}

module.exports = { handle, pairProject, pairSummary };
