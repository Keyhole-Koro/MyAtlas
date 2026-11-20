/* graph.js — the graph beside the page. d3-force lays it out with "layer gravity" (the app on top, the emulator at
   the bottom, cross-cutting shapes in their own column), then labels are placed where they hit nothing. */
(function () {
  'use strict';
  const { NODES, LAYER, STACK } = window.M;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const measure = document.createElement('canvas').getContext('2d');
  const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
  const tw = (s, font) => { measure.font = font; return measure.measureText(s).width; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // one glyph per kind, the same as in the outline: circle = function, square = place, diamond = shape, ring = context
  function glyph(kind, r) {
    const s = r * 0.9;
    switch (kind) {
      case 'store': case 'hw': return `M${-s},${-s + 2.5}q0,-2.5 2.5,-2.5h${2 * s - 5}q2.5,0 2.5,2.5v${2 * s - 5}q0,2.5 -2.5,2.5h${-(2 * s - 5)}q-2.5,0 -2.5,-2.5z`;
      case 'schema': case 'enum': { const d = r * 1.25; return `M0,${-d}L${d},0L0,${d}L${-d},0Z`; }
      case 'figure': case 'note': return `M${-s},${-s}h${2 * s}v${2 * s}h${-2 * s}z`;
      default: return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
    }
  }
  const hollow = (kind) => kind === 'context' || kind === 'enum' || kind === 'note';

  class Graph {
    constructor(host, opts) {
      this.host = host;
      this.opts = opts;
      this.pos = new Map();
      this.spec = null;
      this.svg = d3.select(host).append('svg').attr('class', 'graph-svg').attr('role', 'img');
      const defs = this.svg.append('defs');
      for (const [id, cls] of [['arr', 'arrow'], ['arr-hi', 'arrow hi'], ['arr-done', 'arrow done']]) {
        defs.append('marker').attr('id', `g-${id}`).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5)
          .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse')
          .append('path').attr('d', 'M0,1L9,5L0,9z').attr('class', cls);
      }
      this.zoomLayer = this.svg.append('g').attr('class', 'zoom-layer');
      this.gBands = this.zoomLayer.append('g').attr('class', 'bands');
      this.gRegions = this.zoomLayer.append('g').attr('class', 'regions');
      this.gEdges = this.zoomLayer.append('g').attr('class', 'edges');
      this.gBadges = this.zoomLayer.append('g').attr('class', 'badges');
      this.gNodes = this.zoomLayer.append('g').attr('class', 'nodes');
      this.gLabels = this.zoomLayer.append('g').attr('class', 'labels');
      this.zoom = d3.zoom().scaleExtent([0.5, 4]).on('zoom', (ev) => {
        this.zoomLayer.attr('transform', ev.transform);
        this.opts.onZoom && this.opts.onZoom(ev.transform.k !== 1 || ev.transform.x !== 0 || ev.transform.y !== 0);
      });
      this.svg.call(this.zoom).on('dblclick.zoom', null);
      this.svg.on('mouseleave', () => this.hover(null));
    }
    resetZoom(animate = true) {
      (animate && !reduceMotion ? this.svg.transition().duration(350) : this.svg).call(this.zoom.transform, d3.zoomIdentity);
    }

    // spec: { mode, nodes:[{key,id,label,layer,kind,hop,order}], edges:[{key,s,t,kind,dir,no,alt,state}], ego }
    render(spec) {
      const W = Math.max(200, this.host.clientWidth), H = Math.max(200, this.host.clientHeight);
      this.W = W; this.H = H;
      this.svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H).attr('aria-label', spec.aria || '');
      const prev = this.pos;
      const L = this.layout(spec, W, H, prev);
      this.spec = spec;
      this.L = L;
      this.drawBands(L);
      this.drawRegions(spec, L);
      this.drawEdges(spec, L);
      this.drawNodes(spec, L);
      this.drawLabels(spec, L);
      if (spec.mode === 'flow') this.placeBadges(L);
      this.placeRegionLabels(L);
      // animate from where things were
      const from = new Map(), to = new Map();
      for (const n of L.nodes) {
        to.set(n.key, { x: n.x, y: n.y });
        const p = prev.get(n.key) || (n.seed && prev.get(n.seed)) || null;
        from.set(n.key, p ? { x: p.x, y: p.y } : { x: n.x, y: n.y });
      }
      this.pos = to;
      if (this.anim) this.anim.stop();
      const apply = (k) => {
        const P = new Map();
        for (const [key, b] of to) { const a = from.get(key); P.set(key, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }); }
        this.place(P, k);
      };
      if (reduceMotion || !prev.size) { apply(1); return; }
      apply(0);
      const t0 = performance.now(), dur = 520;
      this.anim = d3.timer(() => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        apply(ease(k));
        if (k >= 1) this.anim.stop();
      });
    }

    layout(spec, W, H, prev) {
      const rowOf = (n) => n.row || n.layer;
      const rows = spec.bands || STACK.map((l) => ({ id: l.id, name: l.name, tone: l.id }));
      this.rowInfo = Object.fromEntries(rows.map((r) => [r.id, r]));
      const crossNodes = spec.bands ? [] : spec.nodes.filter((n) => LAYER[n.layer] && LAYER[n.layer].cross);
      const layers = rows.map((r) => r.id).filter((id) => spec.nodes.some((n) => rowOf(n) === id));
      const crossW = crossNodes.length ? clamp(W * 0.27, 96, 150) : 0;
      const top = 30, bottom = H - 10, x0 = 6, x1 = W - crossW - (crossW ? 8 : 6);
      // a band is as tall as what it holds needs, never less than a row
      const cnt = Object.fromEntries(layers.map((id) => [id, spec.nodes.filter((n) => rowOf(n) === id).length]));
      const wt = Object.fromEntries(layers.map((id) => [id, Math.max(1, Math.pow(cnt[id], 0.72))]));
      const minH = Math.min(spec.mode === 'all' ? 42 : 78, (bottom - top) / Math.max(1, layers.length));
      const totalW = layers.reduce((a, id) => a + wt[id], 0) || 1;
      const free = (bottom - top) - minH * layers.length;
      const band = {};
      let yy = top;
      for (const id of layers) {
        const h = minH + Math.max(0, free) * (wt[id] / totalW);
        band[id] = { id, y0: yy, y1: yy + h, cy: yy + h / 2 + 7, labelW: tw(this.rowInfo[id].name, `700 12px ${FONT}`) + 16 };
        yy += h;
      }
      const cross = crossW ? { x0: W - crossW, x1: W - 4, cx: W - crossW / 2 + 2, y0: top, y1: bottom } : null;
      const flow = spec.mode === 'flow';
      const maxOrder = Math.max(1, ...spec.nodes.map((n) => n.order || 0));
      const nodes = spec.nodes.map((n) => {
        const r = n.hop === 0 ? 9 : n.hop === 1 ? 6.5 : spec.mode === 'all' ? 5 : 4.5;
        const isCross = !spec.bands && !!(LAYER[n.layer] && LAYER[n.layer].cross);
        const b = band[rowOf(n)];
        let tx = isCross ? cross.cx : (x0 + x1) / 2, ty = isCross ? (top + bottom) / 2 : b.cy;
        if (flow && !isCross) tx = x0 + 34 + ((n.order || 0) / maxOrder) * (x1 - x0 - 68);
        const p = prev.get(n.key) || (n.seed && prev.get(n.seed));
        const j = hash(n.key);
        const x = p ? p.x : tx + (j - 0.5) * 120, y = p ? p.y : ty + (hash(n.key + 'y') - 0.5) * (isCross ? 200 : (b.y1 - b.y0) * 0.5);
        return { ...n, r, isCross, tx, ty, x, y, band: b };
      });
      if (flow) {
        // inside a band, keep the order of first appearance. Neighbours get room for both names side by side, and
        // for a numbered badge on the step between them (about 90 px) when the band has that much; the two ends
        // stay half a name from the edge.
        const labW = (n) => tw(n.label, `${n.hop === 0 ? 650 : 500} ${n.hop === 0 ? 13 : 12}px ${FONT}`);
        for (const id of layers) {
          const row = nodes.filter((n) => rowOf(n) === id && !n.isCross).sort((a, b) => a.tx - b.tx);
          if (!row.length) continue;
          const w = row.map(labW);
          // an end node's name may run inward from it, so the ends need not keep half a long name of margin
          row.forEach((n, k) => { n.mx = Math.max(18, Math.min(w[k] / 2 + 4, 46)); n.labPref = null; });
          const lo = x0 + row[0].mx, hi = x1 - row[row.length - 1].mx, room = Math.max(1, hi - lo);
          const need = row.slice(1).map((_, k) => Math.max(54, (w[k] + w[k + 1]) / 2 + 12));
          const want = need.map((g) => Math.max(g, 92));
          const sumNeed = need.reduce((a, b) => a + b, 0), sumWant = want.reduce((a, b) => a + b, 0);
          let gaps = sumWant <= room ? want
            : sumNeed <= room ? need.map((g, k) => g + (want[k] - g) * ((room - sumNeed) / Math.max(1, sumWant - sumNeed)))
              : need.map((g) => (g * room) / sumNeed);
          if (sumNeed > room && row.length >= 3) {
            // too many names for one line: the band zigzags, names of the upper ones above and of the lower ones
            // below, so only every other node has to make room for two names
            const b = row[0].band, dz = clamp((b.y1 - b.y0) * 0.17, 11, 22);
            row.forEach((n, k) => { n.ty = b.cy + (k % 2 ? dz : -dz); n.labPref = k % 2 ? 'down' : 'up'; });
            const need2 = row.slice(2).map((_, k) => (w[k] + w[k + 2]) / 2 + 12);
            const g = clamp(Math.max(50, ...need2.map((x) => x / 2)), 0, room / (row.length - 1));
            gaps = row.slice(1).map(() => g);
          }
          let prevX = -Infinity;
          row.forEach((n, k) => { n.tx = Math.max(n.tx, k ? prevX + gaps[k - 1] : lo); prevX = n.tx; });
          for (let k = row.length - 1; k >= 0; k--) row[k].tx = Math.min(row[k].tx, k === row.length - 1 ? hi : row[k + 1].tx - gaps[k]);
          const under = lo - row[0].tx;
          if (under > 0) row.forEach((n) => { n.tx += under; });
          row.forEach((n) => { if (!prev.get(n.key)) n.x = n.tx; });
        }
      }
      const byKey = new Map(nodes.map((n) => [n.key, n]));
      const links = spec.edges.filter((e) => byKey.has(e.s) && byKey.has(e.t)).map((e) => ({ ...e, source: e.s, target: e.t }));
      const ego = spec.ego && byKey.get(spec.ego);
      if (ego && spec.mode === 'local') {
        ego.fx = ego.isCross ? cross.cx : (x0 + x1) / 2 - (crossW ? 0 : 0);
        ego.fy = ego.isCross ? (top + bottom) / 2 : ego.band.cy;
      }
      const n = nodes.length;
      const all = spec.mode === 'all';
      const grow = Math.max(1, Math.sqrt((W * H) / (386 * 546)));
      const charge = (all ? -70 : n > 24 ? -190 : -300) * grow;
      const sim = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d) => d.key)
          .distance((l) => (flow ? 74 : all ? 60 * Math.sqrt(grow) : l.kind === 'context' || l.kind === 'type' ? 120 : 96))
          .strength((l) => (flow ? 0.12 : l.kind === 'context' || l.kind === 'type' ? 0.05 : 0.22)))
        .force('charge', d3.forceManyBody().strength(charge).distanceMax(320 * grow))
        .force('x', d3.forceX((d) => d.tx).strength((d) => (d.isCross ? 0.9 : flow ? 0.9 : all ? 0.03 : 0.012)))
        .force('y', d3.forceY((d) => d.ty).strength((d) => (d.isCross ? 0.02 : flow ? 0.85 : all ? 0.12 : 0.06)))
        .force('collide', d3.forceCollide((d) => d.r + (all ? 7 : flow ? 18 : 13)).strength(0.9))
        .stop();
      const keepIn = () => {
        for (const d of nodes) {
          const m = d.r + 4;
          if (d.isCross) { d.x = clamp(d.x, cross.x0 + m, cross.x1 - m); d.y = clamp(d.y, cross.y0 + m + 16, cross.y1 - m); continue; }
          const mx = flow ? (d.mx || 40) : m;
          d.x = clamp(d.x, x0 + mx, x1 - mx);
          d.y = clamp(d.y, d.band.y0 + m + 4, d.band.y1 - m);
          // keep clear of the band's name in its top left corner
          if (d.x < d.band.labelW + m && d.y < d.band.y0 + 24 + m) d.y = d.band.y0 + 24 + m;
        }
      };
      sim.alpha(prev.size ? 0.9 : 1);
      for (let i = 0; i < 320; i++) { sim.tick(); keepIn(); }
      const wide = W >= 640;
      if (all && wide) {
        // a wide view of everything: spread each band over the whole width, in the order the forces found, so the
        // picture fills the space instead of gathering in the middle
        for (const id of layers) {
          const row = nodes.filter((d) => !d.isCross && rowOf(d) === id).sort((a, b) => a.x - b.x);
          const m = 40, k = row.length;
          row.forEach((d, j) => { d.tx = x0 + m + ((j + 0.5) / k) * (x1 - x0 - 2 * m); });
        }
        sim.force('x', d3.forceX((d) => d.tx).strength((d) => (d.isCross ? 0.9 : 0.3)));
        sim.alpha(0.6);
        for (let i = 0; i < 180; i++) { sim.tick(); keepIn(); }
      }
      return { nodes, links, byKey, band, layers, cross, top, bottom, x0, x1, W, H, wide };
    }

    drawBands(L) {
      const info = this.rowInfo;
      const data = L.layers.map((id, i) => ({ id, ...L.band[id], i }));
      const sel = this.gBands.selectAll('g.band').data(data, (d) => d.id);
      const ent = sel.enter().append('g').attr('class', 'band');
      ent.append('rect');
      ent.append('text').attr('class', 'band-label');
      sel.exit().remove();
      this.gBands.selectAll('g.band').each(function (d) {
        const g = d3.select(this).attr('data-layer', info[d.id].tone || d.id);
        g.select('rect').attr('x', 0).attr('y', d.y0).attr('width', L.x1 + 4).attr('height', d.y1 - d.y0);
        g.select('text').attr('x', 10).attr('y', d.y0 + 17).text(info[d.id].name);
      });
      const cs = this.gBands.selectAll('g.cross').data(L.cross ? [L.cross] : []);
      const ce = cs.enter().append('g').attr('class', 'cross');
      ce.append('rect');
      ce.append('text').attr('class', 'band-label');
      cs.exit().remove();
      this.gBands.selectAll('g.cross').each(function (d) {
        const g = d3.select(this);
        g.select('rect').attr('x', d.x0).attr('y', 0).attr('width', d.x1 - d.x0 + 4).attr('height', L.H).attr('rx', 0);
        g.select('text').attr('x', d.x0 + 10).attr('y', 17).text('層をまたぐ');
      });
      this.gBands.selectAll('.top-rule').remove();
    }

    // execution contexts in a flow: a dashed frame around their boxes (and the boxes' names), drawn under everything
    drawRegions(spec, L) {
      const regs = (spec.mode === 'flow' && spec.regions) || [];
      const sel = this.gRegions.selectAll('g.region').data(regs, (d) => d.key);
      sel.exit().remove();
      const ent = sel.enter().append('g').attr('class', 'region');
      ent.append('path').attr('class', 'r-shape');
      ent.append('text').attr('class', 'r-label');
      ent.append('title');
      this.gRegions.selectAll('g.region').data(regs, (d) => d.key)
        .attr('class', (d) => `region${d.on ? ' on' : ''}`)
        .attr('data-node', (d) => d.node)
        .each(function (d) { const g = d3.select(this); g.select('title').text(d.full || d.label); g.select('text').text(d.label); });
    }
    hull(reg, at) {
      const pts = [];
      for (const key of reg.boxes) {
        const n = this.L.byKey.get(key), p = at(key);
        if (!n || !p) continue;
        const R = n.r + 10;
        for (let a = 0; a < 12; a++) pts.push([p.x + R * Math.cos((a * Math.PI) / 6), p.y + R * Math.sin((a * Math.PI) / 6)]);
        if (n.lab) {
          const x = p.x + n.lab.dx, y = p.y + n.lab.dy;
          pts.push([x - 5, y - 3], [x + n.lab.w + 5, y - 3], [x - 5, y + n.lab.h + 3], [x + n.lab.w + 5, y + n.lab.h + 3]);
        }
      }
      return pts.length >= 3 ? d3.polygonHull(pts) : null;
    }
    // each frame says its name once, where it hits no name, node or badge
    placeRegionLabels(L) {
      const regs = (this.spec.mode === 'flow' && this.spec.regions) || [];
      if (!regs.length) return;
      const at = (key) => L.byKey.get(key);
      const taken = [...(this.placed || [])];
      const badges = L.links.filter((l) => l.no).map((l) => { const g = this.geom(l, at); return g ? this.badgeAt(g, l.bt == null ? 0.5 : l.bt, l.bo || 0) : null; }).filter(Boolean);
      const font = `650 11px ${FONT}`, h = 14;
      for (const reg of regs) {
        reg.lab = null;
        const poly = this.hull(reg, at);
        if (!poly) continue;
        const w = tw(reg.label, font);
        const top = poly.reduce((a, p) => (p[1] < a[1] ? p : a)), bot = poly.reduce((a, p) => (p[1] > a[1] ? p : a));
        const lef = poly.reduce((a, p) => (p[0] < a[0] ? p : a)), rig = poly.reduce((a, p) => (p[0] > a[0] ? p : a));
        const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
        const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
        const spots = {
          t: [{ x: top[0] - w / 2, y: top[1] - h - 2 }, { x: bx0 + 4, y: by0 - h - 1 }, { x: bx1 - w - 4, y: by0 - h - 1 }],
          b: [{ x: bot[0] - w / 2, y: bot[1] + 2 }, { x: bx0 + 4, y: by1 + 1 }, { x: bx1 - w - 4, y: by1 + 1 }],
          l: [{ x: lef[0] - w - 3, y: lef[1] - h / 2 }],
          r: [{ x: rig[0] + 3, y: rig[1] - h / 2 }],
        };
        const pref = { tl: 'tblr', tr: 'tbrl', bl: 'btlr', br: 'btrl', r: 'rltb' }[reg.at] || 'tblr';
        const cands = [...pref].flatMap((k) => spots[k]);
        const free = (r) => r.x >= 2 && r.x + r.w <= L.W - 2 && r.y >= 2 && r.y + r.h <= L.H - 2
          && !taken.some((p) => p.x < r.x + r.w + 2 && p.x + p.w + 2 > r.x && p.y < r.y + r.h + 1 && p.y + p.h + 1 > r.y)
          && !L.nodes.some((o) => o.x + o.r > r.x && o.x - o.r < r.x + r.w && o.y + o.r > r.y && o.y - o.r < r.y + r.h)
          && !badges.some((b) => b.x + 10 > r.x && b.x - 10 < r.x + r.w && b.y + 10 > r.y && b.y - 10 < r.y + r.h);
        for (const c of cands) {
          const r = { x: c.x, y: c.y, w, h };
          if (free(r)) { reg.lab = r; taken.push(r); break; }
        }
      }
    }

    drawEdges(spec, L) {
      const flow = spec.mode === 'flow';
      const sel = this.gEdges.selectAll('path.edge').data(L.links, (d) => d.key);
      sel.exit().transition().duration(200).style('opacity', 0).remove();
      sel.enter().append('path').attr('class', 'edge').style('opacity', 0).transition().duration(400).style('opacity', null);
      this.gEdges.selectAll('path.edge').data(L.links, (d) => d.key)
        .attr('class', (d) => `edge k-${d.kind}${d.state ? ' ' + d.state : ''}${d.alt ? ' alt' : ''}${!flow && (d.s === spec.ego || d.t === spec.ego) ? ' ego' : ''}`)
        .attr('marker-end', (d) => (d.dir ? `url(#g-${d.state === 'hi' ? 'arr-hi' : d.state === 'done' ? 'arr-done' : 'arr'})` : null));
      // steps between the same two boxes fan out, one on each side. The bend is measured along the edge's own normal,
      // which flips with its direction, so an edge running the other way takes the opposite sign to land opposite.
      const pairs = new Map();
      for (const l of L.links) { const k = l.s < l.t ? `${l.s}|${l.t}` : `${l.t}|${l.s}`; if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(l); }
      for (const group of pairs.values()) {
        group.forEach((l, j) => {
          if (!flow) { l.bend = 0; return; }
          if (group.length === 1) { l.bend = 10; return; }
          const side = (j - (group.length - 1) / 2) * 44;
          l.bend = l.s < l.t ? side : -side;
        });
      }
      // the step being walked is drawn last, over the others
      this.gEdges.selectAll('path.edge').filter((d) => d.state === 'hi').raise();
      const bsel = this.gBadges.selectAll('g.badge').data(L.links.filter((l) => l.no), (d) => d.key);
      bsel.exit().remove();
      const be = bsel.enter().append('g').attr('class', 'badge');
      be.append('circle').attr('r', 10);
      be.append('text').attr('dy', '0.35em').attr('text-anchor', 'middle');
      this.gBadges.selectAll('g.badge').data(L.links.filter((l) => l.no), (d) => d.key)
        .attr('class', (d) => `badge${d.state ? ' ' + d.state : ''}${d.alt ? ' alt' : ''}`)
        .attr('data-step', (d) => d.stepRef || null)
        .on('click', (ev, d) => { ev.stopPropagation(); this.opts.onStep && d.stepRef && this.opts.onStep(d.stepRef); })
        .each(function (d) { d3.select(this).select('text').text(d.no); d3.select(this).select('title').remove(); d3.select(this).append('title').text(d.title || ''); });
    }

    drawNodes(spec, L) {
      const self = this;
      const sel = this.gNodes.selectAll('g.node').data(L.nodes, (d) => d.key);
      sel.exit().transition().duration(200).style('opacity', 0).remove();
      const ent = sel.enter().append('g').attr('class', 'node').style('opacity', 0);
      ent.append('circle').attr('class', 'halo');
      ent.append('path').attr('class', 'shape');
      ent.append('circle').attr('class', 'hit');
      ent.transition().duration(380).style('opacity', null);
      this.gNodes.selectAll('g.node').data(L.nodes, (d) => d.key)
        .attr('class', (d) => `node hop${d.hop}${d.dim ? ' dim' : ''}${d.mark ? ' mark' : ''}`)
        .attr('data-layer', (d) => d.layer)
        .attr('data-node', (d) => d.id)
        .attr('tabindex', -1)
        .each(function (d) {
          const g = d3.select(this);
          g.select('.halo').attr('r', d.r + 5.5);
          g.select('.shape').attr('d', glyph(d.kind, d.r)).classed('hollow', hollow(d.kind));
          g.select('.hit').attr('r', Math.max(14, d.r + 6));
        })
        .on('mouseenter', function (ev, d) { self.hover(d.key); self.opts.onHover && self.opts.onHover(d.id, this, ev); })
        .on('mouseleave', function (ev, d) { self.hover(null); self.opts.onHoverEnd && self.opts.onHoverEnd(d.id); })
        .on('click', (ev, d) => { ev.stopPropagation(); this.opts.onOpen && this.opts.onOpen(d.id, d); });
    }

    // labels go where they hit no other label and no node; the important ones first
    drawLabels(spec, L) {
      const placed = [];
      const pad = 2;
      // the bands' names are already there
      for (const id of L.layers) { const b = L.band[id]; placed.push({ x: 6, y: b.y0 + 4, w: b.labelW - 8, h: 17, band: true }); }
      if (L.cross) placed.push({ x: L.cross.x0 + 6, y: 4, w: tw('層をまたぐ', `700 12px ${FONT}`) + 8, h: 17, band: true });
      const prio = [...L.nodes].sort((a, b) => (a.dim ? 1 : 0) - (b.dim ? 1 : 0) || a.hop - b.hop || (b.labelPrio || 0) - (a.labelPrio || 0) || (window.M.DEG[b.id] || 0) - (window.M.DEG[a.id] || 0));
      const hitsNode = (r, self) => L.nodes.some((o) => o !== self && o.x + o.r + 1 > r.x && o.x - o.r - 1 < r.x + r.w && o.y + o.r + 1 > r.y && o.y - o.r - 1 < r.y + r.h);
      const hitsLabel = (r) => placed.some((p) => p.x < r.x + r.w + pad && p.x + p.w + pad > r.x && p.y < r.y + r.h + pad && p.y + p.h + pad > r.y);
      const inside = (r, n) => {
        if (n.isCross) return r.x >= L.x1 * 0.55 && r.x + r.w <= L.W - 2 && r.y >= 22 && r.y + r.h <= L.H - 2;
        return r.x >= 2 && r.x + r.w <= L.x1 + 2 && r.y >= n.band.y0 + 2 && r.y + r.h <= n.band.y1 - 1;
      };
      // a name must sit nearer its own node than any other, or it reads as the neighbour's
      const gap = (r, p) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
      const ownNearest = (r, n) => { const d = gap(r, n) - n.r; return !L.nodes.some((o) => o !== n && gap(r, o) - o.r < d - 1); };
      const ok = (r, n) => inside(r, n) && !hitsLabel(r) && !hitsNode(r, n) && ownNearest(r, n);
      // shorter forms of a long code name before it is cut: the last part when no other node here has it
      // (request_channel.submit → submit), else the end of the namespace with it (os_call_router.handle → router.handle)
      const lastPart = (s) => { const m = String(s).match(/^[A-Za-z_]\w*\.(.+)$/); return m ? m[1] : null; };
      const lastCount = {};
      for (const n of L.nodes) { const lp = lastPart(n.label); if (lp) lastCount[lp] = (lastCount[lp] || 0) + 1; }
      const shortForm = (s) => {
        const m = String(s).match(/^([A-Za-z_]\w*)\.(.+)$/);
        if (!m) return null;
        if (lastCount[m[2]] === 1) return m[2];
        const parts = m[1].split('_');
        return parts.length > 1 ? `${parts[parts.length - 1]}.${m[2]}` : null;
      };
      const labelDim = spec.mode === 'all' && L.wide;
      for (const n of prio) {
        if (n.dim && !labelDim) { n.lab = null; continue; }
        const size = n.hop === 0 ? 13 : n.hop === 1 ? 12 : 11.5;
        const weight = n.hop === 0 ? 650 : n.hop === 1 ? 500 : 400;
        const font = `${weight} ${size}px ${FONT}`;
        const max = n.hop === 0 ? 34 : n.hop === 1 ? 24 : 22;
        let text = n.label;
        if ([...text].length > max) {
          const sf = n.hop > 0 && shortForm(text);
          text = sf && [...sf].length <= max ? sf : [...text].slice(0, max - 1).join('') + '…';
        }
        const h = size + 3;
        const r = n.r + (n.hop === 0 ? 8 : spec.mode === 'flow' ? 7 : 3);
        const candsFor = (w) => {
          const side = [{ x: n.x + r, y: n.y - h / 2 }, { x: n.x - r - w, y: n.y - h / 2 }];
          // under or over the node: centred, else running right from it, else ending at it
          const below = [{ x: n.x - w / 2, y: n.y + r }, { x: n.x - 8, y: n.y + r }, { x: n.x + 8 - w, y: n.y + r }];
          const above = [{ x: n.x - w / 2, y: n.y - r - h }, { x: n.x - 8, y: n.y - r - h }, { x: n.x + 8 - w, y: n.y - r - h }];
          const ud = n.labPref === 'up' ? [...above, ...below] : [...below, ...above];
          return [
            ...(spec.mode === 'flow' ? [...ud, ...side] : [...side, ...ud]),
            { x: n.x + r - 2, y: n.y + r - 3 }, { x: n.x + r - 2, y: n.y - r - h + 3 },
            { x: n.x - r - w + 2, y: n.y + r - 3 }, { x: n.x - r - w + 2, y: n.y - r - h + 3 },
          ];
        };
        let pick = null;
        const tryText = (t, cands) => {
          const w = tw(t, font);
          for (const c of cands(w)) { const rect = { x: c.x, y: c.y, w, h }; if (ok(rect, n)) { pick = rect; text = t; return true; } }
          return false;
        };
        tryText(text, candsFor);
        // the node in the middle always says its whole name: over a neighbour if it must, never over another name
        if (!pick && n.hop === 0) {
          const w = tw(text, font);
          for (const c of candsFor(w)) { const rect = { x: c.x, y: c.y, w, h }; if (rect.x >= 2 && rect.x + rect.w <= L.W - 2 && !hitsLabel(rect)) { pick = rect; break; } }
        }
        const sf = n.hop > 0 ? shortForm(n.label) : null;
        if (!pick && sf) tryText(sf, candsFor);
        if (!pick && (n.hop <= 1 || spec.mode !== 'all')) {
          // cut (the short form when there is one) until it fits beside the node; a stub of a few letters says
          // nothing, so below six it gets no name (pointing at it still shows the whole one)
          const four = (w) => [{ x: n.x + r, y: n.y - h / 2 }, { x: n.x - r - w, y: n.y - h / 2 }, { x: n.x - w / 2, y: n.y + r }, { x: n.x - w / 2, y: n.y - r - h }];
          let t = sf || text;
          while (!pick && [...t].length > 7) {
            t = [...t].slice(0, -2).join('') + '…';
            tryText(t, four);
          }
        }
        if (pick) { placed.push({ x: pick.x, y: pick.y, w: pick.w, h: pick.h }); n.lab = { text, size, weight, dx: pick.x - n.x, dy: pick.y - n.y, w: pick.w, h: pick.h }; }
        else n.lab = null;
      }
      this.placed = placed;
      const data = L.nodes.filter((n) => n.lab);
      const sel = this.gLabels.selectAll('text.label').data(data, (d) => d.key);
      sel.exit().remove();
      sel.enter().append('text').attr('class', 'label');
      this.gLabels.selectAll('text.label').data(data, (d) => d.key)
        .attr('class', (d) => `label hop${d.hop}${d.dim ? ' dim' : ''}`)
        .style('font-size', (d) => `${d.lab.size}px`).style('font-weight', (d) => d.lab.weight)
        .text((d) => d.lab.text);
    }

    // where along its edge each numbered badge sits, worked out once at the final positions
    // A badge never covers a name, a node or another badge when any free spot exists along its edge (or just beside
    // it). On a short edge it sits beside the line, so the step it numbers stays visible.
    placeBadges(L) {
      const taken = [];
      const names = (this.placed || []).filter((r) => !r.band), bandNames = (this.placed || []).filter((r) => r.band);
      const order = L.links.filter((l) => l.no).sort((a, b) => (b.state === 'hi') - (a.state === 'hi') || (a.alt === b.alt ? 0 : a.alt ? 1 : -1));
      const over = (p, r, m) => p.x + m > r.x && p.x - m < r.x + r.w && p.y + m > r.y && p.y - m < r.y + r.h;
      for (const l of order) {
        const g = this.geom(l, (key) => L.byKey.get(key));
        if (!g) continue;
        const len = Math.hypot(g.bx - g.ax, g.by - g.ay);
        const offs = len < 56 ? [15, -15, 22, -22] : [0, 13, -13, 21, -21];
        let best = { t: 0.5, off: offs[0] }, bestScore = -Infinity;
        for (const off of offs) {
          for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8]) {
            const p = this.badgeAt(g, t, off);
            let score = -Math.abs(t - 0.5) * 8 - Math.abs(off) * 0.5, blocked = false;
            for (const q of taken) { const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < 22) { blocked = true; score -= (22 - dd) * 4; } }
            for (const n of L.nodes) { const dd = Math.hypot(n.x - p.x, n.y - p.y); if (dd < n.r + 12) { blocked = true; score -= (n.r + 12 - dd) * 4; } }
            for (const r of names) if (over(p, r, 10)) { blocked = true; score -= 40; }
            for (const r of bandNames) if (over(p, r, 10)) score -= 12;
            if (p.x < 11 || p.x > L.W - 11 || p.y < 11 || p.y > L.H - 11) { blocked = true; score -= 60; }
            if (!blocked) score += 1000;
            if (off === 0) score += 20; // on its line beats beside it, even over a band's name
            if (score > bestScore) { bestScore = score; best = { t, off }; }
          }
          if (bestScore > 990 && off === 0) break; // free on the line itself: no need to look beside it
        }
        l.bt = best.t; l.bo = best.off;
        taken.push(this.badgeAt(g, best.t, best.off));
      }
    }
    // a point along an edge, pushed off the line by `off` along its normal
    badgeAt(g, t, off) {
      const p = this.at(g, t);
      if (!off) return p;
      const u = 1 - t;
      const dx = 2 * u * (g.cx - g.ax) + 2 * t * (g.bx - g.cx), dy = 2 * u * (g.cy - g.ay) + 2 * t * (g.by - g.cy);
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dy / len) * off, y: p.y + (dx / len) * off };
    }
    geom(d, at) {
      const a = at(d.s), b = at(d.t);
      if (!a || !b) return null;
      const sa = this.L.byKey.get(d.s), sb = this.L.byKey.get(d.t);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const ra = sa.r + 3, rb = sb.r + (d.dir ? 5 : 3);
      const ax = a.x + ux * ra, ay = a.y + uy * ra, bx = b.x - ux * rb, by = b.y - uy * rb;
      const cx = (ax + bx) / 2 - uy * (d.bend || 0), cy = (ay + by) / 2 + ux * (d.bend || 0);
      return { ax, ay, bx, by, cx, cy, curved: !!d.bend };
    }
    at(g, t) {
      const u = 1 - t;
      return { x: u * u * g.ax + 2 * u * t * g.cx + t * t * g.bx, y: u * u * g.ay + 2 * u * t * g.cy + t * t * g.by };
    }
    place(P, k) {
      const L = this.L;
      const at = (key) => P.get(key);
      this.gNodes.selectAll('g.node').attr('transform', (d) => { const p = at(d.key); return p ? `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` : null; });
      this.gLabels.selectAll('text.label').attr('x', (d) => (at(d.key).x + d.lab.dx).toFixed(1)).attr('y', (d) => (at(d.key).y + d.lab.dy + d.lab.h - 4).toFixed(1));
      const flow = this.spec.mode === 'flow';
      const self = this;
      this.gEdges.selectAll('path.edge').each(function (d) {
        const g = self.geom(d, at);
        if (!g) return;
        this.setAttribute('d', g.curved ? `M${g.ax.toFixed(1)},${g.ay.toFixed(1)}Q${g.cx.toFixed(1)},${g.cy.toFixed(1)} ${g.bx.toFixed(1)},${g.by.toFixed(1)}` : `M${g.ax.toFixed(1)},${g.ay.toFixed(1)}L${g.bx.toFixed(1)},${g.by.toFixed(1)}`);
        const p = self.badgeAt(g, d.bt == null ? 0.5 : d.bt, d.bo || 0);
        d.mx = p.x; d.my = p.y;
      });
      if (flow) this.gBadges.selectAll('g.badge').attr('transform', (d) => `translate(${(d.mx || 0).toFixed(1)},${(d.my || 0).toFixed(1)})`);
      // the frames follow their boxes; their names appear once everything has arrived
      const smooth = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6));
      this.gRegions.selectAll('g.region').each(function (d) {
        const poly = self.hull(d, at);
        d3.select(this).select('path').attr('d', poly ? smooth(poly) : null);
        const t = d3.select(this).select('text');
        if (k >= 1 && d.lab) t.attr('x', d.lab.x.toFixed(1)).attr('y', (d.lab.y + d.lab.h - 3).toFixed(1)).style('opacity', null);
        else t.style('opacity', 0);
      });
    }

    // a step pointed at in the page: its edge when the graph shows that paper, else its two ends
    spotlightStep(ref, ends) {
      if (!this.L) return;
      const link = this.L.links.find((l) => l.stepRef === ref);
      if (link) {
        this.svg.classed('hovering', true);
        this.gNodes.selectAll('g.node').classed('lit', (d) => d.key === link.s || d.key === link.t);
        this.gEdges.selectAll('path.edge').classed('lit', (d) => d === link || d.key === link.key);
        this.gLabels.selectAll('text.label').classed('lit', (d) => d.key === link.s || d.key === link.t);
        this.gBadges.selectAll('g.badge').classed('lit', (d) => d.key === link.key);
        return;
      }
      this.spotlight(ends);
    }
    // an execution context pointed at in the page: its frame, its boxes and the steps between them
    spotlightRegion(key) {
      if (!this.L || !this.spec) return;
      const reg = (this.spec.regions || []).find((r) => r.key === key);
      if (!reg) return;
      const keys = new Set(reg.boxes);
      this.svg.classed('hovering', true);
      this.gRegions.selectAll('g.region').classed('lit', (d) => d.key === key);
      this.gNodes.selectAll('g.node').classed('lit', (d) => keys.has(d.key));
      this.gEdges.selectAll('path.edge').classed('lit', (d) => keys.has(d.s) && keys.has(d.t));
      this.gLabels.selectAll('text.label').classed('lit', (d) => keys.has(d.key));
    }
    spotlight(ids) {
      this.gRegions.selectAll('g.region').classed('lit', false);
      if (!ids) { this.hover(null); this.gBadges.selectAll('g.badge').classed('lit', false); return; }
      const set = new Set(ids);
      const keys = new Set(this.L.nodes.filter((n) => set.has(n.id)).map((n) => n.key));
      if (this.spec && this.spec.ego) keys.add(this.spec.ego); // the note being read stays in view
      this.svg.classed('hovering', true);
      this.gNodes.selectAll('g.node').classed('lit', (d) => keys.has(d.key));
      this.gEdges.selectAll('path.edge').classed('lit', (d) => keys.has(d.s) && keys.has(d.t));
      this.gLabels.selectAll('text.label').classed('lit', (d) => keys.has(d.key));
    }
    hover(key) {
      const svg = this.svg;
      if (!key) { svg.classed('hovering', false); this.gNodes.selectAll('g.node').classed('lit', false); this.gEdges.selectAll('path.edge').classed('lit', false); this.gLabels.selectAll('text.label').classed('lit', false); this.hoverLabel(null); return; }
      const nb = new Set([key]);
      this.gEdges.selectAll('path.edge').classed('lit', (d) => { const on = d.s === key || d.t === key; if (on) { nb.add(d.s); nb.add(d.t); } return on; });
      svg.classed('hovering', true);
      this.gNodes.selectAll('g.node').classed('lit', (d) => nb.has(d.key));
      this.gLabels.selectAll('text.label').classed('lit', (d) => nb.has(d.key));
      this.hoverLabel(key);
    }
    // a node without a placed label still says its name while pointed at
    hoverLabel(key) {
      this.gLabels.selectAll('g.hover-label').remove();
      if (!key) return;
      const n = this.L.byKey.get(key), p = this.pos.get(key);
      if (!n || n.lab || !p) return;
      const font = `500 12px ${FONT}`, w = tw(n.label, font) + 12;
      let x = p.x + n.r + 6, y = p.y - 11;
      if (x + w > this.W - 4) x = p.x - n.r - 6 - w;
      const g = this.gLabels.append('g').attr('class', 'hover-label').attr('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      g.append('rect').attr('width', w).attr('height', 22).attr('rx', 5);
      g.append('text').attr('x', 6).attr('y', 15).text(n.label);
    }
  }
  window.Graph = Graph;
  window.Graph.glyph = glyph;
  window.Graph.hollow = hollow;
})();
