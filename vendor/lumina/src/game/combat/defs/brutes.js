/**
 * The brutes of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7): the base
 * stats (at enemy level 1; `scaledDef` scales them, COMBAT.md §7.2) of the Drakeborn Ravager, the
 * Ashen Hellhound and the Wyrmcult Pyromancer — medium, strong foes that besiege houses in groups
 * of 3–5. Spread into `ENEMY_DEFS` (../defs.js). Owner: the brutes package. Pure data, Node-safe.
 *
 * Tuned for a level-10 party of four (the player and three companions) against groups placed at
 * level 8–10 (`sandbox/brutes.fight.json` measures it: each group falls in 17–32 s to a fight bot
 * that never dodges, the player taking 80–290 HP of its 208). At level 10:
 *   - Drakeborn Ravager 700 HP, ATK 33, DEF 7, poise 110: a cleave (mv 1.3) takes ≈ 26 of a
 *     level-10 player's 208 HP, the slam (mv 1.6, knockdown) ≈ 32, the gore (mv 1.5) ≈ 30;
 *   - Ashen Hellhound 812 HP, ATK 33, DEF 4: a bite ≈ 17 (a combo of two or three), the pounce
 *     ≈ 25, the breath ≈ 6 a tick (six ticks for a player who stays in the cone);
 *   - Wyrmcult Pyromancer 350 HP, ATK 37, DEF 2: a fireball ≈ 28, a pillar ≈ 25 (three per cast).
 * Tokens: one melee unit each (three brutes swing at once at most), the pyromancer a ranged one.
 * Heights from the sheets: the drakeborn ≈ 3 u to its crown (3.6 with the horns), the hound 1.3 u
 * at the shoulder (2 u to its ears), the pyromancer 2.3 u to its hood (2.6 with the horns); the
 * bars and alerts (`labelY`) sit over the horns, the mane's flames and the staff's fire.
 */

/** @import { EnemyDef } from '../defs.js' */

/** @satisfies {Record<'drakeborn'|'ashhound'|'wyrmcaller', EnemyDef>} */
export const BRUTE_DEFS = {
  drakeborn: {
    name: 'Drakeborn Ravager', hp: 250, atk: 16, def: 7, poise: 110, mass: 3.5, speed: 2.5, chargeSpeed: 9.5,
    aggro: 9, leash: 14, radius: 0.7, moveRadius: 0.5, body: [0, 2.9], xp: 40, gold: [12, 24],
    drops: { heart: 0.22, mana: 0.12, draught: 0.05 }, token: { type: 'melee', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 3.8,
  },
  ashhound: {
    name: 'Ashen Hellhound', hp: 290, atk: 16, def: 4, poise: 40, mass: 1.8, speed: 4.4, chargeSpeed: 10,
    aggro: 10, leash: 14, radius: 0.55, moveRadius: 0.4, body: [0, 1.4], xp: 26, gold: [6, 14],
    drops: { heart: 0.16, mana: 0.08, draught: 0.03 }, token: { type: 'melee', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.4,
  },
  wyrmcaller: {
    name: 'Wyrmcult Pyromancer', hp: 125, atk: 18, def: 2, poise: 25, mass: 1.0, speed: 2.5,
    aggro: 11, leash: 14, radius: 0.4, moveRadius: 0.3, body: [0, 2.3], xp: 30, gold: [8, 16],
    drops: { heart: 0.12, mana: 0.3, draught: 0.04 }, token: { type: 'ranged', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 3.0,
  },
};
