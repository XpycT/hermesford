import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { clamp, lerp, hash2, DEG2RAD } from '../utils/math.js';
import { Sky } from './Sky.js';

/** @import { LightDescriptor } from './LightPool.js' */

/**
 * LightingSystem — day/night cycle for the 2.5D diorama.
 *
 * A keyframed 24h palette (colors interpolated in LINEAR space with a cyclic monotone cubic
 * spline, so transitions are smooth and never overshoot) drives:
 *  - the directional light (sun by day, cool moonlight by night — the direction glides from
 *    one to the other during twilight, shadows always on, never a jump),
 *  - hemisphere light sky/ground colors (cool purple-blue shade, warm ground bounce),
 *  - `scene.fog` (FogExp2; fog color = sky horizon color so distant geometry melts into the sky),
 *  - `renderer.toneMappingExposure`,
 *  - the {@link Sky} dome state,
 *  - global uniforms `uNight`, `uSunDirection`, `uSunColor`, `uFogColor`,
 *  - flickering point lights and night-glowing emissive materials.
 *
 * The directional light's shadow camera is centred on a follow target (or the point the camera
 * looks at) and texel-snapped in light space so shadows do not shimmer as the camera moves.
 *
 * Only `engine.renderer`, `engine.scene` and `engine.camera` are used. Register it with
 * `engine.addSystem(lighting)`: `update` runs the clock/palette and `lateUpdate` re-centres the
 * shadow frustum after the camera rig has moved (when driven manually, call `update` after the
 * camera has been positioned).
 */

/**
 * One keyframe of the 24h palette (see DEFAULT_KEYFRAMES and `setKeyframes`): `t` in hours,
 * colours as sRGB CSS/hex strings or numbers; a missing field falls back to the nearest default.
 * @typedef {object} LightKeyframe
 * @property {number} t
 * @property {string} [name]
 * @property {string|number} [top]
 * @property {string|number} [horizon]
 * @property {string|number} [bottom]
 * @property {string|number} [sun]
 * @property {string|number} [hemiSky]
 * @property {string|number} [hemiGround]
 * @property {number} [sunI]
 * @property {number} [hemiI]
 * @property {number} [fog]
 * @property {number} [exp]
 * @property {number} [night]
 * @property {number} [moon]
 * @property {number} [shadow]
 * @property {number} [glow]
 * @property {number} [clouds]
 */
/**
 * A sun / moon arc (`sunPath` / `moonPath`, see the LightingSystem options).
 * @typedef {object} CelestialPath
 * @property {number} [noon]
 * @property {number} [lat]
 * @property {number} [dec]
 * @property {number} [refTime]
 * @property {number} [refAzimuth]
 */
/**
 * A point light made by `addPointLight`; its fields are live (read on every update). `fade` is
 * an extra 0..1 multiplier (LightPool crossfades), `flickerFactor` the current flicker (read
 * only). `tag` / `desc` are written by a LightPool: the descriptor the light draws now ('' / null
 * while parked).
 * @typedef PointLightHandle
 * @type {{ light: THREE.PointLight, intensity: number, flicker: number, nightOnly: boolean,
 *   dayIntensity: number, flickerSpeed: number, seed: number, readonly flickerFactor: number,
 *   fade: number, tag?: string, desc?: LightDescriptor | null, dispose: () => void }}
 */

/**
 * Default 24h palette. Colors are sRGB hex strings (converted to linear once); scalars:
 *  sunI   directional light intensity (sun or moon)       hemiI  hemisphere intensity
 *  fog    FogExp2 density                                  exp    tone mapping exposure
 *  night  night factor 0..1                                moon   0 = light follows the sun, 1 = the moon
 *  shadow shadow intensity (softer under moonlight)        glow   sky sun-glow strength
 *  clouds sky cloud coverage 0..1
 * @type {LightKeyframe[]}
 */
export const DEFAULT_KEYFRAMES = [
  { t: 0.0, name: 'night',
    top: '#050a1f', horizon: '#1b2a5c', bottom: '#0a1232', sun: '#7294ff', sunI: 0.85,
    hemiSky: '#2a48b4', hemiGround: '#101430', hemiI: 1.12, fog: 0.011, exp: 1.3, night: 1, moon: 1, shadow: 0.6, glow: 0.4, clouds: 0.3 },
  { t: 4.3, name: 'late night',
    top: '#070c24', horizon: '#213062', bottom: '#0d1436', sun: '#7a98ff', sunI: 0.72,
    hemiSky: '#2e4ab0', hemiGround: '#121632', hemiI: 1.1, fog: 0.0115, exp: 1.3, night: 1, moon: 1, shadow: 0.58, glow: 0.5, clouds: 0.34 },
  { t: 5.25, name: 'pre-dawn',
    top: '#18204e', horizon: '#5c5a92', bottom: '#282852', sun: '#a0a6ea', sunI: 0.16,
    hemiSky: '#5460a8', hemiGround: '#221e38', hemiI: 1.05, fog: 0.014, exp: 1.26, night: 0.86, moon: 1, shadow: 0.35, glow: 0.8, clouds: 0.45 },
  { t: 6.1, name: 'pink dawn',
    top: '#3c5098', horizon: '#f59aa0', bottom: '#8a6aa0', sun: '#ff7c6a', sunI: 2.3,
    hemiSky: '#9a86d2', hemiGround: '#6a4450', hemiI: 0.98, fog: 0.012, exp: 1.08, night: 0.3, moon: 0, shadow: 0.85, glow: 1.0, clouds: 0.45 },
  { t: 6.9, name: 'sunrise',
    top: '#4a74c4', horizon: '#f8c0a0', bottom: '#a08aa8', sun: '#ffb88a', sunI: 2.8,
    hemiSky: '#98aee0', hemiGround: '#6e5048', hemiI: 1.05, fog: 0.013, exp: 1.06, night: 0.06, moon: 0, shadow: 0.95, glow: 1.0, clouds: 0.44 },
  { t: 8.0, name: 'morning',
    top: '#4f86d6', horizon: '#d6e6f0', bottom: '#9cb6cc', sun: '#ffe6c0', sunI: 3.2,
    hemiSky: '#a2c2ec', hemiGround: '#6e5c46', hemiI: 1.05, fog: 0.011, exp: 1.02, night: 0, moon: 0, shadow: 1, glow: 0.8, clouds: 0.42 },
  { t: 12.2, name: 'noon',
    top: '#3a7ee0', horizon: '#c4e0f2', bottom: '#8fb4d0', sun: '#fff4e2', sunI: 3.5,
    hemiSky: '#a6c8f2', hemiGround: '#72624a', hemiI: 1.1, fog: 0.009, exp: 1.0, night: 0, moon: 0, shadow: 1, glow: 0.7, clouds: 0.38 },
  { t: 15.3, name: 'afternoon',
    top: '#4880d8', horizon: '#dde2da', bottom: '#9eb0c0', sun: '#ffe0b0', sunI: 3.6,
    hemiSky: '#9cb8e8', hemiGround: '#786248', hemiI: 1.1, fog: 0.0095, exp: 1.0, night: 0, moon: 0, shadow: 1, glow: 0.8, clouds: 0.42 },
  // Golden hour: a golden (not red) sun so sunlit grass reads warm yellow-green instead of olive;
  // strong violet-blue sky fill + warm ground bounce keeps the long shadows readable (the default
  // camera looks at the shaded, camera-facing sides of everything at this time of day).
  { t: 17.2, name: 'golden hour',
    top: '#3e4c9a', horizon: '#f7a068', bottom: '#a0628a', sun: '#ffb466', sunI: 6.0,
    hemiSky: '#7078cc', hemiGround: '#9a6444', hemiI: 1.45, fog: 0.0098, exp: 1.12, night: 0, moon: 0, shadow: 1, glow: 1.0, clouds: 0.48 },
  { t: 18.45, name: 'sunset',
    top: '#2a2a70', horizon: '#ec7e6c', bottom: '#643a70', sun: '#ff8050', sunI: 3.1,
    hemiSky: '#6c5ec4', hemiGround: '#4c2e44', hemiI: 1.2, fog: 0.0112, exp: 1.12, night: 0.22, moon: 0, shadow: 0.85, glow: 1.3, clouds: 0.5 },
  { t: 19.25, name: 'purple dusk',
    top: '#1a1c54', horizon: '#8a5a9e', bottom: '#2c2052', sun: '#c07aaa', sunI: 0.3,
    hemiSky: '#4c4ea8', hemiGround: '#2a1c36', hemiI: 1.15, fog: 0.013, exp: 1.28, night: 0.62, moon: 0, shadow: 0.5, glow: 0.9, clouds: 0.46 },
  { t: 20.05, name: 'blue hour',
    top: '#0b1240', horizon: '#2c3e82', bottom: '#111a40', sun: '#7090f4', sunI: 0.38,
    hemiSky: '#304cae', hemiGround: '#12152e', hemiI: 1.08, fog: 0.0125, exp: 1.28, night: 0.92, moon: 1, shadow: 0.5, glow: 0.5, clouds: 0.42 },
  { t: 21.4, name: 'night',
    top: '#060b20', horizon: '#1c2b5c', bottom: '#0b1332', sun: '#7294ff', sunI: 0.82,
    hemiSky: '#2a48b4', hemiGround: '#101430', hemiI: 1.12, fog: 0.011, exp: 1.3, night: 1, moon: 1, shadow: 0.6, glow: 0.4, clouds: 0.3 },
];

const COLOR_FIELDS = ['top', 'horizon', 'bottom', 'sun', 'hemiSky', 'hemiGround'];
const SCALAR_FIELDS = ['sunI', 'hemiI', 'fog', 'exp', 'night', 'moon', 'shadow', 'glow', 'clouds'];
const CHANNELS = COLOR_FIELDS.length * 3 + SCALAR_FIELDS.length;
const SCALAR_BASE = COLOR_FIELDS.length * 3;
const S = Object.fromEntries(SCALAR_FIELDS.map((f, i) => [f, SCALAR_BASE + i]));

/** Directional light intensity that maps to uSunColor ≈ 1 (noon-ish). */
const SUN_REFERENCE_INTENSITY = 3.5;

// ---------------------------------------------------------------------------
// Cyclic monotone cubic (PCHIP) interpolation over the 24h keyframes
// ---------------------------------------------------------------------------

class CyclicPchip {
  /**
   * @param {number[]} times ascending key times in [0, period)
   * @param {Float64Array} values key-major values: values[k * channels + c]
   * @param {number} channels
   * @param {number} period
   */
  constructor(times, values, channels, period = 24) {
    const n = times.length;
    this.n = n;
    this.channels = channels;
    this.period = period;
    this.t = new Float64Array(n + 1);
    this.y = new Float64Array((n + 1) * channels);
    this.m = new Float64Array((n + 1) * channels);
    for (let k = 0; k < n; k++) this.t[k] = times[k];
    this.t[n] = times[0] + period;
    this.y.set(values.subarray(0, n * channels));
    this.y.set(values.subarray(0, channels), n * channels);

    const h = new Float64Array(n);
    for (let k = 0; k < n; k++) h[k] = this.t[k + 1] - this.t[k];
    const d = new Float64Array(n);
    for (let c = 0; c < channels; c++) {
      for (let k = 0; k < n; k++) d[k] = (this.y[(k + 1) * channels + c] - this.y[k * channels + c]) / h[k];
      for (let k = 0; k < n; k++) {
        const kp = (k - 1 + n) % n;
        const d0 = d[kp];
        const d1 = d[k];
        let m = 0;
        if (d0 * d1 > 0) {
          // Weighted harmonic mean (Fritsch–Butland / MATLAB pchip): monotone, no overshoot.
          const h0 = h[kp];
          const h1 = h[k];
          const w1 = 2 * h1 + h0;
          const w2 = h1 + 2 * h0;
          m = (w1 + w2) / (w1 / d0 + w2 / d1);
        }
        this.m[k * channels + c] = m;
      }
      this.m[n * channels + c] = this.m[c];
    }
  }

  /** Evaluate all channels at time `time` into `out`. */
  evaluate(time, out) {
    const { n, channels, t } = this;
    let x = time - t[0];
    x = ((x % this.period) + this.period) % this.period + t[0];
    let k = 0;
    while (k < n - 1 && x >= t[k + 1]) k++;
    const hk = t[k + 1] - t[k];
    const s = (x - t[k]) / hk;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = (s3 - 2 * s2 + s) * hk;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = (s3 - s2) * hk;
    const a = k * channels;
    const b = (k + 1) * channels;
    for (let c = 0; c < channels; c++) {
      out[c] = h00 * this.y[a + c] + h10 * this.m[a + c] + h01 * this.y[b + c] + h11 * this.m[b + c];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Celestial paths
// ---------------------------------------------------------------------------

/**
 * Direction toward a celestial body moving on a tilted circle (simple sun-path model).
 * Unrotated frame: noon culmination toward +Z, rises in +X, sets in -X. `yaw` (radians)
 * then rotates the whole path about Y. Azimuth convention: (x, z) = (sin φ, cos φ).
 */
function celestialDirection(hours, path, yaw, out) {
  const H = ((hours - path.noon) / 24) * Math.PI * 2;
  const lat = path.lat * DEG2RAD;
  const dec = path.dec * DEG2RAD;
  const cd = Math.cos(dec);
  const sd = Math.sin(dec);
  const ch = Math.cos(H);
  const sh = Math.sin(H);
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const x = -cd * sh;
  const y = sd * sl + cd * ch * cl;
  const z = -sd * cl + cd * ch * sl;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return out.set(x * cy + z * sy, y, -x * sy + z * cy).normalize();
}

/** Yaw that puts `path` at azimuth `azimuthDeg` at time `hours`. */
function solveYaw(path, hours, azimuthDeg) {
  const v = celestialDirection(hours, path, 0, new THREE.Vector3());
  return azimuthDeg * DEG2RAD - Math.atan2(v.x, v.z);
}

/** Smooth maximum (C1) of a and b with blend width k. */
const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
/** Smooth minimum (C1). */
const smin = (a, b, k) => 0.5 * (a + b - Math.sqrt((a - b) * (a - b) + k * k));

function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

// ---------------------------------------------------------------------------
// Smooth 1D noise for flicker
// ---------------------------------------------------------------------------

function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash2(i, 0, seed), hash2(i + 1, 0, seed), u);
}

/** Smooth fbm flicker noise in [0, 1]. */
function flickerNoise(t, seed) {
  return noise1(t, seed) * 0.55 + noise1(t * 2.37 + 11.3, seed + 17) * 0.3 + noise1(t * 5.13 + 3.1, seed + 41) * 0.15;
}

// ---------------------------------------------------------------------------
// Scratch objects (no per-frame allocations)
// ---------------------------------------------------------------------------

const _center = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upAxis = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();

const srgbHexToLinear = (hex, out) => out.setStyle(hex, THREE.SRGBColorSpace);

// ---------------------------------------------------------------------------
// LightingSystem
// ---------------------------------------------------------------------------

export class LightingSystem {
  /**
   * @param {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera}} engine
   * @param {{ timeOfDay?: number, timeSpeed?: number, shadowMapSize?: number, shadowExtent?: number,
   *           keyframes?: LightKeyframe[], sky?: ConstructorParameters<typeof Sky>[0],
   *           lightDistance?: number,
   *           sunPath?: CelestialPath, moonPath?: CelestialPath,
   *           minElevation?: number, maxElevation?: number, followPlaneY?: number, shadowForward?: number }} [opts]
   *   - timeOfDay (17.2): hours in [0, 24)
   *   - timeSpeed (0): game hours advanced per real second
   *   - shadowMapSize (2048), shadowExtent (22): half-size of the ortho shadow frustum (world units)
   *   - sunPath / moonPath: celestial arc parameters, merged over the defaults (any subset may be
   *     given); the arc is rotated so that at `refTime` the body sits at `refAzimuth` degrees
   *     (azimuth φ: direction (sin φ, cos φ) on XZ; 0 = +Z = camera side).
   *     Default: golden hour (17.2h) sun at -125° (behind-left) so shadows stretch toward the lower-right.
   *   - minElevation / maxElevation (deg): soft clamp of the LIGHT elevation (shadow quality)
   *   - shadowForward (0.22): the shadow frustum centre is pushed this fraction of the
   *     camera→target distance along the camera's horizontal view direction (a tilted diorama camera
   *     sees much more ground beyond its focus than in front of it)
   *   - followPlaneY (0): ground height used to find the look-at point when nothing is followed
   */
  constructor(engine, opts = {}) {
    this.name = 'lighting';
    this.engine = engine;
    this.renderer = engine.renderer;
    this.scene = engine.scene;
    this.camera = engine.camera;

    this.timeOfDay = ((opts.timeOfDay ?? 17.2) % 24 + 24) % 24;
    this.timeSpeed = opts.timeSpeed ?? 0;
    this.paused = false;

    /** Live-tweakable multipliers. */
    this.settings = { sunMul: 1, ambientMul: 1, fogMul: 1, shadows: true, exposureMul: 1, pointLightMul: 1, flicker: true, backdrop: /** @type {THREE.Color|null} */ (null) };
    /** The renderer's clear colour before a backdrop replaced it (restored when the backdrop goes). */
    this._clearBefore = null;
    /** The backdrop colour `_setBackdrop` applied last (null: the sky), so another one is noticed. */
    this._backdropApplied = /** @type {THREE.Color|null} */ (null);

    this.shadowMapSize = opts.shadowMapSize ?? 2048;
    this._shadowExtent = opts.shadowExtent ?? 22;
    this.lightDistance = opts.lightDistance ?? 70;
    this.minElevation = (opts.minElevation ?? 10) * DEG2RAD;
    this.maxElevation = (opts.maxElevation ?? 68) * DEG2RAD;
    this.followPlaneY = opts.followPlaneY ?? 0;
    this.shadowForward = opts.shadowForward ?? 0.22;
    /** Shadow filter radius (in shadow texels) by day and by night. */
    this.shadowRadius = { day: 2.5, night: 3.2 };

    this.sunPath = { noon: 12.4, lat: 45, dec: 5, refTime: 17.2, refAzimuth: -125, ...(opts.sunPath || {}) };
    this.moonPath = { noon: 23.6, lat: 45, dec: 2, refTime: 0, refAzimuth: 140, ...(opts.moonPath || {}) };
    this._sunYaw = solveYaw(this.sunPath, this.sunPath.refTime, this.sunPath.refAzimuth);
    this._moonYaw = solveYaw(this.moonPath, this.moonPath.refTime, this.moonPath.refAzimuth);

    // Scene graph -----------------------------------------------------------
    // Keep this group untransformed: sun/target positions are written in world space.
    this.group = new THREE.Group();
    this.group.name = 'LightingSystem';

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'Sun';
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    sh.bias = -0.0002;
    sh.normalBias = 0.055;
    sh.radius = this.shadowRadius.day;
    sh.camera.near = 1;
    sh.camera.far = this.lightDistance * 2.4;
    this._applyShadowExtent();
    this.group.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xa0c0ff, 0x604838, 1);
    this.hemi.name = 'Hemisphere';
    this.hemi.position.set(0, 1, 0);
    this.group.add(this.hemi);

    this.pointLightGroup = new THREE.Group();
    this.pointLightGroup.name = 'PointLights';
    this.group.add(this.pointLightGroup);

    this.sky = new Sky(opts.sky);
    this.scene.add(this.group);
    this.scene.add(this.sky.object);

    this.fog = new THREE.FogExp2(0x9fb0c8, 0.012);
    this._previousFog = this.scene.fog;
    this.scene.fog = this.fog;

    // three r186 removed PCFSoftShadowMap for WebGL (it silently falls back to PCF with a warning);
    // switch up-front so the console stays clean. shadow.radius gives the soft look.
    if (this.renderer?.shadowMap) {
      this.renderer.shadowMap.enabled = true;
      if (this.renderer.shadowMap.type === THREE.PCFSoftShadowMap) this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }

    // Keyframes -------------------------------------------------------------
    this._values = new Float64Array(CHANNELS);
    this.setKeyframes(opts.keyframes ?? DEFAULT_KEYFRAMES);

    /** Current interpolated state (read-only snapshot, updated every frame). */
    this.state = {
      skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), skyBottom: new THREE.Color(),
      sunColor: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
      sunIntensity: 0, hemiIntensity: 0, fogDensity: 0, exposure: 1, night: 0, moonBlend: 0,
      shadowIntensity: 1, glow: 1, clouds: 0.4,
      sunElevation: 0, lightElevation: 0,
    };

    this._sunDir = new THREE.Vector3(0, 1, 0); // true sun
    this._moonDir = new THREE.Vector3(0, 1, 0); // true moon
    this._lightDir = new THREE.Vector3(0, 1, 0); // directional light (sun/moon blend, clamped)
    this._skyState = {
      top: this.state.skyTop, horizon: this.state.skyHorizon, bottom: this.state.skyBottom,
      sunDirection: this._sunDir, moonDirection: this._moonDir, sunColor: new THREE.Color(),
      night: 0, glow: 1, clouds: 0.4,
    };

    this._follow = null;
    this._clock = 0;
    this._pointLights = [];
    /**
     * Point lights made with `indexed: false` (the combat VFX lights, VfxLights.js): they take no
     * creation index, so the default flicker seeds of the others stay as without them.
     * @type {Set<PointLightHandle>}
     */
    this._unindexed = new Set();
    this._emissives = [];
    this._nightFactor = 0;

    this._apply(0);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Set the time of day (hours, wrapped to [0, 24)) and apply it immediately. */
  setTime(hours) {
    this.timeOfDay = ((hours % 24) + 24) % 24;
    this._apply(0);
  }

  /** 0 = full day … 1 = full night (smooth through dusk/dawn). */
  get nightFactor() { return this._nightFactor; }

  /** Name of the keyframe nearest to the current time (e.g. 'golden hour'), handy for HUDs. */
  get phaseName() {
    let best = '';
    let bd = Infinity;
    const t = this.timeOfDay;
    for (let i = 0; i < this.keyframes.length; i++) {
      const k = this.keyframes[i];
      const d = Math.min(Math.abs(k.t - t), 24 - Math.abs(k.t - t));
      if (d < bd) { bd = d; best = k.name ?? ''; }
    }
    return best;
  }

  /** Direction toward the current directional light source (the sun by day, the moon by night). */
  get sunDirection() { return this._lightDir; }

  /** Direction toward the actual sun (may be below the horizon). */
  get trueSunDirection() { return this._sunDir; }

  /** Direction toward the moon. */
  get moonDirection() { return this._moonDir; }

  get shadowExtent() { return this._shadowExtent; }
  set shadowExtent(v) { this._shadowExtent = v; this._applyShadowExtent(); }

  /**
   * Limit the depth of the shadow frustum to `up` world units toward the light and `down` units
   * away from it, measured from the frustum centre (default: near 1 … far lightDistance × 2.4,
   * i.e. up ≈ lightDistance − 1, down ≈ lightDistance × 1.4). three.js culls shadow casters
   * against this frustum, and at a low sun the default box reaches ~150 units up-sun — on a big
   * map most of the level. The depth bias is rescaled so it stays the same in world units.
   * Pass nothing to restore the default.
   * @param {number} [up] @param {number} [down]
   */
  setShadowDepthRange(up, down) {
    const cam = this.sun.shadow.camera;
    this._shadowBase ??= { near: cam.near, far: cam.far, bias: this.sun.shadow.bias };
    const base = this._shadowBase;
    if (up == null || down == null) {
      cam.near = base.near;
      cam.far = base.far;
      this.sun.shadow.bias = base.bias;
    } else {
      cam.near = Math.max(0.1, this.lightDistance - up);
      cam.far = Math.max(cam.near + 1, this.lightDistance + down);
      this.sun.shadow.bias = base.bias * ((base.far - base.near) / (cam.far - cam.near));
    }
    cam.updateProjectionMatrix();
  }

  /**
   * Centre the shadow frustum on an Object3D (world position) or a Vector3 (tracked by reference).
   * Pass null to follow the point the camera looks at.
   * @param {THREE.Object3D|THREE.Vector3|null} target
   */
  /**
   * Show the sky, or hide it behind a backdrop colour (settings.backdrop, applied by `update`): the
   * renderer's clear colour follows (no program changes — the sky's stays compiled).
   * @param {THREE.Color|null} color
   */
  _setBackdrop(color) {
    this.sky.object.visible = !color;
    // (a copy: a colour changed in place, or replaced by another, is noticed by `update`)
    this._backdropApplied = color ? (this._backdropApplied ?? new THREE.Color()).copy(color) : null;
    const r = this.renderer;
    if (!r) return;
    if (color) {
      if (!this._clearBefore) {
        const c = new THREE.Color();
        r.getClearColor(c);
        this._clearBefore = { color: c, alpha: r.getClearAlpha() };
      }
      r.setClearColor(color, 1);
    } else if (this._clearBefore) {
      r.setClearColor(this._clearBefore.color, this._clearBefore.alpha);
      this._clearBefore = null;
    }
  }

  followTarget(target) {
    this._follow = target || null;
  }

  /**
   * Replace the 24h palette. Keyframes: `{ t, top, horizon, bottom, sun, sunI, hemiSky, hemiGround,
   * hemiI, fog, exp, night, moon, shadow, glow, clouds, name? }` (colors as sRGB CSS/hex strings or
   * numbers). Missing fields fall back to the nearest default.
   * @param {LightKeyframe[]} keyframes
   */
  setKeyframes(keyframes) {
    const keys = [...keyframes].sort((a, b) => a.t - b.t);
    this.keyframes = keys;
    const values = new Float64Array(keys.length * CHANNELS);
    const col = new THREE.Color();
    keys.forEach((key, k) => {
      const fallback = DEFAULT_KEYFRAMES.reduce((best, d) => (Math.abs(d.t - key.t) < Math.abs(best.t - key.t) ? d : best));
      COLOR_FIELDS.forEach((f, i) => {
        const c = key[f] ?? fallback[f];
        if (typeof c === 'number') col.setHex(c, THREE.SRGBColorSpace);
        else srgbHexToLinear(c, col);
        values[k * CHANNELS + i * 3] = col.r;
        values[k * CHANNELS + i * 3 + 1] = col.g;
        values[k * CHANNELS + i * 3 + 2] = col.b;
      });
      SCALAR_FIELDS.forEach((f, i) => { values[k * CHANNELS + SCALAR_BASE + i] = key[f] ?? fallback[f]; });
    });
    this._track = new CyclicPchip(keys.map((k) => ((k.t % 24) + 24) % 24), values, CHANNELS, 24);
    if (this.state) this._apply(0);
  }

  /**
   * Add a (usually warm, flickering) point light. Lights are never removed or hidden after
   * creation (that would recompile every lit shader) — intensities fade instead.
   * @param {{ position?: THREE.Vector3|{x:number,y:number,z:number},
   *           color?: THREE.ColorRepresentation, intensity?: number, distance?: number,
   *           decay?: number, flicker?: number, nightOnly?: boolean, dayIntensity?: number,
   *           seed?: number, flickerSpeed?: number, indexed?: boolean }} [opts]
   *   position: the origin when omitted; `seed` defaults to one from the light's creation index
   *   (the indexed lights alive before it); `indexed: false` — the light takes no index (give it a
   *   `seed`), so lights made after it get the default seeds they would get without it
   * @returns {PointLightHandle}
   */
  addPointLight({ position, color = 0xffb46b, intensity = 8, distance = 8, decay = 2, flicker = 0.3,
    nightOnly = true, dayIntensity = 0.15, seed, flickerSpeed = 2.6, indexed = true } = {}) {
    const light = new THREE.PointLight(color, 0, distance, decay);
    light.castShadow = false;
    if (position) light.position.set(position.x, position.y, position.z);
    this.pointLightGroup.add(light);
    const index = this._pointLights.length - this._unindexed.size;
    const system = this;
    const handle = {
      light,
      intensity,
      flicker,
      nightOnly,
      dayIntensity,
      flickerSpeed,
      seed: seed ?? ((index * 7919 + 13) >>> 0),
      flickerFactor: 1,
      /** Extra 0..1 multiplier (crossfades of pooled lights, see LightPool); 1 = untouched. */
      fade: 1,
      dispose() {
        const i = system._pointLights.indexOf(handle);
        if (i >= 0) system._pointLights.splice(i, 1);
        system._unindexed.delete(handle);
        light.removeFromParent();
        light.dispose();
      },
    };
    this._pointLights.push(handle);
    if (!indexed) this._unindexed.add(handle);
    this._updatePointLight(handle);
    return handle;
  }

  /**
   * Point an existing point-light handle at another light (a pooled light moving to a different
   * lantern): position, colour, range and the flicker / day-night behaviour. Only the fields
   * given change; nothing is created or removed, so no shader recompiles. The handle's `fade`
   * is left alone (the caller crossfades).
   * @param {PointLightHandle} handle
   * @param {{ position?: {x:number,y:number,z:number}, color?: THREE.ColorRepresentation, intensity?: number,
   *           distance?: number, decay?: number, flicker?: number, nightOnly?: boolean,
   *           dayIntensity?: number, seed?: number, flickerSpeed?: number }} [opts]
   * @returns {PointLightHandle} the handle
   */
  retargetPointLight(handle, opts = {}) {
    const l = handle.light;
    if (opts.position) l.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.color !== undefined) l.color.set(opts.color);
    if (opts.distance !== undefined) l.distance = opts.distance;
    if (opts.decay !== undefined) l.decay = opts.decay;
    for (const k of ['intensity', 'flicker', 'nightOnly', 'dayIntensity', 'seed', 'flickerSpeed']) {
      if (opts[k] !== undefined) handle[k] = opts[k];
    }
    this._updatePointLight(handle);
    return handle;
  }

  /**
   * The flicker multiplier a point light with this seed / amount / speed has right now (what
   * `handle.flickerFactor` would be) — lets a light that currently has no THREE light (a pooled
   * descriptor) keep its linked emissives flickering in sync.
   * @param {number} seed @param {number} amount flicker 0..1 @param {number} [speed]
   */
  flickerAt(seed, amount, speed = 2.6) {
    if (!this.settings.flicker || !(amount > 0)) return 1;
    const n = flickerNoise(this._clock * speed, seed);
    return Math.max(0, 1 + amount * (n - 0.5) * 1.7);
  }

  /**
   * Drive `material.emissiveIntensity` by the night factor.
   * @param {THREE.Material & {emissiveIntensity:number}} material
   * @param {{ day?: number, night?: number,
   *           flicker?: { readonly flickerFactor: number } | null }} [opts]
   *   `flicker`: a handle from addPointLight (or a `LightPool#flickerSource`) whose flicker should
   *   modulate this emissive too (lantern glass in sync).
   * @returns {{ material: THREE.Material, day: number, night: number, dispose: () => void }}
   */
  registerEmissive(material, { day = 0, night = 1.6, flicker = null } = {}) {
    const system = this;
    const entry = {
      material, day, night, flicker,
      dispose() {
        const i = system._emissives.indexOf(entry);
        if (i >= 0) system._emissives.splice(i, 1);
      },
    };
    this._emissives.push(entry);
    this._updateEmissive(entry);
    return entry;
  }

  /**
   * Advance the clock (unless paused) and update every light, the fog, the sky, exposure and the
   * global uniforms. Engine-system compatible (`update(dt, t, engine)`).
   * @param {number} dt seconds
   */
  update(dt) {
    if (!this.paused && this.timeSpeed !== 0) {
      this.timeOfDay = (((this.timeOfDay + this.timeSpeed * dt) % 24) + 24) % 24;
    }
    this._apply(dt);
  }

  /**
   * Engine `lateUpdate` hook: re-centre the (texel-snapped) shadow frustum after the camera rig and
   * the follow target have moved this frame, so the shadow box never lags a frame behind the view.
   * Cheap; safe to skip when the lighting system is updated manually after the camera.
   */
  lateUpdate() {
    this._placeSun();
  }

  dispose() {
    for (const h of [...this._pointLights]) h.dispose();
    this._emissives.length = 0;
    this.sun.dispose(); // also disposes sun.shadow
    this.hemi.dispose();
    this.group.removeFromParent();
    this.sky.object.removeFromParent();
    this.sky.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = this._previousFog ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _applyShadowExtent() {
    const cam = this.sun.shadow.camera;
    const e = this._shadowExtent;
    cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e;
    cam.updateProjectionMatrix();
  }

  _apply(dt) {
    this._clock += dt;
    const v = this._track.evaluate(this.timeOfDay, this._values);
    const st = this.state;
    const cols = this._stateColors || (this._stateColors = [st.skyTop, st.skyHorizon, st.skyBottom, st.sunColor, st.hemiSky, st.hemiGround]);
    for (let i = 0; i < 6; i++) cols[i].setRGB(Math.max(0, v[i * 3]), Math.max(0, v[i * 3 + 1]), Math.max(0, v[i * 3 + 2]));
    st.sunIntensity = Math.max(0, v[S.sunI]);
    st.hemiIntensity = Math.max(0, v[S.hemiI]);
    st.fogDensity = Math.max(0, v[S.fog]);
    st.exposure = Math.max(0.05, v[S.exp]);
    st.night = clamp(v[S.night]);
    st.moonBlend = clamp(v[S.moon]);
    st.shadowIntensity = clamp(v[S.shadow]);
    st.glow = Math.max(0, v[S.glow]);
    st.clouds = clamp(v[S.clouds]);
    this._nightFactor = st.night;

    this._computeDirections();

    const set = this.settings;

    // Directional light ------------------------------------------------------
    this.sun.color.copy(st.sunColor);
    this.sun.intensity = st.sunIntensity * set.sunMul;
    const sh = this.sun.shadow;
    sh.intensity = set.shadows ? st.shadowIntensity : 0;
    sh.autoUpdate = !!set.shadows;
    sh.radius = lerp(this.shadowRadius.day, this.shadowRadius.night, st.night);
    this._placeSun();

    // Hemisphere ------------------------------------------------------------
    this.hemi.color.copy(st.hemiSky);
    this.hemi.groundColor.copy(st.hemiGround);
    this.hemi.intensity = st.hemiIntensity * set.ambientMul;

    // Fog -------------------------------------------------------------------
    // (an interior's backdrop: no sky; the fog and the background its colour)
    const backdrop = set.backdrop;
    this.fog.color.copy(backdrop ?? st.skyHorizon);
    this.fog.density = st.fogDensity * set.fogMul;
    if (this.scene.fog !== this.fog && this.scene.fog == null) this.scene.fog = this.fog;
    // (the sky shown or hidden, or one backdrop colour replaced by another)
    const applied = this._backdropApplied;
    if (this.sky.object.visible === !!backdrop || (backdrop && !(applied && applied.equals(backdrop)))) this._setBackdrop(backdrop);

    // Exposure --------------------------------------------------------------
    if (this.renderer) this.renderer.toneMappingExposure = st.exposure * set.exposureMul;

    // Global uniforms -------------------------------------------------------
    globalUniforms.uNight.value = st.night;
    globalUniforms.uSunDirection.value.copy(this._lightDir);
    globalUniforms.uSunColor.value.copy(st.sunColor).multiplyScalar((st.sunIntensity * set.sunMul) / SUN_REFERENCE_INTENSITY);
    globalUniforms.uFogColor.value.copy(backdrop ?? st.skyHorizon);

    // Sky -------------------------------------------------------------------
    const ss = this._skyState;
    // Sun glow colour: the un-dimmed light colour, so the sky keeps glowing while the direct light fades.
    ss.sunColor.copy(st.sunColor);
    ss.night = st.night;
    ss.glow = st.glow;
    ss.clouds = st.clouds;
    this.sky.setState(ss);
    this.sky.update(dt);

    // Point lights & emissives ------------------------------------------------
    for (let i = 0; i < this._pointLights.length; i++) this._updatePointLight(this._pointLights[i]);
    for (let i = 0; i < this._emissives.length; i++) this._updateEmissive(this._emissives[i]);
  }

  _computeDirections() {
    const st = this.state;
    celestialDirection(this.timeOfDay, this.sunPath, this._sunYaw, this._sunDir);
    celestialDirection(this.timeOfDay, this.moonPath, this._moonYaw, this._moonDir);

    const sunEl = Math.asin(clamp(this._sunDir.y, -1, 1));
    const moonEl = Math.asin(clamp(this._moonDir.y, -1, 1));
    st.sunElevation = sunEl;
    const k = 0.12;
    const lo = this.minElevation;
    const hi = this.maxElevation;
    const sunElC = smin(smax(sunEl, lo, k), hi, k);
    const moonElC = smin(smax(moonEl, lo, k), hi, k);
    const sunAz = Math.atan2(this._sunDir.x, this._sunDir.z);
    const moonAz = Math.atan2(this._moonDir.x, this._moonDir.z);

    // Blend in azimuth/elevation space (shortest arc): continuous, never degenerate.
    const w = st.moonBlend;
    const az = sunAz + wrapAngle(moonAz - sunAz) * w;
    const el = lerp(sunElC, moonElC, w);
    st.lightElevation = el;
    const ce = Math.cos(el);
    this._lightDir.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);
  }

  /** @param {THREE.Vector3} out @returns {THREE.Vector3} */
  _getFollowPoint(out) {
    // duck-typed below (Object3D or Vector3): read through the widest view
    const f = /** @type {THREE.Object3D & THREE.Vector3} */ (this._follow);
    if (f && f.isObject3D) return f.getWorldPosition(out);
    if (f && f.isVector3) return out.copy(f);
    // Default: the point on the ground plane the camera is looking at (camera matrix refreshed
    // by _placeSun).
    const cam = this.camera;
    if (!cam) return out.set(0, 0, 0);
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(_camDir);
    let dist = 24;
    if (_camDir.y < -0.05) dist = Math.min(60, (_camPos.y - this.followPlaneY) / -_camDir.y);
    return out.copy(_camPos).addScaledVector(_camDir, Math.max(0, dist));
  }

  /** Position the sun + target around the follow point, texel-snapped in light space. */
  _placeSun() {
    const L = this._lightDir;
    const cam = this.camera;
    // The rig may have moved the camera this frame without refreshing its world matrix yet.
    if (cam) cam.updateWorldMatrix(true, false);
    this._getFollowPoint(_center);
    if (cam && this.shadowForward !== 0) {
      _camPos.setFromMatrixPosition(cam.matrixWorld);
      const dx = _center.x - _camPos.x;
      const dz = _center.z - _camPos.z;
      const h = Math.hypot(dx, dz);
      if (h > 1e-3) {
        const dist = _camPos.distanceTo(_center);
        const k = Math.min(dist * this.shadowForward, this._shadowExtent * 0.5) / h;
        _center.x += dx * k;
        _center.z += dz * k;
      }
    }

    // Same basis Matrix4.lookAt builds for the shadow camera (eye = light, target = centre).
    const up = this.sun.shadow.camera.up;
    _right.crossVectors(up, L);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    _upAxis.crossVectors(L, _right);

    const texel = (2 * this._shadowExtent) / this.shadowMapSize;
    const x = _center.dot(_right);
    const y = _center.dot(_upAxis);
    const dx = Math.round(x / texel) * texel - x;
    const dy = Math.round(y / texel) * texel - y;
    _center.addScaledVector(_right, dx).addScaledVector(_upAxis, dy);

    this.sun.target.position.copy(_center);
    this.sun.position.copy(_center).addScaledVector(L, this.lightDistance);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  _updatePointLight(h) {
    const set = this.settings;
    let f = 1;
    if (set.flicker && h.flicker > 0) {
      const n = flickerNoise(this._clock * h.flickerSpeed, h.seed);
      f = Math.max(0, 1 + h.flicker * (n - 0.5) * 1.7);
    }
    h.flickerFactor = f;
    const nightScale = h.nightOnly ? lerp(h.dayIntensity, 1, this._nightFactor) : 1;
    const v = h.intensity * nightScale * f * set.pointLightMul;
    h.light.intensity = h.fade === 1 || h.fade === undefined ? v : v * h.fade;
  }

  _updateEmissive(e) {
    let v = lerp(e.day, e.night, this._nightFactor);
    if (e.flicker) v *= lerp(1, e.flicker.flickerFactor, 0.6);
    e.material.emissiveIntensity = v;
  }
}
