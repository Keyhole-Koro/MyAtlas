// The recorded run as a timeline: one lane per thread, the stretches each thread ran, the interrupts,
// and the functions entered that the map knows. The camera here is a time window.
(function () {
  const S = window.S, esc = S.esc;
  const T = S.TRACE;
  if (!T) return;
  const ORDER = Object.keys(T.threads).map(Number).sort((a, b) => rank(a) - rank(b));
  function rank(id) { const n = T.threads[id] || ''; return n.startsWith('kernel') ? 1 + id / 100 : id < 0 ? 9 : 0; }
  // "none running (idle)" is shown as idle, with the rest under it.
  const threadName = (id) => { const n = (T.threads[id] || String(id)).replace(/^kernel: /, ''); const m = n.match(/^(.*)\((\w+)\)$/); return m ? m[2] : n; };
  const threadSub = (id) => { const n = T.threads[id] || ''; const m = n.match(/^(.*)\((\w+)\)$/); return m ? m[1].trim() : n.startsWith('kernel') ? `kernel スレッド ${id}` : `スレッド ${id}`; };
  const SCHED = new Set(['kernel.irq-dispatch', 'kernel.tick', 'kernel.reschedule', 'kernel.cpu-time', 'kernel.charge', 'kernel.os-call', 'os.router']);
  const threadTone = (id) => (id < 0 ? 'none' : (T.threads[id] || '').startsWith('kernel') ? 'kernel' : 'app');
  const L = { gutter: 136, right: 22, top: 30, strip: 64, laneH: 46, gap: 6, axis: 24, labRow: 25 };
  const NAME_W = Math.ceil(Math.max(...Object.keys(T.threads).map((id) => S.textW(threadName(+id), 13, { weight: 700 })), 80));

  let svg, g, W = 700, H = 700, win = { t0: 0, t1: 1 }, anim = null, cur = null;
  const el = { runs: [], ticks: [], dots: [], irqs: [], reqs: [], labels: [] };
  const laneY = (thread) => L.top + L.strip + ORDER.indexOf(thread) * (L.laneH + L.gap);
  const lanesBottom = () => L.top + L.strip + ORDER.length * (L.laneH + L.gap) - L.gap;
  const x = (t) => L.gutter + ((t - win.t0) / (win.t1 - win.t0)) * (W - L.gutter - L.right);

  function build() {
    svg = document.getElementById('timeline');
    svg.innerHTML = '';
    el.runs = []; el.ticks = []; el.dots = []; el.irqs = []; el.reqs = [];
    g = S.svg('g', {}, svg);
    const clipId = 'tl-clip';
    const defs = S.svg('defs', {}, svg);
    const cp = S.svg('clipPath', { id: clipId }, defs);
    el.clip = S.svg('rect', {}, cp);
    // Lanes and thread names.
    el.lanes = ORDER.map((id) => {
      const y = laneY(id);
      const lg = S.svg('g', { class: `tl-lane T-${threadTone(id)}` }, g);
      const bg = S.svg('rect', { class: 'tl-lane-bg', x: L.gutter, y, height: L.laneH, rx: 8 }, lg);
      const chip = S.svg('rect', { class: 'tl-lane-chip', x: 16, y: y + 10, width: 4, height: L.laneH - 20, rx: 2 }, lg);
      return { id, bg, chip, y };
    });
    const body = S.svg('g', { 'clip-path': `url(#${clipId})` }, g);
    el.axis = S.svg('g', { class: 'tl-axis' }, body);
    el.body = body;
    // Running stretches.
    for (const r of S.traceRuns) {
      const rect = S.svg('rect', { class: `tl-run T-${threadTone(r.thread)}`, y: laneY(r.thread) + 6, height: L.laneH - 12, rx: 5 }, body);
      el.runs.push({ r, rect });
    }
    // Entered functions: ticks; the ones on the map are dots in their layer colour.
    for (const r of S.traceRuns) for (const e of r.events) {
      if (e.ev === 'enter' && !e.n) el.ticks.push({ e, line: S.svg('line', { class: 'tl-tick', y1: laneY(r.thread) + 12, y2: laneY(r.thread) + L.laneH - 12 }, body) });
    }
    for (const r of S.traceRuns) for (const e of r.events) {
      if (e.n) {
        const c = S.svg('circle', { class: `tl-dot T-${S.nodeTone(e.n) || 'none'} tl-ev`, cy: laneY(r.thread) + L.laneH / 2, r: 5, 'data-node': e.n, 'data-seq': e.seq }, body);
        el.dots.push({ e, c });
      }
    }
    // Interrupts and requests from the outside, on the strip above the lanes.
    for (const r of S.traceRuns) for (const e of r.events) {
      if (e.ev === 'irq') {
        const cause = (e.cause || []).join(',');
        const gI = S.svg('g', { class: `tl-irq C-${cause}` }, body);
        const line = S.svg('line', { class: 'tl-irq-line', y1: L.top + L.strip - 10, y2: lanesBottom() }, gI);
        const tri = S.svg('path', { class: 'tl-irq-tri' }, gI);
        const label = S.svg('text', { class: 'tl-irq-t', 'text-anchor': 'middle' }, gI);
        label.textContent = e.service || cause;
        el.irqs.push({ e, gI, line, tri, label, w: S.textW(label.textContent, 11.5, { weight: 700 }) });
      }
      if (e.ev === 'request') {
        const gR = S.svg('g', { class: 'tl-req' }, body);
        const line = S.svg('line', { class: 'tl-req-line', y1: L.top + 8, y2: lanesBottom() }, gR);
        const flag = S.svg('rect', { class: 'tl-req-flag', y: L.top - 2, height: 20, rx: 5 }, gR);
        const t = S.svg('text', { class: 'tl-req-t', y: L.top + 12 }, gR);
        t.textContent = e.method;
        el.reqs.push({ e, gR, line, flag, t, w: S.textW(e.method, 11.5, { mono: true }) + 14 });
      }
    }
    el.leads = S.svg('g', { class: 'tl-leads' }, body);
    el.labels = S.svg('g', { class: 'tl-labels' }, body);
    el.nameLayer = S.svg('g', { class: 'tl-names' }, g);
    for (const ln of el.lanes) {
      ln.nm = S.svg('text', { class: `tl-lane-name T-${threadTone(ln.id)}` }, el.nameLayer);
      ln.nm.textContent = threadName(ln.id);
      ln.sub = S.svg('text', { class: 'tl-lane-sub' }, el.nameLayer);
      ln.sub.textContent = threadSub(ln.id);
    }
    el.brackets = S.svg('g', { class: 'tl-brackets' }, body);
    el.legend = S.svg('g', { class: 'tl-legend' }, g);
  }

  function niceStep(span, n) {
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  }

  function draw(showLabels) {
    const yb = lanesBottom();
    el.clip.setAttribute('x', L.gutter - 8); el.clip.setAttribute('y', 0);
    el.clip.setAttribute('width', W - L.gutter - L.right + 16); el.clip.setAttribute('height', H);
    for (const ln of el.lanes) { ln.bg.setAttribute('x', L.gutter); ln.bg.setAttribute('width', W - L.gutter - L.right); }
    for (const { r, rect } of el.runs) {
      const x0 = x(r.start), x1 = x(r.end);
      rect.setAttribute('x', Math.max(L.gutter - 8, x0).toFixed(1));
      rect.setAttribute('width', Math.max(1.5, Math.min(W, x1) - Math.max(L.gutter - 8, x0)).toFixed(1));
    }
    for (const { e, line } of el.ticks) { const xx = x(e.instr).toFixed(1); line.setAttribute('x1', xx); line.setAttribute('x2', xx); }
    for (const { e, c } of el.dots) c.setAttribute('cx', x(e.instr).toFixed(1));
    // Interrupt labels only where they do not run into each other.
    let lastRight = -1e9;
    const sorted = el.irqs.slice().sort((a, b) => a.e.instr - b.e.instr);
    for (const it of sorted) {
      const xx = x(it.e.instr);
      it.line.setAttribute('x1', xx); it.line.setAttribute('x2', xx);
      const ty = L.top + L.strip - 12;
      it.tri.setAttribute('d', `M${xx - 5},${ty - 8} L${xx + 5},${ty - 8} L${xx},${ty} Z`);
      const lx = S.clamp(xx, L.gutter + it.w / 2 + 2, W - L.right - it.w / 2);
      const fits = lx - it.w / 2 > lastRight + 6 && xx > L.gutter - 1 && xx < W - L.right + 1;
      it.label.setAttribute('x', lx); it.label.setAttribute('y', ty - 14);
      it.label.style.opacity = fits ? 1 : 0;
      if (fits) lastRight = lx + it.w / 2;
    }
    for (const it of el.reqs) {
      const xx = x(it.e.instr);
      it.line.setAttribute('x1', xx); it.line.setAttribute('x2', xx);
      const fx = Math.min(Math.max(xx - 1, L.gutter), W - L.right - it.w);
      it.flag.setAttribute('x', fx); it.flag.setAttribute('width', it.w);
      it.t.setAttribute('x', fx + 7);
      it.gR.style.display = xx < L.gutter - 1 || xx > W - L.right + 1 ? 'none' : '';
    }
    // Axis.
    el.axis.textContent = '';
    const span = win.t1 - win.t0, step = niceStep(span, Math.max(2, Math.floor((W - L.gutter) / 120)));
    for (let v = Math.ceil(win.t0 / step) * step; v <= win.t1; v += step) {
      const xx = x(v);
      S.svg('line', { class: 'tl-grid', x1: xx, x2: xx, y1: L.top + L.strip - 4, y2: yb + 6 }, el.axis);
      S.svg('text', { class: 'tl-axis-t', x: xx, y: yb + 22, 'text-anchor': 'middle' }, el.axis).textContent = S.num(Math.round(v) || 0);
    }
    S.svg('text', { class: 'tl-axis-u', x: W - L.right, y: yb + 40, 'text-anchor': 'end' }, el.axis).textContent = '命令の数（時間）';
    labels(showLabels);
    brackets();
  }

  // The scenes of the story as brackets under the axis; the one being read stands out.
  function brackets() {
    el.brackets.textContent = '';
    el.legend.textContent = '';
    const y = lanesBottom() + 58;
    const scenes = S.scenes.filter((s) => s.kind === 'trace');
    if (cur && cur.kind === 'trace-open' && H > 520) {
      scenes.forEach((s, k) => {
        const x0 = Math.max(x(s.t0), L.gutter), x1 = Math.max(Math.min(x(s.t1), W - L.right), x0 + 4);
        const bg = S.svg('g', { class: 'tl-br', 'data-go': s.id }, el.brackets);
        S.svg('path', { class: 'tl-br-l', d: `M${x0 + 1},${y - 6} L${x0 + 1},${y} L${x1 - 1},${y} L${x1 - 1},${y - 6}` }, bg);
        const r = 11, cx = S.clamp((x0 + x1) / 2, L.gutter + r, W - L.right - r);
        S.svg('circle', { class: 'tl-br-c', cx, cy: y + 16 + (k % 2) * 26, r }, bg);
        S.svg('text', { class: 'tl-br-t', x: cx, y: y + 20 + (k % 2) * 26, 'text-anchor': 'middle' }, bg).textContent = k + 1;
        S.svg('line', { class: 'tl-br-l', x1: cx, x2: cx, y1: y, y2: y + 5 + (k % 2) * 26 }, bg);
      });
      // Legend.
      const ly = Math.min(H - 40, y + 82);
      const items = [['dot', '地図にある関数に入った（色は層）'], ['tick', '地図にない関数に入った'], ['tri', '割り込み（syscall は頼んだ OS_CALL）'], ['bar', 'そのスレッドが走っていた間']];
      items.forEach(([k, t], n) => {
        const lx = L.gutter + (n % 2) * Math.max(220, (W - L.gutter - L.right) / 2), yy = ly + Math.floor(n / 2) * 24;
        if (k === 'dot') { S.svg('circle', { cx: lx + 6, cy: yy - 4, r: 5, class: 'tl-dot T-os' }, el.legend); }
        if (k === 'tick') S.svg('line', { x1: lx + 6, x2: lx + 6, y1: yy - 11, y2: yy + 3, class: 'tl-tick' }, el.legend);
        if (k === 'tri') S.svg('path', { d: `M${lx + 1},${yy - 9} L${lx + 11},${yy - 9} L${lx + 6},${yy - 1} Z`, class: 'tl-irq-tri' }, el.legend);
        if (k === 'bar') S.svg('rect', { x: lx, y: yy - 11, width: 14, height: 12, rx: 3, class: 'tl-run T-kernel' }, el.legend);
        S.svg('text', { x: lx + 20, y: yy, class: 'tl-legend-t' }, el.legend).textContent = t;
      });
    }
  }

  // Names of the functions on the map, in rows under the lanes, each tied to its dot by a thin line.
  function labels(show) {
    el.labels.textContent = '';
    el.leads.textContent = '';
    if (!show || !cur || cur.kind !== 'trace') return;
    const runs = new Set(cur.runs);
    // Only the functions this part is about; interrupt and switching functions stay as dots.
    const items = el.dots.filter(({ e }) => !SCHED.has(e.n) && runs.has(S.traceRuns.findIndex((r) => r.events.includes(e))) && e.instr >= win.t0 && e.instr <= win.t1);
    const y0 = lanesBottom() + 58, maxRows = Math.floor((H - y0 - 30) / L.labRow);
    if (maxRows < 2) return;
    const rowsRight = Array(maxRows).fill(-1e9);
    let hidden = 0;
    for (const { e } of items) {
      const xx = x(e.instr);
      const name = S.title(e.n);
      const w = S.textW(name, 12, { mono: S.codeLike(name) }) + 18;
      let lx = Math.min(Math.max(xx - 6, L.gutter), W - L.right - w);
      let row = rowsRight.findIndex((r) => lx > r + 4);
      if (row < 0) { hidden++; continue; }
      rowsRight[row] = lx + w;
      const ly = y0 + row * L.labRow;
      const lg = S.svg('g', { class: `tl-lab T-${S.nodeTone(e.n) || 'none'} tl-ev`, 'data-node': e.n }, el.labels);
      const ty = laneY(S.traceRuns.find((r) => r.events.includes(e)).thread) + L.laneH / 2;
      S.svg('path', { class: `tl-lead T-${S.nodeTone(e.n) || 'none'}`, d: `M${xx},${ty + 6} L${xx},${ly - 9} L${lx + 6},${ly - 9}` }, el.leads);
      S.svg('circle', { class: 'tl-lab-dot', cx: lx + 6, cy: ly - 4, r: 4 }, lg);
      S.svg('text', { class: 'tl-lab-t' + (S.codeLike(name) ? ' mono' : ''), x: lx + 15, y: ly }, lg).textContent = name;
    }
    const note = (hidden ? `ほか ${hidden} 件と、` : '') + '割り込みと切り替えの関数（点だけ）は、本文に順に並べた';
    S.svg('text', { class: 'tl-more', x: W - L.right, y: H - 14, 'text-anchor': 'end' }, el.labels).textContent = note;
  }

  function highlight(sc) {
    const runs = new Set(sc.kind === 'trace' ? sc.runs : S.traceRuns.map((r) => r.i));
    for (const { r, rect } of el.runs) rect.classList.toggle('dim', !runs.has(r.i));
    for (const { e, c } of el.dots) c.classList.toggle('dim', sc.kind === 'trace' && !(e.instr >= sc.t0 && e.instr <= sc.t1));
  }

  function flyTo(t0, t1, instant) {
    if (anim) cancelAnimationFrame(anim);
    const a0 = win.t0, a1 = win.t1;
    if (instant || S.reduceMotion) { win = { t0, t1 }; draw(true); return; }
    const start = performance.now(), dur = 900;
    // Zoom in log space so that a far jump does not crawl.
    const la = Math.log(a1 - a0), lb = Math.log(t1 - t0), ca = (a0 + a1) / 2, cb = (t0 + t1) / 2;
    const step = (now) => {
      const u = S.easeInOut(S.clamp((now - start) / dur, 0, 1));
      const span = Math.exp(S.lerp(la, lb, u)), c = S.lerp(ca, cb, u);
      win = { t0: c - span / 2, t1: c + span / 2 };
      draw(u >= 1);
      if (u < 1) anim = requestAnimationFrame(step); else anim = null;
    };
    anim = requestAnimationFrame(step);
  }

  // ---------- Text for the scenes ----------
  const fnShort = (fn) => fn;
  function chainHTML(events) {
    // Beats: a new beat starts at each interrupt.
    const beats = [];
    let curB = { head: null, items: [] };
    for (const e of events) {
      if (e.ev === 'irq') {
        if (curB.items.length || curB.head) beats.push(curB);
        const cause = (e.cause || []).join(',');
        curB = { head: { cause, service: e.service, instr: e.instr }, items: [] };
        continue;
      }
      curB.items.push(e);
    }
    if (curB.items.length || curB.head) beats.push(curB);
    return beats.map((b) => {
      const head = b.head
        ? `<span class="tb-irq C-${esc(b.head.cause)}">割り込み ${esc(b.head.cause)}${b.head.service ? ` <b>${esc(b.head.service)}</b>` : ''}</span>`
        : '';
      const items = b.items.map((e) => {
        if (e.ev === 'switch') return `<span class="tb-sw">${esc(threadName(e.thread))} に切り替わる</span>`;
        if (e.ev === 'enter' && !e.n && !e.fn) return '';
        if (e.ev === 'request') return `<span class="tb-req"><code>${esc(e.method)}</code></span>`;
        if (e.n) return `<a class="tb-fn ref T-${S.nodeTone(e.n) || 'none'}" href="#node-${esc(e.n)}" data-node="${esc(e.n)}" data-seq="${e.seq}">${esc(e.fn || S.title(e.n))}</a>`;
        return `<span class="tb-fn plain">${esc(fnShort(e.fn || e.ev))}</span>`;
      }).join(' <i>›</i> ');
      return `<div class="tb">${head}<div class="tb-chain">${items}</div></div>`;
    }).join('');
  }

  S.traceBlock = (sc) => {
    if (sc.kind === 'trace-open') {
      const run = T.run || {}, b = run.before || {}, a = run.after || {};
      const m = String(T.date || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      const date = m ? `${+m[1]} 年 ${+m[2]} 月 ${+m[3]} 日 ${m[4]}:${m[5]}` : esc(T.date || '');
      const threads = ORDER.map((id) => `<li class="T-${threadTone(id)}"><span class="nm">${esc(threadName(id))}</span><span class="sb">${esc(T.threads[id])}</span></li>`).join('');
      const mapped = T.events.filter((e) => e.n).length;
      const build = Object.entries(T.build || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`).join('');
      return `<p class="eyebrow">記録で見る</p><h2 class="lead-h">${esc(T.title)}</h2>
        <p>ここまでは地図の上の話。最後に、本物の 1 回を記録で見る。${date} に、Editor で「${esc(run.typed || '')}」を 1 文字打った間の、関数の入口と割り込みとスレッドの切り替えの記録。</p>
        <div class="tr-before"><div><span class="k">打つ前</span><b>${esc(b.title || '')}</b><span>${esc(b.position || '')}・本文「${esc(b.text || '')}」</span></div><div><span class="k">打った後</span><b>${esc(a.title || '')}</b><span>${esc(a.position || '')}・本文「${esc(a.text || '')}」</span></div></div>
        <p>記録には ${T.events.length} の出来事があり、そのうち ${mapped} 回は地図にある関数に入った（${S.SIDE}の図の色の点）。横軸は実行した命令の数（0〜${S.num(S.traceEnd)}）。帯は、そのスレッドが走っていた間。</p>
        <ul class="deflist threads">${threads}</ul>
        <details class="tr-build"><summary>記録したときの版</summary><table>${build}</table></details>`;
    }
    const runs = sc.runs.map((i) => S.traceRuns[i]);
    const ths = [...new Set(runs.map((r) => r.thread))];
    const events = runs.flatMap((r) => r.events);
    const svc = events.filter((e) => e.service).map((e) => e.service);
    const irqs = {};
    for (const e of events) if (e.ev === 'irq') { const c = (e.cause || []).join(','); irqs[c] = (irqs[c] || 0) + 1; }
    const title = runs.length === 1 ? `${esc(threadName(runs[0].thread))} が走る` : `${ths.map((t) => esc(threadName(t))).join('・')} が交代で走る`;
    const facts = [
      `<span class="meta-k">命令</span><span>${S.num(sc.t0)}〜${S.num(sc.t1)}（${S.num(sc.t1 - sc.t0)}）</span>`,
      Object.keys(irqs).length ? `<span class="meta-k">割り込み</span><span>${Object.entries(irqs).map(([c, n]) => `${esc(c)} ${n} 回`).join('、')}</span>` : '',
      svc.length ? `<span class="meta-k">OS_CALL</span><span>${svc.map((s) => `<b>${esc(s)}</b>`).join(' → ')}</span>` : '',
      runs.length > 1 ? `<span class="meta-k">切り替え</span><span>${runs.map((r) => esc(threadName(r.thread))).join(' → ')}</span>` : '',
    ].join('');
    const steps = linkSteps(events);
    return `<p class="eyebrow">記録 ${sc.id.split('-')[1]}</p><h3 class="st-verb">${title}</h3>
      <div class="st-meta">${facts}</div>
      ${steps ? `<p class="tr-steps">地図では：${steps}</p>` : ''}
      <details class="tr-chain"${runs.length > 2 ? '' : ' open'}><summary>入った関数を順に（${events.filter((e) => e.ev === 'enter').length}）</summary>${chainHTML(events)}</details>`;
  };

  // Steps of the chapters whose source or target box is a node that was entered here.
  function linkSteps(events) {
    const nodes = new Set(events.filter((e) => e.n).map((e) => e.n));
    const out = [];
    for (const sc of S.scenes) {
      if (sc.kind !== 'step') continue;
      const d = S.D[sc.diag], st = d.g.steps[sc.step];
      if (nodes.has(d.box[st.to].node) && nodes.has(d.box[st.from].node)) out.push(`<a href="#${sc.id}" data-go="${sc.id}" class="tr-step">${esc(S.where(sc))}</a>`);
    }
    return out.slice(0, 8).join('');
  }

  S.Timeline = {
    init() { build(); this.resize(); win = { t0: 0, t1: S.traceEnd }; draw(false); },
    resize() {
      const r = svg.getBoundingClientRect();
      W = r.width || 700; H = r.height || 700;
      // Short panels (the picture on top of the text): thinner lanes, so the axis still fits.
      const short = H < 480;
      Object.assign(L, short ? { top: 20, strip: 50, laneH: S.clamp(Math.floor((H - 20 - 50 - 46) / ORDER.length) - 4, 24, 46), gap: 4 } : { top: 30, strip: 64, laneH: 46, gap: 6 });
      build();
      const narrow = W < 560;
      L.gutter = narrow ? 10 : Math.max(136, 28 + NAME_W + 14);
      for (const ln of el.lanes) {
        ln.chip.style.display = narrow ? 'none' : '';
        ln.nm.setAttribute('x', narrow ? 18 : 28); ln.nm.setAttribute('y', narrow ? ln.y + 15 : ln.y + L.laneH / 2 - 2);
        ln.sub.setAttribute('x', 28); ln.sub.setAttribute('y', ln.y + L.laneH / 2 + 14);
        ln.sub.style.display = narrow ? 'none' : '';
      }
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      draw(true);
    },
    show(sc, instant) {
      cur = sc;
      highlight(sc);
      if (sc.kind === 'trace-open') flyTo(-S.traceEnd * 0.01, S.traceEnd * 1.01, instant);
      else { const pad = (sc.t1 - sc.t0) * 0.06; flyTo(sc.t0 - pad, sc.t1 + pad, instant); }
    },
    head(sc) {
      const n = S.scenes.filter((s) => s.kind === 'trace');
      const i = n.indexOf(sc) + 1;
      return `<div class="gh-where"><span class="gh-ch">記録</span><span class="gh-sub">${esc(T.title)}</span>${i ? `<span class="gh-count">${i} / ${n.length}</span>` : ''}</div>
        <div class="gh-dots">${n.map((s, k) => `<button type="button" class="${s === sc ? 'cur' : s.index < sc.index ? 'done' : ''}" data-go="${s.id}">${k + 1}</button>`).join('')}</div>`;
    },
  };
})();
