import { OWNED, ownerOf } from '../level/Owners.js';
import { SEASON_TEXTURE_NAMES } from '../pixel/textures/names.js';

/**
 * SeasonKit — the loader of The Bells of Evermere's season kit (docs/contracts/EVERMERE_CAMPAIGN.md
 * §6.2, §6.3): the builders of its object types (`belfry`, `ship`, `monument`, `smithy`:
 * props/Belfry.js, Ships.js, Monuments.js, Smithy.js — the architecture package's), its tree kinds
 * (props/SeasonTrees.js — the seasons package's) and its texture set (pixel/textures/seasons.js,
 * names in pixel/textures/names.js `SEASON_TEXTURE_NAMES`). They are one chunk of their own
 * (./SeasonKitParts.js), so a level that uses none of them downloads none of them. It never loads
 * the set-piece kit of Vanquish (./SetPieceKit.js: a season level has no `climate`).
 *
 * - `levelNeedsSeasonKit(level)` says whether a level needs it;
 * - `loadSeasonKit()` imports it (once): the parts module registers its textures and installs its
 *   builders here;
 * - `needSeasonKit(what)` hands the builders to the synchronous code that uses them (PropFactory's
 *   methods of the owned types and of the owned tree kinds) and throws when the kit is not loaded;
 * - `seasonKit()` is the kit or null.
 *
 * The game loads it at the start of a world's build (World.buildSteps: the game's init and travels,
 * a campaign's level built ahead); the editor loads it at start (EditorApp.start). Node-safe (the
 * import is dynamic; the scan reads plain data).
 */

/** The tree kinds the kit builds (ObjectCatalog TREE_KINDS' last five; Owners.js). */
export const SEASON_TREE_KINDS = Object.freeze([...OWNED.evermere.treeKinds]);

/** @typedef {typeof import('./SeasonKitParts.js').SEASON_KIT_PARTS} SeasonKitParts */

/** @type {SeasonKitParts|null} */
let parts = null;
/** @type {Promise<SeasonKitParts>|null} */
let job = null;

const TEXTURES = new Set(SEASON_TEXTURE_NAMES);
const TILE_TEXTURE_KEYS = ['top', 'side', 'lip', 'riser'];

/**
 * Does a level need the season kit? An `environment.season` or `environment.frost`, an object of a
 * type the campaigns own (`belfry`, `ship`, `monument`, `smithy`), a tree of an owned kind, a rock
 * or crag of an owned stone (`ice`, `snow`), a house with `icicles`, or a legend entry naming a
 * season texture (its top, side, lip or riser). Level data is untrusted: any shape.
 * @param {{ legend?: unknown, objects?: unknown, environment?: unknown }|null|undefined} level a
 *   level (normalised or not)
 * @returns {boolean}
 */
export function levelNeedsSeasonKit(level) {
  if (!level || typeof level !== 'object') return false;
  const env = /** @type {Record<string, unknown>|null|undefined} */ (level.environment);
  if (env && typeof env === 'object' && (env.season != null || env.frost != null)) return true;
  // (crop fields: the season kit's growth, on a level without a season too)
  const crops = env && typeof env === 'object' && env.foliage && typeof env.foliage === 'object' ? /** @type {any} */ (env.foliage).cropAreas : null;
  if (Array.isArray(crops) && crops.length) return true;
  // (forest areas planting a season tree kind: Scenery.forestKindAreas)
  const areas = env && typeof env === 'object' && env.forest && typeof env.forest === 'object' ? /** @type {any} */ (env.forest).areas : null;
  if (Array.isArray(areas) && areas.some((a) => a && typeof a.kinds === 'object' && a.kinds && Object.keys(a.kinds).some((k) => ownerOf('treeKinds', k)))) return true;
  const legend = level.legend;
  if (legend && typeof legend === 'object') {
    for (const def of Object.values(legend)) {
      if (!def || typeof def !== 'object') continue;
      for (const k of TILE_TEXTURE_KEYS) if (TEXTURES.has(/** @type {any} */ (def)[k])) return true;
    }
  }
  const objects = Array.isArray(level.objects) ? level.objects : [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if (typeof o.type === 'string' && ownerOf('types', o.type)) return true;
    const opts = o.opts && typeof o.opts === 'object' ? o.opts : null;
    if (!opts) continue;
    if (o.type === 'tree' && typeof opts.kind === 'string' && ownerOf('treeKinds', opts.kind)) return true;
    if ((o.type === 'rock' || o.type === 'crag') && typeof opts.stone === 'string' && ownerOf('stones', opts.stone)) return true;
    if (o.type === 'house' && opts.icicles === true) return true;
  }
  return false;
}

/**
 * Load the season kit (once; later calls share the import). Its parts register themselves as the
 * module runs.
 * @returns {Promise<SeasonKitParts>}
 */
export function loadSeasonKit() {
  if (parts) return Promise.resolve(parts);
  job ??= import('./SeasonKitParts.js').then((m) => {
    installSeasonKit(m.SEASON_KIT_PARTS);
    return m.SEASON_KIT_PARTS;
  }, (err) => {
    job = null;
    throw err;
  });
  return job;
}

/**
 * Install the kit's builders (called by ./SeasonKitParts.js as it runs; again is harmless).
 * @param {SeasonKitParts} p
 */
export function installSeasonKit(p) {
  parts = p;
}

/** The kit's builders, or null while it is not loaded. @returns {SeasonKitParts|null} */
export function seasonKit() {
  return parts;
}

/**
 * The kit's builders for synchronous code that needs them. Throws when the kit is not loaded: the
 * game loads it for a level that needs it (`levelNeedsSeasonKit`) before building it.
 * @param {string} what what needs it (for the error)
 * @returns {SeasonKitParts}
 */
export function needSeasonKit(what) {
  if (!parts) throw new Error(`${what} needs the season kit (src/engine/world/SeasonKitParts.js), which is not loaded: load it first (loadSeasonKit — World.buildSteps does for a level that needs it, levelNeedsSeasonKit)`);
  return parts;
}
