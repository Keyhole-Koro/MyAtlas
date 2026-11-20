// Finds a good grid layout and stores it in layout.data.js. The page uses the stored grid as long as
// it still covers the map (every station has a cell in its district, every pair its bend); when it
// does not, the page starts from it and only moves what changed.
//
//   node tools/precompute.mjs [iterations=60000] [seeds=1,2,3,4]      lay out from nothing
//   node tools/precompute.mjs --warm [iterations=8000] [seeds=1,2]    start from the stored grid:
//       kept stations stay near their cells, new ones go next to their neighbours (iterations 0:
//       only write the stored grid again with the current signature and districts)
//   --atlas <atlas.json> --code <code.json> --out <layout.data.js>   other paths (for a build step)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { buildModel, layoutSignature } from "../js/model.js";
import { gridProblem, initialState, warmState, anneal, evaluate } from "../js/layout.js";

const here = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : dflt; };
const paths = {
  atlas: flag("--atlas", here + "../data/atlas.json"),
  code: flag("--code", here + "../data/code.json"),
  out: flag("--out", here + "layout.data.js"),
};
const warm = argv[0] === "--warm" ? (argv.shift(), true) : false;
const load = (p) => {
  const atlas = JSON.parse(readFileSync(p.atlas, "utf8"));
  const code = JSON.parse(readFileSync(p.code, "utf8"));
  const model = buildModel(atlas, code);
  return { model, P: gridProblem(model) };
};
// The stored grid as a start: cells of stations that still exist (rows moved with their district).
function storedStart(P, file) {
  if (!existsSync(file)) return null;
  const box = {};
  new Function("window", readFileSync(file, "utf8"))(box);
  const L = box.METRO_LAYOUT;
  if (!L) return null;
  const zoneNow = Object.fromEntries(P.zones.map((z) => [z.id, z]));
  const zoneThen = L.zones || Object.fromEntries(P.zones.map((z) => [z.id, [z.r0, z.r1]]));
  const seen = new Set();
  const X = [], Y = [];
  P.stations.forEach((s, i) => {
    const v = L.stations[s.id];
    let x = -1, y = -1;
    if (v) {
      const then = zoneThen[s.layer], now = zoneNow[s.layer];
      y = then && now ? v[1] - then[0] + now.r0 : v[1];
      x = v[0];
      if (y < P.rowMin[i] || y > P.rowMax[i] || x < 0 || x >= P.cols || seen.has(x * 4096 + y)) { x = -1; y = -1; }
      else seen.add(x * 4096 + y);
    }
    X.push(x); Y.push(y);
  });
  return { X, Y, B: P.edges.map((e) => L.bends[e.key] ?? 0), seed: L.seed, iterations: L.iterations };
}

if (isMainThread) {
  const iterations = Number(argv[0] ?? (warm ? 8000 : 60000));
  const seeds = (argv[1] || (warm ? "1,2" : "1,2,3,4")).split(",").map(Number);
  const { model, P } = load(paths);
  const start = warm ? storedStart(P, paths.out) : null;
  if (warm && !start) { console.error("no stored layout to start from:", paths.out); process.exit(1); }
  let results;
  if (warm && iterations === 0) {
    const S = warmState(P, model, start);
    const r = evaluate(P, { ...S, labelOrder: [...P.stations.keys()] }, undefined, true);
    results = [{ seed: start.seed ?? 0, kept: start.iterations, cost: r.cost, parts: r.parts, X: [...S.X], Y: [...S.Y], B: [...S.B] }];
  } else {
    results = await Promise.all(seeds.map((seed) => new Promise((ok, fail) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { seed, iterations, paths, start } });
      w.on("message", ok);
      w.on("error", fail);
    })));
  }
  results.sort((a, b) => a.cost - b.cost);
  for (const r of results) console.log("seed", r.seed, "cost", r.cost.toFixed(1), JSON.stringify(r.parts, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
  const best = results[0];
  const out = {
    signature: layoutSignature(model), seed: best.seed, cost: Math.round(best.cost * 10) / 10, iterations: best.kept ?? iterations, warm,
    zones: Object.fromEntries(P.zones.map((z) => [z.id, [z.r0, z.r1]])),
    stations: Object.fromEntries(P.stations.map((s, i) => [s.id, [best.X[i], best.Y[i]]])),
    bends: Object.fromEntries(P.edges.map((e, k) => [e.key, best.B[k]])),
  };
  writeFileSync(paths.out, "// Written by tools/precompute.mjs\nwindow.METRO_LAYOUT = " + JSON.stringify(out) + ";\n");
  console.log("wrote", paths.out, "(seed " + best.seed + ")");
} else {
  const { seed, iterations, paths: p, start } = workerData;
  const { model, P } = load(p);
  const S0 = start ? warmState(P, model, start) : initialState(P, model);
  const { state, cost } = anneal(P, S0, { iterations, seed, t0: start ? 3 : undefined });
  const parts = evaluate(P, state, undefined, true).parts;
  parentPort.postMessage({ seed, cost, parts, X: [...state.X], Y: [...state.Y], B: [...state.B] });
}
