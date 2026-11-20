// (3) dagre, the usual default of diagram tools: ranks top to bottom by network simplex, crossings reduced by
// barycentres, each step's label reserved as a node in the middle of its edge, lines drawn as smooth curves.
// It knows nothing of bands, so a box's layer shows only by its colour. Execution contexts are clusters.
export const DAGRE_DEFAULTS = { rankdir: 'TB', nodesep: 36, ranksep: 40, edgesep: 14, marginx: 20, marginy: 20, ranker: 'network-simplex', clusters: true };

export function layoutDagre(D, dagre, extra = {}) {
  const o = { ...DAGRE_DEFAULTS, ...extra };
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: !!o.clusters });
  g.setGraph({ rankdir: o.rankdir, nodesep: o.nodesep, ranksep: o.ranksep, edgesep: o.edgesep, marginx: o.marginx, marginy: o.marginy, ranker: o.ranker });
  g.setDefaultEdgeLabel(() => ({}));
  const order = [...D.boxes].sort((a, b) => a.first - b.first);
  if (o.clusters) D.regions.forEach((rg, k) => g.setNode('rg' + k, { label: rg.label, paddingTop: 30, paddingBottom: 14, paddingLeft: 14, paddingRight: 14 }));
  for (const b of order) g.setNode(b.id, { width: b.w, height: b.h });
  if (o.clusters) D.regions.forEach((rg, k) => rg.boxes.forEach((id) => g.setParent(id, 'rg' + k)));
  for (const s of D.steps) g.setEdge(s.from, s.to, { width: s.pill.w, height: s.pill.h, labelpos: 'c', weight: s.alt ? 1 : 2 }, 'e' + s.i);
  dagre.layout(g);
  const boxes = {};
  for (const b of D.boxes) { const n = g.node(b.id); boxes[b.id] = { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height }; }
  const edges = [], labels = [];
  for (const s of D.steps) {
    const e = g.edge({ v: s.from, w: s.to, name: 'e' + s.i });
    edges.push({ i: s.i, pts: e.points.map((p) => [p.x, p.y]), curve: true });
    labels.push({ i: s.i, x: e.x - s.pill.w / 2, y: e.y - s.pill.h / 2, w: s.pill.w, h: s.pill.h });
  }
  const regions = o.clusters ? D.regions.map((rg, k) => {
    const n = g.node('rg' + k);
    const x0 = n.x - n.width / 2, y0 = n.y - n.height / 2;
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1: x0 + n.width, y1: y0 + n.height, tx: x0 + 10, ty: y0 + 16, anchor: 'start' };
  }) : [];
  const gr = g.graph();
  return { width: gr.width, height: gr.height, labelCol: 0, bands: null, boxes, edges, labels, regions };
}
