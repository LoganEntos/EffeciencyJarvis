/*
 * Core hub routes: overview, library (agents/skills/commands/assets), config,
 * session transcripts, graphify graph endpoints.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');
const settings = require('./settings');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const DOT_CLAUDE = path.join(PROJECT_DIR, '.claude');
const GRAPHIFY_EXE = process.env.HUB_GRAPHIFY_EXE
  || path.join(os.homedir(), '.local', 'bin', 'graphify.exe');
const GRAPH_JSON = path.join(DASH_DIR, 'graphify-out', 'graph.json');

// ---------- data collectors ----------
function overview() {
  const agents = agentList().length;
  const skills = U.listDir(path.join(DOT_CLAUDE, 'skills')).filter(e => e.isDirectory()).length;
  const commands = U.collectMd(path.join(DOT_CLAUDE, 'commands')).length;
  const mcp = U.safeJson(path.join(PROJECT_DIR, '.mcp.json')) || {};
  const settings = U.safeJson(path.join(DOT_CLAUDE, 'settings.json')) || {};
  const hookTypes = settings.hooks ? Object.keys(settings.hooks) : [];
  const engram = U.safeJson(path.join(DASH_DIR, 'data', 'memory.json')) || [];
  return {
    project: PROJECT_DIR,
    nodeVersion: process.version,
    counts: { agents, skills, commands },
    mcpServers: Object.keys(mcp.mcpServers || {}),
    hookTypes,
    engramCount: engram.length,
    hasApiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
      || fs.existsSync(path.join(CLAUDE_HOME, '.credentials.json'))),
    time: new Date().toISOString(),
  };
}

function agentList() {
  const local = U.collectMd(path.join(DOT_CLAUDE, 'agents')).map(f => {
    const fm = U.frontmatter(f);
    return { file: path.basename(f), name: fm.name || path.basename(f, '.md'), description: fm.description || '', model: fm.model || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Claude-only by default (the lean stack). hermes roles appear only when the
  // deprecated paid engine is explicitly re-enabled in Config.
  return (settings.load().hermesEnabled ? hermesAgents() : []).concat(local);
}

// The hermes stack's working roles ARE the agent roster now (persona names
// match the Graph tab's crew language). Models read live from hermes config.
function hermesAgents() {
  const h = hermesInfo();
  if (!h.installed) return [];
  const cfg = U.safeRead(path.join(HERMES_HOME, 'config.yaml')) || '';
  const dlg = cfg.match(/^delegation:[\s\S]*?^\s*model:\s*"([^"]+)"[\s\S]*?^\s*provider:\s*"([^"]+)"/m);
  const dlgModel = dlg ? `${dlg[1]} via ${dlg[2]}` : 'inherits main model';
  const aux = 'auto — cheapest capable model (Gemini-Flash class)';
  return [
    { name: 'hermes: Maestro (main loop)', model: h.model, description: 'The reasoning brain. Tool-calling agent with terminal/file/web/browser/skills; switch any time with `hermes model`.' },
    { name: 'hermes: Crew (subagents)', model: dlgModel, description: 'delegate_task children with isolated context. Mechanical/parallel work never burns frontier tokens.' },
    { name: 'hermes: Scribe (compression)', model: 'auto-cheap', description: `Long-conversation summarizer — ${aux}. Compacts history when context passes 50%.` },
    { name: 'hermes: Falcon (web extract)', model: 'auto-cheap', description: `Web page scraping + summarization — ${aux}.` },
    { name: 'hermes: Scout (vision)', model: 'auto-cheap', description: `Image + browser-screenshot analysis — ${aux}.` },
    { name: 'hermes: Archivist (session search)', model: 'auto-cheap', description: `Recalls + summarizes past sessions (FTS5) — ${aux}.` },
    { name: 'hermes: Envoy (gateway)', model: '', description: 'Messaging bridge (Telegram/Discord/Slack/WhatsApp/Signal) — off until H4 wires the hub toggle.' },
    { name: 'hermes: Clockwork (cron)', model: '', description: 'Natural-language scheduled automations (`hermes cron`) — complements the hub\'s own scheduler.' },
  ];
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

// ---- transcript hygiene (adapted from Nimbalyst's ClaudeCodeSessionSync) ----
// Entry types that are SDK/CLI bookkeeping, never conversation: queue
// enqueue/dequeue records, the rolling last-prompt bookmark (duplicates the
// real user entry), file-edit snapshots, and LLM session summaries.
const SKIP_ENTRY_TYPES = new Set(['queue-operation', 'last-prompt', 'file-history-snapshot', 'summary']);
// CLI bookkeeping wrapped inside user-role messages: slash-command wrappers,
// local-command stdout, caveats, system reminders. Looks like a prompt in the
// JSONL but is CLI-generated — never render it as a user message.
const BOOKKEEPING_RE = /<command-name>|<command-message>|<local-command-stdout>|<local-command-caveat>|<system-reminder>|caveat: the messages below were generated/i;
// Claude Code 2.1.x stashes large tool results in <session>/tool-results/<id>.txt
// and inlines a <persisted-output> marker (abs path + 2KB preview) instead.
const PERSISTED_RE = /<persisted-output>[\s\S]*?Full output saved to:\s*(.+?)\s*\n[\s\S]*?<\/persisted-output>/;

// Substitute a <persisted-output> marker with the stashed file's real content —
// but ONLY when the path resolves inside the session's own sibling dir
// (traversal guard, same startsWith pattern as artifacts.js; case-folded
// because Windows paths are case-insensitive). Otherwise keep the preview.
function resolvePersisted(text, sessionBase) {
  const m = text.match(PERSISTED_RE);
  if (!m) return text;
  const target = path.normalize(m[1].trim());
  if (!path.isAbsolute(target)) return text;
  if (!target.toLowerCase().startsWith((sessionBase + path.sep).toLowerCase())) return text;
  const full = U.safeRead(target);
  return full === null ? text : text.replace(m[0], full);
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
  const sessionBase = file.replace(/\.jsonl$/i, ''); // sibling dir holding tool-results/
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (SKIP_ENTRY_TYPES.has(o.type)) continue; // bookkeeping, not conversation
    const time = o.timestamp || null;
    const msg = o.message;
    if (!msg) continue;
    if (o.type === 'user') {
      // content is a string for real prompts, or an array (tool_result blocks — skip those).
      const c = msg.content;
      let txt = typeof c === 'string' ? c
        : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : '';
      if (BOOKKEEPING_RE.test(txt)) continue; // CLI wrapper posing as a prompt
      if (txt.includes('<persisted-output>')) txt = resolvePersisted(txt, sessionBase);
      if (txt && txt.trim()) events.push({ time, kind: 'user', text: txt.trim().slice(0, 200) });
    } else if (o.type === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text && b.text.trim()) {
          const t = b.text.includes('<persisted-output>') ? resolvePersisted(b.text, sessionBase) : b.text;
          events.push({ time, kind: 'assistant', text: t.trim().slice(0, 200) });
        } else if (b.type === 'tool_use') events.push({ time, kind: 'tool', text: b.name || 'tool' });
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

// Local asset library (vendor/): manifest of vendored fonts/icons/css.
function assets() {
  const man = U.safeJson(path.join(DASH_DIR, 'vendor', 'manifest.json'));
  if (!man) return { exists: false, items: [], iconIndex: [] };
  // every type:icons manifest entry becomes a browsable set; its name index is a
  // sibling <base>-index.json (base = filename minus "-sprite.svg").
  const iconSets = (man.items || []).filter(i => i.type === 'icons').map(it => {
    const base = path.basename(it.file).replace(/-sprite\.svg$/, '').replace(/\.svg$/, '');
    const index = U.safeJson(path.join(DASH_DIR, 'vendor', 'icons', base + '-index.json')) || [];
    return { key: base, label: it.label || base, file: it.file, pfx: it.pfx || '', style: it.style || '', license: it.license, bytes: it.bytes || 0, count: index.length, names: index };
  });
  // iconIndex kept for backward compat (older clients read the Lucide list directly)
  const lucide = iconSets.find(s => s.key === 'lucide');
  return { exists: true, generatedAt: man.generatedAt, items: man.items || [], iconSets, iconIndex: lucide ? lucide.names : [] };
}

// Serve the raw markdown of one agent/skill/command definition (path-traversal safe).
function detail(type, name) {
  if (type === 'agents' && /^hermes:/.test(name || '')) {
    const a = hermesAgents().find(x => x.name === name);
    if (!a) return null;
    const h = hermesInfo();
    return `# ${a.name}\n\n${a.description}\n\nStack: nousresearch/hermes-agent v${h.version} (MIT)\n`
      + `Config: %LOCALAPPDATA%\\hermes\\config.yaml (mirror: scripts/hermes-config.yaml)\n`
      + `Credentials: ${h.credentials ? 'ready (auth.json / .env)' : 'MISSING — hermes auth add nous'}\n`
      + `Plan: docs/hermes-adoption.md (H2-H4 next)\n`;
  }
  const dirs = { agents: path.join(DOT_CLAUDE, 'agents'), commands: path.join(DOT_CLAUDE, 'commands'), skills: path.join(DOT_CLAUDE, 'skills') };
  const base = dirs[type];
  if (!base || !name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (type === 'skills') return U.safeRead(path.join(base, name, 'SKILL.md'));
  // agents/commands may be nested — find by basename
  const hit = U.collectMd(base).find(f => path.basename(f) === name || path.basename(f, '.md') === name);
  return hit ? U.safeRead(hit) : null;
}

// ---------- hermes stack (the agent library's replacement, 2026-07-10) ----------
const HERMES_HOME = process.env.HERMES_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'hermes');
const HERMES_INSTALL = path.join(os.homedir(), '.hermes');
const HERMES_EXE = path.join(HERMES_INSTALL, 'venvs', 'hermes', 'Scripts', 'hermes.exe');

function hermesInfo() {
  const installed = U.safeRead(path.join(HERMES_INSTALL, 'hermes-agent', 'pyproject.toml')) !== null
    && fs.existsSync(HERMES_EXE);
  if (!installed) return { installed: false };
  const py = U.safeRead(path.join(HERMES_INSTALL, 'hermes-agent', 'pyproject.toml')) || '';
  const ver = (py.match(/^version\s*=\s*"([^"]+)"/m) || [])[1] || '';
  const cfg = U.safeRead(path.join(HERMES_HOME, 'config.yaml')) || '';
  const model = (cfg.match(/^\s*default:\s*"([^"]+)"/m) || [])[1] || '(auto)';
  const env = U.safeRead(path.join(HERMES_HOME, '.env')) || '';
  const hasKey = /^(ANTHROPIC_API_KEY|OPENROUTER_API_KEY|NOUS_API_KEY|OPENAI_API_KEY)\s*=\s*\S/m.test(env);
  // OAuth/API credentials persisted by `hermes auth` live in HERMES_HOME/auth.json
  const auth = U.safeJson(path.join(HERMES_HOME, 'auth.json'));
  const hasOauth = !!(auth && Object.keys(auth).length);
  return { installed: true, version: ver, model, credentials: hasKey || hasOauth, exe: HERMES_EXE };
}

// ---------- route handling: returns true if the request was handled ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/overview') { U.sendJson(res, overview()); return true; }
  if (p === '/api/hermes') { U.sendJson(res, hermesInfo()); return true; }
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
  if (p === '/api/detail') {
    const md = detail(url.searchParams.get('type'), url.searchParams.get('name'));
    md === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, { content: md });
    return true;
  }
  if (p === '/api/assets') { U.sendJson(res, assets()); return true; }
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
