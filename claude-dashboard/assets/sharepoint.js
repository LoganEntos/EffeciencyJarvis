/* SharePoint tab: device-code sign-in (user authenticates at microsoft.com/
   devicelogin — the hub never touches the password), live site/drive/folder
   browser with pull-to-inbox and push-from-inbox, and the full-tenant index
   (delta crawl) + graphify hook so runs stop paying to rediscover the tree. */
'use strict';

const SP = { site: '', drive: '', crumbs: [] };

renderers.sharepoint = async function () {
  const el = $('#sharepoint');
  if (!el.querySelector('#spAuth')) {
    el.innerHTML = `
      <h2>SharePoint <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— browse live, pull into the inbox, index everything once</span></h2>
      <div class="row" id="spAuth"><div class="muted">Loading…</div></div>
      <div class="row" id="spIndex" style="margin-top:10px"></div>
      <div class="row" id="spBrowse" style="margin-top:10px"></div>`;
  }
  await spStatus();
};
renderers.sharepoint.noSkeleton = true;

async function spStatus() {
  let s;
  try { s = await api('/api/sharepoint/status'); } catch { $('#spAuth').innerHTML = '<div class="muted">SharePoint module unavailable.</div>'; return; }
  spRenderAuth(s);
  spRenderIndex(s);
  if (s.authed) spRenderBrowse(); else $('#spBrowse').innerHTML = '<div class="muted">Sign in to browse SharePoint.</div>';
  if (s.pending && !s.pending.error) setTimeout(() => { if ($('#spAuth')) spStatus(); }, 3000);
}

function spRenderAuth(s) {
  const el = $('#spAuth');
  if (s.authed) {
    el.innerHTML = `<div class="flex" style="justify-content:space-between">
      <span><span class="pill ok">connected</span> <span class="mono" style="font-size:12px">${esc(s.account || '')}</span></span>
      <button class="ghost" id="spLogout" style="padding:6px 12px;font-size:11.5px">disconnect</button></div>`;
    $('#spLogout').onclick = async () => { await api('/api/sharepoint/logout', { method: 'POST' }); spStatus(); };
    return;
  }
  if (s.pending && !s.pending.error) {
    el.innerHTML = `<div><span class="pill warn">waiting for sign-in</span>
      <div style="margin-top:10px">Go to <a class="link" href="${esc(s.pending.verification_uri)}" target="_blank" rel="noopener">${esc(s.pending.verification_uri)}</a>
      and enter code <span class="mono" style="font-size:20px;letter-spacing:3px;color:var(--accent)">${esc(s.pending.user_code)}</span></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">Sign in with your Microsoft 365 account — the hub only ever holds the resulting token, never your password.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="flex" style="flex-wrap:wrap;gap:10px">
      <button id="spConnect">⊞ Connect Microsoft 365</button>
      ${s.pending && s.pending.error ? `<span class="pill err">${esc(s.pending.error)}</span>` : ''}
      <span class="muted" style="font-size:11.5px">tenant: <span class="mono">${esc(s.tenant)}</span>${s.customClient ? ' · custom app' : ' · Microsoft public client'}</span>
    </div>
    <details style="margin-top:8px"><summary class="muted" style="font-size:11.5px;cursor:pointer">advanced: tenant / app registration</summary>
      <div class="flex" style="margin-top:8px;flex-wrap:wrap">
        <input class="search" id="spTenant" placeholder="tenant (e.g. entosgroup.onmicrosoft.com or organizations)" style="max-width:340px" value="${esc(s.tenant)}">
        <input class="search" id="spClient" placeholder="client id (GUID, optional)" style="max-width:340px" value="${esc(s.customClient ? s.clientId : '')}">
        <button class="ghost" id="spCfgSave" style="padding:6px 12px;font-size:11.5px">save</button>
      </div></details>`;
  $('#spConnect').onclick = async () => {
    const r = await api('/api/sharepoint/auth/start', { method: 'POST' });
    if (r.error) { $('#spAuth').insertAdjacentHTML('beforeend', `<div class="pill err" style="margin-top:8px">${esc(r.error)}</div>`); return; }
    spStatus();
  };
  $('#spCfgSave').onclick = async () => {
    await api('/api/sharepoint/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: $('#spTenant').value.trim(), clientId: $('#spClient').value.trim() }) });
    spStatus();
  };
}

function spRenderIndex(s) {
  const el = $('#spIndex');
  const idx = s.index, cr = s.crawl;
  const running = cr && cr.running;
  el.innerHTML = `<div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span><strong>Index</strong>
        ${idx ? `<span class="pill ok">${idx.counts.files.toLocaleString()} files · ${idx.counts.drives} drives · ${idx.counts.sites} sites</span>
          <span class="muted" style="font-size:11.5px">built ${new Date(idx.builtAt).toLocaleString()}</span>`
    : '<span class="pill neutral">not built yet</span>'}
        ${running ? `<span class="pill warn">${esc(cr.phase)} — ${cr.files.toLocaleString()} files so far</span>` : ''}
        ${cr && cr.error ? `<span class="pill err">${esc(cr.error)}</span>` : ''}
      </span>
      <span class="flex">
        <button class="ghost" id="spBuild" ${running || !s.authed ? 'disabled' : ''} style="padding:6px 12px;font-size:11.5px">⟲ ${idx ? 'Rebuild' : 'Build'} index</button>
        <button class="ghost" id="spGraphify" ${idx ? '' : 'disabled'} style="padding:6px 12px;font-size:11.5px" title="feed the index into the knowledge graph so runs can query SharePoint structure without scanning">⬡ Graphify</button>
      </span></div>
    <div class="flex" style="margin-top:10px">
      <input class="search" id="spSearch" placeholder="Search the index — instant, no Graph calls…" ${idx ? '' : 'disabled'}>
    </div><div id="spHits"></div>`;
  $('#spBuild').onclick = async () => {
    const r = await api('/api/sharepoint/index', { method: 'POST' });
    if (r.error) { alert(r.error); return; }
    spPollCrawl();
  };
  if (running) spPollCrawl();
  $('#spGraphify').onclick = async () => {
    const r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      prompt: '/graphify claude-dashboard/data/sharepoint-index.json — ingest the SharePoint file index (sites → drives → file paths with sizes and modified dates) into the knowledge graph, replacing any earlier SharePoint ingest, so future runs can locate SharePoint files and answer structure questions from the graph instead of calling Microsoft Graph or re-scanning.',
      model: 'auto' }) });
    $('#spGraphify').outerHTML = r.error ? `<span class="pill err">${esc(r.error)}</span>` : '<span class="pill ok">graphify run started — watch it in the Run tab</span>';
  };
  $('#spSearch').oninput = spDebounceSearch;
}

let spSearchT = null;
function spDebounceSearch() { clearTimeout(spSearchT); spSearchT = setTimeout(spDoSearch, 250); }
async function spDoSearch() {
  const q = $('#spSearch').value.trim(), box = $('#spHits');
  if (!q) { box.innerHTML = ''; return; }
  const r = await api('/api/sharepoint/index/search?q=' + encodeURIComponent(q));
  if (r.error) { box.innerHTML = `<div class="pill err" style="margin-top:8px">${esc(r.error)}</div>`; return; }
  box.innerHTML = (r.hits || []).slice(0, 50).map(h => `
    <div class="flex" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
      <span style="min-width:0"><span class="mono" style="font-size:12px">${esc(h.path)}</span>
        <span class="muted" style="font-size:11px"> · ${esc(h.site)} / ${esc(h.drive)}</span></span>
      <button class="ghost spPull" data-drive="${esc(h.driveId)}" data-item="${esc(h.itemId)}" style="padding:4px 10px;font-size:11px">⇩ Pull</button>
    </div>`).join('') + (r.truncated ? '<div class="muted" style="font-size:11px;margin-top:6px">200+ matches — narrow the search</div>' : '');
  box.querySelectorAll('.spPull').forEach(b => b.onclick = () => spPull(b));
}

function spPollCrawl() {
  const t = setInterval(async () => {
    if (!$('#spIndex')) return clearInterval(t);
    const st = await api('/api/sharepoint/index/status').catch(() => null);
    if (!st) return;
    if (!st.crawl.running) { clearInterval(t); spStatus(); return; }
    const pill = $('#spIndex .pill.warn');
    if (pill) pill.textContent = `${st.crawl.phase} — ${st.crawl.files.toLocaleString()} files so far`;
    else spStatus();
  }, 2000);
}

async function spRenderBrowse() {
  const el = $('#spBrowse');
  if (!el.querySelector('#spSites')) {
    el.innerHTML = `<div class="flex" style="flex-wrap:wrap;gap:8px">
        <strong>Browse</strong>
        <select id="spSites"><option value="">— site —</option></select>
        <select id="spDrives" class="hidden"><option value="">— library —</option></select>
        <input class="search" id="spProject" placeholder="pull into project folder (optional)" style="max-width:260px" title="pulled files land in data/inbox/<project>/ — point a run at the folder to work the project">
      </div>
      <div id="spCrumbs" style="margin:10px 0 4px;font-size:12px"></div>
      <div id="spList"></div>`;
    const sites = await api('/api/sharepoint/sites').catch(() => []);
    if (sites.error) { el.innerHTML = `<div class="pill err">${esc(sites.error)}</div>`; return; }
    $('#spSites').innerHTML = '<option value="">— site —</option>' + sites.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.webUrl)}</option>`).join('');
    $('#spSites').onchange = async () => {
      SP.site = $('#spSites').value; SP.drive = ''; SP.crumbs = [];
      $('#spList').innerHTML = ''; $('#spCrumbs').innerHTML = '';
      if (!SP.site) return $('#spDrives').classList.add('hidden');
      const drives = await api('/api/sharepoint/drives?site=' + encodeURIComponent(SP.site)).catch(() => []);
      $('#spDrives').innerHTML = '<option value="">— library —</option>' + (drives || []).map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
      $('#spDrives').classList.remove('hidden');
      $('#spDrives').onchange = () => { SP.drive = $('#spDrives').value; SP.crumbs = [{ id: 'root', name: 'root' }]; if (SP.drive) spList(); };
    };
  }
}

async function spList() {
  const cur = SP.crumbs[SP.crumbs.length - 1];
  $('#spCrumbs').innerHTML = SP.crumbs.map((c, i) =>
    `<a class="link spCrumb" data-i="${i}">${esc(c.name)}</a>`).join(' <span class="muted">/</span> ')
    + ` <button class="ghost" id="spAddHere" style="padding:2px 10px;font-size:11px;margin-left:10px" title="upload an inbox file into this SharePoint folder">⇪ Add file here</button><span id="spAddBox"></span>`;
  $('#spCrumbs').querySelectorAll('.spCrumb').forEach(a => a.onclick = () => { SP.crumbs = SP.crumbs.slice(0, +a.dataset.i + 1); spList(); });
  $('#spAddHere').onclick = spAddHere;
  $('#spList').innerHTML = '<div class="muted">Loading…</div>';
  const items = await api(`/api/sharepoint/children?drive=${encodeURIComponent(SP.drive)}&item=${encodeURIComponent(cur.id)}`).catch(e => ({ error: e.message }));
  if (items.error) { $('#spList').innerHTML = `<div class="pill err">${esc(items.error)}</div>`; return; }
  const fmt = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' B');
  $('#spList').innerHTML = items.map(it => it.folder
    ? `<div class="flex spDir" data-id="${esc(it.id)}" data-name="${esc(it.name)}" style="padding:7px 0;border-bottom:1px solid var(--line);cursor:pointer">
         <span>▸ <strong>${esc(it.name)}</strong> <span class="muted" style="font-size:11px">${it.childCount ?? ''} items</span></span></div>`
    : `<div class="flex" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)">
         <span style="min-width:0" class="mono" title="${esc(it.name)}" >${esc(it.name)} <span class="muted" style="font-size:11px">${fmt(it.size)}${it.modified ? ' · ' + new Date(it.modified).toLocaleDateString() : ''}</span></span>
         <button class="ghost spPull" data-drive="${esc(SP.drive)}" data-item="${esc(it.id)}" style="padding:4px 10px;font-size:11px">⇩ Pull</button></div>`
  ).join('') || '<div class="muted">Empty folder.</div>';
  $('#spList').querySelectorAll('.spDir').forEach(d => d.onclick = () => { SP.crumbs.push({ id: d.dataset.id, name: d.dataset.name }); spList(); });
  $('#spList').querySelectorAll('.spPull').forEach(b => b.onclick = () => spPull(b));
}

async function spPull(btn) {
  const project = ($('#spProject') && $('#spProject').value.trim()) || '';
  btn.disabled = true; btn.textContent = '…';
  const r = await api('/api/sharepoint/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drive: btn.dataset.drive, item: btn.dataset.item, project }), timeoutMs: 120000 }).catch(e => ({ error: e.message }));
  btn.disabled = false;
  btn.outerHTML = r.error ? `<span class="pill err" style="font-size:11px">${esc(r.error)}</span>`
    : `<span class="pill ok" style="font-size:11px">→ inbox/${esc(r.saved)}</span>`;
}

async function spAddHere() {
  const box = $('#spAddBox');
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const files = await api('/api/files').catch(() => []);
  if (!Array.isArray(files) || !files.length) { box.innerHTML = '<span class="muted" style="font-size:11px;margin-left:8px">inbox is empty</span>'; return; }
  box.innerHTML = ` <select id="spPushSel">${files.map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('')}</select>
    <button class="ghost" id="spPushGo" style="padding:2px 10px;font-size:11px">upload</button>`;
  $('#spPushGo').onclick = async () => {
    const cur = SP.crumbs[SP.crumbs.length - 1];
    $('#spPushGo').disabled = true; $('#spPushGo').textContent = '…';
    const r = await api('/api/sharepoint/push', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('#spPushSel').value, drive: SP.drive, parent: cur.id }), timeoutMs: 300000 }).catch(e => ({ error: e.message }));
    box.innerHTML = r.error ? `<span class="pill err" style="font-size:11px">${esc(r.error)}</span>` : '<span class="pill ok" style="font-size:11px">uploaded ✓</span>';
    if (!r.error) spList();
  };
}
