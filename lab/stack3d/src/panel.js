// The panel beside the 3D view: the current step in words, what is handed over, the list of
// steps, and the card of a node. All text comes from the map.
import * as D from "./data.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SHAPE_NAME = { ring: "リング（輪の列）", table: "表", tree: "木", list: "つないだリスト" };
const ROLE_NAME = {
  n: "数", read: "読む位置", write: "書く位置", item: "1 つ分", key: "鍵", head: "先頭", next: "次へのつなぎ",
  header: "頭", order: "順番", children: "子", parent: "親", empty: "空き", bump: "まだ渡していない先頭",
};

function nodeTitle(id) {
  return D.NODES[id]?.title || id;
}
export function nodeLink(id, label) {
  if (!D.NODES[id]) return `<span class="mono">${esc(label || id)}</span>`;
  return `<button class="nodelink" data-node="${esc(id)}" title="${esc(id)}">${esc(label || nodeTitle(id))}</button>`;
}

// Prose with [[links]] and ![[embeds]]; newlines are paragraphs.
export function prose(text, opts = {}) {
  return String(text || "").split("\n").filter((p) => p.trim()).map((para) => {
    const parts = D.parseText(para);
    if (parts.length === 1 && parts[0].t === "embed") return embed(parts[0].v);
    return `<p>${parts.map((p) => (p.t === "text" ? esc(p.v) : p.t === "link" ? nodeLink(p.v) : embed(p.v))).join("")}</p>`;
  }).join("") || (opts.empty ? `<p class="note">${esc(opts.empty)}</p>` : "");
}

function embed(id) {
  const n = D.NODES[id];
  if (!n) return "";
  if (n.figure) return `<div class="embed"><div class="et">${esc(n.title)}</div>${n.figure}${n.text ? `<div class="note">${prose(n.text)}</div>` : ""}</div>`;
  return `<div class="embed"><div class="et">${nodeLink(id)}　${esc(D.KIND_NAME[n.kind] || "")}</div>${n.fields ? fieldsTable(n.fields) : `<div class="note">${prose(n.text)}</div>`}</div>`;
}

function typeCell(ty) {
  const m = String(ty).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  if (m && D.SCHEMA_BY_NAME[m[1]]) return nodeLink(D.SCHEMA_BY_NAME[m[1]], ty);
  return esc(ty);
}

function fieldsTable(fields, on = []) {
  return `<div class="struct">${fields.map(([ty, nm, me]) => `<div class="fl${on.includes(nm) ? " on" : ""}"><span class="nm">${esc(nm)}</span><span class="ty">${typeCell(ty)}</span>${me ? `<span class="me">${prose(me).replace(/^<p>|<\/p>$/g, "")}</span>` : ""}</div>`).join("")}</div>`;
}

export function structBlock(schemaId, on = []) {
  const n = D.NODES[schemaId];
  if (!n || !n.fields) return "";
  const word = n.kind === "hw" ? "1 語" : "struct";
  return `<div class="struct"><div class="hd">${word} ${esc(n.title)}<span>${on.length ? `渡るのは色の付いた ${on.length} つ` : ""}</span></div>${n.fields.map(([ty, nm, me]) => `<div class="fl${on.includes(nm) ? " on" : ""}"><span class="nm">${esc(nm)}</span><span class="ty">${typeCell(ty)}</span>${me ? `<span class="me">${prose(me).replace(/^<p>|<\/p>$/g, "")}</span>` : ""}</div>`).join("")}</div>`;
}

const layerColor = (tone) => `var(--l-${tone})`;

function boxChip(scene, boxId) {
  const b = scene.box[boxId];
  if (!b) return "";
  const band = scene.bands.find((x) => x.id === b.band);
  return `<button class="boxchip" style="--c:${layerColor(band?.tone)}" data-box="${esc(boxId)}"><span class="t">${esc(b.title)}</span><span class="s">${esc(band?.name || "")}${b.ns ? `・${esc(b.ns)}` : ""}</span></button>`;
}

// The kinds of step as the tubes draw them: thickness, dashes, and the start (a collar for a
// syscall, a bead for a data step, like the dot the map puts there).
export function kindIcon(kind, color = "currentColor") {
  const dash = { return: "5 4", msg: "10 4", signal: "2 4", data: "", call: "", syscall: "" }[kind] ?? "";
  const w = kind === "syscall" ? 3.2 : kind === "call" ? 2.4 : kind === "data" ? 1.4 : 1.8;
  return `<svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"><line x1="${kind === "data" ? 6 : 2}" y1="5" x2="26" y2="5" stroke="${color}" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"/>${kind === "syscall" ? `<rect x="1" y="2" width="5" height="6" fill="${color}"/>` : ""}${kind === "data" ? `<circle cx="4.5" cy="5" r="3.2" fill="${color}"/>` : ""}<path d="M25 1.5 L32 5 L25 8.5 Z" fill="${color}"/></svg>`;
}
const lineRange = (c) => `${c.start}${c.end && c.end !== c.start ? `–${c.end}` : ""}`;

function verbOf(st) {
  return st.verb || D.STEP_KIND_SHORT[st.kind] || "";
}

// ---------- the current step ----------
export function stepView(scene, i, opts = {}) {
  const st = scene.steps[i];
  if (!st) return "";
  const main = scene.steps.filter((s) => !s.alt);
  const pos = st.alt ? null : main.findIndex((s) => s.i === i);
  const prevOk = st.alt ? true : pos > 0, nextOk = st.alt ? true : pos < main.length - 1;
  let h = `<section class="step" aria-live="polite">`;
  h += `<div class="st-head"><span class="st-no${st.alt ? " alt" : ""}">${st.alt ? esc(st.name) : `手順 ${st.num}`}</span><span class="st-of">${st.alt ? `もし${esc(st.alt.when)}（${esc(scene.steps[st.alt.at]?.name)} の代わり）` : `${main.length} のうち`}</span>`;
  h += `<span class="st-nav"><button data-act="prev" ${prevOk ? "" : "disabled"} aria-label="前の手順">←</button><button data-act="next" ${nextOk ? "" : "disabled"} aria-label="次の手順">→</button></span></div>`;
  h += `<div class="st-verb">${esc(verbOf(st))}</div>`;
  h += `<div class="kindchip">${kindIcon(st.kind)}${esc(D.STEP_KIND[st.kind] || st.kind)}</div>`;
  h += `<div class="st-label">${prose(st.label).replace(/^<p>|<\/p>$/g, "")}</div>`;
  h += `<div class="ft">${boxChip(scene, st.from)}<span class="arrow">→</span>${boxChip(scene, st.to)}</div>`;
  if (st.data) {
    const d = st.data;
    h += `<div class="row"><span class="k">渡すもの</span><span class="v">${d.schema ? nodeLink(d.schema, d.label) : `<b class="mono">${esc(d.label)}</b>`}${d.type ? `<div class="note mono">${esc(d.type)}</div>` : ""}${d.note ? `<div class="note">${prose(d.note).replace(/^<p>|<\/p>$/g, "")}</div>` : ""}</span></div>`;
    if (d.schema && D.NODES[d.schema]?.fields) h += structBlock(d.schema, d.fields || []);
    else if (d.fields) h += `<div class="note">中身：${d.fields.map(esc).join("、")}</div>`;
  }
  if (st.ops) {
    for (const op of st.ops) {
      const n = D.NODES[op.node];
      const shapeOf = n?.shape?.of ? D.NODES[n.shape.of] : n;
      const o = shapeOf?.ops?.find((x) => x.kind === op.kind);
      h += `<div class="row"><span class="k">列の操作</span><span class="v"><b>${esc(op.kind)}</b>（${nodeLink(op.node)}${n?.shape?.of ? ` は ${nodeLink(n.shape.of)} の 1 本` : ""}）${o ? `<div class="note"><span class="mono">${esc(o.name)}</span>：${esc(o.text)}（${esc(o.cost)}）</div>` : ""}</span></div>`;
    }
  }
  if (st.branches) {
    h += `<div class="row"><span class="k">分かれる</span><span class="v"><ul class="branches">${st.branches.map(([when, then]) => `<li><b>${esc(when)}</b><span>${prose(then).replace(/^<p>|<\/p>$/g, "")}</span></li>`).join("")}</ul></span></div>`;
  }
  const alts = scene.steps.filter((s) => s.alt && s.alt.at === i);
  if (alts.length) {
    h += `<div class="row"><span class="k">もし${esc(alts[0].alt.when)}</span><span class="v">${alts.map((s) => `<button class="link" data-step="${s.i}">${esc(s.name)}：${esc(verbOf(s))}</button>`).join("　")}<div class="note">この手順の代わりに起きること</div></span></div>`;
  }
  const loc = D.codeOfStep(scene.id, i);
  const ref = st.ref && D.NODES[st.ref] ? st.ref : null;
  const refCode = ref ? D.codeOf(ref) : null;
  if (loc) h += `<div class="row"><span class="k">コード</span><span class="v"><button class="link mono" data-code="${esc(loc.path)}|${loc.line}|${loc.line}|${loc.line}">${esc(loc.path.split("/").pop())}:${loc.line}</button><div class="codeline">${esc(loc.path)}</div></span></div>`;
  else if (refCode) h += `<div class="row"><span class="k">コード</span><span class="v"><button class="link mono" data-code="${esc(refCode.path)}|${refCode.start}|${refCode.end}|">${esc(refCode.path.split("/").pop())}:${lineRange(refCode)}</button><div class="codeline">${esc(refCode.symbol || "")}（${nodeLink(ref)} の定義）</div></span></div>`;
  if (ref) h += `<div class="row"><span class="k">説明</span><span class="v">${nodeLink(ref)}</span></div>`;
  // papers reachable from this step
  const papers = [];
  for (const id of [st.ref, scene.box[st.to]?.node, scene.box[st.from]?.node]) {
    const p = id && D.paperOf(id);
    if (p && !papers.some((x) => x.p === p)) papers.push({ p, node: id });
  }
  for (const { p, node } of papers) {
    h += `<div class="paperbox"><span class="ic"></span><span class="tx"><b>${esc(p.title)}</b>${esc(nodeTitle(node))} には中の紙があります</span><button class="btn primary" data-paper="${esc(node)}">中へ ↘</button></div>`;
  }
  h += `</section>`;
  return h;
}

// The list of steps. The map's own starting step (`start`, where the main viewer opens) is marked.
export function stepList(scene, cur, past) {
  let h = `<section><h3>手順の一覧</h3><ol class="steps">`;
  const mapStart = scene.start?.[0];
  for (const s of scene.steps) {
    const cls = [s.alt ? "alt" : "", s.i === cur ? "on" : "", past.has(s.i) ? "past" : ""].filter(Boolean).join(" ");
    const a = scene.box[s.from], b = scene.box[s.to];
    const tag = s.i === mapStart ? `<span class="maptag" title="文書マップ（いまのビューア）は、この手順から見せます">地図の始点</span>` : "";
    h += `<li class="${cls}"><button data-step="${s.i}"><span class="n">${esc(s.alt ? s.name : s.num)}</span><span class="tx"><b>${esc(verbOf(s))}</b>${tag}<span class="ft2">${esc(a?.short || a?.title || s.from)} → ${esc(b?.short || b?.title || s.to)}</span></span></button></li>`;
  }
  return h + `</ol></section>`;
}

// ---------- every node of the map, by layer ----------
export function nodeIndex(openLayer) {
  const inScene = new Set();
  for (const sc of [...D.FLOWS, ...Object.values(D.PAPER_SCENES)]) for (const b of sc.boxes) inScene.add(b.node);
  const total = Object.keys(D.NODES).length;
  let h = `<section class="index"><h3>地図の部品（全 ${total}）</h3><p class="note" style="margin:-4px 0 10px">流れと中の紙に出てこない部品も、ここから説明を開けます。●は流れか紙に積み木として出てくるもの。</p>`;
  for (const l of D.ATLAS.layers) {
    const ids = Object.keys(D.NODES).filter((k) => D.NODES[k].layer === l.id);
    if (!ids.length) continue;
    const c = l.cross ? "var(--text-3)" : `var(--l-${l.id})`;
    h += `<details${openLayer === l.id ? " open" : ""}><summary><span class="sw" style="background:${c}"></span>${esc(l.name)}<span class="cnt">${ids.length}</span><span class="sub">${esc(l.sub)}</span></summary><div class="chips">`;
    h += ids.map((id) => `<button class="ichip${inScene.has(id) ? " on" : ""}" data-node="${esc(id)}" title="${esc(D.KIND_NAME[D.NODES[id].kind] || "")}">${inScene.has(id) ? "<i>●</i>" : ""}${esc(D.NODES[id].title)}</button>`).join("");
    h += `</div></details>`;
  }
  return h + `</section>`;
}

// ---------- a node ----------
export function nodeView(nodeId, ctx) {
  const n = D.NODES[nodeId];
  if (!n) return "";
  const layer = D.LAYER[n.layer];
  let h = `<section class="ncard">`;
  h += `<div class="top2"><span class="tagk">${esc(D.KIND_NAME[n.kind] || n.kind)}</span>${layer ? `<span class="tagl" style="--c:${layer.cross ? "var(--text-3)" : `var(--l-${layer.id})`}">${esc(layer.name)}</span>` : ""}<button class="btn x" data-act="close-node" aria-label="閉じる">× 手順に戻る</button></div>`;
  h += `<h2>${esc(n.title)}</h2>`;
  if (n.fn && n.fn !== n.title) h += `<div class="note mono" style="margin:-6px 0 10px">${esc(n.fn)}</div>`;
  if (n.api?.sig) h += `<pre class="sig">${esc(n.api.sig)}</pre>`;
  if (n.api?.params?.length) h += `<div class="params">${n.api.params.map(([p, m]) => `<span class="pn">${esc(p)}</span><span>${prose(m).replace(/^<p>|<\/p>$/g, "")}</span>`).join("")}</div>`;
  if (n.api?.ret) h += `<div class="row"><span class="k">返す</span><span class="v">${esc(n.api.ret)}</span></div>`;
  if (n.reg) h += `<div class="row"><span class="k">番地</span><span class="v mono">${esc(n.reg)}</span></div>`;
  if (n.run) h += `<div class="row"><span class="k">走るもの</span><span class="v">${esc(n.run)}${n.kernel ? "（カーネルの権限）" : ""}</span></div>`;
  h += `<div class="prose">${prose(n.text)}</div>`;
  if (n.paper && D.PAPER_SCENES[n.paper]) {
    const p = D.PAPER_SCENES[n.paper];
    h += `<div class="paperbox"><span class="ic"></span><span class="tx"><b>${esc(p.title)}</b>${p.steps.filter((s) => !s.alt).length} の手順の中の紙</span><button class="btn primary" data-paper="${esc(nodeId)}">中へ ↘</button></div>`;
  }
  if (n.fields) h += `<h3 style="margin-top:16px">中身</h3>${fieldsTable(n.fields)}`;
  if (n.values) h += `<h3 style="margin-top:16px">値</h3><table class="tbl">${n.values.map(([v, m]) => `<tr><td class="m">${esc(v)}</td><td class="d">${prose(m).replace(/^<p>|<\/p>$/g, "")}</td></tr>`).join("")}</table>`;
  if (n.shape) {
    const sh = n.shape.of ? D.NODES[n.shape.of]?.shape : n.shape;
    h += `<h3 style="margin-top:16px">形</h3>`;
    if (n.shape.of) h += `<div class="note">${nodeLink(n.shape.of)} の 1 本</div>`;
    if (sh) {
      h += `<div class="row"><span class="k">種類</span><span class="v">${esc(SHAPE_NAME[sh.kind] || sh.kind)}</span></div>`;
      const roles = Object.entries(sh.roles || {});
      if (roles.length) h += `<table class="tbl">${roles.map(([k, r]) => `<tr><td class="d">${esc(ROLE_NAME[k] || k)}</td><td class="m">${esc(r.name || "")}${r.num ? `（${esc(r.num)}${esc(r.unit || "")}）` : ""}${r.text ? `<span class="d">${esc(r.text)}</span>` : ""}</td></tr>`).join("")}</table>`;
    }
  }
  const ops = n.ops || (n.shape?.of ? D.NODES[n.shape.of]?.ops : null);
  if (ops) h += `<h3 style="margin-top:16px">操作</h3><table class="tbl">${ops.map((o) => `<tr><td class="m">${o.node ? nodeLink(o.node, o.name.replace(/\[\[|\]\]/g, "")) : esc(o.name)}<div class="d" style="font-family:var(--font-sans)">${esc(o.kind)}・${esc(o.cost)}</div></td><td class="d">${esc(o.text)}</td></tr>`).join("")}</table>`;
  if (n.invariants) h += `<h3 style="margin-top:16px">いつも成り立つこと</h3>${n.invariants.map((x) => `<p class="note">${esc(x)}</p>`).join("")}`;
  if (n.states) h += `<h3 style="margin-top:16px">移り変わり（${esc(n.states.field)}）</h3><table class="tbl">${n.states.moves.map((m) => `<tr><td class="m">${esc(m.from)} → ${esc(m.to)}</td><td class="d mono">${m.fns.map(esc).join(", ")}</td></tr>`).join("")}</table>`;
  const code = D.codeOf(nodeId);
  if (code) h += `<div class="row" style="margin-top:14px"><span class="k">コード</span><span class="v"><button class="link mono" data-code="${esc(code.path)}|${code.start}|${code.end}|">${esc(code.path.split("/").pop())}:${lineRange(code)}</button><div class="codeline">${esc(code.path)}${code.symbol ? ` の ${esc(code.symbol)}` : ""}</div></span></div>`;
  else if (n.code) h += `<div class="row"><span class="k">コード</span><span class="v codeline">${esc(n.code[0])}${n.code[1] ? ` の ${esc(n.code[1])}` : ""}</span></div>`;
  if (ctx?.uses?.length) h += `<div class="row"><span class="k">この流れで</span><span class="v uses">${ctx.uses.map((s) => `<button class="btn" data-step="${s.i}">${s.alt ? esc(s.name) : `手順 ${s.num}`}：${esc(verbOf(s))}</button>`).join("")}</span></div>`;
  if (ctx?.elsewhere?.length) h += `<div class="row"><span class="k">ほかの紙</span><span class="v uses">${ctx.elsewhere.map((e) => `<button class="btn" data-goto="${esc(e.path)}" data-gotobox="${esc(e.box)}">${esc(e.title)}</button>`).join("")}</span></div>`;
  h += `</section>`;
  return h;
}

// ---------- source viewer ----------
const KW = new Set("fn let mut pub struct enum impl use mod return if else while for in match break continue const static unsafe import export void i32 u32 u8 i64 bool str char true false None Some Self self syscall borrow move as loop type Option Result case of defer".split(" "));
// A small tokenizer: comments, strings, words and numbers, each escaped on its own.
function highlight(line) {
  const re = /(\/\/.*$|\/\*.*?\*\/|^\s*\*.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(0x[0-9a-fA-F]+|\d+)\b|([A-Za-z_][A-Za-z0-9_]*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index));
    if (m[1]) out += `<span class="cm">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="st">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="nu">${esc(m[3])}</span>`;
    else out += KW.has(m[4]) ? `<span class="kw">${esc(m[4])}</span>` : esc(m[4]);
    last = re.lastIndex;
  }
  return out + esc(line.slice(last));
}
export async function showCode(modal, path, start, end, hot, title) {
  modal.hidden = false;
  modal.innerHTML = `<div class="win" role="dialog" aria-modal="true" aria-label="ソース"><div class="wh"><div><div class="p">${esc(path)}</div><div class="s">${esc(title || "")}${start ? `　${start}${end && end !== start ? `–${end}` : ""} 行` : ""}</div></div><button class="btn" data-act="close-code">閉じる（Esc）</button></div><pre>読み込み中…</pre></div>`;
  const pre = modal.querySelector("pre");
  try {
    const res = await fetch(D.srcUrl(path));
    if (!res.ok) throw new Error(res.status);
    const lines = (await res.text()).split("\n");
    pre.innerHTML = lines.map((l, k) => {
      const no = k + 1;
      const cls = no === hot ? " hot" : (start && no >= start && no <= (end || start)) ? " hi" : "";
      return `<span class="ln${cls}" data-ln="${no}"><i>${no}</i>${highlight(l)}</span>`;
    }).join("");
    const target = pre.querySelector(`[data-ln="${Math.max(1, (hot || start || 1) - 6)}"]`);
    if (target) pre.scrollTop = target.offsetTop - pre.offsetTop;
  } catch (e) {
    pre.textContent = `ソースを読めませんでした（${e.message}）`;
  }
  modal.querySelector("[data-act=close-code]").focus();
}
