// (4) d3-force with the bands as constraints: each box is pulled to its band's row and toward its place in the
// reading order, pushed off the others, and held by its steps like springs. y is kept inside the band, so the
// bands stay; lines are straight, and labels are put where they hit least along them.
import { clipToBox, lerp, rectHit, segHitRect } from '../geom.js';

export const FORCE = { W: 1100, LABEL_W: 128, ROW_H: 96, BAND_PAD: 34, TOP: 8, ticks: 600 };

export function layoutForce(D, d3, extra = {}) {
  const o = { ...FORCE, ...extra };
  const used = D.bands.filter((b) => D.boxes.some((x) => x.band === b.id));
  const X0 = o.LABEL_W + 20, X1 = o.W - 16;
  // a band gets a second row of room when its boxes do not fit side by side
  let y = o.TOP;
  const bandY = {};
  for (const b of used) {
    const own = D.boxes.filter((x) => x.band === b.id);
    const rows = Math.max(1, Math.ceil((own.reduce((a, x) => a + x.w, 0) + 40 * (own.length - 1)) / (X1 - X0)));
    const h = o.BAND_PAD * 2 + 66 + (rows - 1) * o.ROW_H + 30;
    bandY[b.id] = { y0: y, y1: y + h };
    y += h;
  }
  const height = y + o.TOP;
  const order = [...D.boxes].sort((a, b) => a.first - b.first);
  const nodes = order.map((b, k) => {
    const { y0, y1 } = bandY[b.band];
    const tx = X0 + b.w / 2 + (X1 - X0 - b.w) * (order.length > 1 ? k / (order.length - 1) : 0.5);
    return { id: b.id, w: b.w, h: b.h, tx, ty: (y0 + y1) / 2, lo: y0 + 16 + b.h / 2, hi: y1 - 16 - b.h / 2, x: tx, y: (y0 + y1) / 2 };
  });
  // a deterministic start: no randomness, so the same data gives the same picture
  nodes.forEach((n, k) => { n.y += ((k % 3) - 1) * 6; });
  const links = D.steps.map((s) => ({ source: s.from, target: s.to, alt: !!s.alt }));
  const pad = 26;
  const rectCollide = () => {
    let ns;
    const f = (alpha) => {
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j];
        const ox = (a.w + b.w) / 2 + pad - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + pad / 2 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          const k = alpha == null ? 1 : Math.min(1, 0.3 + alpha * 4);
          if (ox < oy * 1.6) { const s = (a.x < b.x ? -1 : 1) * ox * 0.5 * k; a.x += s; b.x -= s; }
          else { const s = (a.y < b.y ? -1 : 1) * oy * 0.5 * k; a.y += s; b.y -= s; }
        }
      }
    };
    f.initialize = (n) => { ns = n; };
    return f;
  };
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(210).strength((l) => (l.alt ? 0.05 : 0.18)))
    .force('charge', d3.forceManyBody().strength(-700).distanceMax(600))
    .force('x', d3.forceX((d) => d.tx).strength(0.07))
    .force('y', d3.forceY((d) => d.ty).strength(0.5))
    .force('rect', rectCollide())
    .stop();
  const clamp = () => { for (const n of nodes) { n.y = Math.max(n.lo, Math.min(n.hi, n.y)); n.x = Math.max(X0 + n.w / 2, Math.min(X1 - n.w / 2, n.x)); } };
  for (let i = 0; i < o.ticks; i++) { sim.tick(); clamp(); }
  // what the springs leave overlapping is pushed apart without them
  const sep = sim.force('rect');
  for (let i = 0; i < 80; i++) { sep(null); clamp(); }
  const boxes = {};
  for (const n of nodes) boxes[n.id] = { x: Math.round(n.x - n.w / 2), y: Math.round(n.y - n.h / 2), w: n.w, h: n.h };
  const edges = D.steps.map((s) => {
    const A = boxes[s.from], B = boxes[s.to];
    const ca = [A.x + A.w / 2, A.y + A.h / 2], cb = [B.x + B.w / 2, B.y + B.h / 2];
    return { i: s.i, pts: [clipToBox(A, cb), clipToBox(B, ca, 2)] };
  });
  // labels: along each line, where they cover the fewest boxes, labels and other lines
  const avoid = Object.values(boxes).map((b) => [b.x - 4, b.y - 4, b.x + b.w + 4, b.y + b.h + 4]);
  avoid.push([0, 0, o.LABEL_W + 2, height]);
  const placed = [];
  const labels = D.steps.map((s, k) => {
    const [p, q] = edges[k].pts, w = s.pill.w, h = s.pill.h;
    let best = null;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) for (const off of [0, -18, 18, -32, 32]) {
      const cx = lerp(p[0], q[0], t), cy = lerp(p[1], q[1], t) + off;
      const rc = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
      let cost = Math.abs(t - 0.5) + Math.abs(off) / 40;
      if (rc[0] < o.LABEL_W + 4 || rc[2] > o.W - 2 || rc[1] < 2 || rc[3] > height - 2) cost += 30;
      for (const a of avoid) if (rectHit(rc, a)) cost += 10;
      for (const a of placed) if (rectHit(rc, a)) cost += 10;
      edges.forEach((e, j) => { if (j !== k && segHitRect(e.pts[0], e.pts[1], rc)) cost += 2; });
      if (!best || cost < best.cost) best = { cost, rc };
    }
    placed.push(best.rc);
    return { i: s.i, x: best.rc[0], y: best.rc[1], w, h };
  });
  const bands = used.map((b) => ({ ...b, y0: bandY[b.id].y0, y1: bandY[b.id].y1 }));
  bands[0].y0 = 0; bands[bands.length - 1].y1 = height;
  const regions = D.regions.map((rg) => {
    const gs = rg.boxes.map((id) => boxes[id]);
    const x0 = Math.max(o.LABEL_W + 4, Math.min(...gs.map((g) => g.x)) - 12), y0 = Math.min(...gs.map((g) => g.y)) - 22;
    const x1 = Math.max(...gs.map((g) => g.x + g.w)) + 12, y1 = Math.max(...gs.map((g) => g.y + g.h)) + 12;
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1, y1, tx: x0 + 10, ty: y0 + 14, anchor: 'start' };
  });
  return { width: o.W, height, labelCol: o.LABEL_W, bands, boxes, edges, labels, regions };
}
