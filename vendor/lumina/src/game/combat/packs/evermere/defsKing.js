/**
 * The Hushed King (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): his base stats (a boss:
 * `scaledDef` leaves them unscaled) and the numbers of his fight and of the Hush Bell's toll, read by
 * ./hushedking.js (the brain) and ./HushToll.js. Owner: the king package. Pure data and import-free
 * (Node-safe); registered by ./index.js.
 *
 * Tuning (sandbox/king.js `probe`, fixed step, the party of four at level 10 — Linnet, a ranger, a
 * greatshield and a warden —, seeds 1–3): see KING_TUNING's notes. HP is set from the measured
 * flawless party DPS × the contract's 120 s (§10) less the beats he cannot be hurt (the phase
 * changes, the P3 scene); `atk` from the careless player's losses (a careless run must end near
 * 180 s with a few draughts drunk, never a wall).
 *
 * The core's boss fields (COMBAT.md §30): `adds` as a list (P2's court: two Hushguard and a Hush
 * Cantor at level 10, pooled; the brain shows them), `arena` (the ice gate: core.js `EV_ARENA`,
 * copied — this file stays import-free), `victory` (no banner and no drop: the authors' crown scene
 * follows the release at once, §2.6.7), `release` (his 0 HP is a release, not a death: the brain's
 * `die` shatters the crown, `dead` holds the uncrowned kneel until the story takes the group).
 *
 * @import { EnemyDef } from '../../defs.js'
 * @import { EnemyPackApi } from '../index.js'
 */

/** @satisfies {Record<'hushedking', EnemyDef>} */
export const KING_DEFS = {
  hushedking: {
    name: 'The Hushed King', epithet: 'Lord of the Stopped Year', hp: 12400, atk: 26, def: 10, poise: 520,
    mass: Infinity, speed: 2.2, phaseSpeeds: [2.2, 2.5, 2.8], phases: [0.65, 0.30],
    aggro: 0, leash: Infinity, radius: 0.75, moveRadius: 0.55, body: [0, 2.6], xp: 1500, gold: [600, 600],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 3.5,
    adds: [{ kind: 'hushguard', count: 2, level: 10 }, { kind: 'cantor', count: 1, level: 10 }], introOnSpawn: false,
    arena: {
      wall: { frames: 'evIceWall', color: [0.3, 0.68, 1.0] },
      emitter: {
        preset: 'embers', color: '#9fe6ff', colorEnd: '#3f7fc0', hdr: 1.25, size: [0.06, 0.1],
        velocity: [0, 0.55, 0], gravity: -0.05, twinkle: 0.6, count: 70,
      },
      outline: 'frost',
    },
    victory: { line: null, drop: null, results: false },
    release: true,
  },
};

/**
 * The fight's numbers (frames at 60 fps unless named `…S` = seconds; u = world units). Every
 * wind-up is ≥ 18 f with a marker (§6.7); phase 3 shortens them × 0.75 (never below 18).
 */
export const KING_TUNING = Object.freeze({
  /** Phase 2's court (§6.7): two Hushguard and a Hush Cantor, at the level the core gives them. */
  adds: Object.freeze([Object.freeze({ kind: 'hushguard', count: 2 }), Object.freeze({ kind: 'cantor', count: 1 })]),
  /** Black Peal — Linnet's Peal from the other side: a cone r 5.4, ± 35°. */
  peal: Object.freeze({ windup: 36, active: 6, recover: 30, r: 5.4, half: 35, mv: 1.25, kb: 3.0, range: 5.2 }),
  /**
   * Black Toll — a black bell planted for 6 s ≤ 6 u away; it tolls every 1.5 s (four rings r 3.5:
   * stand outside them — each pushes out, mv 0.75). The first ring fills over 60 f, the next three
   * over the 90 f between them.
   */
  toll: Object.freeze({ windup: 30, recover: 24, reach: 6, r: 3.5, rings: 4, first: 60, every: 90, mv: 0.75, kb: 4.2, life: 6 }),
  /** Leap Slam — a crouch, a tracked landing circle (locks 12 f before he leaves), 30 f in the air. */
  leap: Object.freeze({ windup: 34, lock: 12, air: 30, recover: 42, r: 2.6, mv: 1.6, kb: 3.2, min: 4, max: 12, lead: 0.3, apex: 2.6 }),
  /** Phase ≥ 2: the slam's refreeze wave (a ring r 0.6 → 6.5 at 7 u/s). */
  wave: Object.freeze({ rMax: 6.5, speed: 7, width: 0.7, mv: 1.0, kb: 1.6 }),
  /** Hammer Sweep — the punish for standing at his side or back: r 2.9 around him. */
  sweep: Object.freeze({ windup: 30, active: 6, recover: 30, r: 2.9, mv: 1.1, kb: 3.2 }),
  /** Phase ≥ 2: Rime Lane — ice spikes erupting along a tracked lane, 1.6 wide, 12 long. */
  lane: Object.freeze({ windup: 40, lock: 12, recover: 36, len: 12, width: 1.6, speed: 26, mv: 1.3, kb: 2.2, every: 0.9 }),
  /**
   * Phase 3: Black Carillon — super armour; four black bells drop round him 12 f apart (r 1.7 each,
   * on the motif backwards), the chord a ring r 0.5 → 8.5 at 9 u/s; then he kneels, stunned 4 s,
   * the crown exposed (vulnerability 1.5, every hit a critical: the core's kneel rule).
   */
  carillon: Object.freeze({ windup: 30, drop: 12, bellR: 1.7, bellMv: 0.8, bellKb: 2.0, chordAt: 30, rMax: 8.5, speed: 9, width: 1.0, mv: 1.7, kb: 4, kneel: 240, vuln: 1.5, first: 6, cooldown: 22 }),
  /** Phase 3: he rings the Hush Bell himself — 8 s after the last toll passed (HushToll). */
  ring: Object.freeze({ windup: 30, recover: 18, everyS: 8 }),
  /** Broken (poise spent): 180 f kneeling, vulnerability 1.3. */
  broken: Object.freeze({ f: 180, vuln: 1.3 }),
  /** Seconds between moves per phase [min, max] (f). */
  gap: Object.freeze([Object.freeze([48, 78]), Object.freeze([42, 70]), Object.freeze([30, 54])]),
  /** Cooldowns (f), from a move's start. */
  cooldown: Object.freeze({ peal: 150, toll: 540, toll2: 420, leap: 300, sweep: 120, lane: 330 }),
  /** The phase changes: P2's court rises over 120 f (guarded); P3's crown flares over 90 f. */
  phase2: 120, phase3: 90,
  /** The release (0 HP): the crown shatters at the kill frame; he kneels uncrowned this many frames later. */
  bare: 10,
});

/**
 * The Hush Bell's toll (HushToll.js; §3 Rimeholt, §6.7): three beats 54 f apart — the three strokes
 * of the composer's `hushToll` (0, 0.9, 1.8 s: src/engine/audio/evermere/Sounds.js), played once
 * at the first —, then
 * a dark ring rolls out of the bell's mouth at `wave` u/s; when it reaches the player a level-wide
 * pulse lands (`power` flat; `knock` u away from the bell and a knockdown) on everyone outside warmth — only while a fight is engaged
 * (the core's rule). The period counts from the end of a toll (the ring past the player) to the next
 * first beat: 20 s in Rimeholt and outside the King's fight, 15 s in his phase 2, 8 s in phase 3
 * (he rings it then). In phase 2 the brazier nearest the player dies `douse` s after each landing.
 */
export const TOLL_TUNING = Object.freeze({
  beats: 3, beatF: 54, wave: 22, power: 30, knock: 1.2, douse: 0.5,
  period: Object.freeze({ base: 20, court: 15, crown: 8 }),
  /** The first toll after a level's start or a reset waits this long (s). */
  first: 6,
});

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerEnemyDefs(KING_DEFS);
}
