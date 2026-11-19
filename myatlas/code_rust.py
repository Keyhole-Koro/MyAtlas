"""What Rust source says about a function: its signature."""
import re

from .code_mylang import close_paren, strip_comments


def find_function(text, sym):
    body = strip_comments(text)
    for m in re.finditer(rf'\bfn\s+{re.escape(sym)}\s*(<[^>]*>)?\s*\(', body):
        close = close_paren(body, m.end() - 1)
        if close is None:
            continue
        params = ' '.join(body[m.end():close].split())
        after = body[close + 1:close + 200].lstrip()
        ret = after[2:after.find('{')].strip() if after.startswith('->') and '{' in after else ''
        return ' '.join(f'fn {sym}({params}) {"-> " + ret if ret else ""}'.split())
    return None


def params_of(sig):
    """The parameter names of `fn name(&mut self, a: u32, (b, c): (u8, u8))`: self, a and the pattern as written."""
    inner = sig[sig.find('(') + 1:sig.rfind(')')] if ') ->' not in sig else sig[sig.find('(') + 1:sig.rfind(') ->')]
    out, depth, cur = [], 0, ''
    for ch in inner:
        if ch in '<([':
            depth += 1
        elif ch in '>)]':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    names = []
    for p in out:
        p = p.strip()
        if re.fullmatch(r'&?\s*(\'\w+\s+)?(mut\s+)?self', p):
            names.append('self')
        elif ':' in p:
            names.append(re.sub(r'^mut\s+', '', p.split(':', 1)[0].strip()))
    return names
