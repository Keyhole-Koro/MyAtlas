#!/usr/bin/env python3
"""Tests for atlas_tui.py (standard library only):  python3 test_atlas_tui.py"""
import random
import unittest

import atlas_tui as T

ATLAS = T.Atlas(T.find_data())
SIZES = [(160, 44), (200, 56), (140, 40), (120, 36), (100, 30), (80, 24), (60, 30), (46, 40), (40, 20)]
KEYS = ['left', 'right', 'up', 'down', 'enter', 'esc', 'home', 'end', 'pgup', 'pgdn', 'a', 'v', 'c', 'i', 'n', 't',
        '1', '2', '?', '/', 'f', 'g', 'x', 'backspace', 'tab', ' ']


def grid_ok(g):
    """Every wide character has its placeholder after it, and no placeholder stands alone."""
    for y in range(g.h):
        row = g.ch[y]
        for x, c in enumerate(row):
            if c == '':
                assert x > 0 and row[x - 1] not in ('', ' ') and T.cw(row[x - 1]) == 2, (y, x, ''.join(row))
            elif c != ' ' and T.cw(c) == 2:
                assert x + 1 < g.w and row[x + 1] == '', (y, x, ''.join(row))


class Layouts(unittest.TestCase):
    def test_every_step_is_drawn_with_its_number(self):
        for did, dg in ATLAS.diagrams.items():
            lay = T.Layout(ATLAS, dg)
            for k, s in enumerate(dg.steps):
                self.assertIn(k, lay.routes, '%s step %s has no route' % (did, dg.labels[k]))
                self.assertIsNotNone(lay.routes[k].badge, '%s step %s has no number' % (did, dg.labels[k]))

    def test_routes_and_badges_stay_off_boxes(self):
        for did, dg in ATLAS.diagrams.items():
            lay = T.Layout(ATLAS, dg)
            cells = {}
            for b in lay.boxes.values():
                for y in range(b.y, b.y + b.h):
                    for x in range(b.x, b.x + b.w):
                        cells[(x, y)] = b.id
            for k, r in lay.routes.items():
                for x, y, _ in r.cells:
                    self.assertNotIn((x, y), cells, '%s step %s runs through box %s' % (did, dg.labels[k], cells.get((x, y))))
                label = dg.labels[k]
                bx, by = r.badge
                for x in range(bx, bx + r.badge_w):
                    self.assertNotIn((x, by), cells, '%s badge %s covers a box' % (did, label))

    def test_badges_do_not_overlap(self):
        for did, dg in ATLAS.diagrams.items():
            for c in range(T.App.LEVELS):
                lay = T.Layout(ATLAS, dg, compact=c)
                seen = {}
                for k, r in lay.routes.items():
                    bx, by = r.badge
                    self.assertGreaterEqual(r.badge_w, T.sw(dg.labels[k]))
                    for x in range(bx, bx + r.badge_w):
                        self.assertNotIn((x, by), seen, '%s badges %s and %s overlap' % (did, dg.labels[k], seen.get((x, by))))
                        seen[(x, by)] = dg.labels[k]

    def test_every_arrowhead_survives(self):
        """After drawing, the last cell of every shown route is still an arrowhead (no badge or other line on
        it), at every level of detail and every step."""
        heads = set('▶◀▲▼▷◁△▽')
        for did, dg in ATLAS.diagrams.items():
            for c in range(T.App.LEVELS):
                lay = T.Layout(ATLAS, dg, compact=c)
                for k in range(len(dg.steps)):
                    g = T.draw_layout(lay, k)
                    shown = set(T.walk_of(dg, k)) if dg.steps[k].get('alt') else set(dg.alts_of(k))
                    for r in lay.routes.values():
                        if dg.steps[r.k].get('alt') and r.k not in shown:
                            continue
                        x, y, _ = r.cells[-1]
                        self.assertIn(g.ch[y][x], heads, '%s level %d at step %s: step %s lost its arrowhead (%r)'
                                      % (did, c, dg.labels[k], dg.labels[r.k], g.ch[y][x]))

    def test_badges_stay_off_other_routes(self):
        """A badge never covers another route's ends or bends (at most a straight crossing, where that line
        goes on above and below it)."""
        for did, dg in ATLAS.diagrams.items():
            for c in range(T.App.LEVELS):
                lay = T.Layout(ATLAS, dg, compact=c)
                ends = {}
                for k, r in lay.routes.items():
                    n = len(r.cells)
                    for i, (x, y, d) in enumerate(r.cells):
                        dout = r.cells[i + 1][2] if i + 1 < n else r.into
                        if i == 0 or i == n - 1 or d != dout:
                            ends.setdefault((x, y), set()).add(k)
                for k, r in lay.routes.items():
                    bx, by = r.badge
                    for x in range(bx, bx + r.badge_w):
                        others = ends.get((x, by), set()) - {k}
                        self.assertFalse(others, '%s level %d: badge %s covers an end or bend of step %s' % (
                            did, c, dg.labels[k], ','.join(dg.labels[j] for j in others)))

    def test_a_call_and_its_return_do_not_stack(self):
        """Two boxes in different lanes joined by a call and its return (both main steps) stand in different
        columns, so each pair gets a loop of its own instead of four lines in one narrow gap."""
        for did, dg in ATLAS.diagrams.items():
            cols, lane = T.layout_columns(dg)
            main = {(s['from'], s['to']) for s in dg.steps if not s.get('alt') and s.get('from') in dg.boxes
                    and s.get('to') in dg.boxes}
            for a, b in main:
                if (b, a) in main and lane[a] != lane[b]:
                    self.assertNotEqual(cols[a], cols[b], '%s: %s and %s are stacked' % (did, a, b))

    def test_box_titles_are_whole(self):
        for did, dg in ATLAS.diagrams.items():
            lay = T.Layout(ATLAS, dg)
            text = T.draw_layout(lay, dg.start).text()
            for b in lay.boxes.values():
                self.assertIn(b.title, text, '%s: box title %r is cut' % (did, b.title))
                for s in b.sub:
                    self.assertIn(s, text, '%s: %r is cut' % (did, s))


class Screens(unittest.TestCase):
    def test_every_step_every_size_both_views(self):
        for w, h in SIZES:
            for did, dg in ATLAS.diagrams.items():
                for mode in ('map', 'route'):
                    app = T.App(ATLAS, w, h)
                    app.nav = [[did, dg.start]]
                    app.mode = mode
                    for k in range(len(dg.steps)):
                        app.set_k(k)
                        g = app.render()
                        grid_ok(g)
                        self.assertEqual((g.w, g.h), (w, h))

    def test_flows_fit_the_page_sizes(self):
        """The flows' maps show whole (no lane scrolled away) at the page's two larger sizes."""
        for w, h in ((160, 44), (112, 34)):
            for fid in [f['id'] for f in ATLAS.flows]:
                app = T.App(ATLAS, w, h)
                app.key(str(app.flows.index(fid) + 1))
                self.assertEqual(app.view_mode(), 'map')
                lines = app.render().text().split('\n')
                strip = next(i for i, l in enumerate(lines) if l.startswith(' 手順'))
                for line in lines[2:strip]:
                    self.assertNotIn('▴', line, '%s at %dx%d scrolls' % (fid, w, h))
                    self.assertNotIn('▾', line, '%s at %dx%d scrolls' % (fid, w, h))

    def test_node_list_names_are_whole(self):
        for w, h in ((160, 44), (112, 34), (100, 30)):
            for lane in range(len(ATLAS.layers)):
                app = T.App(ATLAS, w, h)
                app.key('n')
                app.nb_lane, app.nb_i = lane, 0
                text = app.render().text()
                for nid in app.nb_list()[:h - 6]:
                    self.assertIn(ATLAS.nodes[nid]['title'], text, '%dx%d: %s is cut' % (w, h, nid))

    def test_step_card_shows_the_step(self):
        app = T.App(ATLAS, 160, 44)
        for did in [f['id'] for f in ATLAS.flows]:
            dg = ATLAS.diagrams[did]
            app.nav = [[did, 0]]
            for k, s in enumerate(dg.steps):
                app.set_k(k)
                text = app.render().text()
                if s.get('verb'):
                    self.assertIn(s['verb'], text)
                self.assertIn(s['label'][:12], text.replace('\n', ''))

    def test_other_screens(self):
        for w, h in SIZES:
            for keys in (['n'], ['n', 'down', 'down', 'left', 'down'], ['t'], ['t', 'f', 'end'], ['?'], ['c'],
                         ['/', 'c', 'h', 'a', 'r', 'g', 'e'], ['i'], ['enter'], ['enter', 'right', 'enter']):
                app = T.App(ATLAS, w, h)
                for k in keys:
                    app.key(k)
                grid_ok(app.render())

    def test_random_keys(self):
        rng = random.Random(5)
        for trial in range(30):
            w, h = rng.choice(SIZES)
            app = T.App(ATLAS, w, h)
            for i in range(120):
                k = rng.choice(KEYS)
                if k == 'q':
                    continue
                app.key(k)
                if i % 7 == 0:
                    app.w, app.h = rng.choice(SIZES)
                grid_ok(app.render())

    def test_render_cli(self):
        for did in ATLAS.diagrams:
            for view in ('map', 'route'):
                g = T.render_diagram(ATLAS, did, None, view, 160)
                grid_ok(g)
                self.assertIn(ATLAS.diagrams[did].title, g.text())


class Text(unittest.TestCase):
    def test_wrap_keeps_widths(self):
        for nid, n in ATLAS.nodes.items():
            for w in (12, 20, 33, 50):
                for line in T.wrap(T.rich(ATLAS, n.get('text', '')), w):
                    self.assertLessEqual(T.spans_width(line), w, (nid, w))

    def test_wrap_does_not_start_lines_with_closing_marks(self):
        for nid, n in ATLAS.nodes.items():
            for w in (16, 24, 40):
                lines = T.wrap(T.rich(ATLAS, n.get('text', '')), w)
                for line in lines[1:]:
                    t = ''.join(x for x, _, _ in line)
                    self.assertFalse(t[:1] in '、。）」', (nid, w, t))


if __name__ == '__main__':
    unittest.main(verbosity=1)
