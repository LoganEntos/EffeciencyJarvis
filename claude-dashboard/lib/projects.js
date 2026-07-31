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
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const memory = require('./memory');
const pairing = require('./pairing');
// Manual SharePoint sync (see syncSharepointFolder below) reuses the existing
// offline browseIndex + pull — no new Graph surface. Not circular: sharepoint.js
// never requires this module, so a plain top-level require is safe here (unlike
// runs.js below, which IS circular and stays a lazy require).
const sharepoint = require('./sharepoint');
// Claude Code CLI workspace import (~/.claude/projects/*) — split into its
// own module to keep this file under the 500-line budget. See lib/project-claude.js.
const claudeImport = require('./project-claude');
const { discoverClaude, importClaude, projectSessions, sessionTranscript, countSessions } = claudeImport;

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'projects.json');
const INBOX = path.join(DATA_DIR, 'inbox');

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
  // Claude-kind projects use the same data/inbox/<slug>/ convention as every other
  // project for attached files (upload/SharePoint/pairing all work on it normally) —
  // only the pairing summary below is gated on kind, not the raw count.
  const fileCount = fileCountFor(p.slug);
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
    sourceNote: p.sourceNote || '',
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    fileCount,
    sessionCount: claude ? countSessions(p.claudeDir) : 0,
    runCount: s.count || 0, lastRunAt: s.last || null,
    ...(pairs ? { pairs } : {}),
    ...(p.sharepointFolder ? { sharepointFolder: p.sharepointFolder } : {}) };
}

// Validate a patch.sharepointFolder value: null clears the binding; otherwise
// must be an object with non-empty string driveId + path (name optional —
// display label only, not used to resolve anything). No itemId: this binds a
// FOLDER (browseIndex(driveId, prefix) addresses folders by path, not id).
// The manual sync trigger against this binding is syncSharepointFolder() below.
function validSharepointFolder(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined; // reject silently — caller drops the field
  const driveId = (v.driveId || '').toString().trim();
  const folderPath = (typeof v.path === 'string' ? v.path : '').trim();
  if (!driveId || !folderPath) return undefined;
  return { driveId: driveId.slice(0, 300), path: folderPath.slice(0, 1000), name: (v.name || '').toString().trim().slice(0, 200) };
}

// Manual "Sync now" (project detail button) — pulls every file in the project's
// bound SharePoint folder into its inbox, skipping names already present.
// Deliberately NOT wired to run automatically (not on every run, not on a
// timer): a silent per-run pull would touch SharePoint content without an
// explicit-in-conversation prompt, which the hub's data-handling rule forbids;
// a manual click IS that explicit prompt. Non-recursive for v1 — only the bound
// folder's immediate files, matching browseIndex's own shape (folders listed,
// never descended into).
const SYNC_FILE_CAP = 300; // bound one sync call the same way shape()'s pairing scan is bounded
async function syncSharepointFolder(id) {
  const list = load();
  const p = list.find(x => x.id === id);
  if (!p) return { error: 'not found' };
  const sf = p.sharepointFolder;
  if (!sf || !sf.driveId || !sf.path) return { error: 'no SharePoint folder is bound to this project yet' };
  if (!sharepoint.isAuthed()) return { error: 'not signed in to SharePoint — connect Microsoft 365 in the SharePoint tab first' };
  let listing;
  try { listing = sharepoint.browseIndex(sf.driveId, sf.path); }
  catch (e) { return { error: e.message || 'could not browse the bound folder' }; }
  if (listing.error) return { error: listing.error };
  let files = listing.files || [];
  const truncated = files.length > SYNC_FILE_CAP;
  if (truncated) files = files.slice(0, SYNC_FILE_CAP);
  if (!files.length) return { ok: true, pulled: 0, skipped: 0, errors: [] }; // empty folder — client renders "nothing to sync"
  // Case-insensitive: the inbox folder is on a case-insensitive filesystem in
  // the common case (Windows), so an exact-case compare could re-pull a file
  // that only differs by case and silently duplicate it.
  const existing = new Set(projectFiles(p.slug).map(f => f.base.toLowerCase()));
  let pulled = 0, skipped = 0; const errors = [];
  for (const f of files) {
    if (existing.has((f.name || '').toLowerCase())) { skipped++; continue; }
    try {
      const r = await sharepoint.pull(f.driveId || sf.driveId, f.id, p.slug);
      if (r.error) { errors.push(`${f.name}: ${r.error}`); continue; }
      pulled++; existing.add((f.name || '').toLowerCase());
    } catch (e) {
      // A 401 mid-loop (token expired between the isAuthed() check and here)
      // would otherwise repeat the same failure for every remaining file —
      // surface it once and stop instead of one error line per file.
      if (e.status === 401) { errors.push('sign-in expired mid-sync — reconnect in the SharePoint tab and try again'); break; }
      errors.push(`${f.name}: ${e.message || 'pull failed'}`);
    }
  }
  return { ok: true, pulled, skipped, errors, ...(truncated ? { truncated: true } : {}) };
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

// Claude Code CLI workspace import (discoverClaude, importClaude,
// projectSessions, sessionTranscript, countSessions) lives in ./project-claude —
// see the comment on the require at the top of this file.

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
  // sourceNote: a cosmetic, freeform reference label ("where these files really
  // live") — deliberately NOT a path the server reads/lists/resolves. Same
  // sanitize-by-slice as description; no validation beyond length, since it is
  // never used for filesystem access (see the directory-tracker scope note in
  // docs/handoffs/projects-tab-revamp-2026-07-30.md — option A, cosmetic only).
  if (typeof patch.sourceNote === 'string') p.sourceNote = patch.sourceNote.slice(0, 200);
  if (typeof patch.instructions === 'string') p.instructions = patch.instructions.slice(0, 12000);
  if (typeof patch.archived === 'boolean') p.archived = patch.archived;
  if ('sharepointFolder' in patch) {
    const v = validSharepointFolder(patch.sharepointFolder);
    if (v === null) delete p.sharepointFolder; // explicit clear
    else if (v !== undefined) p.sharepointFolder = v; // valid binding; invalid shapes are dropped, not errored
  }
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
  if (p === '/api/projects/sync-sharepoint' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = await syncSharepointFolder((b.id || '').toString());
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

// load/save/shape/slugify/newId are also consumed by lib/project-claude.js
// (via a lazy require, see the comment there) so importClaude() can create
// projects.json entries without duplicating this module's storage logic.
module.exports = { handle, get, load, save, shape, slugify, newId };
