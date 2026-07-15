/*
 * Failure diagnosis for finished runs (adapted from DanWahlin/agent-sdk-core's
 * diagnoseError, re-targeted at the hub's claude-CLI failure modes). Data-driven:
 * the FIRST rule whose `test` matches wins, so keep specific patterns above
 * generic ones and extend by inserting rows. Split out of runs.js to respect
 * the 500-line budget.
 */
'use strict';

const RULES = [
  { // the real error behind "mobile can't do anything": a headless -p run in an
    // untrusted workspace silently drops allow rules / denies every tool call.
    test: /Ignoring \d+ permissions\.allow entries|hasTrustDialogAccepted|not trusted/i,
    hint: 'workspace not trusted — open the project once in interactive `claude` and accept the trust dialog (sets hasTrustDialogAccepted for it in ~/.claude.json), then re-run.' },
  { test: /ENOENT|is not recognized|not found/i,
    hint: 'Claude CLI not found — check the claude.exe install (npm i -g @anthropic-ai/claude-code) or point HUB_CLAUDE_EXE at it.' },
  { test: /EACCES|permission denied/i,
    hint: 'file ownership/permissions problem — the run could not read or write something it touched; check who owns the project directory.' },
  { test: /\bauth(entication|orization)?\b|unauthorized|credential|\btoken\b|not logged in|\blogin\b/i,
    hint: 'authentication problem — make sure the claude CLI is logged in for the user running the hub (`claude login`), or that ANTHROPIC_API_KEY is set.' },
];

// Match a failed run's stderr/exit info to an actionable one-liner; null when
// nothing recognizable matched (callers keep the raw excerpt either way).
function diagnose(stderr, exitCode) {
  const text = (stderr || '').toString();
  if (!text.trim()) return null;
  for (const r of RULES) if (r.test.test(text)) return r.hint;
  return null;
}

module.exports = { diagnose };
