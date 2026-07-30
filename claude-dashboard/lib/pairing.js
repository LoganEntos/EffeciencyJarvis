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

// Extraction patterns (derived from the real VPP historical-import files —
// see data/inbox/vpp-historical-import-test/ for the canonical examples).
const CSV_RE = /^order-(\d+(?:-\d+)?)\.csv$/i;
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
// read), so a plain split is fine — see header: order,invoice,po,source_doc,...
function parseManifest(dir) {
  const text = U.safeRead(path.join(dir, 'manifest.csv'));
  if (!text) return null;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const orderIdx = header.indexOf('order');
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

function pairProject(slug) {
  const dir = path.join(INBOX, slug);
  const manifestMap = parseManifest(dir);
  // reverse index: confirmed source_doc filename -> the order it belongs to,
  // used to resolve orders manifest-only regex cannot (e.g. "1of2" -> 22610,
  // "2of2" -> 22610-2, where both filenames regex-infer the same base id).
  const manifestByFile = {};
  if (manifestMap) for (const [orderId, doc] of Object.entries(manifestMap)) manifestByFile[doc.toLowerCase()] = orderId;

  const orders = {};
  const bucket = id => orders[id] || (orders[id] = { pdfs: [], csvs: [] });
  const support = [];
  const unparsed = [];

  for (const e of U.listDir(dir)) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (isSupport(name)) { support.push(name); continue; }
    if (/\.csv$/i.test(name)) {
      const m = CSV_RE.exec(name);
      if (m) { bucket(m[1]).csvs.push(name); continue; }
      unparsed.push(name); continue;
    }
    if (/\.pdf$/i.test(name)) {
      const info = classifyPdf(name);
      if (info) {
        const orderId = manifestByFile[name.toLowerCase()] || info.orderId;
        bucket(orderId).pdfs.push({ name, kind: info.kind, part: info.part });
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
    return { orderId, state, pdfs, csvs, authoritativePdf, note, dup, duplicates };
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

  return { slug, dir: path.join(INBOX, slug), orders: orderList, support, unparsed };
}

// Grid-level counts for a project tile, without shipping the whole order list.
// BOUNDED: pairProject re-scans the folder on every call (no cache), so a caller
// that runs this per-project on a list route must cap it — callers pass the file
// count and skip large folders. Returns null when there are no order rows.
function pairSummary(slug) {
  const { orders } = pairProject(slug);
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
  return false;
}

module.exports = { handle, pairProject, pairSummary };
