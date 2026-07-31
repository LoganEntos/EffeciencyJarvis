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
// Human decision overlay (architect proposal 2026-07-30, Option A — sidecar
// manifest, server side: lib/pairing.js .decisions.json). A decision never
// changes the computed state; it's an annotation that survives a re-scan.
const PP_DEC_TONE = { skip: 'neutral', flag: 'err', assign: 'accent' };
const PP_DEC_LABEL = { skip: '⊘ skip', flag: '⚑ flag', assign: '◐ assign' };

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

// Step 7 "organize" (safe half — see data/todos/projects.md): once a project
// has run for a while, `complete` orders pile up and dominate a table nobody
// needs to re-check. Rather than move files anywhere (the destructive half,
// "archive/delete-all", stays undesigned — nothing pins down exactly what it
// should delete, so it's not built here), split them into a collapsed-by-
// default group, same pattern as the Run tab's history <details> (run.js).
function ppTableHtml(slug, orders, dir) {
  return `<table class="hlth-table"><thead><tr><th>Order</th><th>State</th><th>PDF</th><th>CSV</th><th>Note</th><th></th></tr></thead>
    <tbody>${orders.map(o => ppRow(slug, o, dir) + ppDecideFormRow(slug, o)).join('')}</tbody></table>`;
}

// Selected year filter per project (module-level, mirrors PSP's per-project
// state in projectsp.js) -- survives the panel's own re-renders (refresh
// button, decision saves) but resets to "all years" on a fresh page load,
// same as every other in-panel filter in this app.
const PP_YEAR = {};

// SharePoint's own VPP archive is organized /<year>/<order folder>/ (see
// lib/sharepoint.js's indexed path, or CHRONOLOGICAL-INDEX.md in the project
// folder) -- naming the filter the same way ("2026 — Closed Order History")
// instead of a bare year makes it obvious which SharePoint source folder a
// batch of converted orders traces back to, not just a number.
const PP_DIR_LABEL = 'Closed Order History';

function ppRender(slug, containerEl, d) {
  const allOrders = Array.isArray(d.orders) ? d.orders.slice() : [];
  const support = Array.isArray(d.support) ? d.support : [];
  const unparsed = Array.isArray(d.unparsed) ? d.unparsed : [];
  if (!allOrders.length && !support.length && !unparsed.length) {
    ppShowMsg(slug, containerEl, 'No pairable files yet — PDFs and CSVs dropped in this project show up here once matched by order.');
    return;
  }
  // Years come from each order's own CSV (order_date, read server-side —
  // lib/pairing.js's csvOrderYear); an order with no CSV yet (pdf-only) or
  // an unrecognized date format has no year and always shows regardless of
  // the filter, so nothing silently disappears from view.
  const years = [...new Set(allOrders.map(o => o.year).filter(Boolean))].sort((a, b) => b - a);
  if (PP_YEAR[slug] && !years.includes(PP_YEAR[slug])) PP_YEAR[slug] = null;
  const selYear = PP_YEAR[slug] || null;
  const orders = selYear ? allOrders.filter(o => o.year === selYear || o.year == null) : allOrders;

  const yearPicker = years.length > 1 ? `<div class="flex" style="gap:8px;align-items:center;margin-bottom:8px">
    <span class="muted" style="font-size:11px">SharePoint source</span>
    <select id="ppYearSel" style="margin:0;width:auto;font-size:12px">
      <option value=""${selYear ? '' : ' selected'}>All years (${allOrders.length} orders)</option>
      ${years.map(y => `<option value="${y}"${y === selYear ? ' selected' : ''}>${y} — ${esc(PP_DIR_LABEL)} (${allOrders.filter(o => o.year === y).length})</option>`).join('')}
    </select>
  </div>` : '';

  orders.sort((a, b) => (PP_RANK[a.state] ?? 9) - (PP_RANK[b.state] ?? 9));
  const dir = typeof d.dir === 'string' ? d.dir : '';
  const active = orders.filter(o => o.state !== 'complete');
  const done = orders.filter(o => o.state === 'complete');
  // Keyed per-project (unlike the Run tab's single global history toggle,
  // which is legitimate there since there's exactly one Run history in the
  // whole app) — this panel is instantiated per-slug, so a global key would
  // leak one project's expanded state into every other project's panel.
  const doneOpenKey = 'hub.ppDoneOpen.' + slug;
  let open = false;
  try { open = localStorage.getItem(doneOpenKey) === '1'; } catch {}
  const table = active.length ? ppTableHtml(slug, active, dir)
    : (done.length ? '<div class="muted">Every matched order is complete — see below.</div>' : '<div class="muted">No orders matched yet.</div>');
  const doneLabel = `${done.length} complete order${done.length === 1 ? '' : 's'}${selYear ? ` — ${selYear} · ${PP_DIR_LABEL}` : ''} — reviewed, nothing left to do`;
  const doneSection = done.length
    ? `<details class="histSection" id="ppDoneSection"${open ? ' open' : ''} style="margin-top:14px">
        <summary>${esc(doneLabel)}</summary>
        <div class="histbody">${ppTableHtml(slug, done, dir)}</div>
      </details>`
    : '';
  containerEl.innerHTML = ppShell(
    `${yearPicker}<div class="muted" style="font-size:11.5px;margin-bottom:8px">${ppCounts(orders)}</div>${table}${doneSection}${ppExtraLine(support, unparsed)}`
  );
  const yearSel = containerEl.querySelector('#ppYearSel');
  if (yearSel) yearSel.onchange = () => { PP_YEAR[slug] = yearSel.value ? +yearSel.value : null; ppRender(slug, containerEl, d); };
  const doneSectionEl = containerEl.querySelector('#ppDoneSection');
  if (doneSectionEl) doneSectionEl.ontoggle = () => { try { localStorage.setItem(doneOpenKey, doneSectionEl.open ? '1' : '0'); } catch {} };
  ppWireRefresh(slug, containerEl);
  ppWireRows(slug, containerEl);
}

function ppCounts(orders) {
  const c = { complete: 0, 'pdf-only': 0, 'csv-only': 0, review: 0 };
  let dups = 0;
  orders.forEach(o => { if (c[o.state] !== undefined) c[o.state]++; if (o.dup) dups++; });
  const base = `${c.complete} complete &middot; ${c['pdf-only']} pdf-only &middot; ${c['csv-only']} csv-only &middot; ${c.review} review`;
  return dups ? `${base} &middot; <span style="color:var(--err,#e05b4f)">${dups} duplicate</span>` : base;
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
  // Duplicate flag (server: pairing.js sets dup:true + duplicates:[names] when
  // 2+ PDFs claim one order id with no clear authority). Make it unmistakably a
  // review row — a distinct badge in the State cell — rather than a plain pair.
  // Guard on the field so the older response shape just renders a normal row.
  const dupBadge = o.dup
    ? `<span class="pill err" style="margin-left:4px" title="${esc((o.duplicates || []).join(', '))}">⚠ ${(o.duplicates || o.pdfs || []).length} PDFs claim this order</span>`
    : '';
  // Decision badge — a human judgment call (skip/flag/assign) that persisted
  // across the last re-scan (lib/pairing.js overlays it onto the computed
  // row). Note/assignee shown as hover-title so the row stays compact.
  const decBadge = o.decision
    ? `<span class="pill ${PP_DEC_TONE[o.decision] || 'neutral'}" style="margin-left:4px" title="${esc([o.decisionAssignee ? 'assignee: ' + o.decisionAssignee : '', o.decisionNote || ''].filter(Boolean).join(' — '))}">${PP_DEC_LABEL[o.decision] || o.decision}${o.decisionAssignee ? ': ' + esc(o.decisionAssignee) : ''}</span>`
    : '';
  const decideBtn = `<button type="button" class="ghost pp-decide-toggle" data-order="${esc(o.orderId)}"
      aria-expanded="false" aria-controls="ppdec-${esc(o.orderId)}" style="padding:4px 10px;font-size:11px;white-space:nowrap">${o.decision ? 'edit' : 'decide'}</button>`;
  return `<tr${o.dup ? ' class="pp-dup"' : ''}>
    <td class="mono">${esc(o.orderId)}</td>
    <td><span class="pill ${tone}">${esc(o.state)}</span>${dupBadge}${decBadge}</td>
    <td>${pdfs}</td>
    <td>${csvs}</td>
    <td class="muted" style="font-size:11.5px">${o.note ? esc(o.note) : ''}</td>
    <td style="text-align:right;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">${convertBtn}${decideBtn}</td>
  </tr>`;
}

// Hidden-by-default inline form row (toggled by the "decide"/"edit" button in
// ppRow) — set/change/clear a decision for one order. Mirrors the plain
// input+button convention used for project notes (projectdetail.js #pNote),
// not a modal — this codebase has no modal component and one isn't worth
// building for a 3-field form.
function ppDecideFormRow(slug, o) {
  const cur = o.decision || '';
  return `<tr class="pp-decide-row hidden" id="ppdec-${esc(o.orderId)}"><td colspan="6">
    <div class="flex" style="gap:8px;flex-wrap:wrap;align-items:center;padding:6px 0">
      <label class="muted" style="font-size:11px" for="ppdk-${esc(o.orderId)}">Decision</label>
      <select id="ppdk-${esc(o.orderId)}" style="width:auto;min-width:110px">
        <option value="skip"${cur === 'skip' ? ' selected' : ''}>⊘ skip</option>
        <option value="flag"${cur === 'flag' ? ' selected' : ''}>⚑ flag</option>
        <option value="assign"${cur === 'assign' ? ' selected' : ''}>◐ assign</option>
      </select>
      <input class="search pp-dec-assignee" id="ppda-${esc(o.orderId)}" placeholder="assignee" value="${esc(o.decisionAssignee || '')}"
        style="width:auto;max-width:140px;margin:0;${cur === 'assign' ? '' : 'display:none'}">
      <input class="search" id="ppdn-${esc(o.orderId)}" placeholder="note (optional)" value="${esc(o.decisionNote || '')}" style="width:auto;flex:1;min-width:160px;margin:0">
      <button type="button" class="ghost pp-decide-save" data-order="${esc(o.orderId)}" style="padding:4px 10px;font-size:11px">Save</button>
      ${o.decision ? `<button type="button" class="ghost pp-decide-clear" data-order="${esc(o.orderId)}" style="padding:4px 10px;font-size:11px">Clear</button>` : ''}
      <button type="button" class="ghost pp-decide-cancel" data-order="${esc(o.orderId)}" style="padding:4px 10px;font-size:11px">Cancel</button>
      <span class="muted pp-decide-status" id="ppds-${esc(o.orderId)}" style="font-size:11px"></span>
    </div>
  </td></tr>`;
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
  ppWireDecide(slug, containerEl);
}

// Skip/flag/assign a note on an order (POST /api/projects/pairs/decision,
// lib/pairing.js) — persists to <slug>/.decisions.json server-side, survives
// the next re-scan/SharePoint pull. One inline form per row, toggled open.
function ppWireDecide(slug, containerEl) {
  const closeAll = except => containerEl.querySelectorAll('.pp-decide-row').forEach(r => {
    if (r.id !== except) r.classList.add('hidden');
  });
  containerEl.querySelectorAll('.pp-decide-toggle').forEach(b => b.onclick = () => {
    const row = containerEl.querySelector('#ppdec-' + CSS.escape(b.dataset.order));
    if (!row) return;
    const opening = row.classList.contains('hidden');
    closeAll(opening ? row.id : null);
    row.classList.toggle('hidden', !opening);
    b.setAttribute('aria-expanded', String(opening));
    if (opening) { const sel = row.querySelector('select'); if (sel) sel.focus(); }
  });
  containerEl.querySelectorAll('.pp-decide-cancel').forEach(b => b.onclick = () => {
    const row = containerEl.querySelector('#ppdec-' + CSS.escape(b.dataset.order));
    if (row) row.classList.add('hidden');
  });
  // Kind select toggles the assignee field's visibility live, no round-trip.
  containerEl.querySelectorAll('.pp-decide-row select').forEach(sel => sel.onchange = () => {
    const row = sel.closest('.pp-decide-row');
    const af = row && row.querySelector('.pp-dec-assignee');
    if (af) af.style.display = sel.value === 'assign' ? '' : 'none';
  });
  containerEl.querySelectorAll('.pp-decide-save').forEach(b => b.onclick = async () => {
    const orderId = b.dataset.order;
    const sel = containerEl.querySelector('#ppdk-' + CSS.escape(orderId));
    const noteEl = containerEl.querySelector('#ppdn-' + CSS.escape(orderId));
    const assEl = containerEl.querySelector('#ppda-' + CSS.escape(orderId));
    const statusEl = containerEl.querySelector('#ppds-' + CSS.escape(orderId));
    if (!sel) return;
    b.disabled = true; if (statusEl) statusEl.textContent = 'saving…';
    try {
      const r = await api('/api/projects/pairs/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, orderId, decision: sel.value, note: noteEl ? noteEl.value : '', assignee: assEl ? assEl.value : '' }) });
      if (r && r.error) { if (statusEl) statusEl.textContent = '✗ ' + r.error; b.disabled = false; return; }
      renderPairingPanel(slug, containerEl); // full re-render from the server's overlaid state
    } catch (e) { if (statusEl) statusEl.textContent = '✗ ' + (e.message || 'save failed'); b.disabled = false; }
  });
  containerEl.querySelectorAll('.pp-decide-clear').forEach(b => b.onclick = async () => {
    const orderId = b.dataset.order;
    const statusEl = containerEl.querySelector('#ppds-' + CSS.escape(orderId));
    b.disabled = true; if (statusEl) statusEl.textContent = 'clearing…';
    try {
      const r = await api('/api/projects/pairs/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, orderId, decision: null }) });
      if (r && r.error) { if (statusEl) statusEl.textContent = '✗ ' + r.error; b.disabled = false; return; }
      renderPairingPanel(slug, containerEl);
    } catch (e) { if (statusEl) statusEl.textContent = '✗ ' + (e.message || 'clear failed'); b.disabled = false; }
  });
}
