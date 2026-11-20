// Classic-script copy (no modules, so it loads from any origin): window.JOURNEYS.
(function () {
'use strict';
// ---- from data-journey/js/journeys.js
// The two data journeys, built from ATLAS. Each journey is a grid:
//   columns = the steps of a flow, with its papers opened in place, in order;
//   rows    = the pieces of data (a struct's fields, or the values time passes through);
//   cells   = what that step does to that piece, with the words of the map that say so.
// Nothing here is a fact of its own: every mark points at the map's text (a step label,
// a field text, a node text) or at a line of the source (fetched and shown as it is).

const OPS = {
  fill:  { t: "詰める", cls: "solid", d: "アプリが書く" },
  read:  { t: "読む", cls: "line", d: "読むだけ。値は変えない" },
  copy:  { t: "写す", cls: "solid", d: "別の置き場へコピーする" },
  swap:  { t: "差し替え", cls: "solid", d: "指す先を OS 側の写しに替える" },
  over:  { t: "上書き", cls: "red", d: "アプリの値を捨て、OS が決めた値にする" },
  word:  { t: "#", cls: "word", d: "何語目に入るか（24 語の 1 通）" },
  use:   { t: "使う", cls: "line", d: "中身を見て動きを決める" },
  make:  { t: "作る", cls: "solid", d: "ここで生まれる値" },
  write: { t: "書く", cls: "solid", d: "置き場に書く" },
  add:   { t: "足す", cls: "solid", d: "数に足す" },
  addq:  { t: "足す", cls: "cond", d: "分かれ道。どれか 1 つに足す" },
  back:  { t: "書き戻す", cls: "solid", d: "アプリのメモリへ書き戻す" },
  give:  { t: "返す", cls: "solid", d: "アプリへ返す" },
  get:   { t: "届く", cls: "solid", d: "アプリに届く" },
  ride:  { t: "", cls: "dot", d: "まとめて運ばれる（中身は変わらない）" },
  len:   { t: "長さ", cls: "line", d: "長さとして使う" },
  zero:  { t: "0", cls: "zero", d: "詰めない。0 で埋めて作ったまま" },
  swapq: { t: "差し替え", cls: "cond", d: "書き込み先がある時だけ差し替える（この要求ではしない）" },
  useq:  { t: "使う", cls: "cond", d: "書き込み先がある時だけ使う（この要求ではしない）" },
  backq: { t: "書き戻す", cls: "cond", d: "書き込み先がある時だけ書き戻す（この要求ではしない）" },
};

// Where a value is. The colour is the layer that owns the memory.
const STATES = {
  app:    { name: "アプリのメモリ", layer: "app" },
  osapp:  { name: "OS 側にあるが、まだアプリの値・アプリを指す", layer: "os", stripe: "app" },
  os:     { name: "OS 側", layer: "os" },
  kernel: { name: "カーネルの変数", layer: "kernel" },
  emu:    { name: "エミュレータ（ハードウェア）", layer: "emu" },
};

// ---------------------------------------------------------------- helpers

function makeData(A) {
  const flows = Object.fromEntries(A.flows.map((f) => [f.id, f]));
  const src = (id) => flows[id] || A.papers[id];
  return {
    A,
    src,
    node: (id) => A.nodes[id],
    step: (id, i) => src(id).steps[i],
    box: (id, boxId) => src(id).boxes.find((b) => b.id === boxId),
    field(schemaId, name) {
      const n = A.nodes[schemaId];
      const f = (n && n.fields || []).find((x) => x[1] === name);
      return f ? { type: f[0], name: f[1], text: f[2] } : null;
    },
    title(id) {
      const s = src(id);
      if (flows[id]) return s.tab;
      return s.title;
    },
  };
}

// "a [[x.y]] b" -> plain text with node titles (for tooltips and checks)
function plain(A, text) {
  return String(text || "")
    .replace(/!\[\[([^\]]+)\]\]/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, (_, id) => (A.nodes[id] ? A.nodes[id].title : id))
    .trim();
}

// A source fact: a line of a file in lab/data/src, found by its text when the
// file is fetched, so the line number shown is always the real one.
const S = (path, find, note) => ({ k: "src", path, find, note });
const L = () => ({ k: "label" }); // the step's own label
const F = (field, schema) => ({ k: "field", field, schema }); // a schema field text
const N = (id, part) => ({ k: "node", id, part }); // a node text (part: a phrase it contains)
const D = () => ({ k: "data" }); // the step's data (label, type, note)
const P = (id, name) => ({ k: "param", id, name }); // a parameter text of a node's api

// ---------------------------------------------------------------- UI: Request

const REQ_ROWS = [
  { id: "domain", name: "domain", f: "domain", word: "0" },
  { id: "op", name: "op", f: "op", word: "1" },
  { id: "owner", name: "owner", f: "owner", word: "2", tall: true },
  { id: "a", name: "a0 … a5", f: "a0 … a5", word: "3–8" },
  { id: "s0", name: "*s0", f: "*s0", word: "9" },
  { id: "s1", name: "*s1", f: "*s1", word: "10" },
  { id: "result_out", name: "result_out", f: "result_out", word: "11" },
  { id: "result_size", name: "result_size", f: "result_size", word: "12" },
  { id: "s0_len", name: "s0_len", f: "s0_len", word: "13" },
  { id: "s1_len", name: "s1_len", f: "s1_len", word: "14" },
];

const UI_OUTER = [
  { id: "bytes", name: "文字", sub: "s0・s1 が指す中身", node: "mem.user-strings", until: "ui:7" },
  { id: "pid", name: "pid", sub: "呼んだプロセス", node: "kernel.os-call", tf: { node: "os.gateway", param: "pid" }, until: "os.gateway:1" },
  { id: "reply_ch", name: "reply_ch", sub: "返事の channel", node: "gateway.slots", field: "reply_ch", until: "ui:8" },
  { id: "result", name: "結果", sub: "i32 の 1 語", node: "os.serve", tf: { node: "lib.transport", ret: true }, until: "ui:8" },
  { id: "event", name: "Event", sub: "帰りの知らせ", node: "schema.event", until: "ui:10" },
];

// The slot comes before the OS-side Request so that no arrow has to cross a bar:
// the characters go straight down into the slot, the Request passes an empty lane.
const UI_LANES = [
  { id: "user", name: "アプリのメモリ", sub: "ユーザ空間", tone: "app", node: "mem.user-request", rows: 2 },
  { id: "slot", name: "受け皿", sub: "gateway_slots[i]", tone: "os", node: "gateway.slots" },
  { id: "osreq", name: "OS 側の Request", sub: "OS_CALL の中", tone: "os", node: "gateway.read" },
  { id: "words", name: "words[24]", sub: "submit の中", tone: "os", node: "channel.words" },
  { id: "ring", name: "要求の列", sub: "全部のアプリで 1 本", tone: "os", node: "os.request-ring" },
  { id: "svc", name: "service task", sub: "Request m・DOM", tone: "os", node: "ctx.service" },
];

// One entry per column, in the order things happen. `c` = cells by row id.
// Each cell: [op, state-from-here-on, why[], value?, extra?]
function uiColumns() {
  const all = ["domain", "op", "owner", "a", "s0", "s1", "result_out", "result_size", "s0_len", "s1_len"];
  const each = (op, state, why, extra) => Object.fromEntries(all.map((r) => [r, [op, state, why, extra]]));
  return [
    {
      ref: ["ui", 0], head: ["値が", "変わった"], ctx: "user", place: null,
      c: { bytes: ["make", "app", [L(), N("app.tasks-view", "変わった属性だけ")], { t: "変わる" }] },
    },
    {
      ref: ["ui", 1], head: ["詰める"], ctx: "user", place: "user",
      c: {
        domain: ["fill", "app", [L(), F("domain")], { v: "UI" }],
        op: ["fill", "app", [L(), F("op")], { v: "SET_TEXT" }],
        owner: ["fill", "app", [D(), F("owner"), S("system/MyAppFramework/src/runtime/runtime.unsafe.mln", "request.owner = current_owner;", "runtime.send が入れる値")]],
        a: ["fill", "app", [L(), F("a0 … a5")], { v: "a0 = ノード" }],
        s0: ["fill", "app", [L(), F("*s0")], { v: "→ 文字" }],
        s1: ["zero", "app", [S("system/MyAppFramework/src/runtime/runtime.unsafe.mln", 'request.s1 = "";', 'ui_request が空の文字 "" を指させる')], { t: '""', v: '→ ""（空の文字）' }],
        result_out: ["zero", "app", [S("system/MyAppFramework/src/runtime/runtime.unsafe.mln", "Request request = Request {};", "ui_request は 0 で埋めて作る")], { t: "0", v: "0（書き込み先なし）" }],
        result_size: ["zero", "app", [S("system/MyAppFramework/src/runtime/runtime.unsafe.mln", "Request request = Request {};", "ui_request は 0 で埋めて作る")], { t: "0", v: "0" }],
        s1_len: ["zero", "app", [S("system/MyAppFramework/src/runtime/runtime.unsafe.mln", "Request request = Request {};", "ui_request は 0 で埋めて作る")], { t: "0", v: "0" }],
        s0_len: ["fill", "app", [D(), F("s0_len")]],
        bytes: ["ride", "app", [L(), N("mem.user-strings")]],
      },
      colNote: "s1・result_out などは 0 のまま",
      note: "地図の「渡すデータ」に無い s1・result_out・result_size・s1_len は詰めない。runtime.ui_request が 0 で埋めて作った Request のまま（s1 は空の文字 \"\" を指す）。",
    },
    {
      ref: ["ui", 2], head: ["OS_CALL"], mono: true, ctx: "user", place: "user",
      ann: { sec: "lanes", t: "アドレスだけ" },
      colNote: "アドレスだけ渡る", c: {},
    },
    {
      ref: ["ui", 3], head: ["pid を", "付ける"], ctx: "sys", place: "user",
      c: { pid: ["make", "os", [L(), N("kernel.os-call", "pid を付けて")], { t: "付ける" }] },
    },
    {
      ref: ["os.gateway", 0], head: ["13 語を", "読む"], ctx: "sys", place: "osreq",
      ann: { sec: "req", t: "↓ 境界を越える" },
      c: Object.assign(each("copy", "os", [L(), N("gateway.read")]), {
        owner: ["copy", "osapp", [L(), F("owner")], { why2: "まだアプリが書いた値" }],
        s0: ["copy", "osapp", [L(), P("gateway.copy", "request")], { why2: "まだアプリのメモリを指す" }],
        s1: ["copy", "osapp", [L(), P("gateway.copy", "request")], { why2: "まだアプリのメモリを指す" }],
        result_out: ["copy", "os", [L(), F("result_out")], { why2: "この要求では 0。指す先は無い" }],
      }),
      colNote: "境界を越える：OS 側に写す",
      drift: "words",
    },
    {
      ref: ["os.gateway", 1], head: ["owner", "= pid"], mono: true, ctx: "sys", place: "osreq",
      security: true,
      c: {
        owner: ["over", "os", [L(), N("gateway.owner"), F("owner"), S("system/MyOS/src/ipc/gateway.unsafe.mln", "request.owner = (i32)pid;")], { v: "pid" }],
        pid: ["use", "os", [L()], { t: "→ owner" }],
      },
    },
    { ref: ["os.gateway", 2], narrow: true, tiny: "呼ぶ", ctx: "sys", place: "osreq", c: {} },
    {
      ref: ["os.gateway", 3], head: ["文字を", "読む"], ctx: "sys", place: "osreq",
      c: {
        s0: ["read", "osapp", [L(), D()], { t: "指す先" }],
        s1: ["read", "osapp", [L(), D()], { t: "指す先" }],
        s0_len: ["len", "os", [D(), F("s0_len")]],
        s1_len: ["len", "os", [D(), F("s1_len")]],
        bytes: ["read", "app", [L()]],
      },
    },
    {
      ref: ["os.gateway", 4], head: ["写す"], ctx: "sys", place: "osreq",
      ann: { sec: "outer", t: "↓ 文字も越える" },
      c: {
        s0: ["swap", "os", [L(), N("gateway.copy"), F("*s0")], { v: "→ 受け皿の写し" }],
        s1: ["swap", "os", [L(), N("gateway.copy"), F("*s1")], { v: "→ 受け皿の写し" }],
        bytes: ["copy", "os", [L(), N("gateway.slots")]],
      },
      colNote: "文字が境界を越える",
    },
    { ref: ["os.gateway", 5], narrow: true, tiny: "呼ぶ", ctx: "sys", place: "osreq", c: {} },
    {
      ref: ["os.gateway", 6], head: ["差し", "替え"], ctx: "sys", place: "osreq",
      c: {
        result_out: ["swapq", null, [L(), N("gateway.stage"), F("result_out"), S("system/MyOS/src/ipc/gateway.unsafe.mln", "if (request->result_out != 0 && request->result_size > 0) {", "差し替えるのは、書き込み先がある時だけ")], { v: "0 のまま", why2: "この要求（SET_TEXT）は result_out が 0 なので、差し替えない。書き込み先があれば受け皿の result に替わる" }],
        result_size: ["useq", null, [D(), F("result_size"), S("system/MyOS/src/ipc/gateway.unsafe.mln", "if (request->result_out != 0 && request->result_size > 0) {", "書き込み先がある時だけ見る")], { why2: "この要求では 0 のまま" }],
      },
      colNote: "この要求では何も替わらない",
      drift: "cond",
    },
    {
      ref: ["os.gateway", 7], head: ["並べる"], ctx: "sys", place: "osreq",
      ann: { sec: "req", t: "✓ OS 側の値だけ" },
      c: each("ride", "os", [L()]),
      colNote: "OS 側の値だけになった",
      milestone: true,
    },
    {
      ref: ["os.submit", 0], head: ["語に", "書く"], ctx: "sys", place: "words",
      ann: { sec: "lanes", t: "24 語の 1 通に" },
      c: Object.assign(Object.fromEntries(REQ_ROWS.map((r) => [r.id, ["word", "os", [L(), N("channel.encode")], { t: "#" + r.word }]])), {
        reply_ch: ["word", "os", [L(), N("os.submit"), F("reply_ch", "gateway.slots")], { t: "#15" }],
      }),
      drift: "words",
    },
    {
      ref: ["os.submit", 1], head: ["24 語"], ctx: "sys", place: "words",
      c: Object.assign(each("ride", "os", [L()]), { reply_ch: ["ride", "os", [L()]] }),
    },
    {
      ref: ["os.submit", 2], head: ["列に", "入れる"], ctx: "sys", place: "ring",
      c: Object.assign(each("ride", "os", [L(), N("kernel.ipc-send")]), { reply_ch: ["ride", "os", [L()]] }),
      colNote: "全部のアプリで 1 本の列",
    },
    { ref: ["os.submit", 3], narrow: true, tiny: "通知", ctx: "sys", place: "ring", c: {} },
    { ref: ["ui", 5], narrow: true, tiny: "起こす", ctx: "svc", place: "ring", c: {} },
    {
      ref: ["ui", 6], head: ["取り出す"], ctx: "svc", place: "svc",
      c: Object.assign(each("ride", "os", [L()]), {
        domain: ["use", "os", [L(), F("domain")], { t: "振り分け" }],
        op: ["ride", "os", [D()]],
        reply_ch: ["ride", "os", [L()]],
      }),
    },
    {
      ref: ["ui", 7], head: ["書き", "換える"], ctx: "svc", place: "svc",
      c: {
        op: ["use", "os", [L(), F("op")]],
        a: ["use", "os", [L(), F("a0 … a5")], { t: "ノード" }],
        s0: ["use", "os", [L()], { t: "文字" }],
        owner: ["use", "os", [N("os.ui-protocol", "owner のプロセスのもの"), S("system/MyOS/src/ui/protocol.unsafe.mln", "dom.set_current_owner(Some(Pid(m->owner)));")], { t: "持ち主" }],
        bytes: ["write", "os", [L(), N("os.dom")], { t: "DOM へ" }],
      },
    },
    {
      ref: ["ui", 8], head: ["結果と", "REPLY"], ctx: "svc", place: "user", placeT: "結果が",
      c: {
        owner: ["use", "os", [N("os.serve", "owner のプロセスに REPLY"), S("system/MyOS/src/ipc/channel.unsafe.mln", "scheduler.notify_pid(Pid(m.owner), TransportSignal::REPLY);")], { t: "宛先" }],
        reply_ch: ["use", "os", [N("os.serve", "返事の channel"), S("system/MyOS/src/ipc/channel.unsafe.mln", "ChannelId reply_channel = ChannelId(w[RequestWord::REPLY_CHANNEL]);")], { t: "宛先" }],
        result_out: ["backq", null, [F("result_out"), N("gateway.stage", "書き戻す"), S("system/MyOS/src/ipc/gateway.unsafe.mln", "if ((i32)gateway_slots[i].result_user != 0 && gateway_slots[i].result_size > 0) {", "書き戻すのは、書き込み先を覚えた時だけ（request_gateway.reply）")], { why2: "この要求は result_out が 0 なので、書き戻さない" }],
        result: ["give", "app", [L(), D()], { t: "返す" }],
      },
      end: true,
    },
    {
      ref: ["ui", 9], head: ["TIMER"], mono: true, ctx: "svc", place: "user", placeT: "Event が",
      c: { event: ["get", "app", [L(), D(), N("os.events")], { t: "届く" }] },
    },
    {
      ref: ["ui", 10], head: ["ハンドラ"], ctx: "user", place: "user",
      c: { event: ["use", "app", [L(), N("lib.next")]], bytes: [null, null] },
      loop: true,
    },
  ];
}

function uiAlts() {
  // happen instead of a successful 「入れる」: the ring is full
  return [
    { ref: ["os.gateway", 8], head: ["満杯", "false"], ctx: "sys", place: "osreq", alt: true, c: {} },
    { ref: ["ui", 11], head: ["false"], mono: true, ctx: "sys", place: "osreq", alt: true, c: {} },
    { ref: ["ui", 12], head: ["0 を", "返す"], ctx: "user", place: "user", alt: true, c: {}, colNote: "アプリが出し直す" },
  ];
}

// The place strip: one lane per place, a bar for what is there from one step to
// another, and an arrow where it moves to another place. Bars never cross; only the
// short arrows go between lanes, in the column where the move happens.
//   bar:  { lane, row, from, to, t: [labels, longest first], s: main | thin | faded, note }
//   move: { at, from: [lane, row], to: [lane, row], s: main | thin | addr, t, side, lane }
function uiStrip() {
  return {
    bars: [
      { lane: "user", row: 0, from: "ui:0", to: "os.gateway:4", s: "thin", t: ["文字（s0 が指す。長さは s0_len、NUL で終わらない）", "文字（s0 が指す）", "文字"], note: "s0・s1 が指す文字。長さは s0_len・s1_len で渡る" },
      { lane: "user", row: 1, from: "ui:1", to: "os.gateway:0", s: "main", t: ["Request（アプリが詰めた）", "Request"], note: "アプリのメモリの Request。OS_CALL で渡るのはこのアドレスだけ" },
      { lane: "user", row: 1, from: "os.gateway:0", to: "ui:7", s: "faded", t: ["元の Request（返事を待つ）", "元の Request"], note: "アプリのメモリの Request はそのまま。OS はもう読まない。アプリは返事を待つ" },
      { lane: "user", row: 1, from: "ui:8", to: "ui:8", s: "thin", t: ["結果"], note: "結果の 1 語。アプリは OS_CALL(REPLY) で受け取る" },
      { lane: "user", row: 1, from: "ui:9", to: "ui:10", s: "thin", t: ["Event"], note: "TIMER の Event。アプリは OS_CALL(POLL) で受け取る" },
      { lane: "slot", from: "os.gateway:4", to: "ui:7", s: "thin", t: ["文字の写し（s0 は 1,024 B、s1 は 128 B まで）", "文字の写し"], note: "プロセスごとの受け皿。service task は、アプリのメモリではなくここだけを見る" },
      { lane: "osreq", from: "os.gateway:0", to: "os.submit:0", s: "main", t: ["Request（OS 側に読んだ写し）", "Request（OS 側の写し）", "Request"], note: "gateway が 1 語ずつ読んで作った、OS 側の Request" },
      { lane: "words", from: "os.submit:0", to: "os.submit:1", s: "main", t: ["24 語", "24"], note: "submit の中だけの配列。Request と返事の channel を語にして並べる" },
      { lane: "ring", from: "os.submit:2", to: "ui:6", s: "main", t: ["1 通（24 語）", "1 通"], note: "全部のアプリの要求が並ぶ 1 本の列に入った 1 通" },
      { lane: "svc", from: "ui:6", to: "ui:8", s: "main", t: ["Request m", "m"], note: "列から取り出し、名前のあるフィールドに戻した Request" },
    ],
    moves: [
      { at: "ui:2", from: ["user", 1], to: ["osreq"], s: "addr", t: ["&Request だけ渡る", "&Request"], side: "left", lane: ["osreq"] },
      { at: "os.gateway:0", from: ["user", 1], to: ["osreq"], s: "main" },
      { at: "os.gateway:4", from: ["user", 0], to: ["slot"], s: "thin" },
      { at: "os.submit:0", from: ["osreq"], to: ["words"], s: "main", dx: -4 },
      { at: "os.submit:0", from: ["slot"], to: ["words"], s: "thin", dx: 6, t: ["＋ reply_ch"], side: "left", lane: ["words"], ldx: -11 },
      { at: "os.submit:2", from: ["words"], to: ["ring"], s: "main" },
      { at: "ui:6", from: ["ring"], to: ["svc"], s: "main" },
      { at: "ui:7", from: ["slot"], to: ["svc"], s: "thin", t: ["文字 → DOM"], side: "left", lane: ["words"] },
      { at: "ui:8", from: ["svc"], to: ["user", 1], s: "main", t: ["結果"], side: "right", lane: ["osreq"] },
      { at: "ui:9", from: ["svc"], to: ["user", 1], s: "thin", t: ["Event"], side: "right", lane: ["words"] },
    ],
  };
}

// ---------------------------------------------------------------- CPU: time

const CPU_ROWS = [
  { id: "ticks", name: "tick 数", sub: "時計の上位 24 ビット", group: "clock", node: "emulator.timer.clock", nfield: "tick 数", persist: "emu" },
  { id: "frac", name: "進み", sub: "時計の下位 8 ビット", group: "clock", node: "emulator.timer.clock", nfield: "進み", persist: "emu" },
  { id: "now", name: "now", sub: "今の時刻", group: "charge", node: "charge.read", until: "kernel.cpu-time:5" },
  { id: "spent", name: "spent", sub: "前回からの時間", group: "charge", node: "kernel.charge", tf: { node: "kernel.charge", param: "spent" }, until: "kernel.cpu-time:3" },
  { id: "last", name: "g_clock_charged", sub: "前に足し終えた時刻", group: "charge", node: "kernel.clock-charged", nfield: "g_clock_charged", persist: "kernel" },
  { id: "to", name: "g_charge_to", sub: "今の時間の持ち主", group: "charge", node: "kernel.charge-to", nfield: "g_charge_to", persist: "kernel" },
  { id: "cpu_time", name: "Process.cpu_time", sub: "プロセスの時間", group: "jar", node: "kernel.cpu-counters", nfield: "Process.cpu_time", persist: "kernel" },
  { id: "kernel", name: "g_kernel_time", sub: "OS のスレッドの時間", group: "jar", node: "kernel.cpu-counters", nfield: "g_kernel_time", persist: "kernel" },
  { id: "idle", name: "g_idle_time", sub: "走るものが無い時間", group: "jar", node: "kernel.cpu-counters", nfield: "g_idle_time", persist: "kernel" },
  { id: "c_total", name: "cpu.total", sub: "全部の時間", group: "stats", node: "schema.cputimes", sfield: "total", until: "app.tasks:3" },
  { id: "c_idle", name: "cpu.idle", sub: "idle の時間", group: "stats", node: "schema.cputimes", sfield: "idle", until: "app.tasks:3" },
  { id: "c_kernel", name: "cpu.kernel", sub: "OS のスレッドの時間", group: "stats", node: "schema.cputimes", sfield: "kernel", until: "app.tasks:3" },
  { id: "procs", name: "procs[i].cpu_time", sub: "プロセスごとの時間", group: "stats", node: "schema.procinfo", sfield: "cpu_time", until: "app.tasks:3" },
  { id: "tlast", name: "t.last", sub: "前回の読み", group: "tasks", node: "app.tasks-last", persist: "app" },
  { id: "pct", name: "%", sub: "0〜100 の割合", group: "tasks", node: "app.tasks-share", tf: { node: "app.tasks-share", ret: true }, until: "app.tasks:2" },
  { id: "series", name: "グラフの系列", sub: "CPU・OS・選んだ行", group: "tasks", node: "app.tasks-series", persist: "app" },
];

const CPU_GROUPS = {
  clock: "時計（エミュレータ）",
  charge: "charge_elapsed の値（カーネル）",
  jar: "CPU 時間の置き場（カーネル）",
  stats: "ProcStats（OS → アプリ）",
  tasks: "Tasks の状態（アプリ）",
};

const CPU_LANES = [
  { id: "app", name: "アプリのメモリ", sub: "Tasks の状態", tone: "app", node: "app.tasks-last", rows: 2 },
  { id: "os", name: "OS_CALL の中", sub: "proc_stats.fill", tone: "os", node: "os.proc-stats" },
  { id: "kernel", name: "カーネルの変数", sub: "scheduler", tone: "kernel", node: "kernel.cpu-counters", rows: 2 },
  { id: "emu", name: "エミュレータ", sub: "タイマーの時計", tone: "emu", node: "emulator.timer.clock" },
];

function cpuColumns() {
  const jars = (op, why, extra) => ({ cpu_time: [op, "kernel", why, Object.assign({ t: "足す" }, extra && extra.cpu_time)], kernel: [op, "kernel", why, Object.assign({ t: "足す" }, extra && extra.kernel)], idle: [op, "kernel", why, Object.assign({ t: "足す" }, extra && extra.idle)] });
  const stats = (op, state, why, t) => ({ c_total: [op, state, why, t && { t }], c_idle: [op, state, why, t && { t }], c_kernel: [op, state, why, t && { t }], procs: [op, state, why, t && { t }] });
  return [
    { ref: ["cpu", 0], head: ["tick の", "割り込み"], ctx: "irq", place: "emu", c: {}, phase: 1 },
    { ref: ["cpu", 1], narrow: true, tiny: "呼ぶ", ctx: "irq", place: "kernel", c: {} },
    { ref: ["cpu", 2], narrow: true, tiny: "呼ぶ", ctx: "irq", place: "kernel", c: {} },
    { ref: ["cpu", 3], head: ["区切る"], ctx: "irq", place: "kernel", c: {} },
    {
      ref: ["kernel.cpu-time", 0], head: ["時計を", "読む"], ctx: "irq", place: "kernel",
      c: {
        ticks: ["read", "emu", [L(), D(), N("emulator.timer.clock")]],
        frac: ["read", "emu", [L(), D(), N("emulator.timer.clock")]],
        now: ["make", "kernel", [L(), N("charge.read"), S("system/MyKernel/src/kernel/scheduler.unsafe.mln", "i32 now = mem.read_word(TIMER_ADDR);")], { v: "tick 数 × 256 ＋ 進み" }],
      },
    },
    {
      ref: ["kernel.cpu-time", 1], head: ["now −", "前回"], ctx: "irq", place: "kernel",
      c: {
        now: ["use", "kernel", [D()]],
        last: ["read", "kernel", [D(), N("kernel.clock-charged")]],
        spent: ["make", "kernel", [L(), D(), S("system/MyKernel/src/kernel/scheduler.unsafe.mln", "charge(now - g_clock_charged);")], { v: "now − 前回" }],
      },
    },
    {
      ref: ["kernel.cpu-time", 2], head: ["持ち主"], ctx: "irq", place: "kernel",
      c: { to: ["read", "kernel", [L(), N("kernel.charge-to")]] },
    },
    {
      ref: ["kernel.cpu-time", 3], head: ["足す"], ctx: "irq", place: "kernel",
      ann: { sec: "jar", t: "持ち主で 1 つ" },
      c: Object.assign({ spent: ["use", "kernel", [L(), D()]] }, jars("addq", [L(), N("kernel.charge")], {
        cpu_time: { branch: 0 }, kernel: { branch: 1 }, idle: { branch: 2 },
      })),
      colNote: "持ち主で 1 つ",
    },
    { ref: ["kernel.cpu-time", 4], narrow: true, tiny: "戻る", ctx: "irq", place: "kernel", c: {} },
    {
      ref: ["kernel.cpu-time", 5], head: ["前回 =", "now"], ctx: "irq", place: "kernel",
      c: {
        now: ["use", "kernel", [L()]],
        last: ["write", "kernel", [L(), N("charge.set"), S("system/MyKernel/src/kernel/scheduler.unsafe.mln", "g_clock_charged = now;")], { v: "now" }],
      },
      endsLocal: ["now", "spent"],
    },
    { ref: ["cpu", 6], head: ["毎秒"], ctx: "user", place: "app", c: {}, phase: 2 },
    { ref: ["cpu", 7], head: ["PROC_", "STATS"], mono: true, ctx: "user", place: "app", c: {}, colNote: "アドレスだけ渡る", ann: { sec: "lanes", t: "アドレスだけ" } },
    {
      ref: ["cpu", 8], head: ["先に", "足す"], ctx: "sys", place: "kernel",
      ann: { sec: "jar", t: "もう一度" },
      c: Object.assign(jars("addq", [L(), N("os.proc-stats", "今までの分を足す")]), {
        last: ["write", "kernel", [L(), N("charge.set")], { v: "now" }],
      }),
      colNote: "charge_elapsed をもう一度",
    },
    {
      ref: ["cpu", 9], head: ["まとめる"], ctx: "sys", place: "os",
      c: Object.assign(stats("make", "os", [L(), D()]), {
        cpu_time: ["read", "kernel", [L()], { t: "→ procs" }],
        kernel: ["read", "kernel", [L()], { t: "→ kernel" }],
        idle: ["read", "kernel", [L()], { t: "→ idle" }],
        last: ["read", "kernel", [S("system/MyKernel/src/kernel/scheduler.unsafe.mln", "export i32 cpu_total() { return g_clock_charged - g_clock_base; }", "total は g_clock_charged から出す")], { t: "→ total" }],
        c_total: ["make", "os", [F("total", "schema.cputimes"), S("system/MyOS/src/proc/stats.unsafe.mln", "total: scheduler.cpu_total(),")]],
        c_idle: ["make", "os", [L(), F("idle", "schema.cputimes")]],
        c_kernel: ["make", "os", [L(), F("kernel", "schema.cputimes")]],
        procs: ["make", "os", [L(), F("cpu_time", "schema.procinfo")]],
      }),
    },
    {
      ref: ["cpu", 10], head: ["copy_", "out"], mono: true, ctx: "sys", place: "app",
      ann: { sec: "stats", t: "↑ 境界を越える" },
      c: stats("copy", "app", [L(), N("os.proc-stats", "ユーザメモリへ書き戻す")], "写す"),
      colNote: "境界を越える：アプリへ写す",
    },
    { ref: ["cpu", 11], head: ["受け取る"], ctx: "user", place: "app", c: stats("ride", "app", [L()]) },
    {
      ref: ["app.tasks", 0], head: ["差を", "取る"], ctx: "user", place: "app",
      c: Object.assign(stats("use", "app", [L(), N("app.tasks-share")]), {
        c_total: ["use", "app", [L(), S("system/MyOS/src/apps/tasks.dom.mln", "i32 span = now.cpu.total - t.last.cpu.total;", "全部の時間の差 span")], { t: "span" }],
        c_idle: ["use", "app", [L(), S("system/MyOS/src/apps/tasks.dom.mln", "t.record(CPU_SERIES, share(span - (now.cpu.idle - t.last.cpu.idle), span));", "CPU 全体 = span − idle の差")], { t: "CPU" }],
        c_kernel: ["use", "app", [L(), S("system/MyOS/src/apps/tasks.dom.mln", "t.record(OS_SERIES, share(now.cpu.kernel - t.last.cpu.kernel, span));", "OS = kernel の差")], { t: "OS" }],
        procs: ["use", "app", [L(), S("system/MyOS/src/apps/tasks.dom.mln", "Some(series) -> ({ t.record(series, share(p.cpu_time - t.time_before(p.pid), span)); });", "各プロセス = cpu_time の差")], { t: "各行" }],
        pct: ["make", "app", [L(), N("app.tasks-share"), S("system/MyOS/src/apps/tasks.dom.mln", "i32 percent = (part * 100 + span / 2) / span;")], { v: "0〜100" }],
      }),
    },
    {
      ref: ["app.tasks", 1], head: ["前回"], ctx: "user", place: "app",
      c: { tlast: ["read", "app", [L(), N("app.tasks-last")]] },
    },
    {
      ref: ["app.tasks", 2], head: ["系列に", "足す"], ctx: "user", place: "app",
      c: { pct: ["use", "app", [L(), D()]], series: ["add", "app", [L(), N("app.tasks-series")]] },
    },
    {
      ref: ["app.tasks", 3], head: ["t.last", "= now"], mono: true, ctx: "user", place: "app",
      c: Object.assign(stats("ride", "app", [L()]), { tlast: ["write", "app", [L(), N("app.tasks-last")], { v: "now" }] }),
      endsLocal: ["c_total", "c_idle", "c_kernel", "procs", "pct"],
    },
    {
      ref: ["app.tasks", 4], head: ["移す"], ctx: "user", place: "app",
      c: {
        series: ["use", "app", [L(), N("app.tasks-show")], { t: "移す" }],
        tlast: ["use", "app", [L(), S("system/MyOS/src/apps/tasks.dom.mln", "ProcStats now = t.last;", "表は t.last から作る")], { t: "表" }],
      },
      next: { journey: "ui", col: "ui:0", text: "UI の要求へ：変わった値が Request の s0 になる" },
    },
  ];
}

function cpuStrip() {
  return {
    bars: [
      { lane: "app", row: 0, from: "cpu:10", to: "app.tasks:3", s: "main", t: ["ProcStats（今の読み → t.last）", "ProcStats（now）", "ProcStats"], note: "copy_out で届いた ProcStats。差を取ったあと t.last になる" },
      { lane: "app", row: 1, from: "app.tasks:0", to: "app.tasks:4", s: "thin", t: ["% → グラフの系列", "% → 系列", "%"], note: "差から出した割合を、系列に 1 つ足す" },
      { lane: "os", from: "cpu:9", to: "cpu:10", s: "main", t: ["ProcStats（out）", "out"], note: "fill が OS 側で作る ProcStats" },
      { lane: "kernel", row: 0, from: "cpu:0", to: "app.tasks:4", s: "faded", t: ["CPU 時間の置き場　Process.cpu_time・g_kernel_time・g_idle_time（足した数が残る）", "CPU 時間の置き場（足した数が残る）", "置き場"], note: "Process.cpu_time・g_kernel_time・g_idle_time。足した数は、次に足すまでそのまま" },
      { lane: "kernel", row: 1, from: "kernel.cpu-time:0", to: "kernel.cpu-time:5", s: "main", t: ["now → spent（charge_elapsed の中だけ）", "now → spent", "now"], note: "時計の 1 語から now、now − 前回 から spent" },
      { lane: "kernel", row: 1, from: "cpu:8", to: "cpu:8", s: "thin", t: ["もう一度", "再び"], note: "fill が先に charge_elapsed を呼ぶ" },
      { lane: "emu", from: "cpu:0", to: "app.tasks:4", s: "faded", t: ["時計の 1 語（tick 数・進み）　いつも進む", "時計の 1 語", "時計"], note: "タイマーの時計は止まらずに進む" },
    ],
    moves: [
      { at: "cpu:0", from: ["emu"], to: ["kernel", 1], s: "addr", t: ["割り込み"], side: "right", lane: ["kernel", 1] },
      { at: "kernel.cpu-time:0", from: ["emu"], to: ["kernel", 1], s: "main", t: ["1 語読む"], side: "left", lane: ["kernel", 1] },
      { at: "kernel.cpu-time:3", from: ["kernel", 1], to: ["kernel", 0], s: "main" },
      { at: "cpu:7", from: ["app", 0], to: ["os"], s: "addr", t: ["&ProcStatsArgs だけ渡る", "&ProcStatsArgs"], side: "left", lane: ["os"] },
      { at: "cpu:8", from: ["kernel", 1], to: ["kernel", 0], s: "main" },
      { at: "cpu:9", from: ["kernel", 0], to: ["os"], s: "main", t: ["読む"], side: "left", lane: ["os"] },
      { at: "cpu:10", from: ["os"], to: ["app", 0], s: "main", t: ["copy_out"], side: "right", lane: ["os"] },
      { at: "app.tasks:0", from: ["app", 0], to: ["app", 1], s: "thin" },
    ],
  };
}

// ---------------------------------------------------------------- build

function kindName(kind) {
  return { call: "呼び出し", syscall: "syscall", msg: "列を通す", signal: "通知", data: "読み書き", return: "戻り" }[kind] || kind;
}

const rowsCovering = { "schema.event": "event" };

function buildColumns(D, specs, journeyId) {
  const out = [];
  let n = 0;
  for (const s of specs) {
    const [srcId, i] = s.ref;
    const st = D.step(srcId, i);
    if (!st) { console.warn("missing step", s.ref); continue; }
    if (!s.alt) n += 1;
    const key = srcId + ":" + i;
    const fromBox = D.box(srcId, st.from), toBox = D.box(srcId, st.to);
    const col = Object.assign({}, s, {
      key, src: srcId, i, n: s.alt ? null : n, step: st,
      kind: st.kind, verb: st.verb || "", label: st.label || "", data: st.data || null,
      from: fromBox, to: toBox,
      paper: D.A.papers[srcId] ? srcId : null,
      cells: {},
      checks: [],
    });
    for (const [rowId, cell] of Object.entries(s.c || {})) {
      const [op, state, why, extra] = cell;
      col.cells[rowId] = { op, state, why: why || [], extra: extra || {} };
      // keep the marks honest: a field the step's data names should be marked, and
      // a phrase cited from a node text must still be in it.
      for (const w of why || []) {
        if (w.k === "param") {
          const n = D.node(w.id), ps = (n && n.api && n.api.params) || [];
          if (!ps.some((p) => p[0] === w.name)) col.checks.push(`${w.id} に引数 ${w.name} が無い`);
        }
        if (w.k === "node" && w.part) {
          const t = plain(D.A, (D.node(w.id) || {}).text);
          if (!t.includes(w.part)) col.checks.push(`${w.id} の文に「${w.part}」が無い`);
        }
      }
    }
    if (s.drift && DRIFT[s.drift]) {
      for (const m of DRIFT[s.drift].map) {
        const src = m.node ? plain(D.A, (D.node(m.node) || {}).text) : ((D.field(m.field[0], m.field[1]) || {}).text || "");
        if (!src.includes(m.text)) col.checks.push(`地図の文が変わった：「${m.text}」`);
      }
    }
    const covered = st.data && st.data.schema && rowsCovering[st.data.schema] && col.cells[rowsCovering[st.data.schema]];
    if (st.data && st.data.fields && !covered) {
      for (const f of st.data.fields) {
        const hit = Object.entries(col.cells).some(([rid, c]) => c.op && rowMatches(rid, f));
        if (!hit) col.checks.push(`渡すデータの ${f} に印が無い`);
      }
    }
    out.push(col);
  }
  return out;
}

function rowMatches(rowId, fieldName) {
  const map = { domain: "domain", op: "op", owner: "owner", a: "a0 … a5", s0: "*s0", s1: "*s1", result_out: "result_out", result_size: "result_size", s0_len: "s0_len", s1_len: "s1_len" };
  if (map[rowId] === fieldName) return true;
  // the cpu journey's data names fields of other shapes
  const cpu = { ticks: "tick 数", frac: "進み", c_total: "cpu", c_idle: "cpu", c_kernel: "cpu", procs: "procs[16]" };
  return cpu[rowId] === fieldName;
}

function textFrom(A, tf) {
  const n = A.nodes[tf.node];
  if (!n) return "";
  if (tf.param) { const p = ((n.api && n.api.params) || []).find((x) => x[0] === tf.param); return p ? plain(A, p[1]) : ""; }
  if (tf.ret) return plain(A, (n.api && (n.api.ret || n.api.returns)) || "");
  return plain(A, n.text);
}

function buildJourneys(A) {
  const D = makeData(A);
  const req = A.nodes["schema.request"];

  const uiRows = REQ_ROWS.map((r) => {
    const f = D.field("schema.request", r.f);
    return Object.assign({}, r, { type: f ? f.type : "", text: f ? f.text : "", schema: "schema.request", group: "req", until: "ui:8" });
  }).concat(UI_OUTER.map((r) => {
    const n = A.nodes[r.node];
    let text = n ? plain(A, n.text) : "";
    if (r.field) { const f = D.field(r.node, r.field); if (f) text = f.text; }
    if (r.tf) text = textFrom(A, r.tf) || text;
    return Object.assign({}, r, { group: "outer", text, type: "" });
  }));

  const ui = {
    id: "ui", flow: D.src("ui"), title: "UI の要求", subject: "Request", subjectNode: "schema.request",
    lead: "Request（アプリが OS に出す要求の封筒）の 10 個のフィールドを、手順ごとに追う。",
    rows: uiRows,
    groups: { req: "Request のフィールド", outer: "Request の外から加わるもの" },
    lanes: UI_LANES,
    strip: Object.assign({ lanes: UI_LANES }, uiStrip()),
    cols: buildColumns(D, uiColumns(), "ui"),
    alts: buildColumns(D, uiAlts(), "ui"),
    altAfter: "os.submit:2",
    start: "os.gateway:1",
    subjectText: plain(A, req.text),
  };

  const cpuRows = CPU_ROWS.map((r) => {
    const n = A.nodes[r.node];
    let type = "", text = n ? plain(A, n.text) : "";
    if (r.nfield) { const f = (n.fields || []).find((x) => x[1] === r.nfield); if (f) { type = f[0]; text = f[2]; } }
    if (r.sfield) { const f = D.field(r.node, r.sfield); if (f) { type = f.type; text = f.text; } }
    if (r.tf) text = textFrom(A, r.tf) || text;
    return Object.assign({}, r, { type, text });
  });

  const cpu = {
    id: "cpu", flow: D.src("cpu"), title: "CPU 時間", subject: "CPU 時間",
    lead: "時計の 1 語が、CPU 時間の数になり、タスクマネージャの % になるまで。",
    rows: cpuRows,
    groups: CPU_GROUPS,
    lanes: CPU_LANES,
    strip: Object.assign({ lanes: CPU_LANES }, cpuStrip()),
    cols: buildColumns(D, cpuColumns(), "cpu"),
    alts: [],
    start: "kernel.cpu-time:3",
  };

  return { ui, cpu, D };
}

// The map's own words about the Request's words, and what the code says. Shown
// where the map counts them, so the reader can see both.
const DRIFT = {
  words: {
    title: "地図とコードで、語の数が違う",
    map: [
      { node: "gateway.read", text: "ユーザメモリから 13 語を 1 語ずつ読み" },
      { node: "channel.encode", text: "0〜12 語目に、返事の channel を 13 語目に書く" },
    ],
    count: "schema.request のフィールドは 15 語ある（a0 … a5 は 6 語）。地図の 13 語には s0_len・s1_len が入っていない。",
    code: [
      { path: "system/MyOS/src/ipc/channel.unsafe.mln", find: "export const i32 REQUEST_WORD_COUNT = RequestWord::REPLY_CHANNEL;", note: "RequestWord：S1_LEN が 14、REPLY_CHANNEL が 15" },
      { path: "system/MyOS/src/ipc/gateway.unsafe.mln", find: " * @param user_request User-space address of a 15-word Request.", note: "読む側のコメントは 15 語" },
    ],
    shown: "この表の #n は、コードの RequestWord の順。",
  },
  cond: {
    title: "地図は「差し替える」とだけ書く。コードは書き込み先がある時だけ",
    map: [
      { node: "gateway.stage", text: "結果の書き込み先（result_out と、TEXT_COPY の出力先）を gateway_slots[i] の受け皿に差し替え" },
      { field: ["schema.request", "result_out"], text: "gateway が OS 側の buffer に差し替え、返事で書き戻す" },
    ],
    count: "この要求（send_text の SET_TEXT）は result_out を詰めないので 0。差し替えも、返事の時の書き戻しも起きない。",
    code: [
      { path: "system/MyOS/src/ipc/gateway.unsafe.mln", find: "if (request->result_out != 0 && request->result_size > 0) {", note: "差し替えるのは result_out が 0 でなく、長さがある時だけ" },
      { path: "system/MyAppFramework/src/runtime/runtime.unsafe.mln", find: "Request request = Request {};", note: "ui_request は 0 で埋めて作る（send_text は result_out を詰めない）" },
    ],
    shown: "この表は SET_TEXT の要求を追うので、手順 11 と 20 の印は点線（この要求ではしない）。",
  },
};


window.JOURNEYS = { makeData, plain, buildJourneys, OPS, STATES, DRIFT, kindName };
})();
