// The chrome around the map: flow switcher, search, overlays menu, step card, breadcrumb, zoom ladder, spine.
import {
  NODES, IDS, LAYER, STACK, FLOWS, PAPERS, KIND_NAME, EDGE_KIND, boxOf, plain, LINK_RE, stepNo, stepOrder,
  codeOf, splitPath, PAPER_PARENT, CONTEXT_OF, runOf, RUN_NAME, TRACE, TRACE_COUNT, isPaper,
} from './model.js';
import { stepSpot } from './code.js';
import { layerColor, T } from './theme.js';
import { isCodeName } from './text.js';
import { EVENTS, NODE_EVENTS, describe, drawTimeline, eventAtX, threadShort, threadColor, MAX_INSTR } from './trace.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function richHtml(s) {
  let out = '', last = 0;
  const str = String(s || '');
  for (const m of str.matchAll(LINK_RE)) {
    out += esc(str.slice(last, m.index));
    const n = NODES[m[1]];
    out += n ? `<a class="inl${isCodeName(n.title) ? ' code-inl' : ''}" data-node="${m[1]}">${esc(n.title)}</a>` : esc(m[1]);
    last = m.index + m[0].length;
  }
  return out + esc(str.slice(last));
}
const sw = (layer) => `<i class="sw" style="background:${layerColor(layer)}"></i>`;
const nodeChip = (id) => {
  const n = NODES[id];
  return `<span class="chip link${isCodeName(n.title) ? ' code' : ''}" data-node="${id}" role="button" tabindex="0">${sw(n.layer)}${esc(n.title)}</span>`;
};
const ICON = {
  play: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7zM14 4h4v16h-4z" fill="currentColor" stroke="none"/></svg>',
  prev: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  up: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  fit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  rec: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></svg>',
};

// ---- Flow switcher ----
export function buildFlowSeg(app) {
  const seg = $('#flowSeg');
  seg.innerHTML = FLOWS.map((f) => `<button type="button" data-flow="${f.id}" aria-pressed="false"><span class="dot"></span>${esc(f.tab)}</button>`).join('');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-flow]');
    if (!b) return;
    if (app.state.flowId === b.dataset.flow && !app.state.paper) app.setFlow(null); else app.setFlow(b.dataset.flow);
  });
}
export function syncFlowSeg(app) {
  for (const b of document.querySelectorAll('#flowSeg button')) b.setAttribute('aria-pressed', String(app.state.flowId === b.dataset.flow));
}

// ---- Overlays ----
const OVERLAYS = [
  { id: 'context', t: '実行の文脈', d: '流れの中で、その箱がどの文脈で走るか。色は走るスレッド、点線はカーネルの中。', legend: true },
  { id: 'contract', t: '契約のつながり', d: '契約（データの形）を使っている所へ線を引く。契約の箱に触れると、その 1 つだけが太く出る。' },
  { id: 'policy', t: '方針の境界', d: 'ライブラリと OS の間の決まり：SDK は MyOS を import しない。' },
  { id: 'trace', t: '記録の熱', d: '' },
];
export function buildLayersMenu(app) {
  const menu = $('#layersMenu'), btn = $('#layersBtn');
  const traceDesc = TRACE ? `記録「${TRACE.title}」で、その関数に入った回数を赤い熱で示す。` : '';
  menu.innerHTML = `<h2>地図に重ねる</h2>` + OVERLAYS.map((o) => `<label><input type="checkbox" data-ov="${o.id}"${app.state.overlays[o.id] ? ' checked' : ''}><span class="lt">${o.t}</span><span class="ld">${esc(o.id === 'trace' ? traceDesc : o.d)}</span>${o.legend ? `<span class="legend"><span><i style="border-color:var(--run-app)"></i>${RUN_NAME.app}</span><span><i style="border-color:var(--run-svc)"></i>${RUN_NAME.svc}</span><span><i style="border-color:var(--run-irq)"></i>${RUN_NAME.irq}</span><span><i class="dash" style="border-color:var(--text-2)"></i>カーネルの中</span></span>` : ''}</label>`).join('');
  btn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
  menu.addEventListener('change', (e) => { const i = e.target.closest('input[data-ov]'); if (i) app.setOverlay(i.dataset.ov, i.checked); });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.layers')) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
}

// ---- Search ----
export function buildSearch(app) {
  const q = $('#q'), list = $('#results');
  const index = IDS.map((id) => {
    const n = NODES[id], c = codeOf(id);
    return { id, title: n.title, hay: [n.title, id, n.fn || '', c ? c.path : '', c && c.symbol || '', plain(n.text)].join('\n').toLowerCase() };
  });
  let results = [], sel = 0;
  const show = () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { list.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
    results = index.map((e) => {
      const t = e.title.toLowerCase();
      const score = t === s ? 0 : t.startsWith(s) ? 1 : t.includes(s) ? 2 : e.id.includes(s) ? 3 : e.hay.includes(s) ? 4 : 9;
      return { e, score };
    }).filter((r) => r.score < 9).sort((a, b) => a.score - b.score || a.e.title.length - b.e.title.length).slice(0, 9).map((r) => r.e.id);
    sel = 0;
    list.innerHTML = results.length ? results.map((id, i) => {
      const n = NODES[id], c = codeOf(id);
      const where = c ? `${splitPath(c.path).repo} › ${splitPath(c.path).rel}` : LAYER[n.layer].name;
      return `<li role="option" data-node="${id}" aria-selected="${i === sel}"><i class="sw" style="background:${layerColor(n.layer)}"></i><span class="t${isCodeName(n.title) ? ' code' : ''}">${esc(n.title)}</span><span class="k">${esc(KIND_NAME[n.kind])}・${esc(LAYER[n.layer].name)}</span><span class="p">${esc(where)}</span></li>`;
    }).join('') : `<li class="empty">見つかりません</li>`;
    list.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  };
  const choose = (id) => { list.hidden = true; q.blur(); app.flyToNode(id, { pulse: true, select: true }); };
  q.addEventListener('input', show);
  q.addEventListener('focus', show);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
    } else if (e.key === 'Enter') { if (results[sel]) choose(results[sel]); }
    else if (e.key === 'Escape') { q.value = ''; list.hidden = true; q.blur(); }
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('li[data-node]'); if (li) { e.preventDefault(); choose(li.dataset.node); } });
  q.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}

// ---- The step card ----
// The card is rebuilt on every step; the control that had the keyboard focus gets it back.
export function renderTour(app) {
  const el = $('#tour');
  const fa = document.activeElement;
  let again = null;
  if (fa && el.contains(fa)) {
    const d = fa.dataset;
    again = d.act ? `[data-act="${d.act}"]` : d.step != null ? `[data-step="${d.step}"]` : d.flow ? `[data-flow="${d.flow}"]` : null;
  }
  buildTour(app, el);
  if (again) {
    const n = el.querySelector(again);
    if (n && !n.disabled) n.focus({ preventScroll: true });
    else { const alt = el.querySelector('[data-act="next"]:not([disabled]), [data-act="prev"]:not([disabled]), [data-act="play"]'); if (alt) alt.focus({ preventScroll: true }); }
  }
}
function buildTour(app, el) {
  const st = app.state;
  if (st.trace) { el.classList.remove('intro'); el.classList.add('trace'); renderTraceTour(app, el); return; }
  el.classList.remove('trace');
  if (!st.flowId) {
    el.classList.add('intro');
    el.innerHTML = `<div class="t-intro"><div class="t-row"><span class="t-lead">流れをたどる</span>${FLOWS.map((f) => `<button type="button" class="t-choice" data-flow="${f.id}"><span class="play">${ICON.play}</span><span class="t-ct"><b>${esc(f.tab)}</b><span>${esc(f.title)}・${f.steps.filter((s) => !s.alt).length}\u00a0手順</span></span></button>`).join('')}${TRACE ? `<button type="button" class="t-choice rec" data-act="trace"><span class="play">${ICON.rec}</span><span class="t-ct"><b>記録を再生</b><span>${esc(TRACE.title)}・${EVENTS.length}\u00a0件</span></span></button>` : ''}</div>
      <p class="t-hint"><b>ホイール・ピンチ</b>で寄るほど、層 → 箱の名前 → 中身 → コードと細かくなる。<b>ドラッグ</b>で動かす。<b>箱を押す</b>とその箱へ。<b>/</b> で探す。</p></div>`;
    return;
  }
  el.classList.remove('intro');
  const P = st.paper;
  const f = P ? PAPERS[P.pid] : FLOWS.find((x) => x.id === st.flowId);
  const i = P ? P.i : st.step;
  const s = f.steps[i];
  const order = stepOrder(f);
  const pos = order.indexOf(i);
  const mainCount = f.steps.filter((x) => !x.alt).length;
  const a = boxOf(f, s.from), b = boxOf(f, s.to);
  const head = P
    ? `<button type="button" class="t-btn" data-act="out" title="外の流れに戻る（Esc）">${ICON.up}外へ</button><span class="t-flow">中の紙：${esc(f.tab)} の中<small>${esc(FLOWS.find((x) => x.id === st.flowId).tab)} の手順 ${stepNo(FLOWS.find((x) => x.id === st.flowId).steps[st.step], st.step)} から</small></span>`
    : `<button type="button" class="t-btn ghost" data-act="close" title="流れを閉じる">${ICON.close}</button><span class="t-flow">${esc(f.tab)}<small>${esc(f.title)}</small></span>`;
  const no = stepNo(s, i);
  let meta = `${nodeChip(a.node)}<span class="arrow">→</span>${nodeChip(b.node)}<span class="chip k-kind">${esc(EDGE_KIND[s.kind] || s.kind)}</span>`;
  if (s.data && s.data.label) {
    const fields = s.data.fields ? `（${s.data.fields.map(esc).join('・')}）` : '';
    meta += s.data.schema && NODES[s.data.schema] ? `<span class="chip data link" data-node="${s.data.schema}">渡す：${esc(s.data.label)}${fields}</span>` : `<span class="chip data">渡す：${esc(s.data.label)}${fields}</span>`;
  }
  if (s.ops) for (const op of s.ops) meta += `<span class="chip link k-ops" data-node="${op.node}">${esc(NODES[op.node].title)}に「${esc(op.kind)}」</span>`;
  const ctx = !P && CONTEXT_OF[a.node];
  if (ctx) meta += `<span class="chip link k-ctx" data-node="${ctx}"><i class="sw" style="background:var(--run-${runOf(ctx)})"></i>${esc(NODES[ctx].title)}</span>`;
  const sc = stepSpot(P ? P.pid : st.flowId, i);
  if (sc) meta += `<span class="chip link code" data-act="code" role="button" tabindex="0" title="${sc.exact ? 'この手順が起きる行へ寄る' : 'この行が見つからないので、箱の定義へ寄る'}">${sc.exact ? 'コード' : '定義'} ${esc(splitPath(sc.path).file)}:${sc.line}</span>`;
  const into = !P && app.paperOf(i);
  if (into) meta += `<span class="chip paper" data-act="in" role="button" tabindex="0">中の紙に入る：${esc(PAPERS[into].tab)} の中 ↵</span>`;
  else if (P && s.kind !== 'return' && s.kind !== 'data' && !s.alt && NODES[boxOf(f, s.to).node].paper && PAPERS[NODES[boxOf(f, s.to).node].paper]) meta += `<span class="chip paper" data-act="in" role="button" tabindex="0">さらに中の紙：${esc(PAPERS[NODES[boxOf(f, s.to).node].paper].tab)} の中 ↵</span>`;
  let extra = '';
  if (s.alt) extra += `<div class="t-alt"><b>もし${esc(s.alt.when)}なら</b>、手順 ${s.alt.at + 1} の代わりにこうなる。</div>`;
  const alts = f.steps.map((x, j) => [x, j]).filter(([x]) => x.alt && x.alt.at === i);
  if (alts.length) extra += `<div class="t-alt">${alts.map(([x, j]) => `<a class="inl" data-step="${j}">もし${esc(x.alt.no)}</a>`).join('・')}：${esc(alts[0][0].alt.when)}の時の別の道</div>`;
  if (s.branches) extra += `<ul class="t-branches">${s.branches.map(([w, t]) => `<li>${richHtml(w)}：${richHtml(t)}</li>`).join('')}</ul>`;
  if (s.data && s.data.note) extra += `<div class="t-alt">${richHtml(s.data.note)}</div>`;
  if (s.data && s.data.type) extra += `<div class="t-alt">型：<span class="code-inl">${esc(s.data.type)}</span></div>`;
  // the data's `start`: the step this flow is about, marked as the featured one
  const feat = f.start && f.start[0];
  const dots = order.map((j) => {
    const x = f.steps[j];
    return `<button type="button" data-step="${j}" class="${x.alt ? 'alt' : ''}${order.indexOf(j) < pos ? ' done' : ''}${j === feat ? ' feat' : ''}" aria-current="${j === i}" title="${esc(x.verb || plain(x.label))}${j === feat ? '（見どころ）' : ''}">${esc(stepNo(x, j))}</button>`;
  }).join('');
  el.innerHTML = `<div class="t-head">${head}
      <span class="t-count">${s.alt ? 'もし' : `${order.filter((j) => !f.steps[j].alt).indexOf(i) + 1} / ${mainCount}`}</span>
      <button type="button" class="t-btn" data-act="prev" title="前へ（←）"${pos <= 0 ? ' disabled' : ''}>${ICON.prev}</button>
      <button type="button" class="t-btn primary" data-act="play" title="順に流す（Space）">${st.playing ? ICON.pause + '<span class="bl">止める</span>' : ICON.play + '<span class="bl">流す</span>'}</button>
      <button type="button" class="t-btn" data-act="next" title="次へ（→）"${pos >= order.length - 1 ? ' disabled' : ''}>${ICON.next}</button>
    </div>
    <div class="t-step"><span class="t-no${s.alt ? ' alt' : P ? ' inner' : ''}">${esc(no)}</span><div class="t-verb">${s.verb ? esc(s.verb) : richHtml(s.label)}${i === feat ? '<span class="t-feat">見どころ</span>' : ''}</div>
      ${s.verb ? `<div class="t-label">${richHtml(s.label)}</div>` : ''}
      <div class="t-meta">${meta}</div>${extra}</div>
    <div class="t-dots">${dots}<span class="gap"></span><label><input type="checkbox" data-act="follow"${st.follow ? ' checked' : ''}>カメラが追う</label><button type="button" class="t-btn ghost" data-act="fit" title="流れ全体を見る">${ICON.fit}全体</button></div>`;
}
// ---- The recorded run ----
function renderTraceTour(app, el) {
  const tr = app.state.trace;
  const run = TRACE.run || {};
  const before = run.before || {}, after = run.after || {};
  el.innerHTML = `<div class="t-head">
      <button type="button" class="t-btn ghost" data-act="trace-close" title="記録を閉じる（Esc）">${ICON.close}</button>
      <span class="t-flow">記録：${esc(TRACE.title)}<small>${esc((TRACE.date || '').replace('T', ' ').slice(0, 16))}</small></span>
      <span class="t-count" id="trCount"></span>
      <button type="button" class="t-btn" data-act="trace-prev" title="前の箱へ（←）">${ICON.prev}</button>
      <button type="button" class="t-btn primary" data-act="trace-play" title="再生（Space）">${tr.playing ? ICON.pause + '止める' : ICON.play + '再生'}</button>
      <button type="button" class="t-btn" data-act="trace-next" title="次の箱へ（→）">${ICON.next}</button>
    </div>
    <div class="t-run">打つ前 <b>${esc(before.title || '')}</b>（${esc(before.position || '')}）<span class="arrow">→</span>「${esc(run.typed || '')}」を打った後 <b>${esc(after.title || '')}</b>（${esc(after.position || '')}）</div>
    <canvas class="t-timeline" id="trTimeline" aria-label="スレッドごとの時間の流れ。押すとその時点へ"></canvas>
    <div class="t-ev" id="trEvent"></div>
    <div class="t-dots"><span class="t-note">地図の上の線は、直前に入った箱から箱への道。箱の右上の数は、ここまでに入った回数。</span><span class="gap"></span><label><input type="checkbox" data-act="trace-follow"${tr.follow ? ' checked' : ''}>カメラが追う</label></div>`;
  updateTraceTour(app);
}
export function updateTraceTour(app) {
  const tr = app.state.trace;
  if (!tr) return;
  const cv = document.getElementById('trTimeline');
  if (!cv) return;
  drawTimeline(cv, tr.i);
  const e = EVENTS[tr.i];
  const d = describe(e);
  document.getElementById('trCount').textContent = `${tr.i + 1} / ${EVENTS.length}`;
  const node = e.n && NODES[e.n] ? `<span class="chip link${isCodeName(NODES[e.n].title) ? ' code' : ''}" data-node="${e.n}">${sw(NODES[e.n].layer)}地図の箱：${esc(NODES[e.n].title)}</span>` : '';
  document.getElementById('trEvent').innerHTML = `<span class="t-no ev${e.n ? ' on' : ''}">${tr.i + 1}</span><div class="t-evbody"><div class="t-evwhat${d.mono ? ' code-inl' : ''}">${esc(d.what)}</div>
    <div class="t-meta"><span class="chip"><i class="sw" style="background:${threadColor(e.thread)}"></i>${esc(TRACE.threads[e.thread] || '')}</span><span class="chip">${e.instr.toLocaleString('ja-JP')} 命令目</span>${e.program ? `<span class="chip">${esc(e.program)}</span>` : ''}<span class="chip">seq ${e.seq}</span>${node}</div></div>`;
}

export function bindTour(app) {
  const el = $('#tour');
  // chips that act like buttons answer Enter and Space too
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); }
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-step],[data-node],[data-flow]');
    if (!t) return;
    if (t.dataset.flow) return app.setFlow(t.dataset.flow);
    if (t.closest('#trTimeline')) return;
    if (t.dataset.node) return app.flyToNode(t.dataset.node, { pulse: true, select: true });
    if (t.dataset.step != null) return app.goStep(Number(t.dataset.step), { user: true });
    const act = t.dataset.act;
    if (act === 'prev') app.stepBy(-1);
    else if (act === 'next') app.stepBy(1);
    else if (act === 'play') app.togglePlay();
    else if (act === 'close') app.setFlow(null);
    else if (act === 'in') app.enterPaper();
    else if (act === 'out') app.leavePaper();
    else if (act === 'code') app.showStepCode();
    else if (act === 'fit') app.fitFlow();
    else if (act === 'trace') app.startTrace();
    else if (act === 'trace-close') app.stopTrace();
    else if (act === 'trace-prev') app.traceStep(-1);
    else if (act === 'trace-next') app.traceStep(1);
    else if (act === 'trace-play') app.traceTogglePlay();
  });
  el.addEventListener('pointerdown', (e) => {
    const cv = e.target.closest('#trTimeline');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const go = (ev) => app.traceGo(eventAtX(cv, ev.clientX - r.left), { user: true });
    go(e);
    const move = (ev) => go(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'follow') app.state.follow = e.target.checked;
    if (e.target.dataset.act === 'trace-follow' && app.state.trace) app.state.trace.follow = e.target.checked;
  });
}

// ---- Breadcrumb: what is in the middle of the screen ----
let lastCrumb = '';
export function renderCrumb(app, here) {
  const el = $('#crumb');
  const parts = [];
  if (here.far) { if (lastCrumb) { lastCrumb = ''; el.innerHTML = ''; } return; }
  if (here.band) parts.push(`<span class="c" data-band="${here.band}"><i class="sw" style="background:${layerColor(here.band)}"></i>${esc(LAYER[here.band].name)}</span>`);
  if (here.group) parts.push(`<span class="c${here.group.label.none ? '' : ' code'}" data-group="${here.groupIndex}">${esc(here.group.label.rel)}</span>`);
  if (here.card) { const n = NODES[here.card]; parts.push(`<span class="c${isCodeName(n.title) ? ' code' : ''}" data-node="${here.card}">${esc(n.title)}</span>`); }
  const html = parts.join('<span class="sep">›</span>');
  if (html === lastCrumb) return;
  lastCrumb = html;
  el.innerHTML = html;
}
export function bindCrumb(app) {
  $('#crumb').addEventListener('click', (e) => {
    const c = e.target.closest('.c');
    if (!c) return;
    if (c.dataset.band) app.fitBand(c.dataset.band);
    else if (c.dataset.group) app.fitGroup(Number(c.dataset.group));
    else if (c.dataset.node) app.flyToNode(c.dataset.node, { select: true });
  });
}

// ---- Zoom ladder ----
export const LEVELS = [
  { id: 'all', t: '全体', k: null },
  { id: 'parts', t: '部品', k: 0.42 },
  { id: 'inside', t: '中身', k: 1.15 },
  { id: 'code', t: 'コード', k: 4.4 },
];
export function levelOf(k) { return k < 0.2 ? 'all' : k < 0.92 ? 'parts' : k < 3.6 ? 'inside' : 'code'; }
export function buildLadder(app) {
  $('#ladderSteps').innerHTML = LEVELS.map((l) => `<li><button type="button" data-level="${l.id}">${l.t}</button></li>`).join('');
  $('#ladder').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.z) app.zoomBy(b.dataset.z === 'in' ? 1.8 : 1 / 1.8);
    else if (b.dataset.level) app.zoomLevel(b.dataset.level);
  });
}
let lastLevel = '';
export function syncLadder(k) {
  const lv = levelOf(k);
  if (lv === lastLevel) return;
  lastLevel = lv;
  for (const b of document.querySelectorAll('#ladderSteps button')) b.setAttribute('aria-current', String(b.dataset.level === lv));
}

// ---- The spine on the left: layer names that follow the bands ----
let stripEls = null;
export function renderStrip(world, cam, W, H) {
  const el = $('#strip');
  if (!stripEls) {
    stripEls = {};
    for (const b of world.bands) {
      const d = document.createElement('div');
      d.className = 'seg-b';
      d.innerHTML = `<span>${esc(LAYER[b.layer].name)}</span>`;
      el.appendChild(d);
      stripEls[b.layer] = d;
    }
  }
  const show = cam.k >= 0.2 && (world.stackW - cam.x) * cam.k > 60;
  el.style.display = show ? '' : 'none';
  if (!show) return;
  for (const b of world.bands) {
    const d = stripEls[b.layer];
    d.style.borderLeftColor = layerColor(b.layer);
    const y0 = (b.y - cam.y) * cam.k, y1 = (b.y + b.h - cam.y) * cam.k;
    const top = Math.max(0, y0), bot = Math.min(H, y1);
    if (bot - top < 8) { d.style.display = 'none'; continue; }
    d.style.display = '';
    d.style.top = top + 'px';
    d.style.height = bot - top + 'px';
    const span = d.firstChild;
    if (!span._h) span._h = span.scrollHeight || 90;
    span.style.visibility = bot - top >= span._h + 4 ? 'visible' : 'hidden';
  }
}

export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
