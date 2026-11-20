// Wiring: scrolling picks the scene, the picture follows; papers fold and unfold; cards, source, keys,
// progress, deep links.
(function () {
  const S = window.S, esc = S.esc;
  S.Text.render();
  S.Map.init();
  S.Board.init();
  S.Timeline && S.Timeline.init();
  if (history.scrollRestoration) history.scrollRestoration = 'manual';

  const stage = document.getElementById('g-stage');
  const graphic = document.getElementById('graphic');
  const head = document.getElementById('g-head');
  const lanesEl = document.getElementById('g-lanes');
  const mast = document.getElementById('mast');
  const allEls = [...document.querySelectorAll('.scene')];
  const elOf = {};
  for (const el of allEls) elOf[+el.dataset.scene] = el;
  const BOARD = new Set(['chapter', 'region', 'recap']);
  const INTRO = new Set(['hero', 'layers', 'cross', 'routes']);
  const narrow = S.narrow;

  // Scenes on the page: a folded paper takes its steps out of the reading order.
  let visible = [];
  function refreshVisible() { visible = allEls.filter((el) => !el.closest('[hidden]')).map((el) => +el.dataset.scene); }
  refreshVisible();

  // ---------- Masthead ----------
  const nav = document.getElementById('mast-nav');
  const navItems = [{ id: 'hero', label: '序', first: 0 }, ...S.chapters.map((c) => ({ id: `ch-${c.id}`, label: `<span class="n">${c.no}</span>${esc(c.tab)}`, first: c.first }))];
  const traceOpen = S.scenes.find((s) => s.kind === 'trace-open');
  if (traceOpen) navItems.push({ id: traceOpen.id, label: '記録', first: traceOpen.index });
  nav.innerHTML = navItems.map((it) => `<a href="#${it.id}" data-go="${it.id}">${it.label}</a>`).join('') + '<a href="#index-h" data-go="index-h">索引</a>';

  // ---------- Which scene is being read ----------
  let active = -1;
  // The line a scene's top has to cross: the middle of the window, or, with the picture on top,
  // a third of the way into the text below it.
  function trigger() {
    if (!narrow()) return innerHeight * 0.5;
    const gb = graphic.getBoundingClientRect().bottom;
    return gb + (innerHeight - gb) * 0.3;
  }
  function pick() {
    const y = trigger();
    let best = visible[0];
    for (const i of visible) { if (elOf[i].getBoundingClientRect().top <= y) best = i; else break; }
    return best;
  }
  const indexEl = document.getElementById('index');
  const indexOnScreen = () => indexEl.getBoundingClientRect().top < innerHeight * 0.5;

  function setActive(i, instant, force) {
    if (i === active && !force) return;
    const prev = S.scenes[active];
    active = i;
    const sc = S.scenes[i];
    for (const el of allEls) { const k = +el.dataset.scene; el.classList.toggle('is-active', k === i); el.classList.toggle('is-past', k < i); el.classList.toggle('is-next', k > i); }
    const trace = sc.kind === 'trace' || sc.kind === 'trace-open';
    const board = BOARD.has(sc.kind);
    stage.classList.toggle('is-trace', trace);
    stage.classList.toggle('is-board', board);
    stage.classList.toggle('is-intro', INTRO.has(sc.kind));
    if (trace) S.Timeline.show(sc, instant);
    else if (board) S.Board.show(sc);
    else {
      // Coming back to the map from the board or the record: it was hidden, so no flight.
      const hidden = !prev || BOARD.has(prev.kind) || prev.kind === 'trace' || prev.kind === 'trace-open';
      S.Map.show(sc, instant || (hidden && prev !== sc));
    }
    document.getElementById('map').classList.toggle('is-alt-scene', sc.kind === 'alt');
    renderHead(sc);
    markNav();
    if (!instant && history.replaceState && !indexOnScreen()) history.replaceState(null, '', '#' + sc.id);
  }
  S.reshow = () => { if (active >= 0) setActive(active, true, true); };

  // The masthead marks the chapter being read, or the index once it is on screen.
  function markNav() {
    const sc = S.scenes[active] || S.scenes[0];
    let cur = 0;
    navItems.forEach((it, k) => { if (sc.index >= it.first) cur = k; });
    if (indexOnScreen()) cur = navItems.length;
    [...nav.children].forEach((a, k) => a.setAttribute('aria-current', String(k === cur)));
  }

  // ---------- Head of the picture: where we are (with the papers we are inside), and the steps ----------
  function renderHead(sc) {
    if (INTRO.has(sc.kind)) {
      const t = { hero: '5 つの層', layers: '5 つの層と、その中身', cross: '層をまたぐもの', routes: '2 つの流れの道すじ' }[sc.kind];
      head.innerHTML = `<div class="gh-where"><span class="gh-ch">序</span><span class="gh-sub">${t}</span></div>`;
      return;
    }
    if (sc.kind === 'trace' || sc.kind === 'trace-open') { head.innerHTML = S.Timeline.head(sc); fitDots(); return; }
    const ch = S.chapterOf(sc);
    const d = S.D[sc.diag];
    let sub = '';
    if (sc.kind === 'chapter') sub = '道のり';
    else if (sc.kind === 'region') sub = '誰が走らせるか：' + esc(d.g.regions.find((r) => r.node === sc.region).label);
    else if (sc.kind === 'recap') sub = 'まとめ';
    else if (d.isPaper) {
      const trail = [];
      for (let x = d; x && x.parent; x = S.D[x.parent]) trail.unshift(`${esc(S.boxName(S.D[x.parent].box[x.host]))} の中`);
      sub = trail.join('<i>›</i>') + (sc.kind === 'paper' && !S.paperOpen(d.id) ? '<i>·</i>外からのぞく' : '');
    } else sub = esc(ch.title);
    // Step dots for the diagram being read.
    let dots = '';
    const showDots = (sc.kind === 'step' || sc.kind === 'alt' || sc.kind === 'paper-close' || (sc.kind === 'paper' && S.paperOpen(d.id)));
    if (showDots) {
      const list = [];
      for (const { i } of d.main) {
        list.push({ i, label: S.stepNo(d, i) });
        for (const a of d.alts.filter((x) => x.st.alt.at === i)) list.push({ i: a.i, label: S.stepNo(d, a.i), alt: true });
      }
      dots = `<div class="gh-dots">${list.map((x) => {
        const id = S.sid(d.id, x.i), target = S.sceneById[id];
        const state = sc.step === x.i && (sc.kind === 'step' || sc.kind === 'alt') && sc.diag === d.id ? 'cur' : target && target.index < sc.index ? 'done' : '';
        return `<button type="button" class="${state}${x.alt ? ' alt' : ''}" data-go="${id}" title="${esc(S.plain(S.heading(d, d.g.steps[x.i])))}">${esc(x.label)}</button>`;
      }).join('')}</div>`;
    }
    const pos = (sc.kind === 'step') ? `<span class="gh-count">${d.main.findIndex((x) => x.i === sc.step) + 1} / ${d.main.length}</span>` : '';
    head.innerHTML = `<div class="gh-where"><span class="gh-ch">${ch.no} 章 ${esc(ch.tab)}</span><span class="gh-sub">${sub}</span>${pos}</div>${dots}`;
    fitDots();
  }
  // Step dots that do not fit beside the title are left out (the count stays).
  function fitDots() {
    const dots = head.querySelector('.gh-dots');
    if (dots && dots.scrollWidth > dots.clientWidth + 1) dots.classList.add('none');
  }

  // ---------- Lane names that follow the camera ----------
  // A ruler at the left edge; with the picture on top (narrow screens) small tags on the lanes instead.
  const laneEls = {};
  function laneLabel(key, name, sub, tone, band) {
    let el = laneEls[key];
    if (!el) {
      el = laneEls[key] = S.html('div', { class: `lane-label T-${tone}${band ? ' band' : ''}` }, `<b>${esc(name)}</b><span>${esc(sub || '')}</span>`);
      lanesEl.appendChild(el);
    }
    return el;
  }
  S.onCamera = (cam, view) => {
    if (!lanesEl) return;
    const intro = stage.classList.contains('is-intro');
    let focus = null;
    const sc = S.scenes[active] || null;
    if (sc && sc.diag) {
      let d = S.D[sc.diag];
      // While gliding out of a paper, follow what is actually visible.
      while (d && d.isPaper && cam.k * d.s < 0.5) d = S.D[d.parent];
      let deeper = true;
      while (deeper) { deeper = false; for (const pid of Object.values(d.children || {})) if (cam.k * S.D[pid].s >= 0.5) { d = S.D[pid]; deeper = true; } }
      focus = d;
    }
    const tags = narrow();
    const shown = new Set();
    // Tags sit at the bottom left of their lane (labels of steps sit above boxes), and give way to the
    // current step's label.
    const lab = tags ? S.Map.labelRect() : null;
    if (focus && !intro) {
      const rows = focus.isPaper
        ? focus.rows.map((r) => ({ key: focus.id + '/' + r, y: focus.oy + focus.s * focus.L.rows[r].y, h: focus.s * focus.L.rows[r].h, name: focus.rowInfo[r].name, sub: focus.rowInfo[r].sub, tone: S.toneOf(focus.rowInfo[r].tone) || 'none' }))
        : S.STACK.map((l) => ({ key: 'lane/' + l, y: S.W.lanes[l].y, h: S.W.lanes[l].h, name: S.L[l].name, sub: S.L[l].sub, tone: l }));
      for (const r of rows) {
        const y0 = S.toScreen(0, r.y)[1], y1 = S.toScreen(0, r.y + r.h)[1];
        const top = Math.max(y0, 0), bot = Math.min(y1, view.h);
        if (bot - top < (tags ? 30 : 26)) continue;
        const el = laneLabel(r.key, r.name, r.sub, r.tone, focus.isPaper);
        let op = 1;
        if (tags) {
          const y = bot - 25;
          el.style.top = y + 'px'; el.style.height = '';
          if (lab && lab.y0 < y + 21 && lab.y1 > y && lab.x0 < 8 + el.offsetWidth) op = 0;
        } else { el.style.top = top + 'px'; el.style.height = (bot - top) + 'px'; }
        el.classList.toggle('short', bot - top < 52);
        el.style.opacity = op;
        shown.add(r.key);
      }
    }
    for (const [k, el] of Object.entries(laneEls)) if (!shown.has(k)) el.style.opacity = 0;
  };

  // ---------- Scrolling ----------
  let ticking = false;
  const progress = document.getElementById('progress');
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      setActive(pick());
      markNav();
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = (100 * scrollY / Math.max(1, max)).toFixed(2) + '%';
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  let resizeT = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { S.Map.resize(); S.Board.resize(); S.Timeline && S.Timeline.resize(); S.reshow(); onScroll(); }, 60);
  });

  // ---------- Papers: fold and unfold ----------
  const bodyOf = (diag) => document.querySelector(`.paper-body[data-body="${CSS.escape(diag)}"]`);
  S.paperOpen = (diag) => { const b = bodyOf(diag); return !!b && !b.hidden; };
  function setPaper(diag, open) {
    const body = bodyOf(diag);
    if (!body || body.hidden === !open) return;
    if (!open) body.querySelectorAll('.paper-body:not([hidden])').forEach((x) => setPaper(x.dataset.body, false));
    body.hidden = !open;
    body.closest('.paper-aside').classList.toggle('open', open);
    document.querySelectorAll(`.ph-toggle[data-toggle="${CSS.escape(diag)}"]`).forEach((b) => b.setAttribute('aria-expanded', String(open)));
    refreshVisible();
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.ph-toggle');
    if (!t) return;
    const diag = t.dataset.toggle, open = t.getAttribute('aria-expanded') !== 'true';
    setPaper(diag, open);
    if (open) S.reshow();                    // the picture goes into the box now
    else go(S.sid(diag, 'open'), true);       // folded: back to the head of the paper
  });

  // ---------- Going somewhere ----------
  // A scene is put on the trigger line; anything else under the masthead.
  function go(id, instant) {
    const el = document.getElementById(id);
    if (!el) return;
    for (let body = el.closest('.paper-body[hidden]'); body; body = el.closest('.paper-body[hidden]')) setPaper(body.dataset.body, true);
    const isScene = el.classList.contains('scene');
    let y;
    if (id === 'hero') y = 0;
    else if (isScene) y = scrollY + el.getBoundingClientRect().top - (trigger() - 24);
    else y = scrollY + el.getBoundingClientRect().top - (mast.offsetHeight + 16);
    scrollTo({ top: Math.max(0, y), behavior: instant ? 'instant' : 'smooth' });
    if (instant && isScene) setActive(+el.dataset.scene, true);
  }
  window.story = { go, scenes: S.scenes, setActive: (i) => setActive(i, true), open: setPaper };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    hideCard(true);
    if (a.dataset.open) setPaper(a.dataset.open, true);
    go(a.dataset.go === 'top' ? 'hero' : a.dataset.go);
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'Escape') { hideCard(true); closeSource(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      e.preventDefault();
      const pos = Math.max(0, visible.indexOf(active));
      const next = visible[S.clamp(pos + (k === 'j' ? 1 : -1), 0, visible.length - 1)];
      go(elOf[next].id);
    }
  });

  // ---------- Cards ----------
  const card = document.getElementById('card');
  let cardFor = null, pinned = false, hideT = 0;
  function placeCard(target) {
    const r = target.getBoundingClientRect();
    const cw = card.offsetWidth, chh = card.offsetHeight;
    let x = r.left, y = r.bottom + 10;
    if (x + cw > innerWidth - 12) x = innerWidth - 12 - cw;
    if (x < 12) x = 12;
    if (y + chh > innerHeight - 12) y = Math.max(innerHeight * 0.12, r.top - 10 - chh);
    if (y < 60) y = 60;
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }
  function showCard(id, target, pin) {
    clearTimeout(hideT);
    if (cardFor !== id) { card.innerHTML = S.cardHTML(id); cardFor = id; card.scrollTop = 0; }
    card.hidden = false;
    pinned = !!pin;
    card.classList.toggle('pinned', pinned);
    placeCard(target);
    S.Map.highlightNode(id, true);
    document.querySelectorAll('a.ref.on').forEach((x) => x.classList.remove('on'));
    if (target.matches && target.matches('a.ref')) target.classList.add('on');
  }
  function hideCard(force) {
    if (pinned && !force) return;
    clearTimeout(hideT);
    const doHide = () => { card.hidden = true; if (cardFor) S.Map.highlightNode(cardFor, false); cardFor = null; pinned = false; document.querySelectorAll('a.ref.on').forEach((x) => x.classList.remove('on')); };
    if (force) doHide(); else hideT = setTimeout(doHide, 160);
  }
  const NODE_SEL = 'a.ref, .bchip, .ix-item, svg .box, svg .st-dot, .tl-ev';
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest(NODE_SEL);
    if (t && !card.contains(t) && !pinned) showCard(t.dataset.node, t, false);
  });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest(NODE_SEL);
    if (t && !pinned && !(e.relatedTarget && (t.contains(e.relatedTarget) || card.contains(e.relatedTarget)))) hideCard(false);
  });
  card.addEventListener('pointerenter', () => clearTimeout(hideT));
  card.addEventListener('pointerleave', () => hideCard(false));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-go], .ph-toggle')) return;
    const t = e.target.closest(NODE_SEL);
    if (t && !card.contains(t)) { e.preventDefault(); showCard(t.dataset.node, t, true); return; }
    const inCard = e.target.closest('#card a.ref');
    if (inCard) { e.preventDefault(); const id = inCard.dataset.node; card.innerHTML = S.cardHTML(id); cardFor = id; pinned = true; card.classList.add('pinned'); card.scrollTop = 0; return; }
    if (!e.target.closest('#card')) hideCard(true);
  });
  document.addEventListener('focusin', (e) => { const t = e.target.closest(NODE_SEL); if (t) showCard(t.dataset.node, t, false); });
  addEventListener('scroll', () => { if (!pinned) hideCard(true); }, { passive: true });

  // ---------- Source ----------
  const src = document.getElementById('source'), srcBody = document.getElementById('source-body'), srcTitle = document.getElementById('source-title');
  const KW = /\b(void|i32|i64|u8|u32|bool|char|str|return|if|else|while|for|match|case|struct|enum|import|from|const|let|mut|fn|pub|impl|use|self|Self|true|false|null|None|Some|Option|Result|borrow|move|unsafe|break|continue|loop|in|as|type|syscall|module|View)\b/g;
  // Light colouring for MyLang and Rust: comments, strings, numbers, keywords.
  const escS = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let inBlock = false;
  function highlight(line) {
    if (inBlock || /^\s*\/\*/.test(line)) { inBlock = !/\*\//.test(line); return `<span class="tok-c">${escS(line)}</span>`; }
    let rest = line, comment = '';
    const cm = rest.indexOf('//');
    if (cm >= 0) { comment = rest.slice(cm); rest = rest.slice(0, cm); }
    const parts = rest.split(/("(?:[^"\\]|\\.)*")/);
    const out = parts.map((p, k) => k % 2 ? `<span class="tok-s">${escS(p)}</span>` : escS(p)
      .replace(KW, '<span class="tok-k">$1</span>')
      .replace(/\b(\d+)\b/g, '<span class="tok-n">$1</span>')).join('');
    return out + (comment ? `<span class="tok-c">${escS(comment)}</span>` : '');
  }
  async function openSource(path, line, end) {
    src.hidden = false;
    srcTitle.textContent = line ? `${path} : ${line}${end && end > line ? '–' + end : ''}` : path;
    srcBody.innerHTML = '<span class="ln">読み込み中…</span>';
    try {
      const res = await fetch('../data/src/' + path);
      if (!res.ok) throw new Error(res.status);
      const lines = (await res.text()).split('\n');
      inBlock = false;
      const lo = line ? +line : 0, hi = Math.max(lo, +(end || lo));
      srcBody.innerHTML = lines.map((l, k) => `<span class="ln${lo && k + 1 >= lo && k + 1 <= hi ? ' hit' : ''}${k + 1 === lo ? ' main' : ''}">${highlight(l) || ' '}</span>`).join('');
      const hit = lo ? srcBody.children[lo - 1] : null;
      srcBody.scrollTop = hit ? hit.offsetTop - srcBody.clientHeight * 0.3 : 0;
    } catch (err) {
      srcBody.innerHTML = `<span class="ln">ソースを読めなかった（${esc(String(err.message || err))}）。lab/serve.sh から開いてください。</span>`;
    }
  }
  function closeSource() { src.hidden = true; }
  document.getElementById('source-close').addEventListener('click', closeSource);
  document.addEventListener('click', (e) => { const b = e.target.closest('.st-code'); if (b) openSource(b.dataset.path, b.dataset.line, b.dataset.end); });
  S.openSource = openSource;
  S.checkCode();

  // ---------- Footer ----------
  document.getElementById('foot').innerHTML = `この読み物は、地図（<code>${esc(S.A.docs)}</code>）のデータから組み立てている。箱・矢印・手順の文・項目の説明・コードの行・記録は、そこから来ている。コードの「手順の行」は、ページを開いたときにソースを読み、その行が本当にその手順をしているか（行き先を呼ぶ・書く・返す）を確かめたもの。確かめられない行は出さず、行き先の定義を開く。地図がコードと合っているかは <code>${esc(S.A.how.check)}</code>、記録は <code>${esc(S.A.how.trace)}</code> で作る。`;

  // ---------- Start ----------
  // A link to a scene (#s-ui-4, #index-h) is honoured again once fonts and layout have settled,
  // unless the reader has started moving.
  const start = decodeURIComponent(location.hash.slice(1));
  let moved = false;
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, () => { moved = true; }, { passive: true, once: true });
  const goStart = () => { if (!moved) go(start, true); };
  if (start && document.getElementById(start)) {
    goStart();
    requestAnimationFrame(goStart);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => requestAnimationFrame(goStart)));
    addEventListener('load', () => requestAnimationFrame(goStart));
  } else setActive(visible[0], true);
  onScroll();
})();
