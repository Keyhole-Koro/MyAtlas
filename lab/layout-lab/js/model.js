// One graph for every engine: a flow or a paper of the atlas, with the size of each box and of each step's label
// fixed here, so that the engines differ only in where they put things.
import { textW, isCode } from './measure.js';

export const BOX_H = 66;
export const PILL_H = 24;
export const KIND_NAME = {
  call: '呼び出し', syscall: 'syscall', return: '戻り・返事', signal: '割り込み・通知', msg: '列を通す', data: '値を読む・書く',
};

export function diagramList(A) {
  return [
    ...A.flows.map((f) => ({ id: f.id, group: 'flow', tab: f.tab, title: f.title })),
    ...Object.entries(A.papers).map(([id, p]) => ({ id, group: 'paper', tab: p.tab, title: p.title })),
  ];
}

export function boxSize(b) {
  const parts = [textW(b.title, 14, isCode(b.title), 600) + 32, 120];
  if (b.ns) parts.push(textW(b.ns, 12, true) + 30);
  if (b.sub) parts.push(textW(b.sub, 12) + 30);
  if (b.slots) parts.push(b.slots.reduce((a, t) => a + Math.max(44, textW(t, 12, true) + 16), 0) + 4 * (b.slots.length - 1) + 30);
  if (b.bits) parts.push(230);
  return { w: Math.min(300, Math.ceil(Math.max(...parts) / 10) * 10), h: BOX_H };
}

// The label a step carries: its number, its verb and the data it hands over, the same text in every engine.
export function pillParts(st) {
  const num = st.no;
  const verb = st.alt ? `${st.alt.when}なら${st.verb ? '：' + st.verb : ''}` : st.verb || '';
  const chip = st.data && st.data.chip !== false ? st.data.label : '';
  const nw = Math.max(20, textW(num, 12, false, 700) + 12);
  const vw = verb ? textW(verb, 12) : 0;
  const cw = chip ? textW(chip, 12, true) + 26 : 0;
  const p = { num, verb, chip, nw, vw, cw, h: PILL_H };
  p.w = pillWidth(p);
  return p;
}

// Which parts of a label are shown: [verb, data]. Only the current map drops parts, where a label does not fit; the
// order is the reference's (mapPillSpots): everything, then the data alone, the verb alone, the number alone.
export const PICKS = [[true, true], [false, true], [true, false], [false, false]];
export function pillWidth(p, pick = [true, true]) {
  const v = pick[0] && p.verb, c = pick[1] && p.chip;
  return Math.ceil(3 + p.nw + (v ? 6 + p.vw : 0) + (c ? 6 + p.cw : 0) + (v || c ? 9 : 3));
}
// A label that leaves out a part the step has: its verb or its data.
export const isTrimmed = (p, pick) => !!pick && ((!!p.verb && !pick[0]) || (!!p.chip && !pick[1]));

export function buildDiagram(A, id) {
  const flow = A.flows.find((f) => f.id === id);
  const src = flow || A.papers[id];
  if (!src) throw new Error('no diagram ' + id);
  const bands = (src.bands || A.layers.filter((l) => !l.cross)).map((b, k) => ({
    id: b.id, name: b.name, sub: b.sub, tone: b.tone || b.id, index: k,
  }));
  const bandIndex = Object.fromEntries(bands.map((b) => [b.id, b.index]));
  let alt = 0;
  const steps = src.steps.map((st, i) => {
    const s = { ...st, i, main: !st.alt };
    s.no = st.alt ? `もし${'ABCDEFGH'[alt++]}` : String(i + 1);
    s.pill = pillParts(s);
    return s;
  });
  // the order in which the steps first reach each box: the reading order of the boxes
  const first = new Map();
  steps.forEach((st, i) => { for (const b of [st.from, st.to]) if (!first.has(b)) first.set(b, st.alt ? 1000 + i : i); });
  const boxes = src.boxes.map((b, k) => {
    const n = A.nodes[b.node] || {};
    return {
      ...b, ...boxSize(b), band: b.layer, bandIndex: bandIndex[b.layer] ?? 0, kind: n.kind || 'func',
      nodeTitle: n.title || b.title, paper: n.paper && A.papers[n.paper] ? n.paper : null,
      first: first.has(b.id) ? first.get(b.id) : 2000 + k,
    };
  });
  return {
    id, group: flow ? 'flow' : 'paper', title: src.title, tab: src.tab,
    bands, boxes, steps, regions: src.regions || [],
    entry: src.entry || (steps[0] && steps[0].from), ports: src.ports || null,
    box: (bid) => boxes.find((b) => b.id === bid),
  };
}
