// The sequence diagram (from seq-plus): lifelines grouped under their execution contexts and coloured by
// layer, arrows drawn by kind with their number always shown, papers as ref fragments that open in place
// and fold the outer steps they draw (「＝紙の 8」), ways taken instead as もし frames, activation bars.
// The model is seq-plus's (lib/seq-model.js); this draws it, compact (歩く) or with text and time (やりとり).
(function () {
  'use strict';
  const NX = window.NX, { A, esc, TR } = NX, S = window.SEQM;
  const X = S.makeAtlas(A, NX.C);
  const sd = (NX.seqdraw = { X });

  // ---------------------------------------------------------------- the model of one flow with some papers open
  sd.model = (flowId, open) => {
    const flow = A.flows.find((f) => f.id === flowId);
    const m = S.buildRows(X, flow, new Set(open || []));
    const L = S.buildLifelines(X, flow, m);
    const spans = S.frameSpans(X, m, L);
    const bars = S.activations(X, m, L);
    const rowIndex = new Map(m.rows.map((r, k) => [r.key, k]));
    return { flow, m, L, spans, bars, rows: m.rows, rowIndex, open: new Set(open || []) };
  };
  // the scopes of a step path: 'ui', 'ui/gateway', 'ui/gateway/submit'
  sd.scopeIds = (stack) => {
    const ids = [stack[0].id];
    for (let k = 1; k < stack.length; k++) {
      const pf = stack[k - 1], st = TR[pf.id].steps[pf.i];
      ids.push(ids[k - 1] + '/' + st.to);
    }
    return ids;
  };
  sd.rowKeyOf = (stack) => sd.scopeIds(stack)[stack.length - 1] + '#' + stack[stack.length - 1].i;
  sd.openOf = (stack) => sd.scopeIds(stack).slice(1);
  // a row back to a step path (the outer steps of the current path are kept when they lead there)
  sd.stackOfRowKey = (key, cur) => {
    const [scope, iStr] = key.split('#');
    const parts = scope.split('/');
    const st = [];
    let track = TR[parts[0]];
    for (let k = 0; k < parts.length; k++) {
      if (!track) return null;
      if (k === parts.length - 1) { st.push({ id: track.id, i: Number(iStr) }); break; }
      const box = parts[k + 1];
      let entry = cur && cur[k] && cur[k].id === track.id && track.steps[cur[k].i].to === box && NX.paperOf(track, cur[k].i) ? cur[k].i : -1;
      if (entry < 0) entry = track.steps.findIndex((s, j) => s.to === box && NX.paperOf(track, j));
      if (entry < 0) return null;
      st.push({ id: track.id, i: entry });
      track = TR[NX.paperOf(track, entry)];
    }
    return st;
  };
  sd.trackOfScope = (scope) => scope.sheetKey;

  // ---------------------------------------------------------------- columns, heads and rows
  const NAME = 12, SUB = 11;
  const lifeName = (l) => l.box.short || l.box.title;
  const lifeSub = (l) => (l.box.ns ? { t: l.box.ns, mono: true } : l.band ? { t: l.band.name, mono: false } : { t: NX.layerName((A.nodes[l.node] || {}).layer), mono: false });
  const lifeLayer = (l) => {
    if (l.band) return l.band.tone;
    return (A.nodes[l.node] || {}).layer || l.box.layer;
  };
  const isPlace = (l) => { const k = (A.nodes[l.node] || {}).kind; return k && k !== 'func' && k !== 'context'; };
  function splitName(name, max) {
    if (NX.textW(name, NAME, 650, NX.isAscii(name)) <= max) return [name];
    let best = null;
    for (let i = 2; i < name.length - 1; i++) {
      const prev = name[i - 1], cur = name[i];
      if (!('_ ・'.includes(prev) || cur === '(' || prev === '.')) continue;
      const a = name.slice(0, i).trimEnd(), b = name.slice(i).trimStart();
      const w = Math.max(NX.textW(a, NAME, 650, true), NX.textW(b, NAME, 650, true));
      if (!best || w < best.w) best = { a, b, w };
    }
    return best ? [best.a, best.b] : [name];
  }
  // A lifeline's role (seq-plus's line under the name: 「値を属性に束ねる」), in at most two lines of
  // about the same length, broken between words (never inside @timer(1000) or a name), else cut with …
  function wrapRole(text, max) {
    text = String(text || '').trim();
    if (!text) return [];
    const w = (x) => NX.textW(x, 11, 400);
    if (w(text) <= max) return [text];
    const ascii = (c) => /[\x21-\x7e]/.test(c || '');
    const nice = /[をのにでてはがとも・、 ）]/;
    let best = null;
    for (let i = 1; i < text.length; i++) {
      if (ascii(text[i - 1]) && ascii(text[i])) continue;          // inside a word or a name
      const a = text.slice(0, i).trim(), b = text.slice(i).trim();
      if (!a || !b) continue;
      const wa = w(a), wb = w(b);
      if (wa > max || wb > max) continue;
      const v = Math.max(wa, wb) - (nice.test(text[i - 1]) ? 12 : 0);
      if (!best || v < best.v) best = { v, a, b };
    }
    if (best) return [best.a, best.b];
    return [NX.clipText(text, max, 11, 400)];
  }
  // context runs: lifelines side by side under one execution context
  function ctxRuns(order) {
    const runs = [];
    order.forEach((l, i) => {
      const last = runs[runs.length - 1];
      if (l.ctx && last && last.ctx === l.ctx) last.hi = i;
      else if (l.ctx) runs.push({ ctx: l.ctx, region: l.region, lo: i, hi: i });
    });
    return runs;
  }
  function paperRuns(M) {
    const out = [];
    const order = M.L.order;
    for (const sc of M.m.scopes.slice(1)) {
      const idx = order.map((l, i) => (l.scope.id === sc.id ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      out.push({ sc, lo: Math.min(...idx), hi: Math.max(...idx), depth: sc.depth, title: sc.sheet.title });
    }
    return out;
  }
  // layout(M, {avail, compact, cellH: Map(rowKey → natural height of its text cell)})
  sd.layout = (M, opt) => {
    const order = M.L.order;
    const compact = !!opt.compact;
    const minCol = opt.minCol || (compact ? 66 : 76), maxCol = 168;
    const cols = order.map((l) => {
      const name = lifeName(l), sub = lifeSub(l);
      const lines = splitName(name, maxCol - 16);
      const nw = Math.max(...lines.map((x) => NX.textW(x, NAME, 650, NX.isAscii(x))));
      const sw = NX.textW(sub.t, SUB, 400, sub.mono);
      return { l, key: l.key, lines, sub, w: NX.clamp(Math.max(nw, Math.min(sw, maxCol - 14)) + 18, minCol, maxCol) };
    });
    const runs = ctxRuns(order);
    const papers = paperRuns(M);
    // a context's name should fit over its lifelines (its short form when the long one is too wide)
    for (const run of runs) {
      const have = cols.slice(run.lo, run.hi + 1).reduce((s, c) => s + c.w, 0);
      const long = run.region.label, short = NX.ctxShort(run.region);
      run.label = NX.textW(long, 12, 650) + 24 <= have ? long : short;
      const need = NX.textW(run.label, 12, 650) + 24;
      if (have < need) for (let i = run.lo; i <= run.hi; i++) cols[i].w += (need - have) / (run.hi - run.lo + 1);
    }
    const pad = 14;
    let total = cols.reduce((s, c) => s + c.w, 0);
    const avail = Math.max(320, opt.avail || 900);
    if (total + 2 * pad < avail) {
      const k = Math.min((avail - 2 * pad) / total, compact ? 1.5 : 1.6);
      cols.forEach((c) => (c.w *= k));
      total *= k;
    }
    const diagW = Math.max(total + 2 * pad, avail);
    let x = pad + Math.max(0, (diagW - 2 * pad - total) / 2);
    const colX = new Map(), colW = new Map(), colIndex = new Map();
    cols.forEach((c, i) => { c.x = x + c.w / 2; colX.set(c.key, c.x); colW.set(c.key, c.w); colIndex.set(c.key, i); x += c.w; });
    // heads: the contexts' row, one row per open paper, then the cards
    const ctxH = runs.length ? 24 : 0;
    const depth = papers.reduce((d, p) => Math.max(d, p.depth), 0);
    const paperH = depth * 22;
    const twoLines = cols.some((c) => c.lines.length > 1);
    // やりとり: each card also says what the lifeline does (its role); 歩く in a short pane: one line
    const roles = !compact && !opt.noRoles;
    if (roles) cols.forEach((c) => { c.role = wrapRole(c.l.box.sub, c.w - 14); });
    const roleN = roles ? cols.reduce((m, c) => Math.max(m, c.role.length), 0) : 0;
    const tight = compact && !!opt.tight;
    const cardH = tight ? 28 : (twoLines ? 58 : 44) + (roleN ? 6 + roleN * 14 : 0);
    const cardsTop = 8 + ctxH + paperH;
    const headH = cardsTop + cardH + 10;
    // rows
    const rows = new Map();
    let y = compact ? 10 : 12;
    for (const r of M.rows) {
      let h;
      const nat = opt.cellH ? opt.cellH.get(r.key) || 0 : 0;
      if (compact) {
        h = { step: 36, ftop: 28, operand: 26, fbot: 10, ref: 40, fold: 34 }[r.type] || 30;
        if (r.type === 'operand' && r.outcome) h = 26;
      } else if (r.type === 'step') h = Math.max(62, nat + 14);
      else if (r.type === 'fold') h = Math.max(52, nat + 10);
      else if (r.type === 'ftop') h = Math.max(r.frame.type === 'ref' ? 44 : 34, nat + 8);
      else if (r.type === 'operand') h = Math.max(32, nat + 8);
      else if (r.type === 'fbot') h = 14;
      else h = Math.max(64, nat + 14);
      const ay = r.type === 'step' ? (compact ? y + 25 : y + Math.min(h - 16, 40)) : null;
      rows.set(r.key, { y, h, ay, r });
      y += h;
    }
    const bodyH = y + (compact ? 14 : 28);
    return { cols, colX, colW, colIndex, diagW, headH, cardsTop, cardH, ctxH, paperH, runs, papers, rows, bodyH, compact, pad, tight, roleN, twoLines };
  };

  // ---------------------------------------------------------------- drawing
  const fx = (v) => Math.round(v * 10) / 10;
  function textW(s, size, weight, mono) { return NX.textW(s, size, weight, mono); }
  // the arrow of a step, by kind
  function arrow(kind, x1, x2, y) {
    const a = NX.ARROW[kind] || NX.ARROW.call;
    const dir = x2 >= x1 ? 1 : -1;
    const hl = a.head === 'fill' ? (kind === 'syscall' ? 11 : 9) : 8, hw = kind === 'syscall' ? 5.5 : 4.5;
    const end = a.head === 'fill' ? x2 - dir * (hl - 1) : x2 - dir * 1.2;
    let s = `<path class="sq-ln" d="M${fx(x1)} ${y}H${fx(end)}"${a.dash ? ` stroke-dasharray="${a.dash}"` : ''} style="stroke-width:${a.w}"/>`;
    if (a.head === 'fill') s += `<path class="sq-hd" d="M${fx(x2)} ${y}l${-dir * hl} ${-hw}v${hw * 2}z"/>`;
    else s += `<path class="sq-hd open" d="M${fx(x2 - dir * hl)} ${y - hw}L${fx(x2)} ${y}L${fx(x2 - dir * hl)} ${y + hw}"/>`;
    if (a.gate) s += `<rect class="sq-gate" x="${fx(x1 - 4)}" y="${y - 4}" width="8" height="8" rx="1.5"/>`;
    if (a.dot) s += `<circle class="sq-dot" cx="${fx(x1)}" cy="${y}" r="3.4"/>`;
    if (a.bolt) { const bx = x1 + dir * 14; s += `<path class="sq-bolt" d="M${fx(bx + 1.5)} ${y - 7}L${fx(bx - 3)} ${y + 1}H${fx(bx)}L${fx(bx - 1.5)} ${y + 7}L${fx(bx + 3)} ${y - 1}H${fx(bx)}Z"/>`; }
    return s;
  }
  sd.arrowSvg = arrow;
  // the number tag of a step
  function tag(x, y, label, tier, alt) {
    const w = Math.max(20, textW(label, 11, 700) + 10);
    const shape = alt ? `<rect x="${fx(x - w / 2)}" y="${y - 9}" width="${fx(w)}" height="18" rx="5"/>` : `<rect x="${fx(x - w / 2)}" y="${y - 9}" width="${fx(w)}" height="18" rx="9"/>`;
    return { w, svg: `<g class="sq-tag ${tier}${alt ? ' alt' : ''}">${shape}<text x="${fx(x)}" y="${y + 0.5}">${esc(label)}</text></g>` };
  }

  // heads(M, G, {node}): the contexts, the open papers and a card per lifeline
  sd.heads = (M, G, opt = {}) => {
    let s = `<svg class="sq-heads" width="${fx(G.diagW)}" height="${G.headH}" viewBox="0 0 ${fx(G.diagW)} ${G.headH}" role="img" aria-label="生存線">`;
    const left = (i) => G.cols[i].x - G.cols[i].w / 2, right = (i) => G.cols[i].x + G.cols[i].w / 2;
    for (const run of G.runs) {
      const x0 = left(run.lo) + 3, x1 = right(run.hi) - 3;
      const k = run.region && A.nodes[run.ctx] && A.nodes[run.ctx].kernel;
      s += `<rect class="sq-ctx${k ? ' k' : ''}" x="${fx(x0)}" y="6" width="${fx(x1 - x0)}" height="${G.headH}" rx="8"/>`;
      s += `<text class="sq-ctx-t" x="${fx(x0 + 10)}" y="22" data-sx0="${fx(x0 + 10)}" data-sx1="${fx(x1 - 10)}" data-sw="${fx(textW(run.label, 12, 650))}"><title>${esc(run.region.label)}</title>${esc(run.label)}</text>`;
    }
    for (const p of G.papers) {
      const y = 6 + G.ctxH + (p.depth - 1) * 22;
      const x0 = left(p.lo) + 2, x1 = right(p.hi) - 2;
      s += `<g class="sq-pgroup"><path d="M${fx(x0)} ${y + 18}V${y + 8}a4 4 0 0 1 4 -4H${fx(x1 - 4)}a4 4 0 0 1 4 4V${y + 18}"/><text x="${fx(x0 + 8)}" y="${y + 16}" data-sx0="${fx(x0 + 8)}" data-sx1="${fx(x1 - 8)}" data-sw="${fx(textW(p.title, 11, 700))}">${esc(p.title)}</text></g>`;
    }
    G.cols.forEach((c) => {
      const l = c.l, layer = lifeLayer(l);
      const x0 = c.x - c.w / 2 + 4, w = c.w - 8, y0 = G.cardsTop, h = G.cardH;
      const on = opt.node && l.node === opt.node;
      s += `<g class="sq-card${on ? ' on' : ''}${isPlace(l) ? ' place' : ''}" data-node="${esc(l.node)}" style="--lc:${NX.layerVar(layer)}">`;
      s += `<rect class="sq-card-b" x="${fx(x0)}" y="${y0}" width="${fx(w)}" height="${h}" rx="7"/><rect class="sq-card-bar" x="${fx(x0)}" y="${y0}" width="${fx(w)}" height="3" rx="1.5"/>`;
      if (G.tight) {
        // one line: the name (cut to the card), the rest in the tooltip
        const nm = c.lines.join(c.lines.length > 1 && NX.isAscii(c.lines[0]) ? '' : ' ');
        const t1 = NX.clipText(nm, w - 8, NAME, 650, NX.isAscii(nm));
        s += `<text class="sq-name${NX.isAscii(nm) ? ' code' : ''}" x="${fx(c.x)}" y="${y0 + 18}">${esc(t1)}</text>`;
      } else {
        const nameY = y0 + (c.lines.length > 1 ? 18 : 20);
        c.lines.forEach((ln, k) => { s += `<text class="sq-name${NX.isAscii(ln) ? ' code' : ''}" x="${fx(c.x)}" y="${nameY + k * 15}">${esc(ln)}</text>`; });
        const subY = nameY + (c.lines.length - 1) * 15 + 16;
        let sub = c.sub.t;
        while (sub.length > 2 && textW(sub, SUB, 400, c.sub.mono) > w - 8) sub = sub.slice(0, -2) + '…';
        s += `<text class="sq-sub${c.sub.mono ? ' code' : ''}" x="${fx(c.x)}" y="${subY}">${esc(sub)}</text>`;
        if (c.role && c.role.length) {
          const ry = y0 + (G.twoLines ? 58 : 44) + 8;
          c.role.forEach((ln, k) => { s += `<text class="sq-role" x="${fx(c.x)}" y="${ry + k * 14}">${esc(ln)}</text>`; });
        }
      }
      s += `<title>${esc(l.box.title + (l.box.ns ? '（' + l.box.ns + '）' : '') + (l.box.sub ? '：' + l.box.sub : ''))}</title></g>`;
    });
    return s + '</svg>';
  };

  // body(M, G, {current, node, flowStack}): lifelines, frames, bars and arrows, in three tiers
  sd.body = (M, G, opt = {}) => {
    const W = G.diagW, Hh = G.bodyH;
    const cur = opt.current && G.rows.has(opt.current) ? opt.current : null;
    const curIdx = cur ? M.rowIndex.get(cur) : -1;
    const tierOf = (r) => {
      if (r.key === cur) return 'now';
      if (r.st && r.st.alt) return 'alt';
      const k = M.rowIndex.get(r.key);
      return curIdx >= 0 && k < curIdx ? 'passed' : 'tocome';
    };
    let s = `<svg class="sq-body" width="${fx(W)}" height="${Hh}" viewBox="0 0 ${fx(W)} ${Hh}" role="img" aria-label="やりとり図。上から下へ手順が進む">`;
    s += `<defs><pattern id="sq-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="sq-hatch-l"/></pattern></defs>`;
    const left = (i) => G.cols[i].x - G.cols[i].w / 2, right = (i) => G.cols[i].x + G.cols[i].w / 2;
    // context bands, continuing the frames of the heads
    for (const run of G.runs) {
      const x0 = left(run.lo) + 3, x1 = right(run.hi) - 3;
      const k = run.region && A.nodes[run.ctx] && A.nodes[run.ctx].kernel;
      s += `<rect class="sq-ctx band${k ? ' k' : ''}" x="${fx(x0)}" y="-10" width="${fx(x1 - x0)}" height="${Hh + 2}" rx="8"/>`;
    }
    // the current row, across the diagram
    if (cur) { const g = G.rows.get(cur); s += `<rect class="sq-now-band" x="0" y="${g.y + 2}" width="${fx(W)}" height="${g.h - 4}" rx="6"/>`; }
    // lifelines
    G.cols.forEach((c) => {
      const on = opt.node && c.l.node === opt.node;
      s += `<line class="sq-life${isPlace(c.l) ? ' place' : ''}${on ? ' on' : ''}" x1="${fx(c.x)}" x2="${fx(c.x)}" y1="0" y2="${Hh}" style="--lc:${NX.layerVar(lifeLayer(c.l))}"/>`;
    });
    // frames (もし, 分かれ道, open papers), outermost first
    const frames = [...M.m.frames].sort((a, b) => a.depth - b.depth);
    const inset = (fr) => 6 + fr.depth * 5;
    const FX = new Map();
    const frameX = (fr) => {
      if (FX.has(fr)) return FX.get(fr);
      const sp = M.spans.get(fr);
      const x0 = left(sp.lo) + inset(fr);
      let x1 = right(sp.hi) - inset(fr);
      if (fr.type !== 'ref') {
        let need = 0;
        const top = M.rows[fr.r0];
        const kwW = textW(fr.sub === 'branch' ? '分かれ道' : 'もし', 11, 700) + 14;
        const full = (top.guard ? `［${top.guard}］` : '') + (fr.sub === 'branch' && top.outcome ? ' → ' + NX.plain(top.outcome) : '');
        need = kwW + 18 + textW(full, 11, 600);
        for (const r of M.rows) if (r.type === 'operand' && r.frame === fr) need = Math.max(need, 16 + textW(`［${r.guard}］${r.outcome ? ' → ' + NX.plain(r.outcome) : ''}`, 11, 600));
        if (x1 - x0 < need) x1 = Math.min(W - 6, x0 + need);
      }
      const v = { x0, x1 };
      FX.set(fr, v);
      return v;
    };
    let tabs = '';   // the names of frames, drawn over the activation bars
    for (const fr of frames) {
      if (fr.type === 'ref' && !fr.open) continue;
      const sp = M.spans.get(fr);
      if (!sp || sp.lo === Infinity) continue;
      const r0 = G.rows.get(M.rows[fr.r0].key), r1 = G.rows.get(M.rows[fr.r1].key);
      const { x0, x1 } = frameX(fr);
      const y0 = r0.y + 3, y1 = r1.y + r1.h - 2;
      if (fr.type === 'ref') {
        s += `<rect class="sq-fr ref" x="${fx(x0)}" y="${y0}" width="${fx(x1 - x0)}" height="${y1 - y0}" rx="8"/>`;
        const t = fr.paper.title;
        const tw = textW(t, 12, 650) + 46;
        tabs += `<g class="sq-fr-tab ref" data-close="${esc(fr.id)}" data-sx0="${fx(x0)}" data-sx1="${fx(x1)}" data-sw="${fx(tw)}"><path d="M${fx(x0)} ${y0 + 20}V${y0 + 8}a8 8 0 0 1 8 -8H${fx(x0 + tw)}l-8 20Z"/><text x="${fx(x0 + 10)}" y="${y0 + 14}">中の紙　${esc(t)}</text><title>押すと閉じる</title></g>`;
      } else {
        s += `<rect class="sq-fr" x="${fx(x0)}" y="${y0}" width="${fx(x1 - x0)}" height="${y1 - y0}" rx="6"/>`;
        const top = M.rows[fr.r0];
        const kw = fr.sub === 'branch' ? '分かれ道' : 'もし';
        const kwW = textW(kw, 11, 700) + 14;
        const full = (top.guard ? `［${top.guard}］` : '') + (fr.sub === 'branch' && top.outcome ? ' → ' + NX.plain(top.outcome) : '');
        const guard = NX.clipText(full, Math.max(40, x1 - x0 - kwW - 18), 11, 600);
        const gw = kwW + 10 + textW(guard, 11, 600);
        tabs += `<g class="sq-fr-tab" data-sx0="${fx(x0)}" data-sx1="${fx(x1)}" data-sw="${fx(gw)}"><path d="M${fx(x0)} ${y0 + 18}V${y0 + 6}a6 6 0 0 1 6 -6H${fx(x0 + kwW)}l-6 18Z"/><text class="kw" x="${fx(x0 + 7)}" y="${y0 + 13}">${kw}</text><text class="guard" x="${fx(x0 + kwW + 8)}" y="${y0 + 13}">${esc(guard)}<title>${esc(full)}</title></text></g>`;
      }
    }
    // operands: a dashed line and the guard
    for (const r of M.rows) {
      if (r.type !== 'operand') continue;
      const fr = r.frame, sp = M.spans.get(fr), g = G.rows.get(r.key);
      if (!sp) continue;
      const { x0, x1 } = frameX(fr);
      s += `<line class="sq-op" x1="${fx(x0)}" x2="${fx(x1)}" y1="${g.y + 4}" y2="${g.y + 4}"/>`;
      const full = `［${r.guard}］${r.outcome ? ' → ' + NX.plain(r.outcome) : ''}`;
      tabs += `<text class="sq-op-t" x="${fx(x0 + 8)}" y="${g.y + 18}">${esc(NX.clipText(full, Math.max(40, x1 - x0 - 16), 11, 600))}<title>${esc(full)}</title></text>`;
    }
    // activation bars
    const rowAt = (r) => G.rows.get(r.key);
    for (const b of M.bars) {
      const x = G.colX.get(b.key);
      if (x == null) continue;
      const g0 = rowAt(b.r0), g1 = rowAt(b.r1);
      if (!g0 || !g1) continue;
      const y0 = (g0.ay != null ? g0.ay : g0.y + 6) - 5, y1 = (g1.ay != null ? g1.ay : g1.y + g1.h - 4) + 6;
      const l = M.L.byKey.get(b.key);
      s += `<rect class="sq-bar" x="${fx(x - 5 + b.off * 4)}" y="${fx(y0)}" width="10" height="${fx(Math.max(10, y1 - y0))}" rx="2.5" style="--lc:${NX.layerVar(lifeLayer(l))}"/>`;
    }
    s += tabs;
    // closed papers and folded steps
    for (const r of M.rows) {
      const g = G.rows.get(r.key);
      if (r.type === 'ref') {
        const key = M.L.keyOf(r.frame.scope, r.frame.boxId), x = G.colX.get(key);
        const p = r.frame.paper, n = p.steps.filter((q) => !q.alt).length;
        const label = `中の紙　${p.title}`, sub = `${n} 手順　開く ▸`;
        const w = Math.max(textW(label, 12, 650), textW(sub, 11, 600)) + 26;
        const bx = NX.clamp(x - w / 2, 6, G.diagW - w - 6);
        const by = g.y + (G.compact ? 4 : Math.max(6, g.h / 2 - 22));
        const bh = G.compact ? g.h - 8 : 44;
        const tier = tierOf({ key: r.key });
        s += `<g class="sq-ref ${tier}" data-open="${esc(r.frame.id)}" role="button"><rect x="${fx(bx)}" y="${by}" width="${fx(w)}" height="${bh}" rx="8"/>`;
        if (G.compact) s += `<text class="t" x="${fx(bx + 12)}" y="${by + bh / 2 + 4}">${esc(p.title)}</text><text class="s" x="${fx(bx + w - 12)}" y="${by + bh / 2 + 4}" text-anchor="end">${n} 手順 ▸</text>`;
        else s += `<text class="t" x="${fx(bx + 12)}" y="${by + 18}">${esc(label)}</text><text class="s" x="${fx(bx + 12)}" y="${by + 35}">${esc(sub)}</text>`;
        s += `<title>${esc(p.title)}：押すとその場に開く</title></g>`;
      } else if (r.type === 'fold') {
        const key = M.L.keyOf(r.scope, r.refFrame.boxId);
        let x = (G.colX.get(key) || 40) - 40;
        const y = g.y + g.h / 2;
        for (const gh of r.ghosts) {
          const tsheet = r.sheet;
          const b = S.stepBadge(X, tsheet, gh.i), verb = gh.st.verb || S.KIND_LABEL[gh.st.kind] || '';
          const inner = gh.ks.map((k) => S.stepBadge(X, r.child.sheet, k)).join('・');
          const text = `${verb} ＝ 紙の ${inner}`;
          const w = textW(text, 12, 600) + 40;
          x = NX.clamp(x, 6, G.diagW - w - 6);
          s += `<g class="sq-fold" data-row="${esc(gh.keys[0])}" role="button"><rect x="${fx(x)}" y="${y - 12}" width="${fx(w)}" height="24" rx="12"/><circle cx="${fx(x + 13)}" cy="${y}" r="8.5"/><text class="b" x="${fx(x + 13)}" y="${y + 0.5}">${esc(b)}</text><text class="t" x="${fx(x + 27)}" y="${y + 0.5}">${esc(text)}</text><title>外の ${esc(b)} は、上の紙の ${esc(inner)} と同じこと。紙を開いている間は外の矢印を描かない</title></g>`;
          x += w + 8;
        }
      }
    }
    // arrows
    for (const r of M.rows) {
      if (r.type !== 'step') continue;
      const g = G.rows.get(r.key);
      const kf = M.L.keyOf(r.scope, r.st.from), kt = M.L.keyOf(r.scope, r.st.to);
      const xa = G.colX.get(kf), xb = G.colX.get(kt);
      if (xa == null || xb == null) continue;
      const tier = tierOf(r);
      const dir = xb >= xa ? 1 : -1;
      const x1 = xa + dir * 6, x2 = xb - dir * 6;
      const y = g.ay;
      const t = TR[r.sheet.id] || TR[r.scope.sheetKey];
      const label = S.stepBadge(X, r.sheet, r.i);
      s += `<g class="sq-step ${tier}" data-row="${esc(r.key)}"><rect class="sq-hit" x="0" y="${g.y}" width="${fx(W)}" height="${g.h}"/>`;
      s += `<g class="sq-arrow">${arrow(r.st.kind, x1, x2, y)}</g>`;
      // the label: the number, then the verb and the data, above the arrow, never past the edges
      const verb = r.st.verb || '';
      const data = r.st.data && r.st.data.label ? r.st.data.label : '';
      const vw = verb ? textW(verb, 12, tier === 'now' ? 700 : 600) : 0;
      const dw = data ? textW(data, 11, 500, true) + 12 : 0;
      const tw = Math.max(20, textW(label, 11, 700) + 10);
      const full = tw + (verb ? 6 + vw : 0) + (data ? 6 + dw : 0);
      let lx = Math.min(x1, x2) + 6;
      if (lx + full > W - 6) lx = W - 6 - full;
      lx = Math.max(6, lx);
      const ly = y - 13;
      s += `<rect class="sq-lbg" x="${fx(lx - 3)}" y="${ly - 10}" width="${fx(full + 6)}" height="20" rx="6"/>`;
      s += tag(lx + tw / 2, ly, label, tier, !!r.st.alt).svg;
      let cx = lx + tw + 6;
      if (verb) { s += `<text class="sq-verb" x="${fx(cx)}" y="${ly + 0.5}">${esc(verb)}</text>`; cx += vw + 6; }
      if (data) s += `<g class="sq-data"><rect x="${fx(cx)}" y="${ly - 8}" width="${fx(dw)}" height="16" rx="4"/><text x="${fx(cx + 6)}" y="${ly + 0.5}">${esc(data)}</text></g>`;
      s += `<title>${esc((t ? t.labels[r.i] : label) + '　' + (r.st.label || ''))}</title></g>`;
    }
    return s + '</svg>';
  };

  // Names of frames and contexts stay in sight when the diagram is scrolled sideways past their left edge.
  sd.stick = (root, left) => {
    for (const el of root.querySelectorAll('[data-sx0]')) {
      const x0 = Number(el.dataset.sx0), x1 = Number(el.dataset.sx1), w = Number(el.dataset.sw);
      const want = NX.clamp(left + 8, x0, Math.max(x0, x1 - w));
      if (want - x0 > 0.5) el.setAttribute('transform', `translate(${fx(want - x0)} 0)`);
      else el.removeAttribute('transform');
    }
  };

  // full time column helpers (やりとり): the record's moments against the rows
  sd.times = (M, occ) => {
    const T = S.traceInfo(X);
    if (!T) return { T: null, occs: [], times: new Map() };
    const occs = S.occurrences(X, T, M.m);
    const k = NX.clamp(occ || 0, 0, Math.max(0, occs.length - 1));
    return { T, occs, occ: k, times: occs.length ? S.mapTimes(X, T, M.m, occs[k]) : new Map() };
  };
})();
