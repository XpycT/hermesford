import { SETPIECE_BEHAVIOURS } from '../../engine/level/ObjectCatalog.js';

/**
 * The festival kit's loader (./FestivalKit.js: the festival sheets and the siege's barks of Vanquish
 * the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.3). The kit is a chunk of its own: `Game`
 * loads it (`loadFestival`) before it builds the actors of a level that needs it (`needsFestival`),
 * and the actors read it synchronously (`festivalKit`) — Npc (a set-piece villager's or a posed
 * one's sheet, the barks), Player and PartyMember (the festival sheet a story's `pose` plays on a
 * peaceful level). Once loaded it stays (a module of the page).
 *
 * @import { Level } from '../../engine/level/types.js'
 */

/** @typedef {typeof import('./FestivalKit.js')} FestivalKitModule */

/** @type {FestivalKitModule|null} */
let kit = null;
/** @type {Promise<FestivalKitModule>|null} */
let job = null;

/**
 * Does a level need the festival kit? A villager of a set-piece behaviour (`SETPIECE_BEHAVIOURS`:
 * panic, dance, cheer, cower — the festival sheet and the barks), or anyone posed by the story
 * (`posed`: Game's `posedNames` of the level and the campaign's story — a villager, the player or
 * a party member wears the festival sheet then).
 * @param {Pick<Level, 'objects'>} level
 * @param {ReadonlySet<string>} posed
 * @returns {boolean}
 */
export function needsFestival(level, posed) {
  if (posed.size) return true;
  return level.objects.some((o) => o?.type === 'npc' && SETPIECE_BEHAVIOURS.includes(/** @type {any} */ (o).behaviour));
}

/**
 * Load the festival kit (once; later calls share the import).
 * @returns {Promise<FestivalKitModule>}
 */
export function loadFestival() {
  if (kit) return Promise.resolve(kit);
  job ??= import('./FestivalKit.js').then((m) => {
    kit = m;
    return m;
  }, (err) => {
    job = null;
    throw err;
  });
  return job;
}

/**
 * The loaded festival kit. Throws when it is not loaded: `Game` loads it before it builds a level
 * that needs it (`needsFestival`), so this means a level's need was missed.
 * @param {string} what what needs it (for the error)
 * @returns {FestivalKitModule}
 */
export function festivalKit(what) {
  if (!kit) throw new Error(`${what} needs the festival kit (src/game/siege/FestivalKit.js), which is not loaded: Game loads it for a level that needs it (needsFestival)`);
  return kit;
}
