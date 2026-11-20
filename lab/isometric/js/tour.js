// Plays a flow (or a paper) step by step in the building: a person per thread walks the
// corridors, rides the OS_CALL elevator or climbs a ladder; a signal is a light running on a
// wire; a read or write is a chip on a dashed line.
//
// Where every person stands before and after each step is worked out once per sheet
// (choreograph): the steps say who carries what; between steps a person who handed its work to
// another thread goes back to where it left its own room and waits there (the app thread waits
// for REPLY in app_transport.request, not inside the OS), a thread that a parcel or a light is
// meant for comes to meet it, and an interrupt leaves once its last step is done.
import { A, KIND_JA, FLOOR_NO, layerById, threadOfCtx } from "./model.js";
import { DIM, routeStep, topOf } from "./building.js";
import { P, f1, esc, along, pathLength, RX, RY } from "./iso.js";
import { view, frame, fitK, lookAt, narrow, FOLLOW_K_NARROW } from "./scene.js";
import { measure } from "./labels.js";

const SPEED = 230; // world units per second while walking
const FAST = SPEED * 1.8; // a walk that is not the step itself: going back, coming to meet
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const THS = ["app", "svc", "irq", "other"];
// an interrupt is not a thread that waits: once its part is over it is gone
const EPHEMERAL = new Set(["irq"]);

export const tour = {
  g: null, sh: null, idx: 0, follow: false, onArrive: null,
  figs: {}, // thread key -> {el, visible}
  car: null, plan: {}, anim: null,
};

const $ = (id) => document.getElementById(id);

/** Called after scene.mount(); builds the moving pieces for the sheet. */
export function attach(g, sh, threadHint) {
  cancelAnimationFrame(tour.anim?.raf);
  tour.anim = null;
  tour.g = g;
  tour.sh = sh;
  tour.threadHint = threadHint || null;
  tour.figs = {};
  const actors = $("ov-actors");
  actors.innerHTML = "";
  for (const key of THS) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("class", `fig th-${key} gone`);
    el.innerHTML = figureSvg();
    actors.appendChild(el);
    tour.figs[key] = { el, visible: false, key };
  }
  tour.parcel = document.createElementNS("http://www.w3.org/2000/svg", "g");
  tour.parcel.setAttribute("class", "parcel");
  tour.parcel.style.display = "none";
  actors.appendChild(tour.parcel);
  tour.car = document.querySelector("[data-car]");
  if (g.elevator) setCar(g.floor(g.elevator.floors[g.elevator.floors.length - 1]).z);
  tour.plan = choreograph(sh);
}

function figureSvg() {
  // feet at (0,0); a shadow, a body, a head; a bubble while it waits
  const ls = view.ls || 1;
  const w = Math.ceil(measure("待つ", 12, 700) + 16);
  return `<ellipse class="f-sh" cx="0" cy="0" rx="10" ry="5"/>` +
    `<g class="f-man"><path class="f-body" d="M-8,-3 C-8.5,-19 -6,-25 0,-25 C6,-25 8.5,-19 8,-3 Z"/>` +
    `<circle class="f-head" cx="0" cy="-32" r="6.2"/></g>` +
    `<g class="f-carry"></g>` +
    `<g class="f-wait" transform="translate(9,-44) scale(${ls.toFixed(4)})"><path d="M0,0 L6,-6 L${w},-6 Q${w + 6},-6 ${w + 6},-12 L${w + 6},-24 Q${w + 6},-30 ${w},-30 L6,-30 Q0,-30 0,-24 Z"/><text x="${f1((w + 6) / 2 + 3)}" y="-13.5" text-anchor="middle">待つ</text></g>`;
}

function setCar(z) {
  if (!tour.car || !tour.g.elevator) return;
  const e = tour.g.elevator;
  const [x, y] = P(e.cx, e.cy, z);
  tour.car.setAttribute("transform", `translate(${f1(x)},${f1(y)})`);
}

/* ------------------------------------------------------------ step model */

const WALKS = new Set(["call", "syscall"]);
function modeOf(s, sh = tour.sh) {
  if (s.kind === "signal") return "signal";
  if (s.kind === "data") return "data";
  if (WALKS.has(s.kind)) return "walk";
  if (s.kind === "return") {
    // a return walks when the same thread goes back; otherwise the result travels alone
    const rf = sh.regionOfBox?.[s.from], rt = sh.regionOfBox?.[s.to];
    const thr = (r) => (r ? A.nodes[r.node]?.run : null);
    if (!rf || !rt || thr(rf) === thr(rt)) return "walk";
    return "parcel";
  }
  return "parcel"; // msg
}
const keyOfBox = (boxId) => (tour.g.id === "main" ? tour.sh.boxById[boxId]?.node : boxId);
function threadKey(s) { return (s.thread || tour.threadHint)?.key || (s.kind === "signal" ? null : "other"); }

/**
 * For every step index: where each person stands before (pre) and after (post) it, the walks
 * that are not the step itself (moves: before / with / after the step's own travel), who
 * appears (start or on arrival) and who leaves.
 */
function choreograph(sh) {
  const plans = {};
  const regionNode = (box) => sh.regionOfBox?.[box]?.node || null;
  const regionThread = (box) => { const r = sh.regionOfBox?.[box]; return r ? threadOfCtx(r.node)?.key || null : null; };
  const clone = (pos) => Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, { ...v }]));
  /** One step: its plan, and the state after it. rest = this step and the ones after it. */
  const stepPlan = (s, rest, st) => {
    const pos = clone(st.pos), home = { ...st.home }, entry = { ...st.entry };
    const next = rest[1] || null;
    const plan = { moves: [], appear: [], gone: [], wake: [] };
    // an interrupt whose part is over has gone back
    for (const t of Object.keys(pos)) {
      if (EPHEMERAL.has(t) && !rest.some((x) => threadKey(x) === t)) { plan.gone.push(t); delete pos[t]; }
    }
    const th = threadKey(s), mode = modeOf(s, sh);
    plan.th = th; plan.mode = mode;
    // the one who carries the step stands where it starts: it walks there first (or, for a
    // read or write, while the chip travels); the first time, it appears there
    const need = mode === "walk" || mode === "parcel" ? s.from : mode === "data" ? s.actorBox : null;
    if (th && need) {
      if (!pos[th]) { plan.appear.push({ th, box: need, at: "start" }); pos[th] = { box: need }; }
      else if (pos[th].box !== need) {
        plan.moves.push({ th, from: pos[th].box, to: need, phase: mode === "data" ? "with" : "before" });
        pos[th] = { box: need };
      }
      if (pos[th].wait) { plan.wake.push(th); pos[th].wait = false; }
      if (!(th in home)) home[th] = regionNode(need);
    }
    plan.pre = clone(pos);
    for (const a of plan.appear) if (a.at === "start") plan.pre[a.th].appearing = true;
    if (mode === "walk" && th) {
      pos[th] = { box: s.to };
      if (s.kind === "syscall") entry[th] = s.from; // where it left its own room
      if (regionNode(s.to) && regionNode(s.to) === home[th]) delete entry[th];
    }
    // a parcel or a light is for the thread of the room it goes to: that thread comes to meet it
    if (mode === "parcel" || mode === "signal") {
      const R = regionThread(s.to);
      if (R && R !== th) {
        if (!pos[R]) plan.appear.push({ th: R, box: s.to, at: "arrive" });
        else if (pos[R].box !== s.to) plan.moves.push({ th: R, from: pos[R].box, to: s.to, phase: "with" });
        if (pos[R]?.wait) plan.wake.push(R);
        pos[R] = { box: s.to };
        if (!(R in home)) home[R] = regionNode(s.to);
      }
    }
    // hand-off: the next step is another thread's. A thread that is away from its own room
    // (it came in by a syscall) goes back to where it left the room and waits there.
    if (th && next && threadKey(next) !== th && pos[th] && entry[th] && regionNode(pos[th].box) !== home[th]) {
      plan.moves.push({ th, from: pos[th].box, to: entry[th], phase: "after", wait: true });
      pos[th] = { box: entry[th], wait: true };
      delete entry[th];
    }
    plan.post = clone(pos);
    plans[s.index] = plan;
    return { pos, home, entry };
  };
  // the main line
  let st = { pos: {}, home: {}, entry: {} };
  const before = {};
  sh.main.forEach((s, k) => { before[s.index] = st; st = stepPlan(s, sh.main.slice(k), st); });
  // each run of alt steps starts from the state before the step it replaces
  const runs = {};
  for (const a of sh.alts) (runs[a.alt.at] ||= []).push(a);
  for (const [at, list] of Object.entries(runs)) {
    let s2 = before[at] || { pos: {}, home: {}, entry: {} };
    list.forEach((a, k) => { s2 = stepPlan(a, list.slice(k), s2); });
  }
  return plans;
}

/* ------------------------------------------------------------- drawing */

function slotsFor(plan) {
  // who stands where: on a box the step's own mover takes the middle, the others step aside
  // (the same places before and after, so nobody jumps)
  const at = {};
  for (const map of [plan.pre, plan.post]) for (const [th, v] of Object.entries(map)) (at[v.box] ||= new Set()).add(th);
  const slot = {};
  for (const [box, set] of Object.entries(at)) {
    const list = [...set].sort((a, b) => (a === plan.th ? -1 : b === plan.th ? 1 : THS.indexOf(a) - THS.indexOf(b)));
    list.forEach((th, n) => (slot[th + "@" + box] = n));
  }
  return slot;
}
function standAt(box, n) {
  const m = tour.g.machine(keyOfBox(box));
  if (!m) return null;
  const d = n ? 21 * Math.ceil(n / 2) * (n % 2 ? 1 : -1) : 0;
  const p = m.port;
  if (m.wing === "L") return [p[0], p[1] + d, p[2]];
  if (m.wing === "C") return [p[0] + d * 0.7, p[1] - d * 0.7, p[2]];
  return [p[0] + d, p[1], p[2]];
}
function placeFig(key, p, opts = {}) {
  const f = tour.figs[key];
  if (!f || !p) return;
  const [x, y] = P(...p);
  f.el.setAttribute("transform", `translate(${f1(x)},${f1(y)})`);
  f.el.classList.remove("gone");
  if ("idle" in opts) f.el.classList.toggle("idle", !!opts.idle);
  if ("walking" in opts) f.el.classList.toggle("walking", !!opts.walking);
  if ("wait" in opts) f.el.classList.toggle("waiting", !!opts.wait);
  f.visible = true;
}
function hideFig(key, fade = false) {
  const f = tour.figs[key];
  if (!f) return;
  f.el.classList.toggle("fading", fade);
  f.el.classList.add("gone");
  f.visible = false;
}

function parcelSvg(data, big) {
  const s = big ? 13 : 10;
  const cube = (x0, y0, z0) => {
    const q = (a) => a.map((p) => P(...p).map(f1).join(",")).join(" ");
    const x1 = x0 + s, y1 = y0 + s, z1 = z0 + s * 0.8;
    return `<polygon class="pl" points="${q([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]])}"/>` +
      `<polygon class="pr" points="${q([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]])}"/>` +
      `<polygon class="pt" points="${q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])}"/>`;
  };
  return `<g class="box${isAddr(data) ? " addr" : ""}">${cube(-s / 2, -s / 2, 0)}</g>`;
}
/** Only an address is handed over (the label is &Something). */
export const isAddr = (data) => !!data?.label && /^&/.test(data.label);

function routeSvg(path, cls) {
  const pts = path.map((p) => P(...p).map(f1).join(",")).join(" ");
  return `<g class="routeg ${cls}"><polyline class="route-shade" points="${pts}"/><polyline class="route" points="${pts}"/><polyline class="route-flow" points="${pts}"/>${endCap(path)}</g>`;
}
function endCap(path) {
  // an arrowhead lying on the floor at the end of the walk
  const n = path.length;
  const b = path[n - 1];
  let a = path[n - 2] || b;
  for (let k = n - 2; k >= 0 && Math.hypot(b[0] - path[k][0], b[1] - path[k][1], b[2] - path[k][2]) < 1; k--) a = path[k - 1] || a;
  const pb = P(...b), pa = P(...a);
  const ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180 / Math.PI;
  return `<path class="route-head" d="M-9,-6.5 L3,0 L-9,6.5 Z" transform="translate(${f1(pb[0])},${f1(pb[1])}) rotate(${f1(ang)})"/>`;
}

function arcFor(aKey, bKey) {
  const a = topOf(tour.g, aKey), b = topOf(tour.g, bKey);
  if (!a || !b) return null;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  // bow upward, more for long arcs; a vertical arc bows sideways
  const lift = Math.min(70, 18 + len * 0.18);
  let cx = mx, cy = my - lift;
  if (Math.abs(dx) < 24) { cx = mx + lift * 0.8; cy = my; }
  return { a, b, c: [cx, cy], d: `M${f1(a[0])},${f1(a[1])} Q${f1(cx)},${f1(cy)} ${f1(b[0])},${f1(b[1])}` };
}
function qAt(arc, u) {
  const { a, b, c } = arc, v = 1 - u;
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
}

/* -------------------------------------------------------------- showing */

/** Shows step index i. With animate, everything travels; otherwise it is drawn arrived. */
export function show(i, { animate = true } = {}) {
  const sh = tour.sh;
  const s = sh.steps[i];
  if (!s) return;
  cancelAnimationFrame(tour.anim?.raf);
  tour.idx = i;
  const g = tour.g, ls = view.ls || 1;
  const plan = tour.plan[i] || { pre: {}, post: {}, moves: [], appear: [], gone: [], wake: [] };
  const under = $("ov-under"), lines = $("ov-lines"), signs = $("ov-signs");
  lines.innerHTML = ""; signs.innerHTML = "";
  document.querySelectorAll(".mach.lit, .lbl.lit, .mach.from, .lbl.from").forEach((e) => e.classList.remove("lit", "from"));
  const fromKey = keyOfBox(s.from), toKey = keyOfBox(s.to);
  mark(fromKey, "from");
  const mode = plan.mode || modeOf(s);
  const th = plan.th !== undefined ? plan.th : threadKey(s);
  const slot = slotsFor(plan);
  const spot = (t, box) => standAt(box, slot[t + "@" + box] || 0);
  // where everybody stands at the start
  const arriving = new Set(plan.appear.filter((a) => a.at === "arrive").map((a) => a.th));
  for (const key of THS) {
    const v = plan.pre[key];
    if (!v) { hideFig(key, plan.gone.includes(key) && animate && !reduced); continue; }
    placeFig(key, spot(key, v.box), { idle: key !== th, walking: false, wait: !!v.wait });
    if (v.appearing) appear(key, animate);
  }
  for (const key of arriving) hideFig(key);
  tour.parcel.style.display = "none";
  const thCls = `th-${th || "none"}`;
  // the numbers of the other steps keep off the people standing here
  const people = [];
  for (const map of [plan.pre, plan.post]) for (const [key, v] of Object.entries(map)) {
    const p = spot(key, v.box);
    if (p) { const [x, y] = P(...p); people.push({ x0: x - 11, x1: x + 11, y0: y - 42, y1: y + 5 }); }
  }
  under.innerHTML = ghostSvg(i, people);
  // the step's own travel
  let travel = null; // {kind, path|arc, dur}
  if (mode === "walk" || mode === "parcel") {
    const path = routeStep(g, s, fromKey, toKey);
    if (path) {
      under.insertAdjacentHTML("beforeend", routeSvg(path, `${thCls} k-${s.kind}`));
      travel = { kind: mode, path, len: pathLength(path), rides: ridesElevator(path) };
      travel.dur = Math.min(4200, Math.max(1100, (travel.len / SPEED) * 1000 + elevatorExtra(path)));
      // the walker leaves from its own spot and arrives in the middle
      if (mode === "walk" && th) { travel.o0 = offsetOf(spot(th, s.from), s.from); }
    }
  } else {
    const arc = arcFor(fromKey, toKey);
    if (arc) {
      lines.insertAdjacentHTML("beforeend", `<path class="arc k-${s.kind} ${thCls}" d="${arc.d}" marker-end="url(#arrow)"/>`);
      travel = { kind: mode, arc, dur: mode === "signal" ? 1000 : 1300 };
    }
  }
  // the other walks of this step
  const moves = plan.moves.map((mv) => {
    const path = routeStep(g, { kind: "call" }, keyOfBox(mv.from), keyOfBox(mv.to));
    if (!path) return null;
    const len = pathLength(path);
    return { ...mv, path, len, dur: Math.max(500, (len / FAST) * 1000 + elevatorExtra(path) * 0.6), o0: offsetOf(spot(mv.th, mv.from), mv.from), o1: offsetOf(spot(mv.th, mv.to), mv.to) };
  }).filter(Boolean);
  for (const mv of moves) under.insertAdjacentHTML("beforeend", `<polyline class="ghost walkback th-${mv.th}" points="${mv.path.map((p) => P(...p).map(f1).join(",")).join(" ")}"/>`);
  const tBefore = Math.max(0, ...moves.filter((m) => m.phase === "before").map((m) => m.dur));
  const tMain = Math.max(travel?.dur || 0, ...moves.filter((m) => m.phase === "with").map((m) => m.dur));
  const tAfter = Math.max(0, ...moves.filter((m) => m.phase === "after").map((m) => m.dur));
  const total = tBefore + tMain + tAfter;
  // what is carried
  const carry = s.data || null;
  for (const f of Object.values(tour.figs)) f.el.querySelector(".f-carry").innerHTML = "";
  if (travel?.kind === "walk" && th && carry) tour.figs[th].el.querySelector(".f-carry").innerHTML = `<g transform="translate(11,-20)">${parcelSvg(carry)}</g>`;
  if (travel?.kind === "parcel") {
    tour.parcel.innerHTML = parcelSvg(carry || { label: s.verb || KIND_JA[s.kind] }, true);
    tour.parcel.setAttribute("class", `parcel ${thCls}`);
    tour.parcel.style.display = "";
  }
  if (travel?.kind === "signal") lines.insertAdjacentHTML("beforeend", `<circle class="spark" r="7" filter="url(#glow)"/>`);
  if (travel?.kind === "data") lines.insertAdjacentHTML("beforeend", `<g class="chip"><g transform="scale(${ls.toFixed(4)})">${chipSvg(carry?.label || s.verb || "値")}</g></g>`);
  // the sign that travels with it
  signs.innerHTML = `<line class="slead" style="display:none"/>` + signSvg(s, ls);
  const sign = signs.querySelector(".ssign");
  if (travel) travel.dock = dockOffset(travel, sign);
  // camera
  const focus = { b: stepBounds(travel, fromKey, toKey, moves, sign), end: endBounds(travel, toKey, sign), core: endBounds(travel, toKey, null) };
  if (tour.follow) followStart(focus, travel, moves, fromKey, toKey, animate);
  else hideChip();
  let arrived = false;
  const arrive = () => {
    if (arrived) return;
    arrived = true;
    if (tour.follow) followEnd(focus, animate && !reduced);
    mark(toKey, "lit");
    ping(toKey, animate && !reduced);
    for (const a of plan.appear) if (a.at === "arrive") { placeFig(a.th, spot(a.th, a.box), { idle: false, wait: false }); appear(a.th, animate); }
    for (const w of plan.wake) { tour.figs[w]?.el.classList.remove("waiting", "idle"); }
  };
  // a thread that a parcel or a light was for is awake at the end of the step
  const woken = new Set([...plan.wake, ...plan.appear.filter((a) => a.at === "arrive").map((a) => a.th), ...plan.moves.filter((m) => m.phase === "with" && m.th !== th).map((m) => m.th)]);
  const end = () => {
    arrive();
    // everybody where the plan says, in case a frame was skipped
    for (const key of THS) {
      const v = plan.post[key];
      if (v) placeFig(key, spot(key, v.box), { idle: (key !== th && !woken.has(key)) || !!v.wait, walking: false, wait: !!v.wait });
    }
    tour.anim = null;
    // the camera has settled on where the step ends: the sign is drawn again inside that view
    if (tour.follow && focus.track) at(total + 1);
    updateChip(toKey);
    if (tour.onArrive) tour.onArrive(i);
  };
  const at = (t) => drawAt(t, { travel, moves, tBefore, tMain, th, sign, arrive, focus });
  if (!animate || reduced || total <= 0) {
    at(total + 1);
    end();
    return;
  }
  const t0 = performance.now();
  const loop = (t) => {
    const dt = t - t0;
    at(dt);
    if (dt < total) tour.anim = { raf: requestAnimationFrame(loop) };
    else end();
  };
  at(0);
  tour.anim = { raf: requestAnimationFrame(loop) };
}

function appear(key, animate) {
  const el = tour.figs[key]?.el;
  if (!el || !animate || reduced) return;
  el.classList.remove("appear");
  void el.getBBox();
  el.classList.add("appear");
}

/** Offset of a stand spot from the machine's port (world units). */
function offsetOf(p, box) {
  const m = tour.g.machine(keyOfBox(box));
  if (!m || !p) return [0, 0, 0];
  return [p[0] - m.port[0], p[1] - m.port[1], 0];
}

function drawAt(t, { travel, moves, tBefore, tMain, th, sign, arrive, focus }) {
  // fp: where the camera looks while it tracks (screen point): the walk before the step, then
  // the step's own travel; after that it rests on where the step arrived
  let carZ = null, fp = null, floorP = null;
  // walks that are not the step itself
  for (const mv of moves) {
    const t0 = mv.phase === "before" ? 0 : mv.phase === "with" ? tBefore : tBefore + tMain;
    const u = Math.max(0, Math.min(1, (t - t0) / mv.dur));
    const { p } = along(mv.path, ease(u) * mv.len);
    const o = mv.o0.map((v, k) => v + (mv.o1[k] - v) * u);
    const q = [p[0] + o[0], p[1] + o[1], p[2]];
    const moving = u > 0 && u < 1;
    if (t >= t0) placeFig(mv.th, q, { walking: moving, wait: u >= 1 && !!mv.wait, idle: mv.th !== th || !!mv.wait });
    if (moving && inCar(p)) carZ = p[2];
    if (moving && mv.phase === "before") { const s2 = P(...q); fp = [s2[0], s2[1] - 40]; floorP = q; }
  }
  // the step's own travel; anchor is the point over the mover, sp where its sign is
  let sp = null, anchor = null;
  if (travel) {
    const u = Math.max(0, Math.min(1, (t - tBefore) / travel.dur));
    const e = ease(u);
    if (travel.kind === "walk" || travel.kind === "parcel") {
      const { p } = along(travel.path, e * travel.len);
      if (inCar(p) && (t >= tBefore && t <= tBefore + travel.dur)) carZ = p[2];
      if (travel.kind === "walk") {
        const o = travel.o0 ? travel.o0.map((v) => v * (1 - u)) : [0, 0, 0];
        if (th) placeFig(th, [p[0] + o[0], p[1] + o[1], p[2]], { walking: u > 0 && u < 1, idle: false, wait: false });
      } else {
        const [x, y] = P(...p);
        tour.parcel.setAttribute("transform", `translate(${f1(x)},${f1(y)})`);
      }
      const a = P(...p);
      anchor = [a[0], a[1] - (travel.kind === "walk" ? 64 : 48)];
      sp = sign && travel.rides ? besideTube(p, anchor, +sign.dataset.w * (view.ls || 1)) : anchor;
      if (t >= tBefore && t <= tBefore + travel.dur) { fp = [anchor[0], anchor[1] + 24]; floorP = p; }
    } else {
      const q = qAt(travel.arc, e);
      const el = travel.kind === "signal" ? document.querySelector("#ov-lines .spark") : document.querySelector("#ov-lines .chip");
      if (el) {
        if (travel.kind === "signal") { el.setAttribute("cx", f1(q[0])); el.setAttribute("cy", f1(q[1])); }
        else el.setAttribute("transform", `translate(${f1(q[0])},${f1(q[1])})`);
      }
      sp = anchor = [q[0], q[1] - 22];
      if (t >= tBefore && t <= tBefore + travel.dur) fp = [q[0], q[1] - 10];
    }
    if (u >= 1) arrive();
    if (sign && sp) {
      const k = travel.dock ? Math.max(0, Math.min(1, (u - 0.72) / 0.28)) : 0;
      const kk = k * k * (3 - 2 * k);
      const ox = (travel.dock?.[0] || 0) * kk, oy = (travel.dock?.[1] || 0) * kk;
      // keep the whole sign on screen
      let x = sp[0] + ox, y = sp[1] + oy;
      const vb = (focus.settled ? view.vb : view.vbNow) || view.vb, ls = view.ls || 1, w = +sign.dataset.w * ls, h = +sign.dataset.h * ls;
      if (vb && w) {
        x = Math.max(vb[0] + w / 2 + 6, Math.min(vb[0] + vb[2] - w / 2 - 6, x));
        y = Math.max(vb[1] + h + 6, y);
      }
      sign.setAttribute("transform", `translate(${f1(x)},${f1(y)}) scale(${ls.toFixed(4)})`);
      // a sign that had to step away keeps a thin line to where the step arrives
      const lead = document.querySelector("#ov-signs .slead");
      if (lead) {
        const far = Math.hypot(x - anchor[0], y - anchor[1]) > 26 * ls;
        lead.style.display = far ? "" : "none";
        if (far) { lead.setAttribute("x1", f1(x)); lead.setAttribute("y1", f1(y)); lead.setAttribute("x2", f1(anchor[0])); lead.setAttribute("y2", f1(anchor[1] + (travel.kind === "walk" ? 30 : 20))); }
      }
    }
  } else if (t >= tBefore) arrive();
  if (carZ !== null) setCar(carZ);
  if (tour.follow && focus.track && fp && !focus.settled) followTrack(fp, focus);
  if (floorP) updateChipAt(floorP);
}
const inCar = (p) => tour.g.elevator && Math.hypot(p[0] - tour.g.elevator.cx, p[1] - tour.g.elevator.cy) < tour.g.elevator.r;

/* --------------------------------------------------------------- camera */

const followK = () => (narrow() ? FOLLOW_K_NARROW : 1);
/** Frames the step; when it does not fit at a readable zoom, the camera tracks the mover. */
function followStart(focus, travel, moves, fromKey, toKey, animate) {
  const b = focus.b;
  const kMin = followK();
  const k = fitK(b, 24, 1.5);
  if (k >= kMin) { focus.track = null; frame(b, animate, 24, 1.5); return; }
  // start on where the step begins (the first mover), then follow
  focus.track = { k: kMin, c: null };
  const first = moves.find((m) => m.phase === "before") || null;
  const start = first ? P(...first.path[0]) : travel?.path ? P(...travel.path[0]) : travel?.arc ? travel.arc.a : P(...tour.g.machine(fromKey).port);
  focus.track.c = [start[0], start[1] - 40];
  lookAt(focus.track.c[0], focus.track.c[1], kMin, animate, 500);
}
function followTrack(tgt, focus) {
  const c = focus.track.c || tgt.slice();
  // ease toward the mover
  c[0] += (tgt[0] - c[0]) * 0.14;
  c[1] += (tgt[1] - c[1]) * 0.14;
  focus.track.c = c;
  lookAt(c[0], c[1], focus.track.k, false);
}
function followEnd(focus, animate) {
  if (!focus.track) return;
  // settle on where the step ends: the machine reached, its label and the sign; when all of it
  // does not fit at a readable zoom, the machine and its label (the sign is then kept in view)
  focus.settled = true;
  const all = focus.end && fitK(focus.end, 24, 1.5) >= focus.track.k;
  const b = all ? focus.end : focus.core || focus.end;
  if (b) frame(b, animate, 24, all ? 1.5 : focus.track.k, 450, focus.track.k);
}
/** Screen box of where a step ends: the machine reached, its label and the docked sign. */
function endBounds(travel, toKey, sign) {
  const xs = [], ys = [];
  const add = (r) => { if (r) { xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); } };
  add(tour.g.machine(toKey)?.bounds);
  add(view.labels?.[toKey]?.r);
  if (travel && sign) {
    const ls = view.ls || 1, w = +sign.dataset.w * ls, h = +sign.dataset.h * ls;
    const [sx, sy] = signAt(travel, 1, w), [ox, oy] = travel.dock || [0, 0];
    add({ x0: sx + ox - w / 2 - 6, x1: sx + ox + w / 2 + 6, y0: sy + oy - h - 6, y1: sy + oy });
  }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Screen box around a step: both machines, the way between, their labels and the sign. */
export function stepBounds(travel, fromKey, toKey, moves = [], sign = null) {
  const xs = [], ys = [];
  const add = (r) => { if (r) { xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); } };
  for (const k of [fromKey, toKey]) { add(tour.g.machine(k)?.bounds); add(view.labels?.[k]?.r); }
  if (travel?.path) for (const p of travel.path) { const [x, y] = P(...p); xs.push(x); ys.push(y - 70); }
  if (travel?.arc) { xs.push(travel.arc.c[0]); ys.push(travel.arc.c[1] - 40); }
  for (const mv of moves) for (const p of mv.path) { const [x, y] = P(...p); xs.push(x); ys.push(y - 50); }
  if (travel && sign) {
    const ls = view.ls || 1, w = +sign.dataset.w * ls, h = +sign.dataset.h * ls;
    const [sx, sy] = signAt(travel, 1, w), [ox, oy] = travel.dock || [0, 0];
    xs.push(sx + ox - w / 2 - 6, sx + ox + w / 2 + 6); ys.push(sy + oy - h - 6);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/* ----------------------------------------------------------- floor chip */
// While the camera follows, the floor signs are often off screen: a chip at the stage edge says
// which floor (layer) the moving thing is on.
let chipFloor = null;
function floorAt(z) {
  const fl = tour.g.floors.slice().reverse().find((f) => z >= f.z - 1);
  return fl || tour.g.floors[0];
}
function setChip(fl) {
  const el = $("floorchip");
  if (!el || !fl) return;
  if (chipFloor === fl.id && !el.hidden) return;
  chipFloor = fl.id;
  el.hidden = false;
  el.className = `floorchip tone-${fl.tone}`;
  el.innerHTML = `${fl.no ? `<b>${esc(fl.no)}</b>` : ""}<span>${esc(fl.name)}</span>${fl.sub ? `<small>${esc(fl.sub)}</small>` : ""}`;
}
function updateChipAt(p) { if (tour.follow) setChip(floorAt(p[2])); }
function updateChip(key) {
  if (!tour.follow) return hideChip();
  const m = tour.g.machine(key);
  if (m) setChip(tour.g.floor(m.floor));
}
function hideChip() { const el = $("floorchip"); if (el) el.hidden = true; chipFloor = null; }
/** The floor chip for the record (trace.js): on a narrow screen it names the running thread's floor. */
export function showFloorChip(fl) { if (fl) setChip(fl); else hideChip(); }

/* ---------------------------------------------------- the whole tour, faint */

/** All main steps of the sheet, faint, with their numbers: the shape of the whole tour. */
const markAt = {};
function ghostSvg(cur, people = []) {
  const sh = tour.sh, ls = view.ls || 1;
  for (const k of Object.keys(markAt)) delete markAt[k];
  const curStep = sh.steps[cur];
  let lines = "", marks = "";
  const placed = [];
  const R = 12 * ls;
  const avoid = (view.rects || []).concat(people);
  for (const s of sh.main) {
    if (s.index === cur) continue;
    const fromKey = keyOfBox(s.from), toKey = keyOfBox(s.to);
    const m = modeOf(s), th = threadKey(s) || "none";
    let mk = null;
    const taken = avoid.concat(placed.map(([x, y]) => ({ x0: x - R, x1: x + R, y0: y - R, y1: y + R })));
    if (m === "walk" || m === "parcel") {
      const path = routeStep(tour.g, s, fromKey, toKey);
      if (!path) continue;
      const pts = path.map((p) => P(...p).map(f1).join(",")).join(" ");
      lines += `<polyline class="ghost th-${th} k-${s.kind}" points="${pts}"/>`;
      mk = markerPoint(path, taken, R);
    } else {
      const arc = arcFor(fromKey, toKey);
      if (!arc) continue;
      lines += `<path class="ghost arcg th-${th} k-${s.kind}" d="${arc.d}"/>`;
      mk = arcMarker(arc, taken, R);
    }
    placed.push(mk.q);
    markAt[s.index] = mk.q;
    const done = !curStep.alt && s.index < cur;
    const tick = mk.on ? `<line class="gtick" x1="${f1(mk.on[0])}" y1="${f1(mk.on[1])}" x2="${f1(mk.q[0])}" y2="${f1(mk.q[1])}"/>` : "";
    const verb = s.verb || KIND_JA[s.kind] || "";
    marks += `${tick}<g class="gmark th-${th}${done ? " done" : ""}" data-step="${s.index}" role="button" aria-label="${esc(`手順 ${s.no} ${verb}`)}" transform="translate(${f1(mk.q[0])},${f1(mk.q[1])}) scale(${ls.toFixed(4)})"><circle r="11.5"/><text y="4.5" text-anchor="middle">${s.no}</text></g>`;
  }
  const mkEl = $("ov-marks");
  if (mkEl) mkEl.innerHTML = `<g class="gmarks">${marks}</g>`;
  tour.marks = placed.map(([x, y]) => ({ x0: x - R, x1: x + R, y0: y - R, y1: y + R }));
  return `<g class="ghosts">${lines}</g>`;
}

const hitCount = (q, avoid, R) => avoid.reduce((n, r) => n + (q[0] > r.x0 - R && q[0] < r.x1 + R && q[1] > r.y0 - R && q[1] < r.y1 + R ? 1 : 0), 0);

/** Where a step's number sits on its way: a level stretch near the middle, clear of the
 *  elevator, the labels, the signs and the numbers already placed. If no spot on the way is
 *  free, the number stands just off the way with a short tick to it. */
function markerPoint(path, avoid, R) {
  const e = tour.g.elevator, total = pathLength(path) || 1;
  const cands = [];
  let acc = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const level = Math.abs(a[2] - b[2]) < 0.5 && len > 20;
    if (level) for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const w = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2]];
      const nearE = e ? Math.max(0, e.r + 40 - Math.hypot(w[0] - e.cx, w[1] - e.cy)) : 0;
      cands.push({ q: P(...w), base: (Math.abs(acc + len * t - total / 2) / total) * 60 + nearE * 3 + Math.abs(t - 0.5) * 10 });
    }
    acc += len;
  }
  if (!cands.length) cands.push({ q: P(...along(path, total * 0.5).p), base: 0 });
  let best = null;
  for (const c of cands) {
    const score = c.base + hitCount(c.q, avoid, R) * 1e4;
    if (!best || score < best.score) best = { score, q: c.q };
  }
  if (best.score < 1e4) return { q: best.q };
  // nudge off the way
  const offs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
  for (const dist of [2.4, 3.6, 5]) for (const c of cands.slice(0, 6)) for (const [dx, dy] of offs) {
    const q = [c.q[0] + dx * R * dist, c.q[1] + dy * R * dist];
    if (!hitCount(q, avoid, R)) return { q, on: c.q };
  }
  return { q: best.q };
}
function arcMarker(arc, avoid, R) {
  for (const u of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) {
    const q = qAt(arc, u);
    if (!hitCount(q, avoid, R)) return { q };
  }
  const c = qAt(arc, 0.5);
  for (const dist of [2.4, 3.6]) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const q = [c[0] + dx * R * dist, c[1] + dy * R * dist];
    if (!hitCount(q, avoid, R)) return { q, on: c };
  }
  return { q: c };
}

/** The way goes up or down inside the elevator's tube. */
function ridesElevator(path) {
  const e = tour.g.elevator;
  return !!e && path.some((p, k) => k && Math.abs(p[2] - path[k - 1][2]) > 1 && Math.hypot(p[0] - e.cx, p[1] - e.cy) < e.r);
}

function elevatorExtra(path) {
  // riding takes a moment longer: the car starts and stops
  return path.some((p, k) => k && p[2] !== path[k - 1][2] && Math.abs(p[0] - (tour.g.elevator?.cx ?? -1)) < 1) ? 700 : 250;
}

function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

/** Where the sign rests at the end: above the arrival point unless something is there. */
function signAt(travel, u, w = 0) {
  if (travel.kind === "walk" || travel.kind === "parcel") {
    const { p } = along(travel.path, u * travel.len);
    const sp = P(...p);
    const at = [sp[0], sp[1] - (travel.kind === "walk" ? 64 : 48)];
    return travel.rides ? besideTube(p, at, w) : at;
  }
  const q = qAt(travel.arc, u);
  return [q[0], q[1] - 22];
}
/** In the elevator the sign rides beside the tube, on its left: above the car it would cover the
 *  caption and the user space / OS note on the tube's right. */
function besideTube(p, sp, w) {
  const e = tour.g.elevator;
  if (!e || !w) return sp;
  // from a few steps before the door, all the way while riding
  const f = Math.max(0, Math.min(1, (e.r + 64 - Math.hypot(p[0] - e.cx, p[1] - e.cy)) / 50));
  if (!f) return sp;
  const ls = view.ls || 1;
  const x = P(e.cx, e.cy, p[2])[0] - e.r * RX - w / 2 - 12 * ls;
  return [sp[0] + (x - sp[0]) * f, sp[1] + 34 * ls * f];
}
function dockOffset(travel, sign) {
  const ls = view.ls || 1;
  const w = +sign.dataset.w * ls, h = +sign.dataset.h * ls;
  const [x, y] = signAt(travel, 1, w);
  // labels, plates, floor signs, the elevator's caption and the user/OS note, the legend, and
  // the step numbers; the machines reached are kept clear too
  const rects = (view.rects || []).concat(tour.marks || []);
  for (const k of [keyOfBox(tour.sh.steps[tour.idx].to)]) { const m = tour.g.machine(k); if (m) rects.push(m.bounds); }
  const tries = [[0, 0]];
  for (let r = 1; r <= 8; r++) for (let a = 0; a < 16; a++) {
    const ang = -Math.PI / 2 + (a / 16) * Math.PI * 2;
    tries.push([Math.cos(ang) * r * 20 * ls * 1.6, Math.sin(ang) * r * 20 * ls]);
  }
  let best = null;
  for (const [ox, oy] of tries) {
    const r = { x0: x + ox - w / 2, x1: x + ox + w / 2, y0: y + oy - h, y1: y + oy };
    let over = 0;
    for (const q of rects) over += Math.max(0, Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0)) * Math.max(0, Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0));
    // above the arrival reads best; below it covers the floor the mover stands on
    const score = over * 4 + Math.hypot(ox, oy) * 3 * ls + Math.max(0, oy) * 4;
    if (!best || score < best.score) best = { score, o: [ox, oy] };
  }
  return best.o;
}

function chipSvg(text) {
  const w = Math.ceil(measure(text, 12.5, 700, true) + 16);
  return `<rect x="${f1(-w / 2)}" y="-11.5" width="${w}" height="23" rx="5"/><text x="0" y="4.5" text-anchor="middle">${esc(text)}</text>`;
}

function signSvg(s, ls) {
  const no = s.alt ? "もし" : String(s.no);
  const verb = s.verb || KIND_JA[s.kind] || "";
  const mono = /^[\x00-\x7F]+$/.test(verb);
  const wNo = s.alt ? measure(no, 13, 800) + 16 : 25;
  const wV = measure(verb, 14, 700, mono);
  const dl = s.data?.label;
  const wD = dl ? measure(dl, 13, 700, true) + 30 : 0;
  const w = Math.ceil(wNo + wV + 24 + (dl ? wD + 8 : 0));
  const h = 31;
  let g = `<g class="ssign k-${s.kind}${s.alt ? " alt" : ""}" data-w="${w}" data-h="${h + 8}" transform="scale(${ls.toFixed(4)})"><g class="sbody" transform="translate(${f1(-w / 2)},${-h - 8})">`;
  g += `<rect class="b" width="${w}" height="${h}" rx="${h / 2}"/>`;
  g += s.alt
    ? `<rect class="n" x="4" y="4" width="${f1(wNo)}" height="${h - 8}" rx="${(h - 8) / 2}"/><text class="nt" x="${f1(4 + wNo / 2)}" y="20" text-anchor="middle">${esc(no)}</text>`
    : `<circle class="n" cx="16.5" cy="15.5" r="11.5"/><text class="nt" x="16.5" y="20.2" text-anchor="middle">${esc(no)}</text>`;
  g += `<text class="v${mono ? " mono" : ""}" x="${f1(wNo + 12)}" y="20.5">${esc(verb)}</text>`;
  if (dl) {
    const x = wNo + wV + 22;
    g += `<g transform="translate(${f1(x)},5)"><rect class="d" width="${f1(wD)}" height="${h - 10}" rx="5"/>` +
      `<rect class="dbox${isAddr(s.data) ? " addr" : ""}" x="6" y="5.5" width="10" height="10" rx="2"/>` +
      `<text class="dt" x="21" y="15">${esc(dl)}</text></g>`;
  }
  g += `<path class="pin" d="M${f1(w / 2 - 6)},${h} L${f1(w / 2)},${h + 7} L${f1(w / 2 + 6)},${h} Z"/>`;
  return g + `</g></g>`;
}

/** Hovering a step's number shows that step's sign over it (number, verb, what is handed over). */
export function peekStep(i) {
  const el = $("ov-peek");
  if (!el) return;
  const s = tour.sh?.steps[i], q = markAt[i];
  if (!s || !q || i === tour.idx) { el.innerHTML = ""; return; }
  const ls = view.ls || 1;
  el.innerHTML = `<g class="peek" transform="translate(${f1(q[0])},${f1(q[1] - 13 * ls)})">${signSvg(s, ls)}</g>`;
}

/** A ring spreading on the floor around the machine that was reached. */
function ping(key, on) {
  const m = tour.g.machine(key);
  const lines = $("ov-lines");
  if (!m || !on || !lines) return;
  const [x, y] = P(m.cx, m.cy, m.z);
  const el = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  el.setAttribute("class", "ping");
  el.setAttribute("cx", f1(x)); el.setAttribute("cy", f1(y));
  el.setAttribute("rx", f1(30 * RX)); el.setAttribute("ry", f1(30 * RY));
  lines.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function mark(key, cls) {
  if (!key) return;
  document.querySelectorAll(`.mach[data-key="${CSS.escape(key)}"], .lbl[data-key="${CSS.escape(key)}"]`).forEach((e) => e.classList.add(cls));
}

/* ------------------------------------------------------------ playback */

export function stop() {
  cancelAnimationFrame(tour.anim?.raf);
  tour.anim = null;
}
