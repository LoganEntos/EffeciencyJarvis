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

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'projects.json');
const INBOX = path.join(DATA_DIR, 'inbox');

function load() { return U.safeJson(FILE) || []; }
function save(list) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(list, null, 2)); }
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

function shape(p, stats) {
  const s = stats || {};
  return { id: p.id, name: p.name, slug: p.slug, description: p.description || '',
    instructions: p.instructions || '', createdAt: p.createdAt, updatedAt: p.updatedAt,
    fileCount: projectFiles(p.slug).length,
    runCount: s.count || 0, lastRunAt: s.last || null };
}

// Run activity per project, keyed by slug. Runs launched in a project carry
// meta.projectSlug (see runs.js), so we bucket the existing run list — no new
// store. require('./runs') is lazy: runs.js requires this module at load, so a
// top-level require here would be circular; by request time both are resolved.
function runStatsBySlug() {
  let runs = [];
  try { runs = require('./runs').listRuns(); } catch {}
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
function runsForSlug(slug, limit = 8) {
  let runs = [];
  try { runs = require('./runs').listRuns(); } catch {}
  return runs.filter(r => r.projectSlug === slug).slice(0, limit).map(r => ({
    id: r.id, model: r.model || '?', status: r.status || '?', costUsd: r.costUsd || 0,
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

function get(id) { return load().find(p => p.id === id) || null; }

function create(name, description) {
  name = (name || '').toString().trim().slice(0, 80);
  if (!name) return { error: 'name required' };
  const list = load();
  const slug = slugify(name, new Set(list.map(p => p.slug)));
  const now = new Date().toISOString();
  const p = { id: newId(), name, slug, description: (description || '').toString().slice(0, 300), instructions: '', createdAt: now, updatedAt: now };
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
    const stats = runStatsBySlug();
    U.sendJson(res, { projects: load().map(x => shape(x, stats[x.slug])) });
    return true;
  }
  if (p === '/api/projects/import' && req.method === 'POST') {
    U.sendJson(res, importInbox());
    return true;
  }
  if (p === '/api/projects/get' && req.method === 'GET') {
    const proj = get(url.searchParams.get('id') || '');
    if (!proj) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const q = url.searchParams.get('q') || (proj.instructions + ' ' + proj.description) || proj.name;
    let mem = { items: [] };
    try { mem = memory.recallForProject(proj.slug, q, { limit: 6 }); } catch {}
    const stats = runStatsBySlug();
    U.sendJson(res, { project: shape(proj, stats[proj.slug]), files: projectFiles(proj.slug),
      memory: { items: mem.items }, runs: runsForSlug(proj.slug) });
    return true;
  }
  if (p === '/api/projects' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    const r = create(b.name, b.description);
    U.sendJson(res, r, r.error ? 400 : 200);
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
