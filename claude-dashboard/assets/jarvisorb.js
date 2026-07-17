/* Jarvis tab — audio-driven canvas orb. Ten layers per frame: outer halo,
   listening/call ripple rings, dashed rotating rim, thinking arc, waveform
   corona (audio-driven), sphere body, specular highlight, terminator shadow,
   edge hairlines, speaking pulse rings. State comes from HubVoice (idle/
   listening/thinking/speaking/call) with a fallback: while jarvisChat is
   running we render 'thinking'. Hue is clamped 28..44 per persona so all
   personas stay amber-adjacent. Split out of jarvistab.js for the 500-line
   project cap. Zero deps. */
'use strict';
(function () {
  // Hue table lives in jarvis.js (jarvisHueOf) — shared with jarvistab.js.
  const hueOf = id => jarvisHueOf(id);
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const voiceState = () => (window.HubVoice && !HubVoice._disabled) ? HubVoice._state()
    : (window.jarvisChat && window.jarvisChat.isRunning() ? 'thinking' : 'idle');
  const inCall = () => !!(window.HubVoice && !HubVoice._disabled && HubVoice._call());
  const STATE_LINE = { idle: 'idle', listening: 'listening…', thinking: 'thinking…', speaking: 'speaking — tap to hush' };
  const STATE_BADGE = { idle: '◌ idle', listening: '◉ listening', thinking: '◐ thinking', speaking: '◉ speaking' };
  const decay = (v, target, k) => v + (target - v) * k;

  const O = { ctx: null, cv: null, stage: null, w: 300, h: 225, dpr: 1, raf: null, watch: null,
    t0: performance.now(), lastState: '', personaId: null, ro: null,
    audio: null, env: { fast: 0, slow: 0, mid: 0, hi: 0 } };

  function visible() { const s = $('#jarvis'); return s && !s.classList.contains('hidden') && !document.hidden; }
  function pullAudio() {
    const a = O.audio; if (!a || !a.analyser) return;
    a.analyser.getByteFrequencyData(a.buf);
    let sum = 0, hi = 0, mid = 0, lo = 0;
    for (let i = 0; i < a.buf.length; i++) {
      const v = a.buf[i] / 255; sum += v;
      if (i < 8) lo += v; else if (i < 40) mid += v; else hi += v;
    }
    const n = a.buf.length;
    O.env.fast = decay(O.env.fast, lo / 8, 0.35);
    O.env.slow = decay(O.env.slow, sum / n, 0.08);
    O.env.mid = decay(O.env.mid, mid / 32, 0.18);
    O.env.hi = decay(O.env.hi, hi / (n - 40), 0.22);
  }
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
  function draw() {
    const ctx = O.ctx; if (!ctx) return;
    const w = O.w, h = O.h, cx = w / 2, cy = h / 2, t = (performance.now() - O.t0) / 1000;
    const st = voiceState(), call = inCall(), on = st !== 'idle' || call;
    if (on) pullAudio();
    const H = hueOf(O.personaId), R = Math.min(w, h) * 0.28;
    const envA = st === 'listening' ? O.env.fast : (st === 'speaking' ? O.env.slow : 0);
    const breath = 0.5 + 0.5 * Math.sin(t * (st === 'listening' ? 7 : st === 'speaking' ? 9 : 1.6));
    const pulse = R * (0.02 + 0.05 * envA + 0.02 * breath * (on ? 1 : 0.2));

    ctx.clearRect(0, 0, w, h);
    const haloR = R * (2.3 + breath * 0.15 + envA * 0.35);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, haloR);
    halo.addColorStop(0, `hsla(${H},62%,52%,${on ? 0.24 : 0.10})`);
    halo.addColorStop(0.55, `hsla(${H},62%,52%,${on ? 0.08 : 0.03})`);
    halo.addColorStop(1, `hsla(${H},62%,52%,0)`);
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);

    if (st === 'listening' || call) {
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.55 + k / 3) % 1;
        ctx.beginPath(); ctx.arc(cx, cy, R + ph * R * 1.4, 0, 6.2832);
        ctx.strokeStyle = `hsla(${H},62%,52%,${(1 - ph) * (0.14 + O.env.fast * 0.28)})`;
        ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    if (call) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.18);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.55, 0, 6.2832);
      ctx.setLineDash([5, 9]); ctx.strokeStyle = `hsla(${H},62%,58%,0.55)`;
      ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }
    if (st === 'thinking') {
      const a = t * 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, a, a + Math.PI * 0.55);
      ctx.strokeStyle = `hsla(${H},70%,58%,0.7)`; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
    }
    if (on) {
      const N = 96, base = R * 1.02;
      for (let i = 0; i < N; i++) {
        const ang = (i / N) * 6.2832 + t * 0.15;
        const wave = 0.55 * Math.abs(Math.sin(i * 0.6 + t * 3)) + O.env.mid;
        const len = R * (0.06 + 0.24 * wave);
        const x0 = cx + Math.cos(ang) * base, y0 = cy + Math.sin(ang) * base;
        const x1 = cx + Math.cos(ang) * (base + len), y1 = cy + Math.sin(ang) * (base + len);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.strokeStyle = `hsla(${H},62%,58%,${0.12 + wave * 0.55})`;
        ctx.lineWidth = 1; ctx.stroke();
      }
    }
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R + pulse);
    body.addColorStop(0, `hsl(${H},82%,82%)`);
    body.addColorStop(0.28, `hsl(${H},70%,58%)`);
    body.addColorStop(0.7, `hsl(${H},55%,32%)`);
    body.addColorStop(1, `hsl(${H},60%,10%)`);
    ctx.beginPath(); ctx.arc(cx, cy, R + pulse, 0, 6.2832);
    ctx.fillStyle = body;
    ctx.shadowColor = `hsl(${H},78%,58%)`; ctx.shadowBlur = on ? 42 : 20;
    ctx.fill(); ctx.shadowBlur = 0;

    const specX = cx + Math.cos(-Math.PI * 0.65) * R * 0.4 + Math.sin(t * 0.4) * 2;
    const specY = cy + Math.sin(-Math.PI * 0.65) * R * 0.4 + Math.cos(t * 0.33) * 2;
    const spec = ctx.createRadialGradient(specX, specY, 0, specX, specY, R * 0.55);
    spec.addColorStop(0, `hsla(${H},82%,90%,0.85)`);
    spec.addColorStop(0.5, `hsla(${H},82%,88%,0.18)`);
    spec.addColorStop(1, `hsla(${H},82%,88%,0)`);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R + pulse, 0, 6.2832); ctx.clip();
    ctx.fillStyle = spec; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const termX = cx + Math.cos(Math.PI * 0.35) * R * 0.5;
    const termY = cy + Math.sin(Math.PI * 0.35) * R * 0.5;
    const term = ctx.createRadialGradient(termX, termY, 0, termX, termY, R * 0.9);
    term.addColorStop(0, `hsla(${H},45%,4%,${0.55 + O.env.mid * 0.18})`);
    term.addColorStop(1, `hsla(${H},45%,4%,0)`);
    ctx.fillStyle = term; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    ctx.beginPath(); ctx.arc(cx, cy, R + pulse, 0, 6.2832);
    ctx.strokeStyle = `hsla(${H},55%,55%,0.12)`; ctx.lineWidth = 1; ctx.stroke();
    if (st === 'speaking') {
      for (let k = 0; k < 2; k++) {
        const ph = (t * 1.1 + k * 0.5) % 1;
        ctx.beginPath(); ctx.arc(cx, cy, R + pulse + ph * R * 0.8, 0, 6.2832);
        ctx.strokeStyle = `hsla(${H},70%,60%,${(1 - ph) * 0.5})`;
        ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    updateStateLine(st, call);
  }
  function loop() {
    if (!visible()) { O.raf = null; return; }
    draw();
    if (reducedMotion()) { O.raf = null; return; }
    O.raf = requestAnimationFrame(loop);
  }
  function startWatch() {
    if (O.watch) return;
    O.watch = setInterval(() => {
      if (!visible()) return;
      const key = voiceState() + (inCall() ? '+call' : '');
      if (O.raf == null && (!reducedMotion() || key !== O.lastState)) { O.lastState = key; O.raf = requestAnimationFrame(loop); }
      else O.lastState = key;
    }, 400);
    document.addEventListener('visibilitychange', () => { if (visible() && O.raf == null) O.raf = requestAnimationFrame(loop); });
  }
  function init(cv, stage) {
    O.cv = cv; O.stage = stage;
    O.dpr = Math.min(2, window.devicePixelRatio || 1);
    O.ctx = cv.getContext('2d');
    const resize = () => {
      const w = Math.max(220, stage.clientWidth || 480);
      const h = Math.max(160, stage.clientHeight || Math.round(w * 3 / 4));
      O.w = w; O.h = h;
      cv.width = Math.round(w * O.dpr); cv.height = Math.round(h * O.dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      O.ctx.setTransform(O.dpr, 0, 0, O.dpr, 0, 0);
      if (O.raf == null && !reducedMotion()) O.raf = requestAnimationFrame(loop); else draw();
    };
    try { O.ro && O.ro.disconnect(); } catch {}
    O.ro = new ResizeObserver(resize); O.ro.observe(stage);
    resize();
    draw(); startWatch();
    if (!reducedMotion() && O.raf == null) O.raf = requestAnimationFrame(loop);
  }
  function setPersona(id) { O.personaId = id; }
  function stop() {
    try { O.ro && O.ro.disconnect(); } catch {}
    if (O.raf) { cancelAnimationFrame(O.raf); O.raf = null; }
    if (O.watch) { clearInterval(O.watch); O.watch = null; }
  }
  window.jarvisOrb = { init, setPersona, stop, updateStateLine };
})();
