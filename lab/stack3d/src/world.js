// The WebGL scene: translucent plates stacked by layer, blocks on them, tubes for the steps,
// a glowing particle that carries the current step. Labels are not drawn here (see labels.js);
// this module only tells where things are on the screen.
import * as T from "../vendor/three-bundle.js";
import { DIM } from "./layout.js";

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const PALETTES = {
  light: {
    layer: { app: "#eb6834", lib: "#1baf7a", os: "#eda100", kernel: "#e87ba4", emu: "#008300" },
    accent: "#2f5bd3", plateMix: 0.6, plateOpacity: 0.3, plateEmpty: 0.14,
    block: "#fdfcf9", blockRough: 0.55, tray: "#f3f1ec", tile: "#ffffff",
    past: "#7d93cf", future: "#a7abb4", futureOpacity: 0.55, alt: "#c0643a",
    region: "#6d6b66", hole: "#2a2926", shadow: 0.2, chip: "#26272b", paper: "#ffffff",
    env: 0.55, hemi: [0xffffff, 0xb8b2a6, 0.9], key: 2.1,
  },
  dark: {
    layer: { app: "#d95926", lib: "#199e70", os: "#c98500", kernel: "#d55181", emu: "#008300" },
    accent: "#7c9dff", plateMix: 0.88, plateOpacity: 0.45, plateEmpty: 0.24,
    block: "#4d5361", blockRough: 0.45, tray: "#41464f", tile: "#5d6474",
    past: "#6f86cf", future: "#5b6170", futureOpacity: 0.75, alt: "#e08a5f",
    region: "#a19f97", hole: "#000000", shadow: 0.5, chip: "#16171b", paper: "#e9e7e1",
    env: 0.4, hemi: [0xbfc6dd, 0x15161a, 0.7], key: 1.5,
    // without the environment light (lite drawing) the dark blocks need their own glow
    lite: { block: "#7d8496", blockGlow: "#2a2f3c", past: "#8ea2e6", future: "#6c7282", hemi: [0xd5dbee, 0x2a2c33, 1.15], key: 1.7 },
  },
};

// The map draws a data step with a dot where it starts; here it is a bead and a thinner tube.
const KIND_STYLE = {
  call: { r: 0.13, dash: 0, gap: 0 },
  syscall: { r: 0.2, dash: 0, gap: 0 },
  return: { r: 0.1, dash: 0.5, gap: 0.34 },
  msg: { r: 0.13, dash: 1.1, gap: 0.34 },
  signal: { r: 0.1, dash: 0.2, gap: 0.26 },
  data: { r: 0.075, dash: 0, gap: 0, bead: true },
};

// Materials: physically based when the GPU can afford it, Lambert in the lite mode (software
// renderers such as SwiftShader or llvmpipe).
let LITE = false;
const PBR_KEYS = ["roughness", "metalness", "clearcoat", "clearcoatRoughness", "envMapIntensity"];
function mat(params = {}, physical = false) {
  if (LITE) {
    const p = { ...params };
    for (const k of PBR_KEYS) delete p[k];
    return new T.MeshLambertMaterial(p);
  }
  return physical ? new T.MeshPhysicalMaterial(params) : new T.MeshStandardMaterial(params);
}

function tubeMaterial() {
  const u = {
    uLen: { value: 1 }, uDash: { value: 0 }, uGap: { value: 0 }, uProg: { value: 1 }, uEnd: { value: 1 },
    uFlow: { value: 0 }, uTime: { value: 0 }, uGlow: { value: new T.Color("#ffffff") },
  };
  const m = mat({ color: "#888888", roughness: 0.38, metalness: 0.05 });
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vS;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvS = uv.x;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vS;\nuniform float uLen, uDash, uGap, uProg, uEnd, uFlow, uTime;\nuniform vec3 uGlow;")
      .replace("void main() {", "void main() {\n  if (vS > min(uProg, uEnd)) discard;\n  float sArc = vS * uLen;\n  if (uDash > 0.0 && mod(sArc, uDash + uGap) > uDash) discard;")
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\n  float band = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin((sArc - uTime * 7.0) * 1.15));\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uGlow, uFlow * band * 0.75);");
  };
  m.customProgramCacheKey = () => "atlas-tube";
  return m;
}

// Mix two colours the way a designer would (in sRGB, not in linear light).
function mixSRGB(a, b, k) {
  const ca = new T.Color(a).getHex(T.SRGBColorSpace), cb = new T.Color(b).getHex(T.SRGBColorSpace);
  const ch = (c, s) => (c >> s) & 255;
  const m = (s) => Math.round(ch(ca, s) * (1 - k) + ch(cb, s) * k);
  return new T.Color().setHex((m(16) << 16) | (m(8) << 8) | m(0), T.SRGBColorSpace);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let SHADOW_TEX = null, GLOW_TEX = null, PAPER_TEX = null, HOLE_TEX = null, GRID_TEX = {};
// a faint grid on the floor under the stack, fading out toward the edges
function gridTex(dark) {
  return GRID_TEX[dark] ||= canvasTexture(1024, 1024, (g, w) => {
    const step = w / 32;
    g.strokeStyle = dark ? "rgba(255,255,255,0.5)" : "rgba(40,40,30,0.55)";
    g.lineWidth = 1.5;
    for (let i = 0; i <= 32; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, w); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(w, i * step); g.stroke();
    }
    g.globalCompositeOperation = "destination-in";
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.55, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}
function shadowTex() {
  return SHADOW_TEX ||= canvasTexture(256, 256, (g, w, h) => {
    g.filter = "blur(18px)";
    g.fillStyle = "rgba(0,0,0,1)";
    const r = 40, x = 52, y = 52, ww = w - 104, hh = h - 104;
    g.beginPath(); g.roundRect(x, y, ww, hh, r); g.fill();
  });
}
function glowTex() {
  return GLOW_TEX ||= canvasTexture(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gr.addColorStop(0.6, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}
function paperTex() {
  return PAPER_TEX ||= canvasTexture(256, 180, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(60,60,70,0.35)";
    for (let i = 0; i < 6; i++) g.fillRect(26, 30 + i * 22, (i % 3 === 2 ? 0.55 : 0.8) * (w - 52), 7);
    g.strokeStyle = "rgba(47,91,211,0.9)"; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
}
function holeTex() {
  return HOLE_TEX ||= canvasTexture(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, "rgba(0,0,0,0.75)"); gr.addColorStop(0.55, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
}

function roundedRectPoints(x0, z0, x1, z1, r, y, seg = 6) {
  const pts = [];
  const corners = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI], [x1 - r, z0 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
  }
  pts.push(pts[0], pts[1], pts[2]);
  return pts;
}

export class World {
  constructor(host, hooks = {}, opts = {}) {
    this.host = host;
    this.hooks = hooks;
    this.dark = false;
    this.pal = PALETTES.light;
    this.lite = LITE = !!opts.lite;
    const r = new T.WebGLRenderer({ antialias: !this.lite, alpha: true, powerPreference: "high-performance" });
    r.setPixelRatio(this.lite ? Math.min(window.devicePixelRatio || 1, 1) * 0.85 : Math.min(window.devicePixelRatio || 1, 2));
    r.toneMapping = T.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    r.domElement.className = "gl";
    host.appendChild(r.domElement);

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(30, 1, 0.5, 900);
    this.controls = new T.OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true,
      minDistance: 10, maxDistance: 220, minPolarAngle: 0.12 * Math.PI, maxPolarAngle: 0.56 * Math.PI,
      rotateSpeed: 0.7, zoomSpeed: 0.9, panSpeed: 0.9,
    });
    this.controls.addEventListener("start", () => { this.userMoved = true; this.hooks.onUserCamera?.(); });

    if (!this.lite) {
      const pm = new T.PMREMGenerator(r);
      this.scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    }
    this.hemi = new T.HemisphereLight(0xffffff, 0xdddddd, 1);
    this.key = new T.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(-22, 46, 14);
    this.scene.add(this.hemi, this.key);

    this.root = new T.Group();
    this.scene.add(this.root);
    this.time = 0;
    this.tweens = [];
    this.camTween = null;
    this.follow = false;
    this.comet = null;
    this.blocks = {};
    this.tubes = {};
    this.pickables = [];
    this.tubeHits = [];
    this.hover = null;
    this.raycaster = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.size = { w: 1, h: 1 };
    this.lineMats = [];
    this.frameHooks = [];

    this.bindPointer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.last = this.born = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------- theme ----------
  setDark(dark) {
    this.dark = dark;
    const base = dark ? PALETTES.dark : PALETTES.light;
    this.pal = this.lite && base.lite ? { ...base, ...base.lite } : base;
    this.scene.environmentIntensity = this.pal.env;
    this.hemi.color.set(this.pal.hemi[0]);
    this.hemi.groundColor.set(this.pal.hemi[1]);
    this.hemi.intensity = this.pal.hemi[2];
    this.key.intensity = this.pal.key;
  }
  tone(id) {
    return this.pal.layer[id] || this.pal.accent;
  }

  // ---------- size & loop ----------
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.hooks.onResize?.(w, h);
  }

  loop(now) {
    // dt is clamped for the smoothing below; what moves through time (the comet, stripes,
    // tweens) reads the wall clock, so a slow renderer does not slow the story down
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time = (now - this.born) / 1000; // seconds since the start (small, for the shader's sake)
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
    for (const f of this.frameHooks) f(dt);
    requestAnimationFrame(this.loop);
  }

  tick(dt) {
    // tweens run on the wall clock, so slow frames do not stretch them
    const now = performance.now() / 1000;
    this.tweens = this.tweens.filter((tw) => {
      const k = clamp((now - tw.t0) / tw.dur, 0, 1);
      if (now >= tw.t0) tw.fn(tw.ease ? tw.ease(k) : k);
      if (k >= 1) { tw.done?.(); return false; }
      return true;
    });
    for (const t of Object.values(this.tubes)) t.mat.userData.u.uTime.value = this.time;
    this.updateComet(dt);
    // camera
    if (this.camTween) {
      const c = this.camTween;
      const k = clamp((performance.now() - c.t0) / c.dur, 0, 1), e = easeInOut(k);
      this.controls.target.lerpVectors(c.fromT, c.toT, e);
      this.camera.position.lerpVectors(c.fromP, c.toP, e);
      if (k >= 1) this.camTween = null;
    } else if (this.follow && this.comet && this.comet.visible) {
      const p = this.comet.head.position;
      const off = this.camera.position.clone().sub(this.controls.target);
      const want = this.followDist || 24;
      off.setLength(off.length() + (want - off.length()) * Math.min(1, dt * 2.2));
      this.controls.target.lerp(p, Math.min(1, dt * 3.2));
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.controls.update();
  }

  // ---------- build ----------
  clear() {
    this.tweens = [];
    this.hopper = null;
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.root.clear();
    this.blocks = {};
    this.tubes = {};
    this.plates = {};
    this.pickables = [];
    this.tubeHits = [];
    this.lineMats = [];
    this.comet = null;
    this.trail = null;
  }

  build(scene, lay, opts = {}) {
    this.clear();
    this.sceneSpec = scene;
    this.lay = lay;
    const P = this.pal;
    const animate = opts.animate !== false;
    const t0 = performance.now() / 1000;
    const { plate } = lay;

    // soft shadow under the whole stack
    const ground = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex(), transparent: true, opacity: P.shadow * 0.55, depthWrite: false, color: 0x000000 }));
    ground.rotation.x = -Math.PI / 2;
    ground.scale.set((plate.x1 - plate.x0) * 1.25, (plate.z1 - plate.z0) * 1.6, 1);
    ground.position.set((plate.x0 + plate.x1) / 2, lay.bounds.y0 - 2.2, 0.6);
    ground.renderOrder = -2;
    this.root.add(ground);
    const span = Math.max(plate.x1 - plate.x0, 30) * 1.7;
    const grid = new T.Mesh(new T.PlaneGeometry(span, span), new T.MeshBasicMaterial({ map: gridTex(this.dark), transparent: true, opacity: this.dark ? 0.09 : 0.11, depthWrite: false }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.set((plate.x0 + plate.x1) / 2, lay.bounds.y0 - 2.25, 0.6);
    grid.renderOrder = -3;
    this.root.add(grid);

    // plates
    this.plates = {};
    for (const band of lay.bands) {
      const plate = lay.plates?.[band.id] || lay.plate;
      const g = new T.Group();
      g.position.y = band.y;
      const col = this.dark
        ? mixSRGB(this.tone(band.tone), "#15161a", P.plateMix)
        : new T.Color(this.tone(band.tone)).lerp(new T.Color("#ffffff"), P.plateMix);
      const opacity = band.empty ? P.plateEmpty : P.plateOpacity;
      const pm = mat({
        color: col, transparent: true, opacity, roughness: 0.42, metalness: 0, clearcoat: this.dark ? 0.35 : 0.8, clearcoatRoughness: 0.35,
        depthWrite: false, side: this.lite ? T.FrontSide : T.DoubleSide,
      }, true);
      const w = plate.x1 - plate.x0, d = plate.z1 - plate.z0;
      const slab = new T.Mesh(new T.RoundedBoxGeometry(w, DIM.PLATE_T, d, this.lite ? 1 : 3, 0.32), pm);
      slab.position.set((plate.x0 + plate.x1) / 2, -DIM.PLATE_T / 2, (plate.z0 + plate.z1) / 2);
      slab.renderOrder = 1;
      g.add(slab);
      const lm = new T.LineMaterial({ color: this.tone(band.tone), linewidth: band.empty ? 1.2 : 2, transparent: true, opacity: band.empty ? 0.45 : 0.95, depthWrite: false });
      lm.resolution.set(this.size.w, this.size.h);
      this.lineMats.push(lm);
      const rim = new T.Line2(new T.LineGeometry().setPositions(roundedRectPoints(plate.x0 + 0.02, plate.z0 + 0.02, plate.x1 - 0.02, plate.z1 - 0.02, 0.3, 0.004)), lm);
      rim.computeLineDistances();
      rim.renderOrder = 2;
      g.add(rim);
      const lm2 = lm.clone();
      lm2.linewidth = 1; lm2.opacity = band.empty ? 0.25 : 0.5;
      this.lineMats.push(lm2);
      const rimB = new T.Line2(new T.LineGeometry().setPositions(roundedRectPoints(plate.x0 + 0.02, plate.z0 + 0.02, plate.x1 - 0.02, plate.z1 - 0.02, 0.3, -DIM.PLATE_T + 0.004)), lm2);
      rimB.computeLineDistances();
      g.add(rimB);
      this.root.add(g);
      this.plates[band.id] = { group: g, mat: pm, rim: lm, band, plate };
      if (animate) {
        pm.opacity = 0; lm.opacity = 0; lm2.opacity = 0;
        const to = opacity, rto = band.empty ? 0.45 : 0.95, r2 = band.empty ? 0.25 : 0.5;
        g.position.y = band.y - 1.2;
        this.tweens.push({ t0: t0 + band.i * 0.07, dur: 0.7, ease: easeOut, fn: (k) => { pm.opacity = to * k; lm.opacity = rto * k; lm2.opacity = r2 * k; g.position.y = band.y - 1.2 * (1 - k); } });
      }
    }

    // regions (execution contexts): dashed frames on the plates
    for (const reg of lay.regions) {
      const prev = [];
      for (const rc of reg.rects) {
        const lm = new T.LineMaterial({ color: P.region, linewidth: 1.2, dashed: true, dashSize: 0.42, gapSize: 0.36, transparent: true, opacity: 0.5, depthWrite: false });
        lm.resolution.set(this.size.w, this.size.h);
        this.lineMats.push(lm);
        const ln = new T.Line2(new T.LineGeometry().setPositions(roundedRectPoints(rc.x0, rc.z0, rc.x1, rc.z1, 0.55, rc.y + 0.012, 8)), lm);
        ln.computeLineDistances();
        ln.renderOrder = 3;
        this.root.add(ln);
        const fill = new T.Mesh(new T.PlaneGeometry(rc.x1 - rc.x0, rc.z1 - rc.z0), new T.MeshBasicMaterial({ color: P.region, transparent: true, opacity: this.dark ? 0.06 : 0.045, depthWrite: false }));
        fill.rotation.x = -Math.PI / 2;
        fill.position.set((rc.x0 + rc.x1) / 2, rc.y + 0.008, (rc.z0 + rc.z1) / 2);
        fill.renderOrder = 2;
        this.root.add(fill);
        if (animate) { lm.opacity = 0; this.tweens.push({ t0: t0 + 0.5, dur: 0.6, fn: (k) => { lm.opacity = 0.5 * k; } }); }
        prev.push(rc);
      }
    }

    // blocks
    const sortedBoxes = Object.values(lay.boxes).sort((a, b) => a.col - b.col || a.bi - b.bi);
    sortedBoxes.forEach((bx, order) => {
      const spec = scene.box[bx.id];
      const blk = this.makeBlock(spec, bx, scene);
      this.blocks[bx.id] = blk;
      this.root.add(blk.group);
      if (animate) {
        const drop = 3.2;
        blk.group.position.y = bx.y + drop;
        blk.group.scale.setScalar(0.001);
        blk.shadow.material.opacity = 0;
        this.tweens.push({ t0: t0 + 0.25 + order * 0.045, dur: 0.6, fn: (k) => {
          const e = easeOutBack(k);
          blk.group.position.y = bx.y + drop * (1 - easeOut(k));
          blk.group.scale.setScalar(Math.max(0.001, Math.min(1.08, 0.35 + 0.65 * e)));
          blk.shadow.material.opacity = P.shadow * k;
        }, done: () => blk.group.scale.setScalar(1) });
      }
    });

    // tubes
    for (const tb of lay.tubes) {
      const t = this.makeTube(tb, scene.steps[tb.i]);
      this.tubes[tb.i] = t;
      this.root.add(t.group);
      if (animate) {
        t.mat.userData.u.uProg.value = 0;
        t.cone.visible = false;
        this.tweens.push({ t0: t0 + 0.7 + tb.i * 0.06, dur: 0.55, ease: easeInOut, fn: (k) => { t.mat.userData.u.uProg.value = k; }, done: () => { t.cone.visible = true; } });
      }
    }

    this.makeComet();
    this.applyStates();
  }

  makeBlock(spec, bx, scene) {
    const P = this.pal;
    const node = window.ATLAS.nodes[spec.node] || {};
    const tone = this.tone(scene.bands[bx.bi].tone);
    const g = new T.Group();
    g.position.set(bx.x, bx.y, bx.z);
    const W = bx.w, H = bx.h, D = bx.d;
    const parts = [];
    const bodyMat = mat({ color: P.block, roughness: P.blockRough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.4 }, true);
    if (P.blockGlow) { bodyMat.emissive.set(P.blockGlow); bodyMat.userData.glow = P.blockGlow; }
    const capMat = mat({ color: tone, roughness: 0.5, metalness: 0 });
    const isRing = spec.node === "os.request-ring";
    const isHw = node.kind === "hw";
    const isStore = node.kind === "store" || (spec.slots && spec.slots.length);
    let topY = H;
    if (isRing) {
      // the request ring: a round tray of SLOTS cells (from kernel.channel)
      const ch = window.ATLAS.nodes["kernel.channel"];
      const n = ch?.shape?.roles?.n?.num || 32;
      const base = new T.Mesh(new T.CylinderGeometry(D * 0.62, D * 0.66, H * 0.55, 48), bodyMat);
      base.position.y = H * 0.275;
      const rim = new T.Mesh(new T.TorusGeometry(D * 0.63, 0.06, 8, 64), capMat);
      rim.rotation.x = Math.PI / 2; rim.position.y = H * 0.55;
      g.add(base, rim);
      parts.push(base);
      const cells = [];
      const cellGeo = new T.BoxGeometry(0.17, 0.32, 0.36);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const m = new T.Mesh(cellGeo, mat({ color: P.tile, roughness: 0.6 }));
        m.position.set(Math.cos(a) * D * 0.45, H * 0.55 + 0.16, Math.sin(a) * D * 0.45);
        m.rotation.y = -a;
        g.add(m);
        cells.push(m);
      }
      const marker = (color) => {
        const m = new T.Mesh(new T.ConeGeometry(0.13, 0.34, 12), mat({ color, roughness: 0.4 }));
        g.add(m);
        return m;
      };
      g.userData.ring = { n, cells, head: marker(P.past), tail: marker(P.accent), r: D * 0.45, y: H * 0.55 + 0.62 };
      topY = H * 0.55 + 0.32;
    } else if (isHw) {
      const body = new T.Mesh(new T.RoundedBoxGeometry(W, H * 0.8, D, 3, 0.12), mat({ color: this.dark ? "#121316" : "#2b2c30", roughness: 0.35, metalness: 0.2, clearcoat: 0.8 }, true));
      body.position.y = H * 0.4;
      g.add(body); parts.push(body);
      const pinMat = mat({ color: "#c9c3b5", roughness: 0.3, metalness: 0.9 });
      for (let i = 0; i < 9; i++) for (const s of [-1, 1]) {
        const pin = new T.Mesh(new T.BoxGeometry(0.16, 0.12, 0.36), pinMat);
        pin.position.set(-W / 2 + 0.45 + i * ((W - 0.9) / 8), 0.1, s * (D / 2 + 0.12));
        g.add(pin);
      }
      // the clock word: 24 bits of ticks and 8 bits of progress, side by side on top
      const bits = spec.bits || [["", 1]];
      const total = bits.reduce((a, b) => a + b[1], 0);
      let x = -W / 2 + 0.25;
      const usable = W - 0.5;
      bits.forEach(([, nb], j) => {
        const w = (usable * nb) / total - 0.08;
        const seg = new T.Mesh(new T.BoxGeometry(w, 0.1, D - 0.7), mat({ color: j === 0 ? tone : "#9aa0ad", roughness: 0.5, emissive: j === 0 ? tone : "#000000", emissiveIntensity: 0.25 }));
        seg.position.set(x + w / 2, H * 0.8 + 0.05, 0);
        g.add(seg);
        x += w + 0.08;
      });
      topY = H * 0.8 + 0.1;
    } else if (isStore) {
      const tray = new T.Mesh(new T.RoundedBoxGeometry(W, H * 0.55, D, 3, 0.16), bodyMat);
      tray.position.y = H * 0.275;
      g.add(tray); parts.push(tray);
      const band = new T.Mesh(new T.RoundedBoxGeometry(W + 0.06, H * 0.26, D + 0.06, 3, 0.16), capMat);
      band.position.y = H * 0.13;
      g.add(band); parts.push(band);
      const slots = spec.slots || [];
      const n = Math.max(1, slots.length);
      const gap = 0.14, tw = (W - 0.5 - gap * (n - 1)) / n;
      g.userData.tiles = [];
      for (let i = 0; i < n; i++) {
        const tile = new T.Mesh(new T.RoundedBoxGeometry(tw, H * 0.5, D - 0.6, 2, 0.08), mat({ color: new T.Color(tone).lerp(new T.Color(P.tile), this.dark ? 0.55 : 0.78), roughness: 0.55 }));
        tile.position.set(-W / 2 + 0.25 + tw / 2 + i * (tw + gap), H * 0.55 + H * 0.25, 0);
        g.add(tile);
        parts.push(tile);
        g.userData.tiles.push(tile);
      }
      topY = H * 1.05;
    } else {
      const body = new T.Mesh(new T.RoundedBoxGeometry(W, H, D, 4, 0.2), bodyMat);
      body.position.y = H / 2;
      g.add(body); parts.push(body);
      // the layer's colour as a band around the foot of the block; the top stays clean for the name
      const plinth = new T.Mesh(new T.RoundedBoxGeometry(W + 0.06, H * 0.34, D + 0.06, 3, 0.2), capMat);
      plinth.position.y = H * 0.17;
      g.add(plinth); parts.push(plinth);
      topY = H;
    }
    // a paper inside: a sheet sticks out of the top
    let sheet = null;
    if (node.paper) {
      sheet = new T.Mesh(new T.BoxGeometry(1.7, 1.2, 0.04), [
        mat({ color: P.paper }), mat({ color: P.paper }), mat({ color: P.paper }), mat({ color: P.paper }),
        mat({ map: paperTex(), roughness: 0.8 }), mat({ color: P.paper }),
      ]);
      sheet.position.set(W * 0.22, topY + 0.38, -D * 0.18);
      sheet.rotation.x = -0.22;
      sheet.userData.base = sheet.position.y;
      g.add(sheet);
      parts.push(sheet);
    }
    // outline for the active / selected state
    const outlineGeo = isRing
      ? new T.CylinderGeometry(D * 0.66 + 0.16, D * 0.7 + 0.16, topY + 0.25, 48)
      : new T.RoundedBoxGeometry(W + 0.24, topY + 0.2, D + 0.24, 3, 0.3);
    const outline = new T.Mesh(outlineGeo, new T.MeshBasicMaterial({ color: P.accent, side: T.BackSide, transparent: true, opacity: 0.0, depthWrite: false }));
    outline.position.y = (topY + 0.2) / 2 - 0.1;
    outline.visible = false;
    g.add(outline);
    // soft contact shadow on the plate
    const shadow = new T.Mesh(new T.PlaneGeometry(W + 1.6, D + 1.6), new T.MeshBasicMaterial({ map: shadowTex(), transparent: true, opacity: P.shadow, depthWrite: false, color: 0x000000 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(bx.x + 0.15, bx.y + 0.006, bx.z + 0.1);
    shadow.renderOrder = 2;
    this.root.add(shadow);
    for (const p of parts) { p.userData.box = bx.id; this.pickables.push(p); }
    return { id: bx.id, group: g, outline, sheet, shadow, bodyMat, capMat, bx, topY, lift: 0, liftTo: 0, state: "" };
  }

  makeTube(tb, step) {
    const style = KIND_STYLE[step.kind] || KIND_STYLE.call;
    const path = new T.CurvePath();
    for (const [a, b, c, d] of tb.segs) path.add(new T.CubicBezierCurve3(new T.Vector3(...a), new T.Vector3(...b), new T.Vector3(...c), new T.Vector3(...d)));
    const len = path.getLength();
    const tm = tubeMaterial();
    const u = tm.userData.u;
    u.uLen.value = len; u.uDash.value = style.dash; u.uGap.value = style.gap;
    const group = new T.Group();
    const mesh = new T.Mesh(new T.TubeGeometry(path, Math.max(this.lite ? 32 : 48, Math.round(len * (this.lite ? 4 : 7))), style.r, this.lite ? 6 : 10, false), tm);
    mesh.renderOrder = 4;
    group.add(mesh);
    const coneLen = Math.max(0.42, style.r * 5.2), coneR = Math.max(0.2, style.r * 2.4);
    u.uEnd.value = 1 - (coneLen * 0.92) / len;
    const cone = new T.Mesh(new T.ConeGeometry(coneR, coneLen, 18), mat({ color: "#888888", roughness: 0.4 }));
    const end = path.getPointAt(1), tan = path.getTangentAt(1).normalize();
    cone.position.copy(end).addScaledVector(tan, -coneLen / 2);
    cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), tan);
    group.add(cone);
    // data: a bead where it leaves, like the dot at the start of the map's arrow
    if (style.bead) {
      const bead = new T.Mesh(new T.SphereGeometry(0.24, 16, 12), cone.material);
      bead.position.copy(path.getPointAt(0)).addScaledVector(path.getTangentAt(0), 0.18);
      group.add(bead);
    }
    // syscall: a collar where it leaves, like the square start of the map's arrow
    if (step.kind === "syscall") {
      const c0 = path.getPointAt(0.0), t0 = path.getTangentAt(0.0);
      const collar = new T.Mesh(new T.CylinderGeometry(style.r * 2.2, style.r * 2.2, 0.16, 16), cone.material);
      collar.position.copy(c0).addScaledVector(t0, 0.35);
      collar.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), t0);
      group.add(collar);
    }
    // vias: a hole and a ring where the tube passes a plate
    const vias = [];
    for (const v of tb.vias) {
      const hole = new T.Mesh(new T.PlaneGeometry(1.1, 1.1), new T.MeshBasicMaterial({ map: holeTex(), transparent: true, opacity: this.dark ? 0.5 : 0.28, depthWrite: false, color: 0x000000 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(v.p[0], v.p[1] + 0.01, v.p[2]);
      hole.renderOrder = 3;
      const ring = new T.Mesh(new T.TorusGeometry(style.r + 0.2, 0.045, 8, 28), cone.material);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(v.p[0], v.p[1] + 0.03, v.p[2]);
      group.add(hole, ring);
      vias.push(ring);
    }
    // a fat invisible copy, so the tube is easy to point at
    const hit = new T.Mesh(new T.TubeGeometry(path, Math.max(24, Math.round(len * 2)), 0.42, 6, false), new T.MeshBasicMaterial({ visible: false }));
    hit.userData.step = tb.i;
    group.add(hit);
    this.tubeHits.push(hit);
    const mid = path.getPointAt(0.5);
    // points along the tube, evenly spaced, for the labels (what to avoid, where a badge may sit)
    const samples = [];
    for (let k = 0; k <= 24; k++) samples.push(path.getPointAt(k / 24));
    return { i: tb.i, step, path, len, mesh, mat: tm, cone, group, style, mid, samples, how: tb.how, state: "" };
  }

  makeComet() {
    const P = this.pal;
    const g = new T.Group();
    const head = new T.Mesh(new T.SphereGeometry(0.26, 24, 16), new T.MeshBasicMaterial({ color: P.accent, toneMapped: false }));
    const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: P.accent, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    halo.scale.set(2.6, 2.6, 1);
    const trail = [];
    for (let i = 0; i < 14; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: P.accent, transparent: true, opacity: 0.0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
      g.add(s);
      trail.push(s);
    }
    head.renderOrder = 10; halo.renderOrder = 11;
    g.add(head, halo);
    g.visible = false;
    this.root.add(g);
    this.comet = { group: g, head, halo, trail, tube: null, u: 0, phase: "run", wait: 0, visible: false, loops: 0 };
  }

  // ---------- state ----------
  // steps: { i: "active" | "past" | "future" | "dim" }, blocks: { id: "from" | "to" | "sel" | "" }
  setState({ steps = {}, blocks = {}, active = null, ring = null } = {}) {
    this.stepStates = steps;
    this.blockStates = blocks;
    this.activeStep = active;
    this.ringState = ring;
    this.applyStates();
  }

  applyStates() {
    const P = this.pal;
    const steps = this.stepStates || {};
    for (const t of Object.values(this.tubes)) {
      const st = steps[t.i] || "future";
      const u = t.mat.userData.u;
      let color = P.future, op = P.futureOpacity, flow = 0;
      if (st === "active") { color = P.accent; op = 1; flow = 1; }
      else if (st === "past") { color = P.past; op = 0.95; }
      else if (st === "dim") { color = P.future; op = P.futureOpacity * 0.45; }
      if (t.step.alt && st !== "active") { color = st === "dim" ? P.future : P.alt; op = st === "dim" ? 0.25 : 0.62; }
      t.mat.color.set(color);
      t.mat.emissive.set(st === "active" ? P.accent : "#000000");
      t.mat.emissiveIntensity = st === "active" ? 0.35 : 0;
      u.uGlow.value.set(this.dark ? "#ffffff" : "#c9d6ff");
      u.uFlow.value = flow;
      const transparent = op < 0.99;
      t.mat.transparent = transparent; t.mat.opacity = op; t.mat.depthWrite = !transparent;
      t.cone.material.color.set(color);
      t.cone.material.emissive?.set(st === "active" ? P.accent : "#000000");
      t.cone.material.transparent = transparent; t.cone.material.opacity = op;
      t.mesh.renderOrder = st === "active" ? 6 : 4;
      t.state = st;
    }
    const blocks = this.blockStates || {};
    for (const b of Object.values(this.blocks)) {
      const st = blocks[b.id] || "";
      b.state = st;
      b.outline.visible = !!st;
      b.outline.material.color.set(st === "sel" ? (this.dark ? "#e8ecff" : "#1d2a4d") : P.accent);
      b.outline.material.opacity = st === "to" ? 0.95 : st === "from" ? 0.55 : st === "sel" ? 0.5 : 0;
      b.liftTo = st === "to" ? 0.35 : st === "sel" ? 0.25 : 0;
      this.baseGlow(b, st === "to");
    }
    // comet on the active tube
    const c = this.comet;
    if (c) {
      const t = this.activeStep != null ? this.tubes[this.activeStep] : null;
      if (t !== c.tube) { c.tube = t; c.u = 0; c.phase = "run"; c.wait = 0; c.loops = 0; c.t0 = performance.now() / 1000; }
      c.visible = !!t;
      c.group.visible = !!t;
    }
    this.applyRing();
  }

  applyRing() {
    const P = this.pal;
    for (const b of Object.values(this.blocks)) {
      const R = b.group.userData.ring;
      if (!R) continue;
      const st = this.ringState || { head: 0, tail: 0, hot: null };
      R.cells.forEach((c, i) => {
        const filled = st.count ? ((i - st.head + R.n) % R.n) < st.count : false;
        c.material.color.set(filled ? P.accent : P.tile);
        c.material.emissive.set(filled ? P.accent : "#000000");
        c.material.emissiveIntensity = filled ? 0.25 : 0;
        c.scale.y = filled ? 1.35 : 1;
      });
      const place = (m, idx, dy) => {
        const a = (idx / R.n) * Math.PI * 2 - Math.PI / 2;
        m.position.set(Math.cos(a) * (R.r + 0.02), R.y + dy, Math.sin(a) * (R.r + 0.02));
        m.rotation.set(Math.PI, 0, 0);
      };
      place(R.head, st.head % R.n, 0.0);
      place(R.tail, st.tail % R.n, st.head === st.tail ? 0.36 : 0.0);
    }
  }

  // the block's own light: the accent when it is the target, the lite glow otherwise
  baseGlow(b, hot = b.state === "to") {
    const glow = b.bodyMat.userData.glow;
    if (hot) { b.bodyMat.emissive.set(this.pal.accent); b.bodyMat.emissiveIntensity = this.dark ? 0.18 : 0.06; }
    else if (glow) { b.bodyMat.emissive.set(glow); b.bodyMat.emissiveIntensity = 1; }
    else { b.bodyMat.emissive.set("#000000"); b.bodyMat.emissiveIntensity = 0; }
  }

  updateComet(dt) {
    const c = this.comet;
    // block lift
    for (const b of Object.values(this.blocks)) {
      if (Math.abs(b.lift - b.liftTo) > 0.001) {
        b.lift += (b.liftTo - b.lift) * Math.min(1, dt * 8);
        b.group.position.y = b.bx.y + b.lift;
      }
      if (b.sheet) b.sheet.position.y = b.sheet.userData.base + (this.hover === b.id ? 0.35 : 0) + Math.sin(this.time * 2 + b.bx.x) * 0.03;
      if (b.state === "to" && b.outline.visible) b.outline.material.opacity = 0.7 + 0.25 * Math.sin(this.time * 5);
      if (b.flash > 0.001) {
        b.flash *= Math.exp(-dt * 3.2);
        b.bodyMat.emissive.copy(b.flashColor).multiplyScalar(1);
        b.bodyMat.emissiveIntensity = b.flash * (this.dark ? 0.9 : 0.55);
        b.group.position.y = b.bx.y + b.lift + b.flash * 0.25;
      } else if (b.flash) {
        b.flash = 0;
        this.baseGlow(b);
        b.group.position.y = b.bx.y + b.lift;
      }
    }
    this.updateHopper();
    if (!c || !c.tube) return;
    const t = c.tube;
    const dur = clamp(t.len / 7.5, 1.0, 2.6) / (this.speed || 1);
    const now = performance.now() / 1000;
    if (c.t0 == null) c.t0 = now;
    if (c.phase === "run") {
      c.u = Math.min(1, (now - c.t0) / dur);
      if (c.u >= 1) { c.phase = "wait"; c.t0 = now; c.wait = 0; c.loops++; this.hooks.onArrive?.(t.i, c.loops); }
    } else {
      c.wait = now - c.t0;
      if (c.wait > 0.7) { c.phase = "run"; c.u = 0; c.t0 = now; }
    }
    const e = easeInOut(c.u);
    const endU = t.mat.userData.u.uEnd.value;
    const p = t.path.getPointAt(Math.min(e * endU + (1 - endU) * e, 1));
    c.head.position.copy(p);
    c.halo.position.copy(p);
    const fade = c.phase === "wait" ? Math.max(0, 1 - c.wait / 0.5) : Math.min(1, c.u * 6);
    c.head.scale.setScalar(0.4 + 0.6 * fade);
    c.halo.material.opacity = 0.85 * fade;
    c.trail.forEach((s, k) => {
      const uu = Math.max(0, e - (k + 1) * 0.018);
      s.position.copy(t.path.getPointAt(uu));
      const f = (1 - k / c.trail.length);
      s.scale.setScalar(1.3 * f + 0.2);
      s.material.opacity = (c.phase === "run" ? 0.5 : 0.5 * fade) * f * (e > 0.02 ? 1 : 0);
    });
  }

  // ---------- the recorded run: a hopper that jumps between blocks ----------
  makeHopper() {
    const g = new T.Group();
    const head = new T.Mesh(new T.SphereGeometry(0.3, 24, 16), new T.MeshBasicMaterial({ color: this.pal.accent, toneMapped: false }));
    const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: this.pal.accent, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    halo.scale.set(3, 3, 1);
    const trail = [];
    for (let i = 0; i < 18; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: this.pal.accent, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
      g.add(sp);
      trail.push(sp);
    }
    head.renderOrder = 10; halo.renderOrder = 11;
    g.add(head, halo);
    g.visible = false;
    this.root.add(g);
    this.hopper = { group: g, head, halo, trail, path: null, t0: 0, dur: 1, color: new T.Color(this.pal.accent) };
    return this.hopper;
  }
  hopPath(fromId, toId) {
    const b = this.blocks[toId]?.bx;
    if (!b) return null;
    const top = (bx, id) => new T.Vector3(bx.x, bx.y + (this.blocks[id]?.topY || bx.h) + 0.15, bx.z);
    const pb = top(b, toId);
    const a = fromId ? this.blocks[fromId]?.bx : null;
    if (!a || fromId === toId) {
      return new T.CubicBezierCurve3(pb.clone().add(new T.Vector3(0, 3.2, 0)), pb.clone().add(new T.Vector3(0, 2.4, 0)), pb.clone().add(new T.Vector3(0, 1.0, 0)), pb);
    }
    const pa = top(a, fromId);
    const lift = 1.4 + pa.distanceTo(pb) * 0.16;
    const peak = Math.max(pa.y, pb.y) + lift;
    return new T.CubicBezierCurve3(pa, new T.Vector3(pa.x, peak, pa.z + 0.9), new T.Vector3(pb.x, peak, pb.z + 0.9), pb);
  }
  hop(fromId, toId, color, dur = 0.3) {
    const h = this.hopper || this.makeHopper();
    const path = this.hopPath(fromId, toId);
    if (!path) return;
    h.path = path; h.t0 = performance.now() / 1000; h.dur = Math.max(0.06, dur);
    h.color.set(color);
    h.head.material.color.copy(h.color);
    h.halo.material.color.copy(h.color);
    h.trail.forEach((sp) => sp.material.color.copy(h.color));
    h.group.visible = true;
  }
  parkHopper(id, color) {
    const h = this.hopper || this.makeHopper();
    const path = this.hopPath(null, id);
    if (!path) { h.group.visible = false; return; }
    h.path = path; h.t0 = -1e9; h.dur = 1;
    h.color.set(color);
    h.head.material.color.copy(h.color); h.halo.material.color.copy(h.color);
    h.trail.forEach((sp) => sp.material.color.copy(h.color));
    h.group.visible = true;
  }
  updateHopper() {
    const h = this.hopper;
    if (!h || !h.path || !h.group.visible) return;
    const k = clamp((performance.now() / 1000 - h.t0) / h.dur, 0, 1);
    const e = easeInOut(k);
    const p = h.path.getPoint(e);
    h.head.position.copy(p); h.halo.position.copy(p);
    h.trail.forEach((sp, j) => {
      const u = Math.max(0, e - (j + 1) * 0.035);
      sp.position.copy(h.path.getPoint(u));
      const f = 1 - j / h.trail.length;
      sp.scale.setScalar(1.4 * f + 0.2);
      sp.material.opacity = k < 1 ? 0.55 * f : Math.max(0, 0.55 * f * (1 - (performance.now() / 1000 - h.t0 - h.dur) * 3));
    });
  }
  // The last few jumps of the recorded run as fading arcs (newest last), so the order stays
  // visible in a still picture.
  setTrail(hops) {
    for (const m of this.trail || []) { m.geometry.dispose(); m.material.dispose(); this.root.remove(m); }
    this.trail = [];
    hops.forEach((hp, k) => {
      if (!hp.from || hp.from === hp.to) return;
      const path = this.hopPath(hp.from, hp.to);
      if (!path) return;
      const age = hops.length - 1 - k;
      const op = Math.max(0.18, 0.95 * Math.pow(0.8, age));
      const material = new T.MeshBasicMaterial({ color: hp.color, transparent: true, opacity: op, depthWrite: false, toneMapped: false });
      const tube = new T.Mesh(new T.TubeGeometry(path, 48, age ? 0.11 : 0.16, 8, false), material);
      tube.renderOrder = 5;
      const cone = new T.Mesh(new T.ConeGeometry(age ? 0.3 : 0.38, 0.75, 14), material.clone());
      const end = path.getPoint(1), tan = path.getTangent(1).normalize();
      cone.position.copy(end).addScaledVector(tan, -0.38);
      cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), tan);
      cone.renderOrder = 5;
      this.root.add(tube, cone);
      this.trail.push(tube, cone);
    });
  }

  // a block lights up in a colour and fades back
  flash(id, color, strength = 1) {
    const b = this.blocks[id];
    if (!b) return;
    b.flashColor = new T.Color(color);
    b.flash = strength;
  }
  restartComet() {
    if (this.comet) { this.comet.u = 0; this.comet.phase = "run"; this.comet.loops = 0; this.comet.t0 = performance.now() / 1000; }
  }

  // ---------- picking ----------
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;
      const hit = this.pick(e);
      if (!hit) { const t = this.pickTube(e); if (t != null) return this.hooks.onPickTube?.(t, e); }
      this.hooks.onPick?.(hit, e);
    });
    el.addEventListener("dblclick", (e) => { const hit = this.pick(e); if (hit) this.hooks.onOpen?.(hit); });
    el.addEventListener("pointermove", (e) => {
      if (e.buttons) { this.hooks.onHoverTube?.(null); return; }
      const hit = this.pick(e);
      const tube = hit ? null : this.pickTube(e);
      if (hit !== this.hover) {
        this.hover = hit;
        this.hooks.onHover?.(hit);
      }
      if (tube !== this.hoverTube) { this.hoverTube = tube; this.applyHoverTube(); }
      el.style.cursor = hit || tube != null ? "pointer" : "";
      this.hooks.onHoverTube?.(tube, e);
    });
    el.addEventListener("pointerleave", () => {
      if (this.hover) { this.hover = null; this.hooks.onHover?.(null); }
      if (this.hoverTube != null) { this.hoverTube = null; this.applyHoverTube(); }
      this.hooks.onHoverTube?.(null);
    });
  }

  pickTube(e) {
    if (!this.tubeHits.length) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.tubeHits, false);
    return hits.length ? hits[0].object.userData.step : null;
  }
  // the tube under the pointer, or under a hovered badge
  setHoverTube(i) {
    if (i !== this.hoverTube) { this.hoverTube = i; this.applyHoverTube(); }
  }
  // a hovered tube is drawn as if it were current, in a lighter way
  applyHoverTube() {
    this.applyStates();
    const t = this.tubes[this.hoverTube];
    if (!t || t.state === "active") return;
    t.mat.emissive.set(this.pal.accent);
    t.mat.emissiveIntensity = 0.55;
    t.mat.opacity = 1; t.mat.transparent = false; t.mat.depthWrite = true;
    t.cone.material.opacity = 1; t.cone.material.transparent = false;
  }
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    return hits.length ? hits[0].object.userData.box : null;
  }

  // ---------- screen positions ----------
  project(v) {
    const p = (v.isVector3 ? v.clone() : new T.Vector3(...v)).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.size.w, y: (-p.y * 0.5 + 0.5) * this.size.h, z: p.z, ok: p.z < 1 && p.z > -1 };
  }
  blockRect(id) {
    const b = this.blocks[id];
    if (!b) return null;
    const { x, y, z, w, d } = b.bx;
    const yy = y + b.lift, top = b.topY;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = true;
    for (const dx of [-w / 2, w / 2]) for (const dy of [0, top]) for (const dz of [-d / 2, d / 2]) {
      const p = this.project([x + dx, yy + dy, z + dz]);
      if (!p.ok) ok = false;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const c = this.project([x, yy + top, z + d * 0.06]);
    return { x0, y0, x1, y1, cx: c.x, cy: c.y, ok, depth: c.z };
  }

  // Where things are on the screen, for the labels: blocks as rectangles, tubes and plate edges as
  // polylines. The owner lets a label ignore its own block or its own tube.
  screenGeometry() {
    const rects = [], lines = [];
    const line = (pts, owner, hw, kind) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < pts.length; k += 2) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]); }
      lines.push({ pts, owner, hw, kind, bb: { x0: x0 - hw, y0: y0 - hw, x1: x1 + hw, y1: y1 + hw } });
    };
    for (const b of Object.values(this.blocks)) {
      const r = this.blockRect(b.id);
      if (r && r.ok) rects.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, owner: `box:${b.id}` });
    }
    for (const t of Object.values(this.tubes)) {
      if (t.state === "dim" || !t.samples) continue;
      const pts = [];
      for (const p of t.samples) { const q = this.project(p); if (q.ok) pts.push(q.x, q.y); }
      if (pts.length >= 4) line(pts, `step:${t.i}`, t.state === "active" ? 4 : 3, "tube");
    }
    for (const [id, pl] of Object.entries(this.plates || {})) {
      const { x0, x1, z0, z1 } = pl.plate, y = pl.band.y, yb = y - DIM.PLATE_T;
      const c = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]].map((p) => this.project(p));
      if (c.every((q) => q.ok)) line([c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y, c[0].x, c[0].y], `plate:${id}`, 2, "rim");
      const f = [[x0, yb, z1], [x1, yb, z1]].map((p) => this.project(p));
      if (f.every((q) => q.ok)) line([f[0].x, f[0].y, f[1].x, f[1].y], `plate:${id}`, 2, "rim");
    }
    return { rects, lines };
  }
  // A key that changes when the picture moves (camera, size), and whether anything is animating.
  viewKey() {
    return this.camera.matrixWorld.elements.map((v) => v.toFixed(3)).join(",") + `|${this.size.w}x${this.size.h}`;
  }
  get animating() {
    if (this.tweens.length || this.camTween || this.follow) return true;
    for (const b of Object.values(this.blocks)) if (Math.abs(b.lift - b.liftTo) > 0.002 || b.flash > 0.002) return true;
    return false;
  }
  cameraState() {
    return { t: this.controls.target.clone(), p: this.camera.position.clone() };
  }
  restoreCamera(st, dur = 800) {
    if (st) this.moveCamera(st.t.clone(), st.p.clone(), dur);
  }

  // ---------- camera ----------
  viewDir(az, el) {
    return new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  // Distance at which the box fits the free part of the viewport (inside the margins), looking
  // along dir; the free part may sit off-centre, so the fit is done around its own centre.
  fitDistance(bounds, dir, target, margin) {
    const corners = [];
    for (const x of [bounds.x0, bounds.x1]) for (const y of [bounds.y0, bounds.y1]) for (const z of [bounds.z0, bounds.z1]) corners.push(new T.Vector3(x, y, z));
    const cam = this.camera.clone();
    const halfW = (this.size.w - margin.l - margin.r) / 2, halfH = (this.size.h - margin.t - margin.b) / 2;
    let lo = 5, hi = 600;
    for (let it = 0; it < 32; it++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, mid);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
      for (const c of corners) {
        const p = c.clone().project(cam);
        if (p.z > 1) { behind = true; break; }
        const sx = p.x * 0.5 * this.size.w, sy = -p.y * 0.5 * this.size.h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      // the projected box is not centred on the target: allow for its own offset
      const fits = !behind && (x1 - x0) / 2 <= halfW && (y1 - y0) / 2 <= halfH;
      if (fits) hi = mid; else lo = mid;
    }
    // where the box's centre lands relative to the screen centre at that distance
    cam.position.copy(target).addScaledVector(dir, hi);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(cam);
      const sx = p.x * 0.5 * this.size.w, sy = -p.y * 0.5 * this.size.h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { dist: hi, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  // Frame one step: its two blocks, its tube and a little of what is around them.
  frameStep(i, opts = {}) {
    const t = this.tubes[i];
    if (!t) return this.overview(opts);
    const pts = [];
    for (let k = 0; k <= 16; k++) pts.push(t.path.getPointAt(k / 16));
    for (const id of [t.step.from, t.step.to]) {
      const b = this.blocks[id];
      if (!b) continue;
      const { x, y, z, w, d } = b.bx;
      for (const dx of [-w / 2, w / 2]) for (const dz of [-d / 2, d / 2]) pts.push(new T.Vector3(x + dx, y, z + dz), new T.Vector3(x + dx, y + b.topY, z + dz));
      // the name plate under the block
      pts.push(new T.Vector3(x, y - 1.6, z + d / 2 + 1.2));
    }
    const pad = opts.pad ?? 3.6;
    const bounds = {
      x0: Math.min(...pts.map((p) => p.x)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad,
      y0: Math.min(...pts.map((p) => p.y)) - 1.2, y1: Math.max(...pts.map((p) => p.y)) + 1.2,
      z0: this.lay.plate.z0, z1: this.lay.plate.z1,
    };
    return this.overview({ ...opts, bounds });
  }
  overview(opts = {}) {
    const lay = this.lay;
    if (!lay) return;
    const az = opts.az ?? -0.12, el = opts.el ?? 0.68;
    const dir = this.viewDir(az, el);
    const b = opts.bounds || lay.bounds;
    const target = new T.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    const margin = opts.margin || this.margins || { l: 130, r: 20, t: 80, b: 120 };
    const fit = this.fitDistance(b, dir, target, margin);
    // small scenes (a paper with a few boxes) should not blow up: at most ~27 px per unit
    const minDist = this.size.h / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * (opts.maxPx || 27));
    if (fit.dist < minDist) {
      const k = minDist / fit.dist;
      fit.dist = minDist; fit.cx /= k; fit.cy /= k;
    }
    const pos = target.clone().addScaledVector(dir, fit.dist);
    // move the box's centre onto the centre of the free part of the viewport
    const wantX = (margin.l - margin.r) / 2, wantY = (margin.t - margin.b) / 2;
    const pan = this.screenPan(target, pos, fit.cx - wantX, fit.cy - wantY);
    this.moveCamera(target.clone().add(pan), pos.clone().add(pan), opts.instant ? 0 : opts.dur ?? 900);
  }
  // world-space offset that moves the view by (px, py) pixels at the target's depth
  screenPan(target, pos, px, py) {
    const dist = pos.distanceTo(target);
    const h = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    const perPx = h / this.size.h;
    const fwd = target.clone().sub(pos).normalize();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    const up = new T.Vector3().crossVectors(right, fwd).normalize();
    return right.multiplyScalar(px * perPx).add(up.multiplyScalar(-py * perPx));
  }
  moveCamera(target, pos, dur = 900) {
    if (!dur) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.camTween = null;
      this.controls.update();
      return;
    }
    this.camTween = { t0: performance.now(), dur, fromT: this.controls.target.clone(), toT: target, fromP: this.camera.position.clone(), toP: pos };
  }
  focusBlock(id, opts = {}) {
    const b = this.blocks[id];
    if (!b) return;
    const target = new T.Vector3(b.bx.x, b.bx.y + 0.8, b.bx.z + 0.8);
    const off = this.camera.position.clone().sub(this.controls.target);
    const el = Math.asin(clamp(off.y / off.length(), -1, 1));
    const az = Math.atan2(off.x, off.z);
    const dir = this.viewDir(az, clamp(el, 0.3, 0.75));
    const dist = opts.dist || 26;
    const pos = target.clone().addScaledVector(dir, dist);
    const pan = opts.panPx ? this.screenPan(target, pos, opts.panPx, 0) : new T.Vector3();
    this.moveCamera(target.clone().add(pan), pos.clone().add(pan), opts.dur ?? 850);
  }
  setFollow(on) {
    this.follow = on;
    if (on) {
      const off = this.camera.position.clone().sub(this.controls.target);
      this.followDist = Math.min(off.length(), 30);
    }
  }
  // a point "inside" a block, for diving into its paper
  diveInto(id, dur = 700) {
    const b = this.blocks[id];
    if (!b) return;
    const target = new T.Vector3(b.bx.x, b.bx.y + b.topY * 0.5, b.bx.z);
    const off = this.camera.position.clone().sub(this.controls.target).setLength(4);
    this.moveCamera(target, target.clone().add(off), dur);
  }
  fadeAll(to, dur = 450) {
    const mats = [];
    this.root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.push([m, m.opacity, m.transparent])); });
    for (const [m] of mats) m.transparent = true;
    this.tweens.push({ t0: performance.now() / 1000, dur: dur / 1000, fn: (k) => { for (const [m, o] of mats) m.opacity = o + (to - o) * k; } });
  }
}
