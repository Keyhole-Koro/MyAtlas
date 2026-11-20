// 次のビューア — the shared model: tracks (flows and the papers inside nodes), step paths into
// papers, execution contexts, what the record says, and the one state every view reads.
// No view code here. window.NX.
(function () {
  'use strict';
  const A = window.ATLAS, C = window.ATLAS_CODE || { nodes: {}, steps: {}, files: {} };
  const NX = (window.NX = { A, C });

  // ---------------------------------------------------------------- small helpers
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  NX.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  NX.$ = (s, el = document) => el.querySelector(s);
  NX.$$ = (s, el = document) => [...el.querySelectorAll(s)];
  NX.fmt = (n) => Math.round(Number(n)).toLocaleString('ja-JP');
  NX.isAscii = (s) => /^[\x20-\x7e]+$/.test(String(s || ''));
  NX.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  NX.reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  NX.FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
  NX.MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", "Noto Sans Mono CJK JP", monospace';
  const measureCtx = document.createElement('canvas').getContext('2d');
  const wCache = new Map();
  NX.textW = (s, size = 13, weight = 400, mono = false) => {
    const k = `${size}|${weight}|${mono ? 1 : 0}|${s}`;
    let w = wCache.get(k);
    if (w == null) {
      measureCtx.font = `${weight} ${size}px ${mono ? NX.MONO : NX.FONT}`;
      w = measureCtx.measureText(String(s)).width;
      wCache.set(k, w);
    }
    return w;
  };
  // try/catch around every storage: an opaque origin throws, and nothing here needs it
  NX.store = {
    get(k) { try { return window.localStorage.getItem('nx:' + k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) window.localStorage.removeItem('nx:' + k); else window.localStorage.setItem('nx:' + k, v); } catch (e) { /* no storage */ } },
  };

  // ---------------------------------------------------------------- words
  NX.KIND_STEP = { call: '呼び出し', syscall: 'syscall', msg: '列を通す', signal: '割り込み・通知', data: '読み書き', return: '戻り・返事' };
  NX.KIND_NODE = { func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙', context: '実行の文脈', note: '方針', figure: '図' };
  NX.LAYER = Object.fromEntries(A.layers.map((l) => [l.id, l]));
  NX.STACK = A.layers.filter((l) => !l.cross).map((l) => l.id);
  NX.layerVar = (layer) => `var(--l-${NX.LAYER[layer] ? layer : 'contract'})`;
  NX.layerText = (layer) => `var(--lt-${NX.LAYER[layer] ? layer : 'contract'})`;
  NX.layerName = (layer) => (NX.LAYER[layer] || {}).name || '';
  NX.node = (id) => A.nodes[id] || null;
  NX.title = (id) => (A.nodes[id] ? A.nodes[id].title : id);

  // The shape of each kind of arrow, used everywhere an arrow is drawn: a dash pattern, an open or a
  // filled head, and a mark at the tail (the gate of a syscall, the dot of a read or write).
  NX.ARROW = {
    call: { dash: '', head: 'fill', w: 1.6 },
    syscall: { dash: '', head: 'fill', w: 2.4, gate: true },
    msg: { dash: '7 3 1.5 3', head: 'open', w: 1.6 },
    signal: { dash: '1.5 3.5', head: 'open', w: 1.8, bolt: true },
    data: { dash: '4 3', head: 'open', w: 1.5, dot: true },
    return: { dash: '5 4', head: 'open', w: 1.5 },
  };
  // A small icon of a kind of arrow (18 × 10).
  NX.kindIcon = (k) => {
    const a = NX.ARROW[k] || NX.ARROW.call;
    const dash = a.dash ? ` stroke-dasharray="${a.dash.split(' ').map((x) => x * 0.7).join(' ')}"` : '';
    let s = `<svg class="ki" viewBox="0 0 18 10" aria-hidden="true"><path d="M${a.gate || a.dot ? 4 : 1} 5H13"${dash} style="stroke-width:${a.w * 0.85}"/>`;
    s += a.head === 'fill' ? '<path class="f" d="M12 1.8 17 5l-5 3.2z"/>' : '<path d="M12.6 2 16.6 5l-4 3"/>';
    if (a.gate) s += '<rect class="f" x="0.5" y="2.5" width="5" height="5" rx="1"/>';
    if (a.dot) s += '<circle class="o" cx="2.6" cy="5" r="2.1" style="stroke:currentColor;stroke-width:1.2"/>';
    return s + '</svg>';
  };
  NX.ICON = {
    paper: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5M6 8h4.5M6 10.5h4.5"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect fill="currentColor" x="4" y="3" width="3" height="10" rx="1"/><rect fill="currentColor" x="9" y="3" width="3" height="10" rx="1"/></svg>',
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>',
    dive: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v6a2 2 0 0 0 2 2h8"/><path d="m10 8 3 3-3 3"/></svg>',
    out: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 13V7a2 2 0 0 0-2-2H3"/><path d="m6 2-3 3 3 3"/></svg>',
    replay: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.6v3h3"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    code: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="m10.5 10.5 3.6 3.6"/></svg>',
    sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z"/></svg>',
    auto: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2a5.6 5.6 0 0 0 0-11.2z" fill="currentColor"/></svg>',
    help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.7c-.5.2-.8.6-.8 1.1v.4"/><circle cx="8" cy="11.6" r=".5" fill="currentColor"/></svg>',
    walk: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="3.5" cy="12.5" r="1.8"/><circle cx="12.5" cy="3.5" r="1.8"/><path d="M5.2 11.8c3-1 2.6-4 5.6-6.6" stroke-dasharray="2 2"/></svg>',
  };

  // ---------------------------------------------------------------- tracks: the flows and the papers inside nodes
  const TR = (NX.TR = {});
  function makeTrack(src, id, kind) {
    const t = { id, kind, src, title: src.title, tab: src.tab, steps: src.steps, boxes: src.boxes, bands: src.bands || null, regions: src.regions || [] };
    t.box = Object.fromEntries(src.boxes.map((b) => [b.id, b]));
    let n = 0, a = 0;
    t.labels = src.steps.map((s) => (s.alt ? 'ABCDEFGH'[a++] : String(++n)));
    t.main = src.steps.map((s, i) => (s.alt ? -1 : i)).filter((i) => i >= 0);
    t.alts = {};
    src.steps.forEach((s, i) => { if (s.alt) (t.alts[s.alt.at] = t.alts[s.alt.at] || []).push(i); });
    t.counts = { main: t.main.length, alt: src.steps.length - t.main.length };
    return t;
  }
  A.flows.forEach((f) => { TR[f.id] = makeTrack(f, f.id, 'flow'); });
  Object.entries(A.papers || {}).forEach(([id, p]) => { TR[id] = makeTrack(p, id, 'paper'); });
  NX.FLOWS = A.flows.map((f) => f.id);
  NX.countText = (t) => `${t.counts.main} 手順` + (t.counts.alt ? `＋もし ${t.counts.alt}` : '');

  // the node a paper is drawn inside
  NX.hostNode = (paperId) => Object.keys(A.nodes).find((id) => A.nodes[id].paper === paperId) || paperId;
  // The paper one enters from step i: the paper inside the box the step reaches.
  NX.paperOf = (t, i) => {
    const s = t && t.steps[i];
    const n = s && A.nodes[t.box[s.to].node];
    return n && n.paper && TR[n.paper] && n.paper !== t.id ? n.paper : null;
  };
  NX.isStart = (t, i) => t.kind === 'flow' && Array.isArray(t.src.start) && t.src.start[0] === i;
  NX.startIndex = (t) => (t.kind === 'flow' && Array.isArray(t.src.start) ? t.src.start[0] : null);
  NX.stepTitle = (s) => s.verb || s.label || NX.KIND_STEP[s.kind] || s.kind;
  NX.boxName = (b) => b.short || b.title;
  NX.boxLayer = (t, b) => {
    if (t.kind === 'flow') return b.layer;
    const band = (t.bands || []).find((x) => x.id === b.layer);
    return band ? band.tone : (A.nodes[b.node] || {}).layer || 'os';
  };
  NX.trackTone = (t) => (t.kind === 'paper' ? (A.nodes[NX.hostNode(t.id)] || {}).layer || 'os' : 'os');
  NX.trackName = (t) => (t.kind === 'flow' ? t.tab : t.title);

  // ---------------------------------------------------------------- step paths: [{id, i}, ...] from a flow into papers
  const clone = (st) => st.map((f) => ({ id: f.id, i: f.i }));
  NX.cloneStack = clone;
  NX.stackKey = (st) => st.map((f) => `${f.id}:${f.i}`).join('/');
  NX.parseStack = (str) => {
    if (!str) return null;
    const frames = [];
    for (const part of String(str).split('/')) {
      const k = part.lastIndexOf(':');
      const id = part.slice(0, k), i = Number(part.slice(k + 1));
      const t = TR[id];
      if (!t || !Number.isInteger(i) || i < 0 || i >= t.steps.length) return null;
      if (!frames.length && t.kind !== 'flow') return null;
      if (frames.length) { const pf = frames[frames.length - 1]; if (NX.paperOf(TR[pf.id], pf.i) !== id) return null; }
      frames.push({ id, i });
    }
    return frames.length ? frames : null;
  };
  NX.topOf = (st) => st[st.length - 1];
  NX.stepOf = (st) => { const f = st[st.length - 1]; return TR[f.id].steps[f.i]; };
  NX.firstStack = (flowId) => [{ id: flowId, i: TR[flowId].main[0] }];
  // the main step a step stands for: itself, or the one an alternative replaces
  NX.mainOf = (t, i) => (t.steps[i].alt ? t.steps[i].alt.at : i);
  NX.nextStack = (stack) => {
    const st = clone(stack);
    for (let lv = st.length - 1; lv >= 0; lv--) {
      const f = st[lv], t = TR[f.id];
      const pos = t.main.indexOf(NX.mainOf(t, f.i));
      if (pos + 1 < t.main.length) { st.length = lv + 1; f.i = t.main[pos + 1]; return st; }
    }
    return null;
  };
  NX.prevStack = (stack) => {
    const st = clone(stack);
    const lv = st.length - 1, f = st[lv], t = TR[f.id], s = t.steps[f.i];
    if (s.alt) { f.i = s.alt.at; return st; }
    const pos = t.main.indexOf(f.i);
    if (pos > 0) { f.i = t.main[pos - 1]; return st; }
    if (lv > 0) { st.pop(); return st; }
    return null;
  };
  NX.diveStack = (stack) => {
    const f = stack[stack.length - 1], p = NX.paperOf(TR[f.id], f.i);
    return p ? [...clone(stack), { id: p, i: TR[p].main[0] }] : null;
  };
  NX.outStack = (stack) => (stack.length > 1 ? clone(stack).slice(0, -1) : null);
  // Every step, into every paper once and out again (the guided walk).
  NX.walkFrom = (stack) => {
    const st = clone(stack), seq = [clone(st)], dived = new Set(st.slice(1).map((f) => f.id));
    for (let guard = 0; guard < 400; guard++) {
      const f = st[st.length - 1], paper = NX.paperOf(TR[f.id], f.i);
      if (paper && !dived.has(paper)) { dived.add(paper); st.push({ id: paper, i: TR[paper].main[0] }); }
      else {
        const nx = NX.nextStack(st);
        if (!nx) break;
        st.length = 0; st.push(...nx);
      }
      seq.push(clone(st));
    }
    return seq;
  };
  // A path to any step of any track: a paper is entered from the first step of a flow that reaches
  // its box (Tasks.tick is reached from both flows, so each flow keeps its own way in).
  const entries = {};   // flow id -> paper id -> path of the step that enters it
  (function findEntries() {
    for (const flow of NX.FLOWS) {
      const mine = (entries[flow] = {});
      const visit = (stack) => {
        const f = stack[stack.length - 1], t = TR[f.id];
        t.steps.forEach((s, i) => {
          const p = NX.paperOf(t, i);
          if (p && !mine[p] && !stack.some((x) => x.id === p)) {
            const here = [...clone(stack.slice(0, -1)), { id: f.id, i }];
            mine[p] = here;
            visit([...here, { id: p, i: TR[p].main[0] }]);
          }
        });
      };
      visit([{ id: flow, i: 0 }]);
    }
  })();
  NX.stackOfStep = (trackId, i, preferFlow) => {
    const t = TR[trackId];
    if (!t || i == null || i < 0 || i >= t.steps.length) return null;
    if (t.kind === 'flow') return [{ id: trackId, i }];
    const flows = [preferFlow || state.stack[0].id, ...NX.FLOWS];
    for (const f of flows) {
      const e = entries[f] && entries[f][trackId];
      if (e) return [...clone(e), { id: trackId, i }];
    }
    return null;
  };
  NX.flowsOfPaper = (paperId) => NX.FLOWS.filter((f) => entries[f] && entries[f][paperId]);
  NX.paperEntry = (paperId, preferFlow) => NX.stackOfStep(paperId, TR[paperId].main[0], preferFlow);
  // the flow a stack belongs to
  NX.flowOf = (stack) => stack[0].id;

  // ---------------------------------------------------------------- execution contexts (the dashed frames)
  NX.regionOf = (t, boxId) => (t.regions || []).find((r) => r.boxes.includes(boxId)) || null;
  // Around each step of a flow: the frame of the box that acts, else the frame the walk is already in.
  // A place such as the request ring has no frame; the code that touches it keeps its frame.
  const ctxMemo = {};
  NX.stepContexts = (t) => {
    if (ctxMemo[t.id]) return ctxMemo[t.id];
    const out = {};
    let cur = null;
    for (const i of t.main) {
      const st = t.steps[i];
      const a = NX.regionOf(t, st.from) || cur, b = NX.regionOf(t, st.to) || a;
      out[i] = { a, b };
      for (const ai of t.alts[i] || []) {
        const x = t.steps[ai];
        const aa = NX.regionOf(t, x.from) || a;
        out[ai] = { a: aa, b: NX.regionOf(t, x.to) || aa };
      }
      cur = b;
    }
    return (ctxMemo[t.id] = out);
  };
  // The context a step's code runs in, and where it goes. In a paper: the frame around the box the
  // paper is drawn in (no change inside it).
  NX.contextOf = (stack) => {
    const lv = stack.length - 1, f = stack[lv], t = TR[f.id];
    if (t.kind === 'flow') return NX.stepContexts(t)[f.i] || { a: null, b: null };
    for (let k = lv - 1; k >= 0; k--) {
      const pf = stack[k], pt = TR[pf.id];
      if (pt.kind === 'flow') { const c = NX.stepContexts(pt)[pf.i] || {}; return { a: c.b || null, b: c.b || null, inherited: true }; }
    }
    return { a: null, b: null };
  };
  NX.ctxShort = (r) => r.label3 || String(r.label).replace(/（[^）]*）$/, '');
  NX.ctxNote = (r) => (String(r.label).match(/（([^）]*)）$/) || [])[1] || '';

  // ---------------------------------------------------------------- what the record says (one model for every view)
  // The trace model of trace-timeline (lib/trace-model.js over data/trace-full.js), built once. The walk
  // card and the 記録 view read the same numbers from it: how often a step happened (its matching), and
  // how often a function was entered, split by the context the entry ran in.
  NX.TRACE = (A.traces || [])[0] || null;
  let TMODEL = null;
  NX.traceModel = () => {
    if (!TMODEL && window.TRACEM && window.TRACE_FULL) TMODEL = window.TRACEM.buildModel(A, window.TRACE_FULL);
    return TMODEL;
  };
  NX.threadName = (tid) => (NX.TRACE && NX.TRACE.threads[String(tid)]) || String(tid);
  // The context an entry ran in: the trap around it decides (OS_CALL, another syscall, an interrupt);
  // outside a trap, an app's thread is the app's own code and a kernel thread is a service task.
  function sliceCtx(M, s) {
    let p = s.parent;
    while (p !== null && M.slices[p].kind !== 'irq') p = M.slices[p].parent;
    if (p !== null) {
      const q = M.slices[p];
      if (q.trap === 'syscall') return q.syscall === 'OS_CALL' ? 'ctx.syscall' : 'sys:' + (q.syscall || '?');
      return 'ctx.irq';
    }
    if (s.tid < 0) return 'idle';
    const th = M.threadById.get(s.tid);
    return th && th.kind === 'app' ? 'ctx.user' : 'ctx.service';
  }
  const CTX_WORD = { 'ctx.user': 'アプリの中', 'ctx.syscall': 'OS_CALL の中', 'ctx.service': 'service task', 'ctx.irq': '割り込みの中', idle: '走るもの無し' };
  NX.ctxWord = (k) => CTX_WORD[k] || (k.startsWith('sys:') ? k.slice(4) + ' の中' : k);
  // The step as the record has it: {times, how, hits, absent, ...} — the 記録 view outlines these hits.
  NX.stepRecord = (stack) => {
    const M = NX.traceModel();
    if (!M) return null;
    const f = stack[stack.length - 1], t = TR[f.id];
    const owner = t.kind === 'paper' ? NX.hostNode(t.id) : null;
    const r = window.TRACEM.stepHits(M, t.steps[f.i], t.boxes, owner);
    r.count = r.times || r.hits.length;
    return r;
  };
  // A function node in the record: {fn, watched, count (in ctx), other: [[ctx, n]], total}.
  NX.fnRecord = (nodeId, ctx) => {
    const M = NX.traceModel(), n = A.nodes[nodeId];
    if (!M || !n || n.kind !== 'func') return null;
    const own = M.slices.find((s) => s.n === nodeId);
    const fn = own ? own.fn : n.fn;
    if (!fn) return null;
    const watched = !!(M.RAW.watched || {})[fn];
    const all = M.slices.filter((s) => s.kind === 'call' && s.fn === fn);
    const by = new Map();
    for (const s of all) { const k = sliceCtx(M, s); by.set(k, (by.get(k) || 0) + 1); }
    const count = ctx ? by.get(ctx) || 0 : all.length;
    const other = [...by].filter(([k]) => !ctx || k !== ctx).sort((a, b) => b[1] - a[1]);
    return { fn, watched, count, ctx, other, total: all.length };
  };
  // The frame a node's box sits in, in the flow of a step path (the context its code runs in).
  NX.ctxOfNode = (stack, nodeId) => {
    const flow = TR[stack[0].id];
    for (const b of flow.boxes) if (b.node === nodeId) { const r = NX.regionOf(flow, b.id); if (r) return r; }
    return null;
  };

  // ---------------------------------------------------------------- text with [[links]]
  NX.parts = (s) => {
    const out = [];
    let last = 0;
    const text = String(s || '');
    for (const m of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
      if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
      out.push({ t: m[1] ? 'embed' : 'link', id: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
    return out;
  };
  NX.plain = (s) => NX.parts(String(s || '').replace(/\[\[([^\]]+)\]\] の ([A-Za-z_]\w*)/g, (m, id, w) => (A.nodes[id] && A.nodes[id].title.endsWith('.' + w) ? `[[${id}]]` : m)))
    .map((p) => (p.t === 'text' ? p.s : p.t === 'link' ? NX.title(p.id) : '')).join('').trim();
  // a text cut to a width, with an ellipsis
  NX.clipText = (s, max, size = 12, weight = 400, mono = false) => {
    s = String(s || '');
    if (NX.textW(s, size, weight, mono) <= max) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (NX.textW(s.slice(0, m) + '…', size, weight, mono) <= max) lo = m; else hi = m - 1; }
    return lo > 0 ? s.slice(0, lo) + '…' : '';
  };
  // A node as a chip, in its layer's colour. "[[os.ui-protocol]] の handle" reads as one name.
  NX.nodeChip = (id, opt = {}) => {
    const n = A.nodes[id];
    if (!n) return NX.esc(id);
    const name = opt.label || n.title;
    return `<button type="button" class="chip${NX.isAscii(name) ? ' code' : ''}" data-node="${NX.esc(id)}" style="--lc:${NX.layerVar(n.layer)}"><span>${NX.esc(name)}</span></button>`;
  };
  NX.linkify = (text, opt = {}) => NX.esc(text || '')
    .replace(/!?\[\[([^\]]+)\]\]( の ([A-Za-z_]\w*))?/g, (m, id, tail, word) => {
      const n = A.nodes[id];
      if (!n) return NX.esc(id) + (tail || '');
      const chip = NX.nodeChip(id);
      return word && n.title.endsWith('.' + word) ? chip : chip + (tail || '');
    })
    .replace(/\n/g, opt.br === false ? ' ' : '<br>');
  // opt.span: inside a button (a button may not hold another)
  NX.boxChip = (t, b, opt = {}) => {
    const name = NX.boxName(b);
    const tag = opt.span ? 'span' : 'button';
    return `<${tag}${opt.span ? '' : ' type="button"'} class="chip${NX.isAscii(name) ? ' code' : ''}"${opt.span ? '' : ` data-node="${NX.esc(b.node)}"`} style="--lc:${NX.layerVar(NX.boxLayer(t, b))}" title="${NX.esc(b.title + (b.ns ? '（' + b.ns + '）' : ''))}"><span>${NX.esc(name)}</span></${tag}>`;
  };

  // ---------------------------------------------------------------- the one state, kept in the address
  // view: walk | map | seq | trace | data. stack: the step path. node: the node card. open: papers opened
  // in やりとり beyond the path. Everything a link should carry is here.
  NX.VIEWS = [
    { id: 'walk', name: '歩く' },
    { id: 'map', name: '地図' },
    { id: 'seq', name: 'やりとり' },
    { id: 'trace', name: '記録' },
    { id: 'data', name: 'データ' },
  ];
  const state = (NX.state = { view: 'walk', stack: NX.firstStack(NX.FLOWS[0]), node: null, open: [], touched: false, line: null });
  const lastStack = {};   // per flow, the place the reader left it
  const listeners = [];
  NX.on = (fn) => listeners.push(fn);
  function toHash() {
    const p = new URLSearchParams();
    p.set('v', state.view);
    p.set('s', NX.stackKey(state.stack));
    if (state.node) p.set('n', state.node);
    if (state.open.length) p.set('o', state.open.join(','));
    if (state.line) p.set('l', state.line);
    return '#' + p.toString().replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',');
  }
  function fromHash() {
    const h = location.hash.slice(1);
    if (!h) return null;
    const p = new URLSearchParams(h);
    const out = {};
    const v = p.get('v');
    if (NX.VIEWS.some((x) => x.id === v)) out.view = v;
    const st = NX.parseStack(p.get('s'));
    if (st) out.stack = st;
    const n = p.get('n');
    out.node = n && A.nodes[n] ? n : null;
    out.open = (p.get('o') || '').split(',').filter(Boolean);
    const l = p.get('l');
    out.line = l && TR[l] ? l : null;
    return out;
  }
  function writeHash(push) {
    const h = toHash();
    if (location.hash === h) return;
    try {
      if (push) history.pushState(null, '', h); else history.replaceState(null, '', h);
    } catch (e) {
      if (push) location.hash = h; // the address must still carry the state
    }
  }
  function emit(changed, why) { for (const fn of listeners) fn(changed, why || {}); }
  // set({view, stack, node, open}, {push, quiet, source}): one change, written to the address once.
  NX.set = (patch, opt = {}) => {
    const changed = {};
    if (patch.stack) {
      const was = NX.stackKey(state.stack), now = NX.stackKey(patch.stack);
      if (was !== now) { changed.stack = true; if (patch.stack[0].id !== state.stack[0].id) changed.flow = true; }
      state.stack = clone(patch.stack);
      lastStack[state.stack[0].id] = clone(state.stack);
    }
    if ('view' in patch && patch.view !== state.view) { state.view = patch.view; changed.view = true; }
    if ('node' in patch && patch.node !== state.node) { state.node = patch.node; changed.node = true; }
    if ('open' in patch && patch.open.join(',') !== state.open.join(',')) { state.open = [...patch.open]; changed.open = true; }
    if ('line' in patch && patch.line !== state.line) { state.line = patch.line; changed.line = true; }
    if (opt.touch !== false && changed.stack && opt.source !== 'play') state.touched = true;
    // a step chosen anywhere (map, search, a card, a table) ends the guided walk
    if (changed.stack && opt.source !== 'play' && NX.walk && NX.walk.playing()) NX.walk.stopPlay();
    if (!Object.keys(changed).length && !opt.force) return changed;
    writeHash(!!opt.push);
    emit(changed, opt);
    return changed;
  };
  NX.setFlow = (flowId, opt = {}) => {
    const st = opt.first ? NX.firstStack(flowId) : lastStack[flowId] || NX.firstStack(flowId);
    NX.set({ stack: st, open: [], line: null }, { push: true, ...opt });
  };
  NX.readHash = () => {
    const h = fromHash();
    if (!h) return false;
    const changed = {};
    if (h.view && h.view !== state.view) { state.view = h.view; changed.view = true; }
    if (h.stack && NX.stackKey(h.stack) !== NX.stackKey(state.stack)) {
      if (h.stack[0].id !== state.stack[0].id) changed.flow = true;
      state.stack = h.stack; lastStack[h.stack[0].id] = clone(h.stack); changed.stack = true;
      state.touched = true;
    }
    if (h.node !== state.node) { state.node = h.node; changed.node = true; }
    if (h.open.join(',') !== state.open.join(',')) { state.open = h.open; changed.open = true; }
    if (h.line !== state.line) { state.line = h.line; changed.line = true; }
    return changed;
  };
  NX.writeHash = writeHash;
  NX.emit = emit;
})();
