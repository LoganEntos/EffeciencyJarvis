/* Client-error beacon — the browser's black box recorder.
   Loaded FIRST (before app.js) so it also catches errors thrown during a tab's
   own init. Installs window.onerror + unhandledrejection + a console.error tap,
   and beacons each one to /api/clientlog, where a run can read it back. This is
   how we catalog errors on the phone / in a voice session — no DevTools needed.
   Self-throttled and self-silencing so it can never become the noise it reports. */
'use strict';
(function () {
  const meta = document.querySelector('meta[name="hub-token"]');
  const token = (meta && meta.content) || '';
  if (token === '__HUB_' + 'TOKEN__' || location.protocol === 'file:') return; // not a live hub
  let sent = 0, lastKey = '', lastAt = 0;
  const MAX = 60;                       // hard cap per page load — never a beacon storm

  function currentTab() {
    try {
      const s = document.querySelector('main > section:not(.hidden)[id]');
      return s ? s.id : (location.hash || '').replace('#', '') || '';
    } catch { return ''; }
  }
  function post(rec) {
    if (sent >= MAX) return;
    const key = (rec.msg || '') + '@' + (rec.line || '');
    const now = Date.now();
    if (key === lastKey && now - lastAt < 1500) return; // collapse tight repeats
    lastKey = key; lastAt = now; sent++;
    try {
      fetch('/api/clientlog', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Hub-Token': token },
        body: JSON.stringify(Object.assign({ tab: currentTab() }, rec)),
      }).catch(() => {});
    } catch { /* never let logging throw */ }
  }

  window.addEventListener('error', (e) => {
    // resource-load errors (img/script 404) have no .error and a target — tag them
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {
      post({ kind: 'resource', msg: 'failed to load ' + (e.target.src || e.target.href), src: e.target.tagName });
      return;
    }
    post({
      kind: 'error', msg: (e && e.message) || 'error',
      src: e && e.filename, line: e && e.lineno, col: e && e.colno,
      stack: e && e.error && e.error.stack,
    });
  }, true); // capture phase so resource errors (which don't bubble) are seen

  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    post({ kind: 'promise', msg: (r && (r.message || r)) || 'unhandled rejection', stack: r && r.stack });
  });

  // Tap console.error too — some paths swallow throws and only console.error.
  const orig = console.error && console.error.bind(console);
  if (orig) console.error = function () {
    try { post({ kind: 'console', msg: Array.from(arguments).map(a => (a && a.stack) || String(a)).join(' ') }); } catch {}
    return orig.apply(console, arguments);
  };
})();
