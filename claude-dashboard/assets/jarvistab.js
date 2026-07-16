/* Jarvis tab — the hub's operator console. A voice-first face laid out as a
   console: an eyebrow + serif nameplate header, a scroll-row of persona cards
   (one-tap switch, active card "has the conn"), then a two-pane deck — LIVE
   CONVERSATION on the left (the state-driven orb + voice controls + a live tail
   of the newest Claude Code transcript) and PROMPT WORKSPACE on the right (the
   Haiku distiller made visible: type a loose vibe-dump, shape it, refine it,
   then copy or fire it into the Run tab).

   The orb is the SAME voice engine as the small header orb — tap to talk once
   (or hush a reply), hold for a hands-free call. Interactions delegate to
   assets/voice.js so there is exactly one voice code path. Animation only runs
   while this tab is visible; reduced-motion users get a static per-state frame.
   Mobile-first: the header stacks, cards scroll horizontally, the deck goes
   single-column, and the orb scales to the viewport. All colors are theme vars. */
'use strict';
(function () {
  const J = { ctx: null, size: 300, dpr: 1, raf: null, watch: null, txTimer: null,
    txSig: '', t0: performance.now(), lastState: '', personas: [], active: null, shaped: '' };
  const cssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n) || fb).trim() || fb;
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const voiceState = () => (window.HubVoice && !HubVoice._disabled) ? HubVoice._state() : 'idle';
  const inCall = () => !!(window.HubVoice && !HubVoice._disabled && HubVoice._call());
  const visible = () => { const s = $('#jarvis'); return s && !s.classList.contains('hidden') && !document.hidden; };
  const toneWords = t => (t || '').split(/[·,]/).map(s => s.trim()).filter(Boolean);

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
    // a faint tick-ring for the console vibe — dashes around the aura edge
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = st === 'idle' ? 0.14 : 0.22; ctx.lineWidth = 1;
    ctx.setLineDash([1.5, 7]); ctx.beginPath(); ctx.arc(c, c, S * 0.44, 0, 6.2832); ctx.stroke();
    ctx.restore();
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
    idle: 'tap to talk · hold for a call',
    listening: 'listening…',
    thinking: 'thinking…',
    speaking: 'speaking — tap to hush',
  };
  const STATE_BADGE = { idle: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking' };
  function updateStateLine(st, call) {
    const el = $('#jstate');
    if (el) {
      const txt = call && st === 'idle' ? 'call open — waiting for you' : (STATE_LINE[st] || st);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('on', st !== 'idle' || call);
    }
    const b = $('#jconvState');
    if (b) {
      const on = st !== 'idle' || call;
      b.textContent = call && st === 'idle' ? 'on call' : (STATE_BADGE[st] || st);
      b.classList.toggle('on', on);
    }
    const cb = $('#jCallBtn');
    if (cb) { const on = inCall(); cb.classList.toggle('active', on); cb.querySelector('.jcb-t').textContent = on ? 'Hang up' : 'Open call'; }
  }

  // ---- personas --------------------------------------------------------------
  async function loadPersonas() {
    const d = await api('/api/personas');
    J.personas = d.personas || []; J.active = d.active;
    renderCards(); renderNameplate();
    const sel = $('#jpSel'); if (sel) fillEditorSelect(sel.value);
  }
  function renderNameplate() {
    const p = J.personas.find(x => x.id === J.active);
    const nm = $('#jname'); if (nm) nm.textContent = p ? p.name : 'Plain Claude';
    const tg = $('#jtag'); if (tg) tg.textContent = p ? p.tagline : 'no persona — plain Claude';
  }
  function card(p, on) {
    const tones = toneWords(p ? p.tone : '').slice(0, 3).map(w => `<span>${esc(w)}</span>`).join('');
    const name = p ? p.name : 'Off';
    const tag = p ? esc(p.tagline || '') : 'plain Claude — no persona';
    return `<button class="jcard${on ? ' active' : ''}" data-id="${esc(p ? p.id : 'none')}">
      <div class="jc-top"><span class="jc-name">${esc(name)}</span><span class="jc-mark">${on ? '◉' : '○'}</span></div>
      <div class="jc-tag">${tag}</div>
      <div class="jc-tone">${tones}</div>
      ${on ? '<span class="jc-conn">◈ has the conn</span>' : ''}
    </button>`;
  }
  function renderCards() {
    const el = $('#jcards'); if (!el) return;
    el.innerHTML = J.personas.map(p => card(p, p.id === J.active)).join('') + card(null, !J.active);
    el.querySelectorAll('.jcard').forEach(b => b.onclick = () => switchPersona(b.dataset.id));
  }
  async function switchPersona(id) {
    const r = await api('/api/personas/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id === 'none' ? null : id }) });
    if (r.error) { flash('✗ ' + r.error, true); return; }
    J.active = r.active; renderCards(); renderNameplate();
    const p = J.personas.find(x => x.id === r.active);
    flash(r.active ? '✓ ' + (p ? p.name : r.active) + ' has the conn' + (r.handoff ? ' — handoff briefed' : '') : '✓ persona off — plain Claude');
    try { if (p && window.HubVoice && !HubVoice._disabled && voiceState() === 'idle' && !inCall()) HubVoice.speak(p.name + ' here.'); } catch {}
  }
  function flash(msg, err) {
    const el = $('#jmsg'); if (!el) return;
    el.textContent = msg; el.style.color = err ? 'var(--red)' : 'var(--green)';
    clearTimeout(J.flashT); J.flashT = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  // ---- memory-recall pill (mirrors the Run tab's recall toggle) --------------
  function recallOn() { try { return localStorage.getItem('hub.recall') === '1'; } catch { return false; } }
  function renderRecall() {
    const b = $('#jrecall'); if (!b) return;
    const on = recallOn();
    b.classList.toggle('on', on);
    b.innerHTML = `◇ memory recall · <b>${on ? 'on' : 'off'}</b>`;
  }
  function toggleRecall() {
    const next = !recallOn();
    try { localStorage.setItem('hub.recall', next ? '1' : '0'); } catch {}
    const rc = $('#runRecall'); if (rc) rc.checked = next; // keep the Run tab in sync if it's built
    renderRecall();
    flash(next ? '✓ memory recall on' : '✓ memory recall off');
  }

  // ---- prompt workspace (the distiller, surfaced) ----------------------------
  const REFINERS = [
    { k: 'shorter', mod: 'Make it shorter and denser.' },
    { k: 'more technical', mod: 'Make it more technical and precise.' },
    { k: 'add constraints', mod: 'Add explicit constraints and acceptance criteria.' },
    { k: 'add examples', mod: 'Include a concrete example of the expected output.' },
    { k: 'trim context', mod: 'Strip background and keep only the actionable ask.' },
  ];
  function wsMeta() {
    const src = ($('#jwsIn') && $('#jwsIn').value || '').trim();
    const words = src ? src.split(/\s+/).length : 0;
    const model = src ? (typeof analyzePromptComplexity === 'function' ? analyzePromptComplexity(src) : 'auto') : '—';
    const p = J.personas.find(x => x.id === J.active);
    const m = $('#jwsMeta');
    if (m) m.innerHTML = `<span class="jbadge">intent · ${words > 25 ? 'distill' : 'clean'}</span>`
      + `<span class="jbadge accent">${esc(model)}</span>`
      + `<span class="jbadge">${words} words</span>`
      + `<span class="jbadge">persona · ${esc(p ? p.name.toLowerCase() : 'off')}</span>`;
  }
  async function shape(mod) {
    const ta = $('#jwsIn'); if (!ta) return;
    let src = ta.value.trim();
    if (!src) { flash('nothing to shape yet — type a loose ask first', true); return; }
    if (mod) src += `\n\n(Refine: ${mod})`;
    const btn = $('#jwsShape'), label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '✦ Shaping…'; }
    let out = '';
    try { out = await jarvisDistill(src); } catch {}
    if (btn) { btn.disabled = false; btn.textContent = label; }
    if (!out) { flash('✗ distiller returned nothing — try again', true); return; }
    J.shaped = out;
    const box = $('#jwsOut'), wrap = $('#jwsOutWrap');
    if (box) box.textContent = out;
    if (wrap) wrap.classList.remove('hidden');
    flash('✓ shaped' + (mod ? ' · ' + mod.replace(/\.$/, '').toLowerCase() : ''));
  }
  function runShaped() {
    const prompt = (J.shaped || ($('#jwsIn') && $('#jwsIn').value) || '').trim();
    if (!prompt) { flash('nothing to run yet', true); return; }
    goTab('run');
    if (typeof ensureRunUI === 'function') ensureRunUI();
    const pi = $('#promptIn');
    if (pi) { pi.value = prompt; pi.focus(); }
    if (typeof sendPrompt === 'function') sendPrompt();
  }
  function copyShaped() {
    const t = (J.shaped || ($('#jwsIn') && $('#jwsIn').value) || '').trim();
    if (!t) { flash('nothing to copy yet', true); return; }
    try { navigator.clipboard.writeText(t); flash('✓ copied'); } catch { flash('✗ clipboard blocked', true); }
  }

  // ---- live transcript tail (newest Claude Code session) ---------------------
  function fmtEvent(e) {
    const tag = e.kind === 'user' ? '›' : (e.kind === 'tool' ? '⚒' : '·');
    const color = e.kind === 'user' ? 'var(--txt)' : (e.kind === 'tool' ? 'var(--accent)' : 'var(--muted)');
    return `<div style="color:${color}">${tag} ${esc(e.text || '')}</div>`;
  }
  async function pollTranscript(force) {
    const feed = $('#jconv'); if (!feed || !visible()) return;
    let list;
    try { const d = await api('/api/sessions'); list = Array.isArray(d) ? d : (d.list || []); } catch { return; }
    if (!list || !list.length) { feed.innerHTML = '<span class="muted">no session transcript yet — talk to the orb or fire a run</span>'; return; }
    const sid = list[0].id;
    let events;
    try { events = await api(`/api/session-tail?id=${encodeURIComponent(sid)}&n=40`); } catch { return; }
    if (!Array.isArray(events)) return;
    const sig = events.length + '|' + (events.length ? events[events.length - 1].text : '');
    if (!force && sig === J.txSig) return;
    J.txSig = sig;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    feed.innerHTML = events.length ? events.map(fmtEvent).join('\n') : '<span class="muted">(no conversation events yet)</span>';
    if (force || atBottom) feed.scrollTop = feed.scrollHeight;
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
      <div class="jhead">
        <div class="jhead-l">
          <div class="jeyebrow">Console · voice + text</div>
          <h2 class="jtitle"><span class="jname" id="jname">…</span><span class="jdash"> — </span><span class="jtag" id="jtag"></span></h2>
        </div>
        <div class="jhead-r">
          <button class="jpill" id="jrecall" title="Toggle memory recall for hub runs">◇ memory recall</button>
          <button class="jpill" id="jcustBtn">✎ customize</button>
        </div>
      </div>

      <div class="jcards" id="jcards" role="listbox" aria-label="Persona"></div>

      <div class="jdeck">
        <section class="jpanel jconv-panel">
          <header class="jpanel-h"><span>Live conversation</span><span class="jstate-badge" id="jconvState">idle</span></header>
          <div class="jstage">
            <canvas id="jorb" role="button" tabindex="0" aria-label="Voice orb — tap to talk, hold for a hands-free call"></canvas>
            <div class="jstate" id="jstate">${disabled ? 'voice module unavailable in this browser' : ''}</div>
            <div class="jctrls">
              <button class="jctrl" id="jTalkBtn">◉ <span>Tap to talk</span></button>
              <button class="jctrl" id="jCallBtn">☎ <span class="jcb-t">Open call</span></button>
            </div>
          </div>
          <pre class="jconv" id="jconv"><span class="muted">loading transcript…</span></pre>
        </section>

        <section class="jpanel jws-panel">
          <header class="jpanel-h"><span>Prompt workspace</span><span class="jbadge subtle">Haiku distiller</span></header>
          <textarea id="jwsIn" placeholder="Dump the loose, spoken version of what you want — Jarvis shapes it into one clean, self-contained prompt with the right model."></textarea>
          <div class="jws-meta" id="jwsMeta"></div>
          <div class="jrefine"><span class="jrefine-l">refine</span><span id="jrefineChips"></span></div>
          <div class="jws-actions">
            <button class="jctrl" id="jwsShape">✦ Shape</button>
            <button class="ghost jctrl" id="jwsCopy">⧉ copy</button>
            <button class="jctrl primary" id="jwsRun">▷ run this</button>
          </div>
          <div class="jws-out hidden" id="jwsOutWrap">
            <div class="jws-out-h">shaped prompt — what fires</div>
            <pre id="jwsOut"></pre>
          </div>
        </section>
      </div>

      <div class="jcustom">
        <span class="jmsg" id="jmsg"></span>
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

    // orb canvas: sized to the panel, DPR-aware, one draw context for life
    const cv = $('#jorb');
    J.size = Math.max(200, Math.min(300, Math.floor(Math.min(window.innerWidth * 0.7, 300))));
    J.dpr = window.devicePixelRatio || 1;
    cv.width = J.size * J.dpr; cv.height = J.size * J.dpr;
    cv.style.width = cv.style.height = J.size + 'px';
    J.ctx = cv.getContext('2d'); J.ctx.scale(J.dpr, J.dpr);
    // interactions mirror the header orb — tap delegates to its click handler
    // (one code path for one-shot / hush / hang-up), hold starts a call.
    let pressT = null, longPressed = false;
    const tap = e => { const hdr = $('#voiceOrb'); if (hdr && hdr.onclick) hdr.onclick(e); };
    cv.onpointerdown = e => {
      if (e.button && e.button !== 0) return;
      longPressed = false; clearTimeout(pressT);
      pressT = setTimeout(() => { longPressed = true; if (window.HubVoice && !inCall()) HubVoice.beginCall(); }, 400);
    };
    cv.onpointerup = cv.onpointercancel = () => clearTimeout(pressT);
    cv.onclick = e => { clearTimeout(pressT); if (longPressed) { longPressed = false; return; } tap(e); };
    cv.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(e); } };

    // control cluster
    $('#jTalkBtn').onclick = tap;
    $('#jCallBtn').onclick = () => { if (!window.HubVoice) return; inCall() ? HubVoice.endCall() : HubVoice.beginCall(); };

    // header pills
    $('#jrecall').onclick = toggleRecall;
    $('#jcustBtn').onclick = () => {
      const p = $('#jcustPanel'); p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) { fillEditorSelect(); loadEditor($('#jpSel').value); $('#jcustPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    };
    renderRecall();

    // workspace
    $('#jrefineChips').innerHTML = REFINERS.map(r => `<button class="jchip-r" data-mod="${esc(r.mod)}">${esc(r.k)}</button>`).join('');
    $('#jrefineChips').querySelectorAll('.jchip-r').forEach(b => b.onclick = () => shape(b.dataset.mod));
    $('#jwsIn').oninput = wsMeta;
    $('#jwsShape').onclick = () => shape('');
    $('#jwsCopy').onclick = copyShaped;
    $('#jwsRun').onclick = runShaped;
    wsMeta();

    // soul editor
    $('#jpSel') && ($('#jpSel').onchange = e => loadEditor(e.target.value));
    $('#jpSave').onclick = saveEditor;

    await loadPersonas();
    wsMeta();
    draw(); startWatch();
    pollTranscript(true);
    if (!J.txTimer) J.txTimer = setInterval(() => pollTranscript(false), 2500);
    if (!reducedMotion()) { if (J.raf == null) J.raf = requestAnimationFrame(loop); }
  };
  renderers.jarvis.noSkeleton = true; // the stage renders instantly — no skeleton flash
})();
