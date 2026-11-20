// World layout. Units: 1 world unit = 1 CSS px at zoom 1 (the level where a card's facts read at ~12px).
import {
  NODES, IDS, LAYER, STACK, CROSS, PAPERS, KIND_NAME, FLOWS, CONTEXT_OF, TRACE_COUNT, FLOW_RANK, NEIGHBOURS,
  SCHEMA_BY_NAME, LINK_RE, plain, codeOf, splitPath, srcLines, references, boxOf, stepOrder, stepNo, RUN_NAME, runOf, intoPaper,
} from './model.js';
import { F, textW, wrapRich, wrapName, wrapTitle, isCodeName, fit } from './text.js';
import { fileLines, tokensOf } from './code.js';

export const CW = 360, GUT = 40, WIDE = CW * 2 + GUT, PAD = 18;
export const FS = { body: 12.5, small: 12, title: 21, code: 2.8, codeLH: 4.0, paper: 9.6, paperSmall: 9.4 };
const LH = { body: 21, small: 19 };

// Shared styles (identity matters: runs merge when the style object is the same).
export const ST = {
  body: { f: F.sans, c: 'text' },
  body2: { f: F.sans, c: 'text2' },
  link: { f: F.sans, c: 'accent', u: true },
  mono: { f: F.mono, c: 'text' },
  mono2: { f: F.mono, c: 'text2' },
  mono3: { f: F.mono, c: 'text3' },
  monoB: { f: F.monoBold, c: 'text' },
  monoLink: { f: F.mono, c: 'accent', u: true },
  monoBLink: { f: F.monoBold, c: 'accent', u: true },
  sec: { f: F.sansBold, c: 'text3' },
  bold: { f: F.sansBold, c: 'text' },
  bold2: { f: F.sansBold, c: 'text2' },
};

// Text with [[id]] pointers → segments.
export function richSegs(s, st = ST.body, linkSt = ST.link) {
  const out = [];
  let last = 0;
  const str = String(s || '');
  for (const m of str.matchAll(LINK_RE)) {
    if (m.index > last) out.push({ s: str.slice(last, m.index), st });
    const n = NODES[m[1]];
    out.push(n ? { s: n.title, st: linkSt, link: m[1] } : { s: m[1], st });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ s: str.slice(last), st });
  return out;
}
// A signature: type names that a contract defines become pointers.
function typeSegs(s, st = ST.mono, linkSt = ST.monoLink) {
  const out = [];
  let last = 0;
  for (const m of s.matchAll(/\b[A-Z][A-Za-z]*\b/g)) {
    if (!SCHEMA_BY_NAME[m[0]]) continue;
    if (m.index > last) out.push({ s: s.slice(last, m.index), st });
    out.push({ s: m[0], st: linkSt, link: SCHEMA_BY_NAME[m[0]] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ s: s.slice(last), st });
  return out;
}

class Doc {
  constructor(w, layer) { this.w = w; this.iw = w - 2 * PAD; this.layer = layer; this.items = []; this.links = []; this.y = PAD; }
  text(x, y, s, st, z, extra) { if (s) this.items.push({ k: 't', x, y, s, st, z, ...extra }); }
  rect(x, y, w, h, fill, extra) { this.items.push({ k: 'r', x, y, w, h, fill, ...extra }); }
  // Lay out rich text at the current y. Returns the lines' height.
  rich(segs, x, maxW, z, lh, extra = {}) {
    const lines = wrapRich(segs, maxW, z, extra.maxLines);
    let y = this.y;
    for (const line of lines) {
      for (const r of line.runs) {
        this.text(x + r.x, y + lh * 0.72, r.s, r.st, z, { link: r.link, w: r.w, ...extra.item });
        if (r.link) this.links.push({ x: x + r.x - 2, y: y + 1, w: r.w + 4, h: lh - 2, id: r.link });
      }
      y += lh;
    }
    const h = lines.length * lh;
    if (!extra.keepY) this.y += h;
    return { h, lines };
  }
  section(label) {
    this.y += 14;
    this.text(PAD, this.y + 12, label, ST.sec, FS.small, { tracking: 0.04 });
    this.y += 20;
  }
  rule() { this.y += 12; this.rect(PAD, this.y, this.iw, 1, 'border'); this.y += 1; }
}

// ---- Card: one node as a document ----
export function buildCard(id) {
  const n = NODES[id];
  const wide = !!(n.paper && PAPERS[n.paper]);
  const d = new Doc(wide ? WIDE : CW, n.layer);
  const iw = d.iw;
  const code = codeOf(id);

  // kind row
  d.items.push({ k: 'icon', kind: n.kind, x: PAD, y: d.y + 1, z: 14 });
  d.text(PAD + 21, d.y + 12, KIND_NAME[n.kind] || n.kind, ST.bold2, FS.small);
  d.y += 22;

  // title
  const mono = isCodeName(n.title);
  const tz = mono ? 19.5 : 21, tlh = mono ? 26 : 29;
  if (mono) {
    for (const l of wrapName(n.title, F.monoBold, tz, iw, 4)) { d.text(PAD, d.y + tlh * 0.74, l, ST.monoB, tz); d.y += tlh; }
  } else d.rich([{ s: n.title, st: ST.bold }], PAD, iw, tz, tlh);

  // where in the code
  if (code) {
    const p = splitPath(code.path);
    const sym = code.whole ? '（ファイル全体）' : code.symbol ? ` の ${code.symbol}` : '';
    d.y += 2;
    d.rich([{ s: `${p.repo} › ${p.rel}`, st: ST.mono3 }, { s: sym, st: ST.mono3 }], PAD, iw, FS.small, LH.small);
  }

  // chips: who runs, the recorded run, the paper inside
  const chips = [];
  const ctx = CONTEXT_OF[id];
  if (ctx) chips.push({ s: `走る：${NODES[ctx].title}`, link: ctx, tone: 'run', run: runOf(ctx) });
  if (TRACE_COUNT[id]) chips.push({ s: `記録で ${TRACE_COUNT[id]} 回`, tone: 'trace' });
  if (wide) chips.push({ s: `中の紙：${PAPERS[n.paper].tab} の中`, tone: 'paper' });
  if (chips.length) {
    d.y += 8;
    let x = PAD;
    for (const c of chips) {
      const w = textW(c.s, F.sans, FS.small) + 20;
      if (x + w > PAD + iw && x > PAD) { x = PAD; d.y += 28; }
      d.items.push({ k: 'chip', x, y: d.y, w, h: 23, s: c.s, tone: c.tone, run: c.run, z: FS.small });
      if (c.link) d.links.push({ x, y: d.y, w, h: 23, id: c.link });
      x += w + 6;
    }
    d.y += 23;
  }
  d.rule();

  // what it is: the prose first
  d.y += 10;
  textBlock(d, n.text || '', 0);

  // facts
  if (n.api) apiBlock(d, n.api);
  shapeLines(d, id);
  if (n.reg) { d.section('レジスタ'); d.rich([{ s: n.reg + '（32 ビット）', st: ST.mono }], PAD, iw, FS.body, LH.body); }
  if (n.kind === 'context') contextBlock(d, n);
  if (n.fields && n.fields.length) fieldsBlock(d, n);
  if (n.values && n.values.length) valuesBlock(d, n);
  if (n.states) statesBlock(d, n.states);
  if (n.ops && n.ops.length) opsBlock(d, n.ops);
  if (n.invariants && n.invariants.length) {
    d.section('不変');
    for (const inv of n.invariants) { bullet(d); d.rich(richSegs(inv), PAD + 14, iw - 14, FS.body, LH.body); d.y += 2; }
  }
  if (n.figure) figureBlock(d, id, iw);

  // the paper inside
  let paper = null;
  if (wide) {
    d.section(`中の紙：${PAPERS[n.paper].tab} の中`);
    d.y += 2;
    paper = buildPaper(n.paper, iw);
    paper.x = PAD; paper.y = d.y;
    d.items.push({ k: 'paper', x: PAD, y: d.y, w: paper.w, h: paper.h, paper });
    for (const b of paper.boxes) d.links.push({ x: PAD + b.x, y: d.y + b.y, w: b.w, h: b.h, id: b.node, paperBox: b.id, pid: n.paper });
    d.y += paper.h;
  }

  // who points here
  const refs = [...new Set(references(id).filter((r) => r.node).map((r) => r.node))];
  if (refs.length) {
    d.section(`ここを指しているもの（${refs.length}）`);
    let x = PAD;
    for (const k of refs) {
      const label = NODES[k].title;
      const st = isCodeName(label) ? ST.monoLink : ST.link;
      const w = Math.min(iw, textW(label, st.f, FS.small) + 18);
      if (x + w > PAD + iw && x > PAD) { x = PAD; d.y += 28; }
      d.items.push({ k: 'chip', x, y: d.y, w, h: 23, s: fit(label, st.f, FS.small, w - 18), tone: 'link', mono: st === ST.monoLink, z: FS.small });
      d.links.push({ x, y: d.y, w, h: 23, id: k });
      x += w + 6;
    }
    d.y += 23;
  }

  // the real code
  let codeBox = null;
  if (code && fileLines(code.path)) {
    d.section('コード');
    codeBox = codeBlock(d, code, iw);
  }

  d.y += PAD;
  return {
    id, layer: n.layer, kind: n.kind, w: d.w, h: Math.ceil(d.y), wide, items: d.items, links: d.links, paper, codeBox,
    mono, title: n.title, summary: summaryOf(n), facts: factsLine(n, code),
  };
}

function bullet(d) { d.items.push({ k: 'dot', x: PAD + 4, y: d.y + LH.body * 0.5, r: 2.2 }); }

function textBlock(d, text, depth) {
  const paras = String(text).split('\n').filter((p) => p.trim());
  for (const para of paras) {
    const m = para.match(/^!\[\[([\w.\-]+)\]\]$/);
    if (!m) { d.rich(richSegs(para), PAD, d.iw, FS.body, LH.body); d.y += 6; continue; }
    const e = NODES[m[1]];
    if (!e || depth > 0) continue;
    // An embedded node: shown in place, its one real card is elsewhere (a pointer).
    const top = d.y;
    d.y += 10;
    d.rich([{ s: '埋め込み：', st: ST.body2 }, { s: e.title, st: ST.link, link: m[1] }, { s: `（${LAYER[e.layer].name}）`, st: ST.body2 }], PAD + 12, d.iw - 24, FS.small, LH.small);
    d.y += 4;
    if (e.figure) figureBlock(d, m[1], d.iw - 24, PAD + 12);
    else if (e.fields && e.kind === 'hw') {
      for (const [bits, name, note] of e.fields) {
        d.rich([{ s: bits + '  ', st: ST.mono3 }, { s: name, st: ST.bold }], PAD + 12, d.iw - 24, FS.body, LH.body);
        d.rich(richSegs(note, ST.body2), PAD + 24, d.iw - 36, FS.body, LH.body);
      }
    }
    const first = String(e.text || '').split('\n').find((p) => p.trim() && !p.startsWith('![['));
    if (first) { d.y += 4; d.rich(richSegs(first, ST.body2), PAD + 12, d.iw - 24, FS.body, LH.body); }
    d.y += 10;
    d.items.push({ k: 'frame', x: PAD, y: top, w: d.iw, h: d.y - top });
    d.y += 8;
  }
}

function apiBlock(d, api) {
  d.section('API');
  const sigLines = String(api.sig || '').split('\n');
  const top = d.y;
  d.y += 9;
  for (const l of sigLines) d.rich(typeSegs(l), PAD + 10, d.iw - 20, FS.body, 19);
  d.y += 9;
  d.items.splice(d.items.length - 0, 0);
  d.items.push({ k: 'r', x: PAD, y: top, w: d.iw, h: d.y - top, fill: 'codeBg', rad: 6, under: true });
  const rows = (api.params || []).map(([k, v]) => [k, v, true]);
  if (api.ret) rows.push(['返す', api.ret, false]);
  if (!rows.length) return;
  d.y += 8;
  const nameW = Math.min(118, Math.max(...rows.map(([k, , code]) => textW(k, code ? F.monoBold : F.sansBold, FS.body))) + 14);
  for (const [k, v, isCode] of rows) {
    const kw = textW(k, isCode ? F.monoBold : F.sansBold, FS.body);
    if (kw + 10 > nameW) {
      d.text(PAD, d.y + LH.body * 0.72, k, isCode ? ST.monoB : ST.bold2, FS.body);
      d.y += LH.body;
      d.rich(richSegs(v), PAD + 14, d.iw - 14, FS.body, LH.body);
    } else {
      d.text(PAD, d.y + LH.body * 0.72, k, isCode ? ST.monoB : ST.bold2, FS.body);
      d.rich(richSegs(v), PAD + nameW, d.iw - nameW, FS.body, LH.body);
    }
    d.y += 4;
  }
}

function shapeLines(d, id) {
  const shape = srcLines(id, '形'), field = srcLines(id, '状態の欄');
  if (!shape.length && !field.length) return;
  d.section('形');
  for (const s of shape) d.rich(richSegs(s), PAD, d.iw, FS.body, LH.body);
  for (const s of field) d.rich([{ s: '状態の欄：', st: ST.body2 }, { s, st: ST.mono }], PAD, d.iw, FS.body, LH.body);
}

function contextBlock(d, n) {
  d.section('走るもの');
  d.rich([{ s: '走る：', st: ST.body2 }, { s: n.run || '', st: ST.body }], PAD, d.iw, FS.body, LH.body);
  d.rich([{ s: 'カーネルの中：', st: ST.body2 }, { s: n.kernel ? 'はい' : 'いいえ', st: ST.body }], PAD, d.iw, FS.body, LH.body);
}

function fieldsBlock(d, n) {
  const hw = n.kind === 'hw';
  d.section(hw ? 'ビット' : 'フィールド');
  for (const [t, name, note] of n.fields) {
    if (hw) d.rich([{ s: t + '  ', st: ST.mono3 }, { s: name, st: ST.bold }], PAD, d.iw, FS.body, LH.body);
    else d.rich([{ s: name, st: ST.monoB }, { s: '  ', st: ST.mono }, ...typeSegs(t, ST.mono3, ST.monoLink)], PAD, d.iw, FS.body, LH.body);
    if (note) d.rich(richSegs(note, ST.body2), PAD + 14, d.iw - 14, FS.body, LH.body);
    d.y += 5;
  }
}

function valuesBlock(d, n) {
  d.section('値');
  const named = n.values.filter(([v]) => v !== '…');
  const colW = Math.min(150, Math.max(...named.map(([v]) => textW(v, F.monoBold, FS.body))) + 16);
  for (const [v, note] of n.values) {
    if (v === '…') { d.rich([{ s: '… ', st: ST.mono3 }, ...richSegs(note, ST.body2)], PAD, d.iw, FS.body, LH.body); d.y += 2; continue; }
    d.text(PAD, d.y + LH.body * 0.72, v, ST.monoB, FS.body);
    const vw = textW(v, F.monoBold, FS.body);
    if (!note) { d.y += LH.body; d.y += 2; continue; }
    if (vw + 10 > colW) { d.y += LH.body; d.rich(richSegs(note, ST.body2), PAD + 14, d.iw - 14, FS.body, LH.body); }
    else d.rich(richSegs(note, ST.body2), PAD + colW, d.iw - colW, FS.body, LH.body);
    d.y += 2;
  }
}

function statesBlock(d, states) {
  d.section(`移り方（${states.field}）`);
  for (const mv of states.moves) {
    d.rich([{ s: mv.from, st: mv.from === 'はじめ' ? ST.body2 : ST.monoB }, { s: '  →  ', st: ST.mono3 }, { s: mv.to, st: ST.monoB }], PAD, d.iw, FS.body, LH.body);
    d.rich([{ s: mv.fns.join('・'), st: ST.mono3 }], PAD + 14, d.iw - 14, FS.small, LH.small);
    d.y += 5;
  }
}

function opsBlock(d, ops) {
  d.section('操作');
  for (const op of ops) {
    const nameSegs = richSegs(op.name, ST.monoB, ST.monoBLink);
    d.rich([...nameSegs, { s: `  ${op.kind}・${op.cost}`, st: ST.body2 }], PAD, d.iw, FS.body, LH.body);
    d.rich(richSegs(op.text, ST.body), PAD + 14, d.iw - 14, FS.body, LH.body);
    d.y += 6;
  }
}

// Figures are the map's own SVGs, drawn as images.
function figureBlock(d, id, w, x = PAD) {
  const svg = NODES[id].figure;
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg);
  const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 640, 200];
  const h = (w * vh) / vw;
  d.y += 6;
  d.items.push({ k: 'fig', id, x, y: d.y, w, h, vw });
  d.y += h + 6;
}

// ---- Code: lines of the real file, coloured ----
function codeBlock(d, code, iw) {
  const all = fileLines(code.path), toks = tokensOf(code.path);
  let s = code.start, e = code.end;
  const ctxLines = e - s < 3;
  if (ctxLines) { s = Math.max(1, s - 3); e = Math.min(all.length, e + 6); }
  const p = splitPath(code.path);
  d.rich([{ s: `${p.rel}  ${code.start === code.end ? code.start + ' 行' : code.start + '–' + code.end + ' 行'}`, st: ST.mono3 }], PAD, iw, FS.small, LH.small);
  d.y += 4;
  const z = FS.code, lh = FS.codeLH;
  const numW = textW(String(e), F.mono, z) + 3;
  const x0 = PAD + 8, cx = x0 + numW + 4;
  const maxW = PAD + iw - 6 - cx;
  const lines = [];
  let y = d.y + 6;
  for (let ln = s; ln <= e; ln++) {
    const dim = ln < code.start || ln > code.end;
    let row = { no: ln, y, dim, toks: [] }, x = 0;
    for (const t of toks[ln - 1] || []) {
      let str = t.s;
      while (str) {
        const w = textW(str, F.mono, z);
        if (x + w <= maxW) { row.toks.push({ x, s: str, c: t.c, w }); x += w; break; }
        // wrap: cut where it still fits
        let cut = str.length;
        while (cut > 1 && x + textW(str.slice(0, cut), F.mono, z) > maxW) cut--;
        if (x === 0 || cut > 1) { row.toks.push({ x, s: str.slice(0, cut), c: t.c, w: textW(str.slice(0, cut), F.mono, z) }); str = str.slice(cut); }
        lines.push(row); y += lh;
        row = { no: null, y, dim, toks: [], cont: true }; x = textW('    ', F.mono, z);
      }
    }
    lines.push(row); y += lh;
  }
  const h = y - d.y + 6;
  const box = { k: 'code', x: PAD, y: d.y, w: iw, h, z, lh, cx, numX: x0 + numW, lines, path: code.path, start: code.start, end: code.end };
  d.items.push(box);
  d.y += h;
  return box;
}

// ---- A paper drawn inside its card ----
export function buildPaper(pid, width) {
  const P = PAPERS[pid];
  const z = FS.paper, zs = FS.paperSmall;
  const labelW = 118;
  const order = {};
  let r = 0;
  for (const i of stepOrder(P)) for (const b of [P.steps[i].from, P.steps[i].to]) if (order[b] == null) order[b] = r++;
  for (const b of P.boxes) if (order[b.id] == null) order[b.id] = r++;
  const bands = P.bands.map((b) => ({ ...b, boxes: P.boxes.filter((x) => x.layer === b.id).sort((a, c) => order[a.id] - order[c.id]) }));
  const boxes = [];
  let y = 0;
  const areaX = labelW + 10, areaW = width - areaX - 8;
  for (const band of bands) {
    const measureRow = (maxW) => band.boxes.map((b) => {
      // code names in mono, Japanese titles in sans; both break only between words or phrases
      const tf = isCodeName(b.title) ? F.monoBold : F.sansBold;
      const titleLines = wrapTitle(b.title, tf, z, maxW, 3);
      const tw = Math.max(...titleLines.map((l) => textW(l, tf, z)));
      const cells = b.slots || (b.bits ? b.bits.map((x) => x[0]) : null);
      const cw = cells ? cells.reduce((s, c) => s + textW(c, F.sans, zs) + 12, 0) + 10 : 0;
      let subLines = b.sub ? [b.sub] : [];
      let sw = b.sub ? textW(b.sub, F.sans, zs) : 0;
      // the longest word of the sub line (REQUEST_SPACE・) is never cut
      const word = b.sub ? Math.max(0, ...(b.sub.match(/[\x21-\x7e]+[・、。]?/g) || []).map((x) => textW(x, F.sans, zs))) : 0;
      const subW = Math.max(tw, maxW, word);
      if (b.sub && sw > subW) {
        subLines = wrapRich([{ s: b.sub, st: ST.body2 }], subW, zs, 2).map((l) => l.runs.map((r) => r.s).join(''));
        sw = Math.max(...subLines.map((l) => textW(l, F.sans, zs)));
      }
      const w = Math.max(84, Math.min(areaW, Math.max(tw, sw, cw) + 20));
      return { b, w, tf, h: 16 + z + (titleLines.length - 1) * (z + 3) + subLines.length * (zs + 4) + (cells ? zs + 10 : 0), cells, subLines, titleLines };
    });
    let ms = measureRow(1e9);
    const gapMin = 30;
    const fits = (row) => row.reduce((s, m) => s + m.w, 0) + gapMin * (row.length - 1) <= areaW;
    for (const maxW of [150, 124, 104, 88, 76]) { if (fits(ms)) break; ms = measureRow(maxW); }
    const rowH = Math.max(56, ...ms.map((m) => m.h)) + 30;
    const total = ms.reduce((s, m) => s + m.w, 0);
    const gap = ms.length > 1 ? Math.min(70, Math.max(gapMin, (areaW - total) / (ms.length - 1))) : 0;
    let x = areaX + (ms.length === 1 ? Math.min(40, (areaW - total) / 2) : Math.max(0, (areaW - total - gap * (ms.length - 1)) / 2));
    for (const m of ms) {
      boxes.push({ id: m.b.id, node: m.b.node, title: m.b.title, titleLines: m.titleLines, tf: m.tf, sub: m.b.sub || '', subLines: m.subLines, cells: m.cells, band: band.id, tone: band.tone, x, y: y + (rowH - m.h) / 2, w: m.w, h: m.h });
      x += m.w + gap;
    }
    band.y = y; band.h = rowH;
    y += rowH + 6;
  }
  const H = y - 6;
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  // steps
  const steps = P.steps.map((st, i) => {
    const a = byId[st.from], b = byId[st.to];
    const pts = paperCurve(a, b, boxes);
    return { i, no: stepNo(st, i), kind: st.kind, alt: !!st.alt, pts, from: st.from, to: st.to };
  });
  return { pid, w: width, h: H, bands, boxes, steps, labelW, z, zs };
}
function paperCurve(a, b, boxes) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (a.band === b.band) {
    const between = boxes.some((o) => o.band === a.band && o !== a && o !== b && o.x + o.w / 2 > Math.min(ac.x, bc.x) && o.x + o.w / 2 < Math.max(ac.x, bc.x));
    if (!between) {
      const dir = bc.x > ac.x ? 1 : -1;
      const p0 = { x: dir > 0 ? a.x + a.w : a.x, y: ac.y }, p3 = { x: dir > 0 ? b.x : b.x + b.w, y: bc.y };
      return [p0, { x: p0.x + dir * 10, y: p0.y }, { x: p3.x - dir * 10, y: p3.y }, p3];
    }
    const p0 = { x: ac.x + (bc.x > ac.x ? 8 : -8), y: a.y }, p3 = { x: bc.x - (bc.x > ac.x ? 8 : -8), y: b.y };
    return [p0, { x: p0.x, y: p0.y - 22 }, { x: p3.x, y: p3.y - 22 }, p3];
  }
  const down = bc.y > ac.y;
  const p0 = { x: ac.x, y: down ? a.y + a.h : a.y }, p3 = { x: bc.x, y: down ? b.y : b.y + b.h };
  const dy = Math.max(14, Math.abs(p3.y - p0.y) * 0.45) * (down ? 1 : -1);
  return [p0, { x: p0.x, y: p0.y + dy }, { x: p3.x, y: p3.y - dy }, p3];
}

// One-line summaries for the zoomed-out card.
function summaryOf(n) {
  const t = plain(String(n.text || '').split('\n').find((p) => p.trim() && !p.startsWith('![[')) || '');
  const i = t.indexOf('。');
  return i > 0 ? t.slice(0, i + 1) : t;
}
function factsLine(n, code) {
  const out = [];
  if (n.api && n.api.params && n.api.params.length) out.push(`引数 ${n.api.params.length}`);
  if (n.fields && n.fields.length) out.push(`${n.kind === 'hw' ? 'ビット' : 'フィールド'} ${n.fields.length}`);
  if (n.values && n.values.length) out.push(`値 ${n.values.filter((v) => v[0] !== '…').length}`);
  if (n.ops && n.ops.length) out.push(`操作 ${n.ops.length}`);
  if (n.states) out.push(`移り方 ${n.states.moves.length}`);
  if (code) out.push(`コード ${code.end - code.start + 1} 行`);
  return out.join('・');
}

// ---- Groups (files) inside layers, layers stacked, cross-cutting layers on an island ----
export const BAND = { padTop: 250, padBottom: 80, padL: 90, padR: 90, gap: 60 };
export const GROUP = { padTop: 60, pad: 22, gap: 70 };

export function buildWorld(cards) {
  const rank = { ...FLOW_RANK };
  // Nodes outside the flows sit next to what they point at.
  for (let pass = 0; pass < 3; pass++) for (const k of IDS) {
    if (rank[k] != null) continue;
    const nb = [...(NEIGHBOURS[k] || new Map()).keys()].filter((x) => rank[x] != null);
    if (nb.length) rank[k] = nb.reduce((s, x) => s + rank[x], 0) / nb.length + 0.5;
  }
  let tail = 1000;
  for (const k of IDS) if (rank[k] == null) rank[k] = tail++;

  const groupKey = (k) => (NODES[k].code && NODES[k].code[0]) || '—';
  const groups = [];
  const byLayer = {};
  for (const layer of [...STACK, ...CROSS]) {
    const ids = IDS.filter((k) => NODES[k].layer === layer);
    const m = new Map();
    for (const k of ids) { const g = groupKey(k); if (!m.has(g)) m.set(g, []); m.get(g).push(k); }
    const gs = [...m.entries()].map(([key, ids]) => {
      ids.sort((a, b) => rank[a] - rank[b]);
      const g = { key, layer, ids, rank: Math.min(...ids.map((x) => rank[x])), label: groupLabel(key), cards: ids.map((x) => cards[x]) };
      packGroup(g);
      return g;
    });
    gs.sort((a, b) => a.rank - b.rank);
    byLayer[layer] = gs;
    groups.push(...gs);
  }

  // Stacked layers: groups placed under/over what they connect to.
  const bands = [];
  let y = 0;
  for (const layer of STACK) {
    const gs = byLayer[layer];
    let x = BAND.padL;
    for (const g of gs) { g.x = x; x += g.w + GROUP.gap; }
    const h = Math.max(...gs.map((g) => g.h));
    bands.push({ layer, y, h: h + BAND.padTop + BAND.padBottom, groups: gs });
    for (const g of gs) g.y = y + BAND.padTop;
    y += h + BAND.padTop + BAND.padBottom + BAND.gap;
  }
  const centerOf = {};
  const place = () => { for (const g of groups) if (g.x != null) for (const c of g.cards) centerOf[c.id] = c.gx + g.x + c.w / 2; };
  for (const g of groups) for (const c of g.cards) { c.gx = c.lx; }
  place();
  // All bands share the width of the widest one; inside it, each file sits under or over what it talks to.
  const need = (gs) => gs.reduce((a, g) => a + g.w, 0) + GROUP.gap * (gs.length - 1);
  const Wmax = BAND.padL + Math.max(...bands.map((b) => need(b.groups))) + 300;
  for (let it = 0; it < 8; it++) {
    const seq = it % 2 ? [...bands].reverse() : bands;
    for (const band of seq) {
      const gs = band.groups;
      const want = gs.map((g) => {
        let sw = 0, sx = 0;
        for (const c of g.cards) for (const [nb, wt] of NEIGHBOURS[c.id] || []) {
          const L = NODES[nb] && NODES[nb].layer;
          if (L === band.layer || !STACK.includes(L) || centerOf[nb] == null) continue;
          sw += wt; sx += wt * (centerOf[nb] - (c.gx + c.w / 2) + g.w / 2);
        }
        return sw ? sx / sw - g.w / 2 : g.x;
      });
      // Keep the order, respect the gaps, stay inside the common width, stay near the wish.
      const xs = want.slice();
      for (let i = 0; i < gs.length; i++) xs[i] = Math.max(xs[i], i ? xs[i - 1] + gs[i - 1].w + GROUP.gap : BAND.padL);
      for (let i = gs.length - 1; i >= 0; i--) xs[i] = Math.min(xs[i], i < gs.length - 1 ? xs[i + 1] - gs[i].w - GROUP.gap : Wmax - gs[i].w);
      for (let i = 0; i < gs.length; i++) xs[i] = Math.max(xs[i], i ? xs[i - 1] + gs[i - 1].w + GROUP.gap : BAND.padL);
      gs.forEach((g, i) => { g.x = xs[i]; });
      place();
    }
  }
  // Make the left edge start at padL.
  const minX = Math.min(...bands.flatMap((b) => b.groups.map((g) => g.x)));
  for (const b of bands) for (const g of b.groups) g.x += BAND.padL - minX;
  const W = Math.max(...bands.flatMap((b) => b.groups.map((g) => g.x + g.w))) + BAND.padR;
  // Each layer is a continent that hugs its files, so a layer with more boxes is a bigger piece of land.
  for (const b of bands) {
    b.x = Math.min(...b.groups.map((g) => g.x)) - BAND.padL;
    b.w = Math.max(...b.groups.map((g) => g.x + g.w)) + BAND.padR - b.x;
  }
  const stackH = y - BAND.gap;

  // The island: contract, context, policy stacked in a column to the right, across the sea.
  const islandX = W + 260;
  const island = { x: islandX, y: 0, parts: [] };
  let iy = 0, iw = 0;
  const maxRow = 3 * CW + 2 * GUT + 2 * GROUP.pad;
  for (const layer of CROSS) {
    const gs = byLayer[layer];
    // shelves of groups
    let x = 70, rowY = iy + BAND.padTop, rowH = 0;
    for (const g of gs) {
      if (x > 70 && x + g.w > 70 + maxRow) { x = 70; rowY += rowH + GROUP.gap; rowH = 0; }
      g.x = islandX + x; g.y = rowY; x += g.w + GROUP.gap; rowH = Math.max(rowH, g.h); iw = Math.max(iw, x - GROUP.gap + 70);
    }
    const partH = rowY + rowH + BAND.padBottom - iy;
    island.parts.push({ layer, y: iy, h: partH });
    iy += partH;
  }
  island.w = iw; island.h = iy;
  for (const p of island.parts) { p.x = islandX; p.w = iw; }

  // Absolute card rects.
  const rects = {};
  for (const g of groups) for (const c of g.cards) {
    c.x = g.x + c.lx; c.y = g.y + c.ly;
    rects[c.id] = c;
  }
  const bounds = { x: 0, y: 0, w: islandX + iw, h: Math.max(stackH, iy) };
  return { bands, groups, island, cards: rects, bounds, stackW: W, stackH };
}

function groupLabel(key) {
  if (key === '—') return { repo: '', rel: 'ファイルに対応しないもの', none: true };
  const p = splitPath(key);
  return { repo: p.repo, rel: p.rel };
}

// Cards in rank order. Stacked layers keep each file on one row (a street of cards);
// the cross-cutting island packs up to three columns. Wide cards take two columns.
function packGroup(g) {
  const units = g.cards.reduce((s, c) => s + (c.wide ? 2 : 1), 0);
  let cols = units;
  if (CROSS.includes(g.layer)) cols = Math.min(units, 3);
  if (g.cards.some((c) => c.wide)) cols = Math.max(cols, 2);
  const colY = new Array(cols).fill(0);
  for (const c of g.cards) {
    const span = c.wide ? 2 : 1;
    let best = 0, bestY = Infinity;
    for (let i = 0; i + span <= cols; i++) {
      const yy = Math.max(...colY.slice(i, i + span));
      if (yy < bestY - 0.5) { bestY = yy; best = i; }
    }
    c.lx = GROUP.pad + best * (CW + GUT);
    c.ly = GROUP.padTop + bestY;
    for (let i = best; i < best + span; i++) colY[i] = bestY + c.h + GUT;
  }
  g.w = GROUP.pad * 2 + cols * CW + (cols - 1) * GUT;
  g.h = GROUP.padTop + Math.max(...colY) - GUT + GROUP.pad;
}

// ---- Routes: a flow's steps as curves between cards ----
export function buildRoutes(world, f) {
  const R = world.cards;
  const ends = [];
  const bandOf = (c) => world.bands.find((b) => c.y >= b.y && c.y <= b.y + b.h);
  const steps = f.steps.map((st, i) => {
    const a = R[boxOf(f, st.from).node], b = R[boxOf(f, st.to).node];
    const s = { i, st, a, b };
    if (!a || !b) return s;
    const ba = bandOf(a), bb = bandOf(b);
    if (ba && ba === bb) {
      // same layer: leave from the top, travel through the band's empty header, come down on top
      s.sa = 't'; s.sb = 't'; s.arcY = ba.y + 250 * 0.42;
    } else {
      const down = b.y > a.y;
      s.sa = down ? 'b' : 't'; s.sb = down ? 't' : 'b';
    }
    ends.push({ s, end: 'a', card: a, side: s.sa, other: b });
    ends.push({ s, end: 'b', card: b, side: s.sb, other: a });
    return s;
  });
  // Spread the ends that share a side, ordered by where the other end is.
  const bySide = new Map();
  for (const e of ends) { const key = e.card.id + e.side; if (!bySide.has(key)) bySide.set(key, []); bySide.get(key).push(e); }
  for (const list of bySide.values()) {
    const horiz = list[0].side === 't' || list[0].side === 'b';
    list.sort((p, q) => (horiz ? (p.other.x + p.other.w / 2) - (q.other.x + q.other.w / 2) : (p.other.y) - (q.other.y)) || p.s.i - q.s.i);
    list.forEach((e, j) => {
      const c = e.card, t = (j + 1) / (list.length + 1);
      let p;
      if (e.side === 't') p = { x: c.x + c.w * (0.2 + 0.6 * t), y: c.y };
      else if (e.side === 'b') p = { x: c.x + c.w * (0.2 + 0.6 * t), y: c.y + c.h };
      else p = { x: e.side === 'r' ? c.x + c.w : c.x, y: c.y + 34 + Math.min(110, c.h * 0.4) * t };
      e.s[e.end === 'a' ? 'pa' : 'pb'] = p;
    });
  }
  const N = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  for (const s of steps) {
    if (!s.pa) continue;
    const d = Math.hypot(s.pb.x - s.pa.x, s.pb.y - s.pa.y);
    const m = Math.max(50, Math.min(d * 0.42, 340));
    const na = N[s.sa], nb = N[s.sb];
    if (s.arcY != null) s.pts = [s.pa, { x: s.pa.x, y: s.arcY }, { x: s.pb.x, y: s.arcY }, s.pb];
    else s.pts = [s.pa, { x: s.pa.x + na[0] * m, y: s.pa.y + na[1] * m }, { x: s.pb.x + nb[0] * m, y: s.pb.y + nb[1] * m }, s.pb];
    s.no = stepNo(s.st, s.i);
    s.paper = intoPaper(f, s.st);
  }
  return steps;
}

export function bezier(p, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}
export function bezierTangent(p, t) {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p[1].x - p[0].x) + 6 * u * t * (p[2].x - p[1].x) + 3 * t * t * (p[3].x - p[2].x),
    y: 3 * u * u * (p[1].y - p[0].y) + 6 * u * t * (p[2].y - p[1].y) + 3 * t * t * (p[3].y - p[2].y),
  };
}
