import { buildModel, parseLinks, layoutSignature, KIND_NAME } from "./model.js";
import { gridProblem, initialState, warmState, anneal, buildScene, pointAt, polyLength, segHitsRect, LOOK, LINE_H } from "./layout.js";
import { initReplay } from "./replay.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const NS = "http://www.w3.org/2000/svg";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (n) => n.toLocaleString("ja-JP");

const atlas = window.ATLAS;
const model = buildModel(atlas, window.ATLAS_CODE);
const P = gridProblem(model);
const lineVar = (id) => `var(--l-${model.lineById[id].code})`;
const FONT_STACK = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
const MONO_STACK = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim();

// ---------------------------------------------------------------- colours of the lines
{
  const light = model.lines.map((l) => `--l-${l.code}:${l.colour.light}`).join(";");
  const dark = model.lines.map((l) => `--l-${l.code}:${l.colour.dark}`).join(";");
  const st = document.createElement("style");
  st.textContent = `:root{${light}}@media (prefers-color-scheme: dark){:root{${dark}}}`;
  document.head.append(st);
}

// ---------------------------------------------------------------- layout
const canvas = document.createElement("canvas").getContext("2d");
const measure = (text, size, mono) => {
  canvas.font = mono ? `600 ${size - 0.1}px ${MONO_STACK}` : size >= 14 ? `650 ${size}px ${FONT_STACK}` : `400 ${size}px ${FONT_STACK}`;
  return canvas.measureText(text).width;
};

// The stored grid (layout.data.js, from tools/precompute.mjs) is used as long as it still covers the
// map: every station has a cell inside its district and every pair of stations the lines run between
// has its bend. Names and subs do not matter (labels are placed here). When the map has changed, the
// stored cells are the starting point and only the new or misplaced stations look for a place, so
// the map keeps its designed shape instead of being laid out from nothing.
function storedLayout() {
  const L = window.METRO_LAYOUT;
  if (!L) return null;
  const n = P.stations.length;
  const X = new Int32Array(n).fill(-1), Y = new Int32Array(n).fill(-1);
  const forget = new Set((new URLSearchParams(location.search).get("forget") || "").split(",").filter(Boolean));
  // Districts may have gained or lost rows since: keep each station's row within its district.
  const zoneNow = Object.fromEntries(P.zones.map((z) => [z.id, z]));
  const zoneThen = L.zones || Object.fromEntries(P.zones.map((z) => [z.id, [z.r0, z.r1]]));
  const seen = new Set();
  let ok = true;
  P.stations.forEach((s, i) => {
    const v = L.stations[s.id];
    if (!v || forget.has(s.id)) { ok = false; return; }
    const then = zoneThen[s.layer], now = zoneNow[s.layer];
    let y = v[1];
    if (then && now && then[0] !== now.r0) { y = v[1] - then[0] + now.r0; ok = false; }
    const key = v[0] * 4096 + y;
    if (y < P.rowMin[i] || y > P.rowMax[i] || v[0] < 0 || v[0] >= P.cols || seen.has(key)) { ok = false; return; }
    seen.add(key);
    X[i] = v[0];
    Y[i] = y;
  });
  if (!P.edges.every((e) => e.key in L.bends)) ok = false;
  const B = Uint8Array.from(P.edges.map((e) => L.bends[e.key] ?? 0));
  return { X, Y, B, ok };
}

async function loadState() {
  const q = new URLSearchParams(location.search);
  // ?relayout: lay out from nothing; ?relayout=warm (or ?forget=id,id): start from the stored grid.
  const force = q.has("relayout") ? (q.get("relayout") === "warm" ? "warm" : "cold") : q.has("forget") ? "warm" : null;
  const stored = storedLayout();
  if (!force && stored?.ok) return { ...stored, stored: true };
  const sig = layoutSignature(model);
  const cacheKey = `metro-layout:${sig}`;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (c && c.X.length === P.stations.length) return { X: Int32Array.from(c.X), Y: Int32Array.from(c.Y), B: Uint8Array.from(c.B), cached: true };
    } catch { /* no storage */ }
  }
  const warm = force !== "cold" && stored ? { X: [...stored.X], Y: [...stored.Y], B: [...stored.B] } : null;
  const note = document.createElement("div");
  note.className = "loading";
  note.innerHTML = `<div><b>路線図を並べ直しています</b><span>${warm ? "地図の中身が保存した配置と少し違うため、保存した配置から始めて、変わった駅だけ置き直します。" : "保存した配置がないため、この場で配置を計算します。"}</span><i><em></em></i></div>`;
  document.querySelector("#map-wrap").append(note);
  const bar = note.querySelector("em");
  const job = warm ? { start: warm, iterations: 6000, seeds: [1, 2], t0: 3 } : { iterations: 8000, seeds: [1, 2] };
  const fallback = () => (warm ? anneal(P, warmState(P, model, warm), { iterations: 2500, seed: 7, t0: 3 }).state : anneal(P, initialState(P, model), { iterations: 4000, seed: 7 }).state);
  const done = await new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL("./layout-worker.js", import.meta.url), { type: "module" }); }
    catch { w = null; }
    if (!w) { resolve(fallback()); return; }
    w.onmessage = (e) => {
      if (e.data.progress) bar.style.width = `${Math.round(e.data.progress * 100)}%`;
      if (e.data.done) { w.terminate(); resolve({ X: Int32Array.from(e.data.X), Y: Int32Array.from(e.data.Y), B: Uint8Array.from(e.data.B) }); }
    };
    w.onerror = () => resolve(fallback());
    w.postMessage({ atlas, code: window.ATLAS_CODE, ...job });
  });
  note.remove();
  if (!force) {
    try { localStorage.setItem(cacheKey, JSON.stringify({ X: [...done.X], Y: [...done.Y], B: [...done.B] })); } catch { /* full or off */ }
  }
  return { ...done, relaid: warm ? "warm" : "cold" };
}
const state = await loadState();
const scene = buildScene(model, P, state, measure);

// ---------------------------------------------------------------- app state
const ui = {
  line: null, // selected line id
  station: null, // selected station or node id
  step: null, // index into the line's ride order
  playing: false,
  riders: false,
  hoverLine: null,
};
const svg = $("#map");
const panel = $("#panel");
const legend = $("#legend");
const tip = $("#tip");

// ---------------------------------------------------------------- the map
function stationShape(c, extra = 0) {
  const m = c.mark;
  if (m.type === "dot") return `<circle cx="${m.x}" cy="${m.y}" r="${m.r + extra}"/>`;
  const ang = (Math.atan2(m.ay, m.ax) * 180) / Math.PI;
  const w = 2 * (m.half + extra), h = 2 * (m.r + extra);
  return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" transform="translate(${m.x} ${m.y}) rotate(${ang})"/>`;
}

function labelSVG(s, compact = isCompact) {
  const c = scene.stations[s.id];
  const L = compact ? c.labelCompact : c.label;
  const [x0, y0, x1] = L.rect;
  const anchor = L.side.includes("E") || L.side.endsWith(">") ? "start" : L.side.includes("W") || L.side.endsWith("<") ? "end" : "middle";
  const x = anchor === "start" ? x0 : anchor === "end" ? x1 : (x0 + x1) / 2;
  // name; then the namespace (small, mono) like the reference viewer's boxes; then the sub line
  let y = y0 + 14;
  let t = `<text class="nm${s.codeName ? " code" : ""}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.name)}</text>`;
  if (s.ns && (L.variant === "full" || L.variant === "ns")) {
    y += LINE_H.ns;
    t += `<text class="ns" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.ns)}</text>`;
  }
  if (s.sub && (L.variant === "full" || L.variant === "sub")) {
    y += LINE_H.sub;
    t += `<text class="sb" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s.sub)}</text>`;
  }
  return `<g class="label" data-st="${esc(s.id)}">${t}</g>`;
}

function renderMap() {
  const sc = scene;
  let h = `<defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    <linearGradient id="fade-left"><stop offset="0" style="stop-color:var(--map);stop-opacity:0.95"/><stop offset="1" style="stop-color:var(--map);stop-opacity:0"/></linearGradient>
  </defs>`;
  // districts
  h += `<g class="zones">`;
  for (const z of sc.zones) {
    h += `<rect class="zone-band" x="-4000" y="${z.y0}" width="${sc.width + 8000}" height="${z.y1 - z.y0}" fill="var(--z-${z.id})"/>`;
    h += `<line class="zone-rule" x1="-4000" x2="${sc.width + 4000}" y1="${z.y1}" y2="${z.y1}"/>`;
    h += `<rect class="zone-swatch" x="0" y="${z.y0}" width="5" height="${z.y1 - z.y0}" fill="var(--zs-${z.id})"/>`;
  }
  h += `</g>`;
  // tracks, one group per line so a line can be lifted or faded as a whole
  const order = [...model.lines].reverse();
  h += `<g class="tracks">`;
  for (const line of order) {
    h += `<g class="line-g" data-line="${esc(line.id)}" style="--lc:${lineVar(line.id)}">`;
    for (const t of sc.tracks.filter((t) => t.line === line.id)) {
      // branch lines (papers) a little thinner than the two main lines
      const w = line.kind === "flow" ? LOOK.line : LOOK.paperLine;
      if (t.type === "link") {
        h += `<path class="track track-link" d="${t.d}" stroke="var(--lc)" stroke-width="${(w + 3.4).toFixed(1)}"/>`;
        h += `<path class="track-link-core" d="${t.d}" stroke-width="${(w - 0.2).toFixed(1)}"/>`;
      } else {
        h += `<path class="track${t.type === "alt" ? " track-alt" : ""}" d="${t.d}" stroke="var(--lc)" stroke-width="${w}"/>`;
      }
    }
    h += `</g>`;
  }
  h += `</g><g id="chevrons"></g><g class="hits">`;
  for (const t of sc.tracks) h += `<path class="hit" d="${t.d}" data-line="${esc(t.line)}" data-key="${esc(t.key)}"/>`;
  h += `</g><g class="riders" id="riders"></g><g id="flash"></g><g class="stations">`;
  for (const s of Object.values(model.stations)) {
    const c = sc.stations[s.id];
    const stroke = c.mark.type === "dot" ? ` stroke="${lineVar(s.lines[0])}"` : "";
    const cls = c.mark.type === "dot" ? `dot${c.mark.paper ? " minor" : ""}` : "pill";
    h += `<g class="station" data-st="${esc(s.id)}"><circle class="tap" cx="${c.x}" cy="${c.y}" r="20"/><g class="halo-ring">${stationShape(c, 5)}</g><g class="${cls}"${stroke}>${stationShape(c)}</g></g>`;
  }
  h += `</g><g id="shields">`;
  shields = computeShields();
  for (const sh of shields) {
    const l = model.lineById[sh.line];
    const paper = l.kind === "paper";
    h += `<g class="shield" data-line="${esc(sh.line)}" transform="translate(${sh.x.toFixed(1)} ${sh.y.toFixed(1)})"><circle r="12" fill="${paper ? "var(--map)" : lineVar(sh.line)}" stroke="${lineVar(sh.line)}" stroke-width="${paper ? 3 : 2}"/><text fill="${paper ? lineVar(sh.line) : "#fff"}">${esc(l.code)}</text></g>`;
  }
  h += `</g><g class="labels">`;
  for (const s of Object.values(model.stations)) h += labelSVG(s);
  // the train runs under the step badges, so a parked train never hides the current step's number
  h += `</g><g id="decor">${originTags()}</g><g id="train"></g><g id="badges"></g><g id="rider-nums"></g><g id="zone-labels">`;
  for (const z of sc.zones) {
    const mid = (z.y0 + z.y1) / 2;
    h += `<g class="zone-label"><text class="zone-name" x="18" y="${mid - 2}" fill="var(--zt-${z.id})">${esc(z.name)}</text>`;
    h += `<text class="zone-sub" x="18" y="${mid + 16}">${esc(z.sub)}</text></g>`;
    // the strip: shown at the left edge while the map is panned past the district names
    const hgt = z.y1 - z.y0;
    const nameFits = measure(z.name, 12.5, false) + 12 < hgt;
    // a soft fade right of the strip, so labels the edge cuts fade out instead of ending in a fragment
    h += `<g class="zone-strip"><rect class="zs-fade" x="22" y="${z.y0}" width="34" height="${hgt}" fill="url(#fade-left)"/><rect class="zs-bg" x="0" y="${z.y0}" width="22" height="${hgt}"/><rect x="0" y="${z.y0}" width="22" height="${hgt}" fill="var(--z-${z.id})"/>`;
    h += `<rect x="20" y="${z.y0}" width="3" height="${hgt}" fill="var(--zs-${z.id})"/>`;
    if (nameFits) h += `<text class="zs-name" transform="translate(11.5 ${mid}) rotate(-90)" fill="var(--zt-${z.id})">${esc(z.name)}</text>`;
    h += `</g>`;
  }
  h += `</g>`;
  svg.innerHTML = h;
  zoneLabels = null;
}

// ---------------------------------------------------------------- route shields
// A letter badge on each line's longest clear straight piece, so lines can be told apart on the map.
function computeShields() {
  const out = [];
  const labelRects = Object.values(scene.stations).map((c) => c.label.rect);
  const boxes = Object.values(scene.stations).map((c) => c.box);
  const R = 11;
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
    for (const t of scene.tracks.filter((t) => t.line === line.id && t.type === "step")) {
      for (let i = 1; i < t.pts.length; i++) {
        const [ax, ay] = t.pts[i - 1], [bx, by] = t.pts[i];
        pieces.push({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) });
      }
    }
    pieces.sort((a, b) => b.len - a.len);
    let placed = 0;
    const want = line.kind === "flow" ? 2 : 1;
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
let shields = [];
let isCompact = false;

// ---------------------------------------------------------------- room for overlays
// Count chips, terminus tags, port tags and step badges go where they cover no label, no station
// mark, no route letter and no district name; tags also keep off the track. The same rule the
// station labels follow, so the map's "nothing covers a label" holds with every overlay on.
function roomFinder({ trackWeight = 0, skipLines = null, labelWeight = () => 100 } = {}) {
  const rects = [];
  for (const [id, c] of Object.entries(scene.stations)) {
    // the placement on screen now (overlays are placed again when the scale switches it)
    rects.push([...(isCompact ? c.labelCompact : c.label).rect, labelWeight(id)]);
    rects.push([...c.box, 60]);
  }
  for (const sh of shields) rects.push([sh.x - 13, sh.y - 13, sh.x + 13, sh.y + 13, 40]);
  for (const z of scene.zones) {
    const mid = (z.y0 + z.y1) / 2;
    rects.push([12, mid - 20, 18 + Math.max(measure(z.name, 15.5, false), measure(z.sub || "", 12.5, false)) + 6, mid + 22, 80]);
  }
  const segs = [];
  if (trackWeight) {
    for (const t of scene.tracks) {
      if (skipLines?.has(t.line)) continue;
      for (let i = 1; i < t.pts.length; i++) segs.push([...t.pts[i - 1], ...t.pts[i]]);
    }
  }
  const R = [0, 0, 0, 0];
  const room = {
    add(r, w = 100) { rects.push([r[0], r[1], r[2], r[3], w]); },
    // a leader line from a station to its tag: it should not cross a label either
    segCost(ax, ay, bx, by) {
      let v = 0;
      for (const q of rects) if (q[4] >= 80 && segHitsRect(ax, ay, bx, by, q)) v += q[4];
      return v;
    },
    cost(r, pad = 2) {
      let v = 0;
      for (const q of rects) if (r[0] - pad < q[2] && q[0] - pad < r[2] && r[1] - pad < q[3] && q[1] - pad < r[3]) v += q[4];
      if (segs.length) {
        R[0] = r[0] - pad; R[1] = r[1] - pad; R[2] = r[2] + pad; R[3] = r[3] + pad;
        for (const s of segs) if (segHitsRect(s[0], s[1], s[2], s[3], R)) v += trackWeight;
      }
      if (r[0] < 4 || r[1] < 4 || r[2] > scene.width - 4 || r[3] > scene.height - 4) v += 50;
      return v;
    },
    best(cands, pad) {
      let pick = null;
      for (const c of cands) {
        const v = room.cost(c.r, c.pad ?? pad) + (c.pref || 0);
        if (!pick || v < pick.v) pick = { ...c, v };
      }
      return pick;
    },
  };
  return room;
}
// Candidate centres for a w×h tag around a station: just off its mark, then a little further.
function spotsAround(c, w, h, steps = [0, 12, 26]) {
  const b = c.box, hw = (b[2] - b[0]) / 2, hh = (b[3] - b[1]) / 2, g = 4;
  const base = [
    [1, 0, 0], [-1, 0, 0.4], [0, -1, 0.3], [0, 1, 0.3], [1, -1, 0.7], [-1, -1, 0.8], [1, 1, 0.7], [-1, 1, 0.8],
  ];
  const out = [];
  for (const extra of steps) {
    for (const [dx, dy, p] of base) {
      // beside the mark, also nudged a little up or down (a label or a line often sits just there)
      for (const nudge of dx && !dy ? [0, -7, 7] : [0]) {
        const x = c.x + dx * (hw + g + w / 2 + extra);
        const y = c.y + dy * (hh + g + h / 2 + extra) + nudge;
        out.push({ x, y, dx, dy, r: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], pref: p + extra / 8 + Math.abs(nudge) / 20 });
      }
    }
  }
  return out;
}

// 始発: where each flow starts, so the map alone says where to begin reading and which way.
function originTags() {
  const room = roomFinder({ trackWeight: 30 });
  let h = "";
  for (const line of model.lines.filter((l) => l.kind === "flow")) {
    const c = scene.stations[line.origin];
    if (!c) continue;
    const text = "始発";
    const w = 24 + measure(text, 12.5, false) + 12, hgt = 24;
    const p = room.best(spotsAround(c, w, hgt), 1);
    room.add(p.r, 100);
    const col = lineVar(line.id);
    // a short leader when the tag stands off the mark
    const ex = p.x - p.dx * (w / 2), ey = p.y - p.dy * (hgt / 2);
    // from the edge of the station's mark (not its centre) to the tag
    const len = Math.hypot(ex - c.x, ey - c.y) || 1, ux = (ex - c.x) / len, uy = (ey - c.y) / len;
    const edge = Math.min(Math.abs(ux) > 1e-6 ? (c.box[2] - c.x) / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? (c.box[3] - c.y) / Math.abs(uy) : 1e9);
    const lead = len > edge + 6
      ? `<path class="tag-lead" d="M${(c.x + ux * edge).toFixed(1)} ${(c.y + uy * edge).toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${col}"/>` : "";
    h += `<g class="term-tag" data-line="${esc(line.id)}" role="button" aria-label="${esc(line.name)}の始発（押すと 1 から乗る）">${lead}<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
      <rect x="${-w / 2}" y="${-hgt / 2}" width="${w}" height="${hgt}" rx="${hgt / 2}" stroke="${col}"/>
      <circle cx="${-w / 2 + 12}" cy="0" r="8.5" fill="${col}"/><text class="tt-code" x="${-w / 2 + 12}" y="0">${esc(line.code)}</text>
      <text class="tt-word" x="${-w / 2 + 25}" y="0" fill="${col}">${text}</text></g></g>`;
    originAt[line.id] = p;
  }
  return h;
}
const originAt = {};

// Which way a line runs along a pair of stations: +1 a→b, -1 b→a, 0 both ways (or nothing).
function trackDir(t) {
  const main = t.steps.filter((s) => !s.alt);
  const use = main.length ? main : t.steps;
  const dirs = new Set(use.map((s) => (s.from === t.a ? 1 : -1)));
  return dirs.size === 1 ? [...dirs][0] : 0;
}
// Small chevrons inside the hovered or selected line: the direction of travel, step by step.
function renderChevrons() {
  const g = $("#chevrons", svg);
  if (!g) return;
  const id = ui.hoverLine || ui.line;
  if (!id || document.body.classList.contains("replaying")) { g.innerHTML = ""; return; }
  const line = model.lineById[id];
  const s = (line.kind === "flow" ? LOOK.line : LOOK.paperLine) * 0.48;
  let h = "";
  for (const t of scene.tracks) {
    if (t.line !== id || !t.steps.length) continue;
    const dir = trackDir(t);
    if (!dir) continue;
    const pts = dir > 0 ? t.pts : [...t.pts].reverse();
    const L = polyLength(pts);
    const n = Math.max(1, Math.round((L - 36) / 44));
    const badge = ui.line === id ? badgeAt[t.key] : null;
    for (let k = 1; k <= n; k++) {
      const [x, y, a] = pointAt(pts, k / (n + 1));
      if (badge && Math.abs(x - badge.x) < badge.w / 2 + 9 && Math.abs(y - badge.y) < 20) continue;
      h += `<path d="M${(-s).toFixed(1)} ${(-s * 1.15).toFixed(1)}L${(s * 0.6).toFixed(1)} 0L${(-s).toFixed(1)} ${(s * 1.15).toFixed(1)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((a * 180) / Math.PI).toFixed(1)})"/>`;
    }
  }
  g.innerHTML = h;
}
let badgeAt = {};

// ---------------------------------------------------------------- viewport
// The camera is a centre and a scale (screen px per map px); the viewBox follows the element's size.
let cam = { cx: scene.width / 2, cy: scene.height / 2, s: 1 };
let anim = null;
const box = () => svg.getBoundingClientRect();
let zoneLabels = null;
// Keep the map from drifting out of the free region (the part not under the panel).
function clampCam(c) {
  const r = box(), reg = freeRegion();
  const left = c.cx - r.width / 2 / c.s, top = c.cy - r.height / 2 / c.s;
  const m = 24;
  const L = -left * c.s, R = (scene.width - left) * c.s, T = -top * c.s, B = (scene.height - top) * c.s;
  // Larger than the region: no gap at either edge. Smaller: stay wholly inside it.
  const fix = (lo, hi, r0, r1) => {
    if (hi - lo >= r1 - r0 - 2 * m) {
      if (lo > r0 + m) return lo - (r0 + m);
      if (hi < r1 - m) return hi - (r1 - m);
      return 0;
    }
    if (lo < r0 + m) return lo - (r0 + m);
    if (hi > r1 - m) return hi - (r1 - m);
    return 0;
  };
  const dx = fix(L, R, reg.x0, reg.x1), dy = fix(T, B, reg.y0, reg.y1);
  return { ...c, cx: c.cx + dx / c.s, cy: c.cy + dy / c.s };
}
function setCam(c) {
  cam = c;
  const r = box();
  const w = r.width / c.s, h = r.height / c.s;
  const x = c.cx - w / 2, y = c.cy - h / 2;
  svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  // District names stay readable at the left edge while the map is panned.
  if (!zoneLabels) zoneLabels = svg.querySelector("#zone-labels");
  // Below this scale the second lines would fall under 11px: show names only.
  const compact = c.s < 0.88;
  svg.classList.toggle("compact", compact);
  if (compact !== isCompact) {
    // names only: switch to the placement made for names alone
    isCompact = compact;
    const g = svg.querySelector(".labels");
    if (g) {
      g.innerHTML = Object.values(model.stations).map((s) => labelSVG(s)).join("");
      // the overlays keep clear of the labels as they are now
      const d = svg.querySelector("#decor");
      if (d) d.innerHTML = originTags();
      if (ui.line) renderBadges();
      if (ui.riders) renderRiders();
      applyEmphasis();
    }
  }
  if (zoneLabels) {
    const dx = Math.max(0, x); // flush with the edge: no gap for cut labels to show through
    zoneLabels.setAttribute("transform", `translate(${dx.toFixed(2)} 0)`);
    zoneLabels.classList.toggle("floating", dx > 0);
  }
}
const view = () => { const r = box(); return { x: cam.cx - r.width / cam.s / 2, y: cam.cy - r.height / cam.s / 2, w: r.width / cam.s, h: r.height / cam.s }; };
function freeRegion() {
  const r = box();
  // x0 leaves room for the district strip that stays at the left edge while the map is panned
  const region = { x0: 16 + 22, y0: 16, x1: r.width - 16, y1: r.height - 16 };
  if (!panel.hidden) {
    // layout position, not the sliding (transformed) one
    if (narrow()) region.y1 = panel.offsetTop - 12;
    else region.x1 = panel.offsetLeft - 16;
  } else if (narrow() && !legend.classList.contains("open")) {
    region.y1 = Math.min(region.y1, legend.offsetTop - 8); // the phone legend bar (same origin as the map)
  }
  const dock = document.querySelector("#replay");
  if (dock && !dock.hidden) region.y1 = Math.min(region.y1, dock.offsetTop - 12);
  return region;
}
function camFor(b, region, minScale = 0, maxScale = 1.6) {
  const r = box();
  const rw = Math.max(80, region.x1 - region.x0), rh = Math.max(80, region.y1 - region.y0);
  const s = clamp(Math.min(rw / b.w, rh / b.h), minScale, maxScale);
  const rcx = (region.x0 + region.x1) / 2, rcy = (region.y0 + region.y1) / 2;
  return { cx: b.x + b.w / 2 - (rcx - r.width / 2) / s, cy: b.y + b.h / 2 - (rcy - r.height / 2) / s, s };
}
function animateTo(target, ms = 560) {
  target = clampCam(target);
  cancelAnimationFrame(anim);
  const from = { ...cam };
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const ls0 = Math.log(from.s), ls1 = Math.log(target.s);
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = ease(t);
    setCam({ cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, s: Math.exp(ls0 + (ls1 - ls0) * e) });
    if (t < 1) anim = requestAnimationFrame(tick);
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) setCam(target);
  else anim = requestAnimationFrame(tick);
}
const mapBounds = () => ({ x: 0, y: 0, w: scene.width, h: scene.height });
const fitScale = () => camFor(mapBounds(), freeRegion(), 0, 9).s;
// One breakpoint for the CSS and the camera: the phone layout is the 760px viewport, not the map's width.
const PHONE = matchMedia("(max-width: 760px)");
const narrow = () => PHONE.matches;
// Between the phone and a wide desktop the legend folds to a rail of line badges (凡例 opens it).
function updateRail() {
  const rail = !narrow() && innerWidth < 1400;
  if (document.body.classList.contains("rail") !== rail) {
    document.body.classList.toggle("rail", rail);
    if (!rail) closeLegendSheet();
  }
}
// Names stay at 11px or more (14.2 × 0.8): below that the map is not shrunk further but panned.
const MIN_READ = 0.8;
function fitAll(animate = true) {
  let c = camFor(mapBounds(), freeRegion(), 0, 1.2);
  if (!narrow() && c.s < MIN_READ) c = camFor(mapBounds(), freeRegion(), MIN_READ, MIN_READ);
  if (narrow() && c.s < 0.6) {
    // A phone cannot show the whole map readably: start where the two main lines meet.
    const hub = Object.values(model.stations).filter((s) => s.lines.filter((l) => model.lineById[l].kind === "flow").length > 1)[0];
    const b = hub ? bboxOf([hub.id], 160) : mapBounds();
    c = camFor(b, freeRegion(), 0.8, 0.8);
  }
  animate ? animateTo(c) : setCam(clampCam(c));
}
function bboxOf(ids, pad = 60) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const id of ids) {
    const c = scene.stations[id];
    if (!c) continue;
    const r = c.label.rect;
    x0 = Math.min(x0, c.x - 20, r[0]); y0 = Math.min(y0, c.y - 20, r[1]);
    x1 = Math.max(x1, c.x + 20, r[2]); y1 = Math.max(y1, c.y + 20, r[3]);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
// Focus on stations: the whole group if it fits at a readable scale; otherwise readable, centred on
// the group, shifted just enough to keep `around` (the current step) in view.
const READABLE = 0.9;
function focusOn(ids, opts = {}) {
  const region = freeRegion();
  for (const pad of [opts.pad ?? 48, 18]) {
    const c = camFor(bboxOf(ids, pad), region, 0, opts.max ?? 1.15);
    if (c.s >= READABLE || opts.allowSmall) { animateTo(c); return; }
  }
  const c = camFor(bboxOf(ids, 18), region, READABLE, READABLE);
  if (opts.around) {
    const r = box(), a = bboxOf(opts.around, 30);
    const left = c.cx - r.width / 2 / c.s, top = c.cy - r.height / 2 / c.s;
    const sx0 = (a.x - left) * c.s, sx1 = (a.x + a.w - left) * c.s;
    const sy0 = (a.y - top) * c.s, sy1 = (a.y + a.h - top) * c.s;
    if (sx1 > region.x1) c.cx += (sx1 - region.x1) / c.s; else if (sx0 < region.x0) c.cx -= (region.x0 - sx0) / c.s;
    if (sy1 > region.y1) c.cy += (sy1 - region.y1) / c.s; else if (sy0 < region.y0) c.cy -= (region.y0 - sy0) / c.s;
  }
  animateTo(c);
}
function ensureVisible(pts) {
  // Pan (not zoom) so these map points sit inside the free region.
  const r = box(), region = freeRegion(), v = view();
  const s = cam.s;
  let dx = 0, dy = 0;
  const m = 60;
  for (const [x, y] of pts) {
    const sx = (x - v.x) * s, sy = (y - v.y) * s;
    if (sx < region.x0 + m) dx = Math.min(dx, sx - region.x0 - m);
    if (sx > region.x1 - m) dx = Math.max(dx, sx - region.x1 + m);
    if (sy < region.y0 + m) dy = Math.min(dy, sy - region.y0 - m);
    if (sy > region.y1 - m) dy = Math.max(dy, sy - region.y1 + m);
  }
  if (dx || dy) animateTo({ ...cam, cx: cam.cx + dx / s, cy: cam.cy + dy / s }, 480);
}
function zoomAt(factor, px, py) {
  const r = box(), v = view();
  const ns = clamp(cam.s * factor, fitScale() * 0.7, 3.2);
  const mx = v.x + px / cam.s, my = v.y + py / cam.s;
  setCam(clampCam({ cx: mx + (r.width / 2 - px) / ns, cy: my + (r.height / 2 - py) / ns, s: ns }));
}
new ResizeObserver(() => setCam(cam)).observe(svg);

// pan, pinch, wheel
{
  // The pointer is captured only once it has moved past the drag threshold: capturing on
  // pointerdown would send the click to the <svg> itself, and a click on a station, a label,
  // a track or a step badge would then find nothing under it.
  const pts = new Map();
  const captured = new Set();
  let start = null, moved = false;
  const capture = (id) => {
    if (captured.has(id)) return;
    try { svg.setPointerCapture(id); captured.add(id); } catch { /* the pointer is already gone */ }
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    start = { cam: { ...cam }, pts: new Map(pts) };
    moved = false;
    cancelAnimationFrame(anim);
    if (pts.size > 1) for (const id of pts.keys()) capture(id); // a pinch
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const r = box();
    if (pts.size === 1) {
      const [x0, y0] = start.pts.get(e.pointerId) || [e.clientX, e.clientY];
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        svg.classList.add("dragging");
        capture(e.pointerId);
        hideTip();
      }
      if (moved) setCam(clampCam({ ...start.cam, cx: start.cam.cx - dx / start.cam.s, cy: start.cam.cy - dy / start.cam.s }));
    } else if (pts.size === 2 && start.pts.size === 2) {
      const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]);
      const cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top;
      setCam(start.cam);
      zoomAt(d / d0, cx, cy);
      moved = true;
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    captured.delete(e.pointerId);
    svg.classList.remove("dragging");
    if (pts.size) start = { cam: { ...cam }, pts: new Map(pts) };
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  // After a drag the click is not a click: stop it before the map's own click handler (same node,
  // so stopImmediatePropagation, not stopPropagation).
  svg.addEventListener("click", (e) => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const r = box();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 0.6) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    else setCam(clampCam({ ...cam, cx: cam.cx + e.deltaX / cam.s, cy: cam.cy + e.deltaY / cam.s }));
  }, { passive: false });
  svg.addEventListener("dblclick", (e) => {
    const r = box();
    zoomAt(1.6, e.clientX - r.left, e.clientY - r.top);
  });
}
$("#zoom").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const r = box();
  zoomAt(b.dataset.zoom === "in" ? 1.35 : 1 / 1.35, r.width / 2, r.height / 2);
});
$("#fit").addEventListener("click", () => fitAll());
let resizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    updateRail();
    if (ui.line) focusOn(lineStations(ui.line)); else if (ui.station && scene.stations[ui.station]) focusOn([ui.station]); else fitAll(false);
  }, 120);
});

// ---------------------------------------------------------------- legend
function legendHTML() {
  const flows = model.lines.filter((l) => l.kind === "flow");
  const papers = model.lines.filter((l) => l.kind === "paper");
  const item = (l) => {
    const parent = l.parent ? model.stations[l.parent] : null;
    const name = l.kind === "flow" ? l.name : l.tab;
    const sub = l.kind === "flow" ? l.title : `${parent ? parent.name : ""} の中`;
    const code = l.kind === "paper";
    return `<li><button class="ln${ui.line === l.id ? " on" : ""}" data-line="${esc(l.id)}" style="--lc:${lineVar(l.id)}" title="${esc(l.title)}" aria-label="${esc(l.code)} ${esc(name)}（${esc(sub)}）">
      <span class="badge${l.kind === "paper" ? " paper" : ""}">${esc(l.code)}</span>
      <span><span class="ln-name${code ? " code" : ""}">${esc(name)}</span><span class="ln-sub">${esc(sub)}</span></span></button></li>`;
  };
  const sw = (inner) => `<svg width="38" height="18" viewBox="0 0 38 18" aria-hidden="true">${inner}</svg>`;
  const ink = "var(--ink-2)";
  const tag = `<rect x="1" y="2" width="36" height="14" rx="7" fill="var(--surface)" stroke="${ink}" stroke-width="1.5"/><circle cx="9" cy="9" r="5" fill="${ink}"/><text x="25" y="12.6" font-size="8.5" font-weight="800" fill="${ink}" text-anchor="middle">始発</text>`;
  const chev = `<line x1="3" x2="35" y1="9" y2="9" stroke="${ink}" stroke-width="6" stroke-linecap="round"/><path d="M11 6.3L14.4 9L11 11.7M22 6.3L25.4 9L22 11.7" fill="none" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<button class="lg-more" aria-expanded="false" title="凡例を開く">凡例</button><section><h2>路線</h2><p class="lg-cta">押すと時刻表が開き、電車で順にたどれます。</p>
      <p class="lg-cap">本線（流れ）</p><ul class="ln-list">${flows.map(item).join("")}</ul>
      <p class="lg-cap">支線（駅の中の紙）</p><ul class="ln-list">${papers.map(item).join("")}</ul></section>
    <section><h2>記号</h2><ul class="sym">
      <li>${sw(`<line x1="3" x2="35" y1="9" y2="9" stroke="${ink}" stroke-width="5" stroke-linecap="round"/><circle cx="19" cy="9" r="5.5" fill="var(--station)" stroke="${ink}" stroke-width="3"/>`)}<span>駅（関数・置き場）</span></li>
      <li>${sw(`<rect x="6" y="2.5" width="26" height="13" rx="6.5" fill="var(--station)" stroke="var(--pill-stroke)" stroke-width="2.5"/>`)}<span>乗り換え駅（2 本以上が止まる）</span></li>
      <li>${sw(tag)}<span>始発（流れの最初の駅）</span></li>
      <li>${sw(chev)}<span>進む向き（線を選ぶと出る）</span></li>
      <li>${sw(`<line x1="3" x2="35" y1="9" y2="9" stroke="${ink}" stroke-width="5" stroke-dasharray="7 5"/>`)}<span>もし（列が満杯のときだけ）</span></li>
      <li>${sw(`<line x1="4" x2="34" y1="9" y2="9" stroke="${ink}" stroke-width="8" stroke-linecap="round"/><line x1="4" x2="34" y1="9" y2="9" stroke="var(--surface)" stroke-width="4.2" stroke-linecap="round"/>`)}<span>紙の入口（親の駅から中の紙へ）</span></li>
      <li>${sw(`<line x1="3" x2="35" y1="9" y2="9" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/><circle cx="19" cy="9" r="3.8" fill="var(--station)" stroke="${ink}" stroke-width="2.2"/>`)}<span>支線の駅（紙の中だけの駅）</span></li>
      <li>${sw(`<rect x="2" y="1" width="34" height="16" rx="2" fill="var(--z-os)"/><rect x="2" y="1" width="3" height="16" fill="var(--zs-os)"/>`)}<span>帯（地区）＝層</span></li>
    </ul></section>
    <section><h2>使い方</h2><ul class="how">
      <li><b>線</b>を押すと時刻表、<b>駅</b>を押すと説明。<b>始発</b>の札を押すと 1 から乗れます。</li>
      <li><b>▶ 乗る</b>で手順の順に電車が走ります。<kbd>←</kbd><kbd>→</kbd> で 1 つずつ。</li>
      <li><kbd>/</kbd> 駅をさがす　<kbd>0</kbd> 全体　<kbd>Esc</kbd> 閉じる</li>
    </ul></section>`;
}
function renderLegend() {
  legend.innerHTML = legendHTML();
}
function closeLegendSheet() {
  legend.classList.remove("open");
  const more = legend.querySelector(".lg-more");
  if (more) { more.setAttribute("aria-expanded", "false"); more.textContent = "凡例"; }
}
legend.addEventListener("click", (e) => {
  const more = e.target.closest(".lg-more");
  if (more) {
    const open = legend.classList.toggle("open");
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "閉じる" : "凡例";
    if (open) legend.scrollTop = 0;
    return;
  }
  const b = e.target.closest(".ln");
  if (b) {
    closeLegendSheet();
    selectLine(ui.line === b.dataset.line ? null : b.dataset.line);
  }
});
legend.addEventListener("mouseover", (e) => {
  const b = e.target.closest(".ln");
  hoverLine(b ? b.dataset.line : null);
});
legend.addEventListener("mouseleave", () => hoverLine(null));

// ---------------------------------------------------------------- emphasis
function lineStations(id) {
  return model.lineById[id].stops;
}
function applyEmphasis() {
  const focus = ui.hoverLine || ui.line;
  const stId = ui.station || ui.hoverStation;
  const stFocus = !focus && stId && model.stations[stId] ? model.stations[stId] : null;
  for (const g of $$(".line-g", svg)) {
    const id = g.dataset.line;
    const on = focus ? id === focus : stFocus ? stFocus.lines.includes(id) : true;
    g.classList.toggle("dim", !on && !!focus);
    g.classList.toggle("dim-soft", !on && !focus && !!stFocus);
  }
  if (focus) {
    // lift the focused line above the others
    const g = svg.querySelector(`.line-g[data-line="${CSS.escape(focus)}"]`);
    g?.parentNode.append(g);
  }
  for (const sh of svg.querySelectorAll(".shield")) {
    sh.classList.toggle("dim", !!focus && sh.dataset.line !== focus);
    sh.classList.toggle("gone", !!ui.line && sh.dataset.line === ui.line);
  }
  for (const tg of svg.querySelectorAll(".term-tag")) {
    tg.classList.toggle("dim", !!focus && tg.dataset.line !== focus);
    tg.classList.toggle("dim-soft", !focus && !!stFocus && !stFocus.lines.includes(tg.dataset.line));
  }
  renderChevrons();
  const on = focus ? new Set(lineStations(focus)) : null;
  for (const el of $$(".station, .label", svg)) {
    const id = el.dataset.st;
    el.classList.toggle("dim", !!on && !on.has(id));
    el.classList.toggle("selected", ui.station === id);
  }
  for (const b of $$(".ln", legend)) b.classList.toggle("on", b.dataset.line === ui.line);
}
function hoverLine(id) {
  if (ui.hoverLine === id) return;
  ui.hoverLine = ui.line ? null : id; // while a line is open, hovering others does not switch the map
  applyEmphasis();
}

// ---------------------------------------------------------------- ride order and badges
function rideOrder(line) {
  // Main steps in order; a "もし" step comes right after the step it replaces.
  const out = [];
  const alts = line.steps.filter((s) => s.alt);
  for (const s of line.steps) {
    if (s.alt) continue;
    out.push(s);
    for (const a of alts) if (a.alt.at === s.idx) out.push(a);
  }
  for (const a of alts) if (!out.includes(a)) out.push(a);
  return out;
}
function trackFor(lineId, a, b) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  return scene.tracks.find((t) => t.line === lineId && t.key === key);
}
function renderBadges() {
  const g = $("#badges", svg);
  if (!ui.line) { g.innerHTML = ""; return; }
  const line = model.lineById[ui.line];
  const cur = ui.step != null ? rideOrder(line)[ui.step] : null;
  const on = new Set(lineStations(ui.line));
  // Labels of faded stations matter less than the selected line's own.
  const room = roomFinder({ labelWeight: (id) => (on.has(id) ? 100 : 18) });
  for (const [lid, tg] of Object.entries(originAt)) room.add(tg.r, lid === ui.line ? 100 : 30);
  let h = "";
  badgeAt = {};
  for (const t of scene.tracks.filter((t) => t.line === ui.line && t.steps.length)) {
    const nums = t.steps.map((s) => (s.alt ? "もし" : String(s.num)));
    const text = [...new Set(nums)].join("・");
    const w = Math.max(24, 10 + measure(text, 12.5, false) + 4);
    // slide along the track to the first spot clear of labels, station marks and other badges
    const cands = [];
    for (const f of [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73, 0.2, 0.8]) {
      const [x, y, a] = pointAt(t.pts, f);
      cands.push({ x, y, r: [x - w / 2, y - 11.5, x + w / 2, y + 11.5], pref: Math.abs(f - 0.5) * 8 });
      // beside the track (touching it) when both sides of the line are taken by labels
      const nx = -Math.sin(a), ny = Math.cos(a);
      const off = Math.abs(nx) * (w / 2 + 3) + Math.abs(ny) * (11.5 + 3);
      for (const sgn of [1, -1]) {
        const X = x + nx * off * sgn, Y = y + ny * off * sgn;
        cands.push({ x: X, y: Y, r: [X - w / 2, Y - 11.5, X + w / 2, Y + 11.5], pref: 6 + Math.abs(f - 0.5) * 8 });
      }
    }
    const p = room.best(cands, 4);
    room.add(p.r, 100);
    badgeAt[t.key] = { x: p.x, y: p.y, w };
    const isCur = cur && t.steps.includes(cur);
    h += `<g class="ride-badge${isCur ? " current" : ""}" data-key="${esc(t.key)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
      <rect x="${-w / 2}" y="-11.5" width="${w}" height="23" rx="11.5" fill="${lineVar(ui.line)}"/><text>${esc(text)}</text></g>`;
  }
  // Where a paper meets the flow outside: a dashed ring on the outer station, and at the inner
  // station a short stub with a tag that names it (no leader across the map).
  for (const p of line.ports) {
    const a = scene.stations[p.inner], b = scene.stations[p.outer];
    if (!a || !b) continue;
    const col = lineVar(ui.line);
    const name = stationName(p.outer);
    const code = model.stations[p.outer]?.codeName;
    const w = 14 + measure("出口 →", 12.5, false) + 6 + measure(name, 12.5, !!code) + 12, hgt = 24;
    const toward = Math.atan2(b.y - a.y, b.x - a.x);
    const portRoom = roomFinder({ trackWeight: 10, skipLines: new Set(), labelWeight: (id) => (on.has(id) ? 100 : 30) });
    const cands = [];
    for (const d of [30, 46, 66, 90]) {
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * 2 * Math.PI;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const ext = Math.abs(ux) * (w / 2) + Math.abs(uy) * (hgt / 2);
        const x = a.x + ux * (d + ext), y = a.y + uy * (d + ext);
        let diff = Math.abs(ang - toward) % (2 * Math.PI);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        cands.push({ x, y, ux, uy, d, r: [x - w / 2, y - hgt / 2, x + w / 2, y + hgt / 2], pref: diff * 4 + d / 12 });
      }
    }
    const pick = (() => {
      // the shared room (badges and the line's labels) first; then keep off the other tracks; the
      // stub from the station to the tag must not cross a label either
      let best = null;
      for (const c of cands) {
        const ext = Math.abs(c.ux) * (w / 2) + Math.abs(c.uy) * (hgt / 2);
        const stub = room.segCost(a.x + c.ux * 9, a.y + c.uy * 9, c.x - c.ux * (ext + 1), c.y - c.uy * (ext + 1));
        const v = room.cost(c.r, 3) + portRoom.cost(c.r, 3) * 0.25 + stub + c.pref;
        if (!best || v < best.v) best = { ...c, v };
      }
      return best;
    })();
    room.add(pick.r, 100);
    const sx = a.x + pick.ux * 9, sy = a.y + pick.uy * 9;
    const exx = pick.x - pick.ux * (Math.abs(pick.ux) * (w / 2) + Math.abs(pick.uy) * (hgt / 2));
    const eyy = pick.y - pick.uy * (Math.abs(pick.ux) * (w / 2) + Math.abs(pick.uy) * (hgt / 2));
    h += `<g class="port"><path d="M${sx.toFixed(1)} ${sy.toFixed(1)}L${exx.toFixed(1)} ${eyy.toFixed(1)}" stroke="${col}"/><g class="port-ring" transform="translate(${b.x} ${b.y})"><circle r="17" stroke="${col}"/></g>`;
    h += `<g class="port-tag" data-inner="${esc(p.inner)}" data-outer="${esc(p.outer)}" role="button" transform="translate(${pick.x.toFixed(1)} ${pick.y.toFixed(1)})"><rect x="${-w / 2}" y="${-hgt / 2}" width="${w}" height="${hgt}" rx="${hgt / 2}" stroke="${col}"/>`;
    h += `<text class="pt-word" x="${-w / 2 + 12}" y="0" fill="${col}">出口 →</text><text class="pt-name${code ? " code" : ""}" x="${-w / 2 + 18 + measure("出口 →", 12.5, false)}" y="0">${esc(name)}</text></g></g>`;
  }
  g.innerHTML = h;
  renderChevrons();
}

// ---------------------------------------------------------------- the current step on the map
let trainAnim = null;
function stepPath(st) {
  const t = trackFor(st.line, st.from, st.to);
  if (!t) return null;
  const forward = t.a === st.from;
  const pts = forward ? t.pts : [...t.pts].reverse();
  return { t, pts };
}
function showStep(st, animate = true) {
  const flash = $("#flash", svg), train = $("#train", svg);
  cancelAnimationFrame(trainAnim);
  if (!st) { flash.innerHTML = ""; train.innerHTML = ""; return; }
  const sp = stepPath(st);
  if (!sp) return;
  const col = lineVar(st.line);
  // shorten the arrow so its head stops at the station's edge
  const pts = sp.pts.map((p) => [...p]);
  const end = pts[pts.length - 1], prev = pts[pts.length - 2];
  const L = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
  const cut = Math.min(L * 0.5, 15);
  const tip = [end[0] - ((end[0] - prev[0]) / L) * cut, end[1] - ((end[1] - prev[1]) / L) * cut];
  const arrowPts = [...pts.slice(0, -1), tip];
  const d = arrowPts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  flash.innerHTML = `<path class="flash" d="${sp.t.d}" stroke="${col}" stroke-width="${(model.lineById[st.line].kind === "flow" ? LOOK.line : LOOK.paperLine) + 12}"/>
    <path class="arrowhead" d="${d}" fill="none" stroke="${col}" stroke-width="2.5" marker-end="url(#arrow)" opacity="0"/>`;
  let draw = (f) => {
    const [x, y, a] = pointAt(sp.pts, f);
    const deg = (a * 180) / Math.PI;
    train.innerHTML = `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})">
      <rect class="train-body" x="-15" y="-8" width="30" height="16" rx="8" fill="${col}"/>
      <rect class="train-win" x="3" y="-3.5" width="8" height="7" rx="2"/></g>`;
  };
  // Stop where the train's nose meets the station's mark, so it never sits on top of a pill.
  const mark = scene.stations[st.to]?.mark;
  const L0 = polyLength(sp.pts);
  if (mark && L0 > 0) {
    const [ex, ey] = sp.pts[sp.pts.length - 1], [px, py] = sp.pts[sp.pts.length - 2];
    const ux = (ex - px) / (Math.hypot(ex - px, ey - py) || 1), uy = (ey - py) / (Math.hypot(ex - px, ey - py) || 1);
    const reach = mark.type === "dot" ? mark.r : Math.abs(ux * mark.ax + uy * mark.ay) * (mark.half - mark.r) + mark.r;
    const stopAt = Math.max(0.35, (L0 - reach - 17) / L0);
    const draw0 = draw;
    draw = (f) => draw0(f * stopAt);
  }
  const len = polyLength(sp.pts);
  if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(1); return; }
  const ms = clamp(len * 2.2, 450, 1300);
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    draw(ease(t));
    if (t < 1) trainAnim = requestAnimationFrame(tick);
  };
  trainAnim = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- panel: timetable
const stationName = (id) => model.stations[id]?.name || model.nodes[id]?.title || id;
// The name with its namespace in front: "app_transport.request(m)" (grey, then the name) when that is
// the code's own name, otherwise the namespace stands apart ("syscall OS_CALL").
function nsName(id) {
  const s = model.stations[id];
  const name = esc(stationName(id));
  if (!s?.ns) return name;
  return `<span class="ns">${esc(s.ns)}${s.nsDot ? "." : ""}</span>${s.nsDot ? "" : " "}${name}`;
}
const nsText = (id) => { const s = model.stations[id]; return s?.ns ? `${s.ns}${s.nsDot ? "." : " "}${stationName(id)}` : stationName(id); };
function stBtn(id) {
  const s = model.stations[id];
  const code = s ? s.codeName : false;
  return `<button class="st-btn${code ? " code" : ""}" data-node="${esc(id)}">${nsName(id)}</button>`;
}
function linkChip(id) {
  const n = model.nodes[id];
  if (!n) return esc(id);
  const s = model.stations[id];
  const name = s ? s.name : n.title;
  const code = s ? s.codeName : /^[\x20-\x7e]+$/.test(name);
  const layer = model.layers.find((l) => l.id === n.layer);
  const sw = layer ? `var(--zs-${layer.id})` : "var(--ink-3)";
  return `<button class="link-chip${code ? " code" : ""}" data-node="${esc(id)}" style="--sw:${sw}">${s ? nsName(id) : esc(name)}</button>`;
}
function prose(text) {
  return parseLinks(text).map((p) => {
    if (p.t === "text") return esc(p.v).replace(/\n/g, "<br>");
    if (p.t === "link") return linkChip(p.v);
    return embed(p.v);
  }).join("");
}
function embed(id) {
  const n = model.nodes[id];
  if (!n) return "";
  if (n.kind === "figure" && n.figure) {
    return `<figure class="figure" data-fig="${esc(id)}" tabindex="0" role="button" aria-label="${esc(n.title)}（押すと大きく表示）">${n.figure}<span class="fig-hint">押すと大きく見られます</span><figcaption class="muted">${prose(n.text)}</figcaption></figure>`;
  }
  return `<div class="embed"><h4>${linkChip(id)}</h4>${fieldsTable(n)}</div>`;
}
function fieldsTable(n) {
  if (!n.fields?.length) return "";
  return `<table class="fields">${n.fields.map((f) => {
    if (f.length === 3) return `<tr><td class="ty">${esc(f[0])}</td><td class="nm">${esc(f[1])}</td><td class="ds">${prose(f[2])}</td></tr>`;
    return `<tr><td class="nm">${esc(f[0])}</td><td class="ds" colspan="2">${prose(f[1] || "")}</td></tr>`;
  }).join("")}</table>`;
}
function regionOf(line, nodeId) {
  return line.regions.find((r) => r.nodes.includes(nodeId)) || null;
}
function timetableHTML(line) {
  const order = rideOrder(line);
  const mains = line.steps.filter((s) => !s.alt).length;
  const alts = line.steps.length - mains;
  const parent = line.parent ? model.stations[line.parent] : null;
  let desc = line.kind === "flow" ? line.title : `${parent ? parent.name : ""}（${parent ? parent.lines.filter((l) => l !== line.id).map((l) => model.lineById[l].code).join("・") + " 線の駅" : ""}）の中を、手順の順にたどります。`;
  let h = `<div class="p-head" style="--lc:${lineVar(line.id)}">
    <p class="eyebrow">${line.kind === "flow" ? "本線・流れ" : "支線・中の紙"}　時刻表</p>
    <div class="p-title"><span class="badge${line.kind === "paper" ? " paper" : ""}">${esc(line.code)}</span><h2>${esc(line.kind === "flow" ? line.name : line.title)}</h2></div>
    <p class="desc">${esc(desc)}</p>
    <div class="p-meta"><span class="chip">${line.stops.length} 駅</span><span class="chip">手順 ${mains}</span>${alts ? `<span class="chip">もし ${alts}</span>` : ""}${line.regions.length ? `<span class="chip">文脈 ${line.regions.length}</span>` : ""}</div>
    <div class="ride">
      <button class="prev" title="前の手順（←）">◀</button>
      <button class="play" title="順に乗る（Space）">${ui.playing ? "❚❚ 止める" : "▶ 乗る"}</button>
      <button class="next" title="次の手順（→）">▶</button>
      <span class="pos">${ui.step == null ? `${order.length} 区間` : `${ui.step + 1} / ${order.length}`}</span>
    </div>
    <button class="p-close" title="閉じる（Esc）" aria-label="閉じる">×</button>
  </div><div class="p-body"><ol class="tt">`;
  const rows = [];
  if (line.parent && line.entry) {
    rows.push(`<li class="tt-row link first" data-link="entry"><div><span class="tt-num">入</span></div><div>
      <div class="tt-route">${stBtn(line.parent)}<span class="tt-arrow">→</span>${stBtn(line.entry)}</div>
      <p class="tt-label">${esc(stationName(line.parent))} の中に入る。この紙は ${esc(stationName(line.entry))} から始まる。</p></div></li>`);
  }
  order.forEach((st, i) => {
    const r0 = regionOf(line, st.from), r1 = regionOf(line, st.to);
    const gate = r0 && r1 && r0.node !== r1.node ? `<p class="gate">${esc(r0.label3 || r0.label)} → ${esc(r1.label3 || r1.label)}</p>` : "";
    const data = st.data ? `<div><span class="k">渡す</span><span class="data-chip"><code>${esc(st.data.label)}</code>${(st.data.fields || []).map((f) => `<span class="f">${esc(f)}</span>`).join("")}${st.data.type ? `<span class="f">${esc(st.data.type)}</span>` : ""}${st.data.schema && model.nodes[st.data.schema] ? linkChip(st.data.schema) : ""}</span>${st.data.note ? `<div class="muted" style="margin-top:4px">${prose(st.data.note)}</div>` : ""}</div>` : "";
    const ops = st.ops ? `<div><span class="k">操作</span>${st.ops.map((o) => `${linkChip(o.node)} に${esc(o.kind)}`).join("、")}</div>` : "";
    const br = st.branches ? `<div><span class="k">分かれる</span><ul class="branches">${st.branches.map(([w, t]) => `<li><span>${esc(w)} → ${prose(t)}</span></li>`).join("")}</ul></div>` : "";
    const where = st.where ? `<div><span class="k">コード</span><button class="code-link" data-src="${esc(st.where.path)}" data-line="${st.where.line}">${esc(st.where.path.split("/").pop())}:${st.where.line}</button></div>` : "";
    const cls = ["tt-row", st.alt ? "alt" : "", ui.step === i ? "current" : "", !rows.length && i === 0 ? "first" : "", i === order.length - 1 && !line.ports.length ? "last" : ""].filter(Boolean).join(" ");
    rows.push(`<li class="${cls}" data-i="${i}"><div><span class="tt-num">${st.alt ? "もし" : st.num}</span></div><div>
      <div class="tt-route">${stBtn(st.from)}<span class="tt-arrow">→</span>${stBtn(st.to)}</div>
      <div class="tt-what"><span class="tt-kind">${esc(st.kindName)}</span>${st.verb ? `<span class="tt-verb">${esc(st.verb)}</span>` : ""}${st.alt ? `<span class="chip">${esc(st.altLabel)}</span>` : ""}</div>
      <p class="tt-label">${prose(st.label)}</p>${gate}
      ${data || ops || br || where ? `<div class="tt-extra">${data}${ops}${br}${where}</div>` : ""}</div></li>`);
  });
  line.ports.forEach((p, k) => {
    rows.push(`<li class="tt-row link${k === line.ports.length - 1 ? " last" : ""}" data-link="port"><div><span class="tt-num">出</span></div><div>
      <div class="tt-route">${stBtn(p.inner)}<span class="tt-arrow">→</span>${stBtn(p.outer)}</div>
      <p class="tt-label">ここで外の流れの ${esc(stationName(p.outer))} につながる。</p></div></li>`);
  });
  h += rows.join("") + `</ol></div>`;
  return h;
}

// ---------------------------------------------------------------- panel: station / node card
let srcCache = {};
async function loadSource(path) {
  if (!srcCache[path]) srcCache[path] = fetch(`../data/src/${path}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
  return srcCache[path];
}
// The code's own name under the title, unless the title already says it (namespace + name).
function cardCodeName(n, s, name) {
  const fn = n.fn || (n.title !== name ? n.title : "");
  if (!fn || fn === name) return "";
  if (s?.nsDot && fn === `${s.ns}.${name.replace(/\(.*$/, "")}`) return "";
  return `<code>${esc(fn)}</code>　`;
}
function nodeHTML(id) {
  const n = model.nodes[id];
  const s = model.stations[id];
  const c = s ? scene.stations[id] : null;
  const layer = model.layers.find((l) => l.id === n.layer) || atlas.layers.find((l) => l.id === n.layer);
  const name = s ? s.name : n.title;
  const code = s ? s.codeName : /^[\x20-\x7e]+$/.test(name);
  const where = model.code?.nodes?.[id];
  let h = `<div class="p-head">
    <p class="eyebrow">${s ? (s.interchange ? "乗り換え駅" : "駅") : "文書"}　${esc(KIND_NAME[n.kind] || n.kind)}</p>
    <div class="p-title"><h2 class="${code ? "code" : ""}">${s ? nsName(id) : esc(name)}</h2></div>
    <p class="desc">${cardCodeName(n, s, name)}${s?.sub ? esc(s.sub) : ""}</p>
    <div class="p-meta">${layer ? `<span class="chip"><span class="sw" style="--sw:var(--zs-${esc(layer.id)}, var(--ink-3))"></span>${esc(layer.name)}</span>` : ""}${n.paper ? `<span class="chip">中に紙がある</span>` : ""}</div>
    <button class="p-close" title="閉じる（Esc）" aria-label="閉じる">×</button>
  </div><div class="p-body">`;
  if (s) {
    h += `<div class="sec"><h3>止まる路線</h3><div class="lines-here">${s.lines.map((lid) => {
      const l = model.lineById[lid];
      const role = l.parent === id ? "この駅の中の紙" : l.ports.some((p) => p.outer === id) ? "紙の出口がここ" : l.kind === "flow" ? "本線" : "支線";
      return `<button data-line="${esc(lid)}" style="--lc:${lineVar(lid)}"><span class="badge${l.kind === "paper" ? " paper" : ""}">${esc(l.code)}</span><span><span class="t1">${esc(l.kind === "flow" ? l.name : l.title)}</span><span class="t2">${esc(role)}</span></span></button>`;
    }).join("")}</div></div>`;
  }
  if (n.api) {
    h += `<div class="sec"><h3>形</h3><pre class="sig">${esc(n.api.sig)}</pre>`;
    if (n.api.params?.length) h += `<dl class="params">${n.api.params.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${prose(v)}</dd>`).join("")}</dl>`;
    if (n.api.ret) h += `<dl class="params"><dt>返す</dt><dd>${prose(n.api.ret)}</dd></dl>`;
    h += `</div>`;
  }
  if (n.text) h += `<div class="sec"><h3>説明</h3><p class="prose">${prose(n.text)}</p></div>`;
  if (n.fields?.length) h += `<div class="sec"><h3>${n.kind === "hw" ? "ビット" : "中身"}</h3>${fieldsTable(n)}</div>`;
  if (n.values?.length) h += `<div class="sec"><h3>値</h3><table class="fields">${n.values.map(([k, v]) => `<tr><td class="nm">${esc(k)}</td><td class="ds">${prose(v || "")}</td></tr>`).join("")}</table></div>`;
  if (n.ops?.length) h += `<div class="sec"><h3>操作</h3><table class="fields">${n.ops.map((o) => `<tr><td class="nm">${o.node ? linkChip(o.node) : esc(o.name)}</td><td class="ds">${esc(o.kind)}・${esc(o.cost || "")}<br>${prose(o.text)}</td></tr>`).join("")}</table></div>`;
  if (n.invariants?.length) h += `<div class="sec"><h3>いつも成り立つこと</h3>${n.invariants.map((t) => `<p class="prose">${prose(t)}</p>`).join("")}</div>`;
  const at = model.stepsAt[id] || [];
  if (at.length) {
    h += `<div class="sec"><h3>この駅を通る手順</h3><ul class="stop-list">${at.map((st) => {
      const l = model.lineById[st.line];
      const i = rideOrder(l).indexOf(st);
      return `<li><button data-line="${esc(st.line)}" data-i="${i}" style="--lc:${lineVar(st.line)}"><span class="badge sm${l.kind === "paper" ? " paper" : ""}">${esc(l.code)}</span><span>
        <span class="s1">${st.alt ? "もし" : st.num}．${nsName(st.from)} → ${nsName(st.to)}${st.verb ? `　${esc(st.verb)}` : ""}</span>
        <span class="s2">${esc(st.kindName)}・${esc(l.kind === "flow" ? l.name : l.tab)}</span></span></button></li>`;
    }).join("")}</ul></div>`;
  }
  const tr = model.traces[0];
  if (tr && s) {
    const evs = tr.events.filter((e) => e.n === id);
    h += `<div class="sec"><h3>記録：${esc(tr.title)}</h3>`;
    if (evs.length) {
      h += `<div class="kv"><span class="big-num">${evs.length}</span><span class="muted">回入った（${esc(tr.date.slice(0, 10))} の 1 回の実行）</span></div>
        <div class="trace-bar" title="命令数 0 〜 ${fmt(tr.lastInstr)}">${evs.map((e) => `<i style="left:${((e.instr / tr.lastInstr) * 100).toFixed(2)}%"></i>`).join("")}</div>
        <div class="trace-axis"><span>0</span><span>命令数</span><span>${fmt(tr.lastInstr)}</span></div>`;
    } else h += `<p class="muted">この記録では一度も入っていません。</p>`;
    h += `</div>`;
  }
  if (where?.path) {
    h += `<div class="sec"><h3>コード</h3><div class="kv"><button class="code-link" data-src="${esc(where.path)}" data-from="${where.start ?? ""}" data-to="${where.end ?? ""}">${esc(where.path)}${where.start ? `:${where.start}–${where.end}` : ""}</button></div><div class="src-slot"></div></div>`;
  }
  h += `</div>`;
  return h;
}
async function showSource(btn) {
  const path = btn.dataset.src;
  const slot = btn.closest(".sec, .tt-row")?.querySelector(".src-slot") || (() => {
    const d = document.createElement("div");
    d.className = "src-slot";
    btn.closest("div").after(d);
    return d;
  })();
  if (slot.dataset.open === path + btn.dataset.line) { slot.innerHTML = ""; slot.dataset.open = ""; return; }
  slot.dataset.open = path + btn.dataset.line;
  try {
    const text = await loadSource(path);
    const lines = text.split("\n");
    const hl = Number(btn.dataset.line) || null;
    let a = Number(btn.dataset.from) || (hl ? hl - 4 : 1), b = Number(btn.dataset.to) || (hl ? hl + 4 : a + 20);
    a = Math.max(1, a - 1); b = Math.min(lines.length, Math.max(b + 1, a + 4), a + 60);
    let rows = "";
    for (let i = a; i <= b; i++) rows += `<tr${i === hl ? ' class="hl"' : ""}><td class="no">${i}</td><td>${esc(lines[i - 1])}</td></tr>`;
    slot.innerHTML = `<div class="src"><table>${rows}</table></div>`;
    slot.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
  } catch {
    slot.innerHTML = `<p class="muted">ソースを読めませんでした。</p>`;
  }
}

// ---------------------------------------------------------------- selection
function openPanel(html, lineId = null) {
  hideTip(); // the map may slide under the pointer when the legend folds; no stale tooltip
  panel.innerHTML = html;
  if (lineId) panel.style.setProperty("--lc", lineVar(lineId)); else panel.style.removeProperty("--lc");
  const wasHidden = panel.hidden;
  panel.hidden = false;
  document.body.classList.add("panel-open");
  box(); // settle the layout (the legend folds to a rail) before the camera moves
  return wasHidden;
}
function closePanel() {
  panel.hidden = true;
  document.body.classList.remove("panel-open");
  box();
}
function selectLine(id, step = null, opts = {}) {
  stop();
  ui.line = id;
  ui.station = null;
  ui.hoverLine = null;
  ui.step = step;
  if (!id) {
    closePanel();
    applyEmphasis();
    renderBadges();
    showStep(null);
    if (!opts.keepView) fitAll();
    writeHash();
    return;
  }
  openPanel(timetableHTML(model.lineById[id]), id);
  applyEmphasis();
  renderBadges();
  if (step != null) {
    const st = rideOrder(model.lineById[id])[step];
    showStep(st, false);
    scrollRow();
  } else showStep(null);
  if (!opts.keepView) {
    const line = model.lineById[id];
    const st = step != null ? rideOrder(line)[step] : null;
    let ids = lineStations(id);
    // a paper: take in the outer stations its exits lead to, if the map stays readable
    if (line.ports.length) {
      const withPorts = [...new Set([...ids, ...line.ports.map((p) => p.outer)])];
      if (camFor(bboxOf(withPorts, 40), freeRegion(), 0, 1.15).s >= READABLE) ids = withPorts;
    }
    focusOn(ids, { around: st ? [st.from, st.to] : null });
  }
  writeHash();
}
function selectNode(id, opts = {}) {
  stop();
  if (!model.nodes[id]) return;
  ui.station = id;
  ui.line = null;
  ui.step = null;
  ui.hoverLine = null;
  openPanel(nodeHTML(id));
  applyEmphasis();
  renderBadges();
  showStep(null);
  if (model.stations[id] && !opts.keepView) {
    const s = model.stations[id];
    const near = new Set([id]);
    for (const e of model.edges) if (e.a === id || e.b === id) { near.add(e.a); near.add(e.b); }
    focusOn([...near], { max: 1.1, pad: 44, around: [id] });
  }
  writeHash();
}
function goStep(i, animate = true) {
  if (!ui.line) return;
  const line = model.lineById[ui.line];
  const order = rideOrder(line);
  if (!order.length) return;
  ui.step = clamp(i, 0, order.length - 1);
  const st = order[ui.step];
  for (const row of $$(".tt-row[data-i]", panel)) row.classList.toggle("current", Number(row.dataset.i) === ui.step);
  const pos = $(".ride .pos", panel);
  if (pos) pos.textContent = `${ui.step + 1} / ${order.length}`;
  renderBadges();
  showStep(st, animate);
  scrollRow();
  const sp = stepPath(st);
  if (sp) ensureVisible([sp.pts[0], sp.pts[sp.pts.length - 1]]);
  writeHash();
}
function scrollRow() {
  const row = panel.querySelector(".tt-row.current");
  if (row) row.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
let playTimer = null;
function play() {
  if (!ui.line) return;
  const order = rideOrder(model.lineById[ui.line]);
  ui.playing = true;
  setPlayLabel();
  const advance = () => {
    // skip "もし" steps while riding: they are what happens instead
    let i = ui.step == null ? 0 : ui.step + 1;
    while (i < order.length && order[i].alt) i++;
    if (i >= order.length) { stop(); return; }
    goStep(i);
    playTimer = setTimeout(advance, 1900);
  };
  if (ui.step == null || ui.step >= order.length - 1) { ui.step = null; }
  advance();
}
function stop() {
  clearTimeout(playTimer);
  ui.playing = false;
  setPlayLabel();
}
function setPlayLabel() {
  const b = $(".ride .play", panel);
  if (b) b.textContent = ui.playing ? "❚❚ 止める" : "▶ 乗る";
}

// figures open large in a lightbox
const lightbox = document.createElement("div");
lightbox.id = "lightbox";
lightbox.hidden = true;
document.body.append(lightbox);
function openFigure(id) {
  const n = model.nodes[id];
  lightbox.innerHTML = `<div class="lb-card" role="dialog" aria-label="${esc(n.title)}"><div class="lb-head"><b>${esc(n.title)}</b><button class="lb-close" aria-label="閉じる">×</button></div><div class="figure big">${n.figure}</div><p class="prose">${prose(n.text)}</p></div>`;
  lightbox.hidden = false;
}
lightbox.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-node]");
  if (chip) { lightbox.hidden = true; selectNode(chip.dataset.node); return; }
  if (e.target === lightbox || e.target.closest(".lb-close")) lightbox.hidden = true;
});

panel.addEventListener("click", (e) => {
  const t = e.target;
  const fig = t.closest("[data-fig]");
  if (fig && !t.closest("[data-node]")) { openFigure(fig.dataset.fig); return; }
  if (t.closest(".p-close")) { ui.line ? selectLine(null) : closeNode(); return; }
  const code = t.closest(".code-link");
  if (code) { showSource(code); return; }
  const node = t.closest("[data-node]");
  if (node) { selectNode(node.dataset.node); return; }
  const lineBtn = t.closest("button[data-line]");
  if (lineBtn) { selectLine(lineBtn.dataset.line, lineBtn.dataset.i != null && lineBtn.dataset.i !== "-1" ? Number(lineBtn.dataset.i) : null); return; }
  if (t.closest(".play")) { ui.playing ? stop() : play(); return; }
  if (t.closest(".prev")) { stop(); goStep(ui.step == null ? 0 : ui.step - 1); return; }
  if (t.closest(".next")) { stop(); goStep(ui.step == null ? 0 : ui.step + 1); return; }
  const row = t.closest(".tt-row[data-i]");
  if (row) { stop(); goStep(Number(row.dataset.i)); return; }
  const link = t.closest(".tt-row[data-link]");
  if (link && ui.line) {
    stop();
    const l = model.lineById[ui.line];
    const ids = link.dataset.link === "entry" ? [l.parent, l.entry] : l.ports.flatMap((p) => [p.inner, p.outer]);
    focusOn(ids, { max: 1.4 });
  }
});
panel.addEventListener("mouseover", (e) => {
  const row = e.target.closest(".tt-row[data-i]");
  if (!row || !ui.line || ui.playing) return;
  const st = rideOrder(model.lineById[ui.line])[Number(row.dataset.i)];
  if (st && ui.step !== Number(row.dataset.i)) previewStep(st);
});
panel.addEventListener("mouseleave", () => {
  if (!ui.line) return;
  const st = ui.step != null ? rideOrder(model.lineById[ui.line])[ui.step] : null;
  showStep(st, false);
});
function previewStep(st) { showStep(st, false); }
function closeNode() {
  ui.station = null;
  closePanel();
  applyEmphasis();
  writeHash();
}

// map clicks
svg.addEventListener("click", (e) => {
  if (legend.classList.contains("open") && (narrow() || document.body.classList.contains("rail") || document.body.classList.contains("panel-open"))) {
    closeLegendSheet();
    return;
  }
  const port = e.target.closest(".port-tag");
  if (port) { stop(); focusOn([port.dataset.inner, port.dataset.outer], { max: 1.4 }); return; }
  const term = e.target.closest(".term-tag");
  if (term) { selectLine(term.dataset.line, 0); return; }
  const st = e.target.closest(".station, .label");
  if (st) { selectNode(st.dataset.st); return; }
  const badge = e.target.closest(".ride-badge");
  if (badge && ui.line) {
    const order = rideOrder(model.lineById[ui.line]);
    const t = scene.tracks.find((x) => x.line === ui.line && x.key === badge.dataset.key);
    const i = order.findIndex((s) => t.steps.includes(s));
    if (i >= 0) { stop(); goStep(i); }
    return;
  }
  const hit = e.target.closest(".hit");
  if (hit) {
    if (ui.line === hit.dataset.line) {
      const order = rideOrder(model.lineById[ui.line]);
      const t = scene.tracks.find((x) => x.line === ui.line && x.key === hit.dataset.key);
      const i = order.findIndex((s) => t?.steps.includes(s));
      if (i >= 0) { stop(); goStep(i); }
    } else selectLine(hit.dataset.line);
    return;
  }
  if (ui.line || ui.station) { ui.line ? selectLine(null, null, { keepView: true }) : closeNode(); }
});
svg.addEventListener("mouseover", (e) => {
  const term = e.target.closest(".term-tag");
  if (term && !ui.line) { hoverLine(term.dataset.line); showTip(e, `<b>${esc(model.lineById[term.dataset.line].code)}　${esc(model.lineById[term.dataset.line].name)}</b><div class="t2">ここから始まる。押すと手順 1 から乗る</div>`); return; }
  const hit = e.target.closest(".hit");
  const st = e.target.closest(".station, .label");
  if (hit && !ui.line) hoverLine(hit.dataset.line);
  else if (!hit) hoverLine(null);
  if (st && !ui.line && !ui.station && ui.hoverStation !== st.dataset.st) { ui.hoverStation = st.dataset.st; applyEmphasis(); }
  else if (!st && ui.hoverStation) { ui.hoverStation = null; applyEmphasis(); }
  if (st) showTip(e, tipForStation(st.dataset.st));
  else if (hit) showTip(e, tipForTrack(hit.dataset.line, hit.dataset.key));
  else hideTip();
});
svg.addEventListener("mousemove", (e) => { if (!tip.hidden) placeTip(e); });
svg.addEventListener("mouseleave", () => { ui.hoverStation = null; hoverLine(null); hideTip(); });

function tipForStation(id) {
  const s = model.stations[id];
  return `<b>${esc(nsText(id))}</b>${s.sub ? `<div class="t2">${esc(s.sub)}</div>` : ""}<div class="t2">${esc(KIND_NAME[s.kind] || s.kind)}・${s.lines.map((l) => model.lineById[l].code).join(" ")} 線${ui.riders && model.traces[0]?.counts[id] ? `・記録で ${model.traces[0].counts[id]} 回` : ""}</div>`;
}
function tipForTrack(lineId, key) {
  const l = model.lineById[lineId];
  const t = scene.tracks.find((x) => x.line === lineId && x.key === key);
  const what = t.type === "link" ? (t.a === l.parent || t.b === l.parent ? "紙の入口" : "紙の出口") : t.steps.map((s) => `${s.alt ? "もし" : s.num}${s.verb ? " " + s.verb : ""}`).join("、");
  return `<b>${esc(l.code)}　${esc(l.kind === "flow" ? l.name : l.title)}</b><div class="t2">${esc(what)}</div>`;
}
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  placeTip(e);
}
function placeTip(e) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 16;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
function hideTip() { tip.hidden = true; }

// ---------------------------------------------------------------- ridership (the recorded run)
function renderRiders() {
  const g = $("#riders", svg), gn = $("#rider-nums", svg);
  const tr = model.traces[0];
  if (!ui.riders || !tr) { g.innerHTML = ""; gn.innerHTML = ""; return; }
  let h = "", hn = "";
  const list = Object.values(model.stations).filter((s) => tr.counts[s.id]).sort((a, b) => tr.counts[b.id] - tr.counts[a.id]);
  for (const s of list) {
    const n = tr.counts[s.id];
    const c = scene.stations[s.id];
    const r = 10 + Math.sqrt(n) * 4.6;
    h += `<g class="rider"><circle cx="${c.x}" cy="${c.y}" r="${r.toFixed(1)}"/></g>`;
  }
  // The count chips: on the circle's edge where they cover no label, mark or other chip; drawn
  // above the labels, so none can hide behind one.
  const room = roomFinder({ trackWeight: 3 });
  for (const tg of Object.values(originAt)) room.add(tg.r, 100);
  for (const s of list) {
    const n = tr.counts[s.id];
    const c = scene.stations[s.id];
    const r = 10 + Math.sqrt(n) * 4.6;
    const t = String(n), w = 12 + t.length * 8, hh = 21;
    const cands = [];
    for (const [k, d] of [r, r + 10, r + 22, r + 36].entries()) {
      for (let j = 0; j < 16; j++) {
        // start at north-east and go round; the diagonals first
        const ang = -Math.PI / 4 + (j * Math.PI) / 8;
        const x = c.x + Math.cos(ang) * d, y = c.y + Math.sin(ang) * d;
        cands.push({ x, y, r: [x - w / 2, y - hh / 2, x + w / 2, y + hh / 2], pref: (j % 2 ? 0.5 : 0) + Math.min(j, 16 - j) * 0.08 + k * 2.5 });
      }
    }
    // boxed in by labels: on the station itself (its mark is the only thing covered)
    cands.push({ x: c.x, y: c.y, r: [c.x - w / 2, c.y - hh / 2, c.x + w / 2, c.y + hh / 2], pref: 20, pad: 0 });
    // far chips get a leader: count what it would cross (from the circle's edge to the chip)
    for (const cd of cands) {
      const d = Math.hypot(cd.x - c.x, cd.y - c.y);
      if (d > r + 4) {
        const ux = (cd.x - c.x) / d, uy = (cd.y - c.y) / d;
        cd.pref += room.segCost(c.x + ux * 8, c.y + uy * 8, cd.x - ux * 8, cd.y - uy * 8);
      }
    }
    const p = room.best(cands, 2);
    room.add(p.r, 100);
    const far = Math.hypot(p.x - c.x, p.y - c.y) > r + 4;
    hn += `<g class="rider-n" data-st="${esc(s.id)}">${far ? `<path d="M${c.x.toFixed(1)} ${c.y.toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}"/>` : ""}<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${hh / 2}"/><text>${t}</text></g></g>`;
  }
  g.innerHTML = h;
  gn.innerHTML = hn;
}
const riderNote = document.createElement("div");
riderNote.id = "rider-note";
riderNote.hidden = true;
$("#map-wrap").append(riderNote);
function renderRiderNote() {
  const tr = model.traces[0];
  if (!ui.riders || !tr) { riderNote.hidden = true; return; }
  const total = Object.values(model.stations).reduce((a, s) => a + (tr.counts[s.id] || 0), 0);
  const top = Object.values(model.stations).filter((s) => tr.counts[s.id]).sort((a, b) => tr.counts[b.id] - tr.counts[a.id]).slice(0, 3);
  // The recorded program is the Editor: say on screen that the task manager's own stations (the app
  // district) were never entered, rather than leaving a quiet gap on the U line.
  const appFuncs = Object.values(model.stations).filter((s) => s.layer === "app" && s.kind === "func");
  const appNone = appFuncs.length && appFuncs.every((s) => !tr.counts[s.id]);
  riderNote.innerHTML = `<b>乗降回数</b><span>「${esc(tr.title)}」で関数に入った回数（円の大きさ）。${appNone ? `<em>記録は Editor なので、アプリの帯（タスクマネージャ）の駅には入っていない。</em>` : ""}</span>`;
  riderNote.title = `${tr.date.slice(0, 10)} の記録。駅に入った合計 ${fmt(total)} 回。多いのは ${top.map((s) => `${s.name}（${tr.counts[s.id]}）`).join("、")}。`;
  riderNote.hidden = false;
}
$("#ridership").addEventListener("click", (e) => {
  ui.riders = !ui.riders;
  e.currentTarget.setAttribute("aria-pressed", String(ui.riders));
  renderRiders();
  renderRiderNote();
  writeHash();
});

// ---------------------------------------------------------------- search
{
  const input = $("#search"), list = $("#search-results");
  const entries = Object.entries(model.nodes).map(([id, n]) => {
    const s = model.stations[id];
    return { id, name: s ? s.name : n.title, html: s ? nsName(id) : esc(n.title), hay: `${id} ${n.title} ${n.fn || ""} ${s?.name || ""} ${s?.ns || ""} ${s?.sub || ""}`.toLowerCase(), station: !!s, layer: n.layer };
  });
  let sel = 0, results = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    results = entries.filter((e) => e.hay.includes(q)).sort((a, b) => b.station - a.station || a.name.length - b.name.length).slice(0, 12);
    sel = 0;
    list.innerHTML = results.length ? results.map((r, i) => {
      const L = atlas.layers.find((l) => l.id === r.layer);
      return `<li role="option" data-id="${esc(r.id)}" aria-selected="${i === sel}"><span class="r-name">${r.html}</span><span class="r-sub">${r.station ? "駅・" : ""}${esc(L ? L.name : "")}</span></li>`;
    }).join("") : `<li class="muted">見つかりません</li>`;
    list.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = clamp(sel + (e.key === "ArrowDown" ? 1 : -1), 0, results.length - 1);
      $$("li", list).forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
    } else if (e.key === "Enter" && results[sel]) {
      selectNode(results[sel].id);
      list.hidden = true;
      input.blur();
    } else if (e.key === "Escape") { input.value = ""; list.hidden = true; input.blur(); }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    e.preventDefault();
    selectNode(li.dataset.id);
    list.hidden = true;
    input.blur();
  });
  input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 120));
}

// ---------------------------------------------------------------- keyboard
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea")) return;
  if (!lightbox.hidden) { if (e.key === "Escape") lightbox.hidden = true; return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.closest?.("[data-fig]")) { e.preventDefault(); openFigure(e.target.closest("[data-fig]").dataset.fig); return; }
  if (!ui.line && replay?.key(e)) return;
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); return; }
  if (e.key === "Escape") {
    if (legend.classList.contains("open")) closeLegendSheet();
    else if (ui.line) selectLine(null); else if (ui.station) closeNode();
    return;
  }
  if (e.key === "0") { fitAll(); return; }
  if (e.key === "+" || e.key === "=") { const r = box(); zoomAt(1.3, r.width / 2, r.height / 2); return; }
  if (e.key === "-") { const r = box(); zoomAt(1 / 1.3, r.width / 2, r.height / 2); return; }
  if (/^[1-9]$/.test(e.key) && model.lines[Number(e.key) - 1]) { selectLine(model.lines[Number(e.key) - 1].id); return; }
  if (!ui.line) return;
  if (e.key === "ArrowRight") { e.preventDefault(); stop(); goStep(ui.step == null ? 0 : ui.step + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); stop(); goStep(ui.step == null ? 0 : ui.step - 1); }
  else if (e.key === " ") { e.preventDefault(); ui.playing ? stop() : play(); }
});

// ---------------------------------------------------------------- address (shareable state)
let writing = false;
function writeHash() {
  const p = new URLSearchParams();
  if (ui.line) {
    p.set("line", ui.line);
    if (ui.step != null) {
      // step=6 is the step numbered 6 on the map and in the timetable; a "もし" row adds alt=1, 2...
      const order = rideOrder(model.lineById[ui.line]);
      let k = ui.step;
      while (k > 0 && order[k].alt) k--;
      if (order[k] && !order[k].alt) { p.set("step", String(order[k].num)); if (ui.step > k) p.set("alt", String(ui.step - k)); }
    }
  }
  else if (ui.station) p.set("node", ui.station);
  if (ui.riders) p.set("riders", "1");
  const h = p.toString();
  if (location.hash.slice(1) !== h) { writing = true; history.replaceState(null, "", h ? "#" + h : location.pathname); writing = false; }
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("riders") === "1" && !ui.riders) $("#ridership").click();
  if (p.get("line") && model.lineById[p.get("line")]) {
    const order = rideOrder(model.lineById[p.get("line")]);
    let step = null;
    if (p.get("step")) {
      const k = order.findIndex((s) => !s.alt && s.num === Number(p.get("step")));
      if (k >= 0) step = Math.min(order.length - 1, k + Number(p.get("alt") || 0));
    }
    selectLine(p.get("line"), step);
  } else if (p.get("node") && model.nodes[p.get("node")]) selectNode(p.get("node"));
}
window.addEventListener("hashchange", () => { if (!writing) readHash(); });

// ---------------------------------------------------------------- go
updateRail();
renderMap();
renderLegend();
applyEmphasis();
const replay = initReplay({
  model, scene, svg, esc, fmt, ensureVisible,
  onOpen: () => { if (ui.line) selectLine(null, null, { keepView: true }); else if (ui.station) closeNode(); },
});
fitAll(false);
requestAnimationFrame(() => {
  fitAll(false);
  if (location.hash.length > 1) readHash();
});
window.metro = { model, scene, state, P, selectLine, selectNode, goStep, fitAll, focusOn, ui, setCam, replay, roomFinder, originAt, get cam() { return cam; } };
