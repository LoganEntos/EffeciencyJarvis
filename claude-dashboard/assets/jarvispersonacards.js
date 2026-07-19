/* Jarvis tab — persona card manager: delete (2-step confirm), rename-id,
   drag-to-reorder, and the "+" ghost card that opens the soul editor in
   new-persona mode. Split out of jarvistab.js to keep both files under the
   500-line project cap. Renders into #jcards; jarvistab.js still owns the
   nameplate/accent/holding-grid refresh and the soul editor — this module
   only touches the card row and calls back into jarvistab via the
   `callbacks` object passed to render(). Distinct from assets/jarvispersona.js
   (the persona-finder survey + output-contract editor mounted inside the
   customize foldout) — different global (window.jarvisPersonaCards), zero
   overlap. Zero deps; esc() everything. */
'use strict';
(function () {
  // Small per-card UI state (which card is mid-rename/mid-delete-confirm,
  // which id is being dragged). Kept local — jarvistab's J stays the source
  // of truth for the actual persona list.
  const UI = { renamingId: null, confirmId: null, dragId: null, revertT: null };
  let last = { personas: [], active: null, cb: {} };

  const GLYPH = { jarvis: '◉', 'jarvis-wit': '⌁', dispatch: '⚑', sage: '❋', athena: '❋', vulcan: '⚒', hermes: '⌁' };
  const glyphFor = id => GLYPH[id] || '◉';
  const toneWords = t => (t || '').split(/[·,]/).map(s => s.trim()).filter(Boolean);

  function realCard(p, on) {
    const id = p.id;
    if (UI.confirmId === id) {
      return `<div class="jcard${on ? ' active' : ''} confirming" data-id="${esc(id)}" role="option" aria-selected="${on}" tabindex="0">
        <div class="jc-confirm">
          <div class="jc-confirm-t">delete &ldquo;${esc(p.name)}&rdquo;? removes the file.</div>
          <div class="jc-confirm-btns">
            <button class="jc-mini jc-mini-danger" type="button" data-act="del-yes">✕ delete</button>
            <button class="jc-mini" type="button" data-act="del-no">cancel</button>
          </div>
        </div>
      </div>`;
    }
    if (UI.renamingId === id) {
      return `<div class="jcard${on ? ' active' : ''} renaming" data-id="${esc(id)}" role="option" aria-selected="${on}" tabindex="0">
        <div class="jc-rename">
          <label class="jc-rename-l">rename id (filename)</label>
          <input class="jc-rename-in" value="${esc(id)}" maxlength="64" spellcheck="false" autocomplete="off">
          <div class="jc-confirm-btns">
            <button class="jc-mini" type="button" data-act="ren-ok">✓ save</button>
            <button class="jc-mini" type="button" data-act="ren-no">cancel</button>
          </div>
        </div>
      </div>`;
    }
    const tag = esc(p.tagline || '');
    const tone = toneWords(p.tone).join(' · ');
    return `<div class="jcard${on ? ' active' : ''}${UI.dragId === id ? ' dragging' : ''}" data-id="${esc(id)}"
        role="option" aria-selected="${on}" tabindex="0" draggable="true">
      <div class="jc-top">
        <span class="jc-name">${esc(p.name)}</span>
        <span class="jc-actions">
          <button class="jc-act" type="button" data-act="rename" title="Rename id" aria-label="Rename persona id">✎</button>
          <button class="jc-act jc-act-del" type="button" data-act="delete" title="Delete persona" aria-label="Delete persona">✕</button>
        </span>
        <span class="jc-mark">${on ? '◉' : glyphFor(id)}</span>
      </div>
      <div class="jc-tag">${tag}</div>
      <div class="jc-tone">${esc(tone)}</div>
      ${on ? '<div class="jp-pill live jc-conn">◉ has the conn</div>' : ''}
      <span class="jc-drag" title="Drag to reorder" aria-hidden="true">⠿</span>
    </div>`;
  }
  function offCard(on) {
    return `<div class="jcard${on ? ' active' : ''}" data-id="none" role="option" aria-selected="${on}" tabindex="0">
      <div class="jc-top"><span class="jc-name">Off</span><span class="jc-mark">${on ? '◉' : '○'}</span></div>
      <div class="jc-tag">plain Claude &mdash; no persona</div>
      <div class="jc-tone">neutral · unstyled</div>
      ${on ? '<div class="jp-pill live jc-conn">◉ has the conn</div>' : ''}
    </div>`;
  }
  function ghostCard() {
    return `<div class="jcard jcard-ghost" data-id="__new" role="option" tabindex="0" title="Add a new persona">
      <div class="jc-ghost-plus">＋</div>
      <div class="jc-ghost-t">new persona</div>
    </div>`;
  }

  function draw() {
    const el = $('#jcards'); if (!el) return;
    el.innerHTML = last.personas.map(p => realCard(p, p.id === last.active)).join('')
      + offCard(!last.active) + ghostCard();
    wire(el);
    if (UI.renamingId) {
      const inp = el.querySelector('.jc-rename-in');
      if (inp) { inp.focus(); inp.select(); }
    }
  }

  function armAutoRevert() {
    clearTimeout(UI.revertT);
    UI.revertT = setTimeout(() => { if (UI.confirmId) { UI.confirmId = null; draw(); } }, 5000);
  }

  async function commitDelete(id) {
    const r = await api('/api/personas/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    UI.confirmId = null;
    if (r.error) { last.cb.flash && last.cb.flash('✗ ' + r.error, true); draw(); return; }
    last.cb.flash && last.cb.flash('✓ deleted ' + id);
    if (last.cb.reload) await last.cb.reload(); else draw();
  }
  async function commitRename(id) {
    const el = $('#jcards'); const inp = el && el.querySelector('.jc-rename-in');
    const newId = ((inp && inp.value) || '').trim().toLowerCase();
    if (!newId || newId === id) { UI.renamingId = null; draw(); return; }
    const r = await api('/api/personas/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, newId }) });
    if (r.error) { last.cb.flash && last.cb.flash('✗ ' + r.error, true); return; } // stay in rename mode so they can fix it
    UI.renamingId = null;
    last.cb.flash && last.cb.flash('✓ renamed to ' + r.id);
    if (last.cb.reload) await last.cb.reload(); else draw();
  }
  async function reorderAndPersist(dragId, targetId, before) {
    const ids = last.personas.map(p => p.id).filter(x => x !== dragId);
    let idx = ids.indexOf(targetId);
    if (idx === -1) idx = ids.length; else if (!before) idx += 1;
    ids.splice(idx, 0, dragId);
    // optimistic local reorder so the drop feels immediate
    last.personas = ids.map(id => last.personas.find(p => p.id === id)).filter(Boolean);
    draw();
    const r = await api('/api/personas/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (r.error) { last.cb.flash && last.cb.flash('✗ ' + r.error, true); }
    if (last.cb.reload) await last.cb.reload();
  }

  function handleAct(act, id) {
    if (act === 'rename') { UI.renamingId = id; UI.confirmId = null; draw(); return; }
    if (act === 'ren-no') { UI.renamingId = null; draw(); return; }
    if (act === 'ren-ok') { commitRename(id); return; }
    if (act === 'delete') { UI.confirmId = id; UI.renamingId = null; draw(); armAutoRevert(); return; }
    if (act === 'del-no') { UI.confirmId = null; draw(); return; }
    if (act === 'del-yes') { commitDelete(id); return; }
  }

  function wire(el) {
    el.onclick = e => {
      const actBtn = e.target.closest('[data-act]');
      const card = e.target.closest('.jcard');
      if (!card) return;
      if (actBtn) { handleAct(actBtn.dataset.act, card.dataset.id); return; }
      if (card.classList.contains('jcard-ghost')) { last.cb.openNew && last.cb.openNew(); return; }
      if (card.classList.contains('renaming') || card.classList.contains('confirming')) return;
      last.cb.activate && last.cb.activate(card.dataset.id);
    };
    el.onkeydown = e => {
      const inp = e.target.closest('.jc-rename-in');
      if (inp) {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(inp.closest('.jcard').dataset.id); }
        else if (e.key === 'Escape') { UI.renamingId = null; draw(); }
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.jcard');
      if (!card || e.target.closest('[data-act]')) return;
      e.preventDefault();
      if (card.classList.contains('jcard-ghost')) { last.cb.openNew && last.cb.openNew(); return; }
      if (card.classList.contains('renaming') || card.classList.contains('confirming')) return;
      last.cb.activate && last.cb.activate(card.dataset.id);
    };
    let overEl = null;
    el.ondragstart = e => {
      const card = e.target.closest('.jcard[draggable="true"]');
      if (!card) return;
      UI.dragId = card.dataset.id;
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', UI.dragId); } catch {}
      card.classList.add('dragging');
    };
    el.ondragover = e => {
      if (!UI.dragId) return;
      const card = e.target.closest('.jcard[draggable="true"]');
      if (!card || card.dataset.id === UI.dragId) return;
      e.preventDefault();
      if (overEl && overEl !== card) overEl.classList.remove('dragover');
      card.classList.add('dragover'); overEl = card;
    };
    el.ondragleave = e => {
      const card = e.target.closest('.jcard[draggable="true"]');
      if (card && card === overEl) { card.classList.remove('dragover'); overEl = null; }
    };
    el.ondrop = e => {
      e.preventDefault();
      if (overEl) { overEl.classList.remove('dragover'); }
      const card = e.target.closest('.jcard[draggable="true"]');
      const dragId = UI.dragId; UI.dragId = null; overEl = null;
      if (!card || !dragId || card.dataset.id === dragId) return;
      const rect = card.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      reorderAndPersist(dragId, card.dataset.id, before);
    };
    el.ondragend = () => {
      if (overEl) { overEl.classList.remove('dragover'); overEl = null; }
      if (UI.dragId) { UI.dragId = null; draw(); }
    };
  }

  // Public entry: personas = list from GET /api/personas (already in saved
  // display order), activeId = current active id (or null/undefined = off),
  // callbacks = { activate(id), flash(msg, isErr), reload(), openNew() }.
  function render(personas, activeId, callbacks) {
    last = { personas: Array.isArray(personas) ? personas : [], active: activeId || null, cb: callbacks || {} };
    draw();
  }

  window.jarvisPersonaCards = { render };
})();
