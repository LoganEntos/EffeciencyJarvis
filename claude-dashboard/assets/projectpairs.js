/* Projects → detail view: File pairing panel. Matches uploaded PDFs (signed
   PI / commercial invoice) to their converted CSV exports, per order, so it's
   obvious at a glance what's ready, what's PDF-only (needs a convert run),
   what's CSV-only, and what needs a human look. Data comes from the slug-
   scoped GET /api/projects/pairs. Reuses the shared file preview
   (files.js openFilePreview) and "Process with Claude" prefill (run.js
   prefillRun) — no parallel mechanism built here. Split out of
   projectdetail.js to keep that file under the 500-line cap; exposes one
   global, renderPairingPanel(slug, containerEl), called from there. */
'use strict';

const PP_RANK = { review: 0, 'pdf-only': 1, 'csv-only': 2, complete: 3 };
const PP_TONE = { complete: 'ok', 'pdf-only': 'warn', 'csv-only': 'cool', review: 'err' };

// Entry point — loads (or reloads) the panel into containerEl.
function renderPairingPanel(slug, containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '<div class="muted">Loading pairing…</div>';
  ppFetch(slug, containerEl);
}

async function ppFetch(slug, containerEl) {
  let d;
  try { d = await api('/api/projects/pairs?slug=' + encodeURIComponent(slug)); }
  catch { ppShowMsg(slug, containerEl, 'Pairing unavailable.'); return; }
  if (!d || d.error) { ppShowMsg(slug, containerEl, 'Pairing unavailable.'); return; }
  ppRender(slug, containerEl, d);
}

function ppShowMsg(slug, containerEl, msg) {
  containerEl.innerHTML = ppShell(`<div class="muted">${esc(msg)}</div>`);
  ppWireRefresh(slug, containerEl);
}

function ppShell(inner) {
  return `<div class="flex" style="justify-content:flex-end;margin-bottom:6px">
    <button type="button" id="ppRefresh" class="ghost" style="padding:4px 10px;font-size:11px">↻ refresh</button></div>${inner}`;
}
function ppWireRefresh(slug, containerEl) {
  const b = containerEl.querySelector('#ppRefresh');
  if (b) b.onclick = () => renderPairingPanel(slug, containerEl);
}

function ppRender(slug, containerEl, d) {
  const orders = Array.isArray(d.orders) ? d.orders.slice() : [];
  const support = Array.isArray(d.support) ? d.support : [];
  const unparsed = Array.isArray(d.unparsed) ? d.unparsed : [];
  if (!orders.length && !support.length && !unparsed.length) {
    ppShowMsg(slug, containerEl, 'No pairable files yet — PDFs and CSVs dropped in this project show up here once matched by order.');
    return;
  }
  orders.sort((a, b) => (PP_RANK[a.state] ?? 9) - (PP_RANK[b.state] ?? 9));
  const dir = typeof d.dir === 'string' ? d.dir : '';
  const table = orders.length
    ? `<table class="hlth-table"><thead><tr><th>Order</th><th>State</th><th>PDF</th><th>CSV</th><th>Note</th><th></th></tr></thead>
      <tbody>${orders.map(o => ppRow(slug, o, dir)).join('')}</tbody></table>`
    : '<div class="muted">No orders matched yet.</div>';
  containerEl.innerHTML = ppShell(
    `<div class="muted" style="font-size:11.5px;margin-bottom:8px">${ppCounts(orders)}</div>${table}${ppExtraLine(support, unparsed)}`
  );
  ppWireRefresh(slug, containerEl);
  ppWireRows(slug, containerEl);
}

function ppCounts(orders) {
  const c = { complete: 0, 'pdf-only': 0, 'csv-only': 0, review: 0 };
  orders.forEach(o => { if (c[o.state] !== undefined) c[o.state]++; });
  return `${c.complete} complete &middot; ${c['pdf-only']} pdf-only &middot; ${c['csv-only']} csv-only &middot; ${c.review} review`;
}

// One clickable file reference — a native <button> styled inline as a link
// (matches the pDelFile/pDelMem convention in projectdetail.js) so it needs
// no CLICKABLE_SEL entry and no new CSS class. data-open carries the
// inbox-relative "<slug>/<name>" path openFilePreview expects.
function ppLink(slug, name, tag) {
  const full = slug + '/' + name;
  return `<div><button type="button" class="mono" data-open="${esc(full)}" title="${esc(name)}"
      style="background:none;border:none;color:var(--accent);cursor:pointer;font-family:var(--font-mono);font-size:11.5px;padding:0;text-align:left;word-break:break-all">${esc(name)}</button>${
    tag ? `<span class="muted" style="font-size:10px;margin-left:5px">${esc(tag)}</span>` : ''
  }</div>`;
}

// Joins the server-supplied absolute inbox dir (mirrors files.js statEntry's
// `path` field) with a filename using a forward slash — Windows accepts
// forward slashes in paths too, so this stays a single well-formed absolute
// path the Claude CLI (cwd = repo root) can actually resolve, unlike the old
// hand-rolled 'data/inbox/' + relative-path prefix.
function ppAbsPath(dir, name) {
  return dir ? dir.replace(/[\\/]+$/, '') + '/' + name : name;
}

function ppRow(slug, o, dir) {
  const tone = PP_TONE[o.state] || 'neutral';
  const pdfs = (o.pdfs || []).map(pf => {
    const tag = pf.name === o.authoritativePdf ? 'authoritative' : (pf.kind === 'commercial-invoice' ? 'reference' : '');
    return ppLink(slug, pf.name, tag);
  }).join('') || '<span class="muted">—</span>';
  const csvs = (o.csvs || []).map(n => ppLink(slug, n)).join('') || '<span class="muted">—</span>';
  const pdfPaths = (o.pdfs || []).map(pf => ppAbsPath(dir, pf.name)).join('|');
  const convertBtn = o.state === 'pdf-only' && (o.pdfs || []).length
    ? `<button type="button" class="ghost pp-convert" data-pdfs="${esc(pdfPaths)}" style="padding:4px 10px;font-size:11px;white-space:nowrap">&#9655; convert</button>`
    : '';
  return `<tr>
    <td class="mono">${esc(o.orderId)}</td>
    <td><span class="pill ${tone}">${esc(o.state)}</span></td>
    <td>${pdfs}</td>
    <td>${csvs}</td>
    <td class="muted" style="font-size:11.5px">${o.note ? esc(o.note) : ''}</td>
    <td style="text-align:right">${convertBtn}</td>
  </tr>`;
}

// support/unparsed: one muted summary line, full names on title-hover — not
// a table, per the panel spec (they're not order-pairable, just visible).
function ppExtraLine(support, unparsed) {
  if (!support.length && !unparsed.length) return '';
  const parts = [];
  if (support.length) parts.push(`<span title="${esc(support.join(', '))}">${support.length} support file${support.length === 1 ? '' : 's'}</span>`);
  if (unparsed.length) parts.push(`<span title="${esc(unparsed.join(', '))}">${unparsed.length} unparsed</span>`);
  return `<div class="muted" style="font-size:11px;margin-top:10px">${parts.join(' &middot; ')}</div>`;
}

function ppWireRows(slug, containerEl) {
  containerEl.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    if (typeof openFilePreview === 'function') openFilePreview(b.dataset.open);
  });
  // Same mechanism as the Files tab's "Process with Claude" (files.js
  // procBtn) — prefillRun() pre-fills and switches to the Run tab.
  containerEl.querySelectorAll('.pp-convert').forEach(b => b.onclick = () => {
    // data-pdfs already holds server-supplied absolute paths (see ppAbsPath) —
    // no client-side prefix needed.
    const paths = (b.dataset.pdfs || '').split('|').filter(Boolean);
    if (!paths.length || typeof prefillRun !== 'function') return;
    prefillRun(`Process the PDF${paths.length > 1 ? 's' : ''} at ${paths.join(', ')} — convert to CSV, matching the paired commercial invoice format if present — `);
  });
}
