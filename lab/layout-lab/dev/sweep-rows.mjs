import { readFileSync } from 'node:fs';
import ELK from '../node_modules/elkjs/lib/elk.bundled.js';
import { buildDiagram, diagramList } from '../js/model.js';
import { layoutRows } from '../js/engines/rows.js';
import { measureLayout } from '../js/metrics.js';
const A = JSON.parse(readFileSync(new URL('../../data/atlas.json', import.meta.url)));
const base = JSON.parse(process.argv[2] || '{}');
const grid = {
  layering: ['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'BF_MODEL_ORDER', 'DF_MODEL_ORDER'],
  force: ['false', 'true'],
  place: ['NETWORK_SIMPLEX', 'BRANDES_KOEPF'],
};
const rows = [];
for (const layering of grid.layering) for (const force of grid.force) for (const place of grid.place) {
  const elk = { 'elk.layered.layering.strategy': layering, 'elk.layered.crossingMinimization.forceNodeModelOrder': force, 'elk.layered.nodePlacement.strategy': place, ...base };
  let tot = { x: 0, o: 0, t: 0, f: 0, fit: 0, w: 0 }, cells = [];
  let ok = true;
  for (const d of diagramList(A)) {
    const D = buildDiagram(A, d.id);
    try {
      const G = await layoutRows(D, ELK, { elk });
      const M = measureLayout(D, G).values;
      tot.x += M.crossings + M.through; tot.o += M.overlaps; tot.f += M.frames; tot.fit += M.fit / 6;
      cells.push(`${d.id.slice(0, 5)} ${Math.round(G.width)}x${Math.round(G.height)} x${M.crossings + M.through}`);
    } catch (e) { ok = false; cells.push(d.id + ' ERR ' + (e.message || e).slice(0, 40)); }
  }
  rows.push({ key: `${layering.padEnd(19)} force=${force.padEnd(5)} ${place.slice(0, 7)}`, tot, cells, ok });
}
rows.sort((a, b) => (a.tot.x + a.tot.o + a.tot.f) - (b.tot.x + b.tot.o + b.tot.f) || b.tot.fit - a.tot.fit);
for (const r of rows) console.log(r.key, `| bad ${r.tot.x}+${r.tot.o}+${r.tot.f} fit ${r.tot.fit.toFixed(1)} |`, r.cells.join(' · '));
