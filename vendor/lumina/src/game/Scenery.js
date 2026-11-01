import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, clamp, lerp, smoothstep, fbm2, hash2 } from '../engine/utils/math.js';
import { kdSplit, triangleCount, groupByTag, taggedRanges } from '../engine/world/SpatialSplit.js';
import { runSteps } from '../engine/utils/steps.js';
import { seasonKit } from '../engine/world/SeasonKit.js';

/**
 * @import { TextureLibrary } from '../engine/pixel/Textures.js'
 * @import { TileMap } from '../engine/world/TileMap.js'
 * @import { PropResult, PropFactory } from '../engine/world/Props.js'
 * @import { LevelEnvironment } from '../engine/level/types.js'
 * @import { SolidMesh, SceneNode } from '../engine/render/types.js'
 * @import { TaggedRange } from '../engine/world/SpatialSplit.js'
 */

/**
 * Scenery — everything that makes the diorama read as part of a continuous world rather than a
 * floating island:
 *  - `mergeTrees()` batches many PropFactory trees (wind-swayed, billboard canopies) into one mesh
 *    per material, fixing up the per-vertex wind attributes so they still sway correctly;
 *  - `buildOuterGround()` a large fogged heightfield around the map (hole = the map) that
 *    continues the edge heights, rolls into hills and rises into mountains in the north;
 *  - `scatterForest()` deterministic tree placement for the non-walkable border and the outer
 *    ground (clusters thinning out with distance); `sceneryProp()` builds one of its entries.
 *
 * A level's climate (`environment.climate`, LevelLook.climateOf; docs/design/ARID_LOOK.md §7) is
 * passed to `scatterForest`, `makeOuterHeight` and `outerGroundSteps` as `climate`: 'arid' grows
 * junipers, dead trees and small rock spires instead of the forest, raises tall bare mountains in
 * the north and mesas around, and lays the outer ground in arid dirt; absent, everything is as
 * before (the same random sequences, the same meshes). Likewise a level's season
 * (`environment.season`, LevelLook.seasonOf; docs/design/SEASONS_LOOK.md §6) as `season`: its
 * forest mix (blossom, maple and golden birch, snow-laden pines and bare trees — at the temperate
 * scatter's positions), its outer ground (texture and tints) and relief — the season kit's
 * `SEASON_LAND` (`mix`, `outer`, `relief`: src/engine/world/props/SeasonTrees.js), loaded with the
 * season: in summer limestone headlands rising where the map's edge is water (a cove, never an open
 * sea), in winter ridged foothills and sharper crests.
 */

const _v = new THREE.Vector3();

/**
 * What places a tree vertex in the vertex shader (props/Wind.js: the position, the billboard
 * pivot, the sway weight and phase): a collapsed range writes all of them.
 */
const TREE_PLACING = ['position', 'aCenter', 'aSway', 'aPhase'];

/**
 * Merge the meshes of many tree PropResults into one mesh per (material, shadow flags).
 *
 * PropFactory.mergeStatic() skips wind materials because their vertex shader derives the sway
 * phase from the model matrix and billboards cards around the per-vertex `aCenter` (object
 * space). Here the geometry is baked to world space: `aCenter` is transformed with the mesh's
 * world matrix while each card keeps its authored offset from it (× the tree's scale — not turned
 * with the tree's yaw, or the shader would show the card edge-on; KNOWN_ISSUES PROP-21), and a
 * per-tree phase offset is folded into `aPhase`, so an identity model matrix gives exactly the same
 * billboarding and still de-synchronised sway.
 *
 * Big levels: `maxTriangles` / `maxExtent` (above `minTriangles`) cut a material's batch into
 * spatially compact pieces (by tree position, SpatialSplit.kdSplit), so the camera and the shadow
 * pass cull what they can't see. Default: one mesh per material.
 *
 * `tags` (Map result → tag; the game's live story groups): as in PropFactory.mergeStatic — the
 * same batches, a tag's vertices next to each other in each, reported in `ranges` with the
 * attributes that place a tree vertex (`position`, `aCenter`, `aSway`, `aPhase`: a collapse must
 * write them all, or the sway would pull a collapsed triangle open).
 * @param {PropResult[]} results
 * @param {{ name?: string, castShadow?: boolean, maxTriangles?: number, maxExtent?: number, minTriangles?: number,
 *   tags?: Map<PropResult, any>|null }} [opts]
 * @returns {{ object: THREE.Group, meshes: THREE.Mesh[], ranges: TaggedRange[], dispose(): void }}
 *   ranges: the tagged trees' vertices ([] without tags)
 */
export function mergeTrees(results, opts = {}) {
  return runSteps(mergeTreeSteps(results, opts));
}

/**
 * {@link mergeTrees} as a step generator (src/engine/utils/steps.js): a step per tree gathered and
 * per batch merged. Run to its end it returns what mergeTrees returns.
 * @param {PropResult[]} results
 * @param {Parameters<typeof mergeTrees>[1]} [opts]
 * @returns {Generator<undefined, ReturnType<typeof mergeTrees>>}
 */
export function* mergeTreeSteps(results, { name = 'trees', castShadow = true, maxTriangles = Infinity, maxExtent = Infinity, minTriangles = 0, tags = null } = {}) {
  const buckets = new Map();
  const tagged = !!tags?.size;
  /** @type {TaggedRange[]} */
  const ranges = [];
  for (const r of results) {
    const root = r.object;
    const tag = tagged ? (tags.get(r) ?? null) : null;
    root.updateWorldMatrix(true, true);
    const phaseOff = hash2(Math.round(root.position.x * 7), Math.round(root.position.z * 7), 3) * Math.PI * 2;
    root.traverse((/** @type {SceneNode} */ o) => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const m = o.material;
      const cast = castShadow && o.castShadow;
      const key = `${m.uuid}|${+cast}|${+o.receiveShadow}`;
      let bk = buckets.get(key);
      if (!bk) {
        bk = { material: m, castShadow: cast, receiveShadow: o.receiveShadow, depth: o.customDepthMaterial, geos: [], pos: [], tags: [] };
        buckets.set(key, bk);
      }
      const src = o.geometry;
      const g = src.clone();
      const mw = o.matrixWorld;
      g.applyMatrix4(mw);
      const c = g.getAttribute('aCenter');
      if (c) {
        // billboard cards: the pivot goes to world space, the card's offset from it stays as
        // authored (× the model's scale) — the shader turns that offset to the camera, so a card
        // turned with its tree's yaw would show edge-on (as ObjectPreview's bakeGeometry does)
        const c0 = src.getAttribute('aCenter');
        const p0 = src.getAttribute('position');
        const pos = g.getAttribute('position');
        const el = mw.elements;
        const sc = Math.hypot(el[0], el[1], el[2]);
        for (let i = 0; i < c.count; i++) {
          _v.fromBufferAttribute(c0, i).applyMatrix4(mw);
          c.setXYZ(i, _v.x, _v.y, _v.z);
          pos.setXYZ(i, _v.x + (p0.getX(i) - c0.getX(i)) * sc, _v.y + (p0.getY(i) - c0.getY(i)) * sc, _v.z + (p0.getZ(i) - c0.getZ(i)) * sc);
        }
      }
      const ph = g.getAttribute('aPhase');
      if (ph) for (let i = 0; i < ph.count; i++) ph.setX(i, ph.getX(i) + phaseOff);
      bk.geos.push(g);
      bk.pos.push([root.position.x, root.position.z]);
      bk.tags.push(tag);
    });
    // the source geometries are no longer needed (their materials stay shared)
    r.dispose?.();
    yield;
  }
  const group = new THREE.Group();
  group.name = name;
  const meshes = [];
  for (const bk of buckets.values()) {
    const idx = bk.geos.map((_, i) => i);
    let parts = Number.isFinite(maxTriangles) || Number.isFinite(maxExtent)
      ? kdSplit(idx, {
        x: (i) => bk.pos[i][0], z: (i) => bk.pos[i][1], weight: (i) => triangleCount(bk.geos[i]),
        maxWeight: maxTriangles, maxExtent, minWeight: minTriangles,
      })
      : [idx];
    if (tagged) parts = parts.map((part) => groupByTag(part, (i) => bk.tags[i]));
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const g = mergeGeometries(part.map((i) => bk.geos[i]), false);
      if (!g) continue;
      if (tagged) ranges.push(...taggedRanges(g, part.map((i) => bk.geos[i].attributes.position.count), part.map((i) => bk.tags[i]), TREE_PLACING));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      // wind + billboards move vertices on the GPU: pad the culling bounds
      g.boundingSphere.radius += 1.8;
      g.boundingBox.expandByScalar(1.8);
      const mesh = new THREE.Mesh(g, bk.material);
      mesh.name = `${name}:${bk.material.name || 'mat'}${parts.length > 1 ? `#${p}` : ''}`;
      mesh.castShadow = bk.castShadow;
      mesh.receiveShadow = bk.receiveShadow;
      if (bk.depth) mesh.customDepthMaterial = bk.depth;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
      yield;
    }
    for (const x of bk.geos) x.dispose();
  }
  return {
    object: group,
    meshes,
    ranges,
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * Tree kinds the forest scatter plants (and `environment.forest.areas` may mix): the temperate
 * four, then The Bells of Evermere's (the season kit's: a level with one loads it).
 */
export const FOREST_KINDS = Object.freeze(['oak', 'pine', 'birch', 'autumn', 'blossom', 'maple', 'goldbirch', 'snowpine', 'bare']);

/** The pines (taller base heights in the scatter). */
const PINES = new Set(['pine', 'snowpine']);

/**
 * The level's forest kind areas (`environment.forest.areas`): world rects (units = tiles) where the
 * forest border and the outer scenery plant their own mix of tree kinds instead of the automatic
 * one — `{ minX, maxX, minZ, maxZ, kinds: { oak?, pine?, birch?, autumn? } }` (relative weights).
 * Malformed areas and weights are dropped; the result is ready for `scatterForest({ kindAreas })`.
 * @param {Partial<LevelEnvironment>} [env] level.environment
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number, cumulative: [string, number][] }[]}
 */
export function forestKindAreas(env) {
  const list = env?.forest && typeof env.forest === 'object' && Array.isArray(env.forest.areas) ? env.forest.areas : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object' || !['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(a[k]))) continue;
    const kinds = a.kinds && typeof a.kinds === 'object' ? a.kinds : {};
    const weights = FOREST_KINDS.map((k) => [k, Number.isFinite(kinds[k]) && kinds[k] > 0 ? kinds[k] : 0]).filter(([, w]) => w > 0);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    if (!(total > 0)) continue;
    let acc = 0;
    const cumulative = weights.map(([k, w]) => [k, (acc += w / total)]);
    out.push({ minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ, cumulative });
  }
  return out;
}

/**
 * Deterministic tree scatter for the forest border tiles and the outer ground.
 * @param {{ tileMap: TileMap, heightAt: (x:number, z:number) => number,
 *           seed?: number, avoid?: {x:number, z:number, r:number}[], southGap?: number,
 *           kindAreas?: ReturnType<typeof forestKindAreas>, climate?: 'arid'|null,
 *           season?: 'spring'|'summer'|'autumn'|'winter'|null }} ctx
 *   southGap: open ground (world units) south of the map before the outer forest starts — the
 *   camera looks north, so tall trees just beyond the south edge stand between it and a player
 *   near that edge (0 = forest right at the edge).
 *   kindAreas: tree-kind mixes by area (forestKindAreas; first match wins). Positions and the
 *   random sequence are the same with or without them — only the kinds (and so the base heights
 *   of the kinds) change.
 *   climate (LevelLook.climateOf; absent: temperate, the scatter above): 'arid' grows the border
 *   and the outer ground with junipers, dead trees and small rock spires instead, more sparsely
 *   (`aridScatterSteps`; kindAreas do not apply) — entries a `sceneryProp` builds.
 *   season (LevelLook.seasonOf): the season's mix (the kit's `SEASON_LAND.mix`) instead of the
 *   automatic one — the same positions and random sequence; kindAreas still win.
 * @returns {{ border: Array<[string, number, number, number, number]>, outer: Array<[string, number, number, number, number]> }}
 *   entries are [kind, x, y, z, height]; kind a tree kind, or `crag:<stone>` (a small rock spire,
 *   arid only)
 */
export function scatterForest(ctx) {
  return runSteps(scatterForestSteps(ctx));
}

/**
 * {@link scatterForest} as a step generator (src/engine/utils/steps.js): a step per row of border
 * tiles and per 400 outer candidates. Run to its end it returns what scatterForest returns.
 * @param {Parameters<typeof scatterForest>[0]} ctx
 * @returns {Generator<undefined, ReturnType<typeof scatterForest>>}
 */
export function* scatterForestSteps({ tileMap, heightAt, seed = 77, avoid = [], southGap = 0, kindAreas = [], climate = null, season = null }) {
  if (climate === 'arid') return yield* aridScatterSteps({ tileMap, heightAt, seed, avoid, southGap });
  const SL = season ? seasonKit()?.SEASON_LAND : null;
  const mix = SL && Object.hasOwn(SL.mix, season) ? SL.mix[season] : null;
  const W = tileMap.width;
  const D = tileMap.depth;
  const rng = new RNG(seed);
  const border = [];
  const outer = [];
  const taken = [];
  const cell = 1.35;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const free = (x, z, r) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const list = grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
      }
    }
    for (const a of avoid) if ((a.x - x) ** 2 + (a.z - z) ** 2 < (a.r + r) ** 2) return false;
    return true;
  };
  const take = (x, z, r) => {
    const t = { x, z, r };
    taken.push(t);
    const k = key(x, z);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(t);
  };
  const kindFor = (x, z, r) => {
    // the level's own mixes first (environment.forest.areas)
    for (let k = 0; k < kindAreas.length; k++) {
      const a = kindAreas[k];
      if (x < a.minX || x >= a.maxX || z < a.minZ || z >= a.maxZ) continue;
      for (const [kind, c] of a.cumulative) if (r < c) return kind;
      return a.cumulative[a.cumulative.length - 1][0];
    }
    // north (hills): pines dominate; south-east near the grove: autumn; else oak/pine/birch mix
    const north = z < 6;
    const grove = x > W * 0.72 && z > 8;
    const n = fbm2(x * 0.09, z * 0.09, { seed: seed + 5, octaves: 2 });
    // (a season's own mix: the kit's SEASON_LAND.mix)
    if (mix) {
      const list = north ? mix.north : n > 0.55 ? mix.dense : mix.open;
      for (const [kind, c] of list) if (r < c) return kind;
      return list[list.length - 1][0];
    }
    if (north) return r < 0.5 ? 'pine' : r < 0.82 ? 'oak' : 'birch';
    if (grove) return r < 0.5 ? 'autumn' : r < 0.78 ? 'oak' : r < 0.9 ? 'pine' : 'birch';
    if (n > 0.55) return r < 0.6 ? 'pine' : 'oak';
    return r < 0.62 ? 'oak' : r < 0.82 ? 'pine' : r < 0.93 ? 'birch' : 'autumn';
  };

  // --- border: every non-walkable forest tile gets dense trees (jittered, ~0.55 per tile) ------
  const borderTile = (i, j, t) => {
    if (t.char !== 'T') return;
    if (j >= D - 3) return; // south border: shrubs only (tall trees there would hide the meadow)
    const tries = j < 3 ? 1 : 2; // the upper cliffs in the north stay airy
    // East / west sides below the plateau: the camera looks north, so a tall tree in the border
    // column next to the walkable ground stands between it and a player walking along the edge.
    // The inner column stays open (shrubs only) and the next one is a little lower.
    const side = j >= 9 ? Math.min(i, W - 1 - i) : -1; // 2 = inner column, 1 = middle, 0 = outer
    for (let k = 0; k < tries; k++) {
      const x = i + rng.range(0.1, 0.9);
      const z = j + rng.range(0.1, 0.9);
      const r = rng.range(0.85, 1.25);
      if (!free(x, z, r)) continue;
      const kind = kindFor(x, z, rng.next());
      const hBase = PINES.has(kind) ? 5.4 : kind === 'birch' || kind === 'goldbirch' ? 5.2 : 5.0;
      const height = hBase * rng.range(0.85, 1.25) * (side === 1 ? 0.8 : 1);
      if (side === 2) continue;
      take(x, z, r);
      border.push([kind, x, t.h, z, height]);
    }
  };
  // (tileMap.forEachTile's order: row by row, void tiles skipped)
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const t = tileMap.tileAt(i, j);
      if (t) borderTile(i, j, t);
    }
    yield;
  }

  // --- outer ground: clustered, thinning with distance; hills to the north --------------------
  const reach = 34;
  const nearOpenEdge = openEdgeTest(tileMap, OPEN_EDGE_GAP);
  for (let n = 0; n < 5200; n++) {
    if (n % 400 === 399) yield;
    const x = rng.range(-reach, W + reach);
    const z = rng.range(-reach - 10, D + reach * 0.6);
    const dx = Math.max(0, -x, x - W);
    const dz = Math.max(0, -z, z - D);
    const d = Math.hypot(dx, dz);
    if (d < 0.6) continue;
    if (southGap > 0 && z > D && z < D + southGap) continue;
    // open map edges (a borderless map): no tree right past the walkable ground hides the player
    if (d < OPEN_EDGE_GAP && nearOpenEdge?.(x, z)) continue;
    // cluster mask: noise blobs, denser close to the map so the border reads as a deep forest
    const blob = fbm2(x * 0.075 + 11, z * 0.075 - 4, { seed: seed + 2, octaves: 3 });
    const near = 1 - smoothstep(4, 30, d);
    const p = clamp((blob - 0.42) * 2.6 + near * (z < 0 ? 0.35 : 0.75), 0, 1) * (1 - smoothstep(24, reach, d) * 0.85);
    if (rng.next() > p) continue;
    const r = rng.range(0.95, 1.5);
    if (!free(x, z, r)) continue;
    take(x, z, r);
    const kind = kindFor(x, z, rng.next());
    const hBase = PINES.has(kind) ? 5.8 : 5.2;
    outer.push([kind, x, heightAt(x, z), z, hBase * rng.range(0.85, 1.35)]);
  }
  return { border, outer };
}

/** Tree-free margin (world units) outside an open map edge. */
const OPEN_EDGE_GAP = 2.5;

/**
 * Open map edges: runs of 3+ walkable edge tiles (a map without a forest border, a road leaving
 * the map). Single walkable edge tiles (a river bank, a gap in the border) do not count.
 * @returns {((x:number, z:number) => boolean)|null} is (x, z) — outside the map — within `gap` of
 *   an open edge tile? null when the map has no open edge (the scatter is unchanged).
 */
function openEdgeTest(tileMap, gap) {
  const W = tileMap.width;
  const D = tileMap.depth;
  const walk = (i, j) => {
    const t = tileMap.tileAt(i, j);
    return !!t && !t.water && !t.type?.void && (t.type?.walkable ?? true) !== false;
  };
  const open = new Set();
  const scan = (n, at) => {
    let run = [];
    for (let k = 0; k <= n; k++) {
      const c = k < n ? at(k) : null;
      if (c && walk(c[0], c[1])) { run.push(c); continue; }
      if (run.length >= 3) for (const [i, j] of run) open.add(j * W + i);
      run = [];
    }
  };
  scan(W, (i) => [i, 0]);
  scan(W, (i) => [i, D - 1]);
  scan(D, (j) => [0, j]);
  scan(D, (j) => [W - 1, j]);
  if (!open.size) return null;
  return (x, z) => {
    const i0 = Math.max(0, Math.floor(x - gap));
    const i1 = Math.min(W - 1, Math.floor(x + gap));
    const j0 = Math.max(0, Math.floor(z - gap));
    const j1 = Math.min(D - 1, Math.floor(z + gap));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!open.has(j * W + i)) continue;
        const ddx = Math.max(0, i - x, x - (i + 1));
        const ddz = Math.max(0, j - z, z - (j + 1));
        if (ddx * ddx + ddz * ddz < gap * gap) return true;
      }
    }
    return false;
  };
}

/** Base heights of the arid scatter's kinds (`aridScatterSteps`; a crag is a small spire). */
const ARID_HEIGHT = { juniper: 3.4, deadwood: 4.0, crag: 3.4 };

/** A small spire's stone from the ground it stands on (a tile's top texture). */
function spireStone(top) {
  if (top === 'basalt' || top === 'ash' || top === 'scorched') return 'basalt';
  if (top === 'red_sand' || top === 'redrock') return 'redrock';
  return 'sandstone';
}

/**
 * The arid scatter (`scatterForestSteps` with `climate: 'arid'`): the blocked border tiles (`T`)
 * grown with junipers, sun-bleached dead trees and small rock spires (their stone from the tile's
 * top), a little sparser than a forest so the dry ground shows between them; spires and dead wood
 * more often in the north. The outer ground: scattered clumps of the same, thinning out with
 * distance, half as dense as the temperate forest. The same rules as the temperate scatter for the
 * camera (no tall growth in the south rows or the inner side columns, `southGap`, open map edges).
 * @param {{ tileMap: TileMap, heightAt: (x:number, z:number) => number, seed: number,
 *   avoid: {x:number, z:number, r:number}[], southGap: number }} ctx
 * @returns {Generator<undefined, ReturnType<typeof scatterForest>>}
 */
function* aridScatterSteps({ tileMap, heightAt, seed, avoid, southGap }) {
  const W = tileMap.width;
  const D = tileMap.depth;
  const rng = new RNG(seed + 4111);
  /** @type {Array<[string, number, number, number, number]>} */
  const border = [];
  /** @type {Array<[string, number, number, number, number]>} */
  const outer = [];
  const cell = 1.35;
  const grid = new Map();
  const free = (x, z, r) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const list = grid.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + r) ** 2) return false;
      }
    }
    for (const a of avoid) if ((a.x - x) ** 2 + (a.z - z) ** 2 < (a.r + r) ** 2) return false;
    return true;
  };
  const take = (x, z, r) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push({ x, z, r });
  };
  /** @param {boolean} north @param {number} r */
  const kindOf = (north, r) => (north ? (r < 0.24 ? 'crag' : r < 0.6 ? 'deadwood' : 'juniper') : r < 0.56 ? 'juniper' : r < 0.82 ? 'deadwood' : 'crag');
  /** @returns {[string, number, number, number, number]} */
  const entry = (kind, stone, x, y, z, k) => [kind === 'crag' ? `crag:${stone}` : kind, x, y, z, ARID_HEIGHT[kind] * k];

  // --- border: the blocked `T` tiles, ≈ 0.6 plants per tile ----------------------------------
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const t = tileMap.tileAt(i, j);
      if (!t || t.char !== 'T' || j >= D - 3) continue; // the south rows: low growth only
      const side = j >= 9 ? Math.min(i, W - 1 - i) : -1; // 2 = inner column (kept open), 1 = middle
      const tries = j < 3 ? 1 : 2;
      for (let k = 0; k < tries; k++) {
        const x = i + rng.range(0.1, 0.9);
        const z = j + rng.range(0.1, 0.9);
        const r = rng.range(0.95, 1.4);
        const roll = rng.next();
        const size = rng.range(0.7, 1.35) * (side === 1 ? 0.78 : 1);
        if (side === 2 || roll > 0.72 || !free(x, z, r)) continue;
        take(x, z, r);
        border.push(entry(kindOf(j < 6, rng.next()), spireStone(t.type.top), x, t.h, z, size));
      }
    }
    yield;
  }

  // --- outer ground: sparse clumps, thinning with distance -----------------------------------
  const reach = 34;
  const nearOpenEdge = openEdgeTest(tileMap, OPEN_EDGE_GAP);
  for (let n = 0; n < 5200; n++) {
    if (n % 400 === 399) yield;
    const x = rng.range(-reach, W + reach);
    const z = rng.range(-reach - 10, D + reach * 0.6);
    const dx = Math.max(0, -x, x - W);
    const dz = Math.max(0, -z, z - D);
    const d = Math.hypot(dx, dz);
    if (d < 0.6) continue;
    if (southGap > 0 && z > D && z < D + southGap) continue;
    if (d < OPEN_EDGE_GAP && nearOpenEdge?.(x, z)) continue;
    const blob = fbm2(x * 0.08 + 31, z * 0.08 - 9, { seed: seed + 3, octaves: 3 });
    const near = 1 - smoothstep(4, 30, d);
    const p = clamp((blob - 0.48) * 2.2 + near * 0.35, 0, 1) * 0.42 * (1 - smoothstep(22, reach, d) * 0.85);
    if (rng.next() > p) continue;
    const r = rng.range(1.1, 1.7);
    const y = heightAt(x, z);
    const kind = kindOf(z < 0, rng.next());
    const size = rng.range(0.85, 1.4);
    // the mountains' slopes stay bare above their foot: rock spires only, no growth
    if (z < -5 && y > heightAt(x, -1) + 3 && kind !== 'crag') continue;
    if (!free(x, z, r)) continue;
    take(x, z, r);
    const stone = fbm2(x * 0.05, z * 0.05, { seed: seed + 6, octaves: 2 }) > 0.58 ? 'redrock' : 'sandstone';
    outer.push(entry(kind, stone, x, y, z, size));
  }
  return { border, outer };
}

/**
 * Build one entry of a forest scatter (`scatterForest`'s [kind, x, y, z, height]): a tree of that
 * kind, or — `crag:<stone>`, the arid scatter's — a small rock spire of that stone. What the game's
 * World and the editor's SceneryPreview make the border and the outer scenery from.
 * @param {PropFactory} f
 * @param {[string, number, number, number, number]} entry
 * @returns {PropResult}
 */
export function sceneryProp(f, [kind, x, y, z, height]) {
  if (kind.startsWith('crag:')) {
    return f.crag(x, y, z, { kind: 'spire', stone: kind.slice(5), height, width: clamp(height * 0.42, 1, 2.2) });
  }
  return f.tree(x, y, z, { kind, height, fallenLeaves: false });
}

/**
 * Height function for the terrain around the map: continues the map's edge heights, adds
 * rolling undulation, raises the northern hills behind Windmill Hill and far mountain ridges.
 * With `climate: 'arid'` (LevelLook.climateOf) the same continuation of the edges, then rocky
 * foothills and a range of tall bare peaks (ridged noise) to the north and terraced mesas to the
 * east, west and south (`aridRelief`). With `season` (LevelLook.seasonOf): 'summer' raises limestone
 * headlands beyond the water at the map's north, east and west edges (a cove: the sea never runs
 * out at an edge), 'winter' ridged foothills and sharper crests on the far range (no higher: the
 * aurora shows above them in a lifted shot); the rest as temperate.
 * @param {TileMap} tileMap
 * @param {{ climate?: 'arid'|null, season?: string|null }} [opts]
 * @returns {(x:number, z:number) => number}
 */
export function makeOuterHeight(tileMap, { climate = null, season = null } = {}) {
  const arid = climate === 'arid';
  const SL = season ? seasonKit()?.SEASON_LAND : null;
  const W = tileMap.width;
  const D = tileMap.depth;
  const edgeH = (px, pz) => {
    // highest of the (up to two) tiles touching this boundary point, water banks → bank level
    let best = -Infinity;
    for (const ox of [-0.5, 0.5]) {
      for (const oz of [-0.5, 0.5]) {
        const i = clamp(Math.floor(px + ox), 0, W - 1);
        const j = clamp(Math.floor(pz + oz), 0, D - 1);
        const t = tileMap.tileAt(i, j);
        if (!t) continue;
        const h = t.water ? Math.max(t.h, 0.5) : t.h;
        if (h > best) best = h;
      }
    }
    return Number.isFinite(best) ? best : 0;
  };
  return (x, z) => {
    const px = clamp(x, 0, W);
    const pz = clamp(z, 0, D);
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    const e = edgeH(px, pz) - 0.04;
    if (d < 1e-6) return e;
    const roll = (fbm2(x * 0.05, z * 0.05, { seed: 91, octaves: 3 }) - 0.5) * 3.2;
    const k = smoothstep(0, 10, d);
    let h = e + roll * k;
    if (arid) return Math.max(h + aridRelief(x, z, W, D), e - 0.6 * k);
    // north: hills climbing behind Windmill Hill + a far mountain range
    const north = smoothstep(2, -30, z);
    h += north * (smoothstep(0, 40, -z) * 7 + fbm2(x * 0.03, z * 0.04, { seed: 17, octaves: 4 }) * 9 * smoothstep(-6, -40, z));
    const far = smoothstep(-55, -120, z);
    h += far * (18 + fbm2(x * 0.018, 3.1, { seed: 23, octaves: 4 }) * 34);
    // east / west / south: gentle rise into distant wooded hills
    const side = smoothstep(18, 90, Math.max(-x, x - W, z - D));
    h += side * (4 + fbm2(x * 0.02, z * 0.02, { seed: 29, octaves: 3 }) * 14);
    // the season's relief (the kit's: a cove's headlands, the winter peaks)
    if (SL) h += SL.relief(season, tileMap, x, z, px, pz, d, north, far);
    // keep the ground near the map from dipping below the diorama base
    return Math.max(h, e - 0.6 * k);
  };
}

/** Ridged noise in [0, 1): sharp crests where fbm crosses its middle (bare mountain ridges). */
const ridged = (x, z, seed, octaves = 4) => 1 - Math.abs(fbm2(x, z, { seed, octaves }) * 2 - 1);

/**
 * The arid relief added beyond the map's continued edges (`makeOuterHeight` with 'arid'): rocky
 * foothills right behind the north edge, then a range of tall bare peaks; to the east, west and
 * south mesas — plateaus stepping up in terraces with steep sides.
 * @param {number} x @param {number} z @param {number} W @param {number} D map width and depth
 * @returns {number}
 */
function aridRelief(x, z, W, D) {
  let h = 0;
  const north = smoothstep(2, -30, z);
  // the foothills rise in terraces (rock bands every 3 units with steep risers)
  const hills = (smoothstep(0, 36, -z) * 9 + ridged(x * 0.035, z * 0.045, 17) * 12 * smoothstep(-6, -40, z)) / 3;
  const band = Math.floor(hills);
  h += north * (band + smoothstep(0.6, 0.95, hills - band)) * 3;
  const far = smoothstep(-46, -100, z);
  h += far * (24 + ridged(x * 0.016, z * 0.022 + 4.1, 23, 5) * 62);
  const side = smoothstep(16, 70, Math.max(-x, x - W, z - D));
  const n = fbm2(x * 0.024, z * 0.024, { seed: 29, octaves: 3 }) * 4;
  const step = Math.floor(n);
  h += side * (3 + (step + smoothstep(0.72, 0.98, n - step)) * 6.5);
  return h;
}

/**
 * `geometry.computeVertexNormals()` of an indexed geometry spread over steps: the same arithmetic
 * in the same order (three r186: face normals summed into each corner, stored as float32 after
 * every add, then normalised), so the normals are bit-identical to the one-call version.
 * @param {THREE.BufferGeometry} g indexed, with a position attribute and no normals
 * @param {number} trisPerStep @param {number} vertsPerStep
 * @returns {Generator<undefined, void>}
 */
function* vertexNormalSteps(g, trisPerStep, vertsPerStep) {
  const index = g.index;
  const position = g.getAttribute('position');
  const normal = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
  g.setAttribute('normal', normal);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const nA = new THREE.Vector3();
  const nB = new THREE.Vector3();
  const nC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  let k = 0;
  for (let i = 0, il = index.count; i < il; i += 3) {
    const vA = index.getX(i);
    const vB = index.getX(i + 1);
    const vC = index.getX(i + 2);
    pA.fromBufferAttribute(position, vA);
    pB.fromBufferAttribute(position, vB);
    pC.fromBufferAttribute(position, vC);
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);
    nA.fromBufferAttribute(normal, vA);
    nB.fromBufferAttribute(normal, vB);
    nC.fromBufferAttribute(normal, vC);
    nA.add(cb);
    nB.add(cb);
    nC.add(cb);
    normal.setXYZ(vA, nA.x, nA.y, nA.z);
    normal.setXYZ(vB, nB.x, nB.y, nB.z);
    normal.setXYZ(vC, nC.x, nC.y, nC.z);
    if (++k === trisPerStep) { k = 0; yield; }
  }
  yield;
  for (let i = 0, il = normal.count; i < il; i++) {
    _v.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, _v.x, _v.y, _v.z);
    if (i % vertsPerStep === vertsPerStep - 1) yield;
  }
  normal.needsUpdate = true;
}

/**
 * The fogged outer ground: a tensor-product heightfield (fine spacing near the map, coarse far
 * away — no T-junctions) with a rectangular hole where the TileMap is. With `climate: 'arid'`
 * (LevelLook.climateOf) it wears `arid_dirt` instead of the dark grass, tinted sun-bleached far off,
 * red sandstone on the steep faces and pale grey on the high peaks; with a `season` its
 * ground from the season kit (`SEASON_LAND.outer`: young grass, limestone, autumn grass, snow).
 * @param {{ textures: TextureLibrary, tileMap: TileMap,
 *           heightAt: (x:number, z:number) => number, extent?: number, climate?: 'arid'|null,
 *           season?: string|null }} opts
 * @returns {SolidMesh} one material
 */
export function buildOuterGround(opts) {
  const it = outerGroundSteps(opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * Generator form of {@link buildOuterGround} for callers that spread the work over several frames
 * (the level editor's preview, a campaign's next level built ahead): it yields every `rowsPerStep`
 * grid rows — the heights, the colours, the index and the normals alike — and returns the very
 * same mesh buildOuterGround returns.
 * @param {{ textures: TextureLibrary, tileMap: TileMap, heightAt: (x:number, z:number) => number,
 *           extent?: number, rowsPerStep?: number, climate?: 'arid'|null, season?: string|null }} opts
 * @returns {Generator<undefined, SolidMesh>}
 */
export function* outerGroundSteps({ textures, tileMap, heightAt, extent = 170, rowsPerStep = 12, climate = null, season = null }) {
  const arid = climate === 'arid';
  // (a season's ground: its texture, hill and rock tints, the shade near the map — the kit's
  // SEASON_LAND.outer)
  const SL = !arid && season ? seasonKit()?.SEASON_LAND : null;
  const sg = SL && Object.hasOwn(SL.outer, season) ? SL.outer[season] : null;
  const W = tileMap.width;
  const D = tileMap.depth;
  const axis = (lo, hi) => {
    const out = new Set();
    for (let v = lo - extent; v < lo - 40; v += 10) out.add(v);
    for (let v = lo - 40; v < lo - 16; v += 2) out.add(v);
    for (let v = lo - 16; v <= hi + 16; v += 1) out.add(v);
    for (let v = hi + 16; v <= hi + 40; v += 2) out.add(v);
    for (let v = hi + 40; v <= hi + extent; v += 10) out.add(v);
    return [...out].sort((a, b) => a - b);
  };
  const xs = axis(0, W);
  const zs = axis(0, D);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      hs[j * nx + i] = heightAt(x, z);
    }
    if (j % rowsPerStep === rowsPerStep - 1) yield;
  }
  const tex = sg ? sg[0] : arid ? 'arid_dirt' : 'grass_dark';
  const units = textures.meta(tex).units;
  const cA = new THREE.Color();
  const grassTint = new THREE.Color(1, 1, 1);
  const hillTint = sg ? new THREE.Color(...sg[1]) : arid ? new THREE.Color(1.04, 0.96, 0.88) : new THREE.Color(0.78, 0.86, 0.72);
  const rockTint = sg ? new THREE.Color(...sg[2]) : arid ? new THREE.Color(1.02, 0.74, 0.6) : new THREE.Color(0.62, 0.6, 0.66);
  const peakTint = new THREE.Color(0.92, 0.86, 0.84);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i];
      const z = zs[j];
      const y = hs[k];
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x / units[0]; uv[k * 2 + 1] = -z / units[1];
      // slope from neighbours → rocky, pale tint on steep mountain faces; darker forest floor near the map
      const hl = hs[j * nx + Math.max(0, i - 1)];
      const hr = hs[j * nx + Math.min(nx - 1, i + 1)];
      const hu = hs[Math.max(0, j - 1) * nx + i];
      const hd = hs[Math.min(nz - 1, j + 1) * nx + i];
      const sx = (hr - hl) / Math.max(1e-3, xs[Math.min(nx - 1, i + 1)] - xs[Math.max(0, i - 1)]);
      const sz = (hd - hu) / Math.max(1e-3, zs[Math.min(nz - 1, j + 1)] - zs[Math.max(0, j - 1)]);
      const slope = Math.hypot(sx, sz);
      const dx = Math.max(0, -x, x - W);
      const dz = Math.max(0, -z, z - D);
      const d = Math.hypot(dx, dz);
      cA.copy(grassTint).lerp(hillTint, smoothstep(20, 80, d)).lerp(rockTint, smoothstep(0.55, 1.2, slope));
      if (arid) cA.lerp(peakTint, smoothstep(26, 60, y));
      const shade = lerp(sg ? sg[3] : arid ? 0.8 : 0.62, 1.0, smoothstep(0, 14, d)) * (0.9 + 0.2 * fbm2(x * 0.11, z * 0.11, { seed: 4, octaves: 2 }));
      col[k * 3] = cA.r * shade; col[k * 3 + 1] = cA.g * shade; col[k * 3 + 2] = cA.b * shade;
    }
    if (j % rowsPerStep === rowsPerStep - 1) yield;
  }
  // the index straight into its typed array, a band of rows a step (a plain array, converted by
  // `setIndex`, and `computeVertexNormals` were one ≈ 20 ms step on a 128 × 128 level, KNOWN_ISSUES
  // CMP-09); the type `setIndex` would pick (Uint32 once an index reaches 65535)
  const inside = (v, hi) => v > 0 && v < hi; // the map's hole, per axis
  let holeX = 0;
  for (let i = 0; i < nx - 1; i++) if (inside((xs[i] + xs[i + 1]) / 2, W)) holeX++;
  let holeZ = 0;
  for (let j = 0; j < nz - 1; j++) if (inside((zs[j] + zs[j + 1]) / 2, D)) holeZ++;
  const quads = (nx - 1) * (nz - 1) - holeX * holeZ;
  const idx = nx * nz - 1 >= 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    const rowIn = inside((zs[j] + zs[j + 1]) / 2, D);
    for (let i = 0; i < nx - 1; i++) {
      if (rowIn && inside((xs[i] + xs[i + 1]) / 2, W)) continue;
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
    if (j % rowsPerStep === rowsPerStep - 1) yield;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  yield;
  yield* vertexNormalSteps(g, rowsPerStep * (nx - 1) * 2, rowsPerStep * nx);
  g.computeBoundingSphere();
  const mat = textures.material(tex, { vertexColors: true, normalScale: 0.35 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'OuterGround';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
