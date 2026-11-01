/**
 * Snow cover: a shared 0..1 uniform that whitens up-facing ground (terrain tops, grass fringes,
 * the outer hills), frosts the tips of the grass / flower / bush sprites and dusts the roofs.
 * Driven by the weather (it builds up over ~15 s of snowfall and melts when it stops).
 *
 * Implemented as an extra `onBeforeCompile` step chained after each material's own patch, with a
 * distinct program cache key, so the programs are built once at load (the uniform is always
 * there; 0 = no snow) and toggling the weather never compiles anything.
 */

/**
 * @import * as THREE from 'three'
 * @import { SceneNode } from '../engine/render/types.js'
 */

/** Shared uniform object (0 = no snow … 1 = full cover). */
export const snowCover = { value: 0 };

/**
 * The frozen year's kit (src/game/thaw/ThawKit.js, a chunk of its own: the thaw variant of these
 * patches, the ice, the frozen falls — EVERMERE_CAMPAIGN.md §6.1): loaded by World for a level with
 * `environment.frost` (and by the editor's preview); null until then — no other level loads it.
 * @type {typeof import('./thaw/ThawKit.js')|null}
 */
let kit = null;
/** The thaw kit, loaded (once). @returns {Promise<typeof import('./thaw/ThawKit.js')>} */
export const loadThawKit = async () => (kit ??= await import('./thaw/ThawKit.js'));
/** The thaw kit if loaded, else null. */
export const thawKit = () => kit;

// Linear-space snow colour (a cool white), slightly shaded by the texel's own brightness so the
// pixel texture still reads under the snow; up-facing (world normal) surfaces only.
// (exported: the thaw kit swaps these blocks for its own)
export const GROUND_GLSL = /* glsl */ `
	{
		vec3 snowN = inverseTransformDirection( normal, viewMatrix );
		float snowUp = smoothstep( 0.5, 0.86, snowN.y );
		float snowL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
		float snowK = uSnowCover * snowUp * ( 0.7 + 0.25 * smoothstep( 0.02, 0.2, snowL ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.8, 0.84, 0.92 ) * ( 0.82 + 0.3 * smoothstep( 0.0, 0.3, snowL ) ), snowK );
	}
`;

// Sprites (upright quads): frost the upper part of each blade / flower / bush.
export const FOLIAGE_GLSL = /* glsl */ `
	{
		float snowL = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
		float snowK = uSnowCover * smoothstep( 0.2, 0.95, vQuadUv.y ) * 0.72;
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.83, 0.9 ) * ( 0.7 + 0.6 * sqrt( snowL ) ), snowK );
	}
`;

/**
 * Chain the snow patch onto a material.
 * @param {THREE.Material} material
 * @param {'ground'|'foliage'} kind
 */
export function addSnowCover(material, kind = 'ground') {
  if (!material || material.userData.luminatiSnow) return;
  material.userData.luminatiSnow = kind;
  const prev = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = function onBeforeCompileSnow(shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uSnowCover = snowCover;
    const glsl = kind === 'foliage' ? FOLIAGE_GLSL : GROUND_GLSL;
    // before emissivemap_fragment: `normal` (view space, normal-mapped) and the final albedo
    // (map + vertex colours + any variation patch) are both available there
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowCover;')
      .replace('#include <emissivemap_fragment>', `${glsl}\n#include <emissivemap_fragment>`);
  };
  material.customProgramCacheKey = () => `${baseKey}|luminati-snow-${kind}`;
  material.needsUpdate = true;
}

/** Roof materials (TextureLibrary `luminati:roof*`) carry the ground patch: snow settles on roofs. */
export const ROOF_MATERIAL = /^luminati:roof/;

/**
 * Chain the ground patch onto the material of every mesh under `root` (terrain), or — with
 * `roofsOnly` — onto its roof materials (props). Already patched materials are skipped, so this
 * is cheap to repeat on a group that gained a few new meshes.
 * @param {THREE.Object3D} root
 * @param {{ roofsOnly?: boolean }} [opts]
 */
export function addGroundSnowCover(root, { roofsOnly = false } = {}) {
  root?.traverse((/** @type {SceneNode} */ o) => {
    const m = o.isMesh ? o.material : null;
    if (!m || Array.isArray(m) || m.userData.luminatiSnow) return;
    if (roofsOnly && !ROOF_MATERIAL.test(m.name ?? '')) return;
    addSnowCover(m, 'ground');
  });
}
