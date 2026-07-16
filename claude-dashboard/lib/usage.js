/*
 * R0: usage-remaining — the hub's #1 scheduling/delegation signal.
 * Real plan-quota telemetry (Claude Code usage file / hermes via Nous Portal)
 * is a separate wiring task (see docs/roadmap.md R0). Reports token volume +
 * completion rate for today/this week — no dollar figures anywhere (user
 * directive 2026-07-16: tokens + % efficiency/completion, never cost).
 */
'use strict';
const U = require('./util');
const { listRuns } = require('./runs');

// Monday 00:00 local time of the current week.
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days since Monday
  x.setDate(x.getDate() - back);
  return x;
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function runTime(m) { return new Date(m.startedAt || m.queuedAt || 0).getTime(); }

function windowStats(runs, start, now) {
  const set = runs.filter(m => runTime(m) >= start.getTime());
  const tokensIn = set.reduce((s, m) => s + (m.tokensIn || 0), 0);
  const tokensOut = set.reduce((s, m) => s + (m.tokensOut || 0), 0);
  const done = set.filter(m => m.status === 'done').length;
  const failed = set.filter(m => m.status === 'error').length;
  const cancelled = set.filter(m => m.status === 'cancelled').length;
  const finished = done + failed + cancelled;
  const hours = Math.max(0.1, (now - start) / 3600000);
  return {
    runs: set.length, done, failed, cancelled,
    tokensIn, tokensOut, tokensTotal: tokensIn + tokensOut,
    tokensPerHour: Math.round((tokensIn + tokensOut) / hours),
    completionPct: finished ? Math.round(100 * done / finished) : null,
  };
}

function usageStats() {
  const runs = listRuns();
  const now = new Date();
  return {
    today: windowStats(runs, startOfDay(now), now),
    week: windowStats(runs, startOfWeek(now), now),
  };
}

async function handle(req, res, url) {
  if (url.pathname === '/api/usage' && req.method === 'GET') { U.sendJson(res, usageStats()); return true; }
  return false;
}

module.exports = { handle, usageStats };
