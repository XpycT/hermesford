import * as THREE from 'three';

/**
 * Sky — gradient sky dome for the 2.5D diorama.
 *
 * A large BackSide sphere that follows the rendering camera (so it never clips) and draws:
 *  - a top / horizon / bottom gradient (the lower hemisphere is a soft haze so a floating
 *    diorama sits in atmosphere; the horizon colour equals the fog colour),
 *  - an HDR sun glow (halo + low-sun horizon band) and a pixel-crisp sun disc,
 *  - a pixel-crisp gibbous moon with a halo at night,
 *  - pixel-crisp twinkling stars at night (1-px stars + rarer plus-shaped bright stars),
 *  - an aurora (curtains on the cloud pixel grid, mostly in the north) behind `uAurora` (0: none,
 *    the branch skipped — the game's season writes it for a level with an aurora;
 *    docs/design/SEASONS_LOOK.md §8),
 *  - soft drifting pixel clouds tinted by the sun colour (upper hemisphere) and a slow
 *    "sea of clouds" haze below the horizon.
 * Cloud "pixels" are quantised in direction space, so they have a constant on-screen size.
 * The dome is pinned to the far plane, never writes depth and (by default, `earlyZ`) is drawn after
 * the opaque geometry with a depth test, so hidden sky pixels cost nothing.
 *
 * All colours are linear (THREE.Color working space). Output is HDR; tone mapping happens
 * in the output pass (or via the tonemapping chunk when rendering straight to the canvas).
 */

const vertexShader = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Pin the dome to (just inside) the far plane whatever the camera far plane is: it never clips and,
  // with the depth test on, it only fills pixels no opaque geometry has covered.
  #ifdef USE_REVERSED_DEPTH_BUFFER
    gl_Position.z = gl_Position.w * 1e-5;
  #else
    gl_Position.z = gl_Position.w * 0.99999;
  #endif
}
`;

// (`aurora(q)`: curtains, mostly in the north, on the cloud pixel grid — a wavering foot low over the
// horizon (the play camera can only look down), rays drifting along it, green at the foot to violet
// aloft, a rose fringe, banded in six levels; drawn only while `uAurora` > 0. Its comments stay
// out here: the shader's text is in the game chunk every level downloads.)
const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uGlow;
uniform float uClouds;
uniform float uLowerClouds;
uniform float uTime;
uniform float uStarDensity;
uniform float uSunSize;
uniform float uMoonSize;
uniform float uSunIntensity;
uniform float uCloudPixel;
uniform vec2 uWind;
uniform float uAurora;

varying vec3 vDir;

#define TAU 6.28318530718

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.13, 3.71);
    a *= 0.5;
  }
  return s / 0.9375;
}

vec3 skyGradient(float y) {
  if (y >= 0.0) {
    float t = smoothstep(0.0, 1.0, pow(clamp(y, 0.0, 1.0), 0.5));
    return mix(uHorizon, uTop, t);
  }
  // Below the horizon: a thick band of horizon haze that slowly sinks into the bottom colour.
  float t = clamp(-y / 0.9, 0.0, 1.0);
  return mix(uHorizon, uBottom, smoothstep(0.0, 1.0, pow(t, 0.8)));
}

// Tangent-plane coordinates of direction d around centre c, in units of radius r.
vec2 discCoord(vec3 d, vec3 c, float r) {
  vec3 t1 = cross(c, vec3(0.0, 1.0, 0.0));
  t1 = length(t1) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(t1);
  vec3 t2 = cross(t1, c);
  return vec2(dot(d, t1), dot(d, t2)) / r;
}

// Snap a direction to a lat/long pixel grid with ~square cells (P cells per radian).
vec3 quantDir(float lat, float lon, float P) {
  float latQ = (floor(lat * P) + 0.5) / P;
  float cl = max(cos(latQ), 0.05);
  float lonQ = (floor(lon * P * cl) + 0.5) / (P * cl);
  float c = cos(latQ);
  return vec3(c * cos(lonQ), sin(latQ), c * sin(lonQ));
}

// Stars on a latitude/longitude grid with ~square cells (cells per row follow cos(latitude)).
vec3 stars(float lat, float lon) {
  float N = uStarDensity;
  // Fine 1-px stars
  float row = floor(lat * N);
  float rowLat = (row + 0.5) / N;
  float cells = max(1.0, floor(TAU * N * cos(rowLat)));
  vec2 cell = vec2(floor((lon / TAU + 0.5) * cells), row);
  float h = hash12(cell);
  float star = step(0.9962, h);
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + 3.5 * fract(h * 37.0)) + h * 91.0);
  // Mostly faint stars with a few bright ones (a uniform spread made every star bloom).
  float mag = fract(h * 113.0);
  float b = star * tw * (0.3 + 1.6 * mag * mag * mag);
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), step(0.6, fract(h * 7.0)));
  vec3 col = tint * b;

  // Coarse cells with a plus-shaped bright star (5x5 px pattern)
  float N2 = N / 5.0;
  float row2 = floor(lat * N2);
  float rowLat2 = (row2 + 0.5) / N2;
  float cells2 = max(1.0, floor(TAU * N2 * cos(rowLat2)));
  float u2 = (lon / TAU + 0.5) * cells2;
  float v2 = lat * N2;
  float h2 = hash12(vec2(floor(u2), row2) + 71.3);
  vec2 f = floor(vec2(fract(u2), fract(v2)) * 5.0);
  float m = abs(f.x - 2.0) + abs(f.y - 2.0);
  float centre = step(m, 0.5);
  float arm = step(m, 1.5) - centre;
  float tw2 = 0.6 + 0.4 * sin(uTime * (0.7 + 1.8 * h2) + h2 * 50.0);
  float big = step(0.991, h2) * (centre * 2.2 + arm * 0.6) * tw2;
  vec3 tint2 = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.92, 0.78), step(0.5, fract(h2 * 13.0)));
  col += tint2 * big;
  return col;
}

vec3 aurora(vec3 q) {
  float u = atan(q.x, -q.z);
  float t = uTime * 0.03;
  float h = (q.y - 0.07 - 0.04 * sin(u * 1.7 + t * 2.0) - 0.025 * sin(u * 4.3 - t * 3.1)) / 0.45;
  if (h < 0.0 || h > 1.0) return vec3(0.0);
  float ray = vnoise(vec2(u * 70.0 + t * 9.0, t * 0.7));
  ray = ray * ray * 1.5 + 0.3 * vnoise(vec2(u * 17.0 - t * 4.0, 2.0));
  float a = smoothstep(0.0, 0.04, h) * exp(-h * 3.0) * ray * (0.35 + 0.65 * smoothstep(-0.4, 0.8, sin(u * 2.3 + t * 1.2)))
    * smoothstep(-0.6, 0.3, cos(u));
  vec3 c = mix(vec3(0.25, 1.0, 0.63), vec3(0.05, 0.75, 0.39), smoothstep(0.0, 0.15, h));
  c = mix(mix(c, vec3(0.2, 0.11, 1.0), smoothstep(0.25, 0.6, h)), vec3(0.58, 0.14, 1.0), smoothstep(0.75, 0.95, h));
  return c * floor(clamp(a, 0.0, 1.0) * 6.0 + 0.5) / 6.0;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = skyGradient(y);

  vec3 sunDir = normalize(uSunDir);
  vec3 moonDir = normalize(uMoonDir);
  float lat = asin(clamp(y, -1.0, 1.0));
  float lon = atan(d.z, d.x);

  // ---------------------------------------------------------------- sun glow
  float cs = dot(d, sunDir);
  float cs0 = max(cs, 0.0);
  float sunUp = smoothstep(-0.3, 0.02, sunDir.y);
  float halo = pow(cs0, 8.0) * 0.1 + pow(cs0, 42.0) * 0.28 + pow(cs0, 600.0) * 1.1;
  vec2 dh = d.xz / max(length(d.xz), 1e-4);
  vec2 shz = sunDir.xz / max(length(sunDir.xz), 1e-4);
  float az = dot(dh, shz) * 0.5 + 0.5;
  float lowSun = 1.0 - smoothstep(0.02, 0.6, sunDir.y);
  float band = exp(-abs(y) * 8.0) * pow(az, 3.0) * lowSun;
  vec3 glowCol = uSunColor * uGlow;
  col += glowCol * (halo + band * 0.32) * sunUp;

  // Cloud pixel grid (constant on-screen size), shared by both cloud layers.
  vec3 qd = quantDir(lat, lon, uCloudPixel);

  if (y > 0.0) {
    // ------------------------------------------------------------- stars
    float starMask = uNight * uNight * smoothstep(0.03, 0.35, y);
    if (starMask > 0.002) col += stars(lat, lon) * starMask;
    if (uAurora > 0.001) col += aurora(qd) * uAurora;

    // -------------------------------------- moon (pixel disc, gibbous, halo)
    float cm = dot(d, moonDir);
    float moonVis = smoothstep(0.25, 0.8, uNight) * smoothstep(-0.02, 0.08, moonDir.y);
    if (moonVis > 0.001 && cm > 0.0) {
      vec2 mp = discCoord(d, moonDir, uMoonSize);
      vec2 mcell = floor(mp * 7.0);
      vec2 mq = (mcell + 0.5) / 7.0;
      float inside = step(length(mq), 1.0);
      float mottle = hash12(mcell + 13.0);
      float crater = step(0.78, mottle) * 0.22 + step(0.93, mottle) * 0.12;
      float phase = smoothstep(0.35, 0.95, length(mq - vec2(-0.55, 0.25)));
      // Kept below the bloom-saturation point so the pixel craters and the gibbous phase read.
      vec3 moonCol = vec3(0.84, 0.9, 1.0) * (0.95 - crater * 1.3) * mix(0.22, 1.0, phase);
      col = mix(col, moonCol, inside * moonVis);
      float cm0 = max(cm, 0.0);
      col += vec3(0.45, 0.58, 1.0) * (pow(cm0, 2500.0) * 0.3 + pow(cm0, 200.0) * 0.08 + pow(cm0, 12.0) * 0.025) * moonVis;
    }

    // ------------------------------------ sun disc (pixel-crisp, HDR bloom)
    if (cs > 0.0) {
      vec2 sp = discCoord(d, sunDir, uSunSize);
      vec2 sq = (floor(sp * 6.0) + 0.5) / 6.0;
      float r = length(sq);
      float sIn = step(r, 1.0);
      float rim = step(0.8, r);
      col += uSunColor * sIn * mix(1.0, 0.55, rim) * uSunIntensity * sunUp * smoothstep(-0.005, 0.01, y);
    }

    // --------------------------- clouds (plane overhead, lit from the sun side)
    if (uClouds > 0.001) {
      vec2 cp = qd.xz / (max(qd.y, 0.0) + 0.15) * 2.4 + uWind * uTime;
      float n = fbm4(cp * 1.2);
      float c = smoothstep(1.0 - uClouds - 0.08, 1.0 - uClouds + 0.2, n);
      float n2 = fbm4((cp + shz * 0.16) * 1.2);
      float lit = clamp(0.55 + (n - n2) * 5.0, 0.0, 1.0);
      c = floor(c * 3.0 + 0.5) / 3.0;
      lit = floor(lit * 3.0 + 0.5) / 3.0;
      float moonLit = pow(max(dot(d, moonDir), 0.0), 6.0) * smoothstep(0.3, 0.9, uNight);
      vec3 shade = mix(mix(uTop, uHorizon, 0.5) * 0.95, uTop * 0.8, uNight);
      vec3 litCol = mix(uHorizon * 1.12, mix(uTop, uHorizon, 0.55) + vec3(0.05, 0.07, 0.12) * moonLit, uNight)
                  + glowCol * (0.12 + pow(cs0, 4.0) * 0.8) * sunUp;
      vec3 cloudCol = mix(shade, litCol, lit);
      float fade = smoothstep(0.0, 0.22, y);
      col = mix(col, cloudCol, c * fade * mix(0.9, 0.55, uNight));
    }
  } else if (uLowerClouds > 0.001) {
    // ------------------------------------------------------ sea of clouds below
    vec2 lp = qd.xz / (max(-qd.y, 0.0) + 0.07) * 0.6 + uWind * uTime * 0.6 + vec2(37.0, 11.0);
    float n = fbm4(lp);
    float c = smoothstep(0.42, 0.74, n);
    float n2 = fbm4(lp + shz * 0.12);
    float lit = clamp(0.5 + (n - n2) * 5.0, 0.0, 1.0);
    lit = floor(lit * 3.0 + 0.5) / 3.0;
    c = floor(c * 3.0 + 0.5) / 3.0;
    vec3 topCol = uHorizon * 1.08 + glowCol * (0.06 + band * 0.25) * sunUp;
    vec3 shadeCol = mix(uBottom, uHorizon, 0.5);
    vec3 cc = mix(shadeCol, topCol, 0.3 + lit * 0.7);
    float distFade = smoothstep(0.0, 0.16, -y);
    col = mix(col, cc, c * uLowerClouds * distFade);
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _camPos = new THREE.Vector3();

export class Sky {
  /**
   * @param {{ radius?: number, cloudCover?: number, lowerClouds?: number, starDensity?: number,
   *           sunSize?: number, moonSize?: number, sunIntensity?: number, cloudPixel?: number,
   *           wind?: [number, number], earlyZ?: boolean }} [opts]
   *   - radius (180): dome radius (the dome follows the camera and never clips)
   *   - cloudCover (0.45): initial coverage (LightingSystem drives it from keyframes)
   *   - lowerClouds (0.5): strength of the "sea of clouds" haze below the horizon
   *   - starDensity (1100): star grid cells per radian (≈ one star pixel at the default camera)
   *   - sunSize (0.032) / moonSize (0.026): disc radii in radians
   *   - sunIntensity (9): HDR multiplier of the sun disc (bloom)
   *   - cloudPixel (380): cloud pixels per radian (≈ 5 screen px at the default camera)
   *   - wind ([0.012, 0.004]): cloud drift per second on the cloud plane
   *   - earlyZ (true): draw the dome LAST among opaque objects with a depth test against the far
   *     plane, so the GPU skips every sky pixel hidden behind the diorama (at the default diorama
   *     camera that is nearly all of them; drawn first without a depth test the full-screen sky
   *     shader measured ~0.6 ms per frame at 1600×900 on a GTX 1060, ~0.01 ms this way). Visually
   *     identical: the dome sits at the far plane and never writes depth. Caveats: the scene must be
   *     rendered into a target WITH a depth buffer (the canvas and PostFX's scene target are), and an
   *     OPAQUE material that neither writes depth nor is transparent would be painted over — use
   *     `transparent: true` for such effects. false = legacy behaviour (renderOrder -1000, drawn
   *     first, no depth test).
   */
  constructor({ radius = 180, cloudCover = 0.45, lowerClouds = 0.5, starDensity = 1100, sunSize = 0.032,
    moonSize = 0.026, sunIntensity = 9, cloudPixel = 380, wind = [0.012, 0.004], earlyZ = true } = {}) {
    this.radius = radius;
    this.uniforms = {
      uTop: { value: new THREE.Color(0x3a7ee0) },
      uHorizon: { value: new THREE.Color(0xc4e0f2) },
      uBottom: { value: new THREE.Color(0x8fb4d0) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, -0.5).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.6, -0.5).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
      uNight: { value: 0 },
      uGlow: { value: 1 },
      uClouds: { value: cloudCover },
      uLowerClouds: { value: lowerClouds },
      uTime: { value: 0 },
      uStarDensity: { value: starDensity },
      uSunSize: { value: sunSize },
      uMoonSize: { value: moonSize },
      uSunIntensity: { value: sunIntensity },
      uCloudPixel: { value: cloudPixel },
      uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
      // the aurora's strength (0: none — the sky as without it; a level's `environment.aurora` at
      // night, written every frame by the game's season: src/game/season/)
      uAurora: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      name: 'SkyMaterial',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      // earlyZ: fragments sit at the far plane (see vertex shader) and pass only where nothing
      // opaque was drawn (LessEqual against the cleared depth of 1.0).
      depthTest: earlyZ,
      fog: false,
      toneMapped: true,
    });

    this.geometry = new THREE.SphereGeometry(radius, 48, 24);
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.name = 'Sky';
    // Opaque objects always render before transparent ones in three.js, so a huge renderOrder puts
    // the dome after all opaque geometry but still before every transparent effect.
    mesh.renderOrder = earlyZ ? Sky.EARLY_Z_RENDER_ORDER : -1000;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    // Follow whichever camera renders the sky (world-space translation only).
    mesh.onBeforeRender = (renderer, scene, camera) => {
      _camPos.setFromMatrixPosition(camera.matrixWorld);
      mesh.position.copy(_camPos);
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
    };
    /** @type {THREE.Mesh} */
    this.object = mesh;
  }

  /**
   * Update the sky look. All fields optional; colours are THREE.Color (linear), directions are
   * normalised Vector3 pointing toward the body.
   * @param {{ top?: THREE.Color, horizon?: THREE.Color, bottom?: THREE.Color, sunDirection?: THREE.Vector3,
   *           sunColor?: THREE.Color, night?: number, moonDirection?: THREE.Vector3, glow?: number,
   *           clouds?: number }} state
   */
  setState({ top, horizon, bottom, sunDirection, sunColor, night, moonDirection, glow, clouds } = {}) {
    const u = this.uniforms;
    if (top) u.uTop.value.copy(top);
    if (horizon) u.uHorizon.value.copy(horizon);
    if (bottom) u.uBottom.value.copy(bottom);
    if (sunDirection) u.uSunDir.value.copy(sunDirection);
    if (sunColor) u.uSunColor.value.copy(sunColor);
    if (night !== undefined) u.uNight.value = night;
    if (moonDirection) u.uMoonDir.value.copy(moonDirection);
    if (glow !== undefined) u.uGlow.value = glow;
    if (clouds !== undefined) u.uClouds.value = clouds;
  }

  /** Cloud coverage 0..1 (also driven by LightingSystem keyframes). */
  get cloudCover() { return this.uniforms.uClouds.value; }
  set cloudCover(v) { this.uniforms.uClouds.value = v; }

  /** Strength of the cloud-sea haze below the horizon, 0..1. */
  get lowerClouds() { return this.uniforms.uLowerClouds.value; }
  set lowerClouds(v) { this.uniforms.uLowerClouds.value = v; }

  /** Advance cloud drift / star twinkle. @param {number} dt seconds */
  update(dt) {
    this.uniforms.uTime.value += dt;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** renderOrder used with `earlyZ` (after every opaque object; transparents still draw later). */
Sky.EARLY_Z_RENDER_ORDER = 1e6;
