import { RNG, hashString } from '../../engine/index.js';

/** @import { ScaledEnemyDef, EnemyDrops } from './defs.js' */

/**
 * Loot rolls (COMBAT.md §7.8). Every death rolls with its own RNG
 * `new RNG((hashString(uid) ^ Math.imul(deathCount + 1, 0x9E3779B1) ^ seed) >>> 0)` — draws in
 * the order gold, heart, mana, draught — so a kill drops the same things however the fight went,
 * and killing the same enemy again (after a rest) rolls anew. The same RNG then scatters the
 * pickups (`landing`).
 */

/** @type {[value: number, kind: string][]} coin denominations, largest first (pickup kind) */
const COINS = [[25, 'coin25'], [5, 'coin5'], [1, 'coin1']];
/** At most this many pickups per death (the remainder goes into the last coin). */
export const MAX_COIN_PICKUPS = 6;

/**
 * The RNG of one death.
 * @param {string} uid
 * @param {number} deathCount the enemy's deaths before this one
 * @param {number} seed the combat seed
 * @returns {RNG}
 */
export function lootRng(uid, deathCount, seed) {
  return new RNG((hashString(uid) ^ Math.imul(deathCount + 1, 0x9E3779B1) ^ seed) >>> 0);
}

/**
 * A kill's drops (`rollLoot`'s result).
 * @typedef {object} LootRoll
 * @property {number} gold
 * @property {boolean} heart
 * @property {boolean} mana
 * @property {boolean} draught
 */

/**
 * Roll a kill's drops.
 * @param {ScaledEnemyDef} def scaledDef result (gold [min, max], drops,
 *   guaranteedHeart)
 * @param {RNG} rng lootRng(...)
 * @param {boolean} lowHp the player is below 30 % HP (heart chance × 2)
 * @param {LootRoll} out
 * @returns {LootRoll} `out`
 */
export function rollLoot(def, rng, lowHp, out) {
  const [g0, g1] = def.gold ?? [0, 0];
  out.gold = g1 > 0 ? rng.int(Math.round(g0), Math.round(g1)) : 0;
  /** @type {Partial<EnemyDrops>} */
  const d = def.drops ?? {};
  const heartChance = Math.min(1, (d.heart ?? 0) * (lowHp ? 2 : 1));
  out.heart = rng.next() < heartChance || !!def.guaranteedHeart;
  out.mana = rng.next() < (d.mana ?? 0);
  out.draught = rng.next() < (d.draught ?? 0);
  return out;
}

/**
 * Split gold into coin pickups of 25 / 5 / 1 (at most MAX_COIN_PICKUPS; the remainder goes into
 * the last coin, which keeps the kind of its face value).
 * @param {number} gold
 * @param {{ kind: string, amount: number }[]} out filled from index 0; returns the count
 * @returns {number}
 */
export function splitCoins(gold, out) {
  let n = 0;
  let left = Math.max(0, Math.floor(gold));
  for (const [value, kind] of COINS) {
    while (left >= value && n < MAX_COIN_PICKUPS) {
      out[n].kind = kind;
      out[n].amount = value;
      n++;
      left -= value;
    }
  }
  if (left > 0 && n > 0) out[n - 1].amount += left;
  return n;
}
