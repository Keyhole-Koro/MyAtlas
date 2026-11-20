// やりとり: the whole sequence (seq-plus) — the step's text, its arrow and the record's moment in three
// aligned columns. Papers open in place (and fold the outer steps they draw); the step chosen here is the
// step chosen everywhere.
(function () {
  'use strict';
  const NX = window.NX, { A, esc, $, TR } = NX;
  const sd = NX.seqdraw, S = window.SEQM;
  const V = (NX.seq = {});
  const root = $('#v-seq');
  const phone = () => matchMedia('(max-width: 760px)').matches;
  let showTime = true;
  const occ = {};

  root.innerHTML = `
    <div class="sv-bar">
      <div class="sv-title"><span class="eyebrow" id="svEyebrow"></span><h2 id="svTitle" class="ja"></h2></div>
      <div class="sv-tools">
        <button class="btn" type="button" id="svAll"></button>
        <button class="btn" type="button" id="svTime" aria-pressed="true">記録の時間</button>
        <span class="sv-occ" id="svOcc"></span>
      </div>
    </div>
    <div class="sv-scroll scroll" id="svScroll"><div class="sv-grid" id="svGrid">
      <div class="sv-corner l" id="svCornerL"></div><div class="sv-heads" id="svHeads"></div><div class="sv-corner r" id="svCornerR"></div>
      <div class="sv-narr" id="svNarr"></div><div class="sv-body" id="svBody"></div><div class="sv-time" id="svTimeCol"></div>
    </div></div>`;

  const flowId = () => NX.state.stack[0].id;
  // the papers open here: the reader's, and those on the chosen step's path
  function openSet() {
    const s = new Set(NX.state.open.filter((id) => id.split('/')[0] === flowId()));
    for (const id of sd.openOf(NX.state.stack)) s.add(id);
    return [...s];
  }

  // ---------------------------------------------------------------- cells of the text column
  function dataMeta(st) {
    const d = st.data;
    let s = '';
    if (d) {
      s += `<span class="chip code${d.schema && A.nodes[d.schema] ? '' : ' plain'}" style="--lc:${NX.layerVar('contract')}"><span>${esc(d.label)}</span></span>`;
      if (d.fields && d.fields.length) s += `<span class="sv-fields">${d.fields.map(esc).join('・')}</span>`;
      else if (d.type && d.type !== d.label) s += `<span class="sv-fields">${esc(d.type)}</span>`;
    }
    for (const op of st.ops || []) s += `<span class="sv-op">${esc(NX.title(op.node))}：${esc(op.kind)}</span>`;
    return s;
  }
  const rails = (r) => { let n = 0; for (let f = r.frame; f; f = f.parent) n++; return n; };
  function cellHTML(r, tier) {
    const pad = `--ind:${rails(r) * 12}px`;
    if (r.type === 'step') {
      const st = r.st, b = S.stepBadge(sd.X, r.sheet, r.i);
      const meta = dataMeta(st);
      const num = tier === 'now' ? 'now' : tier === 'passed' ? 'passed' : '';
      // on a phone the arrow is written in the row (who hands to whom), instead of drawn beside it
      const t = TR[r.sheet.id] || TR[r.scope.sheetKey];
      const arrow = phone() && t ? `<p class="sv-ft">${NX.boxChip(t, t.box[st.from], { span: true })}<span class="ar">→</span>${NX.boxChip(t, t.box[st.to], { span: true })}<span class="sv-kind">${NX.kindIcon(st.kind)}${esc(NX.KIND_STEP[st.kind] || st.kind)}</span></p>` : '';
      const dr = t && NX.driftOf(t.id, r.i);
      const drift = dr ? `<p class="sv-drift" title="${esc(dr.count)}"><span class="dr-i" aria-hidden="true">!</span>${esc(dr.title)}</p>` : '';
      return `<div class="sv-cell step ${tier}" data-row="${esc(r.key)}" style="${pad}"><span class="num ${num}${st.alt ? ' alt' : ''}">${esc(b)}</span><div class="sv-txt">${st.verb ? `<b class="sv-verb">${esc(st.verb)}</b>` : ''}${arrow}<p class="ja">${NX.linkify(st.label, { br: false })}</p>${drift}${meta ? `<p class="sv-meta">${meta}</p>` : ''}</div></div>`;
    }
    if (r.type === 'ftop') {
      const fr = r.frame;
      if (fr.type === 'ref') return `<div class="sv-cell ftop ref" data-row="${esc(r.key)}" style="${pad}"><span class="tag paper">${NX.ICON.paper}中の紙</span><b class="sv-ptitle">${esc(fr.paper.title)}</b><button class="btn small" type="button" data-close="${esc(fr.id)}" title="閉じる">閉じる</button></div>`;
      if (fr.sub === 'branch') return `<div class="sv-cell ftop" data-row="${esc(r.key)}" style="${pad}"><span class="sv-kw">分かれ道</span><span>［${esc(r.guard)}］なら → ${NX.linkify(r.outcome)}</span></div>`;
      return `<div class="sv-cell ftop" data-row="${esc(r.key)}" style="${pad}"><span class="sv-kw">もし</span><span>［${esc(r.guard)}］の時</span></div>`;
    }
    if (r.type === 'operand') {
      const fr = r.frame;
      if (fr.sub === 'branch') return `<div class="sv-cell operand" data-row="${esc(r.key)}" style="${pad}"><span>［${esc(r.guard)}］なら → ${NX.linkify(r.outcome)}</span></div>`;
      const at = fr.at != null ? S.stepNo(sd.X, fr.scope.sheet, fr.at) : '';
      return `<div class="sv-cell operand" data-row="${esc(r.key)}" style="${pad}"><span>［${esc(r.guard)}］の時は、${esc(at)} の代わりに</span></div>`;
    }
    if (r.type === 'fbot') return `<div class="sv-cell fbot" data-row="${esc(r.key)}" style="${pad}"></div>`;
    if (r.type === 'fold') {
      const chips = r.ghosts.map((gh) => {
        const inner = gh.ks.map((k) => S.stepBadge(sd.X, r.child.sheet, k)).join('・');
        return `<button type="button" class="sv-gchip" data-row="${esc(gh.keys[0])}" title="外の ${esc(S.stepNo(sd.X, r.sheet, gh.i))} は、上の紙の ${esc(inner)} と同じこと"><span class="num${gh.st.alt ? ' alt' : ''}">${esc(S.stepBadge(sd.X, r.sheet, gh.i))}</span>${esc(gh.st.verb || S.KIND_LABEL[gh.st.kind] || '')}<span class="eq">＝ 紙の ${esc(inner)}</span></button>`;
      }).join('');
      return `<div class="sv-cell fold" data-row="${esc(r.key)}" style="${pad}"><p class="sv-fh">外の手順のうち、上の紙が描いたもの</p><div class="sv-gchips">${chips}</div></div>`;
    }
    if (r.type === 'ref') {
      const p = r.frame.paper, n = p.steps.filter((x) => !x.alt).length, alt = p.steps.length - n;
      return `<div class="sv-cell ref" data-row="${esc(r.key)}" style="${pad}"><span class="tag paper">${NX.ICON.paper}中の紙</span><b class="sv-ptitle">${esc(p.title)}</b><span class="sv-pn">${n} 手順${alt ? `・もし ${alt}` : ''}</span><button class="btn small" type="button" data-open="${esc(r.frame.id)}">開く ▸</button></div>`;
    }
    return '';
  }
  // the record's moment, as seq-plus maps it (only what the record can say)
  const TH = {};
  function thColor(t) {
    if (TH[t]) return TH[t];
    const n = NX.threadName(t);
    return (TH[t] = /idle/.test(n) ? 'var(--th-idle)' : /^kernel:\s*compositor/.test(n) ? 'var(--th-k1)' : /^kernel/.test(n) ? 'var(--th-k2)' : 'var(--th-app)');
  }
  const barW = (d) => NX.clamp((Math.log10(Math.max(d, 10)) - 1) / 5, 0, 1) * 60 + 2;
  function timeHTML(r, T, prev) {
    if (r.type !== 'step') return `<div class="sv-tcell" data-row="${esc(r.key)}"></div>`;
    const t = T.times.get(r.key);
    if (!t) return `<div class="sv-tcell" data-row="${esc(r.key)}"></div>`;
    if (t.why) return `<div class="sv-tcell none" data-row="${esc(r.key)}" title="${esc(S.WHY[t.why] || '')}"><span class="tn">—</span><small>${esc(S.WHY[t.why] || '')}</small></div>`;
    if (t.quality === 'same') return `<div class="sv-tcell same" data-row="${esc(r.key)}" style="--th:${thColor(t.thread)}"><span class="tn"><i></i>〃</span><small>同じ呼び出し</small></div>`;
    const sw = prev && prev.thread !== t.thread ? `<span class="sw">→ ${esc(S.threadShort(T.T, t.thread))}</span>` : '';
    const delta = t.delta != null ? `<span class="td">+${NX.fmt(t.delta)}<i style="width:${barW(t.delta)}px"></i></span>` : `<span class="td">${t.irq ? '割り込み（timer）' : 'この回の最初'}</span>`;
    const fn = t.quality === 'target' && t.fn ? `<small title="${esc(t.fn)} に入った時刻">${esc(t.fn.replace(/^[^.]*\./, ''))} に入った</small>` : '';
    return `<div class="sv-tcell" data-row="${esc(r.key)}" style="--th:${thColor(t.thread)}">${sw}<span class="tn"><i class="${t.quality}"></i>${NX.fmt(t.instr)}</span>${fn}${delta}</div>`;
  }

  // ---------------------------------------------------------------- render
  let M = null, G = null;
  function curKeyIn(m) {
    let k = sd.rowKeyOf(NX.state.stack);
    if (m && !m.rowIndex.has(k) && m.m.folds.has(k)) k = m.m.folds.get(k);
    return k;
  }
  function render() {
    const fid = flowId(), flow = TR[fid];
    const open = openSet();
    M = sd.model(fid, open);
    const all = S.allRefIds(sd.X, A.flows.find((f) => f.id === fid));
    $('#svEyebrow').innerHTML = `<b>${esc(flow.tab)}</b>・${esc(NX.countText(flow))}・上から下へ時間が進む`;
    $('#svTitle').textContent = flow.title;
    $('#svAll').innerHTML = `${NX.ICON.paper}${all.length && all.every((id) => open.includes(id)) ? '中の紙をすべて閉じる' : '中の紙をすべて開く'}`;
    const T = sd.times(M, occ[fid] || 0);
    $('#svTime').setAttribute('aria-pressed', String(showTime));
    $('#svOcc').innerHTML = T.occs.length > 1 && showTime ? `<button class="btn icon small" type="button" data-occ="-1" aria-label="前の回" ${T.occ === 0 ? 'disabled' : ''}>${NX.ICON.left}</button><span>記録の ${T.occ + 1} / ${T.occs.length} 回目</span><button class="btn icon small" type="button" data-occ="1" aria-label="次の回" ${T.occ >= T.occs.length - 1 ? 'disabled' : ''}>${NX.ICON.right}</button>` : '';
    const scroll = $('#svScroll');
    const onPhone = phone();
    $('#svGrid').classList.toggle('phone', onPhone);
    const narrW = onPhone ? scroll.clientWidth : innerWidth < 1280 ? 264 : innerWidth >= 1400 ? 336 : 300;
    const timeW = showTime && T.T && !onPhone ? 168 : 0;
    const avail = scroll.clientWidth - narrW - timeW - 2;
    const cur = curKeyIn(M);
    const curIdx = M.rowIndex.has(cur) ? M.rowIndex.get(cur) : -1;
    const tierOf = (r) => (r.key === cur ? 'now' : r.st && r.st.alt ? 'alt' : curIdx >= 0 && M.rowIndex.get(r.key) < curIdx ? 'passed' : 'tocome');
    const narr = $('#svNarr');
    const grid = $('#svGrid');
    grid.style.setProperty('--nw', narrW + 'px');
    narr.innerHTML = M.rows.map((r) => cellHTML(r, tierOf(r))).join('');
    if (onPhone) {
      // a phone: the steps as rows, each saying who hands to whom; the diagram stays in 歩く
      $('#svHeads').innerHTML = ''; $('#svBody').innerHTML = ''; $('#svTimeCol').innerHTML = '';
      $('#svCornerL').innerHTML = `<div class="sv-ch"><span class="panel-title">手順の文</span><span class="sv-chint">図は「歩く」のやりとり図で。ここでは誰が誰に渡すかを行の中に書く</span></div>`;
      G = null;
      const now = narr.querySelector('.sv-cell.now');
      if (now) { const top = now.offsetTop - 80; if (top < scroll.scrollTop || top > scroll.scrollTop + scroll.clientHeight - 160) scroll.scrollTop = Math.max(0, top); }
      return;
    }
    const cellH = new Map();
    for (const el of narr.children) { el.style.height = ''; cellH.set(el.dataset.row, el.offsetHeight); }
    G = sd.layout(M, { avail, compact: false, cellH });
    for (const el of narr.children) { const g = G.rows.get(el.dataset.row); if (g) el.style.height = g.h + 'px'; }
    grid.style.setProperty('--tw', timeW + 'px');
    grid.style.setProperty('--dw', G.diagW + 'px');
    grid.style.setProperty('--hh', G.headH + 'px');
    $('#svHeads').innerHTML = sd.heads(M, G, { node: NX.state.node });
    $('#svBody').innerHTML = sd.body(M, G, { current: cur, node: NX.state.node });
    $('#svCornerL').innerHTML = `<div class="sv-ch"><span class="panel-title">手順の文</span><span class="sv-chint">押すと選ぶ・<kbd>↑</kbd><kbd>↓</kbd> で 1 手ずつ・<kbd>Enter</kbd> で中の紙</span></div>`;
    const tc = $('#svTimeCol');
    if (timeW) {
      let prev = null;
      tc.innerHTML = M.rows.map((r) => {
        const h = timeHTML(r, T, prev);
        const t = T.times.get(r.key);
        if (t && !t.why && t.quality !== 'same') prev = t;
        return h;
      }).join('');
      for (const el of tc.children) { const g = G.rows.get(el.dataset.row); if (g) el.style.height = g.h + 'px'; }
      $('#svCornerR').innerHTML = `<div class="sv-ch"><span class="panel-title">記録の時間（命令数）</span><span class="sv-chint" title="${esc(T.T.tr.title)}">Editor の記録で、着く関数に入った時</span><span class="sv-chint"><i class="dot chain"></i>続けて <i class="dot target"></i>入っただけ</span></div>`;
      tc.hidden = false; $('#svCornerR').hidden = false;
    } else { tc.innerHTML = ''; tc.hidden = true; $('#svCornerR').hidden = true; }
    // the chosen row in view
    const g = G.rows.get(cur);
    if (g) {
      const top = G.headH + g.y, vh = scroll.clientHeight;
      if (top < scroll.scrollTop + G.headH + 20 || top + g.h > scroll.scrollTop + vh - 20) scroll.scrollTop = Math.max(0, top - G.headH - (vh - G.headH) * 0.3);
      const r = M.rows[M.rowIndex.get(cur)];
      const xa = G.colX.get(M.L.keyOf(r.scope, r.st.from)), xb = G.colX.get(M.L.keyOf(r.scope, r.st.to));
      const lo = Math.min(xa, xb) - 40, hi = Math.max(xa, xb) + 140;
      const visL = scroll.scrollLeft, visR = scroll.scrollLeft + scroll.clientWidth - narrW - timeW;
      if (lo < visL || hi > visR) scroll.scrollLeft = Math.max(0, (lo + hi) / 2 - (scroll.clientWidth - narrW - timeW) / 2);
    }
    sd.stick($('#svGrid'), Math.max(0, scroll.scrollLeft));
  }
  V.render = render;
  $('#svScroll').addEventListener('scroll', (e) => sd.stick($('#svGrid'), e.currentTarget.scrollLeft), { passive: true });
  V.onNode = () => {
    if (!M || !G) return;
    $('#svHeads').innerHTML = sd.heads(M, G, { node: NX.state.node });
    sd.stick($('#svGrid'), $('#svScroll').scrollLeft);
  };

  // ---------------------------------------------------------------- moves: down the visible rows
  const stepRows = () => (M ? M.rows.filter((r) => r.type === 'step') : []);
  function goRow(key, push) {
    const st = sd.stackOfRowKey(key, NX.state.stack);
    if (st) NX.set({ stack: st }, { push: !!push });
  }
  function move(d) {
    const rows = stepRows(), cur = curKeyIn(M), k = rows.findIndex((r) => r.key === cur);
    const n = rows[NX.clamp(k + d, 0, rows.length - 1)];
    if (n && n.key !== cur) goRow(n.key);
  }
  function setOpen(id, on) {
    const fid = flowId();
    let open = NX.state.open.filter((x) => x.split('/')[0] === fid);
    if (on) { if (!open.includes(id)) open.push(id); }
    else {
      open = open.filter((x) => x !== id && !x.startsWith(id + '/'));
      // closing the paper the chosen step is in: back to the step that leads into it
      const scopes = sd.scopeIds(NX.state.stack);
      const k = scopes.indexOf(id);
      if (k > 0) { NX.set({ open, stack: NX.state.stack.slice(0, k) }, { push: true }); return; }
    }
    NX.set({ open }, { push: true });
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('button.chip[data-node]')) return;
    const el = e.target.closest('[data-row],[data-open],[data-close],[data-occ],#svAll,#svTime');
    if (!el) return;
    if (el.id === 'svAll') {
      const all = S.allRefIds(sd.X, A.flows.find((f) => f.id === flowId()));
      const open = openSet();
      if (all.every((id) => open.includes(id))) NX.set({ open: [], stack: NX.state.stack.slice(0, 1) }, { push: true });
      else NX.set({ open: all }, { push: true });
      return;
    }
    if (el.id === 'svTime') { showTime = !showTime; render(); return; }
    if (el.dataset.occ) { occ[flowId()] = (occ[flowId()] || 0) + Number(el.dataset.occ); render(); return; }
    if (el.dataset.open) { setOpen(el.dataset.open, true); return; }
    if (el.dataset.close) { setOpen(el.dataset.close, false); return; }
    if (el.dataset.row && (el.classList.contains('step') || el.classList.contains('sq-step') || el.classList.contains('sv-gchip') || el.classList.contains('sq-fold') || el.classList.contains('sv-tcell'))) {
      if (M && !stepRows().some((r) => r.key === el.dataset.row)) return;
      NX.walk.stopPlay();
      goRow(el.dataset.row, true);
    }
  });
  root.addEventListener('mouseover', (e) => {
    const k = (e.target.closest('[data-row]') || {}).dataset;
    const key = k && k.row;
    for (const x of NX.$$('.sq-step.hover, .sv-cell.hover', root)) if (x.dataset.row !== key) x.classList.remove('hover');
    if (key) for (const x of NX.$$(`[data-row="${CSS.escape(key)}"]`, root)) if (x.classList.contains('sq-step') || x.classList.contains('sv-cell')) x.classList.add('hover');
  });
  V.onKey = (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'j') { e.preventDefault(); move(1); return true; }
    if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'k') { e.preventDefault(); move(-1); return true; }
    if (k === 'Enter') {
      const st = NX.state.stack, f = NX.topOf(st);
      if (NX.paperOf(TR[f.id], f.i)) { const d = NX.diveStack(st); if (d) NX.set({ stack: d }, { push: true }); e.preventDefault(); return true; }
      return false;
    }
    if (k === 'Escape') {
      const scopes = sd.scopeIds(NX.state.stack);
      if (scopes.length > 1) { setOpen(scopes[scopes.length - 1], false); e.preventDefault(); return true; }
      const open = NX.state.open.filter((x) => x.split('/')[0] === flowId());
      if (open.length) { setOpen(open[open.length - 1], false); e.preventDefault(); return true; }
      return false;
    }
    if (k === 'Home') { e.preventDefault(); const r = stepRows()[0]; if (r) goRow(r.key, true); return true; }
    if (k === 'End') { e.preventDefault(); const rs = stepRows(); if (rs.length) goRow(rs[rs.length - 1].key, true); return true; }
    return false;
  };
})();
