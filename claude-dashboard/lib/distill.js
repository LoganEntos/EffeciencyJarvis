/*
 * Jarvis distiller — the REAL prompt-craft pass (as opposed to assets/jarvis.js
 * bufferPrompt, which is only local filler-cleanup). Takes a long, spoken "vibe"
 * request and rewrites it into one clear, self-contained prompt via a fast Haiku
 * one-shot. Gated on the client by word count (short prompts skip it entirely —
 * nothing to engineer, no point paying the latency/token cost).
 *
 *   POST /api/jarvis/distill  { text }  ->  { prompt }   (prompt: '' on failure)
 *
 * Spawn invariants match the run engine (lib/runs.js): argv array, no shell, so
 * the user's text can never be shell-interpreted. Default permission mode = the
 * CLI can't edit anything in a headless -p run, so a distill can only ever emit
 * text. Zero dependencies.
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(DASH_DIR, '..');
const CLAUDE_EXE = process.env.HUB_CLAUDE_EXE || path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

// The distiller is a prompt engineer, NOT the agent: it rewrites, it never
// answers or executes. Output is the bare prompt so the client can drop it
// straight into the run + the transcript turn.
const SYS =
  'You are a prompt engineer for a coding agent working in a software repository. '
  + 'Rewrite the user\'s rough, spoken "vibe" request below into ONE clear, self-contained '
  + 'prompt that keeps their intent and every concrete detail. '
  + 'Match the ask: a build/fix/edit request becomes a precise, actionable instruction; '
  + 'a question or conversational ask stays a natural-language request — do NOT inflate it '
  + 'into a rigid spec, acceptance criteria, or a wall of technical jargon it did not ask for. '
  + 'Write in plain words a person would say; only name a specific file, function, or flag when '
  + 'the user named it themselves. Keep it concise. Do NOT invent requirements, do NOT ask '
  + 'questions, do NOT answer or perform the task, do NOT add preamble or quotes. '
  + 'Output ONLY the rewritten prompt.';

function distill(text, timeoutMs = 20000) {
  return new Promise(resolve => {
    const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!input) return resolve({ prompt: '' });
    const args = ['-p', SYS + '\n\n--- Rough request ---\n' + input, '--model', 'haiku'];
    let out = '', err = '', done = false, child;
    const finish = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { child && child.kill(); } catch {} finish({ prompt: '', error: 'timeout' }); }, timeoutMs);
    // stdio[0] MUST be 'ignore', not the node default open pipe: with an open,
    // unwritten stdin pipe the CLI spends ~3s guessing whether piped input is
    // coming before it proceeds (see docs/handoffs/distill-latency.md) — that
    // alone was roughly half of the measured latency. -p already carries the
    // full prompt as an argv, so stdin is never read.
    try { child = spawn(CLAUDE_EXE, args, { cwd: PROJECT_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return finish({ prompt: '', error: e.message }); }
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ prompt: '', error: e.message }));
    child.on('close', code => {
      const cleaned = out.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      finish(cleaned ? { prompt: cleaned } : { prompt: '', error: err.trim() || ('exit ' + code) });
    });
  });
}

async function handle(req, res, url) {
  if (url.pathname === '/api/jarvis/distill' && req.method === 'POST') {
    let b = {};
    try { b = JSON.parse(await U.readBody(req, 16 * 1024) || '{}'); } catch {}
    const r = await distill(b.text);
    // 200 even on failure with an error field: the client falls back to local
    // cleanup, so a distill miss must never block the run.
    U.sendJson(res, r);
    return true;
  }
  return false;
}

module.exports = { handle, distill };
