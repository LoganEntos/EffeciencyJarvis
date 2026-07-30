/*
 * Claude Code import — the user's real Claude projects live in
 * ~/.claude/projects/<workspace>/*.jsonl (one subdirectory per workspace, its
 * name the workspace path with separators dashed out; inside are
 * <session-id>.jsonl transcript files). We adopt each workspace as a project
 * in lib/projects.js so it is archived and browsable here — sessions stay
 * where the CLI wrote them, we never move or mutate transcripts.
 *
 * Split out of lib/projects.js (which was crossing the 500-line budget) to
 * keep both files under it. Pure relocation — no behavior change.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('./util');

// Where the Claude Code CLI stores its per-workspace session transcripts.
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

// require('./projects') is lazy: projects.js requires this module at load
// time, so a top-level require here would be circular; by the time any
// function below actually runs (request time), projects.js has finished
// loading and its exports are complete. Mirrors the allRuns() lazy-require
// pattern already used in projects.js for the same reason.
function projects() { return require('./projects'); }

// A workspace dir name is a valid single path segment; reject anything that
// could escape CLAUDE_DIR before we touch the filesystem with it.
function safeDir(name) { return typeof name === 'string' && name && !/[\\/]|\.\./.test(name); }

// The dir name is the workspace path with separators dashed out — lossy (a
// real dash is indistinguishable from a separator), so we only use it as a
// fallback. The authoritative cwd is read from inside a transcript (readWorkspace).
function decodeDir(name) {
  const m = /^([A-Za-z])--(.*)$/.exec(name);
  return m ? m[1] + ':\\' + m[2].replace(/-/g, '\\') : name;
}

function titleize(s) { return (s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80); }
function sessionFiles(dir) { return U.listDir(dir).filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => e.name); }
function countSessions(claudeDir) { return safeDir(claudeDir) ? sessionFiles(path.join(CLAUDE_DIR, claudeDir)).length : 0; }

// The hub prepends persona / system-reminder / [Hub …] blocks to a run's first
// user turn; strip them so titles and transcript text read as the human wrote them.
function stripInjected(s) {
  return (s || '')
    .replace(/<persona[\s\S]*?<\/persona>/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\[Hub[\s\S]*?\]/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function userText(m) {
  if (!m) return '';
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) { for (const p of c) if (p && p.type === 'text' && p.text) return p.text; }
  return '';
}

// Cheap workspace summary: session count, newest activity, and — from the newest
// transcript only — the authoritative cwd + git branch. Avoids parsing every file.
function readWorkspace(name) {
  const dir = path.join(CLAUDE_DIR, name);
  const files = sessionFiles(dir);
  let last = null, newest = null, cwd = null, branch = null;
  for (const f of files) {
    let mt = 0; try { mt = fs.statSync(path.join(dir, f)).mtimeMs; } catch {}
    if (!newest || mt > newest.mt) newest = { f, mt };
  }
  if (newest) {
    try {
      const lines = fs.readFileSync(path.join(dir, newest.f), 'utf8').split(/\r?\n/);
      for (const l of lines) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
        if (!cwd && d.cwd) cwd = d.cwd; if (!branch && d.gitBranch) branch = d.gitBranch;
        if (d.timestamp) last = d.timestamp; if (cwd && branch) break; }
    } catch {}
  }
  return { dir: name, sessionCount: files.length, cwd: cwd || decodeDir(name), branch: branch || '', lastAt: last };
}

// Every Claude workspace, flagged with whether it is already imported here.
function discoverClaude() {
  const imported = new Set(projects().load().filter(p => p.claudeDir).map(p => p.claudeDir));
  const out = [];
  for (const e of U.listDir(CLAUDE_DIR)) {
    if (!e.isDirectory()) continue;
    const w = readWorkspace(e.name);
    if (!w.sessionCount) continue;
    out.push(Object.assign(w, { imported: imported.has(e.name) }));
  }
  out.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  return { ok: true, dir: CLAUDE_DIR, workspaces: out };
}

// Adopt selected workspaces (or all, if none named) as projects. Idempotent: a
// workspace already imported is skipped. Transcripts are left in place.
function importClaude(dirs) {
  const P = projects();
  const want = new Set(Array.isArray(dirs) ? dirs.filter(safeDir) : []);
  const list = P.load();
  const takenSlug = new Set(list.map(x => x.slug));
  const takenDir = new Set(list.filter(x => x.claudeDir).map(x => x.claudeDir));
  const now = new Date().toISOString();
  const created = [];
  for (const e of U.listDir(CLAUDE_DIR)) {
    if (!e.isDirectory() || takenDir.has(e.name)) continue;
    if (want.size && !want.has(e.name)) continue;
    const w = readWorkspace(e.name);
    if (!w.sessionCount) continue;
    const label = w.cwd ? path.basename(w.cwd.replace(/[\\/]+$/, '')) : e.name;
    const slug = P.slugify(label, takenSlug);
    const proj = { id: P.newId(), name: titleize(label) || e.name, slug, kind: 'claude', claudeDir: e.name,
      cwd: w.cwd, description: `Claude Code workspace · ${w.sessionCount} session${w.sessionCount === 1 ? '' : 's'}`,
      instructions: '', createdAt: now, updatedAt: w.lastAt || now };
    list.push(proj); takenSlug.add(slug); takenDir.add(e.name); created.push(P.shape(proj));
  }
  if (created.length) P.save(list);
  return { ok: true, count: created.length, created };
}

// Full session list for an imported workspace: title (first human turn), size,
// message count, timestamps, git branch. Parses each transcript on demand.
function projectSessions(claudeDir) {
  if (!safeDir(claudeDir)) return [];
  const dir = path.join(CLAUDE_DIR, claudeDir);
  const out = [];
  for (const f of sessionFiles(dir)) {
    let raw = ''; try { raw = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    let title = '', first = null, last = null, branch = '', msgs = 0;
    for (const l of raw.split(/\r?\n/)) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
      if (!branch && d.gitBranch) branch = d.gitBranch;
      if (d.timestamp) { if (!first) first = d.timestamp; last = d.timestamp; }
      if (d.type === 'user' || d.type === 'assistant') msgs++;
      if (!title && d.type === 'user') title = stripInjected(userText(d.message)); }
    out.push({ sid: f.replace(/\.jsonl$/, ''), title: title.slice(0, 140), messages: msgs,
      branch, firstAt: first, lastAt: last, sizeBytes: Buffer.byteLength(raw) });
  }
  return out.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
}

// A single transcript rendered as readable turns for the in-app viewer. Read-only;
// bulky tool_result payloads are dropped, tool calls kept as one-line markers.
function sessionTranscript(claudeDir, sid) {
  if (!safeDir(claudeDir) || !/^[A-Za-z0-9._-]{6,}$/.test(sid)) return null;
  const file = path.join(CLAUDE_DIR, claudeDir, sid + '.jsonl');
  if (!path.resolve(file).startsWith(path.resolve(CLAUDE_DIR) + path.sep)) return null;
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const msgs = []; let cwd = null, branch = null, first = null, last = null, truncated = false;
  const LIMIT = 600;
  for (const l of raw.split(/\r?\n/)) { if (!l) continue; let d; try { d = JSON.parse(l); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd; if (!branch && d.gitBranch) branch = d.gitBranch;
    if (d.timestamp) { if (!first) first = d.timestamp; last = d.timestamp; }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const m = d.message || {}; let text = ''; const tools = []; const c = m.content;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) for (const p of c) { if (!p) continue;
      if (p.type === 'text' && p.text) text += (text ? '\n' : '') + p.text;
      else if (p.type === 'tool_use') tools.push(p.name || 'tool'); }
    if (d.type === 'user') text = stripInjected(text);
    if (!text && !tools.length) continue;
    msgs.push({ role: d.type, text: text.slice(0, 6000), tools, ts: d.timestamp || null });
    if (msgs.length >= LIMIT) { truncated = true; break; } }
  return { sid, cwd, branch, firstAt: first, lastAt: last, messages: msgs, truncated };
}

module.exports = { CLAUDE_DIR, safeDir, decodeDir, titleize, sessionFiles, countSessions,
  stripInjected, userText, readWorkspace, discoverClaude, importClaude, projectSessions, sessionTranscript };
