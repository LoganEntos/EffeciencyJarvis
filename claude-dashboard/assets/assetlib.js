/* Assets tab: the local website-creation library (vendor/) — fonts, icon sets,
   background patterns, CSS foundations vendored from permissive open-source
   projects. Every hub run is told about these files (run hint) so generated
   pages use local assets instead of CDNs. Icon sets are manifest-driven: any
   type:icons entry with a sibling <base>-index.json shows up automatically.
   Click a font / icon / pattern to copy a ready-to-paste snippet. */
'use strict';

let assetData = null;
let iconFilter = '';
let iconSet = null;    // active icon set key (lucide/tabler/bootstrap/pixelart/…)
let patSize = 'md';    // active pattern size (sm/md/lg/xl)
let setSort = 'name';  // how the set toggle is ordered: name | count | size
let iconSort = 'az';   // icon order within a set: az | za

const SEL_STYLE = 'background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:3px;padding:4px 8px;font-size:12px;cursor:pointer';

// the icon sets ordered by the active set-sort
function sortedSets() {
  const sets = [...(assetData.iconSets || [])];
  if (setSort === 'count') sets.sort((a, b) => b.count - a.count);
  else if (setSort === 'size') sets.sort((a, b) => b.bytes - a.bytes);
  else sets.sort((a, b) => a.label.localeCompare(b.label));
  return sets;
}

// curated pattern.css base classes shown in the browser (each × the size toggle)
const PATTERN_BASES = ['dots', 'grid', 'checks', 'cross-dots', 'diagonal-lines', 'vertical-lines',
  'horizontal-lines', 'diagonal-stripes', 'vertical-stripes', 'horizontal-stripes', 'triangles', 'zigzag'];

// icon sets keyed by key, built from the manifest (server: /api/assets.iconSets)
function SETS() {
  const m = {};
  for (const s of (assetData.iconSets || [])) m[s.key] = { ...s, sprite: '/vendor/' + s.file };
  return m;
}

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
  const sets = assetData.iconSets || [];
  if (!iconSet || !sets.find(s => s.key === iconSet)) iconSet = sets[0] ? sets[0].key : null;
  const hasPatterns = css.some(c => c.file.includes('pattern'));
  const totalIcons = sets.reduce((n, s) => n + s.count, 0);
  const totalMb = (items.reduce((s, i) => s + (i.bytes || 0), 0) / 1024 / 1024).toFixed(2);
  const sub = t => `<span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${t}</span>`;
  const jump = (id, label) => `<button class="pill neutral" data-jump="${id}" style="cursor:pointer">${label}</button>`;

  el.innerHTML = `
    <h2>Assets — local website-creation library ${sub('— served at /vendor/, auto-advertised to every run')}</h2>
    <div class="assetNav flex" style="position:sticky;top:0;z-index:5;gap:6px;padding:8px 0;margin-bottom:4px;background:var(--bg);flex-wrap:wrap">
      ${jump('a-fonts', `✎ Fonts · ${fonts.length}`)}
      ${jump('a-icons', `◇ Icons · ${totalIcons.toLocaleString()}`)}
      ${hasPatterns ? jump('a-patterns', `▦ Patterns · ${PATTERN_BASES.length}`) : ''}
      ${jump('a-css', `{} CSS · ${css.length}`)}
    </div>
    <div class="cards">
      <div class="card"><div class="n">${fonts.length}</div><div class="l">Font faces</div></div>
      <div class="card"><div class="n">${totalIcons.toLocaleString()}</div><div class="l">Icons · ${sets.length} sets</div></div>
      <div class="card"><div class="n">${hasPatterns ? PATTERN_BASES.length : 0}</div><div class="l">Patterns</div></div>
      <div class="card"><div class="n">${totalMb}</div><div class="l">MB on disk</div></div>
    </div>
    <div class="note">Everything below is vendored locally (sources + licenses in <span class="mono">vendor/manifest.json</span>) —
      runs and artifacts load it from <span class="mono">/vendor/</span> with no CDN, no network. Click any font, icon, or pattern to copy a snippet.</div>

    <h2 id="a-fonts">Fonts ${sub('— click to copy the font-family CSS')}</h2>
    <div id="fontList">${fonts.map(fontRow).join('')}</div>

    <h2 id="a-icons" style="margin-top:28px">Icons ${sub('— pick a set, search, click to copy the &lt;svg&gt; snippet')}</h2>
    <div class="flex" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div class="flex" id="iconSetToggle" style="gap:6px;flex-wrap:wrap"></div>
      <label class="muted" style="font-size:11px;white-space:nowrap">sort sets
        <select id="setSort" style="${SEL_STYLE}">
          <option value="name"${setSort === 'name' ? ' selected' : ''}>name</option>
          <option value="count"${setSort === 'count' ? ' selected' : ''}>count</option>
          <option value="size"${setSort === 'size' ? ' selected' : ''}>size</option>
        </select></label>
    </div>
    <div class="flex" style="gap:8px;align-items:center">
      <input class="search" id="iconSearch" placeholder="Search this set… (e.g. arrow, chart, brain)" style="flex:1">
      <select id="iconSort" aria-label="Icon sort order" style="${SEL_STYLE}">
        <option value="az"${iconSort === 'az' ? ' selected' : ''}>A→Z</option>
        <option value="za"${iconSort === 'za' ? ' selected' : ''}>Z→A</option>
      </select>
    </div>
    <div class="muted" id="iconCount" style="font-size:11px;margin:6px 0"></div>
    <div class="iconGrid" id="iconGrid"></div>

    ${hasPatterns ? `<h2 id="a-patterns" style="margin-top:28px">Background patterns ${sub('— pattern.css · tinted by currentColor · click to copy')}</h2>
    <div class="flex" id="patSizeToggle" style="gap:6px;margin-bottom:10px">
      ${['sm', 'md', 'lg', 'xl'].map(s => `<button class="pill ${s === patSize ? 'ok' : 'neutral'}" data-size="${s}" aria-pressed="${s === patSize}" style="cursor:pointer">${s}</button>`).join('')}
    </div>
    <div class="iconGrid" id="patternGrid"></div>` : ''}

    <h2 id="a-css" style="margin-top:28px">CSS foundations</h2>
    ${css.map(c => `<div class="row"><div class="flex" style="justify-content:space-between">
      <span class="name mono">/vendor/${esc(c.file)}</span>
      <span class="muted" style="font-size:11px">${esc(c.role)} · ${esc(c.license)} · ${Math.round((c.bytes || 0) / 1024)} KB</span></div></div>`).join('')}`;

  // wire — jump nav
  el.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
    const t = $('#' + b.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // fonts
  $('#fontList').querySelectorAll('[data-copy]').forEach(r => r.onclick = () => copySnippet(r.dataset.copy, r));
  // icon search + set toggle + sort controls
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  $('#iconSearch').oninput = debounce(e => { iconFilter = e.target.value.trim().toLowerCase(); drawIcons(); }, 150);
  $('#setSort').onchange = e => { setSort = e.target.value; renderSetPills(); };
  $('#iconSort').onchange = e => { iconSort = e.target.value; drawIcons(); };
  renderSetPills();
  // patterns
  if (hasPatterns) {
    $('#patSizeToggle').querySelectorAll('[data-size]').forEach(b => b.onclick = () => {
      patSize = b.dataset.size;
      $('#patSizeToggle').querySelectorAll('[data-size]').forEach(x => { const on = x.dataset.size === patSize; x.className = 'pill ' + (on ? 'ok' : 'neutral'); x.setAttribute('aria-pressed', on); });
      drawPatterns();
    });
    drawPatterns();
  }
  await inlineSprite();
  drawIcons();
};

function setPill(s) {
  const on = s.key === iconSet;
  return `<button class="pill ${on ? 'ok' : 'neutral'}" data-set="${esc(s.key)}" aria-pressed="${on}" title="${esc(s.style || '')} · ${esc(s.license)}" style="cursor:pointer">${esc(s.label)} · ${s.count.toLocaleString()}</button>`;
}
// (re)build the set toggle in the current sort order and wire clicks
function renderSetPills() {
  const wrap = $('#iconSetToggle');
  if (!wrap) return;
  wrap.innerHTML = sortedSets().map(setPill).join('');
  wrap.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
    if (iconSet === b.dataset.set) return;
    iconSet = b.dataset.set;
    wrap.querySelectorAll('[data-set]').forEach(setPillState);
    await inlineSprite(); drawIcons();
  });
}
function setPillState(x) {
  const on = x.dataset.set === iconSet;
  x.className = 'pill ' + (on ? 'ok' : 'neutral');
  x.setAttribute('aria-pressed', on);
}

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
const spriteCache = {}; // set key -> { id -> "<symbol …>…</symbol>" }
async function inlineSprite() {
  const set = SETS()[iconSet];
  if (!set || spriteCache[iconSet]) return;
  try {
    const txt = await (await fetch(set.sprite)).text();
    const map = {};
    for (const m of txt.matchAll(/<symbol[^>]*\bid="([^"]+)"[\s\S]*?<\/symbol>/g)) map[m[1]] = m[0];
    spriteCache[iconSet] = map;
  } catch { spriteCache[iconSet] = {}; }
}
function injectSymbols(names) {
  let holder = $('#spriteHolder');
  if (!holder) {
    document.body.insertAdjacentHTML('beforeend', '<svg id="spriteHolder" style="display:none" xmlns="http://www.w3.org/2000/svg"></svg>');
    holder = $('#spriteHolder');
  }
  const map = spriteCache[iconSet] || {};
  holder.innerHTML = names.map(n => map[n] || '').join('');
}

function drawIcons() {
  const grid = $('#iconGrid');
  const set = SETS()[iconSet];
  const map = spriteCache[iconSet];
  if (!grid || !set || !map) return;
  const all = set.names;
  const hits = (iconFilter ? all.filter(n => n.includes(iconFilter)) : all.slice()).sort();
  if (iconSort === 'za') hits.reverse();
  const show = hits.slice(0, 120);
  injectSymbols(show.map(n => set.pfx + n)); // symbol ids carry the set prefix
  const cnt = $('#iconCount');
  const noun = iconFilter ? (hits.length === 1 ? 'match' : 'matches') : (hits.length === 1 ? 'icon' : 'icons');
  if (cnt) cnt.textContent = `${set.label}: ${hits.length.toLocaleString()} ${noun}${hits.length > show.length ? ` · showing ${show.length}` : ''} · ${esc(set.license)}`;
  grid.innerHTML = show.map(n => `
    <div class="iconCell" data-icon="${esc(n)}" title="${esc(n)} — click to copy">
      <svg width="22" height="22"><use href="#${esc(set.pfx + n)}"/></svg><span>${esc(n)}</span>
    </div>`).join('') || '<div class="muted">No icons match.</div>';
  grid.querySelectorAll('.iconCell').forEach(c => c.onclick = () =>
    copySnippet(`<svg width="24" height="24"><use href="${set.sprite}#${set.pfx + c.dataset.icon}"/></svg>`, c));
}

function drawPatterns() {
  const grid = $('#patternGrid');
  if (!grid) return;
  grid.innerHTML = PATTERN_BASES.map(base => {
    const cls = `pattern-${base}-${patSize}`;
    return `<div class="iconCell" data-pattern="${cls}" title="${esc(cls)} — click to copy">
      <div class="${cls}" style="width:100%;height:44px;color:var(--accent);background-color:var(--panel);border-radius:3px"></div>
      <span>${esc(base)}</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-pattern]').forEach(c => c.onclick = () =>
    copySnippet(`<!-- link once: <link rel="stylesheet" href="/vendor/css/pattern.min.css"> -->\n<div class="${c.dataset.pattern}" style="color:currentColor"></div>`, c));
}

async function copySnippet(text, el) {
  try { await navigator.clipboard.writeText(text); } catch { return alert(text); }
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 600);
}
