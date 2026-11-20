#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MyAtlas in a terminal: the document map's layers, nodes and flows as box-drawing diagrams.

  python3 atlas_tui.py                         interactive (curses). ? shows the keys
  python3 atlas_tui.py --render ui             print the flow "ui" as a diagram and exit
  python3 atlas_tui.py --render cpu --step 7   ... at step 7 (1-based, or A, B for "もし")
  python3 atlas_tui.py --render os.gateway     a paper (the flow inside a node)
  python3 atlas_tui.py --render ui --view route --width 60
  python3 atlas_tui.py --screen ui --width 160 --height 44 --keys "right right enter"
  python3 atlas_tui.py --list                  the ids of flows, papers and nodes
  python3 atlas_tui.py --ascii --theme light --still   plain lines, a light terminal, no moving dot

Standard library only. Reads ../data/atlas.json and ../data/code.json next to this folder
(or --data DIR). Everything is drawn into a grid of cells first; curses, the --render output
and the HTML frames all show that same grid.
"""
import argparse
import heapq
import json
import math
import os
import random
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ───────────────────────────────────────────────────────────── cell widths

@lru_cache(maxsize=8192)
def cw(ch):
    """Cells a character takes in a terminal: 2 for wide (CJK), 0 for combining/control."""
    o = ord(ch)
    if o < 0x7f:
        return 1 if o >= 32 else 0
    if o < 0xa0:
        return 0
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1


def sw(s):
    """Cells a string takes."""
    if s.isascii():
        return len(s)
    return sum(cw(c) for c in s)


def clip(s, width, ell='…'):
    """s cut to at most width cells (with an ellipsis when cut)."""
    if sw(s) <= width:
        return s
    out, w = [], 0
    for c in s:
        if w + cw(c) > width - sw(ell):
            break
        out.append(c)
        w += cw(c)
    return ''.join(out) + ell


def pad(s, width):
    return s + ' ' * max(0, width - sw(s))

# ───────────────────────────────────────────────────────────── styles and grid

BOLD, UL = 1, 2
_STY, _STY_ID = [], {}


def S(fg='text', bg='bg', attr=0):
    """The id of a style: foreground role, background role, attributes."""
    key = (fg, bg, attr)
    i = _STY_ID.get(key)
    if i is None:
        i = _STY_ID[key] = len(_STY)
        _STY.append(key)
    return i


def sty(i):
    return _STY[i]


class Grid:
    """A screen of cells. A wide character takes its cell and a placeholder ('') after it."""

    def __init__(self, w, h, st=None):
        st = S() if st is None else st
        self.w, self.h = w, h
        self.ch = [[' '] * w for _ in range(h)]
        self.st = [[st] * w for _ in range(h)]

    def _free(self, x, y):
        row = self.ch[y]
        c = row[x]
        if c == '':
            if x > 0:
                row[x - 1] = ' '
        elif c != ' ' and x + 1 < self.w and row[x + 1] == '' and cw(c) == 2:
            row[x + 1] = ' '

    @staticmethod
    def _mix(st, old, keep_bg):
        if not keep_bg:
            return st
        fg, _, attr = _STY[st]
        return S(fg, _STY[old][1], attr)

    def put(self, x, y, s, st, x1=None, keep_bg=False):
        """Writes s at (x, y), not past x1. Returns the x after it."""
        if not 0 <= y < self.h:
            return x + sw(s)
        x1 = self.w if x1 is None else min(x1, self.w)
        row, srow = self.ch[y], self.st[y]
        for c in s:
            w = cw(c)
            if w == 0:
                continue
            if x + w > x1:
                while x < x1:
                    if x >= 0:
                        self._free(x, y)
                        row[x] = ' '
                        srow[x] = self._mix(st, srow[x], keep_bg)
                    x += 1
                return x
            if x >= 0:
                self._free(x, y)
                s0 = self._mix(st, srow[x], keep_bg)
                row[x], srow[x] = c, s0
                if w == 2:
                    self._free(x + 1, y)
                    row[x + 1], srow[x + 1] = '', s0
            elif x + w > 0:
                self._free(0, y)
                row[0] = ' '
                srow[0] = self._mix(st, srow[0], keep_bg)
            x += w
        return x

    def fill(self, x, y, w, h, st, ch=' '):
        for yy in range(max(0, y), min(self.h, y + h)):
            for xx in range(max(0, x), min(self.w, x + w)):
                self._free(xx, yy)
                self.ch[yy][xx] = ch
                self.st[yy][xx] = st

    def tint(self, x, y, w, h, bg):
        """Changes the background of an area, keeping what is written there."""
        for yy in range(max(0, y), min(self.h, y + h)):
            srow = self.st[yy]
            for xx in range(max(0, x), min(self.w, x + w)):
                fg, _, attr = _STY[srow[xx]]
                srow[xx] = S(fg, bg, attr)

    def bg_of(self, x, y):
        return _STY[self.st[y][x]][1]

    def blit(self, src, sx, sy, w, h, dx, dy):
        """Copies the area (sx, sy, w, h) of src to (dx, dy)."""
        for j in range(h):
            ys, yd = sy + j, dy + j
            if not (0 <= ys < src.h and 0 <= yd < self.h):
                continue
            first, last = max(0, dx), min(self.w, dx + w) - 1
            if first > last:
                continue
            self._free(first, yd)
            self._free(last, yd)
            for i in range(w):
                xs, xd = sx + i, dx + i
                if not (0 <= xd < self.w):
                    continue
                if 0 <= xs < src.w:
                    c, s0 = src.ch[ys][xs], src.st[ys][xs]
                else:
                    c, s0 = ' ', src.st[ys][0] if src.w else S()
                if c == '' and (i == 0 or xd == first):
                    c = ' '
                elif c not in ('', ' ') and (i == w - 1 or xd == last) and cw(c) == 2:
                    c = ' '
                self.ch[yd][xd], self.st[yd][xd] = c, s0

    def text(self):
        return '\n'.join(''.join(r).rstrip() for r in self.ch)

    def ansi(self, theme):
        out = []
        for y in range(self.h):
            line, cur = [], None
            for x in range(self.w):
                c = self.ch[y][x]
                if c == '':
                    continue
                st = self.st[y][x]
                if st != cur:
                    line.append(theme.sgr(st))
                    cur = st
                line.append(c)
            line.append('\x1b[0m')
            out.append(''.join(line))
        return '\n'.join(out)

    def runs(self):
        """Rows as runs [x, style, text, wide]: for the HTML terminal. Wide runs take 2 cells a char."""
        rows = []
        for y in range(self.h):
            row, x = [], 0
            chs, sts = self.ch[y], self.st[y]
            while x < self.w:
                c, s0 = chs[x], sts[x]
                if c == '':
                    x += 1
                    continue
                wide = cw(c) == 2
                start, buf = x, []
                while x < self.w and sts[x] == s0 and chs[x] != '' and (cw(chs[x]) == 2) == wide:
                    buf.append(chs[x])
                    x += 2 if wide else 1
                row.append([start, s0, ''.join(buf), 1 if wide else 0])
            rows.append(row)
        return rows

# ───────────────────────────────────────────────────────────── colours

def xterm_rgb(i):
    base = [(0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0), (0, 0, 238), (205, 0, 205), (0, 205, 205),
            (229, 229, 229), (127, 127, 127), (255, 0, 0), (0, 255, 0), (255, 255, 0), (92, 92, 255),
            (255, 0, 255), (0, 255, 255), (255, 255, 255)]
    if i < 16:
        return base[i]
    if i < 232:
        i -= 16
        lv = (0, 95, 135, 175, 215, 255)
        return lv[i // 36], lv[(i // 6) % 6], lv[i % 6]
    v = 8 + (i - 232) * 10
    return v, v, v


# Roles → xterm-256 colours. Layer colours follow the map (app #eb6834, lib #1baf7a, os #eda100,
# kernel #e87ba4, emu #008300; accent #2f5bd3 / dark #7c9dff) as closely as 256 colours allow.
# "L.x" is a layer's line colour, "T.x" its text colour (readable on the background).
THEMES = {
    'dark': {
        'bg': 234, 'panel': 235, 'shade': 235, 'region': 235, 'sel': 237, 'chip': 236, 'chip2': 238,
        'text': 252, 'strong': 255, 'dim': 248, 'faint': 246, 'line': 243, 'rule': 237,
        'accent': 111, 'accent2': 75, 'ink': 234, 'link': 117,
        'done': 74, 'done_t': 74, 'done_bg': 24, 'future': 244, 'future_bg': 236,
        'warn': 179, 'warn_bg': 94, 'good': 114, 'bad': 174,
        'code_bg': 233, 'code': 252, 'kw': 176, 'ty': 117, 'str': 180, 'num': 151, 'cmt': 244, 'fn': 222,
        'L.app': 166, 'T.app': 209, 'L.lib': 36, 'T.lib': 43, 'L.os': 172, 'T.os': 178,
        'L.kernel': 168, 'T.kernel': 211, 'L.emu': 28, 'T.emu': 71,
        'L.contract': 103, 'T.contract': 146, 'L.context': 103, 'T.context': 146, 'L.policy': 103, 'T.policy': 146,
    },
    'light': {
        'bg': 231, 'panel': 255, 'shade': 255, 'region': 255, 'sel': 254, 'chip': 254, 'chip2': 252,
        'text': 236, 'strong': 232, 'dim': 239, 'faint': 242, 'line': 244, 'rule': 253,
        'accent': 26, 'accent2': 25, 'ink': 231, 'link': 25,
        'done': 67, 'done_t': 24, 'done_bg': 67, 'future': 244, 'future_bg': 254,
        'warn': 130, 'warn_bg': 223, 'good': 28, 'bad': 124,
        'code_bg': 255, 'code': 236, 'kw': 127, 'ty': 25, 'str': 130, 'num': 29, 'cmt': 242, 'fn': 94,
        'L.app': 166, 'T.app': 130, 'L.lib': 36, 'T.lib': 29, 'L.os': 172, 'T.os': 94,
        'L.kernel': 168, 'T.kernel': 125, 'L.emu': 28, 'T.emu': 28,
        'L.contract': 103, 'T.contract': 60, 'L.context': 103, 'T.context': 60, 'L.policy': 103, 'T.policy': 60,
    },
}


class Theme:
    def __init__(self, name='dark'):
        self.name = name
        self.roles = THEMES[name]

    def idx(self, role):
        return self.roles.get(role, self.roles['text'])

    def rgb(self, role):
        return xterm_rgb(self.idx(role))

    def hex(self, role):
        return '#%02x%02x%02x' % self.rgb(role)

    def sgr(self, st):
        fg, bg, attr = _STY[st]
        codes = ['0']
        if attr & BOLD:
            codes.append('1')
        if attr & UL:
            codes.append('4')
        codes.append('38;5;%d' % self.idx(fg))
        codes.append('48;5;%d' % self.idx(bg))
        return '\x1b[%sm' % ';'.join(codes)

# ───────────────────────────────────────────────────────────── the map

KIND_NAME = {'func': '関数', 'store': '置き場', 'schema': '構造体', 'enum': '列挙', 'context': '実行の文脈',
             'hw': 'レジスタ', 'note': '方針', 'figure': '図'}
KIND_SHORT = {'context': '文脈'}     # in the node list's narrow kind column
STEP_KIND = {'call': '呼び出し', 'syscall': 'syscall', 'msg': '列を通す', 'signal': '通知', 'data': '読み書き',
             'return': '戻り'}


def find_data(arg=None):
    for d in ([Path(arg)] if arg else []) + [HERE.parent / 'data', HERE / 'data']:
        if (d / 'atlas.json').exists():
            return d
    sys.exit('atlas.json が見つかりません（--data DIR で場所を指定できます）')


class Diagram:
    """A flow or a paper: lanes (layers or bands), boxes and numbered steps."""

    def __init__(self, atlas, raw, did, kind):
        self.atlas, self.id, self.kind = atlas, did, kind
        self.title = raw.get('title', did)
        self.tab = raw.get('tab') or self.title
        self.boxes = {b['id']: b for b in raw['boxes']}
        self.order = [b['id'] for b in raw['boxes']]
        self.steps = raw['steps']
        self.regions = raw.get('regions') or []
        self.entry = raw.get('entry')
        self.ports = raw.get('ports') or {}
        st = raw.get('start')
        self.start = st[0] if st else 0
        if kind == 'paper':
            self.lanes = [{'id': b['id'], 'name': b['name'], 'sub': b.get('sub', ''), 'tone': b.get('tone', 'os')}
                          for b in raw.get('bands') or []]
        else:
            self.lanes = [{'id': l['id'], 'name': l['name'], 'sub': l.get('sub', ''), 'tone': l['id']}
                          for l in atlas.layers if not l.get('cross')]
        self.labels, n, a = [], 0, 0
        for s in self.steps:
            if s.get('alt'):
                self.labels.append(chr(ord('A') + a))
                a += 1
            else:
                n += 1
                self.labels.append(str(n))
        self.main_count = n

    def lane_of(self, box_id):
        return self.boxes[box_id].get('layer')

    def tone_of(self, box_id):
        lane = self.lane_of(box_id)
        for l in self.lanes:
            if l['id'] == lane:
                return l['tone']
        return 'os'

    def alts_of(self, k):
        """Steps that happen instead of step k."""
        return [j for j, s in enumerate(self.steps) if s.get('alt') and s['alt'].get('at') == k]

    def papers_at(self, k):
        """(box id, paper id) of the boxes of step k that have a paper inside."""
        s = self.steps[k]
        out = []
        for b in (s.get('from'), s.get('to')):
            if b in self.boxes:
                p = self.atlas.paper_of(self.boxes[b].get('node'))
                if p and (b, p) not in out:
                    out.append((b, p))
        return out


class Atlas:
    def __init__(self, data_dir):
        self.dir = Path(data_dir)
        a = json.loads((self.dir / 'atlas.json').read_text('utf-8'))
        cp = self.dir / 'code.json'
        self.code = json.loads(cp.read_text('utf-8')) if cp.exists() else {'nodes': {}, 'steps': {}, 'files': {}}
        self.title = a.get('title', '文書マップ')
        self.layers = a['layers']
        self.layer = {l['id']: l for l in self.layers}
        self.nodes = a['nodes']
        self.flows = a['flows']
        self.papers = a.get('papers') or {}
        self.traces = a.get('traces') or []
        self.diagrams = {}
        for f in self.flows:
            self.diagrams[f['id']] = Diagram(self, f, f['id'], 'flow')
        for pid, p in self.papers.items():
            self.diagrams[pid] = Diagram(self, p, pid, 'paper')
        self._src = {}

    def title_of(self, nid):
        n = self.nodes.get(nid)
        return n['title'] if n else nid

    def paper_of(self, nid):
        n = self.nodes.get(nid or '')
        p = n.get('paper') if n else None
        return p if p in self.papers else None

    def source(self, path):
        """Lines of a source file the map points at, or None."""
        if path not in self._src:
            f = self.dir / 'src' / path
            self._src[path] = f.read_text('utf-8', errors='replace').split('\n') if f.exists() else None
        return self._src[path]

    def where(self, nid):
        """Where a node shows up: [(diagram id, step index, role)]: as a box of a step or its reference."""
        out = []
        for did, dg in self.diagrams.items():
            boxes = {b for b, box in dg.boxes.items() if box.get('node') == nid}
            for k, s in enumerate(dg.steps):
                if s.get('from') in boxes or s.get('to') in boxes or s.get('ref') == nid:
                    out.append((did, k))
        return out

    def step_code(self, did, k):
        """(path, line, how) where step k happens in code: the line given by the map, else the target's
        definition."""
        spot = (self.code.get('steps', {}).get(did) or {}).get(str(k))
        if spot:
            return spot['path'], spot['line'], 'line'
        dg = self.diagrams[did]
        s = dg.steps[k]
        for b in (s.get('to'), s.get('from')):
            box = dg.boxes.get(b)
            c = self.code.get('nodes', {}).get(box.get('node') if box else '')
            if c and c.get('start'):
                return c['path'], c['start'], 'def'
        return None

# ───────────────────────────────────────────────────────────── text: links and wrapping

LINK = re.compile(r'(!?)\[\[([^\]]+)\]\]')
NO_START = set('、。，．・：；？！ー）」』】〕〉》｝〙〗…‥ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ),.:;!?]}%')
NO_END = set('（「『【〔〈《｛〘〖([{')
TOKEN = re.compile(r'[!-~]+| +|\n|.', re.S)


def rich(atlas, text, role='text', link_role='link'):
    """Text with [[links]] as spans (text, role, node id)."""
    spans, pos = [], 0
    for m in LINK.finditer(text):
        if m.start() > pos:
            spans.append((text[pos:m.start()], role, None))
        spans.append((atlas.title_of(m.group(2)), link_role, m.group(2)))
        pos = m.end()
    if pos < len(text):
        spans.append((text[pos:], role, None))
    return spans


def wrap(spans, width):
    """Spans broken into lines no wider than width: between Japanese characters and at spaces, never inside
    an ASCII word unless it is longer than a line, and not before 、。） or after （."""
    width = max(4, width)
    toks = []
    for text, role, ref in spans:
        for m in TOKEN.finditer(text):
            t = m.group(0)
            if len(t) > 10 and t[0] != ' ':
                # long names may break after . _ / (like a URL), never inside a part
                for part in re.findall(r'[./_]*[^./_]+[./_]*|[./_]+', t):
                    toks.append((part, role, ref))
            else:
                toks.append((t, role, ref))
    lines, cur, w = [], [], 0

    def flush():
        nonlocal cur, w
        while cur and cur[-1][0].isspace():
            cur.pop()
        lines.append(cur)
        cur, w = [], 0

    for tok in toks:
        t = tok[0]
        if t == '\n':
            flush()
            continue
        tw = sw(t)
        if t[0] == ' ':
            if not cur:
                continue
            if w + tw >= width:
                flush()
                continue
            cur.append(tok)
            w += tw
            continue
        if w + tw <= width:
            cur.append(tok)
            w += tw
            continue
        if tw > width:
            rest = t
            while rest:
                room = width - w
                if room < min(8, width // 3) and cur:
                    flush()
                    room = width
                part, pw = '', 0
                for c in rest:
                    if pw + cw(c) > room:
                        break
                    part += c
                    pw += cw(c)
                cur.append((part, tok[1], tok[2]))
                w += pw
                rest = rest[len(part):]
                if rest:
                    flush()
            continue
        carry = []
        if t[0] in NO_START:
            while len(cur) > 1 and not cur[-1][0].isspace():
                carry.insert(0, cur.pop())
                if carry[0][0][:1] not in NO_START:
                    break
            if not carry and len(cur) == 1 and cur[0][0].isascii() and len(cur[0][0]) > 4:
                last = cur.pop()
                cur.append((last[0][:-2], last[1], last[2]))
                carry = [(last[0][-2:], last[1], last[2])]
        while len(cur) > 1 and cur[-1][0] and cur[-1][0][-1] in NO_END:
            carry.insert(0, cur.pop())
        flush()
        for c in carry:
            cur.append(c)
            w += sw(c[0])
        cur.append(tok)
        w += tw
    if cur or not lines:
        flush()
    out = []
    for line in lines:
        merged = []
        for t, role, ref in line:
            if merged and merged[-1][1] == role and merged[-1][2] == ref:
                merged[-1] = (merged[-1][0] + t, role, ref)
            else:
                merged.append((t, role, ref))
        out.append(merged)
    return out


def wrap_text(text, width):
    return [''.join(t for t, _, _ in line) for line in wrap([(text, 'text', None)], width)]


def balanced(text, width):
    """Lines of text no wider than width, as even as possible (no one-character last line)."""
    lines = wrap_text(text, width)
    if len(lines) <= 1:
        return lines
    lo = max(sw(w) for w in text.split()) if text.isascii() else 4
    best = lines
    for w in range(width - 1, lo - 1, -1):
        cand = wrap_text(text, w)
        if len(cand) != len(lines):
            break
        if any(c[:1] in NO_START for c in cand[1:]):
            continue
        best = cand
    return best


def spans_width(spans):
    return sum(sw(t) for t, _, _ in spans)

# ───────────────────────────────────────────────────────────── diagram layout

R, D, L, U = 0, 1, 2, 3
DX = (1, 0, -1, 0)
DY = (0, 1, 0, -1)
OPP = (2, 3, 0, 1)

GLYPHS = {
    'solid': ('─', '│', '╭', '╮', '╰', '╯'),
    'double': ('═', '║', '╔', '╗', '╚', '╝'),
    'dash': ('┄', '┆', '╭', '╮', '╰', '╯'),
    'dot': ('┈', '┊', '╭', '╮', '╰', '╯'),
    'dash2': ('╌', '╎', '╭', '╮', '╰', '╯'),
}
HEAVY = {
    'solid': ('━', '┃', '┏', '┓', '┗', '┛'),
    'double': ('═', '║', '╔', '╗', '╚', '╝'),
    'dash': ('┅', '┇', '┏', '┓', '┗', '┛'),
    'dot': ('┉', '┋', '┏', '┓', '┗', '┛'),
    'dash2': ('╍', '╏', '┏', '┓', '┗', '┛'),
}
ASCII_GLYPHS = {
    'solid': ('-', '|', '+', '+', '+', '+'),
    'double': ('=', 'H', '+', '+', '+', '+'),
    'dash': ('-', ':', '+', '+', '+', '+'),
    'dot': ('.', ':', '+', '+', '+', '+'),
    'dash2': ('-', '|', '+', '+', '+', '+'),
}
KIND_LINE = {'call': 'solid', 'data': 'solid', 'syscall': 'double', 'msg': 'dash', 'signal': 'dot',
             'return': 'dash2'}
HEAD = {R: '▶', L: '◀', D: '▼', U: '▲'}
HOLLOW = {R: '▷', L: '◁', D: '▽', U: '△'}
ASCII_HEAD = {R: '>', L: '<', D: 'v', U: '^'}


def line_glyph(kind, conn, ascii_=False, heavy=False):
    """The character for a route cell connecting the directions in conn (a set of R, D, L, U)."""
    table = ASCII_GLYPHS if ascii_ else HEAVY if heavy else GLYPHS
    h, v, tl, tr, bl, br = table[KIND_LINE.get(kind, 'solid')]
    if conn <= {L, R}:
        return h
    if conn <= {U, D}:
        return v
    if conn == {R, D}:
        return tl
    if conn == {L, D}:
        return tr
    if conn == {R, U}:
        return bl
    return br


def head_glyph(kind, d, ascii_=False):
    if ascii_:
        return ASCII_HEAD[d]
    return (HOLLOW if kind == 'return' else HEAD)[d]


def tail_glyph(kind, ascii_=False):
    """The first cell of a line, where it leaves its box: a diamond for a notification (通知), so its dots
    never pass for the dashes of a message through a queue (列を通す); None for the other kinds."""
    if kind != 'signal':
        return None
    return 'o' if ascii_ else '◆'


class BoxL:
    """A box as laid out: content, size, column and place."""

    def __init__(self, dg, bid, lane, compact, atlas):
        b = dg.boxes[bid]
        self.id, self.raw, self.lane = bid, b, lane
        self.node = b.get('node')
        n = atlas.nodes.get(self.node) or {}
        self.kind = n.get('kind', 'func')
        self.tone = dg.tone_of(bid)
        self.paper = atlas.paper_of(self.node)
        self.title = b.get('short') if compact >= 2 and b.get('short') else b.get('title', bid)
        one = (22, 20, 16, 14, 0)[min(compact, 4)]
        self.sub = balanced(b['sub'], max(one, sw(self.title))) if b.get('sub') and one else []
        self.cells = []
        if b.get('slots'):
            sl = b['slots']
            self.cells = sl[:2] + ['…'] if len(sl) > 2 and len(set(sl)) == 1 else list(sl)
        elif b.get('bits'):
            self.cells = ['%s %d' % (name, n) for name, n in b['bits']]
        if compact >= 4 and sum(sw(c) + 1 for c in self.cells) > max(14, sw(self.title) + 1):
            self.cells = []
        self.tags = []
        if self.paper:
            self.tags.append('中の紙')
        if dg.entry == bid:
            self.tags.insert(0, '入口')
        self.port_out = [atlas.title_of(o) for o, box in dg.ports.items() if box == bid]
        inner = sw(self.title)
        for s in self.sub:
            inner = max(inner, sw(s))
        if self.cells:
            inner = max(inner, sum(sw(c) for c in self.cells) + len(self.cells) - 1)
        tagw = sum(sw(t) + 2 for t in self.tags) + 2 * len(self.tags)
        inner = max(inner, tagw - 1, 6)
        for p in self.port_out:
            inner = max(inner, sw('外へ：' + p) + 2)
        self.inner = inner
        self.w = inner + 4
        self.h = 2 + 1 + len(self.sub) + (1 if self.cells else 0)
        self.col = 0
        self.x = self.y = 0

    @property
    def cx(self):
        return self.x + self.w // 2

    def rect(self):
        return self.x, self.y, self.w, self.h


def assign_columns(dg):
    """Columns of the boxes: steps go left to right, boxes of a lane in different columns, short arrows,
    straight vertical arrows where no box stands between. A call and its return between two lanes do not
    stack their boxes in one column (four lines and two numbers would crowd one narrow gap; a step aside
    gives each pair its own loop and spreads a chain of them over the empty part of its lanes), and the
    step the map opens at weighs a little more, so it gets the shorter line. Simulated annealing with a
    fixed seed."""
    lane_ix = {l['id']: i for i, l in enumerate(dg.lanes)}
    order = []
    for s in dg.steps:
        if s.get('alt'):
            continue
        for b in (s.get('from'), s.get('to')):
            if b in dg.boxes and b not in order:
                order.append(b)
    for b in dg.order:
        if b not in order:
            order.append(b)
    lane = {b: lane_ix.get(dg.lane_of(b), 0) for b in order}
    rank = {b: i for i, b in enumerate(order)}
    edges = [(s['from'], s['to'], 0.4 if s.get('alt') else 1.1 if k == dg.start else 1.0)
             for k, s in enumerate(dg.steps)
             if s.get('from') in dg.boxes and s.get('to') in dg.boxes and s['from'] != s['to']]
    main = {(a, b) for a, b, wt in edges if wt >= 1.0}
    pairs = sorted({tuple(sorted((a, b))) for a, b in main if (b, a) in main and lane[a] != lane[b]})

    col, taken = {}, set()
    for b in order:
        pred = next((a for a, t, _ in edges if t == b and a in col), None)
        c = 0 if pred is None else col[pred] + (1 if lane[pred] == lane[b] else 0)
        while (lane[b], c) in taken:
            c += 1
        col[b] = c
        taken.add((lane[b], c))

    def cost(cl):
        total = 0.0
        for a, b, wt in edges:
            la, lb, ca, cb = lane[a], lane[b], cl[a], cl[b]
            if la == lb:
                d = cb - ca
                if d == 1:
                    c = 0.0
                elif d == -1:
                    c = 1.0
                else:
                    lo, hi = min(ca, cb), max(ca, cb)
                    between = any(lane[x] == la and lo < cl[x] < hi for x in order)
                    c = 1.5 * abs(d) + (5 if between else 1)
            else:
                d = abs(cb - ca)
                c = 1.25 * d
                if d == 0:
                    lo, hi = min(la, lb), max(la, lb)
                    if any(lo < lane[x] < hi and cl[x] == ca for x in order):
                        c += 6
                    else:
                        c -= 0.4
            total += wt * c
        total += 1.1 * len(set(cl.values()))
        for x in order:
            for y in order:
                if lane[x] == lane[y] and rank[x] < rank[y] and cl[x] > cl[y]:
                    total += 0.6
        for a, b in pairs:
            if cl[a] == cl[b]:
                total += 4.0
        return total

    rng = random.Random(11)
    cur = dict(col)
    cur_c = cost(cur)
    best, best_c = dict(cur), cur_c
    n = len(order)
    iters = 5000
    for it in range(iters):
        temp = 2.0 * (1 - it / iters) + 0.02
        cand = dict(cur)
        b = order[rng.randrange(n)]
        if rng.random() < 0.65:
            c = rng.randrange(0, n + 1)
            other = next((x for x in order if x != b and lane[x] == lane[b] and cand[x] == c), None)
            if other is not None:
                cand[other] = cand[b]
            cand[b] = c
        else:
            k = rng.randrange(0, n + 1)
            dlt = rng.choice((-1, 1))
            for x in order:
                if cand[x] >= k:
                    cand[x] += dlt
            if min(cand.values()) < 0 or len({(lane[x], cand[x]) for x in order}) < n:
                continue
        cc = cost(cand)
        if cc <= cur_c or rng.random() < math.exp((cur_c - cc) / temp):
            cur, cur_c = cand, cc
            if cc < best_c:
                best, best_c = dict(cand), cc
    used = sorted(set(best.values()))
    remap = {c: i for i, c in enumerate(used)}
    return {b: remap[c] for b, c in best.items()}, lane


class Router:
    """Orthogonal routes on the cell grid (A*): no route runs along another, crossings are straight,
    bends and crossings cost extra."""
    BEND, CROSS, HUG = 2.5, 7.0, 1.2

    def __init__(self, w, h):
        self.W, self.H = w, h
        n = w * h
        self.block = bytearray(n)
        self.solid = bytearray(n)
        self.hl = [-1] * n
        self.vl = [-1] * n
        self.extra = [0.0] * n

    def block_rect(self, x, y, w, h, hug=True):
        W = self.W
        for yy in range(max(0, y), min(self.H, y + h)):
            for xx in range(max(0, x), min(W, x + w)):
                self.block[yy * W + xx] = 1
        if hug:
            for xx in range(x, x + w):
                for yy in (y - 1, y + h):
                    if 0 <= xx < W and 0 <= yy < self.H:
                        self.extra[yy * W + xx] += self.HUG
            for yy in range(y, y + h):
                for xx in (x - 1, x + w):
                    if 0 <= xx < W and 0 <= yy < self.H:
                        self.extra[yy * W + xx] += self.HUG

    def find(self, starts, goals, target_rect, bonus):
        W, H = self.W, self.H
        tx, ty, tw, th = target_rect

        def hcost(x, y):
            dx = (tx - 1 - x) if x < tx - 1 else (x - (tx + tw)) if x > tx + tw else 0
            dy = (ty - 1 - y) if y < ty - 1 else (y - (ty + th)) if y > ty + th else 0
            return dx + dy

        INF = float('inf')
        G = {}
        prev = {}
        pq = []
        for x, y, d, c0 in starts:
            s = (y * W + x) * 4 + d
            if c0 < G.get(s, INF):
                G[s] = c0
                prev[s] = -1
                heapq.heappush(pq, (c0 + hcost(x, y), c0, s))
        while pq:
            f, g, s = heapq.heappop(pq)
            if g > G.get(s, INF):
                continue
            d, p = s & 3, s >> 2
            x, y = p % W, p // W
            if goals.get(p) == d:
                path = []
                while s != -1:
                    path.append(s)
                    s = prev[s]
                path.reverse()
                return g, [((q >> 2) % W, (q >> 2) // W, q & 3) for q in path]
            here_cross = self.hl[p] >= 0 or self.vl[p] >= 0
            for nd in (R, D, L, U):
                if nd == OPP[d] or (here_cross and nd != d):
                    continue
                nx, ny = x + DX[nd], y + DY[nd]
                if not (0 <= nx < W and 0 <= ny < H):
                    continue
                q = ny * W + nx
                if self.block[q] or self.solid[q]:
                    continue
                c = 1.0 + self.extra[q] + bonus.get(q, 0.0)
                if nd != d:
                    c += self.BEND
                if nd in (R, L):
                    if self.hl[q] >= 0:
                        continue
                    if self.vl[q] >= 0:
                        c += self.CROSS
                else:
                    if self.vl[q] >= 0:
                        continue
                    if self.hl[q] >= 0:
                        c += self.CROSS
                ng = g + c
                ns = q * 4 + nd
                if ng < G.get(ns, INF):
                    G[ns] = ng
                    prev[ns] = s
                    heapq.heappush(pq, (ng + hcost(nx, ny), ng, ns))
        return None

    def commit(self, rid, cells, into):
        """cells: [(x, y, arrival direction)]; into: the direction of the arrowhead."""
        W = self.W
        last = len(cells) - 1
        for i, (x, y, din) in enumerate(cells):
            p = y * W + x
            dout = cells[i + 1][2] if i < last else into
            if i == 0 or i == last or din != dout:
                self.solid[p] = 1
            elif din in (R, L):
                self.hl[p] = rid
                for yy in (y - 1, y + 1):
                    if 0 <= yy < self.H:
                        self.extra[yy * W + x] += 0.6
            else:
                self.vl[p] = rid
                for xx in (x - 1, x + 1):
                    if 0 <= xx < W:
                        self.extra[y * W + xx] += 0.6


class Route:
    def __init__(self, k, step, cells, into, src_side, cost):
        self.k, self.step, self.cells, self.into, self.src_side, self.cost = k, step, cells, into, src_side, cost
        self.kind = step.get('kind', 'call')
        self.badge = None      # (x, y) of the number badge
        self.badge_room = 0    # cells free for a longer badge (number and verb)
        self.badge_side = 'on'
        self.badge_w = 0       # cells the badge takes
        self.badge_pad = 1     # 1: a space each side of the number, 0: the number alone
        self.badge_run = None  # (x0, x1, y) of the straight piece an 'on' badge sits on


class Layout:
    """A flow or paper drawn on a grid: gutter with the lanes, boxes in columns, routed steps."""

    def __init__(self, atlas, dg, compact=0, ascii_=False):
        """compact: 0 everything … 4 names only; 5 is 4 without the empty row above the top lane's boxes
        and below the bottom lane's (for screens just too short for 4)."""
        self.atlas, self.dg, self.compact, self.ascii = atlas, dg, compact, ascii_
        self.tight = compact >= 5
        self.cols, lane_of = layout_columns(dg)
        self.boxes = {}
        lanes = dg.lanes
        for bid in dg.order:
            self.boxes[bid] = BoxL(dg, bid, lane_of.get(bid, 0), compact, atlas)
            self.boxes[bid].col = self.cols.get(bid, 0)
        # gutter: the lanes' names, written across, or down (縦書き) when room is short
        self.vertical = compact >= 3
        if self.vertical:
            gw = 5
        else:
            gw = max([sw(l['name']) for l in lanes] + [sw(l.get('sub', '')) for l in lanes
                                                        if sw(l.get('sub', '')) <= 14] + [8]) + 3
        self.gutter = gw
        ncol = max([b.col for b in self.boxes.values()] + [0]) + 1
        colw = [0] * ncol
        for b in self.boxes.values():
            colw[b.col] = max(colw[b.col], b.w)
        self.gap = (7, 6, 5, 5, 4)[min(compact, 4)]
        xs, x = [], gw + 2
        for c in range(ncol):
            xs.append(x)
            x += colw[c] + self.gap
        self.W = x - self.gap + 2
        for b in self.boxes.values():
            b.x = xs[b.col] + (colw[b.col] - b.w) // 2
        # lanes, top to bottom
        self.lanes = []
        y = 0
        for i, l in enumerate(lanes):
            members = [b for b in self.boxes.values() if b.lane == i]
            sub = balanced(l.get('sub', ''), gw - 3) if l.get('sub') and not self.vertical else []
            if members:
                bh = max(b.h for b in members)
                h = max(bh + 2, 1 + len(sub) + 1)   # a name written down never adds rows (see lane_label)
                top = 1
                if self.tight and i == 0:
                    top, h = 0, h - 1
                if self.tight and i == len(lanes) - 1:
                    h -= 1
                for b in members:
                    b.y = y + top
            else:
                h = 1
            self.lanes.append({'i': i, 'id': l['id'], 'name': l['name'], 'sub': sub, 'tone': l['tone'],
                               'sub_text': l.get('sub', ''), 'y': y, 'h': h, 'empty': not members})
            y += h
        self.H = y
        self.regions = self._regions()
        # routes first; then each region's label goes where no route crosses its region's edge. A label with
        # no free spot is pinned to its corner and the routes are found again around it.
        self._pinned = set()
        self.routes = self._route_all()
        if not self._place_labels():
            self.routes = self._route_all()
            self._place_labels(final=True)
        self._badges()

    # ── regions: the execution contexts, as shaded areas around their boxes
    def _regions(self):
        out = []
        boxes = self.boxes
        for reg in self.dg.regions:
            members = [b for b in reg.get('boxes', []) if b in boxes]
            if not members:
                continue
            clusters = [[b] for b in members]
            merged = True
            while merged:
                merged = False
                for i in range(len(clusters)):
                    for j in range(i + 1, len(clusters)):
                        u = clusters[i] + clusters[j]
                        x0 = min(boxes[b].x for b in u)
                        x1 = max(boxes[b].x + boxes[b].w for b in u)
                        y0 = min(boxes[b].y for b in u)
                        y1 = max(boxes[b].y + boxes[b].h for b in u)
                        clash = any(b not in u and boxes[b].x < x1 + 2 and boxes[b].x + boxes[b].w > x0 - 2
                                    and boxes[b].y < y1 + 1 and boxes[b].y + boxes[b].h > y0 - 1 for b in boxes)
                        if not clash:
                            clusters[i] = u
                            del clusters[j]
                            merged = True
                            break
                    if merged:
                        break
            for cl in clusters:
                x0 = min(boxes[b].x for b in cl) - 2
                x1 = max(boxes[b].x + boxes[b].w for b in cl) + 2
                y0 = max(0, min(boxes[b].y for b in cl) - 1)
                y1 = min(self.H, max(boxes[b].y + boxes[b].h for b in cl) + 1)
                out.append({'node': reg.get('node'), 'label': reg.get('label', ''), 'label3': reg.get('label3'),
                            'at': reg.get('at', 'tl'), 'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0, 'boxes': cl})
        # shaded areas of different contexts must not touch: the upper one gives up its margin row
        for a in out:
            for b in out:
                if a is b or a['node'] == b['node'] or not (a['x'] < b['x'] + b['w'] and b['x'] < a['x'] + a['w']):
                    continue
                if a['y'] < b['y'] and a['y'] + a['h'] >= b['y']:
                    a['h'] = b['y'] - 1 - a['y']
        for r in out:
            r['text'] = self._region_label(r)
        return out

    def _label_options(self, r):
        """The names a region may be labelled with, longest first, that fit in it."""
        room = r['w'] - 2
        node = self.atlas.nodes.get(r['node'] or '') or {}
        out = []
        for o in [r['label'], r['label3'], re.sub(r'（.*?）', '', r['label'] or ''),
                  node.get('title'), re.sub(r'（.*?）', '', node.get('title') or '')]:
            if o and sw(o) <= room and o not in out:
                out.append(o)
        return out

    def _region_label(self, r):
        opts = self._label_options(r)
        return opts[0] if opts else ''

    def _label_spots(self, r, text):
        """Where a label may go in its region: the corner the map asks for first, then the other places on
        the region's top and bottom rows."""
        at = r.get('at') or 'tl'
        rows = [r['y'] + r['h'] - 1, r['y']] if at.startswith('b') else [r['y'], r['y'] + r['h'] - 1]
        left, right = r['x'] + 1, r['x'] + r['w'] - 1 - sw(text)
        centre = r['x'] + (r['w'] - sw(text)) // 2
        xs = [right, left, centre] if at.endswith('r') else [left, right, centre]
        return [(x, y) for y in rows for x in xs]

    def _widen_ok(self, r, x0, x1):
        """Whether region r may take the columns x0..x1-1 too: no box outside it and no other region there."""
        y0, y1 = r['y'], r['y'] + r['h']
        if x0 < self.gutter + 1 or x1 > self.W - 1:
            return False
        for b in self.boxes.values():
            if b.id not in r['boxes'] and b.x < x1 + 1 and b.x + b.w > x0 - 1 and b.y < y1 and b.y + b.h > y0:
                return False
        for o in self.regions:
            if o is not r and o['x'] < x1 + 1 and o['x'] + o['w'] > x0 - 1 and o['y'] < y1 + 1 and o['y'] + o['h'] > y0 - 1:
                return False
        return True

    def _place_labels(self, final=False):
        rt, W = self.router, self.W
        ok = True

        def free(lx, ly, text):
            return 0 <= ly < self.H and all(
                0 <= x < W and not (rt.block[ly * W + x] or rt.solid[ly * W + x] or rt.hl[ly * W + x] >= 0
                                    or rt.vl[ly * W + x] >= 0) for x in range(lx - 1, lx + sw(text) + 1))

        for i, r in enumerate(self.regions):
            if not r['text']:
                continue
            spot = None
            if i not in self._pinned:
                for text in self._label_options(r):
                    for lx, ly in self._label_spots(r, text):
                        if free(lx, ly, text):
                            spot = (lx, ly, text)
                            break
                    if spot:
                        break
                if spot is None:
                    # a narrow region whose edges the routes cross: widen its shade sideways for the label
                    text = self._region_label(r)
                    for e in range(1, sw(text) + 3):
                        for side in ('r', 'l'):
                            x0, x1 = (r['x'] + r['w'], r['x'] + r['w'] + e) if side == 'r' else (r['x'] - e, r['x'])
                            if not self._widen_ok(r, x0, x1):
                                continue
                            nr = dict(r, x=min(r['x'], x0), w=r['w'] + e)
                            for lx, ly in self._label_spots(nr, text):
                                if free(lx, ly, text):
                                    spot = (lx, ly, text)
                                    r['x'], r['w'] = nr['x'], nr['w']
                                    break
                            if spot:
                                break
                        if spot:
                            break
            if spot is None:
                if not final and i not in self._pinned:
                    self._pinned.add(i)
                    ok = False
                    continue
                r['text'] = self._region_label(r)
                spot = self._region_label_xy(r) + (r['text'],)
            r['lx'], r['ly'], r['text'] = spot
            rt.block_rect(spot[0] - 1, spot[1], sw(spot[2]) + 2, 1, hug=False)
        return ok

    # ── routes
    def _ports(self, b, side):
        x, y, w, h = b.rect()
        if side == R:
            return [(x + w, yy) for yy in range(y + 1, y + h - 1)]
        if side == L:
            return [(x - 1, yy) for yy in range(y + 1, y + h - 1)]
        if side == U:
            return [(xx, y - 1) for xx in range(x + 2, x + w - 2)]
        return [(xx, y + h) for xx in range(x + 2, x + w - 2)]

    def _side_costs(self, a, b):
        """Cost of leaving a by each side, heading for b."""
        cost = {}
        if a.lane == b.lane:
            right = b.x > a.x
            cost = {R: 0 if right else 5, L: 0 if not right else 5, U: 2.5, D: 2.5}
        else:
            below = b.lane > a.lane
            cost = {D: 0 if below else 6, U: 0 if not below else 6}
            dx = b.cx - a.cx
            cost[R] = 1.5 if dx > a.w // 2 else 4.5
            cost[L] = 1.5 if dx < -a.w // 2 else 4.5
        return cost

    def _route_all(self):
        dg, boxes = self.dg, self.boxes
        steps = [(k, s) for k, s in enumerate(dg.steps) if s.get('from') in boxes and s.get('to') in boxes
                 and s['from'] != s['to']]

        def dist(ks):
            k, s = ks
            a, b = boxes[s['from']], boxes[s['to']]
            return (1 if s.get('alt') else 0, abs(a.cx - b.cx) + 3 * abs(a.lane - b.lane), k)

        orders = [sorted(steps, key=dist), steps, sorted(steps, key=lambda ks: (dist(ks)[0], -dist(ks)[1]))]
        best = None
        for order in orders:
            res, rt = self._route_order(order)
            score = sum(r.cost for r in res.values()) + 200 * (len(steps) - len(res))
            if best is None or score < best[0]:
                best = (score, res, rt)
        self.router = best[2]   # the cells the chosen routes take (badges are placed against these)
        return best[1]

    def _route_order(self, order):
        rt = Router(self.W, self.H)
        rt.block_rect(0, 0, self.gutter, self.H, hug=False)
        for b in self.boxes.values():
            rt.block_rect(b.x, b.y, b.w, b.h)
        for i, r in enumerate(self.regions):
            if r['text'] and i in self._pinned:
                lx, ly = self._region_label_xy(r)
                rt.block_rect(lx - 1, ly, sw(r['text']) + 2, 1, hug=False)
        used_ports = set()
        res = {}
        for k, s in order:
            a, b = self.boxes[s['from']], self.boxes[s['to']]
            sides = self._side_costs(a, b)
            starts = []
            for side, sc in sides.items():
                cells = self._ports(a, side)
                if not cells:
                    continue
                mid = (len(cells) - 1) / 2
                for i, (x, y) in enumerate(cells):
                    p = y * self.W + x
                    if not (0 <= x < self.W and 0 <= y < self.H) or rt.block[p] or rt.solid[p] or (x, y) in used_ports:
                        continue
                    if rt.hl[p] >= 0 or rt.vl[p] >= 0:
                        continue
                    off = (i if side in (R, L) else abs(i - mid) * 0.35)
                    starts.append((x, y, side, sc + off * (0.5 if side in (R, L) else 1)))
            goals, bonus = {}, {}
            tsides = self._side_costs(b, a)
            for side, sc in tsides.items():
                cells = self._ports(b, side)
                mid = (len(cells) - 1) / 2
                for i, (x, y) in enumerate(cells):
                    if not (0 <= x < self.W and 0 <= y < self.H):
                        continue
                    p = y * self.W + x
                    if rt.block[p] or rt.solid[p] or (x, y) in used_ports or rt.hl[p] >= 0 or rt.vl[p] >= 0:
                        continue
                    goals[p] = OPP[side]
                    off = (i if side in (R, L) else abs(i - mid) * 0.35)
                    bonus[p] = sc + off * (0.5 if side in (R, L) else 1)
            found = rt.find(starts, goals, b.rect(), bonus) if starts and goals else None
            if not found:
                continue
            cost, cells = found
            into = cells[-1][2]
            rt.commit(k, cells, into)
            used_ports.add(cells[0][:2])
            used_ports.add(cells[-1][:2])
            for (x, y) in (cells[0][:2], cells[-1][:2]):
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = (y + dy) * self.W + x + dx
                    if 0 <= q < len(rt.extra):
                        rt.extra[q] += 1.5
            res[k] = Route(k, s, cells, into, cells[0][2], cost)
        return res, rt

    def _region_label_xy(self, r):
        at = r.get('at') or 'tl'
        y = r['y'] + r['h'] - 1 if at.startswith('b') else r['y']
        if at.endswith('r'):
            x = r['x'] + r['w'] - 1 - sw(r['text'])
        else:
            x = r['x'] + 1
        return x, y

    # ── badges: the step numbers on their routes
    def _badges(self):
        """Each step's number, in this order of preference: on a straight horizontal piece with line left on
        both sides, beside a vertical piece, above or below a short horizontal piece (between close
        neighbours), on a short piece without padding. Never on a box, another route, another badge or an
        arrowhead."""
        rt = self.router
        W, H = self.W, self.H
        taken = set()

        def free(xx, y):
            if not (self.gutter <= xx < W and 0 <= y < H) or (xx, y) in taken:
                return False
            p = y * W + xx
            return not (rt.block[p] or rt.solid[p] or rt.hl[p] >= 0 or rt.vl[p] >= 0)

        def room(x, y):
            n = 0
            while free(x + n, y):
                n += 1
            return n

        def take(r, x, y, w, side, pad, room_, run=None):
            r.badge, r.badge_side, r.badge_w, r.badge_pad, r.badge_room = (x, y), side, w, pad, room_
            r.badge_run = run
            for xx in range(x, x + w):
                taken.add((xx, y))

        def on_run(r, i, j, w, pad, cross=False):
            """Puts the badge on the run cells[i..j], as near its middle as crossings allow (with cross, it may
            cover where a straight vertical route crosses the run)."""
            xs = sorted((r.cells[i][0], r.cells[j][0]))
            y = r.cells[i][1]

            def ok(xx):
                return (xx, y) not in taken and (cross or rt.vl[y * W + xx] < 0)

            lo, hi = xs[0] + (1 if pad else 0), xs[1] - w + 1 - (1 if pad else 0)
            if hi < lo:
                return False
            mid = (lo + hi) // 2
            for bx in sorted(range(lo, hi + 1), key=lambda b: (abs(b - mid), b)):
                if all(ok(xx) for xx in range(bx, bx + w)):
                    a = bx
                    while a - 1 >= xs[0] and ok(a - 1):
                        a -= 1
                    b = bx + w - 1
                    while b + 1 <= xs[1] and ok(b + 1):
                        b += 1
                    take(r, bx, y, w, 'on', pad, (b - a + 1) - 2, (a, b, y))
                    return True
            return False

        for r in sorted(self.routes.values(), key=lambda r: r.k):
            label = self.dg.labels[r.k]
            lw = sw(label)
            bw = lw + 2
            cells = r.cells
            n = len(cells)
            own = {(x, y) for x, y, _ in cells}
            # straight horizontal runs of this route, without its first cell and its arrowhead
            runs, i = [], 1
            while i < n - 1:
                x, y, d = cells[i]
                nxt = cells[i + 1][2] if i + 1 < n else r.into
                if d in (R, L) and nxt == d:
                    j = i
                    while j + 1 < n - 1 and cells[j + 1][2] == d and cells[j + 2][2] == d:
                        j += 1
                    runs.append((i, j))
                    i = j + 1
                else:
                    i += 1
            runs.sort(key=lambda ij: -(ij[1] - ij[0]))
            placed = False
            for (i, j) in runs:
                if j - i + 1 >= bw and on_run(r, i, j, bw, 1):
                    placed = True
                    break
            if placed:
                continue
            # beside a straight vertical piece (never beside the arrowhead's cell)
            verts = [c for i, c in enumerate(cells) if c[2] in (U, D) and i < n - 1
                     and (cells[i + 1][2] if i + 1 < n else r.into) == c[2]]
            verts.sort(key=lambda c: abs(cells.index(c) - (n - 1) / 2))
            for (x, y, d) in verts:
                for side in (1, -1):
                    xs = range(x + 1, x + 1 + bw) if side == 1 else range(x - bw, x)
                    if all(free(xx, y) for xx in xs):
                        take(r, xs[0], y, bw, 'right' if side == 1 else 'left', 1,
                             room(xs[0], y) if side == 1 else bw)
                        placed = True
                        break
                if placed:
                    break
            if placed:
                continue
            # above or below a short horizontal piece: the cells of one row, the arrowhead included
            segs = {}
            for x, y, _ in cells:
                segs.setdefault(y, []).append(x)
            for y, xs_ in sorted(segs.items(), key=lambda kv: -len(kv[1])):
                if len(xs_) < 2:
                    continue
                x0, x1 = min(xs_), max(xs_)
                for dy in (-1, 1):
                    yy = y + dy
                    centre = x0 + (x1 - x0 + 1 - bw) // 2
                    for off in (0, 1, -1, 2, -2):
                        bx = centre + off
                        if bx < x0 - 1 or bx + bw - 1 > x1 + 1:
                            continue
                        if all(free(xx, yy) and (xx, yy) not in own for xx in range(bx, bx + bw)):
                            take(r, bx, yy, bw, 'above' if dy < 0 else 'below', 1, room(bx, yy))
                            placed = True
                            break
                    if placed:
                        break
                if placed:
                    break
            if placed:
                continue
            # on a run after all, over a straight crossing (the crossing line shows above and below it)
            for (i, j) in runs:
                if j - i + 1 >= bw + 2 and on_run(r, i, j, bw, 1, cross=True):
                    placed = True
                    break
            if placed:
                continue
            # on a short horizontal run, the number alone
            for (i, j) in runs:
                if j - i + 1 >= lw and on_run(r, i, j, lw, 0):
                    placed = True
                    break
            if placed:
                continue
            # last resort: anywhere next to the route
            for x, y, _ in cells:
                for bx, yy in ((x + 1, y), (x - bw, y), (x - bw // 2, y - 1), (x - bw // 2, y + 1)):
                    if all(free(xx, yy) for xx in range(bx, bx + bw)):
                        take(r, bx, yy, bw, 'near', 1, bw)
                        placed = True
                        break
                if placed:
                    break
        self.badge_cells = taken


def vertical_text(s):
    """s written down (縦書き), one row each: a Japanese character, or up to two Latin letters side by side
    (縦中横). ー becomes ｜, spaces go."""
    out = []
    for m in re.finditer(r'[!-~]{1,2}|\S', s):
        t = m.group(0)
        out.append('｜' if t in ('ー', '－') else t)
    return out


def lane_label(g, ln, gutter, y0, h, st):
    """A lane's name in a narrow gutter, in h rows from y0: written down (縦書き) when it fits, else two
    characters a row."""
    chars = vertical_text(ln['name'])
    if len(chars) <= h:
        yy = y0 + (h - len(chars)) // 2
        for i, c in enumerate(chars):
            g.put(2, yy + i, c if sw(c) == 2 else c.center(2), st)
        return
    rows, cur = [], ''
    for c in ln['name'].replace(' ', ''):
        if sw(cur + c) > gutter - 1:
            rows.append(cur)
            cur = ''
        cur += c
    if cur:
        rows.append(cur)
    if len(rows) <= h:
        yy = y0 + (h - len(rows)) // 2
        for i, r in enumerate(rows):
            g.put(1, yy + i, r, st)


_COLS = {}


def layout_columns(dg):
    if dg.id not in _COLS:
        _COLS[dg.id] = assign_columns(dg)
    return _COLS[dg.id]

# ───────────────────────────────────────────────────────────── drawing a diagram

def walk_of(dg, cur):
    """The steps taken up to cur (in order): main steps up to cur, or, for a "もし" step, the main steps
    before the one it replaces and the もし steps up to cur."""
    s = dg.steps[cur]
    if s.get('alt'):
        at = s['alt'].get('at', 0)
        main = [k for k in range(at) if not dg.steps[k].get('alt')]
        alts = [k for k in range(len(dg.steps)) if dg.steps[k].get('alt') and dg.steps[k]['alt'].get('at') == at
                and k <= cur]
        return main + alts
    return [k for k in range(cur + 1) if not dg.steps[k].get('alt')]


BOX_CORNERS = {'store': '╭╮╰╯', 'hw': '┌┐└┘'}


def draw_box(g, b, state, selected, ascii_=False):
    """state: 'active' (in the current step), 'seen' (in a step taken), 'later'."""
    x, y, w, h = b.rect()
    line_role = 'L.' + b.tone if state in ('active', 'seen') else 'line'
    bgr = 'sel' if selected else g.bg_of(min(max(x + 1, 0), g.w - 1), min(max(y + 1, 0), g.h - 1))
    if selected:
        g.fill(x + 1, y + 1, w - 2, h - 2, S('text', bgr))
    else:
        g.fill(x + 1, y + 1, w - 2, h - 2, S('text', bgr))
    st = S(line_role, g.bg_of(x, y) if 0 <= x < g.w and 0 <= y < g.h else 'bg', BOLD if state == 'active' else 0)
    tl, tr, bl, br = ('++++' if ascii_ else '┏┓┗┛' if state == 'active' else BOX_CORNERS.get(b.kind, '┌┐└┘'))
    hz, vt = ('-', '|') if ascii_ else ('━', '┃') if state == 'active' else ('─', '│')
    g.put(x, y, tl + hz * (w - 2) + tr, st, keep_bg=True)
    g.put(x, y + h - 1, bl + hz * (w - 2) + br, st, keep_bg=True)
    for yy in range(y + 1, y + h - 1):
        g.put(x, yy, vt, st, keep_bg=True)
        g.put(x + w - 1, yy, vt, st, keep_bg=True)
    # tags in the top border: entry on the left, paper on the right
    tx = x + 2
    for t in b.tags:
        if t == '入口':
            g.put(tx, y, ' ' + t + ' ', S('strong' if state != 'later' else 'dim', 'chip2', BOLD), keep_bg=False)
            tx += sw(t) + 3
    if b.paper:
        t = ' 中の紙 '
        g.put(x + w - 2 - sw(t), y, t, S('ink', 'accent', BOLD) if state != 'later' else S('text', 'chip2', BOLD))
    for i, p in enumerate(b.port_out):
        t = ' 外へ：' + p + ' '
        g.put(x + 2, y + h - 1, t, S('dim' if state == 'later' else 'text', 'chip'))
    tr_role = 'strong' if state == 'active' else ('text' if state == 'seen' else 'dim')
    g.put(x + 2, y + 1, b.title, S(tr_role, bgr, BOLD if state != 'later' else 0), x1=x + w - 2)
    yy = y + 2
    for s in b.sub:
        g.put(x + 2, yy, s, S('dim', bgr), x1=x + w - 2)
        yy += 1
    if b.cells:
        xx = x + 2
        for c in b.cells:
            if c == '…':
                xx = g.put(xx, yy, '…', S('dim', bgr), x1=x + w - 2) + 1
                continue
            xx = g.put(xx, yy, c, S('text' if state != 'later' else 'dim', 'chip2' if state == 'active'
                                    else 'chip'), x1=x + w - 2) + 1


def draw_layout(lay, cur, sel=None, theme_alt=True):
    """The diagram lay at step cur (index into the steps), as a Grid of lay.W × lay.H."""
    dg = lay.dg
    g = Grid(lay.W, lay.H, S('text', 'bg'))
    walk = walk_of(dg, cur)
    taken = set(walk)
    s_cur = dg.steps[cur]
    active = {s_cur.get('from'), s_cur.get('to')}
    seen = set()
    for k in walk:
        seen.add(dg.steps[k].get('from'))
        seen.add(dg.steps[k].get('to'))
    show_alt = set()
    if s_cur.get('alt'):
        show_alt = set(walk)
    else:
        for j in dg.alts_of(cur):
            show_alt.add(j)
    # lanes
    for ln in lay.lanes:
        bar = S('L.' + ln['tone'], 'bg')
        for yy in range(ln['y'], ln['y'] + ln['h']):
            g.put(0, yy, '▌' if not lay.ascii else '|', bar)
        name_st = S('T.' + ln['tone'], 'bg', BOLD)
        if ln['empty']:
            # a lane with no box: its name and what it is, and (away from any region's label) that it is empty
            x = g.put(2, ln['y'], ln['name'], name_st)
            if ln.get('sub_text') and x + 2 + sw(ln['sub_text']) < lay.W - 20:
                x = g.put(x + 2, ln['y'], ln['sub_text'], S('dim', 'bg'))
            note = 'この' + ('流れ' if dg.kind == 'flow' else '紙') + 'の箱はない'
            g.put(max(x + 4, (x + lay.W - sw(note)) // 2), ln['y'], note, S('faint', 'bg'))
            continue
        if lay.vertical:
            lane_label(g, ln, lay.gutter, ln['y'], ln['h'], name_st)
            continue
        g.put(2, ln['y'] + 1, ln['name'], name_st)
        for i, s in enumerate(ln['sub']):
            if ln['y'] + 2 + i < ln['y'] + ln['h']:
                g.put(2, ln['y'] + 2 + i, s, S('dim', 'bg'), x1=lay.gutter - 1)
    # regions: shaded
    for r in lay.regions:
        g.tint(r['x'], r['y'], r['w'], r['h'], 'region')
    for r in lay.regions:
        if r['text']:
            x, y = r.get('lx'), r.get('ly')
            if x is None:
                x, y = lay._region_label_xy(r)
            on = any(b in active for b in r['boxes'])
            g.put(x, y, r['text'], S('text' if on else 'dim', 'region'))
    # boxes
    for b in lay.boxes.values():
        state = 'active' if b.id in active else 'seen' if b.id in seen else 'later'
        draw_box(g, b, state, sel == b.id, lay.ascii)
    # routes: later ones first, the current one last
    def rstate(k):
        if k == cur:
            return 'cur'
        if k in taken:
            return 'done'
        return 'later'

    order = sorted(lay.routes.values(), key=lambda r: {'later': 0, 'done': 1, 'cur': 2}[rstate(r.k)])
    for r in order:
        k = r.k
        if dg.steps[k].get('alt') and k not in show_alt:
            continue
        st_name = rstate(k)
        alt_maybe = dg.steps[k].get('alt') and k != cur and k not in taken
        role = {'cur': 'accent', 'done': 'done', 'later': 'future'}[st_name]
        if alt_maybe:
            role = 'warn'
        attr = BOLD if st_name == 'cur' else 0
        cells = r.cells
        n = len(cells)
        for i, (x, y, din) in enumerate(cells):
            dout = cells[i + 1][2] if i < n - 1 else r.into
            if i == n - 1:
                ch = head_glyph(r.kind, r.into, lay.ascii)
            elif i == 0 and tail_glyph(r.kind, lay.ascii):
                ch = tail_glyph(r.kind, lay.ascii)
            else:
                ch = line_glyph(r.kind, {OPP[din], dout}, lay.ascii, heavy=(st_name == 'cur'))
            # crossings: a later route does not cut a taken one
            old = g.ch[y][x]
            if old not in (' ', '') and st_name == 'later' and old not in '┄┈':
                continue
            g.put(x, y, ch, S(role, g.bg_of(x, y), attr))
        # where it leaves the box: a junction on the border
        x, y, d = cells[0]
        bx, by = x - DX[d], y - DY[d]
        if 0 <= bx < g.w and 0 <= by < g.h and not lay.ascii:
            heavy_box = any(b.id in active and b.x <= bx < b.x + b.w and b.y <= by < b.y + b.h
                            for b in lay.boxes.values())
            j = {R: '├', L: '┤', U: '┴', D: '┬'}[d]
            if st_name == 'cur':
                j = {R: '┝', L: '┥', U: '┸', D: '┰'}[d]
            if heavy_box:
                j = {R: '┣', L: '┫', U: '┻', D: '┳'}[d] if st_name == 'cur' else {R: '┠', L: '┨', U: '┷', D: '┯'}[d]
            if r.kind == 'syscall':
                j = {R: '╞', L: '╡', U: '╨', D: '╥'}[d] if not heavy_box else g.ch[by][bx]
            g.put(bx, by, j, S(role, g.bg_of(bx, by), attr))
    # badges
    for r in order:
        k = r.k
        if r.badge is None or (dg.steps[k].get('alt') and k not in show_alt):
            continue
        st_name = rstate(k)
        label = dg.labels[k]
        text = ' %s ' % label if r.badge_pad else label
        if dg.steps[k].get('alt') and st_name != 'cur' and k not in taken:
            st = S('ink', 'warn', BOLD)
        elif st_name == 'cur':
            st = S('ink', 'accent', BOLD)
            verb = dg.steps[k].get('verb')
            if verb and r.badge_pad and sw(text) + sw(verb) + 1 <= r.badge_room:
                text = ' %s %s ' % (label, verb)
        elif st_name == 'done':
            st = S('strong', 'done_bg')
        else:
            st = S('dim', 'future_bg')
        bx, by = r.badge
        if r.badge_side == 'on' and r.badge_pad and sw(text) > r.badge_w:
            x0, x1, y = r.badge_run
            bx = x0 + ((x1 - x0 + 1) - sw(text)) // 2
        elif r.badge_side == 'left':
            bx = r.badge[0] + r.badge_w - sw(text)
        g.put(bx, by, text, st)
    return g

# ───────────────────────────────────────────────────────────── frames for the HTML terminal

def frame_dict(g):
    """A grid as a frame for web/term.js: styles by role, rows as runs."""
    used, rows = {}, []
    for row in g.runs():
        out = []
        for x, st, text, wide in row:
            if st not in used:
                used[st] = len(used)
            out.append([x, used[st], text, 1] if wide else [x, used[st], text])
        rows.append(out)
    styles = [None] * len(used)
    for st, i in used.items():
        styles[i] = list(_STY[st])
    return {'w': g.w, 'h': g.h, 'styles': styles, 'rows': rows}


def palettes():
    return {name: {role: Theme(name).hex(role) for role in roles} for name, roles in THEMES.items()}

# ───────────────────────────────────────────────────────────── panes and documents

def B(role):
    return (role, None, BOLD)


def CHIP(fg, bg):
    return (fg, bg, 0)


def style_of(role, bg):
    if isinstance(role, tuple):
        fg, b, attr = role
        return S(fg, b or bg, attr)
    return S(role, bg)


class Doc:
    """Lines of spans (text, role, ref) for a pane."""

    def __init__(self, width):
        self.w = max(8, width)
        self.lines = []

    def add(self, spans=()):
        self.lines.append([s if len(s) == 3 else (s[0], s[1], None) for s in spans])
        return self

    def blank(self):
        if self.lines and self.lines[-1]:
            self.lines.append([])

    def para(self, spans, indent=0):
        spans = [s if len(s) == 3 else (s[0], s[1], None) for s in spans]
        for line in wrap(spans, self.w - indent):
            self.lines.append(([(' ' * indent, 'text', None)] if indent else []) + line)

    def fit(self, h):
        """Drops blank lines, last first (the first one last), until the document has at most h lines."""
        blanks = [i for i, l in enumerate(self.lines) if not l]
        for i in blanks[1:][::-1] + blanks[:1]:
            if len(self.lines) <= h:
                break
            del self.lines[i]
        return self

    def kv(self, key, spans, kw=7, key_role='dim'):
        spans = [s if len(s) == 3 else (s[0], s[1], None) for s in spans]
        lines = wrap(spans, self.w - kw) if spans else [[]]
        for i, line in enumerate(lines):
            k = pad(key, kw) if i == 0 else ' ' * kw
            self.lines.append([(k, key_role, None)] + line)


def draw_spans(g, x, y, spans, x1, bg):
    for sp in spans:
        x = g.put(x, y, sp[0], style_of(sp[1], bg), x1=x1)
    return x


def draw_doc(g, doc, x, y, w, h, scroll, bg):
    for i in range(h):
        j = scroll + i
        if j >= len(doc.lines):
            break
        draw_spans(g, x, y + i, doc.lines[j], x + w, bg)


def panel(g, x, y, w, h, title=None, bg='bg', role='line', title_role='dim', right=None, ascii_=False):
    st = S(role, bg)
    if ascii_:
        tl, tr, bl, br, hz, vt = '+', '+', '+', '+', '-', '|'
    else:
        tl, tr, bl, br, hz, vt = '╭', '╮', '╰', '╯', '─', '│'
    g.fill(x + 1, y + 1, w - 2, h - 2, S('text', bg))
    g.put(x, y, tl + hz * (w - 2) + tr, st)
    for yy in range(y + 1, y + h - 1):
        g.put(x, yy, vt, st)
        g.put(x + w - 1, yy, vt, st)
    g.put(x, y + h - 1, bl + hz * (w - 2) + br, st)
    if title:
        g.put(x + 2, y, ' ' + title + ' ', S(title_role, bg, BOLD), x1=x + w - 2)
    if right:
        g.put(x + w - 3 - sw(right), y, ' ' + right + ' ', S('faint', bg), x1=x + w - 1)


def page_key(scroll, more):
    """The key that shows the rest of a pane: PgDn while there is more below, PgUp once at its end."""
    return 'PgUp' if scroll >= more else 'PgDn'


def kind_sample(kind, ascii_=False):
    return (tail_glyph(kind, ascii_) or line_glyph(kind, {L, R}, ascii_)) + line_glyph(kind, {L, R}, ascii_) + \
        head_glyph(kind, R, ascii_)


def src_attrs(n):
    """The attribute lines of a node's source (between its first two lines and the text)."""
    lines = (n.get('src') or '').split('\n')
    out = []
    for line in lines[2:]:
        if not line.strip():
            break
        out.append(line)
    return out


def step_doc(app, dg, k, width):
    a = app.a
    s = dg.steps[k]
    d = Doc(width)
    fb, tb = dg.boxes.get(s.get('from')), dg.boxes.get(s.get('to'))

    def box_span(b):
        if not b:
            return ('?', 'dim', None)
        return (b.get('title', b['id']), ('T.' + dg.tone_of(b['id']), None, BOLD), b.get('node'))

    if s.get('alt'):
        at = s['alt'].get('at', 0)
        d.add([(' もし %s ' % s['alt'].get('when', ''), CHIP('ink', 'warn')),
               ('  手順 %s の代わりに起きる' % dg.labels[at], 'warn')])
    head = []
    if s.get('verb'):
        head.append((s['verb'], B('strong')))
        head.append(('   ', 'text'))
    head.append((kind_sample(s.get('kind'), app.ascii) + ' ' + STEP_KIND.get(s.get('kind'), s.get('kind', '')),
                 'dim'))
    d.add(head)
    lane_name = {l['id']: l['name'] for l in dg.lanes}
    who = [box_span(fb), ('  ' + ('━━▶' if not app.ascii else '->') + '  ', 'accent'), box_span(tb)]
    cross = []
    if fb and tb and fb.get('layer') != tb.get('layer'):
        cross = [(lane_name.get(fb.get('layer'), ''), 'T.' + dg.tone_of(fb['id']), None),
                 (' › ', 'faint', None), (lane_name.get(tb.get('layer'), ''), 'T.' + dg.tone_of(tb['id']), None)]
    if cross and sum(sw(sp[0]) for sp in who) + spans_width(cross) + 4 <= d.w:
        d.para(who + [('    ', 'text')] + cross)
    else:
        d.para(who)
        if cross:
            d.add([('層 ', 'faint')] + cross)
    d.blank()
    if s.get('label'):
        d.para([(s['label'], 'strong')])
    data = s.get('data')
    d.blank()
    if data:
        val = [(data.get('label', ''), B('accent2'), data.get('schema'))]
        if data.get('fields'):
            val.append(('  ', 'text'))
            for i, f in enumerate(data['fields']):
                if i:
                    val.append((' ', 'text'))
                val.append((f, CHIP('text', 'chip2')))
        d.kv('渡す', val)
        if data.get('type'):
            d.kv('', [(data['type'], 'code')])
        if data.get('note'):
            d.kv('', rich(a, data['note'], 'dim'))
    for op in s.get('ops') or []:
        d.kv('操作', [(a.title_of(op.get('node')), 'link', op.get('node')), ('：' + op.get('kind', ''), 'text')])
    if s.get('branches'):
        for i, (cond, then) in enumerate(s['branches']):
            d.kv('分かれる' if i == 0 else '', [(cond, 'text'), (' → ', 'faint')] + rich(a, then, 'text'), kw=9)
    alts = dg.alts_of(k)
    if alts and width < 60:
        when = dg.steps[alts[0]]['alt'].get('when', '')
        d.kv('もし', [('%s なら %s' % (when, '・'.join(dg.labels[j] for j in alts)), 'warn'), ('  a', B('strong')),
                    (' で見る', 'dim')])
    elif alts:
        when = dg.steps[alts[0]]['alt'].get('when', '')
        d.kv('もし', [('%s なら、この手順の代わりに' % when, 'warn'), ('  a', B('strong')), (' で見る', 'dim')])
        for j in alts:
            sj = dg.steps[j]
            fj, tj = dg.boxes.get(sj.get('from')), dg.boxes.get(sj.get('to'))
            line = [(' %s ' % dg.labels[j], CHIP('ink', 'warn')), (' ', 'text'), box_span(fj),
                    (' ' + kind_sample(sj.get('kind'), app.ascii) + ' ', 'warn'), box_span(tj)]
            if sj.get('verb'):
                line.append(('「%s」' % sj['verb'], 'text'))
            d.kv('', line)
    papers = dg.papers_at(k)
    code = a.step_code(dg.id, k)
    for bid, pid in papers:
        d.kv('中の紙', [(a.papers[pid].get('title', pid), 'link', pid), ('   ', 'text'),
                      ('Enter', B('strong')), (' で入る', 'dim')])
    if code:
        path, line, how = code
        d.kv('コード', [('%s:%d' % (path.split('/')[-1], line), 'code'), ('（行先の定義）' if how != 'line' else '', 'faint'),
                      ('   ', 'text'), ('c', B('strong')), (' で見る', 'dim')])
    return d


def schema_doc(app, schema_id, fields, width, height=99):
    """A data shape (struct) with the fields a step hands over marked: with what the marked fields mean when
    that fits, else one line each, else names only."""
    a = app.a
    n = a.nodes.get(schema_id) or {}
    marked = set(fields or [])
    rows = n.get('fields') or []
    bar = '▌' if not app.ascii else '>'
    for how, legend in (('wrap', True), ('wrap', False), ('line', True), ('line', False), ('none', True)):
        d = Doc(width)
        head = [(n.get('title', schema_id), B('accent2')), ('  ' + KIND_NAME.get(n.get('kind'), ''), 'dim')]
        count = '   %d 欄のうち %d' % (len(rows), len([r for r in rows if r[1] in marked]))
        if marked and sum(sw(t) for t, _ in head) + sw(count) <= width:
            head.append((count, 'faint'))
        d.para(head)
        tw = min(14, max([sw(f[0]) for f in rows] + [3]))
        nw = max([sw(f[1]) for f in rows] + [3])
        for f in rows:
            typ, name, meaning = (list(f) + ['', '', ''])[:3]
            on = name in marked or not marked
            mark = (bar, 'accent') if name in marked else (' ', 'text')
            d.add([mark, (' ' + pad(clip(typ, tw), tw) + ' ', 'ty' if name in marked else 'faint'),
                   (pad(name, nw), B('strong') if name in marked else 'text' if not marked else 'dim')])
            if meaning and on and how != 'none':
                lines = wrap(rich(a, meaning, 'dim' if not marked else 'text'), width - 4)
                if how == 'line' and len(lines) > 1:
                    lines = [[(clip(''.join(t for t, _, _ in lines[0] + lines[1]), width - 4), 'dim', None)]]
                for ln in lines:
                    d.add([(bar if name in marked else ' ', 'accent'), ('   ', 'text')] + ln)
        if marked and legend:
            d.blank()
            d.add([(bar, 'accent'), (' この手順で渡る欄', 'dim')])
        if len(d.lines) <= height:
            return d
    return d


def node_doc(app, nid, width):
    a = app.a
    n = a.nodes.get(nid)
    d = Doc(width)
    if not n:
        d.add([(nid, 'dim')])
        return d
    lay = a.layer.get(n.get('layer'), {})
    d.add([(n['title'], B('strong'))])
    d.add([(' ' + KIND_NAME.get(n['kind'], n['kind']) + ' ', CHIP('text', 'chip2')), (' ', 'text'),
           (lay.get('name', ''), B('T.' + n.get('layer', 'os'))), ('  ' + lay.get('sub', ''), 'faint')])
    c = a.code.get('nodes', {}).get(nid)
    if n.get('code') and n['code'][0]:
        loc = n['code'][0]
        sym = n['code'][1] if len(n['code']) > 1 and n['code'][1] else ''
        tail = ''
        if c and c.get('start'):
            tail = '%d' % c['start'] + ('-%d' % c['end'] if c.get('end') and c['end'] != c['start'] else '') + ' 行'
        d.para([(loc, 'faint')])
        if sym or tail:
            d.add([(sym, 'code'), ('  ' + tail if tail else '', 'faint')])
    api = n.get('api') or {}
    if api.get('sig'):
        d.blank()
        for line in api['sig'].split('\n'):
            d.para([(line, 'fn')], indent=1)
    if api.get('params'):
        kw = min(14, max(sw(p[0]) for p in api['params']) + 2)
        for name, meaning in api['params']:
            d.kv(' ' + name, rich(a, meaning, 'text'), kw=kw + 1, key_role='code')
    if api.get('ret'):
        d.kv(' 返す', rich(a, api['ret'], 'text'), kw=7, key_role='dim')
    if n.get('fields'):
        d.blank()
        tw = min(12, max(sw(f[0]) for f in n['fields']))
        for f in n['fields']:
            typ, name, meaning = (list(f) + ['', '', ''])[:3]
            d.kv(' ' + name, rich(a, meaning, 'dim'), kw=min(18, max(sw(x[1]) for x in n['fields']) + 2),
                 key_role='code')
    if n.get('values'):
        d.blank()
        kw = min(14, max(sw(v[0]) for v in n['values']) + 2)
        for name, meaning in n['values']:
            d.kv(' ' + name, rich(a, meaning, 'dim'), kw=kw + 1, key_role='code')
    shown = ('型：', '引数 ', '返す：', 'フィールド ', '値 ', '中の紙：')
    extra = [l for l in src_attrs(n) if not l.startswith(shown) and '・' not in l[:6]]
    if extra:
        d.blank()
        for l in extra:
            if '：' in l:
                k, v = l.split('：', 1)
                d.kv(k, rich(a, v, 'text'), kw=min(12, sw(k) + 2))
            else:
                d.para(rich(a, l, 'text'))
    text = n.get('text') or ''
    if text:
        d.blank()
        for para in text.split('\n'):
            if not para.strip():
                continue
            m = re.fullmatch(r'\s*!\[\[([^\]]+)\]\]\s*', para)
            if m:
                emb = a.nodes.get(m.group(1)) or {}
                if emb.get('kind') == 'figure':
                    desc = re.search(r'aria-label="([^"]*)"', emb.get('figure') or '')
                    d.para([('図 ', CHIP('text', 'chip2')), (' ' + emb.get('title', ''), B('text')),
                            ('：' + desc.group(1) if desc else '', 'dim')], indent=1)
                else:
                    d.para([('▸ ', 'faint'), (emb.get('title', m.group(1)), 'link', m.group(1)),
                            ('（' + KIND_NAME.get(emb.get('kind'), '') + '）', 'faint')], indent=1)
                continue
            d.para(rich(a, para, 'text'))
    if n.get('paper'):
        d.blank()
        d.kv('中の紙', [(a.papers.get(n['paper'], {}).get('title', n['paper']), 'link', n['paper'])])
    where = a.where(nid)
    if where:
        d.blank()
        parts = {}
        for did, k in where:
            parts.setdefault(did, []).append(a.diagrams[did].labels[k])
        spans = []
        for did, labels in parts.items():
            if spans:
                spans.append(('  ', 'text'))
            spans.append((a.diagrams[did].tab, 'link', did))
            spans.append((' ' + ' '.join(labels), 'dim'))
        d.kv('出る所', spans)
    return d

# ───────────────────────────────────────────────────────────── the route view (narrow terminals)

class RouteLayout:
    """A flow as a path down the screen: each step an arrow between two boxes, boxes indented by layer."""

    def __init__(self, atlas, dg, width, ascii_=False):
        self.a, self.dg, self.W, self.ascii = atlas, dg, width, ascii_
        lanes = [l['id'] for l in dg.lanes]
        n = max(1, len(lanes) - 1)
        self.indent = max(1, min(4, (width - 26) // n))
        self.bw = width - 2 - self.indent * n
        self.items = []
        y = 0
        last = None
        main = [k for k, s in enumerate(dg.steps) if not s.get('alt')]
        alts = [k for k, s in enumerate(dg.steps) if s.get('alt')]
        self.arrow_y = {}
        for group, ks in (('main', main), ('alt', alts)):
            if group == 'alt' and ks:
                at = dg.steps[ks[0]]['alt'].get('at', 0)
                y += 1
                self.items.append(('head', y, 'もし %s（手順 %s の代わり）' % (dg.steps[ks[0]]['alt'].get('when', ''),
                                                                  dg.labels[at])))
                y += 2
                last = None
            for k in ks:
                s = dg.steps[k]
                if s.get('from') != last:
                    if last is not None:
                        self.items.append(('gap', y, k))
                        y += 1
                    y = self._box(s.get('from'), y, k, 'from')
                self.items.append(('arrow', y, k))
                self.arrow_y[k] = y
                y += 2
                y = self._box(s.get('to'), y, k, 'to')
                last = s.get('to')
        self.H = y + 1

    def _box(self, bid, y, k, role):
        b = self.dg.boxes.get(bid) or {'id': bid, 'title': bid}
        lane_ix = next((i for i, l in enumerate(self.dg.lanes) if l['id'] == b.get('layer')), 0)
        x = 1 + lane_ix * self.indent
        sub = balanced(b['sub'], self.bw - 4) if b.get('sub') else []
        cells = b.get('slots') or ['%s %d' % (nm, nn) for nm, nn in b.get('bits') or []]
        h = 2 + max(1, len(sub) + (1 if cells else 0))
        self.items.append(('box', y, (bid, x, h, sub, cells, k, role)))
        return y + h

    def box_x(self, bid):
        b = self.dg.boxes.get(bid) or {}
        lane_ix = next((i for i, l in enumerate(self.dg.lanes) if l['id'] == b.get('layer')), 0)
        return 1 + lane_ix * self.indent


def draw_route(app, dg, rl, cur, sel=None):
    a = app.a
    g = Grid(rl.W, rl.H, S('text', 'bg'))
    walk = walk_of(dg, cur)
    taken = set(walk)
    s_cur = dg.steps[cur]
    active = {s_cur.get('from'), s_cur.get('to')}
    seen = set()
    for k in walk:
        seen.add(dg.steps[k].get('from'))
        seen.add(dg.steps[k].get('to'))
    lane_name = {l['id']: l['name'] for l in dg.lanes}
    near = {}
    for i, (kind, y, payload) in enumerate(rl.items):
        if kind != 'arrow':
            continue
        for j in (i - 1, i + 1):
            if 0 <= j < len(rl.items) and rl.items[j][0] == 'box':
                near.setdefault(j, set()).add(payload)
    for i, (kind, y, payload) in enumerate(rl.items):
        if kind == 'head':
            g.put(1, y, ' ' + payload + ' ', S('ink', 'warn', BOLD))
        elif kind == 'gap':
            k = payload
            fb = dg.boxes.get(dg.steps[k].get('from')) or {}
            x = rl.box_x(fb.get('id')) + 3
            g.put(x, y, '┆' if not rl.ascii else ':', S('faint', 'bg'))
        elif kind == 'box':
            bid, x, h, sub, cells, k, role = payload
            b = dg.boxes.get(bid) or {'title': bid}
            arrows = near.get(i, set())
            state = 'active' if cur in arrows else ('seen' if arrows & taken else 'later')
            tone = dg.tone_of(bid) if bid in dg.boxes else 'os'
            lr = 'L.' + tone if state != 'later' else 'line'
            st = S(lr, 'bg', BOLD if state == 'active' else 0)
            w = rl.bw
            if bid == sel:
                g.fill(x + 1, y + 1, w - 2, h - 2, S('text', 'sel'))
            heavy = state == 'active' and not rl.ascii
            tl, tr, bl, br, hz, vt = ('┏', '┓', '┗', '┛', '━', '┃') if heavy else \
                ('+', '+', '+', '+', '-', '|') if rl.ascii else ('┌', '┐', '└', '┘', '─', '│')
            g.put(x, y, tl + hz * (w - 2) + tr, st)
            g.put(x, y + h - 1, bl + hz * (w - 2) + br, st)
            for yy in range(y + 1, y + h - 1):
                g.put(x, yy, vt, st)
                g.put(x + w - 1, yy, vt, st)
            title = b.get('title', bid)
            g.put(x + 2, y, ' ' + title + ' ', S('strong' if state == 'active' else 'text' if state == 'seen' else 'dim',
                                                'bg', BOLD if state != 'later' else 0), x1=x + w - 2)
            ln = lane_name.get(b.get('layer'), '')
            if ln and sw(title) + sw(ln) + 8 <= w:
                g.put(x + w - 3 - sw(ln), y, ' ' + ln + ' ', S('T.' + tone if state != 'later' else 'faint', 'bg'))
            if a.paper_of(b.get('node')):
                t = ' 中の紙 '
                if sw(t) + 4 <= w:
                    g.put(x + w - 2 - sw(t), y + h - 1, t, S('ink', 'accent', BOLD) if state != 'later'
                          else S('text', 'chip2', BOLD))
            yy = y + 1
            bgr = 'sel' if bid == sel else 'bg'
            for sline in sub:
                g.put(x + 2, yy, sline, S('dim', bgr), x1=x + w - 2)
                yy += 1
            if cells:
                xx = x + 2
                for c in cells:
                    xx = g.put(xx, yy, c, S('text' if state != 'later' else 'dim', 'chip'), x1=x + w - 2) + 1
        elif kind == 'arrow':
            k = payload
            s = dg.steps[k]
            st_name = 'cur' if k == cur else 'done' if k in taken else 'later'
            role = {'cur': 'accent', 'done': 'done', 'later': 'future'}[st_name]
            if s.get('alt') and st_name == 'later':
                role = 'warn'
            fx = rl.box_x(s.get('from'))
            tx = rl.box_x(s.get('to'))
            x = max(fx, tx) + 3
            vch = line_glyph(s.get('kind'), {U, D}, rl.ascii, heavy=(st_name == 'cur'))
            g.put(x, y, vch, S(role, 'bg', BOLD if st_name == 'cur' else 0))
            g.put(x, y + 1, head_glyph(s.get('kind'), D, rl.ascii), S(role, 'bg'))
            label = dg.labels[k]
            bst = S('ink', 'accent', BOLD) if st_name == 'cur' else S('strong', 'done_bg') if st_name == 'done' \
                else S('ink', 'warn', BOLD) if s.get('alt') else S('dim', 'future_bg')
            xx = g.put(x + 2, y, ' %s ' % label, bst)
            room = rl.W - 1 - (xx + 1)
            verb = s.get('verb') or ''
            data = (s.get('data') or {}).get('label', '')
            vst = S('strong' if st_name == 'cur' else 'text' if st_name == 'done' else 'dim', 'bg',
                    BOLD if st_name == 'cur' else 0)
            if verb and data and sw(verb) + 2 + sw(data) > room:
                # the data handed over goes under the verb, with the kind of step, when the line is short
                g.put(xx + 1, y, clip(verb, room), vst)
                kx = g.put(xx + 1, y + 1, STEP_KIND.get(s.get('kind'), ''), S('faint', 'bg'), x1=rl.W - 1)
                if kx + 2 < rl.W - 1:
                    g.put(kx + 2, y + 1, clip(data, rl.W - 1 - (kx + 2)), S('accent2' if st_name != 'later' else 'dim',
                                                                          'bg'))
            else:
                x2 = g.put(xx + 1, y, clip(verb or data, room), vst)
                if verb and data:
                    g.put(x2 + 2, y, data, S('accent2' if st_name != 'later' else 'dim', 'bg'))
                g.put(xx + 1, y + 1, STEP_KIND.get(s.get('kind'), ''), S('faint', 'bg'), x1=rl.W - 1)
    return g

# ───────────────────────────────────────────────────────────── code: a small highlighter

MLN_KW = set('''if else while for return break continue struct enum match case defer export import void bool true
false None Some let var fn pub use as in loop static const extern unsafe model class mut impl self Self borrow move
type where trait mod crate super'''.split())
MLN_TY = set('i8 i16 i32 i64 u8 u16 u32 u64 usize isize char str f32 f64 Option Result Vec String'.split())
CODE_TOKEN = re.compile(r'//.*|/\*.*?\*/|/\*.*$|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])\'|\b0x[0-9a-fA-F_]+\b'
                        r'|\b\d[\d_]*\b|@\w+|[A-Za-z_]\w*|\s+|.')


def highlight(line, in_comment=False):
    """Spans of one line of code. With in_comment, the line starts inside a /* */ comment; highlight_state
    tells whether the next line does."""
    out = []
    global _HL_OPEN
    _HL_OPEN = False
    if in_comment:
        end = line.find('*/')
        if end < 0:
            _HL_OPEN = True
            return [(line, 'cmt', None)]
        out.append((line[:end + 2], 'cmt', None))
        line = line[end + 2:]
    for m in CODE_TOKEN.finditer(line):
        t = m.group(0)
        if t.startswith('/*') and not t.endswith('*/'):
            _HL_OPEN = True
        if t.startswith('//') or t.startswith('/*'):
            role = 'cmt'
        elif t[0] in '"\'':
            role = 'str'
        elif t[0].isdigit():
            role = 'num'
        elif t[0] == '@':
            role = 'kw'
        elif t in MLN_KW:
            role = 'kw'
        elif t in MLN_TY or (t[0].isupper() and len(t) > 1):
            role = 'ty'
        elif t[0].isalpha() or t[0] == '_':
            nxt = line[m.end():m.end() + 1]
            role = 'fn' if nxt == '(' else 'code'
        else:
            role = 'code'
        if out and out[-1][1] == role:
            out[-1] = (out[-1][0] + t, role, None)
        else:
            out.append((t, role, None))
    return out

_HL_OPEN = False


def comment_open_after(lines, upto):
    """Whether line number upto+1 (1-based) starts inside a /* */ comment."""
    inside = False
    for i in range(min(upto, len(lines))):
        highlight(lines[i], inside)
        inside = _HL_OPEN
    return inside

# ───────────────────────────────────────────────────────────── the app

HELP = [
    ('流れを読む', [('← →', '前の手順・次の手順'), ('Home End', '最初・最後の手順'), ('a', '「もし」の手順へ・から戻る'),
                ('Enter', '中の紙に入る（箱に紙がある時）'), ('Esc', '紙から出る・閉じる'), ('↑ ↓', '箱を選ぶ（説明が変わる）'),
                ('v', '地図 ⇄ 道のり（縦の一本道）'), ('c', 'この手順のコード'), ('PgUp PgDn', '説明を送る'),
                ('i', '説明を全面に')]),
    ('ほかの画面', [('1 2', '流れ：UI の要求・CPU 時間'), ('n', '節の一覧（層 → 節）'), ('t', '記録（一度の実行）'),
                ('/', '節を探す'), ('?', 'このキー一覧'), ('q', '終わる')]),
]


class App:
    """The state of the browser and how it looks: render() draws the whole screen into a Grid."""

    def __init__(self, atlas, w=160, h=44, ascii_=False, theme='dark'):
        self.a = atlas
        self.w, self.h = w, h
        self.ascii = ascii_
        self.theme = theme
        self.flows = [f['id'] for f in atlas.flows]
        self.screen = 'flow'
        self.overlay = None
        first = self.flows[0]
        self.nav = [[first, atlas.diagrams[first].start]]
        self.saved = {f: [[f, atlas.diagrams[f].start]] for f in self.flows}
        self.mode = 'auto'
        self.sel = None
        self.dscroll = 0
        self.code_off = 0
        self.nb_lane, self.nb_i, self.nb_focus = 0, 0, 1
        self.tr_i, self.tr_only = 0, True
        self.query = ''
        self.q_i = 0
        self.back_screen = None
        self._lay, self._rl = {}, {}
        self.hits = []
        self.pulse = []
        self.stepped = False
        self.animate = True
        self.quit = False
        self.web = False       # drawn for the page's replay: no hints for keys it cannot replay (/, q)
        self._dmax = 0         # how far the description shown last can scroll (PgDn stops there)

    # ── state
    @property
    def did(self):
        return self.nav[-1][0]

    @property
    def dg(self):
        return self.a.diagrams[self.did]

    @property
    def k(self):
        return self.nav[-1][1]

    def set_k(self, k):
        self.stepped = True
        self.nav[-1][1] = max(0, min(len(self.dg.steps) - 1, k))
        self.sel = None
        self.dscroll = 0
        self.code_off = 0

    def flow_id(self):
        return self.nav[0][0]

    def view_mode(self):
        if self.mode != 'auto':
            return self.mode
        if self.h < 22 or self.w < 72:
            return 'route'
        lay = self.layout(self.did, self.w, self.map_height())
        return 'map' if lay.W <= self.w else 'route'

    LEVELS = 6

    def _layout_at(self, did, c):
        key = (did, c, self.ascii)
        if key not in self._lay:
            self._lay[key] = Layout(self.a, self.a.diagrams[did], compact=c, ascii_=self.ascii)
        return self._lay[key]

    def layout(self, did, width, height=None):
        """The most detailed drawing of the diagram that fits width (and height, when given)."""
        fits_w = None
        for c in range(self.LEVELS):
            lay = self._layout_at(did, c)
            if lay.W <= width:
                if fits_w is None:
                    fits_w = lay
                if height is None or lay.H <= height:
                    return lay
        return fits_w or self._layout_at(did, self.LEVELS - 1)

    def map_height(self):
        """Rows the diagram may take on the flow screen."""
        return self.h - 4 - (11 if self.w >= 120 else 9) + 2

    def route_layout(self, did, width):
        key = (did, width, self.ascii)
        if key not in self._rl:
            self._rl[key] = RouteLayout(self.a, self.a.diagrams[did], width, self.ascii)
        return self._rl[key]

    def detail_node(self):
        dg = self.dg
        if self.sel and self.sel in dg.boxes:
            return dg.boxes[self.sel].get('node')
        s = dg.steps[self.k]
        return s.get('ref') or (dg.boxes.get(s.get('to')) or {}).get('node')

    def box_order(self):
        """The boxes ↑↓ goes through: by lane and from the left on the map, top to bottom on the route."""
        if self.screen == 'flow' and self.view_mode() == 'route':
            out = []
            for kind, _, payload in self.route_layout(self.did, self.w).items:
                if kind == 'box' and payload[0] in self.dg.boxes and payload[0] not in out:
                    out.append(payload[0])
            return out
        lay = self.layout(self.did, self.w, self.map_height())
        return [b.id for b in sorted(lay.boxes.values(), key=lambda b: (b.lane, b.x))]

    # ── keys
    def key(self, k):
        if self.overlay == 'search':
            return self._key_search(k)
        if k in ('q', 'Q') and self.overlay is None:
            self.quit = True
            return
        if self.overlay:
            if k in ('esc', 'q', 'enter', 'backspace', '?') and self.overlay != 'code' or k in ('esc', 'q', 'c'):
                self.overlay = None
            elif self.overlay == 'code':
                if k in ('down', 'j'):
                    self.code_off += 1
                elif k in ('up', 'k'):
                    self.code_off -= 1
                elif k in ('pgdn', ' '):
                    self.code_off += self.h // 2
                elif k == 'pgup':
                    self.code_off -= self.h // 2
                elif k in ('left', 'right'):
                    self.overlay = None
                    self.key(k)
                    self.overlay = 'code'
            elif self.overlay == 'detail':
                if k in ('down', 'j', 'pgdn', ' '):
                    self.dscroll = min(self.dscroll + 3, self.detail_max())
                elif k in ('up', 'k', 'pgup'):
                    self.dscroll = max(0, self.dscroll - 3)
            return
        if k == '?':
            self.overlay = 'help'
            return
        if k == '/':
            self.overlay = 'search'
            self.query, self.q_i = '', 0
            return
        if k in ('1', '2', '3', '4', '5') and int(k) <= len(self.flows):
            self.open_flow(self.flows[int(k) - 1])
            return
        if k == 'n':
            if self.screen == 'trace':
                evs = self.tr_events()
                e = evs[self.tr_i] if evs else None
                self.screen = 'nodes'
                self._sync_nodes((e or {}).get('n') or self.detail_node())
                return
            self.screen = 'nodes' if self.screen != 'nodes' else 'flow'
            if self.screen == 'nodes':
                self._sync_nodes(self.detail_node())
            return
        if k == 't':
            self.screen = 'trace' if self.screen != 'trace' else 'flow'
            return
        if self.screen == 'nodes':
            return self._key_nodes(k)
        if self.screen == 'trace':
            return self._key_trace(k)
        self._key_flow(k)

    def open_flow(self, fid):
        self.saved[self.flow_id()] = [list(x) for x in self.nav]
        self.nav = [list(x) for x in self.saved.get(fid, [[fid, self.a.diagrams[fid].start]])]
        self.screen = 'flow'
        self.back_screen = None
        self.sel = None
        self.dscroll = 0

    def step_after(self, d):
        """The step → (d=1) or ← (d=-1) goes to: along the main steps; among the もし steps, which ← leaves for
        the step they replace (a, too, goes back and forth)."""
        dg, k = self.dg, self.k
        s = dg.steps[k]
        if s.get('alt'):
            at = s['alt'].get('at', 0)
            grp = [j for j, t in enumerate(dg.steps) if t.get('alt') and t['alt'].get('at') == at]
            i = grp.index(k)
            if d > 0:
                return grp[min(i + 1, len(grp) - 1)]
            return grp[i - 1] if i > 0 else at
        main = [j for j, t in enumerate(dg.steps) if not t.get('alt')]
        i = main.index(k) if k in main else 0
        return main[max(0, min(len(main) - 1, i + d))]

    def _key_flow(self, k):
        dg = self.dg
        if k in ('right', 'l', ' '):
            self.set_k(self.step_after(1))
        elif k in ('left', 'h'):
            self.set_k(self.step_after(-1))
        elif k in ('home', 'g'):
            self.set_k(next((j for j, s in enumerate(dg.steps) if not s.get('alt')), 0))
        elif k in ('end', 'G'):
            self.set_k(max(j for j, s in enumerate(dg.steps) if not s.get('alt')))
        elif k == 'a':
            s = dg.steps[self.k]
            if s.get('alt'):
                self.set_k(s['alt'].get('at', 0))
            elif dg.alts_of(self.k):
                self.set_k(dg.alts_of(self.k)[0])
        elif k in ('down', 'j', 'up', 'k'):
            order = [None] + self.box_order()
            i = order.index(self.sel) if self.sel in order else 0
            i = (i + (1 if k in ('down', 'j') else -1)) % len(order)
            self.sel = order[i]
            self.dscroll = 0
        elif k in ('pgdn', 'J'):
            self.dscroll = min(self.dscroll + 4, self._dmax)
        elif k in ('pgup', 'K'):
            self.dscroll = max(0, (self.dscroll - 1) // 4 * 4)
        elif k == 'enter':
            target = None
            if self.sel in dg.boxes:
                target = self.a.paper_of(dg.boxes[self.sel].get('node'))
                if target and (self.sel, target) not in dg.papers_at(self.k):
                    # a paper is opened at a step that reaches its box: go there first (one that arrives at it)
                    ks = [j for j, s in enumerate(dg.steps) if (self.sel, target) in dg.papers_at(j)]
                    ks.sort(key=lambda j: (bool(dg.steps[j].get('alt')), dg.steps[j].get('to') != self.sel, j))
                    if ks:
                        self.nav[-1][1] = ks[0]
            if not target:
                ps = dg.papers_at(self.k)
                target = ps[0][1] if ps else None
            if target and target in self.a.diagrams and all(n[0] != target for n in self.nav):
                self.nav.append([target, self.a.diagrams[target].start])
                self.sel = None
                self.dscroll = 0
                self.stepped = True
        elif k in ('esc', 'backspace'):
            if len(self.nav) > 1:
                self.nav.pop()
                self.sel = None
                self.dscroll = 0
            elif self.back_screen:
                self.screen, self.back_screen = self.back_screen, None
        elif k == 'v':
            self.mode = {'auto': 'route' if self.view_mode() == 'map' else 'map', 'map': 'route',
                         'route': 'map'}[self.mode]
        elif k == 'c':
            self.overlay = 'code'
            self.code_off = 0
            self.sel = None
            self.dscroll = 0
        elif k == 'i':
            self.overlay = 'detail'
            self.dscroll = 0

    # ── drawing
    def hit(self, x0, y0, x1, y1, action):
        """A place on the screen that does something when clicked: action is a key or (what, value)."""
        self.hits.append((x0, y0, x1, y1, action))

    def click(self, x, y):
        for x0, y0, x1, y1, action in reversed(getattr(self, 'hits', [])):
            if x0 <= x < x1 and y0 <= y < y1:
                return self.act(action)

    def act(self, action):
        """What a click does: a key, or (what, value)."""
        if isinstance(action, str):
            return self.key(action)
        what, v = action
        if what == 'step':
            self.overlay = None
            self.set_k(v)
        elif what == 'sel':
            self.sel = None if self.sel == v else v
            self.dscroll = 0
        elif what == 'node':
            self.nb_focus, self.nb_i = 1, v
            self.dscroll = 0
        elif what == 'lane':
            self.nb_focus, self.nb_lane, self.nb_i = 0, v, 0
            self.dscroll = 0
        elif what == 'ev':
            self.tr_i = v

    def render(self):
        g = Grid(self.w, self.h, S('text', 'bg'))
        self.hits = []
        self.pulse = []
        self._dmax = 0
        self.draw_header(g)
        if self.screen == 'flow':
            self.draw_flow(g, 1, self.h - 1)
        elif self.screen == 'nodes':
            self.draw_nodes(g, 1, self.h - 1)
        elif self.screen == 'trace':
            self.draw_trace(g, 1, self.h - 1)
        self.draw_footer(g)
        if self.overlay:
            # over a page or box of its own, a click anywhere closes it (nothing under it is clicked)
            self.hits = [] if self.overlay == 'search' else [(0, 0, self.w, self.h, 'esc')]
        if self.overlay == 'help':
            self.draw_help(g)
        elif self.overlay == 'code':
            self.draw_code(g)
        elif self.overlay == 'detail':
            self.draw_detail_full(g)
        elif self.overlay == 'search':
            self.draw_search(g)
        return g

    def draw_header(self, g):
        g.fill(0, 0, g.w, 1, S('text', 'panel'))
        narrow = g.w < 90
        x = g.put(1, 0, ' ' + (self.a.title if not narrow else '文書マップ') + ' ', S('strong', 'panel', BOLD))
        x += 1
        tabs = [(str(i + 1), self.a.diagrams[f].tab if not narrow else self.a.diagrams[f].tab.split()[0], 'flow', f)
                for i, f in enumerate(self.flows)]
        tabs += [('n', '節の一覧' if not narrow else '節', 'nodes', None), ('t', '記録', 'trace', None)]
        for key, name, scr, fid in tabs:
            on = self.screen == scr and (fid is None or fid == self.flow_id())
            st = S('ink', 'accent', BOLD) if on else S('text', 'panel')
            kst = S('ink', 'accent') if on else S('faint', 'panel')
            if x + sw(name) + 4 >= g.w - 2:
                break
            x0 = x
            x = g.put(x, 0, ' ' + key, kst)
            x = g.put(x, 0, ' ' + name + ' ', st)
            self.hit(x0, 0, x, 1, key if scr == 'flow' or not on else 'esc')
            x += 1
        right = '? キー  q 終わる' if not self.web else '? キー'
        if x + sw(right) + 3 < g.w:
            g.put(g.w - sw(right) - 2, 0, right, S('dim', 'panel'))

    def draw_footer(self, g):
        y = g.h - 1
        g.fill(0, y, g.w, 1, S('dim', 'panel'))
        if self.screen == 'flow':
            hints = [('←→', '手順'), ('↑↓', '箱を選ぶ'), ('Enter', '中の紙へ'), ('Esc', '外へ'),
                     ('v', '地図/道のり'), ('c', 'コード'), ('a', 'もし'), ('/', '探す'), ('?', 'キー')]
            if self.view_mode() == 'route' or self.w < 120:
                hints.insert(4, ('i', '説明'))
        elif self.screen == 'nodes':
            hints = [('↑↓', '選ぶ'), ('←→', '層/節'), ('Enter', '流れの中で見る'), ('/', '探す'), ('Esc', '戻る'),
                     ('?', 'キー')]
        else:
            evs = self.tr_events()
            e = evs[self.tr_i] if evs and 0 <= self.tr_i < len(evs) else None
            link = self.tr_link(e) if e else None
            hints = [('↑↓', 'できごと'), ('PgUp PgDn', '送る')]
            if link and link.nav:
                hints.append(('Enter', 'その手順を開く'))
            if e and e.get('n'):
                hints.append(('m', '節を見る'))
            hints += [('f', '主な行/全部'), ('Esc', '戻る')]
        if self.web:
            hints = [h for h in hints if h[0] not in ('/', 'q')]
        x = 1
        for key, label in hints:
            need = sw(key) + sw(label) + 4
            if x + need >= g.w:
                break
            x0 = x
            x = g.put(x, y, ' ' + key + ' ', S('strong', 'chip2', BOLD))
            x = g.put(x, y, ' ' + label + '  ', S('dim', 'panel'))
            single = {'←→': 'right', '↑↓': 'down', 'Enter': 'enter', 'Esc': 'esc', 'PgUp PgDn': 'pgdn'}.get(key, key)
            self.hit(x0, y, x, y + 1, single)

    def crumb(self, g, y):
        dg0 = self.a.diagrams[self.nav[0][0]]
        x = g.put(1, y, dg0.tab, S('accent', 'bg', BOLD))
        if len(self.nav) == 1:
            if x + 2 + sw(dg0.title) < g.w:
                x = g.put(x + 2, y, dg0.title, S('dim', 'bg'))
            first = next((j for j, s in enumerate(dg0.steps) if not s.get('alt')), 0)
            if self.k == dg0.start != first:
                # the map starts a flow in its middle: say so, and how to go to its beginning
                cue = [('地図はここ（手順 %s）から。' % dg0.labels[self.k], 'faint'), ('Home', B('dim')),
                       (' で手順 %s から' % dg0.labels[first], 'faint')]
                cw_ = sum(sw(t) for t, _ in cue)
                if x + 4 + cw_ < g.w:
                    draw_spans(g, g.w - 2 - cw_, y, cue, g.w - 1, 'bg')
                    self.hit(g.w - 2 - cw_, y, g.w - 1, y + 1, 'home')
            return
        for i in range(1, len(self.nav)):
            parent = self.a.diagrams[self.nav[i - 1][0]]
            pk = self.nav[i - 1][1]
            here = self.a.diagrams[self.nav[i][0]]
            x = g.put(x, y, ' › ', S('faint', 'bg'))
            x = g.put(x, y, '%s ' % parent.labels[pk], S('faint', 'bg'))
            name = here.title if x + sw(here.title) < g.w - 1 else here.tab
            x = g.put(x, y, name, S('strong' if i == len(self.nav) - 1 else 'text', 'bg', BOLD), x1=g.w - 1)
        if x + 13 < g.w:
            g.put(x + 3, y, 'Esc で外へ', S('faint', 'bg'))

    def strip(self, g, x, y, w):
        """The step numbers in a row (the current one lit), then もし and its steps. Narrow screens get the
        numbers without the space around them, so もし A B still fit."""
        dg, k = self.dg, self.k
        walk = set(walk_of(dg, k))
        full = 5 + sum(sw(lab) + 2 for lab in dg.labels) + (5 if any(s.get('alt') for s in dg.steps) else 0)
        tight = full > w
        xx = g.put(x, y, '手順 ' if not tight else '手順', S('dim', 'bg'))
        for j, lab in enumerate(dg.labels):
            s = dg.steps[j]
            if s.get('alt') and (j == 0 or not dg.steps[j - 1].get('alt')):
                xx = g.put(xx + 1, y, 'もし', S('warn', 'bg'))
            if j == k:
                st = S('ink', 'accent' if not s.get('alt') else 'warn', BOLD)
            elif j in walk:
                st = S('done_t', 'bg', BOLD)
            elif s.get('alt'):
                st = S('warn', 'bg')
            else:
                st = S('faint', 'bg')
            x0 = xx
            if tight and j != k:
                xx = g.put(xx, y, ' ', S('text', 'bg'), x1=x + w)
                xx = g.put(xx, y, lab, st, x1=x + w)
            else:
                xx = g.put(xx, y, ' %s ' % lab, st, x1=x + w)
            self.hit(x0, y, xx, y + 1, ('step', j))
        return xx

    def draw_flow(self, g, y0, y1):
        dg, k = self.dg, self.k
        if self.sel not in dg.boxes:
            self.sel = None
        self.crumb(g, y0)
        if self.view_mode() == 'route':
            return self.draw_flow_route(g, y0 + 1, y1)
        lay = self.layout(self.did, self.w, self.map_height())
        avail = y1 - (y0 + 1) - 1
        bh_min = 11 if self.w >= 120 else 9
        gap = 1 if avail - lay.H - 1 >= 16 else 0
        avail -= gap
        dh = min(lay.H, max(6, avail - bh_min))
        if dh < lay.H <= avail - (bh_min - 2):
            dh = lay.H          # a row or two from the panel rather than a hidden lane
        bh = avail - dh
        dy = y0 + 1 + gap
        dmap = draw_layout(lay, k, self.sel)
        # scroll so the current step (or the box chosen with ↑↓) is in view
        r = lay.routes.get(k)
        s = dg.steps[k]
        xs, ys = [], []
        for bid in ((self.sel,) if self.sel in lay.boxes else (s.get('from'), s.get('to'))):
            b = lay.boxes.get(bid)
            if b:
                xs += [b.x, b.x + b.w]
                ys += [b.y, b.y + b.h]
        if r and self.sel not in lay.boxes:
            xs += [c[0] for c in r.cells]
            ys += [c[1] for c in r.cells]
        sx = sy = 0
        if lay.W > self.w and xs:
            sx = max(0, min(lay.W - self.w, (min(xs) + max(xs)) // 2 - self.w // 2))
        if lay.H > dh and ys:
            # every row of the window shows the map (no blank tail); a lane's top when that keeps the target
            # inside (lane_names() writes the names into whatever part of a lane shows)
            lo, hi = min(ys), max(ys)
            top_max = lay.H - dh
            cands = sorted({min(top_max, ln['y']) for ln in lay.lanes} | {0, top_max})
            ok = [st for st in cands if st <= lo and hi <= st + dh]
            if ok:
                mid = (lo + hi) / 2
                sy = min(ok, key=lambda st: (abs(st + dh / 2 - mid), st))
            else:
                sy = max(0, min(top_max, (lo + hi) // 2 - dh // 2))
        g.blit(dmap, sx, sy, min(self.w, lay.W), dh, 0, dy)
        self.pulse = []
        if r:
            for (x, y, _) in r.cells:
                X, Y = x - sx, y - sy + dy
                if 0 <= X < self.w and dy <= Y < dy + dh:
                    self.pulse.append((X, Y))
        for b in lay.boxes.values():
            self.hit(b.x - sx, b.y - sy + dy, b.x + b.w - sx, min(b.y + b.h - sy + dy, dy + dh), ('sel', b.id))
        for r in lay.routes.values():
            if r.badge:
                bx, by = r.badge
                if 0 <= by - sy < dh:
                    self.hit(bx - sx - 1, by - sy + dy, bx - sx + r.badge_w + 1, by - sy + dy + 1, ('step', r.k))
        if sx > 0 and lay.gutter < self.w:
            # keep the lanes' names in view
            g.blit(dmap, 0, sy, lay.gutter, dh, 0, dy)
            for yy in range(dy, dy + dh):
                g.put(lay.gutter, yy, '‹', S('faint', 'bg'))
        if sy > 0 or sy + dh < lay.H:
            self.lane_names(g, lay, sy, dy, dh)
        if sx + self.w < lay.W:
            for yy in range(dy, dy + dh):
                g.put(self.w - 1, yy, '›', S('faint', 'bg'))
        if sy > 0:
            g.put(self.w - 2, dy, '▴', S('dim', 'bg'))
        if sy + dh < lay.H:
            g.put(self.w - 2, dy + dh - 1, '▾', S('dim', 'bg'))
        ys0 = dy + dh
        xx = self.strip(g, 1, ys0, self.w - 2)
        legend = [('━', 'accent', ' 今  '), ('─', 'done', ' 通った  '), ('─', 'future', ' これから  ')]
        lw = sum(sw(a) + sw(c) for a, _, c in legend) + 4
        if self.w - xx > lw + 34:
            lx = self.w - lw - 1
            for ch, role, label in legend:
                lx = g.put(lx, ys0, ch * 2, S(role, 'bg', BOLD))
                lx = g.put(lx, ys0, label, S('faint', 'bg'))
        self.draw_bottom(g, ys0 + 1, bh)

    def lane_names(self, g, lay, sy, dy, dh):
        """Lane names again, inside the part of each lane that is on screen, so none is cut when the map
        scrolls up or down."""
        for ln in lay.lanes:
            if ln['empty']:
                continue
            top, bot = max(ln['y'], sy), min(ln['y'] + ln['h'], sy + dh)
            if bot <= top:
                continue
            vis, y0 = bot - top, dy + top - sy
            g.fill(1, y0, lay.gutter - 1, vis, S('text', 'bg'))
            st = S('T.' + ln['tone'], 'bg', BOLD)
            if lay.vertical:
                lane_label(g, ln, lay.gutter, y0, vis, st)
            else:
                yy = y0 + (1 if top == ln['y'] and vis > 1 else 0)
                g.put(2, yy, ln['name'], st)
                for i, sub in enumerate(ln['sub']):
                    if yy + 1 + i < y0 + vis:
                        g.put(2, yy + 1 + i, sub, S('dim', 'bg'), x1=lay.gutter - 1)

    def draw_bottom(self, g, y, h):
        dg, k = self.dg, self.k
        s = dg.steps[k]
        w = self.w
        title = ('手順 %s / %d' % (dg.labels[k], dg.main_count)) if not s.get('alt') else 'もし %s' % dg.labels[k]
        data = s.get('data') or {}
        nid = self.detail_node()
        if w < 120:
            if self.sel in dg.boxes:
                return self.sel_panel(g, 0, y, w, h)
            panel(g, 0, y, w, h, title, ascii_=self.ascii)
            doc = step_doc(self, dg, k, w - 4).fit(h - 2)
            draw_doc(g, doc, 2, y + 1, w - 4, h - 2, 0, 'bg')
            return
        three = w >= 150 and data.get('schema') in self.a.nodes
        if three:
            w1 = int(w * 0.40)
            w2 = int(w * 0.25)
            w3 = w - w1 - w2
        else:
            w1 = int(w * 0.48)
            w2 = 0
            w3 = w - w1
        panel(g, 0, y, w1, h, title, title_role='accent', ascii_=self.ascii)
        doc = step_doc(self, dg, k, w1 - 4).fit(h - 2)
        draw_doc(g, doc, 2, y + 1, w1 - 4, h - 2, 0, 'bg')
        if three:
            panel(g, w1, y, w2, h, '渡すもの', ascii_=self.ascii)
            sd = schema_doc(self, data['schema'], data.get('fields'), w2 - 4, h - 2)
            draw_doc(g, sd, w1 + 2, y + 1, w2 - 4, h - 2, 0, 'bg')
        nd = node_doc(self, nid, w3 - 4).fit(h - 2)
        sel_title = '説明' + ('：選んだ箱' if self.sel else '')
        more = len(nd.lines) - (h - 2)
        self._dmax = max(0, more)
        self.dscroll = max(0, min(self.dscroll, max(0, more)))
        right = ('%d/%d  %s' % (self.dscroll + h - 2, len(nd.lines), page_key(self.dscroll, more))) if more > 0 \
            else None
        panel(g, w1 + w2, y, w3, h, sel_title, right=right, ascii_=self.ascii)
        draw_doc(g, nd, w1 + w2 + 2, y + 1, w3 - 4, h - 2, self.dscroll, 'bg')

    def sel_panel(self, g, x, y, w, h):
        """The box chosen with ↑↓, where there is no room for a description beside the step: its description
        in place of the step's (←→ goes back to the steps)."""
        b = self.dg.boxes[self.sel]
        nd = node_doc(self, b.get('node'), w - 4).fit(h - 2)
        more = len(nd.lines) - (h - 2)
        self._dmax = max(0, more)
        self.dscroll = max(0, min(self.dscroll, self._dmax))
        right = ('i 全面に' if more <= 0 else '%d/%d %s' % (self.dscroll + h - 2, len(nd.lines),
                                                         page_key(self.dscroll, more))) if w >= 40 else None
        panel(g, x, y, w, h, '選んだ箱：' + b.get('short', b.get('title', self.sel)), title_role='accent', right=right,
              ascii_=self.ascii)
        draw_doc(g, nd, x + 2, y + 1, w - 4, h - 2, self.dscroll, 'bg')

    def draw_flow_route(self, g, y0, y1):
        dg, k = self.dg, self.k
        w = self.w
        doc = step_doc(self, dg, k, w - 4)
        ch = min(len(doc.lines) + 2, max(7, int((y1 - y0) * 0.42)))
        doc.fit(ch - 2)
        area = y1 - y0 - ch - 1
        rl = self.route_layout(self.did, w)
        sel = self.sel if self.sel in dg.boxes else None
        rg = draw_route(self, dg, rl, k, sel)
        ay = rl.arrow_y.get(k, 0)
        if sel:
            # the place of the chosen box nearest the current step
            spots = [(y, payload[2]) for kind, y, payload in rl.items if kind == 'box' and payload[0] == sel]
            if spots:
                y, h = min(spots, key=lambda yh: abs(yh[0] - ay))
                ay = y + h // 2
        sy = max(0, min(rl.H - area, ay - area // 2 + 1))
        g.blit(rg, 0, sy, w, area, 0, y0)
        if sy > 0:
            g.put(w - 2, y0, '▴', S('dim', 'bg'))
        if sy + area < rl.H:
            g.put(w - 2, y0 + area - 1, '▾', S('dim', 'bg'))
        self.strip(g, 1, y0 + area, w - 2)
        if sel:
            return self.sel_panel(g, 0, y0 + area + 1, w, ch)
        title = ('手順 %s / %d' % (dg.labels[k], dg.main_count)) if not dg.steps[k].get('alt') else 'もし %s' % dg.labels[k]
        panel(g, 0, y0 + area + 1, w, ch, title, title_role='accent', ascii_=self.ascii)
        draw_doc(g, doc, 2, y0 + area + 2, w - 4, ch - 2, 0, 'bg')

    # ── overlays
    def _box(self, g, w, h, title):
        x = max(0, (self.w - w) // 2)
        y = max(1, (self.h - h) // 2)
        panel(g, x, y, w, h, title, bg='panel', role='accent', title_role='accent', ascii_=self.ascii)
        return x, y

    def draw_help(self, g):
        """The keys, as a page of its own (like man): Esc goes back."""
        g.fill(0, 1, self.w, self.h - 2, S('text', 'bg'))
        x0 = 2 if self.w < 80 else max(2, (self.w - 96) // 2)
        g.put(x0, 1, 'キー', S('accent', 'bg', BOLD))
        g.put(x0 + 6, 1, 'Esc で戻る', S('faint', 'bg'))
        two = self.w >= 100
        colw = (min(self.w, 100) - 4) // 2 if two else self.w - 4
        x, y = x0, 3
        for i, (title, items) in enumerate(HELP):
            if two and i == 1:
                x, y = x0 + colw + 2, 3
            g.put(x, y, title, S('strong', 'bg', BOLD))
            y += 1
            for key, what in items:
                if y >= self.h - 2:
                    break
                g.put(x + 1, y, ' ' + key + ' ', S('strong', 'chip2', BOLD))
                xe = g.put(x + 13, y, what, S('text', 'bg'), x1=x + colw)
                if self.web and key in ('/', 'q'):
                    g.put(xe + 1, y, '（端末で）', S('faint', 'bg'), x1=x + colw)
                y += 1
            y += 1
        # how to read the drawings, with the real characters and colours
        a_ = self.ascii
        y = 3 + (max(len(it) for _, it in HELP) if two else sum(len(it) + 2 for _, it in HELP)) + 2
        legend = [
            ('線の色', [[(line_glyph('call', {L, R}, a_, True) * 3 + head_glyph('call', R, a_), B('accent')),
                       ('  今の手順（箱も太い枠）', 'text')],
                      [(line_glyph('call', {L, R}, a_) * 3 + head_glyph('call', R, a_), 'done'), ('  通った手順', 'text')],
                      [(line_glyph('call', {L, R}, a_) * 3 + head_glyph('call', R, a_), 'future'),
                       ('  これからの手順', 'text')],
                      [(' 5 ', CHIP('ink', 'accent')), ('   手順の番号', 'text')],
                      [(' A ', CHIP('ink', 'warn')), ('   「もし」の手順', 'text')]]),
            ('線の形', [[(kind_sample(kd, a_), 'text'), ('  ' + STEP_KIND[kd], 'text')]
                      for kd in ('call', 'syscall', 'msg', 'signal', 'return')] +
             [[('', 'text'), ('読み書きは呼び出しと同じ線', 'dim')]]),
            ('箱', [[('┌──┐' if not a_ else '+--+', 'text'), ('  関数', 'text')],
                   [('└──┘' if not a_ else '+--+', 'text')],
                   [('╭──╮' if not a_ else '+--+', 'text'), ('  置き場', 'text')],
                   [('╰──╯' if not a_ else '+--+', 'text')],
                   [(' 中の紙 ', CHIP('ink', 'accent')), ('  中に紙がある', 'text')],
                   [('    ', CHIP('text', 'region')), ('  薄い面：実行の文脈', 'text')],
                   [('▌', 'L.app'), ('▌', 'L.lib'), ('▌', 'L.os'), ('▌', 'L.kernel'), ('▌', 'L.emu'),
                    ('  層の色', 'text')]]),
        ]
        if y + 4 < self.h - 2:
            g.put(x0, y, '読み方', S('strong', 'bg', BOLD))
            y += 1
            cols = 3 if self.w >= 120 else 1
            cw_ = (min(self.w, 110) - 4) // cols
            top = y
            for i, (title, rows) in enumerate(legend):
                cx = x0 + (i % cols) * cw_
                if cols == 1 and i:
                    top = y
                cy = top
                g.put(cx, cy, title, S('dim', 'bg'))
                cy += 1
                for row in rows:
                    if cy >= self.h - 2:
                        break
                    draw_spans(g, cx + 1, cy, row, cx + cw_, 'bg')
                    cy += 1
                y = max(y, cy + 1) if cols == 1 else max(y, cy)
            y += 1
        note = [('このページのほか、', 'dim'), ('--render ID', 'code'), (' で図だけを出して終わります（', 'dim'),
                ('--list', 'code'), (' で ID の一覧）。', 'dim')]
        if y + 1 < self.h - 1:
            d = Doc(self.w - x0 - 2)
            d.para(note)
            draw_doc(g, d, x0, y, self.w - x0 - 2, min(3, self.h - 1 - y), 0, 'bg')

    def draw_code(self, g):
        dg, k = self.dg, self.k
        spot = self.a.step_code(self.did, k)
        w, h = self.w - 4, self.h - 4
        if self.w < 70:
            w, h = self.w, self.h - 2
        x, y = self._box(g, w, h, 'コード')
        if not spot:
            g.put(x + 3, y + 2, 'この手順のコードの場所は、地図にありません。', S('dim', 'panel'))
            return
        path, line, how = spot
        lines = self.a.source(path)
        head = '%s:%d' % (path, line)
        note = '手順 %s が起きる行' % dg.labels[k] if how == 'line' else '手順 %s の行先の定義' % dg.labels[k]
        g.put(x + 3, y + 1, head, S('strong', 'panel', BOLD), x1=x + w - 2)
        g.put(x + 3, y + 2, note, S('dim', 'panel'), x1=x + w - 2)
        if not lines:
            g.put(x + 3, y + 4, 'ソースがありません（lab/data/src）', S('dim', 'panel'))
            return
        body_h = h - 5
        top = max(0, min(len(lines) - body_h, line - 1 - body_h // 3 + self.code_off))
        self.code_off = top - max(0, min(len(lines) - body_h, line - 1 - body_h // 3))
        cx0 = x + 2
        g.fill(cx0, y + 4, w - 4, body_h, S('code', 'code_bg'))
        # the definition the step's target belongs to
        s = dg.steps[k]
        rng = None
        for bid in (s.get('from'), s.get('to')):
            c = self.a.code.get('nodes', {}).get((dg.boxes.get(bid) or {}).get('node', ''))
            if c and c.get('path') == path and c.get('start') and c['start'] <= line <= (c.get('end') or c['start']):
                rng = (c['start'], c.get('end') or c['start'])
                break
        inside = comment_open_after(lines, top)
        for i in range(body_h):
            n = top + i + 1
            if n > len(lines):
                break
            yy = y + 4 + i
            on = n == line
            bg = 'sel' if on else 'code_bg'
            if on:
                g.fill(cx0, yy, w - 4, 1, S('code', 'sel'))
            mark = '▶' if on else ('│' if rng and rng[0] <= n <= rng[1] else ' ')
            g.put(cx0, yy, '%5d ' % n, S('accent' if on else 'faint', bg, BOLD if on else 0))
            g.put(cx0 + 6, yy, mark, S('accent' if on else 'line', bg))
            xx = cx0 + 8
            spans = highlight(lines[n - 1].replace('\t', '    '), inside)
            inside = _HL_OPEN
            for t, role, _ in spans:
                xx = g.put(xx, yy, t, S(role, bg, BOLD if on else 0), x1=x + w - 3)
        foot = ' ↑↓ 送る  ←→ 手順  Esc ' if not self.web else ' ←→ 手順  Esc 戻る '
        g.put(x + w - 2 - sw(foot), y + h - 1, foot, S('dim', 'panel'))

    def detail_max(self):
        nid = self.detail_node() if self.screen == 'flow' else self.nb_node()
        return max(0, len(node_doc(self, nid, self.w - 4).lines) - (self.h - 4))

    def draw_detail_full(self, g):
        w, h = self.w, self.h - 2
        panel(g, 0, 1, w, h, '説明', bg='bg', role='accent', title_role='accent', ascii_=self.ascii)
        nid = self.detail_node() if self.screen == 'flow' else self.nb_node()
        nd = node_doc(self, nid, w - 4)
        self.dscroll = max(0, min(self.dscroll, max(0, len(nd.lines) - (h - 2))))
        draw_doc(g, nd, 2, 2, w - 4, h - 2, self.dscroll, 'bg')


# ───────────────────────────────────────────────────────────── node browser, trace, search

def _nodes_screen(cls):
    def nb_layers(self):
        return self.a.layers

    def nb_list(self, lane=None):
        lid = self.a.layers[self.nb_lane if lane is None else lane]['id']
        return [nid for nid, n in self.a.nodes.items() if n.get('layer') == lid]

    def nb_node(self):
        lst = self.nb_list()
        return lst[min(self.nb_i, len(lst) - 1)] if lst else None

    def _sync_nodes(self, nid):
        n = self.a.nodes.get(nid or '')
        if not n:
            return
        for i, l in enumerate(self.a.layers):
            if l['id'] == n.get('layer'):
                self.nb_lane = i
                self.nb_i = self.nb_list(i).index(nid)
                self.nb_focus = 1

    def _key_nodes(self, k):
        if k in ('up', 'k'):
            if self.nb_focus == 0:
                self.nb_lane = (self.nb_lane - 1) % len(self.a.layers)
                self.nb_i = 0
            else:
                self.nb_i = max(0, self.nb_i - 1)
            self.dscroll = 0
        elif k in ('down', 'j'):
            if self.nb_focus == 0:
                self.nb_lane = (self.nb_lane + 1) % len(self.a.layers)
                self.nb_i = 0
            else:
                self.nb_i = min(len(self.nb_list()) - 1, self.nb_i + 1)
            self.dscroll = 0
        elif k in ('left', 'h'):
            self.nb_focus = 0
        elif k in ('right', 'l'):
            self.nb_focus = 1
        elif k in ('pgdn', 'J'):
            self.dscroll = min(self.dscroll + 4, self._dmax)
        elif k in ('pgup', 'K'):
            self.dscroll = max(0, (self.dscroll - 1) // 4 * 4)
        elif k == 'i':
            self.overlay = 'detail'
            self.dscroll = 0
        elif k in ('esc', 'backspace'):
            self.screen = 'flow'
        elif k == 'enter':
            nid = self.nb_node()
            if self.nb_focus == 0:
                self.nb_focus = 1
                return
            p = self.a.paper_of(nid)
            where = self.a.where(nid)
            if p:
                self.nav = [[p, self.a.diagrams[p].start]]
                self.back_screen = 'nodes'
                self.screen = 'flow'
                self.sel = None
            elif where:
                did, step = where[0]
                if did in self.a.papers:
                    self.nav = [[did, step]]
                    self.back_screen = 'nodes'
                else:
                    self.open_flow(did)
                    self.nav = [[did, step]]
                self.screen = 'flow'
                self.sel = None
                for b, box in self.a.diagrams[did].boxes.items():
                    if box.get('node') == nid:
                        self.sel = b

    def draw_nodes(self, g, y0, y1):
        a = self.a
        total = len(a.nodes)
        x = g.put(1, y0, '節の一覧', S('accent', 'bg', BOLD))
        g.put(x + 2, y0, '%d 個。層を選び、節を選ぶ。Enter でその節が出る流れへ' % total, S('dim', 'bg'), x1=g.w - 1)
        top = y0 + 1
        h = y1 - top
        narrow = self.w < 100
        # the layers' pane only as wide as their names need; the list gets the rest it needs for whole names
        w1 = 0 if narrow else (24 if self.w >= 130 else 20)
        w2 = self.w if narrow else min(42, self.w - w1 - 40)
        if not narrow:
            panel(g, 0, top, w1, h, '層', role='accent' if self.nb_focus == 0 else 'line', ascii_=self.ascii)
            # what a layer is, under its name (on more lines when it is long and the rows allow)
            subs = [balanced(l.get('sub', ''), w1 - 4)[:3] if l.get('sub') else [''] for l in a.layers]
            if sum(1 + len(s) for s in subs) > h - 2:
                subs = [[clip(l.get('sub', ''), w1 - 4)] for l in a.layers]
            yy = top + 1
            for i, l in enumerate(a.layers):
                rows_ = 1 + len(subs[i])
                if yy + rows_ > top + h - 1:
                    break
                on = i == self.nb_lane
                bg = 'sel' if on else 'bg'
                self.hit(1, yy, w1 - 1, yy + rows_, ('lane', i))
                if on:
                    g.fill(1, yy, w1 - 2, rows_, S('text', bg))
                for r_ in range(rows_):
                    g.put(1, yy + r_, '▌', S('L.' + l['id'], bg))
                cnt = str(len(self.nb_list(i)))
                g.put(3, yy, clip(l['name'], w1 - 6 - sw(cnt)), S('T.' + l['id'], bg, BOLD))
                g.put(w1 - 2 - sw(cnt), yy, cnt, S('dim', bg))
                for r_, s_ in enumerate(subs[i]):
                    g.put(3, yy + 1 + r_, clip(s_, w1 - 4), S('faint', bg))
                yy += rows_
        lst = self.nb_list()
        lay = a.layers[self.nb_lane]
        panel(g, w1, top, w2, h, lay['name'], role='accent' if self.nb_focus == 1 else 'line',
              title_role='T.' + lay['id'], ascii_=self.ascii)
        rows = h - 2
        sc = max(0, min(self.nb_i - rows // 2, len(lst) - rows))
        kinds = [KIND_SHORT.get(a.nodes[nid]['kind'], KIND_NAME.get(a.nodes[nid]['kind'], a.nodes[nid]['kind']))
                 for nid in lst]
        kw = max([sw(k_) for k_ in kinds] + [4]) + 2
        for i in range(rows):
            j = sc + i
            if j >= len(lst):
                break
            nid = lst[j]
            n = a.nodes[nid]
            on = j == self.nb_i
            bg = 'sel' if on else 'bg'
            yy = top + 1 + i
            if on:
                g.fill(w1 + 1, yy, w2 - 2, 1, S('text', bg))
            self.hit(w1 + 1, yy, w1 + w2 - 1, yy + 1, ('node', j) if not on else 'enter')
            kx = g.put(w1 + 2, yy, pad(kinds[j], kw), S('dim' if on else 'faint', bg))
            mark = ' 紙' if n.get('paper') else ''
            g.put(kx, yy, clip(n['title'], w1 + w2 - 2 - sw(mark) - kx), S('strong' if on else 'text', bg,
                                                                           BOLD if on else 0))
            if mark:
                g.put(w1 + w2 - 2 - sw(mark), yy, mark, S('accent', bg))
        if not narrow:
            w3 = self.w - w1 - w2
            nd = node_doc(self, self.nb_node(), w3 - 4).fit(h - 2)
            more = len(nd.lines) - (h - 2)
            self._dmax = max(0, more)
            self.dscroll = max(0, min(self.dscroll, max(0, more)))
            panel(g, w1 + w2, top, w3, h, '説明', right=(page_key(self.dscroll, more) if more > 0 else None),
                  ascii_=self.ascii)
            draw_doc(g, nd, w1 + w2 + 2, top + 1, w3 - 4, h - 2, self.dscroll, 'bg')

    for f in (nb_layers, nb_list, nb_node, _sync_nodes, _key_nodes, draw_nodes):
        setattr(cls, f.__name__, f)
    return cls


# ───────────────────────────────────────────────────────────── the recorded run, on the map

def node_boxes(atlas):
    """node id → [(diagram id, box id)]: the flow and paper boxes that show the node (flows first)."""
    out = {}
    for did, dg in atlas.diagrams.items():
        for bid, b in dg.boxes.items():
            if b.get('node'):
                out.setdefault(b['node'], []).append((did, bid))
    for v in out.values():
        v.sort(key=lambda db: atlas.diagrams[db[0]].kind != 'flow')
    return out


def paper_short(atlas, pid):
    """A short name for a paper: the name of the box it is inside (gateway, submit, charge_elapsed, tick)."""
    for dg in atlas.diagrams.values():
        for b in dg.boxes.values():
            if atlas.paper_of(b.get('node')) == pid:
                return re.sub(r'\(.*\)$', '', b.get('short') or b.get('title', pid))
    return atlas.papers.get(pid, {}).get('title', pid)


def step_between(dg, a, b):
    """The main step of dg from the box of node a to the box of node b, or None."""
    if not dg:
        return None
    for k, s in enumerate(dg.steps):
        fb, tb = dg.boxes.get(s.get('from')) or {}, dg.boxes.get(s.get('to')) or {}
        if not s.get('alt') and fb.get('node') == a and tb.get('node') == b:
            return k
    return None


class TraceLink:
    """What one event of a recorded run is on the map. nav (as App.nav: the flow, the papers inside it and
    their steps) when the run shows the situation that step draws; else why it is not that step, and box:
    where the node is drawn."""

    def __init__(self, nav=None, why=None, box=None):
        self.nav, self.why, self.box = nav, why, box


def link_name(atlas, nav):
    """'UI の要求 3', or 'gateway の中 3' for a step inside a paper."""
    did, k = nav[-1]
    dg = atlas.diagrams[did]
    return ('%s %s' if dg.kind == 'flow' else '%s の中 %s') % (dg.tab if dg.kind == 'flow' else
                                                               paper_short(atlas, did), dg.labels[k])


_LINKS = {}


def trace_links(atlas, tr):
    """seq → TraceLink for the events whose node is a box of a flow or paper. An event counts as a step only
    when the run shows what that step draws: the cause and service of the last interrupt, the node entered
    just before in the same thread, or a request still waiting in the ring. Otherwise the link says why not."""
    key = (id(atlas), tr.get('id'))
    if key in _LINKS:
        return _LINKS[key]
    D = atlas.diagrams
    ui, cpu = D.get('ui'), D.get('cpu')
    gw, sub, ct = D.get('os.gateway'), D.get('os.submit'), D.get('kernel.cpu-time')
    where = node_boxes(atlas)
    out = {}
    irq = {}          # thread → (causes, service) of its last interrupt
    prev = {}         # thread → (node, TraceLink) of the last event with a node
    last_fn = {}      # thread → fn of the event before
    pending = 0       # requests put in the ring by this run and not yet handled
    pushed_by = None  # what put the last Event in an app's list (app_events.push's caller)

    def said(dg, k):
        if not dg or k is None:
            return '地図の手順'
        s = dg.steps[k]
        if s.get('verb'):
            return '手順 %s「%s」' % (dg.labels[k], s['verb'])
        fb, tb = dg.boxes.get(s.get('from')) or {}, dg.boxes.get(s.get('to')) or {}
        return '手順 %s（%s → %s）' % (dg.labels[k], fb.get('title', '?'), tb.get('title', '?'))

    def btitle(dg, nid):
        for b in (dg.boxes.values() if dg else ()):
            if b.get('node') == nid:
                return b.get('title', nid)
        return atlas.title_of(nid)

    def before(p):
        return 'この行の前の節は %s' % atlas.title_of(p[0]) if p else 'この行の前に節は無い'

    k_ring = step_between(ui, 'os.gateway', 'os.request-ring')
    k_gw_sub = step_between(gw, 'gateway.stage', 'os.submit')
    for e in tr.get('events', []):
        th = e.get('thread')
        what = {'irq': '割り込み', 'switch': 'この thread への切り替え', 'request': '外からの要求'}.get(e.get('ev'))
        if e.get('ev') == 'irq':
            irq[th] = (e.get('cause') or [], e.get('service'))
            last_fn[th] = what
            continue
        n = e.get('n')
        if not n:
            last_fn[th] = e.get('fn') or what
            continue
        p = prev.get(th)
        pn = p[0] if p else None
        cause, service = irq.get(th, ([], None))
        causes = '・'.join(cause) or '記録に無い'
        link = None
        if n == 'kernel.irq-dispatch':
            k = step_between(cpu, 'emulator.timer.clock', n)
            link = TraceLink([['cpu', k]]) if 'timer' in cause and k is not None else TraceLink(
                why='%sは、タイマーの割り込みの時。この割り込みの原因は %s。' % (said(cpu, k), causes))
        elif n == 'kernel.tick':
            k = step_between(cpu, 'kernel.irq-dispatch', n)
            link = TraceLink([['cpu', k]]) if 'timer' in cause and k is not None else TraceLink(
                why='%sは、タイマーの割り込みの時。この割り込みの原因は %s。' % (said(cpu, k), causes))
        elif n == 'kernel.reschedule':
            k = step_between(cpu, 'kernel.tick', n)
            if pn == 'kernel.tick' and k is not None:
                link = TraceLink([['cpu', k]])
            else:
                link = TraceLink(why='%sは、%s から呼ばれた時。%s%s。' % (
                    said(cpu, k), btitle(cpu, 'kernel.tick'), before(p),
                    '（割り込みの原因は %s）' % causes if cause and 'timer' not in cause else ''))
        elif n == 'kernel.cpu-time':
            k4, k9 = step_between(cpu, 'kernel.reschedule', n), step_between(cpu, 'os.proc-stats', n)
            if pn == 'kernel.reschedule' and k4 is not None:
                link = TraceLink([['cpu', k4]])
            elif pn == 'os.proc-stats' and k9 is not None:
                link = TraceLink([['cpu', k9]])
            else:
                link = TraceLink(why='手順 %s は %s から、手順 %s は %s から呼ばれた時。この行のすぐ前は %s。' % (
                    cpu.labels[k4] if k4 is not None else '?', btitle(cpu, 'kernel.reschedule'),
                    cpu.labels[k9] if k9 is not None else '?', btitle(cpu, 'os.proc-stats'),
                    last_fn.get(th) or '記録に無い'))
        elif n == 'kernel.charge':
            k = step_between(ct, 'charge.read', n)
            if pn == 'kernel.cpu-time' and k is not None:
                outer = p[1].nav if p[1] and p[1].nav else []
                link = TraceLink(outer + [['kernel.cpu-time', k]])
            else:
                link = TraceLink(why='%sは、charge_elapsed の中。%s。' % (said(ct, k), before(p)))
        elif n == 'kernel.os-call':
            k = step_between(ui, 'lib.transport', n)
            link = TraceLink([['ui', k]]) if service == 'REQUEST' and k is not None else TraceLink(
                why='%sは、service が REQUEST の OS_CALL。この OS_CALL の service は %s。' % (
                    said(ui, k), service or '記録に無い'))
        elif n == 'os.gateway':
            k = step_between(ui, 'kernel.os-call', n)
            link = TraceLink([['ui', k]]) if service == 'REQUEST' and k is not None else TraceLink(
                why='%sは、REQUEST の OS_CALL。この OS_CALL の service は %s。' % (said(ui, k), service or '記録に無い'))
        elif n in ('gateway.read', 'gateway.copy', 'gateway.stage', 'os.submit'):
            k = {'gateway.read': step_between(gw, 'mem.user-request', n),
                 'gateway.copy': step_between(gw, 'gateway.owner', n),
                 'gateway.stage': step_between(gw, 'gateway.copy', n),
                 'os.submit': k_gw_sub}[n]
            if pn in ('os.gateway', 'gateway.read', 'gateway.copy', 'gateway.stage') and k is not None \
                    and k_ring is not None:
                link = TraceLink([['ui', k_ring], ['os.gateway', k]])
                if n == 'os.submit':
                    pending += 1
            else:
                link = TraceLink(why='%sは、request_gateway.request の中。%s。' % (said(gw, k), before(p)))
        elif n == 'kernel.ipc-send':
            k = step_between(sub, 'channel.words', n)
            if pn == 'os.submit' and p[1] and p[1].nav and k is not None:
                link = TraceLink(p[1].nav[:1] + [['os.gateway', k_gw_sub], ['os.submit', k]])
            else:
                link = TraceLink(why='%sは、request_channel.submit から呼ばれた時。%s。' % (said(sub, k), before(p)))
        elif n == 'kernel.notify-armed':
            k = step_between(sub, 'kernel.ipc-send', n)
            if pn == 'kernel.ipc-send' and p[1] and p[1].nav and k is not None:
                link = TraceLink(p[1].nav[:-1] + [['os.submit', k]])
            else:
                link = TraceLink(why='%sは、submit の ipc.send が列に入れた後。%s。' % (said(sub, k), before(p)))
        elif n == 'os.serve':
            k = step_between(ui, 'os.request-ring', n)
            link = TraceLink([['ui', k]]) if pending > 0 and k is not None else TraceLink(
                why='%sは、列に要求が並んだ後。この時、この記録で並べてまだ取り出していない要求は無い。' % said(ui, k))
        elif n == 'os.ui-protocol':
            k = step_between(ui, 'os.serve', n)
            if k is not None:
                link = TraceLink([['ui', k]])
            pending = max(0, pending - 1)
        elif n == 'lib.send-text':
            k = step_between(ui, 'app.tasks-view', n)
            if k is not None:
                link = TraceLink([['ui', k]])
        elif n == 'lib.transport':
            k = step_between(ui, 'lib.send-text', n)
            if k is not None:
                link = TraceLink([['ui', k]])
        elif n == 'lib.next':
            k = step_between(ui, 'os.dom', n)
            link = TraceLink(why='%sは、DOM のタイマーが送る TIMER を受け取る時。この記録で、その前に列に入れたのは %s。' % (
                said(ui, k), pushed_by or '記録に無い'))
        elif n == 'os.events':
            pushed_by = last_fn.get(th) or pushed_by
        if link is None and n in where:
            link = TraceLink(why='この記録だけでは、どの手順かは決められない。')
        if link is not None:
            if link.nav and any(k is None for _, k in link.nav):
                link = TraceLink(why='地図に、この手順が見つからない。')
            if not link.nav and n in where:
                link.box = where[n][0]
            out[e['seq']] = link
        prev[th] = (n, link)
        last_fn[th] = e.get('fn')
    _LINKS[key] = out
    return out


def thread_short(name):
    """The list's name of a thread: idle, or the name without 'kernel: ' (the timeline shows it whole)."""
    if 'idle' in name:
        return 'idle'
    return name.split(': ')[-1]


def thread_spans(name, role):
    """A thread's name as the data has it, 'kernel: ' dimmed."""
    if name.startswith('kernel: '):
        return [('kernel: ', 'faint'), (name[8:], role)]
    return [(name, role)]


def ev_text(app, e):
    ev = e.get('ev')
    if ev == 'irq':
        cause = ','.join(e.get('cause') or [])
        return [('割り込み ', 'warn'), (cause, B('warn')), ((' ' + e['service']) if e.get('service') else '', 'strong')]
    if ev == 'switch':
        return [('切り替え', 'accent2')]
    if ev == 'request':
        return [('外からの要求 ', 'good'), (e.get('method', ''), 'code')]
    return [(e.get('fn', ''), 'fn' if e.get('n') else 'dim')]


def axis_labels(t_end, width):
    """(x, text) of the timeline's labels, as many as fit without touching (the last one at the right end)."""
    def fmt(v):
        return '%dk' % round(v / 1000) if v < 1e6 else '%.1fM' % (v / 1e6)
    for n in (5, 4, 3, 2, 1):
        out, last = [], -2
        ok = True
        for i in range(n + 1):
            v = t_end * i / n
            lab = fmt(v)
            x = int(width * i / n) - (sw(lab) if i == n else 0)
            x = max(0, min(width - sw(lab), x))
            if x <= last + 1:
                ok = False
                break
            out.append((x, lab))
            last = x + sw(lab)
        if ok:
            return out
    return [(0, fmt(0))]


def _trace_screen(cls):
    def trace(self):
        return self.a.traces[0] if self.a.traces else None

    def tr_events(self):
        t = self.trace()
        if not t:
            return []
        evs = t['events']
        if self.tr_only:
            evs = [e for e in evs if e.get('n') or e.get('ev') in ('irq', 'switch', 'request')]
        return evs

    def tr_link(self, e):
        t = self.trace()
        return trace_links(self.a, t).get(e['seq']) if (t and e) else None

    def open_nav(self, nav, back=None):
        """Opens a flow (or paper) at a step, with the papers inside it: nav as self.nav."""
        if nav[0][0] in self.flows:
            self.open_flow(nav[0][0])
        self.nav = [list(x) for x in nav]
        self.screen = 'flow'
        self.overlay = None
        self.back_screen = back
        self.sel = None
        self.dscroll = 0
        self.stepped = True

    def _key_trace(self, k):
        evs = self.tr_events()
        if k in ('down', 'j'):
            self.tr_i = min(len(evs) - 1, self.tr_i + 1)
        elif k in ('up', 'k'):
            self.tr_i = max(0, self.tr_i - 1)
        elif k in ('pgdn', ' '):
            self.tr_i = min(len(evs) - 1, self.tr_i + 10)
        elif k == 'pgup':
            self.tr_i = max(0, self.tr_i - 10)
        elif k in ('home', 'g'):
            self.tr_i = 0
        elif k in ('end', 'G'):
            self.tr_i = len(evs) - 1
        elif k == 'f':
            cur = evs[self.tr_i] if evs else None
            self.tr_only = not self.tr_only
            evs2 = self.tr_events()
            self.tr_i = next((i for i, e in enumerate(evs2) if cur and e['seq'] >= cur['seq']), 0)
        elif k in ('esc', 'backspace'):
            self.screen = 'flow'
        elif k in ('enter', 'm'):
            e = evs[self.tr_i] if evs else None
            link = self.tr_link(e)
            if k == 'enter' and link and link.nav:
                self.open_nav(link.nav, 'trace')
            elif e and e.get('n'):
                self._sync_nodes(e['n'])
                self.screen = 'nodes'

    def link_doc(self, e, width):
        """For the side pane: where this event is on the map (the step it is, or why it is not one)."""
        a = self.a
        link = self.tr_link(e)
        d = Doc(width)
        if not link:
            return d
        d.add([('流れでは', B('dim'))])
        if link.nav:
            spans = []
            for i, (did, k) in enumerate(link.nav):
                dg = a.diagrams[did]
                if i:
                    spans.append((' › ', 'faint'))
                name = dg.tab if dg.kind == 'flow' else paper_short(a, did) + ' の中'
                spans.append((name + ' ', 'text' if i < len(link.nav) - 1 else B('accent')))
                spans.append((' %s ' % dg.labels[k], CHIP('ink', 'accent') if i == len(link.nav) - 1
                              else CHIP('strong', 'done_bg')))
            d.para(spans)
            did, k = link.nav[-1]
            dg = a.diagrams[did]
            s = dg.steps[k]
            fb, tb = dg.boxes.get(s.get('from')) or {}, dg.boxes.get(s.get('to')) or {}
            head = []
            if s.get('verb'):
                head = [(s['verb'], B('strong')), ('   ', 'text')]
            d.para(head + [(fb.get('title', '?'), 'T.' + dg.tone_of(fb['id']) if fb else 'dim'),
                           (' ' + kind_sample(s.get('kind'), self.ascii) + ' ', 'accent'),
                           (tb.get('title', '?'), 'T.' + dg.tone_of(tb['id']) if tb else 'dim')])
            if s.get('label'):
                d.para(rich(a, s['label'], 'text'))
            d.para([('Enter', B('strong')), (' でこの手順を開く', 'dim')])
        else:
            d.lines[-1].append(('  どの手順でもない', 'warn', None))
            if link.box:
                did, bid = link.box
                dg = a.diagrams[did]
                name = dg.tab if dg.kind == 'flow' else paper_short(a, did) + ' の中'
                d.para([(name, 'text'), (' の箱 ', 'dim'), (dg.boxes[bid].get('title', bid), B('T.' + dg.tone_of(bid)))])
            d.para([(link.why or '', 'text')])
        d.blank()
        return d

    def draw_trace(self, g, y0, y1):
        t = self.trace()
        if not t:
            g.put(2, y0 + 1, '記録がありません', S('dim', 'bg'))
            return
        a = self.a
        allev = t['events']
        evs = self.tr_events()
        self.tr_i = max(0, min(self.tr_i, len(evs) - 1))
        cur = evs[self.tr_i] if evs else None
        W = self.w
        narrow = W < 80
        # what was run: wrapped when the screen is narrow
        d = Doc(W - 2)
        d.para([('記録', B('accent')), ('  ', 'text'), (t.get('title', ''), B('strong')), ('  ', 'text'),
                ('%s  %d 件' % (t.get('date', '')[:16].replace('T', ' '), len(allev)), 'dim')])
        run = t.get('run') or {}
        if run:
            bf, af = run.get('before', {}), run.get('after', {})
            d.para([('打った文字 ', 'dim'), (run.get('typed', ''), B('strong')), ('   前 ', 'dim'),
                    ('「%s」 %s  %s' % (bf.get('text', ''), bf.get('title', ''), bf.get('position', '')), 'text'),
                    ('   → 後 ', 'dim'),
                    ('「%s」 %s  %s' % (af.get('text', ''), af.get('title', ''), af.get('position', '')), 'strong')],
                   indent=1)
        build = t.get('build') or {}
        if build and not narrow:
            spans = [('ビルド ', 'dim')]
            for repo, rev in build.items():
                spans += [(repo.split('/')[-1] + ' ', 'faint'), (rev + '  ', 'code')]
            d.para(spans, indent=1)
        for i, line in enumerate(d.lines):
            draw_spans(g, 1, y0 + i, line, W - 1, 'bg')
        y = y0 + len(d.lines)
        # timeline: which thread runs when (instruction count across)
        threads = t.get('threads') or {}
        tids = sorted(threads, key=lambda s: (int(s) < 0, -int(s)))
        role_of = {'-1': 'faint'}
        palette = ['accent', 'T.os', 'T.lib', 'T.app', 'T.kernel']
        for i, tid in enumerate(tids):
            role_of.setdefault(tid, palette[i % len(palette)])
        lw = 2 if narrow else min(27, max([sw(threads[tid]) for tid in tids] + [8]) + 2)
        x0 = lw + 2
        tw = max(10, W - x0 - 1)
        t_end = max(e['instr'] for e in allev) + 1
        occ = {tid: [0.0] * tw for tid in tids}
        span = t_end / tw
        for i, e in enumerate(allev):
            a0 = e['instr']
            a1 = allev[i + 1]['instr'] if i + 1 < len(allev) else t_end
            tid = str(e.get('thread'))
            if tid not in occ or a1 <= a0:
                continue
            c0, c1 = int(a0 / span), min(tw - 1, int((a1 - 1) / span))
            for c in range(c0, c1 + 1):
                lo, hi = max(a0, c * span), min(a1, (c + 1) * span)
                if hi > lo:
                    occ[tid][c] += (hi - lo) / span
        if y + 1 < y1:
            y += 1
        g.put(2, y, 'だれが走っているか', S('dim', 'bg'))
        if narrow:
            y += 1
        for x, lab in axis_labels(t_end, tw):
            if x0 + x >= 2 + 19 or narrow:
                g.put(x0 + x, y, lab, S('faint', 'bg'))
        y += 1
        cur_c = int(cur['instr'] / span) if cur else -1
        for tid in tids:
            name = threads[tid]
            on = cur and str(cur.get('thread')) == tid
            if narrow:
                g.put(1, y, '▌', S(role_of[tid], 'bg'))
            else:
                draw_spans(g, 2, y, [(t_, r if not on or r == 'faint' else B('strong')) for t_, r in
                                     thread_spans(name, 'dim')], x0 - 1, 'bg')
            for c in range(tw):
                v = occ[tid][c]
                ch = '█' if v >= 0.5 else '▌' if v > 0.08 else ('·' if c % 2 == 0 else ' ')
                st = S(role_of[tid] if v > 0.08 else 'rule', 'sel' if c == cur_c else 'bg')
                g.put(x0 + c, y, ch, st)
            y += 1
        # interrupts
        if not narrow:
            g.put(2, y, '割り込み', S('dim', 'bg'))
        marks = {}
        for e in allev:
            if e.get('ev') == 'irq':
                c = min(tw - 1, int(e['instr'] / span))
                cause = (e.get('cause') or ['?'])[0]
                marks[c] = cause if marks.get(c) in (None, 'timer') else marks[c]
        cause_role = {'timer': 'dim', 'syscall': 'accent', 'keyboard': 'good', 'automation': 'warn'}
        bar = '┃' if not self.ascii else '|'
        for c in range(tw):
            if c in marks:
                g.put(x0 + c, y, bar, S(cause_role.get(marks[c], 'dim'), 'sel' if c == cur_c else 'bg'))
            elif c == cur_c:
                g.put(x0 + c, y, ' ', S('text', 'sel'))
        y += 1
        # legends, an item never split between lines
        items = []
        if narrow:
            items += [[('▌', role_of[tid])] + thread_spans(threads[tid], 'dim') for tid in tids]
            items.append([('割り込み', 'faint')])
        for cause, role in (('timer', 'dim'), ('syscall', 'accent'), ('keyboard', 'good'), ('automation', 'warn')):
            items.append([(bar, role), (' ' + cause, 'dim')])
        items.append([('縦の帯：選んだできごと', 'faint')])
        lx0 = x0 + 2 if not narrow else 1
        lx = lx0
        for it in items:
            iw = sum(sw(t_) for t_, _ in it)
            if lx > lx0 and lx + iw > W - 1:
                y += 1
                lx = lx0
            lx = draw_spans(g, lx, y, it, W - 1, 'bg') + 3
        y += 1
        # the list of events, and (wide) where the chosen one is on the map
        top = y
        h = y1 - top
        wide = W >= 120
        whole = W >= 150        # room for the threads' names as the data has them ('kernel: ' dimmed)
        w1 = W if not wide else int(W * (0.62 if whole else 0.58))
        title = 'できごと ' + ('（節のある行と割り込み・切り替え）' if self.tr_only and W >= 100 else
                                '（主な行）' if self.tr_only else '（全部）')
        panel(g, 0, top, w1, h, title, right='%d / %d' % (self.tr_i + 1, len(evs)), ascii_=self.ascii)
        rows = h - 3
        hy = top + 1
        tcol = 2 + 10
        tw_ = 0 if narrow else max(8, min(27 if whole else 18, max(sw(n if whole else thread_short(n))
                                                                    for n in threads.values()) + 1)) \
            if threads else 10
        ecol = tcol + (2 if narrow else tw_ + 1)
        tag_col = W >= 90
        g.put(2, hy, '命令数', S('faint', 'bg'))
        if not narrow:
            g.put(tcol, hy, 'スレッド', S('faint', 'bg'))
        g.put(ecol, hy, 'できごと' + ('（▌ 地図の節）' if not narrow else ''), S('faint', 'bg'), x1=w1 - 2)
        if tag_col:
            g.put(w1 - 2 - sw('流れの手順'), hy, '流れの手順', S('faint', 'bg'))
        # rows: an event takes one line, two when its step goes under it
        lines = []
        for j, e in enumerate(evs):
            link = self.tr_link(e)
            lines.append((j, 0))
            if link and link.nav and not tag_col:
                lines.append((j, 1))
        first = next((i for i, (j, _) in enumerate(lines) if j == self.tr_i), 0)
        sc = max(0, min(first - rows // 2, len(lines) - rows))
        if 0 < sc < len(lines) and lines[sc][1] == 1:
            sc += 1       # never start on the second line of an event
        for i in range(rows):
            if sc + i >= len(lines):
                break
            j, part = lines[sc + i]
            e = evs[j]
            yy = top + 2 + i
            on = j == self.tr_i
            bg = 'sel' if on else 'bg'
            if on:
                g.fill(1, yy, w1 - 2, 1, S('text', bg))
            self.hit(1, yy, w1 - 1, yy + 1, ('ev', j) if not on else 'enter')
            link = self.tr_link(e)
            role = role_of.get(str(e.get('thread')), 'dim')
            if part == 1:
                g.put(ecol, yy, '→ ' + link_name(a, link.nav), S('accent2' if on else 'link', bg), x1=w1 - 2)
                continue
            g.put(2, yy, '%9s' % format(e['instr'], ','), S('dim' if not on else 'strong', bg))
            if narrow:
                g.put(tcol, yy, '▌', S(role, bg))
            else:
                tname = threads.get(str(e.get('thread')), str(e.get('thread')))
                if whole:
                    draw_spans(g, tcol, yy, thread_spans(tname, role), tcol + tw_ - 1, bg)
                else:
                    g.put(tcol, yy, clip(thread_short(tname), tw_ - 1), S(role, bg))
            right = w1 - 2
            if tag_col and link and link.nav:
                tag = link_name(a, link.nav)
                g.put(w1 - 2 - sw(tag), yy, tag, S('accent2' if on else 'link', bg))
                right = w1 - 4 - sw(tag)
            x = ecol
            if e.get('n') and not narrow:
                lay_id = (a.nodes.get(e['n']) or {}).get('layer', 'os')
                g.put(x - 1, yy, '▌', S('L.' + lay_id, bg))
            spans = ev_text(self, e)
            if x + sum(sw(sp[0]) for sp in spans) > right:
                spans = [(clip(''.join(sp[0] for sp in spans), right - x), spans[0][1])]
            x = draw_spans(g, x, yy, spans, right, bg)
            if e.get('n'):
                label = a.title_of(e['n'])
                if label not in (e.get('fn') or '') and x + 3 + sw(label) <= right:
                    g.put(x + 2, yy, label, S('link', bg))
        if wide:
            w3 = W - w1
            nid = cur.get('n') if cur else None
            if nid:
                ld = self.link_doc(cur, w3 - 4)
                nd = node_doc(self, nid, w3 - 4)
                nd.lines = ld.lines + nd.lines
                panel(g, w1, top, w3, h, '節', ascii_=self.ascii)
                draw_doc(g, nd, w1 + 2, top + 1, w3 - 4, h - 2, 0, 'bg')
            else:
                panel(g, w1, top, w3, h, 'できごと', ascii_=self.ascii)
                d = Doc(w3 - 4)
                if cur:
                    d.para(ev_text(self, cur))
                    d.blank()
                    d.para([('この行は地図の節に結び付いていません。', 'dim')])
                    d.blank()
                    d.kv('スレッド', [(threads.get(str(cur.get('thread')), ''), 'text')], kw=12)
                    d.kv('命令数', [(format(cur['instr'], ','), 'text')], kw=12)
                    if cur.get('program'):
                        d.kv('プログラム', [(cur['program'], 'code')], kw=12)
                draw_doc(g, d, w1 + 2, top + 1, w3 - 4, h - 2, 0, 'bg')

    for f in (trace, tr_events, tr_link, open_nav, _key_trace, link_doc, draw_trace):
        setattr(cls, f.__name__, f)
    return cls


def _search(cls):
    def results(self):
        q = self.query.strip().lower()
        if not q:
            return []
        out = []
        for nid, n in self.a.nodes.items():
            hay = ' '.join([nid, n.get('title', ''), n.get('fn') or '', ' '.join(x or '' for x in n.get('code') or []),
                            n.get('text', '')]).lower()
            if q in hay:
                score = 0 if q in n.get('title', '').lower() else 1 if q in nid else 2
                out.append((score, nid))
        return [nid for _, nid in sorted(out)][:40]

    def _key_search(self, k):
        if k == 'esc':
            self.overlay = None
        elif k == 'enter':
            res = self.results()
            if res:
                self._sync_nodes(res[min(self.q_i, len(res) - 1)])
                self.screen = 'nodes'
            self.overlay = None
        elif k == 'backspace':
            self.query = self.query[:-1]
            self.q_i = 0
        elif k in ('down', 'tab'):
            self.q_i += 1
        elif k == 'up':
            self.q_i = max(0, self.q_i - 1)
        elif len(k) == 1 and k.isprintable():
            self.query += k
            self.q_i = 0

    def draw_search(self, g):
        w = min(self.w - 4, 80)
        res = self.results()
        h = min(self.h - 2, max(8, len(res) + 5))
        x, y = self._box(g, w, h, '探す')
        xx = g.put(x + 3, y + 1, '› ', S('accent', 'panel', BOLD))
        xx = g.put(xx, y + 1, self.query, S('strong', 'panel', BOLD))
        g.put(xx, y + 1, '▏' if not self.ascii else '_', S('accent', 'panel'))
        if not self.query:
            g.put(x + 3, y + 3, '節の名前・id・関数・本文から探します', S('dim', 'panel'))
        self.q_i = max(0, min(self.q_i, len(res) - 1))
        for i, nid in enumerate(res[:h - 4]):
            n = self.a.nodes[nid]
            on = i == self.q_i
            bg = 'sel' if on else 'panel'
            yy = y + 3 + i
            g.fill(x + 1, yy, w - 2, 1, S('text', bg))
            g.put(x + 2, yy, '▌', S('L.' + n.get('layer', 'os'), bg))
            kx = g.put(x + 4, yy, pad(KIND_NAME.get(n['kind'], ''), 7), S('faint', bg))
            g.put(kx, yy, n['title'], S('strong' if on else 'text', bg, BOLD if on else 0), x1=x + w - 24)
            g.put(x + w - 23, yy, clip(nid, 21), S('faint', bg))

    for f in (results, _key_search, draw_search):
        setattr(cls, f.__name__, f)
    return cls


App = _search(_trace_screen(_nodes_screen(App)))

# ───────────────────────────────────────────────────────────── curses

def curses_key(ch):
    import curses
    if isinstance(ch, tuple):
        return ch[1]
    if isinstance(ch, str):
        return {'\n': 'enter', '\r': 'enter', '\x1b': 'esc', '\x7f': 'backspace', '\x08': 'backspace',
                '\t': 'tab'}.get(ch, ch)
    return {curses.KEY_LEFT: 'left', curses.KEY_RIGHT: 'right', curses.KEY_UP: 'up', curses.KEY_DOWN: 'down',
            curses.KEY_HOME: 'home', curses.KEY_END: 'end', curses.KEY_NPAGE: 'pgdn', curses.KEY_PPAGE: 'pgup',
            curses.KEY_ENTER: 'enter', curses.KEY_BACKSPACE: 'backspace', curses.KEY_RESIZE: 'resize',
            curses.KEY_MOUSE: 'mouse'}.get(ch, '')


BASIC8 = [(0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0), (0, 0, 238), (205, 0, 205), (0, 205, 205),
          (229, 229, 229)]


class Painter:
    """Puts a Grid on a curses window, with colour pairs made on demand."""

    def __init__(self, scr, theme):
        import curses
        self.curses, self.scr, self.theme = curses, scr, theme
        self.pairs, self.attrs = {}, {}
        self.color = curses.has_colors() and not os.environ.get('NO_COLOR')
        if self.color:
            curses.start_color()
            try:
                curses.use_default_colors()
            except curses.error:
                pass
        self.n = curses.COLORS if self.color else 0

    def _c(self, idx):
        if self.n >= 256:
            return idx
        r, g, b = xterm_rgb(idx)
        best = min(range(8), key=lambda i: sum((a - c) ** 2 for a, c in zip(BASIC8[i], (r, g, b))))
        return best

    def attr(self, st):
        a = self.attrs.get(st)
        if a is not None:
            return a
        curses = self.curses
        fg, bg, at = _STY[st]
        a = 0
        if at & BOLD:
            a |= curses.A_BOLD
        if at & UL:
            a |= curses.A_UNDERLINE
        if self.color:
            key = (self._c(self.theme.idx(fg)), self._c(self.theme.idx(bg)))
            p = self.pairs.get(key)
            if p is None and len(self.pairs) + 1 < curses.COLOR_PAIRS:
                p = len(self.pairs) + 1
                curses.init_pair(p, *key)
                self.pairs[key] = p
            if p:
                a |= curses.color_pair(p)
        elif fg in ('accent', 'strong') or bg in ('accent', 'sel'):
            a |= curses.A_REVERSE if bg in ('accent', 'sel', 'warn') else curses.A_BOLD
        self.attrs[st] = a
        return a

    def paint(self, g):
        scr = self.scr
        scr.erase()
        H, W = scr.getmaxyx()
        for y, row in enumerate(g.runs()):
            if y >= H:
                break
            for x, st, text, wide in row:
                a = self.attr(st)
                try:
                    if wide:
                        for i, ch in enumerate(text):
                            if x + 2 * i + 1 < W:
                                scr.addstr(y, x + 2 * i, ch, a)
                    else:
                        if x < W:
                            scr.addstr(y, x, text[:W - x], a)
                except self.curses.error:
                    pass
        scr.refresh()


ESCAPES = {'[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', 'OA': 'up', 'OB': 'down', 'OC': 'right',
           'OD': 'left', '[H': 'home', '[F': 'end', 'OH': 'home', 'OF': 'end', '[1~': 'home', '[4~': 'end',
           '[5~': 'pgup', '[6~': 'pgdn'}


def read_escape(scr, curses):
    """Arrow keys that came as plain escape sequences (when the terminal does not send what terminfo says)."""
    scr.nodelay(True)
    seq = ''
    try:
        while len(seq) < 4:
            try:
                c = scr.get_wch()
            except curses.error:
                break
            if not isinstance(c, str):
                break
            seq += c
            if seq in ESCAPES:
                return ('key', ESCAPES[seq])
            if not any(e.startswith(seq) for e in ESCAPES):
                break
    finally:
        scr.nodelay(False)
    for c in reversed(seq):
        try:
            curses.unget_wch(c)
        except (curses.error, AttributeError):
            pass
    return None


def pulse(scr, painter, g, cells, curses):
    """A dot runs along the current step's line, from where it starts to where it goes (any key stops it)."""
    # only on cells that hold one narrow character (never on half of a wide one, e.g. under a badge)
    cells = [(x, y) for x, y in cells if 0 <= y < g.h and 0 <= x < g.w and g.ch[y][x] != ''
             and cw(g.ch[y][x]) == 1 and not (x + 1 < g.w and g.ch[y][x + 1] == '')]
    n = len(cells)
    if n < 2:
        return
    frames = min(n, 16)
    scr.nodelay(True)
    last = None
    try:
        for i in range(frames):
            j = round(i * (n - 1) / max(1, frames - 1))
            x, y = cells[j]
            if last:
                lx, ly = last
                try:
                    scr.addstr(ly, lx, g.ch[ly][lx] or ' ', painter.attr(g.st[ly][lx]))
                except curses.error:
                    pass
            if j < n - 1:
                try:
                    scr.addstr(y, x, '●', painter.attr(S('strong', g.bg_of(x, y), BOLD)))
                except curses.error:
                    pass
            last = (x, y)
            scr.refresh()
            curses.napms(16)
            c = scr.getch()
            if c != -1:
                curses.ungetch(c)
                break
        if last:
            lx, ly = last
            try:
                scr.addstr(ly, lx, g.ch[ly][lx] or ' ', painter.attr(g.st[ly][lx]))
            except curses.error:
                pass
            scr.refresh()
    finally:
        scr.nodelay(False)


def run_curses(app):
    import curses
    import locale
    locale.setlocale(locale.LC_ALL, '')
    os.environ.setdefault('ESCDELAY', '25')

    def main(scr):
        try:
            curses.curs_set(0)
        except curses.error:
            pass
        scr.keypad(True)
        try:
            curses.mousemask(curses.BUTTON1_CLICKED | curses.BUTTON1_PRESSED | getattr(curses, 'BUTTON4_PRESSED', 0)
                             | getattr(curses, 'BUTTON5_PRESSED', 0))
        except curses.error:
            pass
        painter = Painter(scr, Theme(app.theme))
        if painter.color:
            scr.bkgd(' ', painter.attr(S('text', 'bg')))
        while not app.quit:
            H, W = scr.getmaxyx()
            app.w, app.h = max(20, W), max(8, H)
            g = app.render()
            painter.paint(g)
            if app.stepped and app.pulse and app.animate and not app.overlay:
                pulse(scr, painter, g, app.pulse, curses)
            app.stepped = False
            try:
                ch = scr.get_wch()
            except curses.error:
                continue
            if ch == '\x1b':
                ch = read_escape(scr, curses) or ch
            k = curses_key(ch)
            if os.environ.get('ATLAS_TUI_LOG'):
                with open(os.environ['ATLAS_TUI_LOG'], 'a') as f:
                    f.write('%r -> %r  (%dx%d)\n' % (ch, k, W, H))
            if k == 'mouse':
                try:
                    _, mx, my, _, bstate = curses.getmouse()
                except curses.error:
                    continue
                if bstate & getattr(curses, 'BUTTON4_PRESSED', 0):
                    app.key('left' if app.screen == 'flow' else 'up')
                elif bstate & getattr(curses, 'BUTTON5_PRESSED', 0):
                    app.key('right' if app.screen == 'flow' else 'down')
                else:
                    app.click(mx, my)
            elif k and k != 'resize':
                app.key(k)

    curses.wrapper(main)

# ───────────────────────────────────────────────────────────── command line

KEYWORDS = {'→': 'right', '←': 'left', '↑': 'up', '↓': 'down', '⏎': 'enter'}


def parse_keys(spec):
    out = []
    for t in (spec or '').split():
        out.append(KEYWORDS.get(t, t))
    return out


def render_diagram(atlas, did, step=None, view='map', width=160, ascii_=False):
    """A diagram (and its steps, as text) for printing."""
    dg = atlas.diagrams[did]
    k = dg.start if step is None else step
    app = App(atlas, width, 50, ascii_=ascii_)
    if view == 'map':
        lay = app.layout(did, width)
        if lay.W > width:
            view = 'route'
    if view == 'map':
        g = draw_layout(lay, k)
    else:
        rl = RouteLayout(atlas, dg, width, ascii_)
        g = draw_route(app, dg, rl, k)
    # the steps, below the picture
    lines = []
    lines.append([('%s  %s' % (dg.tab, dg.title), B('strong'))])
    for j, s in enumerate(dg.steps):
        fb, tb = dg.boxes.get(s.get('from'), {}), dg.boxes.get(s.get('to'), {})
        on = j == k
        lab = dg.labels[j]
        sp = [(' %2s ' % lab, CHIP('ink', 'accent') if on else CHIP('strong', 'chip2') if not s.get('alt')
               else CHIP('ink', 'warn')), (' ', 'text'),
              (fb.get('title', '?'), 'T.' + dg.tone_of(fb['id']) if fb else 'dim'),
              (' ' + kind_sample(s.get('kind'), ascii_) + ' ', 'accent' if on else 'faint'),
              (tb.get('title', '?'), 'T.' + dg.tone_of(tb['id']) if tb else 'dim'),
              ('  ' + (s.get('verb') or ''), B('strong') if on else 'text')]
        if s.get('data'):
            sp.append(('  ' + s['data'].get('label', ''), 'accent2'))
        lines.append(sp)
    # wrapped to the width; a step's later lines go under its text, the number chip stays whole
    d = Doc(max(20, width - 2))
    for i, sp in enumerate(lines):
        sp = [s if len(s) == 3 else (s[0], s[1], None) for s in sp]
        if i == 0 or spans_width(sp) <= d.w:
            d.add(sp)
            continue
        head, rest = sp[:2], sp[2:]
        hw = spans_width(head)
        for j, line in enumerate(wrap(rest, d.w - hw)):
            d.add((head if j == 0 else [(' ' * hw, 'text', None)]) + line)
    out = Grid(max(g.w, width), g.h + len(d.lines) + 1, S('text', 'bg'))
    out.blit(g, 0, 0, g.w, g.h, 0, 0)
    for i, sp in enumerate(d.lines):
        draw_spans(out, 1, g.h + 1 + i, sp, out.w, 'bg')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description='MyAtlas の文書マップをターミナルで見る')
    ap.add_argument('--data', help='atlas.json のあるディレクトリ（既定：../data）')
    ap.add_argument('--render', metavar='ID', help='流れか紙を図にして出力して終わる（ui, cpu, os.gateway …）')
    ap.add_argument('--screen', metavar='ID', nargs='?', const='', help='画面全体を一度描いて出力して終わる')
    ap.add_argument('--step', help='手順（1 から。もしの手順は A, B）')
    ap.add_argument('--view', choices=('map', 'route'), help='地図（層の帯）か道のり（縦の一本道）')
    ap.add_argument('--keys', help='--screen の前に押すキー（例："right right enter"）')
    ap.add_argument('--width', type=int)
    ap.add_argument('--height', type=int)
    ap.add_argument('--color', choices=('auto', 'always', 'never'), default='auto')
    ap.add_argument('--theme', choices=('dark', 'light'), default='dark')
    ap.add_argument('--ascii', action='store_true', help='罫線を ASCII で描く')
    ap.add_argument('--still', action='store_true', help='手順を進めた時の点の動きを止める')
    ap.add_argument('--json', metavar='FILE', help='--render/--screen の結果を term.js のフレームとして書く')
    ap.add_argument('--list', action='store_true', help='流れ・紙・節の id を出力する')
    args = ap.parse_args(argv)
    atlas = Atlas(find_data(args.data))
    if args.list:
        for did, dg in atlas.diagrams.items():
            alts = len(dg.steps) - dg.main_count
            print('%-18s %-6s %s（%d 手順%s）' % (did, dg.kind, dg.title, dg.main_count,
                                                ' ＋ もし %d' % alts if alts else ''))
        for nid, n in atlas.nodes.items():
            print('%-26s %-8s %s' % (nid, n['kind'], n['title']))
        return 0
    import shutil
    term = shutil.get_terminal_size((160, 48))
    width = args.width or (term.columns if sys.stdout.isatty() else 160)
    height = args.height or (term.lines if sys.stdout.isatty() else 46)
    color = args.color == 'always' or (args.color == 'auto' and sys.stdout.isatty() and not os.environ.get('NO_COLOR'))
    theme = Theme(args.theme)
    if args.render or args.screen is not None:
        if args.render:
            if args.render not in atlas.diagrams:
                sys.exit('知らない id です：%s（--list で一覧）' % args.render)
            dg = atlas.diagrams[args.render]
            step = None
            if args.step:
                if args.step not in dg.labels:
                    sys.exit('手順は %s のどれか' % ' '.join(dg.labels))
                step = dg.labels.index(args.step)
            g = render_diagram(atlas, args.render, step, args.view or 'map', width, args.ascii)
        else:
            app = App(atlas, width, height, ascii_=args.ascii, theme=args.theme)
            if args.screen:
                if args.screen in atlas.diagrams:
                    app.nav = [[args.screen, atlas.diagrams[args.screen].start]]
                    if args.screen in [f['id'] for f in atlas.flows]:
                        app.saved[args.screen] = app.nav
                elif args.screen in ('nodes', 'trace'):
                    app.screen = args.screen
            if args.view:
                app.mode = args.view
            if args.step:
                app.set_k(app.dg.labels.index(args.step))
            for k in parse_keys(args.keys):
                app.render()        # as the real loop: a key acts on the screen drawn before it
                app.key(k)
            g = app.render()
        if args.json:
            Path(args.json).write_text(json.dumps(frame_dict(g), ensure_ascii=False), 'utf-8')
            return 0
        print(g.ansi(theme) if color else g.text())
        return 0
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        sys.exit('対話で使うには端末が要ります。図だけなら --render ui')
    app = App(atlas, width, height, ascii_=args.ascii, theme=args.theme)
    app.animate = not args.still
    if args.view:
        app.mode = args.view
    run_curses(app)
    return 0


if __name__ == '__main__':
    sys.exit(main())
