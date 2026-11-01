/**
 * Small shared pieces for the post-processing shaders (PostFX).
 *
 * All post shaders are rendered with three's `FullScreenQuad` (a single oversized triangle
 * whose positions are already in clip space), so the vertex stage is a pass-through.
 */

/** Pass-through vertex shader for full-screen passes (FullScreenQuad geometry is in clip space). */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** GLSL helpers shared by several post shaders. */
export const POST_COMMON_GLSL = /* glsl */ `
float pfxLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Scrub NaN / Inf / negative values coming from the scene (one bad pixel would otherwise poison
// every blur kernel that touches it). Tests the exponent bits instead of isnan(), which D3D's
// fast-math compiler is allowed to optimise away.
bool pfxNonFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
vec3 pfxSafe(vec3 c) {
  bool bad = pfxNonFinite(c.r) || pfxNonFinite(c.g) || pfxNonFinite(c.b);
  return bad ? vec3(0.0) : clamp(c, vec3(0.0), vec3(6.0e4));
}

// 8×8 Bayer ordered-dither threshold in [0, 1) (recursive closed form).
float pfxBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float pfxBayer4(vec2 a) { return pfxBayer2(0.5 * a) * 0.25 + pfxBayer2(a); }
float pfxBayer8(vec2 a) { return pfxBayer4(0.5 * a) * 0.25 + pfxBayer2(a); }

// Interleaved gradient noise (Jimenez 2014): cheap, well distributed, in [0, 1).
float pfxIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// Integer-ish hash -> [0, 1) (Dave Hoskins, "hash without sine").
float pfxHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** Plain copy (used when DOF is disabled but bloom needs a writable, non-multisampled target). */
export const CopyShader = {
  name: 'LuminatiCopyShader',
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    ${POST_COMMON_GLSL}
    uniform sampler2D tDiffuse;
    void main() {
      gl_FragColor = vec4(pfxSafe(texelFetch(tDiffuse, ivec2(gl_FragCoord.xy), 0).rgb), 1.0);
    }
  `,
};
