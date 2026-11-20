// おまけ「実録」: the recorded run drawn as a comic. A panel is one stretch of one thread, from a
// switch to the next; inside, the functions it entered in order, interrupts as sound effects.
// Only what the trace records is shown.
import { ATLAS, NODES, story } from './model.js';

// threads get their own colours: the app's thread in the app colour, the first OS thread in the OS colour
const toneCache = new Map();
const THREAD_TONE = (name) => {
  if (toneCache.has(name)) return toneCache.get(name);
  let t;
  if (/idle/.test(name)) t = 'idle';
  else if (!name.startsWith('kernel:')) t = 'app';
  else t = [...toneCache.values()].includes('os') ? 'os2' : 'os';
  toneCache.set(name, t);
  return t;
};

export function buildTrace({ h, nodeName, threadLabel, fmt, toPanel }) {
  const tr = ATLAS.traces[0];
  const flow = ATLAS.flows.find((f) => tr.id.split('-')[0] === f.id);
  const st = flow ? story(flow.id) : null;
  // which comic panel each node plays in (as the one receiving the step)
  const panelOf = {};
  if (st) for (const s of st.main) { (panelOf[s.B.node] ||= []).push(s); }
  const epNo = st ? `第${ATLAS.flows.indexOf(flow) + 1}話` : '';

  // runs between switches
  const runs = [];
  let cur = null;
  for (const e of tr.events) {
    if (!cur || e.ev === 'switch' || e.thread !== cur.thread) {
      cur = { thread: e.thread, start: e.instr, events: [] };
      runs.push(cur);
    }
    if (e.ev !== 'switch') cur.events.push(e);
  }
  const last = tr.events[tr.events.length - 1].instr;
  runs.forEach((r, i) => { r.end = i + 1 < runs.length ? runs[i + 1].start : last; r.no = i + 1; });
  const name = (t) => tr.threads[String(t)] || String(t);
  toneCache.clear();
  for (const r of runs) THREAD_TONE(name(r.thread));

  const root = h('div', { class: 'trace' });

  // ----- cover -----
  const run = tr.run || {};
  const cover = h('section', { class: 'cover tcover', 'aria-label': '表紙' });
  const left = h('div', { class: 'cover-text' },
    h('div', { class: 'ep-no' }, h('span', {}, 'おまけ'), h('span', { class: 'ep-tab' }, '実録')),
    h('h1', { class: 'ep-title' }, tr.title),
    h('p', { class: 'ep-meta' },
      h('span', {}, `${runs.length} コマ`),
      h('span', {}, `${fmt(last)} 命令ぶん`),
      tr.date ? h('span', { class: 'alt' }, tr.date.replace('T', ' ').slice(0, 16)) : null),
    h('ol', { class: 'how' },
      h('li', {}, h('b', {}, '1 コマ'), 'は、1 つのスレッドが続けて走った間'),
      h('li', {}, h('b', {}, 'トゲトゲ'), 'は割り込み、', h('b', {}, '角枠'), 'は syscall（OS_CALL など）。どちらもここでカーネルに入る'),
      st ? h('li', {}, h('b', {}, '番号札'), `は、${epNo}のそのコマに出てくる関数。押すとそのコマへ`) : null,
      h('li', {}, h('b', {}, '帯'), 'で、どのスレッドがいつ走ったかを見渡せる。押すとそのコマへ')),
  );
  cover.append(left);
  const right = h('div', { class: 'tc-right' });
  if (run.before && run.after) {
    const rows = [['文字', 'text'], ['題名', 'title'], ['位置', 'position']];
    const tb = h('table', { class: 'ba' },
      h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, '打つ前'), h('th', { class: 'arr' }, ''), h('th', {}, '打った後'))));
    const body = h('tbody');
    for (const [label, k] of rows) {
      const a = run.before[k] ?? '', b = run.after[k] ?? '';
      body.append(h('tr', { class: a !== b ? 'chg' : '' }, h('th', {}, label), h('td', {}, h('code', {}, a === '' ? '（空）' : a)), h('td', { class: 'arr' }, '→'), h('td', {}, h('code', {}, b === '' ? '（空）' : b))));
    }
    tb.append(body);
    right.append(h('div', { class: 'tc-ba' }, h('div', { class: 'tc-k' }, run.typed ? `「${run.typed}」を 1 回打つと` : '打つ前と後'), tb));
  }
  // the whole run as one ribbon, a segment per panel
  const ribbon = h('div', { class: 'ribbon', role: 'list', 'aria-label': 'どのスレッドがいつ走ったか' });
  for (const r of runs) {
    const w = Math.max(0.6, ((r.end - r.start) / last) * 100);
    const tone = THREAD_TONE(name(r.thread));
    ribbon.append(h('button', {
      class: `seg t-${tone}`, type: 'button', role: 'listitem', style: `flex-grow:${w}`,
      title: `${r.no}：${threadLabel(name(r.thread))} ${fmt(r.start)}〜${fmt(r.end)} 命令目`,
      onclick: () => document.getElementById(`run-${r.no}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    }, (r.end - r.start) / last > 0.045 ? String(r.no) : ''));
  }
  const legend = h('div', { class: 'legend' });
  const seen = new Set();
  for (const r of runs) {
    const nm = name(r.thread);
    if (seen.has(nm)) continue;
    seen.add(nm);
    legend.append(h('span', { class: `lg t-${THREAD_TONE(nm)}` }, h('i'), threadLabel(nm)));
  }
  right.append(h('div', { class: 'tc-rib' }, h('div', { class: 'tc-k' }, `0〜${fmt(last)} 命令目`), ribbon, legend));
  if (tr.build) {
    right.append(h('div', { class: 'tc-build' }, h('span', { class: 'tc-k' }, '記録した時のコード'),
      ...Object.entries(tr.build).map(([k, v]) => h('span', {}, h('code', {}, k.replace(/^.*\//, '')), ' ', h('code', { class: 'muted' }, v)))));
  }
  cover.append(right);
  root.append(cover);

  // ----- panels -----
  const pages = h('div', { class: 'pages tpages' });
  for (const r of runs) {
    const nm = name(r.thread);
    const tone = THREAD_TONE(nm);
    const p = h('section', { class: `tpanel t-${tone}`, id: `run-${r.no}`, 'aria-label': `${r.no}：${threadLabel(nm)}` });
    p.append(h('div', { class: 'p-no' }, String(r.no)));
    const head = h('div', { class: 'tp-head' },
      h('p', { class: 'p-label' }, tone === 'idle' ? [h('b', {}, '走るものが無い'), '（idle）間'] : [h('b', {}, threadLabel(nm)), ' が走る']),
      h('div', { class: 'p-meta' }, h('span', {}, `${fmt(r.start)}〜${fmt(r.end)} 命令目`), h('span', { class: 'muted' }, `（${fmt(r.end - r.start)} 命令）`)));
    p.append(head);
    // where in the whole run
    const bar = h('div', { class: 'tp-bar', 'aria-hidden': 'true' }, h('i', { style: `left:${(r.start / last) * 100}%;width:${Math.max(0.5, ((r.end - r.start) / last) * 100)}%` }));
    p.append(bar);
    const body = h('div', { class: 'tp-body' });
    body.append(threadActor(h, nm, tone));
    const beats = h('ol', { class: 'beats' });
    r.events.forEach((e, i) => {
      const li = beat(h, e, nodeName, panelOf, r.events[i - 1], (s) => toPanel?.(st.id, s.i), epNo);
      li.dataset.seq = e.seq;
      beats.append(li);
    });
    if (!r.events.length) beats.append(h('li', { class: 'b-none' }, '（記録された関数は無い）'));
    body.append(beats);
    p.append(body);
    pages.append(p);
  }
  root.append(pages);
  root.append(h('div', { class: 'endcard' }, h('span', { class: 'end-k' }, 'おわり'),
    h('span', { class: 'muted' }, `記録の取り方：${ATLAS.how?.trace || ''}`)));
  return root;
}

function threadActor(h, nm, tone) {
  const label = /idle/.test(nm) ? 'idle' : nm.replace(/^kernel:\s*/, '');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', '56'); svg.setAttribute('height', '56');
  svg.setAttribute('class', 'ta-face');
  const sleepy = tone === 'idle';
  svg.innerHTML = `
    <circle cx="32" cy="34" r="22" class="ta-head"/>
    ${sleepy
      ? '<path d="M22 33q4 3 8 0M34 33q4 3 8 0" class="ta-line"/><path d="M28 43q4 2 8 0" class="ta-line"/><text x="50" y="16" class="ta-z">z</text><text x="56" y="8" class="ta-z sm">z</text>'
      : '<ellipse cx="25" cy="31" rx="2.4" ry="3.2" class="ta-eye"/><ellipse cx="39" cy="31" rx="2.4" ry="3.2" class="ta-eye"/><path d="M26 41q6 5 12 0" class="ta-line"/><ellipse cx="19" cy="37" rx="3.4" ry="2" class="ta-cheek"/><ellipse cx="45" cy="37" rx="3.4" ry="2" class="ta-cheek"/>'}
  `;
  const nameEl = h('code', { class: 'ta-name' });
  label.split('.').forEach((part, i, all) => { nameEl.append(part + (i < all.length - 1 ? '.' : '')); if (i < all.length - 1) nameEl.append(h('wbr')); });
  return h('div', { class: 'actor' }, svg, nameEl);
}

function beat(h, e, nodeName, panelOf, before, toPanel, epNo) {
  if (e.ev === 'irq') {
    const cause = (e.cause || []).join('・');
    const isCall = cause === 'syscall';
    if (isCall && e.service) {
      // OS_CALL: the trace names the service
      return h('li', { class: 'b-irq call', title: `syscall OS_CALL、service ${e.service}` }, h('span', { class: 'bw' }, h('span', { class: 'burst' }, `OS_CALL(${e.service})`)));
    }
    if (isCall) {
      // another syscall: the trace names no service, so it is not called OS_CALL here; the function
      // the program was in just before says which one
      const from = before && before.program !== 'kernel' && before.fn ? before.fn : '';
      return h('li', { class: 'b-irq sys', title: from ? `syscall（${from} から）` : 'syscall' },
        h('span', { class: 'bw' }, h('span', { class: 'burst' }, 'syscall', from ? h('small', {}, `${from} から`) : null)));
    }
    return h('li', { class: 'b-irq' }, h('span', { class: 'bw' }, h('span', { class: 'burst' }, `割り込み：${cause}`)));
  }
  if (e.ev === 'request') {
    return h('li', { class: 'b-req' }, h('span', { class: 'req-k' }, '外から'), h('code', {}, e.method));
  }
  const n = e.n ? NODES[e.n] : null;
  if (n) {
    const nos = panelOf[e.n];
    // the panel numbers lead back to those panels of the episode
    return h('li', { class: `b-node L-${n.layer}` },
      h('button', { class: 'nl', type: 'button', 'data-node': e.n }, e.fn),
      nos ? h('span', { class: 'b-panel' }, ...nos.map((s) => h('button', {
        type: 'button', title: `${epNo}の ${s.no}：${s.label}`, 'aria-label': `${epNo}の ${s.no} のコマへ`, onclick: () => toPanel(s),
      }, s.no))) : null);
  }
  return h('li', { class: 'b-fn' }, h('code', {}, e.fn || e.ev));
}

