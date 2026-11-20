// Without WebGL: the same layout (layout.js is pure geometry) drawn flat as an SVG, seen a little
// from above and in front, so the page still shows the stack, the blocks and the steps. Plates are
// bands, blocks are boxes, steps are paths in their state (done, current, coming) with numbers.
// Clicks go to the same places as in the 3D view.
import * as D from "./data.js";
import { DIM, samplePath } from "./layout.js";

const NS = "http://www.w3.org/2000/svg";
// oblique view: depth (z, toward the viewer) goes down and a little to the right
const P = (x, y, z) => [x + 0.14 * z, -0.8 * y + 0.5 * z];
const pts = (list) => list.map(([x, y, z]) => P(x, y, z).map((v) => v.toFixed(2)).join(",")).join(" ");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export class Flat {
  constructor(host, hooks = {}) {
    this.host = host;
    this.hooks = hooks;
    host.classList.add("flathost");
    this.st = { steps: {}, blocks: {}, active: null };
    host.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fbox]"), t = e.target.closest("[data-fstep]");
      if (t) return this.hooks.onPickTube?.(Number(t.dataset.fstep));
      if (b) return this.hooks.onPick?.(b.dataset.fbox);
      this.hooks.onPick?.(null);
    });
    new ResizeObserver(() => this.render()).observe(host);
  }
  build(scene, lay) { this.scene = scene; this.lay = lay; this.render(); }
  setState(st) { this.st = st; this.render(); }
  // the free part of the stage, between the title and the player (pixels)
  setMargins(m) { this.margins = m; this.render(); }

  render() {
    const sc = this.scene, lay = this.lay;
    if (!sc || !lay) return;
    const { W, H, D: BD, PLATE_T } = DIM;
    const m = this.margins || { t: 112, b: 118 };
    // a narrow screen gets the drawing at a readable width, scrolled sideways
    const narrow = this.host.clientWidth < 700;
    const w = Math.max(1, narrow ? 820 : this.host.clientWidth), h = Math.max(1, this.host.clientHeight - m.t - m.b);
    // the projected outline of the stack, plus room for the layer names on the left
    const cs = [];
    for (const x of [lay.bounds.x0, lay.bounds.x1]) for (const y of [lay.bounds.y0, lay.bounds.y1]) for (const z of [lay.bounds.z0, lay.bounds.z1]) cs.push(P(x, y, z));
    let X0 = Math.min(...cs.map((p) => p[0])), X1 = Math.max(...cs.map((p) => p[0]));
    let Y0 = Math.min(...cs.map((p) => p[1])), Y1 = Math.max(...cs.map((p) => p[1]));
    const k0 = Math.min((w - 150) / (X1 - X0), (h - 44) / (Y1 - Y0));
    const u = 1 / k0; // one pixel, in drawing units
    X0 -= 135 * u; X1 += 12 * u; Y0 -= 18 * u; Y1 += 22 * u;
    const steps = this.st.steps || {}, blocks = this.st.blocks || {};
    let g = "";
    // plates from the bottom up, each with its frames and blocks
    for (const band of [...lay.bands].reverse()) {
      const pl = lay.plates?.[band.id] || lay.plate;
      const y = band.y, yb = y - PLATE_T;
      g += `<g class="fplate" style="--c:var(--l-${band.tone})"${band.empty ? ` data-empty="1"` : ""}>`;
      g += `<polygon class="top" points="${pts([[pl.x0, y, pl.z0], [pl.x1, y, pl.z0], [pl.x1, y, pl.z1], [pl.x0, y, pl.z1]])}"/>`;
      g += `<polygon class="edge" points="${pts([[pl.x0, y, pl.z1], [pl.x1, y, pl.z1], [pl.x1, yb, pl.z1], [pl.x0, yb, pl.z1]])}"/>`;
      const [lx, ly] = P(pl.x0, y - PLATE_T / 2, pl.z1);
      g += `<text class="pn" x="${(lx - 10 * u).toFixed(2)}" y="${(ly - 3 * u).toFixed(2)}" style="font-size:${(14 * u).toFixed(3)}px">${esc(band.name)}</text>`;
      g += `<text class="ps" x="${(lx - 10 * u).toFixed(2)}" y="${(ly + 12 * u).toFixed(2)}" style="font-size:${(11 * u).toFixed(3)}px">${esc(band.sub || "")}</text>`;
      for (const r of lay.regions) for (const rc of r.rects) if (rc.band === band.id) {
        g += `<polygon class="freg" points="${pts([[rc.x0, y, rc.z0], [rc.x1, y, rc.z0], [rc.x1, y, rc.z1], [rc.x0, y, rc.z1]])}" style="stroke-width:${(1.2 * u).toFixed(3)}px;stroke-dasharray:${(5 * u).toFixed(2)} ${(4 * u).toFixed(2)}"/>`;
      }
      const bs = Object.values(lay.boxes).filter((b) => b.band === band.id).sort((a, b) => a.x - b.x);
      for (const b of bs) {
        const x0 = b.x - W / 2, x1 = b.x + W / 2, z0 = b.z - BD / 2, z1 = b.z + BD / 2;
        const role = blocks[b.id] || "";
        g += `<g class="fblock${role ? ` ${role}` : ""}" data-fbox="${esc(b.id)}" style="--c:var(--l-${band.tone})">`;
        g += `<polygon class="ftop" points="${pts([[x0, y + H, z0], [x1, y + H, z0], [x1, y + H, z1], [x0, y + H, z1]])}"/>`;
        g += `<polygon class="ffront" points="${pts([[x0, y + H, z1], [x1, y + H, z1], [x1, y, z1], [x0, y, z1]])}"/>`;
        g += `<polygon class="ffoot" points="${pts([[x0, y + H * 0.3, z1], [x1, y + H * 0.3, z1], [x1, y, z1], [x0, y, z1]])}"/>`;
        const [tx, ty] = P(b.x, y, z1);
        const spec = sc.box[b.id];
        // the recorded run's blocks are many and close together: their function name only
        const name = sc.type === "trace" ? spec?.short || spec?.title : spec?.title;
        g += `<text class="bt" x="${tx.toFixed(2)}" y="${(ty + 14 * u).toFixed(2)}" style="font-size:${((sc.type === "trace" ? 10.5 : 12) * u).toFixed(3)}px">${esc(name || b.id)}</text>`;
        g += `</g>`;
      }
      g += `</g>`;
    }
    // steps: the coming ones first, so the done and current ones are drawn over them
    const rank = { future: 0, dim: 0, past: 1, active: 2 };
    const tubes = [...lay.tubes].sort((a, b) => (rank[steps[a.i] || "future"] - rank[steps[b.i] || "future"]));
    let badges = "", activeX = null;
    for (const t of tubes) {
      const s = sc.steps[t.i];
      const state = steps[t.i] || "future";
      const line = samplePath(t.segs, 16).map(([x, y, z]) => P(x, y, z).map((v) => v.toFixed(2)).join(",")).join(" ");
      const wpx = state === "active" ? 3.2 : s.kind === "syscall" ? 2.6 : 1.8;
      const dash = { return: "5 4", msg: "10 4", signal: "2 4" }[s.kind];
      g += `<polyline class="fstep ${state}${s.alt ? " alt" : ""}" data-fstep="${t.i}" points="${line}" style="stroke-width:${(wpx * u).toFixed(3)}px${dash ? `;stroke-dasharray:${dash.split(" ").map((v) => (v * u).toFixed(2)).join(" ")}` : ""}" marker-end="url(#fa-${state === "active" ? "on" : state === "past" ? "past" : "off"})"/>`;
      const mid = samplePath(t.segs, 16);
      const [mx, my] = P(...mid[Math.floor(mid.length / 2)]);
      const label = s.alt ? s.name : String(s.num);
      if (state === "active") activeX = mx;
      const text = state === "active" ? `${label}  ${s.verb || D.STEP_KIND_SHORT[s.kind] || ""}` : label;
      const bw = (state === "active" ? 14 + text.length * 11 : 10 + label.length * 7) * u, bh = (state === "active" ? 22 : 18) * u;
      badges += `<g class="fbadge ${state}${s.alt ? " alt" : ""}" data-fstep="${t.i}"><rect x="${(mx - bw / 2).toFixed(2)}" y="${(my - bh / 2).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="${(bh / 2).toFixed(2)}" style="stroke-width:${(1.4 * u).toFixed(3)}px"/><text x="${mx.toFixed(2)}" y="${(my + 4 * u).toFixed(2)}" style="font-size:${(state === "active" ? 12 : 10.5) * u}px">${esc(text)}</text></g>`;
    }
    const mk = (id, cls) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="${cls}"/></marker>`;
    this.host.innerHTML = `<svg class="flat" style="top:${m.t}px;bottom:${m.b}px;height:${h}px;width:${w}px" viewBox="${X0.toFixed(2)} ${Y0.toFixed(2)} ${(X1 - X0).toFixed(2)} ${(Y1 - Y0).toFixed(2)}" role="img" aria-label="${esc(sc.title)}（平面の図）"><defs>${mk("fa-on", "on")}${mk("fa-past", "past")}${mk("fa-off", "off")}</defs>${g}${badges}</svg>`;
    if (narrow && activeX != null) {
      const k = Math.min(w / (X1 - X0), h / (Y1 - Y0));
      this.host.scrollLeft = Math.max(0, (activeX - X0) * k - this.host.clientWidth / 2);
    }
  }
}
