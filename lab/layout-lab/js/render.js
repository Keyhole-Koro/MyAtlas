// One way of drawing for every engine, so the pictures differ only by placement.
import { basisPath, f1 } from './geom.js';
import { isCode, textW } from './measure.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TONES = ['app', 'lib', 'os', 'kernel', 'emu'];
const tone = (t) => (TONES.includes(t) ? t : 'os');

// Arrow heads and end marks, shared by every svg on the page.
export const MARKERS_SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<marker id="mk-h" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path class="mk-fill" d="M1,1.5L11,6L1,10.5z"/></marker>
<marker id="mk-h-sel" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="mk-sel" d="M1,1.5L11,6L1,10.5z"/></marker>
<marker id="mk-o" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path class="mk-open" d="M1.5,1.5L10.5,6L1.5,10.5"/></marker>
<marker id="mk-o-sel" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto"><path class="mk-open-sel" d="M1.5,1.5L10.5,6L1.5,10.5"/></marker>
<marker id="mk-dot" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse"><circle class="mk-fill" cx="6" cy="6" r="4"/></marker>
<marker id="mk-dot-sel" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse"><circle class="mk-sel" cx="6" cy="6" r="4"/></marker>
<marker id="mk-gate" viewBox="0 0 14 14" refX="7" refY="7" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse"><rect class="mk-gate" x="1.5" y="1.5" width="11" height="11" rx="2"/></marker>
<marker id="mk-gate-sel" viewBox="0 0 14 14" refX="7" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse"><rect class="mk-gate-sel" x="1.5" y="1.5" width="11" height="11" rx="2"/></marker>
</defs></svg>`;

const pathD = (e) => (e.curve ? basisPath(e.pts) : 'M' + e.pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L'));

// opts: { mode: 'full' | 'thumb', sel: step index or null, defects: metrics.defects or null, scale: screen px per unit }
export function renderSvg(D, G, opts = {}) {
  const mode = opts.mode || 'full', thumb = mode === 'thumb', sel = opts.sel ?? null, k = 1 / (opts.scale || 1);
  const selStep = sel != null ? D.steps[sel] : null;
  const ends = selStep ? new Set([selStep.from, selStep.to]) : null;
  let s = '';
  // bands
  if (G.bands) {
    G.bands.forEach((b, i) => {
      s += `<rect class="band t-${tone(b.tone)} sh-${i % 2}" x="0" y="${f1(b.y0)}" width="${f1(G.width)}" height="${f1(b.y1 - b.y0)}"/>`;
      s += `<rect class="bar s-${tone(b.tone)}" x="0" y="${f1(b.y0)}" width="4" height="${f1(b.y1 - b.y0)}"/>`;
      if (i > 0) s += `<line class="band-line" x1="0" x2="${f1(G.width)}" y1="${f1(b.y0)}" y2="${f1(b.y0)}"/>`;
      if (!thumb && G.labelCol) {
        // the band's subtitle wraps rather than run into the line that closes the name column
        const subs = wrapText(b.sub || '', 12, G.labelCol - 26), cy = (b.y0 + b.y1) / 2 - (subs.length - 1) * 7.5;
        s += `<text class="band-name" x="14" y="${f1(cy - 3)}">${esc(b.name)}</text>`;
        subs.forEach((t, k) => { s += `<text class="band-sub" x="14" y="${f1(cy + 15 + k * 15)}">${esc(t)}</text>`; });
        if (b.empty) s += `<text class="band-empty" x="${G.labelCol + 16}" y="${f1((b.y0 + b.y1) / 2 + 4)}">この流れは通らない</text>`;
      }
    });
    if (G.labelCol) s += `<line class="band-line" x1="${G.labelCol}" x2="${G.labelCol}" y1="0" y2="${f1(G.height)}"/>`;
  }
  // sequence furniture
  if (G.kind === 'seq') {
    for (const l of G.lifelines) s += `<line class="lifeline${ends && ends.has(l.id) ? ' on' : ''}" x1="${f1(l.x)}" x2="${f1(l.x)}" y1="${f1(l.y0)}" y2="${f1(l.y1)}"/>`;
    for (const b of G.brackets) {
      s += `<path class="bracket" d="M${f1(b.x0 + 2)},${f1(b.y + 6)}V${f1(b.y)}H${f1(b.x1 - 2)}V${f1(b.y + 6)}"/>`;
      if (!thumb) s += `<text class="bracket-label" x="${f1((b.x0 + b.x1) / 2)}" y="${f1(b.y - 7)}" text-anchor="middle">${esc(b.label)}</text>`;
    }
    for (const fr of G.frames) {
      s += `<rect class="alt-frame" x="${f1(fr.x0)}" y="${f1(fr.y0)}" width="${f1(fr.x1 - fr.x0)}" height="${f1(fr.y1 - fr.y0)}" rx="6"/>`;
      if (!thumb) s += `<text class="alt-label" x="${f1(fr.x0 + 8)}" y="${f1(fr.y0 + 15)}">${esc(fr.label)}</text>`;
    }
  }
  // execution contexts: a frame, or the frames of each rank joined by an open neck (outline only, nothing filled)
  for (const r of G.regions || []) {
    s += `<g class="region">`;
    if (r.blobs) {
      for (const loops of r.blobs) s += `<path d="${roundedOutline(loops, 9)}"/>`;
      for (const n of r.necks || []) s += `<path class="neck" d="M${f1(n[0])},${f1(n[1])}V${f1(n[3])}M${f1(n[2])},${f1(n[1])}V${f1(n[3])}"/>`;
    } else if (r.outline) s += `<path d="${roundedOutline(r.outline, 9)}"/>`;
    else s += `<rect x="${f1(r.x0)}" y="${f1(r.y0)}" width="${f1(r.x1 - r.x0)}" height="${f1(r.y1 - r.y0)}" rx="10"/>`;
    if (!thumb) for (const n of r.names || [{ text: r.label, tx: r.tx, ty: r.ty, anchor: r.anchor }]) s += `<text x="${f1(n.tx)}" y="${f1(n.ty)}" text-anchor="${n.anchor}">${esc(n.text)}</text>`;
    s += `</g>`;
  }
  // the back card of a store goes under the lines, so a line that ends on the store's top edge stays whole
  for (const b of D.boxes) {
    const g = G.boxes[b.id];
    if (!g || b.kind !== 'store' || G.boxStyle === 'head') continue;
    s += `<rect class="back${ends && !ends.has(b.id) ? ' dim' : ''}" x="${f1(g.x + 4)}" y="${f1(g.y - 4)}" width="${f1(g.w)}" height="${f1(g.h)}" rx="8"/>`;
  }
  // lines
  for (const e of G.edges) {
    const st = D.steps[e.i], on = sel === e.i, dim = sel != null && !on;
    const end = (st.kind === 'return' ? 'mk-o' : 'mk-h') + (on ? '-sel' : '');
    const start = st.kind === 'data' ? ` marker-start="url(#mk-dot${on ? '-sel' : ''})"` : st.kind === 'syscall' ? ` marker-start="url(#mk-gate${on ? '-sel' : ''})"` : '';
    s += `<g class="edge k-${st.kind}${st.alt ? ' alt' : ''}${on ? ' on' : ''}${dim ? ' dim' : ''}" data-step="${e.i}"><path class="hit" d="${pathD(e)}"/><path class="line" d="${pathD(e)}"${start} marker-end="url(#${end})"/></g>`;
  }
  // boxes
  for (const b of D.boxes) {
    const g = G.boxes[b.id];
    if (!g) continue;
    const t = tone((D.bands.find((x) => x.id === b.band) || {}).tone);
    const cls = `box k-${b.kind} t-${t}${ends && ends.has(b.id) ? ' on' : ''}${ends && !ends.has(b.id) ? ' dim' : ''}`;
    s += `<g class="${cls}" data-box="${esc(b.id)}">`;
    s += `<rect class="body" x="${f1(g.x)}" y="${f1(g.y)}" width="${f1(g.w)}" height="${f1(g.h)}" rx="${b.kind === 'hw' ? 3 : 8}"/>`;
    s += `<rect class="stripe s-${t}" x="${f1(g.x + 4)}" y="${f1(g.y + 7)}" width="3.5" height="${f1(g.h - 14)}" rx="1.75"/>`;
    if (!thumb) s += boxText(D, b, g, G.boxStyle);
    s += `</g>`;
  }
  // step labels; a label lifted off its arrow hangs from it by a short tick
  const nums = thumb ? spreadNums(G.labels, 7.6 * k) : null;
  for (const l of G.labels) {
    const st = D.steps[l.i], on = sel === l.i, dim = sel != null && !on;
    s += `<g class="pill${st.alt ? ' alt' : ''}${on ? ' on' : ''}${dim ? ' dim' : ''}" data-step="${l.i}">`;
    if (l.leader) s += `<path class="leader" d="M${f1(l.leader[0][0])},${f1(l.leader[0][1])}L${f1(l.leader[1][0])},${f1(l.leader[1][1])}"/>`;
    if (thumb) {
      s += `<rect class="pbg" x="${f1(l.x)}" y="${f1(l.y)}" width="${f1(l.w)}" height="${f1(l.h)}" rx="${f1(l.h / 2)}"/>`;
      const r = 7.6 * k, [cx, cy] = nums.get(l.i);
      s += `<circle class="tnum" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"/><text class="tnum-t" x="${f1(cx)}" y="${f1(cy + 3.9 * k)}" text-anchor="middle" style="font-size:${f1(11 * k)}px">${esc(st.alt ? st.no.replace('もし', '') : st.no)}</text>`;
    } else s += `<title>${esc(fullLabel(st))}</title>` + pillBody(st, l);
    s += `</g>`;
  }
  // problems
  if (opts.defects) s += thumb ? defectDots(G, opts.defects, k) : defectsSvg(G, opts.defects, k, D);
  return `<svg class="dg${thumb ? ' thumb' : ''}" viewBox="0 0 ${f1(G.width)} ${f1(G.height)}" width="${f1(G.width * (opts.scale || 1))}" height="${f1(G.height * (opts.scale || 1))}" role="img" aria-label="${esc(D.title)}">${s}</svg>`;
}

// A closed orthogonal outline with its corners rounded.
function roundedOutline(loops, rad) {
  let d = '';
  for (const pts of loops) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
      const r = Math.min(rad, Math.hypot(c[0] - p[0], c[1] - p[1]) / 2, Math.hypot(q[0] - c[0], q[1] - c[1]) / 2);
      const a = [c[0] + Math.sign(p[0] - c[0]) * r, c[1] + Math.sign(p[1] - c[1]) * r];
      const b = [c[0] + Math.sign(q[0] - c[0]) * r, c[1] + Math.sign(q[1] - c[1]) * r];
      d += `${i === 0 ? 'M' : 'L'}${f1(a[0])},${f1(a[1])}Q${f1(c[0])},${f1(c[1])} ${f1(b[0])},${f1(b[1])}`;
    }
    d += 'Z';
  }
  return d;
}

function boxText(D, b, g, style) {
  const x = g.x + 14;
  if (style === 'head') {
    const t = b.short || b.title, band = D.bands.find((z) => z.id === b.band);
    return `<text class="title${isCode(t) ? ' code' : ''} head" x="${f1(g.x + g.w / 2)}" y="${f1(g.y + 21)}" text-anchor="middle">${esc(t)}</text>`
      + `<text class="sub" x="${f1(g.x + g.w / 2)}" y="${f1(g.y + 38)}" text-anchor="middle">${esc(band ? band.name : '')}</text>`;
  }
  let s = `<text class="title${isCode(b.title) ? ' code' : ''}" x="${f1(x)}" y="${f1(g.y + 22)}">${esc(b.title)}</text>`;
  if (b.slots) {
    const n = b.slots.length, sw = (g.w - 24 - (n - 1) * 4) / n;
    b.slots.forEach((t, k) => {
      const sx = x + k * (sw + 4);
      s += `<rect class="slot" x="${f1(sx)}" y="${f1(g.y + 33)}" width="${f1(sw)}" height="22" rx="3"/><text class="slot-t" x="${f1(sx + sw / 2)}" y="${f1(g.y + 48.5)}" text-anchor="middle">${esc(t)}</text>`;
    });
  } else if (b.bits) {
    const total = b.bits.reduce((a, q) => a + q[1], 0);
    let cx = x;
    b.bits.forEach(([t, n], k) => {
      const w = (g.w - 24) * n / total;
      s += `<rect class="slot${k === 0 ? ' hi' : ''}" x="${f1(cx)}" y="${f1(g.y + 33)}" width="${f1(w)}" height="22" rx="2"/><text class="slot-t" x="${f1(cx + w / 2)}" y="${f1(g.y + 48.5)}" text-anchor="middle">${esc(t)}</text>`;
      cx += w;
    });
  } else {
    if (b.ns && b.sub) {
      s += `<text class="ns" x="${f1(x)}" y="${f1(g.y + 39)}">${esc(b.ns)}</text><text class="sub" x="${f1(x)}" y="${f1(g.y + 56)}">${esc(b.sub)}</text>`;
    } else if (b.ns || b.sub) {
      s += `<text class="${b.ns ? 'ns' : 'sub'}" x="${f1(x)}" y="${f1(g.y + 44)}">${esc(b.ns || b.sub)}</text>`;
    }
  }
  return s;
}

const fullLabel = (st) => `${st.no}. ${[st.pill.verb, st.pill.chip].filter(Boolean).join('・') || st.label || ''}`;

// Splits a line of text where it would pass maxW: after a "・" or a space when there is one (the most even such
// break, so a number keeps its counter: 「1 本」), else between characters.
export function wrapText(t, px, maxW) {
  const out = [];
  let rest = String(t);
  while (rest && textW(rest, px) > maxW && out.length < 2) {
    let cut = 0;
    for (let n = 1; n < rest.length; n++) if (textW(rest.slice(0, n), px) <= maxW) cut = n;
    if (!cut) break;
    let at = cut, even = Infinity;
    for (let n = 1; n <= cut; n++) {
      if (rest[n - 1] !== '・' && rest[n - 1] !== ' ') continue;
      const a = rest.slice(0, n).trim(), b = rest.slice(n).trim();
      if (a.length < 2) continue;
      const d = Math.abs(textW(a, px) - Math.min(maxW, textW(b, px)));
      if (d < even) { even = d; at = n; }
    }
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// In a small picture the number discs keep their screen size, so neighbours are pushed apart until they stop covering
// each other (they stay within a disc's width of their label).
function spreadNums(labels, r) {
  const pts = labels.map((l) => ({ i: l.i, x0: l.x + Math.max(r, l.h / 2), y0: l.y + l.h / 2 }));
  for (const p of pts) { p.x = p.x0; p.y = p.y0; }
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
      const P = pts[a], Q = pts[b];
      let dx = Q.x - P.x, dy = Q.y - P.y, d = Math.hypot(dx, dy);
      const need = 2 * r + 0.6 * r / 7.6;
      if (d >= need) continue;
      if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
      const push = (need - d) / 2 + 0.01;
      P.x -= (dx / d) * push; P.y -= (dy / d) * push; Q.x += (dx / d) * push; Q.y += (dy / d) * push;
      moved = true;
    }
    for (const p of pts) {
      const ox = p.x - p.x0, oy = p.y - p.y0, o = Math.hypot(ox, oy), lim = 2.2 * r;
      if (o > lim) { p.x = p.x0 + (ox / o) * lim; p.y = p.y0 + (oy / o) * lim; }
    }
    if (!moved) break;
  }
  return new Map(pts.map((p) => [p.i, [p.x, p.y]]));
}

export function pillBody(st, l) {
  const p = st.pill, y = l.y + l.h / 2, pick = l.pick || [true, true];
  let s = `<rect class="pbg" x="${f1(l.x)}" y="${f1(l.y)}" width="${f1(l.w)}" height="${f1(l.h)}" rx="${f1(l.h / 2)}"/>`;
  s += `<rect class="num" x="${f1(l.x + 3)}" y="${f1(y - 9)}" width="${f1(p.nw)}" height="18" rx="9"/><text class="num-t" x="${f1(l.x + 3 + p.nw / 2)}" y="${f1(y + 4.2)}" text-anchor="middle">${esc(p.num)}</text>`;
  let cx = l.x + 3 + p.nw + 6;
  if (p.verb && pick[0]) { s += `<text class="verb" x="${f1(cx)}" y="${f1(y + 4.2)}">${esc(p.verb)}</text>`; cx += p.vw + 6; }
  if (p.chip && pick[1]) {
    s += `<g class="chip"><rect x="${f1(cx)}" y="${f1(y - 9)}" width="${f1(p.cw)}" height="18" rx="4"/>`
      + `<path d="M${f1(cx + 5)},${f1(y - 4.5)}h10v9h-10z M${f1(cx + 5)},${f1(y - 1.5)}h10 M${f1(cx + 9)},${f1(y - 1.5)}v6"/>`
      + `<text x="${f1(cx + 20)}" y="${f1(y + 4.2)}">${esc(p.chip)}</text></g>`;
  }
  return s;
}

// In a thumbnail a problem is a red ring (lines crossing) or a red dot (something on top of something).
function defectDots(G, d, k) {
  let s = '<g class="defects">';
  const dot = (x, y) => `<circle class="df-dot" cx="${f1(x)}" cy="${f1(y)}" r="${f1(4 * k)}"/>`;
  for (const c of d.crossings) s += `<circle class="df-x" cx="${f1(c.p[0])}" cy="${f1(c.p[1])}" r="${f1(6 * k)}" style="stroke-width:${f1(1.8 * k)}"/>`;
  for (const r of d.runs) s += dot((r.seg[0][0] + r.seg[1][0]) / 2, (r.seg[0][1] + r.seg[1][1]) / 2);
  for (const o of d.overlaps) {
    const a = o.r, b = o.r2 || (o.box ? null : null);
    const q = b ? [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])] : a;
    s += dot((q[0] + q[2]) / 2, (q[1] + q[3]) / 2);
  }
  for (const t of d.through) { const b = G.boxes[t.box]; s += dot(b.x + b.w / 2, b.y + b.h / 2); }
  for (const f of d.frames) if (f.r) s += dot((f.r[0] + f.r[2]) / 2, (f.r[1] + f.r[3]) / 2);
  for (const a of d.detached) s += dot((a.r[0] + a.r[2]) / 2, (a.r[1] + a.r[3]) / 2);
  for (const j of d.jogs) s += dot(j.p[0], j.p[1]);
  for (const t of d.detour) { const e = G.edges.find((x) => x.i === t.i); if (e) s += `<path class="df-line" d="${pathD(e)}" style="stroke-width:${f1(2 * k)};vector-effect:none"/>`; }
  return s + '</g>';
}

function defectsSvg(G, d, k, D) {
  let s = '<g class="defects">';
  for (const c of d.crossings) s += `<circle class="df-x" cx="${f1(c.p[0])}" cy="${f1(c.p[1])}" r="${f1(7 * k)}" style="stroke-width:${f1(2.2 * k)}"/>`;
  for (const r of d.runs) s += `<path class="df-run" d="M${f1(r.seg[0][0])},${f1(r.seg[0][1])}L${f1(r.seg[1][0])},${f1(r.seg[1][1])}" style="stroke-width:${f1(6 * k)}"/>`;
  const seen = new Set();
  for (const t of d.through) {
    const e = G.edges.find((x) => x.i === t.i), b = G.boxes[t.box];
    if (!seen.has(t.box)) { seen.add(t.box); s += `<rect class="df-box" x="${f1(b.x - 3)}" y="${f1(b.y - 3)}" width="${f1(b.w + 6)}" height="${f1(b.h + 6)}" rx="10" style="stroke-width:${f1(2 * k)}"/>`; }
    if (e) s += `<path class="df-line" d="${pathD(e)}" style="stroke-width:${f1(2.4 * k)}"/>`;
  }
  const ls = new Set();
  for (const o of d.overlaps) {
    for (const r of [o.r, o.r2].filter(Boolean)) {
      const key = r.join(',');
      if (ls.has(key)) continue;
      ls.add(key);
      s += `<rect class="df-label" x="${f1(r[0] - 2)}" y="${f1(r[1] - 2)}" width="${f1(r[2] - r[0] + 4)}" height="${f1(r[3] - r[1] + 4)}" rx="13" style="stroke-width:${f1(2 * k)}"/>`;
    }
  }
  for (const f of d.frames) {
    if (f.box) { const b = G.boxes[f.box]; s += `<rect class="df-frame" x="${f1(b.x - 5)}" y="${f1(b.y - 5)}" width="${f1(b.w + 10)}" height="${f1(b.h + 10)}" rx="11" style="stroke-width:${f1(2 * k)}"/>`; }
    else if (f.r) s += `<rect class="df-frame" x="${f1(f.r[0] - 3)}" y="${f1(f.r[1] - 3)}" width="${f1(f.r[2] - f.r[0] + 6)}" height="${f1(f.r[3] - f.r[1] + 6)}" rx="12" style="stroke-width:${f1(2 * k)}"/>`;
  }
  // a label far from its line, or nearer another: a dashed ring, and a thin red tie to the line it belongs to
  for (const a of d.detached) {
    const r = a.r;
    s += `<rect class="df-detached" x="${f1(r[0] - 3)}" y="${f1(r[1] - 3)}" width="${f1(r[2] - r[0] + 6)}" height="${f1(r[3] - r[1] + 6)}" rx="14" style="stroke-width:${f1(1.8 * k)}"/>`;
  }
  for (const j of d.jogs) s += `<circle class="df-x" cx="${f1(j.p[0])}" cy="${f1(j.p[1])}" r="${f1(9 * k)}" style="stroke-width:${f1(2 * k)}"/>`;
  for (const t of d.detour) {
    const e = G.edges.find((x) => x.i === t.i);
    if (e) s += `<path class="df-detour" d="${pathD(e)}" style="stroke-width:${f1(7 * k)}"/>`;
  }
  return s + '</g>';
}
