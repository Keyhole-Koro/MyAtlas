// The recorded run against the rows: for each step, the moment (instruction count) the record entered the
// function at the step's arrow head. Only function entries are recorded, so returns, writes into places
// and the ways not taken get no time. The search walks the record forward, so times only grow.
import { CALLISH, boxOf } from './model.js';

export function traceInfo(X) {
  const tr = (X.A.traces || [])[0];
  if (!tr) return null;
  const events = tr.events;
  const traced = new Set(events.filter((e) => e.n).map((e) => e.n));
  const segs = [];
  for (const e of events) {
    const last = segs[segs.length - 1];
    if (!last || last.thread !== e.thread) segs.push({ thread: e.thread, from: e.instr, to: e.instr });
  }
  const maxInstr = events.length ? events[events.length - 1].instr : 0;
  for (let i = 0; i < segs.length; i++) segs[i].to = i + 1 < segs.length ? segs[i + 1].from : maxInstr;
  const threadIds = [...new Set(events.map((e) => e.thread))];
  return { tr, events, traced, segs, maxInstr, threadIds };
}

export function threadName(T, t) {
  const l = (T.tr.threads || {})[String(t)] || '';
  if (!l) return 'スレッド ' + t;
  if (/idle/.test(l)) return '走るもの無し（idle）';
  if (l.startsWith('kernel:')) return `カーネルのスレッド（${l.slice(7).trim()}）`;
  return `${l} のスレッド`;
}
export function threadShort(T, t) {
  const l = (T.tr.threads || {})[String(t)] || '';
  if (/idle/.test(l)) return 'idle';
  return l.replace(/^kernel:\s*/, '') || String(t);
}

const isTimerSignal = (X, S, st) => st.kind === 'signal' && X.nodes[S]?.kind === 'hw' && /timer/.test(S);

// Where in the record each pass of this flow begins: the entries of the first step that can be found.
export function occurrences(X, T, model) {
  if (!T) return [];
  for (const r of model.rows) {
    if (r.type !== 'step' || r.st.alt || r.st.kind === 'return') continue;
    const S = boxOf(r.sheet, r.st.from).node, N = boxOf(r.sheet, r.st.to).node;
    if (isTimerSignal(X, S, r.st)) {
      return T.events.map((e, i) => (e.ev === 'irq' && (e.cause || []).includes('timer') ? i : -1)).filter((i) => i >= 0);
    }
    if (T.traced.has(N)) return T.events.map((e, i) => (e.ev === 'enter' && e.n === N ? i : -1)).filter((i) => i >= 0);
  }
  return [];
}

const squeeze = (xs) => {
  const out = [];
  for (const x of xs) if (out[out.length - 1] !== x) out.push(x);
  return out;
};

function viaBetween(T, a, b) {
  const out = [];
  for (let i = a + 1; i < b; i++) {
    const e = T.events[i];
    if (e.ev === 'irq') out.push(`割り込み（${(e.cause || []).join('・') || '?'}${e.service ? '・' + e.service : ''}）`);
    else if (e.ev === 'switch') out.push(`切り替え → ${threadShort(T, e.thread)}`);
    else if (e.ev === 'enter' && e.fn) out.push(e.fn);
  }
  return squeeze(out);
}

// rows → Map(row key → { instr, idx, quality, thread, delta, via, fn, why })
export function mapTimes(X, T, model, occStart) {
  const out = new Map();
  if (!T || occStart == null) return out;
  const ev = T.events;
  let cursor = occStart, last = null, prevIdx = occStart - 1, prevInstr = null;
  const seen = new Map();
  const find = (from, pred) => { for (let i = from; i < ev.length; i++) if (pred(ev[i])) return i; return -1; };
  for (const r of model.rows) {
    if (r.type !== 'step') continue;
    const st = r.st;
    const S = boxOf(r.sheet, st.from).node, N = boxOf(r.sheet, st.to).node;
    if (st.alt) { out.set(r.key, { why: 'alt' }); continue; }
    if (st.kind === 'return') { out.set(r.key, { why: 'return' }); continue; }
    const take = (idx, quality, node, shownIdx = idx) => {
      const e = ev[shownIdx];
      const rec = { instr: e.instr, idx: shownIdx, quality, thread: e.thread, fn: ev[idx].fn, node, via: quality === 'same' ? [] : viaBetween(T, prevIdx, shownIdx), delta: quality === 'same' || prevInstr == null ? null : e.instr - prevInstr };
      if (quality !== 'same') { prevIdx = idx; prevInstr = e.instr; }
      out.set(r.key, rec);
      return rec;
    };
    if (isTimerSignal(X, S, st)) {
      const i = find(cursor, (e) => e.ev === 'irq' && (e.cause || []).includes('timer'));
      const j = i < 0 ? -1 : find(i, (e) => e.ev === 'enter' && e.n === N);
      if (i >= 0 && j >= 0) {
        const rec = take(j, 'chain', N, i);
        rec.irq = true;
        last = { node: N, idx: j }; cursor = j + 1; seen.set(N, j);
        continue;
      }
      out.set(r.key, { why: 'absent' });
      continue;
    }
    // A read or a write happens inside a call already entered in this pass.
    if (!CALLISH.has(st.kind)) {
      const k = seen.has(N) ? N : seen.has(S) ? S : null;
      if (k) { take(seen.get(k), 'same', k); continue; }
    }
    if (!T.traced.has(N)) {
      const kind = X.nodes[N]?.kind;
      out.set(r.key, { why: kind === 'store' || kind === 'hw' ? 'place' : X.nodes[N]?.fn ? 'absent' : 'nofn' });
      continue;
    }
    // A step from a function that this pass of the record did not just enter gets no time: the next
    // entry of its target would belong to something else.
    const sFn = !!(X.nodes[S] && X.nodes[S].fn);
    if (sFn && seen.size && !(last && last.node === S)) { out.set(r.key, { why: 'broken' }); continue; }
    const j = find(cursor, (e) => e.ev === 'enter' && e.n === N);
    if (j < 0) { out.set(r.key, { why: 'absent' }); continue; }
    take(j, last && last.node === S ? 'chain' : 'target', N);
    last = { node: N, idx: j }; cursor = j + 1; seen.set(N, j);
  }
  return out;
}

export const WHY = {
  alt: 'もしもの道。この記録の時刻は付けない',
  return: '戻りは記録に出ない（記録は関数に入った所だけ）',
  place: '行き先が置き場。置き場への読み書きは記録に出ない',
  absent: 'この記録には、行き先の関数に入った所が無い',
  nofn: '行き先が関数でない（関数の中の 1 文）ので記録に出ない',
  broken: '出どころの関数がこの回の記録に無いので、時刻を当てない',
};
