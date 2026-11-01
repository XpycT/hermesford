import * as THREE from 'three';
import { globalUniforms } from '../../render/GlobalUniforms.js';
import { PPU, RENDER_ORDER } from '../../constants.js';
import { FLAME_BODY, GLOW_BODY, fireColors } from './Flame.js';

/**
 * @import { PropFactory, PropResult } from '../Props.js'
 */

/**
 * FlameBatch.js — instanced pixel-art fire: the flames, glow cards and sparks of Vanquish the Evil
 * Dragon's set pieces (props/SetPieces.js `fire`, a `burning` house in props/House.js;
 * docs/contracts/DRAGON_CAMPAIGN.md §6.3, docs/design/SIEGE_AND_FESTIVAL.md). Owner: the siege
 * package.
 *
 * The flames are the engine's own (Flame.js: the same fragment bodies `FLAME_BODY` / `GLOW_BODY`,
 * so a batched flame and a `createFlame` flame of the same size and seed draw the same pixels), but
 * a flame's inputs — base point, width, height, seed, intensity, speed — are per-instance
 * attributes instead of per-material uniforms, so any number of flames share one draw call and one
 * program (their glow cards another). The sparks — the embers rising off a fire, drifting with the
 * wind, cooling from gold to red, twinkling — are instanced too (a third mesh): each spark's whole
 * flight is computed on the GPU from its seed and the time, so a fire needs no particle emitter for
 * them (one draw call less per fire).
 *
 *  - a prop collects its flames and sparks in a `FlameSet` and adds `set.build(f)` to its group: at
 *    most three instanced meshes (flames, glows, sparks) for all of that prop's fire, on the
 *    factory's three shared materials (`flameMaterials(f)`);
 *  - a world merges them (`mergeFlames(factory, results)`): every prop's instanced fire into one
 *    flame mesh, one glow mesh and one spark mesh for the whole level part — a burning village of a
 *    dozen houses and twenty fires is 3 draw calls. A merged prop whose root is hidden (a live
 *    story group that went away: `World.applyStory` hides the prop's root) has its instances
 *    collapsed, checked as the batch is drawn; shown again, they come back.
 *
 * Only these set pieces use it: every other flame (campfire, wall torch, hearth, candle) stays a
 * `createFlame` billboard, so the shipped levels draw and compile exactly as before. The three
 * materials compile at the level's warm-up (they exist from the build on), never mid-game.
 */

/**
 * One flame of a FlameSet, in the prop's local frame.
 * @typedef {object} FlameSpec
 * @property {number} x @property {number} y @property {number} z  the flame's base
 * @property {number} width @property {number} height  world units (the pixel grid follows: 16 px / unit)
 * @property {number} [seed]  the flame's noise phase (any number; folded in the shader)
 * @property {number} [intensity]  colour multiplier (1)
 * @property {number} [speed]  animation speed (1)
 * @property {number} [glow]  glow card size × max(width, height) (0: no glow card)
 * @property {number} [glowIntensity]  (0.55)
 */

/**
 * A spray of sparks of a FlameSet, in the prop's local frame: `count` sparks rising from a disc.
 * @typedef {object} SparkSpec
 * @property {number} x @property {number} y @property {number} z  the disc's centre
 * @property {number} spread  the disc's radius
 * @property {number} height  how high a spark rises in its life
 * @property {number} count
 * @property {number} [seed]
 * @property {number} [size]  a spark's size (0.08)
 * @property {number} [life]  a spark's life in seconds (2.2; each varies ±35 %)
 */

const BASE_FLAME = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const BASE_CARD = new THREE.PlaneGeometry(1, 1);

const FLAME_VERT = /* glsl */ `
uniform float uCameraYaw;
attribute vec3 iCenter;
attribute vec2 iSize;
attribute vec4 iParam;
varying vec2 vUv;
flat varying float vSeed;
flat varying float vIntensity;
flat varying float vSpeed;
flat varying vec2 vPx;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = iParam.x;
  vIntensity = iParam.y;
  vSpeed = iParam.z;
  // the pixel grid of the quad (Flame.js createFlameMaterial: max(4, round(size * PPU)))
  vPx = max( vec2( 4.0 ), floor( iSize * ${PPU.toFixed(1)} + 0.5 ) );
  vec3 wCenter = ( modelMatrix * vec4( iCenter, 1.0 ) ).xyz;
  vec3 right = vec3( cos( uCameraYaw ), 0.0, - sin( uCameraYaw ) );
  vec3 toCam = vec3( sin( uCameraYaw ), 0.0, cos( uCameraYaw ) );
  vec3 wPos = wCenter + right * position.x * iSize.x + vec3( 0.0, 1.0, 0.0 ) * position.y * iSize.y + toCam * iParam.w;
  vec4 mvPosition = viewMatrix * vec4( wPos, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire[ 6 ];
varying vec2 vUv;
flat varying float vSeed;
flat varying float vIntensity;
flat varying float vSpeed;
flat varying vec2 vPx;
#define uSeed vSeed
#define uIntensity vIntensity
#define uSpeed vSpeed
#define uPx vPx
${FLAME_BODY}`;

const GLOW_VERT = /* glsl */ `
uniform float uCameraYaw;
attribute vec3 iCenter;
attribute vec2 iSize;
attribute vec4 iParam;
varying vec2 vUv;
flat varying float vSeed;
flat varying float vIntensity;
flat varying float vBaseV;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = iParam.x;
  vIntensity = iParam.y;
  // iSize: (card size, flame height); the card is centred 0.4 of the flame up (Flame.js createFlame)
  float gs = max( iSize.x, 1e-3 );
  vBaseV = 0.5 - ( iSize.y * 0.4 ) / gs;
  vec3 wCenter = ( modelMatrix * vec4( iCenter + vec3( 0.0, iSize.y * 0.4, 0.0 ), 1.0 ) ).xyz;
  vec3 right = vec3( cos( uCameraYaw ), 0.0, - sin( uCameraYaw ) );
  vec3 toCam = vec3( sin( uCameraYaw ), 0.0, cos( uCameraYaw ) );
  vec3 wPos = wCenter + ( right * position.x + vec3( 0.0, 1.0, 0.0 ) * position.y ) * iSize.x - toCam * 0.05;
  vec4 mvPosition = viewMatrix * vec4( wPos, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uDay;
uniform vec3 uColor;
varying vec2 vUv;
flat varying float vSeed;
flat varying float vIntensity;
flat varying float vBaseV;
#define uSeed vSeed
#define uIntensity vIntensity
#define uBaseV vBaseV
${GLOW_BODY}`;

/**
 * Sparks: iCenter = the disc's centre, iSize = (spread, rise), iParam = (seed, 1 / life, size, –).
 * A spark's start in the disc, its rise (accelerating a little), the wind's drift and a wobble all
 * come from its seed; it shrinks and cools as it rises (vHeat 1 → 0) and starts again.
 */
const SPARK_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uWindStrength;
attribute vec3 iCenter;
attribute vec2 iSize;
attribute vec4 iParam;
varying float vHeat;
flat varying float vTw;
#include <common>
#include <fog_pars_vertex>
float sh( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
void main() {
  float seed = fract( iParam.x * 0.0137 ) * 97.0;
  // (time wrapped: the hash and the phase keep their precision in a long session)
  float t = fract( mod( uTime, 600.0 ) * iParam.y * ( 0.65 + 0.7 * sh( seed + 0.3 ) ) + sh( seed ) );
  float a = sh( seed + 1.7 ) * 6.2831853;
  float r = sqrt( sh( seed + 3.1 ) ) * iSize.x;
  vec3 p = iCenter + vec3( cos( a ) * r, 0.0, sin( a ) * r );
  float rise = iSize.y * ( 0.55 + 0.45 * sh( seed + 5.3 ) );
  p.y += rise * ( t + 0.4 * t * t );
  p.xz += uWind * uWindStrength * ( 0.35 * t * rise );
  p.x += sin( t * 9.0 + seed * 3.0 ) * 0.2 * t;
  p.z += cos( t * 7.0 + seed * 5.0 ) * 0.2 * t;
  float size = iParam.z * ( 1.0 - 0.5 * t ) * step( 1e-4, iSize.y );
  vec4 mvPosition = viewMatrix * ( modelMatrix * vec4( p, 1.0 ) );
  mvPosition.xy += position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vHeat = 1.0 - t;
  vTw = sh( seed + 9.1 );
  #include <fog_vertex>
}
`;

const SPARK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire[ 6 ];
varying float vHeat;
flat varying float vTw;
#include <common>
#include <fog_pars_fragment>
void main() {
  // cooling: white-gold, gold, orange, red; fading out at the end; a twinkle
  vec3 col = vHeat > 0.8 ? uFire[ 4 ] * 1.6 : vHeat > 0.5 ? uFire[ 3 ] * 1.9 : vHeat > 0.22 ? uFire[ 2 ] * 2.0 : uFire[ 1 ] * 2.0;
  float tw = 0.7 + 0.3 * step( 0.5, fract( uTime * 7.0 + vTw * 13.0 ) );
  float k = smoothstep( 0.0, 0.18, vHeat ) * tw;
  if ( k < 0.01 ) discard;
  gl_FragColor = vec4( col * k, 1.0 );
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

/** The batched kinds: their base quad, how far a card reaches past its instance size, render order. */
const KINDS = {
  flame: { base: BASE_FLAME, reach: 0.6, order: 0 },
  glow: { base: BASE_CARD, reach: 0.6, order: RENDER_ORDER.PARTICLES + 5 },
  spark: { base: BASE_CARD, reach: 1.2, order: RENDER_ORDER.PARTICLES + 4 },
};

/**
 * The factory's three shared fire materials (made once per PropFactory, freed with it): the flame
 * (alpha-discard, depth-writing, fogged), the additive glow card and the additive sparks.
 * @param {PropFactory} f
 * @returns {{ flame: THREE.ShaderMaterial, glow: THREE.ShaderMaterial, spark: THREE.ShaderMaterial }}
 */
export function flameMaterials(f) {
  const flame = /** @type {THREE.ShaderMaterial} */ (f._cachedMaterial('siege:flame', () => {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFire: { value: fireColors() } }]);
    uniforms.uTime = globalUniforms.uTime;
    uniforms.uCameraYaw = globalUniforms.uCameraYaw;
    uniforms.uFogStart = globalUniforms.uFogStart;
    return new THREE.ShaderMaterial({
      name: 'luminati:flameBatch', uniforms, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, fog: true, side: THREE.DoubleSide,
    });
  }));
  const glow = /** @type {THREE.ShaderMaterial} */ (f._cachedMaterial('siege:glow', () => {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDay: { value: 0.25 }, uColor: { value: new THREE.Color(0xff8a3a) } }]);
    uniforms.uTime = globalUniforms.uTime;
    uniforms.uCameraYaw = globalUniforms.uCameraYaw;
    uniforms.uNight = globalUniforms.uNight;
    uniforms.uFogStart = globalUniforms.uFogStart;
    return new THREE.ShaderMaterial({
      name: 'luminati:flameBatchGlow', uniforms, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, fog: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }));
  const spark = /** @type {THREE.ShaderMaterial} */ (f._cachedMaterial('siege:spark', () => {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFire: { value: fireColors() } }]);
    uniforms.uTime = globalUniforms.uTime;
    uniforms.uWind = globalUniforms.uWind;
    uniforms.uWindStrength = globalUniforms.uWindStrength;
    uniforms.uFogStart = globalUniforms.uFogStart;
    return new THREE.ShaderMaterial({
      name: 'luminati:flameBatchSparks', uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, fog: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }));
  return { flame, glow, spark };
}

/**
 * An instanced geometry over a base quad (its buffers copied: a disposed geometry frees its
 * attributes on the GPU, so no two geometries may share one) with the per-instance `iCenter`
 * (vec3), `iSize` (vec2) and `iParam` (vec4) arrays; its bounds cover every instance (a card
 * reaches `reach` × its larger size around its centre, and twice that up).
 */
function instancedGeometry(base, centers, sizes, params, count, reach) {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.index.clone());
  g.setAttribute('position', base.attributes.position.clone());
  g.setAttribute('uv', base.attributes.uv.clone());
  g.setAttribute('iCenter', new THREE.InstancedBufferAttribute(centers, 3));
  g.setAttribute('iSize', new THREE.InstancedBufferAttribute(sizes, 2));
  g.setAttribute('iParam', new THREE.InstancedBufferAttribute(params, 4));
  g.instanceCount = count;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const r = Math.max(sizes[i * 2], sizes[i * 2 + 1]) * reach;
    p.fromArray(centers, i * 3);
    box.expandByPoint(p.set(p.x - r, p.y - 0.1, p.z - r));
    p.fromArray(centers, i * 3);
    box.expandByPoint(p.set(p.x + r, p.y + r * 2, p.z + r));
  }
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return g;
}

/** An instanced mesh of one batched kind on its material. */
function instancedMesh(kind, material, centers, sizes, params, count, name) {
  const K = KINDS[kind];
  const mesh = new THREE.Mesh(instancedGeometry(K.base, centers, sizes, params, count, K.reach), material);
  mesh.name = name;
  mesh.userData.flameBatch = kind;
  mesh.renderOrder = K.order;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * The flames and sparks of one prop, collected while it is built and turned into its instanced
 * meshes.
 */
export class FlameSet {
  constructor() {
    /** @type {FlameSpec[]} */
    this.flames = [];
    /** @type {SparkSpec[]} */
    this.sparks = [];
  }

  /** Add a flame (prop-local base point). @param {FlameSpec} spec @returns {this} */
  add(spec) {
    this.flames.push(spec);
    return this;
  }

  /** Add a spray of sparks (prop-local disc centre). @param {SparkSpec} spec @returns {this} */
  spark(spec) {
    if (spec.count > 0) this.sparks.push(spec);
    return this;
  }

  /** How many flames. */
  get count() { return this.flames.length; }

  /**
   * The prop's fire as a group of (at most) three instanced meshes — flames, glow cards, sparks — on
   * the factory's shared materials, their geometries tracked for disposal (`f.track`); null without
   * any. Add it to the prop's group (placed at its origin: the specs are in the group's frame).
   * @param {PropFactory} f
   * @returns {THREE.Group|null}
   */
  build(f) {
    const glows = this.flames.filter((s) => (s.glow ?? 0) > 0);
    let ns = 0;
    for (const s of this.sparks) ns += Math.round(s.count);
    if (!this.flames.length && !ns) return null;
    const mats = flameMaterials(f);
    const group = new THREE.Group();
    group.name = 'flames';
    const geos = [];
    const add = (mesh) => {
      group.add(mesh);
      geos.push(mesh.geometry);
    };
    if (this.flames.length) {
      const n = this.flames.length;
      const c = new Float32Array(n * 3);
      const z = new Float32Array(n * 2);
      const p = new Float32Array(n * 4);
      this.flames.forEach((s, i) => {
        c.set([s.x, s.y, s.z], i * 3);
        z.set([s.width, s.height], i * 2);
        p.set([s.seed ?? 0, s.intensity ?? 1, s.speed ?? 1, 0.02], i * 4);
      });
      add(instancedMesh('flame', mats.flame, c, z, p, n, 'flames:body'));
    }
    if (glows.length) {
      const n = glows.length;
      const c = new Float32Array(n * 3);
      const z = new Float32Array(n * 2);
      const p = new Float32Array(n * 4);
      glows.forEach((s, i) => {
        c.set([s.x, s.y, s.z], i * 3);
        z.set([Math.max(s.width, s.height) * (s.glow ?? 0), s.height], i * 2);
        p.set([s.seed ?? 0, s.glowIntensity ?? 0.55, 0, 0], i * 4);
      });
      add(instancedMesh('glow', mats.glow, c, z, p, n, 'flames:glow'));
    }
    if (ns) {
      const c = new Float32Array(ns * 3);
      const z = new Float32Array(ns * 2);
      const p = new Float32Array(ns * 4);
      let i = 0;
      for (const s of this.sparks) {
        const life = Math.max(0.3, s.life ?? 2.2);
        for (let k = 0; k < Math.round(s.count); k++, i++) {
          c.set([s.x, s.y, s.z], i * 3);
          z.set([s.spread, s.height], i * 2);
          p.set([(s.seed ?? 0) * 31.7 + k * 7.13, 1 / life, s.size ?? 0.08, 0], i * 4);
        }
      }
      add(instancedMesh('spark', mats.spark, c, z, p, ns, 'flames:sparks'));
    }
    f.track(geos);
    return group;
  }
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/**
 * Merge the instanced fire of many props (their `FlameSet` meshes) into one mesh per kind and
 * material — flames, glow cards, sparks: the whole level part's fires in three draw calls. Call
 * once the props are built and placed (the merged positions are relative to each prop root's
 * parent, as in `PropFactory.mergeStatic`); add the returned `object` to that parent. The props'
 * own fire meshes leave their groups and their geometries are freed. A prop whose root is hidden
 * (`visible` false: a live story group that went away) has its instances collapsed while it stays
 * hidden — the batch checks as it is drawn (a change shows from the next frame).
 * @param {PropFactory} factory the factory that built the props (its tracked geometries are released)
 * @param {(PropResult|THREE.Object3D)[]} results
 * @param {{ name?: string }} [opts]
 * @returns {{ object: THREE.Group, meshes: THREE.Mesh[], count: number, sparks: number, dispose: () => void }|null}
 *   null when no prop has batched fire; `count`: the flames merged, `sparks`: the sparks
 */
export function mergeFlames(factory, results, { name = 'flames:merged' } = {}) {
  /** @type {Map<THREE.Material, { kind: keyof typeof KINDS, src: { mesh: THREE.Mesh, owner: THREE.Object3D, rel: THREE.Matrix4|null }[] }>} */
  const byMat = new Map();
  for (const r of results) {
    const root = /** @type {THREE.Object3D} */ (/** @type {PropResult} */ (r)?.object ?? r);
    if (!root?.isObject3D) continue;
    let rel = null;
    root.traverse((o) => {
      const mesh = /** @type {THREE.Mesh} */ (o);
      if (!mesh.isMesh || !mesh.userData.flameBatch) return;
      if (!rel) {
        root.updateWorldMatrix(true, true);
        rel = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : null;
      }
      const mat = /** @type {THREE.Material} */ (mesh.material);
      let e = byMat.get(mat);
      if (!e) byMat.set(mat, e = { kind: mesh.userData.flameBatch, src: [] });
      e.src.push({ mesh, owner: root, rel });
    });
  }
  if (!byMat.size) return null;
  const object = new THREE.Group();
  object.name = name;
  /** @type {THREE.Mesh[]} */
  const meshes = [];
  /** @type {{ owner: THREE.Object3D, visible: boolean, ranges: { attr: THREE.InstancedBufferAttribute, start: number, count: number, sizes: Float32Array }[] }[]} */
  const owners = [];
  const ownerOf = new Map();
  let flames = 0;
  let sparks = 0;
  for (const [material, e] of byMat) {
    let n = 0;
    for (const s of e.src) n += /** @type {THREE.InstancedBufferGeometry} */ (s.mesh.geometry).instanceCount;
    const centers = new Float32Array(n * 3);
    const sizes = new Float32Array(n * 2);
    const params = new Float32Array(n * 4);
    const spans = [];
    let k = 0;
    for (const s of e.src) {
      const g = /** @type {THREE.InstancedBufferGeometry} */ (s.mesh.geometry);
      const c = /** @type {THREE.InstancedBufferAttribute} */ (g.getAttribute('iCenter')).array;
      const z = /** @type {THREE.InstancedBufferAttribute} */ (g.getAttribute('iSize')).array;
      const p = /** @type {THREE.InstancedBufferAttribute} */ (g.getAttribute('iParam')).array;
      _m.copy(s.mesh.matrixWorld);
      if (s.rel) _m.premultiply(s.rel);
      for (let i = 0; i < g.instanceCount; i++) {
        _v.fromArray(c, i * 3).applyMatrix4(_m).toArray(centers, (k + i) * 3);
        sizes[(k + i) * 2] = z[i * 2];
        sizes[(k + i) * 2 + 1] = z[i * 2 + 1];
        for (let q = 0; q < 4; q++) params[(k + i) * 4 + q] = p[i * 4 + q];
      }
      spans.push({ owner: s.owner, start: k, count: g.instanceCount });
      k += g.instanceCount;
      s.mesh.removeFromParent();
      g.dispose();
      factory._geometries.delete(g);
    }
    const mesh = instancedMesh(e.kind, material, centers, sizes, params, n, `${name}:${e.kind}`);
    mesh.matrixAutoUpdate = false;
    delete mesh.userData.flameBatch;
    if (e.kind === 'flame') flames += n;
    else if (e.kind === 'spark') sparks += n;
    const attr = /** @type {THREE.InstancedBufferAttribute} */ (mesh.geometry.getAttribute('iSize'));
    for (const sp of spans) {
      let o = ownerOf.get(sp.owner);
      if (!o) {
        o = { owner: sp.owner, visible: true, ranges: [] };
        ownerOf.set(sp.owner, o);
        owners.push(o);
      }
      o.ranges.push({ attr, start: sp.start, count: sp.count, sizes: sizes.slice(sp.start * 2, (sp.start + sp.count) * 2) });
    }
    meshes.push(mesh);
    object.add(mesh);
  }
  // a hidden prop root collapses its instances (checked as the batch draws)
  const sync = () => {
    for (const o of owners) {
      const vis = o.owner.visible;
      if (vis === o.visible) continue;
      o.visible = vis;
      for (const r of o.ranges) {
        const a = /** @type {Float32Array} */ (r.attr.array);
        if (vis) a.set(r.sizes, r.start * 2);
        else a.fill(0, r.start * 2, (r.start + r.count) * 2);
        r.attr.addUpdateRange(r.start * 2, r.count * 2);
        r.attr.needsUpdate = true;
      }
    }
  };
  sync();
  for (const m of meshes) m.onBeforeRender = sync;
  return {
    object,
    meshes,
    count: flames,
    sparks,
    dispose: () => {
      for (const m of meshes) m.geometry.dispose();
      object.removeFromParent();
    },
  };
}
