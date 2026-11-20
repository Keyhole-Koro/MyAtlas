// The page: which scene (a flow, or a paper inside a node) is shown, which step is current,
// which block is selected. The 3D world, the labels and the panel follow this state.
import * as D from "./data.js";
import { layoutScene, DIM } from "./layout.js";
import { Labels, at } from "./labels.js";
import * as P from "./panel.js";
import * as TR from "./trace.js";
import { Flat } from "./flat.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = P.esc;
const stageEl = $("#stage"), panelEl = $("#panel"), labelsEl = $("#labels"), modalEl = $("#code");
const params = new URLSearchParams(location.search);
const darkMq = window.matchMedia("(prefers-color-scheme: dark)");

const state = {
  stack: [],       // [{ scene, step, lay, past }]
  sel: null,       // selected box id in the current scene
  node: null,      // node shown in the panel
  playing: false,
  follow: false,
  hover: null,
  arrived: false,  // the particle reached the end of the current step at least once
  help: false,
  deep: params.has("deep"), // while playing, go into the papers on the way and come back out (off at first)
  deepDone: new Set(),
  mode: "flow",    // "flow" (a flow or a paper) or "trace" (the recorded run)
  tr: null,        // { T, scene, lay, i, playing, speed, timer }
  camBefore: null, // the camera before a block was focused, to go back to on Esc
};
document.documentElement.dataset.dark = darkMq.matches ? "1" : "0";
const cur = () => state.stack[state.stack.length - 1];

// ---------- WebGL, or a clear message without it ----------
function hasWebGL() {
  if (params.has("nogl")) return false;
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch { return false; }
}
// A software renderer (no GPU) gets the lite drawing: no smoothing, plainer materials.
function rendererName() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch { return ""; }
}
let world = null;
let flat = null; // the flat drawing, when there is no WebGL
const labels = new Labels(labelsEl);
async function initWorld() {
  if (!hasWebGL()) return showNoGL();
  try {
    const { World } = await import("./world.js");
    const lite = params.has("lite") || (!params.has("full") && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName()));
    state.lite = lite;
    world = new World($("#gl"), {
      onPick: (id) => (id ? selectBox(id, { focus: true }) : clearSelection()),
      onOpen: (id) => { const sc = state.mode === "trace" ? state.tr.scene : cur().scene; const n = sc.box[id]?.node; if (D.paperOf(n)) openPaper(n); },
      onHover: (id) => { state.hover = id; refreshLabelState(); },
      onHoverTube: (i, e) => showTip(i, e),
      onPickTube: (i) => { if (state.mode === "trace") return; stopPlay(); state.sel = null; showTip(null); setStep(i); },
      onArrive: onArrive,
      onResize: (w, h) => { labels.setSize(w, h); },
      onUserCamera: () => { if (state.follow) setFollow(false); },
    }, { lite });
    world.setDark(darkMq.matches);
    world.frameHooks.push(frame);
    labels.setSize(world.size.w, world.size.h);
    labels.geometry = () => world.screenGeometry();
    labels.viewKey = () => world.viewKey();
    labels.animating = () => world.animating;
  } catch (e) {
    console.warn(e);
    world = null;
    showNoGL(String(e.message || e));
  }
}
// Without WebGL the same layout is drawn flat (flat.js), with a short note about why.
function showNoGL(why) {
  const el = $("#nogl");
  el.hidden = false;
  el.innerHTML = `<div class="box"><h3>WebGL が使えないため、平面の図にしています</h3><p>立体で見るには、ハードウェアアクセラレーションを有効にするか、別のブラウザで開いてください。図・右の欄・下の再生欄で、手順はそのままたどれます。</p>${why ? `<p class="note mono">${esc(why)}</p>` : ""}</div>`;
  flat = new Flat($("#gl"), {
    onPick: (id) => (id ? selectBox(id, {}) : clearSelection()),
    onPickTube: (i) => { if (state.mode === "trace") return; stopPlay(); state.sel = null; setStep(i); },
  });
}
function flatState() {
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  const steps = {};
  for (const s of sc.steps) steps[s.i] = s.i === c.step ? "active" : c.past.has(s.i) ? "past" : "future";
  const blocks = { [st.from]: "from", [st.to]: "to" };
  if (state.sel) blocks[state.sel] = "sel";
  return { steps, blocks, active: c.step };
}

// ---------- scenes ----------
function pathTo(sceneId) {
  // flows are roots; a paper is reached through a box whose node holds it
  const parents = {};
  const queue = D.FLOWS.map((f) => f.id);
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    const sc = D.sceneById(id);
    for (const b of sc.boxes) {
      const p = D.paperOf(b.node);
      if (p && !seen.has(p.id)) { seen.add(p.id); parents[p.id] = id; queue.push(p.id); }
    }
  }
  const path = [sceneId];
  while (parents[path[0]]) path.unshift(parents[path[0]]);
  return D.FLOWS.some((f) => f.id === path[0]) ? path : null;
}
// A scene opens at its first step: the story is told from the beginning. (The map's own starting
// step, `start`, is marked in the list of steps.)
function frameOf(scene, step) {
  return { scene, step: step ?? mainOrder(scene)[0] ?? 0, lay: null, past: new Set() };
}
function setStack(ids, step) {
  state.stack = ids.map((id) => frameOf(D.sceneById(id)));
  if (step != null) cur().step = step;
}

function enterScene(opts = {}) {
  if (state.mode !== "trace") leaveTraceBar();
  const c = cur();
  c.lay ||= layoutScene(c.scene);
  state.sel = null;
  state.selSoft = false;
  state.node = null;
  state.arrived = false;
  state.camBefore = null;
  flat?.build(c.scene, c.lay);
  if (world) {
    world.build(c.scene, c.lay, { animate: opts.animate !== false });
    buildLabels();
    if (opts.animate !== false) labels.holdFor(opts.fromClose ? 900 : 700);
    if (opts.fromClose) {
      // start near the middle and pull back, as if stepping out of a box (or into a paper)
      frameView({ instant: true });
      const T = world.controls.target.clone(), Pp = world.camera.position.clone();
      const dir = Pp.clone().sub(T);
      world.moveCamera(T.clone(), T.clone().add(dir.multiplyScalar(0.35)), 0);
      frameView({ dur: 1150 });
    } else if (opts.intro && !narrowMq.matches) {
      // first load: come down from high above onto the stack
      world.overview({ instant: true, el: 1.15, az: -0.55 });
      const T = world.controls.target.clone(), Pp = world.camera.position.clone();
      world.moveCamera(T, T.clone().add(Pp.sub(T).multiplyScalar(1.35)), 0);
      frameView({ dur: 1700 });
    } else frameView({ instant: !!opts.instant, dur: 900 });
  }
  setStep(c.step, { quiet: true });
  renderChrome();
  setMargins();
}

async function openPaper(nodeId, opts = {}) {
  const p = D.paperOf(nodeId);
  if (!p) return;
  if (state.mode === "trace") {
    // from the recorded run straight to the paper, with the flow it sits in behind it
    stopTrace();
    state.mode = "flow";
    setStack(pathTo(p.id) || [p.id]);
    return enterScene({});
  }
  if (state.stack.some((f) => f.scene.id === p.id)) return;
  if (!opts.keepPlay) stopPlay();
  const c = cur();
  const boxId = c.scene.boxes.find((b) => b.node === nodeId)?.id;
  if (world && boxId) {
    world.diveInto(boxId, 650);
    world.fadeAll(0, 520);
    await sleep(620);
  }
  const f = frameOf(p);
  if (opts.fromStart) f.step = mainOrder(p)[0];
  f.deepFrom = opts.keepPlay ? c.step : null; // the outer step to continue after, when playing
  state.stack.push(f);
  enterScene({ fromClose: true });
}
function closePaper(toDepth = state.stack.length - 2, opts = {}) {
  if (state.stack.length <= 1) return;
  if (!opts.keepPlay) stopPlay();
  const leaving = cur().scene.id;
  state.stack = state.stack.slice(0, Math.max(1, toDepth + 1));
  enterScene({});
  // point at the box that holds the paper we came from
  // mark the box we came out of (an outline only: nothing else is dimmed)
  const back = cur().scene.boxes.find((b) => D.paperOf(b.node)?.id === leaving);
  if (back) { state.sel = back.id; state.selSoft = true; refreshWorldState(); refreshLabelState(); }
}
function switchFlow(id) {
  stopPlay();
  stopTrace();
  setFollow(false);
  state.mode = "flow";
  setStack([id]);
  enterScene({});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- steps ----------
function mainOrder(sc) { return sc.steps.filter((s) => !s.alt).map((s) => s.i); }
function pastOf(sc, i) {
  const st = sc.steps[i];
  const main = mainOrder(sc);
  const past = new Set();
  if (st.alt) {
    main.slice(0, main.indexOf(st.alt.at)).forEach((k) => past.add(k));
    sc.steps.filter((s) => s.alt && s.alt.at === st.alt.at && s.i < i).forEach((s) => past.add(s.i));
  } else main.slice(0, main.indexOf(i)).forEach((k) => past.add(k));
  return past;
}
function ringOf(sc, idxs) {
  let head = 0, tail = 0, count = 0;
  for (const k of [...idxs].sort((a, b) => a - b)) for (const op of sc.steps[k].ops || []) {
    if (op.node !== "os.request-ring") continue;
    if (op.kind === "入れる") { tail++; count++; } else if (op.kind === "出す") { head++; count = Math.max(0, count - 1); }
  }
  return { head, tail, count };
}

function setStep(i, opts = {}) {
  if (state.mode === "trace") return;
  if (state.selSoft && !opts.quiet) { state.sel = null; state.selSoft = false; }
  const c = cur();
  const sc = c.scene;
  if (!sc.steps[i]) i = 0;
  c.step = i;
  c.past = pastOf(sc, i);
  state.arrived = false;
  if (!opts.keepNode) state.node = null;
  refreshWorldState();
  if (world && !opts.quiet && !state.follow) {
    if (state.camBefore && !state.sel) { world.restoreCamera(state.camBefore, 700); state.camBefore = null; }
    else if (narrowMq.matches) world.frameStep(i, { dur: 700 });
    else keepStepInView();
  }
  world?.restartComet();
  refreshLabelState();
  renderPanel();
  renderPlayer();
  updateHash();
}
function refreshWorldState() {
  if (state.mode === "trace") return;
  if (!world) return flat?.setState(flatState());
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  const steps = {};
  for (const s of sc.steps) steps[s.i] = s.i === c.step ? "active" : c.past.has(s.i) ? "past" : "future";
  if (state.sel && !state.selSoft) {
    // a selected block keeps its own tubes and dims the rest
    const node = sc.box[state.sel]?.node;
    for (const s of sc.steps) {
      const touches = s.from === state.sel || s.to === state.sel || (node && s.ref === node);
      if (!touches && s.i !== c.step) steps[s.i] = "dim";
    }
  }
  const blocks = {};
  blocks[st.from] = "from";
  blocks[st.to] = "to";
  if (state.sel) blocks[state.sel] = "sel";
  const ringIdx = new Set(c.past);
  if (state.arrived) ringIdx.add(c.step);
  world.setState({ steps, blocks, active: c.step, ring: ringOf(sc, ringIdx) });
}
function onArrive(i, loops) {
  if (i !== cur().step) return;
  if (!state.arrived) { state.arrived = true; refreshWorldState(); }
  if (state.playing && loops === 1) {
    clearTimeout(state.playTimer);
    state.playTimer = setTimeout(playOn, 420);
  }
}
// One more step of playback: into a paper on the way, on to the next step, or back out.
function playOn() {
  if (!state.playing) return;
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  if (state.deep && !st.alt) {
    const key = `${sc.id}:${st.i}`;
    const p = st.ref && D.paperOf(st.ref);
    if (p && !state.deepDone.has(key) && !state.stack.some((f) => f.scene.id === p.id)) {
      state.deepDone.add(key);
      return openPaper(st.ref, { keepPlay: true, fromStart: true });
    }
  }
  if (next()) return;
  // the end of a paper we went into while playing: back out, and on with the outer flow
  if (state.deep && state.stack.length > 1 && cur().deepFrom != null) {
    // the outer step runs once more, and its arrival moves the playback on
    const from = cur().deepFrom;
    closePaper(state.stack.length - 2, { keepPlay: true });
    setStep(from, { quiet: true });
    return;
  }
  stopPlay();
}
function next() {
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  const main = mainOrder(sc);
  if (st.alt) {
    const chain = sc.steps.filter((s) => s.alt && s.alt.at === st.alt.at);
    const k = chain.findIndex((s) => s.i === st.i);
    if (k < chain.length - 1) { setStep(chain[k + 1].i); return true; }
    const after = main[main.indexOf(st.alt.at) + 1];
    if (after != null) { setStep(after); return true; }
    return false;
  }
  const pos = main.indexOf(c.step);
  if (pos < main.length - 1) { setStep(main[pos + 1]); return true; }
  return false;
}
function prev() {
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  const main = mainOrder(sc);
  if (st.alt) {
    const chain = sc.steps.filter((s) => s.alt && s.alt.at === st.alt.at);
    const k = chain.findIndex((s) => s.i === st.i);
    setStep(k > 0 ? chain[k - 1].i : st.alt.at);
    return true;
  }
  const pos = main.indexOf(c.step);
  if (pos > 0) { setStep(main[pos - 1]); return true; }
  return false;
}
function play() {
  const c = cur(), main = mainOrder(c.scene);
  if (c.step === main[main.length - 1] && !c.scene.steps[c.step].alt) setStep(main[0]);
  state.playing = true;
  state.deepDone = new Set();
  world?.restartComet();
  if (!world) state.playTimer = setInterval(() => { if (!next()) stopPlay(); }, 2200);
  renderPlayer();
}
function stopPlay() {
  state.playing = false;
  clearTimeout(state.playTimer);
  clearInterval(state.playTimer);
  renderPlayer();
}
function togglePlay() { state.playing ? stopPlay() : play(); }
function setFollow(on) {
  state.follow = on;
  world?.setFollow(on);
  if (!on && world) world.camTween = null;
  const b = $("#follow-btn");
  if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
}

function keepStepInView() {
  const c = cur(), t = world.tubes[c.step];
  if (!t) return;
  const pts = [t.path.getPointAt(0), t.mid, t.path.getPointAt(1)];
  const { w, h } = world.size;
  const ob = obstacleRects();
  const bottom = Math.min(h - 10, ...ob.filter((r) => r.y0 > h / 2).map((r) => r.y0));
  const off = pts.map((p) => world.project(p)).some((s) => !s.ok || s.x < 40 || s.x > w - 40 || s.y < 80 || s.y > bottom - 10);
  if (!off) return;
  const center = pts.reduce((a, p) => a.add(p.clone()), new (t.mid.constructor)()).multiplyScalar(1 / pts.length);
  const offset = world.camera.position.clone().sub(world.controls.target);
  world.moveCamera(center, center.clone().add(offset), 700);
}

// ---------- selection ----------
function selectBox(id, opts = {}) {
  state.selSoft = false;
  if (state.mode === "trace") {
    state.sel = id; state.node = id;
    renderPanel(); refreshTraceLabels();
    if (world && opts.focus) world.focusBlock(id, { dist: 30 });
    return;
  }
  const sc = cur().scene;
  if (!sc.box[id]) return;
  state.sel = id;
  state.node = sc.box[id].node;
  refreshWorldState();
  refreshLabelState();
  renderPanel();
  if (world && opts.focus) {
    setFollow(false);
    const narrow = window.innerWidth <= 720;
    if (!state.camBefore) state.camBefore = world.cameraState();
    world.focusBlock(id, { dist: narrow ? 32 : 29 });
  }
  updateHash();
}
function showNode(nodeId) {
  if (state.mode === "trace") {
    if (state.tr.scene.box[nodeId]) return selectBox(nodeId, { focus: true });
    state.sel = null; state.node = nodeId; return renderPanel();
  }
  const sc = cur().scene;
  const box = sc.boxes.find((b) => b.node === nodeId);
  if (box) return selectBox(box.id, { focus: true });
  state.sel = null;
  state.node = nodeId;
  refreshWorldState();
  refreshLabelState();
  renderPanel();
}
function clearSelection() {
  if (!state.sel && !state.node) return;
  state.sel = null;
  state.node = null;
  if (world && state.camBefore) { world.restoreCamera(state.camBefore, 800); state.camBefore = null; }
  if (state.mode === "trace") { renderPanel(); refreshTraceLabels(); return; }
  refreshWorldState();
  refreshLabelState();
  renderPanel();
  updateHash();
}

// ---------- what a hovered tube is ----------
const tipEl = document.createElement("div");
tipEl.className = "tip";
stageEl.appendChild(tipEl);
let tipStep = null;
function showTip(i, e) {
  if (i == null || state.mode === "trace") { tipEl.classList.remove("on"); tipStep = null; return; }
  const sc = cur().scene, s = sc.steps[i];
  if (!s) return;
  if (tipStep !== i) {
    const a = sc.box[s.from], b = sc.box[s.to];
    tipEl.innerHTML = `<div class="h"><b class="${s.alt ? "alt" : ""}">${esc(s.alt ? s.name : s.num)}</b><span>${esc(s.verb || D.STEP_KIND_SHORT[s.kind] || "")}</span></div><div class="ft">${esc(a?.short || a?.title)} → ${esc(b?.short || b?.title)}</div><div>${esc(D.plainText(s.label))}</div><div class="k">${esc(D.STEP_KIND[s.kind] || s.kind)}${i === cur().step ? "・いまの手順" : "・クリックでこの手順へ"}</div>`;
    tipStep = i;
  }
  if (e) {
    const r = stageEl.getBoundingClientRect();
    const x = Math.min(e.clientX - r.left + 16, r.width - tipEl.offsetWidth - 8);
    const y = e.clientY - r.top + 18 + tipEl.offsetHeight > r.height - 8 ? e.clientY - r.top - tipEl.offsetHeight - 12 : e.clientY - r.top + 18;
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  tipEl.classList.add("on");
}

// ---------- labels ----------
const div = (cls, html) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return d; };
function boxSub(b) {
  if (b.sub) return b.sub;
  if (b.slots) {
    if (b.node === "os.request-ring") {
      const ch = D.NODES["kernel.channel"]?.shape?.roles;
      if (ch) return `${ch.n.num} 枠・1 枠 ${ch.item.num} ${ch.item.unit}`;
    }
    return b.slots.join(" · ");
  }
  if (b.bits) return b.bits.map(([n, k]) => `${n} ${k}`).join(" · ");
  return b.ns || "";
}
// Where the story of a scene starts: a paper's entry, else where its first step leaves from.
function entryBox(sc) {
  if (sc.entry && sc.box[sc.entry]) return sc.entry;
  return sc.steps.find((s) => !s.alt)?.from || null;
}
// Points along a tube where its badge may sit, the middle first (indices into tube.samples).
const BADGE_AT = [12, 11, 13, 10, 14, 9, 15, 8, 16, 7, 17, 6, 18, 5, 19, 4, 20, 3, 21];
function badgeAnchor(i) {
  const t = world?.tubes[i];
  if (!t) return null;
  const pts = [];
  for (const k of BADGE_AT) { const q = world.project(t.samples[k]); if (q.ok) pts.push(q); }
  if (!pts.length) return null;
  // how long the tube is on the screen: a short one has few spots, so its badge goes first
  const a = world.project(t.samples[3]), b = world.project(t.samples[21]);
  return { ok: true, pts, len: Math.hypot(a.x - b.x, a.y - b.y) };
}
const shortFirst = (a) => (a ? 0.4 * (1 - Math.min(1, a.len / 400)) : 0);
function buildLabels() {
  labels.clear();
  if (!world) return;
  const c = cur(), sc = c.scene, lay = c.lay;
  for (const band of lay.bands) {
    const el = div("pl", `<span class="n">${esc(band.name)}</span><span class="s">${esc(band.sub || "")}</span>${band.empty ? `<span class="e">この流れは通らない</span>` : ""}`);
    el.style.setProperty("--c", `var(--l-${band.tone})`);
    labels.add(`plate:${band.id}`, {
      el, prio: 80, variants: ["compact"], rich: ["full"], growPrio: 70, kind: "plate", band: band.id, owner: `plate:${band.id}`,
      pen: { tube: 4, rim: 4, block: 30 }, step: 3,
      anchor: () => plateAnchor(lay, band),
      cands: at.plate,
    });
  }
  for (const b of sc.boxes) {
    const node = D.NODES[b.node];
    const paper = node?.paper && D.PAPER_SCENES[node.paper];
    // a block with a paper inside keeps a way in, even in its short form (the small ↘)
    const el = div("bl", `<div class="t">${esc(b.title)}${paper ? `<button class="paper mini" data-paper="${esc(b.node)}" title="${esc(paper.title)}（中の紙）" aria-label="中の紙へ">↘</button>` : ""}</div><div class="s">${esc(boxSub(b))}</div>${paper ? `<button class="paper wide" data-paper="${esc(b.node)}" title="${esc(paper.title)}">中の紙 ↘</button>` : ""}`);
    el.dataset.box = b.id;
    labels.add(`box:${b.id}`, {
      el, prio: 60, variants: ["compact"], rich: ["full"], growPrio: 40, kind: "box", box: b.id, pad: 4, owner: `box:${b.id}`,
      pen: { tube: 4, rim: 3, block: 40 }, step: 1.5, max: 45, growSlack: 3,
      anchor: () => world.blockRect(b.id),
      cands: at.blockAround,
    });
  }
  const entry = entryBox(sc);
  if (entry) {
    labels.add("here", {
      el: div("here", "ここから"), prio: 82, kind: "here", owner: `box:${entry}`, pad: 2, pen: { tube: 3, rim: 3, block: 40 }, step: 4, max: 40,
      anchor: () => world.blockRect(entry),
      cands: at.above,
    });
  }
  for (const r of lay.regions) {
    const el = div("rl", esc(r.label3 || r.label));
    el.title = r.label;
    labels.add(`region:${r.node}`, {
      el, prio: 62, kind: "region", pen: { tube: 3, rim: 2, block: 100 }, step: 1, max: 22,
      anchor: () => {
        const pts = r.labelAt.edge.map((p) => world.project(p)).filter((q) => q.ok);
        const back = r.labelAt.back.map((p) => world.project(p)).filter((q) => q.ok);
        return pts.length ? { ok: true, pts, back, right: r.labelAt.right } : null;
      },
      cands: at.region,
    });
  }
  for (const t of lay.tubes) {
    const s = sc.steps[t.i];
    const data = s.data && s.data.label ? `<span class="d"><i class="ic"></i>${esc(s.data.label)}</span>` : "";
    const el = div("sb", `<b>${esc(s.alt ? s.name : s.num)}</b><span class="v">${esc(s.verb || D.STEP_KIND_SHORT[s.kind] || "")}</span>${data}`);
    el.dataset.step = t.i;
    // the badge is where the eye goes: it explains its tube like the tube itself does
    el.addEventListener("pointerenter", (e) => { showTip(t.i, e); world?.setHoverTube(t.i); });
    el.addEventListener("pointermove", (e) => showTip(t.i, e));
    el.addEventListener("pointerleave", () => { showTip(null); world?.setHoverTube(null); });
    labels.add(`step:${t.i}`, {
      el, prio: 30, variants: ["num", "dot"], rich: ["nv"], kind: "step", stepIndex: t.i, owner: `step:${t.i}`, pen: { tube: 2, block: 25 }, step: 0.5, nudge: shortFirst, growSlack: 4,
      anchor: () => badgeAnchor(t.i),
      cands: at.along,
    });
  }
  labels.obstacles = () => obstacleCache;
  refreshLabelState();
}
// The left end of a plate's front edge; when it is off screen, the first visible point of that
// edge, and the label then goes inside the plate.
function plateAnchor(lay, band) {
  const pl = lay.plates?.[band.id] || lay.plate;
  const y = band.y - DIM.PLATE_T / 2, z = pl.z1;
  const a = world.project([pl.x0, y, z]);
  if (a.ok && a.x >= 14) return { ...a, inside: false };
  const n = 40;
  for (let k = 1; k <= n; k++) {
    const x = pl.x0 + ((pl.x1 - pl.x0) * k) / n;
    const p = world.project([x, y, z]);
    if (p.ok && p.x >= 14 && p.y > 0 && p.y < world.size.h) return { ...p, inside: true };
  }
  return a.ok ? { ...a, inside: false } : null;
}
// Who is placed first, and in which form. Round 1 (smallest forms): the current step's badge with
// its verb, a hovered block, the current step's two blocks (always shown), a selected block, every
// step's number (short tubes first), "ここから", the layers, the execution contexts, the other
// blocks' names, the alternatives. Round 2 (growing): what the current step hands over, the hovered
// or selected block's subtitle, the current step's blocks' subtitles, the layers' subtitles, the
// next step's verb, the past steps' verbs, the coming steps' verbs, the other blocks' subtitles,
// and last the alternatives' verbs.
function refreshLabelState() {
  if (!world) return;
  if (state.mode === "trace") return refreshTraceLabels();
  const c = cur(), sc = c.scene, st = sc.steps[c.step];
  const main = mainOrder(sc);
  const pos = main.indexOf(st.alt ? st.alt.at : c.step);
  const activeBands = new Set([sc.box[st.from]?.band, sc.box[st.to]?.band]);
  const narrow = narrowMq.matches;
  for (const it of labels.items.values()) {
    if (it.kind === "box") {
      const id = it.box;
      const role = id === st.to ? "to" : id === st.from ? "from" : "";
      it.el.classList.toggle("to", role === "to");
      it.el.classList.toggle("from", role === "from");
      it.el.classList.toggle("sel", state.sel === id);
      // the current step's blocks (and a hovered or selected one) come early and grow early, but
      // in round 1 they take no more room than a name, so every step number still finds a place
      it.prio = state.hover === id ? 99 : state.sel === id ? 92 : role === "to" ? 96 : role === "from" ? 95 : 60;
      it.growPrio = state.hover === id ? 99 : state.sel === id ? 92 : role ? 75 : 40;
      it.force = !!role;
    } else if (it.kind === "plate") {
      it.prio = narrow && activeBands.has(it.band) ? 97 : 80;
    } else if (it.kind === "step") {
      const s = sc.steps[it.stepIndex];
      const active = it.stepIndex === c.step;
      const past = c.past.has(it.stepIndex);
      const k = main.indexOf(it.stepIndex);
      const d = k < 0 || pos < 0 ? 99 : k - pos; // how far from the current step (negative: done)
      const cls = `sb${active ? " active" : ""}${past ? " past" : ""}${s.alt ? " alt" : ""}${d === 1 ? " next" : ""}`;
      if (it.cls !== cls) { it.cls = cls; it.sizes = null; }
      it.el.className = `${cls} lbl${it.shown ? "" : " off"}`;
      // the current badge shows its verb at once, and what is handed over once every number has a place
      if (active) Object.assign(it, { prio: 100, variants: ["nv", "num"], rich: ["full"], growPrio: 101, growSlack: 12, force: true, max: Infinity, pen: { tube: 6, block: 25 } });
      else if (s.alt) Object.assign(it, { prio: 50, variants: ["num"], rich: ["nv"], growPrio: 35, growSlack: 4, force: false, max: 30, pen: { tube: 2, block: 25 } });
      else Object.assign(it, { prio: d === 1 ? 86 : 85, variants: ["num", "dot"], rich: ["nv"], growPrio: d === 1 ? 68 : d < 0 ? 66 + d * 0.1 : 62 - d * 0.1, growSlack: 4, force: false, max: Infinity, pen: { tube: 2, block: 25 } });
      it.hidden = !!state.sel && !state.selSoft && !active && !(s.from === state.sel || s.to === state.sel);
    }
  }
  labels.touch();
}
function obstacleRects() {
  const sr = stageEl.getBoundingClientRect();
  const out = [];
  for (const el of [$("#crumbs"), $("#viewbtns"), $("#player"), state.help ? $("#help") : null]) {
    if (!el || el.hidden || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && r.bottom > sr.top && r.top < sr.bottom) out.push({ x0: r.left - sr.left - 4, y0: r.top - sr.top - 4, x1: r.right - sr.left + 4, y1: r.bottom - sr.top + 4 });
  }
  return out;
}
let obstacleCache = [], obstacleAge = 0;
function refreshObstacles() {
  const o = obstacleRects();
  if (JSON.stringify(o) !== JSON.stringify(obstacleCache)) { obstacleCache = o; labels.touch(); }
}
function frame() {
  if (++obstacleAge > 20) { refreshObstacles(); obstacleAge = 0; }
  labels.update();
}

// ---------- chrome: tabs, crumbs, view buttons, player, panel ----------
// On a phone the tabs scroll sideways; their right edge fades until the end is reached.
const tabsEl = $("#tabs");
function tabsFade() { tabsEl.classList.toggle("end", tabsEl.scrollLeft + tabsEl.clientWidth >= tabsEl.scrollWidth - 4); }
tabsEl.addEventListener("scroll", tabsFade, { passive: true });
window.addEventListener("resize", tabsFade);
function renderChrome() {
  requestAnimationFrame(tabsFade);
  const root = state.mode === "trace" ? "trace" : state.stack[0].scene.id;
  const T0 = D.ATLAS.traces?.[0];
  $("#tabs").innerHTML = D.FLOWS.map((f) => `<button role="tab" aria-selected="${f.id === root}" data-flow="${esc(f.id)}">${esc(f.tab)}<span class="n">${f.steps.filter((s) => !s.alt).length} 手順</span></button>`).join("")
    + (T0 ? `<button role="tab" aria-selected="${root === "trace"}" data-trace="1">記録：「${esc(T0.run?.typed || "")}」を打つ<span class="n">${T0.events.length} 件</span></button>` : "");
  if (state.mode === "trace") {
    $("#crumbs").innerHTML = `<div class="path"><span>記録</span></div><h2><span class="kindtag">記録</span>${esc(state.tr.T.trace.title)}</h2><div class="hint">地図に載っている関数を積み木に（高さは入った回数）。光が入った順に跳び、直前の 7 回の跳び方が線で残ります</div>`;
    $("#viewbtns").innerHTML = world ? `${state.lite ? `<span class="litetag">簡易表示</span>` : ""}<button class="ghost" id="overview-btn" title="全体を見る（0）">全体</button>` : "";
    refreshObstacles();
    return;
  }
  const c = cur();
  const path = state.stack.map((f, k) => k === state.stack.length - 1
    ? `<span>${esc(f.scene.type === "flow" ? f.scene.tab : f.scene.tab + " の中")}</span>`
    : `<button data-depth="${k}">${esc(f.scene.type === "flow" ? f.scene.tab : f.scene.tab + " の中")}</button><span class="sep">›</span>`).join("");
  $("#crumbs").innerHTML = `<div class="path">${path}</div><h2>${c.scene.type === "paper" ? `<span class="kindtag">中の紙</span>` : ""}${esc(c.scene.title)}</h2>${state.stack.length > 1 ? `<button class="btn back" data-depth="${state.stack.length - 2}">← 外へ戻る（Esc）</button>` : `<div class="hint">← → で 1 手順ずつ・積み木をクリックで説明・ドラッグで回す</div>`}`;
  $("#viewbtns").innerHTML = world ? `${state.lite ? `<span class="litetag" title="GPU が使えないため、軽い描き方にしています">簡易表示</span>` : ""}<button class="ghost" id="overview-btn" title="全体を見る（0）">全体</button><button class="ghost" id="follow-btn" aria-pressed="${state.follow}" title="動く要求を追いかける（F）">追いかける</button>` : "";
  refreshObstacles();
}

const ICON = {
  prev: `<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  next: `<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  play: `<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>`,
};
function renderPlayer() {
  if (state.mode === "trace") return renderTraceBar();
  const c = cur();
  if (!c) return;
  const sc = c.scene, st = sc.steps[c.step];
  const main = mainOrder(sc);
  const pos = st.alt ? -1 : main.indexOf(c.step);
  const a = sc.box[st.from], b = sc.box[st.to];
  const pp = paperOfStep(sc, st);
  $("#player").innerHTML = `<div class="ctl"><button data-act="prev" aria-label="前の手順（←）" ${pos === 0 ? "disabled" : ""}>${ICON.prev}</button><button class="play" data-act="play" aria-label="${state.playing ? "止める" : "順に流す"}（Space）">${state.playing ? ICON.pause : ICON.play}</button><button data-act="next" aria-label="次の手順（→）" ${pos === main.length - 1 ? "disabled" : ""}>${ICON.next}</button></div>
  <div class="cap"><div class="h"><span class="no${st.alt ? " alt" : ""}">${st.alt ? esc(st.name) : `${st.num} / ${main.length}`}</span><span class="verb">${esc(st.verb || D.STEP_KIND_SHORT[st.kind])}</span><span class="ft">${esc(a?.short || a?.title)} → ${esc(b?.short || b?.title)}</span>${pp ? `<button class="pp${state.playing ? " pulse" : ""}" data-paper="${esc(pp)}" title="${esc(D.paperOf(pp).title)}">中の紙を見る ↘</button>` : ""}</div>
  <div class="l">${esc(D.plainText(st.label))}</div>
  <div class="dots">${sc.steps.map((s) => `<button data-step="${s.i}" class="${s.i === c.step ? "on" : c.past.has(s.i) ? "past" : ""}${s.alt ? " alt" : ""}" aria-label="${esc(s.alt ? s.name : `手順 ${s.num}`)}"></button>`).join("")}</div></div>
  ${world ? `<label class="deep" title="順に流す時、中の紙がある箱では中へ入り、紙の手順を流してから外へ戻る"><input type="checkbox" data-act="deep" ${state.deep ? "checked" : ""}>紙にも入る</label>` : ""}`;
}
// The paper this step leads into, if any: the one of the node the step is about, else of its target
// or its source (and not one we are already inside).
function paperOfStep(sc, st) {
  const ids = [st.ref, sc.box[st.to]?.node, sc.box[st.from]?.node];
  return ids.find((id) => id && D.paperOf(id) && !state.stack.some((f) => f.scene.id === D.paperOf(id).id)) || null;
}
function renderPanel() {
  if (state.mode === "trace") {
    const tr = state.tr;
    panelEl.innerHTML = state.node
      ? P.nodeView(state.node, { uses: [], elsewhere: elsewhereOf(state.node, null) }).replace("× 手順に戻る", "× 記録に戻る")
      : TR.tracePanel(tr.T, tr.i, tr.counts);
    return;
  }
  const c = cur(), sc = c.scene;
  let h = "";
  if (state.node) {
    const uses = sc.steps.filter((s) => sc.box[s.from]?.node === state.node || sc.box[s.to]?.node === state.node || s.ref === state.node || (s.ops || []).some((o) => o.node === state.node));
    h += P.nodeView(state.node, { uses, elsewhere: elsewhereOf(state.node, sc.id) });
  } else h += P.stepView(sc, c.step);
  h += P.stepList(sc, c.step, c.past);
  h += P.nodeIndex(state.node ? D.NODES[state.node]?.layer : null);
  panelEl.innerHTML = h;
  if (!state.node) panelEl.scrollTop = 0;
}

function elsewhereOf(nodeId, skipId) {
  const out = [];
  for (const other of [...D.FLOWS, ...Object.values(D.PAPER_SCENES)]) {
    if (other.id === skipId) continue;
    const bx = other.boxes.find((b) => b.node === nodeId);
    const path = bx && pathTo(other.id);
    if (path) out.push({ path: path.join(">"), box: bx.id, title: other.type === "flow" ? other.tab : `${other.tab} の中` });
  }
  return out;
}

// ---------- the recorded run ----------
function switchTrace(k) {
  const T0 = D.ATLAS.traces?.[0];
  if (!T0) return;
  stopPlay();
  setFollow(false);
  state.mode = "trace";
  state.sel = null; state.node = null;
  if (!state.tr) {
    const T = TR.prepTrace(T0);
    const scene = TR.traceScene(T);
    state.tr = { T, scene, lay: TR.layoutTrace(scene), i: 0, counts: {}, playing: false, speed: 1, timer: null };
  }
  const tr = state.tr;
  if (world) {
    world.build(tr.scene, tr.lay, { animate: true });
    buildTraceLabels();
    labels.holdFor(700);
  } else flat?.build(tr.scene, tr.lay);
  renderChrome();
  renderTraceBar(true);
  setMargins();
  frameView({ dur: 900, trace: true });
  setTraceIndex(k ?? tr.i, { jump: true });
}
function buildTraceLabels() {
  labels.clear();
  const tr = state.tr, lay = tr.lay;
  for (const band of lay.bands) {
    const el = div("pl", `<span class="n">${esc(band.name)}</span><span class="s">${esc(band.sub || "")}</span>${band.empty ? `<span class="e">地図の関数は出てこない</span>` : ""}`);
    el.style.setProperty("--c", `var(--l-${band.tone})`);
    labels.add(`plate:${band.id}`, { el, prio: 80, variants: ["compact"], rich: ["full"], growPrio: 70, kind: "plate", band: band.id, owner: `plate:${band.id}`, anchor: () => plateAnchor(lay, band), cands: at.plate });
  }
  // Two lines, so two functions with the same name (request, handle) never look alike: the
  // namespace small on top, the function under it; the number of times entered as a third line.
  const shortCount = {};
  for (const b of tr.scene.boxes) shortCount[b.main = traceMain(b)] = (shortCount[b.main] || 0) + 1;
  for (const b of tr.scene.boxes) {
    const top = traceTop(b);
    const el = div("bl tb", `${top ? `<div class="ns">${esc(top)}</div>` : ""}<div class="t">${esc(b.main)}</div><div class="s"><span class="cnt"></span></div>`);
    el.title = b.title;
    const row = lay.boxes[b.id].row;
    const base = shortCount[b.main] > 1 || !top ? ["compact"] : ["compact", "mini"];
    labels.add(`box:${b.id}`, {
      el, prio: 60, variants: base, baseVariants: base, rich: ["full"], growPrio: 40,
      kind: "box", box: b.id, pad: 3, owner: `box:${b.id}`,
      anchor: () => world.blockRect(b.id),
      // back row: on the block or over it (below it is the front row); front row: in front of it
      cands: row === "back"
        ? (a, w, h) => [{ x: a.cx - w / 2, y: a.cy - h / 2 - 2 }, { x: a.cx - w / 2, y: a.y0 - h - 3 }, { x: a.x1 + 4, y: a.y0 }, { x: a.x0 - w - 4, y: a.y0 }]
        : at.blockAround,
    });
  }
  labels.obstacles = () => obstacleCache;
}
// "request_gateway.request" → request_gateway. / request; "OS_CALL" (entered as syscall.dispatch)
// → syscall.dispatch / OS_CALL.
function traceMain(b) { return b.title.includes(".") ? b.short : b.title; }
function traceTop(b) {
  if (b.title.includes(".")) return `${b.ns}.`;
  const fn = b.sub || "";
  if (fn.endsWith(`.${b.title}`)) return fn.slice(0, fn.length - b.title.length);
  return fn;
}
function refreshTraceLabels() {
  const tr = state.tr;
  const cur = tr.T.events[tr.i];
  const trail = tr.trailNodes || [];
  for (const it of labels.items.values()) {
    if (it.kind !== "box") continue;
    const n = tr.counts[it.box] || 0, total = tr.scene.box[it.box].total;
    const cnt = it.el.querySelector(".cnt");
    const txt = `${n}/${total} 回`;
    if (cnt.textContent !== txt) { cnt.textContent = txt; it.sizes = null; }
    const on = cur.n === it.box;
    it.el.classList.toggle("to", on);
    it.el.classList.toggle("sel", state.sel === it.box);
    it.el.classList.toggle("unused", n === 0);
    const age = trail.length - 1 - trail.lastIndexOf(it.box);
    it.prio = state.hover === it.box ? 99 : on ? 95 : state.sel === it.box ? 92 : age < trail.length ? 90 - age * 1.5 : 60 + Math.min(20, n) * 0.5;
    it.force = on;
    const hot = on || state.hover === it.box || state.sel === it.box;
    it.variants = hot ? ["full", "compact"] : it.baseVariants;
    it.rich = hot ? null : ["full"];
  }
  labels.touch();
}
function setTraceIndex(k, opts = {}) {
  const tr = state.tr, T = tr.T;
  k = Math.max(0, Math.min(T.events.length - 1, k));
  const prevI = tr.i;
  tr.i = k;
  tr.counts = {};
  let last = null;
  for (let j = 0; j <= k; j++) { const e = T.events[j]; if (e.ev === "enter" && e.n) { tr.counts[e.n] = (tr.counts[e.n] || 0) + 1; if (j < k) last = e.n; } }
  const e = T.events[k];
  const dark = darkMq.matches;
  // the last mapped functions entered, oldest first, for the fading arcs and the labels
  const seq = [];
  for (let j = k; j >= 0 && seq.length < 8; j--) { const x = T.events[j]; if (x.ev === "enter" && x.n && tr.scene.box[x.n]) seq.unshift(x); }
  tr.trailNodes = seq.map((x) => x.n);
  if (!world) flat?.setState({ steps: {}, blocks: seq.length ? { [seq[seq.length - 1].n]: "to" } : {} });
  if (world) {
    const hops = [];
    for (let q = 1; q < seq.length; q++) hops.push({ from: seq[q - 1].n, to: seq[q].n, color: TR.threadColor(seq[q].thread, dark) });
    world.setTrail(hops);
    const color = TR.threadColor(e.thread, dark);
    if (e.ev === "enter" && e.n) {
      if (opts.jump || Math.abs(k - prevI) > 1) world.parkHopper(e.n, color);
      else world.hop(last, e.n, color, opts.dur ?? 0.32);
      world.flash(e.n, color, 1);
    } else {
      const at = last || [...T.events.slice(0, k)].reverse().find((x) => x.n)?.n;
      if (at && (opts.jump || Math.abs(k - prevI) > 1)) world.parkHopper(at, TR.threadColor(e.thread, dark));
    }
    if (e.ev === "irq") world.flash("kernel.irq-dispatch", TR.threadColor(e.thread, dark), 0.5);
  }
  if (!state.node) renderPanel();
  renderTraceBar();
  refreshTraceLabels();
  updateHash();
}
const TRACE_DELAY = { enter: 340, irq: 260, switch: 520, request: 700 };
function traceStep() {
  const tr = state.tr;
  if (!tr.playing) return;
  if (tr.i >= tr.T.events.length - 1) return stopTrace();
  const e = tr.T.events[tr.i + 1];
  const delay = (e.ev === "enter" && !e.n ? 110 : TRACE_DELAY[e.ev] || 300) / tr.speed;
  setTraceIndex(tr.i + 1, { dur: Math.min(0.32, (delay / 1000) * 0.9) });
  tr.timer = setTimeout(traceStep, delay);
}
function playTrace() {
  const tr = state.tr;
  if (tr.i >= tr.T.events.length - 1) setTraceIndex(0, { jump: true });
  tr.playing = true;
  clearTimeout(tr.timer);
  tr.timer = setTimeout(traceStep, 200);
  renderTraceBar();
}
function stopTrace() {
  const tr = state.tr;
  if (!tr) return;
  tr.playing = false;
  clearTimeout(tr.timer);
  if (state.mode === "trace") renderTraceBar();
}
let timeline = null;
function renderTraceBar(rebuild) {
  const tr = state.tr, el = $("#player");
  const cap = TR.traceCaption(tr.T, tr.i);
  const e = tr.T.events[tr.i];
  if (rebuild || !el.querySelector(".tlhost")) {
    el.classList.add("tbar");
    el.innerHTML = `<div class="ctl"><button data-act="tprev" aria-label="前の出来事（←）">${ICON.prev}</button><button class="play" data-act="tplay"></button><button data-act="tnext" aria-label="次の出来事（→）">${ICON.next}</button><button class="speed" data-act="tspeed" aria-label="速さ"></button></div><div class="cap"><div class="h"></div><div class="tlhost"></div></div>`;
    timeline = new TR.Timeline(el.querySelector(".tlhost"), tr.T, { onSeek: (k) => { stopTrace(); setTraceIndex(k); }, dark: darkMq.matches });
  }
  el.querySelector("[data-act=tplay]").innerHTML = tr.playing ? ICON.pause : ICON.play;
  el.querySelector("[data-act=tplay]").setAttribute("aria-label", tr.playing ? "止める（Space）" : "記録を流す（Space）");
  el.querySelector("[data-act=tspeed]").textContent = `×${tr.speed}`;
  el.querySelector(".cap .h").innerHTML = `<span class="no">${esc(cap.no)}</span><span class="verb">${esc(cap.kind)}</span><span class="ft">${esc(cap.main)}${cap.node && (D.NODES[cap.node]?.title || cap.node) !== cap.main ? `　→ ${esc(D.NODES[cap.node]?.title || cap.node)}` : ""}</span><span class="who"><span class="tdot" style="background:${TR.threadColor(e.thread, darkMq.matches)}"></span>${esc(cap.who)}・${esc(cap.instr)}</span>`;
  timeline.dark = darkMq.matches;
  timeline.set(tr.i);
}
function leaveTraceBar() {
  const el = $("#player");
  el.classList.remove("tbar");
  timeline = null;
}

function renderHelp() {
  const el = $("#help");
  el.hidden = !state.help;
  $("#help-btn").setAttribute("aria-expanded", state.help ? "true" : "false");
  if (!state.help) return;
  const kinds = ["call", "syscall", "return", "msg", "signal", "data"];
  el.innerHTML = `<h3>使い方</h3><dl>
  <dt>← →</dt><dd>手順を 1 つずつ進める・戻す</dd>
  <dt>Space</dt><dd>順に流す・止める</dd>
  <dt>クリック</dt><dd>積み木の説明を右に出し、そこへ寄る</dd>
  <dt>ダブルクリック・Enter</dt><dd>中の紙がある積み木なら、中へ入る</dd>
  <dt>Esc</dt><dd>説明を閉じる・紙の外へ戻る</dd>
  <dt>F</dt><dd>動く要求をカメラで追いかける</dd>
  <dt>ドラッグ</dt><dd>回す（右ドラッグ・Shift で平行移動、ホイールで寄る）</dd>
  <dt>0</dt><dd>全体を見る</dd></dl>
  <div class="legend">${kinds.map((k) => `<div>${P.kindIcon(k)}<span>${esc(D.STEP_KIND[k])}</span></div>`).join("")}
  <div><svg width="34" height="10"><rect x="8" y="1" width="18" height="8" rx="2" fill="none" stroke="currentColor" stroke-dasharray="3 2"/></svg><span>点線の枠：実行の文脈（誰の代わりに走るか）</span></div></div>`;
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-step], input[data-act]");
  if (!t) return;
  if (t.dataset.flow) return switchFlow(t.dataset.flow);
  if (t.dataset.trace) return switchTrace();
  if (t.dataset.tev != null) { stopTrace(); return setTraceIndex(Number(t.dataset.tev), { jump: true }); }
  if (t.dataset.depth != null) return closePaper(Number(t.dataset.depth));
  if (t.dataset.paper) return openPaper(t.dataset.paper);
  if (t.dataset.goto) {
    stopPlay();
    stopTrace();
    state.mode = "flow";
    const ids = t.dataset.goto.split(">");
    setStack(ids.length === 1 ? pathTo(ids[0]) || ids : ids);
    enterScene({});
    if (t.dataset.gotobox) setTimeout(() => selectBox(t.dataset.gotobox, { focus: true }), 50);
    return;
  }
  if (t.dataset.code) {
    const [path, a, b, hot] = t.dataset.code.split("|");
    return P.showCode(modalEl, path, Number(a) || 0, Number(b) || 0, Number(hot) || 0, "");
  }
  if (t.dataset.node) return showNode(t.dataset.node);
  if (t.dataset.box) return selectBox(t.dataset.box, { focus: true });
  if (t.dataset.step != null) { stopPlay(); state.sel = null; return setStep(Number(t.dataset.step)); }
  switch (t.dataset.act || t.id) {
    case "tprev": stopTrace(); return setTraceIndex(state.tr.i - 1);
    case "tnext": stopTrace(); return setTraceIndex(state.tr.i + 1);
    case "tplay": return state.tr.playing ? stopTrace() : playTrace();
    case "tspeed": state.tr.speed = { 1: 2, 2: 4, 4: 8, 8: 1 }[state.tr.speed]; return renderTraceBar();
    case "prev": stopPlay(); state.sel = null; return prev();
    case "next": stopPlay(); state.sel = null; return next();
    case "play": return togglePlay();
    case "deep": state.deep = t.checked; return;
    case "close-node": return clearSelection();
    case "close-code": modalEl.hidden = true; return;
    case "overview-btn": setFollow(false); return world?.overview({ maxPx: narrowMq.matches ? 40 : 27 });
    case "follow-btn": return setFollow(!state.follow);
    case "help-btn": state.help = !state.help; renderHelp(); refreshObstacles(); return;
  }
});
modalEl.addEventListener("click", (e) => { if (e.target === modalEl) modalEl.hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select")) return;
  if (!modalEl.hidden) { if (e.key === "Escape") modalEl.hidden = true; return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.mode === "trace") {
    const tr = state.tr;
    if (e.key === "ArrowRight") { stopTrace(); setTraceIndex(tr.i + 1); }
    else if (e.key === "ArrowLeft") { stopTrace(); setTraceIndex(tr.i - 1); }
    else if (e.key === " ") { e.preventDefault(); tr.playing ? stopTrace() : playTrace(); }
    else if (e.key === "Escape") { if (state.help) { state.help = false; renderHelp(); } else clearSelection(); }
    else if (e.key === "0" || e.key === "Home") world?.overview();
    else return;
    return;
  }
  const c = cur();
  switch (e.key) {
    case "ArrowRight": stopPlay(); state.sel = null; next(); break;
    case "ArrowLeft": stopPlay(); state.sel = null; prev(); break;
    case " ": e.preventDefault(); togglePlay(); break;
    case "Escape":
      if (state.help) { state.help = false; renderHelp(); }
      else if (state.node || state.sel) clearSelection();
      else if (state.stack.length > 1) closePaper();
      break;
    case "Enter": {
      if (e.target.closest?.("button")) return;
      const sc = c.scene, st = sc.steps[c.step];
      const ids = [state.sel && sc.box[state.sel]?.node, st.ref, sc.box[st.to]?.node, sc.box[st.from]?.node];
      const n = ids.find((id) => id && D.paperOf(id));
      if (n) openPaper(n);
      break;
    }
    case "f": case "F": setFollow(!state.follow); break;
    case "0": case "Home": setFollow(false); world?.overview(); break;
    default: return;
  }
});
darkMq.addEventListener("change", () => {
  document.documentElement.dataset.dark = darkMq.matches ? "1" : "0";
  if (!world) return;
  world.setDark(darkMq.matches);
  if (state.mode === "trace") {
    world.build(state.tr.scene, state.tr.lay, { animate: false });
    buildTraceLabels();
    setTraceIndex(state.tr.i, { jump: true });
    return;
  }
  const c = cur();
  world.build(c.scene, c.lay, { animate: false });
  buildLabels();
  refreshWorldState();
});

// ---------- URL ----------
function updateHash() {
  if (state.mode === "trace") {
    const h = `#trace:${state.tr.i}`;
    if (location.hash !== h) history.replaceState(null, "", h);
    return;
  }
  const ids = state.stack.map((f) => f.scene.id).join(">");
  const h = `#${ids}:${cur().step}${state.sel ? "@" + state.sel : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}
// A path is real when it starts at a flow and every paper in it is inside a block of the scene
// before it (app.tasks is inside both flows, so the URL has to say which).
function validPath(ids) {
  if (!D.FLOWS.some((f) => f.id === ids[0])) return false;
  for (let k = 1; k < ids.length; k++) {
    const parent = D.sceneById(ids[k - 1]);
    if (!parent || !parent.boxes.some((b) => D.paperOf(b.node)?.id === ids[k])) return false;
  }
  return true;
}
function readHash() {
  const m = decodeURIComponent(location.hash.slice(1)).match(/^([^:@]+)(?::(\d+))?(?:@(.+))?$/);
  if (!m) return null;
  const ids = m[1].split(">");
  if (!ids.every((id) => D.sceneById(id))) return null;
  const path = validPath(ids) ? ids : pathTo(ids[ids.length - 1]);
  const step = m[2] != null ? Number(m[2]) : null;
  const sc = D.sceneById((path || ids)[(path || ids).length - 1]);
  return { ids: path || ids, step: step != null && sc.steps[step] ? step : null, sel: m[3] && sc.box[m[3]] ? m[3] : null };
}

// ---------- narrow screens: the player sits under the 3D view, not over it ----------
const narrowMq = window.matchMedia("(max-width: 720px)");
function placePlayer() {
  const player = $("#player");
  if (narrowMq.matches) stageEl.after(player);
  else stageEl.appendChild(player);
  setMargins();
}
// The free part of the stage for the camera: below the title, above the player, right of the
// layer names.
function setMargins() {
  if (!world) {
    if (flat) {
      const sr = stageEl.getBoundingClientRect(), cr = $("#crumbs").getBoundingClientRect(), pr = $("#player").getBoundingClientRect();
      flat.setMargins(narrowMq.matches ? { t: Math.round(cr.bottom - sr.top + 6), b: 8 } : { t: Math.round(cr.bottom - sr.top + 14), b: Math.max(24, Math.round(sr.bottom - pr.top + 12)) });
    }
    return;
  }
  const sr = stageEl.getBoundingClientRect();
  const cr = $("#crumbs").getBoundingClientRect();
  const top = Math.round(cr.bottom - sr.top + 10);
  const pr = $("#player").getBoundingClientRect();
  const bottom = narrowMq.matches ? 58 : Math.max(120, Math.round(sr.bottom - pr.top + 14));
  world.margins = narrowMq.matches ? { l: 12, r: 12, t: top, b: bottom } : { l: 130, r: 20, t: Math.max(80, top), b: bottom };
  refreshObstacles();
}
// On a phone the whole stack is too small to read: frame the current step instead.
function frameView(opts = {}) {
  if (!world) return;
  if (state.mode === "trace") return world.overview({ ...opts, maxPx: narrowMq.matches ? 40 : 27 });
  if (narrowMq.matches) world.frameStep(cur().step, opts);
  else world.overview(opts);
}
narrowMq.addEventListener("change", () => { placePlayer(); frameView(); });

// ---------- start ----------
(async function start() {
  await initWorld();
  placePlayer();
  const tm = location.hash.match(/^#trace(?::(\d+))?$/);
  if (tm) {
    setStack([D.FLOWS[0].id]);
    switchTrace(tm[1] != null ? Number(tm[1]) : 0);
    renderHelp();
    await document.fonts?.ready;
    labels.remeasure();
    return;
  }
  const h = readHash();
  if (h) setStack(h.ids, h.step);
  else setStack([D.FLOWS[0].id]);
  enterScene({ animate: !params.has("still"), intro: !params.has("still") });
  if (h?.sel) selectBox(h.sel, { focus: false });
  renderHelp();
  await document.fonts?.ready;
  labels.remeasure();
  refreshObstacles();
})();

// For screenshots and for poking at the page from the console.
window.atlas3d = {
  get state() { return state; },
  step: (i) => setStep(i),
  next, prev, play, stop: stopPlay,
  open: (nodeId) => openPaper(nodeId),
  close: () => closePaper(),
  select: (boxId, focus = true) => selectBox(boxId, { focus }),
  node: (id) => showNode(id),
  flow: (id) => switchFlow(id),
  trace: (k) => (state.mode === "trace" ? setTraceIndex(k, { jump: true }) : switchTrace(k)),
  tplay: () => playTrace(),
  follow: (on = true) => setFollow(on),
  overview: () => world?.overview({ instant: true }),
  help: (on = true) => { state.help = on; renderHelp(); refreshObstacles(); },
  settle() {
    if (!world) return;
    for (const tw of world.tweens) tw.fn(1), tw.done?.();
    world.tweens = [];
    if (world.camTween) { const c = world.camTween; world.controls.target.copy(c.toT); world.camera.position.copy(c.toP); world.camTween = null; }
    world.controls.update();
  },
  world: () => world,
  labels: () => labels,
};
