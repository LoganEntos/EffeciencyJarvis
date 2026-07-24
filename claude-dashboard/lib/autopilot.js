/*
 * Autopilot — an unmonitored self-improvement loop (user request 2026-07-11
 * late night: "need to incorporate efficient self improvement loop that does
 * not need to be monitored... as a new orchestrator agent if the hermes stack
 * cannot handle this"). Researched: hermes-agent's own learning loop distills
 * *skills* from experience, but has no notion of a project backlog to work
 * through unattended — that's exactly the shape of the hub's existing
 * scheduler (lib/schedules.js) and task queue (lib/tasks.js), so autopilot is
 * built as a THIRD hub-native primitive on top of them rather than a new
 * agent stack: a ticker that reads docs/improvement-backlog.md, turns the
 * next open (⬜) row into a task, and fires it through the run engine — same
 * zero-dep, same security invariants, same run history/Engram/spend tracking
 * every other run gets. Default OFF; the user turns it on from Config.
 *
 * Guardrails so "not monitored" doesn't mean "unbounded":
 *   - MAX_INFLIGHT items dispatched-but-not-settled at once (run engine's own
 *     2-active+5-queued cap still governs actual concurrency).
 *   - MAX_ATTEMPTS retries per backlog row before it's parked as "stuck" and
 *     skipped (an infinite retry loop on a bad item would burn budget for
 *     nothing — the user wants USAGE spent on NEW improvements, not the same
 *     failing one forever).
 *   - Every dispatched run is asked to update the backlog row to ✅ itself
 *     and commit — autopilot never rewrites the markdown from Node; it just
 *     tells Claude to, so the same run that fixes the issue also closes the
 *     loop (single source of truth stays the file, not two trackers drifting).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const runs = require('./runs');
const tasks = require('./tasks');

const DASH_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(DASH_DIR, '..');
const DATA_DIR = path.join(DASH_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'autopilot.json');
const BACKLOG_FILE = path.join(REPO_DIR, 'docs', 'improvement-backlog.md');

const TICK_MS = 5 * 60 * 1000;   // check every 5 min — cheap, no LLM in the loop itself
const MAX_INFLIGHT = 2;          // dispatched-but-unsettled autopilot tasks
const MAX_QUEUE_PRESSURE = 3;    // don't add to the run engine if it's already this busy
const MAX_ATTEMPTS = 2;          // per backlog row before parking as stuck

function loadState() {
  return Object.assign({ enabled: false, dispatched: {}, lastTick: null, lastPick: null }, U.safeJson(STATE_FILE) || {});
}
function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ---------- backlog parsing (zero-dep markdown table scan) ----------
// Rows look like: | C3 | lib/agentgraph.js:105 | Persona lookup was exact... | Fix... | S | low | ✅ 2026-07-11 |
// We only need columns: id, location, issue, fix, status-glyph.
function parseBacklog() {
  const txt = U.safeRead(BACKLOG_FILE) || '';
  const items = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*$/);
    if (!m) continue;
    const [, id, loc, issue, fix, , , status] = m;
    items.push({
      id, loc: loc.trim(), issue: issue.trim(), fix: fix.trim(),
      done: /✅/.test(status),
    });
  }
  return items;
}

// ---------- picking the next item ----------
// Returns {type:'backlog', item} | {type:'task', task} | null. Backlog rows come
// first (the curated queue); when the backlog is dry we fall back to the hub
// task queue (A2) so the Tasks tab is the one visible queue instead of a third
// tracker autopilot ignores.
function pickNext(state) {
  const items = parseBacklog();
  for (const it of items) {
    if (it.done) continue;
    const d = state.dispatched[it.id];
    if (d && d.status === 'stuck') continue;               // parked, don't retry forever
    if (d && !['error', 'cancelled', 'gone'].includes(d.status)) continue; // still in flight or already done
    if (d && (d.attempts || 0) >= MAX_ATTEMPTS) continue;   // exhausted retries this session
    return { type: 'backlog', item: it };
  }
  // A2 — backlog empty: dispatch the first never-run hub task. Skip tasks
  // autopilot created itself (source:'autopilot') so it can't feed its own loop,
  // and skip ones already parked stuck. A task gets a runId the moment it fires,
  // so it won't be re-picked next tick.
  for (const t of tasks.load()) {
    if (t.runId || t.source === 'autopilot') continue;
    const d = state.dispatched[t.id];
    if (d && d.status === 'stuck') continue;
    if (d && (d.attempts || 0) >= MAX_ATTEMPTS) continue;
    return { type: 'task', task: t };
  }
  return null;
}

function inflightCount(state) {
  let n = 0;
  for (const id in state.dispatched) {
    const d = state.dispatched[id];
    if (!d.taskId) continue;
    const m = d.runId ? runs.getRunMeta(d.runId) : null;
    const settled = m ? ['done', 'error', 'cancelled', 'gone'].includes(m.status) : !d.runId;
    if (!settled) n++;
  }
  return n;
}

// Re-sync dispatched[].status from the live run engine so pickNext() sees
// fresh outcomes without autopilot having to be the one polling the SSE feed.
function refreshDispatched(state) {
  for (const id in state.dispatched) {
    const d = state.dispatched[id];
    if (!d.runId) continue;
    const m = runs.getRunMeta(d.runId);
    if (m) d.status = m.status;
    if (m && m.status === 'error' && (d.attempts || 0) >= MAX_ATTEMPTS) d.status = 'stuck';
  }
}

function dispatch(state, item) {
  const prompt = `[Autopilot self-improvement task ${item.id} — dispatched unattended, no user review before you act]

Backlog item ${item.id} in docs/improvement-backlog.md:
  Location: ${item.loc || '(n/a)'}
  Issue: ${item.issue}
  Suggested fix: ${item.fix}

Implement this fix in claude-dashboard/, following the project's CLAUDE.md rules
(zero npm deps in the app, files under 500 lines, localhost-only invariants,
X-Hub-Token on every non-GET, no shell-interpreted spawns). If the fix touches
UI, follow the design language in CLAUDE.md and check .claude/skills/ui-design.

When you are done:
1. Run scripts/verify-dashboard.ps1 if the server is reachable and the change
   could affect an endpoint; otherwise just sanity-check the file loads.
2. Edit docs/improvement-backlog.md yourself: change item ${item.id}'s Status
   cell from ⬜ to "✅ " followed by today's date.
3. git add + commit the change (no Co-Authored-By trailer), a short message
   describing the fix.
Keep the total change scoped to this one backlog item — do not bundle unrelated work.`;
  // Code fixes default to opus + high effort (A4): the god prompt only injects on
  // opus-tier runs, and 'auto' would route these short prompts to sonnet/haiku.
  const t = tasks.enqueue({ title: `autopilot: ${item.id} ${item.issue.slice(0, 60)}`, prompt, model: 'opus', effort: 'high', source: 'autopilot' });
  const r = tasks.runTask(t.id);
  const prev = state.dispatched[item.id] || { attempts: 0 };
  state.dispatched[item.id] = {
    taskId: t.id, runId: r.runId || null, status: r.error ? 'error' : 'running',
    attempts: (prev.attempts || 0) + 1, at: new Date().toISOString(),
    error: r.error || null,
  };
  state.lastPick = item.id;
  return r;
}

// Fire a never-run hub task (A2 fallback). Unlike backlog items we don't enqueue
// a new task — we run the existing one — but we still track it in dispatched[]
// (keyed by task id) so inflightCount() and the retry cap cover it too.
function dispatchTask(state, task) {
  const r = tasks.runTask(task.id);
  const prev = state.dispatched[task.id] || { attempts: 0 };
  state.dispatched[task.id] = {
    taskId: task.id, runId: r.runId || null, status: r.error ? 'error' : 'running',
    attempts: (prev.attempts || 0) + 1, at: new Date().toISOString(),
    error: r.error || null, fromQueue: true,
  };
  state.lastPick = task.id;
  return r;
}

function tick() {
  const state = loadState();
  state.lastTick = new Date().toISOString();
  if (!state.enabled) { saveState(state); return; }
  refreshDispatched(state);
  if (inflightCount(state) >= MAX_INFLIGHT) { saveState(state); return; }
  if (runs.runningCount() + runs.queueLength() >= MAX_QUEUE_PRESSURE) { saveState(state); return; } // don't pile onto a busy engine
  const pick = pickNext(state);
  if (pick) {
    state.idle = false; state.idleSince = null;
    pick.type === 'task' ? dispatchTask(state, pick.task) : dispatch(state, pick.item);
  } else {
    // A6 — enabled but nothing to do: surface it instead of idling silently.
    state.idle = true;
    if (!state.idleSince) state.idleSince = new Date().toISOString();
  }
  saveState(state);
}

let ticker = null;
function startTicker() {
  if (ticker) return;
  ticker = setInterval(tick, TICK_MS);
  setTimeout(tick, 10000); // let the hub finish booting first
}

function status() {
  const state = loadState();
  refreshDispatched(state);
  const items = parseBacklog();
  const open = items.filter(i => !i.done);
  const stuck = Object.entries(state.dispatched).filter(([, d]) => d.status === 'stuck').map(([id]) => id);
  // A2 — the task queue is now part of what autopilot can dispatch, so surface
  // how many never-run non-autopilot tasks are waiting behind the backlog.
  let queueOpen = 0;
  try { queueOpen = tasks.load().filter(t => !t.runId && t.source !== 'autopilot').length; } catch {}
  // A6 — "idle" means enabled but nothing to pick (backlog dry AND queue empty).
  const idle = !!state.enabled && open.length === 0 && queueOpen === 0;
  return {
    enabled: state.enabled, lastTick: state.lastTick, lastPick: state.lastPick,
    backlogTotal: items.length, backlogOpen: open.length, backlogDone: items.length - open.length,
    queueOpen, idle, idleSince: idle ? (state.idleSince || null) : null,
    inflight: inflightCount(state), stuck, dispatched: state.dispatched,
  };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/autopilot' && req.method === 'GET') {
    U.sendJson(res, status());
    return true;
  }
  if (p === '/api/autopilot/toggle' && req.method === 'POST') {
    const state = loadState();
    state.enabled = !state.enabled;
    saveState(state);
    if (state.enabled) setTimeout(tick, 500); // pick something up right away
    U.sendJson(res, { ok: true, enabled: state.enabled });
    return true;
  }
  if (p === '/api/autopilot/run-now' && req.method === 'POST') {
    tick();
    U.sendJson(res, status());
    return true;
  }
  return false;
}

module.exports = { handle, startTicker, status };
