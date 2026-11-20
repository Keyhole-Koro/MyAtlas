// Everything derived from window.ATLAS / window.ATLAS_CODE. Nothing here invents facts:
// groups are files, contexts come from the flows' frames, counts from the recorded run.
const A = window.ATLAS, C = window.ATLAS_CODE;

export const NODES = A.nodes;
export const IDS = Object.keys(NODES);
export const LAYERS = A.layers;
export const LAYER = Object.fromEntries(A.layers.map((l) => [l.id, l]));
export const STACK = A.layers.filter((l) => !l.cross).map((l) => l.id);
export const CROSS = A.layers.filter((l) => l.cross).map((l) => l.id);
export const FLOWS = A.flows;
export const PAPERS = A.papers;
export const TRACE = (A.traces || [])[0] || null;
export const CODE = C;
export const TITLE = A.title;

export const KIND_NAME = { func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙', context: '実行の文脈', note: '方針', figure: '図' };
export const EDGE_KIND = {
  call: '呼び出し', syscall: 'syscall（アプリから OS へ）', return: '戻り・返事',
  signal: '割り込み・通知', msg: '列を通す', data: '値を読む・書く',
};
// Cross-cutting layers: their names as people read them (from the data), shortened sub line.
export const LAYER_SHORT_SUB = { contract: 'データの形', context: '地図の点線の枠', policy: '層をまたぐ決まり' };

// Alternatives (もしA, もしB …) are numbered per flow or paper, in order.
for (const f of [...FLOWS, ...Object.values(PAPERS)]) {
  let n = 0;
  for (const st of f.steps) if (st.alt) st.alt.no = 'ABCDEFGH'[n++];
}
export const stepNo = (st, i) => (st.alt ? `もし${st.alt.no}` : String(i + 1));
export const boxOf = (f, id) => f.boxes.find((b) => b.id === id);
export const paperById = (id) => FLOWS.find((f) => f.id === id) || PAPERS[id];
export const isPaper = (f) => !FLOWS.includes(f);
// A step goes into a paper when it calls (not returns to, not reads) a box whose node has one.
export function intoPaper(f, st) {
  if (st.alt || st.kind === 'return' || st.kind === 'data') return null;
  const b = boxOf(f, st.to), pid = b && NODES[b.node] && NODES[b.node].paper;
  return pid && PAPERS[pid] ? pid : null;
}
// The main steps in order, with the alternatives placed right after the step they replace.
export function stepOrder(f) {
  const rows = f.steps.map((st, i) => ({ st, i, at: st.alt ? st.alt.at + 0.5 + i / 1000 : i }));
  return rows.sort((a, b) => a.at - b.at).map((r) => r.i);
}

// [[id]] pointers in text.
export const LINK_RE = /!?\[\[([\w.\-]+)\]\]/g;
export const plain = (s) => String(s || '').replace(LINK_RE, (m, id) => (NODES[id] ? NODES[id].title : id));
export function linksIn(s) { return [...String(s || '').matchAll(LINK_RE)].map((m) => m[1]).filter((id) => NODES[id]); }

// Type names in signatures and fields point at the node that defines that shape.
export const SCHEMA_BY_NAME = Object.fromEntries(IDS.filter((k) => NODES[k].kind === 'schema' || NODES[k].kind === 'enum').map((k) => [NODES[k].title, k]));

// ---- Files ----
export function codeOf(id) {
  const c = C.nodes[id];
  if (!c || !c.path) return null;
  const file = C.files[c.path];
  if (!file) return null;
  return { path: c.path, symbol: c.symbol, start: c.start || 1, end: c.end || file.lines, whole: c.start == null, lang: file.lang, lines: file.lines };
}
// system/MyOS/src/ipc/gateway.unsafe.mln → { repo: MyOS, rel: ipc/gateway.unsafe.mln }
export function splitPath(path) {
  const seg = path.split('/');
  let repo, rest;
  if (['system', 'toolchain', 'runtime'].includes(seg[0])) { repo = seg[1]; rest = seg.slice(2); }
  else { repo = seg[0]; rest = seg.slice(1); }
  if (rest[0] === 'src') rest = rest.slice(1);
  return { repo, rel: rest.join('/'), file: seg[seg.length - 1] };
}
export const fileOf = (id) => (NODES[id].code && NODES[id].code[0]) || null;

// ---- Contexts: which frame a node is drawn in, in the flows ----
export const CONTEXT_OF = {};
for (const f of FLOWS) for (const rg of f.regions || []) for (const bid of rg.boxes) {
  const b = boxOf(f, bid);
  if (b && !CONTEXT_OF[b.node]) CONTEXT_OF[b.node] = rg.node;
}
// Who runs: the thread a context runs on, as the context node says.
export function runOf(ctxId) {
  const n = NODES[ctxId];
  if (!n) return null;
  if (/割り込み/.test(n.run || '')) return 'irq';
  if (/service/.test(n.run || '')) return 'svc';
  return 'app';
}
export const RUN_NAME = { app: 'アプリのスレッド', svc: 'service task', irq: '割り込み' };

// ---- The recorded run: how often each node was entered ----
export const TRACE_COUNT = {};
if (TRACE) for (const e of TRACE.events) if (e.ev === 'enter' && e.n) TRACE_COUNT[e.n] = (TRACE_COUNT[e.n] || 0) + 1;

// ---- Where each node takes part ----
export const IN_FLOWS = {};   // node → [{ f, box }]
for (const f of [...FLOWS, ...Object.values(PAPERS)]) for (const b of f.boxes) (IN_FLOWS[b.node] ||= []).push({ f, box: b.id });
export const PAPER_PARENT = {}; // paper id → node holding it
for (const k of IDS) if (NODES[k].paper) PAPER_PARENT[NODES[k].paper] = k;

// Pointers into a node from elsewhere (same rules as the main viewer).
export function references(id) {
  const out = [], target = NODES[id];
  const re = target && (target.kind === 'schema' || target.kind === 'enum') ? new RegExp(`\\b${target.title}\\b`) : null;
  for (const k of IDS) {
    if (k === id) continue;
    const n = NODES[k];
    const extra = JSON.stringify([n.api || {}, n.fields || [], n.values || [], n.invariants || [], (n.ops || []).map((o) => o.text)]);
    if (n.shape && n.shape.of === id) out.push({ kind: '形を借りる', node: k });
    else if ((n.ops || []).some((o) => o.node === id)) out.push({ kind: '操作', node: k });
    else if ((n.text || '').includes(`![[${id}]]`)) out.push({ kind: '埋め込み', node: k });
    else if ((n.text || '').includes(`[[${id}]]`) || extra.includes(`[[${id}]]`)) out.push({ kind: 'リンク', node: k });
    else if (re && n.api && re.test(n.api.sig)) out.push({ kind: 'API の型', node: k });
    else if (re && n.fields && n.kind !== 'hw' && n.fields.some(([t]) => re.test(t))) out.push({ kind: 'フィールドの型', node: k });
  }
  for (const f of [...FLOWS, ...Object.values(PAPERS)]) f.steps.forEach((st, i) => {
    if (st.data && st.data.schema === id) out.push({ kind: 'データとして通る', flow: f.id, step: i, from: boxOf(f, st.from).node, to: boxOf(f, st.to).node });
  });
  return out;
}

// Nodes a contract shape is used by (for the overlay): pointers, types in signatures/fields, data on steps.
export function usersOf(id) {
  const set = new Set();
  for (const r of references(id)) {
    if (r.node) set.add(r.node);
    if (r.from) { set.add(r.from); set.add(r.to); }
  }
  set.delete(id);
  return [...set].filter((k) => NODES[k] && !['contract', 'context', 'policy'].includes(NODES[k].layer));
}

// ---- Where a step happens in the code ----
export function stepCode(fid, i) {
  const s = (C.steps[fid] || {})[i];
  return s && s.path ? s : null;
}
// The card whose code span shows a given line, preferring the step's own node.
export function cardForLine(path, line, prefer = []) {
  const hit = (k) => { const c = codeOf(k); return c && c.path === path && line >= c.start && line <= c.end; };
  for (const k of prefer) if (k && hit(k)) return k;
  let best = null, bestLen = Infinity;
  for (const k of IDS) if (hit(k)) { const c = codeOf(k); const len = c.end - c.start; if (len < bestLen) { best = k; bestLen = len; } }
  return best;
}

// The order things are met when the flows are walked (papers walked where they are entered).
export const FLOW_RANK = {};
{
  let r = 0;
  const seen = new Set();
  const walk = (f, depth) => {
    for (const i of stepOrder(f)) {
      const st = f.steps[i];
      for (const bid of [st.from, st.to]) { const b = boxOf(f, bid); if (b && FLOW_RANK[b.node] == null) FLOW_RANK[b.node] = r++; }
      const pid = intoPaper(f, st);
      if (pid && !seen.has(pid) && depth < 4) { seen.add(pid); walk(PAPERS[pid], depth + 1); }
    }
    for (const b of f.boxes) if (FLOW_RANK[b.node] == null) FLOW_RANK[b.node] = r++;
  };
  for (const f of FLOWS) walk(f, 0);
  for (const pid of Object.keys(PAPERS)) if (!seen.has(pid)) walk(PAPERS[pid], 1);
}

// Undirected neighbours: flow and paper steps (strong), pointers (weak).
export const NEIGHBOURS = {};
{
  const add = (a, b, w) => {
    if (!a || !b || a === b) return;
    (NEIGHBOURS[a] ||= new Map()).set(b, (NEIGHBOURS[a].get(b) || 0) + w);
    (NEIGHBOURS[b] ||= new Map()).set(a, (NEIGHBOURS[b].get(a) || 0) + w);
  };
  for (const f of [...FLOWS, ...Object.values(PAPERS)]) for (const st of f.steps) add(boxOf(f, st.from).node, boxOf(f, st.to).node, 3);
  for (const k of IDS) {
    const n = NODES[k];
    const all = JSON.stringify([n.text, n.api || {}, n.fields || [], n.values || [], n.ops || [], n.invariants || [], n.shape || {}]);
    for (const id of linksIn(all.replace(/\\"/g, '"'))) add(k, id, 1);
    if (n.paper && PAPERS[n.paper]) for (const b of PAPERS[n.paper].boxes) add(k, b.node, 2);
  }
}

// Lines of the source that start with a label in the node's src text (e.g. 形：…).
export function srcLines(id, label) {
  const src = NODES[id].src || '';
  return src.split('\n').filter((l) => l.startsWith(label + '：')).map((l) => l.slice(label.length + 1));
}
