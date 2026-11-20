// Colours come from the CSS tokens, so light and dark mode stay in one place (style.css).
export const T = {};
const NAMES = [
  'bg', 'surface', 'surface-2', 'sea', 'text', 'text-2', 'text-3', 'border', 'border-strong',
  'accent', 'accent-text', 'accent-soft', 'accent-line', 'halo',
  'l-app', 'l-lib', 'l-os', 'l-kernel', 'l-emu', 'l-x',
  'app-t0', 'app-t1', 'app-t2', 'lib-t0', 'lib-t1', 'lib-t2', 'os-t0', 'os-t1', 'os-t2',
  'kernel-t0', 'kernel-t1', 'kernel-t2', 'emu-t0', 'emu-t1', 'emu-t2', 'x-t0', 'x-t1', 'x-t2',
  'run-app', 'run-svc', 'run-irq',
  'syn-kw', 'syn-type', 'syn-str', 'syn-num', 'syn-com', 'syn-ann', 'syn-fn', 'code-bg', 'code-hl',
];
const STACKED = new Set(['app', 'lib', 'os', 'kernel', 'emu']);
const listeners = [];

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const n of NAMES) T[n] = cs.getPropertyValue('--' + n).trim();
  T.dark = matchMedia('(prefers-color-scheme: dark)').matches;
}
export function onTheme(fn) { listeners.push(fn); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); for (const fn of listeners) fn(); });

// The colour of a layer (cross-cutting layers share a neutral one).
export const layerColor = (layer) => (STACKED.has(layer) ? T['l-' + layer] : T['l-x']);
export const tint = (layer, i) => (STACKED.has(layer) ? T[`${layer}-t${i}`] : T[`x-t${i}`]);

// Role names used by the layout, resolved at draw time.
export function roleColor(role, layer) {
  switch (role) {
    case 'text': return T.text;
    case 'text2': return T['text-2'];
    case 'text3': return T['text-3'];
    case 'accent': return T.accent;
    case 'layer': return layerColor(layer);
    case 'kw': return T['syn-kw'];
    case 'type': return T['syn-type'];
    case 'str': return T['syn-str'];
    case 'num': return T['syn-num'];
    case 'com': return T['syn-com'];
    case 'ann': return T['syn-ann'];
    case 'fn': return T['syn-fn'];
    case 'surface': return T.surface;
    case 'surface2': return T['surface-2'];
    case 'border': return T.border;
    case 'borderStrong': return T['border-strong'];
    case 'codeBg': return T['code-bg'];
    case 'accentSoft': return T['accent-soft'];
    default: return role && role[0] === '#' ? role : T.text;
  }
}

// rgba() from a #rrggbb colour (memoized: it is called for every greyed bar).
const alphaCache = new Map();
export function alpha(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const key = hex + a;
  let v = alphaCache.get(key);
  if (v) return v;
  const n = parseInt(hex.length === 4 ? hex.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3').slice(1) : hex.slice(1), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  alphaCache.set(key, v);
  return v;
}
// Mix two #rrggbb colours.
export function mix(a, b, t) {
  const p = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  if (!a || !b || a[0] !== '#' || b[0] !== '#') return t < 0.5 ? a : b;
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
