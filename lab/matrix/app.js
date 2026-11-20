// 関係の行列と弦: the matrix, the chord of layer-to-layer traffic, and the backlinks of a node.
'use strict';
(function () {
  const M = window.MX;
  const { N, ALL, LAYERS, LAYER, WALKS, WALK, KINDS, STEP_KINDS, MORE_KINDS, PRIORITY, RELS, STEP_NOTES, PARTS, OWNER, isCode, stepTag, walkName, countText } = M;
  const CODE = M.CODE;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (s) => document.querySelector(s);

  // ---------- DOM helpers: text always goes in as text nodes ----------
  function put(e, kids) {
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  function setAttrs(e, attrs) {
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.setAttribute('class', v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) e.style.setProperty(p, x); else e.style[p] = x; }
      else e.setAttribute(k, v === true ? '' : v);
    }
    return e;
  }
  const h = (tag, attrs, ...kids) => put(setAttrs(document.createElement(tag), attrs), kids);
  const sv = (tag, attrs, ...kids) => put(setAttrs(document.createElementNS(SVGNS, tag), attrs), kids);
  const fill = (e, ...kids) => { e.replaceChildren(); return put(e, kids); };

  const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif';
  const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
  const ctx2d = document.createElement('canvas').getContext('2d');
  const wCache = new Map();
  function textW(str, font) {
    const key = font + '\u0000' + str;
    if (!wCache.has(key)) { ctx2d.font = font; wCache.set(key, ctx2d.measureText(str).width); }
    return wCache.get(key);
  }
  // the longest start of a label that fits a width, ended with an ellipsis (the whole name is in
  // the tooltip and the panel)
  function fitText(str, font, maxW) {
    if (!(maxW < Infinity) || textW(str, font) <= maxW) return str;
    const chars = [...str];
    let lo = 1, hi = chars.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (textW(chars.slice(0, mid).join('').trimEnd() + '…', font) <= maxW) lo = mid; else hi = mid - 1;
    }
    return chars.slice(0, lo).join('').trimEnd() + '…';
  }
  const ROW_FONT = (id) => (isCode(N[id].title) ? `11.5px ${MONO}` : `12px ${SANS}`);
  const COL_FONT = (id) => (isCode(N[id].title) ? `11px ${MONO}` : `11px ${SANS}`);
  const layerVar = (id) => `var(--l-${id})`;
  const title = (id) => N[id].title;
  const KIND_NAME = { func: '関数', store: '置き場', schema: '構造体', enum: '列挙', context: '実行の文脈', hw: 'ハードウェア', note: '方針', figure: '図' };
  const CAUSE = { timer: 'タイマー', keyboard: 'キーボード', syscall: 'syscall', automation: '自動操作' };

  // ---------- marks: one shape per kind ----------
  function markEls(kind, P) {
    const c = P / 2;
    switch (kind) {
      case 'call': return sv('rect', { class: 'm-call', x: c - 3.6, y: c - 3.6, width: 7.2, height: 7.2, rx: 1.4 });
      case 'syscall': return sv('rect', { class: 'm-syscall', x: c - 4.8, y: c - 4.8, width: 9.6, height: 9.6, rx: 1.6 });
      case 'return': return sv('rect', { class: 'm-return', x: c - 3, y: c - 3, width: 6, height: 6, rx: 0.8 });
      case 'write': return sv('rect', { class: 'm-write', x: c - 4.6, y: c - 2.3, width: 9.2, height: 4.6, rx: 1 });
      case 'read': return sv('rect', { class: 'm-read', x: c - 4.1, y: c - 1.9, width: 8.2, height: 3.8, rx: 0.8 });
      case 'msg': return sv('path', { class: 'm-msg', d: `M${c} ${c - 4.9}L${c + 4.9} ${c}L${c} ${c + 4.9}L${c - 4.9} ${c}Z` });
      case 'signal': return sv('circle', { class: 'm-signal', cx: c, cy: c, r: 4 });
      case 'shape': return sv('circle', { class: 'm-shape', cx: c, cy: c, r: 3.3 });
      case 'context': return sv('rect', { class: 'm-context', x: c - 4.3, y: c - 4.3, width: 8.6, height: 8.6, rx: 1 });
      case 'mention': return sv('circle', { class: 'm-mention', cx: c, cy: c, r: 2.3 });
      case 'paper': return sv('rect', { class: 'wash', x: 1, y: 1, width: P - 2, height: P - 2, rx: 2 });
    }
    return null;
  }
  function glyph(kind, size = 14) {
    return sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', class: 'cell' }, markEls(kind, size));
  }

  // ---------- state ----------
  const state = {
    order: 'layer',
    open: new Set(),        // owners whose folded parts have rows of their own
    walkOpened: new Set(),  // owners a walk opened; folded again when the walk ends
    kinds: new Set([...STEP_KINDS, 'paper']),
    sel: null,
    walk: null,
    cur: null,
    hover: null,       // { r, c } ids of the hovered cell, or { r } / { c } for a label
    focus: null,       // { keys:Set, ring } cells to emphasise (chord, legend, a reason in the panel)
    pick: null,        // cell key picked by a click
    chordMode: 'step',
    tab: 'walk',
    search: '',
    more: false,       // the node's prose shown in full
  };

  // ---------- visibility, cells ----------
  const vis = (id) => (OWNER[id] && !state.open.has(OWNER[id]) ? OWNER[id] : id);
  const relOn = (r) => state.kinds.has(r.k);
  const keyOf = (r) => vis(r.from) + '|' + vis(r.to);

  function visibleList() {
    const out = [];
    ALL.forEach((id) => {
      if (OWNER[id]) return;
      out.push(id);
      if (PARTS[id] && state.open.has(id)) out.push(...PARTS[id]);
    });
    return out;
  }

  let CELLS = new Map(); // key "r|c" -> { r, c, rels: [] }
  function buildCells() {
    CELLS = new Map();
    RELS.forEach((r) => {
      if (!relOn(r)) return;
      const a = vis(r.from), b = vis(r.to);
      const key = a + '|' + b;
      if (!CELLS.has(key)) CELLS.set(key, { key, r: a, c: b, rels: [] });
      CELLS.get(key).rels.push(r);
    });
    CELLS.forEach((cell) => {
      cell.rels.sort((x, y) => rank(x) - rank(y));
      const ks = new Set(cell.rels.map((r) => r.k));
      cell.wash = ks.has('paper');
      cell.main = PRIORITY.find((k) => ks.has(k)) || null;
      cell.diag = cell.r === cell.c;
    });
  }
  const rank = (r) => (r.k === 'paper' ? PRIORITY.length : PRIORITY.indexOf(r.k));
  // every relation between the two nodes of a cell, shown in the matrix or not
  const relsOfCell = (r, c) => RELS.filter((x) => vis(x.from) === r && vis(x.to) === c).sort((a, b) => rank(a) - rank(b));

  // ---------- grouping: by layer, or by clusters of related nodes ----------
  function groupsByLayer(list) {
    return LAYERS.map((l) => ({ id: l.id, name: l.name, sub: l.cross ? '' : l.sub, layer: l.id, nodes: list.filter((id) => N[id].layer === l.id) }))
      .filter((g) => g.nodes.length);
  }
  const CL_W = { call: 3, syscall: 3, return: 3, msg: 3, signal: 3, write: 3, read: 3, paper: 2, shape: 1, mention: 1, context: 0.5 };
  function groupsByCluster(list) {
    const edges = new Map();
    const deg = new Map(list.map((id) => [id, 0]));
    RELS.forEach((r) => {
      if (!relOn(r) || !CL_W[r.k]) return;
      let a = vis(r.from), b = vis(r.to);
      if (a === b) return;
      if (a > b) [a, b] = [b, a];
      const key = a + '|' + b;
      edges.set(key, (edges.get(key) || 0) + CL_W[r.k]);
      deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1);
    });
    const linked = list.filter((id) => deg.get(id) > 0);
    const lone = list.filter((id) => deg.get(id) === 0);
    const comms = M.louvain(linked, edges);
    const pos0 = new Map(list.map((id, i) => [id, i]));
    const meanLi = (ns) => ns.reduce((s, id) => s + N[id].li, 0) / ns.length;
    comms.forEach((ns) => ns.sort((a, b) => pos0.get(a) - pos0.get(b)));
    comms.sort((a, b) => meanLi(a) - meanLi(b) || b.length - a.length);
    const names = clusterNames(comms, deg);
    const groups = comms.map((ns, i) => ({ id: 'c' + i, cluster: true, nodes: ns, name: names[i], sub: '' }));
    // linked by none of the kinds shown (they may be linked by a hidden kind)
    if (lone.length) groups.push({ id: 'lone', cluster: true, nodes: lone, name: '出している関係なし', sub: '' });
    return groups;
  }
  // A cluster takes the name of a flow or a paper only when most of the walk lies inside it and
  // the walk covers most of it (each name used once); otherwise its best-connected node names it.
  function clusterNames(comms, deg) {
    const pairs = [];
    comms.forEach((ns, ci) => WALKS.forEach((w) => {
      const inW = new Set(w.boxes.map((b) => vis(b.node)));
      const inside = ns.filter((id) => inW.has(id)).length;
      if (inside >= 2 && inside >= ns.length * 0.5 && inside >= inW.size * 0.6) pairs.push({ ci, w, score: inside / ns.length + inside / inW.size, inside });
    }));
    pairs.sort((a, b) => b.score - a.score || b.inside - a.inside);
    const names = comms.map(() => null);
    const used = new Set();
    pairs.forEach(({ ci, w }) => {
      if (names[ci] || used.has(w.id)) return;
      names[ci] = w.type === 'flow' ? `流れ「${w.tab}」` : `「${w.tab}」の中`;
      used.add(w.id);
    });
    comms.forEach((ns, ci) => {
      if (names[ci]) return;
      const hub = ns.slice().sort((a, b) => deg.get(b) - deg.get(a) || N[a].li - N[b].li)[0];
      names[ci] = `${title(hub)} のまわり`;
    });
    return names;
  }

  // ---------- layout ----------
  const BAND = 12;       // between column labels and the body: the layer colour band
  const GAP = 4;         // between groups
  let L = null;          // current layout
  const foldW = (id) => (PARTS[id] ? textW(`▸ ${PARTS[id].length}`, `11px ${SANS}`) + 6 : 0);
  // the corner (how to read, the legend) needs this much height at a width
  const cornerCache = new Map();
  function cornerNeed(w) {
    if (cornerCache.has(w)) return cornerCache.get(w);
    const corner = $('#mx-corner');
    const old = corner.style.width;
    corner.style.width = w + 'px';
    const kids = [...corner.children].filter((e) => getComputedStyle(e).display !== 'none');
    const last = kids[kids.length - 1];
    const need = last ? Math.ceil(last.offsetTop + last.offsetHeight + 8) : 0;
    corner.style.width = old;
    cornerCache.set(w, need);
    return need;
  }
  function layout() {
    cornerCache.clear();
    const list = visibleList();
    const groups = state.order === 'cluster' ? groupsByCluster(list) : groupsByLayer(list);
    const rows = list.length;
    const phone = window.innerWidth <= 560;
    const stacked = window.innerWidth <= 1180;
    const names = !phone;
    const gaps = GAP * (groups.length - 1);
    const layerGroups = groupsByLayer(list);
    const nameW = (g) => textW(g.name, `700 12px ${SANS}`) + 28;
    // the sizes for a pitch and the longest row and column labels allowed; a layer's name sits on
    // the first row of its group, or (any) on the first row it fits beside
    function measure(P, rowMax, colMax, any) {
      const tw = (id) => Math.min(textW(title(id), ROW_FONT(id)), rowMax);
      const rowNeed = (id) => tw(id) + foldW(id);
      let colLen = 0, need = 0;
      list.forEach((id) => {
        colLen = Math.max(colLen, Math.min(textW(title(id), COL_FONT(id)), colMax));
        need = Math.max(need, rowNeed(id));
      });
      let rowsW = Math.ceil(need + 24);
      if (names) {
        let nameNeed = 0;
        layerGroups.forEach((g) => { nameNeed = Math.max(nameNeed, nameW(g) + (any ? Math.min(...g.nodes.map(rowNeed)) : rowNeed(g.nodes[0]))); });
        rowsW = Math.ceil(Math.max(need + 26, nameNeed) + 10);
      }
      const colsH = Math.max(Math.ceil(colLen) + 8 + BAND, cornerNeed(rowsW));
      const size = rows * P + gaps;
      return { P, rowMax, colMax, colsH, rowsW, size, w: rowsW + size + 6, h: colsH + size + 4 };
    }
    let m;
    if (stacked) m = measure(14, phone ? 118 : Infinity, phone ? 120 : Infinity, false);
    else {
      const availH = window.innerHeight - 20;
      const availW = window.innerWidth - (window.innerWidth >= 1400 ? 400 : 350) - 14 - 18 - 18;
      const full = measure(13, Infinity, Infinity, false);
      const P0 = Math.max(13, Math.min(16, Math.floor((availH - full.colsH - 4 - gaps) / rows)));
      // Whole row names first, then whole column names, then the pitch that fills the height
      // (13-16px, else 12px), then layer names beside a shorter row. Labels are only shortened
      // when that makes the matrix fit; otherwise it keeps whole names and scrolls.
      const tries = [];
      for (const rowMax of [Infinity, 170, 150, 135, 120]) for (const colMax of [Infinity, 150, 128]) for (const P of [...new Set([P0, 13, 12])]) for (const any of [false, true]) tries.push([P, rowMax, colMax, any]);
      const first = (ok) => { for (const t of tries) { const x = measure(...t); if (ok(x)) return x; } return null; };
      m = first((x) => x.w <= availW && x.h <= availH)
        || first((x) => x.w <= availW && x.colMax === Infinity)
        || measure(12, Infinity, Infinity, true);
    }
    const { P, rowMax, colMax, colsH, rowsW } = m;
    const rowText = {}, colText = {};
    list.forEach((id) => { rowText[id] = fitText(title(id), ROW_FONT(id), rowMax); colText[id] = fitText(title(id), COL_FONT(id), colMax); });
    // positions (centres) along both axes
    const pos = {};
    let off = 0;
    groups.forEach((g, gi) => {
      if (gi) off += GAP;
      g.start = off;
      g.nodes.forEach((id) => { pos[id] = off + P / 2; off += P; });
      g.end = off;
      g.gi = gi;
    });
    const size = off;
    const index = list.slice().sort((a, b) => pos[a] - pos[b]);
    const spans = index.map((id) => [pos[id] - P / 2, pos[id] + P / 2, id]);
    const tw = (id) => textW(rowText[id], ROW_FONT(id));
    L = { list, groups, P, pos, size, colsH, rowsW, spans, foldW, tw, rowText, colText, names, phone };
    return L;
  }
  function idAt(x) {
    for (const [a, b, id] of L.spans) if (x >= a && x < b) return id;
    return null;
  }

  // ---------- rendering: the matrix ----------
  const elRows = $('#mx-rows'), elCols = $('#mx-cols'), elBody = $('#mx-body'), elCorner = $('#mx-corner'), elGrid = $('#mx-grid');
  const gBodyBack = sv('g'), gBands = sv('g'), gCells = sv('g'), gGhost = sv('g'), gWalk = sv('g', { class: 'walk' }), gTop = sv('g');
  const hit = sv('rect', { class: 'hit', fill: 'transparent' });
  elBody.append(gBodyBack, gBands, gCells, gGhost, gWalk, gTop, hit);
  const gRowBack = sv('g'), gRowLabels = sv('g');
  elRows.append(gRowBack, gRowLabels);
  const gColBack = sv('g'), gColLabels = sv('g');
  elCols.append(gColBack, gColLabels);
  const T = 520; // ms for layout moves

  function render(animate) {
    const old = L;
    // how to read the picture depends on the order (set first: the corner's height depends on it)
    $('#read').textContent = state.order === 'cluster'
      ? '点線の四角は、関係の多い節のまとまり。'
      : '右上は上の層から下の層へ、左下は下の層から上へ。';
    layout();
    buildCells();
    const { size, colsH, rowsW } = L;
    elGrid.style.gridTemplateColumns = `${rowsW}px ${size + 4}px`;
    elGrid.style.gridTemplateRows = `${colsH}px ${size + 2}px`;
    for (const [e, w, hh] of [[elRows, rowsW, size + 2], [elCols, size + 4, colsH], [elBody, size + 4, size + 2]]) {
      e.setAttribute('width', w); e.setAttribute('height', hh);
    }
    elCorner.style.width = rowsW + 'px';
    elCorner.style.height = colsH + 'px';
    hit.setAttribute('width', size); hit.setAttribute('height', size);
    const dur = animate && old ? T : 0;
    drawBack();
    if (dur) {
      // the blocks, bands and group names arrive with the moving rows instead of jumping
      for (const g of [gBodyBack, gColBack, gRowBack]) {
        g.style.transition = 'none'; g.style.opacity = '0';
        g.getBoundingClientRect();
        g.style.transition = `opacity ${dur}ms ease ${dur * 0.35}ms`; g.style.opacity = '1';
      }
    }
    drawRowLabels(dur);
    drawColLabels(dur);
    drawCells(dur);
    updateHighlights();
    drawWalk(dur);
    renderPanel();
    requestAnimationFrame(() => syncEdges());
    setTimeout(() => syncEdges(), dur + 60);
  }

  function drawBack() {
    const { groups, P, colsH } = L;
    gBodyBack.replaceChildren();
    gColBack.replaceChildren();
    gRowBack.replaceChildren();
    const grid = [];
    groups.forEach((gr) => groups.forEach((gc) => {
      const x = gc.start, y = gr.start, w = gc.end - gc.start, hh = gr.end - gr.start;
      const diag = gr === gc;
      const attrs = { x, y, width: w, height: hh, class: 'blk' + (diag ? ' diag' : '') };
      if (diag && gr.layer) attrs.style = `fill:${layerVar(gr.layer)};fill-opacity:var(--tint)`;
      else if (diag && gr.id !== 'lone') attrs.style = 'fill:var(--accent);fill-opacity:0.05';
      gBodyBack.append(sv('rect', attrs));
      for (let k = 1; k < gr.nodes.length; k++) grid.push(`M${x} ${y + k * P + 0.5}h${w}`);
      for (let k = 1; k < gc.nodes.length; k++) grid.push(`M${x + k * P + 0.5} ${y}v${hh}`);
      grid.push(`M${x} ${y + 0.5}h${w}M${x} ${y + hh - 0.5}h${w}M${x + 0.5} ${y}v${hh}M${x + w - 0.5} ${y}v${hh}`);
    }));
    gBodyBack.append(sv('path', { class: 'gridline', d: grid.join('') }));
    // the diagonal: a node meets itself there
    const diag = [];
    L.list.forEach((id) => { const p = L.pos[id] - P / 2; diag.push(`M${p} ${p}h${P}v${P}h${-P}Z`); });
    gBodyBack.append(sv('path', { class: 'diag-cell', d: diag.join('') }));
    if (state.order === 'cluster') groups.forEach((g) => {
      if (g.id === 'lone') return;  // not a cluster: what is left
      gBodyBack.append(sv('rect', { class: 'cluster-box', x: g.start - 1.5, y: g.start - 1.5, width: g.end - g.start + 3, height: g.end - g.start + 3, rx: 3 }));
    });
    // colour bands for layers (by group) or per node in cluster order
    const by = colsH - BAND + 4;
    if (state.order === 'layer') {
      groups.forEach((g) => {
        gColBack.append(sv('rect', { x: g.start, y: by, width: g.end - g.start, height: 5, rx: 2, style: `fill:${layerVar(g.layer)}` }));
        gRowBack.append(sv('rect', { class: 'grp-bar', x: 0, y: g.start, width: 5, height: g.end - g.start, rx: 2, style: `fill:${layerVar(g.layer)}` }));
      });
    } else {
      L.list.forEach((id) => {
        const p = L.pos[id] - P / 2;
        gColBack.append(sv('rect', { x: p + 1, y: by, width: P - 2, height: 5, rx: 1.5, style: `fill:${layerVar(N[id].layer)}` }));
        gRowBack.append(sv('rect', { x: 0, y: p + 1, width: 5, height: P - 2, rx: 1.5, style: `fill:${layerVar(N[id].layer)}` }));
      });
    }
    // group names on the left, on the first row where they do not meet the row's title
    if (!L.names) return;
    groups.forEach((g) => {
      const font = `700 12px ${SANS}`;
      const nw = textW(g.name, font);
      let at = -1, name = g.name;
      for (let k = 0; k < g.nodes.length && at < 0; k++) {
        const id = g.nodes[k];
        if (nw + 28 + L.tw(id) + L.foldW(id) <= L.rowsW - 9) at = k;
      }
      if (at < 0) {
        // no row leaves room for the whole name: beside the shortest title, shortened
        let bw = Infinity;
        g.nodes.forEach((id, k) => { const w = L.tw(id) + L.foldW(id); if (w < bw) { bw = w; at = k; } });
        name = fitText(g.name, font, Math.max(24, L.rowsW - 9 - 28 - bw));
      }
      const y = g.start + at * P + P / 2;
      const t = sv('text', { class: 'grp-name', x: 12, y, dy: '0.35em' }, name);
      if (name !== g.name) t.append(sv('title', {}, g.name));
      gRowBack.append(t);
      if (g.sub && g.nodes.length >= at + 2) {
        const id2 = g.nodes[at + 1];
        const sw = textW(g.sub, `11px ${SANS}`);
        if (sw + 28 + L.tw(id2) + L.foldW(id2) <= L.rowsW - 9) gRowBack.append(sv('text', { class: 'grp-sub', x: 12, y: y + P, dy: '0.35em' }, g.sub));
      }
    });
  }

  function labelClasses(id, base) {
    const cls = [base];
    if (OWNER[id]) cls.push('part');
    if (PARTS[id] && state.open.has(id)) cls.push('is-open');
    return cls.join(' ');
  }

  function drawRowLabels(dur) {
    const { P, rowsW, list, pos } = L;
    const sel = d3.select(gRowLabels).selectAll('g.rl').data(list, (d) => d);
    sel.exit().transition().duration(dur ? 200 : 0).style('opacity', 0).remove();
    const enter = sel.enter().append('g').attr('class', 'rl').attr('data-id', (d) => d)
      .attr('transform', (d) => `translate(0,${(L.pos[OWNER[d]] || pos[d]) - P / 2})`)
      .style('opacity', 0);
    enter.each(function (id) {
      const g = this;
      g.append(sv('rect', { class: 'hit', x: 0, y: 0, height: P }));
      g.append(sv('rect', { class: 'chip', y: 1, height: P - 2, rx: 3 }));
      g.append(sv('text', { class: isCode(title(id)) ? 'code tt' : 'tt', dy: '0.35em' }));
      if (PARTS[id]) {
        const f = sv('text', { class: 'fold', dy: '0.35em', 'text-anchor': 'end' });
        f.addEventListener('click', (ev) => { ev.stopPropagation(); toggleOpen(id); });
        g.append(f);
      }
      g.addEventListener('mouseenter', (ev) => { state.hover = { r: id }; updateHighlights(); showTipForLabel(id, ev); });
      g.addEventListener('mousemove', placeTip);
      g.addEventListener('mouseleave', () => { state.hover = null; updateHighlights(); hideTip(); });
      g.addEventListener('click', () => selectNode(id, { scroll: false }));
    });
    const all = enter.merge(sel);
    all.attr('class', (d) => labelClasses(d, 'rl'));
    all.each(function (id) {
      const fw = L.foldW(id);
      const label = L.rowText[id];
      const tw = L.tw(id);
      const xEnd = rowsW - 8 - fw;
      const g = this;
      g.querySelector('.hit').setAttribute('width', rowsW);
      g.querySelector('.hit').setAttribute('height', P);
      const chip = g.querySelector('.chip');
      chip.setAttribute('x', xEnd - tw - 4); chip.setAttribute('width', tw + fw + 8); chip.setAttribute('height', P - 2);
      const t = g.querySelector('.tt');
      if (t.textContent !== label) t.textContent = label;
      t.setAttribute('x', xEnd); t.setAttribute('y', P / 2); t.setAttribute('text-anchor', 'end');
      // how much the name may grow on hover without leaving the label column
      g.style.setProperty('--zoom', Math.max(1, Math.min(1.18, (xEnd - 4) / (tw + 4))).toFixed(3));
      const f = g.querySelector('.fold');
      if (f) { f.textContent = (state.open.has(id) ? '▾ ' : '▸ ') + PARTS[id].length; f.setAttribute('x', rowsW - 8); f.setAttribute('y', P / 2); }
    });
    all.transition().duration(dur).ease(d3.easeCubicInOut).style('opacity', 1)
      .attr('transform', (d) => `translate(0,${pos[d] - P / 2})`);
    // tree lines from an open owner to its parts
    d3.select(gRowLabels).selectAll('path.tree').remove();
    state.open.forEach((o) => {
      if (!PARTS[o] || pos[o] == null) return;
      const last = PARTS[o][PARTS[o].length - 1];
      const x = rowsW - 3;
      let d = `M${x} ${pos[o] + 3}V${pos[last]}`;
      PARTS[o].forEach((p) => { d += `M${x} ${pos[p]}h-3`; });
      const path = sv('path', { class: 'tree', d });
      path.style.opacity = 0;
      gRowLabels.append(path);
      d3.select(path).transition().delay(dur).duration(160).style('opacity', 1);
    });
  }

  function drawColLabels(dur) {
    const { P, colsH, list, pos } = L;
    const y = colsH - BAND - 3;
    const sel = d3.select(gColLabels).selectAll('g.cl').data(list, (d) => d);
    sel.exit().transition().duration(dur ? 200 : 0).style('opacity', 0).remove();
    const enter = sel.enter().append('g').attr('class', 'cl').attr('data-id', (d) => d)
      .attr('transform', (d) => `translate(${(L.pos[OWNER[d]] || pos[d]) - P / 2},0)`).style('opacity', 0);
    enter.each(function (id) {
      const g = this;
      g.append(sv('rect', { class: 'hit', x: 0, y: 0 }));
      g.append(sv('rect', { class: 'chip', x: 1, rx: 3 }));
      g.append(sv('text', { class: isCode(title(id)) ? 'code tt' : 'tt', 'writing-mode': 'vertical-rl', 'text-anchor': 'end' }));
      g.addEventListener('mouseenter', (ev) => { state.hover = { c: id }; updateHighlights(); showTipForLabel(id, ev); });
      g.addEventListener('mousemove', placeTip);
      g.addEventListener('mouseleave', () => { state.hover = null; updateHighlights(); hideTip(); });
      g.addEventListener('click', () => selectNode(id, { scroll: false }));
    });
    const all = enter.merge(sel);
    all.attr('class', (d) => labelClasses(d, 'cl'));
    all.each(function (id) {
      const label = L.colText[id];
      const len = textW(label, COL_FONT(id));
      const g = this;
      const hitR = g.querySelector('.hit');
      hitR.setAttribute('width', P); hitR.setAttribute('height', colsH - BAND + 2);
      const chip = g.querySelector('.chip');
      chip.setAttribute('y', y - len - 4); chip.setAttribute('height', len + 8); chip.setAttribute('width', P - 2);
      const t = g.querySelector('.tt');
      if (t.textContent !== label) t.textContent = label;
      t.setAttribute('x', P / 2); t.setAttribute('y', y);
      g.style.setProperty('--zoom', Math.max(1, Math.min(1.18, (y + 4) / (len + 8))).toFixed(3));
    });
    all.transition().duration(dur).ease(d3.easeCubicInOut).style('opacity', 1)
      .attr('transform', (d) => `translate(${pos[d] - P / 2},0)`);
  }

  function drawCells(dur) {
    const { P, pos } = L;
    const data = [...CELLS.values()].filter((c) => pos[c.r] != null && pos[c.c] != null);
    const sel = d3.select(gCells).selectAll('g.cell').data(data, (d) => d.key);
    sel.exit().transition().duration(dur ? 180 : 0).style('opacity', 0).remove();
    const enter = sel.enter().append('g').attr('class', 'cell')
      .attr('transform', (d) => `translate(${pos[d.c] - P / 2},${pos[d.r] - P / 2})`).style('opacity', 0);
    const all = enter.merge(sel);
    all.each(function (cell) {
      const g = this;
      g.replaceChildren();
      if (cell.diag) {
        // a folded owner: the relations among its parts, counted
        const inner = cell.rels.filter((r) => r.k !== 'paper').length;
        g.append(markEls('paper', P));
        if (inner) g.append(sv('text', { class: 'inner-n', x: P / 2, y: P / 2, dy: '0.36em' }, inner > 99 ? '99' : String(inner)));
      } else {
        if (cell.wash) g.append(markEls('paper', P));
        if (cell.main) g.append(markEls(cell.main, P));
      }
      g.append(sv('rect', { class: 'pick', x: 0.5, y: 0.5, width: P - 1, height: P - 1, rx: 2.5, fill: 'none' }));
    });
    all.attr('data-key', (d) => d.key);
    all.transition().duration(dur).ease(d3.easeCubicInOut).style('opacity', null)
      .attr('transform', (d) => `translate(${pos[d.c] - P / 2},${pos[d.r] - P / 2})`);
  }

  // ---------- highlights: crosshair, selection, focus ----------
  function band(cls, axis, id) {
    const { P, pos, size } = L;
    if (pos[id] == null) return null;
    const p = pos[id] - P / 2;
    return axis === 'r' ? sv('rect', { class: 'band ' + cls, x: 0, y: p, width: size, height: P })
      : sv('rect', { class: 'band ' + cls, x: p, y: 0, width: P, height: size });
  }
  function updateHighlights() {
    if (!L) return;
    gBands.replaceChildren();
    const hv = state.hover;
    const sel = state.sel && L.pos[vis(state.sel)] != null ? vis(state.sel) : null;
    if (sel && !state.walk) { gBands.append(band('', 'r', sel)); gBands.append(band('', 'c', sel)); }
    if (state.walk && state.cur != null) {
      const st = WALK[state.walk].steps[state.cur];
      gBands.append(band('hot', 'r', vis(st.r))); gBands.append(band('hot', 'c', vis(st.c)));
    }
    if (hv) {
      if (hv.r) gBands.append(band('hot', 'r', hv.r));
      if (hv.c) gBands.append(band('hot', 'c', hv.c));
    }
    const hot = new Set([hv && hv.r, hv && hv.c].filter(Boolean));
    // the two nodes of the current step stand out in the labels too
    const curNodes = new Set();
    if (state.walk && state.cur != null) {
      const st = WALK[state.walk].steps[state.cur];
      curNodes.add(vis(st.r)); curNodes.add(vis(st.c));
    }
    // a label hovered: the same node is highlighted on the other axis too
    if (hv && hv.r && !hv.c) hot.add(hv.r);
    if (hv && hv.c && !hv.r) hot.add(hv.c);
    const walkNodes = state.walk ? new Set(WALK[state.walk].steps.flatMap((s) => [vis(s.fromNode), vis(s.toNode)])) : null;
    const q = state.search.trim().toLowerCase();
    const matches = q ? new Set(ALL.filter((id) => matchNode(id, q)).map(vis)) : null;
    for (const g of [...gRowLabels.querySelectorAll('g.rl'), ...gColLabels.querySelectorAll('g.cl')]) {
      const id = g.dataset.id;
      g.classList.toggle('is-hot', hot.has(id) && id !== sel);
      g.classList.toggle('is-cur', curNodes.has(id) && !hot.has(id) && id !== sel);
      g.classList.toggle('is-sel', id === sel);
      g.classList.toggle('is-walk', !!walkNodes && walkNodes.has(id));
      g.classList.toggle('is-dim', !!walkNodes && !walkNodes.has(id) && id !== sel);
      g.classList.toggle('is-match', !!matches && matches.has(id) && id !== sel);
      // the hovered label is drawn last, so its enlarged name lies on top of its neighbours
      if (hot.has(id) && g.nextSibling && !g.nextSibling.matches('path.tree')) g.parentNode.append(g);
    }
    // focus: from the chord, the legend, a reason in the panel, or the active flow
    let keys = null;
    if (state.focus) keys = state.focus.keys;
    else if (state.walk) keys = walkKeys(WALK[state.walk]);
    elBody.classList.toggle('is-focus', !!keys);
    const ring = !!(state.focus && state.focus.ring);
    for (const g of gCells.querySelectorAll('g.cell')) {
      const k = g.dataset.key;
      g.classList.toggle('is-on', !!keys && keys.has(k));
      g.classList.toggle('is-ring', ring && keys.has(k));
      g.classList.toggle('is-pick', state.pick === k);
    }
    // a ring also where a relation of a hidden kind would be
    gGhost.replaceChildren();
    const P = L.P;
    if (ring) keys.forEach((k) => {
      if (CELLS.has(k)) return;
      const [r, c] = k.split('|');
      if (L.pos[r] == null || L.pos[c] == null) return;
      gGhost.append(sv('rect', { class: 'ghost-ring', x: L.pos[c] - P / 2 + 0.5, y: L.pos[r] - P / 2 + 0.5, width: P - 1, height: P - 1, rx: 2.5 }));
    });
  }
  function walkKeys(w) {
    const keys = new Set();
    w.steps.forEach((s) => keys.add(vis(s.r) + '|' + vis(s.c)));
    return keys;
  }
  function matchNode(id, q) {
    const n = N[id];
    return n.title.toLowerCase().includes(q) || id.toLowerCase().includes(q) || (n.fn || '').toLowerCase().includes(q)
      || (n.code && n.code[1] && String(n.code[1]).toLowerCase().includes(q));
  }

  // ---------- the walk of a flow: steps as L shapes that bounce off the diagonal ----------
  // Each step leaves its source on the diagonal and turns at its cell (who acts, on what) to reach
  // its target on the diagonal, where the next step leaves from. A read turns the other way round,
  // since its cell is in the reader's row.
  let walkToken = 0;
  function drawWalk(dur) {
    const token = ++walkToken;
    gWalk.replaceChildren();
    gTop.replaceChildren();
    callout.hidden = true;
    if (!state.walk || !L) return;
    const w = WALK[state.walk];
    const { pos, P } = L;
    const p = (id) => pos[vis(id)];
    const show = () => {
      if (token !== walkToken || state.walk !== w.id) return;
      gWalk.replaceChildren();
      gTop.replaceChildren();
      const stations = new Set();
      const curK = state.cur == null ? -1 : w.order.indexOf(state.cur);
      const cur = state.cur != null ? w.steps[state.cur] : null;
      // an alternative is drawn in full only around the step it replaces; elsewhere it is faint
      const near = (s) => !s.alt || (cur && (cur === s || cur.i === s.alt.at || (cur.alt && cur.alt.at === s.alt.at)));
      const off = (s) => (s.alt ? Math.round(P * 0.45) : 0);
      const leg = (s) => {
        const a = p(s.fromNode), b = p(s.toNode), o = off(s);
        return s.rev ? `M${a + o} ${a + o}V${b + o}H${b + o}` : `M${a + o} ${a + o}H${b + o}V${b + o}`;
      };
      const all = sv('g', { class: 'legs' });
      gWalk.append(all);
      let prevMain = null;
      w.order.forEach((i, k) => {
        const s = w.steps[i];
        if (p(s.fromNode) == null || p(s.toNode) == null) return;
        const stateCls = curK < 0 ? 'done' : k < curK ? 'done' : k === curK ? 'cur' : 'todo';
        // a jump: the story goes on from another node
        if (!s.alt && prevMain && vis(prevMain.toNode) !== vis(s.fromNode)) {
          const q = p(prevMain.toNode), a = p(s.fromNode);
          all.append(sv('path', { class: 'walk-jump ' + stateCls, d: `M${q} ${q}L${a} ${a}` }));
        }
        if (!s.alt) prevMain = s;
        all.append(sv('path', { class: `walk-path ${s.alt ? 'alt' + (near(s) ? ' near' : ' far') : 'main'} ${stateCls}`, d: leg(s), 'data-i': i }));
        stations.add(vis(s.fromNode)); stations.add(vis(s.toNode));
      });
      if (dur !== 0) {
        // draw the walk in, step by step
        const legs = [...all.querySelectorAll('path.walk-path.main')];
        let t = 0;
        legs.forEach((path) => {
          const len = path.getTotalLength();
          path.style.strokeDasharray = `${len} ${len}`;
          path.style.strokeDashoffset = len;
          path.getBoundingClientRect();
          const d = Math.max(90, Math.min(260, len * 1.2));
          path.style.transition = `stroke-dashoffset ${d}ms linear ${t}ms`;
          path.style.strokeDashoffset = 0;
          t += d;
          setTimeout(() => { path.style.strokeDasharray = ''; path.style.transition = ''; }, t + 40);
        });
      }
      stations.forEach((id) => gWalk.append(sv('circle', { class: 'walk-station', cx: pos[id], cy: pos[id], r: 3.2 })));
      const first = w.steps[w.order[0]];
      if (first) gWalk.append(sv('circle', { class: 'walk-start', cx: p(first.fromNode), cy: p(first.fromNode), r: 4.4 }));
      if (cur) {
        const o = off(cur);
        const x = p(cur.c) - P / 2 + o, y = p(cur.r) - P / 2 + o;
        gTop.append(sv('rect', { class: 'cur-ring', x: x - 3, y: y - 3, width: P + 6, height: P + 6, rx: 5 }));
      }
      drawCallout();
      const seen = new Map();
      w.order.forEach((i, k) => {
        const s = w.steps[i];
        const o = off(s);
        const cx = p(s.c) + o, cy = p(s.r) + o;
        if (Number.isNaN(cx) || Number.isNaN(cy)) return;
        const key = Math.round(cx) + ',' + Math.round(cy);
        const n = seen.get(key) || 0; seen.set(key, n + 1);
        const stateCls = curK < 0 ? '' : k < curK ? ' done' : k === curK ? ' is-cur' : ' todo';
        const g = sv('g', { class: 'badge' + (s.alt ? ' alt' + (near(s) ? '' : ' far') : '') + stateCls, transform: `translate(${cx + n * 14},${cy})`, 'data-i': i },
          sv('circle', { r: 7.6 }),
          sv('text', {}, s.alt ? s.altNo : String(s.no)));
        g.addEventListener('click', (ev) => { ev.stopPropagation(); setStep(i); });
        g.addEventListener('mouseenter', (ev) => { showTipForStep(w, s, ev); });
        g.addEventListener('mousemove', (ev) => placeTip(ev));
        g.addEventListener('mouseleave', hideTip);
        gTop.append(g);
      });
    };
    if (dur) setTimeout(show, dur + 30); else show();
  }

  // the current step, said in a few words beside its cell, on the side away from the diagonal
  // (the step's own line runs along the row and the column on the diagonal's side)
  const callout = h('div', { class: 'callout', hidden: true, 'aria-hidden': 'true' });
  elGrid.append(callout);
  function drawCallout() {
    const w = state.walk && WALK[state.walk];
    const s = w && state.cur != null ? w.steps[state.cur] : null;
    if (!s || !L || L.pos[vis(s.r)] == null || L.pos[vis(s.c)] == null) { callout.hidden = true; return; }
    fill(callout,
      h('div', { class: 'co-h' }, sBadge(s), ' ', glyph(s.rk, 12), h('span', { class: 'co-k' }, KINDS[s.rk].short), s.verb ? h('span', { class: 'co-v' }, `「${s.verb}」`) : null),
      // a read is said from the reader's side, as its cell is in the reader's row
      s.rev ? h('div', { class: 'co-n' }, nodeName(s.r), h('span', { class: 'co-a' }, ' が '), nodeName(s.c), h('span', { class: 'co-a' }, ' を読む'))
        : h('div', { class: 'co-n' }, nodeName(s.fromNode), h('span', { class: 'co-a' }, ' → '), nodeName(s.toNode)),
      s.alt ? h('div', { class: 'co-x' }, altNote(w, s)) : null);
    callout.hidden = false;
    // in body coordinates: the cell, the badges and points along the lines of the walk
    const p = (id) => L.pos[vis(id)];
    const offOf = (x) => (x.alt ? Math.round(L.P * 0.45) : 0);
    const o = offOf(s);
    const cx = p(s.c) + o, cy = p(s.r) + o;
    const bw = callout.offsetWidth, bh = callout.offsetHeight, g = 13;
    const badges = [], dots = [];
    w.order.forEach((i) => {
      const x = w.steps[i], q = offOf(x), a = p(x.fromNode) + q, b = p(x.toNode) + q;
      if (Number.isNaN(a) || Number.isNaN(b)) return;
      badges.push([p(x.c) + q, p(x.r) + q, x === s]);
      const corner = x.rev ? [a, b] : [b, a];
      for (const [[x0, y0], [x1, y1]] of [[[a, a], corner], [corner, [b, b]]]) {
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5);
        for (let k = 0; k <= n; k++) dots.push([x0 + ((x1 - x0) * k) / (n || 1), y0 + ((y1 - y0) * k) / (n || 1)]);
      }
    });
    // the spot beside the cell that hides the fewest badges and lines, near the cell
    const above = p(s.c) >= p(s.r);
    let best = null;
    for (const dx of [g, -g - bw, g + 36, -g - bw - 36, -bw / 2]) for (const dy of [-g - bh, g, -g - bh - 28, g + 28]) {
      const x = Math.max(3, Math.min(L.size - bw - 2, cx + dx)), y = Math.max(3, Math.min(L.size - bh - 2, cy + dy));
      const inside = (px, py, m) => px > x - m && px < x + bw + m && py > y - m && py < y + bh + m;
      let score = Math.hypot(x + bw / 2 - cx, y + bh / 2 - cy) / 30;
      if (inside(cx, cy, 10)) score += 400;
      badges.forEach(([bx, by, cur]) => { if (inside(bx, by, 8)) score += cur ? 400 : 25; });
      dots.forEach(([px, py]) => { if (inside(px, py, 2)) score += 1.2; });
      // other things being equal, the side away from the diagonal
      if ((dy < 0) !== above) score += 2;
      if (!best || score < best.score) best = { x, y, score };
    }
    callout.style.left = Math.round(L.rowsW + best.x) + 'px';
    callout.style.top = Math.round(L.colsH + best.y) + 'px';
  }

  // ---------- pointer over the body ----------
  elBody.addEventListener('pointermove', (ev) => {
    if (!L) return;
    const rect = elBody.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const c = idAt(x), r = idAt(y);
    if (!r || !c) { if (state.hover) { state.hover = null; updateHighlights(); } hideTip(); return; }
    if (!state.hover || state.hover.r !== r || state.hover.c !== c) {
      state.hover = { r, c };
      updateHighlights();
    }
    const cell = CELLS.get(r + '|' + c);
    if (cell) showTipForCell(cell, ev); else hideTip();
  });
  elBody.addEventListener('pointerleave', () => { state.hover = null; updateHighlights(); hideTip(); });
  elBody.addEventListener('click', (ev) => {
    if (!L) return;
    const rect = elBody.getBoundingClientRect();
    clickCell(idAt(ev.clientY - rect.top), idAt(ev.clientX - rect.left));
  });
  function clickCell(r, c) {
    if (!r || !c) return;
    const cell = CELLS.get(r + '|' + c);
    if (r === c && PARTS[r]) { toggleOpen(r); return; }
    if (!cell) { selectNode(c); return; }
    if (state.walk) {
      const w = WALK[state.walk];
      const st = w.order.map((i) => w.steps[i]).find((s) => vis(s.r) === r && vis(s.c) === c);
      if (st) { setStep(st.i); return; }
    }
    // the column's node is opened, with the clicked cell on top of it
    selectNode(c, { pick: cell.key, scroll: false });
  }

  // ---------- tooltip ----------
  const tip = $('#tip');
  function placeTip(ev) {
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, ev.clientY - r.height - pad);
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function nodeName(id, cls) {
    return h('span', { class: (isCode(title(id)) ? 'mono ' : '') + (cls || '') }, title(id));
  }
  function showTipForCell(cell, ev) {
    if (cell.diag) {
      const inner = cell.rels.filter((r) => r.k !== 'paper');
      fill(tip,
        h('div', { class: 't-h' }, nodeName(cell.r), h('span', { class: 'arrow' }, 'の中（たたんでいる）')),
        h('div', { class: 't-x' }, `${M.partsPhrase(cell.r)}を、この行にたたんでいます。その中の関係 ${inner.length} 件。押すと開く。`),
      );
      tip.hidden = false; placeTip(ev); return;
    }
    const list = cell.rels;
    fill(tip,
      h('div', { class: 't-h' }, nodeName(cell.r), h('span', { class: 'arrow' }, '→'), nodeName(cell.c)),
      ...list.slice(0, 5).map((r) => relRow(r, cell)),
      list.length > 5 ? h('div', { class: 't-more' }, `ほか ${list.length - 5} 件。押すと右に全部出る`) : null,
    );
    tip.hidden = false;
    placeTip(ev);
  }
  function relRow(r, cell) {
    const viaFrom = cell && vis(r.from) !== r.from ? r.from : null;
    const viaTo = cell && vis(r.to) !== r.to ? r.to : null;
    const via = (viaFrom || viaTo) ? h('div', { class: 't-x' }, h('span', { class: 'where' }, '中の節：'), viaFrom ? nodeName(viaFrom) : null, viaFrom && viaTo ? ' → ' : null, viaTo ? nodeName(viaTo) : null) : null;
    return h('div', { class: 't-r' }, h('span', { class: 'g' }, glyph(r.k, 14)),
      h('div', {}, h('div', { class: 't-k' }, kindLabel(r), ' ', h('span', { class: 'where' }, whereLabel(r))),
        h('div', { class: 't-x' }, whyNodes(r)), via));
  }
  function showTipForLabel(id, ev) {
    const n = N[id];
    const out = RELS.filter((r) => vis(r.from) === id && vis(r.to) !== id && relOn(r)).length;
    const inc = RELS.filter((r) => vis(r.to) === id && vis(r.from) !== id && relOn(r)).length;
    const shortened = L && (L.rowText[id] !== title(id) || L.colText[id] !== title(id));
    fill(tip,
      h('div', { class: 't-h' }, h('span', { class: 'lchip' }, h('i', { style: `background:${layerVar(n.layer)}` })), nodeName(id), h('span', { class: 'arrow' }, KIND_NAME[n.kind] || n.kind)),
      h('div', { class: 't-x' }, `${LAYER[n.layer].name}${OWNER[id] ? `・${title(OWNER[id])} の中の紙` : ''}。行列では、この節から ${out} 件、この節へ ${inc} 件。`),
      shortened ? h('div', { class: 't-more' }, '名前は行列の中では縮めています') : null,
      PARTS[id] ? h('div', { class: 't-more' }, state.open.has(id) ? `▾ の印を押すと、${M.partsPhrase(id)}をたたむ` : `▸ の印を押すと、${M.partsPhrase(id)}をこの下に開く`) : null,
      h('div', { class: 't-more' }, '押すと、右にこの節を指しているものが出る'));
    tip.hidden = false; placeTip(ev);
  }
  function showTipForStep(w, s, ev) {
    fill(tip,
      h('div', { class: 't-h' }, stepRef(w, s), h('span', { class: 'arrow' }, s.verb ? `「${s.verb}」` : '')),
      h('div', { class: 't-r' }, h('span', { class: 'g' }, glyph(s.rk, 14)),
        h('div', {}, h('div', { class: 't-k' }, nodeName(s.fromNode), ' → ', nodeName(s.toNode)), h('div', { class: 't-x' }, richText(s.label || '', null)))),
    );
    tip.hidden = false; placeTip(ev);
  }
  function kindLabel(r) { return KINDS[r.k].name; }
  function sBadge(st) { return h('span', { class: 'sbadge' + (st.alt ? ' alt' : '') }, st.alt ? 'もし' + st.altNo : String(st.no)); }
  function stepRef(w, st) { return h('span', { class: 'sref' }, walkName(w), sBadge(st)); }
  function altNote(w, s) {
    const rep = M.replaced(w, s);
    return `もし${s.alt.when}（${rep ? rep.no : s.alt.at + 1} の代わり）`;
  }
  function whereLabel(r) {
    if (r.step && r.fam === 'step') return [stepRef(r.walk, r.step), r.step.verb ? '「' + r.step.verb + '」' : ''];
    if (r.k === 'paper') return `${r.walk.title}`;
    if (r.k === 'context') return `${walkName(r.walk)} の地図`;
    if (r.k === 'shape') return { slot: '中身の形', field: 'フィールドの型', of: '形', step: '手順が運ぶ値' }[r.sub] || '';
    if (r.k === 'mention') return { text: '文', embed: '文の中に載せる', value: '値の説明', param: '引数の説明', op: '操作' }[r.sub] || '';
    return '';
  }
  // why: the sentence, the step label, or the frame, with [[links]] as node names
  function whyNodes(r, target) {
    const tgt = target === undefined ? r.to : target;
    if (r.fam === 'step') {
      const s = r.step;
      const bits = [richText(s.label || '', null)];
      if (s.alt) bits.unshift(h('span', { class: 'where' }, altNote(r.walk, s) + '　'));
      // a read is drawn at the reader; say which way the value went
      if (s.rev) bits.push(h('span', { class: 'where' }, `（値は ${title(s.fromNode)} から ${title(s.toNode)} へ）`));
      return bits;
    }
    if (r.k === 'paper') return [`この紙に `, nodeName(r.to), ` の箱がある`, r.box && r.box.sub ? `（${r.box.sub}）` : ''];
    if (r.k === 'context') return [`「${r.region.label}」の枠の中で走る`];
    if (r.k === 'shape') {
      if (r.sub === 'slot') return [nodeName(r.from), ` の中身は `, nodeName(r.to), `（${walkName(r.walk)}）`];
      if (r.sub === 'field') return [`フィールド `, h('span', { class: 'mono' }, r.field[1]), ` の型が `, nodeName(r.to)];
      if (r.sub === 'of') return [`形は `, nodeName(r.to)];
      const s = r.step;
      const lab = s.data.label + (s.data.fields ? `{${s.data.fields.join(', ')}}` : '');
      return [stepRef(r.walk, s), ` で運ぶ値：`, h('span', { class: 'mono' }, lab), `（${title(s.fromNode)} → ${title(s.toNode)}）`];
    }
    if (r.k === 'mention') {
      // ![[id]] shows the node in place (a figure, for example)
      if (r.sub === 'embed') return [nodeName(r.from), N[r.to].kind === 'figure' ? ' の文の中に、この図を載せる' : ' の文の中に、この節をその場で見せる'];
      if (r.sub === 'value') return [h('span', { class: 'mono' }, r.key), '：', richText(r.text, tgt)];
      if (r.sub === 'param') return [`引数 `, h('span', { class: 'mono' }, r.key), '：', richText(r.text, tgt)];
      if (r.sub === 'op') return [`操作「${r.key}」：`, richText(r.text, tgt)];
      return [richText(r.text, tgt)];
    }
    return [];
  }
  // prose with [[id]] links as node names; the target is marked
  function richText(str, target, clickable) {
    const out = [];
    let last = 0;
    const re = /(!?)\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(str))) {
      if (m.index > last) out.push(str.slice(last, m.index));
      const id = m[2];
      if (N[id]) {
        if (clickable) {
          const b = h('button', { class: 'ref' + (isCode(title(id)) ? ' code' : '') + (id === target ? ' is-target' : ''), type: 'button' }, title(id));
          b.addEventListener('click', (ev) => { ev.stopPropagation(); selectNode(id); });
          out.push(b);
        } else out.push(h('span', { class: (id === target ? 'hl ' : '') + (isCode(title(id)) ? 'mono' : '') }, title(id)));
      } else out.push(m[0]);
      last = re.lastIndex;
    }
    if (last < str.length) out.push(str.slice(last));
    return out;
  }

  // ---------- legends: the steps in the corner, the other relations in the panel ----------
  const COUNT = {};
  RELS.forEach((r) => { COUNT[r.k] = (COUNT[r.k] || 0) + 1; });
  function kindButton(k, cls) {
    const b = h('button', { type: 'button', class: cls, 'aria-pressed': String(state.kinds.has(k)), title: `${KINDS[k].name}：押すと行列に出す・隠す`, dataset: { kind: k } },
      glyph(k, 14), h('span', { class: 'lg-name' }, KINDS[k].short || KINDS[k].name), h('span', { class: 'lg-n' }, COUNT[k] || 0));
    b.addEventListener('click', () => {
      if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k);
      syncKindButtons();
      state.focus = null;
      render(state.order === 'cluster');
    });
    b.addEventListener('mouseenter', () => {
      if (!state.kinds.has(k)) return;
      const keys = new Set();
      CELLS.forEach((c) => { if (c.rels.some((r) => r.k === k)) keys.add(c.key); });
      state.focus = { keys, ring: false };
      updateHighlights();
    });
    b.addEventListener('mouseleave', () => { state.focus = null; updateHighlights(); });
    return b;
  }
  function syncKindButtons() {
    for (const b of document.querySelectorAll('button[data-kind]')) b.setAttribute('aria-pressed', String(state.kinds.has(b.dataset.kind)));
  }
  function drawLegends() {
    for (const el of [$('#legend'), $('#legend-2')]) {
      el.replaceChildren(...STEP_KINDS.map((k) => h('li', {}, kindButton(k, ''))));
    }
    $('#more').replaceChildren(...MORE_KINDS.map((k) => kindButton(k, 'chip-btn')));
  }

  // ---------- chord: steps (and mentions) crossing from layer to layer ----------
  const elChord = $('#chord');
  const chordBody = $('#chord-body');
  function drawChord() {
    if (chordBody.hidden) return;
    const mode = state.chordMode;
    const elTab = $('#ltab');
    elChord.parentElement.hidden = mode === 'table';
    elTab.hidden = mode !== 'table';
    if (mode === 'table') { drawLayerTable(elTab); return; }
    // the steps shown in the matrix
    const rels = RELS.filter((r) => r.fam === 'step' && relOn(r));
    const ids = LAYERS.filter((l) => rels.some((r) => N[r.from].layer === l.id || N[r.to].layer === l.id)).map((l) => l.id);
    const ix = new Map(ids.map((id, i) => [id, i]));
    const mat = ids.map(() => ids.map(() => 0));
    const lists = ids.map(() => ids.map(() => []));
    const within = ids.map(() => []);
    rels.forEach((r) => {
      const a = ix.get(N[r.from].layer), b = ix.get(N[r.to].layer);
      if (a === b) { within[a].push(r); return; }   // the ribbons are only for traffic between layers
      mat[a][b]++; lists[a][b].push(r);
    });
    const W = Math.max(300, Math.min(460, (chordBody.clientWidth || 380) - 4));
    const Hh = mode === 'all' ? 300 : 280;
    const outer = Math.min(W / 2 - 112, Hh / 2 - 40), inner = outer - 11;
    elChord.setAttribute('width', W); elChord.setAttribute('height', Hh);
    elChord.setAttribute('viewBox', `${-W / 2} ${-Hh / 2} ${W} ${Hh}`);
    elChord.replaceChildren();
    const cross = rels.length - within.reduce((s, x) => s + x.length, 0);
    $('#chord-lead').textContent = '層をまたぐ手順';
    if (!cross) { $('#chord-note').textContent = '層をまたぐ関係は、出している種類の中にありません。'; return; }
    const chords = d3.chordDirected().padAngle(9 / inner).sortSubgroups(d3.descending).sortChords(d3.descending)(mat);
    const arc = d3.arc().innerRadius(inner).outerRadius(outer).cornerRadius(1.5);
    const ribbon = d3.ribbonArrow().radius(inner - 1.5).padAngle(1.2 / inner).headRadius(9);
    const gR = sv('g');
    chords.forEach((c) => {
      const a = c.source.index, b = c.target.index;
      const p = sv('path', { class: 'ribbon', d: ribbon(c), style: `fill:${layerVar(ids[a])}` });
      p.__ab = [a, b];
      p.__rels = lists[a][b];
      p.addEventListener('mouseenter', (ev) => focusRels(lists[a][b], ev, `${LAYER[ids[a]].name} → ${LAYER[ids[b]].name}`, p));
      p.addEventListener('mousemove', placeTip);
      p.addEventListener('mouseleave', unfocus);
      gR.append(p);
    });
    const gA = sv('g');
    const labels = [];
    chords.groups.forEach((g) => {
      if (g.endAngle - g.startAngle < 1e-6) return;
      const id = ids[g.index];
      const out = mat[g.index].reduce((s, x) => s + x, 0);
      const inn = mat.reduce((s, row) => s + row[g.index], 0);
      const ga = sv('g', { class: 'arc' }, sv('path', { d: arc(g), style: `fill:${layerVar(id)}` }));
      const mid = (g.startAngle + g.endAngle) / 2;
      const right = mid < Math.PI;
      labels.push({ id, mid, right, x: Math.sin(mid) * (outer + 12), y: -Math.cos(mid) * (outer + 12), out, inn, wn: within[g.index].length, ga });
      const all = rels.filter((r) => (N[r.from].layer === id || N[r.to].layer === id) && N[r.from].layer !== N[r.to].layer);
      ga.addEventListener('mouseenter', (ev) => focusRels(all, ev, `${LAYER[id].name}から・へ`, null, g.index));
      ga.addEventListener('mousemove', placeTip);
      ga.addEventListener('mouseleave', unfocus);
      gA.append(ga);
    });
    // labels: keep them apart vertically on each side
    for (const side of [true, false]) {
      const ls = labels.filter((l) => l.right === side).sort((a, b) => a.y - b.y);
      for (let k = 1; k < ls.length; k++) if (ls[k].y - ls[k - 1].y < 31) ls[k].y = ls[k - 1].y + 31;
      const over = ls.length ? ls[ls.length - 1].y + 16 - Hh / 2 : 0;
      if (over > 0) ls.forEach((l) => { l.y -= over; });
      const under = ls.length ? -Hh / 2 - (ls[0].y - 12) : 0;
      if (under > 0) ls.forEach((l) => { l.y += under; });
    }
    labels.forEach((l) => {
      // two columns of labels outside the circle, joined to their arcs by a leader
      const anchor = l.right ? 'start' : 'end';
      const tx = l.right ? Math.max(l.x + 6, outer * 0.62 + 16) : Math.min(l.x - 6, -outer * 0.62 - 16);
      const ax = Math.sin(l.mid) * (outer + 2), ay = -Math.cos(l.mid) * (outer + 2);
      l.ga.append(sv('path', { d: `M${ax} ${ay}L${tx - (l.right ? 4 : -4)} ${l.y}`, class: 'leader' }));
      l.ga.append(sv('text', { x: tx, y: l.y - 3, 'text-anchor': anchor }, LAYER[l.id].name));
      l.ga.append(sv('text', { x: tx, y: l.y + 12, 'text-anchor': anchor, class: 'n' }, `出 ${l.out}・入 ${l.inn}` + (l.wn ? `・中 ${l.wn}` : '')));
    });
    elChord.append(gR, gA);
    syncChordFocus();
    $('#chord-note').textContent = `流れと紙の手順 ${rels.length} 件のうち、層をまたぐ ${cross} 件。`
      + '帯は行列と同じ向き（働く側から、とがった先へ）で、太さが数。「中」は同じ層の中。帯に乗ると、行列の升目が光る。';
  }
  // the matrix folded to layers: how many steps (and mentions in the text) go from a row's layer
  // to a column's layer; the diagonal is what stays inside a layer
  function drawLayerTable(el) {
    const ids = LAYERS.map((l) => l.id);
    const steps = new Map(), ments = new Map();
    const push = (m, k, r) => { if (!m.has(k)) m.set(k, []); m.get(k).push(r); };
    RELS.forEach((r) => {
      const k = N[r.from].layer + '|' + N[r.to].layer;
      if (r.fam === 'step' && relOn(r)) push(steps, k, r);
      else if (r.k === 'mention') push(ments, k, r);
    });
    const max = Math.max(1, ...[...steps.values()].map((x) => x.length));
    const nS = [...steps.values()].reduce((s, x) => s + x.length, 0), nM = [...ments.values()].reduce((s, x) => s + x.length, 0);
    $('#chord-lead').textContent = '層から層へ（行列を層でたたむ）';
    const head = h('tr', {}, h('th', { class: 'corner' }, h('span', {}, '行 → 列')), ...ids.map((id) => h('th', { class: 'col' }, h('i', { style: `background:${layerVar(id)}` }), h('span', {}, LAYER[id].name))));
    const body = ids.map((a) => h('tr', {}, h('th', { class: 'row' }, h('i', { style: `background:${layerVar(a)}` }), LAYER[a].name),
      ...ids.map((b) => {
        const k = a + '|' + b, s = steps.get(k) || [], m = ments.get(k) || [];
        const td = h('td', { class: (a === b ? 'diag' : '') + (s.length ? ' has' : ''), style: s.length ? { '--a': (0.1 + 0.5 * s.length / max).toFixed(2) } : null },
          s.length ? h('b', {}, s.length) : null, m.length ? h('span', { class: 'm' }, `+${m.length}`) : null);
        if (s.length || m.length) {
          td.addEventListener('mouseenter', (ev) => focusRels([...s, ...m], ev, `${LAYER[a].name} → ${LAYER[b].name}${a === b ? '（同じ層の中）' : ''}`, null, -1));
          td.addEventListener('mousemove', placeTip);
          td.addEventListener('mouseleave', unfocus);
        }
        return td;
      })));
    el.replaceChildren(h('table', { class: 'ltab' }, h('thead', {}, head), h('tbody', {}, ...body)));
    $('#chord-note').textContent = `太い数字が手順（${nS} 件）、灰色の「+」が文の言及（${nM} 件）。行の層の節から列の層の節へ。対角線は同じ層の中。升目に乗ると、行列の該当する所が光る。`;
  }
  function focusRels(rels, ev, head, ribbonEl, arcIndex) {
    const keys = new Set(rels.map(keyOf));
    state.focus = { keys, ring: true };
    updateHighlights();
    elChord.classList.add('is-focus');
    for (const p of elChord.querySelectorAll('.ribbon')) {
      const on = ribbonEl ? p === ribbonEl : (p.__ab[0] === arcIndex || p.__ab[1] === arcIndex);
      p.classList.toggle('is-on', on);
    }
    // the tooltip lists the relations, steps first
    const sorted = rels.slice().sort((a, b) => rank(a) - rank(b));
    const rows = sorted.slice(0, 7).map((r) => h('div', { class: 't-r' }, h('span', { class: 'g' }, glyph(r.k, 14)),
      h('div', {}, h('div', { class: 't-k' }, nodeName(r.from), ' → ', nodeName(r.to)),
        h('div', { class: 't-x' }, h('span', { class: 'where' }, whereLabel(r))))));
    fill(tip, h('div', { class: 't-h' }, h('span', {}, head), h('span', { class: 'arrow' }, `${rels.length} 件`)), ...rows,
      rels.length > 7 ? h('div', { class: 't-more' }, `ほか ${rels.length - 7} 件。行列の中で光っている所`) : null);
    tip.hidden = false; placeTip(ev);
  }
  function unfocus() {
    state.focus = null; updateHighlights(); hideTip();
    syncChordFocus();
  }
  // with a flow shown, the chord lights the ribbons its steps travel along
  function syncChordFocus() {
    const w = state.walk && WALK[state.walk];
    elChord.classList.toggle('is-focus', !!w);
    const cur = w && state.cur != null ? w.steps[state.cur] : null;
    for (const p of elChord.querySelectorAll('.ribbon')) {
      const rs = p.__rels || [];
      p.classList.toggle('is-on', !!w && rs.some((r) => r.walk === w && r.fam === 'step'));
      p.classList.toggle('is-cur', !!cur && rs.some((r) => r.step === cur));
    }
  }

  // ---------- the panel ----------
  const tabBody = $('#tab-body');
  const tabNode = $('#tab-node'), tabWalk = $('#tab-walk'), tabChord = $('#tab-chord');
  tabNode.addEventListener('click', () => { state.tab = 'node'; renderPanel(); });
  tabWalk.addEventListener('click', () => { if (state.walk) { state.tab = 'walk'; renderPanel(); } });
  tabChord.addEventListener('click', () => { state.tab = 'chord'; renderPanel(); });
  function renderPanel() {
    tabWalk.disabled = !state.walk;
    tabWalk.title = state.walk ? WALK[state.walk].title : '流れを選ぶと、その手順が出ます';
    if (state.tab === 'walk' && !state.walk) state.tab = 'node';
    for (const [b, t] of [[tabWalk, 'walk'], [tabNode, 'node'], [tabChord, 'chord']]) b.setAttribute('aria-selected', String(state.tab === t));
    chordBody.hidden = state.tab !== 'chord';
    tabBody.hidden = state.tab === 'chord';
    syncNav();
    if (state.tab === 'chord') drawChord();
    else if (state.tab === 'walk') renderWalkTab();
    else renderNodeTab();
  }
  // a small square in the colour of a node's layer, as in the bands of the matrix
  function layerDot(id) { return h('i', { class: 'ldot', style: `background:${layerVar(N[id].layer)}`, title: LAYER[N[id].layer].name }); }
  function layerChip(id) {
    return h('span', { class: 'lchip' }, h('i', { style: `background:${layerVar(N[id].layer)}` }), LAYER[N[id].layer].name);
  }
  // what the recorded run says about a node: only what it logged (entries into watched functions
  // and interrupts), and nothing about what it did not watch
  function traceLine(id) {
    const t = M.traceOf(id);
    if (!t) return null;
    const fnName = (fn) => h('span', { class: 'mono' }, fn);
    let dot = '', body;
    if (t.type === 'func') { dot = 'on'; body = [`この関数（`, fnName(t.fn), `）に ${t.k} 回入った`]; }
    else if (t.type === 'part') {
      dot = t.k ? 'part' : '';
      body = [nodeRef(t.host), ' の中の一部。記録は関数に入った回数だけで、', fnName(t.fn), t.k ? ` には ${t.k} 回入った` : ' は記録の外'];
    } else if (t.type === 'unwatched') {
      body = t.sure ? ['この関数（', fnName(t.fn), `）は見ていない。見ていたのは ${M.SEEN_FNS} の関数`]
        : ['この関数（', fnName(t.fn), '）は出てこない'];
    } else {
      const counted = t.near.filter(([, k]) => k > 0), outside = t.near.filter(([, k]) => !k);
      body = ['記録は関数に入った回数と割り込みだけ。'];
      if (t.irq.length) body.push(`割り込みは${t.irq.map(([c, k]) => `${CAUSE[c] || c} ${k} 回`).join('・')}。`);
      if (counted.length) {
        body.push(t.context ? 'この枠に描かれた関数に入った回数は、' : '手順でつながる関数に入った回数は、');
        counted.forEach(([o, k], i) => body.push(i ? '・' : '', nodeRef(o), ` ${k} 回`));
        body.push('。');
      }
      if (outside.length) body.push(...outside.flatMap(([o], i) => [i ? '・' : '', nodeRef(o)]), ' は記録の外。');
      if (!counted.length && !outside.length && !t.irq.length) body = ['記録は関数に入った回数と割り込みだけで、この節は数えていない。'];
      dot = counted.length || t.irq.length ? 'part' : '';
    }
    return h('div', { class: 'n-trace' },
      h('div', { class: 'tr-h' }, h('span', { class: 'tr-dot ' + dot }), '記録', h('span', { class: 'tr-t' }, M.TRACE.title)),
      h('div', { class: 'tr-b' }, ...body));
  }
  function renderNodeTab() {
    const id = state.sel;
    tabBody.replaceChildren();
    if (!id) { renderOverview(); return; }
    const n = N[id];
    const loc = CODE.nodes[id];
    // the cell that was clicked, on top of the node it points at
    const pick = state.pick ? state.pick.split('|') : null;
    if (pick && pick[1] === vis(id)) tabBody.append(cellBlock(pick[0], pick[1]));
    const head = h('div', { class: 'n-head' }, layerChip(id), h('span', {}, KIND_NAME[n.kind] || n.kind),
      OWNER[id] ? h('span', {}, nodeRef(OWNER[id]), ' の中の紙') : null,
      h('span', { class: 'n-tools' },
        WALK[id] ? walkLink(id) : null,
        PARTS[id] ? foldLink(id) : null,
        loc && loc.start ? codeButton(loc.path, loc.start, loc.end, null, n.title) : null));
    const tt = h('div', { class: 'n-title' + (isCode(n.title) ? ' mono' : '') }, n.title);
    const code = loc && loc.path ? h('div', { class: 'n-code' }, h('code', {}, loc.path, loc.start ? h('span', { class: 'lines' }, `:${loc.start}${loc.end > loc.start ? '–' + loc.end : ''}`) : null))
      : (n.code ? h('div', { class: 'n-code' }, h('code', {}, n.code[0])) : null);
    const lines = String(n.text || '').split('\n').filter((x) => !/^!\[\[/.test(x.trim()));
    const text = h('div', { class: 'n-text' + (state.more ? ' is-open' : '') }, ...lines.map((line, i) => [i ? h('br') : null, richText(line, null, true)]));
    const textWrap = h('div', { class: 'n-text-wrap' }, text);
    tabBody.append(head, tt, code, textWrap);
    // the prose is cut to two lines, so who points at the node shows without scrolling
    if (!state.more && text.scrollHeight > text.clientHeight + 2) {
      const more = h('button', { class: 'linkbtn more-btn', type: 'button' }, '続き');
      more.addEventListener('click', () => { state.more = true; text.classList.add('is-open'); more.remove(); });
      textWrap.append(more);
    }
    const inc = RELS.filter((r) => r.to === id);
    const out = RELS.filter((r) => r.from === id);
    const notes = STEP_NOTES.filter((x) => x.to === id);
    const nIn = new Set(inc.map((r) => r.from)).size;
    tabBody.append(h('div', { class: 'sec-h' }, '指しているもの',
      h('span', { class: 'cnt' }, `${nIn} 節（${inc.length} 件）` + (notes.length ? `＋手順の説明 ${notes.length}` : '')),
      h('span', { class: 'hint' }, 'だれが、なぜ')));
    tabBody.append(relSection(inc, 'in', notes, pick && pick[1] === vis(id) ? pick[0] : null));
    tabBody.append(traceLine(id));
    tabBody.append(h('div', { class: 'sec-h' }, 'この節が指すもの', h('span', { class: 'cnt' }, `${new Set(out.map((r) => r.to)).size} 節（${out.length} 件）`)));
    tabBody.append(relSection(out, 'out', [], null));
    if (pick) tabBody.scrollTop = 0;
  }
  // no node chosen: the nodes most pointed at, as a way in
  function renderOverview() {
    tabBody.append(h('p', { class: 'empty' }, '行か列の名前を押すと、その節を、だれが・なぜ指しているかが出ます。升目を押すと、その升目の関係が出ます。'));
    const by = new Map();
    RELS.forEach((r) => { if (r.from !== r.to) { if (!by.has(r.to)) by.set(r.to, []); by.get(r.to).push(r); } });
    const top = [...by.entries()].map(([id, rs]) => ({ id, n: new Set(rs.map((r) => r.from)).size, k: rs.length }))
      .sort((a, b) => b.n - a.n || b.k - a.k).slice(0, 10);
    tabBody.append(h('div', { class: 'sec-h' }, 'よく指されている節', h('span', { class: 'cnt' }, '指している節の数')));
    const ul = h('ul', { class: 'top-list' });
    top.forEach(({ id, n, k }) => {
      const li = h('li', {}, h('i', { class: 'dot', style: `background:${layerVar(N[id].layer)}` }), nodeName(id), h('span', { class: 'k' }, LAYER[N[id].layer].name), h('span', { class: 'n' }, `${n} 節（${k} 件）`));
      li.addEventListener('click', () => selectNode(id));
      li.addEventListener('mouseenter', () => { state.hover = { r: vis(id) }; updateHighlights(); });
      li.addEventListener('mouseleave', () => { state.hover = null; updateHighlights(); });
      ul.append(li);
    });
    tabBody.append(ul);
  }
  // the relations of one cell, all kinds (those hidden from the matrix are marked)
  function cellBlock(r, c) {
    const rels = relsOfCell(r, c);
    const close = h('button', { class: 'x', type: 'button', 'aria-label': '閉じる', title: '閉じる' }, '×');
    close.addEventListener('click', () => { state.pick = null; updateHighlights(); renderPanel(); });
    return h('div', { class: 'cell-pick' },
      h('div', { class: 'cp-h' }, h('span', { class: 'cp-l' }, 'この升目'), h('span', { class: 'cp-n' }, nodeRef(r), ' → ', nodeRef(c)), h('span', { class: 'cnt' }, `${rels.length} 件`), close),
      h('ul', { class: 'reasons' }, rels.map((x) => reasonRow(x, true))));
  }
  function walkLink(id) {
    const b = h('button', { class: 'linkbtn', type: 'button', title: WALK[id].title }, '中の紙をたどる');
    b.addEventListener('click', (ev) => { ev.stopPropagation(); setWalk(id); });
    return b;
  }
  function foldLink(id) {
    const b = h('button', { class: 'linkbtn', type: 'button', title: `${M.partsPhrase(id)}を、この行の下に出す・しまう` },
      state.open.has(id) ? `中の ${PARTS[id].length} 節をたたむ` : `中の ${PARTS[id].length} 節を開く`);
    b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleOpen(id); });
    return b;
  }
  function nodeRef(id) {
    const b = h('button', { class: 'ref' + (isCode(title(id)) ? ' code' : ''), type: 'button' }, title(id));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); selectNode(id); });
    return b;
  }
  function codeButton(path, start, end, line, label) {
    if (!CODE.files || !CODE.files[path]) return null;
    const b = h('button', { class: 'linkbtn', type: 'button' }, 'コードを見る');
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openCode(path, start, end, line, label); });
    return b;
  }
  function reasonRow(r, withVia) {
    const where = whereLabel(r);
    // in a cell, a relation may come from a node folded into the row's or the column's owner
    const viaFrom = withVia && vis(r.from) !== r.from ? r.from : null;
    const viaTo = withVia && vis(r.to) !== r.to ? r.to : null;
    const via = viaFrom || viaTo ? h('div', { class: 'via' }, '中の節：', viaFrom ? nodeName(viaFrom) : null, viaFrom && viaTo ? ' → ' : null, viaTo ? nodeName(viaTo) : null) : null;
    const row = h('li', { class: relOn(r) ? '' : 'is-off', title: relOn(r) ? null : 'この種類は行列では隠しています' }, h('span', { class: 'g' }, glyph(r.k, 13)),
      h('div', {}, h('span', { class: 'rk' }, kindLabel(r)), h('span', { class: 'where' }, where && where.length ? ['・', where] : ''),
        h('div', { class: 'why' }, whyNodes(r, r.to)), via));
    row.addEventListener('mouseenter', () => { state.focus = { keys: new Set([keyOf(r)]), ring: true }; updateHighlights(); });
    row.addEventListener('mouseleave', () => { state.focus = null; updateHighlights(); });
    if (r.fam === 'step') row.addEventListener('click', (ev) => { ev.stopPropagation(); setWalk(r.walk.id, { at: r.step.i }); });
    return row;
  }
  // the relations of one node, grouped by the node at the other end: who, then each reason
  function relSection(rels, dir, notes, from) {
    const wrap = h('div');
    if (!rels.length && !notes.length) { wrap.append(h('p', { class: 'empty' }, dir === 'in' ? 'この節を指しているものはありません。' : 'この節から指すものはありません。')); return wrap; }
    const byNode = new Map();
    rels.forEach((r) => {
      const other = dir === 'in' ? r.from : r.to;
      if (!byNode.has(other)) byNode.set(other, []);
      byNode.get(other).push(r);
    });
    const best = (rs) => Math.min(...rs.map(rank));
    const isFrom = (o) => from && vis(o) === from;
    const order = [...byNode.keys()].sort((a, b) => isFrom(b) - isFrom(a) || best(byNode.get(a)) - best(byNode.get(b)) || N[a].li - N[b].li || N[a].k - N[b].k);
    const ul = h('ul', { class: 'rel-list' });
    order.forEach((other) => {
      const rs = byNode.get(other).slice().sort((a, b) => rank(a) - rank(b));
      const li = h('li', { class: isFrom(other) ? 'is-from' : '' },
        h('div', { class: 'who' }, h('i', { class: 'dot', style: `background:${layerVar(N[other].layer)}` }), nodeName(other),
          h('span', { class: 'k' }, LAYER[N[other].layer].name + (OWNER[other] ? `・${title(OWNER[other])} の中` : ''))),
        h('ul', { class: 'reasons' }, rs.map(reasonRow)));
      li.querySelector('.who').addEventListener('click', () => selectNode(other));
      ul.append(li);
    });
    notes.forEach((x) => {
      const li = h('li', {},
        h('div', { class: 'who' }, h('i', { class: 'dot step' }), h('span', {}, stepRef(x.walk, x.step)), h('span', { class: 'k' }, `手順の${x.what}`)),
        h('ul', { class: 'reasons' }, h('li', {}, h('span', { class: 'g' }, glyph('mention', 13)),
          h('div', {}, h('span', { class: 'rk' }, '言及'), h('span', { class: 'where' }, '・手順の説明（升目には描かない）'), h('div', { class: 'why' }, richText(x.text, x.to))))));
      li.addEventListener('click', () => setWalk(x.walk.id, { at: x.step.i }));
      ul.append(li);
    });
    wrap.append(ul);
    return wrap;
  }

  function renderWalkTab() {
    const w = WALK[state.walk];
    tabBody.replaceChildren();
    tabBody.append(h('div', { class: 'w-title' }, w.title),
      h('div', { class: 'w-sub' }, w.type === 'flow' ? `流れ・${countText(w)}` : [nodeRef(w.owner), ` の中の紙・${countText(w)}`],
        '。行列では、手順がひとつずつ対角線で折り返す線になる。', h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' で 1 手順ずつ、', h('kbd', {}, 'Esc'), ' で行列だけ。'));
    const ul = h('ol', { class: 'steps' });
    w.order.forEach((i) => {
      const s = w.steps[i];
      const meta = [];
      if (s.data) {
        const lab = s.data.label + (s.data.fields ? `{${s.data.fields.join(', ')}}` : '');
        meta.push(h('span', {}, '渡す ', h('code', {}, lab), s.data.type ? `（${s.data.type}）` : ''));
      }
      (s.ops || []).forEach((o) => meta.push(h('span', {}, `　${title(o.node)} に「${o.kind}」`)));
      if (s.code) meta.push(h('span', {}, '　', codeButton(s.code.path, s.code.line, s.code.line, s.code.line, `${walkName(w)} ${stepTag(s)}`)));
      const li = h('li', { class: (state.cur === i ? 'is-cur' : '') + (s.alt ? ' alt' : ''), 'data-i': i },
        h('span', { class: 'no' + (s.alt ? ' alt' : '') }, s.alt ? 'もし' + s.altNo : String(s.no)),
        h('div', {},
          h('div', { class: 'ft' }, glyph(s.rk, 12), ' ', layerDot(s.fromNode), nodeRef(s.fromNode), ' → ', layerDot(s.toNode), nodeRef(s.toNode), h('span', { class: 'k' }, `　${KINDS[s.rk].short}${s.verb ? '「' + s.verb + '」' : ''}`)),
          s.alt ? h('div', { class: 'dt' }, altNote(w, s)) : null,
          h('div', { class: 'lb' }, richText(s.label || '', null, true)),
          s.branches ? h('div', { class: 'dt' }, '分かれる：', ...s.branches.flatMap((b, k) => [k ? '／' : '', b[0], ' → ', richText(b[1], null, true)])) : null,
          meta.length ? h('div', { class: 'dt' }, ...meta) : null));
      li.addEventListener('click', () => setStep(i));
      ul.append(li);
    });
    tabBody.append(ul);
    const cur = tabBody.querySelector('li.is-cur');
    if (cur) tabBody.scrollTop = Math.max(0, cur.offsetTop - tabBody.clientHeight / 2 + cur.clientHeight / 2);
  }

  // ---------- code viewer ----------
  const dlg = $('#code-dlg');
  $('#code-close').addEventListener('click', () => { dlg.hidden = true; });
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.hidden = true; });
  async function openCode(path, start, end, line, label) {
    $('#code-title').textContent = label || '';
    $('#code-path').textContent = `${path}:${start}${end > start ? '–' + end : ''}`;
    const pre = $('#code-pre');
    pre.replaceChildren(h('div', { class: 'ln' }, h('span', {}, ''), h('span', {}, '読んでいます…')));
    dlg.hidden = false;
    try {
      const res = await fetch('../data/src/' + path);
      if (!res.ok) throw new Error(res.status);
      const lines = (await res.text()).split('\n');
      const a = Math.max(1, start - 6), b = Math.min(lines.length, Math.max(end, start) + 8);
      pre.replaceChildren(...lines.slice(a - 1, b).map((t, k) => {
        const no = a + k;
        const cls = 'ln' + (no >= start && no <= end ? ' on' : '') + (no === line ? ' hit' : '');
        return h('div', { class: cls }, h('span', {}, String(no)), h('span', {}, t));
      }));
      const first = pre.querySelector('.on');
      if (first) pre.scrollTop = Math.max(0, first.offsetTop - 60);
    } catch (e) {
      pre.replaceChildren(h('div', { class: 'ln' }, h('span', {}, ''), h('span', {}, 'このファイルは読めませんでした。')));
    }
  }

  // ---------- actions ----------
  function selectNode(id, opt = {}) {
    state.more = state.sel === id ? state.more : false;
    state.pick = opt.pick || null;
    state.tab = 'node';
    if (OWNER[id] && !state.open.has(OWNER[id]) && opt.open !== false) {
      // a part was chosen: open its owner so it has a row of its own
      state.open.add(OWNER[id]);
      state.sel = id;
      syncFoldButton();
      render(true);
      scrollToCell(id, id);
      return;
    }
    state.sel = id;
    updateHighlights();
    renderPanel();
    if (opt.scroll !== false) scrollToCell(id, id);
  }
  // bring a cell into view (both ways, as the matrix scrolls on small screens)
  function scrollToCell(r, c) {
    const pane = $('#pane');
    if (!L || L.pos[vis(r)] == null || L.pos[vis(c)] == null) return;
    const y = L.pos[vis(r)], x = L.pos[vis(c)];
    const vw = pane.clientWidth - L.rowsW, vh = pane.clientHeight - L.colsH;
    let top = pane.scrollTop, left = pane.scrollLeft;
    if (y - top < 16 || y - top > vh - 16) top = y - vh / 2;
    if (x - left < 16 || x - left > vw - 16) left = x - vw / 2;
    if (top !== pane.scrollTop || left !== pane.scrollLeft) pane.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' });
  }
  function toggleOpen(id) {
    if (state.open.has(id)) {
      state.open.delete(id);
      if (state.sel && OWNER[state.sel] === id) state.sel = id;
    } else state.open.add(id);
    state.walkOpened.delete(id);
    syncFoldButton();
    render(true);
  }
  const foldAll = $('#fold-all');
  function syncFoldButton() {
    const owners = Object.keys(PARTS);
    const allOpen = owners.every((o) => state.open.has(o));
    foldAll.textContent = allOpen ? '中の紙をたたむ' : '中の紙を開く';
  }
  foldAll.addEventListener('click', () => {
    const owners = Object.keys(PARTS);
    const allOpen = owners.every((o) => state.open.has(o));
    if (allOpen) { owners.forEach((o) => state.open.delete(o)); if (state.sel && OWNER[state.sel]) state.sel = OWNER[state.sel]; }
    else owners.forEach((o) => state.open.add(o));
    state.walkOpened.clear();
    syncFoldButton();
    render(true);
  });

  // order
  function setOrder(o) {
    state.order = o;
    for (const x of document.querySelectorAll('#order button')) x.setAttribute('aria-pressed', String(x.dataset.order === o));
    render(true);
  }
  for (const b of document.querySelectorAll('#order button')) b.addEventListener('click', () => setOrder(b.dataset.order));
  // chord mode
  for (const b of document.querySelectorAll('#chord-mode button')) b.addEventListener('click', () => {
    state.chordMode = b.dataset.mode;
    for (const x of document.querySelectorAll('#chord-mode button')) x.setAttribute('aria-pressed', String(x === b));
    drawChord();
  });

  // walks: the two flows as large buttons, the four papers below them
  const elFlows = $('#flows');
  const elPapers = $('#papers');
  function drawWalkButtons() {
    elFlows.replaceChildren();
    WALKS.filter((w) => w.type === 'flow').forEach((w) => {
      const b = h('button', { type: 'button', class: 'flow-btn', 'aria-pressed': String(state.walk === w.id), title: w.title },
        h('span', { class: 'fb-t' }, w.tab), h('span', { class: 'fb-s' }, countText(w)));
      b.addEventListener('click', () => setWalk(w.id));
      elFlows.append(b);
    });
    const none = h('button', { type: 'button', class: 'flow-btn none', 'aria-pressed': String(!state.walk), title: '流れを消して、行列だけを見る（Esc）' },
      h('span', { class: 'fb-t' }, 'なし'), h('span', { class: 'fb-s' }, '行列だけ'));
    none.addEventListener('click', () => setWalk(null));
    elFlows.append(none);
    elPapers.replaceChildren(...WALKS.filter((w) => w.type === 'paper').map((w) => {
      const b = h('button', { type: 'button', class: 'paper-btn', 'aria-pressed': String(state.walk === w.id), title: `${w.title}（${title(w.owner)} の中の紙）・${countText(w)}` },
        h('span', { class: isCode(w.tab) ? 'mono' : '' }, w.tab));
      b.addEventListener('click', () => setWalk(w.id));
      return b;
    }));
  }
  // the step position beside the walk buttons
  const elPos = $('#pos'), elPrev = $('#prev'), elNext = $('#next');
  elPrev.addEventListener('click', () => stepBy(-1));
  elNext.addEventListener('click', () => stepBy(1));
  function syncNav() {
    const w = state.walk && WALK[state.walk];
    $('#nav').classList.toggle('off', !w);
    if (!w) { elPos.replaceChildren(h('span', { class: 'hint' }, '流れを選ぶと ← → で進める')); return; }
    const k = state.cur == null ? -1 : w.order.indexOf(state.cur);
    const s = k >= 0 ? w.steps[state.cur] : null;
    elPos.replaceChildren(s ? sBadge(s) : '', s ? (s.alt ? h('span', { class: 'of' }, `${M.replaced(w, s) ? M.replaced(w, s).no : ''} の代わり`) : h('span', { class: 'of' }, `/ ${w.count.main}`)) : '');
    elPrev.disabled = k <= 0;
    elNext.disabled = k >= w.order.length - 1;
  }
  function setWalk(id, opt = {}) {
    // fold back what the previous walk opened
    let relayout = false;
    state.walkOpened.forEach((o) => { if (state.open.has(o)) { state.open.delete(o); relayout = true; } });
    state.walkOpened.clear();
    state.walk = id || null;
    state.cur = null;
    state.focus = null;
    state.pick = null;
    if (id) {
      const w = WALK[id];
      w.steps.forEach((s) => [s.fromNode, s.toNode].forEach((n) => {
        const o = OWNER[n];
        if (o && !state.open.has(o)) { state.open.add(o); state.walkOpened.add(o); relayout = true; }
      }));
      state.cur = opt.at != null ? opt.at : w.order[0];
      state.tab = 'walk';
    } else if (state.tab === 'walk') state.tab = 'node';
    if (state.sel && OWNER[state.sel] && !state.open.has(OWNER[state.sel])) state.sel = OWNER[state.sel];
    syncFoldButton();
    drawWalkButtons();
    if (relayout) render(true);
    else { updateHighlights(); drawWalk(1); renderPanel(); syncChordFocus(); }
    // once the rows have moved, bring the current step (whichever it is by then) into view
    if (id) setTimeout(() => {
      const w = state.walk && WALK[state.walk];
      if (w && state.cur != null) scrollToCell(w.steps[state.cur].r, w.steps[state.cur].c);
    }, relayout ? T + 40 : 0);
  }
  function setStep(i) {
    const w = state.walk && WALK[state.walk];
    if (!w) return;
    state.cur = i;
    const s = w.steps[i];
    state.pick = null;
    state.hover = null;
    state.tab = 'walk';
    updateHighlights();
    drawWalk(0);
    renderPanel();
    syncChordFocus();
    scrollToCell(s.r, s.c);
  }
  function stepBy(d) {
    const w = state.walk && WALK[state.walk];
    if (!w) return;
    const k = state.cur == null ? (d > 0 ? -1 : w.order.length) : w.order.indexOf(state.cur);
    const nk = Math.max(0, Math.min(w.order.length - 1, k + d));
    setStep(w.order[nk]);
  }

  // search
  const search = $('#search');
  search.addEventListener('input', () => { state.search = search.value; updateHighlights(); });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const q = search.value.trim().toLowerCase();
      if (!q) return;
      const hitId = ALL.find((id) => matchNode(id, q));
      if (hitId) selectNode(hitId);
    }
    if (ev.key === 'Escape') { search.value = ''; state.search = ''; updateHighlights(); search.blur(); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT')) return;
    if (ev.key === 'Escape') {
      if (!dlg.hidden) { dlg.hidden = true; return; }
      if (state.pick) { state.pick = null; updateHighlights(); renderPanel(); return; }
      if (state.walk) { setWalk(null); return; }
      state.focus = null; updateHighlights();
    }
    if (ev.key === 'ArrowRight' || ev.key === 'j') { if (state.walk) { ev.preventDefault(); stepBy(1); } }
    if (ev.key === 'ArrowLeft' || ev.key === 'k') { if (state.walk) { ev.preventDefault(); stepBy(-1); } }
    if (ev.key === '/') { ev.preventDefault(); search.focus(); }
  });

  // a soft edge where the matrix goes on beyond the pane
  const pane = $('#pane');
  function syncEdges() {
    pane.classList.toggle('more-r', pane.scrollLeft + pane.clientWidth < pane.scrollWidth - 2);
    pane.classList.toggle('more-b', pane.scrollTop + pane.clientHeight < pane.scrollHeight - 2);
    pane.classList.toggle('more-l', pane.scrollLeft > 2);
    pane.style.setProperty('--sl', pane.scrollLeft + 'px');
    pane.style.setProperty('--st', pane.scrollTop + 'px');
  }
  pane.addEventListener('scroll', syncEdges, { passive: true });
  let rsz = null;
  window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => render(false), 120); });

  // ---------- start: on the first step of the UI flow ----------
  drawLegends();
  drawWalkButtons();
  syncFoldButton();
  render(false);
  setWalk('ui');

  // for screenshots and quick checks
  window.__mx = {
    state, render, selectNode, setWalk, setStep, stepBy, toggleOpen, setOrder, clickCell,
    setKinds: (ks) => { state.kinds = new Set(ks); syncKindButtons(); render(false); },
    setTab: (t) => { state.tab = t; renderPanel(); },
    hoverCell: (r, c) => {
      const rect = elBody.getBoundingClientRect();
      const ev = new PointerEvent('pointermove', { clientX: rect.left + L.pos[c], clientY: rect.top + L.pos[r], bubbles: true });
      elBody.dispatchEvent(ev);
    },
    traceText: (id) => { const e = traceLine(id); return e ? e.querySelector('.tr-b').textContent : null; },
    layout: () => L,
    cells: () => CELLS,
  };
})();
