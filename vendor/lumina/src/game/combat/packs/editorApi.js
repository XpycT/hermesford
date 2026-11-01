/**
 * The editor's enemy-pack API (./index.js `EnemyPackApi`): a pack's stats and sheets only — what the
 * 3D preview shows of an `enemy` object (src/editor/viewport3d/ActorPreview.js: `createEnemySheet`,
 * `ENEMY_DEFS[kind].hover`). Brains, FX frames and particle presets are the game's: ignored here,
 * so the editor never imports the combat's brains. The editor loads every pack with it at start
 * (`loadEnemyPacks(Object.keys(ENEMY_PACKS), EDITOR_PACK_API)`), so a pack's kinds show in any
 * level opened or placed.
 *
 * @import { EnemyPackApi } from './index.js'
 */
import { registerEnemyDefs } from '../defs.js';
import { registerMonsterKind, monsterKind, MONSTER_KIT } from '../../../engine/pixel/MonsterSprites.js';

const ignore = () => {};

/** @type {Readonly<EnemyPackApi>} */
export const EDITOR_PACK_API = Object.freeze({
  registerEnemyDefs,
  registerBrain: ignore,
  registerMonsterKind,
  registerFxModule: ignore,
  registerPresets: ignore,
  monsterKind,
  monsterKit: MONSTER_KIT,
  brain: () => null,
});
