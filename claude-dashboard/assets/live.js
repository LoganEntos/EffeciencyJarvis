/* Live tab: watch the active Claude Code session stream in real time — mobile
   first. Tails the newest ~/.claude/projects transcript (ANY Claude Code run —
   hub-launched or a terminal `claude` in this project). Polls every 2s while
   visible; a header ● Live badge shows active/idle from every tab and taps
   through to here. Globals used: api / $ / esc / rel / fmtEvent / goTab. */
'use strict';

let liveSid = '';          // '' = follow the newest / active session
let liveTimer = null;
let liveLastSig = '';
const LIVE_ACTIVE_MS = 60000; // transcript touched within this window → "live"
const LIVE_SEL = 'background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:3px;padding:5px 8px;font-size:12px;cursor:pointer;max-width:100%';

function sessionActive(modified) {
  return !!modified && (Date.now() - new Date(modified).getTime() < LIVE_ACTIVE_MS);
}

renderers.live = async function () {
  const el = $('#live');
  const d = await api('/api/sessions');
  const list = Array.isArray(d) ? d : (d.list || []);
  if (!list.length) {
    el.innerHTML = `<h2>Live</h2>
      <div class="note">No Claude Code session transcripts found yet for this project.
      Send a prompt in the <span class="mono">Run</span> tab, or launch <span class="mono">claude</span>
      in a terminal here — its activity streams in live.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">Live <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— watch Claude Code run</span></h2>
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
    <pre id="liveFeed" class="livefeed">Loading…</pre>`;
  const sel = $('#liveSel');
  sel.value = liveSid;
  sel.onchange = e => { liveSid = e.target.value; liveLastSig = ''; tickLive(true); };
  liveLastSig = '';
  await tickLive(true);
  if (!liveTimer) liveTimer = setInterval(() => {
    const sec = $('#live');
    if (!sec || sec.classList.contains('hidden')) return; // only poll while viewing
    tickLive(false);
  }, 2000);
};

// one refresh cycle: resolve the effective session, update status, tail events
async function tickLive(force) {
  const feed = $('#liveFeed');
  if (!feed) return;
  let sid = liveSid;
  try {
    const d = await api('/api/sessions');
    const list = Array.isArray(d) ? d : (d.list || []);
    if (!list.length) return;
    if (!sid) sid = list[0].id;                       // auto → newest
    const meta = list.find(s => s.id === sid) || list[0];
    const active = sessionActive(meta.modified);
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
  const sig = events.length + '|' + (events.length ? events[events.length - 1].text : '');
  if (!force && sig === liveLastSig) return;          // nothing new — leave scroll alone
  liveLastSig = sig;
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  feed.innerHTML = events.length ? events.map(fmtEvent).join('\n') : '(no conversation events in the transcript tail yet)';
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
