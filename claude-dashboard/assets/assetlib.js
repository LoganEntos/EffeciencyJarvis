/* Assets tab: the local website-creation library (vendor/) — fonts, icons,
   CSS foundations vendored from trusted open-source projects. Every hub run
   is told about these files (run hint) so generated pages use local assets
   instead of CDNs. Click a font/icon to copy a ready-to-paste snippet. */
'use strict';

let assetData = null;
let iconFilter = '';

renderers.assets = async function () {
  assetData = await api('/api/assets');
  const el = $('#assets');
  if (!assetData.exists) {
    el.innerHTML = `<h2>Assets</h2><div class="note">No vendor library found — expected <span class="mono">claude-dashboard/vendor/manifest.json</span>.</div>`;
    return;
  }
  const items = assetData.items;
  const fonts = items.filter(i => i.type === 'font');
  const css = items.filter(i => i.type === 'css');
  const totalMb = (items.reduce((s, i) => s + (i.bytes || 0), 0) / 1024 / 1024).toFixed(2);
  el.innerHTML = `
    <h2>Assets — local website-creation library <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— served at /vendor/, auto-advertised to every run</span></h2>
    <div class="cards">
      <div class="card"><div class="n">${fonts.length}</div><div class="l">Font faces</div></div>
      <div class="card"><div class="n">${assetData.iconIndex.length}</div><div class="l">Icons (Lucide)</div></div>
      <div class="card"><div class="n">${css.length}</div><div class="l">CSS foundations</div></div>
      <div class="card"><div class="n">${totalMb}</div><div class="l">MB on disk</div></div>
    </div>
    <div class="note">Everything below is vendored locally (sources + licenses in <span class="mono">vendor/manifest.json</span>) —
      runs and artifacts load it from <span class="mono">/vendor/</span> with no CDN, no network. Click any font or icon to copy a snippet.</div>
    <h2>Fonts <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to copy the font-family CSS</span></h2>
    <div id="fontList">${fonts.map(fontRow).join('')}</div>
    <h2 style="margin-top:28px">Icons <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to copy the &lt;svg&gt; snippet</span></h2>
    <input class="search" id="iconSearch" placeholder="Search ${assetData.iconIndex.length} icons… (e.g. arrow, chart, brain)">
    <div class="iconGrid" id="iconGrid"></div>
    <h2 style="margin-top:28px">CSS foundations</h2>
    ${css.map(c => `<div class="row"><div class="flex" style="justify-content:space-between">
      <span class="name mono">/vendor/${esc(c.file)}</span>
      <span class="muted" style="font-size:11px">${esc(c.role)} · ${esc(c.license)} · ${Math.round((c.bytes || 0) / 1024)} KB</span></div></div>`).join('')}`;
  $('#fontList').querySelectorAll('[data-copy]').forEach(r => r.onclick = () => copySnippet(r.dataset.copy, r));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#iconSearch').oninput = debounce(e => { iconFilter = e.target.value.trim().toLowerCase(); drawIcons(); }, 150);
  await inlineSprite();
  drawIcons();
};

// e.g. name "Fraunces 100 900" → family Fraunces, weights [100,900] (variable range)
function fontRow(f) {
  const parts = f.name.split(' ');
  const weights = parts.filter(p => /^\d+$/.test(p)).map(Number);
  const family = parts.filter(p => !/^\d+$/.test(p)).join(' ');
  const range = weights.length === 2 && f.file.includes('-' + weights[0] + '-');
  const w = range ? weights : [weights[0] || 400];
  const spec = w.map(x => `<span style="font-family:'${esc(family)}';font-weight:${x};font-size:22px">Sphinx of black quartz, judge my vow — ${x}</span>`).join('<br>');
  return `<div class="row clickable" data-copy="font-family:'${esc(family)}',sans-serif;${range ? `/* variable ${weights[0]}–${weights[1]} */` : `font-weight:${w[0]};`}">
    <div class="flex" style="justify-content:space-between">
      <span class="name mono">${esc(family)}</span>
      <span class="muted" style="font-size:11px">${range ? `variable ${weights[0]}–${weights[1]}` : 'wght ' + w.join(', ')} · ${esc(f.role)} · ${esc(f.license)}</span>
    </div>
    <div style="margin-top:8px;line-height:1.5">${spec}</div>
  </div>`;
}

// Chrome can't <use> a cross-document sprite, and inlining all 1700+ symbols
// hangs the compositor — keep the sprite text in memory and inject ONLY the
// symbols currently on screen into one small hidden <svg>.
let spriteSymbols = null; // name -> "<symbol …>…</symbol>"
async function inlineSprite() {
  if (spriteSymbols) return;
  try {
    const txt = await (await fetch('/vendor/icons/lucide-sprite.svg')).text();
    spriteSymbols = {};
    for (const m of txt.matchAll(/<symbol[^>]*id="([^"]+)"[\s\S]*?<\/symbol>/g)) spriteSymbols[m[1]] = m[0];
  } catch { spriteSymbols = {}; }
}
function injectSymbols(names) {
  let holder = $('#spriteHolder');
  if (!holder) {
    holder = document.createElement('svg');
    document.body.insertAdjacentHTML('beforeend', '<svg id="spriteHolder" style="display:none" xmlns="http://www.w3.org/2000/svg"></svg>');
    holder = $('#spriteHolder');
  }
  holder.innerHTML = names.map(n => spriteSymbols[n] || '').join('');
}

function drawIcons() {
  const grid = $('#iconGrid');
  if (!grid || !spriteSymbols) return;
  const all = assetData.iconIndex;
  const hits = iconFilter ? all.filter(n => n.includes(iconFilter)) : all;
  const show = hits.slice(0, 120);
  injectSymbols(show);
  grid.innerHTML = show.map(n => `
    <div class="iconCell" data-icon="${esc(n)}" title="${esc(n)} — click to copy">
      <svg width="22" height="22"><use href="#${esc(n)}"/></svg><span>${esc(n)}</span>
    </div>`).join('') || '<div class="muted">No icons match.</div>';
  if (hits.length > show.length) grid.innerHTML += `<div class="muted" style="align-self:center;font-size:11px">…${hits.length - show.length} more — refine the search</div>`;
  grid.querySelectorAll('.iconCell').forEach(c => c.onclick = () =>
    copySnippet(`<svg width="24" height="24"><use href="/vendor/icons/lucide-sprite.svg#${c.dataset.icon}"/></svg>`, c));
}

async function copySnippet(text, el) {
  try { await navigator.clipboard.writeText(text); } catch { return alert(text); }
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 600);
}
