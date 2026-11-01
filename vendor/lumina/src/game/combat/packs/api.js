/**
 * The combat's enemy-pack API (./index.js `EnemyPackApi`): what a pack registers into — the stats
 * (../defs.js), the brains (../ai/index.js), the sheets (MonsterSprites.js), the FX atlas
 * (FxSprites.js) and the particle presets (fx/presets/combat.js) — and what it may borrow. Imported
 * by CombatSystem.js (the combat chunk), which loads a level's packs with it at the start of `load`.
 *
 * @import { EnemyPackApi } from './index.js'
 * @import { BaseEnemyKind } from '../defs.js'
 */
import { registerEnemyDefs } from '../defs.js';
import { BRAINS, registerBrain } from '../ai/index.js';
import { registerMonsterKind, monsterKind, MONSTER_KIT } from '../../../engine/pixel/MonsterSprites.js';
import { registerFxModule } from '../../../engine/pixel/FxSprites.js';
import { registerPackPresets } from '../../../engine/fx/presets/combat.js';

/** @type {Readonly<EnemyPackApi>} */
export const COMBAT_PACK_API = Object.freeze({
  registerEnemyDefs,
  registerBrain,
  registerMonsterKind,
  registerFxModule,
  registerPresets: registerPackPresets,
  monsterKind,
  monsterKit: MONSTER_KIT,
  brain: (/** @type {BaseEnemyKind} */ kind) => (Object.hasOwn(BRAINS, kind) ? BRAINS[kind] : null),
});
