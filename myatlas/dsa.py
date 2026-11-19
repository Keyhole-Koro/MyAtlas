"""Data structures and algorithms in the map: a node's shape, its states, its operations and its invariants.

The text binds each role of a shape to a name in the code (the ring's read index is `head`), and the check
looks the names up. Sizes come from the code: a constant, an array's length or an entity's max. A state
machine names the functions that make each move, and the check finds every place the code stores a state,
so a move the text leaves out is reported.
"""
import re

from . import code_mylang

SHAPES = {'リング': 'ring', 'リスト': 'list', '表': 'table', '木': 'tree'}
# role word -> (key, what the value is): a name in the code, a size the code states, or free text
ROLES = {
    'ring': {'枠': ('n', 'size'), '読む': ('read', 'name'), '書く': ('write', 'name'), '1 通': ('item', 'size')},
    'list': {'先頭': ('head', 'name'), '次': ('next', 'name or text'), '頭': ('header', 'size'),
             '順': ('order', 'text'), '繰り上げ': ('bump', 'name')},
    'table': {'枠': ('n', 'size'), '鍵': ('key', 'name'), '空き': ('empty', 'name or text')},
    'tree': {'子': ('children', 'name'), '親': ('parent', 'name'), '節': ('n', 'size'), '兄弟の順': ('order', 'text')},
}
# the operations the viewer can play on each shape
OPS = {
    'ring': ('入れる', '出す'),
    'list': ('先頭から探す', '順に差し込む', '先頭に積む', '先頭から取る'),
    'table': ('一周して探す',),
    'tree': ('深さ優先', '最後に当たったもの'),
}
START = 'はじめ'
IDENT = re.compile(r'^[A-Za-z_]\w*$')
PLAIN_WORDS = {'mod', 'max', 'min', 'O', 'n', 'and', 'or', 'not', 'true', 'false', 'B', 'KiB', 'MiB'}


def parse_shape(text, where, rep):
    m = re.match(r'^\[\[([\w.\-]+)\]\]$', text)
    if m:
        return {'of': m.group(1)}
    m = re.match(r'^(\S+?)（(.*)）$', text)
    if not m or m.group(1) not in SHAPES:
        rep.error(where, f'形は「{"・".join(SHAPES)}（役割 名前、…）」か「[[節]]」: {text}')
        return None
    kind = SHAPES[m.group(1)]
    roles = {}
    for item in [x.strip() for x in m.group(2).split('、') if x.strip()]:
        word = next((w for w in sorted(ROLES[kind], key=len, reverse=True) if item.startswith(w + ' ')), None)
        if not word:
            rep.error(where, f'{m.group(1)}の役割は {"・".join(ROLES[kind])}: {item}')
            continue
        key, what = ROLES[kind][word]
        value = item[len(word) + 1:].strip()
        if what == 'size':
            name, _, unit = value.partition(' ')
            roles[key] = {'name': name, **({'unit': unit.strip()} if unit.strip() else {})}
        elif what == 'text' or (what == 'name or text' and not IDENT.match(value)):
            roles[key] = {'text': value}
        else:
            roles[key] = {'name': value}
    return {'kind': kind, 'roles': roles}


def attach_own(project, nid, n, rep):
    """A node's own shape, states, operations and invariants, checked against its code."""
    where = n['_where']
    code = n.get('code')
    text = project.code_text(code[0]) if code else None
    if '_shape' in n:
        src, swhere = n.pop('_shape')
        shape = parse_shape(src, swhere, rep)
        if shape and 'of' not in shape:
            for key, role in shape['roles'].items():
                name = role.get('name')
                if not name:
                    continue
                if text is None:
                    rep.error(swhere, f'{nid}: 形の {name} を確かめるコードが無い（節にコードを書く）')
                    continue
                if ROLES[shape['kind']][next(w for w, (k, _) in ROLES[shape['kind']].items() if k == key)][1] == 'size':
                    num = int(name) if name.isdigit() else code_mylang.find_number(text, name)
                    if num is None:
                        rep.error(swhere, f'{nid}: {code[0]} に {name} の大きさが無い（定数・配列・entity の max）')
                    else:
                        role['num'] = num
                elif not code_mylang.has_word(text, name):
                    rep.error(swhere, f'{nid}: 形の {name} が {code[0]} に無い')
        if shape:
            n['shape'] = shape
    for op in n.get('ops', []):
        w = op.pop('_where')
        m = re.match(r'^\[\[([\w.\-]+)\]\]$', op['name'])
        if m:
            op['node'] = m.group(1)
        elif text is None or not any(name == op['name'] for name, _ in code_mylang.functions(text)):
            rep.error(w, f'{nid}: 操作 {op["name"]} は {code[0] if code else "コード"} の関数に無い（[[節]] でも書ける）')
    for inv in n.get('invariants', []):
        names = {r.get('name') for r in (n.get('shape') or {}).get('roles', {}).values()}
        for word in re.findall(r'\b[A-Za-z_]\w*\b', inv):
            if word in PLAIN_WORDS or word in names:
                continue
            if text is None or not code_mylang.has_word(text, word):
                rep.error(where, f'{nid}: 不変の {word} が {code[0] if code else "コード"} に無い')
    if '_states' in n:
        attach_states(nid, n, code, text, rep)


def attach_states(nid, n, code, text, rep):
    """A state machine on an enum: the field that holds the state and the moves between its values."""
    st = n.pop('_states')
    where = n['_where']
    if n['kind'] != 'enum' or not code or text is None:
        rep.error(where, f'{nid}: 状態 は、コードのある列挙の節に書く')
        return
    enum = code[1]
    values = [v for v, _ in n.get('values', [])]
    field = st.get('field', '')
    owner, _, name = field.partition('.')
    fields = code_mylang.find_struct(text, owner) if owner else None
    if not name or fields is None or not any(nm == name and t == enum for t, nm in fields):
        rep.error(where, f'{nid}: 状態の欄 {field or "（無い）"} は {code[0]} の構造体の {enum} 型の欄にする（Thread.state など）')
        return
    stored = set(code_mylang.stores(text, enum, name))
    covered = set()
    for mv in st['moves']:
        w = mv.pop('_where')
        for end in (mv['from'], mv['to']):
            if end not in values and not (end == START and end == mv['from']):
                rep.error(w, f'{nid}: {end} は {enum} の値に無い（はじめ は移る元にだけ書ける）')
        for fn in mv['fns']:
            if (fn, mv['to']) in stored:
                covered.add((fn, mv['to']))
            elif not any(f == fn for f, _ in code_mylang.functions(text)):
                rep.error(w, f'{nid}: {fn} は {code[0]} の関数に無い')
            else:
                rep.error(w, f'{nid}: {fn} は {field} を {mv["to"]} にしていない')
    for fn, value in sorted(stored - covered):
        rep.warn(where, f'{nid}: {fn} も {field} を {value} にするが、移る に無い')
    n['states'] = {'field': field, 'moves': st['moves']}


def attach_dsa(project, nodes, rep):
    """Shapes and states for every node; a shape given as [[node]] borrows that node's."""
    for nid, n in nodes.items():
        attach_own(project, nid, n, rep)
    for nid, n in nodes.items():
        shape = n.get('shape')
        if shape and 'of' in shape:
            target = nodes.get(shape['of'])
            if not target or not target.get('shape') or 'of' in target['shape']:
                rep.error(n['_where'], f'{nid}: 形 [[{shape["of"]}]] は、自分の形を持つ節にする')
                del n['shape']
        if n.get('ops'):
            base = n.get('shape') if n.get('shape') and 'of' not in n['shape'] else nodes.get((n.get('shape') or {}).get('of'), {}).get('shape')
            if not base:
                rep.error(n['_where'], f'{nid}: 操作 は 形 のある節に書く')
                continue
            for op in n['ops']:
                if op.get('kind') and op['kind'] not in OPS[base['kind']]:
                    rep.error(n['_where'], f'{nid}: 操作 {op["name"]} の {op["kind"]} は、{base["kind"]} では {"・".join(OPS[base["kind"]])} のどれか')
                if op.get('node') and (op['node'] not in nodes or nodes[op['node']]['kind'] != 'func'):
                    rep.error(n['_where'], f'{nid}: 操作 [[{op["node"]}]] は関数の節にする')
