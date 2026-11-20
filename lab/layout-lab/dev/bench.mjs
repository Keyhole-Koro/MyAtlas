// node dev/bench.mjs [diagram] — runs every engine on the diagrams under node and prints the metrics and the score
// (text widths are estimated here; the page and dev/collect.mjs measure them in Chromium). hand0 is the current map
// without cutting labels, rows the ELK attempt at rows (not on the page).
import { readFileSync } from 'node:fs';
import ELK from '../node_modules/elkjs/lib/elk.bundled.js';
import * as dagre from '../node_modules/@dagrejs/dagre/dist/dagre.esm.js';
import * as d3 from 'd3-force';
import { buildDiagram, diagramList } from '../js/model.js';
import { layoutHand } from '../js/engines/hand.js';
import { layoutElk } from '../js/engines/elk.js';
import { layoutDagre } from '../js/engines/dagre.js';
import { layoutForce } from '../js/engines/force.js';
import { layoutSeq } from '../js/engines/seq.js';
import { layoutRows } from '../js/engines/rows.js';
import { layoutLanes } from '../js/engines/lanes.js';
import { measureLayout, METRICS, scoreAll, fmtValue } from '../js/metrics.js';
const A = JSON.parse(readFileSync(new URL('../../data/atlas.json', import.meta.url)));
const only = process.argv[2];
const engines = {
  hand: (D) => layoutHand(D),
  hand0: (D) => layoutHand(D, { trim: false }),
  elk: (D) => layoutElk(D, ELK),
  dagre: (D) => layoutDagre(D, dagre.default || dagre),
  force: (D) => layoutForce(D, d3),
  seq: (D) => layoutSeq(D),
  rows: (D) => layoutRows(D, ELK),
  lanes: (D) => layoutLanes(D),
};
const pad = (s, n) => { s = String(s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 0x2e80 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
for (const d of diagramList(A)) {
  if (only && d.id !== only) continue;
  const D = buildDiagram(A, d.id);
  const res = {}, ms = {};
  for (const [id, fn] of Object.entries(engines)) {
    const t0 = performance.now();
    const G = await fn(D);
    res[id] = measureLayout(D, G);
    ms[id] = performance.now() - t0;
  }
  const sc = scoreAll(res);
  console.log(`\n== ${d.id} (${d.tab}) ==`);
  console.log(pad('', 18) + Object.keys(engines).map((e) => e.padStart(11)).join(''));
  for (const m of METRICS) {
    console.log(pad(m.name, 18) + Object.keys(engines).map((e) => ((sc.best[m.id].includes(e) ? '*' : ' ') + fmtValue(m, res[e].values[m.id], res[e]).replace(/（.*）/, '')).padStart(11)).join(''));
  }
  console.log(pad('点', 18) + Object.keys(engines).map((e) => String(sc.score[e]).padStart(11)).join(''));
  console.log(pad('大きさ', 18) + Object.keys(engines).map((e) => `${Math.round(res[e].detail.width)}x${Math.round(res[e].detail.height)}`.padStart(11)).join(''));
  console.log(pad('ms', 18) + Object.keys(engines).map((e) => ms[e].toFixed(0).padStart(11)).join(''));
}
