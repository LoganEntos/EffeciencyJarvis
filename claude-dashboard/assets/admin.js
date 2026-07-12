/* Admin tools (Config tab): MCP connectors, site file editor, git.
   Server: lib/admin.js. Uses the global api()/esc()/$ helpers from app.js. */
'use strict';
window.HubAdmin = (function () {

  const jpost = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- MCP connectors ----------
  async function renderMcp(el) {
    let servers = {};
    try { servers = (await api('/api/admin/mcp')).servers || {}; } catch {}
    const rows = Object.entries(servers).map(([name, s]) => {
      const detail = s.url ? `${esc(s.type || 'http')} · ${esc(s.url)}` : `${esc(s.command || '')} ${esc((s.args || []).join(' '))}`;
      return `<div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span><span class="name mono">${esc(name)}</span><br><span class="muted" style="font-size:11px">${detail}</span></span>
        <button class="danger mcpDel" data-n="${esc(name)}" style="padding:3px 10px;font-size:11px">remove</button></div>`;
    }).join('') || '<div class="muted" style="font-size:12px">No MCP servers configured.</div>';
    el.innerHTML = `<h2 style="font-size:13px">MCP connectors <span class="muted" style="font-weight:400;font-size:11px">— .mcp.json</span></h2>
      <div class="note" style="margin:6px 0 12px;font-size:11px">⚠ Every MCP server here loads into <b>every</b> run's context (tokens). Add only what you use; prefer per-project over always-on.</div>
      ${rows}
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--accent)">＋ Add connector</summary>
        <div style="display:grid;gap:8px;margin-top:10px;max-width:560px">
          <input class="search" id="mcpName" placeholder="name (e.g. github)" style="margin:0">
          <select class="search" id="mcpType" style="margin:0">
            <option value="stdio">stdio — a local command</option>
            <option value="remote">remote — an http/sse URL</option>
          </select>
          <div id="mcpStdio" style="display:grid;gap:8px">
            <input class="search" id="mcpCmd" placeholder="command (e.g. npx or C:\\path\\to\\server.exe)" style="margin:0">
            <input class="search" id="mcpArgs" placeholder="args, space-separated (e.g. -y @modelcontextprotocol/server-github)" style="margin:0">
            <textarea id="mcpEnv" placeholder="env, one KEY=value per line (optional)" style="min-height:52px"></textarea>
          </div>
          <input class="search" id="mcpUrl" placeholder="https://… (remote only)" style="margin:0;display:none">
          <div><button id="mcpAdd">Add connector</button> <span id="mcpMsg" class="muted" style="font-size:11px"></span></div>
        </div></details>`;
    el.querySelectorAll('.mcpDel').forEach(b => b.onclick = async () => {
      if (!confirm(`Remove MCP server "${b.dataset.n}" from .mcp.json?`)) return;
      const r = await jpost('/api/admin/mcp/remove', { name: b.dataset.n });
      if (r.error) alert(r.error); else renderMcp(el);
    });
    const typeSel = $('#mcpType');
    typeSel.onchange = () => {
      const remote = typeSel.value === 'remote';
      $('#mcpStdio').style.display = remote ? 'none' : 'grid';
      $('#mcpUrl').style.display = remote ? 'block' : 'none';
    };
    $('#mcpAdd').onclick = async () => {
      const body = { name: $('#mcpName').value.trim() };
      if (typeSel.value === 'remote') { body.url = $('#mcpUrl').value.trim(); body.type = 'http'; }
      else {
        body.command = $('#mcpCmd').value.trim();
        body.args = $('#mcpArgs').value.trim();
        const env = {};
        $('#mcpEnv').value.split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
        if (Object.keys(env).length) body.env = env;
      }
      const r = await jpost('/api/admin/mcp', body);
      if (r.error) { $('#mcpMsg').textContent = '✗ ' + r.error; $('#mcpMsg').style.color = 'var(--red)'; }
      else renderMcp(el);
    };
  }

  // ---------- site file editor ----------
  let curFile = '';
  async function renderEditor(el) {
    let files = [];
    try { files = (await api('/api/admin/files')).files || []; } catch {}
    el.innerHTML = `<h2 style="font-size:13px;margin-top:26px">Site editor <span class="muted" style="font-weight:400;font-size:11px">— edit the hub's own files</span></h2>
      <div class="note" style="margin:6px 0 10px;font-size:11px">Front-end edits (index.html, assets/*.js/css) show after a page reload. <b>lib/*.js changes need a hub restart.</b> Saves write straight to disk — commit via the Git panel below.</div>
      <select class="search" id="edFile" style="margin:0 0 8px"><option value="">— pick a file —</option>
        ${files.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
      <textarea id="edBody" spellcheck="false" placeholder="Select a file to edit…" style="min-height:340px;font-family:var(--font-mono);font-size:12px;white-space:pre;overflow-wrap:normal;tab-size:2"></textarea>
      <div style="margin-top:8px"><button id="edSave" disabled>Save</button> <span id="edMsg" class="muted" style="font-size:11px"></span></div>`;
    const sel = $('#edFile'), body = $('#edBody'), save = $('#edSave'), msg = $('#edMsg');
    sel.onchange = async () => {
      curFile = sel.value; save.disabled = true; msg.textContent = '';
      if (!curFile) { body.value = ''; return; }
      body.value = 'loading…';
      try { const r = await api('/api/admin/file?path=' + encodeURIComponent(curFile)); body.value = r.content || ''; save.disabled = false; }
      catch { body.value = ''; msg.textContent = '✗ failed to load'; }
    };
    save.onclick = async () => {
      if (!curFile) return;
      save.disabled = true; msg.textContent = 'saving…'; msg.style.color = 'var(--muted)';
      const r = await jpost('/api/admin/file', { path: curFile, content: body.value });
      if (r.error) { msg.textContent = '✗ ' + r.error; msg.style.color = 'var(--red)'; }
      else { msg.textContent = `✓ saved ${r.bytes} bytes`; msg.style.color = 'var(--green)'; }
      save.disabled = false;
    };
  }

  // ---------- git ----------
  async function renderGit(el) {
    let g = {};
    try { g = await api('/api/admin/git'); } catch {}
    if (g.installed === false) { el.innerHTML = `<h2 style="font-size:13px;margin-top:26px">Git</h2><div class="note" style="font-size:11px">git not found on PATH.</div>`; return; }
    const changes = (g.changes || []).map(c => `<div class="mono" style="font-size:11px"><span style="color:var(--amber)">${esc(c.xy)}</span> ${esc(c.path)}</div>`).join('') || '<span class="muted" style="font-size:12px">clean working tree</span>';
    const ahead = g.ahead ? ` · ↑${g.ahead}` : '', behind = g.behind ? ` · ↓${g.behind}` : '';
    el.innerHTML = `<h2 style="font-size:13px;margin-top:26px">Git <span class="muted" style="font-weight:400;font-size:11px">— ${esc(g.branch || '?')}${ahead}${behind}</span></h2>
      <div class="row" style="margin-bottom:10px"><div style="margin-bottom:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Changes (${(g.changes || []).length})</div>${changes}</div>
      <div style="display:flex;gap:8px;max-width:640px"><input class="search" id="gitMsg" placeholder="commit message" style="margin:0;flex:1"><button id="gitCommit">Commit all</button></div>
      <span id="gitOut" class="muted" style="font-size:11px"></span>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:var(--accent)">recent commits</summary>
        <div style="margin-top:8px">${(g.log || []).map(l => `<div class="mono" style="font-size:11px">${esc(l)}</div>`).join('')}</div></details>`;
    $('#gitCommit').onclick = async () => {
      const m = $('#gitMsg').value.trim();
      if (!m) { $('#gitOut').textContent = 'message required'; return; }
      $('#gitOut').textContent = 'committing…';
      const r = await jpost('/api/admin/git/commit', { message: m });
      if (r.error) { $('#gitOut').textContent = '✗ ' + r.error; $('#gitOut').style.color = 'var(--red)'; }
      else { $('#gitOut').textContent = '✓ committed'; $('#gitOut').style.color = 'var(--green)'; renderGit(el); }
    };
  }

  function renderConfigPanels(container) {
    if (!container) return;
    container.innerHTML = `<h2 style="margin-top:30px">Tools</h2>
      <div id="admMcp"></div><div id="admEditor"></div><div id="admGit"></div>`;
    renderMcp($('#admMcp'));
    renderEditor($('#admEditor'));
    renderGit($('#admGit'));
  }

  return { renderConfigPanels };
})();
