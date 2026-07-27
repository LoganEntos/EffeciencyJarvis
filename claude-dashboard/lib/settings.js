/*
 * Small persisted hub settings (data/settings.json). Currently just the engine
 * pivot: hermes is a deprecated, paid second stack — OFF by default so the hub
 * runs lean on Claude. A Config-tab toggle flips `hermesEnabled` to bring the
 * hermes engine + agent roles back when the user explicitly wants them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');

const DATA_DIR = path.join(path.resolve(__dirname, '..'), 'data');
const FILE = path.join(DATA_DIR, 'settings.json');
// `plan` mirrors the Claude subscription usage the app can't fetch live (no
// public API — see the earlier decision) — the user keeps these numbers current
// by hand in Config, and Overview renders them. Defaults from the 2026-07 snapshot.
const DEFAULTS = {
  hermesEnabled: false,
  // C38 runaway guardrails for headless spawns: hard spend cap + turn cap
  // passed to the claude CLI (--max-budget-usd / --max-turns, both print-mode).
  // Unattended autopilot/scheduled runs otherwise have no ceiling on a runaway
  // prompt. Generous by default (a safety net, not a tight leash); set either to
  // 0 to omit that flag entirely if a spawned CLI ever errors on it.
  runGuardrails: { maxBudgetUsd: 10, maxTurns: 80 },
  plan: {
    label: 'Max (5×)',
    sessionPct: 18, sessionResets: '3h 13m',
    weeklyAll: 58, weeklyFable: 86, weeklyResets: 'Tue 1:59 AM',
    creditsSpent: 94.88, creditsPct: 95, creditsResets: 'Aug 1',
  },
};

function load() { return Object.assign({}, DEFAULTS, U.safeJson(FILE) || {}); }

// Atomic write (temp + rename) mirroring lib/tasks.js so a concurrent GET load()
// can never read a half-written settings.json (which safeJson would null → the
// app transiently falling back to DEFAULTS). Unique tmp name so two concurrent
// POSTs can't clobber each other's temp file before the rename. Errors propagate
// — never swallow a failed write and report false success to the client.
function save(patch) {
  const s = Object.assign(load(), patch);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  return s;
}

async function handle(req, res, url) {
  if (url.pathname !== '/api/settings') return false;
  if (req.method === 'GET') { U.sendJson(res, load()); return true; }
  if (req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const patch = {};
    if (typeof b.hermesEnabled === 'boolean') patch.hermesEnabled = b.hermesEnabled;
    if (b.runGuardrails && typeof b.runGuardrails === 'object') {
      const g = load().runGuardrails, r = {};
      // Clamp to sane, non-negative bounds; 0 disables the corresponding flag.
      const budget = Number(b.runGuardrails.maxBudgetUsd);
      const turns = Number(b.runGuardrails.maxTurns);
      r.maxBudgetUsd = Number.isFinite(budget) && budget >= 0 ? Math.min(budget, 1000) : g.maxBudgetUsd;
      r.maxTurns = Number.isFinite(turns) && turns >= 0 ? Math.min(Math.floor(turns), 10000) : g.maxTurns;
      patch.runGuardrails = r;
    }
    if (b.plan && typeof b.plan === 'object') patch.plan = Object.assign({}, load().plan, b.plan, { updatedAt: new Date().toISOString() });
    try { U.sendJson(res, save(patch)); }
    catch (e) { U.sendJson(res, { error: 'could not persist settings: ' + e.message }, 500); }
    return true;
  }
  return false;
}

module.exports = { load, save, handle };
