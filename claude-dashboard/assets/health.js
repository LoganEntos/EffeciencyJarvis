/* Health tab — project transparency, live from disk. Everything an audit used
   to require an agent to go dig for (stray inbox files, drifted docs, files
   near the 500-line cap, active vs dormant skills, backlog state) is a standing
   surface here, and the inbox + docs sections are actionable in place. Data
   comes from GET /api/health (cached server-side); ↻ forces a re-scan. */
'use strict';

let healthData = null;
let healthProjects = [];

renderers.health = async function () {
  ensureHealthUI();
  await Promise.all([loadHealth(false), loadHealthProjects()]);
};
renderers.health.noSkeleton = true;

function ensureHealthUI() {
  if ($('#healthBody')) return;
  $('#health').innerHTML = `
    <div class="flex" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
      <div>
        <h2>Health <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— the whole project, visible from here</span></h2>
        <div class="note" style="margin:0">Read-only introspection of this repo: what's sitting in the inbox, which docs have drifted, what's near the 500-line cap, active vs dormant skills, and backlog state. Nothing here changes state except the inbox actions.</div>
      </div>
      <div class="flex" style="gap:8px;align-items:center">
        <span class="muted" id="healthStamp" style="font-size:11px"></span>
        <button id="healthRefresh" class="ghost">↻ Re-scan</button>
      </div>
    </div>
    <div id="healthTiles" class="hlth-tiles"></div>
    <div id="healthBody"><div class="muted" style="padding:24px 0">Scanning project…</div></div>`;
  $('#healthRefresh').onclick = () => loadHealth(true);
}

async function loadHealthProjects() {
  try { const d = await api('/api/projects'); healthProjects = Array.isArray(d.projects) ? d.projects : []; }
  catch { healthProjects = []; }
}

async function loadHealth(refresh) {
  const btn = $('#healthRefresh');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Scanning…'; }
  try {
    healthData = await api('/api/health' + (refresh ? '?refresh=1' : ''));
    // api() resolves an {error} object on HTTP 4xx/5xx instead of rejecting —
    // without this check a real scan failure renders every tile as a silent
    // zero instead of the "unavailable" state below.
    if (healthData && healthData.error) throw new Error(healthData.error);
  } catch { $('#healthBody').innerHTML = '<div class="muted">Health scan unavailable.</div>'; healthData = null; return; }
  finally { if (btn) { btn.disabled = false; btn.textContent = '↻ Re-scan'; } }
  renderHealth();
}

const fmtBytes = n => {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
};
const EXT_ICON = { pdf: '▤', csv: '▦', xlsx: '▦', md: '❡', txt: '❡', json: '{}', png: '▣', jpg: '▣', jpeg: '▣', docx: '▤' };

function tile(value, label, tone) {
  return `<div class="hlth-tile${tone ? ' ' + tone : ''}"><div class="hlth-num">${value}</div><div class="hlth-lbl">${label}</div></div>`;
}

function renderHealth() {
  const d = healthData;
  if (!d) return;
  $('#healthStamp').textContent = d.generatedAt ? 'scanned ' + rel(d.generatedAt) : '';
  const st = d.structure || {}, sk = d.skills || {}, bl = d.backlog || {}, docs = d.docs || {};
  const inboxN = (d.inbox || []).length;
  const staleN = (docs.items || []).filter(x => x.stale).length;
  const over = (st.files || []).filter(f => f.over).length;
  const warn = (st.files || []).filter(f => f.warn).length;
  $('#healthTiles').innerHTML =
    tile(inboxN, 'unassigned inbox files', inboxN ? 'warn' : 'ok') +
    tile(staleN, `docs stale (&gt;${docs.staleDays || 30}d)`, staleN ? 'warn' : '') +
    tile(over ? over : (warn || '0'), over ? 'files over 500 lines' : 'files nearing 500', over ? 'bad' : (warn ? 'warn' : 'ok')) +
    tile(`${sk.activeCount || 0}<span class="hlth-sub">/${sk.dormantCount || 0}</span>`, 'skills active / dormant', '') +
    tile(`${bl.open || 0}<span class="hlth-sub">/${bl.total || 0}</span>`, 'backlog open / total', bl.open ? 'warn' : 'ok');

  $('#healthBody').innerHTML =
    sectionInbox(d.inbox || []) +
    sectionStructure(st) +
    sectionDocs(docs) +
    sectionSkills(sk) +
    sectionBacklog(bl);
  wireInbox();
  wireDocs();
  wireSkills();
}

// ---------- 1. inbox transparency ----------
function sectionInbox(files) {
  const projOpts = healthProjects.map(p => `<option value="${esc(p.slug)}">${esc(p.name || p.slug)}</option>`).join('');
  const body = !files.length
    ? `<div class="hlth-empty">✓ Inbox root is clean — every file lives inside a project folder. Stray uploads would show here.</div>`
    : `<table class="hlth-table"><thead><tr><th>File</th><th>Size</th><th>Modified</th><th style="text-align:right">Actions</th></tr></thead><tbody>${
      files.map(f => `<tr data-name="${esc(f.name)}">
        <td><span class="hlth-ext">${EXT_ICON[f.ext] || '•'}</span> ${esc(f.name)}</td>
        <td class="mono">${fmtBytes(f.size)}</td>
        <td class="muted">${f.modified ? rel(f.modified) : '—'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${projOpts ? `<select class="hlth-moveto">${'<option value="">move to…</option>' + projOpts}</select>` : ''}
          <button class="danger hlth-del" style="padding:4px 10px;font-size:11px">✕</button>
        </td></tr>`).join('')}</tbody></table>`;
  return card('Unassigned inbox files', files.length ? `${files.length} flat file(s) in <code>data/inbox/</code> root — not inside any project` : 'live watch on <code>data/inbox/</code> root', body);
}
function wireInbox() {
  $('#health').querySelectorAll('.hlth-del').forEach(b => b.onclick = async e => {
    const name = e.target.closest('tr').dataset.name;
    if (!confirm(`Delete "${name}" from the inbox? This cannot be undone.`)) return;
    b.disabled = true;
    try { const r = await api('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (r && r.error) alert('Delete failed: ' + r.error); } catch { alert('Delete failed.'); }
    loadHealth(true);
  });
  $('#health').querySelectorAll('.hlth-moveto').forEach(sel => sel.onchange = async e => {
    const project = e.target.value; if (!project) return;
    const name = e.target.closest('tr').dataset.name;
    try { const r = await api('/api/files/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, project }) });
      if (r && r.error) { alert('Move failed: ' + r.error); e.target.value = ''; return; } } catch { alert('Move failed.'); e.target.value = ''; return; }
    loadHealth(true);
  });
}

// ---------- 2. doc health ----------
function sectionDocs(docs) {
  const items = docs.items || [];
  const body = `<div class="muted" style="font-size:11px;margin-bottom:8px">Staleness is a heuristic: flagged when a doc's mtime is &gt;${docs.staleDays || 30} days older than the newest app code (${docs.codeModified ? rel(docs.codeModified) : '—'}). It's a hint to review, not a verdict. Oldest first.</div>
    <table class="hlth-table"><thead><tr><th>Doc</th><th>Size</th><th>Modified</th></tr></thead><tbody>${
    items.map(x => `<tr class="hlth-doc${x.stale ? ' is-stale' : ''}" data-path="${esc(x.path)}">
      <td>${x.stale ? '<span class="hlth-flag" title="possibly stale">stale</span> ' : ''}<span class="hlth-link">${esc(x.path)}</span></td>
      <td class="mono">${fmtBytes(x.size)}</td>
      <td class="muted">${x.modified ? rel(x.modified) : '—'}</td></tr>`).join('')}</tbody></table>`;
  return card('Doc health', `${items.length} markdown doc(s) — click any to read; ${(items.filter(x => x.stale).length)} flagged possibly-stale`, body);
}
function wireDocs() {
  $('#health').querySelectorAll('.hlth-doc').forEach(row => row.onclick = () => showHealthDoc(row.dataset.path));
}

// ---------- 3. structure / size guard ----------
function sectionStructure(st) {
  const files = st.files || [];
  const bar = f => {
    const pct = Math.min(100, Math.round((f.lines / (st.capAt || 500)) * 100));
    const tone = f.over ? 'bad' : f.warn ? 'warn' : 'ok';
    return `<tr><td><span class="hlth-link mono" style="font-size:12px">${esc(f.path)}</span></td>
      <td style="width:46%"><div class="hlth-meter"><div class="hlth-meter-fill ${tone}" style="width:${pct}%"></div></div></td>
      <td class="mono" style="text-align:right">${f.lines}${f.over ? ' <span class="hlth-flag bad">OVER</span>' : f.warn ? ' <span class="hlth-flag">near</span>' : ''}</td></tr>`;
  };
  const orphans = st.orphans || [];
  const orphanBlk = orphans.length
    ? `<div class="note" style="margin-top:12px;border-color:var(--amber)"><b>Orphan check:</b> ${orphans.length} module(s) not wired in — ${orphans.map(o => `<code>${esc(o)}</code>`).join(', ')}. Confirm each is intentional (dead code) or wire/remove it.</div>`
    : `<div class="muted" style="margin-top:10px;font-size:11px">✓ Orphan check clean — every lib/*.js is require()d and every assets/*.js is script-tagged.</div>`;
  const body = `<div class="muted" style="font-size:11px;margin-bottom:8px">Live line counts for <code>server.js</code>, <code>lib/</code>, <code>assets/</code>, <code>index.html</code> — the manual grep the size guard used to need. Warn at ${st.warnAt || 450}, hard cap ${st.capAt || 500}.</div>
    <table class="hlth-table"><tbody>${files.map(bar).join('')}</tbody></table>${orphanBlk}`;
  return card('Structure / size guard', `${st.count || files.length} files · largest ${st.largest || 0} lines`, body);
}

// ---------- 4. skills transparency ----------
function sectionSkills(sk) {
  const chips = (arr, cls) => (arr || []).map(n => `<span class="pill ${cls}" style="cursor:default">${esc(n)}</span>`).join(' ');
  const body = `
    <div class="hlth-skillrow"><div class="hlth-skillhd">Active <span class="muted">(.claude/skills/ — loaded)</span> · ${sk.activeCount || 0}</div>
      <div class="flex" style="flex-wrap:wrap;gap:6px">${chips(sk.active, 'neutral') || '<span class="muted">none</span>'}</div></div>
    <details class="hlth-skillrow" style="margin-top:12px"><summary class="hlth-skillhd" style="cursor:pointer">Dormant <span class="muted">(.claude/skills-library/ — not auto-loaded)</span> · ${sk.dormantCount || 0} <span class="muted" style="font-weight:400">— click to expand</span></summary>
      <div class="flex" style="flex-wrap:wrap;gap:6px;margin-top:10px">${chips(sk.dormant, '') || '<span class="muted">none</span>'}</div></details>`;
  return card('Skills transparency', `${sk.activeCount || 0} loaded · ${sk.dormantCount || 0} dormant in the library`, body);
}
function wireSkills() { /* chips are display-only; nothing to wire */ }

// ---------- 5. backlog / audit status ----------
function sectionBacklog(bl) {
  const openList = (bl.openItems || []).slice(0, 20);
  const body = `
    <div class="flex" style="gap:20px;flex-wrap:wrap;margin-bottom:10px">
      <span><b style="font-size:18px;font-family:var(--font-serif,serif)">${bl.open || 0}</b> <span class="muted">open</span></span>
      <span><b style="font-size:18px;font-family:var(--font-serif,serif)">${bl.done || 0}</b> <span class="muted">closed</span></span>
      <span><b style="font-size:18px;font-family:var(--font-serif,serif)">${bl.total || 0}</b> <span class="muted">total</span></span>
      <span class="muted">most recent close: <b>${bl.lastClosed ? esc(bl.lastClosed) : '—'}</b></span>
    </div>
    ${openList.length ? `<table class="hlth-table"><thead><tr><th>ID</th><th>Location</th><th>Issue</th></tr></thead><tbody>${
      openList.map(i => `<tr><td class="mono">${esc(i.id)}</td><td class="mono muted">${esc(i.loc || '')}</td><td>${esc((i.issue || '').slice(0, 140))}</td></tr>`).join('')}</tbody></table>`
      : '<div class="hlth-empty">✓ Backlog is empty — no open improvement items.</div>'}
    <div class="muted" style="font-size:11px;margin-top:8px">Parsed from <code>docs/improvement-backlog.md</code> via autopilot's own parser.</div>`;
  return card('Backlog / audit status', `${bl.open || 0} open of ${bl.total || 0}`, body);
}

// ---------- shared: card wrapper + raw-doc modal ----------
function card(title, sub, body) {
  return `<div class="card hlth-card">
    <div class="hlth-cardhd"><span class="hlth-cardtitle">${title}</span><span class="muted" style="font-size:11px">${sub}</span></div>
    ${body}</div>`;
}

// Raw markdown viewer — same plain-<pre> pattern as the Agents/Skills/Commands
// library detail modal; fetches the guarded /api/health/doc reader.
async function showHealthDoc(relPath) {
  let ov = $('#hlthOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'hlthOverlay'; ov.className = 'hlth-overlay';
    ov.innerHTML = `<div class="hlth-modal"><div class="hlth-modalhd"><span class="mono" id="hlthDocPath"></span><button class="ghost" id="hlthDocClose">✕ close</button></div><pre class="hlth-pre" id="hlthDocPre"></pre></div>`;
    document.body.appendChild(ov);
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.querySelector('#hlthDocClose').onclick = () => ov.remove();
  }
  $('#hlthDocPath').textContent = relPath;
  $('#hlthDocPre').textContent = 'Loading…';
  try {
    const r = await api('/api/health/doc?path=' + encodeURIComponent(relPath));
    $('#hlthDocPre').textContent = r.error ? '(' + r.error + ')' : (r.text || '(empty)') + (r.truncated ? '\n\n… (truncated)' : '');
  } catch { $('#hlthDocPre').textContent = '(failed to load)'; }
}
