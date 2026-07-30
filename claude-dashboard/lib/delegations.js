/*
 * Delegation-visibility scoreboard (Jarvis-as-orchestrator, Phase 0 / gap E):
 * surfaces every subagent dispatch (Task/Agent tool_use) found in run history
 * so we get a real signal on whether Jarvis actually delegates well, before
 * any wording tweak to the god-prompt/persona/team-hint gets evaluated.
 * Reads output.jsonl straight from disk — same live-and-free polling story as
 * lib/agentgraph.js's Graph tab.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const runs = require('./runs');

const RUNS_DIR = path.join(path.resolve(__dirname, '..'), 'data', 'runs');
// mirrors lib/agentgraph.js's okId — keep in sync
const okId = id => typeof id === 'string' && /^[a-z0-9-]+$/.test(id) && id.length < 64;

const short = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

// tool_result content is either a plain string or an array of content blocks
// ({type:'text', text}) — flatten to text for the excerpt.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n');
  return '';
}

// parse mirrors lib/agentgraph.js's buildGraph loop (same output.jsonl event
// shapes: assistant tool_use blocks, user tool_result blocks) — keep in sync.
// Extra bit agentgraph doesn't need: every event a Task/Agent spawns is tagged
// by the CLI with parent_tool_use_id === the dispatching tool_use's id, so we
// can count the subagent's OWN tool calls and (recursively) catch a subagent
// that itself delegates further.
function parseDelegations(raw, runStartIso) {
  const dispatches = new Map(); // tool_use id (or synthetic) -> record, insertion order
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      // nested activity emitted BY a subagent we already dispatched
      if (o.parent_tool_use_id && dispatches.has(o.parent_tool_use_id)) {
        const rec = dispatches.get(o.parent_tool_use_id);
        for (const b of o.message.content) if (b && b.type === 'tool_use') rec.toolCalls++;
      }
      for (const b of o.message.content) {
        if (!b || b.type !== 'tool_use') continue;
        if (b.name !== 'Task' && b.name !== 'Agent') continue;
        const id = b.id || ('synthetic:' + dispatches.size);
        const agentType = (b.input && (b.input.subagent_type || b.input.name)) || 'agent';
        dispatches.set(id, {
          id, agentType,
          description: (b.input && b.input.description) || agentType,
          promptExcerpt: short((b.input && b.input.prompt) || '', 220),
          at: o.timestamp || runStartIso || null, // assistant lines rarely carry their own timestamp — fall back to run start
          toolCalls: 0,
          outcome: 'unresolved',
          resultExcerpt: '',
        });
      }
    }

    if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b || b.type !== 'tool_result' || !b.tool_use_id) continue;
        const rec = dispatches.get(b.tool_use_id);
        if (!rec) continue;
        rec.outcome = b.is_error ? 'error' : 'done';
        rec.resultExcerpt = short(resultText(b.content), 220);
      }
    }
  }
  return Array.from(dispatches.values());
}

// {runId, items: [record...]} for a single run.
function extractDelegations(runId) {
  if (!okId(runId)) return { runId, items: [] };
  const meta = runs.getRunMeta(runId);
  const raw = U.safeRead(path.join(RUNS_DIR, runId, 'output.jsonl'));
  if (raw == null) return { runId, items: [] };
  const items = parseDelegations(raw, meta && meta.startedAt).map(r => Object.assign({ runId }, r));
  return { runId, items };
}

// Scoreboard across recent history. Bounded to the newest 60 run dirs (dir
// names sort-reverse to newest-first) so an ever-growing data/runs can't turn
// this into an O(all history) readFileSync stall — mirrors agentgraph's C76
// slice and health's own scan caps.
function listRecent(limit = 40) {
  const dirs = U.listDir(RUNS_DIR)
    .filter(e => e.isDirectory() && okId(e.name))
    .map(e => e.name).sort().reverse().slice(0, 60);

  const items = [];
  for (const runId of dirs) {
    const meta = runs.getRunMeta(runId);
    if (!meta) continue;
    const raw = U.safeRead(path.join(RUNS_DIR, runId, 'output.jsonl'));
    if (raw == null) continue;
    for (const r of parseDelegations(raw, meta.startedAt)) {
      items.push(Object.assign({
        runId, parentRunId: runId,
        parentPromptExcerpt: short(meta.promptExcerpt || '', 220),
      }, r));
    }
  }
  items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  const byType = {};
  for (const r of items) {
    const t = r.agentType || 'agent';
    if (!byType[t]) byType[t] = { count: 0, totalToolCalls: 0 };
    byType[t].count++;
    byType[t].totalToolCalls += r.toolCalls || 0;
  }
  for (const t of Object.keys(byType)) {
    byType[t].avgToolCalls = byType[t].count ? +(byType[t].totalToolCalls / byType[t].count).toFixed(1) : 0;
    delete byType[t].totalToolCalls;
  }

  return { items: items.slice(0, limit), byType };
}

async function handle(req, res, url) {
  if (url.pathname !== '/api/delegations' || req.method !== 'GET') return false;
  const runId = url.searchParams.get('runId') || '';
  if (runId) {
    // malformed id and missing dir both 404 — same convention as agentgraph's
    // ?id= and projects' ?slug= (a bad/traversal query param isn't worth a
    // distinct 400; it just isn't a run that exists)
    if (!okId(runId) || !fs.existsSync(path.join(RUNS_DIR, runId))) { U.sendJson(res, { error: 'not found' }, 404); return true; }
    U.sendJson(res, extractDelegations(runId));
    return true;
  }
  U.sendJson(res, listRecent());
  return true;
}

module.exports = { extractDelegations, listRecent, handle };
