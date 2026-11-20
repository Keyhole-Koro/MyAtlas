// Counts the same things on every engine's drawing, and remembers where each problem is so it can be marked.
// The score of a drawing is absolute: each count is placed between a fixed "good" value (no penalty) and a fixed
// "bad" value (full penalty), so a drawing's score does not depend on which other engines are on the bench.
import { basisPoints, bendCount, overlapArea, polyLen, rectArea, rectHit, rectOf, segCross, segInRect, simplify } from './geom.js';
import { isTrimmed } from './model.js';
import { textW } from './measure.js';

// low: fewer is better. high: more is better. w: weight in the score (0: shown, not scored). good/bad: the anchors.
// group: 0 lines, 1 labels and boxes, 2 the whole picture, 3 for reference only.
export const METRICS = [
  { id: 'crossings', group: 0, name: '線の交差', w: 3, better: 'low', good: 0, bad: 4, desc: '線どうしが交わる所と、2 本が重なって走る所の数。' },
  { id: 'through', group: 0, name: '箱を貫く線', w: 3, better: 'low', good: 0, bad: 2, desc: '両端でない箱の上を通る線の数。どこへ行くのか読めなくなる。' },
  { id: 'jogs', group: 0, name: '小さな段差', w: 1, better: 'low', good: 0, bad: 3, desc: '線が 20 px 未満だけ横にずれて、また同じ向きに進む所。描き損じに見える。' },
  { id: 'detour', group: 0, name: '最大の遠回り', w: 1, better: 'low', good: 150, bad: 600, desc: '手順ごとに、線の長さから 2 つの箱のあいだの最短の道のり（縦と横の隙間の和）を引いた分。その最大。', fmt: (v) => `${Math.round(v)} px` },
  { id: 'bends', group: 0, name: '線の曲がり', w: 1, better: 'low', good: 1, bad: 3, desc: '線 1 本あたりの、向きを変える回数（曲線は 20° 以上の曲がり）。', fmt: (v) => `${v.toFixed(1)} 回` },
  { id: 'overlaps', group: 1, name: '札・箱の重なり', w: 3, better: 'low', good: 0, bad: 4, desc: '手順の札が、ほかの札か箱に重なる数と、箱どうしが重なる数。' },
  { id: 'onLine', group: 1, name: '札にかかる線', w: 1, better: 'low', good: 0, bad: 4, desc: 'ほかの手順の線が札の上を通る数。' },
  { id: 'detached', group: 1, name: '線から離れた札', w: 2, better: 'low', good: 0, bad: 4, desc: '自分の線から 14 px より離れた札と、自分の線よりほかの線に近い札の数。どの線の札か迷う。' },
  { id: 'trimmed', group: 1, name: '削った札', w: 1, better: 'low', good: 0, bad: 6, desc: '場所が足りず、動詞か渡すデータを省いた札の数。全部を読むには手順を選ぶ。' },
  { id: 'fit', group: 2, name: '1 画面での文字', w: 2, better: 'high', good: 13, bad: 9, desc: '今の地図の枠（1100 × 720）に全体を収めた時の、箱の題の文字の大きさ。', fmt: (v) => `${v.toFixed(1)} px` },
  { id: 'layers', group: 2, name: '層の上下の順', w: 2, better: 'high', good: 1, bad: 0, desc: '上の層の箱が下の層の箱より上にある組の割合。時系列は位置ではなく箱の頭の層の名前と色で分かるので、半分（50%）とした。', fmt: (v, M) => (M && M.detail.layersBy === 'head' ? '50%（頭の文字）' : `${Math.round(v * 100)}%`) },
  { id: 'travel', group: 2, name: '目の移動', w: 1, better: 'low', good: 150, bad: 450, desc: '手順 1, 2, 3… の札を順に読む時、次の札までの距離の平均。', fmt: (v) => `${Math.round(v)} px` },
  { id: 'frames', group: 2, name: '枠の誤り', w: 1, better: 'low', good: 0, bad: 3, desc: '実行の文脈の枠に入ってしまったほかの箱、重なった枠、枠の線にかかる札、札や箱にかかる枠の名前の数。' },
  { id: 'length', group: 3, name: '線の長さ', w: 0, better: 'low', desc: '線の長さの合計（点には入れない。遠回りは上の行で数える）。', fmt: (v) => `${(v / 1000).toFixed(1)}k px` },
  { id: 'area', group: 3, name: '面積', w: 0, better: 'low', desc: '図全体の幅 × 高さ（点には入れない。大きさは「1 画面での文字」で数える）。', fmt: (v) => `${(v / 1e6).toFixed(2)} M px²` },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m]));
export const FRAME = { w: 1100, h: 720 };
export const fmtValue = (m, v, M) => (v == null ? '—' : m.fmt ? m.fmt(v, M) : String(v));

export function measureLayout(D, G) {
  const boxes = D.boxes.map((b) => ({ id: b.id, r: rectOf(G.boxes[b.id]) }));
  const lines = G.edges.map((e) => ({ i: e.i, st: D.steps[e.i], pts: e.curve ? basisPoints(e.pts, 10) : simplify(e.pts), raw: e.pts, curve: !!e.curve }));
  const near = (p, ids, pad) => ids.some((id) => { const r = rectOf(G.boxes[id], pad); return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; });
  const defects = { crossings: [], runs: [], through: [], overlaps: [], onLine: [], frames: [], detached: [], jogs: [], detour: [] };

  // crossings, and stretches where two lines run on top of each other
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
    const A = lines[a], B = lines[b], ends = [A.st.from, A.st.to, B.st.from, B.st.to];
    const seen = [];
    for (let i = 0; i < A.pts.length - 1; i++) for (let k = 0; k < B.pts.length - 1; k++) {
      const p = segCross(A.pts[i], A.pts[i + 1], B.pts[k], B.pts[k + 1]);
      if (p && !near(p, ends, 6) && !seen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 4)) { seen.push(p); defects.crossings.push({ a: A.i, b: B.i, p }); }
      const run = collinearRun(A.pts[i], A.pts[i + 1], B.pts[k], B.pts[k + 1]);
      if (run && !(near(run[0], ends, 8) && near(run[1], ends, 8))) defects.runs.push({ a: A.i, b: B.i, seg: run });
    }
  }
  // lines over boxes that are not their ends
  for (const L of lines) for (const bx of boxes) {
    if (bx.id === L.st.from || bx.id === L.st.to) continue;
    const r = [bx.r[0] + 2, bx.r[1] + 2, bx.r[2] - 2, bx.r[3] - 2];
    let inside = 0;
    for (let i = 0; i < L.pts.length - 1; i++) inside += segInRect(L.pts[i], L.pts[i + 1], r);
    if (inside > 3) defects.through.push({ i: L.i, box: bx.id });
  }
  // labels against labels and boxes, and other lines through labels
  const labs = G.labels.map((l) => ({ i: l.i, l, r: [l.x, l.y, l.x + l.w, l.y + l.h] }));
  for (let a = 0; a < labs.length; a++) {
    for (let b = a + 1; b < labs.length; b++) if (overlapArea(labs[a].r, labs[b].r) > 6) defects.overlaps.push({ a: labs[a].i, b: labs[b].i, kind: 'label', r: labs[a].r, r2: labs[b].r });
    for (const bx of boxes) if (overlapArea(labs[a].r, bx.r) > 6) defects.overlaps.push({ a: labs[a].i, box: bx.id, kind: 'box', r: labs[a].r });
    const lr = [labs[a].r[0] + 2, labs[a].r[1] + 2, labs[a].r[2] - 2, labs[a].r[3] - 2];
    for (const L of lines) {
      if (L.i === labs[a].i) continue;
      let hit = 0;
      for (let i = 0; i < L.pts.length - 1; i++) hit += segInRect(L.pts[i], L.pts[i + 1], lr);
      if (hit > 2) defects.onLine.push({ a: labs[a].i, line: L.i, r: labs[a].r });
    }
  }
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    if (overlapArea(boxes[a].r, boxes[b].r) > 6) defects.overlaps.push({ box: boxes[a].id, box2: boxes[b].id, kind: 'boxes', r: boxes[a].r, r2: boxes[b].r });
  }
  // which line a label belongs to: its own line (or the tick that hangs it from the line) must be the nearest, and near
  for (const { i, l, r } of labs) {
    const own = lines.find((L) => L.i === i);
    if (!own) continue;
    let dOwn = polyRectDist(own.pts, r);
    if (l.leader) dOwn = Math.min(dOwn, polyRectDist(l.leader, r) + polyRectDist(own.pts, [l.leader[1][0] - 1, l.leader[1][1] - 1, l.leader[1][0] + 1, l.leader[1][1] + 1]));
    let dOther = Infinity, other = null;
    for (const L of lines) { if (L.i === i) continue; const d = polyRectDist(L.pts, r); if (d < dOther) { dOther = d; other = L.i; } }
    if (dOwn > 14 || dOther + 3 < dOwn) defects.detached.push({ a: i, r, dOwn, dOther, other });
  }
  // small jogs: a short sideways step between two runs going the same way
  for (const L of lines) {
    if (L.curve) continue;
    const p = L.pts;
    for (let k = 1; k + 2 < p.length; k++) {
      const a = [p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]], b = [p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]], c = [p[k + 2][0] - p[k + 1][0], p[k + 2][1] - p[k + 1][1]];
      const lb = Math.hypot(b[0], b[1]);
      const same = Math.sign(a[0]) === Math.sign(c[0]) && Math.sign(a[1]) === Math.sign(c[1]);
      const perp = Math.abs(a[0] * b[0] + a[1] * b[1]) < 1e-6;
      if (lb > 0.5 && lb < 20 && same && perp) defects.jogs.push({ i: L.i, p: [(p[k][0] + p[k + 1][0]) / 2, (p[k][1] + p[k + 1][1]) / 2] });
    }
  }
  // detours: how much longer each line is than the shortest way between its two boxes (the gaps across and down)
  let detour = 0, worst = null;
  if (G.kind !== 'seq') {
    for (const L of lines) {
      const A = rectOf(G.boxes[L.st.from]), B = rectOf(G.boxes[L.st.to]);
      const gx = Math.max(0, B[0] - A[2], A[0] - B[2]), gy = Math.max(0, B[1] - A[3], A[1] - B[3]);
      const extra = polyLen(L.pts) - (gx + gy);
      if (extra > detour) { detour = extra; worst = L.i; }
    }
    if (worst != null && detour >= 375) defects.detour.push({ i: worst, extra: detour });
  }
  // context frames: boxes inside a frame they do not belong to, frames over each other, labels on a frame's line,
  // and a frame's name over a label or a box
  const frames = (G.regions || []).map((f) => ({ ...f, rs: f.parts || [[f.x0, f.y0, f.x1, f.y1]], segs: frameSegments(f) }));
  const inFrame = (f, r) => f.rs.reduce((a, q) => a + overlapArea(q, r), 0);
  for (const f of frames) for (const bx of boxes) {
    if (f.members.includes(bx.id)) continue;
    if (inFrame(f, bx.r) > 0.2 * rectArea(bx.r)) defects.frames.push({ node: f.node, box: bx.id, r: bx.r, kind: 'box' });
  }
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    let area = 0, at = null;
    for (const p of frames[a].rs) for (const q of frames[b].rs) { const v = overlapArea(p, q); if (v > area) { area = v; at = rectIntersection(p, q); } }
    if (area > 40) defects.frames.push({ node: frames[a].node, other: frames[b].node, r: at, kind: 'frames' });
  }
  for (const f of frames) {
    for (const { i, r } of labs) {
      const q = [r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1];
      if (f.segs.some(([p, s]) => segInRect(p, s, q) > 0.5)) defects.frames.push({ node: f.node, label: i, r, kind: 'label' });
    }
    for (const n of f.names || (f.label && f.tx != null ? [{ text: f.label, tx: f.tx, ty: f.ty, anchor: f.anchor }] : [])) {
      const tw = textW(n.text, 12), nr = n.anchor === 'end' ? [n.tx - tw, n.ty - 11, n.tx, n.ty + 3] : n.anchor === 'middle' ? [n.tx - tw / 2, n.ty - 11, n.tx + tw / 2, n.ty + 3] : [n.tx, n.ty - 11, n.tx + tw, n.ty + 3];
      const hit = labs.some(({ r }) => overlapArea(nr, r) > 6) || boxes.some((bx) => overlapArea(nr, bx.r) > 6);
      if (hit) defects.frames.push({ node: f.node, r: nr, kind: 'name' });
    }
  }

  // layers: a box of a layer above should sit above a box of a layer below
  let layers = 0.5, layersBy = 'head';
  if (G.kind !== 'seq') {
    let ok = 0, all = 0;
    for (const a of D.boxes) for (const b of D.boxes) {
      if (a.bandIndex >= b.bandIndex) continue;
      all++;
      const ra = G.boxes[a.id], rb = G.boxes[b.id];
      if (ra.y + ra.h / 2 < rb.y + rb.h / 2 - 1) ok++;
    }
    layers = all ? ok / all : 1;
    layersBy = 'position';
  }
  // reading: the distance from one numbered label to the next
  const main = D.steps.filter((s) => !s.alt).map((s) => G.labels.find((l) => l.i === s.i)).filter(Boolean);
  let travel = 0;
  for (let k = 0; k < main.length - 1; k++) {
    const a = main[k], b = main[k + 1];
    travel += Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2));
  }
  travel = main.length > 1 ? travel / (main.length - 1) : 0;

  const bends = lines.reduce((n, L) => n + (L.curve ? bendCount(L.raw, 20) : bendCount(L.pts)), 0);
  const length = lines.reduce((n, L) => n + polyLen(L.pts), 0);
  const fitScale = Math.min(1, FRAME.w / G.width, FRAME.h / G.height);
  const trimmed = G.labels.filter((l) => isTrimmed(D.steps[l.i].pill, l.pick)).map((l) => l.i);
  return {
    values: {
      crossings: defects.crossings.length + defects.runs.length,
      through: defects.through.length,
      jogs: defects.jogs.length,
      detour,
      bends: lines.length ? bends / lines.length : 0,
      overlaps: defects.overlaps.length,
      onLine: defects.onLine.length,
      detached: defects.detached.length,
      trimmed: trimmed.length,
      fit: 14 * fitScale, layers, travel,
      frames: defects.frames.length,
      length, area: G.width * G.height,
    },
    detail: { crossings: defects.crossings.length, runs: defects.runs.length, fitScale, width: G.width, height: G.height, layersBy, worstDetour: worst, trimmed, bendsTotal: bends },
    defects,
  };
}

// The lines a frame is drawn with: its outline loops and the two sides of each neck, or its rectangle.
function frameSegments(f) {
  const segs = [];
  const loops = f.blobs ? f.blobs.flat() : f.outline ? f.outline : [[[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]]];
  for (const pts of loops) for (let i = 0; i < pts.length; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
  for (const n of f.necks || []) segs.push([[n[0], n[1]], [n[0], n[3]]], [[n[2], n[1]], [n[2], n[3]]]);
  return segs;
}

function rectIntersection(a, b) { return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]; }

// Distance from a point to a segment, from a segment to a rectangle (0 when they touch), and from a polyline to one.
function ptSegDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function segRectDist(p, q, r) {
  if (segInRect(p, q, r) > 0 || (p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3])) return 0;
  const cs = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  let d = Infinity;
  for (const c of cs) d = Math.min(d, ptSegDist(c, p, q));
  for (const e of [p, q]) {
    const dx = Math.max(r[0] - e[0], 0, e[0] - r[2]), dy = Math.max(r[1] - e[1], 0, e[1] - r[3]);
    d = Math.min(d, Math.hypot(dx, dy));
  }
  return d;
}
export function polyRectDist(pts, r) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segRectDist(pts[i], pts[i + 1], r));
  return d;
}

// Two axis-parallel segments lying on the same line for more than 10 px.
function collinearRun(p, q, r, s) {
  const hz = (a, b) => Math.abs(a[1] - b[1]) < 0.5, vt = (a, b) => Math.abs(a[0] - b[0]) < 0.5;
  if (hz(p, q) && hz(r, s) && Math.abs(p[1] - r[1]) < 3) {
    const lo = Math.max(Math.min(p[0], q[0]), Math.min(r[0], s[0])), hi = Math.min(Math.max(p[0], q[0]), Math.max(r[0], s[0]));
    if (hi - lo > 10) return [[lo, p[1]], [hi, p[1]]];
  }
  if (vt(p, q) && vt(r, s) && Math.abs(p[0] - r[0]) < 3) {
    const lo = Math.max(Math.min(p[1], q[1]), Math.min(r[1], s[1])), hi = Math.min(Math.max(p[1], q[1]), Math.max(r[1], s[1]));
    if (hi - lo > 10) return [[p[0], lo], [p[0], hi]];
  }
  return null;
}

// How bad one value is, from 0 (at or past "good") to 1 (at or past "bad").
export function badness(m, v) {
  if (!m.w || v == null) return 0;
  const t = (v - m.good) / (m.bad - m.good);
  return Math.max(0, Math.min(1, t));
}
// Scores one drawing on its own: 100 minus the weighted share of penalties. weights: optional { id: w } override.
export function scoreOne(M, weights = null) {
  let bad = 0, wsum = 0;
  for (const m of METRICS) {
    const w = weights ? (weights[m.id] ?? 0) : m.w;
    if (!w) continue;
    bad += w * badness(m, M.values[m.id]);
    wsum += w;
  }
  return Math.round(100 * (1 - bad / wsum));
}
export const EQUAL = Object.fromEntries(METRICS.filter((m) => m.w).map((m) => [m.id, 1]));

// Scores and places the engines on one diagram. Each score stands alone; "best" marks the best value of each row.
export function scoreAll(results, weights = null) {
  const ids = Object.keys(results);
  const score = Object.fromEntries(ids.map((id) => [id, scoreOne(results[id], weights)]));
  const best = {};
  for (const m of METRICS) {
    const num = ids.map((id) => { const v = results[id].values[m.id]; return v == null ? null : m.better === 'high' ? -v : v; });
    const known = num.filter((v) => v != null);
    const lo = Math.min(...known);
    best[m.id] = ids.filter((id, k) => num[k] != null && Math.abs(num[k] - lo) < 1e-6 * Math.max(1, Math.abs(lo)) + 1e-6);
  }
  const rank = [...ids].sort((a, b) => score[b] - score[a]);
  // equal points share a place
  const place = Object.fromEntries(ids.map((id) => [id, 1 + ids.filter((x) => score[x] > score[id]).length]));
  return { score, rank, place, best };
}
