import * as THREE from 'three';
import { globalUniforms } from '../../render/GlobalUniforms.js';
import { PPU, RENDER_ORDER } from '../../constants.js';
import { PALETTE } from '../../pixel/Palette.js';
import { toThreeColor } from '../../pixel/PixelCanvas.js';

/**
 * Procedural pixel-art flames.
 *
 * A flame is a Y-axis billboard (oriented by `globalUniforms.uCameraYaw`, like every sprite in the
 * engine) whose fragment shader draws noise-driven fire quantised to the world pixel grid
 * (16 px / unit) and stepped in time (12 fps) so it reads as hand-animated pixel art. Colours come
 * from the palette's fire ramp in HDR (core up to ~6×) so the post-process bloom picks them up.
 * The flame is alpha-tested (writes depth → depth of field works) and fogged.
 * An optional soft additive glow card sits just behind it (brighter at night via uNight).
 */

// ACES in three pre-scales by 1/0.6: keep the outer bands ≤ 1 so they stay saturated red/orange/
// yellow (a yellow band > 1 tone-maps to pale cream), only the white-hot core goes HDR (→ bloom).
const FIRE_GAINS = [0.55, 0.62, 0.75, 0.9, 1.0, 2.4];

/** The fire ramp in HDR (PALETTE.fire × FIRE_GAINS), linear: the flame shader's `uFire`. */
export function fireColors() {
  return PALETTE.fire.map((c, i) => toThreeColor(c).multiplyScalar(FIRE_GAINS[i]));
}

const BILLBOARD_VERT = /* glsl */ `
uniform float uCameraYaw;
uniform float uLift;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec3 wCenter = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  float sx = length( modelMatrix[ 0 ].xyz );
  float sy = length( modelMatrix[ 1 ].xyz );
  vec3 right = vec3( cos( uCameraYaw ), 0.0, - sin( uCameraYaw ) );
  vec3 toCam = vec3( sin( uCameraYaw ), 0.0, cos( uCameraYaw ) );
  vec3 wPos = wCenter + right * position.x * sx + vec3( 0.0, 1.0, 0.0 ) * position.y * sy + toCam * uLift;
  vec4 mvPosition = viewMatrix * vec4( wPos, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** The flames' value noise (`fh21`, `fnoise`). */
export const NOISE = /* glsl */ `
float fh21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float fnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fh21( i ), fh21( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( fh21( i + vec2( 0.0, 1.0 ) ), fh21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

/**
 * The flame's per-material inputs (FLAME_FRAG's head). The instanced flames of FlameBatch.js read
 * the same names from per-instance varyings instead (their head `#define`s them), so the body below
 * is the one source of the flame's look.
 */
const FLAME_HEAD = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uSpeed;
uniform vec2 uPx;
uniform vec3 uFire[ 6 ];
varying vec2 vUv;
`;

/** The flame's fragment body: noise-driven tongues on the world pixel grid, the fire ramp in bands. */
export const FLAME_BODY = /* glsl */ `#include <common>
#include <fog_pars_fragment>
${NOISE}
void main() {
  vec2 px = floor( vUv * uPx );
  vec2 uv = ( px + 0.5 ) / uPx;
  // stepped time → hand-animated feel (12 fps). Every noise input is kept small (time wrapped
  // every 50 s, seed folded to [0, 20)) — the fract()-hash loses float32 precision past ~10^3,
  // which would quantise the tongues after a long session or for large seeds.
  float sOff = fract( uSeed * 0.1731 ) * 20.0;
  float t = mod( floor( uTime * 12.0 * uSpeed ), 600.0 ) / 12.0 + sOff;
  float y = uv.y;
  float x = uv.x * 2.0 - 1.0;
  // tongues: horizontal displacement growing with height, scrolling upward
  float wob = fnoise( vec2( y * 3.2 - t * 2.3, t * 0.7 + sOff ) ) - 0.5;
  x += wob * 0.35 * y;
  // teardrop profile: broad rounded base, full belly, pointed tip
  float w = 0.98 * pow( max( 1.0 - y, 0.0 ), 0.42 ) * ( 0.9 + 0.1 * smoothstep( 0.0, 0.3, y ) );
  // rounded bottom (no flat rectangular cut at the base of the quad)
  float rb = 1.0 - clamp( y / 0.16, 0.0, 1.0 );
  w *= mix( 0.45, 1.0, sqrt( max( 1.0 - rb * rb, 0.0 ) ) );
  float heat = ( 1.0 - abs( x ) / max( w, 1e-3 ) ) * 1.3;
  // split the upper half into 2–3 licking lobes
  float lob = sin( x * 6.9 + t * 1.7 + sOff ) * 0.5 + 0.5;
  heat -= ( 1.0 - lob ) * 0.6 * smoothstep( 0.5, 1.0, y );
  // turbulence in pixel space (chunky), stronger toward the tip → broken tongues
  vec2 q = vec2( px.x * 0.42, px.y * 0.36 - t * 5.5 );
  float n = fnoise( q + sOff * 3.0 ) * 0.6 + fnoise( q * 2.1 + 3.7 ) * 0.4;
  heat += ( n - 0.5 ) * ( 0.3 + 0.5 * y );
  heat -= y * 0.15;
  if ( heat < 0.08 ) discard;
  // bands: small white-hot core low in the flame, yellow heart, orange body, red rim; the dark
  // red only on the lower rim so broken-off tongue pixels near the tip stay fiery orange-red
  vec3 col;
  if ( heat > 1.05 && y < 0.38 ) col = uFire[ 5 ];
  else if ( heat > 0.9 ) col = uFire[ 4 ];
  else if ( heat > 0.55 ) col = uFire[ 3 ];
  else if ( heat > 0.24 || y < 0.25 || y > 0.55 ) col = uFire[ 2 ];
  else col = uFire[ 1 ];
  gl_FragColor = vec4( col * uIntensity, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const FLAME_FRAG = FLAME_HEAD + FLAME_BODY;

/** The glow's per-material inputs (GLOW_FRAG's head; see FLAME_HEAD). */
const GLOW_HEAD = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uNight;
uniform float uDay;
uniform float uBaseV;
uniform vec3 uColor;
varying vec2 vUv;
`;

/** The glow card's fragment body: a soft radial falloff that flickers, faded below the flame base. */
export const GLOW_BODY = /* glsl */ `#include <common>
#include <fog_pars_fragment>
${NOISE}
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float g = pow( max( 1.0 - r, 0.0 ), 1.7 );
  // fade out toward / below the flame base: the vertical card would otherwise cut a hard
  // horizontal edge where it intersects the ground (campfire) or a wall
  g *= smoothstep( uBaseV - 0.04, uBaseV + 0.2, vUv.y );
  float flick = 0.82 + 0.18 * fnoise( vec2( mod( uTime, 60.0 ) * 7.0, fract( uSeed * 0.1731 ) * 40.0 ) );
  float k = g * flick * uIntensity * mix( uDay, 1.0, uNight );
  if ( k < 0.002 ) discard;
  gl_FragColor = vec4( uColor * k, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // additive: fade the contribution out with fog instead of tinting toward the fog colour
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogF;
  #endif
}
`;

const GLOW_FRAG = GLOW_HEAD + GLOW_BODY;

/**
 * Create the flame ShaderMaterial.
 * @param {{ width:number, height:number, seed?:number, intensity?:number, speed?:number }} opts
 */
export function createFlameMaterial({ width, height, seed = 0, intensity = 1, speed = 1 }) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uSeed: { value: seed },
    uIntensity: { value: intensity },
    uSpeed: { value: speed },
    uLift: { value: 0.02 },
    uPx: { value: new THREE.Vector2(Math.max(4, Math.round(width * PPU)), Math.max(4, Math.round(height * PPU))) },
    uFire: { value: fireColors() },
  }]);
  uniforms.uTime = globalUniforms.uTime;
  uniforms.uCameraYaw = globalUniforms.uCameraYaw;
  uniforms.uFogStart = globalUniforms.uFogStart;
  const m = new THREE.ShaderMaterial({
    name: 'luminati:flame',
    uniforms,
    vertexShader: BILLBOARD_VERT,
    fragmentShader: FLAME_FRAG,
    fog: true,
    side: THREE.DoubleSide,
  });
  return m;
}

/**
 * Soft additive glow card material.
 * @param {{ color?:THREE.ColorRepresentation, intensity?:number, seed?:number, day?:number, baseV?:number }} [opts]
 *   baseV: card v-coordinate of the flame base; the glow fades out below it (default -1 = no fade)
 */
export function createGlowMaterial({ color = 0xff8a3a, intensity = 0.6, seed = 0, day = 0.25, baseV = -1 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uSeed: { value: seed },
    uIntensity: { value: intensity },
    uDay: { value: day },
    uLift: { value: -0.05 },
    uBaseV: { value: baseV },
    uColor: { value: new THREE.Color(color) },
  }]);
  uniforms.uTime = globalUniforms.uTime;
  uniforms.uCameraYaw = globalUniforms.uCameraYaw;
  uniforms.uNight = globalUniforms.uNight;
  uniforms.uFogStart = globalUniforms.uFogStart;
  return new THREE.ShaderMaterial({
    name: 'luminati:glow',
    uniforms,
    vertexShader: BILLBOARD_VERT,
    fragmentShader: GLOW_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * A flame billboard (+ optional glow) as a Group whose origin is the flame's base.
 * @param {{ width?:number, height?:number, seed?:number, intensity?:number, speed?:number,
 *           glow?:boolean, glowSize?:number, glowIntensity?:number, glowColor?:THREE.ColorRepresentation }} [opts]
 * @returns {{ object: THREE.Group, flame: THREE.Mesh, glow: THREE.Mesh|null, materials: THREE.Material[], geometries: THREE.BufferGeometry[] }}
 */
export function createFlame({ width = 0.5, height = 0.75, seed = 0, intensity = 1, speed = 1, glow = true,
  glowSize = 2.6, glowIntensity = 0.55, glowColor = 0xff8a3a } = {}) {
  const object = new THREE.Group();
  object.name = 'flame';
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(0, height / 2, 0);
  const mat = createFlameMaterial({ width, height, seed, intensity, speed });
  const flame = new THREE.Mesh(geo, mat);
  flame.name = 'flame:body';
  flame.castShadow = false;
  flame.receiveShadow = false;
  object.add(flame);
  const materials = [mat];
  const geometries = [geo];
  let glowMesh = null;
  if (glow) {
    const gs = Math.max(width, height) * glowSize;
    const ggeo = new THREE.PlaneGeometry(gs, gs);
    ggeo.translate(0, height * 0.4, 0);
    const gmat = createGlowMaterial({ color: glowColor, intensity: glowIntensity, seed, baseV: 0.5 - (height * 0.4) / gs });
    glowMesh = new THREE.Mesh(ggeo, gmat);
    glowMesh.name = 'flame:glow';
    glowMesh.renderOrder = RENDER_ORDER.PARTICLES + 5;
    glowMesh.castShadow = false;
    glowMesh.receiveShadow = false;
    object.add(glowMesh);
    materials.push(gmat);
    geometries.push(ggeo);
  }
  return { object, flame, glow: glowMesh, materials, geometries };
}
