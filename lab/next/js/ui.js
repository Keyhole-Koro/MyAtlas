// Shared pieces: the header (flows, views, search, theme, help), the node card used by every view,
// the preview of a [[link]], the toast. window.NX.ui.
(function () {
  'use strict';
  const NX = window.NX, { A, C, esc, $, TR } = NX;
  const MX = window.MX;
  const ui = (NX.ui = {});

  // ---------------------------------------------------------------- toast
  let toastT = 0;
  ui.toast = (html) => {
    const el = $('#toast');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 1800);
  };

  // ---------------------------------------------------------------- header
  function renderHeader() {
    $('.brand-mark').innerHTML = NX.STACK.map((l) => `<i style="background:${NX.layerVar(l)}"></i>`).join('');
    $('#brandSub').textContent = A.title;
    const flow = NX.state.stack[0].id;
    $('#flows').innerHTML = NX.FLOWS.map((id) => `<button type="button" role="tab" data-flow="${esc(id)}" aria-selected="${id === flow}" title="${esc(TR[id].title)}">${esc(TR[id].tab)}</button>`).join('');
    $('#views').innerHTML = NX.VIEWS.map((v, k) => `<button type="button" role="tab" data-view="${v.id}" aria-selected="${v.id === NX.state.view}" title="${esc(v.name)}（${k + 1}）">${esc(v.name)}</button>`).join('');
    $('.search-i').innerHTML = NX.ICON.search;
    $('#searchBtn').innerHTML = NX.ICON.search;
    $('#helpBtn').innerHTML = NX.ICON.help;
    renderTheme();
  }
  ui.renderHeader = renderHeader;
  ui.syncHeader = () => {
    const flow = NX.state.stack[0].id;
    for (const b of NX.$$('#flows button')) b.setAttribute('aria-selected', String(b.dataset.flow === flow));
    for (const b of NX.$$('#views button')) b.setAttribute('aria-selected', String(b.dataset.view === NX.state.view));
  };

  // ---------------------------------------------------------------- theme: the system's, or the reader's
  const root = document.documentElement;
  const sys = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    const pick = root.getAttribute('data-theme-pick') || 'auto';
    const dark = pick === 'dark' || (pick === 'auto' && sys && sys.matches);
    const was = root.getAttribute('data-theme');
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (was !== root.getAttribute('data-theme')) NX.emit({ theme: true }, {});
  }
  function renderTheme() {
    const pick = root.getAttribute('data-theme-pick') || 'auto';
    const b = $('#themeBtn');
    b.innerHTML = pick === 'dark' ? NX.ICON.moon : pick === 'light' ? NX.ICON.sun : NX.ICON.auto;
    const name = { auto: 'システムに合わせる', light: '明るい', dark: '暗い' }[pick];
    b.title = `色：${name}（押すと切り替え）`;
    b.setAttribute('aria-label', b.title);
  }
  ui.cycleTheme = () => {
    const order = ['auto', 'light', 'dark'];
    const pick = root.getAttribute('data-theme-pick') || 'auto';
    const next = order[(order.indexOf(pick) + 1) % 3];
    root.setAttribute('data-theme-pick', next);
    NX.store.set('theme', next === 'auto' ? null : next);
    applyTheme();
    renderTheme();
    ui.toast(`色：${{ auto: 'システムに合わせる', light: '明るい', dark: '暗い' }[next]}`);
  };
  if (sys && sys.addEventListener) sys.addEventListener('change', applyTheme);

  // ---------------------------------------------------------------- search over nodes and steps
  const INDEX = [];
  for (const [id, n] of Object.entries(A.nodes)) {
    const code = C.nodes[id];
    INDEX.push({ type: 'node', id, title: n.title, sub: `${NX.layerName(n.layer)}・${n.fn || id}`, layer: n.layer,
      keys: [n.title, id, n.fn || '', code ? code.symbol || '' : ''].map((x) => x.toLowerCase()), text: NX.plain(n.text).toLowerCase() });
  }
  for (const t of Object.values(TR)) {
    t.steps.forEach((s, i) => {
      INDEX.push({ type: 'step', track: t.id, i, title: `${t.labels[i]}  ${NX.stepTitle(s)}`, sub: `${NX.trackName(t)}・${NX.boxName(t.box[s.from])} → ${NX.boxName(t.box[s.to])}`,
        keys: [s.verb || '', NX.boxName(t.box[s.from]), NX.boxName(t.box[s.to])].map((x) => x.toLowerCase()), text: (s.label || '').toLowerCase() });
    });
  }
  function score(e, q) {
    let best = 0;
    e.keys.forEach((k, j) => {
      if (!k) return;
      if (k === q) best = Math.max(best, 100 - j);
      else if (k.startsWith(q)) best = Math.max(best, 80 - j);
      else if (k.includes(q)) best = Math.max(best, 60 - j);
    });
    if (!best && e.text.includes(q)) best = 20;
    // nothing matched: not a result (a node used to get 1 for nothing)
    return best ? best + (e.type === 'node' ? 1 : 0) : 0;
  }
  const hl = (s, q) => {
    const k = s.toLowerCase().indexOf(q);
    return k < 0 ? esc(s) : esc(s.slice(0, k)) + '<mark>' + esc(s.slice(k, k + q.length)) + '</mark>' + esc(s.slice(k + q.length));
  };
  let results = [], sel = 0;
  function runSearch() {
    const q = $('#q').value.trim().toLowerCase();
    const box = $('#qres');
    if (!q) { box.hidden = true; results = []; return; }
    // one list, best first: an exact name or verb before a word met in a sentence; steps of the flow
    // being read before the other flow's
    const flow = NX.state.stack[0].id;
    const here = (e) => (e.type === 'step' && (e.track === flow || NX.flowsOfPaper(e.track).includes(flow)) ? 0.5 : 0);
    results = INDEX.map((e) => ({ e, s: score(e, q) })).filter((x) => x.s > 0).map((x) => ({ ...x, s: x.s + here(x.e) }))
      .sort((a, b) => b.s - a.s).slice(0, 14).map((x) => x.e);
    sel = 0;
    let h = '';
    if (!results.length) h = `<li class="qnone">「${esc(q)}」に当たる節も手順も見つかりません</li>`;
    h += results.map((r) => item(r, q)).join('');
    box.innerHTML = h;
    box.hidden = false;
    markSel();
  }
  function item(r, q) {
    const k = results.indexOf(r);
    if (r.type === 'node') {
      return `<li role="option" data-k="${k}"><span class="chip qk" style="--lc:${NX.layerVar(r.layer)}"><span>${esc(NX.KIND_NODE[A.nodes[r.id].kind] || '')}</span></span><span class="qt${NX.isAscii(r.title) ? ' code' : ''}">${hl(r.title, q)}</span><span class="qs">節・${esc(r.sub)}</span></li>`;
    }
    return `<li role="option" data-k="${k}"><span class="num qk${TR[r.track].steps[r.i].alt ? ' alt' : ''}">${esc(TR[r.track].labels[r.i])}</span><span class="qt">${hl(NX.stepTitle(TR[r.track].steps[r.i]), q)}</span><span class="qs">手順・${esc(r.sub)}</span></li>`;
  }
  function markSel() {
    for (const li of NX.$$('#qres li[data-k]')) li.setAttribute('aria-selected', String(Number(li.dataset.k) === sel));
    const on = $('#qres li[aria-selected="true"]');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function choose(k) {
    const r = results[k];
    if (!r) return;
    closeSearch();
    if (r.type === 'node') ui.openNode(r.id, { push: true });
    else {
      const st = NX.stackOfStep(r.track, r.i);
      if (st) NX.set({ stack: st }, { push: true });
    }
  }
  function closeSearch() {
    $('#qres').hidden = true;
    $('#q').value = '';
    $('#search').classList.remove('open');
    $('#q').blur();
  }
  ui.openSearch = () => {
    $('#search').classList.add('open');
    $('#q').focus();
  };
  ui.closeSearch = closeSearch;
  function wireSearch() {
    const q = $('#q');
    q.addEventListener('input', runSearch);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); markSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); markSel(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    });
    $('#qres').addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-k]');
      if (li) { e.preventDefault(); choose(Number(li.dataset.k)); }
    });
    q.addEventListener('blur', () => setTimeout(() => { $('#qres').hidden = true; $('#search').classList.remove('open'); }, 120));
    $('#searchBtn').addEventListener('click', ui.openSearch);
  }

  // ---------------------------------------------------------------- help
  ui.openHelp = () => {
    const box = $('#help');
    const kinds = Object.keys(NX.ARROW).map((k) => `${NX.kindIcon(k)}<span>${esc(NX.KIND_STEP[k])}</span>`).join('');
    box.innerHTML = `<div class="help-box">
      <button class="btn icon ghost help-x" type="button" data-help-close title="閉じる（Esc）" aria-label="閉じる">${NX.ICON.close}</button>
      <h2>次のビューア</h2>
      <p class="lead">${esc(A.title)}を、5 つの見方で読む。どの見方でも、選んだ手順と節は同じ。アドレスに今の場所が残るので、リンクと戻る・進むが効く。</p>
      <div class="help-grid">
        <section><h3>見方</h3><ul class="vlist">
          <li><b>歩く</b>流れを手順 1 から。道のり・手順・やりとり図・コードの行が一緒に進む</li>
          <li><b>地図</b>流れと中の紙を路線に、節を駅に。同じ節は乗り換え駅</li>
          <li><b>やりとり</b>手順の文・矢印・記録の時刻を同じ行に。中の紙はその場で開く</li>
          <li><b>記録</b>Editor で「x」を打った 1 回を、スレッドごとの呼び出しの段で</li>
          <li><b>データ</b>Request のフィールドを手順ごとに。色は値のあるメモリ</li>
        </ul></section>
        <section><h3>キー</h3><dl>
          <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>前・次の手順</dd>
          <dt><kbd>Enter</kbd></dt><dd>中の紙に入る</dd>
          <dt><kbd>Esc</kbd></dt><dd>紙から出る・閉じる</dd>
          <dt><kbd>Space</kbd></dt><dd>自動で歩く・止める</dd>
          <dt><kbd>Home</kbd> <kbd>End</kbd></dt><dd>最初・最後の手順</dd>
          <dt><kbd>/</kbd></dt><dd>節と手順をさがす</dd>
          <dt><kbd>1</kbd>〜<kbd>5</kbd></dt><dd>見方を切り替える</dd>
          <dt><kbd>?</kbd></dt><dd>この説明</dd>
        </dl></section>
        <section><h3>手順の 3 つの色</h3><dl>
          <dt><span class="num now">5</span></dt><dd>今の手順（動詞付き）</dd>
          <dt><span class="num passed">3</span></dt><dd>通った手順</dd>
          <dt><span class="num">8</span></dt><dd>これからの手順</dd>
          <dt><span class="num alt">A</span></dt><dd>もし：その手順の代わりに起こる</dd>
        </dl></section>
        <section><h3>矢印の種類</h3><div class="legend-k">${kinds}</div>
          <h3 style="margin-top:12px">コードの行の確かさ</h3><dl>
          <dt><span class="tag start">起きる行</span></dt><dd>地図（code.json）が記録した行</dd>
          <dt><span class="tag" style="outline:1.5px dashed var(--accent);outline-offset:-1.5px;color:var(--accent);background:none">たぶんここ</span></dt><dd>手順の文から推した行。手がかりを添える</dd>
          <dt><span class="tag">箱全体</span></dt><dd>行が分からない時は、箱のコード全体。コードの欄は見出しだけにたたむ（「コードを開く」で開く）</dd>
        </dl>
          <h3 style="margin-top:12px">札</h3><dl>
          <dt><span class="tag start">地図のはじめ</span></dt><dd>データの start。地図が最初に見せる手順（歩くのは手順 1 から）</dd>
          <dt><span class="dr-i">!</span></dt><dd>地図の文とコードが食い違う所。データの見方で、両方を引用して並べる</dd>
        </dl></section>
      </div></div>`;
    box.hidden = false;
    box.querySelector('[data-help-close]').focus();
  };
  ui.closeHelp = () => { $('#help').hidden = true; };

  // ---------------------------------------------------------------- the node card
  const LINK_KINDS = MX.KINDS;
  const stepRef = (t, i) => {
    const st = NX.stackOfStep(t.id, i);
    return `<button type="button" class="nc-step" data-stack="${esc(st ? NX.stackKey(st) : '')}"><span class="num${t.steps[i].alt ? ' alt' : ''}">${esc(t.labels[i])}</span><span class="nc-sv">${esc(NX.stepTitle(t.steps[i]))}</span></button>`;
  };
  // Where a node takes part: every step of every track that starts, ends or is told by it.
  function appearances(id) {
    const out = [];
    for (const t of Object.values(TR)) {
      const ids = [];
      t.steps.forEach((s, i) => {
        if (t.box[s.from].node === id || t.box[s.to].node === id || s.ref === id) ids.push(i);
      });
      const order = [];
      for (const i of t.main) { if (ids.includes(i)) order.push(i); for (const a of t.alts[i] || []) if (ids.includes(a)) order.push(a); }
      if (order.length) out.push({ t, steps: order });
    }
    return out;
  }
  function reasonText(r) {
    const title = (id) => NX.title(id);
    const mark = (str) => NX.esc(str || '').replace(/!?\[\[([^\]]+)\]\]/g, (m, id) => {
      const n = A.nodes[id];
      if (!n) return esc(id);
      return id === r.to ? `<mark>${esc(n.title)}</mark>` : `<span class="${NX.isAscii(n.title) ? 'mono' : ''}">${esc(n.title)}</span>`;
    });
    if (r.fam === 'step') {
      const s = r.step, w = r.walk, t = TR[w.id];
      const alt = s.alt ? `もし${esc(s.alt.when)}（${esc(t.labels[s.alt.at])} の代わり）　` : '';
      const rev = s.rev ? `<span class="muted">（値は ${esc(title(s.fromNode))} から ${esc(title(s.toNode))} へ）</span>` : '';
      return alt + mark(s.label) + rev;
    }
    if (r.k === 'paper') return `この紙に ${esc(title(r.to))} の箱がある${r.box && r.box.sub ? `（${esc(r.box.sub)}）` : ''}`;
    if (r.k === 'context') return `「${esc(r.region.label)}」の枠の中で走る`;
    if (r.k === 'shape') {
      if (r.sub === 'slot') return `${esc(title(r.from))} の中身は ${esc(title(r.to))}`;
      if (r.sub === 'field') return `フィールド <span class="mono">${esc(r.field[1])}</span> の型が ${esc(title(r.to))}`;
      if (r.sub === 'of') return `形は ${esc(title(r.to))}`;
      const s = r.step;
      return `手順 ${esc(TR[r.walk.id].labels[s.i])} で運ぶ値：<span class="mono">${esc(s.data.label + (s.data.fields ? '{' + s.data.fields.join(', ') + '}' : ''))}</span>`;
    }
    if (r.k === 'mention') {
      if (r.sub === 'embed') return `${esc(title(r.from))} の文の中に、${A.nodes[r.to].kind === 'figure' ? 'この図を載せる' : 'この節をその場で見せる'}`;
      if (r.sub === 'value') return `<span class="mono">${esc(r.key)}</span>：${mark(r.text)}`;
      if (r.sub === 'param') return `引数 <span class="mono">${esc(r.key)}</span>：${mark(r.text)}`;
      if (r.sub === 'op') return `操作「${esc(r.key)}」：${mark(r.text)}`;
      return mark(r.text);
    }
    return '';
  }
  function whereOf(r) {
    if (r.fam === 'step') {
      const t = TR[r.walk.id];
      return `<button type="button" class="nc-where" data-stack="${esc(NX.stackKey(NX.stackOfStep(t.id, r.step.i) || []))}">${esc(NX.trackName(t))} の ${esc(t.labels[r.step.i])}</button>`;
    }
    if (r.k === 'paper' || r.k === 'context') return `<span class="nc-where-t">${esc(NX.trackName(TR[r.walk.id]))}</span>`;
    return '';
  }
  const RANK = { call: 0, syscall: 0, msg: 0, signal: 0, return: 1, write: 1, read: 1, paper: 2, context: 3, shape: 4, mention: 5 };
  function backlinks(id) {
    const inc = MX.RELS.filter((r) => r.to === id && r.from !== id);
    const notes = MX.STEP_NOTES.filter((x) => x.to === id);
    const by = new Map();
    for (const r of inc) { if (!by.has(r.from)) by.set(r.from, []); by.get(r.from).push(r); }
    const order = [...by.keys()].sort((a, b) => Math.min(...by.get(a).map((r) => RANK[r.k])) - Math.min(...by.get(b).map((r) => RANK[r.k])) || MX.N[a].li - MX.N[b].li);
    let h = `<h4 class="nc-sec">指しているもの<span class="nc-cnt">${by.size} 節・${inc.length} 件${notes.length ? `＋手順の説明 ${notes.length}` : ''}</span><span class="nc-hint">だれが、なぜ</span></h4>`;
    if (!inc.length && !notes.length) return h + '<p class="nc-empty">この節を指しているものはありません。</p>';
    h += '<ul class="nc-back">';
    for (const other of order) {
      const rs = by.get(other).slice().sort((a, b) => RANK[a.k] - RANK[b.k]);
      h += `<li><div class="nc-who">${NX.nodeChip(other)}<span class="nc-who-k">${esc(NX.layerName(A.nodes[other].layer))}</span></div><ul class="nc-why">`;
      for (const r of rs) {
        h += `<li><span class="nc-rk">${r.fam === 'step' ? NX.kindIcon(r.step.kind) : ''}${esc(LINK_KINDS[r.k].short || LINK_KINDS[r.k].name)}</span>${whereOf(r)}<p>${reasonText(r)}</p></li>`;
      }
      h += '</ul></li>';
    }
    for (const x of notes) {
      const t = TR[x.walk.id];
      h += `<li><div class="nc-who">${stepRef(t, x.step.i)}<span class="nc-who-k">${esc(NX.trackName(t))}・手順の${esc(x.what)}</span></div><ul class="nc-why"><li><p>${reasonText({ k: 'mention', sub: 'text', text: x.text, to: id })}</p></li></ul></li>`;
    }
    return h + '</ul>';
  }
  // What the recorded run can say about a node: only what it logged.
  function traceLine(id) {
    const t = MX.traceOf(id);
    if (!t) return '';
    const fn = (s) => `<code>${esc(s)}</code>`;
    let body = '';
    if (t.type === 'func') body = `この関数（${fn(t.fn)}）に ${t.k} 回入った`;
    else if (t.type === 'part') body = `${NX.nodeChip(t.host)} の中の一部。記録は関数に入った回数だけで、${fn(t.fn)}${t.k ? ` には ${t.k} 回入った` : ' は記録の外'}`;
    else if (t.type === 'unwatched') body = t.sure ? `この関数（${fn(t.fn)}）は記録していない。記録したのは ${MX.SEEN_FNS} の関数` : `この関数（${fn(t.fn)}）は記録に出てこない`;
    else {
      const counted = t.near.filter(([, k]) => k > 0), outside = t.near.filter(([, k]) => !k);
      const CAUSE = { timer: 'タイマー', keyboard: 'キーボード', automation: 'automation', syscall: 'syscall' };
      const bits = ['記録は関数に入った回数と割り込みだけ。'];
      if (t.irq.length) bits.push(`割り込みは${t.irq.map(([c, k]) => `${CAUSE[c] || c} ${k} 回`).join('・')}。`);
      if (counted.length) bits.push((t.context ? 'この枠に描かれた関数に入った回数は、' : '手順でつながる関数に入った回数は、') + counted.map(([o, k]) => `${NX.nodeChip(o)} ${k} 回`).join('・') + '。');
      if (outside.length) bits.push(outside.map(([o]) => NX.nodeChip(o)).join('・') + ' は記録の外。');
      if (!counted.length && !outside.length && !t.irq.length) bits.splice(0, 1, '記録は関数に入った回数と割り込みだけで、この節は数えていない。');
      body = bits.join('');
    }
    return `<h4 class="nc-sec">記録<span class="nc-hint">${esc(NX.TRACE ? NX.TRACE.title : '')}</span></h4><p class="nc-trace">${body}</p>`;
  }
  function table(rows) {
    return `<table class="nc-table">${rows.map((r) => `<tr>${r.map((c, k) => `<td${k === r.length - 1 ? '' : ' class="k"'}>${c}</td>`).join('')}</tr>`).join('')}</table>`;
  }
  function nodeCardHTML(id) {
    const n = A.nodes[id];
    const loc = C.nodes[id];
    let h = `<header class="nc-head" style="--lc:${NX.layerVar(n.layer)}">
      <div class="nc-tags"><span class="chip" style="--lc:${NX.layerVar(n.layer)}"><span>${esc(NX.layerName(n.layer))}</span></span><span class="tag">${esc(NX.KIND_NODE[n.kind] || n.kind)}</span>${n.paper ? `<span class="tag paper">${NX.ICON.paper}中の紙あり</span>` : ''}<code class="nc-id">${esc(id)}</code></div>
      <button class="btn icon ghost nc-x" type="button" data-nc-close title="閉じる（Esc）" aria-label="閉じる">${NX.ICON.close}</button>
      <h3 class="nc-title${NX.isAscii(n.title) ? ' code' : ''}">${esc(n.title)}</h3></header><div class="nc-body scroll">`;
    const api = n.api || {};
    if (api.sig) h += `<pre class="nc-sig">${esc(api.sig)}</pre>`;
    // the text, with its figures in place
    const lines = String(n.text || '').split('\n');
    let prose = '';
    for (const line of lines) {
      const fig = /^!\[\[([^\]]+)\]\]$/.exec(line.trim());
      if (fig && A.nodes[fig[1]]) {
        const f = A.nodes[fig[1]];
        prose += `<figure class="nc-fig">${f.figure || ''}<figcaption>${NX.nodeChip(fig[1])} ${NX.linkify(f.text)}</figcaption></figure>`;
      } else if (line.trim()) prose += `<p class="nc-p">${NX.linkify(line)}</p>`;
    }
    if (n.figure) prose = `<figure class="nc-fig">${n.figure}</figure>` + prose;
    h += `<div class="nc-text">${prose}</div>`;
    if (api.params && api.params.length) h += `<h4 class="nc-sec">引数</h4>` + table(api.params.map(([k, v]) => [`<code>${esc(k)}</code>`, NX.linkify(v)]));
    if (api.ret) h += `<h4 class="nc-sec">返す</h4><p class="nc-p">${NX.linkify(api.ret)}</p>`;
    if (n.reg) h += `<h4 class="nc-sec">アドレス</h4><p class="nc-p"><code class="nc-reg">${esc(n.reg)}</code>${n.kind === 'hw' ? '<span class="muted">（32 ビットのレジスタ）</span>' : ''}</p>`;
    h += shapeHTML(id);
    if (n.fields && n.fields.length) h += `<h4 class="nc-sec">${n.kind === 'hw' ? 'ビット' : 'フィールド'}</h4>` + table(n.fields.map((f) => (f.length === 3 ? [`<code>${esc(f[0])}</code>`, `<code><b>${esc(f[1])}</b></code>`, NX.linkify(f[2])] : [`<code><b>${esc(f[0])}</b></code>`, NX.linkify(f[1] || '')])));
    if (n.values && n.values.length) h += `<h4 class="nc-sec">値</h4>` + table(n.values.map(([k, v]) => [`<code><b>${esc(k)}</b></code>`, NX.linkify(v || '')]));
    if (n.states && n.states.moves) h += `<h4 class="nc-sec">移り変わり<span class="nc-hint">${esc(n.states.field || '')}</span></h4>` + table(n.states.moves.map((m) => [`<code>${esc(m.from)}</code> → <code>${esc(m.to)}</code>`, `<span class="mono nc-fns">${esc((m.fns || []).join('・'))}</span>`]));
    if (n.run || n.kernel != null) h += `<h4 class="nc-sec">走るもの</h4><p class="nc-p">${esc(n.run || '')}${n.kernel ? '・カーネルの権限で走る' : ''}</p>`;
    if (loc && loc.path) {
      h += `<h4 class="nc-sec">コード</h4><div class="nc-code"><code><span class="nc-path">${esc(loc.path)}</span>${loc.start ? `<b class="nc-lines">:${loc.start}${loc.end > loc.start ? '–' + loc.end : ''}</b>` : ''}</code>${loc.start ? `<button type="button" class="btn small" data-code-node="${esc(id)}">${NX.ICON.code}コードを開く</button>` : ''}</div>`;
    } else if (n.code && n.code[0]) h += `<h4 class="nc-sec">コード</h4><div class="nc-code"><code>${esc(n.code[0])}</code></div>`;
    if (n.paper && TR[n.paper]) {
      const p = TR[n.paper];
      h += `<button type="button" class="nc-paper" data-paper="${esc(n.paper)}">${NX.ICON.paper}<span><b>中の紙を歩く</b><small>${esc(p.title)}・${esc(NX.countText(p))}</small></span>${NX.ICON.right}</button>`;
    }
    const ap = appearances(id);
    if (ap.length) {
      h += `<h4 class="nc-sec">出てくる手順<span class="nc-cnt">${ap.reduce((s, x) => s + x.steps.length, 0)}</span></h4><div class="nc-apps">`;
      for (const { t, steps } of ap) h += `<div class="nc-app"><span class="nc-app-t">${esc(NX.trackName(t))}</span><div class="nc-app-s">${steps.map((i) => stepRef(t, i)).join('')}</div></div>`;
      h += '</div>';
    }
    h += backlinks(id);
    h += traceLine(id);
    return h + '</div>';
  }
  ui.nodeCardHTML = nodeCardHTML;
  // A data structure (the reference viewer's 形): its kind and its parts as the code names them, the
  // operations on it with their cost, and what always holds. A store with the shape of another (the
  // request ring is a kernel.channel) shows that one's, saying so.
  const SHAPE_NAME = { ring: 'リング', list: 'リスト', table: '表', tree: '木' };
  function shapeHTML(id) {
    const n = A.nodes[id];
    if (!n.shape) return '';
    const host = n.shape.of || id, hn = A.nodes[host] || n, sh = hn.shape || {};
    const ops = [...(hn.ops || []), ...(host !== id ? n.ops || [] : [])];
    const inv = [...(hn.invariants || []), ...(host !== id ? n.invariants || [] : [])];
    let h = `<h4 class="nc-sec">形${sh.kind ? `：${esc(SHAPE_NAME[sh.kind] || sh.kind)}` : ''}${host !== id ? `<span class="nc-hint">${NX.nodeChip(host)} の 1 つ</span>` : ''}</h4>`;
    const roles = Object.values(sh.roles || {}).map((r) => `<span class="nc-role"><code>${esc(r.name || r.text || '')}</code>${r.num != null ? ` = ${NX.fmt(r.num)}` : ''}${r.unit ? ` ${esc(r.unit)}` : ''}</span>`);
    if (roles.length) h += `<p class="nc-roles">${roles.join('')}<span class="muted">（コードから）</span></p>`;
    if (ops.length) {
      h += `<ul class="nc-ops">${ops.map((o) => `<li><div class="nc-op-h">${o.node && A.nodes[o.node] ? NX.nodeChip(o.node) : `<code>${esc(String(o.name).replace(/^\[\[|\]\]$/g, ''))}</code>`}${o.kind ? `<span class="tag">${esc(o.kind)}</span>` : ''}${o.cost ? `<span class="nc-cost">${esc(o.cost)}</span>` : ''}</div><p>${NX.linkify(o.text || '')}</p></li>`).join('')}</ul>`;
    }
    for (const t of inv) h += `<p class="nc-inv"><span class="tag">不変</span>${NX.linkify(t)}</p>`;
    return h;
  }
  ui.openNode = (id, opt = {}) => { if (A.nodes[id]) NX.set({ node: id }, { push: opt.push !== false, source: 'node' }); };
  ui.closeNode = () => NX.set({ node: null }, { push: true });
  function renderNodeCard() {
    const box = $('#ncard');
    const id = NX.state.node;
    if (!id || !A.nodes[id]) { box.hidden = true; box.innerHTML = ''; $('#scrim').hidden = true; return; }
    box.innerHTML = nodeCardHTML(id);
    box.hidden = false;
    $('#scrim').hidden = !matchMedia('(max-width: 760px)').matches;
    box.querySelector('.nc-body').scrollTop = 0;
  }
  ui.renderNodeCard = renderNodeCard;

  // ---------------------------------------------------------------- the preview of a link
  let tipT = 0, tipFor = null;
  function preview(id) {
    const n = A.nodes[id];
    const first = NX.plain(String(n.text || '').split('\n')[0]).split('。')[0];
    const nIn = new Set(MX.RELS.filter((r) => r.to === id && r.from !== id).map((r) => r.from)).size;
    const ap = appearances(id).reduce((s, x) => s + x.steps.length, 0);
    return `<div class="tip-k">${esc(NX.layerName(n.layer))}・${esc(NX.KIND_NODE[n.kind] || n.kind)}</div><b class="${NX.isAscii(n.title) ? 'mono' : ''}">${esc(n.title)}</b>${n.api && n.api.sig ? `<div class="mono" style="font-size:11px;margin-top:2px">${esc(n.api.sig)}</div>` : ''}<div style="margin-top:4px">${esc(first)}${first ? '。' : ''}</div><div class="tip-k" style="margin-top:4px">手順 ${ap}・指しているもの ${nIn} 節　押すとカード</div>`;
  }
  ui.showTip = (x, y, html) => {
    const tip = $('#tip');
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px';
    tip.style.top = (y + 18 + r.height > innerHeight - 8 ? y - r.height - 12 : y + 18) + 'px';
  };
  ui.hideTip = () => { $('#tip').hidden = true; tipFor = null; clearTimeout(tipT); };
  function wirePreview() {
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest && e.target.closest('button.chip[data-node]');
      if (!el || el === tipFor) return;
      tipFor = el;
      clearTimeout(tipT);
      tipT = setTimeout(() => {
        if (tipFor !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        ui.showTip(r.left, r.bottom - 14, preview(el.dataset.node));
      }, 380);
    });
    document.addEventListener('pointerout', (e) => {
      const el = e.target.closest && e.target.closest('button.chip[data-node]');
      if (el && el === tipFor && !el.contains(e.relatedTarget)) ui.hideTip();
    });
    document.addEventListener('scroll', ui.hideTip, true);
  }

  ui.init = () => {
    renderHeader();
    wireSearch();
    wirePreview();
  };
})();
