// Puts a building (main or a paper) on the stage: floors, labels, signs, the legend and the camera.
// Everything drawn in screen space (labels, plates, signs, step numbers, the moving sign) is drawn
// at a fixed type size inside a scale(view.ls) group, where ls undoes the camera's zoom: the text
// keeps its size on screen however small the whole building has to be.
import { A, node, threadOfCtx } from "./model.js";
import { DIM, render, elevatorSvg, elevatorRects, setMeasure } from "./building.js";
import { P, esc, f1 } from "./iso.js";
import { labelBox, place, labelSvg, measure, overlap } from "./labels.js";
setMeasure((t, size, weight) => measure(t, size, weight));

const svg = document.getElementById("scene");
const world = document.getElementById("world");
const overlay = document.getElementById("overlay");

export const view = { g: null, sh: null, bbox: null, vb: null, labels: {}, allLabels: {}, ls: 1, k: 1, rects: [], legendOpen: true };

export const narrow = () => matchMedia("(max-width: 900px)").matches;
/** The zoom the camera keeps while it follows a step on a narrow screen; type is sized for it. */
export const FOLLOW_K_NARROW = 0.9;

function labelScaleFor(k) {
  if (narrow()) return 1 / FOLLOW_K_NARROW;
  // a hair over 1/k, so the settled zoom never leaves the type under its size
  return 1.012 / Math.max(0.6, Math.min(1, k));
}

/** Title and sub line of a machine, as the shown sheet calls it. */
export function machineText(g, m, sh) {
  if (m.paperBox) return { t1: m.paperBox.title, t2: m.paperBox.sub || m.paperBox.ns || "" };
  const pick = (f) => f && f.boxes.find((b) => b.node === m.node && b.title);
  const b = pick(sh) || A.flows.map(pick).find(Boolean);
  // slots that repeat (a ring drawn with three Requests) are named once
  const slots = (s) => { const u = [...new Set(s)]; return u.join("・") + (u.length < s.length ? "・…" : ""); };
  if (b) return { t1: b.title, t2: b.sub || (b.slots ? slots(b.slots) : b.bits ? b.bits.map((x) => `${x[0]} ${x[1]}`).join("・") : b.ns || "") };
  const n = node(m.node);
  return { t1: n?.title || m.node, t2: "" };
}

export function mount(g, sh, opts = {}) {
  view.g = g;
  view.sh = sh;
  document.body.classList.toggle("in-paper", !!sh?.isPaper);
  const active = new Set(sh ? sh.boxes.map((b) => (g.id === "main" ? b.node : b.id)) : []);
  view.active = active;
  world.innerHTML = render(g, { active }).join("");
  const used = new Set(g.machines.filter((m) => active.has(m.key)).map((m) => m.floor));
  view.unused = sh && sh.steps ? g.floors.filter((f) => !used.has(f.id)).map((f) => f.id) : [];
  for (const f of view.unused) world.querySelector(`.floor[data-floor="${f}"]`)?.classList.add("unused");
  // the type is sized for the zoom the whole building gets, which depends on where the type
  // goes: a few passes settle it
  let ls = labelScaleFor(fitK(buildingBounds(g))), out = null;
  for (let pass = 0; pass < 6; pass++) {
    out = overlayFor(g, sh, active, ls);
    const want = labelScaleFor(fitK(out.bbox));
    // settle from above: a scale that is a little large is fine, a small one is not
    if (want <= ls && ls - want < 0.03) break;
    ls = want;
  }
  view.ls = ls;
  overlay.innerHTML = out.svg;
  view.bbox = out.bbox;
  view.labels = out.labels;
  view.allLabels = out.allLabels;
  view.rects = out.rects;
  if (!opts.keepCamera) fit(false);
}

function overlayFor(g, sh, active, ls) {
  const er = elevatorRects(g, ls);
  const fixed = [er.cap, er.note].filter(Boolean).map((r) => ({ ...r, k: 8 }));
  let signs = floorSigns(g, ls);
  const lab = machineLabels(g, sh, active, ls, signs.rects.concat(fixed));
  // a label that still reaches into a floor name (a small stage leaves little room): that name
  // slides a little up or down beside its floor, and if that is not enough the column of names
  // steps to the left
  const into = (sg) => sg.rects.reduce((p, f) => Math.max(p, ...lab.rects.map((r) => (overlap(r, f) > 0 ? f.x1 - r.x0 + 6 * ls : 0))), 0);
  if (into(signs) > 0) {
    signs = floorSigns(g, ls, lab.rects);
    const push = into(signs);
    if (push > 0) signs = floorSigns(g, ls, lab.rects, Math.min(push, 80 * ls));
  }
  // the room plates keep off the labels and the floor names
  const plates = roomPlates(g, sh, ls, lab.rects.map((r) => ({ ...r, k: 30 })).concat(signs.rects.map((r) => ({ ...r, k: 40 })), fixed));
  const flags = sh?.isPaper ? paperFlags(g, sh, ls, lab.rects.concat(signs.rects, plates.rects)) : { svg: "", rects: [] };
  const taken = lab.rects.concat(signs.rects, plates.rects, flags.rects, fixed);
  const legend = g.id === "main" && !narrow() && sh?.id !== "trace" ? legendBox(g, ls, taken) : { svg: "", rects: [] };
  let ov = `<g id="ov-under"></g>`;
  ov += elevatorSvg(g, { active, ls });
  ov += signs.svg + plates.svg + lab.svg + flags.svg + legend.svg;
  ov += `<g id="ov-marks"></g><g id="ov-lines"></g><g id="ov-actors"></g><g id="ov-signs"></g><g id="ov-peek"></g>`;
  const bbox = sceneBounds(g, taken.concat(legend.rects));
  return { svg: ov, bbox, labels: lab.labels, allLabels: lab.allLabels, rects: lab.rects.concat(plates.rects, signs.rects, flags.rects, fixed, legend.rects) };
}

/** Screen box of the floors alone. */
function buildingBounds(g) {
  const xs = [], ys = [];
  for (const fl of g.floors) {
    const xEnd = DIM.D + fl.R * DIM.P, yEnd = DIM.D + fl.L * DIM.P;
    for (const [x, y] of [[0, 0], [xEnd, 0], [xEnd, DIM.D], [0, Math.max(DIM.D, yEnd)], [DIM.D, Math.max(DIM.D, yEnd)]]) {
      for (const z of [fl.z - DIM.T, fl.z + (fl.id === g.top ? 44 : 0)]) { const [sx, sy] = P(x, y, z); xs.push(sx); ys.push(sy); }
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function sceneBounds(g, rects) {
  const b = buildingBounds(g);
  for (const r of rects) { b.x0 = Math.min(b.x0, r.x0); b.y0 = Math.min(b.y0, r.y0); b.x1 = Math.max(b.x1, r.x1); b.y1 = Math.max(b.y1, r.y1); }
  return b;
}

/* ----------------------------------------------------------- floor signs */
// A column of floor names on the left, each level with the end of its floor. A floor whose end
// does not reach the column (the basement under the corner) is listed in order below, with a
// leader to its block.
function floorSigns(g, ls, avoid = [], push = 0) {
  const anchors = g.floors.map((fl) => {
    const yEnd = DIM.D + fl.L * DIM.P;
    const [x, y] = fl.L > 0 ? P(0, yEnd, fl.z - DIM.T / 2) : P(0, DIM.D, fl.z - DIM.T / 2);
    const unused = !!view.unused?.includes(fl.id);
    const wNo = fl.no ? measure(fl.no, 19, 800) + 6 : 0;
    const wTxt = Math.max(wNo + measure(fl.name, 15, 700), measure(fl.sub || "", 12), unused ? measure("この流れは通らない", 12, 600) : 0);
    return { fl, x, y, unused, wTxt };
  });
  const col = Math.min(...anchors.map((a) => a.x)) - 18 * ls - push;
  const rectAt = (a, sy) => ({ x0: col - (14 + a.wTxt) * ls, y0: sy - 20 * ls, x1: col + 4 * ls, y1: sy + (a.unused ? 36 : 20) * ls });
  const hits = (a, sy) => avoid.reduce((n, r) => n + overlap(rectAt(a, sy), r), 0);
  // top to bottom, each sign at least a sign's height below the one above; a sign that would sit
  // under a label slides a little along its floor's edge
  const order = anchors.slice().sort((p, q) => q.fl.z - p.fl.z);
  let lastY = -Infinity;
  for (const a of order) {
    const base = Math.max(a.y, lastY + 46 * ls);
    let best = { sy: base, h: avoid.length ? hits(a, base) : 0 };
    for (const d of [6, -6, 12, -12, 18, -18, 24, -24, 30, -30]) {
      if (!best.h) break;
      const sy = base + d * ls;
      if (sy < lastY + 46 * ls) continue;
      const h = hits(a, sy);
      if (h < best.h) best = { sy, h };
    }
    a.sy = best.sy;
    lastY = a.sy + (a.unused ? 12 * ls : 0);
  }
  let s = `<g class="fsigns">`;
  const rects = [];
  for (const a of order) {
    const { fl, x, y, sy, unused } = a;
    const nm = fl.name, sb = fl.sub || "";
    s += `<g class="fsign tone-${fl.tone}${unused ? " unused" : ""}" data-floor="${fl.id}">`;
    const lx = col + 3 * ls;
    // the leader runs to the end of the floor; a floor that does not reach the column (the
    // basement under the corner) is reached along under the floors, up to the middle of its
    // front face (the part of it that shows)
    const [fx, fy] = P(DIM.D + (fl.R * DIM.P) / 2, DIM.D, fl.z - DIM.T);
    s += fl.L > 0 || sy === y
      ? `<line class="lead" x1="${f1(lx)}" y1="${f1(sy)}" x2="${f1(x - 6)}" y2="${f1(y)}"/>`
      : `<polyline class="lead" points="${f1(lx)},${f1(sy)} ${f1(fx)},${f1(Math.max(sy, fy + 10))} ${f1(fx)},${f1(fy + 3)}"/>`;
    s += `<g transform="translate(${f1(col)},${f1(sy)}) scale(${ls.toFixed(4)})">`;
    s += `<rect class="chip" x="-1" y="-17" width="3.5" height="34" rx="1.75"/>`;
    s += `<text class="nm" x="-10" y="-1" text-anchor="end">${esc(nm)}</text>`;
    if (fl.no) s += `<text class="no" x="${f1(-10 - measure(nm, 15, 700) - 6)}" y="-1" text-anchor="end">${esc(fl.no)}</text>`;
    s += `<text class="sb" x="-10" y="15" text-anchor="end">${esc(sb)}</text>`;
    if (unused) s += `<text class="nv" x="-10" y="31" text-anchor="end">この流れは通らない</text>`;
    s += `</g></g>`;
    rects.push({ ...rectAt(a, sy), id: "fs-" + fl.id, k: 6 });
  }
  return { svg: s + `</g>`, rects };
}

/* --------------------------------------------------------------- labels */
function machineLabels(g, sh, active, ls, extra = []) {
  const items = [];
  const texts = {};
  for (const m of g.machines) {
    const on = active.has(m.key);
    const { t1, t2 } = machineText(g, m, sh);
    const sub = on ? t2 : "";
    texts[m.key] = { t1, t2: sub, on };
    const { w, h, bw, bh } = labelBox(t1, sub, ls);
    items.push({ id: m.key, bounds: m.bounds, w, h, bw, bh, ls, prefer: m.wing === "L" ? "left" : "right", weight: (on ? 100 : 0) - m.slot });
  }
  // a faded machine (not in this flow) may be covered a little; a machine in the flow may not
  const obstacles = g.machines.map((m) => ({ ...m.bounds, id: m.key, k: active.has(m.key) ? 4 : 0.2 })).concat(extra);
  if (g.elevator) {
    const e = g.elevator;
    const [x0] = P(e.cx - e.r, e.cy + e.r, 0), [x1] = P(e.cx + e.r, e.cy - e.r, 0);
    const [, y0] = P(e.cx, e.cy, e.z1 + 30), [, y1] = P(e.cx, e.cy, e.z0);
    obstacles.push({ x0, x1, y0, y1, id: "elev", k: 2 });
  }
  // the tour's own machines get the best places; the others are only shown on hover
  const onPlaced = place(items.filter((it) => texts[it.id].on), obstacles);
  const offPlaced = place(items.filter((it) => !texts[it.id].on), obstacles.concat(onPlaced.map((p) => ({ ...p.r, k: 2 }))));
  const placed = onPlaced.concat(offPlaced);
  let s = `<g class="labels">`;
  for (const p of placed) {
    const m = g.machine(p.id);
    const t = texts[p.id];
    const tone = g.floor(m.floor).tone;
    s += labelSvg(p, t.t1, t.t2, t.on ? "on" : "off", tone, `data-key="${esc(m.key)}" data-node="${esc(m.node)}"`, ls);
  }
  s += `</g>`;
  const labels = Object.fromEntries(onPlaced.map((p) => [p.id, p]));
  const allLabels = Object.fromEntries(placed.map((p) => [p.id, p]));
  return { svg: s, rects: onPlaced.map((p) => ({ ...p.r, id: "lbl-" + p.id })), labels, allLabels };
}

/* ------------------------------------------------- paper: entrance, exits */
function paperFlags(g, sh, ls, avoid) {
  const items = [], info = {};
  const add = (key, text, cls) => {
    const m = g.machine(key);
    if (!m) return;
    const bw = Math.ceil(measure(text, 12.5, 700) + 20), bh = 23;
    const id = key + "|" + cls;
    items.push({ id, bounds: m.bounds, w: bw * ls, h: bh * ls, bw, bh, ls, prefer: "left", weight: cls === "in" ? 2 : 1 });
    info[id] = { m, text, cls };
  };
  if (sh.entry) add(sh.entry, "入口", "in");
  for (const [outer, box] of Object.entries(sh.ports || {})) add(box, `出口 → ${node(outer)?.title || outer}`, "out");
  const obstacles = g.machines.map((m) => ({ ...m.bounds, id: m.key, k: 4 })).concat(avoid.map((r) => ({ ...r, k: 10 })));
  const placed = place(items, obstacles);
  let s = `<g class="flags">`;
  for (const p of placed) {
    const { m, text, cls } = info[p.id];
    const [tx, ty] = m.top;
    const cx = Math.max(p.r.x0, Math.min(p.r.x1, tx)), cy = p.r.y1 < ty ? p.r.y1 : p.r.y0;
    s += `<g class="flag ${cls}"><line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(tx)}" y2="${f1(ty)}"/>` +
      `<g transform="translate(${f1(p.r.x0)},${f1(p.r.y0)}) scale(${ls.toFixed(4)})"><rect x="0" y="0" width="${p.item.bw}" height="${p.item.bh}" rx="6"/>` +
      `<text x="${f1(p.item.bw / 2)}" y="16" text-anchor="middle">${esc(text)}</text></g></g>`;
  }
  return { svg: s + `</g>`, rects: placed.map((p) => p.r) };
}

/* ---------------------------------------------------------- room plates */
// A plate names the room (execution context) and who runs in it. It stands in free space near
// the far end of the room, with a thin leader to it: never over a label, and growing the scene as
// little as it can.
function roomPlates(g, sh, ls, avoid) {
  const solid = buildingBoxes(g);
  const bb = sceneBounds(g, avoid);
  const taken = avoid.slice().concat(g.machines.map((m) => ({ ...m.bounds, k: 4 })));
  let s = `<g class="plates">`;
  const rects = [];
  const rooms = g.rooms.slice().sort((p, q) => !!sh?.regions?.find((x) => x.node === q.ctx) - !!sh?.regions?.find((x) => x.node === p.ctx));
  for (const r of rooms) {
    const th = threadOfCtx(r.ctx);
    const region = sh?.regions?.find((x) => x.node === r.ctx);
    const full = region ? region.label3 || region.label : node(r.ctx).title;
    // a long name keeps its main part on the first line
    const mm = /^(.*?)（(.*)）$/.exec(full);
    const name = mm ? mm[1] : full, paren = mm ? mm[2] : "";
    // who runs there; when the room is named after its thread ("service task"), the thread's
    // own note is enough ("OS のスレッド")
    const tm = th ? /^(.*?)（(.*)）$/.exec(th.name) : null;
    const runName = th ? (tm && tm[1] === name ? tm[2] : th.name) : "";
    const run = (paren ? paren + "　" : "") + (th ? "走る：" + runName : "");
    // the far end of the topmost part of the room, on its floor by the back wall
    const part = r.parts.filter((p) => !p.shaft).sort((a, b) => g.floor(b.floor).z - g.floor(a.floor).z)[0];
    if (!part) continue;
    const fl = g.floor(part.floor);
    const wing = part.all ? "R" : part.wing;
    const len = wing === "L" ? fl.L : fl.R;
    const a1 = DIM.D + Math.min(part.all ? len : part.to, len) * DIM.P - 14;
    const anchor = wing === "L" ? P(14, a1, fl.z + 2) : P(a1, 14, fl.z + 2);
    const bw = Math.ceil(Math.max(measure(name, 12.5, 700) + 30, measure(run, 12) + 22)), bh = 40;
    const w = bw * ls, h = bh * ls;
    const dir = wing === "L" ? -1 : 1;
    let best = null;
    for (let ri = 0; ri <= 14; ri++) for (let ai = 0; ai < 16; ai++) {
      const rr = ri * 20 * ls, ang = (ai / 16) * Math.PI * 2;
      const cx = anchor[0] + Math.cos(ang) * rr + dir * (w / 2 + 10 * ls), cy = anchor[1] + Math.sin(ang) * rr - h / 2 - 6 * ls;
      const c = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      // near its room; never over a label or a machine; over bare floor rather than growing the
      // scene (a wider scene makes everything smaller)
      let cost = rr * 1.4 * h / ls;
      for (const t of taken) cost += overlap(c, t) * (t.k ?? 6) * 3;
      cost += coverOfBuilding(c, solid, 6) * 0.7;
      cost += (Math.max(0, bb.x0 - c.x0) + Math.max(0, c.x1 - bb.x1)) * h * 2.2 + (Math.max(0, bb.y0 - c.y0) + Math.max(0, c.y1 - bb.y1)) * w * 2.2;
      if (!best || cost < best.cost) best = { cost, c };
    }
    const c = best.c;
    taken.push({ ...c, k: 8 });
    rects.push({ ...c, id: "plate-" + r.ctx });
    // the leader: from the nearest point of the plate to the room
    const lx = Math.max(c.x0, Math.min(c.x1, anchor[0])), ly = Math.max(c.y0, Math.min(c.y1, anchor[1]));
    const far = Math.hypot(lx - anchor[0], ly - anchor[1]) > 8 * ls;
    s += `<g class="plate t-${th?.key || "other"} ${region ? "on" : "off"}" data-node="${r.ctx}">`;
    if (far) s += `<line class="plead" x1="${f1(lx)}" y1="${f1(ly)}" x2="${f1(anchor[0])}" y2="${f1(anchor[1])}"/><circle class="pdot" cx="${f1(anchor[0])}" cy="${f1(anchor[1])}" r="${f1(2.6 * ls)}"/>`;
    s += `<g transform="translate(${f1(c.x0)},${f1(c.y0)}) scale(${ls.toFixed(4)})">`;
    s += `<rect x="0" y="0" width="${bw}" height="${bh}" rx="8"/>`;
    s += `<circle class="dot" cx="12" cy="13" r="4.2"/>`;
    s += `<text class="t" x="22" y="17.5">${esc(name)}</text>`;
    s += `<text class="r" x="11" y="33">${esc(run)}</text>`;
    s += `</g></g>`;
  }
  return { svg: s + `</g>`, rects };
}

/* --------------------------------------------------------------- legend */
// The legend is part of the scene: it takes free space beside the building, so the camera fits
// it with the building and it never covers anything.
const LEGEND = [
  ["fig", "人＝走っているスレッド"],
  ["who", ""],
  ["box", "箱＝渡すデータ（白はアドレスだけ）"],
  ["tube", "エレベーター＝OS_CALL（syscall）"],
  ["ladder", "はしご＝同じスレッドで別の階へ"],
  ["spark", "光＝通知"],
  ["dash", "破線＝読み書き"],
  ["room", "点線の部屋＝実行の文脈"],
];
function legendIcon(k) {
  switch (k) {
    case "fig": return `<path class="lg-b" d="M-6,6 C-6.5,-6 -4.5,-11 0,-11 C4.5,-11 6.5,-6 6,6 Z"/><circle class="lg-b" cx="0" cy="-15.5" r="4.6"/>`;
    case "box": return `<path class="lg-p1" d="M-8,-4 L0,-8 L8,-4 L0,0 Z"/><path class="lg-p2" d="M-8,-4 L0,0 L0,8 L-8,4 Z"/><path class="lg-p3" d="M8,-4 L0,0 L0,8 L8,4 Z"/>`;
    case "tube": return `<rect class="lg-t" x="-7" y="-11" width="14" height="22" rx="7"/>`;
    case "ladder": return `<path class="lg-l" d="M-4,-11 V11 M4,-11 V11 M-4,-5 H4 M-4,1 H4 M-4,7 H4"/>`;
    case "spark": return `<path class="lg-s" d="M-11,6 Q0,-8 11,6"/><circle class="lg-sp" cx="0" cy="-1" r="3.6"/>`;
    case "dash": return `<path class="lg-d" d="M-11,5 Q0,-7 11,5"/>`;
    case "room": return `<rect class="lg-r" x="-10" y="-7" width="20" height="14" rx="2"/>`;
  }
  return "";
}
function legendBox(g, ls, taken) {
  const open = view.legendOpen;
  const pad = 12, rowH = 23, gap = 16;
  const who = [["th-app", "アプリのスレッド"], ["th-svc", "service task"], ["th-irq", "割り込み"]];
  // items flow left to right in rows as wide as the scene
  const bb = sceneBounds(g, taken);
  const maxW = Math.max(420, (bb.x1 - bb.x0) / ls - 70);
  const items = LEGEND.map(([k, t]) => {
    if (k === "who") return { k, t, w: who.reduce((a, [, tt]) => a + measure(tt, 12) + 20, 0) };
    return { k, t, w: 26 + measure(t, 12.5) };
  });
  const rows = [[]];
  let x = 0;
  for (const it of items) {
    if (rows[rows.length - 1].length && x + it.w > maxW) { rows.push([]); x = 0; }
    rows[rows.length - 1].push({ ...it, x });
    x += it.w + gap;
  }
  const head = 52;
  const bw = open ? Math.ceil(head + Math.max(...rows.map((r) => { const l = r[r.length - 1]; return l.x + l.w; })) + pad * 2) : 84;
  const bh = open ? pad + rows.length * rowH + 4 : 30;
  const w = bw * ls, h = bh * ls;
  // under the building, in the middle
  const bld = buildingBounds(g);
  const cx = (bld.x0 + bld.x1) / 2;
  const below = Math.max(bld.y1, ...taken.filter((t) => t.x1 > cx - w / 2 && t.x0 < cx + w / 2).map((t) => t.y1));
  const r = { x0: cx - w / 2, x1: cx + w / 2, y0: below + 18 * ls, y1: below + 18 * ls + h };
  let s = `<g class="legend-s${open ? " open" : ""}" transform="translate(${f1(r.x0)},${f1(r.y0)}) scale(${ls.toFixed(4)})">`;
  s += `<rect class="lgbg" width="${bw}" height="${bh}" rx="10"/>`;
  s += `<g class="lghead" role="button" tabindex="0" aria-expanded="${open}" aria-label="見方を${open ? "たたむ" : "開く"}"><rect class="hit" width="${open ? head : bw}" height="${bh}" rx="10"/>` +
    `<text class="lgt" x="${pad}" y="20">見方</text>` +
    (open ? `<text class="lgf" x="${pad}" y="40">たたむ</text>` : `<text class="lgx" x="${bw - pad}" y="20" text-anchor="end">＋</text>`) + `</g>`;
  if (open) {
    rows.forEach((row, ri) => {
      const y = pad + ri * rowH + 8;
      for (const it of row) {
        const x0 = head + pad + it.x;
        if (it.k === "who") {
          let xx = x0;
          s += who.map(([cls, tt]) => { const o = `<circle class="lgc ${cls}" cx="${f1(xx + 5)}" cy="${f1(y - 4)}" r="4.4"/><text class="lgw" x="${f1(xx + 13)}" y="${y}">${esc(tt)}</text>`; xx += measure(tt, 12) + 20; return o; }).join("");
        } else s += `<g transform="translate(${f1(x0 + 10)},${y - 4}) scale(0.82)">${legendIcon(it.k)}</g><text class="lgi" x="${f1(x0 + 26)}" y="${y}">${esc(it.t)}</text>`;
      }
    });
  }
  s += `</g>`;
  return { svg: s, rects: [{ ...r, id: "legend", k: 8 }] };
}
/** The floors as solid screen boxes (one per wing), to keep the legend off the building. */
function buildingBoxes(g) {
  const out = [];
  for (const fl of g.floors) {
    const zTop = fl.id === g.top ? fl.z + 46 : fl.z + DIM.H - DIM.T;
    const wings = [[DIM.D + fl.R * DIM.P, DIM.D]];
    if (fl.L > 0) wings.push([DIM.D, DIM.D + fl.L * DIM.P]);
    for (const [xe, ye] of wings) {
      const pts = [];
      for (const x of [0, xe]) for (const y of [0, ye]) for (const z of [fl.z - DIM.T, zTop]) pts.push(P(x, y, z));
      out.push(hull(pts));
    }
  }
  return out;
}
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Area of rect r that lies on the building (sampled). */
function coverOfBuilding(r, solid, N = 10) {
  let n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = r.x0 + ((i + 0.5) / N) * (r.x1 - r.x0), y = r.y0 + ((j + 0.5) / N) * (r.y1 - r.y0);
    if (solid.some((p) => inPoly(x, y, p))) n++;
  }
  return (n / (N * N)) * (r.x1 - r.x0) * (r.y1 - r.y0);
}

/* --------------------------------------------------------------- camera */
let anim = null;
export function setViewBox(vb, animate = true, dur = 650) {
  const cur = view.vbNow || view.vb;
  view.vb = vb;
  cancelAnimationFrame(anim);
  if (!animate || !cur) { view.vbNow = vb; svg.setAttribute("viewBox", vb.map(f1).join(" ")); return; }
  const t0 = performance.now();
  const step = (t) => {
    // a frame's time can be a little before t0 (the frame began while mount() was still
    // running): never ease backwards, which would turn a zoom-out into a negative viewBox
    const u = Math.max(0, Math.min(1, (t - t0) / dur));
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const v = cur.map((c, i) => c + (vb[i] - c) * e);
    view.vbNow = v;
    svg.setAttribute("viewBox", v.map(f1).join(" "));
    if (u < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
export function stopCamera() { cancelAnimationFrame(anim); }

/** The free part of the stage: below the crumbs, above the dock. */
function freeArea() {
  const W = svg.clientWidth || 1000, H = svg.clientHeight || 800;
  const dock = document.getElementById("dock");
  const reserveB = dock && dock.offsetHeight ? dock.offsetHeight + 24 : 0;
  const top = 46;
  return { W, H, top, bottom: H - reserveB };
}
/** The zoom at which box b fits the free part of the stage. */
export function fitK(b, pad = 24, maxK = 1.12) {
  const { W, top, bottom } = freeArea();
  return Math.min((W - pad * 2) / (b.x1 - b.x0), (bottom - top - pad) / (b.y1 - b.y0), maxK);
}

/** Fits a screen-space box into the free part of the stage. */
export function frame(b, animate = true, pad = 24, maxK = 1.6, dur = 650, minK = 0) {
  const { W, H, top, bottom } = freeArea();
  const k = Math.max(minK, Math.min((W - pad * 2) / (b.x1 - b.x0), (bottom - top - pad) / (b.y1 - b.y0), maxK));
  lookAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, k, animate, dur);
}
/** Puts world point (cx, cy) at the middle of the free part of the stage at zoom k. */
export function lookAt(cx, cy, k, animate = true, dur = 650) {
  const { W, H, top, bottom } = freeArea();
  const vw = W / k, vh = H / k;
  const freeCy = (top + bottom) / 2 / k;
  setViewBox([cx - vw / 2, cy - freeCy, vw, vh], animate, dur);
  view.k = k;
}
// a whole building never gets larger than this, so type keeps one size between views
export function fit(animate = true) { if (view.bbox) frame(view.bbox, animate, 24, 1.12); }

export function screenToWorld(px, py) {
  const vb = view.vb, W = svg.clientWidth, H = svg.clientHeight;
  return [vb[0] + (px / W) * vb[2], vb[1] + (py / H) * vb[3]];
}
