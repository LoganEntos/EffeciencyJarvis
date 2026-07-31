/* List/detail view layer: generic list renderer + agents/skills/commands/
   sessions tabs, split out of app.js (keep files <500 lines). Registers
   into the global `renderers` map and uses app.js/util globals (api, $,
   esc, rel, load, goTab) at runtime — loads right after app.js. */
'use strict';

renderers.agents = async function () {
  let hermesOn = false;
  try { hermesOn = (await api('/api/settings')).hermesEnabled === true; } catch {}
  let h = { installed: false };
  if (hermesOn) { try { h = await api('/api/hermes'); } catch {} }
  const card = !hermesOn ? `
    <div class="note" style="margin-bottom:14px">Claude subagent stack — model-tiered specialists (haiku for mechanical work, sonnet for build/review, opus only for architecture/security). This is the hub's lean default. <span class="muted">hermes is a deprecated paid engine, hidden — re-enable in Config if needed.</span></div>`
    : h.installed ? `
    <div class="row" style="margin-bottom:14px">
      <div class="flex" style="justify-content:space-between">
        <span class="name">⚕ Hermes Agent <span class="muted" style="font-weight:400;font-size:11.5px">v${esc(h.version || '?')} — the hub's agentic stack (claude-flow library retired)</span></span>
        <span>${h.credentials ? '<span class="pill ok">ready</span>' : '<span class="pill warn">needs credentials</span>'}</span>
      </div>
      <div class="pex" style="white-space:normal;margin-top:6px">
        main model <span class="mono">${esc(h.model || '(auto)')}</span> · aux tasks auto-route to cheap models · subagents tierable via delegation config${h.credentials ? '' : ' · run <span class="mono">hermes auth add nous</span> or add an API key to finish setup'}
      </div>
    </div>` : `
    <div class="note" style="margin-bottom:14px">Hermes stack not detected — see <span class="mono">docs/hermes-adoption.md</span>.</div>`;
  await listView('#agents', 'Agents', '/api/agents', 'agents', card + '<div id="teamsPanel"></div>');
  if (window.HubTeams) HubTeams.renderInto($('#teamsPanel'));
};
renderers.skills = function () { return listView('#skills', 'Skills', '/api/skills', 'skills'); };
renderers.commands = function () { return listView('#commands', 'Commands', '/api/commands', 'commands'); };


renderers.sessions = async function () {
  // Deliberately NO .catch on /api/sessions: a genuine network failure must
  // still throw and propagate to load()'s own catch (app.js) — that's what
  // resets loaded['sessions']=false so revisiting the tab retries, and every
  // other tab still gets that for free. Only the HTTP-error {error} response
  // (api() resolves that instead of rejecting) needs handling here — see the
  // explicit check below, which a thrown network error never reaches.
  const [d, runsList, teamsD, sumD] = await Promise.all([
    api('/api/sessions'),
    api('/api/runs').catch(() => []),
    api('/api/teams').catch(() => null),
    api('/api/session-summaries').catch(() => ({ summaries: {} })),
  ]);
  // api() resolves an {error} object on HTTP 4xx/5xx instead of rejecting, so
  // a real server error here would otherwise fall through to `d.list || []`
  // below and render as "No session transcripts found" — indistinguishable
  // from a genuinely empty list. Surface it instead, with a retry.
  if (d && d.error) {
    $('#sessions').innerHTML = `<h2>Claude Code Sessions</h2>
      <div class="errhead">✗ Couldn't load sessions — ${esc(d.error)}.</div>
      <button class="ghost" id="sessRetryBtn" style="margin-top:8px">Retry</button>`;
    $('#sessRetryBtn').onclick = () => renderers.sessions();
    return;
  }
  const list = Array.isArray(d) ? d : (d.list || []);
  let summaries = (sumD && sumD.summaries) || {};
  // map each Claude Code session → the agent team of the hub run that produced it
  const teamBySid = {};
  (Array.isArray(runsList) ? runsList : []).forEach(m => { if (m.sessionId && m.team && !teamBySid[m.sessionId]) teamBySid[m.sessionId] = m.team; });
  const activeTeamName = (teamsD && Array.isArray(teamsD.teams)) ? ((teamsD.teams.find(t => t.id === teamsD.active) || {}).name || '') : '';
  const sumHtml = (s) => {
    const c = summaries[s.id];
    if (c && c.summary) return `<div class="desc sessSum" data-id="${esc(s.id)}" style="margin-top:8px">${esc(c.summary)}</div>`;
    return `<div class="desc sessSum" data-id="${esc(s.id)}" style="margin-top:8px;font-style:italic;opacity:.6">Summarizing…</div>`;
  };
  $('#sessions').innerHTML = `<h2>Claude Code Sessions (this project) <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— auto-summarized debriefs; peek at raw activity anytime</span></h2>
    ${activeTeamName ? `<div class="flex" style="margin:-2px 0 14px"><span class="pill neutral" title="the agent team the hub is steering right now">⛬ active team: ${esc(activeTeamName)}</span></div>` : ''}` +
    (list.length ? list.map((s, i) => `<div class="row" data-id="${esc(s.id)}">
      <div class="flex" style="justify-content:space-between">
        <span class="name mono">${i === 0 ? '<span class="dot ok"></span>' : ''}${esc(s.id.slice(0, 8))}…
          <span class="muted" style="font-weight:400;font-size:11.5px">${i === 0 ? 'newest' : ''}</span>${teamBySid[s.id] ? `<span class="pill neutral" style="font-size:10px" title="team that worked this thread">⛬ ${esc(teamBySid[s.id])}</span>` : ''}</span>
        <span class="muted" style="font-size:11.5px">${rel(s.modified)} · ${s.sizeKb} KB</span>
      </div>
      ${sumHtml(s)}
      <div class="flex" style="margin-top:8px">
        <button class="ghost peekBtn" data-id="${esc(s.id)}" style="padding:6px 12px;font-size:11.5px">Peek activity</button>
        <button class="ghost resumBtn" data-id="${esc(s.id)}" style="padding:6px 12px;font-size:11.5px" title="re-run the Claude debrief for this session">↻ Re-summarize</button>
      </div></div>`).join('')
    : '<div class="muted">No session transcripts found.</div>');
  $('#sessions').querySelectorAll('.peekBtn').forEach(b => b.onclick = () => showSessionTail(b.dataset.id));
  $('#sessions').querySelectorAll('.resumBtn').forEach(b => b.onclick = () => buildSummaries([b.dataset.id], true));
  // zero-click auto-fill: any session missing a cached summary gets one built now
  const missing = list.filter(s => !(summaries[s.id] && summaries[s.id].summary)).map(s => s.id);
  if (missing.length) buildSummaries(missing.slice(0, 12), false);

  async function buildSummaries(ids, spin) {
    ids.forEach(id => { const el = $(`.sessSum[data-id="${cssq(id)}"]`); if (el) { el.textContent = 'Summarizing…'; el.style.fontStyle = 'italic'; el.style.opacity = '.6'; } });
    let r;
    try { r = await api('/api/session-summaries/build', { method: 'POST', body: JSON.stringify({ ids }) }); }
    catch { ids.forEach(id => { const el = $(`.sessSum[data-id="${cssq(id)}"]`); if (el) el.textContent = '(summary unavailable)'; }); return; }
    summaries = (r && r.summaries) || summaries;
    ids.forEach(id => {
      const el = $(`.sessSum[data-id="${cssq(id)}"]`);
      if (!el) return;
      const c = summaries[id];
      el.textContent = c && c.summary ? c.summary : '(no summary — transcript too thin)';
      el.style.fontStyle = 'normal'; el.style.opacity = '1';
    });
  }
};
// escape a session id for use inside a CSS attribute selector (ids are hex+dash,
// but guard anyway so a stray char can't break the querySelector)
const cssq = s => (s || '').replace(/["\\]/g, '\\$&');

// R2: bucket a library item — agents by model tier, skills/commands by first letter.
const AGENT_TIER_ORDER = { 'Fable · top': 0, 'Haiku · cheap': 1, 'Sonnet · standard': 2, 'Opus · heavy': 3, 'Other': 4 };
function libGroup(type, d) {
  if (type === 'agents') {
    const m = (d.model || '').toLowerCase();
    if (/fable/.test(m)) return 'Fable · top';
    if (/opus/.test(m)) return 'Opus · heavy';
    if (/sonnet/.test(m)) return 'Sonnet · standard';
    if (/haiku|flash|cheap/.test(m)) return 'Haiku · cheap';
    return 'Other';
  }
  const c = (d.name || '').trim()[0];
  return c && /[a-z]/i.test(c) ? c.toUpperCase() : '#';
}

// Shared Agents/Skills/Commands view: one UI — live filter + collapsible groups + sort.
async function listView(sel, title, endpoint, type, extraHtml = '') {
  const data = await api(endpoint);
  const el = $(sel);
  const LV_SUB = { skills: 'reusable capabilities — advertised to every run', commands: 'slash commands available to runs' };
  el.innerHTML = `<h2>${title} <span class="muted" style="font-weight:400">(${data.length})</span></h2>
    ${LV_SUB[type] ? `<div class="muted" style="font-size:12px;margin:-4px 0 12px">${LV_SUB[type]}</div>` : ''}
    ${extraHtml}
    <div class="lib-toolbar">
      <input class="search" placeholder="Filter ${title.toLowerCase()}… (click a row to view its definition)">
      <button class="ghost libSort" title="toggle sort direction">A→Z</button>
      <button class="ghost libFold" title="collapse or expand all groups">Collapse all</button>
    </div>
    <div class="list"></div>`;
  const listEl = el.querySelector('.list');
  const collapsed = new Set();
  let dir = 1; // 1 = A→Z, -1 = Z→A
  const groupKeys = [...new Set(data.map(d => libGroup(type, d)))];
  const keyRank = k => (AGENT_TIER_ORDER[k] ?? (k === '#' ? 999 : k.charCodeAt(0)));
  const render = (q = '') => {
    const ql = q.toLowerCase();
    const f = data.filter(d => (d.name + ' ' + (d.description || '')).toLowerCase().includes(ql));
    const groups = {};
    for (const d of f) (groups[libGroup(type, d)] ||= []).push(d);
    const keys = Object.keys(groups).sort((a, b) => (keyRank(a) - keyRank(b)) * dir || a.localeCompare(b) * dir);
    listEl.innerHTML = keys.map(k => {
      const open = !collapsed.has(k);
      const items = groups[k].sort((a, b) => a.name.localeCompare(b.name) * dir);
      return `<div class="lib-group"><button class="lib-ghead" data-g="${esc(k)}" aria-expanded="${open}">
        <span class="fold">${open ? '▾' : '▸'}</span> ${esc(k)} <span class="muted">${items.length}</span></button>
        <div class="lib-gbody"${open ? '' : ' hidden'}>${items.map(d => `<div class="row clickable" data-i="${data.indexOf(d)}">
          <div class="flex" style="justify-content:space-between"><span class="name mono">${esc(d.name)}${type === 'agents' && d.builtin ? ' <span class="muted" style="font-weight:400;font-size:11px">· built-in</span>' : ''}</span>
            <span>${type === 'agents' ? `<span class="pill ${d.active ? 'ok' : ''}" title="${d.usageCount || 0} dispatch${d.usageCount === 1 ? '' : 'es'} in run history${d.lastUsed ? ' · last ' + esc(d.lastUsed.slice(0, 10)) : ''}">${d.active ? '● active' : '○ dormant'}</span>` : ''}
            ${d.model ? `<span class="pill ${/haiku|flash|cheap/i.test(d.model) ? 'ok' : /opus|fable/i.test(d.model) ? 'err' : 'neutral'}">${esc(d.model)}${type === 'agents' ? (/fable/i.test(d.model) ? ' · top' : /opus/i.test(d.model) ? ' · heavy' : /haiku/i.test(d.model) ? ' · cheap' : '') : ''}</span>` : ''}</span></div>
          ${d.description ? `<div class="desc">${esc(d.description)}</div>` : ''}</div>`).join('')}</div></div>`;
    }).join('') || '<div class="muted">No matches.</div>';
    listEl.querySelectorAll('.row.clickable').forEach(r => r.onclick = () => {
      const d = data[+r.dataset.i];
      showDetail(type, d.file || d.dir || d.name, d.name);
    });
    listEl.querySelectorAll('.lib-ghead').forEach(h => h.onclick = () => {
      const k = h.dataset.g;
      collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
      render(el.querySelector('.search').value);
    });
  };
  el.querySelector('.search').oninput = e => render(e.target.value);
  el.querySelector('.libSort').onclick = e => { dir = -dir; e.target.textContent = dir === 1 ? 'A→Z' : 'Z→A'; render(el.querySelector('.search').value); };
  el.querySelector('.libFold').onclick = e => {
    const allCollapsed = collapsed.size >= groupKeys.length;
    collapsed.clear();
    if (!allCollapsed) groupKeys.forEach(k => collapsed.add(k));
    e.target.textContent = allCollapsed ? 'Collapse all' : 'Expand all';
    render(el.querySelector('.search').value);
  };
  render();
}

// single shared modal — Escape closes (registered once)
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const o = $('#overlay'); if (o) o.remove(); } });
function ensureOverlay(title) {
  let ov = $('#overlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'overlay';
    ov.innerHTML = `<div class="panel"><header><h3 class="mono"></h3><button class="close">Close ✕</button></header><pre>Loading…</pre></div>`;
    document.body.appendChild(ov);
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.querySelector('.close').onclick = () => ov.remove();
  }
  ov.querySelector('h3').textContent = title;
  const pre = ov.querySelector('pre');
  pre.textContent = 'Loading…';
  return pre;
}

async function showDetail(type, key, label) {
  const pre = ensureOverlay(label);
  try {
    const r = await api(`/api/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(key)}`);
    pre.textContent = r.content || r.error || '(empty)';
  } catch (e) { pre.textContent = 'Failed to load: ' + (e.message || 'network error'); }
}

async function showSessionTail(id) {
  const pre = ensureOverlay(id + ' — recent activity');
  let r;
  try { r = await api(`/api/session-tail?id=${encodeURIComponent(id)}&n=50`); }
  catch (e) { pre.textContent = 'Failed to load: ' + (e.message || 'network error'); return; }
  if (!Array.isArray(r)) { pre.textContent = r.error || '(error)'; return; }
  if (!r.length) { pre.textContent = '(no conversation events in transcript tail)'; return; }
  pre.innerHTML = r.map(fmtEvent).join('\n');
  pre.scrollTop = pre.scrollHeight; // newest last — jump to bottom
}

