import * as THREE from 'three';
import { FULLSCREEN_VERTEX, POST_COMMON_GLSL } from './PostCommon.js';

/**
 * Display-space colour grade (runs after OutputPass, i.e. on tone-mapped sRGB values).
 *
 * Order: radial chromatic aberration + unsharp-mask sharpen (sampling) → exposure → white balance
 * (temperature / tint) → contrast around mid-grey → saturation → split toning (shadows /
 * highlights tint by luminance) → aspect-aware elliptical vignette → animated luminance-weighted
 * film grain → ordered dither (removes banding in the dark vignette gradient).
 *
 * `CINEMATIC` defined (a program of its own: PostFX's cinematic stage, `settings.cinematic`) makes
 * the film variant. Right after the sampling it adds the anamorphic streaks (`tStreak`, linear light
 * at ¼ res, while `uStreaks` is 1) as light to light, through a gamma-2.2 round trip. After the split
 * toning come an orange & teal pull (each hue turned toward the nearer end of the orange / steel-teal
 * axis — hues near right angles to it barely, so the pull is continuous —, chroma along it kept and
 * across it thinned: `uTealOrange`) and a film print (an S-curve
 * around mid-grey, `uFilmCurve`, then the print's black and white points, `uBlack` / `uWhite`). Its
 * grain is film grain instead of pixel noise: soft clumps about `uGrainSize` px across (value noise,
 * two octaves), a new pattern 24 times a second, with colour of its own (`uGrainChroma`). Without the
 * define the grade computes what it always did.
 */
export const GradeShader = {
  name: 'LuminatiGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 16 / 9 },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.12 },
    uTemperature: { value: 0.08 },
    uTint: { value: 0.0 },
    uShadowsTint: { value: new THREE.Vector3(0.02, 0.04, 0.08) },
    uHighlightsTint: { value: new THREE.Vector3(0.06, 0.03, -0.02) },
    uVignette: { value: 0.5 },
    uVignetteSoftness: { value: 0.55 },
    uVignetteRoundness: { value: 0.65 },
    uVignetteColor: { value: new THREE.Vector3(0.05, 0.025, 0.04) },
    uGrain: { value: 0.035 },
    uGrainSize: { value: 1.0 },
    uGrainSeed: { value: 0.0 },
    uCA: { value: 0.0015 },
    uSharpen: { value: 0.15 },
    uDither: { value: 1.0 },
    // the CINEMATIC variant's
    tStreak: { value: null },
    uStreaks: { value: 0.0 },
    uTealOrange: { value: 0.0 },
    uFilmCurve: { value: 0.0 },
    uBlack: { value: new THREE.Vector3(0, 0, 0) },
    uWhite: { value: new THREE.Vector3(1, 1, 1) },
    uGrainChroma: { value: 0.0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uAspect;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uTemperature;
    uniform float uTint;
    uniform vec3 uShadowsTint;
    uniform vec3 uHighlightsTint;
    uniform float uVignette;
    uniform float uVignetteSoftness;
    uniform float uVignetteRoundness;
    uniform vec3 uVignetteColor;
    uniform float uGrain;
    uniform float uGrainSize;
    uniform float uGrainSeed;
    uniform float uCA;
    uniform float uSharpen;
    uniform float uDither;
    #ifdef CINEMATIC
    uniform sampler2D tStreak;
    uniform float uStreaks;
    uniform float uTealOrange;
    uniform float uFilmCurve;
    uniform vec3 uBlack;
    uniform vec3 uWhite;
    uniform float uGrainChroma;
    // the orange axis in the (Cb, Cr) plane: orange ≈ rgb(1, 0.55, 0.2); its opposite is steel teal
    const vec2 ORANGE = vec2(-0.7415, 0.6709);
    // vec2 → vec3 hash in [0, 1) (Dave Hoskins, "Hash without Sine")
    vec3 filmHash32(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yxz + 33.33);
      return fract((p3.xxy + p3.yzz) * p3.zyx);
    }
    // value noise in [0, 1): the lattice's hashes, smoothly blended — clumps, not pixels
    float filmNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(pfxHash12(i), pfxHash12(i + vec2(1.0, 0.0)), f.x),
                 mix(pfxHash12(i + vec2(0.0, 1.0)), pfxHash12(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // three independent value noises at once (the luma clumps and the two colour layers)
    vec3 filmNoise3(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(filmHash32(i), filmHash32(i + vec2(1.0, 0.0)), f.x),
                 mix(filmHash32(i + vec2(0.0, 1.0)), filmHash32(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    #endif
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      // position relative to centre, x scaled toward the true aspect by 'roundness'
      vec2 d = uv - 0.5;
      vec2 dv = d * vec2(mix(1.0, uAspect, uVignetteRoundness), 1.0);
      float cornerLen = length(vec2(0.5 * mix(1.0, uAspect, uVignetteRoundness), 0.5));
      float r = length(dv) / cornerLen;            // 0 centre … 1 corners

      // --- sampling: sharpen + chromatic aberration
      vec3 c = texture2D(tDiffuse, uv).rgb;
      vec3 nb = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb
              + texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb
              + texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb
              + texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
      vec3 detail = clamp((c - nb * 0.25) * uSharpen, vec3(-0.08), vec3(0.08));
      vec3 col = c;
      if (uCA > 0.0) {
        vec2 off = d * (uCA * 2.0 * r * r);       // radial, grows toward the edges
        col.r = texture2D(tDiffuse, uv - off).r;
        col.b = texture2D(tDiffuse, uv + off).b;
      }
      col += detail;
      col = max(col, vec3(0.0));
      #ifdef CINEMATIC
      // --- anamorphic streaks: light added to light (a gamma-2.2 round trip around the add)
      if (uStreaks > 0.0) col = pow(pow(col, vec3(2.2)) + texture2D(tStreak, uv).rgb, vec3(1.0 / 2.2));
      #endif

      // --- exposure (post tone-map multiply)
      col *= uExposure;

      // --- white balance: warm/cool along blue↔amber, tint along green↔magenta, luma preserving
      vec3 wb = vec3(1.0 + 0.30 * uTemperature + 0.10 * uTint,
                     1.0 + 0.02 * uTemperature - 0.25 * uTint,
                     1.0 - 0.34 * uTemperature + 0.10 * uTint);
      wb /= pfxLuma(wb);
      col *= wb;

      // --- contrast around display mid-grey
      col = (col - 0.5) * uContrast + 0.5;
      col = max(col, vec3(0.0));

      // --- saturation
      float l = pfxLuma(col);
      col = max(mix(vec3(l), col, uSaturation), vec3(0.0));

      // --- split toning
      l = clamp(pfxLuma(col), 0.0, 1.0);
      float ws = (1.0 - l) * (1.0 - l);
      float wh = l * l;
      col += uShadowsTint * ws + uHighlightsTint * wh;

      #ifdef CINEMATIC
      // --- orange & teal: each hue turned toward the nearer end of the axis; chroma along it kept
      // (skin, fire, sky), across it thinned (greens, magentas); luminance kept. The turn fades out
      // toward right angles to the axis, where the nearer end flips: no hue jumps there.
      {
        float y = pfxLuma(col);
        vec2 cc = vec2(col.b - y, col.r - y);    // (Cb, Cr)
        float m = length(cc);
        if (m > 1e-5) {
          vec2 n = cc / m;
          float s = dot(n, ORANGE);
          float turn = uTealOrange * smoothstep(0.0, 0.35, abs(s));
          vec2 nn = normalize(mix(n, s >= 0.0 ? ORANGE : -ORANGE, turn));
          cc = nn * m * mix(1.0, 0.72 + 0.38 * abs(s), uTealOrange);
          col.r = y + cc.y;
          col.b = y + cc.x;
          col.g = (y - 0.2126 * col.r - 0.0722 * col.b) / 0.7152;
          col = max(col, vec3(0.0));
        }
      }
      // --- film print: an S around mid-grey (toe and shoulder), then the print's black and white
      vec3 sc = clamp(col, 0.0, 1.0);
      col = mix(col, sc * sc * (3.0 - 2.0 * sc), uFilmCurve);
      col = uBlack + col * (uWhite - uBlack);
      #endif

      // --- vignette (smooth, elliptical; darkens toward a deep warm brown instead of grey)
      float inner = mix(0.95, 0.05, clamp(uVignetteSoftness, 0.0, 1.0));
      float v = smoothstep(inner, 1.25, r);
      v = v * v * (3.0 - 2.0 * v);
      col = mix(col, uVignetteColor * col, clamp(uVignette * v * 1.35, 0.0, 1.0));

      #ifdef CINEMATIC
      // --- film grain: soft clumps about uGrainSize px across, strongest in the mid-tones (a little
      // more in the shadows than the pixel grain); colour grain: red and blue clumps of their own,
      // green opposite them so that it adds no luminance
      vec2 fp = gl_FragCoord.xy / uGrainSize + uGrainSeed * vec2(37.17, 91.31);
      vec3 n3 = filmNoise3(fp);
      // (two octaves' weighted mean, centred; × 3.2: value noise spreads less than pixel noise)
      float g = ((2.0 * n3.x + filmNoise(fp * 2.17 + 19.3)) / 3.0 - 0.5) * 3.2;
      float cr = n3.y * 2.0 - 1.0;
      float cb = n3.z * 2.0 - 1.0;
      float lg = clamp(pfxLuma(col), 0.0, 1.0);
      float gw = 0.5 + 2.4 * lg * (1.0 - lg);
      col += (vec3(g) + vec3(cr, -(0.2126 * cr + 0.0722 * cb) / 0.7152, cb) * uGrainChroma) * uGrain * gw;
      #else
      // --- film grain: animated, strongest in the mid-tones
      vec2 gp = floor(gl_FragCoord.xy / uGrainSize);
      float g = pfxHash12(gp + uGrainSeed * vec2(113.7, 71.3)) + pfxHash12(gp * 1.37 + uGrainSeed * vec2(37.1, 91.9)) - 1.0;
      float lg = clamp(pfxLuma(col), 0.0, 1.0);
      float gw = 0.35 + 2.6 * lg * (1.0 - lg);
      col += g * uGrain * gw;
      #endif

      // --- ordered dither (±0.5 LSB of 8-bit) against banding
      col += (pfxBayer8(gl_FragCoord.xy) - 0.5) * (uDither / 255.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
