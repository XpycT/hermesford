/**
 * The guardians of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): the base
 * stats of Rimehart, the Stag of the Waking Wood (2 phases), and the Harvest Mawkin (3 phases, its
 * adds the Rime Crow). Bosses: `scaledDef` leaves their numbers unscaled (the level is display-only).
 * Owner: the guardians package. Pure data and import-free (Node-safe); registered by ./index.js.
 *
 * HP from the party's measured DPS × the contract's targets (§10; `sandbox/guardians.js`
 * `bossProbe`: fixed steps, seeds 1–3, Linnet's bellwarden kit, the companions at Balanced). The
 * careless player never rolls and drinks its three draughts below 40 %:
 * - **Rimehart** faces Linnet (Lv 5) and Corin (the ranger) in the Blossomwood's glade, 60 s
 *   flawless / 90 s careless: the flawless party 58–60.6 s (64.4–67.2 DPS, Corin 18–20 %), the
 *   careless one 75.1–75.5 s, taking 260–337 HP (its 148 and three draughts; one run in three dips
 *   below 25 % after the last draught) → 3900 HP, ATK 12. Phase 2 at 55 % (`phases` holds one
 *   threshold: two phases). It rises through the story (`introOnSpawn`: its group appears with
 *   `when`, and its intro — the head raised, the bellow — plays at once, under the author's title
 *   card). Poise per phase: a break is an event (once or twice a phase), not a lock.
 * - **The Harvest Mawkin** faces Linnet (Lv 8–9), Corin and Wenna (the greatshield) at Amberfield,
 *   90 / 140 s: flawless 85.8–93.3 s at Lv 8 (78.2–85.1 DPS), 80.1 s at Lv 9; careless 95.5–109.9 s,
 *   taking 292–425 HP (its 184 and three draughts; 88.1 s and 281 HP at Lv 9) → 7300 HP, ATK 19.
 *   Phases at 60 % and 25 %; it rises from the wheat through the story (`introOnSpawn`); adds: Rime
 *   Crows (its pool: six at level 8 — the transition's three and the North Wind's riders).
 *
 * Both: Evermere's ice arena (`ICE_ARENA`: a copy of ./core.js `EV_ARENA` — the gate of ice shards,
 * rime motes for the phase emitter, the frost outline; this file stays import-free), a release at
 * 0 HP (`release: true`: the brain's `dead` holds the body — Rimehart's shell and walk north, the
 * Mawkin's heap), no banner and no results card (`line: null`, `results: false`: each guardian's
 * `cleared` opens the story's scene on the next frame — the stag kneeling still frosted, the coat
 * and the wish). Drops: Rimehart an upgrade of max HP, the Mawkin one of attack.
 *
 * @import { EnemyDef } from '../../defs.js'
 * @import { EnemyPackApi } from '../index.js'
 */

/** Evermere's ice arena (a copy of ./core.js `EV_ARENA`). */
const ICE_ARENA = Object.freeze({
  wall: Object.freeze({ frames: 'evIceWall', color: Object.freeze([0.3, 0.68, 1.0]) }),
  emitter: Object.freeze({
    preset: 'embers', color: '#9fe6ff', colorEnd: '#3f7fc0', hdr: 1.25, size: Object.freeze([0.06, 0.1]),
    velocity: Object.freeze([0, 0.55, 0]), gravity: -0.05, twinkle: 0.6, count: 70,
  }),
  outline: 'frost',
});

/** @satisfies {Record<'rimehart'|'mawkin', EnemyDef>} */
export const GUARDIAN_DEFS = {
  rimehart: {
    name: 'Rimehart', epithet: 'The Stag of the Waking Wood', hp: 3900, atk: 12, def: 6, poise: 520,
    mass: Infinity, speed: 2.2, phaseSpeeds: [2.2, 2.8], phases: [0.55],
    aggro: 0, leash: Infinity, radius: 1.3, moveRadius: 0.8, body: [0, 4.4], xp: 300, gold: [120, 120],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 6.2,
    introOnSpawn: true, release: true, arena: ICE_ARENA,
    victory: { title: 'combatEv.victory.title', line: null, results: false, drop: 'maxHp' },
  },
  mawkin: {
    name: 'Harvest Mawkin', epithet: 'Keeper of the Frozen Field', hp: 7300, atk: 19, def: 8, poise: 640,
    mass: Infinity, speed: 1.7, phaseSpeeds: [1.7, 2.0, 2.4], phases: [0.60, 0.25],
    aggro: 0, leash: Infinity, radius: 1.1, moveRadius: 0.7, body: [0, 5.0], xp: 650, gold: [250, 250],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 6.4,
    adds: [{ kind: 'rimecrow', count: 6, level: 8 }], introOnSpawn: true, release: true, arena: ICE_ARENA,
    victory: { title: 'combatEv.victory.title', line: null, results: false, drop: 'attack' },
  },
};

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerEnemyDefs(GUARDIAN_DEFS);
}
