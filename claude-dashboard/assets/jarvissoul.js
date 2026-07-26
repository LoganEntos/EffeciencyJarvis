/* Jarvis tab — persona "soul" editor: the layer-2 personality panel (id,
   name, tagline, tone, wake ack, and the Soul body — the directive injected
   ahead of every run, written to personas/<id>.md). Split out of
   jarvistab.js to keep both files under the repo's 500-line cap. The panel
   markup (#jpSel/#jpId/#jpName/#jpTagline/#jpTone/#jpAck/#jpBody/#jpSave)
   stays in jarvistab.js's template — this module only fills and saves it.
   Exposed as window.jarvisSoul = { openNewPersona, fillEditorSelect,
   loadEditor, saveEditor }, matching the plain-namespace-object convention
   of assets/jarvispersonacards.js and assets/jarvispersona.js: the persona
   list is passed in explicitly rather than reaching into jarvistab's
   private J state. Refreshing the whole tab after a save reuses
   window.jarvisTabRefresh (jarvistab.js's loadPersonas, already exposed for
   assets/jarvispersona.js's survey-activate flow) rather than a new hook. */
'use strict';
(function () {
  // Mirrors jarvistab.js's flash() line-for-line — assets/jarvispersona.js's
  // setMsg does the same for the same reason: #jmsg is shared, but its timer
  // handle can't live in jarvistab's private J state from over here.
  function flash(msg, err) {
    const el = $('#jmsg'); if (!el) return;
    el.textContent = msg; el.style.color = err ? 'var(--red)' : 'var(--green)';
    clearTimeout(flash._t); flash._t = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function fillEditorSelect(personas, keep) {
    const sel = $('#jpSel'); if (!sel) return;
    sel.innerHTML = (personas || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.id)})</option>`).join('')
      + '<option value="__new">＋ new persona…</option>';
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  }
  // The "+" ghost card (jarvispersonacards.js, via jarvistab's PERSONA_CB)
  // opens straight into new-persona mode instead of routing through the
  // "customize" dropdown.
  function openNewPersona(personas) {
    const p = $('#jcustPanel'); if (!p) return;
    p.classList.remove('hidden');
    fillEditorSelect(personas);
    const sel = $('#jpSel'); if (sel) sel.value = '__new';
    loadEditor('__new');
    if (window.jarvisPersona) window.jarvisPersona.mount(personas);
    p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function loadEditor(id) {
    const isNew = id === '__new';
    $('#jpId').disabled = !isNew;
    if (isNew) {
      $('#jpId').value = ''; $('#jpName').value = ''; $('#jpTagline').value = ''; $('#jpTone').value = ''; $('#jpAck').value = '';
      $('#jpBody').value = 'You are <Name>, one of the hub\'s communication personas. Hold this bearing on every reply:\n\n- ';
      $('#jpId').focus();
      return;
    }
    try {
      const p = await api('/api/personas/get?id=' + encodeURIComponent(id));
      if (p.error) { flash('✗ ' + p.error, true); return; }
      $('#jpId').value = p.id; $('#jpName').value = p.name;
      $('#jpTagline').value = p.tagline; $('#jpTone').value = p.tone; $('#jpAck').value = p.ack || ''; $('#jpBody').value = p.body;
    } catch (e) { flash('✗ ' + (e.message || 'load failed'), true); }
  }
  async function saveEditor() {
    const body = {
      id: ($('#jpId').value || '').trim().toLowerCase(),
      name: $('#jpName').value, tagline: $('#jpTagline').value,
      tone: $('#jpTone').value, ack: $('#jpAck').value, body: $('#jpBody').value,
    };
    const r = await api('/api/personas/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.error) { flash('✗ ' + r.error, true); return; }
    flash('✓ saved ' + r.persona.name);
    // jarvisTabRefresh (jarvistab.js's loadPersonas) resolves with the fresh
    // persona list so we can reselect the just-saved id below.
    const list = window.jarvisTabRefresh ? (await window.jarvisTabRefresh()) : [];
    fillEditorSelect(list, r.persona.id);
    $('#jpId').disabled = true;
  }

  window.jarvisSoul = { openNewPersona, fillEditorSelect, loadEditor, saveEditor };
})();
