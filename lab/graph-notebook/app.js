/* app.js — the notebook: an outline and search on the left, one note per node in the middle, the graph on the right.
   Routes live in the address: #/  #/n/<node>?trail=<flow>:<step>,…  #/f/<flow or paper>?s=<step>  #/l/<layer>  #/t/<trace> */
(function () {
  'use strict';
  const M = window.M, D = window.D;
  const { A, NODES, LAYER, LAYERS, STACK, CROSS, FLOWS, PAPERS, P, KIND, STEP_KIND, TRACES } = M;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enc = encodeURIComponent;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k, d) { try { const v = localStorage.getItem('gn.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('gn.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };

  // ---------- small pieces ----------
  const nodeHref = (id, trail) => `#/n/${enc(id)}${trail && trail.length ? `?trail=${trail.map(([p, i]) => `${p}:${i}`).join(',')}` : ''}`;
  const flowHref = (pid, i) => `#/f/${enc(pid)}${i != null ? `?s=${i}` : ''}`;
  const layerName = (id) => (LAYER[id] ? LAYER[id].name : id);
  function glyphSvg(kind, layer, size = 14) {
    const r = size / 2 - 1.5;
    const path = window.Graph.glyph(kind, kind === 'schema' || kind === 'enum' ? r * 0.85 : r);
    return `<svg class="kg${window.Graph.hollow(kind) ? ' hollow' : ''}" data-layer="${esc(layer)}" width="${size}" height="${size}" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  function chip(id, opts = {}) {
    const n = NODES[id];
    if (!n) return `<span class="chip missing">${esc(id)}</span>`;
    const label = opts.label || n.title;
    const code = !opts.html && M.isCodeish(label);
    const href = nodeHref(id, opts.trail);
    return `<a class="chip${code ? ' code' : ''}${opts.mark ? ' mark' : ''}${opts.cls ? ' ' + opts.cls : ''}" href="${href}" data-node="${esc(id)}" data-layer="${esc(n.layer)}"${opts.title ? ` title="${esc(opts.title)}"` : ''}>${opts.html || esc(label)}</a>`;
  }
  function boxChip(p, b, trail) {
    const n = NODES[b.node];
    return chip(b.node, { label: b.title, trail, cls: 'box' + (n ? '' : ' missing') });
  }
  function linkify(s, opts = {}) {
    s = String(s || '');
    let out = '', last = 0;
    for (const m of s.matchAll(M.LINK_RE)) {
      out += esc(s.slice(last, m.index));
      out += m[2] === opts.self ? `<mark class="self">${esc(NODES[m[2]] ? NODES[m[2]].title : m[2])}</mark>` : chip(m[2]);
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }
  // links in code: a type name points at the node that defines it
  function typeLinks(s) {
    return esc(s).replace(/\b[A-Z][A-Za-z]*\b/g, (w) => (M.SCHEMA_BY_NAME[w] ? `<a class="tlink" href="${nodeHref(M.SCHEMA_BY_NAME[w])}" data-node="${M.SCHEMA_BY_NAME[w]}">${w}</a>` : w));
  }
  function prose(text, depth = 0, self) {
    return String(text || '').split('\n').map((para) => {
      const m = para.match(/^!\[\[([\w.\-]+)\]\]$/);
      if (!m) return para.trim() ? `<p>${linkify(para, { self })}</p>` : '';
      return embed(m[1], depth);
    }).join('');
  }
  function embed(id, depth) {
    const n = NODES[id];
    if (!n) return '';
    let body = '';
    if (depth >= 2) body = `<p>${linkify(M.firstSentence(n.text))}</p>`;
    else {
      if (n.figure) body += `<div class="fig">${n.figure}</div>`;
      body += depth >= 1 ? `<p>${linkify(M.firstSentence(n.text))}</p>${(n.text.match(/^!\[\[[\w.\-]+\]\]$/gm) || []).map((x) => embed(x.slice(3, -2), depth + 1)).join('')}` : prose(n.text, depth + 1);
    }
    return `<figure class="embed" data-layer="${esc(n.layer)}"><figcaption><span class="embed-k">埋め込み</span>${chip(id)}<span class="embed-meta">${esc(whereKind(n))}</span></figcaption>${body}</figure>`;
  }
  const whereKind = (n) => (layerName(n.layer) === (KIND[n.kind] || n.kind) ? layerName(n.layer) : `${layerName(n.layer)}・${KIND[n.kind] || n.kind}`);
  const countLabel = (n, unit) => `<span class="count">${n}${unit ? ' ' + unit : ''}</span>`;
  const section = (key, title, body, extra = '') => `<section class="sec" id="sec-${key}" data-toc="${esc(title)}">${`<h2>${title}${extra}</h2>`}${body}</section>`;
  const firstMain = (p) => M.mainSteps(p)[0].i;
  const stepFocus = (p, i) => { const st = p.steps[i]; return st.ref && NODES[st.ref] ? st.ref : M.boxById(p, st.to).node; };
  // the exported line of a step is a guess. A line is kept only when it does what the step says: it calls the step's
  // target, writes the place, or (for a return) returns, with the value when the verb is one. The right line is often
  // a line or two away (the call just before the write it explains), so up to 3 lines around are tried; else nothing.
  const stepLine = (p, i) => (M.C.steps[p.id] || {})[i] || null;
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function lineDoesStep(line, st, target) {
    if (st.kind === 'return') {
      if (!/\breturn\b/.test(line)) return false;
      return !/^[\w.]+$/.test(st.verb || '') || new RegExp(`\\breturn\\s+${reEsc(st.verb)}\\b`).test(line);
    }
    const c = M.C.nodes[target], n = NODES[target];
    if (!c || !c.symbol || !n) return false;
    const sym = reEsc(c.symbol);
    if (n.kind === 'func') return new RegExp(`\\b${sym}\\s*\\(`).test(line);
    if (n.kind === 'store') return new RegExp(`\\b${sym}\\s*=(?!=)`).test(line);
    return new RegExp(`\\b${sym}\\b`).test(line);
  }
  function findStepLine(lines, at, st, target) {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const k = at + d;
      if (k >= 1 && k <= lines.length && lineDoesStep(lines[k - 1], st, target)) return k;
    }
    return 0;
  }
  // threads in number order (idle is -1): the order their colours follow
  const threadIds = (t) => Object.keys(t.threads).sort((a, b) => Number(a) - Number(b));
  const regionOf = (p, boxId) => (p.regions || []).find((r) => r.boxes.includes(boxId)) || null;
  // the execution context around each step: the dashed frame of the box that acts, else the frame the walk is already
  // in. A place such as the request ring has no frame of its own; the code that touches it keeps its frame.
  const ctxMemo = new Map();
  function stepContexts(p) {
    if (ctxMemo.has(p.id)) return ctxMemo.get(p.id);
    const out = {};
    let cur = null;
    for (const { st, i } of M.mainSteps(p)) {
      const a = regionOf(p, st.from) || cur, b = regionOf(p, st.to) || a;
      out[i] = { a, b };
      for (const x of M.altsAt(p, i)) { const aa = regionOf(p, x.st.from) || a; out[x.i] = { a: aa, b: regionOf(p, x.st.to) || aa }; }
      cur = b;
    }
    ctxMemo.set(p.id, out);
    return out;
  }
  // a frame's short name on its chip (the whole one on hover); what its brackets add is said after the arrow
  const ctxShort = (r) => r.label3 || String(r.label).replace(/（[^）]*）$/, '');
  const ctxNote = (r) => (String(r.label).match(/（([^）]*)）$/) || [])[1] || '';
  const ctxChip = (r) => chip(r.node, { label: ctxShort(r), title: r.label });
  // "文脈が変わる A → B" when a step crosses from one execution context into another
  function ctxRow(p, i, cls) {
    const c = stepContexts(p)[i];
    if (!c || !c.b || c.a === c.b) return '';
    const note = ctxNote(c.b);
    const body = c.a ? `${ctxChip(c.a)}<span class="ar">→</span>${ctxChip(c.b)}` : `${ctxChip(c.b)}<span class="ctx-in">に入る</span>`;
    return `<div class="${cls} ctxchg" data-ctx="${esc([c.a ? c.a.node : '', c.b.node].join(' '))}"><span class="lbl">文脈が変わる</span><span class="ctx-flow">${body}${note ? `<span class="ctx-note">（${esc(note)}）</span>` : ''}</span></div>`;
  }

  // ---------- the note of one node ----------
  function noteHead(id, n) {
    const L = LAYER[n.layer];
    const code = M.C.nodes[id];
    const where = code && code.path ? `<span class="src-path">${esc(code.path)}</span>${code.start ? `<span class="src-lines">${code.start === code.end ? `${code.start} 行` : `${code.start}–${code.end} 行`}</span>` : ''}` : (n.code && n.code[0] ? `<span class="src-path">${esc(n.code[0])}</span>` : '<span class="src-none">コードの場所は無し</span>');
    // "… の中" only for a step of that function's own body; a box that is only drawn in another node's paper (the
    // emulator's timer in charge_elapsed's) is not inside it, and gets a line of its own
    const hosts = M.PAPER_HOSTS[id] || [];
    const insideOf = hosts.find((pid) => paperOwns(pid, id)) || null;
    const alsoIn = hosts.filter((pid) => pid !== insideOf);
    return `<header class="note-head" data-layer="${esc(n.layer)}">
      <nav class="crumbs" aria-label="場所"><a href="#/">目次</a><span>›</span><a href="#/l/${enc(n.layer)}">${esc(L.name)}</a>${insideOf ? `<span>›</span>${chip(M.PAPER_OWNER[insideOf])}<span class="muted">の中</span>` : ''}</nav>
      <div class="tags"><span class="tag layer" data-layer="${esc(n.layer)}">${glyphSvg(n.kind, n.layer, 13)}${esc(L.name)}</span>${KIND[n.kind] !== L.name ? `<span class="tag">${esc(KIND[n.kind] || n.kind)}</span>` : ''}${n.paper ? `<a class="tag paper" href="#sec-paper">中の紙あり</a>` : ''}<code class="nid">${esc(id)}</code></div>
      <h1 class="note-title${M.isCodeish(n.title) ? ' code' : ''}">${esc(n.title)}</h1>
      <div class="note-src">${where}${code && code.path ? `<a class="src-jump" href="#sec-code">コードを見る</a>` : ''}</div>
      ${alsoIn.length ? `<p class="also-in">${paperIcon()}<span class="ai-l">ほかの節の中の紙にも出てくる：</span>${alsoIn.map((pid) => `<a class="ai-p" href="${flowHref(pid)}" data-node="${esc(M.PAPER_OWNER[pid])}">${esc(M.pLabel(PAPERS[pid]))}</a>`).join('<span class="muted">・</span>')}</p>` : ''}
    </header>`;
  }
  // a paper holds a node as part of its owner when the box sits in the body band and in the owner's own layer
  function paperOwns(pid, id) {
    const p = PAPERS[pid], owner = M.PAPER_OWNER[pid];
    if (!p || !owner || !NODES[id]) return false;
    const entryBand = (p.boxes.find((b) => b.id === p.entry) || {}).layer;
    const body = p.bands.some((b) => b.id === 'body') ? 'body' : entryBand;
    return p.boxes.some((b) => b.node === id && b.layer === body) && NODES[id].layer === NODES[owner].layer;
  }
  function apiBlock(n) {
    const a = n.api;
    if (!a) return '';
    const rows = (a.params || []).map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${linkify(v)}</dd>`).join('') + (a.ret ? `<dt class="ret">返す</dt><dd>${linkify(a.ret)}</dd>` : '');
    return section('api', '型', `<pre class="sig"><code>${typeLinks(a.sig)}</code></pre>${rows ? `<dl class="params">${rows}</dl>` : ''}`);
  }
  function fieldsBlock(id, n, hot) {
    if (!n.fields || !n.fields.length) return '';
    const on = new Set(hot || []);
    if (n.kind === 'hw') {
      const rows = n.fields.map(([bits, name, note]) => `<tr><td class="ty mono">${esc(bits)}</td><td class="nm">${esc(name)}</td><td class="ds">${linkify(note)}</td></tr>`).join('');
      return section('fields', 'ビット', `<div class="fig bits" data-layer="${esc(n.layer)}">${D.bitsSvg(n)}</div>${n.reg ? `<p class="meta-line">番地 <code>${esc(n.reg)}</code>（32 ビット）</p>` : ''}<table class="fields"><thead><tr><th>ビット</th><th>名前</th><th>意味</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    const rows = n.fields.map(([ty, name, note]) => `<tr class="${on.has(name) ? 'hot' : ''}"><td class="ty mono">${typeLinks(ty)}</td><td class="nm mono">${esc(name)}</td><td class="ds">${linkify(note)}</td></tr>`).join('');
    const title = n.kind === 'schema' ? 'フィールド' : '中身';
    const note = hot && hot.length ? `<p class="meta-line hot-note">色の付いた行は、歩いている手順で渡るフィールド</p>` : '';
    return section('fields', title, `${note}<table class="fields"><thead><tr><th>型</th><th>名前</th><th>意味</th></tr></thead><tbody>${rows}</tbody></table>`, countLabel(n.fields.length));
  }
  function valuesBlock(n) {
    if (!n.values || !n.values.length) return '';
    const rows = n.values.map(([v, note]) => `<tr><td class="nm mono">${esc(v)}</td><td class="ds">${linkify(note) || '<span class="muted">—</span>'}</td></tr>`).join('');
    return section('values', '値', `<table class="fields values"><tbody>${rows}</tbody></table>`, countLabel(n.values.length));
  }
  function shapeBlock(id, n) {
    let sh = n.shape, host = id;
    if (sh && sh.of && NODES[sh.of] && NODES[sh.of].shape) { host = sh.of; sh = NODES[sh.of].shape; }
    let h = '';
    if (sh && sh.kind) {
      const names = { ring: 'リング', table: '表', list: 'リスト', tree: '木' };
      const hn = NODES[host];
      const borrowed = host !== id ? `<p class="meta-line">形は ${chip(host)} と同じ</p>` : '';
      h += `<div class="fig shape" data-layer="${esc(hn.layer)}">${D.shapeSvg(sh, hn)}</div>${borrowed}`;
      const ops = hn.ops || [];
      if (ops.length) {
        h += `<table class="fields ops"><thead><tr><th>操作</th><th>やり方</th><th>手間</th></tr></thead><tbody>${ops.map((o) => `<tr><td class="nm">${o.node ? chip(o.node) : `<code>${esc(o.name)}</code>`}<div class="op-kind">${esc(o.kind || '')}</div></td><td class="ds">${linkify(o.text)}</td><td class="cost mono">${esc(o.cost || '')}</td></tr>`).join('')}</tbody></table>`;
      }
      if ((hn.invariants || []).length) h += `<div class="callout"><div class="callout-h">いつも成り立つこと</div>${hn.invariants.map((x) => `<p>${linkify(x)}</p>`).join('')}</div>`;
      return section('shape', `形：${names[sh.kind] || sh.kind}`, h);
    }
    if (n.ops || n.invariants) {
      h += (n.ops || []).length ? `<table class="fields ops"><tbody>${n.ops.map((o) => `<tr><td class="nm">${o.node ? chip(o.node) : `<code>${esc(o.name)}</code>`}</td><td class="ds">${linkify(o.text)}</td><td class="cost mono">${esc(o.cost || '')}</td></tr>`).join('')}</tbody></table>` : '';
      h += (n.invariants || []).length ? `<div class="callout"><div class="callout-h">いつも成り立つこと</div>${n.invariants.map((x) => `<p>${linkify(x)}</p>`).join('')}</div>` : '';
      return section('shape', '操作', h);
    }
    return '';
  }
  function statesBlock(n) {
    if (!n.states) return '';
    const rows = n.states.moves.map((m) => `<tr><td class="nm"><span class="state">${esc(m.from)}</span></td><td class="arrow">→</td><td class="nm"><span class="state">${esc(m.to)}</span></td><td class="ds">${m.fns.map((f) => `<code>${esc(f)}</code>`).join(' ')}</td></tr>`).join('');
    return section('states', '移り変わり', `<p class="meta-line">フィールド <code>${esc(n.states.field)}</code> が変わる所と、変える関数</p><table class="fields states"><tbody>${rows}</tbody></table>`, countLabel(n.states.moves.length));
  }
  function contextBlock(id, n) {
    if (n.kind !== 'context') return '';
    const groups = M.CTX_MEMBERS[id] || [];
    let h = `<dl class="props"><dt>走るもの</dt><dd>${esc(n.run || '—')}</dd>${n.kernel ? `<dt>どこで</dt><dd>カーネルの中で走る</dd>` : ''}</dl>`;
    if (groups.length) {
      h += groups.map((g) => {
        const p = P[g.p];
        return `<div class="ctx-group"><div class="ctx-group-h"><a href="${flowHref(p.id)}">${esc(M.pTitle(p))}</a><span class="muted">の点線の枠「${esc(g.region.label)}」</span></div><div class="chips">${g.boxes.map((bid) => boxChip(p, M.boxById(p, bid))).join('')}</div></div>`;
      }).join('');
    }
    return section('ctx', 'この文脈で走るもの', h);
  }
  function paperBlock(id, n, trailTop) {
    if (!n.paper || !PAPERS[n.paper]) return '';
    const p = PAPERS[n.paper];
    const cur = trailTop && trailTop[0] === p.id ? trailTop[1] : null;
    const list = paperStepList(p, cur);
    return section('paper', `中の紙`, `<p class="meta-line">${esc(M.pTitle(p))}・${M.mainSteps(p).length} 手順。番号を押すと、そこから順に歩けます</p>
      <div class="fig paper" data-paper="${esc(p.id)}">${D.paperSvg(p, { width: paperWidth(), current: cur })}</div>${list}
      <div class="actions"><a class="btn primary" href="${nodeHref(stepFocus(p, firstMain(p)), [[p.id, firstMain(p)]])}">${playIcon()}紙の中を 1 から歩く</a><a class="btn" href="${flowHref(p.id)}">手順の一覧</a></div>`);
  }
  function paperStepList(p, cur, mark) {
    const items = p.steps.map((st, i) => {
      const fb = M.boxById(p, st.from), tb = M.boxById(p, st.to);
      const involved = mark && (fb.node === mark || tb.node === mark || st.ref === mark);
      return `<li class="${st.alt ? 'alt' : ''}${cur === i ? ' cur' : ''}${involved ? ' involved' : ''}"><a href="${nodeHref(stepFocus(p, i), [[p.id, i]])}" data-step="${esc(p.id)}:${i}"><span class="no">${esc(M.stepNo(st, i))}</span><span class="txt">${st.verb ? `<b>${esc(st.verb)}</b>` : ''}${esc(M.plain(st.label))}</span></a></li>`;
    }).join('');
    return `<ol class="mini-steps">${items}</ol>`;
  }
  // the width a figure gets inside the note (figures keep a readable size and scroll sideways on a phone)
  function contentWidth() {
    const page = $('#page');
    if (!page) return 680;
    const cs = getComputedStyle(page);
    return page.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }
  const paperWidth = () => Math.max(600, Math.min(760, contentWidth() - 12));
  const playIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3.2v9.6L12.6 8z"/></svg>`;

  function occurrencesBlock(id, n) {
    // a context's frames are listed in its own section already
    const occ = M.OCC[id].filter((o) => o.steps.length || o.boxes.length || (o.region && n.kind !== 'context') || o.slot);
    if (!occ.length) return '';
    const ofFlows = occ.filter((o) => M.isFlow(P[o.p]) || o.p !== n.paper);
    if (!ofFlows.length) return '';
    let h = '';
    for (const o of ofFlows) {
      const p = P[o.p];
      const isF = M.isFlow(p);
      const boxNames = o.boxes.map((bid) => `<code>${esc(M.boxById(p, bid).title)}</code>`).join('・');
      const region = o.boxes.length ? regionOf(p, o.boxes[0]) : null;
      const rows = o.steps.map(({ i, roles }) => {
        const st = p.steps[i], fb = M.boxById(p, st.from), tb = M.boxById(p, st.to);
        const nm = (b) => `<span class="ft-n${b.node === id ? ' me' : ''}" data-layer="${esc(NODES[b.node] ? NODES[b.node].layer : '')}">${esc(b.short || b.title)}</span>`;
        const role = roles.includes('ref') ? 'ref' : roles.includes('from') ? 'from' : roles.includes('to') ? 'to' : roles[0];
        return `<li class="${st.alt ? 'alt' : ''}"><a href="${nodeHref(id, [[p.id, i]])}" data-step="${esc(p.id)}:${i}" title="${esc(M.plain(st.label))}"><span class="no">${esc(M.stepNo(st, i))}</span><span class="verb">${esc(st.verb || M.STEP_KIND[st.kind] || '')}</span><span class="ft">${nm(fb)}<span class="ar">→</span>${nm(tb)}</span><span class="role r-${role}">${esc(M.ROLE[role] || '')}</span></a></li>`;
      }).join('');
      const isBox = p.boxes.some((b) => b.node === id);
      const fig = !isF ? `<div class="fig paper small">${D.paperSvg(p, { width: paperWidth() - 28, highlight: isBox ? id : null, steps: isBox ? null : o.steps.map((x) => x.i) })}</div>` : '';
      h += `<div class="occ"><div class="occ-h"><span class="occ-kind">${isF ? '流れ' : '中の紙'}</span><a class="occ-title" href="${flowHref(p.id)}">${esc(M.pTitle(p))}</a>${boxNames ? `<span class="occ-meta">箱 ${boxNames}${region ? `・${esc(region.label3 || region.label)}` : ''}</span>` : ''}</div>${fig}${rows ? `<ol class="occ-steps">${rows}</ol>` : `<p class="meta-line">${o.slot ? '置き場の中身の形として出てくる' : o.region ? '点線の枠として出てくる' : ''}</p>`}</div>`;
    }
    const nSteps = ofFlows.reduce((a, o) => a + o.steps.length, 0);
    return section('flows', '出てくる流れ', `${nSteps ? '<p class="meta-line">手順を押すと、その手順からこの流れを歩けます</p>' : ''}${h}`, nSteps ? countLabel(nSteps, '手順') : '');
  }
  function backlinksBlock(id, n) {
    const back = M.BACK[id];
    const types = M.TYPE_USERS[id] || [];
    const shapes = M.SHAPE_USERS[id] || [];
    if (!back.length && !types.length && !shapes.length) return '';
    let h = '';
    const fromNodes = back.filter((b) => b.from), fromSteps = back.filter((b) => b.p);
    if (fromNodes.length) {
      // group by the node that points here
      const groups = new Map();
      for (const b of fromNodes) { if (!groups.has(b.from)) groups.set(b.from, []); groups.get(b.from).push(b); }
      h += `<ul class="backlinks">${[...groups].map(([from, list]) => `<li>${chip(from)}<span class="bl-meta">${esc(whereKind(NODES[from]))}</span>${list.map((b) => b.embed && !b.sentence ? `<div class="bl-quote embed-q">ここを埋め込んでいる</div>` : `<blockquote class="bl-quote">${b.label ? `<span class="bl-label">${esc(b.label)}</span>` : ''}${linkify(b.sentence, { self: id })}</blockquote>`).join('')}</li>`).join('')}</ul>`;
    }
    if (fromSteps.length) {
      h += `<h3>手順の文から</h3><ul class="backlinks steps">${fromSteps.map((b) => { const p = P[b.p], st = p.steps[b.i]; return `<li><a class="bl-step" href="${nodeHref(id, [[p.id, b.i]])}"><span class="no">${esc(M.stepNo(st, b.i))}</span>${esc(M.pTitle(p))}</a><blockquote class="bl-quote">${b.label ? `<span class="bl-label">${esc(b.label)}</span>` : ''}${linkify(b.sentence, { self: id })}</blockquote></li>`; }).join('')}</ul>`;
    }
    if (shapes.length) h += `<h3>この形を借りている</h3><div class="chips">${shapes.map((k) => chip(k)).join('')}</div>`;
    if (types.length) h += `<h3>型として使っている</h3><ul class="type-users">${types.map((t) => `<li>${chip(t.from)}<span class="bl-meta">${t.where === 'sig' ? '関数の型' : `フィールド <code>${esc(t.label)}</code>`}</span></li>`).join('')}</ul>`;
    // each node counted once, however many ways it points here (Request: 8 by links, 7 as a type, 3 of them both = 12)
    const nNodes = M.POINTERS[id].size;
    return section('back', 'ここを指している節', h, countLabel(`${nNodes ? `${nNodes} 節` : ''}${nNodes && fromSteps.length ? '・' : ''}${fromSteps.length ? `手順の文 ${fromSteps.length}` : ''}`));
  }
  function traceBlock(id) {
    const hits = M.TRACE_HITS[id] || [];
    if (!hits.length) return '';
    return TRACES.map((t) => {
      const mine = hits.filter((h) => h.t === t.id);
      if (!mine.length) return '';
      const byThread = new Map();
      for (const { ev } of mine) byThread.set(ev.thread, (byThread.get(ev.thread) || 0) + 1);
      const tids = threadIds(t);
      const legend = [...byThread].map(([tid, c]) => `<span class="tr-key"><i class="t${tids.indexOf(String(tid))}"></i>${esc(t.threads[tid] || tid)}<b>${c}</b></span>`).join('');
      return section('trace', '記録に出てくる', `<p class="meta-line"><a href="#/t/${enc(t.id)}">${esc(t.title)}</a>で、ここに ${mine.length} 回入った（縦線はスレッドの切り替え）</p><div class="fig trace">${D.traceStrip(t, mine, paperWidth())}</div><div class="tr-legend">${legend}</div>`, countLabel(mine.length, '回'));
    }).join('');
  }
  function codeBlock(id) {
    const c = M.C.nodes[id];
    if (!c || !c.path) return '';
    return section('code', 'コード', `<div class="code-wrap" data-path="${esc(c.path)}" data-start="${c.start || ''}" data-end="${c.end || ''}" data-symbol="${esc(c.symbol || '')}"><div class="code-h"><span class="mono">${esc(c.path)}</span>${c.start ? `<span class="muted">${c.start === c.end ? c.start : `${c.start}–${c.end}`} 行</span>` : ''}</div><pre class="code"><code>読み込み中…</code></pre></div>`);
  }

  function renderNode(route) {
    const id = route.id, n = NODES[id];
    const trailTop = route.trail.length ? route.trail[route.trail.length - 1] : null;
    let hot = null;
    if (trailTop) { const st = P[trailTop[0]].steps[trailTop[1]]; if (st.data && st.data.schema === id) hot = st.data.fields || []; }
    let h = route.trail.length ? trailBar(route) : '';
    h += noteHead(id, n);
    if (n.figure) h += `<section class="sec prose-sec" id="sec-fig" data-toc="図"><div class="fig" data-layer="${esc(n.layer)}">${n.figure}</div></section>`;
    h += `<section class="sec prose-sec" id="sec-text" data-toc="本文"><div class="prose">${prose(n.text, 0)}</div></section>`;
    h += apiBlock(n) + fieldsBlock(id, n, hot) + valuesBlock(n) + shapeBlock(id, n) + statesBlock(n) + contextBlock(id, n) + paperBlock(id, n, trailTop)
      + occurrencesBlock(id, n) + backlinksBlock(id, n) + traceBlock(id) + codeBlock(id);
    return h;
  }

  // ---------- walking a flow: a bar over the note, the next step opens the next note ----------
  function trailBar(route) {
    const trail = route.trail;
    const [pid, i] = trail[trail.length - 1];
    const p = P[pid], st = p.steps[i];
    const mains = M.mainSteps(p);
    const k = mains.findIndex((x) => x.i === (st.alt ? st.alt.at : i));
    const fb = M.boxById(p, st.from), tb = M.boxById(p, st.to);
    const dive = M.intoPaper(p, st);
    const alts = st.alt ? [] : M.altsAt(p, i);
    const crumbs = trail.map(([q, j], d) => {
      const pq = P[q];
      return d === trail.length - 1 ? `<span class="tc-here">${esc(M.isFlow(pq) ? pq.tab : M.pLabel(pq))}</span>` : `<a href="${nodeHref(stepFocus(pq, j), trail.slice(0, d + 1))}">${esc(M.isFlow(pq) ? pq.tab : M.pLabel(pq))}</a><span class="sep">›</span>`;
    }).join('');
    const dots = mains.map((x, d) => {
      const b = M.boxById(p, x.st.to), lay = M.isFlow(p) ? b.layer : (NODES[b.node] || {}).layer;
      return `<a class="tdot${x.i === i || (st.alt && x.i === st.alt.at) ? ' cur' : ''}${d < k ? ' done' : ''}" data-layer="${esc(lay)}" href="${nodeHref(stepFocus(p, x.i), [...trail.slice(0, -1), [pid, x.i]])}" title="${esc(M.stepNo(x.st, x.i))}. ${esc(x.st.verb || '')} ${esc(M.plain(x.st.label))}"><span>${esc(M.stepNo(x.st, x.i))}</span></a>`;
    }).join('');
    const data = st.data ? `<div class="tr-row"><span class="lbl">渡す</span>${dataHtml(st.data)}</div>` : '';
    const ops = (st.ops || []).length ? `<div class="tr-row"><span class="lbl">操作</span>${st.ops.map((o) => `${chip(o.node)}<span class="op-k">${esc(o.kind)}</span>`).join('')}</div>` : '';
    const diveBtn = dive ? `<a class="btn small dive" href="${nodeHref(stepFocus(PAPERS[dive], firstMain(PAPERS[dive])), [...trail, [dive, firstMain(PAPERS[dive])]])}" data-key="dive">${paperIcon()}中の紙に入る：${esc(PAPERS[dive].tab)}（${M.mainSteps(PAPERS[dive]).length} 手順）</a>` : '';
    const altHtml = alts.length ? `<div class="tr-row alts"><span class="lbl">もし${esc(alts[0].st.alt.when)}なら</span>${alts.map((x) => `<a class="alt-step" href="${nodeHref(stepFocus(p, x.i), [...trail.slice(0, -1), [pid, x.i]])}"><span class="no">${esc(M.stepNo(x.st, x.i))}</span>${esc(x.st.verb || '')}：${esc(M.boxById(p, x.st.from).short || M.boxById(p, x.st.from).title)} → ${esc(M.boxById(p, x.st.to).short || M.boxById(p, x.st.to).title)}</a>`).join('')}</div>` : '';
    const altNote = st.alt ? `<div class="tr-row alts"><span class="lbl">${esc(st.alt.when)}の時</span><span class="muted">${esc(M.stepNo(p.steps[st.alt.at], st.alt.at))} の代わりに起きる</span></div>` : '';
    const atEnd = k === mains.length - 1 && trail.length === 1;
    const out = trail.length > 1 && k === mains.length - 1;
    // step 1 of this flow or paper: where a reader starts; any other step offers the way back to it
    const firstI = mains[0].i, atFirst = i === firstI;
    const from1 = atFirst ? '' : `<a class="btn small ghost from1" href="${nodeHref(stepFocus(p, firstI), [...trail.slice(0, -1), [pid, firstI]])}" title="${esc(M.isFlow(p) ? `「${p.tab}」` : M.pLabel(p))}を 1 から歩く" aria-label="1 から歩く"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3.5v9M12 3.5 6.5 8 12 12.5"/></svg><span class="f1-t">1 から</span></a>`;
    const intro = atFirst && trail.length === 1 && M.isFlow(p);
    const shown = M.isFlow(p) && p.start && p.steps[p.start[0]] ? p.start : null;
    const verb = st.verb || M.STEP_KIND[st.kind] || st.kind;
    // the line where the step happens, shown once the source confirms it
    const codeAt = stepLine(p, i);
    const codeRow = codeAt ? `<div class="tr-row code-at" hidden data-p="${esc(p.id)}" data-i="${i}" data-path="${esc(codeAt.path)}" data-line="${codeAt.line}" data-target="${esc(tb.node)}"><span class="lbl">コード</span><span class="mono small cl-at"></span><code class="line"></code></div>` : '';
    return `<div class="trail" id="trail" data-layer="${esc(NODES[stepFocus(p, i)].layer)}">
      <div class="tr-top"><span class="tr-kind">${footIcon()}<span class="tr-kind-t2">歩いている</span></span><nav class="tr-crumbs" aria-label="歩いている流れ">${crumbs}</nav>
        <span class="tr-count"><b>${esc(M.stepNo(st, i))}</b> / ${mains.length}</span>
        <button class="btn icon" data-key="prev" aria-label="前の手順" title="前の手順（←）" ${k <= 0 && trail.length === 1 && !st.alt ? 'disabled' : ''}>${chevron('l')}</button>
        <button class="btn icon" data-key="next" aria-label="次の手順" title="次の手順（→）" ${atEnd ? 'disabled' : ''}>${chevron('r')}</button>
        ${from1}<button class="btn small ghost auto${auto.on ? ' on' : ''}" data-key="auto" aria-pressed="${auto.on}" title="${auto.on ? '止める' : '手順を順に、ひとりでに進める（中の紙にも入る）'}">${auto.on ? pauseIcon() + '<span class="auto-t">止める</span>' : playIcon() + '<span class="auto-t">自動</span>'}</button>
        <a class="btn small ghost" href="${flowHref(pid, i)}">一覧</a><button class="btn icon ghost" data-key="close" aria-label="歩くのをやめる" title="歩くのをやめる">${closeIcon()}</button></div>
      <div class="tdots">${dots}</div>
      <div class="tr-step"><span class="tr-verb">${esc(verb)}</span>${st.verb ? `<span class="tr-kind-t">${esc(M.STEP_KIND[st.kind] || st.kind)}</span>` : ''}<span class="tr-ft">${boxChip(p, fb, trail)}<span class="ar">→</span>${boxChip(p, tb, trail)}</span></div>
      <p class="tr-label">${linkify(st.label)}</p>${ctxRow(p, i, 'tr-row')}${data}${ops}${altHtml}${altNote}${codeRow}
      ${diveBtn || out ? `<div class="tr-actions">${diveBtn}${out ? `<span class="muted small">紙の終わり。次（→）で外の流れに戻る</span>` : ''}</div>` : ''}
      ${intro ? `<p class="tr-hint">「${esc(p.tab)}」を 1 番目の手順から歩きます。<kbd class="k-arrow">→</kbd> で次の手順の節へ、番号で好きな手順へ。${shown && shown[0] !== i ? `地図が最初に見せる手順は <a href="${nodeHref(stepFocus(p, shown[0]), [[pid, shown[0]]])}">${esc(M.stepNo(p.steps[shown[0]], shown[0]))}（${esc(NODES[stepFocus(p, shown[0])].title)}）</a>。` : ''}全体は左上の<a href="#/">目次</a>から</p>` : ''}
    </div>`;
  }
  function dataHtml(d) {
    const head = d.schema && NODES[d.schema] ? chip(d.schema, { label: d.label }) : `<code class="dl">${esc(d.label)}</code>`;
    const fields = (d.fields || []).map((f) => `<code class="fld">${esc(f)}</code>`).join('');
    return `<span class="data">${head}${fields}${d.type ? `<span class="dtype">${esc(d.type)}</span>` : ''}</span>${d.note ? `<span class="dnote">${linkify(d.note)}</span>` : ''}`;
  }
  // next and previous steps; a paper ends by going back out to the step after the one that went in
  function trailMove(trail, dir) {
    const t = trail.map((x) => [...x]);
    const [pid, i] = t[t.length - 1];
    const p = P[pid], st = p.steps[i];
    const mains = M.mainSteps(p).map((x) => x.i);
    const here = st.alt ? st.alt.at : i;
    const k = mains.indexOf(here);
    if (dir > 0) {
      if (st.alt) { t[t.length - 1] = [pid, here]; return t; }
      if (k < mains.length - 1) { t[t.length - 1] = [pid, mains[k + 1]]; return t; }
      if (t.length > 1) {
        t.pop();
        const [op, oi] = t[t.length - 1], om = M.mainSteps(P[op]).map((x) => x.i), ok = om.indexOf(oi);
        if (ok < om.length - 1) t[t.length - 1] = [op, om[ok + 1]];
        return t;
      }
      return null;
    }
    if (st.alt) { t[t.length - 1] = [pid, here]; return t; }
    if (k > 0) { t[t.length - 1] = [pid, mains[k - 1]]; return t; }
    if (t.length > 1) { t.pop(); return t; }
    return null;
  }

  // ---------- a flow, or the paper inside a node, as a list of steps beside the layer lanes ----------
  function lanesOf(p) {
    if (M.isFlow(p)) return STACK.map((l) => l.id).filter((id) => p.boxes.some((b) => b.layer === id)).map((id) => ({ id, name: LAYER[id].name, tone: id }));
    return p.bands.map((b) => ({ id: b.id, name: b.name, tone: b.tone }));
  }
  function renderFlow(route) {
    const p = P[route.id];
    const isF = M.isFlow(p);
    const mains = M.mainSteps(p);
    const cur = route.step != null && p.steps[route.step] ? route.step : null;
    const lanes = lanesOf(p);
    const laneIdx = (b) => lanes.findIndex((l) => l.id === b.layer);
    const laneW = 24;
    const owner = M.PAPER_OWNER[p.id];
    const alts = p.steps.filter((s) => s.alt).length;
    let h = `<header class="note-head flow-head">
      <nav class="crumbs" aria-label="場所"><a href="#/">目次</a><span>›</span>${isF ? '<span>流れ</span>' : `${chip(owner)}<span class="muted">の中</span>`}</nav>
      <div class="tags"><span class="tag accent">${isF ? '流れ' : '中の紙'}</span><span class="tag">${mains.length} 手順${alts ? `・もし ${alts}` : ''}</span><span class="tag">箱 ${p.boxes.length}</span></div>
      <h1 class="note-title">${esc(isF ? p.tab : M.pTitle(p))}</h1>
      <p class="lead">${esc(isF ? p.title : `${NODES[owner].title} の中で、上から順に起きること`)}</p>
      <div class="actions"><a class="btn primary" href="${nodeHref(stepFocus(p, firstMain(p)), [[p.id, firstMain(p)]])}">${playIcon()}1 から歩く</a>${isF && p.start && p.start[0] !== firstMain(p) ? `<a class="btn" href="${nodeHref(p.start[1], [[p.id, p.start[0]]])}" title="地図が最初に見せる手順">${esc(String(p.start[0] + 1))} から歩く<span class="btn-note">地図が最初に見せる手順</span></a>` : ''}<span class="hint">↑↓ で手順を選び、Enter で節を開く</span></div>
    </header>`;
    if (!isF) h += `<section class="sec" id="sec-paper" data-toc="紙の図"><div class="fig paper" data-paper="${esc(p.id)}">${D.paperSvg(p, { width: paperWidth(), current: cur })}</div></section>`;
    if ((p.regions || []).length) {
      h += `<section class="sec" id="sec-ctx" data-toc="点線の枠"><h2>点線の枠（実行の文脈）</h2><div class="ctx-list">${p.regions.map((r) => `<div class="ctx-row">${chip(r.node, { label: r.label })}<span class="chips">${r.boxes.map((bid) => `<code>${esc(M.boxById(p, bid).short || M.boxById(p, bid).title)}</code>`).join('')}</span></div>`).join('')}</div></section>`;
    }
    const laneHead = `<div class="lane-head" style="width:${lanes.length * laneW}px">${lanes.map((l) => `<span class="lane-name" data-layer="${esc(l.tone)}" style="width:${laneW}px">${esc(l.name)}</span>`).join('')}</div>`;
    const card = (st, i, isAlt) => {
      const fb = M.boxById(p, st.from), tb = M.boxById(p, st.to);
      const ctxChange = ctxRow(p, i, 'st-row');
      const dive = M.intoPaper(p, st);
      const codeAt = stepLine(p, i);
      const ref = stepFocus(p, i);
      return `<li class="st${isAlt ? ' alt' : ''}${cur === i ? ' cur' : ''}" id="st-${i}" data-i="${i}">
        <div class="st-gut" style="width:${lanes.length * laneW}px">${D.laneSvg(lanes.map((l) => l.tone), laneIdx(fb), laneIdx(tb), { laneW, alt: isAlt })}</div>
        <div class="st-card" tabindex="-1">
          <div class="st-head"><span class="st-no">${esc(M.stepNo(st, i))}</span><span class="st-verb">${esc(st.verb || M.STEP_KIND[st.kind] || st.kind)}</span>${st.verb ? `<span class="st-kind k-${esc(st.kind)}">${esc(M.STEP_KIND[st.kind] || st.kind)}</span>` : ''}</div>
          <div class="st-ft">${boxChip(p, fb, [[p.id, i]])}<span class="ar">→</span>${boxChip(p, tb, [[p.id, i]])}</div>
          <p class="st-label">${linkify(st.label)}</p>
          ${st.data ? `<div class="st-row"><span class="lbl">渡す</span>${dataHtml(st.data)}</div>` : ''}
          ${(st.ops || []).length ? `<div class="st-row"><span class="lbl">操作</span>${st.ops.map((o) => `${chip(o.node)}<span class="op-k">${esc(o.kind)}</span>`).join('')}</div>` : ''}
          ${(st.branches || []).length ? `<div class="st-row br"><span class="lbl">分かれる</span><ul>${st.branches.map(([c, t]) => `<li><b>${esc(c)}</b><span class="ar">→</span>${linkify(t)}</li>`).join('')}</ul></div>` : ''}
          ${ctxChange}
          ${codeAt ? `<div class="st-row code-at" hidden data-p="${esc(p.id)}" data-i="${i}" data-path="${esc(codeAt.path)}" data-line="${codeAt.line}" data-target="${esc(tb.node)}"><span class="lbl">コード</span><span class="mono small cl-at"></span><code class="line"></code></div>` : ''}
          <div class="st-actions"><a class="st-open" href="${nodeHref(ref, [[p.id, i]])}">この手順の節を開く：${esc(NODES[ref].title)}</a>${dive ? `<a class="st-open dive" href="${flowHref(dive)}">${paperIcon()}中の紙：${esc(PAPERS[dive].tab)}</a>` : ''}</div>
        </div></li>`;
    };
    let list = '';
    for (const { st, i } of mains) {
      list += card(st, i, false);
      const as = M.altsAt(p, i);
      if (as.length) list += `<li class="alt-head"><div class="st-gut" style="width:${lanes.length * laneW}px"></div><div class="alt-h">もし${esc(as[0].st.alt.when)}なら（${esc(M.stepNo(st, i))} の代わりに）</div></li>` + as.map((x) => card(x.st, x.i, true)).join('');
    }
    h += `<section class="sec" id="sec-steps" data-toc="手順"><h2>手順${countLabel(mains.length)}</h2>${laneHead}<ol class="steps" style="--lanes:${lanes.length};--lane-w:${laneW}px">${list}</ol></section>`;
    return h;
  }

  // ---------- the index note ----------
  function journeySvg(p, w) {
    const lanes = lanesOf(p), mains = M.mainSteps(p);
    const left = 92, right = 14, rowH = 20, top = 22, W = w;
    const H = top + (lanes.length - 1) * rowH + 14;
    const x = (k) => left + 6 + (k / Math.max(1, mains.length - 1)) * (W - left - right - 12);
    const y = (b) => top + lanes.findIndex((l) => l.id === b.layer) * rowH;
    let s = `<svg class="journey" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.tab)}：手順ごとに、どの層からどの層へ渡るか">`;
    lanes.forEach((l, j) => { s += `<line class="j-lane" data-layer="${esc(l.tone)}" x1="${left}" x2="${W - right}" y1="${top + j * rowH}" y2="${top + j * rowH}"/><text class="j-name" x="${left - 10}" y="${top + j * rowH + 4}" text-anchor="end">${esc(l.name)}</text>`; });
    // each step: a short stroke from the giver's layer to the taker's, at the step's place
    mains.forEach(({ st, i }, k) => {
      const fb = M.boxById(p, st.from), tb = M.boxById(p, st.to);
      const xa = x(k) - 7, xb = x(k) + 7, ya = y(fb), yb = y(tb);
      if (k > 0) { const pb = M.boxById(p, mains[k - 1].st.to); s += `<path class="j-link" d="M${(x(k - 1) + 7).toFixed(1)},${y(pb)}L${xa.toFixed(1)},${ya}"/>`; }
      s += `<path class="j-path" d="M${xa.toFixed(1)},${ya}L${xb.toFixed(1)},${yb}"/><circle class="j-dot" data-layer="${esc(tb.layer)}" cx="${xb.toFixed(1)}" cy="${yb}" r="4.2"/>`;
      s += `<a href="${nodeHref(stepFocus(p, i), [[p.id, i]])}"><title>${esc(M.stepNo(st, i))}. ${esc(st.verb || '')}：${esc(M.plain(st.label))}</title><text class="j-no" x="${x(k).toFixed(1)}" y="11" text-anchor="middle">${esc(M.stepNo(st, i))}</text><rect class="j-hit" x="${(x(k) - 12).toFixed(1)}" y="0" width="24" height="${H}"/></a>`;
    });
    return s + `</svg>`;
  }
  function renderHome() {
    const counts = Object.fromEntries(LAYERS.map((l) => [l.id, M.IDS.filter((k) => NODES[k].layer === l.id).length]));
    const kindsOf = (lid) => { const c = {}; for (const k of M.IDS) if (NODES[k].layer === lid) c[NODES[k].kind] = (c[NODES[k].kind] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND[k]} ${v}`).join('・'); };
    let h = `<header class="note-head home"><div class="tags"><span class="tag accent">目次</span></div>
      <h1 class="note-title">${esc(A.title)}</h1>
      <p class="lead">${M.IDS.length} の節が ${STACK.length} つの層と、層をまたぐ ${CROSS.length} つの区分に並び、${FLOWS.length} つの流れがその間を通ります。</p>
      <div class="howto"><p><b>読み方</b> ノート 1 枚が節 1 つ。本文の色付きの名前は別の節へのリンクで、指すと中身が見え、押すとそのノートへ移ります。右のグラフは今のノートのまわりで、上ほどアプリ、下ほどエミュレータ。</p></div></header>`;
    h += `<section class="sec" id="sec-flows" data-toc="流れから読む"><h2>流れから読む</h2><div class="flow-cards">${FLOWS.map((p) => {
      const mains = M.mainSteps(p), alts = p.steps.length - mains.length;
      const order = [];
      for (const { st } of mains) for (const bid of [st.from, st.to]) if (!order.includes(bid)) order.push(bid);
      return `<article class="flow-card" data-flow="${esc(p.id)}"><div class="fc-h"><h3><a href="${flowHref(p.id)}">${esc(p.tab)}</a></h3><span class="fc-count">${mains.length} 手順${alts ? `・もし ${alts}` : ''}</span></div>
        <p class="fc-sub">${esc(p.title)}</p>${journeySvg(p, Math.max(300, contentWidth() - 42))}
        <div class="fc-chain">${order.map((bid, k) => `${k ? '<span class="ar">→</span>' : ''}${boxChip(p, M.boxById(p, bid))}`).join('')}</div>
        <div class="actions"><a class="btn primary" href="${nodeHref(stepFocus(p, firstMain(p)), [[p.id, firstMain(p)]])}">${playIcon()}1 から歩く</a>${p.start && p.start[0] !== firstMain(p) ? `<a class="btn" href="${nodeHref(p.start[1], [[p.id, p.start[0]]])}" title="地図が最初に見せる手順：${esc(NODES[p.start[1]].title)}">${p.start[0] + 1} から歩く<span class="btn-note">地図が最初に見せる手順</span></a>` : ''}<a class="btn ghost" href="${flowHref(p.id)}">手順の一覧</a></div></article>`;
    }).join('')}</div></section>`;
    h += `<section class="sec" id="sec-layers" data-toc="層"><h2>層</h2><div class="layer-stack">${STACK.map((l) => `<a class="layer-row" href="#/l/${enc(l.id)}" data-layer="${esc(l.id)}"><span class="lr-bar"></span><span class="lr-name">${esc(l.name)}<small>${esc(l.subs.join('・'))}</small></span><span class="lr-kinds">${esc(kindsOf(l.id))}</span><span class="lr-count">${counts[l.id]}</span></a>`).join('')}</div>
      <h3>層をまたぐもの</h3><div class="layer-stack cross">${CROSS.map((l) => `<a class="layer-row" href="#/l/${enc(l.id)}" data-layer="${esc(l.id)}"><span class="lr-bar"></span><span class="lr-name">${esc(l.name)}<small>${esc(l.subs.join('・'))}</small></span><span class="lr-kinds">${esc(kindsOf(l.id))}</span><span class="lr-count">${counts[l.id]}</span></a>`).join('')}</div></section>`;
    h += `<section class="sec" id="sec-papers" data-toc="中の紙"><h2>中の紙のある節</h2><p class="meta-line">箱の中にもう 1 枚の図を持つ節。ノートの中で図になっています</p><ul class="paper-list">${Object.values(PAPERS).map((p) => `<li>${chip(M.PAPER_OWNER[p.id])}<span class="muted">${esc(layerName(NODES[M.PAPER_OWNER[p.id]].layer))}・${M.mainSteps(p).length} 手順</span><a class="small" href="${flowHref(p.id)}">紙の手順</a></li>`).join('')}</ul></section>`;
    const pointed = M.IDS.map((k) => [k, M.POINTERS[k].size]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    h += `<section class="sec" id="sec-pointed" data-toc="よく指される節"><h2>よく指される節</h2><ol class="rank">${pointed.map(([k, c]) => `<li>${chip(k)}<span class="muted">${c} の節から</span></li>`).join('')}</ol></section>`;
    if (TRACES.length) {
      const t = TRACES[0];
      h += `<section class="sec" id="sec-trace" data-toc="記録"><h2>記録</h2><a class="trace-card" href="#/t/${enc(t.id)}"><b>${esc(t.title)}</b><span class="muted">${esc(t.date.slice(0, 10))}・イベント ${t.events.length}・スレッド ${Object.keys(t.threads).length}</span></a></section>`;
    }
    return h;
  }

  // ---------- a layer ----------
  function renderLayer(route) {
    const l = LAYER[route.id];
    const ids = M.IDS.filter((k) => NODES[k].layer === l.id);
    const byKind = new Map();
    for (const k of ids) { const kd = NODES[k].kind; if (!byKind.has(kd)) byKind.set(kd, []); byKind.get(kd).push(k); }
    let h = `<header class="note-head" data-layer="${esc(l.id)}"><nav class="crumbs"><a href="#/">目次</a><span>›</span><span>${l.cross ? '層をまたぐもの' : '層'}</span></nav>
      <div class="tags"><span class="tag layer" data-layer="${esc(l.id)}"><i class="sw"></i>${l.cross ? '層をまたぐもの' : `上から ${l.rank + 1} 番目の層`}</span><span class="tag">${ids.length} の節</span></div>
      <h1 class="note-title">${esc(l.name)}</h1><p class="lead">${esc(l.subs.join('・'))}</p></header>`;
    for (const [kd, list] of byKind) {
      h += section(`k-${kd}`, esc(KIND[kd] || kd), `<ul class="node-list">${list.map((k) => {
        const n = NODES[k], back = M.POINTERS[k].size, flows = M.OCC[k].filter((o) => o.steps.length).length;
        return `<li>${glyphSvg(n.kind, n.layer, 14)}<div class="nl-body"><div class="nl-h">${chip(k)}${n.paper ? '<span class="tag tiny">中の紙</span>' : ''}<span class="nl-meta">${flows ? `流れ ${flows}` : ''}${back ? `${flows ? '・' : ''}指される ${back}` : ''}</span></div><p>${linkify(M.firstSentence(n.text))}</p></div></li>`;
      }).join('')}</ul>`, countLabel(list.length));
    }
    return h;
  }

  // ---------- the recorded run ----------
  function renderTrace(route) {
    const t = TRACES.find((x) => x.id === route.id) || TRACES[0];
    const tids = threadIds(t);
    const r = t.run || {};
    let h = `<header class="note-head"><nav class="crumbs"><a href="#/">目次</a><span>›</span><span>記録</span></nav><div class="tags"><span class="tag accent">記録</span><span class="tag">${esc(t.date.replace('T', ' ').slice(0, 16))}</span></div>
      <h1 class="note-title">${esc(t.title)}</h1><p class="lead">関数に入った所を、起きた順に。節に結び付いた関数は色付きの名前で出ます。</p></header>`;
    if (r.before && r.after) {
      h += section('run', '前と後', `<table class="fields"><thead><tr><th></th><th>前</th><th>後</th></tr></thead><tbody>${['text', 'title', 'position'].map((k) => `<tr><td class="nm mono">${k}</td><td class="mono">${esc(JSON.stringify(r.before[k]))}</td><td class="mono">${esc(JSON.stringify(r.after[k]))}</td></tr>`).join('')}</tbody></table><p class="meta-line">打った文字 <code>${esc(r.typed)}</code>・タイマーの間隔 ${esc(r.timer_interval_us)} µs・記録したイベント ${esc(r.events)}（ここに ${t.events.length}）</p>`);
    }
    h += section('threads', 'スレッド', `<div class="tr-legend">${tids.map((tid, j) => `<span class="tr-key"><i class="t${j}"></i>${esc(t.threads[tid])}<small class="muted">（${esc(tid)}）</small></span>`).join('')}</div>`);
    // group consecutive events by thread
    const groups = [];
    for (const ev of t.events) {
      const g = groups[groups.length - 1];
      if (g && g.thread === ev.thread && ev.ev !== 'switch') g.evs.push(ev); else groups.push({ thread: ev.thread, evs: [ev] });
    }
    const evHtml = (ev) => {
      const at = `<span class="ev-i">${ev.instr.toLocaleString()}</span>`;
      if (ev.ev === 'request') return `<li class="ev ev-req">${at}<span class="ev-k">外から</span><span><code>${esc(ev.method)}</code></span></li>`;
      if (ev.ev === 'switch') return `<li class="ev ev-sw">${at}<span class="ev-k">切り替え</span><span>${esc(t.threads[ev.thread] || ev.thread)} へ</span></li>`;
      if (ev.ev === 'irq') return `<li class="ev ev-irq">${at}<span class="ev-k">割り込み</span><span>${esc((ev.cause || []).join('・'))}${ev.service ? `・<code>${esc(ev.service)}</code>` : ''}</span></li>`;
      return `<li class="ev">${at}<span class="ev-k">${ev.program ? esc(ev.program) : ''}</span><span>${ev.n ? chip(ev.n, { label: ev.fn }) : `<code>${esc(ev.fn || '')}</code>`}</span></li>`;
    };
    // one run of a thread: what it touched, in order, then every event on demand
    const story = (evs) => {
      const out = [];
      let last = null;
      for (const ev of evs) {
        let key = null, html = '';
        if (ev.ev === 'request') { key = 'r' + ev.method; html = `<span class="tok ext">外から <code>${esc(ev.method)}</code></span>`; }
        else if (ev.ev === 'irq') { key = 'i' + (ev.cause || []).join() + (ev.service || ''); html = `<span class="tok irq">割り込み ${esc((ev.cause || []).join('・'))}${ev.service ? ` <code>${esc(ev.service)}</code>` : ''}</span>`; }
        else if (ev.n) { key = 'n' + ev.n; html = chip(ev.n); }
        if (!key || key === last) continue;
        if (ev.n && out.some((o) => o.key === key) && out.length > 1) { last = key; continue; }
        out.push({ key, html });
        last = key;
      }
      return out.map((o) => o.html).join('<span class="ar">›</span>');
    };
    h += section('events', '起きた順', `<p class="meta-line">スレッドが続けて走った所ごとに 1 行。押すと、その間に入った関数が全部見えます</p><ol class="evgroups">${groups.map((g) => {
      const nNodes = g.evs.filter((e) => e.n).length;
      return `<li><details class="evg"><summary class="evg-h"><span class="evg-who"><i class="t${tids.indexOf(String(g.thread))}"></i>${esc(t.threads[g.thread] || g.thread)}</span><span class="evg-span">${g.evs[0].instr.toLocaleString()}〜${g.evs[g.evs.length - 1].instr.toLocaleString()}・${g.evs.length} 件${nNodes ? `・節 ${nNodes}` : ''}</span><span class="evg-story">${story(g.evs) || '<span class="muted">節に結び付いた関数は無し</span>'}</span></summary><ol class="evs">${g.evs.map(evHtml).join('')}</ol></details></li>`;
    }).join('')}</ol>`, countLabel(t.events.length));
    if (t.build) h += section('build', 'ビルド', `<table class="fields"><tbody>${Object.entries(t.build).map(([k, v]) => `<tr><td class="nm mono">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>`);
    return h;
  }

  const chevron = (d) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="${d === 'l' ? 'M10 3.5 5.5 8l4.5 4.5' : d === 'r' ? 'M6 3.5 10.5 8 6 12.5' : d === 'd' ? 'M3.5 6 8 10.5 12.5 6' : 'M3.5 10 8 5.5 12.5 10'}"/></svg>`;
  const closeIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
  const paperIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5.5L12 5v8.5H4z M9.5 2.5V5H12"/></svg>`;
  const pauseIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>`;
  const footIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h7.5M8 4.5 11.5 8 8 11.5"/><circle cx="13" cy="8" r="0.6"/></svg>`;

  // ---------- the outline on the left ----------
  const openGroups = new Set(store.get('open', []));
  function renderTree() {
    const counts = Object.fromEntries(LAYERS.map((l) => [l.id, M.IDS.filter((k) => NODES[k].layer === l.id)]));
    const group = (l) => {
      const open = openGroups.has(l.id);
      return `<div class="t-group${open ? ' open' : ''}" data-group="${esc(l.id)}" data-layer="${esc(l.id)}">
        <div class="t-head"><button class="t-toggle" aria-expanded="${open}" aria-label="${esc(l.name)}を${open ? '閉じる' : '開く'}" data-toggle="${esc(l.id)}">${chevron('r')}</button><a class="t-item t-layer" href="#/l/${enc(l.id)}"><i class="sw"></i><span class="t-name">${esc(l.name)}</span><span class="t-count">${counts[l.id].length}</span></a></div>
        <div class="t-children">${counts[l.id].map((k) => `<a class="t-item t-node" href="${nodeHref(k)}" data-item="${esc(k)}" title="${esc(NODES[k].title)}">${glyphSvg(NODES[k].kind, NODES[k].layer, 13)}<span class="t-name${M.isCodeish(NODES[k].title) ? ' code' : ''}">${esc(NODES[k].title)}</span>${NODES[k].paper ? '<span class="t-paper" title="中の紙あり">紙</span>' : ''}</a>`).join('')}</div></div>`;
    };
    $('#tree').innerHTML = `<a class="t-item t-home" href="#/">${homeIcon()}<span class="t-name">目次</span></a>
      <div class="t-sec">流れ</div>${FLOWS.map((p) => `<a class="t-item t-flow" href="${flowHref(p.id)}" data-flow="${esc(p.id)}">${flowIcon()}<span class="t-name">${esc(p.tab)}</span><span class="t-count">${M.mainSteps(p).length}</span></a>`).join('')}
      <div class="t-sec">層</div>${STACK.map(group).join('')}
      <div class="t-sec">層をまたぐもの</div>${CROSS.map(group).join('')}
      ${TRACES.length ? `<div class="t-sec">記録</div>${TRACES.map((t) => `<a class="t-item t-trace" href="#/t/${enc(t.id)}">${clockIcon()}<span class="t-name">${esc(t.title)}</span></a>`).join('')}` : ''}`;
  }
  const homeIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 7.2 8 3l5 4.2V13H3z M6.5 13V9.5h3V13"/></svg>`;
  const flowIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="4" r="1.6"/><circle cx="12.5" cy="12" r="1.6"/><path d="M5.2 4h3.3a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h3.3"/></svg>`;
  const clockIcon = () => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>`;
  function syncTree(route) {
    const activeNode = route.page === 'node' ? route.id : null;
    if (activeNode && !openGroups.has(NODES[activeNode].layer)) { openGroups.add(NODES[activeNode].layer); store.set('open', [...openGroups]); renderTree(); }
    $$('#tree .t-item').forEach((a) => a.classList.remove('active'));
    let el = null;
    if (route.page === 'node') el = $(`#tree [data-item="${CSS.escape(route.id)}"]`);
    else if (route.page === 'flow') el = $(`#tree [data-flow="${CSS.escape(route.id)}"]`) || null;
    else if (route.page === 'layer') el = $(`#tree [data-group="${CSS.escape(route.id)}"] .t-layer`);
    else if (route.page === 'home') el = $('#tree .t-home');
    else if (route.page === 'trace') el = $('#tree .t-trace');
    if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); const side = $('#side-scroll'); const r = el.getBoundingClientRect(), sr = side.getBoundingClientRect(); if (r.top < sr.top + 40 || r.bottom > sr.bottom - 20) el.scrollIntoView({ block: 'center' }); }
  }
  // search: titles first, then words in the text
  let results = [], resIdx = 0;
  function renderResults(q) {
    const box = $('#results'), tree = $('#tree');
    if (!q.trim()) { box.hidden = true; tree.hidden = false; results = []; return; }
    results = M.search(q);
    if (results.length) { const top = results[0].score; results = results.filter((r) => r.score > Math.min(top * 0.25, 40) || r.snippet); }
    resIdx = 0;
    box.hidden = false; tree.hidden = true;
    $('#side-scroll').scrollTop = 0;
    const mark = (s, hits) => { const set = new Set(hits); return [...String(s)].map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join(''); };
    box.innerHTML = results.length ? `<div class="r-count">${results.length} 件</div>` + results.map((r, i) => {
      const href = r.type === 'node' ? nodeHref(r.id) : r.type === 'flow' ? flowHref(r.id) : `#/l/${enc(r.id)}`;
      const n = r.type === 'node' ? NODES[r.id] : null;
      const icon = n ? glyphSvg(n.kind, n.layer, 13) : r.type === 'flow' ? flowIcon() : `<i class="sw" data-layer="${esc(r.id)}"></i>`;
      const sub = n ? `${esc(whereKind(n))}${r.via ? `・<span class="mono">${esc(r.via)}</span>` : ''}` : r.type === 'flow' ? (M.isFlow(P[r.id]) ? '流れ' : '中の紙') : '層';
      return `<a class="r-item${i === 0 ? ' sel' : ''}" href="${href}" data-r="${i}"${n ? ` data-layer="${esc(n.layer)}"` : ''}>${icon}<span class="r-main"><span class="r-title${n && M.isCodeish(n.title) ? ' code' : ''}">${mark(r.title, r.hits)}</span><span class="r-sub">${sub}</span>${r.snippet ? `<span class="r-snip">${esc(r.snippet.text.slice(0, r.snippet.at))}<mark>${esc(r.snippet.text.slice(r.snippet.at, r.snippet.at + r.snippet.len))}</mark>${esc(r.snippet.text.slice(r.snippet.at + r.snippet.len))}</span>` : ''}</span></a>`;
    }).join('') : `<p class="r-none">見つかりません。名前の一部か、本文の言葉で探せます</p>`;
  }
  function moveResult(d) {
    const items = $$('#results .r-item');
    if (!items.length) return;
    resIdx = (resIdx + d + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('sel', i === resIdx));
    items[resIdx].scrollIntoView({ block: 'nearest' });
  }

  // ---------- the graph on the right ----------
  let graph = null;
  const SCOPES = [['near', 'まわり'], ['wide', '広く'], ['flow', '流れ'], ['all', '全体']];
  const ui = { scope: store.get('scope', 'near'), wide: false };
  function scopeFor(route) {
    if (route.page === 'flow') return ui.flowScope || 'flow';
    if (route.page === 'home' || route.page === 'layer' || route.page === 'trace') return 'all';
    if (route.trail.length && ui.trailScope) return ui.trailScope;
    if (route.trail.length) return 'flow';
    return ui.scope;
  }
  function graphSpec(route, scope) {
    const flowCtx = route.page === 'flow' ? [route.id, route.step] : route.page === 'node' && route.trail.length ? route.trail[route.trail.length - 1] : null;
    if (scope === 'flow' && flowCtx) {
      const p = P[flowCtx[0]], cur = flowCtx[1];
      const mains = M.mainSteps(p).map((x) => x.i);
      const curMain = cur == null ? null : p.steps[cur].alt ? p.steps[cur].alt.at : cur;
      const order = new Map();
      [...mains, ...p.steps.map((_, i) => i)].forEach((i) => { for (const bid of [p.steps[i].from, p.steps[i].to]) if (!order.has(bid)) order.set(bid, order.size); });
      const egoNode = route.page === 'node' ? route.id : null;
      const isF = M.isFlow(p);
      // the execution contexts as dashed frames; the ones the current step runs in are drawn stronger
      const now = cur != null ? stepContexts(p)[cur] : null;
      return {
        mode: 'flow', aria: `${M.pTitle(p)}の箱と手順`,
        bands: isF ? null : p.bands.map((b) => ({ id: b.id, name: b.name, tone: b.tone })),
        regions: (p.regions || []).map((r) => ({ key: r.node, node: r.node, label: ctxShort(r), full: r.label, at: r.at || 'tl', boxes: r.boxes, on: !!now && (now.a === r || now.b === r) })),
        nodes: p.boxes.map((b) => ({ key: b.id, id: b.node, label: b.short || b.title, layer: (NODES[b.node] || {}).layer || b.layer, row: isF ? null : b.layer, kind: (NODES[b.node] || {}).kind || 'func', hop: b.node === egoNode ? 0 : 1, order: order.get(b.id) || 0, seed: b.node })),
        edges: p.steps.map((st, i) => ({ key: `${p.id}:${i}`, s: st.from, t: st.to, kind: 'step', dir: true, no: st.alt ? st.alt.no : String(i + 1), alt: !!st.alt, stepRef: `${p.id}:${i}`, title: `${M.stepNo(st, i)}. ${st.verb ? st.verb + '：' : ''}${M.plain(st.label)}`, state: cur == null ? '' : i === cur ? 'hi' : !st.alt && curMain != null && mains.indexOf(i) < mains.indexOf(curMain) ? 'done' : '' })),
        ego: p.boxes.find((b) => b.node === egoNode) ? p.boxes.find((b) => b.node === egoNode).id : null,
      };
    }
    if (scope === 'all' || route.page !== 'node') {
      const ego = route.page === 'node' ? route.id : null;
      const near = ego ? new Set([ego, ...M.ADJ[ego].keys()]) : null;
      const inLayer = route.page === 'layer' ? (k) => NODES[k].layer === route.id : route.page === 'trace' ? (k) => (M.TRACE_HITS[k] || []).length > 0 : null;
      return {
        mode: 'all', aria: '全部の節',
        nodes: M.IDS.map((k) => ({ key: k, id: k, label: NODES[k].title, layer: NODES[k].layer, kind: NODES[k].kind, hop: k === ego ? 0 : near && near.has(k) ? 1 : inLayer && inLayer(k) ? 1 : 2, dim: (near && !near.has(k)) || (inLayer && !inLayer(k)) })),
        edges: [...M.EDGES.values()].filter((e) => e.types.size && (M.isStrong(e) || e.types.has('type'))).map((e) => ({ key: e.key, s: e.a, t: e.b, kind: M.edgeKind(e) })),
        ego,
      };
    }
    const one = M.neighbourhood(route.id, 1);
    const cap = scope === 'wide' ? 36 : Math.max(14, one.ids.length);
    const nb = M.neighbourhood(route.id, 2, cap);
    return {
      mode: 'local', aria: `${NODES[route.id].title}のまわり`,
      nodes: nb.ids.map((k) => ({ key: k, id: k, label: NODES[k].title, layer: NODES[k].layer, kind: NODES[k].kind, hop: nb.hop.get(k) })),
      edges: nb.edges.map((e) => ({ key: e.key, s: e.a, t: e.b, kind: M.edgeKind(e) })),
      ego: route.id,
    };
  }
  function renderGraph(route) {
    const scope = scopeFor(route);
    const hasFlow = route.page === 'flow' || (route.page === 'node' && route.trail.length);
    $('#scope').innerHTML = SCOPES.map(([k, name]) => {
      const disabled = (k === 'flow' && !hasFlow) || ((k === 'near' || k === 'wide') && route.page !== 'node');
      return `<button type="button" data-scope="${k}" aria-pressed="${scope === k}" ${disabled ? 'disabled' : ''}>${name}</button>`;
    }).join('');
    const spec = graphSpec(route, scope);
    const n = spec.nodes.length;
    let cap;
    if (spec.mode === 'flow') {
      const p = route.page === 'flow' ? P[route.id] : P[route.trail[route.trail.length - 1][0]];
      const nm = M.mainSteps(p).length, na = p.steps.length - nm;
      cap = `${esc(M.pTitle(p))}・箱 ${n}・${nm} 手順${na ? `・もし ${na}` : ''}。番号を押すとその手順へ${(spec.regions || []).length ? '。点線の枠は実行の文脈' : ''}`;
    }
    else if (spec.mode === 'all') cap = route.page === 'layer' ? `全部の節 ${n}。${esc(layerName(route.id))}を濃く` : route.page === 'trace' ? `全部の節 ${n}。記録に出てくる節を濃く` : `全部の節 ${n}。上ほどアプリ、下ほどエミュレータ`;
    else cap = `${esc(NODES[route.id].title)} から 1 歩の節 ${spec.nodes.filter((x) => x.hop === 1).length}${spec.nodes.some((x) => x.hop === 2) ? `、2 歩 ${spec.nodes.filter((x) => x.hop === 2).length}` : ''}`;
    $('#graph-cap').innerHTML = cap;
    $('#graphpane').classList.toggle('has-regions', !!(spec.regions || []).length);
    graph.render(spec);
    const alone = spec.mode === 'local' && spec.nodes.length === 1;
    $('#graph-alone').hidden = !alone;
  }
  function renderToc() {
    const secs = $$('#page [data-toc]');
    $('#toc').innerHTML = secs.length > 2 ? `<div class="toc-h">このページ</div>${secs.map((s) => `<a href="#${s.id}" data-sec="${s.id}">${esc(s.dataset.toc)}</a>`).join('')}` : '';
  }

  // ---------- previews ----------
  const pop = { el: null, timer: 0, hideTimer: 0, for: null };
  function previewHtml(id) {
    const n = NODES[id], L = LAYER[n.layer];
    const back = M.POINTERS[id].size;
    const flows = M.OCC[id].filter((o) => o.steps.length).length;
    const text = M.sentences(String(n.text).replace(/^!\[\[[^\]]+\]\]$/gm, '')).slice(0, 2).join('');
    return `<div class="pv" data-layer="${esc(n.layer)}"><div class="pv-tags"><span class="tag layer" data-layer="${esc(n.layer)}">${glyphSvg(n.kind, n.layer, 12)}${esc(L.name)}</span>${KIND[n.kind] !== L.name ? `<span class="tag">${esc(KIND[n.kind])}</span>` : ''}${n.paper ? '<span class="tag">中の紙あり</span>' : ''}</div>
      <div class="pv-title${M.isCodeish(n.title) ? ' code' : ''}">${esc(n.title)}</div>
      ${n.api ? `<pre class="pv-sig">${esc(n.api.sig)}</pre>` : ''}
      <p class="pv-text">${linkify(text)}</p>
      <div class="pv-meta">${[flows ? `流れ ${flows}` : '', back ? `指される ${back}` : '', (M.TRACE_HITS[id] || []).length ? `記録 ${(M.TRACE_HITS[id] || []).length} 回` : ''].filter(Boolean).join('・') || '<span class="muted">—</span>'}<span class="pv-go">押すと開く</span></div></div>`;
  }
  function showPreview(id, anchor) {
    clearTimeout(pop.hideTimer);
    if (!NODES[id] || !anchor) return;
    if (pop.for === id && !pop.el.hidden) return;
    clearTimeout(pop.timer);
    pop.timer = setTimeout(() => {
      pop.for = id;
      pop.el.innerHTML = previewHtml(id);
      pop.el.hidden = false;
      const r = anchor.getBoundingClientRect(), pw = pop.el.offsetWidth, ph = pop.el.offsetHeight;
      let x = r.left + r.width / 2 - pw / 2, y = r.bottom + 8;
      if (y + ph > innerHeight - 8) y = r.top - ph - 8;
      if (y < 8) y = Math.min(innerHeight - ph - 8, r.bottom + 8);
      x = Math.max(8, Math.min(innerWidth - pw - 8, x));
      pop.el.style.left = `${x}px`; pop.el.style.top = `${y}px`;
      pop.el.classList.remove('in'); void pop.el.offsetWidth; pop.el.classList.add('in');
    }, pop.el.hidden ? 260 : 80);
  }
  function hidePreview(now) {
    clearTimeout(pop.timer);
    clearTimeout(pop.hideTimer);
    const hide = () => { pop.el.hidden = true; pop.for = null; };
    if (now) hide(); else pop.hideTimer = setTimeout(hide, 160);
  }

  // ---------- code ----------
  const files = new Map();
  const loadFile = (path) => { if (!files.has(path)) files.set(path, fetch(`../data/src/${path}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))); return files.get(path); };
  const KW = new Set('export import namespace struct enum fn let pub impl self Self return if else while for loop case of match break continue true false None Some bool i8 i16 i32 i64 u8 u16 u32 u64 u128 usize isize f32 f64 void char str borrow move const static mut use mod as where syscall unsafe in type extern'.split(' '));
  function highlight(lines) {
    let block = false;
    return lines.map((line) => {
      let out = '', i = 0;
      const push = (cls, s) => { out += cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s); };
      while (i < line.length) {
        if (block) { const e = line.indexOf('*/', i); if (e < 0) { push('c-com', line.slice(i)); i = line.length; } else { push('c-com', line.slice(i, e + 2)); i = e + 2; block = false; } continue; }
        if (line.startsWith('//', i)) { push('c-com', line.slice(i)); break; }
        if (line.startsWith('/*', i)) { block = true; push('c-com', '/*'); i += 2; continue; }
        const c = line[i];
        if (c === '"' || c === "'") { let j = i + 1; while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1; push('c-str', line.slice(i, j + 1)); i = j + 1; continue; }
        if (/[A-Za-z_]/.test(c)) {
          let j = i; while (j < line.length && /\w/.test(line[j])) j++;
          const w = line.slice(i, j);
          const next = line.slice(j).trimStart()[0];
          push(KW.has(w) ? 'c-kw' : next === '(' ? 'c-fn' : /^[A-Z]/.test(w) ? 'c-ty' : '', w); i = j; continue;
        }
        if (/[0-9]/.test(c)) { let j = i; while (j < line.length && /[\w.]/.test(line[j])) j++; push('c-num', line.slice(i, j)); i = j; continue; }
        push('', c); i++;
      }
      return out;
    });
  }
  function fillCode(root) {
    for (const w of $$('.code-wrap', root)) {
      const path = w.dataset.path, start = +w.dataset.start || 0, end = +w.dataset.end || 0;
      loadFile(path).then((text) => {
        const lines = text.split('\n');
        let a = start ? start : 1, b = end ? end : Math.min(lines.length, 30);
        // the comment written just above the definition explains it: include it
        let c = a - 1;
        if (lines[c - 1] && /\*\/\s*$/.test(lines[c - 1])) { let k = c; while (k > 0 && !/\/\*/.test(lines[k - 1]) && c - k < 16) k--; if (/\/\*/.test(lines[k - 1] || '')) a = k; }
        else while (c > 0 && /^\s*\/\//.test(lines[c - 1]) && a - c < 10) { a = c; c--; }
        if (start && start === end) { a = Math.max(1, Math.min(a, start - 3)); b = Math.min(lines.length, start + 3); }
        const hl = highlight(lines.slice(0, b));
        const long = b - a + 1 > 36;
        const show = (lim) => {
          const to = lim ? Math.min(b, a + 35) : b;
          let html = '';
          for (let k = a; k <= to; k++) html += `<span class="ln${k >= start && k <= (end || start) ? ' def' : ''}"><span class="no">${k}</span>${hl[k - 1] || ' '}</span>`;
          $('code', w).innerHTML = html;
        };
        show(long);
        if (long) {
          const more = document.createElement('button');
          more.className = 'btn small ghost code-more';
          more.textContent = `残り ${b - a - 35} 行も見る`;
          more.onclick = () => { show(false); more.remove(); };
          w.appendChild(more);
        }
      }).catch(() => { $('code', w).textContent = 'コードを読めませんでした（../data/src が無い所で開いている）'; });
    }
    // a step's line stays hidden until it is shown to do the step
    for (const el of $$('.code-at', root)) {
      const p = P[el.dataset.p], st = p && p.steps[+el.dataset.i];
      if (!st) continue;
      loadFile(el.dataset.path).then((text) => {
        const lines = text.split('\n');
        const k = findStepLine(lines, +el.dataset.line, st, el.dataset.target);
        if (!k) return;
        const hl = highlight(lines.slice(0, k));
        const at = $('.cl-at', el);
        at.textContent = `${el.dataset.path.split('/').pop()}:${k}`;
        at.title = `${el.dataset.path}:${k}`;
        $('.line', el).innerHTML = (hl[k - 1] || '').replace(/^\s+/, '');
        el.hidden = false;
      }).catch(() => {});
    }
  }

  // ---------- routes and history ----------
  function parse() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    const q = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    const trail = (q.get('trail') || '').split(',').filter(Boolean).map((x) => { const k = x.lastIndexOf(':'); return [x.slice(0, k), +x.slice(k + 1)]; }).filter(([p, i]) => P[p] && P[p].steps[i]);
    if (parts[0] === 'n' && NODES[parts[1]]) return { page: 'node', id: parts[1], trail };
    if (parts[0] === 'f' && P[parts[1]]) return { page: 'flow', id: parts[1], step: q.has('s') ? +q.get('s') : null, trail: [] };
    if (parts[0] === 'l' && LAYER[parts[1]]) return { page: 'layer', id: parts[1], trail: [] };
    if (parts[0] === 't' && TRACES.some((t) => t.id === parts[1])) return { page: 'trace', id: parts[1], trail: [] };
    return { page: 'home', trail: [] };
  }
  const hist = { idx: 0, max: 0 };
  let navFromPop = false, keyboardNav = false;
  function go(hash, replace) {
    if (!hash.startsWith('#')) hash = '#' + hash;
    if (location.hash === hash) { route(); return; }
    if (replace) history.replaceState({ idx: hist.idx, max: hist.max }, '', hash);
    else { hist.idx += 1; hist.max = hist.idx; history.pushState({ idx: hist.idx, max: hist.max }, '', hash); }
    route();
  }
  window.addEventListener('popstate', (e) => {
    navFromPop = true;
    if (e.state && typeof e.state.idx === 'number') hist.idx = e.state.idx;
    else { hist.idx += 1; hist.max = hist.idx; history.replaceState({ idx: hist.idx, max: hist.max }, '', location.hash); }
    route();
  });
  window.addEventListener('hashchange', () => { if (location.hash !== state.rendered) route(); });
  function updateHistButtons() {
    $('#back').disabled = hist.idx <= 0;
    $('#fwd').disabled = hist.idx >= hist.max;
  }

  const state = { route: null, rendered: null, scrollMemo: new Map() };
  function route() {
    const r = parse();
    const prevHash = state.rendered;
    if (prevHash) state.scrollMemo.set(prevHash, $('#main').scrollTop);
    state.route = r;
    state.rendered = location.hash || '#/';
    hidePreview(true);
    const page = $('#page');
    let h = '';
    if (r.page === 'node') h = renderNode(r);
    else if (r.page === 'flow') h = renderFlow(r);
    else if (r.page === 'layer') h = renderLayer(r);
    else if (r.page === 'trace') h = renderTrace(r);
    else h = renderHome();
    page.innerHTML = h;
    page.dataset.page = r.page;
    document.title = `${r.page === 'node' ? NODES[r.id].title : r.page === 'flow' ? M.pTitle(P[r.id]) : r.page === 'layer' ? LAYER[r.id].name : r.page === 'trace' ? '記録' : '目次'} — ${A.title}`;
    fillCode(page);
    syncTree(r);
    renderToc();
    renderGraph(r);
    updateHistButtons();
    // where to look: a remembered place, the chosen step, or the top
    const main = $('#main');
    const memo = state.scrollMemo.get(state.rendered);
    if (r.page === 'flow' && r.step != null && $(`#st-${r.step}`)) {
      const el = $(`#st-${r.step}`);
      if (memo != null && navFromPop) main.scrollTop = memo;
      else { main.scrollTop = 0; const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top - 150; if (top > 60) main.scrollTop = top; }
    } else main.scrollTop = memo != null && navFromPop ? memo : 0;
    navFromPop = false;
    if (!($('#q') === document.activeElement)) { const t = $('#page h1'); if (t && keyboardNav) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } }
    keyboardNav = false;
    markScrollables(page);
    $('body').classList.remove('side-open');
    // on a phone the graph covers the page: a new page is to be read, so the drawer gets out of the way
    if (phone.matches) setGraphOpen(false);
  }
  const phone = matchMedia('(max-width: 760px)');
  function setGraphOpen(on) {
    $('body').classList.toggle('graph-open', on);
    $('#graph-btn').setAttribute('aria-pressed', String(on));
  }
  // a figure wider than the page scrolls sideways; a fade and an arrow at the edge say there is more
  function markScrollables(root) {
    for (const f of $$('.fig', root)) {
      if (f.closest('.hs-wrap') || f.scrollWidth <= f.clientWidth + 2) continue;
      const w = document.createElement('div');
      w.className = 'hs-wrap';
      f.replaceWith(w);
      w.appendChild(f);
      const hint = document.createElement('span');
      hint.className = 'hs-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.textContent = '横に続く →';
      w.appendChild(hint);
      const upd = () => { w.classList.toggle('more-r', f.scrollLeft + f.clientWidth < f.scrollWidth - 4); w.classList.toggle('more-l', f.scrollLeft > 4); };
      f.addEventListener('scroll', upd, { passive: true });
      upd();
    }
  }

  const auto = { on: false, timer: 0, seen: new Set() };
  function autoStart() {
    auto.on = true; auto.seen = new Set();
    route();
    auto.timer = setTimeout(autoTick, 2600);
  }
  function autoStop() {
    if (!auto.on) return;
    auto.on = false; clearTimeout(auto.timer);
    const b = $('#trail [data-key="auto"]');
    if (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); b.innerHTML = playIcon() + '<span class="auto-t">自動</span>'; }
  }
  function autoTick() {
    const r = state.route;
    if (!auto.on || r.page !== 'node' || !r.trail.length) { autoStop(); return; }
    const [pid, i] = r.trail[r.trail.length - 1];
    const p = P[pid], dive = M.intoPaper(p, p.steps[i]);
    let t = null;
    if (dive && !auto.seen.has(`${pid}:${i}`)) { auto.seen.add(`${pid}:${i}`); t = [...r.trail, [dive, firstMain(PAPERS[dive])]]; }
    else {
      t = trailMove(r.trail, 1);
      // back out of a paper onto the step that went in: that step is done, keep going
      while (t && t.length < r.trail.length && auto.seen.has(`${t[t.length - 1][0]}:${t[t.length - 1][1]}`)) {
        const t2 = trailMove(t, 1);
        if (!t2) break;
        t = t2;
        if (!auto.seen.has(`${t[t.length - 1][0]}:${t[t.length - 1][1]}`)) break;
      }
    }
    if (!t) { autoStop(); return; }
    const [q, j] = t[t.length - 1];
    go(nodeHref(stepFocus(P[q], j), t));
    auto.timer = setTimeout(autoTick, 3400);
  }
  function stepNav(dir) {
    const r = state.route;
    if (r.page === 'node' && r.trail.length) {
      const t = trailMove(r.trail, dir);
      if (t) { const [pid, i] = t[t.length - 1]; go(nodeHref(stepFocus(P[pid], i), t)); }
      return true;
    }
    if (r.page === 'flow') {
      const p = P[r.id];
      const order = [];
      for (const { i } of M.mainSteps(p)) { order.push(i); for (const x of M.altsAt(p, i)) order.push(x.i); }
      const k = r.step == null ? -1 : order.indexOf(r.step);
      const nk = Math.max(0, Math.min(order.length - 1, k + dir));
      if (nk !== k) go(flowHref(p.id, order[nk]), true);
      return true;
    }
    return false;
  }

  // ---------- events ----------
  function bind() {
    pop.el = $('#pop');
    graph = new window.Graph($('#graph-host'), {
      onOpen: (id) => go(nodeHref(id, state.route.page === 'node' && state.route.trail.length && graph.spec.mode === 'flow' ? keepTrailFor(id) : null)),
      onHover: (id, el) => showPreview(id, el),
      onHoverEnd: () => hidePreview(),
      onStep: (ref) => { const k = ref.lastIndexOf(':'); const pid = ref.slice(0, k), i = +ref.slice(k + 1); openStep(pid, i); },
      onZoom: (z) => { $('#graph-reset').hidden = !z; },
    });
    document.addEventListener('click', (e) => {
      if (auto.on && !e.target.closest('[data-key="auto"]')) autoStop();
      const a = e.target.closest('a[href^="#/"]');
      if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); go(a.getAttribute('href')); return; }
      const sec = e.target.closest('a[href^="#sec-"], a[href^="#st-"]');
      if (sec) { e.preventDefault(); const el = document.getElementById(sec.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
      const t = e.target.closest('[data-toggle]');
      if (t) { const id = t.dataset.toggle; if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id); store.set('open', [...openGroups]); const g = t.closest('.t-group'); g.classList.toggle('open'); t.setAttribute('aria-expanded', g.classList.contains('open')); return; }
      const key = e.target.closest('[data-key]');
      if (key) {
        const k = key.dataset.key;
        if (k === 'auto') { if (auto.on) autoStop(); else autoStart(); return; }
        autoStop();
        if (k === 'next') stepNav(1); else if (k === 'prev') stepNav(-1);
        else if (k === 'close') go(nodeHref(state.route.id));
        return;
      }
      const sc = e.target.closest('[data-scope]');
      if (sc && !sc.disabled) {
        const r = state.route;
        if (r.page === 'flow') ui.flowScope = sc.dataset.scope;
        else if (r.page === 'node' && r.trail.length) ui.trailScope = sc.dataset.scope;
        else if (r.page === 'node') { ui.scope = sc.dataset.scope; store.set('scope', ui.scope); }
        renderGraph(r);
        return;
      }
      const ps = e.target.closest('[data-step]');
      if (ps && ps.tagName !== 'A') { const ref = ps.dataset.step, k = ref.lastIndexOf(':'); openStep(ref.slice(0, k), +ref.slice(k + 1)); return; }
      const box = e.target.closest('.p-box[data-node]');
      if (box) { go(nodeHref(box.dataset.node)); return; }
      const st = e.target.closest('#page .st');
      if (st && !e.target.closest('a, button')) { go(flowHref(state.route.id, +st.dataset.i), true); return; }
    });
    // previews on everything that names a node
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('#page [data-node], #pop [data-node]');
      if (el) { showPreview(el.dataset.node, el.closest('.p-box') ? el.querySelector('rect') || el : el); return; }
      if (e.target.closest('#pop')) clearTimeout(pop.hideTimer);
    });
    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('#page [data-node], #pop');
      if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hidePreview();
    });
    // what is pointed at in the page lights up in the graph: a flow card, a step, a name
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('#graph-host')) return;
      let key = null, act = null;
      const card = e.target.closest('.flow-card[data-flow]');
      const step = e.target.closest('#page [data-step], #trail [data-step]');
      const named = e.target.closest('#page [data-node]');
      if (step) {
        const ref = step.dataset.step, k = ref.lastIndexOf(':'), p = P[ref.slice(0, k)], st = p && p.steps[+ref.slice(k + 1)];
        if (st) { key = 's' + ref; act = () => graph.spotlightStep(ref, [M.boxById(p, st.from).node, M.boxById(p, st.to).node]); }
      } else if (named) {
        const id = named.dataset.node;
        key = 'n' + id;
        // a context named in the page lights its frame in a flow graph
        const reg = graph.spec && graph.spec.mode === 'flow' && (graph.spec.regions || []).find((r) => r.node === id);
        act = reg ? () => graph.spotlightRegion(reg.key) : () => graph.spotlight([id]);
      }
      else if (card) { key = 'f' + card.dataset.flow; act = () => graph.spotlight(P[card.dataset.flow].boxes.map((b) => b.node)); }
      if (key === graph.lit) return;
      graph.lit = key;
      if (act) act(); else graph.spotlight(null);
    });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('#page a.chip[data-node]'); if (el && keyboardFocus) showPreview(el.dataset.node, el); });
    document.addEventListener('focusout', () => hidePreview());
    // search
    const q = $('#q');
    q.addEventListener('input', () => renderResults(q.value));
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !q.value) { e.preventDefault(); const a = $('#tree .t-item.active') || $('#tree .t-item'); if (a) a.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveResult(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveResult(-1); }
      else if (e.key === 'Enter') { const el = $$('#results .r-item')[resIdx]; if (el) { e.preventDefault(); keyboardNav = true; go(el.getAttribute('href')); q.value = ''; renderResults(''); q.blur(); } }
      else if (e.key === 'Escape') { if (q.value) { q.value = ''; renderResults(''); } else q.blur(); }
    });
    $('#results').addEventListener('click', () => { q.value = ''; setTimeout(() => renderResults(''), 0); });
    $('#back').onclick = () => history.back();
    $('#fwd').onclick = () => history.forward();
    $('#graph-reset').onclick = () => graph.resetZoom();
    $('#graph-wide').onclick = () => toggleWide();
    $('#menu').onclick = () => { setGraphOpen(false); $('body').classList.toggle('side-open'); };
    $('#graph-btn').onclick = () => { $('body').classList.remove('side-open'); setGraphOpen(!$('body').classList.contains('graph-open')); };
    $('#graph-close').onclick = () => setGraphOpen(false);
    $('#help-btn').onclick = () => toggleHelp();
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('[data-close]')) toggleHelp(false); });
    $('#scrim').onclick = () => { $('body').classList.remove('side-open'); setGraphOpen(false); };
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (state.route) { renderGraph(state.route); } }, 120); }).observe($('#graph-host'));
    // the section in view lights up in the page outline
    $('#main').addEventListener('scroll', () => {
      const secs = $$('#page [data-toc]'), top = $('#main').getBoundingClientRect().top + 90;
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top <= top) cur = s;
      $$('#toc a').forEach((a) => a.classList.toggle('on', cur && a.dataset.sec === cur.id));
      const tr = $('#trail');
      if (tr) tr.classList.toggle('compact', $('#main').scrollTop > 140);
    }, { passive: true });
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', () => { keyboardFocus = false; });
  }
  let keyboardFocus = false;
  // a step chosen in a diagram or the graph: walk from there, on the note of the node that explains it
  function openStep(pid, i) {
    const r = state.route;
    const p = P[pid];
    let trail = [[pid, i]];
    if (r.page === 'node' && r.trail.length) {
      const k = r.trail.findIndex(([q]) => q === pid);
      if (k >= 0) trail = [...r.trail.slice(0, k), [pid, i]];
    }
    go(nodeHref(stepFocus(p, i), trail));
  }
  function keepTrailFor(id) {
    const t = state.route.trail, [pid, i] = t[t.length - 1], p = P[pid];
    const st = p.steps[i];
    const b = [M.boxById(p, st.from), M.boxById(p, st.to)].find((x) => x.node === id);
    if (b) return t;
    const k = p.steps.findIndex((s) => !s.alt && (M.boxById(p, s.to).node === id || s.ref === id));
    return k >= 0 ? [...t.slice(0, -1), [pid, k]] : null;
  }
  function toggleWide(on) {
    ui.wide = on == null ? !ui.wide : on;
    $('body').classList.toggle('graph-wide', ui.wide);
    $('#graph-wide').setAttribute('aria-pressed', ui.wide);
    $('#graph-wide').title = ui.wide ? '元の大きさ（Esc）' : '大きく見る';
    setTimeout(() => state.route && renderGraph(state.route), 30);
  }
  function toggleHelp(on) {
    const el = $('#help');
    const show = on == null ? el.hidden : on;
    el.hidden = !show;
    if (show) $('[data-close]', el).focus();
  }
  function treeKey(e) {
    const items = $$('#tree .t-item').filter((el) => el.offsetParent !== null);
    const k = items.indexOf(document.activeElement);
    if (k < 0) return false;
    const g = document.activeElement.closest('.t-group');
    if (e.key === 'ArrowDown') { items[Math.min(items.length - 1, k + 1)].focus(); return true; }
    if (e.key === 'ArrowUp') { items[Math.max(0, k - 1)].focus(); return true; }
    if (e.key === 'ArrowRight' && g && !g.classList.contains('open') && document.activeElement.closest('.t-head')) { $('.t-toggle', g).click(); return true; }
    if (e.key === 'ArrowLeft' && g) {
      if (g.classList.contains('open') && document.activeElement.closest('.t-head')) { $('.t-toggle', g).click(); return true; }
      if (!document.activeElement.closest('.t-head')) { $('.t-layer', g).focus(); return true; }
    }
    return false;
  }
  function onKey(e) {
    if (auto.on && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) autoStop();
    if (e.target.closest && e.target.closest('#tree') && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) && treeKey(e)) { e.preventDefault(); return; }
    const typing = e.target.closest('input, textarea, [contenteditable]');
    if (e.key === 'Tab') keyboardFocus = true;
    if (typing) return;
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); history.back(); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); history.forward(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); } return; }
    const r = state.route;
    switch (e.key) {
      case '/': e.preventDefault(); $('body').classList.add('side-open'); $('#q').focus(); $('#q').select(); break;
      case '[': history.back(); break;
      case ']': history.forward(); break;
      case 'ArrowRight': case 'j': if (r.page === 'node' && r.trail.length) { e.preventDefault(); keyboardNav = true; stepNav(1); } else if (r.page === 'flow' && e.key === 'j') { e.preventDefault(); stepNav(1); } break;
      case 'ArrowLeft': case 'k': if (r.page === 'node' && r.trail.length) { e.preventDefault(); keyboardNav = true; stepNav(-1); } else if (r.page === 'flow' && e.key === 'k') { e.preventDefault(); stepNav(-1); } break;
      case 'ArrowDown': if (r.page === 'flow') { e.preventDefault(); stepNav(1); } break;
      case 'ArrowUp': if (r.page === 'flow') { e.preventDefault(); stepNav(-1); } break;
      case 'Enter': if (r.page === 'flow' && r.step != null && !e.target.closest('a, button')) { e.preventDefault(); keyboardNav = true; go(nodeHref(stepFocus(P[r.id], r.step), [[r.id, r.step]])); } break;
      case 'i': if (r.page === 'node' && r.trail.length) { const d = $('#trail [data-key="dive"]'); if (d) go(d.getAttribute('href')); } break;
      case 'g': { const order = ['near', 'wide', 'flow', 'all'].filter((k) => !$(`#scope [data-scope="${k}"]`).disabled); const cur = scopeFor(r); const nx = order[(order.indexOf(cur) + 1) % order.length]; $(`#scope [data-scope="${nx}"]`).click(); break; }
      case 'f': toggleWide(); break;
      case 'h': go('#/'); break;
      case '?': toggleHelp(); break;
      case 'Escape': {
        const body = $('body');
        if (!$('#help').hidden) toggleHelp(false);
        else if (body.classList.contains('side-open') || body.classList.contains('graph-open')) { body.classList.remove('side-open'); setGraphOpen(false); }
        else if (ui.wide) toggleWide(false);
        else if (r.page === 'node' && r.trail.length) go(nodeHref(r.id));
        else hidePreview(true);
        break;
      }
      default: break;
    }
  }

  // ---------- start ----------
  renderTree();
  bind();
  // a first visit walks the first flow from its step 1 (the map's "はじめ" is only the step its own viewer shows first)
  if (!location.hash) {
    const f = FLOWS[0];
    history.replaceState({ idx: 0, max: 0 }, '', f && f.steps.length ? nodeHref(stepFocus(f, firstMain(f)), [[f.id, firstMain(f)]]) : '#/');
  }
  else if (history.state && typeof history.state.idx === 'number') { hist.idx = history.state.idx; hist.max = history.state.max || hist.idx; }
  else history.replaceState({ idx: 0, max: 0 }, '', location.hash);
  route();
  window.GN = { go, route: () => state.route, graph: () => graph };
})();
