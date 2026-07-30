/*
 * Per-tab TODO tracker: one markdown checklist per nav tab, persisted as a
 * plain .md file (no JSON, no schema — the file itself IS the UI content).
 * Count = unchecked `- [ ]` lines; checked `- [x]` lines don't count. Zero-dep,
 * atomic writes (tmp + rename) so a reader never sees a torn file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const TODOS_DIR = path.join(DASH_DIR, 'data', 'todos');

// Whitelist mirrors #mainNav's data-tab values (index.html) exactly — any tab
// added to the nav must be added here too, or its badge/panel silently no-ops.
const TABS = ['jarvis', 'run', 'live', 'tasks', 'files', 'projects', 'sharepoint', 'sessions',
  'memory', 'overview', 'graph', 'health', 'agents', 'skills', 'commands', 'assets', 'sources',
  'tools', 'config'];
const TAB_RE = /^[a-z][a-z0-9-]*$/;

// Path-traversal guard: format check FIRST (before any filesystem touch),
// THEN whitelist membership — either failing rejects the request.
function safeTab(raw) {
  if (typeof raw !== 'string' || !TAB_RE.test(raw) || !TABS.includes(raw)) return null;
  return raw;
}

const filePath = tab => path.join(TODOS_DIR, tab + '.md');
const countUnchecked = md => (md.match(/^[ \t]*-\s\[ \]/gm) || []).length;

function readTodo(tab) {
  const md = U.safeRead(filePath(tab)) || '';
  return { md, count: countUnchecked(md) };
}

// Atomic write: tmp file + rename, so a concurrent GET never sees a half-written file.
function writeTodo(tab, md) {
  fs.mkdirSync(TODOS_DIR, { recursive: true });
  const fp = filePath(tab);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, md);
  fs.renameSync(tmp, fp);
  return countUnchecked(md);
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/todos/counts' && req.method === 'GET') {
    const counts = {};
    for (const t of TABS) counts[t] = readTodo(t).count;
    U.sendJson(res, { counts });
    return true;
  }
  if (p.startsWith('/api/todos/') && req.method === 'GET') {
    const tab = safeTab(p.slice('/api/todos/'.length));
    if (!tab) { U.sendJson(res, { error: 'unknown tab' }, 400); return true; }
    U.sendJson(res, readTodo(tab));
    return true;
  }
  if (p.startsWith('/api/todos/') && req.method === 'PUT') {
    const tab = safeTab(p.slice('/api/todos/'.length));
    if (!tab) { U.sendJson(res, { error: 'unknown tab' }, 400); return true; }
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 256 * 1024) || '{}'); } catch {}
    const md = typeof b.md === 'string' ? b.md.slice(0, 200000) : '';
    U.sendJson(res, { count: writeTodo(tab, md) });
    return true;
  }
  return false;
}

module.exports = { handle, TABS };
