import { buildJourneys, OPS } from "./journeys.js";
import { renderTable, columnsFor } from "./table.js";
import { renderDetail } from "./detail.js";
import { h } from "./util.js";
import { createPacket } from "./packet.js";
import { renderList } from "./list.js";

const narrow = () => innerWidth < 760;

const A = window.ATLAS, C = window.ATLAS_CODE;
const JS = buildJourneys(A);

// `touched`: the reader chose the step (by clicking, the keys or the URL). Until then
// the selection is only the map's starting point, and 再生 plays from step 1.
const state = { j: "ui", view: "table", col: null, row: null, alt: false, playing: false, touched: false };
let table = null, packet = null, timer = null;
const revealed = new Set();

const $ = (id) => document.getElementById(id);
const tip = $("tip");
// The detail panel moves (under a step card on a phone), so keep it by reference:
// the list it sits in is rebuilt and must never take it along.
const detailEl = $("detail");
const tableView = $("tableView");

// ---------------------------------------------------------------- hash
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("j") && JS[p.get("j")]) state.j = p.get("j");
  if (p.get("v")) state.view = p.get("v") === "packet" ? "packet" : "table";
  state.alt = p.get("alt") === "1";
  state.col = p.get("c") || null;
  state.row = p.get("r") || null;
  if (state.col || state.row) state.touched = true;
}
function writeHash() {
  const p = new URLSearchParams();
  p.set("j", state.j); p.set("v", state.view);
  if (state.col && state.touched) p.set("c", state.col);
  if (state.row) p.set("r", state.row);
  if (state.alt) p.set("alt", "1");
  history.replaceState(null, "", "#" + p.toString());
}

// ---------------------------------------------------------------- tooltip
function onTip(e, html) {
  if (!e || !html) { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
  tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, y) + "px";
}

// ---------------------------------------------------------------- legend
function renderLegend(J) {
  const L = $("legend");
  L.innerHTML = "";
  const ribs = J.id === "ui" ? ["app", "osapp", "os"] : ["emu", "kernel", "os", "app"];
  const g2 = h("span", { class: "grp" }, h("b", {}, "線の色＝ある場所"));
  for (const s of ribs) g2.appendChild(h("span", { class: "it" }, h("span", { class: "rib " + s }), h("span", {}, ribWord(J, s))));
  const it = (title, pill, word) => h("span", { class: "it", title }, pill, h("span", {}, word));
  const g1 = h("span", { class: "grp" }, h("b", {}, "印"),
    it("塗りの印は、値が変わる・動く", h("span", { class: "pill solid" }, J.id === "ui" ? "写す" : "足す"), "変える・動かす"),
    it("白い印は、読むだけ・使うだけ", h("span", { class: "pill" }, "読む"), "読む・使う"),
    J.id === "ui"
      ? it(OPS.swapq.d, h("span", { class: "pill cond" }, "差し替え"), "この要求ではしない")
      : it(OPS.addq.d, h("span", { class: "pill cond" }, "足す"), "どれか 1 つ"),
    J.id === "ui" ? it(OPS.word.d, h("span", { class: "pill word" }, "#2"), "何語目") : null,
    J.id === "ui" ? it(OPS.zero.d, h("span", { class: "pill zero" }, "0"), "詰めない") : null,
    it(OPS.ride.d, h("span", { class: "pill dot" }), "運ばれるだけ"));
  L.append(g2, g1);
}
function ribWord(J, s) {
  if (J.id === "ui") return { app: "アプリのメモリ", osapp: "OS 側だが、まだアプリの値・アプリを指す", os: "OS 側" }[s];
  return { emu: "エミュレータ", kernel: "カーネルの変数", os: "OS_CALL の中", app: "アプリのメモリ" }[s];
}

function renderCaption() {
  const J = JS[state.j];
  const box = $("caption");
  box.innerHTML = "";
  box.className = "caption";
  const c = state.col ? cols().find((x) => x.key === state.col) : null;
  const more = (t) => h("button", { class: "more", onclick: () => detailEl.scrollIntoView({ behavior: "smooth", block: "start" }) }, t);
  if (!c) {
    const r = J.rows.find((x) => x.id === state.row);
    if (r) box.append(h("span", { class: "num" }, "行"), h("span", { class: "ttl mono" }, r.name), h("span", { class: "txt" }, r.text), more("この行の旅 ↓"));
    return;
  }
  if (c.security) box.classList.add("sec");
  const title = c.verb || (c.head || []).join(" ").replace(/\s+/g, " ") || (c.to && c.to.title) || "";
  const txt = h("span", { class: "txt" }, c.label);
  if (c.alt) txt.prepend(h("b", {}, "もし列が満杯なら："));
  if (c.security) txt.appendChild(h("span", { class: "sec" }, "ここが要：アプリは名乗れない"));
  else if (c.colNote) txt.appendChild(h("span", { class: "note" }, "— " + c.colNote));
  box.append(
    h("span", { class: "num" + (c.alt ? " alt" : "") }, c.alt ? "もし" : String(c.n)),
    h("span", { class: "ttl" + (/^[\x00-\x7f]+$/.test(title) ? " mono" : "") }, title),
    txt,
    more("地図の文とコード ↓"));
}

// ---------------------------------------------------------------- render
function cols() { return columnsFor(JS[state.j], state.alt); }
// the steps the arrow keys and 再生 walk: the packet has no "if the ring is full" steps
function walkCols() { return state.view === "packet" ? JS[state.j].cols : cols(); }

function render() {
  const J = JS[state.j];
  document.querySelectorAll("#journeySeg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.j === state.j)));
  document.querySelectorAll("#viewSeg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === state.view)));
  $("altToggle").style.display = J.alts.length && state.view === "table" ? "" : "none";
  $("alt").checked = state.alt;
  $("lead").innerHTML = leadHtml(J);
  if (state.view === "packet" && state.col && J.alts.some((a) => a.key === state.col)) state.col = J.altAfter;
  const cs = state.view === "packet" ? J.cols : cols();
  if (!state.col || !cs.find((c) => c.key === state.col)) {
    if (state.row && state.view === "table") state.col = null;
    else { state.col = J.start; state.touched = false; }
  }
  tableView.hidden = state.view !== "table";
  $("packetView").hidden = state.view !== "packet";
  if (state.view === "table") {
    renderLegend(J);
    const wrap = $("gridwrap");
    const small = narrow();
    wrap.hidden = small; $("list").hidden = !small; $("caption").hidden = small; $("hint").hidden = small;
    tableView.appendChild(detailEl); // out of the list before the list is rebuilt
    if (small) {
      table = null;
      if (!state.col) state.col = J.start;
      renderList($("list"), J, { A, cols: cs, sel: state.col, onCol: (k) => { userSelect(k, null); placeDetail(); } });
      placeDetail();
    } else {
      const cs2 = getComputedStyle(wrap);
      const inner = wrap.clientWidth - parseFloat(cs2.paddingLeft) - parseFloat(cs2.paddingRight);
      table = renderTable({ left: $("gridL"), right: $("grid") }, J, {
        A, alt: state.alt, width: inner, reveal: !revealed.has(J.id) && !reduceMotion(), stripTop: false,
        onCol: (k) => userSelect(k, null), onRow: (r) => { state.touched = true; selectRow(r); }, onCell: (k, r) => userSelect(k, r), onTip,
      });
      table.select(state.col, state.row);
      revealed.add(J.id);
      renderCaption();
      requestAnimationFrame(() => scrollColIntoView(true));
    }
    renderDetail(detailEl, detailCtx());
  } else {
    if (!packet || packet.journey !== state.j) {
      packet = createPacket({ A, C, J, root: $("packetView"), onStep: (k, how) => { state.col = k; state.row = null; if (how === "user") state.touched = true; writeHash(); }, onTip, onPlayState: (on) => syncPlay(on), firstPlay: () => !state.touched });
    }
    // a reader who has not chosen a step starts the scene at the beginning
    packet.go(state.touched ? state.col : J.cols[0].key, { jump: true });
  }
  writeHash();
  syncPlay(state.playing);
}

function leadHtml(J) {
  if (J.id === "ui") return `<b>Request</b> の 10 個のフィールドを、手順ごとに追う`;
  return `<b>CPU 時間</b>を、時計の 1 語から % の文字まで追う`;
}

function detailCtx() {
  return {
    A, C, J: JS[state.j], sel: { col: state.col, row: state.row }, cols: cols(),
    onCol: (k) => userSelect(k, null), onRow: (r) => { state.touched = true; selectRow(r); }, onCell: (k, r) => userSelect(k, r),
    onJourney: (j, k) => { state.j = j; state.col = k; state.row = null; state.alt = false; state.touched = true; render(); scrollToGrid(); },
  };
}

// on a phone the detail opens right under the step it belongs to
function placeDetail() {
  if (!narrow() || state.view !== "table") return;
  const list = $("list");
  list.querySelectorAll(".lcard").forEach((c) => c.classList.toggle("on", c.dataset.col === state.col));
  const card = list.querySelector(`.lcard[data-col="${CSS.escape(state.col || "")}"]`);
  if (card) card.after(detailEl);
}

function userSelect(colKey, rowId) { state.touched = true; select(colKey, rowId); syncPlay(state.playing); }
function select(colKey, rowId) {
  state.col = colKey; state.row = rowId || null;
  if (table) table.select(state.col, state.row);
  renderCaption();
  renderDetail(detailEl, detailCtx());
  writeHash();
}
function selectRow(rowId) {
  state.row = state.row === rowId && !state.col ? null : rowId;
  state.col = null;
  if (table) table.select(null, state.row);
  renderCaption();
  renderDetail(detailEl, detailCtx());
  writeHash();
}
function scrollToGrid() { (narrow() ? $("list") : $("gridwrap")).scrollIntoView({ behavior: "smooth", block: "start" }); }

function step(d) {
  const cs = walkCols();
  let i = cs.findIndex((c) => c.key === state.col);
  if (i < 0) i = d > 0 ? -1 : cs.length;
  i = Math.max(0, Math.min(cs.length - 1, i + d));
  state.touched = true;
  if (state.view === "table") {
    select(cs[i].key, state.row && cs[i].cells[state.row] ? state.row : null);
    if (narrow()) placeDetail();
    scrollColIntoView();
  } else packet.go(cs[i].key);
  return i;
}
// keep the chosen column in view; the field names stay put on the left
function scrollColIntoView(instant) {
  if (state.view !== "table" || !table || !state.col) return;
  const wrap = $("gridwrap");
  const x = table.X[state.col];
  if (x === undefined) return;
  const s = $("grid").getBoundingClientRect().width / (table.width - table.LW);
  const left = (x - table.LW) * s, right = (x - table.LW + table.W[state.col]) * s;
  const view = wrap.clientWidth - table.LW - 16;
  if (left < wrap.scrollLeft + 12 || right > wrap.scrollLeft + view - 12) {
    wrap.scrollTo({ left: Math.max(0, left - view / 2), behavior: instant ? "auto" : "smooth" });
  }
}

// ---------------------------------------------------------------- play
function syncPlay(on) {
  state.playing = on;
  const b = $("play");
  b.setAttribute("aria-pressed", String(on));
  b.querySelector(".ico").textContent = on ? "❚❚" : "▶";
  b.querySelector(".lbl").textContent = on ? "止める" : "再生";
  b.title = on ? "止める（Space）" : state.touched ? "選んだ手順から再生（Space）" : "手順 1 から再生（Space）";
}
function setPlaying(on) {
  syncPlay(on);
  clearTimeout(timer);
  if (state.view === "packet" && packet) { if (packet.playing !== on) packet.play(on); return; }
  if (!on) return;
  const cs = cols();
  // until the reader picks a step, or when at the end, play from the first step
  if (!state.touched || cs.findIndex((c) => c.key === state.col) >= cs.length - 1) {
    state.touched = true;
    select(cs[0].key, null);
    if (narrow()) placeDetail();
    scrollColIntoView();
  }
  const tick = () => {
    const cs2 = cols();
    const i = cs2.findIndex((c) => c.key === state.col);
    if (i >= cs2.length - 1) { setPlaying(false); return; }
    step(1);
    timer = setTimeout(tick, cs2[i + 1] && cs2[i + 1].narrow ? 800 : 1600);
  };
  timer = setTimeout(tick, 1200);
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- events
document.querySelectorAll("#journeySeg button").forEach((b) => b.addEventListener("click", () => {
  if (state.j === b.dataset.j) return;
  setPlaying(false);
  state.j = b.dataset.j; state.col = null; state.row = null; state.alt = false; state.touched = false;
  render();
}));
document.querySelectorAll("#viewSeg button").forEach((b) => b.addEventListener("click", () => {
  if (state.view === b.dataset.v) return;
  setPlaying(false);
  state.view = b.dataset.v;
  if (state.view === "packet") state.alt = false; // the scene has no "ring is full" steps
  render();
}));
$("alt").addEventListener("change", (e) => {
  state.alt = e.target.checked;
  if (state.alt) { state.col = JS[state.j].alts[0].key; state.touched = true; }
  else if (JS[state.j].alts.some((a) => a.key === state.col)) state.col = JS[state.j].altAfter;
  render();
});
$("play").addEventListener("click", () => setPlaying(!state.playing));
addEventListener("keydown", (e) => {
  if (e.target.closest("select, textarea, input:not([type=checkbox])")) return;
  if (e.target.closest("button") && (e.key === " " || e.key === "Enter")) return; // the button does it
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); step(-1); }
  else if (e.key === " ") { e.preventDefault(); setPlaying(!state.playing); }
  else if (e.key === "Escape" && state.view === "table") { state.row = null; select(state.col, null); }
});

// Rebuild only when the width changes: a phone's toolbar changes the height all the time.
let rz, lastW = innerWidth;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    const widthChanged = innerWidth !== lastW;
    lastW = innerWidth;
    if (state.view === "table") { if (widthChanged) render(); }
    else if (packet) packet.fit();
  }, 150);
});

addEventListener("hashchange", () => { readHash(); render(); });
$("gridwrap").addEventListener("scroll", (e) => e.target.classList.toggle("scrolled", e.target.scrollLeft > 2), { passive: true });

window.__journey = { state, JS, select, step, render, setPlaying, get packet() { return packet; }, get table() { return table; } };

readHash();
render();
