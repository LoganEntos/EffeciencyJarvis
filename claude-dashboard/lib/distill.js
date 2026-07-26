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
// Shared resolver (env → npm global → desktop-app bundle), re-resolved when
// the cached path vanishes (app updates swap version dirs; boot contexts vary).
let CLAUDE_EXE_CACHED = null;
function claudeExe() {
  const fs = require('fs');
  if (!CLAUDE_EXE_CACHED || !fs.existsSync(CLAUDE_EXE_CACHED)) CLAUDE_EXE_CACHED = U.findClaude();
  return CLAUDE_EXE_CACHED;
}

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

// Build-shaped = an imperative "do/change something in the repo" ask. ONLY
// these are worth paraphrasing through Haiku: nuance a rewrite drops off a
// rambling build request is recoverable from the repo, but a paraphrased
// question or a precise/emotional turn loses meaning that can't be recovered.
// Everything else skips the distill step (client falls back to local cleanup).
const BUILD_RE = /\b(add|adjust|build|change|create|delete|edit|fix|generate|hook up|implement|make|migrate|move|patch|rebuild|redo|refactor|remove|rename|replace|rework|scaffold|set up|swap|tweak|update|wire|write)\b/i;
// Polite do-requests ("can you add…", "please fix…") read as questions but are
// really imperatives — keep them. A leading interrogative or a trailing '?'
// (with no such request) marks a real question ("what did you change") — skip it
// even though it contains a build verb.
const REQUEST_RE = /\b(can|could|would|will|please)\b/i;
const QUESTION_LEAD = /^(what|why|how|who|whom|whose|when|where|which|is|are|was|were|do|does|did|have|has|had|should)\b/i;
function isBuildShaped(text) {
  const t = String(text).trim();
  if (!BUILD_RE.test(t)) return false;
  if (REQUEST_RE.test(t)) return true;
  if (QUESTION_LEAD.test(t) || /\?\s*$/.test(t)) return false;
  return true;
}

// L2: 8s ceiling, not 20s. The distiller is a pre-pass BLOCKING the real run —
// if Haiku hasn't shaped the prompt by 8s it isn't worth the added wall-clock;
// the client falls back to instant local filler-cleanup and fires the run.
function distill(text, timeoutMs = 8000) {
  return new Promise(resolve => {
    const input = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!input) return resolve({ prompt: '' });
    // Skip non-build turns entirely — the client then uses the user's own words
    // (local filler-cleanup), so a question is never answered as a paraphrase.
    if (!isBuildShaped(input)) return resolve({ prompt: '', skipped: 'not build-shaped' });
    const args = ['-p', SYS + '\n\n--- Rough request ---\n' + input, '--model', 'haiku'];
    let out = '', err = '', done = false, child;
    const finish = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { child && child.kill(); } catch {} finish({ prompt: '', error: 'timeout' }); }, timeoutMs);
    // stdio[0] MUST be 'ignore', not the node default open pipe: with an open,
    // unwritten stdin pipe the CLI spends ~3s guessing whether piped input is
    // coming before it proceeds (see docs/handoffs/distill-latency.md) — that
    // alone was roughly half of the measured latency. -p already carries the
    // full prompt as an argv, so stdin is never read.
    try { child = spawn(claudeExe(), args, { cwd: PROJECT_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return finish({ prompt: '', error: e.message }); }
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ prompt: '', error: e.message }));
    child.on('close', code => {
      const cleaned = out.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      if (!cleaned) return finish({ prompt: '', error: err.trim() || ('exit ' + code) });
      // Append the user's exact words below the rewrite so nothing Haiku dropped
      // or reshaped is lost — the agent sees the engineered prompt AND the source.
      const withOriginal = cleaned
        + '\n\n--- User\'s original words (verbatim — defer to these if the rewrite lost anything) ---\n'
        + input;
      finish({ prompt: withOriginal });
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
