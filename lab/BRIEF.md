# Atlas lab: brief for every prototype

The user wants to see the document map (MyAtlas) shown in new, easier-to-read ways. The current
viewer is one HTML page that had to run inside a sandbox (no CDN, no storage, one file). Here that
constraint is lifted: try whatever shows the system best. Every prototype lives in its own folder.

## What is being mapped

MyComputer is a small computer built from scratch, top to bottom: apps and the SDK, OS services
(MyOS), the kernel (MyKernel), and an emulator (MyEmulator, Rust) underneath. Code is in MyLang
(`.mln`, C-like) and Rust. The map (`docs/atlas`) describes 70 nodes (functions, stores, structs,
enums, execution contexts...) in 5 stacked layers plus 3 cross-cutting ones, and walks through two
flows step by step:

- `ui`: a value changes in the task manager's view and travels app → SDK → OS_CALL → gateway →
  request ring → service task → UI protocol → DOM.
- `cpu`: the emulator's timer ticks, the kernel charges CPU time, and the task manager reads it.

Some nodes have a "paper inside" (a sub-flow drawn inside that node): `os.gateway`, `os.submit`,
`app.tasks`, `kernel.cpu-time`. There is one recorded run (a trace) of typing "x" in the editor.

Never invent facts about the system. Everything shown must come from the data below or from the
source files. UI text is Japanese, short and plain (the map's own text is Japanese).

## Data (read-only; never change `lab/data`, `lab/tools`, `lab/reference` or other folders)

Load with `<script src="../data/atlas.js"></script>` → `window.ATLAS`, and
`<script src="../data/code.js"></script>` → `window.ATLAS_CODE`. Raw source files:
`fetch("../data/src/<path>")`. (The same data is in `atlas.json` / `code.json`.)

`ATLAS`:
- `title`, `docs`, `how`
- `layers[]`: `{id, name, sub, cross}`. Stacked (cross=false), top to bottom: `app`, `lib`, `os`,
  `kernel`, `emu`. Cross-cutting (cross=true): `contract` (data shapes), `context` (execution
  contexts), `policy`.
- `nodes{id}`: `{layer, title, kind, code:[path, symbol], text, src, ...}`. `kind` is one of
  `func`, `store`, `schema` (struct), `enum`, `context`, `hw`, `note`, `figure`. `text` is prose
  with `[[node-id]]` links. Optional: `api {sig, params:[[name, meaning]], returns}`,
  `fields:[...]`, `values:[...]`, `paper` (id of the paper inside), `shape` (data structure: ring,
  table, tree, list), `ops`, `states`, `invariants`, `run`, `kernel`, `reg`, `figure`, `fn`.
- `flows[]`: `{id, title, tab, start, boxes[], regions[], steps[]}`.
  - `boxes[]`: `{id, node, title, ns, sub, layer}`; `node` is the node id.
  - `regions[]`: `{node, boxes:[box ids], label}`: execution contexts drawn as dashed frames.
  - `steps[]`: `{kind, from, to, verb, label, ref, data?, ops?, alt?, branches?}`. `kind`: `call`,
    `syscall`, `msg`, `signal`, `data`, `return`... `from`/`to` are box ids. `data` is
    `{label, schema, fields?, note?}` (what is handed over). `ops`: operations on a data structure.
    `alt`: a step that happens instead of another (e.g. the ring is full). Steps are in order.
- `papers{id}`: like flows, plus `bands[]` (`{id, name, sub, tone}` used instead of layers inside
  a paper), `entry` (the box the paper starts at) and `ports` (`{outer node id: box id}`: where the
  paper connects to the flow outside).
- `traces[]`: `{id, title, date, run, build, threads{tid: name}, events[]}`. Events:
  `{seq, instr, thread, ev, fn?, n?, program?, method?, service?, cause?}`; `instr` is the
  instruction count (time), `n` a node id when the event belongs to one. Look at every `ev` kind
  before using them.

`ATLAS_CODE`:
- `nodes{id}`: `{path, symbol, start, end}`: where the node is defined (1-based lines).
- `steps{flow or paper id}{step index}`: `{path, line}`: the line where the step happens, when it
  could be found (only some steps; fall back to the target's definition).
- `files{path}`: `{lang, lines}`.

The current viewer is `lab/reference/index.html` (screenshots in `lab/reference/shots/`). It is
dense: lanes per layer, many small labels, numbered step pills, dashed regions, crossing arrows.
Do something different and more readable, not a copy.

## Rules

- Work only in `lab/<your id>/`. Entry: `lab/<your id>/index.html`. Do not commit or push.
- It is served by `lab/serve.sh` (`http://127.0.0.1:8765/<id>/`); it must also work from the
  screenshot tool, which serves `lab/` the same way. Nothing may load from the internet at run
  time: install libraries with npm inside your folder (`node_modules/` is ignored) and copy the
  files you need into `lab/<id>/vendor/`, or bundle with esbuild and keep the built file. Keep the
  folder small (a few MB at most, screenshots aside).
- Otherwise anything goes: any library, Canvas, WebGL, workers, localStorage, keyboard shortcuts,
  a local helper server in Python (stdlib) as long as the page still works without it.
- Colours: the layers' colours, if your idea needs per-layer colour:
  app `#eb6834`, lib `#1baf7a`, os `#eda100`, kernel `#e87ba4`, emu `#008300`
  (dark mode: `#d95926 #199e70 #c98500 #d55181 #008300`). Accent `#2f5bd3` (dark `#7c9dff`).
  Fonts: `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`; code
  `ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", monospace`.
  Support dark mode (`prefers-color-scheme`) unless the idea makes it meaningless.
- Verify by looking: `node lab/tools/shot.mjs <id>/index.html lab/<id>/shots/<name>.png
  [--w 1440 --h 900 --dark --wait ms --click "<selector>" --eval "<js>" --full --scale 2]`
  (exit 2 when the page logged errors). Read the PNGs and fix what you see: overlapping or cut-off
  labels, unreadable text, empty areas, errors. Iterate until it is genuinely good.
  `lab/<id>/shots/main.png` (1440×900) is the gallery thumbnail; keep 3–6 shots in total.
  For WebGL, copy the tool into your folder and launch Chromium with
  `--use-angle=swiftshader --enable-unsafe-swiftshader` if it renders black.
- If the permission system refuses a command, do not try to get around it: say so in your report
  and check another way (node --check, jsdom).
- Write `lab/<id>/NOTES.md` in Japanese: the idea, how to use it, what works, what does not, and
  what the main viewer could take from it.
