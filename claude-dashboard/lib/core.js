/*
 * Core hub routes: overview, library (agents/skills/commands), config,
 * session transcripts, ruflo swarm status/launch, graphify graph endpoints.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const DOT_CLAUDE = path.join(PROJECT_DIR, '.claude');
const GRAPHIFY_EXE = 'C:\\Users\\logto\\.local\\bin\\graphify.exe';
const GRAPH_JSON = path.join(DASH_DIR, 'graphify-out', 'graph.json');

// ---------- data collectors ----------
function overview() {
  const agents = U.collectMd(path.join(DOT_CLAUDE, 'agents')).length;
  const skills = U.listDir(path.join(DOT_CLAUDE, 'skills')).filter(e => e.isDirectory()).length;
  const commands = U.collectMd(path.join(DOT_CLAUDE, 'commands')).length;
  const mcp = U.safeJson(path.join(PROJECT_DIR, '.mcp.json')) || {};
  const settings = U.safeJson(path.join(DOT_CLAUDE, 'settings.json')) || {};
  const hookTypes = settings.hooks ? Object.keys(settings.hooks) : [];
  const memDb = fs.existsSync(path.join(PROJECT_DIR, '.swarm', 'memory.db'));
  return {
    project: PROJECT_DIR,
    nodeVersion: process.version,
    counts: { agents, skills, commands },
    mcpServers: Object.keys(mcp.mcpServers || {}),
    hookTypes,
    memoryDb: memDb,
    hasApiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
      || fs.existsSync(path.join(CLAUDE_HOME, '.credentials.json'))),
    time: new Date().toISOString(),
  };
}

function agentList() {
  return U.collectMd(path.join(DOT_CLAUDE, 'agents')).map(f => {
    const fm = U.frontmatter(f);
    return { file: path.basename(f), name: fm.name || path.basename(f, '.md'), description: fm.description || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function skillList() {
  const base = path.join(DOT_CLAUDE, 'skills');
  return U.listDir(base).filter(e => e.isDirectory()).map(e => {
    const fm = U.frontmatter(path.join(base, e.name, 'SKILL.md'));
    return { name: fm.name || e.name, dir: e.name, description: fm.description || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function commandList() {
  return U.collectMd(path.join(DOT_CLAUDE, 'commands')).map(f => {
    const fm = U.frontmatter(f);
    return { file: path.basename(f), name: fm.name || path.basename(f, '.md'), description: fm.description || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function config() {
  return {
    settings: U.safeJson(path.join(DOT_CLAUDE, 'settings.json')),
    mcp: U.safeJson(path.join(PROJECT_DIR, '.mcp.json')),
    projectClaudeMd: (U.safeRead(path.join(PROJECT_DIR, 'CLAUDE.md')) || '').slice(0, 4000),
  };
}

// Resolve this project's Claude Code transcript folder.
function sessionsDir() {
  const projRoot = path.join(CLAUDE_HOME, 'projects');
  const key = PROJECT_DIR.replace(/[:\\/.]/g, '-');
  let dir = path.join(projRoot, key);
  if (!fs.existsSync(dir)) {
    const alt = U.listDir(projRoot).find(e => e.isDirectory() && e.name.includes('bigplans'));
    if (alt) dir = path.join(projRoot, alt.name);
  }
  return dir;
}

function sessions() {
  const dir = sessionsDir();
  return U.listDir(dir).filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => {
    const full = path.join(dir, e.name);
    let st; try { st = fs.statSync(full); } catch { st = {}; }
    return { id: e.name.replace('.jsonl', ''), sizeKb: st.size ? Math.round(st.size / 1024) : 0, modified: st.mtime || null };
  }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

// Parse the last `bytes` of a .jsonl transcript into [{time, kind, text}] events.
// kind ∈ user | assistant | tool; text is capped at 200 chars (tool → tool name).
function parseTranscriptTail(file, size, bytes) {
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  let fd;
  try { fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, buf.length, start); } catch { return null; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
  const lines = buf.toString('utf8').split(/\r?\n/);
  if (start > 0) lines.shift(); // first line is likely a partial JSON line — drop it
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const time = o.timestamp || null;
    const msg = o.message;
    if (!msg) continue;
    if (o.type === 'user') {
      // content is a string for real prompts, or an array (tool_result blocks — skip those).
      const c = msg.content;
      const txt = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '';
      if (txt && txt.trim()) events.push({ time, kind: 'user', text: txt.trim().slice(0, 200) });
    } else if (o.type === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text && b.text.trim()) events.push({ time, kind: 'assistant', text: b.text.trim().slice(0, 200) });
        else if (b.type === 'tool_use') events.push({ time, kind: 'tool', text: b.name || 'tool' });
      }
    }
  }
  return events;
}

// Last `n` conversation events of one session (path-traversal safe: id is hex+dash only).
function sessionTail(id, n) {
  if (!id || !/^[a-f0-9-]+$/.test(id)) return null;
  const file = path.join(sessionsDir(), id + '.jsonl');
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  // Read the last 256KB; single lines can be huge, so escalate once to 1MB if that was thin.
  let events = null;
  for (const bytes of [256 * 1024, 1024 * 1024]) {
    events = parseTranscriptTail(file, st.size, bytes);
    if (events === null) return null;
    if (events.length >= n || bytes >= st.size) break;
  }
  return events.slice(-Math.max(1, n));
}

// Newest-session activity in one round trip: sessions()[0] → sessionTail(id, 12).
function activity() {
  const list = sessions();
  if (!list.length) return { sessionId: null, events: [] };
  const id = list[0].id;
  return { sessionId: id, events: sessionTail(id, 12) || [] };
}

// Ruflo status (cached — npx is slow to spin up).
let statusCache = { at: 0, data: null };
async function rufloStatus() {
  if (Date.now() - statusCache.at < 12000 && statusCache.data) return statusCache.data;
  const r = await U.runNpx(['-y', 'ruflo@latest', 'swarm', 'status'], 45000, PROJECT_DIR);
  statusCache = { at: Date.now(), data: U.stripAnsi(r.out) };
  return statusCache.data;
}

// Parse ruflo's ASCII status tables into structured data the UI can render
// as cards (the CLI has no --json mode). Returns null if the text doesn't
// look like a status report (e.g. an npx error).
function parseSwarmStatus(txt) {
  if (!txt) return null;
  const tableVal = (section, label) => {
    const sec = txt.split(section)[1] || '';
    const m = sec.match(new RegExp('\\|\\s*' + label + '\\s*\\|\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : null;
  };
  const line = (re) => { const m = txt.match(re); return m ? m[1].trim() : null; };
  const prog = txt.match(/Overall Progress:.*?([\d.]+)%/);
  const out = {
    swarmId: line(/Swarm Status:\s*(\S+)/),
    progress: prog ? parseFloat(prog[1]) : null,
    agents: {
      active: tableVal('Agents', 'Active'), idle: tableVal('Agents', 'Idle'),
      completed: tableVal('Agents', 'Completed'), total: tableVal('Agents', 'Total'),
    },
    tasks: {
      completed: tableVal('Tasks', 'Completed'), inProgress: tableVal('Tasks', 'In Progress'),
      pending: tableVal('Tasks', 'Pending'), total: tableVal('Tasks', 'Total'),
    },
    metrics: {
      tokens: line(/Tokens Used:\s*(.+)/), avgResponse: line(/Avg Response Time:\s*(.+)/),
      successRate: line(/Success Rate:\s*(.+)/), elapsed: line(/Elapsed Time:\s*(.+)/),
    },
  };
  return (out.swarmId || out.progress !== null) ? out : null;
}

// Stats straight from graphify-out/graph.json (node-link format; nodes/links
// are arrays, but tolerate object-keyed maps from other graphify versions).
function graphStats() {
  const g = U.safeJson(GRAPH_JSON);
  if (!g) return { exists: false, error: 'graph.json not found — run: graphify extract <project> --code-only' };
  const nodes = Array.isArray(g.nodes) ? g.nodes : Object.values(g.nodes || {});
  const links = Array.isArray(g.links) ? g.links : Object.values(g.links || g.edges || {});
  const communities = new Set(nodes.map(n => n.community).filter(c => c !== undefined && c !== null)).size;
  const degree = {};
  for (const l of links) {
    degree[l.source] = (degree[l.source] || 0) + 1;
    degree[l.target] = (degree[l.target] || 0) + 1;
  }
  const topNodes = nodes.map(n => ({
    id: n.id,
    label: n.label || n.id,
    community: n.community,
    file: n.source_file || '',
    loc: n.source_location || '',
    degree: degree[n.id] || 0,
  })).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label)).slice(0, 15);
  return { exists: true, nodes: nodes.length, edges: links.length, communities, topNodes };
}

// Serve the raw markdown of one agent/skill/command definition (path-traversal safe).
function detail(type, name) {
  const dirs = { agents: path.join(DOT_CLAUDE, 'agents'), commands: path.join(DOT_CLAUDE, 'commands'), skills: path.join(DOT_CLAUDE, 'skills') };
  const base = dirs[type];
  if (!base || !name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (type === 'skills') return U.safeRead(path.join(base, name, 'SKILL.md'));
  // agents/commands may be nested — find by basename
  const hit = U.collectMd(base).find(f => path.basename(f) === name || path.basename(f, '.md') === name);
  return hit ? U.safeRead(hit) : null;
}

// ---------- route handling: returns true if the request was handled ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/overview') { U.sendJson(res, overview()); return true; }
  if (p === '/api/agents') { U.sendJson(res, agentList()); return true; }
  if (p === '/api/skills') { U.sendJson(res, skillList()); return true; }
  if (p === '/api/commands') { U.sendJson(res, commandList()); return true; }
  if (p === '/api/config') { U.sendJson(res, config()); return true; }
  if (p === '/api/sessions') { U.sendJson(res, { dir: sessionsDir(), list: sessions() }); return true; }
  if (p === '/api/session-tail') {
    const n = Math.min(200, Math.max(1, parseInt(url.searchParams.get('n') || '50', 10) || 50));
    const events = sessionTail(url.searchParams.get('id') || '', n);
    events === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, events);
    return true;
  }
  if (p === '/api/activity') { U.sendJson(res, activity()); return true; }
  if (p === '/api/swarm/status') {
    const raw = await rufloStatus();
    U.sendJson(res, { output: raw, parsed: parseSwarmStatus(raw) });
    return true;
  }
  if (p === '/api/detail') {
    const md = detail(url.searchParams.get('type'), url.searchParams.get('name'));
    md === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, { content: md });
    return true;
  }
  if (p === '/api/swarm/launch' && req.method === 'POST') {
    let goal = '';
    try { goal = (JSON.parse(await U.readBody(req, 4000) || '{}').goal || '').toString().slice(0, 500); } catch {}
    if (!goal.trim()) { U.sendJson(res, { error: 'goal required' }, 400); return true; }
    // goal is passed as a single argv element (no shell) — safe from injection.
    const r = await U.runNpx(['-y', 'ruflo@latest', 'swarm', goal], 60000, PROJECT_DIR);
    U.sendJson(res, { code: r.code, output: U.stripAnsi(r.out) });
    return true;
  }
  if (p === '/api/graph/stats') { U.sendJson(res, graphStats()); return true; }
  if (p === '/api/graph/data') {
    const g = U.safeJson(GRAPH_JSON);
    if (!g) { U.sendJson(res, { error: 'graph.json not found — run graphify extract first' }, 404); return true; }
    const rawNodes = Array.isArray(g.nodes) ? g.nodes : Object.values(g.nodes || {});
    const rawLinks = Array.isArray(g.links) ? g.links : Object.values(g.links || g.edges || {});
    U.sendJson(res, {
      nodes: rawNodes.map(n => ({ id: n.id, label: n.label || n.id, community: n.community || 0, file: n.source_file || '' })),
      links: rawLinks.map(l => ({ source: l.source, target: l.target, relation: l.relation || '' })),
    });
    return true;
  }
  if (p === '/api/graph/query' && req.method === 'POST') {
    let mode = 'query', q = '';
    try {
      const b = JSON.parse(await U.readBody(req, 4000) || '{}');
      mode = b.mode === 'explain' ? 'explain' : 'query';
      q = (b.q || '').toString().slice(0, 300);
    } catch {}
    if (!q.trim()) { U.sendJson(res, { error: 'q required' }, 400); return true; }
    if (!fs.existsSync(GRAPH_JSON)) { U.sendJson(res, { error: 'graph.json not found — run graphify extract first' }, 404); return true; }
    // q is passed as a single argv element (no shell) — safe from injection.
    const r = await U.run(GRAPHIFY_EXE, [mode, q, '--graph', GRAPH_JSON], 60000, false, PROJECT_DIR);
    U.sendJson(res, { code: r.code, output: U.stripAnsi(r.out) });
    return true;
  }
  return false;
}

module.exports = { handle, PROJECT_DIR, DASH_DIR };
