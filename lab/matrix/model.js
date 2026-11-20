// The data model of the matrix: every relation between two nodes of the map, taken only from
// window.ATLAS (the map) and window.ATLAS_CODE (where things are in the code). Nothing is inferred
// beyond what the map says; each relation keeps the sentence or the step it came from.
//
// A relation is drawn in the cell (row = from, column = to). For the steps of the flows the row is
// the node that acts and the column the one it acts on: it calls, writes, reads, sends to or
// returns to it. A step that reads a value out of a store or the hardware is therefore drawn at the
// reader's row, although the value travels the other way; the flow's own order stays on the step.
// Every other relation reads "the row points at the column" (its paper, its frame, its shape, its text).
'use strict';
(function () {
  const A = window.ATLAS;
  const CODE = window.ATLAS_CODE || { nodes: {}, steps: {}, files: {} };

  // ---- layers and nodes ----
  const LAYERS = A.layers.map((l, i) => Object.assign({}, l, { i }));
  const LAYER = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
  const N = {};
  Object.keys(A.nodes).forEach((id, k) => {
    N[id] = Object.assign({}, A.nodes[id], { id, k, li: LAYER[A.nodes[id].layer].i });
  });
  // layer order, then the map's own order inside a layer
  const ALL = Object.keys(N).sort((a, b) => N[a].li - N[b].li || N[a].k - N[b].k);
  const isCode = (t) => /^[\x20-\x7e]+$/.test(t);

  // ---- relation kinds ----
  // Colour carries the family (blue: calls and returns, red: crossing into the OS / queues /
  // interrupts, ink: writes and reads); every kind also has its own shape, so colour is never alone.
  const KINDS = {
    call:    { name: '呼び出し', short: '呼ぶ', fam: 'step', verb: '呼ぶ' },
    return:  { name: '戻り・返事', short: '戻る・返事', fam: 'step', verb: '返す' },
    write:   { name: '値を書く', short: '書く', fam: 'step', verb: '書く' },
    read:    { name: '値を読む', short: '読む', fam: 'step', verb: '読む' },
    syscall: { name: 'syscall（アプリから OS へ）', short: 'syscall', fam: 'step', verb: 'OS に入る' },
    msg:     { name: '列を通す', short: '列を通す', fam: 'step', verb: '送る' },
    signal:  { name: '割り込み・通知', short: '割り込み・通知', fam: 'step', verb: '知らせる' },
    paper:   { name: '中の紙', short: '中の紙', fam: 'frame' },
    context: { name: '実行の文脈', short: '文脈', fam: 'frame' },
    shape:   { name: 'データの形', short: 'データの形', fam: 'shape' },
    mention: { name: '文の言及', short: '言及', fam: 'text' },
  };
  const STEP_KINDS = ['call', 'return', 'write', 'read', 'syscall', 'msg', 'signal'];
  const MORE_KINDS = ['paper', 'context', 'shape', 'mention'];
  const KIND_IDS = Object.keys(KINDS);
  // which mark wins when a cell holds several relations (the paper wash is drawn underneath)
  const PRIORITY = ['syscall', 'msg', 'signal', 'call', 'return', 'write', 'read', 'shape', 'context', 'mention'];

  // ---- walks: the two flows and the papers inside nodes ----
  // Stores, the hardware and data shapes do not act; a value taken out of them is read by the
  // node at the other end of the step.
  const PASSIVE = new Set(['store', 'hw', 'schema', 'enum']);
  const WALKS = [];
  const WALK = {};
  function mkWalk(w, type) {
    const box = Object.fromEntries(w.boxes.map((b) => [b.id, b]));
    let n = 0, a = 0;
    const steps = w.steps.map((st, i) => {
      const s = Object.assign({}, st, {
        i,
        no: st.alt ? null : ++n,
        altNo: st.alt ? 'ABCDEFGH'[a++] : null,
        fromNode: box[st.from].node,
        toNode: box[st.to].node,
        code: (CODE.steps[w.id] || {})[i] || null,
      });
      if (st.kind === 'data') s.rk = PASSIVE.has(N[s.fromNode].kind) && !PASSIVE.has(N[s.toNode].kind) ? 'read' : 'write';
      else s.rk = KINDS[st.kind] && KINDS[st.kind].fam === 'step' ? st.kind : 'call';
      s.rev = s.rk === 'read';                // drawn at the reader's row
      s.r = s.rev ? s.toNode : s.fromNode;    // the cell of the step: who acts (row) ...
      s.c = s.rev ? s.fromNode : s.toNode;    // ... on what (column)
      return s;
    });
    // stepping order: an alternative comes right after the step it replaces
    const order = [];
    steps.filter((x) => !x.alt).forEach((x) => {
      order.push(x.i);
      steps.filter((y) => y.alt && y.alt.at === x.i).forEach((y) => order.push(y.i));
    });
    steps.filter((y) => y.alt && !order.includes(y.i)).forEach((y) => order.push(y.i));
    const main = steps.filter((x) => !x.alt).length;
    const o = {
      id: w.id, type, title: w.title, tab: w.tab, boxes: w.boxes, box, steps, order,
      regions: w.regions || [], owner: type === 'paper' ? w.id : null, entry: w.entry || null, ports: w.ports || null,
      count: { main, alt: steps.length - main },
    };
    WALKS.push(o); WALK[o.id] = o;
    return o;
  }
  A.flows.forEach((f) => mkWalk(f, 'flow'));
  Object.values(A.papers).forEach((p) => mkWalk(p, 'paper'));
  const stepTag = (s) => (s.alt ? 'もし' + s.altNo : String(s.no));
  const walkName = (w) => (w.type === 'flow' ? w.tab : w.tab + ' の中');
  // one way to count steps everywhere: the main steps, then the alternatives
  const countText = (w) => `${w.count.main} 手順` + (w.count.alt ? `＋もし ${w.count.alt}` : '');
  // the step an alternative replaces
  const replaced = (w, s) => (s.alt && w.steps[s.alt.at]) || null;

  const RELS = [];
  function add(r) { r.id = RELS.length; r.fam = KINDS[r.k].fam; RELS.push(r); }

  // steps of the flows and papers, at (who acts, what it acts on)
  WALKS.forEach((w) => w.steps.forEach((st) => add({ k: st.rk, from: st.r, to: st.c, rev: st.rev, walk: w, step: st })));
  // a paper inside a node holds boxes of other nodes
  WALKS.filter((w) => w.type === 'paper').forEach((w) => w.boxes.forEach((b) => {
    if (b.node !== w.owner) add({ k: 'paper', from: w.owner, to: b.node, walk: w, box: b });
  }));
  // execution contexts are dashed frames around boxes of a flow
  WALKS.forEach((w) => w.regions.forEach((rg) => rg.boxes.forEach((bid) => {
    add({ k: 'context', from: rg.node, to: w.box[bid].node, walk: w, region: rg, box: w.box[bid] });
  })));
  // data shapes: what a store holds, a field's type, the shape a store is made of, and the value a
  // step carries (once per step, at the node that acts; not when only its address is handed over)
  const TYPE_BY_TITLE = {};
  ALL.forEach((id) => { if (N[id].kind === 'schema' || N[id].kind === 'enum') TYPE_BY_TITLE[N[id].title] = id; });
  WALKS.forEach((w) => w.boxes.forEach((b) => {
    if (b.slotSchema && N[b.slotSchema] && b.slotSchema !== b.node) add({ k: 'shape', sub: 'slot', from: b.node, to: b.slotSchema, walk: w, box: b });
  }));
  ALL.forEach((id) => (N[id].fields || []).forEach((f) => {
    const t = TYPE_BY_TITLE[f[0]];
    if (t && t !== id) add({ k: 'shape', sub: 'field', from: id, to: t, field: f });
  }));
  ALL.forEach((id) => { const of = N[id].shape && N[id].shape.of; if (of && N[of]) add({ k: 'shape', sub: 'of', from: id, to: of }); });
  WALKS.forEach((w) => w.steps.forEach((st) => {
    const d = st.data, sc = d && d.schema;
    if (!sc || !N[sc] || N[sc].layer !== 'contract' || st.r === sc) return;
    if (/^\s*&/.test(String(d.label || ''))) return;
    add({ k: 'shape', sub: 'step', from: st.r, to: sc, walk: w, step: st });
  }));
  // [[id]] links in a node's prose, its values, its parameters and its operations
  const LINK = /(!?)\[\[([^\]]+)\]\]/g;
  function sentences(text) {
    return String(text || '').split('\n').flatMap((line) => line.match(/[^。]+。?/g) || []).map((x) => x.trim()).filter(Boolean);
  }
  ALL.forEach((id) => {
    const n = N[id];
    sentences(n.text).forEach((sen) => {
      for (const m of sen.matchAll(LINK)) if (N[m[2]] && m[2] !== id) add({ k: 'mention', sub: m[1] ? 'embed' : 'text', from: id, to: m[2], text: sen });
    });
    (n.values || []).forEach((v) => { for (const m of String(v[1] || '').matchAll(LINK)) if (N[m[2]]) add({ k: 'mention', sub: 'value', from: id, to: m[2], text: v[1], key: v[0] }); });
    ((n.api && n.api.params) || []).forEach((p) => { for (const m of String(p[1] || '').matchAll(LINK)) if (N[m[2]]) add({ k: 'mention', sub: 'param', from: id, to: m[2], text: p[1], key: p[0] }); });
    (n.ops || []).forEach((o) => {
      const t = o.node || ((String(o.name).match(/\[\[([^\]]+)\]\]/) || [])[1]);
      if (t && N[t] && t !== id) add({ k: 'mention', sub: 'op', from: id, to: t, text: o.text, key: o.kind, op: o });
    });
  });
  // a step's own notes may name a node too; those belong to the step, not to a node, so they are
  // listed under the node they name but drawn in no cell
  const STEP_NOTES = [];
  WALKS.forEach((w) => w.steps.forEach((st) => {
    const texts = [];
    if (st.data && st.data.note) texts.push(['渡す値', st.data.note]);
    (st.branches || []).forEach((b) => texts.push(['分かれる', b[0] + ' → ' + b[1]]));
    texts.forEach(([what, t]) => { for (const m of t.matchAll(LINK)) if (N[m[2]]) STEP_NOTES.push({ to: m[2], walk: w, step: st, what, text: t }); });
  }));

  // ---- parts: nodes that appear only inside one paper fold into the paper's owner ----
  // (same layer, in no flow, owning no paper themselves); a figure embedded by one node of its
  // layer folds into that node.
  const inFlow = new Set(A.flows.flatMap((f) => f.boxes.map((b) => b.node)));
  const paperCount = {};
  Object.values(A.papers).forEach((p) => p.boxes.forEach((b) => { paperCount[b.node] = (paperCount[b.node] || 0) + 1; }));
  const PARTS = {};
  const OWNER = {};
  Object.values(A.papers).forEach((p) => p.boxes.forEach((b) => {
    const id = b.node;
    if (id === p.id || inFlow.has(id) || A.papers[id] || paperCount[id] !== 1 || OWNER[id]) return;
    if (N[id].layer !== N[p.id].layer) return;
    OWNER[id] = p.id; (PARTS[p.id] = PARTS[p.id] || []).push(id);
  }));
  ALL.forEach((id) => {
    if (N[id].kind !== 'figure' || OWNER[id]) return;
    const by = [...new Set(RELS.filter((r) => r.k === 'mention' && r.sub === 'embed' && r.to === id).map((r) => r.from))];
    if (by.length === 1 && N[by[0]].layer === N[id].layer && !OWNER[by[0]]) { OWNER[id] = by[0]; (PARTS[by[0]] = PARTS[by[0]] || []).push(id); }
  });
  // how to say what is folded: nodes of the paper, figures shown in the node, or both
  function partsPhrase(owner) {
    const ps = PARTS[owner] || [];
    const fig = ps.filter((id) => N[id].kind === 'figure').length;
    const paper = ps.length - fig;
    if (paper && fig) return `中の紙にだけ出る ${paper} 節と、この節に載る図 ${fig} 枚`;
    if (fig) return `この節に載る図 ${fig} 枚`;
    return `中の紙にだけ出る ${paper} 節`;
  }

  // ---- clusters (Louvain modularity on the visible, undirected graph) ----
  function louvain(nodes, edges) {
    // edges: Map "a|b" -> weight, a and b in nodes
    let level = nodes.map((n) => [n]);
    let adj = new Map(nodes.map((n, i) => [i, new Map()]));
    const index = new Map(nodes.map((n, i) => [n, i]));
    edges.forEach((w, key) => {
      const [a, b] = key.split('|').map((x) => index.get(x));
      if (a === b) { adj.get(a).set(a, (adj.get(a).get(a) || 0) + 2 * w); return; }
      adj.get(a).set(b, (adj.get(a).get(b) || 0) + w);
      adj.get(b).set(a, (adj.get(b).get(a) || 0) + w);
    });
    for (let pass = 0; pass < 8; pass++) {
      const ids = [...adj.keys()];
      const k = new Map(ids.map((i) => [i, [...adj.get(i).values()].reduce((s, x) => s + x, 0)]));
      const m2 = [...k.values()].reduce((s, x) => s + x, 0);
      if (!m2) break;
      const comm = new Map(ids.map((i) => [i, i]));
      const tot = new Map(ids.map((i) => [i, k.get(i)]));
      let moved = true, any = false, guard = 0;
      while (moved && guard++ < 50) {
        moved = false;
        for (const i of ids) {
          const ci = comm.get(i);
          const wTo = new Map();
          adj.get(i).forEach((w, j) => { if (j !== i) wTo.set(comm.get(j), (wTo.get(comm.get(j)) || 0) + w); });
          tot.set(ci, tot.get(ci) - k.get(i));
          let best = ci, bestGain = (wTo.get(ci) || 0) - (tot.get(ci) * k.get(i)) / m2;
          wTo.forEach((w, c) => { const g = w - (tot.get(c) * k.get(i)) / m2; if (g > bestGain + 1e-9) { best = c; bestGain = g; } });
          tot.set(best, tot.get(best) + k.get(i));
          if (best !== ci) { comm.set(i, best); moved = true; any = true; }
        }
      }
      if (!any) break;
      const cids = [...new Set(ids.map((i) => comm.get(i)))];
      const cidx = new Map(cids.map((c, x) => [c, x]));
      const nextLevel = cids.map(() => []);
      ids.forEach((i) => nextLevel[cidx.get(comm.get(i))].push(...level[i]));
      const nextAdj = new Map(cids.map((c, x) => [x, new Map()]));
      ids.forEach((i) => adj.get(i).forEach((w, j) => {
        const a = cidx.get(comm.get(i)), b = cidx.get(comm.get(j));
        nextAdj.get(a).set(b, (nextAdj.get(a).get(b) || 0) + w);
      }));
      level = nextLevel; adj = nextAdj;
    }
    return level;
  }

  // ---- the recorded run ----
  // The trace logs the entries into the functions it watched, the interrupts and the thread
  // switches; nothing else. Each event's `n` is the node that describes its function.
  const TRACE = (A.traces || [])[0] || null;
  const TRACE_N = {};    // node id -> entries
  const TRACE_FN = {};   // function -> entries
  const FN_NODE = {};    // function -> the node the trace ties it to
  const IRQ = {};        // interrupt cause -> count
  if (TRACE) TRACE.events.forEach((e) => {
    if (e.ev === 'enter') {
      if (e.fn) TRACE_FN[e.fn] = (TRACE_FN[e.fn] || 0) + 1;
      if (e.n) TRACE_N[e.n] = (TRACE_N[e.n] || 0) + 1;
      if (e.fn && e.n) FN_NODE[e.fn] = e.n;
    }
    if (e.ev === 'irq') (e.cause || []).forEach((c) => { IRQ[c] = (IRQ[c] || 0) + 1; });
  });
  // the run says how many functions it watched; when every one of them shows up, the functions
  // that never show up were not watched (rather than watched and not entered)
  const SEEN_FNS = Object.keys(TRACE_FN).length;
  const WATCHED_ALL = !!(TRACE && TRACE.run && TRACE.run.watching === SEEN_FNS);
  // a node for one statement or branch inside a function: the function node whose code holds it
  function hostFunction(id) {
    const n = N[id];
    if (n.kind !== 'func') return null;
    if (n.fn && FN_NODE[n.fn] && FN_NODE[n.fn] !== id) return FN_NODE[n.fn];
    if (n.fn) return null;
    const loc = CODE.nodes[id];
    if (!loc || loc.start == null) return null;
    let best = null, bestLen = Infinity;
    ALL.forEach((o) => {
      if (o === id || N[o].kind !== 'func' || !N[o].fn) return;
      const l = CODE.nodes[o];
      if (!l || l.path !== loc.path || l.start == null || l.start > loc.start || l.end < loc.end) return;
      const len = l.end - l.start;
      if (len < bestLen || (len === bestLen && FN_NODE[N[o].fn] === o)) { best = o; bestLen = len; }
    });
    return best;
  }
  // what the run can say about a node, as facts to be put into words by the page
  function traceOf(id) {
    if (!TRACE) return null;
    const n = N[id];
    if (TRACE_N[id]) return { type: 'func', k: TRACE_N[id], fn: n.fn };
    if (n.kind === 'func') {
      const host = hostFunction(id);
      if (host) return { type: 'part', host, fn: N[host].fn, k: TRACE_N[host] || TRACE_FN[N[host].fn] || 0, watched: !!TRACE_FN[N[host].fn] };
      if (n.fn) return { type: 'unwatched', fn: n.fn, sure: WATCHED_ALL };
      return null;
    }
    if (n.kind === 'figure' || n.kind === 'note' || n.kind === 'schema' || n.kind === 'enum') return null;
    // a store, the hardware or an execution context: the functions the map ties to it
    const near = new Map();
    RELS.forEach((r) => {
      const ok = n.kind === 'context' ? r.k === 'context' && r.from === id : r.fam === 'step' && (r.from === id || r.to === id);
      if (!ok) return;
      const other = r.from === id ? r.to : r.from;
      if (other === id || N[other].kind !== 'func') return;
      const fnNode = TRACE_N[other] ? other : hostFunction(other);
      if (fnNode && TRACE_N[fnNode]) near.set(fnNode, TRACE_N[fnNode]);
      else if (N[other].fn && !TRACE_FN[N[other].fn]) near.set(other, 0);
    });
    const irq = n.kind === 'hw' ? Object.keys(IRQ).filter((c) => id.split(/[.-]/).includes(c)).map((c) => [c, IRQ[c]]) : [];
    return { type: 'near', context: n.kind === 'context', near: [...near.entries()], irq };
  }

  window.MX = {
    A, CODE, LAYERS, LAYER, N, ALL, isCode, WALKS, WALK, stepTag, walkName, countText, replaced,
    KINDS, KIND_IDS, STEP_KINDS, MORE_KINDS, PRIORITY, RELS, STEP_NOTES, PARTS, OWNER, partsPhrase, LINK, sentences, louvain,
    TRACE, TRACE_N, TRACE_FN, IRQ, SEEN_FNS, WATCHED_ALL, traceOf, hostFunction,
  };
})();
