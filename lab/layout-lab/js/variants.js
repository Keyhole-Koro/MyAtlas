// Altered copies of a diagram, for checking that an engine's rules hold on pictures they were not tuned on. These
// are made-up test pictures, never facts about the system: added boxes are called 「追加 1」…, added steps 「追加」.
import { boxSize, pillParts } from './model.js';

export const VARIANTS = [
  { id: 'wide', name: '箱を広く', desc: 'すべての箱を 40 px 広くする（題が長い時）。' },
  { id: 'extra', name: '帯ごとに箱を 1 つ足す', desc: '箱のある帯ごとに、最後に届く箱から呼ぶ箱を 1 つ足す（行の折り返しを試す）。' },
  { id: 'far', name: '遠い線を 1 本足す', desc: 'いちばん上の帯の最初の箱から、いちばん下の帯の最初の箱へ、手順を 1 つ足す（回廊を試す）。' },
  { id: 'order', name: '帯の中の並びを逆に', desc: '帯ごとに、手順が箱に届く順を逆にする（並べ方の前提を崩す）。' },
  { id: 'long', name: '札を長く', desc: 'すべての札を 40 px 長くする（動詞やデータの名前が長い時）。' },
];

// Steps are renumbered as buildDiagram does: main steps 1, 2, 3…, the others もしA, もしB…
function renumber(steps) {
  let n = 0, alt = 0;
  for (const s of steps) { s.no = s.alt ? `もし${'ABCDEFGH'[alt++]}` : String(++n); s.pill = pillParts(s); }
}

export function makeVariant(D, kind) {
  const boxes = D.boxes.map((b) => ({ ...b })), steps = D.steps.map((s) => ({ ...s }));
  const by = (id) => boxes.find((b) => b.id === id);
  const used = D.bands.filter((band) => boxes.some((b) => b.band === band.id));
  const addStep = (from, to, kindOf = 'call') => {
    const main = steps.filter((s) => !s.alt), at = main.length ? steps.indexOf(main[main.length - 1]) + 1 : steps.length;
    steps.splice(at, 0, { kind: kindOf, from, to, verb: '追加', label: '追加の手順（試験用）', main: true });
  };
  if (kind === 'wide') for (const b of boxes) b.w = Math.min(340, b.w + 40);
  if (kind === 'extra') {
    used.forEach((band, k) => {
      const own = boxes.filter((b) => b.band === band.id).sort((a, c) => a.first - c.first);
      const last = own[own.length - 1], id = `added-${k + 1}`;
      const nb = { id, node: null, title: `追加 ${k + 1}`, sub: '試験用の箱', band: band.id, layer: band.id, bandIndex: band.index, kind: 'func', nodeTitle: `追加 ${k + 1}`, paper: null, first: 900 + k };
      Object.assign(nb, boxSize(nb));
      boxes.push(nb);
      addStep(last.id, id);
    });
  }
  if (kind === 'far' && used.length > 1) {
    const top = boxes.filter((b) => b.band === used[0].id).sort((a, c) => a.first - c.first)[0];
    const bottom = boxes.filter((b) => b.band === used[used.length - 1].id).sort((a, c) => a.first - c.first)[0];
    addStep(top.id, bottom.id);
  }
  if (kind === 'order') {
    for (const band of used) {
      const own = boxes.filter((b) => b.band === band.id).sort((a, c) => a.first - c.first);
      const firsts = own.map((b) => b.first).reverse();
      own.forEach((b, k) => { b.first = firsts[k]; });
    }
  }
  // indexes, numbers and labels again. Steps are only added after the last main step, so the main steps keep their
  // indexes and an alternative still points at the step it stands in for.
  steps.forEach((s, i) => { s.i = i; });
  renumber(steps);
  if (kind === 'long') for (const s of steps) s.pill = { ...s.pill, w: s.pill.w + 40 };
  const name = VARIANTS.find((v) => v.id === kind).name;
  return { ...D, id: `${D.id}~${kind}`, title: `${D.title}（試験：${name}）`, tab: `${D.tab}・${name}`, boxes, steps, variant: kind, box: (bid) => boxes.find((b) => b.id === bid) };
}
