import * as THREE from 'three';
import { FULLSCREEN_VERTEX, POST_COMMON_GLSL } from './PostCommon.js';

/**
 * The anamorphic streaks of PostFX's cinematic stage (`settings.cinematic`), all at ¼ of the frame:
 *
 *   the bloom's bright pass (½ res, valid after the bloom rendered)
 *     → prefilter: one bilinear tap at the shared corner of its 2 × 2 bright texels (an exact box
 *       at any frame size) and a second, higher threshold — only lamps, fires, glows and strong
 *       glints streak
 *     → four horizontal blurs, 7 taps `uStep` texels apart (1, 3, 9, 27): each widens the streak
 *       about four-fold, and every level's output is kept
 *     → composite into the prefilter's target (free again): the levels summed with the long ones
 *       weighted up — a thin line reaching far past its light, not a fat glow — drawn toward the
 *       lens coating's tint, at the frame's exposure.
 *
 * The cinematic grade adds the result to the picture (GradeShader `tStreak`): the streaks need no
 * full-resolution pass of their own.
 */

/** The bright pass down to ¼ res, keeping the energy above a second threshold (soft knee). */
export const StreakPrefilterShader = {
  name: 'LuminatiStreakPrefilter',
  uniforms: {
    tBright: { value: null },
    uBrightTexel: { value: new THREE.Vector2(1, 1) },
    uThreshold: { value: 1.0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D tBright;
    uniform vec2 uBrightTexel;
    uniform float uThreshold;

    void main() {
      // one bilinear tap at the shared corner of bright texels 2i, 2i + 1: their exact mean, also
      // where the bright target is not twice this one's size (an odd width or height; its last
      // block clamps to the edge)
      vec2 uv = (2.0 * floor(gl_FragCoord.xy) + 1.0) * uBrightTexel;
      vec3 c = pfxSafe(texture2D(tBright, uv).rgb);
      float br = max(c.r, max(c.g, c.b));
      // a soft knee half the threshold wide (the bright pass already took off the bloom's threshold)
      float knee = 0.5 * uThreshold + 1e-3;
      float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      gl_FragColor = vec4(c * (max(soft, br - uThreshold) / max(br, 1e-4)), 1.0);
    }
  `,
};

/** One horizontal blur: 7 taps `uStep` texels apart (weights 0.25, 2 × 0.2, 2 × 0.12, 2 × 0.055). */
export const StreakBlurShader = {
  name: 'LuminatiStreakBlur',
  uniforms: {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uStep: { value: 1 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform vec2 uTexel;
    uniform float uStep;
    varying vec2 vUv;

    void main() {
      vec2 o = vec2(uTexel.x * uStep, 0.0);
      vec3 c = texture2D(tSrc, vUv).rgb * 0.25
             + (texture2D(tSrc, vUv + o).rgb + texture2D(tSrc, vUv - o).rgb) * 0.2
             + (texture2D(tSrc, vUv + 2.0 * o).rgb + texture2D(tSrc, vUv - 2.0 * o).rgb) * 0.12
             + (texture2D(tSrc, vUv + 3.0 * o).rgb + texture2D(tSrc, vUv - 3.0 * o).rgb) * 0.055;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

/** The four blur levels summed (a bright core, a long tail), tinted, × strength × exposure. */
export const StreakCompositeShader = {
  name: 'LuminatiStreakComposite',
  uniforms: {
    t1: { value: null },
    t2: { value: null },
    t3: { value: null },
    t4: { value: null },
    uTint: { value: new THREE.Vector3(0.25, 0.5, 1.0) },
    uTintMix: { value: 0.85 },
    uStrength: { value: 1.0 },
    uExposure: { value: 1.0 },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D t1;
    uniform sampler2D t2;
    uniform sampler2D t3;
    uniform sampler2D t4;
    uniform vec3 uTint;
    uniform float uTintMix;
    uniform float uStrength;
    uniform float uExposure;
    varying vec2 vUv;

    void main() {
      vec3 s = texture2D(t1, vUv).rgb * 0.25 + texture2D(t2, vUv).rgb * 0.6
             + texture2D(t3, vUv).rgb * 1.2 + texture2D(t4, vUv).rgb * 2.4;
      // the lens coating's colour: the streak keeps its luminance, its hue drawn toward the tint
      vec3 tinted = pfxLuma(s) * uTint / max(pfxLuma(uTint), 1e-4);
      gl_FragColor = vec4(mix(s, tinted, uTintMix) * (uStrength * uExposure), 1.0);
    }
  `,
};
