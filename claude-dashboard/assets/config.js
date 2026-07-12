/* Config + Tools renderers: usage budget, hermes-engine toggle, plan-usage
   editor, autopilot, voice + admin panels. Split from app.js; loaded after it. */
'use strict';

renderers.config = async function () {
  const d = await api('/api/config');
  $('#config').innerHTML = `
    <h2>Config</h2>
    <div id="usagePanel"></div>
    <div id="enginePanel"></div>
    <div id="planPanel"></div>
    <div id="autopilotPanel"></div>
    <h2 style="font-size:12px;margin-top:22px">.claude/settings.json (hooks &amp; more)</h2>
    <pre>${esc(JSON.stringify(d.settings, null, 2))}</pre>
    <div class="muted" style="font-size:11px;margin-top:8px">MCP connectors, the site editor, and git live in the <b>Tools</b> tab.</div>
    <div id="voiceSettings"></div>`;
  if (window.HubVoice) HubVoice.renderSettings($('#voiceSettings'));
  renderAutopilot();
  renderUsageConfig();
  renderEngineConfig();
  renderPlanConfig();
};

// Plan-usage numbers shown on Overview. Claude exposes no usage API, so the user
// keeps these current by hand here; they persist to settings.plan.
async function renderPlanConfig() {
  const el = $('#planPanel');
  if (!el) return;
  let p = {};
  try { p = (await api('/api/settings')).plan || {}; } catch {}
  const f = (id, label, val, w) => `<label style="font-size:11px;color:var(--muted)">${label}<br>
    <input class="search" id="${id}" value="${esc(String(val == null ? '' : val))}" style="margin:2px 0 0;width:${w || 110}px"></label>`;
  el.innerHTML = `<div class="row" style="margin-bottom:22px">
    <div class="l" style="margin-bottom:4px">Plan usage <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">— shown on Overview (Claude has no usage API, so keep these current by hand)</span></div>
    <div class="flex" style="gap:12px;flex-wrap:wrap;align-items:flex-end">
      ${f('plLabel', 'plan label', p.label, 90)}
      ${f('plSess', 'session %', p.sessionPct, 70)}${f('plSessR', 'session resets', p.sessionResets, 120)}
      ${f('plWa', 'weekly all %', p.weeklyAll, 70)}${f('plWf', 'weekly Fable %', p.weeklyFable, 70)}${f('plWr', 'weekly resets', p.weeklyResets, 120)}
      ${f('plCs', 'credits $', p.creditsSpent, 80)}${f('plCp', 'credits %', p.creditsPct, 70)}${f('plCr', 'credits resets', p.creditsResets, 110)}
      <button id="plSave">Save</button> <span id="plMsg" class="muted" style="font-size:11px"></span></div></div>`;
  $('#plSave').onclick = async () => {
    const num = v => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
    const plan = { label: $('#plLabel').value.trim(),
      sessionPct: num($('#plSess').value), sessionResets: $('#plSessR').value.trim(),
      weeklyAll: num($('#plWa').value), weeklyFable: num($('#plWf').value), weeklyResets: $('#plWr').value.trim(),
      creditsSpent: num($('#plCs').value), creditsPct: num($('#plCp').value), creditsResets: $('#plCr').value.trim() };
    try { await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      loaded.overview = false; // invalidate the Overview cache so it re-renders fresh next visit
      $('#plMsg').textContent = '✓ saved — reflected on Overview'; $('#plMsg').style.color = 'var(--green)'; }
    catch (e) { $('#plMsg').textContent = '✗ ' + (e.message || 'failed'); $('#plMsg').style.color = 'var(--red)'; }
  };
}

// Tools tab: MCP connectors + site editor + git (server: lib/admin.js).
renderers.tools = function () {
  if (window.HubAdmin) HubAdmin.renderConfigPanels($('#tools'));
  else $('#tools').innerHTML = '<div class="muted">Tools module not loaded.</div>';
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
