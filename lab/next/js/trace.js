// 記録: the recorded run (Editor で「x」を打った 1 回) in time, from trace-timeline: a flame chart per
// thread on an axis of instructions (the stretches nothing recorded was open are squeezed), waiting
// drawn hatched, the scenes (場面) of the story, the path from the key to the DOM, and its corrected
// reading of OS_CALL. The step chosen elsewhere lights the calls that are that step, where the record can say.
(function () {
  'use strict';
  const NX = window.NX, { A, esc, $, TR } = NX;
  const TM = window.TRACEM;
  const V = (NX.trace = {});
  const root = $('#v-trace');
  const phone = () => matchMedia('(max-width: 760px)').matches;
  let M = null, S = null, built = false;

  root.innerHTML = `
    <div class="tr-bar">
      <div class="tr-title"><span class="eyebrow" id="trEyebrow"></span><h2 id="trTitle"></h2></div>
      <dl class="tr-diff" id="trDiff"></dl>
    </div>
    <div class="tr-scenes scroll" id="trScenes" aria-label="場面"></div>
    <div class="tr-main">
      <div class="tr-left">
        <div class="tr-ovwrap"><canvas id="trOv" aria-label="記録の全体。四角が今見ている範囲。押すとそこへ"></canvas></div>
        <div class="tr-tools">
          <span class="tr-tk">呼び出し</span><div class="seg" id="trFold"><button type="button" data-fold="1" aria-pressed="true">要所だけ</button><button type="button" data-fold="0" aria-pressed="false">すべて</button></div>
          <span class="tr-tk">時間の軸</span><div class="seg" id="trAxis"><button type="button" data-axis="1" aria-pressed="true">記録外を詰める</button><button type="button" data-axis="0" aria-pressed="false">実際の長さ</button></div>
          <span class="tr-zoom"><button class="btn small" type="button" data-z="fit">全体</button><button class="btn icon small" type="button" data-z="out" aria-label="縮小">−</button><button class="btn icon small" type="button" data-z="in" aria-label="拡大">+</button></span>
        </div>
        <div class="tr-legend" id="trLegend"></div>
        <div class="tr-canvas scroll" id="trWrap"><canvas id="trCanvas"></canvas></div>
        <p class="tr-hint">ホイールで拡大・ドラッグで移動・呼び出しを押すと説明。色は層、濃いのは地図の節、淡いのは地図に無い関数、斜線は待ち。</p>
      </div>
      <aside class="tr-side scroll" id="trSide" aria-label="記録の説明"></aside>
    </div>`;
  const cv = $('#trCanvas'), ctx = cv.getContext('2d');
  const ov = $('#trOv'), octx = ov.getContext('2d');
  const OV = { w: 600, h: 36 };

  // ---------------------------------------------------------------- the model and the axis (trace-timeline)
  let AX = null, mix = 1, LANDMARK = null, PINS = null, laneSlices = null;
  const state = { v0: 0, v1: 1, fold: true, sel: null, hover: null, path: 0, focus: null };
  const GAP_MIN = 15000, GAP_KEEP = 600, GAP_W = 7000, PHASE_MIN = 0.05;
  function build() {
    M = NX.traceModel();
    S = M.slices;
    const runs = [];
    for (const [a, b, id] of M.segs) {
      if (id >= 0) continue;
      const last = runs[runs.length - 1];
      if (last && last[1] === a) last[1] = b; else runs.push([a, b]);
    }
    const NONE_RUNS = runs.filter(([a, b]) => b - a >= GAP_MIN);
    const pts = [0];
    for (const [a, b] of NONE_RUNS) pts.push(a + GAP_KEEP, b - GAP_KEEP);
    pts.push(M.END);
    const cuts = M.phases.map((p) => p.start).filter((x) => x > 0 && x < M.END);
    const pieces = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (i % 2 === 1) { pieces.push({ a, b, gap: true, run: NONE_RUNS[(i - 1) / 2] }); continue; }
      let x = a;
      for (const c of cuts) if (c > x && c < b) { pieces.push({ a: x, b: c, gap: false }); x = c; }
      pieces.push({ a: x, b, gap: false });
    }
    const phaseAt = (i) => M.phases.find((p) => i >= p.start && i < p.end) || M.phases[M.phases.length - 1];
    const width = (g) => (g.gap ? GAP_W : g.b - g.a);
    const total = pieces.reduce((t, g) => t + width(g), 0);
    const per = new Map();
    for (const g of pieces) { const q = per.get(phaseAt(g.a).num) || { all: 0, kept: 0 }; q.all += width(g); if (!g.gap) q.kept += g.b - g.a; per.set(phaseAt(g.a).num, q); }
    const stretch = new Map([...per].map(([num, q]) => [num, q.all < PHASE_MIN * total && q.kept > 0 ? (q.kept + PHASE_MIN * total - q.all) / q.kept : 1]));
    let vc = 0;
    const segs = pieces.map((g) => { const w = g.gap ? GAP_W : (g.b - g.a) * stretch.get(phaseAt(g.a).num); const s = { ...g, ca: vc, cb: vc + w }; vc += w; return s; });
    AX = { segs, END: M.END, CEND: vc };
    LANDMARK = new Map(M.landmarks.map((l) => [l.id, l]));
    PINS = new Map(M.threads.map((t) => [t.tid, M.landmarks.filter((l) => S[l.id].tid === t.tid)]));
    laneSlices = new Map(M.threads.map((t) => [t.tid, S.filter((s) => s.tid === t.tid).sort((a, b) => a.depth - b.depth || a.start - b.start)]));
    state.v0 = 0; state.v1 = vTotal();
    built = true;
  }
  const segAt = (i) => { for (const g of AX.segs) if (i <= g.b) return g; return AX.segs[AX.segs.length - 1]; };
  function vOf(i) { const g = segAt(i); const c = g.ca + (g.b > g.a ? (i - g.a) / (g.b - g.a) : 0) * (g.cb - g.ca); return i + mix * (c - i); }
  function iOf(v) {
    for (const g of AX.segs) {
      const va = g.a + mix * (g.ca - g.a), vb = g.b + mix * (g.cb - g.b);
      if (v <= vb || g === AX.segs[AX.segs.length - 1]) return g.a + (vb > va ? Math.max(0, v - va) / (vb - va) : 0) * (g.b - g.a);
    }
    return M.END;
  }
  const vTotal = () => AX.END + mix * (AX.CEND - AX.END);
  const shown = (s) => !state.fold || s.kept;
  const dep = (s) => (state.fold ? s.fdepth : s.depth);
  const rowsOf = (t) => Math.max(1, state.fold ? t.maxFDepth : t.maxDepth);
  function visOf(s) { while (s && !shown(s)) s = s.parent === null ? null : S[s.parent]; return s; }

  // ---------------------------------------------------------------- layout and colours
  const G = { gutter: 176, ruler: 28, story: 24, rowH: 20, runH: 5, laneGap: 10, pin: 24, right: 12 };
  let W = 800, Hh = 400, lanes = [];
  const C = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['surface', 'surface-2', 'surface-3', 'text', 'text-2', 'text-3', 'border', 'border-strong', 'accent', 'accent-soft', 'accent-text', 'l-app', 'l-lib', 'l-os', 'l-kernel', 'l-emu', 'th-app', 'th-k1', 'th-k2', 'th-idle']) C[k] = cs.getPropertyValue('--' + k).trim();
    C.dark = document.documentElement.getAttribute('data-theme') === 'dark';
  }
  const rgb = (c) => {
    if (c.startsWith('#')) { const x = c.slice(1); const n = parseInt(x.length === 3 ? x.replace(/./g, '$&$&') : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    return (c.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  };
  const alpha = (c, a) => `rgba(${rgb(c).join(',')},${a})`;
  const mixC = (a, b, t) => { const A1 = rgb(a), B1 = rgb(b); return `rgb(${A1.map((v, i) => Math.round(v + (B1[i] - v) * t)).join(',')})`; };
  const layerColor = (l) => C['l-' + l] || C['text-3'];
  const fillOf = (s) => (s.inferred ? mixC(layerColor(s.layer), C.surface, C.dark ? 0.62 : 0.66) : layerColor(s.layer));
  function layout() {
    const wrap = $('#trWrap');
    const narrow = wrap.clientWidth < 620;
    G.narrow = narrow;
    G.gutter = narrow ? 10 : 176;
    G.head = narrow ? 20 : 0;
    W = wrap.clientWidth;
    G.rowH = state.fold ? 20 : 17;
    let y = G.ruler + G.story + 8;
    lanes = M.threads.map((t) => {
      const rows = rowsOf(t);
      const top = y + G.head;
      const pins = PINS.get(t.tid).length ? G.pin : 0;
      const minH = narrow ? 0 : 74;
      const lane = { t, y, pinY: top + 1, runY: top + pins + 3, rowsY: top + pins + 3 + G.runH + 6, h: G.head + Math.max(minH, pins + 3 + G.runH + 6 + rows * G.rowH + 8) };
      lane.rowH = G.rowH;
      y += lane.h + G.laneGap;
      return lane;
    });
    Hh = y + 4;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    OV.w = Math.max(100, ov.parentElement.clientWidth - 24);
    ov.width = Math.round(OV.w * dpr); ov.height = Math.round(OV.h * dpr);
    ov.style.width = OV.w + 'px'; ov.style.height = OV.h + 'px';
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const plotX = () => G.gutter, plotW = () => W - G.gutter - G.right;
  const xOfV = (v) => plotX() + ((v - state.v0) / (state.v1 - state.v0)) * plotW();
  const xOf = (i) => xOfV(vOf(i));
  const vOfX = (x) => state.v0 + ((x - plotX()) / plotW()) * (state.v1 - state.v0);
  const laneOf = (tid) => lanes.find((l) => l.t.tid === tid);
  const rowY = (lane, d) => lane.rowsY + d * lane.rowH;
  const tw = new Map();
  function textW(s, font) { const k = font + '|' + s; let w = tw.get(k); if (w === undefined) { ctx.font = font; w = ctx.measureText(s).width; tw.set(k, w); } return w; }
  function clip(s, max, font) {
    if (textW(s, font) <= max) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (textW(s.slice(0, mid) + '…', font) <= max) lo = mid; else hi = mid - 1; }
    return lo >= 3 ? s.slice(0, lo) + '…' : null;
  }
  const F = { label: () => `600 12px ${NX.FONT}`, labelLight: () => `12px ${NX.FONT}`, sub: () => `11px ${NX.FONT}`, tick: () => `11px ${NX.FONT}`, gname: () => `650 13px ${NX.MONO}`, gsub: () => `11px ${NX.FONT}`, pin: () => `650 12px ${NX.FONT}` };
  function roundRect(x, y, w, h, r) { ctx.beginPath(); if (r <= 0 || w < 2 * r) { ctx.rect(x, y, w, h); return; } ctx.roundRect(x, y, w, h, r); }
  let hatch = null;
  function makeHatch() {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d');
    g.strokeStyle = alpha(C['text-2'], C.dark ? 0.32 : 0.26); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
    hatch = ctx.createPattern(c, 'repeat');
  }

  // ---------------------------------------------------------------- drawing
  let raf = 0;
  const requestDraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const TAIL = 24;
  const drawnEnd = (s) => (s.abandoned ? s.lastOn : s.end);
  function sliceX(s) { const x0 = xOf(s.start), x1 = xOf(drawnEnd(s)); return [x0, Math.max(x1, x0 + (LANDMARK.has(s.id) || s.layer === 'app' ? 3 : 1))]; }
  let labelBoxes = [];   // where the calls' names were written: the arrows' names keep off them
  function draw() {
    labelBoxes = [];
    ctx.clearRect(0, 0, W, Hh);
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, Hh);
    const i0 = iOf(state.v0), i1 = iOf(state.v1);
    drawGaps(i0, i1);
    ctx.save(); ctx.beginPath(); ctx.rect(plotX(), 0, plotW(), Hh); ctx.clip();
    for (const lane of lanes) drawLane(lane, i0, i1);
    const geo = drawLinks(i0, i1);          // the arrows, under the names
    for (const lane of lanes) drawLabels(lane, i0, i1);
    for (const lane of lanes) placePins(lane);
    drawLinkNames(geo);                       // where no pin, name or other arrow's name is
    for (const lane of lanes) paintPins(lane);
    for (const lane of lanes) drawRings(lane, i0, i1);
    ctx.restore();
    drawGutter();
    drawStory(i0, i1);
    drawRuler(i0, i1);
    drawOverview();
  }
  function drawGaps(i0, i1) {
    if (mix <= 0.02) return;
    for (const g of AX.segs) {
      if (!g.gap || g.b < i0 || g.a > i1) continue;
      const xa = xOf(g.a), xb = xOf(g.b);
      if (xb - xa < 1) continue;
      ctx.save(); ctx.globalAlpha = mix;
      ctx.fillStyle = C['surface-2']; ctx.fillRect(xa, G.ruler, xb - xa, Hh - G.ruler);
      ctx.strokeStyle = C['border-strong']; ctx.lineWidth = 1;
      const x = (xa + xb) / 2;
      ctx.beginPath(); let y = G.ruler + 2, k = 0; ctx.moveTo(x, y);
      while (y < Hh - 2) { y += 4; k ^= 1; ctx.lineTo(x + (k ? 2.5 : -2.5), Math.min(y, Hh - 2)); }
      ctx.stroke(); ctx.restore();
    }
  }
  function drawLane(lane, i0, i1) {
    const { t } = lane;
    const px = plotX(), pw = plotW();
    ctx.fillStyle = C.border; ctx.fillRect(px, lane.y + lane.h + G.laneGap / 2, pw, 1);
    ctx.fillStyle = C['text-3'];
    for (const [a, b] of t.runs) {
      if (b < i0 || a > i1) continue;
      const xa = Math.max(px - 2, xOf(a)), xb = Math.min(px + pw + 2, xOf(b));
      roundRect(xa, lane.runY, Math.max(1.5, xb - xa), G.runH, 2.5); ctx.fill();
    }
    const focus = state.focus;
    for (const s of visibleIn(lane, i0, i1)) drawSlice(lane, s, focus && !focus.vis.has(s.id));
  }
  const visibleIn = (lane, i0, i1) => laneSlices.get(lane.t.tid).filter((s) => shown(s) && s.end >= i0 && s.start <= i1);
  function drawLabels(lane, i0, i1) {
    const focus = state.focus;
    for (const s of visibleIn(lane, i0, i1)) drawLabel(lane, s, focus && !focus.vis.has(s.id));
  }
  function drawRings(lane, i0, i1) {
    const focus = state.focus;
    for (const s of visibleIn(lane, i0, i1)) {
      const isSel = state.sel === s.id, isHover = state.hover && state.hover.id === s.id, isFocus = focus && focus.vis.has(s.id);
      if (!isSel && !isHover && !isFocus) continue;
      const [x0, x1] = sliceX(s), y = rowY(lane, dep(s)), hh = lane.rowH - 2;
      ctx.strokeStyle = isSel ? C.text : C.accent; ctx.lineWidth = isSel ? 2 : isFocus ? 2 : 1;
      roundRect(x0 - 1.5, y - 1.5, Math.max(4, x1 - x0 + 3), hh + 3, 4); ctx.stroke();
    }
  }
  // how far a thing out of focus fades: dark surfaces need more to stay readable
  const DIM = () => (C.dark ? { slice: 0.4, label: 0.62, pin: 0.5 } : { slice: 0.22, label: 0.5, pin: 0.38 });
  function drawSlice(lane, s, dim) {
    const [x0, x1] = sliceX(s);
    const y = rowY(lane, dep(s)), hh = lane.rowH - 2;
    const fill = fillOf(s), w = x1 - x0;
    ctx.globalAlpha = dim ? DIM().slice : 1;
    const r = w < 6 ? 0 : 3;
    if (s.cpuIn >= drawnEnd(s) - s.start) { ctx.fillStyle = fill; roundRect(x0, y, w, hh, r); ctx.fill(); }
    else {
      ctx.fillStyle = alpha(fill, C.dark ? 0.22 : 0.24); roundRect(x0, y, w, hh, r); ctx.fill();
      if (hatch) { ctx.fillStyle = hatch; roundRect(x0, y, w, hh, r); ctx.fill(); }
      ctx.fillStyle = fill;
      for (const [a, b] of s.on) { const xa = Math.max(x0, xOf(a)), xb = Math.min(x1, xOf(b)); if (xb - xa > 0.05) ctx.fillRect(xa, y, Math.max(1, xb - xa), hh); }
    }
    if (s.abandoned) {
      const g = ctx.createLinearGradient(x1, 0, x1 + TAIL, 0);
      g.addColorStop(0, alpha(fill, 0.5)); g.addColorStop(1, alpha(fill, 0));
      ctx.fillStyle = g; ctx.fillRect(x1, y, TAIL, hh);
    }
    if (LANDMARK.has(s.id) && !dim) { ctx.strokeStyle = C['text-2']; ctx.lineWidth = 1.2; roundRect(x0 - 0.5, y - 0.5, w + 1, hh + 1, r); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  const short = (x) => (x && x.includes('.') ? x.slice(x.lastIndexOf('.') + 1) : x);
  function labelCands(s) {
    if (s.kind === 'irq') return [{ main: s.label }, { main: s.label.replace('割り込み・', '').replace(/^OS_CALL /, '') }];
    const out = [];
    if (s.n && s.label !== s.fn) out.push({ main: s.label, sub: s.fn });
    out.push({ main: s.label });
    if (short(s.label) !== s.label) out.push({ main: short(s.label) });
    return out;
  }
  function drawLabel(lane, s, dim) {
    const [x0, x1] = sliceX(s);
    const vx0 = Math.max(x0, plotX()), vx1 = Math.min(x1, plotX() + plotW());
    const avail = vx1 - vx0 - 10;
    if (avail < 22) return;
    const font = s.inferred ? F.labelLight() : F.label();
    const top = rowY(lane, dep(s)), y = top + (lane.rowH - 2) / 2 + 0.5, tx = vx0 + 5;
    let text = null, sub = null;
    for (const c of labelCands(s)) {
      const wm = textW(c.main, font);
      if (c.sub) { if (wm + 8 + textW(c.sub, F.sub()) <= avail) { text = c.main; sub = c.sub; break; } continue; }
      if (wm <= avail) { text = c.main; break; }
    }
    if (!text) { const cs = labelCands(s); text = clip(cs[cs.length - 1].main, avail, font); }
    if (!text) return;
    ctx.globalAlpha = dim ? DIM().label : 1;
    ctx.textBaseline = 'middle';
    const whole = s.cpuIn >= drawnEnd(s) - s.start;
    if (!whole) {
      const w0 = textW(text, font) + (sub ? 8 + textW(sub, F.sub()) : 0);
      ctx.fillStyle = alpha(C.surface, C.dark ? 0.84 : 0.82); roundRect(tx - 3, top + 2, Math.min(w0 + 6, vx1 - tx + 2), lane.rowH - 6, 3); ctx.fill();
    }
    ctx.font = font; ctx.fillStyle = whole && !s.inferred ? '#ffffff' : C.text; ctx.fillText(text, tx, y);
    if (sub) { ctx.font = F.sub(); ctx.fillStyle = whole && !s.inferred ? 'rgba(255,255,255,.78)' : C['text-2']; ctx.fillText(sub, tx + textW(text, font) + 8, y); }
    ctx.globalAlpha = 1;
    labelBoxes.push([tx - 3, top + 1, textW(text, font) + (sub ? 8 + textW(sub, F.sub()) : 0) + 6, lane.rowH - 4]);
  }
  const PIN_H = 18;
  function placePins(lane) {
    const pins = PINS.get(lane.t.tid);
    for (const l of pins) l.box = null;
    const px = plotX(), pw = plotW(), y = lane.pinY;
    let right = -1e9;
    for (const l of pins) {
      const s = S[l.id];
      const [x0, x1] = sliceX(s);
      if (x1 < px - 2 || x0 > px + pw + 2) continue;
      const ax = Math.min(Math.max(x0 + Math.min(1.5, (x1 - x0) / 2), px + 1), px + pw - 1);
      const next = pins.find((q) => S[q.id].start > s.start && sliceX(S[q.id])[0] > x0 + 4);
      const from = Math.max(px + 1, ax - 9, right + 6);
      const limit = (next ? Math.max(sliceX(S[next.id])[0] - 10, from + 60) : px + pw) - from;
      let parts = [], w = 22;
      for (const c of l.sub ? [[l.text, l.sub], [l.text]] : [[l.text]]) {
        const ww = 21 + textW(c[0], F.pin()) + (c[1] ? 6 + textW(c[1], F.sub()) : 0) + 9;
        if (ww <= limit) { parts = c; w = ww; break; }
      }
      const left = Math.min(from, px + pw - w);
      right = left + w;
      l.box = [left, y, w, PIN_H]; l.parts = parts; l.ax = ax;
    }
  }
  function paintPins(lane) {
    for (const l of PINS.get(lane.t.tid)) {
      if (!l.box) continue;
      const s = S[l.id], [left, y, w] = l.box, ax = l.ax, parts = l.parts;
      const faint = state.focus && !state.focus.vis.has(s.id);
      ctx.save(); ctx.globalAlpha = faint ? DIM().pin : 1;
      const ty = rowY(lane, dep(visOf(s)));
      ctx.strokeStyle = C['text-2']; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(ax) + 0.5, y + PIN_H); ctx.lineTo(Math.round(ax) + 0.5, ty); ctx.stroke();
      if (Math.abs(left + 9 - ax) > 1) { ctx.beginPath(); ctx.moveTo(left + 9, y + PIN_H - 2); ctx.lineTo(Math.round(ax) + 0.5, y + PIN_H); ctx.stroke(); }
      ctx.fillStyle = C.surface; ctx.strokeStyle = C['border-strong'];
      roundRect(left, y, w, PIN_H, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C['text-2']; ctx.beginPath(); ctx.arc(left + 9, y + PIN_H / 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.surface; ctx.font = `700 11px ${NX.FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(l.phase ?? ''), left + 9, y + PIN_H / 2 + 0.5); ctx.textAlign = 'left';
      let tx = left + 21;
      if (parts[0]) { ctx.font = l.kind === 'app' ? `650 12px ${NX.MONO}` : F.pin(); ctx.fillStyle = C.text; ctx.fillText(parts[0], tx, y + PIN_H / 2 + 0.5); tx += textW(parts[0], F.pin()) + 6; }
      if (parts[1]) { ctx.font = F.sub(); ctx.fillStyle = C['text-2']; ctx.fillText(parts[1], tx, y + PIN_H / 2 + 0.5); }
      ctx.restore();
    }
  }
  const LINK_NAME = { queue: '要求', reply: '返事', event: 'イベント' };
  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
  function linkGeom(l) {
    const a = S[l.from], b = S[l.to], la = laneOf(a.tid), lb = laneOf(b.tid);
    const x0 = xOf(a.end), x1 = xOf(b.start);
    const va = visOf(a), vb = visOf(b);
    const y0 = rowY(la, dep(va)) + (la.rowH - 2) / 2, y1 = rowY(lb, dep(vb)) + (lb.rowH - 2) / 2;
    const dx = Math.max(30, Math.abs(x1 - x0) * 0.45);
    return { x0, y0, x1, y1, c1x: x0 + dx, c1y: y0, c2x: x1 - dx, c2y: y1 };
  }
  // the arrows between threads (a request through the ring, a reply, an event), drawn under the names
  function drawLinks(i0, i1) {
    const f = state.focus, out = [];
    M.links.forEach((l, k) => {
      const a = S[l.from], b = S[l.to];
      if ((b.start < i0 || a.end > i1) && !(a.end < i1 && b.start > i0)) return;
      const g = linkGeom(l);
      const strong = f && f.links.has(k), faint = f && !strong;
      ctx.save();
      ctx.globalAlpha = faint ? 0.14 : strong ? 1 : 0.6;
      ctx.strokeStyle = C.accent; ctx.lineWidth = strong ? 2.4 : 1.5;
      ctx.beginPath(); ctx.moveTo(g.x0, g.y0); ctx.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.x1, g.y1); ctx.stroke();
      const ang = Math.atan2(g.y1 - g.c2y, g.x1 - g.c2x);
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.moveTo(g.x1, g.y1);
      ctx.lineTo(g.x1 - 8 * Math.cos(ang - 0.42), g.y1 - 8 * Math.sin(ang - 0.42)); ctx.lineTo(g.x1 - 8 * Math.cos(ang + 0.42), g.y1 - 8 * Math.sin(ang + 0.42)); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(g.x0, g.y0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      out.push({ l, g, faint });
    });
    return out;
  }
  // An arrow's name sits on its curve where there is room: not on a pin, a call's name or another
  // arrow's name (trace-timeline's rule); where there is no such room, the arrow goes unnamed.
  const onPin = (x, y, w, h) => M.landmarks.some((l) => l.box && x < l.box[0] + l.box[2] + 4 && x + w > l.box[0] - 4 && y < l.box[1] + l.box[3] + 3 && y + h > l.box[1] - 3);
  let lastPills = [];
  function drawLinkNames(geo) {
    const pills = (lastPills = []);
    for (const { l, g, faint } of geo) {
      if (faint || Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 46) continue;
      const text = LINK_NAME[l.kind], font = `650 11px ${NX.FONT}`, w = textW(text, font) + 12;
      const spots = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8].map((t) => [bez(g.x0, g.c1x, g.c2x, g.x1, t), bez(g.y0, g.c1y, g.c2y, g.y1, t)]);
      const ok = ([mx, my]) => !(mx - w / 2 < plotX() + 2 || mx + w / 2 > plotX() + plotW() - 2 || onPin(mx - w / 2, my - 9, w, 18)
        || pills.some(([x, y, pw]) => Math.abs(x - mx) < (w + pw) / 2 + 4 && Math.abs(y - my) < 20));
      const clear = ([mx, my]) => !labelBoxes.some((b) => mx - w / 2 < b[0] + b[2] && mx + w / 2 > b[0] && my - 9 < b[1] + b[3] && my + 9 > b[1]);
      const at = spots.find((p) => ok(p) && clear(p));
      if (!at) continue;
      const [mx, my] = at;
      pills.push([mx, my, w]);
      ctx.fillStyle = C.surface; ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
      roundRect(mx - w / 2, my - 9, w, 18, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, mx, my + 0.5); ctx.textAlign = 'left';
    }
  }
  // ---------------------------------------------------------------- the whole record at a glance (trace-timeline's overview)
  const ovX = (i) => (vOf(i) / vTotal()) * OV.w;
  function drawOverview() {
    const g = octx, w = OV.w;
    g.clearRect(0, 0, w, OV.h);
    for (const p of M.phases) {
      const xa = ovX(p.start), xb = ovX(p.end), on = state.phase === p.num;
      g.fillStyle = on ? C.accent : p.num % 2 ? C['surface-3'] : C['surface-2'];
      g.fillRect(xa + 0.5, 1, Math.max(1, xb - xa - 1), 12);
      const t = p.after ? 'その後' : String(p.num), font = `600 11px ${NX.FONT}`;
      g.font = font;
      const tw2 = g.measureText(t).width;
      if (tw2 + 6 < xb - xa) { g.fillStyle = on ? C['accent-text'] : C['text-2']; g.textBaseline = 'middle'; g.fillText(t, (xa + xb) / 2 - tw2 / 2, 7.5); }
    }
    for (const [a, b, id] of M.segs) {
      const xa = ovX(a), xb = ovX(b);
      g.fillStyle = id < 0 ? C['surface-3'] : layerColor(S[id].layer);
      g.fillRect(xa, 16, Math.max(0.6, xb - xa), 12);
    }
    if (state.focus) {
      g.fillStyle = C.accent;
      for (const id of state.focus.vis) { const s = S[id]; g.fillRect(ovX(s.start) - 0.5, 31, Math.max(1.5, ovX(drawnEnd(s)) - ovX(s.start)), 4); }
    }
    const xa = (state.v0 / vTotal()) * w, xb = (state.v1 / vTotal()) * w;
    g.fillStyle = alpha(C.surface, C.dark ? 0.55 : 0.6);
    g.fillRect(0, 14, Math.max(0, xa), 16); g.fillRect(xb, 14, Math.max(0, w - xb), 16);
    g.strokeStyle = C.text; g.lineWidth = 1.5;
    g.strokeRect(Math.max(0.75, xa), 14.75, Math.max(2, Math.min(w - 0.75, xb) - Math.max(0.75, xa)), 14.5);
  }
  (function wireOverview() {
    let drag = null;
    ov.addEventListener('pointerdown', (e) => {
      const T = vTotal(), x = e.offsetX, xa = (state.v0 / T) * OV.w, xb = (state.v1 / T) * OV.w;
      if (x < xa - 2 || x > xb + 2) { const span = state.v1 - state.v0, c = (x / OV.w) * T; setView(c - span / 2, c + span / 2); }
      drag = { x, v0: state.v0, v1: state.v1 };
      try { ov.setPointerCapture(e.pointerId); } catch (x2) { /* gone */ }
    });
    ov.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dv = ((e.offsetX - drag.x) / OV.w) * vTotal();
      setView(drag.v0 + dv, drag.v1 + dv);
    });
    const end = () => { drag = null; };
    ov.addEventListener('pointerup', end);
    ov.addEventListener('pointercancel', end);
  })();
  const niceStep = (raw) => { const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };
  const man = (n) => (n >= 1e5 ? `${Math.round(n / 1e4)}万` : `${(n / 1e4).toFixed(1)}万`);
  function drawRuler(i0, i1) {
    const px = plotX(), pw = plotW(), base = G.ruler - 1;
    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, G.ruler);
    ctx.fillStyle = C.border; ctx.fillRect(px, base, pw, 1);
    const step = niceStep(((state.v1 - state.v0) / pw) * 96);
    const squeezed = mix > 0.5;
    const placed = [];
    const free = (a, b, pad = 8) => !placed.some(([x, y]) => a < y + pad && b > x - pad);
    ctx.save(); ctx.beginPath(); ctx.rect(px, 0, pw, G.ruler); ctx.clip();
    ctx.font = F.tick(); ctx.textBaseline = 'alphabetic';
    if (squeezed) for (const g of AX.segs) {
      if (!g.gap || g.b < i0 || g.a > i1) continue;
      const xa = xOf(g.a), xb = xOf(g.b), cx = (xa + xb) / 2, len = g.run[1] - g.run[0];
      const text = [`記録外 ${man(len)}`, man(len)].find((t) => textW(t, F.tick()) + 14 <= xb - xa);
      if (text) { const w = textW(text, F.tick()) + 10; ctx.fillStyle = C['text-2']; ctx.fillText(text, cx - w / 2 + 5, base - 9); placed.push([cx - w / 2, cx + w / 2]); }
      const t2 = `${NX.fmt(g.run[1])}〜`, w2 = textW(t2, `600 11px ${NX.FONT}`), lx = Math.max(px, xb + 3);
      if (xb > px - 40 && xb < px + pw - 30 && free(lx, lx + w2, 6)) { placed.push([lx, lx + w2]); ctx.font = `600 11px ${NX.FONT}`; ctx.fillStyle = C.text; ctx.fillText(t2, lx, base - 9); ctx.font = F.tick(); }
    }
    for (let k = Math.ceil(i0 / step) * step; k <= i1; k += step) {
      if (squeezed && AX.segs.some((g) => g.gap && k > g.a && k < g.b)) continue;
      const x = xOf(k);
      if (x < px - 1 || x > px + pw + 1) continue;
      ctx.fillStyle = C.border; ctx.fillRect(Math.round(x), base - 5, 1, 5);
      const text = NX.fmt(k), w = textW(text, F.tick());
      const lx = Math.min(Math.max(px, x - w / 2), px + pw - w);
      if (!free(lx, lx + w)) continue;
      placed.push([lx, lx + w]);
      ctx.fillStyle = C['text-2']; ctx.fillText(text, lx, base - 9);
    }
    ctx.restore();
    if (!G.narrow) { ctx.font = F.tick(); ctx.fillStyle = C['text-2']; ctx.textBaseline = 'alphabetic'; ctx.fillText(squeezed ? '命令（記録外を詰めた）' : '命令', 12, base - 9); }
  }
  function drawGutter() {
    if (G.narrow) {
      for (const lane of lanes) {
        ctx.font = F.gname(); ctx.fillStyle = C.text; ctx.textBaseline = 'middle';
        ctx.fillText(lane.t.name, 12, lane.y + 10);
        ctx.font = F.gsub(); ctx.fillStyle = C['text-2'];
        ctx.fillText(`${lane.t.sub}・CPU ${(100 * lane.t.cpu / M.END).toFixed(1)}%`, 20 + textW(lane.t.name, F.gname()), lane.y + 10.5);
      }
      return;
    }
    ctx.fillStyle = C.surface; ctx.fillRect(0, G.ruler, G.gutter - 6, Hh - G.ruler);
    for (const lane of lanes) {
      const t = lane.t, x = 12;
      ctx.font = F.gname(); ctx.fillStyle = C.text; ctx.textBaseline = 'middle';
      ctx.fillText(clip(t.name, G.gutter - x - 14, F.gname()) || t.name, x, lane.y + 12);
      ctx.font = F.gsub(); ctx.fillStyle = C['text-2'];
      ctx.fillText(t.sub, x, lane.y + 29);
      ctx.fillText(`CPU ${(100 * t.cpu / M.END).toFixed(1)}%・${t.count} 呼び出し`, x, lane.y + 45);
    }
  }
  function phaseText(p) {
    const own = p.words.find((w) => w.detail);
    const ws = own ? [own] : p.head;
    return (p.after ? 'その後：' : '') + ws.map((w) => w.text + (w.detail ? `（${w.detail}）` : '')).join(' → ');
  }
  function drawStory(i0, i1) {
    const y = G.ruler + 4, hh = G.story - 4, px = plotX(), pw = plotW();
    ctx.font = F.tick(); ctx.textBaseline = 'middle'; ctx.fillStyle = C['text-2'];
    if (!G.narrow) ctx.fillText('場面', 12, y + hh / 2);
    ctx.save(); ctx.beginPath(); ctx.rect(px, y - 2, pw, hh + 4); ctx.clip();
    for (const p of M.phases) {
      if (p.end < i0 || p.start > i1) continue;
      const xa = Math.max(px - 4, xOf(p.start)), xb = Math.min(px + pw + 4, xOf(p.end));
      if (xb - xa < 1) continue;
      const on = state.phase === p.num;
      ctx.fillStyle = on ? C['accent-soft'] : p.num % 2 ? C['surface-2'] : C['surface-3'];
      roundRect(xa + 1, y, xb - xa - 2, hh, 5); ctx.fill();
      const bw = Math.min(xb, px + pw) - Math.max(xa, px);
      if (bw < 13) continue;
      const vx0 = Math.max(xa, px) + 6, vx1 = Math.min(xb, px + pw) - 6;
      const cx = vx1 - vx0 < 16 ? (Math.max(xa, px) + Math.min(xb, px + pw)) / 2 : vx0 + 8;
      ctx.fillStyle = on ? C.accent : C['text-2']; ctx.beginPath(); ctx.arc(cx, y + hh / 2, Math.min(8, bw / 2 - 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = on ? C['accent-text'] : C.surface; ctx.font = `700 11px ${NX.FONT}`; ctx.textAlign = 'center'; ctx.fillText(p.after ? '…' : String(p.num), cx, y + hh / 2 + 0.5); ctx.textAlign = 'left';
      const t = phaseText(p), tf = `600 12px ${NX.FONT}`;
      if (vx1 - vx0 - 24 > textW(t, tf)) { ctx.font = tf; ctx.fillStyle = on ? C.accent : C.text; ctx.fillText(t, vx0 + 22, y + hh / 2 + 0.5); }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the view: zoom, pan, fit
  const MIN_SPAN = 60;
  function clampView(v0, v1) {
    const T = vTotal();
    const span = Math.min(T, Math.max(MIN_SPAN, v1 - v0));
    let a = v0, b = v0 + span;
    if (a < 0) { a = 0; b = span; }
    if (b > T) { b = T; a = T - span; }
    return [a, b];
  }
  function setView(v0, v1) { [state.v0, state.v1] = clampView(v0, v1); requestDraw(); }
  let anim = 0;
  function animateTo(v0, v1, ms = 420) {
    [v0, v1] = clampView(v0, v1);
    cancelAnimationFrame(anim);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(v0, v1); return; }
    const a0 = state.v0, a1 = state.v1, t0 = performance.now();
    const s0 = Math.log(a1 - a0), s1 = Math.log(v1 - v0), c0 = (a0 + a1) / 2, c1 = (v0 + v1) / 2;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const span = Math.exp(s0 + (s1 - s0) * e), c = c0 + (c1 - c0) * e;
      state.v0 = c - span / 2; state.v1 = c + span / 2;
      draw();
      if (p < 1) anim = requestAnimationFrame(step); else setView(v0, v1);
    };
    anim = requestAnimationFrame(step);
  }
  function fitInstr(a, b, pad = 0.06) {
    let v0 = vOf(a), v1 = vOf(b);
    const span = Math.max(MIN_SPAN * 4, v1 - v0), c = (v0 + v1) / 2;
    v0 = c - (span * (1 + 2 * pad)) / 2; v1 = c + (span * (1 + 2 * pad)) / 2;
    animateTo(v0, v1);
  }
  function zoomAt(x, factor) {
    const vc = vOfX(x);
    const span = Math.min(vTotal(), Math.max(MIN_SPAN, (state.v1 - state.v0) * factor));
    const r = (x - plotX()) / plotW();
    setView(vc - r * span, vc - r * span + span);
  }
  function setAxis(squeeze) {
    const target = squeeze ? 1 : 0, i0 = iOf(state.v0), i1 = iOf(state.v1), from = mix, t0 = performance.now();
    for (const b of NX.$$('#trAxis button')) b.setAttribute('aria-pressed', String(b.dataset.axis === (squeeze ? '1' : '0')));
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 460), e = 1 - Math.pow(1 - p, 3);
      mix = from + (target - from) * e;
      [state.v0, state.v1] = clampView(vOf(i0), vOf(i1));
      draw();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- hit testing and pointer
  function hitTest(x, y) {
    if (y < G.ruler + G.story + 2 && y > G.ruler && x >= plotX()) {
      const i = iOf(vOfX(x));
      const p = M.phases.find((q) => i >= q.start && i <= q.end);
      return p ? { type: 'phase', p } : null;
    }
    if (x < plotX()) return null;
    const lane = lanes.find((l) => y >= l.y && y < l.y + l.h);
    if (!lane) return null;
    for (const l of PINS.get(lane.t.tid)) { const b = l.box; if (b && x >= b[0] - 2 && x <= b[0] + b[2] + 2 && y >= b[1] - 2 && y <= b[1] + b[3] + 2) return { type: 'slice', s: S[l.id] }; }
    const d = Math.floor((y - lane.rowsY) / lane.rowH);
    if (d < 0 || d >= rowsOf(lane.t)) return null;
    let best = null, bestD = 1e9;
    for (const s of laneSlices.get(lane.t.tid)) {
      if (!shown(s) || dep(s) !== d) continue;
      const [x0, x10] = sliceX(s), x1 = s.abandoned ? x10 + TAIL : x10;
      if (x >= x0 - 3 && x <= x1 + 3) {
        const dd = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
        if (dd < bestD || (dd === bestD && best && x1 - x0 < sliceX(best)[1] - sliceX(best)[0])) { best = s; bestD = dd; }
      }
    }
    return best ? { type: 'slice', s: best } : null;
  }
  const durText = (s) => (s.open ? '記録の終わりまで開いたまま' : `${NX.fmt(s.end - s.start)} 命令`);
  function tipFor(s) {
    const th = M.threadById.get(s.tid);
    return `<div class="tip-k">${esc(th ? th.name : s.tid)}・${esc(NX.layerName(s.layer) || '層は推定')}${s.inferred ? '（地図に無い関数）' : ''}</div><b class="mono">${esc(s.label)}</b>${s.fn && s.fn !== s.label ? `<div class="mono">${esc(s.fn)}</div>` : ''}<div>${NX.fmt(s.start)} 命令目から・${esc(durText(s))}</div>${s.cpuIn < drawnEnd(s) - s.start ? `<div class="tip-k">うち CPU で走った ${NX.fmt(s.cpuIn)} 命令（ほかは待ち）</div>` : ''}`;
  }
  (function wirePointer() {
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      drag = { x: e.clientX, v0: state.v0, v1: state.v1, moved: false, rx: e.clientX - r.left };
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      if (drag && e.buttons) {
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } }
        if (drag.moved) { const dv = (dx / plotW()) * (drag.v1 - drag.v0); setView(drag.v0 - dv, drag.v1 - dv); NX.ui.hideTip(); return; }
      }
      const h = hitTest(e.clientX - r.left, e.clientY - r.top);
      const id = h && h.type === 'slice' ? h.s.id : null;
      if ((state.hover && state.hover.id) !== id) { state.hover = id != null ? { id } : null; requestDraw(); }
      if (h && h.type === 'slice') NX.ui.showTip(e.clientX, e.clientY, tipFor(h.s));
      else if (h && h.type === 'phase') NX.ui.showTip(e.clientX, e.clientY, `<b>場面 ${h.p.num}</b><div>${esc(phaseText(h.p))}</div><div class="tip-k">押すとその場面へ寄る</div>`);
      else NX.ui.hideTip();
    });
    cv.addEventListener('pointerup', (e) => {
      const was = drag;
      drag = null;
      if (was && was.moved) return;
      const r = cv.getBoundingClientRect();
      const h = hitTest(e.clientX - r.left, e.clientY - r.top);
      if (h && h.type === 'phase') { selectPhase(h.p.num); return; }
      state.sel = h && h.type === 'slice' ? h.s.id : null;
      renderSide();
      requestDraw();
    });
    cv.addEventListener('pointerleave', () => { if (state.hover) { state.hover = null; requestDraw(); } NX.ui.hideTip(); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(e.clientX - r.left, Math.exp(e.deltaY * 0.0018));
      else { const dv = (e.deltaX / plotW()) * (state.v1 - state.v0); setView(state.v0 + dv, state.v1 + dv); }
    }, { passive: false });
  })();
  function selectPhase(num) {
    state.phase = state.phase === num ? null : num;
    const p = M.phases.find((q) => q.num === state.phase);
    if (p) fitInstr(p.start, p.end); else animateTo(0, vTotal());
    renderScenes();
    requestDraw();
  }

  // ---------------------------------------------------------------- the step chosen elsewhere
  function stepFocus() {
    // the same matching the walk card counts with (NX.stepRecord)
    const r = NX.stepRecord(NX.state.stack);
    const vis = new Set();
    for (const s of r.hits) { const v = visOf(s); if (v) vis.add(v.id); }
    const links = new Set();
    r.links.forEach((l) => { const k = M.links.indexOf(l); if (k >= 0) links.add(k); });
    state.focus = vis.size || links.size ? { vis, links, r } : null;
    state.stepHits = r;
  }
  const HOW = {
    msg: '列を通るメッセージ（順番で対にした）として当てた',
    call: '呼んだ側の下で呼ばれた所を当てた',
    seq: '同じ関数の中で続けて呼ばれた所を当てた',
    irq: 'タイマーの割り込みを当てた',
    nodes: '手順の端の関数に入った所を当てた',
    absent: '端の関数が記録に無い',
    alt: 'もしもの道は、この記録の外',
  };

  // ---------------------------------------------------------------- the side panel
  function renderSide() {
    const f = NX.topOf(NX.state.stack), t = TR[f.id], step = t.steps[f.i];
    const r = state.stepHits;
    let h = `<section class="tr-sec"><h3 class="tr-h">今の手順 <span class="tr-hn">${esc(NX.trackName(t))}</span></h3>
      <div class="tr-step"><span class="num now${step.alt ? ' alt' : ''}">${esc(t.labels[f.i])}</span><b>${esc(NX.stepTitle(step))}</b></div>`;
    if (r) {
      if (r.count) h += `<p class="tr-p">この記録では <b>${r.count} 回</b>。${esc(HOW[r.how] || '')}。図の中で<span class="tr-ring">枠</span>を付けた呼び出しがそれ。</p>`;
      else h += `<p class="tr-p">${esc(r.how === 'alt' || r.how === 'absent' ? HOW[r.how] : 'この手順に当たる呼び出しは、この記録に無い')}。</p>`;
      for (const a of r.absent) h += `<p class="tr-p muted">${NX.nodeChip(a.id)}：${esc(a.why)}</p>`;
      if (r.instead) h += `<p class="tr-p muted">代わりに ${NX.nodeChip(r.instead.node)} の${r.instead.role === 'callers' ? '呼び手' : '呼び先'}：${r.instead.list.slice(0, 3).map(([x, k]) => `<code>${esc(x || '（無し）')}</code> ×${k}`).join('・')}</p>`;
      if (r.kindUnknown) h += `<p class="tr-p muted">イベントの種類（${esc(r.kindUnknown)}）は記録に残らないので、同じ道としか言えない。</p>`;
      const list = r.hits.filter((s) => s.n).slice(0, 6);
      if (list.length) h += `<ul class="tr-hits">${list.map((s) => `<li><button type="button" data-slice="${s.id}"><span class="mono">${esc(s.label)}</span><span class="muted">${esc(M.threadById.get(s.tid).name)}・${NX.fmt(s.start)}</span></button></li>`).join('')}</ul>`;
    }
    h += '<p class="tr-p muted">記録は Editor で「x」を打った 1 回。タスクマネージャの記録ではないので、タスクマネージャだけの手順には当たる所が無い。</p></section>';
    h += summaryHTML();
    if (state.sel != null) {
      const s = S[state.sel], th = M.threadById.get(s.tid);
      h += `<section class="tr-sec"><h3 class="tr-h">選んだ呼び出し</h3><p class="tr-p"><b class="mono">${esc(s.label)}</b>${s.fn && s.fn !== s.label ? ` <span class="mono muted">${esc(s.fn)}</span>` : ''}</p>
        <dl class="tr-dl"><dt>スレッド</dt><dd>${esc(th.name)}（${esc(th.sub)}）</dd><dt>始まり</dt><dd>${NX.fmt(s.start)} 命令目</dd><dt>長さ</dt><dd>${esc(durText(s))}</dd>
        <dt>層</dt><dd>${esc(NX.layerName(s.layer) || '分からない')}${s.inferred ? '（ファイルの場所から推した）' : ''}</dd>${s.file ? `<dt>ファイル</dt><dd class="mono">${esc(s.file)}</dd>` : ''}</dl>
        ${s.n ? `<p class="tr-p">${NX.nodeChip(s.n)}</p>` : ''}${s.notNode ? `<p class="tr-p muted">記録の写しは、この dispatch を OS_CALL に結んでいる。外側の syscall は ${esc(s.notNode.syscall)} なので、OS_CALL としては数えない。</p>` : ''}</section>`;
    }
    // the path from the key to the DOM
    const p = M.paths[state.path] || M.paths[0];
    if (p) {
      const waits = p.hops.filter((x) => x.kind === 'wait').reduce((a, x) => a + (x.until - x.at), 0);
      const total = p.end - p.start;
      h += `<section class="tr-sec"><h3 class="tr-h">キー → DOM の道筋</h3><div class="seg tr-paths">${M.paths.map((q, k) => `<button type="button" data-path="${k}" aria-pressed="${k === state.path}">${esc(q.hook)}</button>`).join('')}</div>
        <div class="tr-kpi"><div><b>${NX.fmt(total)}</b><span>キーから命令</span></div><div><b>${NX.fmt(waits)}</b><span>列で待った</span></div><div><b>${Math.round((100 * waits) / total)}%</b><span>待ちの割合</span></div></div>
        <ol class="tr-hops">${p.hops.map((x) => `<li class="${x.kind}"><span class="tr-at">${x.kind === 'wait' ? `+${NX.fmt(x.until - x.at)}` : NX.fmt(x.at - p.start)}</span><div><b>${esc(x.text)}</b><small>${esc(x.sub || '')}</small></div></li>`).join('')}</ol>
        <button class="btn small" type="button" data-fitpath="${state.path}">この道筋に寄る</button></section>`;
    }
    if (M.fixes.length) {
      const os = S.filter((s) => s.n === 'kernel.os-call');
      const dur = os.reduce((a, s) => a + (s.open ? 0 : s.end - s.start), 0);
      h += `<section class="tr-sec"><h3 class="tr-h">OS_CALL の数え方</h3><p class="tr-p">syscall.dispatch はすべての syscall で走る。外側の syscall が WAIT_NOTIFICATION の ${M.fixes.length} 回は OS_CALL から外した。OS_CALL は <b>${os.length} 回・${NX.fmt(dur)} 命令</b>。</p><p class="tr-p muted">syscall.unsafe.mln は OS_CALL（484 行）と WAIT_NOTIFICATION（505 行）を別の枝で扱う。</p></section>`;
    }
    $('#trSide').innerHTML = h;
  }
  // まとめ (trace-timeline): the whole record in numbers, and where its instructions went
  const SHARE_ORDER = ['app', 'lib', 'os', 'kernel', 'emu', 'unknown'];
  const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
  function summaryHTML() {
    const T = window.TRACE_FULL, sh = M.share, total = M.END, rec = total - sh.none;
    const parts = SHARE_ORDER.filter((k) => sh[k] > 0), recOnly = parts.reduce((a, k) => a + sh[k], 0);
    const nameOf = (k) => NX.layerName(k) || '層が分からない';
    const threads = M.threads.filter((t) => t.kind !== 'idle').length, idle = M.threads.some((t) => t.kind === 'idle');
    return `<section class="tr-sec"><h3 class="tr-h">まとめ</h3>
      <p class="tr-hero"><b>${NX.fmt(total)}</b> 命令</p>
      <p class="tr-p muted">${threads} スレッド${idle ? '＋走るもの無し' : ''}・${S.filter((x) => x.kind === 'call').length} 回の呼び出し・割り込み ${S.filter((x) => x.kind === 'irq').length} 回・${(T.events || []).length} イベント（記録した関数 ${Object.keys(T.watched || {}).length}）</p>
      <div class="tr-thin" role="img" aria-label="記録した関数の中 ${pct(rec / total)}、記録外 ${pct(sh.none / total)}"><span style="flex:${rec}"></span><span class="none" style="flex:${sh.none}"></span></div>
      <p class="tr-thin-l"><span>記録した関数の中 ${pct(rec / total)}</span><span>記録外 ${pct(sh.none / total)}</span></p>
      <h4 class="tr-h4">どの層で走ったか<span>記録した関数の中</span></h4>
      <div class="tr-share" role="img" aria-label="${esc(parts.map((k) => `${nameOf(k)} ${pct(sh[k] / recOnly)}`).join('、'))}">${parts.map((k) => { const x = sh[k] / recOnly; return `<span style="flex:${sh[k]};background:${k === 'unknown' ? 'var(--text-3)' : NX.layerVar(k)}" title="${esc(nameOf(k))} ${NX.fmt(sh[k])} 命令（${pct(x)}）">${x >= 0.12 ? pct(x, 0) : ''}</span>`; }).join('')}</div>
      <p class="tr-share-l">${parts.map((k) => `<span><i style="background:${k === 'unknown' ? 'var(--text-3)' : NX.layerVar(k)}"></i>${esc(nameOf(k))} ${pct(sh[k] / recOnly, 0)}</span>`).join('')}</p></section>`;
  }
  function renderScenes() {
    $('#trScenes').innerHTML = M.phases.map((p) => {
      const th = p.tid != null ? M.threadById.get(p.tid) : null;
      return `<button type="button" class="tr-scene${state.phase === p.num ? ' on' : ''}" data-phase="${p.num}"><span class="num${state.phase === p.num ? ' now' : ''}">${p.after ? '…' : p.num}</span><span class="tr-st"><b class="ja">${esc(phaseText(p))}</b><small>${esc(th ? th.name : '3 スレッド')}・<span class="nowrap">${NX.fmt(p.end - p.start)} 命令</span></small></span></button>`;
    }).join('');
  }

  // ---------------------------------------------------------------- render, events
  V.render = (changed = {}) => {
    if (!built) build();
    readTheme();
    makeHatch();
    const T = window.TRACE_FULL;
    const nThreads = M.threads.filter((t) => t.kind !== 'idle').length;
    $('#trEyebrow').innerHTML = `記録・${esc((T.date || '').slice(0, 16).replace('T', ' '))}・${NX.fmt(M.END)} 命令・${nThreads} スレッド＋走るもの無し・${S.filter((x) => x.kind === 'call').length} 回の呼び出し・割り込み ${S.filter((x) => x.kind === 'irq').length} 回`;
    $('#trTitle').textContent = T.title;
    const run = T.run || {};
    if (run.before && run.after) $('#trDiff').innerHTML = [['本文', 'text'], ['タイトル', 'title'], ['位置', 'position']].map(([k, f]) => `<dt>${k}</dt><dd><code>「${esc(run.before[f])}」</code><span class="ar">→</span><code>「${esc(run.after[f])}」</code></dd>`).join('');
    $('#trLegend').innerHTML = NX.STACK.slice(0, 4).map((l) => `<span><i style="background:${NX.layerVar(l)}"></i>${esc(NX.layerName(l))}</span>`).join('') + '<span><i class="pale"></i>地図に無い関数</span><span><i class="hatch"></i>待ち</span><span><i class="run"></i>CPU を持つ</span><span><i class="lnk"></i>列を通る</span>';
    renderScenes();
    stepFocus();
    layout();
    draw();
    renderSide();
    // the chosen step's calls in view
    if (changed.stack && state.focus && state.focus.r.hits.length) {
      const hs = state.focus.r.hits;
      const a = Math.min(...hs.map((s) => s.start)), b = Math.max(...hs.map((s) => drawnEnd(s)));
      const i0 = iOf(state.v0), i1 = iOf(state.v1);
      if (b < i0 || a > i1) fitInstr(a, b, 0.3);
    }
  };
  V.onResize = () => { if (built) { layout(); draw(); } };
  root.addEventListener('click', (e) => {
    const t = e.target;
    const ph = t.closest('[data-phase]');
    if (ph) { selectPhase(Number(ph.dataset.phase)); return; }
    const fo = t.closest('[data-fold]');
    if (fo) { state.fold = fo.dataset.fold === '1'; for (const b of NX.$$('#trFold button')) b.setAttribute('aria-pressed', String(b.dataset.fold === fo.dataset.fold)); stepFocus(); layout(); draw(); return; }
    const ax = t.closest('[data-axis]');
    if (ax) { setAxis(ax.dataset.axis === '1'); return; }
    const z = t.closest('[data-z]');
    if (z) { if (z.dataset.z === 'fit') { state.phase = null; renderScenes(); animateTo(0, vTotal()); } else zoomAt(plotX() + plotW() / 2, z.dataset.z === 'in' ? 0.6 : 1 / 0.6); return; }
    const pa = t.closest('[data-path]');
    if (pa) { state.path = Number(pa.dataset.path); renderSide(); return; }
    const fp = t.closest('[data-fitpath]');
    if (fp) { const p = M.paths[Number(fp.dataset.fitpath)]; fitInstr(p.start, p.end, 0.04); return; }
    const sl = t.closest('[data-slice]');
    if (sl) { const s = S[Number(sl.dataset.slice)]; state.sel = s.id; fitInstr(s.start, Math.max(drawnEnd(s), s.start + 400), 0.6); renderSide(); requestDraw(); }
  });
  V.onKey = (e) => {
    if (e.key === '0') { animateTo(0, vTotal()); return true; }
    if (/^[1-7]$/.test(e.key) && e.shiftKey) { selectPhase(Number(e.key)); return true; }
    return false;
  };
  V.onNode = () => {};
  // what was drawn where, for the checks (the arrows' names, the pins, the calls' names)
  V.boxes = () => ({ pills: lastPills.map(([x, y, w]) => [x - w / 2, y - 9, w, 18]), pins: M ? M.landmarks.filter((l) => l.box).map((l) => l.box) : [], labels: labelBoxes });
})();
