// Text measuring and line breaking for the canvas. Widths are measured once at 100px and scaled.
export const SANS = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", "Noto Sans Mono CJK JP", monospace';

const mctx = document.createElement('canvas').getContext('2d');
const cache = new Map();

// A font is { mono, weight, italic }; the size is given separately (world units or px).
export const F = {
  sans: { mono: false, weight: 400 },
  sansMed: { mono: false, weight: 500 },
  sansBold: { mono: false, weight: 700 },
  mono: { mono: true, weight: 400 },
  monoBold: { mono: true, weight: 700 },
  monoMed: { mono: true, weight: 500 },
};
export function fontStr(f, px) {
  return `${f.italic ? 'italic ' : ''}${f.weight || 400} ${px}px ${f.mono ? MONO : SANS}`;
}
// Width of a string at size 1.
export function measure(s, f) {
  const key = (f.mono ? 'm' : 's') + (f.weight || 400) + (f.italic ? 'i' : '') + '\u0000' + s;
  let w = cache.get(key);
  if (w === undefined) {
    mctx.font = fontStr(f, 100);
    w = mctx.measureText(s).width / 100;
    cache.set(key, w);
  }
  return w;
}
export const textW = (s, f, size) => measure(s, f) * size;

// ---- Japanese-aware wrapping ----
const CJK = /[⺀-⿿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
const KATA = /[\u30a1-\u30fa\u30fc]/;
const NO_START = new Set([...'、。，．,.)）」』】〉》〕]｝}・：；:;！？!?ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〻％%']);
const NO_END = new Set([...'（「『【〈《〔[｛{(']);

// segs: [{ s, st, link }] where st = { f, c } → units: [{ runs: [{ s, st, link }], w, sp }]
function atomize(segs, size) {
  const atoms = [];
  for (const seg of segs) {
    const { st, link } = seg;
    if (link) {
      // A pointer keeps together unless it is longer than a line (handled by the line filler).
      atoms.push({ runs: [{ s: seg.s, st, link }], sp: 0 });
      continue;
    }
    let word = '', kana = '';
    const flush = () => { if (word) { atoms.push({ runs: [{ s: word, st }], sp: 0 }); word = ''; } };
    const flushK = () => { if (kana) { atoms.push({ runs: [{ s: kana, st }], sp: 0 }); kana = ''; } };
    for (const ch of seg.s) {
      if (ch === ' ' || ch === '\t') {
        flush(); flushK();
        if (atoms.length) atoms[atoms.length - 1].sp += 1; else atoms.push({ runs: [{ s: '', st }], sp: 1 });
        continue;
      }
      if (KATA.test(ch) && !(ch === 'ー' && !kana) && ch !== '・') { flush(); kana += ch; continue; }
      flushK();
      if (CJK.test(ch)) { flush(); atoms.push({ runs: [{ s: ch, st }], sp: 0 }); continue; }
      word += ch;
    }
    flush(); flushK();
  }
  // Kinsoku: closing marks stay with what comes before, opening marks with what comes after.
  const out = [];
  for (const a of atoms) {
    const first = a.runs[0].s[0];
    const prev = out[out.length - 1];
    if (prev && first && NO_START.has(first) && !prev.sp) { prev.runs.push(...a.runs); prev.sp = a.sp; continue; }
    if (prev && prev.glue && !prev.sp) { prev.runs.push(...a.runs); prev.sp = a.sp; prev.glue = false; continue; }
    const lastRun = a.runs[a.runs.length - 1].s;
    a.glue = NO_END.has(lastRun[lastRun.length - 1]);
    out.push(a);
  }
  for (const a of out) {
    a.w = a.runs.reduce((w, r) => w + textW(r.s, r.st.f, size), 0);
    a.spW = a.sp ? textW(' ', a.runs[a.runs.length - 1].st.f, size) * a.sp : 0;
  }
  return out;
}

// Break one over-long unit into pieces by characters.
function splitLong(a, maxW, size) {
  const pieces = [];
  let cur = { runs: [], w: 0, sp: 0, spW: 0 };
  for (const r of a.runs) {
    let buf = '';
    for (const ch of r.s) {
      const cw = textW(ch, r.st.f, size);
      if (cur.w + textW(buf, r.st.f, size) + cw > maxW && (buf || cur.runs.length)) {
        if (buf) cur.runs.push({ ...r, s: buf });
        cur.w = cur.runs.reduce((w, q) => w + textW(q.s, q.st.f, size), 0);
        pieces.push(cur);
        cur = { runs: [], w: 0, sp: 0, spW: 0 };
        buf = '';
      }
      buf += ch;
    }
    if (buf) cur.runs.push({ ...r, s: buf });
    cur.w = cur.runs.reduce((w, q) => w + textW(q.s, q.st.f, size), 0);
  }
  cur.sp = a.sp; cur.spW = a.spW;
  pieces.push(cur);
  return pieces;
}

// Lay rich text out into lines: [{ runs: [{ x, s, st, link, w }], w }]
export function wrapRich(segs, maxW, size, maxLines = Infinity) {
  const units = [];
  for (const a of atomize(segs, size)) {
    if (a.w > maxW) units.push(...splitLong(a, maxW, size)); else units.push(a);
  }
  const lines = [];
  let line = { runs: [], w: 0 }, pendingSp = 0, pendingN = 0;
  const push = () => { lines.push(line); line = { runs: [], w: 0 }; pendingSp = 0; pendingN = 0; };
  for (const u of units) {
    if (line.runs.length && line.w + pendingSp + u.w > maxW + 0.01) push();
    const lead = line.runs.length ? pendingSp : 0, leadN = line.runs.length ? pendingN : 0;
    let x = line.w + lead;
    u.runs.forEach((r, i) => {
      const w = textW(r.s, r.st.f, size);
      const last = line.runs[line.runs.length - 1];
      if (last && last.st === r.st && last.link === r.link) {
        last.s += (i === 0 ? ' '.repeat(leadN) : '') + r.s;
        last.w = x + w - last.x;
      } else line.runs.push({ x, s: r.s, st: r.st, link: r.link, w });
      x += w;
    });
    line.w = x;
    pendingSp = u.spW; pendingN = u.sp;
  }
  if (line.runs.length) lines.push(line);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    const last = keep[keep.length - 1];
    ellipsize(last, maxW, size);
    return keep;
  }
  return lines;
}
function ellipsize(line, maxW, size) {
  const tail = line.runs[line.runs.length - 1];
  const ell = textW('…', tail.st.f, size);
  while (line.runs.length && line.w + ell > maxW) {
    const r = line.runs[line.runs.length - 1];
    if (r.s.length <= 1) { line.runs.pop(); line.w = r.x; continue; }
    r.s = r.s.slice(0, -1);
    r.w = textW(r.s, r.st.f, size);
    line.w = r.x + r.w;
  }
  const r = line.runs[line.runs.length - 1];
  if (r) { r.s += '…'; r.w += ell; line.w += ell; }
}

// The narrowest width that keeps the same number of lines (no lonely last character).
export function balanced(fn, maxW) {
  const base = fn(maxW);
  if (base.length < 2) return base;
  let lo = maxW * 0.45, hi = maxW, best = base;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2, t = fn(mid);
    if (t.length === base.length && !t.broken) { best = t; hi = mid; } else lo = mid;
  }
  return best;
}
// Plain text in one style.
export const wrapPlain = (s, st, maxW, size, maxLines) => wrapRich([{ s, st }], maxW, size, maxLines);

// Code-like names break after . _ , or before ( — never inside a word.
export function wrapName(s, f, size, maxW, maxLines = 3) {
  if (textW(s, f, size) <= maxW) return [s];
  const parts = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' && cur) { parts.push(cur); cur = ''; }
    cur += ch;
    if ('._,'.includes(ch) || ch === ' ') { parts.push(cur); cur = ''; }
  }
  if (cur) parts.push(cur);
  const lines = [];
  let line = '';
  for (const p of parts) {
    if (line && textW((line + p).trimEnd(), f, size) > maxW) { lines.push(line.trimEnd()); line = p.trimStart(); }
    else line += p;
  }
  if (line) lines.push(line.trimEnd());
  // A part longer than the line is cut by characters.
  const out = [];
  let broken = false;
  for (const l of lines) {
    if (textW(l, f, size) <= maxW) { out.push(l); continue; }
    broken = true;
    let buf = '';
    for (const ch of l) { if (buf && textW(buf + ch, f, size) > maxW) { out.push(buf); buf = ''; } buf += ch; }
    if (buf) out.push(buf);
  }
  out.broken = broken;
  if (out.length > maxLines) {
    const keep = out.slice(0, maxLines);
    keep[maxLines - 1] = fit(keep[maxLines - 1] + '…', f, size, maxW);
    keep.broken = true;
    return keep;
  }
  return out;
}
// Japanese titles break between phrases (after a particle or a run of kana), never inside a word:
// 満杯なら印を付ける → 満杯なら / 印を / 付ける. Okurigana inside a compound (置き場, 差し替え) stays whole.
const HIRA = /[\u3041-\u309f]/;
const KANJI = /[\u4e00-\u9fff\u3005]/;
const PARTICLE = new Set([...'をはがにでとのへもや']);
export function phrases(s) {
  const out = [];
  const ch = [...s];
  let cur = '';
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], nx = ch[i + 1];
    cur += c;
    if (nx === undefined) break;
    let brk = false;
    if (' 、・。）)'.includes(c)) brk = !NO_START.has(nx);
    else if (HIRA.test(c) && !HIRA.test(nx) && !NO_START.has(nx)) {
      let run = 0;
      for (let j = i; j >= 0 && HIRA.test(ch[j]); j--) run++;
      const before = ch[i - run];
      brk = !(run === 1 && before && KANJI.test(before) && !PARTICLE.has(c) && KANJI.test(nx));
    } else if ((nx === '(' || nx === '（') && cur.trim()) brk = true;
    if (brk) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}
export function wrapPhrases(s, f, size, maxW, maxLines = 3) {
  if (textW(s, f, size) <= maxW) return [s];
  const lines = [];
  let line = '', broken = false;
  for (const p of phrases(s)) {
    if (line && textW((line + p).trimEnd(), f, size) > maxW) { lines.push(line.trimEnd()); line = p.trimStart(); }
    else line += p;
  }
  if (line) lines.push(line.trimEnd());
  const out = [];
  for (const l of lines) {
    if (textW(l, f, size) <= maxW) { out.push(l); continue; }
    broken = true;
    for (const r of wrapRich([{ s: l, st: { f } }], maxW, size)) out.push(r.runs.map((x) => x.s).join(''));
  }
  out.broken = broken;
  if (out.length > maxLines) {
    const keep = out.slice(0, maxLines);
    keep[maxLines - 1] = fit(keep[maxLines - 1] + '…', f, size, maxW);
    keep.broken = true;
    return keep;
  }
  return out;
}
// A title of either kind: code names by their own separators, Japanese by phrases.
export const wrapTitle = (s, f, size, maxW, maxLines = 3) => (isCodeName(s) ? wrapName(s, f, size, maxW, maxLines) : wrapPhrases(s, f, size, maxW, maxLines));

// A shorter form of a file or code name that still fits, without cutting a word: a.b/c.unsafe.mln → c.unsafe.mln → c.unsafe → c
export function shortName(s, f, size, maxW, kind = 'file') {
  const c = [s];
  if (kind === 'file') {
    const file = s.split('/').pop();
    c.push(file, file.replace(/\.(mln|rs)$/, ''), file.split('.')[0]);
  } else {
    const parts = s.split('.');
    if (parts.length > 1) c.push(parts.slice(1).join('.'), parts[parts.length - 1]);
  }
  for (const x of c) if (x && textW(x, f, size) <= maxW) return x;
  return '';
}
// Cut a string so that it fits, ending with an ellipsis.
export function fit(s, f, size, maxW) {
  if (textW(s, f, size) <= maxW) return s;
  let t = s.replace(/…$/, '');
  while (t.length > 1 && textW(t + '…', f, size) > maxW) t = t.slice(0, -1);
  return t.length > 1 ? t + '…' : '';
}
export const isCodeName = (s) => /^[\w.()\[\]*&<>,: =\-−\/]+$/.test(s) && /[a-z_]/i.test(s) && !/[぀-ヿ一-鿿]/.test(s);
export const hasJa = (s) => /[぀-ヿ一-鿿]/.test(s);
