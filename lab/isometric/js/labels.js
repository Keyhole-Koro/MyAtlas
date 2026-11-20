// Screen-aligned labels for the machines, placed so that they do not cover each other,
// the machines, or the elevator.
import { esc, f1 } from "./iso.js";

const ctx = document.createElement("canvas").getContext("2d");
const FONT = getComputedStyle(document.documentElement).getPropertyValue("--font") || "sans-serif";
const MONO = getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace";
export function measure(text, size, weight = 400, mono = false) {
  ctx.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  return ctx.measureText(text).width;
}

// Type sizes are screen pixels: every screen-space group is drawn at these sizes inside a
// scale(ls) group, where ls undoes the camera zoom (see scene.js), so text never gets smaller
// than this on screen.
const PADX = 8, PADY = 5, L1 = 13, L2 = 12, GAP = 3;

/** Size of a two-line label: bw/bh at type size, w/h in world units for scale ls. */
export function labelBox(t1, t2, ls = 1) {
  const w1 = measure(t1, L1, 600, true);
  const w2 = t2 ? measure(t2, L2) : 0;
  const bw = Math.ceil(Math.max(w1, w2) + PADX * 2 + 4);
  const bh = Math.ceil(PADY * 2 + L1 + (t2 ? GAP + L2 : 0) + 3);
  return { w: bw * ls, h: bh * ls, bw, bh };
}

export function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const y = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return x * y;
}

/**
 * items: [{id, bounds:{x0,y0,x1,y1}, w, h, prefer:"right"|"left", weight}]
 * obstacles: [{x0,y0,x1,y1, k}]
 */
export function place(items, obstacles) {
  const placed = [];
  const order = items.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
  for (const it of order) {
    const b = it.bounds, cx = (b.x0 + b.x1) / 2, q = it.ls || 1;
    const midY = b.y0 + (b.y1 - b.y0) * 0.42;
    const c = {
      right: [b.x1 + 4 * q, midY - it.h / 2],
      left: [b.x0 - 4 * q - it.w, midY - it.h / 2],
      above: [cx - it.w / 2, b.y0 - 6 * q - it.h],
      below: [cx - it.w / 2, b.y1 + 4 * q],
      aboveR: [b.x1 - 14 * q, b.y0 - it.h + 2 * q],
      aboveL: [b.x0 + 14 * q - it.w, b.y0 - it.h + 2 * q],
      belowR: [b.x1 - 10 * q, b.y1 - 8 * q],
      belowL: [b.x0 + 10 * q - it.w, b.y1 - 8 * q],
      right2: [b.x1 + 4 * q, b.y1 - it.h + 4 * q],
      left2: [b.x0 - 4 * q - it.w, b.y1 - it.h + 4 * q],
    };
    // beside the machine first, then level with its foot: a label above it drifts into the
    // floor above and reads as that floor's
    const prefOrder = it.prefer === "left"
      ? ["left", "left2", "aboveL", "belowL", "below", "above", "right", "right2", "aboveR", "belowR"]
      : ["right", "right2", "aboveR", "belowR", "below", "above", "left", "left2", "aboveL", "belowL"];
    let best = null;
    prefOrder.forEach((k, rank) => {
      const [x, y] = c[k];
      const r = { x0: x, y0: y, x1: x + it.w, y1: y + it.h };
      let score = rank * 30;
      for (const p of placed) score += overlap(r, p.r) * 12;
      for (const o of obstacles) {
        if (o.id === it.id) continue;
        score += overlap(r, o) * (o.k ?? 3);
      }
      if (!best || score < best.score) best = { score, r, k };
    });
    placed.push({ id: it.id, r: best.r, side: best.k, item: it });
  }
  return placed;
}

/** SVG for one placed machine label. */
export function labelSvg(p, t1, t2, cls, tone, attrs = "", ls = 1) {
  const { x0, y0 } = p.r, w = p.item.bw, h = p.item.bh;
  let s = `<g class="lbl ${cls} tone-${tone}" ${attrs} transform="translate(${f1(x0)},${f1(y0)}) scale(${ls.toFixed(4)})">`;
  s += `<rect class="bg" x="0" y="0" width="${w}" height="${h}" rx="6"/>`;
  s += `<rect class="bar" x="0" y="5" width="3" height="${h - 10}" rx="1.5"/>`;
  s += `<text class="t1" x="${PADX + 2}" y="${PADY + L1 - 0.5}">${esc(t1)}</text>`;
  if (t2) s += `<text class="t2" x="${PADX + 2}" y="${PADY + L1 + GAP + L2 + 0.5}">${esc(t2)}</text>`;
  return s + `</g>`;
}
