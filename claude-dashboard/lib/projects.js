/*
 * Projects — a named workspace like the Claude web app's Projects: a standing
 * instruction set + a set of attached files + project-scoped memory.
 *
 * Storage: data/projects.json (metadata + instructions). Attached files reuse
 * the existing inbox project-folder mechanism (data/inbox/<slug>/), so upload /
 * view / download / delete all go through the same /api/files/* endpoints — no
 * second file store. Memory is the engram engine (lib/memory.js) scoped by the
 * project slug: a run launched in a project is tagged with the slug, and
 * recallForProject() surfaces that history next time. No vectors, no per-run
 * cost beyond the small opt-in context block a project run injects.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const memory = require('./memory');
const pairing = require('./pairing');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'projects.json');
const INBOX = path.join(DATA_DIR, 'inbox');
// Where the Claude Code CLI stores its per-workspace session transcripts. Each
// subdirectory is one workspace (its name is the workspace path with separators
// turned into dashes); inside are <session-id>.jsonl transcript files. We read
// these to surface, archive, and browse the user's real Claude projects here.
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

function load() { return U.safeJson(FILE) || []; }
// Atomic write (temp + rename, mirroring lib/tasks.js) so a concurrent reader
// never sees a torn projects.json.
function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, FILE);
}
const newId = () => 'p-' + crypto.randomBytes(4).toString('hex');

// A slug doubles as the inbox folder name, so it must survive files.js's
// sanitizeName unchanged (A-Za-z0-9 space . _ ( ) - [ ]). We keep it tighter:
// word chars + dashes only, and guarantee uniqueness against existing projects.
function slugify(name, taken) {
  let base = (name || '').trim().toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '').slice(0, 60);
  if (!base) base = 'project';
  let s = base, n = 2;
  while (taken && taken.has(s)) s = base + '-' + n++;
  return s;
}

// A project's attached files = the inbox subfolder named for its slug.
function projectFiles(slug) {
  const dir = path.join(INBOX, slug);
  const out = [];
  for (const e of U.listDir(dir)) {
    if (!e.isFile()) continue;
    let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { st = {}; }
    out.push({ name: slug + '/' + e.name, base: e.name, size: st.size || 0, modified: st.mtime || null });
  }
  return out.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

// Cheap count for the list/summary views: readdirSync withFileTypes already
// tells us isFile() per entry, so no per-file statSync is needed just to get
// a count (unlike projectFiles(), which needs size+mtime for the detail view).
function fileCountFor(slug) {
  let n = 0;
  for (const e of U.listDir(path.join(INBOX, slug))) if (e.isFile()) n++;
  return n;
}

function shape(p, stats) {
  const s = stats || {};
  const claude = p.kind === 'claude';
  const fileCount = claude ? 0 : fileCountFor(p.slug);
  // Grid-level PDF↔CSV pairing summary for the tile badge. BOUNDED: pairSummary
  // re-scans the folder (no cache), so only for standard projects with a
  // workable file count — skip claude workspaces and anything over 300 files so
  // a big folder can't make the list route walk it on every poll. Omitted (not
  // {}) when unavailable, so the UI degrades by simply not rendering the badge.
  let pairs;
  if (!claude && fileCount > 0 && fileCount <= 300) {
    try { pairs = pairing.pairSummary(p.slug) || undefined; } catch { pairs = undefined; }
  }
  return { id: p.id, name: p.name, slug: p.slug, kind: p.kind || 'standard', cwd: p.cwd || '',
    description: p.description || '', instructions: p.instructions || '', archived: !!p.archived,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    fileCount,
    sessionCount: claude ? countSessions(p.claudeDir) : 0,
    runCount: s.count || 0, lastRunAt: s.last || null,
    ...(pairs ? { pairs } : {}) };
}

// Lazy, memoized-per-call fetch of the full run list. require('./runs') is
// lazy: runs.js requires this module at load, so a top-level require here
// would be circular; by request time both are resolved. Callers that need
// both runStatsBySlug() and runsForSlug() in the same request should call
// this once and pass the result in, so a single request never scans
// data/runs/ (readFileSync+JSON.parse per meta.json) more than once.
function allRuns() {
  try { return require('./runs').listRuns(); } catch { return []; }
}

// Run activity per project, keyed by slug. Runs launched in a project carry
// meta.projectSlug (see runs.js), so we bucket the existing run list — no new
// store. `runs` is optional so existing callers keep working unchanged.
function runStatsBySlug(runs) {
  runs = runs || allRuns();
  const by = {};
  for (const r of runs) {
    if (!r.projectSlug) continue;
    const b = by[r.projectSlug] || (by[r.projectSlug] = { count: 0, last: null });
    b.count++;
    const t = r.startedAt || r.queuedAt || '';
    if (t && (!b.last || t > b.last)) b.last = t;
  }
  return by;
}

// The most recent runs launched in one project (listRuns is already newest-first).
// `runs` is optional so existing callers keep working unchanged.
function runsForSlug(slug, limit = 8, runs) {
  runs = runs || allRuns();
  return runs.filter(r => r.projectSlug === slug).slice(0, limit).map(r => ({
    id: r.id, model: r.model || '?', status: r.status || '?',
    tokensIn: r.tokensIn || 0, tokensOut: r.tokensOut || 0,
    durationMs: r.durationMs || 0, startedAt: r.startedAt || r.queuedAt || null,
    prompt: r.promptExcerpt || r.prompt || '' }));
}

// Adopt every inbox subfolder that isn't already a project. The folder name is
// already a valid slug (files.js sanitized it), so slug=folder keeps the
// existing files attached with no move. Titleize the folder for the name.
function importInbox() {
  const list = load();
  const taken = new Set(list.map(x => x.slug));
  const now = new Date().toISOString();
  const created = [];
  for (const e of U.listDir(INBOX)) {
    if (!e.isDirectory() || taken.has(e.name)) continue;
    const name = e.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80);
    const proj = { id: newId(), name, slug: e.name, description: 'Imported from inbox folder', instructions: '', createdAt: now, updatedAt: now };
    list.push(proj); taken.add(e.name); created.push(shape(proj));
  }
  if (created.length) save(list);
  return { ok: true, count: created.length, created };
}

// ---------------------------------------------------------- Claude Code import
// The user's real Claude projects live in ~/.claude/projects/<workspace>/*.jsonl.
// We adopt each workspace as a project here so it is archived and browsable — its
// sessions stay where the CLI wrote them (we never move or mutate transcripts).

// A workspace dir name is a valid single path segment; reject anything that could
// escape CLAUDE_DIR before we touch the filesystem with it.
function safeDir(name) { return typeof name === 'string' && name && !/[\\/]|\.\./.test(name); }

// The dir name is the workspace path with separators dashed out — lossy (a real
// dash is indistinguishable from a separator), so we only use it as a fallback.
// The authoritative cwd is read from inside a transcript (readWorkspace).
function decodeDir(name) {
  const m = /^([A-Za-z])--(.*)$/.exec(name);
  return m ? m[1] + ':\\' + m[2].replace(/-/g, '\\') : name;
}

function titleize(s) { return (s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80); }
function sessionFiles(dir) { return U.listDir(dir).filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => e.name); }
function countSessions(claudeDir) { return safeDir(claudeDir) ? sessionFiles(path.join(CLAUDE_DIR, claudeDir)).length : 0; }

// The hub prepends persona / system-reminder / [Hub …] blocks to a run's first
// user turn; strip them so titles and transcript text read as the human wrote them.
function stripInjected(s) {
  return (s || '')
    .replace(/<persona[\s\S]*?<\/persona>/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\[Hub[\s\S]*?\]/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function userText(m) {
  if (!m) return '';
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) { for (const p of c) if (p && p.type === 'text' && p.text) return p.text; }
  return '';
}

// Cheap workspace summary: session count, newest activity, and — from the newest
// transcript only — the authoritative cwd + git branch. Avoids parsing every file.
function readWorkspace(name) {
  const dir = path.join(CLAUDE_DIR, name);
  const files = sessionFiles(dir);
  let last = null, newest = null, cwd = null, branch = null;
  for (const f of files) {
    let mt = 0; try { mt = fs.statSync(path.join(dir, f)).mtimeMs; } catch {}
    if (!newest || mt > newest.mt) newest = { f, mt };
  }
  if (newest) {
    try {
      const lines = fs.readFileSync(path.join(dir, newest.f), 'utf8').split(/\r?\n/);
      for (const l of lines) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
        if (!cwd && d.cwd) cwd = d.cwd; if (!branch && d.gitBranch) branch = d.gitBranch;
        if (d.timestamp) last = d.timestamp; if (cwd && branch) break; }
    } catch {}
  }
  return { dir: name, sessionCount: files.length, cwd: cwd || decodeDir(name), branch: branch || '', lastAt: last };
}

// Every Claude workspace, flagged with whether it is already imported here.
function discoverClaude() {
  const imported = new Set(load().filter(p => p.claudeDir).map(p => p.claudeDir));
  const out = [];
  for (const e of U.listDir(CLAUDE_DIR)) {
    if (!e.isDirectory()) continue;
    const w = readWorkspace(e.name);
    if (!w.sessionCount) continue;
    out.push(Object.assign(w, { imported: imported.has(e.name) }));
  }
  out.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  return { ok: true, dir: CLAUDE_DIR, workspaces: out };
}

// Adopt selected workspaces (or all, if none named) as projects. Idempotent: a
// workspace already imported is skipped. Transcripts are left in place.
function importClaude(dirs) {
  const want = new Set(Array.isArray(dirs) ? dirs.filter(safeDir) : []);
  const list = load();
  const takenSlug = new Set(list.map(x => x.slug));
  const takenDir = new Set(list.filter(x => x.claudeDir).map(x => x.claudeDir));
  const now = new Date().toISOString();
  const created = [];
  for (const e of U.listDir(CLAUDE_DIR)) {
    if (!e.isDirectory() || takenDir.has(e.name)) continue;
    if (want.size && !want.has(e.name)) continue;
    const w = readWorkspace(e.name);
    if (!w.sessionCount) continue;
    const label = w.cwd ? path.basename(w.cwd.replace(/[\\/]+$/, '')) : e.name;
    const slug = slugify(label, takenSlug);
    const proj = { id: newId(), name: titleize(label) || e.name, slug, kind: 'claude', claudeDir: e.name,
      cwd: w.cwd, description: `Claude Code workspace · ${w.sessionCount} session${w.sessionCount === 1 ? '' : 's'}`,
      instructions: '', createdAt: now, updatedAt: w.lastAt || now };
    list.push(proj); takenSlug.add(slug); takenDir.add(e.name); created.push(shape(proj));
  }
  if (created.length) save(list);
  return { ok: true, count: created.length, created };
}

// Full session list for an imported workspace: title (first human turn), size,
// message count, timestamps, git branch. Parses each transcript on demand.
function projectSessions(claudeDir) {
  if (!safeDir(claudeDir)) return [];
  const dir = path.join(CLAUDE_DIR, claudeDir);
  const out = [];
  for (const f of sessionFiles(dir)) {
    let raw = ''; try { raw = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    let title = '', first = null, last = null, branch = '', msgs = 0;
    for (const l of raw.split(/\r?\n/)) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
      if (!branch && d.gitBranch) branch = d.gitBranch;
      if (d.timestamp) { if (!first) first = d.timestamp; last = d.timestamp; }
      if (d.type === 'user' || d.type === 'assistant') msgs++;
      if (!title && d.type === 'user') title = stripInjected(userText(d.message)); }
    out.push({ sid: f.replace(/\.jsonl$/, ''), title: title.slice(0, 140), messages: msgs,
      branch, firstAt: first, lastAt: last, sizeBytes: Buffer.byteLength(raw) });
  }
  return out.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
}

// A single transcript rendered as readable turns for the in-app viewer. Read-only;
// bulky tool_result payloads are dropped, tool calls kept as one-line markers.
function sessionTranscript(claudeDir, sid) {
  if (!safeDir(claudeDir) || !/^[A-Za-z0-9._-]{6,}$/.test(sid)) return null;
  const file = path.join(CLAUDE_DIR, claudeDir, sid + '.jsonl');
  if (!path.resolve(file).startsWith(path.resolve(CLAUDE_DIR) + path.sep)) return null;
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const msgs = []; let cwd = null, branch = null, first = null, last = null, truncated = false;
  const LIMIT = 600;
  for (const l of raw.split(/\r?\n/)) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd; if (!branch && d.gitBranch) branch = d.gitBranch;
    if (d.timestamp) { if (!first) first = d.timestamp; last = d.timestamp; }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const m = d.message || {}; let text = ''; const tools = []; const c = m.content;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) for (const p of c) { if (!p) continue;
      if (p.type === 'text' && p.text) text += (text ? '\n' : '') + p.text;
      else if (p.type === 'tool_use') tools.push(p.name || 'tool'); }
    if (d.type === 'user') text = stripInjected(text);
    if (!text && !tools.length) continue;
    msgs.push({ role: d.type, text: text.slice(0, 6000), tools, ts: d.timestamp || null });
    if (msgs.length >= LIMIT) { truncated = true; break; } }
  return { sid, cwd, branch, firstAt: first, lastAt: last, messages: msgs, truncated };
}

function get(id) { return load().find(p => p.id === id) || null; }

// Slug-reuse guard: create() used to uniquify the slug only against CURRENT
// projects.json entries. Deleting a project frees its slug but leaves its
// inbox folder (+ memory notes + run history) on disk (remove() is metadata-
// only, by design — see below); recreating a same-named project would
// silently inherit all of it. That inheritance is also the only recovery path
// for a deleted project's files, so we don't silently uniquify — instead we
// surface the conflict and let the caller pick adopt (opt.adopt) or fresh
// (opt.fresh) via a second call.
function create(name, description, opts) {
  opts = opts || {};
  name = (name || '').toString().trim().slice(0, 80);
  if (!name) return { error: 'name required' };
  const list = load();
  const takenSlugs = new Set(list.map(p => p.slug));
  let slug;
  if (opts.fresh) {
    // Seed the uniquifier with every existing inbox folder name too (not just
    // slugs already in projects.json) so a fresh start can never land on a
    // folder that still holds another deleted project's files.
    const taken = new Set(takenSlugs);
    for (const e of U.listDir(INBOX)) if (e.isDirectory()) taken.add(e.name);
    slug = slugify(name, taken);
  } else {
    slug = slugify(name, takenSlugs);
    if (!opts.adopt) {
      const fileCount = fileCountFor(slug);
      if (fileCount > 0) return { error: 'folder-exists', slug, fileCount };
    }
    // opts.adopt (or an empty/missing folder): fall through and adopt/reuse
    // the folder as-is — existing behavior.
  }
  const now = new Date().toISOString();
  const p = { id: newId(), name, slug, archived: false, description: (description || '').toString().slice(0, 300), instructions: '', createdAt: now, updatedAt: now };
  list.unshift(p);
  save(list);
  return { ok: true, project: shape(p) };
}

function update(id, patch) {
  const list = load();
  const p = list.find(x => x.id === id);
  if (!p) return { error: 'not found' };
  if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 80);
  if (typeof patch.description === 'string') p.description = patch.description.slice(0, 300);
  if (typeof patch.instructions === 'string') p.instructions = patch.instructions.slice(0, 12000);
  if (typeof patch.archived === 'boolean') p.archived = patch.archived;
  p.updatedAt = new Date().toISOString();
  save(list);
  return { ok: true, project: shape(p) };
}

// Metadata delete only — attached inbox files are left in place so a project
// can be removed without silently destroying documents the user uploaded.
function remove(id) {
  const list = load();
  if (!list.some(p => p.id === id)) return { error: 'not found' };
  save(list.filter(p => p.id !== id));
  return { ok: true };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/projects' && req.method === 'GET') {
    const stats = runStatsBySlug(allRuns());
    U.sendJson(res, { projects: load().map(x => shape(x, stats[x.slug])) });
    return true;
  }
  if (p === '/api/projects/import' && req.method === 'POST') {
    U.sendJson(res, importInbox());
    return true;
  }
  if (p === '/api/projects/claude' && req.method === 'GET') {
    U.sendJson(res, discoverClaude());
    return true;
  }
  if (p === '/api/projects/import-claude' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 64 * 1024) || '{}'); } catch {}
    U.sendJson(res, importClaude(Array.isArray(b.dirs) ? b.dirs : null));
    return true;
  }
  if (p === '/api/projects/session' && req.method === 'GET') {
    const proj = get(url.searchParams.get('id') || '');
    if (!proj || proj.kind !== 'claude') { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const t = sessionTranscript(proj.claudeDir, url.searchParams.get('sid') || '');
    if (!t) { U.sendJson(res, { error: 'session not found' }, 404); return true; }
    U.sendJson(res, { session: t });
    return true;
  }
  if (p === '/api/projects/get' && req.method === 'GET') {
    const proj = get(url.searchParams.get('id') || '');
    if (!proj) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    // runsOnly: chat history strip + post-run refresh only need d.runs. Skip the
    // per-transcript parse in projectSessions (and memory recall) so these hot,
    // repeated calls don't block the event loop on a large claude workspace.
    if (url.searchParams.get('runsOnly')) {
      const runs = allRuns();
      U.sendJson(res, { project: shape(proj, runStatsBySlug(runs)[proj.slug]), runs: runsForSlug(proj.slug, 8, runs) });
      return true;
    }
    const q = url.searchParams.get('q') || (proj.instructions + ' ' + proj.description) || proj.name;
    let mem = { items: [] };
    try { mem = memory.recallForProject(proj.slug, q, { limit: 6 }); } catch {}
    const runs = allRuns();
    const stats = runStatsBySlug(runs);
    U.sendJson(res, { project: shape(proj, stats[proj.slug]), files: projectFiles(proj.slug),
      memory: { items: mem.items }, runs: runsForSlug(proj.slug, 8, runs),
      sessions: proj.kind === 'claude' ? projectSessions(proj.claudeDir) : [] });
    return true;
  }
  if (p === '/api/projects' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    const r = create(b.name, b.description, { adopt: !!b.adopt, fresh: !!b.fresh });
    const code = r.error ? (r.error === 'folder-exists' ? 409 : 400) : 200;
    U.sendJson(res, r, code);
    return true;
  }
  if (p === '/api/projects/update' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
    const r = update((b.id || '').toString(), b);
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/projects/delete' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = remove((b.id || '').toString());
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/projects/note' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    const proj = get((b.id || '').toString());
    if (!proj) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    if (!b.text || !b.text.toString().trim()) { U.sendJson(res, { error: 'text required' }, 400); return true; }
    // Tag the note with the project slug so recallForProject finds it.
    memory.addNote('semantic', b.title || ('note · ' + proj.name), b.text.toString(), [proj.slug], 0.75);
    U.sendJson(res, { ok: true });
    return true;
  }
  return false;
}

module.exports = { handle, get };
