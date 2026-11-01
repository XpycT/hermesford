import * as THREE from 'three';
import { PropFactory } from '../world/Props.js';
import { TileMap } from '../world/TileMap.js';
import { Water, createWaterfall, waterfallDir } from '../world/Water.js';
import { OBJECT_TYPES } from './ObjectCatalog.js';
import { toTileMapInput } from './LevelFormat.js';
import { runSteps } from '../utils/steps.js';

/**
 * @import { Level, LevelObject, LevelObjectOf, ObjectTypeDef, Rect,
 *   NullForNonProp } from './types.js'
 * @import { PropResult } from '../world/Props.js'
 * @import { TextureLibrary } from '../pixel/Textures.js'
 */

/**
 * Builds the 3D content of a Luminati level: the terrain (TileMap + Water) and every prop-kind
 * object (houses, trees, lights, fences, bridges, waterfalls …) through the PropFactory.
 *
 * Shared by the game (which then merges static meshes and wires lights / particles) and the level
 * editor (which builds, rebuilds and disposes objects one at a time for its live preview).
 *
 * Actors (npc, critters, enemy) and markers (emitter, region) have no geometry here — `build()`
 * returns null for them; the game / editor handle them (enemy groups are spawned by the combat
 * system, COMBAT.md §14.3).
 */

/**
 * @typedef {object} BuiltObject
 * @property {THREE.Object3D} object        root, already positioned in world space
 * @property {PropResult['colliders']} colliders TileMap colliders (world space)
 * @property {NonNullable<PropResult['walkRects']>} walkRects TileMap walk surfaces (bridge decks)
 * @property {(PropResult['lights'][number] & { tag: string, priority: number })[]} lights
 *   point-light descriptors { position, color, intensity, distance, flicker, nightOnly, tag,
 *   priority } (`tag` = 'type:id', `priority` from LIGHT_PRIORITY, default 3)
 * @property {PropResult['emissives']} emissives
 *   { material, day, night } for LightingSystem.registerEmissive
 * @property {PropResult['emitters']} emitters particle emitter configs for Particles.createEmitter
 * @property {((dt:number) => void)|null} update
 * @property {{ position: THREE.Vector3, radius: number, id: string, lookSpan?: { a: THREE.Vector3, b: THREE.Vector3 } }|null} interact
 * @property {THREE.Vector3} anchor         a representative world point (ground level)
 * @property {LevelObject} source           the level object it was built from
 * @property {PropResult|null} propResult
 *   the raw PropResult (for PropFactory.mergeStatic; a chest's / waystone's carries `controls`:
 *   open() / setAttuned(on)); null for a light or a waterfall
 * @property {() => void} dispose
 */
/**
 * What `buildWaterfall` returns: the `createWaterfall` result plus the sampled surfaces.
 * @typedef {ReturnType<typeof createWaterfall> & { top: number, bottom: number }} BuiltWaterfall
 *   top / bottom: the upper / lower surface Y sampled around the fall (`bottom` before the
 *   sheet's 0.05 minimum drop is applied)
 */
/**
 * The part of a TileMap that `build`, `bridgeDeckHeight` and `buildWaterfall` read: ground
 * heights, water surfaces and tiles (the editor passes a flat stub for colliders-only builds).
 * @typedef {Pick<TileMap, 'getHeight'|'getWaterSurface'|'tileAt'>} GroundSampler
 */

/** Prop types already reported as having no `build` case (one warning each). */
const unbuilt = new Set();

/** Point-light priority by object type (lower = kept first when over the light budget). */
export const LIGHT_PRIORITY = { campfire: 0, hearth: 0, fire: 0, smithy: 0, wallTorch: 1, light: 1, monument: 1, lamppost: 2, belfry: 2, house: 3 };

export class LevelObjectBuilder {
  /** @param {{ textures: TextureLibrary, seed?: number, factory?: PropFactory }} opts */
  constructor({ textures, seed = 42, factory = null }) {
    this.textures = textures;
    this.factory = factory ?? new PropFactory({ textures, seed });
    this._ownsFactory = !factory;
  }

  /**
   * True if `build()` produces geometry for this object type.
   * @param {string} type
   * @returns {boolean}
   */
  static isBuildable(type) {
    return OBJECT_TYPES[type]?.kind === 'prop';
  }

  /**
   * Build one level object. Returns null for non-prop objects (npc, critters, emitter, region).
   * @param {LevelObject} obj level object
   * @param {GroundSampler} tileMap ground heights (and water surfaces for waterfalls / bridges)
   * @returns {BuiltObject|null}
   */
  build(obj, tileMap) {
    /** @type {ObjectTypeDef} */
    const def = OBJECT_TYPES[obj.type];
    if (!def || (def.kind !== 'prop' && obj.type !== 'enemy')) return null;
    const f = this.factory;
    const h = (x, z) => tileMap.getHeight(x, z);
    const rotation = obj.rotation ?? 0;
    const opts = { ...(obj.opts ?? {}), id: obj.id };
    if (def.rotatable) opts.rotation = rotation;
    let res = null;
    let anchor = null;

    switch (obj.type) {
      case 'house':
      case 'windmill':
      case 'well':
      case 'marketStall':
      case 'lamppost':
      case 'campfire':
      case 'bench':
      case 'barrel':
      case 'crate':
      case 'crateStack':
      case 'flowerbox':
      case 'signpost':
      case 'rock':
      case 'haystack':
      case 'chest':
      case 'waystone':
      // interior furniture (props/Furniture.js)
      case 'bed':
      case 'table':
      case 'chair':
      case 'shelf':
      case 'hearth':
      case 'counter':
      case 'rug':
      case 'staircase':
      case 'wardrobe':
      case 'sacks':
      // the set-piece props of Vanquish the Evil Dragon (props/SetPieces.js, props/Crags.js)
      case 'fire':
      case 'debris':
      case 'crag':
      // The Bells of Evermere's (the season kit: props/Belfry.js, Monuments.js, Smithy.js)
      case 'belfry':
      case 'monument':
      case 'smithy': {
        if (obj.type === 'house' && !opts.upperWall) delete opts.upperWall;
        // (each type calls its own method with its own opts — a correlation TS cannot follow)
        res = /** @type {(x: number, y: number, z: number, opts: object) => PropResult} */ (f[obj.type])(obj.x, h(obj.x, obj.z), obj.z, opts);
        break;
      }
      case 'enemy':
        // an enemy group has no geometry: the combat system spawns its sprites (and the editor
        // previews them in its ActorPreview) — nothing to build, nothing to merge
        return null;
      case 'garland': {
        // (a line like the fence: the ground at the midpoint)
        res = f.garland(obj.x0, obj.z0, obj.x1, obj.z1, h((obj.x0 + obj.x1) / 2, (obj.z0 + obj.z1) / 2), /** @type {Parameters<PropFactory['garland']>[5]} */ (opts));
        anchor = new THREE.Vector3((obj.x0 + obj.x1) / 2, 0, (obj.z0 + obj.z1) / 2);
        break;
      }
      case 'ship': {
        // (afloat: at the water surface where there is water)
        res = f.ship(obj.x, tileMap.getWaterSurface(obj.x, obj.z) ?? h(obj.x, obj.z), obj.z, opts);
        break;
      }
      case 'tree': {
        res = f.tree(obj.x, h(obj.x, obj.z), obj.z, opts);
        if (obj.collider === false) res.colliders = [];
        break;
      }
      case 'wallTorch': {
        // ground height sampled just in front of the wall (the flame side, local +Z)
        const gx = obj.x + Math.sin(rotation) * 0.6;
        const gz = obj.z + Math.cos(rotation) * 0.6;
        res = f.wallTorch(obj.x, h(gx, gz) + (obj.dy ?? 2.1), obj.z, opts);
        break;
      }
      case 'wallWindow': {
        // on the wall face: the floor height sampled just in front of it (local +Z, into the room)
        const gx = obj.x + Math.sin(rotation) * 0.6;
        const gz = obj.z + Math.cos(rotation) * 0.6;
        res = f.wallWindow(obj.x, h(gx, gz), obj.z, opts);
        break;
      }
      case 'light': {
        const group = new THREE.Group();
        group.name = `light:${obj.id}`;
        const y = h(obj.x, obj.z) + (obj.dy ?? 1.5);
        group.position.set(obj.x, y, obj.z);
        res = {
          object: group,
          colliders: [],
          emissives: [],
          emitters: [],
          lights: [{
            position: new THREE.Vector3(obj.x, y, obj.z),
            color: obj.color ?? '#ffb46b',
            intensity: obj.intensity ?? 8,
            distance: obj.distance ?? 8,
            flicker: obj.flicker ?? 0.2,
            nightOnly: obj.nightOnly ?? true,
          }],
          dispose: () => group.removeFromParent(),
        };
        break;
      }
      case 'fence': {
        res = f.fence(obj.x0, obj.z0, obj.x1, obj.z1, h((obj.x0 + obj.x1) / 2, (obj.z0 + obj.z1) / 2), opts);
        anchor = new THREE.Vector3((obj.x0 + obj.x1) / 2, 0, (obj.z0 + obj.z1) / 2);
        break;
      }
      case 'bridge': {
        const deckY = obj.deckY ?? bridgeDeckHeight(tileMap, obj);
        // (`opts` is typed from every object type's opts, e.g. a fence's numeric `rails`; it holds
        // this bridge's)
        res = f.bridge(obj.x0, obj.z0, obj.x1, obj.z1, deckY, /** @type {Parameters<PropFactory['bridge']>[5]} */ (opts));
        anchor = new THREE.Vector3((obj.x0 + obj.x1) / 2, deckY, (obj.z0 + obj.z1) / 2);
        break;
      }
      case 'waterfall': {
        const fall = buildWaterfall(tileMap, obj);
        res = {
          object: fall.object,
          colliders: [],
          emissives: [],
          lights: [],
          emitters: fall.emitters ?? [],
          update: fall.update,
          dispose: () => { fall.dispose(); fall.object.removeFromParent(); },
          waterfall: fall,
        };
        anchor = new THREE.Vector3(obj.x, fall.bottom, obj.z);
        break;
      }
      default:
        // (only non-prop types get here: a prop type without a case fails the cast — PROP-10 —,
        // and is reported at run time too)
        if (LevelObjectBuilder.isBuildable(obj.type) && !unbuilt.has(obj.type)) {
          unbuilt.add(obj.type);
          console.warn(`[Luminati] no build case for the prop type "${obj.type}": its objects build nothing`);
        }
        return /** @type {NullForNonProp<typeof obj.type>} */ (null);
    }

    // (a fire's light — a burning house's — keeps the fire's priority; a house without `light` keeps
    // only its fire lights, never its lanterns)
    const lights = (res.lights ?? []).map((d) => ({ ...d, tag: `${obj.type}:${obj.id}`, priority: d.fire ? LIGHT_PRIORITY.fire : LIGHT_PRIORITY[obj.type] ?? 3 }));
    if (obj.type === 'house' && !obj.light) lights.splice(0, lights.length, ...lights.filter((d) => d.fire));
    if (!anchor) anchor = new THREE.Vector3(obj.x, h(obj.x, obj.z), obj.z);
    if (anchor.y === 0 && (obj.type === 'fence' || obj.type === 'garland')) anchor.y = h(anchor.x, anchor.z);
    res.object.userData.levelObjectId = obj.id;

    return {
      object: res.object,
      colliders: res.colliders ?? [],
      walkRects: res.walkRects ?? [],
      lights,
      emissives: res.emissives ?? [],
      emitters: res.emitters ?? [],
      update: res.update ?? null,
      interact: res.interact ?? null,
      anchor,
      source: obj,
      propResult: obj.type === 'light' || obj.type === 'waterfall' ? null : res,
      dispose: () => res.dispose?.(),
    };
  }

  dispose() {
    if (this._ownsFactory) this.factory.dispose();
  }
}

/**
 * Deck height of a bridge: the ground just outside its start point (so the deck meets the bank),
 * or just outside its end point if the start has no bank (water or void) — and at least 0.1 above
 * the highest water surface under the span. With no bank at either end: 0.3 above that water, or
 * the ground height at the start when there is no water either.
 * @param {GroundSampler} tileMap
 * @param {{ x0: number, z0: number, x1: number, z1: number }} obj a bridge (line) object
 * @returns {number} world Y of the deck
 */
export function bridgeDeckHeight(tileMap, obj) {
  const dx = obj.x1 - obj.x0;
  const dz = obj.z1 - obj.z0;
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  const bank = (x, z) => {
    const t = tileMap.tileAt(Math.floor(x), Math.floor(z));
    return t && !t.water && !t.type?.void ? tileMap.getHeight(x, z) : null;
  };
  const a = bank(obj.x0 - ux * 0.5, obj.z0 - uz * 0.5);
  const b = bank(obj.x1 + ux * 0.5, obj.z1 + uz * 0.5);
  // the highest water surface under the span (ends, quarter points, middle): a deck never sits
  // in the water (a pier, a bridge along a river, an all-water map)
  let water = -Infinity;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const w = tileMap.getWaterSurface(obj.x0 + dx * t, obj.z0 + dz * t);
    if (w != null && w > water) water = w;
  }
  const bankY = a ?? b;
  if (bankY != null) return water > -Infinity ? Math.max(bankY, water + 0.1) : bankY;
  // no bank at either end: clear the water surface
  if (water > -Infinity) return water + 0.3;
  return tileMap.getHeight(obj.x0, obj.z0);
}

/**
 * Build a waterfall from a level object: the top / bottom surfaces are sampled from the water
 * (or ground) half a tile upstream and downstream of (x, z).
 * @param {GroundSampler} tileMap
 * @param {LevelObjectOf<'waterfall'>} obj
 * @returns {BuiltWaterfall}
 */
export function buildWaterfall(tileMap, obj) {
  const [fx, fz] = waterfallDir(obj.facing);
  const surf = (x, z) => tileMap.getWaterSurface(x, z) ?? tileMap.getHeight(x, z);
  const top = surf(obj.x - fx * 0.5 + 0.01, obj.z - fz * 0.5 + 0.01);
  const bottom = surf(obj.x + fx * 0.5 + 0.01, obj.z + fz * 0.5 + 0.01);
  const fall = /** @type {BuiltWaterfall} */ (createWaterfall({ x: obj.x, z: obj.z, width: obj.width ?? 2, top, bottom: Math.min(bottom, top - 0.05), facing: obj.facing ?? 'S' }));
  fall.top = top;
  fall.bottom = bottom;
  return fall;
}

/**
 * Build the terrain of a level: TileMap (+ Water mesh when the level has water tiles).
 * @param {Level} level
 * @param {{ textures: TextureLibrary, chunkSize?: number,
 *   tileMapOptions?: Partial<ConstructorParameters<typeof TileMap>[1]>, deferShore?: boolean }} opts
 *   tileMapOptions: further TileMap options (they override `textures` / `chunkSize`);
 *   deferShore: don't bake the water's shore texture yet — the caller adds the colliders standing
 *   in the water, then calls `water.refresh()` before the first render (saves a full bake)
 * @returns {{ tileMap: TileMap, water: Water|null, object: THREE.Group, dispose: () => void }}
 */
export function buildLevelTerrain(level, opts) {
  return runSteps(buildLevelTerrainSteps(level, opts));
}

/**
 * {@link buildLevelTerrain} as a step generator (src/engine/utils/steps.js): a step per tile, per
 * tile's fringes and per terrain mesh (`TileMap.buildSteps`), then the water. Run to its end it
 * returns exactly what buildLevelTerrain returns.
 * @param {Level} level
 * @param {Parameters<typeof buildLevelTerrain>[1]} opts
 * @returns {Generator<undefined, ReturnType<typeof buildLevelTerrain>>}
 */
export function* buildLevelTerrainSteps(level, { textures, chunkSize = 32, tileMapOptions = {}, deferShore = false }) {
  const tileMap = new TileMap(toTileMapInput(level), { textures, chunkSize, ...tileMapOptions, deferBuild: true });
  yield* tileMap.buildSteps();
  const group = new THREE.Group();
  group.name = `terrain:${level.name}`;
  group.add(tileMap.object);
  let water = null;
  const hasWater = level.tiles.some((row) => [...row].some((ch) => level.legend[ch]?.water));
  if (hasWater) {
    water = new Water(tileMap, { flow: level.water?.flow ?? [0, 0.45], reflect: level.water?.reflect ?? 0.2, neutral: level.water?.neutral ?? 0.2, glint: waterGlint(level), deferShore });
    group.add(water.object);
  }
  return {
    tileMap,
    water,
    object: group,
    dispose: () => {
      water?.dispose();
      tileMap.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * The level's water glint density (`water.glint`: the sun / moon sparkle density multiplier;
 * default 1, the Water default — a big, calm lake reads better with fewer).
 * @param {{ water?: { glint?: number|string|null } }} level a level (a hand-edited file may hold
 *   any value in `water.glint`: null, '' and non-numbers give 1, negatives 0)
 * @returns {number}
 */
export function waterGlint(level) {
  const v = level?.water?.glint;
  const g = Number(v);
  return v !== null && v !== '' && Number.isFinite(g) ? Math.max(0, g) : 1;
}

/**
 * Camera focus bounds for a level (CameraRig.bounds): the walkable area shrunk a little so the
 * camera never looks far past the map edge.
 * @param {Level} level
 * @param {number} [margin] world units taken off every side (3)
 * @returns {Rect} the whole map when nothing is walkable
 */
export function computeCameraBounds(level, margin = 3) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  level.tiles.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const d = level.legend[row[i]];
      if (!d || d.void || d.water || d.walkable === false) continue;
      minX = Math.min(minX, i); maxX = Math.max(maxX, i + 1);
      minZ = Math.min(minZ, j); maxZ = Math.max(maxZ, j + 1);
    }
  });
  if (!Number.isFinite(minX)) return { minX: 0, maxX: level.width, minZ: 0, maxZ: level.depth };
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hx = Math.max(0, (maxX - minX) / 2 - margin);
  const hz = Math.max(0, (maxZ - minZ) / 2 - margin);
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz };
}
