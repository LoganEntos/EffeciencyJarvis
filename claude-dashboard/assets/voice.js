/* Voice module (N9 Track A) — talk to the hub, it talks back. Zero-dependency,
   browser-native: webkitSpeechRecognition for the mic, speechSynthesis for the
   reply, a small canvas orb in the header for state. No server cost: speech
   never leaves the browser except through the vendor's own speech service.

   Public surface (window.HubVoice):
     init()                    - inject the orb + wire hotkey (called from boot)
     onRunStart()              - a run began → orb goes "thinking"
     onRunDone(text, meta)     - a run ended → orb idle; speak text if talkback on
     renderSettings(container) - Config-tab settings block
*/
'use strict';
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SS = window.speechSynthesis;
  const store = {
    get mic() { try { return localStorage.getItem('hub.voice.mic') === '1'; } catch { return false; } },
    set mic(v) { try { localStorage.setItem('hub.voice.mic', v ? '1' : '0'); } catch {} },
    get talk() { try { return localStorage.getItem('hub.voice.talk') === '1'; } catch { return false; } },
    set talk(v) { try { localStorage.setItem('hub.voice.talk', v ? '1' : '0'); } catch {} },
    get voiceURI() { try { return localStorage.getItem('hub.voice.uri') || ''; } catch { return ''; } },
    set voiceURI(v) { try { localStorage.setItem('hub.voice.uri', v); } catch {} },
    get rate() { try { return parseFloat(localStorage.getItem('hub.voice.rate')) || 1; } catch { return 1; } },
    set rate(v) { try { localStorage.setItem('hub.voice.rate', String(v)); } catch {} },
  };

  const V = { state: 'idle', rec: null, listening: false, raf: null, canvas: null, ctx: null, t0: performance.now() };

  function css(name, fb) { return (getComputedStyle(document.documentElement).getPropertyValue(name) || fb).trim() || fb; }

  // ---- orb -----------------------------------------------------------------
  function buildOrb() {
    if ($('#voiceOrb')) return;
    const btn = document.createElement('button');
    btn.id = 'voiceOrb';
    btn.className = 'iconbtn';
    btn.title = SR ? 'Voice (V) — click to talk' : 'Voice input needs Chrome or Edge (desktop)';
    btn.style.cssText = 'padding:0;width:38px;height:38px;display:inline-grid;place-items:center';
    const cv = document.createElement('canvas');
    const DPR = window.devicePixelRatio || 1;
    cv.width = 30 * DPR; cv.height = 30 * DPR; cv.style.cssText = 'width:30px;height:30px';
    btn.appendChild(cv);
    const ref = $('#refreshTab');
    ref.parentNode.insertBefore(btn, ref);
    V.canvas = cv; V.ctx = cv.getContext('2d'); V.ctx.scale(DPR, DPR);
    btn.onclick = () => {
      if (V.state === 'speaking') { stopSpeak(); return; }
      if (!SR) { setState('idle'); return; }
      V.listening ? stopListen() : startListen();
    };
    loop();
  }

  function setState(s) { V.state = s; }

  function loop() {
    V.raf = requestAnimationFrame(loop);
    const ctx = V.ctx; if (!ctx) return;
    const t = (performance.now() - V.t0) / 1000;
    const amber = css('--accent', '#e8a33d'), green = css('--green', '#4bc47a');
    const muted = css('--muted', '#a89e8a');
    ctx.clearRect(0, 0, 30, 30);
    const cx = 15, cy = 15;
    let color = muted, base = 6.5, pulse = 0;
    if (V.state === 'listening') { color = green; pulse = 2.4 * (0.5 + 0.5 * Math.sin(t * 7)); base = 6.5; }
    else if (V.state === 'thinking') { color = amber; pulse = 2.2 * (0.5 + 0.5 * Math.sin(t * 4)); }
    else if (V.state === 'speaking') { color = amber; pulse = 3.2 * Math.abs(Math.sin(t * 11)); }
    else { color = SR ? amber : muted; pulse = 0.8 * (0.5 + 0.5 * Math.sin(t * 1.6)); } // idle breath
    // outer ring
    ctx.beginPath(); ctx.arc(cx, cy, base + pulse + 3.2, 0, 6.2832);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2; ctx.stroke();
    // core
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(cx, cy, base + pulse, 0, 6.2832);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = V.state === 'idle' ? 3 : 9;
    ctx.fill(); ctx.shadowBlur = 0;
    // mic notch when idle+ready so it reads as a mic
    if (V.state === 'idle' && SR) {
      ctx.fillStyle = css('--bg', '#0e0d0b'); ctx.globalAlpha = 0.9;
      ctx.fillRect(cx - 1.3, cy - 3, 2.6, 5); ctx.globalAlpha = 1;
    }
  }

  // ---- speech-to-text ------------------------------------------------------
  function startListen() {
    if (!SR) return;
    if (SS && SS.speaking) SS.cancel();
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    V.rec = rec; V.listening = true; setState('listening');
    goTab('run'); ensureRunUI();
    const ta = $('#promptIn'); const pre = ta ? ta.value : '';
    rec.onresult = (e) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      if (!ta) return;
      ta.value = (pre ? pre + ' ' : '') + txt;
      if (e.results[e.results.length - 1].isFinal) {
        V.finalText = txt.trim();
      }
    };
    rec.onerror = () => { stopListen(); };
    rec.onend = () => {
      V.listening = false;
      const send = V.finalText;
      V.finalText = '';
      // sendPrompt() self-guards on an already-running chat, so this is safe
      if (send && typeof sendPrompt === 'function') { setState('thinking'); sendPrompt(); }
      else setState('idle');
    };
    try { rec.start(); } catch { stopListen(); }
  }
  function stopListen() {
    V.listening = false;
    try { V.rec && V.rec.stop(); } catch {}
    if (V.state === 'listening') setState('idle');
  }

  // ---- text-to-speech ------------------------------------------------------
  function pickVoice() {
    if (!SS) return null;
    const voices = SS.getVoices();
    if (!voices.length) return null;
    if (store.voiceURI) { const m = voices.find(v => v.voiceURI === store.voiceURI); if (m) return m; }
    return voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || voices[0];
  }
  function speak(text) {
    if (!SS || !text) return;
    const clean = String(text).replace(/```[\s\S]*?```/g, ' (code block) ').replace(/[*_`#>]/g, '').trim().slice(0, 700);
    if (!clean) return;
    SS.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(); if (v) u.voice = v;
    u.rate = store.rate; u.onstart = () => setState('speaking');
    u.onend = () => { if (V.state === 'speaking') setState('idle'); };
    SS.speak(u);
  }
  function stopSpeak() { if (SS) SS.cancel(); if (V.state === 'speaking') setState('idle'); }

  // ---- run lifecycle hooks (called from run.js) ----------------------------
  function onRunStart() { if (!V.listening) setState('thinking'); }
  function onRunDone(text) {
    if (store.talk && text) speak(text);
    else if (V.state === 'thinking') setState('idle');
  }

  // ---- Config-tab settings -------------------------------------------------
  function renderSettings(container) {
    const voices = SS ? SS.getVoices() : [];
    const opts = voices.map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === store.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    container.innerHTML = `
      <h2 style="font-size:12px;margin-top:22px">Voice <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— N9 Track A · browser-native, zero server cost</span></h2>
      <div class="row">
        ${SR ? '' : '<div class="note" style="margin-bottom:10px">Mic input needs Chrome or Edge on desktop. Talk-back works everywhere.</div>'}
        <label class="chk" title="show the mic orb and allow click/V-key to talk"><input type="checkbox" id="vMic"${store.mic ? ' checked' : ''}> Mic orb in header ${SR ? '' : '(input unavailable in this browser)'}</label>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="vTalk"${store.talk ? ' checked' : ''}> Speak Claude's replies out loud</label>
        <div class="flex" style="margin-top:12px;align-items:center">
          <span class="muted" style="font-size:12px">Voice</span>
          <select id="vVoice" style="min-width:220px">${opts || '<option>system default</option>'}</select>
          <span class="muted" style="font-size:12px">Rate</span>
          <input type="range" id="vRate" min="0.6" max="1.6" step="0.1" value="${store.rate}" style="width:120px">
          <button class="ghost" id="vTest" style="padding:6px 12px;font-size:11.5px">▶ Test voice</button>
        </div>
      </div>`;
    const orb = $('#voiceOrb');
    container.querySelector('#vMic').onchange = e => { store.mic = e.target.checked; if (orb) orb.style.display = e.target.checked ? '' : 'none'; };
    container.querySelector('#vTalk').onchange = e => { store.talk = e.target.checked; };
    container.querySelector('#vVoice').onchange = e => { store.voiceURI = e.target.value; };
    container.querySelector('#vRate').onchange = e => { store.rate = parseFloat(e.target.value); };
    container.querySelector('#vTest').onclick = () => speak('Voice is ready. I will read Claude\'s replies aloud when you turn talk-back on.');
  }

  function init() {
    if (!SR && !SS) return; // nothing available at all
    buildOrb();
    const orb = $('#voiceOrb');
    if (orb && !store.mic) orb.style.display = 'none';
    if (SS && SS.onvoiceschanged === null) SS.onvoiceschanged = () => {}; // prime async voice list
    window.addEventListener('keydown', e => {
      if (e.key !== 'v' && e.key !== 'V') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!store.mic || !SR) return;
      e.preventDefault();
      V.listening ? stopListen() : startListen();
    });
  }

  window.HubVoice = { init, onRunStart, onRunDone, renderSettings, speak, _state: () => V.state };
})();
