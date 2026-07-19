/* Jarvis tab — file attach for the in-tab chat composer. Same inbox upload
   path as the Run tab's attachFiles (assets/run.js): paste/drop/pick →
   POST /api/files?project=pasted&overwrite=1 → refs held here until send,
   which reads them via jarvisAttach.pending() and passes them as the run
   payload's images/files. Chips render above the composer (#jattachStrip,
   reusing style.css's .attachstrip/.attachchip). Split out of jarvischat.js
   to keep both files under the 500-line project cap. */
'use strict';
(function () {
  let pendingFiles = [];

  function renderStrip() {
    const el = $('#jattachStrip'); if (!el) return;
    el.classList.toggle('hidden', !pendingFiles.length);
    el.innerHTML = pendingFiles.map((c, i) => c.isImage
      ? `<span class="attachchip${c.pending ? ' pending' : ''}"><img src="${c.url}" alt="">`
        + `<button class="x" onclick="jarvisAttach.remove(${i})" title="remove">✕</button></span>`
      : `<span class="attachchip file${c.pending ? ' pending' : ''}" title="${esc(c.name)}">`
        + `<span class="ficon">📄</span><span class="fname">${esc(c.name)}</span>`
        + `<button class="x" onclick="jarvisAttach.remove(${i})" title="remove">✕</button></span>`).join('');
  }
  function removeAt(i) {
    const c = pendingFiles[i];
    if (c) { try { if (c.url) URL.revokeObjectURL(c.url); } catch {} pendingFiles.splice(i, 1); }
    renderStrip();
  }
  function failMsg(text) {
    const feed = $('#jconv'); if (!feed) return;
    const d = document.createElement('div');
    d.className = 'jmsg-meta'; d.style.cssText = 'padding:4px;color:var(--red)';
    d.textContent = '✗ ' + text;
    feed.appendChild(d);
    feed.scrollTop = feed.scrollHeight;
  }
  async function attach(files) {
    for (const file of files) {
      const isImage = (file.type || '').startsWith('image/');
      const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e4);
      const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
      const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
      const outName = isImage ? `paste-${stamp}.${ext}` : `${stamp}-${safe}`;
      const named = new File([file], outName, { type: file.type || 'application/octet-stream' });
      const fd = new FormData(); fd.append('file', named);
      const chip = { name: file.name || outName, url: isImage ? URL.createObjectURL(file) : null, ref: null, pending: true, isImage };
      pendingFiles.push(chip);
      renderStrip();
      try {
        const r = await api('/api/files?project=pasted&overwrite=1', { method: 'POST', body: fd, timeoutMs: 120000 });
        const saved = r && r.saved && r.saved[0];
        const ref = saved && (saved.path || saved.name);
        if (ref) { chip.ref = ref; chip.pending = false; }
        else throw new Error((r && r.error) || 'upload failed');
      } catch (e) {
        pendingFiles = pendingFiles.filter(c => c !== chip);
        failMsg('attach failed: ' + (e.message || 'upload error'));
      }
      renderStrip();
    }
  }
  function wire() {
    const ta = $('#jchatIn'); if (!ta) return;
    // Paste: images arrive via clipboard `items` (screenshots have no File in
    // `.files`); any other pasted file is taken as-is so docs/PDFs attach too.
    ta.onpaste = e => {
      const cd = e.clipboardData; if (!cd) return;
      const imgs = [...(cd.items || [])].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      const docs = [...(cd.files || [])].filter(f => !f.type.startsWith('image/'));
      const all = [...imgs, ...docs];
      if (all.length) { e.preventDefault(); attach(all); }
    };
    const btn = $('#jattachBtn'); if (btn) btn.onclick = () => { const fi = $('#jfileIn'); if (fi) fi.click(); };
    const fi = $('#jfileIn'); if (fi) fi.onchange = e => { const f = [...(e.target.files || [])]; if (f.length) attach(f); e.target.value = ''; };
    const panel = ta.closest('.jconv-panel');
    if (panel) {
      panel.ondragover = e => { e.preventDefault(); panel.classList.add('drag'); };
      panel.ondragleave = () => panel.classList.remove('drag');
      panel.ondrop = e => {
        e.preventDefault(); panel.classList.remove('drag');
        const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
        if (files.length) attach(files);
      };
    }
    renderStrip();
  }
  window.jarvisAttach = {
    wire, remove: removeAt,
    pending: () => pendingFiles,
    clear: () => { pendingFiles = []; renderStrip(); },
  };
})();
