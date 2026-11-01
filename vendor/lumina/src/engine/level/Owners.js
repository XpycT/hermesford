// Which campaign owns a name — import-free, safe for the Node generators.
//
// A name owned by a campaign (an object type, an enemy kind, a story effect, a weather, a stone, a
// tree kind) is covered by that campaign's generator only: every other generator's `coverage()`
// skips it (`ownerOf(family, name)` is an owner and not its own), so adding names here never
// changes another generator's output. `setpiece` keeps meaning "runs the ambient step"; `owner`
// decides which generator covers a name (EVERMERE_CAMPAIGN.md §5.8).

/**
 * @typedef {'types' | 'kinds' | 'effects' | 'weathers' | 'stones' | 'treeKinds' | 'behaviours'} OwnedFamily
 * @typedef {{ types: string[], kinds: string[], effects: string[], weathers: string[],
 *   stones: string[], treeKinds: string[], behaviours: string[] }} OwnedNames
 */

/** @type {Readonly<Record<string, Readonly<OwnedNames>>>} */
export const OWNED = Object.freeze({
  evermere: Object.freeze({
    types: ['belfry', 'ship', 'monument', 'smithy'],
    kinds: ['hushguard', 'frostwolf', 'rimecrow', 'cantor', 'rimehart', 'mawkin', 'gullet', 'hushedking'],
    effects: ['toll', 'thaw', 'petals', 'leaves', 'memory', 'crows'],
    weathers: ['frost'],
    stones: ['ice', 'snow'],
    treeKinds: ['blossom', 'maple', 'goldbirch', 'snowpine', 'bare'],
    behaviours: ['still'],
  }),
});

/**
 * The campaign that owns a name of a family, or null for a shared (unowned) name.
 * @param {OwnedFamily} family
 * @param {string} name
 * @returns {string | null}
 */
export function ownerOf(family, name) {
  for (const owner of Object.keys(OWNED)) {
    const list = OWNED[owner][family];
    if (list && list.includes(name)) return owner;
  }
  return null;
}

/**
 * True when a name belongs to a campaign other than `self` (null: any owner) — the filter every
 * generator's `coverage()` applies to the catalog's lists.
 * @param {OwnedFamily} family
 * @param {string} name
 * @param {string | null} [self]
 */
export function ownedElsewhere(family, name, self = null) {
  const owner = ownerOf(family, name);
  return owner !== null && owner !== self;
}

/**
 * The names of a family a campaign owns (empty for an unknown owner).
 * @param {string} owner
 * @param {OwnedFamily} family
 * @returns {string[]}
 */
export function ownedBy(owner, family) {
  const names = Object.prototype.hasOwnProperty.call(OWNED, owner) ? OWNED[owner][family] : null;
  return names ? names.slice() : [];
}
