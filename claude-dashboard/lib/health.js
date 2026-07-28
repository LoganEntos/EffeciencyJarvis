/*
 * Health tab — read-only project transparency. Surfaces, live from disk, the
 * things an audit used to require an agent to go dig for by hand:
 *   1. inbox     — flat (unassigned) files sitting in data/inbox/ root
 *   2. docs      — every project *.md with mtime + a stale-vs-code heuristic
 *   3. structure — line counts for server/lib/assets + orphan modules
 *   4. skills    — active (.claude/skills) vs dormant (.claude/skills-library)
 *   5. backlog   — open/closed counts via autopilot's OWN parser (reused)
 *
 * Everything here is a filesystem/git introspection scoped to this repo — no
 * new persistent state, no client data. The scan is filesystem-heavy, so the
 * assembled result is cached; GET /api/health?refresh=1 forces a re-scan.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const autopilot = require('./autopilot');

const DASH_DIR = path.resolve(__dirname, '..');       // claude-dashboard/
const REPO_DIR = path.resolve(__dirname, '..', '..'); // repo root
const INBOX = path.join(DASH_DIR, 'data', 'inbox');
const DAY = 86400000;
const STALE_DAYS = 30;
const WARN_LINES = 450, CAP_LINES = 500;

// Directories we never descend into for the doc scan: runtime data, vcs, deps,
// the quarantine bucket, and the 278-pack dormant skill library (its READMEs
// aren't "project docs to keep fresh" — they're vendored reference).
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'graphify-out',
  '.csm', '.kokoro', 'ECC-main', '__pycache__', '.claude/skills-library']);

function isoOf(mtime) { try { return new Date(mtime).toISOString(); } catch { return null; } }
function relRepo(full) { return path.relative(REPO_DIR, full).split(path.sep).join('/'); }

// ---------- 1. inbox: unassigned root files ----------
function scanInbox() {
  const files = [];
  for (const e of U.listDir(INBOX)) {
    if (!e.isFile()) continue; // project subfolders are shown in the Files tab
    let st; try { st = fs.statSync(path.join(INBOX, e.name)); } catch { st = {}; }
    files.push({ name: e.name, size: st.size || 0, modified: isoOf(st.mtime),
      ext: (e.name.split('.').pop() || '').toLowerCase() });
  }
  files.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  return files;
}

// ---------- shared: recursive *.md walk (project docs only) ----------
function walkMd(dir, out) {
  for (const e of U.listDir(dir)) {
    const full = path.join(dir, e.name);
    const rel = relRepo(full);
    if (e.isDirectory()) {
      if (e.name.startsWith('_quarantine') || SKIP_DIRS.has(e.name) || SKIP_DIRS.has(rel)) continue;
      walkMd(full, out);
    } else if (e.isFile() && /\.md$/i.test(e.name)) {
      let st; try { st = fs.statSync(full); } catch { continue; }
      out.push({ path: rel, size: st.size || 0, mtime: st.mtimeMs || 0 });
    }
  }
  return out;
}

// Newest mtime across the app's actual code — the reference point the doc
// staleness heuristic measures against.
function newestCodeMtime() {
  let newest = 0;
  const probe = f => { try { const st = fs.statSync(f); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch {} };
  probe(path.join(DASH_DIR, 'server.js'));
  probe(path.join(DASH_DIR, 'index.html'));
  for (const sub of ['lib', 'assets']) {
    for (const e of U.listDir(path.join(DASH_DIR, sub))) {
      if (e.isFile() && /\.(js|css)$/.test(e.name)) probe(path.join(DASH_DIR, sub, e.name));
    }
  }
  return newest;
}

// ---------- 2. docs: list + best-effort staleness ----------
function scanDocs() {
  const docs = walkMd(REPO_DIR, []);
  const codeM = newestCodeMtime();
  const cutoff = codeM - STALE_DAYS * DAY;
  const items = docs.map(d => ({
    path: d.path, size: d.size, modified: isoOf(d.mtime),
    stale: codeM > 0 && d.mtime > 0 && d.mtime < cutoff,
  })).sort((a, b) => (a.modified || '').localeCompare(b.modified || '')); // oldest first
  return { items, codeModified: isoOf(codeM), staleDays: STALE_DAYS };
}

// ---------- 3. structure: line counts + orphan modules ----------
// Count newlines to match `wc -l` (the canonical size-guard tool + the numbers
// recorded in HANDOFF/roadmap) — split('\n').length would over-report by one
// for the usual trailing-newline file.
function countLines(full) {
  const txt = U.safeRead(full);
  if (txt == null) return null;
  const m = txt.match(/\n/g);
  return m ? m.length : 0;
}
function scanStructure() {
  const targets = [];
  targets.push(path.join(DASH_DIR, 'server.js'));
  targets.push(path.join(DASH_DIR, 'index.html'));
  const libFiles = [], assetFiles = [];
  for (const e of U.listDir(path.join(DASH_DIR, 'lib'))) {
    if (e.isFile() && e.name.endsWith('.js')) { libFiles.push(e.name); targets.push(path.join(DASH_DIR, 'lib', e.name)); }
  }
  for (const e of U.listDir(path.join(DASH_DIR, 'assets'))) {
    if (e.isFile() && /\.(js|css)$/.test(e.name)) { if (e.name.endsWith('.js')) assetFiles.push(e.name); targets.push(path.join(DASH_DIR, 'assets', e.name)); }
  }
  const files = [];
  for (const full of targets) {
    const lines = countLines(full);
    if (lines == null) continue;
    files.push({ path: relRepo(full), lines, warn: lines >= WARN_LINES && lines < CAP_LINES, over: lines >= CAP_LINES });
  }
  files.sort((a, b) => b.lines - a.lines);

  // Orphan check: a lib/*.js never require()d by server.js, or an assets/*.js
  // never <script>-tagged in index.html. util/xlsxcells etc. are required by
  // sibling libs, so we scan ALL lib sources for cross-requires too.
  const serverSrc = U.safeRead(path.join(DASH_DIR, 'server.js')) || '';
  const indexSrc = U.safeRead(path.join(DASH_DIR, 'index.html')) || '';
  let libSrcAll = serverSrc;
  for (const n of libFiles) libSrcAll += '\n' + (U.safeRead(path.join(DASH_DIR, 'lib', n)) || '');
  const orphans = [];
  for (const n of libFiles) {
    const base = n.replace(/\.js$/, '');
    if (!libSrcAll.includes(`require('./lib/${base}')`) && !libSrcAll.includes(`require('./${base}')`))
      orphans.push('lib/' + n);
  }
  for (const n of assetFiles) {
    if (!indexSrc.includes(`assets/${n}`)) orphans.push('assets/' + n);
  }
  return { files, orphans, warnAt: WARN_LINES, capAt: CAP_LINES,
    largest: files[0] ? files[0].lines : 0, count: files.length };
}

// ---------- 4. skills: active vs dormant ----------
function listDirs(dir) {
  return U.listDir(dir).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
}
function scanSkills() {
  const active = listDirs(path.join(REPO_DIR, '.claude', 'skills'));
  const dormant = listDirs(path.join(REPO_DIR, '.claude', 'skills-library'));
  return { activeCount: active.length, active, dormantCount: dormant.length, dormant };
}

// ---------- 5. backlog: reuse autopilot's parser ----------
function scanBacklog() {
  let items = [];
  try { items = autopilot.parseBacklog() || []; } catch { items = []; }
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  // Most recent closed date = max YYYY-MM-DD found in a done row's status cell.
  let lastClosed = null;
  for (const i of done) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(i.status || '');
    if (m && (!lastClosed || m[1] > lastClosed)) lastClosed = m[1];
  }
  return { total: items.length, open: open.length, done: done.length, lastClosed,
    openItems: open.map(i => ({ id: i.id, loc: i.loc, issue: i.issue })) };
}

// ---------- assembly + cache ----------
let cache = null, cacheAt = 0;
const CACHE_MS = 30 * 1000;
function gather() {
  return {
    generatedAt: new Date().toISOString(),
    inbox: scanInbox(),
    docs: scanDocs(),
    structure: scanStructure(),
    skills: scanSkills(),
    backlog: scanBacklog(),
  };
}

// Raw doc reader for the doc-health viewer. Strict guard: the requested path is
// resolved against the repo root and must (a) stay inside it, (b) end in .md,
// (c) not live in a skipped/quarantine dir — so this can never read outside the
// project's own documentation. Read-only, capped.
const DOC_CAP = 512 * 1024;
function readDoc(rel) {
  if (!rel || /\.\./.test(rel) || !/\.md$/i.test(rel)) return null;
  const full = path.resolve(REPO_DIR, rel);
  const root = REPO_DIR + path.sep;
  if (full !== REPO_DIR && !full.startsWith(root)) return null;
  const parts = relRepo(full).split('/');
  if (parts.some(seg => seg.startsWith('_quarantine') || SKIP_DIRS.has(seg)) || relRepo(full).startsWith('.claude/skills-library')) return null;
  let st; try { st = fs.statSync(full); } catch { return null; }
  if (!st.isFile()) return null;
  const fd = fs.openSync(full, 'r');
  const buf = Buffer.alloc(Math.min(st.size, DOC_CAP));
  try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  return { path: relRepo(full), text: buf.toString('utf8'), truncated: st.size > DOC_CAP, bytes: st.size };
}

async function handle(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    const fresh = url.searchParams.get('refresh') === '1';
    if (fresh || !cache || Date.now() - cacheAt > CACHE_MS) {
      cache = gather();
      cacheAt = Date.now();
    }
    U.sendJson(res, Object.assign({ cachedAt: new Date(cacheAt).toISOString() }, cache));
    return true;
  }
  if (url.pathname === '/api/health/doc' && req.method === 'GET') {
    const doc = readDoc(url.searchParams.get('path') || '');
    if (!doc) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    U.sendJson(res, doc);
    return true;
  }
  return false;
}

module.exports = { handle };
