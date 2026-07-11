/* Hub SPA core: api/tab plumbing + Overview, Sessions, Library, Config.
   Run tab lives in run.js, Files tab in files.js, Graph tab in graph.js +
   agentviz.js. Scripts load in order (app → graph → run → files), then boot(). */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HUB_TOKEN = (document.querySelector('meta[name="hub-token"]') || {}).content || '';
const renderers = {}; // tab -> async render fn; other scripts register into this

// fetch with a hard timeout + server-health tracking: a dead or restarted
// server flips the header badge to "unreachable" and auto-recovers.
// Non-GET requests automatically carry the CSRF token header.
async function api(p, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs || 15000);
  if (opts.method && opts.method !== 'GET') {
    opts.headers = Object.assign({ 'X-Hub-Token': HUB_TOKEN }, opts.headers || {});
  }
  try {
    const r = await fetch(p, { ...opts, signal: ctl.signal });
    const j = await r.json();
    markServer(true);
    return j;
  } catch (e) { markServer(false); throw e; }
  finally { clearTimeout(t); }
}
let serverOk = true, reconnectTimer = null;
function setAuthBadge(d) {
  $('#statusBadge').innerHTML = d.hasApiKey
    ? '<span class="dot ok"></span>server live · exec ready'
    : '<span class="dot ok"></span>server live · <span title="log in with the claude CLI or set ANTHROPIC_API_KEY for run execution">no auth</span>';
}
function markServer(ok) {
  if (ok === serverOk) return;
  serverOk = ok;
  if (ok) return; // badge text is restored by the reconnect poller below (it has fresh data)
  $('#statusBadge').innerHTML = '<span class="dot warn"></span>server unreachable — retrying…';
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    try {
      const d = await api('/api/overview', { timeoutMs: 4000 });
      clearInterval(reconnectTimer); reconnectTimer = null;
      setAuthBadge(d);
      load(currentTab, true); // server came back (possibly restarted) — refresh the visible tab
    } catch {}
  }, 5000);
}

// ---- tab switching (persisted, keyboard-driven) ----
let currentTab = 'run';
const TABS = [...document.querySelectorAll('nav a')].map(a => a.dataset.tab);
function goTab(tab) {
  if (!renderers[tab]) return;
  currentTab = tab;
  try { localStorage.setItem('hub.tab', tab); } catch {}
  document.querySelectorAll('nav a').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  const sec = $('#' + tab);
  sec.classList.remove('hidden');
  sec.style.animation = 'none'; void sec.offsetHeight; sec.style.animation = ''; // retrigger entrance
  load(tab);
}
document.querySelectorAll('nav a').forEach(a => a.onclick = () => goTab(a.dataset.tab));

const loaded = {};
async function load(tab, force) {
  if (loaded[tab] && !force) return;
  loaded[tab] = true;
  if ((force || !$('#' + tab).innerHTML.trim()) && !(renderers[tab] && renderers[tab].noSkeleton)) skeleton(tab);
  try { await renderers[tab](); }
  catch (e) {
    loaded[tab] = false; // failed render must not count as loaded — revisiting retries
    $('#' + tab).innerHTML = `<h2>${esc(tab)}</h2>
      <div class="note">Couldn't load this tab — ${esc(e.message || 'network error')}. The server may be busy or restarting.</div>
      <button class="retryBtn">Retry</button>`;
    $('#' + tab + ' .retryBtn').onclick = () => load(tab, true);
  }
}
function skeleton(tab) {
  $('#' + tab).innerHTML = `<h2>${tab}</h2>
    <div class="cards">${'<div class="skel" style="height:86px"></div>'.repeat(3)}</div>
    ${'<div class="skel" style="height:46px;margin-bottom:8px"></div>'.repeat(4)}`;
}
$('#refreshTab').onclick = () => load(currentTab, true);
// keyboard: 1-9 and 0 follow nav order, R refresh, / focus filter
document.addEventListener('keydown', e => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key >= '1' && e.key <= '9') { const tab = TABS[+e.key - 1]; if (tab) goTab(tab); }
  else if (e.key === '0') { const tab = TABS[9]; if (tab) goTab(tab); }
  else if (e.key === 'r' || e.key === 'R') { load(currentTab, true); }
  else if (e.key === '/') { const s = $('#' + currentTab + ' input.search'); if (s) { e.preventDefault(); s.focus(); } }
});

// ---- core tab renderers ----
// friendly relative time for dashboards ("3h ago")
function rel(t) {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

renderers.overview = async function () {
  const [d, runs, files] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/files').catch(() => []),
  ]);
  $('#projBadge').textContent = d.project;
  $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;
  const today = new Date().toDateString();
  const tRuns = runs.filter(m => new Date(m.startedAt || m.queuedAt || 0).toDateString() === today);
  const spend = tRuns.reduce((s, m) => s + (m.costUsd || 0), 0);
  const finished = runs.filter(m => ['done', 'error', 'cancelled'].includes(m.status));
  const errors = runs.filter(m => m.status === 'error');
  const okRate = finished.length ? Math.round(100 * finished.filter(m => m.status === 'done').length / finished.length) : null;
  const artifacts = runs.reduce((s, m) => s + (m.artifactCount || 0), 0);
  const apiPill = d.hasApiKey ? '<span class="pill ok">auth ready</span>' : '<span class="pill warn">no auth — runs can\'t execute</span>';
  const memPill = d.engramCount ? `<span class="pill ok">engram: ${d.engramCount} memories</span>` : '<span class="pill warn">memory empty — runs auto-capture</span>';
  $('#overview').innerHTML = `
    <h2>Overview — product cockpit</h2>
    <div class="cards">
      <div class="card clickable" data-goto="run"><div class="n">${tRuns.length}</div><div class="l">Runs today</div></div>
      <div class="card clickable" data-goto="run"><div class="n">$${spend.toFixed(2)}</div><div class="l">Spend today</div></div>
      <div class="card"><div class="n">${okRate === null ? '—' : okRate + '%'}</div><div class="l">Success rate (all runs)</div></div>
      <div class="card clickable" data-goto="run"><div class="n" ${errors.length ? 'style="color:var(--red);text-shadow:none"' : ''}>${errors.length}</div><div class="l">Failed runs</div></div>
      <div class="card clickable" data-goto="run"><div class="n">${artifacts}</div><div class="l">Artifacts produced</div></div>
      <div class="card clickable" data-goto="files"><div class="n">${files.length || 0}</div><div class="l">Inbox files</div></div>
    </div>
    <div class="flex" style="margin-bottom:22px">${memPill}${apiPill}
      <span class="pill neutral">MCP: ${d.mcpServers.map(esc).join(', ') || 'none'}</span>
      <span class="pill neutral">library: ${d.counts.agents} agents · ${d.counts.skills} skills · ${d.counts.commands} commands</span></div>
    <h2>Recent runs <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to replay in the Run tab</span></h2>
    <div id="ovRuns">${runs.slice(0, 5).map(m => `
      <div class="row clickable ovrun" data-id="${esc(m.id)}">
        <div class="flex" style="justify-content:space-between">
          <span><span class="pill ${m.status === 'done' ? 'ok' : (m.status === 'error' ? 'err' : 'warn')}">${esc(m.status)}</span>
            <span class="muted" style="font-size:11.5px">${rel(m.startedAt || m.queuedAt)}${m.model ? ' · ' + esc(m.model) : ''}${m.costUsd != null ? ' · $' + m.costUsd.toFixed(3) : ''}${m.artifactCount ? ' · ◫ ' + m.artifactCount : ''}</span></span>
        </div>
        <div class="pex">${esc(m.promptExcerpt || '')}</div>
        ${m.errorExcerpt ? `<div class="pex" style="color:#f0908f">↳ ${esc(m.errorExcerpt)}</div>` : ''}
      </div>`).join('') || '<div class="muted">No runs yet — open the Run tab and send a prompt.</div>'}</div>
    <h2 style="margin-top:26px">Raw session feed <span class="mono" id="feedSession" style="font-weight:400;text-transform:none;letter-spacing:0"></span></h2>
    <pre id="feed" style="max-height:180px">Loading…</pre>`;
  $('#overview').querySelectorAll('.card.clickable').forEach(c => c.onclick = () => goTab(c.dataset.goto));
  $('#overview').querySelectorAll('.ovrun').forEach(r => r.onclick = () => { goTab('run'); ensureRunUI(); openRun(r.dataset.id); });
  startFeed();
};

renderers.agents = async function () {
  let h = { installed: false };
  try { h = await api('/api/hermes'); } catch {}
  const card = h.installed ? `
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
  return listView('#agents', 'Agents', '/api/agents', 'agents', card);
};
renderers.skills = function () { return listView('#skills', 'Skills', '/api/skills', 'skills'); };
renderers.commands = function () { return listView('#commands', 'Commands', '/api/commands', 'commands'); };

renderers.config = async function () {
  const d = await api('/api/config');
  $('#config').innerHTML = `
    <h2>Config</h2>
    <h2 style="font-size:12px">.mcp.json</h2><pre>${esc(JSON.stringify(d.mcp, null, 2))}</pre>
    <h2 style="font-size:12px;margin-top:22px">.claude/settings.json (hooks &amp; more)</h2>
    <pre>${esc(JSON.stringify(d.settings, null, 2))}</pre>
    <h2 style="font-size:12px;margin-top:22px">CLAUDE.md (first 4k)</h2><pre>${esc(d.projectClaudeMd)}</pre>`;
};

renderers.sessions = async function () {
  const d = await api('/api/sessions');
  const list = Array.isArray(d) ? d : (d.list || []);
  const dir = Array.isArray(d) ? '' : (d.dir || '');
  $('#sessions').innerHTML = `<h2>Claude Code Sessions (this project) <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— peek at raw activity, or have Claude summarize a session for you</span></h2>` +
    (list.length ? list.map((s, i) => `<div class="row" data-id="${esc(s.id)}">
      <div class="flex" style="justify-content:space-between">
        <span class="name mono">${i === 0 ? '<span class="dot ok"></span>' : ''}${esc(s.id.slice(0, 8))}…
          <span class="muted" style="font-weight:400;font-size:11.5px">${i === 0 ? 'newest' : ''}</span></span>
        <span class="muted" style="font-size:11.5px">${rel(s.modified)} · ${s.sizeKb} KB</span>
      </div>
      <div class="flex" style="margin-top:8px">
        <button class="ghost peekBtn" data-id="${esc(s.id)}" style="padding:6px 12px;font-size:11.5px">Peek activity</button>
        <button class="ghost sumBtn" data-id="${esc(s.id)}" style="padding:6px 12px;font-size:11.5px">✦ Summarize with Claude</button>
      </div></div>`).join('')
    : '<div class="muted">No session transcripts found.</div>');
  $('#sessions').querySelectorAll('.peekBtn').forEach(b => b.onclick = () => showSessionTail(b.dataset.id));
  $('#sessions').querySelectorAll('.sumBtn').forEach(b => b.onclick = () => prefillRun(
    `Read the tail (last ~300 lines) of the Claude Code session transcript at ${dir}\\${b.dataset.id}.jsonl — it is JSONL, one event per line. Summarize for a project manager: what was worked on, key decisions, errors or failures hit, and open items. Under 250 words, bullet points.`));
};

async function listView(sel, title, endpoint, type, extraHtml = '') {
  const data = await api(endpoint);
  const el = $(sel);
  el.innerHTML = `<h2>${title} <span class="muted" style="font-weight:400">(${data.length})</span></h2>
    ${extraHtml}
    <input class="search" placeholder="Filter ${title.toLowerCase()}… (click a row to view its definition)">
    <div class="list"></div>`;
  const listEl = el.querySelector('.list');
  const render = (q = '') => {
    const f = data.filter(d => (d.name + ' ' + d.description).toLowerCase().includes(q.toLowerCase()));
    listEl.innerHTML = f.map(d => `<div class="row clickable" data-i="${data.indexOf(d)}"><div class="name mono">${esc(d.name)}</div>
      ${d.description ? `<div class="desc">${esc(d.description)}</div>` : ''}</div>`).join('') ||
      '<div class="muted">No matches.</div>';
    listEl.querySelectorAll('.row.clickable').forEach(r => r.onclick = () => {
      const d = data[+r.dataset.i];
      showDetail(type, d.file || d.dir || d.name, d.name);
    });
  };
  el.querySelector('.search').oninput = e => render(e.target.value);
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

const KIND_COLOR = { user: 'var(--green)', assistant: 'var(--accent)', tool: '#e6b45a' };
function fmtEvent(e) {
  const t = e.time ? new Date(e.time).toLocaleTimeString() : '——:——:——';
  return `<span class="muted">${esc(t)}</span> <span style="color:${KIND_COLOR[e.kind] || 'var(--muted)'};font-weight:600">${esc((e.kind + '     ').slice(0, 9))}</span> ${esc(e.text)}`;
}

// ---- live activity feed (Overview tab) ----
let feedTimer = null;
async function refreshFeed() {
  const pre = $('#feed');
  if (!pre) return;
  let r;
  try { r = await api('/api/activity'); }
  catch { pre.textContent = '(server unreachable — feed will resume automatically)'; return; }
  const label = $('#feedSession');
  if (label) label.textContent = r.sessionId ? '— ' + r.sessionId : '';
  if (!r.sessionId) { pre.textContent = '(no session transcripts found)'; return; }
  if (!Array.isArray(r.events) || !r.events.length) { pre.textContent = '(no conversation events in transcript tail)'; return; }
  pre.innerHTML = r.events.map(fmtEvent).join('\n');
}
function startFeed() {
  refreshFeed();
  if (feedTimer) return; // overview() may re-render (load force) — never stack intervals
  feedTimer = setInterval(() => {
    if ($('#overview').classList.contains('hidden')) return; // another tab selected — skip
    refreshFeed();
  }, 10000);
}

// boot: header badges (independent of active tab), then restore last-viewed tab.
// Called from index.html after all tab scripts have registered their renderers.
function boot() {
  // opened as a raw file (file://) or by a server that didn't inject the token —
  // nothing can work without the hub server, so say so instead of half-rendering
  if (location.protocol === 'file:' || HUB_TOKEN === '__HUB_' + 'TOKEN__') {
    document.querySelector('main').innerHTML = `<section>
      <h2>Hub server required</h2>
      <div class="note">This page was opened directly (<span class="mono">${esc(location.protocol)}//</span>) —
        the hub only works when served by its server, which injects the security token and serves the API.<br><br>
        Start it:&nbsp;<span class="mono">node claude-dashboard\\server.js</span><br>
        Then open:&nbsp;<a class="link" href="http://127.0.0.1:5757">http://127.0.0.1:5757</a></div>
    </section>`;
    document.querySelector('#statusBadge').innerHTML = '<span class="dot warn"></span>not connected to the hub server';
    return;
  }
  api('/api/overview').then(d => {
    $('#projBadge').textContent = d.project;
    $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;
    setAuthBadge(d);
  }).catch(() => {});
  let bootTab = 'run';
  try { const t = localStorage.getItem('hub.tab'); if (t && TABS.includes(t) && renderers[t]) bootTab = t; } catch {}
  goTab(bootTab);
}
