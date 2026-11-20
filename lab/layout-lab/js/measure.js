// Text widths. In the browser a canvas measures with the page's own fonts; under node (the dev bench) an estimate
// stands in: a CJK character is one em, a latin one a little over half.
export const SANS = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace';

let ctx = null;
const cache = new Map();

export function textW(s, px, mono = false, weight = 400) {
  s = String(s ?? '');
  const key = `${px}|${mono ? 1 : 0}|${weight}|${s}`;
  if (cache.has(key)) return cache.get(key);
  let w;
  if (typeof document !== 'undefined') {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} ${px}px ${mono ? MONO : SANS}`;
    w = ctx.measureText(s).width;
  } else {
    w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? px : px * (mono ? 0.6 : 0.56) * (weight >= 600 ? 1.04 : 1)), 0);
  }
  cache.set(key, w);
  return w;
}

// A title is set in the code font when it is all ASCII (a function, a variable); Japanese titles keep the text font.
export const isCode = (s) => /^[\x20-\x7e]+$/.test(String(s));
