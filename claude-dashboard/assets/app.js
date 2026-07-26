/* Hub SPA core: api/tab plumbing + Overview, Sessions, Library, Config.
   Run tab lives in run.js, Files tab in files.js, Graph tab in graph.js +
   agentviz.js. Scripts load in order (app → graph → run → files), then boot(). */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Compact token-count formatter shared by the header badge, run history,
// the usage gauge, and anywhere else a token total is shown (85 -> "85",
// 12400 -> "12.4k", 1250000 -> "1.3M"). No $ anywhere in this app — tokens
// + completion/routing percentages are the efficiency signal instead.
const fmtTok = n => {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
};
const HUB_TOKEN = (document.querySelector('meta[name="hub-token"]') || {}).content || '';
const renderers = {}; // tab -> async render fn; other scripts register into this

// fetch with a hard timeout + server-health tracking: a dead or restarted
// server flips the header badge to "unreachable" and auto-recovers.
// Non-GET requests automatically carry the CSRF token header.
async function api(p, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs || 15000);
  if (opts.method && opts.method !== 'GET') {
    opts.headers = Object.assign({ 'X-Hub-Token': HUB_TOKEN }, opts.headers || {});
  }
  try {
    const r = await fetch(p, { ...opts, signal: ctl.signal });
    // Read as text then parse, so a non-JSON body (e.g. a bare "not found" from
    // a route this build's server predates) surfaces as a clean {error} instead
    // of a cryptic "Unexpected token" JSON-parse throw in every caller.
    const raw = await r.text();
    let j;
    try { j = raw ? JSON.parse(raw) : {}; }
    catch { j = { error: r.ok ? raw : (raw || `HTTP ${r.status}`) }; }
    markServer(true);
    // A 403 "missing or bad X-Hub-Token" means THIS page's copy of the token is
    // stale — the hub rebooted (restart button, crash-recover, PWA tab left
    // open across a laptop sleep) and minted a new per-boot token that this
    // already-loaded JS never picked up. Every future mutating call would fail
    // the same way forever (this was the standing "phone stuck on X-Hub-Token
    // errors" bug — a backgrounded phone tab is exactly the case that never
    // gets a manual refresh). Reload once to fetch the fresh token; if the
    // reload doesn't fix it (server truly down) the 403 will simply recur and
    // we won't loop-reload because location.reload() tears down this context.
    if (r.status === 403 && /x-hub-token/i.test(j && j.error || '')) {
      location.reload();
      return new Promise(() => {}); // page is reloading — never resolve into stale code
    }
    return j;
  } catch (e) { markServer(false); throw e; }
  finally { clearTimeout(t); }
}
// Compact on phones — the 120px mobile max-width clips long strings, so the
// token count alone is what fits there. Dedicated /api/stats/today endpoint
// (small numbers, no artifact walk) — this polls every 60s always-on, so it
// must not pull the whole runs array.
async function updateSpendBadge() {
  const el = $('#spendBadge');
  if (!el) return;
  try {
    const s = await api('/api/stats/today');
    const tok = fmtTok(s.tokensTotal || 0) + ' tok';
    el.textContent = window.innerWidth <= 760 ? tok
      : `${s.runs || 0} runs · ${tok}` + (s.completionPct != null ? ` · ${s.completionPct}% done` : '');
  } catch {}
}
let serverOk = true, reconnectTimer = null;
function setAuthBadge(d) {
  $('#statusBadge').innerHTML = d.hasApiKey
    ? '<span class="dot ok"></span>server live · exec ready'
    : '<span class="dot ok"></span>server live · <span title="log in with the claude CLI or set ANTHROPIC_API_KEY for run execution">no auth</span>';
}
function markServer(ok) {
  if (ok === serverOk) return;
  serverOk = ok;
  if (ok) return; // badge text is restored by the reconnect poller below (it has fresh data)
  $('#statusBadge').innerHTML = '<span class="dot warn"></span>server unreachable — retrying…';
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    try {
      await fetch('/api/overview', { cache: 'no-store' });
      clearInterval(reconnectTimer); reconnectTimer = null;
      // A server that was unreachable came back — it may be a fresh boot with a
      // NEW per-boot X-Hub-Token (restart, crash-recover, laptop sleep/wake).
      // A soft refresh would keep firing the stale HUB_TOKEN const forever and
      // every POST would 403 "missing or bad X-Hub-Token" (the phone/Tailscale
      // bug: an open tab survives a hub restart with dead credentials). Hard
      // reload picks the new token up from the freshly-served index.html.
      location.reload();
    } catch {}
  }, 5000);
}

// ---- mobile nav toggle ----
function closeNav() {
  const nav = $('#mainNav');
  if (nav && nav.classList.contains('open')) {
    nav.classList.remove('open');
  }
}
$('#navToggle').onclick = () => {
  const nav = $('#mainNav');
  if (nav) nav.classList.toggle('open');
};
$('#navOverlay').onclick = () => closeNav();

// ---- tab switching (persisted, keyboard-driven) ----
let currentTab = 'run';
const TABS = [...document.querySelectorAll('nav a')].map(a => a.dataset.tab);
// Stagger index for the page-load reveal (U10): key each anchor to its own DOM
// order so the CSS delay survives nav edits instead of relying on nth-child.
document.querySelectorAll('nav a').forEach((a, i) => a.style.setProperty('--i', i + 1));
// Number-key → tab from the printed <kbd> hint, NOT DOM index: tabs without a
// hint (SharePoint, Commands…) would otherwise shift keys 5–0 off by one.
const KEY_TABS = {};
document.querySelectorAll('nav a').forEach(a => { const k = a.querySelector('kbd'); if (k && a.dataset.tab) KEY_TABS[k.textContent.trim()] = a.dataset.tab; });
function goTab(tab) {
  if (!renderers[tab]) return;
  currentTab = tab;
  closeNav(); // close mobile nav when switching tabs
  try { localStorage.setItem('hub.tab', tab); } catch {}
  document.querySelectorAll('nav a').forEach(x => {
    const on = x.dataset.tab === tab;
    x.classList.toggle('active', on);
    if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); // announce the current tab
  });
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  const sec = $('#' + tab);
  sec.classList.remove('hidden');
  sec.style.animation = 'none'; void sec.offsetHeight; sec.style.animation = ''; // retrigger entrance
  // a11y (backlog U7): pull focus into the revealed panel so keyboard/SR users
  // land on the new content instead of staying parked on the nav item. Name it
  // as a region so the switch is announced ("<Tab>, region"); preventScroll
  // keeps the layout from jumping on switch.
  const link = document.querySelector(`nav a[data-tab="${tab}"] .txt`);
  sec.setAttribute('role', 'region');
  sec.setAttribute('aria-label', link ? link.textContent.trim() : tab);
  sec.tabIndex = -1;
  requestAnimationFrame(() => sec.focus({ preventScroll: true }));
  load(tab);
}
// nav items are hrefless <a> that switch tabs, not navigate to a URL (backlog
// U8): role="button" — not "link" — so a screen reader announces "button" and
// Space-to-activate matches native button semantics (links don't fire on Space).
document.querySelectorAll('nav a').forEach(a => {
  a.tabIndex = 0;
  a.setAttribute('role', 'button');
  a.onclick = () => goTab(a.dataset.tab);
  a.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTab(a.dataset.tab); } };
});

// ---- a11y: keyboard-operable non-native clickables (backlog U1) ----
// Cards, chips, filter pills, tags and rows are plain <div>/<span> wired only
// with onclick — mouse-only: no tab stop, no focus ring, no Enter/Space. Rather
// than patch every render site (and re-break on the next new one), we centralise:
// a MutationObserver grants tabindex + role="button" to any clickable as it's
// rendered, and one delegated key handler activates it. The global :focus-visible
// ring (style.css) then shows keyboard focus for free. To cover a new clickable
// pattern anywhere, just add its selector here — nothing else to touch.
const CLICKABLE_SEL = '.row.clickable,.card.clickable,.iconCell,.tag-pill,.mem-item,.mem-backlink,.mem-tag,.ndnb,.pill[data-f],.pill[data-t],#liveBadge,.prun[data-id],.projTile[data-img],.projTile[data-doc],.pchat-hpill[data-id],.dropzone';
function upgradeClickables(root) {
  const els = root.matches && root.matches(CLICKABLE_SEL) ? [root] : [];
  root.querySelectorAll && els.push(...root.querySelectorAll(CLICKABLE_SEL));
  els.forEach(el => {
    if (el.dataset.a11y) return;
    el.dataset.a11y = '1';
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (el && el.matches && el.matches(CLICKABLE_SEL)) { e.preventDefault(); el.click(); }
});
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) upgradeClickables(n);
}).observe(document.body, { childList: true, subtree: true });
upgradeClickables(document.body); // catch the header #liveBadge + anything already in the DOM

const loaded = {};
async function load(tab, force) {
  if (loaded[tab] && !force) return;
  loaded[tab] = true;
  if ((force || !$('#' + tab).innerHTML.trim()) && !(renderers[tab] && renderers[tab].noSkeleton)) skeleton(tab);
  try { await renderers[tab](); }
  catch (e) {
    loaded[tab] = false; // failed render must not count as loaded — revisiting retries
    $('#' + tab).innerHTML = `<h2>${esc(tab)}</h2>
      <div class="note">Couldn't load this tab — ${esc(e.message || 'network error')}. The server may be busy or restarting.</div>
      <button class="retryBtn">Retry</button>`;
    $('#' + tab + ' .retryBtn').onclick = () => load(tab, true);
  }
}
function skeleton(tab) {
  $('#' + tab).innerHTML = `<h2>${tab}</h2>
    <div class="cards">${'<div class="skel" style="height:86px"></div>'.repeat(3)}</div>
    ${'<div class="skel" style="height:46px;margin-bottom:8px"></div>'.repeat(4)}`;
}
$('#refreshTab').onclick = () => load(currentTab, true);
// keyboard: 1-9 and 0 follow nav order, R refresh, / focus filter
document.addEventListener('keydown', e => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.ctrlKey || e.altKey || e.metaKey) return;
  if (/^[0-9]$/.test(e.key) && KEY_TABS[e.key]) { goTab(KEY_TABS[e.key]); }
  else if (e.key === 'r' || e.key === 'R') { load(currentTab, true); }
  else if (e.key === '/') { const s = $('#' + currentTab + ' input.search'); if (s) { e.preventDefault(); s.focus(); } }
});

// ---- core tab renderers ----
// friendly relative time for dashboards ("3h ago")
function rel(t) {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}


const KIND_COLOR = { user: 'var(--green)', assistant: 'var(--accent)', tool: 'var(--bronze)' };
function fmtEvent(e) {
  const t = e.time ? new Date(e.time).toLocaleTimeString() : '——:——:——';
  return `<span class="muted">${esc(t)}</span> <span style="color:${KIND_COLOR[e.kind] || 'var(--muted)'};font-weight:600">${esc((e.kind + '     ').slice(0, 9))}</span> ${esc(e.text)}`;
}

// ---- live activity feed (Overview tab) ----
let feedTimer = null;
async function refreshFeed() {
  const pre = $('#feed');
  if (!pre) return;
  let r;
  try { r = await api('/api/activity'); }
  catch { pre.textContent = '(server unreachable — feed will resume automatically)'; return; }
  const label = $('#feedSession');
  if (label) label.textContent = r.sessionId ? '— ' + r.sessionId : '';
  if (!r.sessionId) { pre.textContent = '(no session transcripts found)'; return; }
  if (!Array.isArray(r.events) || !r.events.length) { pre.textContent = '(no conversation events in transcript tail)'; return; }
  pre.innerHTML = r.events.map(fmtEvent).join('\n');
}
function startFeed() {
  refreshFeed();
  if (feedTimer) return; // overview() may re-render (load force) — never stack intervals
  feedTimer = setInterval(() => {
    if ($('#overview').classList.contains('hidden')) return; // another tab selected — skip
    refreshFeed();
  }, 10000);
}

// boot: header badges (independent of active tab), then restore last-viewed tab.
// Called from index.html after all tab scripts have registered their renderers.
function boot() {
  // opened as a raw file (file://) or by a server that didn't inject the token —
  // nothing can work without the hub server, so say so instead of half-rendering
  if (location.protocol === 'file:' || HUB_TOKEN === '__HUB_' + 'TOKEN__') {
    document.querySelector('main').innerHTML = `<section>
      <h2>Hub server required</h2>
      <div class="note">This page was opened directly (<span class="mono">${esc(location.protocol)}//</span>) —
        the hub only works when served by its server, which injects the security token and serves the API.<br><br>
        Start it:&nbsp;<span class="mono">node claude-dashboard\\server.js</span><br>
        Then open:&nbsp;<a class="link" href="http://127.0.0.1:5757">http://127.0.0.1:5757</a></div>
    </section>`;
    document.querySelector('#statusBadge').innerHTML = '<span class="dot warn"></span>not connected to the hub server';
    return;
  }
  api('/api/overview').then(d => {
    $('#projBadge').textContent = d.project;
    $('#nodeBadge').textContent = 'Node ' + d.nodeVersion;
    setAuthBadge(d);
  }).catch(() => {});
  updateSpendBadge();
  setInterval(updateSpendBadge, 60000); // header badge, not tab-scoped — the one thing mobile must always show while autopilot dispatches runs unattended
  // Theme toggle (◐): clean-dark (default) ↔ light, matching the button's
  // "dark / light" tooltip. The old warm terminal-amber set stays in style.css
  // as the bare :root fallback only — it looked identical enough to clean-dark
  // that toggling to it read as "button does nothing". Legacy stored values
  // ('warm', unset) fall through to dark.
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('hub.theme'); } catch {}
  document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
  const tt = $('#themeTab');
  if (tt) tt.onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('hub.theme', next); } catch {}
  };
  // Restart button (beside the theme toggle): tell the server to respawn, then
  // poll the same port until the fresh process answers and hard-reload — the
  // reload picks up the new per-boot X-Hub-Token the restarted server injects.
  const rb = $('#restartTab');
  if (rb) rb.onclick = async () => {
    if (!confirm('Restart the hub server? The page will reconnect in a few seconds.')) return;
    rb.disabled = true; const glyph = rb.textContent; rb.textContent = '…';
    markServer(false); // flips the badge to "restarting/unreachable" immediately
    try { await api('/api/restart', { method: 'POST', timeoutMs: 4000 }); } catch {}
    let n = 0;
    const poll = async () => {
      n++;
      try {
        const r = await fetch('/api/overview', { cache: 'no-store' });
        if (r.ok) { location.reload(); return; }
      } catch {}
      if (n < 40) setTimeout(poll, 500);
      else { rb.disabled = false; rb.textContent = glyph; } // gave up — let the reconnect poller carry on
    };
    setTimeout(poll, 1500);
  };
  let bootTab = 'run';
  try { const t = localStorage.getItem('hub.tab'); if (t && TABS.includes(t) && renderers[t]) bootTab = t; } catch {}
  try { const qt = new URLSearchParams(location.search).get('tab'); if (qt && TABS.includes(qt) && renderers[qt]) bootTab = qt; } catch {}
  goTab(bootTab);
}
