import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LEVEL_HEIGHT, PPU } from '../constants.js';
import { kdSplit, triangleCount } from './SpatialSplit.js';
import { clamp, lerp, smoothstep, hash2, hashString, fbm2, valueNoise2 } from '../utils/math.js';
import { isOwnKey } from '../utils/own.js';
import { runSteps } from '../utils/steps.js';
import { PixelCanvas } from '../pixel/PixelCanvas.js';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * @import { TileDef, TileRect } from '../level/types.js'
 * @import { TextureLibrary } from '../pixel/Textures.js'
 * @import { SolidMesh, SceneNode } from '../render/types.js'
 */

/**
 * TileMap.js — 2.5D pixel-art terrain for Luminati.
 *
 * Builds a floating "diorama chunk" of blocky terrain from a legend / tiles / heights map
 * description (ARCHITECTURE.md §4.7) and answers gameplay queries (height, walkability,
 * circle-vs-grid movement with sliding, colliders, walk surfaces for bridges).
 *
 * Geometry
 *  - Tops: one quad per tile, subdivided 4×4 so the baked vertex-colour AO can be soft and
 *    local (no T-junctions: every surface is split on the same quarter-unit lattice).
 *    World-space UVs honour `textures.meta(name).units` (16 px per unit everywhere). Organic
 *    textures (grass*, dirt, sand, riverbed, moss_stone) break repetition with random 90°
 *    rotations / mirrors chosen per ~1-unit cell in the fragment shader; the cell borders are
 *    jittered by pixel-quantised noise so the patches have organic pixel edges instead of the
 *    hard tile-grid seams a per-tile geometry rotation of the 4×4-unit textures would show.
 *    Directional textures (dirt_path, cobblestone, stone_tiles, farmland, wood_deck) are
 *    never rotated.
 *  - Stairs: 4 real steps per tile (treads + risers), rising one level toward the legend's
 *    `stairs` direction; walk height interpolates smoothly.
 *  - Vertical faces wherever a neighbour is lower (or void / map edge, which go down to
 *    `baseY` so the map reads as a floating chunk). The top 1-unit band uses the legend `lip`
 *    texture (e.g. grass_side, v = 1 at the top edge), the rest the `side` texture with world
 *    v = y / units so strata line up across tiles.
 *  - Vertex colours: horizon-based ambient occlusion sampled from the height field (inner
 *    corners, wall bases, tile edges below higher neighbours), contact darkening at the base of
 *    cliff faces fading up the wall, shade under grass overhangs, a dark fade toward the bottom
 *    of the diorama edge and a very low-frequency warm/cool tint that breaks up large fields.
 *  - Shader ground bounce on vertical faces (driven by globalUniforms uSunColor/uSunDirection,
 *    strength `wallBounce`) so shaded, camera-facing cliffs stay readable instead of black.
 *  - Organic decorations (alpha-tested, PixelCanvas mask): grass fringes spilling over paths /
 *    cobbles / sand at the same height, and a jagged grass brim + hanging skirt along the top
 *    of grassy cliff faces (casts a real shadow on the face).
 *  - Everything is merged per material (and per chunk of `chunkSize` tiles) → few draw calls.
 *
 * Map format extras (optional legend fields beyond the contract):
 *  - `riser`: texture for stair risers (default: the legend `top`).
 *  - `uvVariation`: false disables the random rotation/mirror of an organic top for that type.
 *  - `fringe`: false stops a grass tile from spilling over its neighbours / a receiver from
 *    receiving fringes; `overhang`: false disables the cliff-top grass brim for that tile type.
 *  - Water tiles: `waterLevel` (absolute surface Y), `waterDepth` (surface = bed + depth),
 *    `flow` ([x, z] units/s or a number multiplying the Water's default flow; 0 = still).
 *    Water tiles whose bed is at/above the map `waterLevel` automatically get their own
 *    surface 0.35 above the bed (so an upper river on a plateau just works).
 */

const STAIR_STEPS = 4;
const STEP_H = LEVEL_HEIGHT / STAIR_STEPS;
const LIP_HEIGHT = 1; // world height of the `lip` band at the top of vertical faces
const SUB = 4; // lattice subdivisions per unit (tops, face columns)
const AUTO_WATER_DEPTH = 0.35;
/** `waterLevel` of a map without one: 0.4, as in a new level (createEmptyLevel) and normalizeLevel (LVL-06). */
const DEFAULT_WATER_LEVEL = 0.4;
const EPS = 1e-4;
/** The terrain seed of a map without a name (a fixed value: the same terrain in every version). */
const NAMELESS_MAP_SEED = 311573446;
/** Collider grid: cell size (world units) and the collider count from which the grid is used. */
const COLLIDER_CELL = 2;
const COLLIDER_GRID_MIN = 16;
/** A collider whose AABB would cover more cells than this stays in the always-tested list. */
const COLLIDER_MAX_CELLS = 256;

/** Face / direction descriptors. (nx, nz) = outward normal, (rx, rz) = "right" as seen from outside. */
const FACES = {
  N: { key: 'N', dx: 0, dz: -1, nx: 0, nz: -1, rx: -1, rz: 0, idx: 0 },
  E: { key: 'E', dx: 1, dz: 0, nx: 1, nz: 0, rx: 0, rz: -1, idx: 1 },
  S: { key: 'S', dx: 0, dz: 1, nx: 0, nz: 1, rx: 1, rz: 0, idx: 2 },
  W: { key: 'W', dx: -1, dz: 0, nx: -1, nz: 0, rx: 0, rz: 1, idx: 3 },
};
const DIR_KEYS = ['N', 'E', 'S', 'W'];
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** Organic tops that may be randomly rotated / mirrored per tile. */
export const ORGANIC_TOPS = new Set(['grass', 'grass_dark', 'grass_flowers', 'dirt', 'sand', 'riverbed', 'moss_stone',
  'dry_grass', 'arid_dirt', 'cracked_earth', 'scree', 'scorched', 'ash', 'basalt']);
/** Tops that grow grass fringes / overhangs. */
export const GRASS_TOPS = new Set(['grass', 'grass_dark', 'grass_flowers', 'dry_grass']);
/** Tops that grass fringes spill onto. */
export const FRINGE_RECEIVERS = new Set(['dirt', 'dirt_path', 'cobblestone', 'stone_tiles', 'sand', 'farmland', 'moss_stone',
  'arid_dirt', 'cracked_earth', 'red_sand', 'scree', 'flagstone', 'scorched']);
/** Between grass variants the higher priority spills over the lower (soft organic borders). */
export const FRINGE_PRIORITY = { grass_dark: 3, grass: 2, dry_grass: 2, grass_flowers: 1 };

/**
 * Add a lazily registered texture set's tops to the sets above (the season kit's: props/
 * SeasonTrees.js, before any level with them is built): turned per tile, grass (fringes, brims),
 * fringe receivers, priorities. Additive; again is harmless.
 * @param {{ organic?: string[], grass?: string[], receivers?: string[], priority?: Record<string, number> }} tops
 */
export function registerTops({ organic = [], grass = [], receivers = [], priority = {} }) {
  for (const t of organic) ORGANIC_TOPS.add(t);
  for (const t of grass) GRASS_TOPS.add(t);
  for (const t of receivers) FRINGE_RECEIVERS.add(t);
  Object.assign(FRINGE_PRIORITY, priority);
}

// AO sampling pattern (8 directions × 4 distances)
const AO_DX = [];
const AO_DZ = [];
for (let d = 0; d < 8; d++) { AO_DX.push(Math.cos((d * Math.PI) / 4)); AO_DZ.push(Math.sin((d * Math.PI) / 4)); }
const AO_DIST = [0.22, 0.45, 0.8, 1.25];
const AO_RANGE = 1.75;

// Movement: perimeter sample directions
const PERIM = 8;
const PCOS = [];
const PSIN = [];
for (let k = 0; k < PERIM; k++) { PCOS.push(Math.cos((k * Math.PI * 2) / PERIM)); PSIN.push(Math.sin((k * Math.PI * 2) / PERIM)); }

// Decal mask atlas layout (64 × 48 px): R = shade (170 = ×1.0), G = coverage.
// Every region has a padding row above it (a copy of its first, fully covered row) and an
// empty row below it: with MSAA, edge pixels are shaded at the pixel centre and extrapolate the
// UV slightly past the quad — the padding keeps that from sampling a neighbouring region.
const MASK_W = 64;
const MASK_H = 48;
const MASK_ROWS = { stripA: 1, stripB: 9, brim: 17, skirt: 22, corner: 33 };
const CORNER_CELL = 10; // corner tuft cells: 1 px padding + 8 px blob + 1 px empty
const CORNER_CELLS = 6;
const FRINGE_DEPTH = 6 / PPU; // how far a grass fringe spills onto the neighbour
const BRIM_DEPTH = 3 / PPU; // grass brim overhang beyond a cliff edge
const SKIRT_MAX = 7 / PPU; // hanging grass skirt length
const DECAL_OVERLAP = 1 / PPU; // decals reach 1 px back over their source tile (padding row)

/**
 * Organic top variation (fragment shader). Every texel picks a random quarter-turn / mirror of
 * the texture from a 1-unit cell grid whose borders are displaced by pixel-quantised noise, so
 * repetition breaks up into irregular pixel-edged patches instead of a visible tile grid.
 * Pure function of world position → the grass fringes/brims use it too and match exactly.
 * Sampling uses textureGrad with the (continuous) unrotated derivatives, and the normal-map
 * sample is rotated back into the unrotated tangent frame.
 */
const VARIATION_GLSL = /* glsl */ `
uniform vec2 lmUnits;
uniform float lmVarSeed;
float lmVHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float lmVNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmVHash(i), lmVHash(i + vec2(1.0, 0.0)), u.x), mix(lmVHash(i + vec2(0.0, 1.0)), lmVHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 lmVApply(vec2 d, float r, float fl) {
  d.x = fl > 0.5 ? -d.x : d.x;
  return r < 0.5 ? d : r < 1.5 ? vec2(-d.y, d.x) : r < 2.5 ? -d : vec2(d.y, -d.x);
}
vec2 lmVariedUv(vec2 uv, out mat2 A) {
  vec2 w = vec2(uv.x * lmUnits.x, -uv.y * lmUnits.y);
  vec2 pw = (floor(w * 16.0) + 0.5) / 16.0;
  vec2 o = vec2(lmVNoise(pw * 1.35 + lmVarSeed), lmVNoise(pw * 1.35 - lmVarSeed + 41.3)) - 0.5;
  o += (vec2(lmVNoise(pw * 4.1 + 7.7), lmVNoise(pw * 4.1 - 3.1)) - 0.5) * 0.35;
  vec2 cell = floor(pw + o * 0.95);
  float h = lmVHash(cell + vec2(lmVarSeed * 0.37, 11.7));
  float r = floor(h * 4.0);
  float fl = step(0.5, fract(h * 7.31));
  vec2 c = cell + 0.5;
  vec2 w2 = c + lmVApply(w - c, r, fl);
  vec2 eu = lmVApply(vec2(1.0, 0.0), r, fl);
  vec2 ev = lmVApply(vec2(0.0, -1.0), r, fl);
  A = mat2(vec2(eu.x, -eu.y), vec2(ev.x, -ev.y));
  return vec2(w2.x / lmUnits.x, -w2.y / lmUnits.y);
}
`;
const VARIATION_MAP = /* glsl */ `
#ifdef USE_MAP
  mat2 lmA;
  vec2 lmUv = lmVariedUv( vMapUv, lmA );
  vec2 lmGx = lmA * dFdx( vMapUv );
  vec2 lmGy = lmA * dFdy( vMapUv );
  vec4 sampledDiffuseColor = textureGrad( map, lmUv, lmGx, lmGy );
  diffuseColor *= sampledDiffuseColor;
#endif
`;
const VARIATION_NORMAL = /* glsl */ `
#if defined( USE_NORMALMAP_TANGENTSPACE ) && defined( USE_MAP )
  vec3 mapN = textureGrad( normalMap, lmUv, lmGx, lmGy ).xyz * 2.0 - 1.0;
  mapN.xy = transpose( lmA ) * mapN.xy;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#endif
`;
const DECAL_ALPHA = /* glsl */ `
#ifdef USE_ALPHAMAP
  vec4 lmDecalMask = texture2D( alphaMap, vAlphaMapUv );
  diffuseColor.a *= lmDecalMask.g;
  diffuseColor.rgb *= lmDecalMask.r * ( 255.0 / 170.0 );
#endif
`;
/**
 * Ground bounce on vertical faces: sunlit ground in front of a wall reflects light onto it
 * (≈ ½ · ground albedo 0.25 · sun irradiance). Without it the camera-facing cliff faces — which
 * are in the sun's shadow at the default golden-hour time — only get the hemisphere fill and
 * crush to near-black under ACES. Scales with globalUniforms uSunColor / uSunDirection, so it
 * follows the day/night cycle automatically; tops (normal.y ≈ 1) are unaffected.
 */
const BOUNCE_PARS = /* glsl */ `
uniform float uLmBounce;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
`;
const BOUNCE_APPLY = /* glsl */ `
#include <lights_fragment_maps>
{
  vec3 lmWN = inverseTransformDirection( normalize( vNormal ), viewMatrix );
  float lmSide = clamp( 1.0 - abs( lmWN.y ), 0.0, 1.0 );
  irradiance += uSunColor * ( max( uSunDirection.y, 0.0 ) * 0.44 * uLmBounce * lmSide );
}
`;

/** Height offset of a ground decal: higher-priority grass lies on top, then by direction. */
function decalLift(source, slot) {
  return 0.0015 + 0.0025 * (FRINGE_PRIORITY[source] ?? 0) + 0.0005 * slot;
}

/** Parse a heights character: 0-9 → 0-9, a-z → 10-35 (A-Z accepted too). */
function parseLevel(ch) {
  if (!ch) return 0;
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 122) return c - 87;
  if (c >= 65 && c <= 90) return c - 55;
  return 0;
}

/**
 * The map a TileMap builds (ARCHITECTURE.md §4.7; `toTileMapInput(level)` makes one from a
 * level, and a level itself fits): missing rows / characters are void, a character without a
 * legend entry is void (with a warning), `waterLevel` defaults to 0.4 (as in a new level).
 * @typedef {object} TileMapInput
 * @property {string} [name]
 * @property {Record<string, TileDef>} [legend]
 * @property {string[]} [tiles]
 * @property {string[]} [heights]
 * @property {number} [waterLevel]
 */
/**
 * A tile record (`tileAt`; shared — do not mutate). `walkable` / `blocked` change with
 * blockTile / unblockTile; `waterSurface` / `waterSource` are set for water tiles (null otherwise):
 * the source is 'legend' (its waterLevel / waterDepth), 'global' (the map level) or 'auto'.
 * @typedef {object} Tile
 * @property {string} char
 * @property {TileDef} type
 * @property {number} level
 * @property {number} h
 * @property {boolean} walkable
 * @property {number} i
 * @property {number} j
 * @property {boolean} water
 * @property {'N'|'S'|'E'|'W'|null} stairs
 * @property {boolean} blocked
 * @property {number|null} waterSurface
 * @property {'legend'|'global'|'auto'|null} waterSource
 */
/** @typedef {{ type: 'circle', x: number, z: number, r: number, dynamic?: boolean }} CircleCollider */
/**
 * @typedef {object} BoxCollider
 * @property {'box'} type
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {boolean} [dynamic]
 */
/**
 * A collider: a circle or a world AABB. One that moves in place (a walking villager) carries
 * `dynamic: true` and is tested every query instead of being binned in the collider grid.
 * @typedef {CircleCollider|BoxCollider} Collider
 */

/**
 * Tile record for a (non-void) legend entry at (i, j); water surfaces are filled in later.
 * @param {string} ch
 * @param {TileDef} type
 * @param {string|undefined} heightChar
 * @param {number} i
 * @param {number} j
 * @returns {Tile}
 */
function makeTile(ch, type, heightChar, i, j) {
  const level = parseLevel(heightChar);
  const water = !!type.water;
  return {
    char: ch,
    type,
    level,
    h: level * LEVEL_HEIGHT,
    walkable: type.walkable ?? !water,
    i,
    j,
    water,
    stairs: isOwnKey(FACES, type.stairs) ? type.stairs : null,
    blocked: false,
    waterSurface: null,
    waterSource: null,
  };
}

/** Progress (0 at the low edge → 1 at the high edge) across a stairs tile. */
function stairT(dir, lx, lz) {
  return dir === 'N' ? 1 - lz : dir === 'S' ? lz : dir === 'E' ? lx : 1 - lx;
}

/** Growable typed-ish vertex buffer for one merged mesh. */
class MeshBuilder {
  constructor(withUv1 = false) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.uv1 = withUv1 ? [] : null;
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  v(x, y, z, nx, ny, nz, u, v, r, g, b, u1 = 0, v1 = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(r, g, b);
    if (this.uv1) this.uv1.push(u1, v1);
    return this.count++;
  }

  /** Two triangles a-b-c, a-c-d (counter-clockwise seen from the front). */
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Like quad() but flips the winding if needed so the face is front-facing along (nx, ny, nz). */
  quadN(a, b, c, d, nx, ny, nz) {
    const P = this.pos;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(a, c, b, a, d, c);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.uv1) g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Paint the decal mask atlas used for grass fringes, brims, skirts and corner tufts.
 * Channels: R = shade multiplier (value / 170), G = coverage (alpha-tested at 0.5), A = 255.
 * @param {number} seed
 * @returns {PixelCanvas}
 */
export function paintDecalMask(seed = 1) {
  const pc = new PixelCanvas(MASK_W, MASK_H, [0, 0, 0, 255]);
  const put = (x, y, shade) => pc.set(x, y, [clamp(Math.round(shade), 0, 255), 255, 0, 255]);
  const H = (x, y, s = 0) => hash2(x, y, seed + s);
  const pn = (x, y, s) => valueNoise2(x / 8, y, seed + s, 8); // periodic across 64 px

  // Fringe strips: rows 0 = at the grass edge, spilling outward (downward in the atlas).
  for (let s = 0; s < 2; s++) {
    const y0 = s ? MASK_ROWS.stripB : MASK_ROWS.stripA;
    const L = new Int8Array(MASK_W);
    const blade = new Uint8Array(MASK_W);
    for (let x = 0; x < MASK_W; x++) {
      let len = 2 + Math.round(pn(x, s * 7.3, 11) * 2.4);
      if (H(x, s, 3) < 0.3) { blade[x] = 1; len += 1 + (H(x, s, 5) < 0.45 ? 1 : 0); }
      L[x] = clamp(len, 1, 6);
    }
    for (let x = 0; x < MASK_W; x++) {
      const l = L[x];
      const nl = Math.max(L[(x + MASK_W - 1) % MASK_W], L[(x + 1) % MASK_W]);
      for (let y = 0; y < l; y++) {
        let sh = 170;
        if (y === l - 1) sh = blade[x] && l > nl ? 212 : 136; // bright blade tips, dark rim elsewhere
        else if (y === l - 2) sh = blade[x] && l > nl ? 192 : 158;
        else if (y === 0 && H(x, s, 9) < 0.2) sh = 185;
        put(x, y0 + y, sh);
      }
    }
  }
  // Brim: 3 px of grass reaching past a cliff edge (row 12 = at the edge).
  for (let x = 0; x < MASK_W; x++) {
    put(x, MASK_ROWS.brim, H(x, 1, 21) < 0.25 ? 196 : 180);
    const r1 = H(x, 2, 21) < 0.8;
    if (r1) put(x, MASK_ROWS.brim + 1, 164);
    if (r1 && H(x, 3, 21) < 0.42) put(x, MASK_ROWS.brim + 2, 140);
  }
  // Skirt: grass hanging down the cliff face (row 16 = top edge).
  for (let x = 0; x < MASK_W; x++) {
    let len = 2 + Math.round(pn(x, 3.7, 31) * 2.6);
    const blade = H(x, 4, 31) < 0.34;
    if (blade) len += 1 + (H(x, 5, 31) < 0.5 ? 1 : 0) + (H(x, 6, 31) < 0.25 ? 1 : 0);
    len = clamp(len, 2, 7);
    for (let y = 0; y < len; y++) {
      let sh = lerp(178, 118, y / 6);
      if (y === len - 1) sh = blade ? 150 : 88;
      else if (y === 0) sh = 190;
      else if (H(x, y, 37) < 0.12) sh += 22;
      put(x, MASK_ROWS.skirt + y, sh);
    }
  }
  // Corner tufts: cells of 10×10 (1 px padding), a ragged quarter disc around the blob's (0, 0).
  const y0c = MASK_ROWS.corner;
  for (let c = 0; c < CORNER_CELLS; c++) {
    const x0 = c * CORNER_CELL + 1;
    const r = 3.4 + H(c, 7, 41) * 2.0;
    for (let b = 0; b < 8; b++) {
      for (let a = 0; a < 8; a++) {
        const ang = Math.atan2(b + 0.5, a + 0.5);
        const jag = (hash2(Math.floor(ang * 6), c, seed + 43) - 0.5) * 2.2;
        const d = Math.hypot(a + 0.5, b + 0.5);
        const rr = r + jag;
        if (d < rr) put(x0 + a, y0c + b, d > rr - 1 ? 136 : 170);
      }
    }
    // padding: duplicate the blob's first row / column outward
    for (let a = 0; a < 8; a++) pc.set(x0 + a, y0c - 1, pc.get(x0 + a, y0c));
    for (let b = -1; b < 8; b++) pc.set(x0 - 1, y0c + b, pc.get(x0, y0c + Math.max(0, b)));
  }
  // padding rows above the strip / brim / skirt regions
  for (const row of [MASK_ROWS.stripA, MASK_ROWS.stripB, MASK_ROWS.brim, MASK_ROWS.skirt]) {
    for (let x = 0; x < MASK_W; x++) pc.set(x, row - 1, pc.get(x, row));
  }
  return pc;
}

/**
 * Terrain tile map (see file header and ARCHITECTURE.md §4.7).
 */
export class TileMap {
  /**
   * @param {TileMapInput} map
   * @param {{ textures: TextureLibrary, seed?: number, baseDepth?: number,
   *           chunkSize?: number, uvVariation?: boolean, fringes?: boolean, overhangs?: boolean,
   *           aoStrength?: number, tintStrength?: number, sideVariation?: boolean, wallBounce?: number,
   *           deferBuild?: boolean }} opts
   *   - baseDepth (2): how far below the lowest tile the diorama edge faces extend
   *   - chunkSize (32): tiles per merged-mesh chunk (per material) for frustum culling on big maps
   *   - uvVariation (true): random 90° rotations / mirrors of organic tops (shader, per cell)
   *   - fringes / overhangs (true): organic grass decals
   *   - aoStrength (1.1), tintStrength (1): vertex-colour shading strengths
   *   - sideVariation (false): random pixel offset of side textures per face (breaks the 1×1
   *     repetition of cliff textures, at the cost of discontinuous joints between tiles)
   *   - wallBounce (1): sun-driven ground-bounce fill on vertical faces (keeps shaded,
   *     camera-facing cliffs readable); live-tweakable via `tileMap.wallBounce`
   *   - deferBuild (false): make no meshes yet — the tiles answer every query at once, the caller
   *     runs `buildSteps()` (in time slices) before the terrain is shown
   */
  // @ts-expect-error the `{}` default lacks `textures` on purpose: the constructor throws on it
  constructor(map, opts = {}) {
    const {
      textures,
      seed = map?.name != null ? hashString(String(map.name)) : NAMELESS_MAP_SEED,
      baseDepth = 2,
      chunkSize = 32,
      uvVariation = true,
      fringes = true,
      overhangs = true,
      aoStrength = 1.1,
      tintStrength = 1,
      sideVariation = false,
      wallBounce = 1,
      deferBuild = false,
    } = opts;
    if (!textures) throw new Error('TileMap: opts.textures (TextureLibrary) is required');
    this.textures = textures;
    this.map = map;
    this.name = map.name ?? '';
    this.seed = seed >>> 0;
    this.options = { baseDepth, chunkSize, uvVariation, fringes, overhangs, aoStrength, tintStrength, sideVariation };
    /** Shared uniform of the wall ground-bounce fill (see `wallBounce`). */
    this._bounceUniform = { value: wallBounce };

    const rows = map.tiles ?? [];
    const hRows = map.heights ?? [];
    /** Map size in tiles. */
    this.depth = rows.length;
    this.width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    /** World-space bounds of the map (tiles span [0, width] × [0, depth]). */
    this.bounds = { minX: 0, maxX: this.width, minZ: 0, maxZ: this.depth };

    /** @type {(Tile|null)[]} */
    this._tiles = new Array(this.width * this.depth).fill(null);
    const legend = map.legend ?? {};
    const warned = new Set();
    let minH = Infinity;
    let maxH = -Infinity;
    for (let j = 0; j < this.depth; j++) {
      const row = rows[j];
      const hr = hRows[j] ?? '';
      for (let i = 0; i < this.width; i++) {
        const ch = row[i] ?? ' ';
        const type = legend[ch];
        if (!type) {
          if (ch !== ' ' && !warned.has(ch)) { warned.add(ch); console.warn(`[TileMap] legend has no entry for "${ch}" (treated as void)`); }
          continue;
        }
        if (type.void) continue;
        const tile = makeTile(ch, type, hr[i], i, j);
        const h = tile.h;
        this._tiles[j * this.width + i] = tile;
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h + (tile.stairs ? LEVEL_HEIGHT : 0));
      }
    }
    if (!Number.isFinite(minH)) { minH = 0; maxH = 0; }
    /** Lowest / highest terrain surface (world Y). */
    this.minHeight = minH;
    this.maxHeight = maxH;
    /** World Y of the bottom of the diorama edge faces (void / out-of-bounds height). */
    this.baseY = minH - baseDepth;
    /** Global water surface level (map.waterLevel). */
    this.waterLevel = map.waterLevel ?? DEFAULT_WATER_LEVEL;
    for (const t of this._tiles) {
      if (!t || !t.water) continue;
      const s = this._computeWaterSurface(t, this.waterLevel);
      t.waterSurface = s.level;
      t.waterSource = s.source;
    }

    /**
     * Colliders, in the order they are tested. Movement queries use a spatial hash grid of them
     * (rebuilt lazily after addCollider / removeCollider or a change of the array's length);
     * colliders that move in place (walking villagers) must carry `dynamic: true` — they are
     * tested every query — or be followed by `collidersChanged()`.
     * @type {Collider[]}
     */
    this.colliders = [];
    this._cgrid = null;
    this._cgridDirty = true;
    /** @type {{minX:number,maxX:number,minZ:number,maxZ:number,y:number}[]} */
    this.walkSurfaces = [];

    /** Group with the merged terrain meshes. */
    this.object = new THREE.Group();
    this.object.name = `TileMap${this.name ? `:${this.name}` : ''}`;
    this._materials = new Map();
    this._builders = new Map();
    this._maskTexture = null;
    this._tmpPush = { x: 0, z: 0 };
    this._loose = 0;
    this._tmpUV = { u: 0, v: 0 };
    this._tmpTint = [1, 1, 1];

    if (!deferBuild) this._build();
  }

  // -------------------------------------------------------------------------
  // Tile access
  // -------------------------------------------------------------------------

  /**
   * @param {number} i @param {number} j
   * @returns {Tile|null}
   *   The tile record (shared object — do not mutate) or null for void / out of bounds.
   */
  tileAt(i, j) {
    i = Math.floor(i);
    j = Math.floor(j);
    if (!(i >= 0 && j >= 0 && i < this.width && j < this.depth)) return null; // also rejects NaN
    return this._tiles[j * this.width + i];
  }

  /** @returns {{i:number, j:number}} tile indices containing world (x, z) */
  worldToTile(x, z, out = { i: 0, j: 0 }) {
    out.i = Math.floor(x);
    out.j = Math.floor(z);
    return out;
  }

  /** @returns {THREE.Vector3} centre of tile (i, j) at its walkable surface height (baseY for void). */
  tileCenter(i, j, out = new THREE.Vector3()) {
    const x = i + 0.5;
    const z = j + 0.5;
    return out.set(x, this.getHeight(x, z), z);
  }

  /** fn(i, j, tile) for every non-void tile (row by row). */
  forEachTile(fn) {
    for (let j = 0; j < this.depth; j++) {
      for (let i = 0; i < this.width; i++) {
        const t = this._tiles[j * this.width + i];
        if (t) fn(i, j, t);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Height queries
  // -------------------------------------------------------------------------

  /**
   * Ground height at a world position: walk surfaces override tiles; stairs interpolate
   * smoothly; water tiles return their bed height; void / outside → baseY.
   */
  getHeight(x, z) {
    const ws = this._walkHeight(x, z);
    if (ws !== null) return ws;
    const i = Math.floor(x);
    const j = Math.floor(z);
    const t = this.tileAt(i, j);
    if (!t) return this.baseY;
    return t.stairs ? this._stairRamp(t, x - i, z - j) : t.h;
  }

  /** Water surface Y at a world position, or null if there is no water there. */
  getWaterSurface(x, z) {
    const t = this.tileAt(Math.floor(x), Math.floor(z));
    return t && t.water ? t.waterSurface : null;
  }

  /**
   * Water surface for a water tile given a global level (used by Water when opts.level
   * overrides the map's waterLevel).
   */
  waterSurfaceOf(tile, globalLevel = this.waterLevel) {
    return this._computeWaterSurface(tile, globalLevel).level;
  }

  /**
   * @param {Tile} t
   * @param {number} globalLevel
   * @returns {{ level: number, source: 'legend'|'global'|'auto' }}
   */
  _computeWaterSurface(t, globalLevel) {
    const ty = t.type;
    if (typeof ty.waterLevel === 'number') return { level: ty.waterLevel, source: 'legend' };
    if (typeof ty.waterDepth === 'number') return { level: t.h + ty.waterDepth, source: 'legend' };
    if (globalLevel > t.h + 0.02) return { level: globalLevel, source: 'global' };
    return { level: t.h + AUTO_WATER_DEPTH, source: 'auto' };
  }

  _stairRamp(t, lx, lz) {
    const p = stairT(t.stairs, lx, lz);
    return clamp(t.h + STEP_H * 0.5 + p * LEVEL_HEIGHT, t.h, t.h + LEVEL_HEIGHT);
  }

  /** Stepped (render) surface inside a tile at local coords. */
  _topAt(t, lx, lz) {
    if (!t.stairs) return t.h;
    const k = Math.min(STAIR_STEPS - 1, Math.floor(stairT(t.stairs, lx, lz) * STAIR_STEPS));
    return t.h + (k + 1) * STEP_H;
  }

  /** Stepped render surface at a world point (void → baseY). */
  _surface(x, z) {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const t = this.tileAt(i, j);
    return t ? this._topAt(t, x - i, z - j) : this.baseY;
  }

  _walkHeight(x, z) {
    const ws = this.walkSurfaces;
    let best = null;
    for (let k = 0; k < ws.length; k++) {
      const r = ws[k];
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && (best === null || r.y > best)) best = r.y;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Walkability / colliders
  // -------------------------------------------------------------------------

  /** True if a character could stand at (x, z): walk surface or walkable, unblocked tile, outside colliders. */
  isWalkable(x, z) {
    if (x < 0 || z < 0 || x > this.width || z > this.depth) return false;
    if (this._walkHeight(x, z) === null) {
      const t = this.tileAt(Math.floor(x), Math.floor(z));
      if (!t || !t.walkable) return false;
    }
    return !this._pointInCollider(x, z);
  }

  /**
   * Add a collider ({type:'circle',x,z,r} or {type:'box',minX,maxX,minZ,maxZ}); returns it. A
   * collider that will move in place (e.g. a walking villager) should carry `dynamic: true`.
   */
  addCollider(c) {
    if (c && !this.colliders.includes(c)) {
      this.colliders.push(c);
      this._cgridDirty = true;
    }
    return c;
  }

  removeCollider(c) {
    const k = this.colliders.indexOf(c);
    if (k >= 0) {
      this.colliders.splice(k, 1);
      this._cgridDirty = true;
    }
  }

  /** Re-index the colliders (after moving a non-`dynamic` collider in place). */
  collidersChanged() {
    this._cgridDirty = true;
  }

  /**
   * Colliders whose bounds may touch the world rect (a superset: test them exactly), in collider
   * order. Uses the spatial grid — cheap even with thousands of colliders.
   * @param {number} minX @param {number} minZ @param {number} maxX @param {number} maxZ
   * @param {Collider[]} [out]
   * @returns {Collider[]}
   */
  queryColliders(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const cs = this.colliders;
    const g = this._colliderGrid();
    if (!g) {
      for (let k = 0; k < cs.length; k++) out.push(cs[k]);
      return out;
    }
    const stamp = ++g.stamp;
    const idx = g.scratch;
    idx.length = 0;
    const i0 = Math.max(0, Math.floor((minX - g.ox) / COLLIDER_CELL));
    const i1 = Math.min(g.nx - 1, Math.floor((maxX - g.ox) / COLLIDER_CELL));
    const j0 = Math.max(0, Math.floor((minZ - g.oz) / COLLIDER_CELL));
    const j1 = Math.min(g.nz - 1, Math.floor((maxZ - g.oz) / COLLIDER_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = g.cells[j * g.nx + i];
        if (list) this._collectIndices(g, list, stamp, idx);
      }
    }
    this._collectIndices(g, g.always, stamp, idx);
    if (idx.length > 1) idx.sort((a, b) => a - b);
    for (let n = 0; n < idx.length; n++) out.push(cs[idx[n]]);
    return out;
  }

  _collectIndices(g, list, stamp, idx) {
    for (let n = 0; n < list.length; n++) {
      const k = list[n];
      if (g.mark[k] === stamp) continue;
      g.mark[k] = stamp;
      idx.push(k);
    }
  }

  /**
   * The collider grid (null below COLLIDER_GRID_MIN colliders: a linear scan is as fast). Static
   * colliders are binned by their AABB into COLLIDER_CELL cells over the map (+ a margin);
   * dynamic, huge, non-finite or far-away ones go to `always` (tested by every query).
   */
  _colliderGrid() {
    const cs = this.colliders;
    if (cs.length < COLLIDER_GRID_MIN) return null;
    let g = this._cgrid;
    if (g && !this._cgridDirty && g.count === cs.length) return g;
    const margin = 16;
    const ox = -margin;
    const oz = -margin;
    const nx = Math.max(1, Math.ceil((this.width + 2 * margin) / COLLIDER_CELL));
    const nz = Math.max(1, Math.ceil((this.depth + 2 * margin) / COLLIDER_CELL));
    g = { ox, oz, nx, nz, cells: new Array(nx * nz).fill(null), always: [], count: cs.length, mark: new Uint32Array(cs.length), stamp: 0, scratch: [] };
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      if (!c) continue;
      let x0;
      let x1;
      let z0;
      let z1;
      if (c.type === 'circle') { x0 = c.x - c.r; x1 = c.x + c.r; z0 = c.z - c.r; z1 = c.z + c.r; }
      else { x0 = c.minX; x1 = c.maxX; z0 = c.minZ; z1 = c.maxZ; }
      const i0 = Math.floor((x0 - ox) / COLLIDER_CELL);
      const i1 = Math.floor((x1 - ox) / COLLIDER_CELL);
      const j0 = Math.floor((z0 - oz) / COLLIDER_CELL);
      const j1 = Math.floor((z1 - oz) / COLLIDER_CELL);
      if (c.dynamic || !(Number.isFinite(i0) && Number.isFinite(i1) && Number.isFinite(j0) && Number.isFinite(j1))
        || i0 < 0 || j0 < 0 || i1 >= nx || j1 >= nz || (i1 - i0 + 1) * (j1 - j0 + 1) > COLLIDER_MAX_CELLS) {
        g.always.push(k);
        continue;
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = j * nx + i;
          (g.cells[cell] ??= []).push(k);
        }
      }
    }
    this._cgrid = g;
    this._cgridDirty = false;
    return g;
  }

  /**
   * Smallest collider index > `after` that `_pushOut` would push a circle (x, z, r) out of — the
   * grid form of its linear scan (same order, same tests), or -1.
   */
  _nextPush(g, x, z, r, after) {
    let best = Infinity;
    const i0 = Math.max(0, Math.floor((x - r - g.ox) / COLLIDER_CELL));
    const i1 = Math.min(g.nx - 1, Math.floor((x + r - g.ox) / COLLIDER_CELL));
    const j0 = Math.max(0, Math.floor((z - r - g.oz) / COLLIDER_CELL));
    const j1 = Math.min(g.nz - 1, Math.floor((z + r - g.oz) / COLLIDER_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = g.cells[j * g.nx + i];
        if (list) best = this._firstPush(list, x, z, r, after, best);
      }
    }
    best = this._firstPush(g.always, x, z, r, after, best);
    return best === Infinity ? -1 : best;
  }

  /** Lowest index in `list` within (after, best) whose collider overlaps the circle, else best. */
  _firstPush(list, x, z, r, after, best) {
    const cs = this.colliders;
    for (let n = 0; n < list.length; n++) {
      const k = list[n];
      if (k <= after || k >= best) continue;
      const c = cs[k];
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = c.r + r;
        if (dx * dx + dz * dz < min * min) best = k;
      } else {
        const dx = x - clamp(x, c.minX, c.maxX);
        const dz = z - clamp(z, c.minZ, c.maxZ);
        const d2 = dx * dx + dz * dz;
        if (d2 === 0 || d2 < r * r) best = k;
      }
    }
    return best;
  }

  /** Mark a tile as not walkable (e.g. under a house). */
  blockTile(i, j) {
    const t = this.tileAt(i, j);
    if (t) { t.blocked = true; t.walkable = false; }
  }

  /** Undo blockTile (restores the legend walkability). */
  unblockTile(i, j) {
    const t = this.tileAt(i, j);
    if (t) { t.blocked = false; t.walkable = t.type.walkable ?? !t.water; }
  }

  /**
   * Extra walkable ground (e.g. a bridge deck). Inside the rect the ground is walkable at
   * height `y`, overriding water / non-walkable tiles. Returns the rect.
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number,y:number}} rect
   */
  addWalkSurface(rect) {
    if (rect && !this.walkSurfaces.includes(rect)) this.walkSurfaces.push(rect);
    return rect;
  }

  removeWalkSurface(rect) {
    const k = this.walkSurfaces.indexOf(rect);
    if (k >= 0) this.walkSurfaces.splice(k, 1);
  }

  _pointInCollider(x, z) {
    const cs = this.colliders;
    const g = this._colliderGrid();
    if (g) {
      const i = Math.floor((x - g.ox) / COLLIDER_CELL);
      const j = Math.floor((z - g.oz) / COLLIDER_CELL);
      const cell = i >= 0 && j >= 0 && i < g.nx && j < g.nz ? g.cells[j * g.nx + i] : null;
      return (!!cell && this._pointInList(x, z, cell)) || this._pointInList(x, z, g.always);
    }
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) return true;
      } else if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  /** Is (x, z) inside one of the colliders with these indices? */
  _pointInList(x, z, list) {
    const cs = this.colliders;
    for (let n = 0; n < list.length; n++) {
      const c = cs[list[n]];
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) return true;
      } else if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  /** Height at a point if it can be stood on within maxStep of `href`, else NaN. */
  _standHeight(x, z, href, maxStep) {
    let h = this._walkHeight(x, z);
    if (h === null) {
      const i = Math.floor(x);
      const j = Math.floor(z);
      const t = this.tileAt(i, j);
      if (!t || !t.walkable) return NaN;
      h = t.stairs ? this._stairRamp(t, x - i, z - j) : t.h;
    }
    return Math.abs(h - href) > maxStep ? NaN : h;
  }

  /** Can a circle of radius r stand at (x, z) coming from ground height href? */
  _canOccupy(x, z, r, href, maxStep) {
    if (x - r < 0 || z - r < 0 || x + r > this.width || z + r > this.depth) return false;
    const hc = this._standHeight(x, z, href, maxStep);
    if (hc !== hc) return false; // NaN
    for (let k = 0; k < PERIM; k++) {
      const hp = this._standHeight(x + PCOS[k] * r, z + PSIN[k] * r, hc, maxStep);
      if (hp !== hp) return false;
    }
    return true;
  }

  /**
   * Occupancy test used by move(): strict, or relaxed while escaping an invalid start
   * (`_loose` 1: centre valid → centre-only test; 2: centre invalid, e.g. in water → any spot
   * that does not climb more than maxStep).
   */
  _occupy(x, z, r, href, maxStep) {
    if (!this._loose) return this._canOccupy(x, z, r, href, maxStep);
    if (x - r < 0 || z - r < 0 || x + r > this.width || z + r > this.depth) return false;
    let h = this._walkHeight(x, z);
    let walkable = true;
    if (h === null) {
      const i = Math.floor(x);
      const j = Math.floor(z);
      const t = this.tileAt(i, j);
      if (!t) return false;
      h = t.stairs ? this._stairRamp(t, x - i, z - j) : t.h;
      walkable = t.walkable;
    }
    if (this._loose === 1) return walkable && Math.abs(h - href) <= maxStep;
    return h - href <= maxStep;
  }

  /** Push a circle out of every overlapping collider (a few relaxation passes). */
  _pushOut(x, z, r, out) {
    const cs = this.colliders;
    const g = this._colliderGrid();
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      // grid: jump from one overlapping collider to the next in index order — exactly the
      // colliders (and the order) the linear scan pushes against
      for (let k = g ? this._nextPush(g, x, z, r, -1) : 0; g ? k >= 0 : k < cs.length; k = g ? this._nextPush(g, x, z, r, k) : k + 1) {
        const c = cs[k];
        if (c.type === 'circle') {
          let dx = x - c.x;
          let dz = z - c.z;
          const min = c.r + r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = 0; dz = 1; d = 1; }
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
          moved = true;
        } else {
          const qx = clamp(x, c.minX, c.maxX);
          const qz = clamp(z, c.minZ, c.maxZ);
          const dx = x - qx;
          const dz = z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 === 0) {
            // centre inside the box: leave through the nearest side
            const l = x - c.minX, rr = c.maxX - x, t = z - c.minZ, b = c.maxZ - z;
            const m = Math.min(l, rr, t, b);
            if (m === l) x = c.minX - r; else if (m === rr) x = c.maxX + r; else if (m === t) z = c.minZ - r; else z = c.maxZ + r;
            moved = true;
          } else if (d2 < r * r) {
            const d = Math.sqrt(d2);
            x = qx + (dx / d) * r;
            z = qz + (dz / d) * r;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  /**
   * Move a circle of `radius` from `from` by (dx, dz) with sliding (full → x-only → z-only).
   * Respects walkability, maximum step height (stairs are only enterable where heights
   * connect), walk surfaces, colliders (pushed out) and the map bounds. A circle that starts in
   * an invalid spot (e.g. spawned in water) moves freely until it is out, so it never soft-locks.
   * @param {{x:number, z:number}} from
   * @param {number} dx @param {number} dz
   * @param {number} [radius=0.3] @param {number} [maxStep=0.55]
   * @param {{x:number, z:number}} [out] optional result object (avoids an allocation)
   * @returns {{x:number, z:number}}
   */
  move(from, dx, dz, radius = 0.3, maxStep = 0.55, out = { x: 0, z: 0 }) {
    let x = from.x;
    let z = from.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-9) {
      const n = Math.max(1, Math.ceil(len / Math.max(0.04, radius * 0.5)));
      const sx = dx / n;
      const sz = dz / n;
      let href = this.getHeight(x, z);
      const push = this._tmpPush;
      // Started somewhere invalid (spawned overlapping a wall, or in water)? Relax the test
      // until the circle is fully valid again, so it can walk out instead of soft-locking.
      this._loose = 0;
      if (!this._canOccupy(x, z, radius, href, maxStep)) this._loose = Number.isNaN(this._standHeight(x, z, href, maxStep)) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        let nx;
        let nz;
        if (this._loose && this._canOccupy(x, z, radius, href, maxStep)) this._loose = 0;
        if (this._occupy(x + sx, z + sz, radius, href, maxStep)) { nx = x + sx; nz = z + sz; }
        else if (sx !== 0 && this._occupy(x + sx, z, radius, href, maxStep)) { nx = x + sx; nz = z; }
        else if (sz !== 0 && this._occupy(x, z + sz, radius, href, maxStep)) { nx = x; nz = z + sz; }
        else break;
        if (this.colliders.length) {
          this._pushOut(nx, nz, radius, push);
          if (push.x !== nx || push.z !== nz) {
            if (this._occupy(push.x, push.z, radius, href, maxStep)) { nx = push.x; nz = push.z; }
            else { nx = x; nz = z; }
          }
        }
        if (nx === x && nz === z) break;
        x = nx;
        z = nz;
        href = this.getHeight(x, z);
      }
    }
    out.x = x;
    out.z = z;
    return out;
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** World-space UV of a point on a horizontal surface (u = x, v = -z, scaled by texture units). */
  _topUV(t, x, z, units, out) {
    out.u = x / units[0];
    out.v = -z / units[1];
    return out;
  }

  /** Should tops wearing texture `name` get the organic shader variation? */
  _varies(name) {
    if (!this.options.uvVariation || !ORGANIC_TOPS.has(name)) return false;
    const u = this.textures.meta(name).units;
    return Math.abs(u[0] - u[1]) < 1e-6; // quarter turns need square repeats
  }

  /**
   * Shader patches shared by every TileMap material: wall ground-bounce (all), organic UV
   * variation (`variation`), decal mask shading (`decal`). One program per combination.
   */
  _patchMaterial(m, name, variation, decal) {
    const units = variation ? this.textures.meta(name).units : null;
    const seed = (this.seed % 997) * 0.731 + 3.17;
    const bounce = this._bounceUniform;
    m.onBeforeCompile = (shader) => {
      // shared uniform objects (one write updates every material)
      shader.uniforms.uLmBounce = bounce;
      shader.uniforms.uSunColor = globalUniforms.uSunColor;
      shader.uniforms.uSunDirection = globalUniforms.uSunDirection;
      let fs = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BOUNCE_PARS}${variation ? VARIATION_GLSL : ''}`)
        .replace('#include <lights_fragment_maps>', BOUNCE_APPLY);
      if (variation) {
        shader.uniforms.lmUnits = { value: new THREE.Vector2(units[0], units[1]) };
        shader.uniforms.lmVarSeed = { value: seed };
        fs = fs.replace('#include <map_fragment>', VARIATION_MAP).replace('#include <normal_fragment_maps>', VARIATION_NORMAL);
      }
      if (decal) fs = fs.replace('#include <alphamap_fragment>', DECAL_ALPHA);
      shader.fragmentShader = fs;
    };
    m.customProgramCacheKey = () => `luminati-tilemap${variation ? '-var' : ''}${decal ? '-decal' : ''}`;
  }

  /** Strength of the ground-bounce fill on vertical faces (0 = off, 1 = default). Live. */
  get wallBounce() { return this._bounceUniform.value; }
  set wallBounce(v) { this._bounceUniform.value = v; }

  /** Low-frequency warm/cool + brightness tint → this._tmpTint. */
  _tint(x, z, amount = 1) {
    const s = this.options.tintStrength * amount;
    // (option objects made once: this runs for every vertex)
    const a = (fbm2(x * 0.11, z * 0.11, (this._tintOptsA ??= { octaves: 3, seed: this.seed + 7 })) - 0.5) * 2.6;
    const b = (fbm2(x * 0.23 + 17.3, z * 0.23, (this._tintOptsB ??= { octaves: 2, seed: this.seed + 13 })) - 0.5) * 2.2;
    const w = clamp(a, -1, 1) * s;
    const l = 1 + clamp(b, -1, 1) * 0.045 * s;
    const o = this._tmpTint;
    o[0] = (1 + 0.045 * w) * l;
    o[1] = (1 + 0.012 * w) * l;
    o[2] = (1 - 0.06 * w) * l;
    return o;
  }

  /** Larger-scale tint for vertical faces: rock patches, cool at the base, mossy under grass lips. */
  _sideTint(x, y, z, top, mossy) {
    const s = this.options.tintStrength;
    const u = x * 0.9 + z * 0.9;
    const a = (fbm2(u * 0.38 + 3.1, y * 0.55, { octaves: 3, seed: this.seed + 17 }) - 0.5) * 2.4;
    const b = (fbm2(u * 0.13, y * 0.2 + 9.7, { octaves: 2, seed: this.seed + 19 }) - 0.5) * 2.2;
    const l = 1 + clamp(a, -1, 1) * 0.11 * s;
    const w = clamp(b, -1, 1) * s;
    const o = this._tmpTint;
    o[0] = (1 + 0.05 * w) * l;
    o[1] = (1 + 0.015 * w) * l;
    o[2] = (1 - 0.06 * w) * l;
    if (mossy) {
      const m = (1 - smoothstep(0.1, 0.75, top - y)) * 0.5 * s;
      o[0] *= 1 - 0.14 * m;
      o[1] *= 1 + 0.05 * m;
      o[2] *= 1 - 0.2 * m;
    }
    return o;
  }

  /**
   * 0..1 wetness of a point on a bank at height h: close (≤ 0.35) to a water tile whose surface
   * is at most 0.4 below h.
   */
  _wetness(x, z, h) {
    const i0 = Math.floor(x);
    const j0 = Math.floor(z);
    let best = 1e9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const w = this.tileAt(i0 + di, j0 + dj);
        if (!w || !w.water || w.waterSurface === null || h - w.waterSurface > 0.4 || h < w.waterSurface - 0.01) continue;
        const dx = Math.max(w.i - x, 0, x - (w.i + 1));
        const dz = Math.max(w.j - z, 0, z - (w.j + 1));
        best = Math.min(best, Math.hypot(dx, dz));
      }
    }
    return best > 0.35 ? 0 : 1 - smoothstep(0, 0.35, best);
  }

  /** Horizon-based AO of a point on a horizontal surface at height h. */
  _aoTop(x, z, h) {
    let sum = 0;
    for (let d = 0; d < 8; d++) {
      let occ = 0;
      for (let k = 0; k < AO_DIST.length; k++) {
        const dist = AO_DIST[k];
        const dh = this._surface(x + AO_DX[d] * dist, z + AO_DZ[d] * dist) - h;
        if (dh > 0.02) {
          const s = (dh / Math.sqrt(dist * dist + dh * dh)) * (1 - dist / AO_RANGE);
          if (s > occ) occ = s;
        }
      }
      sum += occ;
    }
    return clamp(1 - (this.options.aoStrength * sum) / 8, 0.28, 1);
  }

  /** AO for a point on a vertical face. */
  _aoWall(x, y, z, F, groundY, edge, overhangTop) {
    let ao = 1;
    if (edge) ao *= lerp(0.24, 1, smoothstep(0, 2.8, y - this.baseY));
    else ao *= lerp(0.58, 1, smoothstep(0, 1.15, y - groundY));
    // concave corners: perpendicular walls rising in front of the face
    const px = x + F.nx * 0.14;
    const pz = z + F.nz * 0.14;
    let occ = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 2; k++) {
        const d = k === 0 ? 0.18 : 0.42;
        if (this._surface(px + F.rx * side * d, pz + F.rz * side * d) > y + 0.02) { occ += k === 0 ? 0.26 : 0.14; break; }
      }
    }
    ao *= 1 - Math.min(0.45, occ);
    if (overhangTop !== null) ao *= lerp(0.66, 1, smoothstep(0.02, 0.4, overhangTop - y));
    return clamp(ao, 0.2, 1);
  }

  _builder(key, t, withUv1 = false) {
    const cs = this.options.chunkSize;
    const chunk = `${Math.floor(t.i / cs)},${Math.floor(t.j / cs)}`;
    const k = `${key}@${chunk}`;
    let b = this._builders.get(k);
    if (!b) {
      b = new MeshBuilder(withUv1);
      b.key = key;
      b.chunk = chunk;
      this._builders.set(k, b);
    }
    return b;
  }

  _terrainMaterial(name, variation = false) {
    const key = `terrain:${name}${variation ? ':var' : ''}`;
    let m = this._materials.get(key);
    if (m) return m;
    const tex = this.textures;
    const normalMap = tex.normal(name);
    const ns = (typeof tex.pixels === 'function' && tex.pixels(name)?.normalScale) || 0.6;
    m = new THREE.MeshLambertMaterial({ map: tex.get(name), vertexColors: true });
    if (normalMap) { m.normalMap = normalMap; m.normalScale = new THREE.Vector2(ns, ns); }
    m.name = `TileMap:${name}${variation ? ':var' : ''}`;
    this._patchMaterial(m, name, variation, false);
    this._materials.set(key, m);
    return m;
  }

  _maskTex() {
    if (!this._maskTexture) {
      this._maskPixels = paintDecalMask(this.seed + 9001);
      const t = this._maskPixels.toTexture({ wrap: 'repeat', mipmaps: false, srgb: false, name: 'TileMap:decalMask' });
      t.channel = 1;
      this._maskTexture = t;
    }
    return this._maskTexture;
  }

  _decalMaterial(name, variation = false) {
    const key = `decal:${name}${variation ? ':var' : ''}`;
    let m = this._materials.get(key);
    if (m) return m;
    const tex = this.textures;
    const normalMap = tex.normal(name);
    const ns = (typeof tex.pixels === 'function' && tex.pixels(name)?.normalScale) || 0.6;
    m = new THREE.MeshLambertMaterial({
      map: tex.get(name),
      alphaMap: this._maskTex(),
      alphaTest: 0.5,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    if (normalMap) { m.normalMap = normalMap; m.normalScale = new THREE.Vector2(ns, ns); }
    m.name = `TileMap:decal:${name}${variation ? ':var' : ''}`;
    // The mask's red channel is a per-pixel shade (rim darkening, lit blade tips).
    this._patchMaterial(m, name, variation, true);
    this._materials.set(key, m);
    return m;
  }

  _build() {
    runSteps(this.buildSteps());
  }

  /**
   * The terrain meshes as a step generator (src/engine/utils/steps.js): a step per tile emitted,
   * per tile's fringes and per mesh made, in the order of a whole build — every tile row by row,
   * then the fringes, then the meshes. The constructor runs it at once; a TileMap made with
   * `deferBuild: true` has no meshes until the caller has run it to its end (once).
   * @returns {Generator<undefined, void>}
   */
  * buildSteps() {
    const W = this.width;
    for (let j = 0; j < this.depth; j++) {
      for (let i = 0; i < W; i++) {
        const t = this._tiles[j * W + i];
        if (!t) continue;
        this._emitTile(t);
        yield;
      }
    }
    if (this.options.fringes) {
      for (let j = 0; j < this.depth; j++) {
        for (let i = 0; i < W; i++) {
          const t = this._tiles[j * W + i];
          if (!t) continue;
          this._emitFringesAt(i, j, t);
          yield;
        }
      }
    }
    yield* this._flushBuilderSteps();
  }

  /** Top (or stairs) and vertical faces of one tile. */
  _emitTile(t) {
    if (t.stairs) this._emitStairs(t);
    else this._emitTop(t);
    for (const d of DIR_KEYS) this._emitSides(t, FACES[d]);
  }

  /** Turn the pending MeshBuilders into meshes (tagged with their chunk) and add them. */
  _flushBuilders() {
    return runSteps(this._flushBuilderSteps());
  }

  /**
   * `_flushBuilders` as a step generator: a step per mesh made; the meshes are added at the end.
   * @returns {Generator<undefined, THREE.Mesh[]>}
   */
  * _flushBuilderSteps() {
    const meshes = [];
    for (const b of this._builders.values()) {
      if (!b.count) continue;
      const [rawKind, name] = b.key.split(':');
      const fixed = rawKind.endsWith('X'); // legend uvVariation: false
      const kind = fixed ? rawKind.slice(0, -1) : rawKind;
      const decal = kind === 'fringe' || kind === 'brim' || kind === 'skirt';
      const varies = !fixed && (kind === 'top' || kind === 'fringe' || kind === 'brim') && this._varies(name);
      const material = decal ? this._decalMaterial(name, varies) : this._terrainMaterial(name, varies);
      const mesh = new THREE.Mesh(b.toGeometry(), material);
      mesh.name = b.key;
      // Tops face the (always above-horizon) sun: the shadow pass renders their back faces, which
      // are all culled, so they would only cost draw calls and vertex work. Sides, brims and
      // skirts are the real casters.
      mesh.castShadow = kind !== 'fringe' && kind !== 'top';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.kind = kind;
      mesh.userData.chunk = b.chunk;
      if (decal) mesh.renderOrder = 1;
      meshes.push(mesh);
      yield;
    }
    // Stable draw order: terrain first, decals last.
    meshes.sort((a, b) => a.renderOrder - b.renderOrder || (a.name < b.name ? -1 : 1));
    for (const m of meshes) this.object.add(m);
    this.object.updateMatrixWorld(true);
    this._builders.clear();
    return meshes;
  }

  /**
   * Fewer draw calls on big maps (the game; after the build): the per-chunk meshes of each
   * material are merged into spatially compact batches of up to `maxTriangles`, spanning at most
   * `maxExtent` world units of chunk centres (a k-d split over the chunk centres; a material with
   * fewer than `minTriangles` in all stays one batch whatever its extent), so the camera and the
   * shadow pass still cull what they can't see. Rendering is unchanged; a later `rebuildChunks`
   * rebuilds every chunk of a touched batch.
   * @param {{ maxTriangles?: number, maxExtent?: number, minTriangles?: number }} [opts]
   * @returns {number} how many meshes fewer there are
   */
  consolidateChunks(opts = {}) {
    return runSteps(this.consolidateChunkSteps(opts));
  }

  /**
   * {@link consolidateChunks} as a step generator (src/engine/utils/steps.js): a step per batch
   * merged.
   * @param {{ maxTriangles?: number, maxExtent?: number, minTriangles?: number }} [opts]
   * @returns {Generator<undefined, number>} how many meshes fewer there are
   */
  * consolidateChunkSteps({ maxTriangles = 48000, maxExtent = Infinity, minTriangles = 0 } = {}) {
    const cs = this.options.chunkSize;
    const groups = new Map();
    for (const m of /** @type {SolidMesh[]} */ (this.object.children)) {
      if (!m.isMesh || m.userData.chunks) continue;
      const k = `${m.name}|${m.material.uuid}|${+m.castShadow}|${m.renderOrder}`;
      let list = groups.get(k);
      if (!list) groups.set(k, (list = []));
      list.push(m);
    }
    const before = this.object.children.length;
    const centre = (m) => m.userData.chunk.split(',').map((v) => (Number(v) + 0.5) * cs);
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const parts = kdSplit(list, {
        x: (m) => centre(m)[0], z: (m) => centre(m)[1], weight: (m) => triangleCount(m.geometry), maxWeight: maxTriangles, maxExtent, minWeight: minTriangles,
      });
      for (const part of parts) {
        if (part.length < 2) continue;
        const g = mergeGeometries(part.map((m) => m.geometry), false);
        if (!g) continue;
        const src = part[0];
        const mesh = new THREE.Mesh(g, src.material);
        mesh.name = src.name;
        mesh.castShadow = src.castShadow;
        mesh.receiveShadow = src.receiveShadow;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = src.renderOrder;
        mesh.userData.kind = src.userData.kind;
        mesh.userData.chunks = part.map((m) => m.userData.chunk);
        for (const m of part) {
          m.removeFromParent();
          m.geometry.dispose();
        }
        this.object.add(mesh);
        yield;
      }
    }
    // the stable draw order of _flushBuilders: terrain first, decals last
    const meshes = [...this.object.children].sort((a, b) => a.renderOrder - b.renderOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.object.clear();
    for (const m of meshes) this.object.add(m);
    this.object.updateMatrixWorld(true);
    return before - this.object.children.length;
  }

  /**
   * Incremental rebuild for editors: re-reads the tiles inside `rect` from `map` (the edited
   * version of the map this TileMap was built from — same size; tile chars / heights inside the
   * rect may differ) and rebuilds only the mesh chunks those tiles can affect (baked AO, faces,
   * fringes and brims reach 2 tiles around a change). Much cheaper than a new TileMap for small
   * edits on big maps: use a small `chunkSize` (e.g. 16) for maps that are edited this way.
   * Colliders and walk surfaces are kept. Water meshes built from this TileMap are not updated
   * (rebuild them if water tiles changed).
   *
   * Returns null — and changes nothing — when a full rebuild is needed instead: the map size
   * changed, or the terrain now dips below the lowest height the diorama base (`baseY`) was built
   * for.
   * @param {TileMapInput} map the edited map (same size and `waterLevel`)
   * @param {TileRect} rect changed tiles (inclusive)
   * @returns {string[]|null} keys ("ci,cj") of the rebuilt chunks, or null
   */
  rebuildRect(map, rect) {
    const chunks = this.updateTiles(map, rect, { rebase: false });
    if (!chunks) return null;
    this.rebuildChunks(chunks);
    return chunks;
  }

  /**
   * First half of {@link rebuildRect}, for editors that spread the mesh work over several frames:
   * re-reads the tiles inside `rect` from `map` and updates the tile data (heights, water
   * surfaces, walkability — every query such as getHeight / tileAt / getWaterSurface answers for
   * the edited map at once) WITHOUT touching any mesh. Returns the keys of the mesh chunks that
   * must be rebuilt ({@link rebuildChunks}, in any order and at any time; the meshes of a chunk
   * are only exact once it is rebuilt) or null — changing nothing — when a full rebuild is needed
   * (the map size or the global water level changed).
   *
   * `rebase` (default true): when the lowest surface of the map changed, `baseY` (the bottom of
   * the diorama edge faces, `minHeight - baseDepth`) follows it exactly like a fresh build, and
   * every chunk is returned (the edge faces and their AO depend on it). With `rebase: false`
   * (the {@link rebuildRect} behaviour) `baseY` never moves and a map dipping below it returns
   * null.
   * @param {TileMapInput} map the edited map (same size and `waterLevel`)
   * @param {TileRect} rect changed tiles (inclusive)
   * @param {{ rebase?: boolean }} [opts]
   * @returns {string[]|null} chunk keys ("ci,cj") to rebuild, or null
   */
  updateTiles(map, rect, { rebase = true } = {}) {
    const W = this.width;
    const D = this.depth;
    const rows = map?.tiles ?? [];
    if (rows.length !== D || rows.reduce((m, r) => Math.max(m, r.length), 0) !== W) return null;
    if ((map.waterLevel ?? DEFAULT_WATER_LEVEL) !== this.waterLevel) return null;
    const i0 = Math.max(0, Math.floor(rect.minI));
    const i1 = Math.min(W - 1, Math.floor(rect.maxI));
    const j0 = Math.max(0, Math.floor(rect.minJ));
    const j1 = Math.min(D - 1, Math.floor(rect.maxJ));
    if (i1 < i0 || j1 < j0) return [];
    const legend = map.legend ?? {};
    const hRows = map.heights ?? [];
    const fresh = new Map();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const ch = rows[j][i] ?? ' ';
        const type = legend[ch];
        fresh.set(j * W + i, type && !type.void ? makeTile(ch, type, (hRows[j] ?? '')[i], i, j) : null);
      }
    }
    let minH = Infinity;
    let maxH = -Infinity;
    for (let k = 0; k < this._tiles.length; k++) {
      const t = fresh.has(k) ? fresh.get(k) : this._tiles[k];
      if (!t) continue;
      minH = Math.min(minH, t.h);
      maxH = Math.max(maxH, t.h + (t.stairs ? LEVEL_HEIGHT : 0));
    }
    if (!Number.isFinite(minH)) return null;
    // the diorama base was built for the original lowest surface; going lower needs a new build
    // (or, with `rebase`, a new base under every chunk)
    if (!rebase && minH < this.baseY + this.options.baseDepth - EPS) return null;

    this.map = map;
    for (const [k, t] of fresh) {
      this._tiles[k] = t;
      if (t && t.water) {
        const s = this._computeWaterSurface(t, this.waterLevel);
        t.waterSurface = s.level;
        t.waterSource = s.source;
      }
    }
    this.minHeight = minH;
    this.maxHeight = maxH;

    const cs = this.options.chunkSize;
    const baseY = minH - this.options.baseDepth;
    if (rebase && Math.abs(baseY - this.baseY) > EPS) {
      this.baseY = baseY;
      const all = [];
      for (let cj = 0; cj * cs < D; cj++) for (let ci = 0; ci * cs < W; ci++) all.push(`${ci},${cj}`);
      return all;
    }
    // every chunk holding a tile within 2 of the change
    const ci0 = Math.max(0, Math.floor((i0 - 2) / cs));
    const ci1 = Math.min(Math.floor((W - 1) / cs), Math.floor((i1 + 2) / cs));
    const cj0 = Math.max(0, Math.floor((j0 - 2) / cs));
    const cj1 = Math.min(Math.floor((D - 1) / cs), Math.floor((j1 + 2) / cs));
    const chunks = [];
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) chunks.push(`${ci},${cj}`);
    return chunks;
  }

  /**
   * Second half of {@link rebuildRect}: re-bake the meshes of the given chunks ("ci,cj" keys, as
   * returned by {@link updateTiles}) from the current tile data. Rebuilding one chunk per frame
   * keeps an editor's frames short; once every returned chunk is rebuilt the meshes equal a fresh
   * build of the map.
   * @param {Iterable<string>} keys
   * @returns {THREE.Mesh[]} the new meshes
   */
  rebuildChunks(keys) {
    const W = this.width;
    const D = this.depth;
    const cs = this.options.chunkSize;
    const dirty = new Set(keys);
    if (!dirty.size) return [];
    // batches made by consolidateChunks(): a batch touching a dirty chunk goes, with all its chunks
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of this.object.children) {
        const list = m.userData.chunks;
        if (!list || !list.some((k) => dirty.has(k))) continue;
        for (const k of list) if (!dirty.has(k)) { dirty.add(k); grew = true; }
      }
    }
    for (const m of [.../** @type {SolidMesh[]} */ (this.object.children)]) {
      if (!m.isMesh || !(dirty.has(m.userData.chunk) || m.userData.chunks?.some((k) => dirty.has(k)))) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    // chunk order (row-major), like the original rebuildRect
    const list = [...dirty].map((k) => k.split(',').map(Number)).filter(([ci, cj]) => ci >= 0 && cj >= 0 && ci * cs < W && cj * cs < D);
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [ci, cj] of list) {
      const ja = cj * cs;
      const jb = Math.min(D, ja + cs);
      const ia = ci * cs;
      const ib = Math.min(W, ia + cs);
      for (let j = ja; j < jb; j++) {
        for (let i = ia; i < ib; i++) {
          const t = this._tiles[j * W + i];
          if (!t) continue;
          this._emitTile(t);
          if (this.options.fringes) this._emitFringesAt(i, j, t);
        }
      }
    }
    return this._flushBuilders();
  }

  /**
   * {@link rebuildChunks} for ONE chunk, as a generator that yields after every row of tiles, so
   * an editor can spread the re-bake over several frames (run `next()` until its time budget is
   * spent). The chunk's current meshes stay until the last step swaps the new ones in; the result
   * is what rebuildChunks([key]) produces from the tile data of the moment each row is emitted —
   * re-bake again if tiles in reach changed meanwhile. Do not rebuild the same chunk otherwise
   * while this runs.
   * @param {string} key "ci,cj"
   * @returns {Generator<undefined, THREE.Mesh[]>}
   */
  * rebuildChunkSteps(key) {
    const W = this.width;
    const D = this.depth;
    const cs = this.options.chunkSize;
    const [ci, cj] = key.split(',').map(Number);
    if (!(ci >= 0 && cj >= 0 && ci * cs < W && cj * cs < D)) return [];
    const mine = new Map();
    const shared = this._builders;
    const ja = cj * cs;
    const jb = Math.min(D, ja + cs);
    const ia = ci * cs;
    const ib = Math.min(W, ia + cs);
    for (let j = ja; j < jb; j++) {
      this._builders = mine;
      try {
        for (let i = ia; i < ib; i++) {
          const t = this._tiles[j * W + i];
          if (!t) continue;
          this._emitTile(t);
          if (this.options.fringes) this._emitFringesAt(i, j, t);
        }
      } finally {
        this._builders = shared;
      }
      if (j < jb - 1) yield;
    }
    for (const m of [.../** @type {SolidMesh[]} */ (this.object.children)]) {
      if (!m.isMesh || m.userData.chunk !== key) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    this._builders = mine;
    try {
      return this._flushBuilders();
    } finally {
      this._builders = shared;
    }
  }

  /** Flat top: 4×4 lattice with AO + tint baked into vertex colours. */
  _emitTop(t) {
    const name = t.type.top;
    if (!name) return;
    const units = this.textures.meta(name).units;
    const b = this._builder(`${t.type.uvVariation === false ? 'topX' : 'top'}:${name}`, t);
    const uv = this._tmpUV;
    const base = b.count;
    const tintAmt = t.water ? 0.4 : 1;
    for (let r = 0; r <= SUB; r++) {
      for (let c = 0; c <= SUB; c++) {
        const x = t.i + c / SUB;
        const z = t.j + r / SUB;
        this._topUV(t, x, z, units, uv);
        const ao = this._aoTop(x, z, t.h);
        const tint = this._tint(x, z, tintAmt);
        const wet = t.water ? 0 : this._wetness(x, z, t.h) * 0.2;
        b.v(x, t.h, z, 0, 1, 0, uv.u, uv.v, tint[0] * Math.pow(ao, 1.08) * (1 - wet * 1.1), tint[1] * ao * (1 - wet), tint[2] * Math.pow(ao, 0.9) * (1 - wet * 0.6));
      }
    }
    const row = SUB + 1;
    for (let r = 0; r < SUB; r++) {
      for (let c = 0; c < SUB; c++) {
        const a = base + r * row + c;
        b.quad(a, a + row, a + row + 1, a + 1);
      }
    }
  }

  /** Four real steps (treads + risers). */
  _emitStairs(t) {
    const name = t.type.top;
    if (!name) return;
    const dir = t.stairs;
    const F = FACES[dir];
    const units = this.textures.meta(name).units;
    const riserName = t.type.riser || name;
    const rUnits = this.textures.meta(riserName).units;
    const bt = this._builder(`top:${name}`, t);
    const br = this._builder(`side:${riserName}`, t);
    const uv = this._tmpUV;
    for (let k = 0; k < STAIR_STEPS; k++) {
      const y = t.h + (k + 1) * STEP_H;
      const t0 = k / STAIR_STEPS;
      const t1 = (k + 1) / STAIR_STEPS;
      // tread rect in local coords
      let lx0 = 0, lx1 = 1, lz0 = 0, lz1 = 1;
      if (dir === 'N') { lz0 = 1 - t1; lz1 = 1 - t0; }
      else if (dir === 'S') { lz0 = t0; lz1 = t1; }
      else if (dir === 'E') { lx0 = t0; lx1 = t1; }
      else { lx0 = 1 - t1; lx1 = 1 - t0; }
      const cols = dir === 'N' || dir === 'S' ? SUB : 1;
      const rows = dir === 'N' || dir === 'S' ? 1 : SUB;
      const base = bt.count;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = t.i + lerp(lx0, lx1, c / cols);
          const z = t.j + lerp(lz0, lz1, r / rows);
          this._topUV(t, x, z, units, uv);
          // nosing highlight at the tread's front edge, AO at the back (under the next riser)
          const p = stairT(dir, x - t.i, z - t.j);
          const front = Math.abs(p - t0) < 1e-4;
          let ao = this._aoTop(x, z, y);
          if (!front && k < STAIR_STEPS - 1) ao *= 0.68;
          const hi = front ? 1.22 : 1;
          b3(bt, x, y, z, 0, 1, 0, uv.u, uv.v, ao * hi);
        }
      }
      const rowN = cols + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = base + r * rowN + c;
          bt.quadN(a, a + rowN, a + rowN + 1, a + 1, 0, 1, 0);
        }
      }
      // riser at progress t0, facing the low side
      const R = FACES[OPPOSITE[dir]];
      const y0 = t.h + k * STEP_H;
      let cx = t.i + 0.5, cz = t.j + 0.5;
      if (dir === 'N') cz = t.j + 1 - t0;
      else if (dir === 'S') cz = t.j + t0;
      else if (dir === 'E') cx = t.i + t0;
      else cx = t.i + 1 - t0;
      const lx = cx - R.rx * 0.5, lz = cz - R.rz * 0.5;
      const rbase = br.count;
      for (let c = 0; c <= SUB; c++) {
        const s = c / SUB;
        const x = lx + R.rx * s;
        const z = lz + R.rz * s;
        const u = (x * R.rx + z * R.rz) / rUnits[0];
        b3(br, x, y0, z, R.nx, 0, R.nz, u, y0 / rUnits[1], 0.5);
        b3(br, x, y, z, R.nx, 0, R.nz, u, y / rUnits[1], 0.9);
      }
      for (let c = 0; c < SUB; c++) {
        const a = rbase + c * 2;
        br.quadN(a, a + 2, a + 3, a + 1, R.nx, 0, R.nz);
      }
    }
  }

  /** Surface heights along a tile edge (4 quarter segments, canonical +x / +z order). */
  _edgeProfile(t, dir, out) {
    if (!t) { out[0] = out[1] = out[2] = out[3] = this.baseY; return out; }
    if (!t.stairs || OPPOSITE[t.stairs] === dir) { out[0] = out[1] = out[2] = out[3] = t.h; return out; }
    for (let s = 0; s < 4; s++) {
      const a = (s + 0.5) / 4;
      let lx, lz;
      if (dir === 'N') { lx = a; lz = 0.001; }
      else if (dir === 'S') { lx = a; lz = 0.999; }
      else if (dir === 'E') { lx = 0.999; lz = a; }
      else { lx = 0.001; lz = a; }
      out[s] = this._topAt(t, lx, lz);
    }
    return out;
  }

  _emitSides(t, F) {
    const n = this.tileAt(t.i + F.dx, t.j + F.dz);
    const own = this._edgeProfile(t, F.key, this._ep0 || (this._ep0 = [0, 0, 0, 0]));
    const nb = this._edgeProfile(n, OPPOSITE[F.key], this._ep1 || (this._ep1 = [0, 0, 0, 0]));
    const edge = !n;
    let s = 0;
    while (s < 4) {
      let e = s + 1;
      while (e < 4 && Math.abs(own[e] - own[s]) < EPS && Math.abs(nb[e] - nb[s]) < EPS) e++;
      const top = own[s];
      const bottom = nb[s];
      if (top > bottom + EPS) this._emitFace(t, F, s / 4, e / 4, bottom, top, edge, n && n.water ? n.waterSurface : null);
      s = e;
    }
  }

  /** Point on edge `F` of tile t at canonical parameter a. */
  _edgePoint(t, F, a) {
    const p = this._ptmp || (this._ptmp = { x: 0, z: 0 });
    switch (F.key) {
      case 'N': p.x = t.i + a; p.z = t.j; break;
      case 'S': p.x = t.i + a; p.z = t.j + 1; break;
      case 'E': p.x = t.i + 1; p.z = t.j + a; break;
      default: p.x = t.i; p.z = t.j + a; break;
    }
    return p;
  }

  _emitFace(t, F, a0, a1, bottom, top, edge, wetY = null) {
    const type = t.type;
    const lip = type.lip || null;
    const side = type.side || lip || type.top;
    if (!side) return;
    const lipBottom = lip ? Math.max(bottom, top - LIP_HEIGHT) : top;
    const grassy = GRASS_TOPS.has(type.top) && !t.stairs && type.overhang !== false;
    const overhang = this.options.overhangs && grassy && lip && top - bottom >= 0.24 && Math.abs(top - t.h) < EPS;
    const ohTop = overhang ? top : null;
    if (wetY !== null && (wetY < bottom || wetY > top + 0.2)) wetY = null;
    if (lip) this._faceBand(t, F, a0, a1, lipBottom, top, lip, true, top, bottom, edge, ohTop, wetY);
    if (lipBottom > bottom + EPS) this._faceBand(t, F, a0, a1, bottom, lipBottom, side, false, top, bottom, edge, ohTop, wetY);
    if (overhang) this._emitOverhang(t, F, a0, a1, top, top - bottom);
  }

  _faceBand(t, F, a0, a1, yb, yt, name, isLip, faceTop, groundY, edge, ohTop, wetY = null) {
    const meta = this.textures.meta(name);
    const units = meta.units;
    const b = this._builder(`side:${name}`, t);
    // world-aligned rows every 0.5 (plus a row under an overhang)
    const ys = [yb];
    for (let y = Math.floor(yb / 0.5 + 1 - EPS) * 0.5; y < yt - EPS; y += 0.5) if (y > yb + EPS) ys.push(y);
    if (ohTop !== null && ohTop - 0.25 > yb + EPS && ohTop - 0.25 < yt - EPS && !ys.some((v) => Math.abs(v - (ohTop - 0.25)) < EPS)) ys.push(ohTop - 0.25);
    if (wetY !== null) {
      for (const w of [wetY, wetY + 0.14]) if (w > yb + EPS && w < yt - EPS && !ys.some((v) => Math.abs(v - w) < EPS)) ys.push(w);
    }
    ys.push(yt);
    ys.sort((p, q) => p - q);
    let uOff = 0;
    if (this.options.sideVariation) uOff = Math.floor(hash2(t.i * 4 + F.idx, t.j, this.seed + 303) * meta.px[0]) / meta.px[0];
    // columns left → right
    const pa = this._edgePoint(t, F, a0);
    const ax = pa.x, az = pa.z;
    const pb = this._edgePoint(t, F, a1);
    const bx = pb.x, bz = pb.z;
    const ua = ax * F.rx + az * F.rz;
    const ub = bx * F.rx + bz * F.rz;
    const lx = ua <= ub ? ax : bx, lz = ua <= ub ? az : bz;
    const rxp = ua <= ub ? bx : ax, rzp = ua <= ub ? bz : az;
    const cols = Math.max(1, Math.round((a1 - a0) * SUB));
    const base = b.count;
    for (let c = 0; c <= cols; c++) {
      const s = c / cols;
      const x = lerp(lx, rxp, s);
      const z = lerp(lz, rzp, s);
      const u = (x * F.rx + z * F.rz) / units[0] + uOff;
      for (let r = 0; r < ys.length; r++) {
        const y = ys[r];
        const v = isLip ? (y - faceTop) / units[1] + 1 : y / units[1];
        const ao = this._aoWall(x, y, z, F, groundY, edge, ohTop);
        const tint = this._sideTint(x, y, z, faceTop, ohTop !== null);
        // wet band just above the waterline, darker still below it (seen through the water)
        const wet = wetY === null ? 0 : y <= wetY + EPS ? 0.3 : 0.3 * (1 - smoothstep(wetY, wetY + 0.14, y));
        b.v(x, y, z, F.nx, 0, F.nz, u, v, tint[0] * Math.pow(ao, 1.06) * (1 - wet), tint[1] * ao * (1 - wet * 0.9), tint[2] * Math.pow(ao, 0.92) * (1 - wet * 0.6));
      }
    }
    const nr = ys.length;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < nr - 1; r++) {
        const bl = base + c * nr + r;
        const br = base + (c + 1) * nr + r;
        b.quad(bl, br, br + 1, bl + 1);
      }
    }
  }

  /** Is the edge end (side = -1 at a = 0, +1 at a = 1) of tile t's face F a convex corner? */
  _convexEnd(t, F, side, top) {
    // lateral direction of the canonical axis: N/S → x, E/W → z
    const latX = F.dx === 0 ? 1 : 0;
    const latZ = F.dx === 0 ? 0 : 1;
    const p = this._edgePoint(t, F, side < 0 ? 0 : 1);
    const sx = p.x + latX * side * 0.06 - F.nx * 0.06;
    const sz = p.z + latZ * side * 0.06 - F.nz * 0.06;
    return this._surface(sx, sz) < top - 0.2;
  }

  /** Grass brim + hanging skirt along the top of a grassy cliff face. */
  _emitOverhang(t, F, a0, a1, top, faceH) {
    const name = t.type.top;
    const units = this.textures.meta(name).units;
    const fx = t.type.uvVariation === false ? 'X' : '';
    let b = this._builder(`brim${fx}:${name}`, t, true);
    const uv = this._tmpUV;
    const latX = F.dx === 0 ? 1 : 0;
    const latZ = F.dx === 0 ? 0 : 1;
    const convex0 = a0 === 0 && this._convexEnd(t, F, -1, top);
    const convex1 = a1 === 1 && this._convexEnd(t, F, 1, top);
    const ext = BRIM_DEPTH;
    let p = this._edgePoint(t, F, a0);
    const px0 = p.x, pz0 = p.z;
    p = this._edgePoint(t, F, a1);
    const px1 = p.x, pz1 = p.z;
    const x0 = px0 - (convex0 ? latX * ext : 0), z0 = pz0 - (convex0 ? latZ * ext : 0);
    const x1 = px1 + (convex1 ? latX * ext : 0), z1 = pz1 + (convex1 ? latZ * ext : 0);
    // Brim (horizontal). Only N/S brims extend over convex corners (avoids coplanar overlap).
    const bx0 = F.dx === 0 ? x0 : px0, bz0 = F.dx === 0 ? z0 : pz0;
    const bx1 = F.dx === 0 ? x1 : px1, bz1 = F.dx === 0 ? z1 : pz1;
    const segs = Math.max(1, Math.round(Math.hypot(bx1 - bx0, bz1 - bz0) * SUB));
    const vIn = 1 - (MASK_ROWS.brim - DECAL_OVERLAP * PPU) / MASK_H;
    const vOut = 1 - (MASK_ROWS.brim + BRIM_DEPTH * PPU) / MASK_H;
    let base = b.count;
    for (let c = 0; c <= segs; c++) {
      const s = c / segs;
      const x = lerp(bx0, bx1, s);
      const z = lerp(bz0, bz1, s);
      const along = x * latX + z * latZ;
      const tint = this._tint(x, z);
      for (let k = 0; k < 2; k++) {
        // the inner edge overlaps the top by 1 px (same world UV → invisible) so no seam can open
        const o = k ? BRIM_DEPTH : -DECAL_OVERLAP;
        const px = x + F.nx * o;
        const pz = z + F.nz * o;
        this._topUV(t, px, pz, units, uv);
        b.v(px, top + 0.0006 * (F.idx + 1), pz, 0, 1, 0, uv.u, uv.v, tint[0], tint[1], tint[2], along / 4, k ? vOut : vIn);
      }
    }
    for (let c = 0; c < segs; c++) {
      const a = base + c * 2;
      b.quadN(a, a + 1, a + 3, a + 2, 0, 1, 0);
    }
    // Skirt (vertical, hanging from the brim's outer edge).
    const sd = Math.min(SKIRT_MAX, faceH * 0.72);
    const ox = F.nx * BRIM_DEPTH, oz = F.nz * BRIM_DEPTH;
    const ua = x0 * F.rx + z0 * F.rz;
    const ub = x1 * F.rx + z1 * F.rz;
    const lx = (ua <= ub ? x0 : x1) + ox, lz = (ua <= ub ? z0 : z1) + oz;
    const rx = (ua <= ub ? x1 : x0) + ox, rz = (ua <= ub ? z1 : z0) + oz;
    const ssegs = Math.max(1, Math.round(Math.hypot(rx - lx, rz - lz) * SUB));
    b = this._builder(`skirt:${name}`, t, true);
    base = b.count;
    for (let c = 0; c <= ssegs; c++) {
      const s = c / ssegs;
      const x = lerp(lx, rx, s);
      const z = lerp(lz, rz, s);
      const u = (x * F.rx + z * F.rz) / units[0];
      const along = (x - ox) * latX + (z - oz) * latZ;
      const tint = this._tint(x, z);
      for (let k = 0; k < 2; k++) {
        const y = k ? top : top - sd;
        const v1 = 1 - (MASK_ROWS.skirt + (k ? 0 : sd * PPU)) / MASK_H; // 16 px/unit: short faces cut the mask
        const sh = k ? 1.0 : 0.82;
        b.v(x, y, z, F.nx, 0, F.nz, u, -y / units[1], tint[0] * sh, tint[1] * sh, tint[2] * sh, along / 4, v1);
      }
    }
    for (let c = 0; c < ssegs; c++) {
      const a = base + c * 2;
      b.quadN(a, a + 2, a + 3, a + 1, F.nx, 0, F.nz);
    }
  }

  /** Does tile n spill a grass fringe onto receiver tile r (same height, higher priority)? */
  _isGrassSource(n, r) {
    if (!n || n.stairs || n.water || n.type.fringe === false || Math.abs(n.h - r.h) > EPS) return false;
    const src = n.type.top;
    if (!GRASS_TOPS.has(src)) return false;
    const dst = r.type.top;
    if (FRINGE_RECEIVERS.has(dst)) return true;
    return GRASS_TOPS.has(dst) && (FRINGE_PRIORITY[src] ?? 0) > (FRINGE_PRIORITY[dst] ?? 0);
  }

  /** Grass fringes spilling from grass tiles onto receivers at the same height (+ corner tufts). */
  _emitFringes() {
    this.forEachTile((i, j, t) => this._emitFringesAt(i, j, t));
  }

  /** Fringes / corner tufts received by one tile. */
  _emitFringesAt(i, j, t) {
    const uv = this._tmpUV;
    {
      if (t.stairs || t.water || t.type.fringe === false) return;
      if (!FRINGE_RECEIVERS.has(t.type.top) && !GRASS_TOPS.has(t.type.top)) return;
      const src = [];
      for (const d of DIR_KEYS) {
        const F = FACES[d];
        const n = this.tileAt(i + F.dx, j + F.dz);
        src.push(this._isGrassSource(n, t) ? n : null);
      }
      for (let k = 0; k < 4; k++) {
        const n = src[k];
        if (!n) continue;
        const F = FACES[DIR_KEYS[k]];
        const name = n.type.top;
        const units = this.textures.meta(name).units;
        const b = this._builder(`fringe${n.type.uvVariation === false ? 'X' : ''}:${name}`, t, true);
        const latX = F.dx === 0 ? 1 : 0;
        const latZ = F.dx === 0 ? 0 : 1;
        const strip = hash2(i + F.idx * 7, j, this.seed + 404) < 0.5 ? MASK_ROWS.stripA : MASK_ROWS.stripB;
        // Tiny deterministic lift per source priority / direction: overlapping decals (corners)
        // never z-fight; the 1 px overlap hides the sub-texel projection offset of the lift.
        const y = t.h + decalLift(name, F.idx);
        const p = this._edgePoint(t, F, 0);
        const ex = p.x, ez = p.z;
        const base = b.count;
        for (let c = 0; c <= SUB; c++) {
          const s = c / SUB;
          for (let e = 0; e < 2; e++) {
            const dist = e ? FRINGE_DEPTH : -DECAL_OVERLAP;
            const x = ex + latX * s - F.nx * dist;
            const z = ez + latZ * s - F.nz * dist;
            this._topUV(n, x, z, units, uv);
            const along = x * latX + z * latZ;
            const ao = this._aoTop(x, z, t.h);
            const tint = this._tint(x, z);
            const v1 = 1 - (strip + dist * PPU) / MASK_H;
            b.v(x, y, z, 0, 1, 0, uv.u, uv.v, tint[0] * Math.pow(ao, 1.08), tint[1] * ao, tint[2] * Math.pow(ao, 0.9), along / 4, v1);
          }
        }
        for (let c = 0; c < SUB; c++) {
          const a = base + c * 2;
          b.quadN(a, a + 1, a + 3, a + 2, 0, 1, 0);
        }
      }
      // Corner tufts where grass only touches diagonally.
      const corners = [
        [-1, -1, 0, 3], // NW: N (0) and W (3)
        [1, -1, 0, 1], // NE
        [1, 1, 2, 1], // SE
        [-1, 1, 2, 3], // SW
      ];
      for (let c = 0; c < 4; c++) {
        const [sx, sz, ka, kb] = corners[c];
        if (src[ka] || src[kb]) continue;
        const dg = this.tileAt(i + sx, j + sz);
        if (!this._isGrassSource(dg, t)) continue;
        const name = dg.type.top;
        const units = this.textures.meta(name).units;
        const b = this._builder(`fringe${dg.type.uvVariation === false ? 'X' : ''}:${name}`, t, true);
        const cx = i + (sx > 0 ? 1 : 0);
        const cz = j + (sz > 0 ? 1 : 0);
        const cell = Math.floor(hash2(i, j, this.seed + 505 + c) * CORNER_CELLS) * CORNER_CELL + 1;
        const y = t.h + decalLift(name, 4);
        const base = b.count;
        for (let r = 0; r < 2; r++) {
          for (let q = 0; q < 2; q++) {
            const da = q * FRINGE_DEPTH;
            const db = r * FRINGE_DEPTH;
            const x = cx - sx * da;
            const z = cz - sz * db;
            this._topUV(dg, x, z, units, uv);
            const tint = this._tint(x, z);
            const ao = this._aoTop(x, z, t.h);
            const u1 = (cell + (q ? FRINGE_DEPTH * PPU : 0)) / MASK_W;
            const v1 = 1 - (MASK_ROWS.corner + (r ? FRINGE_DEPTH * PPU : 0)) / MASK_H;
            b.v(x, y, z, 0, 1, 0, uv.u, uv.v, tint[0] * Math.pow(ao, 1.08), tint[1] * ao, tint[2] * Math.pow(ao, 0.9), u1, v1);
          }
        }
        b.quadN(base, base + 2, base + 3, base + 1, 0, 1, 0);
      }
    }
  }

  /** Render statistics of the built terrain. */
  get stats() {
    let meshes = 0;
    let triangles = 0;
    let vertices = 0;
    this.object.traverse((/** @type {SceneNode} */ o) => {
      if (!o.isMesh) return;
      meshes++;
      triangles += o.geometry.index.count / 3;
      vertices += o.geometry.attributes.position.count;
    });
    return { meshes, triangles, vertices, materials: this._materials.size };
  }

  /** Dispose geometries, the TileMap's own materials and the decal mask (library textures are not touched). */
  dispose() {
    this.object.traverse((/** @type {SceneNode} */ o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of this._materials.values()) m.dispose();
    this._materials.clear();
    this._maskTexture?.dispose();
    this._maskTexture = null;
    this.object.removeFromParent();
    this.object.clear();
  }
}

/** Push a vertex with a grey AO shade (slightly cool in the shadows) into a builder. */
function b3(b, x, y, z, nx, ny, nz, u, v, s) {
  return b.v(x, y, z, nx, ny, nz, u, v, Math.pow(s, 1.06), s, Math.pow(s, 0.92));
}
