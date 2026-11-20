import { svg, textWidth } from "./util.js";
import { OPS } from "./journeys.js";

const isAscii = (s) => !/[^\x00-\x7f]/.test(String(s || ""));
const monoish = (s) => /[_\[\]]/.test(String(s || ""));

// Lays out and draws one journey as a grid, in two SVGs that share one coordinate
// system: the label column (left, sticky when the grid scrolls) and the grid (right).
// Rows are the pieces of data, then the place strip: one lane per place, a bar for what
// is there and an arrow where it moves.
export function renderTable(els, J, opts) {
  const A = opts.A;
  const elL = els.left, elR = els.right;
  for (const el of [elL, elR]) while (el.firstChild) el.removeChild(el.firstChild);

  const cols = columnsFor(J, opts.alt);
  const rows = J.rows;
  const isUI = J.id === "ui";
  const strip = J.strip;
  const stripTop = !!opts.stripTop;

  // ------------------------------------------------------------ widths
  let LW = 0;
  for (const r of rows) LW = Math.max(LW, textWidth(r.name, 13, 650, isAscii(r.name)) + textWidth(r.type || r.sub || "", 11, 400, isAscii(r.type)) + 30);
  for (const l of strip.lanes) LW = Math.max(LW, textWidth(l.name, 12, 650, isAscii(l.name)) + textWidth(l.sub, 11, 400, monoish(l.sub)) + 28);
  LW = Math.max(170, Math.min(262, Math.ceil(LW)));
  const GAP = 6;
  const avail = Math.max(560, opts.width || 1200);
  const NARROW = 24;
  const nN = cols.filter((c) => c.narrow).length, nW = cols.length - nN;
  const WIDE = Math.max(46, Math.min(78, Math.floor((avail - LW - GAP - 6 - nN * NARROW) / nW)));
  const X = {}, W = {};
  let x = LW + GAP;
  for (const c of cols) { X[c.key] = x; W[c.key] = c.narrow ? NARROW : WIDE; x += W[c.key]; }
  const width = x + 6;
  const cx = (k) => X[k] + W[k] / 2;
  const order = cols.map((c) => c.key);
  const idx = (k) => order.indexOf(k);

  // ------------------------------------------------------------ heights
  const yCtx = 4;
  const yPaper = yCtx + 22;
  const yStep = yPaper + 19;
  const headBottom = yStep + 66;
  let y = headBottom;
  const Y = {};
  const sections = [];
  let stripY = null;
  const laneY = {}, laneH = {}, laneR = {};
  // a lane with two rows leaves room between them for an arrow from one to the other
  const placeStrip = () => {
    y += isUI ? 8 : 6;
    stripY = y; y += 24;
    for (const l of strip.lanes) { laneR[l.id] = (l.rows || 1) > 1 ? 24 : 19; laneY[l.id] = y; laneH[l.id] = (l.rows || 1) * laneR[l.id] + 7; y += laneH[l.id]; }
  };
  if (stripTop) placeStrip();
  const groupIds = [...new Set(rows.map((r) => r.group))];
  for (const g of groupIds) {
    y += isUI ? 6 : 3;
    const titleY = y; y += isUI ? 23 : 19;
    sections.push({ g, y: titleY });
    for (const r of rows.filter((rr) => rr.group === g)) {
      const hgt = r.tall && isUI ? 60 : (isUI ? (g === "outer" ? 23 : 24) : 22);
      Y[r.id] = { top: y, h: hgt, mid: r.tall && isUI ? y + 12.5 : y + hgt / 2 };
      y += hgt;
    }
  }
  if (!stripTop) placeStrip();
  const height = y + 10;
  const rowMid = (lane, row) => laneY[lane] + 3.5 + (row || 0) * laneR[lane] + laneR[lane] / 2;

  for (const [el, x0, w] of [[elL, 0, LW], [elR, LW, width - LW]]) {
    el.setAttribute("viewBox", `${x0} 0 ${w} ${height}`);
    el.setAttribute("width", w);
    el.setAttribute("height", height);
  }

  // ------------------------------------------------------------ defs
  const defs = svg("defs", {}, elR);
  const pat = svg("pattern", { id: "stripe-osapp", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  svg("rect", { width: 8, height: 8, fill: "var(--l-os)" }, pat);
  svg("rect", { width: 3.2, height: 8, fill: "var(--l-app)" }, pat);
  for (const [id, cls, size] of [["arr-main", "m-main", 8], ["arr-thin", "m-thin", 7]]) {
    // a fixed size in the grid's units, so a short arrow between two rows stays in the gap
    const mk = svg("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: size, markerHeight: size, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse", class: cls }, defs);
    svg("path", { d: "M0,0 L10,5 L0,10 z" }, mk);
  }

  const L = {
    back: svg("g", {}, elL), band: svg("g", {}, elL), head: svg("g", {}, elL), lab: svg("g", {}, elL),
  };
  const gBack = svg("g", {}, elR);
  const gBand = svg("g", {}, elR);
  const gHead = svg("g", {}, elR);
  const gStrip = svg("g", { class: opts.reveal ? "reveal" : "" }, elR);
  const gRib = svg("g", { class: opts.reveal ? "reveal" : "" }, elR);
  const gHit = svg("g", {}, elR);
  const gBars = svg("g", { class: opts.reveal ? "reveal-late" : "" }, elR);
  const gVeil = svg("g", {}, elR);
  const gCell = svg("g", { class: opts.reveal ? "reveal-late" : "" }, elR);
  const gTop = svg("g", { class: opts.reveal ? "reveal-late" : "" }, elR);

  // ------------------------------------------------------------ backgrounds
  for (const r of rows) {
    const ly = Y[r.id].top + Y[r.id].h;
    svg("line", { x1: 4, x2: LW, y1: ly, y2: ly, class: "rowline" }, L.back);
    svg("line", { x1: LW, x2: width - 4, y1: ly, y2: ly, class: "rowline" }, gBack);
  }
  for (const c of cols) {
    if (c.alt) svg("rect", { x: X[c.key] + 1, y: yStep - 2, width: W[c.key] - 2, height: height - yStep, rx: 6, class: "alt-col" }, gBack);
  }
  for (const c of cols) {
    if (c.phase === 2) {
      const px = X[c.key] - 0.5;
      svg("line", { x1: px, x2: px, y1: yPaper, y2: height - 6, class: "phase" }, gBack);
    }
  }

  // ------------------------------------------------------------ bands (selection)
  const colBand = svg("rect", { x: 0, y: 0, width: 0, height, rx: 8, class: "colband" }, gBand);
  const hoverBand = svg("rect", { x: 0, y: 0, width: 0, height, rx: 8, class: "colband" }, gBand);
  const rowBandL = svg("rect", { x: 2, y: 0, width: LW - 2, height: 0, rx: 6, class: "rowband" }, L.band);
  const rowBand = svg("rect", { x: LW, y: 0, width: width - LW - 4, height: 0, rx: 6, class: "rowband" }, gBand);

  // ------------------------------------------------------------ header: the corner names the header rows
  svg("text", { x: 8, y: yCtx + 13, class: "corner", text: "走る所" }, L.head);
  if (cols.some((c) => c.paper)) svg("text", { x: 8, y: yPaper + 11, class: "corner", text: "中の紙をここに開いた" }, L.head);
  svg("text", { x: 8, y: yStep + 18, class: "corner b", text: "手順 →" }, L.head);
  svg("text", { x: 8, y: yStep + 41, class: "corner", text: "マス：その手順が" }, L.head);
  svg("text", { x: 8, y: yStep + 56, class: "corner", text: isUI ? "フィールドにすること" : "値にすること" }, L.head);

  // ------------------------------------------------------------ header: contexts (one name per context)
  const runs = [];
  for (const c of cols) {
    const last = runs[runs.length - 1];
    if (last && last.ctx === c.ctx) last.to = c.key; else runs.push({ ctx: c.ctx, from: c.key, to: c.key });
  }
  const ctxName = {};
  for (const id of new Set(runs.map((r) => r.ctx))) {
    const narrowest = Math.min(...runs.filter((r) => r.ctx === id).map((r) => X[r.to] + W[r.to] - X[r.from] - 14));
    const cands = contextLabel(A, J, id).filter(Boolean);
    ctxName[id] = { label: cands.find((o) => textWidth(o, 12, 600) <= narrowest) || fitLabel(cands[cands.length - 1], narrowest, 12, 600), full: cands[0] };
  }
  for (const r of runs) {
    const x0 = X[r.from] + 3, x1 = X[r.to] + W[r.to] - 3;
    svg("path", { d: `M${x0},${yCtx + 19} v-4 H${x1} v4`, class: "ctxline" }, gHead);
    const t = svg("text", { x: (x0 + x1) / 2, y: yCtx + 12, "text-anchor": "middle", "font-size": 12, "font-weight": 600, class: "t2", text: ctxName[r.ctx].label }, gHead);
    if (ctxName[r.ctx].full !== ctxName[r.ctx].label) svg("title", { text: ctxName[r.ctx].full }, t);
  }
  // papers opened in place
  const pruns = [];
  for (const c of cols) {
    const p = c.paper && !c.alt ? c.paper : null;
    const last = pruns[pruns.length - 1];
    if (p && last && last.p === p) last.to = c.key; else if (p) pruns.push({ p, from: c.key, to: c.key });
  }
  for (const r of pruns) {
    const x0 = X[r.from] + 4, x1 = X[r.to] + W[r.to] - 4;
    const paper = A.papers[r.p];
    svg("path", { d: `M${x0},${yPaper + 17} v-4 H${x1} v4`, class: "paperline" }, gHead);
    const t = fitLabel([paper.tab + " の中", paper.tab.split(".").pop() + " の中", paper.tab.split(".").pop()], x1 - x0 - 8, 11.5, 500, true);
    const tt = svg("text", { x: (x0 + x1) / 2, y: yPaper + 10, "text-anchor": "middle", "font-size": 11.5, class: "t2 mono", text: t }, gHead);
    svg("title", { text: `${paper.title}（地図の「中の紙」を、ここに開いて並べた）` }, tt);
  }

  // ------------------------------------------------------------ header: steps
  const stepNum = {};
  for (const c of cols) {
    const g = svg("g", { class: "colhead", "data-col": c.key }, gHead);
    const ccx = cx(c.key);
    const r = c.narrow ? 10 : 11;
    const num = svg("circle", { cx: ccx, cy: yStep + 13, r, class: "stepnum" }, g);
    if (c.alt) num.setAttribute("stroke-dasharray", "3 2");
    if (c.security) { num.setAttribute("stroke", "var(--red)"); num.setAttribute("stroke-width", "2"); }
    const nt = svg("text", { x: ccx, y: yStep + 17, "text-anchor": "middle", "font-size": c.alt ? 11 : (c.n >= 10 ? 11 : 12), class: "stepnum-t", text: c.alt ? "もし" : String(c.n) }, g);
    stepNum[c.key] = { num, nt };
    if (c.narrow && c.tiny) {
      // a narrow column: one short word, written downwards
      [...c.tiny].forEach((ch, i) => svg("text", { x: ccx, y: yStep + 38 + i * 11.5, "text-anchor": "middle", "font-size": 10.5, class: "tiny", text: ch }, g));
    } else if (!c.narrow && c.head) {
      const lines = fitHead(c.head, W[c.key] - 4, !!c.mono);
      lines.lines.forEach((line, i) => {
        svg("text", { x: ccx, y: yStep + 38 + i * 14, "text-anchor": "middle", "font-size": lines.fs, "font-weight": 600, class: c.mono ? "mono" : "", text: line }, g);
      });
    }
    if (c.drift) {
      const dg = svg("g", { class: "drift" }, g);
      svg("circle", { cx: ccx + r + 5, cy: yStep + 6, r: 7 }, dg);
      svg("text", { x: ccx + r + 5, y: yStep + 10, "text-anchor": "middle", text: "!" }, dg);
    }
  }

  // ------------------------------------------------------------ section titles + column annotations
  for (const s of sections) {
    const title = J.groups[s.g] || s.g;
    svg("text", { x: 8, y: s.y + (isUI ? 16 : 14), class: "sect", text: title }, L.lab);
    for (const c of cols) {
      if (!c.ann || c.ann.sec !== s.g) continue;
      milestone(cx(c.key), s.y + 3, c.ann.t);
    }
  }
  function milestone(ax, top, text) {
    const g = svg("g", { class: "milestone" }, gRib);
    const tw = textWidth(text, 11.5, 600) + 14;
    svg("rect", { x: ax - tw / 2, y: top, width: tw, height: 18, rx: 9 }, g);
    svg("text", { x: ax, y: top + 13, "text-anchor": "middle", "font-size": 11.5, "font-weight": 600, text }, g);
  }

  // ------------------------------------------------------------ row labels
  for (const r of rows) {
    const g = svg("g", { class: "rowlabel", "data-row": r.id }, L.lab);
    const ty = Y[r.id].mid + 4.5;
    svg("rect", { x: 2, y: Y[r.id].top + 1, width: LW - 4, height: Y[r.id].h - 2, fill: "transparent" }, g);
    svg("text", { x: 10, y: ty, class: "rl-name" + (isAscii(r.name) ? " mono" : ""), text: r.name }, g);
    if (r.type || r.sub) {
      svg("text", { x: LW - 8, y: ty, "text-anchor": "end", class: "rl-sub" + (r.type && isAscii(r.type) ? " mono" : ""), text: r.type || r.sub }, g);
    }
    if (r.tall && isUI) {
      svg("text", { x: 10, y: Y[r.id].top + 37, class: "rl-key", text: "ここが要" }, g);
      svg("text", { x: 10, y: Y[r.id].top + 51, class: "rl-sub", text: "持ち主・返事の宛先になる" }, g);
    }
    g.addEventListener("click", (e) => { e.stopPropagation(); opts.onRow && opts.onRow(r.id); });
    g.addEventListener("mouseenter", (e) => opts.onTip && opts.onTip(e, `<b class="mono">${escapeHtml(r.name)}</b>${r.type ? ` <span class="k">${escapeHtml(r.type)}</span>` : ""}<br><span class="q">${escapeHtml(r.text)}</span>`));
    g.addEventListener("mouseleave", () => opts.onTip && opts.onTip(null));
  }

  // ------------------------------------------------------------ ribbons
  const lastKey = cols[cols.length - 1].key;
  for (const r of rows) {
    const segs = ribbonSegments(r, cols, idx, lastKey);
    const ry = Y[r.id].mid;
    for (const s of segs) {
      const x0 = s.fromEdge ? X[s.from] + 2 : cx(s.from);
      const x1 = s.toEdge ? X[s.to] + W[s.to] - 2 : cx(s.to);
      if (x1 - x0 < 1) continue;
      svg("rect", { x: x0, y: ry - 3.5, width: x1 - x0, height: 7, rx: 3.5, class: "ribbon rib-" + s.state }, gRib);
    }
  }

  // ------------------------------------------------------------ the place strip
  const barEls = [], moveEls = [];
  drawStrip();
  function drawStrip() {
    const top = stripY;
    svg("text", { x: 8, y: top + 16, class: "sect", text: "どこにある？" }, L.lab);
    svg("text", { x: 8 + textWidth("どこにある？", 12, 700) + 8, y: top + 16, class: "sect-sub", text: "置き場ごと" }, L.lab);
    // the boundary, named once
    const tones = strip.lanes.map((l) => l.tone);
    let bY = null;
    for (let i = 1; i < strip.lanes.length; i++) {
      if ((tones[i - 1] === "app") !== (tones[i] === "app")) bY = laneY[strip.lanes[i].id];
    }
    if (bY !== null) {
      const tx = width - 10;
      const lbl = isUI ? "上はアプリ、下は OS 側のメモリ" : "上はアプリ、下は OS・カーネル・ハードウェア";
      svg("text", { x: tx, y: top + 16, "text-anchor": "end", class: "boundary-t", text: lbl }, gStrip);
      const tw = textWidth(lbl, 11.5, 600);
      svg("line", { x1: tx - tw - 36, x2: tx - tw - 8, y1: top + 12, y2: top + 12, class: "boundary" }, gStrip);
      svg("text", { x: tx - tw - 42, y: top + 16, "text-anchor": "end", class: "boundary-t", "font-weight": 700, text: "境界" }, gStrip);
    }
    for (const l of strip.lanes) {
      svg("rect", { x: LW + 2, y: laneY[l.id] + 1, width: width - LW - 6, height: laneH[l.id] - 2, rx: 5, class: "lane-" + l.tone }, gStrip);
      svg("rect", { x: 4, y: laneY[l.id] + 1, width: LW - 4, height: laneH[l.id] - 2, rx: 5, class: "lane-" + l.tone }, L.back);
      const g = svg("g", { class: "lanelabel" }, L.lab);
      const ly = laneY[l.id] + Math.min(laneH[l.id], 26) / 2 + 4.5;
      svg("rect", { x: 4, y: laneY[l.id] + 6, width: 3, height: laneH[l.id] - 12, rx: 1.5, fill: `var(--l-${l.tone})` }, g);
      const t = svg("text", { x: 12, y: ly, class: "ln-name" + (isAscii(l.name) ? " mono" : ""), text: l.name }, g);
      svg("tspan", { dx: 6, class: "ln-sub" + (monoish(l.sub) ? " mono" : ""), text: l.sub }, t);
      svg("title", { text: plainNodeText(A, l.node) }, g);
    }
    if (bY !== null) {
      svg("line", { x1: LW + 2, x2: width - 4, y1: bY, y2: bY, class: "boundary" }, gStrip);
      svg("line", { x1: 4, x2: LW, y1: bY, y2: bY, class: "boundary" }, L.back);
    }
    // bars
    for (const b of strip.bars) {
      if (X[b.from] === undefined || X[b.to] === undefined) continue;
      const lane = strip.lanes.find((l) => l.id === b.lane);
      const my = rowMid(b.lane, b.row);
      const single = b.from === b.to;
      const x0 = single ? X[b.from] + 4 : cx(b.from);
      const x1 = single ? X[b.to] + W[b.to] - 4 : cx(b.to);
      const g = svg("g", { class: `bar ${b.s} t-${lane.tone}` }, gBars);
      svg("rect", { x: x0, y: my - 8, width: Math.max(8, x1 - x0), height: 16, rx: 8 }, g);
      // the label stops before an arrow that passes through this bar (arrows that
      // start or end at the bar touch only its edge)
      let room = x1 - x0 - 14;
      for (const m of strip.moves) {
        if (X[m.at] === undefined || single) continue;
        const mx = cx(m.at) + (m.dx || 0);
        const ya = rowMid(m.from[0], m.from[1]), yb = rowMid(m.to[0], m.to[1]);
        if (mx > x0 + 4 && mx < x1 && Math.min(ya, yb) < my - 1 && Math.max(ya, yb) > my + 1) room = Math.min(room, mx - x0 - 14);
      }
      const label = fitLabel(b.t, room, 12, b.s === "main" ? 650 : 500);
      if (label) svg("text", { x: single ? (x0 + x1) / 2 : x0 + 8, y: my + 4, "text-anchor": single ? "middle" : "start", text: label }, g);
      g.addEventListener("mouseenter", (e) => opts.onTip && opts.onTip(e, `<b>${escapeHtml(b.t[0])}</b><br><span class="k">${escapeHtml(lane.name)}（${escapeHtml(lane.sub)}）・手順 ${colNum(b.from)}〜${colNum(b.to)}</span>${b.note ? `<br><span class="q">${escapeHtml(b.note)}</span>` : ""}`));
      g.addEventListener("mouseleave", () => opts.onTip && opts.onTip(null));
      g.addEventListener("click", (e) => { e.stopPropagation(); const k = colAt(e); if (k) opts.onCol && opts.onCol(k); });
      barEls.push({ g, a: idx(b.from), b: idx(b.to) });
    }
    // moves
    for (const m of strip.moves) {
      if (X[m.at] === undefined) continue;
      const mx = cx(m.at) + (m.dx || 0);
      const y1 = rowMid(m.from[0], m.from[1]), y2 = rowMid(m.to[0], m.to[1]);
      const dir = Math.sign(y2 - y1);
      const g = svg("g", { class: "move " + m.s }, gBars);
      svg("line", { x1: mx, x2: mx, y1: y1 + dir * 8, y2: y2 - dir * 8.6, "marker-end": `url(#arr-${m.s === "main" ? "main" : "thin"})` }, g);
      svg("circle", { cx: mx, cy: y1 + dir * 8, r: m.s === "main" ? 2.6 : 2 }, g);
      if (m.t) {
        const [ll, lr] = Array.isArray(m.lane) ? m.lane : [m.lane, 0];
        const ly = rowMid(ll, lr) + 4;
        const left = m.side === "left";
        const lx = mx + (left ? -7 : 7) + (m.ldx || 0);
        const room = left ? lx - (X[order[Math.max(0, idx(m.at) - 3)]] || LW) : 3 * WIDE;
        const lt = svg("text", { x: lx, y: ly, "text-anchor": left ? "end" : "start", class: "move-t", text: fitLabel(m.t, room, 12, 600) }, g);
        const lane = strip.lanes.find((l) => l.id === ll);
        if (lane) lt.style.stroke = `var(--${lane.tone}-t1)`;
      }
      moveEls.push({ g, at: idx(m.at) });
    }
  }
  function colNum(k) { const c = cols.find((x) => x.key === k); return c ? (c.alt ? "もし" : c.n) : "?"; }

  // ------------------------------------------------------------ "if the ring is full": a side branch
  // what runs through these columns is behind a veil: in this branch the Request never
  // reaches the ring, and the app sends it again later
  for (const c of cols) {
    if (c.alt) svg("rect", { x: X[c.key] + 1, y: headBottom - 4, width: W[c.key] - 2, height: height - headBottom, class: "alt-veil" }, gVeil);
  }

  // ------------------------------------------------------------ column hit areas
  for (const c of cols) {
    const hit = svg("rect", { x: X[c.key], y: 0, width: W[c.key], height, class: "colhit", "data-col": c.key }, gHit);
    hit.addEventListener("click", () => opts.onCol && opts.onCol(c.key));
    hit.addEventListener("mouseenter", (e) => {
      hoverBand.setAttribute("x", X[c.key]); hoverBand.setAttribute("width", W[c.key]); hoverBand.classList.add("hover");
      opts.onTip && opts.onTip(e, colTip(c));
    });
    hit.addEventListener("mouseleave", () => { hoverBand.classList.remove("hover"); opts.onTip && opts.onTip(null); });
  }
  function colAt(e) {
    const m = elR.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return cols.find((c) => p.x >= X[c.key] && p.x < X[c.key] + W[c.key])?.key || null;
  }

  // ------------------------------------------------------------ cells
  const cellEls = {};
  for (const c of cols) {
    for (const r of rows) {
      const cell = c.cells[r.id];
      if (!cell || !cell.op) continue;
      const op = OPS[cell.op];
      const g = svg("g", { class: "cell p-" + op.cls, "data-col": c.key, "data-row": r.id }, gCell);
      const ccx = cx(c.key), ccy = Y[r.id].mid;
      if (op.cls === "dot") {
        svg("circle", { cx: ccx, cy: ccy, r: 4.5 }, g);
      } else {
        const text = cellText(cell);
        const mono = op.cls === "word" || op.cls === "zero";
        const bold = op.cls === "red";
        let fs = 11.5;
        let tw = textWidth(text, fs, bold ? 700 : 400, mono);
        const room = W[c.key] - 2;
        if (tw + 10 > room) { fs = 11; tw = textWidth(text, fs, bold ? 700 : 400, mono); }
        if (tw + 10 > room) { fs = 10.5; tw = textWidth(text, fs, bold ? 700 : 400, mono); }
        const pw = Math.max(op.cls === "zero" ? 20 : 24, tw + (tw + 12 > room ? 8 : 12));
        svg("rect", { x: ccx - pw / 2, y: ccy - 9, width: pw, height: 18, rx: 9 }, g);
        svg("text", { x: ccx, y: ccy + 4, "text-anchor": "middle", "font-size": fs, text }, g);
      }
      g.addEventListener("click", (e) => { e.stopPropagation(); opts.onCell && opts.onCell(c.key, r.id); });
      g.addEventListener("mouseenter", (e) => opts.onTip && opts.onTip(e, cellTip(A, J, c, r, cell)));
      g.addEventListener("mouseleave", () => opts.onTip && opts.onTip(null));
      cellEls[c.key + "|" + r.id] = g;
    }
  }

  // ------------------------------------------------------------ the security point, written where it happens
  const sec = cols.find((c) => c.security);
  const ownerRow = rows.find((r) => r.tall);
  if (sec && ownerRow && isUI) {
    const nextOwner = cols.slice(idx(sec.key) + 1).find((c) => c.cells.owner && c.cells.owner.op);
    const x0 = X[sec.key] + 4;
    const x1 = nextOwner ? X[nextOwner.key] - 4 : x0 + 320;
    const top = Y[ownerRow.id].top + 24, hh = 33;
    const g = svg("g", { class: "sec-call cell", "data-col": sec.key, "data-row": ownerRow.id }, gTop);
    svg("rect", { x: x0, y: top, width: x1 - x0, height: hh, rx: 7 }, g);
    svg("path", { d: `M${cx(sec.key) - 6},${top + 0.5} l6,-6 l6,6 z`, fill: "var(--red-line)" }, g);
    const field = ownerRow.text || "";
    const t1 = field.includes("アプリは名乗れない") ? "アプリは名乗れない" : "名乗れない";
    svg("text", { x: x0 + 9, y: top + 14, class: "t1", text: t1 }, g);
    svg("text", { x: x0 + 9, y: top + 28, class: "t2b", text: fitLabel(["何を書いても、呼んだプロセスの pid で上書き", "何を書いても pid で上書き", "pid で上書き"], x1 - x0 - 16, 11.5, 400) }, g);
    g.addEventListener("click", (e) => { e.stopPropagation(); opts.onCell && opts.onCell(sec.key, ownerRow.id); });
  }

  // ------------------------------------------------------------ api
  function select(colKey, rowId) {
    for (const k in stepNum) { stepNum[k].num.classList.remove("colsel-num"); stepNum[k].nt.classList.remove("colsel-t"); }
    for (const k in cellEls) cellEls[k].classList.remove("sel");
    elL.querySelectorAll(".rowlabel").forEach((g) => g.classList.toggle("sel", g.dataset.row === rowId));
    const ci = colKey ? idx(colKey) : -1;
    if (colKey && X[colKey] !== undefined) {
      colBand.setAttribute("x", X[colKey]); colBand.setAttribute("width", W[colKey]); colBand.classList.add("on");
      stepNum[colKey].num.classList.add("colsel-num"); stepNum[colKey].nt.classList.add("colsel-t");
    } else colBand.classList.remove("on");
    for (const b of barEls) { b.g.classList.toggle("on", ci >= 0 && b.a <= ci && ci <= b.b); b.g.classList.toggle("off", ci >= 0 && !(b.a <= ci && ci <= b.b)); }
    for (const m of moveEls) { m.g.classList.toggle("on", ci >= 0 && m.at === ci); m.g.classList.toggle("off", ci >= 0 && m.at !== ci); }
    if (rowId && Y[rowId]) {
      for (const rb of [rowBand, rowBandL]) { rb.setAttribute("y", Y[rowId].top + 1); rb.setAttribute("height", Y[rowId].h - 2); rb.classList.add("on"); }
    } else { rowBand.classList.remove("on"); rowBandL.classList.remove("on"); }
    if (colKey && rowId && cellEls[colKey + "|" + rowId]) cellEls[colKey + "|" + rowId].classList.add("sel");
  }
  return { cols, select, X, W, LW, width, height };
}

// ---------------------------------------------------------------- helpers

export function columnsFor(J, alt) {
  if (!alt || !J.alts.length) return J.cols;
  const out = [];
  for (const c of J.cols) {
    out.push(c);
    if (c.key === J.altAfter) out.push(...J.alts);
  }
  return out;
}

export function cellText(cell) {
  const op = OPS[cell.op];
  if (cell.op === "word") return cell.extra.t;
  if (cell.extra.t && cell.op !== "ride") return cell.extra.t;
  return op.t;
}

function ribbonSegments(r, cols, idx, lastKey) {
  // a ribbon starts where the row first gets a state (or at the start when it
  // persists), changes colour where a cell sets a new state, ends at `until`.
  const segs = [];
  let state = r.persist || null;
  let from = r.persist ? cols[0].key : null;
  let fromEdge = !!r.persist;
  const endKey = r.persist ? lastKey : r.until;
  const endI = endKey && idx(endKey) >= 0 ? idx(endKey) : cols.length - 1;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.alt) continue;
    const cell = c.cells[r.id];
    if (i > endI) break;
    if (cell && cell.state && cell.state !== state) {
      if (state && from) segs.push({ from, to: c.key, state, fromEdge, toEdge: false });
      state = cell.state; from = c.key; fromEdge = false;
    }
    if (i === endI && state && from) {
      segs.push({ from, to: c.key, state, fromEdge, toEdge: !!r.persist });
      state = null;
    }
  }
  return segs;
}

// The names a context can go by, longest first. The table uses the longest one that
// fits every run of that context, so one context always has one name.
function contextLabel(A, J, id) {
  const flow = J.flow;
  const map = { user: "ctx.user", sys: "ctx.syscall", svc: "ctx.service", irq: "ctx.irq" };
  const nid = map[id];
  const reg = (flow.regions || []).find((r) => r.node === nid);
  const title = A.nodes[nid] ? A.nodes[nid].title : id;
  const full = reg ? reg.label : title;
  const short = { user: "アプリ", sys: "OS_CALL", svc: "service", irq: "割り込み" }[id];
  return [full, reg && reg.label3, full.replace(/（.*$/, ""), title.replace(/（.*$/, ""), short];
}

// A column head: one or two lines, made smaller (not cut) until it fits.
function fitHead(lines, maxW, mono) {
  for (const fs of [12, 11, 10.5]) {
    if (lines.every((l) => textWidth(l, fs, 600, mono) <= maxW)) return { lines, fs };
  }
  // still too wide: split the widest line in two
  const out = [];
  for (const l of lines) {
    if (textWidth(l, 10.5, 600, mono) <= maxW) { out.push(l); continue; }
    const half = Math.ceil(l.length / 2);
    out.push(l.slice(0, half), l.slice(half));
  }
  return { lines: out.slice(0, 3), fs: 10.5 };
}

function fitLabel(label, maxW, size, weight, mono) {
  const options = Array.isArray(label) ? label.filter(Boolean) : [label];
  for (const o of options) if (textWidth(o, size, weight, mono) <= maxW) return o;
  let s = options[options.length - 1];
  while (s.length > 1 && textWidth(s + "…", size, weight, mono) > maxW) s = s.slice(0, -1);
  return s.length > 1 ? s + "…" : "";
}

function plainNodeText(A, id) {
  const n = A.nodes[id];
  if (!n) return "";
  return `${n.title}：${String(n.text || "").replace(/!\[\[[^\]]+\]\]/g, "").replace(/\[\[([^\]]+)\]\]/g, (_, x) => (A.nodes[x] ? A.nodes[x].title : x)).trim()}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function colTip(c) {
  const head = c.alt ? "もし満杯なら" : `${c.n}. ${c.verb || (c.head || []).join("") || c.tiny || ""}`;
  return `<b>${escapeHtml(head)}</b><br><span class="q">${escapeHtml(c.label)}</span>${c.colNote ? `<br><span class="k">${escapeHtml(c.colNote)}</span>` : ""}`;
}

function cellTip(A, J, c, r, cell) {
  const op = OPS[cell.op];
  const verb = cell.op === "word" ? `${cell.extra.t} 語目に書く` : cell.op === "zero" ? op.d : (cell.extra.t && cell.op !== "ride" ? `${op.t}（${cell.extra.t}）` : op.t || op.d);
  let s = `<b class="mono">${escapeHtml(r.name)}</b>　${escapeHtml(verb)}`;
  if (op.cls === "cond") s += `<br><span class="k">${escapeHtml(op.d)}</span>`;
  if (cell.extra.v) s += `<br>値：<b>${escapeHtml(cell.extra.v)}</b>`;
  if (cell.extra.why2) s += `<br><span class="k">${escapeHtml(cell.extra.why2)}</span>`;
  s += `<br><span class="q">${escapeHtml(c.label)}</span>`;
  return s;
}
