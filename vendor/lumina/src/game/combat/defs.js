/**
 * Enemy stats (COMBAT.md §7.1, §7.2, §7.8, §9.4) — pure data plus `scaledDef`, the single
 * implementation of level scaling and elites. Base values are at enemy level 1. Times in the AI
 * brains are frames (§ conventions); everything here is units, u/s, HP or probabilities.
 *
 * Fields: name (display), hp, atk, def, poise (Infinity: never staggers), mass (Infinity: never
 * moved by separation or knockback), speed (u/s; extra speeds per kind), aggro / leash (u), radius
 * (hurt radius, every hit test), moveRadius (movement, separation, stuck test), body [y0, y1] (u
 * above the feet; bat: relative to its live hover), xp, gold [min, max], drops (heart / mana /
 * draught chances rolled in that order after the gold), token ({ type: 'melee'|'ranged', cost } or
 * null: no attack tokens), flier, hover (u), passive, boss, labelY (u above the feet for the bar
 * and the '!' alert).
 *
 * Owned by the enemies package after the foundation. Balance pass (COMBAT-12, measured with the
 * fixed-step play-through bot in its expert and human settings, `sandbox/combat_play.js`): the bat
 * 18 → 24 HP and ATK 7 → 8 (the Hollow Mire was barely a step up from the glade; its adds in the
 * boss fight too), Cinderheart's ATK 24 → 22 (a human-like player at ≈ 30 % damage uptime fell in
 * phase 3 in most runs; the fight's length is unchanged — HP stays 1800, greedy floor ≈ 40 s at
 * Lv 5, ≈ 35 s with every chest and shop ware). The boss length check of §8.3 may raise the golem's
 * HP here. Cinderheart's HP 1800 → 5200 (COMBAT.md §27.24): Cinderwatch Pass, the golem's one level, is
 * balanced for a party of four — three companions add their damage (the boss never targets them);
 * the human model beside the party needs 85–153 s, a greedy player alone ≈ 100 s.
 */

// The types of this data live here, as JSDoc, so the Node tools that import this file
// (tools/make-cinderwatch-pass.mjs) check it without the combat graph; ./types.d.ts re-exports them.

// the kinds of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3): one module per
// package, spread into ENEMY_DEFS (pure data, Node-safe like this file)
import { BRUTE_DEFS } from './defs/brutes.js';
import { SWARM_DEFS } from './defs/swarm.js';
import { DRAGON_DEFS } from './defs/dragon.js';

/**
 * The enemy kinds this file and `ai/index.js` hold from the start (COMBAT.md §7.1). The last seven
 * are Vanquish the Evil Dragon's (./defs/brutes.js, swarm.js, dragon.js).
 * @typedef {'slime'|'goblin'|'archer'|'shaman'|'bat'|'boar'|'dummy'|'golem'
 *   |'drakeborn'|'ashhound'|'wyrmcaller'|'kobold'|'whelp'|'emberimp'|'dragon'} BaseEnemyKind
 */
/**
 * The kinds of the lazy enemy packs (./packs/index.js): registered into `ENEMY_DEFS`, `BRAINS` and
 * the sheets when a level that uses them loads its combat — The Bells of Evermere's eight
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.4).
 * @typedef {'hushguard'|'frostwolf'|'rimecrow'|'cantor'|'rimehart'|'mawkin'|'gullet'|'hushedking'|'tentacle'} PackEnemyKind
 */
/**
 * Enemy kinds (ObjectCatalog `ENEMY_KINDS`, COMBAT.md §7.1; the `ENEMY_DEFS` and `ai/index.js`
 * `BRAINS` keys): the base kinds and the packs' (present once their pack registered).
 * @typedef {BaseEnemyKind|PackEnemyKind} EnemyKind
 */

/**
 * An attack token of a kind (§7.5): which budget (melee 3, ranged 2) and its cost.
 * @typedef {object} EnemyToken
 * @property {'melee'|'ranged'} type  the budget it is taken from
 * @property {number} cost            budget units it takes while the enemy attacks (boar 2, others 1)
 */

/**
 * Drop chances (0..1) rolled after the gold, in this order (§7.8, `Loot.js`).
 * @typedef {object} EnemyDrops
 * @property {number} heart    a heart pickup (restores HP); doubled while the player is below 30 % HP
 * @property {number} mana     a mana mote (restores MP)
 * @property {number} draught  a Healing Draught (one more potion, up to the carry cap)
 */

/**
 * One `ENEMY_DEFS` entry: base stats at enemy level 1 (§7.1, §9.4).
 * @typedef {object} EnemyDef
 * @property {string} name            display name
 * @property {string} [epithet]       boss subtitle (golem)
 * @property {number} hp              hit points at level 1 (scaled by `scaledDef`)
 * @property {number} atk             attack: the base of its hits' damage (ATK × mv, §6.3)
 * @property {number} def             defence: incoming damage × 40 / (40 + 2 × def) (§6.3)
 * @property {number} poise           poise pool: staggers when poise damage empties it (Infinity: never)
 * @property {number} mass            divides knockback and separation pushes (Infinity: never moved)
 * @property {number} speed           walk speed (u/s)
 * @property {number} [strafeSpeed]   goblin strafe speed (data only; the brain uses its own constant)
 * @property {number} [chargeSpeed]   boar charge speed (data only; the brain uses its own constant)
 * @property {number[]} [phaseSpeeds] golem walk speed per phase
 * @property {number[]} [phases]      golem: HP fractions where phases 2 and 3 start ([0.70, 0.35])
 * @property {number} aggro           sight aggro range (u)
 * @property {number} leash           leash (u) beyond the home radius (Infinity: the boss)
 * @property {number} radius          hurt radius (every hit test)
 * @property {number} moveRadius      movement / separation / stuck radius
 * @property {[number, number]} body  body band [y0, y1] above the feet (bat: relative to its hover)
 * @property {number} xp              experience granted on the kill at level 1 (scaled)
 * @property {[number, number]} gold  gold range [min, max] at level 1 (scaled)
 * @property {EnemyDrops} drops       drop chances after the gold
 * @property {EnemyToken|null} token  null: no attack tokens (dummy, golem)
 * @property {boolean} flier          flies at `hover` (`ctx.moveFly`: crosses water and ledges)
 * @property {number} hover           hover height above the ground (fliers; 0 otherwise)
 * @property {boolean} passive        never aggroes or attacks, no XP / loot (dummy)
 * @property {boolean} boss           the boss (golem): its brain drives every state; boss bar, phases
 * @property {number} labelY          height of the HP bar and the '!' alert above the feet
 * @property {EnemyKind|ReadonlyArray<{ kind: EnemyKind, count?: number, level?: number }>} [adds]
 *   a boss: the kind of the adds its brain summons (golem: 'bat': six at level 5; the combat system
 *   loads that kind's sheet and pools the adds; DRAGON_CAMPAIGN.md §6.4) — or a list of
 *   `{ kind, count = 6, level = 5 }`, 12 in all at most (COMBAT.md §30 E3)
 * @property {boolean} [introOnSpawn] a boss whose group appears through the story starts its intro at
 *   once instead of when the player enters its arena (the dragon's descent; DRAGON_CAMPAIGN.md §6.4)
 * @property {{ wall?: { color?: readonly number[], frames?: string }|null,
 *   emitter?: string|({ preset: string } & Record<string, unknown>)|null, outline?: string }} [arena]
 *   a boss: its arena's look — the gate's wall quads (HDR colour, atlas frame; null: none), the
 *   phase-2 emitter (a preset, one with overrides, null: none), the outline's marker style; absent:
 *   Cinderheart's (COMBAT.md §30 E2; types.d.ts `BossArenaLook`)
 * @property {{ title?: string, line?: string|null, drop?: 'core'|'maxHp'|'maxMp'|'attack'|null, results?: boolean }} [victory]
 *   a boss: its victory banner's words (string keys; `line: null`: no banner), its drop and whether
 *   the results card shows (`results: false`: not — a cutscene carries the defeat on); absent:
 *   Cinderwatch's (COMBAT.md §30 E7)
 * @property {boolean} [release]      its 0 HP is a release, not a death: the fight ends, the body
 *   stays under its brain (COMBAT.md §30 E7)
 */

/**
 * What `scaledDef` adds to an `EnemyDef` (§7.2).
 * @typedef {object} EnemyScaling
 * @property {EnemyKind} kind            the `ENEMY_DEFS` key
 * @property {number} level              level 1..10 (display-only for the boss)
 * @property {boolean} elite             an elite (the §7.2 multipliers are applied)
 * @property {boolean} guaranteedHeart   elites always drop a heart
 */

/**
 * `scaledDef(kind, level, elite)` (§7.2): an `EnemyDef` with level / elite scaling applied plus its
 * identity; a new deep-frozen object.
 * @typedef {Readonly<EnemyDef & EnemyScaling>} ScaledEnemyDef
 */

/**
 * kind → base stats: the base kinds, and a pack's once it registered them (`registerEnemyDefs`).
 * @type {Record<BaseEnemyKind, EnemyDef> & Partial<Record<PackEnemyKind, EnemyDef>>}
 */
export const ENEMY_DEFS = {
  slime: {
    name: 'Moss Slime', hp: 26, atk: 8, def: 0, poise: 0, mass: 0.8, speed: 2.2,
    aggro: 6, leash: 8, radius: 0.40, moveRadius: 0.30, body: [0, 0.9], xp: 6, gold: [1, 3],
    drops: { heart: 0.10, mana: 0.08, draught: 0 }, token: { type: 'melee', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 1.3,
  },
  goblin: {
    name: 'Bramble Goblin', hp: 48, atk: 11, def: 2, poise: 15, mass: 1.0, speed: 3.0, strafeSpeed: 2.5,
    aggro: 8, leash: 12, radius: 0.35, moveRadius: 0.30, body: [0, 1.7], xp: 12, gold: [3, 8],
    drops: { heart: 0.12, mana: 0.06, draught: 0.02 }, token: { type: 'melee', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.3,
  },
  archer: {
    name: 'Thorn Archer', hp: 34, atk: 10, def: 1, poise: 10, mass: 1.0, speed: 3.0,
    aggro: 11, leash: 14, radius: 0.35, moveRadius: 0.30, body: [0, 1.7], xp: 12, gold: [3, 8],
    drops: { heart: 0.10, mana: 0.10, draught: 0.02 }, token: { type: 'ranged', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.3,
  },
  shaman: {
    name: 'Hex Shaman', hp: 40, atk: 14, def: 2, poise: 10, mass: 1.0, speed: 2.6,
    aggro: 10, leash: 14, radius: 0.35, moveRadius: 0.30, body: [0, 1.7], xp: 18, gold: [5, 12],
    drops: { heart: 0.08, mana: 0.30, draught: 0.03 }, token: { type: 'ranged', cost: 1 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 2.3,
  },
  bat: {
    name: 'Cinder Bat', hp: 24, atk: 8, def: 0, poise: 0, mass: 0.6, speed: 4.5,
    aggro: 9, leash: 12, radius: 0.35, moveRadius: 0.30, body: [-0.45, 0.45], xp: 8, gold: [1, 4],
    drops: { heart: 0.06, mana: 0.08, draught: 0 }, token: { type: 'melee', cost: 1 },
    flier: true, hover: 1.3, passive: false, boss: false, labelY: 2.5,
  },
  boar: {
    name: 'Ironhide Boar', hp: 120, atk: 20, def: 6, poise: 60, mass: 3.0, speed: 2.4, chargeSpeed: 10,
    aggro: 9, leash: 12, radius: 0.60, moveRadius: 0.45, body: [0, 1.3], xp: 30, gold: [10, 20],
    drops: { heart: 0.30, mana: 0.10, draught: 0.05 }, token: { type: 'melee', cost: 2 },
    flier: false, hover: 0, passive: false, boss: false, labelY: 1.9,
  },
  dummy: {
    // tutorial target: never aggroes or attacks, refills 120 f after the last hit, no XP / loot
    name: 'Straw Dummy', hp: 9999, atk: 0, def: 0, poise: Infinity, mass: Infinity, speed: 0,
    aggro: 0, leash: 0, radius: 0.40, moveRadius: 0.35, body: [0, 1.5], xp: 0, gold: [0, 0],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: true, boss: false, labelY: 1.9,
  },
  golem: {
    // the boss (§8): aggro / leash are the arena (it never returns); poise is per phase; `phases`
    // are the HP fractions where phases 2 and 3 start; its level is display-only
    name: 'Cinderheart', epithet: 'The Last Fire of the Pass', hp: 5200, atk: 22, def: 8, poise: 250,
    mass: Infinity, speed: 1.6, phaseSpeeds: [1.6, 2.0, 2.4], phases: [0.70, 0.35],
    aggro: 0, leash: Infinity, radius: 1.20, moveRadius: 0.60, body: [0, 3.6], xp: 400, gold: [150, 150],
    drops: { heart: 0, mana: 0, draught: 0 }, token: null,
    flier: false, hover: 0, passive: false, boss: true, labelY: 4.4,
    adds: 'bat',
  },
  // Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.3)
  ...BRUTE_DEFS,
  ...SWARM_DEFS,
  ...DRAGON_DEFS,
};

/**
 * Add a lazy enemy pack's kinds to `ENEMY_DEFS` (./packs/index.js: a pack registers at load, before
 * the combat makes a sheet, a brain or an enemy; EVERMERE_CAMPAIGN.md §6.4). A kind defined twice —
 * a base kind, or one registered before — throws.
 * @param {Readonly<Partial<Record<PackEnemyKind, EnemyDef>>>} defs
 */
export function registerEnemyDefs(defs) {
  for (const [kind, def] of Object.entries(defs)) {
    if (Object.hasOwn(ENEMY_DEFS, kind)) throw new Error(`registerEnemyDefs: the enemy kind "${kind}" is defined twice`);
    ENEMY_DEFS[/** @type {PackEnemyKind} */ (kind)] = def;
  }
}

/**
 * Deep copy + freeze (numbers, strings, arrays and plain objects only).
 * @param {any} v
 * @returns {any} a frozen copy of the same shape
 */
function frozenCopy(v) {
  if (Array.isArray(v)) return Object.freeze(v.map(frozenCopy));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = frozenCopy(x);
    return Object.freeze(out);
  }
  return v;
}

/**
 * The stats of one enemy (COMBAT.md §7.2): a new frozen object. The level L (1–10) scales
 * non-boss enemies — HP ×(1 + 0.2(L−1)), ATK ×(1 + 0.12(L−1)), XP ×(1 + 0.25(L−1)), gold
 * ×(1 + 0.2(L−1)); DEF, poise and speeds unscaled. Elites: HP ×1.8, ATK ×1.25, poise ×1.5,
 * XP ×2.5, gold ×3 and a guaranteed heart (`guaranteedHeart`). Scaled values are rounded with
 * Math.round once, after every factor.
 * @param {string} kind ENEMY_DEFS key
 * @param {number} [level]
 * @param {boolean} [elite]
 * @returns {ScaledEnemyDef} ENEMY_DEFS[kind] plus { kind, level, elite, guaranteedHeart } with
 *   scaled numbers
 */
export function scaledDef(kind, level = 1, elite = false) {
  /** @type {EnemyDef|undefined} undefined: not an ENEMY_DEFS key */
  const base = ENEMY_DEFS[kind];
  if (!base) throw new Error(`scaledDef: unknown enemy kind "${kind}"`);
  const L = Math.max(1, Math.min(10, Math.round(Number(level) || 1)));
  const n = base.boss ? 0 : L - 1;
  const e = !!elite;
  /** @type {(v: number) => number} */
  const round = (v) => (Number.isFinite(v) ? Math.round(v) : v);
  const def = {
    ...base,
    kind, level: L, elite: e,
    hp: round(base.hp * (1 + 0.2 * n) * (e ? 1.8 : 1)),
    atk: round(base.atk * (1 + 0.12 * n) * (e ? 1.25 : 1)),
    poise: e ? round(base.poise * 1.5) : base.poise,
    xp: round(base.xp * (1 + 0.25 * n) * (e ? 2.5 : 1)),
    gold: base.gold.map((g) => round(g * (1 + 0.2 * n) * (e ? 3 : 1))),
    guaranteedHeart: e,
  };
  return frozenCopy(def);
}
