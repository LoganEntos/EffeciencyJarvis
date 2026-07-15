/*
 * Personality library — swappable communication personas for hub runs.
 *
 * Each persona is a self-contained markdown file in claude-dashboard/personas/
 * with a small frontmatter head (name, tagline, tone) and a body that IS the
 * system directive injected ahead of the user's prompt (same mechanism as
 * memory recall + team steering in lib/runs.js). Jarvis is persona #1.
 *
 * The active persona is persisted in data/personas.json ({ active: "<id>" }).
 * active = null (or "none") means NO persona injection — plain Claude, used as
 * intended. This is the toggle the user asked for.
 *
 *   GET  /api/personas            -> { personas: [{id,name,tagline,tone,bytes}], active }
 *   POST /api/personas/active     { id }  -> { ok, active }   (id null/"none" = off)
 *
 * Zero dependencies; local files only. Injection stays token-neutral when off.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const PERSONAS_DIR = path.join(DASH_DIR, 'personas');
const STATE_FILE = path.join(DASH_DIR, 'data', 'personas.json');

// A persona id is the filename without .md; validated so it can never escape
// the personas dir (no traversal, no absolute paths).
const okId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);

// Parse the tiny frontmatter head (--- ... ---). Returns { meta, body }.
function parse(raw) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][a-z0-9_]*):\s*(.*)$/i.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: m[2].trim() };
}

// One persona by id (validated). Returns { id, name, tagline, tone, body, bytes }
// or null if missing/invalid.
function load(id) {
  if (!okId(id)) return null;
  const file = path.join(PERSONAS_DIR, id + '.md');
  if (!file.startsWith(PERSONAS_DIR + path.sep)) return null; // defense in depth
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const { meta, body } = parse(raw);
  return {
    id,
    name: meta.name || id,
    tagline: meta.tagline || '',
    tone: meta.tone || '',
    body,
    bytes: Buffer.byteLength(raw),
  };
}

function list() {
  const out = [];
  for (const e of U.listDir(PERSONAS_DIR)) {
    if (e.isFile && !e.isFile()) continue;
    if (!/\.md$/i.test(e.name)) continue;
    const p = load(e.name.replace(/\.md$/i, ''));
    if (p) out.push({ id: p.id, name: p.name, tagline: p.tagline, tone: p.tone, bytes: p.bytes });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function getActiveId() {
  const s = U.safeJson(STATE_FILE);
  // Never configured yet → default to Jarvis (the hub's primary persona). Once
  // the user sets a choice — including turning personas OFF ({active:null}) —
  // that saved choice is honored verbatim.
  if (!s) return fs.existsSync(path.join(PERSONAS_DIR, 'jarvis.md')) ? 'jarvis' : null;
  const id = s.active;
  return okId(id) && fs.existsSync(path.join(PERSONAS_DIR, id + '.md')) ? id : null;
}

function setActiveId(id) {
  const active = (id === null || id === 'none' || id === '') ? null : (okId(id) && load(id) ? id : undefined);
  if (active === undefined) return { error: 'unknown persona' };
  // Soul handoff (pattern from acnlabs/OpenPersona switcher.js generateHandoff,
  // reimplemented zero-dep): switching persona A → B records who is being
  // relieved plus the open task queue, and the NEXT run injects it once so the
  // new persona picks the conversation up mid-stream instead of reintroducing
  // itself. Same-persona re-select or switching to/from "off" carries nothing.
  const prevId = getActiveId();
  let handoff = null;
  if (active && prevId && prevId !== active) {
    const prev = load(prevId);
    if (prev) {
      const tasks = U.safeJson(path.join(DASH_DIR, 'data', 'tasks.json')) || [];
      const pending = (Array.isArray(tasks) ? tasks : []).filter(t => t && !t.runId)
        .slice(0, 5).map(t => String(t.prompt || t.title || '').slice(0, 100)).filter(Boolean);
      handoff = {
        forId: active,
        from: { id: prev.id, name: prev.name, tone: prev.tone },
        at: new Date().toISOString(),
        pending,
      };
    }
  }
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ active, handoff }, null, 2));
  } catch (e) { return { error: 'could not save: ' + e.message }; }
  return { ok: true, active, handoff: !!handoff };
}

// Consume the pending handoff for `id` (one injection, then gone). Returns the
// rendered block or ''. Clearing before returning keeps concurrent runs from
// each re-announcing the switch.
function takeHandoff(id) {
  const s = U.safeJson(STATE_FILE);
  const h = s && s.handoff;
  if (!h || h.forId !== id) return '';
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ active: s.active, handoff: null }, null, 2)); } catch {}
  const pending = (h.pending && h.pending.length)
    ? '\nOpen queue left behind:\n' + h.pending.map(p => '- ' + p).join('\n') : '';
  return `<persona-handoff from="${h.from.name}" at="${h.at}">\n`
    + `You are taking over from the persona "${h.from.name}" (${h.from.tone || 'previous bearing'}). `
    + `The user and the hub are mid-relationship — acknowledge continuity naturally in your first reply; do not reintroduce yourself or restart context.${pending}\n`
    + `</persona-handoff>\n\n`;
}

// Persist a persona file from the editor (Jarvis tab "customize"). New id =
// create; existing id = overwrite. Single-line fields are flattened so they
// can't break the frontmatter; body is the soul itself.
function save(b) {
  const id = b && b.id;
  if (!okId(id)) return { error: 'bad persona id (lowercase letters/digits/-/_ only)' };
  const one = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const body = String(b.body || '').trim();
  if (!body) return { error: 'the persona body (its soul) cannot be empty' };
  if (body.length > 24 * 1024) return { error: 'persona body too large (24 KB max)' };
  const file = path.join(PERSONAS_DIR, id + '.md');
  if (!file.startsWith(PERSONAS_DIR + path.sep)) return { error: 'bad persona id' };
  const md = `---\nname: ${one(b.name) || id}\ntagline: ${one(b.tagline)}\ntone: ${one(b.tone)}\n---\n\n${body}\n`;
  try {
    fs.mkdirSync(PERSONAS_DIR, { recursive: true });
    fs.writeFileSync(file, md);
  } catch (e) { return { error: 'could not save: ' + e.message }; }
  const p = load(id);
  return { ok: true, persona: { id: p.id, name: p.name, tagline: p.tagline, tone: p.tone, bytes: p.bytes } };
}

// Injectable block for lib/runs.js — the active persona's body as a system
// directive, or '' when no persona is active (token-neutral plain Claude).
function activePrefix() {
  const id = getActiveId();
  if (!id) return '';
  const p = load(id);
  if (!p || !p.body) return '';
  return `<persona name="${p.name}">\n${p.body}\n</persona>\n\n` + takeHandoff(id);
}

function activeName() {
  const id = getActiveId();
  if (!id) return null;
  const p = load(id);
  return p ? p.name : null;
}

async function handle(req, res, url) {
  if (url.pathname === '/api/personas' && req.method === 'GET') {
    U.sendJson(res, { personas: list(), active: getActiveId() });
    return true;
  }
  if (url.pathname === '/api/personas/active' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4 * 1024) || '{}'); } catch {}
    const r = setActiveId(b.id === undefined ? null : b.id);
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  // Full persona (incl. body) for the Jarvis-tab editor.
  if (url.pathname === '/api/personas/get' && req.method === 'GET') {
    const p = load(url.searchParams.get('id'));
    U.sendJson(res, p || { error: 'unknown persona' }, p ? 200 : 404);
    return true;
  }
  if (url.pathname === '/api/personas/save' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 64 * 1024) || '{}'); } catch {}
    const r = save(b);
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  return false;
}

module.exports = { handle, activePrefix, activeName, getActiveId, setActiveId, list };
