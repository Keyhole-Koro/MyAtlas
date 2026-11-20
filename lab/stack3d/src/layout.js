// Placement of boxes on stacked plates and routing of the step tubes between them.
// Pure geometry (no three.js), so it can be checked in node.
//
// Columns: walking the steps in order, a box reached across bands sits in the same column as the
// box it came from (the tube goes straight down or up); a box reached on the same band sits one
// column to the right. A column a tube passes through on a middle band is kept free. Then a box
// whose neighbours all live on other bands moves to the middle of them.
//
// Plates: each plate is only as wide as the blocks and context frames on it (a plate nothing sits
// on spans the whole stack), so a layer that one block of the flow touches is a small plate, not a
// wide empty one.
//
// Tubes: on the same band, an arc over the top faces. Down to another band: out of the bottom,
// through the plate, onto the target's top. Up: out of the top, then up a "lane" in front of the
// blocks, through the plate, into the target's front face. Tubes that cross more than one plate
// use the lane all the way, so they never run through a block.

export const DIM = {
  COL: 5.9,        // world units between columns
  GAP: 8.8,        // between the top surfaces of two plates
  GAP_EMPTY: 6.4,  // above a plate the scene does not use
  PLATE_T: 0.45,   // plate thickness
  Z0: -2.35, Z1: 3.8, // plate extent in depth (blocks at z = 0, the lane in front)
  MARGIN_X: 1.9,   // plate border beyond the outermost blocks
  W: 4.2, H: 1.75, D: 2.3, // block size
  LANE: 2.45,      // z of the vertical lane in front of the blocks
};

const key = (band, col) => `${band}|${col}`;

export function placeColumns(scene) {
  const bandIdx = Object.fromEntries(scene.bands.map((b, i) => [b.id, i]));
  const bandOf = (id) => scene.box[id].band;
  const col = {};
  const occ = new Map();      // band|col → box id
  const reserved = new Set(); // band|col kept free for a tube passing through
  const isFree = (band, c) => !occ.has(key(band, c)) && !reserved.has(key(band, c));
  const put = (id, c) => { col[id] = c; occ.set(key(bandOf(id), c), id); };
  const nearestRight = (band, c) => { for (let g = 0; g < 64 && !isFree(band, c); g++) c++; return c; };
  const nearest = (band, c) => {
    for (let d = 0; d < 64; d++) {
      if (isFree(band, c + d)) return c + d;
      if (d && c - d >= 0 && isFree(band, c - d)) return c - d;
    }
    return c;
  };
  const between = (ba, bb) => {
    const ia = bandIdx[ba], ib = bandIdx[bb], out = [];
    const step = ib > ia ? 1 : -1;
    for (let k = ia + step; k !== ib; k += step) out.push(scene.bands[k].id);
    return out;
  };

  const ordered = [...scene.steps.filter((s) => !s.alt), ...scene.steps.filter((s) => s.alt)];
  let cursor = 0;
  for (const s of ordered) {
    const A = s.from, B = s.to;
    if (!(A in scene.box) || !(B in scene.box)) continue;
    const ba = bandOf(A), bb = bandOf(B);
    if (!(A in col) && !(B in col)) put(A, nearestRight(ba, cursor));
    if (!(A in col)) put(A, ba === bb ? nearest(ba, Math.max(0, col[B] - 1)) : nearest(ba, col[B]));
    if (!(B in col)) put(B, nearestRight(bb, ba === bb ? col[A] + 1 : col[A]));
    // A straight drop over several plates keeps its column free on the plates in between.
    if (col[A] === col[B]) for (const band of between(ba, bb)) if (!occ.has(key(band, col[A]))) reserved.add(key(band, col[A]));
    cursor = Math.max(cursor, col[A], col[B]);
  }
  for (const b of scene.boxes) if (!(b.id in col)) put(b.id, nearestRight(b.band, cursor + 1));

  // A box whose neighbours all sit on other bands moves toward their middle (half columns),
  // unless it hangs straight under/over a neighbour two or more plates away (a long drop).
  const nbrs = {};
  for (const s of scene.steps) {
    if (!(s.from in col) || !(s.to in col)) continue;
    (nbrs[s.from] ||= []).push(s.to);
    (nbrs[s.to] ||= []).push(s.from);
  }
  for (let it = 0; it < 2; it++) {
    for (const b of scene.boxes) {
      const ns = (nbrs[b.id] || []).filter((n) => n !== b.id);
      if (!ns.length || ns.some((n) => bandOf(n) === b.band)) continue;
      if (ns.some((n) => Math.abs(bandIdx[bandOf(n)] - bandIdx[b.band]) >= 2 && col[n] === col[b.id])) continue;
      const mean = Math.round((ns.reduce((a, n) => a + col[n], 0) / ns.length) * 2) / 2;
      if (mean === col[b.id]) continue;
      const cost = (c) => ns.reduce((a, n) => a + (col[n] - c) ** 2, 0);
      if (cost(mean) >= cost(col[b.id])) continue;
      const clash = scene.boxes.some((o) => o.id !== b.id && o.band === b.band && Math.abs(col[o.id] - mean) < 1);
      const res = [...reserved].some((k) => { const [bd, c] = k.split("|"); return bd === b.band && Math.abs(Number(c) - mean) < 0.75; });
      if (!clash && !res) col[b.id] = mean;
    }
  }
  return { col, reserved };
}

export function layoutScene(scene) {
  const { COL, GAP, GAP_EMPTY, PLATE_T, Z0, Z1, MARGIN_X, W, H, D, LANE } = DIM;
  const { col, reserved } = placeColumns(scene);
  const n = scene.bands.length;
  const bandIdx = Object.fromEntries(scene.bands.map((b, i) => [b.id, i]));
  const cols = Object.values(col);
  const cmin = Math.min(...cols), cmax = Math.max(...cols);
  const mid = (cmin + cmax) / 2;
  const empty = scene.bands.map((b) => !scene.boxes.some((x) => x.band === b.id));
  // plates from the top down; a plate nothing sits on comes closer to the one above
  const ys = [0];
  for (let i = 1; i < n; i++) ys.push(ys[i - 1] - (empty[i] ? GAP_EMPTY : GAP));
  const shift = (ys[0] + ys[n - 1]) / 2;
  const yTop = (i) => ys[i] - shift;

  const bands = scene.bands.map((b, i) => ({ ...b, i, y: yTop(i), empty: empty[i] }));
  const boxes = {};
  for (const b of scene.boxes) {
    const i = bandIdx[b.band];
    boxes[b.id] = { id: b.id, band: b.band, bi: i, col: col[b.id], x: (col[b.id] - mid) * COL, y: yTop(i), z: 0, w: W, h: H, d: D };
  }
  const x0 = (cmin - mid) * COL - W / 2 - MARGIN_X, x1 = (cmax - mid) * COL + W / 2 + MARGIN_X;
  const plate = { x0, x1, z0: Z0, z1: Z1, t: PLATE_T };

  // Execution contexts: a dashed frame on each band the context touches, all as wide as the union.
  // The label sits at a front corner of one frame: the map's `at` (b = bottom band, r = right end),
  // else the top band's front-left corner, where no block stands.
  const regions = (scene.regions || []).map((r) => {
    const bs = r.boxes.map((id) => boxes[id]).filter(Boolean);
    if (!bs.length) return null;
    const rx0 = Math.min(...bs.map((b) => b.x - W / 2)) - 0.7, rx1 = Math.max(...bs.map((b) => b.x + W / 2)) + 0.7;
    const bandIds = [...new Set(bs.map((b) => b.band))].sort((p, q) => bandIdx[p] - bandIdx[q]);
    const rects = bandIds.map((bd) => ({ band: bd, y: bands[bandIdx[bd]].y, x0: rx0, x1: rx1, z0: -D / 2 - 0.85, z1: LANE + 0.75 }));
    const at = r.at || "";
    const rc = at.includes("b") ? rects[rects.length - 1] : rects[0];
    const right = at.includes("r");
    // points along the frame's front edge, from the chosen corner inward
    const edge = [], back = [];
    for (let k = 0; k <= 6; k++) {
      const f = k / 6, x = right ? rc.x1 - (rc.x1 - rc.x0) * f : rc.x0 + (rc.x1 - rc.x0) * f;
      edge.push([x, rc.y + 0.02, rc.z1]);
      back.push([x, rc.y + 0.02, rc.z0]); // behind the blocks, when the front is crowded
    }
    const labelAt = { band: rc.band, p: edge[0], edge, back, right };
    return { node: r.node, label: r.label, label3: r.label3 || r.label, at, rects, boxes: r.boxes, labelAt };
  }).filter(Boolean);

  // Each plate covers its own blocks and frames; an empty plate spans the whole stack.
  const plates = {};
  for (const band of bands) {
    const xs = [];
    for (const b of Object.values(boxes)) if (b.band === band.id) xs.push(b.x - W / 2 - MARGIN_X, b.x + W / 2 + MARGIN_X);
    for (const r of regions) for (const rc of r.rects) if (rc.band === band.id) xs.push(rc.x0 - 0.6, rc.x1 + 0.6);
    if (!xs.length) { plates[band.id] = { ...plate }; continue; }
    let px0 = Math.min(...xs), px1 = Math.max(...xs);
    const minW = Math.min(x1 - x0, W + 2 * MARGIN_X + COL * 0.5); // a one-block plate still reads as a plate
    if (px1 - px0 < minW) { const c = (px0 + px1) / 2; px0 = c - minW / 2; px1 = c + minW / 2; }
    // stay inside the stack's outline
    if (px0 < x0) { px1 += x0 - px0; px0 = x0; }
    if (px1 > x1) { px0 -= px1 - x1; px1 = x1; }
    plates[band.id] = { x0: Math.max(x0, px0), x1: Math.min(x1, px1), z0: Z0, z1: Z1, t: PLATE_T };
  }

  const howOf = (s) => {
    const a = boxes[s.from], b = boxes[s.to];
    if (!a || !b) return null;
    if (a.bi === b.bi) return "same";
    return b.bi > a.bi ? "down" : "up";
  };
  // Ends of the tubes on each face, spread along x in the order of where the other end is.
  const ends = [];
  for (const s of scene.steps) {
    const how = howOf(s);
    if (!how) continue;
    const a = boxes[s.from], b = boxes[s.to];
    const faces = { same: ["topB", "topB"], down: ["bottom", "topF"], up: ["topF", "front"] }[how];
    ends.push({ box: a, face: faces[0], s, role: "from", other: b });
    ends.push({ box: b, face: faces[1], s, role: "to", other: a });
  }
  const portX = new Map();
  const groups = {};
  for (const e of ends) (groups[`${e.box.id}|${e.face}`] ||= []).push(e);
  for (const list of Object.values(groups)) {
    list.sort((p, q) => (p.other.x - q.other.x) || (p.other.bi - q.other.bi) || (p.s.i - q.s.i));
    const m = list.length;
    const span = Math.min(W * 0.66, (m - 1) * 0.85);
    list.forEach((e, j) => portX.set(`${e.s.i}|${e.role}`, m === 1 ? 0 : -span / 2 + (span * j) / (m - 1)));
  }

  const ZF = D * 0.2;   // z of ports on the front half of a top face
  const ZB = -D * 0.24; // z of ports on the back half (arcs)
  const tubes = [];
  for (const s of scene.steps) {
    const how = howOf(s);
    if (!how) continue;
    const a = boxes[s.from], b = boxes[s.to];
    const xa = a.x + (portX.get(`${s.i}|from`) || 0), xb = b.x + (portX.get(`${s.i}|to`) || 0);
    const span = Math.abs(a.bi - b.bi);
    let segs;
    if (how === "same") {
      const p0 = [xa, a.y + H, ZB], p3 = [xb, b.y + H, ZB];
      const lift = 1.15 + Math.min(2.2, Math.abs(xb - xa) * 0.14);
      segs = [[p0, [xa, p0[1] + lift, ZB], [xb, p3[1] + lift, ZB], p3]];
    } else if (how === "down") {
      const p0 = [xa, a.y, ZF], p3 = [xb, b.y + H, ZF];
      if (span === 1) {
        const dy = p0[1] - p3[1];
        segs = [[p0, [xa, p0[1] - dy * 0.45, ZF], [xb, p3[1] + dy * 0.45, ZF], p3]];
      } else {
        const l0 = [xa, a.y - PLATE_T - 1.0, LANE], l1 = [xb, b.y + H + 1.5, LANE];
        segs = [
          [p0, [xa, p0[1] - 0.7, ZF], [xa, l0[1] + 0.5, LANE], l0],
          [l0, [xa, l0[1] - (l0[1] - l1[1]) * 0.4, LANE], [xb, l1[1] + (l0[1] - l1[1]) * 0.4, LANE], l1],
          [l1, [xb, l1[1] - 0.6, LANE], [xb, p3[1] + 0.7, ZF], p3],
        ];
      }
    } else {
      const p0 = [xa, a.y + H, ZF], p3 = [xb, b.y + H * 0.5, b.z + D / 2];
      const l0 = [xa, a.y + H + 1.0, LANE], q = [xb, b.y - PLATE_T - 1.0, LANE];
      segs = [
        [p0, [xa, p0[1] + 0.55, ZF], [xa, l0[1] - 0.45, LANE], l0],
        [l0, [xa, l0[1] + (q[1] - l0[1]) * 0.42, LANE], [xb, q[1] - (q[1] - l0[1]) * 0.42, LANE], q],
        [q, [xb, q[1] + 1.25, LANE], [xb, p3[1], p3[2] + 1.0], p3],
      ];
    }
    tubes.push({ i: s.i, kind: s.kind, alt: s.alt, how, segs, vias: [] });
  }

  // Where tubes pass through plates: rings on the plate surface (only where there is a plate).
  for (const t of tubes) {
    const pts = samplePath(t.segs, 120);
    for (const band of bands) {
      const ym = band.y - PLATE_T / 2, pl = plates[band.id];
      for (let j = 1; j < pts.length; j++) {
        const p = pts[j - 1], q = pts[j];
        if ((p[1] - ym) * (q[1] - ym) < 0) {
          const f = (ym - p[1]) / (q[1] - p[1]);
          const v = [p[0] + (q[0] - p[0]) * f, band.y, p[2] + (q[2] - p[2]) * f];
          if (v[0] > pl.x0 + 0.3 && v[0] < pl.x1 - 0.3) t.vias.push({ band: band.id, p: v });
        }
      }
    }
  }


  const bounds = { x0, x1, y0: bands[n - 1].y - PLATE_T, y1: bands[0].y + H + 1.2, z0: plate.z0, z1: plate.z1 };
  return { bands, boxes, plate, plates, tubes, regions, reserved, bounds };
}

export function bez(p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [0, 1, 2].map((k) => a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k]);
}
export function samplePath(segs, n) {
  const out = [];
  for (let s = 0; s < segs.length; s++) for (let j = s ? 1 : 0; j <= n; j++) out.push(bez(...segs[s], j / n));
  return out;
}
