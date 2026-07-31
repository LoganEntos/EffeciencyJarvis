#!/usr/bin/env node
// Dev-only browser automation for verifying the hub's own UI — the concrete
// tool behind .claude/skills/browser-qa (which used to assume a browser MCP
// that was never actually wired into this hub, so "verify in a real browser"
// had no teeth). Zero-footprint on the app itself: lives in scripts/, only
// dependency is playwright, installed in this subfolder's own node_modules
// (already gitignored), never imported by claude-dashboard/.
//
// Usage:
//   node scripts/browser-qa/qa.mjs --port 5758 --path /
//   node scripts/browser-qa/qa.mjs --url http://127.0.0.1:5758/ --click "#tab-projects" \
//     --wait-for ".pp-uploaded" --screenshot out.png --eval "document.querySelectorAll('.histSection').length"
//
// Prints one JSON summary line to stdout and exits 1 if any console error,
// uncaught page error, or 4xx/5xx network response was observed (override
// with --allow-errors) — a plain PASS/FAIL signal for agents to grep.
import { chromium } from 'playwright';

function parseArgs(argv) {
  // `steps` preserves command-line order so e.g. `--click A --wait-for B
  // --click C` runs as three sequential steps, not three batches grouped by
  // flag type (a --click-then---wait-for flow is the whole point of a CLI
  // that drives a real multi-page SPA, not just single-page smoke checks).
  const a = { steps: [], viewport: '1280x800', timeout: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    switch (k) {
      case '--url': a.url = v(); break;
      case '--port': a.port = v(); break;
      case '--path': a.path = v(); break;
      case '--click': a.steps.push({ type: 'click', sel: v() }); break;
      case '--fill': a.steps.push({ type: 'fill', sel: v(), val: v() }); break;
      case '--wait-for': a.steps.push({ type: 'waitFor', sel: v() }); break;
      case '--eval': a.steps.push({ type: 'eval', expr: v() }); break;
      case '--screenshot': a.steps.push({ type: 'screenshot', file: v() }); break;
      case '--viewport': a.viewport = v(); break;
      case '--timeout': a.timeout = +v(); break;
      case '--headed': a.headed = true; break;
      case '--allow-errors': a.allowErrors = true; break;
      default: console.error(`unknown arg ${k}`); process.exit(2);
    }
  }
  if (!a.url) {
    const port = a.port || 5757;
    const path = a.path || '/';
    a.url = `http://127.0.0.1:${port}${path.startsWith('/') ? path : '/' + path}`;
  }
  const [w, h] = a.viewport.split('x').map(Number);
  a.viewportObj = { width: w || 1280, height: h || 800 };
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: !a.headed });
  const page = await browser.newPage({ viewport: a.viewportObj });

  const consoleErrors = [], consoleWarnings = [], pageErrors = [], failedRequests = [];
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error') consoleErrors.push(msg.text());
    else if (t === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(String((err && err.stack) || (err && err.message) || err)));
  page.on('response', res => {
    const status = res.status();
    if (status >= 400) failedRequests.push({ url: res.url(), status });
  });
  page.on('requestfailed', req => failedRequests.push({ url: req.url(), status: 'failed', reason: req.failure()?.errorText }));

  let navStatus = null, fatalError = null;
  // Array, not an object keyed by expr — the same --eval expression is
  // routinely passed twice to read a value before/after an action (e.g.
  // check a box, re-read a count), and an object would silently collapse
  // those into one entry, hiding the earlier result.
  const evalResults = [];
  const screenshots = [];
  try {
    const resp = await page.goto(a.url, { waitUntil: 'networkidle', timeout: a.timeout });
    navStatus = resp ? resp.status() : null;
    for (const step of a.steps) {
      switch (step.type) {
        case 'click': await page.click(step.sel, { timeout: a.timeout }); await page.waitForTimeout(150); break;
        case 'fill': await page.fill(step.sel, step.val, { timeout: a.timeout }); break;
        case 'waitFor': await page.waitForSelector(step.sel, { timeout: a.timeout }); break;
        case 'eval':
          try { evalResults.push({ expr: step.expr, result: await page.evaluate(step.expr) }); }
          catch (e) { evalResults.push({ expr: step.expr, result: `EVAL_ERROR: ${e.message}` }); }
          break;
        case 'screenshot': await page.screenshot({ path: step.file, fullPage: true }); screenshots.push(step.file); break;
      }
    }
  } catch (e) {
    fatalError = e.message;
  }

  await browser.close();

  const summary = {
    url: a.url, navStatus, fatalError,
    consoleErrors, consoleWarnings, pageErrors, failedRequests,
    evalResults, screenshots,
  };
  console.log(JSON.stringify(summary, null, 2));

  const hasFailure = !!fatalError || consoleErrors.length || pageErrors.length || failedRequests.length;
  process.exit(hasFailure && !a.allowErrors ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
