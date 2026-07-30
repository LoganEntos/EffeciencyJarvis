/* Projects → detail view: attached-file tiles, project-memory tiles, bulk
   move-out, and upload (drag/drop + picker) handling. Split out of
   projectdetail.js to keep that file under the 500-line cap (housekeeping
   todo, projects.md). Reuses the same globals as the rest of the Projects
   surface (esc/api/$ from app.js, fileKind from files.js, renderProjectDetail/
   projSel from projectdetail.js/projects.js) via the page's top-level script
   scope — same flat-global pattern as projectchat.js / projectpairs.js. */
'use strict';

// ------------------------------------------------------------- file tiles etc.
const P_IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const P_TILE = 'background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:var(--r);overflow:hidden';
const P_THUMB = 'width:100%;height:78px;object-fit:cover;display:block;background:var(--bg)';
const P_THUMB_DOC = 'width:100%;height:78px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:800;font-size:16px';
// Packet files arrive flattened as owner__repo__path.with.dots.ext (see the
// inbox INDEX.md). Recover a readable label: short filename up front, repo +
// directory path muted below. Non-matching names pass through untouched.
function prettyBase(base) {
  const p = base.split('__');
  if (p.length < 3 || !p[0] || !p[1]) return null;
  const segs = p.slice(2).join('__').split('.');
  if (segs.length < 2) return null;
  if (segs.length === 2 && segs[0].toLowerCase() === 'license') return { repo: p[0] + '/' + p[1], file: segs[1], dir: '' };
  const take = segs.length >= 3 && /^(test|spec|schema|min|d|config)$/i.test(segs[segs.length - 2]) ? 3 : 2;
  return { repo: p[0] + '/' + p[1], file: segs.slice(-take).join('.'), dir: segs.slice(0, -take).join('/') };
}
function projFileTile(f) {
  const kind = typeof fileKind === 'function' ? fileKind(f.base) : (P_IMG_RE.test(f.base) ? 'img' : 'other');
  const isImg = kind === 'img';
  // Non-image previewable files (text/csv/md/json/logs/code AND spreadsheets)
  // open in the shared in-app preview (openFilePreview → doc viewer / sheet
  // grid, files.js) — same traversal-guarded endpoints. 'other' stays
  // download-only, matching the Files tab.
  const canOpen = !isImg && kind !== 'other';
  const pn = prettyBase(f.base);
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  const openAttrs = isImg ? ` class="projTile" data-img="1" data-name="${esc(f.name)}"`
    : canOpen ? ` class="projTile" data-doc="1" data-name="${esc(f.name)}"` : '';
  return `<div style="${P_TILE}${isImg || canOpen ? ';cursor:pointer' : ''};position:relative"${openAttrs}>
    <input type="checkbox" class="pFileSel" data-name="${esc(f.name)}" title="Select for bulk actions" aria-label="Select ${esc(f.base)}" onclick="event.stopPropagation()" style="position:absolute;top:6px;left:6px;z-index:1;accent-color:var(--accent)">
    ${isImg ? `<img style="${P_THUMB}" src="/api/files/view?name=${encodeURIComponent(f.name)}" alt="" loading="lazy">`
            : `<div style="${P_THUMB_DOC}"><span class="mono">${esc(((pn ? pn.file : f.base).split('.').pop() || '?').toUpperCase()).slice(0, 4)}</span></div>`}
    <div style="padding:8px 10px">
      <div class="name mono" title="${esc(f.base)}" style="font-size:11px;word-break:break-all">${esc(pn ? pn.file : f.base)}</div>
      ${pn ? `<div class="muted" title="${esc(f.base)}" style="font-size:10px;margin-top:2px;word-break:break-all">${esc(pn.repo)}${pn.dir ? ' · ' + esc(pn.dir) : ''}</div>` : ''}
      <div class="flex" style="margin-top:4px;gap:8px">
        <span class="muted" style="font-size:10.5px">${fmt(f.size)}</span>
        <a class="link" style="font-size:11px" href="/api/files/download?name=${encodeURIComponent(f.name)}" onclick="event.stopPropagation()">download</a>
        <button class="pDelFile" data-name="${esc(f.name)}" data-base="${esc(f.base)}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0">remove</button>
      </div>
    </div>
  </div>`;
}
function memTile(m) {
  return `<div class="row" style="margin-bottom:8px;padding:10px 12px">
    <div class="flex" style="justify-content:space-between;align-items:center"><span class="name" style="font-size:12.5px">${esc(m.title || '(untitled)')}</span>
      <span class="flex" style="gap:8px;align-items:center"><span class="pill neutral" style="font-size:10px">${esc(m.type)}</span>
      ${m.id ? `<button class="pDelMem" data-id="${esc(m.id)}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0">remove</button>` : ''}</span></div>
    <div class="muted" style="font-size:11.5px;margin-top:4px;white-space:normal">${esc((m.text || '').slice(0, 240))}</div>
  </div>`;
}

// Bulk file selection → move-out. Keeps a live selected-count, toggles the
// Move button, and on click walks the selection through /api/files/move in
// move-out mode, tallying successes/failures before refreshing the detail.
function wireBulkFiles(el, id) {
  const boxes = [...el.querySelectorAll('.pFileSel')];
  if (!boxes.length) return;
  const selAll = el.querySelector('#pSelAll');
  const count = el.querySelector('#pSelCount');
  const btn = el.querySelector('#pMoveOut');
  const status = el.querySelector('#pBulkStatus');
  const selected = () => boxes.filter(b => b.checked);
  const sync = () => {
    const n = selected().length;
    if (count) count.textContent = `${n} selected`;
    if (btn) btn.disabled = !n;
    if (selAll) selAll.checked = n > 0 && n === boxes.length;
  };
  boxes.forEach(b => b.onchange = sync);
  if (selAll) selAll.onchange = () => { boxes.forEach(b => b.checked = selAll.checked); sync(); };
  if (btn) btn.onclick = async () => {
    const names = selected().map(b => b.dataset.name);
    if (!names.length) return;
    btn.disabled = true; boxes.forEach(b => b.disabled = true);
    let ok = 0; const fails = [];
    for (const name of names) {
      try {
        const r = await api('/api/files/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, project: '' }) });
        if (r && r.error) fails.push(`${name.split('/').pop()}: ${r.error}`); else ok++;
      } catch (e) { fails.push(`${name.split('/').pop()}: ${e.message || 'failed'}`); }
    }
    if (status) status.textContent = `moved ${ok} out${fails.length ? ` · ${fails.length} failed (${fails[0]})` : ''}`;
    if (fails.length) { boxes.forEach(b => b.disabled = false); btn.disabled = false; setTimeout(() => renderProjectDetail(id), 1400); }
    else renderProjectDetail(id);
  };
  sync();
}

// Upload status pill (#pUpStatus): info/progress messages auto-clear after
// ~5s (tracked so a newer message cancels the older timer); error messages
// persist until the ✕ dismiss is clicked or a new upload overwrites them.
let pUpStatusTimer = null;
function setUpStatus(inner, isError) {
  const st = $('#pUpStatus'); if (!st) return;
  if (pUpStatusTimer) { clearTimeout(pUpStatusTimer); pUpStatusTimer = null; }
  if (!inner) { st.innerHTML = ''; return; }
  if (isError) {
    st.innerHTML = `${inner} <button class="pUpStatusX" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0" aria-label="Dismiss">✕</button>`;
    const x = st.querySelector('.pUpStatusX'); if (x) x.onclick = () => setUpStatus('');
  } else {
    st.innerHTML = inner;
    pUpStatusTimer = setTimeout(() => setUpStatus(''), 5000);
  }
}
// SharePoint sync status pill (#pSyncStatus) — same auto-clear/persist
// convention as setUpStatus above: a normal result auto-clears after ~5s,
// a "sticky" one (in-progress message, or any result carrying errors) stays
// until dismissed or the next sync overwrites it, so a failure can't just
// silently vanish while you're looking elsewhere.
let pSyncStatusTimer = null;
function setSyncStatus(inner, sticky) {
  const st = $('#pSyncStatus'); if (!st) return;
  if (pSyncStatusTimer) { clearTimeout(pSyncStatusTimer); pSyncStatusTimer = null; }
  if (!inner) { st.innerHTML = ''; return; }
  if (sticky) {
    st.innerHTML = `${inner} <button class="pSyncStatusX" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0" aria-label="Dismiss">✕</button>`;
    const x = st.querySelector('.pSyncStatusX'); if (x) x.onclick = () => setSyncStatus('');
  } else {
    st.innerHTML = inner;
    pSyncStatusTimer = setTimeout(() => setSyncStatus(''), 5000);
  }
}
async function projUpload(slug, fileList, overwrite) {
  const files = [...fileList];
  if (!files.length) return;
  const tooBig = files.find(f => f.size > 50 * 1024 * 1024);
  if (tooBig) { setUpStatus(`<span class="pill err">${esc(tooBig.name)} exceeds the 50 MB cap</span>`, true); return; }
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  setUpStatus(`<span class="pill warn">uploading ${files.length} file${files.length === 1 ? '' : 's'}…</span>`);
  let r;
  try { r = await api('/api/files?' + new URLSearchParams({ project: slug, ...(overwrite ? { overwrite: 1 } : {}) }), { method: 'POST', body: fd, timeoutMs: 120000 }); }
  catch (e) { setUpStatus(`<span class="pill err">upload failed: ${esc(e.message || 'network error')}</span>`, true); return; }
  if ((r.conflicts && r.conflicts.length) && !(r.saved && r.saved.length)) {
    // Retry with the `files` snapshot, not the live `fileList` — the picker's
    // input was cleared (fin.value='') right after the first call, so the
    // original FileList is now empty and would silently upload nothing.
    if (confirm(`Already attached: ${(r.conflicts || []).join(', ')}\n\nOverwrite?`)) return projUpload(slug, files, true);
  }
  if (r.error && r.error !== 'exists') { setUpStatus(`<span class="pill err">${esc(r.error)}</span>`, true); return; }
  setUpStatus('');
  if (projSel) renderProjectDetail(projSel);
}
