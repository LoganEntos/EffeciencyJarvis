/*
 * Read-side run queries, split out of runs.js (backlog C1: keep every file
 * under the hard 500-line rule). Pure reads over data/runs/ + the live `active`
 * Map — no spawning, no mutation of run state. createQueries() binds the shared
 * state (RUNS_DIR, active Map, okId guard) so both modules see the same runs.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const liveness = require('./liveness');
const { countArtifacts } = require('./artifacts');

function createQueries({ RUNS_DIR, active, okId }) {
  // Artifact count for one run WITHOUT re-walking the tree when we already
  // know it: finished runs freeze it into meta.artifactCount at finalize, so
  // the only walk is for live runs (few) or legacy metas (lazily backfilled
  // to disk on first read, so it converges to zero walks).
  function artifactCountFor(id, meta, live) {
    if (live) return countArtifacts(id);
    if (typeof meta.artifactCount === 'number') return meta.artifactCount;
    const n = countArtifacts(id);
    meta.artifactCount = n;
    try { fs.writeFileSync(path.join(RUNS_DIR, id, 'meta.json'), JSON.stringify(meta, null, 2)); } catch {}
    return n;
  }

  function listRuns() {
    const rows = [];
    for (const e of U.listDir(RUNS_DIR)) {
      if (!e.isDirectory() || !okId(e.name)) continue;
      const live = active.get(e.name);
      const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
      if (meta) rows.push(Object.assign({ artifactCount: artifactCountFor(e.name, meta, live) }, liveness.annotate(meta, live)));
    }
    return rows.sort((a, b) => (b.queuedAt || b.startedAt || '').localeCompare(a.queuedAt || a.startedAt || '')).slice(0, 200);
  }

  // Today's token usage + completion rate — the header badge polls this every
  // 60s, so it must be cheap: run ids are UTC-ISO timestamps, so today's runs
  // carry today's or (at the UTC/local midnight boundary) yesterday's date
  // prefix. Read only those metas, skip the artifact walk entirely, and
  // return small numbers instead of the whole runs array over the wire
  // (matters on mobile over Tailscale).
  function statsToday() {
    const localToday = new Date().toDateString();
    const now = new Date();
    const p1 = now.toISOString().slice(0, 10);
    const p0 = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    let runs = 0, tokensIn = 0, tokensOut = 0, done = 0, failed = 0, cancelled = 0;
    for (const e of U.listDir(RUNS_DIR)) {
      if (!e.isDirectory() || !okId(e.name)) continue;
      if (!e.name.startsWith(p1) && !e.name.startsWith(p0)) continue;
      const live = active.get(e.name);
      const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
      if (!meta || new Date(meta.startedAt || meta.queuedAt || 0).toDateString() !== localToday) continue;
      runs++;
      tokensIn += meta.tokensIn || 0; tokensOut += meta.tokensOut || 0;
      if (meta.status === 'done') done++; else if (meta.status === 'error') failed++; else if (meta.status === 'cancelled') cancelled++;
    }
    const finished = done + failed + cancelled;
    return {
      runs, tokensIn, tokensOut, tokensTotal: tokensIn + tokensOut,
      completionPct: finished ? Math.round(100 * done / finished) : null,
      day: localToday,
    };
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
    return Object.assign({ artifactCount: artifactCountFor(id, meta, live) }, liveness.annotate(meta, live));
  }

  return { listRuns, routingStats, transcript, getRunMeta, statsToday };
}

module.exports = { createQueries };
