/* Projects tab — detail view: Instructions, Attached files, inline chat
   (projectchat.js), Recent runs, Project memory, plus (for archived Claude Code
   workspaces) read-only Sessions. Split out of projects.js to keep both files
   under the 500-line cap; shares projSel/projCache and the grid helpers with
   projects.js via the page's top-level script scope (same pattern jarvistab.js
   / jarvischat.js already use). */
'use strict';

// Instruction starter templates — chips insert these so a blank project isn't
// a blank page. Kept deliberately terse; the user fills the specifics.
const P_PRESETS = [
  { label: 'Persona', text: 'You are working inside this project. Hold this voice and priorities on every reply:\n- ' },
  { label: 'Coding style', text: 'Coding conventions here:\n- Match the surrounding code; introduce no new dependencies.\n- Keep changes small and browser-verified before commit.\n' },
  { label: 'Output format', text: 'When you report back:\n- Lead with a one-line summary.\n- Then concrete next steps as short bullets.\n' },
  { label: 'Guardrails', text: 'Hard rules for this project:\n- Never touch files outside it.\n- Ask before any irreversible or outward-facing action.\n' },
];

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

  const secInstr = `
    <div class="row">
      <div class="psection"><span class="name">▤ Instructions <span class="muted" style="font-weight:400;font-size:11.5px">— injected ahead of every run started in this project</span></span>
        <span id="pSaved" class="pcharcount"></span></div>
      <div class="presetrow">${P_PRESETS.map((x, i) => `<span class="presetchip" data-preset="${i}">+ ${esc(x.label)}</span>`).join('')}</div>
      <textarea id="pInstr" style="min-height:120px;margin:8px 0 0;resize:vertical" placeholder="e.g. You are working on the Jarvis persona. Prefer the donor patterns in the attached files. Keep replies short…">${esc(p.instructions)}</textarea>
      <div class="flex" style="margin-top:8px"><button id="pSave" class="ghost">Save instructions</button>
        <button id="pChat" class="ghost" style="margin-left:auto">⤴ Escalate to Run tab</button></div>
    </div>`;

  const secFiles = `
    <div class="row">
      <div class="psection"><span class="name">◇ Attached files <span class="muted" style="font-weight:400;font-size:11.5px">— ${files.length} in this project</span></span>
        ${files.length ? '<button id="pManifest" class="ghost" style="padding:5px 11px;font-size:11px">Show manifest</button>' : ''}</div>
      <div id="pManifestBox" class="hidden"></div>
      <div class="dropzone" id="pDrop" style="margin-top:8px">Drop files here or click to add<br><span class="muted" style="font-size:11.5px">50 MB per upload · grouped under data/inbox/${esc(p.slug)}/</span></div>
      <input type="file" id="pFileIn" multiple class="hidden">
      <div id="pUpStatus" class="badgebar" style="margin:8px 0"></div>
      <div id="pFiles" class="pfiles-grid">${files.length ? files.map(projFileTile).join('') : '<div class="muted">No files yet.</div>'}</div>
    </div>`;

  const secChat = `
    <div class="row">
      <div class="psection"><span class="name">▷ Chat in this project <span class="muted" style="font-weight:400;font-size:11.5px">— runs here auto-carry the instructions, files and memory above</span></span></div>
      <div id="pChatMount" style="margin-top:8px"></div>
    </div>`;

  // Empty-state UX: a brand-new project with no files and no instructions
  // otherwise stacks three empty setup sections above the chat. Lead with the
  // chat so the first thing you see is somewhere to start.
  const emptyStart = !claude && files.length === 0 && !(p.instructions && p.instructions.trim());
  const setupSections = emptyStart ? (secChat + secInstr + secFiles) : (secInstr + secFiles + secChat);

  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:flex-start;margin-bottom:4px">
      <button id="pBack" class="ghost" style="padding:5px 11px;font-size:11.5px">← All projects</button>
      <button id="pDel" class="danger" style="padding:5px 11px;font-size:11px">Delete project</button>
    </div>
    <input id="pName" value="${esc(p.name)}" style="font-family:var(--font-body);font-size:24px;font-weight:800;letter-spacing:-.02em;background:none;border:none;padding:0;margin:2px 0;width:100%">
    <input class="search" id="pDesc" value="${esc(p.description)}" placeholder="Short description (optional)" style="max-width:560px;margin:4px 0 10px">
    <div class="badgebar" style="margin:0 0 10px">
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
    ${setupSections}

    <div class="row" id="pRunsSection">${runsSection(runs)}</div>

    <div class="row">
      <div class="psection"><span class="name">✦ Project memory <span class="muted" style="font-weight:400;font-size:11.5px">— engram recall scoped to this project (its own runs + notes; no vectors)</span></span></div>
      <div id="pMem" style="margin-top:8px">${mem.length ? mem.map(memTile).join('') : '<div class="muted">No project memories yet. Runs started here, and notes you add, become recallable context.</div>'}</div>
      <div class="flex" style="margin-top:8px"><input class="search" id="pNote" placeholder="Add a note to project memory…" style="max-width:520px;margin:0"><button id="pNoteAdd" class="ghost">Add note</button></div>
    </div>`;

  $('#pBack').onclick = () => { if (window.projectChat && projectChat.destroy) projectChat.destroy(); projSel = null; renderers.projects(); };
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

  // inline chat panel — instructions/files/memory above ride every message via projectSlug
  const chatMount = $('#pChatMount');
  if (chatMount && window.projectChat) projectChat.mount(chatMount, { id: p.id, slug: p.slug, name: p.name });

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
  el.querySelectorAll('.projTile[data-doc]').forEach(t => t.onclick = () => { if (typeof showDocViewer === 'function') showDocViewer(t.dataset.name); });
  el.querySelectorAll('.pDelFile').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'confirm?'; setTimeout(() => { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = 'remove'; } }, 2600); return; }
    try { await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: b.dataset.name }) }); } catch {}
    renderProjectDetail(id);
  });

  // recent-runs rows → open the run in the Sessions/history view if available
  wireRunRows(el);

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

// The runs section body (header + table|empty), rebuilt on its own so an
// in-place refresh doesn't reload files/memory/sessions and jump scroll.
function runsSection(runs) {
  return `<div class="psection"><span class="name">▷ Recent runs <span class="muted" style="font-weight:400;font-size:11.5px">— launched in this project</span></span></div>
    ${runs.length ? runsTable(runs) : '<div class="muted" style="margin-top:6px">No runs yet. Send a message above and it shows up in this list.</div>'}`;
}
// Fetch just this project's runs and swap the runs section in place, preserving
// scroll. Called by projectchat.js on run done/error instead of the whole view.
async function refreshProjectRuns(id, preRuns) {
  const sec = $('#pRunsSection'); if (!sec) return;
  let runs = preRuns;
  if (!runs) {
    let d;
    try { d = await api('/api/projects/get?id=' + encodeURIComponent(id)); } catch { return; }
    if (d.error) return;
    runs = d.runs || [];
  }
  sec.innerHTML = runsSection(runs);
  wireRunRows(sec);
}
// Recent-runs rows → open the run in the Sessions/history view if available.
function wireRunRows(root) {
  (root || document).querySelectorAll('tr.prun[data-id]').forEach(tr => tr.onclick = () => {
    const rid = tr.dataset.id;
    if (typeof openRun === 'function') openRun(rid);
    else if (typeof showTab === 'function') showTab('sessions');
  });
}
function runsTable(runs) {
  return `<div class="pruns-wrap"><table class="pruns"><thead><tr><th>When</th><th>Model</th><th>Duration</th><th>Tokens</th><th>Status</th><th>Prompt</th></tr></thead>
    <tbody>${runs.map(runRow).join('')}</tbody></table></div>`;
}
function runRow(r) {
  const tok = (r.tokensIn || r.tokensOut) ? fmtTok((r.tokensIn || 0) + (r.tokensOut || 0)) : '—';
  const dur = r.durationMs ? (r.durationMs >= 1000 ? Math.round(r.durationMs / 1000) + 's' : r.durationMs + 'ms') : '—';
  const stCls = r.status === 'done' ? 'ok' : (r.status === 'error' ? 'err' : (r.status === 'running' ? 'neutral' : 'warn'));
  return `<tr class="prun" data-id="${esc(r.id)}">
    <td class="mono muted">${r.startedAt ? rel(r.startedAt) : '—'}</td>
    <td><span class="pill neutral">${esc(r.model)}</span></td>
    <td class="mono muted">${dur}</td>
    <td class="mono muted">${tok}</td>
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
  // Text-like docs (md/csv/json/logs/code) open in the shared in-app document
  // viewer (showDocViewer, files.js) — same traversal-guarded /text endpoint.
  const isDoc = !isImg && typeof fileKind === 'function' && fileKind(f.base) === 'text';
  const pn = prettyBase(f.base);
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  const openAttrs = isImg ? ` class="projTile" data-img="1" data-name="${esc(f.name)}"`
    : isDoc ? ` class="projTile" data-doc="1" data-name="${esc(f.name)}"` : '';
  return `<div style="${P_TILE}${isImg || isDoc ? ';cursor:pointer' : ''}"${openAttrs}>
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
    // Retry with the `files` snapshot, not the live `fileList` — the picker's
    // input was cleared (fin.value='') right after the first call, so the
    // original FileList is now empty and would silently upload nothing.
    if (confirm(`Already attached: ${(r.conflicts || []).join(', ')}\n\nOverwrite?`)) return projUpload(slug, files, true);
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
