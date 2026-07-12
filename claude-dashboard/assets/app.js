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
    // A 403 "missing or bad X-Hub-Token" means THIS page's copy of the token is
    // stale — the hub rebooted (restart button, crash-recover, PWA tab left
    // open across a laptop sleep) and minted a new per-boot token that this
    // already-loaded JS never picked up. Every future mutating call would fail
    // the same way forever (this was the standing "phone stuck on X-Hub-Token
    // errors" bug — a backgrounded phone tab is exactly the case that never
    // gets a manual refresh). Reload once to fetch the fresh token; if the
    // reload doesn't fix it (server truly down) the 403 will simply recur and
    // we won't loop-reload because location.reload() tears down this context.
    if (r.status === 403 && /x-hub-token/i.test(j && j.error || '')) {
      location.reload();
      return new Promise(() => {}); // page is reloading — never resolve into stale code
    }
    return j;
  } catch (e) { markServer(false); throw e; }
  finally { clearTimeout(t); }
}
function spendToday(runs) {
  const today = new Date().toDateString();
  return runs.filter(m => new Date(m.startedAt || m.queuedAt || 0).toDateString() === today)
    .reduce((s, m) => s + (m.costUsd || 0), 0);
}
// Compact on phones — "today" was the part getting clipped by the 120px
// mobile max-width (screenshot bug: "$58.11 to..."). Number alone always fits.
async function updateSpendBadge() {
  const el = $('#spendBadge');
  if (!el) return;
  try {
    const spend = spendToday(await api('/api/runs'));
    el.textContent = window.innerWidth <= 760 ? `$${spend.toFixed(2)}` : `$${spend.toFixed(2)} today`;
  } catch {}
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
      await fetch('/api/overview', { cache: 'no-store' });
      clearInterval(reconnectTimer); reconnectTimer = null;
      // A server that was unreachable came back — it may be a fresh boot with a
      // NEW per-boot X-Hub-Token (restart, crash-recover, laptop sleep/wake).
      // A soft refresh would keep firing the stale HUB_TOKEN const forever and
      // every POST would 403 "missing or bad X-Hub-Token" (the phone/Tailscale
      // bug: an open tab survives a hub restart with dead credentials). Hard
      // reload picks the new token up from the freshly-served index.html.
      location.reload();
    } catch {}
  }, 5000);
}

// ---- mobile nav toggle ----
function closeNav() {
  const nav = $('#mainNav');
  if (nav && nav.classList.contains('open')) {
    nav.classList.remove('open');
  }
}
$('#navToggle').onclick = () => {
  const nav = $('#mainNav');
  if (nav) nav.classList.toggle('open');
};
$('#navOverlay').onclick = () => closeNav();

// ---- tab switching (persisted, keyboard-driven) ----
let currentTab = 'run';
const TABS = [...document.querySelectorAll('nav a')].map(a => a.dataset.tab);
function goTab(tab) {
  if (!renderers[tab]) return;
  currentTab = tab;
  closeNav(); // close mobile nav when switching tabs
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

// R0: usage-remaining gauge — a plain ring built from conic-gradient (no
// canvas/svg dependency), muted-gold on clean-dark. pct is 0-100 "used".
function usageRing(pct, size) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const danger = p >= 90;
  const warn = p >= 70 && !danger;
  const color = danger ? 'var(--red)' : (warn ? 'var(--amber)' : 'var(--accent)');
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;
    background:conic-gradient(${color} ${p * 3.6}deg, var(--line) 0deg);
    display:flex;align-items:center;justify-content:center;position:relative">
    <div style="width:${size - 16}px;height:${size - 16}px;border-radius:50%;background:var(--panel);
      display:flex;align-items:center;justify-content:center;flex-direction:column">
      <span class="mono" style="font-size:${size > 100 ? 20 : 15}px;font-weight:700;color:${color}">${pct == null ? '—' : p + '%'}</span>
      <span class="mono" style="font-size:9px;color:var(--dim);letter-spacing:1px;text-transform:uppercase">used</span>
    </div></div>`;
}

function usageGaugeCard(label, u) {
  if (u.budget == null) {
    return `<div class="card" style="grid-column:span 1">
      <div class="l" style="margin-bottom:10px">${esc(label)}</div>
      <div class="muted" style="font-size:12px;line-height:1.5">No budget set — spend so far: <span class="mono">$${u.spend.toFixed(2)}</span>.
        Set a limit in Config to see remaining / burn-rate / projection.</div>
    </div>`;
  }
  return `<div class="card" style="display:flex;gap:16px;align-items:center">
    ${usageRing(u.pctUsed, 84)}
    <div style="min-width:0">
      <div class="l" style="margin-bottom:6px">${esc(label)}</div>
      <div class="mono" style="font-size:19px;font-weight:700;color:var(--txt)">$${Math.max(0, u.remaining).toFixed(2)} <span class="muted" style="font-size:11px;font-weight:400">left of $${u.budget.toFixed(2)}</span></div>
      <div class="muted" style="font-size:11.5px;margin-top:4px">burn ${'$' + u.burnPerHour.toFixed(3)}/hr · ${esc(u.projection || '')}</div>
    </div>
  </div>`;
}

renderers.overview = async function () {
  const [d, runs, files, usageData] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/files').catch(() => []),
    api('/api/usage').catch(() => null),
  ]);
  $('#projBadge').textContent = d.project;
  $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;
  const today = new Date().toDateString();
  const tRuns = runs.filter(m => new Date(m.startedAt || m.queuedAt || 0).toDateString() === today);
  const spend = spendToday(runs);
  if ($('#spendBadge')) $('#spendBadge').textContent = window.innerWidth <= 760 ? `$${spend.toFixed(2)}` : `$${spend.toFixed(2)} today`;
  const finished = runs.filter(m => ['done', 'error', 'cancelled'].includes(m.status));
  const errors = runs.filter(m => m.status === 'error');
  const okRate = finished.length ? Math.round(100 * finished.filter(m => m.status === 'done').length / finished.length) : null;
  const apiPill = d.hasApiKey ? '<span class="pill ok">auth ready</span>' : '<span class="pill warn">no auth — runs can\'t execute</span>';
  const memPill = d.engramCount ? `<span class="pill ok">engram: ${d.engramCount} memories</span>` : '<span class="pill warn">memory empty — runs auto-capture</span>';

  // compute usage breakdown by model
  const modelCosts = {};
  tRuns.forEach(r => {
    const m = r.model || 'unknown';
    if (!modelCosts[m]) modelCosts[m] = 0;
    modelCosts[m] += r.costUsd || 0;
  });
  const costBreakdown = Object.entries(modelCosts).map(([m, c]) =>
    `<span class="pill neutral" style="font-size:11px">${esc(m)}: $${c.toFixed(3)}</span>`).join('');

  const usageHero = usageData ? `
    <h2>Usage remaining</h2>
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-bottom:18px">
      ${usageGaugeCard('Today', usageData.today)}
      ${usageGaugeCard('This week', usageData.week)}
    </div>
    ${!usageData.configured ? '<div class="note" style="margin-bottom:22px">No usage limits set yet — proxy is $ spend against a budget you choose (real plan-quota telemetry is a separate wiring task). Set a daily/weekly limit in <span class="mono">Config</span>.</div>' : ''}
  ` : '';

  $('#overview').innerHTML = `
    <h2>Overview</h2>
    ${usageHero}
    <h2 style="margin-top:8px">Other signals</h2>
    <div class="cards">
      <div class="card"><div class="n" style="color:var(--accent)">${tRuns.length}</div><div class="l">Runs today</div></div>
      <div class="card"><div class="n">${okRate === null ? '—' : okRate + '%'}</div><div class="l">Success rate</div></div>
      <div class="card" ${errors.length ? 'style="border-color:#e0525255"' : ''}><div class="n" ${errors.length ? 'style="color:#e05252;text-shadow:none"' : ''}>${errors.length}</div><div class="l">Failed runs</div></div>
      <div class="card"><div class="n">${files.length || 0}</div><div class="l">Inbox files</div></div>
    </div>
    ${costBreakdown ? `<div style="padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);margin-bottom:22px">
      <div style="color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Cost breakdown today (by model)</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">${costBreakdown}</div>
    </div>` : ''}
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
  return listView('#agents', 'Agents', '/api/agents', 'agents', card);
};
renderers.skills = function () { return listView('#skills', 'Skills', '/api/skills', 'skills'); };
renderers.commands = function () { return listView('#commands', 'Commands', '/api/commands', 'commands'); };

renderers.config = async function () {
  const d = await api('/api/config');
  $('#config').innerHTML = `
    <h2>Config</h2>
    <div id="usagePanel"></div>
    <div id="enginePanel"></div>
    <div id="autopilotPanel"></div>
    <h2 style="font-size:12px">.mcp.json</h2><pre>${esc(JSON.stringify(d.mcp, null, 2))}</pre>
    <h2 style="font-size:12px;margin-top:22px">.claude/settings.json (hooks &amp; more)</h2>
    <pre>${esc(JSON.stringify(d.settings, null, 2))}</pre>
    <h2 style="font-size:12px;margin-top:22px">CLAUDE.md (first 4k)</h2><pre>${esc(d.projectClaudeMd)}</pre>
    <div id="voiceSettings"></div>`;
  if (window.HubVoice) HubVoice.renderSettings($('#voiceSettings'));
  renderAutopilot();
  renderUsageConfig();
  renderEngineConfig();
};

// Engine pivot: Claude is the lean default. hermes is a deprecated paid second
// stack, hidden from the Run composer + Agents tab unless re-enabled here.
async function renderEngineConfig() {
  const el = $('#enginePanel');
  if (!el) return;
  let on = false;
  try { on = (await api('/api/settings')).hermesEnabled === true; } catch {}
  el.innerHTML = `<div class="row" style="margin-bottom:22px">
    <label class="chk" style="align-items:flex-start">
      <input type="checkbox" id="hermesToggle" ${on ? 'checked' : ''}>
      <span><b>Enable hermes engine</b> <span class="pill warn">deprecated · paid</span><br>
      <span class="muted" style="font-size:11.5px">Off by default. Claude (with its model-tiered subagents) is the hub's engine. Turn on only if you specifically need the hermes second stack in the Run composer + Agents tab. Note: hermes ACP streaming needs a terminal-launched hub (set <span class="mono">HUB_HERMES_ENGINE=oneshot</span> for headless).</span></span>
    </label></div>`;
  $('#hermesToggle').onchange = async e => {
    try { await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hermesEnabled: e.target.checked }) }); } catch {}
    // reflect immediately in the Run composer if it's built
    if (typeof gateHermesEngine === 'function') gateHermesEngine();
  };
}

async function renderUsageConfig() {
  const el = $('#usagePanel');
  if (!el) return;
  let u;
  try { u = await api('/api/usage'); } catch { el.innerHTML = '<div class="note">Usage status unavailable.</div>'; return; }
  el.innerHTML = `
    <h2 style="font-size:12px">Usage limits <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— drives the Overview hero gauges (today &amp; this week). This is a $-spend proxy against a budget YOU set; wiring the real plan-quota API is a separate task.</span></h2>
    <div class="flex" style="margin-bottom:14px">
      <label class="mono" style="font-size:12px;color:var(--muted)">Daily budget $
        <input id="dailyBudget" type="number" min="0" step="0.5" value="${u.today.budget != null ? u.today.budget : ''}" style="width:110px;margin:4px 0 0;padding:8px 10px" placeholder="unset"></label>
      <label class="mono" style="font-size:12px;color:var(--muted)">Weekly budget $
        <input id="weeklyBudget" type="number" min="0" step="1" value="${u.week.budget != null ? u.week.budget : ''}" style="width:110px;margin:4px 0 0;padding:8px 10px" placeholder="unset"></label>
      <button class="ghost" id="saveBudgets" style="padding:9px 16px;font-size:12px;align-self:flex-end">Save</button>
    </div>`;
  $('#saveBudgets').onclick = async () => {
    const dv = $('#dailyBudget').value.trim();
    const wv = $('#weeklyBudget').value.trim();
    try {
      await api('/api/usage/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyBudgetUsd: dv === '' ? null : Number(dv), weeklyBudgetUsd: wv === '' ? null : Number(wv) }),
      });
    } catch {}
    renderUsageConfig();
    if (currentTab === 'overview') load('overview', true);
  };
}

async function renderAutopilot() {
  const el = $('#autopilotPanel');
  if (!el) return;
  let a;
  try { a = await api('/api/autopilot'); } catch { el.innerHTML = '<div class="note">Autopilot status unavailable.</div>'; return; }
  el.innerHTML = `
    <h2 style="font-size:12px">Autopilot <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— unattended self-improvement loop over docs/improvement-backlog.md</span></h2>
    <div class="note" style="margin-bottom:10px">Every ${5} min, picks the next open (⬜) backlog item, queues it as a hub task with
      auto model routing, and asks that same run to mark the item ✅ and commit when done. Caps: 2 items in flight,
      2 attempts per item before it's parked as "stuck" (won't burn budget retrying a bad one forever).</div>
    <div class="flex" style="align-items:center;gap:10px;margin-bottom:10px">
      <label class="chk"><input type="checkbox" id="apToggle"${a.enabled ? ' checked' : ''}> Enabled</label>
      <span class="pill ${a.enabled ? 'ok' : 'neutral'}">${a.enabled ? 'running' : 'off'}</span>
      <span class="pill neutral">backlog: ${a.backlogDone}/${a.backlogTotal} done</span>
      <span class="pill ${a.inflight ? 'warn' : 'neutral'}">${a.inflight} in flight</span>
      ${a.stuck.length ? `<span class="pill err" title="exhausted retries — edit docs/improvement-backlog.md or clear data/autopilot.json to retry">${a.stuck.length} stuck: ${esc(a.stuck.join(', '))}</span>` : ''}
      <button class="ghost" id="apRunNow" style="padding:6px 12px;font-size:11.5px">▶ Check now</button>
    </div>
    ${a.lastPick ? `<div class="muted" style="font-size:11.5px">last picked: ${esc(a.lastPick)} · last tick: ${a.lastTick ? rel(a.lastTick) : '—'}</div>` : ''}`;
  $('#apToggle').onchange = async (e) => {
    try { await api('/api/autopilot/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
    catch {}
    renderAutopilot();
  };
  $('#apRunNow').onclick = async () => {
    try { await api('/api/autopilot/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
    catch {}
    renderAutopilot();
  };
}

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
    listEl.innerHTML = f.map(d => `<div class="row clickable" data-i="${data.indexOf(d)}">
      <div class="flex" style="justify-content:space-between"><span class="name mono">${esc(d.name)}</span>
        ${d.model ? `<span class="pill ${/haiku|flash|cheap/i.test(d.model) ? 'ok' : /opus|fable/i.test(d.model) ? 'err' : 'neutral'}">${esc(d.model)}</span>` : ''}</div>
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
  updateSpendBadge();
  setInterval(updateSpendBadge, 60000); // header badge, not tab-scoped — the one thing mobile must always show while autopilot dispatches runs unattended
  // Theme toggle (◐): warm terminal-amber (default) ↔ clean-dark "sleek" (the
  // amber-agent-orb design target). Both variable sets live in style.css; the
  // light theme is still defined there but no longer on the toggle path.
  try { if (localStorage.getItem('hub.theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch {}
  const tt = $('#themeTab');
  if (tt) tt.onclick = () => {
    const sleek = document.documentElement.getAttribute('data-theme') !== 'dark';
    if (sleek) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('hub.theme', sleek ? 'dark' : 'warm'); } catch {}
  };
  // Restart button (beside the theme toggle): tell the server to respawn, then
  // poll the same port until the fresh process answers and hard-reload — the
  // reload picks up the new per-boot X-Hub-Token the restarted server injects.
  const rb = $('#restartTab');
  if (rb) rb.onclick = async () => {
    if (!confirm('Restart the hub server? The page will reconnect in a few seconds.')) return;
    rb.disabled = true; const glyph = rb.textContent; rb.textContent = '…';
    markServer(false); // flips the badge to "restarting/unreachable" immediately
    try { await api('/api/restart', { method: 'POST', timeoutMs: 4000 }); } catch {}
    let n = 0;
    const poll = async () => {
      n++;
      try {
        const r = await fetch('/api/overview', { cache: 'no-store' });
        if (r.ok) { location.reload(); return; }
      } catch {}
      if (n < 40) setTimeout(poll, 500);
      else { rb.disabled = false; rb.textContent = glyph; } // gave up — let the reconnect poller carry on
    };
    setTimeout(poll, 1500);
  };
  let bootTab = 'run';
  try { const t = localStorage.getItem('hub.tab'); if (t && TABS.includes(t) && renderers[t]) bootTab = t; } catch {}
  goTab(bootTab);
}
