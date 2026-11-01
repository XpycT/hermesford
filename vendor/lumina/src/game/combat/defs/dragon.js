/**
 * Vorthrax, the Ashen Tyrant — the dragon boss of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.6): its base stats (a boss: `scaledDef` leaves its
 * numbers unscaled, its level is display-only). Spread into `ENEMY_DEFS` (../defs.js). Owner: the
 * dragon package. Pure data, Node-safe.
 *
 * Tuned for a level-10 party of four (the hero: 208 HP, ATK 39, DEF 13; three companions) and a
 * 1.5–2 minute fight (ai/dragon.js has the moves):
 * - **ATK 34.** Against DEF 13 (× 40 / 66) a claw (mv 1.4) hits a hero for ≈ 29 (14 % of 208), the
 *   bite (mv 1.9) ≈ 39, the stomp's slam (1.6) ≈ 33 plus a ring (1.0) ≈ 21, a barrage fireball
 *   (1.3) ≈ 27, the dive (1.7) ≈ 35, a breath tick (0.5) ≈ 10 — 2 to 4 ticks for a hero caught
 *   in the sweep; the burning ground 10 HP/s. A hero who eats every move of a phase-1 cycle falls
 *   in ≈ 7 hits: dangerous alone, survivable with the cleric's heals and the greatshield's ward.
 * - **HP 8000** (halved from 16000 on 2026-10-18 after playtesting). Measured in the
 *   campaign's lair, sandbox/dragon.lair.balance.json (120 s of the fight in god mode: the
 *   swordmaster's combo without pause and skills on cooldown, standing in front of it through every
 *   move; Seraphine, Lyra and Brannoc on their presets): 11534 HP taken in 120 s, ≈ 112 DPS while
 *   it stands, ≈ 17 s of the 120 in the air (guarded) (the fixture's traveller kit,
 *   sandbox/dragon.balance.json: 11307 HP, 103 DPS). At 8000 HP the same probe kills it in 77.6 s
 *   (phase 3 reached), and the careless-player probe (sandbox/fix_party.boss.json: no roll, no
 *   draught, the companions on their presets) in 109.7 s; a human party needs ≈ 1.5–2 minutes; a
 *   hero alone far longer (the lair is meant for four; no stat scales with the party).
 * - **DEF 12** (the hero's hits × 0.63), **poise 1800** per phase: a focused party breaks it about
 *   once a phase (Broken 150 f, vuln 1.3); at 420 it broke every ~10 s and the fight was a stun lock.
 * - Phases at 65 % and 30 % (`phases`); walk 2.2 / 2.6 / 3.0 u/s; hurt radius 2.6 (its body and
 *   chest; the claws and the snout reach past it), body band 0–5 u.
 * - `adds: 'whelp'`: the phase-2 roar calls three Ashwing Whelps (the swarm package's dragonlings,
 *   pooled at level 5 by core), three more at phase 3 if fewer than two live.
 * - `introOnSpawn`: when the story brings its group (`when: dragon-descends`) the descent begins at
 *   once (core).
 *
 * @import { EnemyDef } from '../defs.js'
 */

/** @satisfies {Record<'dragon', EnemyDef>} */
export const DRAGON_DEFS = {
  dragon: {
    name: 'Vorthrax', epithet: 'The Ashen Tyrant', hp: 8000, atk: 34, def: 12, poise: 1800,
    mass: Infinity, speed: 2.2, phaseSpeeds: [2.2, 2.6, 3.0], phases: [0.65, 0.30],
    aggro: 0, leash: Infinity, radius: 2.6, moveRadius: 1.6, body: [0, 5], xp: 1200, gold: [500, 500],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 7.5,
    adds: 'whelp', introOnSpawn: true,
  },
};
