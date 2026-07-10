/* Graph tab: graphify stats/query + zero-dependency force-directed canvas viz. */
'use strict';

renderers.graph = async function () {
  const d = await api('/api/graph/stats');
  if (!d.exists) {
    $('#graph').innerHTML = `<h2>Code Graph</h2>
      <div class="note">${esc(d.error || 'graph.json not found')} — expected at <span class="mono">claude-dashboard/graphify-out/graph.json</span></div>`;
    return;
  }
  $('#graph').innerHTML = `
    <h2>Code Graph <span class="muted" style="font-weight:400">(graphify-out/graph.json)</span></h2>
    <div class="cards">
      <div class="card"><div class="n">${d.nodes}</div><div class="l">Nodes</div></div>
      <div class="card"><div class="n">${d.edges}</div><div class="l">Edges</div></div>
      <div class="card"><div class="n">${d.communities}</div><div class="l">Communities</div></div>
    </div>
    <div class="flex" style="margin-bottom:14px">
      <select id="graphMode" style="padding:10px 14px;background:var(--panel2);border:1px solid var(--line);
        border-radius:8px;color:var(--txt);font-size:13px">
        <option value="query">query</option>
        <option value="explain">explain</option>
      </select>
      <input class="search" id="graphQ" style="flex:1;margin:0"
        placeholder="query: keywords to traverse from (e.g. 'run') · explain: a node id (e.g. 'server_run')">
      <button id="graphBtn">Ask graph</button>
    </div>
    <pre id="graphOut" class="hidden"></pre>
    <h2 style="font-size:12px;margin-top:22px">Graph map <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— search to highlight · click a node to inspect · drag to rearrange</span></h2>
    <input class="search" id="graphFind" placeholder="Find a node by name or file… (Enter selects the best match)">
    <div id="graphViz" style="margin-bottom:6px"><div class="muted">Loading graph…</div></div>
    <div id="nodeDetail" class="row hidden" style="margin-top:8px"></div>
    <h2 style="font-size:12px;margin-top:22px">Top nodes by degree</h2>
    <div>${d.topNodes.map(n => `<div class="row"><div class="flex" style="justify-content:space-between">
      <span class="name mono">${esc(n.label)}</span>
      <span class="muted">degree ${n.degree} · community ${n.community} · ${esc(n.file)} ${esc(n.loc)}</span></div></div>`).join('')}</div>`;
  const ask = async () => {
    const q = $('#graphQ').value.trim();
    if (!q) return;
    const out = $('#graphOut');
    out.classList.remove('hidden');
    out.textContent = 'Running graphify ' + $('#graphMode').value + '…';
    try {
      const r = await api('/api/graph/query', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: $('#graphMode').value, q }), timeoutMs: 60000 });
      out.textContent = r.output || r.error || '(no output)';
    } catch (e) { out.textContent = 'Query failed: ' + (e.name === 'AbortError' ? 'timed out' : (e.message || 'network error')); }
  };
  $('#graphBtn').onclick = ask;
  $('#graphQ').onkeydown = e => { if (e.key === 'Enter') ask(); };
  api('/api/graph/data').then(g => {
    if (g && Array.isArray(g.nodes) && g.nodes.length) {
      const viz = drawGraphViz($('#graphViz'), g);
      const f = $('#graphFind');
      f.oninput = () => viz.find(f.value.trim().toLowerCase());
      f.onkeydown = e => { if (e.key === 'Enter') viz.selectFirst(); };
    } else $('#graphViz').innerHTML = '<div class="muted">graph data unavailable</div>';
  });
};

function drawGraphViz(container, data) {
  const W = container.clientWidth || 800, H = 520, DPR = window.devicePixelRatio || 1;
  const rootCss = getComputedStyle(document.documentElement);
  const BG = (rootCss.getPropertyValue('--bg') || '#14141f').trim();
  const LINE = (rootCss.getPropertyValue('--line') || '#333350').trim();
  const MUTED = (rootCss.getPropertyValue('--muted') || '#a0a0b0').trim();
  container.innerHTML = '';
  document.querySelectorAll('.gtip').forEach(t => t.remove()); // re-render safety
  const canvas = document.createElement('canvas');
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.cssText = `width:100%;height:${H}px;display:block;background:${BG};border:1px solid ${LINE};border-radius:8px`;
  container.appendChild(canvas);
  const tip = document.createElement('div');
  tip.className = 'gtip hidden';
  document.body.appendChild(tip);
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  // working copies, seeded on a phyllotaxis spiral so warmup converges fast
  const hue = c => `hsl(${(c * 67) % 360} 60% 60%)`;
  const nodes = data.nodes.map((n, i) => ({
    id: n.id, label: n.label || n.id, community: +n.community || 0, file: n.file || '',
    x: W / 2 + 14 * Math.sqrt(i + 1) * Math.cos(i * 2.399963),
    y: H / 2 + 14 * Math.sqrt(i + 1) * Math.sin(i * 2.399963),
    vx: 0, vy: 0, deg: 0,
  }));
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const links = data.links
    .map(l => ({ s: byId[l.source], t: byId[l.target], relation: l.relation || '' }))
    .filter(l => l.s && l.t && l.s !== l.t);
  const nbr = {}; nodes.forEach(n => nbr[n.id] = new Set());
  for (const l of links) { l.s.deg++; l.t.deg++; nbr[l.s.id].add(l.t.id); nbr[l.t.id].add(l.s.id); }
  const rad = n => 5 + Math.sqrt(n.deg);

  // physics: pairwise repulsion + link springs + mild centering, clamped & damped
  const REP = 2600, SPRING = 0.02, REST = 95, CENTER = 0.012, DAMP = 0.85, PAD = 18, VMAX = 14;
  let dragNode = null;
  function step() {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = dx * dx + dy * dy + .01; }
      const d = Math.sqrt(d2), f = REP / d2, fx = f * dx / d, fy = f * dy / d;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING * (d - REST), fx = f * dx / d, fy = f * dy / d;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    for (const n of nodes) {
      if (n === dragNode) { n.vx = 0; n.vy = 0; continue; }
      n.vx = (n.vx + (W / 2 - n.x) * CENTER) * DAMP; n.vy = (n.vy + (H / 2 - n.y) * CENTER) * DAMP;
      n.x += Math.max(-VMAX, Math.min(VMAX, n.vx));
      n.y += Math.max(-VMAX, Math.min(VMAX, n.vy));
      n.x = Math.max(PAD, Math.min(W - PAD, n.x)); n.y = Math.max(PAD, Math.min(H - PAD, n.y));
    }
  }
  for (let k = 0; k < 60; k++) step(); // warmup before first paint

  let hover = null, alpha = 1, selected = null;
  const matches = new Set(); // search hits — emphasized over everything else
  function emphasis(n) {
    if (matches.size) return matches.has(n.id) ? 1 : .12;
    const focus = hover || selected;
    if (!focus) return 1;
    return (n === focus || nbr[focus.id].has(n.id)) ? 1 : .22;
  }
  function draw() {
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const focus = hover || selected;
    for (const l of links) {
      const lit = focus && (l.s === focus || l.t === focus);
      ctx.strokeStyle = lit ? '#b7a4ff' : '#3a3a58';
      ctx.lineWidth = lit ? 1.4 : 0.7;
      ctx.globalAlpha = matches.size ? .25 : 1;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    }
    for (const n of nodes) {
      ctx.globalAlpha = emphasis(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, rad(n) + (n === hover || n === selected ? 2 : 0), 0, 6.2832);
      ctx.fillStyle = hue(n.community); ctx.fill();
      if (n === hover) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (n === selected) { ctx.strokeStyle = '#8b6cff'; ctx.lineWidth = 2.2; ctx.stroke(); }
      if (matches.has(n.id)) { ctx.strokeStyle = '#e0a63f'; ctx.lineWidth = 1.8; ctx.stroke(); }
    }
    ctx.font = '10px Segoe UI,sans-serif'; ctx.textAlign = 'center';
    for (const n of nodes) {
      ctx.globalAlpha = emphasis(n);
      ctx.fillStyle = (n === hover || n === selected) ? '#fff' : MUTED;
      ctx.fillText(n.label.slice(0, 24), n.x, n.y - rad(n) - 5);
    }
    ctx.globalAlpha = 1;
  }
  (function loop() {
    if (!canvas.isConnected) return; // section re-rendered — stop this instance
    if (alpha > 0.02) { step(); alpha *= 0.985; }
    draw();
    requestAnimationFrame(loop);
  })();

  // mouse: hover tooltip + highlight, drag to pin, click → explain
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
  const pick = p => { let best = null, bd = 1e9; for (const n of nodes) { const dx = n.x - p.x, dy = n.y - p.y, d = dx * dx + dy * dy, r = rad(n) + 6; if (d < r * r && d < bd) { best = n; bd = d; } } return best; };
  let downAt = null;
  canvas.onmousedown = e => { dragNode = pick(pos(e)); downAt = { x: e.clientX, y: e.clientY }; if (dragNode) alpha = 1; };
  canvas.onmousemove = e => {
    if (dragNode) {
      const p = pos(e);
      dragNode.x = Math.max(PAD, Math.min(W - PAD, p.x));
      dragNode.y = Math.max(PAD, Math.min(H - PAD, p.y));
      alpha = 1; tip.classList.add('hidden');
      return;
    }
    const n = pick(pos(e));
    hover = n;
    canvas.style.cursor = n ? 'pointer' : 'default';
    if (n) {
      tip.innerHTML = `<b>${esc(n.label)}</b><br><span class="mono">${esc(n.file)}</span> · community ${n.community} · ${n.deg} link${n.deg === 1 ? '' : 's'}`;
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
  };
  canvas.onmouseleave = () => { hover = null; tip.classList.add('hidden'); };
  window.addEventListener('mouseup', e => {
    if (dragNode && downAt && Math.abs(e.clientX - downAt.x) < 4 && Math.abs(e.clientY - downAt.y) < 4) {
      selectNode(dragNode);
    }
    dragNode = null; downAt = null;
  });

  // ---- inspection panel: what IS this node, what touches it, one-click explain ----
  const detail = document.querySelector('#nodeDetail');
  function selectNode(n) {
    selected = n;
    if (!n) { if (detail) detail.classList.add('hidden'); return; }
    const neighbors = [...nbr[n.id]].map(id => byId[id]).filter(Boolean).sort((a, b) => b.deg - a.deg);
    detail.classList.remove('hidden');
    detail.innerHTML = `
      <div class="flex" style="justify-content:space-between">
        <span class="name mono">${esc(n.label)}</span>
        <span class="muted" style="font-size:11.5px">${esc(n.file || 'no file')} · community ${n.community} · ${n.deg} link${n.deg === 1 ? '' : 's'}</span>
      </div>
      <div class="flex" style="margin-top:8px">
        <button class="ghost" id="ndExplain" style="padding:6px 12px;font-size:11.5px">⌬ Explain via graphify</button>
        <button class="ghost" id="ndClear" style="padding:6px 12px;font-size:11.5px">✕ Deselect</button>
        <span class="muted" style="font-size:11px">connected:</span>
        ${neighbors.map(m => `<span class="pill neutral ndnb" data-id="${esc(m.id)}" style="cursor:pointer">${esc(m.label)}</span>`).join('') || '<span class="muted" style="font-size:11px">nothing</span>'}
      </div>`;
    detail.querySelector('#ndExplain').onclick = () => {
      $('#graphMode').value = 'explain';
      $('#graphQ').value = n.label;
      $('#graphBtn').click();
    };
    detail.querySelector('#ndClear').onclick = () => selectNode(null);
    detail.querySelectorAll('.ndnb').forEach(c => c.onclick = () => { const m = byId[c.dataset.id]; if (m) selectNode(m); });
  }

  return {
    find(q) {
      matches.clear();
      if (q) for (const n of nodes) if ((n.label + ' ' + (n.file || '')).toLowerCase().includes(q)) matches.add(n.id);
    },
    selectFirst() {
      const first = nodes.filter(n => matches.has(n.id)).sort((a, b) => b.deg - a.deg)[0];
      if (first) selectNode(first);
    },
  };
}
