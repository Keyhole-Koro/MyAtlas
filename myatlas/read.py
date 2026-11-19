"""Reading the map's text: the index, the layer files (nodes) and the flow files (flows and papers).

docs/FORMAT.md describes what is written where.
"""
import re

KINDS = {'関数': 'func', '置き場': 'store', 'レジスタ': 'hw', '構造体': 'schema', '列挙': 'enum',
         '実行の文脈': 'context', '方針': 'note', '図': 'figure'}
EDGES = {'呼び出し': 'call', 'syscall': 'syscall', '戻り': 'return', '通知': 'signal', '割り込み': 'signal',
         '列を通す': 'msg', '読み書き': 'data', '読む': 'data', '書く': 'data'}
LINK = re.compile(r'!?\[\[([\w.\-]+)\]\]')
STEP = re.compile(r'^(?:(\d+)\.|もし\s+(.+?)（(\d+)\s*(の代わり|のあと)）\.)\s+(\S+)\s+→\s+(\S+)\s+'
                  r'(' + '|'.join(sorted(EDGES, key=len, reverse=True)) + r')(?:「([^」]*)」)?(.*)$')


def read_index(project):
    """atlas.md: the map's title, the layers top to bottom, the cross-cutting ones, the flows to show,
    and the commands the project checks the map and records runs with."""
    text = project.index.read_text(encoding='utf-8')

    def field(name):
        m = re.search(rf'^{name}[^：\n]*：(.*)$', text, re.M)
        return m.group(1).strip() if m else ''
    first = text.splitlines()[0] if text else ''
    return {'title': first[2:].strip() if first.startswith('# ') else '文書マップ',
            'stack': field('層').split(), 'cross': field('横断').split(), 'flows': field('流れ').split(),
            'how': {k: v for k, v in (('check', field('照合')), ('trace', field('記録'))) if v}}


def parse_layer(project, path, layer_id, rep):
    lines = path.read_text(encoding='utf-8').splitlines()
    m = re.match(r'#\s+(.+?)（(.+)）\s*$', lines[0]) if lines else None
    if not m:
        rep.error(project.rel(path), '1 行目は「# 名前（説明）」')
        name, sub = layer_id, ''
    else:
        name, sub = m.group(1), m.group(2)
    nodes = {}
    cur, meta_done, body, raw = None, False, [], []

    def finish():
        if cur is not None:
            cur['src'] = '\n'.join(raw).strip() + '\n'
            cur['text'] = '\n'.join(p for p in '\n'.join(body).split('\n\n') if p.strip()).strip()
            cur['text'] = '\n'.join(x.strip() for x in cur['text'].split('\n') if x.strip())

    for no, line in enumerate(lines[1:], start=2):
        where = f'{project.rel(path)}:{no}'
        if line.startswith('## '):
            finish()
            parts = line[3:].strip().split(None, 1)
            nid, title = parts[0], parts[1].strip() if len(parts) > 1 else parts[0]
            if nid in nodes:
                rep.error(where, f'節 {nid} が 2 回ある（実体は 1 つ）')
            cur = {'layer': layer_id, 'title': title, 'code': None, '_where': where}
            nodes[nid] = cur
            meta_done, body, raw = False, [], [line]
            continue
        if cur is None:
            continue
        raw.append(line)
        if not meta_done:
            if not line.strip():
                meta_done = True
                continue
            parse_meta(cur, line, where, rep)
        else:
            body.append(line)
    finish()
    return {'id': layer_id, 'name': name, 'sub': sub}, nodes


def parse_meta(node, line, where, rep):
    """The facts under a node's heading: the kind and the code on the first line, then one fact a line."""
    if 'kind' not in node:
        head, _, rest = line.partition('・')
        kind = KINDS.get(head.strip())
        if not kind:
            rep.error(where, f'種類「{head}」が分からない（{"・".join(KINDS)}）')
            kind = 'note'
        node['kind'] = kind
        if rest:
            path, _, sym = rest.partition(' の ')
            node['code'] = [path.strip(), sym.strip() or None]
        return
    key, sep, val = line.partition('：')
    if not sep:
        rep.error(where, f'事実の行は「名前：値」: {line}')
        return
    key = key.strip()
    if key == 'レジスタ':
        node['reg'] = val.strip()
    elif key == '中の紙':
        node['paper'] = val.strip()
    elif key == '型':
        node.setdefault('_sig', []).append(val.rstrip())   # the indent of a continued line stays
    elif key == '返す':
        node.setdefault('api', {})['ret'] = val.strip()
    elif key.startswith('引数 '):
        node.setdefault('api', {}).setdefault('params', []).append([key[3:].strip(), val.strip()])
    elif key.startswith('フィールド '):
        m = re.match(r'フィールド (.+?)（(.+)）$', key)
        name, typ = (m.group(1), m.group(2)) if m else (key[6:].strip(), None)
        node.setdefault('_fields_doc', []).append([name, typ, val.strip()])
    elif key.startswith('値 '):
        node.setdefault('_values_doc', []).append([key[2:].strip(), val.strip()])
    elif key == '図':
        node['_figure_file'] = val.strip()
    elif key == '形':
        node['_shape'] = (val.strip(), where)
    elif key == '状態の欄':
        node.setdefault('_states', {'moves': []})['field'] = val.strip()
    elif key.startswith('移る '):
        m = re.match(r'移る (\S+) → (\S+)$', key)
        if not m:
            rep.error(where, f'移る の行は「移る A → B：関数・関数」: {line}')
            return
        fns = [x.strip() for x in re.split(r'[・、,]', val) if x.strip()]
        node.setdefault('_states', {'moves': []})['moves'].append({'from': m.group(1), 'to': m.group(2), 'fns': fns, '_where': where})
    elif key.startswith('操作 '):
        name, _, kind = key[3:].strip().partition(' ')
        text, _, cost = val.partition('｜')
        op = {'name': name, 'text': text.strip(), '_where': where}
        if kind.strip():
            op['kind'] = kind.strip()
        if cost.strip():
            op['cost'] = cost.strip()
        node.setdefault('ops', []).append(op)
    elif key == '不変':
        node.setdefault('invariants', []).append(val.strip())
    elif key == '走る':
        node['run'] = val.strip()
    elif key == 'カーネルの中':
        if val.strip() not in ('はい', 'いいえ'):
            rep.error(where, f'カーネルの中 は「はい」か「いいえ」: {val.strip()}')
        node['kernel'] = val.strip() == 'はい'
    else:
        rep.error(where, f'知らない事実「{key}」')


def parse_data(text, where, rep):
    """渡す <label>[=[[schema]]][{a, b}][「type」][ 札なし]"""
    m = re.match(r'^(.+?)(=\[\[[\w.\-]+\]\])?(\{[^}]*\})?(「[^」]*」)?(\s+札なし)?\s*$', text)
    if not m:
        rep.error(where, f'渡すデータが読めない: {text}')
        return None
    d = {'label': m.group(1).strip()}
    if m.group(2):
        d['schema'] = m.group(2)[3:-2]
    if m.group(3):
        d['fields'] = [x.strip() for x in m.group(3)[1:-1].split(',') if x.strip()]
    if m.group(4):
        d['type'] = m.group(4)[1:-1]
    if m.group(5):
        d['chip'] = False
    return d


def parse_bits(text, where, rep):
    """ビット tick 数 24、進み 8: the fields of a register from the high bits down, each with its width."""
    out = []
    for item in text.split('、'):
        label, _, width = item.strip().rpartition(' ')
        if not label or not width.isdigit():
            rep.error(where, f'ビットは「名前 幅、名前 幅」: {item.strip()}')
            return True
        out.append([label, int(width)])
    return out


REGION_ATTRS = {'短く': 'label3', '位置': 'at', '時系列': 'seq'}


def parse_flow(project, path, rep):
    """A flow, or the paper inside a node (its file is named after the paper)."""
    lines = path.read_text(encoding='utf-8').splitlines()
    rel = project.rel(path)
    f = {'id': path.stem, 'boxes': [], 'regions': [], 'steps': [], '_file': rel,
         'src': f'# {rel}\n' + '\n'.join(lines) + '\n'}
    band = None
    step = None
    if lines and lines[0].startswith('# '):
        f['_h1'] = lines[0][2:].strip()
    rest = lines[1:]
    if rest and rest[0].strip() and not re.match(r'^(入口|出口|はじめ|文脈|帯|箱|\d+\.|もし)', rest[0]):
        f['_subtitle'] = rest[0].strip()
        rest = rest[1:]
    start_no = 2 if '_subtitle' in f else 1
    for no, raw in enumerate(rest, start=start_no + 1):
        where = f'{rel}:{no}'
        line = raw.rstrip()
        if not line.strip():
            continue
        s = line.strip()
        indented = line.startswith((' ', '\t'))
        if indented and step is not None and not s.startswith('箱 '):
            if s.startswith('渡す値：'):
                (step.setdefault('data', {'label': ''}))['note'] = s[4:].strip()
            elif s.startswith('操作：'):
                for part in s[3:].split('／'):
                    m = re.match(r'\s*\[\[([\w.\-]+)\]\]\s*(\S+)\s*$', part)
                    if m:
                        step.setdefault('ops', []).append({'node': m.group(1), 'kind': m.group(2)})
                    else:
                        rep.error(where, f'手順の操作は「操作：[[節]] 入れる」: {part.strip()}')
            elif s.startswith('分かれる：'):
                step['branches'] = [[a.strip(), b.strip()] for a, _, b in (x.partition('→') for x in s[5:].split('／'))]
            elif 'label' not in step:
                step['label'] = s
            else:
                step['label'] += s
            continue
        if s.startswith('入口：'):
            f['entry'] = s[3:].strip()
        elif s.startswith('入口 '):
            m = re.match(r'入口 \[\[([\w.\-]+)\]\]：(\S+)', s)
            if m:
                f.setdefault('entries', {})[m.group(1)] = m.group(2)
            else:
                rep.error(where, f'入口の行が読めない: {s}')
        elif s.startswith('出口 '):
            m = re.match(r'出口 \[\[([\w.\-]+)\]\]：(\S+)', s)
            if m:
                f.setdefault('ports', {})[m.group(1)] = m.group(2)
            else:
                rep.error(where, f'出口の行が読めない: {s}')
        elif s.startswith('はじめ：'):
            f['start_no'] = int(s[4:].strip())
        elif s.startswith('文脈 '):
            m = re.match(r'文脈 \[\[([\w.\-]+)\]\] (.+?)：(.+)$', s)
            if not m:
                rep.error(where, f'文脈の行が読めない: {s}')
                continue
            label, *attrs = [x.strip() for x in m.group(3).split('｜')]
            rg = {'node': m.group(1), 'boxes': m.group(2).split(), 'label': label}
            for a in attrs:
                k, _, v = a.partition(' ')
                if k in REGION_ATTRS:
                    rg[REGION_ATTRS[k]] = v.strip()
                else:
                    rep.error(where, f'文脈の知らない指定「{k}」')
            f['regions'].append(rg)
        elif s.startswith('帯 '):
            m = re.match(r'帯 (\S+) (.+?)／(.+?)（(\w+)）$', s)
            if not m:
                rep.error(where, f'帯の行が読めない: {s}')
                continue
            band = m.group(1)
            f.setdefault('bands', []).append({'id': band, 'name': m.group(2), 'sub': m.group(3), 'tone': m.group(4)})
        elif s.startswith('箱 '):
            m = re.match(r'箱 (\S+) \[\[([\w.\-]+)\]\] (.+)$', s)
            if not m:
                rep.error(where, f'箱の行が読めない: {s}')
                continue
            title, *attrs = [x.strip() for x in m.group(3).split('｜')]
            b = {'id': m.group(1), 'node': m.group(2), 'title': title, '_where': where}
            if band and indented:
                b['layer'] = band
            for a in attrs:
                k, _, v = a.partition(' ')
                v = v.strip()
                if k == '略':
                    b['short'] = v
                elif k == '名前空間':
                    b['ns'] = v
                elif k == '説明':
                    b['sub'] = v
                elif k == '中身':
                    b['slots'] = [x.strip() for x in v.split(',')]
                elif k == '中身の形':
                    b['slotSchema'] = v.strip('[]')
                elif k == 'ビット':
                    b['bits'] = parse_bits(v, where, rep) if v else True
                elif k == '段':
                    b['lane'] = int(v)
                else:
                    rep.error(where, f'箱の知らない指定「{k}」')
            f['boxes'].append(b)
        else:
            m = STEP.match(s)
            if not m:
                rep.error(where, f'手順の行が読めない: {s}')
                step = None
                continue
            no_main, when, at, how, a, b, kind, verb, tail = m.groups()
            step = {'kind': EDGES[kind], 'from': a, 'to': b, '_where': where}
            if verb:
                step['verb'] = verb
            if when:
                step['alt'] = {'at': int(at) - 1, 'when': when}
                if how == 'のあと':
                    step['alt']['also'] = True
            elif int(no_main) != len([x for x in f['steps'] if 'alt' not in x]) + 1:
                rep.warn(where, f'手順の番号 {no_main} が順番どおりでない')
            tail = tail.strip()
            rm = re.search(r'(?<!=)\[\[([\w.\-]+)\]\]\s*$', tail)
            if rm:
                step['ref'] = rm.group(1)
                tail = tail[:rm.start()].strip()
            if tail.startswith('渡す '):
                d = parse_data(tail[3:].strip(), where, rep)
                if d:
                    step['data'] = d
            elif tail:
                rep.error(where, f'手順の行の終わりが読めない: {tail}')
            f['steps'].append(step)
    return f
