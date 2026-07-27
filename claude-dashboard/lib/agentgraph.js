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
  fable: { persona: 'Bard', icon: '📖', blurb: 'nimble generalist' },
  '': { persona: 'Claude', icon: '✴️', blurb: 'CLI default' },
};
// Resolve a persona by tier SUBSTRING, so pinned versions the Run tab exposes
// (claude-opus-4-8, claude-sonnet-5, claude-fable-5, …) map correctly instead
// of missing the exact-key lookup and falling back to the generic "Claude".
function personaFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return MODEL_PERSONA.opus;
  if (m.includes('sonnet')) return MODEL_PERSONA.sonnet;
  if (m.includes('haiku')) return MODEL_PERSONA.haiku;
  if (m.includes('fable')) return MODEL_PERSONA.fable;
  return MODEL_PERSONA[''];
}

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

// C7: both graph builders append the same "Gallery" artifacts node + the same
// star-topology links (everything -> root) — shared here instead of copied.
function makeArtifactsNode(meta) {
  if (!meta.artifactCount) return null;
  return {
    id: 'artifacts', kind: 'artifacts', persona: 'Gallery', icon: '🖼️',
    label: `${meta.artifactCount} artifact${meta.artifactCount === 1 ? '' : 's'}`,
    count: meta.artifactCount, active: false, detail: 'files the run produced — rendered in the Run tab',
  };
}
function starLinks(nodes) {
  return nodes.filter(n => n.id !== 'run').map(n => ({ source: 'run', target: n.id }));
}

// C42: does the output carry genuine stream-json events (real assistant turns or
// tool_use blocks), as opposed to text that merely mentions those strings? Parse
// each line — a legacy -z hermes run is all hermes_out and returns false here.
function hasStreamJson(raw) {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant') return true;
    if (o.type === 'user' && o.message) return true;
    const content = o.message && o.message.content;
    if (Array.isArray(content) && content.some(b => b && b.type === 'tool_use')) return true;
  }
  return false;
}

function buildGraph(id) {
  if (!okId(id)) return null;
  const meta = runs.getRunMeta(id);
  if (!meta) return null;
  const raw = U.safeRead(path.join(RUNS_DIR, id, 'output.jsonl')) || '';
  const running = meta.status === 'running' || meta.status === 'queued';
  // H4: hermes over ACP emits real stream-json tool telemetry, so it flows
  // through the claude builder below and shows a LIVE crew. Only legacy -z runs
  // (hermes_out, no tool events) fall back to the static Maestro+crew ring.
  // C42: test parsed line types, not a whole-file substring — an answer whose
  // TEXT contains "tool_use"/"type":"assistant" (e.g. asking about API message
  // shapes) must not masquerade as a real stream-json run.
  if (meta.engine === 'hermes' && !hasStreamJson(raw)) {
    return buildHermesGraph(meta, raw, running);
  }

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

  const mp = personaFor(meta.model);
  const root = {
    id: 'run', kind: 'root', persona: mp.persona, icon: mp.icon,
    label: `${mp.persona} (${meta.model || 'default'}) — ${mp.blurb}`,
    detail: lastText || short(meta.promptExcerpt, 160),
    status: meta.status, active: running, count: 1,
  };
  const nodes = [root, ...tools.values(), ...agents.values()];
  const artNode = makeArtifactsNode(meta);
  if (artNode) nodes.push(artNode);
  const links = starLinks(nodes);
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
  const artNode = makeArtifactsNode(meta);
  if (artNode) nodes.push(artNode);
  const links = starLinks(nodes);
  return { run: meta, nodes, links };
}

async function handle(req, res, url) {
  if (url.pathname !== '/api/agentgraph') return false;
  let id = url.searchParams.get('id') || '';
  if (!id) {
    // pick newest running run, else newest run. Bound the scan to the newest N
    // run dirs (ids are ISO timestamps → reverse name-sort is newest-first) so
    // an ever-growing data/runs can't turn this default 3s Graph-tab poll into
    // an O(all history) readFileSync stall that blocks SSE. A running/queued run
    // is always recent, so the cap covers the live case. Mirrors statsToday. (C76)
    const dirs = U.listDir(RUNS_DIR)
      .filter(e => e.isDirectory() && okId(e.name))
      .map(e => e.name).sort().reverse().slice(0, 60);
    let newest = null, live = null;
    for (const name of dirs) {
      const m = runs.getRunMeta(name);
      if (!m) continue;
      if (!newest) newest = m; // dirs are newest-first, so the first meta is newest
      if (m.status === 'running' || m.status === 'queued') { live = m; break; }
    }
    id = ((live || newest) || {}).id || '';
  }
  const g = id ? buildGraph(id) : null;
  g === null ? U.sendJson(res, { error: 'no runs yet' }, 404) : U.sendJson(res, g);
  return true;
}

module.exports = { handle };
