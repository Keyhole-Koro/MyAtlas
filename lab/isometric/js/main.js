import { A, FLOWS, sheet, node, threadOfCtx, KIND_JA, THREADS } from "./model.js";
import { buildMain, buildPaper } from "./building.js";
import { mount, fit, frame, view, narrow } from "./scene.js";
import { tour, attach, show, stop, peekStep } from "./tour.js";
import { playerHtml, stepHtml, nodeHtml, fillCode, panel } from "./panel.js";
import { esc } from "./iso.js";
import { openDirectory, closeDirectory } from "./directory.js";
import { openTrace, closeTrace, traceActive, tracePanel, traceRefit, traceRemount } from "./trace.js";

const MAIN = buildMain();
const PAPERS = {};
const $ = (id) => document.getElementById(id);

const st = {
  sheet: null, g: MAIN, idx: 0, playing: false, stack: [], card: "step", nodeId: null, timer: null,
};

/* ----------------------------------------------------------- header tabs */
function renderTabs() {
  $("tours").innerHTML = FLOWS.map((f) => `<button class="tour" role="tab" data-flow="${f.id}" aria-selected="${rootFlow() === f.id}">${esc(f.tab)}<small>${f.main.length} 手順</small></button>`).join("");
}
function rootFlow() { return st.stack.length ? st.stack[0].sheetId : st.sheet?.id; }

/* ------------------------------------------------------------- opening */
function openFlow(id, idx, opts = {}) {
  stopPlay();
  closeTrace(true);
  st.stack = [];
  st.g = MAIN;
  st.sheet = sheet(id);
  mount(MAIN, st.sheet, { keepCamera: opts.keepCamera });
  attach(MAIN, st.sheet);
  renderTabs();
  renderCrumbs();
  // a flow starts at its first step; the map's own start (st.sheet.start) stays a deep link
  const start = idx ?? order()[0];
  go(start, { animate: !!opts.animate });
  panel.scrollTop = 0;
}

/** Who runs inside a paper: the thread of its machine in the flow we came from; inside a
 *  paper inside a paper, the same thread as outside. */
function threadInside(pid) {
  const outer = st.stack[st.stack.length - 1];
  const sh = outer ? sheet(outer.sheetId) : null;
  if (sh?.isPaper) return outer.hint || null;
  const ownerId = Object.keys(A.nodes).find((k) => A.nodes[k].paper === pid);
  if (!sh || !ownerId) return null;
  if (!sh.boxes.some((b) => b.node === ownerId)) {
    // opened from somewhere that does not hold the machine: the flows that hold it decide, if
    // they agree on one thread
    const ths = new Set();
    for (const f of FLOWS) {
      const b = f.boxes.find((x) => x.node === ownerId);
      if (!b) continue;
      const r = f.regionOfBox[b.id];
      if (r) ths.add(threadOfCtx(r.node)?.key);
      else for (const s of f.steps) if (s.to === b.id && s.thread) ths.add(s.thread.key);
    }
    if (ths.size === 1) { const k = [...ths][0]; return Object.values(THREADS).find((t) => t.key === k) || null; }
    return null;
  }
  const box = sh.boxes.find((b) => b.node === ownerId);
  const r = box && sh.regionOfBox?.[box.id];
  if (r) return threadOfCtx(r.node);
  // the step we came in from decides who is running inside
  const cur = sh.steps[outer.idx];
  if (cur && (cur.to === box?.id || cur.from === box?.id) && cur.thread) return cur.thread;
  const s = sh.steps.find((x) => (x.to === box?.id || x.from === box?.id) && x.thread);
  return s?.thread || null;
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const cam = document.getElementById("cam");

/** Zoom into the machine that holds the paper, then swap the building for the paper. */
function openPaper(pid, { instant = false } = {}) {
  if (!A.papers[pid]) return;
  const owner = Object.keys(A.nodes).find((k) => A.nodes[k].paper === pid);
  const m = st.g.machineOfNode(owner) || st.g.machines.find((x) => x.node === owner);
  if (!instant && !reduced && m) {
    stopPlay();
    frame(grow(m.bounds, 16), true, 28, 4, 520);
    cam.classList.add("dive");
    setTimeout(() => { reallyOpenPaper(pid); cam.classList.remove("dive"); cam.classList.add("rise"); requestAnimationFrame(() => requestAnimationFrame(() => cam.classList.remove("rise"))); }, 470);
    return;
  }
  reallyOpenPaper(pid);
}
function grow(b, d) { return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d }; }

function reallyOpenPaper(pid) {
  stopPlay();
  st.stack.push({ sheetId: st.sheet.id, idx: st.idx, g: st.g, hint: tour.threadHint });
  st.sheet = sheet(pid);
  st.g = PAPERS[pid] ||= buildPaper(pid);
  mount(st.g, st.sheet);
  attach(st.g, st.sheet, threadInside(pid));
  renderCrumbs();
  const entry = st.sheet.start?.[0] ?? 0;
  go(entry, { animate: false });
  panel.scrollTop = 0;
}

function back() {
  if (!st.stack.length) return;
  stopPlay();
  const prev = st.stack.pop();
  const leaving = st.sheet.id;
  st.sheet = sheet(prev.sheetId);
  st.g = prev.g;
  mount(st.g, st.sheet);
  attach(st.g, st.sheet, prev.hint);
  renderCrumbs();
  go(prev.idx, { animate: false });
  panel.scrollTop = 0;
  // come back out of the machine: start close to it and pull back
  const owner = Object.keys(A.nodes).find((k) => A.nodes[k].paper === leaving);
  const m = st.g.machineOfNode(owner) || st.g.machines.find((x) => x.node === owner);
  if (m && !reduced) { frame(grow(m.bounds, 16), false, 28, 4); fit(true); }
}

function renderCrumbs() {
  const parts = [`<button data-crumb="0">ビル</button>`];
  const chain = st.stack.map((x) => x.sheetId).concat(st.sheet.id);
  if (chain.length > 1) {
    chain.slice(1).forEach((id, k) => {
      const s = sheet(id);
      const last = k === chain.length - 2;
      parts.push(`<span class="sep">›</span>${last ? `<span class="here">${esc(s.title)}</span>` : `<button data-crumb="${k + 1}">${esc(s.title)}</button>`}`);
    });
    parts.push(`<span class="hint">Esc で外へ</span>`);
  } else {
    parts[0] = `<span class="here">ビル</span><span class="sep">·</span><span>${esc(st.sheet.title)}</span>`;
  }
  $("crumbs").innerHTML = parts.join("");
}

/* ------------------------------------------------------------- stepping */
function go(i, { animate = true } = {}) {
  const switched = st.idx !== i || st.card !== "step";
  st.idx = i;
  st.card = "step";
  document.querySelectorAll(".mach.sel, .lbl.sel").forEach((e) => e.classList.remove("sel"));
  show(i, { animate });
  renderPanel();
  // a new card starts at its top
  if (switched) panel.scrollTop = 0;
  if (!st.stack.length) history.replaceState(null, "", `#${st.sheet.id}/${(st.sheet.steps[i].no ?? "alt" + i)}`);
}

function order() { return st.sheet.main.map((s) => s.index); }
function nextIndex(i) {
  const s = st.sheet.steps[i];
  if (s.alt) {
    const alts = s.altOf.altSteps;
    const k = alts.indexOf(s);
    return k < alts.length - 1 ? alts[k + 1].index : null;
  }
  const o = order(), k = o.indexOf(i);
  return k < o.length - 1 ? o[k + 1] : null;
}
function prevIndex(i) {
  const s = st.sheet.steps[i];
  if (s.alt) {
    const alts = s.altOf.altSteps, k = alts.indexOf(s);
    return k > 0 ? alts[k - 1].index : s.altOf.index;
  }
  const o = order(), k = o.indexOf(i);
  return k > 0 ? o[k - 1] : null;
}

function play() {
  if (st.playing) return stopPlay();
  st.playing = true;
  const s = st.sheet.steps[st.idx];
  const startAt = (!st.resumable && !s.alt) || nextIndex(st.idx) === null ? order()[0] : st.idx;
  tour.onArrive = (i) => {
    renderPanel();
    if (!st.playing) return;
    const n = nextIndex(i);
    if (n === null) { st.playing = false; st.resumable = false; renderPanel(); return; }
    const lab = st.sheet.steps[i].label || "";
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { if (st.playing) go(n); }, Math.min(3400, Math.max(1500, 900 + lab.length * 28)));
  };
  go(startAt);
}
function stopPlay() {
  if (st.playing) st.resumable = true;
  st.playing = false;
  clearTimeout(st.timer);
  tour.onArrive = () => renderPanel();
  renderPanel?.();
}

/* ---------------------------------------------------------------- panel */
function renderPanel() {
  if (!st.sheet) return;
  const s = st.sheet.steps[st.idx];
  let ctx = "";
  if (st.stack.length) {
    const p = st.sheet;
    const ownerId = Object.keys(A.nodes).find((k) => A.nodes[k].paper === p.id);
    const owner = node(ownerId);
    const exits = Object.entries(p.ports || {}).map(([outerNode, box]) => `<li><b>${esc(p.boxById[box]?.title || box)}</b> から外の <button class="nlink" data-node="${esc(outerNode)}">${esc(node(outerNode)?.title || outerNode)}</button> へ</li>`).join("");
    const hint = tour.threadHint;
    const who = hint
      ? `<p class="pwho"><span class="wdot th-${hint.key}"></span><span>中で走るのは <b>${esc(hint.name)}</b>（外で呼んだのと同じ）</span></p>`
      : `<p class="pwho"><span class="wdot th-other"></span><span>灰色の人は、呼んだスレッドです。${esc(callersOf(ownerId))}</span></p>`;
    ctx = `<div class="paperctx"><p>機械 <button class="nlink" data-node="${esc(ownerId)}">${esc(owner?.title || ownerId)}</button> の中の紙です。入口は <b>${esc(p.boxById[p.entry]?.title || p.entry)}</b>。</p>${who}${exits ? `<ul>${exits}</ul>` : ""}<button class="out" id="p-out">← 外に出る（Esc）</button></div>`;
  }
  const html = playerHtml(st.sheet, s, st.playing, ctx) +
    (st.card === "node" && st.nodeId ? nodeHtml(st.nodeId, st.g, `手順 ${s.alt ? "もし" : s.no} に戻る`) : stepHtml(st.sheet, s, st.g));
  panel.innerHTML = html;
  fillCode(panel);
}

/** Which threads call into a machine, by the flows: "割り込み・アプリのスレッドのどちらからも呼ばれる". */
function callersOf(nodeId) {
  const names = new Set();
  for (const f of FLOWS) {
    const b = f.boxes.find((x) => x.node === nodeId);
    if (!b) continue;
    for (const s of f.steps) if (s.to === b.id && s.thread) names.add(s.thread.name);
  }
  return names.size > 1 ? `${[...names].join("・")}のどちらからも呼ばれます。` : "";
}

function showNode(id) {
  if (!node(id)) return;
  if (traceActive()) {
    panel.innerHTML = nodeHtml(id, MAIN, "記録に戻る");
    fillCode(panel);
    panel.scrollTop = 0;
    return;
  }
  // a card the reader asked for stays: the tour stops playing
  stopPlay();
  st.card = "node";
  st.nodeId = id;
  document.querySelectorAll(".mach.sel, .lbl.sel").forEach((e) => e.classList.remove("sel"));
  const m = st.g.machines.find((x) => x.node === id);
  if (m) document.querySelectorAll(`[data-key="${CSS.escape(m.key)}"]`).forEach((e) => e.classList.add("sel"));
  renderPanel();
  panel.scrollTop = 0;
}

/* --------------------------------------------------------------- events */
panel.addEventListener("click", (e) => {
  const fg = e.target.closest(".figsvg");
  if (fg) {
    const box = $("figbox");
    const cap = fg.parentElement.querySelector("figcaption")?.textContent || "";
    box.innerHTML = `<div class="fb">${cap ? `<h3>${esc(cap)}</h3>` : ""}${fg.innerHTML}</div>`;
    box.hidden = false;
    box.onclick = () => (box.hidden = true);
    return;
  }
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "p-play") return play();
  if (t.id === "p-next") { stopPlay(); const n = nextIndex(st.idx); if (n !== null) go(n); else if (st.sheet.steps[st.idx].alt) go(st.sheet.steps[st.idx].altOf.index); return; }
  if (t.id === "p-prev") { stopPlay(); const n = prevIndex(st.idx); if (n !== null) go(n); return; }
  if (t.id === "p-first") { stopPlay(); st.resumable = false; go(order()[0]); return; }
  if (t.id === "p-out") return back();
  if (t.id === "back-step" && traceActive()) { tracePanel(); return; }
  if (t.dataset.node && traceActive()) return showNode(t.dataset.node);
  if (t.id === "back-step") { st.card = "step"; document.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); renderPanel(); return; }
  if (t.dataset.step && !t.dataset.sheet) { stopPlay(); go(+t.dataset.step); return; }
  if (t.dataset.sheet) {
    const sid = t.dataset.sheet, si = +t.dataset.step;
    if (A.flows.find((f) => f.id === sid)) openFlow(sid, si, { animate: true });
    else { if (st.sheet.id !== sid) { if (st.stack.length) openFlow(st.stack[0].sheetId); openPaperFromNode(sid); } go(si); }
    return;
  }
  if (t.dataset.paper) return openPaper(t.dataset.paper);
  if (t.dataset.paperOpen) { openPaperFromNode(t.dataset.paperOpen); return; }
  if (t.dataset.node) return showNode(t.dataset.node);
  if (t.dataset.box) { const b = st.sheet.boxById[t.dataset.box]; if (b) showNode(b.node); return; }
});

function openPaperFromNode(pid, instant = false) {
  // a paper inside a paper (os.submit lives in os.gateway): open the outer one first
  const owner = Object.keys(A.nodes).find((k) => A.nodes[k].paper === pid);
  if (st.sheet.boxes.some((b) => b.node === owner)) return openPaper(pid, { instant });
  const outerPaper = Object.keys(A.papers).find((p) => A.papers[p].boxes.some((b) => b.node === owner));
  if (outerPaper && outerPaper !== pid) { openPaper(outerPaper, { instant: true }); openPaper(pid, { instant: true }); return; }
  openPaper(pid, { instant });
}

$("crumbs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-crumb]");
  if (!b) return;
  const k = +b.dataset.crumb;
  while (st.stack.length > k) back();
});

$("tours").addEventListener("click", (e) => {
  const b = e.target.closest("[data-flow]");
  if (b) openFlow(b.dataset.flow, undefined, { animate: true });
});

const stage = $("scene");
stage.addEventListener("click", (e) => {
  if (e.target.closest(".lghead")) return toggleLegend();
  const gm = e.target.closest(".gmark[data-step]");
  if (gm) { stopPlay(); go(+gm.dataset.step); return; }
  const t = e.target.closest("[data-node]");
  if (!t) return;
  showNode(t.dataset.node);
});
// machines that are not in the tour show their name while hovered
stage.addEventListener("pointerover", (e) => {
  // a step's number shows its sign while hovered
  const gm = e.target.closest(".gmark[data-step]");
  peekStep(gm ? +gm.dataset.step : -1);
  const t = e.target.closest(".mach[data-key], .lbl[data-key]");
  document.querySelectorAll(".lbl.peek").forEach((x) => x.classList.remove("peek"));
  if (t) document.querySelectorAll(`.lbl[data-key="${CSS.escape(t.dataset.key)}"]`).forEach((x) => x.classList.add("peek"));
});
stage.addEventListener("pointerleave", () => peekStep(-1));
stage.addEventListener("focusin", (e) => {
  const t = e.target.closest?.(".mach[data-key]");
  document.querySelectorAll(".lbl.peek").forEach((x) => x.classList.remove("peek"));
  if (t) document.querySelectorAll(`.lbl[data-key="${CSS.escape(t.dataset.key)}"]`).forEach((x) => x.classList.add("peek"));
});
stage.addEventListener("dblclick", (e) => {
  const t = e.target.closest(".mach[data-node], .lbl[data-node]");
  const p = t && node(t.dataset.node)?.paper;
  if (p) openPaper(p);
});
stage.addEventListener("keydown", (e) => {
  if (e.target.closest?.(".lghead") && (e.key === "Enter" || e.key === " ")) { toggleLegend(); e.preventDefault(); e.stopPropagation(); return; }
  const t = e.target.closest?.(".mach[data-node]");
  if (t && e.key === "Enter") { const p = node(t.dataset.node)?.paper; if (p && st.card === "node" && st.nodeId === t.dataset.node) openPaper(p); else showNode(t.dataset.node); e.stopPropagation(); }
});

addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  if (traceActive()) { if (e.key === "Escape") { closeTrace(); } return; }
  if ($("dir").hidden === false && e.key === "Escape") return closeDirectory();
  if ($("figbox").hidden === false && e.key === "Escape") { $("figbox").hidden = true; return; }
  if ($("help").hidden === false && e.key === "Escape") { $("help").hidden = true; return; }
  if (e.key === "ArrowRight") { stopPlay(); const n = nextIndex(st.idx); if (n !== null) go(n); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { stopPlay(); const n = prevIndex(st.idx); if (n !== null) go(n); e.preventDefault(); }
  else if (e.key === " " && !e.target.closest?.("button")) { play(); e.preventDefault(); }
  else if (e.key === "Home") { stopPlay(); go(order()[0]); }
  else if (e.key === "Escape") { if (st.card === "node") { st.card = "step"; renderPanel(); } else back(); }
  else if (e.key === "Enter" && !e.target.closest?.("button, .mach")) {
    const s = st.sheet.steps[st.idx];
    const p = [s.to, s.from].map((b) => node(st.sheet.boxById[b]?.node)?.paper).find(Boolean);
    if (p) openPaper(p);
  }
});

$("z-fit").addEventListener("click", () => { setFollow(false); if (traceActive()) traceRefit(); else { show(st.idx, { animate: false }); fit(true); } });
$("z-follow").addEventListener("click", () => { setFollow(!tour.follow); if (tour.follow) go(st.idx, { animate: false }); else { show(st.idx, { animate: false }); fit(true); } });
function setFollow(on) {
  tour.follow = on;
  $("z-follow").setAttribute("aria-pressed", String(on));
  // on a narrow screen the legend is a folded card; while the camera follows it stays folded
  const lg = $("legend");
  st.legendQuiet = true;
  if (on) lg.open = false;
  setTimeout(() => (st.legendQuiet = false), 0);
}

/* --------------------------------------------------------------- legend */
// On a wide screen the legend is drawn in the scene, beside the building (scene.js); folding it
// gives the building the room.
function loadLegend() { try { return localStorage.getItem("iso-legend") !== "closed"; } catch { return true; } }
view.legendOpen = loadLegend();
function toggleLegend() {
  view.legendOpen = !view.legendOpen;
  try { localStorage.setItem("iso-legend", view.legendOpen ? "open" : "closed"); } catch {}
  remount();
  document.querySelector("#overlay .lghead")?.focus({ preventScroll: true });
}

/** Draws the shown sheet again (the type size depends on the stage size), keeping the step. */
function remount() {
  if (traceActive()) return traceRemount();
  stop();
  mount(st.g, st.sheet);
  attach(st.g, st.sheet, tour.threadHint);
  show(st.idx, { animate: false });
  if (st.card === "node" && st.nodeId) {
    const m = st.g.machines.find((x) => x.node === st.nodeId);
    if (m) document.querySelectorAll(`[data-key="${CSS.escape(m.key)}"]`).forEach((e) => e.classList.add("sel"));
  }
  if (st.playing) { const n = nextIndex(st.idx); clearTimeout(st.timer); if (n !== null) st.timer = setTimeout(() => st.playing && go(n), 900); }
}
$("btn-dir").addEventListener("click", () => openDirectory({ onPick: (id) => { closeDirectory(); pickFromDirectory(id); } }));
$("btn-rec").addEventListener("click", () => {
  if (traceActive()) { closeTrace(); $("btn-rec").setAttribute("aria-pressed", "false"); return; }
  if (st.stack.length) openFlow(st.stack[0].sheetId);
  stopPlay();
  $("btn-rec").setAttribute("aria-pressed", "true");
  openTrace(MAIN, { onNodeInfo: showNode, onClose: () => { $("btn-rec").setAttribute("aria-pressed", "false"); openFlow(st.sheet.id, st.idx); } });
});
$("btn-help").addEventListener("click", () => toggleHelp());

function pickFromDirectory(id) {
  // a node inside a paper opens that paper; a building machine is selected in place
  const inMain = MAIN.machineOfNode(id);
  if (!inMain) {
    const pid = Object.keys(A.papers).find((p) => A.papers[p].boxes.some((b) => b.node === id));
    if (pid) { if (st.stack.length) openFlow(st.stack[0].sheetId); openPaperFromNode(pid, true); }
  } else if (st.stack.length) openFlow(st.stack[0].sheetId);
  showNode(id);
}

function toggleHelp() {
  const h = $("help");
  if (!h.hidden) { h.hidden = true; return; }
  h.innerHTML = `<div class="hcard"><h2>使い方</h2>
  <ul>
    <li><b>階</b>は層です。上から アプリ（4F）、ライブラリ（3F）、OS サービス（2F）、カーネル（1F）、地下にエミュレータ（B1）。</li>
    <li><b>点線で囲んだ部屋</b>は実行の文脈です。色は、そこで走るもの：<span class="wdot th-app"></span>アプリのスレッド　<span class="wdot th-svc"></span>service task　<span class="wdot th-irq"></span>割り込み。</li>
    <li><b>人</b>はスレッドです。呼び出しは同じ人が歩き、<b>箱</b>が渡すデータです（白い箱はアドレスだけ）。syscall はまん中の <b>OS_CALL エレベーター</b>で下ります。エレベーターの 1F の足元が OS_CALL です。同じスレッドのまま別の階へ行く呼び出しは<b>はしご</b>です。<b>光る点</b>は通知、<b>破線のチップ</b>は読み書きです。</li>
    <li>仕事を別のスレッドに渡した人は、自分の部屋に戻って<b>「待つ」</b>の吹き出しを出して待ちます（例：アプリのスレッドは request(m) で返事を待つ）。割り込みは、自分の手順が終わると消えます。</li>
    <li>▶ で順に流れます。← → で 1 つずつ。番号の丸にマウスを載せるとその手順の札が出て、クリックするとその手順へ。機械をクリックすると説明、紙の印がある機械は「中に入る」で中の紙を見られます（Esc で外へ）。</li>
    <li>「追う」でカメラが動くものを追い、左上に今の階が出ます。見方は建物の下（「見方」を押すとたためます）。</li>
    <li>「記録を見る」は、Editor で「x」を打った 1 回の実際の記録を、建物の上で流します。</li>
  </ul><button class="pb" id="help-close">閉じる</button></div>`;
  h.hidden = false;
  $("help-close").onclick = () => (h.hidden = true);
}

// on a narrow screen the legend is the folded card at the bottom of the stage
const legend = $("legend");
legend.open = false;
// on a phone the camera follows the parcel, so the names stay readable
if (narrow()) setFollow(true);

/* ---------------------------------------------------------------- start */
let resizeTimer = null, lastW = innerWidth, lastH = innerHeight;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (Math.abs(innerWidth - lastW) < 2 && Math.abs(innerHeight - lastH) < 2) return;
    lastW = innerWidth; lastH = innerHeight;
    if (narrow() && !tour.follow) setFollow(true);
    remount();
  }, 120);
});
const m = /^#(\w+)\/(\d+)$/.exec(location.hash);
const firstFlow = m && FLOWS.find((f) => f.id === m[1]) ? m[1] : "ui";
const firstIdx = m ? sheet(firstFlow).main[+m[2] - 1]?.index : undefined;
openFlow(firstFlow, firstIdx);
window.__iso = { st, go, play, openPaper, openFlow, showNode, back, MAIN, tour, remount, view };
