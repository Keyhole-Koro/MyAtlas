// The recorded run as a model: call slices per thread, when each thread held the CPU, the messages
// that went between threads, the phases of the story, and where the instructions went.
//
// Inputs: ATLAS (lab/data/atlas.js) for nodes, layers, flows and papers; ATLAS.traces[0] for which
// function is which node; TRACE_FULL (data/trace-full.js) for every event of the same recorded file,
// exits and irets included (ATLAS keeps only enter, irq, switch and request).

export const STACKED = ["app", "lib", "os", "kernel", "emu"];

// Where a function lives decides its layer: every function node of the map follows this.
export function layerOfPath(path) {
  if (!path) return null;
  if (path.startsWith("system/MyOS/src/apps/")) return "app";
  if (path.startsWith("system/MyAppFramework/") || path.startsWith("toolchain/MyStdLib/")) return "lib";
  if (path.startsWith("system/MyOS/")) return "os";
  if (path.startsWith("system/MyKernel/")) return "kernel";
  if (path.startsWith("runtime/MyEmulator/")) return "emu";
  return null;
}

// Two recorded functions have no file in the record: they are the syscall stubs of MyStdLib
// (toolchain/MyStdLib/platform/myos/syscall.masm has `export os_call` and
// `export sys_wait_notification`; transport.unsafe.mln imports the second from
// "@std/platform/myos/syscall.masm"). With the file, their layer follows the same rule as the rest.
export const FILE_FROM_SOURCE = {
  os_call: "toolchain/MyStdLib/platform/myos/syscall.masm",
  sys_wait_notification: "toolchain/MyStdLib/platform/myos/syscall.masm",
};

// Why a node of the map is not in the record. "Not recorded" and "did not run" are different:
// only the functions in RAW.watched were recorded at all.
export function absentWhy(m, id) {
  const n = m.nodes[id];
  if (!n) return "地図に無い";
  if (n.kind === "func") {
    if (!n.fn) return "関数の中の 1 文なので、記録には出ない";
    const watched = m.RAW.watched || {};
    if (!watched[n.fn]) return `記録していない関数（記録した ${Object.keys(watched).length} 関数の外）なので、この記録では分からない`;
    if (m.slices.some((s) => s.fn === n.fn)) return `${n.fn} の中の 1 つの枝なので、記録には出ない（関数そのものは記録にある）`;
    return "記録している関数だが、この記録では呼ばれていない";
  }
  if (n.kind === "hw") return "エミュレータの部品なので、記録には出ない";
  if (n.kind === "store") return "置き場なので、記録には出ない（記録は関数だけ）";
  if (n.kind === "schema" || n.kind === "enum") return "データの形なので、記録には出ない（記録は関数だけ）";
  if (n.kind === "context") return "実行の文脈なので、関数としては出ない（割り込みと syscall の枠で見える）";
  return "関数ではないので、記録には出ない（記録は関数だけ）";
}

const CAUSE_JA = { timer: "タイマー", keyboard: "キーボード", syscall: "syscall", automation: "automation" };
export const causeJa = (c) => CAUSE_JA[c] || c;

export function threadInfo(tid, label) {
  const l = label || "";
  if (/idle/.test(l)) return { name: "走るもの無し", sub: "idle（どのスレッドでもない）", kind: "idle" };
  if (l.startsWith("kernel:")) return { name: l.slice(7).trim(), sub: "カーネルのスレッド", kind: "kernel" };
  return { name: l || `スレッド ${tid}`, sub: "アプリのスレッド", kind: "app" };
}

export function buildModel(ATLAS, RAW) {
  const T = ATLAS.traces[0];
  const nodes = ATLAS.nodes;
  const problems = [];

  // 1. The two copies of the run must agree event by event.
  const rawBySeq = new Map(RAW.events.map((e) => [e.seq, e]));
  let checked = 0;
  for (const e of T.events) {
    const r = rawBySeq.get(e.seq);
    if (!r || r.ev !== e.ev || r.instr !== e.instr || (r.fn || null) !== (e.fn || null) || r.thread !== e.thread) {
      problems.push(`seq ${e.seq} が地図の記録と合わない`);
    } else checked++;
  }
  const nodeOfSeq = new Map(T.events.filter((e) => e.n).map((e) => [e.seq, e.n]));
  const nodeOfFn = new Map();
  for (const e of T.events) if (e.n && e.fn) nodeOfFn.set(e.fn, e.n);

  const events = RAW.events;
  const END = events[events.length - 1].instr;

  // 2. Replay the stacks.
  const slices = [];
  const stacks = new Map();
  const runs = new Map(); // tid -> [[start, end]]
  const switches = [], requests = [];
  const stackOf = (t) => { if (!stacks.has(t)) stacks.set(t, []); return stacks.get(t); };
  let cur = events[0].thread, runStart = events[0].instr;
  const closeRun = (t, at) => { if (!runs.has(t)) runs.set(t, []); runs.get(t).push([runStart, at]); };
  // Self time on the CPU: the gap up to the next event belongs to the innermost open frame of the
  // thread that was running.
  let lastAt = events[0].instr;
  const selfNone = new Map(); // tid -> instructions with no recorded frame open
  const segs = []; // [start, end, slice id or -1, tid]: what the CPU was in, end to end
  const credit = (upto) => {
    const span = upto - lastAt;
    if (span > 0) {
      const st = stackOf(cur);
      const top = st.length ? st[st.length - 1] : null;
      if (top) top.selfOn += span;
      else selfNone.set(cur, (selfNone.get(cur) || 0) + span);
      const last = segs[segs.length - 1];
      const id = top ? top.id : -1;
      if (last && last[2] === id && last[3] === cur && last[1] === lastAt) last[1] = upto;
      else segs.push([lastAt, upto, id, cur]);
    }
    lastAt = upto;
  };

  for (const e of events) {
    credit(e.instr);
    if (e.ev === "switch") {
      closeRun(e.from, e.instr);
      switches.push({ at: e.instr, from: e.from, to: e.thread, seq: e.seq });
      cur = e.thread; runStart = e.instr;
      continue;
    }
    if (e.ev === "request") { requests.push({ at: e.instr, method: e.method, tid: e.thread, seq: e.seq }); continue; }
    const st = stackOf(e.thread);
    if (e.ev === "enter" || e.ev === "irq") {
      const s = {
        id: slices.length, tid: e.thread, depth: st.length, start: e.instr, end: null, open: false,
        kind: e.ev === "irq" ? "irq" : "call", fn: e.fn, program: e.program, seqIn: e.seq, seqOut: null,
        parent: st.length ? st[st.length - 1].id : null, children: [], selfOn: 0, unwound: false,
      };
      if (e.ev === "irq") {
        s.cause = (e.cause || [])[0] || null; s.trap = e.trap || null; s.syscall = e.syscall || null;
        s.service = e.service || null; s.interrupted = e.interrupted || null;
      }
      if (s.parent !== null) slices[s.parent].children.push(s.id);
      slices.push(s); st.push(s);
    } else if (e.ev === "exit" || e.ev === "iret") {
      // Pop to the matching frame (they always match in this file; the loop is only a guard).
      let k = st.length - 1;
      while (k >= 0 && !(e.ev === "iret" ? st[k].kind === "irq" : st[k].kind === "call" && st[k].fn === e.fn)) k--;
      if (k < 0) { problems.push(`seq ${e.seq}: ${e.fn} の出口に入口が無い`); continue; }
      while (st.length > k) {
        const s = st.pop();
        s.end = e.instr; s.seqOut = e.seq; s.unwound = !!e.unwound;
      }
    }
  }
  credit(END);
  closeRun(cur, END);
  for (const st of stacks.values()) for (const s of st) { s.end = END; s.open = true; }

  // 3. What each slice is on the map.
  const watched = RAW.watched || {};
  const fixes = [];
  for (const s of slices) {
    if (s.kind === "irq") {
      s.layer = "kernel"; s.inferred = true;
      s.ctx = s.trap === "syscall" ? (s.syscall === "OS_CALL" ? "ctx.syscall" : null) : "ctx.irq";
      s.n = null;
      s.label = s.trap === "syscall"
        ? (s.syscall === "OS_CALL" ? `OS_CALL ${s.service || ""}`.trim() : s.syscall)
        : `割り込み・${causeJa(s.cause)}`;
      continue;
    }
    s.n = nodeOfSeq.get(s.seqIn) || null;
    // ATLAS.traces[0] ties every syscall.dispatch to OS_CALL (kernel.os-call). The same function runs
    // every syscall, and syscall.unsafe.mln handles `Syscall::OS_CALL` and `Syscall::WAIT_NOTIFICATION`
    // in separate branches: only the ones under an OS_CALL syscall are that node.
    if (s.n === "kernel.os-call") {
      let p = s.parent;
      while (p !== null && slices[p].kind !== "irq") p = slices[p].parent;
      const sys = p === null ? null : slices[p].syscall;
      if (sys && sys !== "OS_CALL") { s.notNode = { n: s.n, syscall: sys }; s.n = null; fixes.push(s.id); }
    }
    const node = s.n && nodes[s.n];
    const recorded = (watched[s.fn] || {}).file || null;
    const file = recorded || FILE_FROM_SOURCE[s.fn] || null;
    s.fileFrom = recorded ? "record" : file ? "source" : null;
    s.file = file || (node && node.code ? node.code[0] : null);
    if (node) { s.layer = node.layer; s.inferred = false; s.label = node.title; }
    else { s.layer = layerOfPath(file); s.inferred = true; s.label = s.notNode ? `${s.fn}（${s.notNode.syscall}）` : s.fn; }
  }

  // 4. Threads, in the order of the layers they mostly run (the app on top).
  const threads = [];
  for (const [tidStr, label] of Object.entries(RAW.threads || T.threads || {})) {
    const tid = Number(tidStr);
    const own = slices.filter((s) => s.tid === tid);
    const r = runs.get(tid) || [];
    const info = threadInfo(tid, label);
    threads.push({
      tid, label, ...info, runs: r,
      cpu: r.reduce((a, [x, y]) => a + y - x, 0),
      maxDepth: own.reduce((m, s) => Math.max(m, s.depth + 1), 0),
      count: own.length, selfNone: selfNone.get(tid) || 0,
    });
  }
  // The app first, then the threads with the most recorded calls; idle last.
  const order = { app: 0, kernel: 1, idle: 3 };
  threads.sort((a, b) => (order[a.kind] ?? 2) - (order[b.kind] ?? 2) || b.count - a.count);
  const threadById = new Map(threads.map((t) => [t.tid, t]));

  // Off-CPU parts of each slice: the intervals inside it when its thread was not running.
  for (const s of slices) {
    const r = threadById.get(s.tid)?.runs || [];
    const on = [];
    for (const [a, b] of r) { const x = Math.max(a, s.start), y = Math.min(b, s.end); if (y > x) on.push([x, y]); }
    s.on = on;
    s.cpuIn = on.reduce((a, [x, y]) => a + y - x, 0);
    // An open frame never returned before the record ended. On "none running" (idle) that is not a
    // wait: the CPU simply never came back to that context, so it is drawn up to its last moment on
    // the CPU only.
    s.lastOn = on.length ? on[on.length - 1][1] : s.start;
    s.abandoned = s.open && threadById.get(s.tid)?.kind === "idle";
  }

  // 5. Messages between threads, paired by order: a channel hands out what was put in first.
  const byNode = (id) => slices.filter((s) => s.n === id);
  const childOf = (s, pred) => s.children.map((i) => slices[i]).filter(pred);
  const descend = (s, pred, out = []) => { for (const i of s.children) { const c = slices[i]; if (pred(c)) out.push(c); descend(c, pred, out); } return out; };
  const ancestor = (s, pred) => { let p = s.parent; while (p !== null) { if (pred(slices[p])) return slices[p]; p = slices[p].parent; } return null; };
  const isFn = (f) => (s) => s.kind === "call" && s.fn === f;
  const links = [];
  const serves = byNode("os.serve").filter((s) => descend(s, (c) => c.n === "os.ui-protocol").length);
  const taken = new Set();
  for (const sub of byNode("os.submit")) {
    const send = childOf(sub, (c) => c.n === "kernel.ipc-send")[0];
    if (!send) continue;
    const sv = serves.find((v) => !taken.has(v.id) && v.start > send.end && v.tid !== sub.tid);
    if (!sv) continue;
    taken.add(sv.id);
    const recv = childOf(sv, isFn("ipc.recv")).find((c) => c.start >= sv.start);
    links.push({ kind: "queue", from: send.id, to: (recv || sv).id, a: sub.id, b: sv.id, via: "os.request-ring", nodes: ["os.submit", "os.serve"] });
    // The answer goes back through the reply channel to the app that asked.
    const handle = descend(sv, (c) => c.n === "os.ui-protocol")[0];
    const back = childOf(sv, (c) => c.n === "kernel.ipc-send").find((c) => c.start > handle.end);
    if (back) {
      const replyRecv = slices.find((c) => c.tid === sub.tid && c.fn === "ipc.recv" && c.start > back.end
        && ancestor(c, (p) => p.kind === "irq" && p.service === "REPLY"));
      if (replyRecv) links.push({ kind: "reply", from: back.id, to: replyRecv.id, a: sv.id, b: ancestor(replyRecv, isFn("request_gateway.reply"))?.id ?? replyRecv.id, nodes: ["os.serve", "lib.transport"] });
    }
    links[links.findIndex((l) => l.b === sv.id)].handle = handle.id;
  }
  // Events: app_events.push puts one in the owner's queue; the app takes it with OS_CALL(POLL) and
  // runtime.next calls its handler.
  const polls = slices.filter((s) => s.kind === "irq" && s.service === "POLL")
    .filter((p) => { const nx = ancestor(p, (a) => a.n === "lib.next"); return nx && descend(nx, isFn("runtime.call_handler")).length; });
  let pi = 0;
  for (const push of byNode("os.events")) {
    const send = childOf(push, (c) => c.n === "kernel.ipc-send")[0];
    while (pi < polls.length && polls[pi].start < (send || push).end) pi++;
    if (!send || pi >= polls.length) continue;
    const p = polls[pi++];
    const recv = descend(p, isFn("ipc.recv"))[0];
    const next = ancestor(p, (a) => a.n === "lib.next");
    const handler = descend(next, isFn("runtime.call_handler"))[0];
    const app = handler && descend(handler, (c) => c.layer === "app")[0];
    let top = push; while (top.parent !== null) top = slices[top.parent];
    links.push({ kind: "event", from: send.id, to: (recv || p).id, a: push.id, b: next.id, nodes: ["os.events", "lib.next"], handler: app ? app.id : null, origin: top.fn });
  }

  // 6. Where the instructions went: the innermost recorded frame of the running thread.
  const share = { app: 0, lib: 0, os: 0, kernel: 0, emu: 0, unknown: 0, none: 0 };
  for (const s of slices) share[s.layer || "unknown"] += s.selfOn;
  for (const v of selfNone.values()) share.none += v;

  const model = { END, slices, threads, threadById, switches, requests, links, share, segs, problems, checked, nodes, ATLAS, RAW, fixes,
    helpers: { byNode, childOf, descend, ancestor } };
  model.shareIn = (a, b) => {
    const out = { app: 0, lib: 0, os: 0, kernel: 0, emu: 0, unknown: 0, none: 0 };
    for (const [x, y, id] of segs) {
      const v = Math.min(b, y) - Math.max(a, x);
      if (v > 0) out[id < 0 ? "none" : (slices[id].layer || "unknown")] += v;
    }
    return out;
  };
  model.phases = buildPhases(model);
  model.paths = buildPaths(model);
  model.landmarks = buildLandmarks(model);
  foldDepths(model);
  return model;
}

// The moments the story turns on, each with its phase: they get a pin in the timeline.
function buildLandmarks(m) {
  const { slices, phases, paths } = m;
  const phaseOf = (s) => phases.find((p) => p.turns.some((u) => u.tid === s.tid && s.start >= u.start && s.start < u.end)) || null;
  const out = new Map();
  const add = (id, text, sub, kind) => {
    if (id == null || out.has(id)) return;
    const p = phaseOf(slices[id]);
    out.set(id, { id, text, sub, kind, phase: p ? p.num : null });
  };
  for (const p of paths) {
    add(p.keyId, "キーの割り込み", null, "irq");
    add(p.originId, "キーを配る", null, "fn");
    add(p.handlerId, slices[p.handlerId].fn, null, "app");
    add(p.changeId, "DOM を書き換える", p.hook, "dom");
  }
  return [...out.values()].sort((a, b) => slices[a.id].start - slices[b.id].start);
}

// "The main calls only": an interrupt or a syscall is one bar (what ran inside it folds into it),
// and outside them only the nodes of the map, the app's own functions and the moments of the story
// stay. Every other frame folds into its parent.
function foldDepths(m) {
  const { slices, threads, paths } = m;
  const extra = new Set(m.landmarks.map((l) => l.id));
  for (const p of paths) extra.add(p.hookId);
  for (const s of slices) {
    let p = s.parent;
    while (p !== null && slices[p].kind !== "irq") p = slices[p].parent;
    s.inIrq = p !== null;
    s.kept = extra.has(s.id) || (!s.inIrq && (s.kind === "irq" || !!s.n || s.layer === "app"));
  }
  for (const s of slices) {
    let d = 0;
    for (let p = s.parent; p !== null; p = slices[p].parent) if (slices[p].kept) d++;
    s.fdepth = d;
  }
  for (const t of threads) t.maxFDepth = slices.filter((s) => s.tid === t.tid && s.kept).reduce((a, s) => Math.max(a, s.fdepth + 1), 0);
}

// From the key to each DOM change, hop by hop. Every hop is a recorded call, a message paired by
// order (a channel hands out what went in first), or an order the map's text gives:
//   kernel.irq-dispatch: input that wakes a thread switches to it without waiting for the next tick.
//   lib.send-text / app.tasks-view: after each event, the attribute hooks send what changed.
function buildPaths(m) {
  const { slices, links, switches, requests, helpers } = m;
  const top = (s) => { while (s.parent !== null) s = slices[s.parent]; return s; };
  const chain = (s) => { const out = []; for (let p = s; p; p = p.parent === null ? null : slices[p.parent]) out.unshift(p.id); return out; };
  const out = [];
  for (const q of links.filter((l) => l.kind === "queue" && l.handle != null)) {
    const handle = slices[q.handle];
    const change = helpers.descend(handle, (c) => c.kind === "call").pop() || handle;
    const submit = slices[q.a];
    const hook = top(submit);
    // the handler that ran just before the hook, and the event that called it
    const handler = slices.filter((s) => s.tid === hook.tid && s.layer === "app" && s.end <= hook.start).pop();
    const ev = handler && links.find((l) => l.kind === "event" && l.handler === handler.id);
    if (!ev) continue;
    const push = slices[ev.a], origin = top(push);
    const sw = switches.filter((w) => w.to === origin.tid && w.at <= origin.start).pop();
    const key = sw && slices.find((s) => s.kind === "irq" && s.cause === "keyboard" && s.tid === sw.from && s.start <= sw.at);
    const req = requests.find((r) => r.method === "input.key.type" && key && r.at <= key.start);
    const hops = [];
    if (req) hops.push({ kind: "request", at: req.at, text: "キー入力", sub: `ドライバの要求 ${req.method}`, ids: [] });
    // (the interrupt's own frames stay open in this record: the CPU never returns to "none running")
    if (key) hops.push({ kind: "irq", at: key.start, text: "キーの割り込み", sub: `${m.threadById.get(key.tid).name} の上で・keyboard.drain_hw`, ids: helpers.descend(key, (c) => c.fn === "keyboard.drain_hw" && !c.open).map((c) => c.id) });
    if (sw) hops.push({ kind: "switch", at: sw.at, text: `${m.threadById.get(sw.to).name} に切り替える`, sub: "入力がスレッドを起こしたので、次の tick を待たずに", ids: [], sw });
    hops.push({ kind: "slice", at: origin.start, text: "キーを配る", sub: origin.fn, ids: chain(push).concat([ev.from]) });
    hops.push({ kind: "wait", at: slices[ev.from].end, until: slices[ev.to].start, text: "イベントが列で待つ", sub: `${m.threadById.get(push.tid).name} → ${m.threadById.get(handler.tid).name}`, link: ev });
    hops.push({ kind: "slice", at: slices[ev.to].start, text: "イベントを受け取る", sub: "runtime.next の OS_CALL(POLL)", ids: chain(slices[ev.to]) });
    hops.push({ kind: "slice", at: handler.start, text: "ハンドラ", sub: handler.fn, ids: chain(handler) });
    hops.push({ kind: "slice", at: hook.start, text: "属性のフックが送る", sub: `${hook.fn} → send_text → OS_CALL(REQUEST)`, ids: chain(slices[q.from]) });
    hops.push({ kind: "wait", at: slices[q.from].end, until: slices[q.to].start, text: "要求が列で待つ", sub: `${m.threadById.get(submit.tid).name} → ${m.threadById.get(handle.tid).name}`, link: q });
    hops.push({ kind: "slice", at: slices[q.to].start, text: "要求を取り出す", sub: "request_channel.serve", ids: [q.b, q.to] });
    hops.push({ kind: "slice", at: change.start, text: "DOM を書き換える", sub: chain(change).slice(chain(handle).length - 1).map((i) => slices[i].fn).join(" → "), ids: chain(change), end: change.end });
    out.push({ id: out.length, hook: hook.fn.replace(/^elements\./, ""), handle: handle.id, change: change.id, start: req ? req.at : key ? key.start : origin.start, end: change.end, hops, links: [ev, q],
      keyId: key ? key.id : null, originId: origin.id, handlerId: handler.id, hookId: hook.id, changeId: change.id });
  }
  return out;
}

// The story: one phase per turn a thread held the CPU, named from what ran in it. After the last
// turn that changed the DOM, the rest of the record is one phase.
function buildPhases(m) {
  const { slices, threads, links, requests, helpers } = m;
  const turns = [];
  for (const t of threads) for (const [a, b] of t.runs) turns.push({ tid: t.tid, start: a, end: b });
  turns.sort((x, y) => x.start - y.start);
  const inTurn = (u, s) => s.tid === u.tid && s.start >= u.start && s.start < u.end;
  // Words for what happened, from the map's own text: os.submit "列に入れる", os.serve "列から要求を
  //取り出し", the ui flow's step 7 "書き換える" (handle -> DOM), os.events "列に入れる", REPLY.
  // rank: 1 the point of the phase, 2 the hand-over, 3 the answer, 4 the plumbing, 9 side events.
  const words = (u) => {
    const out = [];
    const add = (at, text, ref, rank, kind) => out.push({ at, text, ref, rank, kind });
    for (const r of requests) if (r.at >= u.start && r.at < u.end) add(r.at, r.method === "input.key.type" ? "キー入力" : r.method, null, r.method === "input.key.type" ? 5 : 9, "request");
    for (const s of slices) {
      if (!inTurn(u, s)) continue;
      if (s.kind === "irq") {
        if (s.cause === "keyboard") add(s.start, "キーの割り込み", s.id, 5, "irq");
        else if (s.cause === "automation") add(s.start, "automation の割り込み", s.id, 9, "irq");
        else if (s.syscall === "WAIT_NOTIFICATION") add(s.start, "通知を待つ", s.id, 8, "irq");
        continue;
      }
      if (s.fn === "dom_widgets.dispatch_key_event") add(s.start, "キーを配る", s.id, 1, "fn");
      if (s.layer === "app") add(s.start, s.fn, s.id, 1, "app");
      if (s.n === "os.submit") add(s.start, "要求を列に並べる", s.id, 2, "node");
      if (s.n === "os.ui-protocol") add(s.start, "DOM を書き換える", s.id, 1, "node");
    }
    const pushes = slices.filter((s) => inTurn(u, s) && s.n === "os.events");
    if (pushes.length) add(pushes[0].start, `イベントを ${pushes.length} 件入れる`, pushes[0].id, 2, "node");
    for (const l of links) {
      const b = slices[l.b];
      if (l.kind === "queue" && inTurn(u, b)) add(b.start, "要求を取り出す", b.id, 2, "node");
      if (l.kind === "reply" && inTurn(u, slices[l.from])) add(slices[l.from].start, "返事を送る", l.from, 3, "node");
      if (l.kind === "reply" && inTurn(u, slices[l.to])) add(slices[l.to].start, "返事を受け取る", l.b, 3, "node");
      if (l.kind === "event" && inTurn(u, slices[l.to])) add(slices[l.to].start, "イベントを受け取る", l.b, 4, "node");
    }
    out.sort((x, y) => x.at - y.at);
    return out;
  };
  const headline = (ws) => {
    const best = [...ws].sort((x, y) => x.rank - y.rank || x.at - y.at).slice(0, 3);
    return ws.filter((w) => best.includes(w));
  };
  const last = turns.reduce((k, u, i) => (slices.some((s) => inTurn(u, s) && s.n === "os.ui-protocol") ? i : k), -1);
  const phases = [];
  turns.forEach((u, i) => {
    if (last >= 0 && i > last) return;
    const w = words(u);
    phases.push({ num: phases.length + 1, tid: u.tid, start: u.start, end: u.end, words: w, head: headline(w), turns: [u] });
  });
  if (last >= 0 && last < turns.length - 1) {
    const rest = turns.slice(last + 1);
    const w = rest.flatMap(words);
    phases.push({ num: phases.length + 1, tid: null, start: rest[0].start, end: rest[rest.length - 1].end, words: w, head: headline(w.filter((x) => x.rank < 9)), turns: rest, after: true });
  }
  // What each request was for: the attribute hook that called send_text (Window_title, Label_text).
  for (const p of phases) {
    for (const w of p.words) {
      if (w.text !== "DOM を書き換える") continue;
      const q = links.find((l) => l.kind === "queue" && l.handle === w.ref);
      if (!q) continue;
      const hook = helpers.ancestor(slices[q.a], (x) => x.fn && /^elements\.[A-Z]/.test(x.fn));
      if (hook) w.detail = hook.fn.replace(/^elements\./, "");
    }
  }
  return phases;
}

// Every step of a flow or paper, with the slices that are that step in this run.
//   a step that a message between threads makes (the request ring, a REPLY, an event): those
//     messages, the sending side when the step puts into a store, the taking side when it takes out.
//   call/syscall with both ends recorded: the callee under the caller; failing that, the callee
//     right after the caller in the same function (a paper draws statements in order).
//   OS_CALL(X) in the step's verb keeps only the OS_CALLs with service X.
//   a step inside a paper only counts inside the paper's own function.
//   otherwise: the recorded function ends of the step.
export function stepHits(m, step, boxes, owner = null) {
  const { slices, nodes, helpers } = m;
  const nodeOf = (id) => boxes.find((b) => b.id === id)?.node;
  const A = nodeOf(step.from), B = nodeOf(step.to), R = step.ref;
  const ids = new Set([A, B, R].filter(Boolean));
  const has = (id) => slices.some((s) => s.n === id);
  const fnNode = (id) => id && nodes[id]?.kind === "func" && nodes[id].fn;
  const inside = owner && has(owner) ? (s) => s.n === owner || !!helpers.ancestor(s, (p) => p.n === owner) : () => true;
  const svc = /OS_CALL\((\w+)\)/.exec(step.verb || "")?.[1] || null;
  const svcOk = (s) => !svc || s.n !== "kernel.os-call" || helpers.ancestor(s, (p) => p.kind === "irq")?.service === svc;
  // A store at one end that is a port of the paper inside the other end: the port's box is the place.
  for (const [x, y] of [[A, B], [B, A]]) {
    const paper = x && nodes[x]?.paper && m.ATLAS.papers[nodes[x].paper];
    const port = paper?.ports?.[y];
    const pb = port && paper.boxes.find((b) => b.id === port);
    if (pb?.node) ids.add(pb.node);
  }
  const absent = [];
  for (const id of [A, B]) {
    if (!id || has(id)) continue;
    absent.push({ id, why: absentWhy(m, id) });
  }
  // an end that is a function the record did not watch: the step cannot be checked here
  const watched = m.RAW.watched || {};
  const unwatched = absent.filter((x) => nodes[x.id].kind === "func" && nodes[x.id].fn && !watched[nodes[x.id].fn]).map((x) => x.id);
  const out = { ids: [...ids], hits: [], links: [], times: 0, how: "", absent, svc, unwatched };
  if (step.alt) { out.how = "alt"; return out; }

  const hit = new Set();
  const addUp = (i) => { hit.add(i); let p = slices[i].parent; while (p !== null) { if (slices[p].n && ids.has(slices[p].n)) hit.add(p); p = slices[p].parent; } };
  const links = m.links.filter((l) => (ids.has(l.via) || l.nodes.every((n) => ids.has(n))) && inside(slices[l.a]));
  if (links.length) {
    for (const l of links) {
      const putIn = l.via && ids.has(l.via) && nodeOf(step.to) === l.via;
      const takeOut = l.via && ids.has(l.via) && nodeOf(step.from) === l.via;
      if (!takeOut) { addUp(l.a); addUp(l.from); }
      if (!putIn) { addUp(l.b); addUp(l.to); }
    }
    out.links = links; out.times = links.length; out.how = "msg";
    // A step about one kind of event (TIMER...) cannot be confirmed: the record keeps no event kinds.
    const kinds = (nodes["schema.event-kind"]?.values || []).map((v) => v[0]);
    if (links.some((l) => l.kind === "event") && kinds.includes(step.verb)) out.kindUnknown = step.verb;
  } else if ((step.kind === "call" || step.kind === "syscall") && fnNode(A) && fnNode(B) && has(A) && has(B)) {
    for (const s of slices) {
      if (s.n !== B || !inside(s) || !svcOk(s)) continue;
      const up = helpers.ancestor(s, (p) => p.n === A);
      if (up) { hit.add(s.id); hit.add(up.id); out.times++; }
    }
    out.how = "call";
    if (!out.times) {
      for (const s of slices) {
        if (s.n !== B || s.parent === null || !inside(s)) continue;
        const sib = slices[s.parent].children.map((i) => slices[i]);
        const k = sib.indexOf(s);
        if (k > 0 && sib[k - 1].n === A) { hit.add(s.id); hit.add(sib[k - 1].id); out.times++; }
      }
      out.how = "seq";
    }
  } else if ((step.kind === "call" || step.kind === "syscall") && absent.some((x) => nodes[x.id].kind === "func" && nodes[x.id].fn)) {
    // One end is not in the record (not recorded, or not called): say what the other end did.
    const here = [A, B].find((id) => id && has(id));
    if (here) {
      const ss = slices.filter((s) => s.n === here && inside(s));
      const count = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]); };
      out.instead = here === B
        ? { node: here, role: "callers", list: count(ss.map((s) => (s.parent === null ? null : slices[s.parent].fn || slices[s.parent].label))) }
        : { node: here, role: "callees", list: count(ss.flatMap((s) => helpers.descend(s, (c) => c.layer === nodes[B].layer).map((c) => c.fn))) };
    }
    out.how = "absent";
  } else if (A === "emulator.timer.clock" && step.kind === "signal") {
    for (const s of slices) if (s.kind === "irq" && s.cause === "timer") {
      hit.add(s.id); out.times++;
      for (const c of s.children) if (slices[c].n === B) hit.add(c);
    }
    out.how = "irq";
  } else {
    for (const s of slices) if (s.n && ids.has(s.n) && nodes[s.n].kind === "func" && inside(s) && svcOk(s)) hit.add(s.id);
    const main = [B, A].find((id) => id && has(id));
    out.times = main ? slices.filter((s) => s.n === main && inside(s)).length : 0;
    out.how = "nodes";
  }
  out.hits = [...hit].map((i) => slices[i]).sort((a, b) => a.start - b.start);
  return out;
}
