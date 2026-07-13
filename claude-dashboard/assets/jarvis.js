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
