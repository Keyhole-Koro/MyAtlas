"""Loading the whole map and checking it against itself and against the code.

Types, signatures, struct fields and enum values come from the code a node points at; the text adds what
they mean. Anything that no longer matches is reported.
"""
import re

from . import code_mylang, code_rust
from .dsa import OPS, attach_dsa
from .read import LINK, parse_flow, parse_layer, read_index


def field_matches(doc_name, code_names):
    """A described field may cover a run: 'a0 … a5' names a0 to a5."""
    m = re.match(r'^(\**)([A-Za-z_]+)(\d+)\s*…\s*\2(\d+)$', doc_name)
    if m:
        want = [f'{m.group(1)}{m.group(2)}{i}' for i in range(int(m.group(3)), int(m.group(4)) + 1)]
        return [w for w in want if w in code_names]
    return [doc_name] if doc_name in code_names else []


def text_only(n):
    """A node the code cannot fill: what the text says is all there is."""
    if n.get('_fields_doc'):
        n['fields'] = [[t or '', nm, d] for nm, t, d in n['_fields_doc']]
    if n.get('_values_doc'):
        n['values'] = n['_values_doc']
    if n.get('_sig'):
        n.setdefault('api', {})['sig'] = '\n'.join(n['_sig'])


def attach_code(project, nid, n, rep):
    """Fill the signature, fields and values from the code the node points at, and check the text against it."""
    where = n['_where']
    code = n.get('code')
    if not code:
        text_only(n)
        return
    path, sym = code
    text = project.code_text(path)
    if text is None:
        rep.error(where, f'{nid}: コードのファイルが無い: {path}')
        return
    rust = path.endswith('.rs')
    kind = n['kind']
    if kind == 'func' and sym:
        sig = (code_rust if rust else code_mylang).find_function(text, sym)
        if n.get('_sig'):
            # Written by hand: a function the reader cannot take apart, or one statement inside a function.
            n.setdefault('api', {})['sig'] = '\n'.join(n['_sig'])
            if not sig and not code_mylang.has_word(text, sym):
                rep.error(where, f'{nid}: {path} に {sym} が見つからない')
            flat = ' '.join(code_mylang.strip_comments(text).split())
            for line in n['_sig']:
                if line.strip().endswith(';') and ' '.join(line.split()) not in flat:
                    rep.error(where, f'{nid}: 「{line.strip()}」が {path} に無い')
            have = [p for line in n['_sig'] if not line.strip().endswith(';') for p in code_mylang.params_of(line)]
            for p, _ in n.get('api', {}).get('params', []):
                if p not in have:
                    rep.error(where, f'{nid}: 引数 {p} は手で書いた型に無い')
            return
        if not sig:
            rep.error(where, f'{nid}: {path} に関数 {sym} が見つからない（「型：」で書くこともできる）')
            return
        n.setdefault('api', {})['sig'] = sig
        have = (code_rust if rust else code_mylang).params_of(sig)
        for p, _ in n.get('api', {}).get('params', []):
            if p not in have:
                rep.error(where, f'{nid}: 引数 {p} はコードの {sym} に無い（{", ".join(have) or "引数なし"}）')
        return
    if kind in ('schema', 'store') and sym and sym[:1].isupper() and not rust:
        fields = code_mylang.find_struct(text, sym)
        if fields is None:
            rep.error(where, f'{nid}: {path} に構造体 {sym} が見つからない')
            return
        names = [nm for _, nm in fields]
        typ = dict((nm, t) for t, nm in fields)
        used, out = set(), []
        for nm, t, d in n.get('_fields_doc', []):
            hit = field_matches(nm, names)
            if not hit:
                rep.error(where, f'{nid}: フィールド {nm} は {sym} に無い')
                out.append([t or '', nm, d])
                continue
            used.update(hit)
            out.append([t or typ[hit[0]], nm, d])
        for nm in names:
            if nm not in used:
                rep.warn(where, f'{nid}: {sym}.{nm} に説明が無い')
                out.append([typ[nm], nm, ''])
        n['fields'] = out
        return
    if kind == 'enum' and sym:
        values = code_mylang.find_enum(text, sym)
        if values is None:
            rep.error(where, f'{nid}: {path} に列挙 {sym} が見つからない')
            return
        rows = n.get('_values_doc', [])
        for nm, _ in rows:
            if nm != '…' and nm not in values:
                rep.error(where, f'{nid}: 値 {nm} は {sym} に無い')
        if any(nm == '…' for nm, _ in rows):
            n['values'] = rows   # the text shows some values and sums up the rest with …
            return
        doc = dict(rows)
        missing = [v for v in values if v not in doc]
        if missing and doc:
            rep.warn(where, f'{nid}: {sym} の {", ".join(missing)} に説明が無い')
        n['values'] = [[v, doc.get(v, '')] for v in values]
        return
    # anything else: the symbol has to be there
    if sym and not code_mylang.has_word(text, sym):
        rep.error(where, f'{nid}: {path} に {sym} が見つからない')
    text_only(n)


def load(project, rep):
    """Read the map, fill it from the code and check it. Returns the index, layers, nodes, flows and papers."""
    index = read_index(project)
    where_index = project.rel(project.index)
    layers, nodes = [], {}
    for lid in index['stack'] + index['cross']:
        p = project.docs / 'layers' / f'{lid}.md'
        if not p.is_file():
            rep.error(where_index, f'層 {lid} のファイルが無い: {project.rel(p)}')
            continue
        info, ns = parse_layer(project, p, lid, rep)
        info['cross'] = lid in index['cross']
        layers.append(info)
        for k, v in ns.items():
            if k in nodes:
                rep.error(v['_where'], f'節 {k} は {nodes[k]["_where"]} にもある（実体は 1 つ）')
            nodes[k] = v
    for nid, n in nodes.items():
        attach_code(project, nid, n, rep)
        if n.get('_figure_file'):
            fp = project.docs / n['_figure_file']
            if fp.is_file():
                n['figure'] = fp.read_text(encoding='utf-8')
            else:
                rep.error(n['_where'], f'{nid}: 図のファイルが無い: {project.rel(fp)}')
    attach_dsa(project, nodes, rep)
    flows, papers = [], {}
    for fid in index['flows']:
        p = project.docs / 'flows' / f'{fid}.md'
        if not p.is_file():
            rep.error(where_index, f'流れ {fid} のファイルが無い: {project.rel(p)}')
            continue
        f = parse_flow(project, p, rep)
        f['tab'], f['title'] = f.get('_h1', fid), f.get('_subtitle', f.get('_h1', fid))
        flows.append(f)
    owners = {n['paper']: k for k, n in nodes.items() if n.get('paper')}
    flow_dir = project.docs / 'flows'
    for p in sorted(flow_dir.glob('*.md')) if flow_dir.is_dir() else []:
        if p.stem in index['flows']:
            continue
        f = parse_flow(project, p, rep)
        owner = owners.get(p.stem)
        if not owner:
            rep.error(f['_file'], f'中の紙 {p.stem} を持つ節が無い（どこかの節に「中の紙：{p.stem}」を書く）')
            continue
        h1 = f.get('_h1', nodes[owner]['title'] + ' の中')
        f['tab'] = h1[:-3].strip() if h1.endswith(' の中') else nodes[owner]['title']
        f['title'] = h1
        papers[p.stem] = f
    for pid, owner in owners.items():
        if pid not in papers:
            rep.error(nodes[owner]['_where'], f'{owner}: 中の紙 {pid} のファイル {project.rel(flow_dir / (pid + ".md"))} が無い')
    check_model(layers, nodes, flows, papers, rep)
    return index, layers, nodes, flows, papers


def check_model(layers, nodes, flows, papers, rep):
    """Every pointer, box, step and port has to land on something that exists."""
    layer_ids = {l['id'] for l in layers}
    runs = []
    for nid, n in nodes.items():
        if n['layer'] not in layer_ids:
            rep.error(n['_where'], f'{nid}: 層 {n["layer"]} が無い')
        if ('run' in n or 'kernel' in n) and n['kind'] != 'context':
            rep.error(n['_where'], f'{nid}: 走る・カーネルの中 は実行の文脈にだけ書く')
        if n['kind'] == 'context' and n.get('run') and n['run'] not in runs:
            runs.append(n['run'])   # the viewer's colours go in this order
        texts = [n.get('text', '')] + [d for _, d in n.get('api', {}).get('params', [])] + [n.get('api', {}).get('ret', '')]
        texts += [d for *_, d in n.get('_fields_doc', [])] + [d for _, d in n.get('_values_doc', [])]
        texts += [op['text'] for op in n.get('ops', [])] + n.get('invariants', [])
        for t in texts:
            for m in LINK.finditer(t or ''):
                if m.group(1) not in nodes:
                    rep.error(n['_where'], f'{nid}: ポインタ [[{m.group(1)}]] の先が無い')
    if len(runs) > 3:
        where = next(n['_where'] for n in nodes.values() if n['kind'] == 'context' and n.get('run') == runs[3])
        rep.warn(where, f'走るの色は 3 つまで。{"、".join(runs[3:])} の文脈には色が付かない')
    for f in flows + list(papers.values()):
        where = f['_file']
        ids = {b['id'] for b in f['boxes']}
        bands = {b['id'] for b in f.get('bands', [])}
        for b in f['boxes']:
            if b['node'] not in nodes:
                rep.error(b['_where'], f'箱 {b["id"]} の節 {b["node"]} が無い')
                continue
            if 'layer' not in b:
                b['layer'] = nodes[b['node']]['layer']
            if f.get('bands') and b['layer'] not in bands:
                rep.error(b['_where'], f'箱 {b["id"]} の帯 {b["layer"]} が無い')
            if b.get('slotSchema') and b['slotSchema'] not in nodes:
                rep.error(b['_where'], f'箱 {b["id"]} の中身の形 {b["slotSchema"]} が無い')
        for rg in f['regions']:
            if rg['node'] not in nodes:
                rep.error(where, f'文脈 {rg["node"]} の節が無い')
            for x in rg['boxes']:
                if x not in ids:
                    rep.error(where, f'文脈 {rg["node"]} の箱 {x} が無い')
        main = [s for s in f['steps'] if 'alt' not in s]
        for st in f['steps']:
            w = st['_where']
            for e in (st['from'], st['to']):
                if e not in ids:
                    rep.error(w, f'手順の箱 {e} が無い')
            if 'ref' not in st and st['from'] in ids:
                st['ref'] = next(b['node'] for b in f['boxes'] if b['id'] == st['from'])
            if st.get('ref') and st['ref'] not in nodes:
                rep.error(w, f'手順の節 [[{st["ref"]}]] が無い')
            if 'label' not in st:
                rep.error(w, '手順の説明（次の行）が無い')
                st['label'] = ''
            d = st.get('data')
            if d:
                if 'schema' not in d:
                    bare = d['label'].lstrip('&*')
                    hit = [k for k, n in nodes.items() if n['kind'] in ('schema', 'enum') and n['title'] == bare]
                    if hit:
                        d['schema'] = hit[0]
                elif d['schema'] not in nodes:
                    rep.error(w, f'渡すデータの節 {d["schema"]} が無い')
            for t in [st.get('label', ''), (d or {}).get('note', '')] + [x for br in st.get('branches', []) for x in br]:
                for m in LINK.finditer(t):
                    if m.group(1) not in nodes:
                        rep.error(w, f'ポインタ [[{m.group(1)}]] の先が無い')
            for op in st.get('ops', []):
                target = nodes.get(op['node'])
                shape = (target or {}).get('shape') or {}
                base = (nodes.get(shape['of']) or {}).get('shape') if 'of' in shape else shape
                if not base or 'kind' not in base:
                    rep.error(w, f'手順の操作 [[{op["node"]}]] は、形のある節にする')
                elif op['kind'] not in OPS[base['kind']]:
                    rep.error(w, f'手順の操作 {op["kind"]} は、{base["kind"]} では {"・".join(OPS[base["kind"]])} のどれか')
            if 'alt' in st and not (0 <= st['alt']['at'] < len(main)):
                rep.error(w, f'もし の手順番号 {st["alt"]["at"] + 1} が無い')
        if not main:
            rep.error(where, '手順が無い')
        n0 = f.pop('start_no', 1) - 1
        if main and not (0 <= n0 < len(main)):
            rep.error(where, f'はじめ の手順 {n0 + 1} が無い')
            n0 = 0
        f['start'] = [n0, main[n0]['ref'] if main else None]
        # another way comes after the main steps, so the main steps keep their numbers
        f['steps'] = main + [s for s in f['steps'] if 'alt' in s]
        if f.get('bands'):
            if f.get('entry') not in ids:
                rep.error(where, f'入口 {f.get("entry")} の箱が無い')
            for k, v in list(f.get('ports', {}).items()) + list(f.get('entries', {}).items()):
                if k not in nodes or v not in ids:
                    rep.error(where, f'出入口 [[{k}]]：{v} が合わない')
