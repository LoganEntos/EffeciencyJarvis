/*
 * Hub-native task queue: a durable list of improvement prompts the hub works
 * through as auto-routed runs. Zero per-run cost — a task IS a prompt fed to
 * the existing run engine, so it inherits auto model allocation, streaming,
 * history, and artifacts with no extra MCP/schema tax on any run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const runs = require('./runs');

const DASH_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(DASH_DIR, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

function load() { return U.safeJson(TASKS_FILE) || []; }
function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(list, null, 2));
}
const newId = () => 't-' + crypto.randomBytes(4).toString('hex');

// Enrich each task with the live status of its linked run (source of truth for
// running/done/failed lives in the run engine, not a copy we'd have to sync).
function enrich(list) {
  return list.map(t => {
    if (!t.runId) return Object.assign({ runStatus: null }, t);
    const m = runs.getRunMeta(t.runId);
    return Object.assign({}, t, {
      runStatus: m ? m.status : 'gone',
      model: m ? m.model : t.model,
      costUsd: m ? m.costUsd : null,
      artifactCount: m ? m.artifactCount : 0,
      errorExcerpt: m ? m.errorExcerpt : null,
    });
  });
}

// A task is "settled" once its run finished (any terminal state) — used to
// decide state and to gate Run-all.
const settled = s => s === 'done' || s === 'error' || s === 'cancelled' || s === 'gone';

function runTask(id) {
  const list = load();
  const t = list.find(x => x.id === id);
  if (!t) return { error: 'task not found' };
  if (t.runId) {
    const m = runs.getRunMeta(t.runId);
    if (m && !settled(m.status)) return { error: 'task already running' };
  }
  const r = runs.startRun({ prompt: t.prompt, model: t.model || 'auto', permissionMode: 'acceptEdits' });
  if (r.error) return r;
  t.runId = r.id;
  t.startedAt = new Date().toISOString();
  save(list);
  return { ok: true, runId: r.id };
}

// Fire every queued (never-run or all-settled) task; the run engine's own
// 2-active + 5-queued limiter paces them, so this is safe to call in bulk.
function runAll() {
  const list = load();
  let started = 0;
  for (const t of list) {
    const m = t.runId ? runs.getRunMeta(t.runId) : null;
    // run tasks that never ran, or that failed/cancelled (retry); leave done/active ones
    if (!t.runId || (m && settled(m.status) && m.status !== 'done')) {
      const r = runs.startRun({ prompt: t.prompt, model: t.model || 'auto', permissionMode: 'acceptEdits' });
      if (!r.error) { t.runId = r.id; t.startedAt = new Date().toISOString(); started++; }
    }
  }
  save(list);
  return { ok: true, started };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/tasks' && req.method === 'GET') {
    U.sendJson(res, enrich(load()));
    return true;
  }
  if (p === '/api/tasks' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
    const title = (b.title || '').toString().trim().slice(0, 200);
    const prompt = (b.prompt || '').toString().trim().slice(0, 20000);
    const model = ['auto', '', 'sonnet', 'opus', 'haiku'].includes(b.model) ? b.model : 'auto';
    if (!prompt) { U.sendJson(res, { error: 'prompt required' }, 400); return true; }
    const list = load();
    list.unshift({ id: newId(), title: title || prompt.slice(0, 60), prompt, model, createdAt: new Date().toISOString(), runId: null, startedAt: null });
    save(list);
    U.sendJson(res, { ok: true });
    return true;
  }
  if (p === '/api/tasks/delete' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const list = load().filter(t => t.id !== b.id);
    save(list);
    U.sendJson(res, { ok: true });
    return true;
  }
  if (p === '/api/tasks/run' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = runTask((b.id || '').toString());
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/tasks/run-all' && req.method === 'POST') {
    U.sendJson(res, runAll());
    return true;
  }
  return false;
}

module.exports = { handle };
