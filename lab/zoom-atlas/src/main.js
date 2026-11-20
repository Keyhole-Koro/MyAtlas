// ズームする地図: one canvas, Google-Maps-like, with semantic zoom from layers down to lines of code.
import { readTheme, onTheme, T } from './theme.js';
import {
  NODES, IDS, FLOWS, PAPERS, CODE, CROSS, intoPaper, boxOf, stepOrder, cardForLine, usersOf, PAPER_PARENT,
} from './model.js';
import { loadSources, stepSpot } from './code.js';
import { buildCard, buildWorld, buildRoutes, bezier } from './layout.js';
import { render, renderMini, setFigureImages, LOD } from './render.js';
import {
  cam, setView, setBounds, toWorld, wheelZoom, zoomAt, panBy, startInertia, flyTo, fitCam, step as camStep, stopAll, busy, LIMIT,
} from './camera.js';
import * as UI from './ui.js';
import { SANS } from './text.js';
import { EVENTS, NODE_EVENTS } from './trace.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#world'), ctx = canvas.getContext('2d');
const mini = $('#mini'), mctx = mini.getContext('2d');
const stage = $('#stage');

const state = {
  flowId: null, step: 0, playing: false, follow: true, paper: null, trace: null,
  overlays: { context: false, contract: false, policy: true, trace: false },
};
// What the renderer reads.
const R = {
  world: null, overlays: state.overlays, route: null, hover: null, selected: null, pulse: null, codeLine: null,
  paperStep: null, contractFocus: null, contractUsers: {}, dimOthers: true, hits: { badges: [], labels: [] },
};
let world = null;
const cards = {};
const routes = {};
let W = 1, H = 1, dpr = 1, dirty = true, miniGeo = null, playNext = 0, traceNext = 0;
const markDirty = () => { dirty = true; };

const app = {
  state, R,
  instant: false,
  setFlow, goStep, stepBy, togglePlay, enterPaper, leavePaper, showStepCode, fitFlow, fitAll, fitBand, fitGroup,
  flyToNode, zoomBy, zoomLevel, setOverlay, paperOf, startTrace, stopTrace, traceGo, traceStep, traceTogglePlay,
  setCam(x, y, k) { stopAll(); cam.x = x; cam.y = y; cam.k = k; markDirty(); },
  get world() { return world; }, cam,
  _draw: () => draw(),
};
// Less motion when the system asks for it: no flights, cuts instead.
try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) app.instant = true; } catch (e) { /* old browsers */ }
let readyResolve;
app.ready = new Promise((r) => { readyResolve = r; });
window.zoomAtlas = app;

// ---------------------------------------------------------------------------
async function init() {
  readTheme();
  try { await document.fonts.ready; } catch (e) { /* system fonts only */ }
  await loadSources(Object.keys(CODE.files));
  for (const id of IDS) {
    const c = buildCard(id);
    c.items.sort((a, b) => (b.under ? 1 : 0) - (a.under ? 1 : 0));
    cards[id] = c;
  }
  world = buildWorld(cards);
  R.world = world;
  setBounds(world.bounds);
  for (const id of IDS) if (NODES[id].layer === 'contract') R.contractUsers[id] = usersOf(id);
  R.flowNodes = new Set(FLOWS.flatMap((f) => f.boxes.map((b) => b.node)));
  makeFigures();
  onTheme(() => { makeFigures(); UI.renderTour(app); markDirty(); });

  UI.buildFlowSeg(app);
  UI.buildLayersMenu(app);
  UI.buildSearch(app);
  UI.bindTour(app);
  UI.bindCrumb(app);
  UI.buildLadder(app);
  UI.renderTour(app);
  resize();
  new ResizeObserver(() => { resize(); markDirty(); }).observe(stage);
  fitAll(true);
  bindPointer();
  bindKeys();
  bindMini();
  requestAnimationFrame(frame);
  document.body.dataset.ready = '1';
  readyResolve();
}

function makeFigures() {
  setFigureImages((store) => {
    for (const id of IDS) {
      const n = NODES[id];
      if (!n.figure) continue;
      const vb = /viewBox="([\d.\s-]+)"/.exec(n.figure);
      const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 640, 200];
      const css = `.z-cell{fill:${T['surface-2']};stroke:${T['border-strong']};stroke-width:1.5}.z-acc{fill:${T['accent-soft']};stroke:${T.accent};stroke-width:1.5}`
        + `.z-t{fill:${T.text};font:600 14px ${SANS}}.z-s{fill:${T['text-2']};font:400 12px ${SANS}}.z-a{fill:${T.accent}}.z-b{fill:${T.dark ? '#f0a35e' : '#d9822b'}}`
        + `.z-on{fill:${T['accent-text']};font:700 12px ${SANS}}.z-tick{stroke:${T['text-2']};stroke-dasharray:3 3}.z-line{fill:none;stroke:${T['text-2']};stroke-width:1.5}`;
      const svg = n.figure.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${vw * 3}" height="${vh * 3}" `).replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
      // drawn once into a bitmap: scaling a bitmap is cheap, re-rendering an SVG at every zoom is not
      const img = new Image();
      const fig = { ready: false, cv: null };
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || vw * 3; cv.height = img.naturalHeight || vh * 3;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        fig.cv = cv; fig.ready = true;
        markDirty();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      store[id] = fig;
    }
  });
}

function buildHint() {
  const h = $('#hint');
  if (localStorage.getItem('zoom-atlas-hint') === 'off') { h.hidden = true; return; }
  h.innerHTML = `<button class="x" type="button" aria-label="閉じる">×</button><b>ホイール・ピンチ</b>で寄る／離れる。<b>ドラッグ</b>で動かす。<b>箱を押す</b>と、その箱に寄る。寄るほど中身が出て、いちばん奥はコード。<b>/</b> で探す。`;
  h.querySelector('.x').addEventListener('click', () => { h.hidden = true; try { localStorage.setItem('zoom-atlas-hint', 'off'); } catch (e) { /* private mode */ } });
}

function resize() {
  W = stage.clientWidth; H = stage.clientHeight; dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  setView(W, H);
  if (world) {
    const b = world.bounds, mw = 210;
    const mh = Math.round(Math.min(150, mw * (b.h / b.w)));
    mini.style.width = mw + 'px'; mini.style.height = mh + 'px';
    mini.width = mw * dpr; mini.height = mh * dpr;
    mini._w = mw; mini._h = mh;
  }
  markDirty();
}
const phone = () => W < 700;
// The part of the screen not covered by the chrome.
function safe() {
  const tour = $('#tour');
  const tb = tour && !tour.hidden ? tour.offsetHeight + (phone() ? 16 : 30) : 20;
  if (phone()) return { l: 30, t: 48, r: 14, b: tb };
  return { l: 52, t: cam.k < 0.2 ? 20 : 58, r: 124, b: tb };
}

// ---------------------------------------------------------------------------
function frame(now) {
  const moving = camStep(now);
  let anim = moving;
  const r = R.route;
  if (r && r.dotT != null && r.dotT < 1) { r.dotT = Math.min(1, (now - r.dot0) / r.dotDur); anim = true; }
  if (R.paperStep && R.paperStep.t < 1) { R.paperStep.t = Math.min(1, (now - R.paperStep.t0) / 1000); anim = true; }
  if (R.pulse) anim = true;
  if (state.playing && now >= playNext && !busy()) advancePlay(now);
  if (state.trace && state.trace.playing && now >= traceNext) {
    const i = state.trace.i + 1;
    if (i >= EVENTS.length) { state.trace.playing = false; UI.renderTour(app); }
    else { traceGo(i); traceNext = now + (EVENTS[i].n ? 420 : 110); }
  }
  if (R.trace) anim = true;
  if (anim || dirty) { draw(); dirty = false; }
  requestAnimationFrame(frame);
}
let crumbAt = 0;
function chromeRects() {
  const sr = stage.getBoundingClientRect();
  const out = [];
  for (const el of [...document.querySelectorAll('#crumb .c'), $('#ladder'), $('#miniWrap'), $('#tour')]) {
    if (!el || el.hidden || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push({ x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height });
  }
  return out;
}
function draw() {
  const intro = !state.flowId && !state.trace;
  $('#tour').classList.toggle('compact', intro && cam.k > 0.3);
  R.chrome = chromeRects();
  render(ctx, { x: cam.x, y: cam.y, k: cam.k, W, H, dpr }, R);
  if (mini._w && getComputedStyle($('#miniWrap')).display !== 'none') miniGeo = renderMini(mctx, mini._w, mini._h, world, cam, W, H, R.route, dpr);
  UI.renderStrip(world, cam, W, H);
  UI.syncLadder(cam.k);
  const now = performance.now();
  if (now - crumbAt > 120) { crumbAt = now; UI.renderCrumb(app, whereIs()); }
}

// What sits at the middle of the free screen.
function whereIs() {
  const s = safe();
  const p = toWorld(s.l + (W - s.l - s.r) / 2, s.t + (H - s.t - s.b) / 2);
  const out = { far: cam.k < 0.2 };
  const band = world.bands.find((b) => p.y >= b.y && p.y <= b.y + b.h && p.x >= b.x && p.x <= b.x + b.w);
  const part = world.island.parts.find((q) => p.y >= q.y && p.y <= q.y + q.h && p.x >= q.x && p.x <= q.x + q.w);
  if (band) out.band = band.layer; else if (part) out.band = part.layer;
  if (cam.k >= 0.14) {
    const gi = world.groups.findIndex((g) => p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h);
    if (gi >= 0) { out.group = world.groups[gi]; out.groupIndex = gi; }
  }
  if (cam.k >= 0.3) {
    const c = cardAt(p.x, p.y);
    if (c) out.card = c.id;
  }
  return out;
}
function cardAt(x, y) {
  for (const id in world.cards) { const c = world.cards[id]; if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c; }
  return null;
}

// ---------------------------------------------------------------------------
// Camera actions
function go(target, opts = {}) { flyTo(target, { instant: app.instant || opts.instant, ...opts }); markDirty(); }
function fitAll(instant) {
  const b = world.bounds, m = 120;
  // a phone, or a tablet held upright: tall, so the layers fill its height (the island is a swipe away)
  if (phone() || (H > W * 1.1 && W < 1100)) {
    // a phone is tall: fill its height with the stacked layers, centred on the boxes the flows pass
    const s = safe(), ah = H - s.t - s.b;
    const k = ah / (world.stackH + 2 * m);
    const fl = unionHeads([...R.flowNodes].map((id) => world.cards[id]));
    go({ cx: fl.x + fl.w / 2, cy: world.stackH / 2, k, sx: s.l + (W - s.l - s.r) / 2, sy: s.t + ah / 2 }, { instant });
    return;
  }
  go(fitCam({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, safe()), { instant });
}
function fitBand(layer) {
  const b = world.bands.find((x) => x.layer === layer) || world.island.parts.find((x) => x.layer === layer);
  if (b) go(fitCam({ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }, safe(), 1.2));
}
function fitGroup(i) {
  const g = world.groups[i];
  if (g) go(fitCam({ x: g.x - 40, y: g.y - 40, w: g.w + 80, h: g.h + 80 }, safe(), 1.2));
}
function flyToNode(id, opts = {}) {
  const c = world.cards[id];
  if (!c) return;
  const s = safe();
  const aw = W - s.l - s.r, ah = H - s.t - s.b;
  let k = phone() ? Math.min(1.0, (W - 34) / (c.w + 14)) : Math.min(1.2, aw / (c.w + 160));
  k = Math.max(k, phone() ? 0.4 : LOD.doc + 0.04);
  const viewH = ah / k;
  const cx = c.x + c.w / 2;
  const cy = c.h + 70 <= viewH ? c.y + c.h / 2 : c.y - 34 + viewH / 2;
  if (opts.select) R.selected = id;
  go({ cx, cy, k, sx: s.l + aw / 2, sy: s.t + ah / 2 }, { done: () => { if (opts.pulse) { R.pulse = { id, t0: performance.now() }; } markDirty(); } });
  if (opts.pulse && app.instant) R.pulse = { id, t0: performance.now() };
}
function zoomBy(f) {
  const s = safe();
  const sx = s.l + (W - s.l - s.r) / 2, sy = s.t + (H - s.t - s.b) / 2;
  wheelZoom(sx, sy, f);
  markDirty();
}
function zoomLevel(id) {
  if (id === 'all') return fitAll();
  const lv = UI.LEVELS.find((l) => l.id === id);
  const s = safe();
  const sx = s.l + (W - s.l - s.r) / 2, sy = s.t + (H - s.t - s.b) / 2;
  const p = toWorld(sx, sy);
  // never into empty sea: the box nearest the middle of the screen (or the chosen one) is where it goes
  const c = targetCard(id === 'code');
  if (!c) return go({ cx: p.x, cy: p.y, k: lv.k, sx, sy });
  if (id === 'parts') {
    if (cardAt(p.x, p.y) || world.groups.some((g) => p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h)) return go({ cx: p.x, cy: p.y, k: lv.k, sx, sy });
    return go({ cx: c.x + c.w / 2, cy: c.y + Math.min(c.h / 2, 260), k: lv.k, sx, sy });
  }
  if (id === 'inside') return flyToNode(c.id);
  flyToCode(c);
}
// The box a level button goes to: the selected one when it is on screen, else the one nearest the middle.
function targetCard(needCode) {
  const ok = (c) => c && (!needCode || c.codeBox);
  const s = safe(), mx = s.l + (W - s.l - s.r) / 2, my = s.t + (H - s.t - s.b) / 2;
  const scr = (c) => ({ x: (c.x - cam.x) * cam.k, y: (c.y - cam.y) * cam.k, w: c.w * cam.k, h: c.h * cam.k });
  const sel = R.selected && world.cards[R.selected];
  if (ok(sel)) { const r = scr(sel); if (r.x < W && r.y < H && r.x + r.w > 0 && r.y + r.h > 0) return sel; }
  let best = null, bd = Infinity;
  for (const id in world.cards) {
    const c = world.cards[id];
    if (!ok(c)) continue;
    const r = scr(c);
    // for the code level, a box with a few lines of its own reads better than a one-line one
    const short = needCode && c.codeBox.end - c.codeBox.start < 4 ? 120 : 0;
    const d = Math.hypot(Math.max(r.x - mx, 0, mx - r.x - r.w), Math.max(r.y - my, 0, my - r.y - r.h)) + short;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function setOverlay(id, on) { state.overlays[id] = on; markDirty(); }

// ---------------------------------------------------------------------------
// Flows
function routeOf(fid) {
  if (!routes[fid]) {
    const f = FLOWS.find((x) => x.id === fid) || PAPERS[fid];
    const steps = buildRoutes(world, f);
    routes[fid] = { f, steps, nodes: new Set(f.boxes.map((b) => b.node)) };
  }
  return routes[fid];
}
function setFlow(fid) {
  state.playing = false;
  state.paper = null;
  R.paperStep = null;
  if (state.trace) { state.trace = null; R.trace = null; }
  if (!fid) {
    state.flowId = null; R.route = null; R.codeLine = null;
    UI.syncFlowSeg(app); UI.renderTour(app); markDirty();
    fitAll();
    return;
  }
  state.flowId = fid;
  const r = routeOf(fid);
  R.route = { ...r, cur: null, dotT: null };
  UI.syncFlowSeg(app);
  // a flow opens at its first step; the data's `start` stays marked as the featured step
  goStep(stepOrder(r.f)[0], { noFly: true });
  fitFlow();
}
function fitFlow() {
  if (!R.route) return;
  if (state.paper) return flyToPaper(state.paper.pid, state.paper.i);
  const ids = [...R.route.nodes];
  const rect = unionHeads(ids.map((id) => world.cards[id]));
  go(fitCam(pad(rect, 150), safe(), 0.8));
}
function unionHeads(cs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cs) { if (!c) continue; x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + Math.min(c.h, 260)); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const pad = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

function goStep(i, opts = {}) {
  if (state.paper) return goPaperStep(i, opts);
  const r = R.route;
  if (!r) return;
  state.step = i;
  r.cur = r.steps[i];
  r.dotT = 0; r.dot0 = performance.now(); r.dotDur = 1100; r.chipSide = null;
  const sc = stepSpot(state.flowId, i);
  R.codeLine = sc ? { path: sc.path, line: sc.line } : null;
  if (opts.user) state.playing = false;
  if (state.follow && !opts.noFly && r.cur && r.cur.pts) {
    const s = r.cur;
    let rect = unionHeads([s.a, s.b]);
    for (let t = 0; t <= 1; t += 0.25) { const p = bezier(s.pts, t); rect = { x: Math.min(rect.x, p.x), y: Math.min(rect.y, p.y), w: 0, h: 0, x1: Math.max(rect.x + rect.w, p.x), y1: Math.max(rect.y + rect.h, p.y) }; rect.w = rect.x1 - rect.x; rect.h = rect.y1 - rect.y; }
    go(fitCam(pad(rect, 90), safe(), 0.85, 0.12), { speed: 0.8, max: 1300 });
  }
  UI.renderTour(app);
  markDirty();
}
function stepBy(d) {
  const f = state.paper ? PAPERS[state.paper.pid] : R.route && R.route.f;
  if (!f) return;
  const order = stepOrder(f);
  const cur = state.paper ? state.paper.i : state.step;
  const j = order.indexOf(cur) + d;
  if (j >= 0 && j < order.length) goStep(order[j], { user: true });
}
function togglePlay() {
  if (!state.flowId) return;
  state.playing = !state.playing;
  if (state.playing) {
    const f = state.paper ? PAPERS[state.paper.pid] : R.route.f;
    const order = stepOrder(f).filter((j) => !f.steps[j].alt);
    const cur = state.paper ? state.paper.i : state.step;
    if (order.indexOf(cur) === order.length - 1 || order.indexOf(cur) < 0) goStep(order[0]);
    playNext = performance.now() + 1500;
  }
  UI.renderTour(app);
}
function advancePlay(now) {
  const f = state.paper ? PAPERS[state.paper.pid] : R.route.f;
  const order = stepOrder(f).filter((j) => !f.steps[j].alt);
  const cur = state.paper ? state.paper.i : state.step;
  const j = order.indexOf(cur);
  if (j < 0 || j >= order.length - 1) {
    if (state.paper) { leavePaper(true); playNext = now + 1600; return; }
    state.playing = false; UI.renderTour(app); return;
  }
  goStep(order[j + 1]);
  playNext = now + 2600;
}

// ---------------------------------------------------------------------------
// Papers: zoom into the card that holds them.
function paperOf(i) {
  const r = R.route;
  if (!r) return null;
  return intoPaper(r.f, r.f.steps[i]);
}
function enterPaper() {
  let pid = null;
  if (state.paper) {
    const P = PAPERS[state.paper.pid], s = P.steps[state.paper.i];
    pid = intoPaper(P, s);
  } else pid = paperOf(state.step);
  if (!pid) return;
  const stack = state.paper ? [...state.paper.stack, { pid: state.paper.pid, i: state.paper.i }] : [];
  const P = PAPERS[pid];
  state.paper = { pid, i: stepOrder(P)[0], stack };
  if (R.route) R.route.hidden = true;
  R.codeLine = null;
  flyToPaper(pid, state.paper.i);
  goPaperStep(state.paper.i, { noFly: true });
  UI.toast(`中の紙「${P.tab} の中」に入った。Esc で外へ`);
}
function flyToPaper(pid, i) {
  const parent = PAPER_PARENT[pid], c = world.cards[parent];
  if (!c || !c.paper) return;
  const p = c.paper;
  const rect = { x: c.x + p.x - 20, y: c.y + p.y - 64, w: p.w + 40, h: p.h + 84 };
  const fit = fitCam(rect, safe(), 2.4, 0.6);
  // too narrow for the whole paper at a size its words read (a phone): fly to the step's boxes instead
  if (fit.k < PAPER_READ) return flyToPaperStep(pid, i != null ? i : stepOrder(PAPERS[pid])[0], true);
  go(fit, { speed: 0.9, max: 1700 });
}
// The paper's words are 9.6 world units: they read (11px or more) from this zoom on.
const PAPER_READ = 11.6 / 9.6;
function flyToPaperStep(pid, i, force) {
  const parent = PAPER_PARENT[pid], c = world.cards[parent];
  if (!c || !c.paper) return;
  const p = c.paper, st = p.steps.find((q) => q.i === i);
  if (!st) return;
  const ox = c.x + p.x, oy = c.y + p.y;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of p.boxes) if (b.id === st.from || b.id === st.to) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  for (const q of st.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const rect = { x: ox + x0 - 16, y: oy + y0 - 24, w: x1 - x0 + 32, h: y1 - y0 + 48 };
  const s = safe(), aw = W - s.l - s.r, ah = H - s.t - s.b;
  if (!force) {
    // already readable and on screen: stay
    const sx0 = (rect.x - cam.x) * cam.k, sy0 = (rect.y - cam.y) * cam.k;
    const inView = sx0 >= s.l && sy0 >= s.t && sx0 + rect.w * cam.k <= W - s.r && sy0 + rect.h * cam.k <= H - s.b;
    if (inView && cam.k >= PAPER_READ - 0.01) return;
  }
  const k = Math.max(PAPER_READ, Math.min(2.4, aw / rect.w, ah / rect.h));
  go({ cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, k, sx: s.l + aw / 2, sy: s.t + ah / 2 }, { speed: 0.9, max: 1100 });
}
function goPaperStep(i, opts = {}) {
  const P = PAPERS[state.paper.pid];
  state.paper.i = i;
  const s = P.steps[i];
  R.paperStep = { pid: state.paper.pid, i, boxes: [s.from, s.to], t: 0, t0: performance.now() };
  const sc = stepSpot(state.paper.pid, i);
  R.codeLine = sc ? { path: sc.path, line: sc.line } : null;
  if (opts.user) state.playing = false;
  // keep the step's boxes in view at a size where the paper's words read (on a phone, always)
  if (!opts.noFly) flyToPaperStep(state.paper.pid, i, false);
  UI.renderTour(app);
  markDirty();
}
function leavePaper(fromPlay) {
  if (!state.paper) return;
  if (state.paper.stack.length) {
    const prev = state.paper.stack.pop();
    state.paper = { pid: prev.pid, i: prev.i, stack: state.paper.stack };
    flyToPaper(prev.pid, prev.i);
    goPaperStep(prev.i, { noFly: true });
    return;
  }
  state.paper = null;
  R.paperStep = null;
  if (R.route) R.route.hidden = false;
  goStep(state.step, { user: !fromPlay });
}

// ---------------------------------------------------------------------------
// The recorded run, replayed on the map.
function startTrace() {
  if (!EVENTS.length) return;
  setFlow(null);
  // on a phone the whole run is too small to follow: the camera follows from the start
  state.trace = { i: NODE_EVENTS[0] || 0, playing: false, follow: phone() };
  R.trace = state.trace;
  UI.syncFlowSeg(app);
  UI.renderTour(app);
  const ids = [...new Set(NODE_EVENTS.map((i) => EVENTS[i].n))];
  if (state.trace.follow) traceGo(state.trace.i);
  else go(fitCam(pad(unionHeads(ids.map((id) => world.cards[id])), 160), safe(), 0.8));
  markDirty();
}
function stopTrace() { state.trace = null; R.trace = null; UI.renderTour(app); fitAll(); markDirty(); }
function traceGo(i, opts = {}) {
  if (!state.trace) return;
  state.trace.i = Math.max(0, Math.min(EVENTS.length - 1, i));
  state.trace.t0 = performance.now();
  if (opts.user) state.trace.playing = false;
  const e = EVENTS[state.trace.i];
  if (state.trace.follow && e.n && world.cards[e.n]) {
    const c = world.cards[e.n];
    go({ cx: c.x + c.w / 2, cy: c.y + 120, k: Math.max(cam.k, 0.35) }, { max: 500, min: 260 });
  }
  UI.updateTraceTour(app);
  markDirty();
}
function traceStep(d) {
  if (!state.trace) return;
  // jump to the next (or previous) event that belongs to a box on the map
  const list = NODE_EVENTS, cur = state.trace.i;
  const j = d > 0 ? list.find((x) => x > cur) : [...list].reverse().find((x) => x < cur);
  traceGo(j == null ? (d > 0 ? EVENTS.length - 1 : 0) : j, { user: true });
}
function traceTogglePlay() {
  if (!state.trace) return;
  state.trace.playing = !state.trace.playing;
  if (state.trace.playing && state.trace.i >= EVENTS.length - 1) traceGo(0);
  traceNext = performance.now() + 200;
  UI.renderTour(app);
}

// The line of code where a step happens, at a zoom where code reads.
function showStepCode() {
  const fid = state.paper ? state.paper.pid : state.flowId;
  const i = state.paper ? state.paper.i : state.step;
  const sc = stepSpot(fid, i);
  if (!sc) return;
  const f = state.paper ? PAPERS[fid] : R.route.f;
  const st = f.steps[i];
  const id = cardForLine(sc.path, sc.line, [sc.node, st.ref, boxOf(f, st.from).node, boxOf(f, st.to).node]);
  const c = id && world.cards[id];
  if (!c || !c.codeBox) return;
  R.codeLine = { path: sc.path, line: sc.line };
  flyToCode(c, sc.line);
}
// A card's code, at a zoom where it reads: a given line a little above the middle, or the code's top.
function flyToCode(c, line) {
  const ln = line != null ? c.codeBox.lines.find((l) => l.no === line) : null;
  const s = safe();
  const aw = W - s.l - s.r, ah = H - s.t - s.b;
  const k = phone() ? 4.2 : Math.max(4.4, Math.min(5.2, aw / (c.codeBox.w + 20)));
  // the left edge of the code at the left of the free screen
  const left = c.x + c.codeBox.x;
  const fitsAll = c.codeBox.w * k <= aw;
  const cx = fitsAll ? left + c.codeBox.w / 2 : left + (aw / 2 - 10) / k;
  if (ln) go({ cx, cy: c.y + ln.y + c.codeBox.lh / 2, k, sx: s.l + aw / 2, sy: s.t + ah * 0.42 }, { max: 1800 });
  else go({ cx, cy: c.y + c.codeBox.y, k, sx: s.l + aw / 2, sy: (phone() ? 56 : 72) }, { max: 1800 });
}

// ---------------------------------------------------------------------------
// Pointer: drag to pan (with inertia), wheel and pinch to zoom, click to go.
function bindPointer() {
  const pts = new Map();
  let drag = null, pinch = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    pts.set(e.pointerId, p);
    stopAll();
    if (pts.size === 1) drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false, samples: [{ ...p, t: performance.now() }] };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!pts.has(e.pointerId)) { hover(p); return; }
    pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(m.x, m.y, d / Math.max(1, pinch.d));
      panBy(m.x - pinch.m.x, m.y - pinch.m.y);
      pinch = { d, m };
      markDirty();
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 4) { drag.moved = true; canvas.classList.add('dragging'); }
    if (drag.moved) { panBy(p.x - drag.x, p.y - drag.y); markDirty(); }
    drag.x = p.x; drag.y = p.y;
    const now = performance.now();
    drag.samples.push({ ...p, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 90) drag.samples.shift();
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    canvas.classList.remove('dragging');
    if (drag.moved) {
      const s = drag.samples, a = s[0], b = s[s.length - 1], dt = Math.max(1, b.t - a.t);
      if (performance.now() - b.t < 60) startInertia((b.x - a.x) / dt, (b.y - a.y) / dt);
    } else if (e.type === 'pointerup') click(drag.x0, drag.y0);
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 18; else if (e.deltaMode === 2) dy *= H;
    const p = pos(e);
    wheelZoom(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0024)));
    markDirty();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const p = pos(e), a = toWorld(p.x, p.y);
    go({ cx: a.x, cy: a.y, k: cam.k * (e.shiftKey ? 0.5 : 2.2), sx: p.x, sy: p.y }, { min: 350, max: 600 });
  });
  canvas.addEventListener('pointerleave', () => { if (R.hover || R.contractFocus) { R.hover = null; R.contractFocus = null; markDirty(); } });
}
const inR = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
function linkAt(c, w) {
  if (cam.k < LOD.doc - 0.05) return null;
  const lx = w.x - c.x, ly = w.y - c.y;
  return c.links.find((L) => lx >= L.x && lx <= L.x + L.w && ly >= L.y && ly <= L.y + L.h) || null;
}
function hover(p) {
  let cursor = '';
  let hov = null, focus = null;
  const tag = R.hits.labels.find((b) => inR(p, b));
  if (R.hits.badges.some((b) => inR(p, b)) || tag) {
    cursor = 'pointing';
    // a name tag lights up the box it points at
    if (tag && tag.node && world.cards[tag.node]) hov = tag.node;
  } else {
    const w = toWorld(p.x, p.y);
    const c = cardAt(w.x, w.y);
    if (c) {
      if (cam.k < LOD.doc - 0.05) { cursor = 'pointing'; hov = c.id; }
      else if (linkAt(c, w)) cursor = 'pointing';
      if (NODES[c.id].layer === 'contract') focus = c.id;
    }
  }
  canvas.classList.toggle('pointing', cursor === 'pointing');
  if (hov !== R.hover || focus !== R.contractFocus) { R.hover = hov; R.contractFocus = focus; markDirty(); }
}
function click(sx, sy) {
  const p = { x: sx, y: sy };
  const badge = R.hits.badges.find((b) => inR(p, b));
  if (badge) return goStep(badge.step, { user: true });
  const lab = R.hits.labels.find((b) => inR(p, b));
  if (lab) return lab.node ? flyToNode(lab.node, { pulse: true, select: true }) : fitBand(lab.band);
  const w = toWorld(sx, sy);
  const c = cardAt(w.x, w.y);
  if (c) {
    const L = linkAt(c, w);
    if (L) {
      if (L.pid && state.paper && state.paper.pid === L.pid) {
        const P = PAPERS[L.pid];
        const j = P.steps.findIndex((s) => s.from === L.paperBox || s.to === L.paperBox);
        if (j >= 0) return goPaperStep(j, { user: true });
      }
      return flyToNode(L.id, { pulse: true, select: true });
    }
    if (cam.k >= LOD.doc - 0.05) { R.selected = c.id; markDirty(); return; }
    return flyToNode(c.id, { select: true });
  }
  const gi = world.groups.findIndex((g) => w.x >= g.x && w.x <= g.x + g.w && w.y >= g.y && w.y <= g.y + g.h);
  if (gi >= 0 && cam.k < 0.5) return fitGroup(gi);
  const band = world.bands.find((b) => w.y >= b.y && w.y <= b.y + b.h && w.x >= b.x && w.x <= b.x + b.w);
  if (band && cam.k < 0.25) return fitBand(band.layer);
  R.selected = null;
  markDirty();
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    // Enter and Space on a focused button press that button, nothing else
    if ((k === 'Enter' || k === ' ') && e.target.closest && e.target.closest('button, a, [role=button], label')) return;
    if (k === '/') { e.preventDefault(); $('#q').focus(); return; }
    if (k === 'Escape') { if (state.paper) leavePaper(); else if (R.selected) { R.selected = null; markDirty(); } else if (state.trace) stopTrace(); else if (state.flowId) setFlow(null); return; }
    if (state.trace && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); traceStep(k === 'ArrowRight' ? 1 : -1); return; }
    if (state.trace && k === ' ') { e.preventDefault(); traceTogglePlay(); return; }
    if (state.flowId && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); stepBy(k === 'ArrowRight' ? 1 : -1); return; }
    if (state.flowId && k === 'Enter') { e.preventDefault(); enterPaper(); return; }
    if (state.flowId && k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === '+' || k === '=') { zoomBy(1.6); return; }
    if (k === '-' || k === '_') { zoomBy(1 / 1.6); return; }
    if (k === '0') { fitAll(); return; }
    const pan = { ArrowLeft: [160, 0], ArrowRight: [-160, 0], ArrowUp: [0, 160], ArrowDown: [0, -160] }[k];
    if (pan) { e.preventDefault(); panBy(pan[0], pan[1]); markDirty(); }
  });
}

function bindMini() {
  let down = false;
  const goMini = (e) => {
    if (!miniGeo) return;
    const r = mini.getBoundingClientRect();
    const wx = (e.clientX - r.left - miniGeo.ox) / miniGeo.s, wy = (e.clientY - r.top - miniGeo.oy) / miniGeo.s;
    stopAll();
    cam.x = wx - W / 2 / cam.k; cam.y = wy - H / 2 / cam.k;
    markDirty();
  };
  mini.addEventListener('pointerdown', (e) => { down = true; mini.setPointerCapture(e.pointerId); goMini(e); });
  mini.addEventListener('pointermove', (e) => { if (down) goMini(e); });
  mini.addEventListener('pointerup', () => { down = false; });
}

init().catch((e) => { console.error(e); document.body.dataset.ready = 'error'; });
