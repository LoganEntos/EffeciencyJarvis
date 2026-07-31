/* Memory tab: engram-style semantic memory — SEMANTIC OVER VECTORS.
   Typed records (episodic/semantic/procedural) recalled by lexical + tag +
   recency + importance scoring. No embeddings, no vector DB, no per-run cost.
   Obsidian-style browser: list + tag cloud on the left, selected note with
   backlinks (other memories sharing a tag) on the right — same "notes +
   links" mental model as a PKM vault, built from the tags already stored. */
'use strict';

renderers.memory = async function () {
  ensureMemoryUI();
  await loadAllMem();
  await loadMemory();
};
renderers.memory.noSkeleton = true;

let memType = '';   // '' | episodic | semantic | procedural
let memQuery = '';
let memSel = null;  // selected memory id
let memItems = [];  // current filtered/search list (list pane)
let allMem = [];    // full unfiltered cache (tag cloud + backlinks)

function ensureMemoryUI() {
  if ($('#memList')) return;
  $('#memory').innerHTML = `
    <h2>Memory <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— engram-style semantic recall (no vectors, no per-run cost)</span></h2>
    <div class="note">Typed memory (episodic runs · semantic facts · procedural how-tos) recalled by keyword + tag + recency + importance.
      Run history is captured automatically. Click a tag to explore its linked notes — the memory vault, not just a list.</div>
    <div class="flex" style="margin-bottom:10px">
      <input class="search" id="memSearch" placeholder="Search memory… (semantic recall over everything the hub remembers)" style="flex:1;margin:0">
      <button id="memReindex" class="ghost">↻ Reindex runs</button>
    </div>
    <div class="flex" id="memChips" style="margin-bottom:10px"></div>
    <div id="memTagCloud" class="mem-tagcloud"></div>
    <details style="margin-bottom:16px"><summary class="muted" style="cursor:pointer;font-size:12px">＋ add a memory note</summary>
      <div style="margin-top:10px">
        <input class="search" id="mnTitle" placeholder="Title" style="margin-bottom:8px">
        <textarea id="mnText" placeholder="A fact, decision, or how-to worth remembering…" style="min-height:56px"></textarea>
        <div class="flex">
          <select id="mnType" style="margin:0">
            <option value="semantic">semantic (fact/decision)</option>
            <option value="procedural">procedural (how-to)</option>
            <option value="episodic">episodic (event)</option>
          </select>
          <button id="mnAdd">Save note</button>
        </div>
      </div>
    </details>
    <div class="mem-wrap">
      <div class="mem-list" id="memList"><div class="muted">Loading…</div></div>
      <div class="mem-detail" id="memDetail"><div class="muted">Select a memory on the left to view it, its tags and its backlinks.</div></div>
    </div>`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#memSearch').oninput = debounce(e => { memQuery = e.target.value.trim(); loadMemory(); }, 250);
  $('#memReindex').onclick = async () => {
    try { await api('/api/memory/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
    await loadAllMem(); loadMemory();
  };
  $('#mnAdd').onclick = async () => {
    const text = $('#mnText').value.trim(); if (!text) return;
    try { await api('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: $('#mnType').value, title: $('#mnTitle').value.trim(), text }) }); } catch {}
    $('#mnTitle').value = ''; $('#mnText').value = '';
    loadAllMem().then(loadMemory);
  };
}

const MEM_ICON = { episodic: '⏱', semantic: '◆', procedural: '⚙' };

function selectTag(tag) {
  $('#memSearch').value = tag;
  memQuery = tag;
  loadMemory();
}

function selectMem(id) {
  memSel = id;
  renderMemList();   // refresh .active state without refetching
  renderDetail();
}

// full unfiltered cache — backs the tag cloud and cross-note backlinks
async function loadAllMem() {
  // api() resolves an {error} object on HTTP 4xx/5xx instead of rejecting, so
  // a real server error must be raised explicitly or it silently degrades to
  // "no tags" — indistinguishable from a genuinely empty memory store.
  try { const data = await api('/api/memory'); if (data && data.error) throw new Error(data.error); allMem = Array.isArray(data.items) ? data.items : []; } catch { allMem = []; }
  renderTagCloud();
}

function renderTagCloud() {
  const el = $('#memTagCloud');
  if (!el) return;
  const freq = {};
  for (const m of allMem) for (const t of (m.tags || [])) freq[t] = (freq[t] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 24);
  if (!top.length) { el.innerHTML = ''; return; }
  const max = top[0][1];
  el.innerHTML = top.map(([t, n]) => {
    const w = 0.55 + 0.45 * (n / max); // 0.55–1.0 opacity scale, like an Obsidian tag pane
    return `<span class="tag-pill" data-tag="${esc(t)}" style="opacity:${w.toFixed(2)}">${esc(t)} <b>${n}</b></span>`;
  }).join('');
  el.querySelectorAll('[data-tag]').forEach(t => t.onclick = () => selectTag(t.dataset.tag));
}

function renderMemList() {
  const el = $('#memList');
  if (!el) return;
  if (!memItems.length) {
    el.innerHTML = `<div class="muted">${memQuery ? 'No memories match “' + esc(memQuery) + '”.' : 'No memories yet — run something or add a note. (Try ↻ Reindex runs to import existing run history.)'}</div>`;
    return;
  }
  el.innerHTML = memItems.map(m => `
    <div class="mem-item${m.id === memSel ? ' active' : ''}" data-id="${esc(m.id)}">
      <div class="flex" style="justify-content:space-between;gap:6px">
        <span class="name" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MEM_ICON[m.type] || '◇'} ${esc(m.title || '(untitled)')}</span>
        <span class="muted" style="font-size:10.5px;white-space:nowrap">${rel(m.createdAt)}</span>
      </div>
      <div class="muted mem-snippet">${esc((m.text || '').slice(0, 110))}</div>
    </div>`).join('');
  el.querySelectorAll('.mem-item').forEach(row => row.onclick = () => selectMem(row.dataset.id));
}

function renderDetail() {
  const el = $('#memDetail');
  if (!el) return;
  const m = memItems.find(x => x.id === memSel) || allMem.find(x => x.id === memSel);
  if (!m) { el.innerHTML = '<div class="muted">Select a memory on the left to view it, its tags and its backlinks.</div>'; return; }
  const tags = m.tags || [];
  const backlinks = tags.length
    ? allMem.filter(o => o.id !== m.id && (o.tags || []).some(t => tags.includes(t)))
      .map(o => ({ o, shared: (o.tags || []).filter(t => tags.includes(t)).length }))
      .sort((a, b) => b.shared - a.shared).slice(0, 6)
    : [];
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between;flex-wrap:wrap">
      <span class="name" style="font-size:15px">${MEM_ICON[m.type] || '◇'} ${esc(m.title || '(untitled)')}</span>
      <span class="muted" style="font-size:11px">${esc(m.type)}${m._score ? ' · score ' + m._score.toFixed(1) : ''} · ${rel(m.createdAt)}</span>
    </div>
    <div class="pex" style="white-space:pre-wrap;margin-top:10px">${esc(m.text || '')}</div>
    ${m.fields && (m.fields.model || m.fields.tokensOut != null) ? `<div class="muted" style="font-size:11px;margin-top:8px">model ${esc(m.fields.model || '—')}${m.fields.tokensOut != null ? ' · ' + fmtTok((m.fields.tokensIn || 0) + m.fields.tokensOut) + ' tok' : ''}${m.fields.artifactCount ? ' · ' + m.fields.artifactCount + ' artifact(s)' : ''}</div>` : ''}
    <div class="flex" style="margin-top:10px">
      ${tags.slice(0, 12).map(t => `<span class="pill neutral mem-tag" data-tag="${esc(t)}" style="cursor:pointer">${esc(t)}</span>`).join('')}
    </div>
    <div class="flex" style="margin-top:12px">
      ${m.sourceRunId ? `<button class="ghost" id="memOpenRun" style="padding:5px 12px;font-size:11px">view run</button>` : ''}
      <span class="spacer" style="flex:1"></span>
      <button class="danger" id="memDelBtn" style="padding:5px 12px;font-size:11px">✕ delete</button>
    </div>
    ${backlinks.length ? `
    <div class="mem-backlinks">
      <div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;margin:16px 0 8px">linked notes — shared tags</div>
      ${backlinks.map(({ o, shared }) => `
        <div class="mem-backlink" data-id="${esc(o.id)}">
          <span>${MEM_ICON[o.type] || '◇'} ${esc(o.title || '(untitled)')}</span>
          <span class="muted" style="font-size:10.5px">${shared} shared tag${shared > 1 ? 's' : ''}</span>
        </div>`).join('')}
    </div>` : ''}`;
  if (m.sourceRunId) $('#memOpenRun').onclick = () => { goTab('run'); ensureRunUI(); openRun(m.sourceRunId); };
  $('#memDelBtn').onclick = async () => {
    try { await api('/api/memory/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }) }); } catch {}
    memSel = null;
    await loadAllMem();
    loadMemory();
  };
  el.querySelectorAll('.mem-tag').forEach(t => t.onclick = () => selectTag(t.dataset.tag));
  el.querySelectorAll('.mem-backlink').forEach(b => b.onclick = () => selectMem(b.dataset.id));
}

async function loadMemory() {
  const el = $('#memList');
  if (!el) return;
  let data;
  try {
    if (memQuery) { memItems = await api(`/api/memory/search?q=${encodeURIComponent(memQuery)}&type=${memType}`); if (memItems && memItems.error) throw new Error(memItems.error); data = null; }
    else { data = await api(`/api/memory${memType ? '?type=' + memType : ''}`); if (data && data.error) throw new Error(data.error); memItems = data.items; }
  } catch { el.innerHTML = '<div class="muted">Memory unavailable.</div>'; return; }
  const st = data ? data.stats : null;
  const chip = (label, val) => `<span class="pill ${memType === val ? 'neutral' : ''}" data-t="${val}" style="cursor:pointer;${memType === val ? 'outline:2px solid var(--accent-dim)' : 'background:#ffffff08;color:var(--muted);border:1px solid var(--line)'}">${label}</span>`;
  $('#memChips').innerHTML =
    chip(st ? `all ${st.total}` : 'all', '') +
    chip(st ? `⏱ episodic ${st.byType.episodic}` : '⏱ episodic', 'episodic') +
    chip(st ? `◆ semantic ${st.byType.semantic}` : '◆ semantic', 'semantic') +
    chip(st ? `⚙ procedural ${st.byType.procedural}` : '⚙ procedural', 'procedural');
  $('#memChips').querySelectorAll('[data-t]').forEach(c => c.onclick = () => { memType = c.dataset.t; loadMemory(); });

  if (!Array.isArray(memItems)) memItems = [];
  if (!memItems.some(m => m.id === memSel)) memSel = memItems.length ? memItems[0].id : null;
  renderMemList();
  renderDetail();
}
