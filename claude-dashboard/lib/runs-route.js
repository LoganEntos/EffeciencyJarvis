/*
 * Model routing + prompt-assembly helpers, split out of runs.js (F1: keep every
 * file under the hard 500-line rule). The model/effort tables, the 'auto'
 * routing heuristic (routeModel/isConversational), the Fable-5 god prompt, the
 * resumed-session model lookup (sessionModel), and inbox-confined attachment
 * resolution (resolveImages) all live here. createRouter() binds the shared
 * `active` Map so sessionModel reads in-flight runs the same as finished ones;
 * startRun stays in runs.js since it owns spawning + request/route handling.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const DASH_DIR = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(DASH_DIR, 'data', 'runs');
const INBOX_DIR = path.join(DASH_DIR, 'data', 'inbox');

// Selectable models: the shared tier aliases ('auto', '', opus/sonnet/haiku —
// see U.SIMPLE_MODELS, the one canonical copy) plus explicit version IDs so a
// run can be pinned to a specific Claude. Passed to the CLI as a plain argv
// element (no shell), and membership-checked before use. Add a new pinned
// version to PINNED_MODELS and it becomes selectable here; add a new tier to
// U.SIMPLE_MODELS and it propagates to runs/tasks/schedules at once.
const PINNED_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8', 'claude-opus-4-7',
  'claude-sonnet-5', 'claude-sonnet-4-6',
  'claude-haiku-4-5',
];
const MODELS = [...U.SIMPLE_MODELS, ...PINNED_MODELS];

// Fable 5 "god prompt": Anthropic's official Fable-5 prompting playbook
// (prompts/fable5-god-prompt.md), appended to the SYSTEM prompt of every
// opus-tier run via --append-system-prompt — so Opus threads get the same
// discipline (act-when-ready, evidence-backed claims, scope control) without
// touching the user's prompt.txt. Fable-5 runs don't need it: the CLI already
// ships these behaviors natively for that model. Read once at boot.
const GOD_PROMPT_FILE = path.join(DASH_DIR, 'prompts', 'fable5-god-prompt.md');
let GOD_PROMPT = '';
try {
  GOD_PROMPT = fs.readFileSync(GOD_PROMPT_FILE, 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '').trim();
} catch {}
const isOpusTier = m => m === 'opus' || /^claude-opus/.test(m || '');

// The five Fable-5-era utilization tiers (claude --effort). Tier 5 = 'max' is
// "Ultra Code": deepest reasoning, longest turns. '' = let the CLI decide.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// 'auto' model allocation — route each prompt to the cheapest model that can
// handle it (3-tier: haiku ≈ $0.04/run for trivia vs opus ≈ $0.25+). Purely
// lexical, zero-cost, instant; the decision is streamed to the chat so the
// user always sees (and can override) what auto picked.
const HEAVY_RE = /(architect|design\b|redesign|refactor|securit|review|audit|investigat|debug|diagnos|analy[sz]e|deliberat|strateg|migrat|optimi[sz]|multi-?file|across the (codebase|project)|root cause|deep|thorough|comprehensive)/;
const CODE_RE = /(implement|build|create|write|add|fix|code|function|endpoint|component|feature|test|script|bug|error|refactor|api|server|render|parse|module|css|html|sql|dax)/;
function routeModel(prompt) {
  const p = prompt.toLowerCase();
  if (HEAVY_RE.test(p) || prompt.length > 1200) return { model: 'opus', reason: 'complex/architectural task' };
  if (CODE_RE.test(p) || prompt.length > 300) return { model: 'sonnet', reason: 'standard coding task' };
  return { model: 'haiku', reason: 'short/simple task' };
}
// Conversational = short and not build-/analysis-shaped (banter, acks, quick
// questions) — the most persona-dependent turns, which routeModel lands on
// haiku. When a persona is active we floor those at sonnet. Mirrors routeModel's
// haiku bucket.
function isConversational(prompt) {
  const p = prompt.toLowerCase();
  return prompt.length <= 300 && !HEAVY_RE.test(p) && !CODE_RE.test(p);
}
// Trivial chit-chat = the whole turn is a greeting/ack/pleasantry with no task
// ("hi", "thanks", "cool", "how are you"). haiku holds the persona fine on these
// AND they're where a snappy reply matters most, so we DON'T floor them to sonnet
// — the persona floor is reserved for conversational turns that do real work (a
// substantive quick question). Matches only when the ENTIRE trimmed prompt is
// banter, so anything carrying content still gets the floor.
const TRIVIAL_RE = /^(hi|hey+|hello|yo|sup|hiya|howdy|gm|gn|good ?(morning|night|evening|afternoon)|thanks?|thank you|ty|thx|cheers|ok|okay|k|cool|nice|great|awesome|perfect|got ?it|sounds good|sure|yep|yeah|yes|nope|no|np|lol|haha+|hey there|how are you( doing)?|how'?s it going|what'?s up|wassup|bye|see ya|later|welcome|morning)[\s!.?]*$/;
function isTrivialChat(prompt) {
  return TRIVIAL_RE.test(prompt.trim().toLowerCase());
}

function createRouter({ active }) {
  // A resumed conversation keeps the model it started with — switching models
  // mid-session wastes the prompt cache and changes the voice.
  function sessionModel(sessionId) {
    // Live runs first (no disk), then history NEWEST-first with an early return —
    // run ids are timestamps so a reverse name-sort walks newest first, and a
    // resumed session is almost always recent. The old version stat-read every
    // meta.json on disk per resume, O(all history) forever.
    for (const live of active.values()) {
      if (live.meta && live.meta.sessionId === sessionId && live.meta.model) return live.meta.model;
    }
    const dirs = U.listDir(RUNS_DIR).filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
    for (const name of dirs) {
      const meta = U.safeJson(path.join(RUNS_DIR, name, 'meta.json'));
      if (meta && meta.sessionId === sessionId && meta.model) return meta.model;
    }
    return null;
  }

  // Pasted/dropped images the browser uploaded to data/inbox/ before the run.
  // Confine to the inbox (they arrive as our own /api/files response paths) and
  // keep only real files, so a stray client path can't make Claude read the disk.
  function resolveImages(images) {
    if (!Array.isArray(images)) return [];
    const out = [];
    for (const ref of images.slice(0, 8)) {
      try {
        const s = String(ref || '');
        // Accept an absolute path OR an inbox-relative name like "pasted/x.png"
        // (older clients send the name). Either way it must land inside the inbox.
        const abs = path.isAbsolute(s)
          ? path.resolve(s)
          : path.join(INBOX_DIR, ...s.split(/[/\\]/).map(seg => path.basename(seg)));
        if (abs !== INBOX_DIR && !abs.startsWith(INBOX_DIR + path.sep)) continue;
        if (fs.statSync(abs).isFile()) out.push(abs);
      } catch {}
    }
    return out;
  }

  return {
    routeModel, isConversational, isTrivialChat, sessionModel, resolveImages,
    isOpusTier, GOD_PROMPT, MODELS, EFFORTS,
  };
}

module.exports = { createRouter, MODELS, EFFORTS };
