#!/usr/bin/env python3
"""Writes what the lab's prototypes read: the map (as the viewer gets it) and where its code is.

    python3 lab/export.py [--root ~/Workspaces/MyComputer]

data/atlas.json, data/atlas.js   the map: layers, nodes, flows, papers, traces (window.ATLAS)
data/code.json, data/code.js     for each node with code: its file and line range; for each step
                                 of a flow or paper: the line in the caller where it happens
                                 (window.ATLAS_CODE)
data/src/<path>                  a copy of every source file the map points at
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB.parent))
from myatlas.build import public  # noqa: E402
from myatlas.check import load  # noqa: E402
from myatlas.code_mylang import close_paren  # noqa: E402
from myatlas.project import Project, Report  # noqa: E402
from myatlas.traces import load_traces  # noqa: E402


def blank_comments(text):
    """Comments as spaces, so every offset (and every line) stays where it was."""
    text = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)
    return re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), text)


def line_of(text, offset):
    return text.count('\n', 0, offset) + 1


def close_brace(body, open_at):
    depth = 0
    for i in range(open_at, len(body)):
        if body[i] == '{':
            depth += 1
        elif body[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return len(body) - 1


def definition(text, symbol, kind, rust):
    """(start line, end line) of where a symbol is defined, or None."""
    body = blank_comments(text)
    name = symbol.split('.')[-1]
    if kind == 'func':
        pattern = rf'\bfn\s+{re.escape(name)}\s*(<[^>]*>)?\s*\(' if rust else rf'\b{re.escape(name)}\s*\('
        for m in re.finditer(pattern, body):
            close = close_paren(body, m.end() - 1)
            if close is None:
                continue
            rest = body[close + 1:close + 400]
            brace = rest.find('{')
            if brace < 0 or (rest[:brace].strip() and not rest[:brace].strip().startswith('->')):
                continue
            line_start = body.rfind('\n', 0, m.start()) + 1
            before = body[line_start:m.start()].strip()
            if not rust and (not before or before.endswith(('.', '=', '(', ',', 'return', 'else', '!', '&&', '||'))):
                continue
            # Annotations and comments just above belong to it.
            start = line_of(text, line_start)
            lines = text.split('\n')
            while start > 1 and re.match(r'^\s*(@\w|///|//)', lines[start - 2]):
                start -= 1
            return start, line_of(text, close_brace(body, close + 1 + brace))
    for word in ('struct', 'enum', 'model', 'class'):
        m = re.search(rf'\b{word}\s+{re.escape(name)}\b[^{{;]*\{{', body)
        if m:
            return line_of(text, m.start()), line_of(text, close_brace(body, m.end() - 1))
    m = re.search(rf'\b{re.escape(name)}\b', body)
    if m:
        at = line_of(text, m.start())
        return at, at
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', type=Path, default=Path.home() / 'Workspaces' / 'MyComputer')
    args = ap.parse_args()
    project = Project(args.root)
    rep = Report()
    index, layers, nodes, flows, papers = load(project, rep)
    if rep.errors():
        rep.show()
        return 1
    traces = load_traces(project, nodes, rep)
    data = {'title': index['title'], 'docs': project.rel(project.docs), 'how': index['how'], 'layers': layers,
            'nodes': public(nodes), 'flows': public(flows), 'papers': public(papers), 'traces': traces}
    out = LAB / 'data'
    out.mkdir(exist_ok=True)

    root = project.root.resolve()
    home = Path.home().resolve()
    # Written as ~/… so the committed data does not carry this machine's home path.
    shown = '~/' + str(root.relative_to(home)) if root.is_relative_to(home) else str(root)
    code = {'root': shown, 'files': {}, 'nodes': {}, 'steps': {}}
    for nid, n in data['nodes'].items():
        if not n.get('code'):
            continue
        path, symbol = n['code'][0], (n['code'][1] if len(n['code']) > 1 else None)
        text = project.code_text(path)
        if text is None:
            continue
        rust = path.endswith('.rs')
        code['files'].setdefault(path, {'lang': 'rust' if rust else 'mylang', 'lines': text.count('\n') + 1})
        span = definition(text, symbol, n.get('kind'), rust) if symbol else None
        code['nodes'][nid] = {'path': path, 'symbol': symbol, 'start': span[0] if span else None, 'end': span[1] if span else None}
        dest = out / 'src' / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(project.root / path, dest)

    # Where each step happens: the line in the box it starts from that calls the function it goes to,
    # or assigns the store it writes. A bare mention (an argument, a local of the same name, a read)
    # is not where the step happens, so it places nothing; neither does a return.
    def place(step, box_from, box_to):
        a, b = code['nodes'].get(box_from.get('node') or ''), code['nodes'].get(box_to.get('node') or '')
        if step.get('kind') == 'return' or not a or not a.get('start') or not b or not b.get('symbol'):
            return None
        kind = data['nodes'].get(box_to.get('node') or '', {}).get('kind')
        writes = kind == 'store' and data['nodes'].get(box_from.get('node') or '', {}).get('kind') == 'func'
        name = re.escape(b['symbol'].split('.')[-1])
        if kind == 'func':
            pattern = rf'\b{name}\s*\('
        elif writes:
            pattern = rf'\b{name}(\s*\[[^\]]*\])?(\.\w+)*\s*=(?!=)'
        else:
            pattern = rf'\b{name}\b'
        text = project.code_text(a['path']).split('\n')
        for k in range(a['start'] + 1, (a['end'] or a['start']) + 1):
            if k - 1 < len(text) and re.search(pattern, text[k - 1]):
                return {'path': a['path'], 'line': k}
        return None

    for f in data['flows'] + [dict(p, id=pid) for pid, p in data['papers'].items()]:
        boxes = {b['id']: b for b in f['boxes']}
        spots = {}
        for i, st in enumerate(f['steps']):
            if st.get('from') in boxes and st.get('to') in boxes:
                spot = place(st, boxes[st['from']], boxes[st['to']])
                if spot:
                    spots[str(i)] = spot
        code['steps'][f['id']] = spots

    for name, obj, var in (('atlas', data, 'ATLAS'), ('code', code, 'ATLAS_CODE')):
        text = json.dumps(obj, ensure_ascii=False, indent=1)
        (out / f'{name}.json').write_text(text + '\n', encoding='utf-8')
        (out / f'{name}.js').write_text(f'window.{var} = {text};\n', encoding='utf-8')
    found = sum(1 for v in code['nodes'].values() if v['start'])
    spots = sum(len(v) for v in code['steps'].values())
    print(f"{len(data['nodes'])} nodes, {len(code['nodes'])} with code ({found} located), {spots} steps placed in code, "
          f"{len(code['files'])} files")
    return 0


if __name__ == '__main__':
    sys.exit(main())
