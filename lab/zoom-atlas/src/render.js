// Canvas renderer. Geometry lives in world units; text is drawn in screen pixels so it stays crisp,
// and any text that would be smaller than 11px is drawn as a grey bar instead (greeking).
import { T, roleColor, layerColor, tint, alpha, mix } from './theme.js';
import { F, fontStr, textW, wrapName, wrapRich, fit, isCodeName, shortName, balanced } from './text.js';
import { NODES, LAYER, STACK, KIND_NAME, PAPERS, CONTEXT_OF, runOf, TRACE_COUNT, splitPath, LAYER_SHORT_SUB, FLOW_RANK, stepOrder } from './model.js';
import { bezier, bezierTangent, ST, BAND } from './layout.js';
import { EVENTS, NODE_EVENTS, threadColor } from './trace.js';

export const LOD = { far: 0.2, doc: 0.92, fade: 0.1 };
const MIN_PX = 11;

let ctx, V, S, lastFont = '';
const figImages = {};

function font(f, px) { const s = fontStr(f, px); if (s !== lastFont) { ctx.font = s; lastFont = s; } }
const X = (x) => (x - V.x) * V.k;
const Y = (y) => (y - V.y) * V.k;

function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const visible = (x, y, w, h, m = 0) => x + w >= -m && y + h >= -m && x <= V.W + m && y <= V.H + m;
const smooth = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

// ---- Labels that must never collide ----
class Labels {
  constructor(chrome = []) { this.placed = chrome.slice(); this.queue = []; }
  free(r, pad = 3) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > V.W || r.y + r.h > V.H) return false;
    for (const p of this.placed) if (r.x < p.x + p.w + pad && r.x + r.w + pad > p.x && r.y < p.y + p.h + pad && r.y + r.h + pad > p.y) return false;
    return true;
  }
  block(r) { this.placed.push(r); }
  add(r, draw) { if (!this.free(r)) return false; this.placed.push(r); this.queue.push(draw); return true; }
  drawAll() { for (const d of this.queue) d(); }
}

export function setFigureImages(make) { for (const k of Object.keys(figImages)) delete figImages[k]; make(figImages); }

// ===================================================================================
export function render(context, view, state) {
  ctx = context; V = view; S = state; lastFont = '';
  const { world } = S;
  ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  ctx.fillStyle = T.sea;
  ctx.fillRect(0, 0, V.W, V.H);
  const labels = new Labels(S.chrome || []);
  S.hits = { badges: [], labels: [] };
  S.frame = (S.frame || 0) + 1;

  S._groupLabels = []; S._late = []; S._bandLater = [];
  drawBands(world, labels);
  drawIsland(world, labels);
  for (const g of world.groups) drawGroup(g, labels);
  if (S.overlays.trace) drawTraceHeat(world);
  const cardsOnScreen = [];
  for (const id in world.cards) {
    const c = world.cards[id];
    const sx = X(c.x), sy = Y(c.y), sw = c.w * V.k, sh = c.h * V.k;
    if (!visible(sx, sy, sw, sh, 40)) continue;
    cardsOnScreen.push(c);
    drawCard(c, sx, sy, sw, sh, labels);
  }
  S.cardsOnScreen = cardsOnScreen;
  if (S.overlays.context) drawContexts(world, labels);
  if (S.overlays.policy) drawPolicy(world, labels);
  drawContractLines(world);
  const routeOn = S.route && !S.route.hidden;
  if (routeOn) drawRoute(S.route, labels);          // the route's lines
  S.pinned = new Set();
  if (routeOn) {
    placeBadges(S.route, labels, true);              // the current step's number and verb,
    placeVerbs(labels, true);
    drawFarLabels(world, labels, 'cur');             // the names of its two stops,
    placeBadges(S.route, labels, false);             // then the other numbers
  }
  if (S.trace) drawTrace(world, labels);
  else if (S.overlays.trace) traceCounts(world, labels, TRACE_COUNT, null);
  drawFarLabels(world, labels, 'main');              // names of stops, papers and flow boxes, as pins
  for (const f of S._bandLater) f();                 // on a route, the layers' names after its stops
  placeGroupLabels(labels, (n) => n > 1);            // files that hold several boxes
  drawFarLabels(world, labels, 'minor');             // the other names, where there is room
  placeGroupLabels(labels, (n) => n === 1);          // the remaining file names
  if (routeOn) placeVerbs(labels, false);            // other verbs where there is room
  for (const fn of S._late) fn();                    // overlay tags last
  if (S.pulse) drawPulse(world);
  if (routeOn) drawDot(S.route, labels, 'dot');     // the dot passes under the labels
  labels.drawAll();
  if (routeOn) drawDot(S.route, labels, 'chip');    // what it carries, only where it has room
  drawHoverTag(world, labels);
}
function placeGroupLabels(labels, which) {
  const k = V.k, cards = S.cardsOnScreen || [];
  for (const gl of S._groupLabels) {
    if (gl.done || !which(gl.n)) continue;
    for (const r of gl.rs) {
      if (cards.some((d) => hitR(r, { x: X(d.x), y: Y(d.y), w: d.w * k, h: d.h * k }, 1))) continue;
      if (labels.add(r, () => gl.draw(r))) { gl.done = true; break; }
    }
  }
}

// ---- Bands ----
function drawBands(world, labels) {
  const k = V.k;
  for (const b of world.bands) {
    const x = X(b.x), y = Y(b.y), w = b.w * k, h = b.h * k;
    if (!visible(x, y, w, h)) continue;
    rrect(x, y, w, h, Math.max(6, 28 * k));
    ctx.fillStyle = tint(b.layer, 0);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = tint(b.layer, 2);
    ctx.stroke();
    // the layer's colour along the left edge
    ctx.save();
    rrect(x, y, w, h, Math.max(6, 28 * k));
    ctx.clip();
    ctx.fillStyle = layerColor(b.layer);
    ctx.fillRect(x, y, Math.max(5, 10 * k), h);
    ctx.restore();
    // on a route the numbers and stops come first; the layer's name takes what room is left
    const place = () => bandLabel(b.layer, x, y, w, h, labels, world);
    if (S.route && !S.route.hidden) S._bandLater.push(place); else place();
  }
}
function bandLabel(layer, x, y, w, h, labels, world) {
  const L = LAYER[layer];
  const count = Object.values(NODES).filter((n) => n.layer === layer).length;
  const head = (BAND.padTop + 60) * V.k;       // the empty sky above the band's boxes, on screen
  const z = Math.max(14, Math.min(24, head * 0.42));
  const subs = V.W < 600 ? [`${count} 個`, ''] : [`${L.cross ? LAYER_SHORT_SUB[layer] || L.sub : L.sub}・${count} 個`, `${count} 個`, ''];
  const nameW = textW(L.name, F.sansBold, z);
  const k = V.k;
  const cards = Object.values(world.cards).filter((c) => c.layer === layer);
  const onCard = (r) => cards.some((c) => r.x < X(c.x) + c.w * k - 3 && r.x + r.w > X(c.x) + 3 && r.y < Y(c.y) + c.h * k - 3 && r.y + r.h > Y(c.y) + 3);
  // first a place in the sky that covers no box, then (zoomed out only) anywhere along the top of the land;
  // zoomed in, the spine on the left names the layer, so the name never covers a card
  for (const strict of V.k < 0.5 ? [true, false] : [true]) {
    for (const sub of subs) {
      const subW = sub ? textW(sub, F.sans, 13) + 10 : 0;
      const boxW = nameW + subW + 38, boxH = Math.round(z + (z < 17 ? 12 : 16));
      const cands = [];
      const lx = Math.max(x + Math.max(14, 30 * V.k), 44);
      const cy = Math.max(y + Math.max(3, (head - boxH) / 2), 6);
      cands.push({ x: lx, y: cy });
      for (let fx = 0.04; fx < 0.9; fx += 0.04) cands.push({ x: x + 14 + Math.max(0, w - boxW - 28) * fx, y: cy });
      // beside the land, in the sea: for a narrow layer whose top is taken by a route
      if (STACK.includes(layer)) cands.push({ x: x - boxW - 10, y: cy, out: true }, { x: x + w + 10, y: cy, out: true });
      for (const c of cands) {
        const r = { x: c.x, y: c.y, w: boxW, h: boxH };
        // the name may run past a small layer's land into the sea, never into the next layer
        if (r.y + r.h > y + h - 2 || (r.x < x && !c.out)) continue;
        if ((strict || c.out) && onCard(r)) continue;
        if (c.out && (Object.values(world.cards).some((d) => r.x < X(d.x) + d.w * k && r.x + r.w > X(d.x) && r.y < Y(d.y) + d.h * k && r.y + r.h > Y(d.y))
          || r.x + r.w > X(world.island.x) - 6)) continue;
        if (labels.add(r, () => {
          rrect(r.x, r.y, r.w, r.h, 10);
          ctx.fillStyle = alpha(T.surface, 0.94);
          ctx.fill();
          ctx.fillStyle = layerColor(layer);
          rrect(r.x + 10, r.y + boxH / 2 - 5.5, 11, 11, 3);
          ctx.fill();
          font(F.sansBold, z);
          ctx.fillStyle = T.text;
          ctx.textBaseline = 'middle';
          ctx.fillText(L.name, r.x + 28, r.y + boxH / 2 + 1);
          if (sub) { font(F.sans, 13); ctx.fillStyle = T['text-2']; ctx.fillText(sub, r.x + 28 + nameW + 10, r.y + boxH / 2 + 1); }
          ctx.textBaseline = 'alphabetic';
        })) { S.hits.labels.push({ ...r, band: layer }); return; }
      }
    }
  }
}

function drawIsland(world, labels) {
  const isl = world.island, k = V.k;
  const x = X(isl.x), y = Y(isl.y), w = isl.w * k, h = isl.h * k;
  if (!visible(x, y, w, h)) return;
  rrect(x, y, w, h, Math.max(6, 28 * k));
  ctx.fillStyle = tint('x', 0);
  ctx.fill();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = T['border-strong'];
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of isl.parts) {
    const py = Y(p.y), ph = p.h * k;
    if (p !== isl.parts[0]) {
      ctx.strokeStyle = T['border-strong'];
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 20 * k, py); ctx.lineTo(x + w - 20 * k, py); ctx.stroke();
    }
    const place = () => bandLabel(p.layer, x, py, w, ph, labels, world);
    if (S.route && !S.route.hidden) S._bandLater.push(place); else place();
  }
}

// ---- Groups (files) ----
function drawGroup(g, labels) {
  const k = V.k;
  const x = X(g.x), y = Y(g.y), w = g.w * k, h = g.h * k;
  if (!visible(x, y, w, h)) return;
  rrect(x, y, w, h, Math.max(4, 16 * k));
  ctx.fillStyle = alpha(T.surface, T.dark ? 0.035 : 0.5);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = tint(g.layer, 2);
  ctx.stroke();
  // label in the group's header when it fits there, else above the frame
  const headH = 60 * k;
  const repo = g.label.repo, rel = g.label.rel;
  const lf = g.label.none ? F.sans : F.monoMed;
  if (w > 50 && !(g.label.none && !STACK.includes(g.layer))) {
    const z = headH >= 22 ? Math.min(14, Math.max(12, headH * 0.32)) : 12;
    const inside = headH >= 22;
    const lx = x + (inside ? Math.max(10, 22 * k) : 2);
    const avail = inside ? w - 28 : Math.max(w, 150);
    let repoW = repo ? textW(repo, F.sans, 12) + 10 : 0;
    let relS = g.label.none ? fit(rel, lf, z, avail) : shortName(rel, lf, z, avail - repoW);
    if (!relS && repo) { repoW = 0; relS = shortName(rel, lf, z, avail); }
    const showRepo = repoW > 0;
    if (relS && relS.length > 2) {
      const tw = textW(relS, lf, z);
      const ly = inside ? y + Math.min(headH * 0.55, 34) : y - 7;
      const r = { x: lx - 2, y: ly - z - 1, w: tw + repoW + 4, h: z + 6 };
      // a file label sits on its frame: on the top edge, or under the bottom edge when the top is taken
      const draw = (q) => {
        const bx = q.x + 2, by = q.y + z + 1;
        ctx.fillStyle = alpha(inside ? T.surface : tint(g.layer, 0), 0.92);
        rrect(q.x - 3, q.y - 1, q.w + 6, q.h + 2, 5); ctx.fill();
        font(lf, z);
        ctx.fillStyle = T['text-2'];
        ctx.fillText(relS, bx, by);
        if (showRepo) { font(F.sans, 12); ctx.fillStyle = T['text-3']; ctx.fillText(repo, bx + tw + 10, by); }
      };
      if (inside) { labels.block(r); labels.queue.unshift(() => draw(r)); }
      else {
        const reg = S.world.bands.find((b) => b.layer === g.layer) || S.world.island.parts.find((p) => p.layer === g.layer);
        const below = { ...r, y: y + h + 4 };
        const fitsBelow = reg && below.y + below.h <= Y(reg.y + reg.h) - 2;
        S._groupLabels.push({ rs: fitsBelow ? [r, below] : [r], n: g.ids.length, draw });
      }
    }
  }
  g._screen = { x, y, w, h };
}

// ---- Cards ----
function drawCard(c, sx, sy, sw, sh, labels) {
  const k = V.k;
  const r = Math.max(2, 10 * k);
  const inFlow = S.route && S.route.nodes.has(c.id);
  const cur = S.route && S.route.cur && (S.route.cur.a === c || S.route.cur.b === c);
  const dimmed = S.route && !S.route.hidden && !inFlow && S.dimOthers;
  const block = smooth(0.06, 0.16, k);       // 0: a coloured block, 1: a white card
  // shadow
  if (k > 0.25) {
    rrect(sx, sy + Math.max(1, 3 * k), sw, sh, r);
    ctx.fillStyle = T.dark ? 'rgba(0,0,0,0.35)' : 'rgba(20,20,19,0.07)';
    ctx.fill();
  }
  rrect(sx, sy, sw, sh, r);
  ctx.fillStyle = mix(tint(c.layer, 2), T.surface, block);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = T.border;
  if (block > 0.5) ctx.stroke();
  // layer stripe
  ctx.save();
  rrect(sx, sy, sw, sh, r);
  ctx.clip();
  ctx.fillStyle = layerColor(c.layer);
  ctx.fillRect(sx, sy, Math.max(3, 5 * k), sh);
  ctx.restore();

  const t = smooth(LOD.doc - 0.07, LOD.doc, k);
  if (t >= 1) c._named = S.frame;
  if (t < 1 && sw >= 40) {
    ctx.globalAlpha = 1 - t;
    if (k >= 0.24) { greekAll = true; drawDoc(c, sx, sy, posterBottom(c, sw, sh)); greekAll = false; }
    drawPoster(c, sx, sy, sw, sh, labels);
    ctx.globalAlpha = 1;
  }
  if (t > 0) { ctx.globalAlpha = t; drawDoc(c, sx, sy); ctx.globalAlpha = 1; }

  const dimA = (T.dark ? 0.6 : 0.55) * (1 - smooth(0.55, 0.92, k));
  if (dimmed && dimA > 0.02) { rrect(sx, sy, sw, sh, r); ctx.globalAlpha = dimA / 0.55; ctx.fillStyle = alpha(T.sea, 0.55); ctx.fill(); ctx.globalAlpha = 1; }
  if (inFlow || S.hover === c.id || S.selected === c.id) {
    rrect(sx - 1, sy - 1, sw + 2, sh + 2, r + 1);
    ctx.lineWidth = cur || S.selected === c.id ? 3 : S.hover === c.id ? 2 : 1.5;
    ctx.strokeStyle = cur || S.selected === c.id || S.hover === c.id ? T.accent : alpha(T.accent, 0.55);
    ctx.stroke();
  }
}

// Zoomed out: a poster with the name large, laid out in screen pixels.
// Layouts are kept per size step (8%), laid out for the step's lower edge so they always fit; the least
// recently used are dropped first. Zooming then reuses them instead of laying every poster out again.
const posterCache = new Map();
const STEP = Math.log(1.08);
const bucket = (v) => Math.floor(Math.log(Math.max(1, v)) / STEP);
function posterFor(c, aw, ah) {
  const ba = bucket(aw), bh = bucket(ah);
  const key = c.id + '|' + ba + '|' + bh + '|' + (S.route && !S.route.hidden && S.route.nodes.has(c.id) ? 1 : 0) + (V.k >= 0.2 ? 'm' : 'f');
  let P = posterCache.get(key);
  if (P) { posterCache.delete(key); posterCache.set(key, P); return P; }
  P = posterLayout(c, Math.exp(ba * STEP), Math.exp(bh * STEP));
  posterCache.set(key, P);
  if (posterCache.size > 4000) { let n = 500; for (const k of posterCache.keys()) { posterCache.delete(k); if (--n <= 0) break; } }
  return P;
}
function drawPoster(c, sx, sy, sw, sh, labels) {
  const k = V.k;
  const pad = Math.max(8, Math.min(16, sw * 0.07));
  const stripe = Math.max(3, 5 * k);
  const x0 = sx + stripe + pad, aw = sw - stripe - pad * 2;
  if (aw < 34) return;
  const P = posterFor(c, aw, sh - pad * 2);
  let y = sy + pad;
  if (V.k >= 0.24) {
    ctx.fillStyle = T.surface;
    ctx.save(); rrect(sx, sy, sw, sh, Math.max(2, 10 * k)); ctx.clip();
    ctx.fillRect(sx + stripe, sy, sw - stripe, P.bottom + pad * 1.6);
    ctx.fillStyle = T.border; ctx.fillRect(sx + stripe, sy + P.bottom + pad * 1.6, sw - stripe, 1);
    ctx.restore();
  }
  for (const it of P.items) {
    if (it.icon) { drawKindIcon(c.kind, x0, y + it.y, 13, layerColor(c.layer)); continue; }
    font(it.f, it.z);
    ctx.fillStyle = roleColor(it.c, c.layer);
    ctx.fillText(it.s, x0 + it.x, y + it.y);
  }
  if (!P.noTitle) { labels.block({ x: x0, y: sy + pad, w: Math.min(aw, P.titleW), h: P.titleBottom }); c._named = P.short ? -S.frame : S.frame; }
}
function posterBottom(c, sw, sh) {
  const pad = Math.max(8, Math.min(16, sw * 0.07));
  const aw = sw - Math.max(3, 5 * V.k) - pad * 2;
  return Y(c.y) + posterFor(c, aw, sh - pad * 2).bottom + pad * 1.6;
}
function posterLayout(c, aw, ah) {
  const items = [];
  let y = 0;
  const kindRow = aw >= 90 && ah >= 70;
  if (kindRow) {
    items.push({ icon: true, y: 0 });
    items.push({ s: fit(KIND_NAME[c.kind], F.sansBold, 12, aw - 20), f: F.sansBold, z: 12, c: 'text2', x: 19, y: 11 });
    y += 22;
  }
  // the title: as large as fits, two lines preferred, never cut inside a word
  let lines = null, z = 12, f = c.mono ? F.monoBold : F.sansBold;
  const wrapT = (str, size) => balanced((w) => (c.mono ? wrapName(str, f, size, w, 9) : Object.assign(wrapRich([{ s: str, st: { f } }], w, size).map((l) => l.runs.map((r) => r.s).join('')), {})), aw);
  const ok = (ls, maxL) => ls.length <= maxL && !ls.broken && ls.every((l) => textW(l, f, z) <= aw + 0.5);
  const tryAll = (str, maxL) => { for (const size of [17, 15.5, 14, 13, 12]) { z = size; const ls = wrapT(str, size); if (ok(ls, maxL) && (c.mono || ls.length <= maxL)) return ls; } return null; };
  lines = tryAll(c.title, 2) || (ah > 110 ? tryAll(c.title, 3) : null);
  let short = false;
  if (!lines && c.mono && V.k >= 0.2 && !(S.route && !S.route.hidden && S.route.nodes.has(c.id))) { const sh = shortName(c.title, f, 12, aw, 'code'); if (sh && sh !== c.title) { z = 12; lines = [sh]; short = true; } }
  if (!lines) return { items, titleBottom: y, titleW: 0, bottom: y, noTitle: true };
  const lh = z * 1.3;
  if (y + lh * lines.length > ah + 4) return { items: items.slice(0, kindRow ? 2 : 0), titleBottom: y, titleW: 0, bottom: y, noTitle: true };
  for (const l of lines) { items.push({ s: l, f, z, c: 'text', x: 0, y: y + z }); y += lh; }
  const titleBottom = y;
  const titleW = Math.max(...lines.map((l) => textW(l, f, z)));
  // a first sentence, when there is room
  if (aw >= 150 && ah - y > 60 && c.summary) {
    y += 6;
    const sl = wrapRich([{ s: c.summary, st: { f: F.sans } }], aw, 12.5, Math.max(1, Math.min(4, Math.floor((ah - y - 26) / 19))));
    for (const l of sl) { items.push({ s: l.runs.map((r) => r.s).join(''), f: F.sans, z: 12.5, c: 'text2', x: 0, y: y + 13 }); y += 19; }
  }
  // what is inside
  if (c.facts && ah - y > 30 && aw >= 120) {
    // as many whole facts as fit, never a cut one
    let s = '';
    for (const part of c.facts.split('・')) { const t = s ? s + '・' + part : part; if (textW(t, F.sans, 12) <= aw) s = t; else break; }
    if (s) { y += 6; items.push({ s, f: F.sans, z: 12, c: 'text3', x: 0, y: y + 12 }); y += 18; }
  }
  return { items, titleBottom, titleW, bottom: y, short };
}

// Zoomed in: the whole document in world units. Zoomed out it is drawn as bars under the poster.
let greekAll = false;
function drawDoc(c, ox, oy, skipAbove = -1e9) {
  const k = V.k;
  const vy0 = Math.max(-40, skipAbove), vy1 = V.H + 40;
  batching++;
  for (const it of c.items) {
    const x = ox + it.x * k, y = oy + it.y * k;
    switch (it.k) {
      case 't': {
        const px = it.z * k;
        if (y < vy0 || y - px > vy1 || x > V.W + 20) break;
        const w = (it.w != null ? it.w : textW(it.s, it.st.f, it.z)) * k;
        if (x + w < -20) break;
        const col = roleColor(it.st.c, c.layer);
        if (px < MIN_PX || greekAll) { greek(x, y, w, px, col); break; }
        font(it.st.f, px);
        ctx.fillStyle = col;
        ctx.fillText(it.s, x, y);
        if (it.st.u) { ctx.fillRect(x, y + px * 0.18, w, Math.max(1, px * 0.07)); }
        break;
      }
      case 'r': {
        const w = it.w * k, h = it.h * k;
        if (!visible(x, y, w, h) || y < vy0) break;
        if (it.rad) { rrect(x, y, w, h, it.rad * k); ctx.fillStyle = roleColor(it.fill); ctx.fill(); }
        else { ctx.fillStyle = roleColor(it.fill); ctx.fillRect(x, y, w, Math.max(1, h)); }
        break;
      }
      case 'icon': if (!greekAll && y > vy0 && y < vy1) drawKindIcon(it.kind, x, y, it.z * k, layerColor(c.layer)); break;
      case 'dot': if (y > vy0) { ctx.fillStyle = T['text-3']; ctx.beginPath(); ctx.arc(x, y, it.r * k, 0, 7); ctx.fill(); } break;
      case 'chip': if (y > vy0) drawChip(it, x, y, k); break;
      case 'frame': {
        const w = it.w * k, h = it.h * k;
        if (!visible(x, y, w, h) || y < vy0) break;
        rrect(x, y, w, h, 8 * k); ctx.strokeStyle = T['border-strong']; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        break;
      }
      case 'fig': {
        const w = it.w * k, h = it.h * k;
        if (!visible(x, y, w, h) || y < vy0) break;
        const img = figImages[it.id];
        const textPx = 12 * (it.w / (it.vw || 640)) * k;      // the figure's smallest text on screen
        if (img && img.ready && textPx >= MIN_PX && !greekAll) { ctx.drawImage(img.cv, x, y, w, h); break; }
        rrect(x, y, w, h, 6 * k); ctx.fillStyle = T['surface-2']; ctx.fill();
        ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.stroke();
        drawKindIcon('figure', x + w / 2 - Math.min(h, w) * 0.15, y + h / 2 - Math.min(h, w) * 0.15, Math.min(h, w) * 0.3, T['text-3']);
        break;
      }
      case 'paper': if (y >= vy0) drawPaper(c, it, x, y, k); break;
      case 'code': if (y >= vy0) drawCode(c, it, x, y, k); break;
    }
  }
  if (--batching === 0) flushBars();
}
// Greyed text is collected per colour and filled at once: far fewer canvas state changes than a fillRect each.
const bars = new Map();
let batching = 0;
function bar(fill, x, y, w, h) {
  if (!batching) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); return; }
  let a = bars.get(fill);
  if (!a) bars.set(fill, (a = []));
  a.push(x, y, w, h);
}
function flushBars() {
  for (const [fill, a] of bars) {
    if (!a.length) continue;
    ctx.beginPath();
    for (let i = 0; i < a.length; i += 4) ctx.rect(a[i], a[i + 1], a[i + 2], a[i + 3]);
    ctx.fillStyle = fill; ctx.fill();
    a.length = 0;
  }
}
function greek(x, y, w, px, col) {
  if (px < 0.8 || w < 1) return;
  bar(alpha(col, 0.28), x, y - px * 0.62, w, Math.max(0.8, px * 0.5));
}
function drawChip(it, x, y, k) {
  const w = it.w * k, h = it.h * k, px = it.z * k;
  if (!visible(x, y, w, h)) return;
  rrect(x, y, w, h, h / 2);
  let bg = T['surface-2'], fg = T['text-2'], border = null, dash = null;
  if (it.tone === 'paper') { bg = T.surface; fg = T.accent; border = T.accent; dash = [4, 3]; }
  if (it.tone === 'link') { fg = T.accent; }
  if (it.tone === 'run') { bg = alpha(T['run-' + it.run], 0.13); fg = T.text; }
  ctx.fillStyle = bg; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); }
  let tx = x + 9 * k;
  if (it.tone === 'run') { ctx.fillStyle = T['run-' + it.run]; ctx.beginPath(); ctx.arc(x + 10 * k, y + h / 2, 3.5 * k, 0, 7); ctx.fill(); tx += 8 * k; }
  if (px < MIN_PX || greekAll) { greek(tx, y + h * 0.68, w - 18 * k, px, fg); return; }
  font(it.mono ? F.mono : F.sans, px);
  ctx.fillStyle = fg;
  ctx.fillText(it.s, tx, y + h * 0.68);
}

// The kind as a small drawn glyph.
export function drawKindIcon(kind, x, y, s, color, c2 = ctx) {
  c2.save();
  c2.strokeStyle = color; c2.fillStyle = color; c2.lineWidth = Math.max(1, s * 0.11); c2.lineJoin = 'round'; c2.lineCap = 'round';
  const m = s / 2;
  c2.beginPath();
  switch (kind) {
    case 'func': c2.arc(x + m, y + m, m * 0.85, 0, 7); c2.stroke(); c2.beginPath(); c2.moveTo(x + m * 0.75, y + m * 0.55); c2.lineTo(x + m * 1.35, y + m); c2.lineTo(x + m * 0.75, y + m * 1.45); c2.stroke(); break;
    case 'store': c2.ellipse(x + m, y + s * 0.25, m * 0.8, s * 0.13, 0, 0, 7); c2.stroke(); c2.beginPath(); c2.moveTo(x + m * 0.2, y + s * 0.25); c2.lineTo(x + m * 0.2, y + s * 0.78); c2.ellipse(x + m, y + s * 0.78, m * 0.8, s * 0.13, 0, Math.PI, 0, true); c2.lineTo(x + m * 1.8, y + s * 0.25); c2.stroke(); break;
    case 'schema': c2.rect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.76); c2.stroke(); c2.beginPath(); for (const f of [0.38, 0.62]) { c2.moveTo(x + s * 0.1, y + s * f); c2.lineTo(x + s * 0.9, y + s * f); } c2.stroke(); break;
    case 'enum': for (const f of [0.25, 0.5, 0.75]) { c2.moveTo(x + s * 0.32, y + s * f); c2.lineTo(x + s * 0.9, y + s * f); } c2.stroke(); c2.beginPath(); for (const f of [0.25, 0.5, 0.75]) { c2.moveTo(x + s * 0.14 + 1, y + s * f); c2.arc(x + s * 0.14, y + s * f, s * 0.06, 0, 7); } c2.fill(); break;
    case 'context': c2.setLineDash([s * 0.14, s * 0.1]); c2.rect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.76); c2.stroke(); break;
    case 'hw': c2.rect(x + s * 0.24, y + s * 0.24, s * 0.52, s * 0.52); c2.stroke(); c2.beginPath(); for (const f of [0.38, 0.62]) { c2.moveTo(x + s * f, y + s * 0.06); c2.lineTo(x + s * f, y + s * 0.24); c2.moveTo(x + s * f, y + s * 0.76); c2.lineTo(x + s * f, y + s * 0.94); c2.moveTo(x + s * 0.06, y + s * f); c2.lineTo(x + s * 0.24, y + s * f); c2.moveTo(x + s * 0.76, y + s * f); c2.lineTo(x + s * 0.94, y + s * f); } c2.stroke(); break;
    case 'note': c2.moveTo(x + m, y + s * 0.08); c2.lineTo(x + s * 0.94, y + s * 0.88); c2.lineTo(x + s * 0.06, y + s * 0.88); c2.closePath(); c2.stroke(); c2.beginPath(); c2.moveTo(x + m, y + s * 0.38); c2.lineTo(x + m, y + s * 0.6); c2.stroke(); c2.beginPath(); c2.arc(x + m, y + s * 0.74, s * 0.05, 0, 7); c2.fill(); break;
    case 'figure': c2.rect(x + s * 0.08, y + s * 0.16, s * 0.84, s * 0.68); c2.stroke(); c2.beginPath(); c2.moveTo(x + s * 0.16, y + s * 0.74); c2.lineTo(x + s * 0.42, y + s * 0.44); c2.lineTo(x + s * 0.6, y + s * 0.62); c2.lineTo(x + s * 0.72, y + s * 0.5); c2.lineTo(x + s * 0.86, y + s * 0.74); c2.stroke(); break;
    default: c2.arc(x + m, y + m, m * 0.6, 0, 7); c2.fill();
  }
  c2.restore();
}

// ---- Code inside a card ----
function drawCode(c, it, x, y, k) {
  const w = it.w * k, h = it.h * k;
  if (!visible(x, y, w, h)) return;
  rrect(x, y, w, h, 6 * k);
  ctx.fillStyle = T['code-bg'];
  ctx.fill();
  const px = it.z * k, lh = it.lh * k;
  const readable = px >= MIN_PX;
  const hl = S.codeLine && S.codeLine.path === it.path ? S.codeLine.line : null;
  const ox = c.x, oy = c.y;
  const baseX = X(ox) + it.cx * k, numX = X(ox) + it.numX * k;
  for (const ln of it.lines) {
    const ly = Y(oy + ln.y);
    if (ly + lh < -10 || ly > V.H + 10) continue;
    if (hl != null && ln.no === hl || (hl != null && ln.cont && ln._of === hl)) {
      ctx.fillStyle = T['code-hl'];
      ctx.fillRect(x + 2 * k, ly, w - 4 * k, lh);
      ctx.fillStyle = T.accent;
      ctx.fillRect(x, ly, Math.max(2, 1.2 * k), lh);
    }
    const base = ly + lh * 0.76;
    if (!readable && (lh < 5 || greekAll)) {
      // one bar per line
      const tk = ln.toks.filter((t) => t.s.trim());
      if (!tk.length) continue;
      const a = tk[0], b = tk[tk.length - 1];
      const lead = a.s.length - a.s.trimStart().length, cw = a.w / a.s.length;
      bar(alpha(T['text-2'], ln.dim ? 0.12 : 0.28), baseX + (a.x + lead * cw) * k, ly + lh * 0.25, (b.x + b.w - a.x - lead * cw) * k, Math.max(0.5, lh * 0.5));
      continue;
    }
    if (!readable || greekAll) {
      // a bar per token, in its colour
      for (const t of ln.toks) {
        if (!t.s.trim()) continue;
        const col = t.c === 'plain' ? T['text-2'] : roleColor(t.c);
        const lead = t.s.length - t.s.trimStart().length;
        const cw = t.w / t.s.length;
        bar(alpha(col, ln.dim ? 0.18 : 0.42), baseX + (t.x + lead * cw) * k, ly + lh * 0.3, (t.w - lead * cw) * k, Math.max(0.6, lh * 0.42));
      }
      continue;
    }
    ctx.globalAlpha = ln.dim ? 0.45 : 1;
    if (ln.no != null) {
      font(F.mono, px);
      ctx.fillStyle = T['text-3'];
      ctx.textAlign = 'right';
      ctx.fillText(String(ln.no), numX, base);
      ctx.textAlign = 'left';
    }
    for (const t of ln.toks) {
      const tx = baseX + t.x * k;
      if (tx > V.W) break;
      if (tx + t.w * k < 0) continue;
      font(t.c === 'kw' ? F.monoMed : F.mono, px);
      ctx.fillStyle = t.c === 'plain' ? T.text : roleColor(t.c);
      ctx.fillText(t.s, tx, base);
    }
    ctx.globalAlpha = 1;
  }
}

// ---- A paper inside a card ----
function drawPaper(c, it, x, y, k) {
  const P = it.paper;
  const w = P.w * k, h = P.h * k;
  if (!visible(x, y, w, h)) return;
  rrect(x, y, w, h, 8 * k);
  ctx.fillStyle = T['surface-2'];
  ctx.fill();
  ctx.strokeStyle = T['border-strong'];
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  const pz = P.z * k, ps = P.zs * k;
  for (const b of P.bands) {
    const by = y + b.y * k, bh = b.h * k;
    rrect(x + 4 * k, by + 4 * k, w - 8 * k, bh - 8 * k, 6 * k);
    ctx.fillStyle = tint(b.tone, 1);
    ctx.fill();
    ctx.fillStyle = layerColor(b.tone);
    ctx.fillRect(x + 4 * k, by + 4 * k, Math.max(2, 3 * k), bh - 8 * k);
    textOrGreek(b.name, F.sansBold, P.z + 0.5, x + 12 * k, by + bh / 2 - 1 * k, T.text, k);
    textOrGreek(fit(b.sub, F.sans, P.zs, P.labelW - 14), F.sans, P.zs, x + 12 * k, by + bh / 2 + 10 * k, T['text-2'], k);
  }
  // steps under the boxes
  const curStep = S.paperStep && S.paperStep.pid === P.pid ? S.paperStep.i : null;
  for (const st of P.steps) {
    const pts = st.pts.map((p) => ({ x: x + p.x * k, y: y + p.y * k }));
    const isCur = st.i === curStep;
    ctx.strokeStyle = isCur ? T.accent : alpha(T.accent, st.alt ? 0.45 : 0.7);
    ctx.lineWidth = isCur ? Math.max(2, 2 * k) : Math.max(1, 1.2 * k);
    ctx.setLineDash(dashFor(st.kind, st.alt, Math.max(1, k * 0.6)));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y); ctx.stroke();
    ctx.setLineDash([]);
    arrowHead(st.pts.map((p) => ({ x: x + p.x * k, y: y + p.y * k })), Math.max(4, 6 * k), ctx.strokeStyle, st.kind === 'return');
  }
  for (const b of P.boxes) {
    const bx = x + b.x * k, by = y + b.y * k, bw = b.w * k, bh = b.h * k;
    rrect(bx, by, bw, bh, 5 * k);
    ctx.fillStyle = T.surface;
    ctx.fill();
    const on = S.paperStep && S.paperStep.pid === P.pid && S.paperStep.boxes && S.paperStep.boxes.includes(b.id);
    ctx.strokeStyle = on ? T.accent : T['border-strong'];
    ctx.lineWidth = on ? Math.max(1.5, 1.6 * k) : 1;
    ctx.stroke();
    ctx.fillStyle = layerColor(NODES[b.node] ? NODES[b.node].layer : b.tone);
    ctx.fillRect(bx, by + 2 * k, Math.max(1.5, 2.5 * k), bh - 4 * k);
    const tl = b.titleLines || [b.title];
    tl.forEach((l, j) => textOrGreek(l, b.tf || F.monoBold, P.z, bx + 8 * k, by + (7 + P.z + j * (P.z + 3)) * k, T.text, k));
    const extra = (tl.length - 1) * (P.z + 3);
    (b.subLines || []).forEach((l, j) => textOrGreek(fit(l, F.sans, P.zs, b.w - 14), F.sans, P.zs, bx + 8 * k, by + (11 + extra + P.z + P.zs + j * (P.zs + 4)) * k, T['text-2'], k));
    if (b.cells) {
      let cx = bx + 7 * k;
      const ch = (P.zs + 5) * k;
      const cy = by + bh - ch - 5 * k;
      for (const cell of b.cells) {
        const cw = (textW(cell, F.sans, P.zs) + 8) * k;
        if (cx + cw > bx + bw - 4 * k) break;
        rrect(cx, cy, cw, ch, 3 * k);
        ctx.fillStyle = T['surface-2']; ctx.fill(); ctx.strokeStyle = T.border; ctx.stroke();
        textOrGreek(cell, F.sans, P.zs, cx + 4 * k, cy + ch - 3.4 * k, T['text-2'], k);
        cx += cw + 4 * k;
      }
    }
  }
  // arrows that pass behind a box: a faint ghost on top keeps them readable
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (const st of P.steps) {
    const crosses = P.boxes.some((b) => b.id !== st.from && b.id !== st.to && [0.25, 0.4, 0.5, 0.6, 0.75].some((t) => { const q = bezier(st.pts, t); return q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h; }));
    if (!crosses) continue;
    const pts = st.pts.map((p) => ({ x: x + p.x * k, y: y + p.y * k }));
    ctx.strokeStyle = T.accent; ctx.lineWidth = Math.max(1, 1.2 * k); ctx.setLineDash([3 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  // the moving dot on the current step
  if (curStep != null && S.paperStep.t != null) {
    const st = P.steps.find((q) => q.i === curStep);
    if (st) {
      const m = bezier(st.pts, Math.min(1, S.paperStep.t));
      const mx = x + m.x * k, my = y + m.y * k;
      ctx.beginPath(); ctx.arc(mx, my, Math.max(5, 5 * k), 0, 7); ctx.fillStyle = T.accent; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = T.surface; ctx.stroke();
    }
  }
  // step numbers on top
  const taken = [];
  for (const st of P.steps) {
    const short = Math.abs(st.pts[3].x - st.pts[0].x) < 60 && Math.abs(st.pts[3].y - st.pts[0].y) < 4;
    // a place on the arrow that is not on a box and not on another number
    let m = bezier(st.pts, 0.5);
    if (!short) {
      for (const t of [0.5, 0.36, 0.64, 0.24, 0.76, 0.15, 0.85]) {
        const q = bezier(st.pts, t);
        const onBox = P.boxes.some((b) => q.x > b.x - 9 && q.x < b.x + b.w + 9 && q.y > b.y - 9 && q.y < b.y + b.h + 9);
        const onNum = taken.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 20);
        if (!onBox && !onNum) { m = q; break; }
      }
    }
    taken.push(m);
    const mx = x + m.x * k, my = y + (m.y - (short ? 22 : 0)) * k;
    if (short) { ctx.strokeStyle = alpha(T.accent, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mx, my + 8 * k); ctx.lineTo(x + m.x * k, y + m.y * k); ctx.stroke(); }
    const isCur = st.i === curStep;
    const rr = 8.5 * k;
    if (st.alt) {
      const tw = textW(st.no, F.sansBold, P.zs) * k + 8 * k;
      rrect(mx - tw / 2, my - rr, tw, rr * 2, rr);
    } else { ctx.beginPath(); ctx.arc(mx, my, rr, 0, 7); }
    ctx.fillStyle = isCur ? T.accent : T.surface;
    ctx.fill();
    ctx.strokeStyle = T.accent; ctx.lineWidth = Math.max(1, 1.1 * k); if (st.alt) ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
    if (P.zs * k >= MIN_PX) {
      font(F.sansBold, P.zs * k);
      ctx.fillStyle = isCur ? T['accent-text'] : T.accent;
      ctx.textAlign = 'center';
      ctx.fillText(st.no, mx, my + P.zs * k * 0.36);
      ctx.textAlign = 'left';
    }
  }
}
function textOrGreek(s, f, z, x, y, col, k) {
  if (!s) return;
  const px = z * k, w = textW(s, f, z) * k;
  if (px < MIN_PX) { greek(x, y, w, px, col); return; }
  font(f, px); ctx.fillStyle = col; ctx.fillText(s, x, y);
}

function dashFor(kind, alt, s = 1) {
  if (alt) return [6 * s, 5 * s];
  switch (kind) {
    case 'return': return [9 * s, 6 * s];
    case 'msg': return [12 * s, 4 * s, 2 * s, 4 * s];
    case 'signal': return [2 * s, 5 * s];
    case 'data': return [5 * s, 4 * s];
    default: return [];
  }
}
function arrowHead(pts, size, color, open) {
  const end = pts[3], tg = bezierTangent(pts, 0.999);
  const a = Math.atan2(tg.y, tg.x);
  ctx.save();
  ctx.translate(end.x, end.y); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size * 1.5, -size * 0.75); ctx.lineTo(-size * 1.5, size * 0.75); ctx.closePath();
  if (open) { ctx.fillStyle = T.surface; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, size * 0.22); ctx.setLineDash([]); ctx.stroke(); }
  else { ctx.fillStyle = color; ctx.fill(); }
  ctx.restore();
}

// ---- The selected flow as a route ----
function drawRoute(R, labels) {
  const k = V.k;
  const w = k < LOD.far ? 2.5 : 3;
  const order = R.steps.filter((s) => s.pts).sort((a, b) => (a === R.cur) - (b === R.cur));
  // when the cards show their text, the route steps back so the text reads through it
  const see = 1 - 0.62 * smooth(0.6, 0.95, k);
  ctx.save();
  // casing first, then lines
  for (const pass of [0, 1]) {
    for (const s of order) {
      const pts = s.pts.map((p) => ({ x: X(p.x), y: Y(p.y) }));
      const isCur = s === R.cur;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
      ctx.lineCap = 'round';
      if (pass === 0) {
        ctx.globalAlpha = see;
        ctx.setLineDash([]);
        ctx.strokeStyle = isCur ? alpha(T.accent, 0.22) : T.halo;
        ctx.lineWidth = isCur ? w + 12 : w + 5;
        ctx.stroke();
      } else {
        ctx.globalAlpha = isCur ? Math.max(see, 0.7) : see;
        ctx.setLineDash(dashFor(s.st.kind, !!s.st.alt));
        ctx.strokeStyle = isCur ? T.accent : alpha(T.accent, s.st.alt ? 0.45 : R.cur ? 0.62 : 0.85);
        ctx.lineWidth = isCur ? w + 1.5 : s.st.kind === 'syscall' ? w + 0.8 : w;
        ctx.stroke();
        ctx.setLineDash([]);
        arrowHead(pts, isCur ? 5.5 : 4.5, ctx.strokeStyle, s.st.kind === 'return');
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
  ctx.lineCap = 'butt';
  S._verbs = [];
}
// Step numbers: the current step first, then the main steps in order, then the alternatives;
// each on its line where it covers no other label, else beside the line with a short leader.
function placeBadges(R, labels, curOnly) {
  const k = V.k;
  const tries = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.12, 0.88];
  const seq = [];
  if (curOnly) { if (R.cur && R.cur.pts) seq.push(R.cur); }
  else {
    for (const i of stepOrder(R.f)) if (!R.f.steps[i].alt && R.steps[i] !== R.cur) seq.push(R.steps[i]);
    for (const i of stepOrder(R.f)) if (R.f.steps[i].alt && R.steps[i] !== R.cur) seq.push(R.steps[i]);
  }
  const cardRects = (S.cardsOnScreen || []).map((c) => ({ x: X(c.x), y: Y(c.y), w: c.w * k, h: c.h * k }));
  const offCards = (r) => k < 0.6 || !cardRects.some((c) => r.x < c.x + c.w && r.x + r.w > c.x && r.y < c.y + c.h && r.y + r.h > c.y);
  for (const s of seq) {
    if (!s || !s.pts) continue;
    const isCur = s === R.cur;
    const label = s.no;
    const bw = s.st.alt ? textW(label, F.sansBold, 12) + 16 : 24, bh = 24;
    let placed = null;
    for (const pass of [0, 1]) {
      for (const t of tries) {
        const m = bezier(s.pts, t);
        const r = { x: X(m.x) - bw / 2, y: Y(m.y) - bh / 2, w: bw, h: bh };
        if (labels.free(r, 2) && (pass || offCards(r))) { placed = { r, t }; break; }
      }
      if (placed) break;
    }
    if (!placed && !s.st.alt) {
      // beside the line, tied to it by a leader, rather than missing
      outer: for (const t of [0.5, 0.36, 0.64, 0.24, 0.76]) {
        const m = bezier(s.pts, t), tg = bezierTangent(s.pts, t);
        const len = Math.hypot(tg.x, tg.y) || 1, nx = -tg.y / len, ny = tg.x / len;
        for (const d of [24, -24, 36, -36, 50, -50]) {
          const px = X(m.x) + nx * d, py = Y(m.y) + ny * d;
          const r = { x: px - bw / 2, y: py - bh / 2, w: bw, h: bh };
          if (labels.free(r, 2) && offCards(r)) { placed = { r, t, lead: { x: X(m.x), y: Y(m.y) } }; break outer; }
        }
      }
    }
    if (!placed) {
      // squeeze: a smaller number anywhere on the curve
      for (let t = 0.08; t <= 0.92 && !placed; t += 0.04) {
        const m = bezier(s.pts, t);
        const r = { x: X(m.x) - bw / 2 + 2, y: Y(m.y) - bh / 2 + 2, w: bw - 4, h: bh - 4 };
        if (labels.free(r, 0)) placed = { r, t };
      }
    }
    if (!placed) continue;
    labels.block(placed.r);
    S.hits.badges.push({ ...placed.r, step: s.i });
    S._verbs.push({ s, placed, bw, isCur });
    labels.queue.push(() => {
      const r = placed.r;
      if (placed.lead) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, L = placed.lead;
        ctx.strokeStyle = T.accent; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.beginPath(); ctx.arc(L.x, L.y, 2.6, 0, 7); ctx.fillStyle = T.accent; ctx.fill();
      }
      rrect(r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fillStyle = isCur ? T.accent : T.surface; ctx.fill();
      ctx.strokeStyle = T.accent; ctx.lineWidth = isCur ? 2 : 1.6;
      if (s.st.alt) ctx.setLineDash([3, 2]);
      ctx.stroke(); ctx.setLineDash([]);
      font(F.sansBold, 12); ctx.fillStyle = isCur ? T['accent-text'] : T.accent;
      ctx.textAlign = 'center'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 4.5); ctx.textAlign = 'left';
      if (s.paper) {
        // a paper inside the target: a small folded corner
        ctx.fillStyle = isCur ? T['accent-text'] : T.accent;
        ctx.beginPath(); ctx.moveTo(r.x + r.w - 2, r.y + 3); ctx.lineTo(r.x + r.w + 4, r.y - 3); ctx.lineTo(r.x + r.w + 4, r.y + 3); ctx.closePath(); ctx.fill();
      }
    });
  }
}
// Verbs beside the numbers, where there is still room.
function placeVerbs(labels, curOnly) {
  const k = V.k;
  for (const { s, placed, bw, isCur } of S._verbs || []) {
    const verb = s.st.verb || '';
    if (!verb || !(isCur || k >= 0.26) || (curOnly && !isCur) || (!curOnly && isCur)) continue;
    const vw = textW(verb, F.sansMed, 12.5) + 16, vh = 22;
    for (const side of [1, -1]) {
      const r = { x: side > 0 ? placed.r.x + bw + 4 : placed.r.x - vw - 4, y: placed.r.y + 1, w: vw, h: vh };
      if (labels.add(r, () => {
        rrect(r.x, r.y, r.w, r.h, 11);
        ctx.fillStyle = isCur ? T.accent : T.surface; ctx.fill();
        ctx.strokeStyle = isCur ? T.accent : alpha(T.accent, 0.5); ctx.lineWidth = 1; ctx.stroke();
        font(F.sansMed, 12.5); ctx.fillStyle = isCur ? T['accent-text'] : T.text;
        ctx.fillText(verb, r.x + 8, r.y + 15.5);
      })) break;
    }
  }
}
function drawDot(R, labels, part) {
  if (!R.cur || !R.cur.pts || R.dotT == null) return;
  const t = Math.max(0, Math.min(1, R.dotT));
  const m = bezier(R.cur.pts, t);
  const x = X(m.x), y = Y(m.y);
  if (part === 'dot') {
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = alpha(T.accent, 0.25); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = T.accent; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = T.surface; ctx.stroke();
    return;
  }
  const data = R.cur.st.data;
  if (data && data.label && data.chip !== false) {
    const s = data.label;
    const w = textW(s, F.monoBold, 12) + 26, h = 22;
    const offs = [[12, -h - 6], [12, 8], [-w - 12, -h - 6], [-w - 12, 8], [-w / 2, -h - 14], [-w / 2, 14]];
    // keep the side it had while that side has room (no flicker); never over another label
    const order = R.chipSide != null ? [R.chipSide, ...offs.keys()] : [...offs.keys()];
    let r = null;
    for (const j of order) {
      const q = { x: x + offs[j][0], y: y + offs[j][1], w, h };
      if (labels.free(q, 2)) { r = q; R.chipSide = j; break; }
    }
    if (!r) { R.chipSide = null; return; }
    const bx = r.x, by = r.y;
    rrect(bx, by, w, h, 6); ctx.fillStyle = T.surface; ctx.fill(); ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5; ctx.stroke();
    // a small envelope
    ctx.strokeStyle = T.accent; ctx.lineWidth = 1.2; ctx.strokeRect(bx + 6, by + 7, 10, 8);
    ctx.beginPath(); ctx.moveTo(bx + 6, by + 7); ctx.lineTo(bx + 11, by + 11.5); ctx.lineTo(bx + 16, by + 7); ctx.stroke();
    font(F.monoBold, 12); ctx.fillStyle = T.text; ctx.fillText(s, bx + 20, by + 15.5);
  }
}

// ---- Overlays ----
function drawContexts(world, labels) {
  const k = V.k;
  for (const id in CONTEXT_OF) {
    const c = world.cards[id];
    if (!c) continue;
    const x = X(c.x), y = Y(c.y), w = c.w * k, h = c.h * k;
    if (!visible(x, y, w, h, 20)) continue;
    const ctxId = CONTEXT_OF[id], run = runOf(ctxId), col = T['run-' + run];
    const kernel = NODES[ctxId].kernel;
    const m = Math.max(4, 10 * k);
    rrect(x - m, y - m, w + 2 * m, h + 2 * m, Math.max(4, 16 * k));
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    if (kernel) ctx.setLineDash([8, 5]);
    ctx.stroke(); ctx.setLineDash([]);
    const s = NODES[ctxId].title;
    const tw = textW(s, F.sansBold, 12) + 16;
    const r = { x: x - m + 8, y: y - m - 11, w: tw, h: 22 };
    S._late.push(() => labels.add(r, () => {
      rrect(r.x, r.y, r.w, r.h, 11); ctx.fillStyle = col; ctx.fill();
      font(F.sansBold, 12); ctx.fillStyle = T.dark ? '#141413' : '#ffffff'; ctx.fillText(s, r.x + 8, r.y + 15.5);
    }));
  }
}
function drawPolicy(world, labels) {
  const lib = world.bands.find((b) => b.layer === 'lib'), os = world.bands.find((b) => b.layer === 'os');
  if (!lib || !os) return;
  const yW = (lib.y + lib.h + os.y) / 2;
  const y = Y(yW);
  if (y < -20 || y > V.H + 20) return;
  // the border runs along both pieces of land it separates
  const x0 = X(Math.min(lib.x, os.x)), x1 = X(Math.max(lib.x + lib.w, os.x + os.w));
  ctx.strokeStyle = alpha(T.text, 0.8); ctx.lineWidth = 1.6; ctx.setLineDash([10, 6]);
  ctx.beginPath(); ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(V.W, x1), y); ctx.stroke(); ctx.setLineDash([]);
  const long = '方針：SDK は MyOS を import しない（境界はプロトコルだけ）', short = '方針：SDK は MyOS を import しない', tiny = '方針';
  S._late.push(() => {
    const L = Math.max(0, x0) + 14, Rr = Math.min(V.W, x1) - 14;
    // on the line, else just above or below it (tied to it by its dashed border), never on a box;
    // only when nothing else is free, on the line over a box's edge
    for (const strict of [true, false]) for (const s of [long, short, tiny]) {
      const tw = textW(s, F.sansBold, 12.5) + 20;
      if (Rr - L < tw) continue;
      for (const dy of strict ? [-12, -28, 4] : [-12]) for (const fx of [0, 0.3, 0.55, 0.8, 0.15, 0.42, 0.68, 0.92, 1, 0.07, 0.22, 0.36, 0.5, 0.62, 0.74, 0.86]) {
        const r = { x: L + (Rr - L - tw) * fx, y: y + dy, w: tw, h: 24 };
        if (strict && (S.cardsOnScreen || []).some((c) => hitR(r, { x: X(c.x), y: Y(c.y), w: c.w * V.k, h: c.h * V.k }, 2))) continue;
        if (labels.add(r, () => {
          rrect(r.x, r.y, r.w, r.h, 12); ctx.fillStyle = T.surface; ctx.fill();
          ctx.strokeStyle = T.text; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
          font(F.sansBold, 12.5); ctx.fillStyle = T.text; ctx.fillText(s, r.x + 10, r.y + 16.5);
        })) { S.hits.labels.push({ ...r, node: 'policy.sdk-no-myos' }); return; }
      }
    }
  });
}
function drawContractLines(world) {
  const focus = S.contractFocus;
  const list = focus ? [focus] : S.overlays.contract ? Object.keys(S.contractUsers || {}) : [];
  if (!list.length) return;
  const k = V.k;
  for (const cid of list) {
    const c = world.cards[cid];
    if (!c) continue;
    const users = (S.contractUsers || {})[cid] || [];
    const ax = X(c.x), ay = Y(c.y + 40);
    for (const u of users) {
      const t = world.cards[u];
      if (!t) continue;
      const bx = X(t.x + t.w), by = Y(t.y + 40);
      ctx.beginPath(); ctx.moveTo(ax, ay);
      const dx = Math.max(60, (ax - bx) * 0.4);
      ctx.bezierCurveTo(ax - dx, ay, bx + dx, by, bx, by);
      ctx.strokeStyle = focus ? T.accent : alpha(T['text-3'], 0.45);
      ctx.lineWidth = focus ? 2 : 1.2;
      ctx.setLineDash(focus ? [] : [4, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      if (focus) { ctx.beginPath(); ctx.arc(bx, by, 4, 0, 7); ctx.fillStyle = T.accent; ctx.fill(); }
    }
  }
}
function drawTraceHeat(world) {
  const k = V.k;
  const max = Math.max(...Object.values(TRACE_COUNT));
  for (const id in TRACE_COUNT) {
    const c = world.cards[id];
    if (!c) continue;
    const cx = X(c.x + c.w / 2), cy = Y(c.y + Math.min(c.h / 2, 160));
    const r = Math.max(30, (220 + 520 * Math.sqrt(TRACE_COUNT[id] / max)) * k);
    if (!visible(cx - r, cy - r, 2 * r, 2 * r)) continue;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, alpha('#e5484d', T.dark ? 0.45 : 0.32));
    g.addColorStop(1, alpha('#e5484d', 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  }
}
function drawPulse(world) {
  const p = S.pulse, c = world.cards[p.id];
  if (!c) return;
  const t = (performance.now() - p.t0) / 1400;
  if (t > 1) { S.pulse = null; return; }
  const k = V.k, m = (8 + 30 * t);
  rrect(X(c.x) - m, Y(c.y) - m, c.w * k + 2 * m, c.h * k + 2 * m, Math.max(6, 12 * k) + m);
  ctx.strokeStyle = alpha(T.accent, 1 - t);
  ctx.lineWidth = 4 * (1 - t) + 1;
  ctx.stroke();
}

// ---- The recorded run ----
// How many times each box was entered (so far), as small red counts at the cards' top-right corners.
function traceCounts(world, labels, counts, current) {
  for (const id in counts) {
    const c = world.cards[id];
    if (!c) continue;
    const x = X(c.x + c.w), y = Y(c.y);
    if (!visible(x - 60, y - 20, 80, 40)) continue;
    const s = `${counts[id]} 回`;
    const tw = textW(s, F.sansBold, 12) + 14;
    const r = { x: x - tw + 6, y: y - 11, w: tw, h: 22 };
    const on = id === current;
    labels.add(r, () => {
      rrect(r.x, r.y, r.w, r.h, 11); ctx.fillStyle = on ? '#e5484d' : T.surface; ctx.fill();
      ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1.5; ctx.stroke();
      font(F.sansBold, 12); ctx.fillStyle = on ? '#ffffff' : (T.dark ? '#ff8a8d' : '#c4262b'); ctx.fillText(s, r.x + 7, r.y + 15.5);
    });
  }
}
function arrowHeadQuad(p0, c, p1, color) {
  const a = Math.atan2(p1.y - c.y, p1.x - c.x);
  ctx.save(); ctx.translate(p1.x, p1.y); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-17, -6); ctx.lineTo(-17, 6); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
function drawTrace(world, labels) {
  const tr = S.trace, k = V.k;
  const counts = {};
  for (const j of NODE_EVENTS) { if (j > tr.i) break; const n = EVENTS[j].n; if (world.cards[n]) counts[n] = (counts[n] || 0) + 1; }
  // the trail: the last hops between boxes, fading out
  const idx = [];
  for (let j = tr.i; j >= 0 && idx.length < 12; j--) if (EVENTS[j].n && world.cards[EVENTS[j].n]) idx.unshift(j);
  // the trail joins the boxes' top edges (where the pins sit), so it never covers a box's name
  const anchor = (c) => ({ x: X(c.x + c.w / 2), y: Y(c.y) });
  ctx.lineCap = 'round';
  for (let a = 1; a < idx.length; a++) {
    const c0 = world.cards[EVENTS[idx[a - 1]].n], c1 = world.cards[EVENTS[idx[a]].n];
    if (c0 === c1) continue;
    const p0 = anchor(c0), p1 = anchor(c1);
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2 - Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.18;
    const fade = Math.pow(a / (idx.length - 1 || 1), 1.6);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(mx, my, p1.x, p1.y);
    ctx.globalAlpha = 0.15 + 0.85 * fade;
    ctx.strokeStyle = T.halo; ctx.lineWidth = 3 + 5 * fade; ctx.stroke();
    ctx.strokeStyle = threadColor(EVENTS[idx[a]].thread); ctx.lineWidth = 1.2 + 3.3 * fade; ctx.stroke();
    ctx.globalAlpha = 1;
    if (a === idx.length - 1) arrowHeadQuad(p0, { x: mx, y: my }, p1, ctx.strokeStyle);
  }
  ctx.lineCap = 'butt';
  // the box the run is in now
  const j = idx[idx.length - 1];
  if (j != null) {
    const c = world.cards[EVENTS[j].n];
    const x = X(c.x), y = Y(c.y), w = c.w * k, h = c.h * k;
    const t = ((performance.now() - (tr.t0 || 0)) % 1200) / 1200;
    rrect(x - 3, y - 3, w + 6, h + 6, Math.max(4, 10 * k) + 3);
    ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 3; ctx.stroke();
    const m = 4 + 14 * t;
    rrect(x - m, y - m, w + 2 * m, h + 2 * m, Math.max(4, 10 * k) + m);
    ctx.strokeStyle = alpha('#e5484d', 0.6 * (1 - t)); ctx.lineWidth = 2; ctx.stroke();
    const p = anchor(c);
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fillStyle = '#e5484d'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = T.surface; ctx.stroke();
  }
  traceCounts(world, labels, counts, j != null ? EVENTS[j].n : null);
}

// Names for cards too small to show their own, as map pins: a dot on the card's edge, a short leader, and the
// name in empty space next to it. A name never lies on another box, so it points at exactly one.
// Phase 'main': route stops, boxes with a paper, boxes on a flow. Phase 'minor': the rest.
const regionCache = new WeakMap();
function regionOf(world, c) {
  let r = regionCache.get(c);
  if (r) return r;
  r = world.bands.find((b) => c.y >= b.y && c.y <= b.y + b.h && c.x >= b.x - 1 && c.x <= b.x + b.w)
    || world.island.parts.find((p) => c.y >= p.y && c.y <= p.y + p.h) || null;
  regionCache.set(c, r);
  return r;
}
const hitR = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
function pinTitle(c, R, pass) {
  const raw = (R && R.stopTitle[c.id]) || c.title;
  const f = isCodeName(raw) ? F.monoBold : F.sansBold;
  if (pass === 0) return raw.length > 26 ? null : { s: raw, f };
  // second pass: a shorter form that keeps the end of the name (scheduler.reschedule → reschedule)
  if (!isCodeName(raw)) return null;
  const sh = shortName(raw, f, 12.5, 150, 'code');
  return sh && sh !== raw ? { s: sh, f } : null;
}
function drawFarLabels(world, labels, phase) {
  const k = V.k;
  const R = S.route && !S.route.hidden ? S.route : null;
  if (R && !R.stopTitle) { R.stopTitle = {}; for (const b of R.f.boxes) if (!R.stopTitle[b.node]) R.stopTitle[b.node] = b.short || b.title; }
  const inAnyFlow = (id) => S.flowNodes && S.flowNodes.has(id);
  const prio = (id) => (R ? (R.nodes.has(id) ? 0 : 9) : NODES[id].paper ? 0 : inAnyFlow(id) ? 1 : 3);
  const curIds = R && R.cur && R.cur.a ? [R.cur.a.id, R.cur.b.id] : [];
  const inPhase = (id) => (phase === 'cur' ? curIds.includes(id) : phase === 'main' ? prio(id) <= 1 : prio(id) === 3 && k < 0.2);
  const list = (S.cardsOnScreen || []).filter((c) => !S.pinned.has(c.id) && c._named !== S.frame
    && !(c._named === -S.frame && !(R && R.nodes.has(c.id))) && inPhase(c.id))
    .sort((a, b) => prio(a.id) - prio(b.id) || (FLOW_RANK[a.id] ?? 999) - (FLOW_RANK[b.id] ?? 999));
  const others = S.cardsOnScreen || [];
  const screenOf = (d) => ({ x: X(d.x), y: Y(d.y), w: d.w * k, h: d.h * k });
  for (const pass of [0, 1]) {
    for (const c of list) {
      if (S.pinned.has(c.id) || S.pinned.size > 64) continue;
      const t = pinTitle(c, R, pass);
      if (!t) continue;
      const tw = textW(t.s, t.f, 12.5) + 14, th = 22, gap = 6;
      const cr = screenOf(c), cx = cr.x + cr.w / 2;
      const reg = regionOf(world, c);
      const rr = reg ? { x: X(reg.x), y: Y(reg.y), w: reg.w * k, h: reg.h * k } : null;
      // where the tag may go: above, below, on its own card when it fits, beside it, one row higher
      const xs = [cx - tw / 2, cx - 12, cx - tw + 12];
      const cands = [];
      for (const x of xs) cands.push({ x, y: cr.y - th - gap, side: 't' });
      if (tw <= cr.w + 16 && cr.h > th + 14) cands.push({ x: cx - tw / 2, y: cr.y + 7, side: 'in' });
      for (const x of xs) cands.push({ x, y: cr.y + cr.h + gap, side: 'b' });
      const sy = cr.y + Math.min(cr.h / 2, 16) - th / 2;
      cands.push({ x: cr.x + cr.w + gap + 2, y: sy, side: 'r' }, { x: cr.x - gap - 2 - tw, y: sy, side: 'l' });
      for (const x of xs) cands.push({ x, y: cr.y - 2 * th - gap - 6, side: 't' });
      for (const p of cands) {
        const r = { x: p.x, y: p.y, w: tw, h: th };
        // stay inside the layer the box is in, so a name never sits in a neighbouring layer
        if (rr && (r.y < rr.y - 1 || r.y + r.h > rr.y + rr.h + 1)) continue;
        if (p.side === 'in' ? !(r.x >= cr.x - 8 && r.x + r.w <= cr.x + cr.w + 8 && r.y + r.h <= cr.y + cr.h) : hitR(r, cr, 1)) continue;
        // never on another box (on a route, boxes off the route are dimmed and may be covered);
        // a name sitting on its own box may overhang a neighbour by a few pixels
        const slack = p.side === 'in' ? -6 : 2;
        if (others.some((d) => d !== c && (!R || R.nodes.has(d.id)) && hitR(r, screenOf(d), slack))) continue;
        if (!labels.free(r)) continue;
        // the leader: from the box's edge to the tag
        let ax, ay, bx, by;
        if (p.side === 't' || p.side === 'b') {
          ax = Math.max(cr.x + 3, Math.min(cr.x + cr.w - 3, Math.max(r.x + 8, Math.min(r.x + r.w - 8, cx))));
          ay = p.side === 't' ? cr.y : cr.y + cr.h; bx = ax; by = p.side === 't' ? r.y + r.h : r.y;
          if (ax < r.x + 4 || ax > r.x + r.w - 4) continue;
        } else if (p.side === 'r' || p.side === 'l') {
          ay = by = r.y + th / 2; ax = p.side === 'r' ? cr.x + cr.w : cr.x; bx = p.side === 'r' ? r.x : r.x + r.w;
          if (ay < cr.y + 2 || ay > cr.y + cr.h - 2) continue;
        }
        const id = c.id, onRoute = R && R.nodes.has(id), minor = !R && prio(id) >= 3, col = layerColor(c.layer);
        labels.add(r, () => {
          const hov = S.hover === id || S.selected === id;
          if (ax != null) {
            ctx.strokeStyle = hov || onRoute ? T.accent : alpha(T.text, 0.55); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
            ctx.beginPath(); ctx.arc(ax, ay, 3.4, 0, 7); ctx.fillStyle = onRoute || hov ? T.accent : col; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = T.surface; ctx.stroke();
          }
          rrect(r.x, r.y, r.w, r.h, 6);
          ctx.fillStyle = alpha(T.surface, minor && !hov ? 0.88 : 0.97); ctx.fill();
          ctx.strokeStyle = hov ? T.accent : onRoute ? T.accent : minor ? alpha(T['border-strong'], 0.7) : T['border-strong'];
          ctx.lineWidth = hov ? 2 : onRoute ? 1.5 : 1; ctx.stroke();
          font(minor && !hov ? (t.f.mono ? F.mono : F.sans) : t.f, 12.5);
          ctx.fillStyle = minor && !hov ? T['text-2'] : T.text;
          ctx.fillText(t.s, r.x + 7, r.y + 15.5);
        });
        S.hits.labels.push({ ...r, node: id });
        S.pinned.add(id);
        break;
      }
    }
  }
}
// The box under the pointer gets its name even when no pin had room (drawn last, above everything),
// in the first spot around the box that covers no other label.
function drawHoverTag(world, labels) {
  const id = S.hover, c = id && world.cards[id];
  if (!c || S.pinned.has(id) || c._named === S.frame || V.k >= LOD.doc) return;
  const k = V.k, t = { s: c.title, f: isCodeName(c.title) ? F.monoBold : F.sansBold };
  const kind = KIND_NAME[c.kind] || '';
  const tw = textW(t.s, t.f, 12.5) + textW(kind, F.sans, 12) + 26, th = 24;
  const cx = X(c.x + c.w / 2), top = Y(c.y), bot = Y(c.y) + c.h * k;
  const clampX = (x) => Math.max(6, Math.min(V.W - tw - 6, x));
  const cands = [
    { x: clampX(cx - tw / 2), y: top - th - 9, ay: top }, { x: clampX(cx - 14), y: top - th - 9, ay: top }, { x: clampX(cx - tw + 14), y: top - th - 9, ay: top },
    { x: clampX(cx - tw / 2), y: bot + 9, ay: bot }, { x: clampX(cx - 14), y: bot + 9, ay: bot }, { x: clampX(cx - tw + 14), y: bot + 9, ay: bot },
    { x: clampX(cx - tw / 2), y: top - 2 * th - 14, ay: top },
  ];
  const p = cands.find((q) => q.y > 4 && q.y + th < V.H - 4 && labels.free({ x: q.x, y: q.y, w: tw, h: th }, 2)) || cands[0];
  const x = p.x, y = Math.max(4, p.y);
  ctx.strokeStyle = T.accent; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx, p.ay); ctx.lineTo(Math.max(x + 8, Math.min(x + tw - 8, cx)), y < p.ay ? y + th : y); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, p.ay, 3.4, 0, 7); ctx.fillStyle = T.accent; ctx.fill();
  rrect(x, y, tw, th, 7); ctx.fillStyle = T.surface; ctx.fill(); ctx.strokeStyle = T.accent; ctx.lineWidth = 2; ctx.stroke();
  font(t.f, 12.5); ctx.fillStyle = T.text; ctx.fillText(t.s, x + 8, y + 16.5);
  font(F.sans, 12); ctx.fillStyle = T['text-2']; ctx.fillText(kind, x + tw - 10 - textW(kind, F.sans, 12), y + 16.5);
}

// ---- Minimap ----
export function renderMini(mctx, mw, mh, world, cam, viewW, viewH, route, dpr) {
  const b = world.bounds;
  const s = Math.min(mw / b.w, mh / b.h);
  const ox = (mw - b.w * s) / 2, oy = (mh - b.h * s) / 2;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.fillStyle = T.sea; mctx.fillRect(0, 0, mw, mh);
  for (const band of world.bands) { mctx.fillStyle = tint(band.layer, 1); mctx.fillRect(ox + band.x * s, oy + band.y * s, band.w * s, band.h * s); mctx.fillStyle = layerColor(band.layer); mctx.fillRect(ox + band.x * s, oy + band.y * s, 2, band.h * s); }
  const isl = world.island; mctx.fillStyle = tint('x', 1); mctx.fillRect(ox + isl.x * s, oy + isl.y * s, isl.w * s, isl.h * s);
  for (const id in world.cards) { const c = world.cards[id]; mctx.fillStyle = route && route.nodes.has(id) ? T.accent : alpha(layerColor(c.layer), 0.55); mctx.fillRect(ox + c.x * s, oy + c.y * s, Math.max(1, c.w * s), Math.max(1, c.h * s)); }
  const vx = ox + cam.x * s, vy = oy + cam.y * s, vw = (viewW / cam.k) * s, vh = (viewH / cam.k) * s;
  mctx.fillStyle = alpha(T.accent, 0.12); mctx.fillRect(vx, vy, vw, vh);
  mctx.strokeStyle = T.accent; mctx.lineWidth = 1.5; mctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.max(3, vw), Math.max(3, vh));
  return { s, ox, oy };
}
