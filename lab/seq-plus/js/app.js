// やりとり図: the flows of the MyAtlas map as sequence diagrams. Lifelines stand under their execution
// contexts and carry their layer's colour; arrows are drawn by kind; papers open in place as ref
// fragments with their own lifelines; ways taken instead and branches are alt fragments. The text of
// every step stands in the left column, the recorded time in the right one.
import { makeAtlas, buildRows, buildLifelines, frameSpans, activations, allRefIds, stepNo, stepBadge, boxOf, KINDS, KIND_LABEL, textParts, plainText } from './model.js';
import { traceInfo, occurrences, mapTimes, threadName, threadShort, WHY } from './trace.js';
import { esc, fmt, textW, splitName, highlight, clamp, lerp, ease, reduceMotion, isJa } from './util.js';

const X = makeAtlas(window.ATLAS, window.ATLAS_CODE);
const T = traceInfo(X);
const NODES = X.nodes;
const $ = (s, el = document) => el.querySelector(s);

// ---------------------------------------------------------------- state
const state = {
  flow: X.A.flows[0].id,
  open: new Map(X.A.flows.map((f) => [f.id, new Set()])),
  active: new Map(),
  occ: new Map(),
  time: true,
  insp: false,
  inspNode: null,
  hoverLife: null,
  hoverRow: null,
  playing: false,
  mini: true,
  narr: true,
  allOpen: new Map(), // per flow: papers were opened all at once, so opening one does not close the others
};
let M = null; // the built model of the current flow
let G = null; // its geometry (target)
let shown = null; // geometry on screen (during a tween it moves toward G)

const C = {
  narrW: 286, timeW: 144, minCol: 82, maxCol: 168, narrSlim: 50,
  arrowDy: 38, stepMin: 64, ftopH: 34, operandH: 32, fbotH: 14, refH: 72,
  grpH: 30, cardPad: 10,
};

// Narrower desktops get narrower text and time columns.
function sizeCols() {
  const w = window.innerWidth, n = w < 1280 ? 264 : 286, t = w < 1280 ? 128 : 144;
  const changed = n !== C.narrW || t !== C.timeW;
  C.narrW = n; C.timeW = t;
  return changed;
}
sizeCols();

// ---------------------------------------------------------------- dom
const stage = $('#stage'), sheet = $('#sheet'), heads = $('#heads'), narr = $('#narr'), timeCol = $('#time');
const svg = $('#svg'), cornerL = $('#cornerL'), cornerR = $('#cornerR'), insp = $('#insp'), tip = $('#tip');

const layerOf = (nodeId) => NODES[nodeId]?.layer;
const LAYER_IDS = ['app', 'lib', 'os', 'kernel', 'emu'];
const lc = (layer) => (LAYER_IDS.includes(layer) ? `var(--l-${layer})` : 'var(--text-3)');
const lt = (layer, k) => (LAYER_IDS.includes(layer) ? `var(--${layer}-t${k})` : 'var(--surface-2)');
const currentFlow = () => X.A.flows.find((f) => f.id === state.flow);
const openSet = () => state.open.get(state.flow);
const compact = () => stage.clientWidth < 760;

// ---------------------------------------------------------------- threads
const TH = new Map();
if (T) {
  let k = 0;
  for (const t of T.threadIds) {
    const nm = (T.tr.threads || {})[String(t)] || '';
    TH.set(t, /idle/.test(nm) ? 'var(--th-idle)' : nm.startsWith('kernel:') ? (k++ === 0 ? 'var(--th-k1)' : 'var(--th-k2)') : 'var(--th-app)');
  }
}
const thColor = (t) => TH.get(t) || 'var(--th-k2)';

// ---------------------------------------------------------------- the top bar
function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = X.A.flows.map((f, i) => `<button role="tab" type="button" data-flow="${f.id}" aria-selected="${f.id === state.flow}" title="${esc(f.title)}（${i + 1}）">${esc(f.tab || f.id)}</button>`).join('');
  const f = currentFlow();
  $('#flowTitle').textContent = f.title;
  const all = allRefIds(X, f), open = openSet();
  $('#openAll').querySelector('.t').textContent = all.length && all.every((id) => open.has(id)) ? '中の紙をすべて閉じる' : '中の紙をすべて開く';
  $('#timeBtn').setAttribute('aria-pressed', String(state.time));
  $('#inspBtn').setAttribute('aria-pressed', String(state.insp));
  $('#playBtn').setAttribute('aria-pressed', String(state.playing));
  $('#playBtn').querySelector('.t').textContent = state.playing ? '止める' : '順に見る';
}

function layerKey() {
  $('#layersKey').innerHTML = `<li class="lh">層の色</li>` + X.A.layers.filter((l) => !l.cross).map((l) => `<li><i class="sw" style="background:${lc(l.id)}"></i>${esc(l.name)}</li>`).join('');
}

// ---------------------------------------------------------------- arrow drawing (shared by legend and diagram)
function arrowSvg(kind, x1, x2, y, on = false) {
  const dir = x2 >= x1 ? 1 : -1;
  const open = kind === 'msg' || kind === 'signal' || kind === 'return' || kind === 'data';
  const hl = kind === 'syscall' ? 12 : 10, hw = kind === 'syscall' ? 6 : 5;
  const end = open ? x2 - dir * 1.5 : x2 - dir * (hl - 1);
  let s = `<path class="ln" d="M${x1},${y}H${end}"/>`;
  if (open) s += `<path class="hd open" d="M${x2 - dir * 9},${y - 5}L${x2},${y}L${x2 - dir * 9},${y + 5}"/>`;
  else s += `<path class="hd" d="M${x2},${y}l${-dir * hl},${-hw}v${hw * 2}z"/>`;
  if (kind === 'syscall') s += `<rect class="gate" x="${x1 - 4}" y="${y - 4}" width="8" height="8" rx="1.5"/>`;
  if (kind === 'data') s += `<circle class="dot" cx="${x1}" cy="${y}" r="3.6"/>`;
  if (kind === 'signal') { const bx = x1 + dir * 15; s += `<path class="bolt" d="M${bx + 1.5},${y - 8}L${bx - 3.5},${y + 1}H${bx}L${bx - 1.5},${y + 8}L${bx + 3.5},${y - 1}H${bx}Z"/>`; }
  return s;
}

function legendHtml(sw = 34) {
  const v = `0 0 ${sw} 16`, m = sw / 2;
  const items = KINDS.map(([k, label]) => `<li title="${esc(label)}"><svg width="${sw}" height="14" viewBox="0 0 ${sw} 14"><g class="msg k-${k}">${arrowSvg(k, 4, sw - 3, 7)}</g></svg>${esc(label.replace(/（.*）/, ''))}</li>`).join('');
  const shapes = `<li title="関数が動いている間。呼んだ側は、呼んだ先が終わるまで続く"><svg width="${sw}" height="16" viewBox="${v}"><line x1="${m}" x2="${m}" y1="0" y2="16" stroke="var(--text-3)"/><rect x="${m - 5}" y="2" width="10" height="12" rx="2.5" fill="var(--surface-2)" stroke="var(--text-2)"/></svg>動いている間</li>`
    + `<li title="置き場（データの入れ物）は点線"><svg width="${sw}" height="16" viewBox="${v}"><line x1="${m}" x2="${m}" y1="0" y2="16" stroke="var(--text-2)" stroke-dasharray="4 3"/></svg>置き場は点線</li>`
    + `<li title="条件で道が分かれる（UML の alt）"><svg width="${sw}" height="16" viewBox="${v}"><rect x="2" y="1.5" width="${sw - 4}" height="13" rx="3" fill="none" stroke="var(--ink-soft)"/><path d="M2,4.5a3,3 0 0 1 3,-3H${m + 2}v6l-3,3H2Z" fill="var(--surface-2)" stroke="var(--ink-soft)"/></svg>もし・分かれ道</li>`
    + `<li title="箱の中の紙。押すとその場に開く（UML の ref）"><svg width="${sw}" height="16" viewBox="${v}"><rect x="2" y="1.5" width="${sw - 4}" height="13" rx="4" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.3"/><path d="M2,5.5a4,4 0 0 1 4,-4H${m + 2}v6l-3,3H2Z" fill="var(--accent)"/></svg>中の紙</li>`;
  return `<ul class="legend">${items}</ul><ul class="legend legend2">${shapes}</ul>`;
}
const narrWidth = () => (state.narr ? C.narrW : C.narrSlim);
function legend() {
  cornerL.innerHTML = state.narr
    ? `<div class="cin" style="width:${C.narrW}px"><p class="lg-title">矢印の種類<span>上から下へ時間が進む</span><button type="button" class="ntoggle" data-narr="0" title="手順の文を畳んで、図を広くする（n）" aria-label="手順の文を畳む">◂</button></p>${legendHtml(C.narrW < 270 ? 28 : 34)}</div>`
    : `<div class="cin slim" style="width:${C.narrSlim}px"><button type="button" class="ntoggle open" data-narr="1" title="手順の文を出す（n）" aria-label="手順の文を出す">▸<span>文</span></button></div>`;
  $('#legendBody').innerHTML = `<section><h4>矢印の種類（上から下へ時間が進む）</h4>${legendHtml(40)}</section><section><h4>層の色</h4><ul class="legend">${X.A.layers.filter((l) => !l.cross).map((l) => `<li><i class="sw" style="background:${lc(l.id)}"></i>${esc(l.name)}</li>`).join('')}</ul><p class="hint">カードの上の帯・生存線・動いている間の棒が、その箱の層の色。点線の枠は実行の文脈（斜線はカーネルの中で走る）。</p></section>`;
}
function toggleLegendSheet(on) {
  const el = $('#legendSheet');
  el.hidden = !(on ?? el.hidden);
}
function toggleMenu(on) {
  const m = $('#moreMenu'), b = $('#moreBtn');
  const open = on ?? m.hidden;
  m.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
  if (open) {
    const all = allRefIds(X, currentFlow()), set = openSet();
    m.querySelector('[data-act="all"]').firstChild.textContent = all.length && all.every((id) => set.has(id)) ? '中の紙をすべて閉じる' : '中の紙をすべて開く';
    m.querySelector('[data-act="time"]').firstChild.textContent = state.time ? '記録の時間を隠す' : '記録の時間を出す';
    m.querySelector('[data-act="play"]').firstChild.textContent = state.playing ? '止める' : '順に見る';
    m.querySelector('[data-act="rec"]').firstChild.textContent = rec.on ? '止める' : '記録で流す';
  }
}

// ---------------------------------------------------------------- the model
function build() {
  const flow = currentFlow();
  const model = buildRows(X, flow, openSet());
  const L = buildLifelines(X, flow, model);
  const spans = frameSpans(X, model, L);
  const bars = activations(X, model, L);
  const occs = occurrences(X, T, model);
  const occI = clamp(state.occ.get(flow.id) ?? 0, 0, Math.max(0, occs.length - 1));
  const times = occs.length ? mapTimes(X, T, model, occs[occI]) : new Map();
  const stepRows = model.rows.filter((r) => r.type === 'step' || r.type === 'ref');
  const barsBy = new Map();
  for (const b of bars) { if (!barsBy.has(b.key)) barsBy.set(b.key, []); barsBy.get(b.key).push(b); }
  return { flow, model, L, spans, bars, barsBy, occs, occI, times, stepRows };
}
const lkey = (r, which) => M.L.keyOf(r.scope, which === 'from' ? r.st.from : r.st.to);
const nodeOfRow = (r, which) => boxOf(r.sheet, which === 'from' ? r.st.from : r.st.to).node;
const lifeOf = (key) => M.L.byKey.get(key);
const frameChain = (r) => { const out = []; for (let f = r.frame; f; f = f.parent) out.unshift(f); return out; };
const isInner = (r) => r.scope && r.scope.depth > 0;

// ---------------------------------------------------------------- cards: one per lifeline
function cardTitle(l) {
  const b = l.box;
  return b.short || b.title;
}
function cardSub(l) {
  if (l.box.ns) return { t: l.box.ns, mono: true };
  if (l.band) return { t: l.band.name, mono: false };
  const n = NODES[l.node];
  return { t: X.layers[n?.layer]?.name || '', mono: false };
}
// What the lifeline does, in the map's words: the box's description, or what a place holds.
function cardRole(l) {
  const b = l.box;
  if (b.sub) return b.sub;
  if (b.bits) return b.bits.map(([name, n]) => `${name} ${n} ビット`).join('・');
  if (b.slots) { const u = [...new Set(b.slots)]; return u.length === 1 && b.slots.length > 1 ? `${u[0]} が並ぶ` : u.join('・'); }
  return '';
}
// Extra width found by measuring: a role line that the browser breaks into three lines gets a wider column.
const extraW = new Map();
// A column is as wide as its card needs: the name on one line, or on two when the flow would not fit.
function colOptions(l) {
  const t = cardTitle(l), mono = !isJa(t);
  const sub = cardSub(l);
  const subW = (lines) => Math.max(...lines.map((x) => textW(x, 11, 400, sub.mono)));
  const make = (lines) => {
    const w1 = Math.max(...lines.map((x) => textW(x, 12.5, 700, mono)));
    let w = clamp(w1 + 22, C.minCol, C.maxCol);
    let subLines = [sub.t];
    if (subW(subLines) > w - 14) {
      subLines = splitName(sub.t, w - 14, 11, 400, sub.mono);
      w = clamp(Math.max(w, subW(subLines) + 16), C.minCol, C.maxCol);
    }
    return { w, lines, subLines };
  };
  // the role line should fit in two lines and never break inside a latin word
  const role = cardRole(l);
  let roleMin = 0;
  if (role) {
    const runs = role.match(/[A-Za-z0-9_@().,\[\]=+*&:-]+/g) || [];
    const latin = Math.max(0, ...runs.map((x) => textW(x, 11, 400)));
    const halves = splitName(role, 1, 11, 400, false);
    const two = Math.max(...halves.map((x) => textW(x, 11, 400)));
    roleMin = Math.min(C.maxCol, Math.ceil(Math.max(latin, two)) + 29);
  }
  const fit = (o) => ({ ...o, w: Math.min(C.maxCol, Math.max(o.w, roleMin) + (extraW.get(l.key + '|' + role) || 0)) });
  const one = fit(make(splitName(t, C.maxCol - 18, 12.5, 700, mono)));
  const two = one.lines.length > 1 ? one : fit(make(splitName(t, 1, 12.5, 700, mono)));
  return { one, two: two.w < one.w ? two : one };
}

// ---------------------------------------------------------------- text column cells (built once per model)
const cellEls = new Map(), timeEls = new Map(), cardEls = new Map(), grpEls = new Map();

function dataMeta(st) {
  const d = st.data;
  let s = '';
  if (d) {
    const plain = d.chip === false || !d.schema;
    s += `<span class="chip${plain ? ' plain' : ''}" title="${esc(d.type || d.label)}">${plain ? '' : structIcon()}${esc(d.label)}</span>`;
    if (d.fields && d.fields.length) s += `<span class="fields">${d.fields.map(esc).join('・')}</span>`;
    else if (d.type && d.type !== d.label) s += `<span class="fields">${esc(d.type)}</span>`;
  }
  for (const op of st.ops || []) s += `<span class="op">${esc(NODES[op.node]?.title || op.node)}：${esc(op.kind)}</span>`;
  return s;
}
const structIcon = () => `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2.5h9v7h-9z M1.5 5h9 M5 5v4.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

function railsHtml(r) {
  const ch = frameChain(r);
  return `<div class="rails">${ch.map((f, d) => `<i class="rail ${f.type === 'ref' ? 'ref' : 'alt'}" style="left:${8 + d * 12}px"></i>`).join('')}</div>`;
}
function indent(r) { return frameChain(r).length * 12; }

function stepTitleLine(r) {
  const st = r.st, b = stepBadge(X, r.sheet, r.i);
  const cls = st.alt ? 'alt' : isInner(r) ? 'inner' : '';
  return `<span class="badge ${cls}" aria-hidden="true">${esc(b)}</span>`;
}

function cellHtml(r) {
  const pad = `padding-left:${18 + indent(r)}px`;
  if (r.type === 'step') {
    const st = r.st;
    let meta = dataMeta(st);
    if (compact() && state.time) {
      const t = M.times.get(r.key);
      if (t && !t.why) meta += `<span class="op tm" style="--th:${thColor(t.thread)}"><i class="${t.quality}"></i>${t.quality === 'same' ? '〃' : '記録 ' + fmt(t.instr)}</span>`;
    }
    const who = `${cardTitle(lifeOf(lkey(r, 'from')))} → ${cardTitle(lifeOf(lkey(r, 'to')))}`;
    return `<div class="cell step" data-row="${esc(r.key)}" style="${pad}" role="button" tabindex="-1" aria-label="${esc(stepNo(X, r.sheet, r.i) + '：' + st.label)}">${railsHtml(r)}${stepTitleLine(r)}<div class="txt"><p class="lbl">${esc(st.label)}</p>${meta ? `<p class="meta">${meta}</p>` : ''}</div><span class="sr-only">${esc(who)}</span></div>`;
  }
  if (r.type === 'ftop') {
    const fr = r.frame;
    if (fr.type === 'ref') {
      const p = fr.paper, ports = Object.entries(p.ports || {}).map(([outer, box]) => `${esc(boxOf(p, box)?.title || box)} ↔ 外の ${esc(NODES[outer]?.title || outer)}`);
      const entry = boxOf(p, p.entry);
      return `<div class="cell ftop ref" data-row="${esc(r.key)}" style="${pad}" title="${esc(ports.length ? '外への口：' + ports.join('、') : '')}">${railsHtml(r)}<div class="gtext"><span class="ptitle">${esc(p.title)}</span><span class="pline"><span class="ports">入口は ${esc(entry ? entry.title : p.entry)}</span><button class="pbtn" type="button" data-close="${esc(fr.id)}" title="閉じる（Esc）">閉じる</button></span></div></div>`;
    }
    if (fr.sub === 'branch') return `<div class="cell ftop" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}<span class="gtext"><span class="kw">分かれ道</span><span class="guard">${esc(r.guard)}</span> なら → ${outcomeHtml(r.outcome)}</span></div>`;
    return `<div class="cell ftop" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}<span class="gtext"><span class="kw">もし</span><span class="guard">${esc(r.guard)}</span> 時</span></div>`;
  }
  if (r.type === 'operand') {
    const fr = r.frame;
    if (fr.sub === 'branch') return `<div class="cell operand" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}<span class="gtext"><span class="guard">${esc(r.guard)}</span> なら → <span class="out">${outcomeHtml(r.outcome)}</span></span></div>`;
    const at = fr.at != null ? stepNo(X, fr.scope.sheet, fr.at) : '';
    return `<div class="cell operand" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}<span class="gtext"><span class="guard">${esc(r.guard)}</span> の時は、${esc(at)} の代わりに</span></div>`;
  }
  if (r.type === 'fbot') return `<div class="cell fbot" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}</div>`;
  if (r.type === 'fold') {
    const chips = r.ghosts.map((gh) => {
      const inner = gh.ks.map((k) => stepNo(X, r.child.sheet, k)).join('・');
      const tip = `外の ${stepNo(X, r.sheet, gh.i)}「${gh.st.verb || gh.st.label}」は、上の紙の ${inner} と同じこと。紙を開いている間は、外の矢印を描かない`;
      return `<button type="button" class="gchip" data-goto="${esc(gh.keys[0])}" title="${esc(tip)}"><span class="badge ghost${gh.st.alt ? ' alt' : ''}">${esc(stepBadge(X, r.sheet, gh.i))}</span><span class="gv">${esc(gh.st.verb || KIND_LABEL[gh.st.kind] || '')}</span><span class="eq">＝ 紙の</span>${gh.ks.map((k) => `<span class="badge inner${r.child.sheet.steps[k].alt ? ' alt' : ''}">${esc(stepBadge(X, r.child.sheet, k))}</span>`).join('')}</button>`;
    }).join('');
    return `<div class="cell fold" data-row="${esc(r.key)}" style="${pad}">${railsHtml(r)}<div class="ftxt"><p class="fhead">外の手順のうち、上の紙が描いたもの</p><div class="gchips">${chips}</div></div></div>`;
  }
  if (r.type === 'ref') {
    const fr = r.frame, p = fr.paper;
    const n = p.steps.filter((s) => !s.alt).length, alt = p.steps.length - n;
    return `<div class="cell ref" data-row="${esc(r.key)}" data-open="${esc(fr.id)}" style="${pad}" role="button" tabindex="-1">${railsHtml(r)}<div class="rtxt"><span class="pline"><b>中の紙</b><span class="hint">${n} 手順${alt ? `・もし ${alt}` : ''}</span><button class="pbtn" type="button" data-open="${esc(fr.id)}">開く <span aria-hidden="true">▸</span></button></span><span class="ptitle2">${esc(p.title)}</span></div></div>`;
  }
  return '';
}
function outcomeHtml(s) {
  return textParts(s).map((p) => (p.t === 'text' ? esc(p.s) : `<b>${esc(NODES[p.id]?.title || p.id)}</b>`)).join('');
}

function timeHtml(r) {
  if (r.type !== 'step') return '';
  const t = M.times.get(r.key);
  if (!t) return '';
  if (t.why) return `<div class="tcell none" data-row="${esc(r.key)}" data-why="${esc(t.why)}">—</div>`;
  if (t.quality === 'same') return `<div class="tcell same" data-row="${esc(r.key)}" style="--th:${thColor(t.thread)}"><div class="tn"><i></i>〃<small>同じ呼び出し</small></div></div>`;
  const prev = prevMapped(r);
  const sw = prev && prev.thread !== t.thread ? `<div class="sw-th"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3h7l-2-2M9 7H2l2 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>${esc(threadShort(T, t.thread))}</div>` : '';
  const delta = t.delta != null ? `<div class="td">+${fmt(t.delta)}<span class="bar" style="width:${barW(t.delta)}px"></span></div>` : `<div class="td">${t.irq ? '割り込み（timer）' : 'この回の最初'}</div>`;
  const fnLine = t.quality === 'target' && t.fn ? `<div class="fn" title="この時刻は ${esc(t.fn)} に入った時刻（${esc(threadName(T, t.thread))}）">${esc(t.fn.replace(/^[^.]*\./, ''))} に入った</div>` : '';
  return `<div class="tcell" data-row="${esc(r.key)}" style="--th:${thColor(t.thread)}">${sw}<div class="tn"><i class="${t.quality}"></i>${fmt(t.instr)}</div>${fnLine}${delta}</div>`;
}
function prevMapped(r) {
  let prev = null;
  for (const x of M.model.rows) {
    if (x === r) return prev;
    const t = M.times.get(x.key);
    if (t && !t.why && t.quality !== 'same') prev = t;
  }
  return prev;
}
const barW = (d) => clamp((Math.log10(Math.max(d, 10)) - 1) / 5, 0, 1) * 64 + 2;
// Japanese text kept whole at its natural breaks: 「Editor で「x」を」「打った 1 回」.
const phrases = (t) => String(t).split(/(?<=[をにでがはと])/).map((p) => `<span class="ph">${esc(p)}</span>`).join('');

// ---------------------------------------------------------------- layout
function layout(round = 0) {
  const cp = compact();
  const narrW = cp ? 0 : narrWidth();
  sheet.classList.toggle('narr-off', !cp && !state.narr);
  const timeW = !state.time || cp || !T ? 0 : C.timeW;
  const order = M.L.order;
  // column widths: the name decides; long names go on two lines when the flow would not fit otherwise
  const opts = order.map((l) => colOptions(l));
  const cols = opts.map((o) => ({ ...o.one }));
  const runs = ctxRuns();
  const padX = 8;
  const avail = stage.clientWidth - narrW - timeW - (stage.offsetWidth - stage.clientWidth) - 1;
  const widen = () => {
    for (const run of runs) {
      const need = textW(run.label, 12, 600) + 22;
      const have = run.idx.reduce((s, i) => s + cols[i].w, 0);
      if (have < need) for (const i of run.idx) cols[i].w += (need - have) / run.idx.length;
    }
  };
  widen();
  let total = cols.reduce((s, c) => s + c.w, 0);
  if (total + 2 * padX > avail) {
    // wrap the names that gain most, but only when that makes the whole flow fit
    const tryCols = cols.map((c) => ({ ...c }));
    const gains = opts.map((o, i) => [o.one.w - o.two.w, i]).filter(([g]) => g > 0).sort((a, b) => b[0] - a[0]);
    let fits = false;
    for (const [, i] of gains) {
      tryCols[i] = { ...opts[i].two };
      for (const run of runs) {
        const need = textW(run.label, 12, 600) + 22;
        const have = run.idx.reduce((s, k) => s + tryCols[k].w, 0);
        if (have < need) for (const k of run.idx) tryCols[k].w += (need - have) / run.idx.length;
      }
      if (tryCols.reduce((s, c) => s + c.w, 0) + 2 * padX <= avail) { fits = true; break; }
    }
    if (fits) tryCols.forEach((c, i) => (cols[i] = c));
    total = cols.reduce((s, c) => s + c.w, 0);
  }
  if (total + 2 * padX < avail) {
    const k = Math.min((avail - 2 * padX) / total, 1.45);
    cols.forEach((c) => (c.w *= k));
    total *= k;
  }
  const diagW = Math.max(total + 2 * padX, cp ? stage.clientWidth : avail);
  const off = padX + Math.max(0, (diagW - 2 * padX - total) / 2);
  const colX = new Map(), colW = new Map();
  let x = off;
  order.forEach((l, i) => { colX.set(l.key, x + cols[i].w / 2); colW.set(l.key, cols[i].w); x += cols[i].w; });
  // heads
  const hasCtx = order.some((l) => l.ctx);
  const depth = Math.max(0, ...order.map((l) => l.papers.length));
  const levels = (hasCtx ? 1 : 0) + depth;
  // cards: the browser breaks the role line by phrase; all cards share the tallest height
  let cardH = 0;
  order.forEach((l, i) => {
    const el = cardEls.get(l.key);
    if (!el) return;
    setCardContent(el, l, cols[i]);
    el.style.width = cols[i].w - 8 + 'px';
    el.style.height = 'auto';
    cardH = Math.max(cardH, el.offsetHeight);
  });
  cardH = Math.ceil(cardH + 1);
  let again = false;
  order.forEach((l) => {
    const role = cardEls.get(l.key)?.querySelector('.role');
    if (!role || role.offsetHeight < 40) return;
    const k = l.key + '|' + cardRole(l), x = extraW.get(k) || 0;
    if (x < 48) { extraW.set(k, x + 8); again = true; }
  });
  if (again && round < 6) return layout(round + 1);
  const inner = (el) => (el.firstElementChild ? el.firstElementChild.offsetHeight : 0);
  const cornerNeed = Math.max(inner(cornerL), state.time && !cp ? inner(cornerR) : 0);
  const headH = Math.max(12 + levels * C.grpH + cardH + 12, cp ? 0 : cornerNeed);
  const cardsTop = headH - cardH - 10;
  // rows: heights from the text column, measured at their natural height (draw() fixes them afterwards)
  const rowY = new Map(), rowH = new Map(), rowAy = new Map(), rowCap = new Map();
  for (const r of M.model.rows) { const el = cellEls.get(r.key); if (el) el.style.height = ''; }
  const naturalH = new Map(M.model.rows.map((r) => [r.key, cellEls.get(r.key)?.offsetHeight || 0]));
  let y = 10;
  for (const r of M.model.rows) {
    const natural = naturalH.get(r.key);
    let h;
    rowCap.set(r.key, cp && r.type !== 'fbot' ? natural : 0);
    if (cp) {
      if (r.type === 'step') h = natural + 54;
      else if (r.type === 'ref') h = natural + 74;
      else if (r.type === 'fbot') h = C.fbotH;
      else if (r.type === 'fold') h = natural + 34;
      else h = natural + (r.type === 'ftop' ? 30 : 28);
    } else if (r.type === 'step') h = Math.max(C.stepMin, natural + 12);
    else if (r.type === 'fold') h = Math.max(54, natural + 10);
    else if (r.type === 'ftop') h = Math.max(r.frame.type === 'ref' ? 46 : C.ftopH, natural + 8);
    else if (r.type === 'operand') h = Math.max(r.outcome ? 52 : C.operandH, natural + 8);
    else if (r.type === 'fbot') h = C.fbotH;
    else h = Math.max(C.refH, natural + 14);
    rowY.set(r.key, y); rowH.set(r.key, h);
    if (r.type === 'step') rowAy.set(r.key, cp ? y + natural + 30 : y + C.arrowDy);
    y += h;
  }
  const bodyH = y + 40 + (state.insp ? inspMax() + 20 : 0);
  return { cp, narrW, timeW, diagW, colX, colW, cols, order, headH, cardsTop, cardH, levels, hasCtx, rowY, rowH, rowAy, rowCap, bodyH, runs };
}

// Context runs: consecutive lifelines with the same execution context.
function ctxRuns() {
  const runs = [];
  const f = M.flow;
  M.L.order.forEach((l, i) => {
    const last = runs[runs.length - 1];
    if (l.ctx && last && last.ctx === l.ctx) last.idx.push(i);
    else if (l.ctx) runs.push({ ctx: l.ctx, region: l.region, idx: [i] });
  });
  for (const run of runs) {
    const n = NODES[run.ctx];
    run.full = run.region?.label || n?.title || run.ctx;
    run.short = run.region?.label3 || n?.title || run.full;
    run.label = run.short;
    run.kernel = !!n?.kernel;
    run.run = n?.run || '';
  }
  return runs;
}

// ---------------------------------------------------------------- building the DOM for a model
function buildDom() {
  // text cells
  const keep = new Set(M.model.rows.map((r) => r.key));
  for (const [k, el] of cellEls) if (!keep.has(k)) { el.remove(); cellEls.delete(k); }
  for (const [k, el] of timeEls) if (!keep.has(k)) { el.remove(); timeEls.delete(k); }
  const cp = compact();
  narr.style.width = cp ? stage.clientWidth + 'px' : narrWidth() + 'px';
  for (const r of M.model.rows) {
    const html = cellHtml(r);
    let el = cellEls.get(r.key);
    if (!el || el.dataset.html !== html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      fresh.dataset.html = html;
      if (el) el.replaceWith(fresh); else { fresh.style.opacity = '0'; narr.appendChild(fresh); fresh.dataset.enter = '1'; }
      el = fresh;
      cellEls.set(r.key, el);
    }
    const th = timeHtml(r);
    let te = timeEls.get(r.key);
    if (!th) { if (te) { te.remove(); timeEls.delete(r.key); } continue; }
    if (!te || te.dataset.html !== th) {
      const tmp = document.createElement('div');
      tmp.innerHTML = th;
      const fresh = tmp.firstElementChild;
      fresh.dataset.html = th;
      if (te) te.replaceWith(fresh); else { fresh.style.opacity = '0'; timeCol.appendChild(fresh); fresh.dataset.enter = '1'; }
      timeEls.set(r.key, fresh);
    }
  }
  // cards
  const keepL = new Set(M.L.order.map((l) => l.key));
  for (const [k, el] of cardEls) if (!keepL.has(k)) { el.remove(); cardEls.delete(k); }
  for (const l of M.L.order) {
    if (cardEls.has(l.key)) continue;
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.life = l.key;
    el.style.opacity = '0';
    el.dataset.enter = '1';
    heads.appendChild(el);
    cardEls.set(l.key, el);
  }
}

function setCardContent(el, l, col) {
  const t = cardTitle(l), ja = isJa(t);
  const sub = cardSub(l), role = cardRole(l);
  const html = `<span class="nm${ja ? ' ja' : ''}">${col.lines.map(esc).join('<br>')}</span><span class="ns${sub.mono ? '' : ' ja'}">${col.subLines.map(esc).join('<br>')}</span>${role ? `<span class="role">${esc(role)}</span>` : ''}`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
function fillCards(g) {
  for (const l of M.L.order) {
    const el = cardEls.get(l.key);
    const n = NODES[l.node] || {}, layer = n.layer;
    const i = g.order.indexOf(l);
    setCardContent(el, l, g.cols[i]);
    const p = l.scope.depth ? l.scope.sheet : null;
    const entry = p && p.entry === l.box.id;
    el.className = `card ${n.kind === 'store' ? 'store' : n.kind === 'hw' ? 'hw' : ''}${l.scope.depth ? ' inner' : ''}${entry ? ' entry' : ''}`;
    el.style.setProperty('--lc', lc(layer));
    el.style.setProperty('--lt0', lt(layer, 0));
  }
}

// ---------------------------------------------------------------- drawing one geometry
function draw(g, fade = 1) {
  sheet.style.gridTemplateColumns = `${g.cp ? 0 : g.narrW}px ${g.diagW}px ${g.timeW}px`;
  sheet.style.width = `${(g.cp ? 0 : g.narrW) + g.diagW + g.timeW}px`;
  sheet.style.gridTemplateRows = `${g.headH}px ${g.bodyH}px`;
  sheet.classList.toggle('time-off', !g.timeW);
  sheet.classList.toggle('compact', g.cp);
  document.body.classList.toggle('compact', g.cp);
  narr.style.height = g.bodyH + 'px';
  timeCol.style.height = g.bodyH + 'px';
  heads.style.width = g.diagW + 'px';
  heads.style.setProperty('--stick', (g.cp ? 8 : g.narrW + 10) + 'px');
  heads.style.height = g.headH + 'px';
  if (g.cp) { narr.style.gridColumn = '1 / span 2'; narr.style.width = stage.clientWidth + 'px'; }
  else { narr.style.gridColumn = ''; narr.style.width = g.narrW + 'px'; }
  drawHeads(g, fade);
  for (const r of M.model.rows) {
    const el = cellEls.get(r.key);
    if (el) {
      el.style.transform = `translateY(${g.rowY.get(r.key)}px)`;
      el.style.height = g.cp && r.type !== 'fbot' ? '' : g.rowH.get(r.key) + 'px';
      if (el.dataset.enter) el.style.opacity = String(fade);
      el.classList.toggle('on', r.key === activeKey());
    }
    const te = timeEls.get(r.key);
    if (te) {
      te.style.transform = `translateY(${g.rowY.get(r.key)}px)`;
      te.style.height = g.rowH.get(r.key) + 'px';
      if (te.dataset.enter) te.style.opacity = String(fade);
      te.classList.toggle('on', r.key === activeKey());
    }
  }
  svg.setAttribute('width', P(g.diagW));
  svg.setAttribute('height', P(g.bodyH));
  svg.innerHTML = diagramSvg(g, fade);
  stickTitles();
  if (g === G) renderMini(g);
}

function drawHeads(g, fade) {
  // groups: contexts at level 0, papers below
  const want = new Map();
  const level0 = 12;
  const half = (key) => g.colW.get(key) / 2;
  for (const run of g.runs) {
    const a = g.order[run.idx[0]], b = g.order[run.idx[run.idx.length - 1]];
    const x0 = g.colX.get(a.key) - half(a.key) + 3, x1 = g.colX.get(b.key) + half(b.key) - 3;
    const w = x1 - x0;
    const label = textW(run.full, 12, 600) + 22 <= w ? run.full : run.short;
    // the run text without what the label already says: "service task（OS のスレッド）" → "OS のスレッド"
    let runText = run.run && run.run.startsWith(label) ? run.run.slice(label.length).trim().replace(/^（(.*)）$/, '$1') : run.run;
    if (runText && (label.includes(runText) || runText.includes(label))) runText = '';
    const withRun = runText && textW(label, 12, 600) + textW(runText, 11) + 34 <= w;
    want.set('ctx:' + run.ctx + ':' + run.idx[0], {
      cls: 'grp ctx' + (run.kernel ? ' kern' : ''), x: x0, y: g.cardsTop - (g.levels) * C.grpH + 6 - 2, w, h: g.headH - (g.cardsTop - g.levels * C.grpH + 4),
      html: `<span class="stk"><b>${esc(label)}</b>${withRun ? `<span class="run">${esc(runText)}</span>` : ''}</span>`,
      title: `実行の文脈：${NODES[run.ctx]?.title || run.ctx}${run.run ? '・走るもの：' + run.run : ''}${run.kernel ? '・カーネルの中で走る' : ''}`,
      node: run.ctx,
    });
  }
  for (const sc of M.model.scopes.slice(1)) {
    const own = g.order.filter((l) => l.scope.id === sc.id);
    if (!own.length) continue;
    const a = own[0], b = own[own.length - 1];
    const x0 = g.colX.get(a.key) - half(a.key) + 5, x1 = g.colX.get(b.key) + half(b.key) - 5;
    const p = sc.sheet;
    const w = x1 - x0;
    const label = textW(p.title, 12, 700) + 30 <= w ? p.title : p.tab || p.title;
    const lvl = (g.hasCtx ? 1 : 0) + sc.depth - 1;
    const y = g.cardsTop - (g.levels - lvl) * C.grpH + 6;
    want.set('paper:' + sc.id, {
      cls: 'grp paper', x: x0, y, w, h: g.cardsTop - y + 4,
      html: `<span class="stk"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(label)}</span>`, title: `${p.title}（押すと閉じる）`, close: sc.id,
    });
  }
  for (const [k, el] of grpEls) if (!want.has(k)) { el.remove(); grpEls.delete(k); }
  for (const [k, v] of want) {
    let el = grpEls.get(k);
    if (!el) { el = document.createElement('div'); heads.prepend(el); grpEls.set(k, el); el.style.opacity = '0'; el.dataset.enter = '1'; }
    el.className = v.cls;
    if (el.dataset.html !== v.html) { el.innerHTML = v.html; el.dataset.html = v.html; }
    el.title = v.title;
    if (v.close) el.dataset.close = v.close; else delete el.dataset.close;
    if (v.node) el.dataset.node = v.node; else delete el.dataset.node;
    el.style.transform = `translate(${v.x}px, ${v.y}px)`;
    el.style.width = v.w + 'px';
    el.style.height = Math.max(24, v.h) + 'px';
    el._x = v.x; el._w = v.w;
    if (el.dataset.enter) el.style.opacity = String(fade);
  }
  stickTitles();
  const act = activeRow();
  const hot = new Set();
  if (act && act.type === 'step') { hot.add(lkey(act, 'from')); hot.add(lkey(act, 'to')); }
  for (const l of g.order) {
    const el = cardEls.get(l.key);
    const w = Math.max(0, g.colW.get(l.key) - 8);
    el.style.transform = `translate(${P(g.colX.get(l.key) - w / 2)}px, ${P(g.cardsTop)}px)`;
    el.style.width = P(w) + 'px';
    el.style.height = g.cardH + 'px';
    // a card that grows in shows its words only once its column is nearly as wide as it will be
    const full = G && G.colW.get(l.key);
    el.style.setProperty('--cin', g === G || !full ? '1' : P(clamp((g.colW.get(l.key) / full - 0.72) / 0.28, 0, 1)));
    if (el.dataset.enter) el.style.opacity = String(fade);
    el.classList.toggle('on', hot.has(l.key));
    el.classList.toggle('hl', state.hoverLife === l.key);
  }
}

// Titles of groups and paper frames slide along so they stay readable while their box is partly scrolled away.
function stickTitles() {
  const left = stage.scrollLeft + 10;
  for (const el of grpEls.values()) {
    const stk = el.firstElementChild;
    if (!stk || el._x == null) continue;
    const sh = clamp(left - el._x, 0, Math.max(0, el._w - stk.offsetWidth - 20));
    stk.style.transform = sh ? `translateX(${sh}px)` : '';
  }
  for (const t of svg.querySelectorAll('[data-x0]')) {
    const x0 = +t.dataset.x0, x1 = +t.dataset.x1, w = +t.dataset.w;
    const sh = clamp(left + 4 - x0, 0, Math.max(0, x1 - x0 - w - 16));
    t.setAttribute('transform', sh ? `translate(${sh} 0)` : '');
  }
}

// ---------------------------------------------------------------- the diagram
function diagramSvg(g, fade) {
  const rows = M.model.rows;
  const X0 = (k) => g.colX.get(k);
  const act = activeRow();
  let s = `<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--ctx-tint)"/><line x1="0" y1="0" x2="0" y2="7" stroke="var(--hatch)" stroke-width="2"/></pattern></defs>`;
  // context bands
  for (const run of g.runs) {
    const a = g.order[run.idx[0]], b = g.order[run.idx[run.idx.length - 1]];
    const x0 = X0(a.key) - g.colW.get(a.key) / 2 + 3, x1 = X0(b.key) + g.colW.get(b.key) / 2 - 3;
    s += `<rect class="ctxband${run.kernel ? ' kern' : ''}" x="${x0}" y="0" width="${P(x1 - x0)}" height="${P(g.bodyH)}"/>`;
    s += `<path class="ctxedge" d="M${x0},0V${g.bodyH}M${x1},0V${g.bodyH}"/>`;
  }
  // active and hovered row bands
  const band = (r, cls) => r && g.rowY.has(r.key) ? `<rect class="rowband ${cls}" x="0" y="${g.rowY.get(r.key) + 3}" width="${P(g.diagW)}" height="${P(g.rowH.get(r.key) - 6)}" rx="0"/>` : '';
  if (state.hoverRow && state.hoverRow !== activeKey()) s += band(rows.find((r) => r.key === state.hoverRow), 'hover');
  s += band(act, '');
  // open ref frames: tinted backgrounds first
  const fx = frameBoxes(g);
  for (const fb of fx) if (fb.fr.type === 'ref' && fb.fr.open) s += `<rect class="frame ref" x="${fb.x0}" y="${fb.y0}" width="${P(fb.x1 - fb.x0)}" height="${P(fb.y1 - fb.y0)}" rx="10" style="stroke:none"/>`;
  // lifelines
  for (const l of g.order) {
    const x = X0(l.key), n = NODES[l.node] || {};
    const color = lc(n.layer);
    const place = n.kind === 'store' || n.kind === 'hw';
    const hl = state.hoverLife === l.key;
    const w = hl ? 2.2 : 1.3;
    if (l.scope.depth) {
      const fb = fx.find((b) => b.fr.type === 'ref' && b.fr.open && b.fr.child.id === l.scope.id);
      if (fb) {
        s += `<line class="life ghost" x1="${x}" x2="${x}" y1="0" y2="${fb.y0}" stroke="${color}" stroke-width="${w}"/>`;
        s += `<line class="life${place ? ' store' : ''}" x1="${x}" x2="${x}" y1="${fb.y0}" y2="${fb.y1}" stroke="${color}" stroke-width="${w}" opacity="${hl ? 1 : 0.7}"/>`;
        s += `<line class="life ghost" x1="${x}" x2="${x}" y1="${fb.y1}" y2="${g.bodyH}" stroke="${color}" stroke-width="${w}"/>`;
        continue;
      }
    }
    s += `<line class="life${place ? ' store' : ''}" x1="${x}" x2="${x}" y1="0" y2="${g.bodyH}" stroke="${color}" stroke-width="${w}" opacity="${hl ? 1 : 0.62}"/>`;
  }
  // activation bars
  for (const b of M.bars) {
    const l = lifeOf(b.key);
    if (!l || !g.rowAy.has(b.r0.key) || !g.colX.has(b.key)) continue;
    const x = X0(b.key) + (b.off || 0) * 5, layer = NODES[l.node]?.layer;
    const y0 = g.rowAy.get(b.r0.key) - 11;
    const y1 = g.rowAy.has(b.r1.key) ? g.rowAy.get(b.r1.key) + 11 : g.rowY.get(b.r1.key) + g.rowH.get(b.r1.key) - 6;
    s += `<rect class="act" x="${P(x - 5)}" y="${P(y0)}" width="10" height="${P(y1 - y0)}" rx="2.5" fill="${lt(layer, 1)}" stroke="${lc(layer)}"/>`;
  }
  // frames: edges, tags, guards, separators
  for (const fb of fx) s += frameSvg(g, fb);
  // messages
  for (const r of rows) if (r.type === 'step') s += messageSvg(g, r);
  // folded outer steps: a pill per step under the paper that draws it
  for (const r of rows) if (r.type === 'fold') s += foldSvg(g, r);
  // closed refs on top
  for (const fb of fx) if (fb.fr.type === 'ref' && !fb.fr.open) s += closedRefSvg(g, fb);
  // the end of the flow
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const y = g.rowY.get(lastRow.key) + g.rowH.get(lastRow.key) + 22;
    s += `<text class="endcap" x="${g.diagW / 2}" y="${y}" text-anchor="middle">ここまで</text>`;
  }
  s += `<g id="tokenLayer"></g>`;
  return s;
}
const P = (v) => Math.max(0, Number(v) || 0).toFixed(2);
const clipText = (t, w, size) => { if (textW(t, size) <= w) return t; let s = t; while (s.length > 1 && textW(s + '…', size) > w) s = s.slice(0, -1); return s + '…'; };

function frameBoxes(g) {
  const out = [];
  for (const fr of M.model.frames) {
    const sp = M.spans.get(fr);
    if (!sp || !isFinite(sp.lo)) continue;
    const a = g.order[sp.lo], b = g.order[sp.hi];
    if (!a || !b) continue;
    const r0 = M.model.rows[fr.r0], r1 = M.model.rows[fr.r1];
    if (!g.rowY.has(r0.key) || !g.rowY.has(r1.key)) continue;
    const depth = fr.depth;
    let x0, x1, y0, y1;
    const cap0 = g.rowCap ? g.rowCap.get(r0.key) || 0 : 0;
    if (fr.type === 'ref' && !fr.open) {
      const w = Math.max(76, Math.min(g.colW.get(a.key) - 8, 120));
      x0 = g.colX.get(a.key) - w / 2; x1 = x0 + w;
      y0 = g.rowY.get(r0.key) + cap0 + 9; y1 = g.rowY.get(r0.key) + g.rowH.get(r0.key) - 9;
    } else {
      const pad = Math.max(12, 30 - depth * 7);
      x0 = g.colX.get(a.key) - Math.min(g.colW.get(a.key) / 2 - 4, pad + 14);
      x1 = g.colX.get(b.key) + Math.min(g.colW.get(b.key) / 2 - 4, pad + 14);
      x0 += depth * 0; x1 -= 0;
      y0 = g.rowY.get(r0.key) + cap0 + 6; y1 = g.rowY.get(r1.key) + g.rowH.get(r1.key) - 6;
      const tagW = tagWidth(fr);
      const need = tagW + 14 + guardWidth(fr);
      if (x1 - x0 < need) x1 = Math.min(g.diagW - 4, x0 + need);
    }
    out.push({ fr, x0, x1, y0, y1 });
  }
  // a parent frame holds its children with a margin
  const byFr = new Map(out.map((b) => [b.fr, b]));
  const grow = (b) => {
    for (const c of b.fr.children || []) {
      const cb = byFr.get(c);
      if (!cb) continue;
      grow(cb);
      b.x0 = Math.min(b.x0, cb.x0 - 8);
      b.x1 = Math.max(b.x1, cb.x1 + 8);
    }
  };
  for (const b of out) if (!b.fr.parent) grow(b);
  return out;
}
const TAG = { ref: '中の紙', alt: 'もし', branch: '分かれ道', opt: 'もし' };
const tagText = (fr) => (fr.type === 'ref' ? TAG.ref : TAG[fr.sub] || 'もし');
const tagWidth = (fr) => textW(tagText(fr), 11.5, 700) + 18;
function guardWidth(fr) {
  const rows = M.model.rows;
  let w = 0;
  for (let i = fr.r0; i <= fr.r1; i++) {
    const r = rows[i];
    if (r.frame !== fr) continue;
    if (r.type === 'ftop' && r.guard) w = Math.max(w, textW(`[${r.guard}]`, 12, 600) + 10);
    if (r.type === 'operand') w = Math.max(w, textW(`[${r.guard}]`, 12, 600) - tagWidth(fr));
    if (r.type === 'ftop' && fr.type === 'ref') w = Math.max(w, textW(fr.paper.title, 12.5, 700) + 16);
  }
  return w;
}

function frameSvg(g, fb) {
  const { fr, x0, x1, y0, y1 } = fb;
  if (fr.type === 'ref' && !fr.open) return '';
  const rows = M.model.rows;
  const ref = fr.type === 'ref';
  const tw = tagWidth(fr), th = 19;
  const top = rows[fr.r0];
  let s = `<g class="fr" data-frame="${esc(fr.id)}">`;
  s += `<rect class="frame${ref ? ' ref' : ''}" x="${x0}" y="${y0}" width="${P(x1 - x0)}" height="${P(y1 - y0)}" rx="${ref ? 10 : 6}" ${ref ? 'fill="none"' : ''}/>`;
  // an alt's tag and guard slide along, like the paper titles, while the frame's left edge is scrolled away
  const gw = !ref && top.guard && !g.cp ? textW(`[${top.guard}]`, 12, 600) + 8 : 0;
  if (!ref) s += `<g data-x0="${P(x0)}" data-x1="${P(x1)}" data-w="${P(tw + gw)}">`;
  s += `<path class="ftag${ref ? ' ref' : ''}" d="M${x0 + (ref ? 0 : 0)},${y0 + (ref ? 10 : 6)}${ref ? `a10,10 0 0 1 10,-10` : `a6,6 0 0 1 6,-6`}H${x0 + tw}v${th - 7}l-7,7H${x0}Z"${ref ? ` data-close="${esc(fr.id)}" style="cursor:pointer"` : ''}/>`;
  s += `<text class="ftag-t${ref ? ' ref' : ''}" x="${x0 + 8}" y="${y0 + 13.5}"${ref ? ` data-close="${esc(fr.id)}" style="cursor:pointer"` : ''}>${esc(tagText(fr))}</text>`;
  if (ref) {
    const ttw = textW(fr.paper.title, 12.5, 700);
    s += `<text class="ptitle-t" x="${x0 + tw + 9}" y="${y0 + 14}" data-close="${esc(fr.id)}" data-x0="${x0 + tw}" data-x1="${x1}" data-w="${ttw}" style="cursor:pointer">${esc(fr.paper.title)}</text>`;
    const ek = M.L.keyOf(fr.child, fr.paper.entry);
    if (ek && g.colX.has(ek)) {
      const ex = g.colX.get(ek), ey = y0 + 24;
      s += `<g class="entrymark"><rect x="${ex - 17}" y="${ey}" width="34" height="17" rx="8.5"/><text x="${ex}" y="${ey + 12.5}" text-anchor="middle">入口</text><path d="M${ex - 4},${ey + 19}L${ex},${ey + 24}L${ex + 4},${ey + 19}"/></g>`;
    }
  }
  else if (top.guard && !g.cp) s += `<text class="guard-t" x="${x0 + tw + 8}" y="${y0 + 14}">[${esc(top.guard)}]</text>`;
  if (!ref) s += `</g>`;
  for (let i = fr.r0 + 1; i < fr.r1; i++) {
    const r = rows[i];
    if (r.type !== 'operand' || r.frame !== fr) continue;
    const y = g.rowY.get(r.key) + (g.rowCap ? g.rowCap.get(r.key) || 0 : 0) + 4;
    s += `<line class="sep" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/>`;
    if (g.cp) continue;
    s += `<text class="guard-t" x="${x0 + 9}" y="${y + 17}" data-x0="${P(x0)}" data-x1="${P(x1)}" data-w="${P(textW(`[${r.guard}]`, 12, 600) + 4)}">[${esc(r.guard)}]</text>`;
    // a branch not taken has no arrow here: its outcome stands in the operand instead
    if (fr.sub === 'branch' && r.outcome) {
      const gw = textW(`[${r.guard}]`, 12, 600);
      const out = '→ ' + plainText(X, r.outcome);
      const room = x1 - x0 - gw - 30;
      const one = textW(out, 11.5, 400) <= room;
      s += `<text class="out-t" x="${P(one ? x0 + 9 + gw + 10 : x0 + 9)}" y="${P(one ? y + 17 : y + 34)}">${esc(one ? out : clipText(out, x1 - x0 - 20, 11.5))}</text>`;
    }
  }
  return s + `</g>`;
}

// Under an open paper, hanging off its box's lifeline: each outer step it folded, as 「⑤ 並べる ＝ 紙の 8」.
function foldSvg(g, r) {
  if (!g.rowY.has(r.key)) return '';
  const y = g.rowY.get(r.key) + (g.rowCap.get(r.key) || 0) + (g.cp ? 16 : g.rowH.get(r.key) / 2);
  const boxKey = M.L.keyOf(r.scope, r.refFrame.boxId);
  if (!g.colX.has(boxKey)) return '';
  let s = `<g class="fold" data-row="${esc(r.key)}">`;
  const pills = r.ghosts.map((gh) => {
    const verb = gh.st.verb || '';
    const inner = gh.ks.map((k) => stepBadge(X, r.child.sheet, k));
    const vw = verb ? textW(verb, 12, 600) + 6 : 0;
    return { gh, verb, inner, vw, W: 22 + vw + textW('＝ 紙の', 11.5, 400) + 10 + inner.length * 23 + 8 };
  });
  const total = pills.reduce((t, p) => t + p.W + 8, -8);
  let x = clamp(g.colX.get(boxKey) + 12, 4, g.diagW - total - 4);
  s += `<path class="fold-tie" d="M${P(g.colX.get(boxKey))},${P(y)}H${P(x)}"/>`;
  for (const { gh, verb, inner, vw, W } of pills) {
    const x0 = x;
    x += W + 8;
    s += `<g class="gpill" data-goto="${esc(gh.keys[0])}"><rect class="gbg" x="${P(x0)}" y="${P(y - 13)}" width="${P(W)}" height="26" rx="13"/>`;
    s += `<circle class="gbd${gh.st.alt ? ' alt' : ''}" cx="${P(x0 + 13)}" cy="${P(y)}" r="9.5"/><text class="gbn" x="${P(x0 + 13)}" y="${P(y + 4)}" text-anchor="middle">${esc(stepBadge(X, r.sheet, gh.i))}</text>`;
    let cx = x0 + 27;
    if (verb) { s += `<text class="gvb" x="${P(cx)}" y="${P(y + 4.2)}">${esc(verb)}</text>`; cx += vw; }
    s += `<text class="geq" x="${P(cx)}" y="${P(y + 4)}">＝ 紙の</text>`;
    cx += textW('＝ 紙の', 11.5, 400) + 6;
    for (const t of inner) { s += `<rect class="bd inner" x="${P(cx)}" y="${P(y - 9.5)}" width="19" height="19" rx="5"/><text class="bn inner" x="${P(cx + 9.5)}" y="${P(y + 4)}" text-anchor="middle">${esc(t)}</text>`; cx += 23; }
    s += `</g>`;
  }
  return s + `</g>`;
}

function closedRefSvg(g, fb) {
  const { fr, x0, x1, y0, y1 } = fb;
  const p = fr.paper, n = p.steps.filter((s) => !s.alt).length;
  const on = activeKey() === M.model.rows[fr.r0].key;
  const cx = (x0 + x1) / 2;
  const tw = tagWidth(fr) - 4;
  return `<g class="cref" data-open="${esc(fr.id)}" style="cursor:pointer"><rect class="frame ref closed" x="${x0}" y="${y0}" width="${P(x1 - x0)}" height="${P(y1 - y0)}" rx="8"${on ? ' style="fill:var(--accent-soft)"' : ''}/>`
    + `<path class="ftag ref" d="M${x0},${y0 + 8}a8,8 0 0 1 8,-8H${x0 + tw}v12l-6,6H${x0}Z"/><text class="ftag-t ref" x="${x0 + 7}" y="${y0 + 13}" style="font-size:11px">${esc(TAG.ref)}</text>`
    + `<text class="ref-t" x="${cx}" y="${y0 + 35}" text-anchor="middle">＋ 開く</text><text class="ref-s" x="${cx}" y="${y0 + 49}" text-anchor="middle">${n} 手順</text></g>`;
}
function messageSvg(g, r) {
  const st = r.st, a = lkey(r, 'from'), b = lkey(r, 'to');
  if (!g.colX.has(a) || !g.colX.has(b) || !g.rowAy.has(r.key)) return '';
  const y = g.rowAy.get(r.key);
  const xa = g.colX.get(a), xb = g.colX.get(b);
  const on = r.key === activeKey();
  const dim = state.hoverLife && a !== state.hoverLife && b !== state.hoverLife;
  const cls = `msg k-${st.kind}${on ? ' on' : ''}${dim ? ' dim' : ''}${state.hoverRow === r.key ? ' hv' : ''}`;
  let s = `<g class="${cls}" data-row="${esc(r.key)}">`;
  if (a === b) {
    const x = xa + 5;
    s += `<path class="ln" d="M${x},${y - 6}h34v18h-30"/><path class="hd open" d="M${x + 9},${y + 7}L${x},${y + 12}L${x + 9},${y + 17}"/>`;
  } else {
    const dir = xb > xa ? 1 : -1;
    const ba = barAt(a, r), bb = barAt(b, r);
    const ea = xa + (ba ? ba.off * 5 + dir * 5 : dir * 0.5), eb = xb + (bb ? bb.off * 5 - dir * 5 : -dir * 0.5);
    s += arrowSvg(st.kind, ea, eb, y);
  }
  // label: badge, verb, data
  const badge = stepBadge(X, r.sheet, r.i);
  const inner = isInner(r);
  const { verb, d, chipPlain, vw, cw, bw, W, lx0 } = msgLabel(g, r, xa, xb);
  const ly = y - 15;
  s += `<rect class="lbg" x="${lx0 - 4}" y="${ly - 12}" width="${P(W + 8)}" height="24" rx="7"/>`;
  const bcx = lx0 + 11;
  if (inner) s += `<rect class="bd inner${st.alt ? ' alt' : ''}" x="${bcx - 10}" y="${ly - 10}" width="20" height="20" rx="5.5"/>`;
  else s += `<circle class="bd${st.alt ? ' alt' : ''}" cx="${bcx}" cy="${ly}" r="10"/>`;
  s += `<text class="bn${inner ? ' inner' : ''}" x="${bcx}" y="${ly + 4}" text-anchor="middle">${esc(badge)}</text>`;
  let cx = lx0 + bw + 6;
  if (verb) { s += `<text class="vb" x="${cx}" y="${ly + 4.5}">${esc(verb)}</text>`; cx += vw + 8; }
  if (d) {
    s += `<rect class="chipr${chipPlain ? ' plain' : ''}" x="${cx}" y="${ly - 9.5}" width="${cw}" height="19" rx="5"/>`;
    if (!chipPlain) s += `<path class="chipi" d="M${cx + 6},${ly - 4.5}h10v9h-10z M${cx + 6},${ly - 1.5}h10 M${cx + 10},${ly - 1.5}v6"/>`;
    s += `<text class="chipt${chipPlain ? ' plain' : ''}" x="${cx + (chipPlain ? 6 : 21)}" y="${ly + 4}">${esc(d.label)}</text>`;
  }
  // hit area
  const hx0 = Math.min(xa, xb, lx0) - 6, hx1 = Math.max(xa, xb, lx0 + W) + 6;
  s += `<rect class="hit" x="${hx0}" y="${ly - 14}" width="${P(hx1 - hx0)}" height="${P(y - ly + 24)}"/>`;
  return s + `</g>`;
}
// Where an arrow's label goes: badge, verb and data chip, centred over the arrow.
function msgLabel(g, r, xa, xb) {
  const st = r.st, verb = st.verb || '', d = st.data;
  const chipPlain = d && (d.chip === false || !d.schema);
  const vw = verb ? textW(verb, 13, 600) : 0;
  const cw = d ? textW(d.label, 11.5, chipPlain ? 400 : 600, true) + (chipPlain ? 12 : 26) : 0;
  const bw = 22;
  const W = bw + (verb ? 6 + vw : 0) + (d ? 8 + cw : 0);
  const lx0 = clamp((xa + xb) / 2 - W / 2, 4, g.diagW - W - 4);
  return { verb, d, chipPlain, vw, cw, bw, W, lx0 };
}

// The innermost bar of a lifeline that covers a row.
function barAt(key, r) {
  const list = M.barsBy.get(key);
  let best = null;
  if (list) for (const b of list) if (b.r0.index <= r.index && r.index <= b.r1.index && (!best || b.off > best.off)) best = b;
  return best;
}

// ---------------------------------------------------------------- the time head (top right)
function timeHead() {
  if (!T) { cornerR.innerHTML = ''; return; }
  const occN = M.occs.length;
  const tr = T.tr;
  const segs = T.segs.map((sg) => `<rect x="${(sg.from / T.maxInstr) * 120}" y="0" width="${Math.max(0.6, ((sg.to - sg.from) / T.maxInstr) * 120)}" height="10" fill="${thColor(sg.thread)}"/>`).join('');
  const mapped = [...M.times.values()].filter((t) => !t.why);
  let win = '';
  if (mapped.length) {
    const lo = Math.min(...mapped.map((t) => t.instr)), hi = Math.max(...mapped.map((t) => t.instr));
    const x0 = (lo / T.maxInstr) * 120, x1 = (hi / T.maxInstr) * 120;
    win = `<rect x="${x0 - 1.5}" y="-3" width="${Math.max(3, x1 - x0 + 3)}" height="16" rx="2" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`
      + `<line id="playhead" x1="0" x2="0" y1="-3" y2="13" stroke="var(--text)" stroke-width="1.6" visibility="${rec.on ? 'visible' : 'hidden'}"/>`;
  }
  const ticks = M.occs.map((idx, k) => `<line x1="${(T.events[idx].instr / T.maxInstr) * 120}" x2="${(T.events[idx].instr / T.maxInstr) * 120}" y1="13" y2="17" stroke="${k === M.occI ? 'var(--accent)' : 'var(--text-3)'}" stroke-width="1.2"/>`).join('');
  const narrow = C.timeW < 144;
  cornerR.innerHTML = `<div class="cin" style="width:${C.timeW}px"><p class="tt" title="記録の時間（命令数）">${narrow ? '記録の時間' : '記録の時間（命令数）'}</p><p class="tt2">${phrases(tr.title)}</p>`
    + (occN > 1 ? `<div class="occ"><button type="button" data-occ="-1" aria-label="前の回"${M.occI === 0 ? ' disabled' : ''}>‹</button><span class="n">${M.occI + 1} / ${occN} 回目</span><button type="button" data-occ="1" aria-label="次の回"${M.occI === occN - 1 ? ' disabled' : ''}>›</button></div>` : occN ? '' : `<p class="tt2">この流れの手順は記録に出てこない</p>`)
    + `<svg class="overview" width="122" height="18" viewBox="-1 -3 122 21" aria-label="記録の全体。色は走っていたスレッド"><title>記録の全体（${fmt(T.maxInstr)} 命令）。色は走っていたスレッド、枠はこの回。押すと近い回へ</title>${segs}${win}${ticks}</svg>`
    + (rec.on ? `<div class="recnow" id="recNow">${recHtml()}</div>` : `<div class="th-key"><span style="--th:var(--th-app)"><i></i>続けて入った</span><span style="--th:var(--th-app)"><i class="target"></i>入っただけ</span><span class="lg" style="--th:var(--th-app)" title="前の時刻からの差。棒の長さは対数"><b></b>${narrow ? '差（対数）' : '前からの差（対数）'}</span></div>`)
    + `</div>`;
  const rb = document.getElementById('recBtn');
  if (rb) { rb.setAttribute('aria-pressed', String(rec.on)); rb.disabled = mapped.length < 2; rb.querySelector('.t').textContent = rec.on ? '止める' : '記録で流す'; }
}

// ---------------------------------------------------------------- active row, stepping
const activeKey = () => state.active.get(state.flow) || null;
const activeRow = () => M && M.model.rows.find((r) => r.key === activeKey());
function stops() { return M.model.rows.filter((r) => r.type === 'step' || r.type === 'ref'); }

function setActive(key, opts = {}) {
  if (!key || !M) return;
  if (!M.model.rows.some((r) => r.key === key && (r.type === 'step' || r.type === 'ref'))) return;
  state.active.set(state.flow, key);
  if (!G) return;
  refreshMarks();
  const r = activeRow();
  if (!r) return;
  if (opts.scroll !== false) scrollToRow(r, opts.smooth !== false);
  if (r.type === 'step' && opts.token !== false) runToken(r);
  announce(r);
  if (state.insp) renderInspector();
  writeHash();
}
// cheap refresh of the active marks without rebuilding the model
function refreshMarks() {
  draw(shown || G, 1);
}

function step(d) {
  const list = stops();
  const i = list.findIndex((r) => r.key === activeKey());
  const j = clamp(i < 0 ? 0 : i + d, 0, list.length - 1);
  setActive(list[j].key);
}

function scrollToRow(r, smooth) {
  const g = G;
  const y = g.rowY.get(r.key), h = g.rowH.get(r.key);
  if (y == null) return;
  const viewTop = stage.scrollTop + g.headH;
  const inspH = state.insp ? Math.max(insp.offsetHeight, inspMax()) + 12 : 0;
  const viewBot = stage.scrollTop + stage.clientHeight - inspH;
  const top = g.headH + y, bot = top + h;
  let target = null;
  if (top < viewTop + 8 || bot > viewBot - 8) target = top - g.headH - Math.max(40, (stage.clientHeight - inspH - g.headH) * 0.28);
  let left = null;
  if (r.type === 'step') {
    const xa = g.colX.get(lkey(r, 'from')), xb = g.colX.get(lkey(r, 'to'));
    const lo = Math.min(xa, xb) - 60, hi = Math.max(xa, xb) + 60;
    const visL = stage.scrollLeft, visR = stage.scrollLeft + stage.clientWidth - g.narrW - g.timeW;
    if (lo < visL || hi > visR) left = hi - lo < visR - visL ? lo - ((visR - visL) - (hi - lo)) / 2 : lo;
  } else if (r.type === 'ref') {
    const xa = g.colX.get(M.L.keyOf(r.frame.scope, r.frame.boxId));
    const visL = stage.scrollLeft, visR = stage.scrollLeft + stage.clientWidth - g.narrW - g.timeW;
    if (xa - 80 < visL || xa + 80 > visR) left = xa - (visR - visL) / 3;
  }
  if (target == null && left == null) return;
  progScroll({ top: target == null ? stage.scrollTop : Math.max(0, target), left: left == null ? stage.scrollLeft : Math.max(0, left), behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
}

let tokenRun = 0;
function runToken(r) {
  if (reduceMotion()) return;
  const run = ++tokenRun;
  const g = G;
  const a = lkey(r, 'from'), b = lkey(r, 'to');
  const xa = g.colX.get(a), xb = g.colX.get(b), y = g.rowAy.get(r.key);
  if (xa == null || xb == null || y == null || a === b) return;
  const t0 = performance.now(), dur = clamp(Math.abs(xb - xa) * 1.1, 380, 900);
  const tick = (now) => {
    if (run !== tokenRun) return;
    const layer = document.getElementById('tokenLayer');
    if (!layer) return;
    const t = clamp((now - t0) / dur, 0, 1);
    const x = lerp(xa, xb, ease(t));
    const shape = r.st.kind === 'data' ? `<rect class="token" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2.5"/>` : `<circle class="token" cx="${x}" cy="${y}" r="5.5"/>`;
    layer.innerHTML = t < 1 ? shape : '';
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function announce(r) {
  const live = $('#live');
  if (r.type === 'step') live.textContent = `${stepNo(X, r.sheet, r.i)}：${r.st.label}`;
  else if (r.type === 'ref') live.textContent = `中の紙：${r.frame.paper.title}。Enter で開く`;
}

// ---------------------------------------------------------------- rebuild with a tween
let tweenId = 0;
function rebuild(opts = {}) {
  const before = shown;
  const beforeModel = M;
  const id = ++tweenId;
  M = build();
  renderTabs();
  timeHead();
  buildDom();
  fillCards(layout());
  G = layout();
  fillCards(G);
  // keep the selection on a step or a paper: a folded step hands it to the paper step that draws it
  const isStop = (r) => r.type === 'step' || r.type === 'ref';
  let a = activeKey();
  if (a && M.model.folds.has(a)) a = M.model.folds.get(a);
  if (!a || !M.model.rows.some((r) => r.key === a && isStop(r))) {
    const i = opts.activeFallback ? M.model.rows.findIndex((r) => r.key === opts.activeFallback) : -1;
    const at = i >= 0 ? M.model.rows.slice(i).find(isStop) : null;
    a = (at || stops()[0])?.key || null;
  }
  if (a) state.active.set(state.flow, a);
  const animate = opts.animate && before && beforeModel && beforeModel.flow === M.flow && !reduceMotion();
  if (!animate) {
    shown = G;
    draw(G, 1);
    clearEnter();
    return Promise.resolve();
  }
  const from = startGeometry(before, G, opts.origin);
  const t0 = performance.now(), dur = window.__seqTweenMs || 520;
  const sl0 = stage.scrollLeft, sl1 = opts.scrollLeft;
  const st0 = stage.scrollTop, st1 = opts.scrollTop;
  return new Promise((done) => {
    const frame = (now) => {
      if (id !== tweenId) return done();
      const t = clamp((now - t0) / dur, 0, 1), k = ease(t);
      shown = mix(from, G, k);
      draw(shown, clamp((k - 0.55) / 0.45, 0, 1));
      if (sl1 != null || st1 != null) progUntil = performance.now() + 200;
      if (sl1 != null) stage.scrollLeft = lerp(sl0, sl1, k);
      if (st1 != null) stage.scrollTop = lerp(st0, st1, k);
      if (t < 1) requestAnimationFrame(frame);
      else { shown = G; draw(G, 1); clearEnter(); done(); }
    };
    requestAnimationFrame(frame);
  });
}
function clearEnter() {
  for (const el of [...cellEls.values(), ...timeEls.values(), ...cardEls.values(), ...grpEls.values()]) { if (el.dataset.enter) { delete el.dataset.enter; el.style.opacity = ''; } }
}
// Where new things start: a paper's lifelines grow out of its box; its rows unfold from the ref row.
function startGeometry(old, next, origin) {
  const g = { ...next, colX: new Map(), colW: new Map(), rowY: new Map(), rowH: new Map(), rowAy: new Map(), rowCap: new Map(next.rowCap) };
  for (const l of next.order) {
    if (old.colX.has(l.key)) { g.colX.set(l.key, old.colX.get(l.key)); g.colW.set(l.key, old.colW.get(l.key)); continue; }
    let pk = null;
    for (let sc = l.scope; sc && sc.parent; sc = sc.parent) { const k = M.L.keyOf(sc.parent, sc.boxId); if (old.colX.has(k)) { pk = k; break; } }
    g.colX.set(l.key, pk ? old.colX.get(pk) : next.colX.get(l.key));
    g.colW.set(l.key, 0);
  }
  let lastY = 10;
  const originY = origin && old.rowY.has(origin) ? old.rowY.get(origin) : null;
  for (const r of M.model.rows) {
    if (old.rowY.has(r.key)) {
      g.rowY.set(r.key, old.rowY.get(r.key)); g.rowH.set(r.key, old.rowH.get(r.key));
      if (r.type === 'step') g.rowAy.set(r.key, old.rowAy.get(r.key) ?? old.rowY.get(r.key) + C.arrowDy);
      lastY = old.rowY.get(r.key) + old.rowH.get(r.key);
    } else {
      const y = originY != null ? originY : lastY;
      g.rowY.set(r.key, y); g.rowH.set(r.key, 0);
      if (r.type === 'step') g.rowAy.set(r.key, y);
    }
  }
  g.bodyH = old.bodyH; g.diagW = Math.max(old.diagW, 0); g.headH = old.headH; g.cardsTop = old.cardsTop;
  return g;
}
function mix(a, b, k) {
  const m = (ma, mb) => { const o = new Map(); for (const [key, v] of mb) o.set(key, lerp(ma.has(key) ? ma.get(key) : v, v, k)); return o; };
  return { ...b, colX: m(a.colX, b.colX), colW: m(a.colW, b.colW), rowY: m(a.rowY, b.rowY), rowH: m(a.rowH, b.rowH), rowAy: m(a.rowAy, b.rowAy),
    bodyH: lerp(a.bodyH, b.bodyH, k), diagW: lerp(a.diagW, b.diagW, k), headH: Math.round(lerp(a.headH, b.headH, k)), cardsTop: lerp(a.cardsTop, b.cardsTop, k) };
}

// ---------------------------------------------------------------- open and close papers
async function openRef(id, focusInside = true) {
  const flow = state.flow, set = openSet();
  if (set.has(id) || !M.model.frames.some((f) => f.id === id)) return;
  const refRowKey = id + ':ref';
  const oldTop = G ? G.headH : 0, oldY = G ? G.rowY.get(refRowKey) : null;
  // one paper at a time (unless they were all opened together): the others close, the papers this one sits in stay
  if (!state.allOpen.get(flow)) for (const k of [...set]) if (!id.startsWith(k + '/')) set.delete(k);
  set.add(id);
  // scroll so the paper's box sits near the left of the visible diagram, and its top stays where the ref was
  const prev = M;
  const boxKey = (() => { const fr = prev.model.frames.find((f) => f.id === id); return fr ? prev.L.keyOf(fr.scope, fr.boxId) : null; })();
  const nextM = build();
  const tmpLayout = (() => { const keep = M; M = nextM; buildDom(); const g = layout(); M = keep; return g; })();
  let scrollLeft = null;
  if (boxKey && tmpLayout.colX.has(boxKey)) {
    const own = nextM.L.order.filter((l) => l.scope.id === id);
    const xs = [tmpLayout.colX.get(boxKey), ...own.map((l) => tmpLayout.colX.get(l.key))];
    const lo = Math.min(...xs) - 90, hi = Math.max(...xs) + 90;
    const vis = stage.clientWidth - tmpLayout.narrW - tmpLayout.timeW;
    if (lo < stage.scrollLeft || hi > stage.scrollLeft + vis) scrollLeft = Math.max(0, hi - lo < vis ? lo - (vis - (hi - lo)) / 2 : lo);
  }
  const newY = tmpLayout.rowY.get(id + ':top');
  const scrollTop = Math.max(0, stage.scrollTop + (tmpLayout.headH - oldTop) + (oldY != null && newY != null ? newY - oldY : 0));
  await rebuild({ animate: true, origin: refRowKey, scrollLeft, scrollTop, activeFallback: id + ':top' });
  if (state.flow !== flow || !openSet().has(id)) return;
  if (focusInside) {
    const first = M.model.rows.find((r) => r.type === 'step' && r.scope.id === id);
    if (first) setActive(first.key, { smooth: true });
  }
  writeHash();
}
async function closeRef(id) {
  const flow = state.flow, set = openSet();
  if (!set.has(id)) return;
  const a = activeKey();
  const inside = a && (a.startsWith(id + '#') || a.startsWith(id + '/') || a.startsWith(id + '@') || a.startsWith(id + '~') || a.startsWith(id + ':'));
  // a paper step that drew a folded outer step hands the selection back to that step
  const back = inside ? [...M.model.folds].find(([, inner]) => inner === a)?.[0] : null;
  for (const k of [...set]) if (k === id || k.startsWith(id + '/')) set.delete(k);
  const target = back || id + ':ref';
  if (inside) state.active.set(state.flow, target);
  await rebuild({ animate: true });
  if (state.flow !== flow) return;
  if (inside) setActive(target, { token: false });
  writeHash();
}
async function toggleAll() {
  const flow = state.flow, f = currentFlow(), all = allRefIds(X, f), set = openSet();
  const closing = all.every((id) => set.has(id));
  if (closing) set.clear();
  else for (const id of all) set.add(id);
  state.allOpen.set(flow, !closing);
  await rebuild({ animate: true });
  if (state.flow !== flow) return;
  const r = activeRow();
  if (r) scrollToRow(r, true);
  writeHash();
}

// ---------------------------------------------------------------- inspector
function linkHtml(id) {
  const n = NODES[id];
  return n ? `<a class="nl" data-node="${esc(id)}">${esc(n.title)}</a>` : esc(id);
}
function richText(s) {
  return textParts(s).map((p) => {
    if (p.t === 'text') return esc(p.s).replace(/\n/g, '<br>');
    if (p.t === 'embed') { const n = NODES[p.id]; return n && n.figure ? `<span class="fig" role="img">${n.figure}</span>` : linkHtml(p.id); }
    return linkHtml(p.id);
  }).join('');
}
function whoChip(nodeId, title) {
  const n = NODES[nodeId] || {};
  return `<span class="who" style="--lc:${lc(n.layer)}"><i></i>${esc(title || n.title || nodeId)}</span>`;
}
function structHtml(schemaId, hot) {
  const n = NODES[schemaId];
  if (!n || !n.fields) return '';
  const on = new Set((hot || []).map((f) => f.replace(/^\*/, '').trim()));
  const isHot = (name) => on.has(name.replace(/^\*/, '').trim()) || on.has(name);
  return `<div class="struct"><div>${n.kind === 'hw' ? 'register' : 'struct'} ${linkHtml(schemaId)} {</div>${n.fields.map(([ty, name, d]) => `<div class="f${isHot(name) ? ' hot' : ''}">&nbsp;&nbsp;<span class="ty">${esc(ty)}</span> ${esc(name)};${d ? `<span class="d">${esc(d)}</span>` : ''}</div>`).join('')}<div>}</div></div>`;
}
const inspMax = () => Math.min(window.innerHeight * 0.42, 380);
const srcCache = new Map();
async function fetchSrc(path) {
  if (!srcCache.has(path)) srcCache.set(path, fetch('../data/src/' + path).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  return srcCache.get(path);
}
async function codeHtml(path, from, to, hot) {
  const text = await fetchSrc(path);
  if (!text) return `<p class="hint">ソースを読めなかった：${esc(path)}</p>`;
  const lines = text.split('\n');
  const a = clamp(from, 1, lines.length), b = clamp(to, a, lines.length);
  let s = `<div class="code">`;
  for (let i = a; i <= b; i++) s += `<div class="ln${hot && hot.includes(i) ? ' hot' : ''}"><span class="no">${i}</span><span>${highlight(lines[i - 1])}</span></div>`;
  return s + `</div>`;
}
function stepCodeRef(r) {
  const at = X.CODE.steps?.[r.scope.sheetKey]?.[String(r.i)];
  const toNode = nodeOfRow(r, 'to');
  if (at) return { path: at.path, from: at.line - 3, to: at.line + 4, hot: [at.line], line: at.line, how: '手順の行' };
  const def = X.CODE.nodes?.[toNode];
  if (def && def.start) return { path: def.path, from: def.start, to: Math.min(def.end, def.start + 9), hot: [def.start], line: def.start, how: `行き先 ${NODES[toNode]?.title} の定義` };
  const fromNode = nodeOfRow(r, 'from'), d2 = X.CODE.nodes?.[fromNode];
  if (d2 && d2.start) return { path: d2.path, from: d2.start, to: Math.min(d2.end, d2.start + 9), hot: [d2.start], line: d2.start, how: `出どころ ${NODES[fromNode]?.title} の定義` };
  return null;
}

async function renderInspector() {
  insp.hidden = !state.insp;
  if (!state.insp) return;
  const body = $('#inspBody'), head = $('#inspTitle');
  if (state.inspNode) return renderNodeInspector(state.inspNode);
  const r = activeRow();
  if (!r) return;
  if (r.type === 'ref') {
    const p = r.frame.paper, n = NODES[r.frame.paper.id] || NODES[boxOf(r.frame.scope.sheet, r.frame.boxId).node];
    head.innerHTML = `<span class="badge-i">中の紙</span>${esc(p.title)}`;
    body.innerHTML = `<section><h4>この紙について</h4><p>${richText((NODES[boxOf(r.frame.scope.sheet, r.frame.boxId).node] || {}).text || '')}</p><p class="hint">Enter またはボタンで、この場に開く。紙の箱は、外の線の右に並ぶ。</p></section>`
      + `<section><h4>手順</h4><ol class="plist">${p.steps.map((st, i) => `<li>${esc(stepNo(X, p, i))}　${esc(st.label)}</li>`).join('')}</ol></section><section><h4>コード</h4><div id="codeSlot"></div></section>`;
    const node = boxOf(r.frame.scope.sheet, r.frame.boxId).node, def = X.CODE.nodes?.[node];
    if (def && def.start) $('#codeSlot').innerHTML = `<div class="path">${esc(def.path)}:${def.start}</div>` + await codeHtml(def.path, def.start, Math.min(def.end, def.start + 18), [def.start]);
    return;
  }
  if (r.type !== 'step') return;
  const st = r.st, sheet = r.sheet;
  const fromN = nodeOfRow(r, 'from'), toN = nodeOfRow(r, 'to');
  const fromL = lifeOf(lkey(r, 'from')), toL = lifeOf(lkey(r, 'to'));
  const where = r.scope.depth ? `<span class="where">${esc(r.scope.sheet.title)}</span>` : '';
  head.innerHTML = `<span class="badge-i${st.alt ? ' alt' : isInner(r) ? ' inner' : ''}">${esc(stepBadge(X, sheet, r.i))}</span>${esc(st.verb || KIND_LABEL[st.kind] || '')}${where}`;
  let a = `<div class="route">${whoChip(fromN, cardTitle(fromL))}<svg width="46" height="14" viewBox="0 0 46 14" aria-hidden="true"><g class="msg k-${st.kind}">${arrowSvg(st.kind, 4, 42, 7)}</g></svg>${whoChip(toN, cardTitle(toL))}<span class="kindline">${esc(KIND_LABEL[st.kind] || st.kind)}</span></div>`;
  a += `<p>${esc(st.label)}</p>`;
  if (st.alt) a += `<p class="hint">もし${esc(st.alt.when)}なら、手順 ${esc(stepNo(X, sheet, st.alt.at))} の代わりに起きる。</p>`;
  if (st.branches) a += `<table class="branches"><tbody>${st.branches.map(([g, o], k) => `<tr class="${k === 0 ? 'taken' : ''}"><td>${esc(g)}</td><td>${richText(o)}</td></tr>`).join('')}</tbody></table>`;
  if (st.ops) a += `<p class="hint">置き場の操作：${st.ops.map((o) => `${linkHtml(o.node)} に「${esc(o.kind)}」`).join('、')}</p>`;
  const t = M.times.get(r.key);
  a += `<h4>記録</h4>`;
  if (t && !t.why) {
    a += `<dl class="kv"><dt>命令数</dt><dd>${fmt(t.instr)}${t.delta != null ? `（前の時刻から +${fmt(t.delta)}）` : ''}</dd><dt>入った関数</dt><dd><code>${esc(t.irq ? '割り込み（timer）→ ' + t.fn : t.fn)}</code>${t.quality === 'same' ? '（同じ呼び出しの中）' : t.quality === 'target' ? '（入ったことだけ分かる）' : '（前の手順から続けて）'}</dd><dt>スレッド</dt><dd>${esc(threadName(T, t.thread))}</dd></dl>`;
    if (t.via && t.via.length) a += `<p class="hint" style="margin:0 0 4px">あいだに入った関数（記録の順）</p><div class="via">${t.via.slice(0, 28).map((v) => `<span class="${v.startsWith('割り込み') ? 'ir' : v.startsWith('切り替え') ? 'sw2' : ''}">${esc(v)}</span>`).join('')}${t.via.length > 28 ? `<span>… ほか ${t.via.length - 28}</span>` : ''}</div>`;
  } else if (t && t.why) a += `<p class="hint">${esc(WHY[t.why] || '')}</p>`;
  else a += `<p class="hint">記録が無い。</p>`;
  let b = '';
  const d = st.data;
  if (d) {
    b += `<h4>渡すもの</h4>`;
    if (d.schema && NODES[d.schema]?.fields) b += structHtml(d.schema, d.fields);
    else b += `<p><span class="chip plain">${esc(d.label)}</span> ${esc(d.type || '')}</p>`;
    if (d.type && d.schema) b += `<p class="hint">${esc(d.type)}</p>`;
    if (d.note) b += `<p>${richText(d.note)}</p>`;
  }
  const refN = st.ref && NODES[st.ref] ? st.ref : toN;
  const rn = NODES[refN];
  if (rn) {
    b += `<h4>この手順の箱：${linkHtml(refN)}</h4>`;
    if (rn.api?.sig) b += `<div class="code sig">${rn.api.sig.split('\n').map((l) => `<div class="ln"><span>${highlight(l)}</span></div>`).join('')}</div>`;
    b += `<p>${richText(rn.text)}</p>`;
  }
  body.innerHTML = `<section>${a}</section><section>${b}</section><section><h4>コード</h4><div id="codeSlot"><p class="hint">読み込み中…</p></div></section>`;
  const ref = stepCodeRef(r);
  const slot = $('#codeSlot');
  if (!ref) { slot.innerHTML = `<p class="hint">コードの場所が分からない。</p>`; return; }
  let html = `<div class="path">${esc(ref.path)}:${ref.line}<span class="how">${esc(ref.how)}</span></div>` + await codeHtml(ref.path, ref.from, ref.to, ref.hot);
  // a place is defined on one line; the code that acts on it lives in the step's own box
  const boxDef = st.ref && X.CODE.nodes?.[st.ref];
  if (ref.to - ref.from < 2 && boxDef && boxDef.start && boxDef.path + boxDef.start !== ref.path + ref.line) {
    html += `<div class="path" style="margin-top:10px">${esc(boxDef.path)}:${boxDef.start}<span class="how">この手順の箱 ${esc(NODES[st.ref].title)} の定義</span></div>` + await codeHtml(boxDef.path, boxDef.start, Math.min(boxDef.end, boxDef.start + 11), [boxDef.start]);
  }
  if (slot.isConnected) slot.innerHTML = html;
}

async function renderNodeInspector(id) {
  const n = NODES[id];
  if (!n) return;
  const body = $('#inspBody'), head = $('#inspTitle');
  head.innerHTML = `<span class="who" style="--lc:${lc(n.layer)}"><i></i>${esc(X.layers[n.layer]?.name || n.layer)}</span>${esc(n.title)}`;
  let a = '';
  if (n.api?.sig) a += `<div class="code" style="margin-bottom:10px">${n.api.sig.split('\n').map((l) => `<div class="ln"><span class="no"></span><span>${highlight(l)}</span></div>`).join('')}</div>`;
  a += `<p>${richText(n.text)}</p>`;
  if (n.api?.params) a += `<table class="branches"><tbody>${n.api.params.map(([p, d]) => `<tr><td><code>${esc(p)}</code></td><td>${richText(d)}</td></tr>`).join('')}</tbody></table>`;
  if (n.api?.ret) a += `<p class="hint">返す：${richText(n.api.ret)}</p>`;
  if (n.run) a += `<p class="hint">走るもの：${esc(n.run)}${n.kernel ? '（カーネルの中）' : ''}</p>`;
  let b = '';
  // this lifeline's arrows in the diagram as it stands
  const keys = new Set(M.L.order.filter((l) => l.node === id).map((l) => l.key));
  const touching = M.model.rows.filter((r) => r.type === 'step' && (keys.has(lkey(r, 'from')) || keys.has(lkey(r, 'to'))));
  if (touching.length) {
    b += `<h4>この図での出入り</h4><ul class="touch">${touching.map((r) => {
      const out = keys.has(lkey(r, 'from'));
      const other = lifeOf(lkey(r, out ? 'to' : 'from'));
      return `<li><button type="button" class="tbtn" data-row="${esc(r.key)}"><span class="tb${r.st.alt ? ' alt' : isInner(r) ? ' inner' : ''}">${esc(stepBadge(X, r.sheet, r.i))}</span><span class="dir">${out ? '→' : '←'}</span><span class="who2">${esc(cardTitle(other))}</span><span class="vb2">${esc(r.st.verb || KIND_LABEL[r.st.kind] || '')}</span></button></li>`;
    }).join('')}</ul>`;
  }
  if (n.fields) b += `<h4>中身</h4>` + structHtml(id, []);
  if (n.values) b += `<h4>値</h4><div class="struct">${n.values.map((v) => `<div class="f">${esc(Array.isArray(v) ? v.join('　') : v)}</div>`).join('')}</div>`;
  if (!b) b = `<h4>中身</h4><p class="hint">フィールドの記述は無い。</p>`;
  const def = X.CODE.nodes?.[id];
  body.innerHTML = `<section>${a}</section><section>${b}</section><section><h4>コード</h4><div id="codeSlot">${def && def.start ? '<p class="hint">読み込み中…</p>' : '<p class="hint">コードの場所は無い。</p>'}</div></section>`;
  if (def && def.start) { const html = await codeHtml(def.path, def.start, Math.min(def.end, def.start + 18), [def.start]); const slot = $('#codeSlot'); if (slot) slot.innerHTML = `<div class="path">${esc(def.path)}:${def.start}</div>` + html; }
}
function toggleInspector(on = !state.insp) {
  state.insp = on;
  if (!on) state.inspNode = null;
  renderTabs();
  renderInspector();
  G = layout();
  shown = G;
  draw(G, 1);
  if (on) { const r = activeRow(); if (r) scrollToRow(r, true); }
}

// ---------------------------------------------------------------- tooltips
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('show');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14, top = y + 16;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top + h > window.innerHeight - 8) top = y - h - 12;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
const hideTip = () => tip.classList.remove('show');

function lifeTip(key) {
  const l = lifeOf(key);
  if (!l) return '';
  const n = NODES[l.node] || {};
  const b = l.box;
  return `<h5>${esc(n.title || b.title)}</h5><div class="muted">${esc(X.layers[n.layer]?.name || '')}${b.ns ? '・' + esc(b.ns) : ''}${b.sub ? '・' + esc(b.sub) : ''}</div><div>${esc(plainText(X, n.text || '').slice(0, 140))}${(n.text || '').length > 140 ? '…' : ''}</div>`;
}

// ---------------------------------------------------------------- the URL hash keeps flow, open papers and step
function writeHash() {
  const p = new URLSearchParams();
  p.set('flow', state.flow);
  const open = [...openSet()];
  if (open.length) p.set('open', open.join(','));
  if (activeKey()) p.set('step', activeKey());
  if (state.insp) p.set('insp', '1');
  if (!state.time) p.set('time', '0');
  if (!state.narr) p.set('narr', '0');
  const h = '#' + p.toString();
  if (location.hash !== h) history.replaceState(null, '', h);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = p.get('flow');
  if (f && X.A.flows.some((x) => x.id === f)) state.flow = f;
  if (p.get('open')) state.open.set(state.flow, new Set(p.get('open').split(',').filter(Boolean)));
  if (p.get('step')) state.active.set(state.flow, p.get('step'));
  if (p.get('insp') === '1') state.insp = true;
  if (p.get('time') === '0') state.time = false;
  if (p.get('narr') === '0') state.narr = false;
  if (p.get('occ')) state.occ.set(state.flow, Number(p.get('occ')) - 1);
}

// ---------------------------------------------------------------- the record's pace: a counter runs through the instructions between steps
const rec = { on: false, run: 0, label: '', thread: null };
const recHtml = () => `${esc(rec.label)}${rec.thread != null ? `<span class="recth" style="--th:${thColor(rec.thread)}" title="この時に走っていたスレッド：${esc(threadName(T, rec.thread))}"><i></i>${esc(threadShort(T, rec.thread))}</span>` : ''}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function recShow(instr, target, startThread) {
  const seg = T ? T.segs.find((sg) => sg.from <= instr && instr < sg.to) || T.segs[T.segs.length - 1] : null;
  rec.label = `${fmt(Math.round(instr))} 命令目`;
  rec.thread = seg ? seg.thread : null;
  const now = document.getElementById('recNow');
  if (now) now.innerHTML = recHtml();
  const ph = document.getElementById('playhead');
  if (ph && T) { const x = (instr / T.maxInstr) * 120; ph.setAttribute('x1', x); ph.setAttribute('x2', x); ph.setAttribute('visibility', 'visible'); }
  if (target) recBadge({ instr, thread: rec.thread, startThread, target });
}
// While the record plays, a badge stands where the next step will be: the count so far, the thread running
// now, and a note when the record switched threads on the way.
function recBadge(b) {
  const el = $('#recBadge');
  if (!b || !G || !G.rowY.has(b.target.key)) { el.hidden = true; return; }
  const g = G;
  const switched = b.startThread != null && b.thread !== b.startThread;
  const t = M.times.get(b.target.key);
  const html = `<div class="rb-n">${fmt(Math.round(b.instr))}<small>命令目</small></div>`
    + `<div class="rb-th" style="--th:${thColor(b.thread)}"><i></i>${esc(threadShort(T, b.thread))} が走っている</div>`
    + (switched ? `<div class="rb-sw">${esc(threadShort(T, b.startThread))} から切り替わった</div>` : '')
    + (t && !t.why ? `<div class="rb-to">次：${esc(stepNo(X, b.target.sheet, b.target.i))}（${fmt(t.instr)}）</div>` : '');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  el.hidden = false;
  const w = el.offsetWidth || 200, h = el.offsetHeight || 80;
  // beside the arrow it counts toward, on the side with room, so its label stays readable
  const r = b.target, xa = g.colX.get(lkey(r, 'from')), xb = g.colX.get(lkey(r, 'to'));
  const lb = msgLabel(g, r, xa, xb);
  const x0 = Math.min(xa, xb, lb.lx0) - 22, x1 = Math.max(xa, xb, lb.lx0 + lb.W) + 22;
  const V0 = stage.scrollLeft + 8, V1 = stage.scrollLeft + visW(g) - 8;
  let x, y = g.rowAy.get(r.key) - h / 2;
  if (x0 - V0 >= w) x = x0 - w;
  else if (V1 - x1 >= w) x = x1;
  else { x = V1 - w; y = g.rowY.get(r.key) - h - 4; }
  el.style.transform = `translate(${P(clamp(x, 4, g.diagW - w - 4))}px, ${P(y)}px)`;
}
async function playRecord(on = !rec.on) {
  rec.on = on;
  const run = ++rec.run;
  if (on) play(false);
  timeHead();
  if (!on) { recBadge(null); return; }
  const rows = M.model.rows.filter((r) => r.type === 'step' && M.times.get(r.key) && !M.times.get(r.key).why);
  let prev = null, prevThread = null;
  const alive = () => rec.on && rec.run === run;
  for (const r of rows) {
    if (!alive()) return;
    const t = M.times.get(r.key);
    const from = prev == null ? t.instr : prev, to = t.instr;
    const dur = reduceMotion() ? 0 : to > from ? 420 + 2.6 * Math.sqrt(to - from) : 360;
    const t0 = performance.now();
    if (prev != null) scrollToRow(r, true);
    while (alive()) {
      const k = dur ? clamp((performance.now() - t0) / dur, 0, 1) : 1;
      recShow(lerp(from, to, ease(k)), prev == null ? null : r, prevThread);
      if (k >= 1) break;
      await new Promise((ok) => requestAnimationFrame(ok));
    }
    if (!alive()) return;
    recBadge(null);
    setActive(r.key);
    prev = to;
    prevThread = t.thread;
    await sleep(reduceMotion() ? 900 : 700);
  }
  if (alive()) { rec.on = false; recBadge(null); timeHead(); }
}

// ---------------------------------------------------------------- play
let playTimer = 0;
function play(on = !state.playing) {
  if (on && rec.on) { rec.on = false; rec.run++; recBadge(null); timeHead(); }
  state.playing = on;
  clearTimeout(playTimer);
  renderTabs();
  if (!on) return;
  const next = () => {
    if (!state.playing) return;
    const list = stops().filter((r) => r.type === 'step');
    const i = list.findIndex((r) => r.key === activeKey());
    if (i >= list.length - 1) { play(false); return; }
    setActive(list[i + 1].key);
    playTimer = setTimeout(next, 1700);
  };
  const list = stops().filter((r) => r.type === 'step');
  const i = list.findIndex((r) => r.key === activeKey());
  if (i < 0 || i >= list.length - 1) { setActive(list[0].key); playTimer = setTimeout(next, 1700); }
  else next();
}

// ---------------------------------------------------------------- events
function onClick(e) {
  const t = e.target;
  if (!t.closest('#moreMenu') && !t.closest('#moreBtn') && !$('#moreMenu').hidden) toggleMenu(false);
  const closeEl = t.closest('[data-close]');
  if (closeEl) { e.preventDefault(); closeRef(closeEl.dataset.close); return; }
  const openEl = t.closest('[data-open]');
  if (openEl) { e.preventDefault(); openRef(openEl.dataset.open); return; }
  const nEl = t.closest('[data-narr]');
  if (nEl) { toggleNarr(nEl.dataset.narr === '1'); return; }
  const goEl = t.closest('[data-goto]');
  if (goEl) { e.preventDefault(); state.inspNode = null; setActive(goEl.dataset.goto); return; }
  const flowEl = t.closest('[data-flow]');
  if (flowEl) { switchFlow(flowEl.dataset.flow); return; }
  const ov = t.closest('svg.overview');
  if (ov && M.occs.length > 1 && T) {
    const b = ov.getBoundingClientRect();
    const instr = ((e.clientX - b.left) / b.width) * T.maxInstr;
    let best = 0;
    M.occs.forEach((idx, k) => { if (Math.abs(T.events[idx].instr - instr) < Math.abs(T.events[M.occs[best]].instr - instr)) best = k; });
    state.occ.set(state.flow, best); rebuild(); return;
  }
  const occEl = t.closest('[data-occ]');
  if (occEl) { state.occ.set(state.flow, (state.occ.get(state.flow) ?? 0) + Number(occEl.dataset.occ)); rebuild(); return; }
  const nodeEl = t.closest('[data-node]');
  if (nodeEl && (nodeEl.closest('#insp') || nodeEl.classList.contains('grp'))) { e.preventDefault(); state.inspNode = nodeEl.dataset.node; if (!state.insp) toggleInspector(true); else renderInspector(); return; }
  const card = t.closest('[data-life]');
  if (card) { state.inspNode = lifeOf(card.dataset.life)?.node || null; if (!state.insp) toggleInspector(true); else renderInspector(); return; }
  const rowEl = t.closest('[data-row]');
  if (rowEl && !rowEl.classList.contains('fbot')) {
    const r = M.model.rows.find((x) => x.key === rowEl.dataset.row);
    if (r && (r.type === 'step' || r.type === 'ref')) {
      state.inspNode = null;
      if (r.key === activeKey() && r.type === 'step' && e.detail >= 1 && rowEl.closest('.narr')) { toggleInspector(); return; }
      setActive(r.key);
    }
  }
}
function switchFlow(id) {
  if (id === state.flow || !X.A.flows.some((f) => f.id === id)) return;
  play(false);
  if (rec.on) { rec.on = false; rec.run++; recBadge(null); }
  tweenId++;
  tokenRun++;
  state.flow = id;
  state.inspNode = null;
  shown = null;
  for (const m of [cellEls, timeEls, cardEls, grpEls]) { for (const el of m.values()) el.remove(); m.clear(); }
  rebuild();
  progScroll({ top: 0, left: 0 });
  setActive(activeKey(), { scroll: true, smooth: false, token: false });
  writeHash();
}

function onKey(e) {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'ArrowDown' || k === 'j' || k === 'ArrowRight') { e.preventDefault(); play(false); if (rec.on) playRecord(false); step(1); }
  else if (k === 'ArrowUp' || k === 'k' || k === 'ArrowLeft') { e.preventDefault(); play(false); if (rec.on) playRecord(false); step(-1); }
  else if (k === 'Home') { e.preventDefault(); setActive(stops()[0].key); }
  else if (k === 'End') { e.preventDefault(); const s = stops(); setActive(s[s.length - 1].key); }
  else if (k === 'Enter') {
    // Enter opens papers: on a paper's row, or on the step right before one
    const r = activeRow();
    if (!r || (e.target.closest && e.target.closest('button, a'))) return;
    e.preventDefault();
    if (r.type === 'ref') openRef(r.frame.id);
    else if (r.type === 'step') {
      const i = M.model.rows.indexOf(r), nx = M.model.rows[i + 1];
      if (nx && nx.type === 'ref') openRef(nx.frame.id);
    }
  } else if (k === 'Escape') {
    if (!$('#moreMenu').hidden) { toggleMenu(false); return; }
    if (!$('#legendSheet').hidden) { toggleLegendSheet(false); return; }
    if (state.insp) { toggleInspector(false); return; }
    const r = activeRow();
    const fr = r && frameChain(r).reverse().find((f) => f.type === 'ref' && f.open);
    if (fr) closeRef(fr.id);
  } else if (k === 'i') toggleInspector();
  else if (k === 'p' || k === ' ') { e.preventDefault(); play(); }
  else if (k === 't') { state.time = !state.time; rebuild(); }
  else if (k === 'r') { e.preventDefault(); playRecord(); }
  else if (k === 'o') toggleAll();
  else if (k === 'm') toggleMini();
  else if (k === 'n') toggleNarr();
  else if (/^[1-9]$/.test(k) && X.A.flows[Number(k) - 1]) switchFlow(X.A.flows[Number(k) - 1].id);
}

function onMove(e) {
  const card = e.target.closest('[data-life]');
  const lifeKey = card ? card.dataset.life : null;
  if (lifeKey !== state.hoverLife) { state.hoverLife = lifeKey; draw(shown || G, 1); }
  if (card) { showTip(lifeTip(lifeKey), e.clientX, e.clientY); return; }
  const rowEl = e.target.closest('[data-row]');
  const rk = rowEl && (rowEl.closest('.narr') || rowEl.closest('svg')) ? rowEl.dataset.row : null;
  if (rk !== state.hoverRow) { state.hoverRow = rk; draw(shown || G, 1); }
  const tc = e.target.closest('.tcell');
  if (tc) {
    const r = M.model.rows.find((x) => x.key === tc.dataset.row);
    const t = r && M.times.get(r.key);
    if (t) {
      if (t.why) showTip(`<div>${esc(WHY[t.why])}</div>`, e.clientX, e.clientY);
      else showTip(`<h5>${fmt(t.instr)} 命令目</h5><div><code>${esc(t.fn || '')}</code> に入った${t.quality === 'same' ? '（同じ呼び出しの中の手順）' : t.quality === 'target' ? '。前の手順の関数から続けて入ったかは記録から分からない' : '。前の手順の関数から続けて入った'}</div><div class="muted">${esc(threadName(T, t.thread))}${t.delta != null ? `・前の時刻から +${fmt(t.delta)} 命令` : ''}</div>${t.via && t.via.length ? `<div class="muted">あいだ：${esc(t.via.slice(0, 6).join(' → '))}${t.via.length > 6 ? ' → …' : ''}</div>` : ''}`, e.clientX, e.clientY);
      return;
    }
  }
  const cref = e.target.closest('.cref');
  if (cref) {
    const fr = M.model.frames.find((f) => f.id === cref.dataset.open);
    if (fr) { showTip(`<h5>${esc(fr.paper.title)}</h5><ol class="plain">${fr.paper.steps.map((st, i) => `<li><b>${esc(st.alt ? `${stepBadge(X, fr.paper, i)}（もし${st.alt.when}）` : stepBadge(X, fr.paper, i))}</b>${esc(st.label)}</li>`).join('')}</ol><div class="muted">押すとこの場に開く</div>`, e.clientX, e.clientY); return; }
  }
  hideTip();
}

// ---------------------------------------------------------------- scrolling: who moved it, following the reading, the minimap
let progUntil = 0, userPanUntil = 0, lastLeft = 0, lastTop = 0, panTimer = 0;
function progScroll(o) {
  progUntil = performance.now() + (o.behavior === 'smooth' ? 900 : 150);
  stage.scrollTo(o);
}
const visW = (g) => stage.clientWidth - (g.cp ? 0 : g.narrW) - g.timeW;
const visH = (g) => stage.clientHeight - g.headH;
function onScroll() {
  stickTitles();
  miniView();
  const now = performance.now();
  if (stage.scrollLeft !== lastLeft) { if (now > progUntil) userPanUntil = now + 2500; lastLeft = stage.scrollLeft; }
  if (stage.scrollTop !== lastTop) {
    lastTop = stage.scrollTop;
    if (now > progUntil) { clearTimeout(panTimer); panTimer = setTimeout(followRows, 220); }
  }
}
// Reading down a wide sheet: the diagram pans sideways to show as much as it can of the arrows in the rows on
// screen, when that is clearly more than it shows now. Panning by hand turns this off for a while.
function followRows() {
  const g = G;
  if (!g || !M || performance.now() < userPanUntil || performance.now() < progUntil) return;
  const w = visW(g);
  if (g.diagW <= w + 2) return;
  const top = stage.scrollTop + 8, bot = stage.scrollTop + visH(g) - 8;
  const spans = [];
  for (const r of M.model.rows) {
    let a, b, y;
    if (r.type === 'step') { a = g.colX.get(lkey(r, 'from')); b = g.colX.get(lkey(r, 'to')); y = g.rowAy.get(r.key); }
    else if (r.type === 'ref') { a = b = g.colX.get(M.L.keyOf(r.frame.scope, r.frame.boxId)); y = g.rowY.get(r.key) + g.rowH.get(r.key) / 2; }
    else continue;
    if (a == null || b == null || y == null || y < top || y > bot) continue;
    spans.push([Math.min(a, b) - 30, Math.max(a, b) + 30]);
  }
  if (!spans.length) return;
  const maxL = g.diagW - w;
  const score = (L) => spans.reduce((t, [x0, x1]) => t + Math.max(0, Math.min(x1, L + w) - Math.max(x0, L)) / Math.min(x1 - x0, w), 0);
  const now = stage.scrollLeft, have = score(now);
  let best = now, bestScore = have;
  for (const [x0, x1] of spans) {
    for (const L of [x0 - 20, x1 + 20 - w, (x0 + x1) / 2 - w / 2]) {
      const c = clamp(L, 0, maxL), sc = score(c);
      if (sc > bestScore + 1e-6 || (Math.abs(sc - bestScore) < 1e-6 && Math.abs(c - now) < Math.abs(best - now))) { best = c; bestScore = sc; }
    }
  }
  if (bestScore < have + 0.5 || Math.abs(best - now) < 24) return;
  progScroll({ left: best, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

// The minimap: the whole sheet in small, when it is wider than the screen. Press or drag to move there.
const mini = $('#mini'), miniSvg = $('#miniSvg');
let miniK = 0;
function renderMini(g) {
  if (!mini || !g) return;
  const show = state.mini && !g.cp && !state.insp && g.diagW > visW(g) + 4;
  mini.hidden = !show;
  if (!show) return;
  const maxW = g.timeW ? g.timeW - 22 : 170;
  const k = Math.min(maxW / g.diagW, 190 / g.bodyH);
  miniK = k;
  const W = Math.ceil(g.diagW * k), H = Math.ceil(g.bodyH * k);
  let s = '';
  for (const run of g.runs) {
    const a = g.order[run.idx[0]], b = g.order[run.idx[run.idx.length - 1]];
    const x0 = g.colX.get(a.key) - g.colW.get(a.key) / 2, x1 = g.colX.get(b.key) + g.colW.get(b.key) / 2;
    s += `<rect class="m-ctx${run.kernel ? ' kern' : ''}" x="${P(x0 * k)}" y="0" width="${P((x1 - x0) * k)}" height="${H}"/>`;
  }
  for (const fb of frameBoxes(g)) {
    const cls = fb.fr.type === 'ref' ? (fb.fr.open ? 'm-ref' : 'm-cref') : 'm-alt';
    s += `<rect class="${cls}" x="${P(fb.x0 * k)}" y="${P(fb.y0 * k)}" width="${P((fb.x1 - fb.x0) * k)}" height="${P((fb.y1 - fb.y0) * k)}" rx="1.5"/>`;
  }
  for (const l of g.order) { const x = P(g.colX.get(l.key) * k); s += `<line class="m-life" x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="${lc(NODES[l.node]?.layer)}"/>`; }
  const act = activeKey();
  for (const r of M.model.rows) {
    if (r.type !== 'step') continue;
    const a = g.colX.get(lkey(r, 'from')), b = g.colX.get(lkey(r, 'to')), y = g.rowAy.get(r.key);
    if (a == null || b == null || y == null) continue;
    s += `<line class="m-msg${r.key === act ? ' on' : ''}" x1="${P(a * k)}" x2="${P(b * k)}" y1="${P(y * k)}" y2="${P(y * k)}"/>`;
  }
  s += `<rect id="miniView" class="m-view" rx="2"/>`;
  miniSvg.setAttribute('width', W);
  miniSvg.setAttribute('height', H);
  miniSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  miniSvg.innerHTML = s;
  mini.style.right = ((g.timeW ? 0 : 14) + 8 + (stage.offsetWidth - stage.clientWidth)) + 'px';
  miniView();
}
function miniView() {
  const v = document.getElementById('miniView');
  if (!v || !mini || mini.hidden || !G) return;
  const g = G, k = miniK;
  v.setAttribute('x', P(stage.scrollLeft * k));
  v.setAttribute('y', P(stage.scrollTop * k));
  v.setAttribute('width', P(Math.min(visW(g), g.diagW) * k));
  v.setAttribute('height', P(Math.min(visH(g), g.bodyH) * k));
}
function miniGo(e) {
  const b = miniSvg.getBoundingClientRect(), g = G;
  if (!g || !miniK) return;
  const x = (e.clientX - b.left) / miniK, y = (e.clientY - b.top) / miniK;
  userPanUntil = performance.now() + 2500;
  progScroll({ left: Math.max(0, x - visW(g) / 2), top: Math.max(0, y - visH(g) / 2), behavior: 'auto' });
}
function toggleMini(on = !state.mini) { state.mini = on; renderMini(G); }
function toggleNarr(on = !state.narr) {
  if (on === state.narr) return;
  state.narr = on;
  legend();
  rebuild();
  const r = activeRow();
  if (r) scrollToRow(r, false);
  writeHash();
}

// ---------------------------------------------------------------- start
function init() {
  readHash();
  layerKey();
  legend();
  rebuild();
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  stage.addEventListener('mousemove', onMove);
  stage.addEventListener('scroll', onScroll, { passive: true });
  if (mini) {
    let drag = false;
    miniSvg.addEventListener('pointerdown', (e) => { drag = true; miniSvg.setPointerCapture(e.pointerId); miniGo(e); });
    miniSvg.addEventListener('pointermove', (e) => { if (drag) miniGo(e); });
    miniSvg.addEventListener('pointerup', () => { drag = false; });
    $('#miniClose').addEventListener('click', () => toggleMini(false));
  }
  stage.addEventListener('mouseleave', () => { hideTip(); if (state.hoverLife || state.hoverRow) { state.hoverLife = null; state.hoverRow = null; draw(shown || G, 1); } });
  $('#playBtn').addEventListener('click', () => play());
  $('#recBtn').addEventListener('click', () => playRecord());
  $('#openAll').addEventListener('click', () => toggleAll());
  $('#timeBtn').addEventListener('click', () => { state.time = !state.time; rebuild(); writeHash(); });
  $('#inspBtn').addEventListener('click', () => toggleInspector());
  $('#inspClose').addEventListener('click', () => toggleInspector(false));
  $('#moreBtn').addEventListener('click', () => toggleMenu());
  $('#moreMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    toggleMenu(false);
    const a = b.dataset.act;
    if (a === 'play') play();
    else if (a === 'rec') playRecord();
    else if (a === 'all') toggleAll();
    else if (a === 'time') { state.time = !state.time; rebuild(); writeHash(); }
    else if (a === 'legend') toggleLegendSheet(true);
  });
  $('#legendBtn').addEventListener('click', () => toggleLegendSheet());
  $('#legendClose').addEventListener('click', () => toggleLegendSheet(false));
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      if (sizeCols()) { legend(); timeHead(); }
      for (const el of cellEls.values()) delete el.dataset.html;
      buildDom(); G = layout(); fillCards(G); shown = G; draw(G, 1);
    });
  });
  if (state.insp) renderInspector();
  const r = activeRow();
  if (r) { setActive(r.key, { scroll: true, smooth: false, token: false }); }
  window.__seq = { state, get M() { return M; }, openRef, closeRef, setActive, toggleInspector, switchFlow, step, rebuild };
}
init();
