// Isometric projection and flat shapes, as SVG strings.
// World: x runs down-right on screen, y down-left, z up. One unit = one CSS pixel at zoom 1.

export const C = Math.cos(Math.PI / 6);
export const S = 0.5;
export const RX = Math.SQRT2 * C; // a circle of radius r on the floor is an ellipse r*RX by r*RY
export const RY = Math.SQRT2 * S;

export function P(x, y, z = 0) { return [(x - y) * C, (x + y) * S - z]; }
export const f1 = (n) => Math.round(n * 10) / 10;
export function pts(list) { return list.map(([x, y, z]) => P(x, y, z).map(f1).join(",")).join(" "); }

export function poly(list, cls, attrs = "") {
  return `<polygon class="${cls}" points="${pts(list)}" ${attrs}/>`;
}

/** Flat rectangle on a horizontal plane. */
export function rect(x0, y0, x1, y1, z, cls, attrs = "") {
  return poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], cls, attrs);
}

/** An axis-aligned box: top, the face toward +y (screen left) and the face toward +x (screen right). */
export function box(x0, y0, z0, w, d, h, cls = "bx", attrs = "") {
  const x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
  return (
    `<g class="${cls}" ${attrs}>` +
    poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], "fl") +
    poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], "fr") +
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], "ft") +
    `</g>`
  );
}

/** Screen bounding box of a world box. */
export function boxBounds(x0, y0, z0, w, d, h) {
  const xs = [], ys = [];
  for (const x of [x0, x0 + w]) for (const y of [y0, y0 + d]) for (const z of [z0, z0 + h]) {
    const [sx, sy] = P(x, y, z);
    xs.push(sx); ys.push(sy);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Upright cylinder centred on (cx, cy). */
export function cylinder(cx, cy, z0, r, h, cls = "cy", attrs = "") {
  const [bx, by] = P(cx, cy, z0);
  const [tx, ty] = P(cx, cy, z0 + h);
  const rx = r * RX, ry = r * RY;
  const side = `M${f1(bx - rx)},${f1(ty)} L${f1(bx - rx)},${f1(by)} A${f1(rx)},${f1(ry)} 0 0 0 ${f1(bx + rx)},${f1(by)} L${f1(bx + rx)},${f1(ty)} Z`;
  return (
    `<g class="${cls}" ${attrs}><path class="fs" d="${side}"/>` +
    `<ellipse class="ft" cx="${f1(tx)}" cy="${f1(ty)}" rx="${f1(rx)}" ry="${f1(ry)}"/></g>`
  );
}

export function ellipseOnFloor(cx, cy, z, r, cls, attrs = "") {
  const [x, y] = P(cx, cy, z);
  return `<ellipse class="${cls}" cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r * RX)}" ry="${f1(r * RY)}" ${attrs}/>`;
}

export function polyline(list, cls, attrs = "") {
  return `<polyline class="${cls}" points="${pts(list)}" ${attrs}/>`;
}

/** Text lying on a horizontal plane, running along +x (or +y when alongY). */
export function floorText(x, y, z, text, cls, alongY = false) {
  const [sx, sy] = P(x, y, z);
  // the x axis on screen is (C, S) and the y axis (-C, S); text is sheared onto that plane
  const m = alongY ? `matrix(${C},${-S},${C},${S},${f1(sx)},${f1(sy)})` : `matrix(${C},${S},${-C},${S},${f1(sx)},${f1(sy)})`;
  return `<text class="${cls}" transform="${m}">${esc(text)}</text>`;
}

/** Text on a vertical wall facing +y (it runs along +x) or facing +x (runs along -y). */
export function wallText(x, y, z, text, cls, facing = "y") {
  const [sx, sy] = P(x, y, z);
  const m = facing === "y" ? `matrix(${C},${S},0,1,${f1(sx)},${f1(sy)})` : `matrix(${C},${-S},0,1,${f1(sx)},${f1(sy)})`;
  return `<text class="${cls}" transform="${m}">${esc(text)}</text>`;
}

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Point at distance t along a polyline of world points; also returns the segment index. */
export function along(list, t) {
  let acc = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (acc + len >= t || i === list.length - 1) {
      const u = len ? Math.min(1, Math.max(0, (t - acc) / len)) : 1;
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u], seg: i - 1 };
    }
    acc += len;
  }
  return { p: list[list.length - 1], seg: list.length - 2 };
}
export function pathLength(list) {
  let acc = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return acc;
}
