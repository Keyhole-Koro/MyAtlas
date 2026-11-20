// 地図: the whole system as a metro map (from metro). Flows and papers are lines, nodes are stations, a
// node shared by lines is an interchange, layers are districts. The layout is metro's saved one
// (data/metro-layout.js); the page never runs the annealing. A station opens the node card; a line opens
// its timetable; 「始発」 walks the line from step 1.
(function () {
  'use strict';
  const NX = window.NX, { A, esc, $, TR } = NX;
  const MM = window.METROM, ML = window.METROL;
  const V = (NX.map = {});
  const root = $('#v-map');
  const phone = () => matchMedia('(max-width: 760px)').matches;

  root.innerHTML = `
    <aside class="mp-side scroll" id="mpSide" aria-label="路線と時刻表"></aside>
    <div class="mp-wrap" id="mpWrap">
      <svg class="mp-svg" id="mpSvg" role="img" aria-label="路線図"></svg>
      <div class="mp-hint" id="mpHint"></div>
      <div class="mp-zoom"><button class="btn icon" type="button" data-zoom="in" title="拡大（+）" aria-label="拡大">+</button><button class="btn icon" type="button" data-zoom="out" title="縮小（−）" aria-label="縮小">−</button><button class="btn icon" type="button" data-zoom="fit" title="全体（0）" aria-label="全体">⤢</button></div>
    </div>`;
  const svg = $('#mpSvg');

  let model = null, P = null, scene = null, built = false, layoutNote = '';
  const canvas = document.createElement('canvas').getContext('2d');
  const measure = (text, size, mono) => {
    canvas.font = mono ? `600 ${size - 0.1}px ${NX.MONO}` : size >= 14 ? `650 ${size}px ${NX.FONT}` : `400 ${size}px ${NX.FONT}`;
    return canvas.measureText(text).width;
  };
  const lineVar = (id) => `var(--ln-${model.lineById[id].code})`;

  // ---------------------------------------------------------------- the saved layout
  function storedLayout() {
    const L = window.METRO_LAYOUT;
    const n = P.stations.length;
    const X = new Int32Array(n).fill(-1), Y = new Int32Array(n).fill(-1);
    if (!L) return { X, Y, B: new Uint8Array(P.edges.length), ok: false };
    const zoneNow = Object.fromEntries(P.zones.map((z) => [z.id, z]));
    const zoneThen = L.zones || Object.fromEntries(P.zones.map((z) => [z.id, [z.r0, z.r1]]));
    const seen = new Set();
    let ok = true;
    P.stations.forEach((s, i) => {
      const v = L.stations[s.id];
      if (!v) { ok = false; return; }
      const then = zoneThen[s.layer], now = zoneNow[s.layer];
      let y = v[1];
      if (then && now && then[0] !== now.r0) { y = v[1] - then[0] + now.r0; ok = false; }
      const key = v[0] * 4096 + y;
      if (y < P.rowMin[i] || y > P.rowMax[i] || v[0] < 0 || v[0] >= P.cols || seen.has(key)) { ok = false; return; }
      seen.add(key);
      X[i] = v[0]; Y[i] = y;
    });
    if (!P.edges.every((e) => e.key in L.bends)) ok = false;
    const B = Uint8Array.from(P.edges.map((e) => L.bends[e.key] ?? 0));
    return { X, Y, B, ok };
  }
  function build() {
    model = MM.buildModel(A, NX.C);
    P = ML.gridProblem(model);
    let st = storedLayout();
    if (!st.ok) {
      // the map changed since the layout was saved: keep the saved cells, place only what is new
      // (a greedy placement next to the neighbours; no annealing here)
      st = ML.warmState(P, model, { X: [...st.X], Y: [...st.Y], B: [...st.B] });
      layoutNote = '保存した配置が今の地図と少し違うので、新しい駅だけを近くに置きました（metro の tools で配置を作り直せます）。';
    }
    scene = ML.buildScene(model, P, st, measure);
    built = true;
  }

  // ---------------------------------------------------------------- drawing
  let isCompact = false;
  function stationShape(c, extra = 0) {
    const m = c.mark;
    if (m.type === 'dot') return `<circle cx="${m.x}" cy="${m.y}" r="${m.r + extra}"/>`;
    const ang = (Math.atan2(m.ay, m.ax) * 180) / Math.PI;
    const w = 2 * (m.half + extra), h = 2 * (m.r + extra);
    return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" transform="translate(${m.x} ${m.y}) rotate(${ang})"/>`;
  }
  function labelSVG(s) {
    const c = scene.stations[s.id];
    const L = isCompact ? c.labelCompact : c.label;
    const [x0, y0, x1] = L.rect;
    const anchor = L.side.includes('E') || L.side.endsWith('>') ? 'start' : L.side.includes('W') || L.side.endsWith('<') ? 'end' : 'middle';
    const x = anchor === 'start' ? x0 : anchor === 'end' ? x1 : (x0 + x1) / 2;
    let y = y0 + 14;
    let t = `<text class="nm${s.codeName ? ' code' : ''}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.name)}</text>`;
    if (s.ns && (L.variant === 'full' || L.variant === 'ns')) { y += ML.LINE_H.ns; t += `<text class="ns" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.ns)}</text>`; }
    if (s.sub && (L.variant === 'full' || L.variant === 'sub')) { y += ML.LINE_H.sub; t += `<text class="sb" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.sub)}</text>`; }
    return `<g class="mt-label" data-st="${esc(s.id)}">${t}</g>`;
  }
  let shields = [];
  function computeShields() {
    const out = [];
    const labelRects = Object.values(scene.stations).map((c) => c.label.rect);
    const boxes = Object.values(scene.stations).map((c) => c.box);
    const R = 13;
    const segDist = (px, py, ax, ay, bx, by) => {
      const ux = bx - ax, uy = by - ay, L = ux * ux + uy * uy;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * ux + (py - ay) * uy) / L)) : 0;
      return Math.hypot(ax + t * ux - px, ay + t * uy - py);
    };
    let current = null;
    const clear = (x, y) => {
      for (const t of scene.tracks) {
        if (t.line === current) continue;
        for (let i = 1; i < t.pts.length; i++) if (segDist(x, y, ...t.pts[i - 1], ...t.pts[i]) < R + 9) return false;
      }
      for (const r of labelRects) if (x + R + 3 > r[0] && x - R - 3 < r[2] && y + R + 3 > r[1] && y - R - 3 < r[3]) return false;
      for (const b of boxes) if (x + R + 6 > b[0] && x - R - 6 < b[2] && y + R + 6 > b[1] && y - R - 6 < b[3]) return false;
      for (const o of out) if (Math.hypot(o.x - x, o.y - y) < 3 * R) return false;
      return true;
    };
    for (const line of model.lines) {
      current = line.id;
      const pieces = [];
      for (const t of scene.tracks.filter((x) => x.line === line.id && x.type === 'step')) {
        for (let i = 1; i < t.pts.length; i++) {
          const [ax, ay] = t.pts[i - 1], [bx, by] = t.pts[i];
          pieces.push({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) });
        }
      }
      pieces.sort((a, b) => b.len - a.len);
      let placed = 0;
      const want = line.kind === 'flow' ? 2 : 1;
      for (const p of pieces) {
        if (placed >= want || p.len < 70) break;
        for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
          const x = p.ax + (p.bx - p.ax) * f, y = p.ay + (p.by - p.ay) * f;
          if (clear(x, y)) { out.push({ line: line.id, x, y }); placed++; break; }
        }
      }
    }
    return out;
  }
  // room for overlays: they cover no label, no station, no route letter, no district name
  function roomFinder({ trackWeight = 0, labelWeight = () => 100 } = {}) {
    const rects = [];
    for (const [id, c] of Object.entries(scene.stations)) {
      rects.push([...(isCompact ? c.labelCompact : c.label).rect, labelWeight(id)]);
      rects.push([...c.box, 60]);
    }
    for (const sh of shields) rects.push([sh.x - 14, sh.y - 14, sh.x + 14, sh.y + 14, 40]);
    for (const z of scene.zones) {
      const mid = (z.y0 + z.y1) / 2;
      rects.push([0, mid - 20, 18 + Math.max(measure(z.name, 16, false), measure(z.sub || '', 13, false)) + 6, mid + 22, 80]);
    }
    const segs = [];
    if (trackWeight) for (const t of scene.tracks) for (let i = 1; i < t.pts.length; i++) segs.push([...t.pts[i - 1], ...t.pts[i]]);
    const R = [0, 0, 0, 0];
    const room = {
      add(r, w = 100) { rects.push([r[0], r[1], r[2], r[3], w]); },
      cost(r, pad = 2) {
        let v = 0;
        for (const q of rects) if (r[0] - pad < q[2] && q[0] - pad < r[2] && r[1] - pad < q[3] && q[1] - pad < r[3]) v += q[4];
        if (segs.length) {
          R[0] = r[0] - pad; R[1] = r[1] - pad; R[2] = r[2] + pad; R[3] = r[3] + pad;
          for (const s of segs) if (ML.segHitsRect(s[0], s[1], s[2], s[3], R)) v += trackWeight;
        }
        if (r[0] < 4 || r[1] < 4 || r[2] > scene.width - 4 || r[3] > scene.height - 4) v += 50;
        return v;
      },
      best(cands, pad) { let pick = null; for (const c of cands) { const v = room.cost(c.r, c.pad ?? pad) + (c.pref || 0); if (!pick || v < pick.v) pick = { ...c, v }; } return pick; },
      // what a place would hide (labels, stations, signs, district names, the map's edge), and how many lines pass under it
      hides(r, pad = 2) {
        let v = 0;
        for (const q of rects) if (r[0] - pad < q[2] && q[0] - pad < r[2] && r[1] - pad < q[3] && q[1] - pad < r[3]) v += q[4];
        if (r[0] < 4 || r[1] < 4 || r[2] > scene.width - 4 || r[3] > scene.height - 4) v += 50;
        return v;
      },
      lines(r, pad = 2) {
        let v = 0;
        R[0] = r[0] - pad; R[1] = r[1] - pad; R[2] = r[2] + pad; R[3] = r[3] + pad;
        for (const s of segs) if (ML.segHitsRect(s[0], s[1], s[2], s[3], R)) v++;
        return v;
      },
    };
    return room;
  }
  function spotsAround(c, w, h, steps = [0, 12, 26]) {
    const b = c.box, hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2, g = 4;
    const base = [[1, 0, 0], [-1, 0, 0.4], [0, -1, 0.3], [0, 1, 0.3], [1, -1, 0.7], [-1, -1, 0.8], [1, 1, 0.7], [-1, 1, 0.8]];
    const out = [];
    for (const extra of steps) for (const [dx, dy, p] of base) for (const nudge of dx && !dy ? [0, -7, 7] : [0]) {
      const x = c.x + dx * (hw + g + w / 2 + extra), y = c.y + dy * (hh + g + h / 2 + extra) + nudge;
      out.push({ x, y, dx, dy, r: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], pref: p + extra / 8 + Math.abs(nudge) / 20 });
    }
    return out;
  }
  const originAt = {};
  function originTags() {
    const room = roomFinder({ trackWeight: 30 });
    let h = '';
    for (const line of model.lines.filter((l) => l.kind === 'flow')) {
      const c = scene.stations[line.origin];
      if (!c) continue;
      const text = '始発';
      const w = 28 + measure(text, 14, false) + 12, hgt = 26;
      const p = room.best(spotsAround(c, w, hgt), 1);
      room.add(p.r, 100);
      const col = lineVar(line.id);
      const ex = p.x - p.dx * (w / 2), ey = p.y - p.dy * (hgt / 2);
      const len = Math.hypot(ex - c.x, ey - c.y) || 1, ux = (ex - c.x) / len, uy = (ey - c.y) / len;
      const edge = Math.min(Math.abs(ux) > 1e-6 ? (c.box[2] - c.x) / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? (c.box[3] - c.y) / Math.abs(uy) : 1e9);
      const lead = len > edge + 6 ? `<path class="tag-lead" d="M${(c.x + ux * edge).toFixed(1)} ${(c.y + uy * edge).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${col}"/>` : '';
      h += `<g class="term-tag" data-line="${esc(line.id)}" role="button" aria-label="${esc(line.name)}の始発（押すと 1 から歩く）">${lead}<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
        <rect x="${-w / 2}" y="${-hgt / 2}" width="${w}" height="${hgt}" rx="${hgt / 2}" stroke="${col}"/>
        <circle cx="${-w / 2 + 13}" cy="0" r="10" fill="${col}"/><text class="tt-code" x="${-w / 2 + 13}" y="0.5">${esc(line.code)}</text>
        <text class="tt-word" x="${-w / 2 + 28}" y="0.5" fill="${col}">${text}</text></g><title>${esc(line.name)} の始発。押すと手順 1 から歩く</title></g>`;
      originAt[line.id] = p;
    }
    return h;
  }
  function render() {
    const sc = scene;
    let h = '<g class="zones">';
    for (const z of sc.zones) {
      h += `<rect class="zone-band" x="-4000" y="${z.y0}" width="${sc.width + 8000}" height="${z.y1 - z.y0}" style="--lc:${NX.layerVar(z.id)}"/>`;
      h += `<line class="zone-rule" x1="-4000" x2="${sc.width + 4000}" y1="${z.y1}" y2="${z.y1}"/>`;
    }
    h += '</g><g class="tracks">';
    for (const line of [...model.lines].reverse()) {
      h += `<g class="line-g" data-line="${esc(line.id)}" style="--lc:${lineVar(line.id)}">`;
      for (const t of sc.tracks.filter((x) => x.line === line.id)) {
        const w = line.kind === 'flow' ? ML.LOOK.line : ML.LOOK.paperLine;
        if (t.type === 'link') {
          h += `<path class="track track-link" d="${t.d}" stroke="var(--lc)" stroke-width="${(w + 3.4).toFixed(1)}"/>`;
          h += `<path class="track-link-core" d="${t.d}" stroke-width="${(w - 0.2).toFixed(1)}"/>`;
        } else h += `<path class="track${t.type === 'alt' ? ' track-alt' : ''}" d="${t.d}" stroke="var(--lc)" stroke-width="${w}"/>`;
      }
      h += '</g>';
    }
    h += '</g><g id="mpFlash"></g><g id="mpChev"></g><g class="hits">';
    for (const t of sc.tracks) h += `<path class="hit" d="${t.d}" data-line="${esc(t.line)}" data-key="${esc(t.key)}"/>`;
    h += '</g><g class="stations">';
    for (const s of Object.values(model.stations)) {
      const c = sc.stations[s.id];
      const stroke = c.mark.type === 'dot' ? ` stroke="${lineVar(s.lines[0])}"` : '';
      const cls = c.mark.type === 'dot' ? `dot${c.mark.paper ? ' minor' : ''}` : 'pill';
      h += `<g class="mt-station" data-st="${esc(s.id)}"><circle class="tap" cx="${c.x}" cy="${c.y}" r="20"/><g class="halo-ring">${stationShape(c, 5)}</g><g class="${cls}"${stroke}>${stationShape(c)}</g></g>`;
    }
    h += '</g><g id="mpShields">';
    shields = computeShields();
    for (const sh of shields) {
      const l = model.lineById[sh.line], paper = l.kind === 'paper';
      h += `<g class="shield" data-line="${esc(sh.line)}" transform="translate(${sh.x.toFixed(1)} ${sh.y.toFixed(1)})"><circle r="13" fill="${paper ? 'var(--surface)' : lineVar(sh.line)}" stroke="${lineVar(sh.line)}" stroke-width="${paper ? 3 : 2}"/><text fill="${paper ? lineVar(sh.line) : 'var(--surface)'}">${esc(l.code)}</text></g>`;
    }
    h += '</g><g class="labels" id="mpLabels">';
    for (const s of Object.values(model.stations)) h += labelSVG(s);
    h += `</g><g id="mpDecor">${originTags()}</g><g id="mpBadges"></g><g id="mpNow"></g><g id="mpZones">`;
    for (const z of sc.zones) {
      const mid = (z.y0 + z.y1) / 2;
      const hgt = z.y1 - z.y0;
      h += `<g class="zone-label"><rect x="0" y="${z.y0}" width="4" height="${hgt}" fill="${NX.layerVar(z.id)}"/><text class="zone-name" x="16" y="${mid - 2}" style="fill:${NX.layerText(z.id)}">${esc(z.name)}</text><text class="zone-sub" x="16" y="${mid + 15}">${esc(z.sub)}</text></g>`;
      // when the map is panned past the names: a narrow strip with the names standing up
      h += `<g class="zone-strip"><rect class="zs-bg" x="0" y="${z.y0}" width="22" height="${hgt}"/><rect x="0" y="${z.y0}" width="22" height="${hgt}" style="fill:color-mix(in srgb, ${NX.layerVar(z.id)} var(--tint), var(--surface))"/><rect x="0" y="${z.y0}" width="4" height="${hgt}" fill="${NX.layerVar(z.id)}"/>${measure(z.name, 12, false) + 12 < hgt ? `<text class="zs-name" transform="translate(13 ${mid}) rotate(-90)" style="fill:${NX.layerText(z.id)}">${esc(z.name)}</text>` : ''}</g>`;
    }
    h += '</g>';
    svg.innerHTML = h;
  }

  // ---------------------------------------------------------------- the camera
  let cam = { cx: 0, cy: 0, s: 0 }, anim = 0;
  const box = () => svg.getBoundingClientRect();
  function freeRegion() {
    const r = box();
    // the left 34 px can hold the districts' strip; a phone's sheet covers the foot
    const reg = { x0: 34, y0: 12, x1: r.width - 12, y1: r.height - (phone() ? 56 : 12) };
    const nc = $('#ncard');
    if (!nc.hidden && !phone()) reg.x1 = Math.max(reg.x0 + 200, Math.min(reg.x1, nc.getBoundingClientRect().left - r.left - 12));
    return reg;
  }
  function clampCam(c) {
    const r = box(), reg = freeRegion();
    const left = c.cx - r.width / 2 / c.s, top = c.cy - r.height / 2 / c.s;
    const m = 24;
    const L = -left * c.s, R = (scene.width - left) * c.s, T = -top * c.s, B = (scene.height - top) * c.s;
    const fix = (lo, hi, r0, r1) => {
      if (hi - lo >= r1 - r0 - 2 * m) { if (lo > r0 + m) return lo - (r0 + m); if (hi < r1 - m) return hi - (r1 - m); return 0; }
      if (lo < r0 + m) return lo - (r0 + m); if (hi > r1 - m) return hi - (r1 - m); return 0;
    };
    const dx = fix(L, R, reg.x0, reg.x1), dy = fix(T, B, reg.y0, reg.y1);
    return { ...c, cx: c.cx + dx / c.s, cy: c.cy + dy / c.s };
  }
  function setCam(c) {
    cam = c;
    const r = box();
    const w = r.width / c.s, h = r.height / c.s;
    const x = c.cx - w / 2, y = c.cy - h / 2;
    svg.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    // names of districts stay at the left edge while the map is panned
    const zl = svg.querySelector('#mpZones');
    if (zl) { zl.setAttribute('transform', `translate(${Math.max(0, x).toFixed(2)} 0)`); zl.classList.toggle('floating', x > 2); }
    const compact = c.s < 0.88;
    svg.classList.toggle('compact', compact);
    if (compact !== isCompact) {
      isCompact = compact;
      const g = svg.querySelector('#mpLabels');
      if (g) {
        g.innerHTML = Object.values(model.stations).map(labelSVG).join('');
        svg.querySelector('#mpDecor').innerHTML = originTags();
        renderLine();
        renderNow(false);
        emphasis();
      }
    }
  }
  function camFor(b, minScale = 0, maxScale = 1.6) {
    const r = box(), reg = freeRegion();
    const rw = Math.max(80, reg.x1 - reg.x0), rh = Math.max(80, reg.y1 - reg.y0);
    const s = NX.clamp(Math.min(rw / b.w, rh / b.h), minScale, maxScale);
    const rcx = (reg.x0 + reg.x1) / 2, rcy = (reg.y0 + reg.y1) / 2;
    return { cx: b.x + b.w / 2 - (rcx - r.width / 2) / s, cy: b.y + b.h / 2 - (rcy - r.height / 2) / s, s };
  }
  function animateTo(target, ms = 480) {
    target = clampCam(target);
    cancelAnimationFrame(anim);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !cam.s) { setCam(target); return; }
    const from = { ...cam }, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const ls0 = Math.log(from.s), ls1 = Math.log(target.s);
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      setCam({ cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, s: Math.exp(ls0 + (ls1 - ls0) * e) });
      if (t < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }
  const MIN_READ = 0.8;
  function bboxOf(ids, pad = 60) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const id of ids) {
      const c = scene.stations[id];
      if (!c) continue;
      const r = c.label.rect;
      x0 = Math.min(x0, c.x - 20, r[0]); y0 = Math.min(y0, c.y - 20, r[1]);
      x1 = Math.max(x1, c.x + 20, r[2]); y1 = Math.max(y1, c.y + 20, r[3]);
    }
    if (x0 > x1) return { x: 0, y: 0, w: scene.width, h: scene.height };
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }
  // The whole map when it reads (names at 11px or more); else the line of the current step, and when
  // even that does not fit, the current step's stretch of it, at the reading scale.
  function fitAll(animate) {
    const b = { x: 0, y: 0, w: scene.width, h: scene.height };
    let c = camFor(b, 0, 1.2);
    if (c.s < MIN_READ) {
      const st = currentStep(), line = st && model.lineById[st.line];
      const lb = line ? bboxOf(line.stops, 30) : null;
      const cl = lb ? camFor(lb, 0, 1.2) : null;
      if (cl && cl.s >= MIN_READ) c = cl;
      else if (st) c = camFor(bboxOf([st.from, st.to], phone() ? 120 : 200), MIN_READ, MIN_READ);
      else c = camFor(b, MIN_READ, MIN_READ);
    }
    animate ? animateTo(c) : setCam(clampCam(c));
  }
  // the svg keeps its scale when its box changes (a phone's sheet, a resize): only the viewBox follows
  if (window.ResizeObserver) new ResizeObserver(() => { if (built && cam.s && box().width) setCam(clampCam(cam)); }).observe(svg);
  function focusOn(ids) {
    const c = camFor(bboxOf(ids, 48), 0, 1.15);
    animateTo(c.s >= 0.9 ? c : camFor(bboxOf(ids, 18), 0.9, 0.9));
  }
  function ensureVisible(pts) {
    const r = box(), reg = freeRegion(), s = cam.s;
    const vx = cam.cx - r.width / 2 / s, vy = cam.cy - r.height / 2 / s;
    let dx = 0, dy = 0;
    const m = 70;
    for (const [x, y] of pts) {
      const sx = (x - vx) * s, sy = (y - vy) * s;
      if (sx < reg.x0 + m) dx = Math.min(dx, sx - reg.x0 - m);
      if (sx > reg.x1 - m) dx = Math.max(dx, sx - reg.x1 + m);
      if (sy < reg.y0 + m) dy = Math.min(dy, sy - reg.y0 - m);
      if (sy > reg.y1 - m) dy = Math.max(dy, sy - reg.y1 + m);
    }
    if (dx || dy) animateTo({ ...cam, cx: cam.cx + dx / s, cy: cam.cy + dy / s }, 420);
  }
  function zoomAt(factor, px, py) {
    const r = box();
    const vx = cam.cx - r.width / 2 / cam.s, vy = cam.cy - r.height / 2 / cam.s;
    const fit = camFor({ x: 0, y: 0, w: scene.width, h: scene.height }, 0, 9).s;
    const ns = NX.clamp(cam.s * factor, fit * 0.7, 3.2);
    const mx = vx + px / cam.s, my = vy + py / cam.s;
    setCam(clampCam({ cx: mx + (r.width / 2 - px) / ns, cy: my + (r.height / 2 - py) / ns, s: ns }));
  }
  (function wirePan() {
    const pts = new Map();
    let start = null, moved = false;
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      start = { cam: { ...cam }, pts: new Map(pts) };
      moved = false;
      cancelAnimationFrame(anim);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const r = box();
      if (pts.size === 1) {
        const [x0, y0] = start.pts.get(e.pointerId) || [e.clientX, e.clientY];
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (!moved && Math.hypot(dx, dy) > 4) { moved = true; svg.classList.add('dragging'); try { svg.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } NX.ui.hideTip(); }
        if (moved) setCam(clampCam({ ...start.cam, cx: start.cam.cx - dx / start.cam.s, cy: start.cam.cy - dy / start.cam.s }));
      } else if (pts.size === 2 && start.pts.size === 2) {
        const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]);
        setCam(start.cam);
        zoomAt(d / d0, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        moved = true;
      }
    });
    const end = (e) => { pts.delete(e.pointerId); svg.classList.remove('dragging'); if (pts.size) start = { cam: { ...cam }, pts: new Map(pts) }; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('click', (e) => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      cancelAnimationFrame(anim);
      const r = box();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 0.6) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      else setCam(clampCam({ ...cam, cx: cam.cx + e.deltaX / cam.s, cy: cam.cy + e.deltaY / cam.s }));
    }, { passive: false });
  })();

  // ---------------------------------------------------------------- lines, steps and the current one
  function rideOrder(line) {
    const out = [];
    const alts = line.steps.filter((s) => s.alt);
    for (const s of line.steps) { if (s.alt) continue; out.push(s); for (const a of alts) if (a.alt.at === s.idx) out.push(a); }
    for (const a of alts) if (!out.includes(a)) out.push(a);
    return out;
  }
  const trackFor = (lineId, a, b) => { const key = a < b ? `${a}|${b}` : `${b}|${a}`; return scene.tracks.find((t) => t.line === lineId && t.key === key); };
  function trackDir(t) {
    const main = t.steps.filter((s) => !s.alt), use = main.length ? main : t.steps;
    const dirs = new Set(use.map((s) => (s.from === t.a ? 1 : -1)));
    return dirs.size === 1 ? [...dirs][0] : 0;
  }
  let badgeAt = {};
  function renderChevrons(id) {
    const g = svg.querySelector('#mpChev');
    if (!g) return;
    if (!id) { g.innerHTML = ''; return; }
    const line = model.lineById[id];
    const s = (line.kind === 'flow' ? ML.LOOK.line : ML.LOOK.paperLine) * 0.48;
    let h = '';
    for (const t of scene.tracks) {
      if (t.line !== id || !t.steps.length) continue;
      const dir = trackDir(t);
      if (!dir) continue;
      const pts = dir > 0 ? t.pts : [...t.pts].reverse();
      const n = Math.max(1, Math.round((ML.polyLength(pts) - 36) / 44));
      for (let k = 1; k <= n; k++) {
        const [x, y, a] = ML.pointAt(pts, k / (n + 1));
        const b = badgeAt[t.key];
        if (b && Math.abs(x - b.x) < b.w / 2 + 9 && Math.abs(y - b.y) < 20) continue;
        h += `<path d="M${(-s).toFixed(1)} ${(-s * 1.15).toFixed(1)}L${(s * 0.6).toFixed(1)} 0L${(-s).toFixed(1)} ${(s * 1.15).toFixed(1)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((a * 180) / Math.PI).toFixed(1)})"/>`;
      }
    }
    g.innerHTML = h;
  }
  // the chosen step, on its line (the deepest track of the step path)
  function currentStep() {
    const f = NX.topOf(NX.state.stack);
    const line = model.lineById[f.id];
    return line ? line.steps[f.i] : null;
  }
  // the numbers of the steps along the chosen line, where they cover no label
  function renderLine() {
    const g = svg.querySelector('#mpBadges');
    if (!g) return;
    const id = NX.state.line;
    badgeAt = {};
    if (!id || !model.lineById[id]) { g.innerHTML = ''; return; }
    const on = new Set(model.lineById[id].stops);
    const room = roomFinder({ labelWeight: (sid) => (on.has(sid) ? 100 : 18) });
    for (const [lid, tg] of Object.entries(originAt)) room.add(tg.r, lid === id ? 100 : 30);
    const cur = currentStep();
    let h = '';
    for (const t of scene.tracks.filter((x) => x.line === id && x.steps.length)) {
      const nums = t.steps.map((s) => (s.alt ? 'もし' : String(s.num)));
      const text = [...new Set(nums)].join('・');
      const w = Math.max(26, 12 + measure(text, 14, false) + 4), hh = 12.5;
      const cands = [];
      for (const f of [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8]) {
        const [x, y, a] = ML.pointAt(t.pts, f);
        cands.push({ x, y, r: [x - w / 2, y - hh, x + w / 2, y + hh], pref: Math.abs(f - 0.5) * 8 });
        const nx = -Math.sin(a), ny = Math.cos(a);
        const off = Math.abs(nx) * (w / 2 + 3) + Math.abs(ny) * (hh + 3);
        for (const sgn of [1, -1]) { const X = x + nx * off * sgn, Y = y + ny * off * sgn; cands.push({ x: X, y: Y, r: [X - w / 2, Y - hh, X + w / 2, Y + hh], pref: 6 + Math.abs(f - 0.5) * 8 }); }
      }
      const p = room.best(cands, 4);
      room.add(p.r, 100);
      badgeAt[t.key] = { x: p.x, y: p.y, w };
      const isCur = cur && t.steps.includes(cur);
      h += `<g class="ride-badge${isCur ? ' current' : ''}" data-key="${esc(t.key)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><rect x="${-w / 2}" y="${-hh}" width="${w}" height="${2 * hh}" rx="${hh}" fill="${lineVar(id)}"/><text y="0.5">${esc(text)}</text></g>`;
    }
    g.innerHTML = h;
  }
  function renderNow(animate) {
    const g = svg.querySelector('#mpNow'), fl = svg.querySelector('#mpFlash');
    if (!g) return;
    const st = currentStep();
    const t = st && trackFor(st.line, st.from, st.to);
    if (!t) { g.innerHTML = ''; fl.innerHTML = ''; return; }
    const col = lineVar(st.line);
    const pts = t.a === st.from ? t.pts : [...t.pts].reverse();
    const w = model.lineById[st.line].kind === 'flow' ? ML.LOOK.line : ML.LOOK.paperLine;
    fl.innerHTML = `<path class="flash" d="${t.d}" stroke="${col}" stroke-width="${w + 14}"/>`;
    if (NX.state.line === st.line) { g.innerHTML = ''; return; }
    // The number and the verb by the step's segment, at the nearest place that hides no name, station,
    // sign or district (a line may pass under it), on either side, up to ~90 units out with a leader;
    // where there is no such place, the number alone sits on the segment (the verb in its tooltip).
    const room = roomFinder({ trackWeight: 1 });
    for (const [, tg] of Object.entries(originAt)) room.add(tg.r, 100);
    for (const b of Object.values(badgeAt)) room.add([b.x - b.w / 2, b.y - 12.5, b.x + b.w / 2, b.y + 12.5], 100);
    const f = NX.topOf(NX.state.stack), tr = TR[f.id];
    const label = tr.labels[f.i], verb = st.verb || '';
    const H = 30, wv = 34 + (verb ? measure(verb, 14, false) + 14 : 0);
    let best = null;
    for (let k = 1; k <= 9; k++) {
      const fr = k / 10;
      const [x, y, a] = ML.pointAt(pts, fr);
      const nx = -Math.sin(a), ny = Math.cos(a);
      for (const sgn of [1, -1]) for (const extra of [8, 20, 34, 50, 68, 88]) {
        const off = Math.abs(nx) * (wv / 2 + extra) + Math.abs(ny) * (H / 2 + extra);
        const X = x + nx * off * sgn, Y = y + ny * off * sgn;
        const r = [X - wv / 2, Y - H / 2, X + wv / 2, Y + H / 2];
        if (room.hides(r, 3) > 0) continue;
        const v = room.lines(r, 2) * 3 + Math.abs(fr - 0.5) * 6 + extra / 10;
        if (!best || v < best.v) best = { x: X, y: Y, ax: x, ay: y, v };
      }
    }
    const [ex, ey] = pts[pts.length - 1];
    const tip = `<title>今の手順：${esc(tr.labels[f.i] + ' ' + NX.stepTitle(tr.steps[f.i]))}</title>`;
    let p;
    if (best) {
      p = best;
      g.innerHTML = `<g class="mp-now" style="--lc:${col}"><line x1="${p.ax.toFixed(1)}" y1="${p.ay.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="lead"/><circle cx="${ex}" cy="${ey}" r="12" class="arrive"/>
        <g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><rect x="${-wv / 2}" y="${-H / 2}" width="${wv}" height="${H}" rx="${H / 2}"/><circle cx="${-wv / 2 + 15}" cy="0" r="11" class="n"/><text class="nt" x="${-wv / 2 + 15}" y="0.5">${esc(label)}</text>${verb ? `<text class="vt" x="${-wv / 2 + 32}" y="0.5">${esc(verb)}</text>` : ''}</g>${tip}</g>`;
    } else {
      // on the segment, or just beside it, wherever it hides least
      let spot = null;
      for (let k = 1; k <= 9; k++) {
        const [x, y, a] = ML.pointAt(pts, k / 10);
        const nx = -Math.sin(a), ny = Math.cos(a);
        for (const off of [0, 16, -16, 28, -28, 42, -42]) {
          const X = x + nx * off, Y = y + ny * off;
          const v = room.hides([X - 12, Y - 12, X + 12, Y + 12], 1) * 10 + Math.abs(k / 10 - 0.5) + Math.abs(off) / 20;
          if (!spot || v < spot.v) spot = { x: X, y: Y, ax: x, ay: y, v };
        }
      }
      p = spot;
      const lead = Math.hypot(p.x - p.ax, p.y - p.ay) > 13 ? `<line x1="${p.ax.toFixed(1)}" y1="${p.ay.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="lead"/>` : '';
      g.innerHTML = `<g class="mp-now only" style="--lc:${col}">${lead}<circle cx="${ex}" cy="${ey}" r="12" class="arrive"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" class="n ring"/><text class="nt" x="${p.x.toFixed(1)}" y="${(p.y + 0.5).toFixed(1)}">${esc(label)}</text>${tip}</g>`;
    }
    if (animate) ensureVisible([[p.x, p.y], [ex, ey], [pts[0][0], pts[0][1]]]);
  }
  let hoverLine = null;
  function emphasis() {
    const focus = hoverLine || NX.state.line;
    const node = NX.state.node && model.stations[NX.state.node] ? NX.state.node : null;
    for (const g of NX.$$('.line-g', svg)) g.classList.toggle('dim', !!focus && g.dataset.line !== focus);
    if (focus) { const g = svg.querySelector(`.line-g[data-line="${CSS.escape(focus)}"]`); if (g) g.parentNode.append(g); }
    for (const sh of NX.$$('.shield', svg)) { sh.classList.toggle('dim', !!focus && sh.dataset.line !== focus); sh.classList.toggle('gone', !!NX.state.line && sh.dataset.line === NX.state.line); }
    for (const tg of NX.$$('.term-tag', svg)) tg.classList.toggle('dim', !!focus && tg.dataset.line !== focus);
    const on = focus && model.lineById[focus] ? new Set(model.lineById[focus].stops) : null;
    for (const el of NX.$$('.mt-station, .mt-label', svg)) {
      el.classList.toggle('dim', !!on && !on.has(el.dataset.st));
      el.classList.toggle('selected', el.dataset.st === node);
    }
    renderChevrons(focus);
  }

  // ---------------------------------------------------------------- the side: lines, then the chosen line's timetable
  function stBtn(id) {
    const s = model.stations[id];
    const name = s ? s.name : NX.title(id);
    return `<button type="button" class="mp-st${s && s.codeName ? ' code' : ''}" data-node="${esc(id)}">${s && s.ns ? `<span class="ns">${esc(s.ns)}${s.nsDot ? '.' : ' '}</span>` : ''}${esc(name)}</button>`;
  }
  function timetableHTML(line) {
    const order = rideOrder(line);
    const cur = currentStep();
    let h = `<section class="mp-tt" style="--lc:${lineVar(line.id)}"><header class="mp-tt-h"><span class="mp-badge${line.kind === 'paper' ? ' paper' : ''}">${esc(line.code)}</span><div class="mp-tt-t"><p class="eyebrow">${line.kind === 'flow' ? '本線・流れ' : '支線・中の紙'}　時刻表</p><h3 class="${line.kind === 'paper' ? 'code' : ''}">${esc(line.kind === 'flow' ? line.name : line.tab)}</h3></div>
      <button class="btn small primary" type="button" data-walk="${esc(line.id)}">${NX.ICON.play}1 から歩く</button></header><ol class="mp-rows">`;
    if (line.parent && line.entry) h += `<li class="mp-row link"><span class="mp-num">入</span><div><div class="mp-route">${stBtn(line.parent)}<span class="ar">→</span>${stBtn(line.entry)}</div><p class="mp-label">${esc(NX.title(line.parent))} の中に入る</p></div></li>`;
    order.forEach((st) => {
      const isCur = cur === st;
      h += `<li class="mp-row${st.alt ? ' alt' : ''}${isCur ? ' now' : ''}" data-step="${esc(line.id)}|${st.idx}"><span class="mp-num">${esc(TR[line.id].labels[st.idx])}</span><div><div class="mp-route">${stBtn(st.from)}<span class="ar">→</span>${stBtn(st.to)}</div><p class="mp-what"><span class="mp-kind">${NX.kindIcon(st.kind)}${esc(st.kindName)}</span>${st.verb ? `<b>${esc(st.verb)}</b>` : ''}${st.alt ? `<span class="tag alt">もし${esc(st.alt.when)}</span>` : ''}</p><p class="mp-label ja">${NX.linkify(st.label, { br: false })}</p>${(() => { const dr = NX.driftOf(line.id, st.idx); return dr ? `<p class="mp-drift" title="${esc(dr.count)}"><span class="dr-i" aria-hidden="true">!</span>${esc(dr.title)}</p>` : ''; })()}</div></li>`;
    });
    for (const p of line.ports) h += `<li class="mp-row link"><span class="mp-num">出</span><div><div class="mp-route">${stBtn(p.inner)}<span class="ar">→</span>${stBtn(p.outer)}</div><p class="mp-label">ここで外の流れの ${esc(NX.title(p.outer))} につながる</p></div></li>`;
    return h + '</ol></section>';
  }
  function sideHTML() {
    const id = NX.state.line;
    const item = (l) => {
      const parent = l.parent ? model.stations[l.parent] : null;
      const name = l.kind === 'flow' ? l.name : l.tab;
      const sub = l.kind === 'flow' ? l.title : `${parent ? parent.name : ''} の中・${TR[l.id] ? NX.countText(TR[l.id]) : ''}`;
      return `<li><button class="mp-ln${id === l.id ? ' on' : ''}" type="button" data-line="${esc(l.id)}" style="--lc:${lineVar(l.id)}" aria-pressed="${id === l.id}"><span class="mp-badge${l.kind === 'paper' ? ' paper' : ''}">${esc(l.code)}</span><span class="mp-lt"><span class="mp-ln-name${l.kind === 'paper' ? ' code' : ''}">${esc(name)}</span><span class="mp-ln-sub">${esc(sub)}</span></span></button></li>`;
    };
    const sel = id && model.lineById[id];
    let h = `<button type="button" class="mp-sheet-h" data-sheet aria-expanded="${sheetOpen}"><span class="mp-grip" aria-hidden="true"></span><b>${sel ? `${esc(sel.code)} 線の時刻表` : '路線と記号'}</b><span>${sheetOpen ? 'たたむ' : '開く'}</span></button>`;
    h += `<div class="mp-head"><h2>路線図</h2><p>流れと中の紙を路線に、節を駅にした全体図。帯は層、2 本以上が止まる駅は乗り換え駅。</p>${layoutNote ? `<p class="mp-note">${esc(layoutNote)}</p>` : ''}</div>`;
    if (id && model.lineById[id]) {
      h += `<button class="btn small ghost mp-back" type="button" data-line="${esc(id)}">${NX.ICON.left}路線の一覧</button>` + timetableHTML(model.lineById[id]);
      return h;
    }
    h += `<p class="mp-cap">本線（流れ）</p><ul class="mp-lines">${model.lines.filter((l) => l.kind === 'flow').map(item).join('')}</ul>`;
    h += `<p class="mp-cap">支線（節の中の紙）</p><ul class="mp-lines">${model.lines.filter((l) => l.kind === 'paper').map(item).join('')}</ul>`;
    h += `<p class="mp-cap">記号</p><ul class="mp-sym">
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><line x1="3" x2="35" y1="9" y2="9" stroke="var(--text-2)" stroke-width="5" stroke-linecap="round"/><circle cx="19" cy="9" r="5.5" fill="var(--surface)" stroke="var(--text-2)" stroke-width="3"/></svg>駅（関数・置き場）。押すと節のカード</li>
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><rect x="6" y="2.5" width="26" height="13" rx="6.5" fill="var(--surface)" stroke="var(--text)" stroke-width="2.5"/></svg>乗り換え駅（2 本以上が止まる）</li>
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><rect x="1" y="2" width="36" height="14" rx="7" fill="var(--surface)" stroke="var(--text-2)" stroke-width="1.5"/><circle cx="9" cy="9" r="5" fill="var(--text-2)"/></svg>始発の札。押すと手順 1 から歩く</li>
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><line x1="3" x2="35" y1="9" y2="9" stroke="var(--text-2)" stroke-width="5" stroke-dasharray="7 5"/></svg>もし（列が満杯のときだけ）</li>
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><line x1="4" x2="34" y1="9" y2="9" stroke="var(--text-2)" stroke-width="8" stroke-linecap="round"/><line x1="4" x2="34" y1="9" y2="9" stroke="var(--surface)" stroke-width="4.2" stroke-linecap="round"/></svg>紙の入口（親の駅から中へ）</li>
      <li><svg viewBox="0 0 38 18" aria-hidden="true"><rect x="2" y="2" width="34" height="14" rx="7" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/></svg>今の手順（ほかの見方と同じ）</li>
    </ul>`;
    return h;
  }
  let sheetOpen = false;
  function renderSide() {
    $('#mpSide').classList.toggle('open', sheetOpen);
    $('#mpSide').innerHTML = sideHTML();
    const now = $('#mpSide .mp-row.now');
    if (now) now.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- render, events
  let fitted = false;
  V.render = (changed = {}) => {
    if (!built) build();
    if (changed.all || changed.theme || !svg.firstChild) { render(); }
    renderSide();
    // fit after the side is drawn: the svg's box is its final size
    if (!fitted && box().width) { fitAll(false); fitted = true; }
    renderLine();
    emphasis();
    renderNow(!!changed.stack);
    const f = NX.topOf(NX.state.stack), t = TR[f.id];
    $('#mpHint').innerHTML = `今の手順：<b>${esc(NX.trackName(t))} の ${esc(t.labels[f.i])}</b>（${esc(NX.stepTitle(t.steps[f.i]))}）を線の上に出しています`;
  };
  V.onNode = () => { if (built) emphasis(); };
  V.onResize = () => { if (built) { fitAll(false); V.render({}); } };
  function walkLine(id) {
    const line = model.lineById[id];
    const st = line.kind === 'flow' ? NX.firstStack(id) : NX.paperEntry(id);
    if (st) { NX.walk.stopPlay(); NX.set({ stack: st, view: 'walk', line: null }, { push: true }); }
  }
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-sheet]')) { sheetOpen = !sheetOpen; renderSide(); return; }
    const zoom = t.closest('[data-zoom]');
    if (zoom) { const r = box(); if (zoom.dataset.zoom === 'fit') fitAll(true); else zoomAt(zoom.dataset.zoom === 'in' ? 1.3 : 1 / 1.3, r.width / 2, r.height / 2); return; }
    const walk = t.closest('[data-walk]');
    if (walk) { walkLine(walk.dataset.walk); return; }
    if (t.closest('button.chip[data-node], .mp-st[data-node]')) return;
    const term = t.closest('.term-tag');
    if (term) { walkLine(term.dataset.line); return; }
    const row = t.closest('.mp-row[data-step]');
    if (row) {
      const [lid, i] = row.dataset.step.split('|');
      const st = NX.stackOfStep(lid, Number(i));
      if (st) NX.set({ stack: st }, { push: true });
      return;
    }
    const badge = t.closest('.ride-badge');
    if (badge && NX.state.line) {
      const tr = scene.tracks.find((x) => x.line === NX.state.line && x.key === badge.dataset.key);
      const s = tr && tr.steps[0];
      if (s) { const st = NX.stackOfStep(NX.state.line, s.idx); if (st) NX.set({ stack: st }, { push: true }); }
      return;
    }
    const ln = t.closest('.mp-ln, .mp-back, .hit');
    if (ln) {
      const id = ln.dataset.line;
      if (ln.classList.contains('hit') && NX.state.line === id) {
        const tr = scene.tracks.find((x) => x.line === id && x.key === ln.dataset.key);
        const s = tr && (tr.steps.find((x) => !x.alt) || tr.steps[0]);
        if (s) { const st = NX.stackOfStep(id, s.idx); if (st) NX.set({ stack: st }, { push: true }); }
        return;
      }
      const next = NX.state.line === id && !ln.classList.contains('hit') ? null : id;
      if (next && phone() && !ln.classList.contains('hit')) sheetOpen = false;
      NX.set({ line: next }, { push: true });
      if (next) focusOn(model.lineById[id].stops); else fitAll(true);
      return;
    }
    const stn = t.closest('.mt-station, .mt-label');
    if (stn) { NX.ui.openNode(stn.dataset.st); return; }
    if (t.closest('#mpSvg') && NX.state.line) { NX.set({ line: null }, { push: true }); fitAll(true); }
  });
  svg.addEventListener('mouseover', (e) => {
    const hit = e.target.closest('.hit, .term-tag');
    const id = hit ? hit.dataset.line : null;
    if (id !== hoverLine && !NX.state.line) { hoverLine = id; emphasis(); }
    const st = e.target.closest('.mt-station, .mt-label');
    if (st) {
      const s = model.stations[st.dataset.st];
      NX.ui.showTip(e.clientX, e.clientY, `<b class="${s.codeName ? 'mono' : ''}">${esc(s.ns ? s.ns + (s.nsDot ? '.' : ' ') : '')}${esc(s.name)}</b>${s.sub ? `<div>${esc(s.sub)}</div>` : ''}<div class="tip-k">${esc(MM.KIND_NAME[s.kind] || s.kind)}・${s.lines.map((l) => model.lineById[l].code).join(' ')} 線　押すと節のカード</div>`);
    } else if (hit && hit.classList.contains('hit')) {
      const l = model.lineById[hit.dataset.line], tr = scene.tracks.find((x) => x.line === hit.dataset.line && x.key === hit.dataset.key);
      const what = tr.type === 'link' ? '紙の入口' : tr.steps.map((s) => `${s.alt ? 'もし' : s.num}${s.verb ? ' ' + s.verb : ''}`).join('、');
      NX.ui.showTip(e.clientX, e.clientY, `<b>${esc(l.code)}　${esc(l.kind === 'flow' ? l.name : l.title)}</b><div>${esc(what)}</div><div class="tip-k">押すと時刻表</div>`);
    } else NX.ui.hideTip();
  });
  svg.addEventListener('mouseleave', () => { hoverLine = null; if (built) emphasis(); NX.ui.hideTip(); });
  V.onKey = (e) => {
    if (e.key === '0') { fitAll(true); return true; }
    if (e.key === '+' || e.key === '=') { const r = box(); zoomAt(1.3, r.width / 2, r.height / 2); return true; }
    if (e.key === '-') { const r = box(); zoomAt(1 / 1.3, r.width / 2, r.height / 2); return true; }
    if (e.key === 'Escape' && NX.state.line && !NX.state.node) { NX.set({ line: null }, { push: true }); fitAll(true); return true; }
    return false;
  };
})();
