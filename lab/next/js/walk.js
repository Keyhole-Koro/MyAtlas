// 歩く: the heart. A journey strip (comic's 道のり), the step track with its papers as sub-tracks
// (code-tour), the current step as a card, the sequence diagram kept in step (seq-plus), and the code at
// the line (code-tour), folded to its head when the step has no line to show. The view on load: the UI
// flow at step 1.
(function () {
  'use strict';
  const NX = window.NX, { A, esc, $, TR } = NX;
  const sd = NX.seqdraw;
  const W = (NX.walk = {});
  const root = $('#v-walk');
  const phone = () => matchMedia('(max-width: 760px)').matches;
  const f1 = (v) => Math.round(v * 10) / 10;

  root.innerHTML = `
    <div class="w-top">
      <div class="w-head">
        <div class="w-eyebrow" id="wEyebrow"></div>
        <h2 class="w-title ja" id="wTitle"></h2>
        <div class="w-ctl">
          <button class="btn primary w-play" id="wPlay" type="button" aria-pressed="false"></button>
          <button class="btn icon" id="wReplay" type="button" title="手順 1 から歩き直す" aria-label="手順 1 から歩き直す" hidden></button>
          <div class="w-stepper"><button class="btn icon" id="wPrev" type="button" title="前の手順（←）" aria-label="前の手順"></button><span class="w-pos" id="wPos"></span><button class="btn icon" id="wNext" type="button" title="次の手順（→）" aria-label="次の手順"></button></div>
        </div>
        <div class="w-progress" aria-hidden="true"><i id="wBar"></i></div>
      </div>
      <figure class="journey" id="wJourney" aria-label="道のり"></figure>
    </div>
    <div class="w-main">
      <div class="w-left"><nav class="w-track scroll" id="wTrack" aria-label="手順"></nav>
        <p class="w-keys"><span><kbd>←</kbd><kbd>→</kbd> 手順</span><span><kbd>Enter</kbd> 中の紙</span><span><kbd>Esc</kbd> 外へ</span><span><kbd>Space</kbd> 歩く</span><span><kbd>?</kbd> 説明</span></p></div>
      <div class="m-strip scroll" id="wStrip" aria-label="手順"></div>
      <div class="m-card" id="wCardM"></div>
      <div class="m-panes seg" id="wPanes" role="tablist" aria-label="図とコード"><button type="button" role="tab" data-pane="dia" aria-selected="true">やりとり図</button><button type="button" role="tab" data-pane="code" aria-selected="false">コード</button></div>
      <div class="stage" id="wStage" data-pane="dia">
        <section class="pane dia" id="wDia" aria-label="やりとり図">
          <header class="pane-h"><span class="pane-t">やりとり図</span><span class="pane-sub" id="wDiaSub"></span><span class="pane-tools"><button class="btn small ghost" type="button" id="wLegendBtn" aria-expanded="false">凡例</button><button class="btn small ghost" type="button" data-grow="dia" title="図を広く">図を広く</button></span></header>
          <div class="legend-pop" id="wLegend" hidden></div>
          <div class="dia-scroll scroll" id="wDiaScroll"><div class="dia-inner" id="wDiaInner"><div class="dia-heads" id="wHeads"></div><div class="dia-body" id="wBody"></div></div></div>
        </section>
        <div class="splitter" id="wSplit" role="separator" aria-orientation="horizontal" aria-label="図とコードの境目" tabindex="0"></div>
        <section class="pane code" id="wCode" aria-label="コード"></section>
      </div>
    </div>
    <nav class="m-nav" id="wNav"><button class="btn" type="button" data-act="prev">${NX.ICON.left}前へ</button><button class="btn" type="button" data-act="dive" id="wDiveM">中の紙へ</button><button class="btn primary" type="button" data-act="next">次へ${NX.ICON.right}</button></nav>`;

  const codePanel = NX.code.mount($('#wCode'));
  $('#wPrev').innerHTML = NX.ICON.left;
  $('#wNext').innerHTML = NX.ICON.right;
  $('#wReplay').innerHTML = NX.ICON.replay;
  let detour = null;          // a node's code shown instead of the step's (from the node card)

  // ---------------------------------------------------------------- the journey strip (道のり)
  // One column per main step, the layers (or a paper's bands) as rows, and one line through all of
  // them: each step a curve from the row it leaves to the row it reaches, with a dot in the colour of
  // where it arrives. The tiers colour the line: walked (one calm colour), now (the accent), to come
  // (grey, still readable). The data's start sits above its column as 「地図のはじめ」.
  function journey(t, cur, width) {
    const rows = t.kind === 'flow' ? NX.STACK.map((id) => ({ id, name: NX.layerName(id), tone: id })) : t.bands.map((b) => ({ id: b.id, name: b.name, tone: b.tone }));
    const nameW = Math.max(...rows.map((r) => NX.textW(r.name, 11, 650)));
    const labelW = Math.ceil(nameW) + 22, padR = 10;
    const Wd = Math.max(240, width);
    const start = NX.startIndex(t);
    const bandsTop = start != null ? 21 : 7, rowH = 14;
    const numY = bandsTop + rows.length * rowH + 15, Hh = numY + 7;
    const n = t.main.length, cw = (Wd - labelW - padR) / n;
    const colX = (k) => labelW + k * cw;
    const yOf = (rid) => { const k = Math.max(0, rows.findIndex((r) => r.id === rid)); return bandsTop + k * rowH + rowH / 2; };
    let s = `<svg viewBox="0 0 ${f1(Wd)} ${Hh}" width="${f1(Wd)}" height="${Hh}" role="img" aria-label="${esc(t.kind === 'flow' ? '流れが通る層' : '紙の中の帯')}">`;
    rows.forEach((r, k) => {
      const y = bandsTop + k * rowH;
      s += `<rect class="jr-band" x="${labelW - 6}" y="${y + 1}" width="${f1(Wd - labelW + 6 - padR)}" height="${rowH - 2}" rx="4" style="--lc:${NX.layerVar(r.tone)}"/>`;
      s += `<text class="jr-name" x="${labelW - 12}" y="${y + rowH / 2 + 4}" style="--lt:${NX.layerText(r.tone)}">${esc(r.name)}</text>`;
    });
    if (cur >= 0) s += `<rect class="jr-now" x="${f1(colX(cur) + 1)}" y="${bandsTop - 4}" width="${f1(cw - 2)}" height="${Hh - bandsTop + 3}" rx="6"/>`;
    const inset = Math.min(7, cw / 6);
    const line = { passed: '', now: '', tocome: '' }, jump = { passed: '', tocome: '' };
    let dots = '', prev = null, head = '';
    t.main.forEach((i, k) => {
      const st = t.steps[i];
      const tier = k === cur ? 'now' : cur >= 0 && k < cur ? 'passed' : 'tocome';
      const x0 = colX(k) + inset, x1 = colX(k + 1) - inset, mx = (x0 + x1) / 2;
      const y0 = yOf(t.box[st.from].layer), y1 = yOf(t.box[st.to].layer);
      if (prev) {
        const tt = cur >= 0 && k <= cur ? 'passed' : 'tocome';
        const seg = `M${f1(prev[0])} ${f1(prev[1])}L${f1(x0)} ${f1(y0)}`;
        if (Math.abs(prev[1] - y0) < 1) line[tt] += seg; else jump[tt] += seg;
      }
      line[tier] += `M${f1(x0)} ${f1(y0)}C${f1(mx)} ${f1(y0)} ${f1(mx)} ${f1(y1)} ${f1(x1)} ${f1(y1)}`;
      if (tier === 'now') head = `<path class="jr-head" d="M${f1(x1 + 1)} ${f1(y1)}l-7 -4.2v8.4z"/>`;
      prev = [x1, y1];
      dots += `<circle class="jr-dot ${tier}" cx="${f1(x1)}" cy="${f1(y1)}" r="${tier === 'now' ? 4.2 : 3.4}" style="--lc:${NX.layerVar(NX.boxLayer(t, t.box[st.to]))}"/>`;
    });
    s += `<path class="jr-jump passed" d="${jump.passed}"/><path class="jr-jump" d="${jump.tocome}"/>`;
    s += `<path class="jr-line tocome" d="${line.tocome}"/><path class="jr-line passed" d="${line.passed}"/><path class="jr-line now" d="${line.now}"/>${head}${dots}`;
    t.main.forEach((i, k) => {
      const st = t.steps[i], x = colX(k) + cw / 2;
      const tier = k === cur ? 'now' : cur >= 0 && k < cur ? 'passed' : 'tocome';
      s += `<text class="jr-num ${tier}" x="${f1(x)}" y="${numY}">${esc(t.labels[i])}</text>`;
      s += `<rect class="jr-hit" data-go-main="${i}" x="${f1(colX(k))}" y="0" width="${f1(cw)}" height="${Hh}"><title>${esc(t.labels[i] + ' ' + NX.stepTitle(st))}</title></rect>`;
    });
    if (start != null) {
      const k = t.main.indexOf(start), x = colX(k) + cw / 2;
      const w = NX.textW('地図のはじめ', 11, 700) + 16;
      const bx = NX.clamp(x - w / 2, labelW - 6, Wd - padR - w);
      s += `<g class="jr-start"><path d="M${f1(x)} 17V${bandsTop - 4}"/><rect x="${f1(bx)}" y="2" width="${f1(w)}" height="15" rx="7.5"/><text x="${f1(bx + w / 2)}" y="10">地図のはじめ</text><title>データの start：地図が最初に見せる手順（${esc(t.labels[start])}）。歩くのは手順 1 から</title></g>`;
    }
    return s + '</svg>';
  }

  // ---------------------------------------------------------------- the step track
  function stepRow(t, i, level, tier) {
    const s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
    const start = NX.isStart(t, i) ? '<span class="tag start" title="データの start。この流れで地図が最初に見せる手順">地図のはじめ</span>' : '';
    const paper = NX.paperOf(t, i) ? `<span class="tag paper" title="着く箱の中に紙がある">${NX.ICON.paper}中の紙</span>` : '';
    const title = s.verb ? `<span class="verb">${esc(s.verb)}</span>` : `<span class="verb sentence">${esc(NX.stepTitle(s))}</span>`;
    return `<button type="button" class="w-row" data-go="${level}:${i}" title="${esc(s.label || '')}">
      <span class="num ${tier}${s.alt ? ' alt' : ''}">${esc(t.labels[i])}</span>
      <span class="body"><span class="l1">${title}${start}${paper}<span class="kind" title="${esc(NX.KIND_STEP[s.kind] || s.kind)}">${NX.kindIcon(s.kind)}</span></span>
      <span class="l2">${NX.boxChip(t, fb, { span: true })}<span class="ar">→</span>${NX.boxChip(t, tb, { span: true })}</span></span></button>`;
  }

  // The map's words and the code disagree here (data-journey's notes): said where both are seen.
  let DRIFTS = null;
  NX.driftOf = (trackId, i) => {
    if (!DRIFTS) {
      DRIFTS = {};
      const JY = window.JOURNEYS;
      if (JY) {
        const all = JY.buildJourneys(A);
        for (const k of Object.keys(all)) {
          const j = all[k];
          if (!j || !j.cols) continue;
          for (const c of [...j.cols, ...(j.alts || [])]) if (c.drift && JY.DRIFT[c.drift]) DRIFTS[c.src + ':' + c.i] = { key: c.drift, ...JY.DRIFT[c.drift] };
        }
      }
    }
    return DRIFTS[trackId + ':' + i] || null;
  };

  // What the record says about the step, in the same numbers as the 記録 view: how often the step
  // happened (its matching), and how often the function that holds its line was entered, counted in the
  // context that function runs in.
  const HOW_NONE = { alt: 'もしもの道なので、この記録には出てこない', absent: '端の関数が記録に無い', nodes: 'この手順に当たる呼び出しは、この記録に無い', call: 'この手順に当たる呼び出しは、この記録に無い', seq: 'この手順に当たる呼び出しは、この記録に無い' };
  function recordHTML(stack, c) {
    if (!NX.traceModel()) return '';
    const f = stack[stack.length - 1], t = TR[f.id];
    const r = NX.stepRecord(stack);
    const band = NX.code.bandNodeOf(t.id, f.i);
    const region = band ? NX.ctxOfNode(stack, band) : null;
    const ctx = region ? region.node : c.a ? c.a.node : null;
    const fr = band ? NX.fnRecord(band, ctx) : null;
    let h = '';
    const fnLine = () => {
      const other = fr.other.map(([k, n]) => `${esc(NX.ctxWord(k))} ${n}`).join('・');
      const main = fr.ctx ? `${esc(NX.ctxWord(fr.ctx))}で ${fr.count} 回` : `${fr.count} 回`;
      return `<p class="sc-rf"><code>${esc(fr.fn)}</code> に入った：${main}${other ? `<span class="sc-rf-o">（ほか ${other}）</span>` : ''}</p>`;
    };
    if (r && r.count) {
      h += `<p class="sc-rs"><b>この手順は ${r.count} 回</b><button type="button" class="nl" data-goview="trace">記録で見る</button></p>`;
      if (fr && fr.watched) h += fnLine();
    } else if (fr && !fr.watched) {
      h += `<p class="sc-rs none"><code>${esc(fr.fn)}</code> は記録していない関数。この手順は記録からは言えない</p>`;
    } else {
      h += `<p class="sc-rs none">${esc((r && HOW_NONE[r.how]) || 'この手順に当たる呼び出しは、この記録に無い')}</p>`;
      if (fr) h += fnLine();
    }
    return `<dt>記録</dt><dd class="sc-run" title="${esc(tip)}">${h}<p class="sc-run-note">記録は Editor で「x」を打った 1 回</p></dd>`;
  }

  // The current step as a card: its verb as the title, its sentence, what it hands over, where it runs,
  // and what the record says.
  function cardHTML(stack, opt = {}) {
    const lv = stack.length - 1, f = stack[lv], t = TR[f.id], s = t.steps[f.i], fb = t.box[s.from], tb = t.box[s.to];
    const title = s.verb || s.label || NX.KIND_STEP[s.kind];
    let h = `<article class="scard${s.alt ? ' alt' : ''}" aria-live="polite">`;
    h += `<header class="sc-h"><span class="num now big${s.alt ? ' alt' : ''}">${esc(t.labels[f.i])}</span><h3 class="sc-verb${s.verb ? '' : ' long'} ja">${esc(title)}</h3></header>`;
    h += `<div class="sc-ft">${NX.boxChip(t, fb)}<span class="ar">→</span>${NX.boxChip(t, tb)}<span class="sc-kind">${NX.kindIcon(s.kind)}${esc(NX.KIND_STEP[s.kind] || s.kind)}</span></div>`;
    if (NX.isStart(t, f.i)) h += `<p class="sc-start"><span class="tag start">地図のはじめ</span>地図が最初に見せる手順（データの start）</p>`;
    if (s.alt) h += `<p class="sc-when">もし${esc(s.alt.when)}なら、${esc(t.labels[s.alt.at])}「${esc(NX.stepTitle(t.steps[s.alt.at]))}」の代わりにこちら</p>`;
    if (s.verb && s.label) h += `<p class="sc-text ja">${NX.linkify(s.label)}</p>`;
    const dr = NX.driftOf(t.id, f.i);
    if (dr) h += `<div class="sc-drift" role="note"><b><span class="dr-i" aria-hidden="true">!</span>${esc(dr.title)}</b><p>${esc(dr.count)}</p><button type="button" class="nl" data-goview="data">データで、地図の文とコードを並べて見る</button></div>`;
    let dl = '';
    if (s.data) {
      const d = s.data;
      let v = d.schema && A.nodes[d.schema] ? NX.nodeChip(d.schema, { label: d.label }) : `<span class="chip plain code"><span>${esc(d.label)}</span></span>`;
      if (d.fields && d.fields.length) v += d.fields.map((x) => `<span class="chip field">${esc(x)}</span>`).join('');
      if (d.type && d.type !== d.label) v += `<span class="sc-type">${esc(d.type)}</span>`;
      if (d.note) v += `<p class="sc-note">${NX.linkify(d.note)}</p>`;
      dl += `<dt>渡す</dt><dd class="sc-data">${v}</dd>`;
    }
    if (s.ops) dl += `<dt>操作</dt><dd>${s.ops.map((o) => `${NX.nodeChip(o.node)} に<b>${esc(o.kind)}</b>`).join('、')}</dd>`;
    if (s.branches) dl += `<dt>分かれる</dt><dd><ul class="sc-br">${s.branches.map(([w, r]) => `<li><span>${NX.linkify(w)}</span><span class="ar">→</span><span>${NX.linkify(r)}</span></li>`).join('')}</ul></dd>`;
    const c = NX.contextOf(stack);
    if (c.b) {
      if (c.a && c.a !== c.b) {
        const note = NX.ctxNote(c.b);
        dl += `<dt>文脈</dt><dd class="sc-ctx change"><span class="sc-ctx-k">文脈が変わる</span>${ctxChip(c.a)}<span class="ar">→</span>${ctxChip(c.b)}${note ? `<span class="sc-ctx-note">${esc(note)}</span>` : ''}</dd>`;
      } else if (!c.a) dl += `<dt>文脈</dt><dd class="sc-ctx change"><span class="sc-ctx-k">文脈に入る</span>${ctxChip(c.b)}</dd>`;
      else {
        const n = A.nodes[c.b.node];
        dl += `<dt>文脈</dt><dd class="sc-ctx">${ctxChip(c.b)}${n && n.run ? `<span class="sc-ctx-note">${esc(n.run)}${n.kernel ? '・カーネルの中' : ''}</span>` : ''}${c.inherited ? '<span class="sc-ctx-note">（紙が描かれた箱の枠）</span>' : ''}</dd>`;
      }
    }
    dl += recordHTML(stack, c);
    if (dl) h += `<dl class="sc-meta">${dl}</dl>`;
    const paper = NX.paperOf(t, f.i);
    if (paper && !opt.noDive) {
      const pt = TR[paper];
      h += `<button type="button" class="sc-dive" data-act="dive" style="--lc:${NX.layerVar(NX.trackTone(pt))}">${NX.ICON.paper}<span><b>中の紙へ入る</b><small>${esc(pt.title)}・${esc(NX.countText(pt))}</small></span><kbd>Enter</kbd></button>`;
    }
    return h + '</article>';
  }
  W.cardHTML = cardHTML;
  const ctxChip = (r) => `<button type="button" class="chip ctx" data-node="${esc(r.node)}" title="${esc(r.label)}"><span>${esc(NX.ctxShort(r))}</span></button>`;

  function trackHTML(stack, level) {
    const fr = stack[level], t = TR[fr.id];
    const deepest = level === stack.length - 1;
    const curPos = t.main.indexOf(NX.mainOf(t, fr.i));
    let h = '<ol class="w-steps">';
    const item = (i, alt) => {
      const pos = t.main.indexOf(i);
      const here = fr.i === i;
      const tier = here ? (deepest ? 'now' : 'host') : !alt && pos < curPos ? 'passed' : 'tocome';
      let x = `<li class="w-step ${here ? (deepest ? 'is-now' : 'is-host') : tier}${alt ? ' alt' : ''}">`;
      if (here && deepest) x += cardHTML(stack);
      else x += stepRow(t, i, level, tier === 'host' ? 'host' : tier);
      if (here && !deepest) x += paperHTML(stack, level + 1);
      return x + '</li>';
    };
    for (const i of t.main) {
      h += item(i, false);
      if (t.alts[i]) {
        const when = t.steps[t.alts[i][0]].alt.when;
        const done = t.main.indexOf(i) < curPos;
        h += `<li class="alts${done ? ' passed' : ''}"><span class="alts-k">もし${esc(when)}なら、${esc(t.labels[i])} の代わりに</span><ol>${t.alts[i].map((ai) => item(ai, true)).join('')}</ol></li>`;
      }
    }
    return h + '</ol>';
  }
  function paperHTML(stack, level) {
    const t = TR[stack[level].id];
    return `<div class="w-paper${level > 1 ? ' nested' : ''}" style="--lc:${NX.layerVar(NX.trackTone(t))};--lvl:${level - 1}">
      <div class="paper-h">${NX.ICON.paper}<span class="pt" title="${esc(t.title)}・${esc(NX.countText(t))}">${esc(t.title)}</span>
      <button type="button" class="btn small paper-out" data-pop="${level - 1}" title="紙の外へ（Esc）">外へ<kbd>Esc</kbd></button></div>${trackHTML(stack, level)}</div>`;
  }

  // ---------------------------------------------------------------- render
  let lastKey = '';
  function render(changed = {}) {
    const st = NX.state.stack, lv = st.length - 1, f = st[lv], t = TR[f.id];
    const flow = TR[st[0].id];
    const key = NX.stackKey(st);
    if (key !== lastKey && codePeek && codePeek.key !== key) codePeek = null;
    // head
    $('#wEyebrow').innerHTML = st.length > 1
      ? st.map((fr, k) => {
        const tt = TR[fr.id];
        return k < lv ? `<button type="button" class="nl" data-pop="${k}">${esc(k === 0 ? tt.tab : tt.title)}</button> <span class="muted">の ${esc(tt.labels[fr.i])}</span>` : `<b>${esc(tt.title)}</b>`;
      }).join('<span class="crumb-sep">›</span>')
      : `<b>${esc(flow.tab)}</b><span class="muted">・${esc(NX.countText(flow))}</span>`;
    $('#wTitle').textContent = flow.title;
    const pos = t.main.indexOf(NX.mainOf(t, f.i));
    $('#wPos').innerHTML = `<b>${esc(t.labels[f.i])}</b><span> / ${t.main.length}</span>`;
    $('#wPrev').disabled = !NX.prevStack(st);
    $('#wNext').disabled = !NX.nextStack(st);
    renderPlay();
    // journey
    const jw = $('#wJourney').clientWidth || 600;
    $('#wJourney').innerHTML = journey(t, pos, jw);
    // track
    const tr = $('#wTrack');
    tr.innerHTML = trackHTML(st, 0);
    keepInView();
    // phone: chips and the card
    renderPhone();
    // the code first (it decides how tall the diagram is), then the diagram
    renderCode();
    renderDiagram(changed);
    lastKey = key;
  }
  W.render = render;
  function keepInView() {
    const tr = $('#wTrack');
    const active = tr.querySelector('.w-step.is-now');
    if (!active) return;
    const r = active.getBoundingClientRect(), b = tr.getBoundingClientRect();
    let heads = 0;
    for (let p = active.closest('.w-paper'); p; p = p.parentElement.closest('.w-paper')) heads += p.querySelector(':scope > .paper-h').offsetHeight;
    if (r.top < b.top + heads + 8 || r.bottom > b.bottom - 8) {
      const y = tr.scrollTop + (r.top - b.top) - Math.max(heads + 12, Math.min(b.height * 0.22, b.height - r.height - 12));
      tr.scrollTo({ top: Math.max(0, y), behavior: lastKey ? 'smooth' : 'auto' });
    }
  }
  function renderPhone() {
    const st = NX.state.stack, lv = st.length - 1, f = st[lv], t = TR[f.id];
    const curMain = NX.mainOf(t, f.i);
    $('#wStrip').innerHTML = (lv > 0 ? `<button type="button" class="m-chip out" data-pop="${lv - 1}">${NX.ICON.out}外へ</button>` : '')
      + t.main.map((i) => {
        const s = t.steps[i], pos = t.main.indexOf(i), cp = t.main.indexOf(curMain);
        const tier = i === curMain ? 'now' : pos < cp ? 'passed' : 'tocome';
        return `<button type="button" class="m-chip ${tier}" data-go="${lv}:${i}" aria-current="${i === curMain}"><span class="num ${tier}">${esc(t.labels[i])}</span>${esc(s.verb || NX.boxName(t.box[s.to]))}</button>`;
      }).join('');
    $('#wCardM').innerHTML = phone() ? cardHTML(st, { noDive: true }) : '';
    const cur = $('#wStrip [aria-current="true"]');
    if (cur && phone()) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
    const d = $('#wDiveM');
    if (NX.paperOf(t, f.i)) { d.innerHTML = `${NX.ICON.dive}中の紙へ`; d.dataset.act = 'dive'; d.disabled = false; }
    else if (lv > 0) { d.innerHTML = `${NX.ICON.out}外へ`; d.dataset.act = 'out'; d.disabled = false; }
    else { d.innerHTML = '中の紙へ'; d.dataset.act = 'dive'; d.disabled = true; }
  }

  // ---------------------------------------------------------------- the diagram
  const D = { key: '', M: null, G: null, w: 0, tight: null };
  function renderDiagram() {
    const st = NX.state.stack;
    const open = sd.openOf(st);
    const scroll = $('#wDiaScroll');
    const w = scroll.clientWidth || 800;
    // a short pane gets one-line heads, so more of the steps fit
    const tight = !phone() && $('#wDia').clientHeight > 0 && $('#wDia').clientHeight < 360;
    const key = st[0].id + '|' + open.join(',');
    const fresh = key !== D.key || Math.abs(w - D.w) > 2 || tight !== D.tight;
    if (fresh) {
      D.M = sd.model(st[0].id, open);
      D.G = sd.layout(D.M, { avail: w, compact: true, tight });
      D.key = key; D.w = w; D.tight = tight;
      $('#wHeads').innerHTML = sd.heads(D.M, D.G, { node: NX.state.node });
      $('#wDiaInner').style.width = D.G.diagW + 'px';
    }
    const cur = sd.rowKeyOf(st);
    $('#wBody').innerHTML = sd.body(D.M, D.G, { current: cur, node: NX.state.node });
    const inPaper = st.length > 1 ? TR[st[st.length - 1].id].title : '';
    $('#wDiaSub').textContent = inPaper ? `${inPaper}を開いている` : `${TR[st[0].id].tab}・手順の順に上から下へ`;
    // keep the current arrow in view
    const g = D.G.rows.get(cur);
    if (g) {
      const top = D.G.headH + g.y, bottom = top + g.h;
      const vh = scroll.clientHeight;
      let y = scroll.scrollTop;
      if (top - D.G.headH < y + vh * 0.12 || bottom > y + vh * 0.88) y = top - D.G.headH - (vh - D.G.headH) * 0.38;
      const r = D.M.rows[D.M.rowIndex.get(cur)];
      const xa = D.G.colX.get(D.M.L.keyOf(r.scope, r.st.from)), xb = D.G.colX.get(D.M.L.keyOf(r.scope, r.st.to));
      let x = scroll.scrollLeft;
      const lo = Math.min(xa, xb) - 60, hi = Math.max(xa, xb) + 160;
      if (lo < x || hi > x + scroll.clientWidth) x = Math.max(0, (lo + hi) / 2 - scroll.clientWidth / 2);
      scroll.scrollTo({ top: Math.max(0, y), left: x, behavior: fresh ? 'auto' : 'smooth' });
    }
    sd.stick($('#wDiaInner'), scroll.scrollLeft);
  }
  $('#wDiaScroll').addEventListener('scroll', (e) => sd.stick($('#wDiaInner'), e.currentTarget.scrollLeft), { passive: true });

  // ---------------------------------------------------------------- the code
  function calloutHTML(p, stack) {
    if (p.detour) {
      const n = A.nodes[p.node];
      const lines = p.band ? (p.band[0] === p.band[1] ? `${p.band[0]} 行` : `${p.band[0]}–${p.band[1]} 行`) : '';
      return `<div class="co-head"><span class="tag">寄り道</span><b class="co-verb${NX.isAscii(n.title) ? ' code' : ''}">${esc(n.title)}</b><span class="co-kind">${esc(NX.KIND_NODE[n.kind] || n.kind)}</span></div>
        <div class="co-foot">${p.mainKind === 'def' && p.band ? `<span class="co-where whole">定義 ${lines}</span>` : NX.code.whereHTML(p)}<button type="button" class="btn small" data-act="back">手順に戻る<kbd>Esc</kbd></button></div>`;
    }
    const f = stack[stack.length - 1], t = TR[f.id], s = t.steps[f.i];
    const cert = NX.code.certainty(p);
    let h = `<div class="co-head"><span class="num now${cert === 'likely' ? ' likely' : ''}${s.alt ? ' alt' : ''}">${esc(t.labels[f.i])}</span><b class="co-verb">${esc(s.verb || NX.boxName(t.box[s.to]))}</b><span class="co-kind">${NX.kindIcon(s.kind)}${esc(NX.KIND_STEP[s.kind] || s.kind)}</span></div>`;
    let foot = NX.code.whereHTML(p);
    if (p.arrival && !(p.arrival.path === p.path && p.arrival.line === p.main)) {
      const a = p.arrival;
      foot += `<button type="button" class="co-arrive" data-code-node="${esc(a.node)}" title="着く先のコードへ">着く先 <b>${esc(NX.title(a.node))}</b><span>${esc((a.path || '').split('/').pop())}${a.line ? ':' + a.line : ''}</span></button>`;
    }
    const dr = NX.driftOf(t.id, f.i);
    if (dr) foot += `<span class="co-drift" title="${esc(dr.count)}"><span class="dr-i" aria-hidden="true">!</span>${esc(dr.title)}</span>`;
    return h + `<div class="co-foot">${foot}</div>`;
  }
  function emptyHTML(p) {
    const n = A.nodes[p.node];
    if (!n) return '<div class="code-empty">コードがありません。</div>';
    const t = TR[NX.state.stack[0].id];
    let extra = '';
    if (n.kind === 'context') {
      const r = (t.regions || []).find((x) => x.node === p.node);
      if (r) extra = `<p class="ce-p">${esc(t.tab)} の中で、この枠にある箱：${r.boxes.map((b) => NX.boxChip(t, t.box[b])).join(' ')}</p>`;
    }
    return `<div class="code-empty card"><span class="tag">${esc(NX.KIND_NODE[n.kind] || n.kind)}</span><h4>${esc(n.title)}</h4><p class="ce-p">${NX.linkify(n.text)}</p>${extra}<p class="ce-why">この箱が指すコードは、地図に書かれていません。</p>${p.detour ? '<button type="button" class="btn small" data-act="back">手順に戻る</button>' : ''}</div>`;
  }
  // The code opens by itself where it can show the line (起きる行, たぶんここ, 欄); a step known only by its
  // box keeps the code folded to its head. The reader can open or fold it for the step at hand.
  let codePeek = null, codeOpen = null;
  function codeWanted(p) {
    if (phone()) return true;
    if (p.detour) return true;
    const key = NX.stackKey(NX.state.stack);
    if (codePeek && codePeek.key === key) return codePeek.open;
    if (!NX.code.ready) return codeOpen == null ? false : codeOpen;
    const c = NX.code.certainty(p);
    return c === 'sure' || c === 'likely' || c === 'fields';
  }
  function renderCode(jump) {
    const st = NX.state.stack, f = st[st.length - 1];
    const p = detour || NX.code.plan(f.id, f.i);
    const open = codeWanted(p);
    const was = codeOpen;
    codeOpen = open;
    $('#wStage').classList.toggle('code-min', !open);
    const t = TR[f.id];
    const cert = NX.code.certainty(p);
    const badge = p.detour ? '<span class="num">・</span>' : `<span class="num now${cert === 'likely' ? ' likely' : ''}${t.steps[f.i].alt ? ' alt' : ''}">${esc(t.labels[f.i])}</span>`;
    const tools = phone() ? '' : `<button type="button" class="btn small${open ? ' ghost' : ''} code-tog" data-act="code-toggle" aria-expanded="${open}" title="${open ? 'コードをたたんで、図を広く' : 'この手順のコードを開く'}">${NX.ICON.code}${open ? 'たたむ' : 'コードを開く'}</button>`;
    codePanel.show(p, { callout: calloutHTML(p, st), empty: emptyHTML(p), badge, compact: phone(), min: !open, tools, jump: jump || (open && was === false) });
    return open !== was;
  }
  W.showNodeCode = (id) => {
    if (!NX.code.ready) { NX.ui.toast('ソースを読んでいます…'); return; }
    detour = NX.code.nodePlan(id);
    if (renderCode()) renderDiagram();
    setPane('code');
  };
  W.back = () => { if (detour) { detour = null; if (renderCode()) renderDiagram(); return true; } return false; };

  // ---------------------------------------------------------------- autoplay: from step 1 until the reader has moved
  const play = { on: false, seq: [], k: 0, timer: 0 };
  const STEP_MS = () => window.NX_STEP_MS || 3600;
  const FIRST_MS = () => Math.min(1500, STEP_MS());
  const atFirst = () => NX.state.stack.length === 1 && NX.state.stack[0].i === TR[NX.state.stack[0].id].main[0];
  const fromStart = () => !NX.state.touched || atFirst() || NX.walkFrom(NX.state.stack).length < 2;
  function startPlay(first) {
    stopPlay(true);
    let st = NX.state.stack;
    if (first) st = NX.firstStack(st[0].id);
    play.on = true;
    play.seq = NX.walkFrom(st);
    play.k = 0;
    detour = null;
    NX.set({ stack: st }, { source: 'play', force: true });
    renderPlay();
    pulse();
    schedule(FIRST_MS());
  }
  // the step the walk starts at says so at once
  function pulse() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of [root.querySelector('.w-step.is-now .scard'), $('#wCardM .scard')]) {
      if (el) el.animate([{ boxShadow: '0 0 0 0 var(--accent-line)' }, { boxShadow: '0 0 0 6px var(--accent-line)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 700, easing: 'ease-out' });
    }
  }
  function schedule(ms) {
    clearTimeout(play.timer);
    const bar = $('#wBar');
    bar.getAnimations().forEach((a) => a.cancel());
    bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
    play.timer = setTimeout(stepPlay, ms);
  }
  function stepPlay() {
    if (!play.on) return;
    if (play.k + 1 >= play.seq.length) { stopPlay(); NX.ui.toast('最後の手順まで歩きました'); return; }
    play.k++;
    NX.set({ stack: play.seq[play.k] }, { source: 'play' });
    renderPlay();
    schedule(STEP_MS());
  }
  function stopPlay(quiet) {
    if (!play.on) return;
    clearTimeout(play.timer);
    play.on = false;
    $('#wBar').getAnimations().forEach((a) => a.cancel());
    NX.state.touched = true;
    if (!quiet) renderPlay();
  }
  W.togglePlay = () => (play.on ? stopPlay() : startPlay(fromStart()));
  W.stopPlay = () => stopPlay();
  W.playing = () => play.on;
  function renderPlay() {
    const b = $('#wPlay'), r = $('#wReplay'), first = fromStart();
    b.setAttribute('aria-pressed', String(play.on));
    b.innerHTML = play.on ? `${NX.ICON.pause}止める<small>${play.k + 1} / ${play.seq.length}</small>` : `${NX.ICON.play}${first ? '最初から歩く' : 'ここから歩く'}`;
    b.title = play.on ? '止める（Space）' : first ? '手順 1 から順に歩く。紙があれば中へ入って出てくる（Space）' : '今の手順から順に歩く（Space）';
    r.hidden = play.on || first;
    root.classList.toggle('playing', play.on);
    W.syncPill();
  }
  // outside 歩く the header says the walk goes on, and stops it
  W.syncPill = () => {
    const pill = $('#playPill');
    if (!pill) return;
    pill.hidden = !play.on || NX.state.view === 'walk';
    if (!pill.hidden) $('#ppText').textContent = `自動で歩いています ${play.k + 1} / ${play.seq.length}`;
  };

  // ---------------------------------------------------------------- moves
  W.go = (level, i, opt = {}) => {
    const st = NX.cloneStack(NX.state.stack).slice(0, level + 1);
    st[level].i = i;
    detour = null;
    NX.set({ stack: st }, { push: !!opt.push });
  };
  W.next = () => { const s = NX.nextStack(NX.state.stack); detour = null; if (s) NX.set({ stack: s }); else NX.ui.toast('流れの終わり。<kbd>Home</kbd> で最初へ'); };
  W.prev = () => { const s = NX.prevStack(NX.state.stack); detour = null; if (s) NX.set({ stack: s }); else NX.ui.toast('最初の手順'); };
  W.dive = () => { const s = NX.diveStack(NX.state.stack); detour = null; if (s) { NX.set({ stack: s }, { push: true }); return true; } return false; };
  W.out = () => { if (W.back()) return true; const s = NX.outStack(NX.state.stack); if (s) { NX.set({ stack: s }, { push: true }); return true; } return false; };
  W.home = () => NX.set({ stack: NX.firstStack(NX.state.stack[0].id) }, { push: true });
  W.end = () => { const id = NX.state.stack[0].id, t = TR[id]; NX.set({ stack: [{ id, i: t.main[t.main.length - 1] }] }, { push: true }); };

  // ---------------------------------------------------------------- panes: the split, and one pane at a time on a phone
  function setPane(p) {
    $('#wStage').dataset.pane = p;
    for (const b of NX.$$('#wPanes button')) b.setAttribute('aria-selected', String(b.dataset.pane === p));
    // the pane that was hidden is drawn again now that it has a size (and opens at the step's line)
    if (p === 'code') renderCode(true); else { D.w = 0; renderDiagram(); }
  }
  let split = Number(NX.store.get('walk-split2')) || 0.62;
  const applySplit = () => {
    $('#wStage').style.setProperty('--dia', `${Math.round(split * 1000) / 10}%`);
    const g = root.querySelector('[data-grow]');
    if (g) { g.textContent = split > 0.7 ? 'コードを広く' : '図を広く'; g.title = g.textContent; }
  };
  applySplit();
  (function wireSplit() {
    const sp = $('#wSplit'), stage = $('#wStage');
    let drag = null;
    sp.addEventListener('pointerdown', (e) => { if (stage.classList.contains('code-min')) return; drag = { y: e.clientY, s: split, h: stage.clientHeight }; sp.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
    sp.addEventListener('pointermove', (e) => {
      if (!drag) return;
      split = NX.clamp(drag.s + (e.clientY - drag.y) / drag.h, 0.2, 0.84);
      applySplit();
    });
    const end = () => { if (!drag) return; drag = null; stage.classList.remove('dragging'); NX.store.set('walk-split2', String(split)); D.w = 0; renderDiagram(); codePanel.relayout(); };
    sp.addEventListener('pointerup', end);
    sp.addEventListener('pointercancel', end);
    sp.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      split = NX.clamp(split + (e.key === 'ArrowUp' ? -0.05 : 0.05), 0.2, 0.84);
      applySplit(); NX.store.set('walk-split2', String(split)); D.w = 0; renderDiagram(); codePanel.relayout();
    });
  })();
  function legendHTML() {
    const k = Object.keys(NX.ARROW).map((x) => `<li>${NX.kindIcon(x)}<span>${esc(NX.KIND_STEP[x])}</span></li>`).join('');
    return `<ul class="lg-kinds">${k}</ul><ul class="lg-more">
      <li><span class="num now">5</span><span>今の手順</span></li><li><span class="num passed">3</span><span>通った手順</span></li><li><span class="num">8</span><span>これから</span></li>
      <li><span class="lg-ctx"></span><span>点線の枠：実行の文脈（斜線はカーネルの中）</span></li>
      <li><span class="lg-bar"></span><span>動いている間</span></li><li><span class="lg-place"></span><span>置き場は点線</span></li>
      <li><span class="lg-ref"></span><span>中の紙：押すとその場に開く</span></li></ul>`;
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-go],[data-go-main],[data-pop],[data-act],[data-row],[data-open],[data-close],[data-pane],[data-grow],[data-code-node],[data-goview],#wPlay,#wReplay,#wPrev,#wNext,#wLegendBtn');
    if (!el) return;
    if (el.id === 'wPlay') { W.togglePlay(); return; }
    if (el.id === 'wReplay') { startPlay(true); return; }
    if (el.id === 'wLegendBtn') { const lg = $('#wLegend'); lg.innerHTML = legendHTML(); lg.hidden = !lg.hidden; el.setAttribute('aria-expanded', String(!lg.hidden)); return; }
    if (el.dataset.pane) { setPane(el.dataset.pane); return; }
    if (el.dataset.goview) { NX.set({ view: el.dataset.goview }, { push: true }); return; }
    if (el.dataset.act === 'code-toggle') {
      codePeek = { key: NX.stackKey(NX.state.stack), open: !codeOpen };
      if (!codePeek.open) detour = null;
      if (renderCode()) renderDiagram();
      return;
    }
    if (el.dataset.grow) {
      if (!codeOpen) codePeek = { key: NX.stackKey(NX.state.stack), open: true };
      split = split > 0.7 ? 0.5 : 0.78;
      applySplit(); NX.store.set('walk-split2', String(split)); renderCode(); D.w = 0; renderDiagram(); codePanel.relayout();
      return;
    }
    if (el.dataset.codeNode) { W.showNodeCode(el.dataset.codeNode); return; }
    stopPlay();
    if (el.id === 'wPrev') W.prev();
    else if (el.id === 'wNext') W.next();
    else if (el.dataset.go) { const [lv, i] = el.dataset.go.split(':').map(Number); W.go(lv, i, { push: true }); }
    else if (el.dataset.goMain) W.go(NX.state.stack.length - 1, Number(el.dataset.goMain), { push: true });
    else if (el.dataset.pop) { detour = null; NX.set({ stack: NX.state.stack.slice(0, Number(el.dataset.pop) + 1) }, { push: true }); }
    else if (el.dataset.row) { const st = sd.stackOfRowKey(el.dataset.row, NX.state.stack); if (st) { detour = null; NX.set({ stack: st }, { push: true }); } }
    else if (el.dataset.open) {
      // a closed paper in the diagram: enter it from the step that leads there
      const st = sd.stackOfRowKey(el.dataset.open + '#0', NX.state.stack);
      if (st) { st[st.length - 1].i = TR[st[st.length - 1].id].main[0]; NX.set({ stack: st }, { push: true }); }
    } else if (el.dataset.close) {
      const depth = el.dataset.close.split('/').length - 1;
      NX.set({ stack: NX.state.stack.slice(0, depth) }, { push: true });
    } else if (el.dataset.act === 'dive') W.dive();
    else if (el.dataset.act === 'out') W.out();
    else if (el.dataset.act === 'back') W.back();
    else if (el.dataset.act === 'prev') W.prev();
    else if (el.dataset.act === 'next') W.next();
  });
  $('#wDia').addEventListener('mouseover', (e) => {
    const g = e.target.closest('.sq-step');
    for (const x of NX.$$('.sq-step.hover', root)) if (x !== g) x.classList.remove('hover');
    if (g) g.classList.add('hover');
  });
  W.onKey = (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); stopPlay(); W.next(); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); stopPlay(); W.prev(); return true; }
    if (k === 'Enter') { if (W.dive()) { stopPlay(); e.preventDefault(); return true; } return false; }
    if (k === 'Escape') { if (W.out()) { stopPlay(); e.preventDefault(); return true; } return false; }
    if (k === 'Home') { e.preventDefault(); stopPlay(); W.home(); return true; }
    if (k === 'End') { e.preventDefault(); stopPlay(); W.end(); return true; }
    return false;
  };
  W.onResize = () => { D.w = 0; render(); };
  W.onSources = () => { renderCode(); render(); };
  W.renderDiagramOnly = () => { D.key = ''; renderDiagram(); };
})();
