// コードと歩く: walk a flow of the document map step by step, with the code each step runs through.
(function () {
  'use strict';
  const A = window.ATLAS, C = window.ATLAS_CODE, H = window.CTHL, CL = window.CTLINES;
  const esc = H.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- vocabulary ----------
  const KIND_STEP = { call: '呼び出し', syscall: 'syscall', return: '戻り', signal: '割り込み・通知', msg: '列を通す', data: '読み書き' };
  const KIND_NODE = { func: '関数', store: '置き場', hw: 'レジスタ', schema: '構造体', enum: '列挙', context: '実行の文脈', note: '方針', figure: '図' };
  const LANG = { mylang: 'MyLang', rust: 'Rust' };
  const LH = 20, PAD = 12;

  const LAYER = Object.fromEntries(A.layers.map((l) => [l.id, l]));
  const STACK = A.layers.filter((l) => !l.cross).map((l) => l.id);
  const col = (layer) => `var(--c-${LAYER[layer] ? layer : 'contract'})`;

  const ICON = {
    paper: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5M6 8h4.5M6 10.5h4.5"/></svg>',
    open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7"/></svg>',
    dive: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3"/><path d="M7 10h6M10.5 7.5 13 10l-2.5 2.5"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
  };
  const KICON = {
    call: '<path d="M1 5h9"/><path class="f" d="M9 2l4 3-4 3z"/>',
    syscall: '<path d="M1 3.4h9M1 6.6h9"/><path class="f" d="M9 1.6l4 3.4-4 3.4z"/>',
    return: '<path d="M13 5H4" stroke-dasharray="2 1.6"/><path class="f" d="M5 2 1 5l4 3z"/>',
    signal: '<path d="M1 5h9" stroke-dasharray="1 2"/><path class="f" d="M9 2l4 3-4 3z"/>',
    msg: '<path d="M1 5h9" stroke-dasharray="3 1.5 1 1.5"/><path class="f" d="M9 2l4 3-4 3z"/>',
    data: '<path class="f" d="M1 5l2-2.2L5 5 3 7.2z"/><path d="M5 5h5"/><path class="f" d="M9 2l4 3-4 3z"/>',
  };
  const kindIcon = (k) => `<svg class="ki" viewBox="0 0 14 10" width="14" height="10" aria-hidden="true">${KICON[k] || KICON.call}</svg>`;

  // ---------- tracks: the flows and the papers inside nodes ----------
  const TRACKS = {};
  function makeTrack(src, id, kind) {
    const t = { id, kind, src, title: src.title, tab: src.tab, steps: src.steps, boxes: src.boxes, bands: src.bands || null };
    t.box = Object.fromEntries(src.boxes.map((b) => [b.id, b]));
    let n = 0, a = 0;
    t.labels = src.steps.map((s) => (s.alt ? 'ABCDEFGH'[a++] : String(++n)));
    t.main = src.steps.map((s, i) => (s.alt ? -1 : i)).filter((i) => i >= 0);
    t.alts = {};
    src.steps.forEach((s, i) => { if (s.alt) (t.alts[s.alt.at] = t.alts[s.alt.at] || []).push(i); });
    return t;
  }
  A.flows.forEach((f) => { TRACKS[f.id] = makeTrack(f, f.id, 'flow'); });
  Object.entries(A.papers).forEach(([id, p]) => { TRACKS[id] = makeTrack(p, id, 'paper'); });

  function boxLayer(t, b) {
    if (t.kind === 'flow') return b.layer;
    const band = t.bands.find((x) => x.id === b.layer);
    return band ? band.tone : 'os';
  }
  function paperOf(t, i) {
    const s = t.steps[i];
    const n = s && A.nodes[t.box[s.to].node];
    return n && n.paper && TRACKS[n.paper] ? n.paper : null;
  }
  const trackTone = (t) => (t.kind === 'paper' ? (A.nodes[t.id] || {}).layer || 'os' : 'os');
  const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);
  const boxName = (b) => b.short || b.title;
  // A step's title: its verb, or, when the map gives none, its sentence.
  const stepTitle = (s) => s.verb || s.label || KIND_STEP[s.kind] || s.kind;
  const isStart = (t, i) => t.kind === 'flow' && Array.isArray(t.src.start) && t.src.start[0] === i;

  // ---------- sources, and where each step happens (lines.js) ----------
  const SRC = {}, RAW = {};
  let LN = null;
  async function loadSources() {
    await Promise.all(Object.keys(C.files).map(async (p) => {
      try {
        const r = await fetch('../data/src/' + p);
        if (r.ok) { SRC[p] = await r.text(); RAW[p] = SRC[p].split('\n'); }
      } catch (e) { /* opened from disk: no sources */ }
    }));
    LN = CL.make(A, C, RAW);
  }
  const inSpan = (sp, path, line) => !!sp && sp.path === path && sp.s <= line && line <= sp.e;
  // The name a box has in code: its title when that is the code's name (request_gateway.request),
  // else the code's name (charge_elapsed).
  function codeName(id) {
    const n = A.nodes[id] || {}, sym = ((C.nodes[id] || {}).symbol || '');
    const last = sym.split('.').pop();
    return n.title && (n.title === last || n.title.endsWith('.' + last)) ? n.title : sym || n.title || id;
  }
  function anchorOf(id) {
    const l = LN && LN.loc(id);
    if (!l) return null;
    if (!l.start) return { node: id, path: l.path, line: null };
    return { node: id, path: l.path, line: LN.focusLine(id) || LN.firstCodeLine(l.path, l.start, l.end || l.start) };
  }

  // What the code panel shows for a step: the file, the band (the code of the function the line
  // is in), the line and how sure it is (step, focus, likely, fields; def when only the box is known).
  const PLANS = {};
  function plan(t, i) {
    const key = t.id + ':' + i;
    if (PLANS[key]) return PLANS[key];
    const s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
    const ref = s.ref || fb.node;
    const p = { track: t, i, step: s, node: ref, path: null, band: null, bandNode: null, main: null, mainKind: 'none', why: '', hits: null, outside: false };
    if (!LN) return p;
    const w = LN.where(t.id, i);
    if (w && RAW[w.path]) {
      Object.assign(p, { path: w.path, main: w.line, mainKind: w.kind, why: w.why || '', hits: w.hits || null, fn: w.fn || null, rel: w.rel || null });
      const rs = LN.span(ref);
      const own = w.kind === 'fields' ? rs : LN.ownerOf(w.path, w.line, [fb.node, ref, tb.node]);
      const band = own || (rs && rs.path === w.path ? rs : null);
      if (band) { p.band = [band.s, band.e]; p.bandNode = band.id; }
      p.outside = !own && !!band;
    } else {
      for (const id of [ref, tb.node, fb.node]) {
        const l = LN.loc(id);
        if (!l) continue;
        p.path = l.path; p.node = id; p.bandNode = id;
        if (l.start) {
          p.band = [l.start, l.end || l.start];
          p.main = LN.firstCodeLine(l.path, l.start, l.end || l.start);
          p.mainKind = 'def';
        } else p.mainKind = 'file';
        break;
      }
    }
    if (p.band) p.sig = LN.firstCodeLine(p.path, p.band[0], p.band[1]);
    p.arrival = tb.node !== p.bandNode ? anchorOf(tb.node) : null;
    return (PLANS[key] = p);
  }
  function nodePlan(id, why, fields) {
    const l = LN && LN.loc(id);
    const p = { node: id, bandNode: id, why, detour: true, path: l ? l.path : null, band: null, main: null, mainKind: 'none' };
    if (!l) return p;
    if (l.start) {
      p.band = [l.start, l.end || l.start];
      const f = LN.focusLine(id);
      p.main = f || LN.firstCodeLine(l.path, l.start, l.end || l.start);
      p.mainKind = f ? 'focus' : 'def';
      p.sig = LN.firstCodeLine(l.path, l.start, l.end || l.start);
      if (fields && fields.length) p.hits = LN.fieldLines(l.path, l.start, l.end || l.start, fields);
    } else p.mainKind = 'file';
    return p;
  }

  // ---------- the recorded run: how often it entered each function, on which threads ----------
  const TRACE = (A.traces || [])[0];
  const RUNS = {};
  const codeKey = (id) => { const l = C.nodes[id]; return l && l.symbol ? l.path + '#' + l.symbol : null; };
  if (TRACE) {
    for (const e of TRACE.events) {
      if (e.ev !== 'enter' || !e.n) continue;
      const k = codeKey(e.n);
      if (k) (RUNS[k] = RUNS[k] || []).push(e);
    }
  }
  const threadName = (tid) => (TRACE && TRACE.threads[String(tid)]) || String(tid);
  const isAppThread = (tid) => tid >= 0 && !/^kernel\b/.test(threadName(tid));
  // Which entries belong to a context of the map: an app's own code runs on its thread outside the
  // kernel; OS_CALL on the app's thread inside it; a service task on an OS thread; an interrupt anywhere.
  const CTX_RUN = {
    'ctx.user': (e) => isAppThread(e.thread) && e.program !== 'kernel',
    'ctx.syscall': (e) => isAppThread(e.thread) && e.program === 'kernel',
    'ctx.service': (e) => e.thread >= 0 && !isAppThread(e.thread),
    'ctx.irq': () => true,
  };
  function runHTML(id, ctx) {
    const k = codeKey(id), all = k && RUNS[k];
    if (!all) return '';
    const test = CTX_RUN[ctx];
    const mine = test ? all.filter(test) : all, rest = all.filter((e) => !mine.includes(e));
    const names = (list) => {
      const m = {};
      for (const e of list) { const n = threadName(e.thread); m[n] = (m[n] || 0) + 1; }
      const th = Object.entries(m).sort((a, b) => b[1] - a[1]);
      return th.slice(0, 2).map(([t, n]) => (th.length > 1 ? `${t} ${n}` : t)).join('・') + (th.length > 2 ? ' ほか' : '');
    };
    const fn = all[0].fn;
    let tip = `記録「${TRACE.title}」で、${fn} に入った回数と走っていたスレッド`;
    if (test) tip += `（${A.nodes[ctx].title} にあたる分だけ）`;
    if (rest.length) tip += `。ほかの文脈では ${rest.length} 回（${names(rest)}）`;
    if (mine.length) tip += `。最初は ${mine[0].instr.toLocaleString()} 命令目`;
    tip += '。記録はタスクマネージャではなくエディタのもの';
    const body = mine.length
      ? `<code>${esc(fn)}</code> に ${mine.length} 回<span class="th">${esc(names(mine))}</span>`
      : `<code>${esc(fn)}</code> にこの文脈では入っていない`;
    return `<span class="co-run" title="${esc(tip)}"><i></i>記録<span class="co-sep">:</span>${body}</span>`;
  }

  // ---------- execution contexts: the dashed frames of the map ----------
  const regionOf = (t, boxId) => (t.src.regions || []).find((r) => r.boxes.includes(boxId));
  // The context a step's code runs in: the frame around its from box; inside a paper, the frame
  // around the box the paper is drawn in.
  function contextOf(stack) {
    const lv = stack.length - 1, f = stack[lv], t = TRACKS[f.id];
    if (t.kind === 'flow') { const r = regionOf(t, t.steps[f.i].from); return r ? r.node : null; }
    for (let k = lv - 1; k >= 0; k--) {
      const pf = stack[k], pt = TRACKS[pf.id];
      if (pt.kind === 'flow') { const r = regionOf(pt, pt.steps[pf.i].to); return r ? r.node : null; }
    }
    return null;
  }
  function ctxHTML(id) {
    const n = id && A.nodes[id];
    if (!n) return '';
    const who = n.run && n.run.startsWith(n.title) ? `<b>${esc(n.run)}</b>` : `<b>${esc(n.title)}</b>${n.run ? ` · ${esc(n.run)}` : ''}`;
    return `<button type="button" class="co-ctx${n.kernel ? ' k' : ''}" data-detour="${esc(id)}" data-why="link" title="${esc(n.text || '')}"><i></i>走る ${who}</button>`;
  }

  // ---------- state ----------
  // A flow opens at the step its text names first (はじめ), a paper at its first step.
  const startOf = (id) => {
    const t = TRACKS[id], st = t.src.start;
    return t.kind === 'flow' && st && t.steps[st[0]] && !t.steps[st[0]].alt ? st[0] : t.main[0];
  };
  // touched: the reader has moved since the flow opened. Until then, the walk starts from step 1.
  const state = { stack: [{ id: A.flows[0].id, i: startOf(A.flows[0].id) }], detour: null, info: false, touched: false };
  const top = () => state.stack[state.stack.length - 1];
  let editor = false, lastKey = '', coOpen = false;

  function go(level, i) {
    state.stack.length = level + 1;
    state.stack[level].i = i;
    state.detour = null;
    update();
  }
  function next(quiet) {
    state.detour = null;
    for (let lv = state.stack.length - 1; lv >= 0; lv--) {
      const f = state.stack[lv], t = TRACKS[f.id], s = t.steps[f.i];
      const pos = t.main.indexOf(s.alt ? s.alt.at : f.i);
      if (pos + 1 < t.main.length) {
        state.stack.length = lv + 1;
        f.i = t.main[pos + 1];
        update();
        return true;
      }
    }
    if (!quiet) toast('流れの終わり。<kbd>Home</kbd> で最初へ');
    return false;
  }
  function prev() {
    state.detour = null;
    const lv = state.stack.length - 1, f = state.stack[lv], t = TRACKS[f.id], s = t.steps[f.i];
    if (s.alt) { f.i = s.alt.at; update(); return; }
    const pos = t.main.indexOf(f.i);
    if (pos > 0) { f.i = t.main[pos - 1]; update(); return; }
    if (lv > 0) { state.stack.pop(); update(); return; }
    toast('最初の手順');
  }
  function dive(level, i) {
    if (level != null) { state.stack.length = level + 1; state.stack[level].i = i; }
    const f = top(), p = paperOf(TRACKS[f.id], f.i);
    if (!p) return false;
    state.stack.push({ id: p, i: TRACKS[p].main[0] });
    state.detour = null;
    update();
    return true;
  }
  function out() {
    if (state.detour) { state.detour = null; update(); return true; }
    if (state.stack.length > 1) { state.stack.pop(); update(); return true; }
    return false;
  }
  function setFlow(id, first) {
    state.stack = [{ id, i: first ? TRACKS[id].main[0] : startOf(id) }];
    state.detour = null;
    state.touched = !!first;
    update();
  }
  function detour(id, why, fields) {
    if (!A.nodes[id]) return;
    state.detour = nodePlan(id, why, fields);
    renderCode();
  }

  // ---------- the guided walk: every step, into every paper once and out again ----------
  const clone = (st) => st.map((f) => ({ id: f.id, i: f.i }));
  function walkFrom(stack) {
    const st = clone(stack), seq = [clone(st)], dived = new Set(st.slice(1).map((f) => f.id));
    for (let guard = 0; guard < 400; guard++) {
      const f = st[st.length - 1], paper = paperOf(TRACKS[f.id], f.i);
      if (paper && !dived.has(paper)) { dived.add(paper); st.push({ id: paper, i: TRACKS[paper].main[0] }); }
      else {
        let moved = false;
        for (let lv = st.length - 1; lv >= 0 && !moved; lv--) {
          const fr = st[lv], tr = TRACKS[fr.id], s = tr.steps[fr.i];
          const pos = tr.main.indexOf(s.alt ? s.alt.at : fr.i);
          if (pos + 1 < tr.main.length) { st.length = lv + 1; fr.i = tr.main[pos + 1]; moved = true; }
        }
        if (!moved) break;
      }
      seq.push(clone(st));
    }
    return seq;
  }
  const stepMs = () => window.CODE_TOUR_STEP_MS || 4200;
  let play = null;
  // From the start until the reader has moved, at step 1 anyway, or when nothing is left from here.
  const atFirst = () => state.stack.length === 1 && state.stack[0].i === TRACKS[state.stack[0].id].main[0];
  const playsFromStart = () => !state.touched || atFirst() || walkFrom(state.stack).length < 2;
  function startPlay(fromStart) {
    stopPlay();
    const root = state.stack[0].id;
    if (fromStart) state.stack = [{ id: root, i: TRACKS[root].main[0] }];
    state.detour = null;
    play = { seq: walkFrom(state.stack), k: 0, timer: 0 };
    update();
    schedulePlay();
  }
  function stopPlay() {
    if (!play) return;
    clearTimeout(play.timer);
    play = null;
    state.touched = true;
    renderPlay();
  }
  function schedulePlay() {
    clearTimeout(play.timer);
    const bar = $('#playBar');
    bar.getAnimations().forEach((a) => a.cancel());
    bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: stepMs(), easing: 'linear', fill: 'forwards' });
    play.timer = setTimeout(stepPlay, stepMs());
  }
  function stepPlay() {
    if (!play) return;
    if (play.k + 1 >= play.seq.length) { stopPlay(); toast('最後の手順まで歩きました'); return; }
    play.k++;
    state.stack = clone(play.seq[play.k]);
    state.detour = null;
    update();
    schedulePlay();
  }
  function renderPlay() {
    const b = $('#play'), r = $('#replay'), fromStart = playsFromStart();
    b.setAttribute('aria-pressed', String(!!play));
    b.dataset.from = fromStart ? '1' : '';
    b.innerHTML = play
      ? `${ICON.pause}止める<small>${play.k + 1} / ${play.seq.length}</small>`
      : `${ICON.play}${fromStart ? '最初から歩く' : 'ここから歩く'}`;
    b.title = play ? '止める（Space）' : fromStart ? '手順 1 から順に歩く。紙があれば中へ入って出てくる（Space）' : '今の手順から順に歩く（Space）';
    r.hidden = !!play || fromStart;
    document.body.classList.toggle('playing', !!play);
    const hint = $('#hint'), t = TRACKS[state.stack[0].id];
    hint.innerHTML = !state.touched && !play && state.stack.length === 1 && isStart(t, state.stack[0].i)
      ? `地図の<b>はじめ</b>（手順 ${esc(t.labels[state.stack[0].i])}）を開いています · <button type="button" class="nl" data-first>1 から見る</button>`
      : '';
  }

  function writeHash() {
    const h = '#' + state.stack.map((f) => `${f.id}:${f.i}`).join('/');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return false;
    const frames = [];
    for (const part of h.split(/[/>]/)) {
      const k = part.lastIndexOf(':');
      const id = part.slice(0, k), i = Number(part.slice(k + 1));
      const t = TRACKS[id];
      if (!t || !Number.isInteger(i) || i < 0 || i >= t.steps.length) return false;
      if (frames.length === 0 && t.kind !== 'flow') return false;
      if (frames.length > 0) {
        const pf = frames[frames.length - 1];
        if (paperOf(TRACKS[pf.id], pf.i) !== id) return false;
      }
      frames.push({ id, i });
    }
    state.stack = frames;
    state.detour = null;
    state.touched = !(frames.length === 1 && frames[0].i === startOf(frames[0].id));
    return true;
  }

  // ---------- rendering helpers ----------
  // [[node]] links. "[[os.ui-protocol]] の handle" reads as ui_protocol.handle, not "… の handle" twice.
  function linkify(text) {
    return esc(text || '')
      .replace(/!?\[\[([^\]]+)\]\]( の ([A-Za-z_]\w*))?/g, (m, id, tail, word) => {
        const n = A.nodes[id];
        if (!n) return esc(id) + (tail || '');
        const link = `<button type="button" class="nl" data-detour="${esc(id)}" data-why="link">${esc(n.title)}</button>`;
        return word && n.title.endsWith('.' + word) ? link : link + (tail || '');
      })
      .replace(/\n/g, '<br>');
  }
  function boxChip(t, b) {
    const name = boxName(b);
    return `<span class="bx${isAscii(name) ? ' mono' : ''}" style="--lc:${col(boxLayer(t, b))}" title="${esc(b.title)}">${esc(name)}</span>`;
  }
  const fileName = (path) => (path || '').split('/').pop();
  const fileStem = (path) => fileName(path).replace(/\.unsafe\.mln$/, '').replace(/\.mln$/, '');
  function nodeName(id) {
    const n = A.nodes[id];
    return n ? n.title : id;
  }

  // ---------- head, chart, track ----------
  function renderFlows() {
    const root = state.stack[0].id;
    $('#flows').innerHTML = A.flows.map((f) => `<button type="button" role="tab" data-flow="${f.id}" aria-selected="${f.id === root}">${esc(f.tab)}</button>`).join('');
    $('#flowTitle').innerHTML = `${esc(TRACKS[root].title)}<small>${TRACKS[root].main.length} 手順</small>`;
    $('#eyebrow').textContent = A.title;
    // where the cursor is, when inside papers
    const where = $('#where');
    if (state.stack.length < 2) { where.innerHTML = ''; return; }
    where.innerHTML = state.stack.map((f, lv) => {
      const t = TRACKS[f.id];
      const name = lv === 0 ? t.tab : t.title;
      return lv < state.stack.length - 1
        ? `<button type="button" class="nl" data-pop="${lv}">${esc(name)}</button> の ${esc(t.labels[f.i])}`
        : `<b>${esc(name)}</b>`;
    }).join(' › ');
  }

  function renderChart() {
    const f = top(), t = TRACKS[f.id];
    const rows = t.kind === 'flow'
      ? STACK.map((id) => ({ id, name: LAYER[id].name, tone: id }))
      : t.bands.map((b) => ({ id: b.id, name: b.name, tone: b.tone }));
    const el = $('#chart');
    const W = Math.max(300, el.clientWidth - 44 || 380), labelW = 84, rowH = t.kind === 'flow' ? 15 : 19, top0 = 4;
    const n = t.main.length, cw = (W - labelW - 4) / n;
    const yOf = (rowId) => top0 + rows.findIndex((r) => r.id === rowId) * rowH + rowH / 2;
    const cur = t.main.indexOf(t.steps[f.i].alt ? t.steps[f.i].alt.at : f.i);
    const Hh = top0 + rows.length * rowH + 20;
    let s = `<svg viewBox="0 0 ${W} ${Hh}" height="${Hh}" role="img" aria-label="${esc(t.kind === 'flow' ? '流れが通る層' : '紙の中の帯')}">`;
    rows.forEach((r, k) => {
      s += `<rect class="row-bg" x="${labelW - 6}" y="${top0 + k * rowH + 1}" width="${W - labelW + 6}" height="${rowH - 2}" rx="4" fill="${col(r.tone)}"/>`;
      s += `<rect class="row-sw" x="${labelW - 14}" y="${top0 + k * rowH + rowH / 2 - 4}" width="3" height="8" rx="1.5" fill="${col(r.tone)}"/>`;
      s += `<text class="row-label" x="${labelW - 18}" y="${top0 + k * rowH + rowH / 2 + 4}" text-anchor="end">${esc(r.name)}</text>`;
    });
    if (cur >= 0) s += `<rect class="colnow" x="${labelW + cur * cw}" y="${top0 - 2}" width="${cw}" height="${rows.length * rowH + 4}" rx="4"/>`;
    t.main.forEach((i, k) => {
      const st = t.steps[i], fb = t.box[st.from], tb = t.box[st.to];
      const x0 = labelW + k * cw + 3, x1 = labelW + (k + 1) * cw - 3, y0 = yOf(fb.layer), y1 = yOf(tb.layer);
      const cls = k === cur ? 'now' : k < cur ? 'past' : '';
      const mx = (x0 + x1) / 2;
      s += `<path class="seg ${cls}" d="M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}"/>`;
      s += `<circle class="dot" cx="${x1}" cy="${y1}" r="${k === cur ? 4 : 3}" fill="${col(boxLayer(t, tb))}"/>`;
      s += `<text class="num ${k === cur ? 'now' : ''}${isStart(t, i) ? ' start' : ''}" x="${labelW + k * cw + cw / 2}" y="${Hh - 4}">${esc(t.labels[i])}</text>`;
      s += `<rect class="hit" data-go="${state.stack.length - 1}:${i}" x="${labelW + k * cw}" y="0" width="${cw}" height="${Hh}"><title>${esc(t.labels[i] + ' ' + stepTitle(st))}</title></rect>`;
    });
    s += '</svg>';
    el.innerHTML = `<p class="chart-cap">${t.kind === 'flow' ? '手順が行き来する層' : '紙の中の帯（' + esc(t.title) + '）'}</p>` + s;
  }

  function stepRow(t, i, level) {
    const s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
    const title = s.verb
      ? `<span class="verb">${esc(s.verb)}</span>`
      : `<span class="verb sentence">${esc(stepTitle(s))}</span>`;
    const kind = `<span class="kind" title="${esc(KIND_STEP[s.kind] || s.kind)}">${kindIcon(s.kind)}${s.verb ? esc(KIND_STEP[s.kind] || s.kind) : ''}</span>`;
    const start = isStart(t, i) ? '<span class="start-tag" title="地図がこの流れで最初に見せる手順。1 から見るなら Home か「最初から歩く」">地図のはじめ</span>' : '';
    const paper = paperOf(t, i) ? `<span class="paper-tag" title="着く箱の中に紙がある">${ICON.paper}中の紙</span>` : '';
    const when = s.alt ? `<span class="when">もし${esc(s.alt.when)}</span>` : '';
    const current = level === state.stack.length - 1 && top().i === i;
    return `<button type="button" class="row${s.verb ? '' : ' no-verb'}" data-go="${level}:${i}"${current ? ' aria-current="step"' : ''} title="${esc(s.label || '')}">
      <span class="num">${esc(t.labels[i])}</span>
      <span class="body"><span class="line1">${when}${title}${start}${paper}${kind}</span>
      <span class="line2">${boxChip(t, fb)}<span class="to"><span class="ar">→</span>${boxChip(t, tb)}</span></span></span></button>`;
  }

  function moreHTML(t, i, level) {
    const s = t.steps[i];
    let h = '';
    if (s.alt) h += `<div class="m-row"><span class="m-k">もし</span><span class="m-v">${esc(s.alt.when)}なら、${esc(t.labels[s.alt.at])} の代わりにこちら</span></div>`;
    if (s.data) {
      const d = s.data;
      h += '<div class="m-row"><span class="m-k">渡す</span><span class="m-v">';
      h += d.schema && A.nodes[d.schema]
        ? `<button type="button" class="chip" data-detour="${esc(d.schema)}" data-why="data" data-fields="${esc((d.fields || []).join('|'))}" title="形をコードで見る">${esc(d.label)}</button>`
        : `<code class="chip plain">${esc(d.label)}</code>`;
      if (d.fields && d.fields.length) h += `<span class="fields">${d.fields.map((x) => `<code>${esc(x)}</code>`).join('')}</span>`;
      if (d.type) h += `<span class="dtype">${esc(d.type)}</span>`;
      h += '</span></div>';
      if (d.note) h += `<p class="m-note">${linkify(d.note)}</p>`;
    }
    if (s.ops) {
      h += `<div class="m-row"><span class="m-k">操作</span><span class="m-v">${s.ops.map((o) => `<button type="button" class="nl" data-detour="${esc(o.node)}" data-why="link">${esc(nodeName(o.node))}</button> に<b>${esc(o.kind)}</b>`).join('、')}</span></div>`;
    }
    if (s.branches) {
      h += `<div class="m-row"><span class="m-k">分かれる</span><ul class="m-br">${s.branches.map(([w, r]) => `<li><b>${linkify(w)}</b><span class="ar"> → </span>${linkify(r)}</li>`).join('')}</ul></div>`;
    }
    const paper = paperOf(t, i);
    if (paper && level === state.stack.length - 1) {
      const pt = TRACKS[paper], tone = trackTone(pt);
      h += `<button type="button" class="dive" data-dive="${level}:${i}" style="--tone:${col(tone)}">${ICON.dive}<span><span class="dv-t">中の紙へ入る</span><br><span class="dv-s">${esc(pt.title)} · ${pt.main.length} 手順</span></span><kbd>Enter</kbd></button>`;
    }
    return h;
  }

  function trackHTML(level) {
    const fr = state.stack[level], t = TRACKS[fr.id];
    const deepest = level === state.stack.length - 1;
    const curPos = t.main.indexOf(t.steps[fr.i].alt ? t.steps[fr.i].alt.at : fr.i);
    let h = `<ol class="steps">`;
    const item = (i, alt) => {
      const pos = t.main.indexOf(i);
      let cls = 'step' + (alt ? ' alt' : '');
      if (fr.i === i) cls += deepest ? ' is-active' : ' is-host';
      else if (!alt && pos < curPos) cls += ' is-past';
      let x = `<li class="${cls}">${stepRow(t, i, level)}`;
      if (fr.i === i && deepest && !state.mobile) {
        const m = moreHTML(t, i, level);
        if (m) x += `<div class="more${lastKey !== keyOf() ? ' enter' : ''}">${m}</div>`;
      }
      if (fr.i === i && !deepest) x += paperHTML(level + 1);
      return x + '</li>';
    };
    for (const i of t.main) {
      h += item(i, false);
      if (t.alts[i]) h += `<li><ol class="alts">${t.alts[i].map((ai) => item(ai, true)).join('')}</ol></li>`;
    }
    return h + '</ol>';
  }
  function paperHTML(level) {
    const t = TRACKS[state.stack[level].id], tone = trackTone(t);
    const fresh = !renderTrack.open || !renderTrack.open.includes(t.id);
    return `<div class="paper${fresh ? ' enter' : ''}${level > 1 ? ' nested' : ''}" style="--tone:${col(tone)}">
      <div class="paper-head">${ICON.paper}<span class="pt" title="${esc(t.title)} · ${t.main.length} 手順">${esc(t.title)}<small>${t.main.length} 手順</small></span>
      <button type="button" class="out" data-pop="${level - 1}" title="紙の外へ（Esc）">外へ<kbd>Esc</kbd></button></div>${trackHTML(level)}</div>`;
  }
  const keyOf = () => state.stack.map((f) => f.id + ':' + f.i).join('>');

  function renderTrack() {
    const tr = $('#track');
    tr.innerHTML = trackHTML(0);
    renderTrack.open = state.stack.slice(1).map((f) => f.id);
    const active = tr.querySelector('.step.is-active');
    if (!active) return;
    // The active step in view, below the heads of the papers it is in (they stick to the top).
    const r = active.getBoundingClientRect(), b = tr.getBoundingClientRect();
    let heads = 0;
    for (let p = active.closest('.paper'); p; p = p.parentElement.closest('.paper')) heads += p.querySelector(':scope > .paper-head').offsetHeight;
    const room = b.top + heads + 8;
    if (r.top < room || r.bottom > b.bottom - 10) {
      const y = tr.scrollTop + (r.top - b.top) - Math.max(heads + 12, Math.min(b.height * 0.3, b.height - r.height - 12));
      tr.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  // ---------- route: the files the track passes through ----------
  function routeStops(t) {
    const stops = [];
    for (const i of t.main) {
      const p = plan(t, i);
      if (!p.path) continue;
      const layer = (A.nodes[p.bandNode || p.node] || {}).layer;
      const last = stops[stops.length - 1];
      if (last && last.path === p.path) last.steps.push(i);
      else stops.push({ path: p.path, layer, steps: [i] });
    }
    return stops;
  }
  function renderRoute() {
    const lv = state.stack.length - 1, f = top(), t = TRACKS[f.id];
    const stops = routeStops(t);
    const at = t.steps[f.i].alt ? t.steps[f.i].alt.at : f.i;
    const cur = stops.findIndex((s) => s.steps.includes(at));
    $('#route').innerHTML = `<span class="route-k">通るファイル</span><ol class="stops">${stops.map((s, k) => {
      const cls = k === cur ? 'now' : k < cur ? 'past' : '';
      return `<li class="stop ${cls}" style="--lc:${col(s.layer)}"><button type="button" data-go="${lv}:${s.steps[0]}" title="${esc(s.path)}（手順 ${s.steps.map((i) => t.labels[i]).join('・')}）"><i></i>${esc(fileStem(s.path))}</button></li>`;
    }).join('')}</ol>`;
    const ol = $('#route .stops'), now = $('#route .stop.now');
    if (now && ol.scrollWidth > ol.clientWidth) {
      const left = now.offsetLeft - ol.offsetLeft - ol.clientWidth / 2 + now.offsetWidth / 2;
      ol.scrollLeft = Math.max(0, left);
    }
    routeFade();
  }

  function routeFade() {
    const ol = $('#route .stops');
    if (!ol) return;
    const over = ol.scrollWidth > ol.clientWidth + 1;
    ol.style.setProperty('--fl', over && ol.scrollLeft > 2 ? '28px' : '0px');
    ol.style.setProperty('--fr', over && ol.scrollLeft + ol.clientWidth < ol.scrollWidth - 2 ? '28px' : '0px');
  }
  document.addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('stops')) routeFade(); }, true);

  // ---------- the code panel ----------
  const FILE = {};
  const V = { path: null, plan: null, bandEl: null, touched: [], marked: [], echo: [], mk: null, pill: null, callout: null, coH: 0, sigTop: -1, bandEnd: -1 };
  function fileView(path) {
    if (FILE[path]) return FILE[path];
    const tok = H.tokenize(SRC[path], path);
    const el = document.createElement('div');
    el.className = 'file';
    const digits = String(tok.length).length;
    el.style.setProperty('--gw', `${30 + digits * 8 + 14}px`);
    el.innerHTML = tok.map((l, k) => `<div class="ln"><span class="g"><span class="mk"></span><span class="no">${k + 1}</span></span><span class="tx">${H.lineHTML(l)}</span></div>`).join('');
    return (FILE[path] = { el, tok, lines: Array.from(el.children), gw: 30 + digits * 8 + 14 });
  }
  function clearView() {
    const f = V.path && FILE[V.path];
    if (!f) return;
    for (const k of V.marked) f.lines[k - 1].lastChild.innerHTML = H.lineHTML(f.tok[k - 1]);
    for (const k of V.touched) f.lines[k - 1].classList.remove('in-band', 'main', 'likely', 'sig', 'hit', 'stuck', 'unstick');
    if (V.mk) V.mk.innerHTML = '';
    if (V.pill) V.pill.remove();
    if (V.callout) V.callout.remove();
    if (V.bandEl) {
      const b = V.bandEl;
      while (b.firstChild) b.parentNode.insertBefore(b.firstChild, b);
      b.remove();
    }
    Object.assign(V, { bandEl: null, touched: [], marked: [], echo: [], mk: null, pill: null, callout: null, coH: 0, sigTop: -1, bandEnd: -1 });
  }
  const lineTop = (n) => PAD + (n - 1) * LH + (V.plan && V.plan.main && n > V.plan.main ? V.coH : 0) + (V.plan && !V.plan.main ? V.coH : 0);

  function emptyHTML(p) {
    const n = A.nodes[p.node];
    if (!n) return '<div class="empty"><div class="empty-card"><p>コードがありません。</p></div></div>';
    const why = !Object.keys(SRC).length
      ? 'ソースを読めませんでした。lab を serve.sh か server.py で開くと、コードが出ます。'
      : 'この箱が指すコードは、地図に書かれていません。';
    let extra = '';
    if (n.kind === 'context') {
      const t = TRACKS[state.stack[0].id], r = (t.src.regions || []).find((x) => x.node === p.node);
      extra += '<dl class="ctx-dl">';
      if (n.run) extra += `<dt>走るもの</dt><dd>${esc(n.run)}</dd>`;
      if (n.kernel) extra += '<dt>カーネルの中</dt><dd>はい（カーネルの権限で走る）</dd>';
      if (r) extra += `<dt>${esc(t.tab)} で中にある箱</dt><dd>${r.boxes.map((b) => boxChip(t, t.box[b])).join(' ')}</dd>`;
      extra += '</dl>';
    }
    return `<div class="empty"><div class="empty-card"><span class="ni-kind">${esc(KIND_NODE[n.kind] || n.kind)}</span><h3>${esc(n.title)}</h3><p>${linkify(n.text)}</p>${extra}<p class="empty-why">${why}</p>${p.detour ? '<button type="button" class="co-back" data-out>手順に戻る <kbd>Esc</kbd></button>' : ''}</div></div>`;
  }

  // How sure the marked line is, said plainly.
  function whereHTML(p) {
    const own = LN && LN.span(p.node);
    let inside = '';
    if (p.main && p.bandNode && p.bandNode !== p.node && !inSpan(own, p.path, p.main)) inside = `<span class="co-in">${esc(codeName(p.bandNode))} の中</span>`;
    else if (p.outside && p.fn && p.rel === 'calls') inside = `<span class="co-in">${esc(p.fn)} の中（${esc(codeName(p.node))} が呼ぶ）</span>`;
    else if (p.outside) inside = `<span class="co-in">${esc(codeName(p.node))} の外（同じファイル）</span>`;
    switch (p.mainKind) {
      case 'step': return `<span class="co-where on" title="地図（code.json）が記録した、この手順が起きる行">起きる行 ${p.main}</span>${inside}`;
      case 'focus': return `<span class="co-where on" title="この箱は文 1 つ。その文の行">起きる行 ${p.main}</span>${inside}`;
      case 'likely': return `<span class="co-where likely" title="地図に起きる行の記録が無いので、手がかりから推した行（点線）。手がかり：${esc(p.why)}">たぶんここ ${p.main}<small>${esc(p.why)}</small></span>${inside}`;
      case 'fields': return `<span class="co-where fields" title="手順が挙げる欄の行">欄 ${p.hits.join('・')} 行</span>`;
      case 'def': return '<span class="co-where" title="この手順が起きる行は分からないので、手順を説明する箱のコード全体を示しています">箱のコード全体</span>';
      case 'file': return '<span class="co-where" title="定義の行が地図に無いので、ファイルを示しています">ファイル全体</span>';
      default: return '';
    }
  }
  function stepCallout(p) {
    const t = p.track, s = p.step, fb = t.box[s.from], tb = t.box[s.to];
    let h = `<div class="co-head"><span class="badge${s.alt ? ' alt' : ''}${p.mainKind === 'likely' ? ' likely' : ''}">${esc(t.labels[p.i])}</span>`;
    if (s.verb) h += `<span class="co-verb">${esc(s.verb)}</span>`;
    h += `<span class="co-kind">${kindIcon(s.kind)}${esc(KIND_STEP[s.kind] || s.kind)}</span>`;
    h += `<span class="co-ft">${boxChip(t, fb)}<span class="ar">→</span>${boxChip(t, tb)}</span>`;
    h += `<button type="button" class="co-more" data-comore aria-expanded="${coOpen}">${coOpen ? 'たたむ' : 'くわしく'}</button></div>`;
    if (s.alt) h += `<div class="co-when">もし${esc(s.alt.when)}（${esc(t.labels[s.alt.at])} の代わり）</div>`;
    if (s.label) h += `<p class="co-text${s.verb ? '' : ' lead'}">${linkify(s.label)}</p>`;
    const ctx = contextOf(state.stack);
    let foot = whereHTML(p) + ctxHTML(ctx) + runHTML(p.bandNode, ctx);
    if (p.arrival) {
      const a = p.arrival;
      foot += `<button type="button" class="co-arrive" data-detour="${esc(a.node)}" data-why="arrive" title="着く先のコードへ">着く先 <b>${esc(nodeName(a.node))}</b><span>${esc(fileName(a.path))}${a.line ? ':' + a.line : ''}</span></button>`;
    }
    if (foot) h += `<div class="co-foot">${foot}</div>`;
    return h;
  }
  function detourCallout(p) {
    const n = A.nodes[p.node], f = top(), t = TRACKS[f.id];
    const why = { data: '渡すデータの形', arrive: '着く先', link: 'リンク先' }[p.why] || '寄り道';
    let h = `<div class="co-head"><span class="badge ghost">寄り道</span><span class="co-verb">${esc(n.title)}</span><span class="co-kind">${esc(KIND_NODE[n.kind] || n.kind)} · ${why}</span></div>`;
    if (p.hits && p.hits.length) h += `<p class="co-text">手順 ${esc(t.labels[f.i])} が挙げている欄に印を付けた。</p>`;
    else if (p.mainKind === 'focus') h += `<p class="co-text">この箱が表す文は ${p.main} 行。</p>`;
    h += `<div class="co-foot"><button type="button" class="co-back" data-out>手順 ${esc(t.labels[f.i])} に戻る <kbd>Esc</kbd></button>${runHTML(p.node, null)}</div>`;
    return h;
  }

  function renderHead(p) {
    const head = $('#fileHead');
    if (!p.path) { head.innerHTML = p.detour ? '<span class="detour-pill">寄り道</span>' : ''; return; }
    const n = A.nodes[p.node] || {}, l = C.nodes[p.bandNode || p.node] || {}, file = C.files[p.path] || {};
    const parts = p.path.split('/'), name = parts.pop();
    const layer = n.layer;
    let h = '';
    if (p.detour) h += '<span class="detour-pill">寄り道</span>';
    h += `<span class="fh-layer" style="--lc:${col(layer)}"><i></i><span>${esc((LAYER[layer] || {}).name || '')}</span></span>`;
    h += `<span class="fh-path" title="${esc(p.path)}"><span class="dir">${esc(parts.join('/'))}/</span><b>${esc(name)}</b></span>`;
    if (p.band) h += `<span class="fh-meta">${l.symbol ? `<code>${esc(l.symbol)}</code> ` : ''}${p.band[0] === p.band[1] ? p.band[0] : p.band[0] + '–' + p.band[1]} 行</span>`;
    h += `<span class="fh-lang">${esc(LANG[file.lang] || file.lang || '')} · ${file.lines || ''} 行</span>`;
    if (editor) h += `<button type="button" class="fh-open" data-open="${esc(p.path)}:${p.main || (p.band && p.band[0]) || 1}" title="VS Code で開く">${ICON.open}エディタで開く</button>`;
    head.innerHTML = h;
  }

  function renderInfo(p) {
    const box = $('#nodeInfo'), n = A.nodes[p.node];
    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.toggle('open', state.info);
    const title = n.title;
    let h = `<div class="ni-top"><span class="ni-kind">${esc(KIND_NODE[n.kind] || n.kind)}</span><span class="ni-title${isAscii(title) ? ' mono' : ''}">${esc(title)}</span>`;
    h += `<span class="ni-text">${linkify(n.text).replace(/<br>/g, ' ')}</span><button type="button" class="ni-toggle" data-info>${state.info ? 'たたむ' : '詳しく'}</button></div>`;
    if (state.info) {
      let x = '';
      const api = n.api || {};
      if (api.sig) x += `<div class="ni-sig">${esc(api.sig)}</div>`;
      if (api.params && api.params.length) x += `<div><div class="ni-cap">引数</div><table class="ni-table">${api.params.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${linkify(v)}</td></tr>`).join('')}</table></div>`;
      if (api.ret) x += `<div><div class="ni-cap">返す値</div><div class="dtype">${linkify(api.ret)}</div></div>`;
      if (n.fields && n.fields.length) x += `<div><div class="ni-cap">欄</div><table class="ni-table">${n.fields.map((r) => `<tr><td>${esc(r.slice(0, 2).join(' '))}</td><td>${linkify(r[2] || '')}</td></tr>`).join('')}</table></div>`;
      if (n.values && n.values.length) x += `<div><div class="ni-cap">値</div><table class="ni-table">${n.values.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${linkify(v || '')}</td></tr>`).join('')}</table></div>`;
      for (const m of (n.text || '').matchAll(/!\[\[([^\]]+)\]\]/g)) {
        const fig = A.nodes[m[1]];
        if (fig && fig.figure) x += `<div class="ni-fig"><div class="ni-cap">${esc(fig.title)}</div>${fig.figure}<div class="dtype">${linkify(fig.text)}</div></div>`;
      }
      if (n.figure) x += `<div class="ni-fig">${n.figure}</div>`;
      if (x) h += `<div class="ni-extra">${x}</div>`;
    }
    box.innerHTML = h;
  }

  function renderCode() {
    const f = top(), t = TRACKS[f.id];
    const p = state.detour || plan(t, f.i);
    renderHead(p);
    renderInfo(p);
    showPlan(p);
  }

  function showPlan(p) {
    const box = $('#code'), sc = $('#codeScroll');
    if (!LN) { box.innerHTML = '<div class="loading">ソースを読んでいます…</div>'; return; }
    if (!p.path || !SRC[p.path]) {
      clearView();
      V.path = null; V.plan = p;
      box.innerHTML = emptyHTML(p);
      sc.scrollTop = 0;
      $('#ruler').innerHTML = '';
      return;
    }
    const f = fileView(p.path);
    const switching = V.path !== p.path;
    clearView();
    if (switching) { box.replaceChildren(f.el); V.path = p.path; }
    V.plan = p;
    sc.style.setProperty('--cw', `${Math.min(760, sc.clientWidth - f.gw - 40)}px`);
    const words = p.step ? CL.wordsOf(p.step) : null;
    if (p.band) {
      const [s, e] = p.band;
      const b = document.createElement('div');
      b.className = 'band';
      b.style.setProperty('--lc', col((A.nodes[p.bandNode || p.node] || {}).layer));
      f.lines[s - 1].before(b);
      for (let k = s; k <= e; k++) {
        const ln = f.lines[k - 1];
        b.append(ln);
        ln.classList.add('in-band');
        V.touched.push(k);
        if (words && words.size) {
          const html = H.lineHTML(f.tok[k - 1], words);
          ln.lastChild.innerHTML = html;
          V.marked.push(k);
          if (html.includes('<mark')) V.echo.push(k);
        }
      }
      V.bandEl = b;
      if (p.sig && e - s >= 3) { f.lines[p.sig - 1].classList.add('sig'); V.sigTop = p.sig; V.bandEnd = e; }
    }
    if (p.hits) for (const k of p.hits) { f.lines[k - 1].classList.add('hit'); V.touched.push(k); }
    // Distinctive words (SET_TEXT, ui_protocol) are marked across the file; short ones only in the band.
    if (words && words.size) {
      const wide = new Set([...words].filter(CL.distinctive));
      if (wide.size) {
        const inBand = (k) => p.band && k >= p.band[0] && k <= p.band[1];
        const re = new RegExp(`\\b(${[...wide].map(reEsc).join('|')})\\b`);
        RAW[p.path].forEach((line, j) => {
          const k = j + 1;
          if (inBand(k) || !re.test(line)) return;
          const html = H.lineHTML(f.tok[j], wide);
          f.lines[j].lastChild.innerHTML = html;
          V.marked.push(k);
          if (html.includes('<mark')) V.echo.push(k);
        });
      }
    }
    if (p.main) {
      const ln = f.lines[p.main - 1];
      ln.classList.add('main');
      if (p.mainKind === 'likely') ln.classList.add('likely');
      V.touched.push(p.main);
      if (!p.band && words && words.size) { ln.lastChild.innerHTML = H.lineHTML(f.tok[p.main - 1], words); V.marked.push(p.main); }
      V.mk = ln.querySelector('.mk');
      V.mk.innerHTML = p.detour ? '<span class="badge ghost" style="padding:0 5px">•</span>'
        : `<span class="badge${p.step.alt ? ' alt' : ''}${p.mainKind === 'likely' ? ' likely' : ''}">${esc(p.track.labels[p.i])}</span>`;
    }
    if (!p.detour && p.arrival && p.arrival.path === p.path && p.arrival.line && p.arrival.line !== p.main) {
      const pill = document.createElement('span');
      pill.className = 'arrive-pill';
      pill.textContent = `着く先 · ${nodeName(p.arrival.node)}`;
      f.lines[p.arrival.line - 1].lastChild.append(pill);
      V.pill = pill;
    }
    const co = document.createElement('div');
    co.className = 'callout' + (p.detour ? ' detour' : '') + (p.main ? '' : ' at-top') + (p.mainKind === 'likely' ? ' likely' : '') + (coOpen ? ' open' : '');
    co.innerHTML = p.detour ? detourCallout(p) : stepCallout(p);
    if (p.main) f.lines[p.main - 1].after(co); else f.el.prepend(co);
    V.callout = co;
    measureCallout();

    // Scroll: the band's head in view when the callout still fits under it, else the line at a third.
    const Hh = sc.clientHeight;
    const anchor = p.main || (p.band ? p.band[0] : 1);
    const aTop = lineTop(anchor), aBottom = aTop + LH + (p.main ? V.coH : 0);
    let y;
    if (state.mobile && p.main) y = aTop - 3 * LH;   // a phone sees only the top of the panel
    else if (p.band) {
      y = lineTop(p.band[0]) - 2 * LH - (p.band[0] > 1 && /^\s*\/?\*/.test(RAW[p.path][p.band[0] - 2] || '') ? 2 * LH : 0);
      if (aBottom - y > Hh - 2 * LH) y = aTop - Math.round(Hh * 0.3);
    } else y = p.main ? aTop - Math.round(Hh * 0.3) : 0;
    y = Math.max(0, Math.round(y));
    if (switching) {
      sc.scrollTop = y; sc.scrollLeft = 0;
      if (V.shown) box.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    } else {
      sc.scrollTo({ top: y, left: 0, behavior: 'smooth' });
    }
    if (V.shown) co.animate([{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    V.shown = true;
    renderRuler(p);
    onCodeScroll();
  }
  function measureCallout() {
    const co = V.callout;
    if (!co) return;
    const cs = getComputedStyle(co);
    V.coH = co.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  }
  // The function's head stays at the top while you read inside it, and lets go one line before
  // its last line, so it never sits on the closing brace.
  function onCodeScroll() {
    const sc = $('#codeScroll');
    const vp = $('#ruler .vp');
    if (vp && sc.scrollHeight) {
      vp.style.top = `${(sc.scrollTop / sc.scrollHeight) * 100}%`;
      vp.style.height = `${Math.max(2, (sc.clientHeight / sc.scrollHeight) * 100)}%`;
    }
    if (V.sigTop < 0 || !V.path) return;
    const f = FILE[V.path], y = sc.scrollTop, ln = f.lines[V.sigTop - 1];
    const release = y >= lineTop(V.bandEnd) - LH;
    ln.classList.toggle('unstick', release);
    ln.classList.toggle('stuck', !release && y > lineTop(V.sigTop) - PAD + 1);
  }
  // The overview ruler: where the band, the line and the arrival sit in the whole file.
  function renderRuler(p) {
    const r = $('#ruler'), sc = $('#codeScroll');
    if (!p.path || !SRC[p.path]) { r.innerHTML = ''; return; }
    const total = sc.scrollHeight || 1;
    const pct = (px) => `${(px / total) * 100}%`;
    let h = '';
    if (p.band) {
      const y0 = lineTop(p.band[0]), y1 = lineTop(p.band[1]) + LH;
      h += `<i class="r-band" style="top:${pct(y0)};height:max(3px,${pct(y1 - y0)});--lc:${col((A.nodes[p.bandNode || p.node] || {}).layer)}"></i>`;
    }
    for (const k of p.hits || []) h += `<i class="r-hit" style="top:${pct(lineTop(k))}"></i>`;
    for (const k of V.echo) h += `<i class="r-echo" style="top:${pct(lineTop(k))}" title="${k} 行：手順の文に出てくる名前"></i>`;
    if (!p.detour && p.arrival && p.arrival.path === p.path && p.arrival.line) h += `<i class="r-arrive" style="top:${pct(lineTop(p.arrival.line))}"></i>`;
    if (p.main) h += `<i class="r-main${p.mainKind === 'likely' ? ' likely' : ''}" style="top:${pct(lineTop(p.main))}"></i>`;
    r.innerHTML = h + '<i class="vp"></i>';
  }

  // ---------- phone ----------
  function renderMobile() {
    const lv = state.stack.length - 1, f = top(), t = TRACKS[f.id];
    $('#mStrip').innerHTML = (lv > 0 ? `<button type="button" data-pop="${lv - 1}">↑ 外へ</button>` : '')
      + t.main.map((i) => {
        const s = t.steps[i];
        const name = s.verb ? esc(s.verb) : `<span class="ar">→</span>${esc(boxName(t.box[s.to]))}`;
        return `<button type="button" data-go="${lv}:${i}" aria-current="${i === f.i || (t.steps[f.i].alt && t.steps[f.i].alt.at === i)}"><span class="num">${esc(t.labels[i])}</span>${name}</button>`;
      }).join('');
    const s = t.steps[f.i];
    const m = moreHTML(t, f.i, lv);
    $('#mCard').innerHTML = `<ol class="steps"><li class="step is-active${s.alt ? ' alt' : ''}">${stepRow(t, f.i, lv)}${m ? `<div class="more">${m}</div>` : ''}</li></ol>`;
    const cur = $('#mStrip [aria-current="true"]');
    if (cur && state.mobile) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    const d = $('#mDive');
    if (paperOf(t, f.i)) { d.textContent = '中の紙へ'; d.dataset.act = 'dive'; d.disabled = false; }
    else if (lv > 0) { d.textContent = '外へ'; d.dataset.act = 'out'; d.disabled = false; }
    else { d.textContent = '中の紙へ'; d.dataset.act = 'dive'; d.disabled = true; }
  }

  // ---------- update ----------
  function update() {
    state.mobile = matchMedia('(max-width: 860px)').matches;
    renderFlows();
    renderChart();
    renderTrack();
    renderRoute();
    renderCode();
    renderMobile();
    renderPlay();
    lastKey = keyOf();
    writeHash();
  }

  let toastTimer = 0;
  function toast(html) {
    const el = $('#toast');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---------- events ----------
  const togglePlay = () => (play ? stopPlay() : startPlay($('#play').dataset.from === '1'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('#play')) { togglePlay(); return; }
    if (e.target.closest('#replay')) { startPlay(true); return; }
    if (e.target.closest('[data-comore]')) {
      coOpen = !coOpen;
      if (V.callout) {
        V.callout.classList.toggle('open', coOpen);
        const b = V.callout.querySelector('[data-comore]');
        b.textContent = coOpen ? 'たたむ' : 'くわしく';
        b.setAttribute('aria-expanded', String(coOpen));
        measureCallout();
        renderRuler(V.plan);
      }
      return;
    }
    const el = e.target.closest('[data-go],[data-dive],[data-detour],[data-flow],[data-pop],[data-out],[data-info],[data-open],[data-act],[data-first]');
    if (!el) return;
    stopPlay();
    const moves = !(el.dataset.detour || el.dataset.flow || el.hasAttribute('data-info') || el.dataset.open);
    if (moves) state.touched = true;
    if (el.dataset.go) { const [lv, i] = el.dataset.go.split(':').map(Number); go(lv, i); }
    else if (el.dataset.dive) { const [lv, i] = el.dataset.dive.split(':').map(Number); dive(lv, i); }
    else if (el.dataset.detour) {
      const fields = el.dataset.fields ? el.dataset.fields.split('|').filter(Boolean) : null;
      detour(el.dataset.detour, el.dataset.why, fields);
    } else if (el.dataset.flow) setFlow(el.dataset.flow);
    else if (el.dataset.pop) { state.stack.length = Number(el.dataset.pop) + 1; state.detour = null; update(); }
    else if (el.hasAttribute('data-out')) out();
    else if (el.hasAttribute('data-info')) { state.info = !state.info; renderInfo(state.detour || plan(TRACKS[top().id], top().i)); }
    else if (el.dataset.open) openInEditor(el.dataset.open);
    else if (el.hasAttribute('data-first')) setFlow(state.stack[0].id, true);
    else if (el.dataset.act) ({ prev, next, dive: () => dive(), out })[el.dataset.act]();
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); togglePlay(); return; }
    const nav = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Home', 'End'].includes(e.key);
    if (nav) stopPlay();
    const inTrack = e.target.closest && e.target.closest('#track');
    if (e.key === 'ArrowRight' || (inTrack && e.key === 'ArrowDown')) { e.preventDefault(); state.touched = true; next(); }
    else if (e.key === 'ArrowLeft' || (inTrack && e.key === 'ArrowUp')) { e.preventDefault(); state.touched = true; prev(); }
    else if (e.key === 'Enter') {
      const onControl = e.target.closest && e.target.closest('button,a');
      const here = `${state.stack.length - 1}:${top().i}`;
      if (onControl && !(onControl.classList.contains('row') && onControl.dataset.go === here)) return;
      if (paperOf(TRACKS[top().id], top().i)) { e.preventDefault(); state.touched = true; dive(); }
    } else if (e.key === 'Escape') { if (out()) { state.touched = true; e.preventDefault(); } }
    else if (e.key === 'Home') { e.preventDefault(); setFlow(state.stack[0].id, true); }
    else if (e.key === 'End') {
      e.preventDefault();
      const id = state.stack[0].id;
      state.stack = [{ id, i: TRACKS[id].main[TRACKS[id].main.length - 1] }];
      state.detour = null; state.touched = true;
      update();
    }
  });
  $('#codeScroll').addEventListener('scroll', onCodeScroll, { passive: true });
  $('#ruler').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(), sc = $('#codeScroll');
    sc.scrollTo({ top: ((e.clientY - r.top) / r.height) * sc.scrollHeight - sc.clientHeight / 2, behavior: 'smooth' });
  });
  window.addEventListener('hashchange', () => { if (readHash()) { stopPlay(); update(); } });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      state.mobile = matchMedia('(max-width: 860px)').matches;
      renderChart(); renderMobile();
      const sc = $('#codeScroll'), f = V.path && FILE[V.path];
      if (f) sc.style.setProperty('--cw', `${Math.min(760, sc.clientWidth - f.gw - 40)}px`);
    }, 120);
  });

  // ---------- the editor, through server.py when it runs ----------
  // server.py marks its responses; plain static servers (serve.sh, the screenshot tool) do not,
  // so the page never asks them for /open.
  async function probeEditor() {
    try {
      const r = await fetch('./index.html', { cache: 'no-store' });
      if (!r.headers.get('X-Code-Tour-Editor')) return false;
      const q = await fetch('../open?probe=1', { headers: { 'X-Code-Tour': '1' } });
      return q.ok && !!(await q.json()).ok;
    } catch (e) { return false; }
  }
  async function openInEditor(spec) {
    const k = spec.lastIndexOf(':');
    const path = spec.slice(0, k), line = spec.slice(k + 1);
    try {
      const r = await fetch(`../open?path=${encodeURIComponent(path)}&line=${encodeURIComponent(line)}`, { headers: { 'X-Code-Tour': '1' } });
      const j = await r.json().catch(() => ({}));
      toast(r.ok && j.ok ? `エディタで開きました：${esc(fileName(path))}:${esc(line)}` : `開けませんでした${j.error ? '：' + esc(j.error) : ''}`);
    } catch (e) { toast('開けませんでした'); }
  }

  // ---------- start ----------
  (async function start() {
    window.CODE_TOUR = { state, plan, go, next, prev, dive, out, detour, setFlow, TRACKS, startPlay, stopPlay, walkFrom, ready: false };
    readHash();
    update();
    await loadSources();
    window.CODE_TOUR.CHECKED = LN.checked;
    window.CODE_TOUR.LN = LN;
    Object.keys(PLANS).forEach((k) => delete PLANS[k]);
    update();
    editor = await probeEditor();
    if (editor) renderHead(state.detour || plan(TRACKS[top().id], top().i));
    window.CODE_TOUR.ready = true;
  })();
})();
