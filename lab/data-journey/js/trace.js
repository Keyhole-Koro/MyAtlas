import { h, svg, fmt, esc } from "./util.js";

// One recorded run under the scene: who was running (switch events) and the events
// that belong to the current step, on an instruction-count axis.
export function traceStrip(A, root, spec, onTip) {
  const T = A.traces.find((t) => t.id === spec.run);
  if (!T) return null;
  const ev = T.events;
  const bySeq = new Map(ev.map((e) => [e.seq, e]));
  const from = spec.from ?? ev[0].instr, to = spec.to ?? ev[ev.length - 1].instr;
  const inRange = ev.filter((e) => e.instr >= from && e.instr <= to);

  // running thread over time (a switch event names the thread that now runs)
  let curThread = null;
  for (const e of ev) { if (e.instr > from) break; if (e.ev === "switch") curThread = e.thread; else if (curThread === null) curThread = e.thread; }
  const runs = [];
  let start = from, th = curThread;
  for (const e of inRange) {
    if (e.ev === "switch" && e.thread !== th) { runs.push({ a: start, b: e.instr, th }); start = e.instr; th = e.thread; }
  }
  runs.push({ a: start, b: to, th });

  const head = h("h3", {}, spec.title, h("small", {}, ""), h("small", { class: "lgs" }, ""));
  const summary = head.querySelector("small");
  const holder = h("div");
  const note = head.querySelector(".lgs");
  root.append(head, holder);

  if (spec.summary) summary.textContent = spec.summary(T, bySeq);
  else if (spec.map) {
    const a = bySeq.get(254), b = bySeq.get(386);
    if (a && b) summary.textContent = `OS_CALL(REQUEST) 命令 ${fmt(a.instr)} → 返事を受け取る ${fmt(b.instr)}（${fmt(b.instr - a.instr)} 命令）`;
  }

  let svgEl, X, hiG, labelT;
  function draw() {
    holder.innerHTML = "";
    const Wd = Math.max(300, root.clientWidth - 28);
    const Hh = 72;
    svgEl = svg("svg", { width: Wd, height: Hh, viewBox: `0 0 ${Wd} ${Hh}` }, holder);
    const L = 4, R = Wd - 4;
    const bf = spec.breakAt ? spec.breakFrac : null;
    X = (instr) => {
      if (!bf) return L + ((instr - from) / (to - from)) * (R - L);
      const xb = L + bf * (R - L);
      if (instr <= spec.breakAt) return L + ((instr - from) / (spec.breakAt - from)) * (xb - L - 6);
      return xb + 6 + ((instr - spec.breakAt) / (to - spec.breakAt)) * (R - xb - 6);
    };
    // thread band
    const bandY = 36, bandH = 16;
    for (const r of runs) {
      const x0 = X(r.a), x1 = X(r.b);
      const name = T.threads[String(r.th)] || String(r.th);
      const col = threadColor(name);
      const rect = svg("rect", { x: x0, y: bandY, width: Math.max(1, x1 - x0), height: bandH, fill: col, opacity: 0.85, rx: 3 }, svgEl);
      const label = threadLabel(name);
      const tw = label.length * 11;
      if (x1 - x0 > tw + 10) svg("text", { x: (x0 + x1) / 2, y: bandY + 12, "text-anchor": "middle", "font-size": 11, fill: "#fff", "font-weight": 700, text: label }, svgEl);
      rect.addEventListener("mouseenter", (e) => onTip && onTip(e, `<b>${esc(name)}</b><br>命令 ${fmt(r.a)} 〜 ${fmt(r.b)}`));
      rect.addEventListener("mouseleave", () => onTip && onTip(null));
    }
    if (bf) {
      const xb = L + bf * (R - L);
      svg("rect", { x: xb - 3, y: bandY - 6, width: 6, height: bandH + 12, fill: "var(--surface)" }, svgEl);
      svg("path", { d: `M${xb - 5},${bandY + bandH + 4} l4,-${bandH + 8} M${xb + 1},${bandY + bandH + 4} l4,-${bandH + 8}`, stroke: "var(--text-3)", "stroke-width": 1.2 }, svgEl);
    }
    // event ticks
    for (const e of inRange) {
      if (e.ev === "switch") continue;
      const x = X(e.instr);
      const isIrq = e.ev === "irq";
      const t = svg("line", { x1: x, x2: x, y1: bandY - (isIrq ? 11 : 7), y2: bandY - 1, stroke: isIrq ? "var(--text-2)" : "var(--text-3)", "stroke-width": isIrq ? 1.5 : 1 }, svgEl);
      t.dataset.seq = e.seq;
    }
    // axis labels
    const ax = (instr, anchor) => svg("text", { x: X(instr), y: Hh - 4, "text-anchor": anchor, "font-size": 11, fill: "var(--text-3)", text: "命令 " + fmt(instr) }, svgEl);
    ax(from, "start"); ax(to, "end");
    if (bf) svg("text", { x: L + bf * (R - L), y: Hh - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--text-3)", text: "≈ ここから縮尺を変えている" }, svgEl);
    hiG = svg("g", {}, svgEl);
    labelT = null;
  }
  draw();
  // one listener per strip element, however many times the packet view is rebuilt
  if (root._onResize) removeEventListener("resize", root._onResize);
  root._onResize = () => { if (!holder.isConnected) return; draw(); if (lastKey) show(lastKey); };
  addEventListener("resize", root._onResize);

  let lastKey = null;
  function show(key) {
    lastKey = key;
    hiG.innerHTML = "";
    const seqs = (spec.map && spec.map[key]) || (spec.pick && spec.pick(key, ev)) || [];
    const evs = seqs.map((s) => (typeof s === "object" ? s : bySeq.get(s))).filter(Boolean);
    note.textContent = "";
    if (!evs.length) {
      note.textContent = "｜" + ((spec.none && spec.none[key]) || "この手順に当たる記録の行は無い");
      return;
    }
    let lastX = -999, row = 0;
    evs.forEach((e) => {
      const x = X(e.instr);
      svg("line", { x1: x, x2: x, y1: 17, y2: 54, stroke: "var(--accent)", "stroke-width": 2.5 }, hiG);
      svg("circle", { cx: x, cy: 17, r: 3.5, fill: "var(--accent)" }, hiG);
    });
    const first = evs[0], last = evs[evs.length - 1];
    const lbl = evs.length > 3 && !spec.listAll
      ? `命令 ${fmt(first.instr)}〜${fmt(last.instr)}：${evs.length} 回`
      : evs.map((e) => `命令 ${fmt(e.instr)} ${e.fn || e.ev}${e.service ? "(" + e.service + ")" : ""}`).join("　／　");
    const x0 = X(first.instr);
    const Wd = Number(svgEl.getAttribute("width"));
    const tw = Math.min(Wd - 8, lbl.length * 6.4);
    const tx = Math.max(4, Math.min(Wd - tw - 4, x0 - 10));
    svg("text", { x: tx, y: 12, "font-size": 11.5, fill: "var(--accent)", "font-weight": 700, text: lbl }, hiG);
    const threads = [...new Set(evs.map((e) => T.threads[String(e.thread)] || e.thread))];
    note.textContent = "｜走っていたスレッド：" + threads.join("、");
  }
  return { show, draw };
}

function threadColor(name) {
  if (/idle/.test(name)) return "var(--border-strong)";
  if (/compositor/.test(name)) return "var(--l-os)";
  if (/kernel:/.test(name)) return "var(--text-3)";
  return "var(--l-app)";
}
function threadLabel(name) {
  if (/compositor/.test(name)) return "compositor（serve が走る）";
  if (/automation/.test(name)) return "automation_ui";
  if (/idle/.test(name)) return "idle";
  return name;
}
