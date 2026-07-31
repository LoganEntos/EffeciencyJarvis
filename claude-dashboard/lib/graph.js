/*
 * Codebase-graph routes (graphify-out/graph.json): stats summary, raw
 * node/link data for the Graph tab's viz, and the graphify.exe query/explain
 * bridge.
 *
 * Split out of lib/core.js (which was crossing the 500-line budget) to keep
 * both files under it. Pure relocation — no behavior change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const GRAPHIFY_EXE = process.env.HUB_GRAPHIFY_EXE
  || path.join(os.homedir(), '.local', 'bin', 'graphify.exe');
const GRAPH_JSON = path.join(DASH_DIR, 'graphify-out', 'graph.json');

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

// ---------- route handling: returns true if the request was handled ----------
async function handle(req, res, url) {
  const p = url.pathname;
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

module.exports = { handle, graphStats };
