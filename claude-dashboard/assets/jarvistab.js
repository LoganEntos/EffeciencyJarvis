/* Jarvis tab — ported 1:1 from the amber-agent-orb Lovable build (project
   7ce003de) into the hub's zero-dep vanilla JS. Layout: eyebrow + mono
   nameplate, a scroll-row of persona cards, then a two-pane deck — LIVE
   CONVERSATION (state orb + voice controls + transcript tail) and PROMPT IN
   PROGRESS (the Haiku distiller) + HOLDING IN CONTEXT (live derived anchors +
   a thread timeline). The orb is the SAME voice engine as the header orb — tap
   to talk, hold for a call — delegating to assets/voice.js (one voice path).
   Animation runs only while the tab is visible; reduced-motion users get a
   static per-state frame. Personas/distiller/transcript are wired to real
   endpoints; HOLDING IN CONTEXT is derived from live state (no fabricated
   data). Styling in assets/jarvis.css. */
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
  // a small glyph per persona (Lovable used one per card); falls back to ◉.
  const GLYPH = { jarvis: '◉', 'jarvis-wit': '⌁', dispatch: '⚑', sage: '❋', athena: '❋', vulcan: '⚒', hermes: '⌁' };
  const glyphFor = id => GLYPH[id] || '◉';

  // ---- orb (unchanged draw path) --------------------------------------------
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
    else { pulse = S * 0.008 * Math.sin(t * 1.3); }
    const aura = ctx.createRadialGradient(c, c, core * 0.3, c, c, S * 0.48);
    aura.addColorStop(0, color + (st === 'idle' ? '2e' : '55'));
    aura.addColorStop(1, color + '00');
    ctx.fillStyle = aura;
    ctx.beginPath(); ctx.arc(c, c, S * 0.48, 0, 6.2832); ctx.fill();
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = st === 'idle' ? 0.14 : 0.22; ctx.lineWidth = 1;
    ctx.setLineDash([1.5, 7]); ctx.beginPath(); ctx.arc(c, c, S * 0.44, 0, 6.2832); ctx.stroke();
    ctx.restore();
    if (st === 'listening') {
      for (let k = 0; k < 2; k++) {
        const ph = (t * 0.55 + k * 0.5) % 1;
        ctx.beginPath(); ctx.arc(c, c, core + ph * S * 0.28, 0, 6.2832);
        ctx.strokeStyle = listen; ctx.globalAlpha = 0.45 * (1 - ph); ctx.lineWidth = 1.6; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (st === 'thinking') {
      const a = t * 2.2;
      ctx.beginPath(); ctx.arc(c, c, core + S * 0.055, a, a + 1.35);
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.8; ctx.lineWidth = 2.2;
      ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(c - core * 0.3, c - core * 0.35, core * 0.15, c, c, core + pulse);
    g.addColorStop(0, '#ffe9c4'); g.addColorStop(0.35, color); g.addColorStop(1, color);
    ctx.beginPath(); ctx.arc(c, c, core + pulse, 0, 6.2832);
    ctx.fillStyle = g; ctx.shadowColor = color; ctx.shadowBlur = st === 'idle' ? 14 : 30;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(c, c, core + pulse + S * 0.035, 0, 6.2832);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.globalAlpha = 1;
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
    if (reducedMotion()) { J.raf = null; return; }
    J.raf = requestAnimationFrame(loop);
  }
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

  const STATE_LINE = { idle: 'idle', listening: 'listening…', thinking: 'thinking…', speaking: 'speaking — tap to hush' };
  const STATE_BADGE = { idle: '◌ idle', listening: '◉ listening', thinking: '◐ thinking', speaking: '◉ speaking' };
  function updateStateLine(st, call) {
    const el = $('#jstate');
    if (el) {
      const txt = call && st === 'idle' ? 'on call' : (STATE_LINE[st] || st);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('on', st !== 'idle' || call);
    }
    const b = $('#jconvState');
    if (b) {
      const on = st !== 'idle' || call;
      b.textContent = call && st === 'idle' ? '☎ on call' : (STATE_BADGE[st] || st);
      b.classList.toggle('on', on);
    }
    const cb = $('#jCallBtn');
    if (cb) { const on = inCall(); const t = cb.querySelector('.jcb-t'); if (t) t.textContent = on ? 'hang up' : 'open call'; cb.classList.toggle('on', on); }
  }

  // ---- personas --------------------------------------------------------------
  async function loadPersonas() {
    const d = await api('/api/personas');
    J.personas = d.personas || []; J.active = d.active;
    renderCards(); renderNameplate(); renderHolding();
    const sel = $('#jpSel'); if (sel) fillEditorSelect(sel.value);
  }
  function renderNameplate() {
    const p = J.personas.find(x => x.id === J.active);
    const nm = $('#jname'); if (nm) nm.textContent = p ? p.name : 'Jarvis';
    const tg = $('#jtag'); if (tg) tg.textContent = p ? ' — ' + (p.tagline || p.tone || 'active') : ' — plain Claude';
  }
  function card(p, on) {
    const id = p ? p.id : 'none';
    const name = p ? p.name : 'Off';
    const glyph = on ? (p ? glyphFor(id) : '○') : (p ? glyphFor(id) : '○');
    const tag = p ? esc(p.tagline || '') : 'plain Claude — no persona';
    const tone = p ? toneWords(p.tone).join(' · ') : 'neutral · unstyled';
    return `<button class="jcard${on ? ' active' : ''}" data-id="${esc(id)}">
      <div class="jc-top"><span class="jc-name">${esc(name)}</span><span class="jc-mark">${on ? '◉' : glyph}</span></div>
      <div class="jc-tag">${tag}</div>
      <div class="jc-tone">${esc(tone)}</div>
      ${on ? '<div class="jp-pill live jc-conn">◉ has the conn</div>' : ''}
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
    J.active = r.active; renderCards(); renderNameplate(); renderHolding(); wsMeta();
    const p = J.personas.find(x => x.id === r.active);
    flash(r.active ? '✓ ' + (p ? p.name : r.active) + ' has the conn' + (r.handoff ? ' — handoff briefed' : '') : '✓ persona off — plain Claude');
    try { if (p && window.HubVoice && !HubVoice._disabled && voiceState() === 'idle' && !inCall()) HubVoice.speak(p.name + ' here.'); } catch {}
  }
  function flash(msg, err) {
    const el = $('#jmsg'); if (!el) return;
    el.textContent = msg; el.style.color = err ? 'var(--red)' : 'var(--green)';
    clearTimeout(J.flashT); J.flashT = setTimeout(() => { el.textContent = ''; }, 4000);
  }

  // ---- memory-recall pill (mirrors the Run tab toggle) -----------------------
  function recallOn() { try { return localStorage.getItem('hub.recall') === '1'; } catch { return false; } }
  function renderRecall() {
    const b = $('#jrecall'); if (!b) return;
    const on = recallOn();
    b.classList.toggle('on', on);
    b.innerHTML = `memory recall · <b>${on ? 'on' : 'off'}</b>`;
  }
  function toggleRecall() {
    const next = !recallOn();
    try { localStorage.setItem('hub.recall', next ? '1' : '0'); } catch {}
    const rc = $('#runRecall'); if (rc) rc.checked = next;
    renderRecall(); renderHolding();
    flash(next ? '✓ memory recall on' : '✓ memory recall off');
  }

  // ---- prompt in progress (distiller, surfaced) ------------------------------
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
    const model = src ? (typeof analyzePromptComplexity === 'function' ? analyzePromptComplexity(src) : 'auto') : 'auto';
    const m = $('#jwsMeta');
    if (m) m.innerHTML = `<span>intent · ${words > 25 ? 'distill' : 'clean'}</span>`
      + `<span class="accent">${esc(model)}</span>`
      + `<span>${words} word${words === 1 ? '' : 's'}</span>`;
  }
  async function shape(mod) {
    const ta = $('#jwsIn'); if (!ta) return;
    let src = ta.value.trim();
    if (!src) { flash('nothing to shape yet — type a loose ask first', true); return; }
    if (mod) src += `\n\n(Refine: ${mod})`;
    const btn = $('#jwsShape'), label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '✦ shaping…'; }
    let out = '';
    try { out = await jarvisDistill(src); } catch {}
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
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

  // ---- holding in context (derived from live state — no fabricated data) -----
  function renderHolding() {
    const grid = $('#jholdGrid'); if (!grid) return;
    const p = J.personas.find(x => x.id === J.active);
    const model = ($('#runModel') && $('#runModel').value) || 'auto';
    const tier = model === 'auto' || model === '' ? 'auto-routed'
      : /opus/.test(model) ? 'heavy' : /haiku|fable/.test(model) ? 'cheap' : 'mid';
    const sess = (typeof chat === 'object' && chat && chat.sessionId) ? chat.sessionId.slice(0, 12) : '—';
    const anchors = [
      ['persona', p ? p.name : 'plain Claude'],
      ['bearing', p ? (toneWords(p.tone).join(' · ') || '—') : 'neutral'],
      ['engine', 'claude'],
      ['model', model === '' ? 'CLI default' : model],
      ['tier', tier],
      ['recall', recallOn() ? 'on' : 'off'],
      ['session', sess],
    ];
    grid.innerHTML = anchors.map(([k, v]) =>
      `<div class="janchor"><div class="janchor-k">${esc(k)}</div><div class="janchor-v" title="${esc(v)}">${esc(v)}</div></div>`).join('')
      + `<button class="jp-pill jpin" id="jpin">＋ pin moment</button>`;
    const cnt = $('#jholdCount'); if (cnt) cnt.textContent = anchors.length + ' anchors';
    const pin = $('#jpin'); if (pin) pin.onclick = () => flash('context pinning is on the roadmap — anchors are live-derived for now');
  }

  // ---- live transcript tail (newest Claude Code session) ---------------------
  function timeOf(iso) { try { return new Date(iso).toLocaleTimeString(undefined, { hour12: false }); } catch { return ''; } }
  function fmtEvent(e) {
    const who = e.kind === 'user' ? 'you' : (e.kind === 'tool' ? 'tool' : 'jarvis');
    const av = e.kind === 'user' ? `<div class="java user">you</div>`
      : e.kind === 'tool' ? `<div class="java assistant">⚒</div>`
      : `<div class="java assistant">◉</div>`;
    return `<div class="jmsg ${e.kind === 'user' ? 'user' : e.kind === 'tool' ? 'tool' : 'assistant'}">
      ${av}
      <div class="jmsg-body">
        <div class="jmsg-meta">${who} · ${timeOf(e.time)}</div>
        <div class="jmsg-text">${esc(e.text || '')}</div>
      </div></div>`;
  }
  function renderTimeline(n) {
    const track = $('#jtlTrack'); if (!track) return;
    const count = Math.min(8, Math.max(1, n || 1));
    let dots = '<div class="jtl-line"></div>';
    for (let i = 0; i < count; i++) {
      const pct = count === 1 ? 0 : (i / (count - 1)) * 92;
      dots += `<button class="jtl-dot${i === count - 1 ? ' active' : ''}" style="left:${pct}%" title="turn ${i + 1}"></button>`;
    }
    dots += '<div class="jtl-end">→</div>';
    track.innerHTML = dots;
  }
  async function pollTranscript(force) {
    const feed = $('#jconv'); if (!feed || !visible()) return;
    let list;
    try { const d = await api('/api/sessions'); list = Array.isArray(d) ? d : (d.list || []); } catch { return; }
    if (!list || !list.length) { feed.innerHTML = '<div class="jmsg-meta" style="padding:4px">no session transcript yet — talk to the orb or fire a run</div>'; return; }
    const sid = list[0].id;
    let events;
    try { events = await api(`/api/session-tail?id=${encodeURIComponent(sid)}&n=40`); } catch { return; }
    if (!Array.isArray(events)) return;
    const sig = events.length + '|' + (events.length ? events[events.length - 1].text : '');
    if (!force && sig === J.txSig) return;
    J.txSig = sig;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    feed.innerHTML = events.length ? events.map(fmtEvent).join('') : '<div class="jmsg-meta" style="padding:4px">(no conversation events yet)</div>';
    renderTimeline(events.length);
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
        <div>
          <div class="jp-label jeyebrow">console · voice + text</div>
          <h1 class="jtitle"><span class="jname" id="jname">Jarvis</span><span class="jtag" id="jtag"> — the quiet operator</span></h1>
        </div>
        <div class="jhead-r">
          <button class="jp-pill" id="jrecall" title="Toggle memory recall for hub runs">memory recall</button>
          <button class="jp-ghost" id="jcustBtn">✎ customize</button>
        </div>
      </div>

      <div class="jcards"><div class="jcards-row" id="jcards" role="listbox" aria-label="Persona"></div></div>

      <div class="jdeck">
        <section class="jp-panel jconv-panel">
          <header class="jpanel-h jhair-b"><span class="jp-label">live conversation</span><span class="jp-pill" id="jconvState">◌ idle</span></header>
          <div class="jstage">
            <canvas id="jorb" role="button" tabindex="0" aria-label="Voice orb — tap to talk, hold for a hands-free call"></canvas>
            <div class="jstate" id="jstate">${disabled ? 'voice unavailable' : 'idle'}</div>
            <div class="jrtt" id="jrtt">rtt —</div>
          </div>
          <div class="jctrls jhair-t">
            <button class="jp-ghost" id="jTalkBtn">⏵ hold to talk</button>
            <button class="jp-btn" id="jCallBtn">☎ <span class="jcb-t">open call</span></button>
            <button class="jp-ghost" id="jThinkBtn">◐ think</button>
            <button class="jp-ghost" id="jBargeBtn">⤾ barge in</button>
          </div>
          <div class="jconv jhair-t" id="jconv"><div class="jmsg-meta" style="padding:4px">loading transcript…</div></div>
        </section>

        <div class="jdeck-r">
          <section class="jp-panel">
            <header class="jpanel-h jhair-b"><span class="jp-label">prompt in progress</span><span class="jpip-meta" id="jwsMeta"></span></header>
            <textarea id="jwsIn" placeholder="Dump the loose, spoken version of what you want — Jarvis shapes it into one clean, self-contained prompt with the right model."></textarea>
            <div class="jpip-foot jhair-t">
              <div class="jrefine"><span class="jp-label">refine:</span><span id="jrefineChips"></span></div>
              <div class="jpip-actions">
                <button class="jp-ghost" id="jwsCopy">⧉ copy</button>
                <button class="jp-btn" id="jwsShape">✦ shape</button>
                <button class="jp-btn" id="jwsRun">▷ run this</button>
              </div>
            </div>
            <div class="jws-out hidden" id="jwsOutWrap">
              <div class="jws-out-h">shaped prompt — what fires</div>
              <pre id="jwsOut"></pre>
            </div>
          </section>

          <section class="jp-panel">
            <header class="jpanel-h jhair-b"><span class="jp-label">holding in context</span><span class="jp-label" id="jholdCount" style="letter-spacing:.04em">—</span></header>
            <div class="jhold-grid" id="jholdGrid"></div>
            <div class="jtimeline jhair-t">
              <div class="jtimeline-h">thread timeline</div>
              <div class="jtl-track" id="jtlTrack"></div>
            </div>
          </section>
        </div>
      </div>

      <div class="jcustom">
        <span class="jmsg-flash" id="jmsg"></span>
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

    // orb canvas: sized to the 4:3 stage, DPR-aware, one draw context for life
    const cv = $('#jorb');
    const stage = cv.parentElement;
    const stageW = Math.max(220, Math.min(520, stage.clientWidth || 480));
    J.size = Math.round(Math.min(stageW, (stageW * 3) / 4));
    J.dpr = window.devicePixelRatio || 1;
    cv.width = J.size * J.dpr; cv.height = J.size * J.dpr;
    cv.style.width = '100%'; cv.style.height = '100%';
    J.ctx = cv.getContext('2d'); J.ctx.scale(J.dpr, J.dpr);
    // orb interaction — same code path as the header orb (tap once / hush /
    // hang-up), hold to start a call.
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
    $('#jThinkBtn').onclick = () => flash('think mode follows the run — the orb shows it live');
    $('#jBargeBtn').onclick = () => { try { if (window.HubVoice && HubVoice.bargeIn) HubVoice.bargeIn(); else if (window.HubVoice && HubVoice.stop) HubVoice.stop(); } catch {} };

    // header pills
    $('#jrecall').onclick = toggleRecall;
    $('#jcustBtn').onclick = () => {
      const p = $('#jcustPanel'); p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) { fillEditorSelect(); loadEditor($('#jpSel').value); p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    };
    renderRecall();

    // prompt-in-progress (distiller)
    $('#jrefineChips').innerHTML = REFINERS.map(r => `<button class="jp-pill" data-mod="${esc(r.mod)}">◦ ${esc(r.k)}</button>`).join('');
    $('#jrefineChips').querySelectorAll('.jp-pill').forEach(b => b.onclick = () => shape(b.dataset.mod));
    $('#jwsIn').oninput = wsMeta;
    $('#jwsShape').onclick = () => shape('');
    $('#jwsCopy').onclick = copyShaped;
    $('#jwsRun').onclick = runShaped;
    wsMeta();

    // soul editor
    $('#jpSel') && ($('#jpSel').onchange = e => loadEditor(e.target.value));
    $('#jpSave').onclick = saveEditor;

    // rtt readout (mirrors the header orb's round-trip if voice exposes it)
    const rtt = $('#jrtt');
    if (rtt && window.HubVoice && HubVoice._rtt) { const v = HubVoice._rtt(); if (v) rtt.textContent = 'rtt ' + v; }

    await loadPersonas();
    wsMeta();
    draw(); startWatch();
    pollTranscript(true);
    if (!J.txTimer) J.txTimer = setInterval(() => pollTranscript(false), 2500);
    if (!reducedMotion()) { if (J.raf == null) J.raf = requestAnimationFrame(loop); }
  };
  renderers.jarvis.noSkeleton = true;
})();
