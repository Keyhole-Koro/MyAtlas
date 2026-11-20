/* model.js — indices over the atlas: links, backlinks, where a node appears in flows, graph edges, search. */
(function () {
  'use strict';
  const A = window.ATLAS;
  const C = window.ATLAS_CODE || { nodes: {}, steps: {}, files: {} };
  const NODES = A.nodes;
  const IDS = Object.keys(NODES);
  const LAYERS = A.layers.map((l, i) => {
    // the contract layer's sub is two notes joined by ）（ in the data; show both parts
    const subs = String(l.sub || '').split('）（').map((s) => s.replace(/^（|）$/g, '').trim()).filter(Boolean);
    return { ...l, rank: i, subs };
  });
  const LAYER = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
  const STACK = LAYERS.filter((l) => !l.cross);
  const CROSS = LAYERS.filter((l) => l.cross);
  const FLOWS = A.flows;
  const PAPERS = A.papers;
  const ALLP = [...FLOWS, ...Object.values(PAPERS)];
  const P = Object.fromEntries(ALLP.map((p) => [p.id, p]));
  const isFlow = (p) => FLOWS.includes(p);
  const TRACES = A.traces || [];

  const KIND = { func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙', context: '実行の文脈', note: '方針', figure: '図' };
  const STEP_KIND = { call: '呼び出し', syscall: 'syscall', return: '戻り', signal: '通知', msg: '列を通す', data: '読み書き' };
  const ROLE = { from: 'ここから', to: 'ここへ', ref: '説明', data: '渡る', op: '操作' };

  // "もしA" for the steps that happen instead of another one
  for (const p of ALLP) { let n = 0; for (const st of p.steps) if (st.alt) st.alt.no = 'ABCDEFGH'[n++]; }
  const stepNo = (st, i) => (st.alt ? `もし${st.alt.no}` : String(i + 1));
  const mainSteps = (p) => p.steps.map((st, i) => ({ st, i })).filter((x) => !x.st.alt);
  const altsAt = (p, i) => p.steps.map((st, k) => ({ st, i: k })).filter((x) => x.st.alt && x.st.alt.at === i);
  const boxById = (p, id) => p.boxes.find((b) => b.id === id);
  const pTitle = (p) => (isFlow(p) ? p.tab : p.title || `${p.tab} の中`);
  const pLabel = (p) => (isFlow(p) ? `「${p.tab}」` : `${p.tab} の中`);

  const LINK_RE = /(!?)\[\[([\w.\-]+)\]\]/g;
  const linksIn = (s) => [...String(s || '').matchAll(LINK_RE)].map((m) => ({ id: m[2], embed: m[1] === '!' }));
  const plain = (s) => String(s || '').replace(LINK_RE, (m, b, id) => (NODES[id] ? NODES[id].title : id));
  // sentences: split at line ends and at 。, keeping the 。
  const sentences = (s) => String(s || '').split('\n').flatMap((para) => para.match(/[^。]+。?/g) || []).map((x) => x.trim()).filter(Boolean);
  const firstSentence = (s) => sentences(String(s || '').replace(/^!\[\[[^\]]+\]\]$/gm, ''))[0] || '';

  // type names in signatures and fields point at the node that defines the shape
  const SCHEMA_BY_NAME = Object.fromEntries(IDS.filter((k) => NODES[k].kind === 'schema' || NODES[k].kind === 'enum').map((k) => [NODES[k].title, k]));
  const typeNamesIn = (s) => [...new Set((String(s || '').match(/\b[A-Z][A-Za-z]*\b/g) || []).filter((w) => SCHEMA_BY_NAME[w]))].map((w) => SCHEMA_BY_NAME[w]);

  // ---- every place a node's own words live, with a label for "where" ----
  function textParts(n) {
    const parts = [];
    if (n.text) parts.push({ where: 'text', label: '', s: n.text });
    if (n.api) {
      for (const [k, v] of n.api.params || []) parts.push({ where: 'param', label: `引数 ${k}`, s: v });
      if (n.api.ret) parts.push({ where: 'ret', label: '返す', s: n.api.ret });
    }
    for (const f of n.fields || []) if (f[2]) parts.push({ where: 'field', label: `フィールド ${f[1]}`, s: f[2] });
    for (const v of n.values || []) if (v[1]) parts.push({ where: 'value', label: `値 ${v[0]}`, s: v[1] });
    for (const o of n.ops || []) parts.push({ where: 'op', label: `操作`, s: `${o.name}：${o.text}` });
    for (const inv of n.invariants || []) parts.push({ where: 'inv', label: 'いつも成り立つこと', s: inv });
    return parts;
  }
  function stepParts(st) {
    const parts = [{ where: 'step', label: '', s: st.label || '' }];
    if (st.data && st.data.note) parts.push({ where: 'note', label: '渡す値', s: st.data.note });
    for (const [cond, to] of st.branches || []) parts.push({ where: 'branch', label: `分かれる：${cond}`, s: to });
    return parts;
  }

  // ---- backlinks: who points here, and the sentence that does ----
  const BACK = Object.fromEntries(IDS.map((k) => [k, []]));
  const pushBack = (to, rec) => {
    if (!BACK[to]) return;
    const key = JSON.stringify([rec.from || '', rec.p || '', rec.i == null ? '' : rec.i, rec.sentence]);
    if (BACK[to].some((r) => r._k === key)) return;
    BACK[to].push({ ...rec, _k: key });
  };
  for (const k of IDS) {
    for (const part of textParts(NODES[k])) {
      for (const sen of sentences(part.s)) {
        for (const l of linksIn(sen)) {
          if (l.id === k) continue;
          const embedOnly = /^!\[\[[\w.\-]+\]\]$/.test(sen);
          pushBack(l.id, { from: k, where: part.where, label: part.label, sentence: embedOnly ? '' : sen, embed: l.embed });
        }
      }
    }
  }
  for (const p of ALLP) {
    p.steps.forEach((st, i) => {
      for (const part of stepParts(st)) {
        for (const sen of sentences(part.s)) for (const l of linksIn(sen)) pushBack(l.id, { p: p.id, i, where: part.where, label: part.label, sentence: sen });
      }
    });
  }
  // shapes borrowed, and types used in signatures and fields
  const SHAPE_USERS = Object.fromEntries(IDS.map((k) => [k, []]));
  const TYPE_USERS = Object.fromEntries(IDS.map((k) => [k, []]));
  for (const k of IDS) {
    const n = NODES[k];
    if (n.shape && n.shape.of && SHAPE_USERS[n.shape.of]) SHAPE_USERS[n.shape.of].push(k);
    const seen = new Set();
    if (n.api) for (const t of typeNamesIn(n.api.sig)) if (t !== k && !seen.has(t)) { seen.add(t); TYPE_USERS[t].push({ from: k, where: 'sig' }); }
    if (n.kind !== 'hw') for (const f of n.fields || []) for (const t of typeNamesIn(f[0])) if (t !== k && !seen.has(t)) { seen.add(t); TYPE_USERS[t].push({ from: k, where: 'field', label: f[1] }); }
  }
  // every node that points here, each counted once: by a link in its words, by using it as a type, by borrowing its shape
  const POINTERS = Object.fromEntries(IDS.map((k) => [k, new Set([...BACK[k].filter((b) => b.from).map((b) => b.from), ...TYPE_USERS[k].map((t) => t.from), ...SHAPE_USERS[k]])]));

  // ---- where a node appears in flows and papers ----
  const OCC = Object.fromEntries(IDS.map((k) => [k, []]));
  const PAPER_HOSTS = Object.fromEntries(IDS.map((k) => [k, []])); // papers this node is drawn inside
  const CTX_MEMBERS = {}; // context node → [{p, region, boxes}]
  for (const p of ALLP) {
    const byNode = new Map();
    const get = (nid) => {
      if (!NODES[nid]) return null;
      if (!byNode.has(nid)) byNode.set(nid, { p: p.id, boxes: p.boxes.filter((b) => b.node === nid).map((b) => b.id), steps: new Map(), region: null, slot: false });
      return byNode.get(nid);
    };
    const add = (o, i, role) => { if (!o) return; if (!o.steps.has(i)) o.steps.set(i, new Set()); o.steps.get(i).add(role); };
    for (const b of p.boxes) get(b.node);
    p.steps.forEach((st, i) => {
      add(get(boxById(p, st.from).node), i, 'from');
      add(get(boxById(p, st.to).node), i, 'to');
      if (st.ref) add(get(st.ref), i, 'ref');
      if (st.data && st.data.schema) add(get(st.data.schema), i, 'data');
      for (const o of st.ops || []) add(get(o.node), i, 'op');
    });
    for (const r of p.regions || []) {
      const o = get(r.node);
      if (o) o.region = r;
      (CTX_MEMBERS[r.node] = CTX_MEMBERS[r.node] || []).push({ p: p.id, region: r, boxes: r.boxes });
    }
    for (const b of p.boxes) if (b.slotSchema) { const o = get(b.slotSchema); if (o) o.slot = true; }
    for (const [nid, o] of byNode) {
      o.steps = [...o.steps].sort((a, b) => a[0] - b[0]).map(([i, roles]) => ({ i, roles: [...roles] }));
      OCC[nid].push(o);
    }
    if (!isFlow(p)) for (const b of p.boxes) if (b.node !== p.id && !PAPER_HOSTS[b.node].includes(p.id)) PAPER_HOSTS[b.node].push(p.id);
  }
  const PAPER_OWNER = {};
  for (const k of IDS) if (NODES[k].paper && PAPERS[NODES[k].paper]) PAPER_OWNER[NODES[k].paper] = k;
  // the box a step goes into opens a paper when it calls into it
  const intoPaper = (p, st) => {
    const b = boxById(p, st.to), pid = NODES[b.node] && NODES[b.node].paper;
    return pid && PAPERS[pid] && pid !== p.id && st.kind !== 'return' && st.kind !== 'data' && !st.alt ? pid : null;
  };

  // ---- graph edges (undirected, typed) ----
  const STRONG = new Set(['step', 'paper', 'link', 'embed', 'shape', 'op']);
  const EDGES = new Map();
  const ADJ = Object.fromEntries(IDS.map((k) => [k, new Map()])); // id → Map(neighbour → edge)
  function edge(a, b, type, info) {
    if (a === b || !NODES[a] || !NODES[b]) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let e = EDGES.get(key);
    if (!e) { e = { key, a: a < b ? a : b, b: a < b ? b : a, types: new Set(), steps: [] }; EDGES.set(key, e); ADJ[a].set(b, e); ADJ[b].set(a, e); }
    e.types.add(type);
    if (info) e.steps.push(info);
  }
  for (const k of IDS) {
    const n = NODES[k];
    for (const part of textParts(n)) for (const l of linksIn(part.s)) edge(k, l.id, l.embed ? 'embed' : 'link');
    if (n.shape && n.shape.of) edge(k, n.shape.of, 'shape');
    for (const o of n.ops || []) if (o.node) edge(k, o.node, 'op');
    if (n.paper && PAPERS[n.paper]) for (const b of PAPERS[n.paper].boxes) edge(k, b.node, 'paper');
    for (const t of n.api ? typeNamesIn(n.api.sig) : []) edge(k, t, 'type');
    if (n.kind !== 'hw') for (const f of n.fields || []) for (const t of typeNamesIn(f[0])) edge(k, t, 'type');
  }
  for (const p of ALLP) {
    p.steps.forEach((st, i) => {
      const a = boxById(p, st.from).node, b = boxById(p, st.to).node;
      edge(a, b, 'step', { p: p.id, i, from: a, to: b });
      if (st.data && st.data.schema) { edge(a, st.data.schema, 'data'); edge(b, st.data.schema, 'data'); }
    });
    for (const r of p.regions || []) for (const bid of r.boxes) edge(r.node, boxById(p, bid).node, 'context');
    for (const b of p.boxes) if (b.slotSchema) edge(b.node, b.slotSchema, 'type');
  }
  const isStrong = (e) => [...e.types].some((t) => STRONG.has(t));
  const DEG = Object.fromEntries(IDS.map((k) => [k, [...ADJ[k].values()].filter(isStrong).length]));
  const edgeRank = (e) => (e.types.has('step') ? 6 : e.types.has('paper') ? 5 : e.types.has('embed') ? 4 : e.types.has('link') ? 4 : e.types.has('shape') || e.types.has('op') ? 3 : e.types.has('type') || e.types.has('data') ? 2 : 1);
  const edgeKind = (e) => (e.types.has('step') ? 'step' : e.types.has('paper') ? 'paper' : e.types.has('link') || e.types.has('embed') ? 'link' : e.types.has('shape') || e.types.has('op') ? 'link' : e.types.has('type') || e.types.has('data') ? 'type' : 'context');

  // the neighbourhood of a node: everything one step away, then the strongest second steps
  function neighbourhood(id, hops, cap = 34) {
    const hop = new Map([[id, 0]]);
    for (const [nb] of ADJ[id]) hop.set(nb, 1);
    if (hops >= 2) {
      const cand = new Map();
      for (const [a, ea] of ADJ[id]) {
        if (NODES[a].kind === 'context' && NODES[id].kind !== 'context') continue; // contexts are hubs: do not walk through them
        for (const [b, e] of ADJ[a]) {
          if (hop.has(b) || !isStrong(e)) continue;
          cand.set(b, (cand.get(b) || 0) + edgeRank(e) + (isStrong(ea) ? 1 : 0));
        }
      }
      const room = Math.max(0, cap - hop.size);
      [...cand].sort((x, y) => y[1] - x[1] || DEG[y[0]] - DEG[x[0]]).slice(0, room).forEach(([b]) => hop.set(b, 2));
    }
    const ids = [...hop.keys()];
    const set = new Set(ids);
    const edges = [];
    for (const e of EDGES.values()) {
      if (!set.has(e.a) || !set.has(e.b)) continue;
      // second-step nodes only keep their edges toward the first ring
      if (hop.get(e.a) === 2 && hop.get(e.b) === 2) continue;
      edges.push(e);
    }
    return { ids, hop, edges };
  }

  // ---- the recorded run ----
  const TRACE_HITS = Object.fromEntries(IDS.map((k) => [k, []]));
  for (const t of TRACES) for (const ev of t.events) if (ev.n && TRACE_HITS[ev.n]) TRACE_HITS[ev.n].push({ t: t.id, ev });

  // ---- search ----
  const isCodeish = (s) => /[a-z_]\w*[.(_]|^[a-z_]+$|\(\)|^[A-Z][a-z]+[A-Z]/.test(String(s)) && !/[぀-ヿ一-鿿]/.test(String(s));
  // a code symbol names a node only when no other node lives in it: t.last, Tasks.tick and scheduler.tick all sit in "tick"
  const SYM_COUNT = {};
  for (const k of IDS) { const s = NODES[k].code && NODES[k].code[1]; if (s) SYM_COUNT[s] = (SYM_COUNT[s] || 0) + 1; }
  // each key costs what it is worth: the title is the name, the full function name nearly, the id and the symbol much less
  const SEARCH = [];
  for (const k of IDS) {
    const n = NODES[k], sym = n.code && n.code[1];
    const keys = [{ s: n.title, pen: 0 }];
    if (n.fn && n.fn !== n.title) keys.push({ s: n.fn, pen: 12 });
    keys.push({ s: k, pen: 32 });
    if (sym && SYM_COUNT[sym] === 1 && sym !== n.title && sym !== n.fn) keys.push({ s: sym, pen: 32 });
    SEARCH.push({ type: 'node', id: k, title: n.title, keys, body: plain(n.text) });
  }
  for (const p of FLOWS) SEARCH.push({ type: 'flow', id: p.id, title: p.tab, keys: [{ s: p.tab, pen: 0 }, { s: p.title, pen: 12 }, { s: p.id, pen: 32 }], body: p.steps.map((s) => plain(s.label)).join(' ') });
  for (const p of Object.values(PAPERS)) SEARCH.push({ type: 'flow', id: p.id, title: pLabel(p), keys: [{ s: pLabel(p), pen: 0 }, { s: p.title || '', pen: 12 }], body: p.steps.map((s) => plain(s.label)).join(' ') });
  for (const l of LAYERS) SEARCH.push({ type: 'layer', id: l.id, title: l.name, keys: [{ s: l.name, pen: 0 }, ...l.subs.map((s) => ({ s, pen: 12 })), { s: l.id, pen: 32 }], body: '' });
  // the whole name, or its last part ("submit" for request_channel.submit, "tick" for Tasks.tick), beats any other hit
  function exactBonus(q, s) {
    const t = String(s).toLowerCase(), bare = t.replace(/\(.*\)$/, '').trim();
    if (t === q || bare === q) return 80;
    const last = bare.split('.').pop();
    return last === q ? 50 : 0;
  }

  // score one key: a substring beats a scattered match; word starts and runs count
  function fuzzy(q, s) {
    const t = String(s).toLowerCase();
    if (!q) return null;
    const at = t.indexOf(q);
    if (at >= 0) {
      const start = at === 0 || /[\s._\-(（・]/.test(t[at - 1]);
      return { score: 100 + (start ? 30 : 0) + (at === 0 ? 20 : 0) - t.length * 0.3 + q.length * 4, hits: [...Array(q.length)].map((_, j) => at + j) };
    }
    const hits = [];
    let j = 0, run = 0, score = 0;
    for (let i = 0; i < t.length && j < q.length; i++) {
      if (t[i] === q[j]) {
        hits.push(i);
        run = hits.length > 1 && hits[hits.length - 2] === i - 1 ? run + 1 : 0;
        score += 4 + run * 6 + (i === 0 || /[\s._\-(（・]/.test(t[i - 1]) ? 8 : 0);
        j++;
      }
    }
    if (j < q.length) return null;
    const spread = hits[hits.length - 1] - hits[0] + 1;
    if (spread > q.length * 4 + 6) return null; // too scattered to mean anything
    return { score: score - spread * 0.8 - t.length * 0.2, hits };
  }
  function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const e of SEARCH) {
      let best = null;
      e.keys.forEach((key, ki) => {
        if (!key.s) return;
        const r = fuzzy(q, key.s);
        if (!r) return;
        const sc = r.score - key.pen + exactBonus(q, key.s);
        if (!best || sc > best.score) best = { score: sc, key: key.s, hits: ki === 0 ? r.hits : [], via: ki === 0 ? null : key.s };
      });
      let snippet = null;
      if (!best && e.body && q.length >= 2) {
        const at = e.body.toLowerCase().indexOf(q);
        if (at >= 0) {
          best = { score: 20 - at * 0.01, key: e.title, hits: [], via: null };
          const from = Math.max(0, at - 14), to = Math.min(e.body.length, at + q.length + 26);
          snippet = { text: (from > 0 ? '…' : '') + e.body.slice(from, to) + (to < e.body.length ? '…' : ''), at: at - from + (from > 0 ? 1 : 0), len: q.length };
        }
      }
      if (best) out.push({ ...e, score: best.score + (snippet ? (e.type === 'node' ? 2 : 0) : e.type === 'flow' ? 8 : e.type === 'layer' ? 4 : 0), hits: best.hits, via: best.via, snippet });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  }

  window.M = {
    A, C, NODES, IDS, LAYERS, LAYER, STACK, CROSS, FLOWS, PAPERS, ALLP, P, TRACES, KIND, STEP_KIND, ROLE,
    isFlow, stepNo, mainSteps, altsAt, boxById, pTitle, pLabel, LINK_RE, linksIn, plain, sentences, firstSentence,
    SCHEMA_BY_NAME, typeNamesIn, textParts, BACK, SHAPE_USERS, TYPE_USERS, POINTERS, OCC, PAPER_HOSTS, PAPER_OWNER, CTX_MEMBERS,
    intoPaper, EDGES, ADJ, DEG, STRONG, isStrong, edgeKind, edgeRank, neighbourhood, TRACE_HITS, isCodeish, search,
  };
})();
