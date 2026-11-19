#!/usr/bin/env python3
"""MyAtlas on a small project: reading the text, checking it against the code, traces and the page."""

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from myatlas import code_mylang, code_rust  # noqa: E402
from myatlas.build import build, page  # noqa: E402
from myatlas.check import field_matches, load  # noqa: E402
from myatlas.project import Project, Report  # noqa: E402
from myatlas.traces import load_traces  # noqa: E402

CODE = {
    'src/queue.mln': """namespace queue;

export enum Kind { NONE, PUSH = 4, POP }

export struct Message {
    Kind kind;
    i32 a0;
    i32 a1;
    i32 a2;
    char *text;
};

// push puts one message on the queue
export bool push(Message m, i32 owner) {
    return true;
}

void (borrow Queue q) drain() {
    q.count = 0;
}
""",
    'src/device.rs': """impl Device {
    pub fn tick(&mut self, cycles: u32, (lo, hi): (u8, u8)) -> bool {
        true
    }
}
""",
}

INDEX = """# 小さな地図

層（上から）：app os
流れ：send
照合：make check-map
"""

APP = """# アプリ（app）

## app.main  main
関数・src/queue.mln の push
引数 m：送るもの

アプリの入口。[[os.push]] を呼ぶ。
"""

OS = """# OS（os）

## os.push  queue.push
関数・src/queue.mln の push
中の紙：os.push
引数 m：入れる要求
引数 owner：呼んだプロセス
返す：入ったら true

列に入れる。

## os.drain  Queue.drain
関数・src/queue.mln の drain
引数 q：列

## os.message  Message
構造体・src/queue.mln の Message
フィールド kind：種類
フィールド a0 … a2：引数
フィールド *text：文字列

[[os.push]] が受け取る。

## os.kind  Kind
列挙・src/queue.mln の Kind
値 NONE：
値 PUSH：入れる

## emu.tick  Device.tick
関数・src/device.rs の tick
引数 cycles：進める数
"""

FLOW = """# 送る
1 通を列に入れる
入口：app

箱 app [[app.main]] main
箱 push [[os.push]] push ｜略 p

1. app → push  呼び出し「入れる」 渡す Message{kind}
   アプリが列に入れる
もし 満杯（1 のあと）. push → app  戻り「false」
   入らなければ false が返る
"""

PAPER = """# queue.push の中
入口：take

帯 inner 中／順に（os）
  箱 take [[os.push]] 受け取る
  箱 drain [[os.drain]] 空ける

1. take → drain  呼び出し
   空ける
"""


class Fixture:
    def __init__(self, root: Path):
        self.root = root
        self.docs = root / 'docs' / 'atlas'
        for rel, text in CODE.items():
            self.write(root / rel, text)
        self.write(self.docs / 'atlas.md', INDEX)
        self.write(self.docs / 'layers' / 'app.md', APP)
        self.write(self.docs / 'layers' / 'os.md', OS)
        self.write(self.docs / 'flows' / 'send.md', FLOW)
        self.write(self.docs / 'flows' / 'os.push.md', PAPER)

    @staticmethod
    def write(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def edit(self, rel: str, old: str, new: str) -> None:
        path = self.root / rel
        text = path.read_text(encoding='utf-8')
        assert old in text, old
        path.write_text(text.replace(old, new, 1), encoding='utf-8')

    def check(self):
        rep = Report()
        result = load(Project(self.root), rep)
        return rep, result


class AtlasTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='myatlas-test-')
        self.fx = Fixture(Path(self.temporary.name))

    def tearDown(self):
        self.temporary.cleanup()

    def messages(self, rep, level='error'):
        return [m for lv, _, m in rep.items if lv == level]

    def test_a_matching_map_has_no_errors(self):
        rep, (index, layers, nodes, flows, papers) = self.fx.check()
        self.assertEqual(self.messages(rep), [])
        self.assertEqual(index['title'], '小さな地図')
        self.assertEqual(index['how'], {'check': 'make check-map'})
        self.assertEqual([l['id'] for l in layers], ['app', 'os'])
        self.assertEqual(nodes['os.push']['api']['sig'], 'bool push(Message m, i32 owner)')
        self.assertEqual(nodes['os.drain']['api']['sig'], 'void (borrow Queue q) drain()')
        self.assertEqual(nodes['emu.tick']['api']['sig'], 'fn tick(&mut self, cycles: u32, (lo, hi): (u8, u8)) -> bool')
        self.assertEqual(nodes['os.message']['fields'],
                         [['Kind', 'kind', '種類'], ['i32', 'a0 … a2', '引数'], ['char', '*text', '文字列']])
        self.assertEqual(nodes['os.kind']['values'], [['NONE', ''], ['PUSH', '入れる'], ['POP', '']])
        self.assertIn('POP', ' '.join(self.messages(rep, 'warning')))
        send = flows[0]
        self.assertEqual((send['tab'], send['title']), ('送る', '1 通を列に入れる'))
        self.assertEqual(send['steps'][0]['data'], {'label': 'Message', 'fields': ['kind'], 'schema': 'os.message'})
        self.assertEqual(send['steps'][1]['alt'], {'at': 0, 'when': '満杯', 'also': True})
        self.assertEqual(send['start'], [0, 'app.main'])
        self.assertEqual(papers['os.push']['tab'], 'queue.push')
        self.assertEqual(papers['os.push']['boxes'][0]['layer'], 'inner')

    def test_code_that_moved_is_reported(self):
        self.fx.edit('src/queue.mln', 'export bool push(Message m, i32 owner)', 'export bool put(Message m, i32 who)')
        rep, _ = self.fx.check()
        errors = ' '.join(self.messages(rep))
        self.assertIn('関数 push が見つからない', errors)

    def test_a_parameter_the_code_lacks_is_reported(self):
        self.fx.edit('src/queue.mln', 'i32 owner)', 'i32 pid)')
        rep, _ = self.fx.check()
        self.assertIn('os.push: 引数 owner はコードの push に無い（m, pid）', self.messages(rep))
        self.fx.edit('docs/atlas/layers/os.md', '引数 cycles', '引数 steps')
        rep, _ = self.fx.check()
        self.assertTrue(any('引数 steps はコードの tick に無い（self, cycles' in m for m in self.messages(rep)))

    def test_fields_and_values_are_checked(self):
        self.fx.edit('docs/atlas/layers/os.md', 'フィールド kind：種類', 'フィールド sort：種類')
        self.fx.edit('docs/atlas/layers/os.md', '値 PUSH：入れる', '値 PUT：入れる')
        rep, _ = self.fx.check()
        errors = self.messages(rep)
        self.assertIn('os.message: フィールド sort は Message に無い', errors)
        self.assertIn('os.kind: 値 PUT は Kind に無い', errors)
        self.assertIn('os.message: Message.kind に説明が無い', self.messages(rep, 'warning'))

    def test_pointers_boxes_and_papers_have_to_land(self):
        self.fx.edit('docs/atlas/layers/app.md', '[[os.push]] を呼ぶ', '[[os.pull]] を呼ぶ')
        self.fx.edit('docs/atlas/flows/send.md', '1. app → push', '1. app → pull')
        self.fx.write(self.fx.docs / 'flows' / 'stray.md', PAPER)
        rep, _ = self.fx.check()
        errors = self.messages(rep)
        self.assertIn('app.main: ポインタ [[os.pull]] の先が無い', errors)
        self.assertIn('手順の箱 pull が無い', errors)
        self.assertTrue(any('中の紙 stray を持つ節が無い' in m for m in errors))

    def test_who_runs_belongs_to_contexts(self):
        self.fx.edit('docs/atlas/layers/os.md', '## os.drain  Queue.drain\n関数・src/queue.mln の drain\n',
                     '## os.drain  Queue.drain\n関数・src/queue.mln の drain\n走る：割り込み\n')
        contexts = ''.join(f'## ctx.{i}  文脈 {i}\n実行の文脈\n走る：{who}\nカーネルの中：はい\n\n' for i, who in enumerate('ABCD'))
        self.fx.write(self.fx.docs / 'layers' / 'os.md', (self.fx.docs / 'layers' / 'os.md').read_text(encoding='utf-8') + '\n' + contexts)
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertIn('os.drain: 走る・カーネルの中 は実行の文脈にだけ書く', self.messages(rep))
        self.assertTrue(nodes['ctx.0']['kernel'])
        self.assertIn('走るの色は 3 つまで。D の文脈には色が付かない', self.messages(rep, 'warning'))

    def test_a_missing_figure_is_reported(self):
        self.fx.edit('docs/atlas/layers/os.md', '列挙・src/queue.mln の Kind\n', '列挙・src/queue.mln の Kind\n図：figures/kind.svg\n')
        rep, _ = self.fx.check()
        self.assertIn('os.kind: 図のファイルが無い: docs/atlas/figures/kind.svg', self.messages(rep))

    def test_a_figure_outside_the_map_is_not_read(self):
        self.fx.edit('docs/atlas/layers/os.md', '列挙・src/queue.mln の Kind\n', '列挙・src/queue.mln の Kind\n図：../../src/queue.mln\n')
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertIn('os.kind: 図のファイルは地図のディレクトリの中に置く: ../../src/queue.mln', self.messages(rep))
        self.assertNotIn('figure', nodes['os.kind'])
        self.assertIsNone(page(Project(self.fx.root), Report()))

    def test_code_outside_the_root_is_not_read(self):
        fx = Fixture(self.fx.root / 'inner')   # the outer fixture's code lies beside it, outside its root
        fx.edit('docs/atlas/layers/os.md', '関数・src/queue.mln の drain', '関数・../src/queue.mln の drain')
        fx.edit('docs/atlas/layers/os.md', '構造体・src/queue.mln の Message', f'構造体・{fx.root}/src/queue.mln の Message')
        rep, (_, _, nodes, _, _) = fx.check()
        errors = self.messages(rep)
        self.assertIn('os.drain: コードのファイルは --root の中に置く: ../src/queue.mln', errors)
        self.assertIn(f'os.message: コードのファイルは --root の中に置く: {fx.root}/src/queue.mln', errors)
        self.assertNotIn('sig', nodes['os.drain']['api'])
        self.assertNotIn('fields', nodes['os.message'])
        self.assertIsNone(Project(fx.root).code_text('../src/queue.mln'))
        self.assertIsNone(page(Project(fx.root), Report()))

    def located(self, rep):
        return [(where, m) for lv, where, m in rep.items if lv == 'error']

    def test_a_heading_without_an_id_is_an_error(self):
        self.fx.edit('docs/atlas/layers/os.md', '## os.drain  Queue.drain', '## \n関数・src/queue.mln の push\n\n## os.drain  Queue.drain')
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertEqual(self.located(rep), [('docs/atlas/layers/os.md:12', '節の見出しは「## ID  題」')])
        self.assertIn('os.drain', nodes)

    def test_a_start_that_is_not_a_number_is_an_error(self):
        self.fx.edit('docs/atlas/flows/send.md', '入口：app', '入口：app\nはじめ：二')
        rep, (_, _, _, flows, _) = self.fx.check()
        self.assertEqual(self.located(rep), [('docs/atlas/flows/send.md:4', 'はじめ は手順の番号: 二')])
        self.assertEqual(flows[0]['start'], [0, 'app.main'])

    def test_a_lane_that_is_not_a_number_is_an_error(self):
        self.fx.edit('docs/atlas/flows/send.md', '｜略 p', '｜略 p｜段 x')
        rep, (_, _, _, flows, _) = self.fx.check()
        self.assertEqual(self.located(rep), [('docs/atlas/flows/send.md:6', '箱の段は数: x')])
        self.assertNotIn('lane', flows[0]['boxes'][1])

    def test_a_first_step_from_a_missing_box_is_an_error(self):
        self.fx.edit('docs/atlas/flows/send.md', '1. app → push', '1. ap → push')
        rep, (_, _, _, flows, _) = self.fx.check()
        self.assertEqual(self.located(rep), [('docs/atlas/flows/send.md:8', '手順の箱 ap が無い')])
        self.assertEqual(flows[0]['start'], [0, None])

    def test_a_path_that_climbs_back_in_stays_allowed(self):
        self.fx.edit('docs/atlas/layers/os.md', '関数・src/queue.mln の drain', '関数・src/../src/queue.mln の drain')
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertEqual(self.messages(rep), [])
        self.assertEqual(nodes['os.drain']['api']['sig'], 'void (borrow Queue q) drain()')

    def test_a_trace_names_the_nodes_it_ran(self):
        events = [{'seq': 0, 'ev': 'enter', 'fn': 'queue.push', 'thread': 1, 'program': 'app', 'instr': 5},
                  {'seq': 1, 'ev': 'exit', 'fn': 'queue.push', 'thread': 1, 'program': 'app', 'instr': 9},
                  {'seq': 2, 'ev': 'enter', 'fn': 'Queue.drain', 'thread': 1, 'program': 'app', 'instr': 12}]
        self.fx.write(self.fx.docs / 'traces' / 'run.json', json.dumps({'title': '1 回', 'events': events}))
        rep, (_, _, nodes, _, _) = self.fx.check()
        traces = load_traces(Project(self.fx.root), nodes, rep)
        self.assertEqual([e.get('n') for e in traces[0]['events']], ['os.push', 'os.drain'])
        self.assertEqual(nodes['os.push']['fn'], 'queue.push')   # the node with the paper, not app.main

    def test_a_malformed_trace_is_an_error(self):
        files = {'list': '[]', 'events': '{"events":[1, {"ev": "enter", "fn": "queue.push"}, {"ev": "enter", "fn": [1]}]}',
                 'build': '{"build":"x"}', 'nolist': '{"events":{"ev":"enter"}}'}
        for name, content in files.items():
            self.fx.write(self.fx.docs / 'traces' / f'{name}.json', content)
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertEqual(self.messages(rep), [])
        traces = {t['id']: t for t in load_traces(Project(self.fx.root), nodes, rep)}
        self.assertEqual(self.located(rep), [
            ('docs/atlas/traces/build.json', 'build は JSON のオブジェクト'),
            ('docs/atlas/traces/events.json', 'events の 1 個がオブジェクトでない（0 番目から）。飛ばす'),
            ('docs/atlas/traces/list.json', '記録の一番外は JSON のオブジェクト'),
            ('docs/atlas/traces/nolist.json', 'events は JSON の配列')])
        self.assertEqual(sorted(traces), ['build', 'events', 'nolist'])
        self.assertEqual(traces['build']['build'], {})
        self.assertEqual(traces['events']['events'], [{'ev': 'enter', 'fn': 'queue.push', 'n': 'os.push'}, {'ev': 'enter', 'fn': [1]}])
        self.assertEqual(traces['nolist']['events'], [])

    def test_the_page_carries_the_map(self):
        out = self.fx.root / 'build' / 'atlas' / 'index.html'
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(build(Project(self.fx.root), out), 0)
        text = out.read_text(encoding='utf-8')
        self.assertIn('<title>小さな地図</title>', text)
        self.assertNotIn('__ATLAS_', text)
        data = json.loads(text.split('const DATA = ', 1)[1].split(';\n', 1)[0].replace('<\\/', '</'))
        self.assertEqual(data['docs'], 'docs/atlas')
        self.assertNotIn('_where', json.dumps(data))

    def page_data(self, text):
        return json.loads(text.split('const DATA = ', 1)[1].split(';\n', 1)[0])

    def test_markup_in_the_text_cannot_leave_the_script(self):
        self.fx.edit('docs/atlas/layers/os.md', '列に入れる。', '列に入れる。<!-- <script> </script>')
        text, _ = page(Project(self.fx.root), Report())
        blob = text.split('const DATA = ', 1)[1].split(';\n', 1)[0]
        for markup in ('<!--', '<script', '</script', '<'):
            self.assertNotIn(markup, blob)
        self.assertEqual(self.page_data(text)['nodes']['os.push']['text'], '列に入れる。<!-- <script> </script>')

    def test_a_title_that_spells_a_placeholder_stays_text(self):
        self.fx.edit('docs/atlas/atlas.md', '# 小さな地図', '# 地図 __ATLAS_DATA__ <b>')
        text, _ = page(Project(self.fx.root), Report())
        self.assertIn('<title>地図 __ATLAS_DATA__ &lt;b&gt;</title>', text)
        self.assertEqual(text.count('const DATA = {'), 1)
        self.assertEqual(self.page_data(text)['title'], '地図 __ATLAS_DATA__ <b>')

    def test_an_error_writes_no_page(self):
        self.fx.edit('docs/atlas/flows/send.md', '1. app → push', '1. app → pull')
        self.assertIsNone(page(Project(self.fx.root), Report()))


DSA_CODE = """
i32 SLOTS = 8;
struct Ring {
    i32 head;
    i32 tail;
};
enum State { Idle, Busy(i32), Done }
struct Job {
    State state;
};
void start(Job j) { j.state = State::Busy(1); }
void finish(Job j) { j.state = State::Done; }
void reset(Job j) { j.state = State::Idle; }
"""

DSA_NODES = """
## os.ring  Ring
置き場・src/queue.mln の Ring
形：リング（枠 SLOTS、読む head、書く tail）
フィールド head：次に読む
フィールド tail：次に書く
操作 push 入れる：tail に書く｜O(1)
不変：head と tail は SLOTS より小さい

## os.copy  要求の列
置き場・src/queue.mln の Ring
形：[[os.ring]]
フィールド head：
フィールド tail：

## os.state  State
列挙・src/queue.mln の State
状態の欄：Job.state
移る はじめ → Idle：reset
移る Idle → Busy：start
移る Busy → Done：finish
"""


class DsaTest(AtlasTest):
    def setUp(self):
        super().setUp()
        self.fx.edit('src/queue.mln', 'namespace queue;\n', 'namespace queue;\n' + DSA_CODE)
        self.fx.write(self.fx.docs / 'layers' / 'os.md', (self.fx.docs / 'layers' / 'os.md').read_text(encoding='utf-8') + DSA_NODES)

    def test_shapes_and_states_come_from_the_code(self):
        rep, (_, _, nodes, _, _) = self.fx.check()
        self.assertEqual(self.messages(rep), [])
        shape = nodes['os.ring']['shape']
        self.assertEqual((shape['kind'], shape['roles']['n'], shape['roles']['read']), ('ring', {'name': 'SLOTS', 'num': 8}, {'name': 'head'}))
        self.assertEqual(nodes['os.copy']['shape'], {'of': 'os.ring'})
        self.assertEqual([v for v, _ in nodes['os.state']['values']], ['Idle', 'Busy', 'Done'])
        self.assertEqual([m['to'] for m in nodes['os.state']['states']['moves']], ['Idle', 'Busy', 'Done'])

    def test_a_move_the_text_leaves_out_is_reported(self):
        self.fx.edit('docs/atlas/layers/os.md', '移る はじめ → Idle：reset\n', '')
        rep, _ = self.fx.check()
        self.assertIn('os.state: reset も Job.state を Idle にするが、移る に無い', self.messages(rep, 'warning'))

    def test_a_move_the_code_does_not_make_is_an_error(self):
        self.fx.edit('docs/atlas/layers/os.md', '移る Busy → Done：finish', '移る Busy → Done：finish・start')
        rep, _ = self.fx.check()
        self.assertIn('os.state: start は Job.state を Done にしていない', self.messages(rep))

    def test_names_sizes_operations_and_invariants_are_checked(self):
        self.fx.edit('docs/atlas/layers/os.md', '枠 SLOTS、', '枠 SIZE、')
        self.fx.edit('docs/atlas/layers/os.md', '操作 push 入れる', '操作 pull 回す')
        self.fx.edit('docs/atlas/layers/os.md', '不変：head と tail は SLOTS より小さい', '不変：length は SLOTS より小さい')
        rep, _ = self.fx.check()
        errors = self.messages(rep)
        self.assertIn('os.ring: src/queue.mln に SIZE の大きさが無い（定数・配列・entity の max）', errors)
        self.assertTrue(any('操作 pull は src/queue.mln の関数に無い' in m for m in errors))
        self.assertTrue(any('操作 pull の 回す は、ring では 入れる・出す のどれか' in m for m in errors))
        self.assertIn('os.ring: 不変の length が src/queue.mln に無い', errors)

    def test_a_step_names_what_it_does_to_a_structure(self):
        self.fx.edit('docs/atlas/flows/send.md', '   アプリが列に入れる\n', '   アプリが列に入れる\n   操作：[[os.copy]] 入れる／[[os.push]] 入れる\n')
        rep, (_, _, _, flows, _) = self.fx.check()
        self.assertEqual(flows[0]['steps'][0]['ops'], [{'node': 'os.copy', 'kind': '入れる'}, {'node': 'os.push', 'kind': '入れる'}])
        self.assertIn('手順の操作 [[os.push]] は、形のある節にする', self.messages(rep))


class CodeTest(unittest.TestCase):
    def test_mylang_function_skips_calls_and_comments(self):
        text = '// f(x) { is a comment\nvoid g() { f(1); }\ni32 f(i32 x) {\n  return x;\n}\n'
        self.assertEqual(code_mylang.find_function(text, 'f'), 'i32 f(i32 x)')
        self.assertEqual(code_mylang.params_of('void (borrow T t) show(i32 a, Map<K, V> m)'), ['t', 'a', 'm'])

    def test_rust_parameters_are_names_not_types(self):
        self.assertEqual(code_rust.params_of('fn f(&mut self, a: u32, mut b: Vec<(u8, u8)>) -> Result<(), E>'),
                         ['self', 'a', 'b'])

    def test_a_field_run(self):
        self.assertEqual(field_matches('a0 … a2', ['a0', 'a1', 'a2', 'a3']), ['a0', 'a1', 'a2'])
        self.assertEqual(field_matches('*s0', ['*s0']), ['*s0'])


if __name__ == '__main__':
    unittest.main()
