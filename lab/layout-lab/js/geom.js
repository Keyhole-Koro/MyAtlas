// Small geometry used by the engines and the metrics. Points are [x, y]; rects are [x0, y0, x1, y1].
export const lerp = (a, b, t) => a + (b - a) * t;
export const rectOf = (b, pad = 0) => [b.x - pad, b.y - pad, b.x + b.w + pad, b.y + b.h + pad];
export const rectHit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
export const rectArea = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
export const rectInter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
export const overlapArea = (a, b) => (rectHit(a, b) ? rectArea(rectInter(a, b)) : 0);

export function polyLen(pts) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return n;
}

// Proper crossing of two segments (touching at an end does not count).
export function segCross(p, q, r, s) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s);
  if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) {
    const t = d3 / (d3 - d4);
    return [lerp(r[0], s[0], t), lerp(r[1], s[1], t)];
  }
  return null;
}

// Does the segment p→q pass through the rect (Liang–Barsky clip)? Returns the inside length.
export function segInRect(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const clip = (pp, qq) => {
    if (Math.abs(pp) < 1e-12) return qq >= 0;
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (clip(-dx, p[0] - r[0]) && clip(dx, r[2] - p[0]) && clip(-dy, p[1] - r[1]) && clip(dy, r[3] - p[1])) {
    return Math.hypot(dx, dy) * Math.max(0, t1 - t0);
  }
  return 0;
}
export const segHitRect = (p, q, r) => segInRect(p, q, r) > 0.5;

// Where the line from a box's centre toward a point leaves the box.
export function clipToBox(b, toward, pad = 0) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = toward[0] - cx, dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = b.w / 2 + pad, hh = b.h / 2 + pad;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

// Samples a smooth curve through polyline control points (uniform B-spline, as dagre drawings use).
export function basisPoints(pts, per = 8) {
  if (pts.length < 3) return pts.map((p) => [...p]);
  const P = [pts[0], pts[0], ...pts, pts[pts.length - 1], pts[pts.length - 1]];
  const out = [];
  for (let i = 0; i < P.length - 3; i++) {
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const b0 = (1 - 3 * t + 3 * t2 - t3) / 6, b1 = (4 - 6 * t2 + 3 * t3) / 6, b2 = (1 + 3 * t + 3 * t2 - 3 * t3) / 6, b3 = t3 / 6;
      out.push([b0 * P[i][0] + b1 * P[i + 1][0] + b2 * P[i + 2][0] + b3 * P[i + 3][0], b0 * P[i][1] + b1 * P[i + 1][1] + b2 * P[i + 2][1] + b3 * P[i + 3][1]]);
    }
  }
  out.push([...pts[pts.length - 1]]);
  out[0] = [...pts[0]];
  return out;
}

// Path data of a uniform B-spline through the points, as cubic Béziers (same curve as basisPoints).
export function basisPath(pts) {
  if (pts.length < 3) return 'M' + pts.map((p) => p.map(f1).join(',')).join('L');
  const P = [pts[0], pts[0], ...pts, pts[pts.length - 1], pts[pts.length - 1]];
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < P.length - 3; i++) {
    const [a, b, c, e] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    const c1 = [(2 * b[0] + c[0]) / 3, (2 * b[1] + c[1]) / 3], c2 = [(b[0] + 2 * c[0]) / 3, (b[1] + 2 * c[1]) / 3];
    const end = [(b[0] + 4 * c[0] + e[0]) / 6, (b[1] + 4 * c[1] + e[1]) / 6];
    if (i === 0) { const st = [(a[0] + 4 * b[0] + c[0]) / 6, (a[1] + 4 * b[1] + c[1]) / 6]; d = `M${f1(st[0])},${f1(st[1])}`; }
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(end[0])},${f1(end[1])}`;
  }
  return d;
}
export const f1 = (v) => (Math.round(v * 10) / 10).toString();

// Bends of a polyline: inner points where the direction turns by more than a few degrees.
export function bendCount(pts, minDeg = 8) {
  let n = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = Math.abs(a - b) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    if (d > minDeg) n++;
  }
  return n;
}

// Drops repeated and collinear points so that counts see the route's real corners.
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) < 0.5) continue;
    out.push([p[0], p[1]]);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) < 1e-6 && dot >= 0) out.splice(out.length - 2, 1); else break;
    }
  }
  return out;
}
