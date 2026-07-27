/*
 * Admin tools for self-servicing the hub from its own UI (Config tab):
 *   - MCP connectors: view/add/remove servers in .mcp.json
 *   - Site editor:    read/write a WHITELISTED set of the hub's own text files
 *                     (front-end, server modules, docs, config)
 *   - Git:            status + a guarded "commit all"
 *
 * Security: every mutating route is already X-Hub-Token-guarded by server.js.
 * The file editor is a strict allowlist (see listEditable) resolved under the
 * project dir — no path traversal, no arbitrary files. Git runs via argv arrays
 * (no shell). Localhost-only, same as the rest of the hub.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const MCP_FILE = path.join(PROJECT_DIR, '.mcp.json');
const MAX_WRITE = 600 * 1024;

// ---------- editable-file allowlist ----------
function walkExt(rel, re, add) {
  const base = path.join(PROJECT_DIR, rel);
  (function w(dir, r) {
    for (const e of U.listDir(dir)) {
      const cr = r ? r + '/' + e.name : e.name;
      if (e.isDirectory()) w(path.join(dir, e.name), cr);
      else if (e.isFile() && re.test(e.name)) add(cr);
    }
  })(base, rel);
}
function listEditable() {
  const out = [];
  const add = r => out.push(r.replace(/\\/g, '/'));
  for (const f of U.listDir(PROJECT_DIR)) if (f.isFile() && /\.md$/i.test(f.name)) add(f.name);
  if (fs.existsSync(MCP_FILE)) add('.mcp.json');
  walkExt('docs', /\.(md|txt)$/i, add);
  add('claude-dashboard/index.html');
  walkExt('claude-dashboard/assets', /\.(js|css)$/i, add);
  walkExt('claude-dashboard/lib', /\.js$/i, add);
  return [...new Set(out)].sort();
}
const normRel = p => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
function editablePath(rel) {
  rel = normRel(rel);
  if (rel.includes('..') || !listEditable().includes(rel)) return null;
  const full = path.resolve(PROJECT_DIR, rel);
  if (full !== PROJECT_DIR && !full.startsWith(PROJECT_DIR + path.sep)) return null;
  return full;
}

// ---------- MCP connectors ----------
function readMcp() { return U.safeJson(MCP_FILE) || { mcpServers: {} }; }
function writeMcp(obj) { fs.writeFileSync(MCP_FILE, JSON.stringify(obj, null, 2) + '\n'); }
const okName = n => typeof n === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(n);

function addMcp(b) {
  if (!okName(b.name)) return { error: 'bad server name (letters/digits/._- , max 64)' };
  const cfg = readMcp();
  cfg.mcpServers = cfg.mcpServers || {};
  let entry;
  if (b.url) {                                   // remote/HTTP connector
    if (!/^https?:\/\//i.test(b.url)) return { error: 'url must start with http(s)://' };
    entry = { type: b.type === 'sse' ? 'sse' : 'http', url: String(b.url) };
  } else if (b.command) {                        // stdio connector
    entry = { command: String(b.command) };
    if (Array.isArray(b.args)) entry.args = b.args.map(String);
    else if (typeof b.args === 'string' && b.args.trim()) entry.args = b.args.trim().split(/\s+/);
    if (b.env && typeof b.env === 'object') entry.env = b.env;
  } else return { error: 'provide either a command (stdio) or a url (remote)' };
  cfg.mcpServers[b.name] = entry;
  try { writeMcp(cfg); } catch (e) { return { error: e.message }; }
  return { ok: true, servers: cfg.mcpServers };
}
function removeMcp(name) {
  const cfg = readMcp();
  if (!cfg.mcpServers || !cfg.mcpServers[name]) return { error: 'not found' };
  delete cfg.mcpServers[name];
  try { writeMcp(cfg); } catch (e) { return { error: e.message }; }
  return { ok: true, servers: cfg.mcpServers };
}

// ---------- git ----------
async function gitStatus() {
  const g = a => U.run('git', a, 8000, false, PROJECT_DIR);
  const st = await g(['status', '--porcelain=v1', '-b']);
  if (st.code !== 0) return { installed: /not recognized|ENOENT|command not found/.test(st.out) ? false : true, error: st.out.slice(0, 300) };
  const lines = st.out.split('\n').filter(Boolean);
  let branch = '', ahead = 0, behind = 0;
  const changes = [];
  for (const ln of lines) {
    if (ln.startsWith('##')) {
      branch = (ln.slice(2).trim().match(/^[^ .]+/) || [''])[0];
      const am = ln.match(/ahead (\d+)/); if (am) ahead = +am[1];
      const bm = ln.match(/behind (\d+)/); if (bm) behind = +bm[1];
    } else changes.push({ xy: ln.slice(0, 2), path: ln.slice(3) });
  }
  const log = await g(['log', '--oneline', '-8']);
  return { installed: true, branch, ahead, behind, changes, log: log.out.split('\n').filter(Boolean) };
}
async function gitCommit(message) {
  const msg = String(message || '').trim();
  if (!msg) return { error: 'commit message required' };
  // add -A stages every non-ignored change. .mcp.json is gitignored (and no
  // longer tracked) precisely because addMcp writes env blocks that routinely
  // hold API keys — so it is skipped here and can never reach git history.
  const add = await U.run('git', ['add', '-A'], 15000, false, PROJECT_DIR);
  if (add.code !== 0) return { error: 'git add failed: ' + add.out.slice(0, 300) };
  const c = await U.run('git', ['commit', '-m', msg], 20000, false, PROJECT_DIR);
  if (c.code !== 0) return { error: (c.out || 'nothing to commit').slice(0, 400) };
  return { ok: true, out: c.out.slice(0, 400) };
}

// ---------- routes ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/admin/mcp' && req.method === 'GET') { U.sendJson(res, { servers: readMcp().mcpServers || {} }); return true; }
  if (p === '/api/admin/mcp' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    const r = addMcp(b); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  if (p === '/api/admin/mcp/remove' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 4000) || '{}'); } catch {}
    const r = removeMcp(String(b.name || '')); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  if (p === '/api/admin/files' && req.method === 'GET') { U.sendJson(res, { files: listEditable() }); return true; }
  if (p === '/api/admin/file' && req.method === 'GET') {
    const full = editablePath(url.searchParams.get('path'));
    if (!full) { U.sendJson(res, { error: 'not editable' }, 403); return true; }
    U.sendJson(res, { path: normRel(url.searchParams.get('path')), content: U.safeRead(full) || '' }); return true;
  }
  if (p === '/api/admin/file' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, MAX_WRITE) || '{}'); } catch {}
    const full = editablePath(b.path);
    if (!full) { U.sendJson(res, { error: 'not editable' }, 403); return true; }
    if (typeof b.content !== 'string' || b.content.length > MAX_WRITE) { U.sendJson(res, { error: 'bad content' }, 400); return true; }
    try { fs.writeFileSync(full, b.content); } catch (e) { U.sendJson(res, { error: e.message }, 500); return true; }
    U.sendJson(res, { ok: true, path: normRel(b.path), bytes: Buffer.byteLength(b.content) }); return true;
  }
  if (p === '/api/admin/git' && req.method === 'GET') { U.sendJson(res, await gitStatus()); return true; }
  if (p === '/api/admin/git/commit' && req.method === 'POST') {
    let b = {}; try { b = JSON.parse(await U.readBody(req, 8000) || '{}'); } catch {}
    const r = await gitCommit(b.message); U.sendJson(res, r, r.error ? 400 : 200); return true;
  }
  return false;
}

module.exports = { handle, listEditable, editablePath };
