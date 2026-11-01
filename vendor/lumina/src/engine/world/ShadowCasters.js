import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kdSplit, triangleCount, cullByBox, groupByTag, taggedRanges } from './SpatialSplit.js';
import { runSteps } from '../utils/steps.js';

/**
 * Shadow-caster proxies for big levels. The shadow pass only needs depth, and three.js renders
 * every opaque, non-alpha-tested material with the same depth material (per face side) — so the
 * casting geometry of many materials can be merged into a few position-only meshes per region
 * that draw in the shadow pass only, while the per-material meshes stop casting. Shadows are the
 * same; the shadow pass issues a handful of draw calls instead of one per material and region.
 *
 * Also `primeShadowPrograms`: the shadow pass's depth programs of every caster kind, compiled at
 * load instead of when such a caster first comes near (KNOWN_ISSUES REN-13).
 */

/**
 * @import { SceneNode } from '../render/types.js'
 * @import { TaggedRange } from './SpatialSplit.js'
 */

/**
 * Can this mesh's shadow be drawn by a merged proxy? (casts, one material, no custom depth
 * material, no alpha test / displacement / alpha-to-coverage / shadow clipping.)
 * @param {THREE.Mesh & { isInstancedMesh?: boolean }} mesh any mesh (an InstancedMesh answers
 *   false)
 */
export function isProxyCaster(mesh) {
  if (!mesh?.isMesh || !mesh.castShadow || mesh.isInstancedMesh || mesh.customDepthMaterial) return false;
  /**
   * @type {THREE.Material[] | THREE.Material & { isShaderMaterial?: boolean,
   *   map?: THREE.Texture|null, alphaMap?: THREE.Texture|null, displacementMap?: THREE.Texture|null,
   *   displacementScale?: number }}
   */
  const m = mesh.material;
  if (!m || Array.isArray(m) || m.isShaderMaterial) return false;
  if (m.alphaTest > 0 && (m.map || m.alphaMap)) return false;
  if ((m.displacementMap && m.displacementScale !== 0) || m.alphaToCoverage || m.clipShadows) return false;
  return true;
}

/**
 * Let `mesh` render only in the shadow passes of `lights` (its frustum test fails for every
 * other frustum, e.g. the camera's). Works with three.js r16x+ `Object3D.intersectsFrustum`.
 * @param {THREE.Mesh} mesh
 * @param {THREE.Light[]} lights shadow-casting lights
 */
export function makeShadowOnly(mesh, lights) {
  mesh.frustumCulled = true;
  mesh.intersectsFrustum = function intersectsShadowFrustum(frustum) {
    return isShadowFrustum(lights, frustum) && frustum.intersectsObject(this);
  };
  return mesh;
}

/** Is `frustum` the shadow frustum of one of `lights`? */
export function isShadowFrustum(lights, frustum) {
  for (let i = 0; i < lights.length; i++) if (lights[i].shadow?.getFrustum?.() === frustum) return true;
  return false;
}

const _sphere = new THREE.Sphere();

/**
 * Merge world-space casting geometry into shadow-only proxy meshes: grouped by the depth pass's
 * face side (and index layout), cut into spatially compact pieces (≤ maxTriangles, spanning
 * ≤ maxExtent units — SpatialSplit.kdSplit over each piece's centre).
 *
 * A piece may carry a `tag` (a live story group): within each proxy the pieces of one tag are
 * merged next to each other (SpatialSplit.groupByTag; the split is the same as without tags), and
 * `ranges` reports their vertices (`position`), for SpatialSplit.CollapsibleRanges to hide them.
 * @param {{ geometry: THREE.BufferGeometry, side?: number, tag?: any }[]} pieces world-space
 *   geometries (only their positions / index are read; they are not modified or kept)
 * @param {{ lights: THREE.Light[], maxTriangles?: number, maxExtent?: number, name?: string }} opts
 * @returns {{ object: THREE.Group, meshes: THREE.Mesh[], ranges: TaggedRange[], dispose(): void }}
 *   ranges: the tagged pieces' vertices in the proxies ([] without tags)
 */
export function buildShadowCasters(pieces, opts) {
  return runSteps(shadowCasterSteps(pieces, opts));
}

/**
 * {@link buildShadowCasters} as a step generator (src/engine/utils/steps.js): a step per proxy
 * merged. Run to its end it returns what buildShadowCasters returns.
 * @param {Parameters<typeof buildShadowCasters>[0]} pieces
 * @param {Parameters<typeof buildShadowCasters>[1]} opts
 * @returns {Generator<undefined, ReturnType<typeof buildShadowCasters>>}
 */
export function* shadowCasterSteps(pieces, { lights, maxTriangles = 64000, maxExtent = 48, name = 'shadowCasters' }) {
  const group = new THREE.Group();
  group.name = name;
  const meshes = [];
  /** @type {TaggedRange[]} */
  const ranges = [];
  const materials = new Map();
  const byKey = new Map();
  let tagged = false;
  for (const p of pieces) {
    const g = p.geometry;
    if (!g?.attributes?.position || !triangleCount(g)) continue;
    const side = p.side ?? THREE.FrontSide;
    const key = `${side}|${g.index ? 1 : 0}`;
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    if (!g.boundingSphere) g.computeBoundingSphere();
    _sphere.copy(g.boundingSphere);
    const tag = p.tag ?? null;
    if (tag !== null) tagged = true;
    list.push({ g, side, tag, x: _sphere.center.x, z: _sphere.center.z, tris: triangleCount(g) });
  }
  for (const list of byKey.values()) {
    let parts = kdSplit(list, { x: (p) => p.x, z: (p) => p.z, weight: (p) => p.tris, maxWeight: maxTriangles, maxExtent });
    if (tagged) parts = parts.map((part) => groupByTag(part, (p) => p.tag));
    for (const part of parts) {
      // position-only copies (the depth pass reads nothing else)
      const geos = part.map(({ g }) => {
        const c = new THREE.BufferGeometry();
        c.setAttribute('position', g.getAttribute('position'));
        if (g.index) c.setIndex(g.index);
        return c;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const side = part[0].side;
      let mat = materials.get(side);
      if (!mat) {
        // never drawn in a colour pass; the shadow pass derives its depth material from `side`
        mat = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false });
        mat.name = `${name}:proxy`;
        materials.set(side, mat);
      }
      if (tagged) ranges.push(...taggedRanges(merged, part.map((p) => p.g.attributes.position.count), part.map((p) => p.tag), ['position']));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}#${meshes.length}`;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      // shadow pass only, culled by its box (tighter than a sphere for spread-out geometry)
      cullByBox(mesh, { only: (f) => isShadowFrustum(lights, f) });
      group.add(mesh);
      meshes.push(mesh);
      yield;
    }
  }
  return {
    object: group,
    meshes,
    ranges,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials.values()) m.dispose();
      group.removeFromParent();
    },
  };
}

/** The depth pass's face side per material side (three.js WebGLShadowMap). */
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
/** Where the primer proxies stand (far below any world; the shadow pass clips what it draws there). */
const PRIMER_AT = new THREE.Vector3(0, -1000, 0);

/**
 * @typedef {THREE.Material & { map?: THREE.Texture|null, alphaMap?: THREE.Texture|null,
 *   displacementMap?: THREE.Texture|null, displacementScale?: number, wireframe?: boolean }} CasterMaterial
 * @typedef {SceneNode & { isBatchedMesh?: boolean, isLineSegments?: boolean, isLineLoop?: boolean,
 *   instanceColor?: THREE.InstancedBufferAttribute|null, morphTexture?: THREE.DataTexture|null,
 *   count?: number }} CasterNode
 */

/**
 * Compile the shadow pass's depth programs of every caster under `root` now (KNOWN_ISSUES
 * REN-13). `compileAsync` builds main-pass programs only; three.js builds a caster's depth program
 * the first time a caster of its kind is drawn into the shadow map — when one first comes within
 * the sun's shadow frustum, a synchronous compile in the middle of play. This makes one proxy per
 * depth-program variant (what WebGLShadowMap derives the depth material from: the mesh's
 * `customDepthMaterial`, else the material's face side, or for a material with map / alpha map +
 * alpha test, displacement or alpha-to-coverage the material itself; the object kind — mesh,
 * instanced with or without instance colours, points, lines — and the geometry's attributes): the
 * caster of that variant with the smallest geometry, sharing its geometry, material(s) and custom
 * depth material (an instanced caster as a one-instance copy), 1000 units below the world and drawn
 * by the shadow pass of `lights` only — whatever the shadow frustum, never in a colour pass. Add
 * `object` to the scene for the frames that draw the shadow map once (a warm-up behind the loading
 * screen), then `dispose()`: the programs stay compiled (three.js keeps the depth materials of the
 * real casters). Skinned and batched meshes are left out.
 * @param {THREE.Object3D} root the scene (its casters now: call it once the level is complete)
 * @param {{ lights: THREE.Light[] }} opts the shadow-casting lights
 * @returns {{ object: THREE.Group, count: number, dispose(): void }} count: proxies (variants)
 */
export function primeShadowPrograms(root, { lights }) {
  /** @type {Map<string, { o: CasterNode, size: number }>} variant → its smallest caster */
  const best = new Map();
  root.traverse((/** @type {CasterNode} */ o) => {
    if (!(o.isMesh || o.isPoints || o.isLine) || !o.castShadow || !o.geometry) return;
    if (o.isSkinnedMesh || o.isBatchedMesh) return;
    const g = o.geometry;
    const dm = o.customDepthMaterial;
    const mats = /** @type {(CasterMaterial|undefined)[]} */ ([].concat(o.material));
    if (!mats.some((m) => m && m.visible)) return; // (the shadow pass draws nothing of it)
    let key = o.isInstancedMesh ? `I${o.instanceColor ? 'c' : ''}${o.morphTexture ? 'm' : ''}`
      : o.isPoints ? 'P' : o.isLine ? `L${o.isLineSegments ? 's' : o.isLineLoop ? 'l' : ''}` : 'M';
    key += `|${Object.keys(g.attributes).sort().join(',')}|${Object.keys(g.morphAttributes).sort().join(',')}`;
    for (const m of mats) {
      if (!m || !m.visible) { key += '|-'; continue; }
      const own = !!((m.displacementMap && m.displacementScale !== 0) || (m.alphaMap && m.alphaTest > 0)
        || (m.map && m.alphaTest > 0) || m.alphaToCoverage || m.clipShadows);
      // a custom depth material takes the mesh material's map / alpha test / side, and a material
      // with its own variant gets a depth material of its own: both per material; the rest share
      // three's depth material per face side
      key += dm || own ? `|${dm ? dm.uuid : ''}:${m.uuid}` : `|${m.shadowSide ?? SHADOW_SIDE[m.side]}:${m.wireframe ? 1 : 0}`;
    }
    const n = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    // (an InstancedBufferGeometry draws `instanceCount` copies; the instanced proxy draws one)
    const copies = /** @type {THREE.InstancedBufferGeometry} */ (g).instanceCount;
    const size = o.isInstancedMesh ? n : n * Math.max(1, Number.isFinite(copies) ? copies : 1);
    const had = best.get(key);
    if (!had || size < had.size) best.set(key, { o, size });
  });

  const group = new THREE.Group();
  group.name = 'shadowPrimer';
  group.position.copy(PRIMER_AT);
  /** @type {THREE.Object3D[]} */
  const proxies = [];
  const shadowOnly = (/** @type {THREE.Frustum} */ f) => isShadowFrustum(lights, f);
  for (const { o } of best.values()) {
    /** @type {CasterNode} */
    let p;
    if (o.isInstancedMesh) {
      const im = new THREE.InstancedMesh(o.geometry, o.material, 1);
      if (o.instanceColor) im.setColorAt(0, new THREE.Color(1, 1, 1));
      if (o.morphTexture) im.morphTexture = o.morphTexture;
      p = im;
    } else if (o.isPoints) p = new THREE.Points(o.geometry, o.material);
    else if (o.isLineSegments) p = new THREE.LineSegments(o.geometry, o.material);
    else if (o.isLineLoop) p = new THREE.LineLoop(o.geometry, o.material);
    else if (o.isLine) p = new THREE.Line(o.geometry, o.material);
    else p = new THREE.Mesh(o.geometry, o.material);
    p.name = `shadowPrimer:${o.name}`;
    if (o.customDepthMaterial) p.customDepthMaterial = o.customDepthMaterial;
    if (o.customDistanceMaterial) p.customDistanceMaterial = o.customDistanceMaterial;
    p.castShadow = true;
    p.receiveShadow = false;
    // drawn by the shadow pass whatever its frustum (and so never culled by it), by no other pass
    p.frustumCulled = true;
    p.intersectsFrustum = shadowOnly;
    group.add(p);
    proxies.push(p);
  }
  return {
    object: group,
    count: proxies.length,
    dispose() {
      group.removeFromParent();
      for (const p of proxies) {
        const im = /** @type {CasterNode} */ (p);
        if (!im.isInstancedMesh) continue;
        im.morphTexture = null; // (shared with the real caster: InstancedMesh.dispose would dispose it)
        im.dispose(); // frees the proxy's own instance buffers
      }
      proxies.length = 0;
    },
  };
}
