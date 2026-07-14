/*
 * SharePoint graphify prep — deterministic, zero-token.
 *
 * Reads the crawled index (claude-dashboard/data/sharepoint-index.json) and
 * emits a graphify-ready CORPUS: one markdown document per SharePoint site,
 * plus a 00-OVERVIEW.md backbone that becomes the graph's god-node layer.
 * Files are grouped by folder so graphify sees the real tree structure.
 *
 * This does NOT call any LLM — it just shapes the index into documents the
 * /graphify pipeline can ingest. The expensive extraction is left to the
 * hand-off run (see docs/sharepoint-graphify-master-prompt.md).
 *
 * Usage:  node scripts/sharepoint-graphify-prep.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'claude-dashboard', 'data', 'sharepoint-index.json');
const OUT = path.join(ROOT, 'claude-dashboard', 'data', 'sharepoint-graphify-corpus');

function human(bytes) {
  if (!bytes) return '0 B';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
const slug = s => (s || 'site').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'site';
const dirOf = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };

function main() {
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // ---- 00-OVERVIEW.md : the god-node backbone (sites → drives, with counts)
  let ov = `# SharePoint Corpus Overview\n\n`;
  ov += `Tenant snapshot built ${idx.builtAt}. This is the structural backbone of the\n`;
  ov += `entire SharePoint estate — every site and document library, with file counts.\n`;
  ov += `Each site has its own document in this corpus (see the per-site files).\n\n`;
  ov += `**Totals:** ${idx.counts.sites} sites · ${idx.counts.drives} libraries · `
      + `${idx.counts.files.toLocaleString()} files · ${idx.counts.folders.toLocaleString()} folders.\n\n`;
  for (const s of idx.sites) {
    ov += `## Site: ${s.name}\n\n`;
    ov += `- URL: ${s.webUrl}\n`;
    for (const d of s.drives) {
      ov += `- Library "${d.name}" — ${d.fileCount.toLocaleString()} files\n`;
    }
    ov += `\n`;
  }
  fs.writeFileSync(path.join(OUT, '00-OVERVIEW.md'), ov);

  // ---- one document per site : drives → folders → files
  let n = 1;
  const manifest = [];
  for (const s of idx.sites) {
    const fname = String(n).padStart(2, '0') + '-' + slug(s.name) + '.md';
    let md = `# ${s.name}\n\nSharePoint site: ${s.webUrl}\n\n`;
    let siteFiles = 0;
    for (const d of s.drives) {
      md += `## Library: ${d.name}\n\n`;
      md += `Document library with ${d.fileCount.toLocaleString()} files.\n\n`;
      // group this drive's files by parent folder
      const byFolder = new Map();
      for (const f of d.files) {
        const folder = dirOf(f.p);
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder).push(f);
        siteFiles++;
      }
      for (const folder of [...byFolder.keys()].sort()) {
        md += `### Folder: ${folder}\n\n`;
        for (const f of byFolder.get(folder).sort((a, b) => a.p.localeCompare(b.p))) {
          const name = f.p.slice(f.p.lastIndexOf('/') + 1);
          md += `- ${name} — ${human(f.s)}${f.m ? `, modified ${f.m}` : ''}\n`;
        }
        md += `\n`;
      }
    }
    fs.writeFileSync(path.join(OUT, fname), md);
    manifest.push({ file: fname, site: s.name, files: siteFiles });
    n++;
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    builtFrom: 'sharepoint-index.json', builtAt: new Date().toISOString(),
    sourceSnapshot: idx.builtAt, counts: idx.counts, documents: manifest,
  }, null, 2));

  const totalDocs = manifest.length + 1;
  console.log(`Prepared ${totalDocs} corpus documents in ${OUT}`);
  console.log(`  ${idx.counts.files.toLocaleString()} files across ${idx.counts.sites} sites / ${idx.counts.drives} libraries`);
  for (const m of manifest) console.log(`  - ${m.file}  (${m.files.toLocaleString()} files)`);
}

main();
