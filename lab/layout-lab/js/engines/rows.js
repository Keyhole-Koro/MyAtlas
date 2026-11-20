// (6) Proposal: ELK with the bands kept as rows that read left to right.
// The steps that stay inside a band are drawn as a row of boxes with short arrows; a label that does not fit on its
// arrow sits just above it. Each row goes to ELK as one node with fixed ports on its top and bottom, one partition
// per band. A row longer than the frame is cut into lines; consecutive lines are joined by their step as an ELK edge,
// so ELK puts them one under the other inside the band. ELK then routes every step between rows orthogonally and
// makes room for its label. Two passes: the second orders each box's ports by where their other ends landed.
import { ELK_DEFAULTS, BAND_COL, bandStrips } from './elk.js';
import { rectHit, segHitRect } from '../geom.js';
import { textW } from '../measure.js';

export const ROWS_ELK = {
  ...ELK_DEFAULTS,
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'SPACE_EFFICIENT_LAYER',
  'elk.layered.spacing.nodeNodeBetweenLayers': '30',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.edgeNodeBetweenLayers': '14',
};
// gap: between two boxes of a row. A label fits on its arrow while the gap stays under inlineMax; a longer one goes
// above a short arrow, in a lane of `lane` px on top of the row. maxRow: longest row before it is cut into lines.
export const ROWS = { minGap: 48, labelPad: 24, plainGap: 40, inlineMax: 104, lane: 32, maxRow: 700 };

export function rowGroups(D) {
  const band = (id) => D.box(id).band;
  const parent = Object.fromEntries(D.boxes.map((b) => [b.id, b.id]));
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const inBand = D.steps.filter((s) => !s.alt && band(s.from) === band(s.to));
  for (const s of inBand) parent[find(s.from)] = find(s.to);
  const groups = new Map();
  for (const b of [...D.boxes].sort((a, c) => a.first - c.first)) {
    const r = find(b.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  }
  return { groups: [...groups.values()], inBand };
}

export async function layoutRows(D, ELK, extra = {}) {
  const first = await rowsPass(D, ELK, extra, null);
  if (extra.passes === 1) return first;
  const xs = Object.fromEntries(Object.entries(first.boxes).map(([id, b]) => [id, b.x + b.w / 2]));
  return rowsPass(D, ELK, extra, xs);
}

async function rowsPass(D, ELK, extra, otherX) {
  const o = { ...ROWS, ...extra };
  const { groups, inBand } = rowGroups(D);
  const link = (a, b) => inBand.find((s) => (s.from === a && s.to === b) || (s.from === b && s.to === a));
  const gapOf = (a, b) => {
    const s = link(a.id, b.id);
    if (!s) return { gap: o.plainGap, s: null, above: false };
    const want = s.pill.w + o.labelPad;
    return want > o.inlineMax ? { gap: o.minGap, s, above: true } : { gap: Math.max(o.minGap, want), s, above: false };
  };
  // cut each group into lines no longer than maxRow
  const lines = [];
  for (const g of groups) {
    let cur = [], w = 0;
    g.forEach((b, j) => {
      const add = j > 0 && cur.length ? gapOf(cur[cur.length - 1], b).gap + b.w : b.w;
      if (cur.length && w + add > o.maxRow) { lines.push({ boxes: cur, group: g }); cur = []; w = 0; }
      w += cur.length ? gapOf(cur[cur.length - 1], b).gap + b.w : b.w;
      cur.push(b);
    });
    if (cur.length) lines.push({ boxes: cur, group: g });
  }
  const inner = {}, above = new Set(), inline = new Set();
  lines.forEach((ln, k) => {
    let x = 0;
    ln.boxes.forEach((b, j) => {
      if (j > 0) {
        const gp = gapOf(ln.boxes[j - 1], b);
        if (gp.s) (gp.above ? above : inline).add(gp.s.i);
        x += gp.gap;
      }
      inner[b.id] = { line: k, dx: x, w: b.w, h: b.h };
      x += b.w;
    });
    ln.id = 'n' + k;
    ln.width = x;
    ln.band = ln.boxes[0].bandIndex;
    ln.order = ln.group.indexOf(ln.boxes[0]);
    ln.lane = ln.boxes.some((b, j) => j > 0 && (() => { const s = link(ln.boxes[j - 1].id, b.id); return s && above.has(s.i); })()) ? o.lane : 0;
    ln.height = ln.lane + Math.max(...ln.boxes.map((b) => b.h));
    for (const b of ln.boxes) inner[b.id].top = ln.lane;
  });
  // steps drawn inside a line: between neighbours on the same line. Everything else goes to ELK.
  const local = inBand.filter((s) => inline.has(s.i) || above.has(s.i));
  const cross = D.steps.filter((s) => !local.includes(s));
  // which side of a box a step leaves or enters by: toward the other box's band, or its line inside the band
  const level = (id) => [D.box(id).bandIndex, inner[id].line];
  const sideOf = (me, other) => {
    const [a, la] = level(me), [b, lb] = level(other);
    return b < a || (b === a && lb < la) ? 'NORTH' : 'SOUTH';
  };
  const ends = new Map();
  for (const s of cross) for (const [me, other, role] of [[s.from, s.to, 's'], [s.to, s.from, 't']]) {
    const key = me + '|' + sideOf(me, other);
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push({ s, role, other });
  }
  const ports = Object.fromEntries(lines.map((n) => [n.id, []]));
  for (const [key, list] of ends) {
    const [me, side] = key.split('|');
    const it = inner[me];
    if (otherX) list.sort((a, b) => otherX[a.other] - otherX[b.other] || a.s.i - b.s.i);
    else list.sort((a, b) => a.s.i - b.s.i);
    const span = Math.min(it.w - 36, 26 * (list.length - 1));
    list.forEach((e, j) => {
      const px = it.dx + it.w / 2 + (list.length > 1 ? -span / 2 + (span * j) / (list.length - 1) : 0);
      ports['n' + it.line].push({ id: `p${e.s.i}${e.role}`, x: px, y: side === 'NORTH' ? 0 : it.top + it.h, width: 1, height: 1, layoutOptions: { 'elk.port.side': side } });
    });
  }
  // each line's rank: its band, then its place among the band's lines
  const lineNo = new Map();
  for (const n of lines) { const k = `${n.band}|${n.group[0].id}`; lineNo.set(n, (lineNo.get(k) || 0)); lineNo.set(k, (lineNo.get(k) || 0) + 1); }
  const rankOf = (n) => n.band * 4 + lineNo.get(n);
  const interactive = (extra.elk || {})['elk.layered.layering.strategy'] === 'INTERACTIVE';
  const graph = {
    id: 'root', layoutOptions: { ...ROWS_ELK, ...(extra.elk || {}) },
    children: lines.map((n) => ({
      id: n.id, width: n.width, height: n.height, ports: ports[n.id],
      ...(interactive ? { x: Math.min(...n.boxes.map((b) => b.first)) * 300, y: rankOf(n) * 600 } : {}),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS', 'elk.partitioning.partition': String(n.band) },
    })),
    edges: cross.map((s) => ({
      id: 'e' + s.i, sources: [`p${s.i}s`], targets: [`p${s.i}t`],
      labels: [{ id: 'l' + s.i, text: s.no, width: s.pill.w, height: s.pill.h }],
    })),
  };
  const out = await new ELK().layout(graph);
  const dx = BAND_COL;
  const at = Object.fromEntries(out.children.map((c) => [c.id, c]));
  const boxes = {};
  for (const b of D.boxes) {
    const it = inner[b.id], c = at['n' + it.line];
    boxes[b.id] = { x: c.x + it.dx + dx, y: c.y + it.top, w: b.w, h: b.h };
  }
  const edges = [], labels = [];
  for (const e of out.edges) {
    const i = Number(e.id.slice(1)), sec = e.sections[0], st = D.steps[i];
    const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => [p.x + dx, p.y]);
    // a port on top of a row that has a label lane: carry the line on to the box itself
    const fb = boxes[st.from], tb = boxes[st.to];
    if (pts[0][1] < fb.y - 0.5) pts.unshift([pts[0][0], fb.y]);
    if (pts[pts.length - 1][1] < tb.y - 0.5) pts.push([pts[pts.length - 1][0], tb.y]);
    edges.push({ i, pts });
    const l = e.labels && e.labels[0];
    if (l) labels.push({ i, x: l.x + dx, y: l.y, w: l.width, h: l.height });
  }
  for (const s of local) {
    const a = boxes[s.from], b = boxes[s.to], y = a.y + a.h / 2, right = b.x > a.x;
    const x0 = right ? a.x + a.w : a.x, x1 = right ? b.x : b.x + b.w;
    edges.push({ i: s.i, pts: [[x0, y], [x1, y]] });
    const ly = above.has(s.i) ? a.y - o.lane + (o.lane - s.pill.h) / 2 - 2 : y - s.pill.h / 2;
    labels.push({ i: s.i, x: (x0 + x1) / 2 - s.pill.w / 2, y: ly, w: s.pill.w, h: s.pill.h });
  }
  edges.sort((p, q) => p.i - q.i);
  labels.sort((p, q) => p.i - q.i);
  const width = out.width + dx, height = out.height;
  return { width, height, labelCol: dx, bands: bandStrips(D, boxes, height), boxes, edges, labels, regions: placeFrames(D, boxes, edges, labels, dx) };
}

// Execution-context frames round their boxes; the frame's name goes to whichever corner is clear of labels and lines.
export function placeFrames(D, boxes, edges, labels, minX = 0) {
  const labRects = labels.map((l) => [l.x - 2, l.y - 2, l.x + l.w + 2, l.y + l.h + 2]);
  const boxRects = Object.values(boxes).map((b) => [b.x, b.y, b.x + b.w, b.y + b.h]);
  return D.regions.map((rg) => {
    const gs = rg.boxes.map((id) => boxes[id]);
    const x0 = Math.max(minX + 4, Math.min(...gs.map((g) => g.x)) - 12), y0 = Math.min(...gs.map((g) => g.y)) - 26;
    const x1 = Math.max(...gs.map((g) => g.x + g.w)) + 12, y1 = Math.max(...gs.map((g) => g.y + g.h)) + 26;
    const tw = textW(rg.label, 12) + 4;
    const spots = [
      [x0 + 10, y0 + 16, 'start'], [x1 - 10, y0 + 16, 'end'], [x0 + 10, y1 - 8, 'start'], [x1 - 10, y1 - 8, 'end'],
    ];
    let best = null;
    spots.forEach(([tx, ty, anchor], k) => {
      const r = anchor === 'start' ? [tx - 2, ty - 12, tx + tw, ty + 4] : [tx - tw, ty - 12, tx + 2, ty + 4];
      let cost = k * 0.1;
      for (const q of labRects) if (rectHit(r, q)) cost += 10;
      for (const q of boxRects) if (rectHit(r, q)) cost += 10;
      for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) if (segHitRect(e.pts[i], e.pts[i + 1], r)) cost += 3;
      if (!best || cost < best.cost) best = { cost, tx, ty, anchor };
    });
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1, y1, tx: best.tx, ty: best.ty, anchor: best.anchor };
  });
}
