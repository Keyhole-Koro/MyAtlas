import { buildDiagram, diagramList, KIND_NAME } from './model.js';
import { ENGINES, ENGINE } from './engines/index.js';
import { measureLayout, METRICS, METRIC, scoreAll, scoreOne, badness, fmtValue, EQUAL } from './metrics.js';
import { renderSvg, MARKERS_SVG } from './render.js';
import { VARIANTS, makeVariant } from './variants.js';

const A = window.ATLAS;
const DIAGRAMS = diagramList(A);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (s) => String(s ?? '').replace(/\[\[([^\]]+)\]\]/g, (_, id) => (A.nodes[id] ? A.nodes[id].title : id));
const BASE = 'hand', PROP = 'lanes';
const COUNTS = ['crossings', 'through', 'jogs', 'overlaps', 'onLine', 'detached', 'trimmed', 'frames'];
const narrow = () => window.innerWidth < 760;

const state = { d: 'ui', e: 'lanes', step: null, defects: true };
const cache = new Map();
const pending = new Map();

// ---- computing: every engine on one diagram, then the scores ----
function compute(d) {
  if (cache.has(d)) return Promise.resolve(cache.get(d));
  if (pending.has(d)) return pending.get(d);
  const p = (async () => {
    const D = buildDiagram(A, d);
    const res = {};
    for (const e of ENGINES) {
      const t0 = performance.now();
      const G = await e.run(D);
      const M = measureLayout(D, G);
      res[e.id] = { G, M, ms: performance.now() - t0 };
    }
    const sc = scoreAll(Object.fromEntries(ENGINES.map((e) => [e.id, res[e.id].M])));
    const entry = { D, res, sc };
    cache.set(d, entry);
    pending.delete(d);
    return entry;
  })();
  pending.set(d, p);
  return p;
}

// ---- the address keeps what is shown ----
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('d') && DIAGRAMS.some((x) => x.id === q.get('d'))) state.d = q.get('d');
  if (q.get('e') && ENGINE[q.get('e')]) state.e = q.get('e');
  state.step = q.get('s') != null && q.get('s') !== '' ? Number(q.get('s')) : null;
  state.defects = q.get('df') !== '0';
}
function writeHash() {
  const q = new URLSearchParams({ d: state.d, e: state.e });
  if (state.step != null) q.set('s', state.step);
  if (!state.defects) q.set('df', '0');
  history.replaceState(null, '', '#' + q.toString());
}

// ---- header: which diagram ----
function renderPick() {
  const btn = (x) => `<button type="button" data-d="${x.id}" aria-pressed="${x.id === state.d}" title="${esc(x.title)}">${esc(x.tab)}</button>`;
  $('pick-flow').innerHTML = DIAGRAMS.filter((x) => x.group === 'flow').map(btn).join('');
  $('pick-paper').innerHTML = DIAGRAMS.filter((x) => x.group === 'paper').map(btn).join('');
  const d = DIAGRAMS.find((x) => x.id === state.d);
  const D = buildDiagram(A, state.d);
  $('dtitle').innerHTML = `<b>${esc(d.title)}</b>箱 ${D.boxes.length}・手順 ${D.steps.filter((s) => !s.alt).length}${D.steps.some((s) => s.alt) ? `（もし ${D.steps.filter((s) => s.alt).length}）` : ''}・帯 ${new Set(D.boxes.map((b) => b.band)).size}${D.regions.length ? `・実行の文脈 ${D.regions.length}` : ''}`;
}

// ---- the cards ----
function keyChips(M) {
  const v = M.values, lines = v.crossings + v.through, labs = v.overlaps + v.onLine + v.detached;
  const labTitle = `札の問題：重なり ${v.overlaps}・札にかかる線 ${v.onLine}・線から離れた札 ${v.detached}`;
  return `<span class="k ${lines ? 'bad' : 'good'}" title="線の交差 ${v.crossings}・箱を貫く線 ${v.through}">交差 ${lines}</span>`
    + `<span class="k ${labs ? 'bad' : 'good'}" title="${labTitle}">札 ${labs}</span>`
    + (v.trimmed ? `<span class="k warn" title="場所が足りず、動詞かデータを省いた札">削った札 ${v.trimmed}</span>` : '')
    + `<span class="k ${v.fit < 11 ? 'bad' : ''}" title="今の地図の枠（1100 × 720）に全体を収めた時の、箱の題の文字">文字 ${v.fit.toFixed(1)} px</span>`;
}
function renderCards(entry) {
  const box = $('multiples');
  box.style.setProperty('--n', ENGINES.length);
  if (!entry) {
    box.innerHTML = ENGINES.map((e) => `<div class="card"><div class="card-head"><span class="rank">…</span></div><div class="name">${esc(e.name)}</div><div class="thumb"><span class="wait">並べています…</span></div><div class="keys"><span class="k">…</span></div></div>`).join('');
    return;
  }
  const { res, sc } = entry;
  box.innerHTML = ENGINES.map((e) => {
    const r = sc.place[e.id];
    return `<button type="button" class="card${e.id === BASE ? ' base' : ''}" data-e="${e.id}" aria-pressed="${e.id === state.e}" title="${esc(e.name)}を大きく見る（キー ${e.no}）">`
      + `<div class="card-head"><span class="rank${r === 1 ? ' r1' : ''}">${r} 位</span>${e.id === BASE ? '<span class="tag">基準</span>' : ''}<span class="score">${esc(e.short)} <b>${sc.score[e.id]}</b> 点</span></div>`
      + `<div class="name">${esc(e.name)}</div>`
      + `<div class="thumb" data-thumb="${e.id}"></div><div class="keys">${keyChips(res[e.id].M)}</div></button>`;
  }).join('');
  renderThumbs(entry);
  // on a phone the cards scroll sideways: start at the selected one
  if (narrow()) { const c = box.querySelector(`.card[data-e="${state.e}"]`); if (c) box.scrollLeft = c.offsetLeft - box.offsetLeft; }
}
// thumbnails at the size the card really has once the page is laid out; numbers and marks keep a readable size
function renderThumbs(entry = cache.get(state.d)) {
  const box = $('multiples'), t = box.querySelector('.thumb[data-thumb]');
  if (!entry || !t) return;
  const tw = t.clientWidth - 12, th = t.clientHeight - 12;
  if (tw < 20 || th < 20) return;
  const { D, res } = entry;
  for (const e of ENGINES) {
    const { G, M } = res[e.id];
    const scale = Math.min(tw / G.width, th / G.height);
    const el = box.querySelector(`[data-thumb="${e.id}"]`);
    if (el) el.innerHTML = renderSvg(D, G, { mode: 'thumb', scale, defects: state.defects ? M.defects : null, sel: state.step });
  }
  box.dataset.size = `${tw}x${th}`;
}
let thumbFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(thumbFrame);
  thumbFrame = requestAnimationFrame(() => {
    const t = $('multiples').querySelector('.thumb[data-thumb]');
    if (t && $('multiples').dataset.size !== `${t.clientWidth - 12}x${t.clientHeight - 12}`) renderThumbs();
  });
}).observe($('multiples'));

// ---- the stage: one engine, large ----
function stepCaption(D) {
  if (state.step == null) {
    const n = D.steps.filter((s) => !s.alt).length;
    return `<span class="hint">◀ ▶ か ← → キーで、手順を 1 から順にたどれます（全 ${n} 手順）。線か札を押しても選べます。</span>`;
  }
  const st = D.steps[state.step];
  const data = st.data ? `　渡すもの：<span class="mono">${esc(st.data.label)}</span>` : '';
  return `<span class="n${st.alt ? ' alt' : ''}">${esc(st.no)}</span><span class="kind">${esc(KIND_NAME[st.kind] || st.kind)}</span><span>${esc(plain(st.label))}${data}</span>`;
}
function renderStage(entry) {
  const e = ENGINE[state.e];
  $('stage-no').textContent = e.no;
  $('stage-title').textContent = e.name;
  $('stage-desc').textContent = e.desc;
  $('stage-pick').innerHTML = ENGINES.map((x) => `<button type="button" data-e="${x.id}" aria-pressed="${x.id === state.e}" title="${esc(x.name)}（キー ${x.no}）">${esc(x.short)}</button>`).join('');
  $('show-defects').checked = state.defects;
  const canvas = $('canvas');
  if (!entry) { canvas.innerHTML = '<span class="wait">並べています…</span>'; $('caption').innerHTML = ''; return; }
  const { D, res } = entry, { G, M } = res[state.e];
  $('caption').innerHTML = stepCaption(D);
  // full size; narrower screens scale down only so far, and scroll sideways
  const avail = canvas.clientWidth - (narrow() ? 20 : 36);
  const scale = Math.max(narrow() ? 0.85 : 0.8, Math.min(1, avail / G.width));
  canvas.innerHTML = renderSvg(D, G, { sel: state.step, defects: state.defects ? M.defects : null, scale, titles: true });
  // on a narrow screen the drawing scrolls sideways: keep the selected step's label in view
  if (state.step != null && canvas.scrollWidth > canvas.clientWidth) {
    const pill = canvas.querySelector(`.pill[data-step="${state.step}"]`);
    if (pill) { const r = pill.getBoundingClientRect(), cr = canvas.getBoundingClientRect(); canvas.scrollLeft += r.left + r.width / 2 - (cr.left + cr.width / 2); }
  }
  const v = M.values;
  const prob = [];
  if (v.crossings) prob.push(`交差 ${v.crossings}`);
  if (v.through) prob.push(`箱を貫く線 ${v.through}`);
  if (v.jogs) prob.push(`小さな段差 ${v.jogs}`);
  if (M.defects.detour.length) prob.push(`遠回り ${Math.round(v.detour)} px`);
  if (v.overlaps) prob.push(`重なり ${v.overlaps}`);
  if (v.onLine) prob.push(`札にかかる線 ${v.onLine}`);
  if (v.detached) prob.push(`線から離れた札 ${v.detached}`);
  if (v.frames) prob.push(`枠の誤り ${v.frames}`);
  $('stage-foot').innerHTML = `<span>${Math.round(G.width)} × ${Math.round(G.height)} px（表示 ${Math.round(scale * 100)}%）</span><span>${esc(e.lib)}</span><span>配置にかかった時間 ${Math.max(1, Math.round(res[state.e].ms))} ms</span>`
    + (v.trimmed ? `<span>削った札 ${v.trimmed}（押すと全部読める）</span>` : '')
    + (prob.length ? `<span class="bad">赤い印：${prob.join('・')}</span>` : '<span>赤い印の付く問題はありません</span>');
}
function revealStep() {
  if (state.step == null) return;
  const el = $('canvas').querySelector(`.pill[data-step="${state.step}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect(), bar = document.querySelector('.player').getBoundingClientRect();
  if (r.top < bar.bottom + 8 || r.bottom > window.innerHeight - 8) window.scrollBy({ top: r.top - (bar.bottom + window.innerHeight) / 2 + 20, behavior: 'smooth' });
  const c = $('canvas'), cr = c.getBoundingClientRect();
  if (r.left < cr.left || r.right > cr.right) c.scrollBy({ left: r.left - cr.left - cr.width / 2, behavior: 'smooth' });
}
// the line styles, drawn with the same marks as the map
function renderLegend() {
  const kinds = ['call', 'syscall', 'return', 'signal', 'msg', 'data'];
  const line = (k) => {
    const start = k === 'data' ? ' marker-start="url(#mk-dot)"' : k === 'syscall' ? ' marker-start="url(#mk-gate)"' : '';
    return `<svg class="dg lg" width="50" height="14" viewBox="0 0 50 14" aria-hidden="true"><g class="edge k-${k}"><path class="line" d="M7,7H43"${start} marker-end="url(#${k === 'return' ? 'mk-o' : 'mk-h'})"/></g></svg>`;
  };
  $('legend').innerHTML = `<span class="lg-t">線</span>` + kinds.map((k) => `<span class="lg-i">${line(k)}${esc(KIND_NAME[k])}</span>`).join('')
    + `<span class="lg-i"><svg class="dg lg" width="26" height="14" viewBox="0 0 26 14" aria-hidden="true"><g class="edge alt k-return"><path class="line" d="M3,7H19" marker-end="url(#mk-o)"/></g></svg>もし（灰色の線と番号）：その手順の代わりに起こる</span>`
    + `<span class="lg-i"><svg class="dg lg" width="16" height="22" viewBox="0 0 16 22" aria-hidden="true"><g class="pill"><path class="leader" d="M8,2V20"/></g></svg>点線の短い線：行の上の札を、その矢印へつなぐ（提案）</span>`
    + `<span class="lg-i"><span class="lg-frame"></span>薄い面：実行の文脈（同じ名前の面は同じ文脈）</span>`;
}

// ---- the scoreboard for this diagram ----
const GROUP_NAMES = ['線', '札と箱', '全体'];
// on a narrow screen the selected engine's column comes first, so it is never off to the side
const columns = () => (narrow() ? [ENGINE[state.e], ...ENGINES.filter((e) => e.id !== state.e)] : ENGINES);
function shortFmt(id, v, M) {
  if (v == null) return '—';
  if (id === 'length') return `${(v / 1000).toFixed(1)}k`;
  if (id === 'area') return `${(v / 1e6).toFixed(2)}M`;
  if (id === 'fit' || id === 'bends') return v.toFixed(1);
  if (id === 'layers') return M && M.detail.layersBy === 'head' ? '50%*' : `${Math.round(v * 100)}%`;
  if (id === 'travel' || id === 'detour') return `${Math.round(v)}`;
  return String(v);
}
const anchorText = (m) => (m.w ? `良い：${fmtValue(m, m.good)} まで、悪い：${fmtValue(m, m.bad)} から（重み ${m.w}）` : '点には入れない');
function renderBoard(entry) {
  const board = $('board');
  if (!entry) { board.innerHTML = '<h2>採点表</h2><p class="sub">並べています…</p>'; return; }
  const { res, sc } = entry, cols = columns();
  let h = `<h2>採点表</h2>` + verdict(entry);
  h += `<table class="score-t"><thead><tr><th></th>${cols.map((e) => `<th class="${e.id === state.e ? 'sel' : ''}"><button type="button" data-e="${e.id}" title="${esc(e.name)}を下に大きく出す">${e.no}<br>${esc(e.short)}</button></th>`).join('')}</tr></thead><tbody>`;
  for (const [g, name] of GROUP_NAMES.entries()) {
    h += `<tr class="group"><th colspan="${cols.length + 1}">${name}</th></tr>`;
    for (const m of METRICS.filter((x) => x.group === g)) {
      h += `<tr${m.w ? '' : ' class="ref"'}><th title="${esc(m.desc + ' ' + anchorText(m))}"><span class="nm">${esc(m.name)}</span></th>`;
      for (const e of cols) {
        const M = res[e.id].M, v = M.values[m.id];
        const bad = m.w && badness(m, v) >= 0.5, best = m.w && sc.best[m.id].includes(e.id) && sc.best[m.id].length < ENGINES.length;
        const cls = [e.id === state.e ? 'sel' : '', best ? 'best' : '', bad ? 'bad' : ''].filter(Boolean).join(' ');
        h += `<td class="${cls}" title="${esc(e.name)}：${esc(fmtValue(m, v, M))}">${esc(shortFmt(m.id, v, M))}</td>`;
      }
      h += `</tr>`;
    }
  }
  h += `<tr class="total"><th>点（100 点）</th>${cols.map((e) => `<td class="${e.id === state.e ? 'sel' : ''}${sc.place[e.id] === 1 ? ' best' : ''}">${sc.score[e.id]}</td>`).join('')}</tr>`;
  h += `</tbody></table>`;
  h += `<p class="note">点は置き方ごとに独立：行ごとに決めた「良い」値と「悪い」値（行の名前に重ねると出る）の間のどこにあるかで減らすので、ほかの置き方には左右されない。重み：交差・貫く線・重なり 3、離れた札・文字・層 2、ほか 1。緑はその行の最良、赤は「悪い」に半分以上近い値。* 時系列の層は位置でなく頭の文字で分かるので 50%。列の名前を押すと、下に大きく出します。</p>`;
  board.innerHTML = h;
}
// What changes from the current map to the proposal on this diagram, item by item.
function diffs(H, P) {
  const better = [], worse = [];
  for (const m of METRICS) {
    if (!m.w) continue;
    const h = H.values[m.id], p = P.values[m.id];
    const differs = COUNTS.includes(m.id) ? h !== p : Math.abs(badness(m, h) - badness(m, p)) >= 0.05;
    if (!differs) continue;
    const up = m.better === 'low' ? p < h : p > h;
    (up ? better : worse).push(`${m.name} ${fmtValue(m, h, H)} → ${fmtValue(m, p, P)}`);
  }
  return { better, worse };
}
function verdict(entry) {
  const { res, sc } = entry, tops = ENGINES.filter((e) => sc.place[e.id] === 1);
  const names = tops.map((e) => `<b>${esc(e.short)}</b>`).join(' と ');
  let s = `<div class="verdict"><p>この図の最高は ${names}（${sc.score[tops[0].id]} 点）。提案 ${sc.score[PROP]} 点、今の地図 ${sc.score[BASE]} 点。</p>`;
  const { better, worse } = diffs(res[BASE].M, res[PROP].M);
  s += `<p class="vd"><span class="up">今の地図 → 提案で良くなる</span>${better.length ? esc(better.join('、')) : 'なし'}</p>`;
  s += `<p class="vd"><span class="down">悪くなる</span>${worse.length ? esc(worse.join('、')) : 'なし'}</p>`;
  return s + `</div>`;
}

// ---- all six diagrams together ----
async function renderOverall() {
  const all = [];
  for (const d of DIAGRAMS) all.push([d, await compute(d.id)]);
  const mean = Object.fromEntries(ENGINES.map((e) => [e.id, all.reduce((a, [, en]) => a + en.sc.score[e.id], 0) / all.length]));
  const meanEq = Object.fromEntries(ENGINES.map((e) => [e.id, all.reduce((a, [, en]) => a + scoreOne(en.res[e.id].M, EQUAL), 0) / all.length]));
  const order = [...ENGINES].sort((a, b) => mean[b.id] - mean[a.id]);
  const sum = (id, f) => all.reduce((a, [, en]) => a + f(en.res[id].M.values), 0);
  const wins = (id) => all.filter(([, en]) => en.sc.place[id] === 1).length;
  const head = `<tr><th>図</th>${order.map((e) => `<th class="${e.id === BASE ? 'base' : ''}"><button type="button" data-e="${e.id}" title="${esc(e.name)}を大きく見る">${esc(e.short)}</button></th>`).join('')}</tr>`;
  let body = '';
  for (const [d, en] of all) {
    body += `<tr><td><button type="button" class="link" data-d="${d.id}">${esc(d.tab)}</button><span class="grp">${d.group === 'flow' ? '流れ' : '中の紙'}</span></td>`;
    for (const e of order) { const r = en.sc.place[e.id]; body += `<td><span class="sc">${en.sc.score[e.id]}</span><span class="med${r === 1 ? ' m1' : ''}">${r}</span></td>`; }
    body += `</tr>`;
  }
  const rank = (m) => { const o = [...ENGINES].sort((a, b) => m[b.id] - m[a.id]); return (id) => 1 + o.filter((e) => m[e.id] > m[id] + 1e-9).length; };
  const rEq = rank(meanEq);
  const cell = (v, bad) => `<td class="${bad ? 'bad' : v === 0 ? 'good' : ''}">${v}</td>`;
  body += `<tr class="sum"><td>平均点</td>${order.map((e) => `<td class="mean">${mean[e.id].toFixed(0)}</td>`).join('')}</tr>`;
  body += `<tr class="sum2"><td>重みを全部 1 にした平均点（順位）</td>${order.map((e) => `<td>${meanEq[e.id].toFixed(0)}（${rEq(e.id)}）</td>`).join('')}</tr>`;
  body += `<tr class="sum2"><td>1 位になった図（同点を含む）</td>${order.map((e) => `<td>${wins(e.id)}</td>`).join('')}</tr>`;
  body += `<tr class="sum2"><td>交差と箱を貫く線（6 図の合計）</td>${order.map((e) => { const v = sum(e.id, (x) => x.crossings + x.through); return cell(v, v > 0); }).join('')}</tr>`;
  body += `<tr class="sum2"><td>札・箱の重なり（合計）</td>${order.map((e) => { const v = sum(e.id, (x) => x.overlaps); return cell(v, v > 0); }).join('')}</tr>`;
  body += `<tr class="sum2"><td>札にかかる線と線から離れた札（合計）</td>${order.map((e) => { const v = sum(e.id, (x) => x.onLine + x.detached); return cell(v, v > 0); }).join('')}</tr>`;
  body += `<tr class="sum2"><td>削った札（合計）</td>${order.map((e) => { const v = sum(e.id, (x) => x.trimmed); return cell(v, false); }).join('')}</tr>`;
  body += `<tr class="sum2"><td>小さな段差（合計）</td>${order.map((e) => { const v = sum(e.id, (x) => x.jogs); return cell(v, false); }).join('')}</tr>`;
  body += `<tr class="sum2"><td>1 画面での文字（平均）</td>${order.map((e) => { const v = sum(e.id, (x) => x.fit) / all.length; return `<td class="${v < 11 ? 'bad' : ''}">${v.toFixed(1)} px</td>`; }).join('')}</tr>`;
  body += `<tr class="sum2"><td>層の上下の順（平均。時系列は位置でなく頭の文字で読む）</td>${order.map((e) => { const xs = all.map(([, en]) => en.res[e.id].M); const head = xs.some((M) => M.detail.layersBy === 'head'); const v = xs.reduce((a, M) => a + M.values.layers, 0) / xs.length; return `<td class="${head || v < 0.9 ? 'bad' : ''}">${head ? '頭の文字' : Math.round(100 * v) + '%'}</td>`; }).join('')}</tr>`;
  $('overall').innerHTML = `<h2>6 枚の図をまとめると</h2><p class="sub">流れ 2 枚と中の紙 4 枚で、同じ採点をしました。数字は各図の点（100 点満点）、小さな丸はその図での順位です。列は平均点の高い順。図の名前を押すと、その図に切り替わります。</p>`
    + `<div class="ov-grid"><div class="panel"><table class="ov-t"><thead>${head}</thead><tbody>${body}</tbody></table></div>`
    + `<div class="panel">${pairTable(all)}</div></div>`
    + `<section class="trial" id="trial"><h2>調整に使っていない図で試す</h2><p class="sub">提案の規則と値は、上の 6 枚を見ながら決めました。それで良く見えるのは当然かもしれないので、6 枚を少しずつ変えた 30 枚（下の 5 通り × 6 枚）で、今の地図と提案を同じ物差しで測ります。変えた図は配置の試験のためだけに作ったもので、足した箱（追加 1…）や手順（追加）は実在しません。</p><div class="panel" id="trial-body"><p class="wait">試しています…</p></div></section>`
    + `<section class="concl panel" id="concl">${conclusion(all, mean, meanEq, null)}</section>`
    + `<p class="howto"><kbd>1</kbd>〜<kbd>${ENGINES.length}</kbd> 置き方を切り替える　<kbd>←</kbd><kbd>→</kbd> 手順をたどる　<kbd>Esc</kbd> 手順の選択を外す　<kbd>P</kbd> 問題の場所の赤い印</p>`;
  window.__lab.overall = all.map(([d, en]) => ({ id: d.id, score: en.sc.score, place: en.sc.place, values: Object.fromEntries(ENGINES.map((e) => [e.id, { ...en.res[e.id].M.values, w: Math.round(en.res[e.id].G.width), h: Math.round(en.res[e.id].G.height), ms: Math.round(en.res[e.id].ms) }])) }));
  document.body.dataset.overall = '1';
  const trial = await runTrial();
  $('trial-body').innerHTML = trialTable(trial);
  $('concl').innerHTML = conclusion(all, mean, meanEq, trial);
  window.__lab.trial = trial;
  document.body.dataset.trial = '1';
}

// The current map against the proposal, item by item over the six diagrams.
function pairTable(all) {
  const H = all.map(([, en]) => en.res[BASE].M), P = all.map(([, en]) => en.res[PROP].M);
  let rows = '';
  for (const m of METRICS) {
    const agg = (Ms) => {
      const vs = Ms.map((M) => M.values[m.id]);
      return COUNTS.includes(m.id) ? vs.reduce((a, b) => a + b, 0) : vs.reduce((a, b) => a + b, 0) / vs.length;
    };
    const h = agg(H), p = agg(P);
    let up = 0, same = 0, down = 0;
    for (let k = 0; k < all.length; k++) {
      const a = H[k].values[m.id], b = P[k].values[m.id];
      const eq = COUNTS.includes(m.id) ? a === b : m.w ? Math.abs(badness(m, a) - badness(m, b)) < 0.05 : Math.abs(a - b) <= 0.05 * Math.max(Math.abs(a), Math.abs(b));
      if (eq) same++; else if (m.better === 'low' ? b < a : b > a) up++; else down++;
    }
    const f = (v, Ms) => (COUNTS.includes(m.id) ? String(v) : fmtValue(m, v, Ms[0]));
    rows += `<tr${m.w ? '' : ' class="ref"'}><th title="${esc(m.desc)}">${esc(m.name)}</th><td>${esc(f(h, H))}</td><td>${esc(f(p, P))}</td><td class="${up ? 'good' : ''}">${up}</td><td>${same}</td><td class="${down ? 'bad' : ''}">${down}</td></tr>`;
  }
  return `<h3>今の地図と提案を、項目ごとに</h3><p class="sub">数は 6 図の合計（数える項目）か平均。右の 3 列は、提案が今の地図より良かった図・同じだった図・悪かった図の数。</p>`
    + `<table class="pair-t"><thead><tr><th>項目</th><th>今の地図</th><th>提案</th><th>良い</th><th>同じ</th><th>悪い</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- the trial: the current map and the proposal on altered copies of the diagrams ----
async function runTrial() {
  const out = [];
  for (const v of VARIANTS) for (const d of DIAGRAMS) {
    const D = makeVariant(buildDiagram(A, d.id), v.id), row = { v: v.id, d: d.id };
    for (const id of [BASE, PROP]) {
      const G = await ENGINE[id].run(D), M = measureLayout(D, G);
      row[id] = { score: scoreOne(M), values: M.values };
    }
    out.push(row);
    await new Promise((ok) => setTimeout(ok, 0));
  }
  return out;
}
function trialTable(trial) {
  const pick = (rows, id, f) => rows.reduce((a, r) => a + f(r[id].values), 0);
  const fmtPair = (a, b, lowGood = true) => `<span class="${b < a === lowGood && a !== b ? 'good' : a !== b ? 'bad' : ''}">${a} → ${b}</span>`;
  let rows = '';
  const line = (name, rs) => {
    const sH = rs.reduce((a, r) => a + r[BASE].score, 0) / rs.length, sP = rs.reduce((a, r) => a + r[PROP].score, 0) / rs.length;
    const up = rs.filter((r) => r[PROP].score > r[BASE].score).length, eq = rs.filter((r) => r[PROP].score === r[BASE].score).length;
    const zero = rs.filter((r) => { const x = r[PROP].values; return !x.crossings && !x.through && !x.overlaps && !x.onLine && !x.detached; }).length;
    return `<tr><th>${esc(name)}</th><td>${fmtPair(Math.round(sH), Math.round(sP), false)}</td><td>${up} ／ ${eq} ／ ${rs.length - up - eq}</td>`
      + `<td>${fmtPair(pick(rs, BASE, (x) => x.crossings + x.through), pick(rs, PROP, (x) => x.crossings + x.through))}</td>`
      + `<td>${fmtPair(pick(rs, BASE, (x) => x.overlaps + x.onLine + x.detached), pick(rs, PROP, (x) => x.overlaps + x.onLine + x.detached))}</td>`
      + `<td>${fmtPair(pick(rs, BASE, (x) => x.trimmed), pick(rs, PROP, (x) => x.trimmed))}</td>`
      + `<td>${fmtPair(pick(rs, BASE, (x) => x.jogs), pick(rs, PROP, (x) => x.jogs))}</td>`
      + `<td>${fmtPair(pick(rs, BASE, (x) => x.frames), pick(rs, PROP, (x) => x.frames))}</td>`
      + `<td>${zero} ／ ${rs.length}</td></tr>`;
  };
  for (const v of VARIANTS) rows += line(v.name, trial.filter((r) => r.v === v.id)).replace('<th>', `<th title="${esc(v.desc)}">`);
  rows += line('30 枚の合計', trial).replace('<tr>', '<tr class="sum">');
  return `<table class="trial-t"><thead><tr><th>変え方</th><th>平均点<br>今 → 提案</th><th>提案が<br>良い／同じ／悪い</th><th>交差と<br>貫く線</th><th>札の重なり・<br>線・離れ</th><th>削った札</th><th>小さな<br>段差</th><th>枠の誤り</th><th>提案で札と線の<br>問題が 0 の図</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p class="note">数は各変え方の 6 枚の合計で「今の地図 → 提案」。緑は提案で減った、赤は増えた。札の問題は、重なり・札にかかる線・線から離れた札の合計。</p>`;
}

// The conclusion, with the numbers this page has just measured.
function conclusion(all, mean, meanEq, trial) {
  const g = (d, e) => all.find(([x]) => x.id === d)[1].res[e].G;
  const sum = (e, f) => all.reduce((a, [, en]) => a + f(en.res[e].M.values), 0);
  const top = [...ENGINES].sort((a, b) => mean[b.id] - mean[a.id]);
  const H = (f) => sum(BASE, f), P = (f) => sum(PROP, f);
  const lines = (x) => x.crossings + x.through, labs = (x) => x.overlaps + x.onLine + x.detached;
  const elkUi = g('ui', 'elk'), uiH = g('ui', BASE), uiP = g('ui', PROP);
  let t = `<h3>結論</h3>`;
  t += `<p>6 枚の平均点は ${top.map((e) => `${esc(e.short)} ${mean[e.id].toFixed(0)}`).join('、')}。提案は今の地図より、交差と貫く線が ${H(lines)} → ${P(lines)}、札の問題（重なり・線・離れ）が ${H(labs)} → ${P(labs)}、削った札が ${H((x) => x.trimmed)} → ${P((x) => x.trimmed)}、小さな段差が ${H((x) => x.jogs)} → ${P((x) => x.jogs)}。代わりに図は高くなり（UI の要求で ${Math.round(uiH.height)} → ${Math.round(uiP.height)} px）、線は長くなる（6 図で ${(H((x) => x.length) / 1000).toFixed(1)}k → ${(P((x) => x.length) / 1000).toFixed(1)}k px）。</p>`;
  if (trial) {
    const up = trial.filter((r) => r[PROP].score > r[BASE].score).length, eq = trial.filter((r) => r[PROP].score === r[BASE].score).length;
    const zero = trial.filter((r) => { const x = r[PROP].values; return !x.crossings && !x.through && !x.overlaps && !x.onLine && !x.detached; }).length;
    t += `<p>ただし、この 6 枚は提案を調整した図そのもの。変えた 30 枚では、提案は ${up} 枚で今の地図より点が高く、${eq} 枚で同じ、${trial.length - up - eq} 枚で低かった。交差・札の問題がどちらも 0 だったのは 30 枚中 ${zero} 枚で、規則は「問題をなくす」とまでは言えず「減らす」まで。</p>`;
  } else t += `<p>変えた図での試しが終わると、ここに結果が入ります。</p>`;
  t += `<h3>置き方ごとに分かったこと</h3><ul>`
    + `<li><b>今の地図</b>：小さくまとまり、線は短い。札が入らない所では動詞やデータを省く（6 図で ${H((x) => x.trimmed)} 枚）ので、札が箱に乗ることはほぼないが、その手順は選ばないと読めない。枠は外接長方形なので、札が枠の線にかかる（6 図で ${H((x) => x.frames)}）。</li>`
    + `<li><b>提案</b>：札は矢印の上か、行の上に吊って点線でつなぐ。帯をまたぐ線は通り道と回廊を通り、大きな遠回りより交差 1 つが安い時は、行の中の短い矢印を直角に横切る（UI の要求の手順 3 の syscall は、要求の列と serve() のあいだを下りる）。代わりに起こる手順（もし）は横切らずに回るので、UI の要求の もしB は遠回りになる。帯の中の並びは手順が届く順に頼るので、その順が崩れると弱い（下の試し）。</li>`
    + `<li><b>時系列</b>：点は高い（平均 ${mean.seq.toFixed(0)}）。交差がなく、手順を順に追うのは最も楽。ただし層は位置ではなく頭の文字で読み、手順が増えるほど縦に伸びる。地図の代わりではなく、地図の横の「順に読む」画面として良い。</li>`
    + `<li><b>ELK</b>：交差も重なりも 0 だが、帯の中で続く手順を縦に積むので、UI の要求は ${Math.round(elkUi.width)} × ${Math.round(elkUi.height)} px、1 画面では文字 ${all[0][1].res.elk.M.values.fit.toFixed(1)} px。枠は外接長方形で、関係ない箱を囲う。</li>`
    + `<li><b>dagre</b>：1 本の縦の物語として読めるが、層を知らないので層の順が崩れる（CPU 時間ではエミュレータが一番上）。</li>`
    + `<li><b>力学</b>：箱と札がぶつかる（重なり ${sum('force', (x) => x.overlaps)}）。地図には向かない。</li></ul>`;
  t += `<h3>主の地図が試せること（このページの値）</h3><ol class="adopt">`
    + `<li>札の場所を先に取る：帯の中で続く手順は 1 行にし、札は矢印の上（矢印の間 = 札の幅 + 24 px、160 px まで）。行が 902 px を超える時は、長い札から行の上に吊り、点線で矢印につなぐ。それでも入らなければ帯の中で折り返す。</li>`
    + `<li>帯のあいだの通り道：横に走る線は 12 px ずつのトラックに分け、縦線と交わらない順に並べる。2 つ以上の帯をまたぐ線は回廊を通し、「交差 × 1000（行の中の短い矢印は 300）＋ 長さ」が最小の所を探す。</li>`
    + `<li>24 px 以内の段差は、ポートか回廊を動かして消す。</li>`
    + `<li>実行の文脈の枠は段ごとの長方形にし、隣の段どうしは札を切らない幅でつなぎ、離れた段は同じ名前の別の枠にする。</li>`
    + `<li>metrics.js を make atlas-check に入れ、交差・札の重なり・線から離れた札が増えたら気づけるようにする。</li>`
    + `<li>時系列は地図の代わりではなく、「順に読む」画面として残す。</li></ol>`
    + `<p class="caveat">点の付け方（良い・悪いの値と重み）は私の判断です。重みを全部 1 にすると平均点は ${top.map((e) => `${esc(e.short)} ${meanEq[e.id].toFixed(0)}`).join('、')} になります。</p>`;
  return t;
}

// ---- drawing everything ----
let token = 0;
async function render() {
  writeHash();
  renderPick();
  const mine = ++token;
  const ready = cache.get(state.d);
  if (!ready) { renderBoard(null); renderCards(null); renderStage(null); }
  const entry = ready || await compute(state.d);
  if (mine !== token) return;
  // the board first: the cards take their height from the row it sets
  renderBoard(entry); renderStage(entry); renderCards(entry);
  document.body.dataset.ready = '1';
}
function renderLight() {
  // after a change of step, engine or toggle: no recomputing
  writeHash();
  const entry = cache.get(state.d);
  if (!entry) return render();
  renderBoard(entry); renderStage(entry); renderCards(entry);
}

// ---- input ----
function setStep(dir) {
  const entry = cache.get(state.d);
  if (!entry) return;
  const order = entry.D.steps.map((s) => s.i);
  // the reading order: main steps, each followed by the steps that can happen instead of it
  const rows = [];
  for (const s of entry.D.steps.filter((x) => !x.alt)) { rows.push(s.i); for (const a of entry.D.steps.filter((x) => x.alt && x.alt.at === s.i)) rows.push(a.i); }
  for (const i of order) if (!rows.includes(i)) rows.push(i);
  const k = state.step == null ? (dir > 0 ? -1 : rows.length) : rows.indexOf(state.step);
  const n = k + dir;
  state.step = n < 0 || n >= rows.length ? null : rows[n];
  renderLight();
  revealStep();
}
document.addEventListener('click', (ev) => {
  const t = ev.target;
  const d = t.closest('[data-d]');
  if (d) {
    state.d = d.dataset.d; state.step = null; render();
    if (d.closest('#overall')) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const e = t.closest('[data-e]');
  if (e) {
    state.e = e.dataset.e; renderLight();
    // a card, a column of the board or of the summary: the drawing is below, so go there
    if (!e.closest('#stage-pick')) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.closest('#prev')) { setStep(-1); return; }
  if (t.closest('#next')) { setStep(1); return; }
  if (t.closest('#canvas')) {
    const s = t.closest('[data-step]');
    state.step = s ? Number(s.dataset.step) : null;
    renderLight();
  }
});
$('show-defects').addEventListener('change', (ev) => { state.defects = ev.target.checked; renderLight(); });
document.addEventListener('keydown', (ev) => {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.target.closest && ev.target.closest('input, textarea, select')) return;
  if (ev.key === 'ArrowRight') { setStep(1); ev.preventDefault(); }
  else if (ev.key === 'ArrowLeft') { setStep(-1); ev.preventDefault(); }
  else if (ev.key === 'Escape') { state.step = null; renderLight(); }
  else if (/^[1-9]$/.test(ev.key) && ENGINES[Number(ev.key) - 1]) { state.e = ENGINES[Number(ev.key) - 1].id; renderLight(); }
  else if (ev.key === 'p' || ev.key === 'P') { state.defects = !state.defects; renderLight(); }
});
let rt = 0;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderLight, 120); });

$('markers').innerHTML = MARKERS_SVG;
renderLegend();
readHash();
window.__lab = { state, cache, compute, ENGINES, render: renderLight };
render().then(() => setTimeout(renderOverall, 30));
