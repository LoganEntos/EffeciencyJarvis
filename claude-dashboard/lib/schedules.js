/*
 * Scheduled runs (roadmap N3): hub-native cron. Recurring prompts persisted in
 * data/schedules.json and fired through the existing run engine, so every
 * scheduled run inherits auto model routing, SSE streaming, history, spend
 * tracking, and Engram memory capture. Zero-dep: a 30s setInterval tick
 * compares persisted nextDue timestamps against the clock (local time).
 * A schedule that came due while the server was off fires once on boot.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const runs = require('./runs');

const DASH_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(DASH_DIR, 'data');
const SCHED_FILE = path.join(DATA_DIR, 'schedules.json');
const KINDS = ['interval', 'daily', 'weekly'];
const MODELS = ['auto', '', 'sonnet', 'opus', 'haiku'];
const TICK_MS = 30 * 1000;
const MIN_INTERVAL_MIN = 15;      // floor so a typo can't hammer the run engine
const DEFER_MS = 5 * 60 * 1000;   // retry delay when a slot isn't free / run still active

function load() { return U.safeJson(SCHED_FILE) || []; }
function save(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCHED_FILE, JSON.stringify(list, null, 2));
}
const newId = () => 's-' + crypto.randomBytes(4).toString('hex');

// ---------- next-due computation (local time) ----------
const okAt = at => typeof at === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(at);

function nextDue(s, from) {
  const base = new Date(from);
  if (s.kind === 'interval') return new Date(base.getTime() + s.minutes * 60000).toISOString();
  const [h, m] = s.at.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  if (s.kind === 'daily') {
    if (d <= base) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  // weekly: advance to the requested day-of-week (0=Sun..6=Sat)
  let add = (s.dow - d.getDay() + 7) % 7;
  if (add === 0 && d <= base) add = 7;
  d.setDate(d.getDate() + add);
  return d.toISOString();
}

function describe(s) {
  if (s.kind === 'interval') return `every ${s.minutes >= 60 && s.minutes % 60 === 0 ? (s.minutes / 60) + 'h' : s.minutes + 'min'}`;
  if (s.kind === 'daily') return `daily at ${s.at}`;
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dow]} at ${s.at}`;
}

// ---------- firing ----------
const settled = st => !st || st === 'done' || st === 'error' || st === 'cancelled' || st === 'gone';

function fire(s) {
  const prompt = `[Scheduled run "${s.title}" — ${describe(s)}]\n\n${s.prompt}`;
  const r = runs.startRun({ prompt, model: s.model || 'auto', permissionMode: 'acceptEdits' });
  if (r.error) { // engine busy — try again shortly without skipping the slot
    s.nextDue = new Date(Date.now() + DEFER_MS).toISOString();
    return null;
  }
  s.lastRunId = r.id;
  s.lastRunAt = new Date().toISOString();
  s.runCount = (s.runCount || 0) + 1;
  s.nextDue = nextDue(s, Date.now());
  return r.id;
}

function tick() {
  const list = load();
  const now = Date.now();
  let changed = false;
  for (const s of list) {
    if (!s.enabled || !s.nextDue || new Date(s.nextDue).getTime() > now) continue;
    // previous scheduled run still going → defer instead of stacking
    const prev = s.lastRunId ? runs.getRunMeta(s.lastRunId) : null;
    if (prev && !settled(prev.status)) s.nextDue = new Date(now + DEFER_MS).toISOString();
    else fire(s);
    changed = true;
  }
  if (changed) save(list);
}

let ticker = null;
function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, TICK_MS);
  setTimeout(tick, 3000); // catch-up pass shortly after boot
}

// last-run status comes live from the run engine, never a stale copy
function enrich(list) {
  return list.map(s => {
    const m = s.lastRunId ? runs.getRunMeta(s.lastRunId) : null;
    return Object.assign({}, s, {
      cadence: describe(s),
      lastRunStatus: m ? m.status : null,
      lastRunCost: m ? m.costUsd : null,
      lastRunModel: m ? m.model : null,
    });
  });
}

// ---------- validation ----------
function parseSchedule(b) {
  const title = (b.title || '').toString().trim().slice(0, 200);
  const prompt = (b.prompt || '').toString().trim().slice(0, 20000);
  if (!prompt) return { error: 'prompt required' };
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: 'kind must be interval | daily | weekly' };
  const model = MODELS.includes(b.model) ? b.model : 'auto';
  const s = { kind, title: title || prompt.slice(0, 60), prompt, model };
  if (kind === 'interval') {
    const min = parseInt(b.minutes, 10);
    if (!Number.isFinite(min) || min < MIN_INTERVAL_MIN || min > 7 * 24 * 60) {
      return { error: `minutes must be ${MIN_INTERVAL_MIN}–${7 * 24 * 60}` };
    }
    s.minutes = min;
  } else {
    if (!okAt(b.at)) return { error: 'at must be HH:MM (24h)' };
    s.at = b.at;
    if (kind === 'weekly') {
      const dow = parseInt(b.dow, 10);
      if (!(dow >= 0 && dow <= 6)) return { error: 'dow must be 0 (Sun) – 6 (Sat)' };
      s.dow = dow;
    }
  }
  return { s };
}

// ---------- routes ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/schedules' && req.method === 'GET') {
    U.sendJson(res, enrich(load()));
    return true;
  }
  if (p === '/api/schedules' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 32 * 1024) || '{}'); } catch {}
    const { s, error } = parseSchedule(b);
    if (error) { U.sendJson(res, { error }, 400); return true; }
    Object.assign(s, {
      id: newId(), enabled: true, createdAt: new Date().toISOString(),
      lastRunId: null, lastRunAt: null, runCount: 0, nextDue: nextDue(s, Date.now()),
    });
    const list = load();
    list.unshift(s);
    save(list);
    U.sendJson(res, { ok: true, id: s.id, nextDue: s.nextDue });
    return true;
  }
  if (p === '/api/schedules/delete' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    save(load().filter(s => s.id !== b.id));
    U.sendJson(res, { ok: true });
    return true;
  }
  if (p === '/api/schedules/toggle' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const list = load();
    const s = list.find(x => x.id === b.id);
    if (!s) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    s.enabled = !s.enabled;
    if (s.enabled) s.nextDue = nextDue(s, Date.now()); // re-arm from now, not the past
    save(list);
    U.sendJson(res, { ok: true, enabled: s.enabled, nextDue: s.nextDue });
    return true;
  }
  if (p === '/api/schedules/run-now' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const list = load();
    const s = list.find(x => x.id === b.id);
    if (!s) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    const runId = fire(s);
    save(list);
    U.sendJson(res, runId ? { ok: true, runId } : { error: 'run engine busy — retry shortly' }, runId ? 200 : 429);
    return true;
  }
  return false;
}

module.exports = { handle, startTicker };
