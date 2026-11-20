// Small helpers shared by every part of the story. Everything hangs off window.S.
(function () {
  const S = (window.S = window.S || {});
  S.A = window.ATLAS;
  S.C = window.ATLAS_CODE || { nodes: {}, steps: {}, files: {} };

  S.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.smooth = (a, b, x) => { const t = S.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  S.easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  S.num = (n) => Number(n).toLocaleString('en-US');
  S.isJa = (s) => /[　-ヿ一-鿿＀-￯]/.test(String(s));
  S.codeLike = (s) => /^[\w.()\[\]*&,\s<>:=−\-+]+$/.test(String(s)) && !S.isJa(s);
  S.reduceMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  // Below this width the picture sits on top of the text (keep in step with style.css).
  const NARROW = (() => { try { return matchMedia('(max-width: 1199.98px)'); } catch (e) { return { matches: false }; } })();
  S.narrow = () => NARROW.matches;
  // "右の図" beside the text, "上の図" when the picture sits on top (CSS shows one of the two).
  S.SIDE = '<span class="side"><span class="s-r">右</span><span class="s-t">上</span></span>';

  S.FONT = {
    sans: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Noto Sans CJK JP", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono", "Noto Sans Mono CJK JP", monospace',
  };
  const cv = document.createElement('canvas').getContext('2d');
  // Width of a string as the browser will draw it.
  S.textW = (s, size, opt = {}) => {
    cv.font = `${opt.weight || 400} ${size}px ${opt.mono ? S.FONT.mono : S.FONT.sans}`;
    return cv.measureText(String(s)).width;
  };

  // SVG element factory.
  const NS = 'http://www.w3.org/2000/svg';
  S.svg = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  S.html = (tag, attrs = {}, inner) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
    if (inner != null) e.innerHTML = inner;
    return e;
  };

  // Smooth pan-and-zoom between two views, after van Wijk and Nuij (as d3.interpolateZoom does).
  // A view is [cx, cy, w]: the centre and the width of the world that is visible.
  S.zoomPath = (p0, p1) => {
    const rho = Math.SQRT2, rho2 = 2, rho4 = 4;
    const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1;
    const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    let f, S0;
    if (d2 < 1e-12) {
      S0 = Math.log(w1 / w0) / rho;
      f = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S0)];
    } else {
      const d1 = Math.sqrt(d2);
      const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S0 = (r1 - r0) / rho;
      f = (t) => {
        const s = t * S0, c0 = Math.cosh(r0);
        const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
        return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
      };
    }
    f.duration = Math.abs(S0) * 1000;
    return f;
  };

  S.unionRect = (rs) => {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  S.grow = (r, m, my = m) => ({ x: r.x - m, y: r.y - my, w: r.w + 2 * m, h: r.h + 2 * my });
})();
