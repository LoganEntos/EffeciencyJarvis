/*
 * Project-run context: a compact file manifest + output-destination note for
 * project-scoped runs. lib/runs.js injects the project's `instructions` into
 * every prompt already, but never told Claude WHAT files the project has or
 * WHERE they live — so "summarize the attached invoices" had no path to
 * follow. This module builds that manifest (names/types/sizes only, never
 * contents — Claude reads a file itself via its Read tool using the absolute
 * path this manifest gives it) plus a one-line rule for where generated
 * output should land, so lib/pairing.js's stateless PDF/CSV pairing picks it
 * up automatically instead of it being stranded in the run's artifacts dir.
 *
 * Split out of lib/runs.js (already at the 500-line cap) rather than grown
 * in place. Directory layout mirrors lib/pairing.js's own `dir` computation
 * (data/inbox/<slug>/) — kept independent of lib/projects.js's internals so
 * this file has no coupling to that module's exports.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const INBOX_DIR = path.join(DASH_DIR, 'data', 'inbox');
const MAX_LISTED = 50;

function humanSize(bytes) {
  bytes = bytes || 0;
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

// One line per file: name, extension/type, human size. Newest-first (matches
// the Files tab / lib/projects.js's projectFiles ordering).
function buildManifest(slug) {
  if (!slug) return '';
  const dir = path.join(INBOX_DIR, slug);
  const files = [];
  for (const e of U.listDir(dir)) {
    if (!e.isFile()) continue;
    let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { st = {}; }
    files.push({ name: e.name, size: st.size || 0, mtime: st.mtimeMs || 0 });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return `Project folder: ${dir} (empty — no files attached yet)`;
  const lines = [`Project folder: ${dir}`, `Files (${files.length}):`];
  const shown = files.slice(0, MAX_LISTED);
  for (const f of shown) {
    const ext = (path.extname(f.name).replace(/^\./, '') || 'file').toLowerCase();
    lines.push(`- ${f.name} (${ext}, ${humanSize(f.size)})`);
  }
  if (files.length > shown.length) lines.push(`+${files.length - shown.length} more`);
  return lines.join('\n');
}

// Where generated/converted output for this project belongs, so it lands
// somewhere lib/pairing.js's re-scan will actually find it.
function outputHint(slug) {
  const dir = path.join(INBOX_DIR, slug);
  return `Save any generated or converted files for this project into ${dir} (not the run's artifacts folder) unless the user asks otherwise — that folder is what gets auto-paired and shown in the project's Files tab.`;
}

module.exports = { buildManifest, outputHint, humanSize };
