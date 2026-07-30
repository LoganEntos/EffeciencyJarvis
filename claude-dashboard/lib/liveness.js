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
// Is `pid` still a live process? EPERM means it exists but isn't ours.
function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function reapOrphans(runsDir, active, onOrphan) {
  let reaped = 0;
  for (const e of U.listDir(runsDir)) {
    if (!e.isDirectory()) continue;
    if (active && active.has(e.name)) continue; // genuinely live — leave alone
    const mp = path.join(runsDir, e.name, 'meta.json');
    const meta = U.safeJson(mp);
    if (!meta || (meta.status !== 'running' && meta.status !== 'queued')) continue;
    // `active` only knows about runs THIS process launched. A second hub
    // instance — the throwaway :5758 verify server every handoff tells agents to
    // boot, or a restart child that never took the port — shares data/runs and
    // would otherwise reap the real hub's in-flight runs, rewriting a live run
    // to error+orphaned (seen live 2026-07-27: two successful autopilot runs
    // flipped to error mid-flight, which then drove duplicate retries and
    // A5 auto-continuations of already-finished work). Only reap what we own or
    // what nobody owns any more.
    if (pidAlive(meta.hubPid)) continue;
    meta.status = 'error';
    meta.endedAt = meta.endedAt || new Date().toISOString();
    meta.orphaned = true;
    meta.errorExcerpt = 'orphaned — the hub restarted or the process died while this run was active';
    let wrote = false;
    try { fs.writeFileSync(mp, JSON.stringify(meta, null, 2)); wrote = true; reaped++; } catch {}
    // Sleep/restart safeguard: a RECENT orphan (≤12h) with a resumable session
    // is handed to the caller to auto-continue (primary hub only — runs.js).
    // Only after the terminal status hit disk: a second instance sweeping the
    // same dir sees error (not running/queued) and can never double-fire.
    if (wrote && onOrphan && meta.sessionId && !meta.continuedBy
        && (meta.continuations || 0) < 2
        && Date.now() - (Date.parse(meta.startedAt || meta.queuedAt || 0) || 0) < 12 * 3600000) {
      try { onOrphan(meta); } catch {}
    }
  }
  return reaped;
}

function startReaper(runsDir, active, onOrphan) {
  reapOrphans(runsDir, active, onOrphan); // sweep once at boot
  const t = setInterval(() => reapOrphans(runsDir, active, onOrphan), REAP_MS);
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
// hermes -z streams nothing on stdout, so we follow its activity log as a
// best-effort mid-run window. NOTE (verified live 2026-07-11): a short -z run
// logs only boot-time plugin registration to agent.log — no tool/model/step
// lines at the default level — so this mostly stays quiet and the heartbeat is
// what proves liveness. It still surfaces warnings/errors and any activity a
// longer run does emit. Richer per-step content would need the ACP/serve event
// stream (future, ties into H4), not this file. The log is global, so with
// concurrent hermes runs lines can interleave — acceptable (usually one).
const LOG_NOISE = /registered .* provider|Plugin discovery complete|hermes_cli\.plugins|Loaded plugin|Ctrl\+C to stop|\[since=|^-{2,}|^\s*$/i;
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
  child.stdout.on('error', () => {}); // broken-pipe/fd error on tail stdout must not crash the hub (cf. C28/C29/C35)
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
