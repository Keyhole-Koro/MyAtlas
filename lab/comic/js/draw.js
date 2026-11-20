// Drawing a panel: the two boxes as characters standing on their layer's floor, the verb as a speech
// bubble, the data handed over as an object between them. Hand-drawn lines come from rough.js;
// all text is plain SVG text so it stays crisp.
import { NODES, LAYER_BY_ID, shortRegion, speakerOf, nodeName } from './model.js';

const SVGNS = 'http://www.w3.org/2000/svg';
export const FONT = {
  sans: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace',
  mincho: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif',
};

// ---------- small helpers ----------
export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const ctx2d = document.createElement('canvas').getContext('2d');
const mcache = new Map();
export function measure(str, font) {
  const k = font + '|' + str;
  if (mcache.has(k)) return mcache.get(k);
  ctx2d.font = font;
  const w = ctx2d.measureText(str).width;
  mcache.set(k, w);
  return w;
}
export const F = {
  title: `600 12.5px ${FONT.mono}`,
  ns: `400 11px ${FONT.sans}`,
  slot: `500 11px ${FONT.mono}`,
  tab: `700 12px ${FONT.sans}`,
  bubble: `700 15px ${FONT.sans}`,
  bubbleKana: `700 15px ${FONT.mincho}`,
  obj: `700 12px ${FONT.mono}`,
  field: `500 11px ${FONT.mono}`,
  floor: `700 12px ${FONT.sans}`,
  small: `500 11px ${FONT.sans}`,
};
// A name may be narrowed this much (SVG textLength) before it wraps to another line.
export const SQUEEZE = 1.18;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483647 || 7;
}

// rough.js wrapper: every shape is ink-coloured unless a class says otherwise.
class Pen {
  constructor(svg, seedKey) { this.rc = window.rough.svg(svg); this.seed = hash(seedKey); this.n = 0; }
  opts(o = {}) {
    return {
      stroke: 'currentColor', strokeWidth: o.w ?? 1.7, roughness: o.r ?? 0.75, bowing: o.bow ?? 0.6,
      seed: this.seed + (this.n++) * 97, disableMultiStroke: o.single ?? false,
      strokeLineDash: o.dash, preserveVertices: o.keep ?? false,
    };
  }
  path(g, d, o = {}) { const n = this.rc.path(d, this.opts(o)); if (o.cls) n.setAttribute('class', o.cls); g.appendChild(n); return n; }
  line(g, x1, y1, x2, y2, o = {}) { const n = this.rc.line(x1, y1, x2, y2, this.opts(o)); if (o.cls) n.setAttribute('class', o.cls); g.appendChild(n); return n; }
  ellipse(g, cx, cy, w, h, o = {}) { const n = this.rc.ellipse(cx, cy, w, h, this.opts(o)); if (o.cls) n.setAttribute('class', o.cls); g.appendChild(n); return n; }
  poly(g, pts, o = {}) { const n = this.rc.polygon(pts, this.opts(o)); if (o.cls) n.setAttribute('class', o.cls); g.appendChild(n); return n; }
  lines(g, pts, o = {}) { const n = this.rc.linearPath(pts, this.opts(o)); if (o.cls) n.setAttribute('class', o.cls); g.appendChild(n); return n; }
}

export function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

function txt(g, x, y, str, cls, anchor = 'start') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, g);
  t.textContent = str;
  return t;
}

// Manga lettering: kana in mincho, the rest in gothic (アンチック).
function letter(g, x, y, str, cls, anchor = 'middle') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, g);
  for (const part of str.split(/([぀-ヿ]+)/)) {
    if (!part) continue;
    const s = el('tspan', /[぀-ヿ]/.test(part) ? { class: 'kana' } : {}, t);
    s.textContent = part;
  }
  return t;
}
function letterWidth(str) {
  let w = 0;
  for (const part of str.split(/([぀-ヿ]+)/)) if (part) w += measure(part, /[぀-ヿ]/.test(part) ? F.bubbleKana : F.bubble);
  return w;
}

// Identifiers wrap after "_", "." or ", " (the space stays with the comma), or before "(".
// A short tail such as "m)" goes back up when that line can be narrowed to fit.
export function wrapIdent(s, maxW, font = F.title) {
  if (measure(s, font) <= maxW) return [s];
  const parts = s.split(/(?<=[_.]|, )|(?=\()/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const p of parts) {
    if (cur && measure((cur + p).trimEnd(), font) > maxW) { lines.push(cur); cur = p; } else cur += p;
  }
  if (cur) lines.push(cur);
  if (lines.length > 1 && lines[lines.length - 1].trim().length <= 3) {
    const joined = lines[lines.length - 2] + lines[lines.length - 1];
    if (measure(joined.trimEnd(), font) <= maxW * SQUEEZE) lines.splice(-2, 2, joined);
  }
  return lines.map((l) => l.trimEnd());
}

// Lines of a name inside a width: as it is, narrowed a little, or wrapped (each line narrowed if
// it is still a little too wide). Each line is {t, w, fit}: fit is the width to narrow it to.
export function fitIdent(s, inner, font, maxLines = 3) {
  const w0 = measure(s, font);
  if (w0 <= inner) return [{ t: s, w: w0, fit: null }];
  if (w0 <= inner * SQUEEZE) return [{ t: s, w: inner, fit: inner }];
  let lines = wrapIdent(s, inner, font);
  if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join('')];
  return lines.map((t) => { const w = measure(t, font); return w <= inner ? { t, w, fit: null } : { t, w: inner, fit: inner }; });
}

// Text that may be narrowed to a width.
function fitTxt(g, x, y, line, cls, anchor) {
  const t = txt(g, x, y, line.t, cls, anchor);
  if (line.fit) { t.setAttribute('textLength', line.fit); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
  return t;
}

// A list of names joined with " · ", broken only between names.
export function wrapItems(items, maxW, font) {
  const lines = [];
  let cur = '';
  for (const it of items) {
    const next = cur ? cur + ' · ' + it : it;
    if (cur && measure(next, font) > maxW) { lines.push(cur); cur = it; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function wrapText(s, maxW, font) {
  const lines = [];
  let cur = '';
  for (const ch of Array.from(s)) {
    if (cur && measure(cur + ch, font) > maxW) { lines.push(cur); cur = ch.trimStart(); } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

const tone = (t) => `L-${LAYER_BY_ID[t] ? t : 'os'}`;

// ---------- characters ----------
// Size of a character before drawing it, so the scene can lay itself out.
export function sizeOf(box, maxW) {
  if (box.kind === 'func') {
    const inner = Math.max(56, maxW - 22);
    const name = box.short && measure(box.title, F.title) > inner * SQUEEZE ? box.short : box.title;
    const lines = fitIdent(name, inner, F.title);
    // the namespace wraps or narrows like the name, so it never runs past the body
    const nsLines = box.ns ? fitIdent(box.ns, inner, F.ns, 2) : [];
    const textW = Math.max(...lines.map((l) => l.w), ...nsLines.map((l) => l.w));
    const w = Math.min(maxW, Math.max(78, textW + 22));
    const bodyH = 12 + lines.length * 15 + (nsLines.length ? 14 + (nsLines.length - 1) * 12 : 0) + 6;
    return { kind: 'func', lines, nsLines, w, bodyH, h: 27 + bodyH + 9, head: 13 };
  }
  if (box.kind === 'hw') {
    const bits = box.bits || [];
    let cellW = bits.map(([n, b]) => Math.max(measure(n, F.slot) + 14, b * 4.2));
    const w = Math.min(maxW, Math.max(cellW.reduce((a, b) => a + b, 0) + 12, measure(box.title, F.tab) + 50));
    // the bit fields shrink with the body (their widths stay in proportion)
    const total = cellW.reduce((a, b) => a + b, 0);
    if (total > w - 12) cellW = cellW.map((c) => (c * (w - 12)) / total);
    return { kind: 'hw', w, h: 34 + 14 + 32 + 8, cellW };
  }
  // stores: a cabinet with the box's slots; the DOM is drawn as its tree.
  const slots = box.slots || [];
  if (box.node === 'os.dom') {
    const [root, ...kids] = slots;
    const kidW = kids.map((k) => measure(k, F.slot) + 14);
    const kidsTotal = kidW.reduce((a, b) => a + b, 0) + 8 * Math.max(0, kids.length - 1);
    const want = Math.max(measure(root || '', F.slot) + 16, kidsTotal) + 20;
    const w = Math.min(maxW, Math.max(want, measure(box.title, F.tab) + 34));
    const room = w - 14;
    const k = kidsTotal > room ? (room - 8 * Math.max(0, kids.length - 1)) / (kidsTotal - 8 * Math.max(0, kids.length - 1)) : 1;
    return { kind: 'tree', w, h: 20 + 56 + 8, slots, kidW: kidW.map((x) => x * k), squeeze: k < 1 };
  }
  const ring = NODES[box.node]?.shape?.of === 'kernel.channel' || box.node === 'os.request-ring';
  const same = slots.length > 1 && slots.every((x) => x === slots[0]);
  const iconOnly = ring && same && !!box.slotSchema;
  const slotW = slots.map((s) => (iconOnly ? 30 : measure(s, F.slot) + (ring && !same ? 26 : 14)));
  const tabW = measure(box.title, F.tab) + 22;
  const frame = 8 + (ring ? 16 : 0);
  const avail = Math.max(30, maxW - frame);
  // as few rows as fit the width, the slots spread evenly over them
  let rows = [slots.map((_, i) => i)];
  for (let n = 1; n <= Math.max(1, slots.length); n++) {
    const per = Math.ceil(slots.length / n);
    rows = [];
    for (let i = 0; i < slots.length; i += per) rows.push(slots.slice(i, i + per).map((_, j) => i + j));
    if (Math.max(0, ...rows.map((r) => r.reduce((a, i) => a + slotW[i], 0))) <= avail) break;
  }
  if (!rows.length) rows = [[]];
  // a slot wider than the cabinet is narrowed to it
  const fit = slotW.map((sw) => (sw > avail ? avail : null));
  for (let i = 0; i < slotW.length; i++) if (fit[i]) slotW[i] = avail;
  const rowW = Math.max(0, ...rows.map((r) => r.reduce((a, i) => a + slotW[i], 0)));
  const w = Math.min(maxW, Math.max(rowW + frame, tabW, 70));
  return { kind: ring ? 'ring' : 'cabinet', w, h: 20 + rows.length * 26 + 6 + 8, rows, slotW, fit, ring, iconOnly, letters: ring && !same };
}

// Draws a character with its feet on (cx, ground). Returns its geometry.
export function drawCharacter(pen, g, box, cx, ground, sz, mood = {}) {
  const grp = el('g', { class: `chr ${tone(box.tone)}`, 'data-box': box.id }, g);
  const x = cx - sz.w / 2;
  const top = ground - sz.h;
  const geo = { cx, x, w: sz.w, top, ground, box };
  if (sz.kind === 'func') {
    const r = sz.head, hx = cx, hy = top + r + 1;
    const by = hy + r + 1, bh = sz.bodyH;
    // legs
    for (const dx of [-sz.w * 0.2, sz.w * 0.2]) {
      pen.line(grp, cx + dx, by + bh - 1, cx + dx, ground - 1, { w: 1.8, single: true, cls: 'ink' });
      pen.line(grp, cx + dx, ground - 1, cx + dx + (dx < 0 ? -5 : 5), ground - 1, { w: 2.2, single: true, cls: 'ink' });
    }
    // arms
    const ay = by + 15;
    const armL = mood.reach === 'L' ? [x - 13, ay - 6] : [x - 7, ay + 12];
    const armR = mood.reach === 'R' ? [x + sz.w + 13, ay - 6] : [x + sz.w + 7, ay + 12];
    pen.lines(grp, [[x + 1, ay], armL], { w: 1.8, single: true, cls: 'ink' });
    pen.lines(grp, [[x + sz.w - 1, ay], armR], { w: 1.8, single: true, cls: 'ink' });
    for (const [hx2, hy2] of [armL, armR]) el('circle', { cx: hx2, cy: hy2, r: 2.6, class: 'fill-sheet eye-ring' }, grp);
    // body: a sign with the function's name
    el('path', { d: rr(x, by, sz.w, bh, 9), class: 'fill-sheet' }, grp);
    el('path', { d: rr(x, by, sz.w, bh, 9), class: 'fill-tone' }, grp);
    el('path', { d: `M${x + 4},${by + 6}V${by + bh - 6}`, class: 'stripe' }, grp);
    pen.path(grp, rr(x, by, sz.w, bh, 9), { w: 1.7, cls: 'ink' });
    let ty = by + 18;
    for (const l of sz.lines) { fitTxt(grp, cx + 2, ty, l, 't-title', 'middle'); ty += 15; }
    ty -= 1;
    for (const l of sz.nsLines || []) { fitTxt(grp, cx + 2, ty, l, 't-ns', 'middle'); ty += 12; }
    // head
    el('circle', { cx: hx, cy: hy, r, class: 'fill-sheet' }, grp);
    pen.ellipse(grp, hx, hy, r * 2, r * 2, { w: 1.7, cls: 'ink' });
    face(pen, grp, hx, hy, mood);
    Object.assign(geo, { headX: hx, headY: hy, headTop: hy - r, bodyTop: by, mid: by + bh / 2, armY: ay, h: sz.h });
  } else if (sz.kind === 'hw') {
    // a clock-headed register: the dial on top, the bit fields as the body
    const r = 15, hx = cx, hy = top + r + 2;
    const by = hy + r + 4, bh = 32 + 14;
    el('path', { d: rr(x, by, sz.w, bh, 6), class: 'fill-sheet' }, grp);
    el('path', { d: rr(x, by, sz.w, bh, 6), class: 'fill-tone' }, grp);
    pen.path(grp, rr(x, by, sz.w, bh, 6), { w: 1.7, cls: 'ink' });
    const hw = measure(box.title, F.tab);
    fitTxt(grp, cx, by + 14, { t: box.title, fit: hw > sz.w - 10 ? sz.w - 10 : null }, 't-tab', 'middle');
    const total = sz.cellW.reduce((a, b) => a + b, 0);
    let cx0 = cx - total / 2;
    (box.bits || []).forEach(([name, bits], i) => {
      const cw = sz.cellW[i];
      el('rect', { x: cx0, y: by + 20, width: cw, height: 20, class: 'fill-sheet' }, grp);
      pen.path(grp, `M${cx0},${by + 20}h${cw}v20h${-cw}Z`, { w: 1.2, single: true, cls: 'ink' });
      const nw = measure(name, F.slot);
      fitTxt(grp, cx0 + cw / 2, by + 34, { t: name, fit: nw > cw - 6 ? cw - 6 : null }, 't-slot', 'middle');
      cx0 += cw;
    });
    // feet
    pen.line(grp, x + 10, by + bh, x + 6, ground - 1, { w: 2, single: true, cls: 'ink' });
    pen.line(grp, x + sz.w - 10, by + bh, x + sz.w - 6, ground - 1, { w: 2, single: true, cls: 'ink' });
    // the dial and its two bells
    for (const s of [-1, 1]) pen.ellipse(grp, hx + s * 11, hy - 12, 9, 7, { w: 1.4, single: true, cls: 'ink' });
    el('circle', { cx: hx, cy: hy, r, class: 'fill-sheet' }, grp);
    pen.ellipse(grp, hx, hy, r * 2, r * 2, { w: 1.8, cls: 'ink' });
    pen.line(grp, hx, hy, hx, hy - 9, { w: 1.6, single: true, cls: 'ink' });
    pen.line(grp, hx, hy, hx + 6, hy + 3, { w: 1.6, single: true, cls: 'ink' });
    if (mood.ring) for (const s of [-1, 1]) {
      pen.lines(grp, [[hx + s * 20, hy - 14], [hx + s * 25, hy - 18]], { w: 1.6, single: true, cls: 'ink' });
      pen.lines(grp, [[hx + s * 21, hy - 4], [hx + s * 28, hy - 5]], { w: 1.6, single: true, cls: 'ink' });
    }
    Object.assign(geo, { headX: hx, headY: hy, headTop: hy - r - 16, bodyTop: by, mid: by + bh / 2, h: sz.h });
  } else if (sz.kind === 'tree') {
    const tabW = measure(box.title, F.tab) + 18;
    const by = top + 20, TH = 56;
    el('path', { d: rr(x, by, sz.w, TH, 8), class: 'fill-sheet' }, grp);
    el('path', { d: rr(x, by, sz.w, TH, 8), class: 'fill-tone soft' }, grp);
    pen.path(grp, rr(x, by, sz.w, TH, 8), { w: 1.7, cls: 'ink' });
    tab(pen, grp, x + 8, top + 2, tabW, box.title);
    const [root, ...kids] = box.slots || [];
    const rw = measure(root || '', F.slot) + 16;
    const ry = by + 6;
    if (root) {
      el('rect', { x: cx - rw / 2, y: ry, width: rw, height: 19, rx: 4, class: 'fill-sheet' }, grp);
      pen.path(grp, rr(cx - rw / 2, ry, rw, 19, 4), { w: 1.2, single: true, cls: 'ink' });
      txt(grp, cx, ry + 13.5, root, 't-slot', 'middle');
    }
    const kw = sz.kidW || kids.map((k) => measure(k, F.slot) + 14);
    const gap = 8, total = kw.reduce((a, b) => a + b, 0) + gap * (kids.length - 1);
    let kx = cx - total / 2;
    kids.forEach((k, i) => {
      const ky = ry + 29, kcx = kx + kw[i] / 2;
      pen.line(grp, cx, ry + 19, kcx, ky, { w: 1.1, single: true, cls: 'ink' });
      el('rect', { x: kx, y: ky, width: kw[i], height: 19, rx: 4, class: 'fill-sheet' }, grp);
      pen.path(grp, rr(kx, ky, kw[i], 19, 4), { w: 1.2, single: true, cls: 'ink' });
      const nw = measure(k, F.slot);
      fitTxt(grp, kcx, ky + 13.5, { t: k, fit: nw > kw[i] - 6 ? kw[i] - 6 : null }, 't-slot', 'middle');
      kx += kw[i] + gap;
    });
    feet(pen, grp, x, by + TH, sz.w, ground);
    Object.assign(geo, { headX: cx, headY: by, headTop: top, bodyTop: by, mid: by + TH / 2, h: sz.h });
  } else {
    // cabinet / ring
    const tabW = Math.min(sz.w - 8, measure(box.title, F.tab) + 18);
    const by = top + 20, bh = sz.rows.length * 26 + 6;
    el('path', { d: rr(x, by, sz.w, bh, sz.ring ? 13 : 6), class: 'fill-sheet' }, grp);
    el('path', { d: rr(x, by, sz.w, bh, sz.ring ? 13 : 6), class: 'fill-tone soft' }, grp);
    pen.path(grp, rr(x, by, sz.w, bh, sz.ring ? 13 : 6), { w: 1.7, cls: 'ink' });
    tab(pen, grp, x + 8, top + 2, tabW, box.title);
    const slots = box.slots || [];
    sz.rows.forEach((row, ri) => {
      const rowW = row.reduce((a, i) => a + sz.slotW[i], 0);
      let sx = cx - rowW / 2;
      const sy = by + 4 + ri * 26;
      for (const i of row) {
        const sw = sz.slotW[i] - 4;
        el('rect', { x: sx + 2, y: sy, width: sw, height: 22, rx: 3, class: 'fill-sheet' }, grp);
        pen.path(grp, rr(sx + 2, sy, sw, 22, 3), { w: 1.1, single: true, cls: 'ink' });
        if (sz.iconOnly) envelope(pen, grp, sx + 2 + sw / 2 - 7.5, sy + 5.5, 15, 11);
        else if (sz.letters) {
          envelope(pen, grp, sx + 7, sy + 6, 13, 10);
          fitTxt(grp, sx + 24, sy + 15.5, { t: slots[i], fit: sz.fit?.[i] ? sw - 26 : null }, 't-slot');
        } else fitTxt(grp, sx + 2 + sw / 2, sy + 15.5, { t: slots[i], fit: sz.fit?.[i] ? sw - 8 : null }, 't-slot', 'middle');
        sx += sz.slotW[i];
      }
    });
    feet(pen, grp, x, by + bh, sz.w, ground);
    Object.assign(geo, { headX: cx, headY: by, headTop: top, bodyTop: by, mid: by + bh / 2, h: sz.h });
  }
  geo.right = x + sz.w; geo.left = x;
  return geo;
}

function feet(pen, g, x, y, w, ground) {
  if (ground - y < 3) return;
  for (const fx of [x + 12, x + w - 12]) {
    el('rect', { x: fx - 4, y, width: 8, height: ground - y, class: 'fill-ink' }, g);
  }
}

function tab(pen, g, x, y, w, title) {
  el('path', { d: rr(x, y, w, 20, 5), class: 'fill-sheet' }, g);
  el('path', { d: rr(x, y, w, 20, 5), class: 'fill-tone strong' }, g);
  pen.path(g, rr(x, y, w, 20, 5), { w: 1.3, single: true, cls: 'ink' });
  const tw = measure(title, F.tab);
  fitTxt(g, x + w / 2, y + 14.5, { t: title, fit: tw > w - 10 ? w - 10 : null }, 't-tab', 'middle');
}

function envelope(pen, g, x, y, w, h) {
  el('rect', { x, y, width: w, height: h, class: 'fill-sheet' }, g);
  pen.path(g, `M${x},${y}h${w}v${h}h${-w}Z M${x},${y}L${x + w / 2},${y + h * 0.55}L${x + w},${y}`, { w: 1.1, single: true, r: 0.4, cls: 'ink' });
}

function face(pen, g, hx, hy, mood) {
  if (mood.surprised) {
    for (const s of [-1, 1]) { el('circle', { cx: hx + s * 4.6, cy: hy - 1.5, r: 2.9, class: 'fill-sheet eye-ring' }, g); el('circle', { cx: hx + s * 4.6, cy: hy - 1.2, r: 1.4, class: 'fill-ink' }, g); }
    el('ellipse', { cx: hx, cy: hy + 6, rx: 2, ry: 2.4, class: 'fill-ink' }, g);
  } else {
    for (const s of [-1, 1]) el('ellipse', { cx: hx + s * 4.6, cy: hy - 1.5, rx: 1.7, ry: 2.3, class: 'fill-ink' }, g);
    if (mood.talk) el('path', { d: `M${hx - 3.6},${hy + 4}Q${hx},${hy + 10} ${hx + 3.6},${hy + 4}Z`, class: 'fill-ink' }, g);
    else if (mood.sad) el('path', { d: `M${hx - 3.5},${hy + 7}Q${hx},${hy + 3.6} ${hx + 3.5},${hy + 7}`, class: 'stroke-ink' }, g);
    else el('path', { d: `M${hx - 3.5},${hy + 4.2}Q${hx},${hy + 7.6} ${hx + 3.5},${hy + 4.2}`, class: 'stroke-ink' }, g);
  }
  // cheeks in the layer's colour
  for (const s of [-1, 1]) el('ellipse', { cx: hx + s * 8, cy: hy + 3.4, rx: 2.6, ry: 1.6, class: 'cheek' }, g);
  if (mood.sweat) el('path', { d: `M${hx + 13},${hy - 9}q4,6 0,8q-4,-2 0,-8Z`, class: 'sweat' }, g);
}

// ---------- the object handed over ----------
// The shape says what kind of data it is: an envelope for a Request or Event, a document for another
// struct, a tag for an address only, a strip for characters, a bundle for words, a register, or a
// round token for a number.
export function objectShape(data) {
  const label = data.label;
  const node = data.schema ? NODES[data.schema] : null;
  const type = data.type || '';
  if (label.startsWith('&')) return 'tag';
  if (node && node.kind === 'hw') return 'reg';
  if (data.schema === 'schema.request' || data.schema === 'schema.event') return 'letter';
  if (node && node.kind === 'schema') return 'doc';
  if (/文字/.test(type)) return 'str';
  if (/語/.test(label) || /words?\[/.test(type)) return 'words';
  return 'token';
}
const ICON_W = { token: 0, str: 22, words: 22 };

export function objectSpec(data, maxW) {
  if (!data) return null;
  const label = data.label;
  const shape = objectShape(data);
  const lw = measure(label, F.obj);
  const iconW = ICON_W[shape] ?? 20;
  const cardW = Math.min(Math.max(maxW, lw + 22), lw + iconW + 20 + (shape === 'str' ? 6 : 0));
  const fields = data.fields || [];
  const flines = fields.length ? wrapItems(fields, Math.max(70, maxW - 6), F.field) : [];
  return { shape, label, cardW, cardH: 26, fields, flines, w: Math.max(cardW, ...flines.map((l) => measure(l, F.field) + 8)), h: 26 + (flines.length ? 4 + flines.length * 14 : 0) };
}

export function drawObject(pen, g, spec, cx, cy, hot) {
  const grp = el('g', { class: 'obj' + (hot ? ' hot' : '') }, g);
  const x = cx - spec.cardW / 2, y = cy - spec.h / 2;
  // a halo round the card only, so a line passing behind shows on both sides; the field names
  // below have their own outline (paint-order) instead of a box
  el('path', { d: rr(x - 4, y - 4, spec.cardW + 8, spec.cardH + 8, 7), class: 'fill-bg halo' }, grp);
  if (spec.shape === 'str') {
    // characters on a strip, notched at both ends, with 字 as the mark
    const w = spec.cardW, h = spec.cardH;
    const d = `M${x},${y}H${x + w}L${x + w - 6},${y + h / 2}L${x + w},${y + h}H${x}L${x + 6},${y + h / 2}Z`;
    el('path', { d, class: 'fill-obj' }, grp);
    pen.path(grp, d, { w: 1.5, single: true, r: 0.5, cls: 'ink' });
    el('rect', { x: x + 10, y: y + 6, width: 14, height: 14, rx: 2, class: 'fill-sheet' }, grp);
    pen.path(grp, rr(x + 10, y + 6, 14, 14, 2), { w: 1, single: true, r: 0.3, cls: 'ink' });
    txt(grp, x + 17, y + 17.5, '字', 't-mark', 'middle');
    txt(grp, x + 29, y + 17.5, spec.label, 't-obj');
  } else if (spec.shape === 'words') {
    // a bundle of words: cards behind the card, a row of cells as the mark
    for (const o of [6, 3]) {
      el('path', { d: rr(x + o, y - o, spec.cardW, spec.cardH, 5), class: 'fill-obj' }, grp);
      pen.path(grp, rr(x + o, y - o, spec.cardW, spec.cardH, 5), { w: 1.1, single: true, r: 0.4, cls: 'ink' });
    }
    el('path', { d: rr(x, y, spec.cardW, spec.cardH, 5), class: 'fill-obj' }, grp);
    pen.path(grp, rr(x, y, spec.cardW, spec.cardH, 5), { w: 1.5, single: true, cls: 'ink' });
    const ix = x + 7, iy = y + 8;
    el('rect', { x: ix, y: iy, width: 15, height: 10, class: 'fill-sheet' }, grp);
    pen.path(grp, `M${ix},${iy}h15v10h-15Z M${ix + 5},${iy}v10 M${ix + 10},${iy}v10`, { w: 1, single: true, r: 0.3, cls: 'ink' });
    txt(grp, x + 27, y + 17.5, spec.label, 't-obj');
  } else if (spec.shape === 'tag') {
    const d = `M${x + 9},${y}H${x + spec.cardW}V${y + spec.cardH}H${x + 9}L${x},${y + spec.cardH / 2}Z`;
    el('path', { d, class: 'fill-obj' }, grp);
    pen.path(grp, d, { w: 1.5, single: true, cls: 'ink' });
    el('circle', { cx: x + 9, cy: y + spec.cardH / 2, r: 2.4, class: 'fill-sheet eye-ring' }, grp);
    txt(grp, x + 16, y + 17.5, spec.label, 't-obj');
  } else if (spec.shape === 'token') {
    el('path', { d: rr(x, y, spec.cardW, spec.cardH, 13), class: 'fill-obj' }, grp);
    pen.path(grp, rr(x, y, spec.cardW, spec.cardH, 13), { w: 1.5, single: true, cls: 'ink' });
    txt(grp, cx, y + 17.5, spec.label, 't-obj', 'middle');
  } else {
    el('path', { d: rr(x, y, spec.cardW, spec.cardH, 4), class: 'fill-obj' }, grp);
    pen.path(grp, rr(x, y, spec.cardW, spec.cardH, 4), { w: 1.5, single: true, cls: 'ink' });
    const ix = x + 6, iy = y + 7;
    if (spec.shape === 'letter') envelope(pen, grp, ix, iy, 15, 11);
    else if (spec.shape === 'doc') {
      el('path', { d: `M${ix},${iy - 1}h9l4,4v9h-13Z`, class: 'fill-sheet' }, grp);
      pen.path(grp, `M${ix},${iy - 1}h9l4,4v9h-13Z M${ix + 3},${iy + 6}h7 M${ix + 3},${iy + 9}h7`, { w: 1.1, single: true, r: 0.3, cls: 'ink' });
    } else if (spec.shape === 'reg') {
      pen.path(grp, `M${ix},${iy}h15v11h-15Z M${ix + 11},${iy}v11`, { w: 1.1, single: true, r: 0.3, cls: 'ink' });
    }
    txt(grp, x + 25, y + 17.5, spec.label, 't-obj');
  }
  let fy = y + spec.cardH + 15;
  for (const l of spec.flines) { txt(grp, cx, fy, l, 't-field', 'middle'); fy += 14; }
  return { x: cx - spec.w / 2, y, w: spec.w, h: spec.h, card: { x, y, w: spec.cardW, h: spec.cardH } };
}

// ---------- speech ----------
// style: talk (rounded), shout (spiky, for interrupts and notifications), call (square-ish, for syscalls)
export function bubbleSize(text) {
  const w = letterWidth(text) + 28;
  return { w, h: 32 };
}

export function drawBubble(pen, g, text, bx, by, tailTo, style) {
  const { w, h } = bubbleSize(text);
  const grp = el('g', { class: `bub ${style}` }, g);
  const x = bx - w / 2, y = by;
  if (style === 'shout') {
    // a burst around the words
    const pts = [];
    const cx = bx, cy = y + h / 2, rx = w / 2 + 14, ry = h / 2 + 11;
    const n = Math.max(14, Math.round(w / 9));
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI * i) / n, k = i % 2 ? 0.8 : 1.04;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    el('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: 'fill-burst' }, grp);
    pen.poly(grp, pts, { w: 1.6, single: true, r: 0.5, cls: 'ink' });
  } else {
    const r = style === 'call' ? 5 : 15;
    const [tx, ty] = tailTo;
    const baseX = Math.max(x + 14, Math.min(x + w - 14, tx + (bx - tx) * 0.35));
    const d = rr(x, y, w, h, r);
    const tail = `M${baseX - 7},${y + h - 1}L${tx},${ty}L${baseX + 7},${y + h - 1}`;
    el('path', { d, class: 'fill-sheet' }, grp);
    pen.path(grp, d, { w: style === 'call' ? 2.4 : 1.6, single: style !== 'call', cls: 'ink' });
    el('path', { d: tail + 'Z', class: 'fill-sheet' }, grp);
    pen.path(grp, tail, { w: 1.6, single: true, cls: 'ink' });
    if (style === 'call') el('path', { d: rr(x + 3, y + 3, w - 6, h - 6, 3), class: 'stroke-ink thin' }, grp);
  }
  letter(grp, bx, y + h / 2 + 5.5, text, 't-bubble');
  return { x: style === 'shout' ? x - 14 : x, y: style === 'shout' ? y - 11 : y, w: style === 'shout' ? w + 28 : w, h: style === 'shout' ? h + 22 : h };
}

// ---------- arrows ----------
// headG: where the arrowhead goes, when it must sit above things drawn after the line
function arrow(pen, g, pts, kind, headG) {
  const grp = el('g', { class: `arr k-${kind}` }, g);
  const [x2, y2] = pts[pts.length - 1];
  const [x1, y1] = pts[pts.length - 2];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const dash = { return: [7, 5], msg: [10, 4, 2, 4], data: [2.5, 4] }[kind];
  const w = kind === 'syscall' ? 3 : kind === 'data' ? 2 : 2.2;
  if (kind === 'signal') {
    // a zigzag: something is woken, not called
    const [sx, sy] = pts[0];
    const len = Math.hypot(x2 - sx, y2 - sy), n = Math.max(4, Math.round(len / 16));
    const nx = -(y2 - sy) / len, ny = (x2 - sx) / len;
    const zz = [[sx, sy]];
    for (let i = 1; i < n; i++) {
      const t = i / n, o = (i % 2 ? 1 : -1) * 6;
      zz.push([sx + (x2 - sx) * t + nx * o, sy + (y2 - sy) * t + ny * o]);
    }
    zz.push([x2 - Math.cos(a) * 6, y2 - Math.sin(a) * 6]);
    pen.lines(grp, zz, { w: 2.2, single: true, r: 0.4, cls: 'ink' });
  } else {
    pen.lines(grp, [...pts.slice(0, -1), [x2 - Math.cos(a) * 5, y2 - Math.sin(a) * 5]], { w, single: true, r: 0.5, dash, cls: 'ink' });
  }
  const hl = kind === 'syscall' ? 13 : 11, hw = kind === 'syscall' ? 7.5 : 6.5;
  const head = [[x2, y2], [x2 - Math.cos(a) * hl + Math.sin(a) * hw, y2 - Math.sin(a) * hl - Math.cos(a) * hw], [x2 - Math.cos(a) * hl - Math.sin(a) * hw, y2 - Math.sin(a) * hl + Math.cos(a) * hw]];
  const hg = headG ? el('g', { class: `arr-head k-${kind}` }, headG) : grp;
  el('polygon', { points: head.map((p) => p.join(',')).join(' '), class: 'fill-ink head-outline' }, hg);
  return grp;
}

// ---------- the floor ----------
function floorStrip(pen, g, x, y, w, h, lev, opts = {}) {
  const grp = el('g', { class: `floor ${tone(lev.tone)}` }, g);
  el('rect', { x, y, width: w, height: h, class: 'fill-sheet' }, grp);
  el('rect', { x, y, width: w, height: h, class: 'fill-tone floor-fill' }, grp);
  el('rect', { x, y, width: w, height: h, class: 'tone-dots' }, grp);
  pen.line(grp, x, y, x + w, y, { w: 2.8, single: true, r: 0.45, cls: 'floor-line' });
  if (opts.side) pen.line(grp, opts.side, y, opts.side, y + h, { w: 1.6, single: true, r: 0.4, cls: 'floor-line' });
  if (h >= 17) {
    const right = opts.align === 'end';
    txt(grp, right ? x + w - 10 : x + 10, y + Math.min(h - 6, 19), lev.name, 't-floor' + (h < 26 ? ' small' : ''), right ? 'end' : 'start');
  }
  return grp;
}

// Every scene is drawn on a tall stage, then cut just above the highest thing in it, so a panel
// is only as tall as its own picture (no sky borrowed from a taller neighbour).
const STAGE_H = 360;

// ---------- a whole panel ----------
// s: step; st: story; W: width; opts: {big, scale}. Returns the geometry and the cut height.
export function drawScene(svg, s, st, W, opts = {}) {
  while (svg.firstChild) svg.firstChild.remove();
  const k = opts.scale || 1;
  const H = STAGE_H;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pen = new Pen(svg, `${st.id}:${s.i}`);
  const defs = el('defs', {}, svg);
  const pat = el('pattern', { id: `dots-${st.id.replace(/\W/g, '')}-${s.i}-${opts.big ? 'b' : 'g'}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, defs);
  el('circle', { cx: 1.5, cy: 1.5, r: 0.9, class: 'dot' }, pat);
  svg.style.setProperty('--dots', `url(#${pat.id})`);
  const g = el('g', {}, svg);

  const A = s.A, B = s.B;
  const floorH = 30, yG = H - floorH;
  const split = A.level !== B.level;
  const upperIsA = A.level < B.level;
  const stageW = Math.min(W, 560);
  const x0 = (W - stageW) / 2;
  const narrow = stageW < 420;
  const pad = narrow ? 6 : 16;
  // on a narrow stage the parcel gives way first: its field names take more lines. The two get what
  // is left once the parcel has its room (and the arc a little on each side), down to a floor width;
  // a long name then wraps instead of crowding the parcel.
  let spec = objectSpec(s.data, narrow ? 100 : Math.min(176, stageW * 0.38));
  const gapNeed = spec ? Math.min(spec.w, 196) + (narrow ? 30 : 44) : (narrow ? 64 : 84);
  const charMax = Math.max(78, Math.min(196, (stageW - pad * 2 - 16 - gapNeed) / 2));
  const szA = sizeOf(A, charMax), szB = sizeOf(B, charMax);
  const levs = st.levels;

  // where the feet are
  const dl = Math.abs(A.level - B.level);
  const lift = !split ? 0 : dl > 1 ? 96 : 76;
  const gA = split && upperIsA ? yG - lift : yG;
  const gB = split && !upperIsA ? yG - lift : yG;
  const cxA = x0 + pad + szA.w / 2 + 8;
  const cxB = x0 + stageW - pad - szB.w / 2 - 8;

  // floors: the lower one runs across; the upper one is a raised platform whose side shows
  // every layer between them (a step that skips a layer passes it by)
  const lower = Math.max(A.level, B.level), upper = Math.min(A.level, B.level);
  floorStrip(pen, g, 0, yG, W, floorH, levs[lower], {});
  if (split) {
    const upCx = upperIsA ? cxA : cxB, upW = upperIsA ? szA.w : szB.w;
    const platW = upperIsA ? upCx + upW / 2 + 20 : W - (upCx - upW / 2 - 20);
    const px = upperIsA ? 0 : W - platW;
    const bands = lower - upper;
    const bh = lift / bands;
    for (let b = 0; b < bands; b++) {
      const L = upper + b;
      floorStrip(pen, g, px, yG - lift + b * bh, platW, bh, levs[L], {
        side: upperIsA ? px + platW : px, align: upperIsA ? 'start' : 'end',
      });
    }
  }

  // characters
  const sp = speakerOf(s);
  const mA = { talk: sp === 'A' && !!s.verb, reach: 'R' };
  const mB = { talk: sp === 'B' && !!s.verb, reach: 'L' };
  if (s.kind === 'signal') { mB.surprised = true; mA.ring = true; }
  if (s.alt && s.kind === 'return') { mA.sweat = true; mA.sad = !mA.talk; }
  const ga = drawCharacter(pen, g, A, cxA, gA, szA, mA);
  const gb = drawCharacter(pen, g, B, cxB, gB, szB, mB);

  // hands: where the parcel leaves and arrives
  const ax = ga.right + (A.kind === 'func' ? 16 : 8), ay = A.kind === 'func' ? ga.armY - 4 : ga.mid;
  const bx = gb.left - (B.kind === 'func' ? 18 : 10), by = B.kind === 'func' ? gb.armY - 4 : gb.mid;
  const mx = (ax + bx) / 2;

  // the parcel's field names never take more than the gap between the two
  const gap = gb.left - ga.right - 12;
  if (spec && spec.w > gap) spec = objectSpec(s.data, Math.max(70, gap));

  // where the parcel goes, and the arc it travels on
  let cy = Math.min(ay, by) - (split ? 26 : 22);
  let objAt = null;
  // a parcel hanging under the arc gets a bridge: a curve that rises near the hands and runs
  // flat over the card (lower than an arch that must clear the same corners)
  let bridge = null;
  const kx = 0.12 * (bx - ax);
  const bridgeAt = (t, d) => {
    const u = 1 - t;
    return [u * u * u * ax + 3 * u * u * t * (ax + kx) + 3 * u * t * t * (bx - kx) + t * t * t * bx,
      u * u * u * ay + 3 * u * u * t * (ay - d) + 3 * u * t * t * (by - d) + t * t * t * by];
  };
  if (spec) {
    const lo = ga.right + 12 + spec.w / 2, hi = gb.left - 12 - spec.w / 2;
    let ox = lo <= hi ? Math.max(lo, Math.min(hi, mx)) : (ga.right + gb.left) / 2;
    ox = Math.max(spec.w / 2 + 6, Math.min(W - spec.w / 2 - 6, ox));
    if (!split) {
      // On one floor the parcel hangs under the arc, so the whole line and its head stay in view:
      // its card between the two hands (clear of the arrowhead), its field names between the bodies.
      const cardLo = ax + 6 + spec.cardW / 2, cardHi = bx - 16 - spec.cardW / 2;
      const yAt = (x, c) => {
        const t = Math.max(0, Math.min(1, (x - ax) / (bx - ax || 1)));
        return (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * c + t * t * by;
      };
      // the bridge it would need over the card there (null when it would have to be tall)
      const tryBridge = () => {
        if (!(cardLo <= cardHi && lo <= hi + 4)) return null;
        const x = Math.max(cardLo, Math.min(cardHi, mx));
        let top = Math.min(ay, by) - spec.cardH / 2 + 2;
        top = Math.min(top, yG - 8 - spec.h);
        const cx1 = x - spec.cardW / 2 - 6, cx2 = x + spec.cardW / 2 + 6;
        for (let d = 16; d <= 40; d += 3) {
          let clear = true;
          for (let q = 0; q <= 40 && clear; q++) {
            const [px, py] = bridgeAt(q / 40, d);
            if (px >= cx1 && px <= cx2 && py > top - 7) clear = false;
          }
          if (clear) return { x, top, d };
        }
        return null;
      };
      const br = tryBridge();
      if (br) {
        ox = br.x;
        objAt = { ox, oy: br.top + spec.h / 2 };
        bridge = { d: br.d };
      } else {
        // no room between the hands for a low bridge: the arc stays low and the parcel goes over
        // it, like a label over an arrow, above the heads when it is wider than the gap
        ox = Math.max(spec.w / 2 + 6, Math.min(W - spec.w / 2 - 6, (ga.right + gb.left) / 2));
        const apex = yAt(ox, cy);
        let top = apex - 8 - spec.h;
        const over = (g0) => ox - spec.w / 2 < g0.right + 2 && ox + spec.w / 2 > g0.left - 2;
        const heads = [ga, gb].filter((g0) => g0.box.kind === 'func' && Math.abs(g0.headX - ox) < spec.w / 2 + 16);
        if (heads.length || over(ga) || over(gb)) top = Math.min(top, Math.min(...[ga, gb].map((g0) => g0.headTop)) - 8 - spec.h);
        objAt = { ox, oy: top + spec.h / 2 };
      }
    } else {
      // across floors it rides the middle of the toss, its card clear of the arrowhead: when the
      // hands are close it moves back toward the sender, over the sender's head if need be
      const qx = 0.25 * ax + 0.5 * mx + 0.25 * bx;
      const cardLo = ax + 4 + spec.cardW / 2, cardHi = bx - 24 - spec.cardW / 2;
      let oy;
      const low = upperIsA ? gb : ga;
      // the one on the lower floor speaks when it is the sender of a step with words
      const lowSpeaks = !!s.verb && (speakerOf(s) === 'A' ? ga : gb) === low;
      if (cardLo <= cardHi || lowSpeaks) {
        ox = cardLo <= cardHi ? Math.max(cardLo, Math.min(cardHi, lo <= hi ? ox : qx)) : qx;
        // its height: where the arc is at that x
        const t = Math.max(0, Math.min(1, (ox - ax) / (bx - ax || 1)));
        oy = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by - spec.cardH / 2 + spec.h / 2;
        const pbox = () => ({ x: ox - spec.w / 2, y: oy - spec.h / 2, w: spec.w, h: spec.h });
        for (const g0 of [ga, gb]) {
          const fig = { x: g0.left - 12, y: g0.top - 4, w: g0.w + 24, h: g0.ground - g0.top + 4 };
          if (overlap(pbox(), fig)) oy = Math.min(oy, g0.top - 10 - spec.h / 2);
        }
      } else {
        // no room between the hands: it waits over the one on the lower floor, where there is sky
        // (unless that one is talking: then it stays on the arc)
        ox = Math.max(spec.w / 2 + 6, Math.min(W - spec.w / 2 - 6, low.cx));
        oy = low.top - 10 - spec.h / 2;
      }
      oy = Math.max(spec.h / 2 + 6, Math.min(yG - spec.h / 2 - 8, oy));
      objAt = { ox, oy };
    }
  }
  const curve = bridge ? (t) => bridgeAt(t, bridge.d)
    : (t) => [(1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by];
  const pts = [];
  for (let n = 0; n <= 20; n++) pts.push(curve(n / 20));
  if (bridge) cy = Math.min(...pts.map((p) => p[1]));

  // a dashed wall where the execution context changes
  const roomA = A.region, roomB = B.region;
  // (only where the map frames both sides differently, or where a notification wakes a framed context;
  // a box the map leaves unframed may run in more than one context)
  const wall = roomA !== roomB && ((roomA && roomB) || (s.kind === 'signal' && roomB));
  if (wall) {
    pen.line(g, mx, Math.min(ga.top, gb.top, cy + 10) - 6, mx, yG - 1, { w: 1.8, single: true, dash: [6, 5], cls: 'ink wall-line' });
  }
  const heads = el('g', { class: 'heads' });
  arrow(pen, g, pts, s.kind, heads);

  // the parcel
  let objBox = null;
  if (spec) objBox = drawObject(pen, g, spec, objAt.ox, objAt.oy, false);
  g.appendChild(heads);

  // what the step does to a structure: a tag on it, or a small prop when it is not on stage
  const props = [];
  for (const op of s.ops || []) {
    const onStage = op.node === A.node ? ga : op.node === B.node ? gb : null;
    if (onStage) {
      const tw = measure(onStage.box.title, F.tab) + 18;
      const ow = measure(op.kind, F.small) + 14;
      const want = onStage.left + 8 + Math.min(onStage.w - 8, tw) + 6;
      if (want + ow <= W - 6) opTag(g, want, onStage.top + 10, op.kind, 'start');
      else opTag(g, onStage.right - 2, onStage.top - 4, op.kind, 'end');
    } else {
      const n = NODES[op.node];
      if (!n) continue;
      // a small queue above the one who works on it, the item leaving it
      const who = ga;
      const w = 104, hh = 22, px = Math.max(6, who.cx - w / 2 - 24), py = who.headTop - hh - 30;
      const pg = el('g', { class: `prop ${tone(n.layer)}` }, g);
      el('path', { d: rr(px, py, w, hh, 11), class: 'fill-sheet' }, pg);
      el('path', { d: rr(px, py, w, hh, 11), class: 'fill-tone soft' }, pg);
      pen.path(pg, rr(px, py, w, hh, 11), { w: 1.4, single: true, cls: 'ink' });
      for (let q = 0; q < 3; q++) envelope(pen, pg, px + 12 + q * 22, py + 6, 14, 10);
      const tw = measure(n.title, F.tab);
      // its name to its right, unless that would cover the parcel; then above it
      const right = { x: px + w + 4, y: py, w: tw + 4, h: hh };
      const tx = px + w + 6 + tw <= W - 4 && !(objBox && overlap(right, objBox)) ? px + w + 6 : null;
      if (tx !== null) txt(pg, tx, py + 15, n.title, 't-tab', 'start');
      else txt(pg, px + w / 2, py - 6, n.title, 't-tab', 'middle');
      pen.lines(pg, [[px + 18, py + hh + 2], [who.headX - 10, who.headTop - 6]], { w: 1.6, single: true, dash: [4, 4], cls: 'ink' });
      opTag(g, px + w / 2 + 30, py + hh + 16, op.kind, 'middle');
      props.push({ x: px, y: py - (tx === null ? 20 : 0), w: tx === null ? w : w + 6 + tw, h: hh + 26 });
    }
  }

  // the speech
  if (s.verb) {
    const who = sp === 'A' ? ga : gb;
    const nonFace = who.box.kind !== 'func';
    // things without a face do not talk: what comes from them is a sound
    const style = s.kind === 'signal' || nonFace ? 'shout' : s.kind === 'syscall' ? 'call' : 'talk';
    const bs = bubbleSize(s.verb);
    const extra = style === 'shout' ? 22 : 0;
    const clampX = (x) => Math.max(bs.w / 2 + 8 + extra, Math.min(W - bs.w / 2 - 8 - extra, x));
    const y0 = who.headTop - bs.h - (style === 'shout' ? 30 : 13);
    const other = who === ga ? gb : ga;
    // what the words must not cover: the parcel, the props, the other one
    const avoid = [objBox, ...props, { x: other.left - 10, y: other.top - 2, w: other.w + 20, h: other.ground - other.top + 2 }].filter(Boolean);
    const boxAt = (x, y) => ({ x: x - bs.w / 2 - extra, y: y - extra, w: bs.w + extra * 2, h: bs.h + extra * 2 });
    const free = (x, y) => avoid.every((ob) => !overlap(boxAt(x, y), ob));
    // above the head, leaning toward the other one; else leaning away; else straight up; else higher
    const lean = sp === 'A' ? 18 : -18;
    const tries = [[who.cx + lean, y0], [who.cx - lean, y0], [who.cx - lean * 3, y0], [who.cx, y0]];
    let bxc = clampX(tries[0][0]), byy = y0;
    const hit = tries.map(([x, y]) => [clampX(x), y]).find(([x, y]) => free(x, y));
    if (hit) [bxc, byy] = hit;
    else {
      // over everything it would cover
      byy = Math.min(y0, ...avoid.filter((ob) => overlap(boxAt(bxc, y0), ob)).map((ob) => ob.y - bs.h - 12 - extra));
    }
    const tail = [who.headX + (bxc > who.headX ? 5 : -5), who.headTop - 3];
    drawBubble(pen, g, s.verb, bxc, byy, tail, style);
  }
  if (s.kind === 'signal') txt(g, gb.headX + (B.kind === 'func' ? 19 : 0), gb.headTop + 2, '!', 't-bang', 'middle');

  // cut the sky: start a little above the highest drawing
  const box = g.getBBox();
  const top = Math.max(0, Math.floor(box.y - (opts.big ? 14 : 10)));
  const h = H - top;
  svg.setAttribute('viewBox', `0 ${top} ${W} ${h}`);
  svg.setAttribute('width', Math.round(W * k));
  svg.setAttribute('height', Math.round(h * k));
  return { ga, gb, objBox, from: curve(0.06), mid: objAt ? [objAt.ox, objAt.oy] : curve(0.5), height: h * k, top };
}

function opTag(g, x, y, label, anchor) {
  const w = measure(label, F.small) + 14;
  const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  const grp = el('g', { class: 'optag' }, g);
  el('rect', { x: left, y: y - 9, width: w, height: 18, rx: 9, class: 'fill-ink' }, grp);
  txt(grp, left + w / 2, y + 4, label, 't-op', 'middle');
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// A small standing character for the cast and the reader's notes.
export function castFigure(box, maxW = 150) {
  const sz = sizeOf(box, maxW);
  if (sz.kind === 'func') { sz.head = 11; sz.h = 23 + sz.bodyH + 8; }
  const W = sz.w + (sz.kind === 'func' ? 24 : 6), H = sz.h + 6;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'fig' });
  const pen = new Pen(svg, 'cast:' + box.node + box.id);
  drawCharacter(pen, svg, box, W / 2, H - 2, sz, {});
  return svg;
}

// Small drawings for the legend, made with the same pens as the panels.
export function legendIcon(kind) {
  const W = 132, H = 52;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'lg-icon', 'aria-hidden': 'true' });
  const pen = new Pen(svg, 'legend:' + kind);
  const g = el('g', {}, svg);
  const mid = H / 2;
  if (kind === 'talk' || kind === 'shout' || kind === 'call') {
    const word = { talk: '並べる', shout: '起こす', call: 'OS_CALL' }[kind];
    drawBubble(pen, g, word, W / 2, kind === 'shout' ? 11 : 6, [W / 2 - 8, H - 4], kind);
  } else if (['letter', 'doc', 'tag', 'token', 'str', 'words'].includes(kind)) {
    const data = {
      letter: { label: 'Request', schema: 'schema.request' }, doc: { label: 'ProcStats', schema: 'schema.procstats' },
      tag: { label: '&Request' }, token: { label: 'i32' },
      str: { label: 's0, s1', type: '文字' }, words: { label: '24 語', type: 'i32 words[24]' },
    }[kind];
    const spec = objectSpec(data, 120);
    drawObject(pen, g, spec, W / 2, mid, false);
  } else if (kind.startsWith('arrow-')) {
    const k = kind.slice(6);
    arrow(pen, g, [[10, mid], [W - 10, mid]], k);
  } else if (kind === 'wall') {
    pen.line(g, W / 2, 4, W / 2, H - 4, { w: 1.8, single: true, dash: [6, 5], cls: 'ink wall-line' });
    txt(g, W / 2 - 8, mid + 4, 'ユーザ', 't-place', 'end');
    txt(g, W / 2 + 8, mid + 4, 'OS_CALL', 't-place', 'start');
  } else if (kind === 'floor') {
    const levs = [{ id: 'lib', name: 'ライブラリ', tone: 'lib' }, { id: 'kernel', name: 'カーネル', tone: 'kernel' }];
    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'dots-legend', width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, defs);
    el('circle', { cx: 1.5, cy: 1.5, r: 0.9, class: 'dot' }, pat);
    svg.style.setProperty('--dots', 'url(#dots-legend)');
    floorStrip(pen, g, 0, H - 20, W, 20, levs[1], {});
    floorStrip(pen, g, 0, 6, 70, H - 26, levs[0], { side: 70 });
  }
  return svg;
}

export { nodeName, arrow };
