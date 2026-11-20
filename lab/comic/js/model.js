// Data for the comic: flows and papers turned into "stories" of panels.
// Everything comes from window.ATLAS / window.ATLAS_CODE; nothing here adds facts.

export const ATLAS = window.ATLAS;
export const CODE = window.ATLAS_CODE || { nodes: {}, steps: {}, files: {} };
export const NODES = ATLAS.nodes;
export const LAYERS = ATLAS.layers.filter((l) => !l.cross);
export const LAYER_BY_ID = Object.fromEntries(ATLAS.layers.map((l) => [l.id, l]));

// How each kind of step reads, in the reference viewer's words.
export const KIND_NAME = {
  call: '呼び出し', syscall: 'syscall（アプリから OS へ）', return: '戻り・返事',
  signal: '割り込み・通知', msg: '列を通す', data: '値を読む・書く',
};
export const NODE_KIND_NAME = {
  func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙',
  context: '実行の文脈', note: '方針', figure: '図',
};

const ALT_LETTERS = 'ABCDEFGH';

// The name a person reads for a node: its function name when it has one.
export function nodeName(id) {
  const n = NODES[id];
  if (!n) return id;
  return n.fn || n.title || id;
}

// [[id]] links and ![[id]] embeds in a text, split into parts.
export function parseLinks(text) {
  const out = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    out.push({ t: m[1] ? 'embed' : 'link', id: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

// The name a link shows inside prose: the node's title, as the map's own viewer does.
export function linkName(id) {
  return NODES[id]?.title || id;
}

// Plain text with links replaced by the node's title.
export function plain(text) {
  return parseLinks(text || '').map((p) => (p.t === 'text' ? p.v : p.t === 'link' ? linkName(p.id) : '')).join('');
}

// The execution context a region stands for, shortened for small labels.
export function shortRegion(r) {
  if (!r) return '';
  if (r.label3) return r.label3;
  return r.label.replace(/（.*?）/g, '').trim();
}

const storyCache = new Map();

// A story is a flow or a paper with everything a panel needs resolved.
export function story(id) {
  if (storyCache.has(id)) return storyCache.get(id);
  const flow = ATLAS.flows.find((f) => f.id === id);
  const paper = flow ? null : ATLAS.papers[id];
  const src = flow || paper;
  if (!src) return null;

  const levels = flow
    ? LAYERS.map((l) => ({ id: l.id, name: l.name, sub: l.sub, tone: l.id }))
    : src.bands.map((b) => ({ id: b.id, name: b.name, sub: b.sub, tone: b.tone }));
  const levelIdx = Object.fromEntries(levels.map((l, i) => [l.id, i]));

  const boxes = {};
  for (const b of src.boxes) {
    const node = NODES[b.node] || {};
    boxes[b.id] = {
      ...b,
      n: node,
      kind: node.kind || 'func',
      level: levelIdx[b.layer] ?? 0,
      tone: levels[levelIdx[b.layer] ?? 0].tone,
      region: null,
      paper: node.paper && ATLAS.papers[node.paper] ? node.paper : null,
    };
  }
  for (const r of src.regions || []) for (const bid of r.boxes) if (boxes[bid]) boxes[bid].region = r;

  let alt = 0;
  const steps = src.steps.map((st, i) => {
    const s = {
      ...st, i,
      main: !st.alt,
      no: st.alt ? `もし${ALT_LETTERS[alt++]}` : String(i + 1),
      A: boxes[st.from], B: boxes[st.to],
    };
    s.code = (CODE.steps[id] || {})[i] || null;
    return s;
  });
  // Main steps are numbered 1..n in order; another way names the step it replaces.
  for (const s of steps) if (s.alt) s.altOf = steps[s.alt.at];

  // Where each paper opens: the first step that arrives at its box, else the first that leaves it.
  const lenses = {};
  for (const b of Object.values(boxes)) {
    if (!b.paper) continue;
    const at = steps.find((s) => s.main && s.to === b.id) || steps.find((s) => s.main && s.from === b.id);
    if (at) lenses[at.i] = { box: b, paper: b.paper };
  }

  const st = {
    id, kind: flow ? 'flow' : 'paper', src,
    title: src.title, tab: src.tab, levels, boxes, steps, lenses,
    regions: src.regions || [],
    main: steps.filter((s) => s.main),
    alts: steps.filter((s) => !s.main),
  };
  storyCache.set(id, st);
  return st;
}

// The node whose box a paper sits in, and the flows/papers that hold that box.
export function paperHolders(paperId) {
  const out = [];
  for (const f of ATLAS.flows) for (const b of f.boxes) if (NODES[b.node]?.paper === paperId) out.push({ story: f.id, box: b.id });
  for (const [pid, p] of Object.entries(ATLAS.papers)) for (const b of p.boxes) if (NODES[b.node]?.paper === paperId) out.push({ story: pid, box: b.id });
  return out;
}

// Who speaks in a panel: the function among the two, the sender first.
export function speakerOf(s) {
  const fa = s.A.kind === 'func', fb = s.B.kind === 'func';
  if (s.kind === 'data' && !fa && fb) return 'B';
  return 'A';
}

// Which nodes appear in which flows: for "also in episode 2" marks.
export function appearances(nodeId) {
  return ATLAS.flows.filter((f) => f.boxes.some((b) => b.node === nodeId)).map((f) => f.id);
}

// Where to look in the code for a step: the line the map found, else the node's definition.
export function codeOf(storyId, s) {
  if (s.code) return { path: s.code.path, line: s.code.line, exact: true };
  const nid = s.ref && CODE.nodes[s.ref] ? s.ref : s.B.node;
  const c = CODE.nodes[nid];
  if (c) return { path: c.path, line: c.start, end: c.end, exact: false, node: nid };
  return null;
}

// ---- The recorded run, laid against a flow's steps ----
// A trace belongs to the flow its id starts with ("ui-request" → ui). From step 1 on, each step whose
// receiving box is a function gets the first entry into that function after the previous match; stores
// are passed over. The chain stops at the first reply, where the run and the drawing part ways.
export function traceFor(storyId) {
  return (ATLAS.traces || []).find((t) => t.id.split('-')[0] === storyId) || null;
}
// Each match also carries the function entered just before it on the same thread, and the functions
// the step's label names that the run did not pass on the way (e.g. the label says Label_text calls
// send_text, but in the recorded run send_text came right after Window_title).
const traceMatchCache = new Map();
export function traceMatches(storyId) {
  if (traceMatchCache.has(storyId)) return traceMatchCache.get(storyId);
  const tr = traceFor(storyId);
  const st = story(storyId);
  if (!tr || !st || st.kind !== 'flow') return {};
  const ev = tr.events;
  const fns = new Set();
  for (const e of ev) if (e.fn) { fns.add(e.fn); fns.add(e.fn.split('.').pop()); }
  const out = {};
  let k = 0;
  for (const s of st.main) {
    if (s.kind === 'return') break;
    if (s.B.kind !== 'func') continue;
    let j = k;
    while (j < ev.length && ev[j].n !== s.B.node) j++;
    if (j >= ev.length) break;
    const e = ev[j];
    let p = j - 1;
    while (p >= 0 && !(ev[p].ev === 'enter' && ev[p].thread === e.thread)) p--;
    const passed = ev.slice(k, j).filter((x) => x.ev === 'enter' && x.fn).map((x) => x.fn);
    const named = (s.label.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g) || [])
      .filter((t) => /[_.]/.test(t) && fns.has(t) && t !== e.fn && t !== e.fn.split('.').pop());
    const missed = named.filter((t) => !passed.some((f) => f === t || f.endsWith('.' + t) || f.startsWith(t + '.')));
    out[s.i] = { ev: e, thread: tr.threads[String(e.thread)] || String(e.thread), trace: tr, prev: p >= 0 ? ev[p] : null, missed };
    k = j + 1;
  }
  traceMatchCache.set(storyId, out);
  return out;
}

// The app a trace recorded, from its threads: the one thread that is not the kernel's or idle,
// written as the trace's title writes it ("editor" → "Editor").
export function traceApp(tr) {
  const names = Object.values(tr.threads || {}).filter((n) => !n.startsWith('kernel:') && !/idle/.test(n));
  if (names.length !== 1) return '';
  const inTitle = (tr.title || '').match(new RegExp(names[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  return inTitle ? inTitle[0] : names[0];
}

export function threadLabel(name) {
  if (!name) return '';
  if (name.startsWith('kernel:')) return `OS のスレッド ${name.slice(7).trim()}`;
  if (/idle/.test(name)) return '走るもの無し（idle）';
  return `${name} のスレッド`;
}
