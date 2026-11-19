# Writing the map

A map is a directory of plain text, `docs/atlas` unless `--docs` says otherwise. Each node is
written once, in the file of its layer, and everything else points at it with `[[id]]`. Flows and
papers place nodes as boxes and say, step by step, what passes between them. The code paths in the
text are relative to `--root`.

```
docs/atlas/
  atlas.md              the title, the layers, the flows to show, the project's commands
  layers/<layer>.md     the nodes of one layer
  flows/<flow>.md       a flow listed in atlas.md
  flows/<node>.md       the paper inside a node, named after it
  figures/*.svg         figures that nodes show
  traces/*.json         recorded runs (see "Traces")
```

The keywords are Japanese because the maps so far are; the reader matches them exactly.

## atlas.md

```
# MyComputer 文書マップ

文章の実体は 1 か所にだけ置き、他からはポインタ（[[id]]）で指す。

層（上から）：app lib os kernel emu
横断：contract context policy
流れ：ui cpu
照合：make atlas-check
記録：make atlas-trace
```

- The `#` heading is the page's title.
- `層` lists the stacked layers from the top. The first five get the viewer's five layer colours.
- `横断` lists layers that cut across the stack: data shapes, execution contexts, policies.
- `流れ` lists the flows, in the order of their tabs.
- `照合` and `記録` are optional. They are the commands the page names for checking the map and
  recording runs again.

## Layers and nodes

```
# OS サービス（MyOS）

## os.gateway  request_gateway.request
関数・system/MyOS/src/ipc/gateway.unsafe.mln の request
中の紙：os.gateway
引数 pid：呼んだプロセス
返す：列に入ったら true。満杯なら false

owner を呼んだプロセスの pid で上書きし、…[[os.request-ring]] に並べる。
```

The first line is `# name（description）`. Each node starts with `## id  title`, then facts, one a
line, then a blank line and the text. Ids are unique across the whole map.

The first fact is the kind, and for most kinds the code it describes: `kind・path の symbol`.

| Kind | What the checker takes from the code |
|---|---|
| `関数` | the signature; every `引数` has to be a parameter |
| `構造体` | the fields with their types; every `フィールド` has to exist |
| `列挙` | the values; every `値` has to exist |
| `置き場` | a struct's fields when the symbol is a type name, otherwise only that the symbol is there |
| `レジスタ`, `実行の文脈`, `方針`, `図` | only that the symbol, if one is named, is there |

Facts after the kind:

| Fact | Meaning |
|---|---|
| `引数 name：…` | what a parameter means |
| `返す：…` | what the function returns |
| `型：…` | the signature written by hand, for code the reader cannot take apart; several lines continue it. A line ending in `;` is one statement, and has to appear in the code as written |
| `フィールド name：…` | what a field means. `フィールド a0 … a5` covers a run, `フィールド *s0` a pointer, `フィールド name（type）` gives the type when the code has no struct to take it from |
| `値 NAME：…` | what an enum value means. `値 …：…` sums up the rest, and the rest is then not listed |
| `中の紙：id` | the node has a paper inside, `flows/<id>.md` |
| `図：figures/x.svg` | the node is a figure |
| `レジスタ：…` | the register a hardware node is |
| `走る：…` | for an execution context: who runs it. The viewer colours contexts by it, three colours at most |
| `カーネルの中：はい` | for an execution context: it runs in the kernel, which the viewer hatches |

In the text, `[[id]]` links to a node and `![[id]]` shows it in place, a figure for example.

## Flows and papers

```
# UI の要求
タスクマネージャの表示の変更が DOM に届くまで
はじめ：5

文脈 [[ctx.service]] serve handle dom：service task ｜位置 br

箱 tick [[app.tasks]] tick() ｜名前空間 Tasks ｜説明 @timer(1000)
箱 send [[lib.send-text]] send_text(id, s) ｜略 send_text

1. tick → send  呼び出し「値が変わった」
   Tasks の値が変わると、属性のフックが send_text を呼ぶ
2. send → transport  呼び出し「詰める」 渡す Request{op, a0, s0} [[lib.transport]]
   SET_TEXT の Request に詰めて送る
もし 満杯（5 の代わり）. gateway → oscall  戻り「false」 [[gateway.full]]
   列が満杯なら false を返す
```

- `#` names the tab. The line after it, if it is not a keyword, is the title over the map.
- `はじめ：n` is the step shown first.
- `文脈 [[ctx]] box…：label` draws an execution context around boxes. Options: `｜短く label` for
  tight places, `｜位置 tl|tr|bl|br|r` for where the label sits (top left by default), `｜時系列 label` for its name
  in the sequence view.
- `箱 id [[node]] title` places a node. Options: `｜略 x` a shorter title, `｜名前空間 x`,
  `｜説明 x` a line under the title, `｜中身 a, b` slots drawn inside, `｜中身の形 [[schema]]` what
  the slots are, `｜ビット` drawn as a register, `｜段 n` the lane, when the automatic one is wrong.
  A box sits in its node's layer.
- A step is `n. from → to  kind「verb」 渡す data [[node]]`, and the indented line under it says
  what happens. The kinds are `呼び出し`, `syscall`, `戻り`, `通知`, `割り込み`, `列を通す`,
  `読み書き`, `読む` and `書く`. `[[node]]` is the node the step explains, the from box's by default.
- `渡す` names the data: `Request`, `Request{owner, s0}` for the fields that matter,
  `=[[schema.x]]` when the name is not a node's title, `「type」` for the type as written, and
  `札なし` to leave it off the line. An indented `渡す値：…` says more about it.
- An indented `分かれる：a → b ／ c → d` lists where the step branches.
- `もし when（n の代わり）.` is another way instead of step n; `もし when（n のあと）.` comes after it.
  They are lettered A, B, … after the numbered steps.

A paper (`flows/<node>.md`, named after the node that holds it) is drawn inside its node's box and
has the same lines, plus:

- `帯 id name／sub（layer）` starts a band; indented `箱` lines under it sit in it. `layer` gives
  the band its colour.
- `入口：box` is where the steps coming in from outside land.
- `出口 [[node]]：box` and `入口 [[node]]：box` tie a step outside the paper that goes to or comes
  from that node to a box inside, so the viewer can draw it through the paper's edge.

## Traces

A trace is a recorded run: the functions that were entered, the interrupts and the thread switches,
in order. MyProfiler's `trace` command writes them (its docs/formats.md describes the file). The
viewer plays a trace over the map and compares it with the steps. An event's `fn` is the function
as the source names it, `namespace.function` or `Type.method`, and lands on the node whose code is
that function.

## What the check reports

Errors: a node, box, step or pointer that points at nothing; code that is not where the text says;
a parameter, field or value the code does not have; a line the reader cannot read. Warnings: a field
or value the text does not explain, steps numbered out of order. `myatlas check` exits 1 on an
error, and `myatlas build` writes no page.
