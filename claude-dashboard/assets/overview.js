/* Overview tab — ported 1:1 from the amber-agent-orb Lovable build (project
   7ce003de, /src/routes/overview.tsx). A command-bridge cockpit: hero context
   ring, five efficiency stat cards with sparklines, per-engine panels (claude
   live from run history · hermes DORMANT at 0 until activated — never started
   here), a model-distribution/success table, a current-chat strip, then recent
   runs + system status + routing disagreements, and a live server-event tail.
   No dollar figures anywhere — tokens + % rates only. Styling: overview.css.
   Loaded after app.js (uses api/$/esc/goTab/rel/startFeed/openRun/ensureRunUI). */
'use strict';

const CTX_WINDOW = 200000; // every current Claude model is a 200K window
function ctxWindow(model) { return CTX_WINDOW; }
function modelTier(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return 'heavy';
  if (m.includes('haiku') || m.includes('fable')) return 'cheap';
  return 'mid';
}
function shortK(n) {
  if (n == null) return '—';
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
}
function shortDur(ms) {
  if (ms == null) return '—';
  const s = ms / 1000;
  if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + 's';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r ? `${m}m${r}s` : `${m}m`;
}

// hero conic ring — reproduces the Lovable markup exactly.
function ovRing(pct, size) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const color = p >= 90 ? 'var(--red)' : (p >= 70 ? 'var(--amber)' : 'var(--accent)');
  return `<div class="ov-ring" style="width:${size}px;height:${size}px;background:conic-gradient(${color} ${(p * 3.6).toFixed(1)}deg, color-mix(in oklab, var(--txt) 8%, transparent) 0)">
    <div class="ov-ring-inner">
      <span class="ov-ring-num" style="color:${color}">${pct == null ? '—' : p + '%'}</span>
      <span class="ov-ring-cap">ctx</span>
    </div></div>`;
}

// tiny sparkline from a numeric series (any scale, normalized 0..1).
function spark(vals, w, h) {
  w = w || 100; h = h || 14;
  if (!vals || vals.length < 2) return `<svg class="ovspark" viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(' ');
  return `<svg class="ovspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--muted)" stroke-width="1"/></svg>`;
}

renderers.overview = async function () {
  const [d, runs, routing, usage] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/routing').catch(() => null),
    api('/api/usage').catch(() => null),
  ]);
  $('#projBadge').textContent = d.project;
  $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;

  const today = new Date().toDateString();
  const tRuns = runs.filter(m => new Date(m.startedAt || m.queuedAt || 0).toDateString() === today);
  const finished = runs.filter(m => ['done', 'error', 'cancelled'].includes(m.status));
  const okRate = finished.length ? Math.round(100 * finished.filter(m => m.status === 'done').length / finished.length) : null;
  const active = runs.filter(m => m.status === 'running' || m.status === 'queued').length;
  const todayOk = tRuns.filter(m => ['done', 'error', 'cancelled'].includes(m.status));
  const todayOkPct = todayOk.length ? Math.round(100 * todayOk.filter(m => m.status === 'done').length / todayOk.length) : null;

  // current chat = latest run
  const chat = runs[0] || null;
  const win = chat ? ctxWindow(chat.model) : CTX_WINDOW;
  const used = chat && chat.tokensIn != null ? chat.tokensIn + (chat.tokensOut || 0) : null;
  // clamp at 100 — cache-read tokens can push a raw count past the window, and a
  // ">100%" context reading reads as a bug rather than the truth it is.
  const ctxPct = used != null ? Math.min(100, Math.round(100 * used / win)) : null;

  // efficiency
  const routePct = routing && routing.total ? Math.round(100 * routing.ok / routing.total) : null;
  const tiers = { cheap: 0, mid: 0, heavy: 0 };
  finished.forEach(m => tiers[modelTier(m.model)]++);
  const tierTotal = tiers.cheap + tiers.mid + tiers.heavy;
  const leanPct = tierTotal ? Math.round(100 * (tiers.cheap + tiers.mid) / tierTotal) : null;
  const durs = finished.map(m => m.durationMs).filter(x => x != null);
  const avgDur = durs.length ? durs.reduce((s, x) => s + x, 0) / durs.length : null;

  // sparkline series from the last ~16 finished runs (oldest→newest)
  const recent = finished.slice(0, 16).reverse();
  const sparkSucc = recent.map(m => m.status === 'done' ? 1 : 0);
  const sparkLean = recent.map(m => modelTier(m.model) === 'heavy' ? 0 : 1);
  const sparkDur = recent.map(m => m.durationMs || 0);
  const autoRuns = recent.filter(m => m.routedReason);
  const sparkRoute = autoRuns.map(m => m.status === 'done' ? 1 : 0);

  // ---------- hero ----------
  const heroSub = ctxPct != null
    ? `${shortK(used)} of ${shortK(win)} · ${esc(chat.model || 'default')} · ${rel(chat.startedAt || chat.queuedAt)}`
    : (chat ? `${shortK(win)} window · ${esc(chat.model || 'default')} · usage not reported` : 'no runs yet');
  const hero = `<section class="ov-panel ovhero">
    <div class="ovhero-l">
      ${ovRing(ctxPct, 92)}
      <div>
        <div class="ovhero-big">${ctxPct != null ? ctxPct + '%' : '—'}</div>
        <div class="ovhero-sub">${heroSub}</div>
      </div>
    </div>
    <div class="ovhero-r">
      <div class="ov-label">24h run pulse</div>
      <div class="ovhero-pulse">today: ${tRuns.length} run${tRuns.length === 1 ? '' : 's'}${todayOkPct != null ? ' · ' + todayOkPct + '% ok' : ''}</div>
    </div>
  </section>`;

  // ---------- stat cards ----------
  const stat = (label, val, cls, sp) => `<div class="ov-panel ovstat">
    <div class="ov-label">${label}</div>
    <div class="ovstat-num ${cls || ''}">${val}</div>
    ${spark(sp)}
  </div>`;
  const statCards = `<div class="ovstats">
    ${stat('success rate', okRate == null ? '—' : okRate + '%', okRate != null && okRate < 70 ? 'warn' : 'accent', sparkSucc)}
    ${stat('routing accuracy', routePct == null ? '—' : routePct + '%', routing && routing.suspects && routing.suspects.length ? 'warn' : '', sparkRoute)}
    ${stat('lean-model share', leanPct == null ? '—' : leanPct + '%', leanPct != null && leanPct < 50 ? 'warn' : '', sparkLean)}
    ${stat('avg run duration', shortDur(avgDur), '', sparkDur)}
    ${stat('active runs', active, active ? 'accent' : '', [])}
  </div>`;

  // ---------- engine panels ----------
  const claudeRuns = finished.filter(m => m.engine !== 'hermes');
  const claudeOk = claudeRuns.length ? Math.round(100 * claudeRuns.filter(m => m.status === 'done').length / claudeRuns.length) : null;
  const claudeTokRuns = claudeRuns.filter(m => m.tokensIn != null);
  const claudeAvgTok = claudeTokRuns.length ? Math.round(claudeTokRuns.reduce((s, m) => s + m.tokensIn + (m.tokensOut || 0), 0) / claudeTokRuns.length) : 0;
  const claudeDurs = claudeRuns.map(m => m.durationMs).filter(x => x != null);
  const claudeAvgDur = claudeDurs.length ? claudeDurs.reduce((s, x) => s + x, 0) / claudeDurs.length : null;
  const claudeTokMoved = claudeRuns.reduce((s, m) => s + (m.tokensIn || 0) + (m.tokensOut || 0), 0);
  // per-model mix within claude
  const mix = {};
  claudeRuns.forEach(m => { const k = m.model || 'default'; const e = (mix[k] ||= { n: 0, tok: 0, tn: 0 }); e.n++; if (m.tokensIn != null) { e.tok += m.tokensIn + (m.tokensOut || 0); e.tn++; } });
  const mixRows = Object.entries(mix).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([model, e]) =>
    `<div class="oveng-mixrow"><span class="m-name">${esc(model)} · ${modelTier(model)}</span><span class="m-val">${e.n} · ${e.tn ? shortK(Math.round(e.tok / e.tn)) : '—'}</span></div>`).join('');

  const claudePanel = `<div class="ov-panel oveng">
    <div class="oveng-strip" style="background:var(--accent)"></div>
    <div class="oveng-head"><span class="oveng-name">claude</span><span class="oveng-ok">${claudeOk == null ? '—' : claudeOk + '% ok'}</span></div>
    <div class="ov-label" style="font-size:9px;margin-top:2px">engine</div>
    <div class="oveng-stats">
      <div><div class="oveng-stat-k">runs</div><div class="oveng-stat-v">${claudeRuns.length}</div></div>
      <div><div class="oveng-stat-k">avg tok/task</div><div class="oveng-stat-v">${shortK(claudeAvgTok)}</div></div>
      <div><div class="oveng-stat-k">avg dur</div><div class="oveng-stat-v">${shortDur(claudeAvgDur)}</div></div>
    </div>
    <div class="oveng-mix ov-hair-t"><span class="ov-label">model mix</span>${mixRows || '<div class="oveng-foot">no runs yet</div>'}</div>
    <div class="oveng-foot">tokens moved · ${shortK(claudeTokMoved)}</div>
  </div>`;

  // hermes — DORMANT. All zeros; never activated from here.
  const hermesTiers = [['hermes-3-8b · draft · local', 0], ['hermes-3-70b · reason · local', 0], ['hermes-3-405b · escalate · local', 0]];
  const hermesPanel = `<div class="ov-panel oveng">
    <div class="oveng-strip" style="background:var(--cool)"></div>
    <div class="oveng-head"><span class="oveng-name dim">hermes</span><span class="oveng-ok ov-dormant">0% ok</span></div>
    <div class="ov-label" style="font-size:9px;margin-top:2px">engine · dormant</div>
    <div class="oveng-stats">
      <div><div class="oveng-stat-k">runs</div><div class="oveng-stat-v ov-dormant">0</div></div>
      <div><div class="oveng-stat-k">avg tok/task</div><div class="oveng-stat-v ov-dormant">0</div></div>
      <div><div class="oveng-stat-k">avg dur</div><div class="oveng-stat-v ov-dormant">0s</div></div>
    </div>
    <div class="oveng-mix ov-hair-t"><span class="ov-label">tier breakdown</span>
      ${hermesTiers.map(([n]) => `<div class="oveng-mixrow"><span class="m-name ov-dormant">${esc(n)}</span><span class="m-val ov-dormant">0 · 0</span></div>`).join('')}
    </div>
    <div class="oveng-foot ov-dormant">dormant — not activated</div>
  </div>`;

  // tokens-per-task chart (claude live vs hermes dormant 0)
  const maxTok = Math.max(claudeAvgTok, 1);
  const bar = (label, val, color) => {
    const pct = Math.round(100 * val / maxTok);
    return `<div style="margin:6px 0"><div class="oveng-mixrow"><span class="m-name">${label}</span><span class="m-val">${shortK(val)}</span></div>
      <div class="ovmd-bar" style="margin-top:3px"><div style="width:${pct}%;background:${color}"></div></div></div>`;
  };
  const chartPanel = `<div class="ov-panel oveng">
    <div class="oveng-head"><span class="ov-label">tokens per task · per engine</span></div>
    <div style="margin-top:10px">
      ${bar('claude', claudeAvgTok, 'var(--accent)')}
      ${bar('hermes', 0, 'var(--cool)')}
    </div>
    <div class="ovchart-caption">hermes dormant — offload candidates surface here once activated</div>
  </div>`;

  const enginePanels = `<div class="ovengines">${claudePanel}${hermesPanel}${chartPanel}</div>`;

  // ---------- model distribution table ----------
  const md = {};
  finished.forEach(m => { const k = m.model || 'default'; const e = (md[k] ||= { n: 0, ok: 0, durs: [], tok: 0, tn: 0 }); e.n++; if (m.status === 'done') e.ok++; if (m.durationMs != null) e.durs.push(m.durationMs); if (m.tokensIn != null) { e.tok += m.tokensIn + (m.tokensOut || 0); e.tn++; } });
  const mdRows = Object.entries(md).map(([model, e]) => ({
    model, n: e.n, share: finished.length ? Math.round(100 * e.n / finished.length) : 0,
    succ: Math.round(100 * e.ok / e.n),
    dur: e.durs.length ? e.durs.reduce((s, x) => s + x, 0) / e.durs.length : null,
    tok: e.tn ? Math.round(e.tok / e.tn) : null,
  })).sort((a, b) => b.n - a.n);
  const mdTable = `<section class="ov-panel ovmd">
    <div class="ovmd-head ov-hair-b"><span class="ov-label">model distribution · success</span><span class="ov-label">${finished.length} finished</span></div>
    <div class="ovmd-body">
      <div class="ovmd-grid h"><div>model</div><div>count</div><div>weight</div><div>success</div><div>avg dur · tok</div></div>
      ${mdRows.map(r => {
        const tier = modelTier(r.model);
        const col = tier === 'cheap' ? 'var(--accent)' : tier === 'heavy' ? 'var(--red)' : 'var(--amber)';
        const sc = r.succ >= 90 ? 'ok' : r.succ >= 70 ? 'warn' : 'err';
        return `<div class="ovmd-grid ovmd-row">
          <div class="ovmd-model"><span class="n">${esc(r.model)}</span><span class="ovmd-tier">${tier.toUpperCase()}</span></div>
          <div class="ovmd-count">${r.n}</div>
          <div class="ovmd-weight"><div class="ovmd-bar"><div style="width:${r.share}%;background:${col}"></div></div><span class="ovmd-wpct">${r.share}%</span></div>
          <div class="ovmd-succ ${sc}">${r.succ}%</div>
          <div class="ovmd-dur">${shortDur(r.dur)} · ${r.tok != null ? shortK(r.tok) : '—'}</div>
        </div>`;
      }).join('') || '<div class="oveng-foot">no finished runs yet</div>'}
    </div>
  </section>`;

  // ---------- current-chat strip ----------
  const chatStrip = chat ? `<section class="ov-panel ovchat">
    <span class="k">ctx</span> <span class="v accent">${ctxPct != null ? ctxPct + '%' : '—'}</span>
    <span class="sep">·</span> <span class="k">${esc(chat.model || 'default')}</span>
    <span class="sep">·</span> <span class="k">tokens</span> <span class="v">${chat.tokensIn != null ? shortK(chat.tokensIn) + ' → ' + shortK(chat.tokensOut || 0) : 'not reported'}</span>
    <span class="sep">·</span> <span class="k">dur</span> <span class="v">${shortDur(chat.durationMs)}</span>
    <span class="sep">·</span> <span class="k">recalled</span> <span class="v">${chat.recallCount || 0}</span>
    <span class="sep">·</span> <span class="k">artifacts</span> <span class="v">${chat.artifactCount || 0}</span>
    ${chat.routedReason ? `<span class="sep">·</span> <span class="k">route</span> <span class="v">${esc(chat.routedReason)}</span>` : ''}
  </section>` : '';

  // ---------- recent runs ----------
  const recentRuns = `<section class="ov-panel">
    <div class="ovsec-head ov-hair-b"><span class="ov-label">recent runs</span><button class="ovtail-btn" id="ovViewAll">view all →</button></div>
    <div class="ovsec-body">${runs.slice(0, 6).map(m => `
      <div class="ovrun" data-id="${esc(m.id)}">
        <span class="st ${m.status}">${esc(m.status)}</span>
        <span class="mono">${esc(m.model || '—')}</span>
        <span class="mono">${m.tokensIn != null ? shortK(m.tokensIn + (m.tokensOut || 0)) : '—'}</span>
        <span class="mono">${m.durationMs ? shortDur(m.durationMs) : '—'}</span>
        <span class="mono">${m.artifactCount || 0}▢</span>
        <span class="pex" title="${esc(m.promptExcerpt || '')}">${esc(m.promptExcerpt || '')}</span>
      </div>`).join('') || '<div class="oveng-foot">No runs yet — open the Run tab.</div>'}</div>
  </section>`;

  // ---------- system status ----------
  const sysStatus = `<section class="ov-panel">
    <div class="ovsec-head ov-hair-b"><span class="ov-label">system status</span></div>
    <div class="ovstatus">
      <div class="ovstatus-row"><span class="k">api auth</span><span class="v" style="color:${d.hasApiKey ? 'var(--green)' : 'var(--red)'}">${d.hasApiKey ? 'ok' : 'no auth'}</span></div>
      <div class="ovstatus-row"><span class="k">engram</span><span class="v">${d.engramCount || 0}</span></div>
      <div class="ovstatus-row"><span class="k">mcp</span><span class="v">${(d.mcpServers || []).length}</span></div>
      <div class="ovstatus-row"><span class="k">agents</span><span class="v">${d.counts.agents}</span></div>
      <div class="ovstatus-row"><span class="k">skills</span><span class="v">${d.counts.skills}</span></div>
      <div class="ovstatus-row"><span class="k">commands</span><span class="v">${d.counts.commands}</span></div>
    </div>
  </section>`;

  // ---------- routing disagreements ----------
  const downTier = { opus: 'sonnet', sonnet: 'haiku', haiku: 'haiku' };
  const upTier = { haiku: 'sonnet', sonnet: 'opus', opus: 'opus' };
  const suspects = (routing && routing.suspects) || [];
  const disRows = suspects.slice(0, 5).map(s => {
    const from = (s.model || '').toLowerCase();
    const to = /over/.test(s.why || '') ? (downTier[from] || from) : (upTier[from] || from);
    return `<div class="ovdis-row"><span class="p" title="${esc(s.why || '')}">${esc((s.prompt || '').slice(0, 40) || '(run)')}</span><span class="from">${esc(s.model || '?')}</span><span class="arr">→</span><span class="to">${esc(to)}</span></div>`;
  }).join('');
  const disagreements = `<section class="ov-panel">
    <div class="ovsec-head ov-hair-b"><span class="ov-label">routing disagreements</span></div>
    <div class="ovdis">${disRows || '<div class="oveng-foot">every auto-routed pick looks right</div>'}</div>
  </section>`;

  const bottom = `<div class="ovbottom">${recentRuns}<div class="ovbottom-r">${sysStatus}${disagreements}</div></div>`;

  // ---------- tail ----------
  const tail = `<section class="ov-panel ovtail">
    <button class="ovtail-btn" id="ovTailBtn">▸ tail live server events</button>
    <pre id="feed" class="hidden">Loading…</pre>
    <span id="feedSession" class="hidden"></span>
  </section>`;

  $('#overview').innerHTML = `
    <header class="jhead">
      <div><div class="ov-label ov-eyebrow">command bridge · local runs only</div><h1 class="ov-h1">Overview</h1></div>
    </header>
    <div class="ov-wrap">
      ${hero}
      ${statCards}
      ${enginePanels}
      ${mdTable}
      ${chatStrip}
      ${bottom}
      ${tail}
    </div>`;

  $('#overview').querySelectorAll('.ovrun').forEach(r => r.onclick = () => { goTab('run'); ensureRunUI(); openRun(r.dataset.id); });
  const va = $('#ovViewAll'); if (va) va.onclick = () => goTab('run');
  const tb = $('#ovTailBtn');
  if (tb) tb.onclick = () => {
    const f = $('#feed'); if (!f) return;
    const open = f.classList.toggle('hidden');
    tb.textContent = open ? '▸ tail live server events' : '▾ live server events';
    if (!open) startFeed();
  };
};
