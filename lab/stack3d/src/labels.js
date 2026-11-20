// HTML labels over the WebGL canvas. Every label asks for its anchor on the screen, then labels are
// placed from the most important down, in two rounds:
//   1. every label in its smallest form (a step's number, a block's name), so nothing that carries
//      the story is pushed out by something that only adds to it;
//   2. in order of importance, labels grow into their fuller forms (the step's verb, the block's
//      subtitle) where there is room.
// A label never overlaps another label or the page's own panels (hard obstacles). Among the spots
// left, it takes the cheapest: each candidate costs its rank in the label's own order of preference
// (near its block or tube first), plus a penalty for every tube or plate edge it would cover and a
// bigger one for every block it would cover (soft obstacles, `pen`). A label whose best spot costs
// more than `max` stays hidden, except labels marked `force` (the current step's two blocks and its
// badge), which always show. A label visible last frame wins ties, so labels do not flicker while
// the camera moves. Nothing is recomputed while the picture stands still.

const PAD = 3;

const hitRect = (r, p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0;
// Does the segment a→b touch the rectangle r? (Liang–Barsky clipping)
function segHits(ax, ay, bx, by, r) {
  if (Math.max(ax, bx) < r.x0 || Math.min(ax, bx) > r.x1 || Math.max(ay, by) < r.y0 || Math.min(ay, by) > r.y1) return false;
  if (ax >= r.x0 && ax <= r.x1 && ay >= r.y0 && ay <= r.y1) return true;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay);
}
// a polyline { pts: [x, y, x, y…], hw (half width), bb } against a rectangle
function lineHits(l, r) {
  if (!hitRect(l.bb, r)) return false;
  const g = { x0: r.x0 - l.hw, y0: r.y0 - l.hw, x1: r.x1 + l.hw, y1: r.y1 + l.hw };
  const p = l.pts;
  for (let k = 2; k < p.length; k += 2) if (segHits(p[k - 2], p[k - 1], p[k], p[k + 1], g)) return true;
  return false;
}

export class Labels {
  constructor(layer) {
    this.layer = layer;
    this.items = new Map();
    this.obstacles = () => [];  // hard: rectangles of the page's panels over the stage
    this.geometry = () => null; // soft: { rects: [{x0,y0,x1,y1,owner}], lines: [{pts,hw,bb,owner}] }
    this.viewKey = () => "";    // changes whenever the picture moves
    this.animating = () => false;
    this.size = { w: 1, h: 1 };
    this.version = 0;
  }
  setSize(w, h) { this.size = { w, h }; this.touch(); }
  // something about the labels changed (text, importance, state): place them again
  touch() { this.version++; }

  // spec: { el, prio, anchor() → {ok, …}, cands(a, w, h, variant) → [{x, y}],
  //         variants: forms tried in the first round, richest first (default ["full"]),
  //         rich: fuller forms tried in the second round, richest first (optional), growPrio,
  //         pen: { tube, rim, block }: the cost of covering a tube, a plate's edge, a block,
  //         max: the most a spot may cost in round 1 (else hidden), step: cost per candidate rank,
  //         owner: soft obstacles that belong to the label (its own block or tube), force, pad }
  add(id, spec) {
    this.remove(id);
    const it = { id, ...spec, shown: false, sizes: null, variant: null };
    it.el.classList.add("lbl", "off");
    this.layer.appendChild(it.el);
    this.items.set(id, it);
    this.touch();
    return it;
  }
  remove(id) {
    const it = this.items.get(id);
    if (it) { it.el.remove(); this.items.delete(id); this.touch(); }
  }
  clear(pred = () => true) {
    for (const [id, it] of [...this.items]) if (pred(it)) { it.el.remove(); this.items.delete(id); }
    this.touch();
  }
  get(id) { return this.items.get(id); }

  measure(it) {
    const vs = [...new Set([...(it.variants || ["full"]), ...(it.rich || [])])];
    it.sizes = {};
    const el = it.el;
    const prev = el.dataset.v;
    for (const v of vs) {
      el.dataset.v = v;
      it.sizes[v] = [el.offsetWidth, el.offsetHeight];
    }
    el.dataset.v = prev || vs[0];
  }
  remeasure() { for (const it of this.items.values()) it.sizes = null; this.touch(); }

  // hide everything for a moment (while the blocks of a new scene drop in)
  holdFor(ms) { this.hold = performance.now() + ms; }

  update() {
    if (this.hold && performance.now() < this.hold) {
      for (const it of this.items.values()) if (it.shown) { it.el.classList.add("off"); it.shown = false; }
      this.lastKey = null;
      return;
    }
    const key = `${this.viewKey()}#${this.version}#${this.size.w}x${this.size.h}`;
    if (key === this.lastKey && !this.animating()) return;
    this.lastKey = key;

    const hard = this.obstacles();
    const geo = this.geometry() || { rects: [], lines: [] };
    const placed = [];
    const items = [...this.items.values()].filter((it) => !it.hidden);
    for (const it of items) {
      it._a = it.anchor();
      if (it._a && it._a.ok !== false && !it.sizes) this.measure(it);
    }
    // `nudge` refines the order among equals from the anchor (a short tube has fewer spots: first)
    const rank = (it) => it.prio + (it.nudge ? it.nudge(it._a) : 0) + (it.shown ? 0.5 : 0);
    for (const it of items) it._rank = rank(it);
    const order = items.slice().sort((a, b) => b._rank - a._rank);
    const got = new Map();
    // round 1: everything in its smallest form, most important first
    for (const it of order) {
      const a = it._a;
      if (!a || a.ok === false) continue;
      const base = it.variants || ["full"];
      let c = this.spot(it, a, base, hard, placed, geo, Infinity, it.force ? Infinity : it.max ?? Infinity);
      if (!c && it.force) c = this.spot(it, a, [base[base.length - 1]], hard, null, geo, Infinity, Infinity);
      if (c) { placed.push(c.r); got.set(it, c); }
    }
    // round 2: grow where there is room, covering no more of the drawing than round 1 did
    const growers = order.filter((it) => it.rich && got.has(it)).sort((a, b) => (b.growPrio ?? b.prio) - (a.growPrio ?? a.prio));
    for (const it of growers) {
      const cur = got.get(it);
      placed.splice(placed.indexOf(cur.r), 1);
      const c = this.spot(it, it._a, it.rich, hard, placed, geo, cur.soft + (it.growSlack ?? 0), Infinity);
      if (c) { placed.push(c.r); got.set(it, c); } else placed.push(cur.r);
    }
    for (const it of this.items.values()) {
      const c = it.hidden ? null : got.get(it);
      if (c) {
        if (it.variant !== c.v) { it.el.dataset.v = c.v; it.variant = c.v; }
        it.el.style.transform = `translate3d(${Math.round(c.x)}px, ${Math.round(c.y)}px, 0)`;
        if (!it.shown) { it.el.classList.remove("off"); it.shown = true; }
        it.pos = c;
      } else if (it.shown) {
        it.el.classList.add("off");
        it.shown = false;
        it.pos = null;
      }
    }
  }

  // The cheapest spot: rank among the candidates (and among the variants, richest first), plus the
  // penalties for what it covers. `maxSoft` limits the penalties, `maxCost` the whole cost.
  spot(it, a, variants, hard, placed, geo, maxSoft = Infinity, maxCost = Infinity) {
    const { w, h } = this.size;
    const pad = it.pad ?? PAD;
    const own = it.owner ? [].concat(it.owner) : [];
    const pen = it.pen || { tube: 4, rim: 3, block: 40 };
    const rects = pen.block ? geo.rects.filter((o) => !own.includes(o.owner)) : [];
    const lines = geo.lines.filter((o) => pen[o.kind] && !own.includes(o.owner));
    const vcost = it.vcost ?? 6;
    let best = null;
    variants.forEach((v, vi) => {
      const sz = it.sizes?.[v];
      if (!sz) return;
      const [lw, lh] = sz;
      const cands = it.cands(a, lw, lh, v);
      for (let k = 0; k < cands.length; k++) {
        const rank = k * (it.step ?? 1) + vi * vcost;
        if (best && rank >= best.cost) break;
        const c = cands[k];
        const r = { x0: c.x - pad, y0: c.y - pad, x1: c.x + lw + pad, y1: c.y + lh + pad };
        if (r.x1 < 0 || r.y1 < 0 || r.x0 > w || r.y0 > h) continue;
        if (!it.overflow && (r.x0 < 2 || r.y0 < 2 || r.x1 > w - 2 || r.y1 > h - 2)) continue;
        if (hard.some((p) => hitRect(r, p))) continue;
        if (placed && placed.some((p) => hitRect(r, p))) continue;
        // the drawing only matters under the label itself, not under its padding
        const t = { x0: c.x + 1, y0: c.y + 1, x1: c.x + lw - 1, y1: c.y + lh - 1 };
        let soft = 0;
        for (const p of rects) if (hitRect(t, p)) soft += pen.block;
        if (soft > maxSoft || (best && rank + soft >= best.cost)) continue;
        for (const l of lines) if (lineHits(l, t)) soft += pen[l.kind];
        if (soft > maxSoft) continue;
        const cost = rank + soft;
        if (!best || cost < best.cost) best = { x: c.x, y: c.y, v, r, cost, soft };
      }
    });
    if (!best || best.cost > maxCost) return null;
    return best;
  }
}

// Candidate positions, as functions of an anchor and a label size.
export const at = {
  center: (a, w, h) => [{ x: a.cx - w / 2, y: a.cy - h / 2 }],
  // a block's name plate: on the plate in front of the block, slid sideways, beside the block,
  // above it, and last on its top face
  blockAround: (a, w, h) => {
    const bw = a.x1 - a.x0, slide = Math.max(0, (w - bw * 0.6) / 2) + bw * 0.22;
    const c = a.cx - w / 2, below = a.y1 + 2;
    const out = [{ x: c, y: below }];
    for (const f of [0.45, 0.9, 1.35]) out.push({ x: c - slide * f, y: below }, { x: c + slide * f, y: below });
    out.push({ x: a.x1 + 6, y: a.y1 - h - 2 }, { x: a.x0 - w - 6, y: a.y1 - h - 2 });
    out.push({ x: a.x1 + 6, y: a.y0 + 2 }, { x: a.x0 - w - 6, y: a.y0 + 2 });
    out.push({ x: c, y: a.y0 - h - 4 });
    out.push({ x: c, y: a.cy - h / 2 });
    return out;
  },
  // a step's badge: on its tube as near the middle as there is room, else beside the tube
  along: (a, w, h) => {
    const out = [];
    for (const p of a.pts) out.push({ x: p.x - w / 2, y: p.y - h / 2 });
    for (const p of a.pts) out.push({ x: p.x + 5, y: p.y - h / 2 }, { x: p.x - w - 5, y: p.y - h / 2 }, { x: p.x - w / 2, y: p.y - h - 4 }, { x: p.x - w / 2, y: p.y + 4 });
    return out;
  },
  chip: (a, w, h) => [
    { x: a.x + 16, y: a.y - h - 6 },
    { x: a.x - w - 16, y: a.y - h - 6 },
    { x: a.x + 16, y: a.y + 8 },
    { x: a.x - w - 16, y: a.y + 8 },
  ],
  // a layer's name: left of the plate's front-left corner (inside the plate when that is off screen)
  plate: (a, w, h) => (a.inside
    ? [{ x: a.x + 4, y: a.y - h - 6 }, { x: a.x + 4, y: a.y + 6 }]
    : [{ x: a.x - w - 14, y: a.y - h / 2 }, { x: a.x - w - 14, y: a.y - h + 4 }, { x: a.x - w - 14, y: a.y - 4 }, { x: a.x + 12, y: a.y - h - 4 }]),
  // an execution context: hanging under the front edge of its frame, from the corner inward, else
  // just above that edge, else beside the corner, else over the frame's back edge
  region: (a, w, h) => {
    const out = [];
    for (const p of a.pts) out.push({ x: a.right ? p.x - w - 4 : p.x + 4, y: p.y + 3 });
    for (const p of a.pts) out.push({ x: a.right ? p.x - w - 4 : p.x + 4, y: p.y - h - 3 });
    const c = a.pts[0];
    out.push({ x: a.right ? c.x + 6 : c.x - w - 6, y: c.y - h / 2 });
    for (const p of a.back || []) out.push({ x: a.right ? p.x - w - 4 : p.x + 4, y: p.y - h - 2 });
    return out;
  },
  // a small tag over a block ("ここから")
  above: (a, w, h) => [
    { x: a.cx - w / 2, y: a.y0 - h - 3 },
    { x: a.x0 - w - 4, y: a.y0 },
    { x: a.x1 + 4, y: a.y0 },
    { x: a.x0 - w - 4, y: a.cy - h / 2 },
  ],
};
