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
    const isImg = IMG_RE.test(f.name);
    html += `
    <div class="row">
      <div class="flex" style="justify-content:space-between">
        <span class="flex" style="min-width:0">
          ${isImg ? `<img class="file-thumb" src="/api/files/view?name=${encodeURIComponent(f.name)}" data-name="${esc(f.name)}" alt="" title="click to enlarge" loading="lazy">` : ''}
          <span class="name mono">${esc(f.name)}</span>
        </span>
        <span class="muted" style="font-size:11.5px;white-space:nowrap">${fmt(f.size)} · ${f.modified ? new Date(f.modified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
      <div class="flex" style="margin-top:8px">
        <button class="ghost procBtn" data-path="${esc(f.path)}" data-name="${esc(f.name)}">▷ Process with Claude</button>
        ${/\.(xlsx|xlsm|xltx)$/i.test(f.name) ? `<button class="ghost xlsxBtn" data-name="${esc(f.name)}" style="padding:6px 12px;font-size:11.5px">▦ Sheets</button>` : ''}
        <a class="link" style="font-size:12px" href="/api/files/download?name=${encodeURIComponent(f.name)}">download</a>
        <button class="danger delBtn" data-name="${esc(f.name)}" style="padding:6px 12px;font-size:11.5px">delete</button>
      </div>
      <div class="xlsxInfo" data-for="${esc(f.name)}"></div>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.procBtn').forEach(b => b.onclick = () =>
    prefillRun(`Process the uploaded file at ${b.dataset.path} — `));
  // R4: a 44px thumb tells you an image is there; click enlarges it so you can
  // actually see the context a run was given (that's the whole point of R4).
  el.querySelectorAll('.file-thumb').forEach(t => t.onclick = () => showImageLightbox(t.dataset.name));
  // N6: zero-dep workbook preview — sheet names + grid dimensions, no values
  el.querySelectorAll('.xlsxBtn').forEach(b => b.onclick = async () => {
    const box = el.querySelector(`.xlsxInfo[data-for="${CSS.escape(b.dataset.name)}"]`);
    if (!box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; } // toggle closed
    box.innerHTML = '<span class="muted" style="font-size:11.5px">reading workbook…</span>';
    let r;
    try { r = await api('/api/files/xlsx?name=' + encodeURIComponent(b.dataset.name)); }
    catch (e) { box.innerHTML = `<span class="pill err">preview failed: ${esc(e.message || 'error')}</span>`; return; }
    if (r.error) { box.innerHTML = `<span class="pill err">${esc(r.error)}</span>`; return; }
    box.innerHTML = `<div class="badgebar" style="margin-top:8px">
      <span class="pill neutral">${r.sheetCount} sheet${r.sheetCount === 1 ? '' : 's'}</span>
      ${(r.sheets || []).map(s => `<span class="pill ok" title="${esc(s.ref || '')}">${esc(s.name)}${s.rows ? ` · ${s.rows}×${s.cols || '?'}` : ''}${s.note ? ' · ' + esc(s.note) : ''}</span>`).join('')}
    </div>`;
  });
  el.querySelectorAll('.delBtn').forEach(b => b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.name} from the inbox?`)) return;
    try { await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.name }) }); }
    catch {}
    refreshFiles();
  });
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
