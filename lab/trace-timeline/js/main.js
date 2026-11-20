import { buildModel, stepHits, causeJa, absentWhy } from "./model.js";

const ATLAS = window.ATLAS, CODE = window.ATLAS_CODE || { nodes: {}, files: {}, steps: {} }, RAW = window.TRACE_FULL;
const $ = (s, r = document) => r.querySelector(s);

// A small DOM builder. Strings become text nodes, so data never turns into markup.
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

if (!RAW) {
  document.body.prepend(h("p", { class: "banner" }, "data/trace-full.js が無い。tools/build-trace.mjs で作る。"));
  throw new Error("no TRACE_FULL");
}

const M = buildModel(ATLAS, RAW);
const S = M.slices;
const NODES = ATLAS.nodes;
const LAYER = Object.fromEntries(ATLAS.layers.map((l) => [l.id, l]));
const fmt = (n) => Math.round(n).toLocaleString("ja-JP");
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const LAYER_NAME = { app: "アプリ", lib: "ライブラリ", os: "OS サービス", kernel: "カーネル", emu: "エミュレータ", unknown: "層が分からない", none: "記録外" };
const short = (x) => (x && x.includes(".") ? x.slice(x.lastIndexOf(".") + 1) : x);
const thread = (tid) => M.threadById.get(tid);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- theme
const C = {};
let DARK = false;
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bg", "surface", "surface2", "ink", "ink2", "muted", "grid", "line", "accent", "accent-soft", "l-app", "l-lib", "l-os", "l-kernel", "l-emu", "l-unknown", "l-none", "on-fill", "run", "font", "mono"]) {
    C[k] = cs.getPropertyValue("--" + k).trim();
  }
  DARK = matchMedia("(prefers-color-scheme: dark)").matches;
}
const rgb = (hex) => { const x = hex.replace("#", ""); const n = parseInt(x.length === 3 ? x.replace(/./g, "$&$&") : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (a, b, t) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; };
const alpha = (hex, a) => `rgba(${rgb(hex).join(",")},${a})`;
const layerColor = (l) => C["l-" + (l || "unknown")] || C["l-unknown"];
function fillOf(s) {
  const base = layerColor(s.layer);
  return s.inferred ? mixHex(base, C.surface, DARK ? 0.6 : 0.66) : base;
}
const inkOf = (s) => (s.inferred ? C.ink : C["on-fill"]);

// ---------------------------------------------------------------- the time axis
// Instructions are the time. "記録外を詰める" squeezes the long stretches in which the running thread
// had no recorded function open, each to a fixed width, so the rest of the run can be read at once.
// A phase shorter than PHASE_MIN of the squeezed width is widened to it (phase 1, the key interrupt,
// is 3,509 instructions), so every phase can be seen and chosen.
const GAP_MIN = 15000, GAP_KEEP = 600, GAP_W = 7000, PHASE_MIN = 0.05;
const NONE_RUNS = (() => {
  const runs = [];
  for (const [a, b, id] of M.segs) {
    if (id >= 0) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === a) last[1] = b; else runs.push([a, b]);
  }
  return runs.filter(([a, b]) => b - a >= GAP_MIN);
})();
const AX = (() => {
  const pts = [0];
  for (const [a, b] of NONE_RUNS) pts.push(a + GAP_KEEP, b - GAP_KEEP);
  pts.push(M.END);
  // the squeezed stretches, and the rest cut at the phase bounds
  const cuts = M.phases.map((p) => p.start).filter((x) => x > 0 && x < M.END);
  const pieces = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (i % 2 === 1) { pieces.push({ a, b, gap: true, run: NONE_RUNS[(i - 1) / 2] }); continue; }
    let x = a;
    for (const c of cuts) if (c > x && c < b) { pieces.push({ a: x, b: c, gap: false, run: null }); x = c; }
    pieces.push({ a: x, b, gap: false, run: null });
  }
  const phaseAt = (i) => M.phases.find((p) => i >= p.start && i < p.end) || M.phases[M.phases.length - 1];
  const width = (g) => (g.gap ? GAP_W : g.b - g.a);
  const total = pieces.reduce((t, g) => t + width(g), 0);
  const per = new Map();
  for (const g of pieces) {
    const q = per.get(phaseAt(g.a).num) || { all: 0, kept: 0 };
    q.all += width(g); if (!g.gap) q.kept += g.b - g.a;
    per.set(phaseAt(g.a).num, q);
  }
  const stretch = new Map([...per].map(([num, q]) => [num, q.all < PHASE_MIN * total && q.kept > 0 ? (q.kept + PHASE_MIN * total - q.all) / q.kept : 1]));
  let vc = 0;
  const segs = pieces.map((g) => {
    const w = g.gap ? GAP_W : (g.b - g.a) * stretch.get(phaseAt(g.a).num);
    const s = { ...g, ca: vc, cb: vc + w, stretch: g.gap ? 1 : stretch.get(phaseAt(g.a).num) };
    vc += w;
    return s;
  });
  return { segs, END: M.END, CEND: vc, stretch };
})();
let mix = 1; // 1: squeezed, 0: real lengths
const segAt = (i) => { for (const g of AX.segs) if (i <= g.b) return g; return AX.segs[AX.segs.length - 1]; };
function vOf(i) {
  const g = segAt(i);
  const c = g.ca + (g.b > g.a ? (i - g.a) / (g.b - g.a) : 0) * (g.cb - g.ca);
  return i + mix * (c - i);
}
function iOf(v) {
  for (const g of AX.segs) {
    const va = g.a + mix * (g.ca - g.a), vb = g.b + mix * (g.cb - g.b);
    if (v <= vb || g === AX.segs[AX.segs.length - 1]) return g.a + (vb > va ? Math.max(0, v - va) / (vb - va) : 0) * (g.b - g.a);
  }
  return M.END;
}
const vTotal = () => AX.END + mix * (AX.CEND - AX.END);
const MIN_SPAN = 60;

// ---------------------------------------------------------------- state
const state = {
  v0: 0, v1: 1, hover: null, sel: null, node: null, focus: null, phase: null, tab: "scene",
  flow: "ui", step: null, collapsed: new Set(M.threads.filter((t) => t.kind !== "app" && t.count < 40).map((t) => t.tid)),
  path: null, showLinks: true, listSort: "dur", listThread: "all", listLayer: "all", brush: null, cross: null, playing: false,
  fold: true, // "要所だけ": an interrupt or syscall is one bar, and only the map's calls stay outside them
};
// What is drawn, and on which row, depends on the fold.
const shown = (s) => !state.fold || s.kept;
const dep = (s) => (state.fold ? s.fdepth : s.depth);
const rowsOf = (t) => Math.max(1, state.fold ? t.maxFDepth : t.maxDepth);
// the slice itself when it is drawn, else the nearest drawn caller
function visOf(s) { while (s && !shown(s)) s = s.parent === null ? null : S[s.parent]; return s; }
const hiddenInside = (s) => (state.fold ? M.helpers.descend(s, (c) => !c.kept).length : 0);
const LANDMARK = new Map(M.landmarks.map((l) => [l.id, l]));
const PINS = new Map(M.threads.map((t) => [t.tid, M.landmarks.filter((l) => S[l.id].tid === t.tid)]));

// ---------------------------------------------------------------- layout of the main canvas
const main = $("#main"), octx = $("#overview").getContext("2d"), ctx = main.getContext("2d");
const G = { gutter: 188, ruler: 30, story: 22, rowH: 18, runH: 5, top: 10, laneGap: 8, mini: 3, right: 14, pin: 24 };
let W = 800, H = 400, lanes = [];
function layout() {
  const narrow = main.parentElement.clientWidth < 620;
  G.narrow = narrow;
  G.gutter = narrow ? 12 : 188;
  G.head = narrow ? 20 : 0;
  W = main.parentElement.clientWidth;
  G.rowH = state.fold ? 20 : 18; // fewer rows when folded: a little more air
  let y = G.ruler + G.story + 6;
  lanes = M.threads.map((t) => {
    const collapsed = state.collapsed.has(t.tid);
    const rows = rowsOf(t);
    const body = collapsed ? rows * G.mini + 4 : rows * G.rowH;
    const top = y + G.head;
    const pins = PINS.get(t.tid).length ? G.pin : 0;
    // the names on the left need about 96px for an open lane with its layer bar
    const minH = narrow ? 0 : collapsed ? 38 : 98;
    const lane = { t, collapsed, y, pinY: top + 1, runY: top + pins + 2, rowsY: top + pins + 2 + G.runH + 5, h: G.head + Math.max(minH, pins + 2 + G.runH + 5 + body + 8) };
    lane.rowH = collapsed ? G.mini : G.rowH;
    y += lane.h + G.laneGap;
    return lane;
  });
  H = y + 4;
  const dpr = window.devicePixelRatio || 1;
  main.width = Math.round(W * dpr); main.height = Math.round(H * dpr);
  main.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ov = $("#overview"), ow = ov.parentElement.clientWidth - (narrow ? 24 : 32);
  ov.width = Math.round(ow * dpr); ov.height = Math.round(OV.h * dpr);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  OV.w = ow;
}
const OV = { w: 800, h: 36 };
const plotX = () => G.gutter, plotW = () => W - G.gutter - G.right;
const xOfV = (v) => plotX() + ((v - state.v0) / (state.v1 - state.v0)) * plotW();
const xOf = (i) => xOfV(vOf(i));
const vOfX = (x) => state.v0 + ((x - plotX()) / plotW()) * (state.v1 - state.v0);
const laneOf = (tid) => lanes.find((l) => l.t.tid === tid);
const rowY = (lane, depth) => lane.rowsY + depth * lane.rowH;

// ---------------------------------------------------------------- text
const tw = new Map();
function textW(s, font) {
  const k = font + "|" + s;
  let w = tw.get(k);
  if (w === undefined) { ctx.font = font; w = ctx.measureText(s).width; tw.set(k, w); }
  return w;
}
function clip(s, max, font) {
  if (textW(s, font) <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textW(s.slice(0, mid) + "…", font) <= max) lo = mid; else hi = mid - 1; }
  return lo >= 3 ? s.slice(0, lo) + "…" : null;
}
const F = {
  label: () => `600 12px ${C.font}`, labelLight: () => `12px ${C.font}`, sub: () => `11px ${C.font}`,
  tick: () => `11px ${C.font}`, gname: () => `600 13px ${C.mono}`, gsub: () => `11px ${C.font}`, flag: () => `600 11px ${C.font}`,
};

// ---------------------------------------------------------------- drawing
let raf = 0;
const requestDraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); drawOverview(); updateRange(); }); };
let hatch = null;
function makeHatch() {
  const c = document.createElement("canvas"); c.width = c.height = 8;
  const g = c.getContext("2d");
  g.strokeStyle = alpha(C.muted, DARK ? 0.3 : 0.24); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
  hatch = ctx.createPattern(c, "repeat");
}

function visibleRange() { return [iOf(state.v0), iOf(state.v1)]; }

let labelBoxes = []; // where slice labels were written in this frame: the arrows' pills avoid them
function draw() {
  labelBoxes = [];
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H);
  const [i0, i1] = visibleRange();
  const px = plotX(), pw = plotW();
  // Grid and gaps behind everything.
  drawGrid(i0, i1);
  drawGaps(i0, i1);
  // Lanes.
  ctx.save();
  ctx.beginPath(); ctx.rect(px, 0, pw, H); ctx.clip();
  for (const lane of lanes) drawLane(lane, i0, i1);
  // the pins go on top; the arrows' pills keep clear of them
  for (const lane of lanes) placePins(lane);
  if (state.showLinks) drawLinks(i0, i1);
  drawSwitches(i0, i1);
  drawRequests(i0, i1, false);
  for (const lane of lanes) paintPins(lane);
  ctx.restore();
  drawGutter();
  drawStoryTrack(i0, i1);
  drawRuler(i0, i1);
  drawRequests(i0, i1, true);
  drawCross();
  drawBrush();
}

function tickStep() { return niceStep(((state.v1 - state.v0) / plotW()) * 96); }
const inGapI = (i) => mix > 0.5 && AX.segs.some((g) => g.gap && i > g.a && i < g.b);
function drawGrid(i0, i1) {
  const step = tickStep(), px = plotX(), pw = plotW();
  ctx.fillStyle = C.grid;
  for (let k = Math.ceil(i0 / step) * step; k <= i1; k += step) {
    if (inGapI(k)) continue;
    const x = xOf(k);
    if (x >= px - 1 && x <= px + pw + 1) ctx.fillRect(Math.round(x), G.ruler, 1, H - G.ruler);
  }
}
function drawGaps(i0, i1) {
  if (mix <= 0.02) return;
  const top = G.ruler, bottom = H;
  for (const g of AX.segs) {
    if (!g.gap || g.b < i0 || g.a > i1) continue;
    const xa = xOf(g.a), xb = xOf(g.b);
    if (xb - xa < 1) continue;
    ctx.save();
    ctx.globalAlpha = mix;
    ctx.fillStyle = gapFill(); ctx.fillRect(xa, top, xb - xa, bottom - top);
    // one tear down the middle of the squeezed stretch
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    zigzag((xa + xb) / 2, top + 2, bottom - 2);
    ctx.restore();
  }
}
function zigzag(x, y0, y1) {
  ctx.beginPath();
  let y = y0, k = 0;
  ctx.moveTo(x, y);
  while (y < y1) { y += 4; k ^= 1; ctx.lineTo(x + (k ? 2.5 : -2.5), Math.min(y, y1)); }
  ctx.stroke();
}

function drawLane(lane, i0, i1) {
  const { t } = lane;
  const px = plotX(), pw = plotW();
  // lane separator
  ctx.fillStyle = C.grid; ctx.fillRect(px, lane.y + lane.h + G.laneGap / 2, pw, 1);
  // when this thread had the CPU
  ctx.fillStyle = C.run;
  for (const [a, b] of t.runs) {
    if (b < i0 || a > i1) continue;
    const xa = Math.max(px - 2, xOf(a)), xb = Math.min(px + pw + 2, xOf(b));
    roundRect(xa, lane.runY, Math.max(1.5, xb - xa), G.runH, 2.5); ctx.fill();
  }
  for (const s of laneSlices.get(t.tid)) {
    if (s.kind !== "irq" || s.trap === "syscall" || s.start < i0 || s.start > i1) continue;
    const x = xOf(s.start), hot = state.hover?.type === "irq" && state.hover.s === s;
    ctx.fillStyle = hot ? C.accent : s.cause === "timer" ? C.muted : C.ink;
    ctx.beginPath(); ctx.moveTo(x - 4, lane.runY - 5); ctx.lineTo(x + 4, lane.runY - 5); ctx.lineTo(x, lane.runY + 1); ctx.closePath(); ctx.fill();
  }
  const focus = state.focus;
  const list = laneSlices.get(t.tid).filter((s) => shown(s) && s.end >= i0 && s.start <= i1);
  for (const s of list) drawSlice(lane, s, focus && !focus.ids.has(s.id));
  if (!lane.collapsed) for (const s of list) drawLabel(lane, s, focus && !focus.ids.has(s.id));
  // emphasis on top
  for (const s of list) {
    const isSel = state.sel === s.id, isHover = state.hover?.type === "slice" && state.hover.s === s, isFocus = focus && focus.ids.has(s.id) && focus.ring;
    const same = !isHover && state.hover?.type === "slice" && s.kind === "call" && state.hover.s.fn === s.fn;
    if (same && !lane.collapsed) {
      const [x0, x1] = sliceX(s), y = rowY(lane, dep(s));
      ctx.strokeStyle = alpha(rgbToHex(C.ink), 0.55); ctx.lineWidth = 1;
      roundRect(x0 - 0.5, y - 0.5, Math.max(2, x1 - x0 + 1), lane.rowH - 1, 3); ctx.stroke();
    }
    if (!isSel && !isHover && !isFocus) continue;
    const [x0, x1] = sliceX(s), y = rowY(lane, dep(s)), hh = lane.rowH - (lane.collapsed ? 0 : 2);
    if (isHover && !isSel) { ctx.fillStyle = DARK ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.32)"; ctx.fillRect(x0, y, x1 - x0, hh); }
    if (isSel || isFocus) {
      ctx.strokeStyle = isSel ? C.ink : C.accent; ctx.lineWidth = isSel ? 2 : 1.5;
      roundRect(x0 - 1, y - 1, Math.max(3, x1 - x0 + 2), hh + 2, 4); ctx.stroke();
    }
  }
}
// A frame left open on "none running" ends where the CPU left it, with a short fading tail.
const TAIL = 26;
const drawnEnd = (s) => (s.abandoned ? s.lastOn : s.end);
function sliceX(s) {
  const x0 = xOf(s.start), x1 = xOf(drawnEnd(s));
  // the moments of the story stay at least 3px wide, so they can be seen and pointed at
  return [x0, Math.max(x1, x0 + (LANDMARK.has(s.id) || s.layer === "app" ? 3 : 1))];
}
function drawSlice(lane, s, dim) {
  const [x0, x1] = sliceX(s);
  const y = rowY(lane, dep(s)), hh = lane.rowH - (lane.collapsed ? 0.6 : 2);
  const fill = fillOf(s), w = x1 - x0;
  ctx.globalAlpha = dim ? 0.16 : 1;
  const r = lane.collapsed || w < 6 ? 0 : 3;
  if (s.cpuIn >= drawnEnd(s) - s.start) {
    ctx.fillStyle = fill; roundRect(x0, y, w, hh, r); ctx.fill();
  } else {
    // waiting: the thread was off the CPU. Pale, hatched, outlined.
    ctx.fillStyle = alpha(rgbToHex(fill), DARK ? 0.2 : 0.22); roundRect(x0, y, w, hh, r); ctx.fill();
    if (!lane.collapsed && hatch) { ctx.fillStyle = hatch; roundRect(x0, y, w, hh, r); ctx.fill(); }
    ctx.fillStyle = fill;
    for (const [a, b] of s.on) {
      const xa = Math.max(x0, xOf(a)), xb = Math.min(x1, xOf(b));
      if (xb - xa <= 0.05) continue;
      ctx.fillRect(xa, y, Math.max(1, xb - xa), hh);
    }
  }
  if (s.abandoned) {
    // never returned: a dashed tail that fades out
    const g = ctx.createLinearGradient(x1, 0, x1 + TAIL, 0);
    g.addColorStop(0, alpha(rgbToHex(fill), 0.5)); g.addColorStop(1, alpha(rgbToHex(fill), 0));
    ctx.fillStyle = g; ctx.fillRect(x1, y, TAIL, hh);
    if (!lane.collapsed) {
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = g; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y + 0.5); ctx.lineTo(x1 + TAIL, y + 0.5); ctx.moveTo(x1, y + hh - 0.5); ctx.lineTo(x1 + TAIL, y + hh - 0.5); ctx.stroke();
      ctx.restore();
    }
  } else if (s.open && !lane.collapsed) {
    // still waiting at the end of the record: fade out to the right
    const g = ctx.createLinearGradient(x1 - 18, 0, x1, 0);
    g.addColorStop(0, alpha(rgbToHex(C.surface), 0)); g.addColorStop(1, alpha(rgbToHex(C.surface), 0.9));
    ctx.fillStyle = g; ctx.fillRect(x1 - 18, y, 18, hh);
  }
  if (LANDMARK.has(s.id) && !lane.collapsed && !dim) {
    ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.2;
    roundRect(x0 - 0.5, y - 0.5, w + 1, hh + 1, r); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// Pins: the moments of the story, numbered like the phases, above the lane they happen in.
function pinText(l) { return l.sub ? [[l.text, l.sub], [l.text]] : [[l.text]]; }
const PIN_H = 18;
const pinFont = (l) => (l.kind === "app" ? `600 12px ${C.mono}` : `600 12px ${C.font}`); // a function name in the code font
function placePins(lane) {
  const pins = PINS.get(lane.t.tid);
  for (const l of pins) l.box = null;
  const px = plotX(), pw = plotW(), y = lane.pinY, fS = `11px ${C.font}`;
  let right = -1e9;
  for (const l of pins) {
    const s = S[l.id];
    const [x0, x1] = sliceX(s);
    if (x1 < px - 2 || x0 > px + pw + 2) continue;
    const ax = Math.min(Math.max(x0 + Math.min(1.5, (x1 - x0) / 2), px + 1), px + pw - 1);
    // the longest wording that fits before the next pin
    const next = pins.find((q) => S[q.id].start > s.start && sliceX(S[q.id])[0] > x0 + 4);
    const from = Math.max(px + 1, ax - 9, right + 6);
    const limit = (next ? Math.max(sliceX(S[next.id])[0] - 10, from + 60) : px + pw) - from;
    let parts = [], w = 22;
    for (const c of pinText(l)) {
      const ww = 21 + textW(c[0], pinFont(l)) + (c[1] ? 6 + textW(c[1], fS) : 0) + 9;
      if (ww <= limit) { parts = c; w = ww; break; }
    }
    const left = Math.min(from, px + pw - w);
    right = left + w;
    l.box = [left, y, w, PIN_H]; l.parts = parts; l.ax = ax;
  }
}
function paintPins(lane) {
  const fS = `11px ${C.font}`, fN = `700 10.5px ${C.font}`, hh = PIN_H;
  for (const l of PINS.get(lane.t.tid)) {
    if (!l.box) continue;
    const s = S[l.id], [left, y, w] = l.box, ax = l.ax, parts = l.parts, fT = pinFont(l);
    const on = state.phase === l.phase, faint = state.focus && !state.focus.ids.has(s.id);
    ctx.save();
    ctx.globalAlpha = faint ? 0.3 : 1;
    // leader down to the call
    const ty = rowY(lane, dep(visOf(s)));
    ctx.strokeStyle = on ? C.accent : C.ink2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(ax) + 0.5, y + hh); ctx.lineTo(Math.round(ax) + 0.5, ty); ctx.stroke();
    if (Math.abs(left + 9 - ax) > 1) { ctx.beginPath(); ctx.moveTo(left + 9, y + hh - 2); ctx.lineTo(Math.round(ax) + 0.5, y + hh); ctx.stroke(); }
    // the pill
    ctx.fillStyle = on ? C["accent-soft"] : C.surface; ctx.strokeStyle = on ? C.accent : C.line;
    roundRect(left, y, w, hh, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = on ? C.accent : C.ink2; ctx.beginPath(); ctx.arc(left + 9, y + hh / 2, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? (DARK ? "#0e1220" : "#fff") : C.surface; ctx.font = fN; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(l.phase ?? ""), left + 9, y + hh / 2 + 0.5); ctx.textAlign = "left";
    let tx = left + 21;
    if (parts[0]) {
      ctx.font = fT; ctx.fillStyle = on ? C.accent : C.ink; ctx.fillText(parts[0], tx, y + hh / 2 + 0.5);
      tx += textW(parts[0], fT) + 6;
    }
    if (parts[1]) { ctx.font = fS; ctx.fillStyle = C.muted; ctx.fillText(parts[1], tx, y + hh / 2 + 0.5); }
    ctx.restore();
  }
}
const onPin = (x, y, w, hh) => M.landmarks.some((l) => l.box && x < l.box[0] + l.box[2] + 4 && x + w > l.box[0] - 4 && y < l.box[1] + l.box[3] + 3 && y + hh > l.box[1] - 3);
function rgbToHex(c) {
  if (c.startsWith("#")) return c;
  const m = c.match(/\d+/g).map(Number);
  return "#" + m.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
}
function labelCandidates(s) {
  // "OS_CALL POLL" → "POLL", "割り込み・タイマー" → "タイマー", "WAIT_NOTIFICATION" → "WAIT…"
  if (s.kind === "irq") return [{ main: s.label }, { main: s.label.replace("割り込み・", "").replace(/^OS_CALL /, "") }];
  const t = s.label, f = s.fn, out = [];
  if (s.n && t !== f) out.push({ main: t, sub: f });
  out.push({ main: t });
  if (short(t) !== t) out.push({ main: short(t) });
  return out;
}
function drawLabel(lane, s, dim) {
  const [x0, x1] = sliceX(s);
  const vx0 = Math.max(x0, plotX()), vx1 = Math.min(x1, plotX() + plotW());
  const avail = vx1 - vx0 - 10;
  if (avail < 22) return;
  const font = s.inferred ? F.labelLight() : F.label();
  const top = rowY(lane, dep(s)), y = top + (lane.rowH - 2) / 2 + 0.5;
  const tx = vx0 + 5;
  // what to write: the longest candidate that fits
  let text = null, sub = null;
  for (const c of labelCandidates(s)) {
    const wm = textW(c.main, font);
    if (c.sub) { if (wm + 8 + textW(c.sub, F.sub()) <= avail) { text = c.main; sub = c.sub; break; } continue; }
    if (wm <= avail) { text = c.main; break; }
  }
  if (!text) { const cands = labelCandidates(s); text = clip(cands[cands.length - 1].main, avail, font); }
  if (!text) return;
  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.textBaseline = "middle";
  const whole = s.cpuIn >= drawnEnd(s) - s.start;
  if (!whole) {
    // A waiting bar is pale with solid parts where it ran. One ink for the whole label, on a soft
    // chip, so the text does not change colour where the bar does.
    const tw0 = textW(text, font) + (sub ? 8 + textW(sub, F.sub()) : 0);
    ctx.fillStyle = alpha(rgbToHex(C.surface), DARK ? 0.84 : 0.8);
    roundRect(tx - 3, top + 2, Math.min(tw0 + 6, vx1 - tx + 2), lane.rowH - 6, 3); ctx.fill();
  }
  ctx.font = font; ctx.fillStyle = whole ? inkOf(s) : C.ink; ctx.fillText(text, tx, y);
  if (sub) { ctx.font = F.sub(); ctx.fillStyle = whole && !s.inferred ? alpha(rgbToHex(C["on-fill"]), 0.72) : C.muted; ctx.fillText(sub, tx + textW(text, font) + 8, y); }
  ctx.globalAlpha = 1;
  labelBoxes.push([tx - 3, top + 1, textW(text, font) + (sub ? 8 + textW(sub, F.sub()) : 0) + 6, lane.rowH - 4]);
}
function roundRect(x, y, w, hh, r) {
  ctx.beginPath();
  if (r <= 0 || w < 2 * r) { ctx.rect(x, y, w, hh); return; }
  ctx.roundRect(x, y, w, hh, r);
}

function linkGeom(l) {
  const a = S[l.from], b = S[l.to];
  const la = laneOf(a.tid), lb = laneOf(b.tid);
  const x0 = xOf(a.end), x1 = xOf(b.start);
  // folded: the arrow starts and ends on the drawn caller, at the real moments
  const va = visOf(a), vb = visOf(b);
  const y0 = rowY(la, dep(va)) + (la.rowH - 2) / 2, y1 = rowY(lb, dep(vb)) + (lb.rowH - 2) / 2;
  const dx = Math.max(30, Math.abs(x1 - x0) * 0.45);
  return { x0, y0, x1, y1, c1x: x0 + dx, c1y: y0, c2x: x1 - dx, c2y: y1 };
}
const LINK_NAME = { queue: "要求", reply: "返事", event: "イベント" };
// On a phone the names sit in a row above each lane: arrows and their pills stay off those rows.
const inHead = (y, pad = 0) => G.narrow && lanes.some((l) => y > l.y - pad && y < l.y + G.head + pad);
function drawLinks(i0, i1) {
  const f = state.focus;
  const pills = [];
  if (G.narrow) {
    ctx.save(); ctx.beginPath();
    for (const l of lanes) ctx.rect(plotX(), l.y + G.head, plotW(), l.h - G.head + G.laneGap);
    ctx.clip();
  }
  M.links.forEach((l, k) => {
    const a = S[l.from], b = S[l.to];
    if (b.start < i0 || a.end > i1) {
      if (!(a.end < i1 && b.start > i0)) return;
    }
    const g = linkGeom(l);
    const strong = (f && f.links.has(k)) || state.hover?.type === "link" && state.hover.k === k || (state.sel != null && [l.a, l.b, l.from, l.to].includes(state.sel));
    const faint = f && !f.links.has(k);
    ctx.save();
    ctx.globalAlpha = faint ? 0.15 : strong ? 1 : 0.62;
    ctx.strokeStyle = C.accent; ctx.lineWidth = strong ? 2.2 : 1.5;
    ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.x1, g.y1); ctx.stroke();
    // arrow head along the end tangent
    const ang = Math.atan2(g.y1 - g.c2y, g.x1 - g.c2x);
    ctx.fillStyle = C.accent; ctx.beginPath();
    ctx.moveTo(g.x1, g.y1);
    ctx.lineTo(g.x1 - 8 * Math.cos(ang - 0.42), g.y1 - 8 * Math.sin(ang - 0.42));
    ctx.lineTo(g.x1 - 8 * Math.cos(ang + 0.42), g.y1 - 8 * Math.sin(ang + 0.42));
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(g.x0, g.y0, 3, 0, Math.PI * 2); ctx.fill();
    // a label along the curve where there is room: not on a pin, a name row or another label
    const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    if (len > 46 && !faint) {
      const text = LINK_NAME[l.kind], font = F.flag(), w = textW(text, font) + 12;
      const spots = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8].map((t) => [bez(g.x0, g.c1x, g.c2x, g.x1, t), bez(g.y0, g.c1y, g.c2y, g.y1, t)]);
      const ok = ([mx, my]) => !(mx - w / 2 < plotX() + 2 || mx + w / 2 > plotX() + plotW() - 2 || inHead(my, 10) || onPin(mx - w / 2, my - 9, w, 18)
        || pills.some(([x, y]) => Math.abs(x - mx) < (w + 40) / 2 + 4 && Math.abs(y - my) < 20));
      const clear = ([mx, my]) => !labelBoxes.some((b) => mx - w / 2 < b[0] + b[2] && mx + w / 2 > b[0] && my - 9 < b[1] + b[3] && my + 9 > b[1]);
      // best: off the labels of the calls too; else anywhere free
      const at = spots.find((p) => ok(p) && clear(p)) || spots.find(ok);
      if (!at) { ctx.restore(); return; }
      const [mx, my] = at;
      pills.push([mx, my]);
      ctx.globalAlpha = faint ? 0.15 : 1;
      ctx.fillStyle = C.surface; ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
      roundRect(mx - w / 2, my - 9, w, 18, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.font = font; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(text, mx, my + 0.5); ctx.textAlign = "left";
    }
    ctx.restore();
  });
  if (G.narrow) ctx.restore();
}
const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };

function drawSwitches(i0, i1) {
  if (G.narrow) {
    // on a phone, not across the name rows
    ctx.save(); ctx.beginPath();
    for (const l of lanes) ctx.rect(plotX(), l.y + G.head, plotW(), l.h - G.head + G.laneGap);
    ctx.clip();
  }
  drawSwitchLines(i0, i1);
  if (G.narrow) ctx.restore();
}
function drawSwitchLines(i0, i1) {
  for (const sw of M.switches) {
    if (sw.at < i0 || sw.at > i1) continue;
    const la = laneOf(sw.from), lb = laneOf(sw.to);
    if (!la || !lb) continue;
    const x = xOf(sw.at);
    const y0 = la.runY + G.runH / 2, y1 = lb.runY + G.runH / 2;
    const hot = state.hover?.type === "switch" && state.hover.sw === sw || state.focus?.switches?.has(sw);
    ctx.save();
    ctx.strokeStyle = hot ? C.ink : C.muted; ctx.fillStyle = hot ? C.ink : C.muted; ctx.lineWidth = hot ? 1.6 : 1;
    ctx.globalAlpha = hot ? 1 : 0.45;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1 + (y1 > y0 ? -5 : 5)); ctx.stroke();
    const d = y1 > y0 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x - 3.5, y1 - 6 * d); ctx.lineTo(x + 3.5, y1 - 6 * d); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawRequests(i0, i1, flags) {
  for (const r of M.requests) {
    if (r.at < i0 || r.at > i1) continue;
    const x = Math.max(plotX() + 1, xOf(r.at));
    if (!flags) {
      ctx.strokeStyle = alpha(rgbToHex(C.accent), 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, G.ruler); ctx.lineTo(x + 0.5, H); ctx.stroke();
      continue;
    }
    const text = r.method === "input.key.type" ? "キー入力" : r.method, font = F.flag();
    const w = textW(text, font) + 14;
    const left = x + w > plotX() + plotW() ? x - w : x;
    ctx.fillStyle = C.accent; roundRect(left, 6, w, 19, 5); ctx.fill();
    ctx.fillStyle = DARK ? "#0e1220" : "#ffffff"; ctx.font = font; ctx.textBaseline = "middle"; ctx.fillText(text, left + 7, 16);
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
// 152,950 → "15万", 22,565 → "2.3万"
const man = (n) => (n >= 1e5 ? `${Math.round(n / 1e4)}万` : `${(n / 1e4).toFixed(1)}万`);
const gapFill = () => alpha(DARK ? "#000000" : "#8a877d", DARK ? 0.2 : 0.08);
function drawRuler(i0, i1) {
  const px = plotX(), pw = plotW(), base = G.ruler - 1;
  ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, G.ruler);
  ctx.fillStyle = C.line; ctx.fillRect(px, base, pw, 1);
  const perPx = (state.v1 - state.v0) / pw;
  const step = niceStep(perPx * 96);
  const squeezed = mix > 0.5;
  const gapPx = mix > 0.02 ? AX.segs.filter((g) => g.gap && g.b >= i0 && g.a <= i1).map((g) => [xOf(g.a), xOf(g.b), g]) : [];
  const inGap = (i) => squeezed && AX.segs.some((g) => g.gap && i > g.a && i < g.b);
  // taken: the request flags on the ruler
  const placed = M.requests.filter((r) => r.at >= i0 && r.at <= i1).map((r) => {
    const x = Math.max(plotX() + 1, xOf(r.at)), w = textW(r.method === "input.key.type" ? "キー入力" : r.method, F.flag()) + 14;
    const left = x + w > plotX() + plotW() ? x - w : x;
    return [left, left + w];
  });
  const free = (a, b, pad = 8) => !placed.some(([x, y]) => a < y + pad && b > x - pad);
  ctx.save(); ctx.beginPath(); ctx.rect(px, 0, pw, G.ruler); ctx.clip();
  // 1. a squeezed stretch: a band like the one in the lanes, and one break mark. Its length is written
  //    only inside the band, in a pill, never as a bare number among the ticks (hover tells it too).
  for (const [xa, xb, g] of gapPx) {
    const w = xb - xa;
    if (w < 2) continue;
    ctx.globalAlpha = mix;
    ctx.fillStyle = gapFill(); ctx.fillRect(xa, 4, w, base - 4);
    const cx = (xa + xb) / 2, len = g.run[1] - g.run[0], font = F.tick();
    const text = [`記録外 ${man(len)}`, man(len)].find((t) => textW(t, font) + 16 <= w);
    if (text && squeezed) {
      const tw2 = textW(text, font) + 12;
      ctx.fillStyle = C.surface; ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]); roundRect(cx - tw2 / 2, 7, tw2, 16, 8); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.muted; ctx.font = font; ctx.textBaseline = "middle"; ctx.fillText(text, cx - tw2 / 2 + 6, 15.5);
      placed.push([cx - tw2 / 2, cx + tw2 / 2]);
    } else {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1.2;
      for (const d of [-2.2, 2.2]) { ctx.beginPath(); ctx.moveTo(cx + d - 2.5, base - 2); ctx.lineTo(cx + d + 2.5, base - 11); ctx.stroke(); }
      placed.push([cx - 5, cx + 5]);
    }
    ctx.globalAlpha = 1;
  }
  ctx.font = F.tick(); ctx.textBaseline = "alphabetic";
  // 2. where the time picks up after a squeezed stretch: "391,616〜", set apart from the ticks
  if (squeezed) for (const [, xb, g] of gapPx) {
    if (xb < px - 40 || xb > px + pw - 30) continue;
    const text = `${fmt(g.run[1])}〜`, font = `600 11px ${C.font}`, w = textW(text, font);
    const lx = Math.max(px, xb + 3);
    if (!free(lx, lx + w, 6)) continue;
    placed.push([lx, lx + w]);
    ctx.fillStyle = C.ink2; ctx.font = font; ctx.fillText(text, lx, base - 9);
    ctx.fillStyle = C.ink2; ctx.fillRect(Math.round(xb), base - 7, 1, 7);
  }
  // 3. ticks, outside the squeezed stretches
  ctx.font = F.tick();
  for (let k = Math.ceil(i0 / step) * step; k <= i1; k += step) {
    if (inGap(k)) continue;
    const x = xOf(k);
    if (x < px - 1 || x > px + pw + 1) continue;
    ctx.fillStyle = C.line; ctx.fillRect(Math.round(x), base - 5, 1, 5);
    const text = fmt(k), w = textW(text, F.tick());
    const lx = Math.min(Math.max(px, x - w / 2), px + pw - w);
    if (!free(lx, lx + w)) continue;
    placed.push([lx, lx + w]);
    ctx.fillStyle = C.muted; ctx.fillText(text, lx, base - 9);
  }
  ctx.restore();
  // the gutter caption
  ctx.font = F.tick(); ctx.fillStyle = C.muted; ctx.textBaseline = "alphabetic";
  if (!G.narrow) ctx.fillText(squeezed ? "命令（記録外を詰めた）" : "命令（時間）", 14, base - 9);
}

function drawGutter() {
  if (G.narrow) {
    // names sit in a row above each lane
    for (const lane of lanes) {
      const t = lane.t, x = 12;
      ctx.save();
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1.5;
      ctx.translate(x + 4, lane.y + 10);
      if (lane.collapsed) ctx.rotate(-Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(-3.5, -1.5); ctx.lineTo(0, 2); ctx.lineTo(3.5, -1.5); ctx.stroke();
      ctx.restore();
      ctx.font = F.gname(); ctx.fillStyle = C.ink; ctx.textBaseline = "middle";
      ctx.fillText(t.name, x + 14, lane.y + 10);
      ctx.font = F.gsub(); ctx.fillStyle = C.muted;
      ctx.fillText(`${t.sub}・CPU ${pct(t.cpu / M.END)}`, x + 22 + textW(t.name, F.gname()), lane.y + 10.5);
    }
    return;
  }
  ctx.fillStyle = C.surface; ctx.fillRect(0, G.ruler, G.gutter - 6, H - G.ruler);
  for (const lane of lanes) {
    const t = lane.t;
    const hot = state.hover?.type === "gutter" && state.hover.lane === lane;
    const x = 14;
    // chevron
    ctx.save();
    ctx.strokeStyle = hot ? C.ink : C.muted; ctx.lineWidth = 1.5;
    ctx.translate(x + 4, lane.y + 12);
    if (lane.collapsed) ctx.rotate(-Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(-3.5, -1.5); ctx.lineTo(0, 2); ctx.lineTo(3.5, -1.5); ctx.stroke();
    ctx.restore();
    const name = clip(t.name, G.gutter - x - 30, F.gname()) || t.name;
    ctx.font = F.gname(); ctx.fillStyle = hot ? C.accent : C.ink; ctx.textBaseline = "middle";
    ctx.fillText(name, x + 14, lane.y + 12);
    ctx.font = F.gsub(); ctx.fillStyle = C.muted;
    const stat = `CPU ${pct(t.cpu / M.END)}・${t.count} 呼び出し`;
    if (lane.collapsed) ctx.fillText(stat, x + 14, lane.y + 29);
    else {
      ctx.fillText(t.sub, x + 14, lane.y + 29);
      ctx.fillText(stat, x + 14, lane.y + 44);
      // what this thread's recorded time was spent in, by layer (the words on hover)
      const mix2 = threadShare.get(t.tid), tot = SHARE_ORDER.reduce((a, k) => a + mix2[k], 0);
      if (tot > 0 && lane.h > 80) {
        const bw = G.gutter - x - 34, by = lane.y + 55;
        let bx = x + 14;
        for (const k of SHARE_ORDER) {
          const w = (mix2[k] / tot) * bw;
          if (w <= 0) continue;
          ctx.fillStyle = layerColor(k); roundRect(bx, by, Math.max(1, w - 1.5), 6, 2); ctx.fill();
          bx += w;
        }
        let lx = x + 14, ly = by + 19;
        const f = `10.5px ${C.font}`;
        ctx.font = f;
        for (const k of SHARE_ORDER) {
          if (mix2[k] / tot < 0.005) continue;
          const text = `${SHORT_LAYER[k]} ${pct(mix2[k] / tot, 0)}`, w = 11 + textW(text, f);
          if (lx + w > G.gutter - 6 && lx > x + 14) { lx = x + 14; ly += 15; }
          if (ly > lane.y + lane.h - 4) break;
          ctx.fillStyle = layerColor(k); roundRect(lx, ly - 4, 8, 8, 2); ctx.fill();
          ctx.fillStyle = C.ink2; ctx.fillText(text, lx + 11, ly + 0.5);
          lx += w + 8;
        }
      }
    }
  }
}
const SHORT_LAYER = { app: "アプリ", lib: "ライブラリ", os: "OS", kernel: "カーネル", emu: "エミュレータ", unknown: "不明" };
// The phases of the story as a track under the ruler: they move with the view.
function phaseText(p) {
  const ws = topWords(p, 3);
  return (p.after ? "その後：" : "") + ws.map((w) => w.text + (w.detail ? `（${w.detail}）` : "")).join(" → ");
}
// The track writes a phase's whole title when it fits, else only its number (the chips above and
// the pins in the lanes carry the words; hover tells the title).
function phaseTexts(p) { return p.after ? [phaseText(p), "その後"] : [phaseText(p)]; }
function drawStoryTrack(i0, i1) {
  const y = G.ruler + 4, hh = G.story - 4, px = plotX(), pw = plotW();
  ctx.font = F.tick(); ctx.textBaseline = "middle"; ctx.fillStyle = C.muted;
  if (!G.narrow) ctx.fillText("あらすじ", 14, y + hh / 2);
  ctx.save(); ctx.beginPath(); ctx.rect(px, y - 2, pw, hh + 4); ctx.clip();
  for (const p of M.phases) {
    if (p.end < i0 || p.start > i1) continue;
    const xa = Math.max(px - 4, xOf(p.start)), xb = Math.min(px + pw + 4, xOf(p.end));
    if (xb - xa < 1) continue;
    const on = state.phase === p.num, hot = state.hover?.type === "phase" && state.hover.p === p || state.hoverPhase === p.num;
    ctx.fillStyle = on ? C["accent-soft"] : hot ? C.surface2 : p.num % 2 ? (DARK ? "#24252a" : "#f1f0ec") : (DARK ? "#1f2024" : "#f7f6f3");
    roundRect(xa + 1, y, xb - xa - 2, hh, 5); ctx.fill();
    if (on || hot) { ctx.strokeStyle = on ? C.accent : C.line; ctx.lineWidth = 1; roundRect(xa + 1.5, y + 0.5, xb - xa - 3, hh - 1, 5); ctx.stroke(); }
    // number, then the title where it fits, kept in view while the phase is
    const vx0 = Math.max(xa, px) + 6, vx1 = Math.min(xb, px + pw) - 6;
    const bw = Math.min(xb, px + pw) - Math.max(xa, px);
    if (bw < 13) continue;
    // a narrow phase (phase 1 on a phone) still shows its number, in the middle of its band
    const cx = vx1 - vx0 < 16 ? (Math.max(xa, px) + Math.min(xb, px + pw)) / 2 : vx0 + 8;
    const num = p.after ? "…" : String(p.num), font = `700 11px ${C.font}`;
    ctx.fillStyle = on ? C.accent : C.ink2; ctx.beginPath(); ctx.arc(cx, y + hh / 2, Math.min(8, bw / 2 - 0.5), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? (DARK ? "#0e1220" : "#fff") : C.surface; ctx.font = font; ctx.textAlign = "center"; ctx.fillText(num, cx, y + hh / 2 + 0.5); ctx.textAlign = "left";
    // the title only when a wording fits whole: the chips above carry the long titles
    const avail = vx1 - vx0 - 24;
    const tfont = `600 12px ${C.font}`;
    const t = avail > 24 && phaseTexts(p).find((x) => textW(x, tfont) <= avail);
    if (t) { ctx.font = tfont; ctx.fillStyle = on ? C.accent : C.ink; ctx.fillText(t, vx0 + 22, y + hh / 2 + 0.5); }
  }
  ctx.restore();
}

function drawCross() {
  if (!state.cross || state.brush) return;
  const x = state.cross.x;
  if (x < plotX() || x > plotX() + plotW()) return;
  ctx.strokeStyle = alpha(rgbToHex(C.ink), 0.35); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, G.ruler); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke();
  const i = iOf(vOfX(x));
  const g = mix > 0.5 && AX.segs.find((s) => s.gap && i > s.a && i < s.b);
  const text = g ? `記録外（${fmt(g.run[0])}–${fmt(g.run[1])}）` : `${fmt(i)} 命令目`;
  const font = F.flag(), w = textW(text, font) + 14;
  const left = Math.min(Math.max(plotX(), x - w / 2), plotX() + plotW() - w);
  ctx.fillStyle = C.ink; roundRect(left, 6, w, 19, 5); ctx.fill();
  ctx.fillStyle = C.surface; ctx.font = font; ctx.textBaseline = "middle"; ctx.fillText(text, left + 7, 16);
}
function drawBrush() {
  const b = state.brush;
  if (!b) return;
  const xa = Math.min(b.x0, b.x1), xb = Math.max(b.x0, b.x1);
  ctx.fillStyle = alpha(rgbToHex(C.accent), 0.12); ctx.fillRect(xa, 0, xb - xa, H);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 1; ctx.strokeRect(xa + 0.5, 0.5, xb - xa - 1, H - 1);
  const ia = iOf(vOfX(xa)), ib = iOf(vOfX(xb));
  const text = `${fmt(ib - ia)} 命令`, font = F.flag(), w = textW(text, font) + 14;
  ctx.fillStyle = C.accent; roundRect((xa + xb) / 2 - w / 2, 6, w, 19, 5); ctx.fill();
  ctx.fillStyle = DARK ? "#0e1220" : "#fff"; ctx.font = font; ctx.textBaseline = "middle"; ctx.fillText(text, (xa + xb) / 2 - w / 2 + 7, 16);
}

// ---------------------------------------------------------------- overview
function ovX(i) { return (vOf(i) / vTotal()) * OV.w; }
function drawOverview() {
  const w = OV.w, g = octx;
  g.clearRect(0, 0, w, OV.h);
  // chapters
  for (const p of M.phases) {
    const xa = ovX(p.start), xb = ovX(p.end);
    const active = state.phase === p.num || state.hoverPhase === p.num;
    g.fillStyle = active ? C.accent : p.after ? C.grid : p.num % 2 ? (DARK ? "#3a3b40" : "#d9d7cf") : (DARK ? "#2c2d31" : "#e9e7e1");
    g.fillRect(xa + 0.5, 1, Math.max(1, xb - xa - 1), 12);
    const t = p.after ? "その後" : String(p.num), font = `600 11px ${C.font}`;
    g.font = font; const tw2 = g.measureText(t).width;
    if (tw2 + 6 < xb - xa) { g.fillStyle = active ? (DARK ? "#0e1220" : "#fff") : C.ink2; g.textBaseline = "middle"; g.fillText(t, (xa + xb) / 2 - tw2 / 2, 7.5); }
  }
  // what the CPU was in
  for (const [a, b, id] of M.segs) {
    const xa = ovX(a), xb = ovX(b);
    g.fillStyle = id < 0 ? C["l-none"] : layerColor(S[id].layer);
    g.fillRect(xa, 16, Math.max(0.6, xb - xa), 12);
  }
  // squeezed stretches
  if (mix > 0.02) for (const sg of AX.segs) if (sg.gap) {
    const xa = ovX(sg.a), xb = ovX(sg.b);
    g.save(); g.globalAlpha = mix; g.strokeStyle = C.muted; g.lineWidth = 1;
    g.beginPath(); for (const x of [xa, xb]) { g.moveTo(x, 16); g.lineTo(x - 2, 19); g.lineTo(x + 2, 22); g.lineTo(x - 2, 25); g.lineTo(x, 28); } g.stroke();
    g.restore();
  }
  // focus marks
  if (state.focus) {
    g.fillStyle = C.accent;
    for (const id of state.focus.ids) { const s = S[id]; g.fillRect(ovX(s.start) - 0.5, 31, Math.max(1.5, ovX(s.end) - ovX(s.start)), 4); }
  }
  // the window
  const xa = (state.v0 / vTotal()) * w, xb = (state.v1 / vTotal()) * w;
  g.fillStyle = alpha(rgbToHex(C.surface), DARK ? 0.55 : 0.6);
  g.fillRect(0, 14, Math.max(0, xa), 16); g.fillRect(xb, 14, Math.max(0, w - xb), 16);
  g.strokeStyle = C.ink; g.lineWidth = 1.5;
  g.strokeRect(Math.max(0.75, xa), 14.75, Math.max(2, Math.min(w - 0.75, xb) - Math.max(0.75, xa)), 14.5);
  g.font = `11px ${C.font}`; g.fillStyle = C.muted; g.textBaseline = "alphabetic";
}

// ---------------------------------------------------------------- the view
const threadShare = new Map(M.threads.map((t) => {
  const out = { app: 0, lib: 0, os: 0, kernel: 0, emu: 0, unknown: 0 };
  for (const [a, b, id, tid] of M.segs) if (tid === t.tid && id >= 0) out[S[id].layer || "unknown"] += b - a;
  return [t.tid, out];
}));
const laneSlices = new Map(M.threads.map((t) => [t.tid, S.filter((s) => s.tid === t.tid).sort((a, b) => a.depth - b.depth || a.start - b.start)]));
const threadLayers = (t) => {
  const mix2 = threadShare.get(t.tid), tot = SHARE_ORDER.reduce((a, k) => a + mix2[k], 0);
  return SHARE_ORDER.filter((k) => mix2[k] / tot >= 0.005).map((k) => `${LAYER_NAME[k]} ${pct(mix2[k] / tot, 0)}`).join("・");
};
function clampView(v0, v1) {
  const T = vTotal();
  let span = Math.min(T, Math.max(MIN_SPAN, v1 - v0));
  let a = v0, b = v0 + span;
  if (a < 0) { a = 0; b = span; }
  if (b > T) { b = T; a = T - span; }
  return [a, b];
}
function setView(v0, v1) { [state.v0, state.v1] = clampView(v0, v1); requestDraw(); }
let anim = null;
function animateTo(v0, v1, ms = 460) {
  [v0, v1] = clampView(v0, v1);
  if (anim) cancelAnimationFrame(anim.raf);
  if (reduceMotion) { setView(v0, v1); return Promise.resolve(); }
  return new Promise((done) => {
    const a0 = state.v0, a1 = state.v1, t0 = performance.now();
    // zoom on a log scale so that big jumps do not rush the middle
    const s0 = Math.log(a1 - a0), s1 = Math.log(v1 - v0), c0 = (a0 + a1) / 2, c1 = (v0 + v1) / 2;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const span = Math.exp(s0 + (s1 - s0) * e), c = c0 + (c1 - c0) * e;
      state.v0 = c - span / 2; state.v1 = c + span / 2;
      requestDraw();
      if (p < 1) anim = { raf: requestAnimationFrame(step) }; else { anim = null; setView(v0, v1); done(); }
    };
    anim = { raf: requestAnimationFrame(step) };
  });
}
function fitInstr(a, b, pad = 0.05) {
  let v0 = vOf(a), v1 = vOf(b);
  const span = Math.max(MIN_SPAN * 4, v1 - v0);
  const c = (v0 + v1) / 2;
  v0 = c - (span * (1 + 2 * pad)) / 2; v1 = c + (span * (1 + 2 * pad)) / 2;
  return animateTo(v0, v1);
}
function zoomAt(x, factor) {
  const vc = vOfX(x);
  const span = Math.min(vTotal(), Math.max(MIN_SPAN, (state.v1 - state.v0) * factor));
  const r = (x - plotX()) / plotW();
  setView(vc - r * span, vc - r * span + span);
}
function setMode(m) {
  const target = m === "compress" ? 1 : 0;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  const i0 = iOf(state.v0), i1 = iOf(state.v1), from = mix, t0 = performance.now(), ms = reduceMotion ? 1 : 560;
  if (anim) cancelAnimationFrame(anim.raf);
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    mix = from + (target - from) * e;
    state.v0 = vOf(i0); state.v1 = vOf(i1);
    [state.v0, state.v1] = clampView(state.v0, state.v1);
    requestDraw();
    if (p < 1) requestAnimationFrame(step); else saveHash();
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- hit testing
function hitTest(x, y) {
  if (y < G.ruler) return { type: "ruler" };
  if (y < G.ruler + G.story + 2 && x >= plotX()) {
    const i = iOf(vOfX(x));
    const p = M.phases.find((q) => i >= q.start && i <= q.end);
    return p ? { type: "phase", p } : null;
  }
  if (G.narrow) { const lane = lanes.find((l) => y >= l.y && y < l.y + G.head); if (lane) return { type: "gutter", lane }; }
  if (x < G.gutter - 6) {
    const lane = lanes.find((l) => y >= l.y && y < l.y + l.h);
    return lane ? { type: "gutter", lane } : null;
  }
  // a request line
  for (const r of M.requests) { const rx = xOf(r.at); if (Math.abs(rx - x) <= 3 && y > G.ruler) { /* keep looking for slices first */ } }
  const lane = lanes.find((l) => y >= l.y && y < l.y + l.h);
  // links (when near a curve)
  if (state.showLinks) {
    for (let k = 0; k < M.links.length; k++) {
      const g = linkGeom(M.links[k]);
      if (x < Math.min(g.x0, g.x1) - 6 || x > Math.max(g.x0, g.x1) + 6) continue;
      for (let t = 0; t <= 1; t += 0.04) {
        const bx = bez(g.x0, g.c1x, g.c2x, g.x1, t), by = bez(g.y0, g.c1y, g.c2y, g.y1, t);
        if (Math.hypot(bx - x, by - y) < 5) return { type: "link", k, l: M.links[k] };
      }
    }
  }
  if (!lane) return null;
  // the pins of the story
  for (const l of PINS.get(lane.t.tid)) {
    const b = l.box;
    if (b && x >= b[0] - 2 && x <= b[0] + b[2] + 2 && y >= b[1] - 2 && y <= b[1] + b[3] + 2) return { type: "pin", l, s: S[l.id] };
  }
  // interrupt markers just above the CPU strip
  if (y >= lane.runY - 8 && y <= lane.runY + 1) {
    const s = laneSlices.get(lane.t.tid).find((q) => q.kind === "irq" && q.trap !== "syscall" && Math.abs(xOf(q.start) - x) <= 5);
    if (s) return { type: "irq", s };
  }
  // the CPU strip
  if (y >= lane.runY - 3 && y <= lane.runY + G.runH + 3) {
    for (const sw of M.switches) if (Math.abs(xOf(sw.at) - x) <= 4 && (sw.to === lane.t.tid || sw.from === lane.t.tid)) return { type: "switch", sw };
    const i = iOf(vOfX(x));
    const run = lane.t.runs.find(([a, b]) => i >= a && i <= b);
    if (run) return { type: "run", lane, run };
  }
  const depth = Math.floor((y - lane.rowsY) / lane.rowH);
  if (depth >= 0 && depth < rowsOf(lane.t)) {
    let best = null, bestD = 1e9;
    for (const s of laneSlices.get(lane.t.tid)) {
      if (!shown(s) || dep(s) !== depth) continue;
      const [x0, x10] = sliceX(s), x1 = s.abandoned ? x10 + TAIL : x10;
      if (x >= x0 - 3 && x <= x1 + 3) {
        const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        if (d < bestD || (d === bestD && best && x1 - x0 < sliceX(best)[1] - sliceX(best)[0])) { best = s; bestD = d; }
      }
    }
    if (best) return { type: "slice", s: best };
  }
  for (const r of M.requests) if (Math.abs(xOf(r.at) - x) <= 3) return { type: "request", r };
  const i = iOf(vOfX(x));
  const gap = mix > 0.5 && AX.segs.find((g) => g.gap && i > g.a && i < g.b);
  if (gap) return { type: "gap", g: gap };
  return { type: "lane", lane };
}

// ---------------------------------------------------------------- tooltip
const tip = $("#tip");
function tipRow(k, v) { return h("div", { class: "row" }, h("span", { class: "k" }, k), h("span", null, v)); }
function showTip(x, y, hit) {
  tip.replaceChildren();
  let ok = true;
  if (hit.type === "slice" || hit.type === "pin") {
    const s = hit.s, dur = s.end - s.start, t = thread(s.tid);
    if (hit.type === "pin" || LANDMARK.has(s.id)) {
      const l = LANDMARK.get(s.id), p = M.phases.find((q) => q.num === l.phase);
      tip.append(h("div", { class: "eyebrow" }, `場面 ${l.phase}・${p ? phaseText(p) : ""}`));
    }
    if (s.open) tip.append(h("div", { class: "v" }, "開いたまま", h("small", null, `CPU 上 ${fmt(s.cpuIn)} 命令`)));
    else tip.append(h("div", { class: "v" }, fmt(dur), h("small", null, "命令")));
    tip.append(h("div", { class: "fn" }, s.kind === "irq" ? s.label : s.fn));
    if (s.kind === "irq") {
      const parts = [s.trap === "syscall" ? `syscall ${s.syscall || ""}` : `割り込み（${causeJa(s.cause)}）`];
      if (s.service) parts.push(`service ${s.service}`);
      tip.append(tipRow("種類", parts.join("・")));
      if (s.interrupted) tip.append(tipRow("止めた先", s.interrupted));
      if (s.ctx) tip.append(tipRow("文脈", NODES[s.ctx].title));
    } else if (s.n) {
      tip.append(h("div", { class: "row" }, h("span", { class: "k" }, "地図"), h("span", null, h("span", { class: "key", style: `background:${layerColor(s.layer)}` }), NODES[s.n].title, `（${LAYER_NAME[s.layer]}）`)));
    } else {
      tip.append(h("div", { class: "row" }, h("span", { class: "k" }, "地図"), h("span", null, h("span", { class: "key", style: `background:${layerColor(s.layer)};opacity:.5` }), "ノードなし", s.layer ? `・${LAYER_NAME[s.layer]}（置き場所から）` : "・層は分からない")));
    }
    tip.append(tipRow("スレッド", t.name));
    tip.append(tipRow("始まり", `${fmt(s.start)} 命令目`));
    if (s.cpuIn < dur && !s.abandoned) tip.append(tipRow("CPU 上", `${fmt(s.cpuIn)}・待ち ${fmt(dur - s.cpuIn)}`));
    tip.append(tipRow("自分だけ", `${fmt(s.selfOn)}（記録した呼び先と待ちを除く）`));
    if (s.abandoned) tip.append(h("div", { class: "note" }, "CPU がこの文脈に戻らないまま記録が終わる。戻ったか、いつ戻ったかは記録に無い。"));
    else if (s.open) tip.append(h("div", { class: "note" }, `記録の終わり（${fmt(M.END)} 命令目）でもまだ戻っていない。`));
    if (s.notNode) tip.append(h("div", { class: "note" }, `地図の記録は OS_CALL に結んでいるが、これは ${s.notNode.syscall} の syscall。OS_CALL には数えない。`));
    const folded = shown(s) ? hiddenInside(s) : 0;
    if (folded) tip.append(h("div", { class: "note" }, `中の ${folded} 回の呼び出しはたたんでいる（「すべて」で見える）。`));
  } else if (hit.type === "link") {
    const l = hit.l, a = S[l.from], b = S[l.to];
    const what = { queue: "要求の列を通る要求", reply: "返事の channel を通る返事", event: "アプリのイベントの列を通るイベント" }[l.kind];
    tip.append(h("div", { class: "v" }, fmt(b.start - a.end), h("small", null, "命令あと")));
    tip.append(h("div", { class: "fn" }, what));
    tip.append(tipRow("入れた", `${thread(a.tid).name} の ${a.fn}`));
    tip.append(tipRow("出した", `${thread(b.tid).name} の ${b.fn}`));
    if (l.kind === "event" && l.handler != null) tip.append(tipRow("ハンドラ", S[l.handler].fn));
    tip.append(h("div", { class: "note" }, "列は先に入れた順に出るので、入れた順と出した順で結んだ。"));
  } else if (hit.type === "phase") {
    const p = hit.p;
    tip.append(h("div", { class: "v" }, fmt(p.end - p.start), h("small", null, "命令")));
    tip.append(h("div", { class: "fn" }, p.after ? "その後" : `場面 ${p.num}`, "：", phaseText(p).replace(/^その後：/, "")));
    tip.append(tipRow("スレッド", phaseWho(p)));
    tip.append(h("div", { class: "note" }, "押すと、この場面に寄る"));
  } else if (hit.type === "irq") {
    const s2 = hit.s;
    tip.append(h("div", { class: "fn" }, `割り込み（${causeJa(s2.cause)}）`));
    tip.append(tipRow("時", `${fmt(s2.start)} 命令目`));
    tip.append(tipRow("止めた先", `${thread(s2.tid).name}（${s2.interrupted || "—"}）`));
    tip.append(tipRow("戻るまで", `${fmt(s2.end - s2.start)} 命令${s2.open ? "（記録の終わりでもまだ）" : ""}`));
  } else if (hit.type === "run") {
    const [a, b] = hit.run;
    tip.append(h("div", { class: "v" }, fmt(b - a), h("small", null, "命令")));
    tip.append(h("div", { class: "fn" }, `${hit.lane.t.name} が CPU を持つ`));
    tip.append(tipRow("あいだ", `${fmt(a)}–${fmt(b)}`));
  } else if (hit.type === "switch") {
    const sw = hit.sw;
    tip.append(h("div", { class: "fn" }, `切り替え：${thread(sw.from).name} → ${thread(sw.to).name}`));
    tip.append(tipRow("時", `${fmt(sw.at)} 命令目`));
  } else if (hit.type === "request") {
    tip.append(h("div", { class: "fn" }, `ドライバの要求 ${hit.r.method}`));
    tip.append(tipRow("時", `${fmt(hit.r.at)} 命令目`));
    tip.append(h("div", { class: "note" }, "記録を取った側の操作。ここから先は、この要求のあいだに走った。"));
  } else if (hit.type === "gap") {
    const [a, b] = hit.g.run;
    tip.append(h("div", { class: "v" }, fmt(b - a), h("small", null, "命令（記録外）")));
    tip.append(h("div", { class: "note" }, "走っていたスレッドに、記録した関数が 1 つも開いていなかった間。この長さを詰めて描いている。"));
    tip.append(tipRow("あいだ", `${fmt(a)}–${fmt(b)}`));
  } else if (hit.type === "gutter") {
    const t = hit.lane.t;
    tip.append(h("div", { class: "fn" }, t.label));
    tip.append(tipRow("CPU", `${fmt(t.cpu)} 命令（${pct(t.cpu / M.END)}）`));
    const layers = threadLayers(t);
    if (layers) tip.append(tipRow("記録した時間の層", layers));
    tip.append(h("div", { class: "note" }, hit.lane.collapsed ? "押すと広げる" : "押すとたたむ"));
  } else ok = false;
  if (!ok) { tip.hidden = true; return; }
  tip.hidden = false;
  const wrap = $("#canvas-wrap").getBoundingClientRect();
  const tw2 = tip.offsetWidth, th = tip.offsetHeight;
  let left = x + 16, top = y + 16;
  if (left + tw2 > wrap.width - 4) left = x - tw2 - 16;
  if (left < 4) left = 4;
  if (top + th > wrap.height - 4) top = Math.max(4, y - th - 12);
  tip.style.left = left + "px"; tip.style.top = top + "px";
}

// ---------------------------------------------------------------- pointer
let drag = null;
const pointers = new Map();
main.addEventListener("pointerdown", (e) => {
  stopPlay();
  try { main.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) { const [p, q] = [...pointers.values()]; drag = { pinch: Math.hypot(p.x - q.x, p.y - q.y), cx: (p.x + q.x) / 2 }; return; }
  const onRuler = e.offsetY < G.ruler && e.offsetX >= plotX();
  drag = { x: e.offsetX, y: e.offsetY, v0: state.v0, v1: state.v1, moved: false, ruler: onRuler };
  if (onRuler) state.brush = { x0: e.offsetX, x1: e.offsetX };
});
main.addEventListener("pointermove", (e) => {
  const x = e.offsetX, y = e.offsetY;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
  if (drag && drag.pinch && pointers.size === 2) {
    const [p, q] = [...pointers.values()], d = Math.hypot(p.x - q.x, p.y - q.y);
    zoomAt(drag.cx, drag.pinch / d); drag.pinch = d; return;
  }
  if (drag) {
    if (Math.abs(x - drag.x) > 3 || Math.abs(y - drag.y) > 3) drag.moved = true;
    if (drag.ruler) { state.brush.x1 = Math.min(Math.max(x, plotX()), plotX() + plotW()); requestDraw(); return; }
    if (drag.moved) {
      const dv = ((x - drag.x) / plotW()) * (drag.v1 - drag.v0);
      setView(drag.v0 - dv, drag.v1 - dv);
      main.style.cursor = "grabbing"; tip.hidden = true; state.cross = null;
      return;
    }
  }
  if (e.pointerType === "touch") return; // no hover on a touch screen: a tap says what it is (peek)
  const hit = hitTest(x, y);
  const key = hit && (hit.s || hit.l || hit.run || hit.sw || hit.r || hit.g || hit.lane || hit.p);
  const prev = state.hover && (state.hover.s || state.hover.l || state.hover.run || state.hover.sw || state.hover.r || state.hover.g || state.hover.lane || state.hover.p);
  state.hover = hit?.type === "pin" ? { type: "slice", s: hit.s } : hit;
  state.cross = x >= plotX() ? { x } : null;
  main.style.cursor = hit && ["slice", "gutter", "link", "irq", "phase", "pin"].includes(hit.type) ? "pointer" : hit?.type === "ruler" ? "col-resize" : "grab";
  if (key !== prev || ["slice", "link", "gap", "run", "irq", "phase", "pin"].includes(hit?.type)) showTip(x, y, hit || {});
  requestDraw();
});
main.addEventListener("pointerleave", () => { state.hover = null; state.cross = null; tip.hidden = true; requestDraw(); });
const endDrag = (e) => {
  pointers.delete(e.pointerId);
  if (!drag) return;
  const d = drag; drag = null; main.style.cursor = "";
  if (d.pinch) return;
  if (d.ruler) {
    const b = state.brush; state.brush = null;
    if (b && Math.abs(b.x1 - b.x0) > 6) { const a = Math.min(b.x0, b.x1), c = Math.max(b.x0, b.x1); animateTo(vOfX(a), vOfX(c), 380); }
    requestDraw();
    return;
  }
  if (d.moved) { saveHash(); return; }
  const hit = hitTest(e.offsetX, e.offsetY);
  if (!hit) return;
  if (hit.type === "slice") { selectSlice(hit.s.id); peekSlice(hit.s); }
  else if (hit.type === "pin") { selectSlice(hit.s.id, { keepView: true }); fitInstr(hit.s.start - 1500, drawnEnd(hit.s) + 1500, 0.3); peekSlice(hit.s); }
  else if (hit.type === "gutter") toggleLane(hit.lane.t.tid);
  else if (hit.type === "link") { const l = hit.l; selectSlice(l.b, { keepView: true }); fitInstr(S[l.from].start, S[l.to].end, 0.08); peekSlice(S[l.b]); }
  else if (hit.type === "irq") { selectSlice(hit.s.id); peekSlice(hit.s); }
  else if (hit.type === "phase") { selectPhase(hit.p.num); peekPhase(hit.p); }
  else if (hit.type === "gap") fitInstr(hit.g.run[0] - 2000, hit.g.run[1] + 2000);
  else if (hit.type === "lane" && state.sel != null) { state.sel = null; if (!state.focus) refoldIfAuto(); renderPanel(); requestDraw(); hidePeek(); saveHash(); }
};
main.addEventListener("pointerup", endDrag);
// the page took the gesture (a vertical swipe scrolls it): not a tap
main.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  drag = null; state.brush = null; main.style.cursor = "";
  requestDraw();
});
main.addEventListener("dblclick", (e) => {
  const hit = hitTest(e.offsetX, e.offsetY);
  if (hit?.type === "slice") fitInstr(hit.s.start, hit.s.end, 0.12);
});
main.addEventListener("wheel", (e) => {
  if (!G.narrow && e.offsetX < G.gutter - 6) return; // over the names: let the page scroll
  e.preventDefault(); stopPlay();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * unit, dy = e.deltaY * unit;
  if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) {
    const d = ((e.shiftKey ? dy || dx : dx) / plotW()) * (state.v1 - state.v0);
    setView(state.v0 + d, state.v1 + d);
  } else zoomAt(e.offsetX, Math.exp(dy * 0.0018));
  clearTimeout(wheelSave); wheelSave = setTimeout(saveHash, 300);
}, { passive: false });
let wheelSave = 0;

// overview: drag the window, or click to go there
const ov = $("#overview");
let ovDrag = null;
ov.addEventListener("pointerdown", (e) => {
  stopPlay();
  try { ov.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
  const T = vTotal(), x = e.offsetX, xa = (state.v0 / T) * OV.w, xb = (state.v1 / T) * OV.w;
  if (e.offsetY < 13) {
    const i = iOf((x / OV.w) * T);
    const p = M.phases.find((q) => i >= q.start && i <= q.end);
    if (p) { selectPhase(p.num); return; }
  }
  if (x < xa - 2 || x > xb + 2) { const span = state.v1 - state.v0, c = (x / OV.w) * T; setView(c - span / 2, c + span / 2); }
  ovDrag = { x, v0: state.v0, v1: state.v1 };
});
ov.addEventListener("pointermove", (e) => {
  if (!ovDrag) {
    ov.style.cursor = e.offsetY < 13 ? "pointer" : "grab";
    return;
  }
  const dv = ((e.offsetX - ovDrag.x) / OV.w) * vTotal();
  setView(ovDrag.v0 + dv, ovDrag.v1 + dv);
});
ov.addEventListener("pointerup", () => { ovDrag = null; saveHash(); });
ov.addEventListener("wheel", (e) => {
  e.preventDefault();
  const T = vTotal(), c = (e.offsetX / OV.w) * T, span = Math.min(T, Math.max(MIN_SPAN, (state.v1 - state.v0) * Math.exp(e.deltaY * 0.0018)));
  setView(c - span / 2, c + span / 2);
}, { passive: false });

// ---------------------------------------------------------------- keys
document.addEventListener("keydown", (e) => {
  if ((e.target instanceof Element && e.target.closest("input, select, textarea")) || e.metaKey || e.ctrlKey || e.altKey) return;
  const span = state.v1 - state.v0, k = e.key;
  if (k === "w" || k === "+" || k === "=") zoomAt(plotX() + plotW() / 2, 0.7);
  else if (k === "s" || k === "-") zoomAt(plotX() + plotW() / 2, 1 / 0.7);
  else if (k === "a") setView(state.v0 - span * 0.2, state.v1 - span * 0.2);
  else if (k === "d") setView(state.v0 + span * 0.2, state.v1 + span * 0.2);
  else if (k === "0") showAll();
  else if (k === "ArrowRight" || k === "ArrowLeft") {
    const d = k === "ArrowRight" ? 1 : -1;
    if (state.tab === "flow") moveStep(d); else movePhase(d);
  } else if (k === "Escape") { state.focus = null; state.sel = null; state.node = null; state.step = null; clearPath(); refoldIfAuto(); renderPanel(); requestDraw(); saveHash(); hidePeek(); }
  else if (/^[1-9]$/.test(k) && M.phases[Number(k) - 1]) selectPhase(Number(k));
  else return;
  stopPlay();
  e.preventDefault();
});

// ---------------------------------------------------------------- story
// one phrase of a title: it moves to the next line whole, and breaks inside only when it alone is too long
function wordNode(w) {
  const isFn = w.kind === "app";
  return h("span", { class: isFn ? "w fn" : "w" }, w.text, w.detail ? h("span", { class: "to" }, `（${w.detail}）`) : null);
}
function topWords(p, n) {
  const own = p.words.find((w) => w.detail);
  if (own) return [own];
  const best = [...p.words].filter((w) => w.rank < 9).sort((x, y) => x.rank - y.rank || x.at - y.at).slice(0, n);
  return p.words.filter((w) => best.includes(w));
}
function phaseTitle(p, el, n = 3) {
  const ws = n === 3 ? p.head : topWords(p, n);
  const parts = [];
  ws.forEach((w, i) => { if (i) parts.push(h("span", { class: "to" }, "→")); parts.push(wordNode(w)); });
  if (p.after) return h(el, { class: "t" }, "その後：", parts.length ? parts : "タイマーと automation_ui");
  return h(el, { class: "t" }, parts);
}
function phaseWho(p) {
  if (p.after) return `${new Set(p.turns.map((u) => u.tid)).size} スレッド`;
  return thread(p.tid).name;
}
function buildStory() {
  const ol = $("#story");
  ol.replaceChildren(...M.phases.map((p) => h("li", null,
    h("button", { type: "button", class: `chip${p.after ? " after" : ""}`, dataset: { phase: p.num }, onclick: () => { stopPlay(); selectPhase(p.num); peekPhase(p); },
      onpointerenter: () => { state.hoverPhase = p.num; requestDraw(); }, onpointerleave: () => { state.hoverPhase = null; requestDraw(); } },
      h("span", { class: "num" }, p.after ? "…" : p.num),
      phaseTitle(p, "span", 2),
      h("span", { class: "m" }, h("span", { class: "who" }, phaseWho(p)), `・${fmt(p.end - p.start)} 命令`),
      h("span", { class: "bar" })))));
}
function markStory() {
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", Number(c.dataset.phase) === state.phase));
}
function selectPhase(num, opts = {}) {
  const p = M.phases.find((q) => q.num === num);
  if (!p) return;
  state.phase = num; state.focus = null; state.step = null; clearPath(); refoldIfAuto();
  markStory();
  const chip = document.querySelector(`.chip[data-phase="${num}"]`);
  chip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  if (!opts.keepTab) setTab("scene"); else renderPanel();
  saveHash();
  return fitInstr(p.start, p.end, 0.03);
}
function movePhase(d) {
  const n = state.phase == null ? (d > 0 ? 1 : M.phases.length) : Math.min(M.phases.length, Math.max(1, state.phase + d));
  selectPhase(n);
}
function showAll() { state.phase = null; markStory(); if (state.path == null && state.focus?.why !== "step") state.focus = null; animateTo(0, vTotal()); renderPanel(); saveHash(); }

let playing = null;
async function play() {
  if (playing) { stopPlay(); return; }
  const run = (playing = { cancelled: false });
  $("#play span").textContent = "止める"; $("#play").classList.add("on");
  for (const p of M.phases) {
    if (run.cancelled) break;
    await selectPhase(p.num);
    const bar = document.querySelector(`.chip[data-phase="${p.num}"] .bar`);
    const dwell = p.after ? 2600 : 3400, t0 = performance.now();
    await new Promise((ok) => {
      const tick = (now) => {
        if (run.cancelled) { if (bar) bar.style.width = "0"; ok(); return; }
        const q = Math.min(1, (now - t0) / dwell);
        if (bar) bar.style.width = `${q * 100}%`;
        if (q < 1) requestAnimationFrame(tick); else { if (bar) bar.style.width = "0"; ok(); }
      };
      requestAnimationFrame(tick);
    });
  }
  if (playing === run) stopPlay();
}
function stopPlay() {
  if (!playing) return;
  playing.cancelled = true; playing = null;
  $("#play span").textContent = "順に見る"; $("#play").classList.remove("on");
}

// ---------------------------------------------------------------- the path from the key to the DOM
function showPath(id, opts = {}) {
  const p = M.paths[id];
  if (!p) return;
  state.path = id; state.sel = null; state.step = null; state.phase = null; markStory(); refoldIfAuto();
  const ids = new Set(p.hops.flatMap((x) => x.ids || []));
  for (const l of p.links) [l.a, l.b, l.from, l.to].forEach((i) => ids.add(i));
  // the moments themselves: the key interrupt, the handler, the hook, the DOM change
  for (const i of [p.keyId, p.originId, p.handlerId, p.hookId, p.changeId]) if (i != null) ids.add(i);
  state.focus = { ids, links: new Set(p.links.map((l) => M.links.indexOf(l))), ring: true, why: "path", switches: new Set(p.hops.filter((x) => x.sw).map((x) => x.sw)) };
  $("#path-btn").classList.add("on");
  if (!opts.keepTab) setTab("scene"); else renderPanel();
  saveHash();
  return fitInstr(p.start, p.end, 0.02);
}
function clearPath() { state.path = null; $("#path-btn")?.classList.remove("on"); }

// ---------------------------------------------------------------- selection & focus
function selectSlice(id, opts = {}) {
  state.sel = id; state.node = null;
  if (!opts.keepFocus) { state.focus = null; clearPath(); }
  // a call folded into its caller is shown by showing every call
  if (!shown(S[id])) setFold(false, true);
  setTab("node");
  if (!opts.keepView) {
    const s = S[id], [x0, x1] = sliceX(s);
    if (x1 < plotX() || x0 > plotX() + plotW()) fitInstr(s.start, drawnEnd(s), 0.4);
  }
  requestDraw(); saveHash();
}
function focusNode(nid) {
  const ids = new Set(S.filter((s) => s.n === nid || (nid === "ctx.irq" && s.ctx === "ctx.irq") || (nid === "ctx.syscall" && s.ctx === "ctx.syscall")).map((s) => s.id));
  state.sel = null; state.node = nid;
  state.focus = ids.size ? { ids, links: new Set(), ring: true, why: "node" } : null;
  if ([...ids].some((i) => !shown(S[i]))) setFold(false, true);
  setTab("node");
  if (ids.size) { const xs = [...ids].map((i) => S[i]); fitInstr(Math.min(...xs.map((s) => s.start)), Math.max(...xs.map((s) => drawnEnd(s))), 0.04); }
  requestDraw(); saveHash();
}
function toggleLane(tid) {
  if (state.collapsed.has(tid)) state.collapsed.delete(tid); else state.collapsed.add(tid);
  layout(); requestDraw();
}
// auto: unfolded only to show what was chosen; it folds back when that choice is cleared
function setFold(on, auto = false) {
  if (!auto) state.autoUnfold = false;
  if (state.fold === on) return;
  if (auto) state.autoUnfold = !on;
  state.fold = on;
  document.querySelectorAll("[data-fold]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.fold === "on") === on)));
  layout(); requestDraw(); saveHash();
}

// ---------------------------------------------------------------- phone: what a tap chose
// Below 1100px the side panel sits under the timeline. A tap shows a short card at the bottom with
// a way down to the full one.
const narrowPage = matchMedia("(max-width: 1100px)");
function peek(sw, title, sub) {
  if (!narrowPage.matches) return;
  const el = $("#peek");
  $("#peek-sw").style.background = sw || "transparent";
  $("#peek-sw").hidden = !sw;
  $("#peek-t").textContent = title; $("#peek-s").textContent = sub || "";
  el.hidden = false;
}
function hidePeek() { $("#peek").hidden = true; }
function refoldIfAuto() { if (state.autoUnfold) setFold(true, true); }
function peekSlice(s) {
  const n = s.n && NODES[s.n];
  peek(layerColor(s.layer), s.kind === "irq" ? s.label : n ? n.title : s.fn,
    `${thread(s.tid).name}・${s.open ? "開いたまま" : `${fmt(s.end - s.start)} 命令`}${n && n.title !== s.fn ? `・${s.fn}` : ""}`);
}
function peekPhase(p) { peek(null, `${p.after ? "その後" : `場面 ${p.num}`}：${phaseText(p).replace(/^その後：/, "")}`, `${phaseWho(p)}・${fmt(p.end - p.start)} 命令`); }
function peekPath(p) {
  const waited = p.hops.filter((x) => x.kind === "wait").reduce((a, x) => a + x.until - x.at, 0);
  peek(null, `キー → DOM（${p.hook}）`, `${fmt(p.end - p.start)} 命令・うち列で待った ${pct(waited / (p.end - p.start), 0)}`);
}

// ---------------------------------------------------------------- side: summary
function updateSummary() {
  const sh = M.share, total = M.END, rec = total - sh.none;
  const el = $("#summary");
  el.replaceChildren(
    h("div", { class: "sum-top" }, h("h2", null, "まとめ"), h("button", { type: "button", class: "linklike", id: "table-toggle", onclick: () => { tableOpen = !tableOpen; updateRange(true); } }, tableOpen ? "表を閉じる" : "表で見る")),
    h("p", { class: "hero" }, fmt(total), h("small", null, "命令")),
    h("p", { class: "sum-sub" }, `${M.threads.length} スレッド・${S.filter((s) => s.kind === "call").length} 回の呼び出し・${RAW.events.length} イベント（記録した関数 ${RAW.run?.watching ?? Object.keys(RAW.watched).length}）`),
    h("div", { class: "thin", role: "img", "aria-label": `記録した関数の中 ${pct(rec / total)}、記録外 ${pct(sh.none / total)}` },
      h("span", { style: `flex:${rec};background:${C.run}` }), h("span", { style: `flex:${sh.none};background:${C["l-none"]}` })),
    h("div", { class: "thin-legend" }, h("span", null, `記録した関数の中 ${pct(rec / total)}`), h("span", null, `記録外 ${pct(sh.none / total)}`)),
    h("div", { class: "share-h" }, h("h3", null, "どの層で走ったか"), h("span", { class: "range", id: "range" }, "")),
    h("div", { class: "tall", id: "tall", role: "img" }),
    h("div", { class: "share-legend", id: "share-legend" }),
    h("div", { id: "share-table" }),
  );
  updateRange(true);
}
let tableOpen = false, lastRangeKey = "";
const SHARE_ORDER = ["app", "lib", "os", "kernel", "emu", "unknown"];
function updateRange(force) {
  const [i0, i1] = visibleRange();
  // the whole record, give or take a pixel's worth of rounding at the end of an animation
  const whole = i0 <= M.END * 0.001 && i1 >= M.END * 0.999;
  const key = `${whole}:${Math.round(i0 / 50)}:${Math.round(i1 / 50)}:${tableOpen}`;
  if (!force && key === lastRangeKey) return;
  lastRangeKey = key;
  const sh = M.shareIn(i0, i1), rec = SHARE_ORDER.reduce((a, k) => a + sh[k], 0);
  $("#range").textContent = whole ? "記録全体・記録した関数の中" : `${fmt(i0)}–${fmt(i1)} の中`;
  const tall = $("#tall");
  const parts = SHARE_ORDER.filter((k) => sh[k] > 0);
  tall.setAttribute("aria-label", parts.map((k) => `${LAYER_NAME[k]} ${pct(sh[k] / rec)}`).join("、") || "記録した関数なし");
  tall.replaceChildren(...(rec ? parts.map((k) => {
    const share = sh[k] / rec, w = share * 352;
    const label = pct(share, share < 0.1 ? 1 : 0);
    return h("span", { style: `flex:${sh[k]};background:${layerColor(k)}`, title: `${LAYER_NAME[k]} ${fmt(sh[k])} 命令（${pct(share)}）`, "data-empty": w < 44 ? "" : null }, w >= 44 ? label : "");
  }) : [h("span", { style: `flex:1;background:${C["l-none"]};color:${C.muted}` }, "この範囲は記録外だけ")]));
  $("#share-legend").replaceChildren(...parts.map((k) => h("span", { class: "k" }, h("span", { class: "sw", style: `background:${layerColor(k)}` }), LAYER_NAME[k])));
  const t = $("#share-table");
  t.replaceChildren(tableOpen ? h("table", { class: "share-table" },
    h("thead", null, h("tr", null, h("th", null, "層"), h("th", null, "命令"), h("th", null, "記録した中"), h("th", null, "範囲の中"))),
    h("tbody", null, [...parts, "none"].map((k) => h("tr", null, h("td", null, LAYER_NAME[k]), h("td", null, fmt(sh[k])), h("td", null, k === "none" ? "—" : pct(sh[k] / rec)), h("td", null, pct(sh[k] / (i1 - i0 || 1))))))) : "",
    tableOpen ? h("table", { class: "share-table" },
      h("thead", null, h("tr", null, h("th", null, "スレッド"), h("th", null, "CPU を持った命令"), h("th", null, "記録全体の中"))),
      h("tbody", null, M.threads.map((t) => h("tr", null, h("td", null, t.name), h("td", null, fmt(t.cpu)), h("td", null, pct(t.cpu / M.END)))))) : "");
  const tb = $("#table-toggle"); if (tb) tb.textContent = tableOpen ? "表を閉じる" : "表で見る";
}

// ---------------------------------------------------------------- side: panels
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  renderPanel();
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
function renderPanel() {
  const p = $("#panel");
  p.replaceChildren();
  if (state.tab === "scene") renderScene(p);
  else if (state.tab === "flow") renderFlow(p);
  else if (state.tab === "node") renderNode(p);
  else renderList(p);
}

// text with [[node]] links
function richText(text) {
  const out = h("div", { class: "p-text" });
  for (const para of String(text || "").split(/\n+/)) {
    if (!para.trim()) continue;
    const pEl = h("p");
    const re = /(!?)\[\[([^\]]+)\]\]/g;
    let last = 0, m;
    while ((m = re.exec(para))) {
      pEl.append(para.slice(last, m.index));
      const id = m[2], n = NODES[id];
      if (n) pEl.append(h("button", { type: "button", class: "nodelink", onclick: () => focusNode(id) }, m[1] ? `図：${n.title}` : n.title));
      else pEl.append(m[0]);
      last = re.lastIndex;
    }
    pEl.append(para.slice(last));
    out.append(pEl);
  }
  return out;
}

function stepsIn(p) {
  // which steps of the ui flow happened inside this phase
  const out = [];
  for (const f of [ATLAS.flows.find((x) => x.id === "ui"), ATLAS.flows.find((x) => x.id === "cpu")]) {
    if (!f) continue;
    f.steps.forEach((st, i) => {
      const r = stepHits(M, st, f.boxes);
      if (r.how === "alt" || !r.times || r.kindUnknown) return;
      const inPhase = (s) => p.turns.some((u) => u.tid === s.tid && s.start >= u.start && s.start < u.end);
      const inside = r.hits.some(inPhase);
      if (inside) out.push({ f, i, st });
    });
  }
  return out;
}
const stepNo = (f, i) => {
  const st = f.steps[i];
  if (st.alt) { const k = f.steps.slice(0, i + 1).filter((s) => s.alt).length; return `もし${String.fromCharCode(64 + k)}`; }
  return String(f.steps.slice(0, i + 1).filter((s) => !s.alt).length);
};

function pathButtons(el, only) {
  el.append(h("div", { class: "path-pick" }, M.paths.filter((p) => only == null || p.id === only).map((p) => h("button", { type: "button", class: "btn" + (state.path === p.id ? " on" : ""), onclick: () => (state.path === p.id ? (clearPath(), state.focus = null, renderPanel(), requestDraw(), saveHash()) : showPath(p.id)) },
    h("span", null, `${p.hook} の書き換えまで`), h("small", null, `${fmt(p.end - p.start)} 命令`)))));
}
function renderPath(el) {
  const p = M.paths[state.path];
  const total = p.end - p.start, waits = p.hops.filter((x) => x.kind === "wait"), waited = waits.reduce((a, x) => a + x.until - x.at, 0);
  el.append(
    h("p", { class: "p-eyebrow" }, "道筋・キーから DOM まで"),
    h("h2", { class: "p-title" }, h("span", { class: "fn" }, p.hook), " の書き換えまで"),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "キーから"), h("div", { class: "v" }, fmt(total), h("small", null, "命令"))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "列で待った"), h("div", { class: "v" }, fmt(waited))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "待ちの割合"), h("div", { class: "v" }, pct(waited / total, 0)))),
    h("div", { class: "thin path-bar", role: "img", "aria-label": `列で待った ${pct(waited / total)}` },
      ...pathBar(p)),
    h("p", { class: "p-note" }, "要求とイベントは列に入ってから取り出されるまで待つ。その間、ほかのスレッドが走っている（青い矢印の長さ）。"),
    h("ol", { class: "hops" }, p.hops.map((x) => h("li", { class: `hop ${x.kind}` },
      x.kind === "wait"
        ? h("button", { type: "button", onclick: () => fitInstr(x.at, x.until, 0.04) }, h("span", { class: "when" }, ""), h("span", { class: "what" }, h("b", null, x.text, `　${fmt(x.until - x.at)} 命令`), h("span", { class: "sub" }, x.sub)))
        : h("button", { type: "button", onclick: () => { const ids = x.ids || []; if (ids.length) { const xs = ids.map((i) => S[i]); fitInstr(Math.min(...xs.map((s) => s.start)), Math.max(...xs.map((s) => s.end)), 0.15); } else fitInstr(x.at - 1500, x.at + 6000); } },
          h("span", { class: "when" }, fmt(x.at)), h("span", { class: "what" }, h("b", null, x.text), h("span", { class: "sub" }, x.sub)))))),
    h("p", { class: "p-note", style: "margin-top:8px" }, "つなぎ方：要求・返事・イベントは列に入れた順と出した順で結ぶ。キーの割り込みからの切り替えは kernel.irq-dispatch の説明（入力がスレッドを起こした時は次の tick を待たずに切り替える）、ハンドラからフックは lib.send-text の説明（属性のフックが、値が変わった時だけ送る）による。"),
  );
  const next = M.paths[state.path + 1];
  if (next) el.append(h("div", { class: "scene-nav" }, h("span"), h("button", { type: "button", class: "btn", onclick: () => showPath(next.id) }, `次の書き換え（${next.hook}）→`)));
  pathButtons(el);
}
function pathBar(p) {
  const total = p.end - p.start, out = [];
  let at = p.start;
  for (const x of p.hops.filter((y) => y.kind === "wait")) {
    if (x.at > at) out.push(h("span", { style: `flex:${x.at - at};background:${C.run}`, title: `動いていた ${fmt(x.at - at)}` }));
    out.push(h("span", { style: `flex:${x.until - x.at};background:${C.accent};opacity:.55`, title: `${x.text} ${fmt(x.until - x.at)}` }));
    at = x.until;
  }
  if (p.end > at) out.push(h("span", { style: `flex:${p.end - at};background:${C.run}` }));
  return out;
}
function renderScene(el) {
  if (state.path != null) { renderPath(el); return; }
  if (state.phase == null) {
    el.append(
      h("p", { class: "p-eyebrow" }, ATLAS.traces[0].title),
      h("h2", { class: "p-title" }, "キーから DOM まで、", M.phases.length - 1, " 場面"),
      h("p", { class: "p-note" }, "CPU を持ったスレッドが替わるたびに区切った。名前は記録の中身から付けている（地図の言葉を使う）。上の場面か下の行を押すと、その時間に寄る。"),
      h("ul", { class: "occ", style: "margin-top:10px" }, M.phases.map((p) => h("li", null,
        h("button", { type: "button", onclick: () => selectPhase(p.num) },
          h("span", null, h("b", null, p.after ? "その後　" : `${p.num}　`), p.head.map((w) => w.text + (w.detail ? `（${w.detail}）` : "")).join(" → ") || "—"),
          h("span", { class: "len" }, phaseWho(p)))))),
      h("p", { class: "p-h" }, "キーから DOM までの道筋"),
      h("p", { class: "p-note" }, "書き換えごとに、キーの割り込みからイベント・ハンドラ・要求を通って DOM に届くまでを 1 本につなぐ。"),
    );
    pathButtons(el);
    el.append(
      h("p", { class: "p-h" }, "読み方"),
      h("p", { class: "p-note" }, "横は命令の数（時間の代わり）。スレッドごとに 1 段で、下ほど深い呼び出し。濃い色は地図のノード、淡い色は地図にない関数（層は置き場所から）。斜線の部分は、そのスレッドが CPU を離れて待っていた間。青い矢印は、列を通ってスレッドをまたいだ要求・返事・イベント。"),
      h("p", { class: "p-note", style: "margin-top:6px" }, "番号の付いた札は場面の要所（キーの割り込み・キーを配る・ハンドラ・DOM の書き換え）で、番号は上の場面と同じ。押すとそこへ寄る。"),
      h("p", { class: "p-note", style: "margin-top:6px" }, "「要所だけ」は、割り込みと syscall を 1 本にたたみ、その外も地図のノード・アプリの関数・要所だけを描く。中の呼び出しは「すべて」で見える（手順やノードを選ぶと自動で切り替わる）。"),
      h("p", { class: "p-h" }, "キー"),
      h("p", { class: "p-note" }, "← → 場面（流れのタブでは手順）・1〜7 場面へ・W S 拡大・A D 移動・0 全体・Esc 選択を外す"),
    );
    return;
  }
  const p = M.phases.find((q) => q.num === state.phase);
  el.append(
    h("p", { class: "p-eyebrow" }, p.after ? "その後" : `場面 ${p.num} / ${M.phases.length - 1}`, `・${fmt(p.start)}–${fmt(p.end)}（${fmt(p.end - p.start)} 命令）`),
    phaseTitle(p, "h2"),
  );
  el.lastChild.className = "p-title";
  const who = p.after ? p.turns.map((u) => thread(u.tid).name) : [thread(p.tid).name];
  el.append(h("p", { class: "p-note" }, p.after ? `この間に CPU を持ったのは ${[...new Set(who)].join("・")}（${p.turns.length} 回の番）。` : `${who[0]} が CPU を持っていた番。`));
  const sh = M.shareIn(p.start, p.end), rec = SHARE_ORDER.reduce((a, k) => a + sh[k], 0);
  el.append(h("div", { class: "stats" },
    h("div", { class: "stat" }, h("div", { class: "k" }, "長さ"), h("div", { class: "v" }, fmt(p.end - p.start), h("small", null, "命令"))),
    h("div", { class: "stat" }, h("div", { class: "k" }, "記録した関数の中"), h("div", { class: "v" }, pct(rec / (p.end - p.start), 0))),
    h("div", { class: "stat" }, h("div", { class: "k" }, "呼び出し"), h("div", { class: "v" }, S.filter((s) => s.kind === "call" && s.start >= p.start && s.start < p.end).length, h("small", null, "回")))));
  el.append(h("p", { class: "p-h" }, "起きたこと（時間の順）"));
  el.append(h("ul", { class: "occ words" }, p.words.map((w) => h("li", { class: w.rank >= 8 ? "minor" : null },
    h("button", { type: "button", onclick: () => { if (w.ref != null) { selectSlice(w.ref, { keepView: true }); fitInstr(S[w.ref].start, S[w.ref].end, 0.25); } else fitInstr(w.at - 500, w.at + 4000); } },
      h("span", { class: "when" }, fmt(w.at)),
      h("span", { class: "what" }, w.text, w.detail ? `（${w.detail} の要求）` : "", w.ref != null && w.kind !== "app" && w.kind !== "irq" ? h("span", { class: "fn" }, S[w.ref].kind === "irq" ? S[w.ref].label : S[w.ref].fn) : null))))));
  const own = M.paths.find((x) => p.turns.some((u) => S[x.change].tid === u.tid && S[x.change].start >= u.start && S[x.change].start < u.end));
  if (own) { el.append(h("p", { class: "p-h" }, "この書き換えの道筋")); pathButtons(el, own.id); }
  const steps = stepsIn(p);
  if (steps.length) {
    el.append(h("p", { class: "p-h" }, "この場面で起きた、流れの手順"));
    el.append(h("div", { class: "steps-badges" }, steps.map(({ f, i, st }) => h("button", { type: "button", class: "badge", onclick: () => pickStep(f.id, i) },
      h("b", null, stepNo(f, i)), `${f.id === "ui" ? "UI" : "CPU"}・${st.verb || shortLabel(st.label)}`))));
  }
  el.append(h("div", { class: "scene-nav" },
    h("button", { type: "button", class: "btn", disabled: p.num <= 1 ? true : null, onclick: () => movePhase(-1) }, "← 前の場面"),
    h("button", { type: "button", class: "btn", onclick: showAll }, "全体"),
    h("button", { type: "button", class: "btn", disabled: p.num >= M.phases.length ? true : null, onclick: () => movePhase(1) }, "次の場面 →")));
}
const shortLabel = (s) => (s || "").replace(/[。、].*$/, "").slice(0, 16);

// flows and papers
const FLOWS = [
  ...ATLAS.flows.map((f) => ({ id: f.id, title: f.tab, desc: f.title, f, owner: null })),
  ...Object.entries(ATLAS.papers).map(([id, p]) => ({ id, title: p.title, desc: `${NODES[id]?.title ?? id} の中の紙`, f: { ...p, id }, owner: id, paper: true })),
];
function pickStep(flowId, i) {
  state.flow = flowId; state.step = i; clearPath(); setTab("flow");
  applyStep(true); requestAnimationFrame(scrollToStep);
}
function applyStep(zoom) {
  const F0 = FLOWS.find((x) => x.id === state.flow);
  if (state.step == null || !F0) { state.focus = null; requestDraw(); return; }
  const r = stepHits(M, F0.f.steps[state.step], F0.f.boxes, F0.owner);
  const linkIdx = new Set(r.links.map((l) => M.links.indexOf(l)));
  state.focus = r.hits.length ? { ids: new Set(r.hits.map((s) => s.id)), links: linkIdx, ring: true, why: "step" } : null;
  state.sel = null;
  // the calls of a step inside an interrupt or a syscall are folded: show every call
  if (r.hits.some((s) => !shown(s))) setFold(false, true);
  if (zoom && r.hits.length) {
    const a = Math.min(...r.hits.map((s) => s.start)), b = Math.max(...r.hits.map((s) => s.end));
    fitInstr(a, b, 0.05);
  }
  requestDraw(); saveHash();
}
function moveStep(d) {
  const F0 = FLOWS.find((x) => x.id === state.flow);
  const n = F0.f.steps.length;
  state.step = state.step == null ? (d > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, state.step + d));
  renderPanel(); applyStep(true); scrollToStep();
}
// keep the chosen step in view inside the panel (the page itself does not move)
function scrollToStep() {
  const panel = $("#panel"), li = panel.querySelector("ol.steps li.cur");
  if (!li) return;
  const top = li.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
  panel.scrollTo({ top: Math.max(0, top - 90), behavior: reduceMotion ? "auto" : "smooth" });
}
function renderFlow(el) {
  const F0 = FLOWS.find((x) => x.id === state.flow) || FLOWS[0];
  const pick = (x) => h("button", { type: "button", class: x.paper ? "small" : null, "aria-pressed": String(x.id === F0.id), title: x.paper ? x.title : x.desc,
    onclick: () => { state.flow = x.id; state.step = null; state.focus = null; renderPanel(); requestDraw(); saveHash(); } }, x.paper ? x.f.tab || NODES[x.id]?.title : x.title);
  el.append(h("div", { class: "flow-pick" }, FLOWS.filter((x) => !x.paper).map(pick)),
    h("div", { class: "flow-pick" }, h("span", { class: "flow-pick-h" }, "中の紙"), FLOWS.filter((x) => x.paper).map(pick)));
  const all = F0.f.steps.map((st, i) => ({ st, i, r: stepHits(M, st, F0.f.boxes, F0.owner) }));
  const seen = all.filter((x) => x.r.times > 0 && !x.r.kindUnknown).length;
  el.append(h("h2", { class: "p-title" }, F0.paper ? F0.title : F0.desc));
  el.append(h("p", { class: "p-note" }, `${all.length} の手順のうち、この記録で起きたのは ${seen}。手順を押すと、その手順にあたる呼び出しだけが濃くなる。`,
    F0.id === "ui" ? "地図の流れはタスクマネージャの例だが、この記録はエディタ。同じ道（send_text → request → OS_CALL → gateway → 列 → serve → handle）を通る。" : ""));
  el.append(h("ol", { class: "steps" }, all.map(({ st, i, r }) => {
    const cur = state.step === i;
    const count = r.how === "alt" ? h("span", { class: "cnt zero" }, "もしもの時")
      : r.kindUnknown ? h("span", { class: "cnt zero" }, `同じ道 ${r.times}・種類は不明`)
      : r.times ? h("span", { class: "cnt" }, `記録 ${r.times}`)
      : r.unwatched.length ? h("span", { class: "cnt zero", title: "この手順の関数は記録していないので、起きたかどうか分からない" }, "記録外の関数")
      : h("span", { class: "cnt zero" }, "記録になし");
    const li = h("li", { class: cur ? "cur" : null },
      h("button", { type: "button", onclick: () => { state.step = cur ? null : i; renderPanel(); applyStep(!cur); if (!cur) requestAnimationFrame(scrollToStep); } },
        h("span", { class: `sno${st.alt ? " alt" : ""}` }, stepNo(F0.f, i)),
        h("span", { class: "sverb" }, h("span", null, st.verb || boxTitle(F0.f, st.to)), count),
        h("span", { class: "slabel" }, plainText(st.label))));
    if (cur) li.append(stepDetail(F0, st, r));
    return li;
  })));
}
const boxTitle = (f, id) => f.boxes.find((b) => b.id === id)?.title || id;
const plainText = (t) => String(t || "").replace(/!?\[\[([^\]]+)\]\]/g, (_, id) => NODES[id]?.title || id);
function stepDetail(F0, st, r) {
  const box = h("div", { class: "step-more" });
  const A = F0.f.boxes.find((b) => b.id === st.from), B = F0.f.boxes.find((b) => b.id === st.to);
  box.append(h("p", { class: "p-note" }, `${A?.title ?? st.from} → ${B?.title ?? st.to}`, st.data?.label ? `・渡すもの ${st.data.label}` : ""));
  if (r.how === "alt") {
    const q = M.links.filter((l) => l.kind === "queue").length, sub = S.filter((s) => s.n === "os.submit").length;
    box.append(h("p", { class: "p-note" }, `もしもの手順（${st.alt?.when ?? ""}の時）。`, st.alt?.when === "満杯" && q === sub ? `この記録では、${sub} 回の要求がどれも列に入って取り出された（青い矢印）。` : ""));
    return box;
  }
  for (const a of r.absent) box.append(h("p", { class: "p-note" }, `${NODES[a.id]?.title ?? a.id}：${a.why}`));
  if (r.instead && r.instead.list.length) {
    const n = NODES[r.instead.node];
    const list = r.instead.list.map(([fn, c]) => `${fn ?? "記録外の呼び元"} ×${c}`).join("、");
    box.append(h("p", { class: "p-note" }, r.instead.role === "callers" ? `この記録で ${n.title} を呼んだのは ${list}。` : `この記録で ${n.title} が呼んだのは ${list}。`));
  }
  if (r.svc) box.append(h("p", { class: "p-note" }, `OS_CALL のうち service が ${r.svc} のものだけ。`));
  if (r.how === "msg" && r.links.some((l) => l.kind === "event")) {
    const origins = [...new Set(r.links.map((l) => l.origin).filter(Boolean))];
    box.append(h("p", { class: "p-note" }, r.kindUnknown ? `この手順は ${r.kindUnknown} のイベント。記録はイベントの種類を残さないので、同じ道（app_events.push から POLL での受け取りまで）を通ったものを示す。` : "app_events.push から POLL での受け取りまで。",
      origins.length ? `この記録のイベントは ${origins.join("・")} の中で入れられた。` : ""));
  }
  if (r.how === "msg") {
    box.append(h("ul", { class: "occ" }, r.links.map((l) => {
      const a = S[l.a], b = S[l.b];
      return h("li", null, h("button", { type: "button", onclick: () => { selectSlice(l.b, { keepView: true }); fitInstr(a.start, b.end, 0.06); } },
        h("span", { class: "when" }, `${short(a.fn)}（${thread(a.tid).name}）→ ${short(b.fn)}（${thread(b.tid).name}）`),
        h("span", { class: "len" }, `${fmt(S[l.from].end)} → ${fmt(S[l.to].start)}`)));
    })));
  } else if (r.hits.length) {
    const toNode = F0.f.boxes.find((b) => b.id === st.to)?.node;
    // one row per time the step happened: the callee for a call, else each recorded end
    const rows = r.how === "call" || r.how === "seq" ? r.hits.filter((s) => s.n === toNode) : r.how === "irq" ? r.hits.filter((s) => s.kind === "irq") : r.hits;
    box.append(h("ul", { class: "occ" }, rows.slice(0, 30).map((s) => h("li", null,
      h("button", { type: "button", onclick: () => { selectSlice(s.id, { keepView: true }); fitInstr(s.start, s.end, 0.3); } },
        h("span", { class: "when" }, `${thread(s.tid).name}・${s.kind === "irq" ? s.label : s.fn}`),
        h("span", { class: "len" }, `${fmt(s.start)}・${fmt(s.end - s.start)} 命令`))))));
    if (rows.length > 30) box.append(h("p", { class: "p-note" }, `ほか ${rows.length - 30} 回`));
  }
  const at = CODE.steps?.[F0.id]?.[st === undefined ? "" : F0.f.steps.indexOf(st)];
  if (at) box.append(h("p", { class: "p-note" }, `コードの場所：${at.path}:${at.line}`));
  return box;
}

// node card
function stepsFor(nid) {
  const out = [];
  for (const F0 of FLOWS) F0.f.steps.forEach((st, i) => {
    const nodeOfBox = (id) => F0.f.boxes.find((b) => b.id === id)?.node;
    if ([nodeOfBox(st.from), nodeOfBox(st.to), st.ref].includes(nid)) out.push({ F0, st, i });
  });
  return out;
}
function renderNode(el) {
  const s = state.sel != null ? S[state.sel] : null;
  const nid = s ? s.n || s.ctx : state.node;
  if (!s && !nid) {
    el.append(h("p", { class: "p-note" }, "呼び出しを押すと、ここにノードの説明と、この記録での回数・長さが出る。"));
    return;
  }
  const n = nid ? NODES[nid] : null;
  if (s) {
    el.append(h("p", { class: "p-eyebrow" }, `${thread(s.tid).name}・${fmt(s.start)}–${s.open ? "（記録の終わりまで戻らない）" : fmt(s.end)}`));
    const lay = s.layer;
    el.append(h("div", { class: "tagrow" },
      h("span", { class: "layer-chip" }, h("span", { class: "sw", style: `background:${layerColor(lay)};${s.inferred ? "opacity:.5" : ""}` }), lay ? LAYER_NAME[lay] : "層が分からない", s.inferred && s.kind === "call" && lay ? "（置き場所から）" : ""),
      h("span", { class: "tag" }, s.kind === "irq" ? (s.trap === "syscall" ? "syscall" : "割り込み") : n ? "地図のノード" : "地図にない関数")));
    el.append(h("h2", { class: "p-title" }, s.kind === "irq" ? s.label : n && s.n ? n.title : h("span", { class: "fn" }, s.notNode ? s.label : s.fn)));
    if (s.kind === "call" && n && n.title !== s.fn) el.append(h("p", { class: "p-sub" }, s.fn));
    if (s.kind === "irq") {
      const bits = [];
      if (s.trap === "syscall") bits.push(`syscall ${s.syscall}`, s.service ? `service ${s.service}` : null);
      else bits.push(`原因 ${causeJa(s.cause)}`);
      if (s.interrupted) bits.push(`止めた先 ${s.interrupted}`);
      el.append(h("p", { class: "p-sub" }, `irq_dispatch.entry・${bits.filter(Boolean).join("・")}`));
    }
    const dur = s.end - s.start;
    el.append(h("div", { class: "stats" },
      h("div", { class: "stat" }, h("div", { class: "k" }, "長さ"), s.open ? h("div", { class: "v small" }, "開いたまま") : h("div", { class: "v" }, fmt(dur), h("small", null, "命令"))),
      h("div", { class: "stat" }, h("div", { class: "k" }, "CPU 上"), h("div", { class: "v" }, fmt(s.cpuIn))),
      h("div", { class: "stat", title: "記録した呼び先と待ちを除く（記録外の呼び先は含む）" }, h("div", { class: "k" }, "自分だけ"), h("div", { class: "v" }, fmt(s.selfOn)))));
    if (s.abandoned) el.append(h("p", { class: "p-note", style: "margin-top:6px" }, `${fmt(s.lastOn)} 命令目で CPU が離れ、この文脈には記録の終わりまで戻らない（走るもの無しは、待っているスレッドではない）。戻ったか、いつ戻ったかは記録に無いので、長さは分からない。`));
    else if (s.open) el.append(h("p", { class: "p-note", style: "margin-top:6px" }, `記録の終わり（${fmt(M.END)} 命令目）でもまだ戻っていない。${s.cpuIn < dur ? `${thread(s.tid).name} はそれまで CPU を離れて待っていた（斜線）。` : ""}`));
    else if (s.cpuIn < dur) el.append(h("p", { class: "p-note", style: "margin-top:6px" }, `このうち ${fmt(dur - s.cpuIn)} 命令は、${thread(s.tid).name} が CPU を離れて待っていた間（斜線）。`));
    el.append(h("p", { class: "p-note", style: "margin-top:4px" }, "自分だけ：記録した呼び先と待ちを除いた長さ。記録していない呼び先の分は含む。"));
    if (s.notNode) {
      el.append(h("div", { class: "fixnote" },
        h("p", null, h("b", null, "OS_CALL ではない"), `：地図の記録（ATLAS.traces[0]）は syscall.dispatch をすべて OS_CALL（kernel.os-call）に結んでいる。この呼び出しの syscall は ${s.notNode.syscall} で、dispatch の中では OS_CALL とは別の枝を通る（下のコード）。ここでは OS_CALL に数えない。`),
        h("button", { type: "button", class: "nodelink", onclick: () => focusNode(s.notNode.n) }, `${NODES[s.notNode.n].title} のノードを見る`)));
    }
    // the stack
    const chain = [];
    for (let p = s; p; p = p.parent === null ? null : S[p.parent]) chain.unshift(p);
    el.append(h("p", { class: "p-h" }, "呼ばれた道"));
    el.append(h("div", { class: "path" }, chain.flatMap((c, k) => [k ? h("span", { class: "sep" }, "›") : null,
      h("button", { type: "button", class: c === s ? "here" : null, onclick: () => selectSlice(c.id, { keepView: true }) }, c.kind === "irq" ? c.label : c.fn)])));
    if (chain[0].parent === null && chain[0].depth === 0) el.append(h("p", { class: "p-note", style: "margin-top:4px" }, "いちばん外の呼び元は記録していない関数。"));
    if (s.children.length) {
      el.append(h("p", { class: "p-h" }, "この中で呼んだもの"));
      el.append(h("ul", { class: "occ" }, s.children.map((i) => S[i]).map((c) => h("li", null,
        h("button", { type: "button", onclick: () => selectSlice(c.id, { keepView: true }) },
          h("span", { class: "when" }, c.kind === "irq" ? c.label : c.notNode ? c.label : c.fn), h("span", { class: "len" }, c.open ? "開いたまま" : `${fmt(c.end - c.start)} 命令`))))));
    }
    // messages
    const ls = M.links.filter((l) => [l.a, l.b, l.from, l.to].includes(s.id));
    for (const l of ls) {
      const other = l.from === s.id || l.a === s.id ? S[l.to] : S[l.from];
      el.append(h("p", { class: "p-note", style: "margin-top:8px" }, `${LINK_NAME[l.kind]}：`,
        h("button", { type: "button", class: "nodelink", onclick: () => selectSlice(other.id) }, `${thread(other.tid).name} の ${other.fn}（${fmt(other.start)}）`),
        l.from === s.id || l.a === s.id ? " へ" : " から"));
    }
  } else if (n) {
    el.append(h("div", { class: "tagrow" }, h("span", { class: "layer-chip" }, h("span", { class: "sw", style: `background:${layerColor(n.layer)}` }), LAYER[n.layer]?.name ?? n.layer), h("span", { class: "tag" }, "地図のノード")));
    el.append(h("h2", { class: "p-title" }, n.title));
    if (n.fn && n.fn !== n.title) el.append(h("p", { class: "p-sub" }, n.fn));
  }
  if (n) {
    el.append(richText(n.text));
    if (n.api?.sig) el.append(h("pre", { class: "sig" }, n.api.sig));
    if (n.api?.params?.length) el.append(h("dl", { class: "params" }, n.api.params.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, plainText(v))])));
    if (n.api?.ret) el.append(h("dl", { class: "params" }, h("dt", null, "返す"), h("dd", null, plainText(n.api.ret))));
    if (n.kind === "context") el.append(h("p", { class: "p-note" }, `走る：${n.run ?? "—"}${n.kernel ? "・カーネルの中" : ""}`));
    // in this record
    const mine = S.filter((x) => x.n === nid || (n.kind === "context" && x.ctx === nid));
    el.append(h("p", { class: "p-h" }, "この記録で"));
    if (!mine.length) el.append(h("p", { class: "p-note" }, `${absentWhy(M, nid)}。`));
    else {
      // a call that never returned has no length: it is counted, but not added up
      const closed = mine.filter((x) => !x.open), open = mine.length - closed.length;
      const total = closed.reduce((a, x) => a + x.end - x.start, 0), self = mine.reduce((a, x) => a + x.selfOn, 0);
      el.append(h("div", { class: "stats" },
        h("div", { class: "stat" }, h("div", { class: "k" }, "回数"), h("div", { class: "v" }, mine.length, h("small", null, "回"))),
        h("div", { class: "stat" }, h("div", { class: "k" }, open ? "戻った回の長さ" : "合計の長さ"), h("div", { class: "v" }, fmt(total))),
        h("div", { class: "stat", title: "記録した呼び先と待ちを除く（記録外の呼び先は含む）" }, h("div", { class: "k" }, "自分だけ"), h("div", { class: "v" }, fmt(self)))));
      const byThread = [...new Set(mine.map((x) => x.tid))].map((t) => thread(t).name).join("・");
      el.append(h("p", { class: "p-note", style: "margin-top:6px" }, `走ったスレッド：${byThread}`, mine.length > 1 ? "。押すと、その回に寄る。" : "",
        open ? `うち ${open} 回は記録の終わりまで戻らない（開いたまま）ので、長さの合計に入れていない。` : ""));
      if (nid === "kernel.os-call" && M.fixes.length) {
        const all = M.fixes.length + mine.length;
        el.append(h("p", { class: "p-note", style: "margin-top:4px" }, `この記録の syscall.dispatch ${all} 回のうち ${M.fixes.length} 回は WAIT_NOTIFICATION の syscall なので、ここに数えない（地図の記録はすべて OS_CALL に結んでいる）。`));
      }
      el.append(h("ul", { class: "occ" }, mine.slice(0, 40).map((x) => h("li", null,
        h("button", { type: "button", class: s && x.id === s.id ? "cur" : null, onclick: () => { selectSlice(x.id, { keepView: true }); fitInstr(x.start, drawnEnd(x), 0.3); } },
          h("span", { class: "when" }, `${fmt(x.start)}・${thread(x.tid).name}`), h("span", { class: "len" }, x.open ? "開いたまま" : `${fmt(x.end - x.start)} 命令`))))));
    }
    const st = stepsFor(nid);
    if (st.length) {
      el.append(h("p", { class: "p-h" }, "出てくる手順"));
      el.append(h("div", { class: "steps-badges" }, st.map(({ F0, st: x, i }) => h("button", { type: "button", class: "badge", onclick: () => pickStep(F0.id, i) },
        h("b", null, stepNo(F0.f, i)), `${F0.paper ? "紙" : F0.title}・${x.verb || shortLabel(x.label)}`))));
    }
  } else if (s && s.kind === "call" && !s.notNode) {
    el.append(h("p", { class: "p-note", style: "margin-top:10px" }, `地図にまだ無い関数。記録した ${Object.keys(RAW.watched).length} 関数の 1 つなので名前と長さは分かるが、説明は地図に無い。`));
  }
  // code
  const loc = nid && CODE.nodes[nid];
  const file = loc?.path || (s && s.file);
  if (file) {
    el.append(h("p", { class: "p-h" }, "コード"));
    const name = loc?.symbol || (s ? short(s.fn) : null);
    const info = h("p", { class: "p-sub" }, `${file}${loc?.start ? `:${loc.start}–${loc.end}` : ""}`);
    el.append(info);
    if (CODE.files[file]) {
      const box = h("div", { class: "code" }, h("div", null, h("i", null, ""), "読み込み中…"));
      el.append(box);
      // for a syscall that is not OS_CALL: its own branch of dispatch
      const branch = s?.notNode ? new RegExp(`Syscall::${s.notNode.syscall}\\b`) : null;
      showCode(box, file, loc?.start ? [loc.start, loc.end] : null, name, info, branch);
    } else if (s?.fileFrom === "source") el.append(h("p", { class: "p-note" }, "記録にはこの関数のファイルが無い。MyComputer のソースで、MyStdLib のこのファイルが定義している（アセンブリなので写しは無い）。層はこの置き場所から。"));
    else el.append(h("p", { class: "p-note" }, "このファイルは地図が指していないので、写しが無い。"));
  }
}
const codeCache = new Map();
async function showCode(box, path, span, name, info, branch) {
  try {
    if (!codeCache.has(path)) codeCache.set(path, fetch(`../data/src/${path}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status))));
    const lines = (await codeCache.get(path)).split("\n");
    let [a, b] = span || findDef(lines, name) || [0, 0];
    if (!a) { box.replaceChildren(h("div", null, h("i", null, ""), "定義が見つからない")); return; }
    if (!span) info.textContent = `${path}:${a}–${b}（関数名から探した）`;
    let hl = null;
    if (branch) {
      // just that branch: from its `if` to the brace that closes it
      const k = lines.findIndex((t, j) => j >= a - 1 && j < b && branch.test(t));
      if (k >= 0) {
        let depth = 0, e = k;
        for (let j = k; j < b; j++) { for (const ch of lines[j].replace(/\/\/.*$/, "")) { if (ch === "{") depth++; else if (ch === "}") depth--; } if (depth <= 0 && j > k) { e = j; break; } }
        a = k + 1; b = e + 1; hl = a;
        info.textContent = `${path}:${a}–${b}（dispatch の中の ${branch.source.replace(/^Syscall::|\\b$/g, "")} の枝）`;
      }
    }
    const end = Math.min(b, a + 59);
    box.replaceChildren(...lines.slice(a - 1, end).map((t, k) => {
      const c = t.indexOf("//");
      return h("div", { class: a + k === hl ? "hl" : null }, h("i", null, a + k), c >= 0 ? [t.slice(0, c), h("span", { class: "c" }, t.slice(c))] : t || " ");
    }), ...(b > end ? [h("div", null, h("i", null, ""), h("span", { class: "c" }, `… あと ${b - end} 行`))] : []));
  } catch { box.replaceChildren(h("div", null, h("i", null, ""), "読み込めなかった")); }
}
function findDef(lines, name) {
  if (!name) return null;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k];
    if (!re.test(t) || /;\s*$/.test(t) || /^\s{8,}/.test(t) || /^\s*(\/\/|\*)/.test(t) || /\breturn\b|=\s*\w*\s*\(/.test(t.split(name)[0])) continue;
    // a definition opens a body
    let depth = 0, opened = false;
    for (let j = k; j < lines.length; j++) {
      for (const ch of lines[j].replace(/\/\/.*$/, "")) { if (ch === "{") { depth++; opened = true; } else if (ch === "}") depth--; }
      if (opened && depth <= 0) return [k + 1, j + 1];
      if (!opened && j > k + 3) break;
    }
  }
  return null;
}

// list view: every call, as a table
function renderList(el) {
  const sel = (id, opts, val, on) => h("select", { id, onchange: (e) => { on(e.target.value); renderPanel(); } }, opts.map(([v, t]) => h("option", { value: v, selected: v === val ? true : null }, t)));
  el.append(h("div", { class: "list-tools" },
    sel("lt", [["all", "すべてのスレッド"], ...M.threads.map((t) => [String(t.tid), t.name])], state.listThread, (v) => (state.listThread = v)),
    sel("ll", [["all", "すべての層"], ...["app", "lib", "os", "kernel", "unknown"].map((k) => [k, LAYER_NAME[k]]), ["node", "地図のノードだけ"]], state.listLayer, (v) => (state.listLayer = v))));
  let rows = S.filter((s) => (state.listThread === "all" || String(s.tid) === state.listThread)
    && (state.listLayer === "all" || (state.listLayer === "node" ? !!s.n : (s.layer || "unknown") === state.listLayer)));
  // A call still open at the end of the record has no length: by length, those come after the rest.
  const key = { dur: (s) => (s.open ? 1e9 + s.start : -(s.end - s.start)), start: (s) => s.start, self: (s) => -s.selfOn }[state.listSort];
  rows = rows.sort((a, b) => key(a) - key(b));
  const th = (k, t, title) => h("th", { class: k === "fn" ? null : "num", title }, k === "fn" ? t : h("button", { type: "button", "data-on": state.listSort === k ? "" : null, onclick: () => { state.listSort = k; renderPanel(); } }, t));
  const open = rows.filter((s) => s.open).length;
  el.append(h("p", { class: "p-note", style: "margin-bottom:6px" }, `${rows.length} 件。見出しで並べ替え。行を押すと寄る。`,
    open ? `「開いたまま」の ${open} 件は記録の終わりまで戻らなかった呼び出しで、長さは分からない。` : ""));
  el.append(h("table", { class: "calls" },
    h("thead", null, h("tr", null, th("fn", "呼び出し"), th("start", "始まり"), th("dur", "長さ"), th("self", "自分だけ", "記録した呼び先と待ちを除く（記録外の呼び先は含む）"))),
    h("tbody", null, rows.map((s) => h("tr", { class: state.sel === s.id ? "sel" : null },
      h("td", { class: "fn" }, h("button", { type: "button", onclick: () => { selectSlice(s.id, { keepView: true }); fitInstr(s.start, drawnEnd(s), 0.3); state.tab = "list"; } },
        h("span", { class: "sw", style: `background:${layerColor(s.layer)};${s.inferred ? "opacity:.45" : ""}` }), s.kind === "irq" ? s.label : s.notNode ? s.label : s.fn)),
      h("td", { class: "num" }, fmt(s.start)),
      h("td", { class: "num" }, s.open ? h("span", { class: "open-badge", title: s.abandoned ? "CPU がこの文脈に戻らないまま記録が終わる" : "記録の終わりでもまだ戻っていない" }, "開いたまま") : fmt(s.end - s.start)),
      h("td", { class: "num" }, fmt(s.selfOn)))))));
}

// ---------------------------------------------------------------- header & legend
function buildHeader() {
  const t = ATLAS.traces[0], run = RAW.run || t.run || {};
  $("#title").replaceChildren(h("span", { class: "kicker" }, "記録を時間で見る"), t.title);
  const d = (t.date || "").replace("T", " ").slice(0, 16);
  const b = t.build?.MyComputer;
  $("#meta").replaceChildren(d, "・", h("b", null, fmt(M.END)), " 命令・", `${M.threads.length} スレッド`, b ? `・build ${b}` : "", `・記録 ${RAW.source}`);
  const names = { text: "本文", title: "タイトル", position: "位置" };
  const dl = $("#change");
  for (const k of Object.keys(run.after || {})) {
    const was = run.before?.[k] ?? "", now = run.after[k];
    dl.append(h("dt", null, names[k] || k), h("dd", { class: "was" }, `「${was}」`), h("dd", { class: "arrow" }, "→"), h("dd", { class: was === now ? "same" : "now" }, `「${now}」`));
  }
  if (M.problems.length) document.querySelector(".timeline-card").prepend(h("p", { class: "banner" }, `記録の 2 つの写しが合わない所がある：${M.problems.slice(0, 3).join("・")}`));
}
function buildLegend() {
  // every colour that is drawn, a grey one included when some call's layer is not known
  const present = ["app", "lib", "os", "kernel", "emu"].filter((k) => S.some((s) => s.layer === k));
  if (S.some((s) => !s.layer)) present.push("unknown");
  $("#legend").replaceChildren(
    h("span", { class: "lg" }, ...present.map((k) => h("span", { class: "k" }, h("span", { class: "sw", style: `background:${layerColor(k)}` }), LAYER_NAME[k]))),
    h("span", { class: "lg" },
      h("span", { class: "k" }, h("span", { class: "sw", style: `background:${layerColor("os")}` }), "濃い：地図のノード"),
      h("span", { class: "k" }, h("span", { class: "sw tint", style: `background:${layerColor("os")}` }), "淡い：地図にない"),
      h("span", { class: "k" }, h("span", { class: "sw hollow" }), "斜線：待ち"),
      h("span", { class: "k" }, h("span", { class: "sw run" }), "CPU を持つ"),
      h("span", { class: "k" }, h("span", { class: "sw msg" }), "列を通る"),
      h("span", { class: "k", title: "記録した関数が 1 つも開いていない長い間。「記録外を詰める」では短く描き、長さを添える" }, h("span", { class: "sw gap" }), "記録外（詰めた間）"),
      h("span", { class: "k" }, h("span", { class: "sw pin" }, "3"), "場面の要所")));
}

// ---------------------------------------------------------------- address
function saveHash() {
  const p = new URLSearchParams();
  if (mix < 0.5) p.set("axis", "real");
  if (!state.fold) p.set("calls", "all");
  if (state.phase != null) p.set("phase", state.phase);
  if (state.path != null) p.set("path", state.path + 1);
  if (state.tab === "flow" && state.step != null) p.set("step", `${state.flow}:${state.step}`);
  if (state.sel != null) p.set("call", S[state.sel].seqIn);
  else if (state.node) p.set("node", state.node);
  if (state.tab !== "scene") p.set("tab", state.tab);
  const s = p.toString();
  history.replaceState(null, "", s ? "#" + s : location.pathname);
}
function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("axis") === "real") { mix = 0; document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === "linear"))); }
  if (p.get("calls") === "all") setFold(false);
  state.v0 = 0; state.v1 = vTotal();
  const tab = p.get("tab");
  if (p.get("phase")) selectPhase(Number(p.get("phase")), { keepTab: !!tab });
  if (p.get("step")) { const [f, i] = p.get("step").split(":"); pickStep(f, Number(i)); }
  if (p.get("call")) { const s = S.find((x) => x.seqIn === Number(p.get("call"))); if (s) { selectSlice(s.id, { keepView: true }); fitInstr(s.start, s.end, 0.4); } }
  if (p.get("node")) focusNode(p.get("node"));
  if (p.get("path")) showPath(Number(p.get("path")) - 1, { keepTab: !!tab });
  if (tab && state.tab !== tab) setTab(tab);
}

// ---------------------------------------------------------------- start
readTheme(); makeHatch();
buildHeader(); buildLegend(); buildStory();
layout();
state.v0 = 0; state.v1 = vTotal();
updateSummary();
renderPanel();
loadHash();
requestDraw();
$("#play").addEventListener("click", play);
$("#path-btn").addEventListener("click", () => {
  stopPlay();
  if (state.path != null) { clearPath(); state.focus = null; renderPanel(); requestDraw(); saveHash(); hidePeek(); }
  else { showPath(0); peekPath(M.paths[0]); }
});
$("#prev").addEventListener("click", () => { stopPlay(); movePhase(-1); });
$("#next").addEventListener("click", () => { stopPlay(); movePhase(1); });
document.querySelectorAll("[data-fold]").forEach((b) => b.addEventListener("click", () => setFold(b.dataset.fold === "on")));
$("#peek-go").addEventListener("click", () => { hidePeek(); $(".side").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); });
$("#peek-x").addEventListener("click", hidePeek);
$("#zoom-in").addEventListener("click", () => zoomAt(plotX() + plotW() / 2, 0.6));
$("#zoom-out").addEventListener("click", () => zoomAt(plotX() + plotW() / 2, 1 / 0.6));
$("#zoom-all").addEventListener("click", showAll);
$("#show-links").addEventListener("change", (e) => { state.showLinks = e.target.checked; requestDraw(); });
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
new ResizeObserver(() => { layout(); requestDraw(); }).observe($("#canvas-wrap"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readTheme(); makeHatch(); tw.clear(); buildLegend(); updateSummary(); renderPanel(); requestDraw(); });
window.__atlasTrace = { M, state, showPath, selectPhase, pickStep, selectSlice, focusNode, setMode, setTab, showAll, fitInstr, setFold,
  // where a call is drawn, in canvas pixels (for checks)
  posOf: (seq) => { const s = S.find((x) => x.seqIn === seq); const lane = laneOf(s.tid); const [x0, x1] = sliceX(s); return { x: (Math.max(x0, plotX()) + Math.min(x1, plotX() + plotW())) / 2, y: rowY(lane, dep(s)) + lane.rowH / 2 }; },
  hover: (seq) => { const p = window.__atlasTrace.posOf(seq); const c = main, r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + p.x, clientY: r.top + p.y, bubbles: true, pointerId: 1 })); },
};
