/**
 * Shared helpers for the level generators (docs/contracts/COMBAT.md §15.4) — **copies** of the
 * helpers that `tools/make-starfall-vale.mjs` keeps inline, parametrised by a grid object instead
 * of module globals. Starfall is not refactored onto this module (its output must stay byte-
 * identical); `tools/make-cinderwatch-pass.mjs` is the first user.
 *
 *   createGrid({ width, depth, fill, level, zone })  tile / level / zone / locked / path-mask arrays
 *     and the terrain stamps: set · rect · blob · polyline · smoothSteps · path_ · flight · pad ·
 *     borderRing · deepForest · closeCorridors · pathDistance · rows
 *   createPlacer(grid)   objects with ids and approximate TileMap colliders in a spatial hash:
 *     add · reserve · collidersOf · blockedAt · keepClear · removeObject and the small builders
 *     (house, lamp, sign, bench, barrel, crate, crates, rock, tree, fence, torch, light, fire,
 *     stall, well, emit, critters, bridge, waterfall, npc, chest, waystone, enemy …)
 *   createWalkModel(grid, placer, level)   the game's movement rules on a quarter-unit grid:
 *     surfaceAt · standable · walk BFS from the spawn · reachNear · walkLength (Dijkstra, with an
 *     optional forbidden area) · pockets
 *   crownOf / inCrown / roofsOf / createOcclusion   the crown / roof / terrain view-ray model at any
 *     camera yaw and pitch (Starfall's model generalised from yaw 0 / pitch 32)
 *   scatterTrees / scatterRocks   Starfall's rule-based scatter with the level's own rules
 *   normalizedChanges · canonicalObject · orderKeys · parseArgs
 *   previousOutput · keyLevel · splitSharedKeys · keyIssueLines   the content-text keys of what a
 *     generator writes (docs/specs/I18N.md §4.10)
 *
 * Randomness only through RNG / hash2 / fbm2 (src/engine/utils/math.js); no Math.random, no Date.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OBJECT_TYPES, createObject, interiorFootprint } from '../../src/engine/level/ObjectCatalog.js';
import { RNG, fbm2, hash2, clamp, lerp } from '../../src/engine/utils/math.js';
import { assignTextKeys, seededMint, textKeyIssues, levelTexts } from '../../src/engine/i18n/TextKeys.js';

/** @import { LevelObject, ObjectType, TileDef } from '../../src/engine/level/types.js' */

// =============================================================================================
// Small shared pieces
// =============================================================================================

/** `--key=value` / `--flag` command-line arguments → object. */
export function parseArgs(argv) {
  return Object.fromEntries(argv.map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
}

export const WATER = new Set(['~', 'p', 'w', 'o', 'e']);
export const STAIRS = new Set(['^', 'v', '>', '<']);
export const BLOCKED = new Set(['T', 'x', ':']);
/** Ground a tree or a rock may be scattered on. */
export const NATURAL = new Set(['g', 'G', 'f', 'm']);
/** Tiles no scattered tree stands beside (water, stairs, decks, paved ground, void). */
export const HARD = new Set(['~', 'p', 'w', 'o', 'e', '^', 'v', '>', '<', 'b', 'k', 'c', ':', ' ']);
/** Stair direction by char, and unit steps by cardinal. */
export const STAIR_DIR = { '^': 'N', v: 'S', '>': 'E', '<': 'W' };
export const CARDINAL = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

/** Object rotations: the front (local +Z) faces south (the camera), east, west, north. */
export const S_ = 0;
export const E_ = Math.PI / 2;
export const W_ = -Math.PI / 2;
export const N_ = Math.PI;

export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** Distance from point to segment. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Signed noise in [-amp, amp] along one axis (deterministic). */
export const wob = (x, seed, amp = 1, freq = 0.13) => (fbm2(x * freq, 3.7, { seed, octaves: 2 }) - 0.5) * 2.4 * amp;

/** Rotate a local offset (lx, lz) by an object rotation (three.js Y rotation). */
export const rot = (lx, lz, a) => [lx * Math.cos(a) + lz * Math.sin(a), -lx * Math.sin(a) + lz * Math.cos(a)];

/** World AABB of a local rect under a rotation (what PropFactory.boxCollider returns). */
export function rotBox(x, z, a, x0, x1, z0, z1) {
  const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([lx, lz]) => rot(lx, lz, a));
  return { c: 'box', minX: x + Math.min(...pts.map((p) => p[0])), maxX: x + Math.max(...pts.map((p) => p[0])), minZ: z + Math.min(...pts.map((p) => p[1])), maxZ: z + Math.max(...pts.map((p) => p[1])) };
}

/** Point inside a collider shape, with an extra margin. */
export function hitShape(c, x, z, m = 0) {
  if (c.c === 'circle') return (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + m) ** 2;
  if (c.c === 'box') return x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m;
  return segDist(x, z, c.x0, c.z0, c.x1, c.z1) < c.h + m;
}

/** Axis-aligned bounds of a collider shape. */
export function shapeBounds(c) {
  if (c.c === 'circle') return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  if (c.c === 'box') return c;
  return { minX: Math.min(c.x0, c.x1) - c.h, maxX: Math.max(c.x0, c.x1) + c.h, minZ: Math.min(c.z0, c.z1) - c.h, maxZ: Math.max(c.z0, c.z1) + c.h };
}

/** Distance from a point to an axis-aligned rect (0 inside). */
export function rectDist(x, z, r) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

// =============================================================================================
// Grid: tiles, levels, zones and the terrain stamps
// =============================================================================================

/**
 * @param {{ width: number, depth: number, fill?: string, level?: number, zone?: string }} o
 */
export function createGrid({ width, depth, fill = 'g', level = 2, zone: zone0 = 'plain' }) {
  const W = width;
  const D = depth;
  const tiles = new Array(W * D).fill(fill);
  const levels = new Int8Array(W * D).fill(level);
  /** Area of each tile (drives ground variety and the scatter rules). */
  const zone = new Array(W * D).fill(zone0);
  /** Tiles written by a stamp (water, paths, stairs, pads): later passes leave them alone. */
  const locked = new Uint8Array(W * D);
  /** Path tiles (distance fields for the scatter). */
  const pathMask = new Uint8Array(W * D);
  const inMap = (i, j) => i >= 0 && j >= 0 && i < W && j < D;
  const I = (i, j) => j * W + i;
  const T = (i, j) => (inMap(i, j) ? tiles[I(i, j)] : null);
  const L = (i, j) => (inMap(i, j) ? levels[I(i, j)] : null);
  const Z = (i, j) => (inMap(i, j) ? zone[I(i, j)] : null);
  const g = { W, D, tiles, levels, zone, locked, pathMask, inMap, I, T, L, Z, PATHS: [], FLIGHTS: [] };

  /**
   * Write one tile (outside the map: nothing).
   * @param {number} i
   * @param {number} j
   * @param {string|null} ch tile char (null: unchanged)
   * @param {number|null} lvl height level (null: unchanged)
   * @param {{ lock?: boolean, zn?: string }} [o] lock the tile for later passes; set its zone
   */
  g.set = (i, j, ch, lvl, { lock = false, zn } = {}) => {
    if (!inMap(i, j)) return;
    const k = I(i, j);
    if (ch != null) tiles[k] = ch;
    if (lvl != null) levels[k] = lvl;
    if (zn) zone[k] = zn;
    if (lock) locked[k] = 1;
  };
  g.isLocked = (i, j) => inMap(i, j) && locked[I(i, j)] === 1;
  g.isWater = (i, j) => WATER.has(T(i, j));

  /** Visit every tile of a rect [i0, i1] × [j0, j1] (inclusive). */
  g.rect = (i0, j0, i1, j1, fn) => {
    for (let j = Math.max(0, j0); j <= Math.min(D - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) fn(i, j);
  };
  /** Noisy ellipse: tiles whose centre is inside (cx, cz, rx, rz) with an fbm-wobbled edge. */
  g.blob = (cx, cz, rx, rz, fn, { wobble = 0.18, seed = 1, freq = 0.35 } = {}) => {
    g.rect(Math.floor(cx - rx - 3), Math.floor(cz - rz - 3), Math.ceil(cx + rx + 3), Math.ceil(cz + rz + 3), (i, j) => {
      const dx = (i + 0.5 - cx) / rx;
      const dz = (j + 0.5 - cz) / rz;
      const n = (fbm2((i + 0.5) * freq, (j + 0.5) * freq, { seed, octaves: 2 }) - 0.5) * 2 * wobble;
      const d = Math.hypot(dx, dz);
      if (d <= 1 + n) fn(i, j, d);
    });
  };
  /** Tiles whose centre lies within width / 2 of a polyline (world coordinates). */
  g.polyline = (points, w, fn) => {
    const half = w / 2;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const [x, z] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    g.rect(Math.floor(minX - half - 1), Math.floor(minZ - half - 1), Math.ceil(maxX + half + 1), Math.ceil(maxZ + half + 1), (i, j) => {
      let d = Infinity;
      for (let k = 0; k < points.length - 1; k++) d = Math.min(d, segDist(i + 0.5, j + 0.5, ...points[k], ...points[k + 1]));
      if (d <= half) fn(i, j, d);
    });
  };
  /**
   * Lower tiles that stand more than one level above a neighbour (inside the tiles `where` accepts),
   * so noise-made hills stay walkable everywhere (one level = 0.5 ≤ the 0.55 step height).
   */
  g.smoothSteps = (where) => {
    for (let pass = 0; pass < 6; pass++) {
      let changed = 0;
      for (let j = 0; j < D; j++) {
        for (let i = 0; i < W; i++) {
          if (!where(i, j)) continue;
          let lo = Infinity;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(i + di, j + dj) && where(i + di, j + dj)) lo = Math.min(lo, L(i + di, j + dj));
          if (L(i, j) > lo + 1) { levels[I(i, j)] = lo + 1; changed++; }
        }
      }
      if (!changed) break;
    }
  };

  /** A road or trail (tiles of `ch` along a polyline; the heights stay). */
  g.path_ = (name, points, w, ch, { lockTiles = true, zn = null } = {}) => {
    g.PATHS.push({ name, points, width: w, ch });
    g.polyline(points, w, (i, j) => {
      if (g.isLocked(i, j) && !pathMask[I(i, j)]) return;
      g.set(i, j, ch, null, { lock: lockTiles, zn: zn ?? undefined });
      pathMask[I(i, j)] = 1;
    });
  };

  /** A stair flight rising one level per tile toward `dir`; `w` tiles side by side. */
  g.flight = (name, i, j, dir, fromLevel, n, w = 2) => {
    const [dx, dz] = CARDINAL[dir];
    const ch = { N: '^', S: 'v', E: '>', W: '<' }[dir];
    const sx = dz !== 0 ? 1 : 0;
    const sz = dx !== 0 ? 1 : 0;
    const cells = [];
    for (let k = 0; k < n; k++) {
      for (let s = 0; s < w; s++) {
        const ti = i + dx * k + sx * s;
        const tj = j + dz * k + sz * s;
        g.set(ti, tj, ch, fromLevel + k, { lock: true });
        pathMask[I(ti, tj)] = 1;
        cells.push([ti, tj]);
      }
    }
    g.FLIGHTS.push({ name, i, j, dir, fromLevel, n, width: w, cells });
  };
  /** Flat pad (landing / foot) of a flight: tiles set to a level (and a path char). */
  g.pad = (i0, j0, i1, j1, lvl, ch = null) => {
    g.rect(i0, j0, i1, j1, (i, j) => { g.set(i, j, ch ?? (g.isWater(i, j) ? 'g' : T(i, j)), lvl, { lock: true }); if (ch) pathMask[I(i, j)] = 1; });
  };

  /**
   * The blocked forest ring ('T') round the map edge (`north` / `south` / `west` / `east` tiles
   * deep), never over locked tiles. `levelOf(i, j)` gives the ring's height (default: the level of
   * the nearest tile inside).
   */
  g.borderRing = ({ north = 4, south = 3, west = 3, east = 3, levelOf = null } = {}) => {
    const ring = (i, j) => j < north || j >= D - south || i < west || i >= W - east;
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < W; i++) {
        if (!ring(i, j) || locked[I(i, j)]) continue;
        tiles[I(i, j)] = 'T';
        const ii = clamp(i, west, W - east - 1);
        const jj = clamp(j, north, D - south - 1);
        let lvl = levelOf ? levelOf(i, j, ii, jj) : L(ii, jj);
        if (lvl == null) lvl = L(ii, jj);
        levels[I(i, j)] = Math.min(34, Math.max(0, lvl));
      }
    }
  };
  /** Deep-forest patches ('T'; the game scatters trees on them): never on paths, water or stairs. */
  g.deepForest = (list) => {
    for (const [cx, cz, rx, rz, seed, where] of list) {
      g.blob(cx, cz, rx, rz, (i, j) => {
        if (locked[I(i, j)] || pathMask[I(i, j)] || g.isWater(i, j)) return;
        if (where && !where(i, j)) return;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inMap(i + di, j + dj) && (pathMask[I(i + di, j + dj)] || STAIRS.has(T(i + di, j + dj)))) return;
        tiles[I(i, j)] = 'T';
      }, { seed, wobble: 0.22 });
    }
  };
  /**
   * No one-tile corridors between forest and forest (or forest and rock): the trees scattered
   * beside them would close them into pockets nobody can reach.
   */
  g.closeCorridors = (passes = 3) => {
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 1; j < D - 1; j++) {
        for (let i = 1; i < W - 1; i++) {
          if (locked[I(i, j)] || pathMask[I(i, j)] || BLOCKED.has(T(i, j)) || g.isWater(i, j)) continue;
          const t = (ii, jj) => T(ii, jj) === 'T';
          if ((t(i - 1, j) && t(i + 1, j)) || (t(i, j - 1) && t(i, j + 1))) tiles[I(i, j)] = 'T';
        }
      }
    }
  };

  /** Tile distance (Chebyshev) to the nearest path / stair tile, capped at 30. */
  g.pathDistance = () => {
    const dist = new Int16Array(W * D).fill(30);
    const q = [];
    for (let k = 0; k < W * D; k++) if (pathMask[k]) { dist[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      const i = k % W; const j = (k - i) / W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!inMap(i + di, j + dj)) continue;
        const n = I(i + di, j + dj);
        if (dist[n] > dist[k] + 1) { dist[n] = dist[k] + 1; q.push(n); }
      }
    }
    return dist;
  };

  /** The level's `tiles` / `heights` rows. */
  g.rows = (levelToChar) => {
    const t = [];
    const h = [];
    for (let j = 0; j < D; j++) {
      let a = '';
      let b = '';
      for (let i = 0; i < W; i++) { a += tiles[I(i, j)]; b += levelToChar(levels[I(i, j)]); }
      t.push(a);
      h.push(b);
    }
    return { tiles: t, heights: h };
  };
  return g;
}

// =============================================================================================
// Objects: ids, approximate colliders (the PropFactory's own shapes), reservations, builders
// =============================================================================================

/** @param {ReturnType<typeof createGrid>} g */
export function createPlacer(g) {
  const objects = [];
  const usedIds = new Set();
  const idCounters = {};
  let seedCounter = 100;
  const P = {
    objects,
    usedIds,
    /** Every collider (+ owner) in a spatial hash for placement checks and the walk BFS. */
    allShapes: [],
    shapeGrid: new Map(),
    CELL: 4,
    /** Keep-clear zones (door fronts, NPC spots, stair feet, bridge ends…): the scatter avoids them. */
    clearZones: [],
    /** Lanterns: no scattered tree crown within 3.6 units. */
    lampZones: [],
    BRIDGES: [],
    FALLS: [],
    /** Trees placed by the scatter (the others are hand-placed: validate() checks them). */
    SCATTERED: new Set(),
    /** Sightline corridors (no scattered trunk inside). */
    VIEWS: [],
    nextSeed: () => (seedCounter = (seedCounter * 37 + 11) % 9973),
  };
  /** Tile-centre height (world) under a point. */
  P.groundY = (x, z) => (g.L(Math.floor(x), Math.floor(z)) ?? 0) * 0.5;

  /**
   * Add a catalog object. `fields` = { id?, x, z, ...overrides } (line objects: x0, z0, x1, z1;
   * regions: minX, maxX, minZ, maxZ). Ids: explicit (readable) or `${type}_${n}`.
   * @param {ObjectType} type
   * @param {{ id?: string, [key: string]: any }} [fields]
   * @returns {LevelObject}
   */
  P.add = (type, fields = {}) => {
    let { id, ...rest } = fields;
    if (!id) {
      do { idCounters[type] = (idCounters[type] ?? 0) + 1; id = `${type}_${idCounters[type]}`; } while (usedIds.has(id));
    }
    if (usedIds.has(id)) throw new Error(`duplicate object id ${id}`);
    usedIds.add(id);
    const def = OBJECT_TYPES[type];
    let obj;
    if (def.placement === 'line') {
      const { x0, z0, x1, z1, ...o } = rest;
      obj = createObject(type, x0, z0, { x1, z1, ...o });
    } else if (def.placement === 'rect') {
      const { minX, maxX, minZ, maxZ, ...o } = rest;
      obj = createObject(type, (minX + maxX) / 2, (minZ + maxZ) / 2, { minX, maxX, minZ, maxZ, ...o });
    } else {
      const { x, z, ...o } = rest;
      obj = createObject(type, r3(x), r3(z), o);
    }
    obj.id = id;
    objects.push(obj);
    if (def.kind === 'prop' || type === 'npc') P.reserve(obj);
    return obj;
  };

  P.trunkR = (o) => {
    const H = o.opts?.height ?? 4.5;
    const k = o.opts?.kind;
    return 0.12 + (k === 'pine' ? Math.max(0.14, H * 0.042) * 1.2 : k === 'birch' ? H * 0.036 * 1.1 * 1.4 : H * 0.075 * 1.1);
  };
  /** House door point (front = local +Z; `doorOffset` along the facade). */
  P.doorOf = (o) => {
    const [dx, dz] = rot(o.opts.doorOffset ?? 0, o.opts.depth / 2 + 1.0, o.rotation ?? 0);
    return { x: o.x + dx, z: o.z + dz };
  };
  /** The spot 0.8 u in front of a chest (its interact point). */
  P.chestFront = (o) => {
    const [dx, dz] = rot(0, 0.8, o.rotation ?? 0);
    return { x: o.x + dx, z: o.z + dz };
  };

  /** Approximate TileMap colliders of a level object (world space): circles, boxes, segments. */
  P.collidersOf = (o) => {
    const a = o.rotation ?? 0;
    const op = o.opts ?? {};
    switch (o.type) {
      case 'house': return [rotBox(o.x, o.z, a, -op.width / 2 - 0.1, op.width / 2 + 0.1, -op.depth / 2 - 0.1, op.depth / 2 + 0.1)];
      case 'tree': return o.collider === false ? [] : [{ c: 'circle', x: o.x, z: o.z, r: P.trunkR(o) }];
      case 'rock': { const s = op.size ?? 1; return [{ c: 'circle', x: o.x, z: o.z, r: 0.7 * s * 1.1 * (s >= 1 ? 1.25 : 1) }]; }
      case 'haystack': return [{ c: 'circle', x: o.x, z: o.z, r: 1.05 * (op.size ?? 1) }];
      case 'well': return [{ c: 'circle', x: o.x, z: o.z, r: 0.94 }];
      case 'windmill': return [{ c: 'circle', x: o.x, z: o.z, r: 1.75 }];
      case 'marketStall': { const hw = (op.width ?? 3) / 2; return [rotBox(o.x, o.z, a, -hw - 0.05, hw + 0.05, -0.85, 1.3)]; }
      case 'lamppost': return [{ c: 'circle', x: o.x, z: o.z, r: 0.26 }];
      case 'campfire': return [{ c: 'circle', x: o.x, z: o.z, r: 0.95 }];
      case 'bench': { const Lb = op.length ?? 1.8; return [rotBox(o.x, o.z, a, -Lb / 2, Lb / 2, -0.35, 0.25)]; }
      case 'barrel': return [{ c: 'circle', x: o.x, z: o.z, r: 0.44 }];
      case 'crate': { const e = (op.size ?? 0.9) * 0.5 * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))); return [{ c: 'box', minX: o.x - e, maxX: o.x + e, minZ: o.z - e, maxZ: o.z + e }]; }
      // (a barrel the seed may put on either side: room for it at both ends; `barrel: false` —
      // none — the builder's box exactly, buildCrateStack in props/SmallProps.js)
      case 'crateStack': { const s = op.size ?? 0.85; const hx = ((op.count ?? 3) / 2) * (s + 0.04) + (op.barrel === false ? 0.06 : 0.75); return [rotBox(o.x, o.z, a, -hx, hx, -s * 0.6, s * 0.6)]; }
      case 'flowerbox': { if (op.wall) return []; const Lf = op.length ?? 1.2; return [rotBox(o.x, o.z, a, -Lf / 2, Lf / 2, -0.17, 0.17)]; }
      case 'signpost': return [{ c: 'circle', x: o.x, z: o.z, r: 0.22 }];
      case 'fence': return [{ c: 'seg', x0: o.x0, z0: o.z0, x1: o.x1, z1: o.z1, h: 0.1 }];
      case 'bridge': {
        const hw = (op.width ?? 2) / 2 + 0.02;
        const dx = o.x1 - o.x0; const dz = o.z1 - o.z0; const len = Math.hypot(dx, dz);
        const nx = -dz / len; const nz = dx / len;
        return [-1, 1].map((sgn) => ({ c: 'seg', x0: o.x0 + nx * hw * sgn, z0: o.z0 + nz * hw * sgn, x1: o.x1 + nx * hw * sgn, z1: o.z1 + nz * hw * sgn, h: 0.12 }));
      }
      case 'npc': return [{ c: 'circle', x: o.x, z: o.z, r: 0.34 }];
      case 'chest': return [{ c: 'circle', x: o.x, z: o.z, r: 0.45 }];
      case 'waystone': return [{ c: 'circle', x: o.x, z: o.z, r: 0.5 }];
      // set pieces (DRAGON_CAMPAIGN.md §5.3): the builders' own colliders (setpieceColliders)
      case 'crag': case 'fire': case 'debris': case 'garland': return setpieceColliders(o) ?? [];
      // The Bells of Evermere's (EVERMERE_CAMPAIGN.md §5.3): the builders' own colliders (evermereColliders)
      case 'belfry': case 'monument': case 'smithy': case 'ship': return evermereColliders(o) ?? [];
      default: {
        // interior furniture: its footprint (rugs and wall windows have no collider)
        const r = interiorFootprint(o);
        if (!r?.solid) return [];
        if (r.round) return [{ c: 'circle', x: o.x, z: o.z, r: r.maxX }];
        return [rotBox(o.x, o.z, a, r.minX, r.maxX, r.minZ, r.maxZ)];
      }
    }
  };
  P.reserve = (o) => {
    for (const c of P.collidersOf(o)) {
      c.owner = o;
      P.allShapes.push(c);
      const b = shapeBounds(c);
      for (let gz = Math.floor((b.minZ - 2) / P.CELL); gz <= Math.floor((b.maxZ + 2) / P.CELL); gz++) {
        for (let gx = Math.floor((b.minX - 2) / P.CELL); gx <= Math.floor((b.maxX + 2) / P.CELL); gx++) {
          const k = `${gx},${gz}`;
          if (!P.shapeGrid.has(k)) P.shapeGrid.set(k, []);
          P.shapeGrid.get(k).push(c);
        }
      }
    }
  };
  P.shapesNear = (x, z) => P.shapeGrid.get(`${Math.floor(x / P.CELL)},${Math.floor(z / P.CELL)}`) ?? [];
  /** The owner of a collider within `m` of (x, z) (optionally ignoring some owners), or null. */
  P.blockedAt = (x, z, m = 0, ignore = null) => {
    for (const c of P.shapesNear(x, z)) if ((!ignore || !ignore(c.owner)) && hitShape(c, x, z, m)) return c.owner;
    return null;
  };
  P.keepClear = (x, z, r, why) => P.clearZones.push({ x, z, r, why });
  P.inClearZone = (x, z, pad = 0) => P.clearZones.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2);
  P.view = (x, z, w, depth) => P.VIEWS.push({ x, z, w, depth });
  /** Take an object out again (objects list, collider hash). */
  P.removeObject = (o) => {
    const k = objects.indexOf(o);
    if (k >= 0) objects.splice(k, 1);
    usedIds.delete(o.id);
    for (let i = P.allShapes.length - 1; i >= 0; i--) if (P.allShapes[i].owner === o) P.allShapes.splice(i, 1);
    for (const list of P.shapeGrid.values()) for (let i = list.length - 1; i >= 0; i--) if (list[i].owner === o) list.splice(i, 1);
  };

  // ---- small builders ----------------------------------------------------------------------------
  /** A house; `text` = what the door says when knocked on. The door front stays clear. */
  P.house = (id, name, x, z, o, text, { rotation = S_, light = false } = {}) => {
    const obj = P.add('house', {
      id, x, z, rotation, name, light, text: [].concat(text),
      opts: {
        width: 4, depth: 3, stories: 1, wall: 'plaster', upperWall: '', roof: 'roof_red', chimney: true, shutters: true,
        sign: false, doorHood: false, woodpile: false, gableFront: false, seed: P.nextSeed(), doorOffset: 0, ...o,
      },
    });
    const d = P.doorOf(obj);
    P.keepClear(d.x, d.z, 1.1, `door of ${id}`);
    return obj;
  };
  /**
   * Street lamp; `arm` = the direction its lantern arm points ('E', 'W', 'N', 'S') or 'top'.
   * @param {number} x
   * @param {number} z
   * @param {'E'|'W'|'N'|'S'|'top'} [arm]
   * @param {{ id?: string }} [o]
   */
  P.lamp = (x, z, arm = 'top', { id } = {}) => {
    const r = { E: 0, W: Math.PI, S: -Math.PI / 2, N: Math.PI / 2, top: 0 }[arm];
    P.lampZones.push({ x, z });
    return P.add('lamppost', { id, x, z, rotation: r3(r), opts: { style: arm === 'top' ? 'top' : 'arm' } });
  };
  /**
   * A signpost (`text`: its pages).
   * @param {number} x
   * @param {number} z
   * @param {string|string[]} text
   * @param {{ rotation?: number, boards?: number, speaker?: string, id?: string }} [o]
   */
  P.sign = (x, z, text, { rotation = 0, boards = 2, speaker = 'Signpost', id } = {}) => P.add('signpost', { id, x, z, rotation, speaker, text: [].concat(text), opts: { boards } });
  P.bench = (x, z, rotation = S_, length = 1.8, back = true) => P.add('bench', { x, z, rotation: r3(rotation), opts: { length, back } });
  /**
   * A barrel (`rotation`: default a hash of the position).
   * @param {number} x
   * @param {number} z
   * @param {{ height?: number, lying?: boolean, rotation?: number }} [o]
   */
  P.barrel = (x, z, { height = 1, lying = false, rotation } = {}) => P.add('barrel', { x, z, rotation: rotation ?? r3(hash2(Math.round(x * 10), Math.round(z * 10), 5) * 6.28), opts: { height, lying } });
  P.crate = (x, z, size = 0.8, rotation) => P.add('crate', { x, z, rotation: rotation ?? r3((hash2(Math.round(x * 10), Math.round(z * 10), 6) - 0.5) * 0.6), opts: { size } });
  P.crates = (x, z, count = 3, rotation = 0, size = 0.85) => P.add('crateStack', { x, z, rotation: r3(rotation), opts: { count, size, seed: P.nextSeed() } });
  P.flowers = (x, z, rotation = S_, length = 1.2) => P.add('flowerbox', { x, z, rotation: r3(rotation), opts: { length } });
  P.rock = (x, z, size = 1) => P.add('rock', { x, z, opts: { size: r2(size), seed: P.nextSeed() } });
  P.hay = (x, z, size = 1) => P.add('haystack', { x, z, opts: { size } });
  P.tree = (kind, x, z, height, { collider = true } = {}) => P.add('tree', { x, z, collider, opts: { kind, height: r2(height), seed: P.nextSeed() } });
  P.fence = (x0, z0, x1, z1) => P.add('fence', { x0, z0, x1, z1, opts: {} });
  /**
   * A wall torch (a lamp zone: no scattered crown near it).
   * @param {number} x
   * @param {number} z
   * @param {number} rotation
   * @param {number} [dy] height above the ground (2.1)
   * @param {{ embers?: boolean, id?: string }} [o]
   */
  P.torch = (x, z, rotation, dy = 2.1, { embers = false, id } = {}) => { P.lampZones.push({ x, z }); return P.add('wallTorch', { id, x, z, rotation: r3(rotation), dy, opts: { embers } }); };
  P.light = (x, z, o = {}) => P.add('light', { x, z, dy: 1.5, color: '#ffb46b', intensity: 8, distance: 8, flicker: 0.2, nightOnly: true, ...o });
  /**
   * A campfire (its surroundings stay clear).
   * @param {number} x
   * @param {number} z
   * @param {{ seat?: boolean, rotation?: number, id?: string }} [o]
   */
  P.fire = (x, z, { seat = false, rotation = 0.8, id } = {}) => { P.keepClear(x, z, 2.2, 'campfire'); return P.add('campfire', { id, x, z, rotation, opts: { seat } }); };
  P.stall = (x, z, rotation, cloth, w = 3, crates = undefined) => P.add('marketStall', { x, z, rotation: r3(rotation), opts: { cloth, width: w, seed: P.nextSeed(), ...(crates ? { crates } : {}) } });
  P.well = (id, x, z, text, roof = 'wood_planks') => { P.keepClear(x, z, 2.2, `well ${id}`); return P.add('well', { id, x, z, rotation: 0, text: [].concat(text), opts: { roof } }); };
  P.emit = (preset, x, z, size, count, dy = 1.2, extra = {}) => P.add('emitter', { x, z, preset, size, count, dy, ...extra });
  P.critters = (id, kind, x, z, count, radius, extra = {}) => P.add('critters', { id, x, z, kind, count, radius, ...extra });
  /** Bridge between two banks (deck height given explicitly: the bank level). */
  P.bridge = (id, x0, z0, x1, z1, w, deckY, arch = 0.25, { pier = false, name = id } = {}) => {
    const o = P.add('bridge', { id, x0, z0, x1, z1, deckY, opts: { width: w, arch } });
    P.BRIDGES.push({ o, pier, name });
    P.keepClear(x0, z0, 1.6, `bridge end ${id}`);
    P.keepClear(x1, z1, 1.6, `bridge end ${id}`);
    return o;
  };
  /** Waterfall on a tile edge; the drop is checked by the validator. */
  P.waterfall = (id, x, z, w, facing = 'S', extra = {}) => {
    const o = P.add('waterfall', { id, x, z, width: w, facing, ...extra });
    P.FALLS.push(o);
    return o;
  };
  /** A villager (dialogue pages; `o` = the catalog fields plus talkOffset / talkRadius). */
  P.npc = (id, name, preset, x, z, portraitColor, dialogue, o = {}) => {
    const { wander = 1.2, speed = 1, facing = 'down', action = 'none', item = '', behaviour = 'wander', script = '', ...extra } = o;
    P.keepClear(x, z, Math.max(1.4, wander + 0.9), `npc ${id}`);
    return P.add('npc', { id, x, z, name, preset, facing, wander, speed, portraitColor, action, item, behaviour, script, dialogue, ...extra });
  };
  /** A dialogue page with choices. */
  P.ask = (text, ...choices) => ({ text, choices });
  /** A treasure chest (the spot in front of it stays clear). */
  P.chest = (id, x, z, { rotation = S_, gold = 0, potions = 0, upgrade = 'none' } = {}) => {
    const o = P.add('chest', { id, x, z, rotation: r3(rotation), gold, potions, upgrade });
    const f = P.chestFront(o);
    P.keepClear(f.x, f.z, 1.2, `chest ${id}`);
    P.keepClear(x, z, 1.3, `chest ${id}`);
    return o;
  };
  /** A waystone (its attune ring stays clear). */
  P.waystone = (id, name, x, z) => {
    P.keepClear(x, z, 2.4, `waystone ${id}`);
    return P.add('waystone', { id, x, z, name });
  };
  /** An enemy group (`extra`: spotOffsets, area, seed, arena, gate — all relative to x, z). */
  P.enemy = (id, kind, count, level, x, z, radius, extra = {}) => P.add('enemy', { id, x, z, kind, count, radius, level, ...extra });
  return P;
}

// =============================================================================================
// Walk model: the game's movement rules (tiles, step 0.55, stairs, bridge decks, colliders)
// =============================================================================================

/** Bridge deck walk rects, exactly as PropFactory.bridge builds them. */
export function walkRectsOf(o) {
  const dx = o.x1 - o.x0; const dz = o.z1 - o.z0; const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const hw = (o.opts.width ?? 2) / 2;
  const arch = o.opts.arch ?? Math.min(0.4, len * 0.05);
  const deckY = o.deckY;
  const cx = (o.x0 + o.x1) / 2; const cz = (o.z0 + o.z1) / 2;
  const nW = arch > 0.02 ? Math.max(2, Math.round(len / 0.5)) : 1;
  const zOf = (t) => -len / 2 + t * len;
  const out = [];
  for (let k = 0; k < nW; k++) {
    const t0 = k / nW; const t1 = (k + 1) / nW;
    const r = rotBox(cx, cz, yaw, -hw + 0.1, hw - 0.1, zOf(t0) + (k === 0 ? -0.25 : 0), zOf(t1) + (k === nW - 1 ? 0.25 : 0));
    out.push({ ...r, y: deckY + arch * Math.sin(Math.PI * (t0 + t1) / 2) });
  }
  return out;
}

export const stairT = (dir, lx, lz) => (dir === 'N' ? 1 - lz : dir === 'S' ? lz : dir === 'E' ? lx : 1 - lx);

/**
 * The walk grid of a level: every quarter-unit node where the player (radius 0.3) can stand, the
 * BFS from the spawn (and any other `starts`: a campaign level's entrances) and route lengths.
 * @param {ReturnType<typeof createGrid>} g
 * @param {ReturnType<typeof createPlacer>} P
 * @param {{ legend: Record<string, TileDef>, spawn: { x: number, z: number } }} level
 * @param {{ starts?: [number, number][], reuse?: { hgt: Float32Array, rects: { minX: number, maxX: number, minZ: number, maxZ: number }[] } }} [opts]
 *   starts: where the walk begins (default: the spawn); reuse: the node heights of another walk
 *   model of the same grid whose objects differ from `P`'s only inside `rects` (world space, grown
 *   by the player radius and more) — only the nodes there are worked out again (the level checks'
 *   story states)
 */
export function createWalkModel(g, P, level, { starts = null, reuse = null } = {}) {
  const { W, D } = g;
  const LEGEND = level.legend;
  const tileDef = (i, j) => (g.inMap(i, j) ? LEGEND[g.T(i, j)] : null);
  // (bridge decks; The Bells of Evermere's ship decks and gangplanks over the water's surface — the
  // tile's level + 0.35, TileMap's automatic water depth)
  const waterAt = (x, z) => { const i = Math.floor(x); const j = Math.floor(z); return g.inMap(i, j) ? g.L(i, j) * 0.5 + (tileDef(i, j)?.water ? 0.35 : 0) : 0; };
  const walkRects = [
    ...P.objects.filter((o) => o.type === 'bridge').flatMap(walkRectsOf),
    ...P.objects.filter((o) => o.type === 'ship').flatMap((o) => shipWalkRects(o, waterAt(o.x, o.z))),
  ];
  const surfaceAt = (x, z) => {
    let best = null;
    for (const r of walkRects) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && (best === null || r.y > best)) best = r.y;
    if (best !== null) return best;
    const i = Math.floor(x); const j = Math.floor(z);
    const d = tileDef(i, j);
    if (!d || d.void || d.water || d.walkable === false) return NaN;
    const h = g.L(i, j) * 0.5;
    if (d.stairs) return clamp(h + 0.0625 + stairT(d.stairs, x - i, z - j) * 0.5, h, h + 0.5);
    return h;
  };
  /** Ground height where the player can stand at (x, z), NaN otherwise (radius r, default 0.3). */
  const standable = (x, z, ignoreNpcs = false, r = 0.3) => {
    if (x < r || z < r || x > W - r || z > D - r) return NaN;
    const hc = surfaceAt(x, z);
    if (hc !== hc || P.blockedAt(x, z, r - 0.01, ignoreNpcs ? (ow) => ow.type === 'npc' : null)) return NaN;
    for (let k = 0; k < 8; k++) {
      const px = Math.cos((k * Math.PI) / 4) * r;
      const pz = Math.sin((k * Math.PI) / 4) * r;
      const hp = surfaceAt(x + px, z + pz);
      if (hp !== hp || Math.abs(hp - hc) > 0.55) return NaN;
    }
    return hc;
  };

  const G = 4; const GW = W * G + 1; const GD = D * G + 1;
  const hgt = new Float32Array(GW * GD);
  if (reuse) {
    hgt.set(reuse.hgt);
    for (const r of reuse.rects) {
      for (let gz = Math.max(0, Math.floor(r.minZ * G)); gz <= Math.min(GD - 1, Math.ceil(r.maxZ * G)); gz++) {
        for (let gx = Math.max(0, Math.floor(r.minX * G)); gx <= Math.min(GW - 1, Math.ceil(r.maxX * G)); gx++) hgt[gz * GW + gx] = standable(gx / G, gz / G);
      }
    }
  } else for (let gz = 0; gz < GD; gz++) for (let gx = 0; gx < GW; gx++) hgt[gz * GW + gx] = standable(gx / G, gz / G);
  const seen = new Uint8Array(GW * GD);
  /** The standable node nearest (x, z) within 1.5 nodes' rings (6 rings), or -1. */
  const nodeAt = (x, z) => {
    const sx = Math.round(x * G); const sz = Math.round(z * G);
    for (let r = 0; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (sx + dx < 0 || sz + dz < 0 || sx + dx >= GW || sz + dz >= GD) continue;
          const k = (sz + dz) * GW + sx + dx;
          if (hgt[k] === hgt[k]) return k;
        }
      }
    }
    return -1;
  };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const queue = [];
  for (const [x, z] of starts ?? [[level.spawn.x, level.spawn.z]]) {
    const k = nodeAt(x, z);
    if (k >= 0 && !seen[k]) { seen[k] = 1; queue.push(k); }
  }
  // (the steps of NB as two flat lists: the BFS runs once per story state in the level checks)
  const NBX = NB.map((d) => d[0]); const NBZ = NB.map((d) => d[1]);
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const gx = k % GW; const gz = (k - gx) / GW;
    const hk = hgt[k];
    for (let d = 0; d < 8; d++) {
      const nx = gx + NBX[d]; const nz = gz + NBZ[d];
      if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
      const n = nz * GW + nx;
      if (seen[n] || hgt[n] !== hgt[n] || Math.abs(hgt[n] - hk) > 0.55) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  let standableCount = 0;
  for (let k = 0; k < hgt.length; k++) if (hgt[k] === hgt[k]) standableCount++;

  /** Connected areas of standable nodes (labelled on first use; 0 = not standable). */
  let comp = null;
  /** The connected area of the standable node nearest (x, z) (`nodeAt`), 0 when there is none. */
  const componentAt = (x, z) => {
    if (!comp) {
      comp = new Int32Array(GW * GD);
      let next = 0;
      for (let k0 = 0; k0 < hgt.length; k0++) {
        if (comp[k0] || hgt[k0] !== hgt[k0]) continue;
        comp[k0] = ++next;
        const q = [k0];
        for (let h = 0; h < q.length; h++) {
          const c = q[h]; const gx = c % GW; const gz = (c - gx) / GW;
          for (const [dx, dz] of NB) {
            const nx = gx + dx; const nz = gz + dz;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
            const n = nz * GW + nx;
            if (comp[n] || hgt[n] !== hgt[n] || Math.abs(hgt[n] - hgt[c]) > 0.55) continue;
            comp[n] = next;
            q.push(n);
          }
        }
      }
    }
    const k = nodeAt(x, z);
    return k >= 0 ? comp[k] : 0;
  };
  /** The connected areas with a standable node inside a rect (a campaign exit). */
  const componentsIn = (r) => {
    componentAt(r.minX, r.minZ); // (labels)
    const out = new Set();
    for (let gz = Math.max(0, Math.ceil(r.minZ * G)); gz <= Math.min(GD - 1, Math.floor(r.maxZ * G)); gz++) {
      for (let gx = Math.max(0, Math.ceil(r.minX * G)); gx <= Math.min(GW - 1, Math.floor(r.maxX * G)); gx++) {
        const c = comp[gz * GW + gx];
        if (c) out.add(c);
      }
    }
    return out;
  };
  /** Is the node nearest (x, z) reachable from the spawn? */
  const reachableAt = (x, z) => {
    const gx = Math.round(x * G); const gz = Math.round(z * G);
    if (gx < 0 || gz < 0 || gx >= GW || gz >= GD) return false;
    return !!seen[gz * GW + gx];
  };
  /** A reachable node within `radius` of (x, z) (optionally at a height within dy of y). */
  const reachNear = (x, z, radius, y = null, dy = 1.3) => {
    for (let gz = Math.max(0, Math.floor((z - radius) * G)); gz <= Math.min(GD - 1, Math.ceil((z + radius) * G)); gz++) {
      for (let gx = Math.max(0, Math.floor((x - radius) * G)); gx <= Math.min(GW - 1, Math.ceil((x + radius) * G)); gx++) {
        const k = gz * GW + gx;
        if (!seen[k] || (gx / G - x) ** 2 + (gz / G - z) ** 2 > radius * radius) continue;
        if (y == null || Math.abs(hgt[k] - y) <= dy) return true;
      }
    }
    return false;
  };
  /** Unreachable walkable pockets of ≥ `minNodes` nodes. */
  const pockets = (minNodes = 48) => {
    const pocket = new Uint8Array(GW * GD);
    const out = [];
    for (let k = 0; k < hgt.length; k++) {
      if (seen[k] || pocket[k] || hgt[k] !== hgt[k]) continue;
      const q = [k]; pocket[k] = 1;
      let sx2 = 0; let sz2 = 0; let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
      for (let h = 0; h < q.length; h++) {
        const c = q[h]; const gx = c % GW; const gz = (c - gx) / GW; sx2 += gx; sz2 += gz; x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); z0 = Math.min(z0, gz); z1 = Math.max(z1, gz);
        for (const [dx, dz] of NB) { const n = (gz + dz) * GW + gx + dx; if (gx + dx < 0 || gz + dz < 0 || gx + dx >= GW || gz + dz >= GD || pocket[n] || seen[n] || hgt[n] !== hgt[n] || Math.abs(hgt[n] - hgt[c]) > 0.55) continue; pocket[n] = 1; q.push(n); }
      }
      if (q.length >= minNodes) out.push({ nodes: q.length, x: +(sx2 / q.length / G).toFixed(1), z: +(sz2 / q.length / G).toFixed(1), box: [x0 / G, x1 / G, z0 / G, z1 / G] });
    }
    return out.sort((a, b) => b.nodes - a.nodes);
  };
  /**
   * Walk length from a to b on the reachable nodes (Dijkstra, diagonal steps √2), Infinity when
   * there is none. `forbid(x, z)`: nodes the walk may not use (e.g. another branch's region).
   */
  const walkLength = (ax, az, bx, bz, forbid = null) => {
    const nodeNear = (x, z) => {
      let best = -1; let bd = Infinity;
      for (let gz = Math.round((z - 1) * G); gz <= Math.round((z + 1) * G); gz++) for (let gx = Math.round((x - 1) * G); gx <= Math.round((x + 1) * G); gx++) {
        const k = gz * GW + gx;
        if (gx < 0 || gz < 0 || gx >= GW || gz >= GD || !seen[k]) continue;
        const d = (gx / G - x) ** 2 + (gz / G - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    };
    const a = nodeNear(ax, az); const b = nodeNear(bx, bz);
    if (a < 0 || b < 0) return Infinity;
    const dist = new Float64Array(GW * GD).fill(Infinity);
    const heap = [];
    const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    dist[a] = 0; push(0, a);
    while (heap.length) {
      const [c, k] = pop();
      if (c > dist[k]) continue;
      if (k === b) return c / G;
      const gx = k % GW; const gz = (k - gx) / GW;
      for (const [dx, dz] of NB) {
        const nx = gx + dx; const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
        const n = nz * GW + nx;
        if (!seen[n] || Math.abs(hgt[n] - hgt[k]) > 0.55) continue;
        if (forbid && forbid(nx / G, nz / G)) continue;
        const nc = c + (dx && dz ? Math.SQRT2 : 1);
        if (nc < dist[n]) { dist[n] = nc; push(nc, n); }
      }
    }
    return Infinity;
  };
  /**
   * Where a walker gets within `radius` u of walking from any of the `seeds` ([x, z]; each snapped to
   * the nearest reachable node within 0.5 u): the reachable nodes of a `step`-u grid (default 0.5)
   * whose walk distance (Dijkstra, diagonal steps √2, the BFS's 0.55 u step limit) is ≤ radius.
   */
  const walkBall = (seeds, radius, step = 0.5) => {
    const dist = new Map();
    const heap = [];
    const push = (c, n) => { heap.push([c, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const [x, z] of seeds) {
      let best = -1; let bd = Infinity;
      for (let gz = Math.round((z - 0.5) * G); gz <= Math.round((z + 0.5) * G); gz++) for (let gx = Math.round((x - 0.5) * G); gx <= Math.round((x + 0.5) * G); gx++) {
        const k = gz * GW + gx;
        if (gx < 0 || gz < 0 || gx >= GW || gz >= GD || !seen[k]) continue;
        const d = (gx / G - x) ** 2 + (gz / G - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0 && !(dist.get(best) <= 0)) { dist.set(best, 0); push(0, best); }
    }
    const lim = radius * G + 1e-9;
    while (heap.length) {
      const [c, k] = pop();
      if (c > dist.get(k)) continue;
      const gx = k % GW; const gz = (k - gx) / GW;
      for (const [dx, dz] of NB) {
        const nx = gx + dx; const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
        const n = nz * GW + nx;
        if (!seen[n] || Math.abs(hgt[n] - hgt[k]) > 0.55) continue;
        const nc = c + (dx && dz ? Math.SQRT2 : 1);
        if (nc <= lim && !(nc >= dist.get(n))) { dist.set(n, nc); push(nc, n); }
      }
    }
    const every = Math.max(1, Math.round(step * G));
    const out = [];
    for (const k of dist.keys()) {
      const gx = k % GW; const gz = (k - gx) / GW;
      if (gx % every === 0 && gz % every === 0) out.push([gx / G, gz / G]);
    }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };
  return { G, GW, GD, hgt, seen, walkRects, tileDef, surfaceAt, standable, reachableAt, reachNear, walkLength, walkBall, pockets, componentAt, componentsIn, reached: queue.length, standableCount, spawnNode: queue.length ? queue[0] : -1 };
}

// =============================================================================================
// View-ray model: tree crowns, roofs, terrain and forest tiles at any camera yaw / pitch
// =============================================================================================

/**
 * Tree crowns as src/engine/world/props/Trees.js builds them (broadleaf: leaf-card clusters in a
 * flattened ellipsoid; pine: cone tiers from 0.19 H to the top, base radius 0.34 H).
 */
const CROWN_KINDS = { oak: [0.44, 0.8], autumn: [0.43, 0.78], birch: [0.3, 1.25] };
export function crownOf(t, groundY) {
  const H = t.opts?.height ?? 4.5;
  const kind = t.opts?.kind ?? 'oak';
  const y = groundY(t.x, t.z);
  if (kind === 'pine') return { t, pine: true, x: t.x, z: t.z, y, H, R: 0.9 * H * 0.34 };
  const [k, flat] = CROWN_KINDS[kind] ?? CROWN_KINDS.oak;
  const birch = kind === 'birch';
  const Rc = H * k;
  const rx = birch ? Rc * 0.78 : Rc;
  const ry = birch ? Rc * 1.05 : Rc * flat;
  const c = { t, x: t.x, z: t.z, cy: y + H - ry * 0.78 - (birch ? 0.35 : 0.2), rx: rx * 0.66 + 0.75, ry: ry * 0.66 + 0.75 };
  c.R = c.rx;
  return c;
}
export function inCrown(c, px, py, pz) {
  if (c.pine) {
    const h = py - c.y;
    if (h < c.H * 0.19 || h > c.H) return false;
    return Math.hypot(px - c.x, pz - c.z) < 0.9 * c.H * 0.34 * (c.H - h) / (c.H * 0.81);
  }
  const dx = (px - c.x) / c.rx; const dy = (py - c.cy) / c.ry; const dz = (pz - c.z) / c.rx;
  return dx * dx + dy * dy + dz * dz < 1;
}

/**
 * Roof volumes of houses as the PropFactory builds them (src/engine/world/props/House.js: plinth
 * 0.5 + 3, + 2 for an upper storey; the steepest 45° pitch; eaves, fascia and barge boards 0.45 all
 * round; the 0.22 u slab over the pitch plane as a `ROOF_PAD` and the ridge cap as 0.5 over the
 * ridge; the chimney, whose side and depth the house's RNG picks, as a box at every candidate spot:
 * 0.8 in from either gable end, 0.3–0.42 hs either side of the ridge, 0.94 wide with its cap, up
 * to 1.4 over the ridge) and the tall parts of wells and windmills.
 */
const ROOF_PAD = 0.35;
export function roofsOf(objects, groundY) {
  const roofs = objects.filter((o) => o.type === 'house').map((h) => {
    const gf = !!h.opts.gableFront;
    const two = (h.opts.stories ?? 1) > 1;
    const hw = (gf ? h.opts.depth : h.opts.width) / 2;
    const hd = (gf ? h.opts.width : h.opts.depth) / 2;
    const hs = hd + (two ? 0.25 : 0);
    const a = (h.rotation ?? 0) + (gf ? Math.PI / 2 : 0);
    const eave = 3.5 + (two ? 2 : 0);
    const cx = Math.max(0.2, hw - 0.8);
    const chimney = h.opts.chimney === false ? null
      : { x0: cx - 0.47, x1: cx + 0.47, z0: hs * 0.3 - 0.47, z1: hs * 0.42 + 0.47, y0: eave - 0.2, y1: eave + hs + 1.4 };
    return { h, x: h.x, z: h.z, y: groundY(h.x, h.z), hw, hd, hs, eave, chimney, ca: Math.cos(a), sa: Math.sin(a), reach: Math.hypot(hw, hs) + 1 };
  });
  const tall = objects.filter((o) => o.type === 'well' || o.type === 'windmill').map((o) => {
    const y = groundY(o.x, o.z);
    return o.type === 'well'
      ? { o, minX: o.x - 1.25, maxX: o.x + 1.25, minZ: o.z - 0.9, maxZ: o.z + 0.9, y0: y + 1.85, y1: y + 2.65 }
      : { o, minX: o.x - 1.65, maxX: o.x + 1.65, minZ: o.z - 1.65, maxZ: o.z + 1.65, y0: y, y1: y + (o.opts?.height ?? 6) + 1 };
  });
  const roofAt = (px, py, pz, skip = null) => {
    for (const b of tall) {
      if (b.o !== skip && px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ && py > b.y0 && py < b.y1) return b.o;
    }
    for (const r of roofs) {
      if (r.h === skip) continue;
      const dx = px - r.x; const dz = pz - r.z;
      if (Math.abs(dx) > r.reach || Math.abs(dz) > r.reach) continue;
      const ax = Math.abs(dx * r.ca - dz * r.sa); const az = Math.abs(dx * r.sa + dz * r.ca);
      if (ax > r.hw + 0.45 || az > r.hs + 0.45) continue;
      const c = r.chimney;
      if (c && ax > c.x0 && ax < c.x1 && az > c.z0 && az < c.z1 && py > r.y + c.y0 && py < r.y + c.y1) return r.h;
      const top = r.y + r.eave + r.hs - az + (az < 0.25 ? 0.5 : ROOF_PAD);
      const bottom = az <= r.hd && ax <= r.hw ? r.y : r.y + r.eave - 0.65;
      if (py < top && py > bottom) return r.h;
    }
    return null;
  };
  return { roofs, tall, roofAt };
}

/**
 * How much of a figure the camera sees at a yaw / pitch: 15 view rays (3 offsets across the view
 * × 5 heights from h0 to h1 above the ground) marched toward the camera, stopped by tree crowns,
 * roofs, the terrain (tile tops) and the trees the game scatters on forest ('T') tiles.
 * `cover(x, z, { yaw, pitch, h0, h1, y0 })` → { share, by: Map(owner → rays stopped), terrain }.
 * `forestTop(i, j)` (optional): the height of the trees on forest tile (i, j) above its ground (0 =
 * no trees; default `forest.top` everywhere) — e.g. `scatterForestTop` below.
 * @param {{ g: ReturnType<typeof createGrid>, objects: LevelObject[],
 *           groundY: (x: number, z: number) => number, forest?: { base: number, top: number },
 *           forestTop?: (i:number, j:number) => number, maxDist?: number, step?: number }} o
 */
export function createOcclusion({ g, objects, groundY, forest = { base: 1.2, top: 6.2 }, forestTop = null, maxDist = 26, step = 0.2 }) {
  let crowns = objects.filter((o) => o.type === 'tree').map((t) => crownOf(t, groundY));
  const { roofAt } = roofsOf(objects, groundY);
  const DEG = Math.PI / 180;
  const terrainTop = (x, z) => {
    const i = Math.floor(x); const j = Math.floor(z);
    if (!g.inMap(i, j)) return -Infinity;
    const ch = g.T(i, j);
    const h = g.L(i, j) * 0.5;
    return STAIRS.has(ch) ? h + 0.25 : h;
  };
  const cover = (x, z, { yaw = 0, pitch = 34, h0 = 0.1, h1 = 2.0, y0 = null, skip = null, terrain = true } = {}) => {
    const yawR = yaw * DEG; const p = pitch * DEG;
    const hx = Math.sin(yawR); const hz = Math.cos(yawR);
    const cp = Math.cos(p); const sp = Math.sin(p);
    const dx = hx * cp; const dy = sp; const dz = hz * cp;
    const px0 = hz; const pz0 = -hx; // across the view
    const base = y0 ?? groundY(x, z);
    const reach = maxDist * cp + 8;
    const near = [];
    for (const c of crowns) {
      const ox = c.x - x; const oz = c.z - z;
      const along = ox * hx + oz * hz;
      if (along < -1.5 || along > reach) continue;
      if (Math.abs(ox * px0 + oz * pz0) > (c.R ?? 3) + 1.5) continue;
      near.push(c);
    }
    const by = new Map();
    let n = 0; let hid = 0; let byTerrain = 0;
    for (const off of [-0.25, 0, 0.25]) {
      for (let k = 0; k <= 4; k++) {
        n++;
        const sx = x + px0 * off; const sz = z + pz0 * off;
        const sy = base + h0 + ((h1 - h0) * k) / 4;
        let hit = null;
        for (let s = 0.3; s < maxDist && !hit; s += step) {
          const qx = sx + dx * s; const qy = sy + dy * s; const qz = sz + dz * s;
          if (terrain) {
            const top = terrainTop(qx, qz);
            if (qy < top - 0.02) { hit = 'terrain'; break; }
            const fi = Math.floor(qx); const fj = Math.floor(qz);
            if (g.T(fi, fj) === 'T') {
              // the trees the game scatters on forest tiles (`forestTop(i, j)`: their height there, 0 = none)
              const ft = forestTop ? forestTop(fi, fj) : forest.top;
              if (ft > 0 && qy > top + forest.base && qy < top + ft) { hit = 'forest'; break; }
            }
          }
          for (const c of near) if (inCrown(c, qx, qy, qz)) { hit = c.t; break; }
          if (!hit) { const r = roofAt(qx, qy, qz, skip); if (r) hit = r; }
        }
        if (hit) {
          hid++;
          if (hit === 'terrain' || hit === 'forest') byTerrain++;
          by.set(hit, (by.get(hit) ?? 0) + 1);
        }
      }
    }
    return { share: hid / n, by, terrain: byTerrain / n };
  };
  return {
    cover,
    /** Refresh the crown list (after trees were added or removed). */
    refresh: () => { crowns = objects.filter((o) => o.type === 'tree').map((t) => crownOf(t, groundY)); },
    get crowns() { return crowns; },
    removeTree: (t) => { crowns = crowns.filter((c) => c.t !== t); },
  };
}

/**
 * The tree height the game's forest scatter (src/game/Scenery.js `scatterForest`) puts on a forest
 * tile, as a view-ray occluder: none on the bottom three rows and in the third column from the
 * east / west edge (from row 9 down), 0.8 × in the second column, `top` elsewhere.
 */
export function scatterForestTop(g, top = 6.2) {
  return (i, j) => {
    if (j >= g.D - 3) return 0;
    const side = j >= 9 ? Math.min(i, g.W - 1 - i) : -1;
    if (side === 2) return 0;
    return side === 1 ? top * 0.8 : top;
  };
}

// =============================================================================================
// Rule-based scatter: trees and rocks (clear of paths, water, stairs, doors, NPCs, props)
// =============================================================================================

export function pickKind(rng, kinds) {
  const total = kinds.reduce((s, k) => s + k[1], 0);
  let r = rng.range(0, total);
  for (const [k, w] of kinds) { if ((r -= w) <= 0) return k; }
  return kinds[kinds.length - 1][0];
}

/**
 * Starfall's tree scatter: jittered candidates on a 1.6 u grid, kept by zone rule
 * `{ keep, spacing, pathGap, south, kinds, h }` and an fbm clump mask, never on hard ground, on a
 * path's south side (the camera looks north), in keep-clear zones, near lamps or houses, in a
 * sightline corridor or too close to another tree. `avoid(x, z)` rejects more (level rules).
 */
export function scatterTrees(g, P, { seed, rules, maxTrees, maskSeed = 90, avoid = null }) {
  const rng = new RNG(seed);
  const dist = g.pathDistance();
  const trees = P.objects.filter((o) => o.type === 'tree').map((o) => ({ x: o.x, z: o.z }));
  const houses = P.allShapes.filter((c) => c.owner.type === 'house' || c.owner.type === 'windmill');
  const cands = [];
  for (let z = 0.8; z < g.D; z += 1.6) for (let x = 0.8; x < g.W; x += 1.6) cands.push([x + rng.range(-0.7, 0.7), z + rng.range(-0.7, 0.7)]);
  rng.shuffle(cands);
  let placed = 0;
  for (const [x, z] of cands) {
    if (trees.length >= maxTrees) break;
    const i = Math.floor(x); const j = Math.floor(z);
    if (!g.inMap(i, j) || !NATURAL.has(g.T(i, j))) continue;
    const rule = rules[g.Z(i, j)];
    if (!rule) continue;
    const mask = fbm2(x * 0.075, z * 0.075, { seed: maskSeed, octaves: 3 });
    if (!rng.chance(rule.keep * clamp(0.2 + (mask - 0.3) * 3.5, 0, 1))) continue;
    if (dist[g.I(i, j)] < rule.pathGap) continue;
    let bad = false;
    for (let dj = -1; dj <= 1 && !bad; dj++) for (let di = -1; di <= 1; di++) if (HARD.has(g.T(i + di, j + dj) ?? ' ')) { bad = true; break; }
    if (bad) continue;
    // one height all round the trunk (no tree on a step or a cliff edge)
    for (let dj = -1; dj <= 1 && !bad; dj++) for (let di = -1; di <= 1; di++) if (g.inMap(i + di, j + dj) && g.L(i + di, j + dj) !== g.L(i, j) && !BLOCKED.has(g.T(i + di, j + dj))) { bad = true; break; }
    if (bad) continue;
    for (let dj = 1; dj <= rule.south && !bad; dj++) for (let di = -1; di <= 1; di++) if (g.inMap(i + di, j - dj) && g.pathMask[g.I(i + di, j - dj)]) { bad = true; break; }
    if (bad && !rng.chance(0.04)) continue;
    if (P.inClearZone(x, z, 1.4) || P.blockedAt(x, z, 1.3)) continue;
    if (P.lampZones.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < 3.6 * 3.6)) continue;
    if (houses.some((c) => hitShape(c, x, z, 2.5))) continue;
    if (P.VIEWS.some((v) => z > v.z && z < v.z + v.depth && Math.abs(x - v.x) < v.w)) continue;
    if (avoid && avoid(x, z)) continue;
    const sp = rule.spacing * 0.85;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < sp * sp)) continue;
    const kind = pickKind(rng, rule.kinds);
    const h = lerp(rule.h[0], rule.h[1], clamp(rng.next() * 0.7 + (mask - 0.3) * 0.8, 0, 1));
    P.SCATTERED.add(P.tree(kind, x, z, h));
    trees.push({ x, z });
    placed++;
  }
  return placed;
}

/** Starfall's rock scatter with the level's zone chances (`rules[zone]`) and big-rock zones. */
export function scatterRocks(g, P, { seed, rules, maxRocks, bigZones = [], avoid = null }) {
  const rng = new RNG(seed);
  const dist = g.pathDistance();
  const cands = [];
  for (let z = 1.1; z < g.D; z += 2.2) for (let x = 1.1; x < g.W; x += 2.2) cands.push([x + rng.range(-0.9, 0.9), z + rng.range(-0.9, 0.9)]);
  rng.shuffle(cands);
  let n = P.objects.filter((o) => o.type === 'rock').length;
  let placed = 0;
  for (const [x, z] of cands) {
    if (n >= maxRocks) break;
    const i = Math.floor(x); const j = Math.floor(z);
    if (!g.inMap(i, j) || !(NATURAL.has(g.T(i, j)) || g.T(i, j) === 'd' || g.T(i, j) === 's')) continue;
    const p = rules[g.Z(i, j)];
    if (!p || !rng.chance(p)) continue;
    if (dist[g.I(i, j)] < 1) continue;
    const big = bigZones.includes(g.Z(i, j)) ? 1.8 : 1.3;
    const size = 0.5 + rng.next() ** 1.8 * (big - 0.5);
    const rr = 0.7 * size * 1.1 * (size >= 1 ? 1.25 : 1);
    if (P.inClearZone(x, z, rr + 0.4) || P.blockedAt(x, z, rr + 0.25)) continue;
    if (avoid && avoid(x, z, rr)) continue;
    let nearPath = false;
    for (let dj = -2; dj <= 2 && !nearPath; dj++) for (let di = -2; di <= 2; di++) if (g.inMap(i + di, j + dj) && g.pathMask[g.I(i + di, j + dj)] && Math.hypot(i + di + 0.5 - x, j + dj + 0.5 - z) < rr + 0.9) { nearPath = true; break; }
    if (nearPath) continue;
    let bad = false;
    for (let dj = -1; dj <= 1 && !bad; dj++) for (let di = -1; di <= 1; di++) { const ch = g.T(i + di, j + dj) ?? ' '; if ('^v<>bkc: '.includes(ch)) { bad = true; break; } }
    if (bad) continue;
    P.rock(x, z, size);
    n++;
    placed++;
  }
  return placed;
}

// =============================================================================================
// Output helpers
// =============================================================================================

/** Paths of the values normalizeLevel changed (it repairs bad input silently; every value must survive). */
export function normalizedChanges(a, b, p = '', out = []) {
  if (a === b || a === undefined) return out;
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return out;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || b.length !== a.length) out.push(p);
    else a.forEach((v, k) => normalizedChanges(v, b[k], `${p}[${k}]`, out));
  } else if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') out.push(p);
    else for (const k of Object.keys(a)) normalizedChanges(a[k], b[k], p ? `${p}.${k}` : k, out);
  } else out.push(p);
  return out;
}

const PLACEMENT_KEYS = { point: ['x', 'z'], line: ['x0', 'z0', 'x1', 'z1'], rect: ['minX', 'maxX', 'minZ', 'maxZ'] };
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Copy of `obj` with the keys in `lead` first (those it has, in that order), then the rest as they
 * are.
 * @param {Record<string, any>} obj
 * @param {string[]} lead
 * @returns {Record<string, any>}
 */
export function orderKeys(obj, lead) {
  const out = {};
  for (const k of lead) if (Object.hasOwn(obj, k)) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!Object.hasOwn(out, k)) out[k] = obj[k];
  return out;
}

/**
 * The canonical key order of an object line: `id`, `type`, the position keys of its placement,
 * then the catalog defaults in catalog order, then any other keys in the order the generator set
 * them; a nested plain object with catalog defaults (`opts`) likewise lists its defaults first.
 * (`normalizeObject` keeps an object's own key order, so the file would otherwise follow whatever
 * order `createObject` builds today — KNOWN_ISSUES LVL-11.)
 * @param {LevelObject} o
 * @returns {LevelObject}
 */
export function canonicalObject(o) {
  const def = OBJECT_TYPES[o.type];
  const out = orderKeys(o, ['id', 'type', ...PLACEMENT_KEYS[def.placement], ...Object.keys(def.defaults)]);
  for (const [k, d] of Object.entries(def.defaults)) {
    if (isPlain(d) && isPlain(out[k])) out[k] = orderKeys(out[k], Object.keys(d));
  }
  return /** @type {LevelObject} */ (out);
}

// =============================================================================================
// Content-text keys (docs/specs/I18N.md §4.10)
// =============================================================================================

/**
 * A generator's previous output: the file at its **default** path (never `--out`, so a dry run to
 * a scratch file gives the same keys), as JSON — or the text of a `.story` file (`text`); null
 * when there is none or it does not parse.
 * @param {string} root the repository root
 * @param {string} file the default path, relative to the root (`public/levels/gildhaven.json`)
 * @param {{ text?: boolean }} [o]
 * @returns {any}
 */
export function previousOutput(root, file, o = {}) {
  try {
    const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    return o.text ? src : JSON.parse(src);
  } catch {
    return null;
  }
}

/**
 * Give every text of a level a generator built (normalized) its key, in place (`assignTextKeys`,
 * docs/specs/I18N.md §4.10): carried from the generator's previous output (`previousOutput`: the
 * same text, a moved text, a similar edit), shared with `base` (a chapter variant's base, already
 * keyed) where the English there is the same, else minted from the file and the text
 * (`seededMint(file)`: the same input, the same keys — `--check` stays byte-identical). `shared`:
 * the keys the level's copies hold (`copyKeys` of its chapter variants' previous files) — an edit
 * of a text whose key a copy holds with other English gets a new key (copy on write), so the copy
 * keeps its translation.
 * @param {any} level
 * @param {{ root: string, file: string, base?: any, shared?: Map<string, Set<string>>|null }} o `file`: the default path, relative to the root
 * @returns {{ carried: number, shared: number, minted: number, split: { key: string, was: string, text: string, where: string }[], previous: any }}
 */
export function keyLevel(level, { root, file, base = null, shared = null }) {
  const previous = previousOutput(root, file);
  const counts = assignTextKeys(level, { previous, base, shared, mint: seededMint(file) });
  return { ...counts, previous };
}

/**
 * The keys copies of a level hold, each with its English (`assignTextKeys`' `shared`): from the
 * copies' files as last written (null entries: no file yet).
 * @param {any[]} levels
 * @returns {Map<string, Set<string>>}
 */
export function copyKeys(levels) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const lv of levels) {
    if (!lv) continue;
    for (const t of levelTexts(lv)) {
      if (!t.key) continue;
      const s = out.get(t.key);
      if (s) s.add(t.text); else out.set(t.key, new Set([t.text]));
    }
  }
  return out;
}

/**
 * The text-key problems of a level a generator built, as messages (`textKeyIssues`: a generator
 * fails on any — its bar is `level:check --strict`).
 * @param {any} level
 * @returns {string[]}
 */
export function keyIssueLines(level) {
  return textKeyIssues(level).map((i) => `text keys: ${i.where}: ${i.msg}`);
}

/**
 * Copies of a level that share keys (a chapter variant and its base): one key, one English
 * (I18N.md §4.2). A key the copies hold with two Englishes stays with the copy whose English did not
 * change since its previous file (else with the first copy, the base); every other copy gets a new
 * key (minted from its file, its place and its text). Changes the levels in place.
 * @param {{ file: string, level: any, previous: any }[]} copies the base first
 * @returns {number} how many texts got a new key
 */
export function splitSharedKeys(copies) {
  const recs = copies.map((c) => ({
    ...c,
    texts: levelTexts(c.level),
    before: new Map(levelTexts(c.previous ?? {}).filter((t) => t.key).map((t) => [t.key, t.text])),
    mint: seededMint(c.file),
  }));
  /** @type {Map<string, { r: typeof recs[number], t: ReturnType<typeof levelTexts>[number] }[]>} */
  const byKey = new Map();
  for (const r of recs) {
    for (const t of r.texts) {
      if (!t.key) continue;
      let l = byKey.get(t.key);
      if (!l) byKey.set(t.key, (l = []));
      l.push({ r, t });
    }
  }
  let n = 0;
  for (const [key, list] of byKey) {
    if (new Set(list.map((e) => e.t.text)).size < 2) continue;
    const kept = (list.find((e) => e.r.before.get(key) === e.t.text) ?? list[0]).t.text;
    for (const e of list) {
      if (e.t.text === kept) continue;
      e.t.set(e.r.mint(`split|${e.t.where}|${e.t.text}`));
      n++;
    }
  }
  return n;
}

/**
 * The set-piece props' colliders as their builders make them (props/Crags.js, props/SetPieces.js:
 * circles, boxes, a skeleton's spine), for the walk model of `createPlacer.collidersOf` and the
 * level checks (DRAGON_CAMPAIGN.md §5.3); null for any other type.
 * @param {any} o
 * @returns {Array<object>|null}
 */
export function setpieceColliders(o) {
  const op = o.opts ?? {};
  const n = (v, d, lo, hi) => clamp(Number.isFinite(v) ? v : d, lo, hi);
  switch (o.type) {
    case 'crag': {
      const W = n(op.width, 2.5, 0.8, 14);
      // (props/Crags.js: a spire's foot 0.475 W, a mesa's circles along its long axis, a pillar 0.42 W, a hoodoo's stem
      // 0.34 W, a boulder pile's blocks round its centre; an arch's two legs, the opening walkable)
      const r = { spire: 0.48, mesa: 0.5, pillar: 0.42, hoodoo: 0.34, boulders: 0.42, arch: 0 }[op.kind] ?? 0.48;
      if (op.kind === 'arch') {
        const legW = clamp(W * 0.19, 0.5, 2.6);
        return [-1, 1].map((sx) => { const [dx, dz] = rot(sx * (W / 2 - legW / 2), 0, o.rotation ?? 0); return { c: 'circle', x: o.x + dx, z: o.z + dz, r: legW * 0.7 }; });
      }
      return [{ c: 'circle', x: o.x, z: o.z, r: W * r + (op.kind === 'boulders' ? W * 0.3 : 0) }];
    }
    case 'fire': {
      // (props/SetPieces.js FIRE_KINDS: collide × size + 0.2)
      const s = n(op.size, 1.5, 0.3, 6);
      const k = { blaze: 0.36, bonfire: 0.62, brazier: 0.3 }[op.kind] ?? 0;
      return k ? [{ c: 'circle', x: o.x, z: o.z, r: k * s + 0.2 }] : [];
    }
    case 'debris': {
      // (props/SetPieces.js buildDebris: boxes for the cart, the barricade and the wall stub, a ring for
      // timbers and rubble, the awning's four posts, the skeleton's spine and skull)
      const s = n(op.size, 1, 0.3, 8);
      const a = o.rotation ?? 0;
      const circ = (lx, lz, r) => { const [dx, dz] = rot(lx, lz, a); return { c: 'circle', x: o.x + dx, z: o.z + dz, r }; };
      switch (op.kind) {
        case 'cart': return [rotBox(o.x, o.z, a, -0.9 * s, 0.9 * s, -0.775 * s, 0.525 * s)];
        case 'barricade': return [rotBox(o.x, o.z, a, -1.3 * s, 1.3 * s, -0.5 * s, 0.5 * s)];
        case 'wall': return [rotBox(o.x, o.z, a, -1.3 * s, 1.3 * s, -0.225 * s - 0.1, 0.225 * s + 0.1)];
        case 'timbers': return [{ c: 'circle', x: o.x, z: o.z, r: 0.95 * s }];
        case 'tent': return [[-1.1, -0.55], [1.1, -0.55], [-1.1, 0.65], [1.1, 0.65]].map(([lx, lz]) => circ(lx * s, lz * s, 0.2));
        case 'bones': {
          const zOf = (t) => (Math.sin(t * 3.1) * 0.35 - (t > 0.82 ? (t - 0.82) * 2.6 : 0)) * s;
          const out = [1, 4, 7, 10, 13].map((i) => circ(-3.6 * s + (7.2 * s * i) / 14, zOf(i / 14), 0.42 * s));
          out.push(circ(3.6 * s + 1.05 * s, zOf(1), 0.75 * s));
          return out;
        }
        default: return [{ c: 'circle', x: o.x, z: o.z, r: 0.75 * s }];
      }
    }
    case 'garland': {
      if (op.posts === false) return [];
      return [{ c: 'circle', x: o.x0, z: o.z0, r: 0.18 }, { c: 'circle', x: o.x1, z: o.z1, r: 0.18 }];
    }
    default: return null;
  }
}

// =============================================================================================
// The Bells of Evermere's props (EVERMERE_CAMPAIGN.md §5.3; the architecture package): their
// colliders and the ships' walk surfaces as the builders make them (src/engine/world/props/
// Belfry.js, Monuments.js, Smithy.js, Ships.js — keep these in step with them)
// =============================================================================================

/** The ships' hulls (Ships.js SHIP_HULLS; a copy: the builders import three.js). */
const EV_SHIP_HULLS = {
  cog: { L: 8, B: 3, F: 1.6, D: 0.82, bow: 0.5, stern: 0.7, transom: 0, bulwark: 0.55, mast: [0.4, 8.2], plank: -1.1, N: 14 },
  sloop: { L: 6, B: 2.2, F: 1.0, D: 0.65, bow: 0.35, stern: 0.18, transom: 0.55, bulwark: 0.42, mast: [0.8, 7.0], plank: -0.6, N: 12 },
  rowboat: { L: 3.2, B: 1.25, F: 0.45, D: 0.28, bow: 0.16, stern: 0.1, transom: 0.45, bulwark: 0.37, mast: null, plank: null, N: 8 },
};

/** A hull's station (Ships.js `hullStation`). */
function evHullStation(H, t) {
  const a = Math.abs(t);
  const hw = t >= 0
    ? (H.B / 2) * Math.pow(Math.max(0, 1 - Math.pow(a, 2.4)), 0.55)
    : H.transom > 0
      ? (H.B / 2) * (1 + (H.transom - 1) * Math.pow(a, 2.2))
      : (H.B / 2) * Math.pow(Math.max(0, 1 - Math.pow(a, 2.6)), 0.55);
  const G = H.F + (t >= 0 ? H.bow : H.stern) * t * t;
  const keel = -H.D * (1 - Math.pow(a, 5) * (t > 0 || H.transom <= 0 ? 0.85 : 0.3));
  return { hw, G, keel };
}
const evWidthAt = (st, y) => st.hw * Math.pow(Math.sin((clamp((y - st.keel) / Math.max(1e-3, st.G - st.keel), 0, 1) * Math.PI) / 2), 0.5);

/** A ship's hull, deck and plank in its own frame (Ships.js buildShip): what the colliders and rects need. */
function evShipFrame(o) {
  const H = Object.hasOwn(EV_SHIP_HULLS, o.opts?.kind ?? '') ? EV_SHIP_HULLS[o.opts.kind] : EV_SHIP_HULLS.cog;
  const { L, N } = H;
  const floor = H === EV_SHIP_HULLS.rowboat;
  const st = (z) => evHullStation(H, (z / L) * 2);
  const deckY = (s) => (floor ? 0.08 : s.G - H.bulwark);
  return { H, L, N, floor, st, deckY, zAt: (i) => -L / 2 + (i / N) * L };
}

/**
 * The colliders of a belfry, monument, smithy piece or ship; null for any other type.
 * @param {any} o
 * @returns {Array<object>|null}
 */
export function evermereColliders(o) {
  const op = o.opts ?? {};
  const a = o.rotation ?? 0;
  const circ = (lx, lz, r) => { const [dx, dz] = rot(lx, lz, a); return { c: 'circle', x: o.x + dx, z: o.z + dz, r }; };
  switch (o.type) {
    case 'belfry': {
      const H = clamp(Number.isFinite(op.height) ? op.height : 9, 4, 24);
      switch (op.kind) {
        case 'lighthouse': return [{ c: 'circle', x: o.x, z: o.z, r: 2.02 }];
        case 'citadel': return [rotBox(o.x, o.z, 0, -2.7, 2.7, -2.7, 2.7)];
        case 'hush': return setpieceColliders({ type: 'crag', x: o.x, z: o.z, rotation: 0, opts: { kind: 'arch', width: Math.max(6.5, H * 0.75) } }) ?? [];
        default: return [rotBox(o.x, o.z, 0, -2.2, 2.2, -2.2, 2.2)];
      }
    }
    case 'monument': {
      switch (op.kind) {
        case 'statue': return [circ(0, 0, 0.6)];
        case 'cairn': return [circ(0, 0, 0.55)];
        case 'chime': return [circ(-0.45, 0, 0.2), circ(0.45, 0, 0.2)];
        case 'brazier': return [circ(0, 0, 0.5)];
        case 'lantern': return [circ(-0.4, 0, 0.18), circ(0.4, 0, 0.18)];
        default: return [circ(0, -0.42, 0.42)];
      }
    }
    case 'smithy': {
      const F = { forge: [1.0, 0.7], anvil: [0.45, 0.3], bellows: [0.75, 0.42], mould: [0.65, 0.65], rack: [0.8, 0.2], bellblank: [0.95, 0.35] };
      const [hw, hd] = Object.hasOwn(F, op.kind ?? '') ? F[op.kind] : F.forge;
      return [rotBox(o.x, o.z, a, -hw, hw, -hd, hd)];
    }
    case 'ship': {
      const S = evShipFrame(o);
      const { H, L, N } = S;
      if (S.floor) return [rotBox(o.x, o.z, a, -H.B / 2, H.B / 2, -L / 2, L / 2)];
      const out = [];
      for (let i = 0; i <= N * 2; i++) {
        const t = (i / (N * 2)) * 2 - 1;
        const s0 = evHullStation(H, t);
        const zz = (t * L) / 2;
        for (const s of [-1, 1]) {
          if (H.plank != null && s > 0 && Math.abs(zz - H.plank) < 0.5) continue;
          out.push(circ(s * Math.max(0, s0.hw - 0.12), zz, 0.24));
        }
      }
      const stI = (z) => S.st(-L / 2 + Math.round(((z + L / 2) / L) * N) * (L / N));
      if (o.opts?.kind === 'sloop') {
        const c0 = -L / 2 + 1.0, c1 = -0.6;
        const s1 = stI(c0);
        const cw = Math.max(0.5, evWidthAt(s1, S.deckY(s1)) - 0.32);
        out.push(rotBox(o.x, o.z, a, -cw - 0.05, cw + 0.05, c0 - 0.05, c1 + 0.05));
      } else {
        const z0 = -L / 2 + 0.55, z1 = -L / 2 + 2.45;
        const s1 = stI(z0);
        const cw = Math.max(0.6, evWidthAt(s1, S.deckY(s1)) - 0.12);
        out.push(rotBox(o.x, o.z, a, -cw - 0.05, cw + 0.05, z0 - 0.1, z1 + 0.05));
        const f0 = L / 2 - 2.1;
        const s2 = stI(f0);
        const fw = Math.max(0.5, evWidthAt(s2, S.deckY(s2)) - 0.12);
        out.push(rotBox(o.x, o.z, a, -fw - 0.05, fw + 0.05, f0 - 0.1, L / 2));
      }
      out.push(circ(0, H.mast[0], 0.3));
      return out;
    }
    default: return null;
  }
}

/**
 * A ship's walk surfaces (Ships.js: the deck stepped with the sheer, the step and the gunwale at
 * the gangplank, the gangplank's steps), world AABBs with `y` over the water surface `waterY`;
 * [] for a rowboat.
 * @param {any} o
 * @param {number} waterY
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number, y: number }[]}
 */
export function shipWalkRects(o, waterY) {
  const S = evShipFrame(o);
  if (S.floor) return [];
  const { H, N, zAt } = S;
  const a = o.rotation ?? 0;
  const local = [];
  for (let i = 0; i < N; i++) {
    const A = S.st(zAt(i)), B = S.st(zAt(i + 1));
    const w = Math.min(evWidthAt(A, S.deckY(A)), evWidthAt(B, S.deckY(B))) - 0.25;
    if (w < 0.45) continue;
    local.push([-w, w, zAt(i), zAt(i + 1), Math.max(S.deckY(A), S.deckY(B))]);
  }
  const p = S.st(H.plank);
  const yd = S.deckY(p);
  const wIn = Math.max(0, evWidthAt(p, yd) - 0.09);
  const wOut = evWidthAt(p, p.G);
  local.push([wIn - 0.36, wIn, H.plank - 0.36, H.plank + 0.36, yd + 0.27], [wIn, wOut + 0.05, H.plank - 0.36, H.plank + 0.36, p.G]);
  const drop = p.G - 0.05;
  const n = Math.max(2, Math.ceil(drop / 0.42));
  const x0 = wOut - 0.05;
  for (let k = 0; k < n; k++) local.push([x0 + (n * 0.5 * k) / n, x0 + (n * 0.5 * (k + 1)) / n, H.plank - 0.36, H.plank + 0.36, p.G - (drop * (k + 0.5)) / n + 0.06]);
  return local.map(([x0r, x1r, z0r, z1r, y]) => ({ ...rotBox(o.x, o.z, a, x0r, x1r, z0r, z1r), y: waterY + y }));
}
