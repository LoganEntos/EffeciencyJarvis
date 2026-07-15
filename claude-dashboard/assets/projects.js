/* Projects tab: a Claude-web-style workspace — a standing instruction set +
   attached files + project-scoped engram memory. Files reuse the inbox
   (data/inbox/<slug>/) so upload/view/download/delete go through /api/files/*;
   the server (lib/projects.js) injects the instructions + project memory into
   any run started here. "Start a chat in this project" binds it to the Run tab. */
'use strict';

let projSel = null; // currently-open project id (null = grid)

renderers.projects = async function () {
  const el = $('#projects');
  let data;
  try { data = await api('/api/projects'); } catch (e) { el.innerHTML = `<h2>Projects</h2><div class="note">Couldn't load projects — ${esc(e.message || 'network error')}.</div>`; return; }
  const list = (data && data.projects) || [];
  if (projSel && list.some(p => p.id === projSel)) return renderProjectDetail(projSel);
  projSel = null;
  el.innerHTML = `
    <h2>Projects <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— a standing instruction set, attached files, and project memory, like the Claude app</span></h2>
    <div class="flex" style="margin-bottom:16px"><button id="pNew" class="ghost">＋ New project</button></div>
    ${list.length ? `<div class="cards" id="pGrid">${list.map(projCard).join('')}</div>`
      : '<div class="note">No projects yet. Create one, drop in its files, and write the instructions Claude should follow every time you work in it.</div>'}`;
  $('#pNew').onclick = newProject;
  el.querySelectorAll('.card.clickable[data-id]').forEach(c => c.onclick = () => { projSel = c.dataset.id; renderProjectDetail(projSel); });
};

function projCard(p) {
  return `<div class="card clickable" data-id="${esc(p.id)}">
    <div class="name" style="font-size:15px;font-weight:700">${esc(p.name)}</div>
    ${p.description ? `<div class="desc" style="margin-top:6px">${esc(p.description)}</div>` : '<div class="muted" style="font-size:12px;margin-top:6px">No description</div>'}
    <div class="flex" style="margin-top:12px;gap:8px">
      <span class="pill neutral">${p.fileCount} file${p.fileCount === 1 ? '' : 's'}</span>
      ${p.instructions ? '<span class="pill ok">instructions set</span>' : '<span class="pill warn">no instructions</span>'}
    </div>
    <div class="muted" style="font-size:11px;margin-top:10px">updated ${rel(p.updatedAt)}</div>
  </div>`;
}

async function newProject() {
  const name = (prompt('Project name?') || '').trim();
  if (!name) return;
  let r;
  try { r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); }
  catch (e) { alert('Could not create project: ' + (e.message || 'network error')); return; }
  if (r.error) { alert(r.error); return; }
  projSel = r.project.id;
  renderProjectDetail(projSel);
}

async function renderProjectDetail(id) {
  const el = $('#projects');
  el.innerHTML = '<div class="muted">Loading project…</div>';
  let d;
  try { d = await api('/api/projects/get?id=' + encodeURIComponent(id)); } catch (e) { el.innerHTML = `<div class="note">Couldn't load project — ${esc(e.message || 'network error')}.</div>`; return; }
  if (d.error) { projSel = null; return renderers.projects(); }
  const p = d.project, files = d.files || [], mem = (d.memory && d.memory.items) || [];
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:flex-start;margin-bottom:6px">
      <button id="pBack" class="ghost" style="padding:6px 12px;font-size:12px">← All projects</button>
      <button id="pDel" class="danger" style="padding:6px 12px;font-size:11.5px">Delete project</button>
    </div>
    <h2 style="margin-bottom:2px">${esc(p.name)}</h2>
    <input class="search" id="pDesc" value="${esc(p.description)}" placeholder="Short description (optional)" style="max-width:560px;margin:6px 0 20px">

    <div class="row">
      <div class="flex" style="justify-content:space-between"><span class="name">▤ Instructions <span class="muted" style="font-weight:400;font-size:11.5px">— injected ahead of every run started in this project</span></span>
        <span id="pSaved" class="muted" style="font-size:11.5px"></span></div>
      <textarea id="pInstr" style="min-height:130px;margin-top:8px;resize:vertical" placeholder="e.g. You are working on the Jarvis persona. Prefer the donor patterns in the attached files. Keep replies short…">${esc(p.instructions)}</textarea>
      <div class="flex" style="margin-top:8px"><button id="pSave" class="ghost">Save instructions</button>
        <button id="pChat" style="margin-left:auto">▷ Start a chat in this project</button></div>
    </div>

    <div class="row">
      <span class="name">◇ Attached files <span class="muted" style="font-weight:400;font-size:11.5px">— ${files.length} in this project</span></span>
      <div class="dropzone" id="pDrop" style="margin-top:10px">Drop files here or click to add<br><span class="muted" style="font-size:11.5px">50 MB per upload · grouped under data/inbox/${esc(p.slug)}/</span></div>
      <input type="file" id="pFileIn" multiple class="hidden">
      <div id="pUpStatus" class="badgebar" style="margin:8px 0"></div>
      <div id="pFiles" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">${files.length ? files.map(projFileTile).join('') : '<div class="muted">No files yet.</div>'}</div>
    </div>

    <div class="row">
      <div class="flex" style="justify-content:space-between"><span class="name">✦ Project memory <span class="muted" style="font-weight:400;font-size:11.5px">— engram recall scoped to this project (its own runs + notes; no vectors)</span></span></div>
      <div id="pMem" style="margin-top:8px">${mem.length ? mem.map(memTile).join('') : '<div class="muted">No project memories yet. Runs started here, and notes you add, become recallable context.</div>'}</div>
      <div class="flex" style="margin-top:10px"><input class="search" id="pNote" placeholder="Add a note to project memory…" style="max-width:520px"><button id="pNoteAdd" class="ghost">Add note</button></div>
    </div>`;

  $('#pBack').onclick = () => { projSel = null; renderers.projects(); };
  $('#pDel').onclick = async () => {
    if (!confirm(`Delete project “${p.name}”? Its attached files stay in the inbox; only the project and its instructions are removed.`)) return;
    try { await api('/api/projects/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }); } catch {}
    projSel = null; renderers.projects();
  };
  const saveMeta = async (patch, note) => {
    const s = $('#pSaved'); if (s && note) s.textContent = 'saving…';
    try { await api('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: p.id }, patch)) }); if (s && note) s.textContent = note; }
    catch { if (s) s.textContent = 'save failed'; }
  };
  $('#pSave').onclick = () => saveMeta({ instructions: $('#pInstr').value }, 'saved ✓');
  $('#pDesc').onchange = e => saveMeta({ description: e.target.value });
  $('#pChat').onclick = () => { if (typeof bindRunProject === 'function') bindRunProject({ id: p.id, name: p.name }); prefillRun(''); };

  // ---- files: reuse the inbox endpoints, scoped to this project's slug ----
  const drop = $('#pDrop'), fin = $('#pFileIn');
  drop.onclick = () => fin.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); projUpload(p.slug, e.dataTransfer.files); };
  fin.onchange = () => { projUpload(p.slug, fin.files); fin.value = ''; };
  el.querySelectorAll('.projTile[data-img]').forEach(t => t.onclick = () => showProjImage(t.dataset.name));
  el.querySelectorAll('.pDelFile').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Remove ${b.dataset.base} from this project?`)) return;
    try { await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.name }) }); } catch {}
    renderProjectDetail(id);
  });

  // ---- project memory note ----
  $('#pNoteAdd').onclick = async () => {
    const t = $('#pNote').value.trim();
    if (!t) return;
    try { await api('/api/projects/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, text: t }) }); } catch {}
    $('#pNote').value = '';
    renderProjectDetail(id);
  };
}

const P_IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const P_TILE = 'background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:var(--r);overflow:hidden';
const P_THUMB = 'width:100%;height:96px;object-fit:cover;display:block;background:var(--bg)';
const P_THUMB_DOC = 'width:100%;height:96px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:800;font-size:18px';
// Packet files arrive flattened as owner__repo__path.with.dots.ext (see the
// inbox INDEX.md). Recover a readable label: short filename up front, repo +
// directory path muted below. Non-matching names pass through untouched.
function prettyBase(base) {
  const p = base.split('__');
  if (p.length < 3 || !p[0] || !p[1]) return null;
  const segs = p.slice(2).join('__').split('.');
  if (segs.length < 2) return null;
  if (segs.length === 2 && segs[0].toLowerCase() === 'license') return { repo: p[0] + '/' + p[1], file: segs[1], dir: '' };
  // keep compound suffixes (foo.test.ts, handoff.schema.json) intact
  const take = segs.length >= 3 && /^(test|spec|schema|min|d|config)$/i.test(segs[segs.length - 2]) ? 3 : 2;
  return { repo: p[0] + '/' + p[1], file: segs.slice(-take).join('.'), dir: segs.slice(0, -take).join('/') };
}
function projFileTile(f) {
  const isImg = P_IMG_RE.test(f.base);
  const pn = prettyBase(f.base);
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  return `<div style="${P_TILE}${isImg ? ';cursor:pointer' : ''}"${isImg ? ` class="projTile" data-img="1" data-name="${esc(f.name)}"` : ''}>
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
    <div class="flex" style="justify-content:space-between"><span class="name" style="font-size:12.5px">${esc(m.title || '(untitled)')}</span>
      <span class="pill neutral" style="font-size:10px">${esc(m.type)}</span></div>
    <div class="muted" style="font-size:11.5px;margin-top:4px;white-space:normal">${esc((m.text || '').slice(0, 240))}</div>
  </div>`;
}

async function projUpload(slug, fileList, overwrite) {
  const files = [...fileList];
  if (!files.length) return;
  const st = $('#pUpStatus');
  const tooBig = files.find(f => f.size > 50 * 1024 * 1024);
  if (tooBig) { if (st) st.innerHTML = `<span class="pill err">${esc(tooBig.name)} exceeds the 50 MB cap</span>`; return; }
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  if (st) st.innerHTML = `<span class="pill warn">uploading ${files.length} file${files.length === 1 ? '' : 's'}…</span>`;
  let r;
  try { r = await api('/api/files?' + new URLSearchParams({ project: slug, ...(overwrite ? { overwrite: 1 } : {}) }), { method: 'POST', body: fd, timeoutMs: 120000 }); }
  catch (e) { if (st) st.innerHTML = `<span class="pill err">upload failed: ${esc(e.message || 'network error')}</span>`; return; }
  if ((r.conflicts && r.conflicts.length) && !(r.saved && r.saved.length)) {
    if (confirm(`Already attached: ${(r.conflicts || []).join(', ')}\n\nOverwrite?`)) return projUpload(slug, fileList, true);
  }
  if (r.error && r.error !== 'exists') { if (st) st.innerHTML = `<span class="pill err">${esc(r.error)}</span>`; return; }
  if (projSel) renderProjectDetail(projSel);
}

// Image lightbox — its own overlay (the shared app overlay renders a <pre>).
function showProjImage(name) {
  let ov = $('#projLightbox');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'projLightbox';
  ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:#000000cc;display:grid;place-items:center;padding:32px';
  ov.innerHTML = `<div style="max-width:92vw;max-height:92vh;display:flex;flex-direction:column;align-items:center">
    <button class="ghost close" style="align-self:flex-end;margin-bottom:8px;padding:6px 12px;font-size:12px">Close ✕</button>
    <img src="/api/files/view?name=${encodeURIComponent(name)}" alt="${esc(name)}" style="max-width:92vw;max-height:80vh;object-fit:contain;border:1px solid var(--line);border-radius:var(--r);background:var(--panel)">
    <div class="mono muted" style="font-size:11.5px;margin-top:8px;text-align:center">${esc(name.split('/').pop())}</div></div>`;
  ov.onclick = e => { if (e.target === ov || e.target.classList.contains('close')) ov.remove(); };
  document.body.appendChild(ov);
}
