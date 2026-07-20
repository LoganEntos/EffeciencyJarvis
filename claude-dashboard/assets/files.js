/* Files tab: drag-drop upload inbox (data/inbox/) — the intake for documents
   that Claude runs should process. "Process with Claude" pre-fills the Run tab. */
'use strict';

renderers.files = async function () {
  const el = $('#files');
  if (!el.querySelector('#dropzone')) {
    el.innerHTML = `
      <h2>File inbox <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— uploads land in claude-dashboard/data/inbox/ for runs to use</span></h2>
      <div class="dropzone" id="dropzone">Drop files here or click to browse<br>
        <span class="muted" style="font-size:11.5px">50 MB per upload · xlsx, csv, pdf, docs, anything</span></div>
      <input type="file" id="fileIn" multiple class="hidden">
      <div class="flex" style="margin:8px 0">
        <input class="search" id="fileProject" placeholder="project folder (optional) — uploads and SharePoint pulls group under data/inbox/<project>/" style="max-width:420px"></div>
      <div id="upStatus" class="badgebar" style="margin-bottom:14px"></div>
      <div id="fileList"><div class="muted">Loading…</div></div>`;
    const dz = $('#dropzone'), fi = $('#fileIn');
    dz.onclick = () => fi.click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('drag'); uploadFiles(e.dataTransfer.files); };
    fi.onchange = () => { uploadFiles(fi.files); fi.value = ''; };
  }
  await refreshFiles();
  // Deep-link: ?tab=files&open=<name> auto-expands that file's preview card
  // (shareable link straight to a document/spreadsheet preview).
  try {
    const open = new URLSearchParams(location.search).get('open');
    if (open) {
      const card = el.querySelector(`.fcard[data-name="${(window.CSS && CSS.escape) ? CSS.escape(open) : open}"]`);
      const head = card && card.querySelector('.fcard-head.can');
      if (head) { expandCard(card, head); card.scrollIntoView({ block: 'center' }); }
    }
  } catch {}
};
renderers.files.noSkeleton = true;

async function uploadFiles(fileList, overwrite) {
  const files = [...fileList];
  if (!files.length) return;
  const tooBig = files.find(f => f.size > 50 * 1024 * 1024);
  if (tooBig) { $('#upStatus').innerHTML = `<span class="pill err">${esc(tooBig.name)} exceeds the 50 MB cap</span>`; return; }
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  $('#upStatus').innerHTML = `<span class="pill warn">uploading ${files.length} file${files.length === 1 ? '' : 's'}…</span>`;
  let r;
  try {
    const project = ($('#fileProject') && $('#fileProject').value.trim()) || '';
    r = await api('/api/files?' + new URLSearchParams({ ...(overwrite ? { overwrite: 1 } : {}), ...(project ? { project } : {}) }),
      { method: 'POST', body: fd, timeoutMs: 120000 });
  } catch (e) { $('#upStatus').innerHTML = `<span class="pill err">upload failed: ${esc(e.message || 'network error')}</span>`; return; }
  if (r.error === 'exists' || (r.conflicts && r.conflicts.length)) {
    const names = (r.conflicts || []).join(', ');
    if (confirm(`Already in the inbox: ${names}\n\nOverwrite?`)) return uploadFiles(fileList, true);
  }
  if (r.error && r.error !== 'exists') { $('#upStatus').innerHTML = `<span class="pill err">${esc(r.error)}</span>`; return; }
  const n = (r.saved || []).length;
  $('#upStatus').innerHTML = n ? `<span class="pill ok">uploaded ${n} file${n === 1 ? '' : 's'}</span>` : '';
  await refreshFiles();
}

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
// Text-like files the in-app document viewer can open (mirror of server TEXT_EXTS).
const TEXT_RE = /\.(md|markdown|txt|text|csv|tsv|json|log|ya?ml|xml|html?|ini|cfg|conf|toml|env|sql|rst|py|m?js|cjs|tsx?|jsx|css|sh|ps1|bat)$/i;
const XLSX_RE = /\.(xlsx|xlsm|xltx)$/i;

// What kind of inline preview a file gets when its card is expanded.
const fileKind = n => IMG_RE.test(n) ? 'img' : XLSX_RE.test(n) ? 'xlsx' : TEXT_RE.test(n) ? 'text' : 'other';
const KIND_ICON = { img: 'image', xlsx: 'table', text: 'file-text', other: 'file' };

// R4: day-bucket label for grouping uploads — Today / Yesterday / weekday / date
function dayLabel(iso) {
  if (!iso) return 'Undated';
  const d = new Date(iso), now = new Date();
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

async function refreshFiles() {
  const el = $('#fileList');
  if (!el) return;
  let list;
  try { list = await api('/api/files'); } catch { el.innerHTML = '<div class="muted">Inbox unavailable.</div>'; return; }
  if (!Array.isArray(list) || !list.length) { el.innerHTML = '<div class="muted">Inbox is empty — drop a workbook or document above.</div>'; return; }
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  let lastGroup = null, html = '';
  for (const f of list) {
    const group = dayLabel(f.modified);
    if (group !== lastGroup) { html += `<div class="file-daygroup">${esc(group)}</div>`; lastGroup = group; }
    const kind = fileKind(f.name), openable = kind !== 'other';
    const time = f.modified ? new Date(f.modified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    html += `
    <div class="fcard" data-name="${esc(f.name)}" data-kind="${kind}">
      <div class="fcard-head${openable ? ' can' : ''}"${openable ? ' role="button" tabindex="0" aria-expanded="false"' : ''}>
        <svg class="fcard-ico" aria-hidden="true"><use href="/vendor/icons/lucide-sprite.svg#${KIND_ICON[kind]}"/></svg>
        <span class="fcard-name mono">${esc(f.name)}</span>
        <span class="fcard-meta">${fmt(f.size)}${time ? ' · ' + time : ''}</span>
        ${openable ? '<svg class="fcard-chev" aria-hidden="true"><use href="/vendor/icons/lucide-sprite.svg#chevron-down"/></svg>' : ''}
      </div>
      <div class="fcard-acts">
        <button class="ghost procBtn" data-path="${esc(f.path)}">▷ Process with Claude</button>
        <a class="link" style="font-size:12px" href="/api/files/download?name=${encodeURIComponent(f.name)}">download</a>
        <button class="danger delBtn" data-name="${esc(f.name)}" style="padding:6px 12px;font-size:11.5px">delete</button>
      </div>
      <div class="fcard-body"></div>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.procBtn').forEach(b => b.onclick = () =>
    prefillRun(`Process the uploaded file at ${b.dataset.path} — `));
  // Whole header is the hit target — click (or Enter/Space) expands an inline
  // preview so you can read a document without leaving the list.
  el.querySelectorAll('.fcard-head.can').forEach(h => {
    const go = () => expandCard(h.closest('.fcard'), h);
    h.onclick = go;
    h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  el.querySelectorAll('.delBtn').forEach(b => b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.name} from the inbox?`)) return;
    try { await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.name }) }); }
    catch {}
    refreshFiles();
  });
}

// Toggle a file card's inline preview. Content is fetched lazily on first open
// and cached in the DOM; reuses the same renderers as the modal doc viewer
// (mdDoc / delimTable) plus the workbook-info and image endpoints.
async function expandCard(card, head) {
  const open = card.classList.toggle('open');
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const body = card.querySelector('.fcard-body');
  if (!open || body.dataset.loaded) return;
  body.dataset.loaded = '1';
  const name = card.dataset.name, kind = card.dataset.kind;
  body.innerHTML = '<div class="muted" style="padding:8px 2px">Loading…</div>';
  try {
    if (kind === 'img') {
      body.innerHTML = `<img class="fcard-img" src="/api/files/view?name=${encodeURIComponent(name)}" alt="${esc(name)}" loading="lazy">`;
      return;
    }
    if (kind === 'xlsx') {
      await renderXlsxPreview(body, name); // sheet tabs + real cell grid (sheetgrid.js)
      return;
    }
    const r = await api('/api/files/text?name=' + encodeURIComponent(name));
    if (r.error) { body.innerHTML = `<span class="pill err">${esc(r.error)}</span>`; return; }
    const ext = (r.ext || '').toLowerCase();
    let inner;
    if (ext === 'md' || ext === 'markdown') inner = `<div class="dv-md">${mdDoc(r.text)}</div>`;
    else if (ext === 'csv' || ext === 'tsv') inner = delimTable(r.text, ext === 'tsv' ? '\t' : ',');
    else inner = `<pre class="dv-pre">${esc(r.text)}</pre>`;
    if (r.truncated) inner = `<div class="pill warn" style="margin:0 0 10px">large file — showing the first 800 KB</div>` + inner;
    body.innerHTML = inner;
  } catch (e) {
    body.innerHTML = `<span class="pill err">couldn't open: ${esc(e.message || 'error')}</span>`;
    body.dataset.loaded = ''; // let a retry re-fetch
  }
}

// Full-size image preview served through the same traversal-guarded /view path.
// Reuses one lazily-built overlay; click the backdrop or press Escape to close.
function showImageLightbox(name) {
  let ov = document.getElementById('imgLightbox');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'imgLightbox';
    ov.innerHTML = '<img alt=""><button class="lb-close" aria-label="Close">Close ✕</button>';
    document.body.appendChild(ov);
    const close = () => ov.classList.remove('show');
    ov.onclick = e => { if (e.target === ov || e.target.classList.contains('lb-close')) close(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  ov.querySelector('img').src = '/api/files/view?name=' + encodeURIComponent(name);
  ov.querySelector('img').alt = name;
  ov.classList.add('show');
}

// ---- In-app document viewer -----------------------------------------------
// Reads a text-like file through the traversal-guarded /text endpoint and
// renders it: markdown → formatted HTML (headings, tables, code, lists);
// csv/tsv → a table; everything else → monospace plaintext.
async function showDocViewer(name) {
  let ov = document.getElementById('docViewer');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'docViewer';
    ov.innerHTML = `<div class="dv-panel">
      <div class="dv-head"><span class="dv-title mono"></span>
        <span class="flex"><a class="dv-dl link" style="font-size:12px">download</a>
        <button class="dv-close ghost" style="padding:6px 12px;font-size:11.5px">Close ✕</button></span></div>
      <div class="dv-body"></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.classList.remove('show');
    ov.onclick = e => { if (e.target === ov || e.target.classList.contains('dv-close')) close(); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('show')) close(); });
  }
  const short = name.split('/').pop();
  ov.querySelector('.dv-title').textContent = short;
  ov.querySelector('.dv-dl').href = '/api/files/download?name=' + encodeURIComponent(name);
  const body = ov.querySelector('.dv-body');
  body.innerHTML = '<div class="muted" style="padding:24px">Loading…</div>';
  ov.classList.add('show');
  body.scrollTop = 0;
  let r;
  try { r = await api('/api/files/text?name=' + encodeURIComponent(name)); }
  catch (e) { body.innerHTML = `<div class="pill err" style="margin:16px">couldn't open: ${esc(e.message || 'error')}</div>`; return; }
  if (r.error) { body.innerHTML = `<div class="pill err" style="margin:16px">${esc(r.error)}</div>`; return; }
  const ext = (r.ext || '').toLowerCase();
  let html;
  if (ext === 'md' || ext === 'markdown') html = `<div class="dv-md">${mdDoc(r.text)}</div>`;
  else if (ext === 'csv' || ext === 'tsv') html = delimTable(r.text, ext === 'tsv' ? '\t' : ',');
  else html = `<pre class="dv-pre">${esc(r.text)}</pre>`;
  if (r.truncated) html = `<div class="pill warn" style="margin:0 0 12px">large file — showing the first 800 KB</div>` + html;
  body.innerHTML = html;
  body.scrollTop = 0;
}

// Split a CSV/TSV line respecting simple double-quote quoting.
function splitDelim(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function delimTable(text, d) {
  const rows = text.replace(/\r/g, '').split('\n').filter(l => l.length);
  if (!rows.length) return '<div class="muted" style="padding:16px">empty file</div>';
  const cells = rows.map(l => splitDelim(l, d));
  const head = cells[0].map(c => `<th>${esc(c)}</th>`).join('');
  const bodyRows = cells.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="dv-tablewrap"><table class="dv-table"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

// Compact GFM-ish markdown → HTML for the viewer (adds tables/lists/hr that the
// chat-log mdToHtml deliberately omits). Escapes first, then injects markup.
function mdDoc(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  let out = '', i = 0, inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { out += '</ul>'; inUl = false; } if (inOl) { out += '</ol>'; inOl = false; } };
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="link" href="$2" target="_blank" rel="noopener">$1</a>');
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      closeLists(); i++; let code = '';
      while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++; out += `<pre class="dv-code">${esc(code.replace(/\n$/, ''))}</pre>`; continue;
    }
    // table: header row followed by a |---|---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeLists();
      const cellsOf = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const heads = cellsOf(line);
      i += 2; let rowsHtml = '';
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rowsHtml += `<tr>${cellsOf(lines[i]).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`; i++;
      }
      out += `<div class="dv-tablewrap"><table class="dv-table"><thead><tr>${heads.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { closeLists(); out += `<h${h[1].length} class="dv-h">${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); out += '<hr class="dv-hr">'; i++; continue; }
    if (/^\s*>\s?/.test(line)) { closeLists(); out += `<blockquote class="dv-bq">${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`; i++; continue; }
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ol) { if (inUl) { out += '</ul>'; inUl = false; } if (!inOl) { out += '<ol class="dv-list">'; inOl = true; } out += `<li>${inline(ol[1])}</li>`; i++; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) { if (inOl) { out += '</ol>'; inOl = false; } if (!inUl) { out += '<ul class="dv-list">'; inUl = true; } out += `<li>${inline(ul[1])}</li>`; i++; continue; }
    if (!line.trim()) { closeLists(); i++; continue; }
    closeLists(); out += `<p class="dv-p">${inline(line)}</p>`; i++;
  }
  closeLists();
  return out;
}
