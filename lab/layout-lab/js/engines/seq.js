// (5) A sequence diagram: one lifeline per box in the order the steps first reach them, one row per step from top
// to bottom. Nothing crosses and the order is the reading order, but the layers survive only as colour, and the
// picture grows by a row for every step.
import { textW, isCode } from '../measure.js';

export const SEQ = { X0: 16, GAP: 18, HEAD_Y: 44, HEAD_H: 50, ROW_H: 54, FIRST: 50 };

export function seqOrder(D) {
  const main = D.steps.filter((s) => !s.alt);
  const rows = [];
  for (const s of main) {
    rows.push(s);
    const alts = D.steps.filter((a) => a.alt && a.alt.at === s.i);
    rows.push(...alts);
  }
  // alternatives whose step is not found go last
  for (const s of D.steps) if (!rows.includes(s)) rows.push(s);
  return rows;
}

export function layoutSeq(D, extra = {}) {
  const o = { ...SEQ, ...extra };
  const cols = [...D.boxes].sort((a, b) => a.first - b.first);
  const bandName = Object.fromEntries(D.bands.map((b) => [b.id, b.name]));
  const boxes = {}, centre = {};
  let x = o.X0;
  for (const b of cols) {
    const t = b.short || b.title;
    const w = Math.max(92, Math.ceil(Math.max(textW(t, 13, isCode(t), 600), textW(bandName[b.band] || '', 12)) + 22));
    boxes[b.id] = { x, y: o.HEAD_Y, w, h: o.HEAD_H };
    centre[b.id] = x + w / 2;
    x += w + o.GAP;
  }
  let width = x - o.GAP + o.X0;
  const rows = seqOrder(D);
  const top = o.HEAD_Y + o.HEAD_H + o.FIRST;
  const edges = [], labels = [], frames = [];
  rows.forEach((s, k) => {
    const y = top + k * o.ROW_H, xa = centre[s.from], xb = centre[s.to];
    const dir = xb > xa ? 1 : -1;
    edges.push({ i: s.i, pts: [[xa + dir * 4, y], [xb - dir * 4, y]], row: k });
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb), w = s.pill.w;
    let lx = (lo + hi) / 2 - w / 2;
    if (w > hi - lo - 12) lx = lo + 8;
    labels.push({ i: s.i, x: lx, y: y - s.pill.h - 5, w, h: s.pill.h });
    width = Math.max(width, lx + w + o.X0);
  });
  // a dashed frame round the steps that happen instead of another
  let k = 0;
  while (k < rows.length) {
    if (!rows[k].alt) { k++; continue; }
    let j = k;
    while (j + 1 < rows.length && rows[j + 1].alt && rows[j + 1].alt.at === rows[k].alt.at) j++;
    const ids = rows.slice(k, j + 1).flatMap((s) => [s.from, s.to]);
    const xs = ids.map((id) => centre[id]);
    const lab = labels.filter((l) => rows.slice(k, j + 1).some((s) => s.i === l.i));
    const at = D.steps[rows[k].alt.at];
    frames.push({
      label: `もし ${rows[k].alt.when}（${at ? at.no : ''} の代わり）`,
      x0: Math.min(...xs, ...lab.map((l) => l.x)) - 14, x1: Math.max(...xs, ...lab.map((l) => l.x + l.w)) + 14,
      y0: top + k * o.ROW_H - o.ROW_H + 8, y1: top + j * o.ROW_H + 14,
    });
    k = j + 1;
  }
  const height = top + (rows.length - 1) * o.ROW_H + 40;
  const lifelines = cols.map((b) => ({ id: b.id, x: centre[b.id], y0: o.HEAD_Y + o.HEAD_H, y1: height - 16 }));
  // contexts as brackets over the heads, one per run of neighbouring columns
  const brackets = [];
  for (const rg of D.regions) {
    const idx = rg.boxes.map((id) => cols.findIndex((c) => c.id === id)).filter((v) => v >= 0).sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const a = boxes[cols[run[0]].id], b = boxes[cols[run[run.length - 1]].id];
      brackets.push({ node: rg.node, label: rg.label3 || rg.label, x0: a.x, x1: b.x + b.w, y: o.HEAD_Y - 10 });
      run = [];
    };
    for (const v of idx) { if (run.length && v !== run[run.length - 1] + 1) flush(); run.push(v); }
    flush();
  }
  return { kind: 'seq', width, height, labelCol: 0, bands: null, boxes, edges, labels, regions: [], lifelines, brackets, frames, boxStyle: 'head' };
}
