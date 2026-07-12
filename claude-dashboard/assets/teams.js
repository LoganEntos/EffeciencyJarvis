/* Agent teams UI (Agents tab): pick the active team, see its specialists +
   skills, and create custom teams. Server: lib/teams.js. Uses global api/esc/$. */
'use strict';
window.HubTeams = (function () {
  const jpost = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const chips = (arr, cls) => (arr && arr.length ? arr.map(x => `<span class="pill ${cls}" style="margin:2px 4px 2px 0">${esc(x)}</span>`).join('') : '<span class="muted" style="font-size:11px">—</span>');

  async function renderInto(el) {
    if (!el) return;
    let d;
    try { d = await api('/api/teams'); } catch { el.innerHTML = '<div class="muted">Teams unavailable.</div>'; return; }
    const active = d.teams.find(t => t.id === d.active) || d.teams[0];
    const opts = d.teams.map(t => `<option value="${esc(t.id)}"${t.id === d.active ? ' selected' : ''}>${esc(t.name)}${t.builtin ? '' : ' (custom)'}</option>`).join('');
    el.innerHTML = `<div class="row" style="margin-bottom:16px">
      <div class="flex" style="justify-content:space-between;margin-bottom:8px">
        <span><span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Active team</span>
          <select class="search" id="teamSel" style="margin:4px 0 0;min-width:180px">${opts}</select></span>
        ${active.builtin ? '' : '<button class="danger" id="teamDel" data-id="' + esc(active.id) + '" style="padding:3px 10px;font-size:11px;height:fit-content">delete</button>'}
      </div>
      <div class="muted" style="font-size:12px;white-space:normal;margin-bottom:8px">${esc(active.description || '')}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Specialists</div>
      <div style="margin-bottom:8px">${chips(active.agents, 'neutral')}</div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Skills</div>
      <div>${chips(active.skills, 'ok')}</div>
      <div class="muted" style="font-size:10.5px;margin-top:8px">${active.hint ? 'Its steering hint is injected into runs (visible as a ⛬ line in chat).' : 'No steering — runs behave as default (token-neutral).'}</div>
    </div>
    <details style="margin-bottom:18px"><summary style="cursor:pointer;font-size:12px;color:var(--accent)">＋ New team</summary>
      <div style="display:grid;gap:8px;margin-top:10px;max-width:620px">
        <div class="flex" style="gap:8px"><input class="search" id="ntId" placeholder="id (a-z0-9-, e.g. security)" style="margin:0;flex:1">
          <input class="search" id="ntName" placeholder="name (e.g. Security)" style="margin:0;flex:1"></div>
        <input class="search" id="ntDesc" placeholder="short description" style="margin:0">
        <div style="font-size:11px;color:var(--muted)">Specialists</div>
        <div id="ntAgents" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px">
          ${d.roster.map(a => `<label class="chk" style="font-size:11.5px"><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join('')}</div>
        <input class="search" id="ntSkills" placeholder="skills, comma-separated (optional)" style="margin:0">
        <textarea id="ntHint" placeholder="delegation-steering hint injected into runs (optional but recommended)" style="min-height:70px"></textarea>
        <div><button id="ntSave">Create team</button> <span id="ntMsg" class="muted" style="font-size:11px"></span></div>
      </div></details>`;
    $('#teamSel').onchange = async e => { await jpost('/api/teams/select', { id: e.target.value }); renderInto(el); };
    const del = $('#teamDel');
    if (del) del.onclick = async () => { if (confirm('Delete this custom team?')) { await jpost('/api/teams/delete', { id: del.dataset.id }); renderInto(el); } };
    $('#ntSave').onclick = async () => {
      const body = {
        id: $('#ntId').value.trim(), name: $('#ntName').value.trim(), description: $('#ntDesc').value.trim(),
        agents: [...$('#ntAgents').querySelectorAll('input:checked')].map(c => c.value),
        skills: $('#ntSkills').value.split(',').map(s => s.trim()).filter(Boolean),
        hint: $('#ntHint').value.trim(),
      };
      const r = await jpost('/api/teams/save', body);
      if (r.error) { $('#ntMsg').textContent = '✗ ' + r.error; $('#ntMsg').style.color = 'var(--red)'; }
      else { await jpost('/api/teams/select', { id: body.id }); renderInto(el); }
    };
  }
  return { renderInto };
})();
