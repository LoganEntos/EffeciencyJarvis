/*
 * Engram-style semantic memory — SEMANTIC OVER VECTORS.
 * Typed memory records (episodic / semantic / procedural) with lexical + tag +
 * recency + importance retrieval. No embeddings, no vector DB, no LLM in the
 * hot path — the ENGRAM (arxiv 2511.12960) approach: structure + typing gives
 * semantic recall at a fraction of vector-RAG's token/infra cost.
 *
 * Store: data/memory.json (plain JSON, portable, zero-dep).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(DASH_DIR, 'data');
const MEM_FILE = path.join(DATA_DIR, 'memory.json');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const TYPES = ['episodic', 'semantic', 'procedural'];

// ---------- store ----------
function load() { return U.safeJson(MEM_FILE) || []; }
function save(list) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MEM_FILE, JSON.stringify(list, null, 2)); }
const newId = () => 'm-' + crypto.randomBytes(4).toString('hex');

// ---------- text → tokens/tags (rule-based, no LLM) ----------
const STOP = new Set(('the a an and or but of to in on for with at by from as is are was were be been being this that these those it its into out up down over under again then once here there all any both each few more most other some such no nor not only own same so than too very can will just should now do does did done have has had i you he she they we me my your our their run hub claude prompt file files add fix use make create').split(' '));
function tokenize(s) {
  return (s || '').toLowerCase().match(/[a-z0-9][a-z0-9_.-]{1,}/g) || [];
}
function keywords(s, n = 8) {
  const freq = {};
  for (const t of tokenize(s)) if (!STOP.has(t) && t.length > 2) freq[t] = (freq[t] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

// ---------- capture (episodic, from a finished run) ----------
// C4: captureRun() and reindexRuns() built the identical episodic-record
// object twice — extracted so a shape change only needs one edit.
function buildEpisodicRecord(meta, promptText) {
  const prompt = (promptText
    || U.safeRead(path.join(RUNS_DIR, meta.id, 'prompt.txt'))
    || meta.promptExcerpt || '').toString();
  const outcome = meta.status === 'done' ? 'succeeded'
    : meta.status === 'error' ? 'FAILED: ' + (meta.errorExcerpt || 'error') : (meta.status || 'ran');
  const importance = meta.status === 'error' ? 0.8 : (meta.artifactCount ? 0.6 : 0.4);
  const tags = keywords(prompt);
  // A run launched inside a Project is tagged with its slug, so project-scoped
  // recall (recallForProject) can find this run's episode next time — the loop
  // that makes a Project "function with memory" without any vectors.
  if (meta.projectSlug) tags.unshift(meta.projectSlug);
  return {
    id: newId(), type: 'episodic',
    title: (meta.promptExcerpt || prompt).slice(0, 80),
    text: `Run ${outcome} on ${(meta.model || 'default')}. Prompt: ${prompt.slice(0, 400)}`,
    tags, importance,
    createdAt: meta.startedAt || meta.queuedAt || new Date().toISOString(),
    sourceRunId: meta.id,
    fields: { status: meta.status, model: meta.model, costUsd: meta.costUsd, artifactCount: meta.artifactCount || 0, error: meta.errorExcerpt || null, projectSlug: meta.projectSlug || null },
  };
}

function captureRun(meta, promptText) {
  if (!meta || !meta.id) return;
  const list = load();
  if (list.some(m => m.sourceRunId === meta.id)) return; // dedupe
  list.unshift(buildEpisodicRecord(meta, promptText));
  save(list.slice(0, 2000));
  if (meta.status === 'error') distill(); // failures may complete a pattern
}

// Backfill episodic memory from every run already on disk (free, no LLM).
function reindexRuns() {
  const list = load();
  const have = new Set(list.filter(m => m.sourceRunId).map(m => m.sourceRunId));
  let added = 0;
  for (const e of U.listDir(RUNS_DIR)) {
    if (!e.isDirectory() || have.has(e.name)) continue;
    const meta = U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
    if (!meta) continue;
    list.push(buildEpisodicRecord(Object.assign({ id: e.name }, meta)));
    added++;
  }
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  save(list.slice(0, 2000));
  distill();
  return { added, total: list.length };
}

// ---------- retrieval: lexical + tag + recency + importance (no vectors) ----------
function score(rec, qTokens, qSet, idf, now) {
  const recTokens = tokenize(rec.title + ' ' + rec.text + ' ' + (rec.tags || []).join(' '));
  const tf = {};
  for (const t of recTokens) tf[t] = (tf[t] || 0) + 1;
  // BM25-ish lexical over query terms
  let lex = 0;
  const k1 = 1.4, len = recTokens.length || 1;
  for (const t of qTokens) {
    const f = tf[t] || 0;
    if (!f) continue;
    lex += (idf[t] || 1) * (f * (k1 + 1)) / (f + k1 * (0.4 + 0.6 * len / 60));
  }
  const tagBoost = (rec.tags || []).reduce((s, t) => s + (qSet.has(t) ? 1 : 0), 0) * 1.2;
  const ageDays = (now - new Date(rec.createdAt || 0).getTime()) / 86400000;
  const recency = Math.exp(-ageDays / 21) * 0.8;         // ~3-week half-life
  const imp = (rec.importance || 0.4) * 0.6;
  return lex + tagBoost + recency + imp;
}

// Rank a given pool of records against a query (shared by search + project
// recall). idf is computed over the pool so scoring adapts to its size.
function rank(pool, q, limit, dropZero) {
  const qTokens = tokenize(q).filter(t => !STOP.has(t));
  if (!qTokens.length) return pool.slice(0, limit).map(m => ({ ...m, _score: 0 }));
  const df = {}; const qSet = new Set(qTokens);
  for (const rec of pool) {
    const seen = new Set(tokenize(rec.title + ' ' + rec.text + ' ' + (rec.tags || []).join(' ')));
    for (const t of qSet) if (seen.has(t)) df[t] = (df[t] || 0) + 1;
  }
  const N = pool.length || 1;
  const idf = {};
  for (const t of qTokens) idf[t] = Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5));
  const now = Date.now();
  let out = pool.map(m => ({ ...m, _score: score(m, qTokens, qSet, idf, now) }));
  if (dropZero) out = out.filter(m => m._score > 0);
  return out.sort((a, b) => b._score - a._score).slice(0, limit);
}

function search(q, opts = {}) {
  const list = load();
  const type = TYPES.includes(opts.type) ? opts.type : null;
  const pool = type ? list.filter(m => m.type === type) : list;
  return rank(pool, q, opts.limit || 20, true);
}

// Project-scoped recall — the same engram scoring restricted to records tagged
// with a project's slug (its own runs + notes). No vectors, no LLM: just the
// project's own pool ranked by lexical + tag + recency + importance. Returns
// the ranked items (for the Projects tab) and, when forInjection, a small
// capped context block for the run prompt (only genuinely relevant hits).
function recallForProject(slug, query, opts = {}) {
  const pool = load().filter(m => (m.tags || []).includes(slug));
  if (!pool.length) return { items: [], injection: null };
  const items = rank(pool, query || slug, opts.limit || 5, false);
  if (!opts.forInjection) return { items, injection: null };
  const strong = items.filter(m => m._score > 1);
  const lines = []; let used = 0; const cap = opts.capChars || 1000;
  for (const m of strong) {
    const line = `- [${m.type}] ${m.title}: ${m.text}`.slice(0, 300);
    if (used + line.length > cap) break;
    lines.push(line); used += line.length;
  }
  const injection = lines.length
    ? { count: lines.length, block: `[Project memory — relevant past work in this project, use if helpful:\n${lines.join('\n')}]` }
    : null;
  return { items, injection };
}

// ---------- recall into runs (N3.5, opt-in) ----------
// Compact context block for prompt injection: top-k relevant memories, hard
// character cap so the token cost stays small and predictable.
function recall(prompt, k = 3, capChars = 1200) {
  const hits = search(prompt, { limit: k }).filter(m => m._score > 1);
  if (!hits.length) return null;
  const lines = [];
  let used = 0;
  for (const m of hits) {
    const line = `- [${m.type}] ${m.title}: ${m.text}`.slice(0, 400);
    if (used + line.length > capChars) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return null;
  return { count: lines.length, block: `[Hub memory recall — relevant past context, use if helpful:\n${lines.join('\n')}]` };
}

// ---------- distillation (rule-based, no LLM) ----------
// Episodic → semantic: a tag that shows up in 3+ FAILED runs becomes one
// standing "watch out" fact (updated in place, never duplicated).
function distill() {
  const list = load();
  const failTag = {};
  for (const m of list) {
    if (m.type !== 'episodic' || !m.fields || m.fields.status !== 'error') continue;
    for (const t of (m.tags || [])) {
      failTag[t] = failTag[t] || { n: 0, lastError: null };
      failTag[t].n++;
      if (!failTag[t].lastError) failTag[t].lastError = m.fields.error || '';
    }
  }
  let changed = false;
  for (const [tag, info] of Object.entries(failTag)) {
    if (info.n < 3) continue;
    const title = `failure pattern: ${tag}`;
    const text = `${info.n} runs mentioning "${tag}" have failed. Most recent error: ${(info.lastError || 'unknown').slice(0, 200)}`;
    const existing = list.find(m => m.type === 'semantic' && m.title === title);
    if (existing) { if (existing.text !== text) { existing.text = text; changed = true; } }
    else {
      list.unshift({ id: newId(), type: 'semantic', title, text, tags: [tag, 'failure-pattern'],
        importance: 0.9, createdAt: new Date().toISOString(), sourceRunId: null, fields: {} });
      changed = true;
    }
  }
  if (changed) save(list);
}

function addNote(type, title, text, tags, importance) {
  const list = load();
  list.unshift({
    id: newId(), type: TYPES.includes(type) ? type : 'semantic',
    title: (title || text || '').toString().slice(0, 80),
    text: (text || '').toString().slice(0, 4000),
    tags: (Array.isArray(tags) && tags.length) ? tags.slice(0, 12) : keywords(title + ' ' + text),
    importance: typeof importance === 'number' ? Math.max(0, Math.min(1, importance)) : 0.7,
    createdAt: new Date().toISOString(), sourceRunId: null, fields: {},
  });
  save(list);
  return { ok: true };
}

function stats() {
  const list = load();
  const by = {};
  for (const t of TYPES) by[t] = list.filter(m => m.type === t).length;
  return { total: list.length, byType: by };
}

// ---------- routes ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/memory' && req.method === 'GET') {
    // browse (optionally filtered by type), newest first
    const type = url.searchParams.get('type');
    const list = load().filter(m => !type || m.type === type);
    U.sendJson(res, { stats: stats(), items: list.slice(0, 100) });
    return true;
  }
  if (p === '/api/memory/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || '';
    U.sendJson(res, search(q, { type, limit: 30 }));
    return true;
  }
  if (p === '/api/memory' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
    if (!b.text && !b.title) { U.sendJson(res, { error: 'text required' }, 400); return true; }
    U.sendJson(res, addNote(b.type, b.title, b.text, b.tags, b.importance));
    return true;
  }
  if (p === '/api/memory/delete' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    save(load().filter(m => m.id !== b.id));
    U.sendJson(res, { ok: true });
    return true;
  }
  if (p === '/api/memory/reindex' && req.method === 'POST') {
    U.sendJson(res, reindexRuns());
    return true;
  }
  return false;
}

module.exports = { handle, captureRun, reindexRuns, search, recall, recallForProject, addNote, distill };
