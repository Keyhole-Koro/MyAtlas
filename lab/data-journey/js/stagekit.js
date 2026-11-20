import { h, svg } from "./util.js";

// Pieces of a packet stage. Coordinates are the stage's own (before scaling).

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function band(stage, cls, y, hgt, name, sub) {
  const b = h("div", { class: "band " + cls }, h("div", { class: "bname" }, name, sub ? h("small", {}, sub) : null));
  b.style.top = y + "px"; b.style.height = hgt + "px";
  b.dataset.y = y; b.dataset.h = hgt;
  b.dataset.name = name; b.dataset.sub = sub || "";
  stage.appendChild(b);
  return b;
}

export function wall(stage, y, text, short) {
  const w = h("div", { class: "wall" }, h("span", { class: "full" }, text), h("span", { class: "short" }, short || "境界"));
  w.style.top = y + "px";
  w.dataset.y = y;
  stage.appendChild(w);
  return w;
}

export function place(stage, id, x, y, w, hh, name) {
  const p = h("div", { class: "place", "data-place": id }, h("div", { class: "pname", html: name }));
  Object.assign(p.style, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px" });
  p.dataset.box = JSON.stringify([x, y, w, hh]);
  stage.appendChild(p);
  return p;
}

export function actor(stage, el, x, y) {
  el.classList.add("actor");
  Object.assign(el.style, { left: x + "px", top: y + "px" });
  stage.appendChild(el);
  return el;
}

// Every actor goes inside the place that holds it (its position becomes relative to
// the place), so a place can be moved with what is in it: a phone lays the places of
// one step out as a column.
export function nest(stage) {
  const places = [...stage.querySelectorAll(":scope > .place")].map((p) => { const [x, y, w, hh] = JSON.parse(p.dataset.box); return { p, x, y, w, h: hh }; });
  for (const a of [...stage.querySelectorAll(":scope > .actor")]) {
    if (a.dataset.free) continue;
    const ax = parseFloat(a.style.left), ay = parseFloat(a.style.top);
    const host = a.dataset.host
      ? places.find((q) => q.p.dataset.place === a.dataset.host)
      : places.find((q) => ax >= q.x - 2 && ax < q.x + q.w && ay >= q.y - 2 && ay < q.y + q.h + 8);
    if (!host) continue;
    a.style.left = (ax - host.x) + "px"; a.style.top = (ay - host.y) + "px";
    a.dataset.wide = JSON.stringify([ax - host.x, ay - host.y, a.style.width || ""]);
    host.p.appendChild(a);
  }
}

// A struct drawn as a card: a header and one row per field.
export function card(title, sub, rows, w) {
  const el = h("div", { class: "card-r" }, h("div", { class: "ch" }, h("span", { class: "ct" }, title), h("small", {}, sub || "")));
  el.style.width = w + "px";
  const R = {};
  for (const [id, name] of rows) {
    const r = h("div", { class: "frow", "data-row": id }, h("span", { class: "fn" }, name), h("span", { class: "fv" }, ""));
    el.appendChild(r);
    R[id] = r;
  }
  return { el, R, head: el.querySelector(".ct"), sub: el.querySelector(".ch small") };
}

export function setCard(cd, st) {
  if (!st) return;
  if (st.title !== undefined) cd.head.textContent = st.title;
  if (st.sub !== undefined) cd.sub.textContent = st.sub;
  for (const [id, r] of Object.entries(cd.R)) {
    const v = (st.rows || {})[id] || {};
    const fv = r.querySelector(".fv");
    const html = v.v === undefined ? "" : String(v.v);
    if (fv.innerHTML !== html) fv.innerHTML = html;
    fv.classList.toggle("zero", !!v.zero);
    r.className = "frow" + (v.cls ? " " + v.cls : "");
  }
}

export function token(text, cls) {
  return h("div", { class: "tok " + (cls || "") }, text);
}

// absolute position of an element inside the stage (offsets ignore the stage's scale)
export function posIn(stage, el) {
  let x = 0, y = 0, e = el;
  while (e && e !== stage) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

const shown = (el) => !!(el && el.isConnected && el.offsetParent !== null);

// Flights in progress, so a new step can stop them and show what they were hiding.
const flights = new Set();
export function stopFlights() {
  for (const f of [...flights]) f.done(true);
}

// A copy of `fromEl` flies to where `toEl` is, then goes away. `hide`: elements that
// stay hidden until the copy lands (the value appears when it arrives, not before).
export function fly(stage, fromEl, toEl, opts = {}) {
  if (!shown(fromEl) || !shown(toEl) || reducedMotion()) return null;
  const a = posIn(stage, fromEl), b = posIn(stage, toEl);
  const ghost = opts.ghost ? opts.ghost() : fromEl.cloneNode(true);
  ghost.classList.add("ghost");
  const gw = opts.ghost ? null : a.w, gh = opts.ghost ? null : a.h;
  Object.assign(ghost.style, { position: "absolute", left: a.x + "px", top: a.y + "px", margin: 0, zIndex: 30, pointerEvents: "none", transition: "none" });
  if (gw) { ghost.style.width = gw + "px"; ghost.style.height = gh + "px"; }
  stage.appendChild(ghost);
  const sw = ghost.offsetWidth || a.w, shh = ghost.offsetHeight || a.h;
  const dx = b.x + (b.w - sw) / 2 - a.x, dy = b.y + (b.h - shh) / 2 - a.y;
  const sc = opts.shrink ? Math.min(1, b.w / sw, b.h / shh) : 1;
  const dur = (opts.dur || 800) * (opts.speed || 1);
  const delay = (opts.delay || 0) * (opts.speed || 1);
  const hide = [].concat(opts.hide || []).filter(Boolean);
  for (const el of hide) el.style.visibility = "hidden";
  const anim = ghost.animate([
    { transform: "translate(0,0) scale(1)", opacity: opts.fadeIn ? 0 : 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - (opts.arc || 0)}px) scale(${(1 + sc) / 2})`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: opts.keep ? 1 : 0.2 },
  ], { duration: dur, delay, easing: "cubic-bezier(.4,.1,.2,1)", fill: "both" });
  const f = {
    done(cancel) {
      if (!flights.has(f)) return;
      flights.delete(f);
      if (cancel) anim.cancel();
      ghost.remove();
      for (const el of hide) el.style.visibility = "";
      if (!cancel) for (const el of hide) pulseQuiet(el);
    },
  };
  flights.add(f);
  anim.onfinish = () => f.done(false);
  return anim;
}

function pulseQuiet(el) {
  if (!el || reducedMotion()) return;
  el.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 700 });
}

export function pulse(el, speed = 1) {
  if (!el || reducedMotion()) return;
  el.animate([{ boxShadow: "0 0 0 0 var(--accent)" }, { boxShadow: "0 0 0 10px transparent" }], { duration: 900 * speed, iterations: 2 });
}

// SVG overlay for arrows that point from a field to what it names
export function overlay(stage, W, H) {
  const s = svg("svg", { class: "svgover", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const defs = svg("defs", {}, s);
  for (const [id, color] of [["a-app", "var(--l-app)"], ["a-os", "var(--drift)"], ["a-red", "var(--red)"], ["a-ink", "var(--text-2)"]]) {
    const m = svg("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    svg("path", { d: "M0,0 L10,5 L0,10 z", fill: color }, m);
  }
  stage.appendChild(s);
  return s;
}

export function drawArrows(stage, ov, arrows) {
  ov.querySelectorAll(".ptr, .ptr-t").forEach((p) => p.remove());
  for (const a of arrows || []) {
    if (!shown(a.from) || !shown(a.to)) continue;
    if (a.from.closest(".actor") && a.from.closest(".actor").style.opacity === "0") continue;
    const p = posIn(stage, a.from), q = posIn(stage, a.to);
    let x1, y1, x2, y2;
    let side = a.side || "right";
    let tside = a.tside || "left";
    // stacked (a phone): the target is below or above, not beside
    if (Math.abs(q.x - p.x) < 120 && Math.abs(q.y - p.y) > 60) { side = "right"; tside = "right"; }
    if (side === "right") { x1 = p.x + p.w - 4; y1 = p.y + p.h / 2; }
    else if (side === "top") { x1 = p.x + p.w / 2; y1 = p.y + 4; }
    else { x1 = p.x + 4; y1 = p.y + p.h / 2; }
    if (tside === "left") { x2 = q.x - 3; y2 = q.y + q.h / 2; }
    else if (tside === "bottom") { x2 = q.x + q.w / 2; y2 = q.y + q.h + 3; }
    else if (tside === "top") { x2 = q.x + q.w / 2; y2 = q.y - 3; }
    else { x2 = q.x + q.w + 3; y2 = q.y + q.h / 2; }
    const mx = (x1 + x2) / 2;
    let d;
    if (side === "right" && tside === "right") {
      const bx = Math.max(x1, x2) + 26;
      d = `M${x1},${y1} C${bx},${y1} ${bx},${y2} ${x2},${y2}`;
    } else d = a.curve === "v"
      ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
      : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    const path = svg("path", { d, class: "ptr " + (a.cls || ""), "marker-end": `url(#a-${a.cls || "ink"})` }, ov);
    if (a.label) {
      const lx = side === "right" && tside === "right" ? Math.max(x1, x2) + 14 : mx + 4;
      svg("text", { x: lx, y: (y1 + y2) / 2 - 4, class: "ptr-t", "font-size": 11, fill: "var(--text-2)", text: a.label }, ov);
    }
    path.style.opacity = a.dim ? 0.35 : 1;
  }
}

export function bubble(stage) {
  const b = h("div", { class: "bubble" });
  b.style.opacity = 0;
  stage.appendChild(b);
  return b;
}

export function setBubble(b, st) {
  if (!st) { b.style.opacity = 0; b.style.pointerEvents = "none"; return; }
  b.className = "bubble " + (st.cls || "");
  b.innerHTML = st.html;
  Object.assign(b.style, { left: st.x + "px", top: st.y + "px", width: (st.w || 300) + "px", maxWidth: (st.w || 300) + "px", opacity: 1, pointerEvents: "auto" });
}
