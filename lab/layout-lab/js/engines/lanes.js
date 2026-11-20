// (6) Proposal: the current viewer's bands, with the things the bench shows it lacks.
//  1. Room for every label: the steps inside a band become rows of boxes joined by short arrows, with the label on the
//     arrow. A label too long for that sits just above the row, hung from its arrow by a short tick. Nothing is drawn
//     over a box.
//  2. Wrapping: a row longer than the frame is cut into lines, one under the other inside its band, so the picture
//     keeps the 1100 px width of the current map.
//  3. Channels: between two ranks of rows runs a channel. Each step between ranks drops into it, runs along its own
//     track and climbs out; tracks are ordered so that runs do not cross the verticals of others. A step that has to
//     pass a rank goes down a corridor: between lines, or between two boxes of a line, crossing the short arrow there
//     at a right angle when that saves a long way round. Labels go in rows of their own in the channel, beside their line.
//  4. Frames per rank: an execution context is a frame round its boxes in each rank; frames of neighbouring ranks
//     merge, frames further apart are joined by an open neck.
import { rectHit } from '../geom.js';
import { textW } from '../measure.js';

export const LANES = {
  W: 1100, LABEL_W: 128, TOP: 30, BOTTOM: 36, X0: 128 + 38, X1: 1100 - 32,
  minGap: 48, plainGap: 44, labelPad: 24, inlineMax: 160, lane: 38, maxRow: 1100 - 128 - 70, lineGap: 40,
  track: 12, chanPad: 12, labelRow: 30, port: 18, empty: 40,
  // a corridor keeps this far from boxes; a main step crossing a short arrow in a row costs this many px of length
  boxPad: 14, crossLocal: 300,
  // a sideways step of up to this many px between two ends of a straight run is taken out
  align: 24,
};

// ---- rows and lines ----
export function makeLines(D, o) {
  const band = (id) => D.box(id).band;
  const parent = Object.fromEntries(D.boxes.map((b) => [b.id, b.id]));
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const inBand = D.steps.filter((s) => !s.alt && band(s.from) === band(s.to));
  for (const s of inBand) parent[find(s.from)] = find(s.to);
  const gmap = new Map();
  for (const b of [...D.boxes].sort((a, c) => a.first - c.first)) {
    const r = find(b.id);
    if (!gmap.has(r)) gmap.set(r, []);
    gmap.get(r).push(b);
  }
  const groups = [...gmap.values()];
  const link = (a, b) => inBand.find((s) => (s.from === a && s.to === b) || (s.from === b && s.to === a));
  // a gap that a corridor passes (known from a first pass) is widened, so the label hung above it can stay clear
  const widen = (s) => (s && o.widen && o.widen[s.i] ? 72 + 14 * (o.widen[s.i] - 1) : 0);
  // a chain is cut into as few lines as it needs with every label lifted; then, line by line, labels come down onto
  // their arrows, the shortest first, as long as the line still fits
  const lifted = (a, b) => { const s = link(a.id, b.id); return s ? Math.max(o.minGap, widen(s)) : o.plainGap; };
  const lines = [];
  for (const g of groups) {
    let cur = [], w = 0, k = 0;
    const flush = () => { lines.push({ boxes: cur, group: g, k: k++ }); cur = []; w = 0; };
    for (const b of g) {
      const add = cur.length ? lifted(cur[cur.length - 1], b) + b.w : b.w;
      if (cur.length && w + add > o.maxRow) flush();
      w += add;
      cur.push(b);
    }
    if (cur.length) flush();
  }
  const inner = {}, above = new Set(), inline = new Set();
  lines.forEach((ln, n) => {
    const pairs = ln.boxes.slice(1).map((b, j) => ({ a: ln.boxes[j], b, s: link(ln.boxes[j].id, b.id) }));
    let width = ln.boxes.reduce((t, b) => t + b.w, 0) + pairs.reduce((t, p) => t + lifted(p.a, p.b), 0);
    const down = new Set();
    for (const p of pairs.filter((q) => q.s && q.s.pill.w + o.labelPad <= o.inlineMax && !widen(q.s)).sort((x, y) => x.s.pill.w - y.s.pill.w)) {
      const more = Math.max(o.minGap, p.s.pill.w + o.labelPad) - lifted(p.a, p.b);
      if (width + more > o.maxRow) continue;
      width += more; down.add(p.s.i);
    }
    let x = 0;
    ln.gaps = [];
    ln.boxes.forEach((b, j) => {
      if (j > 0) {
        const p = pairs[j - 1], gap = p.s && down.has(p.s.i) ? Math.max(o.minGap, p.s.pill.w + o.labelPad) : lifted(p.a, b);
        if (p.s) (down.has(p.s.i) ? inline : above).add(p.s.i);
        ln.gaps.push({ x0: x, x1: x + gap, s: p.s, inline: !!p.s && down.has(p.s.i) });
        x += gap;
      }
      inner[b.id] = { line: n, dx: x };
      x += b.w;
    });
    ln.n = n;
    ln.width = x;
    ln.band = ln.boxes[0].bandIndex;
    ln.lane = ln.gaps.some((g) => g.s && above.has(g.s.i)) ? o.lane : 0;
    ln.first = Math.min(...ln.boxes.map((b) => b.first));
  });
  const local = inBand.filter((s) => inline.has(s.i) || above.has(s.i));
  const cross = D.steps.filter((s) => !local.includes(s));
  return { lines, inner, above, local, cross };
}

// Laid out up to three times: a corridor through a gap whose label hangs above it widens that gap, and a label that
// found no room beside its own line at the frame's edge moves its lines away from that edge; then once more.
export function layoutLanes(D, extra = {}) {
  let o = { ...LANES, ...extra }, out = layoutOnce(D, o);
  for (let pass = 0; pass < 2 && (out.widen || out.room); pass++) {
    const widen = { ...(o.widen || {}) }, room = { ...(o.room || {}) };
    let more = false;
    for (const [k, n] of Object.entries(out.widen || {})) if ((widen[k] || 0) < n) { widen[k] = n; more = true; }
    for (const [k, v] of Object.entries(out.room || {})) { const [l, r] = room[k] || [0, 0]; if (v[0] > l || v[1] > r) { room[k] = [Math.max(l, v[0]), Math.max(r, v[1])]; more = true; } }
    if (!more) break;
    o = { ...o, widen, room };
    out = layoutOnce(D, o);
  }
  return out.G;
}

function layoutOnce(D, o) {
  const { lines, inner, above, local, cross } = makeLines(D, o);
  const lineOf = (id) => lines[inner[id].line];

  // ---- ranks: per band, lines side by side while they fit; a wrapped line goes below the one before it ----
  const ranks = [];
  const bands = [...new Set(lines.map((l) => l.band))].sort((a, b) => a - b);
  for (const bi of bands) {
    const mine = lines.filter((l) => l.band === bi).sort((a, b) => a.k - b.k || a.first - b.first);
    const local = [];
    for (const ln of mine) {
      const prev = ln.k > 0 ? lines.find((x) => x.group === ln.group && x.k === ln.k - 1) : null;
      let r = prev ? local.indexOf(prev.rank) + 1 : 0;
      while (r < local.length && local[r].width + o.lineGap + ln.width > o.maxRow) r++;
      if (r === local.length) local.push({ band: bi, lines: [], width: -o.lineGap });
      local[r].lines.push(ln);
      local[r].width += o.lineGap + ln.width;
      ln.rank = local[r];
    }
    ranks.push(...local);
  }
  ranks.forEach((r, k) => { r.k = k; r.lines.sort((a, b) => a.first - b.first); r.lane = Math.max(...r.lines.map((l) => l.lane)); });

  // ---- x: lines in reading order, pulled toward the boxes their steps join, kept apart and inside the frame ----
  const boxX = (id) => lineOf(id).x + inner[id].dx;
  const cxOf = (id) => boxX(id) + D.box(id).w / 2;
  // spread lines over the width the first time by reading order, so that the flow runs left to right
  const order = [...lines].sort((a, b) => a.first - b.first);
  order.forEach((ln, k) => { ln.want = o.X0 + (o.X1 - o.X0 - ln.width) * (order.length > 1 ? k / (order.length - 1) : 0.5); });
  for (const ln of lines) ln.x = ln.want;
  // room asked for by labels at the frame's edges (from an earlier pass): [px from the left edge, px from the right]
  const roomOf = (ln) => ln.boxes.reduce((a, b) => { const q = (o.room || {})[b.id]; return q ? [Math.max(a[0], q[0]), Math.max(a[1], q[1])] : a; }, [0, 0]);
  for (const ln of lines) { const [l, r] = roomOf(ln); ln.lo = o.X0 + l; ln.hi = o.X1 - r; }
  const settle = () => {
    for (const r of ranks) {
      const row = r.lines;
      for (let i = 0; i < row.length; i++) row[i].x = Math.max(row[i].x, row[i].lo, i ? row[i - 1].x + row[i - 1].width + o.lineGap : -Infinity);
      for (let i = row.length - 1; i >= 0; i--) row[i].x = Math.min(row[i].x, row[i].hi - row[i].width, i < row.length - 1 ? row[i + 1].x - o.lineGap - row[i].width : Infinity);
      for (const ln of row) ln.x = Math.max(o.X0, ln.x);
    }
  };
  settle();
  for (let it = 0; it < 30; it++) {
    for (const ln of lines) {
      let sum = 0, n = 0;
      for (const s of cross) {
        const mine = ln.boxes.find((b) => b.id === s.from || b.id === s.to);
        if (!mine) continue;
        const other = mine.id === s.from ? s.to : s.from;
        if (lineOf(other) === ln) continue;
        sum += cxOf(other) - cxOf(mine.id); n += s.alt ? 0.3 : 1;
        if (s.alt) sum -= (cxOf(other) - cxOf(mine.id)) * 0.7;
      }
      if (n) ln.x += (sum / n) * 0.35;
    }
    settle();
  }
  for (const ln of lines) ln.x = Math.round(ln.x);

  // ---- routing as a plan: ports, routes, tracks. A plan can be scored, so corridors are chosen by search ----
  const rankOf = (id) => lineOf(id).rank.k;
  const sideOf = (me, other) => (rankOf(other) < rankOf(me) ? 't' : 'b');
  // the gaps whose label hangs over the row, and where that label goes: over the middle of the gap, or beside the
  // corridors that pass the gap, on the side with room for its tick (which keeps 14 px from a box, 8 from a line)
  const liftGaps = [];
  for (const ln of lines) for (const g of ln.gaps) if (g.s && above.has(g.s.i)) {
    liftGaps.push({ s: g.s, line: ln, rank: ln.rank.k, x0: ln.x + g.x0, x1: ln.x + g.x1, w: g.s.pill.w });
  }
  const liftedSpot = (g, xs) => {
    const mid = Math.round((g.x0 + g.x1) / 2);
    if (!xs.length) return { lx: mid - g.w / 2, tick: mid, ok: true };
    const lo = Math.min(...xs), hi = Math.max(...xs);
    if (lo - g.x0 >= g.x1 - hi) {
      const tick = Math.round(Math.max(g.x0 + 14, Math.min(lo - 22, (g.x0 + lo) / 2)));
      return { lx: lo - 10 - g.w, tick, ok: tick >= g.x0 + 14 && tick <= lo - 22 };
    }
    const tick = Math.round(Math.min(g.x1 - 14, Math.max(hi + 22, (hi + g.x1) / 2)));
    return { lx: hi + 10, tick, ok: tick <= g.x1 - 14 && tick >= hi + 22 };
  };
  const lanesFor = (corr) => liftGaps.map((g) => {
    const xs = [...corr.entries()].filter(([i, x]) => { const s = D.steps[i], [lo, hi] = span(s); return lo < g.rank && hi > g.rank && x > g.x0 && x < g.x1; }).map(([, x]) => x);
    const spot = liftedSpot(g, xs);
    return { g, spot, line: g.line, x0: spot.lx - 10, x1: spot.lx + g.w + 10 };
  });
  const multi = cross.filter((s) => Math.abs(rankOf(s.from) - rankOf(s.to)) > 1);
  // what a corridor may not pass in a rank: its boxes, and the labels that sit on arrows between them
  const blocksOf = ranks.map((r) => {
    const out = [];
    for (const ln of r.lines) {
      for (const b of ln.boxes) { const x = boxX(b.id); out.push([x - o.boxPad, x + b.w + o.boxPad]); }
      for (const g of ln.gaps) if (g.inline) { const mid = ln.x + (g.x0 + g.x1) / 2, w = g.s.pill.w; out.push([mid - w / 2 - 6, mid + w / 2 + 6]); }
    }
    return out;
  });
  const gapsOf = ranks.map((r) => r.lines.flatMap((ln) => ln.gaps.filter((g) => !g.inline).map((g) => ({ x0: ln.x + g.x0, x1: ln.x + g.x1, lifted: !!g.s }))));
  function span(s) { return [Math.min(rankOf(s.from), rankOf(s.to)), Math.max(rankOf(s.from), rankOf(s.to))]; }
  // a corridor may pass a gap whose label hangs above it only at the gap's middle (or ±10 in a wide gap), so the label
  // keeps room for its tick on one side
  const gapSpots = (g) => { const m = Math.round((g.x0 + g.x1) / 2); return g.x1 - g.x0 >= 92 ? [m - 10, m, m + 10] : [m]; };
  const passes = (s, x) => {
    const [lo, hi] = span(s);
    if (x < o.LABEL_W + 10 || x > o.W - 8) return false;
    for (let r = lo + 1; r < hi; r++) {
      if (blocksOf[r].some(([a, b]) => x > a && x < b)) return false;
      if (gapsOf[r].some((g) => g.lifted && x > g.x0 && x < g.x1 && !gapSpots(g).includes(x))) return false;
    }
    return true;
  };
  const corridorCands = (s) => {
    const [lo, hi] = span(s);
    const xs = new Set([cxOf(s.from), cxOf(s.to)]);
    for (let r = lo + 1; r < hi; r++) {
      for (const [a, b] of blocksOf[r]) for (const d of [1, 13]) { xs.add(a - d); xs.add(b + d); }
      for (const g of gapsOf[r]) { if (g.lifted) for (const m of gapSpots(g)) xs.add(m); else { const m = (g.x0 + g.x1) / 2; xs.add(m); if (g.x1 - g.x0 >= 64) { xs.add(m - 10); xs.add(m + 10); } } }
    }
    for (const d of [0, 12]) { xs.add(o.LABEL_W + 12 + d); xs.add(o.W - 12 - d); }
    for (const id of [s.from, s.to]) { const w = D.box(id).w; xs.add(boxX(id) + w / 4); xs.add(boxX(id) + (3 * w) / 4); }
    const out = [];
    for (const x of [...xs].map(Math.round).filter((x) => passes(s, x)).sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > 5) out.push(x);
    return out;
  };
  const keyOf = (me, other) => me + '|' + (rankOf(me) === rankOf(other) ? 'b' : sideOf(me, other));
  // ports: ordered by where each route really arrives, spread over the side, clear of lane labels
  const portsFor = (corr, start = {}, laneLabels = lanesFor(corr)) => {
    const approach = (s, end, px) => (corr.has(s.i) ? corr.get(s.i) : px[`${s.i}${end === 's' ? 't' : 's'}`] ?? cxOf(end === 's' ? s.to : s.from));
    let portX = start;
    for (let pass = 0; pass < 3; pass++) {
      const ends = new Map();
      for (const s of cross) for (const [me, other, role] of [[s.from, s.to, 's'], [s.to, s.from, 't']]) {
        const key = keyOf(me, other);
        if (!ends.has(key)) ends.set(key, []);
        const bx = boxX(me), bw = D.box(me).w, ax = approach(s, role, portX);
        ends.get(key).push({ s, role, want: Math.max(bx + o.port, Math.min(bx + bw - o.port, ax)), ax });
      }
      const next = {};
      for (const [key, list] of ends) {
        const [me, sd] = key.split('|');
        const bx = boxX(me), bw = D.box(me).w, lo = bx + o.port, hi = bx + bw - o.port;
        const avoid = sd === 't' ? laneLabels.filter((l) => l.line === lineOf(me)).map((l) => [l.x0, l.x1]) : [];
        list.sort((a, b) => a.ax - b.ax || a.s.i - b.s.i);
        const xs = list.map((e) => e.want);
        for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 16);
        if (xs.length && xs[xs.length - 1] > hi) { xs[xs.length - 1] = hi; for (let i = xs.length - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - 16); }
        for (let i = 0; i < xs.length; i++) {
          xs[i] = Math.max(lo, xs[i]);
          for (const [a, b] of avoid) if (xs[i] > a && xs[i] < b) xs[i] = xs[i] - a < b - xs[i] && a >= lo ? a : b <= hi ? b : a;
        }
        list.forEach((e, j) => { next[`${e.s.i}${e.role}`] = Math.round(xs[j]); });
      }
      portX = next;
    }
    return portX;
  };
  const sideList = new Map();
  for (const s of cross) for (const [me, role] of [[s.from, 's'], [s.to, 't']]) {
    const key = keyOf(me, role === 's' ? s.to : s.from);
    if (!sideList.has(key)) sideList.set(key, []);
    sideList.get(key).push(`${s.i}${role}`);
  }
  const plan = (choice) => {
    // corridors: the chosen x, or the one nearest both ends that no other corridor of the same ranks uses
    const corr = new Map(), usedC = [];
    let conflicts = 0;
    for (const s of multi) {
      const [lo, hi] = span(s);
      let x = choice.get(s.i);
      if (x != null && usedC.some((u) => u.lo < hi && u.hi > lo && Math.abs(u.x - x) < 12)) conflicts++;
      if (x == null) {
        const upper = rankOf(s.from) < rankOf(s.to) ? s.from : s.to;
        let best = null;
        for (const c of corridorCands(s)) {
          if (usedC.some((u) => u.lo < hi && u.hi > lo && Math.abs(u.x - c) < 12)) continue;
          const cost = Math.abs(c - cxOf(s.from)) + Math.abs(c - cxOf(s.to)) + 0.01 * Math.abs(c - cxOf(upper));
          if (!best || cost < best.cost) best = { cost, x: c };
        }
        x = best ? best.x : o.W - 10;
      }
      corr.set(s.i, x);
      usedC.push({ x, lo, hi, i: s.i });
    }
    let portX = portsFor(corr);
    // a jog of a few pixels between a corridor and the port it leaves or reaches reads as a mistake: the corridor
    // moves onto the port when it may pass there
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const s of multi) {
        const c = corr.get(s.i), [lo, hi] = span(s);
        const xs = [portX[`${s.i}s`], portX[`${s.i}t`]].filter((x) => x !== c && Math.abs(x - c) <= o.align).sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
        for (const x of xs) {
          if (!passes(s, x) || usedC.some((u) => u.i !== s.i && u.lo < hi && u.hi > lo && Math.abs(u.x - x) < 12)) continue;
          corr.set(s.i, x); usedC.find((u) => u.i === s.i).x = x; moved = true; break;
        }
      }
      if (!moved) break;
      portX = portsFor(corr, portX);
    }
    // the same between the two ends of a step to the next rank: both ports move to one x when the sides allow it
    const fits = (pk, x, me, other) => {
      const bx = boxX(me), bw = D.box(me).w;
      if (x < bx + o.port || x > bx + bw - o.port) return false;
      return sideList.get(keyOf(me, other)).every((q) => q === pk || Math.abs(portX[q] - x) >= 16);
    };
    for (const s of cross) {
      if (corr.has(s.i) || rankOf(s.from) === rankOf(s.to)) continue;
      const a = `${s.i}s`, b = `${s.i}t`, d = portX[b] - portX[a];
      if (!d || Math.abs(d) > o.align) continue;
      const mid = Math.round(portX[a] + d / 2);
      for (const x of [portX[b], portX[a], mid, mid - 8, mid + 8, portX[a] - 8 * Math.sign(d), portX[b] + 8 * Math.sign(d)]) {
        if (fits(a, x, s.from, s.to) && fits(b, x, s.to, s.from)) { portX[a] = portX[b] = x; break; }
      }
    }
    const routes = cross.map((s) => {
      const ra = rankOf(s.from), rb = rankOf(s.to), xa = portX[`${s.i}s`], xb = portX[`${s.i}t`];
      const down = rb >= ra, runs = [];
      if (ra === rb) runs.push({ ch: ra, x0: xa, x1: xb, ta: 'top', tb: 'top' });
      else if (Math.abs(rb - ra) === 1) runs.push({ ch: Math.min(ra, rb), x0: xa, x1: xb, ta: down ? 'top' : 'bottom', tb: down ? 'bottom' : 'top' });
      else {
        const xc = corr.get(s.i);
        if (down) { runs.push({ ch: ra, x0: xa, x1: xc, ta: 'top', tb: 'bottom' }); runs.push({ ch: rb - 1, x0: xc, x1: xb, ta: 'top', tb: 'bottom' }); }
        else { runs.push({ ch: ra - 1, x0: xa, x1: xc, ta: 'bottom', tb: 'top' }); runs.push({ ch: rb, x0: xc, x1: xb, ta: 'bottom', tb: 'top' }); }
      }
      const rt = { s, ra, rb, xa, xb, down, runs, sameRank: ra === rb };
      for (const run of runs) run.rt = rt;
      return rt;
    });
    // tracks: in each channel, runs above or below each other so that their verticals cross no run
    const chans = ranks.map(() => []);
    for (const rt of routes) for (const run of rt.runs) chans[run.ch].push(run);
    const chanTracks = chans.map((runs) => {
      for (const r of runs) { r.lo = Math.min(r.x0, r.x1); r.hi = Math.max(r.x0, r.x1); r.flat = r.hi - r.lo < 1; }
      const live = runs.filter((r) => !r.flat);
      const over = new Map(live.map((r) => [r, new Set()]));
      const inside = (x, r) => x > r.lo - 6 && x < r.hi + 6;
      for (const i of live) for (const j of live) {
        if (i === j) continue;
        if ((i.ta === 'top' && inside(i.x0, j)) || (i.tb === 'top' && inside(i.x1, j))) over.get(i).add(j);
        if ((i.ta === 'bottom' && inside(i.x0, j)) || (i.tb === 'bottom' && inside(i.x1, j))) over.get(j).add(i);
      }
      const order = [], seen = new Set(), temp = new Set();
      const visit = (r) => {
        if (seen.has(r) || temp.has(r)) return;
        temp.add(r);
        for (const q of live) if (over.get(q).has(r)) visit(q);
        temp.delete(r); seen.add(r); order.push(r);
      };
      for (const r of [...live].sort((a, b) => a.lo - b.lo)) visit(r);
      const track = new Map();
      let max = -1;
      for (const r of order) {
        let t = 0;
        for (const q of live) if (track.has(q) && over.get(q).has(r)) t = Math.max(t, track.get(q) + 1);
        while ([...track].some(([q, tq]) => tq === t && !(q.hi + 14 < r.lo || r.hi + 14 < q.lo))) t++;
        track.set(r, t); max = Math.max(max, t);
      }
      for (const r of live) r.track = track.get(r);
      return max + 1;
    });
    // a label with no room beside the corridors through its gap counts only once gaps have been widened (2nd pass)
    const lanes = lanesFor(corr);
    return { corr, portX, routes, chans, chanTracks, conflicts, lanes, badLift: o.widen ? lanes.filter((l) => !l.spot.ok).length : 0 };
  };
  // a plan's lines with channels only as tall as their tracks, and the short arrows inside rows: enough to count
  // crossings and length
  const sketch = (P) => {
    const top = [], ch = [];
    let y = 0;
    ranks.forEach((r, k) => { top[k] = y; y += r.lane + 66; ch[k] = y; y += o.chanPad * 2 + Math.max(0, P.chanTracks[k] - 1) * o.track + 20; });
    const bx = (id) => ({ x: boxX(id), y: top[rankOf(id)] + lineOf(id).rank.lane, w: D.box(id).w, h: 66 });
    const out = P.routes.map((rt) => {
      const A = bx(rt.s.from), B = bx(rt.s.to);
      const pts = [[rt.xa, rt.down || rt.sameRank ? A.y + A.h : A.y]];
      for (const run of rt.runs) { const ty = ch[run.ch] + o.chanPad + (run.flat ? 0 : run.track * o.track); pts.push([run.x0, ty], [run.x1, ty]); }
      pts.push([rt.xb, rt.sameRank ? B.y + B.h : rt.down ? B.y : B.y + B.h]);
      return { i: rt.s.i, alt: !!rt.s.alt, pts: dedupe(pts) };
    });
    for (const s of local) {
      const A = bx(s.from), B = bx(s.to), yy = A.y + 33, right = B.x > A.x;
      out.push({ i: s.i, alt: false, local: true, lifted: above.has(s.i), pts: [[right ? A.x + A.w : A.x, yy], [right ? B.x : B.x + B.w, yy]] });
    }
    return out;
  };
  const score = (P) => {
    const es = sketch(P);
    let bad = 0, len = 0;
    for (const e of es) if (!e.local) for (let i = 0; i < e.pts.length - 1; i++) len += Math.abs(e.pts[i + 1][0] - e.pts[i][0]) + Math.abs(e.pts[i + 1][1] - e.pts[i][1]);
    for (let a = 0; a < es.length; a++) for (let b = a + 1; b < es.length; b++) {
      const loc = es[a].local || es[b].local;
      if (es[a].local && es[b].local) continue;
      const alt = es[a].alt || es[b].alt;
      // a main step's corridor across a short arrow in a row: one clean right angle, worth a way round of crossLocal
      // px. A step that happens instead of another (もし) gets no such pass: it goes round rather than add a crossing.
      const w = loc ? (alt ? 1000 : o.crossLocal) + (es[a].lifted || es[b].lifted ? 60 : 0) : alt ? 600 : 1000;
      for (let i = 0; i < es[a].pts.length - 1; i++) for (let k = 0; k < es[b].pts.length - 1; k++) {
        const p = es[a].pts[i], q = es[a].pts[i + 1], r = es[b].pts[k], t = es[b].pts[k + 1];
        if (properCross(p, q, r, t)) bad += w;
        else if (sameLine(p, q, r, t)) bad += w;
      }
    }
    return bad + len + P.chanTracks.reduce((a, n) => a + n, 0) * 20 + P.conflicts * 5000 + P.badLift * 400;
  };
  let choice = new Map(), P = plan(choice), best = score(P);
  for (const s of multi) choice.set(s.i, P.corr.get(s.i));
  for (let round = 0; round < 3; round++) {
    let better = false;
    for (const s of multi) {
      for (const x of corridorCands(s)) {
        if (x === choice.get(s.i)) continue;
        const c2 = new Map(choice); c2.set(s.i, x);
        const P2 = plan(c2), v = score(P2);
        if (v < best - 0.5) { best = v; choice = c2; P = P2; better = true; }
      }
    }
    if (!better) break;
  }
  const { routes, chans, chanTracks } = P;

  // ---- labels in the channels: beside their own line, in the first free spot of a label row ----
  // In a channel, the label rows lie under the tracks; only lines going down from a track (or straight through)
  // cross them. A label goes right of its own such line if it can, else as near as possible, else one row lower.
  // where a route can carry its label: each channel it runs in, beside (or on) the line it sends down there
  const spotsOf = (rt) => rt.runs.map((run) => ({ c: run.ch, own: run.flat ? run.x0 : run.tb === 'bottom' ? run.x1 : run.ta === 'bottom' ? run.x0 : run.x1 }));
  const crossers = (c) => {
    const xs = [];
    for (const run of chans[c] || []) {
      if (run.flat) xs.push({ x: run.x0, i: run.rt.s.i });
      else { if (run.ta === 'bottom') xs.push({ x: run.x0, i: run.rt.s.i }); if (run.tb === 'bottom') xs.push({ x: run.x1, i: run.rt.s.i }); }
    }
    // a corridor that passes straight through a channel
    for (const rt of routes) if (rt.runs.length > 1) {
      const lo = Math.min(rt.ra, rt.rb), hi = Math.max(rt.ra, rt.rb);
      if (c > lo && c < hi - 1) xs.push({ x: P.corr.get(rt.s.i), i: rt.s.i });
    }
    return xs;
  };
  const roomAsk = {};
  const rowsUsed = chans.map(() => 0);
  const rowsIn = chans.map(() => []);
  const labelAt = new Map();
  const vsOf = chans.map((_, c) => crossers(c));
  for (const rt of [...routes].sort((a, b) => a.s.i - b.s.i)) {
    const w = rt.s.pill.w;
    let best = null;
    spotsOf(rt).forEach(({ c, own }, k) => {
      const vs = vsOf[c], rows = rowsIn[c];
      for (let row = 0; row < 3; row++) {
        const xs = [[own + 7, 0], [own - 7 - w, 0.4], [own - w / 2, 1.5]];
        for (let d = 12; d < o.W; d += 12) xs.push([own + 7 + d, 0], [own - 7 - w - d, 0.4]);
        for (const [lx, pen] of xs) {
          if (lx < o.LABEL_W + 6 || lx + w > o.W - 4) continue;
          if ((rows[row] || []).some(([a, b]) => lx < b + 8 && lx + w > a - 8)) continue;
          const dist = lx > own ? lx - own - 7 : lx + w < own ? own - 7 - (lx + w) : 0;
          let cost = k * 1.5 + row * 6 + dist / 30 + pen;
          for (const v of vs) {
            if (v.i === rt.s.i) continue;
            if (v.x > lx - 2 && v.x < lx + w + 2) cost += 14;
            // another line between a label and its own line makes the label read as that line's
            else if ((v.x > own && v.x < lx) || (v.x < own && v.x > lx + w)) cost += 12;
          }
          if (!best || cost < best.cost) best = { cost, lx, row, c };
        }
      }
    });
    (rowsIn[best.c][best.row] = rowsIn[best.c][best.row] || []).push([best.lx, best.lx + w]);
    labelAt.set(rt.s.i, { c: best.c, x: best.lx, row: best.row });
    rowsUsed[best.c] = Math.max(rowsUsed[best.c], best.row + 1);
    // a label that had to sit across or beyond another line, where the frame's edge cut off the free side of its own
    // line: its boxes' lines will keep that much further from the edge next time
    if (best.cost >= 12) {
      // the spot nearest an end box: there, moving that box's line moves the label's own line too
      const sp = spotsOf(rt).find((p) => p.own === rt.xa || p.own === rt.xb) || spotsOf(rt)[0];
      const id = sp.own === rt.xb ? rt.s.to : rt.s.from, ln = lineOf(id);
      const needR = sp.own + 7 + w - (o.W - 4), needL = o.LABEL_W + 6 - (sp.own - 7 - w);
      const ask = (q) => { const p = roomAsk[id] || [0, 0]; roomAsk[id] = [Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
      if (needR > 0 && needR < 200) ask([0, Math.round(o.X1 - (ln.x + ln.width - needR - 8))]);
      else if (needL > 0 && needL < 200) ask([Math.round(ln.x + needL + 8 - o.X0), 0]);
    }
  }

  // ---- y: ranks and channels top to bottom; a band the diagram does not pass keeps a thin strip of its own ----
  const chanH = chanTracks.map((n, c) => o.chanPad * 2 + Math.max(0, n - 1) * o.track + rowsUsed[c] * o.labelRow);
  const rankTop = [], chanTop = [], emptyAt = new Map();
  let y = o.TOP;
  const last = ranks.length - 1;
  for (const band of D.bands) {
    const rs = ranks.filter((r) => r.band === band.index);
    if (!rs.length) { emptyAt.set(band.index, [y, y + o.empty]); y += o.empty; continue; }
    for (const r of rs) {
      rankTop[r.k] = y; y += r.lane + 66;
      if (r.k < last || (chans[last] && chans[last].length)) { chanTop[r.k] = y; y += Math.max(34, chanH[r.k]); }
    }
  }
  const height = y + o.BOTTOM;
  const boxes = {};
  for (const b of D.boxes) { const r = lineOf(b.id).rank; boxes[b.id] = { x: boxX(b.id), y: rankTop[r.k] + r.lane, w: b.w, h: b.h }; }
  const trackY = (run) => chanTop[run.ch] + o.chanPad + (run.flat ? 0 : run.track * o.track);
  const rowY = (c, row) => chanTop[c] + o.chanPad + Math.max(0, chanTracks[c] - 1) * o.track + 4 + row * o.labelRow + (o.labelRow - 24) / 2;

  // ---- the polylines ----
  const edges = [];
  for (const rt of routes) {
    const A = boxes[rt.s.from], B = boxes[rt.s.to];
    const pts = [];
    const startY = rt.down || rt.sameRank ? A.y + A.h : A.y;
    const endY = rt.sameRank ? B.y + B.h : rt.down ? B.y : B.y + B.h;
    pts.push([rt.xa, startY]);
    for (const run of rt.runs) {
      const ty = trackY(run);
      pts.push([run.x0, ty], [run.x1, ty]);
    }
    pts.push([rt.xb, endY]);
    edges.push({ i: rt.s.i, pts: dedupe(pts) });
  }
  for (const s of local) {
    const a = boxes[s.from], b = boxes[s.to], yy = a.y + a.h / 2, right = b.x > a.x;
    edges.push({ i: s.i, pts: [[right ? a.x + a.w : a.x, yy], [right ? b.x : b.x + b.w, yy]] });
  }
  edges.sort((p, q) => p.i - q.i);

  // ---- labels: on their arrow, or above the row hung from it by a tick; the others where the channels put them ----
  const labels = [];
  const verticals = [];
  for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) {
    const p = e.pts[i], q = e.pts[i + 1];
    if (Math.abs(p[0] - q[0]) < 0.5) verticals.push({ i: e.i, x: p[0], y0: Math.min(p[1], q[1]), y1: Math.max(p[1], q[1]) });
  }
  const lifted = [];
  for (const s of local) {
    const a = boxes[s.from], b = boxes[s.to], yy = a.y + a.h / 2, right = b.x > a.x;
    const x0 = right ? a.x + a.w : b.x + b.w, x1 = right ? b.x : a.x, w = s.pill.w;
    if (!above.has(s.i)) { labels.push({ i: s.i, x: (x0 + x1) / 2 - w / 2, y: yy - s.pill.h / 2, w, h: s.pill.h }); continue; }
    // the label's foot stays 13 px over the boxes, clear of a frame drawn 10 px round them
    const ly = a.y - 13 - s.pill.h;
    // the lines that pass the lane or the gap, which neither the label nor its tick may touch
    const vs = verticals.filter((v) => v.i !== s.i && v.y0 < yy && v.y1 > ly);
    const tickLo = x0 + (right ? 8 : 14), tickHi = x1 - (right ? 14 : 8);
    const free = (lx) => lx >= o.LABEL_W + 6 && lx + w <= o.W - 4
      && !vs.some((v) => v.y0 < ly + s.pill.h && v.y1 > ly && v.x > lx - 10 && v.x < lx + w + 10)
      && !lifted.some((r) => r[1] === ly && lx < r[2] + 8 && lx + w > r[0] - 8);
    // first the spot the routing planned for it, beside the corridors through its gap
    const pre = P.lanes.find((l) => l.g.s.i === s.i);
    let best = pre && pre.spot.ok && free(Math.round(pre.spot.lx)) && !vs.some((v) => Math.abs(v.x - pre.spot.tick) < 8) ? { lx: Math.round(pre.spot.lx), tick: pre.spot.tick } : null;
    for (let d = 0; d <= 400 && !best; d += 4) for (const sg of d ? [1, -1] : [1]) {
      const lx = Math.round((x0 + x1) / 2 - w / 2 + sg * d);
      if (lx < o.LABEL_W + 6 || lx + w > o.W - 4) continue;
      if (vs.some((v) => v.y0 < ly + s.pill.h && v.y1 > ly && v.x > lx - 10 && v.x < lx + w + 10)) continue;
      if (lifted.some((r) => r[1] === ly && lx < r[2] + 8 && lx + w > r[0] - 8)) continue;
      // the tick: nearest the middle of the gap, inside the label, clear of the lines that pass the gap
      let tick = null;
      for (let t = 0; t <= (x1 - x0) / 2 && tick == null; t += 2) for (const ts of t ? [1, -1] : [1]) {
        const tx = Math.round((x0 + x1) / 2 + ts * t);
        if (tx < tickLo || tx > tickHi || tx < lx + 12 || tx > lx + w - 12) continue;
        if (vs.some((v) => Math.abs(v.x - tx) < 8)) continue;
        tick = tx; break;
      }
      if (tick == null) continue;
      best = { lx, tick };
      break;
    }
    if (!best) best = { lx: Math.round((x0 + x1) / 2 - w / 2), tick: Math.round((x0 + x1) / 2) };
    lifted.push([best.lx, ly, best.lx + w]);
    labels.push({ i: s.i, x: best.lx, y: ly, w, h: s.pill.h, leader: [[best.tick, ly + s.pill.h], [best.tick, yy]] });
  }
  for (const rt of routes) {
    const at = labelAt.get(rt.s.i);
    labels.push({ i: rt.s.i, x: at.x, y: rowY(at.c, at.row), w: rt.s.pill.w, h: rt.s.pill.h });
  }
  labels.sort((p, q) => p.i - q.i);

  // ---- bands: from the middle of the channel above their first rank to the middle of the one below their last ----
  const items = D.bands.map((band) => {
    const rs = ranks.filter((r) => r.band === band.index);
    if (!rs.length) { const [t, b] = emptyAt.get(band.index); return { ...band, top: t, bottom: b, empty: true }; }
    return { ...band, top: rankTop[rs[0].k], bottom: rankTop[rs[rs.length - 1].k] + rs[rs.length - 1].lane + 66 };
  });
  const strips = items.map((b, k) => ({
    ...b,
    y0: k === 0 ? 0 : b.empty ? b.top : items[k - 1].empty ? items[k - 1].bottom : (items[k - 1].bottom + b.top) / 2,
    y1: k === items.length - 1 ? height : b.empty ? b.bottom : items[k + 1].empty ? items[k + 1].top : (b.bottom + items[k + 1].top) / 2,
  }));
  // frames round execution contexts, named in a clear corner
  const regions = frames(D, boxes, edges, labels, o.LABEL_W, (id) => lineOf(id).rank.k, height, o.W);
  // gaps that corridors pass, and how many: the second pass widens them when their label hangs above
  const widen = {};
  for (const s of multi) {
    const x = P.corr.get(s.i), [lo, hi] = span(s);
    for (let r = lo + 1; r < hi; r++) for (const ln of ranks[r].lines) for (const g of ln.gaps) {
      if (g.s && above.has(g.s.i) && x > ln.x + g.x0 && x < ln.x + g.x1) widen[g.s.i] = (widen[g.s.i] || 0) + 1;
    }
  }
  const G = { width: o.W, height, labelCol: o.LABEL_W, bands: strips, boxes, edges, labels, regions };
  return { G, widen: Object.keys(widen).length ? widen : null, room: Object.keys(roomAsk).length ? roomAsk : null };
}

function properCross(p, q, r, t) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(r, t, p), d2 = d(r, t, q), d3 = d(p, q, r), d4 = d(p, q, t);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function sameLine(p, q, r, t) {
  if (Math.abs(p[0] - q[0]) < 0.5 && Math.abs(r[0] - t[0]) < 0.5 && Math.abs(p[0] - r[0]) < 3) {
    return Math.min(Math.max(p[1], q[1]), Math.max(r[1], t[1])) - Math.max(Math.min(p[1], q[1]), Math.min(r[1], t[1])) > 4;
  }
  if (Math.abs(p[1] - q[1]) < 0.5 && Math.abs(r[1] - t[1]) < 0.5 && Math.abs(p[1] - r[1]) < 3) {
    return Math.min(Math.max(p[0], q[0]), Math.max(r[0], t[0])) - Math.max(Math.min(p[0], q[0]), Math.min(r[0], t[0])) > 4;
  }
  return false;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue;
    out.push(p);
  }
  // drop middle points of straight runs
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5) || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) out.splice(i, 1);
  }
  return out;
}

// Frames round execution contexts. In each rank, a rectangle round the members there. Rectangles of neighbouring
// ranks that overlap enough merge into one shape (the channel between them belongs to the context too): the strip
// that joins them grows to take in the labels of steps between members, and shrinks to leave out a label it would
// cut. Members further apart get frames of their own, each named (the later ones by the short name, when there is one).
export function frames(D, boxes, edges, labels, minX, rankOf, height = Infinity, width = Infinity) {
  const named = [];
  const labRects = labels.map((l) => [l.x - 2, l.y - 2, l.x + l.w + 2, l.y + l.h + 2]);
  const boxRects = Object.values(boxes).map((b) => [b.x, b.y, b.x + b.w, b.y + b.h]);
  const boxList = Object.entries(boxes).map(([id, b]) => ({ id, r: [b.x - 4, b.y - 4, b.x + b.w + 4, b.y + b.h + 4] }));
  return D.regions.map((rg) => {
    const others = boxList.filter((b) => !rg.boxes.includes(b.id));
    const byRank = new Map();
    for (const id of rg.boxes) { const k = rankOf ? rankOf(id) : 0; if (!byRank.has(k)) byRank.set(k, []); byRank.get(k).push(boxes[id]); }
    const ks = [...byRank.keys()].sort((a, b) => a - b);
    const rects = ks.map((k) => {
      const gs = byRank.get(k);
      return [Math.max(minX + 4, Math.min(...gs.map((g) => g.x)) - 10), Math.min(...gs.map((g) => g.y)) - 10, Math.max(...gs.map((g) => g.x + g.w)) + 10, Math.max(...gs.map((g) => g.y + g.h)) + 10];
    });
    const member = (l) => { const st = D.steps[l.i]; return rg.boxes.includes(st.from) && rg.boxes.includes(st.to); };
    // the frames of two neighbouring ranks may widen sideways to take in a label of their own, if no other box comes in
    const widenTo = (a, b, x0, x1) => {
      const a2 = [Math.min(a[0], x0), a[1], Math.max(a[2], x1), a[3]], b2 = [Math.min(b[0], x0), b[1], Math.max(b[2], x1), b[3]];
      if (a2[0] < minX + 4 || others.some((o) => rectHit(o.r, a2) || rectHit(o.r, b2))) return false;
      a.splice(0, 4, ...a2); b.splice(0, 4, ...b2);
      return true;
    };
    const fitBridge = (a, b, lo, hi) => {
      const y0 = a[3], y1 = b[1];
      let L = lo, R = hi;
      for (let pass = 0; pass < 3; pass++) for (const l of labels) {
        const r = [l.x - 4, l.y, l.x + l.w + 4, l.y + l.h];
        if (r[3] <= y0 || r[1] >= y1 || r[2] <= L || r[0] >= R || (r[0] >= L && r[2] <= R)) continue;
        const minL = Math.min(a[0], b[0]), maxR = Math.max(a[2], b[2]);
        if (member(l)) {
          if ((r[0] < minL || r[2] > maxR) && widenTo(a, b, r[0], r[2])) { L = Math.min(L, r[0]); R = Math.max(R, r[2]); continue; }
          L = Math.max(Math.min(a[0], b[0]), Math.min(L, r[0])); R = Math.min(Math.max(a[2], b[2]), Math.max(R, r[2]));
        } else if (r[0] < L) { if (R - r[2] >= 40) L = r[2]; else L = Math.max(minL, r[0]); }
        else if (r[0] - L >= 40) R = r[0];
        else R = Math.min(maxR, r[2]);
      }
      return [L, a[3] - 1, R, b[1] + 1];
    };
    const blobs = [[rects[0]]], parts = [rects[0]];
    for (let k = 1; k < rects.length; k++) {
      const a = rects[k - 1], b = rects[k];
      const lo = Math.max(a[0], b[0]), hi = Math.min(a[2], b[2]);
      if (ks[k] - ks[k - 1] === 1 && hi - lo >= 40) {
        const bridge = fitBridge(a, b, lo, hi);
        parts.push(bridge, b); blobs[blobs.length - 1].push(bridge, b);
      } else { parts.push(b); blobs.push([b]); }
    }
    const x0 = Math.min(...parts.map((r) => r[0])), y0 = Math.min(...parts.map((r) => r[1]));
    const x1 = Math.max(...parts.map((r) => r[2])), y1 = Math.max(...parts.map((r) => r[3]));
    // a name per frame, in the clearest corner; the full name goes to the frame where it sits best
    const spotFor = (bl, text, taken) => {
      const tw = textW(text, 12) + 4;
      const first = bl[0], lastR = bl[bl.length - 1];
      const spots = [[first[0] + 8, first[1] - 5, 'start'], [first[2] - 8, first[1] - 5, 'end'], [lastR[0] + 8, lastR[3] + 15, 'start'], [lastR[2] - 8, lastR[3] + 15, 'end'],
        [first[2] + 8, first[1] + 16, 'start'], [lastR[2] + 8, lastR[3] - 6, 'start'], [first[0] - 8, first[1] + 16, 'end'], [lastR[0] - 8, lastR[3] - 6, 'end']];
      let best = null;
      spots.forEach(([tx, ty, anchor], k) => {
        const r = anchor === 'start' ? [tx - 2, ty - 12, tx + tw, ty + 4] : [tx - tw, ty - 12, tx + 2, ty + 4];
        let cost = k * 0.1;
        if (r[1] < 1 || r[3] > height - 1 || r[0] < minX + 2 || r[2] > width - 2) cost += 100;
        for (const q of [...named, ...taken]) if (rectHit(r, q)) cost += 10;
        for (const q of labRects) if (rectHit(r, q)) cost += 10;
        for (const q of boxRects) if (rectHit(r, q)) cost += 10;
        for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) {
          const p = e.pts[i], q = e.pts[i + 1];
          const seg = [Math.min(p[0], q[0]) - 1, Math.min(p[1], q[1]) - 1, Math.max(p[0], q[0]) + 1, Math.max(p[1], q[1]) + 1];
          if (rectHit(r, seg)) cost += 3;
        }
        if (!best || cost < best.cost) best = { cost, text, tx, ty, anchor, r };
      });
      return best;
    };
    const short = rg.label3 || rg.label;
    let pick = null;
    for (let full = 0; full < blobs.length; full++) {
      const taken = [], got = [];
      let cost = full * 0.5;
      blobs.forEach((bl, n) => { const b = spotFor(bl, n === full ? rg.label : short, taken); taken.push(b.r); got.push(b); cost += b.cost; });
      if (!pick || cost < pick.cost) pick = { cost, got };
    }
    for (const b of pick.got) named.push(b.r);
    const names = pick.got.map((b) => ({ text: b.text, tx: b.tx, ty: b.ty, anchor: b.anchor }));
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1, y1, parts, blobs: blobs.map((bl) => outline(bl)), names, tx: names[0].tx, ty: names[0].ty, anchor: names[0].anchor };
  });
}

// The outline of a union of axis-parallel rectangles, as one closed path (or several).
export function outline(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  // directed boundary edges, interior on the right (clockwise)
  const edges = new Map();
  const add = (a, b) => edges.set(a.join(','), b);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    if (!inside(i, j)) continue;
    if (!inside(i, j - 1)) add([xs[i], ys[j]], [xs[i + 1], ys[j]]);
    if (!inside(i + 1, j)) add([xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]);
    if (!inside(i, j + 1)) add([xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]);
    if (!inside(i - 1, j)) add([xs[i], ys[j + 1]], [xs[i], ys[j]]);
  }
  const loops = [];
  while (edges.size) {
    const [k0, v0] = edges.entries().next().value;
    const loop = [k0.split(',').map(Number)];
    let cur = v0;
    edges.delete(k0);
    while (cur && cur.join(',') !== k0) {
      loop.push(cur);
      const nx = edges.get(cur.join(','));
      edges.delete(cur.join(','));
      cur = nx;
    }
    // keep only the corners
    const pts = loop.filter((p, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length], c = loop[(i + 1) % loop.length];
      return !((a[0] === p[0] && p[0] === c[0]) || (a[1] === p[1] && p[1] === c[1]));
    });
    loops.push(pts);
  }
  return loops;
}
