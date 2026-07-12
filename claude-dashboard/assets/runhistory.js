/* Run history (W2): the history list under the composer — fetch, filter
   chips, per-model stat pills, run rows + replay/delete. Split from run.js
   (N11); loaded after run.js. Uses globals api/$/esc + openRun (run.js). */
'use strict';

// ---- history (W2) ----
let histRuns = [];
async function refreshHistory() {
  if (!$('#runHistory')) return;
  try { histRuns = await api('/api/runs'); } catch { $('#runHistory').innerHTML = '<div class="muted">History unavailable.</div>'; return; }
  if (!Array.isArray(histRuns)) histRuns = [];
  // (header's own #spendBadge — see app.js updateSpendBadge — already shows
  // today's run count+spend; a second script used to write a longer string
  // into that SAME id, which is what produced the unreadable "today: 52
  // ru…" truncation on narrow phones. Don't duplicate it here.)
  // N4: routing-accuracy chip (auto-routed runs only; suspects in the tooltip)
  try { routing = await api('/api/routing'); } catch { routing = null; }
  await renderUsageGauge();
  renderHistStats();
  renderHistory();
}
let routing = null;

// clickable stat chips: totals + outcome breakdown + per-model spend; clicking
// an outcome chip filters the list to it
let histStatusFilter = '';
function renderHistStats() {
  const el = $('#histStats');
  if (!el) return;
  const by = s => histRuns.filter(m => m.status === s);
  const total = histRuns.reduce((s, m) => s + (m.costUsd || 0), 0);
  const models = {};
  for (const m of histRuns) {
    const k = m.model || 'default';
    models[k] = models[k] || { n: 0, cost: 0 };
    models[k].n++; models[k].cost += m.costUsd || 0;
  }
  const chip = (label, cls, filter) => `<span class="pill ${cls}" data-f="${filter}" style="cursor:pointer${histStatusFilter === filter && filter ? ';outline:2px solid var(--accent-dim)' : ''}">${label}</span>`;
  el.innerHTML =
    chip(`all ${histRuns.length} · $${total.toFixed(2)}`, 'neutral', '') +
    chip(`✓ ${by('done').length} done`, 'ok', 'done') +
    chip(`✗ ${by('error').length} failed`, 'err', 'error') +
    chip(`◌ ${by('cancelled').length} cancelled`, 'warn', 'cancelled') +
    Object.entries(models).map(([k, v]) => `<span class="pill neutral">${esc(k)}: ${v.n} · $${v.cost.toFixed(2)}</span>`).join('') +
    (routing && routing.total ? `<span class="pill ${routing.suspects.length ? 'warn' : 'ok'}" title="${esc(routing.suspects.map(s => `${s.model}: ${s.why} — "${(s.prompt || '').slice(0, 60)}"`).join('\n') || 'every auto-routed pick looks right')}">⚖ auto-routing: ${Math.round(100 * routing.ok / routing.total)}% ok · ${routing.suspects.length} suspect${routing.suspects.length === 1 ? '' : 's'}</span>` : '');
  el.querySelectorAll('[data-f]').forEach(c => c.onclick = () => {
    histStatusFilter = histStatusFilter === c.dataset.f ? '' : c.dataset.f;
    renderHistStats(); renderHistory();
  });
}

function renderHistory() {
  const el = $('#runHistory');
  if (!el) return;
  if (!histRuns.length) { el.innerHTML = '<div class="muted">No runs yet — send your first prompt above.</div>'; return; }
  const q = ($('#histFilter').value || '').toLowerCase();
  const rows = histRuns.filter(m => (!q || (m.promptExcerpt || '').toLowerCase().includes(q))
    && (!histStatusFilter || m.status === histStatusFilter));
  if (!rows.length) { el.innerHTML = '<div class="muted">No runs match the filter.</div>'; return; }
  const pill = s => s === 'done' ? 'ok' : (s === 'running' || s === 'queued' || s === 'cancelled' ? 'warn' : 'err');
  // a "running" row that has gone silent (or whose process is gone) is flagged
  // so a stalled/zombie run is never mistaken for a healthy one at a glance.
  const liveBadge = m => {
    if (m.status !== 'running') return '';
    if (m.procAlive === false) return '<span class="pill err">process gone</span>';
    if (m.stalled) return `<span class="pill err">stalled ${Math.round((m.idleMs || 0) / 1000)}s</span>`;
    return '<span class="pill live">◉ live</span>';
  };
  el.innerHTML = rows.map(m => `
    <div class="row clickable runrow" data-id="${esc(m.id)}">
      <div class="flex" style="justify-content:space-between">
        <span><span class="pill ${pill(m.status)}">${esc(m.status)}</span>${liveBadge(m)}
          <span class="muted" style="font-size:11.5px">${new Date(m.startedAt || m.queuedAt || 0).toLocaleString()}</span></span>
        <span class="muted" style="font-size:11.5px">${m.engine === 'hermes' ? '⬡ hermes · ' : ''}${m.model ? esc(m.model) + (m.routedReason ? ' (auto)' : '') + ' · ' : ''}${m.durationMs ? (m.durationMs / 1000).toFixed(1) + 's' : ''}${m.costUsd != null ? ' · $' + m.costUsd.toFixed(4) : (m.tokensOut != null ? ' · ' + (m.tokensIn || 0) + '→' + m.tokensOut + ' tok' : '')}${m.resumedFrom ? ' · ⟲ resumed' : ''}${m.artifactCount ? ' · ◫ ' + m.artifactCount : ''}
          <button class="danger delRunBtn" data-id="${esc(m.id)}" title="delete this run from history" aria-label="Delete this run from history" style="padding:2px 9px;font-size:10.5px;margin-left:8px">✕</button></span>
      </div>
      <div class="pex">${esc(m.promptExcerpt || '')}</div>
      ${m.errorExcerpt ? `<div class="pex" style="color:#f0908f;white-space:normal">↳ ${esc(m.errorExcerpt)}</div>` : ''}
    </div>`).join('');
  el.querySelectorAll('.runrow').forEach(r => r.onclick = () => openRun(r.dataset.id));
  el.querySelectorAll('.delRunBtn').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this run (transcript + artifacts) from history?')) return;
    try {
      const r = await api('/api/run/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) });
      if (r.error) addMsg(r.error, 'errmsg');
    } catch {}
    refreshHistory();
  });
}

