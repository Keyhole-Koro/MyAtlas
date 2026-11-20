// term.js: draws a terminal frame exported by atlas_tui.py on a <canvas>.
// A frame is {w, h, styles: [[fg role, bg role, attr]], rows: [[x, style, text, wide?]]}; roles are
// turned into colours by a palette ({role: "#rrggbb"}). Box-drawing characters, blocks and arrowheads
// are drawn as shapes so that lines join exactly; other characters are drawn one by one, centred in
// their cell (wide characters in two cells), so alignment never depends on the font.
(function (global) {
  'use strict';

  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", "DejaVu Sans Mono", ' +
    '"Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", "Noto Sans Mono CJK JP", monospace';

  // [up, right, down, left]: 0 none, 1 light, 2 heavy, 3 double
  const LINES = {
    '━': [0, 2, 0, 2], '┃': [2, 0, 2, 0], '┏': [0, 2, 2, 0], '┓': [0, 0, 2, 2], '┗': [2, 2, 0, 0],
    '┛': [2, 0, 0, 2], '┝': [1, 2, 1, 0], '┥': [1, 0, 1, 2], '┰': [0, 1, 2, 1], '┸': [2, 1, 0, 1],
    '┣': [2, 2, 2, 0], '┫': [2, 0, 2, 2], '┳': [0, 2, 2, 2], '┻': [2, 2, 0, 2], '┠': [2, 1, 2, 0],
    '┨': [2, 0, 2, 1], '┯': [0, 2, 1, 2], '┷': [1, 2, 0, 2], '╋': [2, 2, 2, 2],
    '─': [0, 1, 0, 1], '│': [1, 0, 1, 0], '┌': [0, 1, 1, 0], '┐': [0, 0, 1, 1], '└': [1, 1, 0, 0],
    '┘': [1, 0, 0, 1], '├': [1, 1, 1, 0], '┤': [1, 0, 1, 1], '┬': [0, 1, 1, 1], '┴': [1, 1, 0, 1],
    '┼': [1, 1, 1, 1], '═': [0, 3, 0, 3], '║': [3, 0, 3, 0], '╔': [0, 3, 3, 0], '╗': [0, 0, 3, 3],
    '╚': [3, 3, 0, 0], '╝': [3, 0, 0, 3], '╞': [1, 3, 1, 0], '╡': [1, 0, 1, 3], '╥': [0, 1, 3, 1],
    '╨': [3, 1, 0, 1], '╟': [3, 1, 3, 0], '╢': [3, 0, 3, 1], '╤': [0, 3, 1, 3], '╧': [1, 3, 0, 3],
  };
  // Dashed lines, each with a rhythm of its own so the kinds of step tell apart at a glance:
  // ┄ ┆ (列を通す) two short dashes a cell, ┈ ┊ (通知) one round dot a cell, ╌ ╎ (戻り) one long dash a cell.
  const DASH = { '┄': ['h', 2, 1, 'dash'], '┈': ['h', 1, 1, 'dot'], '╌': ['h', 1, 1, 'dash'],
    '┆': ['v', 2, 1, 'dash'], '┊': ['v', 1, 1, 'dot'], '╎': ['v', 1, 1, 'dash'],
    '┅': ['h', 2, 2, 'dash'], '┉': ['h', 1, 2, 'dot'], '╍': ['h', 1, 2, 'dash'],
    '┇': ['v', 2, 2, 'dash'], '┋': ['v', 1, 2, 'dot'], '╏': ['v', 1, 2, 'dash'] };
  const ARC = { '╭': [1, 1], '╮': [-1, 1], '╰': [1, -1], '╯': [-1, -1] };
  const HEADS = { '▶': 'r', '◀': 'l', '▲': 'u', '▼': 'd', '▷': 'r', '◁': 'l', '△': 'u', '▽': 'd' };
  const HOLLOW = new Set(['▷', '◁', '△', '▽']);

  function isWideOK(ch) { return ch.length > 0; }

  function measure(fontPx) {
    const c = document.createElement('canvas').getContext('2d');
    c.font = fontPx + 'px ' + FONT;
    return c.measureText('MMMMMMMMMM').width / 10;
  }

  // Cell size for a frame that should be at most maxW × maxH CSS pixels.
  function fit(cols, rows, maxW, maxH, ratio) {
    ratio = ratio || 2.12;
    let cw = maxW / cols;
    if (maxH && cw * ratio * rows > maxH) cw = maxH / (ratio * rows);
    return { cw: cw, rh: cw * ratio };
  }

  function draw(canvas, frame, palette, size) {
    const dpr = global.devicePixelRatio || 1;
    const cols = frame.w, rows = frame.h;
    const cwD = size.cw * dpr, rhD = size.rh * dpr;
    const X = (i) => Math.round(i * cwD), Y = (j) => Math.round(j * rhD);
    canvas.width = X(cols);
    canvas.height = Y(rows);
    canvas.style.width = (X(cols) / dpr) + 'px';
    canvas.style.height = (Y(rows) / dpr) + 'px';
    const ctx = canvas.getContext('2d');
    const col = (role) => palette[role] || palette.text || '#ccc';
    const styles = frame.styles;
    const fontD = Math.min(cwD / 0.6, rhD * 0.72);
    const fontW = Math.min(cwD * 2 * 0.94, rhD * 0.84);
    const lw = Math.max(1, Math.round(cwD * 0.11));
    const dd = Math.max(lw + 1, Math.round(cwD * 0.2));
    ctx.fillStyle = col('bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // backgrounds
    for (let j = 0; j < rows; j++) {
      for (const run of frame.rows[j]) {
        const [x, s, text, wide] = run;
        const n = wide ? text.length * 2 : [...text].length;
        const bg = styles[s][1];
        if (bg === 'bg') continue;
        ctx.fillStyle = col(bg);
        ctx.fillRect(X(x), Y(j), X(x + n) - X(x), Y(j + 1) - Y(j));
      }
    }
    // the characters by cell: an arrowhead reaches into the next cell (to touch a box's border) only when that
    // cell holds a line or nothing, never over a letter
    const grid = [];
    for (let j = 0; j < rows; j++) {
      const row = new Array(cols).fill(' ');
      for (const [x, , text, wide] of frame.rows[j]) {
        let i = x;
        for (const ch of text) { row[i] = ch; if (wide) { row[i + 1] = ''; i += 2; } else i += 1; }
      }
      grid.push(row);
    }
    const reach = (i, j) => {
      const c = (j >= 0 && j < rows && i >= 0 && i < cols) ? grid[j][i] : ' ';
      return c === ' ' || !!LINES[c] || !!DASH[c] || !!ARC[c];
    };
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let curFont = '';
    for (let j = 0; j < rows; j++) {
      const y0 = Y(j), y1 = Y(j + 1);
      for (const run of frame.rows[j]) {
        const [x, s, text, wide] = run;
        const [fg, , attr] = styles[s];
        const color = col(fg);
        const font = ((attr & 1) ? '700 ' : '400 ') + (wide ? fontW : fontD).toFixed(2) + 'px ' + FONT;
        let i = x;
        for (const ch of text) {
          const x0 = X(i), x1 = X(i + (wide ? 2 : 1));
          if (ch !== ' ') {
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            const into = HEADS[ch] ? { r: reach(i + 1, j), l: reach(i - 1, j), u: reach(i, j - 1), d: reach(i, j + 1) }[HEADS[ch]] : true;
            if (!shape(ctx, ch, x0, y0, x1, y1, lw, dd, (attr & 1) ? 1.5 : 1, into)) {
              if (font !== curFont) { ctx.font = font; curFont = font; }
              ctx.fillText(ch, (x0 + x1) / 2, (y0 + y1) / 2 + rhD * 0.04);
            }
          }
          if (attr & 2) {
            ctx.fillStyle = color;
            ctx.fillRect(x0, y1 - Math.max(1, Math.round(rhD * 0.08)), x1 - x0, Math.max(1, Math.round(dpr)));
          }
          i += wide ? 2 : 1;
        }
      }
    }
  }

  function shape(ctx, ch, x0, y0, x1, y1, lw, dd, boldK, into) {
    const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
    const w = Math.max(1, Math.round(lw * boldK));
    const h2 = Math.floor(w / 2);
    const spec = LINES[ch];
    if (spec) {
      const [u, r, d, l] = spec;
      const dbl = u === 3 || r === 3 || d === 3 || l === 3;
      if (!dbl) {
        const W = (k) => k === 2 ? Math.max(2, Math.round(lw * 2.4)) : w;
        const arm = (k, f) => { if (!k) return; const ww = W(k), hh = Math.floor(ww / 2); f(ww, hh); };
        const mx = Math.max(u ? W(u) : 0, d ? W(d) : 0), my = Math.max(l ? W(l) : 0, r ? W(r) : 0);
        arm(r, (ww, hh) => ctx.fillRect(cx - Math.floor(mx / 2), cy - hh, x1 - (cx - Math.floor(mx / 2)), ww));
        arm(l, (ww, hh) => ctx.fillRect(x0, cy - hh, cx - Math.floor(mx / 2) + mx - x0, ww));
        arm(u, (ww, hh) => ctx.fillRect(cx - hh, y0, ww, cy - Math.floor(my / 2) + my - y0));
        arm(d, (ww, hh) => ctx.fillRect(cx - hh, cy - Math.floor(my / 2), ww, y1 - (cy - Math.floor(my / 2))));
        return true;
      }
      const xa = cx - dd - h2, xb = cx + dd - h2, ya = cy - dd - h2, yb = cy + dd - h2;
      const hz = r === 3 || l === 3, vt = u === 3 || d === 3;
      if (hz && vt) {
        // double corners
        if (r && d) { ctx.fillRect(xa, ya, x1 - xa, w); ctx.fillRect(xa, ya, w, y1 - ya); ctx.fillRect(xb, yb, x1 - xb, w); ctx.fillRect(xb, yb, w, y1 - yb); }
        if (l && d) { ctx.fillRect(x0, ya, xb + w - x0, w); ctx.fillRect(xb, ya, w, y1 - ya); ctx.fillRect(x0, yb, xa + w - x0, w); ctx.fillRect(xa, yb, w, y1 - yb); }
        if (r && u) { ctx.fillRect(xa, y0, w, yb + w - y0); ctx.fillRect(xa, yb, x1 - xa, w); ctx.fillRect(xb, y0, w, ya + w - y0); ctx.fillRect(xb, ya, x1 - xb, w); }
        if (l && u) { ctx.fillRect(xb, y0, w, yb + w - y0); ctx.fillRect(x0, yb, xb + w - x0, w); ctx.fillRect(xa, y0, w, ya + w - y0); ctx.fillRect(x0, ya, xa + w - x0, w); }
        return true;
      }
      // straight double, or double arm on a light line
      if (hz) {
        const from = l === 3 ? x0 : cx - h2, to = r === 3 ? x1 : cx + h2 + w;
        ctx.fillRect(from, ya, to - from, w);
        ctx.fillRect(from, yb, to - from, w);
        if (u === 1 || d === 1) {
          ctx.fillRect(cx - h2, u ? y0 : cy - h2, w, (d ? y1 : cy + h2 + w) - (u ? y0 : cy - h2));
        }
      } else {
        const from = u === 3 ? y0 : cy - h2, to = d === 3 ? y1 : cy + h2 + w;
        ctx.fillRect(xa, from, w, to - from);
        ctx.fillRect(xb, from, w, to - from);
        if (l === 1 || r === 1) {
          ctx.fillRect(l ? x0 : cx - h2, cy - h2, (r ? x1 : cx + h2 + w) - (l ? x0 : cx - h2), w);
        }
      }
      return true;
    }
    const dash = DASH[ch];
    if (dash) {
      const [dir, n, wt, kind] = dash;
      const wd = wt === 2 ? Math.max(2, Math.round(lw * 2.4)) : w, hd = Math.floor(wd / 2);
      const len = dir === 'h' ? x1 - x0 : y1 - y0;
      // vertical cells are about twice as tall: twice the pieces, so the rhythm matches across
      const pieces = dir === 'v' ? n * 2 : n;
      const seg = len / pieces;
      for (let k = 0; k < pieces; k++) {
        const mid = (dir === 'h' ? x0 : y0) + (k + 0.5) * seg;
        if (kind === 'dot') {
          const r = Math.max(1.1, wd * (wt === 2 ? 0.8 : 1.05));
          ctx.beginPath();
          if (dir === 'h') ctx.arc(mid, cy - hd + wd / 2, r, 0, Math.PI * 2);
          else ctx.arc(cx - hd + wd / 2, mid, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const half = seg * (n === 1 ? 0.34 : 0.3);
          const a = Math.round(mid - half), b = Math.round(mid + half);
          if (dir === 'h') ctx.fillRect(a, cy - hd, Math.max(1, b - a), wd);
          else ctx.fillRect(cx - hd, a, wd, Math.max(1, b - a));
        }
      }
      return true;
    }
    const arc = ARC[ch];
    if (arc) {
      const [sx, sy] = arc; // sx: arm to the right (1) or left (-1); sy: arm down (1) or up (-1)
      const rad = Math.min(x1 - x0, y1 - y0) / 2;
      const lx = cx - h2 + w / 2, ly = cy - h2 + w / 2;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(sx > 0 ? x1 : x0, ly);
      ctx.lineTo(lx + sx * rad, ly);
      ctx.arcTo(lx, ly, lx, ly + sy * rad, rad);
      ctx.lineTo(lx, sy > 0 ? y1 : y0);
      ctx.stroke();
      return true;
    }
    if (ch === '◆') {
      // where a notification (通知) leaves its box
      const hw = (x1 - x0) * 0.44, hh = hw * 1.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy);
      ctx.closePath();
      ctx.fill();
      return true;
    }
    if (ch === '▌') { ctx.fillRect(x0, y0, Math.round((x1 - x0) * 0.5), y1 - y0); return true; }
    if (ch === '▐') { const m = Math.round((x0 + x1) / 2); ctx.fillRect(m, y0, x1 - m, y1 - y0); return true; }
    if (ch === '█') { ctx.fillRect(x0, y0, x1 - x0, y1 - y0); return true; }
    if (ch === '▀') { ctx.fillRect(x0, y0, x1 - x0, Math.round((y1 - y0) / 2)); return true; }
    if (ch === '▄') { const m = Math.round((y0 + y1) / 2); ctx.fillRect(x0, m, x1 - x0, y1 - m); return true; }
    if (ch === '▏') { ctx.fillRect(x0, y0, w, y1 - y0); return true; }
    const head = HEADS[ch];
    if (head) {
      const cw = x1 - x0, rh = y1 - y0;
      const k = into === false ? 0 : 1;    // how far the tip reaches into the next cell
      ctx.beginPath();
      if (head === 'r') { const tip = x1 + cw * 0.45 * k; ctx.moveTo(x0 + cw * 0.1, cy - rh * 0.24); ctx.lineTo(tip, cy); ctx.lineTo(x0 + cw * 0.1, cy + rh * 0.24); }
      if (head === 'l') { const tip = x0 - cw * 0.45 * k; ctx.moveTo(x1 - cw * 0.1, cy - rh * 0.24); ctx.lineTo(tip, cy); ctx.lineTo(x1 - cw * 0.1, cy + rh * 0.24); }
      if (head === 'd') { const tip = k ? y1 + rh * 0.42 : y1 - rh * 0.1; ctx.moveTo(cx - cw * 0.48, y0 + rh * 0.22); ctx.lineTo(cx, tip); ctx.lineTo(cx + cw * 0.48, y0 + rh * 0.22); }
      if (head === 'u') { const tip = k ? y0 - rh * 0.42 : y0 + rh * 0.1; ctx.moveTo(cx - cw * 0.48, y1 - rh * 0.22); ctx.lineTo(cx, tip); ctx.lineTo(cx + cw * 0.48, y1 - rh * 0.22); }
      ctx.closePath();
      if (HOLLOW.has(ch)) { ctx.lineWidth = w; ctx.stroke(); }
      else ctx.fill();
      // the stem up to the head
      if (head === 'r') ctx.fillRect(x0, cy - h2, Math.round(cw * 0.2), w);
      if (head === 'l') ctx.fillRect(x1 - Math.round(cw * 0.2), cy - h2, Math.round(cw * 0.2), w);
      if (head === 'd') ctx.fillRect(cx - h2, y0, w, Math.round(rh * 0.25));
      if (head === 'u') ctx.fillRect(cx - h2, y1 - Math.round(rh * 0.25), w, Math.round(rh * 0.25));
      return true;
    }
    return false;
  }

  // The frame as plain text (for copying and for screen readers).
  function text(frame) {
    const out = [];
    for (let j = 0; j < frame.h; j++) {
      let line = '', x = 0;
      for (const [rx, , t, wide] of frame.rows[j]) {
        while (x < rx) { line += ' '; x++; }
        line += t;
        x += wide ? t.length * 2 : [...t].length;
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out.join('\n');
  }

  global.Term = { draw, fit, measure, text, FONT };
})(window);
