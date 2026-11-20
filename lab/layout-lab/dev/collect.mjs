// node dev/collect.mjs — opens the page in Chromium (as the gallery sees it) and prints every engine's numbers
// on every diagram and the trial on altered copies, measured with the browser's own fonts. Used for NOTES.md.
// node dev/collect.mjs --cycle — draws every diagram × engine × step and reports any error.
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let errors = 0;
page.on('pageerror', (e) => { errors++; console.error('page error', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors++; console.error('console error', m.text()); } });
await page.goto(`http://127.0.0.1:${server.address().port}/layout-lab/index.html`);
await page.waitForSelector('body[data-trial="1"]', { timeout: 120000, state: 'attached' });
const data = await page.evaluate(() => ({ overall: window.__lab.overall, trial: window.__lab.trial }));
if (process.argv.includes('--cycle')) {
  // every diagram, every engine, every step: nothing may throw
  const n = await page.evaluate(async () => {
    const L = window.__lab; let k = 0;
    for (const d of L.overall.map((x) => x.id)) for (const e of L.ENGINES) {
      L.state.d = d; L.state.e = e.id;
      const steps = (await L.compute(d)).D.steps.length;
      for (let s = -1; s < steps; s++) { L.state.step = s < 0 ? null : s; L.render(); k++; }
    }
    return k;
  });
  console.error('rendered', n, 'states,', errors, 'errors');
} else console.log(JSON.stringify(data));
await browser.close();
server.close();
