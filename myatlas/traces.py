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


def syscall_of(n):
    """The syscall a function node is, when its 型 says `syscall NAME(…)`. The kernel's dispatch function
    runs every syscall, so such a node is that function only while its own syscall runs."""
    for line in n.get('_sig', []):
        m = re.match(r'syscall\s+(\w+)\s*\(', line.strip())
        if m:
            return m.group(1)
    return None


# What the viewer reads of an event. Returns (exit, iret) are kept too: with them a page can tell how long
# a call ran and what it ran inside.
KEEP = ('seq', 'instr', 'thread', 'program', 'fn', 'ev', 'cause', 'interrupted', 'trap', 'syscall', 'service',
        'method', 'from', 'unwound')


def load_traces(project, nodes, rep):
    """Every trace, each event cut down to what the viewer reads and tied to its node. Sets n['fn'] on the
    nodes runs can name."""
    by_fn = {}
    for nid, n in nodes.items():
        fn = name_in_code(project, n)
        if fn:
            n['fn'] = fn
            key = (fn, syscall_of(n))
            # Two nodes can name one function; the one with a paper inside is the one to open.
            if key not in by_fn or (n.get('paper') and not nodes[by_fn[key]].get('paper')):
                by_fn[key] = nid
    dispatch = {fn for fn, call in by_fn if call}
    out = []
    for p in sorted(project.traces.glob('*.json')) if project.traces.is_dir() else []:
        try:
            t = json.loads(p.read_text(encoding='utf-8'))
        except ValueError as e:
            rep.error(project.rel(p), f'記録が読めない: {e}')
            continue
        events, call, running = [], {}, {}
        for e in t.get('events', []):
            x = {k: e[k] for k in KEEP if e.get(k) is not None}
            ev, fn, thread = e.get('ev'), e.get('fn'), e.get('thread')
            nid = by_fn.get((fn, None))
            if ev == 'irq':
                # A syscall enters the kernel by an interrupt on the calling thread, and the dispatch that
                # follows on that thread runs it.
                call[thread] = e.get('syscall')
            elif ev == 'enter':
                if fn in dispatch and call.get(thread):
                    x['syscall'] = call[thread]
                    nid = by_fn.get((fn, call[thread]), nid)
                running.setdefault((thread, fn), []).append(nid)
            elif ev == 'exit' and running.get((thread, fn)):
                nid = running[(thread, fn)].pop()   # a return belongs to the call it ends
            if nid:
                x['n'] = nid
            events.append(x)
        out.append({'id': p.stem, 'title': t.get('title', p.stem), 'date': t.get('date'), 'run': t.get('run', {}),
                    'build': t.get('build', {}).get('sources', {}), 'threads': t.get('threads', {}), 'events': events})
    return out
