/*
 * Agent graph (Graph tab, "Agents" view): turn one run's stream-json output
 * into a small node/link graph of WHO is working — the routed model at the
 * center, tool crews and recruited subagents around it — with live status.
 * Reads output.jsonl straight from disk; the run engine appends to that file
 * as lines stream in, so polling this endpoint during a run is live and free.
 *
 * Every worker gets a persona: a catchy, role-relevant name (user request —
 * the graph should feel personal and interactable, not like a code dump).
 */
'use strict';
const path = require('path');
const U = require('./util');
const runs = require('./runs');

const RUNS_DIR = path.join(path.resolve(__dirname, '..'), 'data', 'runs');
const okId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && id.length < 64;

const MODEL_PERSONA = {
  opus: { persona: 'Maestro', icon: '🎼', blurb: 'heavyweight reasoning' },
  sonnet: { persona: 'Poet', icon: '✒️', blurb: 'balanced builder' },
  haiku: { persona: 'Dart', icon: '🎯', blurb: 'fast + cheap' },
  '': { persona: 'Claude', icon: '✴️', blurb: 'CLI default' },
};

// tool name → crew persona (grouped: one node per crew, not per call)
const TOOL_PERSONA = [
  [/^(Read)$/, 'Scout', '🔎', 'reads files'],
  [/^(Grep|Glob)$/, 'Bloodhound', '🐾', 'hunts through the codebase'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'Scribe', '✍️', 'writes + edits files'],
  [/^(Bash|PowerShell)$/, 'Wrench', '🔧', 'runs commands'],
  [/^(WebSearch|WebFetch)$/, 'Falcon', '🌐', 'flies out to the web'],
  [/^(TodoWrite|TaskCreate|TaskUpdate)$/, 'Foreman', '📋', 'tracks the plan'],
  [/^(Skill)$/, 'Spellbook', '✨', 'invokes skills'],
  [/^(AskUserQuestion)$/, 'Herald', '📣', 'asks you questions'],
  [/^(ExitPlanMode|EnterPlanMode)$/, 'Cartographer', '🧭', 'plans the route'],
];

function toolPersona(name) {
  for (const [re, persona, icon, blurb] of TOOL_PERSONA) if (re.test(name)) return { persona, icon, blurb };
  const mcp = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__/);
  if (mcp) return { persona: 'Envoy', icon: '📡', blurb: 'talks to ' + mcp[1] };
  return { persona: name, icon: '⚙️', blurb: 'tool' };
}

const short = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

function buildGraph(id) {
  if (!okId(id)) return null;
  const meta = runs.getRunMeta(id);
  if (!meta) return null;
  const raw = U.safeRead(path.join(RUNS_DIR, id, 'output.jsonl')) || '';
  const running = meta.status === 'running' || meta.status === 'queued';
  if (meta.engine === 'hermes') return buildHermesGraph(meta, raw, running);

  const tools = new Map();   // crew persona -> node
  const agents = new Map();  // tool_use id -> subagent node
  const open = new Map();    // tool_use id -> node (awaiting tool_result)
  let lastText = '';

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text) lastText = short(b.text.trim(), 160);
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Task' || b.name === 'Agent') {
          const type = (b.input && (b.input.subagent_type || b.input.name)) || 'agent';
          const node = {
            id: 'agent:' + (b.id || agents.size), kind: 'agent',
            persona: type, icon: '🤖', label: short((b.input && b.input.description) || type, 60),
            detail: short((b.input && b.input.prompt) || '', 220), count: 1, active: true,
          };
          agents.set(b.id || String(agents.size), node);
          if (b.id) open.set(b.id, node);
        } else {
          const p = toolPersona(b.name || 'tool');
          const key = p.persona + (p.persona === 'Envoy' ? ':' + p.blurb : '');
          if (!tools.has(key)) tools.set(key, {
            id: 'tool:' + key, kind: 'tool', persona: p.persona, icon: p.icon,
            label: p.blurb, count: 0, active: false, detail: '',
          });
          const node = tools.get(key);
          node.count++;
          node.detail = short(b.input || {}, 180);
          node.active = true;
          if (b.id) open.set(b.id, node);
        }
      }
    }
    if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (b && b.type === 'tool_result' && b.tool_use_id && open.has(b.tool_use_id)) {
          open.get(b.tool_use_id).active = false;
          open.delete(b.tool_use_id);
        }
      }
    }
  }
  // "active" only means anything while the run is live
  if (!running) { for (const n of tools.values()) n.active = false; for (const n of agents.values()) n.active = false; }

  const mp = MODEL_PERSONA[meta.model] || MODEL_PERSONA[''];
  const root = {
    id: 'run', kind: 'root', persona: mp.persona, icon: mp.icon,
    label: `${mp.persona} (${meta.model || 'default'}) — ${mp.blurb}`,
    detail: lastText || short(meta.promptExcerpt, 160),
    status: meta.status, active: running, count: 1,
  };
  const nodes = [root, ...tools.values(), ...agents.values()];
  if (meta.artifactCount) nodes.push({
    id: 'artifacts', kind: 'artifacts', persona: 'Gallery', icon: '🖼️',
    label: `${meta.artifactCount} artifact${meta.artifactCount === 1 ? '' : 's'}`,
    count: meta.artifactCount, active: false, detail: 'files the run produced — rendered in the Run tab',
  });
  const links = nodes.filter(n => n.id !== 'run').map(n => ({ source: 'run', target: n.id }));
  return { run: meta, nodes, links };
}

// H3: hermes runs. -z one-shot mode emits no tool telemetry (final text only),
// so the graph shows the Maestro brain plus its standing auxiliary crew —
// pulsing while the run is live — matching the Agents-tab persona language.
function buildHermesGraph(meta, raw, running) {
  let lastText = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'hermes_out' && o.text) lastText = short(String(o.text).trim(), 160) || lastText;
  }
  const root = {
    id: 'run', kind: 'root', persona: 'Maestro', icon: '🎼',
    label: `Maestro (hermes${meta.model ? ' · ' + meta.model : ''}) — the reasoning brain`,
    detail: lastText || short(meta.promptExcerpt, 160),
    status: meta.status, active: running, count: 1,
  };
  const crew = [
    ['Crew', '🤖', 'delegate_task subagents (auto-cheap)'],
    ['Scribe', '✍️', 'context compression'],
    ['Falcon', '🌐', 'web extraction'],
    ['Scout', '🔎', 'vision + screenshots'],
    ['Archivist', '🗂️', 'session memory (FTS5)'],
  ].map(([persona, icon, blurb]) => ({
    id: 'tool:' + persona, kind: 'tool', persona, icon, label: blurb,
    count: 1, active: running, detail: 'hermes auxiliary — exact usage is not exposed by one-shot mode',
  }));
  const nodes = [root, ...crew];
  if (meta.artifactCount) nodes.push({
    id: 'artifacts', kind: 'artifacts', persona: 'Gallery', icon: '🖼️',
    label: `${meta.artifactCount} artifact${meta.artifactCount === 1 ? '' : 's'}`,
    count: meta.artifactCount, active: false, detail: 'files the run produced — rendered in the Run tab',
  });
  const links = nodes.filter(n => n.id !== 'run').map(n => ({ source: 'run', target: n.id }));
  return { run: meta, nodes, links };
}

async function handle(req, res, url) {
  if (url.pathname !== '/api/agentgraph') return false;
  let id = url.searchParams.get('id') || '';
  if (!id) {
    // pick newest running run, else newest run, from the runs dir
    const rows = [];
    for (const e of U.listDir(RUNS_DIR)) {
      if (!e.isDirectory() || !okId(e.name)) continue;
      const m = runs.getRunMeta(e.name);
      if (m) rows.push(m);
    }
    rows.sort((a, b) => (b.queuedAt || '').localeCompare(a.queuedAt || ''));
    const live = rows.find(m => m.status === 'running' || m.status === 'queued');
    id = (live || rows[0] || {}).id || '';
  }
  const g = id ? buildGraph(id) : null;
  g === null ? U.sendJson(res, { error: 'no runs yet' }, 404) : U.sendJson(res, g);
  return true;
}

module.exports = { handle };
