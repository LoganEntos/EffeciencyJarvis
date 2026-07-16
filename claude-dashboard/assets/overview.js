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

// Lovable redesign prompt for this tab — editable, persisted, one-click copy
// (same pattern as the Projects SharePoint transfer-prompt panel).
const OVPROMPT_KEY = 'hub.overview.lovablePrompt';
const DEFAULT_OVPROMPT = `Design a dark operator-cockpit "Overview" dashboard screen for a personal AI agent hub. This is the landing tab — it should read as command-center status, not a generic admin panel.

Design tokens (reuse exactly, this must match the rest of the app):
- Background #0c0b0a, panel #17140f, panel-2 #141210, hairline #ffffff12 (stronger #ffffff24), text #f2ece0, muted #a79e8c
- Accent amber #e8a33d (soft fill #e8a33d1a, dim #e8a33d40), success green #4bc47a, error red #e05252
- Fonts: Bricolage Grotesque for display/headings (800 weight for h1, 600 for h2), JetBrains Mono for every number/metric/label/control, Instrument Serif reserved for exactly one large hero number
- Shapes: 4px radius cards, 3px radius controls, pill badges at 20px radius, subtle inset top-highlight line on panels. No drop shadows, no glassmorphism, no purple gradients.

Critical framing: there is NO API that exposes Claude subscription plan usage. Kill any "plan usage %" bars entirely — every metric must be something the hub can actually measure from real run history.

Hero (top, full-width): one big Instrument Serif number = current chat's context-window utilization (e.g. "34%"), subtext in mono: "68K of 200K tokens · claude-sonnet-5 · 2m ago". Small conic-gradient ring next to it (amber under 70%, warm-amber warn 70-90%, red 90%+).

Row of 5 compact stat cards (mono numerals, Bricolage label above): Success rate, Routing accuracy, Lean-model share, Avg run duration, Active runs.

Model distribution & success-rate panel (centerpiece): one row per model seen in run history — name, a share bar sized to % of finished runs (colored by cost tier: cheap=amber, mid=warm amber, heavy=red), share % and count, a success-rate pill (green >=90%, amber 70-89%, red <70%), avg duration and avg tokens in dim mono. Sort by run count descending.

Current-chat analytics card: context ring + model/tier badges + token in/out + duration + memory-recall count + artifact count + routing reason. One dense horizontal card.

Below the fold: system status pills (API auth, engram memory count, MCP servers, agents/skills/commands counts), a clickable "Recent runs" list, a collapsed raw session log in a mono <pre> block.

Placeholder room (don't fully build, just leave visual space / ghost state): per-model success sparkline over last ~20 runs, a cost-tier donut toggle, a routing-disagreements drill-down, a time-range selector (today/7d/30d/all).

Keep density high — power-user cockpit, not a marketing dashboard. One staggered fade/slide-up on load, no other motion.`;
const ovPromptGet = () => { try { return localStorage.getItem(OVPROMPT_KEY) ?? DEFAULT_OVPROMPT; } catch { return DEFAULT_OVPROMPT; } };
const ovPromptSet = v => { try { localStorage.setItem(OVPROMPT_KEY, v); } catch {} };
let ovShowPrompt = false;
function renderOvPrompt() {
  const box = $('#ovPromptPanel'); if (!box) return;
  if (!ovShowPrompt) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="card" style="margin-bottom:20px">
      <div class="flex" style="justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span class="l">⧉ Lovable redesign prompt — Overview tab
          <span class="muted" style="font-weight:400;font-size:11.5px">paste into lovable.com · edits saved automatically</span></span>
        <span class="flex" style="gap:8px">
          <button id="ovpCopy" style="padding:5px 13px;font-size:11.5px">Copy</button>
          <button id="ovpReset" class="ghost" style="padding:5px 11px;font-size:11px">Reset to default</button>
        </span>
      </div>
      <textarea id="ovpText" spellcheck="false" style="width:100%;min-height:220px;background:var(--panel2);color:var(--text);
        border:1px solid var(--line);border-radius:var(--r);padding:10px;font-family:var(--font-mono);font-size:12px;resize:vertical">${esc(ovPromptGet())}</textarea>
      <div id="ovpToast" class="muted" style="font-size:11.5px;min-height:16px;margin-top:4px"></div>
    </div>`;
  const ta = $('#ovpText'), toast = m => { const t = $('#ovpToast'); if (t) { t.textContent = m; setTimeout(() => { if (t.textContent === m) t.textContent = ''; }, 1600); } };
  ta.oninput = () => ovPromptSet(ta.value);
  $('#ovpCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast('Copied ✓'); }
    catch { ta.select(); try { document.execCommand('copy'); toast('Copied ✓'); } catch { toast('Select-all + Ctrl-C to copy'); } }
  };
  $('#ovpReset').onclick = () => { ovPromptSet(DEFAULT_OVPROMPT); ta.value = DEFAULT_OVPROMPT; toast('Reset to default'); };
}

renderers.overview = async function () {
  const [d, runs, files, routing] = await Promise.all([
    api('/api/overview'),
    api('/api/runs').catch(() => []),
    api('/api/files').catch(() => []),
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

  const usageHero = `
    <div class="ovhero">
      <div class="l">${heroLabel}</div>
      <div class="ovheronum">${heroNum}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${heroSub}</div>
    </div>`;

  // ---- per-model breakdown: share of runs + success rate, from real run history
  // (plan-usage % bars were manual Config entries we can't verify against the API —
  // this replaces them with numbers the hub actually measures).
  function modelBreakdown(list) {
    const by = {};
    list.forEach(m => {
      const k = m.model || 'default';
      const e = (by[k] ||= { total: 0, ok: 0, durs: [], tok: 0, tokN: 0 });
      e.total++; if (m.status === 'done') e.ok++;
      if (m.durationMs != null) e.durs.push(m.durationMs);
      if (m.tokensIn != null) { e.tok += m.tokensIn + (m.tokensOut || 0); e.tokN++; }
    });
    return Object.entries(by).map(([model, e]) => ({
      model, count: e.total,
      share: list.length ? Math.round(100 * e.total / list.length) : 0,
      success: Math.round(100 * e.ok / e.total),
      avgDur: e.durs.length ? e.durs.reduce((s, x) => s + x, 0) / e.durs.length : null,
      avgTok: e.tokN ? Math.round(e.tok / e.tokN) : null,
    })).sort((a, b) => b.count - a.count);
  }
  const modelRows = modelBreakdown(finished);
  const modelBreakCard = modelRows.length ? `<div class="modelbreak">
    <div class="modelbreak-h">Model distribution &amp; success rate — ${finished.length} finished runs</div>
    ${modelRows.map(r => {
      const tier = modelTier(r.model);
      const tierColor = tier === 'cheap' ? 'var(--accent)' : tier === 'heavy' ? 'var(--red)' : 'var(--amber, #d9a441)';
      const succCls = r.success >= 90 ? 'ok' : r.success >= 70 ? 'warn' : 'err';
      return `<div class="modelrow">
        <div class="modelrow-name mono" title="${esc(r.model)}">${esc(r.model)}</div>
        <div class="modelrow-bar"><div style="width:${r.share}%;background:${tierColor}"></div></div>
        <div class="modelrow-share mono">${r.share}% · ${r.count}</div>
        <div class="modelrow-meta">
          <span class="pill ${succCls}" style="min-width:48px;text-align:center">${r.success}% ok</span>
          <span class="muted mono" style="font-size:11px">${shortDur(r.avgDur)}</span>
          <span class="muted mono" style="font-size:11px">${r.avgTok != null ? shortK(r.avgTok) + ' tok' : '—'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>` : '';

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

  $('#overview').innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:baseline">
      <h2>Overview</h2>
      <button id="ovPromptBtn" class="ghost" style="padding:5px 11px;font-size:11px" title="Copy the Lovable redesign prompt for this tab">⧉ Lovable prompt</button>
    </div>
    <div id="ovPromptPanel"></div>
    ${usageHero}
    ${chatCard}
    <div class="cards ovstats">
      ${stat('Success', okRate === null ? '—' : okRate + '%', okRate != null && okRate < 70 ? 'warn' : 'accent')}
      ${stat('Routing', routePct == null ? '—' : routePct + '%', routing && routing.suspects && routing.suspects.length ? 'warn' : '')}
      ${stat('Lean models', leanPct == null ? '—' : leanPct + '%', leanPct != null && leanPct < 50 ? 'warn' : '')}
      ${stat('Avg run', shortDur(avgDur))}
      ${stat('Active', active, active ? 'accent' : '')}
    </div>
    ${modelBreakCard}
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
  $('#ovPromptBtn').onclick = () => { ovShowPrompt = !ovShowPrompt; renderOvPrompt(); };
  if (ovShowPrompt) renderOvPrompt();
  $('#overview').querySelectorAll('.card.clickable').forEach(c => c.onclick = () => goTab(c.dataset.goto));
  $('#overview').querySelectorAll('.ovrun').forEach(r => r.onclick = () => { goTab('run'); ensureRunUI(); openRun(r.dataset.id); });
  startFeed();
};
