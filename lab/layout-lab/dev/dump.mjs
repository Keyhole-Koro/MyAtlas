// node dev/dump.mjs <diagram> [engine] — prints one engine's boxes, routes and labels (estimated text widths).
import { readFileSync } from 'node:fs';
import { buildDiagram } from '../js/model.js';
import { layoutLanes } from '../js/engines/lanes.js';
import { layoutHand } from '../js/engines/hand.js';
import { measureLayout } from '../js/metrics.js';
const A = JSON.parse(readFileSync(new URL('../../data/atlas.json', import.meta.url)));
const [d = 'ui', e = 'lanes'] = process.argv.slice(2);
const D = buildDiagram(A, d);
const G = e === 'hand' ? layoutHand(D) : layoutLanes(D);
const M = measureLayout(D, G);
console.log('size', G.width, G.height);
for (const b of D.boxes) { const g = G.boxes[b.id]; console.log('box', b.id.padEnd(9), b.band.padEnd(7), [g.x, g.y, g.w, g.h].map(Math.round).join(',')); }
for (const ed of G.edges) { const s = D.steps[ed.i]; const l = G.labels.find((x) => x.i === ed.i); console.log('step', String(s.no).padStart(4), s.kind.padEnd(7), (s.from + '->' + s.to).padEnd(18), JSON.stringify(ed.pts.map((p) => p.map(Math.round))), 'label', l ? [l.x, l.y, l.w].map(Math.round).join(',') : '-', 'pill', s.pill.w); }
for (const r of G.regions || []) console.log('region', r.node, JSON.stringify(r.parts || [[r.x0, r.y0, r.x1, r.y1]]));
console.log(JSON.stringify(M.values));
