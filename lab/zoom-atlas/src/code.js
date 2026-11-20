// Loads the real source files and colours them. A small tokenizer for MyLang (C-like) and Rust.
import { CODE, FLOWS, PAPERS, boxOf, codeOf } from './model.js';

const KW = {
  mylang: new Set(('if else while for return case of break continue export import from namespace struct enum entity has many as ordered ' +
    'fn syscall const let var static extern unsafe default true false null None Some Ok Err self Self borrow move sizeof typeof type ' +
    'match switch do in is and or not new delete interface impl trait public private module use').split(' ')),
  rust: new Set(('as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self ' +
    'static struct super trait true type unsafe use where while dyn Some None Ok Err').split(' ')),
};
const TYPES = new Set(('void bool i8 i16 i32 i64 u8 u16 u32 u64 u128 usize isize f32 f64 char str String Vec Option Result Box Instant Duration').split(' '));

const files = {};      // path → [lines]
const tokens = {};     // path → [[{ s, c }]]

export async function loadSources(paths) {
  await Promise.all(paths.map(async (p) => {
    if (files[p]) return;
    try {
      const r = await fetch('../data/src/' + p);
      if (!r.ok) throw new Error(r.status);
      const txt = await r.text();
      files[p] = txt.replace(/\r\n/g, '\n').split('\n');
    } catch (e) {
      files[p] = null;
    }
  }));
}
export const fileLines = (p) => files[p] || null;

export function tokensOf(path) {
  if (tokens[path]) return tokens[path];
  const lines = files[path];
  if (!lines) return null;
  const lang = (CODE.files[path] || {}).lang === 'rust' ? 'rust' : 'mylang';
  const kw = KW[lang];
  const out = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const toks = [];
    let i = 0;
    const push = (s, c) => { if (!s) return; const last = toks[toks.length - 1]; if (last && last.c === c) last.s += s; else toks.push({ s, c }); };
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end < 0) { push(line.slice(i), 'com'); i = line.length; break; }
        push(line.slice(i, end + 2), 'com'); i = end + 2; inBlock = false; continue;
      }
      const ch = line[i], two = line.slice(i, i + 2);
      if (two === '//') { push(line.slice(i), 'com'); break; }
      if (two === '/*') { inBlock = true; continue; }
      if (ch === '"' || (ch === "'" && lang === 'mylang')) {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
        push(line.slice(i, j + 1), 'str'); i = j + 1; continue;
      }
      if (ch === '@' && /[a-z]/i.test(line[i + 1] || '')) {
        let j = i + 1; while (j < line.length && /[\w]/.test(line[j])) j++;
        push(line.slice(i, j), 'ann'); i = j; continue;
      }
      if (lang === 'rust' && ch === '#' && line[i + 1] === '[') { const j = line.indexOf(']', i); push(line.slice(i, j < 0 ? line.length : j + 1), 'ann'); i = j < 0 ? line.length : j + 1; continue; }
      if (/[0-9]/.test(ch) && !/[\w]/.test(line[i - 1] || '')) {
        let j = i; while (j < line.length && /[\w.]/.test(line[j])) j++;
        push(line.slice(i, j), 'num'); i = j; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i; while (j < line.length && /[\w]/.test(line[j])) j++;
        const w = line.slice(i, j);
        let c = 'plain';
        if (kw.has(w)) c = 'kw';
        else if (TYPES.has(w) || /^[A-Z][a-z0-9]+[A-Za-z0-9]*$/.test(w) || /^[A-Z][A-Z0-9]*[a-z]/.test(w)) c = 'type';
        else if (/^[A-Z][A-Z0-9_]+$/.test(w)) c = 'num';
        else { let k = j; while (line[k] === ' ') k++; if (line[k] === '(') c = 'fn'; }
        push(w, c); i = j; continue;
      }
      push(ch, 'plain'); i++;
    }
    out.push(toks);
  }
  tokens[path] = out;
  return out;
}

// ---- Where a step happens in the code ----
// The exporter gives, for some steps, the first line in the starting box that names the target. That line is
// used only when it really calls or sets the target; otherwise a line that does is looked for, and when none is
// found the step points at the target's definition (a return: where it returns from), marked as such.
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const noComment = (l) => String(l || '').replace(/\/\/.*$/, '');
function findIn(c, re, last = false, skipStart = true) {
  if (!c || c.whole || c.start == null) return null;
  const L = files[c.path];
  if (!L) return null;
  let hit = null;
  for (let ln = c.start + (skipStart ? 1 : 0); ln <= c.end; ln++) if (re.test(noComment(L[ln - 1]))) { hit = ln; if (!last) break; }
  return hit;
}
const spotCache = new Map();
export function stepSpot(fid, i) {
  const key = fid + '|' + i;
  if (spotCache.has(key)) return spotCache.get(key);
  const f = FLOWS.find((x) => x.id === fid) || PAPERS[fid];
  const st = f && f.steps[i];
  let out = null;
  if (st) {
    const a = boxOf(f, st.from), b = boxOf(f, st.to);
    const an = a && a.node, bn = b && b.node;
    const ac = an && codeOf(an), bc = bn && codeOf(bn);
    const sym = bn && CODE.nodes[bn] && CODE.nodes[bn].symbol;
    const name = sym ? sym.split('.').pop() : null;
    // calls it, or sets it (or one of its fields)
    const uses = name ? new RegExp(`\\b${reEsc(name)}\\s*\\(|\\b${reEsc(name)}(?:\\.\\w+|\\[[^\\]]*\\])*\\s*=(?!=)`) : null;
    const given = (CODE.steps[fid] || {})[i];
    const ok = (p, ln) => uses && files[p] && uses.test(noComment(files[p][ln - 1]));
    const at = (c, ln) => (ln ? { path: c.path, line: ln, exact: true } : null);
    if (given && given.path && ok(given.path, given.line)) out = { path: given.path, line: given.line, exact: true };
    // a box named like an assignment (owner = pid): the line that does it
    const asg = b && /^([A-Za-z_]\w*)\s*=\s*\S/.exec(b.title || '');
    if (!out && asg) { const re = new RegExp(`\\b${reEsc(asg[1])}\\s*=(?!=)`); out = at(bc, findIn(bc, re, false, false)) || at(ac, findIn(ac, re)); }
    // a return that names its value (false): the last such return in the box it leaves
    if (!out && st.kind === 'return' && /^[\w.]+$/.test(st.verb || '')) out = at(ac, findIn(ac, new RegExp(`\\breturn\\s+${reEsc(st.verb)}\\b`), true));
    if (!out && uses) out = at(ac, findIn(ac, uses));
    if (!out) {
      const c = st.kind === 'return' ? ac : bc;
      if (c && !c.whole && c.start != null) out = { path: c.path, line: c.start, exact: false, node: st.kind === 'return' ? an : bn };
    }
  }
  spotCache.set(key, out);
  return out;
}
