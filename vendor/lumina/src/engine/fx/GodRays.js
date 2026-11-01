import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { RNG } from '../utils/math.js';
import { RENDER_ORDER } from '../constants.js';

/**
 * GodRays — soft, additive, slowly animated light shafts (the diagonal beams of light that
 * fall through the forests and town squares of Square Enix's HD-2D games).
 *
 * Each shaft is ONE quad that is billboarded around its own axis (it always turns its broad side
 * to the camera, so it never collapses into a visible hard plane). The shader gives it:
 *  - a soft gaussian-like falloff across its width and a slight taper,
 *  - a fade-in from the top and a fade-out toward the ground (by world height),
 *  - slowly scrolling noise streaks (parallel to the beam),
 *  - fades when the camera is close, when looking straight down the axis, with fog, at night
 *    (`uNight`) and when the sun is high (strongest at golden hour and in the morning),
 *  - colour from `globalUniforms.uSunColor` (warm at golden hour).
 * Shafts without an explicit `direction` follow the live `uSunDirection` (azimuth exact, elevation
 * steepened by `steepness` so beams stay readable when the sun is very low).
 */

const vertexShader = /* glsl */ `
uniform vec3 uSunDirection;
uniform float uSteepness;
uniform float uUseSun;
uniform vec3 uAxis;
uniform float uLength;
uniform float uWidth;
uniform float uTopWidth;

varying vec2 vUv;
varying vec3 vWorld;
varying float vAxisView;

#include <fog_pars_vertex>

void main() {
  vec3 toLight;
  if (uUseSun > 0.5) {
    vec3 s = normalize(uSunDirection);
    float hl = length(s.xz);
    vec2 hd = hl > 1e-4 ? s.xz / hl : vec2(0.0, 1.0);
    float el = asin(clamp(s.y, -1.0, 1.0));
    el = max(el, 0.12);
    el = mix(el, 1.5707963, uSteepness);
    toLight = vec3(hd.x * cos(el), sin(el), hd.y * cos(el));
  } else {
    toLight = -normalize(uAxis);
  }

  vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float u = position.x;           // -0.5 .. 0.5 across
  float v = position.y;           // 0 (ground) .. 1 (top)
  vec3 c = base + toLight * (v * uLength);
  vec3 view = normalize(cameraPosition - c);
  vec3 side = cross(toLight, view);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = uWidth * mix(1.0, uTopWidth, v);
  vec3 wp = c + side * (u * w);

  vUv = vec2(u * 2.0, v);
  vWorld = wp;
  vAxisView = abs(dot(view, toLight));

  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uColor;
uniform float uNight;
uniform float uTime;
uniform float uIntensity;
uniform float uGlobalIntensity;
uniform float uNightStrength;
uniform float uSeed;
uniform float uGroundY;
uniform float uFadeHeight;
uniform float uLength;
uniform vec2 uNearFade;
uniform vec2 uHorizonFade;
uniform float uGain;

varying vec2 vUv;
varying vec3 vWorld;
varying float vAxisView;

#include <fog_pars_fragment>

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float x = vUv.x;                       // -1 .. 1 across
  float v = vUv.y;                       // 0 bottom .. 1 top
  float across = exp(-x * x * 3.2) - 0.04;
  across = max(across, 0.0) / 0.96;

  float topFade = 1.0 - smoothstep(0.5, 1.0, v);
  float groundFade = smoothstep(uGroundY - 0.2, uGroundY + uFadeHeight, vWorld.y);
  float mid = mix(0.75, 1.0, smoothstep(0.1, 0.55, v));

  // Streaks parallel to the beam, drifting slowly.
  float along = v * uLength;
  float s1 = vnoise(vec2(x * 2.6 + uSeed * 7.1 + uTime * 0.05, along * 0.09 - uTime * 0.12));
  float s2 = vnoise(vec2(x * 6.3 - uSeed * 3.7 - uTime * 0.08, along * 0.16 - uTime * 0.21));
  float streak = 0.3 + 0.7 * smoothstep(0.15, 0.85, s1 * 0.62 + s2 * 0.38);
  // Slow breathing so the scene feels alive.
  float breathe = 0.82 + 0.18 * sin(uTime * 0.35 + uSeed * 6.2831);

  float axisFade = 1.0 - smoothstep(0.82, 0.98, vAxisView);
  float camDist = distance(cameraPosition, vWorld);
  float nearFade = smoothstep(uNearFade.x, uNearFade.y, camDist);

  float sunY = normalize(uSunDirection).y;
  // Strongest with a low sun (golden hour / morning), weaker at noon, gone as the sun sets.
  float lowSun = mix(0.4, 1.0, 1.0 - smoothstep(0.3, 0.8, sunY)) * smoothstep(uHorizonFade.x, uHorizonFade.y, sunY);
  float dayMix = mix(uNightStrength, 1.0, 1.0 - uNight);

  float a = across * topFade * groundFade * mid * streak * breathe * axisFade * nearFade
          * lowSun * dayMix * uIntensity * uGlobalIntensity;

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    a *= 1.0 - fogF;
  #endif

  // Slightly desaturated sun colour: beams read as pale warm light, not orange paint.
  vec3 sunCol = mix(vec3(dot(uSunColor, vec3(0.3, 0.59, 0.11))), uSunColor, 0.72);
  vec3 col = sunCol * uColor * (a * uGain);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

let _sharedGeometry = null;
let _geometryUsers = 0;

function acquireGeometry() {
  if (!_sharedGeometry) {
    // Unit quad: x in [-0.5, 0.5] across, y in [0, 1] along the shaft. A few rows so the
    // world-height ground fade and fog are well sampled.
    _sharedGeometry = new THREE.PlaneGeometry(1, 1, 1, 6);
    _sharedGeometry.translate(0, 0.5, 0);
    _sharedGeometry.name = 'GodRayShaft';
  }
  _geometryUsers++;
  return _sharedGeometry;
}

function releaseGeometry() {
  _geometryUsers--;
  if (_geometryUsers <= 0 && _sharedGeometry) {
    _sharedGeometry.dispose();
    _sharedGeometry = null;
    _geometryUsers = 0;
  }
}

export class GodRays {
  /**
   * @param {{ steepness?: number, color?: THREE.ColorRepresentation, nightStrength?: number,
   *           nearFade?: [number, number], fadeHeight?: number, gain?: number,
   *           horizonFade?: [number, number] }} [opts]
   *   - steepness (0.45): 0 = beams follow the true sun elevation, 1 = vertical
   *   - color (#fff1d8): tint multiplied with uSunColor
   *   - nightStrength (0): fraction kept at full night (moonbeams)
   *   - nearFade ([5, 13]): camera distance range over which shafts fade in
   *   - fadeHeight (2.2): height above the shaft base over which it fades out toward the ground
   *   - gain (0.28): overall brightness scale
   *   - horizonFade ([0.19, 0.27]): sin(light elevation) range over which beams fade out as the sun
   *     sets (LightingSystem soft-clamps the light at ~10°, so sunset/sunrise land at the low end)
   */
  constructor({ steepness = 0.45, color = 0xfff1d8, nightStrength = 0, nearFade = [5, 13], fadeHeight = 2.2, gain = 0.28,
    horizonFade = [0.19, 0.27] } = {}) {
    /** @type {THREE.Group} */
    this.object = new THREE.Group();
    this.object.name = 'GodRays';
    this.shafts = [];
    this.fadeHeight = fadeHeight;

    // Uniforms shared by every shaft material (single write updates all).
    this._shared = {
      uTime: { value: 0 },
      uGlobalIntensity: { value: 1 },
      uSteepness: { value: steepness },
      uNightStrength: { value: nightStrength },
      uNearFade: { value: new THREE.Vector2(nearFade[0], nearFade[1]) },
      uGain: { value: gain },
      uHorizonFade: { value: new THREE.Vector2(horizonFade[0], horizonFade[1]) },
      uTint: new THREE.Color(color),
      fog: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
  }

  /** Global multiplier (also auto-fades with uNight and high sun). */
  get intensity() { return this._shared.uGlobalIntensity.value; }
  set intensity(v) { this._shared.uGlobalIntensity.value = v; }

  /** 0 = true sun elevation, 1 = vertical beams. */
  get steepness() { return this._shared.uSteepness.value; }
  set steepness(v) { this._shared.uSteepness.value = v; }

  /**
   * Add one light shaft.
   * @param {{ position?: THREE.Vector3|{x:number,y:number,z:number}, direction?: THREE.Vector3,
   *           length?: number, width?: number, intensity?: number, color?: THREE.ColorRepresentation,
   *           topWidth?: number, seed?: number }} [opts]
   *   - position: where the shaft meets the ground (its bottom end; the origin when omitted)
   *   - direction: travel direction of the light (from sky to ground); omitted = follow the sun live
   *   - topWidth (0.7): width multiplier at the top end
   * @returns {{ mesh: THREE.Mesh, intensity: number, dispose: () => void }}
   */
  addShaft({ position, direction, length = 14, width = 3, intensity = 1, color, topWidth = 0.7, seed } = {}) {
    const sh = this._shared;
    const uniforms = {
      uSunDirection: globalUniforms.uSunDirection,
      uSunColor: globalUniforms.uSunColor,
      uNight: globalUniforms.uNight,
      uTime: sh.uTime,
      uGlobalIntensity: sh.uGlobalIntensity,
      uSteepness: sh.uSteepness,
      uNightStrength: sh.uNightStrength,
      uNearFade: sh.uNearFade,
      uGain: sh.uGain,
      uHorizonFade: sh.uHorizonFade,
      fogColor: sh.fog.fogColor,
      fogDensity: sh.fog.fogDensity,
      fogNear: sh.fog.fogNear,
      fogFar: sh.fog.fogFar,
      uFogStart: globalUniforms.uFogStart,
      uUseSun: { value: direction ? 0 : 1 },
      uAxis: { value: direction ? new THREE.Vector3().copy(direction).normalize() : new THREE.Vector3(0, -1, 0) },
      uLength: { value: length },
      uWidth: { value: width },
      uTopWidth: { value: topWidth },
      uIntensity: { value: intensity },
      uColor: { value: color !== undefined ? new THREE.Color(color) : sh.uTint.clone() },
      uSeed: { value: seed ?? this.shafts.length * 0.618 + 0.13 },
      uGroundY: { value: position ? position.y : 0 },
      uFadeHeight: { value: this.fadeHeight },
    };
    const material = new THREE.ShaderMaterial({
      name: 'GodRayMaterial',
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    material.forceSinglePass = true;
    // Screen blend (src + dst·(1 - src)), used only when drawing straight to the display-referred
    // canvas (PostFX disabled): there the additive term is tone-mapped and sRGB-encoded on its own,
    // and plain addition would make shafts 3–10× too bright over mid-tones and the sky.
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcColorFactor;
    const mesh = new THREE.Mesh(acquireGeometry(), material);
    mesh.name = 'GodRayShaft';
    // The quad is placed in the vertex shader (along the live sun direction), so the geometry's
    // bounds mean nothing: cull by a sphere round the shaft's base that holds it for any direction
    // (radius = length + half the width). A shaft out of view then costs no draw call — a big
    // level with many god-ray areas no longer draws every shaft everywhere.
    const cullSphere = new THREE.Sphere();
    mesh.frustumCulled = true;
    mesh.intersectsFrustum = function intersectsFrustumByShaft(frustum) {
      cullSphere.center.setFromMatrixPosition(this.matrixWorld); // (the renderer updated it)
      cullSphere.radius = uniforms.uLength.value + uniforms.uWidth.value * 0.5 + 0.1;
      return typeof frustum.intersectsSphere === 'function' ? frustum.intersectsSphere(cullSphere) : true;
    };
    mesh.renderOrder = RENDER_ORDER.GODRAYS;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Linear HDR target (PostFX) → true additive light; canvas → screen blend (see above).
    // Blending is not part of the program key, so switching it never recompiles.
    mesh.onBeforeRender = (renderer) => {
      material.blending = renderer.getRenderTarget() === null ? THREE.CustomBlending : THREE.AdditiveBlending;
    };
    if (position) mesh.position.set(position.x, position.y, position.z);
    this.object.add(mesh);

    const shafts = this.shafts;
    let disposed = false;
    const handle = {
      mesh,
      get intensity() { return uniforms.uIntensity.value; },
      set intensity(v) { uniforms.uIntensity.value = v; },
      dispose() {
        if (disposed) return;
        disposed = true;
        const i = shafts.indexOf(handle);
        if (i >= 0) shafts.splice(i, 1);
        mesh.removeFromParent();
        material.dispose();
        releaseGeometry();
      },
    };
    shafts.push(handle);
    return handle;
  }

  /**
   * Scatter shafts deterministically over an area (jittered grid, so they never clump).
   * @param {{minX:number, maxX:number, minZ:number, maxZ:number, y?:number}} bounds
   * @param {number} count
   * @param {number} [seed=7]
   * @returns {Array<{ mesh: THREE.Mesh, intensity: number, dispose: () => void }>}
   */
  populate(bounds, count, seed = 7) {
    const rng = new RNG(seed);
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    const cols = Math.max(1, Math.round(Math.sqrt((count * w) / Math.max(d, 1e-3))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
    rng.shuffle(cells);
    const out = [];
    for (let i = 0; i < count; i++) {
      const [c, r] = cells[i % cells.length];
      const x = bounds.minX + ((c + rng.range(0.15, 0.85)) / cols) * w;
      const z = bounds.minZ + ((r + rng.range(0.15, 0.85)) / rows) * d;
      out.push(this.addShaft({
        position: new THREE.Vector3(x, bounds.y ?? 0, z),
        length: rng.range(11, 17),
        width: rng.range(1.4, 3.4),
        intensity: rng.range(0.55, 1.0),
        topWidth: rng.range(0.55, 0.85),
        seed: rng.range(0, 10),
      }));
    }
    return out;
  }

  /** @param {number} dt seconds */
  update(dt) {
    this._shared.uTime.value += dt;
  }

  dispose() {
    for (const s of [...this.shafts]) s.dispose();
    this.object.removeFromParent();
  }
}
