// A small tokenizer for MyLang (.mln, C-like, with .dom.mln markup and .model.mln relations) and Rust.
// tokenize(text, path) -> lines, each an array of [class, text]. Classes:
//   kw keyword, ty type, fn function, st string, nu number, co constant, cm comment, dt doc tag,
//   dn doc name, cc code in a comment, an annotation, tg markup tag, at markup attribute,
//   ma macro, lt lifetime, pu punctuation, id identifier, ws whitespace.
(function () {
  const MLN_KW = new Set(('namespace import from export const struct enum impl for return if else while case of '
    + 'defer break continue loop borrow move copy syscall sizeof fn type match unsafe static extern new').split(' '));
  const MODEL_KW = new Set('entity max has many as ordered'.split(' '));
  const MLN_TY = new Set('void bool char str i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 usize isize Self'.split(' '));
  const RS_KW = new Set(('as async await break const continue crate dyn else enum extern fn for if impl in let loop '
    + 'match mod move mut pub ref return self static struct super trait type unsafe use where while').split(' '));
  const RS_TY = new Set('u8 u16 u32 u64 u128 i8 i16 i32 i64 i128 f32 f64 bool char str usize isize Self'.split(' '));
  const CONSTS = new Set('true false null None Some Ok Err'.split(' '));

  const RE = /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|('(?:[^'\\\n]|\\.)')|(#!?\[[^\]\n]*\]?)|(\b0[xX][0-9a-fA-F_]+(?:[iu]\d+)?\b|\b0[bB][01_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?:[iuf]\d+|usize|isize)?\b)|('[A-Za-z_]\w*)|(@[A-Za-z_]\w*)|([A-Za-z_]\w*)|(\s+)|(->|=>|::|\/>|<\/|\S)/gy;

  function nextNonSpace(text, at) {
    while (at < text.length && (text[at] === ' ' || text[at] === '\t')) at++;
    return text[at];
  }

  // A comment, with @param-style tags and `code` spans picked out.
  function commentTokens(text) {
    const out = [];
    const re = /(@(?:param|return|returns|property|see|note|throws))(\s+[A-Za-z_][\w.]*)?|(`[^`\n]+`)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(['cm', text.slice(last, m.index)]);
      if (m[1]) {
        out.push(['dt', m[1]]);
        if (m[2] && m[1] !== '@return' && m[1] !== '@returns') out.push(['dn', m[2]]);
        else if (m[2]) out.push(['cm', m[2]]);
      } else out.push(['cc', m[3]]);
      last = re.lastIndex;
    }
    if (last < text.length) out.push(['cm', text.slice(last)]);
    return out;
  }

  function tokenize(text, path) {
    const rust = /\.rs$/.test(path);
    const markup = /\.dom\.mln$/.test(path);
    const model = /\.model\.mln$/.test(path);
    const KW = rust ? RS_KW : MLN_KW, TY = rust ? RS_TY : MLN_TY;
    const toks = [];
    let prev = null;          // previous significant token text
    let tag = 0;              // inside a markup tag: 1, with a { } depth tracked in braces
    let braces = 0;
    RE.lastIndex = 0;
    let m;
    while (RE.lastIndex < text.length && (m = RE.exec(text))) {
      const s = m[0];
      let cls;
      if (m[1] || m[2]) { toks.push(...commentTokens(s)); continue; }
      else if (m[3]) cls = 'st';
      else if (m[4]) cls = 'st';
      else if (m[5]) cls = rust ? 'an' : 'pu';
      else if (m[6]) cls = 'nu';
      else if (m[7]) cls = rust ? 'lt' : 'pu';
      else if (m[8]) cls = 'an';
      else if (m[9]) {
        const after = text.slice(RE.lastIndex, RE.lastIndex + 1);
        const nx = nextNonSpace(text, RE.lastIndex);
        if (tag && braces === 0) cls = nx === '=' ? 'at' : 'id';
        else if (KW.has(s) || (model && MODEL_KW.has(s))) cls = 'kw';
        else if (CONSTS.has(s)) cls = 'co';
        else if (rust && after === '!' && text[RE.lastIndex + 1] !== '=') cls = 'ma';
        else if (TY.has(s)) cls = 'ty';
        else if (/^[A-Z][A-Z0-9_]+$/.test(s) || /^[A-Z]$/.test(s)) cls = 'co';
        else if (/^[A-Z]/.test(s)) cls = 'ty';
        else if (nx === '(') cls = 'fn';
        else cls = 'id';
      } else if (m[10]) { toks.push(['ws', s]); continue; }
      else {
        cls = 'pu';
        if (markup) {
          const nx = text[RE.lastIndex];
          const opens = (s === '<' || s === '</') && /[A-Z]/.test(nx || '')
            && (prev === null || ['return', '(', '>', '/>', '{', '}', ',', ';'].includes(prev));
          if (opens && !tag) {
            toks.push(['tg', s]);
            const nm = /^[A-Za-z_][\w.]*/.exec(text.slice(RE.lastIndex));
            if (nm) { toks.push(['tg', nm[0]]); RE.lastIndex += nm[0].length; }
            tag = 1; braces = 0; prev = s; continue;
          }
          if (tag) {
            if (s === '{') braces++;
            else if (s === '}') braces = Math.max(0, braces - 1);
            else if ((s === '>' || s === '/>') && braces === 0) { toks.push(['tg', s]); tag = 0; prev = s; continue; }
          }
        }
      }
      toks.push([cls, s]);
      prev = s;
    }
    // Split into lines.
    const lines = [[]];
    for (const [cls, s] of toks) {
      if (s.indexOf('\n') < 0) { lines[lines.length - 1].push([cls, s]); continue; }
      const parts = s.split('\n');
      parts.forEach((p, k) => {
        if (k > 0) lines.push([]);
        if (p) lines[lines.length - 1].push([cls, p]);
      });
    }
    return lines;
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

  // One line as HTML. words: identifiers to mark (the step's own words).
  function lineHTML(tokens, words) {
    let h = '';
    for (const [cls, s] of tokens) {
      if (cls === 'ws') { h += esc(s); continue; }
      const marked = words && words.has(s) && /^[A-Za-z_]\w*$/.test(s) && cls !== 'cm' && cls !== 'st';
      const span = `<span class="t-${cls}">${esc(s)}</span>`;
      h += marked ? `<mark class="echo">${span}</mark>` : span;
    }
    return h;
  }

  window.CTHL = { tokenize, lineHTML, esc };
})();
