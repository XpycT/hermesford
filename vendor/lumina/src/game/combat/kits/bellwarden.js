/**
 * The bellwarden's kit (docs/contracts/EVERMERE_CAMPAIGN.md §5.5, §6.5): Linnet Halloway's hammer
 * combo with its resonance marks, Peal, Toll and Carillon. A lazy chunk: `CombatSystem.load`
 * imports it only where the player's kit is the bellwarden's (`game.playerKit`, a campaign's
 * `player.kit`) and keeps it as `sys.kitModule`; `PlayerCombat` makes its `BellKit` (`pc.bell`) and
 * calls it at the kit's seams — a skill's start (`begin`), its frames (`frame`), its cancel windows
 * (`can`), its end (`actionEnd`), a hammer swing's active frames (`swing`), the sub-step (`step`), a
 * reset (`clear`). Its look is BellwardenFx.js (`pc.bellLook`), called at the moves' beats.
 *
 * The rules: her slots and MP regeneration are rules.js's (`BELL_SKILLS`); what the kit reads of
 * the combat's (the frame clock, the shakes, the overlap test) PlayerCombat hands over (`BellMoves`:
 * importing rules.js here would split it out of the combat chunk); her hammer combo (`HAMMER_COMBO`,
 * swung by PlayerCombat as `comboSteps`), her skills' tables and the marks' rules are this module's
 * (`BELL_RULES`: in her chunk, not in the combat chunk every combat level downloads). Everything is
 * stepped on the player's sub-step time (`step(h)` and the
 * action's frames), seeded nowhere (no randomness: the fight's RNG is core's), and nothing of it
 * runs in a story scene (the ambient step does not step the player's kit).
 *
 * **Marks** (core's, COMBAT.md §30.4: a hit's `mark` +n — at most 3 on a foe, fading 6 s after the
 * last —, a hit's `consume` — mv × (1 + consume × n), the foe's marks taken —, `e.marks`, the event
 * `marksConsumed`): every hammer blow, Toll's ring and a Carillon bell's landing mark the foes they
 * strike; Peal and Carillon's chord consume them (their hits' `consume`). The kit hears the
 * `marksConsumed` events its hits cause (`counts.consumed`, the look's bursts).
 *
 * **Toll's bell** stands where it was planted for `TOLL.life` s and tolls every `TOLL.period` s —
 * at once when a hammer blow (or Peal's sound) reaches it — and its ring is warmth while it stands
 * (core's `sys.addWarmth`, read by `ctx.warmthZones()`: the Hush Bell's safe zones).
 *
 * @import { PlayerCombat, BellMoves } from '../PlayerCombat.js'
 * @import { CombatSystem } from '../CombatSystem.js'
 * @import { Enemy } from '../Enemy.js'
 * @import { HitSpec, PlayerHitMeta, SwingRecord, PlayerAction } from '../types.js'
 * @import { ComboStep } from '../rules.js'
 */

/** The kit this module carries (PLAYER_KIT_RULES' id). */
export const KIT_ID = 'bellwarden';

/**
 * A pose span of a move table: `[fromFrame, toFrame, pose]` (rules.js `PoseSpan`).
 * @typedef {[number, number, string]} PoseSpan
 */

// ---------------------------------------------------------------------------------------------
// The bellwarden's rules (EVERMERE_CAMPAIGN.md §5.5; every window in 60 Hz frames, as rules.js's):
// her slots and MP regeneration are rules.js's (`BELL_SKILLS`, `PLAYER_KIT_RULES.bellwarden`); her
// combo, her skills' tables and the marks' rules are here, in her lazy chunk.
// ---------------------------------------------------------------------------------------------

/**
 * The hammer combo: the traveler's three steps re-timed for a heavy head on a long haft — wind-ups
 * ≈ 25 % longer (the blow lands at f6 / f6 / f13 against f5 / f5 / f10), higher motion values, double
 * poise damage, longer hit-stops; the third an overhead slam (the hammer raised two-handed, `cast`,
 * driven down, `thrust`) whose impact also rings round the point it lands on (`HAMMER_SLAM`).
 * @type {readonly Readonly<ComboStep>[]}
 */
const HAMMER_COMBO = Object.freeze([
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A1', total: 28, poses: [[0, 5, 'wind'], [6, 10, 'slash'], [11, 27, 'follow']],
    active: [6, 8], next: 18, dodge: 10, lunge: 0.35, lungeFrames: [3, 8],
    hits: [{ shape: 'sector', r: 1.8, halfAngle: 65 }], mv: 1.1, kb: 0.8, sp: 6, poise: 20,
    fx: 'slash', flip: false, sfx: 'swing', fxAt: 6, hitStop: 5, finisher: false,
  })),
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A2', total: 30, poses: [[0, 5, 'follow'], [6, 10, 'backhand'], [11, 29, 'wind']],
    active: [6, 8], next: 19, dodge: 10, lunge: 0.35, lungeFrames: [3, 8],
    hits: [{ shape: 'sector', r: 1.8, halfAngle: 65 }], mv: 1.25, kb: 0.9, sp: 6, poise: 24,
    fx: 'slash', flip: true, sfx: 'swing', fxAt: 6, hitStop: 5, finisher: false,
  })),
  Object.freeze(/** @satisfies {ComboStep} */ ({
    id: 'A3', total: 48, poses: [[0, 12, 'cast'], [13, 18, 'thrust'], [19, 47, 'follow']],
    active: [13, 16], next: 40, dodge: 19, lunge: 0.6, lungeFrames: [9, 14],
    hits: [{ shape: 'lane', len: 2.4, width: 1.3 }, { shape: 'sector', r: 2.2, halfAngle: 40 }],
    mv: 2.05, kb: 2.2, sp: 9, poise: 60,
    fx: 'thrust', flip: false, sfx: 'swingHeavy', fxAt: 13, hitStop: 8, finisher: true,
  })),
]);
/**
 * The overhead slam's ring (the hammer combo's third step): a circle of radius `r` round the point
 * `ahead` u along the facing where the head lands, on the swing's tag (a foe is struck once).
 */
const HAMMER_SLAM = Object.freeze({ ahead: 1.4, r: 1.6 });
/**
 * Resonance marks (core's `HitSpec.mark`, COMBAT.md §30.4: at most 3 on a foe, fading 6 s after the
 * last): each hammer blow, Toll's ring and a Carillon bell's landing adds `perHit`.
 */
const BELL_MARKS = Object.freeze({ perHit: 1 });

/**
 * Peal (skill1): she swings the hammer through the air as through a bell's sound bow — a forward
 * cone of sound (`r`, ± `halfAngle`) at `at`: every foe in it is struck once (mv, kb pushed away,
 * `poise`: the tool for cracking a Hushguard's armour), and the marks on it are consumed for
 * + `consume` × mv each (core's `consume`: + 50 % a mark).
 */
const PEAL = Object.freeze({
  total: 32, poses: /** @satisfies {PoseSpan[]} */ ([[0, 7, 'wind'], [8, 13, 'slash'], [14, 31, 'follow']]),
  at: 9, r: 5, halfAngle: 35, mv: 1.4, kb: 1.6, poise: 60, consume: 0.5,
  lunge: 0.25, lungeFrames: /** @type {[number, number]} */ ([4, 9]), dodgeFrom: 18, attackFrom: 20, hitStop: 4,
});
/**
 * Toll (skill2): a spectral bell planted at a soft target within `reach` u (the bolt cone; else
 * `forward` u ahead) — it falls from the hammer's overhead stroke and lands at `plant`, tolls at once
 * and every `period` s for `life` s: a ring of radius `r` (mv, `poise`) that pulls the foes it
 * strikes `pull` u toward the bell (a knock of `pull` × their mass inward) and adds a mark.
 * A hammer blow that reaches it (`bellR`) tolls it at once — at most once a swing and once every
 * `strikeGap` s — and the period starts again. While it stands its ring is warmth
 * (`PlayerCombat#warmth`: the Hush Bell's safe zones, EVERMERE_CAMPAIGN.md §3).
 */
const TOLL = Object.freeze({
  total: 34, poses: /** @satisfies {PoseSpan[]} */ ([[0, 9, 'cast'], [10, 15, 'thrust'], [16, 33, 'follow']]),
  plant: 12, reach: 6, forward: 3, life: 6.0, period: 1.5, strikeGap: 0.9,
  r: 3.5, mv: 0.8, pull: 0.6, poise: 15, bellR: 0.9, dodgeFrom: 20, attackFrom: 22, hitStop: 3,
});
/**
 * Carillon (skill3): super armour to `armor`; four bells drop round her (`dropR` u, before, right,
 * behind, left of her facing) at the frames `drops` — the four notes of the bell motif, 12 f
 * (0.2 s) apart, the chord 48 f (0.8 s) after the first: the composer's `carillon` (four strikes
 * 0.2 s apart, the chord at 0.8 s) starts on the first — each a ring
 * of `dropHit` u round where it lands (mv `dropMv`, a mark); the last chord at `chord` detonates
 * every mark within `r` u: mv `mv` × (1 + `consume` per mark consumed: + 0.6 mv a mark), a stun of
 * `stun` s on every foe struck that is no boss; a boss carrying `bossMarks` marks takes a poise blow
 * of `bossBlow`.
 */
const CARILLON = Object.freeze({
  total: 72, poses: /** @satisfies {PoseSpan[]} */ ([[0, 5, 'tuck'], [6, 53, 'cast'], [54, 59, 'thrust'], [60, 71, 'follow']]),
  drops: Object.freeze([6, 18, 30, 42]), fall: 8, dropR: 2.4, dropHit: 2.0, dropMv: 0.9, dropPoise: 20,
  chord: 54, r: 8, mv: 1.6, consume: 0.375, poise: 40, stun: 2.5, bossBlow: 300, bossMarks: 3,
  armor: 60, dodgeFrom: 62, hitStop: 6, shake: /** @type {[number, number]} */ ([0.3, 0.45]),
});

/** Her combo, her skills' tables and the marks' rules (the kit's `M` adds them to PlayerCombat's `bellMoves`). */
export const BELL_RULES = Object.freeze({ HAMMER: HAMMER_COMBO, HAMMER_SLAM, BELL_MARKS, PEAL, TOLL, CARILLON });

/**
 * The hit metas of the hammer combo's steps, H1 … H3 (PlayerCombat `PLAYER_HIT_META`'s shape: its
 * `comboMeta` for this kit).
 * @type {readonly Readonly<PlayerHitMeta>[]}
 */
const COMBO_META = Object.freeze(HAMMER_COMBO.map((S, k) => Object.freeze({ source: 'melee', stop: S.hitStop, finisher: S.finisher, combo: k + 1 })));

/**
 * The hit metas of her skills' hits (PlayerCombat `PLAYER_HIT_META`'s shape): `peal` (Peal), `toll`
 * (the Toll bell's ring), `drop` (a Carillon bell landing), `chord` (Carillon's last chord).
 * @type {Readonly<Record<'peal'|'toll'|'drop'|'chord', Readonly<PlayerHitMeta>>>}
 */
const SKILL_META = Object.freeze({
  peal: Object.freeze({ source: 'skill', stop: PEAL.hitStop, finisher: false, combo: 0 }),
  toll: Object.freeze({ source: 'skill', stop: TOLL.hitStop, finisher: false, combo: 0 }),
  // (no hit-stop of its own: the four bells keep the motif's time with the `carillon` sound)
  drop: Object.freeze({ source: 'skill', stop: 0, finisher: false, combo: 0 }),
  chord: Object.freeze({ source: 'skill', stop: CARILLON.hitStop, finisher: false, combo: 0 }),
});

/**
 * The bellwarden's moves for a player's kit (PlayerCombat's constructor).
 * @param {PlayerCombat} pc
 * @param {BellMoves} moves the rules (PlayerCombat `BELL_MOVES`)
 * @returns {BellKit}
 */
export function createKit(pc, moves) {
  return new BellKit(pc, moves);
}

/**
 * Everything the kit's code reads: PlayerCombat's `bellMoves` (the frame clock, the shakes, the
 * overlap test) and the kit's own rules and its skills' metas.
 * @typedef {BellMoves & typeof BELL_RULES & { META: typeof SKILL_META }} KitRules
 */

/** The vertical reach of the kit's sound (Peal's cone, the rings): a step and a half. */
const SOUND_DY = 1.2;
/**
 * A spectral bell of the kit (Toll's, one at a time): where it stands, its clock and its tolls.
 * @typedef {object} TollBell
 * @property {boolean} alive planted and standing (tolling)
 * @property {boolean} falling planted by the running Toll, not landed yet
 * @property {number} x @property {number} y @property {number} z
 * @property {number} age seconds since it landed
 * @property {number} next seconds to its next toll
 * @property {number} since seconds since its last toll
 * @property {number} tolls tolls rung
 * @property {number} struck the swing tag that struck it last (once a swing)
 * @property {number} tag its last ring's hit tag
 */

/**
 * The bellwarden's moves (see the module comment). Made by `createKit`.
 */
export class BellKit {
  /**
   * @param {PlayerCombat} pc
   * @param {BellMoves} moves PlayerCombat's `bellMoves`
   */
  constructor(pc, moves) {
    this.pc = pc;
    /** @type {CombatSystem} */
    this.sys = pc.sys;
    /** The rules the kit reads (and its look: `pc.bell.M`). @type {KitRules} */
    const M = { ...moves, ...BELL_RULES, META: SKILL_META };
    this.M = M;
    /** Her hammer combo (PlayerCombat's `comboSteps`) and its steps' hit metas (`comboMeta`). */
    this.combo = HAMMER_COMBO;
    this.comboMeta = COMBO_META;
    /**
     * The kit's own hitbox record (the queue copies it): with the marks and the status a skill
     * puts on its foes. @type {HitSpec}
     */
    this._s = {
      shape: 'circle', x: 0, y: 0, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1,
      dy: SOUND_DY, mv: 1, kb: 0, poise: 0, knockdown: false, flat: 0, thin: false, tag: 0, fromX: 0, fromZ: 0,
      chill: 0, slow: 0, freeze: 0, stun: 0, feel: null, mark: 0, consume: 0,
    };
    /** A scratch shape for the kit's own overlap tests. @type {HitSpec} */
    this._probe = { shape: 'circle', x: 0, y: 0, z: 0, r: 1, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1, dy: SOUND_DY, mv: 0, kb: 0, tag: 0 };
    /** @type {TollBell} */
    this.toll = { alive: false, falling: false, x: 0, y: 0, z: 0, age: 0, next: 0, since: 0, tolls: 0, struck: -1, tag: 0 };
    /**
     * Carillon: running; its four bells' points (fixed at the cast) and whether each landed; the
     * chord rung. @type {{ on: boolean, pts: { x: number, y: number, z: number, landed: boolean }[], chord: boolean, baseX: number, baseZ: number }}
     */
    this.car = { on: false, pts: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, landed: false })), chord: false, baseX: 0, baseZ: 1 };
    /** Peal: the facing it was cast along, rung. */
    this.peal = { rung: false, dirX: 0, dirZ: 1 };
    /** The planted bell's warmth (core's `addWarmth`: a live disc) and its remover while it stands. */
    this._zone = { x: 0, z: 0, r: M.TOLL.r };
    /** @type {(() => void)|null} */
    this._unwarm = null;
    /** Scratch: the foes a skill strikes. @type {Enemy[]} */
    this._hit = [];
    /** Counters for tests (`info`). */
    this.counts = { peals: 0, tolls: 0, struck: 0, drops: 0, chords: 0, consumed: 0 };
    /** @type {(e: Enemy, n: number) => void} the marks her hits consume (the only `consume` hits) */
    this._onConsumed = (e, n) => {
      this.counts.consumed += n;
      this.pc.bellLook?.detonate(e, n);
    };
    this.sys.events?.on('marksConsumed', this._onConsumed);
  }

  // ------------------------------------------------------------------------------------------
  // Seams PlayerCombat calls
  // ------------------------------------------------------------------------------------------

  /**
   * Skill slot `i` started (PlayerCombat._trySkill, after the facing and the soft target were set).
   * @param {number} i 0 Peal, 1 Toll, 2 Carillon
   */
  begin(i) {
    const pc = this.pc;
    const fx = pc.player.facing;
    pc._armor = false;
    if (i === 0) {
      this.peal.rung = false;
      this.peal.dirX = fx.x;
      this.peal.dirZ = fx.z;
      pc.bellLook?.peal('start');
    } else if (i === 1) this._aimToll();
    else if (i === 2) this._beginCarillon();
  }

  /**
   * May a buffered `kind` cancel the running skill at frame `f`?
   * @param {PlayerAction} a 'skill1' | 'skill2' | 'skill3'
   * @param {string} kind
   * @param {number} f
   * @returns {boolean}
   */
  can(a, kind, f) {
    const { PEAL, TOLL, CARILLON } = this.M;
    if (kind === 'draught') return false;
    if (a === 'skill1') return (kind === 'dodge' && f >= PEAL.dodgeFrom) || ((kind === 'attack' || kind.startsWith('skill')) && f >= PEAL.attackFrom);
    if (a === 'skill2') return (kind === 'dodge' && f >= TOLL.dodgeFrom) || ((kind === 'attack' || kind.startsWith('skill')) && f >= TOLL.attackFrom);
    return kind === 'dodge' && f >= CARILLON.dodgeFrom;
  }

  /**
   * The running skill's frame (PlayerCombat._runFrame).
   * @param {number} i 0 Peal, 1 Toll, 2 Carillon
   */
  frame(i) {
    if (i === 0) this._framePeal();
    else if (i === 1) this._frameToll();
    else this._frameCarillon();
  }

  /**
   * The action `action` ends at frame `frame` (run out or cut short: a dodge, a hit, a death).
   * @param {PlayerAction} action
   * @param {number} frame
   */
  actionEnd(action, frame) {
    if (action === 'skill2' && this.toll.falling) {
      // cut short before the bell landed: no bell
      this.toll.falling = false;
      this.pc.bellLook?.toll('cancel', this.toll);
    }
    if (action === 'skill3' && this.car.on) {
      this.car.on = false;
      this.pc.bellLook?.carillon('end', frame);
    }
  }

  /**
   * A hammer swing's active frame (PlayerCombat._frameAttack, after its hits were queued): the
   * marks' tag, the slam's ring round where the head lands (the third step), the planted bell
   * struck (once a swing).
   * @param {Readonly<ComboStep>} S
   * @param {number} f the swing's frame
   * @param {SwingRecord} swing
   * @param {Readonly<PlayerHitMeta>} meta
   */
  swing(S, f, swing, meta) {
    const pc = this.pc;
    const sys = this.sys;
    const M = this.M;
    const p = pc.player.position;
    const fx = pc.player.facing;
    const first = f === S.active[0] && pc._prevFrame < f;
    let ringX = 0;
    let ringZ = 0;
    if (S.finisher) {
      ringX = p.x + fx.x * M.HAMMER_SLAM.ahead;
      ringZ = p.z + fx.z * M.HAMMER_SLAM.ahead;
      const s = this._spec(swing.tag, S.mv, S.kb, S.poise, M.BELL_MARKS.perHit);
      s.x = ringX;
      s.y = p.y;
      s.z = ringZ;
      s.r = M.HAMMER_SLAM.r;
      s.dy = M.MELEE_DY;
      sys.addPlayerHit(s, meta, swing);
      if (first) {
        pc.bellLook?.slam(ringX, sys.groundAt(ringX, ringZ), ringZ);
        sys.sfxAt('hammerSlam', ringX, ringZ, { volume: 0.9 });
        sys.shake(M.SHAKE.finisher[0] * 1.5, M.SHAKE.finisher[1]);
      }
    }
    // the planted bell struck by the blow: it tolls at once (once a swing)
    const T = this.toll;
    if (!T.alive || T.struck === swing.tag) return;
    const P = this._probe;
    let reach = false;
    for (const shape of S.hits) {
      P.shape = shape.shape;
      P.x = p.x; P.y = p.y; P.z = p.z;
      P.dirX = fx.x; P.dirZ = fx.z;
      P.r = shape.r ?? 1;
      P.halfAngle = shape.halfAngle ?? 60;
      P.len = shape.len ?? 1;
      P.width = shape.width ?? 1;
      P.dy = SOUND_DY;
      if (M.hitOverlaps(P, T.x, T.y, T.z, M.TOLL.bellR)) { reach = true; break; }
    }
    if (!reach && S.finisher && Math.hypot(T.x - ringX, T.z - ringZ) < M.HAMMER_SLAM.r + M.TOLL.bellR) reach = true;
    if (!reach) return;
    T.struck = swing.tag;
    this._strike();
  }

  /**
   * One sub-step of the kit's own clock (PlayerCombat.step, player-scaled seconds): the planted
   * bell ages and tolls.
   * @param {number} h
   */
  step(h) {
    const T = this.toll;
    if (T.alive) {
      const { TOLL, EPS } = this.M;
      T.age += h;
      T.since += h;
      T.next -= h;
      if (T.next <= EPS) this._ring(false);
      if (T.age >= TOLL.life - EPS) this._endToll();
    }
  }

  /** Everything back to rest (a reset, a revive): no bell, no Carillon (core clears the marks). */
  clear() {
    this.toll.alive = false;
    this.toll.falling = false;
    this.car.on = false;
    this._unwarm?.();
    this._unwarm = null;
    for (const k of /** @type {(keyof BellKit['counts'])[]} */ (Object.keys(this.counts))) this.counts[k] = 0;
  }

  /**
   * The resonance marks on a foe now (core's `e.marks`; its look shows them).
   * @param {Enemy} e
   * @returns {number}
   */
  marksOn(e) {
    return e.marks > 0 ? e.marks : 0;
  }

  /** Tests (`__game.combat.system.pc.bell.info()`). */
  info() {
    const T = this.toll;
    return {
      kit: KIT_ID, warm: !!this._unwarm,
      toll: { alive: T.alive, falling: T.falling, x: +T.x.toFixed(3), z: +T.z.toFixed(3), age: +T.age.toFixed(3), tolls: T.tolls },
      carillon: { on: this.car.on, landed: this.car.pts.filter((q) => q.landed).length, chord: this.car.chord },
      counts: { ...this.counts },
    };
  }

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------

  /**
   * The kit's hit record at the player's feet along the facing (reused; the queue copies it).
   * @param {number} tag @param {number} mv @param {number} kb @param {number} poise @param {number} mark
   * @returns {HitSpec}
   */
  _spec(tag, mv, kb, poise, mark) {
    const s = this._s;
    const p = this.pc.player.position;
    const f = this.pc.player.facing;
    s.shape = 'circle';
    s.x = p.x; s.y = p.y; s.z = p.z;
    s.r = 1; s.rInner = 0;
    s.dirX = f.x; s.dirZ = f.z;
    s.halfAngle = 60; s.len = 1; s.width = 1;
    s.dy = SOUND_DY;
    s.mv = mv; s.kb = kb; s.poise = poise;
    s.knockdown = false; s.flat = 0; s.thin = false;
    s.tag = tag;
    s.fromX = p.x; s.fromZ = p.z;
    s.stun = 0;
    s.mark = mark;
    s.consume = 0;
    return s;
  }

  /**
   * The foes a shape reaches now (alive, awake, shown), in the combat's order, into `_hit`.
   * @param {HitSpec} shape
   * @returns {Enemy[]}
   */
  _reached(shape) {
    const out = this._hit;
    out.length = 0;
    const list = this.sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.dormant || !e.sprite.visible || /** @type {any} */ (e).submerged) continue;
      if (this.M.hitOverlaps(shape, e.position.x, e.position.y, e.position.z, e.radius)) out.push(e);
    }
    return out;
  }

  /**
   * One foe struck by a kit hitbox of its own (a detonation, a ring): a small circle on it, on the
   * skill's tag, pushed away from (fromX, fromZ) — or pulled toward it with `pull`.
   * @param {Enemy} e @param {number} tag @param {number} mv @param {number} kb @param {number} poise
   * @param {number} fromX @param {number} fromZ @param {Readonly<PlayerHitMeta>} meta
   * @param {{ mark?: number, stun?: number, pull?: boolean, consume?: number }} [o]
   */
  _strikeFoe(e, tag, mv, kb, poise, fromX, fromZ, meta, o = {}) {
    const s = this._spec(tag, mv, kb, poise, o.mark ?? 0);
    const q = e.position;
    s.x = q.x; s.y = q.y; s.z = q.z;
    s.r = 0.05;
    s.stun = o.stun ?? 0;
    s.consume = o.consume ?? 0;
    if (o.pull) {
      // (the knock runs from `from` through the foe: a point beyond it, away from the bell)
      s.fromX = q.x + (q.x - fromX);
      s.fromZ = q.z + (q.z - fromZ);
    } else {
      s.fromX = fromX;
      s.fromZ = fromZ;
    }
    this.sys.addPlayerHit(s, meta, null);
  }

  // ------------------------------------------------------------------------------------------
  // Peal
  // ------------------------------------------------------------------------------------------

  _framePeal() {
    const { PEAL } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const f = pc.frame;
    if (f >= PEAL.total) { pc._finish(); return; }
    for (const [a, b, pose] of PEAL.poses) if (f >= a && f <= b) { pc._pose(pose); break; }
    const fx = pc.player.facing;
    pc._moveAlong(PEAL.lunge, PEAL.lungeFrames[0], PEAL.lungeFrames[1] + 1, fx.x, fx.z);
    const p = pc.player.position;
    if (pc._at(2)) {
      sys.sfxAt('swingHeavy', p.x, p.z, { volume: 0.6, pitch: 0.8 });
      pc.bellLook?.peal('wind');
    }
    if (pc._at(PEAL.at) && !this.peal.rung) {
      this.peal.rung = true;
      this._ringPeal();
    }
  }

  /** The cone of sound: every foe in it struck once, its marks detonated (core's `consume`). */
  _ringPeal() {
    const { PEAL, META, MELEE_DY } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const p = pc.player.position;
    const s = this._spec(pc._tagA, PEAL.mv, PEAL.kb, PEAL.poise, 0);
    s.shape = 'sector';
    s.dirX = this.peal.dirX;
    s.dirZ = this.peal.dirZ;
    s.r = PEAL.r;
    s.halfAngle = PEAL.halfAngle;
    s.dy = MELEE_DY;
    s.consume = PEAL.consume;
    // (the marks it will ring out — counted now for the look: core takes them at the hit)
    let ringing = 0;
    for (const e of this._reached(s)) ringing += e.marks > 0 ? e.marks : 0;
    sys.addPlayerHit(s, META.peal, null);
    this.counts.peals++;
    sys.sfxAt('peal', p.x, p.z, { volume: 1 });
    sys.shake(this.M.SHAKE.finisher[0], this.M.SHAKE.finisher[1]);
    pc.bellLook?.peal('ring', ringing);
    // the planted bell in the cone answers (sympathetic resonance: a strike)
    const T = this.toll;
    if (T.alive && this.M.hitOverlaps(s, T.x, T.y, T.z, this.M.TOLL.bellR)) this._strike();
  }

  // ------------------------------------------------------------------------------------------
  // Toll
  // ------------------------------------------------------------------------------------------

  /** Toll's aim: the soft target `_trySkill` chose (within `reach`), else `forward` u ahead. */
  _aimToll() {
    const { TOLL } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const p = pc.player.position;
    const fx = pc.player.facing;
    let x = p.x + fx.x * TOLL.forward;
    let z = p.z + fx.z * TOLL.forward;
    const t = pc._boltTarget;
    if (t && t.alive) {
      const dx = t.position.x - p.x;
      const dz = t.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const k = Math.min(d, TOLL.reach) / d;
        x = p.x + dx * k;
        z = p.z + dz * k;
      }
    }
    // a bell planted where it was already standing takes its place (one bell at a time)
    const T = this.toll;
    if (T.alive) this._endToll();
    T.falling = true;
    T.x = x;
    T.z = z;
    T.y = sys.groundAt(x, z);
    T.age = 0;
    T.since = 0;
    T.tolls = 0;
    T.struck = -1;
    pc.bellLook?.toll('raise', T);
  }

  _frameToll() {
    const { TOLL } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const f = pc.frame;
    if (f >= TOLL.total) { pc._finish(); return; }
    for (const [a, b, pose] of TOLL.poses) if (f >= a && f <= b) { pc._pose(pose); break; }
    const p = pc.player.position;
    const T = this.toll;
    if (pc._at(2) && T.falling) {
      sys.sfxAt('dodge', p.x, p.z, { volume: 0.5, pitch: 0.7 });
      pc.bellLook?.toll('fall', T);
    }
    if (pc._at(TOLL.plant) && T.falling) {
      T.falling = false;
      T.alive = true;
      T.age = 0;
      T.since = 0;
      // its ring is warmth while it stands (the Hush Bell's safe zones: core's `addWarmth`)
      this._zone.x = T.x;
      this._zone.z = T.z;
      this._unwarm?.();
      this._unwarm = sys.addWarmth(this._zone);
      pc.bellLook?.toll('plant', T);
      sys.sfxAt('hammerSlam', T.x, T.z, { volume: 0.7, pitch: 0.9 });
      this._ring(false);
    }
  }

  /** The planted bell's time is out (or another takes its place): no more tolls, no warmth. */
  _endToll() {
    const T = this.toll;
    T.alive = false;
    this._unwarm?.();
    this._unwarm = null;
    this.pc.bellLook?.toll('end', T);
  }

  /** The planted bell struck (a blow, Peal's sound): it tolls now if it rested `strikeGap` s. */
  _strike() {
    const T = this.toll;
    if (!T.alive || T.since < this.M.TOLL.strikeGap - this.M.EPS) return;
    this.counts.struck++;
    this._ring(true);
  }

  /**
   * The planted bell tolls: its ring strikes every foe within `r` (a mark, pulled toward it), the
   * period starts again.
   * @param {boolean} struck a blow rang it (else its own period)
   */
  _ring(struck) {
    const { TOLL, META } = this.M;
    const sys = this.sys;
    const T = this.toll;
    T.next = TOLL.period;
    T.since = 0;
    T.tolls++;
    T.tag = sys.tags.next();
    this.counts.tolls++;
    const P = this._probe;
    P.shape = 'circle';
    P.x = T.x; P.y = T.y; P.z = T.z;
    P.r = TOLL.r;
    P.dy = SOUND_DY;
    const foes = this._reached(P);
    for (const e of foes) {
      const d = Math.hypot(e.position.x - T.x, e.position.z - T.z);
      const pull = Math.max(0, Math.min(TOLL.pull, d - e.radius - 0.2));
      const mass = Number.isFinite(e.mass) && e.mass > 0 ? e.mass : 0;
      this._strikeFoe(e, T.tag, TOLL.mv, pull * mass, TOLL.poise, T.x, T.z, META.toll, { mark: this.M.BELL_MARKS.perHit, pull: true });
    }
    sys.sfxAt('tollBell', T.x, T.z, { volume: struck ? 1 : 0.85 });
    this.pc.bellLook?.toll('ring', T, struck);
  }

  // ------------------------------------------------------------------------------------------
  // Carillon
  // ------------------------------------------------------------------------------------------

  _beginCarillon() {
    const { CARILLON } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const p = pc.player.position;
    const fx = pc.player.facing;
    const C = this.car;
    C.on = true;
    C.chord = false;
    C.baseX = fx.x;
    C.baseZ = fx.z;
    // before her, to her right, behind, to her left (the motif's four notes round her)
    const dirs = [[fx.x, fx.z], [-fx.z, fx.x], [-fx.x, -fx.z], [fx.z, -fx.x]];
    for (let k = 0; k < 4; k++) {
      const q = C.pts[k];
      q.x = p.x + dirs[k][0] * CARILLON.dropR;
      q.z = p.z + dirs[k][1] * CARILLON.dropR;
      q.y = sys.groundAt(q.x, q.z);
      q.landed = false;
    }
    pc._armor = true;
    pc.bellLook?.carillon('start', 0);
  }

  _frameCarillon() {
    const { CARILLON } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const C = this.car;
    const f = pc.frame;
    if (f >= CARILLON.total) { pc._finish(); return; }
    for (const [a, b, pose] of CARILLON.poses) if (f >= a && f <= b) { pc._pose(pose); break; }
    pc._armor = f <= CARILLON.armor;
    if (!C.on) return;
    for (let k = 0; k < 4; k++) {
      const at = CARILLON.drops[k];
      if (pc._at(Math.max(0, at - CARILLON.fall))) pc.bellLook?.carillon('fall', k);
      if (pc._at(at)) this._drop(k);
    }
    if (pc._at(CARILLON.chord)) this._chord();
  }

  /** Carillon's bell `k` lands: its note, a ring round it that marks. @param {number} k */
  _drop(k) {
    const { CARILLON, META } = this.M;
    const sys = this.sys;
    const q = this.car.pts[k];
    q.landed = true;
    const tag = sys.tags.next();
    const s = this._spec(tag, CARILLON.dropMv, 0.6, CARILLON.dropPoise, this.M.BELL_MARKS.perHit);
    s.x = q.x; s.y = q.y; s.z = q.z;
    s.r = CARILLON.dropHit;
    s.fromX = q.x;
    s.fromZ = q.z;
    sys.addPlayerHit(s, META.drop, null);
    this.counts.drops++;
    // the motif's notes and the chord: the composer's `carillon`, from the first bell (its four
    // strikes 0.2 s apart land with the bells, its chord at 0.8 s with the last chord)
    const p = this.pc.player.position;
    if (k === 0) sys.sfxAt('carillon', p.x, p.z, { volume: 1 });
    sys.shake(this.M.SHAKE.hit[0] * 2, this.M.SHAKE.hit[1]);
    this.pc.bellLook?.carillon('land', k);
  }

  /** The last chord: every mark within `r` detonated, the foes stunned (no boss), a boss's blow. */
  _chord() {
    const { CARILLON, META } = this.M;
    const pc = this.pc;
    const sys = this.sys;
    const C = this.car;
    const p = pc.player.position;
    C.chord = true;
    const P = this._probe;
    P.shape = 'circle';
    P.x = p.x; P.y = p.y; P.z = p.z;
    P.r = CARILLON.r;
    P.dy = SOUND_DY;
    const tag = pc._tagB;
    let ringing = 0;
    for (const e of this._reached(P)) {
      const n = e.marks > 0 ? e.marks : 0;
      ringing += n;
      // a boss carrying its full marks: its own hitbox first on the chord's tag — the blow's poise
      if (e.boss && n >= CARILLON.bossMarks) {
        this._strikeFoe(e, tag, CARILLON.mv, 1.2, CARILLON.bossBlow, p.x, p.z, META.chord, { consume: CARILLON.consume });
      }
    }
    // the chord on everyone else within `r` (core's `consume`; the stun takes on no boss)
    const s = this._spec(tag, CARILLON.mv, 1.2, CARILLON.poise, 0);
    s.r = CARILLON.r;
    s.stun = CARILLON.stun;
    s.consume = CARILLON.consume;
    sys.addPlayerHit(s, META.chord, null);
    this.counts.chords++;
    // (its sound is the `carillon` phrase's chord, started with the first bell; the ground's thump)
    sys.sfxAt('hammerSlam', p.x, p.z, { volume: 0.6, pitch: 0.8 });
    sys.shake(CARILLON.shake[0], CARILLON.shake[1]);
    pc.bellLook?.carillon('chord', ringing);
  }
}
