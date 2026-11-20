// The building: where every floor, room, machine, ladder and the elevator stand, and how a
// courier walks between two machines. Positions are a drawing choice; what stands where
// (layer, context, node) comes from the atlas.
import { A, STACK, layerById, node, threadOfCtx, FLOOR_NO, sheet } from "./model.js";
import { P, C, S, poly, rect, box, boxBounds, cylinder, ellipseOnFloor, esc, f1, RX, RY } from "./iso.js";

let measureText = (t, size) => t.length * size * 0.9;
export function setMeasure(fn) { measureText = fn; }

export const DIM = { D: 92, CW: 30, P: 100, H: 116, T: 12, F: 44 };

/* ------------------------------------------------------------------ plans */

// The main building: both flows share it, so a machine keeps its place when the tour changes.
// wing L runs down-left from the corner, wing R down-right; slot 1 is next to the corner.
// The corner itself stays free: the OS_CALL elevator stands in front of it on every floor it
// serves, and a machine there would sit behind the glass.
const MAIN_PLAN = {
  floors: {
    app: { L: 2.4, R: 2.4 },
    lib: { L: 2.4, R: 2.4 },
    os: { L: 3.4, R: 3.4 },
    kernel: { L: 3.4, R: 3.4 },
    emu: { L: 0, R: 1.4 }, // the basement is only under the corner: the timer is all there is
  },
  machines: {
    "app.tasks-view": ["app", "L", 2],
    "app.tasks": ["app", "R", 2],
    "lib.transport": ["lib", "L", 1],
    "lib.send-text": ["lib", "L", 2],
    "lib.next": ["lib", "R", 1],
    "lib.process-stats": ["lib", "R", 2],
    "os.request-ring": ["os", "L", 1],
    "os.gateway": ["os", "L", 2],
    "os.proc-stats": ["os", "L", 3],
    "os.serve": ["os", "R", 1],
    "os.ui-protocol": ["os", "R", 2],
    "os.dom": ["os", "R", 3],
    // charge_elapsed sits under fill(out), away from the corner, with its store beside it
    "kernel.cpu-time": ["kernel", "L", 2],
    "kernel.cpu-counters": ["kernel", "L", 3],
    "kernel.reschedule": ["kernel", "R", 1],
    "kernel.tick": ["kernel", "R", 2],
    "kernel.irq-dispatch": ["kernel", "R", 3],
    "emulator.timer.clock": ["emu", "R", 1],
  },
  // OS_CALL is the elevator itself: its machine is the shaft's stop on the kernel floor
  shaft: { node: "kernel.os-call", floor: "kernel" },
  // a room is an execution context; [floor, wing, from, to] in slots (1.5 = between slots 1
  // and 2), [floor, "all"], or [floor, "shaft"] for the foot of the elevator
  rooms: {
    "ctx.user": [["app", "all"], ["lib", "all"]],
    "ctx.syscall": [["os", "L", 1.5, 3.4], ["kernel", "shaft"]],
    "ctx.service": [["os", "R", 0.5, 3.4]],
    "ctx.irq": [["kernel", "R", 0.5, 3.4]],
  },
  // a ladder is a call to another floor by the same thread (no OS_CALL on the way)
  ladders: [
    { wing: "L", slot: 1.5, lower: "lib", upper: "app" },
    { wing: "R", slot: 1.5, lower: "lib", upper: "app" },
    { wing: "L", slot: 2.5, lower: "kernel", upper: "os" },
  ],
  elevator: { floors: ["kernel", "os", "lib"] },
};

// The papers are small buildings of their own: their bands are the floors.
const PAPER_PLANS = {
  "os.gateway": { ureq: 1, ustr: 3, read: 1, owner: 2, copy: 3, stage: 4, full: 5, slot: 3.5, submit: 4.6 },
  "os.submit": { encode: 1, words: 2, send: 3, ring: 3, notify: 3 },
  "app.tasks": { stats: 1, share: 2, show: 3, last: 1.5, series: 2.6 },
  "kernel.cpu-time": { read: 1, charge: 2, set: 3, who: 1.6, counters: 2.6, last: 3.6, clock: 1 },
};

/* --------------------------------------------------------------- geometry */

export function buildMain() {
  const floors = STACK.slice().reverse(); // bottom → top
  const plan = MAIN_PLAN;
  const g = newGeom("main");
  floors.forEach((id, i) => {
    const l = layerById[id];
    const w = plan.floors[id] || { L: 2, R: 3 };
    g.floors.push({ id, index: i, z: i * DIM.H, L: w.L, R: w.R, name: l.name, sub: l.sub, tone: id, no: FLOOR_NO[id], corner: true });
  });
  g.top = floors[floors.length - 1];
  const ef = plan.elevator.floors.map((f) => g.floor(f)).filter(Boolean);
  g.elevator = {
    floors: plan.elevator.floors,
    cx: DIM.D + 30, cy: DIM.D + 30, r: 23,
    z0: Math.min(...ef.map((f) => f.z)),
    z1: Math.max(...ef.map((f) => f.z)) + DIM.H - DIM.T,
    boundary: [g.floor("lib"), g.floor("os")],
  };
  // machines: every node placed by the plan; any other flow box gets a free slot on its layer
  const placed = new Set();
  if (plan.shaft && node(plan.shaft.node)) { addShaft(g, plan.shaft.node, plan.shaft.floor); placed.add(plan.shaft.node); }
  for (const [nid, [fl, wing, slot]] of Object.entries(plan.machines)) {
    if (!node(nid)) continue;
    addMachine(g, nid, nid, fl, wing, slot);
    placed.add(nid);
  }
  for (const f of A.flows) for (const b of f.boxes) {
    if (placed.has(b.node) || !g.floor(b.layer)) continue;
    const fl = g.floor(b.layer);
    const used = g.machines.filter((m) => m.floor === fl.id && m.wing === "R").map((m) => m.slot);
    const slot = Math.max(0, ...used) + 1;
    fl.R = Math.max(fl.R, slot + 0.4);
    addMachine(g, b.node, b.node, fl.id, "R", slot);
    placed.add(b.node);
  }
  for (const [ctx, parts] of Object.entries(plan.rooms)) {
    if (!node(ctx)) continue;
    g.rooms.push({ ctx, parts: parts.map((p) => partOf(g, p)).filter(Boolean) });
  }
  g.ladders = plan.ladders.map((l) => ({ ...l, ...ladderPos(l) }));
  return g;
}

export function buildPaper(pid) {
  const p = sheet(pid);
  const g = newGeom(pid);
  const bands = p.bands.slice().reverse(); // bottom → top
  const slots = PAPER_PLANS[pid] || autoSlots(p);
  bands.forEach((b, i) => {
    const boxes = p.boxes.filter((x) => x.layer === b.id);
    const maxSlot = Math.max(1, ...boxes.map((x) => slots[x.id] || 1));
    g.floors.push({ id: b.id, index: i, z: i * DIM.H, L: 0, R: maxSlot + 0.45, name: b.name, sub: b.sub, tone: b.tone, no: "", corner: true, band: true });
  });
  // every band of a paper is as long as the longest, so it reads as one block
  const len = Math.max(...g.floors.map((f) => f.R));
  for (const f of g.floors) f.R = len;
  g.top = bands[bands.length - 1].id;
  for (const b of p.boxes) addMachine(g, b.id, b.node, b.layer, "R", slots[b.id] || 1, b);
  g.ladders = [];
  g.rooms = [];
  g.elevator = null;
  return g;
}

function autoSlots(p) {
  const out = {};
  const body = p.bands.find((b) => b.id === "body") || p.bands[0];
  p.boxes.filter((b) => b.layer === body.id).forEach((b, i) => (out[b.id] = i + 1));
  for (const b of p.boxes) {
    if (out[b.id]) continue;
    const linked = p.steps.flatMap((s) => (s.from === b.id ? [s.to] : s.to === b.id ? [s.from] : [])).filter((x) => out[x]);
    out[b.id] = linked.length ? linked.reduce((a, x) => a + out[x], 0) / linked.length : 1;
  }
  return out;
}

function newGeom(id) {
  const g = { id, floors: [], machines: [], rooms: [], ladders: [], elevator: null };
  g.floor = (fid) => g.floors.find((f) => f.id === fid);
  g.machine = (key) => g.machines.find((m) => m.key === key);
  g.machineOfNode = (nid) => g.machines.find((m) => m.node === nid);
  return g;
}

/** world (x, y) of a point given along/across a wing */
export function wp(wing, alongV, acrossV) {
  return wing === "L" ? [acrossV, alongV] : [alongV, acrossV];
}
export const slotAlong = (slot) => DIM.D + (slot - 0.5) * DIM.P;
const MACH_ACROSS = (DIM.D - DIM.CW) / 2 + 1;
export const CORRIDOR = DIM.D - DIM.CW / 2;

function addMachine(g, key, nid, floorId, wing, slot, paperBox) {
  const fl = g.floor(floorId);
  if (!fl) return;
  const n = node(nid) || {};
  let shape = n.kind === "store" ? "store" : n.kind === "hw" ? "hw" : "func";
  if (n.shape?.of === "kernel.channel" || nid === "os.request-ring") shape = "ring";
  if (n.shape?.kind === "tree") shape = "tree";
  const F = DIM.F;
  const h = shape === "store" ? 34 : shape === "hw" ? 22 : shape === "tree" ? 30 : shape === "ring" ? 14 : 26;
  const a = slotAlong(slot);
  const [cx, cy] = wp(wing, a, MACH_ACROSS);
  const m = {
    key, node: nid, floor: floorId, wing, slot, shape, h, cx, cy, z: fl.z, paperBox,
    x0: cx - F / 2, y0: cy - F / 2, w: F, d: F,
    port: [...wp(wing, a, CORRIDOR), fl.z],
  };
  m.bounds = shape === "ring"
    ? (() => { const [x, y] = P(cx, cy, fl.z); const rx = 27 * RX, ry = 27 * RY; return { x0: x - rx, x1: x + rx, y0: y - ry - h, y1: y + ry }; })()
    : boxBounds(m.x0, m.y0, fl.z, F, F, h);
  m.top = P(cx, cy, fl.z + h);
  g.machines.push(m);
}

/** The machine of OS_CALL: the elevator's stop on its own floor (the courier stands in the car). */
function addShaft(g, nid, floorId) {
  const fl = g.floor(floorId), e = g.elevator;
  if (!fl || !e) return;
  const h = 34, z = fl.z;
  const [x, y] = P(e.cx, e.cy, z);
  const rx = (e.r + 6) * RX, ry = (e.r + 6) * RY;
  g.machines.push({
    key: nid, node: nid, floor: floorId, wing: "C", slot: 0, shape: "shaft", h, cx: e.cx, cy: e.cy, z,
    x0: e.cx - e.r, y0: e.cy - e.r, w: 2 * e.r, d: 2 * e.r,
    port: [e.cx, e.cy, z],
    bounds: { x0: x - rx, x1: x + rx, y0: y - h - ry, y1: y + ry + SHAFT_BASE },
    top: P(e.cx, e.cy, z + h),
  });
}
export const SHAFT_BASE = 9;

function partOf(g, p) {
  const fl = g.floor(p[0]);
  if (!fl) return null;
  if (p[1] === "all") return { floor: fl.id, all: true };
  if (p[1] === "shaft") return g.elevator ? { floor: fl.id, shaft: true } : null;
  return { floor: fl.id, wing: p[1], from: p[2], to: p[3] };
}
function ladderPos(l) {
  const [x, y] = wp(l.wing, slotAlong(l.slot), DIM.D - DIM.CW - 9);
  return { x, y, access: wp(l.wing, slotAlong(l.slot), CORRIDOR) };
}

/* ------------------------------------------------------------- rendering */

const roomTint = (ctx) => threadOfCtx(ctx)?.key || "other";

/** Static SVG of the building. Returns per-floor strings (bottom → top) and labels data. */
export function render(g, opts = {}) {
  const { D, CW, T, H, P: PP } = DIM;
  const active = opts.active || new Set(); // machine keys taking part in the shown sheet
  const out = [];
  for (const fl of g.floors) {
    const z = fl.z;
    const xEnd = D + fl.R * PP, yEnd = D + fl.L * PP;
    let s = `<g class="floor tone-${fl.tone}" data-floor="${fl.id}">`;
    // back walls (only the top floor shows them fully; the floors above hide the rest)
    const wallH = fl.id === g.top ? 46 : 24;
    s += `<g class="walls">`;
    if (fl.L > 0) s += poly([[0, D, z], [0, yEnd, z], [0, yEnd, z + wallH], [0, D, z + wallH]], "wall-x");
    s += poly([[0, 0, z], [0, D, z], [0, D, z + wallH], [0, 0, z + wallH]], "wall-x");
    s += poly([[0, 0, z], [xEnd, 0, z], [xEnd, 0, z + wallH], [0, 0, z + wallH]], "wall-y");
    s += `</g>`;
    // slab: top surface and the faces toward the viewer
    const top = fl.L > 0
      ? [[0, 0, z], [xEnd, 0, z], [xEnd, D, z], [D, D, z], [D, yEnd, z], [0, yEnd, z]]
      : [[0, 0, z], [xEnd, 0, z], [xEnd, D, z], [0, D, z]];
    s += `<g class="slab">`;
    if (fl.L > 0) {
      s += poly([[0, yEnd, z], [D, yEnd, z], [D, yEnd, z - T], [0, yEnd, z - T]], "sl-l"); // end of wing L
      s += poly([[D, D, z], [D, yEnd, z], [D, yEnd, z - T], [D, D, z - T]], "sl-r"); // inner face of wing L
    } else {
      s += poly([[0, D, z], [D, D, z], [D, D, z - T], [0, D, z - T]], "sl-l");
    }
    s += poly([[D, D, z], [xEnd, D, z], [xEnd, D, z - T], [D, D, z - T]], "sl-l"); // inner face of wing R
    s += poly([[xEnd, 0, z], [xEnd, D, z], [xEnd, D, z - T], [xEnd, 0, z - T]], "sl-r"); // end of wing R
    s += poly(top, "sl-top");
    s += `</g>`;
    // corridor strip
    s += `<g class="corr">`;
    s += rect(D, D - CW, xEnd, D, z, "corridor");
    if (fl.L > 0) s += rect(D - CW, D, D, yEnd, z, "corridor");
    s += rect(D - CW, D - CW, D, D, z, "corridor");
    s += `</g>`;
    // rooms on this floor
    for (const r of g.rooms) for (const p of r.parts) if (p.floor === fl.id && !p.shaft) s += roomShape(fl, r, p, g);
    // ladder holes coming up from below, and ladders going up from here
    for (const l of g.ladders) {
      if (l.upper === fl.id) s += hatch(l, z);
    }
    // objects on the floor, far to near
    const objs = [];
    for (const m of g.machines.filter((m) => m.floor === fl.id && m.shape !== "shaft")) objs.push({ d: m.cx + m.cy, svg: machineSvg(m, active.has(m.key), opts) });
    for (const l of g.ladders) if (l.lower === fl.id) objs.push({ d: l.x + l.y + 1, svg: ladderSvg(l, z, g.floor(l.upper).z) });
    // pillars at the wing ends, where the floor above rests on them
    const above = g.floors[fl.index + 1];
    if (above && above.R >= fl.R - 0.01) objs.push({ d: xEnd + D + 50, svg: pillar(xEnd - 7, D - 7, z) });
    if (above && fl.L > 0 && above.L >= fl.L - 0.01) objs.push({ d: yEnd + D + 50, svg: pillar(D - 7, yEnd - 7, z) });
    objs.sort((a, b) => a.d - b.d);
    s += `<g class="objs">${objs.map((o) => o.svg).join("")}</g>`;
    s += `<g class="actors" data-floor="${fl.id}"></g>`;
    s += `</g>`;
    out.push(s);
  }
  return out;
}

function pillar(x, y, z) {
  return box(x, y, z, 7, 7, DIM.H - DIM.T, "pillar");
}

function roomShape(fl, r, p, g) {
  const { D, CW, P: PP } = DIM;
  const z = fl.z + 0.5;
  const tint = roomTint(r.ctx);
  const inner = D - CW;
  let rects = [];
  if (p.shaft) {
    // the foot of the elevator: the room is the ring around the shaft on this floor
    const e = g.elevator;
    rects.push(ellipseOnFloor(e.cx, e.cy, fl.z + 0.4, e.r + 15, `room t-${tint}`));
    rects.push(ellipseOnFloor(e.cx, e.cy, fl.z + 0.4, e.r + 15, `room-edge e-${tint}`));
  } else if (p.all) {
    const xEnd = D + fl.R * PP, yEnd = D + fl.L * PP;
    rects.push(rect(4, 4, xEnd - 4, inner, z, `room t-${tint}`));
    if (fl.L > 0) rects.push(rect(4, inner, inner, yEnd - 4, z, `room t-${tint}`));
    // one outline around the L shape
    const pts = fl.L > 0
      ? [[4, 4], [xEnd - 4, 4], [xEnd - 4, inner], [inner, inner], [inner, yEnd - 4], [4, yEnd - 4]]
      : [[4, 4], [xEnd - 4, 4], [xEnd - 4, inner], [4, inner]];
    rects.push(poly(pts.map(([x, y]) => [x, y, z]), `room-edge e-${tint}`));
  } else {
    // the same slot grid as the machines and ladders: slot 1.5 is the line between slots 1 and 2
    const len = p.wing === "L" ? fl.L : fl.R;
    const a0 = p.from <= 0 ? 4 : slotAlong(p.from) + (p.from === 0.5 ? 2 : 0);
    const a1 = p.to >= len - 0.01 ? D + len * PP - 4 : slotAlong(p.to);
    const [x0, y0] = wp(p.wing, a0, 4), [x1, y1] = wp(p.wing, a1, inner);
    rects.push(rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), z, `room t-${tint}`));
    rects.push(rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), z, `room-edge e-${tint}`));
    // a low wall where the room meets the next part of the floor
    if (p.from > 0.5) rects.push(lowWall(p.wing, a0, fl.z));
    if (p.to < len - 0.01) rects.push(lowWall(p.wing, a1, fl.z));
  }
  return `<g class="roomg" data-ctx="${r.ctx}">${rects.join("")}</g>`;
}

function lowWall(wing, a, z) {
  const inner = DIM.D - DIM.CW;
  const [x0, y0] = wp(wing, a - 2, 2), [x1, y1] = wp(wing, a + 2, inner);
  return box(Math.min(x0, x1), Math.min(y0, y1), z, Math.abs(x1 - x0), Math.abs(y1 - y0), 12, "lowwall");
}

function hatch(l, z) {
  const r = 11;
  return `<g class="hatch">${rect(l.x - r, l.y - r, l.x + r, l.y + r, z + 0.6, "hole")}` +
    box(l.x - r, l.y - r - 2, z, 2 * r, 2, 12, "rail") + box(l.x - r - 2, l.y - r, z, 2, 2 * r, 12, "rail") + `</g>`;
}

function ladderSvg(l, z0, z1) {
  const r = 8, top = z1 - DIM.T;
  const [ax, ay] = [l.x, l.y];
  const rail = (dx, dy) => `<line class="ladder" x1="${f1(P(ax + dx, ay + dy, z0)[0])}" y1="${f1(P(ax + dx, ay + dy, z0)[1])}" x2="${f1(P(ax + dx, ay + dy, top)[0])}" y2="${f1(P(ax + dx, ay + dy, top)[1])}"/>`;
  const along = l.wing === "L" ? [0, 1] : [1, 0];
  let s = `<g class="ladderg">${rail(-r * along[0], -r * along[1])}${rail(r * along[0], r * along[1])}`;
  for (let zz = z0 + 12; zz < top - 2; zz += 13) {
    const a = P(ax - r * along[0], ay - r * along[1], zz), b = P(ax + r * along[0], ay + r * along[1], zz);
    s += `<line class="rung" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  }
  return s + `</g>`;
}

function machineSvg(m, on, opts) {
  const n = node(m.node) || {};
  const cls = `mach k-${m.shape} ${on ? "on" : "off"}${n.paper ? " has-paper" : ""}`;
  const attrs = `data-key="${esc(m.key)}" data-node="${esc(m.node)}" tabindex="0" role="button" aria-label="${esc(n.title || m.node)}"`;
  const { x0, y0, z, w, d, h } = m;
  let s = `<g class="${cls}" ${attrs}>`;
  // soft contact shadow
  s += rect(x0 - 3, y0 - 3, x0 + w + 5, y0 + d + 5, z + 0.3, "shadow");
  if (m.shape === "ring") {
    s += cylinder(m.cx, m.cy, z, 27, 14, "ringc");
    s += ellipseOnFloor(m.cx, m.cy, z + 14.2, 15, "ringhole");
    // parcels waiting on the ring
    for (let i = 0; i < 3; i++) {
      const t = -Math.PI / 2 + i * 0.75 - 0.6;
      const px = m.cx + Math.cos(t) * 21 - 4, py = m.cy + Math.sin(t) * 21 - 4;
      s += box(px, py, z + 14, 8, 8, 7, "parcel-mini");
    }
  } else {
    s += box(x0, y0, z, w, d, h, "body");
    const face = m.wing === "L" ? "x" : "y"; // the face toward the corridor
    if (m.shape === "func") s += screenOn(m, face, 6, h - 7, 6);
    if (m.shape === "store") for (let k = 1; k <= 3; k++) s += drawerLine(m, face, k * (h / 4));
    if (m.shape === "tree") s += treeGlyph(m);
    if (m.shape === "hw") s += ellipseOnFloor(m.cx, m.cy, z + h + 0.4, 13, "dial") + dialHand(m, z + h + 0.6);
    // a coloured top band says which floor it belongs to (and is the "light" a signal turns on)
    s += rect(x0 + 5, y0 + 5, x0 + w - 5, y0 + d - 5, z + h + 0.3, "lamp");
  }
  if (n.paper) s += paperDoor(m);
  s += `</g>`;
  return s;
}

function screenOn(m, face, inset, zTop, zBot) {
  const { x0, y0, z, w, d } = m;
  if (face === "y") {
    const y = y0 + d + 0.4;
    return poly([[x0 + inset, y, z + zBot], [x0 + w - inset, y, z + zBot], [x0 + w - inset, y, z + zTop], [x0 + inset, y, z + zTop]], "screen");
  }
  const x = x0 + w + 0.4;
  return poly([[x, y0 + inset, z + zBot], [x, y0 + d - inset, z + zBot], [x, y0 + d - inset, z + zTop], [x, y0 + inset, z + zTop]], "screen");
}
function drawerLine(m, face, hz) {
  const { x0, y0, z, w, d } = m;
  const a = face === "y" ? P(x0 + 4, y0 + d + 0.4, z + hz) : P(x0 + w + 0.4, y0 + 4, z + hz);
  const b = face === "y" ? P(x0 + w - 4, y0 + d + 0.4, z + hz) : P(x0 + w + 0.4, y0 + d - 4, z + hz);
  return `<line class="drawer" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
}
function treeGlyph(m) {
  const z = m.z + m.h + 0.5, { cx, cy } = m;
  const n = (x, y) => P(cx + x, cy + y, z);
  const r = n(-10, -10), a = n(8, -6), b = n(-6, 8), c = n(10, 10);
  const L = (p, q) => `<line class="treel" x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(q[0])}" y2="${f1(q[1])}"/>`;
  const dot = (p) => `<circle class="treed" cx="${f1(p[0])}" cy="${f1(p[1])}" r="2.6"/>`;
  return L(r, a) + L(r, b) + L(a, c) + dot(r) + dot(a) + dot(b) + dot(c);
}
function dialHand(m, z) {
  const c = P(m.cx, m.cy, z), e = P(m.cx + 7, m.cy - 6, z);
  return `<line class="hand" x1="${f1(c[0])}" y1="${f1(c[1])}" x2="${f1(e[0])}" y2="${f1(e[1])}"/>`;
}
function paperDoor(m) {
  // a little sheet of paper standing on the machine: "there is a paper inside"
  const x = m.x0 + m.w - 14, y = m.y0 + 4, z = m.z + m.h;
  return `<g class="paperdoor">${poly([[x, y, z], [x + 10, y, z], [x + 10, y, z + 15], [x, y, z + 15]], "pd")}${poly([[x + 2, y - 0.1, z + 11], [x + 8, y - 0.1, z + 11]], "pdl")}</g>`;
}

/* --------------------------------------------------------------- overlay */

/** The OS_CALL elevator: a glass tube standing in the courtyard at the inner corner. Its foot
 *  on the kernel floor is OS_CALL's own stop (the machine of kernel.os-call). */
const CAP1 = "OS_CALL エレベーター", CAP2 = "OS への入口は、ここ 1 つだけ", NOTE1 = "↑ ユーザ空間", NOTE2 = "↓ OS";
function capSize() {
  return { w: Math.ceil(Math.max(measureText(CAP1, 13, 700), measureText(CAP2, 12, 500)) + 26), h: 42 };
}
function noteSize() { return { w: Math.ceil(Math.max(measureText(NOTE1, 12, 700), measureText(NOTE2, 12, 700)) + 12), h: 34 }; }
function capAnchor(e) { const [tx, ty] = P(e.cx, e.cy, e.z1); return [tx, ty - 12]; }
function noteAnchor(g, e) {
  const b = g.floor("os");
  if (!b) return null;
  const [bx, by] = P(e.cx + e.r, e.cy - e.r, b.z + DIM.H - DIM.T / 2);
  return [bx + 12, by + 2];
}
/** World rectangles of the elevator's caption and of the user/OS note, for type scale ls. */
export function elevatorRects(g, ls = 1) {
  const e = g.elevator;
  if (!e) return {};
  const c = capSize(), [cx, cy] = capAnchor(e);
  const out = { cap: { x0: cx - (c.w / 2) * ls, x1: cx + (c.w / 2) * ls, y0: cy - (c.h - 8) * ls, y1: cy + 8 * ls, id: "elev-cap" } };
  const na = noteAnchor(g, e);
  if (na) { const n = noteSize(); out.note = { x0: na[0] - 5 * ls, x1: na[0] + (n.w - 5) * ls, y0: na[1] - 17 * ls, y1: na[1] + 17 * ls, id: "bnote" }; }
  return out;
}

export function elevatorSvg(g, opts = {}) {
  const e = g.elevator;
  if (!e) return "";
  const { cx, cy, r, z0, z1 } = e;
  const active = opts.active || new Set();
  const ls = opts.ls || 1, sc = `scale(${ls.toFixed(4)})`;
  let s = `<g class="elev">`;
  const sm = g.machines.find((m) => m.shape === "shaft");
  if (sm) {
    const room = g.rooms.find((rm) => rm.parts.some((p) => p.shaft && p.floor === sm.floor));
    const tint = room ? roomTint(room.ctx) : "other";
    if (room) s += `<g class="roomg" data-ctx="${room.ctx}">${ellipseOnFloor(cx, cy, sm.z + 0.4, r + 17, `room t-${tint}`)}${ellipseOnFloor(cx, cy, sm.z + 0.4, r + 17, `room-edge e-${tint}`)}</g>`;
    const n = node(sm.node) || {};
    s += `<g class="mach k-shaft tone-${g.floor(sm.floor)?.tone || "kernel"} ${active.has(sm.key) ? "on" : "off"}" data-key="${esc(sm.key)}" data-node="${esc(sm.node)}" tabindex="0" role="button" aria-label="${esc(n.title || sm.node)}">` +
      cylinder(cx, cy, sm.z - SHAFT_BASE, r + 6, SHAFT_BASE, "shaftbase") +
      ellipseOnFloor(cx, cy, sm.z + 0.3, r + 2.5, "lamp") + `</g>`;
  }
  s += cylinder(cx, cy, z0, r, z1 - z0, "tube");
  for (const fid of e.floors) {
    const fl = g.floor(fid);
    // a landing that joins the tube to the floor's corner
    s += poly([[DIM.D - 2, DIM.D - 2, fl.z], [cx, cy - r * 0.2, fl.z], [cx - r * 0.2, cy, fl.z]], "landing");
    s += ellipseOnFloor(cx, cy, fl.z + 0.4, r - 3, "stop");
  }
  // where user space ends: the floor between lib and os
  const b = g.floor("os");
  if (b) {
    s += ellipseOnFloor(cx, cy, b.z + DIM.H - DIM.T / 2, r + 4, "boundary");
    const [nx, ny] = noteAnchor(g, e), n = noteSize();
    s += `<g class="bnote" transform="translate(${f1(nx)},${f1(ny)}) ${sc}"><rect x="-5" y="-17" width="${n.w}" height="34" rx="6"/><text class="b1" x="0" y="-3">${NOTE1}</text><text class="b2" x="0" y="12">${NOTE2}</text></g>`;
  }
  const [tx, ty] = capAnchor(e), c = capSize();
  s += `<g class="elev-cap" data-node="kernel.os-call" transform="translate(${f1(tx)},${f1(ty)}) ${sc}"><rect x="${-c.w / 2}" y="${-(c.h - 8)}" width="${c.w}" height="${c.h}" rx="8"/>` +
    `<text class="c1" x="0" y="-14" text-anchor="middle">${CAP1}</text><text class="c2" x="0" y="3" text-anchor="middle">${CAP2}</text></g>`;
  s += `<g class="car" data-car>${carSvg()}</g>`;
  s += `</g>`;
  return s;
}
function carSvg() {
  // drawn around (0,0) = the floor of the car
  const r = 15, h = 30;
  const rx = r * RX, ry = r * RY;
  return `<path class="car-side" d="M${-rx},${-h} L${-rx},0 A${rx},${ry} 0 0 0 ${rx},0 L${rx},${-h} Z"/><ellipse class="car-top" cx="0" cy="${-h}" rx="${rx}" ry="${ry}"/>`;
}

/* ---------------------------------------------------------------- routing */

const SPACE = { app: "user", lib: "user", os: "kernel", kernel: "kernel", emu: "hw" };

/**
 * World path a courier walks for a step, as a list of [x, y, z]. Each point may carry
 * {via: "elevator" | "ladder"} for the leg that starts there.
 */
export function routeStep(g, step, from, to) {
  const a = g.machine(from), b = g.machine(to);
  if (!a || !b) return null;
  const inShaft = (m) => m.shape === "shaft";
  if (a.floor === b.floor && !inShaft(a) && !inShaft(b)) return flat(g, a.port, b.port, a.wing, b.wing);
  const fa = g.floor(a.floor), fb = g.floor(b.floor);
  const crossesBoundary = SPACE[a.floor] !== SPACE[b.floor];
  const e = g.elevator;
  const served = (f) => !!e && e.floors.includes(f);
  // the elevator is OS_CALL: a syscall rides it, and so does anything that starts or ends at
  // its own stop; a call between two floors of the same thread takes a ladder
  const useElevator = served(a.floor) && served(b.floor) && (step.kind === "syscall" || crossesBoundary || inShaft(a) || inShaft(b));
  if (useElevator) {
    const corner = (z) => [CORRIDOR, CORRIDOR, z];
    const door = (z) => [DIM.D + 6, DIM.D + 6, z];
    const inside = (z) => [e.cx, e.cy, z];
    const p1 = inShaft(a) ? [inside(fa.z)] : [...flat(g, a.port, corner(fa.z), a.wing, "C"), door(fa.z), inside(fa.z)];
    const p2 = inShaft(b) ? [inside(fb.z)] : [inside(fb.z), door(fb.z), ...flat(g, corner(fb.z), b.port, "C", b.wing)];
    return dedupe([...p1, ...p2]);
  }
  // a ladder between the two floors (chaining if needed)
  const path = [a.port];
  let cur = a, curWing = a.wing, curPort = a.port;
  let floorsBetween = fb.index - fa.index;
  const dir = Math.sign(floorsBetween);
  let fi = fa.index;
  while (fi !== fb.index) {
    const here = g.floors[fi], next = g.floors[fi + dir];
    const lo = dir > 0 ? here : next, hi = dir > 0 ? next : here;
    const cands = g.ladders.filter((l) => l.lower === lo.id && l.upper === hi.id);
    if (!cands.length) { // no ladder: drop straight through
      path.push([curPort[0], curPort[1], next.z]);
      fi += dir; curPort = path[path.length - 1];
      continue;
    }
    // the ladder closest along the corridor to where we stand and where we go
    const tgt = b.port;
    cands.sort((l1, l2) => dist2(l1.access, curPort) + dist2(l1.access, tgt) - dist2(l2.access, curPort) - dist2(l2.access, tgt));
    const l = cands[0];
    const acc = [l.access[0], l.access[1], here.z];
    path.push(...flat(g, curPort, acc, curWing, l.wing).slice(1));
    path.push([l.x, l.y, here.z], [l.x, l.y, next.z], [l.access[0], l.access[1], next.z]);
    curPort = path[path.length - 1];
    curWing = l.wing;
    fi += dir;
  }
  path.push(...flat(g, curPort, b.port, curWing, b.wing).slice(1));
  return dedupe(path);
}

function dist2(p, q) { return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; }

/** A walk on one floor along the corridors; wings meet at the corner. */
function flat(g, p, q, wa, wb) {
  const z = p[2];
  const out = [p];
  const sameLine = (wa === wb && wa !== "C") || (Math.abs(p[0] - q[0]) < 0.5) || (Math.abs(p[1] - q[1]) < 0.5);
  if (!sameLine) out.push([CORRIDOR, CORRIDOR, z]);
  out.push([q[0], q[1], z]);
  return dedupe(out);
}
function dedupe(list) {
  const out = [];
  for (const p of list) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(l[0] - p[0], l[1] - p[1], l[2] - p[2]) > 0.5) out.push(p);
  }
  return out;
}

/** Screen anchor for arcs (signals, reads and writes): the top of a machine. */
export function topOf(g, key) {
  const m = g.machine(key);
  return m ? P(m.cx, m.cy, m.z + m.h + 4) : null;
}
