import { computeCameraBounds } from '../engine/level/ObjectBuilder.js';
import { clamp } from '../engine/utils/math.js';
import { CAMERA } from './config.js';

/**
 * What a level looks like beyond its objects, read the same way by the game (`World`, `Game`) and
 * the level editor's 3D preview (`ObjectPreview`, `SceneryPreview`, `FoliagePreview`,
 * `Viewport3D`): the smoke and waterfall-mist looks, the open ground south of the map, the
 * automatic god-ray area, the ground-foliage call's arguments, the camera dust box and the
 * gameplay camera framing. One copy each, so the preview cannot drift from the game
 * (KNOWN_ISSUES ED-18).
 *
 * @import { Level, LevelEnvironment, LevelObject } from '../engine/level/types.d.ts'
 * @import { TileMap } from '../engine/world/TileMap.js'
 */

/** Softer, greyer chimney / campfire smoke than the preset (it reads as haze, not cotton). */
export const SMOKE = Object.freeze({ alpha: 0.2, color: '#b3aca6', colorEnd: '#85828c', size: [0.3, 0.46], sizeEnd: 3.4 });

/** Waterfall spray: a dense emitter reads as a flat, blooming white smear. Default per unit width. */
export const MIST = Object.freeze({ countPerWidth: 8, alpha: 0.07 });

/**
 * Open ground south of the map before the outer forest (environment.scenery.southGap): the camera
 * looks north, so tall trees right beyond the south edge would hide a player walking near it.
 */
export const SOUTH_GAP = 5;

/** Levels wider or deeper than this many tiles take the big-level batching (World.isBigLevel). */
export const SMALL_LEVEL = 64;

/** Ground-foliage instances per field on a big level (World's BIG_LEVEL_BATCHING.foliageInstances). */
export const BIG_FOLIAGE_INSTANCES = 4000;

/**
 * The most instances a ground-foliage field holds on this level: BIG_FOLIAGE_INSTANCES on a big
 * one (its fields split, the per-tuft jitter follows), unlimited on a small one.
 * @param {{ width: number, depth: number }} level
 * @returns {number}
 */
export function foliageMaxInstances(level) {
  return Math.max(level.width, level.depth) > SMALL_LEVEL ? BIG_FOLIAGE_INSTANCES : Infinity;
}

/**
 * Is this level an **interior** (`environment.interior === true`; absent by default): a room — a
 * house's ground floor, its upper floor, a cellar. Inside a room there is no forest border, no
 * outer scenery, no god rays and no weather (no rain, snow or overcast look; the campaign's weather
 * goes on outside), whatever `border`, `outerScenery`, `godRays` and `weather` say. A campaign
 * keeps the level the player came from while they are in a room, and keeps the last room after
 * they leave it (CAMPAIGN_FORMAT.md), so walking in and out is a light switch, not a level build.
 * The look a room usually also wants is set with the ordinary fields: `backdrop`, `clock: false`
 * with its own `timeOfDay`, `minimap: false`, a closer `camera`.
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {boolean}
 */
export function isInterior(env) {
  return !!env && env.interior === true;
}

/**
 * The level's climate (`environment.climate`, docs/contracts/DRAGON_CAMPAIGN.md §5.2): 'arid' —
 * the arid sky, fog and dust (src/game/Climate.js), the border's and the outer scenery's arid kinds,
 * the ground foliage of the arid textures — or null: temperate, as before (absent, or any other
 * value: level data is untrusted).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {'arid'|null}
 */
export function climateOf(env) {
  return env?.climate === 'arid' ? 'arid' : null;
}

// ---- The Bells of Evermere's fields (EVERMERE_CAMPAIGN.md §5.2; normalizeLevel validates them —
// these read untrusted data all the same)

/**
 * The look under the frost (`environment.season`): 'spring' | 'summer' | 'autumn' | 'winter', or
 * null (absent or any other value: today's temperate look).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {'spring'|'summer'|'autumn'|'winter'|null}
 */
export function seasonOf(env) {
  const s = env?.season;
  return s === 'spring' || s === 'summer' || s === 'autumn' || s === 'winter' ? s : null;
}

/**
 * The level's frost (`environment.frost`) with its defaults — `cover` 1, `at` null, `ice` /
 * `falls` false, `patches` [] — or null (none, or no `until`).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {{ until: string, cover: number, at: [number, number]|null, ice: boolean, falls: boolean,
 *   patches: { when: string, at: [number, number], r: number }[] }|null}
 */
export function frostOf(env) {
  const f = env?.frost;
  if (!f || typeof f !== 'object' || typeof f.until !== 'string' || !f.until.trim()) return null;
  const at = Array.isArray(f.at) && f.at.length === 2 && f.at.every(Number.isFinite) ? /** @type {[number, number]} */ ([f.at[0], f.at[1]]) : null;
  return {
    until: f.until,
    cover: Number.isFinite(f.cover) ? clamp(f.cover, 0.2, 1) : 1,
    at,
    ice: f.ice === true,
    falls: f.falls === true,
    patches: Array.isArray(f.patches) ? f.patches.filter((p) => p && typeof p.when === 'string' && Array.isArray(p.at) && Number.isFinite(p.r)) : [],
  };
}

/**
 * The level's states (`environment.states`): the well-formed entries (an object with a `when`
 * condition), at most 8, in order.
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {import('../engine/level/types.d.ts').LevelState[]}
 */
export function statesOf(env) {
  const s = env?.states;
  return Array.isArray(s) ? s.filter((x) => x && typeof x === 'object' && typeof x.when === 'string' && x.when.trim()).slice(0, 8) : [];
}

/**
 * The aurora's strength at night (`environment.aurora`, 0–1; 0 without one).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {number}
 */
export function auroraOf(env) {
  return Number.isFinite(env?.aurora) ? clamp(env.aurora, 0, 1) : 0;
}

/** The game's own track of each part of play (`soundtrackOf` without a level's `soundtrack`). */
export const DEFAULT_SOUNDTRACK = Object.freeze({ explore: 'emberfall', battle: 'battle', boss: 'boss' });

/**
 * The music track a level plays for a part of play (`environment.soundtrack`, DRAGON_CAMPAIGN.md
 * §5.2): its own name for that part (a non-empty string; whether the AudioSystem knows it is the
 * AudioSystem's business — an unknown track warns there and plays nothing), else the game's —
 * 'emberfall' exploring, 'battle' in a fight, 'boss' in the boss fight (`DEFAULT_SOUNDTRACK`).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @param {'explore'|'battle'|'boss'} part
 * @returns {string}
 */
export function soundtrackOf(env, part) {
  const s = env?.soundtrack;
  const v = s && typeof s === 'object' && Object.hasOwn(s, part) ? s[part] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_SOUNDTRACK[part];
}

/**
 * Border trees on the blocked tiles (`environment.border === 'forest'`), never in a room.
 * @param {Partial<LevelEnvironment>} env
 * @returns {boolean}
 */
export function forestBorderOn(env) {
  return !isInterior(env) && env?.border === 'forest';
}

/**
 * The fogged outer ground, tree clusters and hills (`environment.outerScenery`, on unless `false`),
 * never in a room.
 * @param {Partial<LevelEnvironment>} env
 * @returns {boolean}
 */
export function outerSceneryOn(env) {
  return !isInterior(env) && env?.outerScenery !== false;
}

/**
 * The weather a level shows: the given one outdoors, 'clear' in a room (the weather itself — a
 * campaign's — is kept for the next level outdoors).
 * @param {Partial<LevelEnvironment>} env
 * @param {string} weather
 * @returns {string}
 */
export function shownWeather(env, weather) {
  return isInterior(env) ? 'clear' : weather;
}

/**
 * A level's backdrop (`environment.backdrop`, absent by default: the sky) as a colour: `'void'` is
 * black (`'#000000'`), a `'#rrggbb'` string itself (lower case); null for the sky — no backdrop, or
 * a value that is neither (the game warns about a non-blank one and shows the sky). The rule of
 * `Game._applyBackdrop`; the editor's 3D preview reads the backdrop with it.
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {string|null}
 */
export function backdropColor(env) {
  const b = typeof env?.backdrop === 'string' ? env.backdrop.trim() : '';
  if (b === 'void') return '#000000';
  return /^#[0-9a-fA-F]{6}$/.test(b) ? b.toLowerCase() : null;
}

/** The camera dust's box (world units, centred on the camera focus as it moves). */
export const DUST_BOX = Object.freeze({ x: 20, y: 4.5, z: 16 });

/**
 * A waterfall's mist: `max(4, round(8 × width))` particles at alpha 0.07, unless its `mist`
 * (`{ count, alpha }`) says otherwise.
 * @param {{ width?: number, mist?: { count?: number, alpha?: number } }} obj
 * @returns {{ count: number, alpha: number }}
 */
export function waterfallMist(obj) {
  const width = obj.width ?? 2;
  return { count: Math.max(4, Math.round(MIST.countPerWidth * width)), alpha: MIST.alpha, ...(obj.mist ?? {}) };
}

/**
 * The south gap of a level's outer forest (`environment.scenery.southGap`, else SOUTH_GAP).
 * @param {Partial<LevelEnvironment>} env
 * @returns {number}
 */
export function southGap(env) {
  return Number.isFinite(env?.scenery?.southGap) ? env.scenery.southGap : SOUTH_GAP;
}

/**
 * The god-ray shafts a level gets: its `environment.godRayAreas`, else one area over the walkable
 * ground (`autoGodRayArea`); none with `godRays: false` or in a room (`isInterior`). Malformed areas
 * and counts of 0 are left out; a count is clamped to 0–12, the height and seed default to 0 and 7.
 * @param {Partial<LevelEnvironment>} env
 * @param {Level} level
 * @param {TileMap|null} tileMap
 * @returns {{ bounds: { minX: number, maxX: number, minZ: number, maxZ: number, y: number }, count: number, seed: number }[]}
 */
export function godRayLayout(env, level, tileMap) {
  const out = [];
  if (env.godRays === false || isInterior(env)) return out;
  const areas = Array.isArray(env.godRayAreas) && env.godRayAreas.length ? env.godRayAreas : [autoGodRayArea(level, tileMap)];
  for (const a of areas) {
    if (!a || typeof a !== 'object') continue;
    const count = Math.min(12, Math.max(0, Math.round(a.count ?? 3)));
    if (!count || !(a.maxX > a.minX) || !(a.maxZ > a.minZ)) continue;
    out.push({
      bounds: { minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ, y: Number.isFinite(a.y) ? a.y : 0 },
      count,
      seed: Number.isFinite(a.seed) ? a.seed : 7,
    });
  }
  return out;
}

/**
 * The god-ray area of a level without `environment.godRayAreas`: the camera bounds, at the most
 * common height of the walkable dry tiles, 1–6 shafts by its size.
 * @param {Level} level
 * @param {TileMap|null} tileMap
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number, y: number, count: number, seed: number }}
 */
export function autoGodRayArea(level, tileMap) {
  const r = computeCameraBounds(level, 1);
  // typical ground height of the walkable tiles
  const hist = new Map();
  tileMap?.forEachTile((i, j, t) => {
    if (!t.walkable || t.water) return;
    const k = Math.round(t.h * 2);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  });
  let y = 0;
  let best = -1;
  for (const [k, n] of hist) if (n > best) { best = n; y = k / 2; }
  const area = Math.max(1, (r.maxX - r.minX) * (r.maxZ - r.minZ));
  return { ...r, y, count: Math.max(1, Math.min(6, Math.round(area / 90))), seed: 7 };
}

/**
 * The ground foliage's arguments from the level (GroundDetail.groundDetailSteps takes them with
 * the tile map, the free-ground test, the houses and `maxInstances`): ferns around the trees
 * standing on the map, a clearing around each villager's spot (its `wander`, clamped to 0–8, plus
 * 0.8), the seed (`foliage.seed`, else 2024) and the well-formed `flowerAreas` / `shrubAreas` (a
 * malformed entry is dropped, a flower area keeps palette indices 0–3 only) and `cropAreas`
 * (`foliage.cropAreas`: the well-formed wheat and stubble rects).
 * @param {Level} level
 * @returns {{ trees: { x: number, z: number, r: number }[], clearings: { x: number, z: number, r: number }[],
 *   seed: number, flowerAreas: any[], shrubAreas: any[], cropAreas: any[] }}
 */
export function groundDetailArgs(level) {
  /** @type {Partial<LevelEnvironment>} */
  const env = level.environment ?? {};
  const foliage = env.foliage && typeof env.foliage === 'object' ? env.foliage : {};
  // tile-space zones from the level file: keep only well-formed rects
  const rects = (list) => (Array.isArray(list) ? list : []).filter((a) => a && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(a[k])));
  const flowerAreas = rects(foliage.flowerAreas)
    .map((a) => ({ ...a, palette: (Array.isArray(a.palette) ? a.palette : []).filter((f) => Number.isInteger(f) && f >= 0 && f <= 3) }))
    .filter((a) => a.palette.length);
  const shrubAreas = rects(foliage.shrubAreas).filter((a) => Number.isFinite(a.chance));
  const inMap = (x, z) => x >= 0 && z >= 0 && x <= level.width && z <= level.depth;
  /** @param {string} type @returns {LevelObject[]} */
  const of = (type) => level.objects.filter((o) => o.type === type);
  return {
    // ferns around the roots of the trees standing on the map
    trees: of('tree').filter((o) => inMap(o.x, o.z)).map((o) => ({ x: o.x, z: o.z, r: 0.3 })),
    // villagers stand on readable ground: no tall grass / flower beds / bushes around their spots
    clearings: of('npc').map((o) => ({ x: o.x, z: o.z, r: Math.min(8, Math.max(0, Number.isFinite(/** @type {any} */ (o).wander) ? /** @type {any} */ (o).wander : 1.2)) + 0.8 })),
    seed: Number.isFinite(foliage.seed) ? foliage.seed : 2024,
    flowerAreas,
    shrubAreas,
    // the crops (EVERMERE_CAMPAIGN.md §5.2 `foliage.cropAreas`: GroundDetail's crop fields)
    cropAreas: (Array.isArray(foliage.cropAreas) ? foliage.cropAreas : []).filter((a) => a && ['x', 'z', 'w', 'h'].every((k) => Number.isFinite(a[k])) && (a.kind === 'wheat' || a.kind === 'stubble')),
  };
}

/**
 * A level's gameplay camera framing (`environment.camera`): its distance (8–80, else CAMERA's) and
 * pitch (10–80°), and the zoom range widened to include that distance.
 * @param {Partial<LevelEnvironment>['camera']} [cam]
 * @returns {{ distance: number, pitch: number, minDistance: number, maxDistance: number }}
 */
export function cameraFraming(cam) {
  const c = cam && typeof cam === 'object' ? cam : {};
  const distance = clamp(finite(c.distance, CAMERA.distance), 8, 80);
  return {
    distance,
    pitch: clamp(finite(c.pitch, CAMERA.pitch), 10, 80),
    minDistance: Math.min(CAMERA.minDistance, distance),
    maxDistance: Math.max(CAMERA.maxDistance, distance),
  };
}

/** A finite number from level data (`"12"` reads as 12; null, '' and junk as `d`). */
const finite = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
