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

function shape(p) {
  return { id: p.id, name: p.name, slug: p.slug, description: p.description || '',
    instructions: p.instructions || '', createdAt: p.createdAt, updatedAt: p.updatedAt,
    fileCount: projectFiles(p.slug).length };
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
    U.sendJson(res, { projects: load().map(shape) });
    return true;
  }
  if (p === '/api/projects/get' && req.method === 'GET') {
    const proj = get(url.searchParams.get('id') || '');
    if (!proj) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const q = url.searchParams.get('q') || (proj.instructions + ' ' + proj.description) || proj.name;
    let mem = { items: [] };
    try { mem = memory.recallForProject(proj.slug, q, { limit: 6 }); } catch {}
    U.sendJson(res, { project: shape(proj), files: projectFiles(proj.slug), memory: { items: mem.items } });
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
