/**
 * The Bells of Evermere's enemy pack (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6, §6.7): the
 * Hushguard, the Frost Wolf, the Rime Crow and the Hush Cantor (the foes package), Rimehart and the
 * Harvest Mawkin (the guardians package), Old Gullet (the gullet package) and the Hushed King with
 * the Hush Bell's toll (the king package). A chunk of its own (../index.js `ENEMY_PACKS.evermere`),
 * imported by `CombatSystem.load` only on a level whose `enemy` objects use one of these kinds.
 *
 * One module per owner, each with its own `register(api)` (../index.js `EnemyPackRegistrar`); this file
 * holds only their import lines and the order — every package's stats first (an add's def must be
 * there before a boss's pool is made), then the kinds' brains, sheets, FX frames and presets.
 * Owners replace their own modules; the foundation's are stubs (borrowed brains, tinted or spec'd
 * sheets, believable numbers).
 *
 * @import { EnemyPackRegistrar } from '../index.js'
 */
// the foes package
import * as defsFoes from './defsFoes.js';
import * as hushguard from './hushguard.js';
import * as frostwolf from './frostwolf.js';
import * as rimecrow from './rimecrow.js';
import * as cantor from './cantor.js';
// the guardians package
import * as defsGuardians from './defsGuardians.js';
import * as rimehart from './rimehart.js';
import * as mawkin from './mawkin.js';
// the gullet package
import * as defsGullet from './defsGullet.js';
import * as gullet from './gullet.js';
// the king package
import * as defsKing from './defsKing.js';
import * as hushedking from './hushedking.js';
import * as HushToll from './HushToll.js';

/** In registration order: every package's stats, then the kinds. */
const MODULES = [defsFoes, defsGuardians, defsGullet, defsKing, hushguard, frostwolf, rimecrow, cantor, rimehart, mawkin, gullet, hushedking, HushToll];

/**
 * Register the pack (once per page: ../index.js `loadEnemyPacks`).
 * @param {EnemyPackRegistrar} api
 */
export function register(api) {
  for (const mod of MODULES) mod.register(api);
}
