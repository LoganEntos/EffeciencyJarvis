/* Jarvis: vibe-code buffering and prompt transformation. Turns loose, conversational
   user input into clean, efficient prompts with smart model routing. */
'use strict';

const jarvis = {
  enabled: false,
  pickedModel: null,
};

function initJarvis() {
  try {
    jarvis.enabled = localStorage.getItem('hub.jarvis') === '1';
  } catch {}
  updateJarvisStatus();
}

function updateJarvisStatus() {
  const statusEl = $('#jarvisStatus');
  const modelSel = $('#runModel');
  const toggle = $('#jarvisToggle');
  if (!statusEl || !toggle || !toggle.checked) {
    if (statusEl) statusEl.classList.add('hidden');
    return;
  }
  const userModel = modelSel ? modelSel.value : 'auto';
  if (userModel === 'auto' || userModel === '') {
    statusEl.textContent = 'Jarvis: auto';
  } else {
    statusEl.textContent = `user: ${userModel}`;
  }
  statusEl.classList.remove('hidden');
}

function analyzePromptComplexity(text) {
  const words = text.trim().split(/\s+/).length;
  const hasCode = /```|<code>|`[^`]+`|function|class|const|let|var|import|export/.test(text);
  const hasArch = /architect|design|pattern|structure|refactor|module/.test(text.toLowerCase());
  const hasSecurity = /security|vulnerability|exploit|auth|permission|crypt/.test(text.toLowerCase());
  const hasDebugging = /debug|error|crash|trace|stack|broken|bug/.test(text.toLowerCase());
  const hasAnalysis = /analyze|research|compare|evaluate|pros|cons|tradeoff/.test(text.toLowerCase());

  let tier = 'haiku'; // default: cheap & fast for simple requests
  if (words > 300 || hasArch || hasSecurity || (hasCode && hasDebugging)) tier = 'opus';
  else if (words > 150 || hasCode || hasArch || hasAnalysis) tier = 'sonnet';
  return tier;
}

function bufferPrompt(text) {
  let cleaned = text.trim();

  // Remove conversational filler words that add noise but no semantic value
  const fillers = [
    '\\b(ok so like|like|honestly|just|really|actually|obviously|basically|literally|yeah|um|uh|hmm)\\b\\s*',
    '\\bcan you\\s+',
    '\\byou know\\s+',
    '\\bsort of\\s+',
    '\\bkind of\\s+',
  ];
  fillers.forEach(filler => {
    cleaned = cleaned.replace(new RegExp(filler, 'gi'), '');
  });

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  // Remove trailing punctuation repetition (e.g., "......" -> ".")
  cleaned = cleaned.replace(/([,.!?])\s*\1+/g, '$1');

  // Trim
  cleaned = cleaned.trim();

  return cleaned;
}

function jarvisTransform(prompt) {
  // If Jarvis is off or prompt unchanged, return null (no transformation)
  const buffered = bufferPrompt(prompt);
  if (buffered === prompt.trim()) {
    return null; // no change
  }
  return {
    original: prompt.trim(),
    buffered,
    complexity: analyzePromptComplexity(prompt),
  };
}

// Word-count gate: short prompts have nothing to engineer, so they skip the
// Haiku pre-pass (which costs ~a couple seconds + a fraction of a cent) and get
// only the instant local cleanup. Above the gate, a real vibe-dump goes through
// jarvisDistill. Tune this number as it's felt in use.
const DISTILL_MIN_WORDS = 25;

// Per-persona orb hue, clamped 28..44 so every persona stays amber-adjacent.
// Shared by jarvistab.js (accent light) and jarvisorb.js (sphere render) — the
// single source of truth so the two never drift.
const JARVIS_HUE = { jarvis: 36, 'jarvis-wit': 32, hermes: 38, athena: 30, vulcan: 40, sage: 34, dispatch: 36 };
const jarvisHueOf = id => Math.max(28, Math.min(44, JARVIS_HUE[id] || 36));

// The REAL distiller: a Haiku one-shot on the server (POST /api/jarvis/distill)
// rewrites a long, spoken request into one clear, self-contained prompt. Returns
// '' on ANY failure so the caller falls back to local cleanup and the run is
// never blocked by a distill miss.
async function jarvisDistill(text) {
  try {
    const r = await api('/api/jarvis/distill', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return (r && r.prompt) ? r.prompt.trim() : '';
  } catch { return ''; }
}
