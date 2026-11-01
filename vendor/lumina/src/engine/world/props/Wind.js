import * as THREE from 'three';
import { globalUniforms } from '../../render/GlobalUniforms.js';

/**
 * Wind sway (+ optional billboarding) for foliage.
 *
 * The displacement is computed in WORLD space from `globalUniforms.uTime / uWind / uWindStrength`
 * and the per-vertex attributes written by MeshBuilder:
 *   aSway   — 0 = rooted, 1 = full sway (height-weighted canopy tips)
 *   aPhase  — per-cluster phase so clumps flutter independently
 *   aCenter — (billboard materials) pivot of the leaf card; the card is authored facing +Z in
 *             object space and re-oriented on the GPU to face the camera yaw (colour pass) or
 *             the sun (shadow pass, so the canopy always casts a full, dappled shadow)
 * and converted back to object space, so rotated / uniformly scaled props sway correctly.
 * The exact same patch is applied to the shadow depth material so shadows sway with the canopy.
 */

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
uniform float uCameraYaw;
uniform vec3 uSunDirection;
attribute float aSway;
attribute float aPhase;
#ifdef FOLIAGE_BILLBOARD
attribute vec3 aCenter;
#endif
`;

const WIND_VERTEX = /* glsl */ `
#include <begin_vertex>
{
  mat3 wM3 = mat3( modelMatrix );
  float wS2 = max( dot( wM3[ 0 ], wM3[ 0 ] ), 1e-6 );
#ifdef FOLIAGE_BILLBOARD
  {
    #ifdef FOLIAGE_SHADOW_PASS
      vec2 bbDir = normalize( uSunDirection.xz + vec2( 1e-4, 0.0 ) );
      float bbYaw = atan( bbDir.x, bbDir.y );
      float bbTilt = 0.15;
    #else
      float bbYaw = uCameraYaw;
      float bbTilt = 0.42;
    #endif
    vec3 bbOff = position - aCenter;
    vec3 bbToCam = vec3( sin( bbYaw ), 0.0, cos( bbYaw ) );
    vec3 bbRight = vec3( cos( bbYaw ), 0.0, - sin( bbYaw ) );
    vec3 bbUp = normalize( vec3( 0.0, 1.0, 0.0 ) - bbToCam * bbTilt );
    vec3 bbWorld = ( bbRight * bbOff.x + bbUp * bbOff.y + bbToCam * bbOff.z ) * sqrt( wS2 );
    transformed = aCenter + ( bbWorld * wM3 ) / wS2;
  }
#endif
  vec3 wOrigin = modelMatrix[ 3 ].xyz;
  float wLen = length( uWind );
  vec2 wDir = wLen > 1e-4 ? uWind / wLen : vec2( 1.0, 0.0 );
  float wPh = aPhase + wOrigin.x * 0.23 + wOrigin.z * 0.17;
  float wT = uTime;
  // slow gusts travelling across the map + two-frequency sway + small per-leaf flutter
  float gust = 0.55 + 0.45 * sin( wT * 0.43 - dot( wOrigin.xz, wDir ) * 0.09 );
  float sway = sin( wT * 1.21 + wPh ) * 0.62 + sin( wT * 2.37 + wPh * 1.73 ) * 0.38;
  float amp = aSway * uWindStrength * ( 0.35 + 0.65 * min( wLen, 2.0 ) );
  vec3 wDisp = vec3( 0.0 );
  wDisp.xz = wDir * ( sway * 0.075 + gust * 0.06 ) * amp;
  float flutter = sin( wT * 4.3 + dot( position, vec3( 2.9, 2.1, 1.7 ) ) + wPh * 2.0 ) * 0.022 * amp;
  wDisp.xz += vec2( -wDir.y, wDir.x ) * flutter;
  wDisp.y = flutter * 0.7 - sway * sway * 0.012 * amp;
  // world → object (uniform scale): M^-1 d = (d * M3) / s^2
  transformed += ( wDisp * wM3 ) / wS2;
}
`;

// Foliage lighting: normals are authored (spherical canopy normals), so do not flip them on
// back faces, and wrap the diffuse term a little so leaves facing away from the sun stay alive.
const FOLIAGE_NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin.replace(
  'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
  'float faceDirection = 1.0;',
);
const FOLIAGE_LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + FOLIAGE_WRAP ) / ( 1.0 + FOLIAGE_WRAP ) );',
);

function bindWindUniforms(shader, defines) {
  shader.uniforms.uTime = globalUniforms.uTime;
  shader.uniforms.uWind = globalUniforms.uWind;
  shader.uniforms.uWindStrength = globalUniforms.uWindStrength;
  shader.uniforms.uCameraYaw = globalUniforms.uCameraYaw;
  shader.uniforms.uSunDirection = globalUniforms.uSunDirection;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `${defines}#include <common>\n${WIND_PARS}`)
    .replace('#include <begin_vertex>', WIND_VERTEX);
}

/**
 * Patch a Lambert material so it sways in the wind (vertex) and optionally uses foliage lighting
 * and camera-facing billboard cards. Marks `material.userData.wind = true` (and `.billboard`) so
 * MeshBuilder emits the aSway/aPhase(/aCenter) attributes, and attaches
 * `material.userData.depthMaterial` as the mesh's customDepthMaterial.
 * @param {THREE.Material} material
 * @param {{ foliage?: boolean, wrap?: number, billboard?: boolean }} [opts]
 */
export function applyWind(material, { foliage = false, wrap = 0.45, billboard = false } = {}) {
  const defines = billboard ? '#define FOLIAGE_BILLBOARD\n' : '';
  material.onBeforeCompile = (shader) => {
    bindWindUniforms(shader, defines);
    if (foliage) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', FOLIAGE_NORMAL_BEGIN)
        .replace('#include <lights_lambert_pars_fragment>', `#define FOLIAGE_WRAP ${wrap.toFixed(3)}\n${FOLIAGE_LAMBERT}`);
    }
  };
  const key = `luminati-wind-${foliage ? `foliage-${wrap.toFixed(3)}` : 'solid'}${billboard ? '-bb' : ''}`;
  material.customProgramCacheKey = () => key;
  material.userData.wind = true;
  if (billboard) material.userData.billboard = true;
  material.userData.depthMaterial = createWindDepthMaterial({ billboard });
  return material;
}

/**
 * MeshDepthMaterial with the same wind displacement (for customDepthMaterial). The shadow
 * renderer copies map / alphaTest / side from the mesh material, so alpha-tested leaves cast
 * dappled shadows. Billboard cards face the sun in this pass.
 * @param {{ billboard?: boolean }} [opts]
 */
export function createWindDepthMaterial({ billboard = false } = {}) {
  const m = new THREE.MeshDepthMaterial();
  const defines = billboard ? '#define FOLIAGE_BILLBOARD\n#define FOLIAGE_SHADOW_PASS\n' : '';
  m.onBeforeCompile = (shader) => bindWindUniforms(shader, defines);
  m.customProgramCacheKey = () => `luminati-wind-depth${billboard ? '-bb' : ''}`;
  return m;
}
