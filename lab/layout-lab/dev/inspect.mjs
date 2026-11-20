// node dev/inspect.mjs <diagram> [engine] — lays one diagram out in Chromium (real text widths) and prints its
// numbers, its problems and its routes.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
const { chromium } = await import(resolve(import.meta.dirname, '../../tools/node_modules/playwright/index.mjs'));
const LAB = resolve(import.meta.dirname, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let file = normalize(join(LAB, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!file.startsWith(LAB)) return res.writeHead(403).end();
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const [d = 'ui', e = 'lanes'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (er) => console.error('page error', er.message));
await page.goto(`http://127.0.0.1:${server.address().port}/layout-lab/dev/all.html?d=${d}&e=${e}`);
await page.waitForSelector('body[data-ready="1"]', { timeout: 60000, state: 'attached' });
const out = await page.evaluate(async ({ d, e }) => {
  const { buildDiagram } = await import('../js/model.js');
  const { ENGINE } = await import('../js/engines/index.js');
  const { measureLayout } = await import('../js/metrics.js');
  const D = buildDiagram(window.ATLAS, d);
  const G = await ENGINE[e].run(D);
  const M = measureLayout(D, G);
  const r = (v) => (Array.isArray(v) ? v.map(r) : typeof v === 'number' ? Math.round(v) : v);
  return {
    size: [G.width, G.height].map(Math.round), values: M.values,
    defects: Object.fromEntries(Object.entries(M.defects).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((x) => JSON.stringify(x, (kk, vv) => (typeof vv === 'number' ? Math.round(vv) : vv)))])),
    boxes: Object.fromEntries(Object.entries(G.boxes).map(([id, b]) => [id, r([b.x, b.y, b.w, b.h])])),
    edges: G.edges.map((ed) => `${D.steps[ed.i].no} ${D.steps[ed.i].kind} ${D.steps[ed.i].from}->${D.steps[ed.i].to} ${JSON.stringify(r(ed.pts))}`),
    labels: G.labels.map((l) => `${D.steps[l.i].no} ${r([l.x, l.y, l.w])}${l.leader ? ' tick ' + JSON.stringify(r(l.leader)) : ''}${l.pick ? ' pick ' + l.pick : ''}`),
    regions: (G.regions || []).map((x) => `${x.node} parts ${JSON.stringify(r(x.parts || []))} necks ${JSON.stringify(r(x.necks || []))} name ${r([x.tx, x.ty])} ${x.anchor}`),
  };
}, { d, e });
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
