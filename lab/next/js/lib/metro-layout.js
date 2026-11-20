// Classic-script copy (no modules, so it loads from any origin): window.METROL.
(function () {
'use strict';
// ---- from metro/js/layout.js
// Metro layout.
//
// 1. Grid: every station gets an integer cell. Rows belong to the station's layer (its district),
//    columns follow the order the lines visit stations. Simulated annealing then moves stations,
//    swaps them and flips bends to make the map read like a designed metro map: straight track,
//    45° bends instead of right angles, no line through a station, few crossings, room for every
//    label, and a compact width.
// 2. Scene: pixels. Octilinear routes with rounded bends, parallel lanes where lines share track,
//    pill-shaped interchanges, and labels placed where they cross no line and no other label.
//
// No DOM here: the page passes a text measuring function; tools/precompute.mjs runs step 1 in node.

const GRID = { unit: 52, gutter: 104, top: 28, bottom: 34, right: 24, cols: 21 };
const FONT = { name: 14.2, sub: 12.5, ns: 12.4 };
// Label lines: the name, the namespace (mono, small) and the sub line.
const LINE_H = { name: 19, ns: 15.5, sub: 17 };

// ---------------------------------------------------------------- small helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough text width, for the grid step (the page measures real text for the final placement).
function estimateWidth(text, size, mono) {
  let w = 0;
  for (const ch of text || "") {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80) w += size * 1.0;
    else if (mono) w += size * 0.6;
    else if (/[A-Z0-9%]/.test(ch)) w += size * 0.64;
    else if (/[ il.,'|:;!・()\[\]]/.test(ch)) w += size * 0.3;
    else w += size * 0.54;
  }
  return w;
}

function labelSize(st, measure) {
  const v = labelVariants(st, measure);
  return { w: v[0].w, h: v[0].h, w1: v[v.length - 1].w };
}

// The ways a label can be shown, best first: everything; without the namespace; without the sub
// line; the name alone. The placer takes the first that fits (the later ones cost a little).
function labelVariants(st, measure, slimCost = 10) {
  const m = measure || ((t, size, mono) => estimateWidth(t, size, mono));
  const w1 = Math.ceil(m(st.name, FONT.name, st.codeName)) + 2;
  const w2 = st.sub ? Math.ceil(m(st.sub, FONT.sub, false)) + 2 : 0;
  const w3 = st.ns ? Math.ceil(m(st.ns, FONT.ns, true)) + 2 : 0;
  const out = [{ v: "full", w: Math.max(w1, w2, w3), h: LINE_H.name + (w3 ? LINE_H.ns : 0) + (w2 ? LINE_H.sub : 0), cost: 0 }];
  if (w2 && w3) {
    out.push({ v: "sub", w: Math.max(w1, w2), h: LINE_H.name + LINE_H.sub, cost: 5 });
    out.push({ v: "ns", w: Math.max(w1, w3), h: LINE_H.name + LINE_H.ns, cost: 7 });
  }
  if (w2 || w3) out.push({ v: "name", w: w1, h: LINE_H.name, cost: slimCost });
  return out;
}

// Rows per district, from how many stations it holds.
function zoneRows(n) {
  return Math.max(1, Math.min(5, Math.ceil(n / 3)));
}

// ---------------------------------------------------------------- labels (shared by both steps)
// items: {x, y, box:[x0,y0,x1,y1], variants:[{v, w, h, cost}]} (best first); segs: flat
// [x1,y1,x2,y2,...] in px. Returns {pick: [{side, r, variant, slim, v}], cost}. "fast" is one greedy
// pass over the first and last variants only (for the optimizer).
const SIDES = [
  // side, cost, rect(x, y, box, w, h). Diagonal sides keep clear of a line through the centre.
  ["E", 0, (x, y, b, w, h) => [b[2] + 5, y - h / 2, b[2] + 5 + w, y + h / 2]],
  ["W", 0.6, (x, y, b, w, h) => [b[0] - 5 - w, y - h / 2, b[0] - 5, y + h / 2]],
  ["S", 1.4, (x, y, b, w, h) => [x - w / 2, b[3] + 3, x + w / 2, b[3] + 3 + h]],
  ["N", 1.4, (x, y, b, w, h) => [x - w / 2, b[1] - 3 - h, x + w / 2, b[1] - 3]],
  ["NE", 2.2, (x, y, b, w, h) => [x + 10, b[1] - 1 - h, x + 10 + w, b[1] - 1]],
  ["SE", 2.2, (x, y, b, w, h) => [x + 10, b[3] + 1, x + 10 + w, b[3] + 1 + h]],
  ["NW", 2.6, (x, y, b, w, h) => [x - 10 - w, b[1] - 1 - h, x - 10, b[1] - 1]],
  ["SW", 2.6, (x, y, b, w, h) => [x - 10 - w, b[3] + 1, x - 10, b[3] + 1 + h]],
  ["E+", 3.0, (x, y, b, w, h) => [b[2] + 3, y + 8, b[2] + 3 + w, y + 8 + h]],
  ["E-", 3.0, (x, y, b, w, h) => [b[2] + 3, y - 8 - h, b[2] + 3 + w, y - 8]],
  ["W+", 3.2, (x, y, b, w, h) => [b[0] - 3 - w, y + 8, b[0] - 3, y + 8 + h]],
  ["W-", 3.2, (x, y, b, w, h) => [b[0] - 3 - w, y - 8 - h, b[0] - 3, y - 8]],
  ["S<", 3.6, (x, y, b, w, h) => [x - w + 12, b[3] + 3, x + 12, b[3] + 3 + h]],
  ["S>", 3.6, (x, y, b, w, h) => [x - 12, b[3] + 3, x - 12 + w, b[3] + 3 + h]],
  ["N<", 3.6, (x, y, b, w, h) => [x - w + 12, b[1] - 3 - h, x + 12, b[1] - 3]],
  ["N>", 3.6, (x, y, b, w, h) => [x - 12, b[1] - 3 - h, x - 12 + w, b[1] - 3]],
  // the name level with the station and the other lines hanging below it (tall labels), or above
  ["Eb", 1.0, (x, y, b, w, h) => [b[2] + 5, y - 9.5, b[2] + 5 + w, y - 9.5 + h]],
  ["Wb", 1.6, (x, y, b, w, h) => [b[0] - 5 - w, y - 9.5, b[0] - 5, y - 9.5 + h]],
  ["Et", 2.4, (x, y, b, w, h) => [b[2] + 5, y + 9.5 - h, b[2] + 5 + w, y + 9.5]],
  ["Wt", 2.8, (x, y, b, w, h) => [b[0] - 5 - w, y + 9.5 - h, b[0] - 5, y + 9.5]],
];
function placeLabels(items, segs, bounds, opt = {}) {
  const pad = opt.pad ?? 6;
  const HIT = opt.hit ?? 40;
  const blocks = opt.blocks || [];
  const nSides = opt.fast ? 8 : SIDES.length;
  // Buckets of segments and station boxes, so a label only looks at what is near it.
  const C = opt.cell ?? 52;
  const x0 = bounds[0] - 240, y0 = bounds[1] - 240;
  const cols = Math.ceil((bounds[2] - x0 + 480) / C) + 1, rows = Math.ceil((bounds[3] - y0 + 480) / C) + 1;
  const segB = new Array(cols * rows), boxB = new Array(cols * rows);
  const put = (B, ax, ay, bx, by, v) => {
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - x0) / C)), c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) - x0) / C));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - y0) / C)), r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) - y0) / C));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (B[r * cols + c] ||= []).push(v);
  };
  for (let k = 0; k < segs.length; k += 4) put(segB, segs[k], segs[k + 1], segs[k + 2], segs[k + 3], k);
  for (let j = 0; j < items.length; j++) put(boxB, items[j].box[0], items[j].box[1], items[j].box[2], items[j].box[3], j);
  let stamp = 1;
  const seenSeg = new Int32Array((segs.length >> 2) + 1), seenBox = new Int32Array(items.length);
  const RR = [0, 0, 0, 0];
  const rectCost = (i, side, r, variantCost, others) => {
    let v = side[1] + variantCost;
    const R0 = r[0] - pad, R1 = r[1] - pad, R2 = r[2] + pad, R3 = r[3] + pad;
    if (r[0] < bounds[0] || r[1] < bounds[1] || r[2] > bounds[2] || r[3] > bounds[3]) v += HIT;
    RR[0] = R0; RR[1] = R1; RR[2] = R2; RR[3] = R3;
    stamp++;
    const c0 = Math.max(0, Math.floor((R0 - x0) / C)), c1 = Math.min(cols - 1, Math.floor((R2 - x0) / C));
    const r0 = Math.max(0, Math.floor((R1 - y0) / C)), r1 = Math.min(rows - 1, Math.floor((R3 - y0) / C));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const cell = rr * cols + cc;
        const ls = segB[cell];
        if (ls) {
          for (let q = 0; q < ls.length; q++) {
            const k = ls[q];
            if (seenSeg[k >> 2] === stamp) continue;
            seenSeg[k >> 2] = stamp;
            const ax = segs[k], ay = segs[k + 1], bx = segs[k + 2], by = segs[k + 3];
            if ((ax > bx ? ax : bx) < R0 || (ax < bx ? ax : bx) > R2 || (ay > by ? ay : by) < R1 || (ay < by ? ay : by) > R3) continue;
            if (segHitsRect(ax, ay, bx, by, RR)) v += HIT;
          }
        }
        const lb = boxB[cell];
        if (lb) {
          for (let q = 0; q < lb.length; q++) {
            const j = lb[q];
            if (j === i || seenBox[j] === stamp) continue;
            seenBox[j] = stamp;
            const b = items[j].box;
            if (b[0] < r[2] + 2 && r[0] - 2 < b[2] && b[1] < r[3] + 2 && r[1] - 2 < b[3]) v += HIT;
          }
        }
      }
    }
    for (let j = 0; j < others.length; j++) {
      const o = others[j];
      if (o && o[0] < r[2] + 4 && r[0] - 4 < o[2] && o[1] < r[3] + 3 && r[1] - 3 < o[3]) v += HIT;
    }
    // fixed things that are not stations (the district names in the left margin)
    for (const o of blocks) if (o[0] < r[2] + 4 && r[0] - 4 < o[2] && o[1] < r[3] + 3 && r[1] - 3 < o[3]) v += HIT;
    return v;
  };
  const best = (i, others) => {
    const it = items[i];
    let pick = null;
    const all = it.variants;
    const sizes = opt.fast && all.length > 2 ? [all[0], all[all.length - 1]] : all;
    for (const size of sizes) {
      for (let k = 0; k < nSides; k++) {
        const side = SIDES[k];
        if (pick && side[1] + size.cost >= pick.v) continue;
        const r = side[2](it.x, it.y, it.box, size.w, size.h);
        const v = rectCost(i, side, r, size.cost, others);
        if (!pick || v < pick.v) pick = { side: side[0], r, variant: size.v, slim: size.v !== "full", cost: size.cost, v };
        if (pick.v === 0) return pick;
      }
    }
    return pick;
  };
  const order = opt.order || [...items.keys()];
  const picks = new Array(items.length);
  const rects = new Array(items.length).fill(null);
  for (const i of order) {
    picks[i] = best(i, rects);
    rects[i] = picks[i].r;
  }
  if (!opt.fast) {
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const i of order) {
        rects[i] = null;
        const now = rectCost(i, SIDES.find((s) => s[0] === picks[i].side), picks[i].r, picks[i].cost, rects);
        const b = best(i, rects);
        if (b.v < now - 1e-6) { picks[i] = b; changed = true; } else picks[i].v = now;
        rects[i] = picks[i].r;
      }
      if (!changed) break;
    }
  }
  let cost = 0;
  for (const p of picks) cost += p.v;
  return { picks, cost };
}

// ---------------------------------------------------------------- the grid problem
function gridProblem(model, opt = {}) {
  const st = Object.values(model.stations);
  const index = Object.fromEntries(st.map((s, i) => [s.id, i]));
  const zones = [];
  let row = 0;
  for (const layer of model.layers) {
    const members = st.filter((s) => s.layer === layer.id);
    if (!members.length) continue;
    const rows = zoneRows(members.length);
    zones.push({ id: layer.id, name: layer.name, sub: layer.sub, r0: row, r1: row + rows - 1 });
    row += rows;
  }
  const zoneOf = Object.fromEntries(zones.map((z) => [z.id, z]));
  const lineIds = model.lines.map((l) => l.id);
  const edges = model.edges.map((e) => {
    const types = Object.values(e.lines).map((u) => u.type);
    const type = types.includes("step") ? "step" : types.includes("alt") ? "alt" : "link";
    return {
      key: e.key, a: index[e.a], b: index[e.b], type,
      lines: Object.keys(e.lines).map((id) => lineIds.indexOf(id)),
    };
  });
  // For every line, the track it has at each station (to keep lines straight through stations).
  const lineAt = lineIds.map(() => st.map(() => []));
  edges.forEach((e, k) => {
    for (const l of e.lines) {
      lineAt[l][e.a].push(k);
      lineAt[l][e.b].push(k);
    }
  });
  const incident = st.map(() => []);
  edges.forEach((e, k) => { incident[e.a].push(k); incident[e.b].push(k); });
  // Steps that move forward (calls, messages, signals, data): read left to right where possible.
  const forward = [];
  for (const line of model.lines) {
    for (const stp of line.steps || []) {
      if (stp.alt || stp.kind === "return") continue;
      const a = index[stp.from], b = index[stp.to];
      if (a === undefined || b === undefined || a === b) continue;
      forward.push([a, b]);
    }
  }
  const variants = st.map((s) => labelVariants(s, null, opt.slimCost ?? WEIGHTS.slim));
  const labels = variants.map((v) => ({ w: v[0].w, h: v[0].h }));
  const pills = st.map((s) => (s.lines.length > 1 ? ((s.lines.length - 1) * 11) / 2 + 8.2 : 6.2));
  return {
    stations: st, index, zones, rowMin: st.map((s) => zoneOf[s.layer].r0), rowMax: st.map((s) => zoneOf[s.layer].r1),
    rows: row, edges, lineAt, incident, labels, variants, pills, lineIds, forward, cols: opt.cols || GRID.cols,
  };
}

// ---------------------------------------------------------------- start: order of appearance
function initialState(P, model) {
  const n = P.stations.length;
  const X = new Int32Array(n).fill(-9999);
  const Y = new Int32Array(n);
  const placed = new Uint8Array(n);
  const occupied = new Map();
  const key = (x, y) => x * 4096 + y;
  const put = (i, x, y) => {
    // Find the nearest free cell in the district, preferring the asked row.
    for (let d = 0; d < 60; d++) {
      for (const dx of d ? [d, -d] : [0]) {
        for (let r = 0; r <= P.rowMax[i] - P.rowMin[i]; r++) {
          for (const yy of [y + r, y - r]) {
            if (yy < P.rowMin[i] || yy > P.rowMax[i]) continue;
            if (!occupied.has(key(x + dx, yy))) {
              X[i] = x + dx; Y[i] = yy; placed[i] = 1; occupied.set(key(x + dx, yy), i);
              return;
            }
          }
        }
      }
    }
  };
  let cursor = 0;
  for (const line of model.lines) {
    const stops = line.stops.map((id) => P.index[id]);
    const firstPlaced = stops.findIndex((i) => placed[i]);
    if (firstPlaced < 0) {
      let x = cursor;
      for (const i of stops) { put(i, x, Math.round((P.rowMin[i] + P.rowMax[i]) / 2)); x += 2; }
      cursor = Math.max(...stops.map((i) => X[i])) + 2;
      continue;
    }
    // Before the first known stop: leftwards; after: rightwards from the last placed stop.
    for (let k = firstPlaced - 1; k >= 0; k--) {
      const i = stops[k];
      if (placed[i]) continue;
      const ref = stops[k + 1];
      put(i, X[ref] - 2, Math.max(P.rowMin[i], Math.min(P.rowMax[i], Y[ref])));
    }
    for (let k = firstPlaced + 1; k < stops.length; k++) {
      const i = stops[k];
      if (placed[i]) continue;
      const ref = stops[k - 1];
      put(i, X[ref] + 2, Math.max(P.rowMin[i], Math.min(P.rowMax[i], Y[ref])));
    }
    cursor = Math.max(cursor, ...stops.map((i) => X[i]) ) + 2;
  }
  for (let i = 0; i < n; i++) if (!placed[i]) put(i, cursor++, P.rowMin[i]);
  const minX = Math.min(...X);
  for (let i = 0; i < n; i++) X[i] -= minX;
  // Squeeze into the column budget, keeping the order.
  const maxX = Math.max(...X);
  if (maxX >= P.cols) {
    const taken = new Set();
    const ids = [...Array(n).keys()].sort((a, b) => X[a] - X[b]);
    for (const i of ids) {
      let x = Math.round((X[i] * (P.cols - 1)) / maxX);
      for (let d = 0; d < P.cols * 2; d++) {
        let found = false;
        for (const xx of [x + d, x - d]) {
          if (xx < 0 || xx >= P.cols) continue;
          for (let y = P.rowMin[i]; y <= P.rowMax[i]; y++) {
            const yy = (Y[i] + (y - P.rowMin[i])) % (P.rowMax[i] - P.rowMin[i] + 1) + P.rowMin[i];
            if (!taken.has(xx * 4096 + yy)) { X[i] = xx; Y[i] = yy; taken.add(xx * 4096 + yy); found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
    }
  }
  return { X, Y, B: new Uint8Array(P.edges.length) };
}

// ---------------------------------------------------------------- start: a stored layout
// `partial`: {X, Y, B} with -1 for stations that have no stored cell (new, or no longer fitting
// their district). Kept stations stay where they were; the others go next to their neighbours.
function warmState(P, model, partial) {
  const n = P.stations.length;
  const X = Int32Array.from(partial.X), Y = Int32Array.from(partial.Y);
  const B = Uint8Array.from(partial.B);
  const taken = new Set();
  for (let i = 0; i < n; i++) if (X[i] >= 0) taken.add(X[i] * 4096 + Y[i]);
  const todo = [];
  for (let i = 0; i < n; i++) if (X[i] < 0) todo.push(i);
  // New stations whose neighbours are placed first, so chains of new stations grow outwards.
  for (let guard = 0; todo.length && guard < n * 2; guard++) {
    todo.sort((a, b) => placedNeighbours(b).length - placedNeighbours(a).length);
    const i = todo.shift();
    const nb = placedNeighbours(i);
    const wantX = nb.length ? Math.round(nb.reduce((t, j) => t + X[j], 0) / nb.length) : Math.max(0, ...Array.from(X)) + 1;
    const rows = [];
    for (let y = P.rowMin[i]; y <= P.rowMax[i]; y++) rows.push(y);
    const wantY = nb.length ? Math.round(nb.reduce((t, j) => t + Y[j], 0) / nb.length) : rows[rows.length >> 1];
    rows.sort((a, b) => Math.abs(a - wantY) - Math.abs(b - wantY));
    let done = false;
    for (let d = 0; d < P.cols * 2 && !done; d++) {
      for (const x of d ? [wantX + d, wantX - d] : [wantX]) {
        if (x < 0 || x >= P.cols) continue;
        for (const y of rows) if (!taken.has(x * 4096 + y)) { X[i] = x; Y[i] = y; taken.add(x * 4096 + y); done = true; break; }
        if (done) break;
      }
    }
    if (!done) { X[i] = 0; Y[i] = P.rowMin[i]; }
  }
  return { X, Y, B };
  function placedNeighbours(i) {
    const out = [];
    for (const k of P.incident[i]) {
      const e = P.edges[k];
      const j = e.a === i ? e.b : e.a;
      if (X[j] >= 0) out.push(j);
    }
    return out;
  }
}

// ---------------------------------------------------------------- cost
const WEIGHTS = {
  bend: 7, bendLink: 6, len: 1.0, lenLink: 4, long: 0.9, longFrom: 4, diag: 0.8,
  thru: 120, near: 4, cross: 14, crossSame: 18, crossLink: 8, overlap: 90,
  a135: 1.5, a90: 9, a45: 30, branch45: 6,
  label: 40, slim: 10, width: 0, order: 0.6,
};

function route(P, S, k, out) {
  const e = P.edges[k];
  const x1 = S.X[e.a], y1 = S.Y[e.a], x2 = S.X[e.b], y2 = S.Y[e.b];
  const dx = x2 - x1, dy = y2 - y1, ax = Math.abs(dx), ay = Math.abs(dy);
  out.length = 0;
  out.push(x1, y1);
  if (dx !== 0 && dy !== 0 && ax !== ay) {
    const m = Math.min(ax, ay), sx = Math.sign(dx), sy = Math.sign(dy);
    if (S.B[k] === 0) out.push(x1 + sx * m, y1 + sy * m);
    else out.push(x2 - sx * m, y2 - sy * m);
  }
  out.push(x2, y2);
  return out;
}

const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
const onSeg = (ax, ay, bx, by, px, py) =>
  Math.min(ax, bx) - 1e-9 <= px && px <= Math.max(ax, bx) + 1e-9 && Math.min(ay, by) - 1e-9 <= py && py <= Math.max(ay, by) + 1e-9;

// 0: apart, 1: proper or touching crossing, 2: collinear overlap longer than a point
function segRelation(a, b) {
  const [ax, ay, bx, by] = a, [cx, cy, dx, dy] = b;
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 === 0 && o2 === 0) {
    // collinear: overlap length
    const ux = bx - ax, uy = by - ay, L = ux * ux + uy * uy;
    if (L === 0) return 0;
    const t1 = ((cx - ax) * ux + (cy - ay) * uy) / L, t2 = ((dx - ax) * ux + (dy - ay) * uy) / L;
    const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
    if (hi - lo > 1e-6) return 2;
    return hi - lo > -1e-9 ? 1 : 0;
  }
  if (o1 !== o2 && o3 !== o4) return 1;
  if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return 1;
  if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return 1;
  if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return 1;
  if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return 1;
  return 0;
}

function distPointSeg(px, py, ax, ay, bx, by) {
  const ux = bx - ax, uy = by - ay, L = ux * ux + uy * uy;
  let t = L ? ((px - ax) * ux + (py - ay) * uy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * ux - px, qy = ay + t * uy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

function segHitsRect(x1, y1, x2, y2, r) {
  // Liang–Barsky clip test.
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
    const q = i === 0 ? x1 - r[0] : i === 1 ? r[2] - x1 : i === 2 ? y1 - r[1] : r[3] - y1;
    if (p === 0) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function dirIndex(dx, dy) {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let i = 0; i < 8; i++) if (DIRS[i][0] === sx && DIRS[i][1] === sy) return i;
  return -1;
}

// (evaluate() and anneal() are left out of this copy: the page only reads the saved layout;
//  metro's tools/precompute.mjs keeps them.)

const LOOK = { line: 6.4, paperLine: 4.4, lane: 8.5, radius: 18, dot: 6.2, paperDot: 4.7, pillR: 8.2, pillGap: 11 };

function offsetPolyline(pts, d) {
  if (!d) return pts.map((p) => [p[0], p[1]]);
  const out = [];
  const norm = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  };
  for (let i = 0; i < pts.length; i++) {
    const nPrev = i > 0 ? norm(...pts[i - 1], ...pts[i]) : null;
    const nNext = i < pts.length - 1 ? norm(...pts[i], ...pts[i + 1]) : null;
    let nx, ny, scale = 1;
    if (nPrev && nNext) {
      nx = nPrev[0] + nNext[0]; ny = nPrev[1] + nNext[1];
      const L = Math.hypot(nx, ny) || 1;
      nx /= L; ny /= L;
      scale = 1 / Math.max(0.35, nx * nNext[0] + ny * nNext[1]);
    } else [nx, ny] = nPrev || nNext;
    out.push([pts[i][0] + nx * d * scale, pts[i][1] + ny * d * scale]);
  }
  return out;
}

// SVG path with rounded bends.
function roundedPath(pts, r) {
  if (pts.length < 3) return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join("L")}`;
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = x - ((x - px) / l1) * rr, ay = y - ((y - py) / l1) * rr;
    const bx = x + ((nx - x) / l2) * rr, by = y + ((ny - y) / l2) * rr;
    d += `L${ax.toFixed(1)} ${ay.toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
}

function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function pointAt(pts, t) {
  const total = polyLength(pts);
  let want = total * t;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= seg || i === pts.length - 1) {
      const f = seg ? Math.min(1, want / seg) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f,
        Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
    }
    want -= seg;
  }
  return [pts[0][0], pts[0][1], 0];
}

function buildScene(model, P, S, measure, opt = {}) {
  const u = opt.unit || GRID.unit;
  const gutter = opt.gutter ?? GRID.gutter;
  const top = opt.top ?? GRID.top;
  const n = P.stations.length;
  const px = (gx) => gutter + (gx + 0.5) * u;
  const py = (gy) => top + (gy + 0.5) * u;
  const lineOrder = Object.fromEntries(model.lines.map((l, i) => [l.id, i]));

  // Grid routes in pixels.
  const tmp = [];
  const edgeGeo = {};
  P.edges.forEach((e, k) => {
    const pts = [];
    const r = route(P, S, k, tmp);
    for (let i = 0; i < r.length; i += 2) pts.push([px(r[i]), py(r[i + 1])]);
    const me = model.edges[k];
    edgeGeo[e.key] = { key: e.key, a: me.a, b: me.b, pts, lines: Object.keys(me.lines) };
  });

  // Lanes where several lines share a pair of stations.
  const lanes = {};
  for (const g of Object.values(edgeGeo)) {
    const ids = [...g.lines];
    if (ids.length > 1) {
      // Order lanes so lines that leave towards the left (relative to travel a→b) sit on the left.
      const a = g.pts[0], b = g.pts[g.pts.length - 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const side = (id) => {
        let s = 0;
        for (const end of [g.a, g.b]) {
          for (const o of Object.values(edgeGeo)) {
            if (o === g || !o.lines.includes(id) || (o.a !== end && o.b !== end)) continue;
            const far = o.a === end ? o.pts[o.pts.length - 1] : o.pts[0];
            const here = o.a === end ? o.pts[0] : o.pts[o.pts.length - 1];
            s += (far[0] - here[0]) * nx + (far[1] - here[1]) * ny;
          }
        }
        return s;
      };
      ids.sort((p, q) => side(p) - side(q) || lineOrder[p] - lineOrder[q]);
    }
    g.lanes = {};
    ids.forEach((id, i) => { g.lanes[id] = (i - (ids.length - 1) / 2) * LOOK.lane; });
    lanes[g.key] = g.lanes;
  }

  // Track of every line on every pair.
  const tracks = [];
  for (const me of model.edges) {
    const g = edgeGeo[me.key];
    for (const [lineId, use] of Object.entries(me.lines)) {
      const pts = offsetPolyline(g.pts, g.lanes[lineId]);
      tracks.push({
        line: lineId, key: me.key, a: me.a, b: me.b, type: use.type, steps: use.steps,
        pts, d: roundedPath(pts, LOOK.radius),
      });
    }
  }

  // Stations: centres, marks.
  const stations = {};
  P.stations.forEach((s, i) => {
    stations[s.id] = { id: s.id, gx: S.X[i], gy: S.Y[i], x: px(S.X[i]), y: py(S.Y[i]) };
  });
  const dirOf = (g, at) => {
    const pts = g.pts;
    const [p, q] = g.a === at ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  };
  for (const s of Object.values(model.stations)) {
    const c = stations[s.id];
    const inc = Object.values(edgeGeo).filter((g) => g.a === s.id || g.b === s.id);
    if (!s.interchange) {
      const paper = model.lineById[s.lines[0]]?.kind === "paper";
      const r = paper ? LOOK.paperDot : LOOK.dot;
      c.mark = { type: "dot", x: c.x, y: c.y, r, line: s.lines[0], paper };
      c.box = [c.x - r - 2, c.y - r - 2, c.x + r + 2, c.y + r + 2];
      continue;
    }
    // Axis of the pill: across a shared track if there is one, else across the main direction.
    const bundle = inc.find((g) => Object.keys(g.lanes).length > 1);
    let ax, ay;
    if (bundle) {
      const [dx, dy] = dirOf(bundle, s.id);
      ax = -dy; ay = dx;
    } else {
      let h = 0, v = 0;
      for (const g of inc) {
        const [dx, dy] = dirOf(g, s.id);
        if (Math.abs(dy) < 0.2) h += 1.2; else if (Math.abs(dx) < 0.2) v += 1.2; else { h += 0.5; v += 0.5; }
      }
      // mostly horizontal track: the pill stands up; otherwise it lies down
      if (h > v) { ax = 0; ay = 1; } else { ax = 1; ay = 0; }
    }
    if (ax < 0 || (ax === 0 && ay < 0)) { ax = -ax; ay = -ay; }
    const k = s.lines.length;
    let span = (k - 1) * LOOK.pillGap;
    let cx = c.x, cy = c.y;
    if (bundle) {
      const offs = Object.values(bundle.lanes);
      span = Math.max(span, Math.max(...offs) - Math.min(...offs));
    }
    const half = span / 2 + LOOK.pillR;
    const ex = Math.abs(ax) * (span / 2) + LOOK.pillR, ey = Math.abs(ay) * (span / 2) + LOOK.pillR;
    c.mark = { type: "pill", x: cx, y: cy, ax, ay, half, r: LOOK.pillR, k };
    c.box = [cx - ex - 2, cy - ey - 2, cx + ex + 2, cy + ey + 2];
  }

  // Labels: the shared placer with measured text, more sides and a few improving passes.
  const meas = measure || ((t, size, mono) => estimateWidth(t, size, mono));
  const width0 = gutter + Math.max(P.cols, Math.max(...S.X) + 1) * u;
  const height = top + P.rows * u + (opt.bottom ?? GRID.bottom);
  const flat = [];
  for (const t of tracks) for (let i = 1; i < t.pts.length; i++) flat.push(...t.pts[i - 1], ...t.pts[i]);
  const list = Object.values(model.stations);
  const items = list.map((s) => {
    const c = stations[s.id];
    return { x: c.x, y: c.y, box: c.box, variants: labelVariants(s, meas) };
  });
  const order = [...items.keys()].sort((a, b) => list[b].lines.length - list[a].lines.length || items[b].variants[0].w - items[a].variants[0].w);
  const bounds = [gutter - 4, 2, width0 + (opt.right ?? GRID.right) + 60, height - 2];
  // District names sit in the left margin; a label pushed into the margin must not cover them.
  const blocks = P.zones.map((z) => {
    const y0 = top + z.r0 * u, y1 = top + (z.r1 + 1) * u, mid = (y0 + y1) / 2;
    return [12, mid - 20, 18 + Math.max(meas(z.name, 15.5, false), meas(z.sub || "", 12.5, false)) + 6, mid + 22];
  });
  // Greedy placement depends on the order; a few seeded orders (same result on every load) find
  // room for more full labels (name, namespace and sub line) than the busiest-first order alone.
  let best = placeLabels(items, flat, bounds, { order, pad: 6, blocks });
  const rnd = rng(opt.labelSeed ?? 5);
  for (let k = 0; k < (opt.labelTries ?? 40) && best.cost > 1e-9; k++) {
    const ord = [...order];
    for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
    const r = placeLabels(items, flat, bounds, { order: ord, pad: 6, blocks });
    if (r.cost < best.cost - 1e-9) best = r;
  }
  const { picks } = best;
  // Names only (small scales): a placement of its own, so a name sits level with its station rather
  // than at the top of a three-line box whose other lines are hidden.
  const itemsC = items.map((it) => ({ ...it, variants: [{ ...it.variants[it.variants.length - 1], v: "name", cost: 0 }] }));
  let bestC = placeLabels(itemsC, flat, bounds, { order, pad: 6, blocks });
  const rndC = rng((opt.labelSeed ?? 5) + 1);
  for (let k = 0; k < 16 && bestC.cost > 1e-9; k++) {
    const ord = [...order];
    for (let i = ord.length - 1; i > 0; i--) { const j = Math.floor(rndC() * (i + 1)); [ord[i], ord[j]] = [ord[j], ord[i]]; }
    const r = placeLabels(itemsC, flat, bounds, { order: ord, pad: 6, blocks });
    if (r.cost < bestC.cost - 1e-9) bestC = r;
  }
  const labelOf = Object.fromEntries(list.map((s, i) => [s.id, picks[i]]));
  let maxRight = width0;
  for (const s of Object.values(model.stations)) {
    const L = labelOf[s.id];
    stations[s.id].label = { side: L.side, rect: L.r, variant: L.variant, slim: L.slim, bad: L.v >= 30, v: L.v };
    const Lc = bestC.picks[list.indexOf(s)];
    stations[s.id].labelCompact = { side: Lc.side, rect: Lc.r, variant: "name", slim: true, v: Lc.v };
    maxRight = Math.max(maxRight, L.r[2] + 8);
  }
  const width = Math.max(maxRight, width0) + (opt.right ?? GRID.right);
  const zones = P.zones.map((z) => ({ ...z, y0: top + z.r0 * u, y1: top + (z.r1 + 1) * u }));
  return { unit: u, gutter, top, width, height, zones, stations, tracks, edgeGeo };
}


window.METROL = { rng, estimateWidth, labelSize, labelVariants, zoneRows, placeLabels, gridProblem, initialState, warmState, segHitsRect, roundedPath, polyLength, pointAt, buildScene, GRID, FONT, LINE_H, WEIGHTS, LOOK };
})();
