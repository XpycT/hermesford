import * as THREE from 'three';
import { EventEmitter } from './EventEmitter.js';
import { Input } from './Input.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { clamp } from '../utils/math.js';

/** @import { SceneNode } from '../render/types.js' */

/** Largest simulated step per frame (s) — avoids huge jumps after tab switches / hitches. */
const MAX_DELTA = 1 / 20;

/**
 * A per-frame system (see `Engine#addSystem`): a plain object or class instance; every member is
 * optional. `update` / `lateUpdate` are called as `(dt, t, engine)`.
 * @typedef {object} EngineSystem
 * @property {string} [name]
 * @property {Function} [update]
 * @property {Function} [lateUpdate]
 * @property {Function} [dispose]
 */

/**
 * Engine — owns the renderer, scene, camera, input and the main loop.
 *
 * Frame order (per `setAnimationLoop` tick):
 *   systems.update (ascending order) → events 'update' →
 *   systems.lateUpdate → events 'lateUpdate' → globalUniforms.uTime → 'beforeRender' →
 *   render fn → 'afterRender' → input.endFrame()
 *
 * Systems are plain objects `{ name?, update?(dt, t, engine), lateUpdate?(dt, t, engine), dispose?() }`.
 * A system or listener that throws is reported once (with its name) and the loop keeps running.
 *
 * Manual stepping (opt-in, for tests and bots — see `manualStep`): no animation loop; frames
 * advance only through `step(dt)`, e.g. a fixed 1/60 s as fast as the page allows, so a scripted
 * run repeats frame for frame whatever the GPU load. Normal play never turns it on.
 *
 * @example
 *   const engine = new Engine({ container: document.getElementById('app') });
 *   engine.addSystem({ name: 'spin', update: (dt) => (cube.rotation.y += dt) });
 *   engine.start();
 */
export class Engine {
  /**
   * @param {{ container?: HTMLElement, maxPixelRatio?: number, renderScale?: number,
   *           shadowMapType?: THREE.ShadowMapType, clearColor?: THREE.ColorRepresentation,
   *           preserveDrawingBuffer?: boolean, inputTarget?: EventTarget, exposeGlobal?: boolean,
   *           manualStep?: boolean }} [opts]
   *   - container: element the canvas fills (default document.body → full-window canvas)
   *   - maxPixelRatio: cap on devicePixelRatio (default 1.5)
   *   - renderScale: 0.25..1 multiplier on the capped pixel ratio (default 1)
   *   - shadowMapType: default THREE.PCFShadowMap (in r186 PCFSoftShadowMap was folded into the
   *     soft, radius-aware PCFShadowMap; passing PCFSoftShadowMap is mapped to it without a warning)
   *   - clearColor: renderer clear color (default a deep night blue)
   *   - preserveDrawingBuffer: keep the drawing buffer (for canvas.toDataURL photo capture)
   *   - inputTarget: where Input listens (default window)
   *   - exposeGlobal: force/disable `window.__engine` (default: when URL has ?debug or ?autostart)
   *   - manualStep: start in manual-step mode (default: when the URL has ?fixedstep, other than
   *     `fixedstep=0`, together with ?autostart or ?debug — a stray `?fixedstep` on a normal page
   *     would freeze it; see `manualStep`)
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.container = opts.container ?? document.body;
    this.maxPixelRatio = opts.maxPixelRatio ?? 1.5;
    this._renderScale = clamp(opts.renderScale ?? 1, 0.25, 1);

    // --- Renderer ---------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    renderer.shadowMap.enabled = true;
    let shadowType = opts.shadowMapType ?? THREE.PCFShadowMap;
    if (shadowType === THREE.PCFSoftShadowMap) shadowType = THREE.PCFShadowMap; // removed in r180+, PCF is soft now
    renderer.shadowMap.type = shadowType;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(opts.clearColor ?? 0x0b0e1a, 1);
    /** @type {THREE.WebGLRenderer} */
    this.renderer = renderer;

    const canvas = renderer.domElement;
    canvas.classList.add('luminati-canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    if (this._isFullWindow()) {
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
    }
    canvas.tabIndex = -1;
    this.container.appendChild(canvas);

    // --- Scene / camera -----------------------------------------------------
    /** @type {THREE.Scene} */
    this.scene = new THREE.Scene();
    /** @type {THREE.PerspectiveCamera} */
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.5, 400);
    this.camera.position.set(0, 12.7, 20.4);
    this.camera.lookAt(0, 0, 0);

    /** @type {Input} */
    this.input = new Input(opts.inputTarget ?? window);
    /** @type {EventEmitter} */
    this.events = new EventEmitter();

    /** Frame timing. `delta` is clamped to ≤ 1/20 s and multiplied by `timeScale`. */
    this.time = { elapsed: 0, delta: 0, frame: 0, timeScale: 1, realDelta: 0, realElapsed: 0, fps: 60 };

    /** @type {{system: EngineSystem, order: number, seq: number, name: string}[]} */
    this._systems = []; // copy-on-write; iterated without allocation
    this._seq = 0;
    /** @type {((dt: number, t: number) => void) | null} */
    this._renderFn = null;
    /** @type {WeakMap<object, Set<string>>} */
    this._failed = new WeakMap(); // listener/system → Set of phases already reported
    this._running = false;
    this._manual = !!(opts.manualStep ?? (urlFlag('fixedstep') && (urlFlag('autostart') || urlFlag('debug'))));
    this._startedOnce = false;
    this._lastNow = -1;
    this._disposed = false;
    this._width = 1;
    this._height = 1;
    this._pixelRatio = 1;
    /** Minimum ms between automatic (non-forced) resizes; 0 = resize at once (default). */
    this.resizeThrottleMs = 0;
    this._lastResizeAt = -Infinity;
    this._resizeTimer = 0;

    this._tick = this._tick.bind(this);
    this._onWindowResize = () => this._resize();
    this._onContextLost = (e) => {
      e.preventDefault();
      console.warn('[Engine] WebGL context lost');
      this.events.emit('contextlost');
    };
    this._onContextRestored = () => {
      console.warn('[Engine] WebGL context restored');
      this.events.emit('contextrestored');
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    // --- Resizing -----------------------------------------------------------
    this._resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && !this._isFullWindow()) {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.container);
    }
    // Window resize also catches browser zoom / devicePixelRatio changes.
    window.addEventListener('resize', this._onWindowResize);
    this._resize(true);

    // --- Debug exposure -----------------------------------------------------
    let expose = opts.exposeGlobal;
    if (expose === undefined) {
      try {
        const q = new URLSearchParams(window.location.search);
        expose = q.has('debug') || q.has('autostart');
      } catch {
        expose = false;
      }
    }
    if (expose) window.__engine = this;
  }

  // ---------------------------------------------------------------------------
  // Size
  // ---------------------------------------------------------------------------

  /** Canvas width in CSS px. */
  get width() {
    return this._width;
  }

  /** Canvas height in CSS px. */
  get height() {
    return this._height;
  }

  /** Effective renderer pixel ratio (min(dpr, maxPixelRatio) × renderScale). */
  get pixelRatio() {
    return this._pixelRatio;
  }

  /** width / height */
  get aspect() {
    return this._width / Math.max(1, this._height);
  }

  /** Drawing-buffer size in device pixels (reused object — copy to keep). */
  get drawingBufferSize() {
    this._dbs ??= new THREE.Vector2();
    return this.renderer.getDrawingBufferSize(this._dbs);
  }

  /** The WebGL canvas. */
  get canvas() {
    return this.renderer.domElement;
  }

  /** 0.25..1 multiplier on the device pixel ratio (setting it triggers a resize). */
  get renderScale() {
    return this._renderScale;
  }

  set renderScale(v) {
    const s = clamp(Number(v) || 1, 0.25, 1);
    if (s === this._renderScale) return;
    this._renderScale = s;
    this._resize(true);
  }

  _isFullWindow() {
    return this.container === document.body || this.container === document.documentElement;
  }

  _measure() {
    let w;
    let h;
    if (this._isFullWindow()) {
      w = window.innerWidth;
      h = window.innerHeight;
    } else {
      w = this.container.clientWidth;
      h = this.container.clientHeight;
      if (!w || !h) {
        const r = this.container.getBoundingClientRect();
        w = r.width || window.innerWidth;
        h = r.height || window.innerHeight;
      }
    }
    return [Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))];
  }

  /**
   * Re-measure the container and resize renderer + camera. Called automatically.
   * @param {boolean} [force] emit even if nothing changed
   */
  _resize(force = false) {
    if (this._disposed) return;
    // `resizeThrottleMs` > 0 (e.g. while an editor splitter is dragged): automatic resizes run at
    // most that often — the canvas is stretched by CSS in between — plus once at the end
    if (!force && this.resizeThrottleMs > 0) {
      const wait = (this._lastResizeAt ?? -Infinity) + this.resizeThrottleMs - performance.now();
      if (wait > 0) {
        if (!this._resizeTimer) this._resizeTimer = setTimeout(() => { this._resizeTimer = 0; this._resize(); }, wait);
        return;
      }
    }
    const [w, h] = this._measure();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pr = Math.min(dpr, this.maxPixelRatio) * this._renderScale;
    if (!force && w === this._width && h === this._height && pr === this._pixelRatio) return;
    this._lastResizeAt = performance.now();
    this._width = w;
    this._height = h;
    this._pixelRatio = pr;
    // (setPixelRatio re-applies the current size itself: only call it when the ratio changes, so
    // a resize reallocates the drawing buffer once, not twice)
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.events.emit('resize', { width: w, height: h, pixelRatio: pr });
  }

  /** Force a resize pass (e.g. after changing maxPixelRatio). */
  resize() {
    this._resize(true);
  }

  // ---------------------------------------------------------------------------
  // Systems
  // ---------------------------------------------------------------------------

  /**
   * Register a per-frame system. Systems run in ascending `order`; equal orders keep insertion order.
   * Re-adding an existing system updates its order.
   * @template T
   * @param {T & EngineSystem} system
   * @param {number} [order=0]
   * @returns {T} the system
   */
  addSystem(system, order = 0) {
    if (!system || typeof system !== 'object' && typeof system !== 'function') {
      throw new TypeError('Engine.addSystem: system must be an object');
    }
    const existing = this._systems.find((s) => s.system === system);
    const entry = existing
      ? { ...existing, order }
      : { system, order, seq: this._seq++, name: system.name || system.constructor?.name || 'system' };
    const next = this._systems.filter((s) => s.system !== system);
    next.push(entry);
    next.sort((a, b) => a.order - b.order || a.seq - b.seq);
    this._systems = next;
    return system;
  }

  /**
   * Unregister a system (does not dispose it).
   * @param {object} system
   * @returns {boolean} whether it was registered
   */
  removeSystem(system) {
    const next = this._systems.filter((s) => s.system !== system);
    const removed = next.length !== this._systems.length;
    this._systems = next;
    return removed;
  }

  /** Registered systems in execution order. */
  get systems() {
    return this._systems.map((s) => s.system);
  }

  /**
   * Replace the render step. `fn(dt, t)` is called instead of `renderer.render(scene, camera)`
   * (e.g. PostFX#render). Pass null to restore the default.
   * @param {((dt:number, t:number) => void) | null} fn
   */
  setRenderFn(fn) {
    this._renderFn = typeof fn === 'function' ? fn : null;
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  /** Start the animation loop (idempotent). In manual-step mode no loop is installed. */
  start() {
    if (this._running || this._disposed) return this;
    this._running = true;
    this._lastNow = -1;
    if (!this._startedOnce) {
      // Listeners registered after construction (PostFX, UI …) still get the initial size.
      this._startedOnce = true;
      this._resize(true);
    }
    if (!this._manual) this.renderer.setAnimationLoop(this._tick);
    this.events.emit('start');
    return this;
  }

  /** Stop the animation loop (idempotent). */
  stop() {
    if (!this._running) return this;
    this._running = false;
    this.renderer.setAnimationLoop(null);
    this.events.emit('stop');
    return this;
  }

  /** Whether the loop is running (in manual-step mode: whether the engine was started). */
  get running() {
    return this._running;
  }

  /**
   * Manual stepping (opt-in; tests and bots). While on, the engine installs no animation loop
   * (`start()` / `stop()` only mark it started / stopped) and frames advance only through
   * `step()` — e.g. a fixed 1/60 s as fast as the page allows, so a scripted run repeats frame
   * for frame on any GPU load (`sandbox/combat_play.js`). Turning it off installs the loop again
   * if the engine is started. Starts on with `opts.manualStep` or the URL flag `?fixedstep` (with
   * `?autostart` or `?debug`, like `window.__engine`).
   * @type {boolean}
   */
  get manualStep() {
    return this._manual;
  }

  set manualStep(v) {
    const on = !!v;
    if (on === this._manual || this._disposed) return;
    this._manual = on;
    if (!this._running) return;
    this._lastNow = -1;
    this.renderer.setAnimationLoop(on ? null : this._tick);
  }

  /**
   * Advance exactly one frame with a given real delta (seconds), e.g. for tests or
   * rendering while stopped. Uses the same clamping / timeScale as the loop.
   * @param {number} [realDt=1/60]
   * @param {{ render?: boolean }} [opts] render: false runs the frame without drawing it (no
   *   'beforeRender', render function or 'afterRender'; e.g. a manual-step bot that draws every
   *   n-th frame — see `redraw()`)
   */
  step(realDt = 1 / 60, { render = true } = {}) {
    if (this._disposed) return;
    this._frame(realDt, render);
  }

  /**
   * Draw the current frame again without advancing it: the render step alone ('beforeRender',
   * the render function, 'afterRender') with dt 0 — e.g. before a screenshot after `step()` with
   * `render: false`.
   */
  redraw() {
    if (this._disposed) return;
    this._draw(0, this.time.elapsed);
  }

  /** @param {number} now rAF timestamp (ms) */
  _tick(now) {
    if (this._lastNow < 0) this._lastNow = now;
    const realDt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    this._frame(realDt);
  }

  /** @param {number} realDt @param {boolean} [render] */
  _frame(realDt, render = true) {
    const time = this.time;
    const rd = realDt > 0 && Number.isFinite(realDt) ? realDt : 0;
    const clamped = rd > MAX_DELTA ? MAX_DELTA : rd;
    const dt = clamped * time.timeScale;
    time.realDelta = rd;
    time.realElapsed += rd;
    time.delta = dt;
    time.elapsed += dt;
    time.frame++;
    if (rd > 0) time.fps += (1 / rd - time.fps) * 0.05;
    const t = time.elapsed;

    const systems = this._systems;
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i].system;
      if (typeof s.update === 'function') {
        try {
          s.update(dt, t, this);
        } catch (err) {
          this._report(systems[i].system, 'update', `system "${systems[i].name}"`, err);
        }
      }
    }
    this._emitSafe('update', dt, t);

    for (let i = 0; i < systems.length; i++) {
      const s = systems[i].system;
      if (typeof s.lateUpdate === 'function') {
        try {
          s.lateUpdate(dt, t, this);
        } catch (err) {
          this._report(systems[i].system, 'lateUpdate', `system "${systems[i].name}"`, err);
        }
      }
    }
    this._emitSafe('lateUpdate', dt, t);
    if (this._disposed) return; // a system/listener disposed the engine mid-frame

    globalUniforms.uTime.value = t;

    if (render) this._draw(dt, t);

    this.input.endFrame();
  }

  /**
   * The render step: 'beforeRender' → render function (or renderer.render) → 'afterRender'.
   * @param {number} dt
   * @param {number} t
   */
  _draw(dt, t) {
    this._emitSafe('beforeRender', dt, t);
    try {
      if (this._renderFn) this._renderFn(dt, t);
      else this.renderer.render(this.scene, this.camera);
    } catch (err) {
      this._report(this._renderFn ?? this.renderer, 'render', 'render function', err);
    }
    this._emitSafe('afterRender', dt, t);
  }

  /**
   * Emit a frame event, isolating listener failures.
   * @param {string} event
   * @param {number} dt
   * @param {number} t
   */
  _emitSafe(event, dt, t) {
    const list = this.events.listeners(event);
    for (let i = 0; i < list.length; i++) {
      const fn = list[i];
      try {
        fn.call(this.events, dt, t);
      } catch (err) {
        this._report(fn, event, `'${event}' listener ${fn.name ? `"${fn.name}"` : '(anonymous)'}`, err);
      }
    }
  }

  /**
   * Log an error once per (owner, phase).
   * @param {object} owner system, listener or render function (WeakMap key)
   * @param {string} phase
   * @param {string} label
   * @param {unknown} err
   */
  _report(owner, phase, label, err) {
    let phases = this._failed.get(owner);
    if (!phases) {
      phases = new Set();
      this._failed.set(owner, phases);
    }
    if (phases.has(phase)) return;
    phases.add(phase);
    console.error(`[Engine] ${label} threw in ${phase} (further errors from it are suppressed):`, err);
    try {
      this.events.emit('error', { label, phase, error: err });
    } catch {
      /* never let an error handler break the loop */
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  /**
   * Stop the loop and release everything: systems (their `dispose()`), input listeners,
   * observers, scene GPU resources (geometries, materials, textures), the renderer and its canvas.
   * @param {{ disposeScene?: boolean }} [opts] disposeScene (default true) walks the scene graph
   */
  dispose({ disposeScene = true } = {}) {
    if (this._disposed) return;
    this.stop();
    try {
      this.events.emit('dispose');
    } catch (err) {
      console.error("[Engine] 'dispose' listener threw:", err);
    }
    this._disposed = true;

    const systems = this._systems;
    for (let i = systems.length - 1; i >= 0; i--) {
      const s = systems[i].system;
      if (typeof s.dispose === 'function') {
        try {
          s.dispose();
        } catch (err) {
          console.error(`[Engine] system "${systems[i].name}" threw in dispose:`, err);
        }
      }
    }
    this._systems = [];

    this.input.dispose();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    clearTimeout(this._resizeTimer);
    window.removeEventListener('resize', this._onWindowResize);

    if (disposeScene) disposeObjectTree(this.scene);
    this.scene.clear();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this._onContextLost);
    canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* context may already be gone */
    }
    canvas.remove();

    this.events.clear();
    if (typeof window !== 'undefined' && window.__engine === this) delete window.__engine;
  }
}

/**
 * Whether the page URL carries `?<name>` (any value but '0').
 * @param {string} name
 */
function urlFlag(name) {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has(name) && q.get(name) !== '0';
  } catch {
    return false;
  }
}

/**
 * Dispose geometries, materials and material textures of an object tree (each once).
 * @param {THREE.Object3D} root (a Scene also has its background / environment textures disposed)
 */
export function disposeObjectTree(root) {
  const seen = new Set();
  const disposeOnce = (o) => {
    if (!o || seen.has(o) || typeof o.dispose !== 'function') return;
    seen.add(o);
    o.dispose();
  };
  const disposeMaterial = (m) => {
    if (!m || seen.has(m)) return;
    for (const key of Object.keys(m)) {
      const v = m[key];
      if (v && v.isTexture) disposeOnce(v);
    }
    if (m.uniforms) {
      for (const u of Object.values(m.uniforms)) {
        const v = u?.value;
        if (v && v.isTexture) disposeOnce(v);
      }
    }
    disposeOnce(m);
  };
  root.traverse((/** @type {SceneNode} */ obj) => {
    if (obj.geometry) disposeOnce(obj.geometry);
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else disposeMaterial(mat);
    if (obj.customDepthMaterial) disposeMaterial(obj.customDepthMaterial);
    if (obj.customDistanceMaterial) disposeMaterial(obj.customDistanceMaterial);
    if (obj.isLight && obj.shadow?.map) obj.shadow.dispose();
    if (obj.isInstancedMesh) obj.dispose?.();
  });
  const bg = /** @type {SceneLike} */ (root).background;
  if (bg && bg.isTexture) disposeOnce(bg);
  const env = /** @type {SceneLike} */ (root).environment;
  if (env && env.isTexture) disposeOnce(env);
}

/**
 * A tree root that may be a Scene (read duck-typed; `background` may also be a Color).
 * @typedef SceneLike
 * @type {THREE.Object3D & { background?: { isTexture?: boolean } | null,
 *   environment?: { isTexture?: boolean } | null }}
 */
