"""Writing the viewer: one HTML page with the whole map in it."""
import html
import json
import re
from pathlib import Path

from .check import load
from .project import Report
from .traces import load_traces

TEMPLATE = Path(__file__).resolve().parents[1] / 'viewer.html'
PLACES = ('__ATLAS_DATA__', '__ATLAS_TITLE__', '__ATLAS_DOCS__')


def public(obj):
    """Drop what only the reader and the checker use (keys starting with _)."""
    if isinstance(obj, dict):
        return {k: public(v) for k, v in obj.items() if not k.startswith('_')}
    if isinstance(obj, list):
        return [public(v) for v in obj]
    return obj


def page(project, rep, template=TEMPLATE):
    """The viewer's HTML, or None when the map has errors."""
    index, layers, nodes, flows, papers = load(project, rep)
    if rep.errors():
        return None
    traces = load_traces(project, nodes, rep)
    data = {'title': index['title'], 'docs': project.rel(project.docs), 'how': index['how'], 'layers': layers,
            'nodes': public(nodes), 'flows': public(flows), 'papers': public(papers), 'traces': traces}
    text = Path(template).read_text(encoding='utf-8')
    missing = [p for p in PLACES if p not in text]
    if missing:
        rep.error(str(template), f'{", ".join(missing)} が雛形に無い')
        return None
    # Every < as \u003c: the same string to the script, and nothing in it the HTML parser can take for
    # </script> or <!--, which would end or swallow the script element.
    blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    values = {'__ATLAS_DATA__': blob, '__ATLAS_TITLE__': html.escape(index['title']), '__ATLAS_DOCS__': html.escape(data['docs'])}
    # One pass, so a title or docs path that spells a placeholder stays text.
    text = re.sub('|'.join(PLACES), lambda m: values[m.group(0)], text)
    return text, (len(nodes), len(flows), len(papers))


def build(project, out):
    rep = Report()
    result = page(project, rep)
    rep.show()
    if result is None:
        return 1
    text, (n, f, p) = result
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding='utf-8')
    print(f'wrote {project.rel(out)} ({n} nodes, {f} flows, {p} papers)')
    return 0
