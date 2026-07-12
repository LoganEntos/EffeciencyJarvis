/* Sources tab (N11): every external open-source project the hub uses or
   references — repo link, license badge, and what it's used for. Data comes
   from /api/sources (vendor/manifest.json + lib/sources.json). Grouped by kind:
   vendored asset · adapted skill · agent tool · queued to incorporate. */
'use strict';

const SRC_GROUPS = [
  { kind: 'vendored', title: 'Vendored assets', sub: 'downloaded once into /vendor/ — fonts, icon sprites, CSS. No runtime CDN.' },
  { kind: 'skill', title: 'Adapted skills', sub: 'open-source skill libraries adapted into .claude/skills/.' },
  { kind: 'tool', title: 'Agent tools', sub: 'engines the hub drives — the Scrapling MCP, CSM voice, hermes (deprecated).' },
  { kind: 'incorporate', title: 'Queued to incorporate', sub: 'on the intake list — evaluate before wiring in.' },
];

// license → badge tone. Permissive/OFL = ok(amber-green), unknown = neutral.
function licenseBadge(s) {
  const lic = s.license || 'see repo';
  const known = /^(MIT|ISC|OFL|Apache|BSD|CC0)/i.test(lic);
  const tone = !known ? 'neutral' : 'ok';
  const flag = s.verified === false && known ? ' title="license not confirmed from the repo LICENSE — verify before relying on it"' : '';
  const mark = s.verified === false && known ? ' ?' : '';
  return `<span class="pill ${tone}"${flag} style="font-size:10px">${esc(lic)}${mark}</span>`;
}

function statusBadge(s) {
  if (s.status === 'deprecated') return '<span class="pill warn" style="font-size:10px">deprecated</span>';
  if (s.status === 'queued') return '<span class="pill neutral" style="font-size:10px">queued</span>';
  return '';
}

function sourceRow(s) {
  const title = s.repo
    ? `<a class="link mono" href="${esc(s.repo)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`
    : `<span class="name mono">${esc(s.name)}</span>`;
  const meta = [];
  if (s.type && s.kind === 'vendored') meta.push(esc(s.type));
  if (s.faces) meta.push(s.faces + ' face' + (s.faces === 1 ? '' : 's'));
  if (s.bytes) meta.push(Math.round(s.bytes / 1024) + ' KB');
  const metaStr = meta.length ? `<span class="muted" style="font-size:11px">${meta.join(' · ')}</span>` : '';
  return `<div class="row">
    <div class="flex" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="flex" style="gap:8px;align-items:center;flex-wrap:wrap">${title} ${licenseBadge(s)} ${statusBadge(s)}</span>
      ${metaStr}
    </div>
    ${s.usedFor ? `<div class="muted" style="font-size:12px;margin-top:5px;line-height:1.45">${esc(s.usedFor)}</div>` : ''}
    ${!s.repo && s.source ? `<div class="muted mono" style="font-size:10px;margin-top:4px;opacity:.7">${esc(s.source)}</div>` : ''}
  </div>`;
}

renderers.sources = async function () {
  const d = await api('/api/sources');
  const el = $('#sources');
  const c = d.counts || {};
  const sub = t => `<span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">${t}</span>`;

  const groups = SRC_GROUPS.map(g => {
    const rows = (d.sources || []).filter(s => s.kind === g.kind);
    if (!rows.length) return '';
    // vendored: fonts last, everything else (icons/css) first, each A→Z
    rows.sort((a, b) => {
      if (g.kind === 'vendored' && (a.type === 'font') !== (b.type === 'font')) return a.type === 'font' ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return `<h2 id="s-${g.kind}" style="margin-top:26px">${esc(g.title)} <span class="muted" style="font-size:13px">· ${rows.length}</span> ${sub('— ' + g.sub)}</h2>
      ${rows.map(sourceRow).join('')}`;
  }).join('');

  el.innerHTML = `
    <h2>Sources ${sub('— every external open-source project this hub uses or references')}</h2>
    <div class="cards">
      <div class="card"><div class="n">${c.repos || 0}</div><div class="l">Linked repos</div></div>
      <div class="card"><div class="n">${c.vendored || 0}</div><div class="l">Vendored</div></div>
      <div class="card"><div class="n">${(c.skill || 0) + (c.tool || 0)}</div><div class="l">Skills + tools</div></div>
      <div class="card"><div class="n">${c.incorporate || 0}</div><div class="l">Queued</div></div>
    </div>
    <div class="note">Provenance is collated, not hand-kept: vendored assets read from
      <span class="mono">vendor/manifest.json</span>, everything else from
      <span class="mono">lib/sources.json</span> — edit those to keep this truthful. Click a name to open the repo.
      A <span class="pill neutral" style="font-size:10px">?</span> on a license means it wasn't confirmed from the repo's LICENSE file.</div>
    ${groups}`;
};
