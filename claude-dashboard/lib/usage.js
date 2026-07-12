/*
 * R0: usage-remaining — the hub's #1 scheduling/delegation signal.
 * Real plan-quota telemetry (Claude Code usage file / hermes via Nous Portal)
 * is a separate wiring task (see docs/roadmap.md R0). Until then this uses
 * actual $ spend from run history against a user-set daily/weekly budget as
 * an honest proxy — never fabricates a cap. If no budget is set, the API
 * reports configured:false and the UI shows a "set your limits" prompt.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const { listRuns } = require('./runs');

const DASH_DIR = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(DASH_DIR, 'data', 'usage-config.json');

function readConfig() {
  return U.safeJson(CONFIG_FILE) || { dailyBudgetUsd: null, weeklyBudgetUsd: null };
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Monday 00:00 local time of the current week.
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  x.setDate(x.getDate() - back);
  return x;
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function costTime(m) { return new Date(m.startedAt || m.queuedAt || 0).getTime(); }

// Human-friendly projected-exhaustion label, or a calm message if the pace
// won't hit the cap within the window (or there's no measurable burn yet).
function projectLabel(now, remaining, burnPerHour, windowMs) {
  if (remaining <= 0) return 'cap reached';
  if (!(burnPerHour > 0)) return 'no spend yet — plenty of runway';
  const hoursLeft = remaining / burnPerHour;
  const eta = new Date(now.getTime() + hoursLeft * 3600000);
  if (eta.getTime() - now.getTime() > windowMs) return 'comfortable at this pace';
  const sameDay = eta.toDateString() === now.toDateString();
  const opts = sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' };
  return 'at this pace, reached ' + eta.toLocaleString(undefined, opts);
}

function usageStats() {
  const cfg = readConfig();
  const runs = listRuns();
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const spendToday = runs.filter(m => costTime(m) >= dayStart.getTime())
    .reduce((s, m) => s + (m.costUsd || 0), 0);
  const spendWeek = runs.filter(m => costTime(m) >= weekStart.getTime())
    .reduce((s, m) => s + (m.costUsd || 0), 0);
  const dayHours = Math.max(0.1, (now - dayStart) / 3600000);
  const weekHours = Math.max(0.1, (now - weekStart) / 3600000);
  const dayBurn = spendToday / dayHours;
  const weekBurn = spendWeek / weekHours;

  const daily = cfg.dailyBudgetUsd;
  const weekly = cfg.weeklyBudgetUsd;
  const today = {
    spend: +spendToday.toFixed(4),
    budget: daily,
    remaining: daily != null ? +(daily - spendToday).toFixed(4) : null,
    pctUsed: daily ? Math.min(100, Math.round(100 * spendToday / daily)) : null,
    burnPerHour: +dayBurn.toFixed(4),
    projection: daily != null ? projectLabel(now, daily - spendToday, dayBurn, 24 * 3600000) : null,
  };
  const week = {
    spend: +spendWeek.toFixed(4),
    budget: weekly,
    remaining: weekly != null ? +(weekly - spendWeek).toFixed(4) : null,
    pctUsed: weekly ? Math.min(100, Math.round(100 * spendWeek / weekly)) : null,
    burnPerHour: +weekBurn.toFixed(4),
    projection: weekly != null ? projectLabel(now, weekly - spendWeek, weekBurn, 7 * 24 * 3600000) : null,
  };
  return { configured: daily != null || weekly != null, today, week };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/usage' && req.method === 'GET') { U.sendJson(res, usageStats()); return true; }
  if (p === '/api/usage/config' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 2000) || '{}'); } catch {}
    const cfg = readConfig();
    if (b.dailyBudgetUsd !== undefined) {
      const v = Number(b.dailyBudgetUsd);
      cfg.dailyBudgetUsd = (b.dailyBudgetUsd === null || b.dailyBudgetUsd === '') ? null : (isFinite(v) && v >= 0 ? v : cfg.dailyBudgetUsd);
    }
    if (b.weeklyBudgetUsd !== undefined) {
      const v = Number(b.weeklyBudgetUsd);
      cfg.weeklyBudgetUsd = (b.weeklyBudgetUsd === null || b.weeklyBudgetUsd === '') ? null : (isFinite(v) && v >= 0 ? v : cfg.weeklyBudgetUsd);
    }
    writeConfig(cfg);
    U.sendJson(res, usageStats());
    return true;
  }
  return false;
}

module.exports = { handle, usageStats };
