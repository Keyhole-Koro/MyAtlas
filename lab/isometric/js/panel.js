// The side panel: the player, the card of the current step, and node cards.
import { A, KIND_JA, NODE_KIND_JA, node, linkParts, layerById, FLOOR_NO, threadOfCtx, appearances, containerOf, codeOfStep, codeOfNode, sheet } from "./model.js";
import { esc } from "./iso.js";

const panel = document.getElementById("panel");

/* --------------------------------------------------------------- text */
export function rich(text) {
  return linkParts(text || "").map((p) => {
    if (p.t != null) return esc(p.t).replace(/\n/g, "<br>");
    if (p.link) {
      const n = node(p.link);
      return n ? `<button class="nlink" data-node="${esc(p.link)}">${esc(n.title)}</button>` : esc(p.link);
    }
    const n = node(p.embed);
    if (!n) return "";
    if (n.figure) return `<figure class="fig"><div class="figsvg">${n.figure}</div><figcaption>${esc(n.title)}</figcaption></figure>`;
    return `<div class="embed"><button class="nlink" data-node="${esc(p.embed)}">${esc(n.title)}</button>${n.fields ? fieldsTable(n.fields, []) : ""}</div>`;
  }).join("");
}

function fieldsTable(fields, hi, schemaId) {
  const his = new Set(hi || []);
  return `<div class="fields">${fields.map((f) => {
    const [type, name, note] = f.length === 3 ? f : [f[0], f[1], f[2]];
    const on = his.has(name) || his.has(name.replace(/^\*/, "")) || [...his].some((h) => h.replace(/^\*/, "") === name.replace(/^\*/, ""));
    return `<div class="fr${on ? " on" : ""}"><div class="fh"><code class="fn">${esc(name)}</code><code class="ft">${linkType(type)}</code></div>${note ? `<div class="fd">${rich(note)}</div>` : ""}</div>`;
  }).join("")}</div>`;
}
function linkType(t) {
  // types that are nodes of the contract layer become links
  const hit = Object.entries(A.nodes).find(([id, n]) => n.layer === "contract" && n.title === t);
  return hit ? `<button class="nlink t" data-node="${hit[0]}">${esc(t)}</button>` : esc(t);
}

/* ------------------------------------------------------------- player */
export function playerHtml(sh, s, playing, ctx) {
  const total = sh.main.length;
  const dots = sh.main.map((m) => {
    const mark = m.altSteps?.length ? `<span class="altmark" aria-hidden="true"></span>` : "";
    const verb = m.verb || KIND_JA[m.kind] || "";
    return `<span class="dwrap"><button class="dot${s.index === m.index ? " cur" : ""}${m.index < s.index && !s.alt ? " done" : ""}" data-step="${m.index}" title="${esc(`${m.no} ${verb}`)}" aria-label="手順 ${m.no} ${esc(verb)}">${m.no}</button>${mark}</span>`;
  }).join("");
  // the steps that happen instead of one (the ring is full): their own row, with a name
  const altRows = sh.main.filter((m) => m.altSteps?.length).map((m) => {
    const when = m.altSteps[0].alt.when;
    const btns = m.altSteps.map((a, k) => `<button class="dot alt${s.index === a.index ? " cur" : ""}" data-step="${a.index}" title="${esc(a.verb || KIND_JA[a.kind] || "")}：${esc(a.label || "")}" aria-label="もし ${esc(when)} ${k + 1}">${k + 1}</button>`).join("");
    return `<div class="altrow"><span class="altl">もし${esc(when)}なら（${m.no} の代わり）</span>${btns}</div>`;
  }).join("");
  const pos = s.alt ? `もし ${esc(s.alt.when)}` : `${s.no} <small>/ ${total}</small>`;
  return `<div class="player">
    <div class="ptop">
      <div class="ptitle"><span class="pk">${sh.isPaper ? "中の紙" : "流れ"}</span><b>${esc(sh.title)}</b></div>
      <div class="ppos" aria-live="polite">${pos}</div>
    </div>
    <div class="pctl">
      <button class="pb" id="p-first" aria-label="最初へ" title="最初へ（Home）">⏮</button>
      <button class="pb" id="p-prev" aria-label="前の手順" title="前（←）">◀</button>
      <button class="pb main" id="p-play" aria-label="${playing ? "止める" : "再生"}" title="再生・止める（Space）">${playing ? "❚❚ 止める" : "▶ 順に流す"}</button>
      <button class="pb" id="p-next" aria-label="次の手順" title="次（→）">▶</button>
    </div>
    <div class="track" role="group" aria-label="手順">${dots}</div>
    ${altRows}
    ${ctx || ""}
  </div>`;
}

/* --------------------------------------------------------------- step */
export function stepHtml(sh, s, g) {
  const fb = sh.boxById[s.from], tb = sh.boxById[s.to];
  const fromN = node(fb?.node), toN = node(tb?.node);
  const thr = s.thread;
  const placeOf = (b) => {
    if (sh.isPaper) { const band = sh.bands.find((x) => x.id === b.layer); return band ? band.name : ""; }
    return `${FLOOR_NO[b.layer] || ""} ${layerById[b.layer]?.name || ""}`;
  };
  const regionOf = (b) => sh.regionOfBox?.[b.id];
  let h = `<article class="card step k-${s.kind}">`;
  h += `<div class="khead"><span class="kind k-${s.kind}">${esc(KIND_JA[s.kind] || s.kind)}</span>${s.alt ? `<span class="altk">もし ${esc(s.alt.when)}（${sh.steps[s.alt.at].no} の代わり）</span>` : ""}</div>`;
  h += `<h2>${esc(s.label || s.verb || "")}</h2>`;
  h += `<div class="ft2">
    <button class="mchip tone-${esc(fb.layer)}" data-box="${esc(fb.id)}"><span class="mt">${esc(fb.title)}</span><span class="ms">${esc(placeOf(fb))}${regionOf(fb) ? " ・ " + esc(regionOf(fb).label3 || regionOf(fb).label) : ""}</span></button>
    <span class="arr" aria-hidden="true">→</span>
    <button class="mchip tone-${esc(tb.layer)}" data-box="${esc(tb.id)}"><span class="mt">${esc(tb.title)}</span><span class="ms">${esc(placeOf(tb))}${regionOf(tb) ? " ・ " + esc(regionOf(tb).label3 || regionOf(tb).label) : ""}</span></button>
  </div>`;
  const doer = s.kind === "signal" ? "知らせるのは" : s.kind === "data" ? "読み書きするのは" : "運ぶのは";
  if (thr) h += `<p class="who"><span class="wdot th-${thr.key}"></span>${doer} <b>${esc(thr.name)}</b></p>`;
  else if (s.kind === "signal") h += `<p class="who"><span class="wdot spark"></span>${esc(fromN?.title || "")} が知らせる</p>`;
  // what is handed over
  if (s.data) {
    const d = s.data;
    const sch = d.schema ? node(d.schema) : null;
    h += `<section class="sec"><h3>渡すもの</h3><div class="parcelrow"><span class="pbox${/^&/.test(d.label || "") ? " addr" : ""}" aria-hidden="true"></span><code class="pl">${esc(d.label)}</code>${d.type ? `<span class="ptype">${esc(d.type)}</span>` : ""}</div>`;
    if (d.note) h += `<p class="note">${rich(d.note)}</p>`;
    if (sch?.fields) {
      const hw = sch.kind === "hw";
      const head = hw ? `<code>${esc(sch.title)}${sch.reg ? " · " + esc(sch.reg) : ""}</code>` : `<code>struct ${esc(sch.title)}</code>`;
      const rows = hw ? sch.fields.map(([bits, name, note]) => [`ビット ${bits}`, name, note]) : sch.fields;
      h += `<div class="schema"><div class="sh">${head}<button class="nlink" data-node="${esc(d.schema)}">${hw ? "時計を見る" : "形を見る"}</button>${d.fields ? `<span class="hint">この手順で使う ${d.fields.length} つに色</span>` : ""}</div>${fieldsTable(rows, d.fields)}</div>`;
    } else if (d.fields) {
      h += `<p class="flist">${d.fields.map((x) => `<code>${esc(x)}</code>`).join(" ")}</p>`;
    }
    h += `</section>`;
  }
  if (s.ops?.length) {
    h += `<section class="sec"><h3>置き場の操作</h3>${s.ops.map((o) => {
      const n = node(o.node);
      const op = n?.shape?.of ? node(n.shape.of)?.ops?.find((x) => x.kind === o.kind) : null;
      return `<p class="op"><button class="nlink" data-node="${esc(o.node)}">${esc(n?.title || o.node)}</button> に <b>${esc(o.kind)}</b>${op ? `：<code>${esc(op.name)}</code> ${esc(op.text)}（${esc(op.cost)}）` : ""}</p>`;
    }).join("")}</section>`;
  }
  if (s.branches?.length) {
    h += `<section class="sec"><h3>分かれ道</h3><ul class="branches">${s.branches.map(([w, t]) => `<li><span class="bw">${esc(w)}</span><span class="bt">${rich(t)}</span></li>`).join("")}</ul></section>`;
  }
  if (s.altSteps?.length) {
    const w = s.altSteps[0].alt.when;
    h += `<section class="sec altsec"><h3>もし ${esc(w)} なら</h3><ol class="altlist">${s.altSteps.map((a) => `<li><button class="alink" data-step="${a.index}"><b>${esc(a.verb || KIND_JA[a.kind])}</b>　${esc(a.label)}</button></li>`).join("")}</ol></section>`;
  }
  // a paper inside the machine this step reaches (or leaves)
  const paperOf = [tb, fb].map((b) => node(b.node)?.paper).find(Boolean);
  if (paperOf && A.papers[paperOf]) {
    const p = A.papers[paperOf];
    h += `<button class="enter" data-paper="${esc(paperOf)}"><span class="ei" aria-hidden="true"></span><span><b>中に入る：${esc(p.title)}</b><small>${p.steps.filter((x) => !x.alt).length} 手順の紙が、この箱の中にあります（Enter）</small></span></button>`;
  }
  const code = codeOfStep(sh.id, s.index);
  const def = codeOfNode(tb?.node);
  const ref = code ? { path: code.path, line: code.line, at: code.line } : def ? { path: def.path, line: def.start, at: def.start, end: def.end } : null;
  if (ref) {
    h += `<section class="sec"><h3>コード</h3><div class="code" data-path="${esc(ref.path)}" data-at="${ref.at}" data-from="${Math.max(1, ref.at - 3)}" data-to="${ref.at + 6}"><div class="cpath"><code>${esc(ref.path)}:${ref.at}</code>${code ? `<span class="cnote">この手順の行</span>` : `<span class="cnote">${esc(toN?.title || "")} の定義</span>`}</div><pre class="src">…</pre></div></section>`;
  }
  h += `</article>`;
  return h;
}

/* --------------------------------------------------------------- node */
export function nodeHtml(id, g, backLabel) {
  const n = node(id);
  if (!n) return "";
  const L = layerById[n.layer];
  const m = g?.machineOfNode?.(id);
  const room = m && g.rooms.find((r) => r.parts.some((p) => p.floor === m.floor && (p.all || (p.wing === m.wing && m.slot >= p.from && m.slot <= p.to))));
  let h = `<article class="card node tone-${esc(n.layer)}">`;
  h += `<button class="back" id="back-step">← ${esc(backLabel || "手順に戻る")}</button>`;
  h += `<div class="khead"><span class="nk">${esc(NODE_KIND_JA[n.kind] || n.kind)}</span><span class="nl"><i class="sw tone-${esc(n.layer)}"></i>${esc(FLOOR_NO[n.layer] ? FLOOR_NO[n.layer] + " " : "")}${esc(L?.name || n.layer)}</span>${room ? `<span class="nr th-${threadOfCtx(room.ctx)?.key}">${esc(node(room.ctx).title)}</span>` : ""}</div>`;
  h += `<h2 class="${/^[\x00-\x7F]+$/.test(n.title) ? "mono" : ""}">${esc(n.title)}</h2>`;
  if (n.fn && n.fn !== n.title) h += `<p class="fnname"><code>${esc(n.fn)}</code></p>`;
  if (n.run) h += `<p class="who"><span class="wdot th-${threadOfCtx(id)?.key}"></span>走るのは <b>${esc(n.run)}</b>${n.kernel ? "（カーネルの権限）" : ""}</p>`;
  h += `<div class="prose">${rich(n.text)}</div>`;
  if (n.api) {
    h += `<section class="sec"><h3>呼び方</h3><pre class="sig">${esc(n.api.sig)}</pre>`;
    if (n.api.params?.length) h += `<dl class="params">${n.api.params.map(([a, b]) => `<dt><code>${esc(a)}</code></dt><dd>${rich(b)}</dd>`).join("")}</dl>`;
    if (n.api.ret) h += `<p class="ret"><span>返す</span>${rich(n.api.ret)}</p>`;
    h += `</section>`;
  }
  if (n.fields && n.kind !== "hw") h += `<section class="sec"><h3>${n.kind === "schema" ? "中身" : "持っているもの"}</h3>${fieldsTable(n.fields, [])}</section>`;
  if (n.kind === "hw" && n.fields) h += `<section class="sec"><h3>ビット${n.reg ? `<code class="reg">${esc(n.reg)}</code>` : ""}</h3><div class="bits">${n.fields.map(([b, name, note]) => `<div class="bit"><code>${esc(b)}</code><b>${esc(name)}</b><span>${esc(note)}</span></div>`).join("")}</div></section>`;
  if (n.values) h += `<section class="sec"><h3>値</h3><div class="vals">${n.values.map(([v, t]) => `<div class="val"><code>${esc(v)}</code><span>${rich(t)}</span></div>`).join("")}</div></section>`;
  if (n.shape) h += shapeHtml(n);
  if (n.ops) h += `<section class="sec"><h3>操作</h3>${n.ops.map((o) => `<div class="opx"><div><code>${rich(o.name)}</code><span class="okind">${esc(o.kind)}</span><span class="ocost">${esc(o.cost || "")}</span></div><p>${rich(o.text)}</p></div>`).join("")}</section>`;
  if (n.invariants) h += `<section class="sec"><h3>いつも成り立つこと</h3><ul class="inv">${n.invariants.map((x) => `<li>${rich(x)}</li>`).join("")}</ul></section>`;
  if (n.states) h += `<section class="sec"><h3>状態の移り変わり <code>${esc(n.states.field)}</code></h3><ul class="moves">${n.states.moves.map((mv) => `<li><span>${esc(mv.from)}</span><i>→</i><span>${esc(mv.to)}</span><code>${mv.fns.map(esc).join("・")}</code></li>`).join("")}</ul></section>`;
  if (n.figure && n.kind === "figure") h += `<figure class="fig"><div class="figsvg">${n.figure}</div></figure>`;
  if (n.paper && A.papers[n.paper]) h += `<button class="enter" data-paper="${esc(n.paper)}"><span class="ei" aria-hidden="true"></span><span><b>中に入る：${esc(A.papers[n.paper].title)}</b><small>この箱の中の紙</small></span></button>`;
  const inside = containerOf(id);
  if (inside && inside !== n.paper) h += `<p class="inside">${g?.id === "main" && g.machineOfNode(id) ? "紙の中にも出てきます：" : "この箱がある紙："}<button class="nlink" data-paper-open="${esc(inside)}">${esc(A.papers[inside].title)}</button></p>`;
  const apps = appearances(id);
  if (apps.length) {
    h += `<section class="sec"><h3>出てくる手順</h3><ul class="apps">${apps.map((a) => `<li><span class="an">${esc(a.sheet.tab || a.sheet.title)}</span>${a.steps.map((s) => `<button class="sjump" data-sheet="${esc(a.sheet.id)}" data-step="${s.index}" title="${esc(s.label || "")}">${s.alt ? "もし" : s.no}</button>`).join("")}</li>`).join("")}</ul></section>`;
  }
  const c = codeOfNode(id);
  if (c) h += `<section class="sec"><h3>コード</h3><div class="code" data-path="${esc(c.path)}" data-at="${c.start}" data-from="${c.start}" data-to="${Math.min(c.end, c.start + 40)}" data-more="${c.end > c.start + 40 ? c.end : ""}"><div class="cpath"><code>${esc(c.path)}:${c.start}${c.end > c.start ? "–" + c.end : ""}</code><span class="cnote">${esc(c.symbol || "")}</span></div><pre class="src">…</pre></div></section>`;
  h += `</article>`;
  return h;
}

function shapeHtml(n) {
  let sh = n.shape;
  let via = "";
  if (sh.of) {
    via = `<p class="shof"><button class="nlink" data-node="${esc(sh.of)}">${esc(node(sh.of)?.title || sh.of)}</button> と同じ形です。</p>`;
    sh = node(sh.of)?.shape || sh;
    if (sh.of) return `<section class="sec"><h3>形</h3>${via}</section>`;
  }
  const kinds = { ring: "リング", table: "表", tree: "木", list: "リスト" };
  const R = sh.roles || {};
  const ROLE_JA = { n: "数", read: "読む位置", write: "書く位置", item: "1 枠", key: "鍵", empty: "空き", children: "子", parent: "親", order: "順", head: "先頭", next: "次", header: "頭", bump: "まだ渡していない先" };
  const roles = Object.entries(R).map(([k, v]) => `<div class="role"><span class="rk">${esc(ROLE_JA[k] || k)}</span>${v.name ? `<code>${esc(v.name)}</code>` : ""}${v.num ? `<b>${esc(v.num)}</b>${v.unit ? esc(v.unit) : ""}` : ""}${v.text ? `<span>${esc(v.text)}</span>` : ""}</div>`).join("");
  return `<section class="sec"><h3>形：${esc(kinds[sh.kind] || sh.kind)}</h3>${via}<div class="shape">${shapeSvg(sh)}</div><div class="roles">${roles}</div></section>`;
}

/** A schematic of the structure, drawn from its roles (positions are only an example). */
function shapeSvg(sh) {
  const R = sh.roles || {};
  const t = (x, y, s, cls = "", a = "middle") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${a}">${esc(s)}</text>`;
  if (sh.kind === "ring") {
    const n = R.n?.num || 16, cx = 170, cy = 92, r1 = 54, r2 = 76;
    const head = Math.round(n * 0.08), tail = Math.round(n * 0.3);
    let s = `<svg viewBox="0 0 340 186" role="img" aria-label="${n} 枠のリング">`;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.02;
      const p = (r, a) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
      const full = i >= head && i < tail;
      s += `<path class="seg${full ? " full" : ""}" d="M${p(r1, a0)} L${p(r2, a0)} A${r2},${r2} 0 0 1 ${p(r2, a1)} L${p(r1, a1)} A${r1},${r1} 0 0 0 ${p(r1, a0)} Z"/>`;
    }
    const mark = (i, label, side) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
      const x = cx + Math.cos(a) * (r2 + 14), y = cy + Math.sin(a) * (r2 + 14);
      return `<line class="ptr" x1="${(cx + Math.cos(a) * (r2 + 2)).toFixed(1)}" y1="${(cy + Math.sin(a) * (r2 + 2)).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>` + t((x + (side > 0 ? 6 : -6)).toFixed(1), (y + 4).toFixed(1), label, "pl", side > 0 ? "start" : "end");
    };
    s += mark(head, `${R.read?.name || "head"}（読む）`, 1) + mark(tail, `${R.write?.name || "tail"}（書く）`, 1);
    s += t(cx, cy - 4, `${R.n?.name || ""} ${n}`, "big") + t(cx, cy + 14, R.item ? `1 枠 ${R.item.num} ${R.item.unit || ""}` : "", "sm");
    return s + t(8, 180, "色の付いた枠：入っている通（例）", "sm", "start") + `</svg>`;
  }
  if (sh.kind === "tree") {
    const nodes = [[170, 26], [96, 82], [244, 82], [56, 140], [136, 140], [244, 140]];
    const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]];
    let s = `<svg viewBox="0 0 340 186" role="img" aria-label="木">`;
    for (const [a, b] of edges) s += `<line class="edge" x1="${nodes[a][0]}" y1="${nodes[a][1] + 12}" x2="${nodes[b][0]}" y2="${nodes[b][1] - 12}"/>`;
    nodes.forEach(([x, y], i) => (s += `<rect class="tn${i === 0 ? " root" : ""}" x="${x - 30}" y="${y - 12}" width="60" height="24" rx="5"/>` + t(x, y + 4, R.n?.name || "Node", "sm")));
    s += t(300, 60, R.children?.name || "children", "pl") + `<line class="ptr" x1="276" y1="64" x2="254" y2="72"/>`;
    s += t(18, 60, R.parent?.name || "parent", "pl", "start") + `<line class="ptr" x1="44" y1="64" x2="74" y2="74"/>`;
    return s + t(8, 180, `${R.n?.name || ""} ${R.n?.num ? "最大 " + R.n.num : ""}${R.order?.text ? "・子は" + R.order.text : ""}`, "sm", "start") + `</svg>`;
  }
  if (sh.kind === "table") {
    const n = R.n?.num || 8;
    let s = `<svg viewBox="0 0 340 186" role="img" aria-label="${n} 行の表">`;
    const rows = ["0", "1", "2", "…", String(n - 1)];
    rows.forEach((r, i) => (s += `<rect class="row${i === 1 ? " full" : ""}" x="96" y="${16 + i * 30}" width="200" height="26" rx="4"/>` + t(86, 34 + i * 30, r, "sm", "end")));
    s += t(196, 64, R.n?.name ? `${R.n.name}[${R.key?.name || "i"}]` : "", "pl");
    s += t(52, 14, R.key?.name || "", "sm", "middle");
    return s + t(8, 180, `${R.n?.num || ""} 行${R.empty?.name ? "・使っていない枠は " + R.empty.name : ""}`, "sm", "start") + `</svg>`;
  }
  if (sh.kind === "list") {
    let s = `<svg viewBox="0 0 340 186" role="img" aria-label="リスト">`;
    s += t(30, 50, R.head?.name || "head", "pl", "middle") + `<line class="ptr arrow" x1="30" y1="58" x2="30" y2="84"/>`;
    [0, 1, 2].forEach((k) => {
      const x = 8 + k * 112;
      s += `<rect class="tn" x="${x}" y="86" width="86" height="40" rx="5"/>`;
      if (R.header) s += `<rect class="hdr" x="${x}" y="86" width="22" height="40" rx="5"/>`;
      if (k < 2) s += `<line class="ptr arrow" x1="${x + 86}" y1="106" x2="${x + 110}" y2="106"/>`;
    });
    s += t(170, 148, R.next?.name || R.next?.text || "", "sm");
    if (R.bump) s += t(330, 76, `${R.bump.name}：まだ渡していない先`, "sm", "end");
    return s + t(8, 180, `${R.header ? `頭 ${R.header.name} ${R.header.num || ""} B・` : ""}${R.order?.text ? R.order.text + "の順" : ""}`, "sm", "start") + `</svg>`;
  }
  return "";
}

/* --------------------------------------------------------------- code */
const cache = {};
export async function fillCode(root) {
  for (const el of root.querySelectorAll(".code[data-path]")) {
    const path = el.dataset.path;
    const pre = el.querySelector(".src");
    try {
      cache[path] ||= fetch(`../data/src/${path}`).then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
      const lines = (await cache[path]).split("\n");
      const from = +el.dataset.from, to = Math.min(lines.length, +el.dataset.to), at = +el.dataset.at;
      const lang = path.endsWith(".rs") ? "rs" : "mln";
      let st = { block: false };
      // carry block-comment state from the start of the file
      for (let i = 0; i < from - 1; i++) hl(lines[i], st, lang);
      let out = "";
      for (let i = from; i <= to; i++) out += `<span class="ln${i === at ? " at" : ""}"><i>${i}</i>${hl(lines[i - 1] ?? "", st, lang)}</span>`;
      if (el.dataset.more) out += `<span class="ln more"><i></i>… ${el.dataset.more} 行目まで</span>`;
      pre.innerHTML = out;
    } catch {
      pre.textContent = "（ソースを読めませんでした）";
    }
  }
}
const KW = new Set("void i8 i16 i32 i64 u8 u16 u32 u64 bool char str if else while for return export import struct enum match let mut const true false Some None Option Result borrow move self Self fn pub impl use mod as in break continue unsafe extern static syscall type where loop".split(" "));
function hl(line, st, lang) {
  let out = "", i = 0;
  const n = line.length;
  while (i < n) {
    if (st.block) {
      const e = line.indexOf("*/", i);
      const j = e < 0 ? n : e + 2;
      out += `<span class="c">${esc(line.slice(i, j))}</span>`;
      i = j;
      if (e >= 0) st.block = false;
      continue;
    }
    const ch = line[i];
    if (line.startsWith("//", i)) { out += `<span class="c">${esc(line.slice(i))}</span>`; break; }
    if (line.startsWith("/*", i)) { st.block = true; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      out += `<span class="s">${esc(line.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_]/.test(line[i - 1] || "")) {
      const m = /^(0x[0-9a-fA-F_]+|[0-9][0-9_]*)/.exec(line.slice(i));
      out += `<span class="n">${esc(m[0])}</span>`; i += m[0].length; continue;
    }
    if (/[A-Za-z_@]/.test(ch)) {
      const m = /^[@A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
      const w = m[0];
      const nextCh = line[i + w.length];
      out += KW.has(w) ? `<span class="k">${w}</span>` : w[0] === "@" ? `<span class="a">${w}</span>` : nextCh === "(" ? `<span class="f">${w}</span>` : /^[A-Z][A-Z0-9_]+$/.test(w) ? `<span class="cst">${w}</span>` : esc(w);
      i += w.length; continue;
    }
    out += esc(ch); i++;
  }
  return out;
}

export { panel };
