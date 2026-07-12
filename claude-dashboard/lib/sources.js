/*
 * Sources library (roadmap N11): a single truthful list of EVERY external
 * open-source project the hub uses or references — with repo link, license,
 * and what it's used for. Data is collated, never hand-duplicated:
 *   - VENDORED assets come straight from vendor/manifest.json (fonts, icon
 *     sprites, css) and are enriched with their upstream GitHub repo via the
 *     repoMap in sources.json.
 *   - NON-VENDORED references (adapted skills, agent-tool siblings, and repos
 *     queued to incorporate) come from the curated list in sources.json — the
 *     one place to keep them, so the tab stays honest.
 *
 * Zero-dep, GET-only, no secrets. Pairs with the GitHub-intake team: new
 * intakes land in vendor/manifest.json (vendored) or sources.json (curated)
 * and surface here automatically.
 */
'use strict';
const path = require('path');
const U = require('./util');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'vendor', 'manifest.json');
const CURATED = path.join(__dirname, 'sources.json');

// Fold the per-weight font faces in the manifest ("Fraunces 100 900",
// "Newsreader 400", "Newsreader 700", …) down to one row per family.
function fontFamily(name) {
  return String(name || '').split(' ').filter(p => !/^\d+$/.test(p)).join(' ').trim();
}

// Build the vendored-asset rows from the manifest. fonts.css is generated
// locally (not an external project) so it's skipped.
function vendoredSources(repoMap) {
  const manifest = U.safeJson(MANIFEST);
  if (!manifest || !Array.isArray(manifest.items)) return [];
  const out = [];
  const fams = new Map(); // family -> merged font row

  for (const it of manifest.items) {
    if (it.type === 'css' && /fonts\.css$/.test(it.file)) continue; // generated locally

    if (it.type === 'font') {
      const fam = fontFamily(it.name) || it.name;
      const cur = fams.get(fam) || { faces: 0, bytes: 0, license: it.license, role: it.role, source: it.source };
      cur.faces += 1; cur.bytes += it.bytes || 0;
      fams.set(fam, cur);
      continue;
    }

    const base = path.basename(it.file || '');
    const repo = repoMap[it.label] || repoMap[base] || null;
    out.push({
      kind: 'vendored', type: it.type,
      name: it.label || it.name,
      repo, source: it.source || null,
      license: it.license || 'see repo', verified: true,
      status: 'active',
      usedFor: it.role || '', bytes: it.bytes || 0,
    });
  }

  for (const [fam, v] of fams) {
    out.push({
      kind: 'vendored', type: 'font', name: fam,
      repo: repoMap[fam] || null, source: v.source || null,
      license: v.license || 'OFL-1.1', verified: true, status: 'active',
      usedFor: v.role || 'display / body typeface',
      bytes: v.bytes, faces: v.faces,
    });
  }
  return out;
}

function collate() {
  const curated = U.safeJson(CURATED) || {};
  const repoMap = curated.repoMap || {};
  const vendored = vendoredSources(repoMap);
  const refs = (Array.isArray(curated.curated) ? curated.curated : []).map(c => ({
    kind: c.kind || 'tool', type: c.kind || 'ref',
    name: c.name, repo: c.repo || null, source: c.repo || null,
    license: c.license || 'see repo', verified: c.verified === true,
    status: c.status || 'active', usedFor: c.usedFor || '',
  }));

  const sources = vendored.concat(refs);
  const uniqueRepos = new Set(sources.map(s => s.repo).filter(Boolean)).size;
  const byKind = k => sources.filter(s => s.kind === k).length;

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      total: sources.length,
      vendored: byKind('vendored'),
      skill: byKind('skill'),
      tool: byKind('tool'),
      incorporate: byKind('incorporate'),
      repos: uniqueRepos,
    },
    sources,
  };
}

async function handle(req, res, url) {
  if (url.pathname === '/api/sources' && req.method === 'GET') {
    U.sendJson(res, collate());
    return true;
  }
  return false;
}

module.exports = { handle, collate };
