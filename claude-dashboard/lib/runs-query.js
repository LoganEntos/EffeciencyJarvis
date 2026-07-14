/*
 * Read-side run queries, split out of runs.js (backlog C1: keep every file
 * under the hard 500-line rule). Pure reads over data/runs/ + the live `active`
 * Map — no spawning, no mutation of run state. createQueries() binds the shared
 * state (RUNS_DIR, active Map, okId guard) so both modules see the same runs.
 */
'use strict';
const path = require('path');
const U = require('./util');
const liveness = require('./liveness');
const { countArtifacts } = require('./artifacts');

function createQueries({ RUNS_DIR, active, okId }) {
  function listRuns() {
    const rows = [];
    for (const e of U.listDir(RUNS_DIR)) {
      if (!e.isDirectory() || !okId(e.name)) continue;
      const live = active.get(e.name);
      const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
      if (meta) rows.push(Object.assign({ artifactCount: countArtifacts(e.name) }, liveness.annotate(meta, live)));
    }
    return rows.sort((a, b) => (b.queuedAt || b.startedAt || '').localeCompare(a.queuedAt || a.startedAt || '')).slice(0, 200);
  }

  // N4: routing-accuracy feedback — how routeModel()'s auto picks are working
  // out, from run outcomes already on disk (zero-cost heuristics, no LLM):
  //   miss     = auto-routed run errored
  //   over?    = opus pick that finished fast + cheap (didn't need the big gun)
  //   under?   = haiku pick that errored, or ground for >90s
  function routingStats() {
    const rows = listRuns().filter(m => m.routedReason && m.engine !== 'hermes');
    const byModel = {};
    const suspects = [];
    for (const m of rows) {
      const k = m.model || '?';
      const b = byModel[k] = byModel[k] || { n: 0, done: 0, error: 0, cost: 0 };
      b.n++; if (m.status === 'done') b.done++; if (m.status === 'error') b.error++;
      b.cost = +(b.cost + (m.costUsd || 0)).toFixed(4);
      if (k === 'haiku' && m.status === 'error') {
        suspects.push({ id: m.id, model: k, why: 'haiku pick errored — likely under-routed', prompt: m.promptExcerpt });
      } else if (k === 'haiku' && m.status === 'done' && (m.durationMs || 0) > 90000) {
        suspects.push({ id: m.id, model: k, why: 'haiku pick ground for >90s — maybe under-routed', prompt: m.promptExcerpt });
      } else if (k === 'opus' && m.status === 'done' && (m.durationMs || 0) < 12000 && (m.costUsd || 0) < 0.05) {
        suspects.push({ id: m.id, model: k, why: 'opus pick finished fast + cheap — maybe over-routed', prompt: m.promptExcerpt });
      }
    }
    const ok = rows.filter(m => m.status === 'done').length;
    return { total: rows.length, ok, suspects: suspects.slice(0, 20), byModel };
  }

  function transcript(id) {
    if (!okId(id)) return null;
    const dir = path.join(RUNS_DIR, id);
    const live = active.get(id);
    const meta = liveness.annotate(live ? live.meta : U.safeJson(path.join(dir, 'meta.json')), live);
    if (!meta) return null;
    const raw = U.safeRead(path.join(dir, 'output.jsonl')) || '';
    const lines = raw.split('\n').filter(l => l.trim());
    // cap the payload — keep first 2 lines (init) + tail
    const capped = lines.length > 1500 ? lines.slice(0, 2).concat(lines.slice(-1498)) : lines;
    return { meta, prompt: U.safeRead(path.join(dir, 'prompt.txt')) || '', lines: capped, truncated: capped.length < lines.length };
  }

  // live-or-disk meta for one run (used by the task queue to track task status)
  function getRunMeta(id) {
    if (!okId(id)) return null;
    const live = active.get(id);
    const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, id, 'meta.json'));
    if (!meta) return null;
    return Object.assign({ artifactCount: countArtifacts(id) }, liveness.annotate(meta, live));
  }

  return { listRuns, routingStats, transcript, getRunMeta };
}

module.exports = { createQueries };
