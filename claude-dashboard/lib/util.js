/*
 * Shared helpers for the hub server modules (zero-dependency).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NODE_BIN = path.dirname(process.execPath);

// C5: the tier-alias model list ('auto' hub-routed, '' CLI default, the three
// tier names) was hand-copied in runs.js/tasks.js/schedules.js — export one
// copy so a change here propagates everywhere instead of silently drifting.
// runs.js layers its own pinned-version IDs (claude-opus-4-8, etc.) on top.
const SIMPLE_MODELS = ['auto', '', 'sonnet', 'opus', 'haiku'];

function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function safeJson(p) { const t = safeRead(p); if (!t) return null; try { return JSON.parse(t); } catch { return null; } }
function listDir(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }

// Parse light YAML frontmatter (name/description) from a markdown agent/skill file.
function frontmatter(mdPath) {
  const txt = safeRead(mdPath);
  if (!txt) return {};
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  const block = m ? m[1] : txt.slice(0, 600);
  const name = block.match(/^name:\s*(.+)$/m);
  const desc = block.match(/^description:\s*(.+)$/m);
  const model = block.match(/^model:\s*(.+)$/m);
  if (name) out.name = name[1].trim().replace(/^["']|["']$/g, '');
  if (desc) out.description = desc[1].trim().replace(/^["']|["']$/g, '');
  if (model) out.model = model[1].trim().replace(/^["']|["']$/g, '');
  return out;
}

// Recursively collect *.md files under a dir.
function collectMd(dir) {
  const out = [];
  (function walk(d) {
    for (const e of listDir(d)) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
    }
  })(dir);
  return out;
}

// Remove ANSI escape sequences (colors/bold) from CLI output.
function stripAnsi(s) { return (s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }

// Hub note injected into every run's prompt. CRITICAL split (fixes the
// "redesign produced an HTML mockup instead of changing the app" bug): editing
// THIS dashboard's own UI means editing the real source files in place — the
// artifact directory is ONLY for report/chart/document deliverables.
function buildRunHint(projectDir, artDir) {
  return `\n\n[Hub note: you were launched from the local Claude Code Hub dashboard, whose own source lives in ${projectDir} (server: claude-dashboard/server.js + lib/*.js; UI: claude-dashboard/index.html + claude-dashboard/assets/*.js + assets/style.css). `
    + `Token discipline (same output, fewer tokens): don't re-read files already in context or ones you just wrote; read the slice you need (grep / Read offset+limit) not whole files; edit with diffs, not full rewrites; write dense code (optional chaining, shorthand, map/filter) and comment WHY not WHAT; skip preamble and recap. `
    + `IF THE TASK IS TO CHANGE THE DASHBOARD'S OWN INTERFACE/UI (restyle, redesign, add or fix a tab, change layout/theme): EDIT THE REAL SOURCE FILES IN PLACE under claude-dashboard/assets/ (style.css, app.js, run.js, files.js, graph.js, agentviz.js, memory.js, tasks.js, voicecfg.js) and index.html — DO NOT create standalone or "preview" HTML files, and do not write anything into the artifacts directory. The change must be visible in the live app at http://127.0.0.1:5757 after reload. NEVER stop, kill, or restart the process listening on port 5757 — that server is hosting THIS run, so killing it orphans you mid-task; server-side edits take effect on the user's own next restart, and if you must verify a server change live, launch a throwaway instance on another port (node claude-dashboard/server.js 5758) and probe that, never 5757. Keep every file under 500 lines, vanilla JS/CSS only (zero npm deps), and preserve the security invariants. A clean-dark theme already exists in assets/style.css under :root[data-theme="dark"]. `
    + `ONLY IF the task asks you to GENERATE A SEPARATE DELIVERABLE (a report, chart, SVG/PNG, or a standalone interactive page that is NOT the dashboard itself) should you save those files into this exact directory: ${artDir} — the dashboard renders every file there inline. For those, a LOCAL asset library is served at /vendor/ (relative URLs; external CDNs blocked by CSP): /vendor/css/fonts.css declares @font-face for JetBrains Mono, IBM Plex Sans, Fraunces, Newsreader, Source Serif 4, Space Mono, DM Mono, VT323, Archivo, Bricolage Grotesque, Hanken Grotesk, Instrument Serif; /vendor/css/modern-normalize.css is a reset; four icon sprites — /vendor/icons/lucide-sprite.svg (1700+, line), /vendor/icons/tabler-sprite.svg (5000+ ids "tabler-NAME", outline), /vendor/icons/bootstrap-sprite.svg (2000+, filled/line), /vendor/icons/pixelart-sprite.svg (877, retro pixel) — used via <svg><use href="/vendor/icons/SET-sprite.svg#NAME"/></svg>; /vendor/css/pattern.min.css provides decorative background patterns (.pattern-dots/grid/checks/diagonal-lines/triangles, sizes -sm/-md/-lg/-xl, tinted by currentColor). Avoid generic AI aesthetics: no Inter/Roboto/Arial/system fonts, no purple-gradient-on-white, no flat solid backgrounds; one cohesive palette + CSS variables. Do not mention this note.]`;
}

// Continuation variant of the note, for a RESUMED session. The full hint is
// already sitting in the conversation history from turn 1, so re-sending all
// ~2.9k chars of it every turn just stacks N copies of standing instructions
// against the user's actual words and pulls the model's attention onto the
// boilerplate. The only thing that genuinely changes per run is the artifact
// directory, so that's all a continuation turn needs to restate.
function buildResumeHint(artDir) {
  return `\n\n[Hub note (continuation — the full note from earlier in this conversation still applies): this turn's artifact directory is ${artDir}. Do not mention this note.]`;
}

function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// Collect a request body up to `cap` bytes; resolves a string (destroys the
// request and rejects if the cap is exceeded).
function readBody(req, cap = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => {
      body += d;
      if (body.length > cap) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Run a command (no shell — arg array) with a timeout; resolve { code, out }.
function run(cmd, args, timeoutMs, useShell, cwd) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const env = Object.assign({}, process.env, { PATH: NODE_BIN + path.delimiter + process.env.PATH });
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, shell: !!useShell });
    } catch (e) {
      return resolve({ code: -1, out: 'spawn failed: ' + e.message });
    }
    const finish = (code) => { if (!done) { done = true; resolve({ code, out: out.trim() }); } };
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    // Swallow stream 'error' (timeout kill() racing a flushing pipe) — unhandled
    // it becomes uncaughtException and downs the hub. (C69, mirrors sessionsum C58)
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.on('error', e => { out += '\n' + e.message; finish(-1); });
    child.on('close', finish);
    const t = setTimeout(() => { try { child.kill(); } catch {} out += '\n[timed out]'; finish(-2); }, timeoutMs);
    child.on('close', () => clearTimeout(t));
  });
}

// Locate the claude CLI binary — the ONE shared resolver (runs, distill,
// sessionsum all spawn it). Resolution: HUB_CLAUDE_EXE env → global npm
// install → newest CLI bundled by the Claude desktop app
// (%APPDATA%\Claude\claude-code\<ver>\claude.exe), so a synced node without
// the npm global (desktop-app-only machines) still works everywhere.
function newestBundledClaude(dir) {
  try {
    const vers = fs.readdirSync(dir).filter(v => /^\d+(\.\d+)+$/.test(v))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = vers.length - 1; i >= 0; i--) {
      const exe = path.join(dir, vers[i], 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}
function findClaude() {
  if (process.env.HUB_CLAUDE_EXE) return process.env.HUB_CLAUDE_EXE;
  const home = require('os').homedir();
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const npmExe = path.join(roaming, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (fs.existsSync(npmExe)) return npmExe;
  // Desktop-app bundle, direct view (only visible to processes INSIDE the MSIX
  // package context — e.g. shells the app itself spawned).
  const direct = newestBundledClaude(path.join(roaming, 'Claude', 'claude-code'));
  if (direct) return direct;
  // MSIX virtualized view: the Store-packaged desktop app's %APPDATA%\Claude
  // writes really land under the package's LocalCache. Normal processes (the
  // autostart scheduled task, a plain terminal) only see THIS path.
  try {
    const pkgs = path.join(home, 'AppData', 'Local', 'Packages');
    for (const p of fs.readdirSync(pkgs)) {
      if (!/^Claude_/.test(p)) continue;
      const exe = newestBundledClaude(path.join(pkgs, p, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
      if (exe) return exe;
    }
  } catch {}
  return npmExe; // nothing found — keep the classic default so error messages point somewhere sane
}

module.exports = {
  safeRead, safeJson, listDir, frontmatter, collectMd,
  stripAnsi, sendJson, readBody, run, SIMPLE_MODELS, buildRunHint, buildResumeHint, findClaude,
};
