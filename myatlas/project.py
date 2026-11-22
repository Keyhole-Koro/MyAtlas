"""Where a project keeps its code and its map, and the problems a check finds."""
import os
import sys
from pathlib import Path


def leaves(rel):
    """Whether a path the text gives leaves the directory it is relative to: absolute, or climbing out with
    '..'. Only the text is looked at, so a symlink inside the directory still works."""
    path = os.path.normpath(rel)
    return os.path.isabs(path) or path == os.pardir or path.startswith(os.pardir + os.sep)


class Project:
    """The root that the code paths in the text are relative to, and the map's directory in it."""

    def __init__(self, root, docs=None):
        self.root = Path(root).resolve()
        self.docs = Path(docs).resolve() if docs else self.root / 'docs' / 'atlas'
        self.index = self.docs / 'atlas.md'
        self.traces = self.docs / 'traces'
        self._files = {}

    def rel(self, path):
        """A path as the text and the reports write it: relative to the root when it is inside."""
        path = Path(path)
        try:
            return str(path.resolve().relative_to(self.root))
        except ValueError:
            return str(path)

    def code_text(self, rel):
        """A source file's text, read once; None when it is missing or outside the root."""
        if rel not in self._files:
            p = self.root / rel
            self._files[rel] = p.read_text(encoding='utf-8', errors='replace') if not leaves(rel) and p.is_file() else None
        return self._files[rel]


class Report:
    def __init__(self):
        self.items = []

    def error(self, where, msg):
        self.items.append(('error', where, msg))

    def warn(self, where, msg):
        self.items.append(('warning', where, msg))

    def errors(self):
        return [i for i in self.items if i[0] == 'error']

    def show(self):
        """Each problem on stdout, the count on stderr."""
        for level, where, msg in self.items:
            print(f'{where}: {level}: {msg}')
        e = len(self.errors())
        print(f'{e} errors, {len(self.items) - e} warnings', file=sys.stderr)
