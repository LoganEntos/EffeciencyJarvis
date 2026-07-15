/* Graph tab: two views — Agents (live crew of the current run, agentviz.js)
   and Codebase (graphify force-directed map). Agents is the default view. */
'use strict';

renderers.graph = async function () {
  $('#graph').innerHTML = `
    <h2>Graph</h2>
    <div class="flex" style="margin-bottom:14px">
      <span class="pill modeChip" data-m="agents" style="cursor:pointer">⚡ Agents — live run crew</span>
      <span class="pill modeChip" data-m="code" style="cursor:pointer">⌬ Codebase map</span>
    </div>
    <div id="graphBody"></div>`;
  const setMode = async (m) => {
    try { localStorage.setItem('hub.graphmode', m); } catch {}
    document.querySelectorAll('.modeChip').forEach(c => {
      c.className = 'pill modeChip ' + (c.dataset.m === m ? 'neutral' : '');
      c.style.cursor = 'pointer';
    });
    if (m === 'agents') await renderAgentViz($('#graphBody'));
    else { stopAgentViz(); await renderCodeGraph($('#graphBody')); }
  };
  document.querySelectorAll('.modeChip').forEach(c => c.onclick = () => setMode(c.dataset.m));
  // deep-linkable: ?tab=graph&graphmode=code&codeview=symbols
  let mode = null;
  try { mode = new URLSearchParams(location.search).get('graphmode'); } catch {}
  await setMode(mode === 'code' || mode === 'agents' ? mode : (localStorage.getItem('hub.graphmode') || 'agents'));
};
renderers.graph.noSkeleton = true;

async function renderCodeGraph(body) {
  const d = await api('/api/graph/stats');
  if (!d.exists) {
    body.innerHTML = `<div class="note">${esc(d.error || 'graph.json not found')} — expected at <span class="mono">claude-dashboard/graphify-out/graph.json</span></div>`;
    return;
  }
  body.innerHTML = `
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
    <div class="flex" style="margin-bottom:10px">
      <span class="pill viewChip" data-v="modules" style="cursor:pointer">◈ Modules</span>
      <span class="pill viewChip" data-v="symbols" style="cursor:pointer">⌬ All symbols</span>
    </div>
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
    if (!(g && Array.isArray(g.nodes) && g.nodes.length)) {
      $('#graphViz').innerHTML = '<div class="muted">graph data unavailable</div>';
      return;
    }
    const show = (v) => {
      try { localStorage.setItem('hub.codeview', v); } catch {}
      document.querySelectorAll('.viewChip').forEach(c => {
        c.className = 'pill viewChip ' + (c.dataset.v === v ? 'neutral' : '');
        c.style.cursor = 'pointer';
      });
      const viz = drawGraphViz($('#graphViz'), v === 'modules' ? moduleGraph(g) : g);
      const f = $('#graphFind');
      f.oninput = () => viz.find(f.value.trim().toLowerCase());
      f.onkeydown = e => { if (e.key === 'Enter') viz.selectFirst(); };
    };
    document.querySelectorAll('.viewChip').forEach(c => c.onclick = () => show(c.dataset.v));
    let view = null;
    try { view = new URLSearchParams(location.search).get('codeview'); } catch {}
    show(view === 'symbols' || view === 'modules' ? view : (localStorage.getItem('hub.codeview') || 'modules'));
  });
};

// Collapse the symbol graph to one node per source file — the "satisfying
// visual": ~15 modules with weighted links instead of a 277-symbol hairball.
function moduleGraph(g) {
  const fileOf = {};
  const mods = new Map(); // file -> { id, label, count, community }
  for (const n of g.nodes) {
    const f = n.file || '(misc)';
    fileOf[n.id] = f;
    if (!mods.has(f)) mods.set(f, { id: f, label: f.split(/[\\/]/).pop(), file: f, community: mods.size, members: 0 });
    mods.get(f).members++;
  }
  const w = new Map(); // "a||b" -> weight
  for (const l of g.links) {
    const a = fileOf[l.source], b = fileOf[l.target];
    if (!a || !b || a === b) continue;
    const key = a < b ? a + '||' + b : b + '||' + a;
    w.set(key, (w.get(key) || 0) + 1);
  }
  // basename collisions (lib/files.js vs assets/files.js) → prefix parent dir
  const seen = {};
  for (const m of mods.values()) seen[m.label] = (seen[m.label] || 0) + 1;
  for (const m of mods.values()) {
    if (seen[m.label] > 1) {
      const parts = m.file.split(/[\\/]/);
      m.label = parts.slice(-2).join('/');
    }
  }
  return {
    nodes: [...mods.values()],
    links: [...w.entries()].map(([k, weight]) => {
      const [source, target] = k.split('||');
      return { source, target, weight };
    }),
  };
}

function drawGraphViz(container, data) {
  const W = container.clientWidth || 800, DPR = window.devicePixelRatio || 1;
  const dense = data.nodes.length >= 40; // all-symbols view: cluster + de-emphasize edges
  const H = Math.max(520, Math.min(820, Math.round(data.nodes.length * 2.4))); // more nodes → taller canvas
  const rootCss = getComputedStyle(document.documentElement);
  const BG = (rootCss.getPropertyValue('--bg') || '#0e0d0b').trim();
  const LINE = (rootCss.getPropertyValue('--line') || '#2a251d').trim();
  const MUTED = (rootCss.getPropertyValue('--muted') || '#a89e8a').trim();
  const ACCENT = (rootCss.getPropertyValue('--accent') || '#e8a33d').trim();
  const TXT = (rootCss.getPropertyValue('--txt') || '#ece7dc').trim();
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
  // curated warm palette (hub aesthetic) instead of rainbow HSL
  const PALETTE = ['#e8a33d', '#4bc47a', '#5aa9e6', '#e0655f', '#a78bda', '#4fc1c1',
    '#d9c06a', '#e07b3c', '#9db56f', '#c78ba5', '#7f9ccb', '#b0a08c'];
  const hue = c => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length];
  const nodes = data.nodes.map((n, i) => ({
    id: n.id, label: n.label || n.id, community: +n.community || 0, file: n.file || '',
    members: n.members || 0,
    x: W / 2 + 14 * Math.sqrt(i + 1) * Math.cos(i * 2.399963),
    y: H / 2 + 14 * Math.sqrt(i + 1) * Math.sin(i * 2.399963),
    vx: 0, vy: 0, deg: 0,
  }));
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const links = data.links
    .map(l => ({ s: byId[l.source], t: byId[l.target], relation: l.relation || '', weight: l.weight || 0 }))
    .filter(l => l.s && l.t && l.s !== l.t);
  const nbr = {}; nodes.forEach(n => nbr[n.id] = new Set());
  for (const l of links) { l.s.deg++; l.t.deg++; nbr[l.s.id].add(l.t.id); nbr[l.t.id].add(l.s.id); }
  const rad = n => n.members ? 9 + Math.min(26, Math.sqrt(n.members) * 2.6) : 5 + Math.sqrt(n.deg);
  // big graphs: permanent labels only for the most-connected nodes; everything
  // else labels on hover/select/search so the map stays readable
  const labeled = new Set(
    nodes.length <= 90 ? nodes.map(n => n.id)
      : [...nodes].sort((a, b) => b.deg - a.deg).slice(0, 48).map(n => n.id));

  // physics lives in runForceLayout(): it owns the constants, the integration
  // step, and drag pinning; here we just drive it and read node x/y to paint.
  const layout = runForceLayout(nodes, links, W, H);
  layout.warmup(dense ? 160 : 60); // settle before first paint (clusters need longer)

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
      // dense view: faint edges tinted by the source community, so cross-cluster
      // wiring reads as colored threads instead of a grey hairball
      if (lit) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6; ctx.globalAlpha = .95; }
      else if (dense) { ctx.strokeStyle = hue(l.s.community); ctx.lineWidth = .6; ctx.globalAlpha = matches.size ? .06 : .16; }
      else { ctx.strokeStyle = LINE; ctx.lineWidth = .7 + Math.min(2.6, l.weight / 5); ctx.globalAlpha = matches.size ? .25 : 1; }
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    }
    for (const n of nodes) {
      ctx.globalAlpha = emphasis(n);
      ctx.beginPath(); ctx.arc(n.x, n.y, rad(n) + (n === hover || n === selected ? 2 : 0), 0, 6.2832);
      ctx.fillStyle = hue(n.community); ctx.fill();
      if (dense) { ctx.strokeStyle = BG; ctx.lineWidth = 1.2; ctx.stroke(); } // rim keeps packed dots distinct
      if (n === hover) { ctx.strokeStyle = TXT; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (n === selected) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.2; ctx.stroke(); }
      if (matches.has(n.id)) { ctx.strokeStyle = '#e0a63f'; ctx.lineWidth = 1.8; ctx.stroke(); }
    }
    ctx.font = (nodes.length < 40 ? '600 11.5px' : '10px') + ' "JetBrains Mono",Consolas,monospace';
    ctx.textAlign = 'center';
    for (const n of nodes) {
      const lit = n === hover || n === selected || matches.has(n.id);
      if (!lit && !labeled.has(n.id)) continue;
      ctx.globalAlpha = lit ? 1 : emphasis(n);
      ctx.fillStyle = lit ? TXT : MUTED;
      ctx.fillText(n.label.slice(0, 24), n.x, n.y - rad(n) - 6);
    }
    ctx.globalAlpha = 1;
  }
  // On-demand render loop. The force sim used to redraw a 277-node canvas at
  // 60fps FOREVER — even after it settled and even while the Graph tab was
  // hidden — pegging a CPU core and making the whole UI feel frozen. Now the
  // loop only runs while the sim is warm (alpha>0.02) or an interaction kicks
  // it; it stops when settled and never draws a hidden canvas.
  let rafId = null;
  function frame() {
    rafId = null;
    if (!canvas.isConnected) return; // section re-rendered — drop this instance
    if (alpha > 0.02) { layout.step(); alpha *= 0.985; }
    const hidden = document.getElementById('graph') && document.getElementById('graph').classList.contains('hidden');
    if (!hidden) draw();
    if (alpha > 0.02 && !hidden) rafId = requestAnimationFrame(frame);
  }
  function kick() { if (rafId == null && canvas.isConnected) rafId = requestAnimationFrame(frame); }
  kick();

  // node inspection (detail panel + recursive neighbor hops) lives in
  // NodeInspector(); it owns the DOM and drives `selected` (render highlight).
  const inspector = NodeInspector(
    document.querySelector('#nodeDetail'), byId, nbr,
    n => { selected = n; }, kick);

  // mouse: hover tooltip + highlight, drag to pin, click → explain
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
  const pick = p => { let best = null, bd = 1e9; for (const n of nodes) { const dx = n.x - p.x, dy = n.y - p.y, d = dx * dx + dy * dy, r = rad(n) + 6; if (d < r * r && d < bd) { best = n; bd = d; } } return best; };
  let downAt = null;
  canvas.onmousedown = e => { layout.drag = pick(pos(e)); downAt = { x: e.clientX, y: e.clientY }; if (layout.drag) { alpha = 1; kick(); } };
  canvas.onmousemove = e => {
    if (layout.drag) {
      const p = pos(e);
      layout.dragTo(layout.drag, p.x, p.y);
      alpha = 1; tip.classList.add('hidden'); kick();
      return;
    }
    const n = pick(pos(e));
    const changed = n !== hover;
    hover = n;
    canvas.style.cursor = n ? 'pointer' : 'default';
    if (n) {
      tip.innerHTML = `<b>${esc(n.label)}</b><br><span class="mono">${esc(n.file)}</span> · community ${n.community} · ${n.deg} link${n.deg === 1 ? '' : 's'}`;
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
    if (changed) kick(); // redraw the highlight without spinning the sim
  };
  canvas.onmouseleave = () => { hover = null; tip.classList.add('hidden'); kick(); };
  window.addEventListener('mouseup', e => {
    if (layout.drag && downAt && Math.abs(e.clientX - downAt.x) < 4 && Math.abs(e.clientY - downAt.y) < 4) {
      inspector.select(layout.drag);
    }
    layout.drag = null; downAt = null;
  });

  return {
    find(q) {
      matches.clear();
      if (q) for (const n of nodes) if ((n.label + ' ' + (n.file || '')).toLowerCase().includes(q)) matches.add(n.id);
      kick(); // redraw the search highlight
    },
    selectFirst() {
      const first = nodes.filter(n => matches.has(n.id)).sort((a, b) => b.deg - a.deg)[0];
      if (first) inspector.select(first);
    },
  };
}

// Force-directed layout — pairwise repulsion + link springs + mild centering,
// clamped & damped. Owns the physics constants, the integration step, and drag
// pinning; the caller warms it up, runs the raf loop, and reads node x/y.
function runForceLayout(nodes, links, W, H) {
  const few = nodes.length < 40; // module view: roomier springs, stronger repulsion
  const REP = few ? 9000 : 2600, SPRING = few ? 0.02 : 0.012, REST = few ? 170 : 70,
    CENTER = 0.012, DAMP = 0.85, PAD = few ? 46 : 22, VMAX = 14;
  let dragNode = null;
  // Dense (all-symbols) view: give every community its own gravity well on a
  // grid across the canvas — the hairball resolves into distinct color-matched
  // clusters, with springs relegated to gentle intra/cross-cluster pull.
  let anchor = null;
  if (!few) {
    const comms = [...new Set(nodes.map(n => n.community))].sort((a, b) => a - b);
    const cols = Math.max(2, Math.ceil(Math.sqrt(comms.length * W / H)));
    const rows = Math.ceil(comms.length / cols);
    anchor = {};
    comms.forEach((c, i) => {
      anchor[c] = {
        x: ((i % cols) + 0.5) * (W / cols),
        y: (Math.floor(i / cols) + 0.5) * (H / rows),
      };
    });
    const k = {}; // reseed each node on a tight spiral around its well
    for (const n of nodes) {
      const i = (k[n.community] = (k[n.community] || 0) + 1), wl = anchor[n.community];
      n.x = wl.x + 9 * Math.sqrt(i) * Math.cos(i * 2.399963);
      n.y = wl.y + 9 * Math.sqrt(i) * Math.sin(i * 2.399963);
    }
  }
  function step() {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = dx * dx + dy * dy + .01; }
      // clustered view: soften repulsion inside a community so clusters condense
      const rep = anchor ? REP * (a.community === b.community ? 0.4 : 0.8) : REP;
      const d = Math.sqrt(d2), f = rep / d2, fx = f * dx / d, fy = f * dy / d;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING * (d - REST), fx = f * dx / d, fy = f * dy / d;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    for (const n of nodes) {
      if (n === dragNode) { n.vx = 0; n.vy = 0; continue; }
      const gx = anchor ? anchor[n.community].x : W / 2, gy = anchor ? anchor[n.community].y : H / 2;
      const g = anchor ? 0.07 : CENTER;
      n.vx = (n.vx + (gx - n.x) * g) * DAMP; n.vy = (n.vy + (gy - n.y) * g) * DAMP;
      n.x += Math.max(-VMAX, Math.min(VMAX, n.vx));
      n.y += Math.max(-VMAX, Math.min(VMAX, n.vy));
      n.x = Math.max(PAD, Math.min(W - PAD, n.x)); n.y = Math.max(PAD, Math.min(H - PAD, n.y));
    }
  }
  return {
    step,
    warmup(iters) { for (let k = 0; k < iters; k++) step(); },
    get drag() { return dragNode; },
    set drag(n) { dragNode = n; },
    dragTo(n, x, y) {
      n.x = Math.max(PAD, Math.min(W - PAD, x));
      n.y = Math.max(PAD, Math.min(H - PAD, y));
    },
  };
}

// Node inspection panel: renders "what IS this node · what touches it · one-click
// explain", and drives selection (recursive neighbor hops + graphify explain).
// setSelected() updates the render highlight; kick() schedules a redraw.
function NodeInspector(detail, byId, nbr, setSelected, kick) {
  function select(n) {
    setSelected(n);
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
    detail.querySelector('#ndClear').onclick = () => select(null);
    detail.querySelectorAll('.ndnb').forEach(c => c.onclick = () => { const m = byId[c.dataset.id]; if (m) select(m); });
    kick(); // redraw the selection highlight
  }
  return { select };
}
