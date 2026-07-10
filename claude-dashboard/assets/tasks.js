/* Tasks tab: a durable queue of improvement prompts the hub works through as
   auto-routed runs. Offloads building off expensive interactive sessions onto
   cheap hub runs — the token-efficiency payoff. Zero per-run cost: a task is
   just a prompt handed to the existing run engine. */
'use strict';

let taskPoll = null;

renderers.tasks = async function () {
  ensureTasksUI();
  await refreshTasks();
};
renderers.tasks.noSkeleton = true;

function ensureTasksUI() {
  if ($('#taskList')) return;
  $('#tasks').innerHTML = `
    <h2>Tasks — queue work for the hub to run itself</h2>
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
    <div id="taskList"><div class="muted">Loading…</div></div>`;
  $('#taskAdd').onclick = addTask;
  $('#taskRunAll').onclick = runAllTasks;
  $('#taskPrompt').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addTask(); } };
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
        <button class="danger tDel" data-id="${esc(t.id)}" style="padding:5px 11px;font-size:11px">✕</button>
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
