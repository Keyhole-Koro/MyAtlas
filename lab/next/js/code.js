// Code at the line (from code-tour): the real source of the step, opened where the step happens, the
// function that holds the line as a band, a callout under the line, and how sure the line is:
// a solid line from code.json, a dotted 「たぶんここ」 line found by lines.js, else the whole box.
// The sources load after the first paint (data/sources.js, a classic script). window.NX.code.
(function () {
  'use strict';
  const NX = window.NX, { A, C, esc, TR } = NX;
  const H = window.CTHL, CL = window.CTLINES;
  const code = (NX.code = { ready: false });
  const SRC = {}, RAW = {};
  let LN = null;
  const LANG = { mylang: 'MyLang', rust: 'Rust' };
  const LH = 20, PAD = 12;

  // ---------------------------------------------------------------- the sources
  code.load = () => {
    if (code.loading) return;
    code.loading = true;
    const done = () => {
      const all = window.ATLAS_SRC || {};
      for (const [p, t] of Object.entries(all)) { SRC[p] = t; RAW[p] = t.split('\n'); }
      LN = CL.make(A, C, RAW);
      code.ready = true;
      code.LN = LN;
      Object.keys(PLANS).forEach((k) => delete PLANS[k]);
      NX.emit({ sources: true }, {});
    };
    if (window.ATLAS_SRC) { done(); return; }
    const s = document.createElement('script');
    s.src = 'data/sources.js';
    s.onload = done;
    s.onerror = () => { code.failed = true; NX.emit({ sources: true }, {}); };
    document.head.append(s);
  };

  // ---------------------------------------------------------------- where a step happens
  const inSpan = (sp, path, line) => !!sp && sp.path === path && sp.s <= line && line <= sp.e;
  // The name a box has in code: its title when that is the code's name, else the code's name.
  function codeName(id) {
    const n = A.nodes[id] || {}, sym = ((C.nodes[id] || {}).symbol || '');
    const last = sym.split('.').pop();
    return n.title && (n.title === last || n.title.endsWith('.' + last)) ? n.title : sym || n.title || id;
  }
  code.codeName = codeName;
  function anchorOf(id) {
    const l = LN && LN.loc(id);
    if (!l) return null;
    if (!l.start) return { node: id, path: l.path, line: null };
    return { node: id, path: l.path, line: LN.focusLine(id) || LN.firstCodeLine(l.path, l.start, l.end || l.start) };
  }
  const PLANS = {};
  // What the panel shows for a step: the file, the band (the function the line is in), the line and how
  // sure it is (step, focus, likely, fields; def when only the box is known).
  code.plan = (trackId, i) => {
    const key = trackId + ':' + i;
    if (PLANS[key]) return PLANS[key];
    const t = TR[trackId], s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
    const ref = s.ref || fb.node;
    const p = { track: t, i, step: s, node: ref, path: null, band: null, bandNode: null, main: null, mainKind: 'none', why: '', hits: null, outside: false };
    if (!LN) return p;
    const w = LN.where(trackId, i);
    if (w && RAW[w.path]) {
      Object.assign(p, { path: w.path, main: w.line, mainKind: w.kind, why: w.why || '', hits: w.hits || null, fn: w.fn || null, rel: w.rel || null });
      const rs = LN.span(ref);
      const own = w.kind === 'fields' ? rs : LN.ownerOf(w.path, w.line, [fb.node, ref, tb.node]);
      let band = own || (rs && rs.path === w.path ? rs : null);
      // a line outside every box's function (UI 8: handle calls run_request): the band is the function
      // that holds the line, named by its code name, and the box that calls it is said with it
      if (!own && band) {
        const fa = LN.functionsIn(w.path).find((x) => x.s <= w.line && w.line <= x.e);
        if (fa) { band = { id: band.id, s: fa.s, e: fa.e }; p.bandName = fa.name; p.caller = ref; }
      }
      if (band) { p.band = [band.s, band.e]; p.bandNode = band.id; }
      p.outside = !own && !!band;
    } else {
      for (const id of [ref, tb.node, fb.node]) {
        const l = LN.loc(id);
        if (!l) continue;
        p.path = l.path; p.node = id; p.bandNode = id;
        if (l.start) { p.band = [l.start, l.end || l.start]; p.main = null; p.mainKind = 'def'; }
        else p.mainKind = 'file';
        break;
      }
    }
    if (p.band) p.sig = LN.firstCodeLine(p.path, p.band[0], p.band[1]);
    p.arrival = tb.node !== p.bandNode ? anchorOf(tb.node) : null;
    return (PLANS[key] = p);
  };
  code.nodePlan = (id, fields) => {
    const l = LN && LN.loc(id);
    const p = { node: id, bandNode: id, detour: true, path: l ? l.path : null, band: null, main: null, mainKind: 'none' };
    if (!l) return p;
    if (l.start) {
      p.band = [l.start, l.end || l.start];
      const f = LN.focusLine(id);
      p.main = f || null;
      p.mainKind = f ? 'focus' : 'def';
      p.sig = LN.firstCodeLine(l.path, l.start, l.end || l.start);
      if (fields && fields.length) p.hits = LN.fieldLines(l.path, l.start, l.end || l.start, fields);
    } else p.mainKind = 'file';
    return p;
  };
  // The function whose entries the record counts for a step: the one that holds its line.
  code.bandNodeOf = (trackId, i) => {
    const p = code.plan(trackId, i);
    if (p.bandNode) return p.bandNode;
    const t = TR[trackId], s = t.steps[i];
    for (const id of [s.ref, t.box[s.from].node, t.box[s.to].node]) if (id && A.nodes[id] && A.nodes[id].kind === 'func') return id;
    return null;
  };
  // How sure the line is, said plainly.
  code.whereHTML = (p) => {
    const own = LN && LN.span(p.node);
    let inside = '';
    if (p.bandName) inside = `<span class="co-in">${esc(p.bandName)} の中（${esc(codeName(p.caller || p.node))} が呼ぶ）</span>`;
    else if (p.main && p.bandNode && p.bandNode !== p.node && !inSpan(own, p.path, p.main)) inside = `<span class="co-in">${esc(codeName(p.bandNode))} の中</span>`;
    else if (p.outside && p.fn && p.rel === 'calls') inside = `<span class="co-in">${esc(p.fn)} の中（${esc(codeName(p.node))} が呼ぶ）</span>`;
    else if (p.outside) inside = `<span class="co-in">${esc(codeName(p.node))} の外（同じファイル）</span>`;
    switch (p.mainKind) {
      case 'step': return `<span class="co-where on" title="地図（code.json）が記録した、この手順が起きる行">起きる行 ${p.main}</span>${inside}`;
      case 'focus': return `<span class="co-where on" title="この箱は文 1 つ。その文の行">起きる行 ${p.main}</span>${inside}`;
      case 'likely': return `<span class="co-where likely" title="地図に起きる行の記録が無いので、手がかりから推した行。手がかり：${esc(p.why)}">たぶんここ ${p.main}<small>${esc(p.why)}</small></span>${inside}`;
      case 'fields': return `<span class="co-where fields" title="手順が挙げる欄の行">欄 ${p.hits.join('・')} 行</span>`;
      case 'def': return '<span class="co-where whole" title="この手順が起きる行は分からないので、手順を説明する箱のコード全体を示しています">行は分からない・箱のコード全体</span>';
      case 'file': return '<span class="co-where whole">ファイル全体</span>';
      default: return '';
    }
  };
  code.certainty = (p) => ({ step: 'sure', focus: 'sure', likely: 'likely', fields: 'fields', def: 'whole', file: 'whole' }[p.mainKind] || 'none');

  // ---------------------------------------------------------------- one panel (the walk view has one)
  // mount(el) → { show(plan, opts) }. opts.callout: HTML under the line; opts.onEmpty: HTML when there is no code.
  code.mount = (root) => {
    root.innerHTML = `<header class="code-head"></header><div class="code-wrap"><div class="code-scroll scroll" tabindex="0" aria-label="ソース"><div class="code-host"><div class="code-empty">ソースを読んでいます…</div></div></div><div class="ruler" title="ファイルの中の位置"></div></div>`;
    const head = root.querySelector('.code-head'), sc = root.querySelector('.code-scroll'), host = root.querySelector('.code-host'), ruler = root.querySelector('.ruler');
    const FILE = {};
    const V = { path: null, plan: null, bandEl: null, touched: [], marked: [], echo: [], mk: null, pill: null, callout: null, inLabel: null, coH: 0, sigTop: -1, bandEnd: -1, shown: false };
    function fileView(path) {
      if (FILE[path]) return FILE[path];
      const tok = H.tokenize(SRC[path], path);
      const el = document.createElement('div');
      el.className = 'file';
      const digits = String(tok.length).length;
      const gw = 26 + digits * 8 + 14;
      el.style.setProperty('--gw', gw + 'px');
      el.innerHTML = tok.map((l, k) => `<div class="ln"><span class="g"><span class="mk"></span><span class="no">${k + 1}</span></span><span class="tx">${H.lineHTML(l)}</span></div>`).join('');
      return (FILE[path] = { el, tok, lines: Array.from(el.children), gw });
    }
    function clearView() {
      const f = V.path && FILE[V.path];
      if (!f) return;
      for (const k of V.marked) f.lines[k - 1].lastChild.innerHTML = H.lineHTML(f.tok[k - 1]);
      for (const k of V.touched) f.lines[k - 1].classList.remove('in-band', 'main', 'likely', 'sig', 'hit', 'stuck', 'unstick');
      if (V.mk) V.mk.innerHTML = '';
      for (const x of [V.pill, V.callout, V.inLabel]) if (x) x.remove();
      if (V.bandEl) { const b = V.bandEl; while (b.firstChild) b.parentNode.insertBefore(b.firstChild, b); b.remove(); }
      Object.assign(V, { bandEl: null, touched: [], marked: [], echo: [], mk: null, pill: null, callout: null, inLabel: null, coH: 0, sigTop: -1, bandEnd: -1 });
    }
    // where a line sits, with the callout pushed in under the line (or above the band when there is no line)
    const lineTop = (n) => {
      const p = V.plan;
      let y = PAD + (n - 1) * LH;
      if (!p) return y;
      if (p.main) { if (n > p.main) y += V.coH; } else if (p.band) { if (n >= p.band[0]) y += V.coH; } else y += V.coH;
      return y;
    };
    function renderHead(p, opts = {}) {
      const tools = opts.tools ? `<span class="ch-tools">${opts.tools}</span>` : '';
      if (!p.path) { head.innerHTML = (p.detour ? '<span class="tag">寄り道</span>' : '<span class="ch-none">コード</span>') + (opts.min ? `<span class="ch-sum">${opts.minNote || 'この箱が指すコードは、地図に書かれていない'}</span>` : '') + tools; return; }
      const n = A.nodes[p.node] || {}, file = C.files[p.path] || {};
      const parts = p.path.split('/'), name = parts.pop();
      const layer = (A.nodes[p.bandNode || p.node] || n).layer;
      let h = p.detour ? '<span class="tag">寄り道</span>' : '';
      h += `<span class="ch-layer" style="--lc:${NX.layerVar(layer)}"></span>`;
      h += `<span class="ch-path" title="${esc(p.path)}"><span class="dir">${esc(parts.join('/'))}/</span><b>${esc(name)}</b></span>`;
      const lines = p.band ? (p.band[0] === p.band[1] ? `${p.band[0]} 行` : `${p.band[0]}–${p.band[1]} 行`) : '';
      if (p.band) h += `<span class="ch-meta"><span class="ch-in" style="--lc:${NX.layerVar(layer)}" title="${p.bandName ? `この行を持つ関数。${esc(codeName(p.caller || p.node))} が呼ぶ` : '帯にした関数（この行を持つ関数）'}">${esc(p.bandName || codeName(p.bandNode || p.node))} の中</span>${p.bandName ? `<span class="ch-by">${esc(codeName(p.caller || p.node))} が呼ぶ</span>` : ''} ${lines}</span>`;
      if (opts.min) h += `<span class="ch-sum">${code.whereHTML(p)}</span>`;
      else h += `<span class="ch-lang">${esc(LANG[file.lang] || file.lang || '')} · ${file.lines || ''} 行</span>`;
      head.innerHTML = h + tools;
    }
    function measureCallout() {
      const co = V.callout;
      if (!co) return;
      const cs = getComputedStyle(co);
      V.coH = co.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    }
    function onScroll() {
      const vp = ruler.querySelector('.vp');
      if (vp && sc.scrollHeight) {
        vp.style.top = `${(sc.scrollTop / sc.scrollHeight) * 100}%`;
        vp.style.height = `${Math.max(2, (sc.clientHeight / sc.scrollHeight) * 100)}%`;
      }
      if (V.sigTop < 0 || !V.path) return;
      const f = FILE[V.path], y = sc.scrollTop, ln = f.lines[V.sigTop - 1];
      const release = y >= lineTop(V.bandEnd) - LH;
      ln.classList.toggle('unstick', release);
      ln.classList.toggle('stuck', !release && y > lineTop(V.sigTop) - PAD + 1);
    }
    sc.addEventListener('scroll', onScroll, { passive: true });
    function renderRuler(p) {
      if (!p.path || !SRC[p.path]) { ruler.innerHTML = ''; return; }
      const total = sc.scrollHeight || 1;
      const pct = (px) => `${(px / total) * 100}%`;
      let h = '';
      if (p.band) {
        const y0 = lineTop(p.band[0]), y1 = lineTop(p.band[1]) + LH;
        h += `<i class="r-band" style="top:${pct(y0)};height:max(3px,${pct(y1 - y0)});--lc:${NX.layerVar((A.nodes[p.bandNode || p.node] || {}).layer)}"></i>`;
      }
      for (const k of p.hits || []) h += `<i class="r-hit" style="top:${pct(lineTop(k))}"></i>`;
      for (const k of V.echo) h += `<i class="r-echo" style="top:${pct(lineTop(k))}" title="${k} 行：手順の文に出てくる名前"></i>`;
      if (!p.detour && p.arrival && p.arrival.path === p.path && p.arrival.line) h += `<i class="r-arrive" style="top:${pct(lineTop(p.arrival.line))}"></i>`;
      if (p.main) h += `<i class="r-main${p.mainKind === 'likely' ? ' likely' : ''}" style="top:${pct(lineTop(p.main))}"></i>`;
      ruler.innerHTML = h + '<i class="vp"></i>';
    }
    ruler.addEventListener('click', (e) => {
      const r = ruler.getBoundingClientRect();
      sc.scrollTo({ top: ((e.clientY - r.top) / r.height) * sc.scrollHeight - sc.clientHeight / 2, behavior: 'smooth' });
    });

    function show(p, opts = {}) {
      renderHead(p, opts);
      root.classList.toggle('min', !!opts.min);
      // folded: only the head says what the code is; the body is drawn when it opens
      if (opts.min) { V.shown = false; return; }
      if (!code.ready) {
        host.innerHTML = `<div class="code-empty">${code.failed ? 'ソースを読めませんでした（data/sources.js）。' : 'ソースを読んでいます…'}</div>`;
        ruler.innerHTML = '';
        V.path = null;
        return;
      }
      if (!p.path || !SRC[p.path]) {
        clearView();
        V.path = null; V.plan = p;
        host.innerHTML = opts.empty || '<div class="code-empty">この箱が指すコードは、地図に書かれていません。</div>';
        sc.scrollTop = 0;
        ruler.innerHTML = '';
        return;
      }
      const f = fileView(p.path);
      const switching = V.path !== p.path;
      clearView();
      if (switching) { host.replaceChildren(f.el); V.path = p.path; }
      V.plan = p;
      sc.style.setProperty('--cw', `${Math.max(240, Math.min(720, sc.clientWidth - f.gw - 36))}px`);
      const words = p.step ? CL.wordsOf(p.step) : null;
      if (p.band) {
        const [s, e] = p.band;
        const b = document.createElement('div');
        b.className = 'band';
        b.style.setProperty('--lc', NX.layerVar((A.nodes[p.bandNode || p.node] || {}).layer));
        f.lines[s - 1].before(b);
        for (let k = s; k <= e; k++) {
          const ln = f.lines[k - 1];
          b.append(ln);
          ln.classList.add('in-band');
          V.touched.push(k);
          if (words && words.size) {
            const html = H.lineHTML(f.tok[k - 1], words);
            ln.lastChild.innerHTML = html;
            V.marked.push(k);
            if (html.includes('<mark')) V.echo.push(k);
          }
        }
        V.bandEl = b;
        if (p.sig && e - s >= 3) {
          const sigLn = f.lines[p.sig - 1];
          sigLn.classList.add('sig');
          V.sigTop = p.sig; V.bandEnd = e;
          // the band's name: 「〜の中」 on the function's head, which stays at the top while reading inside it
          const tag = document.createElement('span');
          tag.className = 'in-tag';
          tag.style.setProperty('--lc', NX.layerVar((A.nodes[p.bandNode || p.node] || {}).layer));
          tag.textContent = `${p.bandName || codeName(p.bandNode || p.node)} の中`;
          const room = sc.clientWidth - f.gw - 46 - NX.textW(RAW[p.path][p.sig - 1].replace(/\t/g, '    '), 13, 400, true);
          if (room > NX.textW(tag.textContent, 11, 650) + 30) { sigLn.lastChild.append(tag); V.inLabel = tag; }
        }
      }
      if (p.hits) for (const k of p.hits) { f.lines[k - 1].classList.add('hit'); V.touched.push(k); }
      if (words && words.size) {
        const wide = new Set([...words].filter(CL.distinctive));
        if (wide.size) {
          const inBand = (k) => p.band && k >= p.band[0] && k <= p.band[1];
          const re = new RegExp(`\\b(${[...wide].map(NX.reEsc).join('|')})\\b`);
          RAW[p.path].forEach((line, j) => {
            const k = j + 1;
            if (inBand(k) || !re.test(line)) return;
            const html = H.lineHTML(f.tok[j], wide);
            f.lines[j].lastChild.innerHTML = html;
            V.marked.push(k);
            if (html.includes('<mark')) V.echo.push(k);
          });
        }
      }
      if (p.main) {
        const ln = f.lines[p.main - 1];
        ln.classList.add('main');
        if (p.mainKind === 'likely') ln.classList.add('likely');
        V.touched.push(p.main);
        if (!p.band && words && words.size) { ln.lastChild.innerHTML = H.lineHTML(f.tok[p.main - 1], words); V.marked.push(p.main); }
        V.mk = ln.querySelector('.mk');
        V.mk.innerHTML = opts.badge || '';
      }
      if (!p.detour && p.arrival && p.arrival.path === p.path && p.arrival.line && p.arrival.line !== p.main) {
        const pill = document.createElement('span');
        pill.className = 'arrive-pill';
        pill.textContent = `着く先 · ${NX.title(p.arrival.node)}`;
        f.lines[p.arrival.line - 1].lastChild.append(pill);
        V.pill = pill;
      }
      const co = document.createElement('div');
      co.className = 'callout' + (p.detour ? ' detour' : '') + (p.main ? '' : ' at-top') + (p.mainKind === 'likely' ? ' likely' : '');
      co.innerHTML = opts.callout || '';
      if (p.main) f.lines[p.main - 1].after(co); else if (p.band) f.lines[p.band[0] - 1].parentNode.before(co); else f.el.prepend(co);
      V.callout = co;
      measureCallout();
      // the band's head in view when the callout still fits under it, else the line at a third
      const Hh = sc.clientHeight;
      const anchor = p.main || (p.band ? p.band[0] : 1);
      const aTop = lineTop(anchor), aBottom = aTop + LH + (p.main ? V.coH : 0);
      let y;
      if (opts.compact && p.main) y = aTop - 3 * LH;
      else if (p.band) {
        y = lineTop(p.band[0]) - 2 * LH - (p.band[0] > 1 && /^\s*\/?\*/.test(RAW[p.path][p.band[0] - 2] || '') ? 2 * LH : 0);
        if (!p.main) y -= V.coH;
        if (aBottom - y > Hh - 2 * LH) y = aTop - Math.round(Hh * 0.3);
      } else y = p.main ? aTop - Math.round(Hh * 0.3) : 0;
      y = Math.max(0, Math.round(y));
      if (switching || !V.shown || opts.jump) { sc.scrollTop = y; sc.scrollLeft = 0; }
      else sc.scrollTo({ top: y, left: 0, behavior: 'smooth' });
      if (V.shown && !matchMedia('(prefers-reduced-motion: reduce)').matches) co.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
      V.shown = true;
      renderRuler(p);
      onScroll();
    }
    return { show, el: root, relayout() { if (V.plan && V.path) { const f = FILE[V.path]; sc.style.setProperty('--cw', `${Math.max(240, Math.min(720, sc.clientWidth - f.gw - 36))}px`); measureCallout(); renderRuler(V.plan); } } };
  };
})();
