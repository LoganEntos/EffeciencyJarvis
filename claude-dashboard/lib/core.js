/*
 * Core hub routes: overview stats, app config, and session transcript
 * tailing/activity. Library (agents/skills/commands/assets/hermes) lives in
 * lib/library.js; codebase-graph routes live in lib/graph.js — both split out
 * of this file to keep it under the 500-line budget. Pure relocation there;
 * no behavior change.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./util');
const library = require('./library');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const DOT_CLAUDE = path.join(PROJECT_DIR, '.claude');

// ---------- data collectors ----------
function overview() {
  const agents = library.agentList().length;
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

// The hub's own headless one-shots (the distiller + the session summarizer)
// spawn `claude -p` with cwd = PROJECT_DIR, so the CLI writes their transcript
// into this project's session folder. Their only "conversation" is our system
// prompt echoed back, so they must never appear as real coding sessions. Detect
// them by the marker text their prompt always starts with (same markers as
// lib/sessionsum.js) and drop them from sessions()/activity(). Memoized by
// id+size — these files are tiny and immutable once written, so we read a file's
// head at most once.
const ONESHOT_MARKERS = ['You are debriefing a past Claude Code', 'You are a prompt engineer for a coding agent'];
// The prompt of a hub one-shot always appears as a `content` value at the very
// top of its transcript (the CLI's queue-operation "enqueue" record carries the
// full `-p` prompt), so match the marker as the start of any content value in the
// file HEAD. We regex the raw head rather than JSON.parse per line because these
// one-shots embed a whole transcript tail in one line that can run tens of KB —
// longer than any fixed head read — which would truncate the line and defeat
// line-based parsing. An 8KB head always contains that top enqueue record.
const ONESHOT_RE = new RegExp('"content"\\s*:\\s*"(' +
  ONESHOT_MARKERS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
const oneShotMemo = new Map(); // `${id}:${size}` -> bool
function isInternalOneShot(file, id, size) {
  const key = id + ':' + size;
  if (oneShotMemo.has(key)) return oneShotMemo.get(key);
  let hit = false;
  try {
    const bytes = Math.min(size, 8 * 1024);
    const buf = Buffer.alloc(bytes);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, bytes, 0); } finally { fs.closeSync(fd); }
    hit = ONESHOT_RE.test(buf.toString('utf8'));
  } catch {}
  // A growing (live) transcript changes size on every poll, so drop any prior
  // entry for this id before inserting — keeps at most one key per session id
  // instead of leaking a dead key per poll. Hard cap as a final backstop.
  for (const k of oneShotMemo.keys()) { if (k.length > id.length && k[id.length] === ':' && k.startsWith(id)) oneShotMemo.delete(k); }
  if (oneShotMemo.size > 4000) oneShotMemo.clear();
  oneShotMemo.set(key, hit);
  return hit;
}

function sessions() {
  const dir = sessionsDir();
  const out = [];
  for (const e of U.listDir(dir)) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const full = path.join(dir, e.name);
    let st; try { st = fs.statSync(full); } catch { st = {}; }
    const size = st.size || 0;
    const id = e.name.replace('.jsonl', '');
    if (size && isInternalOneShot(full, id, size)) continue; // hub one-shot, not a coding session
    out.push({ id, sizeKb: size ? Math.round(size / 1024) : 0, modified: st.mtime || null });
  }
  return out.sort((a, b) => new Date(b.modified) - new Date(a.modified));
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

// ---------- route handling: returns true if the request was handled ----------
async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/api/overview') { U.sendJson(res, overview()); return true; }
  if (p === '/api/config') { U.sendJson(res, config()); return true; }
  if (p === '/api/sessions') { U.sendJson(res, { dir: sessionsDir(), list: sessions() }); return true; }
  if (p === '/api/session-tail') {
    const n = Math.min(200, Math.max(1, parseInt(url.searchParams.get('n') || '50', 10) || 50));
    const events = sessionTail(url.searchParams.get('id') || '', n);
    events === null ? U.sendJson(res, { error: 'not found' }, 404) : U.sendJson(res, events);
    return true;
  }
  if (p === '/api/activity') { U.sendJson(res, activity()); return true; }
  return false;
}

module.exports = { handle, PROJECT_DIR, DASH_DIR, sessions, sessionTail };
