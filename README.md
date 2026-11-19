# MyAtlas

A document map of a code base. Its text is organised by layers rather than folders, each node is
written once and everything else points at it, and flows show what passes between the nodes step
by step. MyAtlas checks that text against the code it names and builds one HTML page from it.

The text says what things mean. Signatures, struct fields and enum values come from the code, so
they cannot go stale; when the code moves, the check says which node no longer matches.

## Commands

Run from the root that the code paths in the text are relative to:

```bash
python3 tools/MyAtlas/myatlas.py --root . check            # exit 1 on an error
python3 tools/MyAtlas/myatlas.py --root . build OUT.html   # default: build/atlas/index.html
```

`--docs DIR` points at a map elsewhere than `docs/atlas`. In MyComputer, `make atlas-check`,
`make atlas` and `make atlas-trace` run these and record a trace.

[docs/FORMAT.md](docs/FORMAT.md) describes what to write where.

## The page

The page has the whole map in it and needs nothing else, so it can be opened from disk or published
as a single file. It shows:

- the layers with their nodes, and each flow drawn across them, with the data each step passes
- the paper inside a node, opened in place, with the steps around it that come in and go out
- the same flow as a 3D stack, as time running back, and as a sequence diagram
- who runs each part (execution contexts), and a node's text, code and fields beside the map
- a recorded run played over the map, and compared with the steps

The address keeps where you are (`#flow=cpu&view=seq&step=5`), so a link opens the same place.

## What it reads from code

| Language | Read |
|---|---|
| MyLang (`.mln`) | functions and methods with their parameters, structs, enums, a file's namespace |
| Rust (`.rs`) | `fn` signatures and their parameters |

Anything else can still be named: the check then only looks for the symbol.

## Layout

```
myatlas.py           entry point
myatlas/read.py      the text format
myatlas/check.py     loading the map and checking it
myatlas/code_mylang.py, code_rust.py   what the code says
myatlas/traces.py    recorded runs tied to nodes
myatlas/build.py     filling viewer.html
viewer.html          the page, with the map's data filled in at build time
```

## Tests

```bash
python3 tools/MyAtlas/tests/test_atlas.py
```
