import {
  ATLAS, NODES, LAYER_BY_ID, KIND_NAME, NODE_KIND_NAME, story, parseLinks, plain, nodeName, linkName,
  shortRegion, codeOf, traceMatches, traceApp, threadLabel, appearances,
} from './model.js';
import { drawScene, castFigure, legendIcon, measure, el as svgEl } from './draw.js';
import { buildTrace } from './trace.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => n.toLocaleString('en-US');

const EPISODES = [
  ...ATLAS.flows.map((f, i) => ({ id: f.id, no: `第${i + 1}話`, tab: f.tab, title: f.title })),
  ...(ATLAS.traces?.length ? [{ id: 'trace', no: 'おまけ', tab: '実録', title: ATLAS.traces[0].title }] : []),
];

const state = { ep: EPISODES[0].id, open: new Set(), filter: null };

// ---------- text with [[links]] ----------
function richText(text, opts = {}) {
  const frag = document.createDocumentFragment();
  for (const p of parseLinks(text || '')) {
    if (p.t === 'text') frag.append(p.v);
    else if (p.t === 'link') {
      const n = NODES[p.id];
      const b = h('button', { class: `nl L-${n?.layer || 'os'}`, type: 'button', 'data-node': p.id, title: nodeName(p.id) }, linkName(p.id));
      frag.append(b);
    } else if (p.t === 'embed' && opts.embeds) {
      const n = NODES[p.id];
      if (n?.figure) {
        const fig = h('figure', { class: 'embed' }, h('div', { class: 'embed-svg', html: n.figure }), h('figcaption', {}, richText(n.text)));
        frag.append(fig);
      } else if (n) {
        frag.append(h('div', { class: 'embed-ref' }, '→ ', h('button', { class: `nl L-${n.layer}`, type: 'button', 'data-node': p.id }, linkName(p.id))));
      }
    }
  }
  return frag;
}

// Code names inside a caption (send_text, app_transport.request, REQUEST_SPACE, view()) in monospace.
const IDENT = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\([^()\s]*(?:,\s?[^()\s]*)*\))?)/g;
function isCodeName(t) {
  return /[_.]/.test(t) || /\(/.test(t) || (/^[A-Z0-9_]{3,}$/.test(t) && /_/.test(t));
}
function codeText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(IDENT)) {
    if (!isCodeName(m[0]) || m.index < last) continue;
    if (m.index > last) frag.append(text.slice(last, m.index));
    const end = m.index + m[0].length;
    // a particle right after a code name stays on its line (…request へ, …send_text を)
    const tail = /^ ?[へをにがのではとも、。]/.exec(text.slice(end));
    if (tail) {
      frag.append(h('span', { class: 'nobr' }, h('code', { class: 'cn' }, m[0]), tail[0]));
      last = end + tail[0].length;
    } else {
      frag.append(h('code', { class: 'cn' }, m[0]));
      last = end;
    }
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

// ---------- tiers ----------
function colsFor(width) { return width >= 1060 ? 3 : width >= 640 ? 2 : 1; }

function tiersOf(st, cols) {
  const tiers = [];
  let cur = [];
  const flush = () => { if (cur.length) tiers.push({ kind: 'main', steps: cur }); cur = []; };
  for (const s of st.main) {
    cur.push(s);
    const alts = st.alts.filter((a) => a.alt.at === s.i);
    if (alts.length) {
      flush();
      for (let i = 0; i < alts.length; i += cols) tiers.push({ kind: 'alt', steps: alts.slice(i, i + cols), at: s, first: i === 0 });
    } else if (cur.length === cols) flush();
  }
  flush();
  return tiers;
}

// ---------- panels ----------
const panels = []; // {el, svg, s, st, big}

function panelEl(st, s, opts = {}) {
  const tm = opts.trace || {};
  const p = h('div', {
    class: `panel${s.main ? '' : ' alt'}${opts.big ? ' big' : ''}`,
    'data-story': st.id, 'data-i': s.i, tabindex: opts.big ? null : 0,
    // a group (not a button) so the stamp and the lens inside stay real buttons
    role: 'group', 'aria-roledescription': 'コマ',
    'aria-label': `${s.no}：${s.label}${opts.big ? '' : '（Enter で大きく読む）'}`,
  });
  p.append(h('div', { class: 'p-no' + (s.main ? '' : ' alt') }, s.main ? s.no : s.no.replace('もし', 'もし ')));
  const cap = h('div', { class: 'p-cap' });
  if (!s.main && opts.big) cap.append(h('div', { class: 'p-if' }, `もしも ${s.alt.when}なら（${s.altOf.no} の代わり）`));
  cap.append(h('p', { class: 'p-label' }, codeText(s.label)));
  // where it runs: the execution contexts of the two boxes
  const ra = s.A.region, rb = s.B.region;
  const meta = h('div', { class: 'p-meta' });
  if (ra || rb) {
    const place = h('span', { class: 'p-place', title: '実行の文脈（どこで走るか）' });
    if (ra && rb && ra !== rb) place.append(h('span', { class: 'ctx' }, shortRegion(ra)), h('span', { class: 'ctx-arrow', 'aria-hidden': 'true' }, '→'), h('span', { class: 'ctx' }, shortRegion(rb)));
    else place.append(h('span', { class: 'ctx' }, shortRegion(ra || rb)));
    meta.append(place);
  }
  const tr0 = tm[s.i];
  if (tr0) {
    const app = traceApp(tr0.trace);
    // the stamp opens おまけ「実録」 at that moment of the run
    meta.append(h('button', {
      class: 'p-rec', type: 'button', 'data-seq': tr0.ev.seq,
      title: `記録「${tr0.trace.title}」で ${tr0.ev.fn} に入った時（${threadLabel(tr0.thread)}）。押すと、おまけ「実録」のその所へ`,
    }, h('span', { class: 'rec-k' }, '実録'), app ? h('span', { class: 'rec-app' }, app) : null, `${fmt(tr0.ev.instr)} 命令目`));
    // where the recorded run took another way to the same function
    if (tr0.missed.length && tr0.prev) {
      meta.append(h('span', { class: 'p-rec-diff' }, '記録では ', h('code', { class: 'cn' }, tr0.missed.join('・')), ' を通らず、直前は ', h('code', { class: 'cn' }, tr0.prev.fn.split('.').pop())));
    }
  }
  if (meta.childNodes.length) cap.append(meta);
  p.append(cap);
  const svg = svgEl('svg', { class: 'p-scene', role: 'img', 'aria-label': sceneAlt(s) });
  p.append(svg);
  const frame = svgEl('svg', { class: 'p-frame', 'aria-hidden': 'true' });
  p.append(frame);
  const lens = st.lenses[s.i];
  if (lens && !opts.big) {
    const ps = story(lens.paper);
    const open = state.open.has(lens.paper);
    const b = h('button', {
      class: 'p-lens' + (open ? ' on' : ''), type: 'button', 'data-paper': lens.paper, 'aria-expanded': open ? 'true' : 'false',
      title: `${ps.title}（${ps.main.length} コマ）をこの下に開く`,
    },
    h('span', { class: 'lens-glass', 'aria-hidden': 'true' }),
    h('span', { class: 'lens-t' }, open ? '閉じる' : '中をのぞく'),
    h('span', { class: 'lens-n' }, `${ps.main.length} コマ${ps.alts.length ? `・もしも ${ps.alts.length}` : ''}`));
    p.append(b);
  }
  if (state.filter && !opts.big) {
    const on = s.A.node === state.filter || s.B.node === state.filter;
    p.classList.toggle('dim', !on);
  }
  panels.push({ el: p, svg, frame, s, st, big: !!opts.big });
  return p;
}

// The branches of a step, as a note under its panel (in the gutter, so they do not make the
// whole row of panels taller).
function forkNote(s) {
  const ul = h('ul', { class: 'p-branches', 'aria-label': '分かれ道' });
  for (const [cond, to] of s.branches) {
    const hit = (to || '').includes(`[[${s.B.node}]]`);
    ul.append(h('li', { class: hit ? 'hit' : '' }, h('span', { class: 'cond' }, plain(cond)), h('span', { class: 'arrowr', 'aria-hidden': 'true' }, '→'), h('span', { class: 'to' }, plain(to))));
  }
  return h('div', { class: 'p-fork', 'data-i': s.i }, h('span', { class: 'fork-k' }, `${s.no} の分かれ道`), ul);
}

function sceneAlt(s) {
  const who = (b) => b.title;
  const verb = s.verb ? `「${s.verb}」` : '';
  return `${who(s.A)}（${LAYER_BY_ID[s.A.tone]?.name || ''}）から ${who(s.B)}（${LAYER_BY_ID[s.B.tone]?.name || ''}）へ${verb}${s.data ? '、' + s.data.label + ' を渡す' : ''}`;
}

function drawPanel(pp) {
  const { el: p, svg, s, st } = pp;
  const W = Math.round(p.clientWidth);
  if (!W) return;
  if (pp.key === W) return;
  pp.key = W;
  if (pp.big) {
    // the same drawing as in the grid, enlarged when there is room
    const k = Math.max(1, Math.min(1.55, W / 560));
    const r = drawScene(svg, s, st, Math.round(W / k), { big: true, scale: k });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) playPanel(svg, r);
  } else drawScene(svg, s, st, W, {});
}

// In the reader the parcel travels from the sender to the middle of the toss, and the words pop.
function playPanel(svg, r) {
  const obj = svg.querySelector('.obj');
  if (obj && r.from && r.mid) {
    const dx = r.from[0] - r.mid[0], dy = r.from[1] - r.mid[1];
    obj.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.7)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }],
      { duration: 650, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'both' });
  }
  const bub = svg.querySelector('.bub');
  if (bub) {
    bub.style.transformBox = 'fill-box'; bub.style.transformOrigin = '50% 100%';
    bub.animate([{ transform: 'scale(0.5)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
      { duration: 420, delay: 180, easing: 'ease-out', fill: 'both' });
  }
}

// The frame, hand-drawn around the whole panel, once every panel in the row has its height.
function drawFrame(pp) {
  const { el: p, frame, s, st } = pp;
  const W = Math.round(p.clientWidth);
  const PH = Math.round(p.clientHeight);
  if (!W || !PH) return;
  const fk = `${W}x${PH}`;
  if (pp.fkey === fk) return;
  pp.fkey = fk;
  frame.setAttribute('viewBox', `0 0 ${W} ${PH}`);
  frame.setAttribute('width', W); frame.setAttribute('height', PH);
  while (frame.firstChild) frame.firstChild.remove();
  const rc = window.rough.svg(frame);
  const seed = (s.i + 3) * 131 + st.id.length * 7;
  const o = { stroke: 'currentColor', strokeWidth: s.main ? 2.4 : 2.2, roughness: s.main ? 0.9 : 1.1, bowing: s.main ? 0.5 : 1, seed, disableMultiStroke: !s.main, strokeLineDash: s.main ? undefined : [10, 6] };
  const r = rc.rectangle(1.5, 1.5, W - 3, PH - 3, o);
  r.setAttribute('class', 'ink');
  frame.append(r);
}

let drawQueued = false;
function drawAll() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const live = panels.filter((pp) => pp.el.isConnected);
    for (const pp of live) drawPanel(pp);
    for (const pp of live) drawFrame(pp);
    // each open paper points up at the lens that opened it
    document.querySelectorAll('.inset').forEach((ins) => {
      const lens = ins.previousElementSibling?.querySelector?.(`.p-lens[data-paper="${CSS.escape(ins.dataset.paper)}"]`)
        || document.querySelector(`.p-lens[data-paper="${CSS.escape(ins.dataset.paper)}"]`);
      if (!lens) return;
      const a = lens.getBoundingClientRect(), b = ins.getBoundingClientRect();
      ins.style.setProperty('--notch-x', `${Math.round(a.left + a.width / 2 - b.left)}px`);
    });
  });
}

// ---------- the cover and its cast ----------
function cover(st, ep) {
  const sec = h('section', { class: 'cover', 'aria-label': '表紙' });
  const nMain = st.main.length, nAlt = st.alts.length;
  const lensCount = Object.keys(st.lenses).length;
  const left = h('div', { class: 'cover-text' },
    h('div', { class: 'ep-no' }, h('span', {}, ep.no), h('span', { class: 'ep-tab' }, ep.tab)),
    h('h1', { class: 'ep-title' }, st.title),
    h('p', { class: 'ep-meta' },
      h('span', {}, `${nMain} コマ`), nAlt ? h('span', { class: 'alt' }, `もしも ${nAlt} コマ`) : null,
      lensCount ? h('span', {}, `中をのぞけるコマ ${lensCount}`) : null),
    h('ol', { class: 'how' },
      h('li', {}, h('b', {}, '番号の順'), 'に、左から右・上から下へ読む'),
      h('li', {}, h('b', {}, '床の色'), 'が層。下へ行くほど機械に近い'),
      h('li', {}, h('b', {}, 'ふきだし'), 'がすること、', h('b', {}, '手渡す物'), 'が渡るデータ'),
      lensCount ? h('li', {}, h('b', {}, '虫めがね'), 'で、その関数の中をのぞく') : null),
    routeChart(st),
    h('div', { class: 'cover-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => document.querySelector('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, '1 コマ目から読む ↓'),
      h('button', { class: 'btn', type: 'button', onclick: () => openReader(st.id, st.main[0].i) }, '大きく読む')),
  );
  sec.append(left);

  // the cast, standing on their floors
  const cast = h('div', { class: 'cast', 'aria-label': '登場人物（層ごと）' });
  cast.append(h('div', { class: 'cast-head' }, h('span', { class: 'cast-k' }, '登場人物'), h('span', { class: 'cast-hint' }, '人物を押すと、出てくるコマだけ明るくなる')));
  const order = [];
  for (const s of st.steps) for (const id of [s.from, s.to]) if (!order.includes(id)) order.push(id);
  for (const b of Object.values(st.boxes)) if (!order.includes(b.id)) order.push(b.id);
  st.levels.forEach((lev, li) => {
    const here = order.map((id) => st.boxes[id]).filter((b) => b.level === li);
    const row = h('div', { class: `cast-floor L-${lev.tone}${here.length ? '' : ' empty'}` },
      h('div', { class: 'cf-name' }, h('b', {}, lev.name), h('span', {}, lev.sub)));
    const people = h('div', { class: 'cf-people' });
    if (!here.length) people.append(h('span', { class: 'cf-none' }, 'この話には出てこない'));
    for (const b of here) {
      const other = appearances(b.node).filter((f) => f !== st.id);
      const fig = castFigure({ ...b, ns: null }, 168);
      // the panels this one appears in
      const cues = seqOf(st).filter((x) => x.from === b.id || x.to === b.id);
      // the numbers are buttons of their own, beside the person (not inside its button)
      const nos = h('span', { class: 'p-nos', role: 'group', 'aria-label': `${nodeName(b.node)} が出てくるコマ` }, ...cues.map((x) => h('button', {
        class: 'cue' + (x.main ? '' : ' alt'), type: 'button', 'data-i': x.i, title: `${x.no}：${x.label}`, 'aria-label': `${x.no} のコマへ`,
      }, x.main ? x.no : x.no.replace('もし', ''))));
      const on = state.filter === b.node;
      const sub = b.sub || NODE_KIND_NAME[b.kind] || '';
      const btn = h('button', {
        class: 'person-btn', type: 'button', title: `${nodeName(b.node)}${b.sub ? '：' + b.sub : ''}（押すと、出てくるコマだけ明るくなる）`,
        'aria-pressed': on ? 'true' : 'false', 'aria-label': `${nodeName(b.node)}、${sub}`,
      }, fig);
      const person = h('div', { class: 'person' + (on ? ' on' : ''), 'data-node': b.node },
        btn, h('span', { class: 'p-foot' }, h('span', { class: 'p-sub' + (b.sub ? '' : ' kind') }, sub), nos),
        other.length ? h('span', { class: 'p-also' }, EPISODES.find((e) => e.id === other[0])?.no + 'にも') : null);
      person.addEventListener('click', (e) => {
        e.stopPropagation();
        const cue = e.target.closest('.cue');
        if (cue) { goPanel(st.id, Number(cue.dataset.i)); return; }
        setFilter(state.filter === b.node ? null : b.node);
      });
      people.append(person);
    }
    row.append(people);
    cast.append(row);
  });
  sec.append(cast);
  return sec;
}

// The way the episode goes up and down the floors, one column per panel: an arrow from the floor
// it leaves to the floor it reaches (a short one when both are on one floor), in the panel's line
// style. The arrows are what the panels hold; the dotted thread joins one panel's end to the next.
function routeChart(st) {
  const steps = st.main, levs = st.levels;
  const W = 330, labelW = 78, rowH = 19, top = 2, padR = 4;
  const colW = (W - labelW - padR) / steps.length;
  const H = top + levs.length * rowH + 2;
  const cx = (k) => labelW + (k + 0.5) * colW;
  const cy = (lv) => top + lv * rowH + rowH / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'route-svg', 'aria-hidden': 'true' });
  levs.forEach((l, li) => {
    const g = svgEl('g', { class: `rt-row L-${l.tone}` }, svg);
    svgEl('rect', { x: 0, y: top + li * rowH, width: W, height: rowH - 1, class: 'rt-band' }, g);
    const t = svgEl('text', { x: 6, y: top + li * rowH + 13.5, class: 'rt-name' }, g);
    t.textContent = l.name;
  });
  // the thread from one panel's end to the next one's start
  const thread = [];
  steps.forEach((s, k) => { thread.push([cx(k) - 5, cy(s.A.level)], [cx(k) + 5, cy(s.B.level)]); });
  svgEl('polyline', { points: thread.map((p) => p.join(',')).join(' '), class: 'rt-thread' }, svg);
  steps.forEach((s, k) => {
    const x = cx(k), y1 = cy(s.A.level), y2 = cy(s.B.level);
    const g = svgEl('g', { class: `rt-step k-${s.kind}` }, svg);
    let pts;
    if (y1 === y2) pts = [[x - 7, y1], [x + 6, y1]];
    else pts = [[x, y1 + (y2 > y1 ? 3 : -3)], [x, y2 + (y2 > y1 ? -1 : 1)]];
    const [a, b] = pts;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const end = [b[0] - Math.cos(ang) * 4, b[1] - Math.sin(ang) * 4];
    if (s.kind === 'signal') {
      const n = Math.max(2, Math.round(Math.hypot(end[0] - a[0], end[1] - a[1]) / 5));
      const zz = [a];
      for (let q = 1; q < n; q++) {
        const t = q / n, o = (q % 2 ? 2.2 : -2.2);
        zz.push([a[0] + (end[0] - a[0]) * t - Math.sin(ang) * o, a[1] + (end[1] - a[1]) * t + Math.cos(ang) * o]);
      }
      zz.push(end);
      svgEl('polyline', { points: zz.map((p) => p.join(',')).join(' '), class: 'rt-line' }, g);
    } else svgEl('line', { x1: a[0], y1: a[1], x2: end[0], y2: end[1], class: 'rt-line' }, g);
    const hl = 6, hw = 3.4;
    const head = [b, [b[0] - Math.cos(ang) * hl + Math.sin(ang) * hw, b[1] - Math.sin(ang) * hl - Math.cos(ang) * hw], [b[0] - Math.cos(ang) * hl - Math.sin(ang) * hw, b[1] - Math.sin(ang) * hl + Math.cos(ang) * hw]];
    svgEl('polygon', { points: head.map((p) => p.join(',')).join(' '), class: 'rt-head' }, g);
  });
  const nos = h('div', { class: 'route-nos', style: `--lw:${(labelW / W) * 100}%;--pr:${(padR / W) * 100}%;--n:${steps.length}` },
    ...steps.map((s) => h('button', { type: 'button', class: 'rt-no', 'data-i': s.i, title: `${s.no}：${s.label}`, 'aria-label': `${s.no} のコマへ：${s.verb || s.label}`, onclick: () => goPanel(st.id, s.i) }, s.no)));
  const up = steps.filter((s) => s.B.level < s.A.level).length, down = steps.filter((s) => s.B.level > s.A.level).length;
  return h('div', { class: 'route' },
    h('div', { class: 'route-head' }, h('b', {}, '道のり'), h('span', {}, `下りる ${down}・上がる ${up}・同じ床 ${steps.length - up - down}`)),
    svg, nos);
}

function goPanel(storyId, i) {
  const p = document.querySelector(`.panel:not(.big)[data-story="${CSS.escape(storyId)}"][data-i="${i}"]`);
  if (!p) return;
  p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  p.focus({ preventScroll: true });
  p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
}

function setFilter(nodeId) {
  state.filter = nodeId;
  document.querySelectorAll('.person').forEach((b) => {
    const on = b.dataset.node === nodeId;
    b.classList.toggle('on', on);
    b.querySelector('.person-btn')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll('.panel:not(.big)').forEach((p) => {
    const pp = panels.find((x) => x.el === p);
    if (!pp) return;
    p.classList.toggle('dim', !!nodeId && pp.s.A.node !== nodeId && pp.s.B.node !== nodeId);
  });
  const bar = $('#filterbar');
  if (bar) {
    bar.hidden = !nodeId;
    if (nodeId) {
      const n = panels.filter((pp) => !pp.big && pp.el.isConnected && (pp.s.A.node === nodeId || pp.s.B.node === nodeId)).length;
      bar.querySelector('.fb-t').textContent = `${nodeName(nodeId)} が出るコマ：${n}`;
    }
  }
}

// ---------- an episode ----------
function buildEpisode() {
  const sheet = $('#sheet');
  panels.length = 0;
  sheet.innerHTML = '';
  const ep = EPISODES.find((e) => e.id === state.ep);
  document.querySelectorAll('#eps button').forEach((b) => b.setAttribute('aria-current', b.dataset.ep === state.ep ? 'page' : 'false'));
  $('#btn-reader').hidden = ep.id === 'trace';
  if (ep.id === 'trace') {
    const toPanel = (storyId, i) => { go(storyId, true); requestAnimationFrame(() => requestAnimationFrame(() => goPanel(storyId, i))); };
    sheet.append(buildTrace({ h, story, nodeName, castFigure, threadLabel, openReader, fmt, toPanel }));
    drawAll();
    return;
  }
  const st = story(ep.id);
  sheet.append(cover(st, ep));
  sheet.append(h('div', { class: 'filterbar', id: 'filterbar', hidden: true },
    h('span', { class: 'fb-t' }), h('button', { class: 'btn ghost', type: 'button', onclick: () => setFilter(null) }, 'すべて表示')));
  // what the 実録 stamps are, said once where they start
  const tm = traceMatches(st.id);
  const firstRec = Object.values(tm)[0];
  if (firstRec) {
    const app = traceApp(firstRec.trace);
    const nos = st.main.filter((s) => tm[s.i]).map((s) => s.no);
    // the app this episode is about, from its user-space frame ("タスクマネージャのプロセス（…）")
    const own = (st.regions.find((r) => r.node === 'ctx.user')?.label || '').replace(/のプロセス.*$/, '');
    sheet.append(h('p', { class: 'rec-note' },
      h('span', { class: 'rec-k' }, '実録'),
      h('span', {}, `の判子：${app ? app + ' で' : ''}「${firstRec.trace.run?.typed || ''}」を打った記録（おまけ「実録」）で、その関数に入った時の命令の数。`,
        own && own !== app ? h('b', {}, `${own}の記録ではない`) : null, own && own !== app ? 'が、' : '',
        `${nos[0]}〜${nos[nos.length - 1]} の関数（置き場を除く）を同じ順に通っている。判子を押すと、記録のその所へ。`)));
  }
  const pages = h('div', { class: 'pages', id: 'pages' });
  sheet.append(pages);
  layoutPages();
  // end card
  const next = EPISODES[EPISODES.indexOf(ep) + 1];
  sheet.append(h('div', { class: 'endcard' },
    h('span', { class: 'end-k' }, 'おわり'),
    next ? h('button', { class: 'btn', type: 'button', onclick: () => go(next.id, true) }, `つぎ：${next.no}「${next.tab}」 →`) : null));
  if (state.filter) setFilter(state.filter);
}

let lastCols = 0;
function layoutPages() {
  const pages = $('#pages');
  if (!pages) return;
  const st = story(state.ep);
  const cols = colsFor(pages.clientWidth || $('#sheet').clientWidth);
  lastCols = cols;
  for (let i = panels.length - 1; i >= 0; i--) if (pages.contains(panels[i].el)) panels.splice(i, 1);
  pages.innerHTML = '';
  appendTiers(pages, st, cols, traceMatches(st.id), 0);
  drawAll();
}

function appendTiers(parent, st, cols, tm, depth) {
  for (const t of tiersOf(st, cols)) {
    const tier = h('div', { class: `tier ${t.kind}`, style: `--n:${t.kind === 'alt' ? cols : t.steps.length}` });
    if (t.kind === 'alt' && t.first) {
      parent.append(h('div', { class: 'alt-head' },
        h('span', { class: 'alt-k' }, 'もしも'),
        h('span', {}, `${t.steps[0].alt.when}なら、${t.at.no} の代わりにこうなる`)));
    }
    // each panel is as tall as its own picture; a row lines up their floors at the bottom.
    // Branches hang under their panel, in a second row of the grid.
    t.steps.forEach((s, c) => {
      const p = panelEl(st, s, { trace: tm });
      p.style.gridColumn = String(c + 1);
      p.style.gridRow = '1';
      tier.append(p);
      if (s.branches) {
        const note = forkNote(s);
        note.style.gridColumn = String(c + 1);
        note.style.gridRow = '2';
        tier.append(note);
        tier.classList.add('has-notes');
      }
    });
    parent.append(tier);
    // papers opened from this tier
    for (const s of t.steps) {
      const lens = st.lenses[s.i];
      if (lens && state.open.has(lens.paper)) parent.append(inset(st, s, lens, cols, depth));
    }
  }
}

function inset(st, s, lens, cols, depth) {
  const ps = story(lens.paper);
  const box = h('section', { class: 'inset', 'data-paper': ps.id, style: `--depth:${depth}`, 'aria-label': ps.title });
  const bandsLegend = h('div', { class: 'in-bands' }, ...ps.levels.map((l) => h('span', { class: `band L-${l.tone}` }, h('b', {}, l.name), h('span', {}, l.sub))));
  box.append(h('div', { class: 'in-head' },
    h('div', { class: 'in-title' },
      h('span', { class: 'in-k' }, 'ズームイン'),
      h('h2', {}, ps.title),
      h('span', { class: 'in-from' }, `${s.no} の ${lens.box.title} の中`)),
    h('div', { class: 'in-side' }, bandsLegend,
      h('button', { class: 'btn ghost', type: 'button', 'data-paper': ps.id, 'data-close': '1' }, '閉じる'))));
  const pages = h('div', { class: 'pages in-pages' });
  appendTiers(pages, ps, Math.max(1, cols), {}, depth + 1);
  box.append(pages);
  // how it goes back out
  const outs = [];
  for (const [outer, inner] of Object.entries(ps.src.ports || {})) {
    const ob = Object.values(st.boxes).find((b) => b.node === outer);
    const step = st.steps.find((x) => x.from === lens.box.id && ob && x.to === ob.id);
    if (ob && step) outs.push(h('li', {}, h('b', {}, ps.boxes[inner]?.title || inner), ' から外へ出て → ', h('span', { class: 'chipno' }, step.no), ` ${step.verb || ''}（${ob.title}）`));
  }
  if (outs.length) box.append(h('div', { class: 'in-out' }, h('span', { class: 'in-out-k' }, '外へ出る口'), h('ul', {}, ...outs)));
  return box;
}

function toggleLens(paperId) {
  if (state.open.has(paperId)) {
    state.open.delete(paperId);
    // closing a paper closes the papers inside it too
    for (const b of Object.values(story(paperId).boxes)) if (b.paper) state.open.delete(b.paper);
  } else state.open.add(paperId);
  const y = window.scrollY;
  layoutPages();
  window.scrollTo(0, y);
  writeHash();
  if (state.open.has(paperId)) {
    // bring the lens that opened it just under the bar on top, so both it and the paper show
    setTimeout(() => {
      const lens = document.querySelector(`.p-lens[data-paper="${CSS.escape(paperId)}"]`);
      if (!lens) return;
      const r = lens.getBoundingClientRect();
      const y = window.scrollY + r.top - headerHeight() - 14;
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (Math.abs(r.top - headerHeight() - 14) > 4) window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
    }, 60);
  }
}

// The bar on top covers this much of the page while it scrolls (none when it is not sticky).
function headerHeight() {
  const top = $('#top');
  return top && getComputedStyle(top).position === 'sticky' ? top.offsetHeight : 0;
}

// ---------- the reader: one panel at a time ----------
const reader = { story: null, i: 0, trail: [] };

function seqOf(st) {
  // main steps in order, each followed by the other ways that replace it
  const out = [];
  for (const s of st.main) { out.push(s); for (const a of st.alts) if (a.alt.at === s.i) out.push(a); }
  return out;
}

function openReader(storyId, i, trail) {
  reader.story = storyId; reader.i = i; reader.trail = trail || [];
  const r = $('#reader');
  r.hidden = false;
  document.body.classList.add('reading');
  renderReader();
  $('#r-next').focus({ preventScroll: true });
}
function closeReader() {
  // back to the panel that was being read: itself when it is on the page (an open paper),
  // else the panel whose paper it was in
  const places = [{ story: reader.story, i: reader.i }, ...[...reader.trail].reverse()];
  $('#reader').hidden = true;
  reader.story = null;
  reader.trail = [];
  writeHash();
  document.body.classList.remove('reading');
  for (let i = panels.length - 1; i >= 0; i--) if (panels[i].big) panels.splice(i, 1);
  for (const at of places) {
    const pp = panels.find((x) => !x.big && x.el.isConnected && x.st.id === at.story && x.s.i === at.i);
    if (!pp) continue;
    pp.el.scrollIntoView({ block: 'center' });
    pp.el.focus({ preventScroll: true });
    pp.el.classList.remove('flash'); void pp.el.offsetWidth; pp.el.classList.add('flash');
    break;
  }
}

function renderReader() {
  const st = story(reader.story);
  writeHash();
  const seq = seqOf(st);
  const k = seq.findIndex((s) => s.i === reader.i);
  const s = seq[k];
  for (let i = panels.length - 1; i >= 0; i--) if (panels[i].big) panels.splice(i, 1);
  // crumbs
  const crumbs = $('#r-crumbs');
  crumbs.innerHTML = '';
  const root = reader.trail.length ? reader.trail[0].story : st.id;
  const ep = EPISODES.find((e) => e.id === root);
  const parts = [];
  if (ep) parts.push(h('span', { class: 'cr-ep' }, `${ep.no}「${ep.tab}」`));
  reader.trail.forEach((t, n) => {
    const ts = story(t.story);
    const sNo = ts.steps[t.i].no;
    parts.push(h('button', { class: 'cr', type: 'button', onclick: () => { const back = reader.trail.slice(0, n); openReader(t.story, t.i, back); } }, `${n === 0 ? '' : ts.tab + ' の中 '}${sNo}`));
  });
  if (reader.trail.length) parts.push(h('span', { class: 'cr-cur' }, `${st.tab} の中`));
  crumbs.append(...parts.flatMap((p, i) => (i ? [h('span', { class: 'cr-sep', 'aria-hidden': 'true' }, '›'), p] : [p])));
  $('#r-count').textContent = `${s.no}　（${k + 1} / ${seq.length}）`;
  $('#r-prev').disabled = k === 0;
  const atEnd = k === seq.length - 1;
  const exit = atEnd && reader.trail.length ? exitTarget(reader.trail, st.id, s.i) : null;
  $('#r-next').disabled = atEnd && !exit;
  $('#r-next').textContent = exit ? `外の ${story(exit.story).steps[exit.i].no} へ ↩` : '次 →';
  $('#r-next').title = exit ? `紙の外へ戻り、${story(exit.story).steps[exit.i].no} を読む（→）` : '次のコマ（→）';

  // stage
  const stage = $('#r-stage');
  stage.innerHTML = '';
  const tm = reader.trail.length ? {} : traceMatches(st.id);
  const big = panelEl(st, s, { big: true, trace: tm });
  stage.append(big);
  if (s.branches) stage.append(forkNote(s));
  const lens = st.lenses[s.i];
  const acts = h('div', { class: 'stage-acts' });
  if (lens) {
    const ps = story(lens.paper);
    acts.append(h('button', { class: 'btn primary zoom-in', type: 'button', onclick: () => openReader(ps.id, ps.main[0].i, [...reader.trail, { story: st.id, i: s.i }]) },
      h('span', { class: 'lens-glass sm', 'aria-hidden': 'true' }), `${lens.box.title} の中をのぞく（${ps.main.length} コマ）`));
  }
  // the last main panel of a paper, when "もしも" panels follow it: a way out along the main path
  if (reader.trail.length && !atEnd && s.main && st.main[st.main.length - 1] === s) {
    const out = exitTarget(reader.trail, st.id, s.i);
    if (out) {
      const os = story(out.story).steps[out.i];
      acts.append(h('button', { class: 'btn', type: 'button', onclick: () => { reader.trail = out.trail; reader.story = out.story; reader.i = out.i; renderReader(); } },
        `ここで外へ：${os.no}「${os.verb || os.data?.label || ''}」へ ↩`));
    }
  }
  if (acts.childNodes.length) stage.append(acts);

  // notes
  const notes = $('#r-notes');
  notes.innerHTML = '';
  notes.append(h('div', { class: 'n-kind' }, h('span', { class: `kchip k-${s.kind}` }, KIND_NAME[s.kind] || s.kind),
    !s.main ? h('span', { class: 'kchip alt' }, `もしも ${s.alt.when}（${s.altOf.no} の代わり）`) : null));
  notes.append(h('h2', { class: 'n-title' }, codeText(s.label)));
  notes.append(miniMap(st, s));
  // who
  const who = h('div', { class: 'n-who' });
  for (const [role, b] of [['渡す', s.A], ['受け取る', s.B]]) who.append(personNote(role, b, st));
  notes.append(section('だれが', who));
  if (s.data) notes.append(section('渡すもの', dataNote(s.data)));
  if (s.branches) {
    const ul = h('ul', { class: 'n-branches' });
    for (const [c, t] of s.branches) ul.append(h('li', { class: (t || '').includes(`[[${s.B.node}]]`) ? 'hit' : '' }, h('span', {}, richText(c)), ' → ', h('span', {}, richText(t))));
    notes.append(section('分かれ道', ul));
  }
  const alts = st.alts.filter((a) => a.alt.at === s.i);
  if (alts.length) {
    notes.append(section('もしも', h('ul', { class: 'n-alts' }, ...alts.map((a) => h('li', {}, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { reader.i = a.i; renderReader(); } }, a.no), ` ${a.alt.when}なら：${a.label}`)))));
  }
  const tr = tm[s.i];
  if (tr) {
    const app = traceApp(tr.trace);
    const own = (st.regions.find((r) => r.node === 'ctx.user')?.label || '').replace(/のプロセス.*$/, '');
    notes.append(section('実録', h('div', { class: 'n-trace' },
      h('p', {}, `記録「${tr.trace.title}」では、`, h('b', {}, `${fmt(tr.ev.instr)} 命令目`), `に `, h('code', {}, tr.ev.fn), ` に入った（${threadLabel(tr.thread)}）。`),
      tr.prev ? h('p', {}, '直前に入った関数：', h('code', {}, tr.prev.fn), tr.missed.length ? h('span', { class: 'diff' }, `（この手順の文にある ${tr.missed.join('・')} は、記録では通っていない）`) : null) : null,
      h('p', { class: 'muted' }, `${app ? `この記録は ${app} のもので、` : ''}${own && own !== app ? `${own}のものではない。` : ''}ここまでの関数は、同じ順に通っている。`))));
  }
  const c = codeOf(st.id, s);
  if (c) notes.append(section('コード', codeBlock(c)));
  notes.scrollTop = 0;

  // strip
  const strip = $('#r-strip');
  strip.innerHTML = '';
  for (const x of seq) {
    strip.append(h('button', {
      class: 'thumb' + (x.i === s.i ? ' on' : '') + (x.main ? '' : ' alt'), type: 'button',
      onclick: () => { reader.i = x.i; renderReader(); }, 'aria-current': x.i === s.i ? 'step' : null,
      title: x.label,
    }, h('span', { class: 'th-no' }, x.no), h('span', { class: 'th-v' }, x.verb || (x.data ? x.data.label : KIND_NAME[x.kind]))));
  }
  strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  requestAnimationFrame(() => { const b = panels.find((x) => x.big); if (b) { drawPanel(b); drawFrame(b); } });
}

// Where the two are in the whole cast: floors as rows, the two of this panel marked.
function miniMap(st, s) {
  // the name column is as wide as the longest floor name, so no name breaks
  const nw = Math.ceil(Math.max(...st.levels.map((l) => measure(l.name, '800 11px system-ui, sans-serif')))) + 18;
  const box = h('div', { class: 'mini', 'aria-label': 'このコマの 2 人がいる所', style: `--nw:${Math.max(70, nw)}px` });
  const order = [];
  for (const x of st.steps) for (const id of [x.from, x.to]) if (!order.includes(id)) order.push(id);
  st.levels.forEach((lev, li) => {
    const here = order.map((id) => st.boxes[id]).filter((b) => b.level === li);
    const row = h('div', { class: `mini-row L-${lev.tone}${here.length ? '' : ' empty'}` }, h('span', { class: 'mini-name' }, lev.name));
    const chips = h('span', { class: 'mini-chips' });
    for (const b of here) {
      const role = b.id === s.from ? 'from' : b.id === s.to ? 'to' : '';
      chips.append(h('span', { class: `mini-chip ${role}`, title: nodeName(b.node) },
        role ? h('i', {}, role === 'from' ? '渡す' : '受け取る') : null, b.short || b.title));
    }
    row.append(chips);
    box.append(row);
  });
  return box;
}

function section(title, body) {
  return h('section', { class: 'n-sec' }, h('h3', {}, title), body);
}

function personNote(role, b, st) {
  const n = b.n || {};
  const wrap = h('div', { class: `n-person L-${b.tone}` });
  const head = h('div', { class: 'np-head' },
    h('span', { class: 'np-role' }, role),
    h('span', { class: 'np-layer' }, st.levels[b.level]?.name || ''),
    b.region ? h('span', { class: 'np-ctx' }, shortRegion(b.region)) : null);
  wrap.append(head);
  wrap.append(h('div', { class: 'np-name' }, h('code', {}, nodeName(b.node)), n.kind ? h('span', { class: 'np-kind' }, NODE_KIND_NAME[n.kind] || n.kind) : null));
  if (n.text) {
    const first = n.text.split('\n')[0];
    wrap.append(h('p', { class: 'np-text' }, richText(first)));
  }
  if (n.api?.sig) wrap.append(h('pre', { class: 'np-sig' }, n.api.sig));
  return wrap;
}

function dataNote(d) {
  const wrap = h('div', { class: 'n-data' });
  wrap.append(h('div', { class: 'nd-head' }, h('code', { class: 'nd-label' }, d.label), d.type ? h('span', { class: 'nd-type' }, d.type) : null));
  if (d.note) wrap.append(h('p', { class: 'nd-note' }, richText(d.note)));
  const sch = d.schema ? NODES[d.schema] : null;
  if (sch?.fields?.length) {
    const hot = new Set((d.fields || []).map((f) => f.replace(/\[.*$/, '')));
    const isHot = (name) => hot.has(name) || hot.has(name.replace(/\[.*$/, ''));
    const tb = h('table', { class: 'nd-fields' });
    tb.append(h('caption', {}, `${sch.title} の中身`, d.fields?.length ? h('span', { class: 'muted' }, '（色つきの行がこのコマで大事なもの）') : null));
    for (const f of sch.fields) {
      const [type, name, meaning] = f.length === 3 ? f : ['', f[0], f[1] || ''];
      tb.append(h('tr', { class: isHot(name) ? 'hot' : '' }, h('td', { class: 'ty' }, type), h('td', { class: 'nm' }, name), h('td', { class: 'mn' }, plain(meaning || ''))));
    }
    wrap.append(tb);
  }
  return wrap;
}

const srcCache = new Map();
function codeBlock(c) {
  const box = h('div', { class: 'code' });
  box.append(h('div', { class: 'code-path' }, h('code', {}, `${c.path}:${c.line}`), c.exact ? h('span', { class: 'muted' }, 'この手順の行') : h('span', { class: 'muted' }, `${nodeName(c.node)} の定義`)));
  const pre = h('pre', { class: 'code-src' }, '…');
  box.append(pre);
  const load = srcCache.get(c.path) || fetch(`../data/src/${c.path}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
  srcCache.set(c.path, load);
  load.then((txt) => {
    const lines = txt.split('\n');
    const from = Math.max(1, c.line - (c.exact ? 4 : 1));
    const to = Math.min(lines.length, c.exact ? c.line + 5 : Math.min(c.end || c.line + 10, c.line + 12));
    pre.innerHTML = '';
    for (let i = from; i <= to; i++) {
      pre.append(h('span', { class: 'ln' + (i === c.line ? ' at' : '') }, h('span', { class: 'lno' }, String(i)), lines[i - 1] + '\n'));
    }
  }).catch(() => { pre.textContent = '（ソースを読めなかった）'; });
  return box;
}

// ---------- node popover ----------
function showPop(btn) {
  const id = btn.dataset.node, n = NODES[id];
  if (!n) return;
  const pop = $('#pop');
  pop.innerHTML = '';
  pop.append(h('div', { class: `pop-head L-${n.layer}` }, h('code', {}, nodeName(id)), h('span', { class: 'np-kind' }, `${LAYER_BY_ID[n.layer]?.name || ''}・${NODE_KIND_NAME[n.kind] || n.kind}`)));
  pop.append(h('p', {}, richText(n.text, { embeds: true })));
  if (n.api?.sig) pop.append(h('pre', { class: 'np-sig' }, n.api.sig));
  if (n.fields?.length) {
    const tb = h('table', { class: 'nd-fields' });
    for (const f of n.fields) { const [ty, nm, mn] = f.length === 3 ? f : ['', f[0], f[1]]; tb.append(h('tr', {}, h('td', { class: 'ty' }, ty), h('td', { class: 'nm' }, nm), h('td', { class: 'mn' }, plain(mn || '')))); }
    pop.append(tb);
  }
  if (n.values?.length) pop.append(h('ul', { class: 'vals' }, ...n.values.map(([v, m]) => h('li', {}, h('code', {}, v), m ? ' ' + plain(m) : ''))));
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  const pw = Math.min(420, window.innerWidth - 24);
  pop.style.width = pw + 'px';
  let x = Math.min(window.innerWidth - pw - 12, Math.max(12, r.left));
  let y = r.bottom + 8;
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  const ph = pop.getBoundingClientRect().height;
  if (y + ph > window.innerHeight - 12) pop.style.top = Math.max(12, r.top - ph - 8) + 'px';
}
function hidePop() { $('#pop').hidden = true; }

// ---------- help ----------
function buildHelp() {
  const g = $('#help-grid');
  const groups = [
    ['床と壁', [
      ['floor', '床', 'キャラクターが立つ床の色と名前が層。段になっていれば、層をまたぐ手順。段の横に見える帯は、通り過ぎる層'],
      ['wall', '点線の壁', '実行の文脈（どのスレッド・どの権限で走るか）が変わるところ'],
    ]],
    ['ふきだし', [
      ['talk', 'ふつう', '話している方がすること'],
      ['shout', 'トゲトゲ', '割り込み・通知。置き場や機械から出る音もこれ'],
      ['call', '太い角枠', 'OS_CALL（アプリから OS へ入る syscall）'],
    ]],
    ['手渡す物', [
      ['letter', '封筒', 'Request や Event。下の小さな字は、このコマで大事な中身'],
      ['doc', '書類', 'ProcStats などの構造体'],
      ['tag', '札', 'アドレスだけ。中身は渡らない'],
      ['str', '字の札', '文字列（s0・s1 が指す文字）'],
      ['words', '束', '語の並び（Request を詰めた 24 語）'],
      ['token', '丸札', '数（i32・spent・% など）'],
    ]],
    ['矢印', [
      ['arrow-call', '実線', '呼び出し'],
      ['arrow-return', '破線', '戻り・返事'],
      ['arrow-msg', '一点鎖線', '列を通す'],
      ['arrow-signal', 'ギザギザ', '割り込み・通知'],
      ['arrow-data', '点線', '値を読む・書く'],
    ]],
  ];
  for (const [title, items] of groups) {
    const sec = h('div', { class: 'help-group' }, h('h3', {}, title));
    for (const [icon, k, v] of items) sec.append(h('div', { class: 'help-item' }, legendIcon(icon), h('div', {}, h('b', {}, k), h('p', {}, v))));
    g.append(sec);
  }
  g.append(h('div', { class: 'help-group wide' }, h('h3', {}, 'ほか'),
    h('div', { class: 'help-rows' },
      h('div', { class: 'help-item plain' }, h('div', {}, h('b', {}, 'コマの番号'), h('p', {}, '番号の順に、左から右・上から下へ読む。「もし」は、その番号の代わりに起こること'))),
      h('div', { class: 'help-item plain' }, h('div', {}, h('b', {}, '虫めがね'), h('p', {}, 'その関数の中の紙を、すぐ下に開く。中のコマも同じ読み方'))),
      h('div', { class: 'help-item plain' }, h('div', {}, h('b', {}, '道のり'), h('p', {}, '表紙の帯。1 列が 1 コマで、どの層からどの層へ動くか。番号を押すとそのコマへ'))),
      h('div', { class: 'help-item plain' }, h('div', {}, h('b', {}, '実録'), h('p', {}, `記録した 1 回の実行（${ATLAS.traces?.[0]?.title || ''}）で、その関数に入った時（命令の数）。押すと、おまけ「実録」のその所へ`))),
      h('div', { class: 'help-item plain' }, h('div', {}, h('b', {}, 'キー'), h('p', {}, '← → でコマを移る。Enter で大きく読む、Esc で閉じる'))))));
}
function closeHelp() { $('#help').hidden = true; $('#btn-help').setAttribute('aria-expanded', 'false'); }
function openHelp() {
  $('#help').hidden = false;
  $('#btn-help').setAttribute('aria-expanded', 'true');
  $('#help-close').focus({ preventScroll: true });
}

// ---------- navigation ----------
function writeHash() {
  const p = new URLSearchParams();
  p.set('ep', state.ep);
  if (state.open.size) p.set('open', [...state.open].join(','));
  if (reader.story && !$('#reader').hidden) {
    p.set('read', `${reader.story}:${reader.i}`);
    if (reader.trail.length) p.set('trail', reader.trail.map((t) => `${t.story}:${t.i}`).join(','));
  }
  history.replaceState(null, '', '#' + decodeURIComponent(p.toString()));
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const ep = p.get('ep');
  if (ep && EPISODES.some((e) => e.id === ep)) state.ep = ep;
  const open = p.get('open');
  if (open) for (const id of open.split(',')) if (ATLAS.papers[id]) state.open.add(id);
  return p;
}
function go(epId, top) {
  state.ep = epId; state.filter = null;
  buildEpisode();
  writeHash();
  if (top) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function init() {
  const nav = $('#eps');
  for (const e of EPISODES) {
    nav.append(h('button', { type: 'button', class: 'ep', 'data-ep': e.id, onclick: () => go(e.id, true) },
      h('span', { class: 'ep-n' }, e.no), h('span', { class: 'ep-t' }, e.tab)));
  }
  buildHelp();
  const p = readHash();
  buildEpisode();

  $('#btn-help').addEventListener('click', () => { if ($('#help').hidden) openHelp(); else closeHelp(); });
  $('#help-close').addEventListener('click', () => { closeHelp(); $('#btn-help').focus({ preventScroll: true }); });
  $('#btn-reader').addEventListener('click', () => {
    if (state.ep === 'trace') return;
    const st = story(state.ep);
    openReader(st.id, st.main[0].i);
  });
  $('#r-close').addEventListener('click', closeReader);
  $('#r-prev').addEventListener('click', () => step(-1));
  $('#r-next').addEventListener('click', () => step(1));

  document.addEventListener('click', (e) => {
    if (!$('#help').hidden && !e.target.closest('#help, #btn-help')) closeHelp();
    const nl = e.target.closest('button.nl');
    if (nl) { e.preventDefault(); e.stopPropagation(); showPop(nl); return; }
    if (!e.target.closest('#pop')) hidePop();
    const lens = e.target.closest('.p-lens, [data-close]');
    if (lens) { e.stopPropagation(); toggleLens(lens.dataset.paper); return; }
    const rec = e.target.closest('.p-rec[data-seq]');
    if (rec) { e.stopPropagation(); if (!$('#reader').hidden) closeReader(); showInTrace(Number(rec.dataset.seq)); return; }
    const panel = e.target.closest('.panel:not(.big)');
    if (panel && !e.target.closest('button')) openReader(panel.dataset.story, Number(panel.dataset.i));
  });
  document.addEventListener('keydown', (e) => {
    if (!$('#pop').hidden && e.key === 'Escape') { hidePop(); return; }
    if (!$('#help').hidden && e.key === 'Escape') { closeHelp(); return; }
    if (!$('#reader').hidden) {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); if (reader.trail.length) outOfPaper(); else closeReader(); }
      return;
    }
    const act = document.activeElement;
    if (act?.classList.contains('panel') && !act.classList.contains('big')) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReader(act.dataset.story, Number(act.dataset.i)); return; }
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        // move along the reading order of the same story
        const list = [...document.querySelectorAll(`.panel:not(.big)[data-story="${CSS.escape(act.dataset.story)}"]`)];
        const k = list.indexOf(act) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
        if (list[k]) { e.preventDefault(); list[k].focus(); list[k].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      }
    }
  });
  const ro = new ResizeObserver(() => {
    const pages = $('#pages');
    if (pages && colsFor(pages.clientWidth) !== lastCols) layoutPages();
    else drawAll();
  });
  ro.observe($('#sheet'));
  window.addEventListener('resize', () => { if (!$('#reader').hidden) { const b = panels.find((x) => x.big); if (b) { b.key = null; drawPanel(b); drawFrame(b); } } });

  // a page opened with #read=story:i goes straight to the reader (used for pictures)
  const rd = p.get('read');
  if (rd) {
    const [sid, i] = rd.split(':');
    const trail = (p.get('trail') || '').split(',').filter(Boolean).map((t) => { const [a, b] = t.split(':'); return { story: a, i: Number(b) }; });
    if (story(sid)) setTimeout(() => openReader(sid, Number(i), trail), 30);
  }
  const f = p.get('filter');
  if (f && NODES[f]) setFilter(f);
}

// Opens おまけ「実録」 at one event of the run: its panel scrolled into view, the event marked.
function showInTrace(seq) {
  go('trace', true);
  requestAnimationFrame(() => {
    const li = document.querySelector(`.beats > li[data-seq="${seq}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'center' });
    li.classList.remove('spot'); void li.offsetWidth; li.classList.add('spot');
  });
}

function step(d) {
  const st = story(reader.story);
  const seq = seqOf(st);
  const k = seq.findIndex((s) => s.i === reader.i);
  const n = k + d;
  if (n >= 0 && n < seq.length) { reader.i = seq[n].i; renderReader(); }
  else if (n >= seq.length && reader.trail.length) outOfPaper(true);
}

// Where reading goes on after the last panel of a paper. A "もしも" that ends at one of the paper's
// exits (its ports) continues at the outer step that exit leads to (gateway's "full" → the outer
// もしA). The main path continues with the next main panel after the one the paper opened from,
// leaving the outer paper too when it has none.
function exitTarget(trail, innerId, innerI) {
  let t = [...trail];
  let inner = story(innerId), s = inner.steps[innerI];
  while (t.length) {
    const at = t[t.length - 1];
    const outer = story(at.story);
    const lens = outer.lenses[at.i];
    const rest = t.slice(0, -1);
    if (s && !s.main && lens) {
      for (const [outerNode, box] of Object.entries(inner.src.ports || {})) {
        if (box !== s.to) continue;
        const ob = Object.values(outer.boxes).find((b) => b.node === outerNode);
        const os = ob && outer.steps.find((x) => x.from === lens.box.id && x.to === ob.id);
        if (os) return { trail: rest, story: outer.id, i: os.i };
      }
    }
    const k = outer.main.findIndex((x) => x.i === at.i);
    if (k >= 0 && k + 1 < outer.main.length) return { trail: rest, story: outer.id, i: outer.main[k + 1].i };
    inner = outer; s = outer.steps[at.i]; t = rest;
  }
  return null;
}

function outOfPaper(forward) {
  const out = forward ? exitTarget(reader.trail, reader.story, reader.i) : null;
  if (out) { reader.trail = out.trail; reader.story = out.story; reader.i = out.i; renderReader(); return; }
  const t = reader.trail[reader.trail.length - 1];
  reader.trail = reader.trail.slice(0, -1);
  reader.story = t.story; reader.i = t.i;
  renderReader();
}

document.fonts.ready.then(init);
