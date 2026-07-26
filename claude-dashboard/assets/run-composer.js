/* Run tab — composer: pasted/dropped/picked attachments + the send flow
   (Jarvis distill/route pre-pass, POST /api/run, first bubbles). Split from
   run.js to keep both files under the repo's 500-line cap, per the
   runhistory.js pattern: plain top-level functions sharing app.js/run.js
   globals (api, $, esc, chat, runProject, addMsg, addEl, attachLiveRun,
   jarvisDistill/jarvisTransform/analyzePromptComplexity, HubVoice). MUST
   load right after run.js — `chat` is declared there. The bare globals stay
   canonical: run.js's ensureRunUI wires #sendBtn/paste/drop to them, and
   jarvistab.js + voiceconvo.js call `sendPrompt` guarded by typeof. */
'use strict';

// ---- pasted/dropped/picked attachments (images + documents) ----
// Uploaded to data/inbox/pasted/ so the run can reference their absolute paths;
// held here until the next Send, then cleared. Images keep a thumbnail; other
// files show as a named chip. The run engine tells Claude to Read each path.
chat.pendingFiles = [];
async function attachFiles(files) {
  for (const file of files) {
    const isImage = (file.type || '').startsWith('image/');
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e4);
    // Keep a readable, sanitized name for non-images; stamp-prefix so repeat
    // names don't collide in the shared pasted/ folder.
    const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
    const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const outName = isImage ? `paste-${stamp}.${ext}` : `${stamp}-${safe}`;
    const named = new File([file], outName, { type: file.type || 'application/octet-stream' });
    const fd = new FormData(); fd.append('file', named);
    const chip = { name: file.name || outName, url: isImage ? URL.createObjectURL(file) : null, ref: null, pending: true, isImage };
    chat.pendingFiles.push(chip);
    renderAttachStrip();
    try {
      const r = await api('/api/files?project=pasted&overwrite=1', { method: 'POST', body: fd, timeoutMs: 120000 });
      const saved = r && r.saved && r.saved[0];
      // ref = absolute path when the server sends it, else the inbox-relative
      // name (older servers). Either form the run engine resolves under the inbox.
      const ref = saved && (saved.path || saved.name);
      if (ref) { chip.ref = ref; chip.pending = false; }
      else throw new Error((r && r.error) || 'upload failed');
    } catch (e) {
      chat.pendingFiles = chat.pendingFiles.filter(c => c !== chip);
      addMsg('Attach failed: ' + (e.message || 'upload error'), 'errmsg');
    }
    renderAttachStrip();
  }
}
function removeFile(i) {
  const c = chat.pendingFiles[i];
  if (c) { try { if (c.url) URL.revokeObjectURL(c.url); } catch {} chat.pendingFiles.splice(i, 1); }
  renderAttachStrip();
}
function renderAttachStrip() {
  const el = $('#attachStrip'); if (!el) return;
  const items = chat.pendingFiles;
  el.classList.toggle('hidden', !items.length);
  el.innerHTML = items.map((c, i) => c.isImage
    ? `<span class="attachchip${c.pending ? ' pending' : ''}"><img src="${c.url}" alt="">`
      + `<button class="x" onclick="removeFile(${i})" title="remove">✕</button></span>`
    : `<span class="attachchip file${c.pending ? ' pending' : ''}" title="${esc(c.name)}">`
      + `<span class="ficon">📄</span><span class="fname">${esc(c.name)}</span>`
      + `<button class="x" onclick="removeFile(${i})" title="remove">✕</button></span>`).join('');
}

// ---- send flow ----
async function sendPrompt() {
  const ta = $('#promptIn');
  let prompt = ta.value.trim();
  if (chat.running || chat.sending) return; // sending = mid-distill (async gap below)
  // Attachments: block while any is still uploading; allow an attachment-only
  // send by supplying a default instruction.
  if (chat.pendingFiles.some(c => c.pending)) { addMsg('Still uploading an attachment — try again in a moment.', 'sys'); return; }
  const atts = chat.pendingFiles.filter(c => c.ref);
  const imgs = atts.filter(c => c.isImage);
  const docs = atts.filter(c => !c.isImage);
  if (!prompt && !atts.length) return;
  if (!prompt && atts.length) {
    const noun = imgs.length && !docs.length ? ('image' + (imgs.length > 1 ? 's' : '')) : ('file' + (atts.length > 1 ? 's' : ''));
    prompt = 'Take a look at the attached ' + noun + '.';
  }
  const engine = $('#runEngine') ? $('#runEngine').value : 'claude';

  // Jarvis mode: buffer prompt + auto-route model. When Jarvis rewrites the
  // prompt we show YOUR words in the user bubble and, right under it, a note
  // with the exact distilled prompt Jarvis actually sent. That note is a 'sys'
  // line — the ONE Jarvis-authored output that is shown but never spoken (the
  // voice queue only ever reads assistant text + the final reply, never 'sys').
  // Jarvis mode. QoL: the refined prompt BECOMES the visible turn (white text) —
  // no separate raw-words bubble + yellow note. And a word-count gate decides how
  // hard to work: long vibe-dumps go through the real Haiku distiller; short ones
  // get only the instant local cleanup (nothing to engineer, no point paying the
  // latency). The distilled/cleaned text is exactly what runs, so what you see is
  // what fires.
  let displayPrompt = prompt;
  const jarvisToggle = $('#jarvisToggle');
  if (jarvisToggle && jarvisToggle.checked && engine === 'claude') {
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    if (wordCount > DISTILL_MIN_WORDS) {
      // Haiku pre-pass takes a couple seconds — show a status + block re-sends.
      const btn = $('#sendBtn'), label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '✦ Shaping…'; }
      chat.sending = true;
      const refined = await jarvisDistill(prompt);
      chat.sending = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (chat.running) return; // a run slipped in while we were distilling
      if (refined) { displayPrompt = prompt = refined; }
      else { const tr = jarvisTransform(prompt); if (tr) displayPrompt = prompt = tr.buffered; } // distill miss → local cleanup
    } else {
      const tr = jarvisTransform(prompt); if (tr) displayPrompt = prompt = tr.buffered;
    }
    // If the user hasn't pinned a model, route on the (now refined) prompt.
    const userModel = $('#runModel').value;
    if (userModel === 'auto' || userModel === '') $('#runModel').value = analyzePromptComplexity(prompt);
  }

  let r;
  try {
    // Run tab is the 'screen' channel — EXCEPT when voiceconvo routed a voice
    // turn through this send (reply will be spoken aloud), where the TTS-shaped
    // 'spoken' contract applies instead.
    const channel = (window.HubVoice && HubVoice._voiceTurn && HubVoice._voiceTurn()) ? 'spoken' : 'screen';
    r = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, engine, model: $('#runModel').value, permissionMode: $('#runPerm').value,
        effort: $('#runEffort').value, channel,
        resume: engine === 'hermes' ? '' : (chat.sessionId || ''), recall: $('#runRecall').checked,
        projectId: (runProject && runProject.id) || '', images: imgs.map(c => c.ref), files: docs.map(c => c.ref) }) });
  } catch (e) { addMsg('Run failed to start: ' + (e.message || 'network error'), 'errmsg'); return; }
  if (r.error) { addMsg(r.error, 'errmsg'); return; }
  ta.value = '';
  addMsg(displayPrompt, 'user');
  if (atts.length) {
    if (imgs.length) addEl(imgs.map(c => `<img src="${c.url}" alt="attached image">`).join(''), 'msg user attachimgs');
    if (docs.length) addMsg('📎 ' + docs.map(c => c.name).join(', '), 'sys');
    chat.pendingFiles = []; renderAttachStrip();
  }
  chat.hermesEl = null; chat.hermesText = ''; // fresh bubble per hermes reply
  attachLiveRun(r.id, { startedAtMs: Date.now(), queued: r.queued });
  if (window.HubVoice) HubVoice.onRunStart();
}

// Namespace mirror per the jarvissoul.js convention for guarded callers; the
// bare globals above remain the canonical entry points (removeFile must stay
// global for the attach-chip inline onclick).
window.runComposer = { sendPrompt, attachFiles, removeFile, renderAttachStrip };
