import * as THREE from 'three';
import { FULLSCREEN_VERTEX, POST_COMMON_GLSL } from './PostCommon.js';

/**
 * Depth-of-field shaders for the 2.5D pixel-art look (used by PostFX).
 *
 * Hybrid gather + scatter bokeh, all bokeh work at `dofScale` (½) resolution:
 *
 *   1. Prefilter  (½, MRT)  full-res colour + depth →
 *                           [0] rgb = layer-aware 2×2 downsample minus the scattered highlight
 *                               energy, a = signed CoC in ½-res px (negative = near field)
 *                           [1] rgb = highlight energy to scatter, a = isolation (1 = lone speck).
 *                           Highlight energy is decided per full-res pixel (smooth ramp from
 *                           `bokehThreshold` to 2× it) × per-pixel isolation (own luminance vs a
 *                           tent-weighted neighbourhood mean centred on that pixel), box-filtered
 *                           (energy conserving → independent of the reduced-res grid phase, so
 *                           boosted bokeh does not pulse while the camera pans), and only where
 *                           |CoC| is large enough for the composite to show the blurred layers.
 *                           Extended bright areas stay in the (normalised) gather.
 *   2. Gather     (½)       golden-angle spiral "scatter-as-gather":
 *                           - background layer: tap counts when min(centre CoC, tap CoC) covers
 *                             its distance (sharp / near content never bleeds backwards and a
 *                             blurred background never smears over the focus band), weighted by
 *                             1/max(CoC, 2)² (the inverse area it scatters over), so a mid-ground
 *                             object spreads over a blurrier background instead of keeping a
 *                             crisp silhouette;
 *                           - near layer: tap counts when its OWN CoC covers the distance,
 *                             weighted 1/CoC² (energy conserving) → an opacity estimate so the
 *                             foreground softly spills over focused content behind it.
 *                           Output rgb = mix(bg, near, nearAlpha), a = nearAlpha.
 *   3. Tent       (½)       3×3 CoC-aware tent that hides the sparse-sampling pattern.
 *   4. Sprites    (½)       every highlight texel is scattered as an anti-aliased disc of its
 *                           own CoC radius (point sprites): far/small discs are added into the
 *                           blurred layer (respecting the same visibility rule as the gather),
 *                           near discs go to a separate layer drawn on top. `bokehBoost` raises
 *                           the energy of isolated specks so they read as crisp bokeh balls.
 *                           This removes the classic stippled-disc artefact of pure gathers.
 *   5. Composite  (full)    full-res CoC from depth; CoC-aware (bilateral) upsample of the blurred
 *                           layer mixed over the untouched full-res scene by a smooth function of
 *                           the CoC (in-focus pixels stay pixel-exact) + near bokeh layer.
 *
 * CoC model (signed, in full-resolution pixels):
 *   z   = linear view depth,  dz = z − focusDistance
 *   t   = smoothstep((|dz| − focusRange/2) / (1.5·focusRange))          (0 inside the focus band)
 *   coc = (dz < 0 ? −nearScale : farScale) · t
 *   tilt-shift: outside the screen band tiltCenter ± tiltWidth/2 (uv.y) the magnitude is at least
 *   tiltShift (smoothly ramped in over `tiltFeather`, default 0.3 uv); the sign follows the depth
 *   side (or the screen side inside the focus band).
 *   CoC_px = coc · maxBlurPx,  maxBlurPx = maxBlur · renderHeight / 1080.
 */

/** Shared CoC uniforms; PostFX creates one set and every DOF material references the same objects. */
export function createCocUniforms() {
  return {
    tDepth: { value: null },
    uCamNear: { value: 0.5 },
    uCamFar: { value: 400 },
    uFocusDistance: { value: 24 },
    uFocusRange: { value: 5 },
    uNearScale: { value: 1.4 },
    uFarScale: { value: 1.0 },
    uMaxBlurPx: { value: 10 },
    uTilt: { value: new THREE.Vector3(0.35, 0.52, 0.28) },
    uTiltFeather: { value: 0.3 },
    uOrtho: { value: 0 },
  };
}

/** GLSL: depth → signed circle of confusion (full-resolution pixels). */
export const DOF_COC_GLSL = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uCamNear;
uniform float uCamFar;
uniform float uFocusDistance;
uniform float uFocusRange;
uniform float uNearScale;
uniform float uFarScale;
uniform float uMaxBlurPx;
uniform vec3 uTilt; // x = strength, y = centre (uv.y), z = band width (uv)
uniform float uTiltFeather; // uv distance over which the tilt term ramps in
uniform float uOrtho;       // 1 for orthographic cameras

float dofViewDepth(float rawDepth) {
  return uOrtho > 0.5 ? -orthographicDepthToViewZ(rawDepth, uCamNear, uCamFar)
                      : -perspectiveDepthToViewZ(rawDepth, uCamNear, uCamFar);
}

float dofCoC(float rawDepth, float uvY) {
  float z = dofViewDepth(rawDepth);
  float dz = z - uFocusDistance;
  float band = 0.5 * uFocusRange;
  float t = clamp((abs(dz) - band) / max(1.5 * uFocusRange, 1e-3), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float coc = dz < 0.0 ? -uNearScale * t : uFarScale * t;
  // screen-space tilt-shift term
  float ty = abs(uvY - uTilt.y) - 0.5 * uTilt.z;
  float tilt = uTilt.x * smoothstep(0.0, max(uTiltFeather, 1e-3), ty);
  if (tilt > abs(coc)) {
    float s = abs(dz) > band ? sign(dz) : (uvY < uTilt.y ? -1.0 : 1.0);
    coc = s * tilt;
  }
  return coc * uMaxBlurPx;
}
`;

/**
 * Prefilter (MRT): full-res colour + depth → reduced-res colour/CoC + highlight energy.
 * The CoC of a 2×2 footprint prefers the near field (foreground dilates, as it should) and
 * otherwise takes the largest blur; colours are averaged with weights favouring samples whose CoC
 * matches the chosen one, so a texel straddling a sharp silhouette carries the background colour
 * only (prevents halos when the blurred layer is spread around).
 */
export const DofPrefilterShader = {
  name: 'LuminatiDofPrefilter',
  glslVersion: THREE.GLSL3,
  uniforms: {
    tColor: { value: null },
    uFullSize: { value: new THREE.Vector2(1, 1) },
    uRatio: { value: new THREE.Vector2(2, 2) }, // full / reduced
    uScale: { value: 0.5 }, // reduced / full (CoC px conversion)
    uBokehThreshold: { value: 1.5 }, // HDR luminance above which energy is scattered as sprites
    uSprites: { value: 1 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${DOF_COC_GLSL}
    ${POST_COMMON_GLSL}
    uniform sampler2D tColor;
    uniform vec2 uFullSize;
    uniform vec2 uRatio;
    uniform float uScale;
    uniform float uBokehThreshold;
    uniform float uSprites;
    varying vec2 vUv;
    layout(location = 0) out vec4 outColorCoc;
    layout(location = 1) out vec4 outHighlight;

    void main() {
      vec2 fc = gl_FragCoord.xy * uRatio;           // centre of this texel in full-res pixels
      ivec2 p = ivec2(floor(fc - 0.5));
      ivec2 mx = ivec2(uFullSize) - 1;
      ivec2 p0 = clamp(p, ivec2(0), mx);
      ivec2 p1 = clamp(p + ivec2(1, 0), ivec2(0), mx);
      ivec2 p2 = clamp(p + ivec2(0, 1), ivec2(0), mx);
      ivec2 p3 = clamp(p + ivec2(1, 1), ivec2(0), mx);

      vec3 c0 = texelFetch(tColor, p0, 0).rgb;
      vec3 c1 = texelFetch(tColor, p1, 0).rgb;
      vec3 c2 = texelFetch(tColor, p2, 0).rgb;
      vec3 c3 = texelFetch(tColor, p3, 0).rgb;

      float k0 = dofCoC(texelFetch(tDepth, p0, 0).x, vUv.y);
      float k1 = dofCoC(texelFetch(tDepth, p1, 0).x, vUv.y);
      float k2 = dofCoC(texelFetch(tDepth, p2, 0).x, vUv.y);
      float k3 = dofCoC(texelFetch(tDepth, p3, 0).x, vUv.y);

      float kn = min(min(k0, k1), min(k2, k3));
      float kf = max(max(k0, k1), max(k2, k3));
      float kc = (kn < -1.0 || -kn > kf) ? kn : kf;

      // guard against NaN/Inf from the scene (would poison the whole bokeh kernel)
      c0 = pfxSafe(c0);
      c1 = pfxSafe(c1);
      c2 = pfxSafe(c2);
      c3 = pfxSafe(c3);

      float w0 = 1.0 / (1.0 + (k0 - kc) * (k0 - kc));
      float w1 = 1.0 / (1.0 + (k1 - kc) * (k1 - kc));
      float w2 = 1.0 / (1.0 + (k2 - kc) * (k2 - kc));
      float w3 = 1.0 / (1.0 + (k3 - kc) * (k3 - kc));
      float wsum = w0 + w1 + w2 + w3;
      vec3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / wsum;

      vec4 hl = vec4(0.0);
      // Only highlights the composite actually shows through the blurred layers are scattered:
      // same ramp as its centreA (full-res px). Nearly-focused specks stay in the sharp image;
      // extracting them would double-count them (near pass is added on top of the sharp pixels)
      // or lose them (far discs are clipped to the tiny CoC of their focused surroundings),
      // which made them pulse between 'boosted disc', 'sharp' and 'hollow ring' while panning.
      float spriteGate = smoothstep(2.0, 4.0, abs(kc));
      if (uSprites > 0.5 && spriteGate > 0.0) {
        // highlight energy, decided per full-res pixel (smooth ramp above the threshold)
        float T = uBokehThreshold;
        float l0 = pfxLuma(c0), l1 = pfxLuma(c1), l2 = pfxLuma(c2), l3 = pfxLuma(c3);
        float r0 = smoothstep(T, 2.0 * T, l0), r1 = smoothstep(T, 2.0 * T, l1);
        float r2 = smoothstep(T, 2.0 * T, l2), r3 = smoothstep(T, 2.0 * T, l3);
        if (r0 + r1 + r2 + r3 > 0.0) {
          // isolation: tent-weighted neighbourhood mean (≈14×14 px via 5×5 bilinear 2×2 taps)
          // vs each pixel's OWN luminance. Lone specks → 1 (scattered as boosted discs);
          // extended bright areas → 0 (stay in the normalised gather, which keeps their blurred
          // edges free of dark halos). The 25 taps are re-weighted per pixel so each of the 4
          // pixels gets a tent window centred on itself (pixels sit ±0.25 tap from the block
          // centre, no extra fetches): the result barely depends on how a highlight straddles
          // the reduced-res grid, so boosted bokeh does not pulse while the camera pans (the
          // sprite gain amplifies any jitter here).
          float m0 = 0.0, m1 = 0.0, m2 = 0.0, m3 = 0.0;
          for (int y = -2; y <= 2; y++) {
            float ra = 0.0, rb = 0.0;
            for (int x = -2; x <= 2; x++) {
              float L = pfxLuma(textureLod(tColor, (fc + vec2(x, y) * 2.0) / uFullSize, 0.0).rgb);
              ra += (3.0 - abs(float(x) + 0.25)) * L;
              rb += (3.0 - abs(float(x) - 0.25)) * L;
            }
            float wa = 3.0 - abs(float(y) + 0.25);
            float wb = 3.0 - abs(float(y) - 0.25);
            m0 += wa * ra; m1 += wa * rb; m2 += wb * ra; m3 += wb * rb;
          }
          const float TENT_NORM = 1.0 / 76.5625;         // (Σ weights)² = 8.75²
          float s0 = r0 * (1.0 - smoothstep(0.06, 0.6, m0 * TENT_NORM / max(l0, 1e-4)));
          float s1 = r1 * (1.0 - smoothstep(0.06, 0.6, m1 * TENT_NORM / max(l1, 1e-4)));
          float s2 = r2 * (1.0 - smoothstep(0.06, 0.6, m2 * TENT_NORM / max(l2, 1e-4)));
          float s3 = r3 * (1.0 - smoothstep(0.06, 0.6, m3 * TENT_NORM / max(l3, 1e-4)));
          // Removed from the gather: the amount the layer-aware colour average above holds.
          vec3 eGather = (c0 * (w0 * s0) + c1 * (w1 * s1) + c2 * (w2 * s2) + c3 * (w3 * s3)) / wsum;
          // Scattered as sprites: the footprint's true (box-filtered) energy. The layer-aware
          // weights dilate near-field specks to every texel they touch, so using them here
          // made the scattered energy depend on the grid phase (even/odd flicker when panning).
          vec3 eBox = (c0 * s0 + c1 * s1 + c2 * s2 + c3 * s3) * 0.25;
          vec3 eAll = (c0 * r0 + c1 * r1 + c2 * r2 + c3 * r3) * 0.25;
          float iso = clamp(pfxLuma(eBox) / max(pfxLuma(eAll), 1e-6), 0.0, 1.0);
          col -= eGather * spriteGate;
          hl = vec4(eBox * spriteGate, iso);
        }
      }
      outColorCoc = vec4(max(col, vec3(0.0)), kc * uScale);
      outHighlight = hl;
    }
  `,
};

/**
 * Golden-angle spiral kernel in the unit disc: `n` points with uniform area density.
 * @param {number} n
 * @returns {Float32Array} xyz triplets (x, y, radius)
 */
export function goldenAngleKernel(n) {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = Math.sqrt((k + 0.5) / n);
    const th = k * ga;
    out[k * 3] = r * Math.cos(th);
    out[k * 3 + 1] = r * Math.sin(th);
    out[k * 3 + 2] = r;
  }
  return out;
}

function smallKernelGLSL(n) {
  const k = goldenAngleKernel(n);
  const items = [];
  for (let i = 0; i < n; i++) items.push(`vec2(${k[i * 3].toFixed(6)}, ${k[i * 3 + 1].toFixed(6)})`);
  return `const vec2 SMALL_KERNEL[${n}] = vec2[${n}](${items.join(', ')});`;
}

function kernelGLSL(n) {
  const k = goldenAngleKernel(n);
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push(`vec3(${k[i * 3].toFixed(6)}, ${k[i * 3 + 1].toFixed(6)}, ${k[i * 3 + 2].toFixed(6)})`);
  }
  return `const vec3 KERNEL[${n}] = vec3[${n}](\n  ${items.join(',\n  ')}\n);`;
}

/**
 * Bokeh gather shader for a given tap count (compile-time constant kernel).
 * @param {number} taps
 */
export function createDofGatherShader(taps = 48) {
  return {
    name: `LuminatiDofGather${taps}`,
    defines: { TAPS: taps },
    uniforms: {
      tColorCoc: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 6 }, // kernel radius in reduced-res pixels (≥ max |CoC|)
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColorCoc;
      uniform vec2 uTexel;
      uniform float uRadius;
      varying vec2 vUv;

      ${kernelGLSL(taps)}

      void main() {
        vec4 centre = textureLod(tColorCoc, vUv, 0.0);
        float coc0 = centre.a;
        const float MARGIN = 1.0;                         // disc edge softness (px)
        // background taps are weighted by the inverse area of the disc they scatter
        // (1/CoC², floored so a focused silhouette cannot dominate its blurred neighbours):
        // a less-blurred object in front of a blurrier background then spreads over it as
        // much as it blends inward, instead of keeping a crisp 'cut-out' silhouette
        const float MIN_AREA = 4.0;                       // (2 px)²
        float norm = uRadius * uRadius / float(TAPS);     // (tap area) / PI

        float c0p = max(coc0, 0.0);
        vec4 bg = vec4(centre.rgb, 1.0) / max(c0p * c0p, MIN_AREA);
        vec4 fg = vec4(0.0);
        float fgA = 0.0;
        float nc0 = -coc0;
        if (nc0 >= 1.0) {
          fg = vec4(centre.rgb, 1.0);
          fgA = norm / max(nc0 * nc0, norm);
        }

        for (int i = 0; i < TAPS; i++) {
          vec3 k = KERNEL[i];
          float d = k.z * uRadius;
          vec4 s = textureLod(tColorCoc, vUv + k.xy * (uRadius * uTexel), 0.0);

          // background / focus layer: limited by the smaller CoC of centre and tap
          float bc = max(min(coc0, s.a), 0.0);
          float bw = clamp((bc - d) / MARGIN + 1.0, 0.0, 1.0) / max(bc * bc, MIN_AREA);
          bg += vec4(s.rgb, 1.0) * bw;

          // near layer: scatter-as-gather with the tap's own CoC
          float nc = -s.a;
          float fw = clamp((nc - d) / MARGIN + 1.0, 0.0, 1.0) * step(1.0, nc);
          fg += vec4(s.rgb, 1.0) * fw;
          fgA += fw * norm / max(nc * nc, norm);
        }

        bg.rgb /= bg.a;
        fg.rgb /= max(fg.a, 1e-4);
        fgA = fg.a > 0.0 ? clamp(fgA, 0.0, 1.0) : 0.0;
        gl_FragColor = vec4(mix(bg.rgb, fg.rgb, fgA), fgA);
      }
    `,
  };
}

/**
 * 3×3 tent post-filter (reduced res). Weights are CoC-aware so the blurred background never picks
 * up colour from focused texels, while near-field coverage (alpha) is filtered freely.
 */
export const DofTentShader = {
  name: 'LuminatiDofTent',
  uniforms: {
    tBlur: { value: null },
    tColorCoc: { value: null },
    uSize: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tBlur;
    uniform sampler2D tColorCoc;
    uniform vec2 uSize;

    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      ivec2 mx = ivec2(uSize) - 1;
      vec4 c = texelFetch(tBlur, p, 0);
      float cc = texelFetch(tColorCoc, p, 0).a;
      float tol = 1.0 + 0.25 * abs(cc);
      vec4 acc = vec4(0.0);
      float wsum = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          ivec2 q = clamp(p + ivec2(x, y), ivec2(0), mx);
          vec4 s = texelFetch(tBlur, q, 0);
          float sc = texelFetch(tColorCoc, q, 0).a;
          float w = float((2 - abs(x)) * (2 - abs(y)));   // 1-2-1 tent
          float dd = (sc - cc) / tol;
          float sim = 1.0 / (1.0 + dd * dd * 4.0);
          // strict only next to (nearly) focused texels; two blurred layers blend freely
          sim = mix(sim, 1.0, smoothstep(1.0, 2.5, min(abs(cc), abs(sc))));
          w *= mix(sim, 1.0, max(s.a, c.a));
          acc += s * w;
          wsum += w;
        }
      }
      gl_FragColor = acc / wsum;
    }
  `,
};

/**
 * Bokeh sprites: one point per 2×2 block of reduced-res texels (positions from gl_VertexID), culled
 * unless the block carries highlight energy. The block is merged energy-weighted (centre, CoC,
 * isolation) and drawn as an anti-aliased disc of its CoC radius whose total energy equals the
 * highlight energy × gain (gain > 1 only for isolated specks, ramped in with the radius so
 * nearly-focused highlights stay energy conserving).
 *
 * uMode 0 = far pass (added into the blurred layer; visibility follows the gather's
 * min(centre CoC, sprite CoC) rule and is attenuated by near-field coverage),
 * uMode 1 = near pass (own layer, composited on top).
 * uSquash > 1 narrows the discs into upright ovals carrying the same energy (an anamorphic lens:
 * PostFX's cinematic stage); 1 = round discs.
 */
export const DofBokehSpriteShader = {
  name: 'LuminatiDofBokehSprites',
  uniforms: {
    tColorCoc: { value: null },
    tHighlight: { value: null },
    tGather: { value: null },
    uSize: { value: new THREE.Vector2(1, 1) },
    uMode: { value: 0 },
    uBoost: { value: 1.5 },
    uMaxRadius: { value: 16 },
    uMaxPointSize: { value: 64 },
    uSquash: { value: 1 },
  },
  vertexShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D tColorCoc;
    uniform sampler2D tHighlight;
    uniform vec2 uSize;
    uniform float uMode;
    uniform float uBoost;
    uniform float uMaxRadius;
    uniform float uMaxPointSize;
    flat out vec3 vColor;
    flat out float vRadius;
    flat out vec2 vCentre;

    void cull() {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside the clip volume
      gl_PointSize = 1.0;
      vColor = vec3(0.0); vRadius = 0.0; vCentre = vec2(0.0);
    }

    void main() {
      // one point per 2×2 block of reduced-res texels: energy-weighted merge
      int gw = (int(uSize.x) + 1) / 2;
      ivec2 base = ivec2(gl_VertexID % gw, gl_VertexID / gw) * 2;
      ivec2 mx = ivec2(uSize) - 1;
      vec3 esum = vec3(0.0);
      vec2 eCentre = vec2(0.0);
      float cocSum = 0.0, isoSum = 0.0, lsum = 0.0;
      for (int i = 0; i < 4; i++) {
        ivec2 t = min(base + ivec2(i & 1, i >> 1), mx);
        vec4 hl = texelFetch(tHighlight, t, 0);
        float l = pfxLuma(hl.rgb);
        if (l > 0.0) {
          esum += hl.rgb;
          eCentre += (vec2(t) + 0.5) * l;
          cocSum += texelFetch(tColorCoc, t, 0).a * l;
          isoSum += hl.a * l;
          lsum += l;
        }
      }
      if (lsum < 1e-5) { cull(); return; }
      eCentre /= lsum;
      float coc = cocSum / lsum;
      float iso = isoSum / lsum;
      float wNear = smoothstep(0.75, 1.5, -coc);
      float wm = uMode > 0.5 ? wNear : 1.0 - wNear;
      vec3 e = esum * wm;
      if (pfxLuma(e) < 1e-4) { cull(); return; }
      float r = clamp(abs(coc), 0.5, uMaxRadius);
      float size = min(2.0 * ceil(r + 1.5) + 1.0, uMaxPointSize);
      r = min(r, 0.5 * size - 1.5);
      float area = max(3.14159265 * r * r, 1.0);
      float gain = 1.0 + uBoost * 4.0 * iso * smoothstep(0.5, 3.0, r) * (1.0 + 0.1 * r);
      vColor = e * gain / area;
      vRadius = r;
      vCentre = eCentre;
      // snap the point centre to a pixel centre; the disc itself is evaluated around vCentre
      vec2 pc = floor(eCentre) + 0.5;
      gl_Position = vec4(pc / uSize * 2.0 - 1.0, 0.0, 1.0);
      gl_PointSize = size;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColorCoc;
    uniform sampler2D tGather;
    uniform float uMode;
    uniform float uSquash;
    flat in vec3 vColor;
    flat in float vRadius;
    flat in vec2 vCentre;

    void main() {
      float d = length((gl_FragCoord.xy - vCentre) * vec2(uSquash, 1.0));
      float r = vRadius;
      float cov;
      if (uMode < 0.5) {
        ivec2 q = ivec2(gl_FragCoord.xy);
        float c0 = abs(texelFetch(tColorCoc, q, 0).a);
        float nearA = texelFetch(tGather, q, 0).a;
        float lim = max(min(c0, r), 0.5);
        cov = clamp(lim - d + 0.5, 0.0, 1.0) * (1.0 - nearA);
      } else {
        cov = clamp(r - d + 0.5, 0.0, 1.0);
      }
      if (cov <= 0.0) discard;
      // lens-like disc: flat body with a slightly brighter rim
      float rim = mix(0.9, 1.18, smoothstep(0.55, 1.0, d / max(r, 1.0)));
      // (an oval covers 1 / uSquash of the disc's area: × uSquash keeps its energy)
      gl_FragColor = vec4(vColor * (cov * rim * uSquash), 0.0);
    }
  `,
};

/**
 * Full-resolution composite: sharp scene + CoC-aware upsampled bokeh + near sprite layer. With
 * `DEBUG` defined it renders a CoC visualisation directly in display space
 * (near = amber, far = blue, focus band = green, near-field spill = magenta).
 */
export const DofCompositeShader = {
  name: 'LuminatiDofComposite',
  uniforms: {
    tColor: { value: null },
    tBlur: { value: null },
    tColorCoc: { value: null },
    tNearBokeh: { value: null },
    uNearBokeh: { value: 1 },
    uHalfSize: { value: new THREE.Vector2(1, 1) },
    uHalfRatio: { value: new THREE.Vector2(0.5, 0.5) }, // reduced / full (per axis)
    uScale: { value: 0.5 },
    uMaxCocPx: { value: 10 }, // full-res px, for the debug view normalisation
    uFullTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${DOF_COC_GLSL}
    ${POST_COMMON_GLSL}
    uniform sampler2D tColor;
    uniform sampler2D tBlur;
    uniform sampler2D tColorCoc;
    uniform sampler2D tNearBokeh;
    uniform float uNearBokeh;
    uniform vec2 uHalfSize;
    uniform vec2 uHalfRatio;
    uniform float uScale;
    uniform float uMaxCocPx;
    uniform vec2 uFullTexel;
    varying vec2 vUv;

    ${smallKernelGLSL(12)}

    void main() {
      ivec2 fp = ivec2(gl_FragCoord.xy);
      vec3 sharp = pfxSafe(texelFetch(tColor, fp, 0).rgb);
      float coc = dofCoC(texelFetch(tDepth, fp, 0).x, vUv.y);   // full-res px
      float cocH = coc * uScale;                                   // reduced-res px

      // CoC-aware bilinear upsample of the blurred layer
      vec2 hp = gl_FragCoord.xy * uHalfRatio - 0.5;
      vec2 f = fract(hp);
      ivec2 b = ivec2(floor(hp));
      ivec2 mx = ivec2(uHalfSize) - 1;
      ivec2 q0 = clamp(b, ivec2(0), mx);
      ivec2 q1 = clamp(b + ivec2(1, 0), ivec2(0), mx);
      ivec2 q2 = clamp(b + ivec2(0, 1), ivec2(0), mx);
      ivec2 q3 = clamp(b + ivec2(1, 1), ivec2(0), mx);
      vec4 s0 = texelFetch(tBlur, q0, 0);
      vec4 s1 = texelFetch(tBlur, q1, 0);
      vec4 s2 = texelFetch(tBlur, q2, 0);
      vec4 s3 = texelFetch(tBlur, q3, 0);
      vec4 tcs = vec4(texelFetch(tColorCoc, q0, 0).a, texelFetch(tColorCoc, q1, 0).a,
                      texelFetch(tColorCoc, q2, 0).a, texelFetch(tColorCoc, q3, 0).a);
      float tol = 1.0 + 0.25 * abs(cocH);
      vec4 dc = (tcs - cocH) / tol;
      vec4 sim = 1.0 / (1.0 + dc * dc * 4.0) + 1e-3;
      // CoC rejection only matters next to (nearly) focused texels (it keeps sharp colour from
      // leaking into blurred neighbours). Where both sides are already visibly blurred, plain
      // bilinear blending is right; rejecting there gave blurred mid-ground sprites a crisp,
      // pixel-exact 'cut-out' silhouette against a blurrier background. (Same rule in the tent.)
      sim = mix(sim, vec4(1.0), smoothstep(1.0, 2.5, min(vec4(abs(cocH)), abs(tcs))));
      vec4 bil = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      vec4 w = bil * mix(sim, vec4(1.0), clamp(vec4(s0.a, s1.a, s2.a, s3.a), 0.0, 1.0));
      vec4 blur = (s0 * w.x + s1 * w.y + s2 * w.z + s3 * w.w) / max(dot(w, vec4(1.0)), 1e-5);

      // small CoCs: a full-resolution disc blur, so the focus falloff is gradual and the
      // half-res layer only takes over once the blur is large enough to hide its resolution
      float ac = abs(coc);
      vec3 base = sharp;
      if (ac > 0.3 && ac < 4.0) {
        // scatter-as-gather: a tap only counts if its own CoC reaches this pixel, so focused
        // silhouettes never smear onto a slightly blurred background next to them
        vec3 acc = sharp;
        float wsum = 1.0;
        ivec2 fmx = ivec2(uHalfSize / uHalfRatio + 0.5) - 1;
        for (int i = 0; i < 12; i++) {
          vec2 o = SMALL_KERNEL[i] * ac;
          vec2 pos = gl_FragCoord.xy + o;
          float tc = abs(dofCoC(texelFetch(tDepth, clamp(ivec2(pos), ivec2(0), fmx), 0).x, pos.y * uFullTexel.y));
          float wt = clamp(tc - length(o) + 1.0, 0.0, 1.0);
          acc += texture2D(tColor, pos * uFullTexel).rgb * wt;
          wsum += wt;
        }
        base = mix(sharp, acc / wsum, smoothstep(0.3, 1.2, ac));
      }
      float centreA = smoothstep(2.0, 4.0, ac);
      float a = 1.0 - (1.0 - centreA) * (1.0 - clamp(blur.a, 0.0, 1.0));
      vec3 nearBokeh = uNearBokeh > 0.5 ? texture2D(tNearBokeh, vUv).rgb : vec3(0.0);

#ifdef DEBUG
      float l = pfxLuma(sharp);
      vec3 dbase = vec3(sqrt(l / (1.0 + l))) * 0.45;
      float n = sqrt(clamp(-coc / uMaxCocPx, 0.0, 1.0));
      float fr = sqrt(clamp(coc / uMaxCocPx, 0.0, 1.0));
      float inFocus = 1.0 - smoothstep(0.25, 0.75, abs(coc));
      vec3 col = dbase;
      col = mix(col, vec3(1.0, 0.55, 0.12), n * 0.8);
      col = mix(col, vec3(0.22, 0.5, 1.0), fr * 0.8);
      col = mix(col, col * 0.5 + vec3(0.12, 0.5, 0.16), inFocus);
      float spill = clamp(blur.a, 0.0, 1.0) * step(-0.5, coc);
      col = mix(col, vec3(0.85, 0.2, 0.75), spill * 0.6);
      gl_FragColor = vec4(col, 1.0);
#else
      gl_FragColor = vec4(mix(base, blur.rgb, a) + nearBokeh, 1.0);
#endif
    }
  `,
};
