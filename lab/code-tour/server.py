#!/usr/bin/env python3
"""Serves the lab like serve.sh, and lets the code tour open a file in the editor.

    python3 lab/code-tour/server.py [port]        # default 8765, then http://127.0.0.1:8765/code-tour/

Every response carries X-Code-Tour-Editor: code when `code` is on PATH; the page shows its
「エディタで開く」 button only then.
GET /open?probe=1               -> {"ok": true} when `code` is on PATH
GET /open?path=<p>&line=<n>     -> runs `code -g <root>/<p>:<n>` (root from data/code.json)

Only files that data/code.json lists can be opened, only from this machine (127.0.0.1), and only by
a request carrying the X-Code-Tour header, which a page on another site cannot send without asking.
CODE_TOUR_DRY=1 prints the command instead of running it. Python standard library only.
"""
import http.server
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
CODE = json.loads((LAB / 'data' / 'code.json').read_text(encoding='utf-8'))
ROOT = Path(os.environ.get('CODE_TOUR_ROOT') or CODE['root']).expanduser()
FILES = set(CODE['files'])
DRY = bool(os.environ.get('CODE_TOUR_DRY'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(LAB), **kwargs)

    def end_headers(self):
        # The page looks for this on its own index.html: no request to /open unless it is here.
        if shutil.which('code') or DRY:
            self.send_header('X-Code-Tour-Editor', 'code')
        super().end_headers()

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == '/open':
            return self.open_in_editor(urllib.parse.parse_qs(url.query))
        return super().do_GET()

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def open_in_editor(self, query):
        if self.headers.get('X-Code-Tour') != '1':
            return self.reply(403, {'ok': False, 'error': 'X-Code-Tour が無い'})
        editor = shutil.which('code')
        if 'probe' in query:
            return self.reply(200, {'ok': bool(editor) or DRY, 'editor': 'code' if editor else None})
        if not editor and not DRY:
            return self.reply(503, {'ok': False, 'error': 'code コマンドが見つからない'})
        path = query.get('path', [''])[0]
        line = query.get('line', ['1'])[0]
        if path not in FILES:
            return self.reply(400, {'ok': False, 'error': '地図に無いファイル'})
        if not line.isdigit() or int(line) < 1:
            return self.reply(400, {'ok': False, 'error': '行が数でない'})
        target = ROOT / path
        if not target.is_file():
            return self.reply(404, {'ok': False, 'error': f'{target} が無い'})
        command = [editor or 'code', '-g', f'{target}:{int(line)}']
        if DRY:
            print('would run:', ' '.join(command), flush=True)
        else:
            subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        return self.reply(200, {'ok': True})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    except OSError as e:
        print(f'port {port}: {e}. Another port: python3 {sys.argv[0]} {port + 1}', file=sys.stderr)
        return 1
    print(f'http://127.0.0.1:{port}/code-tour/  (lab: {LAB}, code root: {ROOT}{", dry run" if DRY else ""})', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
