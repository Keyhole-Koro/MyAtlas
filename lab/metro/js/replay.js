// 運行記録: the recorded run replayed on the map. A ghost train hops from station to station in the
// order the functions were entered; when two stations share track it rides the track, otherwise it
// jumps (dashed). Events without a station still show in the caption and on the timeline.
import { pointAt } from "./layout.js";

const THREAD_COLOUR = { 3: "#ea6a2a", 0: "#5b6b82", 2: "#8c97a8", "-1": "#b8c0cc" };

export function initReplay(ctx) {
  const { model, scene, svg, esc, fmt, ensureVisible, onOpen } = ctx;
  const tr = model.traces[0];
  const btn = document.querySelector("#replay-btn");
  if (!tr) { btn.hidden = true; return { open: () => {}, close: () => {}, isOpen: () => false }; }

  const events = tr.events;
  const threadName = (t) => tr.threads[String(t)] || `スレッド ${t}`;
  const colour = (t) => THREAD_COLOUR[String(t)] || "#8c97a8";
  const stationOf = (e) => (e.n && model.stations[e.n] ? e.n : null);
  const last = tr.lastInstr || 1;

  // ---------------------------------------------------------------- dock
  const dock = document.createElement("div");
  dock.id = "replay";
  dock.hidden = true;
  const threadsUsed = [...new Set(events.map((e) => e.thread))];
  dock.innerHTML = `
    <div class="rp-main">
      <button class="rp-play" title="再生（Space）" aria-label="再生">▶</button>
      <div class="rp-cap"><div class="rp-l1"></div><div class="rp-l2"></div></div>
      <div class="rp-speed" role="group" aria-label="速さ"><button data-sp="1">1×</button><button data-sp="3" class="on">3×</button><button data-sp="8">8×</button></div>
      <button class="rp-close" title="閉じる（Esc）" aria-label="閉じる">×</button>
    </div>
    <div class="rp-tl" title="押した所へ移る"><svg class="rp-svg" preserveAspectRatio="none"></svg></div>
    <div class="rp-foot"><span class="rp-title">運行記録</span><span class="rp-what" title="「${esc(tr.run.before.title)}」→「${esc(tr.run.after.title)}」">${esc(tr.title)}（${esc(tr.date.slice(0, 10))}）</span>${threadsUsed.map((t) => `<span><i style="background:${colour(t)}"></i>${esc(threadName(t))}</span>`).join("")}<span class="rp-axis">命令数 0 〜 ${fmt(last)}</span></div>`;
  document.querySelector("#map-wrap").append(dock);
  const tl = dock.querySelector(".rp-svg");
  const l1 = dock.querySelector(".rp-l1"), l2 = dock.querySelector(".rp-l2");
  const playBtn = dock.querySelector(".rp-play");

  function drawTimeline() {
    const w = tl.clientWidth || 800, h = 30;
    tl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    let s = `<rect class="rp-bg" x="0" y="0" width="${w}" height="${h}" rx="6"/>`;
    for (const e of events) {
      const x = (e.instr / last) * (w - 8) + 4;
      const on = stationOf(e);
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${on ? 4 : 11}" y2="${on ? 26 : 19}" stroke="${colour(e.thread)}" stroke-width="${on ? 1.6 : 1}" opacity="${on ? 0.95 : 0.55}"/>`;
    }
    s += `<g class="rp-head-g"><line class="rp-ph" x1="0" x2="0" y1="0" y2="${h}"/><circle class="rp-knob" r="5" cy="${h / 2}"/></g>`;
    tl.innerHTML = s;
  }

  // ---------------------------------------------------------------- map layer
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.id = "replay-layer";
  svg.append(layer);

  let i = -1; // current event
  let playing = false, timer = null, speed = 3, moveAnim = null;
  let trail = []; // [{pts, colour, hop}]
  let at = null; // current station id

  const trackBetween = (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const t = scene.tracks.find((x) => x.key === key);
    if (!t) return null;
    return t.a === a ? t.pts : [...t.pts].reverse();
  };
  function drawLayer(marker) {
    let s = "";
    trail.forEach((t, k) => {
      const o = ((k + 1) / trail.length) * 0.75;
      const d = t.pts.map((p, j) => `${j ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
      s += `<path class="rp-trail${t.hop ? " hop" : ""}" d="${d}" stroke="${t.colour}" opacity="${o.toFixed(2)}"/>`;
    });
    if (marker) {
      s += `<g class="rp-ghost" transform="translate(${marker.x.toFixed(1)} ${marker.y.toFixed(1)})"><circle class="rp-pulse" r="15" fill="${marker.colour}"/><circle r="9.5" fill="${marker.colour}" stroke="var(--map)" stroke-width="3"/></g>`;
    }
    layer.innerHTML = s;
  }
  function caption(e) {
    const st = stationOf(e);
    const node = e.n ? model.nodes[e.n] : null;
    let a;
    if (e.ev === "enter") {
      a = `<code>${esc(e.fn)}</code> に入る`;
      if (st) a += `<span class="rp-st">駅 ${esc(model.stations[st].name)}</span>`;
      else if (node) a += `<span class="rp-nost">${esc(node.title)}（地図に駅なし）</span>`;
    } else if (e.ev === "irq") {
      a = `割り込み：<b>${esc((e.cause || []).join("・"))}</b>${e.service ? `（${esc(e.service)}）` : ""}`;
    } else if (e.ev === "switch") {
      a = `スレッドを切り替える → <b>${esc(threadName(e.thread))}</b>`;
    } else if (e.ev === "request") {
      a = `外からの操作：<code>${esc(e.method)}</code>`;
    } else a = esc(e.ev);
    l1.innerHTML = a;
    l2.innerHTML = `<span class="rp-dot" style="background:${colour(e.thread)}"></span>${esc(threadName(e.thread))}${e.program ? `・${esc(e.program)} のコード` : ""}　命令 ${fmt(e.instr)}　<span class="rp-count">${i + 1} / ${events.length}</span>`;
    const g = tl.querySelector(".rp-head-g");
    if (g) {
      const w = tl.clientWidth || 800;
      g.setAttribute("transform", `translate(${((e.instr / last) * (w - 8) + 4).toFixed(1)} 0)`);
    }
  }
  function go(k, animate = true) {
    k = Math.max(0, Math.min(events.length - 1, k));
    const e = events[k];
    const prevAt = at;
    i = k;
    caption(e);
    const st = stationOf(e);
    if (!st) { if (!at) drawLayer(null); return; }
    const c = scene.stations[st];
    const col = colour(e.thread);
    if (prevAt && prevAt !== st) {
      const along = trackBetween(prevAt, st);
      const p0 = scene.stations[prevAt];
      const pts = along || [[p0.x, p0.y], [c.x, c.y]];
      trail.push({ pts, colour: col, hop: !along });
      if (trail.length > 7) trail.shift();
      at = st;
      cancelAnimationFrame(moveAnim);
      const ms = animate ? Math.min(420, 900 / speed + 80) : 0;
      if (!ms) { drawLayer({ x: c.x, y: c.y, colour: col }); }
      else {
        const t0 = performance.now();
        const step = (now) => {
          const f = Math.min(1, (now - t0) / ms);
          const [x, y] = pointAt(pts, 1 - Math.pow(1 - f, 3));
          drawLayer({ x, y, colour: col });
          if (f < 1) moveAnim = requestAnimationFrame(step);
        };
        moveAnim = requestAnimationFrame(step);
      }
      ensureVisible([[c.x, c.y]]);
    } else {
      at = st;
      drawLayer({ x: c.x, y: c.y, colour: col });
    }
  }
  function seek(k) {
    // rebuild the trail up to k without animation
    trail = [];
    at = null;
    const start = Math.max(0, k - 40);
    for (let j = start; j <= k; j++) {
      const st = stationOf(events[j]);
      if (!st) continue;
      if (at && at !== st) {
        const along = trackBetween(at, st);
        const p0 = scene.stations[at], c = scene.stations[st];
        trail.push({ pts: along || [[p0.x, p0.y], [c.x, c.y]], colour: colour(events[j].thread), hop: !along });
        if (trail.length > 7) trail.shift();
      }
      at = st;
    }
    i = k;
    caption(events[k]);
    if (at) { const c = scene.stations[at]; drawLayer({ x: c.x, y: c.y, colour: colour(events[k].thread) }); }
    else drawLayer(null);
  }
  function tick() {
    if (!playing) return;
    if (i >= events.length - 1) { pause(); return; }
    go(i + 1);
    // stations get a beat; events off the map pass quickly
    const next = events[i + 1];
    const wait = (next && stationOf(next) ? 700 : 220) / speed;
    timer = setTimeout(tick, wait);
  }
  function play() {
    if (i >= events.length - 1) seek(0);
    playing = true;
    playBtn.textContent = "❚❚";
    playBtn.setAttribute("aria-label", "止める");
    tick();
  }
  function pause() {
    playing = false;
    clearTimeout(timer);
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "再生");
  }
  function open() {
    onOpen?.();
    dock.hidden = false;
    btn.setAttribute("aria-pressed", "true");
    document.body.classList.add("replaying");
    drawTimeline();
    if (i < 0) seek(0); else seek(i);
  }
  function close() {
    pause();
    dock.hidden = true;
    btn.setAttribute("aria-pressed", "false");
    document.body.classList.remove("replaying");
    layer.innerHTML = "";
  }
  btn.addEventListener("click", () => (dock.hidden ? open() : close()));
  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  dock.querySelector(".rp-close").addEventListener("click", close);
  dock.querySelector(".rp-speed").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sp]");
    if (!b) return;
    speed = Number(b.dataset.sp);
    dock.querySelectorAll(".rp-speed button").forEach((x) => x.classList.toggle("on", x === b));
  });
  const seekAt = (clientX) => {
    const r = tl.getBoundingClientRect();
    const instr = ((clientX - r.left - 4) / (r.width - 8)) * last;
    let best = 0;
    for (let k = 0; k < events.length; k++) if (Math.abs(events[k].instr - instr) < Math.abs(events[best].instr - instr)) best = k;
    seek(best);
  };
  let dragging = false;
  tl.addEventListener("pointerdown", (e) => { dragging = true; tl.setPointerCapture(e.pointerId); pause(); seekAt(e.clientX); });
  tl.addEventListener("pointermove", (e) => { if (dragging) seekAt(e.clientX); });
  tl.addEventListener("pointerup", () => { dragging = false; });
  new ResizeObserver(() => { if (!dock.hidden) { drawTimeline(); if (i >= 0) caption(events[i]); } }).observe(dock);

  return {
    open, close, isOpen: () => !dock.hidden,
    key(e) {
      if (dock.hidden) return false;
      if (e.key === " ") { e.preventDefault(); playing ? pause() : play(); return true; }
      if (e.key === "ArrowRight") { e.preventDefault(); pause(); go(i + 1); return true; }
      if (e.key === "ArrowLeft") { e.preventDefault(); pause(); seek(Math.max(0, i - 1)); return true; }
      if (e.key === "Escape") { close(); return true; }
      return false;
    },
    seek, play, pause,
  };
}
