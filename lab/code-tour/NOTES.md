# コードと歩く（code-tour）

流れの手順と、その手順が起きる本物のコードを横に並べて読む試作。

## アイデア

左は流れの手順を縦に並べた線路。右はソースファイルそのもの（行番号・色分け付き）。
手順を 1 つ進めると、右がその手順のコードに移り、起きる行の真下に吹き出しが出る。
地図の箱と矢印を眺める代わりに、「この行で呼んで、次はこのファイルのこの関数へ」を
コードの上で順にたどる。

- 吹き出しには、手順の番号・動詞・from → to・手順の文、行の確かさ、走る文脈、記録での回数、着く先を載せる。
- 手順の文に出てくる名前（`owner`、`pid`、`SET_TEXT` …）を、コードの中で黄色の印にする。
- 箱の中に紙がある手順では、Enter で紙の手順に入る。紙は線路の中に字下げして開き、Esc で外に戻る。
  紙の中の紙（gateway の中の submit）も同じように開く。

## 使い方

- 開く：`lab/serve.sh` → `http://127.0.0.1:8765/code-tour/`
- エディタで開くボタンが要るとき：`python3 lab/code-tour/server.py`（serve.sh と同じく lab を配る。既定 8765。
  serve.sh が動いていれば止めるか、`server.py 8766` のように別のポートを渡す）。
  ファイルの見出しに「エディタで開く」が出て、`code -g <root>/<path>:<line>` で今の行を開く。
- はじめて開くと、地図が最初に見せる手順（UI の要求は 5「並べる」）を開く。その手順には「地図のはじめ」の札が付き、
  流れの題の下に「地図のはじめ（手順 5）を開いています · 1 から見る」と出る。
- 「最初から歩く」：手順 1 から約 4 秒ごとに進み、紙があれば 1 度だけ中へ入って出てくる（UI は 28 か所、CPU は 23 か所）。
  動かしたあとは「ここから歩く」になり、横の ↺ で最初から歩き直せる。歩いている間は「止める 5 / 28」のように今の位置を出す。
- キー：`←` `→` 手順、`Enter` 中の紙へ、`Esc` 寄り道や紙から戻る、`Space` 歩く・止める、`Home` 最初の手順、`End` 最後の手順。
- クリック：手順の行、上の層の図（手順の列）、「通るファイル」の駅、渡すデータのチップ（構造体を開いて欄に印）、
  文中のリンク、吹き出しの「着く先」。どれも右のコードを開く。
- アドレスが今の場所を持つ：`#ui:3/os.gateway:1` は「UI の要求」の 4 から gateway の紙の 2。

## 行の確かさ（4 段）

紙の重なりを除いた 49 手順のうち、42 手順で行を指す。

| 表示 | 数 | どこから |
|---|---|---|
| 起きる行（濃い帯） | 13 | code.json の手順の行（確かめたもの）10、文 1 つの箱（`owner = pid` など）の文の行 3 |
| たぶんここ（点線の帯） | 28 | 手順の文や紙から推した行。吹き出しに手がかりを書く（例「文の SET_TEXT」「中の紙の 4 と同じ行」） |
| 欄（橙の帯） | 1 | 構造体の箱で、手順が挙げる欄（gateway_slots の s0・s1） |
| 箱のコード全体 | 7 | 手がかりが無い。多くは関数全体がその手順（ipc.send、read_user_request など） |

推し方は `lines.js` に 12 の決まりとして書いた（上から順に試す）：

1. 文の式：手順の文の `t.last = now` がある行
2. 文が呼ぶ名前：文の `runtime.send` を呼ぶ行
3. 中の紙：外の手順と同じ動きを紙が描いていれば、その紙の手順の行（CPU 6 → 104）。紙の口の箱を呼ぶ行（UI 5 → submit を呼ぶ 215）
4. 箱の名前で分かれる行：`if (sys_nr == Syscall::OS_CALL)`
5. 列を通す手順は、箱が send を呼ぶ行
6. 文の目立つ名前（`_` を含むか 4 字以上の大文字：REQUEST、SET_TEXT）が多く載る行。箱 → from の箱 → 紙の関数 →
   同じファイルで箱が呼ぶ関数、または箱の変数を使う関数の順に探す（UI 8 は handle が呼ぶ run_request の 84 行）
7. 構造体の箱は、手順が挙げる欄
8. 置き場から読む手順は、行き先の関数がその名前を読む行（`case g_charge_to of`）
9. 置き場へ書く手順は、出どころの関数がその名前に代入する行
10. 戻りは箱の最後の `return`
11. 渡すデータを作る行（`CpuTimes {`）
12. 紙の中の呼び出しは、紙の関数がその関数を呼ぶ行（`stage_request_outputs(i, &request)`）

見つけた行のある関数を帯にする（例：UI 6 は要求の列の箱だが、行 138 は request_channel.submit の中なので submit を帯にし、
吹き出しに「request_channel.submit の中」と書く）。どの関数にも入らない行は、箱の帯を残して「run_request の中（ui_protocol.handle が呼ぶ）」と書く。
28 の行はすべてソースを読んで確かめた（下の表）。

## レビューのあとで変えたこと

- **はじめと自動で歩く**：自動で歩くは、まだ動かしていなければ手順 1 から歩く（UI 28 か所、CPU 23 か所）。
  ボタンは「最初から歩く」／「ここから歩く」＋ ↺ と、今どちらかを言う。はじめの手順に「地図のはじめ」の札、
  題の下に「1 から見る」。下のキーの説明に Home・End を足した。
- **行を指す手順を増やした**：「箱のコード全体」は 36 → 7。上の 4 段と 12 の決まり。推した行は点線と「たぶんここ」で、
  確かな行と見分けられる。レビューの例はすべて直った（UI 3 → 35、UI 6 → 138、CPU 6 → charge() の 104、
  Tasks.tick 4 → `t.last = now;` の 125、CPU 5 → 110）。
- **貼り付いた関数の頭**：起きる行や印と重なっても透けない（`.ln.sig.main` などに不透明な下地）。
  関数の最後の行の 1 行前で離れ、閉じ括弧に乗らない。
- **紙の見出し**：1 行に収め、長い題は … で切る（全体はツールチップ）。入れ子の字下げを減らし（26 px → 中は 8 px）、
  紙の中の手順の番号の欄も細くした。見出しは線路の上に貼り付き、入れ子の紙の見出しはその下に重なる。
  紙の奥の手順でも、どの紙の中かが常に見える。
- **記録の回数**：「記録：request_gateway.request に 2 回 · editor」のように関数の名前を入れた。数えるのは
  手順の文脈に合うスレッドの分だけ（アプリのプロセス＝アプリのスレッドで OS の外、OS_CALL の中＝アプリのスレッドで OS の中、
  service task＝OS のスレッド、割り込み＝どれでも）。submit の紙の ipc.send は 6 回 → 2 回（editor）。ほかの文脈の分はツールチップに書く。
  回数は帯にした関数のもの（置き場の箱には出さない）。
- **動詞の無い手順**：「呼び出し」「読み書き」ではなく、手順の文そのものを題にした（2 行まで）。スマホの札は「→ owner = pid」のように行き先を出す。
- **スマホ**：紙の中では「UI の要求 の 4 › request_gateway.request の中」を出す。タッチの画面ではキーの印（Enter など）を出さない。
  吹き出しは題と文だけにし、残り（行の確かさ・文脈・記録・着く先）は「くわしく」で開く。起きる行をコードの欄の上の方に出す。
- **分かれる**の重なり：「ui_protocol.handle の handle」は「ui_protocol.handle」と出す。

## データについて気づいたこと（export.py へ）

### code.json の手順の行で、誤っていた 4 つ

code.json の `steps` は「from の箱のコードの中で、to の箱の記号の名前が出てくる行」。同じ名前の引数や変数にも当たる。
このページでは、to が関数なら名前が呼び出し（`名前(`）になっている行だけを使い、to が置き場への書き込み
（読み書きの手順）なら、その名前に代入している行を選ぶ。直したのは次の 4 つ：

| 流れ・紙 | 手順 | code.json | ページ | 理由 |
|---|---|---|---|---|
| ui | 2（send_text → request(m)） | elements.mln 586 | 使わない（推した 589 を示す） | `Request request = …` の変数名 `request` に当たっていた |
| os.gateway | 2（read_user_request → owner = pid） | gateway.unsafe.mln 102 | 使わない（箱の文 212 行を示す） | 引数 `request` に当たっていた |
| os.gateway | A（submit → 満杯なら印を付ける） | channel.unsafe.mln 136 | 使わない（推した 216 を示す） | `encode_request_words(request, …)` の引数に当たっていた |
| kernel.cpu-time | 6（前回 = now → g_clock_charged） | scheduler.unsafe.mln 111 | 112 | 111 は読むだけ。書くのは `g_clock_charged = now;` |

ほかに：`app.tasks-last`（t.last）のコードは tasks.dom.mln 109 行（tick の頭）を指す。手順の文が言う `t.last = now;` は 125 行にある。
`emulator.timer.clock` の範囲は 150 行（clock() の頭）だけ。`channel.words` は 134 行（submit の頭）で、`i32 words[24];` は 135 行。

### 推した行（code.json に持たせるとよい）

| 流れ・紙 | 手順 | 行 | 決まり | コード |
|---|---|---|---|---|
| ui | 2 詰める | elements.mln:589 | 文が呼ぶ名前 | `runtime.send(&request);` |
| ui | 3 OS_CALL(REQUEST) | transport.unsafe.mln:35 | 文の目立つ名前 | `while (service_value(OsService::REQUEST, (i32)&m) == 0) {` |
| ui | 4 pid を付ける | syscall.unsafe.mln:484 | 箱の名前で分かれる | `if (sys_nr == Syscall::OS_CALL) {` |
| ui | 5 並べる | gateway.unsafe.mln:215 | 中の紙 | `if (!request_channel.submit(&request, gateway_slots[i].reply_ch)) {` |
| ui | 6 SERVICE で起こす | channel.unsafe.mln:138 | 文の目立つ名前 | `scheduler.notify_armed(KernelSignal::SERVICE);` |
| ui | 8 書き換える | protocol.unsafe.mln:84 | 文の目立つ名前 | `if (op == UiOp::SET_TEXT) { set_text(id, m->s0); … }` |
| ui | 9 結果と REPLY | channel.unsafe.mln:170 | 文の目立つ名前 | `scheduler.notify_pid(Pid(m.owner), TransportSignal::REPLY);` |
| ui | 10 TIMER | events.unsafe.mln:186 | send を呼ぶ | `if (!ipc.send(ch, &w[0])) {` |
| ui | A false | gateway.unsafe.mln:216 | 文の目立つ名前 | `scheduler.arm_notification(TransportSignal::REQUEST_SPACE);` |
| ui | B 0 を返す | transport.unsafe.mln:36 | 文の目立つ名前 | `wait_for(TransportSignal::REQUEST_SPACE);` |
| cpu | 5 時計を読む | scheduler.unsafe.mln:110 | 中の紙 | `i32 now = mem.read_word(TIMER_ADDR);` |
| cpu | 6 足す | scheduler.unsafe.mln:104 | 中の紙 | `None -> ({ g_idle_time = g_idle_time + spent; });` |
| cpu | 8 OS_CALL(PROC_STATS) | process.unsafe.mln:139 | 文の目立つ名前 | `myos_service.call(OsService::PROC_STATS, (i32)(&args));` |
| cpu | 10 読む | stats.unsafe.mln:76 | データを作る | `out.cpu = CpuTimes {` |
| cpu | 12（動詞なし） | process.unsafe.mln:140 | return | `return result;` |
| app.tasks | 1（動詞なし） | tasks.dom.mln:113 | 紙の関数が呼ぶ | `t.record(CPU_SERIES, share(span - (now.cpu.idle - t.last.cpu.idle), span));` |
| app.tasks | 2 前回 | tasks.dom.mln:111 | 置き場を読む | `i32 span = now.cpu.total - t.last.cpu.total;` |
| app.tasks | 3 足す | tasks.dom.mln:113 | 文が呼ぶ名前 | `t.record(CPU_SERIES, share(…));` |
| app.tasks | 4（動詞なし） | tasks.dom.mln:125 | 文の式 | `t.last = now;` |
| app.tasks | 5 移す | tasks.dom.mln:127 | 文が呼ぶ名前 | `t.show();` |
| kernel.cpu-time | 3 持ち主 | scheduler.unsafe.mln:97 | 置き場を読む | `case g_charge_to of {` |
| os.gateway | 5 写す | gateway.unsafe.mln:58・59 | 構造体の欄 | `i32 s0;` `i32 s1;` |
| os.gateway | 6（動詞なし） | gateway.unsafe.mln:214 | 紙の関数が呼ぶ | `stage_request_outputs(i, &request);` |
| os.gateway | 7 差し替え | gateway.unsafe.mln:139 | 文の目立つ名前 | `if (request->result_out != 0 && request->result_size > 0) {` |
| os.gateway | 8 並べる | gateway.unsafe.mln:215 | 紙の関数が呼ぶ | `if (!request_channel.submit(&request, …)) {` |
| os.gateway | A false | gateway.unsafe.mln:216 | 文の目立つ名前 | `scheduler.arm_notification(TransportSignal::REQUEST_SPACE);` |
| os.submit | 1 書く | channel.unsafe.mln:92 | 置き場に書く | `words[RequestWord::DOMAIN] = request->domain;` |
| os.submit | 2（動詞なし） | channel.unsafe.mln:137 | 文が呼ぶ名前 | `if (!ipc.send(g_requests, &words[0])) { return false; }` |
| os.submit | 4 入ったら | channel.unsafe.mln:138 | 文の目立つ名前 | `scheduler.notify_armed(KernelSignal::SERVICE);` |

行が無いまま残る 7 手順：UI 1（view の Label。印は付く）、UI 11（next）、CPU 1（clock の範囲が頭の 1 行だけ）、
CPU 11（copy_out はこの地図のファイルに無い）、gateway の紙 1（read_user_request 全体）、4（copy_request_strings 全体）、submit の紙 3（ipc.send 全体）。

## 動くもの

- 両方の流れ（UI の要求 11 手順、CPU 時間 12 手順）と、4 枚の紙（request_gateway.request、request_channel.submit、
  charge_elapsed、Tasks.tick）、もし（A・B）の手順。54 の場所を 1440×900・1024×768・390×844（タッチ）と暗い画面で歩かせて、
  吹き出しと行が見える位置に来ること、文字が切れないこと、コンソールにエラーが無いことを確かめた。
- コードの表示：見出しが固定されたファイル（層の色、パス、帯の関数と行の範囲、言語と行数）、行番号、
  MyLang（`.dom.mln` の画面の宣言、`.model.mln` の関係、`@annotation`、doc コメントの `@param` も）と Rust の色分け、
  帯（行のある関数）、起きる行（濃い帯）・たぶんここ（点線）・欄（橙）。関数の頭は上に貼り付き、最後の行の手前で離れる。
  右端の細い定規に、帯・行・着く先・黄色の印の位置を出す（クリックでそこへ）。
- 走る文脈：地図の点線の枠（regions）から「走る OS_CALL の中 · アプリのスレッド」などを出す。紙の中は、紙が描かれた箱の枠に従う。
- 記録：trace（Editor で「x」を打った 1 回）で、帯の関数に何回入ったか、どのスレッドだったかを、文脈に合う分だけ出す。
  例：`request_gateway.request` は editor で 2 回、`ui_protocol.handle` は `kernel: compositor.run` で 2 回、`ipc.send` は OS_CALL の中では 2 回。
- 寄り道：渡すデータ（`Request` など）を押すと契約の構造体を開き、手順が挙げる欄（owner、*s0、*s1、result_out）に印を付ける。
  文中のリンクや着く先も開ける。コードの無い箱（service task などの文脈）は、走るもの・カーネルの中か・枠の中の箱を示すカードにする。
- 「詳しく」：箱の説明、シグネチャ、引数、返す値、欄、値、地図が持つ図（切り替えごとに足す（前と今）など）。
- 層の図：手順ごとに from の層から to の層へ線を引いた小さな図。紙の中では紙の帯に切り替わる。はじめの手順の番号に点線。
- 通るファイル：手順の順に、開くファイルを駅のように並べる。今の駅、通った駅、これからの駅。
- 暗い画面（prefers-color-scheme）、狭い画面（手順は横に流れる札、下に前へ・中の紙へ・次へ）。
- server.py：Python の標準ライブラリだけ。code.json に載ったファイルだけを、127.0.0.1 から、
  `X-Code-Tour` ヘッダ付きの要求でだけ開く。`CODE_TOUR_DRY=1` で実行せずに表示だけする（試験はこれで行い、推した行 35 を開くのも確かめた）。

## 動かないもの・限界

- 「たぶんここ」は字句の手がかりで推した行で、構文解析ではない。28 の行は目で確かめたが、データが変われば外れることがある（だから点線で出す）。
- CPU 6 の 104 行は、charge の 3 つの枝（プロセス・カーネル・idle）のうち idle の枝。紙の手順 4 と同じ行を使っている。帯で 3 つとも見える。
- 色分けは手書きの字句解析で、構文解析ではない。`.dom.mln` の画面の宣言は見た目で判断している。
- 開けるのは地図が指す 26 ファイルだけ。コードの中の別の関数（runtime.send、ipc.recv など）へは飛べない。
- 黄色の印は名前の一致にすぎない。同じ名前の別の物にも付く（帯の外では `_` を含む名前と大文字の名前だけに絞った）。
- 記録は Editor で「x」を打った時のもので、タスクマネージャの流れそのものではない（ツールチップに書いた）。
  文脈で数を絞るのは、スレッドの名前（`kernel:` で始まるか）とプログラム（kernel か）による読み方。
- 文脈は地図に枠がある箱だけ。紙の中は、紙が描かれた箱の枠を引き継ぐという読み方をしている。charge_elapsed の紙のように枠の無い箱では、文脈も絞り込みも無い。
- 狭い画面では縦の線路は出さず、横の札と今の手順だけ。
- エディタで開くは server.py の時だけ（serve.sh やスクリーンショットの道具では出ない）。

## 本体のビューアに持ち込めること

1. 手順を選んだら、その手順のコードを起きる行で開き、吹き出しをその行の真下に置く（横の欄ではなく）。手順の文と行が同じ所に並ぶ。
2. 行の確かさを 3 段で見せる：記録された行（濃い帯）、推した行（点線と「たぶんここ」と手がかり）、箱全体。推した行を消すより、手がかりを添えて出すほうが読める。
3. export.py：手順の行の見つけ方を、呼び出し（`名前(`）と代入（`名前 =`）で絞る（上の 4 つが直る）。`lines.js` の 12 の決まりを移すか、上の表の行を code.json に持たせる。
4. `api.sig` が文の箱（owner = pid など）は、その文の行を指す。
5. 記録から「この関数に何回入ったか・どのスレッドか」を、手順の文脈に合う分だけ添える。関数の名前を必ず書く。
6. 「通るファイル」の駅と、層の上り下りの小さな図。はじめの手順の札と「1 から見る」。
7. 手順の文の名前をコードに印で示し、定規にも出す。
8. 最初から歩く（紙には 1 度だけ入って出る）、ここから歩く、↺。`#ui:3/os.gateway:1` の形のアドレス。
9. 入れ子の紙の見出しを線路の上に重ねて貼り付ける。どの紙の中にいるかが常に見える。

## ファイル

- `index.html`、`style.css`、`app.js`（流れ・紙・コード表示・キー・歩く）、`lines.js`（手順が起きる行：確かめ・文の箱・推し方。DOM を使わない）、
  `highlight.js`（MyLang と Rust の字句解析）
- `server.py`（任意。エディタで開く）
- `shots/`：`main.png`（開いたところ：UI の要求 5、gateway の 215 行に「たぶんここ」）、`step-line.png`（UI 8：handle が呼ぶ run_request の 84 行）、
  `paper.png`（gateway の中の submit の 4：入れ子の紙の見出し、138 行）、`data.png`（Request の欄に印）、
  `dark.png`（CPU 6：charge() の 104 行、暗い画面）、`phone.png`（390×844、タッチ）
- ライブラリは使っていない（npm も vendor/ も無し）。
