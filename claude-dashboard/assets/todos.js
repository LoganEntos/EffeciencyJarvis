/* Per-tab TODO tracker: the sequential number pill on each nav tab is the
   clickable target — click a tab's <kbd> to open a right-side drawer that
   renders the backing markdown as a structured, reorderable checklist.
   Storage stays plain markdown: "- [ ] task" lines, with an optional note as
   "  > note" lines directly under the task, so the raw Edit mode and the
   structured view round-trip losslessly. Open-todo count is surfaced as a
   superscript pip on the kbd (styled via [data-todos]).
   Reuses app.js's shared api() helper (token-aware) and esc() escaper. */
'use strict';

(function () {
  const NAV_SEL = '#mainNav a[data-tab]';
  let counts = {};
  let panelTab = null;
  let blocks = [];        // parsed model of the md (source of truth while open)
  let editing = false;
  let noteOpen = -1;      // block index with its note editor expanded
  let dragIdx = -1;

  // ---- badge + click wiring: the <kbd> hotkey pill IS the button. ----
  function wireKbds() {
    document.querySelectorAll(NAV_SEL).forEach(a => {
      const k = a.querySelector('kbd');
      if (!k || k.dataset.todosWired) return;
      const tab = a.getAttribute('data-tab');
      k.dataset.todosWired = '1';
      k.dataset.todos = '0';
      k.setAttribute('role', 'button');
      k.setAttribute('tabindex', '0');
      k.title = 'Open TODO list for ' + tab + ' (click)';
      k.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); openPanel(tab); });
      k.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openPanel(tab); }
      });
    });
  }

  function updateKbd(tab) {
    const a = document.querySelector(`#mainNav a[data-tab="${tab}"]`);
    const k = a && a.querySelector('kbd');
    if (k) k.dataset.todos = String(counts[tab] || 0);
  }

  async function refreshCounts() {
    let r;
    try { r = await api('/api/todos/counts'); } catch { return; }
    counts = (r && r.counts) || {};
    document.querySelectorAll(NAV_SEL).forEach(a => updateKbd(a.getAttribute('data-tab')));
  }

  // ---- md <-> block model. Block: {t:'task',checked,text,note} | {t:'h',level,text}
  // | {t:'p',text} | {t:'gap'}. Note lines ("  > x") attach to the task above. ----
  function parse(md) {
    const out = [];
    for (const line of md.split(/\r?\n/)) {
      const mCheck = line.match(/^\s*-\s\[( |x|X)\]\s?(.*)$/);
      const mNote = line.match(/^\s*>\s?(.*)$/);
      const mH = line.match(/^(#{1,3})\s+(.*)$/);
      const last = out[out.length - 1];
      if (mCheck) out.push({ t: 'task', checked: mCheck[1].toLowerCase() === 'x', text: mCheck[2], note: '' });
      else if (mNote && last && last.t === 'task') last.note += (last.note ? '\n' : '') + mNote[1];
      else if (mH) out.push({ t: 'h', level: mH[1].length, text: mH[2] });
      else if (line.trim()) out.push({ t: 'p', text: line });
      else if (last && last.t !== 'gap') out.push({ t: 'gap' });
    }
    return out;
  }

  function ser(bl) {
    return bl.map(b => {
      if (b.t === 'task') {
        let s = `- [${b.checked ? 'x' : ' '}] ${b.text}`;
        if (b.note) s += '\n' + b.note.split('\n').map(l => '  > ' + l).join('\n');
        return s;
      }
      if (b.t === 'h') return '#'.repeat(b.level) + ' ' + b.text;
      if (b.t === 'p') return b.text;
      return '';
    }).join('\n');
  }

  async function persist() {
    try {
      const r = await api('/api/todos/' + panelTab, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md: ser(blocks) })
      });
      counts[panelTab] = (r && r.count) || 0;
      updateKbd(panelTab);
    } catch {}
  }

  // ---- structured render: each task row = drag handle · checkbox · text ·
  // actions (note / up / down / delete), with an optional note area under it. ----
  function rowHtml(b, i) {
    const noteBtn = `<button class="todo-act" data-act="note" data-i="${i}" title="${b.note ? 'Edit note' : 'Add note'}" aria-label="Note">${b.note ? '✎' : '＋'}</button>`;
    const actions = `<span class="todo-acts">${noteBtn}<button class="todo-act" data-act="up" data-i="${i}" title="Move up" aria-label="Move up">▲</button><button class="todo-act" data-act="down" data-i="${i}" title="Move down" aria-label="Move down">▼</button><button class="todo-act todo-del" data-act="del" data-i="${i}" title="Delete" aria-label="Delete">✕</button></span>`;
    let note = '';
    if (noteOpen === i) {
      note = `<div class="todo-note"><textarea class="todo-note-area" data-i="${i}" placeholder="Note… (Ctrl+Enter to save)">${esc(b.note)}</textarea></div>`;
    } else if (b.note) {
      note = `<div class="todo-note todo-note-view" data-i="${i}" title="Click to edit note">${esc(b.note).replace(/\n/g, '<br>')}</div>`;
    }
    return `<div class="todo-row${b.checked ? ' checked' : ''}" draggable="true" data-i="${i}">
      <span class="todo-grip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
      <label class="todo-item"><input type="checkbox" data-i="${i}"${b.checked ? ' checked' : ''}><span>${esc(b.text)}</span></label>
      ${actions}</div>${note}`;
  }

  function checklistHtml() {
    let html = '';
    let any = false;
    blocks.forEach((b, i) => {
      if (b.t === 'task') { any = true; html += rowHtml(b, i); }
      else if (b.t === 'h') { any = true; html += `<h${b.level + 2} class="todo-h">${esc(b.text)}</h${b.level + 2}>`; }
      else if (b.t === 'p') { any = true; html += `<p class="todo-p">${esc(b.text)}</p>`; }
    });
    if (!any) html = '<p class="muted">No TODOs yet — add one below, or Edit for raw markdown.</p>';
    return html + `<div class="todo-add"><input type="text" class="todo-add-input" placeholder="＋ Add a to-do… (Enter)"></div>`;
  }

  function panelEl() {
    let el = document.getElementById('todoPanel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'todoPanel';
    el.className = 'todo-panel';
    el.innerHTML = `<div class="todo-panel-backdrop"></div>
      <div class="todo-panel-body" role="dialog" aria-label="Tab TODOs">
        <div class="todo-panel-head">
          <span class="todo-panel-title"></span>
          <div class="todo-panel-actions">
            <button class="ghost todo-edit-btn" type="button">Edit</button>
            <button class="ghost todo-close-btn" type="button" aria-label="Close">&#10005;</button>
          </div>
        </div>
        <div class="todo-panel-content"></div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.todo-panel-backdrop').onclick = closePanel;
    el.querySelector('.todo-close-btn').onclick = closePanel;
    el.querySelector('.todo-edit-btn').onclick = () => { editing = !editing; renderView(); };
    return el;
  }

  function taskIdxs() { return blocks.map((b, i) => b.t === 'task' ? i : -1).filter(i => i >= 0); }

  // Move the task at block index i one step among tasks (dir = ±1).
  function moveTask(i, dir) {
    const order = taskIdxs();
    const pos = order.indexOf(i);
    const tgt = order[pos + dir];
    if (tgt === undefined) return;
    const [b] = blocks.splice(i, 1);
    // after removing i, inserting at tgt lands after the neighbor when moving
    // down (its index shifted to tgt-1) and before it when moving up
    blocks.splice(tgt, 0, b);
    noteOpen = -1;
    persist(); renderView();
  }

  // Drop task from block index `from` to sit before/after task at `to`.
  function dropTask(from, to) {
    if (from === to || blocks[from]?.t !== 'task' || blocks[to]?.t !== 'task') return;
    const [b] = blocks.splice(from, 1);
    blocks.splice(to, 0, b); // same shifted-index reasoning as moveTask

    noteOpen = -1;
    persist(); renderView();
  }

  function saveNote(i, val) {
    if (blocks[i]?.t !== 'task') return;
    blocks[i].note = val.trim();
    noteOpen = -1;
    persist(); renderView();
  }

  function wireChecklist(content) {
    content.querySelectorAll('input[type=checkbox][data-i]').forEach(cb => {
      cb.onchange = () => {
        const b = blocks[+cb.dataset.i];
        if (b) { b.checked = !b.checked; persist(); renderView(); }
      };
    });
    content.querySelectorAll('.todo-act').forEach(btn => {
      btn.onclick = e => {
        e.preventDefault();
        const i = +btn.dataset.i, act = btn.dataset.act;
        if (act === 'note') { noteOpen = noteOpen === i ? -1 : i; renderView(); }
        else if (act === 'up') moveTask(i, -1);
        else if (act === 'down') moveTask(i, 1);
        else if (act === 'del' && confirm('Delete this to-do?' + (blocks[i]?.note ? ' (its note goes too)' : ''))) {
          blocks.splice(i, 1); noteOpen = -1; persist(); renderView();
        }
      };
    });
    content.querySelectorAll('.todo-note-view').forEach(nv => {
      nv.onclick = () => { noteOpen = +nv.dataset.i; renderView(); };
    });
    const ta = content.querySelector('.todo-note-area');
    if (ta) {
      ta.focus(); ta.selectionStart = ta.value.length;
      ta.onblur = () => saveNote(+ta.dataset.i, ta.value);
      ta.onkeydown = e => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); ta.blur(); }
        if (e.key === 'Escape') { e.stopPropagation(); noteOpen = -1; renderView(); }
      };
    }
    const add = content.querySelector('.todo-add-input');
    if (add) add.onkeydown = e => {
      if (e.key !== 'Enter') return;
      const text = add.value.trim();
      if (!text) return;
      if (blocks.length && blocks[blocks.length - 1].t !== 'gap') blocks.push({ t: 'gap' });
      blocks.push({ t: 'task', checked: false, text, note: '' });
      add.value = '';
      persist(); renderView();
      const again = panelEl().querySelector('.todo-add-input');
      if (again) again.focus();
    };
    // drag reorder — rows are draggable; drops land on the row under the cursor
    content.querySelectorAll('.todo-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragIdx = +row.dataset.i;
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => { row.classList.remove('dragging'); markOver(null); });
      row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; markOver(row); });
      row.addEventListener('drop', e => {
        e.preventDefault(); markOver(null);
        if (dragIdx >= 0) dropTask(dragIdx, +row.dataset.i);
        dragIdx = -1;
      });
    });
  }

  function markOver(row) {
    panelEl().querySelectorAll('.todo-row.dropmark').forEach(r => r.classList.remove('dropmark'));
    if (row && +row.dataset.i !== dragIdx) row.classList.add('dropmark');
  }

  function renderView() {
    const content = panelEl().querySelector('.todo-panel-content');
    const editBtn = panelEl().querySelector('.todo-edit-btn');
    editBtn.textContent = editing ? 'View' : 'Edit';
    if (editing) {
      content.innerHTML = `<textarea class="todo-edit-area" spellcheck="false">${esc(ser(blocks))}</textarea>
        <div class="todo-edit-actions">
          <button class="todo-save-btn" type="button">Save</button>
          <button class="ghost todo-cancel-btn" type="button">Cancel</button>
        </div>`;
      content.querySelector('.todo-save-btn').onclick = () => {
        blocks = parse(content.querySelector('.todo-edit-area').value);
        editing = false; persist(); renderView();
      };
      content.querySelector('.todo-cancel-btn').onclick = () => { editing = false; renderView(); };
      content.querySelector('.todo-edit-area').focus();
    } else {
      content.innerHTML = checklistHtml();
      wireChecklist(content);
    }
  }

  function onKeydown(e) { if (e.key === 'Escape') closePanel(); }

  async function openPanel(tab) {
    panelTab = tab;
    editing = false; noteOpen = -1; dragIdx = -1;
    const el = panelEl();
    el.querySelector('.todo-panel-title').textContent = tab.charAt(0).toUpperCase() + tab.slice(1) + ' — TODOs';
    el.classList.add('open');
    document.addEventListener('keydown', onKeydown);
    el.querySelector('.todo-panel-content').innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = await api('/api/todos/' + tab);
      blocks = parse((r && r.md) || '');
      counts[tab] = (r && r.count) || 0;
      updateKbd(tab);
    } catch { blocks = []; }
    renderView();
  }

  function closePanel() {
    const el = document.getElementById('todoPanel');
    if (el) el.classList.remove('open');
    document.removeEventListener('keydown', onKeydown);
    panelTab = null;
  }

  function boot() { wireKbds(); refreshCounts(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
