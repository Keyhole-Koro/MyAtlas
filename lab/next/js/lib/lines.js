// Where a step happens in the code. In order: the line code.json records for the step (checked: a
// call where the step calls, a write where it writes), the line of a box that stands for one
// statement, then a likely line found from the step's own words and the papers, else nothing.
// Pure: no DOM. CTLINES.make(ATLAS, ATLAS_CODE, {path: [lines]}).
(function () {
  'use strict';
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PRIMS = new Set('i8 i16 i32 i64 u8 u16 u32 u64 u128 f32 f64 bool char str void usize isize'.split(' '));
  const DOTTED = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g;
  const codeOf = (line) => (line || '').replace(/\/\/.*$/, '');
  const isNote = (t) => !t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
  const isAttr = (t) => /^@\w+(\(.*\))?$/.test(t) || /^#!?\[.*\]$/.test(t);
  // A function's first line: a name and its parameters, opening the body.
  const isHead = (c) => /[A-Za-z_]\w*\s*\([^;]*\)?\s*(->\s*[^{;]+)?\{\s*(\}\s*)?$/.test(c) && !/^\s*(if|while|for|case|return|else)\b/.test(c);

  // The step's own words: identifiers in its verb, its sentence and the data it hands over.
  function wordsOf(s) {
    const d = s.data || {};
    const text = [s.verb, s.label, d.label, d.type, ...(d.fields || [])].filter(Boolean).join(' ');
    const set = new Set();
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g)) {
      for (const part of m[0].split('.')) if (part.length >= 2 && !PRIMS.has(part)) set.add(part);
    }
    return set;
  }
  // Words that point at one place: with an underscore (SET_TEXT, send_text) or in capitals (REQUEST).
  const distinctive = (w) => w.includes('_') || /^[A-Z][A-Z0-9]{3,}$/.test(w);

  function make(A, C, RAW) {
    const TR = {};
    const addTrack = (src, id, kind) => {
      const t = { id, kind, src, steps: src.steps, box: Object.fromEntries(src.boxes.map((b) => [b.id, b])) };
      let n = 0, a = 0;
      t.labels = src.steps.map((s) => (s.alt ? 'ABCDEFGH'[a++] : String(++n)));
      TR[id] = t;
    };
    A.flows.forEach((f) => addTrack(f, f.id, 'flow'));
    Object.entries(A.papers).forEach(([id, p]) => addTrack(p, id, 'paper'));

    const loc = (id) => { const l = C.nodes[id]; return l && RAW[l.path] ? l : null; };
    const span = (id) => { const l = loc(id); return l && l.start ? { id, path: l.path, s: l.start, e: l.end || l.start } : null; };
    const text = (path, k) => (RAW[path] && RAW[path][k - 1]) || '';
    const code = (path, k) => codeOf(text(path, k));
    const kindOf = (id) => (A.nodes[id] || {}).kind;
    const title = (id) => (A.nodes[id] || {}).title || id;

    function firstCodeLine(path, s, e) {
      for (let k = s; k <= e; k++) {
        const t = text(path, k).trim();
        if (isNote(t) || isAttr(t)) continue;
        return k;
      }
      return s;
    }
    // A box that stands for one statement (its sig is that statement): the line it is on.
    const statementSig = (id) => {
      const n = A.nodes[id], sig = n && n.api && n.api.sig;
      return sig && !sig.includes('\n') && /;\s*$/.test(sig) ? sig.trim() : null;
    };
    function focusLine(id) {
      const sp = span(id), want = statementSig(id);
      if (!sp || !want) return null;
      for (let k = sp.s; k <= sp.e; k++) if (text(sp.path, k).trim() === want) return k;
      for (let k = sp.s; k <= sp.e; k++) if (text(sp.path, k).includes(want)) return k;
      return null;
    }

    // The function node that owns a line: the smallest span; among equal ones, not a one-statement
    // box, one whose title ends with its code's name (request_gateway.request), then the preferred ids.
    function ownerOf(path, line, prefer = []) {
      const cand = [];
      for (const [id, l] of Object.entries(C.nodes)) {
        if (l.path !== path || !l.start || kindOf(id) !== 'func') continue;
        const e = l.end || l.start;
        if (l.start <= line && line <= e) cand.push({ id, path, s: l.start, e });
      }
      const rank = (c) => {
        const sym = (C.nodes[c.id].symbol || '').split('.').pop();
        const t = title(c.id);
        return (statementSig(c.id) ? 4 : 0) + (t === sym || t.endsWith('.' + sym) ? 0 : 2)
          + (prefer.includes(c.id) ? prefer.indexOf(c.id) / 10 : 1);
      };
      cand.sort((a, b) => (a.e - a.s) - (b.e - b.s) || rank(a) - rank(b));
      return cand[0] || null;
    }

    // Top-level functions of a MyLang file: a head at column 0, the body up to the next "}" there.
    const FUNCS = {};
    function functionsIn(path) {
      if (FUNCS[path]) return FUNCS[path];
      const L = RAW[path] || [], out = [];
      if (!/\.mln$/.test(path)) return (FUNCS[path] = out);
      for (let k = 1; k <= L.length; k++) {
        const t = L[k - 1];
        if (!/^[A-Za-z_]/.test(t) || /^(import|namespace|struct|enum)\b/.test(t)) continue;
        const c = codeOf(t), m = /([A-Za-z_]\w*)\(/.exec(c);
        if (!m || c.slice(0, m.index).includes('=') || /;\s*$/.test(c)) continue;
        let open = k;
        while (open < L.length && open < k + 4 && !/\{\s*(\}\s*)?$/.test(codeOf(L[open - 1]))) open++;
        let end = open;
        if (!/\}\s*$/.test(codeOf(L[open - 1]).replace(/^[^{]*\{/, ''))) {
          while (end < L.length && !/^\}\s*;?\s*$/.test(L[end - 1])) end++;
        }
        out.push({ name: m[1], path, s: k, e: end });
        k = end;
      }
      return (FUNCS[path] = out);
    }
    // Functions of the same file to look in after a box's own code: the ones a function calls, or
    // the ones that use a variable.
    function relatedAreas(id) {
      const sp = span(id), fns = sp ? functionsIn(sp.path) : [];
      if (!sp || !fns.length) return [];
      if (kindOf(id) === 'func') {
        const names = new Set();
        for (let k = sp.s; k <= sp.e; k++) for (const m of code(sp.path, k).matchAll(/(^|[^\w.:])([A-Za-z_]\w*)\s*\(/g)) names.add(m[2]);
        return fns.filter((f) => names.has(f.name) && !(f.s <= sp.s && sp.e <= f.e));
      }
      const sym = (C.nodes[id] || {}).symbol;
      if (!sym || !new RegExp(`\\b${reEsc(sym)}\\s*(=|;|\\[)`).test(code(sp.path, sp.s))) return [];
      const re = new RegExp(`\\b${reEsc(sym)}\\b`);
      return fns.filter((f) => { for (let k = f.s; k <= f.e; k++) if (re.test(code(f.path, k))) return true; return false; });
    }

    // Lines of an area, its head and comments left out.
    function* linesOf(a) {
      if (!a) return;
      const head = firstCodeLine(a.path, a.s, a.e);
      for (let k = a.s; k <= a.e; k++) {
        const c = code(a.path, k);
        const t = c.trim();
        if (!t || isNote(t) || isAttr(t)) continue;
        if (k === head && isHead(c)) continue;
        yield [k, c];
      }
    }
    const find = (a, test) => { for (const [k, c] of linesOf(a)) if (test(c, k)) return { path: a.path, line: k }; return null; };
    const findIn = (areas, test) => { for (const a of areas) { const h = find(a, test); if (h) return h; } return null; };

    // The names a store goes by in code: its title and fields when they are identifiers, and its
    // code name when that line declares it.
    function storeNames(id) {
      const n = A.nodes[id] || {}, out = new Set();
      const clean = (s) => String(s || '').replace(/\[.*$/, '').trim();
      const t = clean(n.title);
      if (/^[A-Za-z_][\w.]*$/.test(t)) out.add(t);
      for (const f of n.fields || []) {
        const x = clean(f[1]).split('.').pop();
        if (/^[A-Za-z_]\w*$/.test(x)) out.add(x);
      }
      const sp = span(id), sym = (C.nodes[id] || {}).symbol;
      if (sp && sym && new RegExp(`\\b${reEsc(sym)}\\s*(=|;)`).test(code(sp.path, sp.s))) out.add(sym);
      return [...out];
    }
    const nameRe = (name) => `(^|[^\\w])${reEsc(name)}\\b`;

    // The checked step line from code.json. It names the line in the from box that names the to box,
    // which also matches a parameter or a variable of the same name: keep a line into a function
    // only where it calls it, and for a write into a store, the line that assigns it.
    const CHECKED = [];
    function stepLine(t, i) {
      const raw = (C.steps[t.id] || {})[String(i)];
      if (!raw || !RAW[raw.path]) return raw || null;
      const s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
      const tl = C.nodes[tb.node], fl = C.nodes[fb.node], tn = A.nodes[tb.node];
      if (!tl || !tl.symbol || !tn) return raw;
      const name = tl.symbol.split('.').pop();
      if (tn.kind === 'func') {
        if (new RegExp(`\\b${reEsc(name)}\\s*\\(`).test(code(raw.path, raw.line))) return raw;
        CHECKED.push({ track: t.id, step: t.labels[i], line: raw.line, became: null });
        return null;
      }
      if (s.kind === 'data' && fl && fl.start) {
        const w = new RegExp(`\\b${reEsc(name)}\\s*=(?!=)`);
        if (w.test(code(raw.path, raw.line))) return raw;
        for (let k = fl.start; k <= (fl.end || fl.start); k++) {
          if (w.test(code(raw.path, k))) { CHECKED.push({ track: t.id, step: t.labels[i], line: raw.line, became: k }); return { path: raw.path, line: k }; }
        }
      }
      return raw;
    }

    // A likely line, with why. Each rule says what it found, so the page can say it too.
    function guess(t, i) {
      const s = t.steps[i], fb = t.box[s.from], tb = t.box[s.to];
      const ref = s.ref || fb.node, fN = A.nodes[fb.node] || {}, tN = A.nodes[tb.node] || {};
      const aRef = span(ref), aFrom = span(fb.node), aTo = span(tb.node);
      const aHost = t.kind === 'paper' ? span(t.id) : null;
      const own = [aRef, fb.node !== ref ? aFrom : null, aHost];
      const label = s.label || '';
      const hit = (h, why, extra) => (h ? Object.assign({ path: h.path, line: h.line, kind: 'likely', why }, extra || {}) : null);
      let h;

      // 1. A statement written in the sentence: "t.last = now".
      for (const m of label.matchAll(/([A-Za-z_][\w.]*)\s*=\s*([A-Za-z_][\w.]*)/g)) {
        const re = new RegExp(`(^|[^\\w.])${reEsc(m[1])}\\s*=\\s*${reEsc(m[2])}\\s*;`);
        if ((h = findIn(own, (c) => re.test(c)))) return hit(h, `文の ${m[1]} = ${m[2]}`, { rule: 'statement' });
      }
      // 2. A call the sentence names: "runtime.send", "t.record".
      const dotted = [...new Set([...(s.verb || '').matchAll(DOTTED), ...label.matchAll(DOTTED)].map((m) => m[0]))];
      for (const d of dotted) {
        const re = new RegExp(`(^|[^\\w.])${reEsc(d)}\\s*\\(`);
        if ((h = findIn(own, (c) => re.test(c)))) return hit(h, `文が呼ぶ ${d}`, { rule: 'call' });
      }
      // 3. The same move drawn inside a paper: leaving a box with a paper, the paper's step to the
      //    same box, or the call to the paper's port box; entering one, the paper's step from the same box.
      // A line found this way counts when it is in the box's own code, or the box is not a function.
      const firm = (w) => w && (w.kind === 'step' || w.kind === 'focus')
        && (kindOf(ref) !== 'func' || (aRef && w.path === aRef.path && aRef.s <= w.line && w.line <= aRef.e));
      const inRef = (h) => h && (kindOf(ref) !== 'func' || (aRef && h.path === aRef.path && aRef.s <= h.line && h.line <= aRef.e));
      if (fN.paper && TR[fN.paper] && fN.paper !== t.id) {
        const P = TR[fN.paper];
        for (let j = 0; j < P.steps.length; j++) {
          if (P.box[P.steps[j].to].node !== tb.node) continue;
          const w = where(P.id, j);
          if (firm(w)) return hit(w, `中の紙の ${P.labels[j]} と同じ行`, { rule: 'paper' });
        }
        const port = (P.src.ports || {})[tb.node], pb = port && P.box[port];
        const sym = pb && (C.nodes[pb.node] || {}).symbol;
        if (sym) {
          const re = new RegExp(`(^|[^\\w])${reEsc(sym)}\\s*\\(`);
          if ((h = find(aFrom, (c) => re.test(c))) && inRef(h)) return hit(h, `中の紙の ${title(pb.node)} を呼ぶ行`, { rule: 'paper' });
        }
      }
      if (tN.paper && TR[tN.paper] && tN.paper !== t.id) {
        const P = TR[tN.paper];
        for (let j = 0; j < P.steps.length; j++) {
          if (P.box[P.steps[j].from].node !== fb.node) continue;
          const w = where(P.id, j);
          if (firm(w)) return hit(w, `中の紙の ${P.labels[j]} と同じ行`, { rule: 'paper' });
        }
      }
      // 4. A dispatcher: the branch on the box's own name (OS_CALL).
      const tt = title(ref);
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(tt)) {
        const re = new RegExp(`(==|\\bcase\\b)\\s*[\\w:.]*\\b${reEsc(tt)}\\b`);
        if ((h = find(aRef, (c) => re.test(c)))) return hit(h, `${tt} で分かれる行`, { rule: 'branch' });
      }
      // 5. Through a queue: where the box sends.
      if (s.kind === 'msg' && (h = find(aRef, (c) => /(^|[^\w])send\s*\(/.test(c)))) return hit(h, '列へ送る send', { rule: 'send' });
      // 6. The sentence's distinctive names (REQUEST, SET_TEXT): the line with most of them, in the
      //    box, the from box, the paper, then the functions of the same file it calls or that use it.
      const words = wordsOf(s), dist = [...wordsOf({ verb: s.verb, label })].filter(distinctive);
      if (dist.length) {
        const best = (a) => {
          let top = null;
          const L = [...linesOf(a)];
          L.forEach(([k, c], j) => {
            const toks = new Set(c.match(/[A-Za-z_]\w*/g) || []);
            const ds = dist.filter((w) => toks.has(w));
            if (!ds.length) return;
            const others = [...words].filter((w) => !distinctive(w) && toks.has(w)).length;
            const nx = L[j + 1] && L[j + 1][0] === k + 1 ? new Set(L[j + 1][1].match(/[A-Za-z_]\w*/g) || []) : new Set();
            const score = 3 * ds.length + others + ([...words].some((w) => nx.has(w)) ? 1 : 0);
            if (!top || score > top.score) top = { path: a.path, line: k, score, word: ds[0], fn: a.name || null };
          });
          return top;
        };
        for (const a of [...own, ...relatedAreas(ref)]) {
          if (!a) continue;
          const b = best(a);
          // In a function of the same file (it is called by the box, or uses the box's variable).
          if (b) return hit(b, `文の ${b.word}`, { rule: 'words', fn: b.fn, rel: b.fn ? (kindOf(ref) === 'func' ? 'calls' : 'uses') : null });
        }
      }
      // 7. A struct box: the fields the step names.
      if (aRef && s.data && s.data.fields && /^(export\s+)?struct\b/.test(code(aRef.path, firstCodeLine(aRef.path, aRef.s, aRef.e)).trim())) {
        const hits = fieldLines(aRef.path, aRef.s, aRef.e, s.data.fields);
        if (hits.length) return { path: aRef.path, line: hits[0], hits, kind: 'fields', why: '手順が挙げる欄', rule: 'fields' };
      }
      // 8. Read from a store: where the function it goes to reads it.
      if (s.kind === 'data' && (fN.kind === 'store' || fN.kind === 'hw')) {
        for (const name of storeNames(fb.node)) {
          const re = new RegExp(nameRe(name) + '(?!\\s*=(?!=))');
          if ((h = findIn([tN.kind === 'func' ? aTo : null, aHost], (c) => re.test(c)))) return hit(h, `${name} を読む行`, { rule: 'read' });
        }
      }
      // 9. Written into a store: where the function it comes from writes it.
      if (s.kind === 'data' && tN.kind === 'store') {
        for (const name of storeNames(tb.node)) {
          const re = new RegExp(`(^|[^\\w.])${reEsc(name)}(\\[[^\\]]*\\]|\\.\\w+)*\\s*=(?!=)`);
          if ((h = findIn([fN.kind === 'func' ? aFrom : null, aHost], (c) => re.test(c)))) return hit(h, `${name} に書く行`, { rule: 'write' });
        }
      }
      // 10. A return: the box's last return.
      if (s.kind === 'return' && aRef && kindOf(ref) === 'func') {
        let last = null;
        for (const [k, c] of linesOf(aRef)) if (/^\s*return\b/.test(c)) last = { path: aRef.path, line: k };
        if (last) return hit(last, '返す行', { rule: 'return' });
      }
      // 11. The data handed over, built: "CpuTimes {".
      const dl = s.data && s.data.label;
      if (dl && /^[A-Z][A-Za-z0-9]+$/.test(dl)) {
        const re = new RegExp(`\\b${reEsc(dl)}\\s*\\{`);
        if ((h = findIn([aRef, fN.kind === 'store' && tN.kind === 'func' ? aTo : null, aHost], (c) => re.test(c)))) return hit(h, `${dl} を作る行`, { rule: 'build' });
      }
      // 12. Inside a paper: where the paper's function calls the box it goes to.
      if (aHost && s.kind === 'call' && tN.kind === 'func') {
        const sym = (C.nodes[tb.node] || {}).symbol;
        if (sym) {
          const re = new RegExp(`(^|[^\\w])${reEsc(sym.split('.').pop())}\\s*\\(`);
          if ((h = find(aHost, (c) => re.test(c)))) return hit(h, `紙の中で ${sym} を呼ぶ行`, { rule: 'host' });
        }
      }
      return null;
    }

    // The struct lines that declare the fields a step names (owner, *s0, a0 … a5, procs[16]).
    function fieldLines(path, s, e, fields) {
      const names = new Set();
      for (const f of fields) {
        const r = /^([A-Za-z_]+)(\d+)\s*…\s*([A-Za-z_]+)(\d+)$/.exec(f.trim());
        if (r && r[1] === r[3]) { for (let k = +r[2]; k <= +r[4]; k++) names.add(r[1] + k); continue; }
        const m = /^\*?([A-Za-z_]\w*)/.exec(f.trim());
        if (m) names.add(m[1]);
      }
      const hits = [];
      for (let k = s; k <= e; k++) {
        const c = ' ' + code(path, k);
        for (const n of names) if (new RegExp(`[\\s*]${reEsc(n)}\\s*(\\[|;)`).test(c)) { hits.push(k); break; }
      }
      return hits;
    }

    const WHERE = {};
    function where(tid, i) {
      const key = tid + ':' + i;
      if (key in WHERE) return WHERE[key];
      WHERE[key] = null;   // a paper that points back here finds nothing
      const t = TR[tid], s = t.steps[i], fb = t.box[s.from];
      const ref = s.ref || fb.node;
      let w = null;
      const sl = stepLine(t, i);
      if (sl && RAW[sl.path]) w = { path: sl.path, line: sl.line, kind: 'step' };
      else {
        const f = focusLine(ref);
        if (f) w = { path: loc(ref).path, line: f, kind: 'focus' };
        else w = guess(t, i);
      }
      return (WHERE[key] = w);
    }

    return { where, span, loc, focusLine, firstCodeLine, ownerOf, fieldLines, wordsOf, distinctive, functionsIn, checked: CHECKED, tracks: TR };
  }

  const api = { make, wordsOf, distinctive };
  if (typeof window !== 'undefined') window.CTLINES = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
