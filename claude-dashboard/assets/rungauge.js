/* Run-tab today-at-a-glance gauge — split out of run.js to keep it under the
   repo's 500-line rule. Renders #usageGauge from /api/usage; run.js calls it
   on tab render and after each run completes. Loaded before run.js in
   index.html. Tokens + completion% only — no dollar figures anywhere. */
'use strict';

async function renderUsageGauge() {
  const el = $('#usageGauge');
  if (!el) return;
  try {
    const usageData = await api('/api/usage');
    if (!usageData || usageData.error) { el.style.display = 'none'; return; }
    const u = usageData.today;
    if (!u.runs) { el.innerHTML = ''; return; } // nothing run today — no clutter
    const pct = u.completionPct;
    const color = pct == null ? 'var(--dim)' : (pct >= 90 ? 'var(--accent)' : (pct >= 70 ? 'var(--amber)' : 'var(--red)'));
    const ringPct = pct == null ? 0 : pct;
    el.innerHTML = `<div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);margin-bottom:16px">
      <div style="width:48px;height:48px;border-radius:50%;flex-shrink:0;background:conic-gradient(${color} ${ringPct * 3.6}deg, var(--line) 0deg);display:flex;align-items:center;justify-content:center">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--panel);display:flex;align-items:center;justify-content:center;flex-direction:column">
          <span class="mono" style="font-size:13px;font-weight:700;color:${color}">${pct != null ? pct + '%' : '—'}</span>
          <span class="mono" style="font-size:7px;color:var(--dim);text-transform:uppercase">done</span>
        </div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Today</div>
        <div class="mono" style="font-size:15px;font-weight:700;color:var(--txt)">${fmtTok(u.tokensTotal)} tok <span class="muted" style="font-size:10px;font-weight:400">· ${u.runs} run${u.runs === 1 ? '' : 's'}</span></div>
        <div class="muted" style="font-size:10px;margin-top:2px">${fmtTok(u.tokensPerHour)} tok/hr · ${u.done} done · ${u.failed} failed${u.cancelled ? ' · ' + u.cancelled + ' cancelled' : ''}</div>
      </div>
    </div>`;
  } catch (e) {
    el.style.display = 'none';
  }
}
