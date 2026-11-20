export const SVGNS = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") e.textContent = v;
    else if (k === "class") e.setAttribute("class", v);
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}

export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return e;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace';

const ctx = document.createElement("canvas").getContext("2d");
export function textWidth(text, size = 12, weight = 400, mono = false) {
  ctx.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  return ctx.measureText(String(text)).width;
}

// Map text: [[id]] becomes a reference the reader can hover; ![[fig]] is dropped
// here (figures are drawn where they belong).
export function richText(A, text) {
  return esc(String(text || ""))
    .replace(/!\[\[([^\]]+)\]\]/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, (_, id) => {
      const n = A.nodes[id];
      if (!n) return esc(id);
      return `<span class="nref" data-node="${esc(id)}" title="${esc(plainNode(A, n))}">${esc(n.title)}</span>`;
    });
}

function plainNode(A, n) {
  return String(n.text || "").replace(/!\[\[[^\]]+\]\]/g, "").replace(/\[\[([^\]]+)\]\]/g, (_, id) => (A.nodes[id] ? A.nodes[id].title : id)).trim();
}

const srcCache = new Map();
export function fetchSource(path) {
  if (!srcCache.has(path)) {
    srcCache.set(path, fetch("../data/src/" + path).then((r) => (r.ok ? r.text() : null)).then((t) => (t == null ? null : t.split("\n"))).catch(() => null));
  }
  return srcCache.get(path);
}

// 1-based line of the first line whose trimmed text starts with the trimmed `find`
export function findLine(lines, find) {
  if (!lines || !find) return null;
  const f = find.trim();
  for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith(f)) return i + 1;
  return null;
}

export const fmt = (n) => Number(n).toLocaleString("en-US");
