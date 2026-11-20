// 記録を見る: the recorded run of typing "x" in the Editor, replayed on the building.
// Every thread is a figure; a machine lights up when the trace enters it; interrupts flash at
// the dispatcher; a timeline at the bottom shows who ran when (instructions on the x axis).
import { A, node, containerOf } from "./model.js";
import { P, f1, esc } from "./iso.js";
import { mount, view, fit, frame, lookAt, narrow, FOLLOW_K_NARROW } from "./scene.js";
import { DIM, CORRIDOR } from "./building.js";
import { measure } from "./labels.js";
import { panel } from "./panel.js";
import { showFloorChip } from "./tour.js";

const T = A.traces[0];
const EV = T ? T.events : [];
const MAX = EV.length ? EV[EV.length - 1].instr : 1;
const $ = (id) => document.getElementById(id);
const st = { on: false, i: 0, playing: false, speed: 1, timer: null, g: null, opts: null, last: {}, log: [] };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function traceActive() { return st.on; }
export function tracePanel() { if (st.on) renderPanel(); }

/** Threads of the record, with the colour of who they are. */
function threadInfo(tid) {
  const name = T.threads[String(tid)] || String(tid);
  if (tid === -1) return { tid, name, short: "idle", key: "idle" };
  if (/^kernel:/.test(name)) return { tid, name, short: name.replace(/^kernel:\s*/, ""), key: "svc", kernel: true };
  return { tid, name, short: name, key: "app" };
}
const THREADS = Object.keys(T?.threads || {}).map(Number).sort((a, b) => (a === 3 ? -1 : b === 3 ? 1 : a - b)).map(threadInfo);

/** The papers a node sits in, outward: kernel.ipc-send → os.submit → os.gateway. */
function chain(nid) {
  const out = [];
  let cur = nid;
  for (let k = 0; k < 4; k++) {
    const p = containerOf(cur);
    if (!p) break;
    const owner = Object.keys(A.nodes).find((x) => A.nodes[x].paper === p);
    if (!owner) break;
    out.push(owner);
    cur = owner;
  }
  return out;
}

/** The machine of the building where an event happens, if any. */
function machineFor(e) {
  if (!e.n) return null;
  const g = st.g;
  const direct = g.machineOfNode(e.n);
  if (direct) return { m: direct, via: null };
  // a node inside a paper counts for the machine that holds the paper, when this thread is in it
  const ch = chain(e.n);
  const last = st.last[e.thread];
  const hit = ch.find((x) => last && last.node === x) || (ch.length && !["kernel.ipc-send", "kernel.notify-armed"].includes(e.n) ? ch.find((x) => g.machineOfNode(x)) : null);
  if (hit && g.machineOfNode(hit)) return { m: g.machineOfNode(hit), via: e.n };
  return null;
}

export function openTrace(g, opts, at = 0) {
  if (!T) return;
  st.on = true;
  st.g = g;
  st.opts = opts;
  st.i = 0;
  st.last = {};
  st.log = [];
  // the machines this record passes through are the ones shown
  const seen = new Set();
  for (const e of EV) {
    if (!e.n) continue;
    if (g.machineOfNode(e.n)) seen.add(e.n);
    for (const x of chain(e.n)) if (g.machineOfNode(x)) seen.add(x);
  }
  const pseudo = { id: "trace", boxes: [...seen].map((n) => ({ node: n })), regions: [] };
  document.body.classList.add("tracing");
  buildDock();
  mount(g, pseudo);
  buildActors();
  renderPanel();
  seek(at, false);
  setTimeout(() => frameTrace(), 0);
}
/** Draws the record again (after a resize), at the same event. */
export function traceRemount() {
  if (!st.on) return;
  const wasPlaying = st.playing;
  pause();
  openTrace(st.g, st.opts, st.i);
  if (wasPlaying) play();
}

export function closeTrace(silent) {
  if (!st.on) return;
  st.on = false;
  st.playing = false;
  clearTimeout(st.timer);
  document.body.classList.remove("tracing");
  showFloorChip(null);
  $("dock").innerHTML = "";
  $("dock").hidden = true;
  if (!silent && st.opts?.onClose) st.opts.onClose();
}

/** Nothing in the record happens in the basement, so the camera leaves it under the dock. On a
 *  narrow screen the camera follows the machine the record is in. */
function frameTrace() {
  const g = st.g, b = view.bbox;
  if (narrow()) return followLit(false);
  const emu = g.floor("emu");
  if (!emu || !b) return fit(false);
  const kern = g.floor("kernel");
  const [, yk] = P(DIM.D + kern.R * DIM.P, DIM.D, kern.z - DIM.T);
  frame({ x0: b.x0, x1: b.x1, y0: b.y0, y1: Math.max(yk, b.y0 + 10) + 10 }, false, 20);
}
export function traceRefit() { if (st.on) frameTrace(); }
function followLit(animate = true, e = EV[st.i]) {
  const m = st.last[e?.thread] || Object.values(st.last)[0] || st.g.machineOfNode("kernel.irq-dispatch");
  if (!m) return fit(false);
  // the floor names are off screen while the camera is close: a chip names the floor
  showFloorChip(st.g.floor(m.floor));
  const [x, y] = m.top;
  lookAt(x, y - 10, FOLLOW_K_NARROW, animate, 420);
}

/* --------------------------------------------------------------- actors */
function buildActors() {
  const actors = $("ov-actors");
  actors.innerHTML = "";
  for (const t of THREADS) {
    if (t.tid === -1) continue;
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("class", `fig th-${t.key} tfig`);
    el.dataset.tid = t.tid;
    const w = Math.ceil(measure(t.short, 12, 700) + 16), ls = view.ls || 1;
    el.innerHTML = `<ellipse class="f-sh" cx="0" cy="0" rx="10" ry="5"/><g class="f-man"><path class="f-body" d="M-8,-3 C-8.5,-19 -6,-25 0,-25 C6,-25 8.5,-19 8,-3 Z"/><circle class="f-head" cx="0" cy="-32" r="6.2"/></g>` +
      `<g class="ftag" transform="translate(0,-44) scale(${ls.toFixed(4)})"><rect x="${-w / 2}" y="-20" width="${w}" height="20" rx="10"/><text x="0" y="-5.5" text-anchor="middle">${esc(t.short)}</text></g>`;
    el.style.display = "none";
    actors.appendChild(el);
  }
  const fl = document.createElementNS("http://www.w3.org/2000/svg", "g");
  fl.setAttribute("class", "irqflash");
  fl.style.display = "none";
  actors.appendChild(fl);
}

function userDoor() {
  const fl = st.g.floor(st.g.elevator?.boundary?.[0]?.id || "lib");
  return { key: "user-door", floor: fl?.id, port: [DIM.D + 16, DIM.D + 16, fl ? fl.z : 0], top: P(DIM.D + 16, DIM.D + 16, (fl ? fl.z : 0) + 30) };
}
function placeFigure(tid, m, offset = 0) {
  const el = document.querySelector(`.tfig[data-tid="${tid}"]`);
  if (!el || !m) return;
  if (m.key === "user-door") offset = 0;
  const [x, y] = P(m.port[0] + offset, m.port[1] + offset * 0.4, m.port[2]);
  el.style.display = "";
  el.style.transform = `translate(${f1(x)}px,${f1(y)}px)`;
}

/* ----------------------------------------------------------------- dock */
const LANE_H = 13, PADL = 132, PADR = 18;
function buildDock() {
  const d = $("dock");
  d.hidden = false;
  const lanes = THREADS.map((t, k) => `<div class="lane" style="top:${24 + k * (LANE_H + 5)}px"><span class="ln th-${t.key}">${esc(t.short)}</span></div>`).join("");
  d.innerHTML = `<div class="tl">
    <div class="tlhead"><button class="pb main" id="t-play">▶ 記録を流す</button><button class="pb" id="t-prev" aria-label="前の出来事">◀</button><button class="pb" id="t-next" aria-label="次の出来事">▶</button>
      <span class="sp">速さ <button class="spd on" data-sp="1">1×</button><button class="spd" data-sp="3">3×</button><button class="spd" data-sp="8">8×</button></span>
      <span class="now" id="t-now"></span><span class="axn">横は命令数（0〜${MAX.toLocaleString()}）</span><button class="pb" id="t-close">記録を閉じる</button></div>
    <div class="tlbody" id="t-body">${lanes}<svg id="t-svg" class="tsvg"></svg></div></div>`;
  drawTimeline();
  $("t-play").onclick = () => (st.playing ? pause() : play());
  $("t-prev").onclick = () => { pause(); seek(Math.max(0, st.i - 1)); };
  $("t-next").onclick = () => { pause(); seek(Math.min(EV.length - 1, st.i + 1)); };
  $("t-close").onclick = () => closeTrace();
  d.querySelectorAll(".spd").forEach((b) => (b.onclick = () => { st.speed = +b.dataset.sp; d.querySelectorAll(".spd").forEach((x) => x.classList.toggle("on", x === b)); }));
  $("t-svg").addEventListener("pointerdown", (ev) => {
    const r = $("t-svg").getBoundingClientRect();
    const x = ev.clientX - r.left;
    const instr = ((x - PADL) / (r.width - PADL - PADR)) * MAX;
    let best = 0;
    EV.forEach((e, k) => { if (Math.abs(e.instr - instr) < Math.abs(EV[best].instr - instr)) best = k; });
    pause();
    seek(best);
  });
  addEventListener("resize", drawTimeline);
}

function xOf(instr, W) { return PADL + (instr / MAX) * (W - PADL - PADR); }
function drawTimeline() {
  const svg = $("t-svg");
  if (!svg) return;
  const W = svg.clientWidth || 800, H = 24 + THREADS.length * (LANE_H + 5) + 2;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.height = H + "px";
  let s = "";
  // who ran when: consecutive events of one thread
  let start = 0;
  for (let k = 1; k <= EV.length; k++) {
    if (k === EV.length || EV[k].thread !== EV[start].thread) {
      const t = EV[start].thread, lane = THREADS.findIndex((x) => x.tid === t);
      const x0 = xOf(EV[start].instr, W), x1 = xOf(k < EV.length ? EV[k].instr : MAX, W);
      s += `<rect class="run th-${THREADS[lane].key}" x="${f1(x0)}" y="${24 + lane * (LANE_H + 5)}" width="${f1(Math.max(2, x1 - x0))}" height="${LANE_H}" rx="3"/>`;
      start = k;
    }
  }
  // interrupts on the top row
  for (const e of EV) {
    if (e.ev !== "irq") continue;
    const x = xOf(e.instr, W);
    const c = (e.cause || [])[0];
    s += `<line class="irq c-${c}" x1="${f1(x)}" x2="${f1(x)}" y1="5" y2="18"><title>${esc(c)}${e.service ? " " + e.service : ""}</title></line>`;
  }
  s += `<text class="ax lg" x="${PADL - 8}" y="16" text-anchor="end">割り込み</text>`;
  s += `<line id="t-head" class="head" x1="0" x2="0" y1="2" y2="${H}"/>`;
  svg.innerHTML = s;
  if (st.on) moveHead();
}
function moveHead() {
  const svg = $("t-svg"), h = $("t-head");
  if (!svg || !h) return;
  const W = svg.clientWidth || 800;
  const x = xOf(EV[st.i].instr, W);
  h.setAttribute("x1", f1(x)); h.setAttribute("x2", f1(x));
}

/* --------------------------------------------------------------- playing */
function play() {
  st.playing = true;
  if (st.i >= EV.length - 1) seek(0, false);
  $("t-play").textContent = "❚❚ 止める";
  tick();
}
function pause() {
  st.playing = false;
  clearTimeout(st.timer);
  if ($("t-play")) $("t-play").textContent = "▶ 記録を流す";
}
function tick() {
  if (!st.playing) return;
  if (st.i >= EV.length - 1) { pause(); return; }
  const a = EV[st.i], b = EV[st.i + 1];
  const dt = (110 + Math.min(900, (b.instr - a.instr) / 220)) / st.speed;
  st.timer = setTimeout(() => { seek(st.i + 1); tick(); }, reduced ? Math.max(dt, 400) : dt);
}

/** Shows event i: replays everything before it silently so figures stand where they should. */
function seek(i, animate = true) {
  const from = i > st.i && animate ? st.i + 1 : 0;
  if (from === 0) { st.last = {}; st.log = []; document.querySelectorAll(".tfig").forEach((el) => (el.style.display = "none")); }
  for (let k = from; k <= i; k++) apply(EV[k], k === i && animate);
  st.i = i;
  moveHead();
  renderNow();
  renderPanel();
}

function apply(e, live) {
  document.querySelectorAll(".mach.lit, .lbl.lit").forEach((x) => x.classList.remove("lit"));
  const flash = document.querySelector(".irqflash");
  // a held flash (stepping by hand) stays until the next event
  if (flash && flash.classList.contains("hold") && e.ev !== "irq") { flash.classList.remove("hold"); flash.style.display = "none"; }
  if (e.ev === "irq") {
    const d = st.g.machineOfNode("kernel.irq-dispatch");
    const c = (e.cause || [])[0] || "";
    const label = { timer: "タイマー", keyboard: "キーボード", syscall: "syscall", automation: "自動操作" }[c] || c;
    if (d && live && flash) {
      const [x, y] = d.top;
      const text = label + (e.service ? ` ${e.service}` : "");
      const w = Math.ceil(measure(text, 12.5, 700) + 30), ls = view.ls || 1;
      flash.innerHTML = `<g transform="translate(${f1(x)},${f1(y - 24)}) scale(${ls.toFixed(4)})"><path class="bolt" d="M3,-22 L-8,2 L-1,2 L-4,20 L9,-6 L2,-6 Z"/><g transform="translate(14,-12)"><rect width="${w}" height="23" rx="11.5"/><text x="${w / 2}" y="16" text-anchor="middle">${esc(text)}</text></g></g>`;
      flash.style.display = "";
      flash.classList.remove("go", "hold"); void flash.getBBox(); flash.classList.add(st.playing ? "go" : "hold");
    }
  }
  const hit = e.ev === "enter" ? machineFor(e) : null;
  if (hit) {
    st.last[e.thread] = hit.m;
    if (live) document.querySelectorAll(`[data-key="${CSS.escape(hit.m.key)}"]`).forEach((x) => x.classList.add("lit"));
  } else if (e.ev === "enter" && e.thread !== -1 && e.program && e.program !== "kernel") {
    // code of the app that the map does not place (os_call, myos_service.call): the thread is
    // in user space, at the door of the OS_CALL elevator
    st.last[e.thread] = userDoor();
  }
  // the figure of the running thread stands where it last was; the others wait aside, each on
  // its own spot, and show their name only on hover
  if (e.thread !== -1) {
    const m = st.last[e.thread];
    if (m) {
      const k = [...THREADS].filter((t) => t.tid !== -1).findIndex((t) => t.tid === e.thread);
      placeFigure(e.thread, m, (k - 1) * 24);
    }
    document.querySelectorAll(".tfig").forEach((el) => el.classList.toggle("idle", +el.dataset.tid !== e.thread));
  } else document.querySelectorAll(".tfig").forEach((el) => el.classList.add("idle"));
  if (live && narrow()) followLit(true, e);
  st.log.unshift({ e, hit });
  if (st.log.length > 40) st.log.length = 40;
}

/* ---------------------------------------------------------------- texts */
function describe(e) {
  const th = threadInfo(e.thread);
  if (e.ev === "irq") return `割り込み：${(e.cause || []).join("・")}${e.service ? `（${e.service}）` : ""}`;
  if (e.ev === "switch") return `${th.short} に切り替わる`;
  if (e.ev === "request") return `外から：${e.method}`;
  return `${e.program === "kernel" ? "カーネルで" : (e.program || "") + " で"} ${e.fn}`;
}
function renderNow() {
  const el = $("t-now");
  if (!el) return;
  const e = EV[st.i];
  const th = threadInfo(e.thread);
  el.innerHTML = `<b>${(st.i + 1)}</b>/${EV.length}　<span class="tdot th-${th.key}"></span>${esc(th.short)}　${esc(describe(e))}`;
}

function renderPanel() {
  const e = EV[st.i];
  const r = T.run || {};
  const th = threadInfo(e.thread);
  let h = `<div class="player trace"><div class="ptop"><div class="ptitle"><span class="pk">記録</span><b>${esc(T.title)}</b></div><div class="ppos">${st.i + 1} <small>/ ${EV.length}</small></div></div>
    <p class="tmeta">${esc(new Date(T.date).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" }))}・タイマー ${r.timer_interval_us ? r.timer_interval_us / 1000 + " ms" : ""}・記録した出来事 ${r.events ?? EV.length}（ここには ${EV.length}）</p></div>`;
  h += `<article class="card trace">`;
  if (r.before && r.after) {
    h += `<div class="screens"><div class="scr"><div class="sbar">${esc(r.before.title)}</div><div class="sbody"><span class="caret"></span></div><div class="sfoot">${esc(r.before.position)}</div><span class="cap">前</span></div><span class="arr">→</span><div class="scr after"><div class="sbar">${esc(r.after.title)}</div><div class="sbody">${esc(r.after.text)}<span class="caret"></span></div><div class="sfoot">${esc(r.after.position)}</div><span class="cap">「${esc(r.typed)}」を打った後</span></div></div>`;
  }
  h += `<section class="sec"><h3>いま</h3><div class="nowcard"><div class="nrow"><span class="tdot th-${th.key}"></span><b>${esc(th.name)}</b><span class="instr">${e.instr.toLocaleString()} 命令目</span></div><p>${esc(describe(e))}</p>`;
  const hit = st.log[0]?.hit;
  if (e.n) h += `<p class="nn">地図では <button class="nlink" data-node="${esc(e.n)}">${esc(node(e.n)?.title || e.n)}</button>${hit && hit.via ? `（建物では <b>${esc(node(hit.m.node).title)}</b> の中）` : hit ? "" : "（建物には置いていない）"}</p>`;
  h += `</div></section>`;
  h += `<section class="sec"><h3>ここまでの出来事</h3><ol class="tlog">${st.log.slice(0, 14).map(({ e: x, hit: hh }) => {
    const t = threadInfo(x.thread);
    return `<li class="ev-${x.ev}"><span class="tdot th-${t.key}"></span><span class="lt">${esc(describe(x))}</span>${hh ? `<span class="lm">${esc(node(hh.m.node).title)}</span>` : ""}</li>`;
  }).join("")}</ol></section>`;
  h += `<section class="sec"><h3>色</h3><p class="tleg"><span class="tdot th-app"></span>アプリ（editor）　<span class="tdot th-svc"></span>カーネルのスレッド　<span class="tdot th-idle"></span>走るものが無い　<span class="bolt-i">⚡</span>割り込み</p>
    <p class="tnote">機械が光るのは、記録がその関数に入った時です。紙の中の関数（gateway の中の read_user_request など）は、その紙を持つ機械を光らせます。</p></section>`;
  h += `<section class="sec"><h3>記録したビルド</h3><ul class="build">${Object.entries(T.build || {}).map(([k, v]) => `<li><code>${esc(k)}</code><code>${esc(v)}</code></li>`).join("")}</ul></section>`;
  h += `</article>`;
  panel.innerHTML = h;
  panel.querySelectorAll("[data-node]").forEach((b) => (b.onclick = () => st.opts?.onNodeInfo?.(b.dataset.node)));
}
