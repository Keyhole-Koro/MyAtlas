// The map's data, arranged as a story: chapters (flows), the papers opened inside them, and the scenes
// a reader scrolls through. Nothing here invents content; it only orders what docs/atlas says.
(function () {
  const S = window.S, A = S.A;

  S.N = A.nodes;
  S.L = Object.fromEntries(A.layers.map((l) => [l.id, l]));
  S.STACK = A.layers.filter((l) => !l.cross).map((l) => l.id);
  S.CROSS = A.layers.filter((l) => l.cross).map((l) => l.id);
  S.KIND = { func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙', context: '実行の文脈', note: '方針', figure: '図' };
  S.EDGE = { call: '呼び出し', syscall: 'syscall', return: '戻り・返事', signal: '割り込み・通知', msg: '列を通す', data: '値を読む・書く' };
  S.EDGE_LONG = { call: '呼び出し', syscall: 'syscall（アプリから OS へ）', return: '戻り・返事', signal: '割り込み・通知', msg: '列を通す', data: '値を読む・書く' };
  S.PAPERS = A.papers;
  S.FLOWS = A.flows;

  // The colour family of a layer or band (bands carry a tone).
  S.toneOf = (layerOrBand) => (S.L[layerOrBand] && !S.L[layerOrBand].cross ? layerOrBand : null);
  S.nodeTone = (id) => { const n = S.N[id]; return n && S.STACK.includes(n.layer) ? n.layer : null; };
  S.title = (id) => (S.N[id] ? S.N[id].title : id);
  S.plain = (s) => String(s || '').replace(/!?\[\[([\w.\-]+)\]\]/g, (m, id) => S.title(id));

  // ---- Diagrams: a flow, or a paper drawn inside one box of a flow or of another paper ----
  // id: 'ui', 'ui.gateway', 'ui.gateway.submit' (the box ids on the way down).
  S.D = {};
  function addDiagram(id, g, parent, host) {
    const d = { id, g, parent, host, isPaper: !!parent, children: {} };
    d.box = Object.fromEntries(g.boxes.map((b) => [b.id, b]));
    d.rows = d.isPaper ? g.bands.map((b) => b.id) : S.STACK.slice();
    d.rowInfo = d.isPaper ? Object.fromEntries(g.bands.map((b) => [b.id, b])) : Object.fromEntries(S.STACK.map((l) => [l, S.L[l]]));
    d.main = g.steps.map((st, i) => ({ st, i })).filter((x) => !x.st.alt);
    d.alts = g.steps.map((st, i) => ({ st, i })).filter((x) => x.st.alt);
    let n = 0;
    for (const x of d.alts) x.no = 'ABCDEFGH'[n++];
    S.D[id] = d;
    if (parent) S.D[parent].children[host] = id;
    return d;
  }
  S.stepNo = (d, i) => { const a = d.alts.find((x) => x.i === i); return a ? `もし${a.no}` : String(d.main.findIndex((x) => x.i === i) + 1); };

  // ---- Where each paper is opened in the story ----
  // A paper is opened once, in the place where the story is about to leave its box. When the flow later
  // arrives at the box from the paper's own entry (Tasks.tick after process.stats), it waits for that step.
  function paperPlacements(d) {
    const out = [];
    for (const b of d.g.boxes) {
      const pid = S.N[b.node] && S.N[b.node].paper;
      if (!pid || !S.PAPERS[pid]) continue;
      const p = S.PAPERS[pid];
      const entryNode = p.entry && (p.boxes.find((x) => x.id === p.entry) || {}).node;
      const touches = d.main.filter((x) => x.st.from === b.id || x.st.to === b.id).map((x) => x.i);
      if (!touches.length) continue;
      let after = null, score = 1;
      const fromEntry = d.main.find((x) => x.st.to === b.id && d.box[x.st.from] && d.box[x.st.from].node === entryNode);
      if (fromEntry) { after = fromEntry.i; score = 2; }
      else {
        const order = d.main.map((x) => x.i);
        let k = order.indexOf(touches[0]);
        while (k + 1 < order.length && touches.includes(order[k + 1])) k++;
        after = order[k];
      }
      out.push({ box: b.id, paper: pid, after, score });
    }
    return out;
  }

  // ---- The scenes ----
  // Each scene is one block of text; the picture beside it follows the scene that is being read.
  S.scenes = [];
  S.sceneById = {};
  S.chapters = [];
  const push = (sc) => { sc.index = S.scenes.length; S.scenes.push(sc); S.sceneById[sc.id] = sc; return sc; };
  S.sid = (diag, i) => `s-${diag.replace(/\./g, '-')}-${i}`;

  // Decide every paper's best place first (a paper opens once in the whole story).
  const flowDiags = S.FLOWS.map((f) => addDiagram(f.id, f, null, null));
  const chosen = {};
  function collect(d) {
    for (const pl of paperPlacements(d)) {
      const prev = chosen[pl.paper];
      if (!prev || pl.score > prev.score) chosen[pl.paper] = { ...pl, diag: d.id };
    }
  }
  flowDiags.forEach(collect);
  // Papers inside papers are placed in the paper that holds them.
  function openPaper(d, pl) {
    const id = `${d.id}.${pl.box}`;
    const pd = addDiagram(id, S.PAPERS[pl.paper], d.id, pl.box);
    pd.chapter = d.chapter;
    pd.after = pl.after;
    for (const inner of paperPlacements(pd)) if (!chosen[inner.paper]) chosen[inner.paper] = { ...inner, diag: pd.id };
    return pd;
  }

  function walk(d, chapter) {
    d.chapter = chapter.id;
    for (const { st, i } of d.main) {
      push({ id: S.sid(d.id, i), kind: 'step', diag: d.id, step: i, chapter: chapter.id });
      for (const pl of Object.values(chosen).filter((p) => p.diag === d.id && p.after === i)) {
        const pd = openPaper(d, pl);
        push({ id: S.sid(pd.id, 'open'), kind: 'paper', diag: pd.id, chapter: chapter.id, paper: pl.paper });
        walk(pd, chapter);
        push({ id: S.sid(pd.id, 'close'), kind: 'paper-close', diag: d.id, from: pd.id, chapter: chapter.id, step: i });
      }
      const alts = d.alts.filter((x) => x.st.alt.at === i);
      alts.forEach((x, k) => push({ id: S.sid(d.id, x.i), kind: 'alt', diag: d.id, step: x.i, chapter: chapter.id, first: k === 0, last: k === alts.length - 1, at: i }));
    }
  }

  // Intro scenes, then a chapter per flow, then the recorded run.
  push({ id: 'hero', kind: 'hero' });
  push({ id: 'layers', kind: 'layers' });
  push({ id: 'cross', kind: 'cross' });
  push({ id: 'routes', kind: 'routes' });
  flowDiags.forEach((d, k) => {
    const f = d.g;
    const ch = { id: f.id, no: k + 1, flow: f, diag: d.id, title: f.title, tab: f.tab };
    S.chapters.push(ch);
    ch.first = push({ id: `ch-${f.id}`, kind: 'chapter', diag: d.id, chapter: f.id }).index;
    for (const r of f.regions || []) push({ id: `ctx-${f.id}-${r.node}`, kind: 'region', diag: d.id, region: r.node, chapter: f.id });
    walk(d, ch);
    push({ id: `end-${f.id}`, kind: 'recap', diag: d.id, chapter: f.id });
    ch.last = S.scenes.length - 1;
  });
  S.TRACE = (A.traces || [])[0];

  // ---- The recorded run: who ran when, and which functions were entered ----
  // A run is a stretch of events on one thread. Runs that only switch threads and count time
  // are gathered into one scene; the others get a scene each.
  S.traceUses = {};
  if (S.TRACE) {
    const t = S.TRACE, runs = [];
    for (const e of t.events) {
      if (!runs.length || runs[runs.length - 1].thread !== e.thread) runs.push({ thread: e.thread, start: e.instr, events: [] });
      runs[runs.length - 1].events.push(e);
      if (e.n) S.traceUses[e.n] = (S.traceUses[e.n] || 0) + 1;
    }
    runs.forEach((r, i) => { r.i = i; r.end = i + 1 < runs.length ? runs[i + 1].start : r.events[r.events.length - 1].instr; });
    const QUIET = new Set(['kernel.irq-dispatch', 'kernel.tick', 'kernel.reschedule', 'kernel.cpu-time', 'kernel.charge', 'kernel.os-call', 'os.router', 'lib.next', 'kernel.ipc-send', 'kernel.notify-armed', 'os.serve']);
    const loud = (r) => r.events.some((e) => (e.ev === 'irq' && (e.cause || []).includes('keyboard')) || e.service === 'REQUEST' || (e.n && !QUIET.has(e.n)));
    S.traceRuns = runs;
    S.traceEnd = t.events[t.events.length - 1].instr;
    push({ id: 'trace-open', kind: 'trace-open' });
    let k = 0;
    for (let i = 0; i < runs.length; i++) {
      let j = i;
      if (!loud(runs[i])) while (j + 1 < runs.length && !loud(runs[j + 1])) j++;
      push({ id: `trace-${++k}`, kind: 'trace', runs: runs.slice(i, j + 1).map((r) => r.i), t0: runs[i].start, t1: runs[j].end, quiet: !loud(runs[i]) });
      i = j;
    }
  }

  S.chapterOf = (sc) => S.chapters.find((c) => c.id === sc.chapter);

  // ---- Who does a step, and what to call it ----
  const STORE = new Set(['store', 'hw', 'schema', 'enum']);
  S.isStore = (id) => STORE.has((S.N[id] || {}).kind);
  // The box that does the work: the one the arrow leaves, unless a value is read out of a store.
  S.actorOf = (d, st) => (st.kind === 'data' && S.isStore(d.box[st.from].node) ? st.to : st.from);
  // The dashed frame (execution context) a box is drawn in, if any.
  S.regionOf = (d, box) => (d.g.regions || []).find((r) => r.boxes.includes(box)) || null;
  S.boxName = (b) => b.short || b.title.replace(/\(.*\)$/, '');
  // A step's heading: its verb. Steps without one are named after what they reach, never after the
  // kind of arrow alone ("呼び出し" repeated says nothing).
  S.heading = (d, st) => {
    if (st.verb) return st.verb;
    const to = d.box[st.to], from = d.box[st.from];
    if (/\s=\s/.test(to.title)) return to.title;                         // owner = pid
    const lead = String(st.label || '').split(/[（、。]/)[0].trim();
    if (/^[\w.\[\]]+ = [\w.]+$/.test(lead)) return lead;                  // t.last = now
    if (st.kind === 'return') return `${S.boxName(to)} へ戻る`;
    if (st.kind === 'data') return S.isStore(to.node) ? `${S.boxName(to)} に書く` : `${S.boxName(from)} を渡す`;
    return `${S.boxName(to)} へ`;
  };
  // How a reader names a place in the story: "1 章の 5", "2 章・charge_elapsed の中の 3".
  S.where = (sc) => {
    const ch = S.chapterOf(sc), d = S.D[sc.diag];
    const no = S.stepNo(d, sc.step);
    return d.isPaper ? `${ch.no} 章・${d.g.tab} の中の ${no}` : `${ch.no} 章の ${no}`;
  };

  // ---- Where every node shows up (for the cards and the index) ----
  S.uses = {};
  const use = (id, u) => { if (!S.N[id]) return; (S.uses[id] = S.uses[id] || []).push(u); };
  for (const sc of S.scenes) {
    if (sc.kind !== 'step' && sc.kind !== 'alt') continue;
    const d = S.D[sc.diag], st = d.g.steps[sc.step];
    const where = { scene: sc.id, label: S.where(sc) };
    const seen = new Set();
    for (const id of [d.box[st.from].node, d.box[st.to].node, st.ref]) if (id && !seen.has(id)) { seen.add(id); use(id, where); }
  }
  for (const sc of S.scenes) if (sc.kind === 'paper') use(S.D[sc.diag].g.id, { scene: sc.id, label: `${S.chapterOf(sc).no} 章・中の紙` });
  for (const sc of S.scenes) {
    if (sc.kind !== 'trace') continue;
    const seen = new Set();
    for (const ri of sc.runs) for (const e of S.traceRuns[ri].events) if (e.n && !seen.has(e.n)) { seen.add(e.n); use(e.n, { scene: sc.id, label: `記録 ${sc.id.split('-')[1]}` }); }
  }
})();
