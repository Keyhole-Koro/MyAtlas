// Camera: cam.x/cam.y is the world point at the canvas' top-left, cam.k the zoom (screen px per world unit).
export const cam = { x: 0, y: 0, k: 0.2 };
export const LIMIT = { kMin: 0.02, kMax: 7 };
let viewW = 1, viewH = 1, bounds = { x: 0, y: 0, w: 1, h: 1 };
let fly = null, wheel = null, inertia = null;
const listeners = [];

export function setView(w, h) { viewW = w; viewH = h; }
export function setBounds(b) { bounds = b; }
export const view = () => ({ W: viewW, H: viewH });
export const toWorld = (sx, sy) => ({ x: cam.x + sx / cam.k, y: cam.y + sy / cam.k });
export function onMove(fn) { listeners.push(fn); }
const clampK = (k) => Math.max(LIMIT.kMin, Math.min(LIMIT.kMax, k));

// Keep some of the world on screen.
function clampPos() {
  const mx = viewW / cam.k * 0.6, my = viewH / cam.k * 0.6;
  cam.x = Math.max(bounds.x - mx, Math.min(bounds.x + bounds.w - viewW / cam.k + mx, cam.x));
  cam.y = Math.max(bounds.y - my, Math.min(bounds.y + bounds.h - viewH / cam.k + my, cam.y));
}

export function stopAll() { fly = null; wheel = null; inertia = null; }
export const busy = () => !!(fly || wheel || inertia);

// Wheel zoom: eased toward a target, anchored at the cursor.
export function wheelZoom(sx, sy, factor) {
  fly = null; inertia = null;
  const k0 = wheel ? wheel.k : cam.k;
  const anchor = toWorld(sx, sy);
  wheel = { k: clampK(k0 * factor), sx, sy, ax: anchor.x, ay: anchor.y };
}
export function zoomAt(sx, sy, factor) {
  const a = toWorld(sx, sy);
  cam.k = clampK(cam.k * factor);
  cam.x = a.x - sx / cam.k; cam.y = a.y - sy / cam.k;
  clampPos();
}
export function panBy(dx, dy) { cam.x -= dx / cam.k; cam.y -= dy / cam.k; clampPos(); }
export function startInertia(vx, vy) { if (Math.hypot(vx, vy) > 0.05) inertia = { vx, vy, t: performance.now() }; }

// A smooth "zoom out, move, zoom in" flight (van Wijk and Nuij), as maps do.
function interpolateZoom(p0, p1) {
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4;
  const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1;
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  let i, S;
  if (d2 < 1e-9) {
    S = Math.log(w1 / w0) / rho;
    i = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / rho;
    i = (t) => {
      const s = t * S, c0 = Math.cosh(r0);
      const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
    };
  }
  i.duration = Math.abs(S) * 1000 * rho / Math.SQRT2;
  return i;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Fly so that the world point (cx, cy) sits at screen point (sx, sy) at zoom k.
export function flyTo(target, opts = {}) {
  wheel = null; inertia = null;
  const k1 = clampK(target.k);
  const sx = target.sx != null ? target.sx : viewW / 2, sy = target.sy != null ? target.sy : viewH / 2;
  const x1 = target.cx - sx / k1, y1 = target.cy - sy / k1;
  if (opts.instant) { cam.x = x1; cam.y = y1; cam.k = k1; fly = null; return; }
  const p0 = [cam.x + viewW / 2 / cam.k, cam.y + viewH / 2 / cam.k, viewW / cam.k];
  const p1 = [x1 + viewW / 2 / k1, y1 + viewH / 2 / k1, viewW / k1];
  const interp = interpolateZoom(p0, p1);
  const dur = Math.max(opts.min || 450, Math.min(opts.max || 1500, interp.duration * (opts.speed || 0.9)));
  fly = { interp, t0: performance.now(), dur, done: opts.done };
}
// The camera that fits a world rect into the free part of the screen.
export function fitCam(rect, safe, maxK = LIMIT.kMax, minK = LIMIT.kMin) {
  const aw = Math.max(50, viewW - safe.l - safe.r), ah = Math.max(50, viewH - safe.t - safe.b);
  const k = Math.max(minK, Math.min(maxK, Math.min(aw / rect.w, ah / rect.h)));
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, k, sx: safe.l + aw / 2, sy: safe.t + ah / 2 };
}

// One animation step. Returns true while something moves.
export function step(now) {
  let moving = false;
  if (fly) {
    const t = Math.min(1, (now - fly.t0) / fly.dur);
    const [ux, uy, w] = fly.interp(ease(t));
    cam.k = viewW / w; cam.x = ux - viewW / 2 / cam.k; cam.y = uy - viewH / 2 / cam.k;
    moving = true;
    if (t >= 1) { const d = fly.done; fly = null; if (d) d(); }
  }
  if (wheel) {
    const lk = Math.log(cam.k), tk = Math.log(wheel.k);
    const nk = Math.abs(tk - lk) < 0.002 ? wheel.k : Math.exp(lk + (tk - lk) * 0.24);
    cam.k = nk;
    cam.x = wheel.ax - wheel.sx / cam.k; cam.y = wheel.ay - wheel.sy / cam.k;
    clampPos();
    if (nk === wheel.k) wheel = null;
    moving = true;
  }
  if (inertia) {
    const dt = Math.min(40, now - inertia.t); inertia.t = now;
    panBy(inertia.vx * dt, inertia.vy * dt);
    const f = Math.pow(0.93, dt / 16.7);
    inertia.vx *= f; inertia.vy *= f;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.02) inertia = null;
    moving = true;
  }
  if (moving) for (const fn of listeners) fn();
  return moving;
}
