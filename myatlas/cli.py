"""Command line for MyAtlas."""
import argparse
from pathlib import Path

from .build import build
from .check import load
from .project import Project, Report


def parser():
    root = argparse.ArgumentParser(prog='myatlas', description='Check a document map against the code, and build its viewer.')
    root.add_argument('--root', type=Path, default=Path.cwd(),
                      help='the directory the code paths in the text are relative to (default: the current one)')
    root.add_argument('--docs', type=Path, help='the map (default: ROOT/docs/atlas)')
    commands = root.add_subparsers(dest='command', required=True)
    commands.add_parser('check', help='report what no longer matches; exit 1 on an error')
    page = commands.add_parser('build', help='write the viewer, one HTML page')
    page.add_argument('out', type=Path, nargs='?', help='default: ROOT/build/atlas/index.html')
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    project = Project(args.root, args.docs)
    if not project.index.is_file():
        raise SystemExit(f'{project.index} does not exist')
    if args.command == 'check':
        rep = Report()
        load(project, rep)
        rep.show()
        return 1 if rep.errors() else 0
    return build(project, args.out or project.root / 'build' / 'atlas' / 'index.html')
