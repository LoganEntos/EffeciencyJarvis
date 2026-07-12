/* Overview tab: usage hero, plan-usage bars, stat cards, recent runs.
   Split from app.js; loaded after it (uses global api/$/esc/goTab/spendToday/
   rel/startFeed/openRun/ensureRunUI). */
'use strict';

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
  const [d, runs, files, usageData, cfg, routing] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/files').catch(() => []),
    api('/api/usage').catch(() => null),
    api('/api/settings').catch(() => ({})),
    api('/api/routing').catch(() => null),
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

  // Hero (usage remaining) — giant Instrument-Serif number, amber-agent-orb style
  const u = usageData && usageData.today;
  const budgetSet = u && u.budget != null;
  const heroNum = budgetSet ? '$' + Math.max(0, u.remaining).toFixed(2) : '$' + spend.toFixed(2);
  const heroLabel = budgetSet ? 'Usage remaining' : 'Spent today';
  const heroSub = budgetSet
    ? `of $${u.budget.toFixed(2)} daily budget · burn $${u.burnPerHour.toFixed(2)}/hr${u.projection ? ' · ' + esc(u.projection) : ''}`
    : 'no daily budget set — set one in Config to track remaining';
  // Plan usage bars (numbers the user keeps current in Config — no live API)
  const plan = cfg.plan || {};
  const planBar = (text, pct, cls) => `<div style="margin:0 0 11px">
    <div class="mono" style="font-size:11.5px;color:var(--muted);margin-bottom:5px">${esc(text)}</div>
    <div class="planbar"><div class="planbar-fill ${cls}" style="width:${Math.min(100, Math.max(0, pct || 0))}%"></div></div></div>`;
  const planCard = plan.sessionPct != null ? `<div class="card" style="margin:16px 0 20px">
    <div class="flex" style="justify-content:space-between;margin-bottom:12px">
      <div class="l">Plan usage — ${esc(plan.label || '')}</div>
      <span class="muted" style="font-size:10.5px">${plan.updatedAt ? 'updated ' + rel(plan.updatedAt) : 'not set'} · <span id="ovPlanRefresh" style="cursor:pointer" title="refresh from saved values">↻</span> · edit in Config ⚙</span></div>
    ${planBar(`Current session — ${plan.sessionPct}% used · resets in ${esc(plan.sessionResets || '')}`, plan.sessionPct, '')}
    ${planBar(`Weekly · All models — ${plan.weeklyAll}% used · resets ${esc(plan.weeklyResets || '')}`, plan.weeklyAll, '')}
    ${planBar(`Weekly · Fable — ${plan.weeklyFable}% used · resets ${esc(plan.weeklyResets || '')}`, plan.weeklyFable, plan.weeklyFable >= 80 ? 'warn' : '')}
    ${planBar(`Usage credits — $${plan.creditsSpent} spent · ${plan.creditsPct}% used · resets ${esc(plan.creditsResets || '')}`, plan.creditsPct, plan.creditsPct >= 90 ? 'danger' : 'warn')}
  </div>` : '';
  const usageHero = `
    <div class="ovhero">
      <div class="l">${heroLabel}</div>
      <div class="ovheronum">${heroNum}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${heroSub}</div>
    </div>
    ${planCard}`;
  const active = runs.filter(m => m.status === 'running' || m.status === 'queued').length;
  const routePct = routing && routing.total ? Math.round(100 * routing.ok / routing.total) + '% ok' : '—';
  const stat = (label, val, cls) => `<div class="card ovstat"><div class="l">${label}</div><div class="ovstatnum ${cls || ''}">${val}</div></div>`;

  $('#overview').innerHTML = `
    <h2>Overview</h2>
    ${usageHero}
    <div class="cards ovstats">
      ${stat('Today', '$' + spend.toFixed(2), 'accent')}
      ${stat('Runs', tRuns.length)}
      ${stat('Success', okRate === null ? '—' : okRate + '%')}
      ${stat('Active', active, active ? 'accent' : '')}
      ${stat('Routing', routePct, routing && routing.suspects && routing.suspects.length ? 'warn' : '')}
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
  if ($('#ovPlanRefresh')) $('#ovPlanRefresh').onclick = () => load('overview', true); // re-fetch latest plan numbers
  startFeed();
};
