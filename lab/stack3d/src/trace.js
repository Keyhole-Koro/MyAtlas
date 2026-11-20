// The recorded run (a trace) on the same stack: a block for every node the run entered, laid out
// on its layer's plate from left to right in the order the run first entered it. Playback hops a
// light from block to block in the recorded order; a timeline below shows real time (instructions)
// with one lane per thread. Events without a node are listed but not placed.
import * as D from "./data.js";
import { DIM } from "./layout.js";
import { esc } from "./panel.js";

export const THREAD_COLORS = {
  light: { "3": "#2f5bd3", "0": "#7c3aed", "2": "#64748b", "-1": "#a3a3a3" },
  dark: { "3": "#7c9dff", "0": "#a78bfa", "2": "#94a3b8", "-1": "#737373" },
};
export function threadColor(tid, dark) {
  const t = THREAD_COLORS[dark ? "dark" : "light"];
  return t[String(tid)] || (dark ? "#d4d4d4" : "#525252");
}

export function prepTrace(trace) {
  const events = trace.events.map((e, k) => ({ ...e, k }));
  const end = events[events.length - 1].instr;
  // who runs when: a switch event names the thread that runs from then on
  const segs = [];
  let cur = events[0].thread, from = 0;
  for (const e of events) if (e.ev === "switch") { segs.push({ tid: cur, a: from, b: e.instr }); cur = e.thread; from = e.instr; }
  segs.push({ tid: cur, a: from, b: end });
  const lanes = Object.keys(trace.threads).map(String).sort((a, b) => laneOrder(a) - laneOrder(b));
  return { trace, events, end, segs, lanes };
}
function laneOrder(tid) {
  return { "3": 0, "0": 1, "2": 2, "-1": 3 }[tid] ?? 9;
}

export function traceScene(T) {
  const mapped = T.events.filter((e) => e.ev === "enter" && e.n && D.NODES[e.n]);
  const order = [...new Set(mapped.map((e) => e.n))];
  const fnOf = {}, total = {};
  for (const e of mapped) { fnOf[e.n] ||= e.fn; total[e.n] = (total[e.n] || 0) + 1; }
  const bands = D.LAYERS.map((l) => ({ id: l.id, name: l.name, sub: l.sub, tone: l.id }));
  // labels: the function's own name first, its namespace under it (both from the map or the run)
  const split = (name) => { const k = name.lastIndexOf("."); return k > 0 ? [name.slice(k + 1), name.slice(0, k)] : [name, ""]; };
  const boxes = order.map((n) => {
    const title = D.NODES[n].title;
    const [short, ns] = title.includes(".") ? split(title) : [title, fnOf[n] || ""];
    return { id: n, node: n, title, short, ns, band: D.NODES[n].layer, sub: fnOf[n] && fnOf[n] !== title ? fnOf[n] : "", total: total[n] };
  });
  return {
    type: "trace", id: T.trace.id, title: T.trace.title, tab: "記録", bands, boxes,
    box: Object.fromEntries(boxes.map((b) => [b.id, b])), steps: [], regions: [], start: [0, null],
  };
}

// Columns by first entry; a crowded plate puts its blocks in two staggered rows. A block is as tall
// as the run entered it often (square root of its share), so a still picture shows where the calls
// went: the scheduler's blocks stand out, a function entered twice stays low.
export function layoutTrace(scene) {
  const { COL, GAP, GAP_EMPTY, PLATE_T, MARGIN_X, W, H, D: BD } = DIM;
  const n = scene.bands.length;
  const empty = scene.bands.map((b) => !scene.boxes.some((x) => x.band === b.id));
  const ys = [0];
  for (let i = 1; i < n; i++) ys.push(ys[i - 1] - (empty[i] || empty[i - 1] ? GAP_EMPTY : GAP));
  const shift = (ys[0] + ys[n - 1]) / 2;
  const bands = scene.bands.map((b, i) => ({ ...b, i, y: ys[i] - shift, empty: empty[i] }));
  const boxes = {};
  const most = Math.max(...scene.boxes.map((b) => b.total || 1));
  let xmin = 0, xmax = 0, zmin = -BD / 2, zmax = BD / 2;
  for (const band of bands) {
    const list = scene.boxes.filter((b) => b.band === band.id);
    const m = list.length;
    const zig = m > 5;
    const sp = zig ? COL * 0.64 : COL;
    list.forEach((b, j) => {
      const x = (j - (m - 1) / 2) * sp, z = zig ? (j % 2 ? 1.55 : -1.55) : 0;
      const h = H * (0.55 + 0.95 * Math.sqrt((b.total || 1) / most));
      boxes[b.id] = { id: b.id, band: band.id, bi: band.i, col: j, x, y: band.y, z, w: W, h, d: BD, row: zig ? (j % 2 ? "front" : "back") : "" };
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); zmin = Math.min(zmin, z - BD / 2); zmax = Math.max(zmax, z + BD / 2);
    });
  }
  const plate = { x0: xmin - W / 2 - MARGIN_X, x1: xmax + W / 2 + MARGIN_X, z0: zmin - 1.0, z1: zmax + 1.4, t: PLATE_T };
  const plates = Object.fromEntries(bands.map((b) => [b.id, plate]));
  const bounds = { x0: plate.x0, x1: plate.x1, y0: bands[n - 1].y - PLATE_T, y1: bands[0].y + H * 1.5 + 1.2, z0: plate.z0, z1: plate.z1 };
  return { bands, boxes, plate, plates, tubes: [], regions: [], reserved: new Set(), bounds };
}

const fmt = (n) => n.toLocaleString("en-US");
export function describe(e, threads) {
  const who = D.threadName(threads[String(e.thread)]);
  if (e.ev === "enter") return { kind: "関数に入る", main: e.fn, node: e.n || null, who };
  if (e.ev === "irq") return { kind: "割り込み", main: `${(e.cause || []).join("・")}${e.service ? `（OS_CALL ${e.service}）` : ""}`, node: null, who };
  if (e.ev === "switch") return { kind: "切り替え", main: `${who} が走り始める`, node: null, who };
  if (e.ev === "request") return { kind: "自動操作の要求", main: e.method, node: null, who };
  return { kind: e.ev, main: e.fn || "", node: e.n || null, who };
}

// ---------- the timeline under the 3D view ----------
export class Timeline {
  constructor(host, T, { onSeek, dark }) {
    this.host = host; this.T = T; this.onSeek = onSeek; this.dark = dark;
    this.i = 0;
    host.innerHTML = `<canvas class="tl"></canvas>`;
    this.cv = host.querySelector("canvas");
    this.cv.addEventListener("pointerdown", (e) => { this.drag = true; this.cv.setPointerCapture(e.pointerId); this.seek(e); });
    this.cv.addEventListener("pointermove", (e) => { if (this.drag) this.seek(e); else this.hover(e); });
    this.cv.addEventListener("pointerup", () => { this.drag = false; });
    this.cv.addEventListener("pointerleave", () => { this.hoverX = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(host);
  }
  geom() {
    const w = this.host.clientWidth, laneH = 15, top = 8, left = w < 520 ? 92 : 132;
    const h = top + this.T.lanes.length * (laneH + 4) + 22;
    return { w, h, laneH, top, left, right: w - 14 };
  }
  xOf(instr, g) { return g.left + ((g.right - g.left) * instr) / this.T.end; }
  seek(e) {
    const g = this.geom(), r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const instr = Math.max(0, Math.min(this.T.end, ((x - g.left) / (g.right - g.left)) * this.T.end));
    // the last event at or before that time
    let k = 0;
    for (const ev of this.T.events) { if (ev.instr <= instr) k = ev.k; else break; }
    this.onSeek(k);
  }
  hover(e) {
    const r = this.cv.getBoundingClientRect();
    this.hoverX = e.clientX - r.left;
    this.draw();
  }
  set(i) { this.i = i; this.draw(); }
  draw() {
    const g = this.geom(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = this.cv;
    cv.style.width = g.w + "px"; cv.style.height = g.h + "px";
    cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr);
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const text2 = css.getPropertyValue("--text-2").trim(), text3 = css.getPropertyValue("--text-3").trim(), border = css.getPropertyValue("--border").trim(), surface2 = css.getPropertyValue("--surface-2").trim(), accent = css.getPropertyValue("--accent").trim();
    c.font = `11.5px ${css.getPropertyValue("--font-sans")}`;
    c.textBaseline = "middle";
    const T = this.T, cur = T.events[this.i];
    T.lanes.forEach((tid, li) => {
      const y = g.top + li * (g.laneH + 4);
      c.fillStyle = text2;
      c.textAlign = "right";
      c.fillText(laneName(T.trace.threads[tid], g.w < 520), g.left - 10, y + g.laneH / 2);
      c.fillStyle = surface2;
      c.fillRect(g.left, y, g.right - g.left, g.laneH);
      for (const s of T.segs) if (String(s.tid) === tid) {
        c.fillStyle = threadColor(tid, this.dark);
        c.globalAlpha = s.a <= cur.instr ? 0.95 : 0.35;
        const x0 = this.xOf(s.a, g), x1 = this.xOf(Math.min(s.b, cur.instr < s.a ? s.b : s.b), g);
        c.fillRect(x0, y + 2, Math.max(1.5, x1 - x0), g.laneH - 4);
        c.globalAlpha = 1;
      }
    });
    // ticks: functions on the map (layer colour) under the lanes
    const ty = g.top + T.lanes.length * (g.laneH + 4);
    for (const e of T.events) {
      if (e.ev !== "enter" || !e.n) continue;
      const layer = D.NODES[e.n]?.layer;
      c.fillStyle = css.getPropertyValue(`--l-${layer}`).trim() || text3;
      c.globalAlpha = e.k <= this.i ? 1 : 0.35;
      c.fillRect(this.xOf(e.instr, g) - 0.75, ty, 1.5, 7);
    }
    c.globalAlpha = 1;
    // interrupts and automation requests on top
    for (const e of T.events) {
      const x = this.xOf(e.instr, g);
      if (e.ev === "irq") { c.fillStyle = text3; c.beginPath(); c.moveTo(x - 3, 1); c.lineTo(x + 3, 1); c.lineTo(x, 6); c.fill(); }
      if (e.ev === "request") { c.fillStyle = accent; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 4, 4); c.lineTo(x, 8); c.lineTo(x - 4, 4); c.fill(); }
    }
    // axis
    c.fillStyle = text3;
    c.textAlign = "left";
    c.fillText("0", g.left, ty + 15);
    const zeroEnd = g.left + c.measureText("0").width + 10;
    c.textAlign = "right";
    const endLabel = g.w < 520 ? fmt(T.end) : `${fmt(T.end)} 命令`;
    if (g.right - c.measureText(endLabel).width > zeroEnd) c.fillText(endLabel, g.right, ty + 15);
    const endX = g.right - c.measureText(endLabel).width - 12;
    c.textAlign = "center";
    for (const v of [250000, 500000, 750000, 1000000]) {
      const x = this.xOf(v, g), half = c.measureText(fmt(v)).width / 2;
      if (x + half < endX && x - half > zeroEnd) c.fillText(fmt(v), x, ty + 15);
    }
    // playhead
    const px = this.xOf(cur.instr, g);
    c.strokeStyle = accent; c.lineWidth = 2;
    c.beginPath(); c.moveTo(px, 0); c.lineTo(px, ty + 8); c.stroke();
    c.fillStyle = accent;
    c.beginPath(); c.arc(px, ty + 8, 4, 0, Math.PI * 2); c.fill();
    if (this.hoverX != null && this.hoverX > g.left) {
      c.strokeStyle = border; c.lineWidth = 1;
      c.beginPath(); c.moveTo(this.hoverX, 0); c.lineTo(this.hoverX, ty + 8); c.stroke();
    }
  }
}
function laneName(label, short) {
  if (!label) return "";
  if (label.startsWith("kernel:")) { const n = label.slice(7).trim(); return short ? n.replace(/\.run$/, "") : n; }
  if (/idle/.test(label)) return short ? "idle" : "idle（走るもの無し）";
  return label;
}

// ---------- the panel for the run ----------
export function tracePanel(T, i, counts) {
  const tr = T.trace, e = T.events[i];
  const d = describe(e, tr.threads);
  const run = tr.run || {};
  let h = `<section class="step"><div class="st-head"><span class="st-no">記録</span><span class="st-of">${esc(fmt(T.events.length))} 件のうち ${i + 1} 件目</span><span class="st-nav"><button data-act="tprev" ${i ? "" : "disabled"} aria-label="前の出来事">←</button><button data-act="tnext" ${i < T.events.length - 1 ? "" : "disabled"} aria-label="次の出来事">→</button></span></div>`;
  h += `<div class="st-verb">${esc(d.kind)}</div>`;
  h += `<div class="kindchip"><span class="tdot" style="background:${threadColor(e.thread, document.documentElement.dataset.dark === "1")}"></span>${esc(d.who)}</div>`;
  h += `<div class="st-label"><span class="mono">${esc(d.main)}</span></div>`;
  h += `<div class="row"><span class="k">時刻</span><span class="v">${esc(fmt(e.instr))} 命令目<span class="note">（seq ${esc(e.seq)}）</span></span></div>`;
  if (e.program) h += `<div class="row"><span class="k">プログラム</span><span class="v mono">${esc(e.program)}</span></div>`;
  if (d.node) {
    const n = D.NODES[d.node];
    h += `<div class="row"><span class="k">地図では</span><span class="v"><button class="nodelink" data-node="${esc(d.node)}">${esc(n.title)}</button>　<span class="note">この記録で ${counts[d.node] || 0} 回目／全 ${T.events.filter((x) => x.n === d.node).length} 回</span></span></div>`;
    const where = [];
    for (const sc of [...D.FLOWS, ...Object.values(D.PAPER_SCENES)]) {
      const bx = sc.boxes.find((b) => b.node === d.node);
      if (!bx) continue;
      const steps = sc.steps.filter((s) => s.from === bx.id || s.to === bx.id);
      where.push(`<button class="btn" data-goto="${esc(sc.id)}" data-gotobox="${esc(bx.id)}">${esc(sc.type === "flow" ? sc.tab : sc.tab + " の中")}${steps.length ? `・手順 ${steps.filter((s) => !s.alt).map((s) => s.num).join("・")}` : ""}</button>`);
    }
    if (where.length) h += `<div class="row"><span class="k">出てくる紙</span><span class="v uses">${where.join("")}</span></div>`;
  } else if (e.ev === "enter") h += `<div class="note">この関数は地図に載っていません。3D では光は動かず、前にいた積み木に残ります。</div>`;
  h += `</section>`;
  // nearby events
  const from = Math.max(0, i - 5), to = Math.min(T.events.length, from + 14);
  h += `<section><h3>前後の出来事</h3><ol class="steps tl-list">`;
  for (let k = from; k < to; k++) {
    const ev = T.events[k], dd = describe(ev, tr.threads);
    const title = ev.n ? D.NODES[ev.n]?.title || ev.n : "";
    h += `<li class="${k === i ? "on" : k < i ? "past" : ""}"><button data-tev="${k}"><span class="n" style="border-color:${threadColor(ev.thread, document.documentElement.dataset.dark === "1")}">${esc(k + 1)}</span><span class="tx"><b>${esc(dd.kind)}</b><span class="ft2" title="${esc(dd.main)}">${esc(dd.main)}${title && title !== dd.main ? `　→ ${esc(title)}` : ""}</span></span></button></li>`;
  }
  h += `</ol></section>`;
  // what the run was
  h += `<section><h3>この記録</h3><div class="prose" style="margin:0 0 8px"><b>${esc(tr.title)}</b></div>`;
  h += `<div class="row"><span class="k">日時</span><span class="v">${esc((tr.date || "").replace("T", " ").replace(/\+.*/, ""))}</span></div>`;
  if (run.typed) h += `<div class="row"><span class="k">打った字</span><span class="v mono">「${esc(run.typed)}」</span></div>`;
  if (run.before && run.after) {
    h += `<table class="tbl"><tr><td class="d"></td><td class="d">前</td><td class="d">後</td></tr>`;
    for (const [k, label] of [["text", "本文"], ["title", "題名"], ["position", "位置"]]) if (k in run.before) h += `<tr><td class="d">${label}</td><td class="m">${esc(run.before[k] || "（空）")}</td><td class="m">${esc(run.after[k] || "（空）")}</td></tr>`;
    h += `</table>`;
  }
  h += `<div class="row"><span class="k">スレッド</span><span class="v">${Object.entries(tr.threads).map(([tid, nm]) => `<div><span class="tdot" style="background:${threadColor(tid, document.documentElement.dataset.dark === "1")}"></span>${esc(D.threadName(nm))}</div>`).join("")}</span></div>`;
  if (tr.build) h += `<div class="row"><span class="k">ビルド</span><span class="v codeline">${Object.entries(tr.build).map(([k, v]) => `${esc(k)} ${esc(v)}`).join("<br>")}</span></div>`;
  h += `<div class="note">左から、記録で初めて入った順に並べています。積み木の高さは、この記録で入った回数です（多いほど高い）。地図に載っていない関数（${T.events.filter((x) => x.ev === "enter" && !x.n).length} 件）は一覧だけに出ます。</div></section>`;
  return h;
}

export function traceCaption(T, i) {
  const e = T.events[i], d = describe(e, T.trace.threads);
  return { no: `${i + 1} / ${T.events.length}`, kind: d.kind, main: d.main, who: d.who, instr: `${fmt(e.instr)} 命令目`, node: d.node };
}
