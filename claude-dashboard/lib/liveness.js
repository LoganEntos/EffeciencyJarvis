/*
 * Liveness: make an active run's real status observable, for BOTH agent stacks.
 *
 * The problem this fixes (user-flagged, "serious"): a run marked "running" was
 * indistinguishable from one that had stalled or died. Hermes -z in particular
 * prints ONLY its final text — nothing streams mid-run — so its output file
 * stays empty for minutes and looks identical to a zombie. And a run left
 * "running" on disk after a hub crash/restart lied about its status forever.
 *
 * Three mechanisms, none of which change how a run is spawned:
 *   1. Orphan reaper  — a disk run marked running/queued that is NOT in the
 *      live map can only be a crash/restart orphan; rewrite it to a terminal
 *      error so history stops lying.
 *   2. Heartbeat      — while a run is live, broadcast elapsed/idle/alive every
 *      few seconds so the UI shows liveness even when nothing is streaming.
 *   3. Hermes log tail — follow hermes's own timestamped activity log so a -z
 *      run's real work (model calls, tool use) becomes visible mid-run.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');

const STALL_MS = 120000;   // silence this long on a LIVE run => flag "stalled"
const HEARTBEAT_MS = 5000; // liveness broadcast cadence
const REAP_MS = 60000;     // orphan sweep cadence

// ---- 1. orphan reaper ---------------------------------------------------
// A run whose meta.json says running/queued but which is NOT in the live
// `active` map can only be a crash/restart orphan (the process that owned it
// is gone and child.on('close') can never fire for it). Make it terminal.
function reapOrphans(runsDir, active) {
  let reaped = 0;
  for (const e of U.listDir(runsDir)) {
    if (!e.isDirectory()) continue;
    if (active && active.has(e.name)) continue; // genuinely live — leave alone
    const mp = path.join(runsDir, e.name, 'meta.json');
    const meta = U.safeJson(mp);
    if (!meta || (meta.status !== 'running' && meta.status !== 'queued')) continue;
    meta.status = 'error';
    meta.endedAt = meta.endedAt || new Date().toISOString();
    meta.orphaned = true;
    meta.errorExcerpt = 'orphaned — the hub restarted or the process died while this run was active';
    try { fs.writeFileSync(mp, JSON.stringify(meta, null, 2)); reaped++; } catch {}
  }
  return reaped;
}

function startReaper(runsDir, active) {
  reapOrphans(runsDir, active); // sweep once at boot
  const t = setInterval(() => reapOrphans(runsDir, active), REAP_MS);
  if (t.unref) t.unref();
  return t;
}

// ---- 2. liveness annotation --------------------------------------------
function procAlive(st) {
  return !!(st && st.child && st.child.exitCode === null
    && st.child.signalCode === null && !st.child.killed);
}

// Return a COPY of meta with live fields (idleMs / procAlive / stalled) added
// for running runs — never mutate st.meta (it gets written to disk).
function annotate(meta, st, now) {
  if (!meta) return meta;
  const out = Object.assign({}, meta);
  if (meta.status === 'running' && st) {
    now = now || Date.now();
    const last = st.lastLineAt || Date.parse(meta.startedAt) || now;
    out.idleMs = Math.max(0, now - last);
    out.procAlive = procAlive(st);
    out.stalled = out.procAlive && out.idleMs > STALL_MS;
  }
  return out;
}

// ---- 3. heartbeat -------------------------------------------------------
// Broadcast (never persisted) so an attached client sees the run is alive and
// how long it has been silent, even when the stream itself is quiet.
function startHeartbeat(st, broadcast) {
  stopHeartbeat(st);
  st._hb = setInterval(() => {
    if (st.meta.status !== 'running') return;
    const now = Date.now();
    const started = Date.parse(st.meta.startedAt) || now;
    const idleMs = Math.max(0, now - (st.lastLineAt || started));
    const alive = procAlive(st);
    broadcast(st, 'heartbeat', JSON.stringify({
      elapsedMs: now - started, idleMs, procAlive: alive,
      stalled: alive && idleMs > STALL_MS, engine: st.meta.engine,
    }));
  }, HEARTBEAT_MS);
  if (st._hb.unref) st._hb.unref();
}
function stopHeartbeat(st) { if (st && st._hb) { clearInterval(st._hb); st._hb = null; } }

// ---- 4. hermes live log tail -------------------------------------------
// hermes -z streams nothing, but hermes writes a timestamped activity log;
// follow it so the run's real work surfaces mid-run. Best-effort: any failure
// here leaves the run itself untouched. The log is global, so with concurrent
// hermes runs lines can interleave — acceptable (typically one at a time).
const LOG_NOISE = /registered .* provider|Plugin discovery complete|hermes_cli\.plugins|Loaded plugin|^\s*$/i;
function stripLogPrefix(line) {
  // "2026-07-11 21:04:19,372 INFO hermes_cli.foo: message" -> "message"
  const m = line.match(/^\d{4}-\d\d-\d\d[ T][\d:,]+\s+(?:[A-Z]+\s+)?[\w.]+:\s*(.*)$/);
  return m ? m[1] : line;
}
function startHermesTail(st, hermesExe, pushLog, maxLines = 800) {
  let child;
  try {
    child = spawn(hermesExe, ['logs', 'agent', '-f', '--since', '3s'], { windowsHide: true });
  } catch { return; }
  st._tail = child;
  let buf = '', count = 0;
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const raw = U.stripAnsi(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
      if (st.meta.status !== 'running' || count >= maxLines) continue;
      if (!raw.trim() || LOG_NOISE.test(raw)) continue;
      const text = stripLogPrefix(raw).trim();
      if (!text) continue;
      count++;
      pushLog(st, text.slice(0, 500));
    }
  });
  child.on('error', () => {});
}
function stopHermesTail(st) {
  if (st && st._tail) { try { st._tail.kill(); } catch {} st._tail = null; }
}

module.exports = {
  reapOrphans, startReaper, annotate, procAlive,
  startHeartbeat, stopHeartbeat, startHermesTail, stopHermesTail,
  STALL_MS,
};
