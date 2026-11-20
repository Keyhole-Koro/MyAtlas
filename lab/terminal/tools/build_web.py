#!/usr/bin/env python3
"""Builds web/frames-<preset>.json.gz: the screens of atlas_tui.py at one terminal size, which key leads from
which screen to which, and where a click goes. The page (index.html) replays them with web/term.js, so what it
shows is exactly what the terminal app draws.

    python3 tools/build_web.py            all presets
    python3 tools/build_web.py wide
"""
import copy, gzip, json, sys, time
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import atlas_tui as T

PRESETS = {
    'wide': (160, 44),
    'medium': (112, 34),
    'narrow': (46, 40),
}
FIELDS = ('screen', 'overlay', 'nav', 'mode', 'sel', 'dscroll', 'code_off', 'nb_lane', 'nb_i', 'nb_focus', 'tr_i',
          'tr_only', 'back_screen')
FLOW_KEYS = ['left', 'right', 'home', 'end', 'enter', 'esc', 'a', 'v', 'c', 'n', 't', '?', '1', '2', 'i',
             'down', 'up', 'pgdn', 'pgup']
KEYS = {
    'flow': FLOW_KEYS,
    'code': ['esc', 'left', 'right', 'c'],
    'help': [],
    'detail': ['down', 'up'],
    'nodes': ['up', 'down', 'left', 'right', 'enter', 'n', 't', '1', '2', '?', 'i', 'pgdn', 'pgup'],
    'trace': ['up', 'down', 'pgup', 'pgdn', 'home', 'end', 'enter', 'm', 't', 'n', '?', 'f'],
}


def snap(app):
    return copy.deepcopy({f: getattr(app, f) for f in FIELDS})


def restore(app, st):
    for f, v in copy.deepcopy(st).items():
        setattr(app, f, v)


def key_of(st, node=None):
    """What a screen depends on. Screens that look and act the same share a key: the description page of a
    node is one screen wherever it was opened from. Where to go back to depends on history, so the page
    remembers it (page.js): back_screen is never part of a state here."""
    o, scr = st['overlay'], st['screen']
    if o == 'help':
        k = ('help',)
    elif o == 'detail':
        k = ('detail', node, st['dscroll'])
    elif scr == 'nodes':
        k = ('nodes', st['nb_lane'], st['nb_i'], st['nb_focus'], st['dscroll'])
    elif scr == 'trace':
        k = ('trace', st['tr_i'], st['tr_only'])
    else:
        k = ('flow', o, st['nav'], st['mode'], st['sel'], st['dscroll'], st['code_off'])
    return json.dumps(k, ensure_ascii=False)


def build(name, w, h, atlas):
    app = T.App(atlas, w, h)
    app.web = True
    rows, row_id = [], {}
    styles, style_id = [], {}
    hitsets, hit_id = [], {}
    frames, nexts, metas = [], [], []
    seen = {}
    q = deque()

    def node_now():
        return (app.detail_node() if app.screen == 'flow' else app.nb_node()) if app.overlay == 'detail' else None

    def add():
        """The screen the app is on now (a new one is queued)."""
        app.back_screen = None
        st = snap(app)
        k = key_of(st, node_now())
        if k not in seen:
            seen[k] = len(seen)
            q.append(st)
        return seen[k]

    add()
    t0 = time.time()
    while q:
        st = q.popleft()
        restore(app, st)
        i = seen[key_of(st, node_now())]
        g = app.render()
        hits = list(app.hits)
        fr = []
        for row in g.runs():
            out = []
            for x, s, text, wide in row:
                sid = style_id.setdefault(s, len(style_id))
                if sid == len(styles):
                    styles.append(list(T._STY[s]))
                out.append([x, sid, text, 1] if wide else [x, sid, text])
            key = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
            rid = row_id.get(key)
            if rid is None:
                rid = row_id[key] = len(rows)
                rows.append(out)
            fr.append(rid)
        while len(frames) <= i:
            frames.append(None)
            nexts.append(None)
            metas.append(None)
        frames[i] = fr
        meta = {'s': app.screen, 'o': app.overlay, 'nav': app.nav, 'm': app.view_mode(), 'flow': app.flow_id()}
        if app.sel or app.dscroll:
            meta['x'] = 1          # a box chosen or the description scrolled: not where a flow is reopened
        if app.pulse and not app.overlay:
            meta['p'] = app.pulse
        mode = app.overlay or app.screen
        nx = {}
        for k in KEYS.get(mode, []):
            restore(app, st)
            app.key(k)
            if app.quit or app.overlay == 'search':
                continue
            i2 = add()
            if i2 != i:
                nx[k] = i2
        nexts[i] = nx
        # clicks: a key for the page to press, or the screen a click leads to
        hl = []
        for x0, y0, x1, y1, action in hits:
            if isinstance(action, str):
                if action in ('/', 'q'):
                    continue
                hl.append([x0, y0, x1, y1, action])
            else:
                restore(app, st)
                app.act(action)
                i2 = add()
                if i2 != i:
                    hl.append([x0, y0, x1, y1, i2])
        if hl:
            key = json.dumps(hl, separators=(',', ':'))
            hid = hit_id.get(key)
            if hid is None:
                hid = hit_id[key] = len(hitsets)
                hitsets.append(hl)
            meta['h'] = hid
        metas[i] = meta
    data = {'name': name, 'w': w, 'h': h, 'styles': styles, 'rows': rows, 'frames': frames, 'next': nexts,
            'meta': metas, 'hits': hitsets, 'start': 0,
            'starts': {f['id']: atlas.diagrams[f['id']].start for f in atlas.flows},
            'palettes': T.palettes()}
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    out = HERE / 'web' / ('frames-%s.json.gz' % name)
    out.write_bytes(gzip.compress(raw, 9))
    print('%-7s %dx%d  %d screens, %d distinct rows, %d click sets, %.1f MB raw, %d KB gzip, %.0fs' % (
        name, w, h, len(frames), len(rows), len(hitsets), len(raw) / 1e6, out.stat().st_size // 1024,
        time.time() - t0))


def render_sample(atlas):
    """What `atlas_tui.py --render ui --width 150` prints, as a frame (and as plain text, for copying)."""
    g = T.render_diagram(atlas, 'ui', None, 'map', 150)
    out = HERE / 'web' / 'render-sample.js'
    out.write_text('window.RENDER_FRAME = %s;\nwindow.RENDER_SAMPLE = %s;\n' % (
        json.dumps(T.frame_dict(g), ensure_ascii=False, separators=(',', ':')),
        json.dumps(g.text(), ensure_ascii=False)), encoding='utf-8')
    print('render sample', g.w, 'x', g.h)


if __name__ == '__main__':
    atlas = T.Atlas(T.find_data())
    names = sys.argv[1:] or list(PRESETS)
    render_sample(atlas)
    for n in names:
        if n in PRESETS:
            build(n, *PRESETS[n], atlas)
