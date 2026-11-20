import { h, fmt, richText } from "./util.js";
import { plain } from "./journeys.js";
import { band, wall, place, actor, card, setCard, token, fly, pulse, overlay, drawArrows, bubble, setBubble } from "./stagekit.js";

const STATS = [["c_total", "cpu.total"], ["c_idle", "cpu.idle"], ["c_kernel", "cpu.kernel"], ["procs", "procs[i]"]];

export function cpuScene(A, J) {
  const W = 1360, H = 580;
  const fig = A.nodes["fig.clock-word"];
  // the figure's own example: "例: 1,234 tick と 128/256 → 1,234 × 256 + 128 = 316,032"
  const ex = (fig.figure.match(/例: ([\d,]+) tick と (\d+)\/256 → [\d,]+ × 256 \+ \d+ = ([\d,]+)/) || []);
  const EX = ex.length ? { ticks: ex[1], frac: ex[2], now: ex[3] } : null;
  const branches = (A.papers["kernel.cpu-time"].steps[3].branches || []).map(([when, what]) => ({ when, what }));
  const jarIds = ["cpu_time", "kernel", "idle"];
  const jarName = { cpu_time: "Process.cpu_time", kernel: "g_kernel_time", idle: "g_idle_time" };
  const cnt = A.nodes["kernel.cpu-counters"];
  const jarSub = Object.fromEntries((cnt.fields || []).map((f) => [f[1], f[2]]));
  let pick = 0; // which owner the paper's branch takes (the reader can switch)

  function build(stage, { onTip }) {
    const E = { stage, places: {} };
    const G = 132; // left gutter for the band names
    const gutterBand = (cls, y, hh, name, sub) => {
      const b = band(stage, cls + " gut", y, hh, name, sub);
      b.querySelector(".bname").style.width = (G - 20) + "px";
      return b;
    };
    gutterBand("app", 0, 156, "アプリのメモリ", "Tasks の状態");
    gutterBand("os", 162, 120, "OS_CALL の中", "カーネルの権限");
    gutterBand("kernel", 282, 190, "カーネルの変数", "scheduler");
    gutterBand("emu", 472, H - 472, "エミュレータ", "ハードウェア");
    wall(stage, 159, "境界：fill が作った ProcStats は、ユーザメモリへ書き戻される", "境界（ここから下は OS 側）");

    const P = (id, x, y, w, hh, name) => (E.places[id] = place(stage, id, x, y, w, hh, name));
    P("tick", G, 26, 168, 116, "Tasks.tick()");
    P("statsApp", G + 182, 18, 256, 128, "ProcStats（アプリのメモリ）");
    P("tlast", G + 452, 18, 256, 128, "t.last（前回の読み）");
    P("share", G + 722, 18, 248, 128, "share(part, span) → %");
    P("series", G + 984, 18, 236, 128, "グラフの系列");
    P("fill", G, 186, 168, 86, "proc_stats.fill(out)");
    P("statsOS", G + 452, 176, 256, 100, "ProcStats（OS 側の out）");
    P("charge", G, 296, 440, 166, "charge_elapsed の中");
    P("jars", G + 452, 296, 768, 124, "CPU 時間の置き場（どれか 1 つに足す）");
    P("clock", G, 494, 440, 78, "タイマーの時計 <code>" + (A.nodes["emulator.timer.clock"].reg || "") + "</code>");

    // app side
    E.tick = actor(stage, h("div", { class: "valbox app" }, h("div", { class: "vn" }, "@timer(1000)"), h("div", { class: "vv" }, "1 秒ごとに読む")), G + 12, 52);
    E.tick.style.width = "144px";
    E.statsApp = card("ProcStats", "now", STATS, 236); actor(stage, E.statsApp.el, G + 192, 36); E.statsApp.el.classList.add("app");
    E.tlast = card("ProcStats", "t.last", STATS, 236); actor(stage, E.tlast.el, G + 462, 36); E.tlast.el.classList.add("app");
    E.shareBox = actor(stage, h("div", { class: "valbox app formula" },
      h("div", { class: "vn" }, "span ＝ total の差"),
      h("div", { class: "vn" }, "CPU ＝ span − idle の差"),
      h("div", { class: "vn" }, "OS ＝ kernel の差"),
      h("div", { class: "vn" }, "各行 ＝ cpu_time の差"),
      h("div", { class: "vv" }, "part ÷ span → 0〜100 %")), G + 732, 34);
    E.shareBox.style.width = "228px";
    const cells = h("div", { class: "graph" }, h("div", { class: "bars" }), h("div", { class: "gt" }, ""));
    E.series = actor(stage, cells, G + 994, 36); E.series.style.width = "216px";
    E.bars = cells.querySelector(".bars"); E.gt = cells.querySelector(".gt");

    // OS side
    E.fill = actor(stage, h("div", { class: "valbox os" }, h("div", { class: "vn" }, "割り込みを止めて"), h("div", { class: "vv", style: "font-size:13px" }, "同じ時点の数を読む")), G + 8, 206);
    E.fill.style.width = "152px";
    E.ask = actor(stage, token("&ProcStatsArgs", "mono"), G + 200, 214);
    E.ask.dataset.host = "fill";
    E.statsOS = card("ProcStats", "out", STATS, 236); actor(stage, E.statsOS.el, G + 462, 182); E.statsOS.el.classList.add("os");

    // kernel: the path that leads to charge_elapsed, then its values
    E.path = actor(stage, h("div", { class: "vn", style: "font-family:var(--mono);font-size:12px;color:var(--text-2)" }, ""), G + 12, 312);
    const vb = (name, v) => h("div", { class: "valbox" }, h("div", { class: "vn" }, name), h("div", { class: "vv" }, v));
    E.now = actor(stage, vb("now", ""), G + 12, 336); E.now.style.width = "200px";
    E.spent = actor(stage, vb("spent", "now − 前回"), G + 228, 336); E.spent.style.width = "200px";
    E.who = actor(stage, vb("g_charge_to（持ち主）", "スレッドの枠 か None"), G + 12, 400); E.who.style.width = "200px";
    E.last = actor(stage, vb("g_clock_charged（前回）", "前に足し終えた時刻"), G + 228, 400); E.last.style.width = "200px";
    E.jars = {};
    jarIds.forEach((id, i) => {
      const br = branches[i] || { when: "", what: "" };
      const j = h("div", { class: "jar" }, h("div", { class: "jn" }, jarName[id]), h("div", { class: "js" }, jarSub[jarName[id]] || ""), h("div", { class: "jv" }, "もし " + br.when));
      E.jars[id] = actor(stage, j, G + 464 + i * 252, 318);
      j.style.width = "240px";
      j.addEventListener("click", () => { pick = i; if (E.refresh) E.refresh(); });
      j.style.cursor = "pointer";
      j.title = "クリックで、持ち主をこれにして見る";
    });

    // emulator: the clock word
    E.clock = actor(stage, h("div", { class: "clockword" },
      h("div", {}, h("b", {}, EX ? EX.ticks : "tick 数"), h("small", {}, "tick 数（31–8 ビット）")),
      h("div", {}, h("b", {}, EX ? EX.frac + "/256" : "進み"), h("small", {}, "進み（7–0）"))), G + 12, 510);
    E.clock.style.width = "416px";
    E.clockNote = actor(stage, h("div", { class: "vn", style: "font-size:12px;color:var(--text-2);max-width:760px;line-height:1.5" }, plain(A, A.nodes["emulator.timer.clock"].text)), G + 464, 508);
    E.clockNote.dataset.free = "1"; E.clockNote.dataset.wideOnly = "1";
    E.irq = actor(stage, token("tick の割り込み", "acc"), G + 300, 462);

    const ph = (id, text) => { const d = h("div", { class: "ph" }, text); E.places[id].appendChild(d); return d; };
    E.ph = { statsApp: ph("statsApp", "copy_out で届く"), statsOS: ph("statsOS", "fill が作る") };

    E.ov = overlay(stage, W, H);
    E.bubble = bubble(stage);
    return E;
  }

  const base = () => ({
    show: { statsApp: false, tlast: true, statsOS: false, now: false, spent: false, ask: false, irq: false },
    lit: [], litEl: [], path: "", now: "", last: "前に足し終えた時刻", jar: null, jarAdd: false,
    stats: { statsOS: { rows: {} }, statsApp: { rows: {} }, tlast: { rows: {} } },
    bars: 0, newBar: false, gt: "", bubble: null, focus: [0, W],
  });

  const allStats = (v, cls) => Object.fromEntries(STATS.map(([id]) => [id, { v, cls }]));
  const tlastRows = () => ({ c_total: { v: "前回の total" }, c_idle: { v: "前回の idle" }, c_kernel: { v: "前回の kernel" }, procs: { v: "前回の cpu_time" } });
  const nowRows = (cls) => ({ c_total: { v: "全部の時間", cls }, c_idle: { v: "idle の時間", cls }, c_kernel: { v: "OS の時間", cls }, procs: { v: "各プロセスの時間", cls } });

  const steps = {
    "cpu:0": { on(S) { S.show.irq = true; S.lit = ["clock"]; S.path = ""; S.focus = [100, 600]; }, fx(E) { pulse(E.clock); } },
    "cpu:1": { on(S) { S.show.irq = false; S.path = "dispatch(sp)"; S.lit = ["charge"]; S.focus = [100, 600]; } },
    "cpu:2": { on(S) { S.path = "dispatch(sp) → tick(sp)"; S.focus = [100, 600]; } },
    "cpu:3": { on(S) { S.path = "dispatch(sp) → tick(sp) → reschedule(sp) → charge_elapsed()"; S.focus = [100, 600]; } },
    "kernel.cpu-time:0": {
      sub: EX ? `例（地図の図「${fig.title}」）：${EX.ticks} tick と ${EX.frac}/256 → ${EX.ticks} × 256 ＋ ${EX.frac} ＝ ${EX.now}` : "",
      on(S) { S.show.now = true; S.now = EX ? `${EX.now}（例）` : "tick 数 × 256 ＋ 進み"; S.lit = ["clock", "charge"]; S.litEl = ["now"]; S.focus = [100, 600]; },
      fx(E, S, o) { fly(E.stage, E.clock, E.now, { speed: o.speed, dur: 900, ghost: () => token("時計の 1 語", "acc"), hide: E.now.querySelector(".vv") }); },
    },
    "kernel.cpu-time:1": {
      on(S) { S.show.spent = true; S.litEl = ["spent", "last"]; S.lit = ["charge"]; S.focus = [100, 600]; },
    },
    "kernel.cpu-time:2": { on(S) { S.litEl = ["who"]; S.lit = ["charge"]; S.focus = [100, 600]; } },
    "kernel.cpu-time:3": {
      sub: "持ち主で分かれる。置き場をクリックすると、その持ち主の場合を見られる",
      dur: 3200,
      on(S) { S.jar = jarIds[pick]; S.jarAdd = true; S.litEl = ["spent"]; S.lit = ["jars"]; S.focus = [560, 1360]; },
      fx(E, S, o) { fly(E.stage, E.spent, E.jars[jarIds[pick]], { speed: o.speed, dur: 900, ghost: () => token("＋ spent", "acc"), hide: E.jars[jarIds[pick]].querySelector(".jv") }); },
    },
    "kernel.cpu-time:4": { on(S) { S.jarAdd = false; S.litEl = []; S.lit = ["charge"]; S.focus = [100, 600]; } },
    "kernel.cpu-time:5": {
      on(S) { S.last = "now（今回の時刻）"; S.litEl = ["last"]; S.lit = ["charge"]; S.focus = [100, 600]; },
      fx(E, S, o) { fly(E.stage, E.now, E.last, { speed: o.speed, dur: 800, ghost: () => token("now", "acc mono"), hide: E.last.querySelector(".vv") }); },
    },
    "cpu:6": {
      on(S) { S.show.now = false; S.show.spent = false; S.path = ""; S.jar = null; S.litEl = ["tick"]; S.lit = ["tick"]; S.focus = [100, 600]; },
      fx(E) { pulse(E.tick); },
    },
    "cpu:7": {
      sub: "fill は割り込みを止めて、同じ時点の数を読む（コード：stats.unsafe.mln の fill）",
      on(S) { S.show.ask = true; S.lit = ["fill"]; S.litEl = []; S.focus = [100, 600]; },
      fx(E, S, o) { fly(E.stage, E.tick, E.ask, { speed: o.speed, dur: 800, ghost: () => token("&ProcStatsArgs", "mono"), hide: E.ask }); },
    },
    "cpu:8": {
      sub: "集める前に今までの分を足すので、合計と内訳が合う（地図の proc_stats.fill の文）",
      on(S) { S.path = "fill → charge_elapsed()"; S.jarAdd = "all"; S.lit = ["jars", "charge"]; S.focus = [560, 1360]; },
    },
    "cpu:9": {
      sub: "total は g_clock_charged − g_clock_base（コード：scheduler.unsafe.mln の cpu_total）",
      dur: 3200,
      on(S) { S.jarAdd = false; S.path = ""; S.show.statsOS = true; S.stats.statsOS.rows = nowRows("flash"); S.lit = ["statsOS"]; S.focus = [560, 1100]; },
      fx(E, S, o) {
        const fvOf = (r) => r.querySelector(".fv");
        fly(E.stage, E.jars.cpu_time, E.statsOS.R.procs, { speed: o.speed, dur: 850, shrink: true, hide: fvOf(E.statsOS.R.procs) });
        fly(E.stage, E.jars.kernel, E.statsOS.R.c_kernel, { speed: o.speed, dur: 850, delay: 160, shrink: true, hide: fvOf(E.statsOS.R.c_kernel) });
        fly(E.stage, E.jars.idle, E.statsOS.R.c_idle, { speed: o.speed, dur: 850, delay: 320, shrink: true, hide: fvOf(E.statsOS.R.c_idle) });
        fly(E.stage, E.last, E.statsOS.R.c_total, { speed: o.speed, dur: 850, delay: 480, shrink: true, hide: fvOf(E.statsOS.R.c_total) });
      },
    },
    "cpu:10": {
      dur: 2600,
      on(S) { S.show.statsOS = false; S.show.statsApp = true; S.stats.statsApp.rows = nowRows("flash"); S.lit = ["statsApp"]; S.focus = [260, 860]; },
      fx(E, S, o) { fly(E.stage, E.statsOS.el, E.statsApp.el, { speed: o.speed, dur: 1000, hide: Object.values(E.statsApp.R).map((r) => r.querySelector(".fv")) }); },
    },
    "cpu:11": { on(S) { S.stats.statsApp.rows = nowRows(""); S.lit = ["statsApp", "tick"]; S.focus = [100, 700]; } },
    "app.tasks:0": {
      sub: "コード：tasks.dom.mln の tick。share は part × 100 が i32 に収まるよう、両方を半分ずつにしてから割る",
      on(S) { S.stats.statsApp.rows = nowRows("used"); S.lit = ["share"]; S.litEl = ["share"]; S.focus = [840, 1360]; },
    },
    "app.tasks:1": { on(S) { S.stats.statsApp.rows = nowRows(""); S.stats.tlast.rows = Object.fromEntries(Object.entries(tlastRows()).map(([k, v]) => [k, Object.assign(v, { cls: "used" })])); S.lit = ["tlast", "share"]; S.litEl = []; S.focus = [840, 1360]; } },
    "app.tasks:2": {
      on(S) { S.stats.tlast.rows = tlastRows(); S.bars = 1; S.newBar = true; S.lit = ["series"]; S.focus = [840, 1360]; },
      fx(E, S, o) { fly(E.stage, E.shareBox.querySelector(".vv"), E.bars.lastChild, { speed: o.speed, dur: 800, ghost: () => token("%", "acc"), hide: E.bars.lastChild }); },
    },
    "app.tasks:3": {
      on(S) { S.newBar = false; S.stats.tlast.rows = nowRows("flash"); S.stats.tlast.sub = "t.last ＝ now"; S.lit = ["tlast"]; S.focus = [260, 860]; },
      fx(E, S, o) { fly(E.stage, E.statsApp.el, E.tlast.el, { speed: o.speed, dur: 900, hide: Object.values(E.tlast.R).map((r) => r.querySelector(".fv")) }); },
    },
    "app.tasks:4": {
      sub: "t.cpu は \"CPU \" と % の数、t.fill は系列を空白で区切った文字（コード：tasks.dom.mln の show）",
      on(S) {
        S.stats.tlast.rows = nowRows("");
        S.gt = "t.cpu ＝ \"CPU n%\"　t.fill ＝ \"… n\"";
        S.lit = ["series"]; S.focus = [840, 1360];
        S.bubble = { x: 1104, y: 172, w: 248, cls: "", html: `<b>変わった値だけが送られる</b><span class="k">view() の Label が t.cpu を、Graph が t.fill を読む。変わると send_text などが Request を作る</span><button class="tolink" data-go="ui">UI の要求の 1 へ →</button>` };
      },
    },
  };

  function render(E, S) {
    const showEl = (el, on) => { el.style.opacity = on ? 1 : 0; el.style.pointerEvents = on ? "" : "none"; };
    showEl(E.statsApp.el, S.show.statsApp); showEl(E.statsOS.el, S.show.statsOS);
    E.ph.statsApp.style.opacity = S.show.statsApp ? 0 : 1; E.ph.statsOS.style.opacity = S.show.statsOS ? 0 : 1;
    showEl(E.now, S.show.now); showEl(E.spent, S.show.spent); showEl(E.ask, S.show.ask); showEl(E.irq, S.show.irq);
    E.now.querySelector(".vv").textContent = S.now;
    E.last.querySelector(".vv").textContent = S.last;
    E.path.textContent = S.path;
    for (const k of ["now", "spent", "who", "last", "tick", "share"]) {
      const el = k === "share" ? E.shareBox : E[k];
      el.classList.toggle("lit", S.litEl.includes(k));
    }
    jarIds.forEach((id, i) => {
      const j = E.jars[id];
      const on = S.jarAdd === "all" || (S.jar === id && S.jarAdd);
      j.classList.toggle("lit", !!on);
      j.classList.toggle("dim", !!(S.jar && S.jarAdd === true && S.jar !== id));
      const br = branches[i] || { when: "" };
      j.querySelector(".jv").textContent = on ? (S.jarAdd === "all" ? "＋ 今までの分（持ち主のところ）" : "＋ spent　（" + br.when + "）") : "もし " + br.when;
    });
    setCard(E.statsOS, S.stats.statsOS);
    setCard(E.statsApp, S.stats.statsApp);
    setCard(E.tlast, Object.assign({ rows: tlastRows(), sub: "t.last" }, S.stats.tlast.rows && Object.keys(S.stats.tlast.rows).length ? S.stats.tlast : {}));
    E.bars.innerHTML = "";
    for (let i = 0; i < 16; i++) E.bars.appendChild(h("i", { class: "old" }));
    if (S.bars) { const b = E.bars.lastChild; b.className = "new"; b.textContent = ""; }
    E.gt.textContent = S.gt || "1 秒に 1 つ、1 分ぶん（60 個）";
    for (const [id, p] of Object.entries(E.places)) p.classList.toggle("lit", S.lit.includes(id));
    setBubble(E.bubble, S.bubble);
    const btn = E.bubble.querySelector(".tolink");
    if (btn) btn.onclick = () => { location.hash = "j=ui&v=packet&c=ui:0"; };
    drawArrows(E.stage, E.ov, []);
  }

  // phones: the places of each step, and how the wide places fold into a column
  const at = (el, x, y, w) => { el.style.left = x + "px"; el.style.top = y + "px"; if (w) el.style.width = w + "px"; };
  const back = (el) => { const [x, y, w] = JSON.parse(el.dataset.wide || "[0,0,\"\"]"); el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = w; };
  const board = {
    bands: [["tick", "statsApp", "tlast", "share", "series"], ["fill", "statsOS"], ["charge", "jars"], ["clock"]],
    steps: {
      "cpu:0": ["charge", "clock"], "cpu:1": ["charge"], "cpu:2": ["charge"], "cpu:3": ["charge"],
      "kernel.cpu-time:0": ["charge", "clock"], "kernel.cpu-time:1": ["charge"], "kernel.cpu-time:2": ["charge"],
      "kernel.cpu-time:3": ["charge", "jars"], "kernel.cpu-time:4": ["charge"], "kernel.cpu-time:5": ["charge"],
      "cpu:6": ["tick"], "cpu:7": ["tick", "fill"], "cpu:8": ["fill", "charge", "jars"], "cpu:9": ["statsOS", "charge", "jars"],
      "cpu:10": ["statsApp", "statsOS"], "cpu:11": ["tick", "statsApp"],
      "app.tasks:0": ["statsApp", "share"], "app.tasks:1": ["tlast", "share"], "app.tasks:2": ["share", "series"],
      "app.tasks:3": ["statsApp", "tlast"], "app.tasks:4": ["series"],
    },
    sizes: { charge: [352, 230], jars: [352, 244], clock: [352, 78], fill: [176, 120] },
    kids: {
      charge(E, on) {
        if (!on) { for (const el of [E.path, E.now, E.spent, E.who, E.last, E.irq]) back(el); E.path.style.maxWidth = ""; return; }
        at(E.path, 10, 14); E.path.style.maxWidth = "330px";
        at(E.now, 10, 56, 162); at(E.spent, 180, 56, 162); at(E.who, 10, 124, 162); at(E.last, 180, 124, 162); at(E.irq, 180, 200);
      },
      jars(E, on) { jarIds.forEach((id, i) => (on ? at(E.jars[id], 12, 22 + i * 72, 328) : back(E.jars[id]))); },
      clock(E, on) { if (on) at(E.clock, 12, 16, 328); else back(E.clock); },
      fill(E, on) { if (on) { at(E.fill, 8, 20); at(E.ask, 8, 84); } else { back(E.fill); back(E.ask); } },
    },
  };

  return {
    W, H, build, base, render, steps, board,
    groups: [{ at: "cpu:0", t: "切り替えのたびに" }, { at: "cpu:6", t: "1 秒ごとに" }, { at: "app.tasks:0", t: "Tasks.tick の中" }],
    trace: {
      run: "ui-request",
      title: "記録の中の charge_elapsed（Editor で「x」を打った 1 回）",
      from: 0, to: 1130000,
      summary: (T) => {
        const n = T.events.filter((e) => e.n === "kernel.cpu-time").length;
        const sw = T.events.filter((e) => e.ev === "switch").length;
        return `この記録で charge_elapsed は ${n} 回、スレッドの切り替えは ${sw} 回`;
      },
      pick: (key, ev) => {
        if (key === "cpu:0" || key === "cpu:1" || key === "cpu:2") return ev.filter((e) => e.ev === "irq" && (e.cause || []).includes("timer"));
        if (key === "cpu:3" || key.startsWith("kernel.cpu-time")) return ev.filter((e) => e.n === "kernel.cpu-time");
        return [];
      },
      none: { "cpu:6": "この記録にはタスクマネージャの PROC_STATS は入っていない", "cpu:7": "この記録には PROC_STATS は入っていない", "cpu:8": "この記録には PROC_STATS は入っていない" },
    },
  };
}
