/* Run-tab daily-budget gauge — split out of run.js to keep it under the repo's
   500-line rule. Renders #usageGauge from /api/usage; run.js calls it on tab
   render and after each run completes. Loaded before run.js in index.html. */
'use strict';

async function renderUsageGauge() {
  const el = $('#usageGauge');
  if (!el) return;
  try {
    const usageData = await api('/api/usage');
    if (!usageData || usageData.error) {
      el.style.display = 'none';
      return;
    }
    const u = usageData.today;
    if (u.budget == null) {
      // no budget configured → show nothing (the hint text was visual clutter;
      // the Config tab already explains how to set a limit)
      el.innerHTML = '';
      return;
    }
    const pct = u.pctUsed || 0;
    const color = pct >= 90 ? 'var(--red)' : (pct >= 70 ? 'var(--amber)' : 'var(--accent)');
    el.innerHTML = `<div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);margin-bottom:16px">
      <div style="width:48px;height:48px;border-radius:50%;flex-shrink:0;background:conic-gradient(${color} ${pct * 3.6}deg, var(--line) 0deg);display:flex;align-items:center;justify-content:center">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--panel);display:flex;align-items:center;justify-content:center;flex-direction:column">
          <span class="mono" style="font-size:13px;font-weight:700;color:${color}">${pct}%</span>
          <span class="mono" style="font-size:7px;color:var(--dim);text-transform:uppercase">used</span>
        </div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Daily budget</div>
        <div class="mono" style="font-size:15px;font-weight:700;color:var(--txt)">$${Math.max(0, u.remaining).toFixed(2)} <span class="muted" style="font-size:10px;font-weight:400">left of $${u.budget.toFixed(2)}</span></div>
        <div class="muted" style="font-size:10px;margin-top:2px">burn $${u.burnPerHour.toFixed(3)}/hr</div>
      </div>
    </div>`;
  } catch (e) {
    el.style.display = 'none';
  }
}
