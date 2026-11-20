/* diagrams.js — small pictures inside a note: the paper inside a node (bands as columns, steps top to bottom),
   data-structure shapes, the bits of a register, a run's hits on a time line, the layer lanes of a flow. */
(function () {
  'use strict';
  const M = window.M;
  const { NODES, LAYER } = M;
  const measure = document.createElement('canvas').getContext('2d');
  const SANS = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace';
  const tw = (s, font) => { measure.font = font; return measure.measureText(String(s)).width; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f1 = (x) => (Math.round(x * 10) / 10).toString();
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const fit = (s, font, w) => {
    s = String(s);
    if (tw(s, font) <= w) return s;
    let t = [...s];
    while (t.length > 1 && tw(t.join('') + '…', font) > w) t.pop();
    return t.join('') + '…';
  };

  // ---- the paper inside a node: one column per band, the band with most boxes in the middle of the story ----
  function paperSvg(p, opts = {}) {
    const W = opts.width || 680;
    const hl = opts.highlight || null; // node id to mark
    const cur = opts.current == null ? null : opts.current; // step index to mark
    const lit = new Set(opts.steps || []); // steps to light: where a shape travels
    const bands = p.bands;
    const nb = bands.length;
    const colOf = Object.fromEntries(bands.map((b, i) => [b.id, i]));
    const box = Object.fromEntries(p.boxes.map((b) => [b.id, b]));
    const bandOf = (id) => colOf[box[id].layer];
    const steps = p.steps.map((st, i) => ({ st, i }));
    const order = [...steps.filter((x) => !x.st.alt), ...steps.filter((x) => x.st.alt)];
    const first = new Map();
    order.forEach(({ st }, k) => { for (const id of [st.from, st.to]) if (!first.has(id)) first.set(id, k); });
    const per = bands.map((b) => p.boxes.filter((x) => x.layer === b.id));
    let main = 0;
    per.forEach((arr, i) => { if (arr.length > per[main].length || (arr.length === per[main].length && bands[i].id === 'body' && bands[main].id !== 'body')) main = i; });
    const row = new Map();
    [...per[main]].sort((a, b) => (first.has(a.id) ? first.get(a.id) : 99) - (first.has(b.id) ? first.get(b.id) : 99)).forEach((b, r) => row.set(b.id, r));
    const partners = (id) => p.steps.flatMap((st) => (st.from === id ? [st.to] : st.to === id ? [st.from] : []));
    const placeBand = (bi, reserved) => {
      const list = per[bi].map((b) => {
        const ps = partners(b.id).filter((x) => row.has(x) && bandOf(x) !== bi);
        return { b, want: ps.length ? mean(ps.map((x) => row.get(x))) : (first.has(b.id) ? first.get(b.id) : 0) * 0.5 };
      }).sort((a, b) => a.want - b.want || (first.get(a.b.id) || 0) - (first.get(b.b.id) || 0));
      let prev = -Infinity;
      const placed = list.map((x) => (prev = Math.max(x.want, prev + 1)));
      const shift = Math.max(mean(list.map((x, k) => x.want - placed[k])), -Math.min(...placed));
      let last = -Infinity;
      list.forEach((x, k) => {
        let r = Math.max(placed[k] + shift, last + 1);
        for (let guard = 0; guard < 6; guard++) {
          const hit = reserved.find(([lo, hi]) => r > lo - 0.68 && r < hi + 0.68);
          if (!hit) break;
          r = hit[1] + 0.68;
        }
        row.set(x.b.id, r);
        last = r;
      });
    };
    const others = bands.map((_, i) => i).filter((i) => i !== main).sort((a, b) => Math.abs(a - main) - Math.abs(b - main));
    for (let pass = 0; pass < 2; pass++) for (const bi of others) placeBand(bi, []);
    // a step that jumps over a column keeps that column clear at its height
    const reservedFor = (bi) => p.steps.filter((st) => {
      const a = bandOf(st.from), b = bandOf(st.to);
      return Math.min(a, b) < bi && Math.max(a, b) > bi;
    }).map((st) => [Math.min(row.get(st.from), row.get(st.to)), Math.max(row.get(st.from), row.get(st.to))]);
    for (const bi of others) { const res = reservedFor(bi); if (res.length) placeBand(bi, res); }

    const padX = 4, gapX = nb > 2 ? 50 : 96;
    const colW = Math.min(236, (W - 2 * padX - (nb - 1) * gapX) / nb);
    const total = nb * colW + (nb - 1) * gapX;
    const left = (W - total) / 2;
    const headH = 50, boxH = 50, pitch = 86, topPad = 14;
    const maxRow = Math.max(0, ...[...row.values()]);
    const H = headH + topPad + maxRow * pitch + boxH + 22;
    const cx = (bi) => left + bi * (colW + gapX);
    const ry = (r) => headH + topPad + r * pitch;
    const geo = {};
    for (const b of p.boxes) geo[b.id] = { x: cx(bandOf(b.id)), y: ry(row.get(b.id)), w: colW, h: boxH };

    let s = `<svg class="paper-svg" viewBox="0 0 ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" role="img" aria-label="${esc(M.pTitle(p))}の図">`;
    s += `<defs><marker id="pa-${esc(p.id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1L9,5L0,9z" class="p-arrowhead"/></marker>`
      + `<marker id="pa-${esc(p.id)}-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1L9,5L0,9z" class="p-arrowhead hi"/></marker></defs>`;
    bands.forEach((b, bi) => {
      const x = cx(bi) - 10, w = colW + 20;
      s += `<g class="p-band" data-layer="${esc(b.tone || '')}"><rect x="${f1(x)}" y="2" width="${f1(w)}" height="${f1(H - 4)}" rx="12"/>`
        + `<text class="p-band-name" x="${f1(x + 12)}" y="22">${esc(fit(b.name, `650 13px ${SANS}`, w - 24))}</text>`
        + `<text class="p-band-sub" x="${f1(x + 12)}" y="39">${esc(fit(b.sub || '', `400 12px ${SANS}`, w - 24))}</text></g>`;
    });
    // arrows first, boxes over them
    const badgeAt = [];
    let arrows = '', badges = '';
    for (const { st, i } of steps) {
      const a = geo[st.from], b = geo[st.to];
      const ca = bandOf(st.from), cb = bandOf(st.to);
      let d, mx, my;
      if (ca === cb) {
        const down = b.y > a.y;
        const between = p.boxes.some((o) => o.id !== st.from && o.id !== st.to && bandOf(o.id) === ca && geo[o.id].y > Math.min(a.y, b.y) && geo[o.id].y < Math.max(a.y, b.y));
        if (!between) {
          const x = a.x + a.w / 2;
          const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h;
          d = `M${f1(x)},${f1(y1)}L${f1(x)},${f1(y2 + (down ? -2 : 2))}`;
          mx = x; my = (y1 + y2) / 2;
        } else {
          const x1 = a.x + a.w, x2 = b.x + b.w, bulge = x1 + 30;
          const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
          d = `M${f1(x1)},${f1(y1)}C${f1(bulge)},${f1(y1)} ${f1(bulge)},${f1(y2)} ${f1(x2 + 2)},${f1(y2)}`;
          mx = x1 + 22; my = (y1 + y2) / 2;
        }
      } else {
        const right = cb > ca;
        const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x : b.x + b.w;
        const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
        const k = (x2 - x1) * 0.5;
        d = `M${f1(x1)},${f1(y1)}C${f1(x1 + k)},${f1(y1)} ${f1(x2 - k)},${f1(y2)} ${f1(x2 + (right ? -2 : 2))},${f1(y2)}`;
        // the badge sits in the first gap the arrow crosses
        const gx = right ? x1 + gapX / 2 : x1 - gapX / 2;
        const t = Math.abs(x2 - x1) > 1 ? (gx - x1) / (x2 - x1) : 0.5;
        const bez = (p0, p1, p2, p3, u) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
        // solve x(u) = gx by bisection (x is monotone along the curve)
        let lo = 0, hi = 1;
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; const xm = bez(x1, x1 + k, x2 - k, x2, m); if ((xm - gx) * (right ? 1 : -1) < 0) lo = m; else hi = m; }
        const u = (lo + hi) / 2 || t;
        mx = bez(x1, x1 + k, x2 - k, x2, u); my = bez(y1, y1, y2, y2, u);
      }
      // keep badges apart
      for (let g = 0; g < 4; g++) { const clash = badgeAt.find((q) => Math.hypot(q[0] - mx, q[1] - my) < 22); if (!clash) break; my += my >= clash[1] ? 13 : -13; }
      badgeAt.push([mx, my]);
      const on = cur === i || lit.has(i);
      const no = M.stepNo(st, i);
      const label = M.plain(st.label || '');
      arrows += `<path class="p-arrow k-${st.kind}${st.alt ? ' alt' : ''}${on ? ' hi' : ''}" d="${d}" marker-end="url(#pa-${esc(p.id)}${on ? '-hi' : ''})"/>`;
      const bw = st.alt ? tw(no, `700 11.5px ${SANS}`) + 14 : 21;
      badges += `<g class="p-badge${st.alt ? ' alt' : ''}${on ? ' hi' : ''}" data-step="${esc(p.id)}:${i}" tabindex="0" role="button" aria-label="${esc(no)}：${esc(label)}">`
        + `<title>${esc(no)}. ${esc(st.verb ? st.verb + ' — ' : '')}${esc(label)}</title>`
        + `<rect x="${f1(mx - bw / 2)}" y="${f1(my - 10.5)}" width="${f1(bw)}" height="21" rx="10.5"/>`
        + `<text x="${f1(mx)}" y="${f1(my + 4.2)}" text-anchor="middle">${esc(no)}</text></g>`;
    }
    s += `<g class="p-arrows">${arrows}</g>`;
    for (const b of p.boxes) {
      const g = geo[b.id], n = NODES[b.node];
      const code = M.isCodeish(b.title);
      const tf = code ? `600 12px ${MONO}` : `700 13px ${SANS}`;
      const isHl = hl && b.node === hl;
      s += `<g class="p-box${isHl ? ' hl' : ''}" data-node="${esc(b.node)}" data-layer="${esc(n ? n.layer : '')}" tabindex="0" role="link" aria-label="${esc(b.title)}">`
        + `<rect class="p-box-bg" x="${f1(g.x)}" y="${f1(g.y)}" width="${f1(g.w)}" height="${f1(g.h)}" rx="8"/>`
        + `<rect class="p-box-bar" x="${f1(g.x)}" y="${f1(g.y + 7)}" width="3.5" height="${f1(g.h - 14)}" rx="1.75"/>`
        + `<text class="p-box-title${code ? ' mono' : ''}" x="${f1(g.x + 13)}" y="${f1(g.y + 21)}">${esc(fit(b.title, tf, g.w - 22))}</text>`;
      if (b.slots && b.slots.length) {
        let x = g.x + 13;
        const sf = `400 11.5px ${SANS}`;
        for (const sl of b.slots) {
          const w = tw(sl, sf) + 12;
          if (x + w > g.x + g.w - 8) { s += `<text class="p-box-sub" x="${f1(x)}" y="${f1(g.y + 39)}">…</text>`; break; }
          s += `<rect class="p-slot" x="${f1(x)}" y="${f1(g.y + 28)}" width="${f1(w)}" height="16" rx="3"/><text class="p-slot-t" x="${f1(x + w / 2)}" y="${f1(g.y + 40)}" text-anchor="middle">${esc(sl)}</text>`;
          x += w + 4;
        }
      } else if (b.bits && b.bits.length) {
        const tot = b.bits.reduce((a, x) => a + x[1], 0), bw = g.w - 26;
        let x = g.x + 13;
        for (const [name, nbits] of b.bits) {
          const w = (bw * nbits) / tot;
          s += `<rect class="p-slot" x="${f1(x)}" y="${f1(g.y + 28)}" width="${f1(w - 2)}" height="16" rx="3"/><text class="p-slot-t" x="${f1(x + w / 2 - 1)}" y="${f1(g.y + 40)}" text-anchor="middle">${esc(tw(`${name} ${nbits}`, `400 11.5px ${SANS}`) <= w - 8 ? `${name} ${nbits}` : fit(name, `400 11.5px ${SANS}`, w - 8))}</text>`;
          x += w;
        }
      } else if (b.sub) {
        s += `<text class="p-box-sub" x="${f1(g.x + 13)}" y="${f1(g.y + 39)}">${esc(fit(b.sub, `400 12px ${SANS}`, g.w - 22))}</text>`;
      }
      if (isHl) s += `<text class="p-here" x="${f1(g.x + g.w - 8)}" y="${f1(g.y - 6)}" text-anchor="end">この節</text>`;
      s += `</g>`;
    }
    s += `<g class="p-badges">${badges}</g>`;
    return s + `</svg>`;
  }

  // ---- data-structure shapes ----
  const role = (sh, k) => (sh.roles && sh.roles[k]) || null;
  const rname = (sh, k) => { const r = role(sh, k); return r ? r.name || r.text || '' : ''; };
  function shapeSvg(sh, n) {
    if (!sh || !sh.kind) return '';
    const W = 560;
    if (sh.kind === 'ring') {
      const N = (role(sh, 'n') || {}).num || 16, cx = 96, cy = 92, R = 70, r = 48;
      const head = 2, tail = 8; // a few slots in use, drawn only to show which way it turns
      let s = `<svg class="shape-svg" viewBox="0 0 ${W} 190" role="img" aria-label="リング：${N} 枠">`;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2 - Math.PI / 2, a1 = ((k + 1) / N) * Math.PI * 2 - Math.PI / 2 - 0.035;
        const p = (rad, a) => `${f1(cx + rad * Math.cos(a))},${f1(cy + rad * Math.sin(a))}`;
        const used = k >= head && k < tail;
        s += `<path class="sh-cell${used ? ' on' : ''}" d="M${p(R, a0)}A${R},${R} 0 0,1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 0,0 ${p(r, a0)}Z"/>`;
      }
      const ang = (k) => (k / N) * Math.PI * 2 - Math.PI / 2;
      const mark = (k, label, cls) => {
        const a = ang(k), x1 = cx + (R + 4) * Math.cos(a), y1 = cy + (R + 4) * Math.sin(a), x2 = cx + (R + 20) * Math.cos(a), y2 = cy + (R + 20) * Math.sin(a);
        return `<line class="sh-ptr ${cls}" x1="${f1(x2)}" y1="${f1(y2)}" x2="${f1(x1)}" y2="${f1(y1)}"/><text class="sh-lab mono ${cls}" x="${f1(x2 + 4)}" y="${f1(y2 + 4)}">${esc(label)}</text>`;
      };
      s += mark(head + 0.5, rname(sh, 'read') || 'read', 'rd') + mark(tail - 0.5, rname(sh, 'write') || 'write', 'wr');
      s += `<text class="sh-big" x="${cx}" y="${cy + 6}" text-anchor="middle">${N}</text>`;
      const lines = [];
      if (role(sh, 'n')) lines.push([`${rname(sh, 'n')} = ${N}`, '枠の数']);
      if (role(sh, 'read')) lines.push([rname(sh, 'read'), fieldNote(n, rname(sh, 'read')) || '読む位置']);
      if (role(sh, 'write')) lines.push([rname(sh, 'write'), fieldNote(n, rname(sh, 'write')) || '書く位置']);
      if (role(sh, 'item')) lines.push([`${rname(sh, 'item')} = ${role(sh, 'item').num} ${role(sh, 'item').unit || ''}`, '1 枠の大きさ']);
      s += legendLines(lines, 230, 44);
      return s + `</svg>`;
    }
    if (sh.kind === 'table') {
      const N = (role(sh, 'n') || {}).num || 16, key = rname(sh, 'key'), empty = rname(sh, 'empty');
      const shown = [0, 1, 2, 3, null, N - 1];
      let s = `<svg class="shape-svg" viewBox="0 0 ${W} 196" role="img" aria-label="表：${N} 枠">`;
      const x0 = 24, y0 = 18, rw = 170, rh = 25;
      shown.forEach((k, j) => {
        const y = y0 + j * (rh + 3);
        if (k == null) { s += `<text class="sh-lab" x="${x0 + 46 + rw / 2}" y="${y + 17}" text-anchor="middle">⋮</text>`; return; }
        s += `<text class="sh-lab mono" x="${x0 + 34}" y="${y + 17}" text-anchor="end">${k}</text><rect class="sh-cell${k < 3 ? ' on' : ''}" x="${x0 + 46}" y="${y}" width="${rw}" height="${rh}" rx="4"/>`;
      });
      const lines = [[`${rname(sh, 'n')} = ${N}`, '枠の数']];
      if (key) lines.push([key, '鍵（何番目の枠か）']);
      if (empty) lines.push([empty, '空いている枠']);
      s += legendLines(lines, 290, 40);
      return s + `</svg>`;
    }
    if (sh.kind === 'list') {
      const head = rname(sh, 'head'), next = rname(sh, 'next'), hdr = role(sh, 'header'), bump = rname(sh, 'bump'), order = role(sh, 'order');
      let s = `<svg class="shape-svg" viewBox="0 0 ${W} 150" role="img" aria-label="リスト">`;
      const hw = tw(head, `500 12.5px ${MONO}`) + 18;
      s += `<rect class="sh-cell on" x="16" y="34" width="${f1(hw)}" height="30" rx="6"/><text class="sh-lab mono" x="${f1(16 + hw / 2)}" y="54" text-anchor="middle">${esc(head)}</text>`;
      let x = 16 + hw;
      for (let k = 0; k < 3; k++) {
        s += `<line class="sh-ptr" x1="${f1(x + 2)}" y1="49" x2="${f1(x + 26)}" y2="49"/><path class="sh-tip" d="M${f1(x + 30)},49l-7,-4v8z"/>`;
        x += 32;
        const bw = 92;
        if (hdr) s += `<rect class="sh-cell on" x="${f1(x)}" y="34" width="26" height="30" rx="4"/><rect class="sh-cell" x="${f1(x + 26)}" y="34" width="${bw - 26}" height="30" rx="4"/>`;
        else s += `<rect class="sh-cell" x="${f1(x)}" y="34" width="${bw}" height="30" rx="4"/><rect class="sh-cell on" x="${f1(x)}" y="34" width="22" height="30" rx="4"/>`;
        x += bw;
      }
      s += `<line class="sh-ptr" x1="${f1(x + 2)}" y1="49" x2="${f1(x + 22)}" y2="49"/><text class="sh-lab" x="${f1(x + 28)}" y="54">∅</text>`;
      const lines = [];
      if (next) lines.push([next, '次の空きを指す']);
      if (hdr) lines.push([`${hdr.name} = ${hdr.num} B`, 'ブロックの頭']);
      if (order) lines.push([`${order.text}順`, '並ぶ順']);
      if (bump) lines.push([bump, 'リストが空の時に渡す次の枠']);
      lines.forEach(([a, b], j) => { s += `<text class="sh-lab" x="${16 + (j % 2) * 270}" y="${96 + Math.floor(j / 2) * 24}"><tspan class="mono strong">${esc(a)}</tspan><tspan dx="8">${esc(b)}</tspan></text>`; });
      return s + `</svg>`;
    }
    if (sh.kind === 'tree') {
      const T = [{ n: 1, x: 120, y: 30, p: null }, { n: 2, x: 52, y: 92, p: 1 }, { n: 3, x: 22, y: 152, p: 2 }, { n: 4, x: 82, y: 152, p: 2 }, { n: 5, x: 132, y: 92, p: 1 }, { n: 6, x: 200, y: 92, p: 1 }, { n: 7, x: 200, y: 152, p: 6 }];
      let s = `<svg class="shape-svg" viewBox="0 0 ${W} 186" role="img" aria-label="木">`;
      for (const t of T) if (t.p) { const q = T[t.p - 1]; s += `<line class="sh-ptr" x1="${q.x}" y1="${q.y + 13}" x2="${t.x}" y2="${t.y - 13}"/>`; }
      for (const t of T) s += `<circle class="sh-cell on" cx="${t.x}" cy="${t.y}" r="14"/><text class="sh-lab strong" x="${t.x}" y="${t.y + 4.5}" text-anchor="middle">${t.n}</text>`;
      const lines = [];
      if (role(sh, 'children')) lines.push([rname(sh, 'children'), '子']);
      if (role(sh, 'parent')) lines.push([rname(sh, 'parent'), '親']);
      if (role(sh, 'n')) lines.push([`${rname(sh, 'n')}`, `節は ${role(sh, 'n').num} 個まで`]);
      if (role(sh, 'order')) lines.push([`番号`, `${role(sh, 'order').text}`]);
      s += legendLines(lines, 270, 40);
      return s + `</svg>`;
    }
    return '';
  }
  function fieldNote(n, name) { const f = (n && n.fields || []).find((x) => x[1] === name); return f ? f[2] : ''; }
  function legendLines(lines, x, y) {
    const colW = 150;
    return lines.map(([a, b], j) => {
      const cx = x + (j % 2) * colW, cy = y + Math.floor(j / 2) * 44;
      return `<text class="sh-lab" x="${cx}" y="${cy}"><tspan class="mono strong">${esc(a)}</tspan><tspan x="${cx}" dy="17" class="sh-note">${esc(b)}</tspan></text>`;
    }).join('');
  }

  // ---- a register's bits ----
  function bitsSvg(n) {
    const fs = (n.fields || []).map(([bits, name, note]) => {
      const m = String(bits).match(/(\d+)\s*[–-]\s*(\d+)/);
      return m ? { hi: +m[1], lo: +m[2], name, note } : null;
    }).filter(Boolean);
    if (!fs.length) return '';
    const W = 560, x0 = 10, w = W - 20, top = Math.max(...fs.map((f) => f.hi)) + 1;
    let s = `<svg class="bits-svg" viewBox="0 0 ${W} 74" role="img" aria-label="${esc(n.reg || '')} のビット">`;
    for (const f of fs) {
      const xa = x0 + ((top - 1 - f.hi) / top) * w, xb = x0 + ((top - f.lo) / top) * w;
      s += `<rect class="bit-cell" x="${f1(xa)}" y="8" width="${f1(xb - xa - 3)}" height="34" rx="6"/>`
        + `<text class="bit-name" x="${f1((xa + xb) / 2)}" y="30" text-anchor="middle">${esc(f.name)}（${f.hi - f.lo + 1} ビット）</text>`
        + `<text class="bit-idx" x="${f1(xa + 4)}" y="60">${f.hi}</text><text class="bit-idx" x="${f1(xb - 7)}" y="60" text-anchor="end">${f.lo}</text>`;
    }
    return s + `</svg>`;
  }

  // ---- where a node was entered in the recorded run ----
  function traceStrip(trace, hits, width) {
    const W = width || 640, H = 64, x0 = 8, x1 = W - 8;
    const maxI = Math.max(...trace.events.map((e) => e.instr), 1);
    const tids = Object.keys(trace.threads).sort((a, b) => Number(a) - Number(b));
    const rowOf = (tid) => tids.indexOf(String(tid));
    const rh = 12;
    let s = `<svg class="trace-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="記録の中で入った時">`;
    s += `<line class="tr-axis" x1="${x0}" x2="${x1}" y1="${H - 14}" y2="${H - 14}"/>`;
    for (const ev of trace.events) {
      if (ev.ev !== 'switch') continue;
      const x = x0 + (ev.instr / maxI) * (x1 - x0);
      s += `<line class="tr-switch" x1="${f1(x)}" x2="${f1(x)}" y1="4" y2="${H - 14}"/>`;
    }
    for (const { ev } of hits) {
      const x = x0 + (ev.instr / maxI) * (x1 - x0), r = rowOf(ev.thread);
      s += `<rect class="tr-hit t${r}" x="${f1(x - 2)}" y="${f1(6 + r * rh)}" width="4" height="${rh - 2}" rx="1"><title>${ev.instr.toLocaleString()} 命令目・${esc(trace.threads[ev.thread] || ev.thread)}・${esc(ev.fn || '')}</title></rect>`;
    }
    s += `<text class="tr-lab" x="${x0}" y="${H - 1}">0</text><text class="tr-lab" x="${x1}" y="${H - 1}" text-anchor="end">${maxI.toLocaleString()} 命令</text>`;
    return s + `</svg>`;
  }

  // ---- the layer lanes beside a flow's steps: one short arrow per step, from the giver's lane to the taker's ----
  function laneSvg(lanes, fromLane, toLane, opts = {}) {
    const lw = opts.laneW || 22, H = opts.height || 34, y = opts.y || 17;
    const W = lanes.length * lw;
    const xa = fromLane * lw + lw / 2, xb = toLane * lw + lw / 2;
    let s = `<svg class="lane-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`;
    if (fromLane === toLane) {
      // a step that stays in its layer: the dot, and a short arrow down its own lane
      s += `<title>同じ層の中</title><line class="lane-arrow${opts.alt ? ' alt' : ''}" x1="${xa}" y1="${y - 1}" x2="${xa}" y2="${y + 7}"/><path class="lane-tip" d="M${xa - 4.5},${y + 6}l4.5,7l4.5,-7z"/>`
        + `<circle class="lane-dot" data-layer="${esc(lanes[fromLane])}" cx="${xa}" cy="${y - 6}" r="4.5"/>`;
    } else {
      const dir = xb > xa ? 1 : -1;
      s += `<line class="lane-arrow${opts.alt ? ' alt' : ''}" x1="${xa}" y1="${y}" x2="${xb - dir * 7}" y2="${y}"/><path class="lane-tip" d="M${xb - dir * 2},${y}l${-dir * 7},-4.5v9z"/>`
        + `<circle class="lane-dot" data-layer="${esc(lanes[fromLane])}" cx="${xa}" cy="${y}" r="4.5"/>`;
    }
    return s + `</svg>`;
  }

  window.D = { paperSvg, shapeSvg, bitsSvg, traceStrip, laneSvg, fit, tw };
})();
