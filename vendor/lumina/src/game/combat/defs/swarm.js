/**
 * The swarms of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7): the base
 * stats (at enemy level 1; `scaledDef` scales them, COMBAT.md §7.2) of the Scalekin Skirmisher, the
 * Ashwing Whelp and the Ember Imp — small foes that rush the party in packs of up to 8 (`swarm`
 * groups), waves of 12–24 on screen. Spread into `ENEMY_DEFS` (../defs.js). Owner: the swarm package.
 * Pure data, Node-safe.
 *
 * Tuned for a level-10 party of four (their groups are placed at level 8–10). At level 10:
 *
 * | kind | HP | ATK | the player's (Lv 10, DEF 13) loss per hit | dies to |
 * | --- | --- | --- | --- | --- |
 * | kobold | 420 | 29 | jab ≈ 15, second jab ≈ 15, lunge ≈ 22 | about four full combos |
 * | whelp | 448 | 29 | bite ≈ 17, fire spit ≈ 14 | about four full combos |
 * | emberimp | 280 | 25 | fire orb ≈ 13, diving burst ≈ 19 | about three full combos |
 *
 * Balance (the fix round, rv-play #7: 98 foes fell to the party in the Wyrmspine with the player
 * never below 164 / 208 HP, a wave gone in 10–20 s, 2 s after a Skyfall): HP × 5 (the kobold 28 →
 * 150, whelp 32 → 160, imp 20 → 100) and ATK × 1.5–1.75 (8 → 14, 9 → 14, 8 → 12). Measured with
 * `sandbox/fix_party.waves.json` (a careless player in fixed steps — no roll, no draught — and the
 * three companions on each of the six waves, from full HP; two runs): a wave takes 17–44 s (≈ 30 s;
 * the first, twelve kobolds, ≈ 20 s) and costs that player 6–81 % of its HP (≈ 40 % on average, the
 * fourth wave the worst); nobody dies. A player who rolls and drinks loses far less.
 *
 * Tokens: a kobold or a whelp takes three quarters of a melee token (`cost: 0.75`) — the melee
 * budget of 3 lets four small foes strike at once (a pack is dangerous because it presses from
 * every side; six at once buried the hero under sprites); an imp a whole ranged token (two imps
 * cast at a time: more fire lanes than that turned a wave into a glare of telegraphs). The rest of the pack holds its places round the target, shuffling and
 * feinting, and takes its turn when a token comes free (the brains: ../ai/kobold.js, whelp.js,
 * emberimp.js).
 * Poise: the kobold's hide shield takes one swing (14 > A1's 10, the combo's second swing breaks
 * it); whelps and imps flinch from every hit (0). `speed` is the approach speed (the brains rush
 * faster from afar).
 *
 * @import { EnemyDef } from '../defs.js'
 */

/** @satisfies {Record<'kobold'|'whelp'|'emberimp', EnemyDef>} */
export const SWARM_DEFS = {
  kobold: {
    name: 'Scalekin Skirmisher', hp: 150, atk: 14, def: 2, poise: 14, mass: 0.7, speed: 3.8, strafeSpeed: 2.6,
    aggro: 10, leash: 14, radius: 0.32, moveRadius: 0.26, body: [0, 1.0], xp: 9, gold: [1, 4],
    drops: { heart: 0.06, mana: 0.06, draught: 0 }, token: { type: 'melee', cost: 0.75 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 1.45,
  },
  whelp: {
    name: 'Ashwing Whelp', hp: 160, atk: 14, def: 3, poise: 0, mass: 0.9, speed: 3.5,
    aggro: 10, leash: 14, radius: 0.42, moveRadius: 0.32, body: [0, 0.95], xp: 10, gold: [1, 5],
    drops: { heart: 0.07, mana: 0.05, draught: 0 }, token: { type: 'melee', cost: 0.75 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 1.5,
  },
  emberimp: {
    name: 'Ember Imp', hp: 100, atk: 12, def: 0, poise: 0, mass: 0.5, speed: 4.6,
    aggro: 11, leash: 14, radius: 0.32, moveRadius: 0.28, body: [-0.4, 0.45], xp: 9, gold: [1, 4],
    drops: { heart: 0.05, mana: 0.09, draught: 0 }, token: { type: 'ranged', cost: 1 },
    flier: true, hover: 1.6, passive: false, boss: false, labelY: 2.65,
  },
};
