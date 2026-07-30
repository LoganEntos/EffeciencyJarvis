/* Live tab: the hub's "what is actually running right now" board, plus a raw
   Claude Code transcript tail. Two distinct data sources, kept separate on
   purpose:
   1. Active tasks — every run the hub's OWN engine knows about (status
      running/queued in /api/runs), with real per-run liveness (procAlive/
      stalled/idleMs from the server heartbeat, lib/liveness.js annotate()).
      This is the piece that was MISSING: the old Live tab only ever showed
      one hand-picked session's raw text, so a second concurrent run (the hub
      allows 2, MAX_ACTIVE) or an autopilot/schedule dispatch was invisible.
   2. Session feed — tails the newest ~/.claude/projects transcript (ANY
      Claude Code run, hub-launched or a terminal `claude` in this project).
      Kept because it's the only way to see a terminal-launched session that
      never goes through the hub's run engine at all.
   Polls every 2s while visible; a header ● Live badge shows active/idle from
   every tab and taps through to here.
   Globals used: api / $ / esc / rel / fmtEvent / goTab / runStatusPill /
   runLiveBadge / runBadges / openRun (run.js). */
'use strict';

let liveSid = '';          // '' = follow the newest / active session
let liveTimer = null;
let liveLastSig = '';
let liveActiveSig = '';
const LIVE_ACTIVE_MS = 60000; // transcript touched within this window → "live"
const LIVE_SEL = 'background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:3px;padding:5px 8px;font-size:12px;cursor:pointer;max-width:100%';

function sessionActive(modified) {
  return !!modified && (Date.now() - new Date(modified).getTime() < LIVE_ACTIVE_MS);
}

// ---- 1. active tasks board: every run the hub engine is tracking right now ----
async function tickActiveTasks(force) {
  const el = $('#liveActive');
  if (!el) return;
  let rows;
  try { rows = await api('/api/runs'); } catch { return; }
  if (!Array.isArray(rows)) return;
  const active = rows.filter(m => m.status === 'running' || m.status === 'queued');
  const sig = active.map(m => `${m.id}|${m.status}|${m.stalled}|${m.procAlive}|${m.idleMs}`).join(',');
  if (!force && sig === liveActiveSig) return;
  liveActiveSig = sig;
  if (!active.length) {
    el.innerHTML = '<div class="muted">Nothing running right now — the hub is idle.</div>';
    return;
  }
  el.innerHTML = active.map(m => `
    <div class="row clickable runrow" data-id="${esc(m.id)}">
      <div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
        <span><span class="pill ${runStatusPill(m.status)}">${esc(m.status)}</span>${runLiveBadge(m)}${m.team ? `<span class="pill neutral" style="font-size:10px" title="agent team that ran this">⛬ ${esc(m.team)}</span>` : ''}${runBadges(m)}</span>
        <span class="muted" style="font-size:11.5px">${m.engine === 'hermes' ? '⬡ hermes · ' : ''}${m.model ? esc(m.model) + (m.routedReason ? ' (auto)' : '') : ''}</span>
      </div>
      <div class="pex">${esc(m.promptExcerpt || '')}</div>
    </div>`).join('');
  // load('run') first and awaited: goTab() itself kicks off the Run tab's
  // render fire-and-forget, so calling openRun() right after goTab() could
  // race an as-yet-unbuilt #chatLog if Run was never opened this session.
  el.querySelectorAll('.runrow').forEach(r => r.onclick = async () => {
    await load('run'); goTab('run'); openRun(r.dataset.id);
  });
}

renderers.live = async function () {
  const el = $('#live');
  const d = await api('/api/sessions');
  const list = Array.isArray(d) ? d : (d.list || []);
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">Live <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— everything the hub is running right now</span></h2>
    </div>
    <h3 style="margin:14px 0 8px">Active tasks</h3>
    <div id="liveActive">Loading…</div>
    <h3 style="margin:22px 0 8px">Session feed <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— raw transcript tail, incl. terminal-launched sessions</span></h3>
    ${!list.length ? `<div class="note">No Claude Code session transcripts found yet for this project.
      Send a prompt in the <span class="mono">Run</span> tab, or launch <span class="mono">claude</span>
      in a terminal here — its activity streams in live.</div>` : `
    <div class="flex" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <span id="liveStatus"></span>
    </div>
    <div class="flex" style="gap:8px;align-items:center;margin:12px 0 10px;flex-wrap:wrap">
      <label class="muted" style="font-size:11.5px;display:flex;gap:6px;align-items:center;min-width:0">session
        <select id="liveSel" style="${LIVE_SEL}">
          <option value="">● Auto — newest / active</option>
          ${list.map(s => `<option value="${esc(s.id)}">${esc(s.id.slice(0, 8))}… · ${rel(s.modified)} · ${s.sizeKb}KB</option>`).join('')}
        </select></label>
      <span class="muted" id="liveMeta" style="font-size:11px"></span>
    </div>
    <pre id="liveFeed" class="livefeed">Loading…</pre>`}`;
  liveActiveSig = '';
  await tickActiveTasks(true);
  if (list.length) {
    const sel = $('#liveSel');
    sel.value = liveSid;
    sel.onchange = e => { liveSid = e.target.value; liveLastSig = ''; tickLive(true); };
    liveLastSig = '';
    await tickLive(true);
  }
  if (!liveTimer) liveTimer = setInterval(() => {
    const sec = $('#live');
    if (!sec || sec.classList.contains('hidden')) return; // only poll while viewing
    tickActiveTasks(false);
    if ($('#liveFeed')) tickLive(false);
  }, 2000);
};

// one refresh cycle: resolve the effective session, update status, tail events
async function tickLive(force) {
  const feed = $('#liveFeed');
  if (!feed) return;
  let sid = liveSid;
  let active = false;
  try {
    const d = await api('/api/sessions');
    const list = Array.isArray(d) ? d : (d.list || []);
    if (!list.length) return;
    if (!sid) sid = list[0].id;                       // auto → newest
    const meta = list.find(s => s.id === sid) || list[0];
    active = sessionActive(meta.modified);
    const st = $('#liveStatus');
    if (st) st.innerHTML = active ? '<span class="pill live">● live</span>' : '<span class="pill neutral">idle</span>';
    const lm = $('#liveMeta');
    if (lm) lm.textContent = `${sid.slice(0, 8)}… · updated ${rel(meta.modified)} · ${meta.sizeKb} KB`;
    setLiveBadge(active);                             // keep the header badge in sync
  } catch { return; }
  let events;
  try { events = await api(`/api/session-tail?id=${encodeURIComponent(sid)}&n=140`); }
  catch { return; }
  if (!Array.isArray(events)) return;
  const sig = events.length + '|' + active + '|' + (events.length ? events[events.length - 1].text : '');
  if (!force && sig === liveLastSig) return;          // nothing new — leave scroll alone
  liveLastSig = sig;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  const body = events.length ? events.map(fmtEvent).join('\n') : '(no conversation events in the transcript tail yet)';
  // a blinking block cursor while the session is live — reads as "still running"
  feed.innerHTML = body + (active ? '\n<span class="livecursor">▍</span>' : '');
  if (force || atBottom) feed.scrollTop = feed.scrollHeight; // follow the tail unless scrolled up
}

// ---- header ● Live badge (visible on every tab; the mobile glance affordance) ----
function setLiveBadge(active) {
  const b = $('#liveBadge');
  if (!b) return;
  b.className = 'badge' + (active ? ' liveon' : '');
  b.innerHTML = active ? '<span class="dot ok"></span>live' : '<span class="dot"></span>idle';
}
async function pollLiveBadge() {
  try {
    const d = await api('/api/sessions');
    const list = Array.isArray(d) ? d : (d.list || []);
    setLiveBadge(list.length && sessionActive(list[0].modified));
  } catch {}
}
(function initLiveBadge() {
  const b = $('#liveBadge');
  if (b) { b.style.cursor = 'pointer'; b.onclick = () => goTab('live'); }
  pollLiveBadge();
  setInterval(pollLiveBadge, 5000);
})();
