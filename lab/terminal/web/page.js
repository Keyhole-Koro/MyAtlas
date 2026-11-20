// The page: loads the screens built from atlas_tui.py (tools/build_web.py) and replays them on keys.
(function () {
  'use strict';
  const canvas = document.getElementById('term');
  const screenEl = document.getElementById('screen');
  const toast = document.getElementById('toast');
  const wname = document.getElementById('wname');
  const cache = {};
  let D = null, cur = 0, preset = null, theme = 'dark';
  let lastFlowFrame = 0;
  const lastNav = {};
  const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter',
    Escape: 'esc', Backspace: 'backspace', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn',
    h: 'left', l: 'right', j: 'down', k: 'up', g: 'home', G: 'end', q: 'esc' };
  const KEYNAME = { left: '←', right: '→', up: '↑', down: '↓', enter: 'Enter', esc: 'Esc', pgup: 'PgUp', pgdn: 'PgDn',
    home: 'Home', end: 'End', backspace: 'BS' };

  async function load(name) {
    if (cache[name]) return cache[name];
    const res = await fetch('web/frames-' + name + '.json.gz');
    const buf = new Uint8Array(await res.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
      text = await ds.text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    const d = JSON.parse(text);
    d.index = {};
    d.meta.forEach((m, i) => {
      const k = m && JSON.stringify(m.nav) + '|' + m.m;
      if (m && m.s === 'flow' && !m.o && !m.x && d.index[k] === undefined) d.index[k] = i;
    });
    cache[name] = d;
    return d;
  }

  function frame(i) {
    return { w: D.w, h: D.h, styles: D.styles, rows: D.frames[i].map((r) => D.rows[r]) };
  }

  function size() {
    const narrow = innerWidth < 700;
    const maxW = Math.min(innerWidth - (narrow ? 24 : 56), 1700);
    const maxH = narrow ? Infinity : innerHeight - 132;
    return Term.fit(D.w, D.h, maxW, maxH);
  }

  let lastSize = null, anim = 0;

  // A dot runs along the current step's line, as in the terminal app.
  function pulse(cells) {
    cancelAnimationFrame(anim);
    if (!cells || cells.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    base.getContext('2d').drawImage(canvas, 0, 0);
    const dpr = devicePixelRatio || 1;
    const cwD = lastSize.cw * dpr, rhD = lastSize.rh * dpr;
    const t0 = performance.now(), dur = Math.min(560, 140 + cells.length * 10);
    const color = D.palettes[theme].strong;
    const tick = (now) => {
      const t = Math.max(0, Math.min(1, (now - t0) / dur));
      const f = (1 - Math.pow(1 - t, 2)) * (cells.length - 1);
      const i = Math.floor(f), fr = f - i;
      const a = cells[i], b = cells[Math.min(i + 1, cells.length - 1)];
      ctx.drawImage(base, 0, 0);
      if (t < 1) {
        const x = (a[0] + (b[0] - a[0]) * fr) * cwD + cwD / 2, y = (a[1] + (b[1] - a[1]) * fr) * rhD + rhD / 2;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, cwD * 0.42), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        anim = requestAnimationFrame(tick);
      }
    };
    anim = requestAnimationFrame(tick);
  }

  function draw() {
    if (!D) return;
    cancelAnimationFrame(anim);
    const fr = frame(cur);
    lastSize = size();
    Term.draw(canvas, fr, D.palettes[theme], lastSize);
    canvas.setAttribute('aria-label', Term.text(fr));
    screenEl.style.background = D.palettes[theme].bg;
    wname.textContent = 'atlas_tui.py — ' + D.w + '×' + D.h;
    const m = D.meta[cur];
    if (m && m.s === 'flow' && !m.o) {
      lastFlowFrame = cur;
      lastNav[m.flow] = m.nav;
    }
  }

  let toastTimer = 0;
  function show(k) {
    toast.innerHTML = '<kbd>' + (KEYNAME[k] || k) + '</kbd>';
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 900);
  }

  const back = [];   // where an overlay (help, details) returns to
  let returnTo = null;   // the list (記録 or 節の一覧) a flow was opened from: Esc at the top goes back there

  function press(k) {
    if (!D) return;
    const m = D.meta[cur];
    let to = D.next[cur][k];
    if (m && (m.o === 'help' || m.o === 'detail') && ['esc', 'q', '?', 'i', 'enter', 'backspace'].includes(k) &&
        !(m.o === 'detail' && k === 'enter')) {
      show(k);
      cur = back.length ? back.pop() : lastFlowFrame;
      draw();
      return;
    }
    if (to !== undefined && m && !m.o && (D.meta[to].o === 'help' || D.meta[to].o === 'detail')) back.push(cur);
    if (m && (m.s === 'nodes' || m.s === 'trace') && (k === 'esc' || k === 'backspace')) {
      to = lastFlowFrame;
    }
    if ((k === '1' || k === '2') && m) {
      const fid = Object.keys(D.starts)[Number(k) - 1];
      const nav = lastNav[fid] || [[fid, D.starts[fid]]];
      const hit = D.index[JSON.stringify(nav) + '|' + (m.s === 'flow' ? m.m : D.meta[lastFlowFrame].m)];
      if (hit !== undefined) to = hit;
    } else if (to !== undefined && m && (m.s === 'nodes' || m.s === 'trace') && ['esc', 'n', 't', 'backspace'].includes(k)
               && D.meta[to].s === 'flow') {
      to = lastFlowFrame;
    }
    if (to === undefined && k === 'esc' && m && m.s === 'flow' && !m.o && m.nav.length === 1 && returnTo !== null) {
      to = returnTo;
    }
    show(k);
    go(to, k === '1' || k === '2');
  }

  // moves to frame `to` (a key or a click led there)
  function go(to, leaving) {
    if (to === undefined || to === null) return;
    const before = D.meta[cur];
    if (before && (before.s === 'trace' || before.s === 'nodes') && D.meta[to].s === 'flow' && !D.meta[to].o) {
      returnTo = cur;
    } else if (leaving || (D.meta[to].s !== 'flow' && !D.meta[to].o) || to === returnTo) {
      returnTo = null;
    }
    cur = to;
    draw();
    const after = D.meta[cur];
    if (after && after.p && before && JSON.stringify(before.nav) !== JSON.stringify(after.nav)) pulse(after.p);
  }

  // clicks: the regions the app marks as clickable, exported per screen
  function hitAt(ev) {
    if (!D || !lastSize) return null;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / lastSize.cw), y = Math.floor((ev.clientY - r.top) / lastSize.rh);
    const m = D.meta[cur];
    const hs = (m && m.h !== undefined) ? D.hits[m.h] : [];
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i];
      if (h[0] <= x && x < h[2] && h[1] <= y && y < h[3]) return h[4];
    }
    return null;
  }
  canvas.addEventListener('click', (ev) => {
    const t = hitAt(ev);
    if (t === null) return;
    if (typeof t === 'string') press(t);
    else go(t, false);
  });
  canvas.addEventListener('mousemove', (ev) => {
    canvas.style.cursor = hitAt(ev) !== null ? 'pointer' : 'default';
  });

  async function setPreset(name) {
    preset = name;
    document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    try {
      D = await load(name);
    } catch (err) {
      const el = document.getElementById('loading');
      el.hidden = false;
      el.textContent = '画面のデータを読めませんでした。lab/serve.sh で開いてください（file:// では読めません）。';
      throw err;
    }
    cur = D.start;
    returnTo = null;
    back.length = 0;
    for (const k in lastNav) delete lastNav[k];
    document.getElementById('loading').hidden = true;
    draw();
    drawSample();
  }

  function setTheme(name) {
    theme = name;
    document.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === name)));
    draw();
    if (typeof drawSample === 'function') drawSample();
  }

  screenEl.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let k = KEYMAP[e.key] || (e.key.length === 1 ? e.key : null);
    if (e.key === ' ') k = 'right';
    if (!k) return;
    e.preventDefault();
    press(k);
  });
  screenEl.addEventListener('click', () => screenEl.focus());
  document.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => { press(b.dataset.key); screenEl.focus({ preventScroll: true }); }));
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.preset)));
  document.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.theme)));
  document.getElementById('copy').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(document.getElementById('cmd').textContent);
  });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { draw(); drawSample(); }, 80); });

  // for the screenshot tool: press('right') etc.
  window.atlasPress = (...keys) => keys.forEach(press);
  window.atlasPreset = setPreset;
  window.atlasTheme = setTheme;

  // the --render sample, drawn the same way: fitted to the card, but never smaller than readable (then the
  // card scrolls sideways)
  const rc = document.getElementById('render-canvas');
  function drawSample() {
    if (!window.RENDER_FRAME || !D) return;
    const box = rc.parentElement;
    const w = Math.max(320, box.clientWidth - 20);
    const fit = Term.fit(RENDER_FRAME.w, RENDER_FRAME.h, w);
    const cw = Math.max(fit.cw, 6.4);
    Term.draw(rc, window.RENDER_FRAME, D.palettes[theme], { cw: cw, rh: cw * 2.12 });
    rc.setAttribute('aria-label', window.RENDER_SAMPLE || '');
    box.style.background = D.palettes[theme].bg;
    drawSwatches();
  }

  // the legend's samples: drawn by term.js like the screen, so the lines look exactly as they do there
  const SW = {
    now: [['━━━▶', 'accent', 1]], done: [['───▶', 'done', 0]], later: [['───▶', 'future', 0]],
    badge: [[' 5 時計を読む ', 'ink', 1, 'accent'], [' ', 'text', 0], [' 6 ', 'strong', 0, 'done_bg'], [' ', 'text', 0],
            [' 7 ', 'dim', 0, 'future_bg']],
    alt: [[' A ', 'ink', 1, 'warn']],
    call: [['───▶', 'text', 0]], syscall: [['═══▶', 'text', 0]], msg: [['┄┄┄▶', 'text', 0]],
    signal: [['◆┈┈▶', 'text', 0]], return: [['╌╌╌▷', 'text', 0]],
    func: [['┌──┐', 'text', 0]], func2: [['└──┘', 'text', 0]], store: [['╭──╮', 'text', 0]], store2: [['╰──╯', 'text', 0]],
    paper: [[' 中の紙 ', 'ink', 1, 'accent']], region: [['      ', 'text', 0, 'region']],
  };
  const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
  function swatchFrame(name) {
    const rows = [SW[name]];
    if (name === 'func' || name === 'store') rows.push(SW[name + '2']);
    const styles = [], out = [];
    let w = 0;
    for (const parts of rows) {
      const row = [];
      let x = 0;
      for (const [text, fg, attr, bg] of parts) {
        styles.push([fg, bg || 'bg', attr]);
        // wide characters (2 cells each) in runs of their own, as the app writes them
        for (const run of text.match(new RegExp(WIDE.source + '+|[^' + WIDE.source.slice(1, -1) + ']+', 'g'))) {
          const wide = WIDE.test(run);
          row.push(wide ? [x, styles.length - 1, run, 1] : [x, styles.length - 1, run]);
          x += wide ? [...run].length * 2 : [...run].length;
        }
      }
      w = Math.max(w, x);
      out.push(row);
    }
    return { w: w, h: out.length, styles: styles, rows: out };
  }
  function drawSwatches() {
    if (!D) return;
    document.querySelectorAll('canvas[data-sw]').forEach((c) => {
      const fr = swatchFrame(c.dataset.sw);
      const cw = fr.h > 1 ? 8.5 : 10.5;
      Term.draw(c, fr, D.palettes[theme], { cw: cw, rh: fr.h > 1 ? 12 : 22 });
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', Term.text(fr));
    });
  }
  document.getElementById('copy-render').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(window.RENDER_SAMPLE || '');
  });
  const params = new URLSearchParams(location.search);
  setTheme(params.get('theme') || 'dark');
  setPreset(params.get('size') || (innerWidth < 700 ? 'narrow' : innerWidth < 1250 ? 'medium' : 'wide'))
    .then(() => { screenEl.focus({ preventScroll: true }); if (params.get('keys')) params.get('keys').split(',').forEach(press); });
})();
