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
// Tracking/status documents — markdown checklists, review notes, etc. Grouped
// into their own "Docs" section (projFilesHtml below) and badged on the tile
// so they don't get lost once a project has dozens of source PDFs/CSVs.
const P_DOC_RE = /\.(md|markdown)$/i;
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
  const isDoc = P_DOC_RE.test(f.base);
  const pn = prettyBase(f.base);
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  // pFileTile is the stable hook the search filter (wireFileFilter) and bulk
  // select (wireBulkFiles) key off; projTile stays the a11y CLICKABLE_SEL hook
  // for the image/doc open behavior, unchanged from before.
  const cls = ['pFileTile'];
  if (isImg || canOpen) cls.push('projTile');
  const dataAttrs = (isImg ? ` data-img="1" data-name="${esc(f.name)}"` : canOpen ? ` data-doc="1" data-name="${esc(f.name)}"` : '');
  const searchKey = `${pn ? pn.file : ''} ${f.base}`.toLowerCase();
  return `<div class="${cls.join(' ')}" data-fname="${esc(searchKey)}" style="${P_TILE}${isDoc ? ';border-color:var(--accent-dim)' : ''}${isImg || canOpen ? ';cursor:pointer' : ''};position:relative"${dataAttrs}>
    ${isDoc ? '<span class="pill accent" style="position:absolute;top:6px;right:6px;z-index:1;font-size:9px;padding:2px 6px;pointer-events:none">Doc</span>' : ''}
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
// Attached-files body: docs (.md/.markdown — trackers, checklists, review
// notes) render in their own labeled section above the general grid so they
// stay unmissable once a project has dozens of source PDFs/CSVs; each doc
// tile also gets an accent border + "Doc" pill for a second, redundant cue.
// Grid ids are the hooks wireFileFilter uses to hide/show a whole section
// once every tile inside it is filtered out.
function projFilesHtml(files) {
  const docs = files.filter(f => P_DOC_RE.test(f.base));
  const rest = files.filter(f => !P_DOC_RE.test(f.base));
  const subhead = label => `<div class="muted mono" style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;margin:12px 0 6px;font-weight:600">${esc(label)}</div>`;
  const docsHtml = docs.length ? subhead(`◆ Docs — ${docs.length}`) + `<div class="pfiles-grid" id="pFilesDocsGrid">${docs.map(projFileTile).join('')}</div>` : '';
  const restHtml = rest.length ? (docs.length ? subhead('Other files') : '') + `<div class="pfiles-grid" id="pFilesRestGrid">${rest.map(projFileTile).join('')}</div>` : '';
  return docsHtml + restHtml;
}
// Client-side filename filter above the file grid (no new endpoint — the file
// list is already fetched whole). Filters by hiding non-matching tiles rather
// than removing them from the DOM, so bulk-select checkboxes on filtered-out
// files keep their checked state; a section's sub-header hides too once every
// tile inside it is filtered out. Calls back into bulkSync (wireBulkFiles'
// returned sync fn) so the "select all" checkbox/count stay honest about what's
// actually visible.
function wireFileFilter(el, bulkSync) {
  const input = el.querySelector('#pFileSearch');
  if (!input) return;
  const tiles = [...el.querySelectorAll('.pFileTile')];
  const groups = [...el.querySelectorAll('.pfiles-grid')];
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    tiles.forEach(t => {
      const match = !q || (t.dataset.fname || '').includes(q);
      t.style.display = match ? '' : 'none';
      if (match) any = true;
    });
    groups.forEach(g => {
      const has = [...g.children].some(c => c.style.display !== 'none');
      g.style.display = has ? '' : 'none';
      // #pFiles only ever contains [subhead?, grid, subhead?, grid] (see
      // projFilesHtml) so a grid's previousElementSibling is either its own
      // subhead label or nothing — never another grid or unrelated element.
      const head = g.previousElementSibling;
      if (head) head.style.display = has ? '' : 'none';
    });
    let empty = el.querySelector('#pFilesEmpty');
    if (!any && q) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'pFilesEmpty';
        empty.className = 'muted';
        empty.setAttribute('role', 'status');
        empty.setAttribute('aria-live', 'polite');
        empty.style.marginTop = '10px';
        const box = el.querySelector('#pFiles'); if (box) box.appendChild(empty);
      }
      empty.textContent = `No files match "${input.value.trim()}".`;
    } else if (empty) empty.remove();
    if (bulkSync) bulkSync();
  };
  input.oninput = apply;
  input.onkeydown = e => { if (e.key === 'Escape' && input.value) { input.value = ''; apply(); } };
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
// Returns its `sync` fn so wireFileFilter can re-run it after hiding tiles —
// the selected-count/move button must stay honest, and "select all" only
// ever touches what's currently visible so filtering can't silently bulk-
// select files the user can't see.
function wireBulkFiles(el, id) {
  const boxes = [...el.querySelectorAll('.pFileSel')];
  if (!boxes.length) return null;
  const selAll = el.querySelector('#pSelAll');
  const count = el.querySelector('#pSelCount');
  const btn = el.querySelector('#pMoveOut');
  const status = el.querySelector('#pBulkStatus');
  const visible = () => boxes.filter(b => { const t = b.closest('.pFileTile'); return !t || t.style.display !== 'none'; });
  const selected = () => boxes.filter(b => b.checked);
  const sync = () => {
    const n = selected().length;
    const vis = visible();
    if (count) count.textContent = `${n} selected`;
    if (btn) btn.disabled = !n;
    if (selAll) selAll.checked = vis.length > 0 && vis.every(b => b.checked);
  };
  boxes.forEach(b => b.onchange = sync);
  if (selAll) selAll.onchange = () => { visible().forEach(b => b.checked = selAll.checked); sync(); };
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
  return sync;
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
