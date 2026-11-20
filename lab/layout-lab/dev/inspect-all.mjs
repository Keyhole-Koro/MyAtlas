// node dev/inspect-all.mjs [engine,...] — every diagram × the given engines in Chromium: values and problems, short.
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
const engines = (process.argv[2] || 'hand,lanes').split(',');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (er) => console.error('page error', er.message));
await page.goto(`http://127.0.0.1:${server.address().port}/layout-lab/dev/all.html?d=ui&e=none`);
await page.waitForSelector('body[data-ready="1"]', { timeout: 60000, state: 'attached' });
const out = await page.evaluate(async (engines) => {
  const { buildDiagram, diagramList } = await import('../js/model.js');
  const { ENGINE } = await import('../js/engines/index.js');
  const { measureLayout, scoreOne } = await import('../js/metrics.js');
  const rows = [];
  for (const d of diagramList(window.ATLAS)) {
    const D = buildDiagram(window.ATLAS, d.id);
    for (const e of engines) {
      const t0 = performance.now();
      const G = await ENGINE[e].run(D);
      const ms = performance.now() - t0;
      const M = measureLayout(D, G);
      const v = M.values;
      const probs = Object.entries(M.defects).filter(([, x]) => x.length).map(([k, x]) => `${k}:${x.map((y) => (y.a ?? y.i ?? y.label ?? '') + (y.kind ? '/' + y.kind : '') + (y.b != null ? '×' + y.b : '') + (y.line != null ? '×' + y.line : '')).join(',')}`).join(' ');
      rows.push(`${d.id.padEnd(16)} ${e.padEnd(6)} score ${String(scoreOne(M)).padStart(3)} ${Math.round(G.width)}x${Math.round(G.height)} x${v.crossings} t${v.through} j${v.jogs} det${Math.round(v.detour)} b${v.bends.toFixed(1)} o${v.overlaps} l${v.onLine} d${v.detached} tr${v.trimmed} fit${v.fit.toFixed(1)} lay${Math.round(v.layers * 100)} tv${Math.round(v.travel)} fr${v.frames} ${Math.round(ms)}ms  ${probs}`);
    }
  }
  return rows;
}, engines);
console.log(out.join('\n'));
await browser.close();
server.close();
