/* Run tab: "other active threads" panel. The hub allows MAX_ACTIVE concurrent
   runs (autopilot/schedule dispatches count too), but the Run tab's chat is
   built around exactly one thread at a time (chat.sessionId/chat.runId in
   run.js). Before this, a second concurrent run/thread was invisible from the
   Run tab — you had to go dig in the Live tab. This mounts a compact strip
   directly above the composer that lists OTHER currently-active threads and
   lets you switch to one.

   Reuse, not duplication:
   - Data source: GET /api/runs — same endpoint live.js's tickActiveTasks()
     polls for the Live tab's active-tasks board. Row shape (pill/liveBadge/
     badges/pex), polling cadence (2s while visible) and the first-load-only
     error/retry gating are all lifted from that function.
   - Switching: clicking a row calls openRun(id) — the exact function history
     rows and the Live tab's board already use (it calls setSession()
     internally). No second switching mechanism.

   Split out of run.js (which sits at the 500-line cap) rather than growing
   it; loaded after run.js/run-composer.js — needs $/esc/api/chat/
   runStatusPill/runLiveBadge/runBadges/openRun as globals. run.js's
   renderers.run calls runThreads.tick(true) once so the panel updates the
   moment the Run tab opens, instead of waiting out the first interval tick. */
'use strict';

let threadPoll = null;   // shared interval, started once the strip is mounted
let threadSig = null;    // null = never successfully loaded yet (first-load error gating, mirrors live.js's liveActiveSig)

// Inserted once, directly above the composer — "near the composer, not
// buried" — so it's in view without hunting, but takes no space until it
// actually has another thread to show (starts .hidden, toggled per tick).
function ensureThreadStripMounted() {
  if ($('#threadStrip')) return true;
  const composer = document.querySelector('#run .composer');
  if (!composer) return false; // Run tab not built yet — nothing to anchor to
  const div = document.createElement('div');
  div.id = 'threadStrip';
  div.className = 'threadpanel hidden';
  composer.parentNode.insertBefore(div, composer);
  return true;
}

// One refresh cycle. `force` re-renders even if nothing changed (used on Run
// tab open so switching straight back shows fresh state, not a stale strip).
async function tickThreads(force) {
  if (!ensureThreadStripMounted()) return;
  // Lazy-start the shared poll the first time the strip exists — mirrors
  // live.js's `if (!liveTimer) liveTimer = setInterval(...)` pattern. Started
  // regardless of outcome below so a thread that finishes/starts while the
  // panel is empty (0 others right now) still gets picked up live.
  if (!threadPoll) threadPoll = setInterval(() => tickThreads(false), 2000);
  const runSec = $('#run');
  if (runSec && runSec.classList.contains('hidden')) return; // only poll while viewing the Run tab
  const el = $('#threadStrip');
  if (!el) return;
  let rows;
  try { rows = await api('/api/runs'); }
  catch {
    // Same first-load-only gating as live.js's tickActiveTasks: a later poll
    // tick failing is a transient blip that self-corrects next tick — only
    // surface an error if the panel has never successfully rendered.
    if (threadSig === null) {
      el.classList.remove('hidden');
      el.innerHTML = '<div class="note" style="margin:0;padding:8px 12px">Couldn\'t check for other active threads. <button class="ghost threadRetryBtn" style="margin-left:6px;padding:3px 9px;font-size:10.5px">Retry</button></div>';
      const b = el.querySelector('.threadRetryBtn'); if (b) b.onclick = () => tickThreads(true);
    }
    threadSig = null; // invalidate so a later success always re-renders, even into the '' empty sig
    return;
  }
  if (!Array.isArray(rows)) return;
  const mineId = chat.runId; // the run currently attached to THIS tab's view, if any — never list yourself as an "other" thread
  const others = rows.filter(m => (m.status === 'running' || m.status === 'queued') && m.id !== mineId);
  const sig = others.map(m => `${m.id}|${m.status}|${m.stalled}|${m.procAlive}|${m.idleMs}`).join(',');
  if (!force && sig === threadSig) return;
  threadSig = sig;
  if (!others.length) { el.classList.add('hidden'); el.innerHTML = ''; return; } // the common case — one thread, no clutter
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="threadpanel-head">
      <span class="muted mono" style="font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px">◈ other active thread${others.length === 1 ? '' : 's'}</span>
      <span class="pill neutral">${others.length}</span>
    </div>
    <div class="threadrows">${others.map(m => `
      <div class="row clickable runrow" data-id="${esc(m.id)}" title="Switch the Run tab to this thread">
        <div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span><span class="pill ${runStatusPill(m.status)}">${esc(m.status)}</span>${runLiveBadge(m)}${m.team ? `<span class="pill neutral" style="font-size:10px" title="agent team that ran this">⛬ ${esc(m.team)}</span>` : ''}${runBadges(m)}</span>
          <span class="muted" style="font-size:11px">${m.engine === 'hermes' ? '⬡ hermes · ' : ''}${m.model ? esc(m.model) : ''}</span>
        </div>
        <div class="pex">${esc(m.promptExcerpt || '')}</div>
      </div>`).join('')}</div>`;
  // Switching threads reuses openRun() verbatim — the exact function history
  // rows and the Live tab's active-tasks board already call (setSession()
  // lives inside it). Not a second switching mechanism.
  el.querySelectorAll('.runrow').forEach(r => r.onclick = () => openRun(r.dataset.id));
}

window.runThreads = { tick: tickThreads };
