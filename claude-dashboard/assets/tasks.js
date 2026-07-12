/* Tasks tab: a durable queue of improvement prompts the hub works through as
   auto-routed runs. Offloads building off expensive interactive sessions onto
   cheap hub runs — the token-efficiency payoff. Zero per-run cost: a task is
   just a prompt handed to the existing run engine. */
'use strict';

let taskPoll = null;

renderers.tasks = async function () {
  ensureTasksUI();
  await Promise.all([refreshTasks(), refreshSchedules()]);
};
renderers.tasks.noSkeleton = true;

function ensureTasksUI() {
  if ($('#taskList')) return;
  $('#tasks').innerHTML = `
    <h2>Tasks <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— queue work for the hub to run itself</span></h2>
    <div class="note">Each task is a prompt the hub runs on your behalf with automatic model routing.
      Queue improvement items and let cheap runs work through them instead of driving every change by hand.</div>
    <div style="margin-bottom:18px">
      <input class="search" id="taskTitle" placeholder="Short title (optional)" style="margin-bottom:8px">
      <textarea id="taskPrompt" placeholder="The prompt to run… (e.g. 'Add a dark/light theme toggle to the hub header')" style="min-height:70px"></textarea>
      <div class="flex">
        <select id="taskModel" style="margin:0">
          <option value="auto">model: auto (routed)</option>
          <option value="haiku">haiku</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
        </select>
        <button id="taskAdd">＋ Queue task</button>
        <button id="taskRunAll" class="ghost">▶ Run all queued</button>
        <span class="muted" id="taskCount" style="font-size:11.5px"></span>
      </div>
    </div>
    <div id="taskList"><div class="muted">Loading…</div></div>
    <h2 style="margin-top:34px">Scheduled runs <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— recurring prompts the hub fires on its own (while the server is up)</span></h2>
    <div style="margin-bottom:18px">
      <input class="search" id="schTitle" placeholder="Short title (optional)" style="margin-bottom:8px">
      <textarea id="schPrompt" placeholder="The recurring prompt… (e.g. 'Summarize the last week of run history + errors into a report artifact')" style="min-height:56px"></textarea>
      <div class="flex">
        <select id="schKind" style="margin:0">
          <option value="daily">daily at</option>
          <option value="weekly">weekly on</option>
          <option value="interval">every N minutes</option>
        </select>
        <select id="schDow" class="hidden" style="margin:0">
          <option value="1">Mon</option><option value="2">Tue</option><option value="3">Wed</option>
          <option value="4">Thu</option><option value="5">Fri</option><option value="6">Sat</option><option value="0">Sun</option>
        </select>
        <input id="schAt" type="time" value="08:00" style="width:auto;margin:0;padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);color:var(--txt);font-family:inherit">
        <input id="schMin" type="number" min="15" step="15" value="60" class="hidden" style="width:90px;margin:0;padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r);color:var(--txt);font-family:inherit">
        <select id="schModel" style="margin:0">
          <option value="auto">model: auto (routed)</option>
          <option value="haiku">haiku</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
        </select>
        <button id="schAdd">＋ Schedule</button>
      </div>
    </div>
    <div id="schList"><div class="muted">Loading…</div></div>`;
  $('#taskAdd').onclick = addTask;
  $('#taskRunAll').onclick = runAllTasks;
  $('#taskPrompt').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addTask(); } };
  $('#schKind').onchange = () => {
    const k = $('#schKind').value;
    $('#schDow').classList.toggle('hidden', k !== 'weekly');
    $('#schAt').classList.toggle('hidden', k === 'interval');
    $('#schMin').classList.toggle('hidden', k !== 'interval');
  };
  $('#schAdd').onclick = addSchedule;
}

// ---- scheduled runs (N3) ----
function relFuture(t) {
  if (!t) return '';
  const s = (new Date(t).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'due now';
  if (s < 3600) return 'in ' + Math.max(1, Math.round(s / 60)) + 'm';
  if (s < 86400) return 'in ' + Math.round(s / 3600) + 'h';
  return 'in ' + Math.round(s / 86400) + 'd';
}

async function addSchedule() {
  const prompt = $('#schPrompt').value.trim();
  if (!prompt) return;
  const kind = $('#schKind').value;
  const body = { title: $('#schTitle').value.trim(), prompt, model: $('#schModel').value, kind,
    at: $('#schAt').value, dow: $('#schDow').value, minutes: $('#schMin').value };
  try {
    const r = await api('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.error) { alert(r.error); return; }
  } catch (e) { alert('Failed to schedule: ' + (e.message || 'network error')); return; }
  $('#schTitle').value = ''; $('#schPrompt').value = '';
  refreshSchedules();
}

async function refreshSchedules() {
  const el = $('#schList');
  if (!el) return;
  let list;
  try { list = await api('/api/schedules'); } catch { el.innerHTML = '<div class="muted">Schedules unavailable.</div>'; return; }
  if (!Array.isArray(list)) list = [];
  el.innerHTML = list.length ? list.map(s => {
    const st = s.lastRunStatus;
    const pill = st === 'done' ? 'ok' : (st === 'error' ? 'err' : 'warn');
    const meta = [s.cadence, s.enabled ? 'next ' + relFuture(s.nextDue) : 'paused',
      s.runCount ? s.runCount + ' fired' : 'never fired',
      s.lastRunCost != null ? '$' + s.lastRunCost.toFixed(3) : ''].filter(Boolean).join(' · ');
    return `<div class="row" style="${s.enabled ? '' : 'opacity:.55'}">
      <div class="flex" style="justify-content:space-between">
        <span class="name">◷ ${esc(s.title)}</span>
        <span>${st ? `<span class="pill ${pill}">last: ${esc(st)}</span>` : ''}<span class="pill ${s.enabled ? 'neutral' : 'warn'}">${s.enabled ? esc(s.cadence) : 'paused'}</span></span>
      </div>
      <div class="pex">${esc(s.prompt.slice(0, 160))}</div>
      <div class="flex" style="margin-top:8px">
        <span class="muted" style="font-size:11px">${esc(meta)}</span>
        <span class="spacer" style="flex:1"></span>
        ${s.lastRunId ? `<button class="ghost sOpen" data-run="${esc(s.lastRunId)}" style="padding:5px 11px;font-size:11px">last run</button>` : ''}
        <button class="ghost sNow" data-id="${esc(s.id)}" style="padding:5px 11px;font-size:11px">▶ run now</button>
        <button class="ghost sTog" data-id="${esc(s.id)}" style="padding:5px 11px;font-size:11px">${s.enabled ? '⏸ pause' : '▶ resume'}</button>
        <button class="danger sDel" data-id="${esc(s.id)}" aria-label="Delete schedule" style="padding:5px 11px;font-size:11px">✕</button>
      </div>
    </div>`;
  }).join('') : '<div class="muted">No schedules yet — create one above (e.g. a Monday-morning report of last week\'s runs).</div>';
  const post = (url, id) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  el.querySelectorAll('.sNow').forEach(b => b.onclick = async () => {
    try { const r = await post('/api/schedules/run-now', b.dataset.id); if (r.error) alert(r.error); } catch {}
    refreshSchedules();
  });
  el.querySelectorAll('.sTog').forEach(b => b.onclick = async () => {
    try { await post('/api/schedules/toggle', b.dataset.id); } catch {}
    refreshSchedules();
  });
  el.querySelectorAll('.sDel').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this schedule?')) return;
    try { await post('/api/schedules/delete', b.dataset.id); } catch {}
    refreshSchedules();
  });
  el.querySelectorAll('.sOpen').forEach(b => b.onclick = () => { goTab('run'); ensureRunUI(); openRun(b.dataset.run); });
}

async function addTask() {
  const prompt = $('#taskPrompt').value.trim();
  if (!prompt) return;
  try {
    await api('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#taskTitle').value.trim(), prompt, model: $('#taskModel').value }) });
  } catch (e) { alert('Failed to queue: ' + (e.message || 'network error')); return; }
  $('#taskTitle').value = ''; $('#taskPrompt').value = '';
  refreshTasks();
}

async function runAllTasks() {
  try { await api('/api/tasks/run-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch {}
  refreshTasks();
}

const taskState = t => {
  if (!t.runId) return { label: 'queued', cls: 'neutral' };
  if (t.runStatus === 'done') return { label: 'done', cls: 'ok' };
  if (t.runStatus === 'error') return { label: 'failed', cls: 'err' };
  if (t.runStatus === 'cancelled' || t.runStatus === 'gone') return { label: t.runStatus, cls: 'warn' };
  return { label: 'running', cls: 'warn' };
};

async function refreshTasks() {
  const el = $('#taskList');
  if (!el) return;
  let list;
  try { list = await api('/api/tasks'); } catch { el.innerHTML = '<div class="muted">Task queue unavailable.</div>'; return; }
  if (!Array.isArray(list)) list = [];
  const queued = list.filter(t => !t.runId).length;
  const running = list.filter(t => t.runId && !['done', 'error', 'cancelled', 'gone'].includes(t.runStatus)).length;
  $('#taskCount').textContent = `${list.length} total · ${queued} queued · ${running} running`;
  el.innerHTML = list.length ? list.map(t => {
    const s = taskState(t);
    const meta = [t.model, t.costUsd != null ? '$' + t.costUsd.toFixed(3) : '', t.artifactCount ? '◫ ' + t.artifactCount : '', t.startedAt ? rel(t.startedAt) : ''].filter(Boolean).join(' · ');
    return `<div class="row">
      <div class="flex" style="justify-content:space-between">
        <span class="name">${esc(t.title || t.prompt.slice(0, 60))}</span>
        <span><span class="pill ${s.cls}">${s.label}</span></span>
      </div>
      <div class="pex">${esc(t.prompt.slice(0, 160))}</div>
      ${t.errorExcerpt ? `<div class="pex" style="color:#f0908f;white-space:normal">↳ ${esc(t.errorExcerpt)}</div>` : ''}
      <div class="flex" style="margin-top:8px">
        <span class="muted" style="font-size:11px">${esc(meta)}</span>
        <span class="spacer" style="flex:1"></span>
        ${t.runId && ['done', 'error', 'cancelled', 'gone'].includes(t.runStatus) ? `<button class="ghost tOpen" data-run="${esc(t.runId)}" style="padding:5px 11px;font-size:11px">view run</button>` : ''}
        ${(!t.runId || ['error', 'cancelled', 'gone'].includes(t.runStatus)) ? `<button class="ghost tRun" data-id="${esc(t.id)}" style="padding:5px 11px;font-size:11px">${t.runId ? 'retry' : '▶ run'}</button>` : ''}
        <button class="danger tDel" data-id="${esc(t.id)}" aria-label="Delete task" style="padding:5px 11px;font-size:11px">✕</button>
      </div>
    </div>`;
  }).join('') : '<div class="muted">No tasks yet — queue one above.</div>';
  el.querySelectorAll('.tRun').forEach(b => b.onclick = async () => {
    try { const r = await api('/api/tasks/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) }); if (r.error) alert(r.error); }
    catch {}
    refreshTasks();
  });
  el.querySelectorAll('.tDel').forEach(b => b.onclick = async () => {
    try { await api('/api/tasks/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) }); }
    catch {}
    refreshTasks();
  });
  el.querySelectorAll('.tOpen').forEach(b => b.onclick = () => { goTab('run'); ensureRunUI(); openRun(b.dataset.run); });

  // poll while anything is running so status/cost fill in live; stop when idle
  if (running && !taskPoll) {
    taskPoll = setInterval(() => {
      if ($('#tasks').classList.contains('hidden')) return; // don't poll a hidden tab
      refreshTasks();
    }, 4000);
  } else if (!running && taskPoll) { clearInterval(taskPoll); taskPoll = null; }
}
