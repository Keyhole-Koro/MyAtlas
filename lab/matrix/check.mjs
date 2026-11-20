#!/usr/bin/env node
// Checks the matrix page the way it was checked while building it:
//   node lab/matrix/check.mjs        (from the MyAtlas-lab directory)
// Serves lab/ on a free port (closed at the end), drives the page through its states at desktop
// and phone sizes, light and dark, and reports console errors, labels that collide, text under
// 11px, a corner that does not hold its legend, whether the matrix fits the window, what the
// panel says about the recorded run, and whether every step's badge sits on that step's cell.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from '../tools/node_modules/playwright/index.mjs';

const LAB = resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mln': 'text/plain; charset=utf-8', '.rs': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    let file = normalize(join(LAB, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!file.startsWith(LAB)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;

// runs inside the page: label collisions, small text and the corner in the current state
const probe = () => {
  const out = [];
  for (const sel of ['#mx-rows', '#mx-cols', '#chord']) {
    // a hovered label is enlarged on purpose and drawn over its neighbours
    const boxes = [...document.querySelectorAll(sel + ' text')].filter((t) => t.textContent && !t.closest('.is-hot')).map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const sameLine = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6;
      // a text box includes the font's line gap (about 5px at 12px)
      const hit = sel === '#mx-cols' ? ox > 5.2 && oy > 2 : sameLine ? ox > 1 && oy > 2 : ox > 2 && oy > 5.2;
      if (hit) out.push(`collision ${sel}: "${boxes[i].t}" × "${boxes[j].t}"`);
    }
  }
  for (const e of document.querySelectorAll('body *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) continue;
    if (parseFloat(cs.fontSize) < 11) out.push(`small text ${cs.fontSize}: "${e.textContent.trim().slice(0, 24)}"`);
  }
  const corner = document.querySelector('#mx-corner');
  const kids = [...corner.children].filter((e) => getComputedStyle(e).display !== 'none');
  const last = kids[kids.length - 1];
  if (last && last.offsetTop + last.offsetHeight > corner.clientHeight + 1) out.push('the corner cuts its legend');
  for (const e of document.querySelectorAll('.head, .detail, .pick')) if (e.scrollWidth > e.clientWidth + 1) out.push(`${e.className} is wider than its card`);
  return out;
};
// every badge of the walk sits on a cell that holds its step (when the step's kind is shown)
const badges = () => {
  const out = [];
  const st = __mx.state, L = __mx.layout(), cells = __mx.cells();
  if (!st.walk) return out;
  const w = MX.WALK[st.walk];
  const vis = (id) => (MX.OWNER[id] && !st.open.has(MX.OWNER[id]) ? MX.OWNER[id] : id);
  for (const s of w.steps) {
    const cell = cells.get(vis(s.r) + '|' + vis(s.c));
    if (st.kinds.has(s.rk) && !(cell && cell.rels.some((r) => r.step === s))) out.push(`badge ${w.id} ${MX.stepTag(s)} is not on its cell`);
    const g = document.querySelector(`#mx-body .badge[data-i="${s.i}"]`);
    if (!g) { out.push(`no badge for ${w.id} ${MX.stepTag(s)}`); continue; }
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform'));
    const x = +m[1], y = +m[2];
    if (Math.abs(y - L.pos[vis(s.r)]) > L.P * 0.5 + 0.5 || x < L.pos[vis(s.c)] - L.P * 0.5 - 0.5) out.push(`badge ${w.id} ${MX.stepTag(s)} is off its cell`);
  }
  return out;
};
// what the panel says about the recorded run, against the trace itself
const traces = () => {
  const out = [];
  for (const id of MX.ALL) {
    const t = __mx.traceText(id) || '';
    const n = MX.N[id];
    if (/入っていない/.test(t)) out.push(`trace ${id}: claims it was not entered`);
    if (MX.TRACE_N[id] && !t.includes(`に ${MX.TRACE_N[id]} 回入った`)) out.push(`trace ${id}: misses its count ${MX.TRACE_N[id]}`);
    if (!MX.TRACE_N[id] && /^この関数（[^）]*）に \d+ 回入った/.test(t)) out.push(`trace ${id}: counts entries the trace has not`);
    if (n.kind !== 'func' && /^この関数/.test(t)) out.push(`trace ${id}: speaks of a ${n.kind} as a function`);
  }
  return out;
};

const browser = await chromium.launch();
let failures = 0;
for (const [w, h, dark] of [[1440, 900, false], [1440, 900, true], [1280, 800, false], [390, 844, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route((u) => !u.href.startsWith(base) && !u.href.startsWith('data:'), (r) => r.abort());
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  await page.goto(base + 'matrix/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const tag = `${w}×${h}${dark ? ' dark' : ''}`;
  const fit = await page.evaluate(() => { const p = document.querySelector('#pane'); return { x: p.scrollWidth <= p.clientWidth + 1, y: p.scrollHeight <= p.clientHeight + 1 }; });
  if (w === 1440 && !(fit.x && fit.y)) problems.push('the folded matrix does not fit the window');
  if (w === 1280 && !fit.x) problems.push('the folded matrix scrolls sideways at 1280');
  const all = "['call','return','write','read','syscall','msg','signal','paper','context','shape','mention']";
  const states = [
    ['default (UI flow, step 1)', null],
    ...['ui', 'cpu', 'app.tasks', 'kernel.cpu-time', 'os.gateway', 'os.submit'].map((id) => [`walk ${id}`, `__mx.setWalk('${id}'); for (let k = 0; k < 14; k++) __mx.stepBy(1)`]),
    ['no walk', "__mx.setWalk(null)"],
    ['cluster', "__mx.setOrder('cluster')"],
    ['layer', "__mx.setOrder('layer')"],
    ['all kinds', `__mx.setKinds(${all})`],
    ['cluster, all kinds', "__mx.setOrder('cluster')"],
    ['layer again', "__mx.setOrder('layer')"],
    ['a node', "__mx.selectNode('schema.request')"],
    ['a busy cell', "__mx.clickCell('os.gateway', 'schema.request')"],
    ['chord', "__mx.setTab('chord')"],
    ['layer × layer table', "document.querySelector('#chord-mode button[data-mode=table]').click()"],
    ['chord again', "document.querySelector('#chord-mode button[data-mode=step]').click()"],
    ['all papers open', "__mx.setTab('node'); document.querySelector('#fold-all').click()"],
    ['walk in the open matrix', "__mx.setWalk('kernel.cpu-time'); __mx.stepBy(1); __mx.stepBy(1)"],
    ['walk ends, papers folded', "__mx.setWalk(null); document.querySelector('#fold-all').click()"],
    ['hover every cell', "{ const L = __mx.layout(); for (const a of L.list) for (const b of L.list) __mx.hoverCell(a, b); }"],
  ];
  for (const [name, js] of states) {
    if (js) { await page.evaluate(js); await page.waitForTimeout(750); }
    for (const p of await page.evaluate(probe)) problems.push(`${name}: ${p}`);
    for (const p of await page.evaluate(badges)) problems.push(`${name}: ${p}`);
  }
  for (const p of await page.evaluate(traces)) problems.push(p);
  // a walk opens the parts it needs and folds them again when it ends
  const folded = await page.evaluate(() => { __mx.setWalk('os.gateway'); const a = __mx.state.open.size; __mx.setWalk(null); return [a, __mx.state.open.size]; });
  if (!(folded[0] > 0 && folded[1] === 0)) problems.push(`a paper walk leaves its parts open (${folded.join(' → ')})`);
  if (w < 600) {
    // on a phone the current step's cell is scrolled into view, both ways
    for (const k of [2, 6, 9]) {
      await page.evaluate((k) => { __mx.setWalk('ui'); __mx.setStep(MX.WALK.ui.order[k]); }, k);
      await page.waitForTimeout(1600);
      const seen = await page.evaluate(() => {
        const ring = document.querySelector('#mx-body .cur-ring').getBoundingClientRect();
        const body = document.querySelector('#pane').getBoundingClientRect();
        const L = __mx.layout();
        const ok = ring.left >= body.left + L.rowsW - 4 && ring.right <= body.right + 4 && ring.top >= body.top + L.colsH - 4 && ring.bottom <= body.bottom + 4;
        return ok ? '' : JSON.stringify({ ring: [ring.left, ring.top, ring.right, ring.bottom].map(Math.round), pane: [body.left, body.top, body.right, body.bottom].map(Math.round) });
      });
      if (seen) problems.push(`phone: step ${k + 1} is scrolled out of view ${seen}`);
    }
  }
  const uniq = [...new Set(problems)];
  console.log(`${tag}: ${uniq.length ? uniq.length + ' problems' : 'ok'}`);
  uniq.slice(0, 30).forEach((p) => console.log('  ' + p));
  failures += uniq.length;
  await ctx.close();
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
