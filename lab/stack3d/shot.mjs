#!/usr/bin/env node
// Copy of lab/tools/shot.mjs for the WebGL prototype: same options, Chromium started with GPU flags.
// Screenshots a page of the lab, served from the lab directory over HTTP (no network beyond it).
//
//   node lab/tools/shot.mjs <page, relative to lab/> <out.png> [options]
//     --w 1440 --h 900       viewport
//     --dark                 prefers-color-scheme: dark
//     --wait 1200            ms to wait after load
//     --click "<selector>"   click before the shot (repeatable, in order)
//     --eval "<js>"          run in the page before the shot (repeatable)
//     --full                 the whole page, not just the viewport
//     --scale 2              device scale factor
// Console errors and failed requests are printed; the exit code is 2 when there were any.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "../tools/node_modules/playwright/index.mjs";

const LAB = resolve(import.meta.dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".wasm": "application/wasm", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".mln": "text/plain; charset=utf-8", ".rs": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };

const args = process.argv.slice(2);
const [pagePath, out] = args;
if (!pagePath || !out) { console.error("usage: shot.mjs <page> <out.png> [--w --h --dark --wait --click --eval --full --scale]"); process.exit(1); }
const opt = { w: 1440, h: 900, wait: 1200, scale: 1, click: [], eval: [], dark: false, full: false };
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a === "--dark") opt.dark = true;
  else if (a === "--full") opt.full = true;
  else if (a === "--click") opt.click.push(args[++i]);
  else if (a === "--eval") opt.eval.push(args[++i]);
  else if (a.startsWith("--")) opt[a.slice(2)] = Number(args[++i]);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let file = normalize(join(LAB, decodeURIComponent(url.pathname)));
    if (!file.startsWith(LAB)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;
// WebGL: use the real GPU when there is one (SHOT_GL=swiftshader forces the software renderer).
const GL = process.env.SHOT_GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({ args: GL });
const context = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.scale, colorScheme: opt.dark ? "dark" : "light" });
// Nothing outside the lab is loaded.
await context.route((url) => !url.href.startsWith(base) && !url.href.startsWith("data:") && !url.href.startsWith("blob:"), (r) => r.abort());
const page = await context.newPage();
let problems = 0;
page.on("console", (m) => { if (m.type() === "error") { problems++; console.log("console error:", m.text()); } });
page.on("pageerror", (e) => { problems++; console.log("page error:", e.message); });
page.on("requestfailed", (r) => { if (r.url().startsWith(base)) { problems++; console.log("failed:", r.url()); } });
await page.goto(base + pagePath, { waitUntil: "load" });
await page.waitForTimeout(opt.wait);
for (const sel of opt.click) { await page.locator(sel).first().click(); await page.waitForTimeout(400); }
for (const js of opt.eval) { await page.evaluate(js); await page.waitForTimeout(400); }
await page.screenshot({ path: resolve(out), fullPage: opt.full });
console.log("wrote", out, problems ? `(${problems} problems)` : "");
await browser.close();
server.close();
process.exit(problems ? 2 : 0);
