/**
 * The party's game numbers (docs/specs/PARTY.md §5): what the rule values of
 * src/engine/level/PartyRules.js mean in units, seconds and fractions, each member class's
 * stats and moves, and how a member fights. Read by the follow (Party / PartyMember) and the
 * companion's combat (MemberCombat, CombatSystem). Import-free (the Node tests read it).
 *
 * Frames are 60 Hz frame indices of an action (as in combat/rules.js: f0 is the first frame).
 */

/**
 * `distance`: how far from the player a member ranges in a fight (`leash`, u: it does not chase a
 * foe past it) and the distance a ranged or caster member keeps from its target (`standoff`, u).
 */
export const DISTANCE = Object.freeze({
  close: Object.freeze({ leash: 4, standoff: 2.4 }),
  mid: Object.freeze({ leash: 8, standoff: 4.5 }),
  far: Object.freeze({ leash: 13, standoff: 7 }),
});

/** `heal`: heal someone whose HP fraction is below this (0: never). */
export const HEAL_AT = Object.freeze({ never: 0, low: 0.3, half: 0.5, often: 0.75 });

/** `retreat`: fall back to the player while the member's own HP fraction is below this (0: never). */
export const RETREAT_AT = Object.freeze({ never: 0, low: 0.25, half: 0.5 });

/**
 * A member class's stats at party level 1 and per level (the player's level is the party's): HP,
 * MP, ATK, DEF; walk / run speed (u/s). The heroes of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.4, PARTY.md §12) fight at level 10 from the start: the cleric
 * 127 HP / 135 MP / ATK 19.5 / DEF 8 there, the ice mage 112 / 142 / 24.1 / 6.5 (the hardest hitter,
 * the frailest), the greatshield 216 / 59 / 18.6 / 16.8 (the player at level 10: 208 HP, ATK 39,
 * DEF 13).
 */
export const CLASS_STATS = Object.freeze({
  warden: Object.freeze({ hp: 82, mp: 30, atk: 6, def: 3.5, perLevel: Object.freeze({ hp: 8, mp: 3, atk: 1.4, def: 0.7 }), walk: 3.2, run: 5.8 }),
  ranger: Object.freeze({ hp: 62, mp: 30, atk: 7, def: 2, perLevel: Object.freeze({ hp: 6.5, mp: 3, atk: 1.7, def: 0.5 }), walk: 3.2, run: 5.8 }),
  mystic: Object.freeze({ hp: 58, mp: 60, atk: 6.5, def: 2, perLevel: Object.freeze({ hp: 6, mp: 6, atk: 1.6, def: 0.5 }), walk: 3.2, run: 5.8 }),
  cleric: Object.freeze({ hp: 64, mp: 72, atk: 6, def: 2.6, perLevel: Object.freeze({ hp: 7, mp: 7, atk: 1.5, def: 0.6 }), walk: 3.2, run: 5.8 }),
  icemage: Object.freeze({ hp: 56, mp: 74, atk: 7, def: 2, perLevel: Object.freeze({ hp: 6.2, mp: 7.5, atk: 1.9, def: 0.5 }), walk: 3.2, run: 5.8 }),
  greatshield: Object.freeze({ hp: 108, mp: 32, atk: 6, def: 6, perLevel: Object.freeze({ hp: 12, mp: 3, atk: 1.4, def: 1.2 }), walk: 3.0, run: 5.6 }),
});

/**
 * The classes of Vanquish the Evil Dragon's heroes (PARTY.md §12): two skills each and their own
 * moves in MemberCombat; the cleric also raises the fallen.
 * @type {readonly string[]}
 */
export const VQ_CLASSES = Object.freeze(['cleric', 'icemage', 'greatshield']);

/**
 * How a member fights, whatever its class (MemberCombat; the enemies' side in CombatSystem).
 * Times in seconds unless the name says frames.
 */
export const ALLY = Object.freeze({
  /**
   * A member's ATK × this by the number of members in the fight (1, 2, 3): a full party shares the
   * work instead of tripling it (with three at full ATK the player landed one kill in ten).
   */
  partyAtk: Object.freeze([1, 0.85, 0.72]),
  /**
   * `heal: often` (Support): the member keeps its hands free for Mend — the pause after its basic
   * attack (the warden's combo, a shot, a bolt) and its skill's cooldown × this.
   */
  healerPace: 2,
  /** Hurt radius and move radius (u), as the player's. */
  radius: 0.3,
  /** Body band above the feet (u): projectile height test, aim point. */
  body: Object.freeze([0, 1.8]),
  /** Separation against enemies (the player's is 4); an ally yields to the player entirely. */
  mass: 3,
  /** The AI re-plans its target and its spot this often (s; each member at its own phase). */
  planEvery: 0.25,
  /** Out of a fight this long (s): fast regeneration, and a downed member gets up. */
  calm: 2,
  /** HP and MP fraction regained per second out of a fight. */
  regen: 0.1,
  /** HP fraction a downed member gets up with. */
  getUp: 0.3,
  /** Frames of the get-up (pose `tuck`). */
  getUpFrames: 24,
  /** MP regained per second in a fight. */
  mpRegen: 0.8,
  /** The spot beside the player a member holds when it has nothing to do (u from the player). */
  hold: 1.8,
  /**
   * Holding that spot: it is planned anew only when the player moved `holdReplan` u from where it
   * was planned or the nearest foe came round to its side of the player; a member standing there
   * sets off only once it is more than `holdSlack` u away (a push, the player's step) and walks
   * until it is within `holdStop` u.
   */
  holdReplan: 1.0,
  holdSlack: 1.0,
  holdStop: 0.35,
  /** A ranged / caster member farther than its leash + this from the player walks back before it shoots (u). */
  leashSlack: 0.75,
  /** A melee member at its spot but out of its target's reach in height this long gives the foe up (s). */
  noReach: 1.0,
  /** A melee member in front of the player on screen steps to a free spot before its next thrusts, at most this often (s). */
  relocEvery: 0.8,
  /** Shots lead a moving target by at most this (u; its velocity smoothed over `leadTau` s while aiming). */
  leadMax: 3,
  leadTau: 0.1,
  /** A member that falls back stands this far behind the player, away from the foes (u). */
  retreat: 2.6,
  /** Run (not walk) to a goal farther than this (u). */
  runFrom: 2.4,
  /** Dodge roll: frames, i-frames, distance (u) over `moveFrames`, cooldown (s); poses as the player's. */
  roll: Object.freeze({
    total: 20, iframes: Object.freeze([1, 13]), dist: 3.0, moveFrames: 15, cooldown: 1.1,
    poses: Object.freeze([Object.freeze([0, 2, 'tuck']), Object.freeze([3, 12, 'roll']), Object.freeze([13, 19, 'tuck'])]),
  }),
  /** Evade: roll out of an enemy marker whose fill is in [minFill, 1) (magma: always). */
  evadeFill: 0.3,
  /** Hit stun: frames, slide frames; i-frames after it (s). */
  hurt: Object.freeze({ total: 14, slide: 10, iframes: 0.5 }),
  /** Knockdown (a hit with `knockdown` or kb ≥ `kb`): frames down / getting up, slide frames, i-frames after (s). */
  knockdown: Object.freeze({ down: 36, getUp: 18, slide: 14, iframes: 0.6, kb: 2.5 }),
  /** Knockback cap (u). */
  kbCap: 3,
  /**
   * `attack: assist`: a foe the player hit this recently (s) counts as fighting the party — as do
   * the lock-on, a foe after a member and an aggroed foe within `assistNear` u of the player.
   */
  assistMemory: 4,
  assistNear: 3,
  /** Path searches on the walk grid: at most one per member this often (s), paths up to `pathMax` u. */
  pathEvery: 0.3,
  pathMax: 36,
  /** Moving < 25 % of the step this long (s): search a path; this long: give the target up for `skipFor` s. */
  stuckPath: 0.5,
  stuckGiveUp: 2,
  skipFor: 3,
  /**
   * Enemies against allies (PARTY.md §5.3): a foe a member hits turns on it when the member is
   * nearer to it than `threat` × the player's distance; an archer or a shaman (a ranged foe) also
   * when the member's shot came from within `rangedAggro` u (its own reach) …
   */
  threat: 1.25,
  rangedAggro: 10,
  /** … holds a switched target ≥ this (s) … */
  holdTarget: 2.5,
  /** … look again this often (s) … */
  checkTarget: 0.5,
  /** … and go back to the player when the player is nearer than this × the ally's distance. */
  playerNearer: 0.6,
  /** Boss arena: members within this of the player (u) are placed inside when it closes. */
  arenaPull: 12,
});

/**
 * Pose spans `[from, to, pose]` of an action (frozen; typed as tuples for the kits' typedefs).
 * @param {...[number, number, string]} rows
 * @returns {readonly (readonly [number, number, string])[]}
 */
const spans = (...rows) => Object.freeze(rows.map((r) => Object.freeze(r)));
/** A frame window `[a, b]` (frozen). @param {number} a @param {number} b @returns {readonly [number, number]} */
const pair = (a, b) => Object.freeze(/** @type {[number, number]} */ ([a, b]));

/**
 * A melee hit of a melee member's combo (the warden's thrusts, the greatshield's shield bash and
 * mace): frames, poses, the active window, a sector at the feet along the facing, motion value,
 * knockback, poise damage, a lunge (u over `lungeFrames`), the effect and the sound; `stun` (s, the
 * greatshield's bash: a foe that is no boss is stunned — HitSpec `stun`, the combat core's).
 * @typedef {{ total: number, poses: readonly (readonly [number, number, string])[], active: readonly [number, number],
 *   r: number, halfAngle: number, mv: number, kb: number, poise: number, lunge: number,
 *   lungeFrames: readonly [number, number], fxAt: number, fx: 'thrust'|'slash'|'slashBig',
 *   sfx: 'swing'|'swingHeavy'|'shieldBash', stun?: number }} AllyMeleeHit
 */

/**
 * The moves of each class (PARTY.md §5.2, §12). `reach` (melee): the distance between centres, beyond
 * the target's radius, from which the basic attack starts. `basic` (ranged / caster): a shot —
 * frames, poses, release frame, projectile speed / range / radius, motion value, knockback, poise,
 * cooldown (s); the mystic's bolt splashes. `skill`: MP, cooldown (s), frames, its numbers;
 * `minFoes`: foes it wants around its target (or its own feet) unless the target is an elite or
 * the boss. `mend`: MP, cooldown (s), frames, the frame it heals at, HP healed (`frac` of the
 * target's max HP + `flat`), range (u) — null: the class does not heal (the ice mage, the
 * greatshield). The heroes of Vanquish the Evil Dragon (`VQ_CLASSES`) add a second skill
 * (`skill2`) and the cleric a `revive`; their shapes are the typedefs below.
 */
export const KIT = Object.freeze({
  warden: Object.freeze({
    reach: 1.35,
    /** The two thrusts of the combo (the second follows at once while the foe is in reach). */
    combo: Object.freeze([
      Object.freeze({
        total: 20, poses: Object.freeze([Object.freeze([0, 6, 'wind']), Object.freeze([7, 11, 'thrust']), Object.freeze([12, 19, 'follow'])]),
        active: Object.freeze([7, 9]), r: 1.7, halfAngle: 35, mv: 1.0, kb: 0.5, poise: 10, lunge: 0.3,
        lungeFrames: Object.freeze([4, 8]), fxAt: 7, fx: 'thrust', sfx: 'swing',
      }),
      Object.freeze({
        total: 26, poses: Object.freeze([Object.freeze([0, 8, 'wind']), Object.freeze([9, 13, 'thrust']), Object.freeze([14, 25, 'follow'])]),
        active: Object.freeze([9, 11]), r: 1.8, halfAngle: 35, mv: 1.3, kb: 1.2, poise: 16, lunge: 0.45,
        lungeFrames: Object.freeze([6, 10]), fxAt: 9, fx: 'thrust', sfx: 'swingHeavy',
      }),
    ]),
    /** Pause after the combo (s). */
    comboGap: 0.75,
    /** Sweep: a spin around it with knockback; super armour through `armor` frames. */
    skill: Object.freeze({
      id: 'sweep', name: 'Sweep', mp: 10, cooldown: 7, total: 32, pose: 'spin', active: Object.freeze([10, 13]),
      r: 2.2, mv: 1.3, kb: 2.2, poise: 30, armor: 16, minFoes: 2,
    }),
    mend: Object.freeze({ mp: 10, cooldown: 6, total: 34, at: 20, frac: 0.25, flat: 6, range: 8 }),
  }),
  ranger: Object.freeze({
    basic: Object.freeze({
      total: 26, poses: Object.freeze([Object.freeze([0, 15, 'aim']), Object.freeze([16, 25, 'follow'])]), release: 14,
      speed: 16, range: 12, radius: 0.25, mv: 1.0, kb: 0.4, poise: 6, cooldown: 0.5,
    }),
    /** Volley: three arrows fanned ±`spread`°. */
    skill: Object.freeze({
      id: 'volley', name: 'Volley', mp: 9, cooldown: 7, total: 32, release: 18, n: 3, spread: 12,
      speed: 16, range: 12, radius: 0.25, mv: 0.9, kb: 0.6, poise: 8, minFoes: 2,
      poses: Object.freeze([Object.freeze([0, 19, 'aim']), Object.freeze([20, 31, 'follow'])]),
    }),
    mend: Object.freeze({ mp: 10, cooldown: 6, total: 34, at: 20, frac: 0.25, flat: 6, range: 8 }),
  }),
  mystic: Object.freeze({
    basic: Object.freeze({
      total: 26, poses: Object.freeze([Object.freeze([0, 17, 'cast']), Object.freeze([18, 25, 'follow'])]), release: 14,
      speed: 12, range: 11, radius: 0.3, mv: 1.15, kb: 0.6, poise: 10, cooldown: 0.75,
      splash: Object.freeze({ r: 0.8, mv: 0.45 }),
    }),
    /** Flare: a burst on its target's spot `delay` s after the cast (no ground marker). */
    skill: Object.freeze({
      id: 'flare', name: 'Flare', mp: 12, cooldown: 8, total: 30, at: 16, pose: 'cast', delay: 0.7,
      r: 1.9, mv: 2.2, kb: 1.5, poise: 35, range: 10, minFoes: 2,
    }),
    mend: Object.freeze({ mp: 12, cooldown: 4.5, total: 30, at: 18, frac: 0.35, flat: 10, range: 9 }),
  }),
  cleric: /** @type {VqCasterKit} */ (Object.freeze({
    /**
     * Her MP economy (a long fight, rv-play #5): `mpRegen` MP/s in a fight (the others' is
     * `ALLY.mpRegen`); Mend and Sanctuary keep the raise's MP (`revive.mp`) — unless the player is
     * below `critical` of its HP —; Judgement keeps `revive.mp + mend.mp` or `skill.keep` of her max
     * MP, the more.
     */
    mpRegen: 2.5,
    critical: 0.25,
    /** Holy Bolt: an orb of light that seeks its foe and bursts. */
    basic: Object.freeze({
      id: 'holyBolt', total: 26, poses: spans([0, 15, 'cast'], [16, 25, 'follow']), release: 14,
      speed: 11, range: 11, radius: 0.3, mv: 1.15, kb: 0.5, poise: 10, cooldown: 0.7, turn: 5,
      splash: Object.freeze({ r: 1.0, mv: 0.45 }), chill: 0, slow: 0,
    }),
    /** Judgement: a glyph on the foe's spot, a ring of light pillars, then the great pillar. */
    skill: Object.freeze({
      id: 'judgement', name: 'Judgement', mp: 18, cooldown: 12, total: 40, at: 18, keep: 0.35,
      poses: spans([0, 24, 'cast'], [25, 39, 'follow']),
      range: 10, minFoes: 2, r: 3.5, delay: 0.45, ring: 2.3, pillars: 6, every: 0.06,
      pillarR: 1.3, pillarMv: 0.95, pillarKb: 0.5, pillarPoise: 12,
      final: Object.freeze({ delay: 0.16, r: 3.5, mv: 1.5, kb: 1.6, poise: 30, stop: 4 }),
    }),
    /**
     * Sanctuary: a great healing circle where the hurt stand (heals `frac` of max HP + `flat` over its
     * `ticks`) and a ward on the party; cast when `minHurt` of the party are below the heal threshold
     * + `lift`, or one is and `crowd` foes press the party.
     */
    skill2: Object.freeze({
      id: 'sanctuary', name: 'Sanctuary', mp: 26, cooldown: 24, total: 48, at: 26,
      poses: spans([0, 30, 'cast'], [31, 47, 'follow']),
      range: 9, r: 4, duration: 4, ticks: 8, frac: 0.4, flat: 16, ward: 0.3, wardFor: 6, minHurt: 2, lift: 0.2, crowd: 4,
    }),
    /** A strong Mend. */
    mend: Object.freeze({ mp: 14, cooldown: 4, total: 30, at: 18, frac: 0.45, flat: 16, range: 10 }),
    /** Raise a downed member: kneel by it, then lift it with light. */
    revive: Object.freeze({
      id: 'revive', mp: 24, cooldown: 10, total: 66, at: 50,
      poses: spans([0, 34, 'tuck'], [35, 56, 'cast'], [57, 65, 'follow']),
      frac: 0.4, range: 1.6, reach: 9, safe: 2.5, iframes: 1.5, brave: 6,
    }),
  })),
  icemage: /** @type {VqCasterKit} */ (Object.freeze({
    /** Frost Lance: a fast spear of ice, aimed with a lead; it chills. */
    basic: Object.freeze({
      id: 'frostLance', total: 24, poses: spans([0, 13, 'cast'], [14, 23, 'follow']), release: 12,
      speed: 17, range: 12, radius: 0.26, mv: 1.25, kb: 0.4, poise: 8, cooldown: 0.65, turn: 0,
      splash: null, chill: 2.5, slow: 0.3, refresh: 0.5,
    }),
    /** Blizzard: a storm field on the foes' spot — ticks of damage and a deep chill. */
    skill: Object.freeze({
      id: 'blizzard', name: 'Blizzard', mp: 20, cooldown: 12, total: 40, at: 20,
      poses: spans([0, 26, 'cast'], [27, 39, 'follow']),
      range: 11, minFoes: 3, r: 4, duration: 4, every: 0.8, mv: 0.55, kb: 0.15, poise: 6, chill: 1.2, slow: 0.5,
    }),
    /** Glacial Tomb: a frost glyph, then a ring of ice spikes erupts — damage and a freeze. */
    skill2: Object.freeze({
      id: 'glacialTomb', name: 'Glacial Tomb', mp: 24, cooldown: 16, total: 44, at: 22,
      poses: spans([0, 14, 'cast'], [15, 30, 'thrust'], [31, 43, 'follow']),
      range: 10, minFoes: 3, r: 3.5, delay: 0.5, spikes: 14, mv: 2.4, kb: 0.3, poise: 40, freeze: 2.5,
      stop: 4, hold: 0.9,
    }),
    mend: null,
    revive: null,
  })),
  greatshield: /** @type {VqMeleeKit} */ (Object.freeze({
    reach: 1.4,
    /** Shield bash (a short stun), then the flanged mace. */
    combo: Object.freeze([
      Object.freeze({
        total: 22, poses: spans([0, 6, 'wind'], [7, 11, 'thrust'], [12, 21, 'follow']),
        active: pair(7, 9), r: 1.6, halfAngle: 50, mv: 0.9, kb: 1.4, poise: 24, lunge: 0.4,
        lungeFrames: pair(4, 8), fxAt: 7, fx: 'thrust', sfx: 'shieldBash', stun: 0.5,
      }),
      Object.freeze({
        total: 28, poses: spans([0, 8, 'backhand'], [9, 13, 'slash'], [14, 27, 'follow']),
        active: pair(9, 11), r: 1.8, halfAngle: 65, mv: 1.5, kb: 1.1, poise: 26, lunge: 0.25,
        lungeFrames: pair(6, 10), fxAt: 9, fx: 'slashBig', sfx: 'swingHeavy',
      }),
    ]),
    comboGap: 0.6,
    /**
     * Bulwark: a war cry that draws the foes within `r` (`taunt` s) and a ward dome over the party
     * (`ward` for `wardFor` s); super armour through `armor` frames.
     */
    skill: Object.freeze({
      id: 'bulwark', name: 'Bulwark', mp: 16, cooldown: 16, total: 40, at: 16,
      poses: spans([0, 12, 'wind'], [13, 39, 'cast']),
      minFoes: 2, r: 6, taunt: 5, ward: 0.25, wardFor: 6, dome: 4.2, armor: 40, hurtAt: 0.5,
    }),
    /** Earthshatter: the mace slammed into the ground — a shockwave, then stone spikes; knockdown. */
    skill2: Object.freeze({
      id: 'earthshatter', name: 'Earthshatter', mp: 18, cooldown: 12, total: 46, at: 22,
      poses: spans([0, 19, 'backhand'], [20, 27, 'slash'], [28, 45, 'follow']),
      minFoes: 2, r: 3.5, mv: 2.0, kb: 2.6, poise: 50, knockdown: true, stop: 5, armor: 46,
      spikes: Object.freeze({ delay: 0.14, rInner: 1.0, r: 3.8, n: 9, mv: 0.9, kb: 1.4, poise: 20 }),
    }),
    mend: null,
    revive: null,
  })),
});

/**
 * A caster hero's missile (the cleric's Holy Bolt, the ice mage's Frost Lance; MemberCombat drives
 * it itself, drawn on the combat's FX batch): frames, poses, the release frame; speed (u/s), range
 * (u), radius (u); motion value, knockback, poise; the pause after it (s); `turn` homing (rad/s; 0:
 * straight, aimed with a lead); `splash` (radius, motion value) or null; `chill` / `slow` (s, the
 * speed taken; 0: none — HitSpec `chill` / `slow`; never on a boss, and not again on a foe still chilled
 * more than `refresh` s: the lance keeps no foe chilled for good).
 * @typedef {{ id: 'holyBolt'|'frostLance', total: number, poses: readonly (readonly [number, number, string])[], release: number,
 *   speed: number, range: number, radius: number, mv: number, kb: number, poise: number, cooldown: number, turn: number,
 *   splash: Readonly<{ r: number, mv: number }>|null, chill: number, slow: number, refresh?: number }} VqMissile
 */
/**
 * A hero's skill: `id`, MP, cooldown (s), frames, the frame it takes effect (`at`), poses; the rest
 * per skill (see `KIT`): radii (u), seconds, motion values, knockback, poise, `stop` (hit-stop, frames —
 * HitSpec `feel.stop`), statuses (`chill` / `slow` / `freeze`, s), `minFoes`.
 * @typedef {Readonly<Record<string, any>> & { id: string, name: string, mp: number, cooldown: number, total: number, at: number,
 *   poses: readonly (readonly [number, number, string])[] }} VqSkill
 */
/**
 * The cleric's raise: MP, cooldown (s), frames, the frame it raises at, poses; the HP fraction it
 * raises with, how near it kneels (u), how far it goes for a fallen member (u, from the player; in a
 * closed arena anywhere in it), no foe within `safe` u of the fallen (half that once it has been down
 * `brave` s), the i-frames it gives (s).
 * @typedef {{ id: 'revive', mp: number, cooldown: number, total: number, at: number, poses: readonly (readonly [number, number, string])[],
 *   frac: number, range: number, reach: number, safe: number, iframes: number, brave: number }} VqRevive
 */
/** A Mend: MP, cooldown (s), frames, the heal frame, HP (`frac` of max + `flat`), range (u). @typedef {{ mp: number, cooldown: number, total: number, at: number, frac: number, flat: number, range: number }} AllyMend */
/**
 * A caster hero's kit (cleric, ice mage).
 * @typedef {{ basic: VqMissile, skill: VqSkill, skill2: VqSkill, mend: AllyMend|null, revive: VqRevive|null,
 *   mpRegen?: number, critical?: number }} VqCasterKit
 */
/**
 * A melee hero's kit (greatshield).
 * @typedef {{ reach: number, combo: readonly AllyMeleeHit[], comboGap: number, skill: VqSkill, skill2: VqSkill,
 *   mend: AllyMend|null, revive: VqRevive|null, mpRegen?: number }} VqMeleeKit
 */

/**
 * How the heroes of Vanquish the Evil Dragon pick and pace their skills (PARTY.md §12.4; seconds, u).
 */
export const VQ_AI = Object.freeze({
  /**
   * A hero down this long in a fight gets up by itself (`ALLY.getUp` of its HP; rv-play #5: a long
   * boss fight never leaves one down for good — the cleric's raise comes first).
   */
  rally: 25,
  /**
   * A caster hero keeps this much more than its standoff's shortest distance (1.6 u) from a boss's
   * edge (its `radius`): out of its claws and stomp, shooting from there.
   */
  bossBerth: 2,
  /** After one of its skills the other waits at least this (two big spells never land at once). */
  skillGap: 1.6,
  /** Bulwark: foes within its `r` after someone else (the player, another member) … */
  bulwarkOthers: 2,
  /** … or this many foes within its `r` at all. */
  bulwarkCrowd: 4,
  /** Earthshatter wants its foes within this of the greatshield (its `r` less a margin). */
  quakeReach: 3.2,
  /** Glacial Tomb, Blizzard and Judgement want their foes within these of the spell's spot. */
  tombReach: 3.2,
  blizzardReach: 3.6,
  judgementReach: 3.2,
  /** A caster's spell lands on its target's spot pulled toward the middle of the foes within this (u). */
  centroid: 2.5,
});

