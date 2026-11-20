// (1) The current viewer's own placement, ported from lab/reference/index.html (autoLayout, autoPorts, route,
// mapPillSpots/tagSpot, regionGeom) so it can be measured beside the others. Bands are fixed rows; inside a band,
// boxes keep the order the steps first reach them, lean toward the boxes they talk to, and take a second lane when
// a row is too narrow. Lines are orthogonal, chosen among a few candidates by cost; labels go where they hit least.
// Like the reference, a label that has no room drops its verb or its data (opts.trim, on by default): that is how
// the current map keeps labels off boxes. With trim: false every label keeps all its parts.
import { lerp, rectHit, segHitRect } from '../geom.js';
import { textW } from '../measure.js';
import { PICKS, pillWidth } from '../model.js';

export const HAND = { W: 1100, LABEL_W: 128, LANE_H: 120, EMPTY_H: 48, TOP: 8, BOX_Y: 28 };

export function layoutHand(D, opts = {}) {
  const trim = opts.trim !== false;
  const { W, LABEL_W, LANE_H, EMPTY_H, TOP, BOX_Y } = HAND;
  const boxes = D.boxes.map((b) => ({ id: b.id, layer: b.band, w: b.w, h: b.h, first: b.first, lane: 0, x: null }));
  const by = Object.fromEntries(boxes.map((b) => [b.id, b]));
  const steps = D.steps.map((s) => ({ ...s, dx: null, ly: 0 }));
  const bands = D.bands;

  // ---- where boxes go (autoLayout) ----
  const X0 = LABEL_W + 22, X1 = W - 12, GAP = 46;
  const talk = (b) => steps.filter((st) => !st.alt && (st.from === b.id || st.to === b.id)).map((st) => by[st.from === b.id ? st.to : st.from]);
  const bandAt = (b) => bands.findIndex((l) => l.id === b.layer);
  for (const band of bands) {
    const own = boxes.filter((b) => b.layer === band.id);
    if (!own.length) continue;
    const need = own.reduce((a, b) => a + b.w, 0) + GAP * (own.length - 1);
    for (const b of own) b.lane = 0;
    if (need <= X1 - X0) continue;
    const pull = (b) => talk(b).reduce((a, o) => a + Math.sign(bandAt(o) - bandAt(b)), 0);
    const side = (b) => (talk(b).length ? 0 : 1);
    const down = [...own].sort((a, b) => side(b) - side(a) || pull(b) - pull(a) || b.first - a.first);
    let top = need;
    for (const b of down) { if (top <= X1 - X0) break; b.lane = 1; top -= b.w + GAP; }
  }
  const rowsOf = new Map();
  for (const b of boxes) { const k = b.layer + '|' + b.lane; if (!rowsOf.has(k)) rowsOf.set(k, []); rowsOf.get(k).push(b); }
  const order = [...boxes].sort((a, b) => a.first - b.first);
  order.forEach((b, k) => { b.x = X0 + (X1 - X0 - b.w) * (order.length > 1 ? k / (order.length - 1) : 0.5); });
  const settle = () => {
    for (const row of rowsOf.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i - 1].x + row[i - 1].w + GAP);
      const over = row[row.length - 1].x + row[row.length - 1].w - X1;
      if (over > 0) {
        row[row.length - 1].x -= over;
        for (let i = row.length - 2; i >= 0; i--) row[i].x = Math.min(row[i].x, row[i + 1].x - GAP - row[i].w);
      }
      for (const b of row) b.x = Math.max(X0, b.x);
    }
  };
  settle();
  for (let it = 0; it < 14; it++) {
    for (const b of boxes) {
      const nb = talk(b).filter((o) => o.layer !== b.layer || o.lane !== b.lane);
      if (!nb.length) continue;
      const want = nb.reduce((a, o) => a + o.x + o.w / 2, 0) / nb.length - b.w / 2;
      b.x += (want - b.x) * 0.35;
    }
    settle();
  }
  for (const b of boxes) b.x = Math.round(b.x / 10) * 10;

  // ---- bands as rows (layout/geom) ----
  const rows = [];
  let y = TOP;
  for (const l of bands) {
    const own = boxes.filter((b) => b.layer === l.id);
    const lanes = own.length ? Math.max(...own.map((b) => b.lane + 1)) : 0;
    const h = lanes ? lanes * LANE_H : EMPTY_H;
    rows.push({ layer: l, y, lanes, h });
    y += h;
  }
  const height = y + TOP;
  const geom = (b) => {
    const r = rows.find((row) => row.layer.id === b.layer);
    const top = r.y + b.lane * LANE_H, gy = top + BOX_Y;
    return { row: rows.indexOf(r), lane: b.lane, top, bottom: top + LANE_H, x: b.x, y: gy, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: gy + b.h / 2 };
  };

  // ---- routes (route) ----
  const crosses = (p, q, g) => {
    const x0 = g.x - 2, x1 = g.x + g.w + 2, y0 = g.y - 2, y1 = g.y + g.h + 2;
    if (p[0] === q[0]) { const lo = Math.min(p[1], q[1]), hi = Math.max(p[1], q[1]); return p[0] > x0 && p[0] < x1 && hi > y0 && lo < y1; }
    const lo = Math.min(p[0], q[0]), hi = Math.max(p[0], q[0]);
    return p[1] > y0 && p[1] < y1 && hi > x0 && lo < x1;
  };
  const onTop = (p, q, r, t) => {
    const v1 = Math.abs(p[0] - q[0]) < 0.5, v2 = Math.abs(r[0] - t[0]) < 0.5, h1 = Math.abs(p[1] - q[1]) < 0.5, h2 = Math.abs(r[1] - t[1]) < 0.5;
    if (v1 && v2 && Math.abs(p[0] - r[0]) < 4) return Math.min(Math.max(p[1], q[1]), Math.max(r[1], t[1])) - Math.max(Math.min(p[1], q[1]), Math.min(r[1], t[1])) > 8;
    if (h1 && h2 && Math.abs(p[1] - r[1]) < 4) return Math.min(Math.max(p[0], q[0]), Math.max(r[0], t[0])) - Math.max(Math.min(p[0], q[0]), Math.min(r[0], t[0])) > 8;
    return false;
  };
  const route = (st, prior = []) => {
    const A = by[st.from], B = by[st.to], a = geom(A), b = geom(B);
    const [dxa, dxb] = st.dx || [0, 0];
    let cands;
    if (a.row === b.row && a.lane === b.lane) {
      cands = [b.x > a.x ? [[a.x + a.w, a.cy], [b.x, b.cy]] : [[a.x, a.cy], [b.x + b.w, b.cy]]];
    } else {
      const up = b.y < a.y, sx = a.cx + dxa, ex = b.cx + dxb;
      const sy = up ? a.y : a.y + a.h, ey = up ? b.y + b.h : b.y;
      const l1 = (up ? a.top : a.bottom) + (st.ly || 0), l2 = (up ? b.bottom : b.top) + (st.ly || 0);
      cands = sx === ex ? [[[sx, sy], [ex, ey]]] : [];
      cands.push(...[l1, l2].map((ly) => [[sx, sy], [sx, ly], [ex, ly], [ex, ey]]));
      if (Math.abs(l1 - l2) > 1) {
        const xs = new Set([LABEL_W + 12]);
        for (const x of boxes) { const g = geom(x); xs.add(g.x - 16); xs.add(g.x + g.w + 16); }
        for (const cx of xs) if (cx > LABEL_W + 4 && cx < W - 4) cands.push([[sx, sy], [sx, l1], [cx, l1], [cx, l2], [ex, l2], [ex, ey]]);
      }
    }
    const others = boxes.filter((x) => x !== A && x !== B).map(geom);
    const cost = (pts) => {
      let n = 0, len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        for (const g of others) if (crosses(pts[i], pts[i + 1], g)) n++;
        len += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      }
      let shared = 0;
      for (const r of prior) for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < r.pts.length - 1; k++) if (onTop(pts[i], pts[i + 1], r.pts[k], r.pts[k + 1])) shared++;
      return n * 1000 + shared * 300 + len + 30 * Math.max(0, pts.length - 2);
    };
    const pts = cands.reduce((best, c) => (cost(c) < cost(best) ? c : best));
    let at = 0, best = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      if (len > best) { best = len; at = i; }
    }
    const p = pts[at], q = pts[at + 1];
    return { pts, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], horizontal: p[1] === q[1] };
  };

  // ---- ports spread over an edge, runs lifted off each other (autoPorts) ----
  const ends = new Map();
  const put = (key, item) => { if (!ends.has(key)) ends.set(key, []); ends.get(key).push(item); };
  for (const st of steps) {
    const A = by[st.from], B = by[st.to], a = geom(A), b = geom(B);
    if (a.row === b.row && a.lane === b.lane) continue;
    const down = b.y > a.y;
    put(A.id + (down ? '|b' : '|t'), { st, end: 0, other: b.cx });
    put(B.id + (down ? '|t' : '|b'), { st, end: 1, other: a.cx });
  }
  for (const [key, list] of ends) {
    const box = by[key.split('|')[0]];
    list.sort((p, q) => p.other - q.other);
    const step = list.length > 1 ? Math.min(30, (box.w - 40) / (list.length - 1)) : 0;
    list.forEach((it, j) => { (it.st.dx = it.st.dx || [0, 0])[it.end] = Math.round((j - (list.length - 1) / 2) * step); });
  }
  const runs = (st) => {
    const r = route(st), out = [];
    for (let k = 0; k < r.pts.length - 1; k++) {
      const p = r.pts[k], q = r.pts[k + 1];
      if (Math.abs(p[1] - q[1]) < 0.5 && Math.abs(p[0] - q[0]) > 4) out.push([p[1], Math.min(p[0], q[0]), Math.max(p[0], q[0])]);
    }
    return out;
  };
  const lifts = [12, -12, 24, -24];
  for (let j = 1; j < steps.length; j++) {
    for (let tries = 0; tries < lifts.length; tries++) {
      const mine = runs(steps[j]);
      const clash = steps.slice(0, j).some((o) => runs(o).some(([yy, a, b]) => mine.some(([y2, a2, b2]) => Math.abs(yy - y2) < 4 && Math.min(b, b2) - Math.max(a, a2) > 8)));
      if (!clash) break;
      steps[j].ly = lifts[tries];
    }
  }
  const routes = [];
  for (const st of steps) routes.push(route(st, routes));

  // ---- regions (regionGeom) ----
  const regions = D.regions.map((rg) => {
    const gs = rg.boxes.map((id) => geom(by[id]));
    const x0 = Math.max(LABEL_W + 6, Math.min(...gs.map((g) => g.x)) - 12), y0 = Math.min(...gs.map((g) => g.y)) - 18;
    const x1 = Math.min(W - 4, Math.max(...gs.map((g) => g.x + g.w)) + 12), y1 = Math.max(...gs.map((g) => g.y + g.h)) + 12;
    const at = rg.at || 'tl';
    let tx = x0 + 10, ty = y0 + 4, anchor = 'start';
    if (at === 'tr') { tx = x1 - 10; anchor = 'end'; }
    if (at === 'bl') ty = y1 + 4;
    if (at === 'br') { tx = x1 - 10; ty = y1 + 4; anchor = 'end'; }
    if (at === 'r') { tx = x1 + 8; ty = (y0 + y1) / 2 + 4; }
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1, y1, tx, ty, anchor };
  });

  // ---- labels (mapPillSpots + tagSpot): each way of cutting the label is tried, a cut costs a little ----
  const avoid = [[0, 0, LABEL_W + 2, height]];
  for (const b of boxes) { const g = geom(b); avoid.push([g.x - 3, g.y - 3, g.x + g.w + 3, g.y + g.h + 3]); }
  for (const r of regions) avoid.push(regionLabelRect(r));
  const placed = [];
  const labels = steps.map((st, i) => {
    const r = routes[i], p = st.pill, [mx, my] = r.mid, others = routes.filter((_, k) => k !== i).map((q) => q.pts);
    const picks = trim ? PICKS.filter(([v, c]) => (!v || p.verb) && (!c || p.chip)) : [[true, true]];
    let choice = null;
    for (const pick of picks) {
      const w = pillWidth(p, pick), cut = (p.verb && !pick[0] ? 2.5 : 0) + (p.chip && !pick[1] ? 1.5 : 0);
      const pref = r.horizontal ? [mx - w / 2, my, -0.6] : [mx + 6, my, -0.6];
      const best = tagSpot(r.pts, w, avoid, placed, others, W, height, [pref]) || { cost: 99, lx: pref[0], cy: pref[1] };
      if (!choice || best.cost + cut < choice.cost) choice = { cost: best.cost + cut, lx: best.lx, cy: best.cy, w, pick };
    }
    const w = choice.w, lx = Math.max(LABEL_W + 4, Math.min(W - 4 - w, choice.lx));
    placed.push([lx, choice.cy - 12, lx + w, choice.cy + 12]);
    return { i: st.i, x: lx, y: choice.cy - 12, w, h: 24, pick: choice.pick };
  });

  const out = {
    width: W, height, labelCol: LABEL_W,
    bands: rows.map((r) => ({ ...r.layer, y0: r.y, y1: r.y + r.h, lanes: r.lanes, empty: !r.lanes })),
    boxes: Object.fromEntries(boxes.map((b) => { const g = geom(b); return [b.id, { x: g.x, y: g.y, w: g.w, h: g.h }]; })),
    edges: steps.map((st, i) => ({ i: st.i, pts: routes[i].pts.map((p) => [p[0], p[1]]) })),
    labels, regions,
  };
  return out;
}

export function regionLabelRect(r) {
  const tw = textW(r.label, 12);
  return r.anchor === 'end' ? [r.tx - tw - 2, r.ty - 12, r.tx + 2, r.ty + 4] : [r.tx - 2, r.ty - 12, r.tx + tw + 2, r.ty + 4];
}

function tagSpot(pts, w, avoid, placed, lines, W, VH, extra = [], lineCost = 1) {
  const cands = [...extra];
  for (let n = 0; n < pts.length - 1; n++) {
    const p = pts[n], q = pts[n + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]), vert = Math.abs(p[0] - q[0]) < 0.5;
    if (len < 18) continue;
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
      const mx = lerp(p[0], q[0], f), my = lerp(p[1], q[1], f), d = Math.abs(f - 0.5);
      if (vert) cands.push([mx + 8, my, d], [mx - 8 - w, my, d + 0.2]);
      else cands.push([mx - w / 2, my, d], [mx - w / 2, my - 16, d + 0.5]);
    }
  }
  let best = null;
  for (const [lx, cy, base] of cands) {
    const rc = [lx, cy - 12, lx + w, cy + 12];
    let cost = base;
    if (rc[0] < 2 || rc[2] > W - 2 || rc[1] < 2 || rc[3] > VH - 2) cost += 30;
    for (const a of avoid) if (rectHit(rc, a)) cost += 10;
    for (const a of placed) if (rectHit(rc, a)) cost += 10;
    for (const l of lines) for (let m = 0; m < l.length - 1; m++) if (segHitRect(l[m], l[m + 1], rc)) cost += lineCost;
    if (!best || cost < best.cost) best = { cost, lx, cy };
  }
  return best;
}
