import * as THREE from 'three';
import { RENDER_ORDER } from '../constants.js';
import { clamp, hash2 } from '../utils/math.js';
import { ownValue } from '../utils/own.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { PALETTE } from '../pixel/Palette.js';
import { toThreeColor } from '../pixel/PixelCanvas.js';
import { bakeShore } from './WaterShore.js';

/**
 * @import { TileMap } from './TileMap.js'
 * @import { ShoreInput } from './WaterShore.js'
 * @import { TileRect } from '../level/types.js'
 */

/**
 * Water.js — 2.5D pixel-art water for Luminati.
 *
 * `Water` builds ONE mesh over every water tile of a TileMap (surface quads + vertical
 * "cross-section" faces where the water body ends at the diorama edge or drops to a lower
 * water level) with a custom ShaderMaterial (fog: true, lights: true):
 *  - depth-tinted colour from PALETTE.water: solid bands from a shallow teal rim to deep blue
 *    with ordered dithering only at band edges, plus slowly drifting deeper patches; more
 *    transparent in the shallows so the riverbed shows through;
 *  - a baked shore texture (8 texels per tile, blurred DataTexture): R = distance to the shore /
 *    obstacles (TileMap colliders standing in water), G = water depth, BA = flow vector. Drives
 *    a broken contact-foam rim, foam lines rolling toward the shore / around rocks, the depth
 *    colour and the flow;
 *  - pixel-quantised (16 px/unit) ripple dashes advected along the flow with a two-phase
 *    flow-map (never stretches), crest highlights and trough shading;
 *  - fresnel reflection of the sky / fog colour (`globalUniforms.uFogColor`);
 *  - sun glints: 4-point pixel stars in HDR (> 1, so they bloom), denser along the sun's
 *    specular lobe, masked by shadows; at night (`uNight`) cool moon glints;
 *  - lit by the scene's real lights (ambient + hemisphere + sun with its shadow map + point
 *    lights, Lambert-normalised) so it darkens at night and matches the terrain at every time
 *    of day; the light's hue is partly neutralised so the water keeps its own colour;
 *  - transparent with high alpha and depthWrite on (so DOF sees the surface).
 *
 * `createWaterfall()` builds an animated falling sheet (curved lip, scrolling pixel streaks that
 * accelerate downward, foam at the top lip and the bottom, sparkling droplets, ragged splashing
 * edges) plus a churning foam pool where it lands; also lit and shadowed by the scene.
 */

const WATER_LINEAR = PALETTE.water.map((c) => toThreeColor(c));

// ---------------------------------------------------------------------------
// Shared GLSL helpers
// ---------------------------------------------------------------------------

const GLSL_COMMON = /* glsl */ `
float lmHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmHash(i), lmHash(i + vec2(1.0, 0.0)), u.x),
             mix(lmHash(i + vec2(0.0, 1.0)), lmHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lmBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float lmBayer4(vec2 a) { return lmBayer2(0.5 * a) * 0.25 + lmBayer2(a); }
// keep water saturated under strongly coloured light (golden hour / purple dusk fill)
vec3 lmSaturate(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, amount), 0.0);
}
// partially neutralise a light colour: water scatters light and keeps more of its own hue
vec3 lmNeutral(vec3 irr, float amount) {
  return mix(irr, vec3(dot(irr, vec3(0.2126, 0.7152, 0.0722))), amount);
}
`;

/**
 * Diffuse irradiance from the scene's real lights (ambient + hemisphere + directional with the
 * shadow mask + point lights), divided by PI like three's Lambert BRDF, so water brightness
 * matches the MeshLambertMaterial terrain at every time of day. Needs `lights: true`.
 */
const GLSL_LIGHT = /* glsl */ `
vec3 lmIrradiance(vec3 nW, vec3 posW, float shadow) {
  vec3 n = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  vec3 irr = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) irr += getHemisphereLightIrradiance(hemisphereLights[i], n);
  #endif
  #if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) irr += directionalLights[i].color * max(dot(n, directionalLights[i].direction), 0.0) * shadow;
  #endif
  #if NUM_POINT_LIGHTS > 0
  vec3 lmVp = (viewMatrix * vec4(posW, 1.0)).xyz;
  IncidentLight lmIl;
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    getPointLightInfo(pointLights[i], lmVp, lmIl);
    irr += lmIl.color * max(dot(n, lmIl.direction), 0.0);
  }
  #endif
  return irr * RECIPROCAL_PI;
}
`;

const LIT_PARS_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLSL_COMMON}
${GLSL_LIGHT}
`;

// ---------------------------------------------------------------------------
// Water surface shader
// ---------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
attribute float aTop;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vTop;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vTop = aTop;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform float uMaxDist;
uniform float uMaxDepth;
uniform float uMaxFlow;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uCrest;
uniform vec3 uFoam;
uniform float uOpacity;
uniform float uShallowOpacity;
uniform float uGlint;
uniform float uFoamAmount;
uniform float uBrightness;
uniform float uDeepAt;
uniform float uReflect;
uniform float uSaturation;
uniform float uNeutral;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vTop;
${LIT_PARS_FRAGMENT}

// short horizontal ripple dashes (anisotropic value noise, two octaves)
float lmRipple(vec2 p, float t) {
  vec2 q = vec2(p.x * 1.9, p.y * 5.2);
  float n = lmNoise(q + vec2(t * 0.22, t * 0.08));
  return n * 0.62 + 0.38 * lmNoise(q * 2.3 + vec2(-t * 0.31, t * 0.17) + 17.0);
}

// Two-phase flow map: the pattern is advected along the local flow and restarted every
// PERIOD seconds with a contrast-preserving cross-fade, so it never stretches.
float lmFlowRipple(vec2 p, vec2 flow, float t) {
  const float PERIOD = 3.2;
  float ph0 = fract(t / PERIOD);
  float ph1 = fract(t / PERIOD + 0.5);
  float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  float r0 = lmRipple(p - flow * (ph0 * PERIOD), t);
  float r1 = lmRipple(p - flow * (ph1 * PERIOD) + vec2(0.37, 0.61), t);
  float r = mix(r1, r0, w0);
  float norm = inversesqrt(w0 * w0 + (1.0 - w0) * (1.0 - w0));
  return clamp((r - 0.5) * norm + 0.5, 0.0, 1.0);
}

void main() {
  #include <logdepthbuf_fragment>
  float t = uTime;
  float shadow = getShadowMask();
  float night = clamp(uNight, 0.0, 1.0);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 irrUp = lmNeutral(lmIrradiance(vec3(0.0, 1.0, 0.0), vWorldPos, shadow), uNeutral * (1.0 - night)) * uBrightness;
  vec3 sky = uFogColor;
  vec3 col;
  float alpha;

  if (vWorldNormal.y < 0.5) {
    // --- vertical cross-section of the water body (diorama cut / step down) ---
    vec2 axis = vec2(-vWorldNormal.z, vWorldNormal.x);
    float u = dot(vWorldPos.xz, axis);
    vec2 px = floor(vec2(u, vWorldPos.y) * 16.0);
    float below = max(0.0, vTop - (px.y + 0.5) / 16.0);
    float band = 1.6 + clamp(below / 0.3, 0.0, 1.0) * 1.9 + (lmNoise(vec2(px.x * 0.22, px.y * 0.3 + t * 0.4)) - 0.5) * 0.5;
    float q = clamp(floor(band + (lmBayer4(px) - 0.5) * 0.5), 1.0, 3.0);
    vec3 albedo = q < 1.5 ? uC1 : q < 2.5 ? uC2 : uC3;
    float wob = lmNoise(vec2(px.x * 0.35 + t * 0.6, 3.0));
    float rim = step(below, 1.1 / 16.0 + wob * 0.06);
    albedo = mix(albedo, uC1, 0.4 * step(0.78, lmNoise(vec2(px.x * 0.16 - t * 0.25, 1.3))) * (1.0 - rim));
    albedo = mix(albedo, uCrest, rim);
    vec3 irrSide = lmNeutral(lmIrradiance(normalize(vWorldNormal + vec3(0.0, 0.6, 0.0)), vWorldPos, shadow), uNeutral * (1.0 - night)) * uBrightness;
    col = albedo * mix(irrSide, irrUp, rim);
    col = mix(col, sky, 0.04);
    alpha = mix(0.95, 1.0, rim);
  } else {
    // --- surface ---
    vec2 px = floor(vWorldPos.xz * 16.0);
    vec2 pc = (px + 0.5) / 16.0;
    vec4 sh = texture2D(uShore, (pc - uShoreRect.xy) * uShoreRect.zw);
    float dist = sh.r * uMaxDist;
    float depth = min(sh.g * uMaxDepth, dist * 1.3 + 0.03);
    vec2 flow = (sh.ba * 2.0 - 1.0) * uMaxFlow;

    // depth bands: shallow teal rim → deep blue, with large slowly drifting darker patches;
    // ordered dithering only near band edges
    float dN = clamp(depth / uDeepAt, 0.0, 1.0);
    float patchN = lmNoise(pc * 0.42 + vec2(t * 0.03, -t * 0.021)) * 0.75 + lmNoise(pc * 1.3 - t * 0.05) * 0.25;
    float band = dN * 2.3 + smoothstep(0.5, 0.6, patchN) * 0.95 * dN;
    float q = clamp(floor(band + (lmBayer4(px) - 0.5) * 0.5), 0.0, 3.0);
    vec3 albedo = q < 0.5 ? uC0 : q < 1.5 ? uC1 : q < 2.5 ? uC2 : uC3;

    // pixel ripple dashes drifting with the flow
    float rp = lmFlowRipple(pc, flow, t);
    float hi = step(0.69, rp);
    float hi2 = step(0.8, rp);
    float lo = 1.0 - step(0.2, rp);
    albedo = mix(albedo, uC0, hi * (1.0 - hi2) * 0.7);
    albedo = mix(albedo, uCrest, hi2);
    albedo *= 1.0 - lo * 0.18;
    col = albedo * irrUp;

    // sky reflection (fresnel-ish, a touch stronger on crests). Stylised: weaker where the sun
    // is shadowed, so shaded water keeps its deep body colour instead of turning into a flat
    // lavender/grey veil of the (unlit, bright) horizon colour at golden hour / dusk.
    float fres = uReflect * (0.35 + 1.2 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0)) * mix(0.4, 1.0, shadow);
    col = mix(col, sky, clamp(fres + hi * 0.06 * mix(0.4, 1.0, shadow), 0.0, 0.6));

    // foam: broken contact rim + lines rolling toward the shore
    float fn = lmNoise(pc * 2.1 + vec2(t * 0.13, -t * 0.09));
    float contact = step(dist, (0.05 + 0.07 * fn) * uFoamAmount);
    float phase = dist * 2.3 + t * 0.3 + fn * 0.35;
    float lineMask = step(0.42, lmNoise(pc * 1.25 + vec2(-t * 0.05, t * 0.04) + 9.0));
    float lines = step(0.86, fract(phase)) * (1.0 - smoothstep(0.12, 0.75 * uFoamAmount, dist)) * lineMask;
    float foam = max(contact, lines * 0.85);
    col = mix(col, uFoam * irrUp, foam);

    // sun / moon glints: 4-point pixel stars in 4x4 px cells, HDR so they bloom
    vec3 L = normalize(uSunDirection);
    vec3 N = normalize(vec3((rp - 0.5) * 0.35, 1.0, (fn - 0.5) * 0.35));
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 10.0);
    vec2 cell = floor(px / 4.0);
    float ch = lmHash(cell * 1.37 + 3.1);
    float tt = t * (1.8 + ch * 1.6) + ch * 11.0;
    float slot = mod(floor(tt), 4096.0); // wrapped: hash inputs stay small after hours of uptime
    float life = fract(tt);
    float hs = lmHash(cell + slot * vec2(7.13, 3.71));
    vec2 gpos = 1.0 + floor(vec2(lmHash(cell + slot + 0.5), lmHash(cell - slot + 1.7)) * 2.0);
    vec2 lp = abs(px - cell * 4.0 - gpos);
    float manh = lp.x + lp.y;
    float centre = step(manh, 0.5);
    float arms = step(manh, 1.5) * (1.0 - centre) * step(0.28, life) * step(life, 0.72);
    float density = (0.045 + 0.35 * spec) * uGlint * (0.3 + 0.7 * hi);
    float glint = step(1.0 - density, hs) * (centre + arms * 0.5) * (1.0 - foam) * shadow * step(0.02, L.y);
    vec3 gcol = uSunColor * 3.0 * mix(1.0, 1.7, night) + mix(vec3(0.25, 0.22, 0.15), vec3(0.04, 0.07, 0.16), night);
    col += glint * gcol;

    alpha = mix(uShallowOpacity, uOpacity, smoothstep(0.02, 0.35, depth));
    alpha = max(alpha, max(foam, min(1.0, glint)));
  }

  col = lmSaturate(col, mix(uSaturation, 1.0, night));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Animated pixel-art water surface over all water tiles of a TileMap.
 */
export class Water {
  /**
   * @param {TileMap} tileMap
   * @param {{ level?: number, flow?: [number, number], resolution?: number, opacity?: number,
   *           shallowOpacity?: number, glint?: number, foam?: number, maxDistance?: number,
   *           maxDepth?: number, brightness?: number, deepAt?: number, reflect?: number,
   *           saturation?: number, neutral?: number, deferShore?: boolean }} [opts]
   *   - level: overrides the map's global waterLevel (tiles that use it)
   *   - flow ([0, 0.3]): default flow in units/s ([x, z]); per legend `flow` overrides
   *     ([x, z] or a multiplier, 0 = still water such as ponds)
   *   - resolution (8): shore-texture texels per tile
   *   - opacity (0.9) / shallowOpacity (0.58): alpha in deep / shallow water
   *   - glint (1): sparkle density multiplier; foam (1): foam width multiplier
   *   - maxDistance (2): shore distance (units) the bake measures; maxDepth (1.5): depth (units)
   *     the bake's depth channel spans
   *   - brightness (1.15): albedo multiplier; deepAt (0.34): depth (units) of the deep tone;
   *     reflect (0.1): strength of the sky / fog colour reflection; neutral (0.35): how much
   *     of the light's hue is neutralised on the water (it keeps its own teal/blue under golden
   *     or purple light); saturation (1.12): mild daytime saturation boost
   *   - deferShore (false): skip the shore bake here; the owner calls `refresh()` (or
   *     `refreshAsync()`) once the colliders standing in the water exist
   */
  constructor(tileMap, opts = {}) {
    const {
      level,
      flow = [0, 0.3],
      resolution = 8,
      opacity = 0.9,
      shallowOpacity = 0.58,
      glint = 1,
      foam = 1,
      maxDistance = 2,
      maxDepth = 1.5,
      brightness = 1.15,
      deepAt = 0.34,
      reflect = 0.1,
      saturation = 1.12,
      neutral = 0.35,
      deferShore = false,
    } = opts;
    this.tileMap = tileMap;
    this.level = level ?? tileMap.waterLevel;
    this._levelOverride = level;
    this.flow = new THREE.Vector2(flow[0] ?? 0, flow[1] ?? 0);
    this.resolution = Math.max(2, resolution | 0);
    this.maxDistance = maxDistance;
    this.maxDepth = maxDepth;

    const W = tileMap.width;
    const D = tileMap.depth;
    /** Per-tile water surface (NaN = no water) and flow. */
    this._surf = new Float32Array(W * D).fill(NaN);
    this._flow = new Float32Array(W * D * 2);
    /** Per-tile bed height of the water tiles (the shore bake's depth). */
    this._bed = new Float64Array(W * D);
    this.tiles = [];
    this._readTiles();
    const mf = this.maxFlow;

    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      THREE.UniformsLib.fog,
      {
        uShore: { value: null },
        uShoreRect: { value: new THREE.Vector4(0, 0, 1 / Math.max(1, W), 1 / Math.max(1, D)) },
        uMaxDist: { value: maxDistance },
        uMaxDepth: { value: maxDepth },
        uMaxFlow: { value: mf },
        uC0: { value: WATER_LINEAR[4].clone() },
        uC1: { value: WATER_LINEAR[3].clone() },
        uC2: { value: WATER_LINEAR[2].clone() },
        uC3: { value: WATER_LINEAR[1].clone() },
        uCrest: { value: WATER_LINEAR[5].clone() },
        uFoam: { value: WATER_LINEAR[6].clone().multiplyScalar(1.05) },
        uOpacity: { value: opacity },
        uShallowOpacity: { value: shallowOpacity },
        uGlint: { value: glint },
        uFoamAmount: { value: foam },
        uBrightness: { value: brightness },
        uDeepAt: { value: deepAt },
        uReflect: { value: reflect },
        uSaturation: { value: saturation },
        uNeutral: { value: neutral },
      },
    ]);
    // Shared engine uniforms are referenced (not copied) so one write per frame updates all.
    this.uniforms.uTime = globalUniforms.uTime;
    this.uniforms.uNight = globalUniforms.uNight;
    this.uniforms.uSunDirection = globalUniforms.uSunDirection;
    this.uniforms.uSunColor = globalUniforms.uSunColor;
    this.uniforms.uFogColor = globalUniforms.uFogColor;
    this.uniforms.uFogStart = globalUniforms.uFogStart;

    this.material = new THREE.ShaderMaterial({
      name: 'Luminati:Water',
      uniforms: this.uniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      fog: true,
      lights: true,
      transparent: true,
      depthWrite: true,
    });

    this.geometry = this._buildGeometry();
    /** The single water mesh (surface + cross-section faces). */
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = 'Water';
    this.object.renderOrder = RENDER_ORDER.WATER;
    this.object.receiveShadow = true;
    this.object.castShadow = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = this.tiles.length > 0;

    this.shoreTexture = null;
    this._colliderCount = tileMap.colliders.length;
    this._colliderSig = '';
    /**
     * rebakeShoreAsync: its worker (undefined: not made yet; null: none), the windows in flight
     * by id, and the full bakes so far (a window from before the latest `refresh()` is dropped).
     * @type {Worker|null|undefined}
     */
    this._worker = undefined;
    /** @type {Map<number, { job: any, rect: TileRect, expand: boolean, gen: number, resolve: () => void }>} */
    this._shoreJobs = new Map();
    this._shoreJobId = 0;
    this._shoreGen = 0;
    // deferShore: the owner calls refresh() once the colliders standing in the water exist (one
    // bake instead of two on a big level); nothing may render the water before that
    if (!deferShore) this.refresh();
  }

  /** Per-tile water surfaces / flow, the water tile list and `maxFlow` from the TileMap. */
  _readTiles() {
    const tm = this.tileMap;
    const W = tm.width;
    const level = this._levelOverride;
    this._surf.fill(NaN);
    this._flow.fill(0);
    this._bed.fill(0);
    this.tiles = [];
    tm.forEachTile((i, j, t) => {
      if (!t.water) return;
      const k = j * W + i;
      this._surf[k] = level != null && t.waterSource === 'global' ? level : t.waterSurface;
      this._bed[k] = t.h;
      const f = t.type.flow;
      let fx = this.flow.x;
      let fz = this.flow.y;
      if (Array.isArray(f)) { fx = f[0] ?? 0; fz = f[1] ?? 0; }
      else if (typeof f === 'number') { fx *= f; fz *= f; }
      this._flow[k * 2] = fx;
      this._flow[k * 2 + 1] = fz;
      this.tiles.push(t);
    });
    let mf = 0.05;
    for (let k = 0; k < this._flow.length; k++) mf = Math.max(mf, Math.abs(this._flow[k]));
    this.maxFlow = mf;
  }

  /** Rebuild the shore / depth / flow texture (e.g. after adding colliders standing in water). */
  refresh() {
    // (re-bake windows still in a worker are older than this: dropped — see rebakeShoreAsync)
    this._shoreGen++;
    const tex = this._buildShoreTexture();
    this.shoreTexture?.dispose();
    this.shoreTexture = tex;
    this.uniforms.uShore.value = tex;
    this._colliderCount = this.tileMap.colliders.length;
    this._colliderSig = this._waterColliderSignature();
  }

  /**
   * `refresh()` with the bake in a Web Worker (shoreWorker.js), so the main thread stays free
   * (a big level's loading screen keeps animating and the rest of the world builds meanwhile).
   * The result is byte-identical. Resolves once the new texture is in place; without workers (or
   * if the worker fails) it bakes on the main thread instead. Colliders added meanwhile are
   * picked up by `update()` as usual.
   * @returns {Promise<void>}
   */
  refreshAsync() {
    if (typeof Worker !== 'function') { this.refresh(); return Promise.resolve(); }
    const tm = this.tileMap;
    const R = this.resolution;
    const W = Math.max(1, tm.width * R);
    const H = Math.max(1, tm.depth * R);
    const input = this.shoreInput(true);
    const count = tm.colliders.length;
    const sig = this._waterColliderSignature();
    return new Promise((resolve) => {
      const worker = this._newShoreWorker();
      // (the bake is the Water's: `dispose` ends it — a level built ahead and dropped must not bake
      // on, nor fall back to a main-thread bake for a dead object)
      this._bake?.end();
      const end = () => {
        worker?.terminate();
        if (this._bake?.worker === worker) this._bake = null;
        resolve();
      };
      this._bake = { worker, end };
      const fallback = () => {
        if (this._disposed) { end(); return; }
        worker?.terminate();
        this.refresh();
        end();
      };
      if (!worker) {
        fallback();
        return;
      }
      worker.onmessage = (e) => {
        if (this._disposed) { end(); return; }
        const { out, error } = e.data ?? {};
        if (error || !out || out.length !== W * H * 4 || W !== tm.width * R || H !== tm.depth * R) { fallback(); return; }
        worker.terminate();
        if (this._bake?.worker === worker) this._bake = null;
        this._shoreData = out;
        const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
        this._setupShoreTexture(tex);
        this.shoreTexture?.dispose();
        this.shoreTexture = tex;
        this.uniforms.uShore.value = tex;
        this._colliderCount = count;
        this._colliderSig = sig;
        resolve();
      };
      worker.onerror = (e) => { e.preventDefault?.(); fallback(); };
      worker.postMessage({ id: 1, input, a0: 0, b0: 0, W, H });
    });
  }

  // -------------------------------------------------------------------------
  // Incremental updates (editors). The game builds a Water once and never calls these.
  // -------------------------------------------------------------------------

  /**
   * Tiles a change influences around it — and the context a shore re-bake reads around what it
   * writes: every term of the bake (shore distance up to `maxDistance`, the blurs) reaches at
   * most this far, so a windowed re-bake reproduces the full bake exactly.
   */
  get shoreReach() {
    return Math.ceil(this.maxDistance) + 1;
  }

  /**
   * Re-read the water tiles after the TileMap's tiles were edited in place (`TileMap.updateTiles`
   * / `rebuildRect`) and rebuild the surface geometry (cheap). The material — and its compiled
   * shader — is kept. The shore texture is left as it was: re-bake the changed tiles with
   * `rebakeShore(rect)`, or everything (in pieces, if you like) when `flowChanged` (the flow is
   * stored normalised by the largest flow on the map).
   * @returns {{ flowChanged: boolean, hasWater: boolean }}
   */
  updateTiles() {
    const tm = this.tileMap;
    if (this._surf.length !== tm.width * tm.depth) throw new Error('Water.updateTiles: the TileMap size changed');
    const prevFlow = this.maxFlow;
    this._readTiles();
    this.uniforms.uMaxFlow.value = this.maxFlow;
    const g = this._buildGeometry();
    const old = this.geometry;
    this.geometry = g;
    this.object.geometry = g;
    old.dispose();
    this.object.visible = this.tiles.length > 0;
    return { flowChanged: prevFlow !== this.maxFlow, hasWater: this.tiles.length > 0 };
  }

  /**
   * Re-bake the shore texture texels of the tiles in `rect` (inclusive) from the current tiles —
   * byte-identical to what a full bake produces there. With `expand` (default) the tiles a change
   * in `rect` can influence (`shoreReach` around it) are re-baked too, i.e. pass the changed tiles.
   * @param {TileRect} rect
   * @param {{ expand?: boolean }} [opts]
   */
  rebakeShore(rect, { expand = true } = {}) {
    if (!this._shoreData || !this.shoreTexture) { this.refresh(); return; }
    this._updateShoreWindow(rect, expand);
    this._colliderCount = this.tileMap.colliders.length;
    this._colliderSig = this._waterColliderSignature();
  }

  /**
   * `rebakeShore(rect)` with the bake in a Web Worker (shoreWorker.js; one kept per Water and
   * answered in order, so later re-bakes land after earlier ones): the window is baked from the
   * colliders as they are now and written when it comes back, a frame or so later — the same
   * bytes `rebakeShore` writes. The collider signature is taken now, so `update()` does not bake
   * the whole texture meanwhile; a `refresh()` before the answer drops it (the full bake is
   * newer). Without workers (or when the worker fails) it bakes on the main thread.
   * @param {TileRect} rect
   * @param {{ expand?: boolean }} [opts]
   * @returns {Promise<void>} resolves once the window is in the texture (or dropped)
   */
  rebakeShoreAsync(rect, { expand = true } = {}) {
    if (!this._shoreData || !this.shoreTexture) { this.refresh(); return Promise.resolve(); }
    const job = this.shoreJob(rect, { expand });
    if (!job) return Promise.resolve();
    const worker = this._shoreWorker();
    if (!worker) { this.rebakeShore(rect, { expand }); return Promise.resolve(); }
    this._colliderCount = this.tileMap.colliders.length;
    this._colliderSig = this._waterColliderSignature();
    const id = ++this._shoreJobId;
    return new Promise((resolve) => {
      this._shoreJobs.set(id, { job, rect, expand, gen: this._shoreGen, resolve });
      worker.postMessage({ id, input: this.shoreInput(true), a0: job.a0, b0: job.b0, W: job.W, H: job.H });
    });
  }

  /** The kept worker of `rebakeShoreAsync` (created on first use), or null (no workers / it failed). */
  _shoreWorker() {
    if (this._worker !== undefined) return this._worker;
    this._worker = this._newShoreWorker();
    if (!this._worker) return null;
    this._worker.onmessage = (e) => {
      const { id, out, error } = e.data ?? {};
      const f = this._shoreJobs.get(id);
      if (!f) return;
      this._shoreJobs.delete(id);
      if (f.gen === this._shoreGen && this.shoreTexture) {
        if (error || !out || !this.applyShore(f.job, out)) this.rebakeShore(f.rect, { expand: f.expand });
      }
      f.resolve();
    };
    this._worker.onerror = (e) => {
      e.preventDefault?.();
      this._worker?.terminate();
      this._worker = null;
      // what it had: on the main thread
      const pending = [...this._shoreJobs.values()];
      this._shoreJobs.clear();
      for (const f of pending) {
        if (f.gen === this._shoreGen && this.shoreTexture) this.rebakeShore(f.rect, { expand: f.expand });
        f.resolve();
      }
    };
    return this._worker;
  }

  /** A new shore-bake worker (shoreWorker.js), or null where there are none. */
  _newShoreWorker() {
    if (typeof Worker !== 'function') return null;
    try {
      return new Worker(new URL('./shoreWorker.js', import.meta.url), { type: 'module' });
    } catch {
      return null;
    }
  }

  /**
   * `updateTiles()` + the shore re-bake of the changed tiles `rect` (null or a flow-scale change:
   * the whole texture). The result equals a new Water built on the edited TileMap.
   * @param {TileRect|null} [rect]
   * @returns {boolean} whether any water remains
   */
  rebuild(rect = null) {
    const { flowChanged, hasWater } = this.updateTiles();
    if (!rect || flowChanged || !this.shoreTexture || !this._shoreData) this.refresh();
    else this.rebakeShore(rect);
    return hasWater;
  }

  /** Re-bake the shore texture for the tile rect (± shoreReach with `expand`; see rebakeShore). */
  _updateShoreWindow(rect, expand = true) {
    const job = this.shoreJob(rect, { expand });
    if (!job) return;
    this.applyShore(job, bakeShore(this.shoreInput(), job.a0, job.b0, job.W, job.H));
  }

  /**
   * The inputs of the shore bake (see WaterShore.bakeShore) — copies with `copy` (to post to a
   * worker while this Water keeps changing).
   * @returns {ShoreInput}
   */
  shoreInput(copy = false) {
    const tm = this.tileMap;
    const c = (a) => (copy ? a.slice() : a);
    // only the static colliders shape the shore: a villager (`dynamic`) standing on a pier is not a
    // post in the water, and walking off must not re-bake the texture
    const statics = tm.colliders.filter((x) => !x.dynamic);
    return {
      width: tm.width, depth: tm.depth, R: this.resolution,
      surf: c(this._surf), flow: c(this._flow), bed: c(this._bed),
      colliders: copy ? statics.map((x) => ({ ...x })) : statics,
      maxDistance: this.maxDistance, maxDepth: this.maxDepth, maxFlow: this.maxFlow,
    };
  }

  /**
   * The texel window a re-bake of the tile rect computes ({ a0, b0, W, H }) and the part of it it
   * writes (output [oa0, oa1) × [ob0, ob1)), or null when empty. Bake the window with
   * `bakeShore(shoreInput(), a0, b0, W, H)` (here or in a worker) and hand the bytes to
   * `applyShore`.
   */
  shoreJob(rect, { expand = true } = {}) {
    const tm = this.tileMap;
    const R = this.resolution;
    const TW = tm.width * R;
    const TH = tm.depth * R;
    const reach = this.shoreReach;
    const grow = expand ? reach : 0;
    const clampA = (v) => Math.max(0, Math.min(TW, v));
    const clampB = (v) => Math.max(0, Math.min(TH, v));
    // output texels: the tiles (± reach); computed over the output ± reach as context
    const oa0 = clampA((Math.floor(rect.minI) - grow) * R);
    const oa1 = clampA((Math.floor(rect.maxI) + 1 + grow) * R);
    const ob0 = clampB((Math.floor(rect.minJ) - grow) * R);
    const ob1 = clampB((Math.floor(rect.maxJ) + 1 + grow) * R);
    if (oa1 <= oa0 || ob1 <= ob0) return;
    const wa0 = clampA(oa0 - reach * R);
    const wa1 = clampA(oa1 + reach * R);
    const wb0 = clampB(ob0 - reach * R);
    const wb1 = clampB(ob1 + reach * R);
    return { a0: wa0, b0: wb0, W: wa1 - wa0, H: wb1 - wb0, oa0, oa1, ob0, ob1, TW, TH };
  }

  /** Write the output part of a baked shore window (see shoreJob) into the texture. */
  applyShore(job, win) {
    const data = this._shoreData;
    if (!data || !this.shoreTexture || job.TW !== this.tileMap.width * this.resolution || data.length !== job.TW * job.TH * 4) return false;
    for (let b = job.ob0; b < job.ob1; b++) {
      const src = ((b - job.b0) * job.W + (job.oa0 - job.a0)) * 4;
      data.set(win.subarray(src, src + (job.oa1 - job.oa0) * 4), (b * job.TW + job.oa0) * 4);
    }
    this.shoreTexture.needsUpdate = true;
    this._colliderCount = this.tileMap.colliders.length;
    this._colliderSig = this._waterColliderSignature();
    return true;
  }

  /**
   * Per-frame update. Animation is driven by globalUniforms.uTime; this only rebuilds the
   * shore texture when the set of TileMap colliders touching water changed (rocks / posts in
   * the water). Colliders added or removed on dry land never trigger the (~25 ms) rebuild.
   * Colliders mutated in place are not detected — call refresh() after moving one in water.
   * @param {number} dt
   */
  update(dt) { // eslint-disable-line no-unused-vars
    if (this.tileMap.colliders.length === this._colliderCount) return;
    this._colliderCount = this.tileMap.colliders.length;
    if (this._waterColliderSignature() !== this._colliderSig) this.refresh();
  }

  /**
   * Identity of the static colliders overlapping water tiles (geometry rounded to 1/64 unit;
   * `dynamic` colliders — walking villagers — never shape the shore).
   */
  _waterColliderSignature() {
    if (!this.tiles.length) return '';
    const parts = [];
    for (const c of this.tileMap.colliders) {
      if (c.dynamic) continue;
      const circ = c.type === 'circle';
      const x0 = circ ? c.x - c.r : c.minX;
      const x1 = circ ? c.x + c.r : c.maxX;
      const z0 = circ ? c.z - c.r : c.minZ;
      const z1 = circ ? c.z + c.r : c.maxZ;
      if (!(x1 > x0 && z1 > z0)) continue;
      let wet = false;
      const i1 = Math.min(this.tileMap.width - 1, Math.floor(x1));
      const j1 = Math.min(this.tileMap.depth - 1, Math.floor(z1));
      for (let j = Math.max(0, Math.floor(z0)); j <= j1 && !wet; j++) {
        for (let i = Math.max(0, Math.floor(x0)); i <= i1 && !wet; i++) wet = this._surfAt(i, j) === this._surfAt(i, j);
      }
      if (wet) parts.push(`${Math.round(x0 * 64)},${Math.round(x1 * 64)},${Math.round(z0 * 64)},${Math.round(z1 * 64)},${c.type}`);
    }
    return parts.join(';');
  }

  _surfAt(i, j) {
    const tm = this.tileMap;
    if (i < 0 || j < 0 || i >= tm.width || j >= tm.depth) return NaN;
    return this._surf[j * tm.width + i];
  }

  _buildGeometry() {
    const tm = this.tileMap;
    const pos = [];
    const nrm = [];
    const top = [];
    const idx = [];
    let n = 0;
    const quad = (pts, nx, ny, nz, tops) => {
      for (let k = 0; k < 4; k++) {
        pos.push(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
        nrm.push(nx, ny, nz);
        top.push(tops);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    };
    const faces = [
      { dx: 0, dz: -1, nx: 0, nz: -1 },
      { dx: 1, dz: 0, nx: 1, nz: 0 },
      { dx: 0, dz: 1, nx: 0, nz: 1 },
      { dx: -1, dz: 0, nx: -1, nz: 0 },
    ];
    for (const t of this.tiles) {
      const { i, j } = t;
      const s = this._surfAt(i, j);
      // surface (CCW seen from above)
      quad([i, s, j, i, s, j + 1, i + 1, s, j + 1, i + 1, s, j], 0, 1, 0, s);
      // cross-section faces where the water body ends above lower ground / void / lower water
      for (const F of faces) {
        const nb = tm.tileAt(i + F.dx, j + F.dz);
        let bottom;
        if (!nb) bottom = t.h;
        else if (nb.water) {
          const ns = this._surfAt(i + F.dx, j + F.dz);
          if (!(ns < s - 0.01)) continue;
          bottom = Math.max(ns, t.h);
        } else {
          if (nb.h >= s - 0.01) continue;
          bottom = Math.max(nb.h, t.h);
        }
        if (s - bottom < 0.01) continue;
        // left / right as seen from outside; right = (nz, -nx)
        const rx = F.nz, rz = -F.nx;
        const cx = i + 0.5 + F.nx * 0.5, cz = j + 0.5 + F.nz * 0.5;
        const lx = cx - rx * 0.5, lz = cz - rz * 0.5;
        const qx = cx + rx * 0.5, qz = cz + rz * 0.5;
        quad([lx, bottom, lz, qx, bottom, qz, qx, s, qz, lx, s, lz], F.nx, 0, F.nz, s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /** Bake distance-to-shore (R), depth (G) and flow (BA) at `resolution` texels per tile. */
  _buildShoreTexture() {
    const tm = this.tileMap;
    const R = this.resolution;
    const W = Math.max(1, tm.width * R);
    const H = Math.max(1, tm.depth * R);
    const data = this._bakeShore(0, 0, W, H);
    /** CPU copy of the shore texture (incremental `rebuild` patches it). */
    this._shoreData = data;
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    return this._setupShoreTexture(tex);
  }

  _setupShoreTexture(tex) {
    tex.name = 'Luminati:WaterShore';
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Bake the shore texels of the window [a0, a0 + W) × [b0, b0 + H) (texel coordinates) with the
   * window edges treated as the texture edges. The whole texture is the window (0, 0, full size).
   * @returns {Uint8Array} RGBA bytes of the window
   */
  _bakeShore(a0, b0, W, H) {
    return bakeShore(this.shoreInput(), a0, b0, W, H);
  }

  /** Free GPU resources. */
  dispose() {
    this._disposed = true;
    this._bake?.end();
    this._worker?.terminate();
    this._worker = null;
    for (const f of this._shoreJobs.values()) f.resolve();
    this._shoreJobs.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.shoreTexture?.dispose();
    this.shoreTexture = null;
    this.object.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

const FALL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
  vUv = uv;
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
}
`;

const FALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uWidth;
uniform float uLength;
uniform float uLipLength;
uniform float uSeed;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uFoam;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${LIT_PARS_FRAGMENT}
void main() {
  #include <logdepthbuf_fragment>
  float t = uTime;
  float colX = floor(vUv.x * uWidth * 16.0);
  float nCols = floor(uWidth * 16.0 + 0.5);
  float py = floor(vUv.y * 16.0);            // pixel row along the sheet (arc length)
  float fall = max(0.0, vUv.y - uLipLength);  // distance fallen past the lip
  float h1 = lmHash(vec2(colX, uSeed));
  float h2 = lmHash(vec2(floor(colX / 3.0), uSeed + 5.0));
  // water accelerates: streaks scroll faster further down
  float speed = (2.2 + h1 * 1.4) * (0.5 + 0.5 * clamp(fall / 1.0, 0.0, 1.0));
  float s1 = fract(py / 16.0 * (0.55 + 0.35 * h2) - t * speed * 0.5 + h1 * 7.0);
  float s2 = fract(py / 16.0 * 0.3 - t * speed * 0.33 + h2 * 3.0);
  vec3 albedo = mix(uC1, uC0, 0.2 + 0.6 * h2);
  albedo = mix(albedo, uC2, step(0.7, s2) * 0.85);
  albedo = mix(albedo, uC3, step(s1, 0.16));
  albedo = mix(albedo, uFoam, step(0.91, s1));
  // foam where the water bends over the lip and churning at the bottom
  // discrete animation slots are wrapped so hash inputs stay precise after hours of uptime
  float lipFoam = 1.0 - step(0.1 + 0.16 * lmHash(vec2(colX, mod(floor(t * 6.0), 4096.0))), abs(vUv.y - uLipLength));
  float bn = lmNoise(vec2(colX * 0.45, py * 0.4 - t * 5.0));
  float botFoam = step(uLength - vUv.y, 0.2 + 0.42 * bn);
  float foam = max(lipFoam * 0.85, botFoam);
  albedo = mix(albedo, uFoam, foam);
  // lighting (the normal leans up: falling water scatters sky light)
  float shadow = getShadowMask();
  vec3 nW = normalize((gl_FrontFacing ? vWorldNormal : -vWorldNormal) + vec3(0.0, 1.1, 0.0));
  float nightF = clamp(uNight, 0.0, 1.0);
  vec3 col = albedo * lmNeutral(lmIrradiance(nW, vWorldPos, shadow), 0.5 * (1.0 - nightF)) * 1.12;
  col = lmSaturate(mix(col, uFogColor, 0.06), mix(1.12, 1.0, nightF));
  // sparkling droplets (HDR, bloom) in the white water
  float sp = step(0.988, lmHash(vec2(colX, py) + mod(floor(t * 9.0), 4096.0) * vec2(3.1, 7.7)));
  col += sp * (uSunColor * 2.2 + vec3(0.1)) * shadow * (1.0 - 0.8 * clamp(uNight, 0.0, 1.0)) * step(0.5, foam + step(0.9, s1));
  // ragged, splashing side edges and a soft entry from the river surface
  float edgePx = min(colX, nCols - 1.0 - colX);
  float jag = lmHash(vec2(py + mod(floor(t * 10.0), 4096.0) * 3.0, colX + uSeed));
  if (edgePx < 1.0 && jag < 0.55) discard;
  if (edgePx < 2.0 && jag < 0.18) discard;
  float entry = smoothstep(0.0, 0.18, vUv.y);
  if (entry < lmBayer4(vec2(colX, py)) * 0.999) discard;
  gl_FragColor = vec4(col, mix(0.9, 1.0, foam));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uFogColor;
uniform vec3 uFoam;
uniform vec3 uC0;
uniform vec2 uSize;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${LIT_PARS_FRAGMENT}
void main() {
  #include <logdepthbuf_fragment>
  float t = uTime;
  vec2 px = floor(vUv * uSize * 16.0);
  vec2 pc = (px + 0.5) / 16.0;
  // distance from the impact line (v = 0 edge, centred across u)
  float across = abs(pc.x - uSize.x * 0.5) / (uSize.x * 0.5);
  float d = pc.y + max(0.0, across - 0.55) * 1.4;
  float churn = lmNoise(pc * 3.2 + vec2(t * 0.7, -t * 2.1) + uSeed);
  float bub = lmNoise(pc * 6.5 - vec2(0.0, t * 1.4) + uSeed * 2.0);
  float ring = step(0.8, fract(d * 2.2 - t * 0.9 + churn * 0.4)) * step(0.45, bub);
  float core = step(d, 0.36 + churn * 0.45);
  float speck = step(0.8, bub) * step(d, 0.95);
  float foam = max(core, max(ring * step(d, 1.05), speck * 0.8));
  foam *= step(across, 1.0 - churn * 0.12);
  if (foam < 0.5) discard;
  vec3 albedo = mix(uC0, uFoam, 0.72 + 0.28 * step(0.6, churn));
  float shadow = getShadowMask();
  float nightF = clamp(uNight, 0.0, 1.0);
  vec3 col = albedo * lmNeutral(lmIrradiance(vec3(0.0, 1.0, 0.0), vWorldPos, shadow), 0.45 * (1.0 - nightF)) * 1.1;
  col = mix(col, uFogColor, 0.05);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

let _fallCount = 0;

/**
 * Unit (x, z) vector a waterfall falls toward, per facing (frozen: `waterfallDir` hands out these
 * arrays, which every waterfall reader shares).
 * @type {Readonly<Record<'N'|'S'|'E'|'W', readonly [number, number]>>}
 */
const FALL_DIRS = Object.freeze({
  N: Object.freeze(/** @type {const} */ ([0, -1])),
  S: Object.freeze(/** @type {const} */ ([0, 1])),
  E: Object.freeze(/** @type {const} */ ([1, 0])),
  W: Object.freeze(/** @type {const} */ ([-1, 0])),
});

/**
 * The unit (x, z) vector a waterfall with this `facing` falls toward: 'N' [0, −1], 'S' [0, 1],
 * 'E' [1, 0], 'W' [−1, 0]; any other value (missing, unknown, an Object.prototype name such as
 * 'constructor') falls toward +Z like 'S'. Shared by every waterfall reader (createWaterfall, the
 * level builder, the game's spray / splash anchors, the editor preview), so they always agree.
 * @param {unknown} facing a level waterfall's `facing`
 * @returns {readonly [number, number]} a shared array (read it, never modify it)
 */
export function waterfallDir(facing) {
  return ownValue(FALL_DIRS, facing) ?? FALL_DIRS.S;
}

/**
 * Animated pixel waterfall: a curved sheet falling from `top` to `bottom` over a cliff edge,
 * with a churning foam pool where it lands.
 *
 * @param {{ x:number, z:number, width?:number, top:number, bottom:number,
 *           facing?:string, seed?:number, pool?:boolean, lip?:number }} opts
 *   (x, z) = centre of the fall on the cliff edge line; `facing` = direction the water falls
 *   toward: 'N' | 'S' | 'E' | 'W' ('S'; any other value falls toward +Z like 'S':
 *   `waterfallDir`); top / bottom = upper / lower water surface Y; width (2). `lip` (0.3): how
 *   far the sheet reaches back over the upper water surface.
 * @returns {{ object: THREE.Group, update: (dt:number) => void, dispose: () => void,
 *             emitters: {preset:string, position:THREE.Vector3, spawnSize:number[], velocity:number[],
 *             velocityVariance:number[], width:number, bounds?: never}[],
 *             sheet: THREE.Mesh, pool: THREE.Mesh|null }}
 *   `emitters` (one 'mist' emitter) can be passed straight to Particles.createEmitter (overrides
 *   oriented to `facing`; `width` is the fall's width, which the preset does not read). It
 *   carries no `bounds`: a bounds box would turn the point emitter into an area emitter.
 */
// @ts-expect-error the `{}` default lacks the required x / z / top / bottom (bare call: NaN geometry)
export function createWaterfall({ x, z, width = 2, top, bottom, facing = 'S', seed, pool = true, lip = 0.3 } = {}) {
  const f = waterfallDir(facing);
  const fx = f[0];
  const fz = f[1];
  const rx = fz; // "right" as seen by a viewer looking at the fall
  const rz = -fx;
  const H = Math.max(0.05, top - bottom);
  const sd = seed ?? (hash2(Math.round(x * 16), Math.round(z * 16), 77) * 1000 + ++_fallCount);

  // Profile (outward offset, y) from behind the lip down to the pool: x ∝ sqrt(drop).
  const prof = [];
  prof.push([-lip, top + 0.012]);
  prof.push([-lip * 0.35, top + 0.012]);
  prof.push([0.0, top + 0.004]);
  const rows = 14;
  for (let k = 1; k <= rows; k++) {
    const u = k / rows;
    const drop = H * u * u;
    prof.push([0.04 + 0.26 * Math.sqrt(drop) + 0.05 * u, top - drop]);
  }
  const arc = [0];
  for (let k = 1; k < prof.length; k++) arc.push(arc[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
  const length = arc[arc.length - 1];
  const lipLen = arc[2];

  const cols = Math.max(2, Math.ceil(width * 4));
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const lat = (u - 0.5) * width;
    for (let k = 0; k < prof.length; k++) {
      const [o, y] = prof[k];
      pos.push(x + rx * lat + fx * o, y, z + rz * lat + fz * o);
      uvs.push(u, arc[k]);
    }
  }
  const nr = prof.length;
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < nr - 1; k++) {
      const a = c * nr + k;
      const b = (c + 1) * nr + k;
      // front face toward `facing`: (a, a+1, b+1), (a, b+1, b)
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // Lit like the terrain (lights + shadows); engine uniforms are shared by reference.
  const litUniforms = (extra) => {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, extra]);
    u.uTime = globalUniforms.uTime;
    u.uNight = globalUniforms.uNight;
    u.uSunColor = globalUniforms.uSunColor;
    u.uFogColor = globalUniforms.uFogColor;
    u.uFogStart = globalUniforms.uFogStart;
    return u;
  };
  const sheetMat = new THREE.ShaderMaterial({
    name: 'Luminati:Waterfall',
    uniforms: litUniforms({
      uWidth: { value: width },
      uLength: { value: length },
      uLipLength: { value: lipLen },
      uSeed: { value: sd % 97 },
      uC0: { value: WATER_LINEAR[4].clone() }, // teal body
      uC1: { value: WATER_LINEAR[3].clone() }, // deeper teal body
      uC2: { value: WATER_LINEAR[2].clone() }, // dark streaks
      uC3: { value: WATER_LINEAR[5].clone() }, // light streaks
      uFoam: { value: WATER_LINEAR[6].clone().multiplyScalar(1.08) },
    }),
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    fog: true,
    lights: true,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const sheet = new THREE.Mesh(geo, sheetMat);
  sheet.name = 'WaterfallSheet';
  sheet.renderOrder = RENDER_ORDER.WATER + 1;
  sheet.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'Waterfall';
  group.add(sheet);

  let poolMesh = null;
  let poolGeo = null;
  let poolMat = null;
  const footOut = prof[prof.length - 1][0];
  if (pool) {
    const pw = width + 1.1;
    const pd = 1.25;
    poolGeo = new THREE.PlaneGeometry(pw, pd);
    // PlaneGeometry lies in XY; rotate to XZ with uv.y = 0 at the impact line (the fall's foot).
    poolGeo.rotateX(-Math.PI / 2);
    // after rotation: +v runs toward -Z. Map local axes: across = right, v → facing.
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(rx, 0, rz),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-fx, 0, -fz),
    );
    poolGeo.applyMatrix4(m);
    poolGeo.translate(x + fx * (footOut - 0.2 + pd / 2), bottom + 0.012, z + fz * (footOut - 0.2 + pd / 2));
    poolMat = new THREE.ShaderMaterial({
      name: 'Luminati:WaterfallPool',
      uniforms: litUniforms({
        uFoam: { value: WATER_LINEAR[6].clone().multiplyScalar(1.05) },
        uC0: { value: WATER_LINEAR[5].clone() },
        uSize: { value: new THREE.Vector2(pw, pd) },
        uSeed: { value: sd % 53 },
      }),
      vertexShader: FALL_VERT,
      fragmentShader: POOL_FRAG,
      fog: true,
      lights: true,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide, // the basis above mirrors the plane
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    poolMesh = new THREE.Mesh(poolGeo, poolMat);
    poolMesh.name = 'WaterfallPool';
    poolMesh.renderOrder = RENDER_ORDER.WATER + 2;
    poolMesh.receiveShadow = true;
    group.add(poolMesh);
  }

  // Mist spec for Particles.createEmitter: spawn box / drift oriented along the fall's facing
  // (the preset's defaults assume a fall facing +Z).
  const alongX = fx !== 0;
  const emitters = [
    {
      preset: 'mist',
      position: new THREE.Vector3(x + fx * (footOut + 0.3), bottom + 0.25, z + fz * (footOut + 0.3)),
      spawnSize: alongX ? [0.4, 0.3, width] : [width, 0.3, 0.4],
      velocity: [fx * 0.45, 0.35, fz * 0.45],
      velocityVariance: alongX ? [0.35, 0.3, 0.45] : [0.45, 0.3, 0.35],
      width,
    },
  ];

  return {
    object: group,
    sheet,
    pool: poolMesh,
    emitters,
    /** Animation runs on globalUniforms.uTime; kept for API symmetry. */
    update(dt) { }, // eslint-disable-line no-unused-vars
    dispose() {
      geo.dispose();
      sheetMat.dispose();
      poolGeo?.dispose();
      poolMat?.dispose();
      group.removeFromParent();
    },
  };
}
