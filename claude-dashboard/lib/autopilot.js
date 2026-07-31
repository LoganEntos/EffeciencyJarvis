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
const crypto = require('crypto');
const U = require('./util');
const runs = require('./runs');
const tasks = require('./tasks');

const DASH_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(DASH_DIR, '..');
const DATA_DIR = path.join(DASH_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'autopilot.json');
const BACKLOG_FILE = path.join(REPO_DIR, 'docs', 'improvement-backlog.md');
// Phase 2 (gap A) — the Projects-tab TODO checklist, a THIRD pickable source.
const PROJECTS_TODO_FILE = path.join(DATA_DIR, 'todos', 'projects.md');

const TICK_MS = 5 * 60 * 1000;   // check every 5 min — cheap, no LLM in the loop itself
const MAX_INFLIGHT = 2;          // dispatched-but-unsettled autopilot tasks
const MAX_QUEUE_PRESSURE = 3;    // don't add to the run engine if it's already this busy
const MAX_ATTEMPTS = 2;          // per backlog row before parking as stuck

function loadState() {
  // projectsBacklogEnabled (Phase 2, gap A) is Phase 2's OWN gate, separate from
  // and IN ADDITION to `enabled`: BOTH must be true for the Projects-tab TODO
  // source to ever be consulted (see pickNext + tick). Deliberately settable ONLY
  // by a human hand-editing data/autopilot.json — no UI control or API route flips
  // it, so "work my Projects backlog unattended" stays a distinct, high-friction,
  // unmistakable decision, never an accidental click.
  return Object.assign({ enabled: false, dispatched: {}, lastTick: null, lastPick: null, projectsBacklogEnabled: false }, U.safeJson(STATE_FILE) || {});
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
    if (!/^\s*\|/.test(line)) continue;
    // Split on UNESCAPED pipes so a cell may contain `\|`; drop the leading/
    // trailing empty cells the table border produces, then un-escape.
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
    if (cells.length !== 7) continue;
    const [id, loc, issue, fix, , , status] = cells;
    if (!/^[A-Z]\d+$/.test(id)) continue;
    // Open ONLY if explicitly ⬜ (and not done). ⚠️/blocked rows are NOT open —
    // treat them as done so pickNext skips known-unfixable items (e.g. C43 CUDA).
    items.push({ id, loc, issue, fix, status, done: !(/⬜/.test(status) && !/✅/.test(status)) });
  }
  return items;
}

// ---------- human-in-the-loop eligibility gate (defense-in-depth) ----------
// A projects-backlog checklist line is NOT pickable by autopilot if its own text
// — or any `>` note lines that trail it — says a human must decide/act first. This
// is a HARD exclusion, independent of projectsBacklogEnabled: even if that flag is
// ever turned on, an item a human explicitly reserved for themselves must never be
// dispatched unattended (the two open VPP items in projects.md today both say so —
// one needs the user to define destructive-delete semantics, the other needs human
// review of ambiguous source documents, "not a script"). We err toward EXCLUDING
// on any match: a false-exclude just leaves a todo for a person (safe); a
// false-include fires an unmonitored run on something a human said needs their
// judgment (the exact failure mode this exists to prevent). Pure + exported so it
// is unit-testable; pass the item line joined with its `>` notes.
//
// Sanity checks (see the `node -e` in the commit trail):
//   isHumanBlocked('Step 9 — batched processing runs once the user green-lights the skill') === true
//   isHumanBlocked('Remaining 7 orders all need a human, not a script fix')                 === true
//   isHumanBlocked('Waiting on user sign-off before building the conversion skill')          === true
//   isHumanBlocked('dead server route GET /api/projects/reconcile — rebuild the index')      === false
const HUMAN_BLOCK_RE = [
  /needs?\s+(?:a\s+|the\s+)?user\b/i,              // "needs a user", "needs the user", "need user"
  /needs?\s+your\s+call\b/i,                        // "needs your call"
  /\buser\s+(?:sign-?off|go-?ahead|green-?light|decision|call|input|review|approval)/i,
  /green-?lights?\b/i,                              // "green-lights the skill"
  /\bsign-?off\b/i,                                 // "sign-off" / "sign off"
  /human\s+(?:review|must|decision|judg\w*|look|eyes?|pick|call|input|attention|different)/i,
  /needs?\s+(?:a\s+)?human/i,                       // "needs a human", "need a human"
  /\bby\s+a\s+human\b/i,
  /\ba\s+human\s+look\b/i,
  /waiting\s+on\s+(?:you|the\s+user|user)\b/i,      // "waiting on you", "waiting on the user"
  /awaiting\s+(?:the\s+)?user\b/i,
  /\bnot\s+a\s+script(?:\s+fix)?\b/i,               // "need a human, not a script fix"
  /needs?\s+(?:a\s+)?(?:concrete\s+)?(?:answer|decision|call|sign-?off)\s+from\s+the\s+user/i,
  /\buser\s+to\s+(?:define|specify|decide|choose|scope)/i,
  /needs?\s+the\s+user\s+to\b/i,
];
function isHumanBlocked(text) {
  const s = String(text || '');
  return HUMAN_BLOCK_RE.some(re => re.test(s));
}

// ---------- Projects-tab TODO parsing (Phase 2, gap A) ----------
// data/todos/projects.md uses GitHub checklist syntax (`- [ ] ...` open,
// `- [x] ...` done), NOT the markdown-table format parseBacklog() handles, so it
// needs its own scan. We only pick OPEN (`- [ ]`) top-level checklist lines; any
// `- [x]`/`- [X]` line is done and skipped. The `  > ...` note blocks that trail an
// item are NOT checklist lines, but we now COLLECT them (until the next checklist
// line or `#` heading) so the human-in-the-loop gate below can read an item's full
// context — an item's own line may look benign while its notes say a human must
// decide. The file has no ticket-id column, so we derive a STABLE id from a sha1 of
// the trimmed line text ONLY (unchanged — notes are context for the gate, not part
// of identity), identical across re-parses of an unchanged line (so a tick doesn't
// think every item is new every 5 minutes), keyed under a `pj-` prefix that can't
// collide with backlog ids (`[A-Z]\d+`) or task ids (`t-…`) in state.dispatched.
// The returned shape matches parseBacklog()'s rows so dispatch() fires it unchanged.
function parseProjectsBacklog() {
  const txt = U.safeRead(PROJECTS_TODO_FILE) || '';
  const openItems = [];
  let current = null; // last checklist item seen (open OR done), to attach trailing `>` notes
  for (const line of txt.split('\n')) {
    const m = /^\s*-\s*\[( |x|X)\]\s+(.*\S)\s*$/.exec(line);
    if (m) {
      current = { open: m[1] === ' ', text: m[2].trim(), notes: [] };
      if (current.open && current.text) openItems.push(current);
      continue;
    }
    if (/^\s*#/.test(line)) { current = null; continue; }             // heading ends a note block
    if (current && /^\s*>/.test(line)) current.notes.push(line.replace(/^\s*>\s?/, ''));
    // wrapped continuation lines are ignored (not appended to text — id must stay
    // stable — and not treated as note-block terminators, so `>` notes after a
    // wrapped line still attach to the right item)
  }
  const items = [];
  for (const it of openItems) {
    // HARD skip: this item's line OR its trailing notes flag it as needing a human.
    if (isHumanBlocked(it.text + '\n' + it.notes.join('\n'))) continue;
    const id = 'pj-' + crypto.createHash('sha1').update(it.text).digest('hex').slice(0, 10);
    items.push({
      id, loc: 'claude-dashboard/data/todos/projects.md', issue: it.text,
      fix: '(see this checklist line in the Projects-tab TODO)', status: '⬜', done: false,
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
    if (d && !['error', 'gone'].includes(d.status)) continue; // in flight, done, or cancelled (human decision — stays skipped, matches A2)
    if (d && (d.attempts || 0) >= MAX_ATTEMPTS) continue;   // exhausted retries this session
    return { type: 'backlog', item: it };
  }
  // A2 — backlog empty: fall back to the hub task queue, OLDEST first (FIFO —
  // enqueue() unshifts so load() is newest-first; iterating raw would let new
  // tasks starve old ones forever). Skip tasks autopilot created itself
  // (source:'autopilot') so it can't feed its own loop. A task is pickable if
  // it never ran, or its run settled as error/gone (retry, capped by
  // MAX_ATTEMPTS via dispatched[]); cancelled stays skipped — that was a human
  // decision, not a failure.
  const queue = tasks.load().slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const t of queue) {
    if (t.source === 'autopilot' || t.done) continue; // done = completed out-of-band
    if (t.runId) {
      const m = runs.getRunMeta(t.runId);
      // Only a real 'error' is retryable. A missing meta ('gone') means the user
      // deleted the run from history — settled, unknown outcome — NOT a failure;
      // retrying it would re-execute finished work unattended.
      if (!m || m.status !== 'error') continue;
    }
    const d = state.dispatched[t.id];
    if (d && d.status === 'stuck') continue;
    if (d && (d.attempts || 0) >= MAX_ATTEMPTS) continue;
    return { type: 'task', task: t };
  }
  // Phase 2 (gap A) — THIRD tier: the Projects-tab TODO checklist, consulted only
  // after both the backlog table and the task queue come up dry. Gated on
  // projectsBacklogEnabled (its own flag) — and tick() has already gated the whole
  // pick on state.enabled, so BOTH must be true to reach here. Retry/park semantics
  // are identical to the two sources above: reuse state.dispatched[id] keyed by the
  // stable pj- id, honor stuck-parking, skip in-flight/done/cancelled (a status
  // that isn't error/gone), and stop at MAX_ATTEMPTS. Returns type !== 'task', so
  // tick() routes it through the existing dispatch() path with no change there.
  if (state.projectsBacklogEnabled) {
    for (const it of parseProjectsBacklog()) {
      const d = state.dispatched[it.id];
      if (d && d.status === 'stuck') continue;
      if (d && !['error', 'gone'].includes(d.status)) continue;
      if (d && (d.attempts || 0) >= MAX_ATTEMPTS) continue;
      return { type: 'projects', item: it };
    }
  }
  return null;
}

function inflightCount(state) {
  let n = 0;
  for (const id in state.dispatched) {
    const d = state.dispatched[id];
    if (!d.taskId) continue;
    const m = d.runId ? runs.getRunMeta(d.runId) : null;
    // A set runId whose meta is gone (run deleted from history) is SETTLED, not
    // inflight — matches the C25 "gone=settled" fix in pickNext(). Otherwise a
    // deleted done-run counts inflight forever and deadlocks the whole loop.
    const settled = d.runId ? (m ? ['done', 'error', 'cancelled', 'gone'].includes(m.status) : true) : true;
    if (!settled) n++;
  }
  return n;
}

// Re-sync dispatched[].status from the live run engine so pickNext() sees
// fresh outcomes without autopilot having to be the one polling the SSE feed.
// Failures that are the MACHINE's fault, not the item's: TLS interception
// bursts, network drops, API overload. These must not consume the item's
// retry budget (seen live 2026-07-26: a 9-minute cert-error burst parked two
// perfectly good items as stuck), and dispatching during a burst just burns
// 2-minute error runs — so one infra sighting also pauses dispatch briefly.
const INFRA_RE = /UNKNOWN_CERTIFICATE|Unable to connect to API|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|rate.?limit|overloaded|api_error_status.:5|529|503/i;
const INFRA_BACKOFF_MS = 10 * 60 * 1000;
// C53 — cap cumulative infra refunds per ITEM (not per runId). The per-runId
// guard (infraCredited) stops double-refunding one run, but attempts and the
// runId reset on every re-dispatch, so an item whose fix legitimately echoes an
// INFRA_RE token in its verify output would refund forever (attempts oscillate
// 1→0→1→0) and re-dispatch every backoff window, burning opus/high budget. The
// running total (infraRefunds) is carried forward across re-dispatch like
// attempts; once it hits this cap refunds stop and MAX_ATTEMPTS finally bites.
const MAX_INFRA_REFUNDS = 3;

function refreshDispatched(state) {
  // Continuation-on-death (runs.js continueRun) relinks a task to its resumed
  // run; follow the task's CURRENT runId so a dead original run doesn't read as
  // "error" (and get re-dispatched) while its continuation is still working.
  let taskById = null;
  for (const id in state.dispatched) {
    const d = state.dispatched[id];
    if (!d.runId) continue;
    if (d.taskId) {
      if (!taskById) { taskById = {}; try { for (const t of tasks.load()) taskById[t.id] = t; } catch {} }
      const t = taskById[d.taskId];
      if (t && t.runId && t.runId !== d.runId) d.runId = t.runId;
    }
    const m = runs.getRunMeta(d.runId);
    if (m) d.status = m.status;
    // Infra failure: refund the attempt (once per runId), un-park if it was
    // parked for this, and start the global dispatch backoff.
    // Refund once per runId AND only while under the per-item lifetime cap, so a
    // fix that keeps re-erroring with an INFRA_RE token can't dodge MAX_ATTEMPTS
    // forever (C53). Backoff still fires on every infra sighting regardless.
    if (m && m.status === 'error' && INFRA_RE.test(m.errorExcerpt || '') && d.infraCredited !== d.runId) {
      d.infraCredited = d.runId;
      state.lastInfraAt = new Date().toISOString();
      if ((d.infraRefunds || 0) < MAX_INFRA_REFUNDS) {
        d.infraRefunds = (d.infraRefunds || 0) + 1;
        d.attempts = Math.max(0, (d.attempts || 0) - 1);
      }
    }
    if (m && m.status === 'error' && (d.attempts || 0) >= MAX_ATTEMPTS) d.status = 'stuck';
    else if (d.status === 'stuck' && (d.attempts || 0) < MAX_ATTEMPTS) d.status = 'error'; // un-park after refund
  }
}

// `type` distinguishes where the item's own record lives, so the close-the-loop
// step tells the run to edit the right file — Phase 2 (gap A) added a second
// source (Projects-tab TODO checklist) that routes through this same function
// but is NOT a docs/improvement-backlog.md row, so a single hardcoded closing
// instruction would send the run to edit a file the item was never in.
function dispatch(state, item, type) {
  const isProjects = type === 'projects';
  const sourceLine = isProjects
    ? `Projects-tab TODO item ${item.id} in claude-dashboard/data/todos/projects.md:`
    : `Backlog item ${item.id} in docs/improvement-backlog.md:`;
  const closeStep = isProjects
    ? `2. Edit claude-dashboard/data/todos/projects.md yourself: change this exact
   checklist line from "- [ ] ${item.issue}" to "- [x] ${item.issue}".`
    : `2. Edit docs/improvement-backlog.md yourself: change item ${item.id}'s Status
   cell from ⬜ to "✅ " followed by today's date.`;
  const prompt = `[Autopilot self-improvement task ${item.id} — dispatched unattended, no user review before you act]

${sourceLine}
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
${closeStep}
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
    error: r.error || null, infraRefunds: prev.infraRefunds || 0, // carry the cap forward (C53)
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
    error: r.error || null, fromQueue: true, infraRefunds: prev.infraRefunds || 0, // carry the cap forward (C53)
  };
  state.lastPick = task.id;
  return r;
}

function tick() {
  const state = loadState();
  state.lastTick = new Date().toISOString();
  if (!state.enabled) { saveState(state); return; }
  refreshDispatched(state);
  tasks.pruneAutopilot(); // C55: evict old settled autopilot tasks so tasks.json can't grow unbounded
  if (inflightCount(state) >= MAX_INFLIGHT) { saveState(state); return; }
  if (runs.runningCount() + runs.queueLength() >= MAX_QUEUE_PRESSURE) { saveState(state); return; } // don't pile onto a busy engine
  // Infra backoff: an API/TLS/network failure was just observed — dispatching
  // now would only mint more 2-minute error runs. Sit out until the window passes.
  if (state.lastInfraAt && (Date.now() - Date.parse(state.lastInfraAt)) < INFRA_BACKOFF_MS) { saveState(state); return; }
  const pick = pickNext(state);
  if (pick) {
    state.idle = false; state.idleSince = null;
    pick.type === 'task' ? dispatchTask(state, pick.task) : dispatch(state, pick.item, pick.type);
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
  // how many non-autopilot tasks are pickable: never-run, or settled error/gone
  // (retryable) — same eligibility pickNext() uses.
  let queueOpen = 0;
  try {
    queueOpen = tasks.load().filter(t => {
      if (t.source === 'autopilot' || t.done) return false;
      if (!t.runId) return true;
      const m = runs.getRunMeta(t.runId);
      return !!m && m.status === 'error'; // gone = settled (user deleted history), not open
    }).length;
  } catch {}
  // A6 — "idle" means enabled but nothing to pick (backlog dry AND queue empty).
  const idle = !!state.enabled && open.length === 0 && queueOpen === 0;
  return {
    enabled: state.enabled, projectsBacklogEnabled: !!state.projectsBacklogEnabled,
    lastTick: state.lastTick, lastPick: state.lastPick,
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

module.exports = { handle, startTicker, status, parseBacklog, parseProjectsBacklog, isHumanBlocked };
