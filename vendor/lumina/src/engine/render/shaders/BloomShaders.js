import { FULLSCREEN_VERTEX, POST_COMMON_GLSL } from './PostCommon.js';

/**
 * Replacement bright-pass for three's UnrealBloomPass.
 *
 * The stock LuminosityHighPassShader passes the *whole* pixel through once it crosses the
 * threshold, which makes every sunlit surface bloom and washes the frame out. This version keeps
 * only the energy above the threshold with a quadratic soft knee (as in UE / Unity), so only real
 * highlights (lanterns, glints, bokeh balls) glow. It keeps the uniform names UnrealBloomPass
 * writes (`tDiffuse`, `luminosityThreshold`) so it can be swapped in-place.
 */
export const BloomBrightPassShader = {
  name: 'LuminatiBloomBrightPass',
  uniforms: {
    tDiffuse: { value: null },
    luminosityThreshold: { value: 0.82 },
    smoothWidth: { value: 0.35 }, // soft knee width
    maxBrightness: { value: 24.0 }, // clamps fireflies so single hot pixels cannot flicker the bloom
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    uniform float maxBrightness;
    varying vec2 vUv;

    void main() {
      vec3 c = pfxSafe(texture2D(tDiffuse, vUv).rgb);
      float br = max(c.r, max(c.g, c.b));
      float knee = max(smoothWidth, 1e-4);
      float soft = clamp(br - luminosityThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float contrib = max(soft, br - luminosityThreshold) / max(br, 1e-4);
      vec3 o = c * contrib;
      float m = max(o.r, max(o.g, o.b));
      o *= min(1.0, maxBrightness / max(m, 1e-4));
      gl_FragColor = vec4(o, 1.0);
    }
  `,
};
