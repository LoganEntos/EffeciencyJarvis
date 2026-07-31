/* Projects → detail view: SharePoint-linked-folder panel. Lets a project be
   bound to a live SharePoint folder (offline index browse — same source as
   the header's "Sync now" pull) and shows that folder's files/subfolders
   in place, so it's visible what's linked before anything is pulled — a
   view distinct from the physically-copied Attached files section above.
   Split out to keep projectdetail.js under the 500-line cap; exposes
   renderSpPanel(p, files, containerEl), called from there. Reuses the same
   offline-index endpoints as the SharePoint tab's Breakdown panel
   (assets/sharepoint.js) but scoped to one project's binding instead of the
   whole tenant tree; PSP is this module's own state, distinct from that
   tab's SP/BRK globals since both scripts share the page's global scope. */
'use strict';

const PSP = { mode: 'pick', drive: '', driveName: '', path: '', viewRoot: undefined, project: null, files: [] };

// Entry point — call on every project-detail render; safe to call repeatedly
// for the same project (preserves in-panel nav depth across refreshes) and
// resets state cleanly when the selected project changes.
function renderSpPanel(p, files, el) {
  if (!el) return;
  const switchedProject = !PSP.project || PSP.project.id !== p.id;
  PSP.project = p; PSP.files = files || [];
  const sf = p.sharepointFolder || null;
  if (switchedProject) {
    PSP.mode = sf ? 'view' : 'pick';
    PSP.drive = sf ? sf.driveId : ''; PSP.path = sf ? sf.path : ''; PSP.viewRoot = sf ? sf.path : undefined;
  }
  spBoot(el, sf);
}

async function spBoot(el, sf) {
  el.innerHTML = '<div class="muted">Loading…</div>';
  let s;
  try { s = await api('/api/sharepoint/status'); } catch { el.innerHTML = '<div class="muted">SharePoint module unavailable.</div>'; return; }
  if (!s.index) {
    el.innerHTML = `<div class="note" style="font-size:12.5px">No SharePoint index yet — build one in the <a class="link" id="pspGoSp">SharePoint tab</a>, then come back here to link a folder.</div>`;
    const a = el.querySelector('#pspGoSp'); if (a) a.onclick = () => { if (typeof goTab === 'function') goTab('sharepoint'); };
    return;
  }
  if (sf && PSP.mode === 'view') return spRenderBound(el, sf);
  return spRenderPicker(el, sf);
}

// ---- picker: drive dropdown + breadcrumb folder nav, "Link this folder" ----
async function spRenderPicker(el, sf) {
  const t = await api('/api/sharepoint/index/tree').catch(() => ({ error: 'unavailable' }));
  if (t.error) { el.innerHTML = `<div class="pill err">${esc(t.error)}</div>`; return; }
  const opts = ['<option value="">— library —</option>'];
  for (const site of t.sites) for (const d of site.drives)
    opts.push(`<option value="${esc(d.id)}" data-site="${esc(site.name || '')}" data-name="${esc(d.name)}" ${d.id === PSP.drive ? 'selected' : ''}>${esc(site.name || 'site')} / ${esc(d.name)} · ${d.fileCount.toLocaleString()}</option>`);
  el.innerHTML = `
    ${sf ? '<div class="flex" style="margin-bottom:8px"><button class="ghost" id="pspCancel" style="padding:4px 10px;font-size:11px">← back to linked view</button></div>' : ''}
    <div class="flex" style="flex-wrap:wrap;gap:8px">
      <span class="muted" style="font-size:11.5px">pick a library, then a folder to link</span>
      <select id="pspDrive" style="margin-left:auto">${opts.join('')}</select>
    </div>
    <div id="pspCrumbs" style="margin:10px 0 4px;font-size:12px"></div>
    <div id="pspList"></div>`;
  if (sf) $('#pspCancel').onclick = () => { PSP.mode = 'view'; renderSpPanel(PSP.project, PSP.files, el); };
  $('#pspDrive').onchange = () => {
    const o = $('#pspDrive').selectedOptions[0];
    PSP.drive = $('#pspDrive').value; PSP.driveName = o.dataset.name || ''; PSP.path = '';
    if (PSP.drive) pspList(el); else { $('#pspCrumbs').innerHTML = ''; $('#pspList').innerHTML = ''; }
  };
  // Only auto-browse a carried-over PSP.drive if it's still a real option (the
  // bound drive can vanish from the index after a rebuild/rename) — otherwise
  // leave the dropdown on its blank default instead of erroring under a
  // selector that visually still says "— library —".
  if (PSP.drive && [...$('#pspDrive').options].some(o => o.value === PSP.drive)) { $('#pspDrive').value = PSP.drive; pspList(el); }
}

async function pspList(el) {
  const segs = PSP.path ? PSP.path.split('/') : [];
  const crumb = (label, path) => `<a class="link pspCrumb" data-path="${esc(path)}">${esc(label)}</a>`;
  const crumbsHtml = [crumb(PSP.driveName || 'root', '')].concat(segs.map((s, i) => crumb(s, segs.slice(0, i + 1).join('/')))).join(' <span class="muted">/</span> ');
  const linkBtn = PSP.path ? '<button class="ghost" id="pspLink" style="padding:2px 10px;font-size:11px;margin-left:10px">🔗 Link this folder</button>'
    : '<span class="muted" style="font-size:11px;margin-left:10px">navigate into a folder to link it (the drive root itself can\'t be linked)</span>';
  $('#pspCrumbs').innerHTML = crumbsHtml + linkBtn;
  el.querySelectorAll('.pspCrumb').forEach(a => a.onclick = () => { PSP.path = a.dataset.path; pspList(el); });
  if ($('#pspLink')) $('#pspLink').onclick = () => pspLinkHere(el);
  $('#pspList').innerHTML = '<div class="muted">Loading…</div>';
  const r = await api(`/api/sharepoint/index/browse?drive=${encodeURIComponent(PSP.drive)}&path=${encodeURIComponent(PSP.path)}`).catch(e => ({ error: e.message }));
  if (r.error) { $('#pspList').innerHTML = `<div class="pill err">${esc(r.error)}</div>`; return; }
  $('#pspList').innerHTML = pspFolderRows(r.folders) || '<div class="muted">Empty folder.</div>';
  el.querySelectorAll('.pspDir').forEach(d => d.onclick = () => { PSP.path = d.dataset.path; pspList(el); });
}
// A bare 4-digit folder name (2022, 2026…) reads as just a number until you
// already know this tree is year-organized — label it explicitly so it's
// unambiguous which year of SharePoint history a subfolder holds, without
// needing the breadcrumb trail above it for context.
const PSP_YEAR_RE = /^(19|20)\d{2}$/;
function pspFolderRows(folders) {
  return (folders || []).map(f => {
    const isYear = PSP_YEAR_RE.test(f.name);
    const label = isYear ? `📅 ${esc(f.name)} <span class="muted" style="font-weight:400">— closed orders</span>` : `<strong>${esc(f.name)}</strong>`;
    return `<div class="flex pspDir" data-path="${esc(PSP.path ? PSP.path + '/' + f.name : f.name)}" style="padding:7px 0;border-bottom:1px solid var(--line);cursor:pointer">
      <span>${isYear ? '' : '▸ '}${label} <span class="muted" style="font-size:11px">${f.count.toLocaleString()} files</span></span></div>`;
  }).join('');
}

async function pspLinkHere(el) {
  const btn = $('#pspLink'); if (!btn) return;
  btn.disabled = true; const was = btn.textContent; btn.textContent = '…';
  const name = PSP.driveName + (PSP.path ? '/' + PSP.path : '');
  try {
    const r = await api('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: PSP.project.id, sharepointFolder: { driveId: PSP.drive, path: PSP.path, name } }) });
    if (r.error) { btn.disabled = false; btn.textContent = was; alert('Could not link: ' + r.error); return; }
  } catch (e) { btn.disabled = false; btn.textContent = was; alert('Could not link: ' + (e.message || 'network error')); return; }
  PSP.mode = 'view';
  if (typeof renderProjectDetail === 'function') renderProjectDetail(PSP.project.id); // full refresh: header "Sync now" button re-enables too
}

// ---- bound view: browse the linked folder (and below), Pull per file -------
async function spRenderBound(el, sf) {
  if (PSP.viewRoot !== sf.path || PSP.drive !== sf.driveId) { PSP.viewRoot = sf.path; PSP.path = sf.path; PSP.drive = sf.driveId; }
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <span class="pill ok" style="font-size:11px">🔗 linked</span>
      <span class="mono muted" style="font-size:11.5px;word-break:break-all">${esc(sf.name || sf.path)}</span>
      <span class="flex" style="gap:8px;margin-left:auto">
        <button class="ghost" id="pspChange" style="padding:4px 10px;font-size:11px">Change folder</button>
        <button class="ghost" id="pspUnlink" style="padding:4px 10px;font-size:11px">Unlink</button>
      </span>
    </div>
    <div id="pspCrumbs" style="margin:6px 0 4px;font-size:12px"></div>
    <div id="pspList"></div>`;
  $('#pspChange').onclick = () => { PSP.mode = 'pick'; PSP.driveName = (sf.name || '').split('/')[0] || ''; renderSpPanel(PSP.project, PSP.files, el); };
  $('#pspUnlink').onclick = e => spUnlink(e.currentTarget, el);
  spvList(el, sf);
}

async function spUnlink(btn, el) {
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'confirm?'; setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = 'Unlink'; } }, 2600); return; }
  btn.disabled = true;
  let r;
  try { r = await api('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: PSP.project.id, sharepointFolder: null }) }); }
  catch (e) { r = { error: e.message || 'network error' }; }
  if (r.error) { btn.disabled = false; btn.dataset.armed = ''; btn.textContent = 'Unlink'; alert('Could not unlink: ' + r.error); return; }
  PSP.mode = 'pick';
  if (typeof renderProjectDetail === 'function') renderProjectDetail(PSP.project.id);
}

async function spvList(el, sf) {
  const rootLabel = (sf.name || sf.path).split('/').pop() || 'linked folder';
  const relSegs = PSP.path.length > sf.path.length ? PSP.path.slice(sf.path.length).replace(/^\/+/, '').split('/').filter(Boolean) : [];
  const crumb = (label, path) => `<a class="link pspCrumb" data-path="${esc(path)}">${esc(label)}</a>`;
  $('#pspCrumbs').innerHTML = [crumb(rootLabel, sf.path)].concat(relSegs.map((s, i) => crumb(s, sf.path + '/' + relSegs.slice(0, i + 1).join('/')))).join(' <span class="muted">/</span> ');
  el.querySelectorAll('.pspCrumb').forEach(a => a.onclick = () => { PSP.path = a.dataset.path; spvList(el, sf); });
  $('#pspList').innerHTML = '<div class="muted">Loading…</div>';
  const r = await api(`/api/sharepoint/index/browse?drive=${encodeURIComponent(sf.driveId)}&path=${encodeURIComponent(PSP.path)}`).catch(e => ({ error: e.message }));
  if (r.error) { $('#pspList').innerHTML = `<div class="pill err">${esc(r.error)}</div>`; return; }
  const have = new Set(PSP.files.map(f => f.base.toLowerCase()));
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  const CAP = 150, shown = r.files.slice(0, CAP);
  const files = shown.map(f => {
    const already = have.has((f.name || '').toLowerCase());
    return `<div class="flex" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)">
      <span style="min-width:0" class="mono" title="${esc(f.name)}">${esc(f.name)} <span class="muted" style="font-size:11px">${fmt(f.size)}${f.modified ? ' · ' + esc(f.modified) : ''}</span></span>
      <span class="flex" style="gap:6px;align-items:center">
        ${already ? '<span class="pill neutral" style="font-size:10.5px">in project</span>'
          : `<button class="ghost pspPull" data-drive="${esc(f.driveId)}" data-item="${esc(f.id)}" style="padding:4px 10px;font-size:11px">⇩ Pull</button>`}
      </span></div>`;
  }).join('');
  const trunc = r.files.length > CAP ? `<div class="muted" style="font-size:11px;margin-top:6px">${r.files.length - CAP} more file${r.files.length - CAP === 1 ? '' : 's'} not shown — narrow into a subfolder</div>` : '';
  $('#pspList').innerHTML = (pspFolderRows(r.folders) + files) || '<div class="muted">Empty folder.</div>';
  $('#pspList').insertAdjacentHTML('beforeend', trunc);
  el.querySelectorAll('.pspDir').forEach(d => d.onclick = () => { PSP.path = d.dataset.path; spvList(el, sf); });
  el.querySelectorAll('.pspPull').forEach(b => b.onclick = () => pspPull(b));
}

async function pspPull(btn) {
  btn.disabled = true; btn.textContent = '…';
  const r = await api('/api/sharepoint/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drive: btn.dataset.drive, item: btn.dataset.item, project: PSP.project.slug }), timeoutMs: 120000 }).catch(e => ({ error: e.message }));
  if (r.error) { btn.disabled = false; btn.textContent = '⇩ Pull'; btn.title = r.error; return; }
  // Refresh the whole detail view so the Attached files grid (above) and this
  // panel's "in project" state both pick up the newly-pulled file.
  if (typeof renderProjectDetail === 'function') renderProjectDetail(PSP.project.id);
}
