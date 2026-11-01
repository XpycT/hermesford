/**
 * The foes of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): the base stats
 * (enemy level 1; `scaledDef` scales HP, ATK, XP and gold by the level, COMBAT.md §7.2 — DEF, poise
 * and speeds stay) of the Hushguard, the Frost Wolf, the Rime Crow and the Hush Cantor. Owner: the
 * foes package. Pure data and import-free (Node-safe: the campaign's generator may read it);
 * registered by ./index.js. The packs sit at levels 2–10 (§3: the prologue 2–3, the Blossomwood 3–5,
 * Saltcombe 5–7, Amberfield 7–9, Rimeholt 9–10 and elites).
 *
 * Tuned with the fixed-step pack probes of sandbox/foes_ev.js (`probe`, sandbox/foes_ev.probe.json:
 * a careless player — no dodging — on the bellwarden's kit, with the party a region offers, against
 * the region's packs and swarms; a pack fight 15–40 s, EVERMERE_CAMPAIGN.md §10). With her skills
 * (Peal / Toll / Carillon as they open) every pack takes 15–19 s and costs ≤ 38 % HP; the swarms
 * 12.5 s (Saltcombe's five) and 36 s (Rimeholt's seven and two cantors); her combo alone 15–52 s
 * and ≤ 47 % (five wolves at Lv 5, a pack no region places, 62 %):
 *   - **Hushguard** 165 HP (231 at Lv 3, 330 at Lv 6, 462 at Lv 10), DEF 6 — but its armour takes
 *     × 0.35 until its poise (60: one Peal, one hammer combo) breaks, then × 1.6 for 3 s
 *     (./hushguard.js); ATK 10, a slow two-cut combo (mv 1.1 + 1.2); a token of 1.5 (two of a pack
 *     strike at once).
 *   - **Frost Wolf** 240 HP (336 at Lv 3, 432 at Lv 5), ATK 6 (a pack's bites: careless players lost
 *     69–73 % at 9), DEF 3, fast (4.2 u/s), poise 20 (the second hit of a combo staggers it); a
 *     token of 1.5 (two of a pack strike at once, the rest circle).
 *   - **Rime Crow** 160 HP, ATK 8, a flier at 1.4 u (its wingbeat bobs it about 1.3), poise 0
 *     (every hit knocks it about). The Mawkin's adds too (six at Lv 8).
 *   - **Hush Cantor** 170 HP, ATK 10, poise 12 (one combo staggers its call), a *ranged* token (the
 *     party's "Archers & casters" go for it first), mana-rich drops. The King's court too.
 *
 * @import { EnemyDef } from '../../defs.js'
 * @import { EnemyPackApi } from '../index.js'
 */

/** @satisfies {Record<'hushguard'|'frostwolf'|'rimecrow'|'cantor', EnemyDef>} */
export const FOE_DEFS = {
  hushguard: {
    name: 'Hushguard', hp: 165, atk: 10, def: 6, poise: 60, mass: 1.8, speed: 2.6, strafeSpeed: 1.8,
    aggro: 8, leash: 12, radius: 0.45, moveRadius: 0.35, body: [0, 2.2], xp: 22, gold: [4, 10],
    drops: { heart: 0.14, mana: 0.1, draught: 0.03 }, token: { type: 'melee', cost: 1.5 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.9,
  },
  frostwolf: {
    name: 'Frost Wolf', hp: 240, atk: 6, def: 3, poise: 20, mass: 1.1, speed: 4.2, strafeSpeed: 2.6,
    aggro: 9, leash: 13, radius: 0.45, moveRadius: 0.35, body: [0, 1.1], xp: 12, gold: [2, 6],
    drops: { heart: 0.1, mana: 0.06, draught: 0.02 }, token: { type: 'melee', cost: 1.5 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 1.7,
  },
  rimecrow: {
    name: 'Rime Crow', hp: 160, atk: 8, def: 0, poise: 0, mass: 0.5, speed: 4.8,
    aggro: 10, leash: 13, radius: 0.35, moveRadius: 0.3, body: [-0.4, 0.4], xp: 9, gold: [1, 4],
    drops: { heart: 0.06, mana: 0.1, draught: 0 }, token: { type: 'melee', cost: 1 },
    flier: true, hover: 1.4, passive: false, boss: false, labelY: 2.4,
  },
  cantor: {
    name: 'Hush Cantor', hp: 170, atk: 10, def: 2, poise: 12, mass: 1.0, speed: 2.4,
    aggro: 10, leash: 14, radius: 0.35, moveRadius: 0.3, body: [0, 2.0], xp: 20, gold: [6, 12],
    drops: { heart: 0.08, mana: 0.3, draught: 0.03 }, token: { type: 'ranged', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.7,
  },
};

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerEnemyDefs(FOE_DEFS);
}
