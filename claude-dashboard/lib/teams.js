/*
 * Agent teams: named presets of Claude sub-agents (+ relevant skills + a
 * delegation-steering hint) for a mode of work. The active team's hint is
 * injected into each run so the orchestrator prefers that team's specialists.
 *
 * Two built-ins ship: "Lean" (default — no steering, token-neutral) and
 * "Excel ops" (spreadsheet/data-document work). Users can add custom teams,
 * persisted to data/teams.json; the active team id is persisted there too.
 *
 * Cost note: the hint is injected ONLY for a non-empty hint, so default "Lean"
 * runs stay exactly as cheap as before.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DATA_DIR = path.join(path.resolve(__dirname, '..'), 'data');
const FILE = path.join(DATA_DIR, 'teams.json');

// The 14 local Claude specialists (must match .claude/agents/).
const ROSTER = ['architect', 'backend-builder', 'code-reviewer', 'commit-captain',
  'data-analyst', 'doc-scribe', 'excel-formatter', 'json-wrangler', 'librarian',
  'scraper', 'security-auditor', 'test-runner', 'ui-designer', 'web-researcher'];

const BUILTINS = [
  {
    id: 'lean', name: 'Lean', builtin: true,
    description: 'Everyday coding — a tight general crew, minimal delegation, cheapest capable model per task.',
    agents: ['architect', 'backend-builder', 'code-reviewer', 'ui-designer', 'doc-scribe', 'commit-captain', 'test-runner'],
    skills: [],
    hint: '', // empty => no injection => default runs are token-neutral
  },
  {
    id: 'excel', name: 'Excel ops', builtin: true,
    description: 'Spreadsheet + data-document work — inspection, reconciliation, formatting, conversion.',
    agents: ['data-analyst', 'excel-formatter', 'json-wrangler', 'librarian'],
    skills: ['xlsx', 'apply-oos-formatting', 'oos-format', 'vpp-theme-format', 'aid-cost-format', 'aid-cost-finalize'],
    hint: 'This session focuses on Excel/CSV/data documents. When delegating, prefer these specialists: '
      + 'data-analyst (inspection, reconciliations, pivot-style breakdowns), excel-formatter (headers, status '
      + 'colors, OOS/VPP formatting, column widths), json-wrangler (CSV/JSON/config transforms), librarian '
      + '(inbox/file triage). Use the xlsx / apply-oos-formatting / vpp-theme-format skills for spreadsheet '
      + 'formatting. Route mechanical formatting to haiku-tier agents; reserve sonnet for analysis.',
  },
];

const okId = id => typeof id === 'string' && /^[a-z0-9-]{1,32}$/.test(id);

function loadState() {
  return Object.assign({ active: 'lean', custom: [] }, U.safeJson(FILE) || {});
}
function saveState(s) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); } catch {}
  return s;
}

function allTeams() {
  const s = loadState();
  const custom = Array.isArray(s.custom) ? s.custom.filter(t => t && okId(t.id) && !BUILTINS.some(b => b.id === t.id)) : [];
  return BUILTINS.concat(custom);
}
function activeTeam() {
  const s = loadState();
  return allTeams().find(t => t.id === s.active) || BUILTINS[0];
}
// The steering hint for the current run (empty string when none).
function activeHint() {
  const t = activeTeam();
  return t && t.hint ? { name: t.name, text: `\n\n[Active agent team: ${t.name} — ${t.hint}]` } : null;
}

function selectTeam(id) {
  if (!allTeams().some(t => t.id === id)) return { error: 'unknown team' };
  const s = loadState(); s.active = id; saveState(s);
  return { ok: true, active: id };
}
function saveTeam(b) {
  if (!okId(b.id) || BUILTINS.some(t => t.id === b.id)) return { error: 'bad or reserved id (a-z0-9-, not a built-in)' };
  if (!b.name || typeof b.name !== 'string') return { error: 'name required' };
  const team = {
    id: b.id, name: String(b.name).slice(0, 40), builtin: false,
    description: String(b.description || '').slice(0, 200),
    agents: (Array.isArray(b.agents) ? b.agents : []).filter(a => ROSTER.includes(a)),
    skills: (Array.isArray(b.skills) ? b.skills : []).map(String).slice(0, 24),
    hint: String(b.hint || '').slice(0, 1200),
  };
  const s = loadState();
  s.custom = (Array.isArray(s.custom) ? s.custom.filter(t => t.id !== b.id) : []).concat([team]);
  saveState(s);
  return { ok: true, team };
}
function deleteTeam(id) {
  const s = loadState();
  if (BUILTINS.some(t => t.id === id)) return { error: 'cannot delete a built-in team' };
  s.custom = (Array.isArray(s.custom) ? s.custom : []).filter(t => t.id !== id);
  if (s.active === id) s.active = 'lean';
  saveState(s);
  return { ok: true };
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/teams' && req.method === 'GET') {
    U.sendJson(res, { active: loadState().active, roster: ROSTER, teams: allTeams() }); return true;
  }
  if (p === '/api/teams/select' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = selectTeam(String(b.id || '')); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  if (p === '/api/teams/save' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 8000) || '{}'); } catch {}
    const r = saveTeam(b); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  if (p === '/api/teams/delete' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = deleteTeam(String(b.id || '')); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  return false;
}

module.exports = { handle, activeTeam, activeHint, allTeams };
