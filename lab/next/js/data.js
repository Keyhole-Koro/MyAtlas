// データ: the data's journey (from data-journey) — for the UI flow, Request's fields × the steps with the
// papers opened in place; for CPU 時間, the values time passes through. A line's colour is the memory
// that holds the value; the owner overwrite stands out. Every mark points at the map's words or a line of code.
(function () {
  'use strict';
  const NX = window.NX, { A, esc, $, TR } = NX;
  const JY = window.JOURNEYS;
  const V = (NX.data = {});
  const root = $('#v-data');
  let J = null, showAlt = false;

  root.innerHTML = `
    <div class="dt-bar">
      <div class="dt-title"><span class="eyebrow" id="dtEyebrow"></span><h2 id="dtTitle" class="ja"></h2></div>
      <div class="dt-legend" id="dtLegend"></div>
      <label class="dt-alt" id="dtAltWrap"><input type="checkbox" id="dtAlt"> もし列が満杯なら</label>
    </div>
    <div class="dt-main">
      <div class="dt-scroll scroll" id="dtScroll"></div>
      <aside class="dt-detail scroll" id="dtDetail" aria-live="polite"></aside>
    </div>`;

  const STATE_VAR = { app: 'var(--l-app)', os: 'var(--l-os)', osapp: 'var(--l-os)', kernel: 'var(--l-kernel)', emu: 'var(--l-emu)' };
  const CTX = { user: 'ctx.user', sys: 'ctx.syscall', svc: 'ctx.service', irq: 'ctx.irq' };
  function columns() {
    if (!showAlt || !J.alts.length) return J.cols;
    const out = [];
    for (const c of J.cols) { out.push(c); if (c.key === J.altAfter) out.push(...J.alts); }
    return out;
  }
  // a row's line: it starts where the row first gets a state (or at the start when it persists),
  // changes colour where a cell sets a new state, and ends at its `until`
  function segments(r, cols) {
    const idx = (k) => cols.findIndex((c) => c.key === k);
    const segs = [];
    let state = r.persist || null, from = r.persist ? 0 : null;
    const endKey = r.persist ? cols[cols.length - 1].key : r.until;
    const endI = endKey && idx(endKey) >= 0 ? idx(endKey) : cols.length - 1;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.alt) continue;
      if (i > endI) break;
      const cell = c.cells[r.id];
      if (cell && cell.state && cell.state !== state) {
        if (state && from != null) segs.push({ from, to: i, state, open: from === 0 && !!r.persist });
        state = cell.state; from = i;
      }
      if (i === endI && state && from != null) { segs.push({ from, to: i, state, open: from === 0 && !!r.persist, tail: !!r.persist }); state = null; }
    }
    return segs;
  }
  function cellText(cell) {
    const op = JY.OPS[cell.op];
    if (!op) return '';
    if (cell.op === 'word') return cell.extra.t;
    if (cell.extra.t && cell.op !== 'ride') return cell.extra.t;
    return op.t;
  }
  const curKey = () => { const f = NX.topOf(NX.state.stack); return f.id + ':' + f.i; };
  // An outer step that a paper draws in detail (UI 5 「並べる」 is the gateway paper's 8) stands for
  // that paper's column: the fold rule of seq-plus, with every paper open.
  const foldCache = {};
  function columnFor(cols) {
    const k = curKey();
    if (cols.some((c) => c.key === k)) return { key: k, folded: false };
    const fid = NX.state.stack[0].id, sd = NX.seqdraw;
    if (!foldCache[fid]) {
      const flow = A.flows.find((f) => f.id === fid);
      foldCache[fid] = sd.model(fid, window.SEQM.allRefIds(sd.X, flow)).m.folds;
    }
    const to = foldCache[fid].get(sd.rowKeyOf(NX.state.stack));
    const st = to && sd.stackOfRowKey(to, null);
    if (!st) return { key: null };
    const f = NX.topOf(st);
    return { key: f.id + ':' + f.i, folded: true };
  }

  // the outer step a paper's step draws (the gateway paper's 8 is UI 5 「並べる」): 'os.gateway:7' → '5'
  const foldBack = {};
  function foldsOf(fid) {
    if (foldBack[fid]) return foldBack[fid];
    const sd = NX.seqdraw, out = {};
    const flow = A.flows.find((f) => f.id === fid);
    const folds = sd.model(fid, window.SEQM.allRefIds(sd.X, flow)).m.folds;
    for (const [outer, inner] of folds) {
      const so = sd.stackOfRowKey(outer, null), si = sd.stackOfRowKey(inner, null);
      if (!so || !si) continue;
      const fo = NX.topOf(so), fi = NX.topOf(si);
      out[fi.id + ':' + fi.i] = so.map((x) => TR[x.id].labels[x.i]).join('›');
    }
    return (foldBack[fid] = out);
  }
  // where a paper is entered, as the walk numbers it: 「4›」, 「4›8›」
  const prefixOf = (paperId, fid) => {
    const st = NX.paperEntry(paperId, fid);
    return st ? st.slice(0, -1).map((x) => TR[x.id].labels[x.i]).join('›') + '›' : '';
  };
  let JALL = null;
  function render() {
    const fid = NX.state.stack[0].id;
    if (!JALL) JALL = JY.buildJourneys(A);
    J = JALL[fid];
    if (!J) { $('#dtScroll').innerHTML = '<p class="dt-none">この流れのデータの表はありません。</p>'; return; }
    $('#dtEyebrow').innerHTML = `<b>${esc(TR[fid].tab)}</b>・${J.cols.length} 手順（中の紙をその場に開いた）・${J.rows.length} 行`;
    $('#dtTitle').textContent = J.lead;
    $('#dtAltWrap').hidden = !J.alts.length;
    $('#dtAlt').checked = showAlt;
    const legendStates = J.id === 'ui' ? ['app', 'osapp', 'os'] : ['emu', 'kernel', 'os', 'app'];
    const O = JY.OPS;
    const mk = (cls, t) => `<span class="dt-op ${cls}">${esc(t)}</span>`;
    $('#dtLegend').innerHTML = `<div class="dt-lrow"><span class="dt-lk">線の色＝値のあるメモリ</span>` + legendStates.map((s) => `<span class="dt-li"><i class="dt-sw st-${s}"></i>${esc(JY.STATES[s].name)}</span>`).join('') + `</div>`
      + `<div class="dt-lrow"><span class="dt-lk">印</span><span class="dt-li">${mk('solid', O.copy.t)}変える・動かす</span><span class="dt-li">${mk('line', O.read.t)}読む・使う</span>`
      + (J.id === 'ui' ? `<span class="dt-li">${mk('over', O.over.t)}アプリの値を捨てる</span><span class="dt-li">${mk('cond', O.swapq.t)}この要求ではしない</span><span class="dt-li">${mk('word', '#2')}何語目</span><span class="dt-li">${mk('zero', '0')}詰めない</span>` : `<span class="dt-li">${mk('cond', O.addq.t)}分かれ道のどれか</span>`)
      + `<span class="dt-li"><span class="dt-dot"></span>運ばれるだけ</span>${J.id === 'ui' ? '<span class="dt-li"><span class="dt-drift">!</span>地図とコードで食い違い</span>' : ''}</div>`;
    const cols = columns();
    const at = columnFor(cols);
    const ci = at.key ? cols.findIndex((c) => c.key === at.key) : -1;
    // the head: where it runs, which paper, the step
    const runs = (keyOf) => {
      const out = [];
      cols.forEach((c, i) => { const k = keyOf(c); const last = out[out.length - 1]; if (last && last.k === k) last.n++; else out.push({ k, n: 1, i }); });
      return out;
    };
    const ctxName = (k) => { const reg = (J.flow.regions || []).find((r) => r.node === CTX[k]); return reg ? NX.ctxShort(reg) : (A.nodes[CTX[k]] || {}).title || k; };
    // fixed widths: every column the same (narrow ones narrower), so all the steps fit and a long tag
    // never widens its column
    const phoneW = matchMedia('(max-width: 760px)').matches;
    const LW = phoneW ? 112 : 164, CW = 44, NW = 24;
    const tableW = LW + cols.reduce((a, c) => a + (c.narrow ? NW : CW), 0);
    let h = `<table class="dt" style="width:${tableW}px"><colgroup><col style="width:${LW}px">${cols.map((c) => `<col style="width:${c.narrow ? NW : CW}px">`).join('')}</colgroup><thead>`;
    h += `<tr class="dt-ctx"><th class="dt-lh">走る所</th>${runs((c) => c.ctx).map((r) => `<th colspan="${r.n}"><span title="${esc(ctxName(r.k))}">${esc(ctxName(r.k))}</span></th>`).join('')}</tr>`;
    h += `<tr class="dt-paper"><th class="dt-lh">中の紙</th>${runs((c) => c.paper || '').map((r) => `<th colspan="${r.n}">${r.k ? `<span title="${esc(TR[r.k].title)}（${esc(prefixOf(r.k, fid))} から入る紙。番号は歩くと同じ）"><b>${esc(prefixOf(r.k, fid))}</b> ${esc(TR[r.k].title)}</span>` : ''}</th>`).join('')}</tr>`;
    const folds = foldsOf(fid);
    h += `<tr class="dt-head"><th class="dt-lh">手順<small>番号は歩くと同じ</small><small>押すと選ぶ</small></th>${cols.map((c, i) => {
      const lines = c.narrow ? [c.tiny || ''] : c.head || [c.verb || ''];
      const t = TR[c.src], walkLabel = (t.kind === 'paper' ? prefixOf(c.src, fid) : '') + t.labels[c.i];
      const eq = folds[c.key] ? `<span class="dt-eq" title="外の ${esc(folds[c.key])} は、この紙の手順と同じこと">＝${esc(folds[c.key])}</span>` : '';
      return `<th class="${c.narrow ? 'narrow' : ''}${i === ci ? ' now' : ''}${c.alt ? ' alt' : ''}${c.security ? ' sec' : ''}" data-col="${esc(c.key)}" title="${esc(NX.trackName(t) + ' の ' + walkLabel + '：' + c.label)}"><button type="button" data-col="${esc(c.key)}"><span class="num${i === ci ? ' now' : ''}${c.alt ? ' alt' : ''}">${esc(t.labels[c.i])}</span><span class="dt-hw${c.mono ? ' mono' : ''}">${lines.map(esc).join('<br>')}</span>${eq}${c.drift ? '<span class="dt-drift" title="地図とコードで食い違い（押すと右に引用）">!</span>' : ''}</button></th>`;
    }).join('')}</tr>`;
    // what happens at a column, in a word: one cell across the columns, each tag centred on its column,
    // on the upper line unless it would touch the one before
    const colLeft = [];
    cols.reduce((x, c, i) => { colLeft[i] = x; return x + (c.narrow ? NW : CW); }, 0);
    const colMid = (i) => colLeft[i] + (cols[i].narrow ? NW : CW) / 2;
    const lastEnd = [-1e9, -1e9];
    let tags = '';
    cols.forEach((c, i) => {
      if (!c.ann) return;
      const w = NX.textW(c.ann.t, 11, 650) + 14, x = colMid(i);
      const lo = lastEnd[0] + 4 > x - w / 2 ? 1 : 0;
      lastEnd[lo] = x + w / 2;
      tags += `<span class="dt-anntag${lo ? ' low' : ''}" style="left:${x}px">${esc(c.ann.t)}</span>`;
    });
    const nowBand = ci >= 0 ? `<i class="dt-ann-now" style="left:${colLeft[ci]}px;width:${cols[ci].narrow ? NW : CW}px"></i>` : '';
    h += `<tr class="dt-ann"><th class="dt-lh">ここで</th><th class="dt-ann-c" colspan="${cols.length}"><div class="dt-ann-in">${nowBand}${tags}</div></th></tr></thead><tbody>`;
    // a mark wider than its column moves a little away from the mark next to it
    const markW = (cell) => {
      const op = JY.OPS[cell.op];
      if (!op || op.cls === 'dot') return 8;
      return Math.min(54, NX.textW(cellText(cell), 11, 700) * 0.96 + 8);
    };
    let group = null;
    for (const r of J.rows) {
      if (r.group !== group) { group = r.group; h += `<tr class="dt-grp"><th class="dt-lh" colspan="1">${esc(J.groups[group] || '')}</th><td colspan="${cols.length}"></td></tr>`; }
      const segs = segments(r, cols);
      // each cell draws two halves: the line coming in from the left and the line going on to the right
      const leftOf = (i) => segs.find((s) => (s.from < i && s.to >= i) || (s.open && i === 0));
      const rightOf = (i) => segs.find((s) => (s.from <= i && s.to > i) || (s.tail && i === s.to));
      const special = r.id === 'owner' && J.id === 'ui';
      h += `<tr class="dt-row${special ? ' key' : ''}" data-row="${esc(r.id)}"><th class="dt-lh"><div class="dt-rl"><span class="dt-fn${/^[\x20-\x7e]+$/.test(r.name) ? ' mono' : ''}">${esc(r.name)}</span><span class="dt-ft${/^[\x20-\x7e]+$/.test(r.type || r.sub || '') ? ' mono' : ''}">${esc(r.type || r.sub || '')}</span></div>${special ? '<span class="tag danger">ここが要</span>' : ''}</th>`;
      const dx = new Array(cols.length).fill(0);
      let prevI = -1;
      cols.forEach((c, i) => {
        const cell = c.cells[r.id];
        if (!cell || !cell.op) return;
        if (prevI >= 0) {
          const a = markW(cols[prevI].cells[r.id]), b = markW(cell);
          const gap = colMid(i) + dx[i] - b / 2 - (colMid(prevI) + dx[prevI] + a / 2);
          if (gap < 2) { const d = (2 - gap) / 2; dx[prevI] -= d; dx[i] += d; }
        }
        prevI = i;
      });
      cols.forEach((c, i) => {
        const cell = c.cells[r.id];
        const sl = leftOf(i), sr = rightOf(i);
        let line = '';
        if (sl) line += `<i class="dt-line l st-${sl.state}"></i>`;
        if (sr) line += `<i class="dt-line r st-${sr.state}"></i>`;
        let mark = '';
        if (cell && cell.op) {
          const op = JY.OPS[cell.op];
          if (op.cls === 'dot') mark = `<span class="dt-dot" title="${esc(op.d)}"></span>`;
          else mark = `<span class="dt-op ${op.cls}${cell.op === 'over' ? ' over' : ''}"${dx[i] ? ` style="transform:translateX(${dx[i].toFixed(1)}px)"` : ''} title="${esc(op.d + (cell.extra.v ? '　値：' + cell.extra.v : ''))}">${esc(cellText(cell))}</span>`;
        }
        h += `<td class="${i === ci ? 'now' : ''}${c.narrow ? ' narrow' : ''}${c.alt ? ' alt' : ''}" data-col="${esc(c.key)}">${line}${mark}</td>`;
      });
      h += '</tr>';
    }
    h += '</tbody></table>';
    const sc = $('#dtScroll');
    const keep = sc.scrollLeft;
    sc.innerHTML = h;
    sc.scrollLeft = keep;
    const th = sc.querySelector('th.now');
    if (th) {
      const r = th.getBoundingClientRect(), b = sc.getBoundingClientRect(), lh = 200;
      if (r.left < b.left + lh || r.right > b.right) sc.scrollLeft += r.left - b.left - lh - (b.width - lh) / 2 + r.width / 2;
    }
    renderDetail(cols, ci >= 0 ? cols[ci] : null, at.folded);
  }

  // ---------------------------------------------------------------- the detail: the words and the code behind each mark
  function codeLine(path, find) {
    const t = window.ATLAS_SRC && window.ATLAS_SRC[path];
    if (!t) return { n: null, text: find.trim() };
    const lines = t.split('\n');
    const f = find.trim();
    for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith(f)) return { n: i + 1, text: lines[i].trim() };
    return { n: null, text: f };
  }
  function quote(c, w) {
    switch (w.k) {
      case 'label': return { q: c.label, src: '手順の文' };
      case 'field': {
        const n = A.nodes[w.schema || 'schema.request'];
        const f = (n.fields || []).find((x) => x[1] === w.field);
        return f ? { q: f[2], src: `${n.title} の ${w.field}` } : null;
      }
      case 'node': { const n = A.nodes[w.id]; return n ? { q: JY.plain(A, n.text), hi: w.part, src: n.title, node: w.id } : null; }
      case 'param': { const n = A.nodes[w.id], p = ((n && n.api && n.api.params) || []).find((x) => x[0] === w.name); return p ? { q: JY.plain(A, p[1]), src: `${n.title} の引数 ${w.name}` } : null; }
      case 'data': { const d = c.data; return d ? { q: [d.label, d.type, d.note && JY.plain(A, d.note)].filter(Boolean).join('　'), src: '渡すデータ' } : null; }
      case 'src': return { code: w };
      default: return null;
    }
  }
  function whyHTML(c, cell) {
    let h = '';
    for (const w of (cell.why || []).filter((x) => x.k !== 'label')) {
      const q = quote(c, w);
      if (!q) continue;
      if (q.code) {
        const ln = codeLine(q.code.path, q.code.find);
        h += `<div class="dt-code"><span class="dt-src">${esc(q.code.path.split('/').pop())}${ln.n ? ':' + ln.n : ''}</span><code>${esc(ln.text)}</code>${q.code.note ? `<span class="dt-note">${esc(q.code.note)}</span>` : ''}</div>`;
        continue;
      }
      let text = esc(q.q);
      if (q.hi) text = text.replace(esc(q.hi), `<mark>${esc(q.hi)}</mark>`);
      h += `<div class="dt-q"><span class="dt-src">${q.node ? NX.nodeChip(q.node) : esc(q.src)}</span><p>「${text}」</p></div>`;
    }
    return h;
  }
  function renderDetail(cols, c, folded) {
    const box = $('#dtDetail');
    if (!c) {
      const f = NX.topOf(NX.state.stack), t = TR[f.id];
      box.innerHTML = `<div class="dt-sec"><p class="dt-p">今の手順（${esc(NX.trackName(t))} の ${esc(t.labels[f.i])}「${esc(NX.stepTitle(t.steps[f.i]))}」）は、この表の列にありません。列を押すと、その手順が選ばれます。</p></div>` + driftHTML();
      return;
    }
    const t = TR[c.src];
    const f0 = NX.topOf(NX.state.stack), t0 = TR[f0.id];
    let h = folded ? `<p class="dt-fold">今の手順は${esc(NX.trackName(t0))}の ${esc(t0.labels[f0.i])}「${esc(NX.stepTitle(t0.steps[f0.i]))}」。中の紙を開いたこの表では、それを描く紙の手順の列を選んでいます。</p>` : '';
    h += `<div class="dt-sec"><div class="dt-step"><span class="num now${c.alt ? ' alt' : ''}">${esc(t.labels[c.i])}</span><div><h3>${esc(c.verb || (c.head || []).join(c.mono ? ' ' : '') || NX.stepTitle(c.step))}</h3><small>${esc(NX.trackName(TR[NX.state.stack[0].id]))} の ${esc((t.kind === 'paper' ? prefixOf(c.src, NX.state.stack[0].id) : '') + t.labels[c.i])}${t.kind === 'paper' ? `（${esc(t.title)}）` : ''}・${esc(NX.KIND_STEP[c.kind] || c.kind)}</small></div></div>
      <div class="dt-ft2">${NX.boxChip(t, c.from)}<span class="ar">→</span>${NX.boxChip(t, c.to)}</div><p class="dt-p ja">${NX.linkify(c.label, { br: false })}</p>${c.colNote ? `<p class="dt-p dt-colnote">${esc(c.colNote)}</p>` : ''}</div>`;
    if (c.security) {
      h += `<div class="dt-sec dt-key"><h4>アプリは名乗れない</h4><p class="dt-p">アプリが Request の owner に何を書いても、gateway は呼んだプロセスの pid で上書きする。OS 側はこの owner でノードの持ち主を決め、返事の宛先にする。</p></div>`;
    }
    const rows = [];
    for (const r of J.rows) {
      const cell = c.cells[r.id];
      if (!cell || !cell.op || cell.op === 'ride') continue;
      const op = JY.OPS[cell.op];
      rows.push(`<li><div class="dt-li-h"><span class="dt-fn${/^[\x20-\x7e]+$/.test(r.name) ? ' mono' : ''}">${esc(r.name)}</span><span class="dt-op ${op.cls}${cell.op === 'over' ? ' over' : ''}">${esc(cellText(cell))}</span>${cell.extra.v ? `<span class="dt-v">値：<b>${esc(cell.extra.v)}</b></span>` : ''}</div>${op.cls === 'cond' ? `<p class="dt-p muted">${esc(op.d)}</p>` : ''}${cell.extra.why2 ? `<p class="dt-p muted">${esc(cell.extra.why2)}</p>` : ''}${whyHTML(c, cell)}</li>`);
    }
    const riders = J.rows.filter((r) => c.cells[r.id] && c.cells[r.id].op === 'ride').map((r) => r.name);
    h += `<div class="dt-sec"><h4>${J.id === 'ui' ? 'この手順で、フィールドに起きたこと' : 'この手順で、値に起きたこと'}</h4>${rows.length ? `<ul class="dt-list">${rows.join('')}</ul>` : '<p class="dt-p muted">この手順で印の付くものはない。</p>'}${riders.length ? `<p class="dt-p muted">そのまま運ばれる：${riders.map(esc).join('・')}</p>` : ''}</div>`;
    if (c.drift && JY.DRIFT[c.drift]) h += driftHTML(c.drift);
    $('#dtDetail').innerHTML = h;
  }
  function driftHTML(only) {
    const keys = only ? [only] : Object.keys(JY.DRIFT);
    if (J.id !== 'ui') return '';
    return keys.map((k) => {
      const d = JY.DRIFT[k];
      return `<div class="dt-sec dt-driftbox"><h4><span class="dt-drift">!</span>${esc(d.title)}</h4>${d.map.map((m) => `<div class="dt-q"><span class="dt-src">${m.node ? NX.nodeChip(m.node) : esc(m.field.join(' の '))}</span><p>「${esc(m.text)}」</p></div>`).join('')}<p class="dt-p">${esc(d.count)}</p>${d.code.map((x) => { const ln = codeLine(x.path, x.find); return `<div class="dt-code"><span class="dt-src">${esc(x.path.split('/').pop())}${ln.n ? ':' + ln.n : ''}</span><code>${esc(ln.text)}</code><span class="dt-note">${esc(x.note)}</span></div>`; }).join('')}<p class="dt-p muted">${esc(d.shown)}</p></div>`;
    }).join('');
  }

  V.render = render;
  V.onResize = render;
  root.addEventListener('change', (e) => { if (e.target.id === 'dtAlt') { showAlt = e.target.checked; render(); } });
  root.addEventListener('click', (e) => {
    if (e.target.closest('button.chip[data-node]')) return;
    const el = e.target.closest('[data-col]');
    if (!el) return;
    const c = columns().find((x) => x.key === el.dataset.col);
    if (!c) return;
    const st = NX.stackOfStep(c.src, c.i, NX.state.stack[0].id);
    if (st) { NX.walk.stopPlay(); NX.set({ stack: st }, { push: true }); }
  });
  V.onKey = (e) => {
    if (!J) return false;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cols = columns(), at = columnFor(cols), i = cols.findIndex((c) => c.key === at.key);
      const n = cols[NX.clamp((i < 0 ? 0 : i) + (e.key === 'ArrowRight' ? 1 : -1), 0, cols.length - 1)];
      if (n) { const st = NX.stackOfStep(n.src, n.i, NX.state.stack[0].id); if (st) NX.set({ stack: st }); }
      e.preventDefault();
      return true;
    }
    return false;
  };
})();
