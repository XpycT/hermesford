/**
 * FestivalKit — the villagers' set-piece kit of Vanquish the Evil Dragon in one lazily loaded
 * chunk (docs/contracts/DRAGON_CAMPAIGN.md §6.3; owner: the siege package): the festival sheets
 * (src/engine/pixel/FestivalPoses.js: the poses of the panicking village, the festival and the
 * story's `pose`) and the barks (./strings.js, namespace 'siege'). Imported only through
 * `loadFestival` (./festival.js), which `Game._buildLevel` awaits before it makes the player, the
 * villagers and the party's sprites of a level that needs it — a level with no set-piece villager
 * and no `pose` in its story downloads neither.
 */
export { createFestivalSheet, FESTIVAL_POSE_NAMES } from '../../engine/pixel/FestivalPoses.js';
export { SIEGE_BARKS, SIEGE_STRINGS, registerSiegeStrings } from './strings.js';
