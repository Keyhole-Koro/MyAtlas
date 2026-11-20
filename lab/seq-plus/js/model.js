// The sequence model: which lifelines stand side by side, which rows run top to bottom, and the
// fragments (alt, branches, papers as ref) that frame them. Pure functions over the atlas data, no DOM,
// so the same code runs in the page and in node for checks.

export const CALLISH = new Set(['call', 'syscall', 'msg', 'signal']);

// The kinds of arrow, worded as the main viewer words them.
export const KINDS = [
  ['call', '呼び出し'],
  ['syscall', 'syscall（アプリから OS へ）'],
  ['msg', '列を通す'],
  ['signal', '割り込み・通知'],
  ['data', '値を読む・書く'],
  ['return', '戻り・返事'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);

export function makeAtlas(A, CODE) {
  const altNo = new Map();
  const sheets = [...A.flows, ...Object.values(A.papers || {})];
  for (const sh of sheets) {
    let n = 0;
    const m = new Map();
    sh.steps.forEach((st, i) => { if (st.alt) m.set(i, 'ABCDEFGH'[n++]); });
    altNo.set(sh, m);
  }
  const layers = Object.fromEntries(A.layers.map((l) => [l.id, l]));
  const schemaByName = {};
  for (const [id, n] of Object.entries(A.nodes)) if (n.kind === 'schema' || n.kind === 'enum') schemaByName[n.title] = id;
  return { A, CODE: CODE || { nodes: {}, steps: {}, files: {} }, nodes: A.nodes, papers: A.papers || {}, layers, altNo, schemaByName };
}

// A step's name as people read it: its number, or もしA for the way taken instead.
export function stepNo(X, sheet, i) {
  const st = sheet.steps[i];
  return st.alt ? 'もし' + X.altNo.get(sheet).get(i) : String(i + 1);
}
export function stepBadge(X, sheet, i) {
  const st = sheet.steps[i];
  return st.alt ? X.altNo.get(sheet).get(i) : String(i + 1);
}

// A scope is one sheet placed in the diagram: the flow, or a paper opened inside a box of its parent scope.
export function rootScope(flow) {
  return { id: flow.id, sheet: flow, sheetKey: flow.id, depth: 0, parent: null, boxId: null, paperId: null, chain: new Set() };
}
function childScope(X, parent, boxId, paperId) {
  return { id: parent.id + '/' + boxId, sheet: X.papers[paperId], sheetKey: paperId, depth: parent.depth + 1, parent, boxId, paperId, chain: new Set([...parent.chain, paperId]) };
}
export const boxOf = (sheet, id) => sheet.boxes.find((b) => b.id === id);

// The order things are read in one sheet. A step that has ways taken instead (alt) becomes an alt fragment
// at its place; a step with branches becomes a fragment of its own; the paper inside a box comes right
// after the first step that enters that box.
export function seqItems(X, scope) {
  const f = scope.sheet, steps = f.steps;
  const altsAt = new Map();
  steps.forEach((st, i) => {
    if (!st.alt) return;
    if (!altsAt.has(st.alt.at)) altsAt.set(st.alt.at, []);
    altsAt.get(st.alt.at).push(i);
  });
  const placed = new Set();
  const one = (i) => {
    const st = steps[i], out = [];
    out.push(st.branches && st.branches.length > 1 ? { t: 'branch', scope, i } : { t: 'step', scope, i });
    const b = boxOf(f, st.to), n = b && X.nodes[b.node], pid = n && n.paper;
    if (!st.alt && pid && X.papers[pid] && !placed.has(st.to) && !scope.chain.has(pid) && pid !== scope.sheetKey) {
      placed.add(st.to);
      out.push({ t: 'ref', scope, boxId: st.to, paperId: pid, id: scope.id + '/' + st.to });
    }
    return out;
  };
  const items = [];
  steps.forEach((st, i) => {
    if (st.alt) return;
    const alts = altsAt.get(i);
    if (!alts) { items.push(...one(i)); return; }
    const instead = alts.filter((k) => !steps[k].alt.also), after = alts.filter((k) => steps[k].alt.also);
    if (instead.length) {
      const byWhen = new Map();
      for (const k of instead) {
        const w = steps[k].alt.when || '';
        if (!byWhen.has(w)) byWhen.set(w, []);
        byWhen.get(w).push(k);
      }
      const whens = [...byWhen.keys()];
      items.push({
        t: 'alt', scope, at: i, id: scope.id + '@' + i,
        operands: [
          { guard: whens.length === 1 ? `${whens[0]}でない` : 'そのほか', items: one(i), main: true },
          ...whens.map((w) => ({ guard: w, items: byWhen.get(w).flatMap(one), when: w })),
        ],
      });
    } else items.push(...one(i));
    for (const k of after) items.push({ t: 'opt', scope, at: i, id: scope.id + '+' + k, guard: steps[k].alt.when, items: one(k) });
  });
  return items;
}

// The outer steps an open paper draws in detail. Right after the paper, a step between the paper's box and
// a node the paper also holds (the same node, or the outer node one of its ports names) is one of the
// paper's own steps seen from outside: 「時計を読む」 outside is 「読む」 inside. It matches a paper step that
// leaves the paper towards that node (or comes in from it); a way taken instead only matches a way taken
// instead, and a return only a return. Folding stops at the first step of the main path the paper does not
// draw. Returns Map(step index → [paper step indices]).
export function foldMap(X, scope, boxId, paperId, later) {
  const sheet = scope.sheet, P = X.papers[paperId], out = new Map();
  if (!P) return out;
  const inPaper = new Map(P.boxes.map((b) => [b.node, b.id]));
  const match = (i) => {
    const st = sheet.steps[i];
    if (st.from === st.to || (st.from !== boxId && st.to !== boxId)) return null;
    const outward = st.from === boxId;
    const N = boxOf(sheet, outward ? st.to : st.from)?.node;
    const PN = (P.ports && P.ports[N]) || inPaper.get(N);
    if (!PN) return null;
    const ks = [];
    P.steps.forEach((ps, k) => {
      if (outward ? ps.to !== PN || ps.from === PN : ps.from !== PN || ps.to === PN) return;
      if (!!ps.alt !== !!st.alt || (ps.kind === 'return') !== (st.kind === 'return')) return;
      ks.push(k);
    });
    return ks.length ? ks : null;
  };
  const visit = (items) => {
    for (const it of items) {
      if (it.t === 'step' || it.t === 'branch') {
        const ks = match(it.i);
        if (ks) out.set(it.i, ks);
        else if (!sheet.steps[it.i].alt) return false;
      } else if (it.t === 'alt' || it.t === 'opt') {
        const ops = it.t === 'alt' ? it.operands : [{ items: it.items }];
        let goOn = true;
        ops.forEach((op, n) => { if (visit(op.items) === false && n === 0) goOn = false; });
        if (!goOn) return false;
      }
    }
    return true;
  };
  visit(later);
  return out;
}

// Flattens the items into rows, top to bottom. Frames remember the rows they hold. An open paper folds the
// outer steps it draws (see foldMap): they leave one 'fold' row under the paper that names them, and an alt
// whose operand lost all its steps keeps only the operands still standing.
export function buildRows(X, flow, open) {
  const rows = [], frames = [];
  const root = rootScope(flow);
  const scopes = [root];
  const folds = new Map(); // folded outer step key → the paper step key that draws it
  const push = (r) => { r.index = rows.length; rows.push(r); return r; };
  const addFrame = (fr) => { frames.push(fr); return fr; };
  const stepRow = (scope, i, frame, depth) => push({ type: 'step', key: scope.id + '#' + i, scope, sheet: scope.sheet, i, st: scope.sheet.steps[i], frame, depth });
  const isFolded = (skip, x) => (x.t === 'step' || x.t === 'branch') && skip.has(x.i);
  const walk = (items, parent, depth, skipIn) => {
    const skip = new Set(skipIn || []);
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      if (isFolded(skip, it)) continue;
      if (it.t === 'step') { stepRow(it.scope, it.i, parent, depth); continue; }
      if (it.t === 'branch') {
        const st = it.scope.sheet.steps[it.i];
        const fr = addFrame({ type: 'alt', sub: 'branch', id: it.scope.id + '~' + it.i, scope: it.scope, parent, depth, step: it.i });
        fr.r0 = push({ type: 'ftop', key: fr.id + ':top', frame: fr, guard: st.branches[0][0], outcome: st.branches[0][1], depth }).index;
        stepRow(it.scope, it.i, fr, depth + 1);
        st.branches.slice(1).forEach(([g, o], k) => push({ type: 'operand', key: fr.id + ':op' + (k + 1), frame: fr, k: k + 1, guard: g, outcome: o, depth }));
        fr.r1 = push({ type: 'fbot', key: fr.id + ':bot', frame: fr, depth }).index;
        continue;
      }
      if (it.t === 'alt' || it.t === 'opt') {
        const all = it.t === 'alt' ? it.operands : [{ guard: it.guard, items: it.items, when: it.guard }];
        const ops = all.map((op) => ({ ...op, items: op.items.filter((x) => !isFolded(skip, x)) })).filter((op) => op.items.length);
        if (!ops.length) continue;
        const lost = ops.length < all.length;
        const fr = addFrame({ type: 'alt', sub: lost && ops.length === 1 ? 'opt' : it.t, id: it.id, scope: it.scope, parent, depth, at: it.at, lost });
        fr.r0 = push({ type: 'ftop', key: fr.id + ':top', frame: fr, guard: ops[0].guard, op: ops[0], depth }).index;
        walk(ops[0].items, fr, depth + 1, skip);
        ops.slice(1).forEach((op, k) => {
          push({ type: 'operand', key: fr.id + ':op' + (k + 1), frame: fr, k: k + 1, guard: op.guard, op, depth });
          walk(op.items, fr, depth + 1, skip);
        });
        fr.r1 = push({ type: 'fbot', key: fr.id + ':bot', frame: fr, depth }).index;
        continue;
      }
      if (it.t === 'ref') {
        const isOpen = open.has(it.id);
        const sc = childScope(X, it.scope, it.boxId, it.paperId);
        const fr = addFrame({ type: 'ref', id: it.id, scope: it.scope, child: sc, parent, depth, open: isOpen, boxId: it.boxId, paperId: it.paperId, paper: X.papers[it.paperId] });
        if (!isOpen) { fr.r0 = fr.r1 = push({ type: 'ref', key: it.id + ':ref', frame: fr, depth }).index; continue; }
        scopes.push(sc);
        fr.r0 = push({ type: 'ftop', key: fr.id + ':top', frame: fr, depth }).index;
        walk(seqItems(X, sc), fr, depth + 1, null);
        fr.r1 = push({ type: 'fbot', key: fr.id + ':bot', frame: fr, depth }).index;
        const fm = foldMap(X, it.scope, it.boxId, it.paperId, items.slice(n + 1));
        if (fm.size) {
          const ghosts = [...fm].map(([i, ks]) => ({ i, st: it.scope.sheet.steps[i], ks, key: it.scope.id + '#' + i, keys: ks.map((k) => sc.id + '#' + k) }));
          fr.folds = ghosts;
          push({ type: 'fold', key: it.id + ':fold', frame: parent, refFrame: fr, scope: it.scope, sheet: it.scope.sheet, child: sc, ghosts, depth });
          for (const gh of ghosts) { skip.add(gh.i); folds.set(gh.key, gh.keys[0]); }
        }
      }
    }
  };
  walk(seqItems(X, root), null, 0, null);
  for (const fr of frames) fr.children = frames.filter((c) => c.parent === fr);
  return { rows, frames, scopes, root, folds };
}

// Every ref the flow can open, open or not, outermost first (for "open all").
export function allRefIds(X, flow) {
  const ids = [];
  const visit = (scope) => {
    const walkItems = (items) => {
      for (const it of items) {
        if (it.t === 'ref') { ids.push(it.id); visit(childScope(X, it.scope, it.boxId, it.paperId)); }
        if (it.t === 'alt') for (const op of it.operands) walkItems(op.items);
        if (it.t === 'opt') walkItems(it.items);
      }
    };
    walkItems(seqItems(X, scope));
  };
  visit(rootScope(flow));
  return ids;
}

// Lifelines, left to right. In the flow: execution contexts stay together, ordered by when they first
// take part; inside a context, by first part taken. A paper box whose node already stands as a lifeline uses
// that lifeline. A paper's own boxes stand together, in the paper's band order, inside or next to the run of
// their context; where exactly is chosen so that they stretch the other arrows least (an arrow that crosses
// them grows by their number), the paper's own arrows stay short, and the paper's frame holds few lifelines
// that have nothing to do in it.
export function buildLifelines(X, flow, model) {
  const { scopes, root } = model;
  const f = flow;
  // the order steps are read in with every paper closed, so that opening a paper (and folding the steps
  // it draws) does not move the lifelines outside it
  const first = new Map();
  let k = 0;
  const visit = (items) => {
    for (const it of items) {
      if (it.t === 'step' || it.t === 'branch') {
        const st = f.steps[it.i];
        if (!first.has(st.from)) first.set(st.from, 2 * k);
        if (!first.has(st.to)) first.set(st.to, 2 * k + 1);
        k++;
      } else if (it.t === 'alt') it.operands.forEach((op) => visit(op.items));
      else if (it.t === 'opt') visit(it.items);
    }
  };
  visit(seqItems(X, root));
  f.boxes.forEach((b, i) => { if (!first.has(b.id)) first.set(b.id, 1e6 + i); });
  const ctxOf = (id) => (f.regions || []).find((r) => r.boxes.includes(id)) || null;
  const groups = new Map();
  for (const b of f.boxes) {
    const rg = ctxOf(b.id), gk = rg ? 'ctx:' + rg.node : 'box:' + b.id;
    if (!groups.has(gk)) groups.set(gk, { key: gk, region: rg, members: [] });
    groups.get(gk).members.push(b);
  }
  for (const g of groups.values()) {
    g.members.sort((a, b) => first.get(a.id) - first.get(b.id));
    g.first = first.get(g.members[0].id);
  }
  const order = [...groups.values()].sort((a, b) => a.first - b.first).flatMap((g) => g.members.map((b) => ({
    key: root.id + ':' + b.id, scope: root, box: b, node: b.node, region: g.region, ctx: g.region ? g.region.node : null, papers: [],
  })));
  const keyMap = new Map([[root.id, new Map(order.map((l) => [l.box.id, l.key]))]]);
  const byKey = () => new Map(order.map((l) => [l.key, l]));
  for (const sc of scopes.slice(1)) {
    const p = sc.sheet, parentKey = keyMap.get(sc.parent.id).get(sc.boxId);
    const all = byKey(), parent = all.get(parentKey);
    const m = new Map(), fresh = [];
    for (const b of p.boxes) {
      const same = order.find((l) => l.node === b.node);
      if (same) m.set(b.id, same.key); else fresh.push(b);
    }
    const bandIx = new Map((p.bands || []).map((bd, i) => [bd.id, i]));
    const pf = new Map();
    p.steps.forEach((st, i) => { for (const id of [st.from, st.to]) if (!pf.has(id)) pf.set(id, i); });
    fresh.sort((a, b) => (bandIx.get(a.layer) ?? 99) - (bandIx.get(b.layer) ?? 99) || (pf.get(a.id) ?? 99) - (pf.get(b.id) ?? 99));
    const newL = fresh.map((b) => ({
      key: sc.id + ':' + b.id, scope: sc, box: b, node: b.node, region: parent.region, ctx: parent.ctx,
      papers: [...parent.papers, sc.id], band: (p.bands || []).find((bd) => bd.id === b.layer) || null,
    }));
    for (const l of newL) m.set(l.box.id, l.key);
    keyMap.set(sc.id, m);
    order.splice(placeBlock(model, order, keyMap, sc, parent, newL), 0, ...newL);
  }
  const index = new Map(order.map((l, i) => [l.key, i]));
  const keyOf = (scope, boxId) => keyMap.get(scope.id)?.get(boxId);
  return { order, keyMap, index, keyOf, byKey: new Map(order.map((l) => [l.key, l])) };
}

const within = (sc, anc) => { for (let s = sc; s; s = s.parent) if (s === anc) return true; return false; };

// Where a paper's own lifelines go: the gap with the least cost. The cost counts, for each arrow outside the
// paper that would cross them, their number; half the length of the paper's own arrows; and twice the
// lifelines its frame would hold without using them. Gaps that split another context or another paper's
// lifelines are not used; ties go to the gap right after the box.
function placeBlock(model, order, keyMap, sc, parent, block) {
  const B = block.length;
  if (!B) return order.indexOf(parent) + 1;
  const idx = new Map(order.map((l, i) => [l.key, i]));
  const boxAt = idx.get(parent.key);
  const shared = new Set([...keyMap.get(sc.id).values()].filter((key) => idx.has(key)));
  const arrows = [], own = [];
  for (const r of model.rows) {
    if (r.type !== 'step') continue;
    const km = keyMap.get(r.scope.id);
    if (!km) continue;
    const a = km.get(r.st.from), b = km.get(r.st.to);
    if (r.scope === sc) own.push([a, b]);
    else if (!within(r.scope, sc) && idx.has(a) && idx.has(b)) arrows.push([idx.get(a), idx.get(b)]);
  }
  const blockAt = new Map(block.map((l, i) => [l.key, i]));
  let best = null;
  for (let g = 0; g <= order.length; g++) {
    const L = order[g - 1], R = order[g];
    if (L && R && L.ctx && L.ctx === R.ctx && L.ctx !== parent.ctx) continue;
    if (parent.ctx && !((L && L.ctx === parent.ctx) || (R && R.ctx === parent.ctx))) continue;
    if (L && R && L.scope === R.scope && L.scope !== model.root && !within(sc, L.scope)) continue;
    const pos = (key) => (blockAt.has(key) ? g + blockAt.get(key) : idx.get(key) + (idx.get(key) >= g ? B : 0));
    let cross = 0;
    for (const [a, b] of arrows) if (Math.min(a, b) < g && Math.max(a, b) >= g) cross += B;
    let len = 0;
    for (const [a, b] of own) if (a != null && b != null) len += Math.abs(pos(a) - pos(b));
    const box = pos(parent.key);
    const lo = Math.min(box, g), hi = Math.max(box, g + B - 1);
    let idle = 0;
    for (let i = lo; i <= hi; i++) {
      if (i >= g && i < g + B) continue;
      const l = order[i < g ? i : i - B];
      if (l && l.key !== parent.key && !shared.has(l.key)) idle++;
    }
    const cost = cross + 0.5 * len + 2 * idle + 0.01 * Math.abs(g - (boxAt + 1));
    if (!best || cost < best.cost) best = { g, cost };
  }
  return best ? best.g : boxAt + 1;
}

// Which lifelines a frame spans. A ref spans its box, the paper's own lifelines, and lifelines it shares
// that stand right next to them; a lifeline it shares further away is reached through the frame's edge.
// An alt spans the ends of its arrows. Frames hold their children.
export function frameSpans(X, model, L) {
  const { rows, frames } = model;
  const span = new Map();
  const ends = (fr) => {
    const s = new Set();
    for (let r = fr.r0; r <= fr.r1; r++) {
      const row = rows[r];
      if (row.type !== 'step') continue;
      s.add(L.index.get(L.keyOf(row.scope, row.st.from)));
      s.add(L.index.get(L.keyOf(row.scope, row.st.to)));
    }
    return s;
  };
  const visit = (fr) => {
    let lo = Infinity, hi = -Infinity;
    const take = (i) => { if (i == null || i < 0) return; lo = Math.min(lo, i); hi = Math.max(hi, i); };
    if (fr.type === 'ref') {
      const pk = L.keyOf(fr.scope, fr.boxId);
      take(L.index.get(pk));
      if (fr.open) {
        const sc = fr.child;
        const own = L.order.filter((l) => l.scope.id === sc.id).map((l) => L.index.get(l.key));
        own.forEach(take);
        const shared = new Set([...(L.keyMap.get(sc.id) || new Map()).values()].map((k) => L.index.get(k)));
        let grew = true;
        while (grew) {
          grew = false;
          if (shared.has(hi + 1)) { hi++; grew = true; }
          if (shared.has(lo - 1)) { lo--; grew = true; }
        }
      }
    } else {
      ends(fr).forEach(take);
    }
    for (const c of fr.children) {
      const cs = visit(c);
      take(cs.lo); take(cs.hi);
    }
    const s = { lo, hi };
    span.set(fr, s);
    return s;
  };
  for (const fr of frames.filter((f) => !f.parent)) visit(fr);
  return span;
}

// Activation bars. In a flow, calls nest: a call keeps its caller active until the callee is done, and a
// function is done when it returns, when its caller takes part again, or when the flow ends (then it lasts
// to the last step it or something it called takes part in). A message or a signal wakes its receiver as a
// new thread of control; a return wakes its target. Inside a paper the boxes are the parts of one function
// in the order they run, so a bar there goes from the step that reaches the part to the last step it takes
// part in, and the box that holds the paper stays active while the paper runs. Places (stores, registers)
// have no bars. Bars that overlap on one lifeline are nested with an offset.
export function activations(X, model, L) {
  const { rows } = model;
  const isFunc = (key) => { const l = L.byKey.get(key); return !!l && X.nodes[l.node]?.kind === 'func'; };
  const bars = [];
  const later = (a, b) => (b.index > a.index ? b : a);
  const mk = (key, r) => { const b = { key, r0: r, r1: r, off: 0 }; bars.push(b); return b; };
  // the flow: call stacks, one per thread of control
  const stacks = [];
  let cur = null;
  const where = (key) => {
    for (const s of cur ? [cur, ...stacks.filter((x) => x !== cur)] : stacks) for (let i = s.length - 1; i >= 0; i--) if (s[i].key === key) return [s, i];
    return null;
  };
  const unwind = (s, i) => {
    while (s.length > i + 1) { const b = s.pop(); s[s.length - 1].r1 = later(s[s.length - 1].r1, b.r1); }
  };
  const act = (key, r) => {
    const w = where(key);
    if (!w) return null;
    unwind(w[0], w[1]);
    const b = w[0][w[1]];
    b.r1 = later(b.r1, r);
    cur = w[0];
    return b;
  };
  const fresh = (key, r) => { const s = [mk(key, r)]; stacks.push(s); cur = s; return s; };
  const done = (key, r) => {
    const w = where(key);
    if (!w) return;
    const [s, i] = w;
    unwind(s, i);
    const b = s.pop();
    b.r1 = later(b.r1, r);
    if (s.length) s[s.length - 1].r1 = later(s[s.length - 1].r1, r);
    else stacks.splice(stacks.indexOf(s), 1);
  };
  // papers: the part running now, per lifeline
  const part = new Map();
  const stepPos = new Map(rows.filter((r) => r.type === 'step').map((r, i) => [r, i]));
  const touchPart = (key, r, starts) => {
    let b = part.get(key);
    const gap = b && b.r1.type === 'step' && stepPos.get(r) - stepPos.get(b.r1) > 1;
    if (!b || (starts && gap)) { b = mk(key, r); part.set(key, b); } else b.r1 = later(b.r1, r);
    return b;
  };
  for (const r of rows) {
    if (r.type === 'fbot' && r.frame.type === 'ref' && r.frame.open) {
      const key = L.keyOf(r.frame.scope, r.frame.boxId);
      if (!isFunc(key)) continue;
      if (r.frame.scope.depth === 0) { if (!act(key, r)) fresh(key, r); } else touchPart(key, r, false);
      continue;
    }
    if (r.type !== 'step') continue;
    const a = L.keyOf(r.scope, r.st.from), b = L.keyOf(r.scope, r.st.to), k = r.st.kind;
    if (r.scope.depth > 0) {
      const callish = CALLISH.has(k);
      if (isFunc(a)) touchPart(a, r, false);
      if (isFunc(b)) touchPart(b, r, callish);
      if (k === 'return' && isFunc(a)) part.delete(a);
      continue;
    }
    if (k === 'call' || k === 'syscall') {
      let s = null;
      if (isFunc(a)) { if (act(a, r)) s = where(a)[0]; else s = fresh(a, r); }
      if (isFunc(b)) { if (s) { s.push(mk(b, r)); cur = s; } else fresh(b, r); }
    } else if (k === 'msg' || k === 'signal') {
      if (isFunc(a) && !act(a, r)) fresh(a, r);
      if (isFunc(b) && !act(b, r)) fresh(b, r);
    } else if (k === 'return') {
      if (isFunc(a)) done(a, r);
      if (isFunc(b) && !act(b, r)) fresh(b, r);
    } else {
      for (const key of [a, b]) if (isFunc(key) && !act(key, r)) fresh(key, r);
    }
  }
  for (const s of stacks) unwind(s, 0);
  // overlapping bars on one lifeline nest
  const byKey = new Map();
  for (const b of bars) { if (!byKey.has(b.key)) byKey.set(b.key, []); byKey.get(b.key).push(b); }
  for (const list of byKey.values()) {
    list.sort((x, y) => x.r0.index - y.r0.index);
    list.forEach((b, i) => {
      for (let j = i - 1; j >= 0; j--) if (list[j].r1.index >= b.r0.index) { b.off = Math.max(b.off, list[j].off + 1); }
    });
  }
  return bars;
}

// The text of a node with [[links]] split into parts.
export function textParts(s) {
  const out = [];
  let last = 0;
  for (const m of String(s || '').matchAll(/(!?)\[\[([\w.\-]+)\]\]/g)) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
    out.push({ t: m[1] ? 'embed' : 'link', id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < String(s || '').length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}
export function plainText(X, s) {
  return textParts(s).map((p) => (p.t === 'text' ? p.s : p.t === 'link' ? (X.nodes[p.id]?.title || p.id) : '')).join('');
}
