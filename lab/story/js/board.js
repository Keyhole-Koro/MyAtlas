// The chapter at a glance. A whole flow drawn as a map is far too wide for the panel (it shrank to a
// third and its labels ran into each other), so the chapter opener, its contexts and its recap show
// this board instead: one row per step from top to bottom, the layers as columns on the left (the
// intro's route line, turned upright), and on the right who runs each step (the map's dashed frames).
// Every row is a link to its step. All of it is laid out from the panel's real size, in screen pixels.
(function () {
  const S = window.S, esc = S.esc;
  let root = null, cur = null;

  // Rows: the steps in order, with the papers opened after a step and the steps that can happen
  // instead of one, where the story has them.
  function rowsOf(d) {
    const rows = [];
    for (const { st, i } of d.main) {
      rows.push({ type: 'step', i, st, no: S.stepNo(d, i) });
      for (const p of Object.values(S.D)) if (p.parent === d.id && p.after === i) rows.push({ type: 'paper', p });
      const alts = d.alts.filter((x) => x.st.alt.at === i);
      if (alts.length) rows.push({ type: 'alt', at: i, alts });
    }
    return rows;
  }

  // Two capitals in upright text are set side by side in one square (tate-chu-yoko); the space after
  // them becomes a small margin (a space in upright text is a whole empty square).
  const tcy = (s) => esc(s).replace(/\b([A-Z]{2})\b ?/g, '<span class="tcy">$1</span>');

  function render(d, W, H) {
    const cols = S.STACK.filter((l) => d.g.boxes.some((b) => b.layer === l));
    const names = cols.map((l) => S.L[l].name);
    const rows = rowsOf(d);
    const nStep = rows.filter((r) => r.type === 'step').length, nExtra = rows.length - nStep;
    const pad = { t: 16, r: 18, b: 16, l: 16 };
    // Column heads: upright Japanese when the panel is tall, side by side when it is wide and short.
    const mode = H >= 470 ? 'v' : W >= 640 ? 'h' : 'vs';
    const fontV = mode === 'vs' ? 11 : 12.5;
    const charsMax = Math.max(...names.map((s) => [...s.replace(/[A-Z]{2} ?/, 'O')].length)) + 0.6;
    const colW = mode === 'h' ? Math.max(70, ...names.map((s) => S.textW(s, 12.5, { weight: 700 }) + 14)) : mode === 'v' ? 32 : 21;
    const headH = mode === 'h' ? 30 : Math.ceil(12 + charsMax * fontV * 1.1);
    const trackW = cols.length * colW;
    const textX = pad.l + trackW + 14;
    const whoW = W - textX - pad.r >= 330 + 140 ? S.clamp(W - textX - pad.r - 360 - 14, 136, 210) : 0;
    const textW = W - pad.r - textX - (whoW ? whoW + 14 : 0);
    const exH = mode === 'v' ? 30 : 0;
    const shown = rows.filter((r) => r.type === 'step' || exH);
    const avail = H - pad.t - pad.b - headH - 8 - (exH ? nExtra * exH : 0);
    const rowH = S.clamp(Math.floor(avail / nStep), 20, 60);
    const two = rowH >= 42;
    const routes = two || textW >= 330;   // one line, no room: the names come in the step itself
    let y = pad.t + headH + 8;
    for (const r of shown) { r.y = y; r.h = r.type === 'step' ? rowH : exH; y += r.h; }
    const bottom = y;
    const oy = Math.max(0, Math.floor((H - pad.b - bottom) / 2));
    const colX = (l) => pad.l + (cols.indexOf(l) + 0.5) * colW;
    const xOf = (box) => colX(d.box[box].layer);

    // ---- The track: the steps as one line through the layer columns ----
    let svg = '';
    const top0 = pad.t + headH;
    cols.forEach((l, k) => { svg += `<rect class="bd-col T-${l}" x="${pad.l + k * colW + 2}" y="${top0}" width="${colW - 4}" height="${bottom - top0 + 6}" rx="${Math.min(10, colW / 3)}"/>`; });
    const steps = shown.filter((r) => r.type === 'step');
    const gap = (a, b) => (b.y === a.y + a.h ? 4 : 0);
    let dots = '';
    steps.forEach((r, k) => {
      const prev = steps[k - 1], next = steps[k + 1];
      const cs = !!prev && prev.st.to === r.st.from, ce = !!next && next.st.from === r.st.to;
      const xa = xOf(r.st.from), xb = xOf(r.st.to);
      const ya = r.y + (prev && !cs ? gap(prev, r) : 0), yb = r.y + r.h - (next && !ce ? gap(r, next) : 0);
      const dy = yb - ya;
      svg += `<path class="bd-seg" data-k="${r.i}" pathLength="1" style="--k:${k}" d="M${xa},${ya} C${xa},${ya + dy * 0.6} ${xb},${yb - dy * 0.6} ${xb},${yb}"/>`;
      if (!prev) dots += `<circle class="bd-dot start" cx="${xa}" cy="${ya}" r="6"/>`;
      else if (!cs) {
        const pr = prev.y + prev.h - gap(prev, r), px = xOf(prev.st.to);
        svg += `<path class="bd-jump" d="M${px},${pr} C${px},${(pr + ya) / 2} ${xa},${(pr + ya) / 2} ${xa},${ya}"/>`;
        dots += `<circle class="bd-dot from" cx="${xa}" cy="${ya}" r="4"/>`;
      }
      if (next) {
        dots += `<circle class="bd-dot" cx="${xb}" cy="${yb}" r="4.2"/>`;
        // Through the rows in between (a paper, the steps that can happen instead).
        if (ce && next.y > yb) svg += `<path class="bd-seg thru" data-thru="${r.i}" d="M${xb},${yb} L${xb},${next.y}"/>`;
      } else dots += `<path class="bd-end" d="M${xb - 7},${yb - 3} L${xb},${yb + 7} L${xb + 7},${yb - 3} Z"/>`;
    });
    svg += dots;

    // ---- Heads of the columns ----
    let h = '';
    cols.forEach((l, k) => {
      const x = pad.l + k * colW;
      h += `<div class="bd-ch T-${l} m-${mode}" style="left:${x}px;top:${pad.t}px;width:${colW}px;height:${headH}px" title="${esc(S.L[l].name)}・${esc(S.L[l].sub)}"><span>${tcy(S.L[l].name)}</span></div>`;
    });
    h += `<div class="bd-th" style="left:${textX}px;top:${pad.t + headH - 22}px;width:${textW}px">手順<span>押すとその段落へ</span></div>`;
    if (whoW) h += `<div class="bd-th" style="left:${W - pad.r - whoW}px;top:${pad.t + headH - 22}px;width:${whoW}px">走らせる文脈</div>`;

    // ---- The rows ----
    const chip = (b) => `<i class="T-${b.layer}"></i><span class="${S.isJa(S.boxName(b)) ? '' : 'mono'}">${esc(S.boxName(b))}</span>`;
    for (const r of shown) {
      const style = `left:${textX - 6}px;top:${r.y}px;width:${textW + 6}px;height:${r.h}px`;
      if (r.type === 'step') {
        const a = d.box[r.st.from], b = d.box[r.st.to];
        const reg = S.regionOf(d, S.actorOf(d, r.st));
        h += `<a class="bd-row step${two ? ' two' : ''}" href="#${S.sid(d.id, r.i)}" data-go="${S.sid(d.id, r.i)}" data-k="${r.i}" data-region="${reg ? esc(reg.node) : ''}" style="${style}">`
          + `<span class="bd-no">${esc(r.no)}</span><span class="bd-t"><b class="bd-v">${S.inline(S.heading(d, r.st))}</b>`
          + (routes ? `<span class="bd-r">${chip(a)}<span class="ar">→</span>${chip(b)}</span>` : '') + '</span></a>';
      } else if (r.type === 'paper') {
        const p = r.p, open = S.scenes.find((x) => x.kind === 'paper' && x.diag === p.id);
        const host = d.box[p.host];
        h += `<a class="bd-row paper" href="#${open.id}" data-go="${open.id}" data-open="${esc(p.id)}" style="${style}"><span class="bd-pp" aria-hidden="true"></span><span class="bd-t"><b>寄り道</b><span>${esc(S.boxName(host))} の中の紙・${p.main.length} 手順</span></span></a>`;
      } else {
        const st0 = r.alts[0].st;
        h += `<a class="bd-row alt" href="#${S.sid(d.id, r.alts[0].i)}" data-go="${S.sid(d.id, r.alts[0].i)}" style="${style}"><span class="bd-alt">もし${esc(st0.alt.when)}なら</span><span class="bd-t">${r.alts.map((x) => `<span class="an">${esc(S.stepNo(d, x.i).replace('もし', ''))}</span>${S.inline(S.heading(d, x.st))}`).join('<span class="sep">・</span>')}</span></a>`;
      }
    }

    // ---- Who runs the steps: consecutive rows whose working box sits in the same dashed frame ----
    if (whoW) {
      const groups = [];
      for (const r of steps) {
        const reg = S.regionOf(d, S.actorOf(d, r.st));
        const g = groups[groups.length - 1];
        if (g && g.reg === reg) g.end = r; else groups.push({ reg, start: r, end: r });
      }
      for (const g of groups) {
        if (!g.reg) continue;
        const y0 = g.start.y + 5, y1 = g.end.y + g.end.h - 5, hh = y1 - y0;
        const label = hh < 40 && g.reg.label3 ? g.reg.label3 : g.reg.label;
        const lines = Math.max(1, Math.floor((hh + 4) / 17.5));
        h += `<div class="bd-who" data-region="${esc(g.reg.node)}" style="left:${W - pad.r - whoW}px;top:${y0}px;width:${whoW}px;height:${hh}px"><span style="-webkit-line-clamp:${lines}" title="${esc(g.reg.label)}">${esc(label)}</span></div>`;
      }
    }
    return { html: `<div class="bd m-${mode}${two ? '' : ' one'}" style="transform:translateY(${oy}px)"><svg class="bd-track" width="${W}" height="${bottom + 10}" aria-hidden="true">${svg}</svg>${h}</div>`, rows };
  }

  S.Board = {
    init() {
      root = document.getElementById('g-board');
      // Hovering a row lights its piece of the line.
      root.addEventListener('pointerover', (e) => {
        const row = e.target.closest('.bd-row.step');
        root.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
        if (row) { row.classList.add('hl'); const seg = root.querySelector(`.bd-seg[data-k="${row.dataset.k}"]`); if (seg) seg.classList.add('hl'); }
      });
      root.addEventListener('pointerleave', () => root.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')));
    },
    show(sc) {
      const d = S.D[sc.diag];
      const W = root.clientWidth, H = root.clientHeight;
      if (!W || !H) return;
      const key = `${d.id}:${W}x${H}`;
      const fresh = !cur || cur.key !== key;
      if (fresh) {
        const r = render(d, W, H);
        root.innerHTML = r.html;
        cur = { key, d };
        root.dataset.flow = S.FLOWS.indexOf(d.g);
      }
      const drawIn = fresh || cur.kind !== sc.kind && sc.kind === 'chapter';
      cur.kind = sc.kind;
      root.dataset.kind = sc.kind;
      if (drawIn && !S.reduceMotion) { root.classList.remove('draw'); void root.offsetWidth; root.classList.add('draw'); }
      // Contexts: the rows run inside the frame stand out.
      for (const el of root.querySelectorAll('.bd-row.step, .bd-who')) {
        const inReg = sc.kind === 'region' && el.dataset.region === sc.region;
        el.classList.toggle('in', inReg);
        el.classList.toggle('out', sc.kind === 'region' && !inReg);
      }
      for (const el of root.querySelectorAll('.bd-row.paper, .bd-row.alt')) el.classList.toggle('out', sc.kind === 'region');
      for (const seg of root.querySelectorAll('.bd-seg')) {
        const row = root.querySelector(`.bd-row.step[data-k="${seg.dataset.k || seg.dataset.thru}"]`);
        seg.classList.toggle('out', !!row && row.classList.contains('out'));
      }
      root.classList.toggle('done', sc.kind === 'recap');
    },
    resize() { cur = null; },
  };
})();
