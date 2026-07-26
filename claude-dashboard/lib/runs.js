/*
 * Run engine: spawn the claude CLI in print mode with stream-json output,
 * stream lines to the browser over SSE, persist every run under
 * data/runs/<id>/ (prompt.txt, output.jsonl, meta.json, artifacts/).
 * Runs beyond the concurrency cap are queued (FIFO) instead of rejected.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const U = require('./util');
const memory = require('./memory');
const liveness = require('./liveness');
const teams = require('./teams');
const personas = require('./personas');
const projects = require('./projects');
const settings = require('./settings');
const { listArtifacts, serveArtifact } = require('./artifacts');
const { createQueries } = require('./runs-query');
const { createEngine } = require('./runs-engine');
const { createRouter } = require('./runs-route');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const RUNS_DIR = path.join(DASH_DIR, 'data', 'runs');
// claude.cmd just execs this native binary — spawn it directly (no shell).
// Discovery lives in U.findClaude (shared with distill/sessionsum): env →
// npm global → newest desktop-app-bundled CLI. Resolved lazily and
// re-resolved whenever the cached path stops existing — a one-shot const
// resolved at module load went stale when the desktop app swapped version
// dirs or when boot ran in a context that couldn't see the bundle (seen
// live: the autostart scheduled task cached the npm fallback for its whole
// lifetime and every run failed "claude CLI not found").
let CLAUDE_EXE_CACHED = null;
function claudeExe() {
  if (!CLAUDE_EXE_CACHED || !fs.existsSync(CLAUDE_EXE_CACHED)) CLAUDE_EXE_CACHED = U.findClaude();
  return CLAUDE_EXE_CACHED;
}
// H4: second engine — hermes over ACP (hermes acp, JSON-RPC/stdio; see
// lib/acp.js) for real per-step streaming. Hermes does its own model tiering +
// tool approvals, so the hub's model/permission selectors are claude-only.
// Same spawn invariants: argv array, no shell.
const HERMES_EXE = process.env.HUB_HERMES_EXE || path.join(
  require('os').homedir(), '.hermes', 'venvs', 'hermes', 'Scripts', 'hermes.exe');
const ENGINES = ['claude', 'hermes'];
const MAX_ACTIVE = 2;
const MAX_QUEUE = 5;
const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

const active = new Map(); // id -> { child, lines, listeners, meta, stderr, cancelled, args, dir, out }
const queue = [];         // ids waiting for a free slot, FIFO

// Reap crash/restart orphans on boot + every 60s: any run left "running" on
// disk that isn't in `active` had its process die without a close event, so
// history would otherwise show it running forever.
liveness.startReaper(RUNS_DIR, active);

const okId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && id.length < 64;
function newId() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).toLowerCase()
    + '-' + crypto.randomBytes(3).toString('hex');
}
function runningCount() {
  let n = 0;
  for (const s of active.values()) if (s.meta.status === 'running') n++;
  return n;
}

// Read-side queries (list/routingStats/transcript/getRunMeta) live in
// runs-query.js to keep this file under the 500-line rule; they share the
// live `active` Map so in-flight runs read back the same as finished ones.
const { listRuns, routingStats, transcript, getRunMeta, statsToday } = createQueries({ RUNS_DIR, active, okId });

// Process lifecycle (SSE formatting, meta persistence, the claude-CLI child
// process, queue drain) lives in runs-engine.js to keep this file under the
// 500-line rule; it shares the live `active` Map + `queue` array so a run
// launched here is tracked identically on both sides.
const { launch, pushLine, broadcast, sseLine, writeMeta } = createEngine({
  active, queue, MAX_ACTIVE, runningCount, claudeExe, PROJECT_DIR, HERMES_EXE,
  continueRun,
});

// Model routing + prompt-assembly helpers (model/effort tables, the 'auto'
// heuristic, the Fable-5 god prompt, resumed-session model lookup, and
// inbox-confined attachment resolution) live in runs-route.js to keep this file
// under the 500-line rule; createRouter binds the shared `active` Map so
// sessionModel reads in-flight runs the same as finished ones.
const {
  routeModel, isConversational, sessionModel, resolveImages,
  isOpusTier, GOD_PROMPT, MODELS, EFFORTS,
} = createRouter({ active });

// A5 — continuation on context-death. When a task/schedule/autopilot run dies
// with `error` but left a resumable sessionId, the engine calls this to enqueue
// ONE resumed run that reads the log/diff and finishes only the current item.
// Capped (meta.continuations ≤ 2 per chain) so a genuinely broken item can't
// resume forever; user-cancelled runs never reach here (status is 'cancelled').
function continueRun(meta) {
  const prompt = `[Continuation — the previous ${meta.source} run (${meta.id}) was cut off before finishing, most likely a context/length limit rather than a real failure.]

Read that run's transcript and the current \`git status\`/\`git diff\` to see exactly where it stopped, then finish ONLY the single item it was working on — do NOT start new work or broaden scope. If the item was already completed and committed, verify that and stop. Commit any remaining change (no Co-Authored-By trailer) and give a one-line status.`;
  const r = startRun({
    prompt, model: meta.model || 'auto', permissionMode: meta.permissionMode,
    resume: meta.sessionId, source: meta.source,
    continuations: (meta.continuations || 0) + 1,
    effort: meta.effort || '',
    scheduleId: meta.scheduleId || undefined,
  });
  // Point the owning task or schedule (if any) at the continuation so the
  // Tasks tab, autopilot, and the scheduler's still-running guard all follow
  // the live chain, not the dead run (C33: without the schedule relink, tick()
  // reads the dead original as settled and stacks a fresh concurrent run).
  // Lazy requires — both modules require this one at load time (circular).
  if (!r.error && r.id) {
    try { require('./tasks').relinkRun(meta.id, r.id); } catch {}
    if (meta.scheduleId) { try { require('./schedules').relinkRun(meta.id, r.id); } catch {} }
  }
  return r;
}

function startRun({ prompt, model, permissionMode, resume, recall, engine, projectId, images, files, think, effort, source, continuations, channel, scheduleId }) {
  engine = ENGINES.includes(engine) ? engine : 'claude';
  // Output-contract channel: 'spoken' (voice / Jarvis chat → TTS-shaped) vs
  // 'screen' (Run tab / project chat, and every headless source — tasks,
  // schedules, autopilot, continuations — since they never set it). Default screen.
  channel = channel === 'spoken' ? 'spoken' : 'screen';
  if (!prompt || !prompt.trim()) return { error: 'prompt required' };
  if (prompt.length > 20000) return { error: 'prompt too long (20k max)' };
  if (runningCount() >= MAX_ACTIVE && queue.length >= MAX_QUEUE) {
    return { error: `busy: ${MAX_ACTIVE} running + ${queue.length} queued — wait or cancel one` };
  }
  if (engine === 'claude' && !fs.existsSync(claudeExe())) return { error: 'claude CLI not found at ' + claudeExe() };
  if (engine === 'hermes' && !fs.existsSync(HERMES_EXE)) return { error: 'hermes not installed at ' + HERMES_EXE + ' — see docs/hermes-adoption.md' };

  const id = newId();
  const dir = path.join(RUNS_DIR, id);
  const artDir = path.join(dir, 'artifacts');
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt, 'utf8');

  const hint = U.buildRunHint(PROJECT_DIR, artDir);
  // resolve 'auto' before spawning: resumed sessions keep their model,
  // fresh prompts are routed by the heuristic (claude engine only — hermes
  // does its own tiering: main/aux/subagent models from its config.yaml)
  let routedReason = null;
  if (engine === 'claude' && model === 'auto') {
    const prior = resume ? sessionModel(resume) : null;
    if (prior) { model = prior; routedReason = 'kept the conversation’s model'; }
    else {
      const r = routeModel(prompt); model = r.model; routedReason = r.reason;
      // Persona floor: a conversational turn routed to haiku can't hold the
      // persona's voice — floor at sonnet when a persona is active. Only for
      // fresh auto routing (a pinned model or a resumed session is untouched).
      let personaActive = false;
      try { personaActive = !!personas.getActiveId(); } catch {}
      if (personaActive && model === 'haiku' && isConversational(prompt)) {
        model = 'sonnet'; routedReason = 'persona active — floored to sonnet for a conversational turn';
      }
    }
  }
  // N3.5 opt-in memory recall: prepend top-k relevant Engram memories to the
  // CLI prompt (never to prompt.txt — that stays the user's words). Costs a
  // few hundred prompt tokens, so it only happens when the caller asked.
  let recalled = null;
  if (recall) { try { recalled = memory.recall(prompt); } catch {} }
  // Active agent-team steering (empty for the default "Lean" team, so normal
  // runs stay token-neutral). Injected between the user's prompt and the hub note.
  let team = null, teamName = null;
  try { team = teams.activeHint(); } catch {}
  try { teamName = teams.activeTeam().name; } catch {} // recorded on every run (incl. Lean) so history/sessions/tasks show it
  // Active persona (Jarvis etc.) — the channel's output contract + persona body,
  // injected as a TRUE system layer (--append-system-prompt below), NOT the user
  // turn: this outranks the trailing hub-note boilerplate and stays out of
  // resumed user-turn history so --resume never stacks a second copy. Empty when
  // no persona is active. Claude engine only; hermes has its own voice.
  let personaSys = '', personaName = null;
  if (engine === 'claude') {
    try { personaSys = personas.activePrefix(channel); } catch {}
    try { personaName = personas.activeName(); } catch {}
  }
  // Project binding (Projects tab): the project's standing instructions lead the
  // prompt like a persona does, plus a small project-scoped engram recall block
  // (this project's own past runs/notes). Claude engine only; token-neutral when
  // no project is bound. See lib/projects.js.
  let projectPrefix = '', projectName = null, projectSlug = null, projRecall = null;
  if (engine === 'claude' && projectId) {
    try {
      const pr = projects.get(projectId);
      if (pr) {
        projectName = pr.name; projectSlug = pr.slug;
        if (pr.instructions && pr.instructions.trim()) projectPrefix = `<project name="${pr.name}">\n${pr.instructions.trim()}\n</project>\n\n`;
        try { projRecall = memory.recallForProject(pr.slug, prompt, { forInjection: true }).injection; } catch {}
      }
    } catch {}
  }
  // Pasted images: reference their absolute inbox paths so Claude reads them
  // with its Read tool (the CLI has no native image arg in print mode). Sits
  // right after the user's words, before the team/hint boilerplate.
  const imgPaths = resolveImages(images);
  const imgBlock = imgPaths.length
    ? `\n\nAttached image${imgPaths.length > 1 ? 's' : ''} (read ${imgPaths.length > 1 ? 'each' : 'it'} with the Read tool):\n`
      + imgPaths.map(p => `- ${p}`).join('\n')
    : '';
  // Non-image attachments (docs/PDFs/CSVs/…): same inbox-confined resolve, listed
  // so Claude opens each with its Read tool.
  const filePaths = resolveImages(files);
  const fileBlock = filePaths.length
    ? `\n\nAttached file${filePaths.length > 1 ? 's' : ''} (read ${filePaths.length > 1 ? 'each' : 'it'} with the Read tool):\n`
      + filePaths.map(p => `- ${p}`).join('\n')
    : '';
  const fullPrompt = projectPrefix + (recalled ? recalled.block + '\n\n' : '')
    + (projRecall ? projRecall.block + '\n\n' : '') + prompt + imgBlock + fileBlock + (team ? team.text : '') + hint;
  let args = null, hermesCfg = null, effApplied = '';
  // Default is bypassPermissions: hub runs are headless (`-p`), so there is no
  // approval prompt — under acceptEdits/default every Bash/MCP call is silently
  // DENIED and the run just reports it "lacks permission" (this was the
  // phone-can't-do-anything bug). The hub is localhost/tailnet-only, single
  // user, so full permissions is the intended mode for its runs.
  const perm = PERM_MODES.includes(permissionMode) ? permissionMode : 'bypassPermissions';
  if (engine === 'hermes') {
    // hermes transport is chosen at launch by HUB_HERMES_ENGINE (acp default /
    // oneshot fallback — see lib/hermes.js). Either way we just stash the prompt
    // + optional resume id here. hermes does its own model tiering + approvals.
    hermesCfg = { prompt: fullPrompt, resume: resume && /^[a-f0-9-]{6,}$/.test(resume) ? resume : '' };
    model = '';
  } else {
    args = ['-p', fullPrompt, '--output-format', 'stream-json', '--verbose'];
    if (MODELS.includes(model) && model && model !== 'auto') args.push('--model', model);
    // True system layer: GOD_PROMPT first (opus-tier only), then the persona
    // contract+character (every tier, when active) — god prompt is the outer
    // discipline, persona shapes voice inside it. One --append-system-prompt.
    const sysParts = [];
    if (GOD_PROMPT && isOpusTier(model)) sysParts.push(GOD_PROMPT);
    if (personaSys) sysParts.push(personaSys.trim());
    if (sysParts.length) args.push('--append-system-prompt', sysParts.join('\n\n'));
    if (perm !== 'default') args.push('--permission-mode', perm);
    if (resume && /^[a-f0-9-]{8,}$/.test(resume)) args.push('--resume', resume);
    // Jarvis-tab ◐ think toggle: one-shot extended-thinking effort for THIS
    // turn only. The CLI has no literal "thinking budget" flag, but --effort
    // max is the real equivalent (verified via `claude --help`: low/medium/
    // high/xhigh/max) — a genuine argv flag, not a prompt-prepend hack.
    // The Run tab's persistent effort selector rides the same flag; ◐ think
    // wins when both are set (it's an explicit this-turn escalation).
    effApplied = think ? 'max' : (EFFORTS.includes(effort) ? effort : '');
    if (effApplied) args.push('--effort', effApplied);
    // C38 runaway guardrails: hard spend cap + turn cap so an unattended
    // autopilot/scheduled run (or a runaway user prompt) can't bill/loop
    // forever. Both are genuine print-mode CLI flags. Values come from
    // settings.json (Config); either at 0 omits its flag. See lib/settings.js.
    try {
      const g = settings.load().runGuardrails || {};
      if (g.maxBudgetUsd > 0) args.push('--max-budget-usd', String(g.maxBudgetUsd));
      if (g.maxTurns > 0) args.push('--max-turns', String(Math.floor(g.maxTurns)));
    } catch {}
  }

  const meta = {
    id, engine, status: 'queued', queuedAt: new Date().toISOString(), startedAt: null, endedAt: null,
    exitCode: null, sessionId: null, model: model || '', permissionMode: perm,
    resumedFrom: resume || null, promptExcerpt: prompt.slice(0, 200),
    costUsd: null, durationMs: null, tokensIn: null, tokensOut: null,
    team: teamName, persona: personaName, channel, routedReason, recallCount: recalled ? recalled.count : 0,
    imageCount: imgPaths.length,
    project: projectName, projectSlug: projectSlug || null,
    think: engine === 'claude' && !!think,
    effort: effApplied || null,
    fable5: engine === 'claude' && !!GOD_PROMPT && isOpusTier(model),
    // Provenance for the autonomous loop: which primitive launched this run
    // (task / schedule / autopilot / null=user). Drives continuation-on-death
    // (finalizeRun) — only non-user runs are auto-resumed. continuations counts
    // how many times this chain has already been auto-continued (cap in engine).
    source: ['task', 'schedule', 'autopilot'].includes(source) ? source : null,
    continuations: Number.isInteger(continuations) ? continuations : 0,
    // C33: which schedule fired this run (schedule source only) — lets
    // continueRun repoint that schedule's lastRunId at the continuation.
    scheduleId: (source === 'schedule' && typeof scheduleId === 'string') ? scheduleId : null,
  };
  const st = { child: null, lines: [], listeners: new Set(), meta, stderr: '', cancelled: false, args, hermesCfg, dir, out: null };
  active.set(id, st);
  writeMeta(st);
  if (routedReason) pushLine(st, JSON.stringify({ type: 'hub_status', text: `auto → ${model} (${routedReason})` }));
  if (recalled) pushLine(st, JSON.stringify({ type: 'hub_status', text: `◇ memory recall: ${recalled.count} relevant memor${recalled.count === 1 ? 'y' : 'ies'} injected` }));
  if (team) pushLine(st, JSON.stringify({ type: 'hub_status', text: `⛬ team: ${team.name} — steering delegation to its specialists` }));
  if (personaName) pushLine(st, JSON.stringify({ type: 'hub_status', text: `◈ persona: ${personaName} — communication bearing active` }));
  if (projectName) pushLine(st, JSON.stringify({ type: 'hub_status', text: `▤ project: ${projectName} — instructions${projRecall ? ` + ${projRecall.count} memor${projRecall.count === 1 ? 'y' : 'ies'}` : ''} injected` }));
  if (meta.think) pushLine(st, JSON.stringify({ type: 'hub_status', text: `◐ think: max-effort extended thinking for this turn` }));
  else if (meta.effort) pushLine(st, JSON.stringify({ type: 'hub_status', text: `▲ effort: tier ${EFFORTS.indexOf(meta.effort) + 1}/5 (${meta.effort})${meta.effort === 'max' ? ' — ULTRA CODE' : ''}` }));
  if (meta.fable5) pushLine(st, JSON.stringify({ type: 'hub_status', text: `⟡ fable5: god prompt injected — opus run steered by the Fable 5 playbook` }));
  if (runningCount() < MAX_ACTIVE) launch(st);
  else {
    queue.push(id);
    pushLine(st, JSON.stringify({ type: 'hub_status', text: `queued (position ${queue.length}) — starts when a slot frees up` }));
  }
  return { id, queued: st.meta.status === 'queued' };
}

function cancelRun(id) {
  const st = active.get(id);
  if (!st) return { error: 'run not active' };
  if (st.meta.status === 'queued') {
    st.cancelled = true;
    const qi = queue.indexOf(id);
    if (qi >= 0) queue.splice(qi, 1);
    st.meta.status = 'cancelled';
    st.meta.endedAt = new Date().toISOString();
    writeMeta(st);
    broadcast(st, 'done', JSON.stringify(st.meta));
    for (const res of st.listeners) { try { res.end(); } catch {} }
    st.listeners.clear();
    setTimeout(() => active.delete(id), 30000);
    return { ok: true };
  }
  if (st.meta.status !== 'running') return { error: 'run not active' };
  st.cancelled = true;
  if (st.acp) { st.acp.cancel(); return { ok: true }; } // graceful ACP cancel → close → finalize
  if (!st.child) return { ok: true };
  // kill the whole tree — the CLI spawns helpers
  spawn('taskkill', ['/pid', String(st.child.pid), '/t', '/f'], { windowsHide: true });
  return { ok: true };
}

// Delete a finished run's folder from history (running/queued runs refuse).
function deleteRun(id) {
  if (!okId(id)) return { error: 'bad id' };
  const st = active.get(id);
  if (st && (st.meta.status === 'running' || st.meta.status === 'queued')) {
    return { error: 'run is active — cancel it first' };
  }
  const dir = path.join(RUNS_DIR, id);
  if (!fs.existsSync(path.join(dir, 'meta.json'))) return { error: 'not found' };
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { return { error: e.message }; }
  active.delete(id);
  return { ok: true };
}

// SSE: replay everything so far, then live lines until the run ends.
function streamRun(req, res, id) {
  if (!okId(id)) { U.sendJson(res, { error: 'bad id' }, 400); return; }
  const st = active.get(id);
  const headers = {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
  };
  const after = parseInt(req.headers['last-event-id'] || '-1', 10); // reconnect resume point
  if (st) {
    res.writeHead(200, headers);
    for (let i = (isNaN(after) ? 0 : after + 1); i < st.lines.length; i++) sseLine(res, i, st.lines[i]);
    if (st.meta.status !== 'running' && st.meta.status !== 'queued') {
      res.write(`event: done\ndata: ${JSON.stringify(st.meta)}\n\n`);
      return res.end();
    }
    st.listeners.add(res);
    const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(hb); st.listeners.delete(res); });
    return;
  }
  // finished run no longer in memory — replay from disk
  const dir = path.join(RUNS_DIR, id);
  const meta = U.safeJson(path.join(dir, 'meta.json'));
  if (!meta) { U.sendJson(res, { error: 'not found' }, 404); return; }
  res.writeHead(200, headers);
  const raw = U.safeRead(path.join(dir, 'output.jsonl')) || '';
  let i = 0;
  for (const line of raw.split('\n')) if (line.trim()) sseLine(res, i++, line);
  res.write(`event: done\ndata: ${JSON.stringify(meta)}\n\n`);
  res.end();
}

// ---------- route handling ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/run' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 64 * 1024) || '{}'); } catch {}
    const r = startRun({
      prompt: (b.prompt || '').toString(),
      model: (b.model || '').toString(),
      permissionMode: (b.permissionMode || '').toString(),
      resume: (b.resume || '').toString(),
      recall: b.recall === true,
      engine: (b.engine || '').toString(),
      projectId: (b.projectId || '').toString(),
      think: b.think === true,
      effort: (b.effort || '').toString(),
      channel: (b.channel || '').toString(),
      images: Array.isArray(b.images) ? b.images : [],
      files: Array.isArray(b.files) ? b.files : [],
    });
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/run/cancel' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = okId(b.id) ? cancelRun(b.id) : { error: 'bad id' };
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/run/delete' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = deleteRun((b.id || '').toString());
    U.sendJson(res, r, r.error ? 400 : 200);
    return true;
  }
  if (p === '/api/run/stream') { streamRun(req, res, url.searchParams.get('id') || ''); return true; }
  if (p === '/api/runs') { U.sendJson(res, listRuns()); return true; }
  if (p === '/api/stats/today') { U.sendJson(res, statsToday()); return true; }
  if (p === '/api/routing') { U.sendJson(res, routingStats()); return true; }
  if (p === '/api/run/transcript') {
    const t = transcript(url.searchParams.get('id') || '');
    t === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, t);
    return true;
  }
  if (p === '/api/run/artifacts') {
    const a = listArtifacts(url.searchParams.get('id') || '');
    a === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, a);
    return true;
  }
  if (p === '/api/run/artifact') {
    serveArtifact(res, url.searchParams.get('id') || '', url.searchParams.get('file') || '');
    return true;
  }
  return false;
}

module.exports = { handle, startRun, getRunMeta, runningCount, listRuns, queueLength: () => queue.length, EFFORTS };
