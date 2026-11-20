#!/usr/bin/env python3
"""Writes dev/frame.js: one screen of the app (for looking at it with the lab's screenshot tool).

    python3 tools/devframe.py [--screen ui] [--w 160 --h 44] [--keys "right enter"] [--theme light] [--view route]
"""
import argparse, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import atlas_tui as T

ap = argparse.ArgumentParser()
ap.add_argument('--screen', default='ui')
ap.add_argument('--w', type=int, default=160)
ap.add_argument('--h', type=int, default=44)
ap.add_argument('--keys', default='')
ap.add_argument('--theme', default='dark')
ap.add_argument('--view')
ap.add_argument('--out', default=str(HERE / 'dev' / 'frame.js'))
a = ap.parse_args()
atlas = T.Atlas(T.find_data())
app = T.App(atlas, a.w, a.h, theme=a.theme)
if a.screen in atlas.diagrams:
    app.nav = [[a.screen, atlas.diagrams[a.screen].start]]
    if a.screen in app.flows:
        app.saved[a.screen] = app.nav
elif a.screen in ('nodes', 'trace'):
    app.screen = a.screen
if a.view:
    app.mode = a.view
for k in T.parse_keys(a.keys):
    app.render()
    app.key(k)
g = app.render()
Path(a.out).write_text('window.FRAME=%s;\nwindow.PALETTES=%s;\nwindow.FRAME_THEME=%s;window.FRAME_THEME_AUTO=false;\n' % (
    json.dumps(T.frame_dict(g), ensure_ascii=False), json.dumps(T.palettes()), json.dumps(a.theme)), encoding='utf-8')
print('frame', g.w, 'x', g.h)
