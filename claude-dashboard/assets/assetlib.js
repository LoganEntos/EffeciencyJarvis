/* Assets tab: the local website-creation library (vendor/) — fonts, icons,
   CSS foundations vendored from trusted open-source projects. Every hub run
   is told about these files (run hint) so generated pages use local assets
   instead of CDNs. Click a font/icon to copy a ready-to-paste snippet. */
'use strict';

let assetData = null;
let iconFilter = '';
let iconSet = 'lucide';
// the vendored icon sprites; tabler symbol ids carry a "tabler-" prefix, lucide's don't
const ICONSETS = () => ({
  lucide: { label: 'Lucide', names: assetData.iconIndex || [], sprite: '/vendor/icons/lucide-sprite.svg', pfx: '' },
  tabler: { label: 'Tabler', names: assetData.tablerIndex || [], sprite: '/vendor/icons/tabler-sprite.svg', pfx: 'tabler-' },
});

// pattern.css preview swatches — a representative slice of its .pattern-* classes
const PATTERN_SWATCHES = ['pattern-dots-md', 'pattern-grid-md', 'pattern-checks-md', 'pattern-cross-dots-md', 'pattern-diagonal-lines-md', 'pattern-diagonal-stripes-md', 'pattern-horizontal-lines-md', 'pattern-triangles-md'];

renderers.assets = async function () {
  assetData = await api('/api/assets');
  const el = $('#assets');
  if (!assetData.exists) {
    el.innerHTML = `<h2>Assets</h2><div class="note">No vendor library found — expected <span class="mono">claude-dashboard/vendor/manifest.json</span>.</div>`;
    return;
  }
  ensurePatternCss();
  const items = assetData.items;
  const fonts = items.filter(i => i.type === 'font');
  const css = items.filter(i => i.type === 'css');
  const hasPatterns = css.some(c => c.file.includes('pattern'));
  const totalIcons = (assetData.iconIndex || []).length + (assetData.tablerIndex || []).length;
  const totalMb = (items.reduce((s, i) => s + (i.bytes || 0), 0) / 1024 / 1024).toFixed(2);
  el.innerHTML = `
    <h2>Assets — local website-creation library <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— served at /vendor/, auto-advertised to every run</span></h2>
    <div class="cards">
      <div class="card"><div class="n">${fonts.length}</div><div class="l">Font faces</div></div>
      <div class="card"><div class="n">${totalIcons.toLocaleString()}</div><div class="l">Icons (Lucide + Tabler)</div></div>
      <div class="card"><div class="n">${css.length}</div><div class="l">CSS foundations</div></div>
      <div class="card"><div class="n">${totalMb}</div><div class="l">MB on disk</div></div>
    </div>
    <div class="note">Everything below is vendored locally (sources + licenses in <span class="mono">vendor/manifest.json</span>) —
      runs and artifacts load it from <span class="mono">/vendor/</span> with no CDN, no network. Click any font, icon, or pattern to copy a snippet.</div>
    <h2>Fonts <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to copy the font-family CSS</span></h2>
    <div id="fontList">${fonts.map(fontRow).join('')}</div>
    <h2 style="margin-top:28px">Icons <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— click to copy the &lt;svg&gt; snippet</span></h2>
    <div class="flex" id="iconSetToggle" style="gap:6px;margin-bottom:8px">
      ${Object.entries(ICONSETS()).map(([k, s]) => `<button class="pill ${k === iconSet ? 'ok' : 'neutral'}" data-set="${k}" aria-pressed="${k === iconSet}" style="cursor:pointer">${s.label} · ${s.names.length.toLocaleString()}</button>`).join('')}
    </div>
    <input class="search" id="iconSearch" placeholder="Search icons… (e.g. arrow, chart, brain)">
    <div class="iconGrid" id="iconGrid"></div>
    ${hasPatterns ? `<h2 style="margin-top:28px">Background patterns <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— pattern.css · click to copy the class</span></h2>
    <div class="iconGrid" id="patternGrid">${PATTERN_SWATCHES.map(p => `
      <div class="iconCell" data-pattern="${p}" title="${esc(p)} — click to copy">
        <div class="${p}" style="width:100%;height:44px;color:var(--accent);background-color:var(--panel);border-radius:3px"></div>
        <span>${esc(p.replace('-md', ''))}</span>
      </div>`).join('')}</div>` : ''}
    <h2 style="margin-top:28px">CSS foundations</h2>
    ${css.map(c => `<div class="row"><div class="flex" style="justify-content:space-between">
      <span class="name mono">/vendor/${esc(c.file)}</span>
      <span class="muted" style="font-size:11px">${esc(c.role)} · ${esc(c.license)} · ${Math.round((c.bytes || 0) / 1024)} KB</span></div></div>`).join('')}`;
  $('#fontList').querySelectorAll('[data-copy]').forEach(r => r.onclick = () => copySnippet(r.dataset.copy, r));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#iconSearch').oninput = debounce(e => { iconFilter = e.target.value.trim().toLowerCase(); drawIcons(); }, 150);
  $('#iconSetToggle').querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
    if (iconSet === b.dataset.set) return;
    iconSet = b.dataset.set;
    $('#iconSetToggle').querySelectorAll('[data-set]').forEach(x => { const on = x.dataset.set === iconSet; x.className = 'pill ' + (on ? 'ok' : 'neutral'); x.setAttribute('aria-pressed', on); });
    await inlineSprite();
    drawIcons();
  });
  if (hasPatterns) $('#patternGrid').querySelectorAll('[data-pattern]').forEach(c =>
    c.onclick = () => copySnippet(`<!-- link once: <link rel="stylesheet" href="/vendor/css/pattern.min.css"> -->\n<div class="${c.dataset.pattern}" style="color:currentColor"></div>`, c));
  await inlineSprite();
  drawIcons();
};

// load pattern.css into the dashboard once so the preview swatches render
function ensurePatternCss() {
  if ($('#patternCssLink')) return;
  const l = document.createElement('link');
  l.id = 'patternCssLink'; l.rel = 'stylesheet'; l.href = '/vendor/css/pattern.min.css';
  document.head.appendChild(l);
}

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

// Chrome can't <use> a cross-document sprite, and inlining all symbols hangs the
// compositor — keep each sprite's text in memory (cached per set) and inject ONLY
// the symbols currently on screen into one small hidden <svg>.
const spriteCache = {}; // set -> { id -> "<symbol …>…</symbol>" }
async function inlineSprite() {
  const set = ICONSETS()[iconSet];
  if (spriteCache[iconSet]) return;
  try {
    const txt = await (await fetch(set.sprite)).text();
    const map = {};
    for (const m of txt.matchAll(/<symbol[^>]*id="([^"]+)"[\s\S]*?<\/symbol>/g)) map[m[1]] = m[0];
    spriteCache[iconSet] = map;
  } catch { spriteCache[iconSet] = {}; }
}
function injectSymbols(names) {
  let holder = $('#spriteHolder');
  if (!holder) {
    holder = document.createElement('svg');
    document.body.insertAdjacentHTML('beforeend', '<svg id="spriteHolder" style="display:none" xmlns="http://www.w3.org/2000/svg"></svg>');
    holder = $('#spriteHolder');
  }
  const map = spriteCache[iconSet] || {};
  holder.innerHTML = names.map(n => map[n] || '').join('');
}

function drawIcons() {
  const grid = $('#iconGrid');
  const map = spriteCache[iconSet];
  if (!grid || !map) return;
  const set = ICONSETS()[iconSet];
  const all = set.names;
  const hits = iconFilter ? all.filter(n => n.includes(iconFilter)) : all;
  const show = hits.slice(0, 120);
  injectSymbols(show.map(n => set.pfx + n)); // symbol ids carry the set prefix
  grid.innerHTML = show.map(n => `
    <div class="iconCell" data-icon="${esc(n)}" title="${esc(n)} — click to copy">
      <svg width="22" height="22"><use href="#${esc(set.pfx + n)}"/></svg><span>${esc(n)}</span>
    </div>`).join('') || '<div class="muted">No icons match.</div>';
  if (hits.length > show.length) grid.innerHTML += `<div class="muted" style="align-self:center;font-size:11px">…${hits.length - show.length} more — refine the search</div>`;
  grid.querySelectorAll('.iconCell').forEach(c => c.onclick = () =>
    copySnippet(`<svg width="24" height="24"><use href="${set.sprite}#${set.pfx + c.dataset.icon}"/></svg>`, c));
}

async function copySnippet(text, el) {
  try { await navigator.clipboard.writeText(text); } catch { return alert(text); }
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 600);
}
