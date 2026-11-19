"""What MyLang source says about a symbol: a function's signature, a struct's fields, an enum's values."""
import re


def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), text, flags=re.S)
    return re.sub(r'//[^\n]*', '', text)


def namespace_of(text):
    m = re.search(r'^\s*namespace\s+(\w+)\s*;', text or '', re.M)
    return m.group(1) if m else None


def close_paren(body, open_at):
    """The index of the parenthesis that closes the one at open_at, or None."""
    depth = 0
    for i in range(open_at, len(body)):
        if body[i] == '(':
            depth += 1
        elif body[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    return None


def find_function(text, sym):
    """The definition's signature, or None. A definition is a type, the name, its parameters and then a body;
    a method has its receiver in parentheses before the name: void (borrow Tasks t) show()."""
    body = strip_comments(text)
    for m in re.finditer(rf'\b{re.escape(sym)}\s*\(', body):
        close = close_paren(body, m.end() - 1)
        if close is None or not body[close + 1:close + 200].lstrip().startswith('{'):
            continue
        params = ' '.join(body[m.end():close].split())
        line_start = body.rfind('\n', 0, m.start()) + 1
        before = re.sub(r'^(export\s+)?(@\w+(\([^)]*\))?\s+)*', '', body[line_start:m.start()].strip()).strip()
        head = re.sub(r'\s*\([^()]*\)$', '', before)
        if not head or head.endswith(('.', '=', '(', ',', 'return', 'else', '!', '&&', '||')) or not re.match(r'^[\w<>,\[\]\*\s.:]+$', head):
            continue
        return f'{" ".join(before.split())} {sym}({params})'
    return None


def params_of(sig):
    """The parameter names of a signature, a method's receiver first."""
    recv = re.match(r'^[^(]*\(([^()]*)\)\s*\w+\s*\(', sig)
    if recv:
        return params_of('f(' + recv.group(1) + ')') + params_of(sig[recv.end() - 1:])
    inner = sig[sig.find('(') + 1:sig.rfind(')')]
    out, depth, cur = [], 0, ''
    for ch in inner:
        if ch in '<(':
            depth += 1
        elif ch in '>)':
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
        m = re.search(r'(\**)(\w+)\s*$', p.strip())
        if m:
            names.append(m.group(2))
    return names


def find_struct(text, name):
    """[[type, name], ...], a pointer's stars kept with the name (char *s0); None when there is no such struct."""
    body = strip_comments(text)
    m = re.search(rf'\bstruct\s+{re.escape(name)}\s*\{{(.*?)\}}\s*;', body, re.S)
    if not m:
        return None
    fields = []
    for decl in m.group(1).split(';'):
        decl = ' '.join(decl.split())
        dm = re.match(r'^(.+?)\s+(\**\w+(?:\[\w*\])?)$', decl) if decl else None
        if dm:
            fields.append([dm.group(1), dm.group(2)])
    return fields


def find_enum(text, name):
    body = strip_comments(text)
    m = re.search(rf'\benum\s+{re.escape(name)}\s*\{{(.*?)\}}', body, re.S)
    if not m:
        return None
    return [v.split('=')[0].strip() for v in m.group(1).split(',') if v.strip()]


def has_word(text, sym):
    return re.search(rf'\b{re.escape(sym)}\b', strip_comments(text)) is not None
