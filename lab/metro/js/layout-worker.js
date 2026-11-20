// Lays the map out off the main thread when the stored layout no longer matches the atlas.
import { buildModel } from "./model.js";
import { gridProblem, initialState, warmState, anneal } from "./layout.js";

onmessage = (e) => {
  const { atlas, code, iterations, seeds, start, t0 } = e.data;
  const model = buildModel(atlas, code);
  const P = gridProblem(model);
  let best = null;
  seeds.forEach((seed, k) => {
    // warm: from the stored grid (only new or misplaced stations move far); cold: from nothing
    const S0 = start ? warmState(P, model, start) : initialState(P, model);
    const r = anneal(P, S0, { iterations, seed, t0: start ? t0 ?? 3 : undefined });
    if (!best || r.cost < best.cost) best = r;
    postMessage({ progress: (k + 1) / seeds.length });
  });
  postMessage({ done: true, X: [...best.state.X], Y: [...best.state.Y], B: [...best.state.B] });
};
