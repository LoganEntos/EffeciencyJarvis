/* Delegations section (Jarvis-orchestrator Phase 0, gap E): renders the
   subagent dispatches ("Agent" tool_use calls) a run made, as one aggregated
   block above the transcript — GET /api/delegations?runId=<id>. Loaded after
   runrender.js/run.js/run-composer.js/runhistory.js (needs addEl/esc/api/
   excerpt globals). Inserted inline in #chatLog so its lifecycle rides the
   existing transcript: newChat()'s innerHTML wipe clears it for free, no
   separate container/state to leak across a long session.

   Placement judgment call: inline in the transcript (not a separate panel
   under the run header) — it's per-run data exactly like artifacts/tool
   blocks already rendered there, so it survives reload the same way they do
   (openRun() re-fetches and re-renders fresh every time the run is reopened,
   rather than depending on any client-only cache). */
'use strict';

function fmtDelegWhen(iso) {
  if (!iso) return '';
  let d; try { d = new Date(iso); } catch { return ''; }
  if (isNaN(d)) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const DELEG_OUTCOME_PILL = { done: 'ok', unresolved: 'warn', error: 'err' };

function delegRowHtml(it) {
  const pillCls = DELEG_OUTCOME_PILL[it.outcome] || 'neutral';
  const agentType = it.agentType || 'agent';
  const desc = it.description || '(no description)';
  const prompt = it.promptExcerpt || '';
  const result = it.resultExcerpt || '';
  const n = it.toolCalls || 0;
  return `<div class="row clickable delegrow" data-id="${esc(it.id || '')}">
    <div class="flex" style="justify-content:space-between;gap:10px">
      <span><span class="pill ${pillCls}">${esc(agentType)}</span>
        <span class="name" style="font-size:12.5px">${esc(desc)}</span></span>
      <span class="muted mono" style="font-size:11px;white-space:nowrap">×${n} call${n === 1 ? '' : 's'} · ${esc(fmtDelegWhen(it.at))}</span>
    </div>
    ${prompt ? `<div class="delegpreview">${esc(excerpt(prompt, 140))}</div>` : ''}
    <div class="delegdetail">
      ${prompt ? `<div class="delegfield"><span class="muted">prompt</span><pre>${esc(excerpt(prompt, 4000))}</pre></div>` : ''}
      ${result ? `<div class="delegfield"><span class="muted">result</span><pre>${esc(excerpt(result, 4000))}</pre></div>` : ''}
      ${!prompt && !result ? '<div class="muted" style="padding:4px 0">No further detail recorded for this dispatch.</div>' : ''}
    </div>
  </div>`;
}

function wireDelegRows(body) {
  body.querySelectorAll('.delegrow').forEach(row => {
    row.onclick = () => row.classList.toggle('expanded');
  });
}

// ESC collapses any expanded delegation row — mirrors the Escape-closes
// pattern used by the overlay/todo-panel/voice modals elsewhere in the app.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.delegrow.expanded').forEach(r => r.classList.remove('expanded'));
});

// Insert the section into #chatLog (loading state first), then fill it in
// once the fetch resolves. Returns nothing — callers fire-and-forget.
async function renderDelegations(runId) {
  if (!runId) return;
  // Re-entrant: openRun() renders once on open, attachStream()'s 'done' handler
  // re-renders once the run finishes (fresh subagent data) — replace, don't stack.
  const log = $('#chatLog');
  if (log) log.querySelectorAll(`.delegsection[data-run="${CSS.escape(runId)}"]`).forEach(n => n.remove());
  const el = addEl(
    `<details class="delegwrap" open>
      <summary>🧩 Delegations <span class="muted delegcount">loading…</span></summary>
      <div class="delegbody"><div class="muted" style="padding:8px 2px">Loading delegations…</div></div>
    </details>`, 'delegsection');
  el.dataset.run = runId;
  const count = el.querySelector('.delegcount');
  const body = el.querySelector('.delegbody');
  let data;
  try {
    data = await api(`/api/delegations?runId=${encodeURIComponent(runId)}`);
    // api() only throws on network/timeout failure — a non-2xx HTTP response
    // (bad runId, server error) still resolves normally as {error}, so that
    // has to be checked explicitly or it silently renders as "empty" instead
    // of the error state.
    if (data && data.error) throw new Error(data.error);
  } catch (e) {
    console.error('delegations fetch failed', e); // clientlog.js taps console.error and beacons it
    count.textContent = 'error';
    count.className = 'pill err delegcount';
    body.innerHTML = `<div class="errhead">✗ Couldn't load delegations.</div>
      <button class="ghost delegRetryBtn" style="margin-top:6px">Retry</button>`;
    body.querySelector('.delegRetryBtn').onclick = () => { el.remove(); renderDelegations(runId); };
    return;
  }
  const items = (data && Array.isArray(data.items)) ? data.items : [];
  if (!items.length) {
    count.textContent = '0';
    count.className = 'pill neutral delegcount';
    body.innerHTML = '<div class="muted" style="padding:8px 2px">No subagents delegated.</div>';
    el.open = false;
    return;
  }
  count.textContent = String(items.length);
  count.className = 'pill neutral delegcount';
  body.innerHTML = items.map(delegRowHtml).join('');
  wireDelegRows(body);
}
