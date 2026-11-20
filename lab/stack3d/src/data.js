// The map's data, reshaped into "scenes": a flow or a paper, each a stack of bands (plates)
// with boxes on them and numbered steps between the boxes. Nothing here adds facts: every
// title, label and field comes from window.ATLAS / window.ATLAS_CODE.

export const ATLAS = window.ATLAS;
export const CODE = window.ATLAS_CODE;
export const NODES = ATLAS.nodes;

export const LAYERS = ATLAS.layers.filter((l) => !l.cross);
export const LAYER = Object.fromEntries(ATLAS.layers.map((l) => [l.id, l]));

export const KIND_NAME = {
  func: "関数", store: "置き場", hw: "レジスタ", schema: "構造体", enum: "列挙",
  context: "実行の文脈", note: "方針", figure: "図",
};
export const STEP_KIND = {
  call: "呼び出し", syscall: "syscall（アプリから OS へ）", return: "戻り・返事",
  signal: "割り込み・通知", msg: "列を通す", data: "値を読む・書く",
};
export const STEP_KIND_SHORT = {
  call: "呼び出し", syscall: "syscall", return: "戻り", signal: "通知", msg: "列を通す", data: "読み書き",
};

// Type names in struct fields that are themselves nodes (RequestDomain → schema.request-domain).
export const SCHEMA_BY_NAME = Object.fromEntries(
  Object.entries(NODES).filter(([, n]) => n.kind === "schema" || n.kind === "enum").map(([k, n]) => [n.title, k]),
);

const PAPERS = ATLAS.papers;

function prepSteps(steps) {
  // Main steps are numbered 1..n in order; a step with `alt` happens instead of another one and
  // is named もしA, もしB… like the map does.
  // `alt` stays the map's object ({ at, when }), so it is also truthy for "is an alternative".
  let n = 0, a = 0;
  return steps.map((s, i) => {
    const alt = s.alt || null;
    const num = alt ? null : ++n;
    const name = alt ? `もし${String.fromCharCode(65 + a++)}` : String(num);
    return { ...s, i, alt, num, name };
  });
}

function sceneFrom(src, type) {
  const bands = type === "flow"
    ? LAYERS.map((l) => ({ id: l.id, name: l.name, sub: l.sub, tone: l.id }))
    : src.bands.map((b) => ({ id: b.id, name: b.name, sub: b.sub, tone: b.tone }));
  const boxes = src.boxes.map((b) => ({ ...b, band: b.layer }));
  const steps = prepSteps(src.steps);
  return {
    type, id: src.id, title: src.title, tab: src.tab, bands, boxes,
    box: Object.fromEntries(boxes.map((b) => [b.id, b])),
    regions: src.regions || [], steps, start: src.start || [0, null],
    entry: src.entry || null, ports: src.ports || {}, src: src.src || "",
  };
}

export const FLOWS = ATLAS.flows.map((f) => sceneFrom(f, "flow"));
export const PAPER_SCENES = Object.fromEntries(Object.entries(PAPERS).map(([k, p]) => [k, sceneFrom(p, "paper")]));
export function sceneById(id) {
  return FLOWS.find((f) => f.id === id) || PAPER_SCENES[id] || null;
}

// The paper inside a node, if it has one.
export function paperOf(nodeId) {
  const n = NODES[nodeId];
  return n && n.paper && PAPER_SCENES[n.paper] ? PAPER_SCENES[n.paper] : null;
}

// Where a node is defined in the source, and where a step happens (when the export found it).
export function codeOf(nodeId) {
  return CODE.nodes[nodeId] || null;
}
export function codeOfStep(sceneId, i) {
  const s = CODE.steps[sceneId];
  return s && s[String(i)] ? s[String(i)] : null;
}
export function srcUrl(path) {
  return `../data/src/${path}`;
}

// Main-path step order (alt steps excluded): indices into scene.steps.
export function mainOrder(scene) {
  return scene.steps.filter((s) => !s.alt).map((s) => s.i);
}

export function boxTitle(scene, boxId) {
  const b = scene.box[boxId];
  return b ? (b.title || NODES[b.node]?.title || boxId) : boxId;
}
export function boxShort(scene, boxId) {
  const b = scene.box[boxId];
  return b ? (b.short || b.title) : boxId;
}

// Text with [[id]] links and ![[id]] embeds → a list of parts.
export function parseText(text) {
  const out = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text || ""))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: m[1] ? "embed" : "link", v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < (text || "").length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

// Plain text for places where links cannot be clicked (3D labels, titles).
export function plainText(text) {
  return parseText(text).map((p) => (p.t === "text" ? p.v : p.t === "link" ? (NODES[p.v]?.title || p.v) : "")).join("");
}

// Thread names of the recorded run, in the map's words.
export function threadName(label) {
  if (!label) return "";
  if (label.startsWith("kernel:")) return `カーネルのスレッド（${label.slice(7).trim()}）`;
  if (/idle/.test(label)) return "走るもの無し（idle）";
  return `${label} のスレッド`;
}
