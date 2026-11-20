// Reads window.ATLAS / window.ATLAS_CODE and derives what the building needs.
// Nothing here invents facts: every string shown comes from the atlas or the code index.

export const A = window.ATLAS;
export const CODE = window.ATLAS_CODE;

export const LAYERS = A.layers;
export const STACK = A.layers.filter((l) => !l.cross).map((l) => l.id); // top → bottom
export const layerById = Object.fromEntries(A.layers.map((l) => [l.id, l]));

// Floor numbers are only a way of speaking about the building (the emulator is the basement).
export const FLOOR_NO = { app: "4F", lib: "3F", os: "2F", kernel: "1F", emu: "B1" };

export function node(id) { return A.nodes[id]; }

// Who runs in each execution context (from ctx.*.run).
export const THREADS = {
  "アプリのスレッド": { key: "app", name: "アプリのスレッド", color: "var(--th-app)" },
  "service task（OS のスレッド）": { key: "svc", name: "service task（OS のスレッド）", color: "var(--th-svc)" },
  "割り込み": { key: "irq", name: "割り込み", color: "var(--th-irq)" },
};
export function threadOfCtx(ctxId) {
  const n = A.nodes[ctxId];
  return n && n.run ? THREADS[n.run] || { key: "other", name: n.run, color: "var(--th-other)" } : null;
}

/** A flow or a paper, with lookups. */
export function sheet(id) {
  const f = A.flows.find((x) => x.id === id) || A.papers[id];
  if (!f) return null;
  if (f._ready) return f;
  f.isPaper = !!A.papers[id] && !A.flows.find((x) => x.id === id);
  f.boxById = Object.fromEntries(f.boxes.map((b) => [b.id, b]));
  f.regionOfBox = {};
  for (const r of f.regions || []) for (const b of r.boxes) f.regionOfBox[b] = r;
  f.main = [];
  f.alts = [];
  f.steps.forEach((s, i) => {
    s.index = i;
    if (s.alt) f.alts.push(s);
    else { s.no = f.main.length + 1; f.main.push(s); }
  });
  // alt steps hang off the main step they replace
  for (const s of f.alts) {
    const at = f.steps[s.alt.at];
    s.altOf = at;
    (at.altSteps ||= []).push(s);
  }
  // Who carries each step: the thread of the context the step starts in. A box outside any
  // context inherits the thread that last arrived at it. A read or write is done by the
  // function side of the step, not by the store.
  const lastAt = {};
  const regionThread = (b) => (f.regionOfBox[b] ? threadOfCtx(f.regionOfBox[b].node) : null);
  const threadAt = (b) => regionThread(b) || lastAt[b] || null;
  const kindOf = (b) => A.nodes[f.boxById[b]?.node]?.kind;
  for (const s of f.main.concat(f.alts)) {
    let actor = s.from;
    if (s.kind === "data" && kindOf(s.from) !== "func" && kindOf(s.to) === "func") actor = s.to;
    let th = threadAt(actor);
    if (!th && s.kind !== "signal") th = threadAt(s.to);
    s.thread = th;
    s.actorBox = actor;
    if (s.alt) continue;
    if (s.kind === "signal") lastAt[s.to] = regionThread(s.to);
    else if (s.kind !== "data") lastAt[s.to] = regionThread(s.to) || th;
  }
  f._ready = true;
  return f;
}

export const FLOWS = A.flows.map((f) => sheet(f.id));
export function paperIds() { return Object.keys(A.papers); }
for (const id of paperIds()) sheet(id);

/** Which flows/papers a node takes part in, for the node card. */
export function appearances(nodeId) {
  const out = [];
  for (const f of A.flows.concat(Object.values(A.papers))) {
    const boxes = f.boxes.filter((b) => b.node === nodeId).map((b) => b.id);
    if (!boxes.length) continue;
    const steps = f.steps.filter((s) => boxes.includes(s.from) || boxes.includes(s.to));
    out.push({ sheet: f, boxes, steps });
  }
  return out;
}

/** The paper that has a box for nodeId (the node lives inside that machine). */
export function containerOf(nodeId) {
  for (const [pid, p] of Object.entries(A.papers)) {
    if (p.boxes.some((b) => b.node === nodeId)) return pid;
  }
  return null;
}

export const KIND_JA = {
  call: "呼び出し", syscall: "syscall", msg: "列を通す", signal: "通知", data: "読み書き", return: "戻り",
};
export const NODE_KIND_JA = {
  func: "関数", store: "置き場", schema: "構造体", enum: "列挙", context: "実行の文脈", hw: "ハードウェア",
  note: "決まり", figure: "図",
};

/** Splits "text with [[node-id]] links" into parts. */
export function linkParts(text) {
  const parts = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    parts.push(m[1] ? { embed: m[2] } : { link: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return parts;
}
export function plain(text) {
  return linkParts(text || "").map((p) => p.t ?? (p.link ? (A.nodes[p.link]?.title || p.link) : "")).join("");
}

export function codeOfStep(sheetId, index) {
  const s = CODE.steps[sheetId]?.[String(index)];
  return s || null;
}
export function codeOfNode(nodeId) { return CODE.nodes[nodeId] || null; }
