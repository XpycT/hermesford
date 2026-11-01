import * as THREE from 'three';
import { globalUniforms } from '../engine/render/GlobalUniforms.js';

const TAG = '/* emberfall:fog-start */';

/**
 * Aerial perspective for the diorama: shifts where the scene fog *begins* so the band around the
 * player stays crisp and saturated while everything beyond melts into the horizon colour.
 *
 * three's `fog_vertex` chunk writes the eye-space depth used by FogExp2 / Fog; replacing it with
 * `max(0, depth - uFogStart.x)` offsets the fog curve for every material that uses the standard
 * chunks (terrain, props, sprites, foliage, water, waterfalls, god rays, flames, particles — the
 * particle shader includes the same chunk, so leaves and petals near the player are not washed
 * toward the fog colour). Must be installed before the first material compiles; installed once per
 * page (later calls only set the start).
 *
 * The start is a uniform, `globalUniforms.uFogStart` (`setFogStart`), not a constant in the chunk,
 * so each level of a campaign fogs from its own camera distance and a change compiles nothing. It
 * reaches three's built-in materials through their `ShaderLib` uniforms (each material copies them
 * when it compiles; the copy shares the uniform's Float32Array — see GlobalUniforms.js), and any
 * ShaderMaterial built from `THREE.UniformsLib.fog` after this call; the engine's fogged
 * ShaderMaterials reference `globalUniforms.uFogStart` themselves.
 * @param {number} [start] also set the start (`setFogStart`)
 */
export function installFogStart(start) {
  if (start !== undefined) setFogStart(start);
  if (THREE.ShaderChunk.fog_vertex.includes(TAG)) return;
  const uniform = globalUniforms.uFogStart;
  THREE.ShaderChunk.fog_pars_vertex = `${THREE.ShaderChunk.fog_pars_vertex}
#ifdef USE_FOG
	uniform vec2 uFogStart;
#endif
`;
  THREE.ShaderChunk.fog_vertex = `${TAG}
#ifdef USE_FOG
	vFogDepth = max( 0.0, - mvPosition.z - uFogStart.x );
#endif
`;
  for (const shader of Object.values(THREE.ShaderLib)) {
    if ('fogDensity' in shader.uniforms) shader.uniforms.uFogStart = uniform;
  }
  Object.assign(THREE.UniformsLib.fog, { uFogStart: uniform });
  // the built-in materials follow a change only while three's per-material copy keeps typed arrays
  if (THREE.UniformsUtils.clone({ uniform }).uniform.value !== uniform.value) {
    console.warn('[Luminati] three.js copies typed-array uniforms: built-in materials keep the fog start they compiled with');
  }
}

/**
 * Where the fog starts: the distance from the camera (world units); 0 = at the camera, three's own
 * fog. Takes effect in the next frame, in every program (nothing compiles).
 * @param {number} start
 */
export function setFogStart(start) {
  globalUniforms.uFogStart.value[0] = Number.isFinite(start) ? start : 0;
}
