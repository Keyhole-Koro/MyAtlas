#!/usr/bin/env python3
"""Runs atlas_tui.py for real in a pseudo-terminal, presses keys, and reads the screen back with pyte (a
terminal emulator). Checks that what the terminal shows is what the app drew.

    .venv/bin/python tools/capture.py [--cols 160 --rows 44] [--keys "right right"] [--show]
"""
import argparse, os, pty, select, signal, struct, sys, termios, fcntl, time
from pathlib import Path
import pyte

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import atlas_tui as T

# what a terminal sends once the app has switched it to application keys (smkx), as xterm does
SEQ = {'right': '\x1bOC', 'left': '\x1bOD', 'up': '\x1bOA', 'down': '\x1bOB', 'enter': '\r', 'esc': '\x1b',
       'home': '\x1b[H', 'end': '\x1b[F', 'pgdn': '\x1b[6~', 'pgup': '\x1b[5~', 'backspace': '\x7f'}


def run(cols, rows, keys, extra_args=()):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = os.environ.get('CAPTURE_TERM', 'screen-256color')
        if os.environ.get('CAPTURE_TERMINFO'):
            os.environ['TERMINFO'] = os.environ['CAPTURE_TERMINFO']
        os.environ['LANG'] = os.environ.get('LANG', 'C.UTF-8')
        os.environ['ESCDELAY'] = '25'
        os.execv(sys.executable, [sys.executable, str(HERE / 'atlas_tui.py'), *extra_args])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.kill(pid, signal.SIGWINCH)
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)

    def pump(t):
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return
                stream.feed(data)

    pump(1.5)
    for k in keys:
        os.write(fd, SEQ.get(k, k).encode())
        pump(0.35)
    pump(0.5)
    snapshot = pyte.Screen(cols, rows)
    snapshot.buffer.update({y: dict(screen.buffer[y]) for y in range(rows)})
    os.kill(pid, signal.SIGTERM)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    return screen


def screen_text(screen):
    lines = []
    for y in range(screen.lines):
        row = screen.buffer[y]
        s = ''.join(row[x].data for x in range(screen.columns))
        lines.append(s.rstrip())
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cols', type=int, default=160)
    ap.add_argument('--rows', type=int, default=44)
    ap.add_argument('--keys', default='')
    ap.add_argument('--show', action='store_true')
    ap.add_argument('--args', default='')
    a = ap.parse_args()
    keys = T.parse_keys(a.keys)
    screen = run(a.cols, a.rows, keys, a.args.split())
    got = screen_text(screen)
    atlas = T.Atlas(T.find_data())
    app = T.App(atlas, a.cols, a.rows)
    for k in keys:
        app.render()
        app.key(k)
    want = app.render().text().split('\n')
    bad = [(i, w, g) for i, (w, g) in enumerate(zip(want, got)) if w.rstrip() != g.rstrip()]
    if a.show:
        print('\n'.join(got))
    # colours: a few cells
    fg = {}
    for y in range(screen.lines):
        for x in range(screen.columns):
            c = screen.buffer[y][x]
            fg[c.fg] = fg.get(c.fg, 0) + 1
    print('rows that differ:', len(bad), '/', a.rows)
    for i, w, g in bad[:6]:
        print('  row', i)
        print('   app :', w[:150])
        print('   term:', g[:150])
    print('colours seen:', len(fg), sorted(fg.items(), key=lambda kv: -kv[1])[:6])
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
