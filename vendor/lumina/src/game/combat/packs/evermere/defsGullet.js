/**
 * Old Gullet, the Thing under the Bay (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): its base
 * stats, and those of its arms — the `tentacle`, an add-only kind (no `enemy` object places one: the
 * head's pool of adds, six at level 5, raises them through the ice). A boss's numbers are not scaled
 * (`scaledDef`); a tentacle's are, at its pool's level. Owner: the gullet package. Pure data and
 * import-free (Node-safe); registered by ./index.js.
 *
 * The head's arena is the pack's ice gate (`arena`: the literal of ./core.js `EV_ARENA`, COMBAT.md
 * §30.2); its 0 HP a release, not a death (`release`, §30.7: it sinks back into the deep, freed —
 * ./gullet.js `dead`), no banner and no results card (`victory`: the story's cutscene carries its
 * defeat on at once — Saltcombe's `sc_gullet_down`).
 *
 * Balance (EV-22: sandbox/gullet.arena.json — `arena`, fixed step on the real arena, Saltcombe's
 * basin on a new journey from `tides-gullet`, the party of three at level 7: Linnet with the
 * bellwarden's kit and 4 draughts, Corin the ranger, Wenna the greatshield): the head takes damage
 * only while it is up — the punish windows of 6 s (5 s in phase 3, where two pains bring it up)
 * after every third slam or cut arm, the frost-ink inside them from phase 2 — so its HP is the
 * party's damage per second up × the time up an 80 s flawless fight gives. 2000 at first, when the
 * companions dealt 11–29 % of it (a mean of 18): flawless 60–108 s (a mean of 80; the
 * surfacings quantise it). Since the companions press the windows (EVM-06: the head's hints,
 * ./gullet.js `ALLY_HINTS` — out of the holes, rolling out of its telegraphs, waiting at the glint)
 * they deal 24–35 %, and 2000 went down in 64–66 s on the arena (2400: 91–100 s): 2200 → flawless
 * 72–95 s (a mean of 81), the careless bot (no roll, a draught below 40 %, dead is lost) released
 * alive in all three seeds (79–94 s) — no stat scales with the party (the fight is tuned
 * for the party it offers). Its
 * knockdowns (the slam: mv 0.7) hurt ≈ 10 at level 7, not the 13–18 the review met. The arms are
 * what the party fights while the head is under: a cut arm (HP 0) sinks and counts as a slam toward
 * the next surfacing.
 *
 * @import { EnemyDef } from '../../defs.js'
 * @import { EnemyPackApi } from '../index.js'
 */

/**
 * The head and its arms. (`tentacle` is not a placed kind: ObjectCatalog's `ENEMY_KINDS` holds only
 * what a level may place; the `PackEnemyKind` / `EnemySheetKind` unions hold it.)
 * @type {Readonly<Record<'gullet'|'tentacle', EnemyDef>>}
 */
export const GULLET_DEFS = Object.freeze({
  gullet: {
    name: 'Old Gullet', epithet: 'The Thing under the Bay', hp: 2200, atk: 24, def: 8, poise: 320,
    mass: Infinity, speed: 0, phaseSpeeds: [0, 0, 0], phases: [0.65, 0.30],
    aggro: 0, leash: Infinity, radius: 1.7, moveRadius: 1.3, body: [0, 4.4], xp: 520, gold: [220, 220],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 5.6,
    adds: [{ kind: 'tentacle', count: 6, level: 5 }],
    introOnSpawn: true,
    // (./core.js EV_ARENA: the ice gate, the rime motes, the frost outline)
    arena: {
      wall: { frames: 'evIceWall', color: [0.3, 0.68, 1.0] },
      emitter: {
        preset: 'embers', color: '#9fe6ff', colorEnd: '#3f7fc0', hdr: 1.25, size: [0.06, 0.1],
        velocity: [0, 0.55, 0], gravity: -0.05, twinkle: 0.6, count: 70,
      },
      outline: 'frost',
    },
    // (no banner, no results card: its `cleared` opens the story's cutscene at once — Wenna's receipt)
    victory: { title: 'combatEv.victory.title', line: null, results: false, drop: 'maxHp' },
    release: true,
  },
  tentacle: {
    // an arm of the head: anchored in its hole (no knockback, never staggered), no XP, no loot
    name: 'Tentacle', hp: 100, atk: 15, def: 6, poise: Infinity, mass: Infinity, speed: 0,
    aggro: 40, leash: Infinity, radius: 0.75, moveRadius: 0.55, body: [0, 3.4], xp: 0, gold: [0, 0],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: false, labelY: 4.0,
  },
});

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerEnemyDefs(GULLET_DEFS);
}
