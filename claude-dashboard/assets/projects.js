/* Projects tab: a Claude-web-style workspace — a standing instruction set +
   attached files + project-scoped engram memory + the runs launched inside it.
   Files reuse the inbox (data/inbox/<slug>/) so upload/view/download/delete go
   through /api/files/*; the server (lib/projects.js) injects the instructions +
   project memory into any run started here, and "Start a chat in this project"
   binds it to the Run tab. Grid state and detail state, no popups. */
'use strict';

let projSel = null;        // currently-open project id (null = grid)
let projCache = [];        // last-loaded project list (search/sort re-render from this)
let projShowNew = false;   // inline "new project" form visible
let projSort = 'recent';   // recent | name | active
let projQuery = '';        // grid search
let projShowXfer = false;  // transfer-prompt panel visible

// Instruction starter templates — chips insert these so a blank project isn't
// a blank page. Kept deliberately terse; the user fills the specifics.
const P_PRESETS = [
  { label: 'Persona', text: 'You are working inside this project. Hold this voice and priorities on every reply:\n- ' },
  { label: 'Coding style', text: 'Coding conventions here:\n- Match the surrounding code; introduce no new dependencies.\n- Keep changes small and browser-verified before commit.\n' },
  { label: 'Output format', text: 'When you report back:\n- Lead with a one-line summary.\n- Then concrete next steps as short bullets.\n' },
  { label: 'Guardrails', text: 'Hard rules for this project:\n- Never touch files outside it.\n- Ask before any irreversible or outward-facing action.\n' },
];

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
      <button id="pXfer" class="ghost" title="The SharePoint file-transfer prompt — copy it to paste into a project run, and edit it to taste">⧉ Transfer prompt</button>
      <button id="pImportClaude" class="ghost" title="Find your Claude Code projects (~/.claude/projects) and archive them here">⇊ Import Claude projects</button>
      <button id="pImport" class="ghost" title="Adopt every data/inbox/ folder that isn't already a project">Import inbox</button>
      <button id="pNew">＋ New project</button>
    </div>
    <div id="pXferPanel"></div>
    <div id="pClaudePicker"></div>
    <div id="pNewForm"></div>
    <div id="pToast" class="muted" style="font-size:12px;margin-bottom:10px;min-height:0"></div>
    <div id="pGridWrap"></div>`;
  $('#pSort').value = projSort;
  $('#pSearch').oninput = e => { projQuery = e.target.value; paintCards(); };
  $('#pSort').onchange = e => { projSort = e.target.value; paintCards(); };
  $('#pNew').onclick = toggleNewForm;
  $('#pImport').onclick = importInbox;
  $('#pImportClaude').onclick = openClaudePicker;
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
  const q = projQuery.trim().toLowerCase();
  let list = q ? projCache.filter(p => (p.name + ' ' + (p.description || '')).toLowerCase().includes(q)) : projCache.slice();
  list = sortProjects(list, projSort);
  wrap.innerHTML = list.length
    ? `<div class="cards">${list.map(projCard).join('')}</div>`
    : (total ? '<div class="note">No projects match that search.</div>'
             : '<div class="note">No projects yet. Create one, drop in its files, and write the instructions Claude should follow every time you work in it — or Import inbox to adopt existing folders.</div>');
  wrap.querySelectorAll('.card.clickable[data-id]').forEach(c => c.onclick = () => { projSel = c.dataset.id; renderProjectDetail(projSel); });
}

function projCard(p) {
  const claude = p.kind === 'claude';
  const runs = `${p.runCount || 0} run${p.runCount === 1 ? '' : 's'}`;
  const meta = p.lastRunAt ? 'last run ' + rel(p.lastRunAt) : 'updated ' + rel(p.updatedAt);
  const desc = claude
    ? `<div class="pcard-cwd">${esc(p.cwd || '')}</div>`
    : (p.description ? `<div class="pcard-desc">${esc(p.description)}</div>` : '<div class="pcard-desc empty">No description</div>');
  const pills = claude
    ? `<span class="pill accent">Claude Code</span><span class="pill neutral">${p.sessionCount} session${p.sessionCount === 1 ? '' : 's'}</span>`
    : `<span class="pill neutral">${p.fileCount} file${p.fileCount === 1 ? '' : 's'}</span><span class="pill neutral">${runs}</span>${p.instructions ? '<span class="pill ok">instructions</span>' : '<span class="pill warn">no instructions</span>'}`;
  return `<div class="card clickable" data-id="${esc(p.id)}">
    <div class="pcard-name">${esc(p.name)}</div>
    ${desc}
    <div class="pcard-pills">${pills}</div>
    <div class="pcard-meta">${meta}</div>
  </div>`;
}

function projToast(msg) { const t = $('#pToast'); if (t) t.textContent = msg || ''; }

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
    <div id="pnErr" class="muted" style="font-size:11.5px;margin-top:6px;color:var(--red)"></div></div>`;
  $('#pnName').focus();
  $('#pnName').onkeydown = e => { if (e.key === 'Enter') $('#pnCreate').click(); };
  $('#pnCancel').onclick = toggleNewForm;
  $('#pnCreate').onclick = async () => {
    const name = ($('#pnName').value || '').trim();
    if (!name) { $('#pnErr').textContent = 'Name required.'; return; }
    let r;
    try { r = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: ($('#pnDesc').value || '').trim() }) }); }
    catch (e) { $('#pnErr').textContent = 'Could not create: ' + (e.message || 'network error'); return; }
    if (r.error) { $('#pnErr').textContent = r.error; return; }
    projShowNew = false; projSel = r.project.id; renderProjectDetail(projSel);
  };
}

async function importInbox() {
  projToast('Scanning inbox…');
  let r;
  try { r = await api('/api/projects/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { projToast('Import failed: ' + (e.message || 'network error')); return; }
  if (r.error) { projToast(r.error); return; }
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

// -------------------------------------------------------------- detail state
async function renderProjectDetail(id) {
  const el = $('#projects');
  el.innerHTML = '<div class="muted">Loading project…</div>';
  let d;
  try { d = await api('/api/projects/get?id=' + encodeURIComponent(id)); }
  catch (e) { el.innerHTML = `<div class="note">Couldn't load project — ${esc(e.message || 'network error')}.</div>`; return; }
  if (d.error) { projSel = null; return renderers.projects(); }
  const p = d.project, files = d.files || [], mem = (d.memory && d.memory.items) || [], runs = d.runs || [];
  const sessions = d.sessions || [], claude = p.kind === 'claude';
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:flex-start;margin-bottom:4px">
      <button id="pBack" class="ghost" style="padding:5px 11px;font-size:11.5px">← All projects</button>
      <button id="pDel" class="danger" style="padding:5px 11px;font-size:11px">Delete project</button>
    </div>
    <input id="pName" value="${esc(p.name)}" style="font-family:var(--font-body);font-size:24px;font-weight:800;letter-spacing:-.02em;background:none;border:none;padding:0;margin:2px 0;width:100%">
    <input class="search" id="pDesc" value="${esc(p.description)}" placeholder="Short description (optional)" style="max-width:560px;margin:4px 0 10px">
    <div class="badgebar" style="margin:0 0 14px">
      ${claude ? `<span class="pill accent">Claude Code</span><span class="pill neutral">${sessions.length} session${sessions.length === 1 ? '' : 's'}</span>`
               : `<span class="pill neutral">${files.length} file${files.length === 1 ? '' : 's'}</span><span class="pill neutral">${p.runCount || 0} run${p.runCount === 1 ? '' : 's'}</span>`}
      <span class="pill neutral">${mem.length} memor${mem.length === 1 ? 'y' : 'ies'}</span>
    </div>
    ${claude ? `<div class="row">
      <div class="psection"><span class="name">◷ Sessions <span class="muted" style="font-weight:400;font-size:11.5px">— your Claude Code conversations in this workspace, archived here</span></span></div>
      <div class="mono muted" style="font-size:11px;margin:2px 0 4px;word-break:break-all">${esc(p.cwd || '')}</div>
      <div class="note" style="font-size:11.5px;margin:8px 0">To continue a session, open a terminal in that folder and run <span class="mono">claude --resume &lt;id&gt;</span>. Each session opens read-only here for reference.</div>
      <div id="pSessions" style="display:grid;gap:8px;margin-top:6px">${sessions.length ? sessions.map(sessionRow).join('') : '<div class="muted">No sessions in this workspace.</div>'}</div>
    </div>` : ''}

    <div class="row">
      <div class="psection"><span class="name">▤ Instructions <span class="muted" style="font-weight:400;font-size:11.5px">— injected ahead of every run started in this project</span></span>
        <span id="pSaved" class="pcharcount"></span></div>
      <div class="presetrow">${P_PRESETS.map((x, i) => `<span class="presetchip" data-preset="${i}">+ ${esc(x.label)}</span>`).join('')}</div>
      <textarea id="pInstr" style="min-height:120px;margin:8px 0 0;resize:vertical" placeholder="e.g. You are working on the Jarvis persona. Prefer the donor patterns in the attached files. Keep replies short…">${esc(p.instructions)}</textarea>
      <div class="flex" style="margin-top:8px"><button id="pSave" class="ghost">Save instructions</button>
        <button id="pChat" style="margin-left:auto">▷ Start a chat in this project</button></div>
    </div>

    <div class="row">
      <div class="psection"><span class="name">◇ Attached files <span class="muted" style="font-weight:400;font-size:11.5px">— ${files.length} in this project</span></span>
        ${files.length ? '<button id="pManifest" class="ghost" style="padding:5px 11px;font-size:11px">Show manifest</button>' : ''}</div>
      <div id="pManifestBox" class="hidden"></div>
      <div class="dropzone" id="pDrop" style="margin-top:8px">Drop files here or click to add<br><span class="muted" style="font-size:11.5px">50 MB per upload · grouped under data/inbox/${esc(p.slug)}/</span></div>
      <input type="file" id="pFileIn" multiple class="hidden">
      <div id="pUpStatus" class="badgebar" style="margin:8px 0"></div>
      <div id="pFiles" class="pfiles-grid">${files.length ? files.map(projFileTile).join('') : '<div class="muted">No files yet.</div>'}</div>
    </div>

    <div class="row">
      <span class="name">▷ Recent runs <span class="muted" style="font-weight:400;font-size:11.5px">— launched in this project</span></span>
      ${runs.length ? runsTable(runs) : '<div class="muted" style="margin-top:6px">No runs yet. Start a chat here and it shows up in this list.</div>'}
    </div>

    <div class="row">
      <span class="name">✦ Project memory <span class="muted" style="font-weight:400;font-size:11.5px">— engram recall scoped to this project (its own runs + notes; no vectors)</span></span>
      <div id="pMem" style="margin-top:8px">${mem.length ? mem.map(memTile).join('') : '<div class="muted">No project memories yet. Runs started here, and notes you add, become recallable context.</div>'}</div>
      <div class="flex" style="margin-top:8px"><input class="search" id="pNote" placeholder="Add a note to project memory…" style="max-width:520px;margin:0"><button id="pNoteAdd" class="ghost">Add note</button></div>
    </div>`;

  $('#pBack').onclick = () => { projSel = null; renderers.projects(); };
  wireDelete(p);
  const saveMeta = async (patch, note) => {
    const s = $('#pSaved'); if (s && note) s.textContent = 'saving…';
    try { await api('/api/projects/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ id: p.id }, patch)) }); if (s && note) s.textContent = note; }
    catch { if (s) s.textContent = 'save failed'; }
  };
  $('#pName').onchange = e => { const v = e.target.value.trim(); if (v) saveMeta({ name: v }); };
  $('#pDesc').onchange = e => saveMeta({ description: e.target.value });

  // instructions: live char count + preset chips + save
  const instr = $('#pInstr'), saved = $('#pSaved');
  const count = () => { saved.textContent = `${instr.value.length} / 12000`; };
  instr.oninput = count; count();
  el.querySelectorAll('.presetchip').forEach(c => c.onclick = () => {
    const t = P_PRESETS[+c.dataset.preset].text;
    instr.value += (instr.value && !instr.value.endsWith('\n') ? '\n' : '') + t;
    instr.focus(); count();
  });
  $('#pSave').onclick = () => { saveMeta({ instructions: instr.value }, 'saved ✓'); };
  $('#pChat').onclick = () => { if (typeof bindRunProject === 'function') bindRunProject({ id: p.id, name: p.name }); if (typeof prefillRun === 'function') prefillRun(''); };

  // file manifest — what the model actually sees as paths
  if ($('#pManifest')) $('#pManifest').onclick = () => {
    const box = $('#pManifestBox'), btn = $('#pManifest');
    if (box.classList.contains('hidden')) {
      box.innerHTML = `<div class="pmanifest">${files.map(f => esc(f.name)).join('\n')}</div>`;
      box.classList.remove('hidden'); btn.textContent = 'Hide manifest';
    } else { box.classList.add('hidden'); btn.textContent = 'Show manifest'; }
  };

  // files: reuse the inbox endpoints, scoped to this project's slug
  const drop = $('#pDrop'), fin = $('#pFileIn');
  drop.onclick = () => fin.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); projUpload(p.slug, e.dataTransfer.files); };
  fin.onchange = () => { projUpload(p.slug, fin.files); fin.value = ''; };
  el.querySelectorAll('.projTile[data-img]').forEach(t => t.onclick = () => showProjImage(t.dataset.name));
  el.querySelectorAll('.pDelFile').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'confirm?'; setTimeout(() => { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = 'remove'; } }, 2600); return; }
    try { await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.name }) }); } catch {}
    renderProjectDetail(id);
  });

  // recent-runs rows → open the run in the Sessions/history view if available
  el.querySelectorAll('tr.prun[data-id]').forEach(tr => tr.onclick = () => {
    const rid = tr.dataset.id;
    if (typeof openRun === 'function') openRun(rid);
    else if (typeof showTab === 'function') showTab('sessions');
  });

  // Claude sessions → open the transcript read-only
  el.querySelectorAll('.psession-row[data-sid]').forEach(row => row.onclick = () => showTranscript(p.id, row.dataset.sid, row.dataset.title));

  // project memory note
  $('#pNoteAdd').onclick = async () => {
    const t = $('#pNote').value.trim();
    if (!t) return;
    try { await api('/api/projects/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, text: t }) }); } catch {}
    $('#pNote').value = '';
    renderProjectDetail(id);
  };
}

// Two-step delete in place of a confirm() dialog.
function wireDelete(p) {
  const b = $('#pDel');
  b.onclick = async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm — files stay in inbox'; setTimeout(() => { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = 'Delete project'; } }, 3000); return; }
    try { await api('/api/projects/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) }); } catch {}
    projSel = null; renderers.projects();
  };
}

function runsTable(runs) {
  return `<table class="pruns"><thead><tr><th>When</th><th>Model</th><th>Duration</th><th>Cost</th><th>Status</th><th>Prompt</th></tr></thead>
    <tbody>${runs.map(runRow).join('')}</tbody></table>`;
}
function runRow(r) {
  const cost = r.costUsd ? '$' + r.costUsd.toFixed(2) : '—';
  const dur = r.durationMs ? (r.durationMs >= 1000 ? Math.round(r.durationMs / 1000) + 's' : r.durationMs + 'ms') : '—';
  const stCls = r.status === 'done' ? 'ok' : (r.status === 'error' ? 'err' : (r.status === 'running' ? 'neutral' : 'warn'));
  return `<tr class="prun" data-id="${esc(r.id)}">
    <td class="mono muted">${r.startedAt ? rel(r.startedAt) : '—'}</td>
    <td><span class="pill neutral">${esc(r.model)}</span></td>
    <td class="mono muted">${dur}</td>
    <td class="mono muted">${cost}</td>
    <td><span class="pill ${stCls}">${esc(r.status)}</span></td>
    <td class="mono ptrunc" title="${esc(r.prompt || '')}">${esc((r.prompt || '').slice(0, 90)) || '—'}</td>
  </tr>`;
}

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

// One archived Claude Code session, clickable to open its transcript read-only.
function sessionRow(s) {
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  const title = s.title || '(no opening message)';
  return `<div class="psession-row card clickable" data-sid="${esc(s.sid)}" data-title="${esc(title)}" style="padding:11px 13px">
    <div class="name" style="font-size:13px;font-weight:600">${esc(title.slice(0, 120))}</div>
    <div class="flex muted" style="gap:8px;flex-wrap:wrap;font-size:11px;margin-top:5px">
      <span>${s.messages} message${s.messages === 1 ? '' : 's'}</span>
      ${s.branch ? `<span>· ${esc(s.branch)}</span>` : ''}
      <span>· ${fmt(s.sizeBytes)}</span>
      ${s.lastAt ? `<span>· ${rel(s.lastAt)}</span>` : ''}
      <span class="mono" style="margin-left:auto">${esc(s.sid.slice(0, 8))}</span>
    </div>
  </div>`;
}

// Read-only transcript viewer overlay for an archived Claude session.
async function showTranscript(projId, sid, title) {
  let ov = $('#projTranscript');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'projTranscript';
  ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:#000000cc;display:grid;place-items:center;padding:24px';
  ov.innerHTML = `<div style="width:min(860px,94vw);max-height:90vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--r)">
    <div class="flex" style="justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line)">
      <span class="name" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title || sid)}</span>
      <button class="ghost close" style="padding:5px 12px;font-size:12px">Close ✕</button></div>
    <div id="ptBody" style="overflow:auto;padding:16px 18px"><div class="muted">Loading transcript…</div></div></div>`;
  ov.onclick = e => { if (e.target === ov || e.target.classList.contains('close')) ov.remove(); };
  document.body.appendChild(ov);
  let d;
  try { d = await api('/api/projects/session?id=' + encodeURIComponent(projId) + '&sid=' + encodeURIComponent(sid)); }
  catch (e) { $('#ptBody').innerHTML = `<div class="note">Couldn't load: ${esc(e.message || 'network error')}</div>`; return; }
  if (!d.session) { $('#ptBody').innerHTML = '<div class="note">Session not found.</div>'; return; }
  const s = d.session;
  const turns = (s.messages || []).map(m => {
    const who = m.role === 'user' ? 'You' : 'Claude';
    const tools = (m.tools && m.tools.length) ? `<div class="muted mono" style="font-size:10.5px;margin-top:4px">▷ ${m.tools.map(esc).join(' · ')}</div>` : '';
    return `<div style="margin-bottom:14px">
      <div class="name" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${m.role === 'user' ? 'var(--accent)' : 'var(--muted)'}">${who}</div>
      ${m.text ? `<div style="white-space:pre-wrap;font-size:12.5px;line-height:1.55;margin-top:3px">${esc(m.text)}</div>` : ''}
      ${tools}</div>`;
  }).join('');
  $('#ptBody').innerHTML = (turns || '<div class="muted">Empty transcript.</div>')
    + (s.truncated ? '<div class="note" style="font-size:11.5px">Transcript truncated — showing the first 600 turns.</div>' : '');
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
