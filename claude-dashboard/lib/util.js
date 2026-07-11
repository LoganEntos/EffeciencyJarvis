/*
 * Shared helpers for the hub server modules (zero-dependency).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NODE_BIN = path.dirname(process.execPath);
const NPX_CLI = path.join(NODE_BIN, 'node_modules', 'npm', 'bin', 'npx-cli.js');

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
    child.on('error', e => finish(-1, out += '\n' + e.message));
    child.on('close', finish);
    const t = setTimeout(() => { try { child.kill(); } catch {} out += '\n[timed out]'; finish(-2); }, timeoutMs);
    child.on('close', () => clearTimeout(t));
  });
}

// Invoke npx cross-platform. `npx` is a .cmd on Windows and can't be spawned
// without a shell, so run npm's npx-cli.js through node directly (no shell → no injection).
function runNpx(args, timeoutMs, cwd) {
  if (fs.existsSync(NPX_CLI)) return run(process.execPath, [NPX_CLI, ...args], timeoutMs, false, cwd);
  return run(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, timeoutMs, true, cwd);
}

module.exports = {
  safeRead, safeJson, listDir, frontmatter, collectMd,
  stripAnsi, sendJson, readBody, run, runNpx,
};
