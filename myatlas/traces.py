"""Recorded runs: what really ran, in order, with each function tied to the node that describes it.

A trace is a JSON file in the map's traces/ directory. MyProfiler's `trace` command writes them; its
docs/formats.md describes the file.
"""
import json
import re

from . import code_mylang


def name_in_code(project, n):
    """How a function node is named where it runs: the file's namespace and the symbol, or Type.method for
    a method. A node for one statement inside a function (its 型 ends with ;) is part of it, not the function."""
    code = n.get('code')
    if n['kind'] != 'func' or not code or not code[1] or any(x.strip().endswith(';') for x in n.get('_sig', [])):
        return None
    if re.fullmatch(r'\w+\.\w+', n['title']) and n['title'].split('.')[1] == code[1]:
        return n['title']
    ns = code_mylang.namespace_of(project.code_text(code[0]))
    return f'{ns}.{code[1]}' if ns else None


KEEP = ('seq', 'instr', 'thread', 'program', 'fn', 'ev', 'cause', 'service', 'method')


def load_traces(project, nodes, rep):
    """Every trace, its events cut down to what the viewer shows. Sets n['fn'] on the nodes runs can name."""
    by_fn = {}
    for nid, n in nodes.items():
        fn = name_in_code(project, n)
        if fn:
            n['fn'] = fn
            # Two nodes can name one function; the one with a paper inside is the one to open.
            if fn not in by_fn or (n.get('paper') and not nodes[by_fn[fn]].get('paper')):
                by_fn[fn] = nid
    out = []
    for p in sorted(project.traces.glob('*.json')) if project.traces.is_dir() else []:
        try:
            t = json.loads(p.read_text(encoding='utf-8'))
        except ValueError as e:
            rep.error(project.rel(p), f'記録が読めない: {e}')
            continue
        events = []
        for e in t.get('events', []):
            if e.get('ev') not in ('enter', 'irq', 'switch', 'request'):
                continue
            x = {k: e[k] for k in KEEP if e.get(k) is not None}
            if e.get('fn') in by_fn:
                x['n'] = by_fn[e['fn']]
            events.append(x)
        out.append({'id': p.stem, 'title': t.get('title', p.stem), 'date': t.get('date'), 'run': t.get('run', {}),
                    'build': t.get('build', {}).get('sources', {}), 'threads': t.get('threads', {}), 'events': events})
    return out
