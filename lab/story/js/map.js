// The sticky picture: layers as lanes, each flow laid out on a grid inside them, papers drawn inside
// their boxes (so the camera can dive into them), and a camera that glides between scenes.
(function () {
  const S = window.S;
  const M = {
    padX: 16, padY: 13, nsSize: 12.5, nsLH: 17, titleSize: 16, titleLH: 22, subSize: 13, subLH: 18,
    slotH: 23, slotGap: 9, slotSize: 13, minW: 132, colGap: 76, rowPad: 44, emptyRow: 96,
    flowGap: 520, stackW: 900,
  };
  S.M = M;

  // ---------- Measuring and laying out one diagram ----------
  function measure(b) {
    const titleMono = !S.isJa(b.title);
    let w = S.textW(b.title, M.titleSize, { weight: 700, mono: titleMono });
    if (b.ns) w = Math.max(w, S.textW(b.ns, M.nsSize, { mono: true }));
    const subMono = !!(b.sub && S.codeLike(b.sub) && /[_(]/.test(b.sub));
    if (b.sub) w = Math.max(w, S.textW(b.sub, M.subSize, { mono: subMono }));
    let inner = 0;
    if (b.slots) inner = b.slots.reduce((a, s) => a + S.textW(s, M.slotSize, { mono: !S.isJa(s) }) + 14, 0) + (b.slots.length - 1) * 4;
    if (b.bits) inner = Math.max(200, b.bits.reduce((a, [name, n]) => a + S.textW(`${name} ${n}`, M.slotSize) + 16, 0));
    w = Math.max(M.minW, w + 2 * M.padX, inner + 2 * M.padX);
    const h = M.padY * 2 + M.titleLH + (b.ns ? M.nsLH : 0) + (b.sub ? M.subLH : 0) + (b.slots || b.bits ? M.slotGap + M.slotH : 0);
    return { w: Math.ceil(w), h: Math.ceil(h), titleMono, subMono };
  }

  // Columns: follow the steps in order. A step that changes layer stays in the same column when the
  // way is clear; a step inside one layer moves one column to the right. Boxes met first as a source
  // (a chain that joins later) are placed backwards from the box they join.
  function columns(d) {
    const rowIdx = (id) => d.rows.indexOf(d.box[id].layer);
    const col = {}, occ = new Map();
    const key = (r, c) => r + ':' + c;
    const maxCol = () => Math.max(-1, ...Object.values(col));
    const place = (id, c) => { col[id] = c; occ.set(key(rowIdx(id), c), id); };
    const clear = (r1, r2, c) => { for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (occ.has(key(r, c))) return false; return true; };
    const markPass = (a, b) => {
      if (col[a] !== col[b]) return;
      const r1 = rowIdx(a), r2 = rowIdx(b);
      for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (!occ.has(key(r, col[a]))) occ.set(key(r, col[a]), 'pass');
    };
    const near = (from, to, dir) => {
      const rf = rowIdx(from), rt = rowIdx(to), c0 = col[from], cands = [];
      if (rf !== rt) cands.push(c0);
      for (let k = 1; k < 40; k++) { cands.push(c0 + dir * k); if (dir < 0) cands.push(c0 + k); }
      for (const c of cands) {
        if (c < 0 || occ.has(key(rt, c))) continue;
        if (c === c0 && !clear(rf, rt, c)) continue;
        return c;
      }
      return maxCol() + 1;
    };
    const steps = [...d.main, ...d.alts].map((x) => x.st);
    const pending = [];
    const settle = () => {
      let moved = true;
      while (moved) {
        moved = false;
        for (let k = pending.length - 1; k >= 0; k--) {
          const p = pending[k], ia = p.from in col, ib = p.to in col;
          if (ia && !ib) place(p.to, near(p.from, p.to, +1));
          else if (!ia && ib) place(p.from, near(p.to, p.from, -1));
          else if (!ia && !ib) continue;
          markPass(p.from, p.to); pending.splice(k, 1); moved = true;
        }
      }
    };
    for (const st of steps) {
      if (!Object.keys(col).length) place(st.from, 0);
      const ia = st.from in col, ib = st.to in col;
      if (ia && !ib) place(st.to, near(st.from, st.to, +1));
      else if (!ia && ib) place(st.from, near(st.to, st.from, -1));
      else if (!ia && !ib) { pending.push(st); continue; }
      markPass(st.from, st.to);
      settle();
    }
    for (const p of pending) for (const id of [p.from, p.to]) if (!(id in col)) place(id, maxCol() + 1);
    for (const b of d.g.boxes) if (!(b.id in col)) place(b.id, maxCol() + 1);
    // Close gaps: drop columns nobody uses.
    const used = [...new Set(Object.values(col))].sort((a, b) => a - b);
    for (const id in col) col[id] = used.indexOf(col[id]);
    return col;
  }

  function layout(d, rowHeights) {
    const size = {};
    for (const b of d.g.boxes) size[b.id] = measure(b);
    const col = columns(d);
    const nCol = Math.max(...Object.values(col)) + 1;
    const colW = Array(nCol).fill(M.minW);
    for (const b of d.g.boxes) colW[col[b.id]] = Math.max(colW[col[b.id]], size[b.id].w);
    const colX = []; let x = 0;
    for (let c = 0; c < nCol; c++) { colX[c] = x; x += colW[c] + M.colGap; }
    const width = x - M.colGap;
    const rowNeed = {};
    for (const r of d.rows) rowNeed[r] = 0;
    for (const b of d.g.boxes) rowNeed[b.layer] = Math.max(rowNeed[b.layer], size[b.id].h);
    const rows = {}; let y = 0;
    for (const r of d.rows) {
      const h = rowHeights ? rowHeights[r] : (rowNeed[r] ? rowNeed[r] + 2 * M.rowPad : M.emptyRow);
      rows[r] = { y, h, need: rowNeed[r] };
      y += h;
    }
    const boxes = {};
    for (const b of d.g.boxes) {
      const s = size[b.id], r = rows[b.layer], h = Math.max(s.h, r.need);
      boxes[b.id] = { ...s, h, x: colX[col[b.id]] + (colW[col[b.id]] - s.w) / 2, y: r.y + (r.h - h) / 2, col: col[b.id] };
    }
    return { boxes, rows, width, height: y, colX, colW, rowNeed };
  }

  // ---------- Edges ----------
  // Every edge leaves and enters a box side; edges sharing a side are spread along it.
  function routeEdges(d, L) {
    const out = {};
    const all = d.g.steps.map((st, i) => ({ st, i }));
    const sides = {};
    const attach = (box, side, e, other) => { const k = box + ':' + side; (sides[k] = sides[k] || []).push({ e, other }); };
    for (const { st, i } of all) {
      const a = L.boxes[st.from], b = L.boxes[st.to];
      const acy = a.y + a.h / 2, bcy = b.y + b.h / 2;
      let sa, sb;
      if (Math.abs(acy - bcy) < 1) { if (b.x > a.x) { sa = 'r'; sb = 'l'; } else { sa = 'l'; sb = 'r'; } }
      else if (bcy > acy) { sa = 'b'; sb = 't'; } else { sa = 't'; sb = 'b'; }
      out[i] = { i, st, a: st.from, b: st.to, sa, sb };
      attach(st.from, sa, out[i], b);
      attach(st.to, sb, out[i], a);
    }
    const SP = 15;
    for (const [k, list] of Object.entries(sides)) {
      const [boxId, side] = k.split(':');
      const horiz = side === 't' || side === 'b';
      list.sort((p, q) => {
        const pv = horiz ? p.other.x + p.other.w / 2 : p.other.y + p.other.h / 2;
        const qv = horiz ? q.other.x + q.other.w / 2 : q.other.y + q.other.h / 2;
        return pv - qv || p.e.i - q.e.i;
      });
      const box = L.boxes[boxId];
      list.forEach((p, n) => {
        const off = (n - (list.length - 1) / 2) * SP;
        let pt;
        if (side === 't') pt = [box.x + box.w / 2 + off, box.y];
        if (side === 'b') pt = [box.x + box.w / 2 + off, box.y + box.h];
        if (side === 'l') pt = [box.x, box.y + box.h / 2 + off];
        if (side === 'r') pt = [box.x + box.w, box.y + box.h / 2 + off];
        if (p.e.a === boxId && !p.e.p0) p.e.p0 = pt; else p.e.p1 = pt;
      });
    }
    const xb0 = (x, dir) => x - dir[0] * 10, yb0 = (y, dir) => y - dir[1] * 10;
    for (const e of Object.values(out)) {
      const [x0, y0] = e.p0, [x1, y1] = e.p1;
      const head = 10;
      let d1, mid, dir;
      if (e.sa === 'r' || e.sa === 'l') {
        const sx = Math.sign(x1 - x0);
        // Skip over boxes in between with an arc.
        const between = Object.values(L.boxes).some((bx) => bx !== L.boxes[e.a] && bx !== L.boxes[e.b] && Math.abs(bx.y + bx.h / 2 - y0) < bx.h / 2 && bx.x > Math.min(x0, x1) && bx.x + bx.w < Math.max(x0, x1));
        if (between) {
          const lift = 46, xa = x0 + sx * 6, xb = x1 - sx * head;
          d1 = `M${x0},${y0} C${x0 + sx * 40},${y0 - lift * 2} ${x1 - sx * 40},${y1 - lift * 2} ${xb},${y1}`;
          mid = [(x0 + x1) / 2, y0 - lift * 1.5]; dir = [sx, 0.9];
        } else {
          const xb = x1 - sx * head;
          d1 = `M${x0},${y0} L${xb},${y1}`;
          mid = [(x0 + xb) / 2, (y0 + y1) / 2]; dir = [sx, 0];
        }
      } else {
        const sy = Math.sign(y1 - y0), yb = y1 - sy * head;
        if (Math.abs(x1 - x0) < 1) { d1 = `M${x0},${y0} L${x1},${yb}`; }
        else { const m = (y0 + yb) / 2; d1 = `M${x0},${y0} C${x0},${m} ${x1},${m} ${x1},${yb}`; }
        mid = [(x0 + x1) / 2, (y0 + yb) / 2]; dir = [0, sy];
      }
      e.d = d1; e.mid = mid; e.end = [x1, y1]; e.dir = dir;
      e.p0c = [x0, y0]; e.p1c = [xb0(x1, dir), yb0(y1, dir)];
      const tip = [x1, y1], back = [x1 - dir[0] * head, y1 - dir[1] * head];
      const nx = -dir[1] * 5.2, ny = dir[0] * 5.2;
      if (dir[1] && dir[0]) { /* arc ending: arrow points along the final curve, approximately horizontal */ }
      e.head = `M${tip[0]},${tip[1]} L${back[0] + nx},${back[1] + ny} L${back[0] - nx},${back[1] - ny} Z`;
    }
    // Edges between the same two boxes run side by side: each number sits beside its own edge, pushed
    // away from the other one, at the same height (numbers stacked along one line read as one edge).
    const pairs = {};
    for (const e of Object.values(out)) { const k = [e.a, e.b].sort().join('|'); (pairs[k] = pairs[k] || []).push(e); }
    for (const list of Object.values(pairs)) {
      if (list.length < 2) continue;
      const vert = list[0].sa === 't' || list[0].sa === 'b';
      const c = list.reduce((a, e) => a + (vert ? e.mid[0] : e.mid[1]), 0) / list.length;
      for (const e of list) {
        const v = vert ? e.mid[0] : e.mid[1], side = Math.sign(v - c) || 1;
        if (vert) e.mid = [e.mid[0] + side * 9, e.mid[1]]; else e.mid = [e.mid[0], e.mid[1] + side * 9];
      }
    }
    return out;
  }

  // ---------- World: the stack figure on the left, then each flow, all sharing the lanes ----------
  const W = { lanes: {}, flows: {}, stack: null, width: 0, height: 0 };
  S.W = W;

  function buildWorld() {
    const flows = S.FLOWS.map((f) => S.D[f.id]);
    // Shared lane heights: the most any flow needs in that layer.
    const need = {};
    for (const l of S.STACK) need[l] = 0;
    for (const d of flows) { const L = layout(d); for (const l of S.STACK) need[l] = Math.max(need[l], L.rowNeed[l]); }
    const heights = {};
    for (const l of S.STACK) heights[l] = Math.max(need[l] ? need[l] + 2 * M.rowPad : M.emptyRow, 150);
    let y = 0;
    for (const l of S.STACK) { W.lanes[l] = { y, h: heights[l] }; y += heights[l]; }
    W.height = y;
    let x = M.stackW + M.flowGap;
    for (const d of flows) {
      d.L = layout(d, heights);
      d.edges = routeEdges(d, d.L);
      d.ox = x; d.oy = 0; d.s = 1;
      W.flows[d.id] = d;
      x += d.L.width + M.flowGap;
    }
    W.width = x - M.flowGap;
    // Papers: laid out on their own, then fitted inside their host box.
    for (const d of Object.values(S.D)) if (d.isPaper) { d.L = layout(d); d.edges = routeEdges(d, d.L); }
    const place = (d) => {
      for (const [boxId, pid] of Object.entries(d.children)) {
        const p = S.D[pid], hb = d.L.boxes[boxId];
        const pw = p.L.width + 2 * PAPER_M, ph = p.L.height + 2 * PAPER_M;
        const s = Math.min((hb.w - 10) / pw, (hb.h - 10) / ph);
        p.local = { x: hb.x + (hb.w - pw * s) / 2 + PAPER_M * s, y: hb.y + (hb.h - ph * s) / 2 + PAPER_M * s, s };
        p.s = d.s * s; p.ox = d.ox + d.s * p.local.x; p.oy = d.oy + d.s * p.local.y;
        place(p);
      }
    };
    flows.forEach(place);
  }
  const PAPER_M = 36;

  // World rectangle of a box, a diagram, a region.
  S.boxRect = (d, id) => { const b = d.L.boxes[id]; return { x: d.ox + d.s * b.x, y: d.oy + d.s * b.y, w: d.s * b.w, h: d.s * b.h }; };
  S.diagRect = (d) => (d.isPaper
    ? { x: d.ox - PAPER_M * d.s, y: d.oy - PAPER_M * d.s, w: (d.L.width + 2 * PAPER_M) * d.s, h: (d.L.height + 2 * PAPER_M) * d.s }
    : { x: d.ox, y: d.oy, w: d.L.width, h: d.L.height });

  // ---------- Rendering ----------
  let svg, world, gLanes, gStack, overlay;
  const els = { boxes: {}, edges: {}, regions: {}, diags: {}, tokens: {}, names: [], tabs: [] };

  function laneTone(id) { return S.STACK.includes(id) ? id : 'none'; }

  function renderLanes() {
    gLanes = S.svg('g', { class: 'lanes' }, world);
    const x0 = -3000, x1 = W.width + 3000;
    for (const l of S.STACK) {
      const ln = W.lanes[l];
      S.svg('rect', { class: `lane T-${l}`, x: x0, y: ln.y, width: x1 - x0, height: ln.h }, gLanes);
      S.svg('line', { class: 'lane-rule', x1: x0, x2: x1, y1: ln.y, y2: ln.y }, gLanes);
    }
    S.svg('line', { class: 'lane-rule', x1: x0, x2: x1, y1: W.height, y2: W.height }, gLanes);
  }

  // The figure of the intro: five layers with their names and one dot per node, the three
  // cross-cutting layers as columns, and each flow's route through the layers.
  function renderStack() {
    gStack = S.svg('g', { class: 'stack' }, world);
    const counts = {};
    for (const [id, n] of Object.entries(S.N)) (counts[n.layer] = counts[n.layer] || []).push(id);
    W.stack = { dotsX: 350, crossX: 664, routeX: 360 };
    const kinds = ['func', 'store', 'schema', 'enum', 'hw', 'context', 'note', 'figure'];
    const byKind = (a, b) => kinds.indexOf(S.N[a].kind) - kinds.indexOf(S.N[b].kind);
    for (const l of S.STACK) {
      const ln = W.lanes[l], cy = ln.y + ln.h / 2;
      const g = S.svg('g', { class: `st-layer T-${l}`, 'data-layer': l }, gStack);
      S.svg('rect', { class: 'st-chip', x: 36, y: cy - 34, width: 9, height: 68, rx: 4.5 }, g);
      S.svg('text', { class: 'st-name', x: 68, y: cy - 2 }, g).textContent = S.L[l].name;
      S.svg('text', { class: 'st-sub', x: 68, y: cy + 30 }, g).textContent = S.L[l].sub;
      const ids = (counts[l] || []).sort(byKind);
      const gd = S.svg('g', { class: 'st-dots' }, g);
      const perRow = 11, r = 8, gap = 25;
      const nrows = Math.ceil(ids.length / perRow);
      ids.forEach((id, k) => {
        const row = Math.floor(k / perRow), c = k % perRow;
        const dy = cy - ((nrows - 1) * gap) / 2 + row * gap;
        S.svg('circle', { class: `st-dot K-${S.N[id].kind}`, cx: W.stack.dotsX + c * gap, cy: dy, r, 'data-node': id }, gd);
      });
      S.svg('text', { class: 'st-count', x: W.stack.dotsX + Math.min(ids.length, perRow) * gap + 6, y: cy + 6 }, gd).textContent = `${ids.length}`;
    }
    // Cross-cutting layers: columns over the whole stack.
    const gc = S.svg('g', { class: 'st-cross' }, gStack);
    S.CROSS.forEach((l, k) => {
      const x = W.stack.crossX + k * 82;
      const ids = Object.keys(S.N).filter((id) => S.N[id].layer === l);
      const g = S.svg('g', { class: `st-col C-${l}`, 'data-layer': l }, gc);
      S.svg('rect', { class: 'st-colbar', x, y: -10, width: 60, height: W.height + 20, rx: 14 }, g);
      ids.forEach((id, j) => S.svg('circle', { class: `st-dot K-${S.N[id].kind}`, cx: x + 30, cy: 34 + j * 26, r: 8, 'data-node': id }, g));
      S.svg('text', { class: 'st-colname', x: x + 30, y: -26, 'text-anchor': 'middle' }, g).textContent = S.L[l].name;
      S.svg('text', { class: 'st-colcount', x: x + 30, y: 34 + ids.length * 26 + 8, 'text-anchor': 'middle' }, g).textContent = ids.length;
    });
    // Routes: each step of a flow as a segment from the layer it leaves to the layer it reaches,
    // like a line on a transit map; where the next step starts elsewhere, a thin dashed jump.
    const gr = S.svg('g', { class: 'rt-all' }, gStack);
    S.FLOWS.forEach((f, k) => {
      const d = S.D[f.id];
      const g = S.svg('g', { class: `rt R-${k}`, 'data-flow': f.id }, gr);
      const x0 = W.stack.routeX + 10 + k * 280, dx = Math.min(23, 250 / d.main.length);
      const cy = (id) => { const ln = W.lanes[d.box[id].layer]; return ln.y + ln.h / 2 + (k ? 16 : -16); };
      let path = '', jumps = '', prev = null;
      const dots = [];
      d.main.forEach(({ st }, n) => {
        const xa = x0 + n * dx, xb = x0 + (n + 1) * dx, ya = cy(st.from), yb = cy(st.to);
        if (prev && (prev.box !== st.from)) jumps += `M${xa},${prev.y} L${xa},${ya} `;
        if (!prev || prev.box !== st.from) path += `M${xa},${ya} `;
        path += `C${xa + dx * 0.62},${ya} ${xb - dx * 0.62},${yb} ${xb},${yb} `;
        dots.push([xa, ya]);
        prev = { box: st.to, y: yb };
      });
      if (jumps) S.svg('path', { class: 'rt-jump', d: jumps }, g);
      S.svg('path', { class: 'rt-line', d: path, pathLength: 1, id: `rt-path-${k}` }, g);
      if (!S.reduceMotion) {
        const tk = S.svg('circle', { class: 'rt-token', r: 7, visibility: 'hidden' }, g);
        S.svg('set', { attributeName: 'visibility', to: 'visible', begin: `${2.4 + k * 0.8}s` }, tk);
        const am = S.svg('animateMotion', { dur: `${6 + k * 1.3}s`, begin: `${2.4 + k * 0.8}s`, repeatCount: 'indefinite', calcMode: 'linear' }, tk);
        S.svg('mpath', { href: `#rt-path-${k}` }, am);
      }
      dots.forEach(([x, y], n) => S.svg('circle', { class: 'rt-dot' + (n === 0 ? ' start' : ''), cx: x, cy: y, r: n === 0 ? 7 : 4.5 }, g));
      const end = [x0 + d.main.length * dx, prev.y];
      S.svg('path', { class: 'rt-end', d: `M${end[0] - 2},${end[1] - 8} L${end[0] + 9},${end[1]} L${end[0] - 2},${end[1] + 8} Z` }, g);
      S.svg('text', { class: 'rt-name', x: x0 - 6, y: -24 }, g).textContent = `${k + 1} 章 ${f.tab}`;
    });
  }

  const BADGE = 'M0,0 h9 l4,4 v11 h-13 z';

  function renderBox(d, parentG, b) {
    const R = d.L.boxes[b.id], n = S.N[b.node] || {};
    const tone = d.isPaper ? (S.toneOf((d.rowInfo[b.layer] || {}).tone) || 'none') : laneTone(b.layer);
    const g = S.svg('g', { class: `box T-${tone} K-${n.kind || 'func'}`, transform: `translate(${R.x},${R.y})`, 'data-diag': d.id, 'data-box': b.id, 'data-node': b.node, tabindex: '-1' }, parentG);
    els.boxes[d.id + '/' + b.id] = g;
    const face = S.svg('g', { class: 'b-face' }, g);
    S.svg('rect', { class: 'b-frame', width: R.w, height: R.h, rx: 10 }, face);
    S.svg('rect', { class: 'b-stripe', x: 0, y: 8, width: 4, height: R.h - 16, rx: 2 }, face);
    const labels = S.svg('g', { class: 'b-labels' }, face);
    const det = S.svg('g', { class: 'b-detail' }, labels);
    let y = M.padY;
    if (b.ns) { S.svg('text', { class: 'b-ns', x: M.padX, y: y + 12.5 }, det).textContent = b.ns; y += M.nsLH; }
    S.svg('text', { class: 'b-title' + (R.titleMono ? ' mono' : ''), x: M.padX, y: y + 16 }, det).textContent = b.title; y += M.titleLH;
    if (b.sub) { S.svg('text', { class: 'b-sub' + (R.subMono ? ' mono' : ''), x: M.padX, y: y + 13 }, det).textContent = b.sub; y += M.subLH; }
    if (b.slots) {
      let x = M.padX; y += M.slotGap - 4;
      for (const s of b.slots) {
        const w = S.textW(s, M.slotSize, { mono: !S.isJa(s) }) + 14;
        S.svg('rect', { class: 'b-slot', x, y, width: w, height: M.slotH, rx: 5 }, det);
        S.svg('text', { class: 'b-slot-t' + (S.isJa(s) ? '' : ' mono'), x: x + w / 2, y: y + 16, 'text-anchor': 'middle' }, det).textContent = s;
        x += w + 4;
      }
    }
    if (b.bits) {
      const total = b.bits.reduce((a, [, n]) => a + n, 0), bw = R.w - 2 * M.padX;
      let x = M.padX; y += M.slotGap - 4;
      for (const [name, nb] of b.bits) {
        const w = (bw * nb) / total;
        S.svg('rect', { class: 'b-slot bits', x, y, width: w - 2, height: M.slotH, rx: 5 }, det);
        S.svg('text', { class: 'b-slot-t', x: x + (w - 2) / 2, y: y + 16, 'text-anchor': 'middle' }, det).textContent = `${name} ${nb}`;
        x += w;
      }
    }
    // The short name, big, for when the camera is far away.
    // Far away, a box is just its name: the short name, or the title without its parameters.
    const short = b.short || b.title.replace(/\(.*\)$/, '');
    const mono = !S.isJa(short);
    const cmp = S.svg('g', { class: 'b-compact' }, labels);
    const cs = S.svg('g', { class: 'fit' }, cmp);
    const big = S.svg('text', { class: 'b-big' + (mono ? ' mono' : ''), x: R.w / 2, y: R.h / 2 + 5.5, 'text-anchor': 'middle' }, cs);
    big.textContent = short;
    els.names.push({ d, g: cs, t: big, full: short, w: S.textW(short, 15, { weight: 700, mono }), mono, box: R, cx: R.w / 2, cy: R.h / 2, shown: short, s: 0 });
    if (n.paper) {
      const bo = S.svg('g', { class: 'b-badge', transform: `translate(${R.w - 18},${1})` }, labels);
      const bg = S.svg('g', { class: 'cs' }, bo);
      S.svg('rect', { x: -18, y: -11, width: 36, height: 22, rx: 11, class: 'b-badge-bg' }, bg);
      S.svg('path', { d: BADGE, transform: 'translate(-6.5,-7.5)', class: 'b-badge-i' }, bg);
      S.svg('title', {}, bg).textContent = '中の紙がある';
    }
    return g;
  }

  function renderDiagram(d, parentG, transform) {
    const g = S.svg('g', { class: 'diag' + (d.isPaper ? ' is-paper' : ''), 'data-diag': d.id, transform }, parentG);
    els.diags[d.id] = g;
    const L = d.L;
    if (d.isPaper) {
      const sheet = S.svg('g', { class: 'd-sheet' }, g);
      S.svg('rect', { class: 'sheet', x: -PAPER_M, y: -PAPER_M, width: L.width + 2 * PAPER_M, height: L.height + 2 * PAPER_M, rx: 14 }, sheet);
      for (const r of d.rows) {
        const row = L.rows[r], tone = S.toneOf((d.rowInfo[r] || {}).tone) || 'none';
        S.svg('rect', { class: `band T-${tone}`, x: -PAPER_M + 6, y: row.y + 3, width: L.width + 2 * PAPER_M - 12, height: row.h - 6, rx: 9 }, sheet);
      }
    }
    // Context frames (dashed): who runs these boxes.
    const gr = S.svg('g', { class: 'd-regions' }, g);
    for (const r of d.g.regions || []) {
      const rs = r.boxes.map((id) => L.boxes[id]).filter(Boolean);
      if (!rs.length) continue;
      const u = S.grow(S.unionRect(rs), 18, 22);
      const rg = S.svg('g', { class: 'region', 'data-region': r.node }, gr);
      els.regions[d.id + '/' + r.node] = rg;
      S.svg('rect', { class: 'r-frame', x: u.x, y: u.y, width: u.w, height: u.h, rx: 16 }, rg);
      const label = r.label3 && S.textW(r.label, 12.5) > u.w - 30 ? r.label3 : r.label;
      const lw = S.textW(label, 12.5) + 18;
      let lx = u.x + 14, ly = u.y - 11;
      if (r.at === 'br') { lx = u.x + u.w - lw - 14; ly = u.y + u.h - 11; }
      if (r.at === 'bl') { ly = u.y + u.h - 11; }
      if (r.at === 'r') { lx = u.x + u.w - lw - 14; }
      const slide = S.svg('g', { class: 'r-slide' }, rg);
      const tab = S.svg('g', { class: 'cs', style: `transform-origin:${r.at === 'br' || r.at === 'r' ? '100%' : '0%'} 50%` }, slide);
      const rect = S.svg('rect', { class: 'r-tab', x: lx, y: ly, width: lw, height: 22, rx: 11 }, tab);
      const text = S.svg('text', { class: 'r-label', x: lx + 9, y: ly + 15.5 }, tab);
      text.textContent = label;
      const full = { label, w: lw }, short = r.label3 && r.label3 !== label ? { label: r.label3, w: S.textW(r.label3, 12.5) + 18 } : null;
      els.tabs.push({ d, g: slide, rect, text, x: lx, w: lw, y: ly, frame: u, right: r.at === 'br' || r.at === 'r', edge: lx + lw, dx: 0, full, short, cur: full });
    }
    const ge = S.svg('g', { class: 'd-edges' }, g);
    // The current step's label is drawn above the boxes (a faded box must not cover it).
    const gl = S.svg('g', { class: 'd-labels' });
    for (const e of Object.values(d.edges)) {
      const st = e.st;
      const eg = S.svg('g', { class: `edge E-${st.kind}${st.alt ? ' is-alt' : ''}`, 'data-diag': d.id, 'data-step': e.i }, ge);
      els.edges[d.id + '/' + e.i] = eg;
      S.svg('path', { class: 'e-line', d: e.d, id: `edge-${d.id.replace(/\./g, '-')}-${e.i}` }, eg);
      S.svg('path', { class: 'e-head', d: e.head }, eg);
      if (st.kind === 'data') S.svg('path', { class: 'e-tail', d: `M${e.p0[0]},${e.p0[1]} m-6,0 l6,-5 l6,5 l-6,5 z`, transform: '' }, eg);
      // Number at the middle.
      const no = S.stepNo(d, e.i);
      const nbo = S.svg('g', { class: 'e-no', transform: `translate(${e.mid[0]},${e.mid[1]})` }, eg);
      const nb = S.svg('g', { class: 'cs' }, nbo);
      const nw = Math.max(22, S.textW(no, 12, { weight: 700 }) + 12);
      S.svg('rect', { x: -nw / 2, y: -11, width: nw, height: 22, rx: 11 }, nb);
      S.svg('text', { y: 4.5, 'text-anchor': 'middle' }, nb).textContent = no;
      // The current step's label: number, verb, and what is handed over.
      const verb = S.heading(d, st);
      const labo = S.svg('g', { class: 'e-label' + (st.alt ? ' is-alt' : ''), 'data-state': 'idle' }, gl);
      eg._label = labo;
      const lab = S.svg('g', { class: 'cs' }, labo);
      const dl = st.data && st.data.label;
      const nw2 = Math.max(20, S.textW(no, 12, { weight: 700 }) + 10);
      const tw = nw2 + 6, vw = S.textW(verb, 13.5, { weight: 700 }), dw = dl ? S.textW(dl, 12.5, { weight: 700, mono: !S.isJa(dl) }) + 30 : 0;
      const lw = tw + vw + 18 + (dl ? dw + 6 : 0);
      const vertical = e.sa === 't' || e.sa === 'b';
      const A = L.boxes[st.from], B = L.boxes[st.to];
      let lx, ly;
      if (vertical) { lx = e.mid[0] + 16; ly = e.mid[1] - 13; }
      else { lx = e.mid[0] - lw / 2; ly = Math.min(A.y, B.y) - 36; }
      const pill = S.svg('rect', { class: 'el-bg', x: lx, y: ly, width: lw, height: 26, rx: 13 }, lab);
      S.svg('rect', { class: 'el-no', x: lx + 3, y: ly + 3, width: nw2, height: 20, rx: 10 }, lab);
      S.svg('text', { class: 'el-not', x: lx + 3 + nw2 / 2, y: ly + 17.3, 'text-anchor': 'middle' }, lab).textContent = no;
      S.svg('text', { class: 'el-verb', x: lx + tw + 8, y: ly + 17.5 }, lab).textContent = verb;
      if (dl) {
        const dx = lx + tw + vw + 18;
        S.svg('rect', { class: 'el-data', x: dx, y: ly + 3, width: dw, height: 20, rx: 6 }, lab);
        S.svg('rect', { class: 'el-env', x: dx + 7, y: ly + 8, width: 10, height: 10, rx: 2 }, lab);
        S.svg('text', { class: 'el-dt' + (S.isJa(dl) ? '' : ' mono'), x: dx + 22, y: ly + 17.3 }, lab).textContent = dl;
      }
      if (no.length > 2) pill.setAttribute('data-wide', '1');
      e.label = { x: lx, y: ly, w: lw, h: 26 };
    }
    const gb = S.svg('g', { class: 'd-boxes' }, g);
    for (const b of d.g.boxes) {
      const bg = renderBox(d, gb, b);
      const child = d.children[b.id];
      if (child) {
        bg.classList.add('host');
        const p = S.D[child];
        const inner = S.svg('g', { class: 'b-inner' }, bg);
        // Inside the box group, coordinates are relative to the box corner.
        const R = d.L.boxes[b.id];
        renderDiagram(p, inner, `translate(${p.local.x - R.x},${p.local.y - R.y}) scale(${p.local.s})`);
      }
    }
    g.appendChild(gl);
    const gt = S.svg('g', { class: 'd-tokens' }, g);
    els.tokens[d.id] = gt;
    return g;
  }

  // ---------- Camera ----------
  const cam = { x: 0, y: 0, k: 1 };
  let anim = null, view = { w: 800, h: 800, left: 0, top: 0, right: 0, bottom: 0 };
  S.cam = cam;

  function applyCam() {
    const tx = view.left + (view.w - view.left - view.right) / 2 - cam.x * cam.k;
    const ty = view.top + (view.h - view.top - view.bottom) / 2 - cam.y * cam.k;
    world.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${cam.k.toFixed(5)})`);
    lod();
    miniView();
    S.onCamera && S.onCamera(cam, view);
  }
  S.toScreen = (x, y) => {
    const tx = view.left + (view.w - view.left - view.right) / 2 - cam.x * cam.k;
    const ty = view.top + (view.h - view.top - view.bottom) / 2 - cam.y * cam.k;
    return [tx + x * cam.k, ty + y * cam.k];
  };

  // Fit a world rectangle into the free part of the panel.
  function fit(r, kMax = Infinity, kMin = 0) {
    const aw = view.w - view.left - view.right - 2 * 28, ah = view.h - view.top - view.bottom - 2 * 28;
    const k = S.clamp(Math.min(aw / r.w, ah / r.h), kMin, kMax);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, k };
  }

  // A step wants the near drawing (names, namespaces, notes). When the panel is too small for its two
  // boxes at that size, the camera uses tight margins and, if it is still a little short, crops the
  // right side (box text is left-aligned) rather than falling back to the far drawing.
  function fitNear(r, rTight, kNear, kMax) {
    const t = fit(r, kMax);
    if (t.k >= kNear) return t;
    const aw = view.w - view.left - view.right - 16, ah = view.h - view.top - view.bottom - 16;
    const kt = Math.min(aw / rTight.w, ah / rTight.h);
    if (kt >= kNear) return { x: rTight.x + rTight.w / 2, y: rTight.y + rTight.h / 2, k: kNear };
    if (kt < kNear * 0.84) return t;
    const vw = aw / kNear;
    return { x: rTight.w > vw ? rTight.x + vw / 2 : rTight.x + rTight.w / 2, y: rTight.y + rTight.h / 2, k: kNear };
  }

  // The minimap goes to the corner of the picture with the least under it (boxes of the diagram being
  // read, the step's own boxes counting most), for the camera the scene will rest at. Where every
  // corner would cover the step, the camera first tries to move the step away from the bottom right
  // corner; failing that the minimap steps aside (fades out).
  const MW = 184, MH = 104, MM = 12;
  function corners() {
    return [['br', view.w - MM - MW, view.h - MM - MH], ['tr', view.w - MM - MW, MM], ['bl', view.left + MM, view.h - MM - MH], ['tl', view.left + MM, MM]];
  }
  function avoidMini(t, r) {
    mini.clash = false;
    if (!mini.d || !mini.el || mini.el.hidden) return t;
    const cx = view.left + (view.w - view.left - view.right) / 2, cy = view.top + (view.h - view.top - view.bottom) / 2;
    const scr = (q) => ({ x0: cx + (q.x - t.x) * t.k, y0: cy + (q.y - t.y) * t.k, x1: cx + (q.x + q.w - t.x) * t.k, y1: cy + (q.y + q.h - t.y) * t.k });
    const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const focus = scr(r);
    const d = mini.d, boxes = d.g.boxes.map((b) => scr(S.boxRect(d, b.id)));
    let best = null;
    for (const [name, x, y] of corners()) {
      const m = { x0: x - 8, y0: y - 8, x1: x + MW + 8, y1: y + MH + 8 };
      const score = boxes.reduce((a, b) => a + inter(m, b), 0) + 20 * inter(m, focus);
      if (!best || score < best.score - 1) best = { name, x, y, score, hitsFocus: inter(m, focus) > 0 };
    }
    let out = t;
    if (best.hitsFocus) {
      // Every corner covers the step: lift it, or move it left, clear of the bottom right corner.
      const my = view.h - MM - MH - 10, mx = view.w - MM - MW - 10;
      const up = focus.y1 - my, left = focus.x1 - mx;
      if (focus.y0 - up >= view.top + 6) out = { ...t, y: t.y + up / t.k };
      else if (focus.x0 - left >= view.left + 6) out = { ...t, x: t.x + left / t.k };
      else mini.clash = true;
      best = { name: 'br', x: view.w - MM - MW, y: view.h - MM - MH };
    }
    mini.corner = best;
    mini.el.style.left = best.x + 'px'; mini.el.style.top = best.y + 'px';
    return out;
  }

  // A camera never rests between the far and the near drawing of the boxes (both would show).
  function settle(t, s) {
    const ke = t.k * s;
    if (ke > 0.8 && ke < 0.92) t.k = (ke >= 0.86 ? 0.92 : 0.8) / s;
    return t;
  }

  function flyTo(t, instant) {
    if (anim) cancelAnimationFrame(anim.raf);
    const vw = view.w - view.left - view.right;
    const p0 = [cam.x, cam.y, vw / cam.k], p1 = [t.x, t.y, vw / t.k];
    if (instant || S.reduceMotion || !isFinite(p0[2])) { cam.x = t.x; cam.y = t.y; cam.k = t.k; applyCam(); return; }
    const path = S.zoomPath(p0, p1);
    const dur = S.clamp(path.duration * 0.9, 650, 1500);
    const t0 = performance.now();
    anim = {};
    const tick = (now) => {
      const u = S.clamp((now - t0) / dur, 0, 1);
      const [x, y, w] = path(S.easeInOut(u));
      cam.x = x; cam.y = y; cam.k = vw / w;
      applyCam();
      if (u < 1) anim.raf = requestAnimationFrame(tick); else anim = null;
    };
    anim.raf = requestAnimationFrame(tick);
  }

  // Level of detail and papers: what shows depends on how big a diagram is on screen right now.
  function lod() {
    for (const d of Object.values(S.D)) {
      const g = els.diags[d.id];
      if (!g) continue;
      const k = cam.k * d.s;
      const detail = S.smooth(0.84, 0.92, k);
      g.style.setProperty('--detail', detail.toFixed(3));
      g.style.setProperty('--cs', S.clamp(0.96 / k, 1, 3.2).toFixed(3));
      g.style.setProperty('--cs2', S.clamp(0.8 / k, 1, 3.2).toFixed(3));
      g.style.setProperty('--compact', (1 - detail).toFixed(3));
      let dim = 0;
      for (const [boxId, pid] of Object.entries(d.children)) {
        const p = S.D[pid], kp = cam.k * p.s;
        const show = S.smooth(0.2, 0.32, kp);
        els.diags[pid].style.opacity = show.toFixed(3);
        els.diags[pid].style.display = show < 0.01 ? 'none' : '';
        const host = els.boxes[d.id + '/' + boxId];
        host.style.setProperty('--inner', show.toFixed(3));
        dim = Math.max(dim, S.smooth(0.24, 0.42, kp));
      }
      g.style.setProperty('--dim', dim.toFixed(3));
    }
    const ks = cam.k;
    gStack.style.opacity = '';
    gStack.style.setProperty('--z', ks.toFixed(3));
    // Drawn small (a short panel), the intro figure keeps only big names and the dots.
    gStack.classList.toggle('small', ks < 0.5);
    fitNames();
    slideTabs();
  }

  // Far away a box is only its name. The name is drawn at about 12px on screen, but never wider than
  // its box: it shrinks to fit, and where that would go under 11px it is cut short with "…".
  function fitNames() {
    for (const n of els.names) {
      const k = cam.k * n.d.s;
      if (k >= 0.92 || els.diags[n.d.id].style.display === 'none') continue;
      const room = n.box.w - 10;
      let s = S.clamp(0.8 / k, 1, 3.2), text = n.full;
      if (n.w * s > room) {
        s = room / n.w;
        if (15 * s * k < 11.2) {
          s = 11.2 / (15 * k);
          let t = n.full;
          while (t.length > 2 && S.textW(t + '…', 15, { weight: 700, mono: n.mono }) * s > room) t = t.slice(0, -1);
          text = t + '…';
        }
      }
      if (text !== n.shown) { n.t.textContent = text; n.shown = text; }
      if (Math.abs(s - n.s) > 0.001) { n.g.setAttribute('transform', `translate(${n.cx},${n.cy}) scale(${s.toFixed(4)}) translate(${-n.cx},${-n.cy})`); n.s = s; }
    }
  }

  // A dashed frame's tab slides along the frame's edge to stay in the picture: right of the lane
  // names, left of the panel's edge and of the minimap. Where the full label does not fit in the part
  // of the frame on screen, the frame's short label is used.
  function slideTabs() {
    // On narrow screens the lane names are tags at the left edge of each lane: start right of them.
    const x0 = view.left + 8 + (S.narrow() ? 104 : 0), x1 = view.w - 10;
    const c = mini.corner;
    const lab = S.Map.labelRect();
    const mm = c && mini.d && mini.el && !mini.el.hidden && !mini.el.classList.contains('clash') && c.name !== 'tl' && c.name !== 'bl' ? { x: c.x - 8, y0: c.y - 6, y1: c.y + MH + 6 } : null;
    for (const t of els.tabs) {
      const d = t.d, B = cam.k * d.s, A = S.toScreen(d.ox, d.oy);
      const cs = S.clamp(0.96 / B, 1, 3.2);
      let right = x1;
      if (mm) { const ty = A[1] + B * (t.y + 11), hh = 11 * cs * B; if (ty + hh > mm.y0 && ty - hh < mm.y1) right = Math.min(right, mm.x); }
      const vis0 = Math.max(t.frame.x + 10, (x0 - A[0]) / B), vis1 = Math.min(t.frame.x + t.frame.w - 10, (right - A[0]) / B);
      const want = t.short && (B < 0.84 || t.full.w * cs > vis1 - vis0) ? t.short : t.full;
      if (want !== t.cur) {
        t.cur = want; t.w = want.w;
        if (t.right) t.x = t.edge - want.w;
        t.rect.setAttribute('x', t.x); t.rect.setAttribute('width', want.w);
        t.text.setAttribute('x', t.x + 9); t.text.textContent = want.label;
      }
      const w = t.w * cs, left = t.right ? t.x + t.w - w : t.x;
      // Only a sliver of the frame in the picture: no room for its name, leave it out.
      const hide = vis1 - vis0 < w * 0.92;
      let dx = 0;
      if (left < vis0) dx = vis0 - left;
      else if (left + w > vis1) dx = Math.max(vis1 - (left + w), vis0 - left);
      const lo = t.frame.x + 10 - left, hi = t.frame.x + t.frame.w - 10 - (left + w);
      dx = hi < lo ? 0 : S.clamp(dx, lo, hi);
      if (Math.abs(dx - t.dx) > 0.2) { t.g.setAttribute('transform', `translate(${dx.toFixed(1)},0)`); t.dx = dx; }
      // Where it would sit on the current step's label, the label wins.
      let over = false;
      if (lab && !hide) {
        const sx0 = A[0] + B * (left + dx), sx1 = sx0 + B * w, sy = A[1] + B * (t.y + 11), sh = 11 * cs * B;
        over = sx0 < lab.x1 && sx1 > lab.x0 && sy - sh < lab.y1 && sy + sh > lab.y0;
      }
      const off = hide || over;
      if (off !== !!t.off) { t.g.style.opacity = off ? 0 : ''; t.off = off; }
    }
  }


  // The left edge holds the lane names, except in the intro (the figure has its own).
  let gutter = true;
  function setGutter(on) {
    gutter = on;
    view.left = on && !S.narrow() ? 132 : 8;
  }

  // ---------- Minimap: the whole diagram being read, with the camera's window on it ----------
  const mini = { d: null, el: null, svg: null, view: null, s: 1, ox: 0, oy: 0 };
  function drawMini(d, sc) {
    mini.el = mini.el || document.getElementById('g-mini');
    mini.svg = mini.svg || document.getElementById('mini');
    const overview = !d || ['chapter', 'recap', 'region'].includes(sc.kind) || S.narrow() || view.w < 600 || view.h < 420;
    mini.el.hidden = overview;
    mini.el.classList.remove('clash');
    if (overview) { mini.d = null; return; }
    const W0 = 184, H0 = 104, pad = 8, L = d.L;
    mini.s = Math.min((W0 - 2 * pad) / L.width, (H0 - 2 * pad) / L.height);
    mini.ox = (W0 - L.width * mini.s) / 2; mini.oy = (H0 - L.height * mini.s) / 2;
    mini.d = d;
    const m = (v) => v * mini.s;
    let h = '';
    for (const r of d.rows) {
      const row = L.rows[r], tone = d.isPaper ? (S.toneOf((d.rowInfo[r] || {}).tone) || 'none') : r;
      if (!row) continue;
      h += `<rect class="mm-row T-${tone}" x="${mini.ox - 4}" y="${mini.oy + m(row.y)}" width="${m(L.width) + 8}" height="${Math.max(1, m(row.h) - 1)}"/>`;
    }
    const prog = progressAt(sc.index)[d.id] || new Set();
    const cur = sc.kind === 'step' || sc.kind === 'alt' ? d.g.steps[sc.step] : null;
    for (const e of Object.values(d.edges)) {
      if (e.st.alt && !(cur && cur.alt)) continue;
      const a = L.boxes[e.a], b = L.boxes[e.b];
      h += `<line class="mm-edge${cur && e.st === cur ? ' cur' : ''}" x1="${mini.ox + m(a.x + a.w / 2)}" y1="${mini.oy + m(a.y + a.h / 2)}" x2="${mini.ox + m(b.x + b.w / 2)}" y2="${mini.oy + m(b.y + b.h / 2)}"/>`;
    }
    const seen = new Set();
    for (const i of prog) { const st = d.g.steps[i]; seen.add(st.from); seen.add(st.to); }
    for (const b of d.g.boxes) {
      const R = L.boxes[b.id], tone = d.isPaper ? (S.toneOf((d.rowInfo[b.layer] || {}).tone) || 'none') : b.layer;
      const on = cur && (cur.from === b.id || cur.to === b.id);
      h += `<rect class="mm-box T-${tone}${on ? ' cur' : seen.has(b.id) ? ' seen' : ''}" x="${mini.ox + m(R.x)}" y="${mini.oy + m(R.y)}" width="${Math.max(2, m(R.w))}" height="${Math.max(2, m(R.h))}" rx="1.5"/>`;
    }
    h += '<rect class="mm-view" rx="2"/>';
    mini.svg.innerHTML = h;
    mini.view = mini.svg.querySelector('.mm-view');
    miniView();
  }
  function miniView() {
    if (!mini.d || !mini.view) return;
    const d = mini.d;
    const tx = view.left + (view.w - view.left - view.right) / 2 - cam.x * cam.k;
    const ty = view.top + (view.h - view.top - view.bottom) / 2 - cam.y * cam.k;
    const wx0 = (view.left - tx) / cam.k, wy0 = (0 - ty) / cam.k, wx1 = (view.w - tx) / cam.k, wy1 = (view.h - ty) / cam.k;
    const lx0 = (wx0 - d.ox) / d.s, ly0 = (wy0 - d.oy) / d.s, lx1 = (wx1 - d.ox) / d.s, ly1 = (wy1 - d.oy) / d.s;
    const x0 = S.clamp(mini.ox + lx0 * mini.s, 1, 183), y0 = S.clamp(mini.oy + ly0 * mini.s, 1, 103);
    const x1 = S.clamp(mini.ox + lx1 * mini.s, 1, 183), y1 = S.clamp(mini.oy + ly1 * mini.s, 1, 103);
    mini.view.setAttribute('x', x0); mini.view.setAttribute('y', y0);
    mini.view.setAttribute('width', Math.max(4, x1 - x0)); mini.view.setAttribute('height', Math.max(4, y1 - y0));
  }

  // ---------- Scenes: what is lit, and where the camera goes ----------
  let current = null;
  function setClass(el, cls) {
    if (el.getAttribute('data-state') !== cls) el.setAttribute('data-state', cls);
    if (el._label && el._label.getAttribute('data-state') !== cls) el._label.setAttribute('data-state', cls);
  }

  function clearStates() {
    if (moved) { moved.removeAttribute('transform'); moved = null; }
    curLabel = null;
    if (fromTag) fromTag.classList.remove('on');
    for (const el of Object.values(els.edges)) setClass(el, 'idle');
    for (const el of Object.values(els.boxes)) setClass(el, 'idle');
    for (const el of Object.values(els.regions)) setClass(el, 'idle');
    for (const g of Object.values(els.tokens)) g.textContent = '';
  }

  // Progress of each diagram up to a scene: which steps are behind the reader.
  function progressAt(index) {
    const prog = {};
    for (let i = 0; i <= index; i++) {
      const sc = S.scenes[i];
      if ((sc.kind === 'step' || sc.kind === 'alt') && sc.diag) (prog[sc.diag] = prog[sc.diag] || new Set()).add(sc.step);
    }
    return prog;
  }

  function token(d, e, st) {
    const g = els.tokens[d.id];
    const pathId = `edge-${d.id.replace(/\./g, '-')}-${e.i}`;
    const t = S.svg('g', { class: 'token' }, g);
    S.svg('circle', { r: st.data ? 7 : 5.5, class: 'tk-dot' + (st.data ? ' has-data' : '') }, t);
    if (!S.reduceMotion) {
      const am = S.svg('animateMotion', { dur: st.kind === 'signal' ? '1.1s' : '2.2s', repeatCount: 'indefinite', keyPoints: '0;1;1', keyTimes: '0;0.8;1', calcMode: 'linear' }, t);
      S.svg('mpath', { href: '#' + pathId }, am);
    } else {
      t.setAttribute('transform', `translate(${e.mid[0]},${e.mid[1]})`);
    }
  }

  function stepFocus(d, i, tight) {
    const st = d.g.steps[i];
    const rs = [S.boxRect(d, st.from), S.boxRect(d, st.to)];
    const e = d.edges[i];
    if (e && e.label) rs.push({ x: d.ox + d.s * e.label.x, y: d.oy + d.s * e.label.y, w: d.s * e.label.w, h: d.s * e.label.h });
    const u = S.unionRect(rs);
    return tight ? S.grow(u, 14 * d.s, 10 * d.s) : S.grow(u, 60 * d.s, 50 * d.s);
  }
  // Seeing only the end of a long arrow: the box it reaches, its label moved beside the arrow near that
  // end, and a tag where the arrow leaves the picture naming the box it comes from.
  let moved = null, fromTag = null, curLabel = null;
  function endCam(d, i) {
    const e = d.edges[i], st = d.g.steps[i];
    const path = els.edges[d.id + '/' + i].querySelector('.e-line');
    const len = path.getTotalLength();
    const p = path.getPointAtLength(len * 0.86);
    const delta = [p.x - e.mid[0], p.y - e.mid[1]];
    const w = (x, y) => [d.ox + d.s * x, d.oy + d.s * y];
    const [lx, ly] = w(e.label.x + delta[0], e.label.y + delta[1]);
    const r = S.unionRect([S.boxRect(d, st.to), { x: lx, y: ly, w: d.s * e.label.w, h: d.s * e.label.h }]);
    const t = avoidMini(settle(fitNear(S.grow(r, 40 * d.s, 30 * d.s), S.grow(r, 12 * d.s, 10 * d.s), 0.92 / d.s, 1.12 / d.s), d.s), r);
    // Where the arrow, followed back from its end, leaves the picture.
    const cx = view.left + (view.w - view.left - view.right) / 2, cy = view.top + (view.h - view.top - view.bottom) / 2;
    const scr = (q) => { const [x, y] = w(q.x, q.y); return [cx + (x - t.x) * t.k, cy + (y - t.y) * t.k]; };
    const inside = ([x, y]) => x > view.left + 14 && x < view.w - 14 && y > 14 && y < view.h - 14;
    let last = null, exit = null;
    for (let k = 0; k <= 80; k++) {
      const q = scr(path.getPointAtLength(len * (1 - k / 80)));
      if (inside(q)) last = q; else if (last) { exit = { at: last, out: q }; break; }
    }
    const [a0, b0] = scr({ x: e.label.x + delta[0], y: e.label.y + delta[1] }), lw = d.s * e.label.w * t.k * S.clamp(0.96 / (t.k * d.s), 1, 3.2), lh = d.s * e.label.h * t.k * S.clamp(0.96 / (t.k * d.s), 1, 3.2);
    if (exit) exit.label = { x0: a0 - 4, y0: b0 - 4, x1: a0 + lw + 4, y1: b0 + lh + 4 };
    return { t, delta, exit };
  }
  function showFrom(d, st, exit) {
    fromTag = fromTag || document.getElementById('g-from');
    const b = d.box[st.from], tone = d.isPaper ? (S.toneOf((d.rowInfo[b.layer] || {}).tone) || 'none') : b.layer;
    const dx = exit.out[0] - exit.at[0], dy = exit.out[1] - exit.at[1];
    const arrow = '→↘↓↙←↖↑↗'[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    fromTag.className = `g-from T-${tone}`;
    fromTag.innerHTML = `<b>${arrow}</b><span class="${S.isJa(S.boxName(b)) ? '' : 'mono'}">${S.esc(S.boxName(b))}</span> から`;
    const tw = fromTag.offsetWidth || 120, th = fromTag.offsetHeight || 26;
    // On the panel's edge where the arrow leaves (the edge it crosses), centred on the crossing.
    const [ox, oy] = exit.out;
    let x = ox - tw / 2, y = oy - th / 2;
    if (ox <= view.left + 14) x = view.left + 6; else if (ox >= view.w - 14) x = view.w - tw - 6;
    if (oy <= 14) y = 6; else if (oy >= view.h - 14) y = view.h - th - 6;
    x = S.clamp(x, view.left + 6, view.w - tw - 6); y = S.clamp(y, 6, view.h - th - 6);
    // Not over the arrow's own label: slide along the panel's edge past it.
    const L = exit.label, hit = () => L && x < L.x1 && x + tw > L.x0 && y < L.y1 && y + th > L.y0;
    if (hit()) {
      const side = ox <= view.left + 14 || ox >= view.w - 14;
      const opts = side ? [L.y1 + 6, L.y0 - th - 6].map((v) => [x, v]) : [L.x1 + 6, L.x0 - tw - 6].map((v) => [v, y]);
      const ok = opts.filter(([a, b]) => a >= view.left + 6 && a <= view.w - tw - 6 && b >= 6 && b <= view.h - th - 6);
      if (ok.length) { ok.sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y)); [x, y] = ok[0]; }
    }
    fromTag.style.left = x + 'px';
    fromTag.style.top = y + 'px';
    requestAnimationFrame(() => fromTag.classList.add('on'));
  }

  function stepCam(d, i, kMax) {
    const t = fitNear(stepFocus(d, i), stepFocus(d, i, true), 0.92 / d.s, kMax);
    return avoidMini(settle(t, d.s), stepFocus(d, i, true));
  }

  S.Map = {
    init() {
      svg = document.getElementById('map');
      overlay = document.getElementById('g-lanes');
      S.svg('defs', {}, svg).innerHTML = `
        <filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".12"/></filter>
        <filter id="sheet" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-opacity=".18"/></filter>`;
      world = S.svg('g', { class: 'world' }, svg);
      buildWorld();
      renderLanes();
      renderStack();
      for (const d of Object.values(W.flows)) renderDiagram(d, world, `translate(${d.ox},${d.oy})`);
      this.resize();
      cam.x = M.stackW / 2; cam.y = W.height / 2; cam.k = 0.8;
      applyCam();
    },
    resize() {
      const r = svg.getBoundingClientRect();
      view = { w: r.width, h: r.height, left: 8, top: 8, right: 8, bottom: 8 };
      setGutter(gutter);
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      if (current) this.show(current, true); else applyCam();
    },
    view: () => view,
    // Move the picture to a scene.
    show(sc, instant) {
      current = sc;
      clearStates();
      const st = sc.diag && sc.step != null ? S.D[sc.diag].g.steps[sc.step] : null;
      svg.setAttribute('aria-label', st ? `${S.plain(st.label)}（${S.title(S.D[sc.diag].box[st.from].node)} から ${S.title(S.D[sc.diag].box[st.to].node)} へ）` : '地図');
      svg.dataset.scene = sc.kind;
      const intro = ['hero', 'layers', 'cross', 'routes'].includes(sc.kind);
      svg.classList.toggle('is-intro', intro);
      svg.dataset.intro = intro ? sc.kind : '';
      setGutter(!intro);
      drawMini(intro ? null : S.D[sc.diag], sc);
      if (intro) {
        const r = sc.kind === 'cross' ? { x: 20, y: -60, w: M.stackW, h: W.height + 80 } : { x: 20, y: -52, w: M.stackW - 10, h: W.height + 64 };
        if (S.narrow() && view.w < 640) { r.x = 24; r.w = M.stackW - 4; r.y = -64; r.h = W.height + 76; }
        flyTo(fit(r, 1.2), instant);
        return;
      }
      const d = S.D[sc.diag];
      const prog = progressAt(sc.index);
      // Light up each diagram by the progress made in it.
      const paint = (dd, curStep, altMode) => {
        const done = prog[dd.id] || new Set();
        const touched = new Set();
        for (const e of Object.values(dd.edges)) {
          const el = els.edges[dd.id + '/' + e.i];
          if (e.st.alt) { setClass(el, altMode && e.i === curStep ? 'cur' : altMode && e.st.alt.at === dd.g.steps[curStep]?.alt?.at && done.has(e.i) ? 'done' : 'hide'); continue; }
          if (e.i === curStep) setClass(el, 'cur');
          else if (done.has(e.i)) { setClass(el, 'done'); touched.add(e.st.from); touched.add(e.st.to); }
          else setClass(el, 'todo');
        }
        for (const b of dd.g.boxes) setClass(els.boxes[dd.id + '/' + b.id], touched.has(b.id) ? 'seen' : 'dim');
        if (curStep != null) {
          const st = dd.g.steps[curStep];
          setClass(els.boxes[dd.id + '/' + st.from], 'cur');
          setClass(els.boxes[dd.id + '/' + st.to], 'cur');
          if (st.alt) setClass(els.edges[dd.id + '/' + st.alt.at], 'instead');
        }
      };
      // Ancestors keep the state they had when we went in.
      let a = d;
      while (a.parent) {
        const parent = S.D[a.parent];
        const hostStep = S.scenes.slice(0, sc.index).reverse().find((s) => s.diag === parent.id && (s.kind === 'step'));
        paint(parent, hostStep ? hostStep.step : null, false);
        setClass(els.boxes[parent.id + '/' + a.host], 'cur');
        a = parent;
      }
      if (sc.kind === 'chapter' || sc.kind === 'recap') {
        for (const e of Object.values(d.edges)) setClass(els.edges[d.id + '/' + e.i], e.st.alt ? 'hide' : sc.kind === 'recap' ? 'done' : 'over');
        for (const b of d.g.boxes) setClass(els.boxes[d.id + '/' + b.id], 'seen');
        const r = S.diagRect(d);
        flyTo(fit(S.grow(r, 30, 40)), instant);
        return;
      }
      if (sc.kind === 'region') {
        for (const e of Object.values(d.edges)) setClass(els.edges[d.id + '/' + e.i], e.st.alt ? 'hide' : 'todo');
        const reg = (d.g.regions || []).find((r) => r.node === sc.region);
        for (const b of d.g.boxes) setClass(els.boxes[d.id + '/' + b.id], reg.boxes.includes(b.id) ? 'cur' : 'dim');
        for (const [k, el] of Object.entries(els.regions)) if (k.startsWith(d.id + '/')) setClass(el, k === d.id + '/' + sc.region ? 'cur' : 'dim');
        const u = S.grow(S.unionRect(reg.boxes.map((id) => S.boxRect(d, id))), 60, 70);
        flyTo(settle(fit(u, 1.05), 1), instant);
        return;
      }
      if (sc.kind === 'paper' && S.paperOpen && !S.paperOpen(d.id)) {
        const parent = S.D[d.parent];
        const hostStep = S.scenes.slice(0, sc.index).reverse().find((s) => s.diag === parent.id && s.kind === 'step');
        paint(parent, hostStep ? hostStep.step : null, false);
        paint(d, null, false);
        for (const e of Object.values(d.edges)) if (!e.st.alt) setClass(els.edges[d.id + '/' + e.i], 'over');
        for (const b of d.g.boxes) setClass(els.boxes[d.id + '/' + b.id], 'seen');
        setClass(els.boxes[parent.id + '/' + d.host], 'cur');
        if (hostStep) setClass(els.edges[parent.id + '/' + hostStep.step], 'done');
        drawMini(parent, sc);
        const r = S.grow(S.boxRect(parent, d.host), 22 * parent.s, 22 * parent.s);
        let t = fit(r);
        // Close enough for the paper to show (it fades in at a third of its own size), even if the
        // box's sides are cut on a narrow panel.
        if (t.k * d.s < 0.34) { const sr = S.diagRect(d); t = { x: sr.x + sr.w / 2, y: sr.y + sr.h / 2, k: 0.34 / d.s }; }
        t = avoidMini(t, r);
        flyTo(t, instant);
        mini.el.classList.toggle('clash', !!mini.clash);
        return;
      }
      if (sc.kind === 'paper') {
        paint(d, null, false);
        for (const e of Object.values(d.edges)) if (!e.st.alt) setClass(els.edges[d.id + '/' + e.i], 'over');
        for (const b of d.g.boxes) setClass(els.boxes[d.id + '/' + b.id], 'seen');
        const entry = d.g.entry && els.boxes[d.id + '/' + d.g.entry];
        if (entry) setClass(entry, 'cur');
        // The whole sheet when it is readable; otherwise its start (the entry), readable.
        const r = S.grow(S.diagRect(d), 4 * d.s);
        let t = fit(r);
        const kMin = 0.94 / d.s;
        if (t.k < kMin) {
          const vw = (view.w - view.left - view.right - 56) / kMin, vh = (view.h - view.top - view.bottom - 56) / kMin;
          const eb = d.g.entry ? S.boxRect(d, d.g.entry) : r;
          t = { k: kMin, x: r.x + vw / 2, y: r.h <= vh ? r.y + r.h / 2 : eb.y + eb.h / 2 };
        }
        t = avoidMini(settle(t, d.s), d.g.entry ? S.boxRect(d, d.g.entry) : r);
        flyTo(t, instant);
        mini.el.classList.toggle('clash', !!mini.clash);
        return;
      }
      if (sc.kind === 'paper-close') {
        paint(d, sc.step, false);
        const host = S.D[sc.from].host;
        setClass(els.boxes[d.id + '/' + host], 'cur');
        flyTo(stepCam(d, sc.step, 1.1 / d.s), instant);
        mini.el.classList.toggle('clash', !!mini.clash);
        return;
      }
      // A step (or a step that happens instead of another).
      paint(d, sc.step, sc.kind === 'alt');
      const e = d.edges[sc.step];
      token(d, e, d.g.steps[sc.step]);
      curLabel = els.edges[d.id + '/' + sc.step]._label;
      let t = stepCam(d, sc.step, 1.12 / d.s);
      // A long arrow on a small panel would shrink everything to dots: look at where it arrives instead.
      const end = t.k * d.s < 0.42 ? endCam(d, sc.step) : null;
      if (end) { t = end.t; moved = els.edges[d.id + '/' + sc.step]._label; moved.setAttribute('transform', `translate(${end.delta[0].toFixed(1)},${end.delta[1].toFixed(1)})`); }
      flyTo(t, instant);
      if (end && end.exit) showFrom(d, d.g.steps[sc.step], end.exit);
      mini.el.classList.toggle('clash', !!mini.clash);
    },
    // Where the current step's label is, in the panel's pixels (null when there is none).
    labelRect() {
      if (!curLabel || curLabel.getAttribute('data-state') !== 'cur') return null;
      const r = curLabel.getBoundingClientRect(), o = svg.getBoundingClientRect();
      return r.width ? { x0: r.left - o.left - 4, y0: r.top - o.top - 4, x1: r.right - o.left + 4, y1: r.bottom - o.top + 4 } : null;
    },
    highlightNode(id, on) {
      for (const el of svg.querySelectorAll(`.box[data-node="${CSS.escape(id)}"], .st-dot[data-node="${CSS.escape(id)}"]`)) el.classList.toggle('hl', on);
    },
  };
})();
