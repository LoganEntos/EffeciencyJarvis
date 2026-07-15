/* Jarvis tab — the hub's face. A large state-driven orb (mirrors HubVoice:
   idle breath / listening ripples / thinking arc / speaking pulse / call halo),
   the active persona's name, one-tap persona switching, and a fold-out editor
   that writes personas/<id>.md through /api/personas/save.

   The orb is a stage for the SAME voice engine as the small header orb — tap
   to talk once (or hush a reply), hold for a hands-free call. Interactions
   delegate to assets/voice.js so there is exactly one voice code path.
   Animation only runs while this tab is visible; reduced-motion users get a
   static per-state frame instead of a loop. */
'use strict';
(function () {
  const J = { ctx: null, size: 300, dpr: 1, raf: null, watch: null,
    t0: performance.now(), lastState: '', personas: [], active: null };
  const cssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || fb).trim() || fb;
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const voiceState = () => (window.HubVoice && !HubVoice._disabled) ? HubVoice._state() : 'idle';
  const inCall = () => !!(window.HubVoice && !HubVoice._disabled && HubVoice._call());
  const visible = () => { const s = $('#jarvis'); return s && !s.classList.contains('hidden') && !document.hidden; };

  // ---- orb ------------------------------------------------------------------
  function draw() {
    const ctx = J.ctx; if (!ctx) return;
    const S = J.size, c = S / 2, t = (performance.now() - J.t0) / 1000;
    const st = voiceState(), call = inCall();
    const accent = cssVar('--accent', '#e8a33d'), listen = cssVar('--amber', '#e0a63f');
    ctx.clearRect(0, 0, S, S);
    let color = accent, pulse = 0;
    const core = S * 0.155;
    if (st === 'listening') { color = listen; pulse = S * 0.02 * (0.5 + 0.5 * Math.sin(t * 7)); }
    else if (st === 'thinking') { pulse = S * 0.014 * (0.5 + 0.5 * Math.sin(t * 4)); }
    else if (st === 'speaking') { pulse = S * 0.03 * Math.abs(Math.sin(t * 9)) + S * 0.012 * Math.abs(Math.sin(t * 23)); }
    else { pulse = S * 0.008 * Math.sin(t * 1.3); } // idle: slow breath
    // aura — the atmosphere behind the core
    const aura = ctx.createRadialGradient(c, c, core * 0.3, c, c, S * 0.48);
    aura.addColorStop(0, color + (st === 'idle' ? '2e' : '55'));
    aura.addColorStop(1, color + '00');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(c, c, S * 0.48, 0, 6.2832); ctx.fill();
    // listening: sonar ripples expanding from the core
    if (st === 'listening') {
      for (let k = 0; k < 2; k++) {
        const ph = (t * 0.55 + k * 0.5) % 1;
        ctx.beginPath(); ctx.arc(c, c, core + ph * S * 0.28, 0, 6.2832);
        ctx.strokeStyle = listen; ctx.globalAlpha = 0.45 * (1 - ph); ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // thinking: a single orbiting arc — deliberation, not alarm
    if (st === 'thinking') {
      const a = t * 2.2;
      ctx.beginPath(); ctx.arc(c, c, core + S * 0.055, a, a + 1.35);
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.8; ctx.lineWidth = 2.2;
      ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // core
    const g = ctx.createRadialGradient(c - core * 0.3, c - core * 0.35, core * 0.15, c, c, core + pulse);
    g.addColorStop(0, '#ffe9c4'); g.addColorStop(0.35, color); g.addColorStop(1, color);
    ctx.beginPath(); ctx.arc(c, c, core + pulse, 0, 6.2832);
    ctx.fillStyle = g; ctx.shadowColor = color; ctx.shadowBlur = st === 'idle' ? 14 : 30;
    ctx.fill(); ctx.shadowBlur = 0;
    // outer ring
    ctx.beginPath(); ctx.arc(c, c, core + pulse + S * 0.035, 0, 6.2832);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.globalAlpha = 1;
    // hands-free call: a slowly rotating dashed halo — "the line is open"
    if (call) {
      ctx.beginPath(); ctx.arc(c, c, S * 0.43, 0, 6.2832);
      ctx.strokeStyle = listen; ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 3);
      ctx.lineWidth = 1.6; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -t * 26; ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    updateStateLine(st, call);
  }
  function loop() {
    if (!visible()) { J.raf = null; return; }
    draw();
    if (reducedMotion()) { J.raf = null; return; } // static frame per state
    J.raf = requestAnimationFrame(loop);
  }
  // Watcher: (re)starts the loop when the tab becomes visible, and repaints on
  // state changes for reduced-motion users. 400ms poll only — never a 60fps
  // loop while the tab is hidden.
  function startWatch() {
    if (J.watch) return;
    J.watch = setInterval(() => {
      if (!visible()) return;
      const key = voiceState() + (inCall() ? '+call' : '');
      if (J.raf == null && (!reducedMotion() || key !== J.lastState)) { J.lastState = key; J.raf = requestAnimationFrame(loop); }
      else J.lastState = key;
    }, 400);
    document.addEventListener('visibilitychange', () => { if (visible() && J.raf == null) J.raf = requestAnimationFrame(loop); });
  }

  const STATE_LINE = {
    idle: 'tap to talk · hold for a call · V',
    listening: 'listening…',
    thinking: 'thinking…',
    speaking: 'speaking — tap to hush',
  };
  function updateStateLine(st, call) {
    const el = $('#jstate'); if (!el) return;
    const txt = call && st === 'idle' ? 'call open — waiting for you' : (STATE_LINE[st] || st);
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('on', st !== 'idle' || call);
  }

  // ---- personas --------------------------------------------------------------
  async function loadPersonas() {
    const d = await api('/api/personas');
    J.personas = d.personas || []; J.active = d.active;
    renderChips(); renderNameplate();
    const sel = $('#jpSel'); if (sel) fillEditorSelect(sel.value);
  }
  function renderNameplate() {
    const p = J.personas.find(x => x.id === J.active);
    $('#jname').textContent = p ? p.name : 'Plain Claude';
    $('#jtag').textContent = p ? (p.tagline + (p.tone ? ' — ' + p.tone : '')) : 'no persona active';
  }
  function renderChips() {
    const el = $('#jchips'); if (!el) return;
    const chip = (id, name, sub, on) =>
      `<button class="jchip${on ? ' active' : ''}" data-id="${esc(id)}">${esc(name)}<small>${esc(sub)}</small></button>`;
    el.innerHTML = J.personas.map(p => chip(p.id, p.name, p.tagline || p.tone, p.id === J.active)).join('')
      + chip('none', 'Off', 'plain Claude', !J.active);
    el.querySelectorAll('.jchip').forEach(b => b.onclick = () => switchPersona(b.dataset.id));
  }
  async function switchPersona(id) {
    const r = await api('/api/personas/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id === 'none' ? null : id }) });
    if (r.error) { flash('✗ ' + r.error, true); return; }
    J.active = r.active; renderChips(); renderNameplate();
    const p = J.personas.find(x => x.id === r.active);
    flash(r.active ? '✓ ' + (p ? p.name : r.active) + ' has the conn' + (r.handoff ? ' — handoff briefed' : '') : '✓ persona off — plain Claude');
    // audible confirmation on the voice surface (skipped mid-listen/call turn)
    try { if (p && window.HubVoice && !HubVoice._disabled && voiceState() === 'idle' && !inCall()) HubVoice.speak(p.name + ' here.'); } catch {}
  }
  function flash(msg, err) {
    const el = $('#jmsg'); if (!el) return;
    el.textContent = msg; el.style.color = err ? 'var(--red)' : 'var(--green)';
    clearTimeout(J.flashT); J.flashT = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  // ---- customize (soul editor) ----------------------------------------------
  function fillEditorSelect(keep) {
    const sel = $('#jpSel'); if (!sel) return;
    sel.innerHTML = J.personas.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.id)})</option>`).join('')
      + '<option value="__new">＋ new persona…</option>';
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  }
  async function loadEditor(id) {
    const isNew = id === '__new';
    $('#jpId').disabled = !isNew;
    if (isNew) {
      $('#jpId').value = ''; $('#jpName').value = ''; $('#jpTagline').value = ''; $('#jpTone').value = '';
      $('#jpBody').value = 'You are <Name>, one of the hub\'s communication personas. Hold this bearing on every reply:\n\n- ';
      $('#jpId').focus();
      return;
    }
    try {
      const p = await api('/api/personas/get?id=' + encodeURIComponent(id));
      if (p.error) { flash('✗ ' + p.error, true); return; }
      $('#jpId').value = p.id; $('#jpName').value = p.name;
      $('#jpTagline').value = p.tagline; $('#jpTone').value = p.tone; $('#jpBody').value = p.body;
    } catch (e) { flash('✗ ' + (e.message || 'load failed'), true); }
  }
  async function saveEditor() {
    const body = {
      id: ($('#jpId').value || '').trim().toLowerCase(),
      name: $('#jpName').value, tagline: $('#jpTagline').value,
      tone: $('#jpTone').value, body: $('#jpBody').value,
    };
    const r = await api('/api/personas/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.error) { flash('✗ ' + r.error, true); return; }
    flash('✓ saved ' + r.persona.name);
    await loadPersonas();
    fillEditorSelect(r.persona.id);
    $('#jpId').disabled = true;
  }

  // ---- render -----------------------------------------------------------------
  renderers.jarvis = async function () {
    const disabled = !window.HubVoice || HubVoice._disabled;
    $('#jarvis').innerHTML = `
      <h2>Jarvis <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— talk to the hub; switch or customize its persona</span></h2>
      <div class="jstage">
        <canvas id="jorb" role="button" tabindex="0" aria-label="Voice orb — tap to talk, hold for a hands-free call"></canvas>
        <div class="jname" id="jname">…</div>
        <div class="jtag" id="jtag"></div>
        <div class="jstate" id="jstate">${disabled ? 'voice module unavailable in this browser' : ''}</div>
      </div>
      <div class="jchips" id="jchips"></div>
      <div class="jcustom">
        <button id="jcustBtn" class="ghost" style="padding:7px 14px;font-size:12px">✎ Customize personas</button><span class="jmsg" id="jmsg"></span>
        <div id="jcustPanel" class="hidden">
          <div class="jfields">
            <div class="wide"><label for="jpSel">Persona</label><select id="jpSel"></select></div>
            <div><label for="jpId">id <span style="text-transform:none;letter-spacing:0">(filename — new only)</span></label><input id="jpId" placeholder="e.g. scout" disabled></div>
            <div><label for="jpName">Name</label><input id="jpName" placeholder="Display name"></div>
            <div><label for="jpTagline">Tagline</label><input id="jpTagline" placeholder="One-line character sketch"></div>
            <div><label for="jpTone">Tone</label><input id="jpTone" placeholder="e.g. composed · warm · candid"></div>
            <div class="wide"><label for="jpBody">Soul — the directive injected ahead of every run</label><textarea id="jpBody" spellcheck="false"></textarea></div>
          </div>
          <button id="jpSave" style="padding:8px 18px">Save persona</button>
          <span class="muted" style="font-size:11.5px;margin-left:10px">writes <span class="mono">personas/&lt;id&gt;.md</span> — switching injects it into every hub run</span>
        </div>
      </div>`;
    // orb canvas: sized to the viewport, DPR-aware, one draw context for life
    const cv = $('#jorb');
    J.size = Math.min(300, Math.floor(window.innerWidth * 0.7));
    J.dpr = window.devicePixelRatio || 1;
    cv.width = J.size * J.dpr; cv.height = J.size * J.dpr;
    cv.style.width = cv.style.height = J.size + 'px';
    J.ctx = cv.getContext('2d'); J.ctx.scale(J.dpr, J.dpr);
    // interactions mirror the header orb — tap delegates to its click handler
    // (one code path for one-shot / hush / hang-up), hold starts a call.
    let pressT = null, longPressed = false;
    cv.onpointerdown = e => {
      if (e.button && e.button !== 0) return;
      longPressed = false; clearTimeout(pressT);
      pressT = setTimeout(() => { longPressed = true; if (window.HubVoice && !inCall()) HubVoice.beginCall(); }, 400);
    };
    cv.onpointerup = cv.onpointercancel = () => clearTimeout(pressT);
    cv.onclick = e => {
      clearTimeout(pressT);
      if (longPressed) { longPressed = false; return; }
      const hdr = $('#voiceOrb');
      if (hdr && hdr.onclick) hdr.onclick(e);
    };
    cv.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cv.onclick(e); } };
    $('#jcustBtn').onclick = () => {
      const p = $('#jcustPanel');
      p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) { fillEditorSelect(); loadEditor($('#jpSel').value); }
    };
    $('#jpSel') && ($('#jpSel').onchange = e => loadEditor(e.target.value));
    $('#jpSave').onclick = saveEditor;
    await loadPersonas();
    draw(); startWatch();
    if (!reducedMotion()) { if (J.raf == null) J.raf = requestAnimationFrame(loop); }
  };
  renderers.jarvis.noSkeleton = true; // the stage renders instantly — no skeleton flash
})();
