/* Memory tab: engram-style semantic memory — SEMANTIC OVER VECTORS.
   Typed records (episodic/semantic/procedural) recalled by lexical + tag +
   recency + importance scoring. No embeddings, no vector DB, no per-run cost. */
'use strict';

renderers.memory = async function () {
  ensureMemoryUI();
  await loadMemory();
};
renderers.memory.noSkeleton = true;

let memType = '';   // '' | episodic | semantic | procedural
let memQuery = '';

function ensureMemoryUI() {
  if ($('#memList')) return;
  $('#memory').innerHTML = `
    <h2>Memory <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— engram-style semantic recall (no vectors, no per-run cost)</span></h2>
    <div class="note">Typed memory (episodic runs · semantic facts · procedural how-tos) recalled by keyword + tag + recency + importance.
      Run history is captured automatically. Add your own notes below.</div>
    <div class="flex" style="margin-bottom:10px">
      <input class="search" id="memSearch" placeholder="Search memory… (semantic recall over everything the hub remembers)" style="flex:1;margin:0">
      <button id="memReindex" class="ghost">↻ Reindex runs</button>
    </div>
    <div class="flex" id="memChips" style="margin-bottom:14px"></div>
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
    <div id="memList"><div class="muted">Loading…</div></div>`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#memSearch').oninput = debounce(e => { memQuery = e.target.value.trim(); loadMemory(); }, 250);
  $('#memReindex').onclick = async () => { try { const r = await api('/api/memory/reindex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {} loadMemory(); };
  $('#mnAdd').onclick = async () => {
    const text = $('#mnText').value.trim(); if (!text) return;
    try { await api('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: $('#mnType').value, title: $('#mnTitle').value.trim(), text }) }); } catch {}
    $('#mnTitle').value = ''; $('#mnText').value = '';
    loadMemory();
  };
}

const MEM_ICON = { episodic: '⏱', semantic: '◆', procedural: '⚙' };

async function loadMemory() {
  const el = $('#memList');
  if (!el) return;
  let data, items;
  try {
    if (memQuery) { items = await api(`/api/memory/search?q=${encodeURIComponent(memQuery)}&type=${memType}`); data = null; }
    else { data = await api(`/api/memory${memType ? '?type=' + memType : ''}`); items = data.items; }
  } catch { el.innerHTML = '<div class="muted">Memory unavailable.</div>'; return; }
  // type filter chips (with counts from stats when browsing)
  const st = data ? data.stats : null;
  const chip = (label, val) => `<span class="pill ${memType === val ? 'neutral' : ''}" data-t="${val}" style="cursor:pointer;${memType === val ? 'outline:2px solid #8b6cff88' : 'background:#ffffff08;color:var(--muted);border:1px solid var(--line)'}">${label}${st ? '' : ''}</span>`;
  $('#memChips').innerHTML =
    chip(st ? `all ${st.total}` : 'all', '') +
    chip(st ? `⏱ episodic ${st.byType.episodic}` : '⏱ episodic', 'episodic') +
    chip(st ? `◆ semantic ${st.byType.semantic}` : '◆ semantic', 'semantic') +
    chip(st ? `⚙ procedural ${st.byType.procedural}` : '⚙ procedural', 'procedural');
  $('#memChips').querySelectorAll('[data-t]').forEach(c => c.onclick = () => { memType = c.dataset.t; loadMemory(); });

  if (!Array.isArray(items) || !items.length) {
    el.innerHTML = `<div class="muted">${memQuery ? 'No memories match “' + esc(memQuery) + '”.' : 'No memories yet — run something or add a note. (Try ↻ Reindex runs to import existing run history.)'}</div>`;
    return;
  }
  el.innerHTML = items.map(m => `
    <div class="row">
      <div class="flex" style="justify-content:space-between">
        <span class="name">${MEM_ICON[m.type] || '◇'} ${esc(m.title || '(untitled)')}</span>
        <span class="muted" style="font-size:11px">${esc(m.type)}${m._score ? ' · ' + m._score.toFixed(1) : ''} · ${rel(m.createdAt)}</span>
      </div>
      <div class="pex" style="white-space:normal">${esc(m.text || '')}</div>
      <div class="flex" style="margin-top:7px">
        ${(m.tags || []).slice(0, 8).map(t => `<span class="pill neutral" style="font-size:10px;padding:2px 8px">${esc(t)}</span>`).join('')}
        <span class="spacer" style="flex:1"></span>
        ${m.sourceRunId ? `<button class="ghost memOpen" data-run="${esc(m.sourceRunId)}" style="padding:4px 10px;font-size:10.5px">view run</button>` : ''}
        <button class="danger memDel" data-id="${esc(m.id)}" style="padding:4px 10px;font-size:10.5px">✕</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('.memOpen').forEach(b => b.onclick = () => { goTab('run'); ensureRunUI(); openRun(b.dataset.run); });
  el.querySelectorAll('.memDel').forEach(b => b.onclick = async () => {
    try { await api('/api/memory/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) }); } catch {}
    loadMemory();
  });
}
