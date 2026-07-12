/*
 * Small persisted hub settings (data/settings.json). Currently just the engine
 * pivot: hermes is a deprecated, paid second stack — OFF by default so the hub
 * runs lean on Claude. A Config-tab toggle flips `hermesEnabled` to bring the
 * hermes engine + agent roles back when the user explicitly wants them.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DATA_DIR = path.join(path.resolve(__dirname, '..'), 'data');
const FILE = path.join(DATA_DIR, 'settings.json');
// `plan` mirrors the Claude subscription usage the app can't fetch live (no
// public API — see the earlier decision) — the user keeps these numbers current
// by hand in Config, and Overview renders them. Defaults from the 2026-07 snapshot.
const DEFAULTS = {
  hermesEnabled: false,
  plan: {
    label: 'Max (5×)',
    sessionPct: 18, sessionResets: '3h 13m',
    weeklyAll: 58, weeklyFable: 86, weeklyResets: 'Tue 1:59 AM',
    creditsSpent: 94.88, creditsPct: 95, creditsResets: 'Aug 1',
  },
};

function load() { return Object.assign({}, DEFAULTS, U.safeJson(FILE) || {}); }

function save(patch) {
  const s = Object.assign(load(), patch);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); } catch {}
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
    if (b.plan && typeof b.plan === 'object') patch.plan = Object.assign({}, load().plan, b.plan, { updatedAt: new Date().toISOString() });
    U.sendJson(res, save(patch));
    return true;
  }
  return false;
}

module.exports = { load, save, handle };
