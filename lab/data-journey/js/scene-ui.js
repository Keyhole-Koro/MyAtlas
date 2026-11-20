import { h, svg, richText } from "./util.js";
import { plain } from "./journeys.js";
import { band, wall, place, actor, card, setCard, token, fly, pulse, overlay, drawArrows, bubble, setBubble, posIn } from "./stagekit.js";

const ROWS = [["domain", "domain"], ["op", "op"], ["owner", "owner"], ["a", "a0 … a5"], ["s0", "*s0"], ["s1", "*s1"], ["result_out", "result_out"], ["result_size", "result_size"], ["s0_len", "s0_len"], ["s1_len", "s1_len"]];
const CODE = (f) => `<code>${f}</code>`;
const fv = (row) => (row ? row.querySelector(".fv") || row : null);

export function uiScene(A, J) {
  const W = 1360, H = 580;
  const ctxSys = plain(A, A.nodes["ctx.syscall"].text);
  const wallText = ctxSys.includes("ユーザメモリの読み書きは") ? "境界：ユーザメモリの読み書きは、OS_CALL の中でコピーして済ませる" : "境界";
  const slots = (A.nodes["kernel.channel"].shape.roles.n || {}).num || 32;
  const msgWords = (A.nodes["kernel.channel"].shape.roles.item || {}).num || 24;
  const slotField = (name) => ((A.nodes["gateway.slots"].fields || []).find((f) => f[1] === name) || [, , ""])[2];
  const capOf = (name) => (slotField(name).match(/（([\d,]+ B)）/) || [, ""])[1];

  // ---------------------------------------------------------------- build
  function build(stage, { onTip }) {
    const E = { stage, places: {} };
    band(stage, "app", 0, 236, "アプリのメモリ", "タスクマネージャのプロセス（ユーザ空間）");
    band(stage, "os", 242, H - 242, "OS 側", "カーネルの権限で走る");
    wall(stage, 239, wallText, "境界（ここから下は OS 側）");

    const P = (id, x, y, w, hh, name) => (E.places[id] = place(stage, id, x, y, w, hh, name));
    P("view", 14, 40, 160, 96, "view() の属性");
    P("appReq", 184, 22, 250, 210, "");
    P("str", 452, 40, 200, 104, "文字（s0 が指す）");
    P("reply", 1096, 36, 252, 86, "返事");
    P("next", 1096, 140, 252, 86, "next() → tick()");
    P("entry", 14, 276, 160, 150, "OS_CALL の入口");
    P("osReq", 184, 264, 250, 210, "");
    P("slot", 452, 276, 200, 140, `受け皿 ${CODE("gateway_slots[i]")}`);
    P("words", 668, 276, 232, 196, `${CODE("words[" + msgWords + "]")}（submit の中）`);
    P("ring", 916, 276, 168, 196, "要求の列");
    P("svc", 1096, 264, 252, 210, "");
    P("dom", 1096, 482, 252, 90, "DOM（OS 側に 1 つ）");
    E.places.appReq.querySelector(".pname").remove();
    E.places.osReq.querySelector(".pname").remove();
    E.places.svc.querySelector(".pname").remove();
    const ph = (id, text) => { const d = h("div", { class: "ph" }, text); E.places[id].appendChild(d); return d; };
    E.ph = { appReq: ph("appReq", "Request はまだ無い"), osReq: ph("osReq", "OS 側の Request はまだ無い"), svc: ph("svc", "service task は SERVICE を待っている"), words: ph("words", "submit の中で作る") };

    // view(): the attribute the Label reads
    E.view = actor(stage, h("div", { class: "valbox app" }, h("div", { class: "vn" }, "Label の text"), h("div", { class: "vv" }, "前の値")), 26, 62);
    E.view.style.minWidth = "136px";

    // the three Requests
    E.appReq = card("Request", "アプリのメモリ", ROWS, 240); actor(stage, E.appReq.el, 189, 26);
    E.osReq = card("Request", "OS 側（gateway の中）", ROWS, 240); actor(stage, E.osReq.el, 189, 268);
    E.svcReq = card("Request m", "service task", ROWS, 240); actor(stage, E.svcReq.el, 1102, 268);
    E.osReq.el.classList.add("os"); E.svcReq.el.classList.add("os"); E.appReq.el.classList.add("app");
    E.badge = h("div", { class: "tok acc" }, "✓ OS 側の値だけ"); actor(stage, E.badge, 262, 478);

    // the characters s0 points at
    const bytes = h("div", { class: "bytes" }); for (let i = 0; i < 8; i++) bytes.appendChild(h("i"));
    E.str = actor(stage, h("div", { class: "valbox app" }, h("div", { class: "vn" }, "s0 が指す文字"), bytes, h("div", { class: "vn", style: "margin-top:4px;white-space:normal;line-height:1.35" }, "長さは s0_len。NUL で終わらない")), 462, 62);
    E.str.style.width = "180px";

    // the slot on the OS side
    const sl = (id, name, cap) => h("div", { class: "sl", "data-sl": id }, h("span", { class: "fn" }, name), h("span", { class: "fv" }, cap));
    E.slot = actor(stage, h("div", { class: "card-r os slotbox" },
      sl("s0", "s0", capOf("s0")), sl("s1", "s1", capOf("s1")), sl("result", "result", capOf("result")), sl("reply_ch", "reply_ch", "返事の channel")), 462, 292);
    E.slot.style.width = "180px";
    E.slotRow = (id) => E.slot.querySelector(`[data-sl="${id}"]`);

    // entry: OS_CALL and the two things it brings
    E.chip = actor(stage, token("OS_CALL(REQUEST)", "mono"), 26, 300);
    E.addr = actor(stage, token("&Request", "mono"), 30, 344);
    E.pid = actor(stage, token("pid", "red mono"), 30, 386);

    // words[24]
    const grid = h("div", { class: "words" });
    for (let i = 0; i < msgWords; i++) {
      const name = i < ROWS.length + 5 ? wordName(i) : i === 15 ? "reply_ch" : "空き";
      const c = h("div", { class: "w" + (i === 15 ? " rc" : i > 15 ? " free" : ""), "data-w": i, title: `${i} 語目：${name}` }, h("b", {}, String(i)), h("span", {}, i < 15 ? shortWord(i) : i === 15 ? "ch" : "0"));
      grid.appendChild(c);
    }
    E.words = actor(stage, h("div", {}, grid, h("div", { class: "vn", style: "font-size:11px;color:var(--text-2);margin-top:4px;line-height:1.4" }, "0〜14：Request　15：返事の channel", h("br"), "16〜23：使わない（0）")), 676, 290);
    E.words.style.width = "220px";
    E.wordCell = (i) => grid.querySelector(`[data-w="${i}"]`);

    // the ring
    const rs = svg("svg", { class: "ring-svg", width: 160, height: 166, viewBox: "0 0 160 170" });
    const cxr = 80, cyr = 88, R = 60;
    E.ringSlots = [];
    for (let i = 0; i < slots; i++) {
      const a = (i / slots) * Math.PI * 2 - Math.PI / 2;
      const x = cxr + Math.cos(a) * R, y = cyr + Math.sin(a) * R;
      const r = svg("rect", { x: x - 5, y: y - 5, width: 10, height: 10, rx: 2.5, class: "slot", transform: `rotate(${(a * 180) / Math.PI + 90} ${x} ${y})` }, rs);
      E.ringSlots.push({ r, x, y });
    }
    svg("text", { x: cxr, y: cyr - 4, "text-anchor": "middle", class: "hd", text: `${slots} 枠` }, rs);
    svg("text", { x: cxr, y: cyr + 12, "text-anchor": "middle", text: `1 枠 ${msgWords} 語` }, rs);
    E.headT = svg("text", { "text-anchor": "middle", class: "hd", text: "head" }, rs);
    E.tailT = svg("text", { "text-anchor": "middle", class: "hd", text: "tail" }, rs);
    E.ring = actor(stage, h("div", {}, rs), 920, 300);
    // where slot 0 is drawn (the svg is 160 x 166 for a 160 x 170 view): a target for flights
    E.slot0 = h("div", { class: "slot-at" });
    Object.assign(E.slot0.style, { left: (E.ringSlots[0].x * 0.976 + 1.9 - 5) + "px", top: (E.ringSlots[0].y * 0.976 - 5) + "px" });
    E.ring.appendChild(E.slot0);
    actor(stage, h("div", { class: "vn", style: "font-size:11px;color:var(--text-3)" }, "全部のアプリで 1 本"), 960, 450);

    // DOM window
    E.domLab = h("div", { class: "lab" }, "Label：前の値");
    E.dom = actor(stage, h("div", { class: "dom-win" }, h("div", { class: "bar" }, "Task Manager"), E.domLab), 1108, 494);
    E.dom.style.width = "228px";

    // reply & next (app side)
    E.replyBox = actor(stage, h("div", { class: "valbox app" }, h("div", { class: "vn" }, "app_transport.request"), h("div", { class: "vv" }, "")), 1108, 56);
    E.replyBox.style.width = "228px";
    E.nextBox = actor(stage, h("div", { class: "valbox app" }, h("div", { class: "vn" }, "runtime.next"), h("div", { class: "vv" }, "")), 1108, 160);
    E.nextBox.style.width = "228px";

    // moving tokens
    E.notify = actor(stage, token("SERVICE", "acc mono"), 1000, 470);
    E.notify.dataset.free = "1";
    E.result = actor(stage, token("結果 1 語", "acc"), 1150, 470);
    E.event = actor(stage, token("Event（TIMER）", "acc"), 1150, 480);

    E.ov = overlay(stage, W, H);
    E.bubble = bubble(stage);
    return E;
  }

  function wordName(i) {
    return ["domain", "op", "owner", "a0", "a1", "a2", "a3", "a4", "a5", "s0", "s1", "result_out", "result_size", "s0_len", "s1_len"][i] || "";
  }
  function shortWord(i) {
    return ["dom", "op", "own", "a0", "a1", "a2", "a3", "a4", "a5", "s0", "s1", "out", "size", "len0", "len1"][i] || "";
  }

  // ---------------------------------------------------------------- state
  const filled = () => ({
    domain: { v: "UI" }, op: { v: "SET_TEXT" }, owner: { v: "アプリが書いた値" }, a: { v: "a0 = ノード" },
    s0: { v: "→ 文字" }, s1: { v: '→ ""', zero: true }, result_out: { v: "0", zero: true }, result_size: { v: "0", zero: true },
    s0_len: { v: "文字の長さ" }, s1_len: { v: "0", zero: true },
  });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function base() {
    return {
      show: { appReq: false, osReq: false, svcReq: false, words: false, str: false, badge: false, addr: false, pid: false, chip: false, notify: false, result: false, event: false },
      dim: {},
      cards: { appReq: { rows: {} }, osReq: { rows: {} }, svcReq: { rows: {} } },
      view: { v: "前の値", lit: false },
      slot: { s0: null, s1: null, result: null, reply_ch: null, lit: [] },
      ring: { filled: [], head: 0, tail: 0 },
      dom: { v: "前の値", lit: false },
      reply: { v: "", lit: false },
      next: { v: "", lit: false },
      lit: [],
      bubble: null,
      arrows: [],
      pos: {},
      focus: [0, W],
    };
  }

  const set = (S, card, id, patch) => { S.cards[card].rows[id] = Object.assign({}, S.cards[card].rows[id] || {}, patch); };
  const clearCls = (S, card) => { for (const r of Object.values(S.cards[card].rows)) delete r.cls; };

  const steps = {
    "ui:0": {
      on(S) { S.view = { v: "新しい値", lit: true }; S.lit = ["view"]; S.focus = [0, 460]; },
      fx(E) { pulse(E.view); },
    },
    "ui:1": {
      sub: "0 で埋めた Request に、send_text が a0 と s0 を、runtime.send が owner を入れる（コード：runtime.unsafe.mln・elements.mln）",
      on(S) {
        S.view.lit = false;
        S.show.appReq = true; S.show.str = true;
        S.cards.appReq.rows = filled();
        for (const k of ["domain", "op", "owner", "a", "s0", "s0_len"]) S.cards.appReq.rows[k].cls = "flash";
        S.arrows = [{ from: "appReq.s0", to: "str", cls: "app" }];
        S.lit = ["appReq"]; S.focus = [170, 660];
      },
    },
    "ui:2": {
      sub: "OS_CALL は REQUEST と、Request のアドレスだけを持って OS に入る",
      on(S) {
        clearCls(S, "appReq");
        S.show.chip = true; S.show.addr = true;
        S.arrows = [{ from: "appReq.s0", to: "str", cls: "app" }, { from: "addr", to: "appReqHead", cls: "ink", side: "right", tside: "left", label: "アドレスだけ" }];
        S.lit = ["entry"]; S.focus = [0, 460];
      },
      fx(E, S, o) { fly(E.stage, E.appReq.el.querySelector(".ch"), E.addr, { speed: o.speed, ghost: () => token("&Request", "mono"), hide: E.addr }); },
    },
    "ui:3": {
      on(S) { S.show.pid = true; S.lit = ["entry"]; S.focus = [0, 460]; },
      fx(E) { pulse(E.pid); },
    },
    "os.gateway:0": {
      sub: "読んだ Request は OS 側にある。でも owner はアプリが書いたまま、s0 はまだアプリの文字を指している（斜線）",
      dur: 3000,
      on(S) {
        S.show.osReq = true;
        S.cards.osReq.rows = filled();
        for (const k of Object.keys(S.cards.osReq.rows)) S.cards.osReq.rows[k].cls = "flash";
        S.cards.osReq.rows.owner.cls = "osapp"; S.cards.osReq.rows.s0.cls = "osapp"; S.cards.osReq.rows.s1.cls = "osapp";
        S.dim.appReq = true;
        S.cards.appReq.sub = "アプリのメモリ（もう読まない）";
        S.arrows = [{ from: "appReq.s0", to: "str", cls: "app", dim: true }, { from: "osReq.s0", to: "str", cls: "app", label: "まだアプリを指す" }];
        S.lit = ["osReq"]; S.focus = [170, 660];
      },
      fx(E, S, o) {
        ROWS.forEach(([id], i) => fly(E.stage, E.appReq.R[id], E.osReq.R[id], { speed: o.speed, delay: i * 90, dur: 700, hide: fv(E.osReq.R[id]) }));
      },
    },
    "os.gateway:1": {
      sub: "ここが要。アプリが owner に何を書いていても、OS_CALL を呼んだプロセスの pid で上書きする",
      dur: 4200,
      on(S) {
        for (const k of Object.keys(S.cards.osReq.rows)) if (S.cards.osReq.rows[k].cls === "flash") delete S.cards.osReq.rows[k].cls;
        set(S, "osReq", "owner", { v: "<s>アプリが書いた値</s>pid", cls: "red" });
        S.show.pid = false;
        S.bubble = { x: 452, y: 424, w: 456, cls: "red", html: securityHtml(A) };
        S.arrows = [{ from: "osReq.s0", to: "str", cls: "app", label: "まだアプリを指す" }];
        S.lit = ["osReq"]; S.focus = [170, 660];
      },
      fx(E, S, o) { fly(E.stage, E.pid, E.osReq.R.owner, { speed: o.speed, dur: 900, ghost: () => token("pid", "red mono"), hide: fv(E.osReq.R.owner) }); },
    },
    "os.gateway:2": {
      on(S) { set(S, "osReq", "owner", { v: "pid", cls: "" }); S.bubble = null; S.focus = [170, 660]; },
    },
    "os.gateway:3": {
      on(S) {
        set(S, "osReq", "s0", { cls: "osapp used" }); set(S, "osReq", "s1", { cls: "osapp used" });
        set(S, "osReq", "s0_len", { cls: "used" }); set(S, "osReq", "s1_len", { cls: "used" });
        S.lit = ["str"]; S.focus = [170, 660];
      },
      fx(E) { pulse(E.str); },
    },
    "os.gateway:4": {
      sub: "文字が境界を越える。s0・s1 は、写しを指すように差し替わる",
      dur: 3000,
      on(S) {
        set(S, "osReq", "s0", { v: "→ 受け皿 s0", cls: "flash" }); set(S, "osReq", "s1", { v: "→ 受け皿 s1", cls: "flash", zero: false });
        set(S, "osReq", "s0_len", { cls: "" }); set(S, "osReq", "s1_len", { cls: "" });
        S.slot.s0 = "文字の写し"; S.slot.s1 = '"" の写し'; S.slot.lit = ["s0", "s1"];
        S.arrows = [{ from: "osReq.s0", to: "slot.s0", cls: "os" }];
        S.lit = ["slot"]; S.focus = [170, 660];
      },
      fx(E, S, o) {
        const bytes = E.str.querySelector(".bytes");
        fly(E.stage, bytes, E.slotRow("s0"), { speed: o.speed, dur: 1000, ghost: () => bytes.cloneNode(true), hide: [fv(E.slotRow("s0")), fv(E.slotRow("s1")), fv(E.osReq.R.s0), fv(E.osReq.R.s1)] });
      },
    },
    "os.gateway:5": { on(S) { set(S, "osReq", "s0", { cls: "" }); set(S, "osReq", "s1", { cls: "" }); S.slot.lit = []; S.focus = [170, 660]; } },
    "os.gateway:6": {
      sub: "この要求（send_text）は result_out を詰めていない（0）。gateway が差し替えるのは、書き込み先がある時だけ（コード：gateway.unsafe.mln の stage_request_outputs）",
      on(S) {
        set(S, "osReq", "result_out", { cls: "used" }); set(S, "osReq", "result_size", { cls: "used" });
        S.slot.lit = ["result"];
        S.bubble = { x: 452, y: 426, w: 380, cls: "drift", html: `<b>! result_out は 0 のまま。何も替わらない</b><span class="k">地図は「差し替える」とだけ書くが、コードが差し替えるのは書き込み先がある時だけ（result_out ≠ 0 かつ result_size > 0）。あれば受け皿の result に替え、元の場所を覚えて返事の時に書き戻す。</span>` };
        S.lit = ["slot"]; S.focus = [170, 760];
      },
    },
    "os.gateway:7": {
      sub: "OS 側の値だけになった Request を、要求の列に並べる（submit の中にも紙がある）",
      on(S) {
        set(S, "osReq", "result_out", { cls: "" }); set(S, "osReq", "result_size", { cls: "" });
        S.slot.lit = []; S.bubble = null;
        S.show.badge = true;
        S.lit = ["osReq"]; S.focus = [170, 900];
      },
      fx(E) { pulse(E.osReq.el); },
    },
    "os.submit:0": {
      dur: 3600,
      on(S) {
        S.show.badge = false; S.show.words = true; S.dim.osReq = true;
        S.slot.lit = ["reply_ch"];
        S.arrows = [];
        S.bubble = { x: 196, y: 480, w: 470, cls: "drift", html: driftHtml(A) };
        S.lit = ["words"]; S.focus = [440, 910];
      },
      fx(E, S, o) {
        // each field becomes its word(s); a0 … a5 are six words
        const map = { domain: [0], op: [1], owner: [2], a: [3, 4, 5, 6, 7, 8], s0: [9], s1: [10], result_out: [11], result_size: [12], s0_len: [13], s1_len: [14] };
        ROWS.forEach(([id], i) => {
          const cells = map[id].map((w) => E.wordCell(w));
          fly(E.stage, E.osReq.R[id].querySelector(".fn"), cells[0], { speed: o.speed, delay: 200 + i * 110, dur: 800, ghost: () => token(id === "a" ? "a0…a5" : id, "mono word-tok"), hide: cells });
        });
        fly(E.stage, E.slotRow("reply_ch").querySelector(".fn"), E.wordCell(15), { speed: o.speed, delay: 200 + ROWS.length * 110, dur: 800, ghost: () => token("reply_ch", "mono word-tok acc"), hide: E.wordCell(15) });
      },
    },
    "os.submit:1": {
      on(S) { S.slot.lit = []; S.bubble = null; S.lit = ["words"]; S.focus = [600, 1090]; },
      fx(E) { pulse(E.words.querySelector(".words")); },
    },
    "os.submit:2": {
      dur: 2800,
      on(S) {
        S.show.words = false;
        S.ring.filled = [0]; S.ring.tail = 1;
        S.lit = ["ring"]; S.focus = [640, 1100];
      },
      fx(E, S, o) { fly(E.stage, E.words.querySelector(".words"), E.slot0, { speed: o.speed, dur: 900, shrink: true, hide: E.ringSlots[0].r }); },
    },
    "os.submit:3": {
      on(S) { S.show.notify = true; S.pos.notify = ["ring", 88, 196]; S.lit = ["ring"]; S.focus = [880, 1360]; },
    },
    "ui:5": {
      on(S) { S.show.notify = true; S.pos.notify = ["svc", 54, 208]; S.lit = ["svc"]; S.focus = [880, 1360]; },
    },
    "ui:6": {
      sub: "列は head から 1 通取り出し、24 語を名前のあるフィールドに戻す。domain が UI なので ui_protocol.handle へ",
      dur: 3000,
      on(S) {
        S.show.notify = false;
        S.ring.filled = []; S.ring.head = 1;
        S.show.svcReq = true;
        const r = filled(); r.owner = { v: "pid" }; r.s0 = { v: "→ 受け皿 s0" }; r.s1 = { v: "→ 受け皿 s1" };
        r.domain.cls = "used";
        S.cards.svcReq.rows = r;
        S.arrows = [{ from: "svcReq.s0", to: "slot.s0", cls: "os", side: "left", tside: "right", dim: true }];
        S.lit = ["svc"]; S.focus = [880, 1360];
      },
      fx(E, S, o) { fly(E.stage, E.slot0, E.svcReq.el, { speed: o.speed, dur: 800, ghost: () => token("24 語", "mono word-tok"), hide: Object.values(E.svcReq.R).map(fv) }); },
    },
    "ui:7": {
      sub: "handle は owner をノードの持ち主にして走り、op（SET_TEXT）・a0（ノード）・s0（受け皿の写し）で DOM を書き換える",
      dur: 3000,
      on(S) {
        clearCls(S, "svcReq");
        for (const k of ["op", "a", "s0", "owner"]) set(S, "svcReq", k, { cls: "used" });
        S.dom = { v: "新しい値", lit: true };
        S.slot.lit = ["s0"];
        S.arrows = [{ from: "svcReq.s0", to: "slot.s0", cls: "os", side: "left", tside: "right" }];
        S.lit = ["dom"]; S.focus = [880, 1360];
      },
      fx(E, S, o) {
        const bytes = E.str.querySelector(".bytes");
        fly(E.stage, E.slotRow("s0"), E.domLab, { speed: o.speed, dur: 1000, ghost: () => { const b = bytes.cloneNode(true); b.classList.add("os"); return b; }, hide: E.domLab });
      },
    },
    "ui:8": {
      sub: "結果の 1 語を返事の channel に入れ、owner のプロセスに REPLY を通知する。SET_TEXT なら OK（コード：protocol.unsafe.mln）。result_out は 0 なので、書き戻すものは無い",
      dur: 3000,
      on(S) {
        clearCls(S, "svcReq");
        set(S, "svcReq", "owner", { cls: "used" });
        S.dom.lit = false; S.slot.lit = [];
        S.reply = { v: "結果：OK（RequestStatus）", lit: true };
        S.dim.appReq = false; S.cards.appReq.sub = "アプリのメモリ（返事が来た）";
        S.arrows = [];
        S.lit = ["reply"]; S.focus = [880, 1360];
      },
      fx(E, S, o) { fly(E.stage, E.svcReq.el.querySelector(".ch"), E.replyBox, { speed: o.speed, dur: 1000, ghost: () => token("結果 1 語", "acc"), hide: E.replyBox.querySelector(".vv") }); },
    },
    "ui:9": {
      on(S) {
        S.reply.lit = false;
        S.next = { v: "Event{owner, id, kind = TIMER}", lit: true };
        S.lit = ["next"]; S.focus = [880, 1360];
      },
      fx(E, S, o) { fly(E.stage, E.dom, E.nextBox, { speed: o.speed, dur: 1100, ghost: () => token("Event（TIMER）", "acc"), hide: E.nextBox.querySelector(".vv") }); },
    },
    "ui:10": {
      sub: "tick() が値を変えると、1（値が変わった）に戻る",
      on(S) {
        S.next = { v: "TIMER のハンドラ tick() を呼ぶ", lit: true };
        S.view = { v: "新しい値", lit: true };
        S.lit = ["next", "view"]; S.focus = [880, 1360];
      },
    },
  };

  // ---------------------------------------------------------------- render
  function render(E, S) {
    const showEl = (el, on, dim) => { el.style.opacity = on ? (dim ? 0.4 : 1) : 0; el.style.pointerEvents = on ? "" : "none"; };
    showEl(E.appReq.el, S.show.appReq, S.dim.appReq); showEl(E.osReq.el, S.show.osReq, S.dim.osReq); showEl(E.svcReq.el, S.show.svcReq);
    E.ph.appReq.style.opacity = S.show.appReq ? 0 : 1;
    E.ph.osReq.style.opacity = S.show.osReq ? 0 : 1;
    E.ph.svc.style.opacity = S.show.svcReq ? 0 : 1;
    E.ph.words.style.opacity = S.show.words || S.ring.filled.length || S.ring.head ? 0 : 1;
    setCard(E.appReq, Object.assign({ sub: "アプリのメモリ" }, S.cards.appReq));
    setCard(E.osReq, S.cards.osReq);
    setCard(E.svcReq, S.cards.svcReq);
    showEl(E.badge, S.show.badge);
    showEl(E.str, S.show.str);
    E.str.classList.toggle("lit", S.lit.includes("str"));
    showEl(E.words, S.show.words);
    showEl(E.chip, S.show.chip); showEl(E.addr, S.show.addr); showEl(E.pid, S.show.pid);
    showEl(E.notify, S.show.notify);
    if (S.pos.notify) {
      const [pid, dx, dy] = S.pos.notify;
      const host = E.places[pid];
      E.notify.style.left = (host.offsetLeft + dx) + "px"; E.notify.style.top = (host.offsetTop + dy) + "px";
    }
    showEl(E.result, false); showEl(E.event, false);
    // view
    E.view.querySelector(".vv").textContent = S.view.v;
    E.view.classList.toggle("lit", !!S.view.lit);
    // slot
    for (const id of ["s0", "s1", "result", "reply_ch"]) {
      const r = E.slotRow(id);
      if (S.slot[id]) r.querySelector(".fv").textContent = S.slot[id];
      else r.querySelector(".fv").textContent = id === "reply_ch" ? "返事の channel" : capOf(id);
      r.classList.toggle("lit", S.slot.lit.includes(id));
    }
    // ring
    E.ringSlots.forEach((s, i) => s.r.setAttribute("class", "slot" + (S.ring.filled.includes(i) ? " full" : "")));
    const lab = (t, i, off) => { const s = E.ringSlots[i % E.ringSlots.length]; const a = Math.atan2(s.y - 88, s.x - 80); t.setAttribute("x", 80 + Math.cos(a) * (60 + off)); t.setAttribute("y", 88 + Math.sin(a) * (60 + off) + 4); };
    const same = S.ring.head === S.ring.tail;
    E.headT.textContent = same ? "head = tail（空）" : "head";
    lab(E.headT, S.ring.head, 15); lab(E.tailT, S.ring.tail, 15);
    E.tailT.style.display = same ? "none" : "";
    // side by side when they are neighbours: head to the left, tail to the right
    E.headT.setAttribute("text-anchor", same ? "middle" : "end");
    E.tailT.setAttribute("text-anchor", "start");
    if (!same) { E.headT.setAttribute("x", Number(E.headT.getAttribute("x")) + 2); E.tailT.setAttribute("x", Number(E.tailT.getAttribute("x")) - 2); }
    // dom, reply, next
    E.domLab.textContent = "Label：" + S.dom.v;
    E.domLab.classList.toggle("lit", !!S.dom.lit);
    E.replyBox.querySelector(".vv").textContent = S.reply.v || "OS_CALL(REPLY) で待つ";
    E.replyBox.classList.toggle("lit", !!S.reply.lit);
    E.nextBox.querySelector(".vv").textContent = S.next.v || "OS_CALL(POLL) で待つ";
    E.nextBox.classList.toggle("lit", !!S.next.lit);
    // places
    for (const [id, p] of Object.entries(E.places)) p.classList.toggle("lit", S.lit.includes(id));
    setBubble(E.bubble, S.bubble);
    // arrows (after the cards have moved)
    const resolve = (ref) => {
      if (ref === "str") return E.str.querySelector(".bytes");
      if (ref === "addr") return E.addr;
      if (ref === "appReqHead") return E.appReq.el.querySelector(".ch");
      const [a, b] = ref.split(".");
      if (a === "slot") return E.slotRow(b);
      if (E[a] && E[a].R) return E[a].R[b];
      return null;
    };
    const arrows = S.arrows.map((a) => Object.assign({}, a, { from: resolve(a.from), to: resolve(a.to) }));
    const draw = () => drawArrows(E.stage, E.ov, arrows);
    draw();
    clearTimeout(E._t); E._t = setTimeout(draw, 700);
  }

  // phones: which places each step shows (in band order), and sizes that differ
  const board = {
    bands: [["view", "appReq", "str", "reply", "next"], ["entry", "osReq", "slot", "words", "ring", "svc", "dom"]],
    steps: {
      "ui:0": ["view"], "ui:1": ["appReq", "str"], "ui:2": ["appReq", "entry"], "ui:3": ["appReq", "entry"],
      "os.gateway:0": ["appReq", "osReq"], "os.gateway:1": ["entry", "osReq"], "os.gateway:2": ["osReq"],
      "os.gateway:3": ["str", "osReq"], "os.gateway:4": ["str", "osReq", "slot"], "os.gateway:5": ["osReq", "slot"],
      "os.gateway:6": ["osReq", "slot"], "os.gateway:7": ["osReq"],
      "os.submit:0": ["osReq", "slot", "words"], "os.submit:1": ["words"], "os.submit:2": ["words", "ring"], "os.submit:3": ["ring"],
      "ui:5": ["ring", "svc"], "ui:6": ["ring", "svc"], "ui:7": ["slot", "svc", "dom"], "ui:8": ["reply", "svc"],
      "ui:9": ["next", "dom"], "ui:10": ["view", "next"],
    },
    sizes: { osReq: [250, 240], ring: [168, 224], svc: [252, 238] },
  };

  return {
    W, H, build, base, render, steps, board,
    groups: [{ at: "ui:0", t: "アプリ" }, { at: "ui:3", t: "OS_CALL の中" }, { at: "ui:5", t: "service task" }],
    trace: {
      run: "ui-request",
      title: "記録：Editor で「x」を打った 1 回のうち、Label_text が送った 2 つ目の要求",
      from: 461500, to: 745500, breakAt: 474800, breakFrac: 0.42,
      map: {
        "ui:0": [248], "ui:1": [249, 251], "ui:2": [254], "ui:3": [256, 257, 258], "os.gateway:0": [259],
        "os.gateway:2": [261], "os.gateway:3": [261], "os.gateway:4": [261], "os.gateway:5": [263], "os.gateway:6": [263], "os.gateway:7": [265],
        "os.submit:1": [267], "os.submit:2": [267], "os.submit:3": [269], "ui:5": [317, 329], "ui:6": [329, 334], "ui:7": [336], "ui:8": [340, 342, 382, 386],
      },
      none: { "os.gateway:1": "request() の中の 1 行なので、記録には出ない（259 と 261 の間）", "os.submit:0": "encode_request_words は記録に出ない（265 と 267 の間）", "ui:9": "この記録は Editor のキー入力。TIMER は入っていない", "ui:10": "この記録には入っていない" },
    },
  };
}

function securityHtml(A) {
  const f = (A.nodes["schema.request"].fields || []).find((x) => x[1] === "owner");
  return `<b>ここが要：アプリは owner を名乗れない</b><span class="k" style="margin:2px 0 4px">${richText(A, A.nodes["gateway.owner"].text)}</span>` +
    `<code>${A.nodes["gateway.owner"].api.sig}</code>` +
    (f ? `<span class="k" style="margin-top:4px">あとで：ui_protocol.handle が作るノードの持ち主、serve が REPLY を送る相手になる</span>` : "");
}

function driftHtml(A) {
  return `<b>! 地図は「0〜12 語目」、コードは 0〜14 語目</b><span class="k">地図（${A.nodes["channel.encode"].title}）は Request を 13 語、返事の channel を 13 語目と書く。Request のフィールドは 15 語あり、コードの RequestWord も 15 語目が返事の channel。ここではコードの順で並べた。</span>`;
}
