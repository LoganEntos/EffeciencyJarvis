/* Spreadsheet cell-grid preview for the Files tab. Fetches capped cell values
   (+ resolved fill colours) from /api/files/xlsx/cells and renders a scrollable
   grid with a sheet switcher, so a workbook's verification colour-coding is
   readable without Excel. Split out of files.js to keep it under 500 lines. */
'use strict';

// index → spreadsheet column letters (0→A, 25→Z, 26→AA)
function numToCol(n) {
  let s = '';
  n += 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Relative luminance → pick readable text colour over a pastel/solid fill.
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1a1a1a' : '#f4f1ea';
}

// Build the grid <table> HTML for one sheet payload. Colours are the ONLY
// inline style injected, validated against HEX_RE before touching style=.
function renderSheetGrid(g) {
  if (g.error) return `<span class="pill err">${esc(g.error)}</span>`;
  if (g.note && (!g.rows || !g.rows.length)) return `<span class="pill warn">${esc(g.note)}</span>`;
  const cols = g.shownCols || 0;
  let head = '<th class="sg-rn"></th>';
  for (let c = 0; c < cols; c++) head += `<th>${numToCol(c)}</th>`;
  let bodyHtml = '';
  for (let r = 0; r < g.rows.length; r++) {
    const row = g.rows[r];
    let tds = `<th class="sg-rn">${r + 1}</th>`;
    for (let c = 0; c < cols; c++) {
      const cell = row[c] || { v: '' };
      const v = cell.v == null ? '' : String(cell.v);
      let style = '';
      if (cell.c && HEX_RE.test(cell.c)) style = ` style="background:${cell.c};color:${textOn(cell.c)}"`;
      tds += `<td${style}>${esc(v)}</td>`;
    }
    bodyHtml += `<tr>${tds}</tr>`;
  }
  return `<div class="sheet-gridwrap"><table class="sheet-grid">`
    + `<thead><tr>${head}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

// Truncation / conditional-format notice shown above the grid.
function gridNotice(g) {
  const bits = [];
  if (g.truncated) {
    const rp = g.totalRows && g.totalRows > g.shownRows ? `${g.shownRows} of ${g.totalRows} rows` : `${g.shownRows} rows`;
    const cp = g.totalCols && g.totalCols > g.shownCols ? `, ${g.shownCols} of ${g.totalCols} cols` : '';
    bits.push(`<span class="pill warn">showing first ${rp}${cp}</span>`);
  }
  if (g.conditional) bits.push(`<span class="pill neutral" title="Some cells are coloured by conditional-formatting rules, which aren't evaluated here — static fills are shown.">+ conditional-format colours not shown</span>`);
  return bits.length ? `<div class="badgebar sg-notice">${bits.join('')}</div>` : '';
}

// Orchestrate the whole xlsx preview inside a card body: sheet tabs + grid,
// lazy-loading each sheet once and caching its HTML on the element.
async function renderXlsxPreview(body, name) {
  const meta = await api('/api/files/xlsx?name=' + encodeURIComponent(name));
  if (meta.error) { body.innerHTML = `<span class="pill err">${esc(meta.error)}</span>`; return; }
  const sheets = meta.sheets || [];
  const tabs = sheets.map((s, i) =>
    `<button class="sg-tab${i === 0 ? ' active' : ''}" data-sheet="${i}">${esc(s.name)}</button>`).join('');
  body.innerHTML = `<div class="sg-tabs">${tabs}</div><div class="sg-panel"><div class="muted" style="padding:8px 2px">Loading…</div></div>`;
  const panel = body.querySelector('.sg-panel');
  const cache = {};

  const load = async (idx) => {
    body.querySelectorAll('.sg-tab').forEach(t => t.classList.toggle('active', +t.dataset.sheet === idx));
    if (cache[idx]) { panel.innerHTML = cache[idx]; return; }
    panel.innerHTML = '<div class="muted" style="padding:8px 2px">Loading…</div>';
    let g;
    try { g = await api(`/api/files/xlsx/cells?name=${encodeURIComponent(name)}&sheet=${idx}`); }
    catch (e) { panel.innerHTML = `<span class="pill err">couldn't open: ${esc(e.message || 'error')}</span>`; return; }
    const html = gridNotice(g) + renderSheetGrid(g);
    cache[idx] = html;
    panel.innerHTML = html;
  };

  body.querySelectorAll('.sg-tab').forEach(t => t.onclick = () => load(+t.dataset.sheet));
  // Optional deep-link sheet index (?tab=files&open=<name>&sheet=N).
  let startSheet = 0;
  try {
    const sp = new URLSearchParams(location.search).get('sheet');
    if (sp && /^\d+$/.test(sp)) startSheet = Math.min(+sp, sheets.length - 1);
  } catch {}
  await load(startSheet);
}
