/* Voice settings panel (Config tab) — split out of voice.js to keep every
   file under the repo's 500-line rule. Attaches HubVoice.renderSettings;
   voice.js exposes its closure internals via HubVoice._cfg. Loaded after
   voice.js in index.html. */
'use strict';
(function () {
  function renderSettings(container) {
    const { SS, SR, store, speakBrowser, csmFetch, playBlob, stopSpeak, setState, V, micBlockReason } = window.HubVoice._cfg;
    const voices = SS ? SS.getVoices() : [];
    const opts = voices.map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === store.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    container.innerHTML = `
      <h2 style="font-size:12px;margin-top:22px">Voice <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— N9 Track A · browser-native, zero server cost</span></h2>
      <div class="row">
        ${SR ? '' : '<div class="note" style="margin-bottom:10px">Mic input needs Chrome or Edge on desktop. Talk-back works everywhere.</div>'}
        <label class="chk" title="show the mic orb and allow click/V-key to talk"><input type="checkbox" id="vMic"${store.mic ? ' checked' : ''}> Mic orb in header ${SR ? '' : '(input unavailable in this browser)'}</label>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="vTalk"${store.talk ? ' checked' : ''}> Speak Claude's replies out loud</label>
        <label class="chk" style="margin-top:8px" title="after each reply, re-open the mic for a natural back-and-forth"><input type="checkbox" id="vConv"${store.conv ? ' checked' : ''}> Hands-free call — a plain orb tap starts the loop ${SR ? '' : '(needs Chrome or Edge)'}</label>
        <div class="note" style="margin:8px 0 2px">Call mode keeps the mic open between turns (talk-back is always on during a call). A soft blip means it's your turn. Hang up with <b>Esc</b>, a click, or two quiet turns. Shift+click / long-press the orb starts a call any time.</div>
        <label class="chk" style="margin-top:8px" title="in a call, ignore anything you say that doesn't include the wake word — stops room noise or my own voice from triggering a turn"><input type="checkbox" id="vWakeGate"${store.wakeGate ? ' checked' : ''}> Only act when you say my name (wake-word gate)</label>
        <div class="flex" style="margin-top:8px;align-items:center">
          <span class="muted" style="font-size:12px">Wake word</span>
          <input type="text" id="vWake" value="${esc(store.wake)}" maxlength="24" style="width:130px" placeholder="Jarvis">
          <span class="muted" style="font-size:11.5px">During a call, say e.g. “<b>${esc(store.wake)}</b>, what's on the schedule” — the name is stripped from the prompt. Off = every turn is heard.</span>
        </div>
        <div class="flex" style="margin-top:12px;align-items:center;gap:10px">
          <span class="muted" style="font-size:12px">Mic status</span>
          <span id="vMicStat" class="pill neutral" style="font-size:11px">checking…</span>
          <button class="ghost" id="vMicTest" style="padding:6px 12px;font-size:11.5px">◉ Test mic &amp; grant permission</button>
        </div>
        <div id="vMicWhy" class="note" style="margin:6px 0 2px;display:none"></div>
        <div class="flex" style="margin-top:12px;align-items:center">
          <span class="muted" style="font-size:12px">Voice</span>
          <select id="vVoice" style="min-width:220px">${opts || '<option>system default</option>'}</select>
          <span class="muted" style="font-size:12px">Rate</span>
          <input type="range" id="vRate" min="0.6" max="1.6" step="0.1" value="${store.rate}" style="width:120px">
          <button class="ghost" id="vTest" style="padding:6px 12px;font-size:11.5px">▶ Test voice</button>
        </div>
        <div class="flex" style="margin-top:12px;align-items:center" title="how long a silence means you've finished speaking — raise it if it cuts you off">
          <span class="muted" style="font-size:12px">Pause before sending</span>
          <input type="range" id="vPause" min="1" max="5" step="0.5" value="${store.pause}" style="width:150px">
          <span class="muted mono" id="vPauseVal" style="font-size:11.5px">${store.pause.toFixed(1)}s</span>
        </div>
        <div style="margin-top:16px">
          <div class="muted" style="font-size:12px;margin-bottom:8px">TTS engine <span class="muted" style="font-weight:400;color:var(--dim)">— which voice reads replies aloud (neural engines run locally on your GPU; see docs/voice-csm.md)</span></div>
          <div class="seg" id="vEngine" role="radiogroup" aria-label="TTS engine">
            <label class="seg-opt"><input type="radio" name="vEngine" value="browser"${store.engine === 'browser' ? ' checked' : ''}><span class="seg-t">Browser</span><span class="seg-s">instant · zero-cost</span></label>
            <label class="seg-opt"><input type="radio" name="vEngine" value="kokoro"${store.engine === 'kokoro' ? ' checked' : ''}><span class="seg-t">Kokoro-82M</span><span class="seg-s">fast neural</span></label>
            <label class="seg-opt"><input type="radio" name="vEngine" value="csm"${store.engine === 'csm' ? ' checked' : ''}><span class="seg-t">Sesame CSM-1B</span><span class="seg-s">natural · slow</span></label>
          </div>
        </div>
        <div class="flex" style="margin-top:12px;align-items:center">
          <span class="muted" style="font-size:12px">Speaker</span>
          <input type="number" id="vCsmSpk" min="0" max="9" step="1" value="${store.csmSpeaker}" style="width:58px">
          <span id="vCsmEng" class="pill neutral" style="font-size:11px">engine: checking…</span>
          <button class="ghost hidden" id="vCsmStart" style="padding:6px 12px;font-size:11.5px">⚡ Start engine</button>
          <button class="danger hidden" id="vCsmStop" style="padding:6px 12px;font-size:11.5px">⏻ Stop engine</button>
          <button class="ghost" id="vCsmTest" style="padding:6px 12px;font-size:11.5px">▶ Test voice</button>
          <button class="ghost" id="vVoiceFolder" style="padding:6px 12px;font-size:11.5px" title="open the folder holding this engine's model + voice files in Explorer">📁 Voice files…</button>
          <span id="vCsmStat" class="pill neutral" style="font-size:11px;display:none"></span>
        </div>
        <div class="note" style="margin:6px 0 2px"><b>Kokoro-82M</b> is the fast local neural voice (runs in <span class="mono">.kokoro/</span> via <span class="mono">scripts/kokoro-server.py</span> on onnxruntime — ~0.1–0.3 s per sentence on the GPU, first run downloads ~340 MB). <b>CSM-1B</b> (<span class="mono">.csm/</span>) is more natural but slow (~6 s to first word) — see <span class="mono">docs/voice-csm.md</span>. Pick an engine above, hit <b>Start engine</b>, then <b>Test voice</b>; if a neural engine fails the hub falls back to the browser voice. Voice/rate sliders apply to the browser engine only; Speaker applies to the neural engines.</div>
      </div>`;
    const orb = $('#voiceOrb');
    container.querySelector('#vMic').onchange = e => { store.mic = e.target.checked; if (orb) orb.style.display = e.target.checked ? '' : 'none'; };
    container.querySelector('#vTalk').onchange = e => { store.talk = e.target.checked; };
    container.querySelector('#vConv').onchange = e => { store.conv = e.target.checked; if (e.target.checked && !store.mic) { store.mic = true; if (orb) orb.style.display = ''; const m = container.querySelector('#vMic'); if (m) m.checked = true; } };
    container.querySelector('#vWakeGate').onchange = e => { store.wakeGate = e.target.checked; };
    container.querySelector('#vWake').onchange = e => { store.wake = e.target.value; e.target.value = store.wake; };
    container.querySelector('#vVoice').onchange = e => { store.voiceURI = e.target.value; };
    container.querySelector('#vRate').onchange = e => { store.rate = parseFloat(e.target.value); };
    container.querySelector('#vPause').oninput = e => { store.pause = parseFloat(e.target.value); const pv = container.querySelector('#vPauseVal'); if (pv) pv.textContent = parseFloat(e.target.value).toFixed(1) + 's'; };
    container.querySelector('#vTest').onclick = () => speakBrowser('Voice is ready. I will read Claude\'s replies aloud when you turn talk-back on.');
    // which neural sidecar the status pill / Start / Test act on (browser → the
    // recommended fast one so you can install it before switching)
    const neuralEngine = () => (store.neural ? store.engine : 'kokoro');
    container.querySelector('#vEngine').onchange = e => { store.engine = e.target.value; pollEngine(0); };
    container.querySelector('#vCsmSpk').onchange = e => {
      const n = parseInt(e.target.value, 10);
      store.csmSpeaker = isNaN(n) ? 0 : Math.max(0, Math.min(9, n));
      e.target.value = store.csmSpeaker;
    };
    // ---- CSM engine status + one-click start ----
    const eng = container.querySelector('#vCsmEng');
    const startBtn = container.querySelector('#vCsmStart');
    const stopBtn = container.querySelector('#vCsmStop');
    // Stop is only meaningful while the sidecar is up (ready/loading); Start only
    // when it's installed-but-down. They're mutually exclusive.
    function setBtns(canStart, canStop) {
      startBtn.classList.toggle('hidden', !canStart);
      stopBtn.classList.toggle('hidden', !canStop);
    }
    function paintEngine(j) {
      if (!eng) return;
      const s = (j && j.status) || 'offline';
      const nm = neuralEngine(), dir = nm === 'kokoro' ? '.kokoro' : '.csm';
      if (s === 'ready') { eng.className = 'pill ok'; eng.textContent = `${nm}: ready · ${esc(j.device || '?')}${j.model ? ' · ' + esc(String(j.model).split('/').pop()) : ''}`; setBtns(false, true); }
      else if (s === 'loading') { eng.className = 'pill warn'; eng.textContent = `${nm}: loading model…`; setBtns(false, true); }
      else if (s === 'error') { eng.className = 'pill err'; eng.textContent = `${nm}: error — see ${dir}/server.log`; setBtns(true, true); }
      else { eng.className = 'pill ' + (j && j.installed ? 'warn' : 'err'); eng.textContent = j && j.installed ? `${nm}: offline` : `${nm}: not installed`; setBtns(!!(j && j.installed), false); }
      return s;
    }
    async function pollEngine(times) {
      let j = null;
      try { j = await api('/api/voice/status?engine=' + neuralEngine()); } catch {}
      const s = paintEngine(j);
      if (times > 0 && (s === 'loading' || s === 'offline') && container.isConnected) {
        setTimeout(() => pollEngine(times - 1), 2500);
      }
    }
    pollEngine(0);
    startBtn.onclick = async () => {
      const nm = neuralEngine();
      eng.className = 'pill warn'; eng.textContent = nm + ': starting…'; startBtn.classList.add('hidden');
      try {
        const r = await api('/api/voice/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: nm }) });
        if (r.error) { eng.className = 'pill err'; eng.textContent = nm + ': ' + r.error.slice(0, 80); return; }
      } catch (e) { eng.className = 'pill err'; eng.textContent = nm + ': start failed'; return; }
      pollEngine(20); // follow it through loading → ready
    };
    stopBtn.onclick = async () => {
      const nm = neuralEngine();
      stopSpeak(); // don't leave a half-spoken reply hanging when the engine dies
      eng.className = 'pill warn'; eng.textContent = nm + ': stopping…'; setBtns(false, false);
      try {
        const r = await api('/api/voice/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: nm }) });
        if (r.error) { eng.className = 'pill err'; eng.textContent = nm + ': ' + r.error.slice(0, 80); setBtns(true, true); return; }
      } catch (e) { eng.className = 'pill err'; eng.textContent = nm + ': stop failed'; setBtns(true, true); return; }
      setTimeout(() => pollEngine(4), 700); // give the port a moment to free, then confirm offline
    };

    // Test = one real /api/voice/tts round-trip against the selected neural engine
    container.querySelector('#vCsmTest').onclick = () => {
      const cs = container.querySelector('#vCsmStat');
      const nm = neuralEngine();
      cs.style.display = ''; cs.className = 'pill neutral'; cs.textContent = 'generating… (first call can take a while)';
      stopSpeak();
      const probe = csmFetch('Local voice check. If you can hear this, the ' + nm + ' engine is working.', nm);
      probe.then(blob => {
          cs.className = 'pill ok'; cs.textContent = 'reachable — playing';
          return playBlob(blob, () => { if (V.state === 'speaking') setState('idle'); });
        })
        .catch(err => { cs.className = 'pill err'; cs.textContent = 'unreachable: ' + String((err && err.message) || err).slice(0, 90); });
    };

    // Open the selected engine's voice folder (model + voice embeddings) in Explorer.
    container.querySelector('#vVoiceFolder').onclick = async () => {
      const cs = container.querySelector('#vCsmStat');
      const nm = neuralEngine();
      try {
        const r = await api('/api/voice/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: nm }) });
        if (r && r.error) { cs.style.display = ''; cs.className = 'pill err'; cs.textContent = r.error.slice(0, 90); }
      } catch (e) { cs.style.display = ''; cs.className = 'pill err'; cs.textContent = 'could not open folder'; }
    };

    // ---- live microphone diagnostics ----
    const stat = container.querySelector('#vMicStat');
    const why = container.querySelector('#vMicWhy');
    function setStat(txt, cls, detail) {
      if (!stat) return;
      stat.textContent = txt; stat.className = 'pill ' + cls;
      if (why) { why.style.display = detail ? '' : 'none'; why.textContent = detail || ''; }
    }
    (async function refreshMicStat() {
      const blocked = micBlockReason();
      if (blocked) { setStat('unavailable', 'err', blocked); return; }
      let state = '';
      try { if (navigator.permissions) state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
      if (state === 'granted') setStat('ready · permission granted', 'ok', '');
      else if (state === 'denied') setStat('permission denied', 'err', 'Click the 🔒/mic icon in the address bar → Allow, then check Windows Settings → Privacy → Microphone. Or use the Test button below.');
      else setStat('ready · click Test to grant', 'warn', 'Chrome/Edge will only prompt for the mic on a click — use the Test button, then Allow.');
    })();
    container.querySelector('#vMicTest').onclick = async () => {
      const blocked = micBlockReason();
      if (blocked) { setStat('unavailable', 'err', blocked); return; }
      setStat('requesting…', 'neutral', '');
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop()); // we only wanted the permission grant
        setStat('ready · permission granted', 'ok', 'Mic works. Tap the header orb (or press V) to talk; long-press for a hands-free call.');
      } catch (err) {
        const n = err && err.name;
        setStat('blocked', 'err',
          n === 'NotAllowedError' ? 'You (or Windows) denied the mic. Allow it via the address-bar 🔒 icon AND Windows Settings → Privacy → Microphone (turn on both "Let apps…" and "Let desktop apps…").'
          : n === 'NotFoundError' ? 'No microphone device found — plug one in / enable it in Windows Sound settings.'
          : 'Could not open the mic: ' + (n || 'unknown error') + '.');
      }
    };
  }

  // Kill switch lives in voice.js (VOICE_DISABLED) — when set, its own
  // renderSettings already shows a "disabled" note; don't clobber it.
  if (window.HubVoice && !window.HubVoice._disabled) window.HubVoice.renderSettings = renderSettings;
})();
