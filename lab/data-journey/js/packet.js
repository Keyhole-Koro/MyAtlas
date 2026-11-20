import { h, esc, richText } from "./util.js";
import { uiScene } from "./scene-ui.js";
import { cpuScene } from "./scene-cpu.js";
import { traceStrip } from "./trace.js";
import { mapRef } from "./detail.js";
import { nest, stopFlights } from "./stagekit.js";

// The packet view: the same steps as the table, played as a scene. A step's state
// is built from the start every time (so jumping is exact); stepping forward by one
// also plays that step's movement.
//
// Wide screens see the whole stage (a camera follows the action when it does not fit).
// A phone sees a storyboard: only the places the step uses, stacked in their memory
// bands, so where a value comes from and where it goes are both on screen.
export function createPacket({ A, C, J, root, onStep, onTip, onPlayState, firstPlay }) {
  const cap = root.querySelector("#pkCaption");
  const wrap = root.querySelector("#stageWrap");
  const stage = root.querySelector("#stage");
  const ctl = root.querySelector("#pkControls");
  const tr = root.querySelector("#pkTrace");
  const note = root.querySelector("#pkNote");
  stage.innerHTML = ""; ctl.innerHTML = ""; tr.innerHTML = "";
  wrap.querySelectorAll(".pin").forEach((p) => p.remove());

  const scene = (J.id === "ui" ? uiScene : cpuScene)(A, J);
  stage.style.width = scene.W + "px";
  stage.style.height = scene.H + "px";
  const E = scene.build(stage, { onTip });
  nest(stage);
  E.refresh = () => { if (cur >= 0) go(steps[cur].key, { jump: true }); };
  const steps = J.cols;
  let cur = -1, playing = false, timer = null, speed = 1, scale = 1, board = false;

  // band names that stay on screen when the camera has moved
  const bands = [...stage.querySelectorAll(":scope > .band")];
  const pins = bands.map((b) => {
    const p = h("div", { class: "pin " + [...b.classList].filter((c) => c !== "band" && c !== "gut").join(" ") }, b.dataset.name);
    wrap.appendChild(p);
    return p;
  });

  // ------------------------------------------------------------ controls
  const bFirst = h("button", { class: "icon", title: "最初へ", "aria-label": "最初へ" }, "⏮");
  const bPrev = h("button", { class: "icon", title: "前へ（←）", "aria-label": "前へ" }, "◀");
  const bPlay = h("button", { class: "icon", title: "再生（Space）", "aria-label": "再生" }, "▶");
  const bNext = h("button", { class: "icon", title: "次へ（→）", "aria-label": "次へ" }, "▶▶");
  bNext.style.fontSize = "11px";
  const scrub = h("div", { class: "scrub" }, h("div", { class: "track" }), h("div", { class: "fill" }));
  const sp = h("select", { "aria-label": "速さ" }, h("option", { value: "1.6" }, "ゆっくり"), h("option", { value: "1", selected: "" }, "ふつう"), h("option", { value: "0.6" }, "はやい"));
  sp.addEventListener("change", () => { speed = Number(sp.value); });
  ctl.append(bFirst, bPrev, bPlay, bNext, scrub, h("label", { class: "speed" }, "速さ", sp));
  bFirst.onclick = () => { setPlay(false); go(steps[0].key, { jump: true, user: true }); };
  bPrev.onclick = () => { setPlay(false); if (cur > 0) go(steps[cur - 1].key, { jump: true, user: true }); };
  bNext.onclick = () => { setPlay(false); if (cur < steps.length - 1) go(steps[cur + 1].key, { user: true }); };
  bPlay.onclick = () => setPlay(!playing);

  const ticks = [];
  steps.forEach((c, i) => {
    const t = h("button", { class: "tk" + (c.narrow ? " small" : "") + (c.security ? " sec" : ""), title: `${c.n}. ${c.verb || (c.head || []).join("") || c.label}`, "aria-label": `手順 ${c.n}` });
    t.style.left = pct(i) + "%";
    t.onclick = () => { setPlay(false); go(c.key, { jump: true, user: true }); };
    scrub.appendChild(t);
    ticks.push(t);
  });
  for (const g of scene.groups || []) {
    const i = steps.findIndex((c) => c.key === g.at);
    if (i >= 0) { const gl = h("span", { class: "grp" }, g.t); gl.style.left = pct(i) + "%"; scrub.appendChild(gl); }
  }
  function pct(i) { return steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0; }

  // ------------------------------------------------------------ trace strip (a real run)
  const trace = scene.trace ? traceStrip(A, tr, scene.trace, onTip) : null;
  tr.hidden = !trace;

  // ------------------------------------------------------------ stepping
  function stateAt(i) {
    const S = scene.base();
    for (let k = 0; k <= i; k++) {
      const st = scene.steps[steps[k].key];
      if (st && st.on) st.on(S, k === i);
    }
    return S;
  }

  function go(key, opts = {}) {
    let i = steps.findIndex((c) => c.key === key);
    if (i < 0) i = 0;
    const forward = i === cur + 1 && !opts.jump;
    stopFlights();
    cur = i;
    const S = stateAt(i);
    if (board) layoutBoard(steps[i].key); // first, so the arrows and flights see the final places
    scene.render(E, S);
    if (forward) {
      const st = scene.steps[steps[i].key];
      if (st && st.fx) st.fx(E, S, { speed });
    }
    caption(i);
    // when the camera follows the action, a floating note may be off screen: show it under the stage
    const zoomed = board || wrap.clientWidth / scale < scene.W - 2;
    root.classList.toggle("zoomed", zoomed);
    if (zoomed && S.bubble) { note.hidden = false; note.className = "pk-note " + (S.bubble.cls || ""); note.innerHTML = S.bubble.html; wireNote(); }
    else note.hidden = true;
    ticks.forEach((t, k) => { t.classList.toggle("on", k === i); t.classList.toggle("done", k < i); });
    scrub.querySelector(".fill").style.width = pct(i) + "%";
    if (trace) trace.show(steps[i].key);
    if (!board) camera(S.focus, opts.instant);
    onStep && onStep(steps[i].key, opts.user ? "user" : "auto");
  }
  function wireNote() {
    const b = note.querySelector(".tolink");
    if (b) b.onclick = () => { location.hash = "j=ui&v=packet&c=ui:0"; };
  }

  function caption(i) {
    const c = steps[i];
    cap.innerHTML = "";
    const title = c.verb || (c.head || []).join(" ").replace(/\s+/g, " ") || (c.to && c.to.title) || "";
    const t = h("div", {}, h("div", { class: "t" }, title, h("span", { class: "s lbl", html: richText(A, c.label) })));
    const sub = scene.steps[c.key] && scene.steps[c.key].sub;
    if (sub) t.appendChild(h("div", { class: "s", html: sub }));
    cap.append(h("div", { class: "num" + (c.security ? " sec" : "") }, String(c.n)), t, h("div", { class: "where", html: `地図では<br><b>${esc(mapRef(A, c))}</b>` }));
    cap.classList.toggle("sec", !!c.security);
  }

  // ------------------------------------------------------------ play
  function setPlay(on) {
    playing = on;
    bPlay.textContent = on ? "❚❚" : "▶";
    clearTimeout(timer);
    onPlayState && onPlayState(on);
    if (!on) return;
    // a reader who has not picked a step yet sees the journey from its first step
    if (cur >= steps.length - 1 || (firstPlay && firstPlay())) go(steps[0].key, { jump: true, user: true });
    const next = () => {
      if (!playing) return;
      if (cur >= steps.length - 1) { setPlay(false); return; }
      go(steps[cur + 1].key, { user: true });
      const st = scene.steps[steps[cur].key];
      timer = setTimeout(next, ((st && st.dur) || (steps[cur].narrow ? 1200 : 2400)) * speed);
    };
    timer = setTimeout(next, 900 * speed);
  }

  // ------------------------------------------------------------ fit & camera
  function fit() {
    const ww = wrap.clientWidth;
    const wasBoard = board;
    board = !!scene.board && ww < 740; // the same breakpoint as the phone layout (760px)
    stage.classList.toggle("board", board);
    wrap.classList.toggle("board", board);
    root.classList.toggle("boardmode", board);
    if (board) {
      scale = 1;
      stage.style.transform = "none";
    } else {
      if (wasBoard) unboard();
      scale = Math.min(1, ww / scene.W);
      if (scale < 0.86) scale = 0.86; // keep the type readable and follow the action
      wrap.style.height = Math.round(scene.H * scale) + "px";
      for (const [k, b] of bands.entries()) pins[k].style.top = (Number(b.dataset.y) * scale + 4) + "px";
    }
    if (cur >= 0) go(steps[cur].key, { jump: true, instant: true });
    else if (!board) camera(null, true);
  }
  function camera(focus, instant) {
    const ww = wrap.clientWidth;
    const visible = ww / scale;
    let x = 0;
    if (visible < scene.W - 2 && focus) {
      const mid = (focus[0] + focus[1]) / 2;
      x = focus[1] - focus[0] > visible ? focus[0] - 8 : mid - visible / 2;
      x = Math.max(0, Math.min(scene.W - visible, x));
    } else if (visible >= scene.W) {
      x = -(visible - scene.W) / 2;
    }
    wrap.classList.toggle("panned", x > 4);
    if (instant) stage.style.transition = "none";
    stage.style.transform = `scale(${scale}) translateX(${-x}px)`;
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => (stage.style.transition = "")));
  }

  // ------------------------------------------------------------ the storyboard (phones)
  // The scene lists, for each step, the places it uses; bands keep their order, an
  // unused band shrinks to its name. Places are centred in a column.
  function layoutBoard(key) {
    const sb = scene.board;
    const show = new Set(sb.steps[key] || []);
    const ww = wrap.clientWidth;
    stage.style.width = ww + "px";
    let y = 0;
    const wallAt = [];
    for (const [k, b] of bands.entries()) {
      const ids = sb.bands[k] || [];
      const top = y;
      y += 24;
      const items = ids.filter((id) => show.has(id));
      for (const id of items) {
        const p = E.places[id];
        const [w, hh] = sizeOf(id);
        y += 16;
        Object.assign(p.style, { left: Math.max(4, Math.round((ww - w) / 2)) + "px", top: y + "px", width: w + "px", height: hh + "px" });
        y += hh;
      }
      y += items.length ? 12 : 2;
      b.style.top = top + "px"; b.style.height = (y - top) + "px";
      b.classList.toggle("empty", !items.length);
      if (k < bands.length - 1) wallAt.push(y);
    }
    for (const p of Object.values(E.places)) p.classList.toggle("off", !show.has(p.dataset.place));
    const walls = [...stage.querySelectorAll(":scope > .wall")];
    walls.forEach((w) => {
      const after = Number(w.dataset.after ?? 0);
      w.style.top = (wallAt[after] ?? 0) + "px";
    });
    stage.style.height = y + "px";
    wrap.style.height = y + "px";
    const ov = stage.querySelector(".svgover");
    if (ov) { ov.setAttribute("width", ww); ov.setAttribute("height", y); ov.setAttribute("viewBox", `0 0 ${ww} ${y}`); }
  }
  function sizeOf(id) {
    const sb = scene.board;
    const box = JSON.parse(E.places[id].dataset.box);
    const s = (sb.sizes && sb.sizes[id]) || [box[2], box[3]];
    if (sb.kids && sb.kids[id]) sb.kids[id](E, true);
    return s;
  }
  function unboard() {
    stage.style.width = scene.W + "px";
    stage.style.height = scene.H + "px";
    for (const b of bands) { b.style.top = b.dataset.y + "px"; b.style.height = b.dataset.h + "px"; b.classList.remove("empty"); }
    for (const p of Object.values(E.places)) {
      const [x, y, w, hh] = JSON.parse(p.dataset.box);
      Object.assign(p.style, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px" });
      p.classList.remove("off");
      if (scene.board.kids && scene.board.kids[p.dataset.place]) scene.board.kids[p.dataset.place](E, false);
    }
    stage.querySelectorAll(":scope > .wall").forEach((w) => (w.style.top = w.dataset.y + "px"));
    const ov = stage.querySelector(".svgover");
    if (ov) { ov.setAttribute("width", scene.W); ov.setAttribute("height", scene.H); ov.setAttribute("viewBox", `0 0 ${scene.W} ${scene.H}`); }
  }

  fit();
  return {
    journey: J.id,
    go: (key, o) => go(key || steps[0].key, o),
    play: (on) => setPlay(on),
    fit,
    get index() { return cur; },
    get playing() { return playing; },
  };
}
