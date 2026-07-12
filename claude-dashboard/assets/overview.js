/* Overview tab: context-window + efficiency focus (no monetary values).
   Hero = context utilization of the current chat (latest run); stat cards =
   success / routing / lean-model share / avg run / active; a "current chat"
   analytics card; model-mix bar; recent runs; raw session feed.
   Split from app.js; loaded after it (uses global api/$/esc/goTab/rel/
   startFeed/openRun/ensureRunUI/load). */
'use strict';

// context-window capacity (tokens) per model — Claude models are 200K standard.
const CTX_WINDOW = {
  opus: 200000, 'claude-opus-4-8': 200000,
  sonnet: 200000, 'claude-sonnet-5': 200000, 'anthropic/claude-sonnet-5': 200000,
  haiku: 200000, 'claude-haiku-4-5': 200000, 'claude-haiku-4-5-20251001': 200000,
  fable: 200000, 'claude-fable-5': 200000,
};
function ctxWindow(model) { return CTX_WINDOW[model] || 200000; }
// cheap = haiku/fable, mid = sonnet, heavy = opus (unknown → mid)
function modelTier(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'heavy';
  if (m.includes('haiku') || m.includes('fable')) return 'cheap';
  if (m.includes('sonnet')) return 'mid';
  return 'mid';
}
function shortK(n) {
  if (n == null) return '—';
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(n);
}
function shortDur(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  return s < 60 ? s.toFixed(s < 10 ? 1 : 0) + 's' : (s / 60).toFixed(1) + 'm';
}

// context-utilisation ring — conic-gradient, no canvas/svg. pct 0-100 used.
function ctxRing(pct, size, label) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const danger = p >= 90, warn = p >= 70 && !danger;
  const color = danger ? 'var(--red)' : (warn ? 'var(--amber)' : 'var(--accent)');
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;
    background:conic-gradient(${color} ${p * 3.6}deg, var(--line) 0deg);
    display:flex;align-items:center;justify-content:center">
    <div style="width:${size - 16}px;height:${size - 16}px;border-radius:50%;background:var(--panel);
      display:flex;align-items:center;justify-content:center;flex-direction:column">
      <span class="mono" style="font-size:${size > 100 ? 20 : 15}px;font-weight:700;color:${color}">${pct == null ? '—' : p + '%'}</span>
      <span class="mono" style="font-size:9px;color:var(--dim);letter-spacing:1px;text-transform:uppercase">${label || 'used'}</span>
    </div></div>`;
}

renderers.overview = async function () {
  const [d, runs, files, cfg, routing] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/files').catch(() => []),
    api('/api/settings').catch(() => ({})),
    api('/api/routing').catch(() => null),
  ]);
  $('#projBadge').textContent = d.project;
  $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;
  const today = new Date().toDateString();
  const tRuns = runs.filter(m => new Date(m.startedAt || m.queuedAt || 0).toDateString() === today);
  const finished = runs.filter(m => ['done', 'error', 'cancelled'].includes(m.status));
  const okRate = finished.length ? Math.round(100 * finished.filter(m => m.status === 'done').length / finished.length) : null;
  const active = runs.filter(m => m.status === 'running' || m.status === 'queued').length;
  const apiPill = d.hasApiKey ? '<span class="pill ok">auth ready</span>' : '<span class="pill warn">no auth — runs can\'t execute</span>';
  const memPill = d.engramCount ? `<span class="pill ok">engram: ${d.engramCount} memories</span>` : '<span class="pill warn">memory empty — runs auto-capture</span>';

  // ---- current chat = the latest run; token counts if the run reported them ----
  const chat = runs[0] || null;
  const win = chat ? ctxWindow(chat.model) : 200000;
  const used = chat && chat.tokensIn != null ? chat.tokensIn + (chat.tokensOut || 0) : null;
  const ctxPct = used != null ? Math.round(100 * used / win) : null;
  // most recent run that actually reported tokens (fallback reference point)
  const lastTokened = runs.find(m => m.tokensIn != null);

  // ---- efficiency: routing accuracy + lean-model share + avg duration ----
  const routePct = routing && routing.total ? Math.round(100 * routing.ok / routing.total) : null;
  const tiers = { cheap: 0, mid: 0, heavy: 0 };
  finished.forEach(m => { tiers[modelTier(m.model)]++; });
  const tierTotal = tiers.cheap + tiers.mid + tiers.heavy;
  const leanPct = tierTotal ? Math.round(100 * (tiers.cheap + tiers.mid) / tierTotal) : null;
  const durs = finished.map(m => m.durationMs).filter(x => x != null);
  const avgDur = durs.length ? durs.reduce((s, x) => s + x, 0) / durs.length : null;

  // hero — context utilisation of the current chat
  const heroNum = ctxPct != null ? ctxPct + '%' : shortK(win);
  const heroLabel = ctxPct != null ? 'Context used · current chat' : 'Context window · current chat';
  const heroSub = ctxPct != null
    ? `${shortK(used)} of ${shortK(win)} tokens · ${esc(chat.model || 'default')} · ${rel(chat.startedAt || chat.queuedAt)}`
    : (chat ? `${shortK(win)}-token window · ${esc(chat.model || 'default')} · token usage not reported for this run` : 'no runs yet');

  // plan usage bars (kept — %-based; the credits line shows % only, no $)
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
    ${planBar(`Usage credits — ${plan.creditsPct}% used · resets ${esc(plan.creditsResets || '')}`, plan.creditsPct, plan.creditsPct >= 90 ? 'danger' : 'warn')}
  </div>` : '';

  const usageHero = `
    <div class="ovhero">
      <div class="l">${heroLabel}</div>
      <div class="ovheronum">${heroNum}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${heroSub}</div>
    </div>
    ${planCard}`;

  // ---- current-chat analytics card ----
  const chatCard = chat ? `<div class="card" style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
    ${ctxRing(ctxPct, 92, 'context')}
    <div style="min-width:0;flex:1">
      <div class="flex" style="justify-content:space-between;align-items:baseline">
        <div class="l">Current chat · analytics</div>
        <span class="pill ${chat.status === 'done' ? 'ok' : (chat.status === 'error' ? 'err' : 'warn')}">${esc(chat.status)}</span>
      </div>
      <div class="pex" style="margin:6px 0 10px">${esc(chat.promptExcerpt || '(no prompt captured)')}</div>
      <div class="flex" style="gap:8px;flex-wrap:wrap">
        <span class="pill neutral">◈ ${esc(chat.model || 'default')} · ${modelTier(chat.model)}</span>
        <span class="pill neutral">▭ window ${shortK(win)}</span>
        <span class="pill neutral">tokens ${used != null ? shortK(chat.tokensIn) + '→' + shortK(chat.tokensOut || 0) : 'not reported'}</span>
        <span class="pill neutral">⧗ ${shortDur(chat.durationMs)}</span>
        ${chat.recallCount ? `<span class="pill neutral">⟲ ${chat.recallCount} memories</span>` : ''}
        ${chat.artifactCount ? `<span class="pill neutral">◫ ${chat.artifactCount} artifacts</span>` : ''}
        ${chat.routedReason ? `<span class="pill neutral" title="auto-routing reason">⚖ ${esc(chat.routedReason)}</span>` : ''}
      </div>
      ${used == null && lastTokened ? `<div class="muted" style="font-size:11px;margin-top:8px">last measured context: ${shortK(lastTokened.tokensIn + (lastTokened.tokensOut || 0))} / ${shortK(ctxWindow(lastTokened.model))} on ${esc(lastTokened.model)} (${rel(lastTokened.startedAt || lastTokened.queuedAt)})</div>` : ''}
    </div>
  </div>` : '';

  // ---- efficiency stat cards (no money) ----
  const stat = (label, val, cls) => `<div class="card ovstat"><div class="l">${label}</div><div class="ovstatnum ${cls || ''}">${val}</div></div>`;

  // model-mix bar (efficiency: how work spreads across cheap/mid/heavy tiers)
  const seg = (n, cls, title) => tierTotal ? `<div title="${title}" style="width:${100 * n / tierTotal}%;background:${cls}"></div>` : '';
  const mixBar = tierTotal ? `<div style="padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);margin-bottom:22px">
    <div style="color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Model mix — ${finished.length} finished runs (lean = cheaper tiers doing the work)</div>
    <div style="display:flex;height:12px;border-radius:6px;overflow:hidden;gap:1px">
      ${seg(tiers.cheap, 'var(--accent)', 'cheap (haiku/fable): ' + tiers.cheap)}
      ${seg(tiers.mid, 'var(--amber, #d9a441)', 'mid (sonnet): ' + tiers.mid)}
      ${seg(tiers.heavy, 'var(--red)', 'heavy (opus): ' + tiers.heavy)}
    </div>
    <div class="flex" style="gap:14px;flex-wrap:wrap;margin-top:9px">
      <span class="pill neutral" style="font-size:11px">● cheap ${tiers.cheap}</span>
      <span class="pill neutral" style="font-size:11px">● mid ${tiers.mid}</span>
      <span class="pill neutral" style="font-size:11px">● heavy ${tiers.heavy}</span>
    </div>
  </div>` : '';

  $('#overview').innerHTML = `
    <h2>Overview</h2>
    ${usageHero}
    ${chatCard}
    <div class="cards ovstats">
      ${stat('Success', okRate === null ? '—' : okRate + '%', okRate != null && okRate < 70 ? 'warn' : 'accent')}
      ${stat('Routing', routePct == null ? '—' : routePct + '%', routing && routing.suspects && routing.suspects.length ? 'warn' : '')}
      ${stat('Lean models', leanPct == null ? '—' : leanPct + '%', leanPct != null && leanPct < 50 ? 'warn' : '')}
      ${stat('Avg run', shortDur(avgDur))}
      ${stat('Active', active, active ? 'accent' : '')}
    </div>
    ${mixBar}
    <div class="flex" style="margin-bottom:22px">${memPill}${apiPill}
      <span class="pill neutral">MCP: ${d.mcpServers.map(esc).join(', ') || 'none'}</span>
      <span class="pill neutral">library: ${d.counts.agents} agents · ${d.counts.skills} skills · ${d.counts.commands} commands</span></div>
    <h2>Recent runs <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to replay in the Run tab</span></h2>
    <div id="ovRuns">${runs.slice(0, 5).map(m => `
      <div class="row clickable ovrun" data-id="${esc(m.id)}">
        <div class="flex" style="justify-content:space-between">
          <span><span class="pill ${m.status === 'done' ? 'ok' : (m.status === 'error' ? 'err' : 'warn')}">${esc(m.status)}</span>
            <span class="muted" style="font-size:11.5px">${rel(m.startedAt || m.queuedAt)}${m.model ? ' · ' + esc(m.model) : ''}${m.tokensIn != null ? ' · ' + shortK(m.tokensIn) + '→' + shortK(m.tokensOut || 0) + ' tok' : ''}${m.durationMs ? ' · ' + shortDur(m.durationMs) : ''}${m.artifactCount ? ' · ◫ ' + m.artifactCount : ''}</span></span>
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
