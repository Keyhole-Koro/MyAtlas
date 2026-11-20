#!/usr/bin/env node
// Checks the labels of the 3D view the way a reader sees them: for every scene (the two flows and
// the four papers) and every step, at 1440×900 and 1280×720, the page is put on that step and the
// labels are read back from the DOM. It fails when
//   - a main step has no visible badge (its number must always be readable),
//   - the current step's badge, or the label of one of its two blocks, is hidden,
//   - two visible labels overlap.
// It also reports how many steps show their verb, as a measure of how much of the story a still
// picture tells.
//
//   node stack3d/tools/check-labels.mjs            (from lab/; SHOT_GL=swiftshader for no GPU)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "../../tools/node_modules/playwright/index.mjs";

const LAB = resolve(import.meta.dirname, "../..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mln": "text/plain; charset=utf-8", ".rs": "text/plain; charset=utf-8" };
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
const GL = process.env.SHOT_GL === "swiftshader" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({ args: GL });
const only = process.argv[2] || "";
const sizes = [[1440, 900], [1280, 720]];
const paths = ["ui", "cpu", "ui>os.gateway", "ui>os.gateway>os.submit", "cpu>kernel.cpu-time", "cpu>app.tasks"].filter((p) => !only || p === only);
let failures = 0, states = 0, verbs = 0, mains = 0;
for (const [w, h] of sizes) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.route((url) => !url.href.startsWith(base), (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => { failures++; console.log("page error:", e.message); });
  page.on("console", (m) => { if (m.type() === "error") { failures++; console.log("console error:", m.text()); } });
  for (const path of paths) {
    // a new query each time, so the page really loads (a changed hash alone would not)
    await page.goto(`${base}stack3d/index.html?still&n=${states}#${path}:0`, { waitUntil: "load" });
    await page.waitForFunction(() => window.atlas3d && window.atlas3d.world());
    await page.waitForTimeout(900);
    const n = await page.evaluate(() => window.atlas3d.state.stack.at(-1).scene.steps.length);
    for (let i = 0; i < n; i++) {
      const r = await page.evaluate(async (i) => {
        const A = window.atlas3d;
        A.step(i);
        A.settle();
        await new Promise((ok) => setTimeout(ok, 60));
        A.settle();
        for (let k = 0; k < 3; k++) await new Promise((ok) => requestAnimationFrame(ok));
        const sc = A.state.stack.at(-1).scene, st = sc.steps[i];
        const vis = (el) => el && !el.classList.contains("off");
        const badge = (k) => document.querySelector(`#labels .sb[data-step="${k}"]`);
        const block = (id) => document.querySelector(`#labels .bl[data-box="${id}"]`);
        const out = { scene: sc.id, step: st.name, missing: [], verbs: 0, mains: 0, overlaps: [] };
        for (const s of sc.steps) if (!s.alt) {
          out.mains++;
          const b = badge(s.i);
          if (!vis(b)) out.missing.push(`badge ${s.name}`);
          else if (["nv", "full"].includes(b.dataset.v)) out.verbs++;
        }
        if (!vis(badge(i))) out.missing.push(`current badge ${st.name}`);
        for (const id of new Set([st.from, st.to])) if (!vis(block(id))) out.missing.push(`block ${id}`);
        const shown = [...document.querySelectorAll("#labels .lbl:not(.off)")].map((el) => ({ el, r: el.getBoundingClientRect() }));
        for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
          const p = shown[a].r, q = shown[b].r;
          if (p.left < q.right - 1 && p.right > q.left + 1 && p.top < q.bottom - 1 && p.bottom > q.top + 1) out.overlaps.push(`${shown[a].el.textContent.slice(0, 14)} × ${shown[b].el.textContent.slice(0, 14)}`);
        }
        return out;
      }, i);
      states++;
      verbs += r.verbs; mains += r.mains;
      if (r.scene !== path.split(">").pop()) { failures++; console.log(`${w}x${h} ${path}: opened ${r.scene} instead`); break; }
      const bad = r.missing.length || r.overlaps.length;
      if (bad) failures++;
      if (bad || process.env.VERBOSE) console.log(`${w}x${h} ${r.scene} step ${r.step}: verbs ${r.verbs}/${r.mains}${r.missing.length ? `  MISSING ${r.missing.join(", ")}` : ""}${r.overlaps.length ? `  OVERLAP ${r.overlaps.join(", ")}` : ""}`);
    }
  }
  await context.close();
}
await browser.close();
server.close();
console.log(`${states} states checked, ${failures} with problems; step verbs shown ${verbs}/${mains} (${Math.round((100 * verbs) / mains)}%)`);
process.exit(failures ? 1 : 0);
