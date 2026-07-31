/* Jarvis persona-finder survey + guidelines (layer-1) editor. Split out of
   jarvistab.js to keep it under the 500-line cap. Two pieces, both mounted
   into the customize foldout:

   1. Guidelines editor — the shared output contract every persona obeys
      (plain language, no code dialect, concise, progress-forward). This is
      layer 1 of the two-layer prompt interface; the persona body is layer 2.
      Saves to personas/_guidelines.md via /api/personas/guidelines.

   2. Persona finder — a three-question survey that scores the built-in
      archetypes against how the user wants to be spoken to, then recommends
      and one-tap activates the closest persona. */
'use strict';
(function () {
  // Each answer casts weighted votes for persona ids. Custom personas the user
  // added aren't scored (we can't know their character) — the recommendation
  // falls back to whatever's available, but built-ins always win when present.
  const Q = [
    { k: 'How much personality do you want in the voice?', a: [
      { t: 'Straight and plain', v: { dispatch: 3, jarvis: 1 } },
      { t: 'Calm and warm', v: { jarvis: 3, sage: 1 } },
      { t: 'Full dry wit', v: { 'jarvis-wit': 3, jarvis: 1 } },
    ] },
    { k: 'How much should a normal reply say?', a: [
      { t: 'One line, just the result', v: { dispatch: 3, 'jarvis-wit': 1 } },
      { t: 'A few sentences', v: { jarvis: 3, 'jarvis-wit': 2 } },
      { t: 'Teach me the why', v: { sage: 4 } },
    ] },
    { k: 'When your idea is off, how blunt should Jarvis be?', a: [
      { t: 'Gentle nudge', v: { sage: 2, jarvis: 2 } },
      { t: 'Say it plainly', v: { jarvis: 2, dispatch: 1 } },
      { t: 'Just tell me, fast', v: { dispatch: 3, 'jarvis-wit': 1 } },
    ] },
  ];

  let personas = [], picks = [];

  const el = id => document.getElementById(id);

  // ---- guidelines (layer 1) --------------------------------------------------
  // Error state matches the app-wide pattern (assets/live.js, assets/graph.js):
  // an inline .note with a Retry button, not a silently blank textarea.
  function clearGuideErr() { const e = el('jgideErr'); if (e) e.remove(); }
  function showGuideErr() {
    const box = el('jgideBody'); if (!box || !box.parentElement || el('jgideErr')) return;
    const div = document.createElement('div');
    div.className = 'note'; div.id = 'jgideErr'; div.style.marginTop = '8px';
    div.innerHTML = `Couldn't load the output contract — the server may be busy or restarting. <button class="ghost" id="jgideRetry" style="margin-left:6px;padding:4px 10px;font-size:11px">Retry</button>`;
    box.insertAdjacentElement('afterend', div);
    const b = el('jgideRetry'); if (b) b.onclick = renderGuidelines;
  }
  async function renderGuidelines() {
    const box = el('jgideBody'); if (!box) return;
    clearGuideErr();
    try {
      const d = await api('/api/personas');
      box.value = d.guidelines || ''; box.disabled = false;
    } catch {
      box.value = ''; box.disabled = true;
      box.placeholder = "couldn't load the shared contract";
      showGuideErr();
    }
  }
  async function saveGuidelines() {
    const body = (el('jgideBody') && el('jgideBody').value || '').trim();
    if (!body) { setMsg('✗ guidelines cannot be empty', true); return; }
    try {
      const r = await api('/api/personas/guidelines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      setMsg(r.error ? '✗ ' + r.error : '✓ output contract saved — every persona now obeys it', !!r.error);
    } catch (e) { setMsg('✗ ' + (e.message || 'save failed'), true); }
  }

  // ---- survey ----------------------------------------------------------------
  function renderSurvey() {
    const wrap = el('jsurvey'); if (!wrap) return;
    picks = picks.length === Q.length ? picks : new Array(Q.length).fill(-1);
    wrap.innerHTML = Q.map((q, qi) => `
      <div class="jsq">
        <div class="jsq-k">${qi + 1}. ${esc(q.k)}</div>
        <div class="jsq-a">${q.a.map((a, ai) =>
          `<button class="jp-pill jsq-opt${picks[qi] === ai ? ' on' : ''}" data-q="${qi}" data-a="${ai}">${esc(a.t)}</button>`).join('')}</div>
      </div>`).join('') + `<div class="jsq-out" id="jsqOut"></div>`;
    wrap.querySelectorAll('.jsq-opt').forEach(b => b.onclick = () => {
      picks[+b.dataset.q] = +b.dataset.a; renderSurvey(); score();
    });
    if (picks.some(p => p >= 0)) score();
  }
  function score() {
    if (picks.some(p => p < 0)) { const o = el('jsqOut'); if (o) o.innerHTML = '<span class="muted">answer all three for a recommendation</span>'; return; }
    const tally = {};
    picks.forEach((ai, qi) => { const v = Q[qi].a[ai].v; for (const id in v) tally[id] = (tally[id] || 0) + v[id]; });
    // Only recommend personas that actually exist right now; if the top pick was
    // deleted, drop to the next available.
    const have = new Set(personas.map(p => p.id));
    const ranked = Object.keys(tally).filter(id => have.has(id)).sort((a, b) => tally[b] - tally[a]);
    const recId = ranked[0] || (personas[0] && personas[0].id);
    const rec = personas.find(p => p.id === recId);
    const out = el('jsqOut'); if (!out) return;
    if (!rec) { out.innerHTML = '<span class="muted">no personas available to recommend</span>'; return; }
    out.innerHTML = `<div class="jsq-rec">
      <div><span class="muted">best fit</span> <b>${esc(rec.name)}</b> — ${esc(rec.tagline || rec.tone || '')}</div>
      <button class="jp-btn" id="jsqGo">◉ give ${esc(rec.name)} the conn</button>
    </div>`;
    const go = el('jsqGo');
    if (go) go.onclick = async () => {
      try {
        const r = await api('/api/personas/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rec.id }) });
        if (r.error) { setMsg('✗ ' + r.error, true); return; }
        setMsg('✓ ' + rec.name + ' has the conn', false);
        if (window.jarvisTabRefresh) window.jarvisTabRefresh();
      } catch (e) { setMsg('✗ ' + (e.message || 'switch failed'), true); }
    };
  }

  function setMsg(m, err) {
    // reuse the customize flash line if present
    const f = el('jmsg'); if (!f) return;
    f.textContent = m; f.style.color = err ? 'var(--red)' : 'var(--green)';
    clearTimeout(setMsg._t); setMsg._t = setTimeout(() => { f.textContent = ''; }, 4000);
  }

  // Mounted by jarvistab when the customize foldout opens. Idempotent.
  window.jarvisPersona = {
    async mount(list) {
      personas = Array.isArray(list) ? list : [];
      if (!personas.length) { try { personas = (await api('/api/personas')).personas || []; } catch {} }
      renderGuidelines();
      renderSurvey();
      const sv = el('jgideSave'); if (sv) sv.onclick = saveGuidelines;
      const rs = el('jsqReset'); if (rs) rs.onclick = () => { picks = new Array(Q.length).fill(-1); renderSurvey(); };
    },
  };
})();
