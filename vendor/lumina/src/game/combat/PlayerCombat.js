import { Sprite3D, DIRECTIONS, globalUniforms } from '../../engine/index.js';
import {
  EPS, F, frameOf, LEVEL_CAP, SP_MAX, PER_LEVEL, hpMaxFor, mpMaxFor, atkFor, defFor, xpToNext, UPGRADES,
  SP_REGEN, SP_DELAY, SP_DELAY_EMPTY, SP_DODGE_MIN, SP_COST, WINDED_UNTIL, WINDED_RECOVERY, MP_PER_HIT,
  MP_PER_SWING_MAX, POTION_MAX, POTION_START, DRAUGHT_HEAL, PERFECT, PLAYER_BODY, PLAYER_RADIUS, MELEE_DY, SHOT_Y,
  COMBO, MAGNET, FACING_FIX_FRAMES, ROLL, BACKSTEP, WHIRL, BOLT, NOVA, DRAUGHT, HITSTUN, KNOCKDOWN, KB_CAP,
  LEVELUP_INVULN, PLAYER_KIT_RULES, TEMPEST, DRAGONFANG, SKYFALL,
} from './rules.js';
import { aimVy } from './Projectiles.js';
import { PLAYER_FLASH, BLINK_HZ, SHAKE } from './Feel.js';
import { hitOverlaps } from './Hitboxes.js';
import { t, sep } from '../../engine/i18n/I18n.js';

/**
 * @import { HitSpec, PlayerAction, PlayerHitMeta, SwingRecord, ProjectileSpec, MarkerSpec } from './types.js'
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { PlayerKit, SkillSlotDef, ComboStep } from './rules.js'
 * @import { FxQuads, FxQuadParams } from '../../engine/fx/FxQuads.js'
 * @import { Enemy } from './Enemy.js'
 * @import { SwordmasterFx } from './SwordmasterFx.js'
 * @import { BellwardenFx } from './BellwardenFx.js'
 * @import { BellKit } from './kits/bellwarden.js'
 */

/**
 * PlayerCombat — the player's combat kit (COMBAT.md §6): stats and progression, SP / MP / HP,
 * the 3-hit combo with its magnet and lunges, dodge roll / backstep with i-frames and the perfect
 * dodge, the three skills, the Healing Draught, hitstun / knockdown, death, level-ups.
 *
 * Three kits (`kit`, from the game's `playerKit`: a campaign's `player.kit`): the traveler's
 * (COMBAT.md §6.6: Whirl Slash, Ember Bolt, Radiant Nova), the swordmaster's
 * (docs/contracts/DRAGON_CAMPAIGN.md §6.8: Tempest Edge, Dragonfang Wave, Skyfall Judgement on the
 * same actions and keys, its own MP regeneration, and wind-blade trails on the same combo) and the
 * bellwarden's (docs/contracts/EVERMERE_CAMPAIGN.md §5.5: the hammer combo — the kit's own `combo`,
 * `comboSteps` — whose blows leave resonance marks, Peal, Toll and Carillon). Only the swordmaster
 * and the bellwarden make `HeroFx` (their own FxQuads effects); the traveler's code paths, tags and
 * numbers are those of before. The swordmaster's look — every effect its moves show, their lights,
 * 3D swords and particles — is its own lazy package (SwordmasterFx.js, `look`: the director of
 * `CombatSystem.sword`), which this class calls at the moves' moments (one-line hooks; the moves'
 * frames, hits, hit-stop, shake and sounds stay here). The bellwarden's moves are a lazy module of
 * their own (kits/bellwarden.js `BellKit`, `bell`: made from `CombatSystem.kitModule`), which this
 * class calls at the same seams — a skill's start, its frames and cancel windows, a hammer swing's
 * hits, the sub-step, a reset — and its look is BellwardenFx.js (`bellLook`, the director of
 * `CombatSystem.bell`).
 *
 * It owns the player sprite while an action runs (`player.action` !== null): the pose of every
 * frame is shown with `sprite.setFrame(column, row of the facing)` — frame = hitbox frame — and
 * every displacement goes through `player.moveBy` (terrain and props still block). Locomotion is
 * the Player's own (`Player.update`, frame dt) while no action runs.
 *
 * Time: `step(h)` gets player-scaled sub-step seconds; action frames are `frameOf(t)` and every
 * window of the contract is a frame index. Frame events fire once when their frame is reached
 * (sub-steps never skip a frame: h ≤ 1/60 s). Winded attacks run their recovery frames (after the
 * active window) at 1 / 1.35 speed.
 */

/**
 * Hit metadata carried next to a player HitSpec (constants: nothing is allocated per hit). The
 * swordmaster's skills (DRAGON_CAMPAIGN.md §6.8): `tempest` (Tempest Edge's first two hits),
 * `tempestEnd` (its third), `fang` (Dragonfang Wave), `skyfall` (Skyfall Judgement). (The
 * bellwarden's — her hammer combo's and her skills' — are her kit module's.)
 * @type {Record<'A1'|'A2'|'A3'|'whirl'|'nova'|'bolt'|'tempest'|'tempestEnd'|'fang'|'skyfall', Readonly<PlayerHitMeta>>}
 */
const META = {
  A1: Object.freeze({ source: 'melee', stop: COMBO[0].hitStop, finisher: false, combo: 1 }),
  A2: Object.freeze({ source: 'melee', stop: COMBO[1].hitStop, finisher: false, combo: 2 }),
  A3: Object.freeze({ source: 'melee', stop: COMBO[2].hitStop, finisher: true, combo: 3 }),
  whirl: Object.freeze({ source: 'skill', stop: WHIRL.hitStop, finisher: false, combo: 0 }),
  nova: Object.freeze({ source: 'skill', stop: NOVA.hitStop, finisher: false, combo: 0 }),
  bolt: Object.freeze({ source: 'projectile', stop: BOLT.hitStop, finisher: false, combo: 0 }),
  tempest: Object.freeze({ source: 'skill', stop: TEMPEST.hitStop, finisher: false, combo: 0 }),
  tempestEnd: Object.freeze({ source: 'skill', stop: TEMPEST.finalStop, finisher: false, combo: 0 }),
  fang: Object.freeze({ source: 'skill', stop: DRAGONFANG.hitStop, finisher: false, combo: 0 }),
  skyfall: Object.freeze({ source: 'skill', stop: SKYFALL.hitStop, finisher: false, combo: 0 }),
};
export { META as PLAYER_HIT_META };

/**
 * The swordmaster's moves' timings as its look reads them (`PlayerCombat#moves`; rules.js): handed
 * over at run time — a lazy chunk importing rules.js itself made the bundler split rules.js out of
 * the combat chunk, a chunk more for every combat level and a different game chunk.
 */
const SWORD_MOVES = Object.freeze({ F, TEMPEST, DRAGONFANG, SKYFALL });
/**
 * What the bellwarden's kit module and look read from the combat chunk (`PlayerCombat#bellMoves`;
 * handed over for the same reason): the frame clock, the shakes, the melee height, the overlap test.
 * Her combo and her skills' tables are the kit module's own.
 */
const BELL_MOVES = Object.freeze({ F, frameOf, EPS, SHAKE, MELEE_DY, hitOverlaps });
/** @typedef {typeof BELL_MOVES} BellMoves the bellwarden's rules handed to its kit module and look */

/** @type {(u: number) => number} ease-out (0..1) */
const ease = (u) => 1 - (1 - u) * (1 - u);
const DEG = Math.PI / 180;
/** How much Skyfall's gold ground rings dim at full night (`uNight` 1: the exposure rises). */
const RING_NIGHT_DIM = 0.5;
/**
 * … and under a low sun by day (golden hour: the warm light and grade push their gold into the
 * foes' fire band, over Vorthrax's telegraphs): × (1 − `dim` · low), low = 1 − smoothstep(`lo`,
 * `hi`, the sun's height) — SwordmasterFx's `SUN` for its gold lit layers; 0.54 at the Wyrmspine's
 * 17.3 (the markers' 'player' style has one colour: GroundMarkers' to recolour toward cream).
 */
const RING_LOW_SUN = Object.freeze({ dim: 0.6, lo: 0.3, hi: 0.65 });

export class PlayerCombat {
  /**
   * @param {CombatSystem} sys the CombatSystem
   */
  constructor(sys) {
    this.sys = sys;
    this.player = sys.player;
    this.sprite = sys.player.sprite;
    this.sheet = sys.player.sheet;
    this.radius = PLAYER_RADIUS;
    this.body = PLAYER_BODY;
    this.potionMax = POTION_MAX;
    /**
     * The player's hitbox record (the queue copies it). `mark`: the resonance marks a hit puts on
     * the foes it strikes (core's `HitSpec.mark`; only the bellwarden's blows set it — 0 otherwise).
     * @type {HitSpec}
     */
    this._spec = {
      shape: 'sector', x: 0, y: 0, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1,
      dy: MELEE_DY, mv: 1, kb: 0, poise: 0, knockdown: false, flat: 0, thin: false, tag: 0, fromX: 0, fromZ: 0, mark: 0,
    };
    // the current swing's hit tag and MP gain (two records in turn: no object per swing)
    /** @type {SwingRecord[]} */
    this._swings = [{ tag: 0, mp: 0 }, { tag: 0, mp: 0 }];
    this._swingI = 0;
    this._tagA = 0;
    this._tagB = 0;
    /** @type {ProjectileSpec} the Ember Bolt's launch record */
    this._proj = { kind: 'emberBolt', x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, vy: 0, speed: BOLT.speed, range: BOLT.range, radius: BOLT.radius, mv: BOLT.mv, kb: BOLT.kb, poise: BOLT.poise, pierce: false, splash: BOLT.splash, arc: null };
    this._aim = { x: 0, z: 1 };
    this._tmp = { x: 0, z: 0 };
    const want = sys.game?.playerKit;
    const kitName = want === 'swordmaster' || want === 'bellwarden' ? want : 'traveler';
    /** @type {Readonly<PlayerKit>} the kit's rules (rules.js `PLAYER_KIT_RULES`) */
    this.kit = PLAYER_KIT_RULES[kitName];
    /** The kit's skill slots, in slot order (the HUD's slots, the cooldowns). @type {readonly Readonly<SkillSlotDef>[]} */
    this.skills = this.kit.skills;
    /** The swordmaster's moves (DRAGON_CAMPAIGN.md §6.8); false: another kit's. */
    this.sword = kitName === 'swordmaster';
    /** What the bellwarden's kit module and look read from the combat chunk (`BELL_MOVES`). */
    this.bellMoves = BELL_MOVES;
    /**
     * The bellwarden's moves (EVERMERE_CAMPAIGN.md §5.5: kits/bellwarden.js, the lazy module
     * `CombatSystem.load` imported where the player's kit is the bellwarden's — `sys.kitModule`);
     * null for the other kits.
     * @type {BellKit|null}
     */
    this.bell = kitName === 'bellwarden' && sys.kitModule ? sys.kitModule.createKit(this, BELL_MOVES) : null;
    /**
     * The kit's combo steps (its own — the bellwarden's hammer, her kit module's — else the
     * traveler's `COMBO`, which the swordmaster swings too). @type {readonly Readonly<ComboStep>[]}
     */
    this.comboSteps = this.bell ? this.bell.combo : COMBO;
    /** The hit metas of the combo steps, A1 … A3. @type {readonly Readonly<PlayerHitMeta>[]} */
    this.comboMeta = this.bell ? this.bell.comboMeta : [META.A1, META.A2, META.A3];
    /** @type {HeroFx|null} the swordmaster's or the bellwarden's effects (the traveler makes none) */
    this.hfx = this.sword || this.bell ? new HeroFx(sys.quads, sys.atlas?.frames ?? {}, sys.fx) : null;
    /** The swordmaster's moves' timings, for its look (rules.js). */
    this.moves = SWORD_MOVES;
    /**
     * The swordmaster's look (SwordmasterFx.js, the director of `sys.sword`: made by
     * `CombatSystem.load` where the player's kit is the swordmaster's; null for the traveler).
     * @type {SwordmasterFx|null}
     */
    this.look = sys.sword?.director(this) ?? null;
    /**
     * The bellwarden's look (BellwardenFx.js, the director of `sys.bell`: made where the player's
     * kit is the bellwarden's; null for the other kits). Its kit module calls it at the moves' beats.
     * @type {BellwardenFx|null}
     */
    this.bellLook = this.bell ? sys.bell?.director(this) ?? null : null;
    /** Tempest Edge's third hit tag (the swordmaster draws it after `_tagA`, `_tagB`). */
    this._tagC = 0;
    /** The sprite's lift above the feet (Skyfall's leap; the shadow proxy rises with it). */
    this._lift = 0;
    /** Seconds the running action advanced in this sub-step (`_advance`). */
    this._stepDt = 0;
    /**
     * The Dragonfang wave in flight (one at a time: its cooldown outlasts it): front position and
     * ground, direction, distance run, hit tag, the next dust mark.
     * @type {{ alive: boolean, x: number, y: number, z: number, dirX: number, dirZ: number, d: number, tag: number, dust: number }}
     */
    this._wave = { alive: false, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, d: 0, tag: 0, dust: 0 };
    /** Skyfall's landing point (the sigil and the sword follow it while the leap runs). */
    this._land = { x: 0, y: 0, z: 0 };
    this._leap = 0;
    this._leapX = 0;
    this._leapZ = 1;
    this._baseX = 0;
    this._baseZ = 1;
    /**
     * Skyfall's two shock rings (core-owned GroundMarkers, `markerAllocCore`): −1 while unused.
     * @type {{ id: number, t: number, x: number, z: number, delay: number, dur: number, r0: number, r1: number, w: number }[]}
     */
    this._rings = [0, 1].map(() => ({ id: -1, t: 0, x: 0, z: 0, delay: 0, dur: 0.4, r0: 0.5, r1: 6, w: 0.5 }));
    /** @type {Partial<MarkerSpec>} the rings' marker record (reused) */
    this._ringSpec = { shape: 'ring', x: 0, z: 0, r: 1, rInner: 0, progress: 1, style: 'player', alpha: 1 };
    this.reset();
  }

  /** Everything back to a fresh Lv 1 player (reset hook). Does not move the player. */
  reset() {
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.potions = POTION_START;
    this.upgrades = { maxHp: 0, maxMp: 0, attack: 0, def: 0 };
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.sp = SP_MAX;
    this.alive = true;
    this.winded = false;
    this.cooldowns = [0, 0, 0];
    this.draughtCd = 0;
    this.spDelay = 0;
    this.perfectCd = 0;
    this.iframes = 0;
    this.blink = false;
    this.invulnT = 0;
    this.flashT = 0;
    this.deaths = 0;
    this.perfectDodges = 0;
    this._endAction();
    /** @type {number} the combo step of the running (or last) attack: 1..3 = A1..A3, 0: none */
    this.combo = 0;
    /** Swings started (every combo step; enemies read it through `ctx.player.swing`). */
    this.swings = 0;
    this._freeNovaMarker();
    this._clearHeroFx();
    this._applyVisuals(0);
  }

  // ------------------------------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------------------------------

  get hpMax() { return hpMaxFor(this.level, this.upgrades.maxHp); }
  get mpMax() { return mpMaxFor(this.level, this.upgrades.maxMp); }
  get spMax() { return SP_MAX; }
  get atk() { return atkFor(this.level, this.upgrades.attack); }
  get def() { return defFor(this.level, this.upgrades.def); }
  get xpNext() { return xpToNext(this.level); }

  /** Invulnerable now (i-frames of any kind, level-up, dead). */
  get invulnerable() {
    if (!this.alive || this.iframes > 0 || this.invulnT > 0) return true;
    const w = this._iframeWindow();
    return !!w && this.frame >= w[0] && this.frame <= w[1];
  }

  /** Rolling or backstepping (separation skips the player, dust, perfect dodge). */
  get dodging() { return this.action === 'roll' || this.action === 'backstep'; }

  _iframeWindow() {
    switch (this.action) {
      case 'roll': return ROLL.iframes;
      case 'backstep': return BACKSTEP.iframes;
      case 'skill3': return this.bell ? null : this.sword ? SKYFALL.iframes : NOVA.iframes;
      case 'knockdown': return [0, 1e9];
      default: return null;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Sub-step
  // ------------------------------------------------------------------------------------------

  /**
   * One combat sub-step for the player.
   * @param {number} h player-scaled seconds
   */
  step(h) {
    this._stepTimers(h);
    if (this.action) this._advance(h);
    if (this._wave.alive) this._stepWave(h);
    // (the bellwarden's planted bell and its tolls: the kit's own clock)
    if (this.bell) this.bell.step(h);
    if (this.alive) this._decide();
    this._regen(h);
  }

  /** @param {number} h */
  _stepTimers(h) {
    if (this.iframes > 0) this.iframes = Math.max(0, this.iframes - h);
    if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - h);
    if (this.perfectCd > 0) this.perfectCd = Math.max(0, this.perfectCd - h);
    for (let i = 0; i < 3; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - h);
    if (this.draughtCd > 0 && this.action !== 'draught') this.draughtCd = Math.max(0, this.draughtCd - h);
  }

  /** @param {number} h */
  _regen(h) {
    if (!this.alive) return;
    if (this.spDelay > 0) this.spDelay = Math.max(0, this.spDelay - h);
    else if (this.sp < SP_MAX) this.sp = Math.min(SP_MAX, this.sp + SP_REGEN * h);
    if (this.winded && this.sp >= WINDED_UNTIL) this.winded = false;
    if (this.mp < this.mpMax) this.mp = Math.min(this.mpMax, this.mp + this.kit.mpRegen * h);
  }

  /** @param {number} sp */
  _spend(sp) {
    this.sp = Math.max(0, this.sp - sp);
    if (this.sp <= EPS) {
      this.sp = 0;
      this.winded = true;
      this.spDelay = SP_DELAY_EMPTY;
    } else this.spDelay = Math.max(this.spDelay, SP_DELAY);
  }

  /**
   * Advance the running action by h and run the frame events it crossed.
   * @param {number} h
   */
  _advance(h) {
    let dt = h;
    if (this.action === 'attack' && this._windedAction) {
      // winded: recovery frames (after the active window) run 1.35× longer
      const S = this.comboSteps[this.combo - 1];
      if (this.frame > S.active[1]) dt = h / WINDED_RECOVERY;
    }
    this.t += dt;
    this._stepDt = dt;
    const prev = this.frame;
    this.frame = frameOf(this.t);
    this._prevFrame = prev;
    this._runFrame();
  }

  /**
   * Was frame `n` reached in this sub-step (or is it the action's first sub-step and n = 0)?
   * @param {number} n
   * @returns {boolean}
   */
  _at(n) {
    return this._prevFrame < n && this.frame >= n;
  }

  _runFrame() {
    switch (this.action) {
      case 'attack': this._frameAttack(); break;
      case 'roll': case 'backstep': this._frameDodge(); break;
      case 'skill1': if (this.bell) this.bell.frame(0); else if (this.sword) this._frameTempest(); else this._frameWhirl(); break;
      case 'skill2': if (this.bell) this.bell.frame(1); else if (this.sword) this._frameFang(); else this._frameBolt(); break;
      case 'skill3': if (this.bell) this.bell.frame(2); else if (this.sword) this._frameSkyfall(); else this._frameNova(); break;
      case 'draught': this._frameDraught(); break;
      case 'hitstun': this._frameHitstun(); break;
      case 'knockdown': this._frameKnockdown(); break;
      case 'dead': this._pose('down'); break;
      default: break;
    }
  }

  /** Start / cancel into the highest-priority buffered action allowed now (§5.1). */
  _decide() {
    const input = this.sys.cin;
    const a = this.action;
    const f = this.frame;
    /** @type {(kind: string) => boolean} may a buffered `kind` start now? */
    const can = (kind) => {
      if (!a) return true;
      // (the bellwarden's skills keep their own cancel windows: its kit module)
      if (this.bell && (a === 'skill1' || a === 'skill2' || a === 'skill3')) return this.bell.can(a, kind, f);
      switch (a) {
        case 'attack': {
          const S = this.comboSteps[this.combo - 1];
          if (kind === 'dodge') return f >= S.dodge;
          return f >= S.next;
        }
        case 'roll': return kind === 'attack' ? f >= ROLL.attackFrom : kind === 'dodge' ? f >= ROLL.dodgeFrom : kind === 'draught' ? false : f >= ROLL.skillFrom;
        case 'backstep': return kind === 'attack' ? f >= BACKSTEP.attackFrom : kind === 'dodge' ? f >= BACKSTEP.dodgeFrom : kind === 'draught' ? false : f >= BACKSTEP.skillFrom;
        case 'skill1': return kind === 'dodge' && f >= (this.sword ? TEMPEST.dodgeFrom : WHIRL.dodgeFrom);
        case 'skill2': {
          const M = this.sword ? DRAGONFANG : BOLT;
          return (kind === 'dodge' && f >= M.dodgeFrom) || ((kind === 'attack' || kind.startsWith('skill')) && f >= M.attackFrom);
        }
        case 'skill3': return kind === 'dodge' && f >= (this.sword ? SKYFALL.dodgeFrom : NOVA.dodgeFrom);
        case 'knockdown': return kind === 'dodge' && this.t >= F(KNOCKDOWN.techFrom) - EPS;
        default: return false;
      }
    };
    if (input.has('dodge') && can('dodge')) {
      if (this.sp >= SP_DODGE_MIN) {
        const b = input.take('dodge');
        this._startDodge(b.mouse);
        return;
      }
    }
    for (let i = 0; i < 3; i++) {
      const id = this.skills[i].id;
      if (input.has(id) && can(id)) {
        const b = input.take(id);
        if (this._trySkill(i, b.mouse)) return;
      }
    }
    if (input.has('attack') && can('attack')) {
      const b = input.take('attack');
      this._startAttack(b.mouse, { rollSlash: a === 'roll' });
      return;
    }
    if (input.has('draught') && can('draught')) {
      input.take('draught');
      this._tryDraught();
    }
  }

  /**
   * Start `action` at f0 (per-action state cleared).
   * @param {PlayerAction} action
   */
  _begin(action) {
    this._clearActionState();
    this.action = action;
    this.player.action = action;
  }

  _clearActionState() {
    // Skyfall ends — run out, or cut short before its slam (a hit before its i-frames, a shove, a
    // death): its look decides what stays (told the frame it reached, before it is forgotten)
    if (this.action === 'skill3' && this.sword) this.look?.skyfallEnd(this.frame);
    // (the bellwarden's skill ends or is cut short: its kit lets go of what the action held)
    if (this.bell && this.action) this.bell.actionEnd(this.action, this.frame);
    this.t = 0;
    this.frame = 0;
    this._prevFrame = -1;
    this._motion = null;
    this._moved = 0;
    this._windedAction = false;
    this._consumed = false;
    this._armor = false;
    this._swing = null;
    /** @type {number} the sheet column `_pose` last showed (−1: none since the reset) */
    this._lastCol = -1;
    /** @type {number} its row (the facing seen from the camera) */
    this._lastRow = -1;
    this._freeNovaMarker();
    if (this._lift !== 0) this._setLift(0);
  }

  /** No action: the Player's locomotion takes the sprite back. */
  _endAction() {
    this._clearActionState();
    this.action = null;
    if (this.player) this.player.action = null;
  }

  /** The action ran its last frame: back to locomotion (the combo resets to A1). */
  _finish() {
    this._endAction();
    this.combo = 0;
  }

  // ------------------------------------------------------------------------------------------
  // Attack combo (§6.4)
  // ------------------------------------------------------------------------------------------

  /**
   * @param {boolean} mouse triggered by a mouse button (aim at the pointer)
   * @param {{ rollSlash?: boolean }} [opts] rollSlash: out of a roll (longer lunge)
   */
  _startAttack(mouse, { rollSlash = false } = {}) {
    // chained from the previous attack's cancel window: next step; otherwise (or after A3) A1
    const chained = this.action === 'attack' && this.combo > 0 && this.combo < 3;
    const step = chained ? this.combo + 1 : 1;
    this._begin('attack');
    this.combo = step;
    this.swings++;
    const S = this.comboSteps[step - 1];
    this._mouse = mouse;
    this._windedAction = this.winded;
    this._spend(S.sp);
    this._lungeExtra = rollSlash ? ROLL.rollSlashLunge : 0;
    this._swingI = 1 - this._swingI;
    const sw = this._swings[this._swingI];
    sw.tag = this.sys.tags.next();
    sw.mp = 0;
    this._swing = sw;
    this._aimAttack(true);
    this._runFrame();
  }

  /**
   * Aim + magnet at f0 (re-evaluated at f1, f2); move input can still turn the swing.
   * @param {boolean} first f0 (the lunge is set; later: only before the lunge starts)
   */
  _aimAttack(first) {
    const S = this.comboSteps[this.combo - 1];
    const sys = this.sys;
    const aim = sys.targeting.aimDir(this._mouse, this._aim);
    let dx = aim.x;
    let dz = aim.z;
    let lunge = S.lunge + this._lungeExtra;
    const tgt = sys.targeting.soft(dx, dz, false);
    if (tgt) {
      const p = this.player.position;
      const tx = tgt.position.x - p.x;
      const tz = tgt.position.z - p.z;
      const d = Math.hypot(tx, tz);
      if (d <= MAGNET.range && d > 1e-4) {
        // snap toward it (at most 60° off the aim) and reach it
        const a0 = Math.atan2(dz, dx);
        let da = Math.atan2(tz, tx) - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const lim = MAGNET.maxTurnDeg * DEG;
        const a = a0 + Math.max(-lim, Math.min(lim, da));
        dx = Math.cos(a);
        dz = Math.sin(a);
        lunge = Math.max(0, Math.min(d - (tgt.radius + MAGNET.reach), lunge + MAGNET.extra));
      }
    }
    this._setFacing(dx, dz);
    if (first || this.frame < S.lungeFrames[0]) this._lunge = lunge;
  }

  _frameAttack() {
    const S = this.comboSteps[this.combo - 1];
    const f = this.frame;
    if (f >= S.total) { this._finish(); return; }
    if ((this._at(1) || this._at(2)) && f <= FACING_FIX_FRAMES) this._aimAttack(false);
    // pose
    for (const [a, b, pose] of S.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    // lunge (ease-out over its frames)
    const [l0, l1] = S.lungeFrames;
    this._moveAlong(this._lunge, l0, l1 + 1, this.player.facing.x, this.player.facing.z);
    // effects at the swing
    const sys = this.sys;
    const p = this.player.position;
    const fx = this.player.facing;
    if (this.sword && this._at(0)) this.look?.windup(S);
    else if (this.bell && this._at(0)) this.bellLook?.windup(S);
    if (this._at(S.fxAt)) {
      sys.sfxAt(S.sfx, p.x, p.z, { volume: 0.8 });
      if (this.sword) this.look?.swing(S);
      else if (this.bell) this.bellLook?.swing(S);
      else if (S.finisher) {
        sys.fx.play('thrust', p.x + fx.x * 0.9, p.y, p.z + fx.z * 0.9, { dirX: fx.x, dirZ: fx.z });
        sys.fx.play('slashBig', p.x + fx.x * 0.5, p.y, p.z + fx.z * 0.5, { dirX: fx.x, dirZ: fx.z });
      } else {
        sys.fx.play('slash', p.x + fx.x * 0.55, p.y, p.z + fx.z * 0.55, { dirX: fx.x, dirZ: fx.z, flip: S.flip });
      }
    }
    // hitboxes in the active window
    if (f >= S.active[0] && f <= S.active[1]) {
      const meta = this.comboMeta[this.combo - 1];
      for (const shape of S.hits) {
        const s = this._baseSpec(this._swing.tag, S.mv, S.kb, S.poise);
        // (the hammer's blows leave a resonance mark: EVERMERE_CAMPAIGN.md §5.5)
        if (this.bell) s.mark = this.bell.M.BELL_MARKS.perHit;
        s.shape = shape.shape;
        if (shape.shape === 'lane') {
          s.len = shape.len;
          s.width = shape.width;
        } else {
          s.r = shape.r;
          s.halfAngle = shape.halfAngle;
        }
        sys.addPlayerHit(s, meta, this._swing);
      }
      // the bellwarden's: the slam's ring, the planted bell struck, the marks' tag (its kit)
      if (this.bell) this.bell.swing(S, f, this._swing, meta);
    }
  }

  /**
   * A player HitSpec at the player's feet along the facing (reused object; the queue copies it).
   * @param {number} tag
   * @param {number} mv
   * @param {number} kb
   * @param {number} poise
   * @returns {HitSpec}
   */
  _baseSpec(tag, mv, kb, poise) {
    const s = this._spec;
    const p = this.player.position;
    s.shape = 'circle';
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.r = 1;
    s.rInner = 0;
    s.dirX = this.player.facing.x;
    s.dirZ = this.player.facing.z;
    s.halfAngle = 60;
    s.len = 1;
    s.width = 1;
    s.dy = MELEE_DY;
    s.mv = mv;
    s.kb = kb;
    s.poise = poise;
    s.knockdown = false;
    s.flat = 0;
    s.thin = false;
    s.tag = tag;
    s.fromX = p.x;
    s.fromZ = p.z;
    s.mark = 0;
    return s;
  }

  /**
   * A melee hit landed: +2 MP (max +4 per swing, dummies count).
   * @param {SwingRecord|null} swing
   */
  onMeleeLanded(swing) {
    if (!swing || swing.mp >= MP_PER_SWING_MAX) return;
    const gain = Math.min(MP_PER_HIT, MP_PER_SWING_MAX - swing.mp);
    swing.mp += gain;
    this.mp = Math.min(this.mpMax, this.mp + gain);
  }

  // ------------------------------------------------------------------------------------------
  // Dodge roll / backstep (§6.5)
  // ------------------------------------------------------------------------------------------

  /** @param {boolean} mouse */
  _startDodge(mouse) {
    const sys = this.sys;
    const m = sys.moveWorld(this._tmp);
    let dx = 0;
    let dz = 0;
    let roll = false;
    if (m > 0.2) {
      dx = this._tmp.x;
      dz = this._tmp.z;
      roll = true;
    } else if ((mouse || sys.aimOverride) && sys.aimPoint(this._tmp)) {
      const p = this.player.position;
      const ax = this._tmp.x - p.x;
      const az = this._tmp.z - p.z;
      const d = Math.hypot(ax, az);
      if (d > 0.8) { dx = ax / d; dz = az / d; roll = true; }
    }
    this._begin(roll ? 'roll' : 'backstep');
    this.combo = 0;
    const M = roll ? ROLL : BACKSTEP;
    this._spend(roll ? SP_COST.roll : SP_COST.backstep);
    if (roll) this._setFacing(dx, dz);
    const f = this.player.facing;
    // a backstep moves opposite the facing (the facing stays)
    const mx = roll ? dx : -f.x;
    const mz = roll ? dz : -f.z;
    this._motion = { dist: M.dist, f0: 0, f1: M.moveFrames + 1, dx: mx, dz: mz, done: 0 };
    const p = this.player.position;
    sys.burst('footstep', p.x, p.y + 0.05, p.z, 6);
    sys.sfxAt('dodge', p.x, p.z, { volume: 0.7 });
    sys.tutorial.dodge = true;
    this._runFrame();
  }

  _frameDodge() {
    const M = this.action === 'roll' ? ROLL : BACKSTEP;
    const f = this.frame;
    if (f >= M.total) { this._finish(); return; }
    for (const [a, b, pose] of M.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz);
  }

  /**
   * An enemy hitbox or projectile overlapped the invulnerable player: a perfect dodge when it
   * happens in f1–8 of a roll or backstep (once per 3 s).
   * @returns {boolean} it counted
   */
  notePerfectDodge() {
    if (!this.dodging || this.perfectCd > 0) return false;
    const w = (this.action === 'roll' ? ROLL : BACKSTEP).perfect;
    if (this.frame < w[0] || this.frame > w[1]) return false;
    this.perfectCd = PERFECT.cooldown;
    this.perfectDodges++;
    // invulnerable while the enemy slow motion lasts: the slowed attack that was dodged (a wave of
    // rings, a leap still in the air) must not catch the player after the roll's own i-frames
    this.iframes = Math.max(this.iframes, PERFECT.time);
    this.sp = Math.min(SP_MAX, this.sp + PERFECT.sp);
    this.mp = Math.min(this.mpMax, this.mp + PERFECT.mp);
    this.sys.onPerfectDodge();
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Skills (§6.6)
  // ------------------------------------------------------------------------------------------

  /**
   * Skill slot i: locked, cooling down or unaffordable → refused (slot shake, SFX cancel).
   * @param {number} i
   * @param {boolean} mouse
   * @returns {boolean} started
   */
  _trySkill(i, mouse) {
    const K = this.skills[i];
    const sys = this.sys;
    if (this.level < K.unlock || this.cooldowns[i] > 0 || this.mp < K.mp - EPS) {
      sys.refuseSkill(i);
      return false;
    }
    this._begin(K.id);
    this.combo = 0;
    this.mp -= K.mp;
    this.cooldowns[i] = K.cooldown;
    this._mouse = mouse;
    const aim = sys.targeting.aimDir(mouse, this._aim);
    this._setFacing(aim.x, aim.z);
    this._tagA = sys.tags.next();
    this._tagB = sys.tags.next();
    if (this.sword || this.bell) this._tagC = sys.tags.next();
    if (K.id === 'skill1') this._armor = true;
    if (K.id === 'skill2') {
      // auto-aim: a soft target in the ±45° cone up to 12 u
      this._boltTarget = sys.targeting.soft(aim.x, aim.z, true);
      if (this._boltTarget) {
        const p = this.player.position;
        const tx = this._boltTarget.position.x - p.x;
        const tz = this._boltTarget.position.z - p.z;
        const d = Math.hypot(tx, tz);
        if (d > 1e-4) this._setFacing(tx / d, tz / d);
      }
    }
    // (the bellwarden's skills: their own aim, armour and state — its kit)
    if (this.bell) this.bell.begin(i);
    this._runFrame();
    return true;
  }

  _frameWhirl() {
    const f = this.frame;
    if (f >= WHIRL.total) { this._finish(); return; }
    this._pose(WHIRL.pose);
    this._armor = f <= WHIRL.armor;
    const sys = this.sys;
    const p = this.player.position;
    if (this._at(3)) sys.sfxAt('whirl', p.x, p.z, { volume: 0.9 });
    if (this._at(5)) sys.fx.play('spin', p.x, p.y, p.z, { follow: p });
    const [a0, a1] = WHIRL.hits[0];
    const [b0, b1] = WHIRL.hits[1];
    const tag = f >= a0 && f <= a1 ? this._tagA : f >= b0 && f <= b1 ? this._tagB : null;
    if (tag) {
      const s = this._baseSpec(tag, WHIRL.mv, WHIRL.kb, WHIRL.poise);
      s.shape = 'circle';
      s.r = WHIRL.r;
      sys.addPlayerHit(s, META.whirl, null);
    }
  }

  _frameBolt() {
    const f = this.frame;
    if (f >= BOLT.total) { this._finish(); return; }
    this._pose(BOLT.pose);
    if (this._at(BOLT.release)) {
      const sys = this.sys;
      const p = this.player.position;
      const fx = this.player.facing;
      const s = this._proj;
      s.x = p.x + fx.x * 0.4;
      s.z = p.z + fx.z * 0.4;
      s.y = p.y + SHOT_Y;
      const t = this._boltTarget;
      if (t && t.alive) {
        const dx = t.position.x - s.x;
        const dz = t.position.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-3) {
          s.dirX = dx / d;
          s.dirZ = dz / d;
          this._setFacing(s.dirX, s.dirZ);
        }
        const b = t.def.body;
        s.vy = aimVy(s.y, sys.bodyBase(t) + (b[0] + b[1]) / 2, BOLT.speed, d);
      } else {
        s.dirX = fx.x;
        s.dirZ = fx.z;
        s.vy = 0;
      }
      sys.spawnProjectile('player', s);
      sys.sfxAt('bolt', p.x, p.z, { volume: 0.85 });
    }
  }

  _frameNova() {
    const f = this.frame;
    if (f >= NOVA.total) { this._finish(); return; }
    for (const [a, b, pose] of NOVA.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    const sys = this.sys;
    const p = this.player.position;
    // the gold ring grows r 0 → 3.2 over f0–20, its fill fading as it grows; at the burst only
    // the outer band is left (a full disc hung over the hit-stop as a flat cream decal)
    if (f <= NOVA.grow) {
      if (this._novaMarker === undefined || this._novaMarker < 0) this._novaMarker = sys.markerAllocCore();
      if (this._novaMarker >= 0) {
        const m = sys._markerSpec;
        const k = Math.min(1, this.t / F(NOVA.grow));
        const burst = k >= 1 - 1e-6;
        m.shape = burst ? 'ring' : 'circle';
        m.x = p.x;
        m.z = p.z;
        m.r = Math.max(0.05, NOVA.r * k);
        m.rInner = burst ? NOVA.r - 0.45 : 0;
        m.progress = k;
        m.style = 'player';
        m.alpha = 1 - 0.45 * k * k;
        sys.markerSetCore(this._novaMarker, m);
      }
    } else this._freeNovaMarker();
    if (this._at(2)) sys.sfxAt('nova', p.x, p.z, { volume: 0.5, pitch: 0.8 });
    if (this._at(NOVA.at)) {
      const s = this._baseSpec(this._tagA, NOVA.mv, NOVA.kb, NOVA.poise);
      s.shape = 'circle';
      s.r = NOVA.r;
      s.knockdown = true;
      sys.addPlayerHit(s, META.nova, null);
      sys.burst('magicBurst', p.x, p.y + 0.8, p.z, 24);
      sys.shake(SHAKE.nova[0], SHAKE.nova[1]);
      sys.sfxAt('nova', p.x, p.z, { volume: 1 });
    }
  }

  _freeNovaMarker() {
    if (this._novaMarker !== undefined && this._novaMarker >= 0) this.sys.markerFreeCore(this._novaMarker);
    this._novaMarker = -1;
  }

  // ------------------------------------------------------------------------------------------
  // The swordmaster (DRAGON_CAMPAIGN.md §6.8): the combo's wind blades and three skills — their
  // look is `look`'s (SwordmasterFx.js), called at the moves' moments
  // ------------------------------------------------------------------------------------------

  /**
   * Tempest Edge (`TEMPEST`): the body spins in quarter turns, spectral blades (`TEMPEST.blades`) open round the
   * player inside a storm ring, three hits (radial knockback; the last one heavier), super armour,
   * a slow drift with move input; the blades fly outward at `release`.
   */
  _frameTempest() {
    const T = TEMPEST;
    const f = this.frame;
    const sys = this.sys;
    const p = this.player.position;
    if (this._at(0)) {
      this._baseX = this.player.facing.x;
      this._baseZ = this.player.facing.z;
      this.look?.tempest('start');
    }
    if (f >= T.total) {
      this._setFacing(this._baseX, this._baseZ);
      this._finish();
      return;
    }
    // the spin: a quarter turn every spinStep frames, the way the blades go round
    const spinning = f >= T.spinFrom && f <= T.spinTo;
    if (spinning) {
      const k = Math.floor((f - T.spinFrom) / T.spinStep) + 1;
      const a = Math.atan2(this._baseZ, this._baseX) + k * (Math.PI / 2);
      this._setFacing(Math.cos(a), Math.sin(a));
    } else if (f > T.spinTo) this._setFacing(this._baseX, this._baseZ);
    for (const [a, b, pose] of T.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    this._armor = f <= T.armor;
    if (spinning && this._stepDt > 0) {
      const m = sys.moveWorld(this._tmp);
      if (m > 0.2) {
        const d = T.drift * m * this._stepDt;
        this.player.moveBy(this._tmp.x * d, this._tmp.z * d);
      }
    }
    if (this._at(1)) {
      sys.sfxAt('bladeStorm', p.x, p.z, { volume: 1 });
      this.look?.tempest('wind');
    }
    if (this._at(T.bladesAt)) this.look?.tempest('blades');
    if (spinning && (f - T.spinFrom) % 4 === 0 && this._prevFrame < f) this.look?.tempest('spin');
    if (this._at(T.release)) {
      this.look?.tempest('release');
      sys.sfxAt('dodge', p.x, p.z, { volume: 0.7, pitch: 1.25 });
    }
    for (let i = 0; i < 3; i++) {
      const [h0, h1] = T.hits[i];
      if (this._at(h0)) {
        const last = i === 2;
        sys.sfxAt(last ? 'swingHeavy' : 'whirl', p.x, p.z, { volume: 0.9, pitch: last ? 1 : 1.05 + 0.1 * i });
        this.look?.tempest('hit', i);
        const sh = last ? SHAKE.finisher : SHAKE.hit;
        sys.shake(sh[0], sh[1]);
      }
      if (f >= h0 && f <= h1) {
        const s = this._baseSpec(i === 0 ? this._tagA : i === 1 ? this._tagB : this._tagC, T.mv[i], T.kb[i], T.poise[i]);
        s.shape = 'circle';
        s.r = T.r;
        sys.addPlayerHit(s, i === 2 ? META.tempestEnd : META.tempest, null);
      }
    }
  }

  /**
   * Dragonfang Wave (`DRAGONFANG`): a wind-up, a short lunge and a great swing that releases the
   * wave at `release` (aimed again at the soft target `_trySkill` chose, like Ember Bolt).
   */
  _frameFang() {
    const D = DRAGONFANG;
    const f = this.frame;
    if (f >= D.total) { this._finish(); return; }
    for (const [a, b, pose] of D.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    const sys = this.sys;
    const p = this.player.position;
    const fx = this.player.facing;
    this._moveAlong(D.lunge, D.lungeFrames[0], D.lungeFrames[1] + 1, fx.x, fx.z);
    if (this._at(2)) {
      sys.sfxAt('dodge', p.x, p.z, { volume: 0.6, pitch: 0.75 });
      this.look?.fang('windup');
    }
    if (this._at(D.release)) this._releaseWave();
  }

  /** The wave leaves the blade: its record (its look: the swing's arc, the crescent, its crest). */
  _releaseWave() {
    const sys = this.sys;
    const p = this.player.position;
    const tgt = this._boltTarget;
    if (tgt && tgt.alive) {
      const dx = tgt.position.x - p.x;
      const dz = tgt.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) this._setFacing(dx / d, dz / d);
    }
    const fx = this.player.facing;
    const W = this._wave;
    W.alive = true;
    W.x = p.x + fx.x * 0.6;
    W.z = p.z + fx.z * 0.6;
    W.y = sys.groundAt(W.x, W.z);
    if (Math.abs(W.y - p.y) > DRAGONFANG.wall) W.y = p.y;
    W.dirX = fx.x;
    W.dirZ = fx.z;
    W.d = 0;
    W.dust = 0.4;
    W.tag = this._tagA;
    sys.sfxAt('swordWave', p.x, p.z, { volume: 1 });
    sys.shake(SHAKE.finisher[0], SHAKE.finisher[1]);
    this.look?.fang('release');
  }

  /**
   * One sub-step of the wave in flight (player time): the front runs on over the ground; the lane it
   * swept this sub-step is a hit (one tag: a foe is hit once); a rise above `wall` or a drop below
   * `drop` breaks it there.
   * @param {number} h
   */
  _stepWave(h) {
    const D = DRAGONFANG;
    const W = this._wave;
    const sys = this.sys;
    const adv = Math.min(D.speed * h, D.range - W.d);
    const nx = W.x + W.dirX * adv;
    const nz = W.z + W.dirZ * adv;
    const g = sys.groundAt(nx, nz);
    if (!(g <= W.y + D.wall && g >= W.y - D.drop)) {
      this._endWave(true);
      return;
    }
    const s = this._baseSpec(W.tag, D.mv, D.kb, D.poise);
    s.shape = 'lane';
    s.x = W.x - W.dirX * 0.4;
    s.z = W.z - W.dirZ * 0.4;
    s.y = W.y;
    s.dirX = W.dirX;
    s.dirZ = W.dirZ;
    s.len = adv + 0.8;
    s.width = D.width;
    // pushed on along the lane (and out to its sides)
    s.fromX = s.x - W.dirX * 2;
    s.fromZ = s.z - W.dirZ * 2;
    sys.addPlayerHit(s, META.fang, null);
    W.x = nx;
    W.z = nz;
    W.y = g;
    W.d += adv;
    if (W.d >= W.dust) {
      W.dust += 0.8;
      this.look?.waveBeat(W);
    }
    if (W.d >= D.range - 1e-6) this._endWave(false);
  }

  /**
   * The wave is spent (its range run) or broken on a wall / a drop (`wall`): its quads fade.
   * @param {boolean} wall
   */
  _endWave(wall) {
    const W = this._wave;
    W.alive = false;
    this.look?.waveEnd(W, wall);
    if (wall) this.sys.sfxAt('wallHit', W.x, W.z, { volume: 0.7 });
  }

  /**
   * Skyfall Judgement (`SKYFALL`): the leap is aimed at f0 (`_aimLeap`); a crouch, the arc (the
   * sprite and its sun shadow lifted, `_setLift`), the sword raised to the sky while the spectral
   * sword falls on the landing point, the slam at `land` (`_skyfallImpact`).
   */
  _frameSkyfall() {
    const S = SKYFALL;
    const sys = this.sys;
    const p = this.player.position;
    if (this._at(0)) this._aimLeap();
    const f = this.frame;
    if (f >= S.total) { this._finish(); return; }
    for (const [a, b, pose] of S.poses) if (f >= a && f <= b) { this._pose(pose); break; }
    // the leap: carried along the aim (walls stop it: the landing point follows the player)
    const before = this._moved;
    const bx = p.x;
    const bz = p.z;
    this._moveAlong(this._leap, S.rise, S.land, this._leapX, this._leapZ);
    const want = this._moved - before;
    if (want > 1e-4 && Math.hypot(p.x - bx, p.z - bz) < want * 0.5) this._leap = this._moved;
    if (f < S.land) {
      const L = this._land;
      const rest = Math.max(0, this._leap - this._moved);
      L.x = p.x + this._leapX * rest;
      L.z = p.z + this._leapZ * rest;
      L.y = sys.groundAt(L.x, L.z);
    }
    // the arc: up fast, a hang at the top, down accelerating
    const u = (this.t - F(S.rise)) / (F(S.land) - F(S.rise));
    let lift = 0;
    if (u > 0 && u < 1) lift = u < 0.55 ? S.height * Math.sin((Math.PI / 2) * (u / 0.55)) : S.height * (1 - ((u - 0.55) / 0.45) ** 2);
    this._setLift(lift);
    if (this._at(1)) {
      sys.sfxAt('dodge', p.x, p.z, { volume: 0.6, pitch: 0.7 });
      this.look?.skyfall('crouch');
    }
    if (this._at(S.rise)) {
      sys.sfxAt('swingHeavy', p.x, p.z, { volume: 0.7, pitch: 0.8 });
      this.look?.skyfall('leap');
    }
    if (this._at(S.swordAt)) this.look?.skyfall('sword');
    if (this._at(S.land)) this._skyfallImpact();
  }

  /** Skyfall's aim: a soft target within `reach` (the bolt cone) draws the leap, else `forward`. */
  _aimLeap() {
    const S = SKYFALL;
    const p = this.player.position;
    const fx = this.player.facing;
    let dirX = fx.x;
    let dirZ = fx.z;
    /** @type {number} */
    let dist = S.forward;
    const tgt = this.sys.targeting.soft(fx.x, fx.z, true);
    if (tgt) {
      const dx = tgt.position.x - p.x;
      const dz = tgt.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= S.reach + tgt.radius && d > 1e-3) {
        dirX = dx / d;
        dirZ = dz / d;
        dist = Math.max(0, Math.min(S.leapMax, d - (tgt.radius + S.gap)));
        this._setFacing(dirX, dirZ);
      }
    }
    this._leap = dist;
    this._leapX = dirX;
    this._leapZ = dirZ;
    const L = this._land;
    L.x = p.x + dirX * dist;
    L.z = p.z + dirZ * dist;
    L.y = this.sys.groundAt(L.x, L.z);
  }

  /** The slam: the hit, shake, sound and the gold ground rings (its look: `look.skyfall('impact')`). */
  _skyfallImpact() {
    const S = SKYFALL;
    const sys = this.sys;
    const p = this.player.position;
    const s = this._baseSpec(this._tagA, S.mv, S.kb, S.poise);
    s.shape = 'circle';
    s.r = S.r;
    s.knockdown = true;
    sys.addPlayerHit(s, META.skyfall, null);
    sys.shake(S.shake[0], S.shake[1]);
    sys.sfxAt('skyfall', p.x, p.z, { volume: 1 });
    sys.sfxAt('quake', p.x, p.z, { volume: 0.6 });
    this.look?.skyfall('impact');
    this._ringAt(0, p.x, p.z, 0, 0.42, 0.6, S.r + 1.2, 0.55);
    this._ringAt(1, p.x, p.z, 0.1, 0.5, 0.4, S.r, 0.35);
  }

  /**
   * Start Skyfall's shock ring `i` (a core-owned gold GroundMarkers ring, `_updateRings`).
   * @param {number} i
   * @param {number} x
   * @param {number} z
   * @param {number} delay seconds
   * @param {number} dur seconds
   * @param {number} r0
   * @param {number} r1
   * @param {number} w band width
   */
  _ringAt(i, x, z, delay, dur, r0, r1, w) {
    const R = this._rings[i];
    if (R.id < 0) R.id = this.sys.markerAllocCore();
    Object.assign(R, { t: 0, x, z, delay, dur, r0, r1, w });
    this._updateRings(0);
  }

  /** @param {number} dt combat seconds */
  _updateRings(dt) {
    const sys = this.sys;
    const m = this._ringSpec;
    const night = globalUniforms.uNight.value;
    const sy = (globalUniforms.uSunDirection.value.y - RING_LOW_SUN.lo) / (RING_LOW_SUN.hi - RING_LOW_SUN.lo);
    const low = 1 - (sy <= 0 ? 0 : sy >= 1 ? 1 : sy * sy * (3 - 2 * sy));
    const dim = (1 - RING_NIGHT_DIM * night) * (1 - RING_LOW_SUN.dim * low * (1 - night));
    for (const R of this._rings) {
      if (R.id < 0) continue;
      R.t += dt;
      const u = (R.t - R.delay) / R.dur;
      if (u >= 1) {
        sys.markerFreeCore(R.id);
        R.id = -1;
        continue;
      }
      const k = Math.max(0, u);
      const r = R.r0 + (R.r1 - R.r0) * ease(k);
      m.x = R.x;
      m.z = R.z;
      m.r = r;
      m.rInner = Math.max(0, r - R.w);
      // (dimmer after dark — the night's exposure would turn the gold rim white — and under a low sun)
      m.alpha = (u < 0 ? 0 : 1 - k * k) * dim;
      sys.markerSetCore(R.id, m);
    }
  }

  /**
   * Lift the sprite (and its sun shadow, as fliers' are) above the feet; the contact blob stays.
   * @param {number} y
   */
  _setLift(y) {
    this._lift = y;
    const s = this.sprite;
    if (!s) return;
    s.mesh.position.y = y;
    s.shadowProxy.position.y = y;
  }

  /** The swordmaster's effects, wave and rings gone (reset, revive): its look too (swords, lights). */
  _clearHeroFx() {
    this._wave.alive = false;
    this._wave.d = 0;
    this.look?.clear();
    this.bell?.clear();
    this.bellLook?.clear();
    this.hfx?.clear();
    for (const R of this._rings) {
      if (R.id >= 0) this.sys.markerFreeCore(R.id);
      R.id = -1;
    }
    if (this._lift !== 0) this._setLift(0);
  }

  // ------------------------------------------------------------------------------------------
  // Healing Draught (§6.7)
  // ------------------------------------------------------------------------------------------

  /** @returns {boolean} started */
  _tryDraught() {
    const sys = this.sys;
    if (this.draughtCd > 0 || this.potions <= 0) {
      sys.refuseSkill(3);
      return false;
    }
    if (this.hp >= this.hpMax) {
      sys.ui.hud.toast(t('combat.draught.full'), 1.6);
      sys.audio.playSfx('cancel', { volume: 0.5 });
      return false;
    }
    this._begin('draught');
    this.combo = 0;
    this._consumed = false;
    this._runFrame();
    return true;
  }

  _frameDraught() {
    const f = this.frame;
    if (f >= DRAUGHT.total) {
      this.draughtCd = DRAUGHT.cooldown;
      this._finish();
      return;
    }
    this._pose(DRAUGHT.pose);
    if (this._at(DRAUGHT.at) && !this._consumed) {
      this._consumed = true;
      this.potions = Math.max(0, this.potions - 1);
      const amount = Math.round(this.hpMax * DRAUGHT_HEAL);
      this.heal(amount);
      const sys = this.sys;
      const p = this.player.position;
      sys.burst('healGlow', p.x, p.y + 0.9, p.z, 12);
      sys.sfxAt('drink', p.x, p.z, { volume: 0.8 });
      this.look?.draught();
      this.bellLook?.draught();
    }
  }

  /**
   * Heal (capped) with a green number.
   * @param {number} amount
   * @returns {number} HP gained
   */
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.hpMax, this.hp + amount);
    const got = Math.round(this.hp - before);
    const p = this.player.position;
    if (got > 0) this.sys.number(p.x, p.y + 1.9, p.z, `+${got}`, 'heal');
    return got;
  }

  // ------------------------------------------------------------------------------------------
  // Getting hit (§6.8)
  // ------------------------------------------------------------------------------------------

  /** Can an enemy hit connect now (else it is ignored: i-frames, dead)? */
  get hittable() { return this.alive && !this.invulnerable; }

  /**
   * A damaging enemy hit (core computed `damage`; the player is hittable).
   * @param {{ damage: number, kb: number, kbDirX: number, kbDirZ: number, knockdown: boolean }} info
   * @returns {'hurt'|'knockdown'|'armor'|'dead'}
   */
  hurt(info) {
    this.hp = Math.max(0, this.hp - info.damage);
    this.flashT = PLAYER_FLASH.time;
    if (this.hp <= 0) {
      this.die();
      return 'dead';
    }
    if (this._armor) return 'armor';
    const down = info.knockdown || info.kb >= KNOCKDOWN.kb;
    const kb = Math.min(KB_CAP, info.kb);
    this._begin(down ? 'knockdown' : 'hitstun');
    this.combo = 0;
    this._motion = { dist: kb, f0: 0, f1: down ? KNOCKDOWN.slide : HITSTUN.slide, dx: info.kbDirX, dz: info.kbDirZ, done: 0 };
    // face the hit
    if (Math.hypot(info.kbDirX, info.kbDirZ) > 1e-3) this._setFacing(-info.kbDirX, -info.kbDirZ);
    this._runFrame();
    return down ? 'knockdown' : 'hurt';
  }

  /**
   * A push without damage (the boss's phase-2 ring, `mv` 0): the hit-stun slide only — no HP, no
   * flash, no knockdown.
   * @param {number} kb
   * @param {number} dirX
   * @param {number} dirZ
   */
  shove(kb, dirX, dirZ) {
    if (!this.alive || this._armor) return;
    this._begin('hitstun');
    this.combo = 0;
    this._motion = { dist: Math.min(KB_CAP, kb), f0: 0, f1: HITSTUN.slide, dx: dirX, dz: dirZ, done: 0 };
    if (Math.hypot(dirX, dirZ) > 1e-3) this._setFacing(-dirX, -dirZ);
    this._runFrame();
  }

  /**
   * Flat damage (magma): HP and the flash only — no reaction, no i-frames.
   * @param {number} damage
   */
  hurtFlat(damage) {
    this.hp = Math.max(0, this.hp - damage);
    this.flashT = PLAYER_FLASH.time;
    if (this.hp <= 0) this.die();
  }

  _frameHitstun() {
    const f = this.frame;
    if (f >= HITSTUN.total) {
      this.iframes = F(HITSTUN.iframes);
      this.blink = true;
      this._finish();
      return;
    }
    this._pose(HITSTUN.pose);
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz);
  }

  _frameKnockdown() {
    const f = this.frame;
    const total = KNOCKDOWN.down + KNOCKDOWN.getUp;
    if (f >= total) {
      this.iframes = F(KNOCKDOWN.iframesAfter);
      this.blink = true;
      this._finish();
      return;
    }
    this._pose(f < KNOCKDOWN.down ? 'down' : 'tuck');
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz);
  }

  // ------------------------------------------------------------------------------------------
  // Death, respawn, progression
  // ------------------------------------------------------------------------------------------

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this._endAction();
    this._begin('dead');
    this.combo = 0;
    this.deaths++;
    this._pose('down');
    this.sys.onPlayerDeath();
  }

  /** Back on the feet (the death reset): full resources, draughts ≥ 2, cooldowns 0. */
  revive() {
    this.alive = true;
    this._endAction();
    this.combo = 0;
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.sp = SP_MAX;
    this.winded = false;
    this.spDelay = 0;
    this.potions = Math.max(2, this.potions);
    this.cooldowns[0] = this.cooldowns[1] = this.cooldowns[2] = 0;
    this.draughtCd = 0;
    this.flashT = 0;
    this._clearHeroFx();
  }

  /** Full HP / MP / SP (rest, level-up). */
  refill() {
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.sp = SP_MAX;
    this.winded = false;
  }

  /**
   * Gain XP; level-ups announce the final level only (with every gain summed).
   * @param {number} xp
   */
  gainXp(xp) {
    if (!(xp > 0)) return;
    this.xp += xp;
    const from = this.level;
    while (this.level < LEVEL_CAP && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
    }
    if (this.level > from) this._levelUp(from);
  }

  /**
   * @param {number} from the level before
   */
  _levelUp(from) {
    const n = this.level - from;
    this.refill();
    this.invulnT = Math.max(this.invulnT, LEVELUP_INVULN);
    // the card's line in the page's language (the skills' names by id: rules.js stays English)
    const parts = [t('combat.gain.maxHp', { n: PER_LEVEL.hp * n }), t('combat.gain.atk', { n: PER_LEVEL.atk * n })];
    for (const K of this.skills) if (K.unlock > from && K.unlock <= this.level) parts.push(t('combat.gain.learned', { skill: t(`combat.skill.${K.str}`) }));
    this.sys.onLevelUp(this.level, parts.join(sep()));
  }

  /**
   * Apply an upgrade (chest / boss core / shop ware).
   * @param {'maxHp'|'maxMp'|'attack'|'core'|'def'} kind
   * @param {number} [amount] the amount (default: the chest's, `UPGRADES`; `def` has none)
   */
  upgrade(kind, amount = null) {
    if (kind === 'core' || kind === 'maxHp') {
      const add = amount ?? (kind === 'core' ? UPGRADES.core : UPGRADES.maxHp);
      this.upgrades.maxHp += add;
      this.hp += add;
    } else if (kind === 'maxMp') {
      const add = amount ?? UPGRADES.maxMp;
      this.upgrades.maxMp += add;
      this.mp += add;
    } else if (kind === 'attack') this.upgrades.attack += amount ?? UPGRADES.attack;
    else if (kind === 'def') this.upgrades.def += amount ?? 0;
  }

  // ------------------------------------------------------------------------------------------
  // Helpers: facing, poses, displacement, visuals
  // ------------------------------------------------------------------------------------------

  /** @param {number} dx @param {number} dz */
  _setFacing(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    this.player.facing.set(dx / len, 0, dz / len);
  }

  /**
   * Show a combat pose in the row of the facing (seen from the camera yaw).
   * @param {string} name a column of the player sheet
   */
  _pose(name) {
    const s = this.sprite;
    const col = this.sheet.poses?.[name] ?? 0;
    const f = this.player.facing;
    const dir = Sprite3D.directionFromVector(f.x, f.z, globalUniforms.uCameraYaw.value, s.direction);
    const row = Math.max(0, DIRECTIONS.indexOf(dir));
    if (col === this._lastCol && row === this._lastRow && s.animation === null) return;
    s.direction = dir;
    s.setFrame(col, row);
    this._lastCol = col;
    this._lastRow = row;
  }

  /** Re-apply the pose row after a camera turn (per frame, while an action runs). */
  refreshPose() {
    if (!this.action || this._lastCol < 0) return;
    const s = this.sprite;
    const f = this.player.facing;
    const dir = Sprite3D.directionFromVector(f.x, f.z, globalUniforms.uCameraYaw.value, s.direction);
    const row = Math.max(0, DIRECTIONS.indexOf(dir));
    if (row !== this._lastRow) {
      s.direction = dir;
      s.setFrame(this._lastCol, row);
      this._lastRow = row;
    }
  }

  /**
   * Move a total of `dist` u along (dx, dz), eased out between frames f0 and f1 (exclusive), by
   * the part of the curve this sub-step covers (`player.moveBy`: walls stop it). One motion per
   * action (lunge, roll, knockback slide); `_moved` is reset when an action starts.
   * @param {number} dist
   * @param {number} f0
   * @param {number} f1
   * @param {number} dx
   * @param {number} dz
   */
  _moveAlong(dist, f0, f1, dx, dz) {
    if (!(dist > 0)) return;
    const t0 = F(f0);
    const t1 = F(f1);
    const u = Math.max(0, Math.min(1, (this.t - t0) / (t1 - t0)));
    const target = ease(u) * dist;
    const step = target - this._moved;
    this._moved = target;
    if (step > 1e-6) this.player.moveBy(dx * step, dz * step);
  }

  /**
   * Per-frame visuals: hurt flash (uFlash), i-frame blink (mesh.visible at 15 Hz; the shadow
   * stays), the row after camera turns; the swordmaster's look places its effects, then they and
   * the rings advance (they hold in hit-stop, like CombatFx's).
   * @param {number} dt combat seconds this frame (0 while paused / in hit-stop)
   * @param {number} [time] combat clock (blink phase)
   */
  _applyVisuals(dt, time = 0) {
    if (this.hfx) {
      this.look?.visuals(dt);
      this.bellLook?.visuals(dt);
      this.hfx.update(dt);
      this._updateRings(dt);
    }
    const s = this.sprite;
    if (!s) return;
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      s.setFlash(PLAYER_FLASH.r, PLAYER_FLASH.g, PLAYER_FLASH.b, PLAYER_FLASH.a);
    } else s.setFlash(0, 0, 0, 0);
    if (this.blink && this.iframes <= 0) this.blink = false;
    s.mesh.visible = !(this.blink && this.alive && Math.floor(time * BLINK_HZ * 2) % 2 === 1);
  }
}

// =============================================================================================
// HeroFx — the swordmaster's effects
// =============================================================================================

/**
 * A hero effect to spawn (`HeroFx#spawn`): only `frame` is required.
 * @typedef {object} HeroFxSpec
 * @property {'basic'|'orbit'|'fall'|'wave'} [kind] 'basic' (default) moves on its velocity;
 *   'orbit' circles its point (the radius opens r0 → r1 over `open` s and runs outward at `out` u/s
 *   from `release` s; the frame laid along the circle, its +U ahead); 'fall' drops from `height` u
 *   above its point onto it over `fall` s and stays; 'wave' rides the Dragonfang wave `wave`,
 *   `trail` u behind its front, along its direction
 * @property {string} frame an atlas frame (heroFx.js, or a base frame: `thrust`, `partySunburst` …)
 * @property {string} [tag] a name `fadeTag` finds it by ('': none)
 * @property {'flat'|'billboard'} [mode] ('flat')
 * @property {number} [x] position: the centre (absolute; with `follow`, that point plus the offsets)
 * @property {number} [y]
 * @property {number} [z]
 * @property {{ x: number, y: number, z: number }|null} [follow] a live point it is placed on
 * @property {number} [ox] offsets from `follow`
 * @property {number} [oy]
 * @property {number} [oz]
 * @property {number} [vx] velocity (u/s; 'basic')
 * @property {number} [vy]
 * @property {number} [vz]
 * @property {number} [dirX] the flat quad's +V axis ((0, 1))
 * @property {number} [dirZ]
 * @property {boolean} [flip] mirrored along U
 * @property {number} [life] seconds (0.3)
 * @property {boolean} [loop] the strip loops at `fps` (the frame's own rate by default)
 * @property {number} [fps]
 * @property {number} [strip] seconds the strip plays once over, then holds its last frame (0: the
 *   frame `index` throughout)
 * @property {number} [index] the frame (or the loop's first)
 * @property {number} [s0] scale at the start (1)
 * @property {number} [s1] scale reached after `grow` s (ease-out; default `s0`, `grow` the life)
 * @property {number} [grow]
 * @property {number} [rot] in-plane rotation (rad) and its speed (rad/s)
 * @property {number} [spin]
 * @property {readonly number[]} [color] linear HDR tint [r, g, b] (white)
 * @property {readonly number[]} [color1] the tint at the end of its life (lerped; default `color`)
 * @property {number} [a] peak opacity (1; below 1 the quad dithers)
 * @property {number} [fadeIn] seconds of fade-in and fade-out (0)
 * @property {number} [fadeOut]
 * @property {number} [back] u pushed away from the camera (a billboard behind the player it surrounds)
 * @property {number} [soft] FxQuads `soft` (0 … 1: a radial dither falloff, still cut-out)
 * @property {number} [halo] FxQuads `halo` (0 … 1: the additive glow round a bright quad, where a
 *   look stage made the batch's halo; only small lit layers ask)
 * @property {boolean} [live] written every frame even in a hit-stop (its owner moves it: `x`, `index`,
 *   the tint … changed between frames)
 * @property {number} [a0] orbit: start angle (rad, world XZ), angular speed (rad/s), radii,
 *   `open` / `release` (s) and outward speed `out` (u/s)
 * @property {number} [w]
 * @property {number} [r0]
 * @property {number} [r1]
 * @property {number} [open]
 * @property {number} [release]
 * @property {number} [out]
 * @property {number} [height] fall: the drop (u) and its seconds
 * @property {number} [fall]
 * @property {{ x: number, y: number, z: number, dirX: number, dirZ: number }|null} [wave] wave: the
 *   live wave record, and how far behind its front
 * @property {number} [trail]
 */

/** A live hero effect (pooled; `HeroFx`). @typedef {ReturnType<typeof blankHeroFx>} HeroFxLive */

/** A free hero-effect record. */
function blankHeroFx() {
  return {
    h: -1, id: 0, kind: 'basic', frame: '', tag: '', mode: 'flat', t: 0, life: 0.3, n: 1, fps: 12, loop: false, strip: 0, index: 0,
    x: 0, y: 0, z: 0, /** @type {{ x: number, y: number, z: number }|null} */ follow: null, ox: 0, oy: 0, oz: 0,
    vx: 0, vy: 0, vz: 0, dirX: 0, dirZ: 1, flip: false, s0: 1, s1: 1, grow: 0.3, rot: 0, spin: 0,
    cr0: 1, cg0: 1, cb0: 1, cr1: 1, cg1: 1, cb1: 1, a: 1, fadeIn: 0, fadeOut: 0, back: 0, soft: 0, halo: 0, live: false, settled: false,
    a0: 0, w: 0, rad0: 0, rad1: 0, open: 0.1, release: Infinity, out: 0, height: 0, fall: 0.3,
    /** @type {{ x: number, y: number, z: number, dirX: number, dirZ: number }|null} */ wave: null, trail: 0,
  };
}

/** The pool (measured peaks: Skyfall 12, a Fang wave chained into a Skyfall 17, the combo 8). */
const HFX_CAPACITY = 96;
/** How much the hero effects dim at full night (`uNight` 1: the exposure rises; as the ice look's). */
const HFX_NIGHT_DIM = 0.6;
/** A lit layer over its body: a hair above a flat quad (u), toward the camera for an upright one (`back`). */
const LIT_DY = 0.012;
const LIT_BACK = -0.03;
const WHITE = Object.freeze([1, 1, 1]);

/**
 * HeroFx — the swordmaster's quads in the combat FxQuads batch (one draw call with every other
 * combat effect; frames of heroFx.js and the rest of the atlas), spawned by its look
 * (SwordmasterFx.js). `spawn(spec)` starts one (`HeroFxSpec`) and returns its record (null: the pool
 * or the batch is full: dropped); `pair` a body and its lit layer; `update(dt)` once a frame on the
 * combat clock (they hold in hit-stop); `settle(dt, s)` fades them out on the frame's own time (a
 * story scene: the ambient step). Every `set` writes `soft` and `halo` (the params object is reused),
 * and every tint dims after dark (× 1 − 0.6 · uNight). A record is recycled once it dies: its owner
 * keeps its `id` (`alive(rec, id)`). Made by `PlayerCombat` for the swordmaster only.
 */
export class HeroFx {
  /**
   * @param {FxQuads} quads the combat batch
   * @param {Record<string, { n: number, fps: number }>} frames the atlas's frames
   * @param {{ viewX: number, viewZ: number }|null} view the camera's forward on XZ (CombatFx's,
   *   set every frame) for `back`
   */
  constructor(quads, frames, view) {
    this.quads = quads;
    this.frames = frames;
    this.view = view;
    /** @type {HeroFxLive[]} */
    this._live = [];
    /** @type {HeroFxLive[]} */
    this._pool = [];
    for (let i = 0; i < HFX_CAPACITY; i++) this._pool.push(blankHeroFx());
    /** @type {FxQuadParams} */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'flat', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1, flipX: false, soft: 0, halo: 0 };
    this._serial = 0;
    /** The tints' night factor now (`update`). */
    this._dim = 1;
    /** The wave's quads' share shown (a story scene veils them: `settle`; 1 again at `update`). */
    this._veil = 1;
  }

  /** Live effects. */
  get count() { return this._live.length; }

  /** The pool's size (tests). */
  get capacity() { return HFX_CAPACITY; }

  /**
   * Start an effect.
   * @param {HeroFxSpec} o
   * @returns {HeroFxLive|null} its record (null: the pool or the quad batch is full)
   */
  spawn(o) {
    if (!this._pool.length) return null;
    const h = this.quads.alloc();
    if (h < 0) return null;
    const e = /** @type {HeroFxLive} */ (this._pool.pop());
    const fr = Object.prototype.hasOwnProperty.call(this.frames, o.frame) ? this.frames[o.frame] : null;
    e.h = h;
    e.id = ++this._serial;
    e.kind = o.kind ?? 'basic';
    e.frame = o.frame;
    e.tag = o.tag ?? '';
    e.mode = o.mode ?? 'flat';
    e.t = 0;
    e.life = o.life ?? 0.3;
    e.n = Math.max(1, fr?.n ?? 1);
    e.fps = o.fps ?? (fr?.fps || 12);
    e.loop = !!o.loop;
    e.strip = o.strip ?? 0;
    e.index = o.index ?? 0;
    e.x = o.x ?? 0;
    e.y = o.y ?? 0;
    e.z = o.z ?? 0;
    e.follow = o.follow ?? null;
    e.ox = o.ox ?? 0;
    e.oy = o.oy ?? 0;
    e.oz = o.oz ?? 0;
    e.vx = o.vx ?? 0;
    e.vy = o.vy ?? 0;
    e.vz = o.vz ?? 0;
    e.dirX = o.dirX ?? 0;
    e.dirZ = o.dirZ ?? 1;
    e.flip = !!o.flip;
    e.s0 = o.s0 ?? 1;
    e.s1 = o.s1 ?? e.s0;
    e.grow = o.grow ?? e.life;
    e.rot = o.rot ?? 0;
    e.spin = o.spin ?? 0;
    const c0 = o.color ?? WHITE;
    const c1 = o.color1 ?? c0;
    e.cr0 = c0[0]; e.cg0 = c0[1]; e.cb0 = c0[2];
    e.cr1 = c1[0]; e.cg1 = c1[1]; e.cb1 = c1[2];
    e.a = o.a ?? 1;
    e.fadeIn = o.fadeIn ?? 0;
    e.fadeOut = o.fadeOut ?? 0;
    e.back = o.back ?? 0;
    e.soft = o.soft ?? 0;
    e.halo = o.halo ?? 0;
    e.live = !!o.live;
    e.settled = false;
    e.a0 = o.a0 ?? 0;
    e.w = o.w ?? 0;
    e.rad0 = o.r0 ?? 0;
    e.rad1 = o.r1 ?? e.rad0;
    e.open = o.open ?? 0.1;
    e.release = o.release ?? Infinity;
    e.out = o.out ?? 0;
    e.height = o.height ?? 0;
    e.fall = o.fall ?? 0.3;
    e.wave = o.wave ?? null;
    e.trail = o.trail ?? 0;
    this._live.push(e);
    this._write(e);
    return e;
  }

  /**
   * A body and its lit layer over it (COMBAT_VFX.md §6.6): `o` the body (under the halo's gate), the
   * lit layer the same effect with `frame`, `color` (its tint, above the gate) and `halo` 1 — a hair
   * above a flat body, toward the camera for an upright one. Returns the body's record (null: none).
   * @param {HeroFxSpec} o
   * @param {string} frame the lit layer's frame
   * @param {readonly number[]} color its tint
   * @param {number} [halo] its halo weight (1)
   * @returns {HeroFxLive|null}
   */
  pair(o, frame, color, halo = 1) {
    const body = this.spawn(o);
    if (!body) return null;
    const flat = (o.mode ?? 'flat') === 'flat';
    const lit = this.spawn({ ...o, frame, color, color1: undefined, halo });
    if (lit) {
      if (flat) lit.oy += LIT_DY;
      else lit.back += LIT_BACK;
      this._write(lit);
    }
    return body;
  }

  /**
   * Is `rec` still the effect it was when its id was `id` (alive, not recycled)?
   * @param {HeroFxLive|null} rec @param {number} id
   */
  alive(rec, id) {
    return !!rec && rec.h >= 0 && rec.id === id;
  }

  /**
   * Advance every effect.
   * @param {number} dt combat seconds (0 in hit-stop)
   */
  update(dt) {
    this._dim = 1 - HFX_NIGHT_DIM * globalUniforms.uNight.value;
    this._veil = 1;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const e = this._live[i];
      e.t += dt;
      if (e.t >= e.life) this._kill(i);
      else if (dt > 0 || e.live || e.follow || e.wave || e.back) this._write(e);
    }
  }

  /**
   * A story scene holds the fight (the ambient step): every effect fades out over `seconds`,
   * advancing on the frame's own `dt` — the wave's only veiled, standing still (the wave hits on
   * after the scene: they show again at the next `update`).
   * @param {number} dt the frame's seconds
   * @param {number} seconds
   * @returns {number} the effects still settling
   */
  settle(dt, seconds) {
    this._dim = 1 - HFX_NIGHT_DIM * globalUniforms.uNight.value;
    this._veil = Math.max(0, this._veil - dt / seconds);
    let n = 0;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const e = this._live[i];
      if (e.kind === 'wave') {
        this._write(e);
        if (this._veil > 0) n++;
        continue;
      }
      if (!e.settled) {
        e.settled = true;
        e.fadeIn = 0;
        e.fadeOut = Math.max(1e-3, Math.min(seconds, e.life - e.t));
        e.life = e.t + e.fadeOut;
      }
      e.t += dt;
      if (e.t >= e.life) this._kill(i);
      else {
        this._write(e);
        n++;
      }
    }
    return n;
  }

  /** The Dragonfang wave ended: its quads fade out where it stopped. */
  endWave() {
    for (const e of this._live) if (e.kind === 'wave') e.life = Math.min(e.life, e.t + Math.max(1e-3, e.fadeOut));
  }

  /**
   * Fade out every effect tagged `tag` within `seconds` (a skill cut short).
   * @param {string} tag
   * @param {number} seconds
   */
  fadeTag(tag, seconds) {
    for (const e of this._live) {
      if (e.tag !== tag) continue;
      e.fadeOut = Math.max(1e-3, seconds);
      e.life = Math.min(e.life, e.t + e.fadeOut);
    }
  }

  /**
   * Live effects tagged `tag`.
   * @param {string} tag
   */
  countTag(tag) {
    let n = 0;
    for (const e of this._live) if (e.tag === tag) n++;
    return n;
  }

  /** @param {HeroFxLive|null} rec end one effect now (if alive) */
  kill(rec) {
    if (!rec || rec.h < 0) return;
    const i = this._live.indexOf(rec);
    if (i >= 0) this._kill(i);
  }

  /** Remove every effect. */
  clear() {
    for (let i = this._live.length - 1; i >= 0; i--) this._kill(i);
  }

  /** @param {HeroFxLive} e */
  _write(e) {
    const p = this._p;
    const t = e.t;
    const f = e.follow;
    let x;
    let y;
    let z;
    let dirX = e.dirX;
    let dirZ = e.dirZ;
    switch (e.kind) {
      case 'orbit': {
        let r;
        if (t < e.open) r = e.rad0 + (e.rad1 - e.rad0) * ease(t / e.open);
        else if (t < e.release) r = e.rad1;
        else r = e.rad1 + e.out * (t - e.release);
        const a = e.a0 + e.w * t;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        x = (f ? f.x : e.x) + ca * r;
        z = (f ? f.z : e.z) + sa * r;
        y = (f ? f.y : e.y) + e.oy + 0.1 * Math.sin(t * 11 + e.a0 * 3);
        dirX = ca;
        dirZ = sa;
        break;
      }
      case 'fall': {
        const k = Math.min(1, t / e.fall);
        x = (f ? f.x : e.x) + e.ox;
        z = (f ? f.z : e.z) + e.oz;
        y = (f ? f.y : e.y) + e.oy + e.height * (1 - k * k);
        break;
      }
      case 'wave': {
        const W = /** @type {NonNullable<HeroFxLive['wave']>} */ (e.wave);
        x = W.x - W.dirX * e.trail;
        z = W.z - W.dirZ * e.trail;
        y = W.y + e.oy;
        dirX = W.dirX;
        dirZ = W.dirZ;
        break;
      }
      default:
        x = (f ? f.x : e.x) + e.ox + e.vx * t;
        y = (f ? f.y : e.y) + e.oy + e.vy * t;
        z = (f ? f.z : e.z) + e.oz + e.vz * t;
        break;
    }
    if (e.back && this.view) {
      x += this.view.viewX * e.back;
      z += this.view.viewZ * e.back;
    }
    let idx = e.index;
    if (e.loop) idx += Math.floor(t * e.fps + 1e-6);
    else if (e.strip > 0) idx = Math.min(e.n - 1, Math.floor((t / e.strip) * e.n));
    const g = e.grow > 0 ? Math.min(1, t / e.grow) : 1;
    const u = Math.min(1, t / e.life);
    let a = e.a;
    if (e.fadeIn > 0) a *= Math.min(1, t / e.fadeIn);
    if (e.fadeOut > 0) a *= Math.max(0, Math.min(1, (e.life - t) / e.fadeOut));
    if (e.kind === 'wave') a *= this._veil;
    const k = this._dim;
    p.x = x;
    p.y = y;
    p.z = z;
    p.frame = e.frame;
    p.index = idx;
    p.scale = e.s0 + (e.s1 - e.s0) * ease(g);
    p.rot = e.rot + e.spin * t;
    p.mode = e.mode;
    p.dirX = dirX;
    p.dirZ = dirZ;
    p.flipX = e.flip;
    p.r = (e.cr0 + (e.cr1 - e.cr0) * u) * k;
    p.g = (e.cg0 + (e.cg1 - e.cg0) * u) * k;
    p.b = (e.cb0 + (e.cb1 - e.cb0) * u) * k;
    p.a = a;
    // (both on every set: the params object is shared by every effect)
    p.soft = e.soft;
    p.halo = e.halo;
    this.quads.set(e.h, p);
  }

  /** @param {number} i index in `_live` */
  _kill(i) {
    const e = this._live[i];
    this.quads.free(e.h);
    e.h = -1;
    e.follow = null;
    e.wave = null;
    this._live[i] = this._live[this._live.length - 1];
    this._live.pop();
    this._pool.push(e);
  }
}
