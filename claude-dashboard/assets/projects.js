/* Projects tab: a Claude-web-style workspace — a standing instruction set +
   attached files + project-scoped engram memory + the runs launched inside it.
   Files reuse the inbox (data/inbox/<slug>/) so upload/view/download/delete go
   through /api/files/*; the server (lib/projects.js) injects the instructions +
   project memory into any run started here, and the inline chat panel (see
   projectchat.js) is the primary way to run inside a project. This file holds
   the grid (list/search/sort/create/import); the detail view + inline chat
   wiring live in projectdetail.js (split out to keep both under 500 lines). */
'use strict';

let projSel = null;        // currently-open project id (null = grid)
let projCache = [];        // last-loaded project list (search/sort re-render from this)
let projShowNew = false;   // inline "new project" form visible
let projSort = 'recent';   // recent | name | active
let projQuery = '';        // grid search
let projShowXfer = false;  // transfer-prompt panel visible
let projShowArchived = false; // grid: reveal archived projects (hidden by default)

// ---------------------------------------------------------------- grid state
renderers.projects = async function () {
  const el = $('#projects');
  try { const data = await api('/api/projects'); projCache = (data && data.projects) || []; }
  catch (e) { el.innerHTML = `<h2>Projects</h2><div class="note">Couldn't load projects — ${esc(e.message || 'network error')}.</div>`; return; }
  if (projSel && projCache.some(p => p.id === projSel)) return renderProjectDetail(projSel);
  projSel = null;
  el.innerHTML = `
    <h2>Projects <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— a standing instruction set, attached files, and project memory, like the Claude app</span></h2>
    <div class="projbar">
      <input class="search" id="pSearch" placeholder="Search projects…" value="${esc(projQuery)}">
      <select id="pSort" title="Sort projects">
        <option value="recent">Recently updated</option>
        <option value="name">Name (A–Z)</option>
        <option value="active">Most runs</option>
      </select>
      <span style="flex:1"></span>
      <button id="pRefreshList" class="ghost" title="Re-fetch projects and run stats">↻</button>
      <button id="pXfer" class="ghost" title="The SharePoint file-transfer prompt — copy it to paste into a project run, and edit it to taste">⧉ Transfer prompt</button>
      <button id="pImportClaude" class="ghost" title="Find your Claude Code projects (~/.claude/projects) and archive them here">⇊ Import Claude projects</button>
      <button id="pImport" class="ghost" title="Adopt every data/inbox/ folder that isn't already a project">Import inbox</button>
      <button id="pNew">＋ New project</button>
    </div>
    <div id="pXferPanel"></div>
    <div id="pClaudePicker"></div>
    <div id="pNewForm"></div>
    <div id="pToast" class="muted" role="status" aria-live="polite" style="font-size:12px;margin-bottom:10px;min-height:0"></div>
    <div id="pGridWrap"></div>`;
  $('#pSort').value = projSort;
  $('#pSearch').oninput = e => { projQuery = e.target.value; projToast(''); paintCards(); };
  $('#pSort').onchange = e => { projSort = e.target.value; projToast(''); paintCards(); };
  $('#pRefreshList').onclick = () => { projToast(''); renderers.projects(); };
  $('#pNew').onclick = () => { projToast(''); toggleNewForm(); };
  $('#pImport').onclick = importInbox;
  $('#pImportClaude').onclick = () => { projToast(''); openClaudePicker(); };
  $('#pXfer').onclick = () => { projShowXfer = !projShowXfer; renderXfer(); };
  if (projShowNew) renderNewForm();
  if (projShowXfer) renderXfer();
  paintCards();
};

function sortProjects(list, mode) {
  const a = list.slice();
  if (mode === 'name') a.sort((x, y) => x.name.localeCompare(y.name));
  else if (mode === 'active') a.sort((x, y) => (y.runCount || 0) - (x.runCount || 0) || (y.lastRunAt || '').localeCompare(x.lastRunAt || ''));
  else a.sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
  return a;
}

// Repaint ONLY the card grid — leaves the search box focused while typing.
function paintCards() {
  const wrap = $('#pGridWrap');
  if (!wrap) return;
  const total = projCache.length;
  const archivedN = projCache.filter(p => p.archived).length;
  const pool = projShowArchived ? projCache.slice() : projCache.filter(p => !p.archived);
  const q = projQuery.trim().toLowerCase();
  let list = q ? pool.filter(p => (p.name + ' ' + (p.description || '')).toLowerCase().includes(q)) : pool.slice();
  list = sortProjects(list, projSort);
  const grid = list.length
    ? `<div class="cards">${list.map(projCard).join('')}</div>`
    : (total ? '<div class="note">No projects match that search.</div>'
             : '<div class="note">No projects yet. Create one, drop in its files, and write the instructions Claude should follow every time you work in it — or drop files in the Files tab first and use "Move into project" once one exists.</div>');
  // 0-state: the toggle link only makes sense once there's something to reveal,
  // but a bare neutral pill keeps "archiving exists" discoverable even at 0 —
  // non-interactive on purpose (no handler, no pointer cursor).
  const archLine = archivedN
    ? `<div class="muted" style="font-size:11.5px;margin-top:10px"><a class="link" id="pArchToggle" role="button" tabindex="0">${projShowArchived ? 'hide' : 'show'} ${archivedN} archived project${archivedN === 1 ? '' : 's'}</a></div>`
    : `<div class="muted" style="font-size:11.5px;margin-top:10px"><span class="pill neutral" style="cursor:default" title="No archived projects yet">0 archived</span></div>`;
  wrap.innerHTML = grid + archLine;
  wrap.querySelectorAll('.card.clickable[data-id]').forEach(c => c.onclick = () => { projSel = c.dataset.id; renderProjectDetail(projSel); });
  const at = $('#pArchToggle');
  if (at) {
    const flip = () => { projShowArchived = !projShowArchived; paintCards(); };
    at.onclick = flip;
    at.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  }
}

// Compact pairing summary badge for a project tile. Returns '' when there's
// nothing to show so the tile degrades cleanly on the older response shape.
function pairPill(s) {
  if (!s || typeof s !== 'object') return '';
  const bits = [];
  if (s.complete) bits.push(`${s.complete} ✓`);
  if (s.pdfOnly) bits.push(`${s.pdfOnly} pdf-only`);
  if (s.csvOnly) bits.push(`${s.csvOnly} csv-only`);
  let html = bits.length
    ? `<span class="pill neutral" title="PDF↔CSV pairing: ${esc(bits.join(' · '))}">⛓ ${esc(bits.join(' · '))}</span>`
    : '';
  if (s.dups) html += `<span class="pill err" title="${s.dups} order${s.dups === 1 ? '' : 's'} with 2+ PDFs claiming the same id — needs review">⚠ ${s.dups} dup${s.dups === 1 ? '' : 's'}</span>`;
  return html;
}

function projCard(p) {
  const claude = p.kind === 'claude';
  const runs = `${p.runCount || 0} run${p.runCount === 1 ? '' : 's'}`;
  const meta = p.lastRunAt ? 'last run ' + rel(p.lastRunAt) : 'updated ' + rel(p.updatedAt);
  const desc = claude
    ? `<div class="pcard-cwd">${esc(p.cwd || '')}</div>`
    : (p.description ? `<div class="pcard-desc">${esc(p.description)}</div>` : '<div class="pcard-desc empty">No description</div>');
  const arch = p.archived ? '<span class="pill warn">archived</span>' : '';
  // PDF↔CSV pairing badge — server sends p.pairs only for standard projects with
  // a workable file count (see lib/projects.js shape()); absent for claude-kind,
  // empty, or oversized folders, so guard and render nothing when it's missing.
  const pairBadge = pairPill(p.pairs);
  const pills = claude
    ? `${arch}<span class="pill accent">Claude Code</span><span class="pill neutral">${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}</span>`
    : `${arch}<span class="pill neutral">${p.fileCount} file${p.fileCount === 1 ? '' : 's'}</span><span class="pill neutral">${runs}</span>${pairBadge}${p.instructions ? '<span class="pill ok">instructions</span>' : '<span class="pill warn">no instructions</span>'}`;
  return `<div class="card clickable${p.archived ? ' pcard-archived' : ''}" data-id="${esc(p.id)}">
    <div class="pcard-name">${esc(p.name)}</div>
    ${desc}
    <div class="pcard-pills">${pills}</div>
    <div class="pcard-meta">${meta}</div>
  </div>`;
}

// #pToast: info/success messages auto-clear after ~5s (tracked so a newer
// message cancels the older timer); errors persist until the ✕ dismiss is
// clicked or the next user-initiated action (search/sort/new/import) in this
// view clears them.
let projToastTimer = null;
function projToast(msg, isError) {
  const t = $('#pToast'); if (!t) return;
  if (projToastTimer) { clearTimeout(projToastTimer); projToastTimer = null; }
  if (!msg) { t.innerHTML = ''; return; }
  if (isError) {
    t.innerHTML = `${esc(msg)} <button class="pToastX" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:11px;padding:0;margin-left:6px" aria-label="Dismiss">✕</button>`;
    const x = t.querySelector('.pToastX'); if (x) x.onclick = () => projToast('');
  } else {
    t.textContent = msg;
    projToastTimer = setTimeout(() => projToast(''), 5000);
  }
}

// ---------------------------------------------------------- inline new-project
function toggleNewForm() { projShowNew = !projShowNew; renderNewForm(); }
function renderNewForm() {
  const host = $('#pNewForm');
  if (!host) return;
  if (!projShowNew) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="pnewrow">
    <span class="name">＋ New project</span>
    <input class="search pform-field" id="pnName" placeholder="Project name">
    <input class="search pform-field" id="pnDesc" placeholder="Short description (optional)">
    <div class="flex" style="margin-top:10px"><button id="pnCreate">Create</button><button id="pnCancel" class="ghost">Cancel</button></div>
    <div id="pnErr" class="muted" style="font-size:11.5px;margin-top:6px;color:var(--red)" aria-live="polite"></div></div>`;
  $('#pnName').focus();
  $('#pnName').onkeydown = e => { if (e.key === 'Enter') $('#pnCreate').click(); };
  $('#pnCancel').onclick = toggleNewForm;
  // extra = {} | {adopt:true} | {fresh:true}. The server 409s with
  // 'folder-exists' when this name's inbox folder still holds a deleted
  // project's files — the one place the user must choose: adopt them (the only
  // recovery path for those files) or start fresh in a new folder.
  const doCreate = async extra => {
    const name = ($('#pnName').value || '').trim();
    if (!name) { $('#pnErr').textContent = 'Name required.'; return; }
    let r;
    try { r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ name, description: ($('#pnDesc').value || '').trim() }, extra)) }); }
    catch (e) { $('#pnErr').textContent = 'Could not create: ' + (e.message || 'network error'); return; }
    if (r.error === 'folder-exists') {
      $('#pnErr').innerHTML = `A folder <span class="mono">data/inbox/${esc(r.slug)}/</span> already holds ${r.fileCount} file${r.fileCount === 1 ? '' : 's'} from a previous project of this name.
        <button id="pnAdopt" class="ghost" style="padding:3px 9px;font-size:11px;margin-left:6px">Adopt those files</button>
        <button id="pnFresh" class="ghost" style="padding:3px 9px;font-size:11px">Start fresh</button>`;
      $('#pnAdopt').onclick = () => doCreate({ adopt: true });
      $('#pnFresh').onclick = () => doCreate({ fresh: true });
      // aria-live announces the new copy, but a keyboard user's focus is still
      // wherever it was (on Create, or on the name field via Enter) — move it
      // to the first new control so both input methods discover the choice.
      $('#pnAdopt').focus();
      return;
    }
    if (r.error) { $('#pnErr').textContent = r.error; return; }
    projShowNew = false; projSel = r.project.id; renderProjectDetail(projSel);
  };
  $('#pnCreate').onclick = () => doCreate({});
}

async function importInbox() {
  projToast('Scanning inbox…');
  let r;
  try { r = await api('/api/projects/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { projToast('Import failed: ' + (e.message || 'network error'), true); return; }
  if (r.error) { projToast(r.error, true); return; }
  if (!r.count) { projToast('Nothing to import — every inbox folder already has a project.'); return; }
  try { const data = await api('/api/projects'); projCache = (data && data.projects) || []; } catch {}
  paintCards();
  projToast(`Imported ${r.count} project${r.count === 1 ? '' : 's'} from inbox folders.`);
}

// -------------------------------------------------- import real Claude projects
// Discover ~/.claude/projects workspaces and let the user pick which to archive.
let claudePickerOpen = false;
async function openClaudePicker() {
  const host = $('#pClaudePicker');
  if (!host) return;
  if (claudePickerOpen) { claudePickerOpen = false; host.innerHTML = ''; return; }
  claudePickerOpen = true;
  host.innerHTML = '<div class="row"><span class="muted">Scanning ~/.claude/projects…</span></div>';
  let d;
  try { d = await api('/api/projects/claude'); }
  catch (e) { host.innerHTML = `<div class="row"><span class="muted">Couldn't scan: ${esc(e.message || 'network error')}</span></div>`; return; }
  const ws = (d && d.workspaces) || [];
  const fresh = ws.filter(w => !w.imported);
  if (!ws.length) { host.innerHTML = '<div class="row"><span class="muted">No Claude Code projects found on this machine.</span></div>'; return; }
  host.innerHTML = `<div class="row" style="padding:14px 16px">
    <div class="flex" style="justify-content:space-between;align-items:center">
      <span class="name">⇊ Your Claude Code projects <span class="muted" style="font-weight:400;font-size:11.5px">— ${ws.length} found, ${fresh.length} not yet archived</span></span>
      <button class="ghost close" style="padding:5px 11px;font-size:11px">✕</button></div>
    <div class="cpick" style="margin-top:10px;display:grid;gap:8px">${ws.map(claudeRow).join('')}</div>
    <div class="flex" style="margin-top:10px;gap:8px">
      <button id="pcImport">Archive selected</button>
      <button id="pcAll" class="ghost">Select all new</button>
      <span id="pcMsg" class="muted" style="font-size:11.5px;align-self:center"></span></div></div>`;
  host.querySelector('.close').onclick = () => { claudePickerOpen = false; host.innerHTML = ''; };
  const boxes = () => [...host.querySelectorAll('input[type=checkbox]:not(:disabled)')];
  $('#pcAll').onclick = () => boxes().forEach(b => { b.checked = true; });
  $('#pcImport').onclick = async () => {
    const dirs = boxes().filter(b => b.checked).map(b => b.value);
    if (!dirs.length) { $('#pcMsg').textContent = 'Select at least one project.'; return; }
    $('#pcMsg').textContent = `Archiving ${dirs.length}…`;
    let r;
    try { r = await api('/api/projects/import-claude', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dirs }) }); }
    catch (e) { $('#pcMsg').textContent = 'Failed: ' + (e.message || 'network error'); return; }
    claudePickerOpen = false; host.innerHTML = '';
    try { const data = await api('/api/projects'); projCache = (data && data.projects) || []; } catch {}
    paintCards();
    projToast(`Archived ${r.count} Claude project${r.count === 1 ? '' : 's'}. They're kept here now.`);
  };
}

function claudeRow(w) {
  const dis = w.imported ? ' disabled' : '';
  return `<label class="flex" style="gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:var(--r);${w.imported ? 'opacity:.55' : ''}">
    <input type="checkbox" value="${esc(w.dir)}"${dis}>
    <div style="flex:1;min-width:0">
      <div class="mono" style="font-size:12px;word-break:break-all">${esc(w.cwd || w.dir)}</div>
      <div class="muted" style="font-size:11px;margin-top:2px">${w.sessionCount} session${w.sessionCount === 1 ? '' : 's'}${w.branch ? ' · ' + esc(w.branch) : ''}${w.lastAt ? ' · last ' + rel(w.lastAt) : ''}</div>
    </div>
    ${w.imported ? '<span class="pill ok" style="font-size:10px">archived</span>' : ''}
  </label>`;
}
