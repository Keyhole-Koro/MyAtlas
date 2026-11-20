// Regression checks with a real browser (playwright from lab/tools):
//   node tools/check.mjs            clicks with a real mouse and touch, then the overlap audit
//   node tools/check.mjs clicks     only the clicks
//   node tools/check.mjs overlaps   only the audit (labels, tracks, badges, tags, count chips)
// Exit code 1 when something fails.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "../../tools/node_modules/playwright/index.mjs";

const LAB = resolve(import.meta.dirname, "../..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".mln": "text/plain; charset=utf-8", ".rs": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  try {
    let file = normalize(join(LAB, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!file.startsWith(LAB)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/metro/index.html`;
const browser = await chromium.launch();
let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; console.log(ok ? "ok  " : "FAIL", name, ok ? "" : extra); };

async function page({ w = 1440, h = 900, touch = false, hash = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto(base + hash, { waitUntil: "load" });
  await p.waitForFunction(() => window.metro);
  await p.waitForTimeout(900);
  p.errors = errors;
  return p;
}
const state = (p) => p.evaluate(() => ({ line: metro.ui.line, station: metro.ui.station, step: metro.ui.step, open: !document.querySelector("#panel").hidden }));
const centre = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

async function clicks(touch) {
  const p = await page({ touch });
  const tag = touch ? "touch" : "mouse";
  const tap = async ([x, y]) => { if (touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); await p.waitForTimeout(700); };
  const reset = async () => { await p.keyboard.press("Escape"); await p.evaluate(() => metro.fitAll(false)); await p.waitForTimeout(500); };
  await tap(await centre(p, '.station[data-st="os.gateway"] .pill rect'));
  check(`${tag}: interchange station opens its card`, (await state(p)).station === "os.gateway");
  await reset();
  await tap(await centre(p, '.station[data-st="lib.next"] .dot circle'));
  check(`${tag}: station opens its card`, (await state(p)).station === "lib.next");
  await reset();
  await tap(await centre(p, '.label[data-st="os.serve"] text'));
  check(`${tag}: label opens its card`, (await state(p)).station === "os.serve");
  await reset();
  // a point on the C line where its own hit area is on top
  const pt = await p.evaluate(() => {
    const svg = document.querySelector("#map"), M = svg.getScreenCTM();
    for (const t of metro.scene.tracks.filter((t) => t.line === "cpu" && t.type === "step")) {
      for (let i = 1; i < t.pts.length; i++) {
        const q = svg.createSVGPoint(); q.x = (t.pts[i - 1][0] + t.pts[i][0]) / 2; q.y = (t.pts[i - 1][1] + t.pts[i][1]) / 2;
        const s = q.matrixTransform(M), el = document.elementFromPoint(s.x, s.y);
        if (el?.classList.contains("hit") && el.dataset.line === "cpu") return [s.x, s.y];
      }
    }
    return null;
  });
  await tap(pt);
  let s = await state(p);
  check(`${tag}: track opens the timetable`, s.line === "cpu" && s.open, JSON.stringify(s));
  await tap(await centre(p, "#badges .ride-badge >> nth=3"));
  s = await state(p);
  check(`${tag}: step badge moves to its step`, s.line === "cpu" && s.step != null, JSON.stringify(s));
  if (!touch) {
    const [x, y] = await centre(p, "#map");
    await p.mouse.move(x - 300, y); await p.mouse.down();
    for (let k = 1; k <= 8; k++) await p.mouse.move(x - 300 + k * 9, y + k * 3);
    await p.mouse.up(); await p.waitForTimeout(400);
    s = await state(p);
    check(`${tag}: dragging keeps the timetable open`, s.line === "cpu" && s.open, JSON.stringify(s));
    await reset();
    await tap(await centre(p, '.term-tag[data-line="ui"] rect'));
    s = await state(p);
    check(`${tag}: 始発 tag opens the line at step 1`, s.line === "ui" && s.step === 0, JSON.stringify(s));
  }
  check(`${tag}: no console errors`, !p.errors.length, p.errors.join(" | "));
  await p.context().close();
}

async function overlaps() {
  const sizes = [[1440, 900], [1280, 720], [1024, 768], [390, 844]];
  const states = ["", "document.querySelector('#ridership').click()", ...["ui", "cpu", "app.tasks", "os.gateway", "os.submit", "kernel.cpu-time"].map((id) => `metro.selectLine('${id}')`), "metro.selectLine('ui', 4)"];
  for (const [w, h] of sizes) {
    const p = await page({ w, h });
    for (const js of states) {
      await p.evaluate(() => { metro.selectLine(null, null, { keepView: true }); if (metro.ui.riders) document.querySelector("#ridership").click(); metro.fitAll(false); });
      if (js) await p.evaluate(js);
      await p.waitForTimeout(800);
      const r = await p.evaluate(audit);
      const bad = Object.entries(r).filter(([k, v]) => Array.isArray(v) && v.length);
      check(`${w}×${h} ${js || "全体"}: nothing covers a label (smallest text ${r.minFont}px)`, !bad.length && r.minFont >= 11, JSON.stringify(Object.fromEntries(bad)));
    }
    check(`${w}×${h}: no console errors`, !p.errors.length, p.errors.join(" | "));
    await p.context().close();
  }
}
// In the page: label text vs label text and track, overlays (badges, tags, count chips) and their
// leader lines vs label text.
function audit() {
  const svg = document.querySelector("#map");
  const vis = (el) => { for (let e = el; e && e !== svg; e = e.parentNode) { const cs = getComputedStyle(e); if (cs.display === "none" || Number(cs.opacity) < 0.3) return false; } return true; };
  const bb = (el) => {
    const b = el.getBBox(), m = svg.getCTM().inverse().multiply(el.getCTM());
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
    return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  };
  const shrink = (b) => [b[0] + 0.5, b[1] + 3, b[2] - 0.5, b[3] - 3];
  const ov = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const hits = (ax, ay, bx, by, r) => { let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay; for (let i = 0; i < 4; i++) { const pp = [-dx, dx, -dy, dy][i], q = [ax - r[0], r[2] - ax, ay - r[1], r[3] - ay][i]; if (pp === 0) { if (q < 0) return false; } else { const t = q / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } } } return true; };
  const texts = [...svg.querySelectorAll(".labels text")].filter(vis).map((t) => ({ st: t.closest(".label").dataset.st, txt: t.textContent, b: shrink(bb(t)), fs: parseFloat(getComputedStyle(t).fontSize) }));
  const out = { labels: [], tracks: [], overlays: [], leaders: [] };
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (texts[i].st !== texts[j].st && ov(texts[i].b, texts[j].b)) out.labels.push(`${texts[i].txt} × ${texts[j].txt}`);
  const shown = new Set([...svg.querySelectorAll(".line-g")].filter((g) => !g.classList.contains("dim")).map((g) => g.dataset.line));
  for (const t of texts) for (const tr of metro.scene.tracks) if (shown.has(tr.line) && tr.pts.some((q, k) => k && hits(...tr.pts[k - 1], ...q, t.b))) { out.tracks.push(`${t.txt} × ${tr.line}`); break; }
  const overlays = [...svg.querySelectorAll("#badges .ride-badge, .rider-n, .term-tag, .port-tag")].filter(vis).map((el) => ({ txt: el.textContent.trim().replace(/\s+/g, " "), b: bb(el.querySelector("rect")) }));
  for (const o of overlays) for (const t of texts) if (ov(o.b, t.b)) out.overlays.push(`${o.txt} × ${t.txt}`);
  for (let i = 0; i < overlays.length; i++) for (let j = i + 1; j < overlays.length; j++) if (ov(overlays[i].b, overlays[j].b)) out.overlays.push(`${overlays[i].txt} × ${overlays[j].txt}`);
  for (const path of svg.querySelectorAll(".rider-n > path, .tag-lead, .port > path")) {
    const m = vis(path) && path.getAttribute("d").match(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/);
    if (m) for (const t of texts) if (hits(+m[1], +m[2], +m[3], +m[4], t.b)) out.leaders.push(`leader × ${t.txt}`);
  }
  out.minFont = +Math.min(...texts.map((t) => t.fs * metro.cam.s)).toFixed(2);
  return out;
}

const what = process.argv[2];
if (what !== "overlaps") { await clicks(false); await clicks(true); }
if (what !== "clicks") await overlaps();
await browser.close();
server.close();
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
