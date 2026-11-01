import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { clamp, damp } from '../utils/math.js';
import {
  createCocUniforms,
  DofPrefilterShader,
  createDofGatherShader,
  DofTentShader,
  DofBokehSpriteShader,
  DofCompositeShader,
} from './shaders/DofShaders.js';
import { GradeShader } from './shaders/GradeShader.js';
import { BloomBrightPassShader } from './shaders/BloomShaders.js';
import { CopyShader } from './shaders/PostCommon.js';
import { StreakPrefilterShader, StreakBlurShader, StreakCompositeShader } from './shaders/CinematicShaders.js';

/**
 * OutputPass as three.js implements it: render() reads only (renderer, writeBuffer, readBuffer);
 * @types/three declares the generic Pass signature with deltaTime and maskActive required.
 * @typedef OutputPassRender
 * @type {OutputPass & { render(renderer: THREE.WebGLRenderer,
 *   writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void }}
 */

/**
 * PostFX — the diorama post-processing stack.
 *
 *   scene ─► HalfFloat MSAA target (+ DepthTexture, resolved by blit)
 *         ─► DOF (½ res): prefilter (MRT) → golden-angle bokeh gather → CoC-aware tent
 *                         → highlight sprites (crisp bokeh discs) → full-res composite
 *                           (the in-focus band keeps every pixel exact)
 *         ─► UnrealBloomPass (bright pass at ½ res with a subtractive soft knee, additive)
 *              [cinematic: anamorphic streaks from its bright pass, ¼ res]
 *         ─► OutputPass (ACES tone mapping + sRGB from renderer.toneMapping / toneMappingExposure)
 *         ─► grade (exposure, white balance, contrast, saturation, split toning, vignette,
 *                   chromatic aberration, grain, sharpen, dither) ─► screen
 *              [cinematic: the grade's film variant — the streaks added, orange & teal, a print
 *               curve, film grain]
 *
 * The cinematic stage (`settings.cinematic`, off by default) is a film look on top of the chain:
 * anamorphic streaks (they start from the bloom's bright pass, so they need bloom), oval bokeh and
 * the grade's `CINEMATIC` variant (it needs the grade). Its materials and targets are made on its
 * first use, so a frame without it compiles and allocates nothing more; `warmup()` compiles them
 * only while it is enabled.
 *
 * Every toggle in `settings` is read each frame, so GUI changes apply live. With
 * `settings.enabled = false` the scene is rendered straight to the screen by the renderer
 * (which then applies its own tone mapping / output colour space).
 *
 * Passes are driven manually (no EffectComposer) so each stage can be skipped cheaply and the
 * chain follows the renderer's drawing-buffer size automatically (resize / pixel ratio / render
 * scale changes are picked up on the next `render`).
 */

const GATHER_BUCKETS = [48, 64, 96];

function makeTarget(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    ...opts,
  });
}

function makePostMaterial(shader, shared = null, defines = null, extra = {}) {
  const uniforms = THREE.UniformsUtils.clone(shader.uniforms);
  if (shared) Object.assign(uniforms, shared); // shared uniform objects (same references)
  return new THREE.ShaderMaterial({
    name: shader.name,
    uniforms,
    defines: { ...(shader.defines || {}), ...(defines || {}) },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    glslVersion: shader.glslVersion ?? null,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    ...extra,
  });
}

/** Tiny GPU timer based on EXT_disjoint_timer_query_webgl2 (optional, off by default). */
class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.enabled = false;
    /** @type {Record<string, number>} smoothed milliseconds per stage */
    this.results = {};
    /** @type {Record<string, number>} minimum milliseconds per stage since enabled */
    this.min = {};
    this._pending = [];
    this._free = [];
    this._active = null;
  }
  get supported() { return !!this.ext; }
  begin(label) {
    if (!this.enabled || !this.ext) return;
    if (this._active) this.end();
    const gl = this.gl;
    const entry = this._free.pop() || { q: gl.createQuery(), label: '' };
    entry.label = label;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, entry.q);
    this._active = entry;
  }
  end() {
    if (!this._active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this._pending.push(this._active);
    this._active = null;
  }
  poll() {
    if (!this.ext || this._pending.length === 0) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this._pending.length) {
      const e = this._pending[0];
      if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(e.q, gl.QUERY_RESULT);
      if (!disjoint) {
        const ms = ns / 1e6;
        const prev = this.results[e.label];
        this.results[e.label] = prev === undefined ? ms : prev * 0.9 + ms * 0.1;
        this.min[e.label] = Math.min(this.min[e.label] ?? Infinity, ms);
      }
      this._pending.shift();
      this._free.push(e);
    }
  }
  dispose() {
    const gl = this.gl;
    if (this._active) this.end();
    for (const e of this._pending) gl.deleteQuery(e.q);
    for (const e of this._free) gl.deleteQuery(e.q);
    this._pending.length = 0;
    this._free.length = 0;
  }
}

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {{samples?:number, dofScale?:number, maxTaps?:number}} [opts]
   *   - samples:  MSAA samples of the scene target (default 4; 0 disables MSAA)
   *   - dofScale: resolution scale of the bokeh passes (default 0.5, clamped to 0.25..1)
   *   - maxTaps:  upper bound for the gather tap count (48 | 64 | 96, default 96; 48 is used at
   *               the default blur, larger blurs step up to keep ≈0.3 taps per px² of the disc)
   */
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.samples = Math.max(0, opts.samples ?? 4) | 0;
    this.dofScale = clamp(opts.dofScale ?? 0.5, 0.25, 1);
    this.maxTaps = Math.max(48, opts.maxTaps ?? 96);

    /**
     * Live settings (read every frame). Contract members plus a few extras:
     *  dof.debug (CoC visualisation), dof.bokehThreshold (HDR luminance, pre-exposure, above which
     *  highlight energy is scattered as bokeh discs), dof.bokehSprites (toggle the scatter pass),
     *  dof.tiltFeather (uv distance over which the tilt-shift term ramps in),
     *  dof.focusSpeed (autofocus rate, 1/s); bloom.warmth (warm tint of the wide bloom mips),
     *  bloom.knee (soft threshold width); grade.vignetteRoundness (0 = follows the screen
     *  rectangle, 1 = circular), grade.vignetteColor, grade.grainSize (px), grade.dither (LSB).
     *  cinematic (the film look, off by default): enabled; streaks (anamorphic streak strength,
     *  0 = none), streakThreshold (bright-pass energy — above the bloom's threshold — below which
     *  nothing streaks), streakTint ([r, g, b] the lens coating's colour), streakTintMix (0 = the
     *  light's own colour … 1 = the tint), bokehSquash (1 = round bokeh … 3 = ovals three times as
     *  tall as wide), tealOrange (0…1 pull of the hues toward the orange / teal axis), filmCurve
     *  (0…1 print S-curve), black / white ([r, g, b] the print's black and white points),
     *  grainChroma (0…1 colour in the grain, which turns into film grain).
     */
    this.settings = {
      enabled: true,
      dof: {
        enabled: true,
        focusDistance: 24,
        focusRange: 5,
        maxBlur: 12,
        nearScale: 1.4,
        farScale: 1.0,
        tiltShift: 0.35,
        tiltCenter: 0.52,
        tiltWidth: 0.28,
        bokehBoost: 1.5,
        autoFocus: true,
        // extras
        debug: false,
        bokehThreshold: 1.5,
        bokehSprites: true,
        tiltFeather: 0.3,
        focusSpeed: 4,
      },
      bloom: {
        enabled: true,
        strength: 0.55,
        radius: 0.55,
        threshold: 0.82,
        // extras
        warmth: 0.25,
        knee: 0.35,
      },
      grade: {
        enabled: true,
        exposure: 1.0,
        contrast: 1.08,
        saturation: 1.12,
        temperature: 0.08,
        tint: 0.0,
        shadowsTint: [0.02, 0.04, 0.08],
        highlightsTint: [0.06, 0.03, -0.02],
        vignette: 0.5,
        vignetteSoftness: 0.55,
        grain: 0.035,
        chromaticAberration: 0.0015,
        sharpen: 0.15,
        // extras
        vignetteRoundness: 0.65,
        vignetteColor: [0.05, 0.025, 0.04],
        grainSize: 1,
        dither: 1,
      },
      cinematic: {
        enabled: false,
        streaks: 1.0,
        streakThreshold: 1.0,
        streakTint: [0.25, 0.5, 1.0],
        streakTintMix: 0.85,
        bokehSquash: 1.6,
        tealOrange: 0.3,
        filmCurve: 0.25,
        black: [0.025, 0.035, 0.045],
        white: [0.97, 0.955, 0.92],
        grainChroma: 0.3,
      },
    };

    this._focusTarget = null;
    this._time = 0;
    this._w = 0;
    this._h = 0;
    this._hw = 0;
    this._hh = 0;
    this._taps = GATHER_BUCKETS[0];
    this._v2 = new THREE.Vector2();
    this._clearColor = new THREE.Color();
    this._bloomWarmth = -1;
    this._sceneInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };

    // --- render targets (sized in _allocate)
    this._depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this._sceneRT = makeTarget(1, 1, { samples: this.samples, depthBuffer: true, depthTexture: this._depthTexture });
    this._prefilterRT = makeTarget(1, 1, { count: 2 }); // [0] colour + CoC, [1] highlight energy
    this._gatherRT = makeTarget(1, 1);
    this._tentRT = makeTarget(1, 1);
    this._nearBokehRT = makeTarget(1, 1);
    this._hdrRT = makeTarget(1, 1);
    this._ldrRT = makeTarget(1, 1);
    this._sceneRT.texture.name = 'PostFX.scene';
    this._prefilterRT.textures[0].name = 'PostFX.dofColorCoc';
    this._prefilterRT.textures[1].name = 'PostFX.dofHighlights';
    this._gatherRT.texture.name = 'PostFX.dofGather';
    this._tentRT.texture.name = 'PostFX.dofBlur';
    this._nearBokehRT.texture.name = 'PostFX.dofNearBokeh';
    this._hdrRT.texture.name = 'PostFX.hdr';
    this._ldrRT.texture.name = 'PostFX.ldr';

    // --- materials
    this._coc = createCocUniforms();
    this._prefilterMat = makePostMaterial(DofPrefilterShader, this._coc);
    /** @type {Map<number, THREE.ShaderMaterial>} */
    this._gatherMats = new Map();
    this._tentMat = makePostMaterial(DofTentShader);
    this._spriteMat = makePostMaterial(DofBokehSpriteShader, null, null, {
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      transparent: true,
    });
    this._compositeMat = makePostMaterial(DofCompositeShader, this._coc);
    this._debugMat = makePostMaterial(DofCompositeShader, this._coc, { DEBUG: 1 });
    this._gradeMat = makePostMaterial(GradeShader);
    this._copyMat = makePostMaterial(CopyShader);
    this._quad = new FullScreenQuad(null);
    /**
     * The cinematic stage's materials and streak targets, made on its first use (`_cinematic()`).
     * @type {{ grade: THREE.ShaderMaterial, prefilter: THREE.ShaderMaterial,
     *   blur: THREE.ShaderMaterial, composite: THREE.ShaderMaterial,
     *   targets: THREE.WebGLRenderTarget[] }|null}
     */
    this._cine = null;

    // bokeh sprite points: one vertex per 2 × 2 block of the reduced-res target (sized in
    // _allocate; positions come from gl_VertexID)
    this._spriteGeo = new THREE.BufferGeometry();
    this._spriteCapacity = 0;
    this._sprites = new THREE.Points(this._spriteGeo, this._spriteMat);
    this._sprites.frustumCulled = false;
    this._spriteCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const gl = renderer.getContext();
    const psr = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this._spriteMat.uniforms.uMaxPointSize.value = Math.max(1, Math.min(256, psr ? psr[1] : 64));

    // --- three passes
    const s = this.settings.bloom;
    this._bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), s.strength, s.radius, s.threshold);
    const bright = makePostMaterial(BloomBrightPassShader);
    this._bloom.materialHighPassFilter.dispose();
    this._bloom.materialHighPassFilter = bright;
    this._bloom.highPassUniforms = bright.uniforms;
    this._output = /** @type {OutputPassRender} */ (new OutputPass());

    this._timer = new GpuTimer(gl);

    renderer.getDrawingBufferSize(this._v2);
    this._allocate(Math.max(1, this._v2.x), Math.max(1, this._v2.y));
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  /**
   * Resize all targets. Width/height are CSS pixels (as passed to renderer.setSize).
   * `render()` also re-syncs with the renderer's drawing buffer automatically.
   * @param {number} width
   * @param {number} height
   * @param {number} [pixelRatio]
   */
  setSize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w !== this._w || h !== this._h) this._allocate(w, h);
  }

  /**
   * Set the autofocus target distance (camera → subject). When `settings.dof.autoFocus` is true
   * `focusDistance` follows it smoothly; otherwise focusDistance stays under manual control.
   * @param {number} distance
   * @param {boolean} [immediate=false] jump instead of animating
   */
  setFocus(distance, immediate = false) {
    if (!Number.isFinite(distance)) return;
    this._focusTarget = distance;
    if (immediate && this.settings.dof.autoFocus) this.settings.dof.focusDistance = distance;
  }

  /** Scene depth (resolved DepthTexture of the scene target, valid after `render`). */
  get depthTexture() {
    return this._depthTexture;
  }

  /** The HDR scene render target (colour + depth), for optional consumers. */
  get sceneTarget() {
    return this._sceneRT;
  }

  /** Current internal (drawing-buffer) size in pixels. */
  get size() {
    return { width: this._w, height: this._h, dofWidth: this._hw, dofHeight: this._hh };
  }

  /** Current bokeh gather tap count (depends on the blur radius, bounded by maxTaps). */
  get taps() {
    return this._taps;
  }

  /** Smoothed GPU milliseconds per stage when timings are enabled (see enableTimings). */
  get timings() {
    return this._timer.results;
  }

  /** Minimum GPU milliseconds per stage since timings were (re)enabled (robust on shared GPUs). */
  get timingsMin() {
    return this._timer.min;
  }

  /**
   * Enable/disable GPU stage timings (EXT_disjoint_timer_query_webgl2). Returns false when the
   * extension is unavailable.
   * @param {boolean} on
   */
  enableTimings(on = true) {
    this._timer.enabled = !!on && this._timer.supported;
    if (this._timer.enabled) { this._timer.min = {}; this._timer.results = {}; }
    return this._timer.enabled;
  }

  /**
   * Render one frame: scene → DOF → bloom → OutputPass → grade → screen.
   * @param {number} [dt=1/60] seconds since the previous frame (autofocus, grain animation)
   */
  render(dt = 1 / 60) {
    const renderer = this.renderer;
    const S = this.settings;
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 1 / 60;
    this._time += dt;

    // autofocus
    const dof = S.dof;
    if (dof.autoFocus && this._focusTarget !== null) {
      dof.focusDistance += (this._focusTarget - dof.focusDistance) * damp(dof.focusSpeed ?? 4, dt);
    }

    if (!S.enabled) {
      renderer.setRenderTarget(null);
      this._renderScene();
      return;
    }

    // follow the renderer's drawing buffer (resize / pixel ratio / render scale)
    renderer.getDrawingBufferSize(this._v2);
    if (this._v2.x !== this._w || this._v2.y !== this._h) this._allocate(this._v2.x, this._v2.y);

    const timer = this._timer;
    timer.poll();

    // 1. scene → HDR multisampled target (depth resolved into the DepthTexture)
    timer.begin('scene');
    renderer.setRenderTarget(this._sceneRT);
    if (!renderer.autoClear) renderer.clear();
    this._renderScene();
    timer.end();

    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    let hdr = this._sceneRT;
    const debug = !!dof.debug;
    if (dof.enabled || debug) {
      timer.begin('dof');
      this._renderDof(debug);
      timer.end();
      if (debug) {
        renderer.autoClear = oldAutoClear;
        return;
      }
      hdr = this._hdrRT;
    }

    const grade = S.grade.enabled;
    // the cinematic grade (and the streaks it adds) need the grade pass
    const cine = S.cinematic.enabled && grade;
    let streaks = false;
    if (S.bloom.enabled && S.bloom.strength > 0) {
      timer.begin('bloom');
      if (hdr === this._sceneRT) {
        // the multisampled target cannot be blended into after its resolve: copy first
        this._copyMat.uniforms.tDiffuse.value = this._sceneRT.texture;
        this._blit(this._copyMat, this._hdrRT);
        hdr = this._hdrRT;
      }
      this._updateBloom();
      this._bloom.render(renderer, null, hdr, dt, false);
      timer.end();
      if (cine && S.cinematic.streaks > 0) {
        timer.begin('streaks');
        this._renderStreaks();
        streaks = true;
        timer.end();
      }
    }

    timer.begin('output');
    this._output.renderToScreen = !grade;
    this._output.render(renderer, this._ldrRT, hdr);
    if (grade) {
      const m = cine ? this._cinematic().grade : this._gradeMat;
      this._updateGrade(m);
      // (a frame without streaks must not add the last frame's)
      if (cine) m.uniforms.uStreaks.value = streaks ? 1 : 0;
      m.uniforms.tDiffuse.value = this._ldrRT.texture;
      this._blit(m, null);
    }
    timer.end();

    renderer.autoClear = oldAutoClear;
  }

  /**
   * Compile every shader variant up front (all gather tap counts, debug view, copy path) by
   * drawing each once into a scratch target, so later setting changes never hitch. Optional —
   * call it while a loading / title screen is up.
   */
  warmup() {
    const r = this.renderer;
    const oldTarget = r.getRenderTarget();
    const oldAutoClear = r.autoClear;
    r.autoClear = false;
    for (const taps of GATHER_BUCKETS) if (taps <= this.maxTaps) this._blit(this._gatherMaterial(taps), this._gatherRT);
    // Each material is drawn into the kind of target it renders to at runtime: three keys programs
    // by the bound target (screen = sRGB output, render target = linear), so warming a pass against
    // the wrong one compiles an unused variant and leaves the real one to hitch on first use.
    // The grade pass and the CoC debug view draw to the screen.
    for (const m of [this._prefilterMat, this._tentMat, this._compositeMat, this._debugMat, this._gradeMat, this._copyMat]) {
      const target = m === this._prefilterMat ? this._prefilterRT : m === this._gradeMat || m === this._debugMat ? null : this._hdrRT;
      this._blit(m, target);
    }
    r.setRenderTarget(this._tentRT);
    r.render(this._sprites, this._spriteCam);
    // bloom (bright pass, blurs, composite, blend) and OutputPass programs
    this._updateBloom();
    this._bloom.render(r, null, this._hdrRT, 0, false);
    this._output.renderToScreen = false;
    this._output.render(r, this._ldrRT, this._hdrRT);
    // the cinematic stage's programs, only while it is on (a page without it makes none): the
    // streak passes into their targets (after the bloom, whose bright pass they read), its grade to
    // the screen
    if (this.settings.cinematic.enabled) {
      this._renderStreaks();
      this._blit(this._cinematic().grade, null);
    }
    r.autoClear = oldAutoClear;
    r.setRenderTarget(oldTarget);
  }

  /**
   * Draw statistics of the last scene pass ({ calls, triangles, points, lines }). With PostFX
   * driving the frame, `renderer.info` (autoReset) only reflects the final post pass; use this
   * for the scene's real draw-call / triangle counts (e.g. in the debug stats overlay).
   */
  get sceneInfo() {
    return this._sceneInfo;
  }

  /** Free every GPU resource owned by the stack. */
  dispose() {
    for (const rt of [this._sceneRT, this._prefilterRT, this._gatherRT, this._tentRT, this._nearBokehRT, this._hdrRT, this._ldrRT]) rt.dispose();
    this._depthTexture.dispose();
    this._prefilterMat.dispose();
    for (const m of this._gatherMats.values()) m.dispose();
    this._gatherMats.clear();
    for (const m of [this._tentMat, this._spriteMat, this._compositeMat, this._debugMat, this._gradeMat, this._copyMat]) m.dispose();
    if (this._cine) {
      const c = this._cine;
      for (const m of [c.grade, c.prefilter, c.blur, c.composite]) m.dispose();
      for (const rt of c.targets) rt.dispose();
      this._cine = null;
    }
    this._spriteGeo.dispose();
    this._quad.dispose();
    this._bloom.dispose();
    this._output.dispose();
    this._timer.dispose();
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  _allocate(w, h) {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    this._w = w;
    this._h = h;
    const hw = Math.max(1, Math.ceil(w * this.dofScale));
    const hh = Math.max(1, Math.ceil(h * this.dofScale));
    this._hw = hw;
    this._hh = hh;

    this._sceneRT.setSize(w, h);
    this._hdrRT.setSize(w, h);
    this._ldrRT.setSize(w, h);
    for (const rt of [this._prefilterRT, this._gatherRT, this._tentRT, this._nearBokehRT]) rt.setSize(hw, hh);
    this._bloom.setSize(w, h);

    // grow-only vertex buffer for the sprite points (one per 2×2 reduced-res block)
    const n = Math.ceil(hw / 2) * Math.ceil(hh / 2);
    if (n > this._spriteCapacity) {
      this._spriteCapacity = Math.ceil(n * 1.25);
      this._spriteGeo.dispose();
      this._spriteGeo.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(this._spriteCapacity), 1));
      // positions come from gl_VertexID; give three a fixed volume instead of computing one
      this._spriteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      this._spriteGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    }
    this._spriteGeo.setDrawRange(0, n);

    const pu = this._prefilterMat.uniforms;
    pu.uFullSize.value.set(w, h);
    pu.uRatio.value.set(w / hw, h / hh);
    pu.uScale.value = this.dofScale;

    this._tentMat.uniforms.uSize.value.set(hw, hh);
    this._spriteMat.uniforms.uSize.value.set(hw, hh);
    for (const m of [this._compositeMat, this._debugMat]) {
      m.uniforms.uHalfSize.value.set(hw, hh);
      m.uniforms.uHalfRatio.value.set(hw / w, hh / h);
      m.uniforms.uScale.value = this.dofScale;
      m.uniforms.uFullTexel.value.set(1 / w, 1 / h);
    }
    this._gradeMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this._gradeMat.uniforms.uAspect.value = w / h;
    if (this._cine) this._sizeCinematic();
  }

  /** The cinematic stage's materials and targets: made on its first use, sized to the frame. */
  _cinematic() {
    if (!this._cine) {
      const targets = [];
      for (let i = 0; i < 5; i++) {
        const rt = makeTarget(1, 1);
        rt.texture.name = `PostFX.streak${i}`;
        targets.push(rt);
      }
      this._cine = {
        grade: makePostMaterial(GradeShader, null, { CINEMATIC: 1 }),
        prefilter: makePostMaterial(StreakPrefilterShader),
        blur: makePostMaterial(StreakBlurShader),
        composite: makePostMaterial(StreakCompositeShader),
        targets,
      };
      // the streaks: the composite's output, written into the prefilter's target once the first
      // blur has read it
      this._cine.grade.uniforms.tStreak.value = targets[0].texture;
      this._sizeCinematic();
    }
    return this._cine;
  }

  /** The streak targets at ¼ of the frame; the cinematic grade's texel and aspect. */
  _sizeCinematic() {
    const c = this._cine;
    const w = this._w;
    const h = this._h;
    const sw = Math.max(1, Math.ceil(w / 4));
    const sh = Math.max(1, Math.ceil(h / 4));
    for (const rt of c.targets) rt.setSize(sw, sh);
    c.blur.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    c.grade.uniforms.uTexel.value.set(1 / w, 1 / h);
    c.grade.uniforms.uAspect.value = w / h;
  }

  /**
   * The anamorphic streaks (CinematicShaders.js): the bloom's bright pass (½ res — `round(w / 2)`,
   * valid after its render) → prefilter (¼ res, `ceil(w / 4)`: half of it, rounded up) → four
   * horizontal blurs (steps 1, 3, 9, 27) → their sum, tinted, at the exposure, into the first
   * target, which the cinematic grade adds to the picture.
   */
  _renderStreaks() {
    const s = this.settings.cinematic;
    const c = this._cinematic();
    const T = c.targets;
    const bright = this._bloom.renderTargetBright;
    const pu = c.prefilter.uniforms;
    pu.tBright.value = bright.texture;
    pu.uBrightTexel.value.set(1 / bright.width, 1 / bright.height);
    pu.uThreshold.value = Math.max(0, s.streakThreshold ?? 1);
    this._blit(c.prefilter, T[0]);
    const bu = c.blur.uniforms;
    for (let i = 1; i < 5; i++) {
      bu.tSrc.value = T[i - 1].texture;
      bu.uStep.value = 3 ** (i - 1);
      this._blit(c.blur, T[i]);
    }
    const cu = c.composite.uniforms;
    cu.t1.value = T[1].texture;
    cu.t2.value = T[2].texture;
    cu.t3.value = T[3].texture;
    cu.t4.value = T[4].texture;
    if (s.streakTint) cu.uTint.value.fromArray(s.streakTint);
    cu.uTintMix.value = clamp(s.streakTintMix ?? 0.85, 0, 1);
    cu.uStrength.value = Math.max(0, s.streaks);
    cu.uExposure.value = Math.max(0, this.renderer.toneMappingExposure || 1);
    this._blit(c.composite, T[0]);
  }

  /** Render the scene into the current target and record its draw statistics (sceneInfo). */
  _renderScene() {
    const info = this.renderer.info;
    const r = info.render;
    const auto = info.autoReset;
    const c0 = auto ? 0 : r.calls;
    const t0 = auto ? 0 : r.triangles;
    const p0 = auto ? 0 : r.points;
    const l0 = auto ? 0 : r.lines;
    this.renderer.render(this.scene, this.camera);
    const s = this._sceneInfo;
    s.calls = r.calls - c0;
    s.triangles = r.triangles - t0;
    s.points = r.points - p0;
    s.lines = r.lines - l0;
  }

  _gatherMaterial(taps) {
    let m = this._gatherMats.get(taps);
    if (!m) {
      m = makePostMaterial(createDofGatherShader(taps));
      this._gatherMats.set(taps, m);
    }
    return m;
  }

  _blit(material, target) {
    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this._quad.render(this.renderer);
  }

  _clear(target) {
    const r = this.renderer;
    r.getClearColor(this._clearColor);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(this._clearColor, alpha);
  }

  _renderDof(debug) {
    const d = this.settings.dof;
    /**
     * @type {THREE.PerspectiveCamera & { isOrthographicCamera?: boolean }} (an ortho camera works
     * too)
     */
    const cam = this.camera;
    const c = this._coc;
    const renderer = this.renderer;

    const maxBlurPx = Math.max(0, d.maxBlur) * (this._h / 1080);
    c.tDepth.value = this._depthTexture;
    c.uCamNear.value = cam.near;
    c.uCamFar.value = cam.far;
    c.uFocusDistance.value = d.focusDistance;
    c.uFocusRange.value = Math.max(0.01, d.focusRange);
    c.uNearScale.value = Math.max(0, d.nearScale);
    c.uFarScale.value = Math.max(0, d.farScale);
    c.uMaxBlurPx.value = maxBlurPx;
    c.uTilt.value.set(Math.max(0, d.tiltShift), d.tiltCenter, Math.max(0, d.tiltWidth));
    c.uTiltFeather.value = Math.max(0.01, d.tiltFeather ?? 0.3);
    c.uOrtho.value = cam.isOrthographicCamera ? 1 : 0;

    const maxScale = Math.max(d.nearScale, d.farScale, d.tiltShift, 0);
    const radius = Math.max(1, maxBlurPx * maxScale * this.dofScale); // reduced-res px

    // tap count: keep ≈0.3 taps / px² of the disc, bounded
    const want = 0.3 * Math.PI * radius * radius;
    let taps = GATHER_BUCKETS[0];
    for (let i = 0; i < GATHER_BUCKETS.length; i++) {
      const b = GATHER_BUCKETS[i];
      if (b > this.maxTaps) break;
      taps = b;
      if (b >= want) break;
    }
    this._taps = taps;

    const sprites = d.bokehSprites !== false && !debug;
    const exposure = Math.max(1e-3, renderer.toneMappingExposure || 1);
    const colorCoc = this._prefilterRT.textures[0];
    const highlights = this._prefilterRT.textures[1];

    // 1. prefilter (MRT)
    const pu = this._prefilterMat.uniforms;
    pu.tColor.value = this._sceneRT.texture;
    pu.uBokehThreshold.value = Math.max(0.05, d.bokehThreshold ?? 1.5) / exposure;
    pu.uSprites.value = sprites ? 1 : 0;
    this._blit(this._prefilterMat, this._prefilterRT);

    // 2. gather
    const g = this._gatherMaterial(taps);
    g.uniforms.tColorCoc.value = colorCoc;
    g.uniforms.uTexel.value.set(1 / this._hw, 1 / this._hh);
    g.uniforms.uRadius.value = radius;
    this._blit(g, this._gatherRT);

    // 3. tent
    const t = this._tentMat.uniforms;
    t.tBlur.value = this._gatherRT.texture;
    t.tColorCoc.value = colorCoc;
    this._blit(this._tentMat, this._tentRT);

    // 4. highlight sprites: far discs into the blurred layer, near discs into their own layer
    if (sprites) {
      const su = this._spriteMat.uniforms;
      su.tColorCoc.value = colorCoc;
      su.tHighlight.value = highlights;
      su.tGather.value = this._gatherRT.texture;
      su.uBoost.value = Math.max(0, d.bokehBoost);
      su.uMaxRadius.value = radius;
      const cine = this.settings.cinematic;
      su.uSquash.value = cine.enabled ? clamp(cine.bokehSquash ?? 1, 1, 3) : 1;
      su.uMode.value = 0;
      renderer.setRenderTarget(this._tentRT);
      renderer.render(this._sprites, this._spriteCam);
      su.uMode.value = 1;
      this._clear(this._nearBokehRT);
      renderer.render(this._sprites, this._spriteCam);
    }

    // 5. composite (or debug view straight to the screen)
    const m = debug ? this._debugMat : this._compositeMat;
    m.uniforms.tColor.value = this._sceneRT.texture;
    m.uniforms.tBlur.value = this._tentRT.texture;
    m.uniforms.tColorCoc.value = colorCoc;
    m.uniforms.tNearBokeh.value = this._nearBokehRT.texture;
    m.uniforms.uNearBokeh.value = sprites ? 1 : 0;
    m.uniforms.uMaxCocPx.value = Math.max(1, maxBlurPx * maxScale);
    this._blit(m, debug ? null : this._hdrRT);
  }

  _updateBloom() {
    const b = this.settings.bloom;
    const p = this._bloom;
    p.strength = b.strength;
    p.radius = b.radius;
    p.threshold = b.threshold;
    // (@types/three types highPassUniforms as a bare `object`: it is the bright pass's uniforms)
    /** @type {Record<string, THREE.IUniform>} */ (p.highPassUniforms).smoothWidth.value = Math.max(0.01, b.knee ?? 0.35);
    const warmth = b.warmth ?? 0;
    if (warmth !== this._bloomWarmth) {
      this._bloomWarmth = warmth;
      const n = p.bloomTintColors.length;
      for (let i = 0; i < n; i++) {
        const k = clamp(warmth * (0.35 + 0.65 * (i / Math.max(1, n - 1))), 0, 1);
        p.bloomTintColors[i].set(1 + 0.08 * k, 1 - 0.1 * k, 1 - 0.32 * k);
      }
    }
  }

  /** @param {THREE.ShaderMaterial} material the grade pass: `_gradeMat`, or the cinematic variant */
  _updateGrade(material) {
    const g = this.settings.grade;
    const u = material.uniforms;
    u.uExposure.value = g.exposure;
    u.uContrast.value = g.contrast;
    u.uSaturation.value = g.saturation;
    u.uTemperature.value = g.temperature;
    u.uTint.value = g.tint;
    u.uShadowsTint.value.fromArray(g.shadowsTint);
    u.uHighlightsTint.value.fromArray(g.highlightsTint);
    u.uVignette.value = g.vignette;
    u.uVignetteSoftness.value = g.vignetteSoftness;
    u.uVignetteRoundness.value = g.vignetteRoundness ?? 0.65;
    if (g.vignetteColor) u.uVignetteColor.value.fromArray(g.vignetteColor);
    u.uGrain.value = g.grain;
    u.uGrainSize.value = Math.max(1, g.grainSize ?? 1);
    // grain pattern changes at ~24 fps (filmic) independent of the display rate
    u.uGrainSeed.value = Math.floor(this._time * 24) % 997;
    u.uCA.value = g.chromaticAberration;
    u.uSharpen.value = g.sharpen;
    u.uDither.value = g.dither ?? 1;
    if (material === this._gradeMat) return;
    const c = this.settings.cinematic;
    u.uTealOrange.value = clamp(c.tealOrange ?? 0, 0, 1);
    u.uFilmCurve.value = clamp(c.filmCurve ?? 0, 0, 1);
    if (c.black) u.uBlack.value.fromArray(c.black);
    if (c.white) u.uWhite.value.fromArray(c.white);
    u.uGrainChroma.value = clamp(c.grainChroma ?? 0, 0, 1);
  }
}
