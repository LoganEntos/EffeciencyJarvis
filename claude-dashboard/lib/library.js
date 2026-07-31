/*
 * Library routes: agents/skills/commands listing + detail viewer, the hermes
 * stack roster/info, and the local vendor/ asset library.
 *
 * Split out of lib/core.js (which was crossing the 500-line budget) to keep
 * both files under it. Pure relocation — no behavior change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');
const settings = require('./settings');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const DOT_CLAUDE = path.join(PROJECT_DIR, '.claude');

// Claude Code's own built-in dispatch targets — not project files under
// .claude/agents/, so agentList() used to silently omit them even though run
// history shows they're dispatched constantly (Explore/general-purpose/Plan).
const BUILTIN_AGENTS = [
  { name: 'general-purpose', model: 'inherit', builtin: true,
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.' },
  { name: 'Explore', model: 'inherit', builtin: true,
    description: 'Fast read-only search agent for locating code by pattern, symbol, or keyword ("where is X defined").' },
  { name: 'Plan', model: 'inherit', builtin: true,
    description: 'Software architect agent for designing implementation plans — step-by-step, critical files, trade-offs.' },
  { name: 'statusline-setup', model: 'inherit', builtin: true,
    description: "Configures the user's Claude Code status line — a one-time config agent, not a work dispatch target." },
];

function agentList() {
  const local = U.collectMd(path.join(DOT_CLAUDE, 'agents')).map(f => {
    const fm = U.frontmatter(f);
    return { file: path.basename(f), name: fm.name || path.basename(f, '.md'), description: fm.description || '', model: fm.model || '', builtin: false };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Claude-only by default (the lean stack). hermes roles appear only when the
  // deprecated paid engine is explicitly re-enabled in Config.
  // A real project file always wins a name collision with a reserved built-in.
  const localNames = new Set(local.map(a => a.name));
  const roster = (settings.load().hermesEnabled ? hermesAgents() : [])
    .concat(BUILTIN_AGENTS.filter(a => !localNames.has(a.name))).concat(local);
  const usage = agentUsage();
  return roster.map(a => {
    const u = usage.get(a.name);
    return Object.assign({}, a, { active: !!u, usageCount: u ? u.count : 0, lastUsed: u ? u.lastUsed : null });
  });
}

// ---------- agent usage: active vs dormant, mined from run history ----------
// Bounded + cached scan (mirrors agentgraph.js's C76 pattern) so an
// ever-growing data/runs can't turn an Agents-tab open into an O(all history)
// readFileSync stall. subagent_type is pulled with a cheap regex — no need to
// JSON-parse every stream-json line just to count dispatches.
const RUNS_DIR = path.join(DASH_DIR, 'data', 'runs');
const okRunId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && id.length < 64;
const USAGE_SCAN_CAP = 300;
const USAGE_CACHE_MS = 60 * 1000;
let usageCache = null, usageCacheAt = 0;
function scanAgentUsage() {
  const usage = new Map(); // name -> { count, lastUsed } (dir names are ISO timestamps, so lexical max = newest)
  const dirs = U.listDir(RUNS_DIR).filter(e => e.isDirectory() && okRunId(e.name))
    .map(e => e.name).sort().reverse().slice(0, USAGE_SCAN_CAP);
  for (const id of dirs) {
    const raw = U.safeRead(path.join(RUNS_DIR, id, 'output.jsonl'));
    if (!raw) continue;
    const re = /"subagent_type":"([a-zA-Z0-9_-]+)"/g;
    let m;
    while ((m = re.exec(raw))) {
      const e = usage.get(m[1]) || { count: 0, lastUsed: '' };
      e.count++;
      if (id > e.lastUsed) e.lastUsed = id;
      usage.set(m[1], e);
    }
  }
  return usage;
}
function agentUsage() {
  if (!usageCache || Date.now() - usageCacheAt > USAGE_CACHE_MS) { usageCache = scanAgentUsage(); usageCacheAt = Date.now(); }
  return usageCache;
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

// Serve the raw markdown of one agent/skill/command definition (path-traversal safe).
function detail(type, name) {
  // A real project file always wins a name collision with a reserved built-in
  // (matches the same precedence agentList() applies to the roster above — a
  // display name comes from frontmatter `name:` when present, not just the
  // filename, so this must check the same way or the two guards can disagree).
  const localAgentHit = type === 'agents' && U.collectMd(path.join(DOT_CLAUDE, 'agents'))
    .some(f => (U.frontmatter(f).name || path.basename(f, '.md')) === name);
  if (type === 'agents' && !localAgentHit && BUILTIN_AGENTS.some(a => a.name === name)) {
    const a = BUILTIN_AGENTS.find(x => x.name === name);
    const u = agentUsage().get(a.name);
    return `# ${a.name}\n\n${a.description}\n\nBuilt into Claude Code — not a project .claude/agents/*.md file, so there's nothing here to rename or edit; model inherits the session's routed model.\n\n`
      + (u ? `Dispatched ${u.count} time${u.count === 1 ? '' : 's'} in run history, most recently in run ${u.lastUsed}.\n` : 'Never dispatched in this project\'s run history yet.\n');
  }
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

// ---------- route handling: returns true if the request was handled ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/hermes') { U.sendJson(res, hermesInfo()); return true; }
  if (p === '/api/agents') { U.sendJson(res, agentList()); return true; }
  if (p === '/api/skills') { U.sendJson(res, skillList()); return true; }
  if (p === '/api/commands') { U.sendJson(res, commandList()); return true; }
  if (p === '/api/detail') {
    const md = detail(url.searchParams.get('type'), url.searchParams.get('name'));
    md === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, { content: md });
    return true;
  }
  if (p === '/api/assets') { U.sendJson(res, assets()); return true; }
  return false;
}

module.exports = { handle, agentList, hermesInfo };
