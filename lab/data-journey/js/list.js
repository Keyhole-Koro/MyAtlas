import { h, richText } from "./util.js";
import { OPS, kindName } from "./journeys.js";
import { cellText } from "./table.js";

// Narrow screens: the same grid, turned on its side. One card per step, listing
// what happens to each piece of data, and where the data is.
export function renderList(root, J, opts) {
  const { A, cols, sel, onCol } = opts;
  root.innerHTML = "";
  const laneName = Object.fromEntries(J.lanes.map((l) => [l.id, l]));
  let lastPlace = null;
  for (const c of cols) {
    const card = h("article", { class: "lcard" + (c.key === sel ? " on" : "") + (c.security ? " sec" : "") + (c.alt ? " alt" : ""), "data-col": c.key });
    const title = c.verb || (c.head || []).join(" ") || (c.to && c.to.title) || "";
    card.appendChild(h("div", { class: "lh" },
      h("span", { class: "num" + (c.alt ? " alt" : "") }, c.alt ? "もし" : String(c.n)),
      h("span", { class: "lt" }, title),
      h("span", { class: "lk" }, kindName(c.kind))));
    card.appendChild(h("p", { class: "ll", html: richText(A, c.label) }));
    const place = c.place && laneName[c.place];
    if (place && c.place !== lastPlace) {
      card.appendChild(h("div", { class: "lplace" }, h("span", { class: "rib " + (place.tone === "app" ? "app" : place.tone) }), `${c.placeT || (J.id === "ui" ? "Request は" : "値は")} ${place.name}（${place.sub}）`));
      lastPlace = c.place;
    }
    if (c.security) card.appendChild(h("div", { class: "lsec" }, "ここが要：アプリは owner を名乗れない。何を書いても、呼んだプロセスの pid で上書きする"));
    if (c.drift) card.appendChild(h("div", { class: "ldrift" }, c.drift === "cond" ? "! 地図は条件を書いていない（この要求では何も替わらない）" : "! 地図は 13 語と書く。コードは 15 語"));
    const ul = h("ul", { class: "lfx" });
    const riders = [];
    for (const r of J.rows) {
      const cell = c.cells[r.id];
      if (!cell || !cell.op) continue;
      if (cell.op === "ride") { riders.push(r.name); continue; }
      const op = OPS[cell.op];
      const t = cellText(cell);
      ul.appendChild(h("li", {}, h("span", { class: "fname" }, r.name), h("span", { class: "pill " + op.cls, title: op.d }, t), cell.extra.v && cell.extra.v !== t ? h("span", { class: "lv" }, cell.extra.v) : null));
    }
    if (riders.length) ul.appendChild(h("li", { class: "riders" }, h("span", { class: "pill dot" }), `${riders.length} 個はそのまま運ばれる`));
    if (ul.childNodes.length) card.appendChild(ul);
    card.addEventListener("click", () => onCol(c.key));
    root.appendChild(card);
  }
}
