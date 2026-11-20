import { h, esc, richText, fetchSource, findLine } from "./util.js";
import { OPS, kindName, plain, DRIFT } from "./journeys.js";
import { cellText } from "./table.js";

// The paper a step is in, and where that paper sits in the flow outside.
const PARENT = { "os.gateway": ["ui", 4], "os.submit": ["os.gateway", 7], "kernel.cpu-time": ["cpu", 4], "app.tasks": ["cpu", 11] };

export function mapRef(A, c) {
  const parts = [];
  let src = c.src, i = c.i;
  const name = (id) => (A.papers[id] ? `${A.papers[id].tab} の中` : A.flows.find((f) => f.id === id).tab);
  parts.unshift(`${name(src)} の ${i + 1}`);
  while (PARENT[src]) { [src, i] = PARENT[src]; parts.unshift(`${name(src)} の ${i + 1}`); }
  return parts.join(" → ");
}

function pillEl(cell) {
  const op = OPS[cell.op];
  if (!op) return h("span");
  if (op.cls === "dot") return h("span", { class: "pill dot", title: op.d });
  return h("span", { class: "pill " + op.cls, title: op.d }, cellText(cell));
}

function quote(A, J, c, w) {
  const D = A;
  switch (w.k) {
    case "label":
      return { q: c.label, src: "地図の手順の文" };
    case "field": {
      const sid = w.schema || "schema.request";
      const n = D.nodes[sid];
      const f = (n.fields || []).find((x) => x[1] === w.field);
      return f ? { q: f[2], src: `${n.title} の ${w.field}（フィールドの説明）` } : null;
    }
    case "node": {
      const n = D.nodes[w.id];
      if (!n) return null;
      return { q: plain(A, n.text), hi: w.part, src: `${n.title}（地図の点の文）` };
    }
    case "param": {
      const n = D.nodes[w.id];
      const p = ((n && n.api && n.api.params) || []).find((x) => x[0] === w.name);
      return p ? { q: plain(A, p[1]), src: `${n.title} の引数 ${w.name}` } : null;
    }
    case "data": {
      const d = c.data;
      if (!d) return null;
      const bits = [d.label, d.type, d.note && plain(A, d.note)].filter(Boolean);
      return { q: bits.join("　"), src: "渡すデータ" };
    }
    case "src":
      return { code: w };
  }
  return null;
}

function whyList(A, J, c, cell, skipLabel) {
  const box = h("div", { class: "why" });
  const why = (cell.why || []).filter((w) => !(skipLabel && w.k === "label"));
  if (skipLabel && !why.length) box.appendChild(h("span", { class: "src" }, "手順の文のとおり"));
  for (const w of why) {
    const q = quote(A, J, c, w);
    if (!q) continue;
    if (q.code) {
      const line = h("span", { class: "src" }, "コード：" + q.code.path.split("/").slice(-1)[0] + " …");
      fetchSource(q.code.path).then((lines) => {
        const ln = findLine(lines, q.code.find);
        line.textContent = `コード：${q.code.path.split("/").slice(-1)[0]}:${ln ?? "?"}　${q.code.find.trim()}${q.code.note ? "（" + q.code.note + "）" : ""}`;
      });
      box.appendChild(line);
      continue;
    }
    let text = esc(q.q);
    if (q.hi) text = text.replace(esc(q.hi), `<b>${esc(q.hi)}</b>`);
    box.appendChild(h("span", { class: "q", html: "「" + text + "」" }));
    box.appendChild(h("span", { class: "src" }, q.src));
  }
  return box;
}

function codeBlock(path, target, opts = {}) {
  const wrap = h("div");
  const head = h("div", { class: "code-path" }, path);
  const note = opts.note ? h("div", { class: "code-note" }, opts.note) : null;
  const pre = h("div", { class: "code" });
  wrap.append(head, pre);
  if (note) wrap.appendChild(note);
  fetchSource(path).then((lines) => {
    if (!lines) { pre.textContent = "（ファイルを読めなかった）"; return; }
    let hot = target.line || findLine(lines, target.find) || null;
    let from, to;
    if (target.start && target.end && target.end - target.start <= 16) { from = target.start; to = target.end; }
    else if (hot) { from = Math.max(1, hot - 4); to = Math.min(lines.length, hot + 4); }
    else if (target.start) { from = target.start; to = Math.min(lines.length, target.start + 12); }
    else { from = 1; to = Math.min(lines.length, 12); }
    head.textContent = `${path}:${hot || from}`;
    for (let i = from; i <= to; i++) {
      const isHot = hot ? i === hot : false;
      pre.appendChild(h("div", { class: "ln" + (isHot ? " hot" : "") }, h("span", { class: "no" }, String(i)), h("span", {}, lines[i - 1] || " ")));
    }
  });
  return wrap;
}

// Where in the source a step happens: a cited line first, then the line the map's
// code index found, then a statement the map quotes, then the target's definition.
function stepCode(A, C, c, rowId) {
  const cells = Object.entries(c.cells);
  const pick = (cell) => (cell.why || []).find((w) => w.k === "src");
  if (rowId && c.cells[rowId] && pick(c.cells[rowId])) { const w = pick(c.cells[rowId]); return { path: w.path, find: w.find, note: w.note }; }
  for (const [, cell] of cells) { const w = pick(cell); if (w && cell.op && cell.op !== "ride") return { path: w.path, find: w.find, note: w.note }; }
  const s = (C.steps[c.src] || {})[String(c.i)];
  if (s) return { path: s.path, line: s.line, note: "地図のコード索引が見つけた行" };
  const cand = [c.step.ref, c.to && c.to.node, c.from && c.from.node].filter(Boolean);
  for (const id of cand) {
    const n = A.nodes[id];
    if (n && n.api && n.api.sig && /;\s*$/.test(n.api.sig) && n.code) return { path: n.code[0], find: n.api.sig, note: `${n.title} の行` };
  }
  for (const id of cand) {
    const loc = C.nodes[id];
    if (loc && loc.path && loc.start) return { path: loc.path, start: loc.start, end: loc.end, note: `${A.nodes[id].title} の定義` };
  }
  return null;
}

export function renderDetail(root, ctx) {
  const { A, C, J, sel, cols, onCol, onRow, onJourney } = ctx;
  root.innerHTML = "";
  const c = sel.col ? cols.find((x) => x.key === sel.col) : null;
  if (sel.row && !sel.col) return renderRow(root, ctx);
  if (!c) return;

  // ---------------------------------------------------------- card 1: the step
  const c1 = h("div", { class: "card" });
  c1.appendChild(h("h3", {}, "手順"));
  const title = c.verb || (c.head || []).join(" ").replace(/\s+/g, " ") || (c.to && c.to.title) || "";
  c1.appendChild(h("div", { class: "stephead" },
    h("div", { class: "num" + (c.alt ? " alt" : "") }, c.alt ? "もし" : String(c.n)),
    h("div", {}, h("h2", {}, title), h("span", { class: "kind" }, kindName(c.kind) + (c.alt ? `・列が${c.step.alt.when}なら（入らなかった時）` : "")))));
  const bx = (b) => h("span", { class: "bx", title: b && A.nodes[b.node] ? `${A.nodes[b.node].title}：${plain(A, A.nodes[b.node].text)}` : "" }, b ? b.title : "?");
  c1.appendChild(h("div", { class: "fromto" }, bx(c.from), h("span", { class: "arr" }, "→"), bx(c.to)));
  c1.appendChild(h("p", { class: "lbl", html: richText(A, c.label) }));
  const dl = h("dl", { class: "kv" });
  if (c.data) {
    const dd = h("dd", {}, h("span", { class: "chip" }, c.data.label));
    if (c.data.fields) dd.append(" ", ...c.data.fields.map((f) => h("span", { class: "chip" }, f)));
    if (c.data.type) dd.append(h("div", { class: "t2" }, c.data.type));
    if (c.data.note) dd.append(h("div", { html: richText(A, c.data.note) }));
    dl.append(h("dt", {}, "渡すデータ"), dd);
  }
  if (c.step.ops) dl.append(h("dt", {}, "列の操作"), h("dd", { html: c.step.ops.map((o) => `${richText(A, "[[" + o.node + "]]")} ${esc(o.kind)}`).join("、") }));
  if (c.colNote) dl.append(h("dt", {}, "ここで"), h("dd", {}, c.colNote));
  if (dl.childNodes.length) c1.appendChild(dl);
  if (c.step.branches) {
    c1.appendChild(h("div", { class: "kv" }, h("dt", {}, "分かれる")));
    c1.appendChild(h("ul", { class: "branches" }, ...c.step.branches.map(([when, what]) => h("li", { html: `${esc(when)} → ${richText(A, what)}` }))));
  }
  c1.appendChild(h("div", { class: "maplink" }, "地図では：" + mapRef(A, c)));
  if (c.checks && c.checks.length) c1.appendChild(h("div", { class: "checks" }, "確かめて：" + c.checks.join("／")));

  // ---------------------------------------------------------- card 2: what happens to each piece
  const c2 = h("div", { class: "card" });
  c2.appendChild(h("h3", {}, J.id === "ui" ? "この手順で、フィールドに起きたこと" : "この手順で、値に起きたこと"));
  if (c.security) c2.appendChild(securityBox(A, J, cols, onCol));
  if (c.drift && DRIFT[c.drift]) c2.appendChild(driftBox(A, DRIFT[c.drift]));
  const list = h("ul", { class: "fx" + (J.id === "cpu" ? " wide" : "") });
  const riders = [];
  // rows that have the same mark for the same reasons are told once
  const groups = [];
  for (const r of J.rows) {
    const cell = c.cells[r.id];
    if (!cell || !cell.op) continue;
    if (cell.op === "ride") { riders.push(r.name); continue; }
    const sig = JSON.stringify([cell.op, cell.why, cell.extra.v || "", cell.extra.why2 || "", cell.op === "word" ? "" : cell.extra.t || ""]);
    const g = groups.find((x) => x.sig === sig && r.id !== sel.row && !x.rows.some((y) => y.r.id === sel.row));
    if (g && cell.op !== "over") g.rows.push({ r, cell });
    else groups.push({ sig, rows: [{ r, cell }] });
  }
  for (const g of groups) {
    const { r, cell } = g.rows[0];
    const why = whyList(A, J, c, cell, true);
    if (cell.extra.v) why.prepend(h("span", { class: "q" }, "値：", h("b", {}, cell.extra.v)));
    if (OPS[cell.op].cls === "cond" && J.id === "ui") why.prepend(h("span", { class: "q cond" }, OPS[cell.op].d));
    if (cell.extra.why2) why.appendChild(h("span", { class: "src" }, cell.extra.why2));
    let li;
    if (g.rows.length === 1) {
      li = h("li", { class: sel.row === r.id ? "hl" : "" }, h("span", { class: "fname", title: r.text }, r.name), h("span", {}, pillEl(cell)), why);
      li.addEventListener("click", () => ctx.onCell(c.key, r.id));
    } else {
      const names = h("div", { class: "fnames" }, ...g.rows.map((x) => {
        const b = h("button", { class: "fpair", title: x.r.text }, h("span", { class: "fname" }, x.r.name), pillEl(x.cell));
        b.addEventListener("click", (e) => { e.stopPropagation(); ctx.onCell(c.key, x.r.id); });
        return b;
      }));
      li = h("li", { class: "grp" }, names, why);
    }
    list.appendChild(li);
  }
  if (riders.length) {
    list.appendChild(h("li", {},
      h("span", { class: "fname" }, riders.length + " 個"),
      h("span", {}, h("span", { class: "pill dot" })),
      h("div", { class: "why" }, h("span", { class: "q" }, riders.join("、")), h("span", { class: "src" }, "中身は変わらず、まとめて運ばれる"))));
  }
  if (!list.childNodes.length) c2.appendChild(h("p", { class: "empty" }, c.alt ? "Request は列に入らない。アプリは REQUEST_SPACE を待って、同じ Request を出し直す（もう一度 3 の OS_CALL から）。" : c.kind === "signal" ? "通知だけ。データは動かない。" : c.kind === "return" ? "戻るだけ。ここではデータは変わらない。" : "呼び出しだけ。ここではデータは変わらない。"));
  else c2.appendChild(list);
  if (c.note) c2.appendChild(h("p", { class: "note-p" }, c.note));
  if (c.next) {
    const nc = h("div", { class: "next-card" }, c.next.text, h("br"), h("button", { onclick: () => onJourney(c.next.journey, c.next.col) }, "UI の要求の 1 へ"));
    c2.appendChild(nc);
  }
  if (c.loop) c2.appendChild(h("div", { class: "next-card" }, "tick() が値を変えると、1 に戻る。", h("br"), h("button", { onclick: () => onCol(cols[0].key) }, "1 へ戻る")));

  // ---------------------------------------------------------- card 3: code
  const c3 = h("div", { class: "card" });
  c3.appendChild(h("h3", {}, "コード"));
  const loc = stepCode(A, C, c, sel.row);
  if (loc) c3.appendChild(codeBlock(loc.path, loc, { note: loc.note }));
  else c3.appendChild(h("p", { class: "empty" }, "コードの場所は地図に無い。"));
  root.append(c1, c2, c3);
  const figs = figuresFor(c);
  if (figs.length) root.appendChild(h("div", { class: "figrow" }, ...figs.map((f) => figure(A, f))));
}

function figuresFor(c) {
  const ids = [];
  const refs = [c.step.ref, c.to && c.to.node, c.from && c.from.node];
  if (refs.includes("emulator.timer.clock") || refs.includes("charge.read")) ids.push("fig.clock-word");
  if (c.key === "kernel.cpu-time:3" || c.key === "cpu:8") ids.push("fig.charge-before-after");
  return ids;
}

function figure(A, id) {
  const n = A.nodes[id];
  const f = h("figure", { class: "figure" });
  f.innerHTML = n.figure;
  f.appendChild(h("figcaption", { html: `<b>${esc(n.title)}</b>　${richText(A, n.text)}` }));
  return f;
}

function securityBox(A, J, cols, onCol) {
  const owner = A.nodes["gateway.owner"];
  const field = (A.nodes["schema.request"].fields || []).find((x) => x[1] === "owner");
  const box = h("div", { class: "sec-box" });
  box.appendChild(h("h4", {}, "ここが要：アプリは owner を名乗れない"));
  box.appendChild(h("p", { html: richText(A, owner.text) }));
  if (field) box.appendChild(h("p", { class: "t2" }, `Request の owner：「${field[2]}」`));
  const code = h("p", {}, h("code", {}, owner.api.sig));
  box.appendChild(code);
  // what the app had written there, from the source
  const app = h("p", { class: "t2" }, "アプリ側：…");
  fetchSource("system/MyAppFramework/src/runtime/runtime.unsafe.mln").then((lines) => {
    const ln = findLine(lines, "request.owner = current_owner;");
    app.textContent = `アプリ側は runtime.send が owner に current_owner を入れて送る（runtime.unsafe.mln:${ln}）。その値はここで捨てられる。`;
  });
  box.appendChild(app);
  // where the owner is used later
  const uses = cols.filter((c) => c.cells.owner && c.cells.owner.op === "use");
  if (uses.length) {
    const after = h("div", { class: "after" }, "この owner は後で使われる：");
    uses.forEach((u, i) => {
      const n = A.nodes[(u.cells.owner.why.find((w) => w.k === "node") || {}).id];
      const what = u.cells.owner.extra.t;
      const a = h("a", { onclick: () => onCol(u.key) }, `${u.n}「${what}」`);
      after.append(i ? "、" : "", a);
      if (n) after.append(`（${n.title}）`);
    });
    box.appendChild(after);
  }
  return box;
}

function driftBox(A, d) {
  const box = h("div", { class: "drift-box" });
  box.appendChild(h("h4", {}, "! " + d.title));
  for (const m of d.map) {
    const where = m.node ? A.nodes[m.node].title : `${A.nodes[m.field[0]].title} の ${m.field[1]}`;
    box.appendChild(h("p", {}, `地図（${where}）：「${m.text}」`));
  }
  box.appendChild(h("p", {}, d.count));
  for (const cc of d.code) {
    const p = h("p", {}, h("code", {}, cc.path.split("/").slice(-1)[0] + ":…"), "　", cc.note);
    fetchSource(cc.path).then((lines) => {
      const ln = findLine(lines, cc.find);
      p.firstChild.textContent = `${cc.path.split("/").slice(-1)[0]}:${ln ?? "?"}`;
    });
    box.appendChild(p);
  }
  box.appendChild(h("p", { class: "t2" }, d.shown));
  return box;
}

function renderRow(root, ctx) {
  const { A, C, J, sel, cols, onCell } = ctx;
  const r = J.rows.find((x) => x.id === sel.row);
  if (!r) return;
  const c1 = h("div", { class: "card" });
  c1.appendChild(h("h3", {}, J.id === "ui" ? "フィールド" : "値"));
  c1.appendChild(h("div", { class: "stephead" }, h("div", {}, h("h2", { class: "mono" }, r.name), r.type ? h("span", { class: "kind mono" }, r.type) : null)));
  c1.appendChild(h("p", { class: "lbl" }, r.text));
  if (r.word) c1.appendChild(h("p", { class: "t2" }, `24 語の 1 通では ${r.word} 語目（コードの RequestWord の順）`));
  const n = A.nodes[r.schema || r.node];
  if (n) c1.appendChild(h("div", { class: "maplink", html: `地図の点：${esc(n.title)}　${richText(A, n.text)}` }));

  const c2 = h("div", { class: "card" });
  c2.appendChild(h("h3", {}, "この行の旅（左から順に）"));
  const ul = h("ul", { class: "rowstory" });
  for (const c of cols) {
    const cell = c.cells[r.id];
    if (!cell || !cell.op) continue;
    const q = (cell.why || []).map((w) => quote(A, J, c, w)).find((x) => x && x.q);
    const li = h("li", {},
      h("span", { class: "n" }, c.alt ? "もし" : String(c.n)),
      h("span", {}, pillEl(cell)),
      h("span", {}, cell.extra.v ? `値：${cell.extra.v}　` : "", h("span", { class: "t2" }, q ? q.q : c.label)));
    li.addEventListener("click", () => onCell(c.key, r.id));
    ul.appendChild(li);
  }
  c2.appendChild(ul);

  const c3 = h("div", { class: "card" });
  c3.appendChild(h("h3", {}, "コード"));
  const loc = C.nodes[r.schema || r.node];
  if (loc && loc.path) {
    const find = r.schema ? fieldDecl(r) : null;
    c3.appendChild(codeBlock(loc.path, { start: loc.start, end: loc.end, find }, { note: `${(A.nodes[r.schema || r.node] || {}).title} の定義` }));
  }
  root.append(c1, c2, c3);
}

function fieldDecl(r) {
  const m = { domain: "RequestDomain domain;", op: "i32 op;", owner: "i32 owner;", a: "i32 a0;", s0: "char *s0;", s1: "char *s1;", result_out: "i32 result_out;", result_size: "i32 result_size;", s0_len: "i32 s0_len;", s1_len: "i32 s1_len;" };
  return m[r.id] || null;
}
