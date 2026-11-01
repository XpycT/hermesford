/**
 * Player rules of the ARPG combat (COMBAT.md §6) — pure data and small formulas, no state.
 * Every window is written in frames at 60 Hz (the contract's `f`) and converted to seconds with
 * `F(frames)`; code compares times with `EPS`. Balance lives here (and in `defs.js` for enemies):
 * changing a number never needs a code change elsewhere.
 */

/**
 * @import { HitShapeSpec, FxName } from './types.js'
 * @import { SfxName } from '../../engine/audio/AudioSystem.js'
 */

/**
 * A pose span of a move table: `[fromFrame, toFrame, pose]` (both frames included; the pose is a
 * column name of the player's combat sheet).
 * @typedef {[number, number, string]} PoseSpan
 */

/**
 * One step of the melee combo (`COMBO`, §6.4). Frames are 60 Hz frame indices of the action.
 * @typedef {object} ComboStep
 * @property {'A1'|'A2'|'A3'} id   the step (SP_COST key)
 * @property {number} total        frames of the whole step
 * @property {PoseSpan[]} poses    poses by frame
 * @property {[number, number]} active  frames the hitboxes exist
 * @property {number} next         first frame a buffered attack cancels into the next step
 * @property {number} dodge        first frame a buffered dodge cancels the step
 * @property {number} lunge        forward lunge (u) over `lungeFrames`
 * @property {[number, number]} lungeFrames  frames of the lunge
 * @property {HitShapeSpec[]} hits hit shapes (a union: they share the swing's tag)
 * @property {number} mv           motion value
 * @property {number} kb           knockback strength
 * @property {number} sp           SP cost
 * @property {number} poise        poise damage
 * @property {FxName} fx           the swing effect (at `fxAt`)
 * @property {boolean} flip        mirror the effect (the back-hand)
 * @property {SfxName} sfx         the swing sound (at `fxAt`)
 * @property {number} fxAt         frame of the effect and the sound
 * @property {number} hitStop      hit-stop frames of a landed hit (before crit / kill bonus)
 * @property {boolean} finisher    the combo finisher (crit +0.10, finisher shake)
 */

/**
 * A dodge move (`ROLL`, `BACKSTEP`, §6.5).
 * @typedef {object} DodgeMove
 * @property {number} total        frames of the move
 * @property {PoseSpan[]} poses    poses by frame
 * @property {[number, number]} iframes  invulnerable frames
 * @property {number} dist         distance (u) over `moveFrames`
 * @property {number} moveFrames   frames of the motion
 * @property {number} attackFrom   first frame an attack cancels it
 * @property {number} dodgeFrom    first frame another dodge cancels it
 * @property {number} skillFrom    first frame a skill cancels it
 * @property {number} [rollSlashLunge]  roll only: lunge (u) of an attack out of the roll
 * @property {[number, number]} perfect  frames an overlap counts as a perfect dodge
 */

/** Float slack for frame comparisons (COMBAT.md conventions). */
export const EPS = 1e-6;
/** @type {(frames: number) => number} frames → seconds */
export const F = (frames) => frames / 60;
/**
 * Seconds → the frame index they fall in (f0 = the first frame of an action).
 * @type {(t: number) => number}
 */
export const frameOf = (t) => Math.floor(t * 60 + EPS);

// ---------------------------------------------------------------------------------------------
// Stats and progression (§6.1)
// ---------------------------------------------------------------------------------------------

export const LEVEL_CAP = 10;
export const SP_MAX = 100;
/** Stat gains per level (for the level-up announcement). */
export const PER_LEVEL = Object.freeze({ hp: 12, mp: 5, atk: 3, def: 1 });
/** @type {(L: number, up?: number) => number} max HP at level L plus upgrades `up` */
export const hpMaxFor = (L, up = 0) => 100 + PER_LEVEL.hp * (L - 1) + up;
/** @type {(L: number, up?: number) => number} max MP at level L plus upgrades */
export const mpMaxFor = (L, up = 0) => 40 + PER_LEVEL.mp * (L - 1) + up;
/** @type {(L: number, up?: number) => number} ATK at level L plus upgrades */
export const atkFor = (L, up = 0) => 12 + PER_LEVEL.atk * (L - 1) + up;
/** @type {(L: number, up?: number) => number} DEF at level L plus upgrades */
export const defFor = (L, up = 0) => 4 + PER_LEVEL.def * (L - 1) + up;
/** @type {(L: number) => number} XP needed from level L to L + 1 */
export const xpToNext = (L) => Math.round(30 * L ** 1.6);
/** Upgrade amounts (chests, the boss's core). */
export const UPGRADES = Object.freeze({ maxHp: 20, maxMp: 10, attack: 3, core: 20 });

/**
 * A skill slot of a player kit (`SKILLS`, `SWORD_SKILLS`): the combat action it answers, the
 * English name (data: the HUD shows the string `combat.skill.<str>`, strings.js), the level it
 * opens at, its MP cost and cooldown (s), the HUD icon (icons/combat.js `SKILL_ICONS`) and keys.
 * @typedef {object} SkillSlotDef
 * @property {'skill1'|'skill2'|'skill3'} id  the combat action (bindings.js)
 * @property {string} name     English name
 * @property {string} str      its string key under `combat.skill.`
 * @property {number} unlock   level it opens at
 * @property {number} mp       MP cost
 * @property {number} cooldown seconds
 * @property {'whirl'|'bolt'|'nova'|'tempest'|'dragonfang'|'skyfall'|'peal'|'toll'|'carillon'} icon HUD icon
 * @property {string} keys     keycaps ('U/1')
 */

/** The traveler's skill slots (COMBAT.md §6.6). @type {readonly Readonly<SkillSlotDef>[]} */
export const SKILLS = Object.freeze([
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill1', name: 'Whirl Slash', str: 'skill1', unlock: 1, mp: 10, cooldown: 4.0, icon: 'whirl', keys: 'U/1' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill2', name: 'Ember Bolt', str: 'skill2', unlock: 2, mp: 8, cooldown: 1.5, icon: 'bolt', keys: 'I/2' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill3', name: 'Radiant Nova', str: 'skill3', unlock: 4, mp: 18, cooldown: 12.0, icon: 'nova', keys: 'O/3' })),
]);
/**
 * The swordmaster's skill slots (docs/contracts/DRAGON_CAMPAIGN.md §6.8; the hero of Vanquish the
 * Evil Dragon starts at level 10, where all three open). Same actions and keys as the traveler's.
 * @type {readonly Readonly<SkillSlotDef>[]}
 */
export const SWORD_SKILLS = Object.freeze([
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill1', name: 'Tempest Edge', str: 'tempest', unlock: 10, mp: 16, cooldown: 6.0, icon: 'tempest', keys: 'U/1' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill2', name: 'Dragonfang Wave', str: 'dragonfang', unlock: 10, mp: 12, cooldown: 3.5, icon: 'dragonfang', keys: 'I/2' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill3', name: 'Skyfall Judgement', str: 'skyfall', unlock: 10, mp: 30, cooldown: 15.0, icon: 'skyfall', keys: 'O/3' })),
]);
/**
 * The bellwarden's skill slots (docs/contracts/EVERMERE_CAMPAIGN.md §5.5: Linnet Halloway from
 * level 3 — Peal at 3, Toll at 5, Carillon at 8). Same actions and keys as the traveler's; the moves
 * are the bellwarden's kit module's (src/game/combat/kits/bellwarden.js, `PEAL`, `TOLL`, `CARILLON`
 * below).
 * @type {readonly Readonly<SkillSlotDef>[]}
 */
export const BELL_SKILLS = Object.freeze([
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill1', name: 'Peal', str: 'peal', unlock: 3, mp: 8, cooldown: 3.0, icon: 'peal', keys: 'U/1' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill2', name: 'Toll', str: 'toll', unlock: 5, mp: 16, cooldown: 9.0, icon: 'toll', keys: 'I/2' })),
  Object.freeze(/** @satisfies {SkillSlotDef} */ ({ id: 'skill3', name: 'Carillon', str: 'carillon', unlock: 8, mp: 30, cooldown: 18.0, icon: 'carillon', keys: 'O/3' })),
]);

// ---------------------------------------------------------------------------------------------
// Resources (§6.2)
// ---------------------------------------------------------------------------------------------

export const SP_REGEN = 45;
export const SP_DELAY = 0.5;
export const SP_DELAY_EMPTY = 1.2;
export const SP_DODGE_MIN = 12;
export const SP_COST = Object.freeze({ A1: 5, A2: 5, A3: 8, roll: 25, backstep: 15 });
/** Winded (SP hit 0) until SP ≥ this; attack recovery frames last × WINDED_RECOVERY. */
export const WINDED_UNTIL = 30;
export const WINDED_RECOVERY = 1.35;
export const MP_REGEN = 0.8;
export const MP_PER_HIT = 2;
export const MP_PER_SWING_MAX = 4;
export const MANA_MOTE = 8;
export const HEART_HEAL = 0.12;
export const DRAUGHT_HEAL = 0.40;
export const POTION_MAX = 5;
export const POTION_START = 3;
export const DRAUGHT_PRICE = 25;
/**
 * The combat shop (the gold sink): the wares of a `shopkeeper` NPC on a combat level, in menu order.
 * `once`: sold at most once per session (kept through death and rest, like an opened chest; the
 * reset hook clears it); `upgrade` / `amount`: the player upgrade it applies (PlayerCombat#upgrade);
 * `gain`: the menu's short text. The Healing Draught is also what a plain `action: 'shop'` NPC sells
 * (§6.12). Priced so a player who clears both branches can afford most of it by the quarry lip.
 */
export const SHOP_WARES = Object.freeze([
  Object.freeze({ id: 'draught', name: 'Healing Draught', price: DRAUGHT_PRICE, once: false, upgrade: null, amount: 0, gain: 'heals 40 %' }),
  Object.freeze({ id: 'whetstone', name: 'Whetstone', price: 120, once: true, upgrade: 'attack', amount: 2, gain: 'ATK +2' }),
  Object.freeze({ id: 'tonic', name: 'Ironbark Tonic', price: 90, once: true, upgrade: 'maxHp', amount: 15, gain: 'Max HP +15' }),
  // (DEF +3: at +2 it took ≈ 6.7 % off the damage at Lv 5 for 150 gold, the weakest buy; +3 ≈ 9.7 %)
  Object.freeze({ id: 'charm', name: 'Warding Charm', price: 150, once: true, upgrade: 'def', amount: 3, gain: 'DEF +3' }),
]);
/**
 * The shop ware called `name` (null: not for sale).
 * @type {(name: string) => (typeof SHOP_WARES)[number]|null}
 */
export const shopWare = (name) => SHOP_WARES.find((w) => w.name === name) ?? null;
/** Perfect dodge (§6.5): rewards, cooldown, enemy slow motion. */
export const PERFECT = Object.freeze({ sp: 15, mp: 5, cooldown: 3.0, enemyScale: 0.35, time: 0.6 });

// ---------------------------------------------------------------------------------------------
// Bodies, radii, heights
// ---------------------------------------------------------------------------------------------

export const PLAYER_RADIUS = 0.3;
/** Player body band (u above the feet): projectile height test, aim point (0.9). */
export const PLAYER_BODY = Object.freeze([0, 1.8]);
/** The player's mass in the separation split (COMBAT.md §7.6). */
export const PLAYER_SEP_MASS = 4;
/** Melee height rule: attacker and target grounds within this (one step plus slack). */
export const MELEE_DY = 0.6;
/** Release / aim height above the ground of every straight shot (the height model, §7.6). */
export const SHOT_Y = 0.9;
/** Knockback cap (u) after the victim's mass. */
export const KB_CAP = 3;

// ---------------------------------------------------------------------------------------------
// Damage (§6.3)
// ---------------------------------------------------------------------------------------------

export const CRIT = Object.freeze({ base: 0.08, rear: 0.12, exposed: 0.30, finisher: 0.10, mult: 1.75 });
/** @type {(def: number) => number} the damage factor of a victim's DEF */
export const mitigation = (def) => 40 / (40 + 2 * def);

// ---------------------------------------------------------------------------------------------
// Melee combo (§6.4)
// ---------------------------------------------------------------------------------------------

/**
 * One combo step. poses: [fromFrame, toFrame, pose]; active: [from, to] frames the hitboxes exist;
 * next / dodge: the first frame a buffered attack / dodge cancels into; lunge u over lungeFrames;
 * hits: HitSpec shapes (a union shares the swing's tag); fx / sfx at `fxAt`.
 * @type {readonly Readonly<ComboStep>[]}
 */
export const COMBO = Object.freeze([
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A1', total: 22, poses: [[0, 4, 'wind'], [5, 9, 'slash'], [10, 21, 'follow']],
    active: [5, 7], next: 14, dodge: 8, lunge: 0.4, lungeFrames: [3, 7],
    hits: [{ shape: 'sector', r: 1.6, halfAngle: 60 }], mv: 1.0, kb: 0.5, sp: SP_COST.A1, poise: 10,
    fx: 'slash', flip: false, sfx: 'swing', fxAt: 5, hitStop: 4, finisher: false,
  })),
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A2', total: 24, poses: [[0, 4, 'follow'], [5, 9, 'backhand'], [10, 23, 'wind']],
    active: [5, 7], next: 15, dodge: 8, lunge: 0.4, lungeFrames: [3, 7],
    hits: [{ shape: 'sector', r: 1.6, halfAngle: 60 }], mv: 1.1, kb: 0.6, sp: SP_COST.A2, poise: 12,
    fx: 'slash', flip: true, sfx: 'swing', fxAt: 5, hitStop: 4, finisher: false,
  })),
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A3', total: 39, poses: [[0, 9, 'wind'], [10, 16, 'thrust'], [17, 38, 'follow']],
    active: [10, 14], next: 32, dodge: 15, lunge: 0.8, lungeFrames: [8, 12],
    hits: [{ shape: 'lane', len: 2.2, width: 1.0 }, { shape: 'sector', r: 2.0, halfAngle: 35 }],
    mv: 1.8, kb: 2.0, sp: SP_COST.A3, poise: 30,
    fx: 'thrust', flip: false, sfx: 'swingHeavy', fxAt: 10, hitStop: 7, finisher: true,
  })),
]);
/** Magnet (§6.4): soft target chosen at f0–2; snaps within this distance, max turn. */
export const MAGNET = Object.freeze({ range: 3.0, maxTurnDeg: 60, reach: 0.6, extra: 0.5 });
/** Frames during which move input may still correct an attack's facing. */
export const FACING_FIX_FRAMES = 2;

// ---------------------------------------------------------------------------------------------
// Dodge (§6.5)
// ---------------------------------------------------------------------------------------------

export const ROLL = Object.freeze(/** @satisfies {DodgeMove} */ ({
  total: 22, poses: [[0, 2, 'tuck'], [3, 12, 'roll'], [13, 17, 'tuck'], [18, 21, 'wind']],
  iframes: [1, 13], dist: 3.2, moveFrames: 15, attackFrom: 16, dodgeFrom: 18, skillFrom: 18,
  rollSlashLunge: 0.3, perfect: [1, 8],
}));
export const BACKSTEP = Object.freeze(/** @satisfies {DodgeMove} */ ({
  total: 16, poses: [[0, 15, 'tuck']], iframes: [1, 8], dist: 1.8, moveFrames: 10,
  attackFrom: 10, dodgeFrom: 12, skillFrom: 12, perfect: [1, 8],
}));

// ---------------------------------------------------------------------------------------------
// Skills (§6.6) and the draught (§6.7)
// ---------------------------------------------------------------------------------------------

export const WHIRL = Object.freeze({
  total: 32, pose: 'spin', hits: [[6, 8], [14, 16]], r: 2.2, mv: 1.2, kb: 1.4, poise: 15,
  armor: 24, dodgeFrom: 24, hitStop: 3,
});
export const BOLT = Object.freeze({
  total: 20, pose: 'cast', release: 8, speed: 14, range: 12, radius: 0.35, mv: 2.0, kb: 0.8, poise: 20,
  splash: Object.freeze({ r: 1.0, mv: 0.6 }), cone: 45, dodgeFrom: 12, attackFrom: 14, hitStop: 3,
});
export const NOVA = Object.freeze({
  total: 40, poses: /** @satisfies {PoseSpan[]} */ ([[0, 19, 'cast'], [20, 27, 'spin'], [28, 39, 'follow']]), grow: 20, at: 20,
  r: 3.2, mv: 2.6, kb: 2.2, poise: 60, iframes: [4, 20], dodgeFrom: 30, hitStop: 5,
});
export const DRAUGHT = Object.freeze({ total: 30, pose: 'aim', at: 18, cooldown: 1.0 });

// ---------------------------------------------------------------------------------------------
// The swordmaster (docs/contracts/DRAGON_CAMPAIGN.md §6.8): the kit of a campaign's `player.kit:
// 'swordmaster'`. The combo (COMBO, above) and every other rule are the traveler's — its swings
// leave wind-blade trails (FX only); these are its three skills, tuned for a level-10 hero (ATK 39:
// a level-10 Drakeborn Ravager, ≈ 700 HP and DEF 7 (defs/brutes.js, scaled), takes ≈ 30 per mv).
// ---------------------------------------------------------------------------------------------

/**
 * Tempest Edge (skill1): a storm of spectral blades round the player — three hits on every foe
 * within `r`, the body spinning (the facing turns a quarter every `spinStep` frames from `spinFrom`
 * to `spinTo`), a slow drift with move input (`drift` u/s), super armour to `armor`. `hits[i]` the
 * frames of hit i (its own tag), with `mv[i]`, `kb[i]` (radial), `poise[i]`; the blades orbit from
 * `bladesAt`, open to `bladeR` by `bladeOpen` and fly outward from `release`.
 */
export const TEMPEST = Object.freeze({
  total: 50, poses: /** @satisfies {PoseSpan[]} */ ([[0, 5, 'wind'], [6, 41, 'spin'], [42, 49, 'follow']]),
  spinFrom: 6, spinTo: 41, spinStep: 3, drift: 1.6,
  hits: /** @type {[number, number][]} */ ([[12, 14], [24, 26], [36, 39]]),
  r: 3.6, mv: [1.2, 1.2, 1.7], kb: [0.8, 0.8, 2.4], poise: [16, 16, 32],
  armor: 40, dodgeFrom: 40, hitStop: 3, finalStop: 5,
  blades: 4, bladesAt: 4, bladeOpen: 14, bladeR: 3.0, release: 40, spin: 15,
});
/**
 * Dragonfang Wave (skill2): a crescent wave released at `release` that runs `range` u along the
 * facing at `speed` u/s, `width` u wide, piercing — every foe it passes is hit once (mv, kb pushed
 * along the lane, poise). It auto-aims like Ember Bolt (a soft target within ±45° and 12 u), lunges
 * `lunge` u over `lungeFrames`, and stops where the ground rises more than `wall` u (a cliff, a
 * wall) or drops more than `drop` u.
 */
export const DRAGONFANG = Object.freeze({
  total: 30, poses: /** @satisfies {PoseSpan[]} */ ([[0, 9, 'wind'], [10, 15, 'slash'], [16, 29, 'follow']]),
  release: 10, lunge: 0.5, lungeFrames: /** @type {[number, number]} */ ([5, 10]),
  speed: 24, range: 10, width: 3.0, mv: 3.2, kb: 2.2, poise: 45, wall: 0.9, drop: 2.6,
  dodgeFrom: 16, attackFrom: 20, hitStop: 5,
});
/**
 * Skyfall Judgement (skill3): a leap — crouch to `rise`, airborne until `land` on an arc `height` u
 * high, carried toward a soft target within `reach` u of the aim (landing `gap` u short of it; else
 * `forward` u ahead) — then a giant spectral sword (falling from `swordAt`) driven into the ground at
 * `land`: one hit on every foe within `r` (knockdown, not bosses), shake, rings, a light pillar.
 * I-frames `iframes`; dodge from `dodgeFrom`.
 */
export const SKYFALL = Object.freeze({
  total: 66, poses: /** @satisfies {PoseSpan[]} */ ([[0, 7, 'tuck'], [8, 19, 'cast'], [20, 27, 'slash'], [28, 35, 'thrust'], [36, 57, 'follow'], [58, 65, 'wind']]),
  rise: 8, land: 28, height: 2.4, reach: 7, gap: 0.8, forward: 2.5, leapMax: 5.5, swordAt: 12, swordY: 10,
  r: 5.5, mv: 5.0, kb: 3.0, poise: 120, iframes: /** @type {[number, number]} */ ([3, 34]), dodgeFrom: 46, hitStop: 8,
  shake: /** @type {[number, number]} */ ([0.42, 0.6]),
});

// ---------------------------------------------------------------------------------------------
// The bellwarden (docs/contracts/EVERMERE_CAMPAIGN.md §5.5): the kit of a campaign's `player.kit:
// 'bellwarden'` — Linnet Halloway and her grandfather's bell-founder's hammer. Heavy and
// poise-breaking: every hammer blow leaves a resonance mark on the foe (core's `HitStatus.mark`),
// Peal and Carillon detonate them, Toll plants a spectral bell she can strike again. Her slots
// (`BELL_SKILLS`, above) and her MP regeneration are here; her hammer combo, her skills' tables and
// the marks' rules are her kit module's (src/game/combat/kits/bellwarden.js `BELL_RULES`: a lazy
// chunk, downloaded only where she fights; PlayerCombat swings its combo, `comboSteps`).
// ---------------------------------------------------------------------------------------------

/**
 * A player kit: its skill slots and MP regeneration (s⁻¹). `traveler` — the default, COMBAT.md §6 —,
 * `swordmaster` or `bellwarden` (a campaign's `player.kit`, CampaignFormat.js `PLAYER_KITS`; the
 * bellwarden's combo is her kit module's).
 * @typedef {{ id: 'traveler'|'swordmaster'|'bellwarden', skills: readonly Readonly<SkillSlotDef>[], mpRegen: number }} PlayerKit
 */
/** @type {Readonly<Record<'traveler'|'swordmaster'|'bellwarden', Readonly<PlayerKit>>>} */
export const PLAYER_KIT_RULES = Object.freeze({
  traveler: Object.freeze({ id: 'traveler', skills: SKILLS, mpRegen: MP_REGEN }),
  // (a hero who lives on skills: MP 85 at level 10, 1.5/s besides the melee gains)
  swordmaster: Object.freeze({ id: 'swordmaster', skills: SWORD_SKILLS, mpRegen: 1.5 }),
  // (EVERMERE_CAMPAIGN.md §5.5: MP 50 at level 3, 85 at 10; the hammer's blows feed it as the sword's)
  bellwarden: Object.freeze({ id: 'bellwarden', skills: BELL_SKILLS, mpRegen: 1.0 }),
});

// ---------------------------------------------------------------------------------------------
// Getting hit (§6.8), level-up (§6.10), death (§6.11)
// ---------------------------------------------------------------------------------------------

export const HITSTUN = Object.freeze({ total: 18, pose: 'hurt', slide: 10, iframes: 48 });
export const KNOCKDOWN = Object.freeze({ down: 36, getUp: 18, slide: 14, iframesAfter: 30, techFrom: 24, kb: 2.5 });
export const LEVELUP_INVULN = F(60);
export const RESPAWN_IFRAMES = 2.0;
export const RESPAWN_GUARD = 0.25;
export const DEATH_SCREEN_DELAY = 1.2;
export const GOLD_LOSS = 0.1;

// ---------------------------------------------------------------------------------------------
// Input, targeting, engagement (§5.1, §6.9, §6.12)
// ---------------------------------------------------------------------------------------------

/** Input buffer (frames): a press fires as soon as a cancel window for it opens. */
export const BUFFER = F(10);
/** Holding `lock` this long releases it. */
export const LOCK_HOLD = 0.35;
export const SOFT_TARGET = Object.freeze({ range: 5, halfAngle: 75, boltRange: 12, boltHalfAngle: 45 });
export const LOCK = Object.freeze({ range: 14, retarget: 8, breakAt: 16, focusShare: 0.3, focusClamp: 4, lambda: 6 });
export const BOSS_FRAME = Object.freeze({ share: 0.45, clamp: 6, lambda: 4, minDistance: 30 });
export const ENGAGE = Object.freeze({ range: 16, linger: 3.0 });
export const WAYSTONE = Object.freeze({ attune: 2.0, stand: 1.2, restDraughts: 3 });
export const CHEST_DISCOVER = Object.freeze({ near: 8, los: 12 });
