// Small helpers: escaping, text measuring, number formatting, a code highlighter for excerpts.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Number(n).toLocaleString('ja-JP');

export const SANS = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", "Noto Sans Mono CJK JP", monospace';

const ctx = document.createElement('canvas').getContext('2d');
const cache = new Map();
// Width of a text in px. mono: monospace face (Japanese falls back to the CJK face either way).
export function textW(s, size = 13, weight = 400, mono = false) {
  const k = `${weight}|${size}|${mono ? 1 : 0}|${s}`;
  let w = cache.get(k);
  if (w == null) {
    ctx.font = `${weight} ${size}px ${mono ? MONO : SANS}`;
    w = ctx.measureText(String(s)).width;
    cache.set(k, w);
  }
  return w;
}
export const isJa = (s) => /[　-鿿＀-￯]/.test(s);

// Splits a name onto two lines when it is wider than max: after _ or a space, or before (.
export function splitName(name, max, size, weight, mono) {
  if (textW(name, size, weight, mono) <= max) return [name];
  let best = null;
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1], cur = name[i];
    const ok = '_ .・、'.includes(prev) || cur === '(' || cur === '[' || (isJa(cur) && !isJa(prev) && prev !== ' ') || (!isJa(cur) && isJa(prev))
      || ('のをにでとはがら'.includes(prev) && isJa(cur));
    if (!ok) continue;
    const a = name.slice(0, i).trimEnd(), b = name.slice(i).trimStart();
    const m = Math.max(textW(a, size, weight, mono), textW(b, size, weight, mono));
    if (!best || m < best.m) best = { a, b, m };
  }
  if (!best) {
    const h = Math.ceil(name.length / 2);
    return [name.slice(0, h), name.slice(h)];
  }
  return [best.a, best.b];
}

// Wraps text into lines no wider than max (Japanese breaks anywhere; latin at spaces when it can).
export function wrap(s, max, size, weight = 400) {
  const out = [];
  let line = '';
  for (const ch of String(s)) {
    const next = line + ch;
    if (line && textW(next, size, weight) > max) {
      const sp = line.lastIndexOf(' ');
      if (!isJa(ch) && sp > 0 && sp > line.length - 14) { out.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
      else { out.push(line); line = ch; }
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const KW = new Set(('if else while for return struct enum void bool char true false fn let mut pub use import module const break continue match impl self Self '
  + 'i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 borrow move syscall unsafe static extern as in loop where type mod crate super Option Some None').split(' '));
// A small highlighter for MyLang (C-like) and Rust excerpts: comments, strings, numbers, keywords, calls.
export function highlight(line) {
  let out = '', i = 0;
  const s = line;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(/^\/\/.*/)) || (m = rest.match(/^\/\*.*?(\*\/|$)/)) || (i === 0 && (m = rest.match(/^\s*\*(?:\s.*|\/.*)?$/)))) {
      out += `<span class="c-com">${esc(m[0])}</span>`; i += m[0].length; continue;
    }
    if ((m = rest.match(/^"(?:[^"\\]|\\.)*"?/)) || (m = rest.match(/^'(?:[^'\\]|\\.)'/))) { out += `<span class="c-str">${esc(m[0])}</span>`; i += m[0].length; continue; }
    if ((m = rest.match(/^(0x[0-9a-fA-F_]+|\d[\d_]*)/))) { out += `<span class="c-num">${esc(m[0])}</span>`; i += m[0].length; continue; }
    if ((m = rest.match(/^@?[A-Za-z_][A-Za-z0-9_]*/))) {
      const w = m[0];
      const call = /^\s*\(/.test(s.slice(i + w.length));
      if (KW.has(w)) out += `<span class="c-kw">${w}</span>`;
      else if (w.startsWith('@')) out += `<span class="c-at">${w}</span>`;
      else if (call) out += `<span class="c-fn">${w}</span>`;
      else if (/^[A-Z]/.test(w)) out += `<span class="c-ty">${w}</span>`;
      else out += esc(w);
      i += w.length;
      continue;
    }
    out += esc(s[i]);
    i++;
  }
  return out;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => 1 - Math.pow(1 - t, 3);
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
