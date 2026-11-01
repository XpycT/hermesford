import { OBJECT_TYPES, isSetpieceType } from '../level/ObjectCatalog.js';
import { isOwnKey } from '../utils/own.js';
import { ARID_TEXTURE_NAMES, BUILDING_TEXTURE_NAMES } from '../pixel/textures/names.js';
import { ownerOf } from '../level/Owners.js';

/**
 * SetPieceKit — the loader of the set-piece kit of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.2, §6.3): the builders of the set-piece props (`fire`,
 * `debris`, `garland`: props/SetPieces.js; `crag`: props/Crags.js), the instanced flames
 * (props/FlameBatch.js), a house's siege parts (props/HouseSiege.js: `ruin`, `burning`, `flatRoof`),
 * the arid trees (props/AridTrees.js + props/AridPropTextures.js), the arid ground's sprites
 * (pixel/AridSprites.js), the arid and building textures (pixel/textures/arid.js, buildings.js) and
 * the siege's particle presets (fx/presets/siege.js). They are one chunk of their own
 * (./SetPieceKitParts.js), so a level that uses none of them downloads none of them.
 *
 * - `levelNeedsSetPieceKit(level)` says whether a level needs it (any of the above by type, option,
 *   texture or tree kind, or `environment.climate`: the arid border and outer scenery);
 * - `loadSetPieceKit()` imports it (once): the parts module registers what it brings into the
 *   engine's tables (the texture definitions, the prop sprites and prop textures, the particle
 *   presets) and installs its builders here;
 * - `needSetPieceKit(what)` hands the builders to the synchronous code that uses them (PropFactory's
 *   set-piece methods, `buildHouse`, `buildTree`), and throws when the kit is not loaded — a level's
 *   need was missed (`levelNeedsSetPieceKit`);
 * - `setPieceKit()` is the kit or null (World merges the flames only with it).
 *
 * The game loads it at the start of a world's build (World.buildSteps yields `{ wait }` on it: the
 * game's init and travels, a campaign's level built ahead); the editor imports the parts with its
 * own module graph (src/editor/main.js), so it previews every level as before. Node-safe (the import
 * is dynamic; the scan reads plain data).
 */

/** The tree kinds the kit builds (props/AridTrees.js; ObjectCatalog TREE_KINDS' last four). */
export const ARID_TREE_KINDS = Object.freeze(['juniper', 'deadwood', 'palm', 'cypress']);

/** @typedef {typeof import('./SetPieceKitParts.js').SET_PIECE_PARTS} SetPieceParts */

/** @type {SetPieceParts|null} */
let parts = null;
/** @type {Promise<SetPieceParts>|null} */
let job = null;

/**
 * The names a level mentions that only the kit knows: its texture names (a legend's tops, sides,
 * lips and risers, a house's walls and roofs, a rock's or a crag's stone) and the arid tree kinds.
 */
const KIT_NAMES = new Set([...ARID_TEXTURE_NAMES, ...BUILDING_TEXTURE_NAMES, ...ARID_TREE_KINDS]);

/**
 * Does any string in `v` (a level object, a legend entry: their fields, arrays and nested objects,
 * a few levels deep) name something of the kit? (Level data is untrusted: any shape; a text that
 * happens to equal such a name only loads the kit for nothing.)
 * @param {unknown} v
 * @param {number} depth
 * @returns {boolean}
 */
function mentionsKit(v, depth = 0) {
  if (typeof v === 'string') return KIT_NAMES.has(v);
  if (!v || typeof v !== 'object' || depth > 4) return false;
  if (Array.isArray(v)) return v.some((x) => mentionsKit(x, depth + 1));
  for (const k of Object.keys(v)) if (mentionsKit(/** @type {Record<string, unknown>} */ (v)[k], depth + 1)) return true;
  return false;
}

/**
 * Is a house's option one of the siege's (`buildHouse`: `ruin` 1–2, `burning` > 0, `flatRoof`)?
 * @param {any} opts
 */
function siegeHouse(opts) {
  if (!opts || typeof opts !== 'object') return false;
  if (opts.flatRoof === true) return true;
  if (Number.isFinite(opts.ruin) && Math.round(opts.ruin) > 0) return true;
  return Number.isFinite(opts.burning) && opts.burning > 0;
}

/**
 * Does a level need the set-piece kit? A set-piece prop (`fire`, `debris`, `crag`, `garland`: the
 * catalog's `setpiece` types of kind 'prop'), a house with a siege option (`ruin`, `burning`,
 * `flatRoof`), a texture of the arid or the building set anywhere in its legend or its objects
 * (walls, roofs, a rock's `stone` …), an arid tree kind, or an `environment.climate` (the arid
 * border, outer scenery and ground).
 * @param {{ legend?: unknown, objects?: unknown, environment?: unknown }|null|undefined} level a
 *   level (normalised or not)
 * @returns {boolean}
 */
export function levelNeedsSetPieceKit(level) {
  if (!level || typeof level !== 'object') return false;
  const env = /** @type {Record<string, unknown>|null|undefined} */ (level.environment);
  if (env && typeof env === 'object' && env.climate != null) return true;
  if (mentionsKit(level.legend)) return true;
  const objects = Array.isArray(level.objects) ? level.objects : [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    const type = o.type;
    // (a crag of a campaign's stone — The Bells of Evermere's `ice` — is the season kit's)
    const ownStone = type === 'crag' && o.opts && typeof o.opts === 'object' && typeof o.opts.stone === 'string' && ownerOf('stones', o.opts.stone);
    if (!ownStone && isSetpieceType(type) && isOwnKey(OBJECT_TYPES, type) && OBJECT_TYPES[type].kind === 'prop') return true;
    if (type === 'house' && siegeHouse(o.opts)) return true;
    if (mentionsKit(o)) return true;
  }
  return false;
}

/**
 * Load the set-piece kit (once; later calls share the import). Its parts register themselves into
 * the engine's tables as the module runs.
 * @returns {Promise<SetPieceParts>}
 */
export function loadSetPieceKit() {
  if (parts) return Promise.resolve(parts);
  job ??= import('./SetPieceKitParts.js').then((m) => {
    installSetPieceKit(m.SET_PIECE_PARTS);
    return m.SET_PIECE_PARTS;
  }, (err) => {
    job = null;
    throw err;
  });
  return job;
}

/**
 * Install the kit's builders (called by ./SetPieceKitParts.js as it runs; again is harmless).
 * @param {SetPieceParts} p
 */
export function installSetPieceKit(p) {
  parts = p;
}

/** The kit's builders, or null while it is not loaded. @returns {SetPieceParts|null} */
export function setPieceKit() {
  return parts;
}

/**
 * The kit's builders for synchronous code that needs them. Throws when the kit is not loaded: the
 * game loads it for a level that needs it (`levelNeedsSetPieceKit`) before building it.
 * @param {string} what what needs it (for the error)
 * @returns {SetPieceParts}
 */
export function needSetPieceKit(what) {
  if (!parts) throw new Error(`${what} needs the set-piece kit (src/engine/world/SetPieceKitParts.js), which is not loaded: load it first (loadSetPieceKit — World.buildSteps does for a level that needs it, levelNeedsSetPieceKit)`);
  return parts;
}
