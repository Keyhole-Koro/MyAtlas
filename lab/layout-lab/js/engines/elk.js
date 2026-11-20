// (2) ELK layered, top to bottom, with one partition per band so the bands stay in their order as horizontal strips.
// Edges are routed orthogonally by ELK, and each step's label is a real label that ELK makes room for.
// Inside a band, boxes keep the order the steps reach them (model order). ELK cannot put two boxes that talk to
// each other in one rank, so a chain inside a band (gateway → 列 → serve …) becomes a column inside that band.
export const ELK_DEFAULTS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.partitioning.activate': 'true',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.thoroughness': '40',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '36',
  'elk.spacing.edgeNode': '18',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeNodeBetweenLayers': '18',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.spacing.edgeLabel': '4',
  'elk.spacing.labelLabel': '6',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};

export const BAND_COL = 128;

export async function layoutElk(D, ELK, extra = {}) {
  const opts = { ...ELK_DEFAULTS, ...extra };
  const usePart = opts['elk.partitioning.activate'] === 'true';
  const order = [...D.boxes].sort((a, b) => a.bandIndex - b.bandIndex || a.first - b.first);
  const graph = {
    id: 'root', layoutOptions: opts,
    children: order.map((b) => ({ id: b.id, width: b.w, height: b.h, layoutOptions: usePart ? { 'elk.partitioning.partition': String(b.bandIndex) } : {} })),
    edges: D.steps.map((s) => ({
      id: 'e' + s.i, sources: [s.from], targets: [s.to],
      labels: [{ id: 'l' + s.i, text: s.no, width: s.pill.w, height: s.pill.h }],
    })),
  };
  const elk = new ELK();
  const out = await elk.layout(graph);
  const dx = BAND_COL;
  const boxes = {};
  for (const c of out.children) boxes[c.id] = { x: c.x + dx, y: c.y, w: c.width, h: c.height };
  const edges = [], labels = [];
  for (const e of out.edges) {
    const i = Number(e.id.slice(1));
    const s = e.sections[0];
    const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map((p) => [p.x + dx, p.y]);
    edges.push({ i, pts });
    const l = e.labels && e.labels[0];
    if (l) labels.push({ i, x: l.x + dx, y: l.y, w: l.width, h: l.height });
  }
  edges.sort((a, b) => a.i - b.i);
  labels.sort((a, b) => a.i - b.i);
  const width = out.width + dx, height = out.height;
  return { width, height, labelCol: dx, bands: bandStrips(D, boxes, height), boxes, edges, labels, regions: frameRegions(D, boxes, dx) };
}

// Horizontal strips for the bands, split halfway between the last box of one band and the first of the next.
export function bandStrips(D, boxes, height) {
  const used = D.bands.map((b) => {
    const own = D.boxes.filter((x) => x.band === b.id).map((x) => boxes[x.id]);
    return own.length ? { ...b, top: Math.min(...own.map((r) => r.y)), bottom: Math.max(...own.map((r) => r.y + r.h)) } : null;
  }).filter(Boolean);
  used.sort((a, b) => a.index - b.index);
  return used.map((b, k) => ({
    ...b,
    y0: k === 0 ? 0 : (used[k - 1].bottom + b.top) / 2,
    y1: k === used.length - 1 ? height : (b.bottom + used[k + 1].top) / 2,
  }));
}

// Execution contexts drawn as a frame round their boxes (its bounding rectangle), label at the top left.
export function frameRegions(D, boxes, minX = 0) {
  return D.regions.map((rg) => {
    const gs = rg.boxes.map((id) => boxes[id]).filter(Boolean);
    const x0 = Math.max(minX + 4, Math.min(...gs.map((g) => g.x)) - 12), y0 = Math.min(...gs.map((g) => g.y)) - 22;
    const x1 = Math.max(...gs.map((g) => g.x + g.w)) + 12, y1 = Math.max(...gs.map((g) => g.y + g.h)) + 12;
    return { node: rg.node, label: rg.label, members: rg.boxes, x0, y0, x1, y1, tx: x0 + 10, ty: y0 + 14, anchor: 'start' };
  });
}
