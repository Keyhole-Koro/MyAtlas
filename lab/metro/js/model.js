// Builds the metro model from the atlas: lines (flows and papers), stations (one per node id),
// track (the station pairs a line runs between) and the timetable of every line.
// Pure data in, data out: used by the page and by tools/precompute.mjs (node).

// Line colours: deliberately not the layer colours (those tint the districts behind the map).
// Checked pair by pair with CIEDE2000: every pair is 21 apart or more in light, 18 or more in dark
// (E is teal in both, so it is no longer a second lavender next to G in the dark).
const LINE_STYLE = {
  ui: { code: "U", light: "#e0262f", dark: "#ff6b6b" },
  cpu: { code: "C", light: "#0b8bcb", dark: "#45b8f2" },
  "os.gateway": { code: "G", light: "#7a4cc7", dark: "#9d7cf5" },
  "os.submit": { code: "S", light: "#9c1c5f", dark: "#e879c9" },
  "app.tasks": { code: "T", light: "#3d434a", dark: "#d3d8de" },
  "kernel.cpu-time": { code: "E", light: "#0f766e", dark: "#3cc6b4" },
};
const SPARE = [
  ["#0f766e", "#5eead4"], ["#a16207", "#facc15"], ["#be123c", "#fb7185"], ["#4d7c0f", "#a3e635"],
];

export const KIND_NAME = {
  func: "関数", store: "置き場", schema: "型（struct）", enum: "列挙", context: "実行の文脈",
  hw: "ハードウェア", note: "決まり", figure: "図",
};
export const STEP_KIND = {
  call: "呼び出し", syscall: "syscall", msg: "列を通す", signal: "通知", data: "読み書き", return: "戻り",
};

const isCodeName = (s) => /^[\x20-\x7e]+$/.test(s) || /[_(\[.]/.test(s);

function uniq(list) {
  return [...new Set(list)];
}

export function buildModel(atlas, code) {
  const nodes = atlas.nodes;
  const layers = atlas.layers.filter((l) => !l.cross);
  const layerIndex = Object.fromEntries(layers.map((l, i) => [l.id, i]));

  // Which node holds which paper ("the paper inside").
  const parentOf = {};
  for (const [id, n] of Object.entries(nodes)) if (n.paper) parentOf[n.paper] = id;

  // ---- lines ---------------------------------------------------------------------------
  const raw = [
    ...atlas.flows.map((f) => ({ src: f, kind: "flow" })),
    ...Object.values(atlas.papers).map((p) => ({ src: p, kind: "paper" })),
  ];
  const usedCodes = new Set();
  let spare = 0;
  const lines = raw.map(({ src, kind }) => {
    const style = LINE_STYLE[src.id];
    let codeLetter = style?.code;
    if (!codeLetter || usedCodes.has(codeLetter)) {
      const letters = (src.tab + src.id).toUpperCase().replace(/[^A-Z]/g, "");
      codeLetter = [...letters].find((c) => !usedCodes.has(c)) || "?";
    }
    usedCodes.add(codeLetter);
    const colour = style ? { light: style.light, dark: style.dark }
      : { light: SPARE[spare % SPARE.length][0], dark: SPARE[spare++ % SPARE.length][1] };
    const boxNode = Object.fromEntries(src.boxes.map((b) => [b.id, b.node]));
    return {
      id: src.id, kind, code: codeLetter, colour,
      name: kind === "flow" ? src.tab : src.title, // "UI の要求" / "request_gateway.request の中"
      tab: src.tab, title: src.title,
      parent: kind === "paper" ? parentOf[src.id] || null : null,
      entry: src.entry ? boxNode[src.entry] : null,
      ports: src.ports ? Object.entries(src.ports).map(([outer, box]) => ({ outer, inner: boxNode[box] })) : [],
      regions: (src.regions || []).map((r) => ({ ...r, nodes: r.boxes.map((b) => boxNode[b]) })),
      bands: src.bands || null,
      start: src.start || null,
      boxes: src.boxes,
      boxNode,
      src,
    };
  });
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));

  // Order: flows first, then each paper after the line whose station holds it (depth first).
  const ordered = [];
  const seen = new Set();
  const visit = (line) => {
    if (seen.has(line.id)) return;
    seen.add(line.id);
    ordered.push(line);
    for (const b of line.src.boxes) {
      const n = nodes[b.node];
      if (n?.paper && lineById[n.paper]) visit(lineById[n.paper]);
    }
  };
  lines.filter((l) => l.kind === "flow").forEach(visit);
  lines.forEach(visit);
  const flowsFirst = [...ordered.filter((l) => l.kind === "flow"), ...ordered.filter((l) => l.kind === "paper")];

  // ---- stations ------------------------------------------------------------------------
  const stations = {};
  const touch = (nodeId, line, box) => {
    const n = nodes[nodeId];
    if (!n) return null;
    let s = stations[nodeId];
    if (!s) {
      s = stations[nodeId] = {
        id: nodeId, node: n, layer: n.layer in layerIndex ? n.layer : null, kind: n.kind,
        lines: [], boxes: [], name: null, sub: null,
      };
    }
    if (!s.lines.includes(line.id)) s.lines.push(line.id);
    if (box) s.boxes.push({ line: line.id, box });
    return s;
  };
  for (const line of flowsFirst) for (const b of line.src.boxes) touch(b.node, line, b);
  // A paper's box layer is one of its bands; a station's district is always its node's layer.
  for (const s of Object.values(stations)) {
    if (!s.layer) {
      const b = s.boxes.find((x) => x.box.layer in layerIndex);
      s.layer = b ? b.box.layer : layers[0].id;
    }
    const first = s.boxes[0]?.box;
    const line = lineById[s.boxes[0]?.line];
    s.name = first?.title || s.node.title;
    const band = line?.bands?.find((x) => x.id === first?.layer);
    s.sub = first?.sub
      || (first?.slots ? uniq(first.slots).join("・") : "")
      || (first?.bits ? first.bits.map((x) => x[0]).join("・") : "")
      || (band ? band.name : "");
    s.codeName = isCodeName(s.name);
    s.short = first?.short || null;
    // The box's namespace (Tasks, scheduler, request_gateway...): two functions can share a short
    // name (tick() and tick(sp)), so the map and the panels show it like the reference viewer does.
    s.ns = first?.ns || s.boxes.find((b) => b.box.ns && b.box.title === s.name)?.box.ns || null;
    // "app_transport.request(m)" is real code only when the node's fn says so (OS_CALL is not
    // syscall.OS_CALL): then the namespace joins the name with a dot, otherwise it stands apart.
    const bare = s.name.replace(/\(.*$/, "");
    s.nsDot = !!s.ns && s.node.fn === `${s.ns}.${bare}`;
  }

  // ---- track and timetable -------------------------------------------------------------
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edges = {}; // key -> {key, a, b, lines: {lineId: {type, steps:[]}}}
  const addTrack = (lineId, from, to, type, step) => {
    if (!from || !to || from === to || !stations[from] || !stations[to]) return;
    const key = pairKey(from, to);
    const e = edges[key] || (edges[key] = { key, a: key.split("|")[0], b: key.split("|")[1], lines: {} });
    const use = e.lines[lineId] || (e.lines[lineId] = { type, steps: [] });
    // A pair that carries a real step is solid track, even if it also links a paper or has a "もし".
    const rank = { step: 3, alt: 2, link: 1 };
    if (rank[type] > rank[use.type]) use.type = type;
    if (step) use.steps.push(step);
  };

  for (const line of flowsFirst) {
    const stops = [];
    const addStop = (id) => { if (id && stations[id] && !stops.includes(id)) stops.push(id); };
    const codeSteps = code?.steps?.[line.id] || {};
    // A paper starts inside its parent: the parent is where one changes into it.
    if (line.parent && stations[line.parent]) {
      if (!stations[line.parent].lines.includes(line.id)) stations[line.parent].lines.push(line.id);
      addStop(line.parent);
    }
    let main = 0;
    line.steps = line.src.steps.map((st, idx) => {
      const from = line.boxNode[st.from];
      const to = line.boxNode[st.to];
      const isAlt = !!st.alt;
      if (!isAlt) main++;
      const step = {
        line: line.id, idx, num: isAlt ? null : main, alt: st.alt || null,
        altLabel: isAlt ? `${st.alt.when}（${st.alt.at + 1} の代わり）` : null,
        kind: st.kind, kindName: STEP_KIND[st.kind] || st.kind, verb: st.verb || "",
        label: st.label || "", from, to, fromBox: st.from, toBox: st.to,
        data: st.data || null, ops: st.ops || null, branches: st.branches || null, ref: st.ref || null,
        // code.json keys steps by their 0-based position in the document.
        where: codeSteps[String(idx)] || null,
      };
      addStop(from);
      addStop(to);
      addTrack(line.id, from, to, isAlt ? "alt" : "step", step);
      return step;
    });
    if (line.parent && line.entry) addTrack(line.id, line.parent, line.entry, "link", null);
    // Where the line starts: the first station of its first step (始発).
    line.origin = line.steps.find((s) => !s.alt)?.from || null;
    // Ports (where the paper meets the flow outside) are listed in the timetable and marked on
    // the map when the line is open; drawn as track they would cross the whole map.
    line.ports = line.ports.filter((p) => stations[p.outer] && stations[p.inner]);
    line.stops = stops;
  }

  for (const s of Object.values(stations)) {
    s.lines.sort((a, b) => flowsFirst.findIndex((l) => l.id === a) - flowsFirst.findIndex((l) => l.id === b));
    s.interchange = s.lines.length > 1;
  }

  // Steps that touch a station, for its card.
  const stepsAt = {};
  for (const line of flowsFirst) {
    for (const st of line.steps) {
      for (const id of [st.from, st.to]) (stepsAt[id] ||= []).push(st);
    }
  }

  // The recorded run: how often each node was entered ("乗降").
  const traces = (atlas.traces || []).map((t) => {
    const counts = {};
    for (const e of t.events) if (e.n) counts[e.n] = (counts[e.n] || 0) + 1;
    return { ...t, counts, lastInstr: t.events.length ? t.events[t.events.length - 1].instr : 0 };
  });

  return {
    title: atlas.title, layers, layerIndex, lines: flowsFirst, lineById, stations, edges: Object.values(edges),
    stepsAt, nodes, code, traces, parentOf,
  };
}

// [[id]] and ![[id]] split into text and link parts.
export function parseLinks(text) {
  const out = [];
  const re = /(!?)\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text || ""))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: m[1] ? "embed" : "link", v: m[2] });
    last = re.lastIndex;
  }
  if (last < (text || "").length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

// A stable signature of the map's shape: stations, their districts and the pairs the lines run
// between. Text (names, subs) is left out: the page places labels itself, so editing a box's text
// does not make the stored grid stale.
export function layoutSignature(model) {
  const parts = [
    model.layers.map((l) => l.id).join(","),
    Object.values(model.stations).map((s) => `${s.id}@${s.layer}`).sort().join(";"),
    model.edges.map((e) => `${e.key}=${Object.keys(e.lines).sort().join("+")}`).sort().join(";"),
  ].join("#");
  let h = 2166136261;
  for (let i = 0; i < parts.length; i++) { h ^= parts.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
