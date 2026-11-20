// The article: every block of text is generated from docs/atlas (labels, node texts, data, code lines).
(function () {
  const S = window.S, esc = S.esc;

  // ---------- Inline text ----------
  // Code-like words (a.b, snake_case, NAME_LIKE_THIS, f()) are set in the code face.
  const CODE_RE = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+(?:\([^)\s]*\))?|\b[A-Za-z]\w*_\w+(?:\([^)\s]*\))?|\b[A-Za-z_]\w*\(\)/g;
  const codeWrap = (s) => esc(s).replace(CODE_RE, (m) => `<code>${m}</code>`);
  S.link = (id, label) => {
    const n = S.N[id];
    if (!n) return esc(id);
    const tone = S.nodeTone(id) || 'none';
    const t = label || n.title;
    return `<a class="ref T-${tone}${S.codeLike(t) ? ' mono' : ''}" href="#node-${esc(id)}" data-node="${esc(id)}">${esc(t)}</a>`;
  };
  // A line of text with [[links]]; embeds are not allowed here.
  S.inline = (text) => String(text || '').split(/(!?\[\[[\w.\-]+\]\])/).map((p) => {
    const m = p.match(/^!?\[\[([\w.\-]+)\]\]$/);
    return m ? S.link(m[1]) : codeWrap(p);
  }).join('');
  // Paragraphs with [[links]] and ![[embeds]] (a figure or a register drawn in place).
  S.rich = (text, opt = {}) => {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      let para = '';
      for (const p of line.split(/(!?\[\[[\w.\-]+\]\])/)) {
        const m = p.match(/^(!?)\[\[([\w.\-]+)\]\]$/);
        if (!m) { para += codeWrap(p); continue; }
        if (m[1]) { if (para.trim()) out.push(`<p>${para}</p>`); para = ''; out.push(embed(m[2], opt)); }
        else para += S.link(m[2]);
      }
      if (para.trim()) out.push(`<p>${para}</p>`);
    }
    return out.join('');
  };
  function embed(id, opt) {
    const n = S.N[id];
    if (!n) return '';
    const seen = opt.seen;
    if (seen && (seen.has('emb:' + id) || seen.has(id))) return `<p class="again">（${S.link(id)} は上で見た）</p>`;
    if (seen) seen.add('emb:' + id);
    if (n.kind === 'figure') return `<figure class="fig">${n.figure}<figcaption><b>${esc(n.title)}</b>${S.rich(n.text, { seen })}</figcaption></figure>`;
    if (n.kind === 'hw' && n.fields) {
      const bits = n.fields.map(([r, name, m]) => `<div style="flex:${bitWidth(r)}"><b>${esc(name)}</b><small>${esc(r)}</small></div>`).join('');
      const rows = n.fields.map(([r, name, m]) => `<tr><td class="ty">${esc(r)}</td><td class="c">${esc(name)}</td><td>${S.inline(m)}</td></tr>`).join('');
      return `<div class="reg T-${S.nodeTone(id) || 'none'}"><div class="reg-h"><b>${S.link(id)}</b>${n.reg ? `<code>${esc(n.reg)}</code>` : ''}</div><div class="bits">${bits}</div><table class="cd-t">${rows}</table>${opt.deep ? '' : S.rich(n.text.replace(/!\[\[[\w.\-]+\]\]/g, ''), {})}</div>`;
    }
    return `<p>${S.link(id)}</p>`;
  }
  const bitWidth = (r) => { const m = String(r).match(/(\d+)\D+(\d+)/); return m ? Math.abs(+m[1] - +m[2]) + 1 : 1; };

  // Small drawing of an arrow kind, as in the picture.
  S.edgeIcon = (kind) => {
    const dash = { return: '6 5', msg: '9 4 2 4', signal: '1 5' }[kind] || '';
    const w = { syscall: 3.2, signal: 2.8, data: 1.8 }[kind] || 2;
    const head = kind === 'return' ? '<path d="M37,2 L44,7 L37,12" fill="none" stroke="currentColor" stroke-width="1.8"/>' : '<path d="M36,2 L45,7 L36,12 Z" fill="currentColor"/>';
    const tail = kind === 'data' ? '<path d="M1,7 l5,-4 l5,4 l-5,4 z" fill="var(--surface)" stroke="currentColor" stroke-width="1.4"/>' : '';
    return `<svg class="ek" viewBox="0 0 46 14" aria-hidden="true"><line x1="${kind === 'data' ? 11 : 1}" y1="7" x2="37" y2="7" stroke-dasharray="${dash}" stroke-width="${w}" stroke-linecap="round"/>${head}${tail}</svg>`;
  };
  const CODE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const fileName = (p) => p.split('/').pop();

  const boxChip = (d, b) => {
    const tone = d.isPaper ? (S.toneOf((d.rowInfo[b.layer] || {}).tone) || 'none') : b.layer;
    const where = d.isPaper ? (d.rowInfo[b.layer] || {}).name : S.L[b.layer].name;
    return `<span class="bchip T-${tone}" data-node="${esc(b.node)}" tabindex="0"><span class="${S.codeLike(b.title) ? 'mono' : ''}">${esc(b.title)}</span><span class="ly">${esc(where || '')}</span></span>`;
  };

  // ---------- Pieces of a step ----------
  function note(id, seen, heading) {
    if (!id || !S.N[id] || seen.has(id)) return '';
    seen.add(id);
    const n = S.N[id];
    return `<div class="note T-${S.nodeTone(id) || 'none'}"><span class="note-h">${heading || ''}${S.link(id)}</span>${S.rich(n.text, { seen })}</div>`;
  }

  function dataBlock(st) {
    const data = st.data;
    if (!data) return '';
    const sc = data.schema && S.N[data.schema];
    let rows = '';
    if (sc && sc.fields && data.fields) {
      rows = data.fields.map((f) => {
        const fd = sc.fields.find((x) => x[1] === f);
        return `<tr><td class="ty">${fd ? esc(fd[0]) : ''}</td><td class="nm">${esc(f)}</td><td class="mn">${fd ? S.inline(fd[2]) : ''}</td></tr>`;
      }).join('');
    }
    const same = sc && sc.title === data.label;
    const head = same ? S.link(data.schema) : `<b>${esc(data.label)}</b>${sc ? ` <span class="sd-k">形</span> ${S.link(data.schema)}` : ''}`;
    return `<div class="st-data"><div class="sd-head"><span class="sd-k">渡すもの</span>${head}${data.fields && !rows ? ` <span class="mono">{ ${esc(data.fields.join(', '))} }</span>` : ''}</div>`
      + (data.type ? `<p class="sd-type">${S.inline(data.type)}</p>` : '')
      + (rows ? `<table>${rows}</table>` : '')
      + (data.note ? `<p class="sd-note">${S.inline(data.note)}</p>` : '') + '</div>';
  }

  // A step's line in the code. code.json guesses it (the first line in the caller that names the
  // target), which is sometimes wrong; S.checkCode() reads the source and moves the button to a line
  // that really does the step, or back to the target's definition. Until then it says 推定.
  function codeLine(d, st, i) {
    const at = (S.C.steps[d.g.id] || {})[i];
    const def = S.C.nodes[d.box[st.to].node] || S.C.nodes[st.ref];
    const attrs = `data-diag="${esc(d.id)}" data-step="${i}"`;
    if (at) return `<button type="button" class="st-code guess" ${attrs} data-path="${esc(at.path)}" data-line="${at.line}" title="自動で探した行。ソースで確かめる前">${CODE_ICON}<span class="where">${esc(fileName(at.path))} : ${at.line}</span><span class="why">推定</span></button>`;
    if (def) return defButton(def, attrs);
    return '';
  }
  function defButton(c, attrs = '') {
    if (c.start == null) return `<button type="button" class="st-code" ${attrs} data-path="${esc(c.path)}">${CODE_ICON}<span class="where">${esc(fileName(c.path))}</span><span class="why">ファイル</span></button>`;
    return `<button type="button" class="st-code" ${attrs} data-path="${esc(c.path)}" data-line="${c.start}" data-end="${c.end}">${CODE_ICON}<span class="where">${esc(fileName(c.path))} : ${c.start}${c.end > c.start ? '–' + c.end : ''}</span><span class="why">行き先の定義</span></button>`;
  }

  // What a line must contain to be the place of a step: a call of the target, a write to it, a return,
  // or the assignment a box is named after ("owner = pid").
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function evidence(d, st) {
    const to = d.box[st.to], tc = S.C.nodes[to.node];
    const name = tc && tc.symbol ? tc.symbol.split('.').pop() : null;
    const out = [];
    const asg = to.title.match(/^([A-Za-z_][\w.]*)\s*=\s*([A-Za-z_]\w*)$/);
    if (asg) out.push({ re: new RegExp(`\\b${reEsc(asg[1].split('.').pop())}\\s*=(?!=).*\\b${reEsc(asg[2])}\\b`), what: `${asg[1]} = ${asg[2]}`, own: true });
    if (st.kind === 'return') out.push({ re: /\breturn\b/, what: 'return' });
    else if (st.kind === 'data') { if (name) out.push({ re: new RegExp(`\\b${reEsc(name)}\\b(\\s*\\[[^\\]]*\\])?(\\.\\w+)*\\s*=(?!=)`), what: `${name} に書く` }); }
    else if (name) out.push({ re: new RegExp(`\\b${reEsc(name)}\\s*\\(`), what: `${name}(…) を呼ぶ` });
    return out;
  }
  function locate(d, st, i, src) {
    const at = (S.C.steps[d.g.id] || {})[i];
    const pats = evidence(d, st);
    const from = S.C.nodes[d.box[st.from].node], to = S.C.nodes[d.box[st.to].node];
    if (at && src[at.path]) {
      const L = src[at.path];
      const end = from && from.path === at.path && from.end ? Math.max(at.line, Math.min(from.end, at.line + 8)) : at.line + 6;
      for (let k = at.line; k <= end; k++) for (const p of pats) if (p.re.test(L[k - 1] || '')) return { path: at.path, line: k, what: p.what, moved: k !== at.line };
    }
    for (const p of pats.filter((x) => x.own)) if (to && to.start && src[to.path]) {
      const L = src[to.path];
      for (let k = to.start; k <= (to.end || to.start); k++) if (p.re.test(L[k - 1] || '')) return { path: to.path, line: k, what: p.what, moved: true };
    }
    return null;
  }
  S.checkCode = async () => {
    const btns = [...document.querySelectorAll('.st-code.guess')];
    const paths = [...new Set(btns.map((b) => b.dataset.path))];
    const own = [];
    for (const b of btns) { const d = S.D[b.dataset.diag], st = d.g.steps[+b.dataset.step]; const c = S.C.nodes[d.box[st.to].node]; if (c && c.path) own.push(c.path); }
    const src = {};
    await Promise.all([...new Set([...paths, ...own])].map(async (p) => {
      try { const r = await fetch('../data/src/' + p); if (r.ok) src[p] = (await r.text()).split('\n'); } catch (e) { /* stays 推定 */ }
    }));
    const report = [];
    for (const b of btns) {
      const d = S.D[b.dataset.diag], i = +b.dataset.step, st = d.g.steps[i];
      if (!src[b.dataset.path]) continue;   // could not read the source: keep the guess, marked 推定
      const hit = locate(d, st, i, src);
      const was = `${b.dataset.path}:${b.dataset.line}`;
      if (hit) {
        b.dataset.path = hit.path; b.dataset.line = hit.line;
        b.querySelector('.where').textContent = `${fileName(hit.path)} : ${hit.line}`;
        b.querySelector('.why').textContent = '手順の行';
        b.title = `ソースで確かめた：この行で ${hit.what}${hit.moved ? '（自動で探した行から直した）' : ''}`;
        b.classList.remove('guess');
      } else {
        const def = S.C.nodes[d.box[st.to].node] || S.C.nodes[st.ref];
        if (def) { const t = document.createElement('template'); t.innerHTML = defButton(def, `data-diag="${esc(d.id)}" data-step="${i}"`); b.replaceWith(t.content.firstChild); }
      }
      report.push(`${d.id}/${i}: ${was} -> ${hit ? hit.path + ':' + hit.line : 'definition'}`);
    }
    S.codeReport = report;
  };

  function stepBlock(sc, seen) {
    const d = S.D[sc.diag], st = d.g.steps[sc.step];
    const a = d.box[st.from], b = d.box[st.to];
    const no = S.stepNo(d, sc.step);
    const verb = S.heading(d, st);
    const refsInDiag = new Set(d.g.steps.map((x) => x.ref));
    let notes = note(st.ref, seen);
    // A box reached for the first time whose node no step explains gets its own note.
    if (!refsInDiag.has(b.node)) notes += note(b.node, seen);
    let meta = '';
    if (st.ops) meta += `<span class="meta-k">操作</span><span>${st.ops.map((o) => `${S.link(o.node)} に「${esc(o.kind)}」`).join('、')}</span>`;
    if (st.branches) meta += `<span class="meta-k">分かれる</span><ul class="st-branch">${st.branches.map(([c, t]) => `<li><span class="cond">${S.inline(c)}</span><span class="arr">→</span><span>${S.inline(t)}</span></li>`).join('')}</ul>`;
    const code = codeLine(d, st, sc.step);
    if (code) meta += `<span class="meta-k">コード</span><span>${code}</span>`;
    let extra = '';
    // Tasks.tick: say where its paper is opened when it is opened elsewhere.
    const host = S.N[b.node] && S.N[b.node].paper;
    if (host && !d.children[st.to]) {
      const open = S.scenes.find((x) => x.kind === 'paper' && S.D[x.diag].g.id === host);
      if (open) extra = `<p class="close-note">${esc(b.title)} の中の紙は <a href="#${open.id}" data-go="${open.id}">${S.chapterOf(open).no} 章で開く</a>。</p>`;
    }
    return `<div class="st-head"><span class="st-no">${esc(no)}</span><h3 class="st-verb">${S.inline(verb)}</h3><span class="st-kind">${S.edgeIcon(st.kind)}${esc(S.EDGE[st.kind])}</span></div>
      <p class="st-route">${boxChip(d, a)}<span class="arr">→</span>${boxChip(d, b)}</p>
      <p class="st-label">${S.inline(st.label)}</p>${notes}${dataBlock(st)}${meta ? `<div class="st-meta">${meta}</div>` : ''}${extra}`;
  }

  // ---------- Intro ----------
  function counts() {
    const c = {};
    for (const n of Object.values(S.N)) c[n.layer] = (c[n.layer] || 0) + 1;
    return c;
  }
  function heroBlock() {
    const nSteps = S.FLOWS.reduce((a, f) => a + f.steps.filter((s) => !s.alt).length, 0);
    return `<p class="kicker">${esc(S.A.title)}・読み物</p>
      <h1>層を下りて、<br>また上る</h1>
      <p class="dek">MyComputer は、アプリと SDK、OS サービス（MyOS）、カーネル（MyKernel）、その下のエミュレータ（MyEmulator）まで、上から下まで作った小さなコンピュータ。その地図に描かれた 2 つの流れを、1 手順ずつたどる。</p>
      <ul class="facts"><li><b>${Object.keys(S.N).length}</b>項目</li><li><b>${S.STACK.length}</b>層 ＋ 横断 ${S.CROSS.length}</li><li><b>${S.FLOWS.length}</b>流れ・${nSteps} 手順</li><li><b>${Object.keys(S.PAPERS).length}</b>枚の中の紙</li><li><b>${(S.A.traces || []).length}</b>回の記録</li></ul>
      <div class="howto"><span class="mouse" aria-hidden="true"></span><p>スクロールすると、${S.SIDE}の図が今の手順に寄っていきます。下線の語に触れると説明が出ます。<kbd>J</kbd> <kbd>K</kbd> でも 1 つずつ進めます。</p></div>`;
  }
  function layersBlock() {
    const c = counts();
    const items = S.STACK.map((l) => {
      const ex = Object.entries(S.N).filter(([, n]) => n.layer === l).slice(0, 4).map(([id]) => S.link(id)).join('、');
      return `<li class="T-${l}"><span class="nm">${esc(S.L[l].name)}</span><span class="sb">${esc(S.L[l].sub)}</span><span class="ct">${c[l] || 0} 項目</span><span class="ex">${ex}${(c[l] || 0) > 4 ? ' など' : ''}</span></li>`;
    }).join('');
    return `<p class="eyebrow">序</p><h2 class="lead-h">5 つの層を、上から積む</h2>
      <p>地図は、コードを層ごとに並べている。いちばん上がアプリ、いちばん下がエミュレータ。${S.SIDE}の点の 1 つが、地図の項目（関数、置き場、構造体など）1 つ。</p>
      <ul class="deflist">${items}</ul>`;
  }
  function crossBlock() {
    const c = counts();
    const items = S.CROSS.map((l) => {
      const ids = Object.keys(S.N).filter((id) => S.N[id].layer === l);
      return `<li class="T-${l}"><span class="nm">${esc(S.L[l].name)}</span><span class="sb">${esc(S.L[l].sub.replace(/^データの形）（/, 'データの形・'))}</span><span class="ct">${c[l] || 0} 項目</span><span class="ex">${ids.slice(0, 5).map((id) => S.link(id)).join('、')}${ids.length > 5 ? ' など' : ''}</span></li>`;
    }).join('');
    const pol = Object.keys(S.N).find((id) => S.N[id].layer === 'policy');
    return `<h2 class="lead-h">層をまたぐもの</h2>
      <p>層に収まらないものが 3 種類ある。層をまたいで共有するデータの形（契約）、いま誰が走っているかという実行の文脈、そして層の間の決まり（方針）。</p>
      <ul class="deflist">${items}</ul>
      ${pol ? `<div class="note T-none"><span class="note-h">決まり：${S.link(pol)}</span>${S.rich(S.N[pol].text)}</div>` : ''}`;
  }
  function routesBlock() {
    const items = S.chapters.map((ch) => {
      const d = S.D[ch.diag];
      const layers = [];
      for (const { st } of d.main) for (const id of [st.from, st.to]) { const l = d.box[id].layer; if (layers[layers.length - 1] !== l) layers.push(l); }
      return `<li><a href="#ch-${ch.id}" data-go="ch-${ch.id}"><span class="rn">${ch.no} 章・${esc(ch.tab)}</span><span class="rt">${esc(ch.title)}</span><span class="rd">${d.main.length} 手順。${layers.map((l) => S.L[l].name).join(' → ')}</span></a></li>`;
    }).join('');
    return `<h2 class="lead-h">2 つの流れ</h2>
      <p>${S.SIDE}の線は、それぞれの流れが手順ごとに、どの層からどの層へ動くかを描いたもの。点が 1 手順、点線は次の手順が別の箱から始まるところ。どちらも途中で層を下り、また上ってくる。</p>
      <ol class="route-list">${items}</ol>`;
  }

  // ---------- Chapters ----------
  function chapterBlock(ch) {
    const d = S.D[ch.diag], f = ch.flow;
    const kinds = [...new Set(f.steps.map((s) => s.kind))];
    const papers = Object.values(S.D).filter((x) => x.isPaper && x.chapter === ch.id);
    const layers = S.STACK.filter((l) => f.boxes.some((b) => b.layer === l));
    return `<header class="chap"><p class="chap-no">第 ${ch.no} 章</p><h2 class="chap-t">${esc(ch.tab)}</h2><p class="chap-d">${esc(ch.title)}</p></header>
      <ul class="facts"><li><b>${f.boxes.length}</b>箱</li><li><b>${d.main.length}</b>手順${d.alts.length ? `（ほかに、もしもの ${d.alts.length}）` : ''}</li><li><b>${layers.length}</b>層を通る</li>${papers.length ? `<li><b>${papers.length}</b>枚の中の紙</li>` : ''}</ul>
      <p>${S.SIDE}の図は、この章の道のり。1 行が 1 手順で、上から順に進む。左の線は、その手順がどの層からどの層へ動くかを描いている。行を押すと、その手順へ飛ぶ。</p>
      <p>この先は 1 手順ずつ、${S.SIDE}の図が地図の上でその手順の 2 つの箱に寄っていく。${papers.length ? '中の紙（寄り道）は、開かなくても読み進められる。' : ''}</p>
      <p class="legend-h">地図の矢印の種類</p>
      <ul class="legend">${kinds.map((k) => `<li>${S.edgeIcon(k)}${esc(S.EDGE_LONG[k])}</li>`).join('')}</ul>`;
  }
  function regionBlock(sc) {
    const d = S.D[sc.diag], r = d.g.regions.find((x) => x.node === sc.region), n = S.N[sc.region] || {};
    const first = d.g.regions[0].node === sc.region;
    const steps = d.main.filter(({ st }) => { const reg = S.regionOf(d, S.actorOf(d, st)); return reg && reg.node === sc.region; }).map(({ i }) => S.stepNo(d, i));
    return `${first ? '<p class="eyebrow">点線の枠：誰が走らせるか</p>' : ''}<h3 class="st-verb">${esc(r.label)}</h3>
      <p>${first ? '地図では、点線の枠が、その中の箱を誰が走らせているか（実行の文脈）を表す。${S.SIDE}の表では、その文脈の中で動く手順が明るく残る。' : ''}${n.run ? `この枠を走らせるのは<b>${esc(n.run)}</b>。` : ''}${steps.length ? `この枠の中の箱が動かすのは、手順 ${steps.join('・')}。` : ''}</p>
      <div class="note T-none"><span class="note-h">${S.link(sc.region)}</span>${S.rich(n.text)}</div>
      <p class="st-route" style="margin-top:14px">${r.boxes.map((id) => boxChip(d, d.box[id])).join('')}</p>`;
  }
  // A paper is a detour: its head stays in the text, its steps open on request.
  function paperBlock(sc) {
    const d = S.D[sc.diag], p = d.g, parent = S.D[d.parent], host = parent.box[d.host];
    const entry = p.entry && d.box[p.entry];
    const bands = p.bands.map((b) => `<li class="T-${S.toneOf(b.tone) || 'none'}"><b>${esc(b.name)}</b><span>${esc(b.sub)}</span></li>`).join('');
    const ports = Object.entries(p.ports || {}).map(([outer, box]) => `<b>${esc(d.box[box].title)}</b> が外の ${S.link(outer)} につながる`).join('。');
    const inner = Object.values(S.D).filter((x) => x.parent === d.id);
    const count = `${d.main.length} 手順${d.alts.length ? `（ほかに、もしもの ${d.alts.length}）` : ''}${inner.length ? `。中にもう 1 枚（${inner.map((x) => esc(S.boxName(d.box[x.host]))).join('、')}）` : ''}`;
    return `<p class="ph-k">寄り道・中をのぞく</p><h3 class="ph-t">${esc(p.title.replace(/ の中$/, ''))}<small> の中</small></h3>
      <p><span class="bchip inl T-${S.nodeTone(host.node) || 'none'}" data-node="${esc(host.node)}"><span class="mono">${esc(host.title)}</span></span> の箱には、もう 1 枚の地図（中の紙）がある。${count}。</p>
      <p class="ph-act"><button type="button" class="ph-toggle" data-toggle="${esc(d.id)}" aria-expanded="false"><span class="ph-open">中に入る</span><span class="ph-close">たたむ</span></button><span class="ph-skip">開かずに先へ進んでもよい。図は箱の中の紙を見せている。</span></p>
      <div class="ph-more"><p>図はその箱の中へ入っていく。紙の帯は層ではなく、次の ${p.bands.length} つ。</p>
      <ul class="bands">${bands}</ul>
      <p class="ports">${entry ? `入口は <b>${esc(entry.title)}</b>。` : ''}${ports ? ports + '。' : ''}</p></div>`;
  }
  function paperCloseBlock(sc) {
    const inner = S.D[sc.from], parent = S.D[sc.diag];
    const host = parent.box[inner.host];
    const ports = Object.entries(inner.g.ports || {}).filter(([outer]) => parent.g.boxes.some((b) => b.node === outer));
    const portTxt = ports.map(([outer, box]) => { const ob = parent.g.boxes.find((b) => b.node === outer); return `紙の中の <b>${esc(inner.box[box].title)}</b> は、外の <b>${esc(ob.title)}</b> につながっている`; }).join('。');
    return `<p class="close-note">紙を閉じて、${esc(host.title)} の外へ戻る。${portTxt ? portTxt + '。' : ''}</p>
      <p class="ph-act"><button type="button" class="ph-toggle" data-toggle="${esc(inner.id)}" aria-expanded="true"><span class="ph-close">紙をたたむ</span></button></p>`;
  }
  function recapBlock(sc) {
    const ch = S.chapterOf(sc), d = S.D[sc.diag];
    const items = d.main.map(({ st, i }) => `<li><a href="#${S.sid(d.id, i)}" data-go="${S.sid(d.id, i)}"><span class="rn">${S.stepNo(d, i)}</span><span class="rv">${S.inline(S.heading(d, st))}</span><span class="rr">${esc(d.box[st.from].title)} → ${esc(d.box[st.to].title)}${st.data ? `<span class="rd">渡すもの <b>${esc(st.data.label)}</b></span>` : ''}</span></a></li>`).join('');
    const next = S.chapters[ch.no];
    return `<p class="eyebrow">${ch.no} 章のまとめ</p><h3 class="lead-h">${esc(ch.tab)}の道のり</h3><ol class="recap">${items}</ol>
      ${next ? `<a class="next-ch" href="#ch-${next.id}" data-go="ch-${next.id}">次は ${next.no} 章「${esc(next.tab)}」 →</a>` : (S.TRACE ? `<a class="next-ch" href="#trace" data-go="trace-open">記録で見る →</a>` : '')}`;
  }

  // ---------- Card for a node ----------
  S.cardHTML = (id) => {
    const n = S.N[id];
    if (!n) return '';
    const tone = S.nodeTone(id) || 'none';
    const c = S.C.nodes[id];
    let h = `<div class="cd-meta"><span class="pill ly T-${tone}">${esc((S.L[n.layer] || {}).name || n.layer)}</span><span class="pill">${esc(S.KIND[n.kind] || n.kind)}</span>${c ? `<span class="src">${esc(fileName(c.path))}:${c.start}</span>` : ''}</div>`;
    h += `<h4 class="cd-title${S.codeLike(n.title) ? ' mono' : ''}">${esc(n.title)}</h4>`;
    if (n.api && n.api.sig) h += `<pre class="cd-sig">${esc(n.api.sig)}</pre>`;
    if (n.api && n.api.params) h += `<table class="cd-t">${n.api.params.map(([p, m]) => `<tr><td class="c">${esc(p)}</td><td>${S.inline(m)}</td></tr>`).join('')}${n.api.ret ? `<tr><td class="c">戻り値</td><td>${S.inline(n.api.ret)}</td></tr>` : ''}</table>`;
    else if (n.api && n.api.ret) h += `<table class="cd-t"><tr><td class="c">戻り値</td><td>${S.inline(n.api.ret)}</td></tr></table>`;
    h += `<div class="cd-text">${S.rich(n.text, { deep: true })}</div>`;
    if (n.fields && n.kind !== 'hw') h += `<p class="cd-h">中身</p><table class="cd-t">${n.fields.map(([t, f, m]) => `<tr><td class="ty">${esc(t)}</td><td class="c">${esc(f)}</td><td>${S.inline(m)}</td></tr>`).join('')}</table>`;
    if (n.fields && n.kind === 'hw') h += `<p class="cd-h">ビット</p><table class="cd-t">${n.fields.map(([t, f, m]) => `<tr><td class="ty">${esc(t)}</td><td class="c">${esc(f)}</td><td>${S.inline(m)}</td></tr>`).join('')}</table>`;
    if (n.values) h += `<p class="cd-h">値</p><table class="cd-t">${n.values.map(([v, m]) => `<tr><td class="c">${esc(v)}</td><td>${S.inline(m)}</td></tr>`).join('')}</table>`;
    if (n.shape) h += `<p class="cd-h">形</p><p>${esc({ ring: 'リング', table: '表', tree: '木', list: 'リスト' }[n.shape.kind] || n.shape.kind || '')}${n.shape.of ? `（${S.link(n.shape.of)} と同じ）` : ''}${n.shape.roles ? '：' + Object.values(n.shape.roles).map((r) => esc([r.name, r.num, r.unit].filter((x) => x != null).join(' ') || r.text || '')).filter(Boolean).join('、') : ''}</p>`;
    if (n.ops) h += `<p class="cd-h">操作</p><table class="cd-t">${n.ops.map((o) => `<tr><td class="c">${S.inline(o.name)}</td><td>${esc(o.kind || '')}${o.cost ? `・${esc(o.cost)}` : ''}<br>${S.inline(o.text)}</td></tr>`).join('')}</table>`;
    if (n.invariants) h += `<p class="cd-h">いつも成り立つこと</p>${n.invariants.map((x) => `<p>${S.inline(x)}</p>`).join('')}`;
    if (n.states) h += `<p class="cd-h">状態の移り変わり（${esc(n.states.field)}）</p><table class="cd-t">${n.states.moves.map((m) => `<tr><td class="c">${esc(m.from)} → ${esc(m.to)}</td><td class="mono" style="font-size:12px">${esc(m.fns.join(', '))}</td></tr>`).join('')}</table>`;
    const uses = S.uses[id] || [];
    if (uses.length) h += `<p class="cd-h">この読み物で出てくる所</p><div class="cd-uses">${uses.slice(0, 12).map((u) => `<a href="#${u.scene}" data-go="${u.scene}">${esc(u.label)}</a>`).join('')}</div>`;
    if (S.traceUses && S.traceUses[id]) h += `<p class="cd-foot">記録の中で ${S.traceUses[id]} 回入っている。</p>`;
    return h;
  };

  // ---------- Index of every node ----------
  function indexHTML() {
    const groups = [...S.STACK, ...S.CROSS].map((l) => {
      const ids = Object.keys(S.N).filter((id) => S.N[id].layer === l);
      if (!ids.length) return '';
      const tone = S.STACK.includes(l) ? l : 'none';
      return `<section class="ix-layer T-${tone}"><h3>${esc(S.L[l].name)}<span>${esc(S.L[l].sub.replace(/^データの形）（/, 'データの形・'))}・${ids.length}</span></h3><div class="ix-grid">${ids.map((id) => {
        const n = S.N[id], u = (S.uses[id] || []).length;
        return `<button type="button" class="ix-item T-${tone}" id="node-${esc(id)}" data-node="${esc(id)}"><span class="ix-top"><span class="ix-t${S.codeLike(n.title) ? ' mono' : ''}">${esc(n.title)}</span><span class="ix-k">${esc(S.KIND[n.kind] || n.kind)}</span></span><span class="ix-x">${esc(S.plain(n.text).replace(/\n/g, ' '))}</span>${u ? `<span class="ix-u">読み物で ${u} か所</span>` : ''}</button>`;
      }).join('')}</div></section>`;
    }).join('');
    return `<h2 class="index-h" id="index-h">索引：地図の全部</h2><p class="index-d">流れに出てこないものも含めて、地図の ${Object.keys(S.N).length} 項目を層ごとに並べた。押すと説明が出る。</p>${groups}`;
  }

  // ---------- Build the column ----------
  S.Text = {
    render() {
      const col = document.getElementById('text');
      const parts = [];
      const seenByChapter = {};
      let open = [];   // stack of open asides
      const closeTo = (depth) => { while (open.length > depth) { parts.push('</section>'); open.pop(); } };
      for (const sc of S.scenes) {
        const seen = (seenByChapter[sc.chapter || 'intro'] = seenByChapter[sc.chapter || 'intro'] || new Set());
        let body = '', cls = sc.kind;
        if (sc.kind === 'hero') { body = heroBlock(); cls = 'hero'; }
        else if (sc.kind === 'layers') body = layersBlock();
        else if (sc.kind === 'cross') body = crossBlock();
        else if (sc.kind === 'routes') body = routesBlock();
        else if (sc.kind === 'chapter') body = chapterBlock(S.chapterOf(sc));
        else if (sc.kind === 'region') body = regionBlock(sc);
        else if (sc.kind === 'paper') {
          // The head of the paper, then its body (hidden until the reader opens it).
          parts.push(`<section class="paper-aside" data-paper="${esc(sc.diag)}">`); open.push('paper');
          parts.push(`<article class="scene paper" id="${esc(sc.id)}" data-scene="${sc.index}">${paperBlock(sc)}</article>`);
          parts.push(`<div class="paper-body" data-body="${esc(sc.diag)}" hidden>`);
          continue;
        } else if (sc.kind === 'paper-close') {
          // Close the alt aside if one is open, then the paper's body and the paper.
          while (open.length && open[open.length - 1] === 'alt') { parts.push('</section>'); open.pop(); }
          parts.push(`<article class="scene paper-close" id="${esc(sc.id)}" data-scene="${sc.index}">${paperCloseBlock(sc)}</article>`);
          parts.push('</div></section>'); open.pop();
          continue;
        } else if (sc.kind === 'alt') {
          if (sc.first) {
            const d = S.D[sc.diag], st = d.g.steps[sc.step];
            parts.push(`<section class="alt-aside"><p class="alt-h">もし${esc(st.alt.when)}なら</p><p class="alt-d">${S.stepNo(d, st.alt.at)} の代わりに、次のことが起きる。</p>`); open.push('alt');
          }
          body = stepBlock(sc, seen);
        } else if (sc.kind === 'step') {
          while (open.length && open[open.length - 1] === 'alt') { parts.push('</section>'); open.pop(); }
          body = stepBlock(sc, seen);
        } else if (sc.kind === 'recap') { closeTo(0); body = recapBlock(sc); }
        else if (sc.kind === 'trace' || sc.kind === 'trace-open') body = S.traceBlock ? S.traceBlock(sc) : '';
        parts.push(`<article class="scene ${cls}" id="${esc(sc.id)}" data-scene="${sc.index}">${body}</article>`);
        if (sc.kind === 'alt' && sc.last) { parts.push('</section>'); open.pop(); }
      }
      closeTo(0);
      col.innerHTML = parts.join('\n');
      document.getElementById('index').innerHTML = indexHTML();
    },
  };
})();
