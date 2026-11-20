// 館内案内: every node of the atlas, floor by floor, like the directory board in a lobby.
import { A, node, NODE_KIND_JA, FLOOR_NO, containerOf } from "./model.js";
import { esc } from "./iso.js";

const box = document.getElementById("dir");
let onPick = null;

function whereIs(id, mainIds) {
  const n = node(id);
  if (mainIds.has(id)) return { cls: "bld", t: "建物に置いてある" };
  const p = containerOf(id);
  if (p) return { cls: "in", t: `${A.papers[p].title}` };
  if (n.kind === "context") return { cls: "room", t: "部屋（点線の枠）" };
  if (n.layer === "contract") return { cls: "shape", t: "荷物の形" };
  return { cls: "none", t: "" };
}

export function openDirectory(opts = {}) {
  onPick = opts.onPick;
  const main = window.__iso?.MAIN;
  const mainIds = new Set(main ? main.machines.map((m) => m.node) : []);
  const groups = A.layers.map((l) => ({ l, ids: Object.keys(A.nodes).filter((k) => A.nodes[k].layer === l.id) }));
  const title = (l) => (l.cross ? { contract: "契約（データの形）", context: "実行の文脈（部屋）", policy: "方針（館内の決まり）" }[l.id] || l.name : `${FLOOR_NO[l.id]}　${l.name}`);
  let h = `<div class="dhead"><h2>館内案内</h2><p>${Object.keys(A.nodes).length} の項目。建物にあるものは選ぶとその機械を、紙の中のものはその紙を開きます。</p>
    <input id="dsearch" type="search" placeholder="名前で探す（例：gateway、CPU、Request）" aria-label="名前で探す" autocomplete="off"><button class="dclose" id="dclose" aria-label="閉じる">×</button></div><div class="dbody">`;
  for (const { l, ids } of groups) {
    if (!ids.length) continue;
    h += `<section class="dgrp tone-${l.id}${l.cross ? " cross" : ""}"><h3><i class="sw"></i>${esc(title(l))}<small>${esc(l.cross ? "" : l.sub || "")}</small></h3><ul>`;
    for (const id of ids) {
      const n = A.nodes[id];
      const w = whereIs(id, mainIds);
      const mono = /^[\x00-\x7F]+$/.test(n.title);
      h += `<li><button data-pick="${esc(id)}" data-q="${esc((n.title + " " + id + " " + (n.fn || "") + " " + (n.text || "")).toLowerCase())}"><span class="dk">${esc(NODE_KIND_JA[n.kind] || n.kind)}</span><span class="dt${mono ? " mono" : ""}">${esc(n.title)}</span>${w.t ? `<span class="dw ${w.cls}">${esc(w.t)}</span>` : ""}</button></li>`;
    }
    h += `</ul></section>`;
  }
  h += `</div>`;
  box.innerHTML = h;
  box.hidden = false;
  const q = document.getElementById("dsearch");
  q.focus({ preventScroll: true });
  q.addEventListener("input", () => {
    const v = q.value.trim().toLowerCase();
    box.querySelectorAll("[data-pick]").forEach((b) => (b.parentElement.hidden = !!v && !b.dataset.q.includes(v)));
    box.querySelectorAll(".dgrp").forEach((g) => (g.hidden = ![...g.querySelectorAll("li")].some((li) => !li.hidden)));
  });
  document.getElementById("dclose").onclick = closeDirectory;
  box.onclick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (b && onPick) onPick(b.dataset.pick);
  };
}

export function closeDirectory() { box.hidden = true; }
