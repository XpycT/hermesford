/**
 * Enemy brains by kind (COMBAT.md §7.7, §8). `Enemy` (../Enemy.js) runs the shared state machine
 * of §7.4 and calls into the brain of its kind; the brains only use the CombatContext of §9.2,
 * the Enemy helpers, `e.rng` (never Math.random) and pure helpers (`aimVy` of ../Projectiles.js),
 * so a seeded run is reproducible.
 *
 * A brain is a plain object (no imports of Enemy.js — the module graph stays acyclic):
 *
 * | Member | Called | Job |
 * | --- | --- | --- |
 * | `init(e)` | construction and `reset` | returns the per-enemy brain state (`e.ai`) |
 * | `idle(e, h, ctx)` | state `idle` (optional) | idle behaviour instead of the default wander |
 * | `engage(e, h, ctx)` | state `engage` | archetype movement; starts attacks (`e.setState('windup')`) |
 * | `attack(e, h, ctx)` | states `windup` / `active` / `recover` | the current attack's timeline |
 * | `stun(e, h, ctx)` | state `stun` (optional) | wall stun (boar) |
 * | `cancel(e, ctx)` | every interrupt, return, death (optional) | drop attack-local state |
 * | `onHit(e, info, ctx)` | `receiveHit` (optional) | kind reactions (dummy wobble, boss poise) |
 * | `die(e, ctx)` | `die` (optional) | kind death look |
 * | `glow(e, out)` | every sub-step (optional) | writes `uGlow` [r, g, b, a] into `out` |
 * | `update(e, h, ctx)` | boss only | drives every state itself |
 * | `dead(e, h, ctx)` | every sub-step while dead, the ambient step too (optional) | death throes; true: the brain fades the sprite itself (COMBAT.md §29) |
 *
 * Telegraph grammar (§7.3), binding for every brain: each attack — follow-ups included — enters
 * `windup` for ≥ 18 f (the Enemy composes the wind-up flash from the state), a non-boss enemy
 * starts a wind-up only while `e.canWindup(ctx)` (on screen), areas of r ≥ 1.5 and ranged attacks
 * show a ground marker (y 0.03, draped) whose progress reaches 1 when the attack resolves.
 */
import { slime } from './slime.js';
import { goblin } from './goblin.js';
import { archer } from './archer.js';
import { shaman } from './shaman.js';
import { bat } from './bat.js';
import { boar } from './boar.js';
import { dummy } from './dummy.js';
import { golem } from './golem.js';
// Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3): one module per kind, its
// package's (brutes, swarm, dragon)
import { drakeborn } from './drakeborn.js';
import { ashhound } from './ashhound.js';
import { wyrmcaller } from './wyrmcaller.js';
import { kobold } from './kobold.js';
import { whelp } from './whelp.js';
import { emberimp } from './emberimp.js';
import { dragon } from './dragon.js';

/** @import { Brain } from '../types.js' */
/** @import { BaseEnemyKind, PackEnemyKind } from '../defs.js' */

/**
 * kind → brain (ObjectCatalog.ENEMY_KINDS; the Brain interface: ../types.d.ts): the base kinds',
 * and a lazy enemy pack's once it registered them (`registerBrain`, ../packs/index.js).
 * @type {Readonly<Record<BaseEnemyKind, Brain>> & Partial<Record<PackEnemyKind, Brain>>}
 */
export const BRAINS = {
  slime, goblin, archer, shaman, bat, boar, dummy, golem,
  drakeborn, ashhound, wyrmcaller, kobold, whelp, emberimp, dragon,
};

/**
 * Add a lazy enemy pack's brain for one of its kinds (the pack registers at load, before any enemy
 * is made; EVERMERE_CAMPAIGN.md §6.4). A kind given a brain twice — a base kind, or one registered
 * before — throws.
 * @param {PackEnemyKind} kind
 * @param {Brain} brain
 */
export function registerBrain(kind, brain) {
  if (Object.hasOwn(BRAINS, kind)) throw new Error(`registerBrain: the enemy kind "${kind}" has a brain already`);
  if (!brain || typeof brain !== 'object') throw new Error(`registerBrain: "${kind}" needs a brain object`);
  BRAINS[kind] = brain;
}
