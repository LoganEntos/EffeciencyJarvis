/* Agents view for the Graph tab: a live radial map of who is working on a run
   — the routed model persona at the center, tool crews and recruited subagents
   orbiting it. Active workers pulse and their links flow while Claude thinks;
   click any node to inspect it, click the center to open the run. Polls the
   free local /api/agentgraph endpoint (disk read, zero tokens) while live. */
'use strict';

const aviz = { runId: null, graph: null, raf: null, poll: null, sel: null, hover: null, pinned: false };

function stopAgentViz() {
  if (aviz.raf) cancelAnimationFrame(aviz.raf);
  if (aviz.poll) clearInterval(aviz.poll);
  aviz.raf = aviz.poll = null;
}

async function renderAgentViz(body) {
  stopAgentViz();
  body.innerHTML = `
    <div class="flex" style="margin-bottom:12px">
      <select id="avRun" style="margin:0;max-width:420px"></select>
      <span id="avStatus"></span>
      <span class="muted" style="font-size:11px">updates live while a run is active · click the center to open the run</span>
    </div>
    <div id="avCanvas"></div>
    <div id="avDetail" class="row hidden" style="margin-top:10px"></div>`;
  let runsList = [];
  try { runsList = await api('/api/runs'); } catch {}
  if (!Array.isArray(runsList) || !runsList.length) {
    $('#avCanvas').innerHTML = '<div class="muted">No runs yet — send a prompt in the Run tab and watch the crew appear here.</div>';
    return;
  }
  const live = runsList.find(m => m.status === 'running' || m.status === 'queued');
  // follow the live run automatically (the point of the view) unless the user
  // manually pinned another run via the selector
  if (live && !aviz.pinned) aviz.runId = live.id;
  else if (!aviz.runId || !runsList.some(m => m.id === aviz.runId)) { aviz.runId = (live || runsList[0]).id; aviz.pinned = false; }
  const sel = $('#avRun');
  sel.innerHTML = runsList.slice(0, 15).map(m =>
    `<option value="${esc(m.id)}">${m.status === 'running' ? '⚡ ' : ''}${esc((m.promptExcerpt || m.id).slice(0, 60))}</option>`).join('');
  sel.value = aviz.runId;
  sel.onchange = () => { aviz.runId = sel.value; aviz.pinned = true; aviz.sel = null; fetchAgentGraph(); };
  await fetchAgentGraph();
  // permanent light poll (local disk read, zero tokens): keeps the crew live
  // during a run and auto-jumps to a new run the moment one starts
  aviz.poll = setInterval(() => { if (!$('#graph').classList.contains('hidden')) fetchAgentGraph(); }, 3000);
  drawLoop();
}

async function fetchAgentGraph() {
  let g;
  const q = aviz.pinned && aviz.runId ? `?id=${encodeURIComponent(aviz.runId)}` : '';
  try { g = await api('/api/agentgraph' + q); } catch { return; }
  if (g.error) return;
  aviz.graph = g;
  if (g.run.id !== aviz.runId) { // server picked a newer/live run — follow it
    aviz.runId = g.run.id;
    aviz.sel = null;
    const sel = $('#avRun');
    if (sel) {
      if (![...sel.options].some(o => o.value === g.run.id)) {
        sel.insertAdjacentHTML('afterbegin', `<option value="${esc(g.run.id)}">⚡ ${esc((g.run.promptExcerpt || g.run.id).slice(0, 60))}</option>`);
      }
      sel.value = g.run.id;
    }
  }
  const running = g.run.status === 'running' || g.run.status === 'queued';
  const st = $('#avStatus');
  if (st) st.innerHTML = `<span class="pill ${g.run.status === 'done' ? 'ok' : running ? 'warn' : 'err'}">${esc(g.run.status)}</span>`
    + (g.run.costUsd != null ? `<span class="pill neutral">$${g.run.costUsd.toFixed(3)}</span>` : '');
  renderAgentDetail(aviz.sel);
}

// radial layout: root center, everyone else on an ellipse, stable order
function layoutNodes(W, H) {
  const g = aviz.graph;
  const ring = g.nodes.filter(n => n.kind !== 'root');
  const cx = W / 2, cy = H / 2;
  const rx = Math.min(W / 2 - (W < 500 ? 58 : 110), W < 500 ? 140 : 330);
  const ry = H / 2 - (W < 500 ? 56 : 78);
  const pos = { run: { x: cx, y: cy } };
  ring.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
    pos[n.id] = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  return pos;
}

function drawLoop() {
  const holder = $('#avCanvas');
  if (!holder) return;
  const W = holder.clientWidth || 800, H = window.innerWidth <= 760 ? 320 : 440, DPR = window.devicePixelRatio || 1;
  holder.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.cssText = `width:100%;height:${H}px;display:block;background:transparent;border:1px solid var(--line);border-radius:4px;cursor:default`;
  holder.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  const css = getComputedStyle(document.documentElement);
  const ACCENT = css.getPropertyValue('--accent').trim() || '#e8a33d';
  const GREEN = css.getPropertyValue('--green').trim() || '#4bc47a';
  const LINE = css.getPropertyValue('--line').trim() || '#2a251d';
  const LINE2 = css.getPropertyValue('--line2').trim() || '#ffffff24';
  const PANEL = css.getPropertyValue('--panel').trim() || '#17140f';
  const MUTED = css.getPropertyValue('--muted').trim() || '#a89e8a';
  const TXT = css.getPropertyValue('--txt').trim() || '#ece7dc';
  const radius = n => n.kind === 'root' ? 34 : 20 + Math.min(8, (n.count || 1) * 1.5);
  const color = n => n.kind === 'root' ? ACCENT : n.kind === 'agent' ? GREEN : n.kind === 'artifacts' ? TXT : MUTED;

  canvas.onmousemove = e => {
    const r = canvas.getBoundingClientRect();
    aviz.hover = hitNode(e.clientX - r.left, e.clientY - r.top, W, H);
    canvas.style.cursor = aviz.hover ? 'pointer' : 'default';
  };
  canvas.onclick = () => {
    if (!aviz.hover) return;
    if (aviz.hover.kind === 'root' || aviz.hover.kind === 'artifacts') { goTab('run'); ensureRunUI(); openRun(aviz.runId); return; }
    aviz.sel = aviz.hover.id;
    renderAgentDetail(aviz.sel);
  };
  function hitNode(x, y, W, H) {
    if (!aviz.graph) return null;
    const pos = layoutNodes(W, H);
    return aviz.graph.nodes.find(n => {
      const p = pos[n.id];
      return p && Math.hypot(x - p.x, y - p.y) < radius(n) + 8;
    }) || null;
  }

  function frame(t) {
    if (!document.body.contains(canvas)) return stopAgentViz();
    if ($('#graph').classList.contains('hidden')) { aviz.raf = requestAnimationFrame(frame); return; }
    ctx.clearRect(0, 0, W, H);
    const g = aviz.graph;
    if (!g) { aviz.raf = requestAnimationFrame(frame); return; }
    const pos = layoutNodes(W, H);
    const pulse = 0.5 + 0.5 * Math.sin(t / 320);
    // links (animated dashes toward active workers)
    for (const l of g.links) {
      const a = pos[l.source], b = pos[l.target];
      if (!a || !b) continue;
      const target = g.nodes.find(n => n.id === l.target);
      const act = target && target.active;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = act ? ACCENT : LINE2;
      ctx.lineWidth = act ? 1.6 : 0.8;
      ctx.setLineDash(act ? [6, 6] : []);
      ctx.lineDashOffset = act ? -(t / 40) % 12 : 0;
      ctx.globalAlpha = act ? .9 : .55;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // nodes
    for (const n of g.nodes) {
      const p = pos[n.id];
      if (!p) continue;
      const r = radius(n) + (n.active ? pulse * 3 : 0);
      const c = color(n);
      ctx.globalAlpha = 1;
      if (n.active || n.kind === 'root') {
        ctx.shadowColor = c; ctx.shadowBlur = n.active ? 18 + pulse * 14 : 12;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = PANEL; ctx.fill();
      ctx.lineWidth = n.id === aviz.sel ? 3 : n.kind === 'root' ? 2.2 : 1.4;
      ctx.strokeStyle = n === aviz.hover ? TXT : c;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${n.kind === 'root' ? 22 : 15}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.icon, p.x, p.y + 1);
      ctx.font = `${n.kind === 'root' ? '800 12.5' : '500 11'}px "JetBrains Mono",Consolas,monospace`;
      ctx.fillStyle = n === aviz.hover || n.id === aviz.sel ? TXT : c;
      ctx.fillText(n.persona, p.x, p.y + r + 15);
      if (n.count > 1) {
        ctx.font = '500 9.5px "JetBrains Mono",Consolas,monospace';
        ctx.fillStyle = MUTED;
        ctx.fillText('×' + n.count, p.x, p.y + r + 28);
      }
      // root: model sub-label under the persona, à la "Poet · sonnet-5"
      if (n.kind === 'root' && aviz.graph.run && aviz.graph.run.model) {
        ctx.font = '500 10px "JetBrains Mono",Consolas,monospace';
        ctx.fillStyle = MUTED;
        ctx.fillText('· ' + aviz.graph.run.model, p.x, p.y + r + 30);
      }
    }
    ctx.globalAlpha = 1;
    aviz.raf = requestAnimationFrame(frame);
  }
  aviz.raf = requestAnimationFrame(frame);
}

function renderAgentDetail(id) {
  const el = $('#avDetail');
  if (!el) return;
  const n = id && aviz.graph ? aviz.graph.nodes.find(x => x.id === id) : null;
  if (!n) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="flex" style="justify-content:space-between">
      <span class="name">${n.icon} ${esc(n.persona)} <span class="muted" style="font-weight:400;font-size:11.5px">${esc(n.label || '')}</span></span>
      <span>${n.active ? '<span class="pill warn">working…</span>' : '<span class="pill ok">idle</span>'}${n.count > 1 ? `<span class="pill neutral">×${n.count} calls</span>` : ''}</span>
    </div>
    ${n.detail ? `<div class="pex" style="white-space:normal;margin-top:6px">${esc(n.detail)}</div>` : ''}`;
}
