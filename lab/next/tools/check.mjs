#!/usr/bin/env node
// Checks the viewer the way the reviews did, so they can be run again after a change:
//   errors      every step of both guided walks in every view, at 1440×900 (light, dark), 1024×768 and
//               390×844 (light, dark), and every node card: no console error, no failed request
//   text        no rendered text under 11px (SVG text at its drawn scale), per view, size and theme
//   overlaps    the walk diagram's labels, the map's current-step marker and the record's arrow names
//               cover nothing, for every step
//   behaviour   play answers at once and an outside pick ends it; search finds nothing for nonsense;
//               Enter/Space keep working after mouse clicks; the phone's code pane opens at the line;
//               the walk card and 記録 give the same count for every step
//   sandbox     the page in an iframe with sandbox="allow-scripts" (an opaque origin, like the artifact site)
//
//   node lab/next/tools/check.mjs            (uses lab/tools/node_modules/playwright)
//   node lab/next/tools/check.mjs --quick    (fewer sizes)
// Exit code 1 when something failed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NEXT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAB = resolve(NEXT, "..");
const { chromium } = await import(join(LAB, "tools/node_modules/playwright/index.mjs"));
const QUICK = process.argv.includes("--quick");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let file = normalize(join(LAB, decodeURIComponent(url.pathname)));
    if (!file.startsWith(LAB)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const h = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
    res.writeHead(200, h); res.end(await readFile(file));
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let failures = 0;
const say = (ok, msg) => { if (!ok) failures++; console.log((ok ? "ok   " : "FAIL ") + msg); };

async function open(hash = "", { w = 1440, h = 900, dark = false, wait = 1200 } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light" });
  await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith("data:") && !u.href.startsWith("blob:"), (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed: " + r.url()));
  await page.goto(base + "next/index.html" + hash, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  return { page, context, errors };
}
const walkStacks = (page) => page.evaluate(() => { const out = []; for (const f of NX.FLOWS) for (const s of NX.walkFrom(NX.firstStack(f))) out.push(s); return out; });
const setStack = (page, st, view) => page.evaluate(([st, view]) => NX.set(view ? { stack: st, view } : { stack: st }, {}), [st, view]);

const SIZES = QUICK ? [[1440, 900, false], [390, 844, false]] : [[1440, 900, false], [1440, 900, true], [1024, 768, false], [390, 844, false], [390, 844, true]];
const label = (w, h, dark) => `${w}×${h}${dark ? " dark" : ""}`;

// ---------------------------------------------------------------- errors
for (const [w, h, dark] of SIZES) {
  const { page, context, errors } = await open("", { w, h, dark });
  const stacks = await walkStacks(page);
  for (const view of ["walk", "map", "seq", "trace", "data"]) {
    for (const st of stacks) { await setStack(page, st, view); await page.waitForTimeout(view === "map" ? 30 : 15); }
  }
  say(!errors.length, `errors, ${stacks.length} steps × 5 views, ${label(w, h, dark)}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}
{
  const { page, context, errors } = await open("");
  const ids = await page.evaluate(() => Object.keys(NX.A.nodes));
  for (const id of ids) { await page.evaluate((id) => NX.ui.openNode(id), id); await page.waitForTimeout(10); }
  say(!errors.length, `errors, ${ids.length} node cards${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}

// ---------------------------------------------------------------- text under 11px
const scanSmall = (page) => page.evaluate(() => {
  const small = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; if (!el || el.closest("[hidden]") || el.closest("title")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    let fs = parseFloat(cs.fontSize);
    if (el instanceof SVGElement) { const m = el.getScreenCTM(); if (m) fs *= Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); }
    if (fs < 10.95) small[(el.getAttribute("class") || el.tagName) + " " + fs.toFixed(1)] = t.slice(0, 24);
  }
  return small;
});
{
  const hashes = ["#v=walk&s=ui:3", "#v=walk&s=ui:3/os.gateway:1", "#v=map&s=ui:0", "#v=map&s=cpu:7", "#v=seq&s=ui:0", "#v=trace&s=ui:0", "#v=data&s=ui:0", "#v=data&s=cpu:0"];
  let bad = 0;
  for (const [w, h, dark] of SIZES) for (const hash of hashes) {
    const { page, context } = await open(hash, { w, h, dark, wait: 1000 });
    const s = await scanSmall(page);
    if (Object.keys(s).length) { bad++; console.log("     under 11px", hash, label(w, h, dark), JSON.stringify(s)); }
    await context.close();
  }
  say(!bad, `text under 11px: ${bad} of ${SIZES.length * hashes.length} pages`);
}

// ---------------------------------------------------------------- overlaps
for (const [w, h] of QUICK ? [[1440, 900]] : [[1440, 900], [1024, 768]]) {
  const { page, context } = await open("", { w, h });
  const stacks = await walkStacks(page);
  const seen = new Set();
  for (const st of stacks) {
    await setStack(page, st);
    await page.waitForTimeout(20);
    // the body's labels among themselves, and the heads' among themselves (the heads stay on top of the
    // body while it scrolls, by design)
    const pairs = await page.evaluate(() => {
      const out = [];
      for (const sel of ["#wBody svg text", "#wHeads svg text"]) {
        const boxes = [...document.querySelectorAll(sel)].filter((t) => t.textContent.trim()).map((t) => { const b = t.getBoundingClientRect(); return { t: t.textContent.trim().slice(0, 20), x0: b.left, y0: b.top, x1: b.right, y1: b.bottom, g: t.closest("g") }; });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.g && a.g === b.g) continue;
          if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 2) out.push(a.t + " × " + b.t);
        }
      }
      return out;
    });
    for (const p of pairs) seen.add(p);
  }
  say(!seen.size, `walk diagram, labels that overlap, ${label(w, h)}: ${seen.size}${seen.size ? " " + [...seen].slice(0, 4).join(" / ") : ""}`);
  await context.close();
}
for (const [w, h] of QUICK ? [[1440, 900]] : [[1440, 900], [1024, 768], [390, 844]]) {
  const { page, context } = await open("#v=map&s=ui:0", { w, h, wait: 1300 });
  const stacks = await walkStacks(page);
  let n = 0;
  for (const st of stacks) {
    await setStack(page, st);
    await page.waitForTimeout(60);
    const covers = await page.evaluate(() => {
      const g = document.querySelector("#mpNow > g");
      if (!g) return 0;
      const only = g.classList.contains("only");
      const parts = [...g.querySelectorAll(only ? "circle.n, text" : "g rect, g text")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
      if (!parts.length) return 0;
      const p = parts.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }));
      let k = 0;
      for (const t of document.querySelectorAll("#mpLabels text, #mpDecor .term-tag rect, #mpShields circle")) {
        const b = t.getBoundingClientRect(); if (!b.width) continue;
        if (Math.min(p.right, b.right) - Math.max(p.left, b.left) > 2 && Math.min(p.bottom, b.bottom) - Math.max(p.top, b.top) > 2) k++;
      }
      return k;
    });
    if (covers) n++;
  }
  say(!n, `map, steps whose marker covers a name, a start tag or a sign, ${label(w, h)}: ${n} of ${stacks.length}`);
  await context.close();
}
for (const [w, h] of QUICK ? [[1440, 900]] : [[1440, 900], [1024, 768], [390, 844]]) {
  const { page, context } = await open("#v=trace&s=ui:0", { w, h, wait: 1300 });
  const stacks = await walkStacks(page);
  const hit = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  let n = 0;
  for (const st of stacks) {
    await setStack(page, st);
    await page.waitForTimeout(40);
    const b = await page.evaluate(() => NX.trace.boxes());
    for (const p of b.pills) {
      if (b.pins.some((q) => hit(p, q))) n++;
      if (b.labels.some((q) => hit([p[0] + 1, p[1] + 1, p[2] - 2, p[3] - 2], q))) n++;
    }
  }
  say(!n, `記録, arrow names on a pin or a call's name, ${label(w, h)}: ${n}`);
  await context.close();
}

// ---------------------------------------------------------------- behaviour
{
  const { page, context, errors } = await open("");
  await page.click("#wPlay");
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ pressed: document.querySelector("#wPlay").getAttribute("aria-pressed"), playing: document.querySelector("#v-walk").classList.contains("playing") }));
  say(r.pressed === "true" && r.playing, "play answers at once");
  await page.waitForTimeout(1600);
  say(await page.evaluate(() => NX.stackKey(NX.state.stack) === "ui:1"), "the walk takes its first step within 1.5 s");
  await page.click('#views [data-view="map"]');
  await page.waitForTimeout(300);
  say(await page.evaluate(() => !document.querySelector("#playPill").hidden), "outside 歩く the header says the walk goes on");
  await page.evaluate(() => NX.set({ stack: NX.stackOfStep("cpu", 4) }, { push: true }));
  await page.waitForTimeout(3800);
  say(await page.evaluate(() => NX.stackKey(NX.state.stack) === "cpu:4" && !NX.walk.playing()), "a step picked outside 歩く ends the walk and stays");
  say(!errors.length, "no errors in the play checks");
  await context.close();
}
{
  const { page, context } = await open("");
  await page.keyboard.press("/");
  await page.keyboard.type("zzzz");
  await page.waitForTimeout(200);
  say(await page.evaluate(() => document.querySelectorAll("#qres li[data-k]").length === 0), "search: nonsense finds nothing");
  await page.fill("#q", "並べる");
  await page.waitForTimeout(200);
  say(await page.evaluate(() => /手順/.test((document.querySelector("#qres li[data-k]") || {}).textContent || "")), "search: a step whose verb is the word comes first");
  await context.close();
}
{
  const { page, context } = await open("");
  for (let k = 0; k < 3; k++) { await page.click("#wNext"); await page.waitForTimeout(120); }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  say(await page.evaluate(() => NX.stackKey(NX.state.stack) === "ui:3/os.gateway:0"), "Enter after mouse clicks enters the paper");
  await page.click('#views [data-view="map"]');
  await page.waitForTimeout(250);
  await page.keyboard.press(" ");
  await page.waitForTimeout(250);
  say(await page.evaluate(() => NX.state.view === "walk" && NX.walk.playing()), "Space after a tab click starts the walk");
  await context.close();
}
{
  const { page, context } = await open("#v=walk&s=ui:6", { w: 390, h: 844, wait: 1400 });
  await page.click('#wPanes [data-pane="code"]');
  await page.waitForTimeout(400);
  say(await page.evaluate(() => { const sc = document.querySelector("#wCode .code-scroll"), ln = document.querySelector("#wCode .ln.main"); if (!ln) return false; const a = sc.getBoundingClientRect(), b = ln.getBoundingClientRect(); return b.top >= a.top && b.bottom <= a.bottom; }), "phone: the code pane opens at the step's line");
  await context.close();
}
{
  const { page, context } = await open("");
  const stacks = await walkStacks(page);
  let bad = 0;
  for (const st of stacks) {
    await setStack(page, st, "walk");
    await page.waitForTimeout(20);
    const a = await page.evaluate(() => (((document.querySelector(".w-step.is-now .sc-rs") || {}).textContent || "").match(/この手順は (\d+) 回/) || [])[1] || "0");
    await page.evaluate(() => NX.set({ view: "trace" }, {}));
    await page.waitForTimeout(20);
    const b = await page.evaluate(() => (((document.querySelector("#trSide .tr-sec .tr-p") || {}).textContent || "").match(/この記録では (\d+) 回/) || [])[1] || "0");
    if (a !== b) bad++;
  }
  say(!bad, `the walk card and 記録 count the same for all ${stacks.length} steps`);
  await context.close();
}

// ---------------------------------------------------------------- sandbox (opaque origin)
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route((u) => !u.href.startsWith(base), (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(`<iframe id="f" sandbox="allow-scripts" src="${base}next/index.html#v=walk&s=ui:6" style="width:1400px;height:860px;border:0"></iframe>`);
  await page.waitForTimeout(2500);
  const frame = page.frames().find((f) => f.url().includes("next/index.html"));
  const ready = frame ? await frame.evaluate(() => ({ ready: !!window.NEXT_READY, origin: String(window.origin), code: !!document.querySelector("#wCode .ln.main") })) : null;
  if (frame) { await frame.evaluate(() => { NX.ui.cycleTheme(); NX.set({ view: "map" }, { push: true }); }); await page.waitForTimeout(600); }
  say(!!ready && ready.ready && ready.origin === "null" && ready.code && !errors.length, `sandboxed iframe (origin ${ready && ready.origin}): loads, reads the sources, switches theme and view${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

await browser.close();
server.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
