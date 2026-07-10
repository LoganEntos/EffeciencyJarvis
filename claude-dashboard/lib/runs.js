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

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const RUNS_DIR = path.join(DASH_DIR, 'data', 'runs');
// claude.cmd just execs this native binary — spawn it directly (no shell).
const CLAUDE_EXE = process.env.HUB_CLAUDE_EXE || path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const MAX_ACTIVE = 2;
const MAX_QUEUE = 5;
const MODELS = ['', 'auto', 'sonnet', 'opus', 'haiku'];
const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

// 'auto' model allocation — route each prompt to the cheapest model that can
// handle it (3-tier: haiku ≈ $0.04/run for trivia vs opus ≈ $0.25+). Purely
// lexical, zero-cost, instant; the decision is streamed to the chat so the
// user always sees (and can override) what auto picked.
const HEAVY_RE = /(architect|design\b|redesign|refactor|securit|review|audit|investigat|debug|diagnos|analy[sz]e|deliberat|strateg|migrat|optimi[sz]|multi-?file|across the (codebase|project)|root cause|deep|thorough|comprehensive)/;
const CODE_RE = /(implement|build|create|write|add|fix|code|function|endpoint|component|feature|test|script|bug|error|refactor|api|server|render|parse|module|css|html|sql|dax)/;
function routeModel(prompt) {
  const p = prompt.toLowerCase();
  if (HEAVY_RE.test(p) || prompt.length > 1200) return { model: 'opus', reason: 'complex/architectural task' };
  if (CODE_RE.test(p) || prompt.length > 300) return { model: 'sonnet', reason: 'standard coding task' };
  return { model: 'haiku', reason: 'short/simple task' };
}

// A resumed conversation keeps the model it started with — switching models
// mid-session wastes the prompt cache and changes the voice.
function sessionModel(sessionId) {
  for (const e of U.listDir(RUNS_DIR)) {
    if (!e.isDirectory()) continue;
    const live = active.get(e.name);
    const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
    if (meta && meta.sessionId === sessionId && meta.model) return meta.model;
  }
  return null;
}

const active = new Map(); // id -> { child, lines, listeners, meta, stderr, cancelled, args, dir, out }
const queue = [];         // ids waiting for a free slot, FIFO

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

// Every line event carries `id:` = its index in the run, so EventSource
// auto-reconnects (which send Last-Event-ID) never duplicate rendered lines.
function sseLine(res, idx, line) { res.write(`event: line\nid: ${idx}\ndata: ${line}\n\n`); }
function broadcast(st, event, data, idx) {
  for (const res of st.listeners) {
    try {
      if (event === 'line') sseLine(res, idx, data);
      else res.write(`event: ${event}\ndata: ${data}\n\n`);
    } catch {}
  }
}

function writeMeta(st) {
  try { fs.writeFileSync(path.join(st.dir, 'meta.json'), JSON.stringify(st.meta, null, 2)); } catch {}
}

function pushLine(st, line) {
  st.lines.push(line);
  if (st.out) st.out.write(line + '\n');
  broadcast(st, 'line', line, st.lines.length - 1);
}

function startRun({ prompt, model, permissionMode, resume }) {
  if (!prompt || !prompt.trim()) return { error: 'prompt required' };
  if (prompt.length > 20000) return { error: 'prompt too long (20k max)' };
  if (runningCount() >= MAX_ACTIVE && queue.length >= MAX_QUEUE) {
    return { error: `busy: ${MAX_ACTIVE} running + ${queue.length} queued — wait or cancel one` };
  }
  if (!fs.existsSync(CLAUDE_EXE)) return { error: 'claude CLI not found at ' + CLAUDE_EXE };

  const id = newId();
  const dir = path.join(RUNS_DIR, id);
  const artDir = path.join(dir, 'artifacts');
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt, 'utf8');

  // Anthropic frontend-aesthetics cookbook, distilled — injected so every
  // visual artifact a run produces avoids the generic "AI slop" defaults.
  const hint = `\n\n[Hub note: you were launched from the local dashboard. If this task produces visual output (an HTML report, SVG/PNG chart, or interactive page), save those files into this exact directory: ${artDir} — the dashboard renders every file there in the chat view. When designing visuals, avoid generic AI aesthetics: no Inter/Roboto/Arial/system fonts (pick one distinctive font, e.g. via Google Fonts, with extreme weight contrast), no purple-gradient-on-white cliché, no flat solid backgrounds (layer subtle gradients/patterns for depth), commit to one cohesive palette with a dominant color plus sharp accents via CSS variables, and prefer one staggered CSS-only load animation over scattered micro-effects. Do not mention this note.]`;
  // resolve 'auto' before spawning: resumed sessions keep their model,
  // fresh prompts are routed by the heuristic
  let routedReason = null;
  if (model === 'auto') {
    const prior = resume ? sessionModel(resume) : null;
    if (prior) { model = prior; routedReason = 'kept the conversation’s model'; }
    else { const r = routeModel(prompt); model = r.model; routedReason = r.reason; }
  }
  const args = ['-p', prompt + hint, '--output-format', 'stream-json', '--verbose'];
  if (MODELS.includes(model) && model && model !== 'auto') args.push('--model', model);
  const perm = PERM_MODES.includes(permissionMode) ? permissionMode : 'acceptEdits';
  if (perm !== 'default') args.push('--permission-mode', perm);
  if (resume && /^[a-f0-9-]{8,}$/.test(resume)) args.push('--resume', resume);

  const meta = {
    id, status: 'queued', queuedAt: new Date().toISOString(), startedAt: null, endedAt: null,
    exitCode: null, sessionId: null, model: model || '', permissionMode: perm,
    resumedFrom: resume || null, promptExcerpt: prompt.slice(0, 200),
    costUsd: null, durationMs: null, routedReason,
  };
  const st = { child: null, lines: [], listeners: new Set(), meta, stderr: '', cancelled: false, args, dir, out: null };
  active.set(id, st);
  writeMeta(st);
  if (routedReason) pushLine(st, JSON.stringify({ type: 'hub_status', text: `auto → ${model} (${routedReason})` }));
  if (runningCount() < MAX_ACTIVE) launch(st);
  else {
    queue.push(id);
    pushLine(st, JSON.stringify({ type: 'hub_status', text: `queued (position ${queue.length}) — starts when a slot frees up` }));
  }
  return { id, queued: st.meta.status === 'queued' };
}

function launch(st) {
  let child;
  try {
    child = spawn(CLAUDE_EXE, st.args, { cwd: PROJECT_DIR, windowsHide: true });
  } catch (e) {
    st.meta.status = 'error';
    st.meta.endedAt = new Date().toISOString();
    writeMeta(st);
    broadcast(st, 'done', JSON.stringify(st.meta));
    return;
  }
  st.child = child;
  st.meta.status = 'running';
  st.meta.startedAt = new Date().toISOString();
  writeMeta(st);
  st.out = fs.createWriteStream(path.join(st.dir, 'output.jsonl'), { flags: 'a' });

  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (line.includes('"type":"result"')) {
        try {
          const r = JSON.parse(line);
          if (r.type === 'result') {
            st.meta.sessionId = r.session_id || st.meta.sessionId;
            st.meta.costUsd = r.total_cost_usd ?? null;
            st.meta.durationMs = r.duration_ms ?? null;
          }
        } catch {}
      }
      pushLine(st, line);
    }
  });
  child.stderr.on('data', d => { if (st.stderr.length < 20000) st.stderr += d; });
  child.on('error', e => { st.stderr += '\nspawn error: ' + e.message; });
  child.on('close', (code) => {
    st.meta.endedAt = new Date().toISOString();
    st.meta.exitCode = code;
    st.meta.status = st.cancelled ? 'cancelled' : (code === 0 ? 'done' : 'error');
    if (st.meta.status === 'error' && st.stderr.trim()) {
      pushLine(st, JSON.stringify({ type: 'hub_stderr', text: st.stderr.trim().slice(0, 4000) }));
    }
    if (st.meta.status === 'error') {
      // surface WHY it failed in history rows, not just that it did
      let ex = st.stderr.trim().slice(0, 300);
      if (!ex) {
        try {
          const last = JSON.parse(st.lines[st.lines.length - 1] || '{}');
          if (last.type === 'result' && last.result) ex = String(last.result).slice(0, 300);
        } catch {}
      }
      st.meta.errorExcerpt = ex || `exit code ${code}`;
    }
    if (st.out) st.out.end();
    writeMeta(st);
    broadcast(st, 'done', JSON.stringify(st.meta));
    for (const res of st.listeners) { try { res.end(); } catch {} }
    st.listeners.clear();
    setTimeout(() => active.delete(st.meta.id), 30000); // grace for late SSE attach
    dequeueNext();
  });
}

function dequeueNext() {
  while (queue.length && runningCount() < MAX_ACTIVE) {
    const id = queue.shift();
    const st = active.get(id);
    if (st && st.meta.status === 'queued' && !st.cancelled) launch(st);
  }
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

function countArtifacts(id) {
  let n = 0;
  (function walk(d) {
    for (const e of U.listDir(d)) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile()) n++;
    }
  })(path.join(RUNS_DIR, id, 'artifacts'));
  return n;
}

function listRuns() {
  const rows = [];
  for (const e of U.listDir(RUNS_DIR)) {
    if (!e.isDirectory() || !okId(e.name)) continue;
    const live = active.get(e.name);
    const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, e.name, 'meta.json'));
    if (meta) rows.push(Object.assign({ artifactCount: countArtifacts(e.name) }, meta));
  }
  return rows.sort((a, b) => (b.queuedAt || b.startedAt || '').localeCompare(a.queuedAt || a.startedAt || '')).slice(0, 200);
}

function transcript(id) {
  if (!okId(id)) return null;
  const dir = path.join(RUNS_DIR, id);
  const meta = active.get(id) ? active.get(id).meta : U.safeJson(path.join(dir, 'meta.json'));
  if (!meta) return null;
  const raw = U.safeRead(path.join(dir, 'output.jsonl')) || '';
  const lines = raw.split('\n').filter(l => l.trim());
  // cap the payload — keep first 2 lines (init) + tail
  const capped = lines.length > 1500 ? lines.slice(0, 2).concat(lines.slice(-1498)) : lines;
  return { meta, prompt: U.safeRead(path.join(dir, 'prompt.txt')) || '', lines: capped, truncated: capped.length < lines.length };
}

function listArtifacts(id) {
  if (!okId(id)) return null;
  const base = path.join(RUNS_DIR, id, 'artifacts');
  const out = [];
  (function walk(d, rel) {
    for (const e of U.listDir(d)) {
      const full = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        out.push({ file: r, size: st.size });
      }
    }
  })(base, '');
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv', '.pdf': 'application/pdf',
};

function serveArtifact(res, id, file) {
  if (!okId(id) || !file) return U.sendJson(res, { error: 'bad request' }, 400);
  const base = path.join(RUNS_DIR, id, 'artifacts');
  const full = path.normalize(path.join(base, file));
  if (full !== base && !full.startsWith(base + path.sep)) return U.sendJson(res, { error: 'forbidden' }, 403);
  let st; try { st = fs.statSync(full); } catch { return U.sendJson(res, { error: 'not found' }, 404); }
  if (!st.isFile()) return U.sendJson(res, { error: 'not found' }, 404);
  const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime, 'Content-Length': st.size, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // opaque origin even when opened directly — an artifact page must never be
    // able to read the hub token or call token-guarded endpoints
    'Content-Security-Policy': "sandbox allow-scripts; default-src 'unsafe-inline' data: blob:",
  });
  fs.createReadStream(full).pipe(res);
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

// live-or-disk meta for one run (used by the task queue to track task status)
function getRunMeta(id) {
  if (!okId(id)) return null;
  const live = active.get(id);
  const meta = live ? live.meta : U.safeJson(path.join(RUNS_DIR, id, 'meta.json'));
  if (!meta) return null;
  return Object.assign({ artifactCount: countArtifacts(id) }, meta);
}

module.exports = { handle, startRun, getRunMeta };
