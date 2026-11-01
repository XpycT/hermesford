import { Sprite3D, DIRECTIONS, globalUniforms, RNG, hashString } from '../../engine/index.js';
import { PARTY_CLASSES, presetOf, isClass } from '../../engine/level/PartyRules.js';
import { ALLY, KIT, CLASS_STATS, VQ_CLASSES, VQ_AI, DISTANCE, HEAL_AT, RETREAT_AT } from './rules.js';
import { EPS, F, frameOf, MELEE_DY, SHOT_Y } from '../combat/rules.js';
import { aimVy } from '../combat/Projectiles.js';
import { PLAYER_FLASH, BLINK_HZ } from '../combat/Feel.js';

/**
 * @import { CombatSystem } from '../combat/CombatSystem.js'
 * @import { Enemy } from '../combat/Enemy.js'
 * @import { PlayerView, HitSpec, ProjectileSpec, MarkerSpec, AllyState, AllyAction, PointXZ } from '../combat/types.js'
 * @import { BossArena } from '../combat/BossArena.js'
 * @import { Collider } from '../../engine/world/TileMap.js'
 * @import { FxQuadParams } from '../../engine/fx/FxQuads.js'
 * @import { PartyMember } from './PartyMember.js'
 * @import { AllyCombatView, HeroMove, HeroState } from './types.js'
 * @import { AllyMeleeHit, VqCasterKit, VqMeleeKit, VqMissile, VqSkill } from './rules.js'
 */

/**
 * A boss's hints for the companions in its fight (`MemberCombat._hints`: its brain state's
 * `allyHints` — Old Gullet's, src/game/combat/packs/evermere/gullet.js, EVM-06).
 * @typedef {object} AllyHints
 * @property {readonly string[]} evade the telegraph styles rolled out of as the `enemy` one
 * @property {(boss: Enemy, x: number, z: number, r: number) => boolean} unsafe ground to keep off
 * @property {(boss: Enemy) => ({ x: number, z: number, r: number }|null)} focus where it comes up next
 */

/**
 * A party member's fight (docs/specs/PARTY.md §5; COMBAT.md §28): made by `CombatSystem.addAlly`
 * for a member on a combat level, kept in `combat.allies` and as `member.combat` (the party reads
 * it as an `AllyCombatView`). It owns the member's stats (its class's `CLASS_STATS` at the
 * player's level), HP / MP, its kit (`KIT`: a basic attack, a skill, Mend, a dodge roll), getting
 * hit, going down and getting up, and the AI that picks what to do by the member's combat rule.
 *
 * The combat drives the member while it fights (`active`: a fight is on — `CombatSystem.fightOn()`,
 * not the combat's linger after its last foe, in which only a Mend due keeps it —, a foe has it as
 * its target, it is down, an action runs, or the player has fallen); otherwise the party's follow
 * does. `step(h)` runs once per combat sub-step, after the player's kit and before the enemies
 * (CombatSystem._substep): nothing advances while the combat is inactive. Every displacement goes
 * through the member's `moveBy` (the TileMap, radius 0.3, step 0.55; x / z only — the party keeps
 * it on the ground, fights included; the member has no collider of its own) and keeps out of a
 * closed boss arena from outside; inside one it is held in like the player. When it leaves the
 * fight the party's follow takes it back. Poses are the combat sheet's (`sheet.poses`, `sprite.setFrame`, as PlayerCombat shows the
 * player's), locomotion the sheet's animations (`play`).
 *
 * Its hits go through the combat's queues (`addAllyHit`, `spawnAllyProjectile`) and are resolved by
 * `CombatSystem._resolve` with the member's ATK; enemy hits reach it through `_hitAlly`. Effects
 * are the combat's (named FX, bursts, projectiles: warmed at load) — no ground marker, no light, no
 * new material; only the ice mage's look (IceSpellFx.js, where an ice mage can fight: the combat's
 * `IceStage`) adds its 3D crystals, ground frost and the FX batch's halo, warmed at load, and
 * takes the game's combat VFX lights (VfxLights.js, never a lamp). Randomness comes from its own RNG (`ally:<id>` and the combat seed), so a run in
 * fixed step repeats exactly.
 * @implements {AllyCombatView}
 */
export class MemberCombat {
  /**
   * @param {CombatSystem} sys
   * @param {PartyMember} member
   */
  constructor(sys, member) {
    this.sys = sys;
    this.member = member;
    this.id = member.id;
    /** Marks a party member's fight among hit owners and targets (core's queues). */
    this.isAlly = true;
    /** Removed (`removeAlly`, the combat disposed): it does nothing any more. */
    this.gone = false;
    /** Its class (PARTY_CLASSES; anything else fights as a warden). @type {keyof typeof KIT} */
    this.cls = isClass(member.record.cls) ? /** @type {keyof typeof KIT} */ (member.record.cls) : 'warden';
    /**
     * A hero of Vanquish the Evil Dragon (`VQ_CLASSES`: the cleric, the ice mage, the greatshield;
     * PARTY.md §12): two skills, its own moves (`move`), missiles, spells on the ground and their
     * effects. False for the warden, the ranger and the mystic, whose code paths never read the
     * heroes' state.
     */
    this.vq = VQ_CLASSES.includes(this.cls);
    this.base = CLASS_STATS[this.cls];
    this.kit = KIT[this.cls];
    /** 'melee' | 'ranged' | 'caster' (PARTY_CLASSES). */
    this.role = PARTY_CLASSES[this.cls]?.role ?? 'melee';
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    /** The party level its HP and MP were last scaled to (`syncLevel`). */
    this._lvl = this.level;
    /** HP 0: it lies down until `ALLY.calm` s after the fight (`fightOn()` off), then gets up with `ALLY.getUp`. */
    this.down = false;
    /** Foes it killed. */
    this.kills = 0;
    this.counts = newCounts();
    /** @type {AllyAction|null} the running action */
    this.action = null;
    this.t = 0;
    this.frame = 0;
    this._prevFrame = -1;
    this._moved = 0;
    /** @type {{ dist: number, f0: number, f1: number, dx: number, dz: number }|null} */
    this._motion = null;
    this.atkCd = 0;
    this.skillCd = 0;
    this.healCd = 0;
    this.rollCd = 0;
    this.iframes = 0;
    this.flashT = 0;
    this.blink = false;
    /** Swings started (enemies read it as `ctx.player.swing`). */
    this.swings = 0;
    /** @type {Enemy|null} the foe it goes for */
    this.target = null;
    /** @type {'idle'|'hold'|'attack'|'retreat'|'heal'|'evade'|'wait'|'down'|'stop'} what the AI does (tests) */
    this.mode = 'idle';
    /** @type {MemberCombat|'player'|null} whom its Mend is for */
    this._healWho = null;
    /** @type {Enemy|null} the foe of the running attack */
    this._actTarget = null;
    this._tag = 0;
    this._targeted = false;
    this._calm = 0;
    this._planT = (hashString(`plan:${this.id}`) % 15) / 60;
    /** @type {Map<Enemy, number>} foes given up (unreachable) until a combat-clock time */
    this._skip = new Map();
    /** @type {BossArena|null} the closed arena it stands in */
    this._arena = null;
    /**
     * The spot it holds beside the player (or falls back to): `ok` false = none found (the player's
     * own spot); `px` / `pz` where the player stood when it was planned; `kind` 'hold' / 'retreat'.
     */
    this._hold = { x: 0, z: 0, ok: false, px: 0, pz: 0, kind: '' };
    /** It walks to its hold spot (it set off beyond `ALLY.holdSlack` and has not arrived). */
    this._holdWalk = false;
    /** The foe it faces while it holds (kept while it stays about as near the player). @type {Enemy|null} */
    this._lookAt = null;
    /**
     * A melee member's spot round its target (`_meleeSpot`): the angle from the foe, whether it
     * stands in front of the player on screen, the foe it is for, the spot now.
     * @type {{ a: number, ok: boolean, cover: boolean, t: Enemy|null, x: number, z: number }}
     */
    this._mspot = { a: 0, ok: false, cover: false, t: null, x: 0, z: 0 };
    /** Stepping to a free melee spot between thrusts, and the time until the next such step. */
    this._reloc = false;
    this._relocT = 0;
    /** At its spot but out of its target's reach (in height) this long; for that foe. */
    this._noReachT = 0;
    /** @type {Enemy|null} */
    this._noReachFor = null;
    /** `_goTo`'s last move: where from, the way, the step and the sub-step (its net progress is read at the next). */
    this._gp = { x: 0, z: 0, ux: 0, uz: 0, step: 0, sub: -2 };
    /** A shot's target tracked while it aims: its last spot and smoothed velocity (u/s). @type {{ t: Enemy|null, x: number, z: number, vx: number, vz: number }} */
    this._trk = { t: null, x: 0, z: 0, vx: 0, vz: 0 };
    this._ndc = { x: 0, y: 0 };
    this._stuckT = 0;
    this._path = new Float32Array(48);
    this._pathN = 0;
    this._pathI = 0;
    this._pathGX = 0;
    this._pathGZ = 0;
    this._pathAt = -Infinity;
    this._lastCol = -1;
    this._lastRow = -1;
    this._anim = '';
    this._flashOn = false;
    this._speedSet = false;
    this._prevX = member.position.x;
    this._prevZ = member.position.z;
    /** `_leashed`'s result. */
    this._goal = { x: 0, z: 0 };
    /** A shooter's spot (`_shotSpot`), the foe it is for, whether it is on screen. @type {{ x: number, z: number, ok: boolean, on: boolean, t: Enemy|null }} */
    this._spot = { x: 0, z: 0, ok: false, on: false, t: null };
    this._esc = { x: 0, z: 0 };
    this._near = /** @type {Enemy[]} */ ([]);
    /** Pending Flare bursts (mystic): spot, ground, seconds left, tag; `on` false = free. */
    this._flares = [0, 1, 2].map(() => ({ on: false, x: 0, y: 0, z: 0, t: 0, tag: 0 }));
    // ---- the heroes of Vanquish the Evil Dragon (PARTY.md §12; untouched for the other classes) ----
    /**
     * A hero's running move — its kit's id ('holyBolt', 'judgement', 'sanctuary', 'mend', 'revive',
     * 'frostLance', 'blizzard', 'glacialTomb', 'bash', 'mace', 'bulwark', 'earthshatter') — while
     * `action` names its kind for the combat core and the enemies (`bolt`, `flare`, `mend`, `a1` /
     * `a2`, `sweep`); null between moves, and always for the warden, the ranger and the mystic.
     * @type {HeroMove|null}
     */
    this.move = null;
    /** The second skill's cooldown (s), the raise's, and the pause before either skill after the other (`VQ_AI.skillGap`). */
    this.skill2Cd = 0;
    this.reviveCd = 0;
    this.gapCd = 0;
    /** Seconds it has been down (heroes: the cleric's patience, the rally — `VQ_AI.rally`). */
    this._downT = 0;
    /** The skill the AI chose for its next cast (`_heroSkill`). @type {'skill'|'skill2'|null} */
    this._next = null;
    /** @type {MemberCombat|null} the fallen member its raise is for */
    this._reviveWho = null;
    /** Where the running spell lands. */
    this._spellAt = { x: 0, z: 0 };
    /** Moves cast so far by id (tests; `info().hero`). @type {Record<string, number>} */
    this.casts = {};
    /** Its missiles in flight (Holy Bolt, Frost Lance). @type {Missile[]} */
    this._missiles = this.vq ? [0, 1, 2, 3].map(newMissile) : [];
    /** Its spells on the ground (Judgement, Sanctuary, Blizzard, Glacial Tomb, Earthshatter). @type {Field[]} */
    this._fields = this.vq ? [0, 1, 2, 3, 4].map(newField) : [];
    /** `_inCollider`'s scratch. @type {Collider[]} */
    this._cols = [];
    /** Its effect quads on the combat's FX batch (heroes only). */
    this._fx = this.vq ? new SpellFx(sys) : null;
    /**
     * The ice mage's look (IceSpellFx.js: the lances, the storm, the Tomb's 3D crystals, frost,
     * light, shells, her staff's glow), from the combat's `IceStage` — made only on a level where
     * an ice mage can fight (`classMayFight('icemage', …)`). Null for every other class, and where no stage was
     * made (only the `__game.party.join` / `story.run` hooks can bring one there — the sandbox
     * fixtures do — and say so in the console: her spells are then unseen but for the
     * lance's launch shards, its trail and the sounds).
     * @type {import('./IceSpellFx.js').IceSpellFx|null}
     */
    this._ice = this.cls === 'icemage' && sys.ice ? sys.ice.director(this) : null;
    if (this.cls === 'icemage' && !sys.ice && this.vq) {
      console.info(`[combat] ice mage "${this.id}" on a level classMayFight did not foresee: her spells have no look here (COMBAT.md §28 A13)`);
    }
    /**
     * The cleric's look (HolySpellFx.js), from the combat's `HolyStage` — made only on a level where
     * a cleric can fight (`classMayFight('cleric', …)`). Null for every other class, and where no
     * stage was made (only the hooks can bring one there, as for the ice mage: her spells are then
     * unseen but for the sounds).
     * @type {import('./HolySpellFx.js').HolySpellFx|null}
     */
    this._holy = this.cls === 'cleric' && sys.holy ? sys.holy.director(this) : null;
    if (this.cls === 'cleric' && !sys.holy && this.vq) {
      console.info(`[combat] cleric "${this.id}" on a level classMayFight did not foresee: her spells have no look here`);
    }
    /**
     * The greatshield's look (EarthSpellFx.js), from the combat's `EarthStage` — made only on a level
     * where a greatshield can fight (`classMayFight('greatshield', …)`). Null for every other class,
     * and where no stage was made (his moves are then unseen but for the sounds).
     * @type {import('./EarthSpellFx.js').GreatshieldFx|null}
     */
    this._earth = this.cls === 'greatshield' && sys.earth ? sys.earth.director(this) : null;
    if (this.cls === 'greatshield' && !sys.earth && this.vq) {
      console.info(`[combat] greatshield "${this.id}" on a level classMayFight did not foresee: his moves have no look here`);
    }
    /** @type {HitSpec} its hitbox record (the queue copies it) */
    this._spec = {
      shape: 'sector', x: 0, y: 0, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1,
      dy: MELEE_DY, mv: 1, kb: 0, poise: 0, knockdown: false, flat: 0, thin: false, tag: 0, fromX: 0, fromZ: 0,
    };
    /** @type {ProjectileSpec} its shot record (the pool copies it) */
    this._proj = { kind: 'arrow', x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, vy: 0, speed: 16, range: 12, radius: 0.25, mv: 1, kb: 0, poise: 0, pierce: false, splash: null, arc: null };
    /** @type {PlayerView} the member as the enemies that target it see it (`ctx.player`, PARTY.md §5.3) */
    this.view = {
      position: member.position, radius: ALLY.radius, body: [ALLY.body[0], ALLY.body[1]], facing: { x: 0, z: 1 },
      velocity: { x: 0, z: 0 }, alive: true, invulnerable: false, dodging: false, action: null, swing: 0, sealed: false,
    };
    this.reseed(sys.seedValue);
    this._syncView();
  }

  // ------------------------------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------------------------------

  /** The party's level: the player's. */
  get level() { return this.sys.pc?.level ?? 1; }
  get hpMax() { return this._hpAt(this.level); }
  get mpMax() { return this._mpAt(this.level); }
  /** Max HP at party level `lv`. @param {number} lv */
  _hpAt(lv) { return Math.round(this.base.hp + this.base.perLevel.hp * (lv - 1)); }
  /** Max MP at party level `lv`. @param {number} lv */
  _mpAt(lv) { return Math.round(this.base.mp + this.base.perLevel.mp * (lv - 1)); }

  /**
   * The party's level changed (the player's: a level-up, a campaign's progress restored on
   * arrival, the `setPlayer` hook): HP and MP keep their fractions of the new maxima (a member that
   * came in full at the fresh combat's level 1 is full at the player's level). A downed member
   * stays at 0. Called by the combat where the level changes, and at each sub-step and `info()`.
   * @returns {boolean} it changed
   */
  syncLevel() {
    const lv = this.level;
    const was = this._lvl;
    if (lv === was) return false;
    this._lvl = lv;
    const h0 = this._hpAt(was);
    const m0 = this._mpAt(was);
    if (!this.down) this.hp = Math.min(this.hpMax, h0 > 0 ? (this.hp / h0) * this.hpMax : this.hpMax);
    this.mp = Math.min(this.mpMax, m0 > 0 ? (this.mp / m0) * this.mpMax : this.mpMax);
    return true;
  }
  /** ATK at the party's level, × `ALLY.partyAtk` by how many members fight. */
  get atk() {
    const n = Math.max(1, Math.min(ALLY.partyAtk.length, this.sys.allies.length));
    return (this.base.atk + this.base.perLevel.atk * (this.level - 1)) * ALLY.partyAtk[n - 1];
  }
  get def() { return this.base.def + this.base.perLevel.def * (this.level - 1); }
  /** The member's combat rule (its record's, live: the panel and the story change it). */
  get rule() { return this.member.record.rule; }
  /** A hero's kit, typed for its moves (`vq` only; rules.js `VqCasterKit` / `VqMeleeKit`). */
  get heroKit() { return /** @type {VqCasterKit & VqMeleeKit} */ (this.kit); }
  /** Its live position (the sprite's). */
  get position() { return this.member.position; }
  get radius() { return ALLY.radius; }

  /** The combat drives the member now (PARTY.md §5.1, §11 PC1, PC27): the follow waits. */
  get active() {
    if (this.gone || !this.member.sprite) return false;
    const m = this.member;
    if (m.directed || m.talking) return false;
    const sys = this.sys;
    if (this.down || this.action !== null || this._targeted || !sys.pc.alive) return true;
    if (sys.sealedArena()) return true;
    // a fight on — not the combat's linger after its last foe, in which a member nobody fights is
    // the follow's (and can be talked to, PARTY-17) unless a Mend of its is due
    if (!sys.fightOn() && !(sys.engaged && this._mendDue())) return false;
    // left far behind (a teleport, a long fall): the follow catches it up (or puts it behind the player)
    const P = sys.player.position;
    const p = m.position;
    return Math.hypot(p.x - P.x, p.z - P.z) <= FAR_BEHIND;
  }

  /** Enemy hits pass through it now: down, i-frames, rolling, the player fallen, `allyGod`. */
  get invulnerable() {
    if (this.down || this.iframes > 0 || this.sys.allyGod || !this.sys.pc.alive) return true;
    if (this.action === 'roll') {
      const w = ALLY.roll.iframes;
      return this.frame >= w[0] && this.frame <= w[1];
    }
    return this.action === 'knock';
  }

  /** Can an enemy hit or shot reach it now? */
  get hittable() {
    return !this.gone && !!this.member.sprite && !this.member.directed && !this.invulnerable;
  }

  /** In the world for hits at all (attached, not removed, not down). */
  get present() {
    return !this.gone && !!this.member.sprite && !this.down;
  }

  // ------------------------------------------------------------------------------------------
  // The AllyCombatView members and core's notifications
  // ------------------------------------------------------------------------------------------

  /** Full HP / MP, up again, action cleared (a rest, a respawn, the story's `heal`). */
  refill() {
    this._lvl = this.level;
    this.hp = this.hpMax;
    this.mp = this.mpMax;
    this.down = false;
    this._endAction();
    this.iframes = 0;
    this.flashT = 0;
    this.blink = false;
    if (this.member.sprite) this.member.sprite.mesh.visible = true;
    this._play('idle', true);
    this._syncView();
  }

  /** The member was put somewhere else at once (a teleport, a travel's arrival, a respawn). */
  onTeleport() {
    if (!this.down) this._endAction();
    this.target = null;
    this._healWho = null;
    this._pathN = 0;
    this._stuckT = 0;
    this._planT = 0;
    this._hold.ok = false;
    this._hold.kind = '';
    this._holdWalk = false;
    this._spot.t = null;
    this._spot.ok = false;
    this._mspot.t = null;
    this._mspot.ok = false;
    this._reloc = false;
    this._noReachT = 0;
    this._gp.sub = -2;
    this._trk.t = null;
    const p = this.member.position;
    this._prevX = p.x;
    this._prevZ = p.z;
    this.view.velocity.x = 0;
    this.view.velocity.z = 0;
    if (!this.down) this._play('idle', true);
    this._syncView();
  }

  /** The player fell: stop where it stands (invulnerable until the respawn). */
  onPlayerDeath() {
    if (this.down) return;
    this._endAction();
    this.target = null;
    this.mode = 'stop';
    this._play('idle', true);
  }

  /** New seed (the `seed` and `reset` hooks): its own RNG from its id and the combat seed. */
  reseed(seed) {
    this.rng = new RNG((hashString(`ally:${this.id}`) ^ (Number(seed) >>> 0)) >>> 0);
  }

  /**
   * Back to a fresh fight (the `reset` hook, a reproducible start): full, no kills, counters,
   * cooldowns, timers and plans cleared, facing +z, its RNG from the seed.
   */
  reset() {
    this.refill();
    this.kills = 0;
    this.counts = newCounts();
    this.atkCd = this.skillCd = this.healCd = this.rollCd = 0;
    this.swings = 0;
    this.target = null;
    this.mode = 'idle';
    this._healWho = null;
    this._actTarget = null;
    this._targeted = false;
    this._calm = 0;
    this._skip.clear();
    this._arena = null;
    this._pathAt = -Infinity;
    this._anim = '';
    this._lookAt = null;
    this._relocT = 0;
    this._noReachFor = null;
    for (const f of this._flares) f.on = false;
    if (this.vq) this._clearHero();
    this._planT = (hashString(`plan:${this.id}`) % 15) / 60;
    this.member.facing.x = 0;
    this.member.facing.z = 1;
    this.onTeleport();
    this.reseed(this.sys.seedValue);
  }

  /** Out of the combat (removeAlly, dispose): the sprite's look back to plain. */
  release() {
    if (this.vq) this._clearHero();
    this._ice?.dispose();
    this._ice = null;
    this._holy?.dispose();
    this._holy = null;
    this._earth?.dispose();
    this._earth = null;
    this.gone = true;
    this.target = null;
    const s = this.member.sprite;
    if (s) {
      s.setFlash(0, 0, 0, 0);
      s.mesh.visible = true;
      if (this._speedSet) s.speed = 1;
      if (this.action || this.down || this._lastCol >= 0) s.play('idle');
    }
    this._speedSet = false;
    this.action = null;
    if (this.member.combat === this) this.member.combat = null;
  }

  /**
   * Heal (capped) with a green number; a downed member is not raised (it gets up after the fight).
   * @param {number} amount
   * @returns {number} HP gained
   */
  heal(amount) {
    if (this.down || this.gone) return 0;
    const before = this.hp;
    this.hp = Math.min(this.hpMax, this.hp + Math.max(0, amount));
    const got = Math.round(this.hp - before);
    const p = this.member.position;
    if (got > 0) this.sys.number(p.x, p.y + 1.9, p.z, `+${got}`, 'heal');
    return got;
  }

  // ------------------------------------------------------------------------------------------
  // Sub-step
  // ------------------------------------------------------------------------------------------

  /**
   * One combat sub-step (player-scaled seconds), after the player's kit and before the enemies.
   * @param {number} h
   */
  step(h) {
    const m = this.member;
    if (this.gone || !m.sprite || m.combat !== this) return;
    const sys = this.sys;
    this.syncLevel();
    this._stepFlares(h);
    // (a hero's missiles, spells on the ground and effects go on as the mystic's Flares do)
    if (this.vq) this._stepHero(h);
    if (m.directed || m.talking) {
      this._targeted = false;
      return;
    }
    // timers
    if (this.atkCd > 0) this.atkCd = Math.max(0, this.atkCd - h);
    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - h);
    if (this.healCd > 0) this.healCd = Math.max(0, this.healCd - h);
    if (this.rollCd > 0) this.rollCd = Math.max(0, this.rollCd - h);
    if (this.iframes > 0) this.iframes = Math.max(0, this.iframes - h);
    if (this._relocT > 0) this._relocT = Math.max(0, this._relocT - h);
    if (this.vq) {
      if (this.skill2Cd > 0) this.skill2Cd = Math.max(0, this.skill2Cd - h);
      if (this.reviveCd > 0) this.reviveCd = Math.max(0, this.reviveCd - h);
      if (this.gapCd > 0) this.gapCd = Math.max(0, this.gapCd - h);
    }
    // in a fight: one is on (not the linger after it: the regen and the get-up count from the
    // moment the follow takes the member back), or a foe after it
    this._targeted = sys.isTargeted(this);
    const fighting = sys.fightOn() || this._targeted;
    if (fighting || !sys.pc.alive) this._calm = 0;
    else this._calm += h;
    if (this._calm >= ALLY.calm - EPS) {
      if (this.down) this._getUp();
      else {
        this.hp = Math.min(this.hpMax, this.hp + this.hpMax * ALLY.regen * h);
        this.mp = Math.min(this.mpMax, this.mp + this.mpMax * ALLY.regen * h);
      }
    } else if (!this.down) this.mp = Math.min(this.mpMax, this.mp + (this.vq ? this.heroKit.mpRegen ?? ALLY.mpRegen : ALLY.mpRegen) * h);
    // (a hero down `VQ_AI.rally` s in a fight gets up by itself: a long fight never keeps one down)
    if (this.vq) {
      if (!this.down) this._downT = 0;
      else if ((this._downT += h) >= VQ_AI.rally - EPS && sys.pc.alive) this._getUp();
    }
    if (this.hp > this.hpMax) this.hp = this.hpMax;
    if (this.mp > this.mpMax) this.mp = this.mpMax;
    // the closed arena it stands in (held there like the player)
    const sealed = sys.sealedArena();
    this._arena = sealed && sealed.contains(m.position.x, m.position.z) ? sealed : null;

    if (!sys.pc.alive) {
      // the player fell: stand still until the respawn
      if (!this.down && this.action && this.action !== 'hurt' && this.action !== 'knock') this._endAction();
      if (this.action) this._advance(h);
      else if (!this.down) {
        this.mode = 'stop';
        this._play('idle');
      }
      this._syncView();
      return;
    }
    if (this.down) {
      this.mode = 'down';
      this._pose('down');
      this._syncView();
      return;
    }
    if (this.action) {
      this._advance(h);
      if (this.action) {
        this._syncView();
        return;
      }
    }
    if (!this.active) {
      // the follow drives it (and plays its own animations: the next `_play` starts afresh)
      this.mode = 'idle';
      this.target = null;
      this._pathN = 0;
      this._stuckT = 0;
      this._anim = '';
      this._gp.sub = -2;
      this._holdWalk = false;
      this._reloc = false;
      this._syncView();
      return;
    }
    this._think(h);
    this._syncView();
  }

  /** The view enemies read when they target this member. */
  _syncView() {
    const v = this.view;
    const m = this.member;
    v.position = m.position;
    v.facing.x = m.facing.x;
    v.facing.z = m.facing.z;
    v.alive = !this.down && !this.gone;
    v.invulnerable = this.invulnerable;
    v.dodging = this.action === 'roll';
    v.action = viewAction(this.action);
    v.swing = this.swings;
    v.sealed = this.sys._pv?.sealed ?? false;
  }

  // ------------------------------------------------------------------------------------------
  // The AI (PARTY.md §5.4)
  // ------------------------------------------------------------------------------------------

  /** @param {number} h */
  _think(h) {
    if (this.vq) {
      this._thinkHero(h);
      return;
    }
    const sys = this.sys;
    const rule = this.rule;
    const kit = this.kit;
    this._planT -= h;
    const replan = this._planT <= 0;
    if (replan) this._planT = Math.max(this._planT + ALLY.planEvery, 0.05);
    // a closed arena it is not in: wait outside the gate
    const sealed = sys.sealedArena();
    if (sealed && !this._arena) {
      this.mode = 'wait';
      this.target = null;
      this._waitAtGate(sealed, h);
      return;
    }
    // evade: out of a filling telegraph
    if (rule.evade === 'on' && this.rollCd <= 0 && this._evade()) return;
    // heal
    const healAt = HEAL_AT[rule.heal] ?? 0;
    if (healAt > 0 && this.healCd <= 0 && this.mp >= kit.mend.mp - EPS) {
      if (replan || !this._healOk(this._healWho, healAt)) this._healWho = this._pickHeal(healAt);
      const who = this._healWho;
      if (who) {
        const q = who === 'player' ? sys.player.position : who.position;
        const p = this.member.position;
        this.mode = 'heal';
        if (Math.hypot(q.x - p.x, q.z - p.z) <= kit.mend.range) {
          this._startMend();
          return;
        }
        this._goTo(q.x, q.z, h, kit.mend.range - 1);
        return;
      }
    } else this._healWho = null;
    // fall back: behind the player, away from the foes
    if (this.hp < this.hpMax * (RETREAT_AT[rule.retreat] ?? 0)) {
      this.mode = 'retreat';
      this.target = null;
      this._retreat(h, replan);
      return;
    }
    // fight (the target picked on the plan's beat, and at once when the one it has stops being valid)
    if (rule.attack !== 'never') {
      if (replan || (this.target !== null && !this._candidate(this.target))) this.target = this._pickTarget();
      const t = this.target;
      if (t && this._fight(t, h, replan)) {
        this.mode = 'attack';
        return;
      }
    } else this.target = null;
    this.mode = 'hold';
    this._holdSpot(h, replan);
  }

  // ---- targets ----

  /**
   * May it go for this foe now? Alive, awake, drawn, not walking home, no dummy; not given up;
   * the boss only in its fight with the member inside its arena; nothing inside an arena from
   * outside; within the leash of the player plus its reach.
   * @param {Enemy|null} e
   * @returns {boolean}
   */
  _candidate(e) {
    if (!e || !e.alive || e.dormant || !e.sprite.visible || e.sprite.opacity <= 0.001) return false;
    const sys = this.sys;
    if (e.passive || e.kind === 'dummy' || e.state === 'return' || sys._hidden.has(e)) return false;
    const until = this._skip.get(e);
    if (until !== undefined) {
      if (sys.clock < until) return false;
      this._skip.delete(e);
    }
    const inside = this._arena;
    if (inside) {
      if (!inside.contains(e.position.x, e.position.z)) return false;
    } else {
      if (e.boss) return false;
      for (const a of sys.arenas) if (a.present && a.containsGrown(e.position.x, e.position.z, 0.5)) return false;
    }
    if (e.boss && sys.bossFight !== e) return false;
    const P = sys.player.position;
    const d = Math.hypot(e.position.x - P.x, e.position.z - P.z);
    return d <= this._leash() + this._reach();
  }

  /** The leash of its `distance` (u from the player). */
  _leash() {
    return (DISTANCE[this.rule.distance] ?? DISTANCE.mid).leash;
  }

  /** How far from its target it attacks: melee reach, else the standoff (within the shot's range). */
  _reach() {
    if (this.role === 'melee') return /** @type {typeof KIT.warden} */ (this.kit).reach + 0.5;
    const so = (DISTANCE[this.rule.distance] ?? DISTANCE.mid).standoff;
    return Math.min(so, this._range() - 0.5);
  }

  /**
   * The pause after a basic attack and the skill's cooldown × this: `ALLY.healerPace` for a member
   * that heals `often` (Support), else 1 (also for a class without a Mend: nothing to keep its hands
   * free for).
   */
  _pace() {
    return this.rule.heal === 'often' && this.kit.mend ? ALLY.healerPace : 1;
  }

  /** The basic shot's range (ranged / caster). */
  _range() {
    const k = /** @type {typeof KIT.ranger|typeof KIT.mystic} */ (this.kit);
    return k.basic?.range ?? 2;
  }

  /**
   * `attack: assist`: a foe that fights the player or the party now — the lock-on, one the player
   * hit lately, one after a member, or an aggroed one that came for the player (within
   * `ALLY.assistNear` u of it). (Every foe of a fight is aggroed: with that alone `assist` was
   * `free`.)
   * @param {Enemy} e
   */
  _assists(e) {
    const sys = this.sys;
    if (e === sys.targeting.lock || sys.clock - (e.playerHitAt ?? -Infinity) < ALLY.assistMemory) return true;
    if (!e.aggro) return false;
    if (e.target?.isAlly) return true;
    const P = sys.player.position;
    return Math.hypot(e.position.x - P.x, e.position.z - P.z) <= ALLY.assistNear;
  }

  /** The foe it goes for by its rule's `target` (a little stickiness for the current one). @returns {Enemy|null} */
  _pickTarget() {
    const sys = this.sys;
    const rule = this.rule;
    const P = sys.player.position;
    const p = this.member.position;
    const lock = sys.targeting.lock;
    const assist = rule.attack === 'assist';
    let best = null;
    let bestScore = Infinity;
    // a foe fights the party now (aggroed, near the player): only then does a free hand take on
    // a foe not yet in the fight — it does not start the next fight in the linger after one
    let fight = false;
    for (const e of sys.enemies) {
      if (!fight && e.alive && e.aggro && !e.passive && Math.hypot(e.position.x - P.x, e.position.z - P.z) <= FIGHT_RANGE) fight = true;
      if (!this._candidate(e)) continue;
      if (assist && !this._assists(e)) continue;
      // (foes already in the fight — aggroed, or the player's lock-on — first, whatever the rule's
      // bonuses; one not in it yet only when it is about to join, near the player, and never an
      // elite or the boss: a free hand does not pull the next pack or wake an elite while the foes
      // of the fight are out of its reach)
      const fighting = e.aggro || e === lock;
      if (!fighting && (e.elite || e.boss || Math.hypot(e.position.x - P.x, e.position.z - P.z) > JOIN_NEAR)) continue;
      const dMe = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      let score = fighting ? 0 : NOT_FIGHTING;
      switch (rule.target) {
        case 'nearest': score += dMe; break;
        case 'weakest': score += (e.hp / e.hpMax) * 100 + dMe * 0.05; break;
        case 'strongest': score += -(e.boss ? 1e6 : 0) - (e.elite ? 1e5 : 0) - e.hpMax + dMe * 0.05; break;
        // (the foes that fight from range: a ranged attack token — archer, shaman, wyrmcaller, ember imp)
        case 'ranged': score += (e.def.token?.type === 'ranged' ? 0 : 1000) + dMe; break;
        default: score += e === lock ? -1e6 : Math.hypot(e.position.x - P.x, e.position.z - P.z); break;
      }
      if (e === this.target) score -= rule.target === 'weakest' || rule.target === 'strongest' ? 0.5 : 1;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = e;
      }
    }
    return best && (best.aggro || fight) ? best : null;
  }

  /**
   * Go for `t`: a skill when one suits, the basic attack from its spot, else the way there.
   * @param {Enemy} t
   * @param {number} h
   * @param {boolean} replan the plan's beat (a shooter's spot is chosen anew)
   * @returns {boolean} it did something about `t`
   */
  _fight(t, h, replan) {
    const sys = this.sys;
    const p = this.member.position;
    const q = t.position;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const d = Math.hypot(dx, dz);
    // a shooter beyond its leash of the player (or off screen while a spot on screen sees its
    // target) goes back first; one in line with the player on screen steps aside (before a skill too)
    const away = this.role !== 'melee' && this._shooterAway(t, replan);
    if (this.role !== 'melee' && !away && d <= this._range() - 0.4 && this._spaceOut(q.x, q.z, h)) return true;
    // a warden in front of the player on screen steps to a free spot first (before a skill too)
    if (this.role === 'melee' && this._relocate(t, d, h)) return true;
    if (!away && (this.vq ? this._heroSkill(t, d) : this._skillReady() && this._skillSuits(t, d))) {
      this._startSkill(t);
      return true;
    }
    if (this.role === 'melee') {
      const kit = /** @type {typeof KIT.warden} */ (this.kit);
      const reach = kit.reach + t.radius;
      const dy = Math.abs(q.y - p.y);
      const inReach = d <= reach && dy <= MELEE_DY
        && (d < 0.8 || this._arena !== null || !sys.nav || sys.nav.lineClear(p.x, p.z, q.x, q.z, 0.3));
      if (this._noReachFor !== t) {
        this._noReachFor = t;
        this._noReachT = 0;
      }
      if (inReach) {
        this._noReachT = 0;
        if (this.atkCd <= 0) this._startMelee(t, 0);
        else {
          this._face(q.x, q.z);
          this._play('idle');
        }
        return true;
      }
      // to its spot round the foe (not in front of the player on screen when another is free),
      // else straight at it within the leash
      const s = this._meleeSpot(t, reach, replan);
      const g = s ?? this._leashed(q.x - (dx / (d || 1)) * (reach * 0.7), q.z - (dz / (d || 1)) * (reach * 0.7));
      const there = this._goTo(g.x, g.z, h, 0.15, true);
      // there (or across from it) but out of its reach — a foe on a ledge above or below: given
      // up after `ALLY.noReach` s (the walk grid found a way to the spot, not to the foe)
      if ((there && s !== null) || (dy > MELEE_DY && (there || d <= reach + 0.4))) {
        this._noReachT += h;
        if (this._noReachT >= ALLY.noReach - EPS && this.target === t) {
          this._skip.set(t, sys.clock + ALLY.skipFor);
          this.target = null;
          this._noReachT = 0;
          this._mspot.t = null;
        }
      } else this._noReachT = Math.max(0, this._noReachT - h);
      return true;
    }
    // ranged / caster: keep the standoff with a line of sight — from within its leash of the
    // player (farther: back to a spot inside it first) and on screen when a spot on screen sees it
    const so = (DISTANCE[this.rule.distance] ?? DISTANCE.mid).standoff;
    const range = this._range() - 0.4;
    const los = !away && d <= range && sys.los(p.x, p.z, q.x, q.z);
    // (a caster hero keeps its berth from a boss's edge: out of its claws and stomp)
    const berth = this.vq && t.boss ? t.radius + VQ_AI.bossBerth : 0;
    if (los && d >= Math.min(so - 1.6, 1.6) + berth) {
      if (this.atkCd <= 0) this._startShot(t);
      else {
        this._face(q.x, q.z);
        this._play('idle');
      }
      return true;
    }
    if (los && d < so - 1.6 + berth) {
      // too close: step back (along the line away from it), else shoot from here
      const bx = p.x - (dx / (d || 1)) * 1.2;
      const bz = p.z - (dz / (d || 1)) * 1.2;
      const P = sys.player.position;
      if (sys.standable(bx, bz) && Math.hypot(bx - P.x, bz - P.z) <= this._leash()) {
        // (backing off facing it)
        this._goTo(bx, bz, h, 0.2, false, t);
        this._face(q.x, q.z);
        return true;
      }
      if (this.atkCd <= 0) this._startShot(t);
      return true;
    }
    // out of range, no line of sight, beyond its leash or off screen: to a spot at the standoff
    // that sees it (chosen on the plan's beat), else the standoff point on the line to it
    const sp = this._shotSpot(t, so, replan);
    if (sp) {
      this._goTo(sp.x, sp.z, h, 0.3, true);
      return true;
    }
    const g = this._leashed(q.x - (dx / (d || 1)) * Math.min(so, d * 0.8), q.z - (dz / (d || 1)) * Math.min(so, d * 0.8));
    this._goTo(g.x, g.z, h, 0.3, true);
    return true;
  }

  /**
   * A melee member near its foe that stands in front of the player on screen (`_covers`: the player
   * stepped behind it, or it came that way) steps to a free spot round the foe first — at most
   * every `ALLY.relocEvery` s and only `RELOC_MAX` u —, facing the foe; then it strikes from there.
   * @param {Enemy} t
   * @param {number} d its distance to t
   * @param {number} h
   * @returns {boolean} it steps
   */
  _relocate(t, d, h) {
    const p = this.member.position;
    const reach = /** @type {typeof KIT.warden} */ (this.kit).reach + t.radius;
    if (!this._reloc) {
      if (this._relocT > 0 || d > reach + 0.5 || !this._covers(p.x, p.z)) return false;
      const s = this._meleeSpot(t, reach, true);
      if (!s || s.cover || Math.hypot(s.x - p.x, s.z - p.z) > RELOC_MAX) return false;
      this._reloc = true;
      this._relocT = ALLY.relocEvery;
    }
    const s = this._meleeSpot(t, reach, false);
    if (s && !s.cover && !this._goTo(s.x, s.z, h, 0.15, true, t)) return true;
    this._reloc = false;
    return false;
  }

  /**
   * Must this shooter move before it shoots `t`? Farther than its leash + `ALLY.leashSlack` from
   * the player (Guard Me's 4 u kept ranged members beside the player only on the way in), or off
   * screen while a spot on screen sees its target (`_shotSpot`).
   * @param {Enemy} t
   * @param {boolean} replan
   * @returns {boolean}
   */
  _shooterAway(t, replan) {
    const sys = this.sys;
    const p = this.member.position;
    const P = sys.player.position;
    if (Math.hypot(p.x - P.x, p.z - P.z) > this._leash() + ALLY.leashSlack) return true;
    if (sys.projectNdc(p.x, p.y + SHOT_Y, p.z, this._ndc, OFF_SCREEN)) return false;
    const s = this._shotSpot(t, (DISTANCE[this.rule.distance] ?? DISTANCE.mid).standoff, replan);
    return !!s && s.on && Math.hypot(s.x - p.x, s.z - p.z) > 0.5;
  }

  /**
   * A spot to shoot `t` from: at the standoff from it (at least 2 u, inside the shot's range), the
   * way from it to the member first, then turning either way by 45° steps — standable, within a
   * level of it, within the leash of the player, allowed by the arena rules and with a line of
   * sight to it; on screen when one is (`on`), else any. Chosen on the plan's beat (and when the
   * target changed, or the player left it outside the leash); null: none.
   * @param {Enemy} t
   * @param {number} so the standoff
   * @param {boolean} replan
   * @returns {{ x: number, z: number, on: boolean }|null}
   */
  _shotSpot(t, so, replan) {
    const sp = this._spot;
    const sys = this.sys;
    const P = sys.player.position;
    const L = this._leash();
    // (the spot kept between beats — unless the player has gone on and left it outside the leash)
    if (!replan && sp.t === t && !(sp.ok && Math.hypot(sp.x - P.x, sp.z - P.z) > L + ALLY.leashSlack)) return sp.ok ? sp : null;
    const p = this.member.position;
    const q = t.position;
    const r = Math.max(2, Math.min(so, this._range() - 1));
    let a0 = Math.atan2(p.z - q.z, p.x - q.x);
    if (!Number.isFinite(a0)) a0 = 0;
    sp.t = t;
    sp.ok = false;
    sp.on = false;
    // (a spot on screen first — the player sees what its companions do —, then any)
    for (let pass = 0; pass < 2 && !sp.ok; pass++) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
        const x = q.x + Math.cos(a) * r;
        const z = q.z + Math.sin(a) * r;
        if (Math.hypot(x - P.x, z - P.z) > L || !sys.standable(x, z) || Math.abs(sys.groundAt(x, z) - q.y) > 1.0) continue;
        if (pass === 0 && !sys.projectNdc(x, sys.groundAt(x, z) + SHOT_Y, z, this._ndc, ON_SCREEN)) continue;
        if (!this._enterable(x, z) || !sys.los(x, z, q.x, q.z)) continue;
        sp.x = x;
        sp.z = z;
        sp.ok = true;
        sp.on = pass === 0;
        break;
      }
    }
    return sp.ok ? sp : null;
  }

  /**
   * A shooter that stands one in front of the other with the player on screen (less than
   * `SPACING.lateral` u apart across the screen and `SPACING.depth` u along it: one sprite hides
   * the other) steps aside before it shoots: `SPACING.step` u from the player across the screen —
   * the side it already leans to first, then the other, then each a little toward the camera.
   * A step that is blocked gives way to the shot.
   * @param {number} tx its target
   * @param {number} tz
   * @param {number} h
   * @returns {boolean} it steps
   */
  _spaceOut(tx, tz, h) {
    const sys = this.sys;
    const P = sys.player.position;
    const p = this.member.position;
    const dpx = p.x - P.x;
    const dpz = p.z - P.z;
    // screen right and screen down (toward the camera) on XZ, as Sprite3D.directionFromVector
    const yaw = globalUniforms.uCameraYaw.value;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const lat = dpx * c - dpz * sn;
    const dep = dpx * sn + dpz * c;
    if (Math.abs(lat) >= SPACING.lateral || Math.abs(dep) >= SPACING.depth || this._stuckT >= 0.3) return false;
    const side = Math.abs(lat) > 1e-3 ? Math.sign(lat) : sys.allies.indexOf(this) % 2 === 0 ? 1 : -1;
    for (const [fs, fd] of SPACE_TRIES) {
      // right · (side · fs) + down · fd
      const sx = c * side * fs + sn * fd;
      const sz = -sn * side * fs + c * fd;
      const l = Math.hypot(sx, sz) || 1;
      const x = P.x + (sx / l) * SPACING.step;
      const z = P.z + (sz / l) * SPACING.step;
      if (!sys.standable(x, z) || Math.abs(sys.groundAt(x, z) - P.y) > 0.6 || !this._enterable(x, z)) continue;
      this._goTo(x, z, h, 0.1);
      this._face(tx, tz);
      return true;
    }
    return false;
  }

  /**
   * A melee member's spot to strike `t` from: 0.7 × its reach from the foe, the way from the foe
   * to the member first, then turning either way by 45° steps — standable, at the foe's height
   * (± MELEE_DY), within the leash of the player (+ 0.5 u), by the arena rules and in a clear line
   * to the foe — and not in front of the player on screen (`_covers`: between the player and the
   * camera, where its sprite hides the player's) while another spot is free (`cover` true: none
   * was). The angle is chosen on the plan's beat (and when the target changed); the spot moves
   * with the foe in between. Null: no spot at all.
   * @param {Enemy} t
   * @param {number} reach
   * @param {boolean} replan
   * @returns {{ x: number, z: number, cover: boolean }|null}
   */
  _meleeSpot(t, reach, replan) {
    const sp = this._mspot;
    const q = t.position;
    const r = reach * 0.7;
    if (replan || sp.t !== t) {
      const sys = this.sys;
      const p = this.member.position;
      const P = sys.player.position;
      const L = this._leash() + 0.5;
      const nav = this._arena ? null : sys.nav;
      let a0 = Math.atan2(p.z - q.z, p.x - q.x);
      if (!Number.isFinite(a0)) a0 = 0;
      sp.t = t;
      sp.ok = false;
      sp.cover = false;
      let first = NaN;
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
        const x = q.x + Math.cos(a) * r;
        const z = q.z + Math.sin(a) * r;
        if (Math.hypot(x - P.x, z - P.z) > L || !sys.standable(x, z) || Math.abs(sys.groundAt(x, z) - q.y) > MELEE_DY) continue;
        if (!this._enterable(x, z) || (nav && !nav.lineClear(x, z, q.x, q.z, 0.3))) continue;
        if (!this._covers(x, z)) {
          sp.a = a;
          sp.ok = true;
          break;
        }
        if (Number.isNaN(first)) first = a;
      }
      if (!sp.ok && !Number.isNaN(first)) {
        sp.a = first;
        sp.ok = true;
        sp.cover = true;
      }
    }
    if (!sp.ok) return null;
    sp.x = q.x + Math.cos(sp.a) * r;
    sp.z = q.z + Math.sin(sp.a) * r;
    return sp;
  }

  /**
   * Would a member standing at (x, z) hide the player on screen? In front of the player (toward
   * the camera) by less than `COVER.depth` u and across the screen by less than `COVER.lateral` u
   * — its sprite drawn over the player's body.
   * @param {number} x
   * @param {number} z
   */
  _covers(x, z) {
    const sys = this.sys;
    const P = sys.player.position;
    const v = sys._pv?.velocity;
    const yaw = globalUniforms.uCameraYaw.value;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // where the player stands, and where it walks to in `COVER.ahead` s (a player stepping in
    // behind its companion is hidden as well)
    for (let k = 0; k < 2; k++) {
      const ax = k && v ? v.x * COVER.ahead : 0;
      const az = k && v ? v.z * COVER.ahead : 0;
      if (k && Math.abs(ax) + Math.abs(az) < 0.05) break;
      const dx = x - (P.x + ax);
      const dz = z - (P.z + az);
      const lat = dx * c - dz * sn;
      const dep = dx * sn + dz * c;
      if (Math.abs(lat) < COVER.lateral && dep > COVER.near && dep < COVER.depth) return true;
    }
    return false;
  }

  /**
   * A goal pulled back within the leash of the player.
   * @param {number} x
   * @param {number} z
   * @returns {PointXZ}
   */
  _leashed(x, z) {
    const P = this.sys.player.position;
    const L = this._leash();
    const dx = x - P.x;
    const dz = z - P.z;
    const d = Math.hypot(dx, dz);
    const o = this._goal;
    if (d <= L || d < 1e-6) {
      o.x = x;
      o.z = z;
    } else {
      o.x = P.x + (dx / d) * L;
      o.z = P.z + (dz / d) * L;
    }
    return o;
  }

  // ---- skills ----

  /** Its skill may start now by the rule's `skills` (and `attack`) and its MP / cooldown. */
  _skillReady() {
    const rule = this.rule;
    if (rule.skills === 'never' || rule.attack === 'never' || this.skillCd > 0) return false;
    const S = this.kit.skill;
    if (this.mp < S.mp - EPS) return false;
    // 'save': keep the mana for a heal (only when it heals at all)
    if (rule.skills === 'save' && (HEAL_AT[rule.heal] ?? 0) > 0 && this.mp - S.mp < this.kit.mend.mp - EPS) return false;
    return true;
  }

  /**
   * Does its skill suit `t` now: enough foes around it (or its own feet), or a tough target?
   * @param {Enemy} t
   * @param {number} d its distance to t
   */
  _skillSuits(t, d) {
    const sys = this.sys;
    const p = this.member.position;
    const tough = t.boss || t.elite;
    if (this.cls === 'warden') {
      const S = KIT.warden.skill;
      const n = this._foesNear(p.x, p.z, S.r + 0.3);
      return (n >= S.minFoes || (tough && d <= S.r + t.radius)) && Math.abs(t.position.y - p.y) <= MELEE_DY;
    }
    if (this.cls === 'ranger') {
      const S = KIT.ranger.skill;
      if (d > S.range - 1 || !sys.los(p.x, p.z, t.position.x, t.position.z)) return false;
      return tough || this._foesNear(t.position.x, t.position.z, 3) >= S.minFoes;
    }
    const S = KIT.mystic.skill;
    if (d > S.range || !sys.los(p.x, p.z, t.position.x, t.position.z)) return false;
    return tough || this._foesNear(t.position.x, t.position.z, S.r + 0.4) >= S.minFoes;
  }

  /** Foes (candidates) within r of (x, z). */
  _foesNear(x, z, r) {
    const list = this.sys._enemiesNear(x, z, r, this._near);
    let n = 0;
    for (const e of list) if (!e.passive && e.kind !== 'dummy' && e.state !== 'return') n++;
    return n;
  }

  // ---- heal ----

  /**
   * A Mend it would cast now (`_think`'s heal gate): its rule heals, off cooldown, the MP for it,
   * someone up below the rule's threshold (the other healers' Mends counted). Pure: `active` reads
   * it in the combat's linger after a fight (PC27), where it keeps a healer for that one Mend — or
   * takes it back from the follow when its cooldown or MP comes round before the linger ends. A
   * class without a Mend (the ice mage, the greatshield) has none due.
   * @returns {boolean}
   */
  _mendDue() {
    const at = HEAL_AT[this.rule.heal] ?? 0;
    return at > 0 && !!this.kit.mend && this.healCd <= 0 && this.mp >= this.kit.mend.mp - EPS && this._pickHeal(at) !== null;
  }

  /**
   * Whom to Mend: the lowest HP fraction below `at` — the player or a member up (itself included)
   * — counting the Mends other members are casting at it (`_pending`): a target those will lift to
   * `at` or above is left to them.
   * @param {number} at
   * @param {number} [range] only within this distance of the member (u)
   * @returns {'player'|MemberCombat|null}
   */
  _pickHeal(at, range = Infinity) {
    const sys = this.sys;
    const pc = sys.pc;
    const p = this.member.position;
    /** @type {'player'|MemberCombat|null} */
    let who = null;
    let low = at;
    const P = sys.player.position;
    if (pc.alive && Math.hypot(P.x - p.x, P.z - p.z) <= range) {
      const f = (pc.hp + this._pending('player')) / pc.hpMax;
      if (f < low) {
        low = f;
        who = 'player';
      }
    }
    for (const a of sys.allies) {
      if (!a.present) continue;
      const q = a.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) > range) continue;
      const f = (a.hp + this._pending(a)) / a.hpMax;
      if (f < low - 1e-9) {
        low = f;
        who = a;
      }
    }
    return who;
  }

  /**
   * Is `who` still below `at` with the other members' Mends on their way to it counted?
   * @param {MemberCombat|'player'|null} who
   * @param {number} at
   */
  _healOk(who, at) {
    if (!who) return false;
    const pc = this.sys.pc;
    if (who === 'player') return pc.alive && (pc.hp + this._pending('player')) / pc.hpMax < at;
    return who.present && (who.hp + this._pending(who)) / who.hpMax < at;
  }

  /**
   * HP the other members' Mends being cast at `who` will give it (cast begun, heal frame not yet
   * reached): the heal target is reserved — three healers no longer Mend the same player at once.
   * @param {MemberCombat|'player'} who
   * @returns {number}
   */
  _pending(who) {
    let n = 0;
    for (const b of this.sys.allies) {
      if (b === this || b.action !== 'mend' || b._healWho !== who || b.frame >= b.kit.mend.at) continue;
      n += b._mendAmount(who);
    }
    return n;
  }

  /**
   * HP its Mend gives `who` (before the cap).
   * @param {MemberCombat|'player'} who
   */
  _mendAmount(who) {
    const M = this.kit.mend;
    const max = who === 'player' ? this.sys.pc.hpMax : who.hpMax;
    return Math.round(max * M.frac + M.flat);
  }

  // ---- movement goals ----

  /**
   * Hold a spot ≈ 1.8 u beside the player, on the side away from the foe nearest the player. The
   * spot is planned anew only when the player moved `ALLY.holdReplan` u from where it stood then,
   * or the foe came round to the spot's side of the player (and on the plan's beat while none was
   * found); a member standing there sets off only beyond `ALLY.holdSlack` u (a shove, the player's
   * step) and then walks to within `ALLY.holdStop` u — facing its foe on short steps. Standing, it
   * faces one foe steadily (`_lookFoe`).
   * @param {number} h
   * @param {boolean} replan
   */
  _holdSpot(h, replan) {
    const sys = this.sys;
    const P = sys.player.position;
    const p = this.member.position;
    // (a boss about to come up — its hole glinting, the fight's hints: wait at the window, EVM-06)
    const F = this._hints()?.focus(sys.bossFight);
    if (F && this._focusStep(F, h)) return;
    const foe = this._lookFoe();
    const H = this._hold;
    let again = H.kind !== 'hold' || (replan && !H.ok) || Math.hypot(P.x - H.px, P.z - H.pz) > ALLY.holdReplan;
    // (the foe came round to the spot's side of the player: within 60° of it, seen from the player)
    if (!again && foe && H.ok) {
      const hx = H.x - P.x;
      const hz = H.z - P.z;
      const fx = foe.position.x - P.x;
      const fz = foe.position.z - P.z;
      if (hx * fx + hz * fz > 0.5 * Math.hypot(hx, hz) * Math.hypot(fx, fz)) again = true;
    }
    if (again) {
      H.kind = 'hold';
      H.px = P.x;
      H.pz = P.z;
      let ax;
      let az;
      if (foe) {
        ax = P.x - foe.position.x;
        az = P.z - foe.position.z;
      } else {
        ax = -sys.player.facing.x;
        az = -sys.player.facing.z;
      }
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const k = sys.allies.indexOf(this);
      const side = k % 2 === 0 ? 1 : -1;
      const tries = [[0.55, 0.85 * side], [0.55, -0.85 * side], [1, 0], [0.3, 0.95 * side]];
      this._hold.ok = false;
      for (const [fa, fs] of tries) {
        let dx = ax * fa + -az * fs;
        let dz = az * fa + ax * fs;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        const x = P.x + dx * ALLY.hold * (1 + 0.35 * Math.floor(k / 2));
        const z = P.z + dz * ALLY.hold * (1 + 0.35 * Math.floor(k / 2));
        if (sys.standable(x, z) && Math.abs(sys.groundAt(x, z) - P.y) <= 0.6 && this._enterable(x, z)) {
          this._hold.x = x;
          this._hold.z = z;
          this._hold.ok = true;
          break;
        }
      }
      if (!this._hold.ok) {
        this._hold.x = P.x;
        this._hold.z = P.z;
      }
    }
    // (sets off only beyond the slack, then walks all the way: no shuffle on every small shove)
    const far = Math.hypot(H.x - p.x, H.z - p.z);
    if (this._holdWalk || far > (H.ok ? ALLY.holdSlack : 1.0)) {
      const there = this._goTo(H.x, H.z, h, H.ok ? ALLY.holdStop : 1.0, false, far < ALLY.runFrom ? foe : null);
      this._holdWalk = !there;
      if (!there) return;
    }
    if (foe) this._faceSteady(foe.position.x, foe.position.z);
    this._play('idle');
  }

  /**
   * Wait where a boss comes up next (the fight's hints' `focus`): at 0.7 × its reach (a shooter: its
   * standoff) from the spot's edge, on its own side first, then turning by 45° steps — standable
   * and enterable (out of the holes), and for a melee member not in front of the player on screen
   * while another spot is free (`_covers`: it would only step aside again once the boss is up); it
   * walks there and faces the spot. False: no such spot.
   * @param {{ x: number, z: number, r: number }} F
   * @param {number} h
   * @returns {boolean}
   */
  _focusStep(F, h) {
    const sys = this.sys;
    const p = this.member.position;
    const r = F.r + this._reach() * 0.7;
    let a0 = Math.atan2(p.z - F.z, p.x - F.x);
    if (!Number.isFinite(a0)) a0 = 0;
    for (let pass = this.role === 'melee' ? 0 : 1; pass < 2; pass++) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
        const x = F.x + Math.cos(a) * r;
        const z = F.z + Math.sin(a) * r;
        if (!sys.standable(x, z) || !this._enterable(x, z) || (pass === 0 && this._covers(x, z))) continue;
        this.mode = 'hold';
        this._hold.kind = 'focus';
        this._holdWalk = false;
        if (this._goTo(x, z, h, 0.3)) {
          this._faceSteady(F.x, F.z);
          this._play('idle');
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Face a point while standing — only once it is more than 35° off the facing (`STEADY_COS`; a foe
   * hopping about at a quadrant's edge does not turn the sprite to and fro).
   * @param {number} x
   * @param {number} z
   */
  _faceSteady(x, z) {
    const p = this.member.position;
    const f = this.member.facing;
    const dx = x - p.x;
    const dz = z - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return;
    if ((dx * f.x + dz * f.z) / l >= STEADY_COS) return;
    this._face(x, z);
  }

  /**
   * The foe a holding member faces: the one it faced while it is still alive, awake, in the fight
   * and not more than `LOOK_KEEP` u farther from the player than the nearest such foe (that one
   * otherwise) — no turning to and fro between two foes about as near.
   * @returns {Enemy|null}
   */
  _lookFoe() {
    const near = this._foeNearPlayer();
    const cur = this._lookAt;
    if (cur && near && cur !== near && cur.alive && !cur.dormant && cur.aggro && cur.sprite.visible && !cur.passive) {
      const P = this.sys.player.position;
      if (Math.hypot(cur.position.x - P.x, cur.position.z - P.z) <= Math.hypot(near.position.x - P.x, near.position.z - P.z) + LOOK_KEEP) return cur;
    }
    this._lookAt = near;
    return near;
  }

  /** @param {number} h @param {boolean} replan */
  /**
   * Fall back: a spot `ALLY.retreat` u behind the player, away from the foe nearest the player —
   * planned anew as the hold spot is (`_holdSpot`: the player moved, or the foe's side turned by
   * more than 60°), walked to with the same slack.
   * @param {number} h
   * @param {boolean} replan
   */
  _retreat(h, replan) {
    const sys = this.sys;
    const P = sys.player.position;
    const p = this.member.position;
    const H = this._hold;
    const foe = this._foeNearPlayer() ?? this._foeNearMe();
    let ax = -sys.player.facing.x;
    let az = -sys.player.facing.z;
    if (foe) {
      ax = P.x - foe.position.x;
      az = P.z - foe.position.z;
    }
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    let again = H.kind !== 'retreat' || (replan && !H.ok) || Math.hypot(P.x - H.px, P.z - H.pz) > ALLY.holdReplan;
    if (!again && foe && H.ok) {
      const hx = H.x - P.x;
      const hz = H.z - P.z;
      if (hx * ax + hz * az < 0.5 * Math.hypot(hx, hz)) again = true;
    }
    if (again) {
      H.kind = 'retreat';
      H.px = P.x;
      H.pz = P.z;
      H.x = P.x + ax * ALLY.retreat;
      H.z = P.z + az * ALLY.retreat;
      H.ok = sys.standable(H.x, H.z) && this._enterable(H.x, H.z);
      if (!H.ok) {
        H.x = P.x;
        H.z = P.z;
      }
    }
    const far = Math.hypot(H.x - p.x, H.z - p.z);
    if (this._holdWalk || far > (H.ok ? ALLY.holdSlack : 1.0)) {
      const there = this._goTo(H.x, H.z, h, H.ok ? ALLY.holdStop : 1.0);
      this._holdWalk = !there;
      if (!there) return;
    }
    const near = this._foeNearMe();
    if (near) this._faceSteady(near.position.x, near.position.z);
    this._play('idle');
  }

  /**
   * Outside a closed arena: wait in front of its gate.
   * @param {BossArena} a
   * @param {number} h
   */
  _waitAtGate(a, h) {
    const [x0, z0, x1, z1] = a.gate;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    let ox = mx - a.center.x;
    let oz = mz - a.center.z;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;
    const k = this.sys.allies.indexOf(this);
    const side = (k % 2 === 0 ? 1 : -1) * (0.8 + 0.6 * Math.floor(k / 2));
    let x = mx + ox * 1.6 - oz * side;
    let z = mz + oz * 1.6 + ox * side;
    if (!this.sys.standable(x, z)) {
      x = mx + ox * 2.2;
      z = mz + oz * 2.2;
    }
    if (this._goTo(x, z, h, 0.6)) {
      this._face(mx, mz);
      this._play('idle');
    }
  }

  /** The live, aggroed foe nearest the player (within 16 u), or null. */
  _foeNearPlayer() {
    const P = this.sys.player.position;
    return this._nearestFoe(P.x, P.z, 16, true);
  }

  /** The live foe nearest the member (within 12 u), or null. */
  _foeNearMe() {
    const p = this.member.position;
    return this._nearestFoe(p.x, p.z, 12, false);
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {boolean} aggro only aggroed foes
   * @returns {Enemy|null}
   */
  _nearestFoe(x, z, r, aggro) {
    let best = null;
    let bd = r;
    for (const e of this.sys.enemies) {
      if (!e.alive || e.dormant || !e.sprite.visible || e.passive || (aggro && !e.aggro)) continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Can it go to (x, z) by the arena rules: not into a closed arena from outside, not out of the
   * one it is in — and, in a fight whose boss gives hints (`_hints`), not where the boss's ground
   * hurts (Old Gullet's holes).
   * @param {number} x
   * @param {number} z
   */
  _enterable(x, z) {
    const H = this._hints();
    if (H && H.unsafe(this.sys.bossFight, x, z, ALLY.radius)) return false;
    const a = this.sys.sealedArena();
    if (!a) return true;
    return this._arena ? a.contains(x, z) : !a.containsGrown(x, z, 0.4);
  }

  /**
   * The hints the boss of the fight gives its companions (its brain state's `allyHints`; only Old
   * Gullet's has any, EVM-06 — every other fight, and the party digests, unchanged): `unsafe(boss,
   * x, z, r)` ground to keep off, `evade` the telegraph styles it rolls out of as it does the warm
   * `enemy` one, `focus(boss)` where the boss comes up next (null: nowhere yet).
   * @returns {AllyHints|null}
   */
  _hints() {
    const b = this.sys.bossFight;
    return b?.alive ? (b.ai?.allyHints ?? null) : null;
  }

  /**
   * Walk / run toward (x, z): straight while the walk grid's line is clear (inside a closed arena:
   * always), else along a path of the grid, round the player when it stands in the way (the
   * separation never lets a member push the player: walking into it got nowhere); true when within
   * `near` (it stands). No way there (no path, or stuck `ALLY.stuckGiveUp` s — measured by the net
   * progress of its last move after the frame's separation, not by the move alone): toward its
   * target (`forTarget`) the foe is given up for `ALLY.skipFor` s, else the spot is planned anew.
   * `look`: a foe it faces while it walks (a short step aside or back), else it turns to the way.
   * @param {number} x
   * @param {number} z
   * @param {number} h
   * @param {number} near
   * @param {boolean} [forTarget] the way to its target
   * @param {Enemy|null} [look]
   * @returns {boolean}
   */
  _goTo(x, z, h, near, forTarget = false, look = null) {
    const sys = this.sys;
    const p = this.member.position;
    const d = Math.hypot(x - p.x, z - p.z);
    const gp = this._gp;
    if (d <= near) {
      this._stuckT = 0;
      this._pathN = 0;
      gp.sub = -2;
      return true;
    }
    let tx = x;
    let tz = z;
    const nav = sys.nav;
    if (nav && !this._arena && !nav.lineClear(p.x, p.z, x, z, 0.3)) {
      const stale = this._pathN === 0 || Math.hypot(x - this._pathGX, z - this._pathGZ) > 1.2
        || sys.clock - this._pathAt > 1.5 || this._stuckT >= ALLY.stuckPath;
      if (stale && sys.clock - this._pathAt >= ALLY.pathEvery && sys.allySearches > 0) {
        sys.allySearches--;
        const n = nav.findPath(p.x, p.z, x, z, ALLY.pathMax, this._path);
        this._pathN = Math.max(0, n);
        this._pathI = 0;
        this._pathGX = x;
        this._pathGZ = z;
        this._pathAt = sys.clock;
        if (n < 0) this._giveUp(forTarget);
      }
      if (this._pathN > 0) {
        const k = this._followPath();
        tx = this._path[k * 2];
        tz = this._path[k * 2 + 1];
      }
    } else this._pathN = 0;
    let ux = tx - p.x;
    let uz = tz - p.z;
    const dl = Math.hypot(ux, uz);
    if (dl < 1e-6) {
      ux = x - p.x;
      uz = z - p.z;
    }
    let ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    // the player in the way (ahead within ROUND.ahead u and nearer than the goal, less than the two
    // radii + a margin across the way): turn aside, away from the side it stands on
    const pc = sys.pc;
    if (pc.alive) {
      const P = sys.player.position;
      const ox = P.x - p.x;
      const oz = P.z - p.z;
      const along = ox * ux + oz * uz;
      if (along > 0 && along < Math.min(d, ROUND.ahead) && Math.abs(P.y - p.y) < 1) {
        const across = ox * -uz + oz * ux;
        const clear = ALLY.radius + pc.radius + ROUND.margin;
        if (Math.abs(across) < clear) {
          const s = Math.abs(across) > 1e-3 ? -Math.sign(across) : sys.allies.indexOf(this) % 2 === 0 ? 1 : -1;
          const k = ROUND.turn * (1 - Math.abs(across) / clear);
          const nx = ux - uz * s * k;
          const nz = uz + ux * s * k;
          ul = Math.hypot(nx, nz) || 1;
          ux = nx / ul;
          uz = nz / ul;
        }
      }
    }
    const run = d > ALLY.runFrom;
    const speed = run ? this.base.run : this.base.walk;
    const step = Math.min(d - near * 0.5, speed * h);
    // the net progress of its last move (that sub-step's move, then the frame's separation)
    const net = gp.sub === sys.stepNo - 1 && gp.step > 1e-6
      ? ((p.x - gp.x) * gp.ux + (p.z - gp.z) * gp.uz) / gp.step : NaN;
    gp.x = p.x;
    gp.z = p.z;
    gp.ux = ux;
    gp.uz = uz;
    gp.step = step;
    gp.sub = sys.stepNo;
    const fr = step > 1e-6 ? this._move(ux * step, uz * step, false) : 1;
    if (look) this._face(look.position.x, look.position.z);
    else this._turnTo(ux, uz, h);
    this._play(run ? 'run' : 'walk');
    if ((Number.isNaN(net) ? fr : net) < 0.25) this._stuckT += h;
    else this._stuckT = Math.max(0, this._stuckT - h);
    if (this._stuckT >= ALLY.stuckGiveUp) {
      this._stuckT = 0;
      this._giveUp(forTarget);
    }
    return false;
  }

  /**
   * Turn the facing toward the way it walks, eased over `TURN_TAU` s (a way that wavers about a
   * diagonal — a path's corner, going round the player — does not flip the sprite's row to and fro).
   * @param {number} ux
   * @param {number} uz
   * @param {number} h
   */
  _turnTo(ux, uz, h) {
    const f = this.member.facing;
    const k = Math.min(1, h / TURN_TAU);
    let x = f.x + (ux - f.x) * k;
    let z = f.z + (uz - f.z) * k;
    const l = Math.hypot(x, z);
    if (l < 0.2) {
      // (about to turn round: at once)
      x = ux;
      z = uz;
    } else {
      x /= l;
      z /= l;
    }
    f.x = x;
    f.z = z;
  }

  /** Along the current path: past each waypoint within 0.35 u, or once the next is in a clear line. */
  _followPath() {
    const p = this.member.position;
    const w = this._path;
    const n = this._pathN;
    const nav = this.sys.nav;
    let i = this._pathI;
    while (i < n - 1) {
      const dx = w[i * 2] - p.x;
      const dz = w[i * 2 + 1] - p.z;
      if (dx * dx + dz * dz <= 0.35 * 0.35 || nav.lineClear(p.x, p.z, w[i * 2 + 2], w[i * 2 + 3], 0, true)) i++;
      else break;
    }
    this._pathI = i;
    return i;
  }

  /**
   * The way failed: to its target — leave that foe for a while; the spot is planned anew.
   * @param {boolean} target
   */
  _giveUp(target) {
    if (target && this.target) {
      this._skip.set(this.target, this.sys.clock + ALLY.skipFor);
      this.target = null;
    }
    this._hold.ok = false;
    this._pathN = 0;
    this._planT = 0;
  }

  // ---- evade ----

  /**
   * Standing in an enemy telegraph that is filling (fill in [0.3, 1); magma: always; a style the
   * fight's hints name — Old Gullet's — as the `enemy` one): roll out.
   * @returns {boolean} it rolls
   */
  _evade() {
    const sys = this.sys;
    const p = this.member.position;
    const H = this._hints();
    for (const m of sys._mk) {
      if (m.h < 0 || !m.owner || m.owner === 'core') continue;
      const s = m.spec;
      if (s.style === 'enemy' || (H && H.evade.includes(s.style))) {
        if (s.progress < ALLY.evadeFill - EPS || s.progress >= 1 - EPS) continue;
      } else if (s.style !== 'magma') continue;
      if (!this._escape(s, p.x, p.z)) continue;
      if (this._startRoll(this._esc.x, this._esc.z, s)) {
        this.mode = 'evade';
        return true;
      }
    }
    return false;
  }

  /**
   * Is (x, z) (with the hurt radius) inside the marker? If so `_esc` gets the way out.
   * @param {Required<MarkerSpec>} s
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  _escape(s, x, z) {
    const R = ALLY.radius;
    const dx = x - s.x;
    const dz = z - s.z;
    const d = Math.hypot(dx, dz);
    const o = this._esc;
    const f = this.member.facing;
    switch (s.shape) {
      case 'circle':
      case 'ring': {
        if (d >= s.r + R || (s.shape === 'ring' && d <= (s.rInner ?? 0) - R)) return false;
        if (d > 1e-3) {
          o.x = dx / d;
          o.z = dz / d;
        } else {
          o.x = -f.z;
          o.z = f.x;
        }
        return true;
      }
      case 'sector': {
        if (d >= s.r + R) return false;
        let ax = s.dirX;
        let az = s.dirZ;
        const al = Math.hypot(ax, az) || 1;
        ax /= al;
        az /= al;
        if (d > 1e-3) {
          const cos = (dx * ax + dz * az) / d;
          const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
          if (ang > (s.halfAngle * Math.PI) / 180 + Math.asin(Math.min(1, R / d))) return false;
        }
        const side = dx * -az + dz * ax >= 0 ? 1 : -1;
        o.x = -az * side;
        o.z = ax * side;
        return true;
      }
      case 'lane': {
        let ax = s.dirX;
        let az = s.dirZ;
        const al = Math.hypot(ax, az) || 1;
        ax /= al;
        az /= al;
        const t = dx * ax + dz * az;
        const perp = dx * -az + dz * ax;
        if (t < -R || t > s.len + R || Math.abs(perp) >= s.width / 2 + R) return false;
        const side = perp >= 0 ? 1 : -1;
        o.x = -az * side;
        o.z = ax * side;
        return true;
      }
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------------------------------

  /** @param {AllyAction} action */
  _begin(action) {
    this.action = action;
    this.t = 0;
    this.frame = 0;
    this._prevFrame = -1;
    this._moved = 0;
    this._motion = null;
    this._lastCol = -1;
    this._lastRow = -1;
    this._trk.t = null;
    this.move = null;
  }

  _endAction() {
    this.action = null;
    this._actTarget = null;
    this._motion = null;
    this._lastCol = -1;
    this._lastRow = -1;
    this.move = null;
  }

  /** @param {number} h */
  _advance(h) {
    this.t += h;
    const prev = this.frame;
    this.frame = frameOf(this.t);
    this._prevFrame = prev;
    const a = this.action;
    if ((a === 'shot' || a === 'volley' || a === 'bolt') && this._actTarget?.alive) this._track(this._actTarget, h);
    this._runFrame();
  }

  /**
   * While it aims: the target's velocity (its moves per sub-step, smoothed over `ALLY.leadTau` s)
   * for the shot's lead (`_shoot`).
   * @param {Enemy} t
   * @param {number} h
   */
  _track(t, h) {
    const k = this._trk;
    const q = t.position;
    if (k.t !== t) {
      k.t = t;
      k.vx = 0;
      k.vz = 0;
    } else if (h > 1e-6) {
      const a = Math.min(1, h / ALLY.leadTau);
      k.vx += ((q.x - k.x) / h - k.vx) * a;
      k.vz += ((q.z - k.z) / h - k.vz) * a;
    }
    k.x = q.x;
    k.z = q.z;
  }

  /** Was frame n reached in this sub-step (frame 0 on the action's first)? @param {number} n */
  _at(n) {
    return this._prevFrame < n && this.frame >= n;
  }

  _runFrame() {
    // a hero's own moves (its combo and Mend run the shared frames below)
    if (this.move !== null && this._runHeroMove()) return;
    switch (this.action) {
      case 'a1': case 'a2': this._frameMelee(); break;
      case 'sweep': this._frameSweep(); break;
      case 'shot': case 'volley': this._frameShot(); break;
      case 'bolt': this._frameBolt(); break;
      case 'flare': this._frameFlare(); break;
      case 'mend': this._frameMend(); break;
      case 'roll': this._frameRoll(); break;
      case 'hurt': this._frameHurt(); break;
      case 'knock': this._frameKnock(); break;
      case 'getup': this._frameGetUp(); break;
      default: break;
    }
  }

  /**
   * Show the pose of the frame from a table of [from, to, pose] spans.
   * @param {ReadonlyArray<ReadonlyArray<number|string>>} spans
   */
  _poseSpans(spans) {
    const f = this.frame;
    for (const s of spans) {
      if (f >= /** @type {number} */ (s[0]) && f <= /** @type {number} */ (s[1])) {
        this._pose(String(s[2]));
        return;
      }
    }
  }

  // ---- warden: the spear combo, Sweep (the greatshield's combo: the shield bash and the mace) ----

  /** @param {Enemy} t @param {number} k 0: the first thrust (the bash), 1: the second (the mace) */
  _startMelee(t, k) {
    this._begin(k === 0 ? 'a1' : 'a2');
    if (this.vq) this.move = k === 0 ? 'bash' : 'mace';
    this._actTarget = t;
    if (this.vq) this._cast(this.move);
    this._tag = this.sys.tags.next();
    this.swings++;
    this.counts.attacks++;
    this._face(t.position.x, t.position.z);
    this._runFrame();
  }

  _frameMelee() {
    const kit = /** @type {typeof KIT.warden} */ (this.kit);
    const k = this.action === 'a1' ? 0 : 1;
    const H = /** @type {AllyMeleeHit} */ (kit.combo[k]);
    const f = this.frame;
    const t = this._actTarget;
    if (f >= H.total) {
      // the second thrust follows while the foe is still in reach
      if (k === 0 && t && t.alive && this._candidate(t)) {
        const p = this.member.position;
        const d = Math.hypot(t.position.x - p.x, t.position.z - p.z);
        if (d <= kit.reach + t.radius + 0.4 && Math.abs(t.position.y - p.y) <= MELEE_DY) {
          this._startMelee(t, 1);
          return;
        }
      }
      this.atkCd = kit.comboGap * this._pace();
      this._endAction();
      this._play('idle', true);
      return;
    }
    // the swing turns toward the foe until it strikes
    if (t && t.alive && f < H.active[0]) this._face(t.position.x, t.position.z);
    this._poseSpans(H.poses);
    const fc = this.member.facing;
    this._moveAlong(H.lunge, H.lungeFrames[0], H.lungeFrames[1] + 1, fc.x, fc.z);
    const sys = this.sys;
    const p = this.member.position;
    if (this._at(H.fxAt)) {
      sys.sfxAt(H.sfx, p.x, p.z, { volume: 0.55 });
      // (the greatshield's blows: EarthSpellFx)
      if (this.vq) this._earth?.melee(k, H);
      else sys.fx.play(H.fx, p.x + fc.x * 0.85, p.y, p.z + fc.z * 0.85, { dirX: fc.x, dirZ: fc.z, scale: 0.85 });
    }
    if (f >= H.active[0] && f <= H.active[1]) {
      const s = this._baseSpec(H.mv, H.kb, H.poise);
      s.shape = 'sector';
      s.r = H.r;
      s.halfAngle = H.halfAngle;
      if (H.stun) s.stun = H.stun;
      sys.addAllyHit(this, s, 'melee');
    }
  }

  /** @param {Enemy} t */
  _startSkill(t) {
    if (this.vq) {
      this._startHeroSkill(t);
      return;
    }
    const S = this.kit.skill;
    this.mp -= S.mp;
    this.skillCd = S.cooldown * this._pace();
    this.counts.skills++;
    this._actTarget = t;
    this._face(t.position.x, t.position.z);
    this._tag = this.sys.tags.next();
    const a = this.cls === 'warden' ? 'sweep' : this.cls === 'ranger' ? 'volley' : 'flare';
    this._begin(a);
    this._actTarget = t;
    if (a === 'sweep') this.swings++;
    this._runFrame();
  }

  _frameSweep() {
    const S = KIT.warden.skill;
    const f = this.frame;
    if (f >= S.total) {
      this.atkCd = Math.max(this.atkCd, 0.25);
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose(S.pose);
    const sys = this.sys;
    const p = this.member.position;
    if (this._at(3)) sys.sfxAt('whirl', p.x, p.z, { volume: 0.6 });
    if (this._at(S.active[0] - 2)) sys.fx.play('spin', p.x, p.y, p.z, { follow: p, scale: 0.95 });
    if (f >= S.active[0] && f <= S.active[1]) {
      const s = this._baseSpec(S.mv, S.kb, S.poise);
      s.shape = 'circle';
      s.r = S.r;
      sys.addAllyHit(this, s, 'skill');
    }
  }

  // ---- ranger: arrows, Volley; mystic: the ember bolt, Flare ----

  /** @param {Enemy} t */
  _startShot(t) {
    this._begin(this.cls === 'mystic' || this.vq ? 'bolt' : 'shot');
    // (a caster hero's missile: Holy Bolt, Frost Lance)
    if (this.vq) this.move = /** @type {VqCasterKit} */ (this.kit).basic.id;
    this._actTarget = t;
    if (this.vq) this._cast(this.move);
    this.counts.attacks++;
    this._face(t.position.x, t.position.z);
    this._runFrame();
  }

  _frameShot() {
    const volley = this.action === 'volley';
    const B = KIT.ranger.basic;
    const V = KIT.ranger.skill;
    const total = volley ? V.total : B.total;
    const release = volley ? V.release : B.release;
    const f = this.frame;
    if (f >= total) {
      this.atkCd = Math.max(this.atkCd, B.cooldown * this._pace());
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(volley ? V.poses : B.poses);
    const t = this._actTarget;
    if (t && t.alive && f < release) this._face(t.position.x, t.position.z);
    if (this._at(release)) {
      const sys = this.sys;
      const n = volley ? V.n : 1;
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? 0 : ((i - (n - 1) / 2) * V.spread * Math.PI) / 180;
        this._shoot('arrow', volley ? V : B, t, a, null);
      }
      const p = this.member.position;
      sys.sfxAt('arrow', p.x, p.z, { volume: 0.6 });
    }
  }

  _frameBolt() {
    const B = KIT.mystic.basic;
    const f = this.frame;
    if (f >= B.total) {
      this.atkCd = Math.max(this.atkCd, B.cooldown * this._pace());
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(B.poses);
    const t = this._actTarget;
    if (t && t.alive && f < B.release) this._face(t.position.x, t.position.z);
    if (this._at(B.release)) {
      this._shoot('emberBolt', B, t, 0, B.splash);
      const p = this.member.position;
      this.sys.sfxAt('bolt', p.x, p.z, { volume: 0.55, pitch: 1.15 });
    }
  }

  /**
   * Launch one shot at `t` (aimed at its body middle where it will be when the shot arrives: its
   * tracked velocity × the time of flight, at most `ALLY.leadMax` u; turned by `angle` rad), else
   * along the facing.
   * @param {'arrow'|'emberBolt'} kind
   * @param {{ speed: number, range: number, radius: number, mv: number, kb: number, poise: number }} S
   * @param {Enemy|null} t
   * @param {number} angle
   * @param {{ r: number, mv: number }|null} splash
   */
  _shoot(kind, S, t, angle, splash) {
    const sys = this.sys;
    const p = this.member.position;
    const fc = this.member.facing;
    const s = this._proj;
    s.kind = kind;
    s.x = p.x + fc.x * 0.4;
    s.z = p.z + fc.z * 0.4;
    s.y = p.y + SHOT_Y;
    let dx = fc.x;
    let dz = fc.z;
    let d = 8;
    let aimY = s.y;
    if (t && t.alive) {
      let tx = t.position.x;
      let tz = t.position.z;
      const k = this._trk;
      if (k.t === t) {
        // (the time of flight to the led point, twice)
        let lx = 0;
        let lz = 0;
        for (let i = 0; i < 2; i++) {
          const tof = Math.hypot(tx + lx - s.x, tz + lz - s.z) / S.speed;
          lx = k.vx * tof;
          lz = k.vz * tof;
        }
        const ll = Math.hypot(lx, lz);
        if (ll > ALLY.leadMax) {
          lx *= ALLY.leadMax / ll;
          lz *= ALLY.leadMax / ll;
        }
        tx += lx;
        tz += lz;
      }
      dx = tx - s.x;
      dz = tz - s.z;
      d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        dx /= d;
        dz /= d;
      } else {
        dx = fc.x;
        dz = fc.z;
      }
      const b = t.def.body;
      aimY = sys.bodyBase(t) + (b[0] + b[1]) / 2;
    }
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    s.dirX = dx * c - dz * sn;
    s.dirZ = dx * sn + dz * c;
    s.vy = aimVy(s.y, aimY, S.speed, d);
    s.speed = S.speed;
    s.range = S.range;
    s.radius = S.radius;
    s.mv = S.mv;
    s.kb = S.kb;
    s.poise = S.poise;
    s.pierce = false;
    s.splash = splash;
    s.arc = null;
    sys.spawnAllyProjectile(this, s);
  }

  _frameFlare() {
    const S = KIT.mystic.skill;
    const f = this.frame;
    if (f >= S.total) {
      this.atkCd = Math.max(this.atkCd, 0.3);
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose(S.pose);
    const t = this._actTarget;
    if (t && t.alive && f < S.at) this._face(t.position.x, t.position.z);
    if (this._at(S.at)) {
      const sys = this.sys;
      const p = this.member.position;
      const q = t && t.alive ? t.position : null;
      const x = q ? q.x : p.x + this.member.facing.x * 4;
      const z = q ? q.z : p.z + this.member.facing.z * 4;
      const fl = this._flares.find((o) => !o.on);
      if (fl) {
        fl.on = true;
        fl.x = x;
        fl.z = z;
        fl.y = sys.groundAt(x, z);
        fl.t = S.delay;
        fl.tag = sys.tags.next();
        sys.burst('sparkle', x, fl.y + 0.4, z, 6);
      }
      sys.sfxAt('bolt', p.x, p.z, { volume: 0.45, pitch: 0.8 });
    }
  }

  /** Pending Flares count down and burst (a circle hit on the spot). @param {number} h */
  _stepFlares(h) {
    const sys = this.sys;
    for (const fl of this._flares) {
      if (!fl.on) continue;
      fl.t -= h;
      if (fl.t > EPS) {
        // a few sparks rise from the spot while it gathers (every ~0.15 s)
        if (Math.floor((fl.t + h) / 0.15) !== Math.floor(fl.t / 0.15)) sys.burst('emberBurst', fl.x, fl.y + 0.2, fl.z, 2);
        continue;
      }
      fl.on = false;
      const S = KIT.mystic.skill;
      const s = this._spec;
      s.shape = 'circle';
      s.x = fl.x;
      s.y = fl.y;
      s.z = fl.z;
      s.r = S.r;
      s.rInner = 0;
      s.dirX = 0;
      s.dirZ = 1;
      s.dy = MELEE_DY;
      s.mv = S.mv;
      s.kb = S.kb;
      s.poise = S.poise;
      s.knockdown = false;
      s.flat = 0;
      s.thin = false;
      s.tag = fl.tag;
      s.fromX = fl.x;
      s.fromZ = fl.z;
      sys.addAllyHit(this, s, 'skill');
      sys.fx.play('impact', fl.x, fl.y, fl.z, { scale: 1.5 });
      sys.burst('magicBurst', fl.x, fl.y + 0.6, fl.z, 16);
      sys.burst('emberBurst', fl.x, fl.y + 0.3, fl.z, 10);
      sys.sfxAt('hexBurst', fl.x, fl.z, { volume: 0.7 });
    }
  }

  // ---- Mend ----

  _startMend() {
    const M = this.kit.mend;
    this.mp -= M.mp;
    this.healCd = M.cooldown;
    this._begin('mend');
    if (this.vq) {
      this.move = 'mend';
      this._cast('mend');
    }
    const who = this._healWho;
    const q = who === 'player' ? this.sys.player.position : who && who !== this ? who.position : null;
    if (q) this._face(q.x, q.z);
    this._runFrame();
  }

  _frameMend() {
    const M = this.kit.mend;
    const f = this.frame;
    if (f >= M.total) {
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose(f < M.at + 4 ? 'cast' : 'follow');
    if (this._at(M.at)) {
      const sys = this.sys;
      let who = this._healWho;
      // still needed? (a draught, another Mend or a level-up may have filled it meanwhile): else
      // the lowest other one below the threshold within reach, else it heals what it can when
      // that is at least half its Mend — or the cast fizzles and gives the MP back
      const at = HEAL_AT[this.rule.heal] ?? 0;
      if (!this._needsHeal(who, at)) {
        const other = this._pickHeal(at, M.range + 1);
        if (other) who = other;
        else if (!who || this._missing(who) < this._mendAmount(who) * 0.5) {
          this._healWho = null;
          this.mp = Math.min(this.mpMax, this.mp + M.mp);
          this.healCd = Math.min(this.healCd, MEND_FIZZLE_CD);
          this._holy?.fizzled();
          this._endAction();
          this._play('idle', true);
          return;
        }
      }
      this._healWho = null;
      let got = 0;
      let q = null;
      if (who === 'player') {
        if (sys.pc.alive) {
          got = sys.pc.heal(Math.round(sys.pc.hpMax * M.frac + M.flat));
          q = sys.player.position;
        }
      } else if (who) {
        const a = /** @type {MemberCombat} */ (who);
        got = a.heal(Math.round(a.hpMax * M.frac + M.flat));
        q = a.position;
      }
      const p = this.member.position;
      if (this.vq) {
        // (the cleric's: HolySpellFx)
        this._holy?.mended(q);
        sys.sfxAt('sanctuary', p.x, p.z, { volume: 0.45, pitch: 1.5 });
      } else {
        sys.burst('healGlow', p.x, p.y + 1.2, p.z, 6);
        if (q) sys.burst('healGlow', q.x, q.y + 0.9, q.z, 12);
        sys.sfxAt('pickup', p.x, p.z, { volume: 0.55, pitch: 0.75 });
      }
      this.counts.heals++;
      this.counts.healed += got;
      sys.events.emit('allyHeal', this.id, who === 'player' ? 'player' : who?.id ?? null, got);
    }
  }

  /**
   * Is `who` (up) below `at` of its max HP now?
   * @param {MemberCombat|'player'|null} who
   * @param {number} at
   */
  _needsHeal(who, at) {
    if (!who) return false;
    const pc = this.sys.pc;
    if (who === 'player') return pc.alive && pc.hp / pc.hpMax < at;
    return who.present && who.hp / who.hpMax < at;
  }

  /**
   * HP `who` lacks (0 when it cannot be healed: down, gone, the player fallen).
   * @param {MemberCombat|'player'} who
   */
  _missing(who) {
    const pc = this.sys.pc;
    if (who === 'player') return pc.alive ? Math.max(0, pc.hpMax - pc.hp) : 0;
    return who.present ? Math.max(0, who.hpMax - who.hp) : 0;
  }

  // ---- roll, hurt, knockdown, down, get up ----

  /**
   * Roll along (dx, dz) — or the first of ±30°, ±60° whose landing is standable, one step up or
   * down, out of the marker `s` and within the arena rules.
   * @param {number} dx
   * @param {number} dz
   * @param {Required<MarkerSpec>} s
   * @returns {boolean} started
   */
  _startRoll(dx, dz, s) {
    const sys = this.sys;
    const p = this.member.position;
    const D = ALLY.roll.dist;
    const y0 = sys.groundAt(p.x, p.z);
    const out = this._esc;
    for (const a of ROLL_TRIES) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const rx = dx * c - dz * sn;
      const rz = dx * sn + dz * c;
      const x = p.x + rx * D;
      const z = p.z + rz * D;
      const mx = p.x + rx * D * 0.5;
      const mz = p.z + rz * D * 0.5;
      if (!sys.standable(x, z) || !sys.standable(mx, mz)) continue;
      if (Math.abs(sys.groundAt(mx, mz) - y0) > 0.55 || Math.abs(sys.groundAt(x, z) - sys.groundAt(mx, mz)) > 0.55) continue;
      if (!this._enterable(x, z)) continue;
      if (this._escape(s, x, z)) continue;
      this._begin('roll');
      this.rollCd = ALLY.roll.cooldown;
      this.counts.rolls++;
      this.member.facing.x = rx;
      this.member.facing.z = rz;
      this._motion = { dist: D, f0: 0, f1: ALLY.roll.moveFrames + 1, dx: rx, dz: rz };
      sys.burst('footstep', p.x, p.y + 0.05, p.z, 4);
      sys.sfxAt('dodge', p.x, p.z, { volume: 0.5 });
      this._runFrame();
      return true;
    }
    // (_escape overwrote `_esc` with the last landing tested)
    out.x = dx;
    out.z = dz;
    return false;
  }

  _frameRoll() {
    const R = ALLY.roll;
    if (this.frame >= R.total) {
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(R.poses);
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz);
  }

  /**
   * An enemy hit landed (core computed the damage; the member is hittable): HP, reaction.
   * @param {number} damage
   * @param {number} kb
   * @param {number} dirX
   * @param {number} dirZ
   * @param {boolean} knockdown
   * @returns {'hurt'|'knockdown'|'armor'|'down'}
   */
  takeHit(damage, kb, dirX, dirZ, knockdown) {
    this.hp = Math.max(0, this.hp - damage);
    this.flashT = PLAYER_FLASH.time;
    this.counts.hurts++;
    this.counts.damageTaken += damage;
    if (this.hp <= 0) {
      this._goDown();
      return 'down';
    }
    if (this.vq) {
      if (this._heroArmor(kb, knockdown, dirX, dirZ)) return 'armor';
    } else {
      if (this.action === 'sweep' && this.frame <= KIT.warden.skill.armor) return 'armor';
      if (!(kb > 0) && !knockdown && (this.action === 'mend' || this.action === 'flare')) return 'armor';
    }
    this.shove(kb, dirX, dirZ, knockdown);
    return this.action === 'knock' ? 'knockdown' : 'hurt';
  }

  /**
   * Flat damage (magma): HP and the flash only — no reaction (as the player's `hurtFlat`).
   * @param {number} damage
   */
  hurtFlat(damage) {
    this.hp = Math.max(0, this.hp - damage);
    this.flashT = PLAYER_FLASH.time;
    this.counts.hurts++;
    this.counts.damageTaken += damage;
    if (this.hp <= 0) this._goDown();
  }

  /**
   * Hit stun (or a knockdown) with a slide along (dirX, dirZ); also a push without damage.
   * @param {number} kb
   * @param {number} dirX
   * @param {number} dirZ
   * @param {boolean} [knockdown]
   */
  shove(kb, dirX, dirZ, knockdown = false) {
    if (this.down || this.gone) return;
    const down = knockdown || kb >= ALLY.knockdown.kb;
    // the greatshield stands its ground against a push (its super armour, PARTY.md §12.2)
    if (this.cls === 'greatshield' && !down && this.action !== 'roll') return;
    this._begin(down ? 'knock' : 'hurt');
    this._motion = { dist: Math.min(ALLY.kbCap, Math.max(0, kb)), f0: 0, f1: down ? ALLY.knockdown.slide : ALLY.hurt.slide, dx: dirX, dz: dirZ };
    if (Math.hypot(dirX, dirZ) > 1e-3) {
      this.member.facing.x = -dirX;
      this.member.facing.z = -dirZ;
    }
    this._runFrame();
  }

  _frameHurt() {
    const H = ALLY.hurt;
    if (this.frame >= H.total) {
      this.iframes = Math.max(this.iframes, H.iframes);
      this.blink = true;
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose('hurt');
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz, false);
  }

  _frameKnock() {
    const K = ALLY.knockdown;
    if (this.frame >= K.down + K.getUp) {
      this.iframes = Math.max(this.iframes, K.iframes);
      this.blink = true;
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose(this.frame < K.down ? 'down' : 'tuck');
    const m = this._motion;
    if (m) this._moveAlong(m.dist, m.f0, m.f1, m.dx, m.dz, false);
  }

  /** HP 0: down until the fight is over; foes after it turn back to the player. */
  _goDown() {
    this._endAction();
    this.down = true;
    this.hp = 0;
    this.target = null;
    this._healWho = null;
    this.counts.downs++;
    this.iframes = 0;
    this.blink = false;
    if (this.vq) this._reviveWho = null;
    this._pose('down');
    const sys = this.sys;
    const p = this.member.position;
    sys.sfxAt('playerDown', p.x, p.z, { volume: 0.45, pitch: 1.2 });
    sys.burst('hitSpark', p.x, p.y + 0.6, p.z, 6);
    sys.onAllyDown(this);
  }

  /** Out of the fight long enough: up with `ALLY.getUp` of its HP. */
  _getUp() {
    this.down = false;
    this.hp = Math.max(1, Math.round(this.hpMax * ALLY.getUp));
    this._begin('getup');
    const sys = this.sys;
    const p = this.member.position;
    sys.burst('healGlow', p.x, p.y + 0.8, p.z, 6);
    sys.events.emit('allyUp', this.id);
    this._runFrame();
  }

  _frameGetUp() {
    if (this.frame >= ALLY.getUpFrames) {
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._pose('tuck');
  }

  // ------------------------------------------------------------------------------------------
  // Helpers: hit specs, facing, poses, displacement
  // ------------------------------------------------------------------------------------------

  /**
   * Its HitSpec at its feet along the facing (reused; the queue copies it). A hero's statuses and
   * feel are cleared (a hit sets its own).
   * @param {number} mv
   * @param {number} kb
   * @param {number} poise
   * @returns {HitSpec}
   */
  _baseSpec(mv, kb, poise) {
    const s = this._spec;
    if (this.vq) {
      s.chill = undefined;
      s.slow = undefined;
      s.freeze = undefined;
      s.stun = undefined;
      s.feel = undefined;
    }
    const p = this.member.position;
    const f = this.member.facing;
    s.shape = 'sector';
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.r = 1;
    s.rInner = 0;
    s.dirX = f.x;
    s.dirZ = f.z;
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
    s.tag = this._tag;
    s.fromX = p.x;
    s.fromZ = p.z;
    return s;
  }

  /** Face a world point (sets the facing; a shown pose turns with it next frame). @param {number} x @param {number} z */
  _face(x, z) {
    const p = this.member.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return;
    this.member.facing.x = dx / l;
    this.member.facing.z = dz / l;
    if (!this.action && this.member.sprite) this.member.sprite.faceVector(dx, dz);
  }

  /**
   * A combat pose in the row of the facing (seen from the camera yaw), as PlayerCombat's `_pose`.
   * A sheet without combat poses (no `poses`) stands idle instead.
   * @param {string} name
   */
  _pose(name) {
    const s = this.member.sprite;
    if (!s) return;
    const poses = /** @type {{ poses?: Record<string, number> }} */ (s.sheet).poses;
    if (!poses) {
      this._play('idle');
      return;
    }
    const col = poses[name] ?? 0;
    const f = this.member.facing;
    const dir = Sprite3D.directionFromVector(f.x, f.z, globalUniforms.uCameraYaw.value, s.direction);
    const row = Math.max(0, DIRECTIONS.indexOf(dir));
    if (col === this._lastCol && row === this._lastRow && s.animation === null) return;
    s.direction = dir;
    s.setFrame(col, row);
    this._lastCol = col;
    this._lastRow = row;
    this._anim = '';
  }

  /**
   * A locomotion animation (resolved with the facing): no-op while it already plays.
   * @param {'idle'|'walk'|'run'} name
   * @param {boolean} [force] also after a pose
   */
  _play(name, force = false) {
    const s = this.member.sprite;
    if (!s) return;
    // (the cache is trusted only while the sprite still plays it: the follow plays its own)
    if (!force && this._anim === name && s.animation !== null && s.animation.startsWith(name)) {
      const f = this.member.facing;
      s.faceVector(f.x, f.z);
      return;
    }
    const f = this.member.facing;
    s.faceVector(f.x, f.z);
    s.play(name);
    this._anim = name;
    this._lastCol = -1;
    this._lastRow = -1;
  }

  /**
   * Move a total of `dist` u along (dx, dz), eased out between frames f0 and f1 (exclusive).
   * @param {number} dist
   * @param {number} f0
   * @param {number} f1
   * @param {number} dx
   * @param {number} dz
   * @param {boolean} [face] turn the facing with the motion (a lunge, a roll: it already faces it)
   */
  _moveAlong(dist, f0, f1, dx, dz, face = false) {
    if (!(dist > 0)) return;
    const t0 = F(f0);
    const t1 = F(f1);
    const u = Math.max(0, Math.min(1, (this.t - t0) / (t1 - t0)));
    const target = (1 - (1 - u) * (1 - u)) * dist;
    const step = target - this._moved;
    this._moved = target;
    if (step > 1e-6) this._move(dx * step, dz * step, face);
  }

  /**
   * Displace through the member's own `moveBy` (the TileMap, radius 0.3, step 0.55; no collider
   * of its own; x / z only — the party keeps it on the ground): never into a closed arena from
   * outside, never out of the one it is in (the move is cut to the rect first). `face`: turn the
   * facing toward the move (moveBy does); else the facing it had is kept (a slide, a push).
   * @param {number} dx
   * @param {number} dz
   * @param {boolean} face
   * @returns {number} the fraction of the requested move achieved
   */
  _move(dx, dz, face) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return 1;
    const m = this.member;
    const p = m.position;
    const a = this.sys.sealedArena();
    if (a) {
      if (this._arena) {
        const r = a.rect;
        dx = Math.min(r.maxX - 0.35, Math.max(r.minX + 0.35, p.x + dx)) - p.x;
        dz = Math.min(r.maxZ - 0.35, Math.max(r.minZ + 0.35, p.z + dz)) - p.z;
        if (Math.hypot(dx, dz) < 1e-9) return 0;
      } else if (a.containsGrown(p.x + dx, p.z + dz, 0.4) && !a.containsGrown(p.x, p.z, 0.4)) return 0;
    }
    const x0 = p.x;
    const z0 = p.z;
    const fx = m.facing.x;
    const fz = m.facing.z;
    m.moveBy(dx, dz);
    if (!face) {
      m.facing.x = fx;
      m.facing.z = fz;
    }
    return Math.min(1, Math.hypot(p.x - x0, p.z - z0) / len);
  }

  /**
   * A push of the separation (no facing change).
   * @param {number} dx
   * @param {number} dz
   */
  push(dx, dz) {
    this._move(dx, dz, false);
  }

  /** Put it at (x, z) at once (the arena's placement). @param {number} x @param {number} z */
  placeAt(x, z) {
    this.member.placeAt(x, z);
    this.onTeleport();
  }

  // ------------------------------------------------------------------------------------------
  // Per frame (CombatSystem.afterPlayer)
  // ------------------------------------------------------------------------------------------

  /**
   * After the player moved: velocity for the view, the pose row after camera turns, the hurt flash,
   * the i-frame blink, the sprite speed (0 in hit-stop, the player's time scale; 1 again when the
   * follow takes over).
   * @param {number} dt real seconds of the frame
   * @param {boolean} active the combat ran this frame
   * @param {boolean} playing the game is in play mode
   * @param {number} realAdvanced combat seconds advanced this frame
   */
  afterFrame(dt, active, playing, realAdvanced) {
    const s = this.member.sprite;
    if (this.gone || !s) return;
    const sys = this.sys;
    const p = this.member.position;
    if (active && dt > 0) {
      this.view.velocity.x = (p.x - this._prevX) / dt;
      this.view.velocity.z = (p.z - this._prevZ) / dt;
    }
    this._prevX = p.x;
    this._prevZ = p.z;
    const fighting = this.active;
    // the pose row after a camera turn
    if ((this.action || this.down) && this._lastCol >= 0) {
      const f = this.member.facing;
      const dir = Sprite3D.directionFromVector(f.x, f.z, globalUniforms.uCameraYaw.value, s.direction);
      const row = Math.max(0, DIRECTIONS.indexOf(dir));
      if (row !== this._lastRow) {
        s.direction = dir;
        s.setFrame(this._lastCol, row);
        this._lastRow = row;
      }
    }
    // hurt flash, i-frame blink
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - realAdvanced);
      if (!this._flashOn) s.setFlash(PLAYER_FLASH.r, PLAYER_FLASH.g, PLAYER_FLASH.b, PLAYER_FLASH.a);
      this._flashOn = true;
    } else if (this._flashOn) {
      s.setFlash(0, 0, 0, 0);
      this._flashOn = false;
    }
    if (this.blink && this.iframes <= 0) this.blink = false;
    const hide = this.blink && !this.down && Math.floor(sys.clock * BLINK_HZ * 2) % 2 === 1;
    if (s.mesh.visible === hide) s.mesh.visible = !hide;
    // animation speed while the combat drives it
    if (fighting) {
      s.speed = !playing ? 1 : !active || sys.stop > 0 ? 0 : sys.playerScale;
      this._speedSet = true;
    } else if (this._speedSet) {
      s.speed = 1;
      this._speedSet = false;
    }
    // a hero's effect quads (their timing is the combat clock's, `_stepHero`)
    if (this._fx) this._writeHeroFx(realAdvanced);
  }

  // ------------------------------------------------------------------------------------------
  // Tests
  // ------------------------------------------------------------------------------------------

  /**
   * Its state (`__game.combat.allies()`, `state().combat.allies`); a hero adds `hero` (its move,
   * the second skill's, the raise's and the gap's cooldowns, what it cast, its missiles, spells and
   * quads — PARTY.md §12.6).
   * @returns {AllyState & { hero?: HeroState }}
   */
  info() {
    if (!this.gone) this.syncLevel();
    const p = this.member.position;
    const r3 = (v) => +v.toFixed(3);
    return {
      id: this.id, name: this.member.name, cls: this.cls, preset: presetOf(this.rule), level: this.level,
      hp: Math.ceil(this.hp), hpMax: this.hpMax, mp: r3(this.mp), mpMax: this.mpMax, atk: r3(this.atk), def: r3(this.def),
      down: this.down, active: this.active, mode: this.mode, action: this.action, actionFrame: this.frame,
      target: this.target?.uid ?? null, targetedBy: this.sys.targetedBy(this), kills: this.kills,
      x: r3(p.x), z: r3(p.z), invulnerable: this.invulnerable,
      cooldowns: { attack: r3(this.atkCd), skill: r3(this.skillCd), heal: r3(this.healCd), roll: r3(this.rollCd) },
      counts: { ...this.counts },
      ...(this.vq ? { hero: this.heroInfo() } : {}),
    };
  }

  /** A hero's own state (`info().hero`). @returns {HeroState} */
  heroInfo() {
    const r3 = (v) => +v.toFixed(3);
    return {
      move: this.move, skill2: r3(this.skill2Cd), revive: r3(this.reviveCd), gap: r3(this.gapCd), casts: { ...this.casts },
      missiles: this._missiles.filter((m) => m.on).length, fields: this._fields.filter((f) => f.on).length,
      quads: (this._fx ? this._fx.count : 0) + (this._ice ? this._ice.count : 0) + (this._holy ? this._holy.count : 0) + (this._earth ? this._earth.count : 0),
      reviving: this._reviveWho?.id ?? null,
      ...(this._ice ? { ice: this._ice.info() } : {}),
      ...(this._holy ? { holy: this._holy.info() } : {}),
      ...(this._earth ? { earth: this._earth.info() } : {}),
    };
  }

  // ==========================================================================================
  // The heroes of Vanquish the Evil Dragon (PARTY.md §12; DRAGON_CAMPAIGN.md §6.8)
  // ==========================================================================================
  //
  // The cleric (Holy Bolt, Judgement, Sanctuary, a strong Mend, the raise), the ice mage (Frost
  // Lance, Blizzard, Glacial Tomb; no heal) and the greatshield (the shield bash and the mace,
  // Bulwark, Earthshatter; super armour). Their missiles and spells on the ground are driven here,
  // on the combat clock, and drawn as quads of the combat's FX batch (the atlas frames of
  // src/engine/pixel/fx/partyFx.js; ground glyphs lie flat, never an enemy-style marker); their
  // bursts are the presets of src/engine/fx/presets/party.js, which share the combat's warmed burst
  // pools — no new material, pool, program or light (the ice mage's look excepted: IceSpellFx.js,
  // its own programs warmed at load where an ice mage can fight, the game's combat VFX lights, the
  // moves themselves unchanged). Hits go through `addAllyHit` with the
  // statuses and the feel of the combat core's HitSpec (`chill`, `slow`, `freeze`, `stun`,
  // `feel`); the party-wide ward and the taunt are `sys.ward` / `sys.taunt`.

  // ---- the AI ----

  /**
   * A hero's decision (as `_think`, PARTY.md §5.4, with the heroes' additions, §12.4): the gate,
   * evade; the cleric raises a fallen member, then casts Sanctuary on the hurt, then Mends; retreat;
   * fight (its two skills by `_heroSkill`); hold.
   * @param {number} h
   */
  _thinkHero(h) {
    const sys = this.sys;
    const rule = this.rule;
    const kit = this.heroKit;
    this._planT -= h;
    const replan = this._planT <= 0;
    if (replan) this._planT = Math.max(this._planT + ALLY.planEvery, 0.05);
    const sealed = sys.sealedArena();
    if (sealed && !this._arena) {
      this.mode = 'wait';
      this.target = null;
      this._waitAtGate(sealed, h);
      return;
    }
    if (rule.evade === 'on' && this.rollCd <= 0 && this._evade()) return;
    const healAt = HEAL_AT[rule.heal] ?? 0;
    if (healAt > 0 && kit.revive && this._reviveStep(h, replan)) return;
    if (healAt > 0 && this.cls === 'cleric' && this._sanctuaryStep(h, healAt)) return;
    const keep = this._reserve();
    const critical = keep > 0 && this._playerCritical();
    if (healAt > 0 && kit.mend && this.healCd <= 0 && (this.mp - kit.mend.mp >= keep - EPS || (critical && this.mp >= kit.mend.mp - EPS))) {
      if (replan || !this._healOk(this._healWho, healAt)) this._healWho = this._pickHeal(healAt);
      // (on the raise's MP only for the player in danger)
      if (this.mp - kit.mend.mp < keep - EPS) this._healWho = 'player';
      const who = this._healWho;
      if (who) {
        const q = who === 'player' ? sys.player.position : who.position;
        const p = this.member.position;
        this.mode = 'heal';
        if (Math.hypot(q.x - p.x, q.z - p.z) <= kit.mend.range) {
          this._startMend();
          return;
        }
        this._goTo(q.x, q.z, h, kit.mend.range - 1);
        return;
      }
    } else this._healWho = null;
    if (this.hp < this.hpMax * (RETREAT_AT[rule.retreat] ?? 0)) {
      this.mode = 'retreat';
      this.target = null;
      this._retreat(h, replan);
      return;
    }
    if (rule.attack !== 'never') {
      if (replan || (this.target !== null && !this._candidate(this.target))) this.target = this._pickTarget();
      const t = this.target;
      if (t && this._fight(t, h, replan)) {
        this.mode = 'attack';
        return;
      }
    } else this.target = null;
    this.mode = 'hold';
    this._holdSpot(h, replan);
  }

  /**
   * May a skill start by the rule (`skills`, `attack`), its MP and cooldown and the gap after the
   * other skill? 'save' keeps the MP of a Mend (the cleric; the others have none to keep).
   * @param {VqSkill} S
   * @param {number} cd its cooldown now
   */
  _heroReady(S, cd) {
    const rule = this.rule;
    if (rule.skills === 'never' || rule.attack === 'never' || cd > 0 || this.gapCd > 0) return false;
    if (this.mp < S.mp - EPS) return false;
    const M = this.kit.mend;
    if (rule.skills === 'save' && M && (HEAL_AT[rule.heal] ?? 0) > 0 && this.mp - S.mp < M.mp - EPS) return false;
    // (the cleric's Judgement keeps the raise's and a Mend's MP, or `keep` of her max, the more)
    if (S.keep !== undefined) {
      const R = this.heroKit.revive;
      if (this.mp - S.mp < Math.max((R?.mp ?? 0) + (M?.mp ?? 0), S.keep * this.mpMax) - EPS) return false;
    }
    return true;
  }

  /**
   * The MP the cleric keeps through Mend and Sanctuary: the raise's (a member who falls is raised at
   * once, `_reviveStep` — rv-play #5); 0 for the others.
   */
  _reserve() {
    const R = this.vq ? this.heroKit.revive : null;
    return R ? R.mp : 0;
  }

  /** The player below the kit's `critical` fraction of its HP (the cleric spends her reserve on it). */
  _playerCritical() {
    const pc = this.sys.pc;
    const c = /** @type {VqCasterKit} */ (this.kit).critical ?? 0;
    return pc.alive && pc.hp < pc.hpMax * c;
  }

  /**
   * Which of its two skills suits `t` now (sets `_next`; PARTY.md §12.4)? The cleric's Judgement
   * (Sanctuary is a heal: `_sanctuaryStep`); the ice mage's Glacial Tomb on a crowd of 4 or a tough
   * foe, else Blizzard on a crowd of 3, else the Tomb on 3; the greatshield's Bulwark when foes
   * press someone else or crowd it, else Earthshatter on the foes round it.
   * @param {Enemy} t
   * @param {number} d its distance to t
   * @returns {boolean}
   */
  _heroSkill(t, d) {
    this._next = null;
    const kit = /** @type {VqCasterKit & VqMeleeKit} */ (this.kit);
    const S1 = kit.skill;
    const S2 = kit.skill2;
    const r1 = this._heroReady(S1, this.skillCd);
    const r2 = this.cls !== 'cleric' && this._heroReady(S2, this.skill2Cd);
    if (!r1 && !r2) return false;
    const sys = this.sys;
    const p = this.member.position;
    const q = t.position;
    const tough = t.boss || t.elite;
    if (this.cls === 'greatshield') {
      if (r1 && this._bulwarkSuits(S1)) this._next = 'skill';
      else if (r2 && Math.abs(q.y - p.y) <= MELEE_DY) {
        const n = this._fightersNear(p.x, p.z, VQ_AI.quakeReach);
        if (n >= S2.minFoes || (tough && d <= kit.reach + t.radius + 0.4)) this._next = 'skill2';
      }
      return this._next !== null;
    }
    // casters: within the spell's range with a line of sight, then the crowd round the spot
    const spot = this._spellSpot(t);
    const dSpot = Math.hypot(spot.x - p.x, spot.z - p.z);
    const seen = sys.los(p.x, p.z, q.x, q.z);
    if (!seen) return false;
    if (this.cls === 'cleric') {
      if (r1 && dSpot <= S1.range && (tough || this._fightersNear(spot.x, spot.z, VQ_AI.judgementReach) >= S1.minFoes)) this._next = 'skill';
      return this._next !== null;
    }
    const nTomb = this._fightersNear(spot.x, spot.z, VQ_AI.tombReach);
    const nStorm = this._fightersNear(spot.x, spot.z, VQ_AI.blizzardReach);
    if (r2 && dSpot <= S2.range && (nTomb >= S2.minFoes + 1 || tough)) this._next = 'skill2';
    else if (r1 && !t.boss && dSpot <= S1.range && nStorm >= S1.minFoes) this._next = 'skill';
    else if (r2 && dSpot <= S2.range && nTomb >= S2.minFoes) this._next = 'skill2';
    return this._next !== null;
  }

  /**
   * Bulwark suits: foes within its reach after someone else (the player, another member) —
   * `VQ_AI.bulwarkOthers` — or `bulwarkCrowd` of them at all, or the player hurt below `hurtAt`
   * with a foe on it.
   * @param {VqSkill} S
   */
  _bulwarkSuits(S) {
    const sys = this.sys;
    const p = this.member.position;
    const list = sys._enemiesNear(p.x, p.z, S.r, this._near);
    let all = 0;
    let others = 0;
    for (const e of list) {
      if (!this._fighter(e)) continue;
      all++;
      if (e.target !== this && !e.boss) others++;
    }
    if (others >= VQ_AI.bulwarkOthers || all >= VQ_AI.bulwarkCrowd) return true;
    const pc = sys.pc;
    if (pc.alive && pc.hp < pc.hpMax * S.hurtAt) {
      const P = sys.player.position;
      return this._fightersNear(P.x, P.z, 3) >= 1 && Math.hypot(P.x - p.x, P.z - p.z) <= S.r;
    }
    return false;
  }

  /**
   * A foe in the fight (a hero's area skill counts only these: a pack asleep nearby is not pulled
   * into it): alive, awake and aggroed (or the player's lock-on), no dummy, not walking home.
   * @param {Enemy} e
   */
  _fighter(e) {
    if (!e.alive || e.dormant || e.passive || e.kind === 'dummy' || e.state === 'return') return false;
    return e.aggro || e === this.sys.targeting.lock;
  }

  /** Foes in the fight within r of (x, z). @param {number} x @param {number} z @param {number} r */
  _fightersNear(x, z, r) {
    const list = this.sys._enemiesNear(x, z, r, this._near);
    let n = 0;
    for (const e of list) if (this._fighter(e)) n++;
    return n;
  }

  /**
   * Where a caster's area spell lands: its target's spot, pulled toward the middle of the foes
   * within `VQ_AI.centroid` u of it (a spell centred on a pack, not on its edge).
   * @param {Enemy} t
   * @returns {PointXZ}
   */
  _spellSpot(t) {
    const q = t.position;
    const list = this.sys._enemiesNear(q.x, q.z, VQ_AI.centroid, this._near);
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const e of list) {
      if (!this._fighter(e)) continue;
      sx += e.position.x;
      sz += e.position.z;
      n++;
    }
    const o = this._spellAt;
    if (n > 1) {
      o.x = (q.x + sx / n) / 2;
      o.z = (q.z + sz / n) / 2;
    } else {
      o.x = q.x;
      o.z = q.z;
    }
    return o;
  }

  /**
   * The cleric raises a fallen member (PARTY.md §12.3): the nearest one within the raise's `reach` of
   * the player with no foe within `safe` u of it; it walks there and kneels (`_startRevive`).
   * @param {number} h
   * @param {boolean} replan
   * @returns {boolean} it is busy with a raise
   */
  _reviveStep(h, replan) {
    const R = this.heroKit.revive;
    if (this.reviveCd > 0 || this.mp < R.mp - EPS) {
      this._reviveWho = null;
      return false;
    }
    if (replan || !this._fallenOk(this._reviveWho)) this._reviveWho = this._pickFallen();
    const who = this._reviveWho;
    if (!who) return false;
    const p = this.member.position;
    const q = who.position;
    this.mode = 'heal';
    if (Math.hypot(q.x - p.x, q.z - p.z) <= R.range + 0.2) {
      this._startRevive(who);
      return true;
    }
    this._goTo(q.x, q.z, h, R.range);
    return true;
  }

  /**
   * May the cleric raise `who` now: down, still in the fight, within the raise's reach of the
   * player, no foe within `safe` u of it, not in a closed arena from outside?
   * @param {MemberCombat|null} who
   */
  _fallenOk(who) {
    if (!who || !who.down || who.gone || !who.member.sprite || who === this) return false;
    const R = this.heroKit.revive;
    const q = who.position;
    const P = this.sys.player.position;
    // (in a closed arena anywhere in it: the arena bounds the walk)
    if (!this._arena && Math.hypot(q.x - P.x, q.z - P.z) > R.reach) return false;
    if (!this._enterable(q.x, q.z)) return false;
    return this._nearestFoe(q.x, q.z, who._downT >= R.brave ? R.safe * 0.5 : R.safe, true) === null;
  }

  /** The fallen member nearest the cleric that it may raise, or null. @returns {MemberCombat|null} */
  _pickFallen() {
    const p = this.member.position;
    let best = null;
    let bd = Infinity;
    for (const a of this.sys.allies) {
      if (!this._fallenOk(a)) continue;
      const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /**
   * Sanctuary is due (PARTY.md §12.3): ready (its cooldown, the gap, the MP), and `minHurt` of the
   * party within its range + its radius are below the heal threshold + `lift` — or one is and
   * `crowd` foes press the player. It is cast on the middle of the hurt; out of range the cleric
   * walks closer first.
   * @param {number} h
   * @param {number} healAt the rule's heal threshold
   * @returns {boolean} it casts (or walks to cast)
   */
  _sanctuaryStep(h, healAt) {
    const S = /** @type {VqCasterKit} */ (this.kit).skill2;
    if (this.skill2Cd > 0 || this.gapCd > 0 || this.mp < S.mp - EPS) return false;
    if (this.mp - S.mp < this._reserve() - EPS && !this._playerCritical()) return false;
    const sys = this.sys;
    const p = this.member.position;
    const at = Math.min(0.9, healAt + S.lift);
    let hurt = 0;
    let sx = 0;
    let sz = 0;
    const reach = S.range + S.r;
    const pc = sys.pc;
    const P = sys.player.position;
    if (pc.alive && pc.hp < pc.hpMax * at && Math.hypot(P.x - p.x, P.z - p.z) <= reach) {
      hurt++;
      sx += P.x;
      sz += P.z;
    }
    for (const a of sys.allies) {
      if (!a.present || a.hp >= a.hpMax * at) continue;
      const q = a.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) > reach) continue;
      hurt++;
      sx += q.x;
      sz += q.z;
    }
    const due = hurt >= S.minHurt || (hurt >= 1 && pc.alive && this._fightersNear(P.x, P.z, 5) >= S.crowd);
    if (!due) return false;
    const cx = sx / hurt;
    const cz = sz / hurt;
    const o = this._spellAt;
    o.x = cx;
    o.z = cz;
    this.mode = 'heal';
    if (Math.hypot(cx - p.x, cz - p.z) <= S.range) {
      this._startHeroSkill(null, 'skill2');
      return true;
    }
    this._goTo(cx, cz, h, S.range - 1);
    return true;
  }

  // ---- starting moves ----

  /**
   * A hero's skill begins (`_next`, or `which`): MP, cooldown, the gap; the action kind for the core
   * (`flare` for a cast, `mend` for Sanctuary, `sweep` for the greatshield's), the move, its spot.
   * @param {Enemy|null} t its target (null: Sanctuary on `_spellAt`)
   * @param {'skill'|'skill2'} [which]
   */
  _startHeroSkill(t, which = this._next ?? 'skill') {
    const kit = /** @type {VqCasterKit & VqMeleeKit} */ (this.kit);
    const S = which === 'skill2' ? kit.skill2 : kit.skill;
    this.mp -= S.mp;
    // (Support's pace slows the attacks and skills, not a heal: Sanctuary keeps its cooldown)
    const pace = S.id === 'sanctuary' ? 1 : this._pace();
    if (which === 'skill2') this.skill2Cd = S.cooldown * pace;
    else this.skillCd = S.cooldown * pace;
    this.gapCd = VQ_AI.skillGap;
    this.counts.skills++;
    const id = /** @type {HeroMove} */ (S.id);
    const kind = this.cls === 'greatshield' ? 'sweep' : id === 'sanctuary' ? 'mend' : 'flare';
    if (t) {
      this._face(t.position.x, t.position.z);
      if (this.role !== 'melee') this._spellSpot(t);
    } else this._face(this._spellAt.x, this._spellAt.z);
    this._tag = this.sys.tags.next();
    this._begin(kind);
    this.move = id;
    this._actTarget = t;
    if (kind === 'sweep') this.swings++;
    this._cast(id);
    this._next = null;
    this._runFrame();
  }

  /** @param {MemberCombat} who */
  _startRevive(who) {
    const R = this.heroKit.revive;
    this.mp -= R.mp;
    this.reviveCd = R.cooldown;
    this._begin('mend');
    this.move = 'revive';
    this._reviveWho = who;
    this._face(who.position.x, who.position.z);
    this._cast('revive');
    this._runFrame();
  }

  /** Count a cast (tests). @param {string} id */
  _cast(id) {
    this.casts[id] = (this.casts[id] ?? 0) + 1;
  }

  // ---- running moves ----

  /** A hero's own move this sub-step; false for the shared ones (its combo, Mend, roll …). */
  _runHeroMove() {
    switch (this.move) {
      case 'holyBolt': case 'frostLance': this._frameMissileCast(); return true;
      case 'judgement': case 'blizzard': case 'glacialTomb': case 'sanctuary': case 'bulwark': case 'earthshatter':
        this._frameHeroSkill();
        return true;
      case 'revive': this._frameRevive(); return true;
      default: return false;
    }
  }

  /** The caster's missile: aim, release (`_launch`), recover. */
  _frameMissileCast() {
    const B = /** @type {VqCasterKit} */ (this.kit).basic;
    const f = this.frame;
    if (f >= B.total) {
      this.atkCd = Math.max(this.atkCd, B.cooldown * this._pace());
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(B.poses);
    const t = this._actTarget;
    if (t && t.alive && f < B.release) this._face(t.position.x, t.position.z);
    const p = this.member.position;
    // the gathering light / frost at the staff head
    if (this._at(4)) {
      const fc = this.member.facing;
      if (B.id === 'holyBolt') this._holy?.gather('holyBolt');
      else this._ice?.gather();
    }
    if (this._at(B.release)) {
      this._launch(B, t);
      this.sys.sfxAt(B.id === 'holyBolt' ? 'holyBolt' : 'iceShard', p.x, p.z, { volume: 0.55 });
      if (B.id === 'frostLance') this._ice?.released('frostLance');
    }
  }

  /** Every hero skill: poses, then its effect at `at` (`_skillAt`), recover. */
  _frameHeroSkill() {
    const kit = /** @type {VqCasterKit & VqMeleeKit} */ (this.kit);
    const S = kit.skill.id === this.move ? kit.skill : kit.skill2;
    const f = this.frame;
    if (f >= S.total) {
      this.atkCd = Math.max(this.atkCd, 0.3);
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(S.poses);
    const t = this._actTarget;
    if (t && t.alive && f < S.at && this.role !== 'melee') {
      this._spellSpot(t);
      this._face(this._spellAt.x, this._spellAt.z);
    } else if (t && t.alive && f < S.at) this._face(t.position.x, t.position.z);
    this._skillWindup(S, f);
    if (this._at(S.at)) this._skillAt(S);
  }

  /**
   * The wind-up of a skill: light gathering at the cleric's staff, frost at the mage's, the
   * greatshield's grunt and dust.
   * @param {VqSkill} S
   * @param {number} f
   */
  _skillWindup(S, f) {
    if (f % 6 !== 0 || f >= S.at || this._prevFrame === f) return;
    switch (S.id) {
      case 'judgement': case 'sanctuary':
        // (at her staff's sun: HolySpellFx)
        this._holy?.gather(S.id);
        break;
      case 'blizzard': case 'glacialTomb':
        // (at her staff's crystal: IceSpellFx)
        this._ice?.gather();
        break;
      default:
        // (the greatshield's: EarthSpellFx)
        this._earth?.windup(S, f);
        break;
    }
  }

  /**
   * A skill takes effect (its `at` frame): the spell on the ground, the slam, the war cry.
   * @param {VqSkill} S
   */
  _skillAt(S) {
    const sys = this.sys;
    const p = this.member.position;
    const at = this._spellAt;
    switch (S.id) {
      case 'judgement': this._openField('judgement', at.x, at.z); sys.sfxAt('holyPillar', at.x, at.z, { volume: 0.5, pitch: 1.2 }); break;
      case 'sanctuary': this._openField('sanctuary', at.x, at.z); break;
      case 'blizzard': this._openField('blizzard', at.x, at.z); this._ice?.released('blizzard'); break;
      case 'glacialTomb': this._openField('glacialTomb', at.x, at.z); this._ice?.released('glacialTomb'); break;
      case 'bulwark': this._bulwark(S); break;
      case 'earthshatter': {
        const fc = this.member.facing;
        this._openField('earthshatter', p.x + fc.x * 0.9, p.z + fc.z * 0.9);
        break;
      }
      default: break;
    }
  }

  /** The raise: kneel by the fallen, lift it with light at `at`. */
  _frameRevive() {
    const R = this.heroKit.revive;
    const f = this.frame;
    if (f >= R.total) {
      this._endAction();
      this._play('idle', true);
      return;
    }
    this._poseSpans(R.poses);
    const who = this._reviveWho;
    const sys = this.sys;
    // (its look — the glyph, the motes, the pillar — is HolySpellFx's)
    if (who && f % 8 === 0 && this._prevFrame !== f && f < R.at) this._holy?.raiseMote(who);
    if (f === 2 && this._prevFrame < 2 && who) this._holy?.raiseStart(who);
    if (this._at(R.at)) {
      this._reviveWho = null;
      if (who && who.down && !who.gone) {
        who.revive(R.frac, R.iframes);
        const q = who.position;
        this._holy?.raised(who);
        sys.sfxAt('sanctuary', q.x, q.z, { volume: 0.7, pitch: 1.25 });
        this.counts.heals++;
        sys.events.emit('allyRevive', this.id, who.id);
      } else {
        this.mp = Math.min(this.mpMax, this.mp + R.mp * 0.5);
        this._holy?.raiseFailed();
      }
    }
  }

  /**
   * Raised by a cleric (PARTY.md §12.3): up at once with `frac` of its max HP and `iframes` s of
   * i-frames (the get-up plays). Only a fallen member.
   * @param {number} frac
   * @param {number} iframes
   * @returns {boolean} raised
   */
  revive(frac, iframes) {
    if (!this.down || this.gone) return false;
    this.down = false;
    this.hp = Math.max(1, Math.round(this.hpMax * frac));
    this._begin('getup');
    this.iframes = Math.max(this.iframes, iframes);
    this.blink = true;
    this.sys.events.emit('allyUp', this.id);
    this._runFrame();
    return true;
  }

  // ---- armour ----

  /**
   * Does a hit leave a hero standing (no hit stun)? The greatshield's super armour: any hit
   * without a knockdown, and every hit through its skills' `armor` frames; a caster's cast (a
   * skill, Sanctuary, Mend, the raise) is not broken by a hit without knockback.
   * @param {number} kb
   * @param {boolean} knockdown
   * @param {number} dirX
   * @param {number} dirZ
   * @returns {boolean}
   */
  _heroArmor(kb, knockdown, dirX, dirZ) {
    const heavy = knockdown || kb >= ALLY.knockdown.kb;
    if (this.cls === 'greatshield') {
      const S = /** @type {VqMeleeKit} */ (this.kit);
      const skill = this.move === 'bulwark' ? S.skill : this.move === 'earthshatter' ? S.skill2 : null;
      if (heavy && !(skill && this.frame <= skill.armor)) return false;
      // the blow rings off the shield (its look: EarthSpellFx)
      const p = this.member.position;
      this._earth?.block(dirX, dirZ);
      this.sys.sfxAt('guard', p.x, p.z, { volume: 0.35, pitch: 0.85 });
      return true;
    }
    return !(kb > 0) && !knockdown && (this.action === 'mend' || this.action === 'flare');
  }

  // ---- the missiles ----

  /**
   * Launch a missile at `t` (Holy Bolt homes; Frost Lance flies straight, aimed with the shot's
   * lead, `_shoot`'s).
   * @param {VqMissile} B
   * @param {Enemy|null} t
   */
  _launch(B, t) {
    const ms = this._missiles.find((m) => !m.on);
    if (!ms) return;
    const sys = this.sys;
    const p = this.member.position;
    const fc = this.member.facing;
    ms.on = true;
    ms.spec = B;
    ms.x = p.x + fc.x * 0.45;
    ms.z = p.z + fc.z * 0.45;
    ms.y = p.y + SHOT_Y + 0.35;
    ms.traveled = 0;
    ms.age = 0;
    ms.trail = 0;
    ms.target = t && t.alive ? t : null;
    ms.tag = sys.tags.next();
    let dx = fc.x;
    let dz = fc.z;
    let d = 8;
    let aimY = ms.y;
    if (ms.target) {
      let tx = t.position.x;
      let tz = t.position.z;
      const k = this._trk;
      if (B.turn <= 0 && k.t === t) {
        let lx = 0;
        let lz = 0;
        for (let i = 0; i < 2; i++) {
          const tof = Math.hypot(tx + lx - ms.x, tz + lz - ms.z) / B.speed;
          lx = k.vx * tof;
          lz = k.vz * tof;
        }
        const ll = Math.hypot(lx, lz);
        if (ll > ALLY.leadMax) {
          lx *= ALLY.leadMax / ll;
          lz *= ALLY.leadMax / ll;
        }
        tx += lx;
        tz += lz;
      }
      dx = tx - ms.x;
      dz = tz - ms.z;
      d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        dx /= d;
        dz /= d;
      } else {
        dx = fc.x;
        dz = fc.z;
      }
      const b = t.def.body;
      aimY = sys.bodyBase(t) + (b[0] + b[1]) / 2;
    }
    ms.dx = dx;
    ms.dz = dz;
    ms.vy = aimVy(ms.y, aimY, B.speed, d);
    // (the cleric's bolt is drawn by HolySpellFx; the ice mage's lance by IceSpellFx: two layers,
    // following the missile)
    if (B.id === 'holyBolt') this._holy?.launch(ms);
    else {
      this._ice?.launch(ms);
      sys.burst('partyFrostShards', ms.x, ms.y, ms.z, 4);
    }
  }

  /** @param {number} h */
  _stepMissiles(h) {
    for (const ms of this._missiles) if (ms.on) this._stepMissile(ms, h);
  }

  /**
   * One sub-step of a missile: home (Holy Bolt), fly in ≤ 0.25 u pieces; the first foe it touches
   * (its body band), the ground or a wall ends it; so does its range.
   * @param {Missile} ms
   * @param {number} h
   */
  _stepMissile(ms, h) {
    const sys = this.sys;
    const tm = sys.tileMap;
    const B = ms.spec;
    ms.age += h;
    const t = ms.target;
    if (B.turn > 0 && t && t.alive && !t.dormant && t.sprite.visible) {
      const ax = t.position.x - ms.x;
      const az = t.position.z - ms.z;
      const al = Math.hypot(ax, az);
      if (al > 0.05) {
        const cur = Math.atan2(ms.dz, ms.dx);
        let da = Math.atan2(az, ax) - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const lim = B.turn * h;
        const a = cur + Math.max(-lim, Math.min(lim, da));
        ms.dx = Math.cos(a);
        ms.dz = Math.sin(a);
        const b = t.def.body;
        ms.vy = aimVy(ms.y, sys.bodyBase(t) + (b[0] + b[1]) / 2, B.speed, al);
      }
    }
    let left = B.speed * h;
    while (left > 1e-6) {
      const s = Math.min(0.25, left);
      left -= s;
      ms.x += ms.dx * s;
      ms.z += ms.dz * s;
      ms.y += ms.vy * (s / B.speed);
      ms.traveled += s;
      if (ms.x < 0 || ms.z < 0 || ms.x > tm.width || ms.z > tm.depth) {
        this._endMissile(ms, false);
        return;
      }
      const e = this._missileContact(ms, B.radius);
      if (e) {
        this._missileHit(ms, e);
        return;
      }
      if (tm.getHeight(ms.x, ms.z) > ms.y - 0.1 || this._inCollider(ms.x, ms.z)) {
        this._endMissile(ms, true);
        return;
      }
      if (ms.traveled >= B.range) {
        this._endMissile(ms, false);
        return;
      }
    }
    // a trail of light / frost
    ms.trail += h;
    if (ms.trail >= 0.05) {
      ms.trail = 0;
      if (B.id === 'holyBolt') this._holy?.trail(ms);
      else sys.burst('partyFrostTrail', ms.x, ms.y, ms.z, 1);
    }
  }

  /**
   * The foe a missile at its spot touches (as the combat's shots: the hurt radius and the body
   * band), or null.
   * @param {Missile} ms
   * @param {number} r
   * @returns {Enemy|null}
   */
  _missileContact(ms, r) {
    const sys = this.sys;
    const list = sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.dormant || !e.sprite.visible) continue;
      const dx = e.position.x - ms.x;
      const dz = e.position.z - ms.z;
      const rr = r + e.radius;
      if (dx * dx + dz * dz >= rr * rr) continue;
      const base = sys.bodyBase(e);
      const b = e.def.body;
      if (ms.y + r < base + b[0] || ms.y - r > base + b[1]) continue;
      return e;
    }
    return null;
  }

  /** @param {number} x @param {number} z @returns {boolean} inside a static collider */
  _inCollider(x, z) {
    const cs = this.sys.tileMap.queryColliders(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this._cols);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.dynamic) continue;
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) return true;
      } else if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  /**
   * A missile reached a foe: its hit (and the Holy Bolt's splash, the same tag: the foe it struck is
   * not hit twice), the Frost Lance's chill; its burst.
   * @param {Missile} ms
   * @param {Enemy} e
   */
  _missileHit(ms, e) {
    const B = ms.spec;
    const sys = this.sys;
    const s = this._baseSpec(B.mv, B.kb, B.poise);
    s.shape = 'circle';
    s.x = ms.x;
    s.z = ms.z;
    s.y = e.position.y;
    s.r = B.radius + 0.02;
    s.tag = ms.tag;
    s.fromX = ms.x - ms.dx;
    s.fromZ = ms.z - ms.dz;
    // (never on a boss, nor again on a foe still chilled more than `refresh` s: rv-play #4)
    if (B.chill > 0 && !e.boss && e.statusInfo().chill <= (B.refresh ?? 0)) {
      s.chill = B.chill;
      s.slow = B.slow;
    }
    sys.addAllyHit(this, s, 'projectile');
    if (B.splash) {
      s.r = B.splash.r;
      s.mv = B.splash.mv;
      s.kb = 0.4;
      s.poise = 0;
      sys.addAllyHit(this, s, 'projectile');
    }
    this._endMissile(ms, true);
  }

  /**
   * A missile ends: its burst where it is (`hit`: against a foe or a wall — a Holy Bolt splashes a
   * wall too), else it fades out. A Frost Lance's look is IceSpellFx's (`lanceEnd`).
   * @param {Missile} ms
   * @param {boolean} hit
   */
  _endMissile(ms, hit) {
    const sys = this.sys;
    const holy = ms.spec.id === 'holyBolt';
    if (ms.fx) this._fx.kill(ms.fx);
    ms.fx = null;
    ms.on = false;
    ms.target = null;
    const y = ms.y;
    if (!holy) {
      // (the ice mage's: the burst, chips, mist and light of IceSpellFx)
      this._ice?.lanceEnd(ms, hit);
      if (hit) sys.sfxAt('iceSpike', ms.x, ms.z, { volume: 0.45, pitch: 1.4 });
      return;
    }
    // (the cleric's: the burst, sparks and motes of HolySpellFx)
    this._holy?.boltEnd(ms, hit);
    if (hit) sys.sfxAt('boltHit', ms.x, ms.z, { volume: 0.55, pitch: 1.35 });
  }

  // ---- spells on the ground ----

  /**
   * Open a spell on the ground at (x, z) (a free slot; none free: the oldest of its kind is
   * replaced).
   * @param {FieldKind} kind
   * @param {number} x
   * @param {number} z
   */
  _openField(kind, x, z) {
    let fl = this._fields.find((f) => !f.on);
    if (!fl) {
      fl = this._fields[0];
      for (const f of this._fields) if (f.t > fl.t) fl = f;
      this._closeField(fl);
    }
    const sys = this.sys;
    fl.on = true;
    fl.kind = kind;
    fl.x = x;
    fl.z = z;
    fl.y = sys.groundAt(x, z);
    fl.t = 0;
    fl.n = 0;
    fl.next = 0;
    fl.a = this.rng.next() * Math.PI * 2;
    fl.tag = sys.tags.next();
    fl.fx.length = 0;
    this._openFx(fl);
  }

  /** @param {Field} fl */
  _closeField(fl) {
    this._holy?.closed(fl);
    this._earth?.closed(fl);
    for (const r of fl.fx) this._fx.kill(r);
    fl.fx.length = 0;
    fl.on = false;
  }

  /** @param {number} h */
  _stepFields(h) {
    for (const fl of this._fields) {
      if (!fl.on) continue;
      fl.t += h;
      switch (fl.kind) {
        case 'judgement': this._stepJudgement(fl); break;
        case 'sanctuary': this._stepSanctuary(fl); break;
        case 'blizzard': this._stepBlizzard(fl); break;
        case 'glacialTomb': this._stepTomb(fl); break;
        case 'earthshatter': this._stepQuake(fl); break;
        default: this._closeField(fl); break;
      }
    }
  }

  /**
   * A spell's opening look: the glyph on the ground (flat, turning), the storm's swirl, the ward's
   * rings — added to the spell's own effect list (closed with it).
   * @param {Field} fl
   */
  _openFx(fl) {
    const kit = /** @type {VqCasterKit & VqMeleeKit} */ (this.kit);
    switch (fl.kind) {
      // (the cleric's: the glyphs, Sanctuary's ward sigils — HolySpellFx)
      case 'judgement':
        this._holy?.open(fl);
        break;
      case 'sanctuary': {
        const S = kit.skill2;
        this._holy?.open(fl);
        this.sys.sfxAt('sanctuary', fl.x, fl.z, { volume: 0.8 });
        this.sys.ward(S.ward, S.wardFor);
        break;
      }
      // (the ice mage's: glyphs, vortex, crystals, frost and light are IceSpellFx's, on its own clock)
      case 'blizzard':
        this._ice?.open(fl);
        this.sys.sfxAt('blizzard', fl.x, fl.z, { volume: 0.85 });
        break;
      case 'glacialTomb':
        this._ice?.open(fl);
        this.sys.sfxAt('freeze', fl.x, fl.z, { volume: 0.55, pitch: 0.8 });
        break;
      case 'earthshatter': {
        const S = kit.skill2;
        fl.next = S.spikes.delay;
        this._quakeSlam(fl, S);
        break;
      }
      default: break;
    }
  }

  /**
   * Judgement: the pillars come down one by one round the ring (each its own hit), then the great
   * pillar in the middle with a ring of light (r 3.5, the hit-stop); the glyph fades.
   * @param {Field} fl
   */
  _stepJudgement(fl) {
    const S = /** @type {VqCasterKit} */ (this.kit).skill;
    const sys = this.sys;
    while (fl.n < S.pillars && fl.t >= S.delay + fl.n * S.every - EPS) {
      const a = fl.a + (fl.n * Math.PI * 2) / S.pillars;
      const x = fl.x + Math.cos(a) * S.ring;
      const z = fl.z + Math.sin(a) * S.ring;
      const y = sys.groundAt(x, z);
      this._areaHit(x, y, z, S.pillarR, S.pillarMv, S.pillarKb, S.pillarPoise, sys.tags.next(), fl.x, fl.z);
      this._holy?.pillar(fl, fl.n, x, y, z);
      if (fl.n % 2 === 0) sys.sfxAt('holyPillar', x, z, { volume: 0.45, pitch: 1.1 + fl.n * 0.04 });
      fl.n++;
    }
    const tFinal = S.delay + S.pillars * S.every + S.final.delay;
    if (fl.n === S.pillars && fl.t >= tFinal - EPS) {
      fl.n++;
      const F2 = S.final;
      this._areaHit(fl.x, fl.y, fl.z, F2.r, F2.mv, F2.kb, F2.poise, sys.tags.next(), fl.x, fl.z, { stop: F2.stop });
      this._holy?.payoff(fl);
      sys.sfxAt('holyPillar', fl.x, fl.z, { volume: 0.9, pitch: 0.85 });
      sys.shake(0.16, 0.25);
    }
    if (fl.t >= tFinal + 0.6) this._closeField(fl);
  }

  /**
   * Sanctuary: every `duration / ticks` s the player and the members up inside it heal a share of
   * `frac` × their max HP + `flat`; light rises from its ring.
   * @param {Field} fl
   */
  _stepSanctuary(fl) {
    const S = /** @type {VqCasterKit} */ (this.kit).skill2;
    const sys = this.sys;
    const every = S.duration / S.ticks;
    while (fl.n < S.ticks && fl.t >= (fl.n + 0.5) * every - EPS) {
      fl.n++;
      let got = 0;
      const pc = sys.pc;
      const P = sys.player.position;
      if (pc.alive && Math.hypot(P.x - fl.x, P.z - fl.z) <= S.r + pc.radius) {
        const n = pc.heal(Math.round((pc.hpMax * S.frac + S.flat) / S.ticks));
        if (n > 0) sys.events.emit('allyHeal', this.id, 'player', n);
        got += n;
        this._holy?.healed(fl, P, n);
      }
      for (const a of sys.allies) {
        if (!a.present) continue;
        const q = a.position;
        if (Math.hypot(q.x - fl.x, q.z - fl.z) > S.r + ALLY.radius) continue;
        const n = a.heal(Math.round((a.hpMax * S.frac + S.flat) / S.ticks));
        if (n > 0) sys.events.emit('allyHeal', this.id, a.id, n);
        got += n;
        this._holy?.healed(fl, q, n);
      }
      // (light rising from its ring: HolySpellFx)
      this._holy?.tick(fl);
      this.counts.healed += got;
    }
    if (fl.t >= S.duration + 0.4) this._closeField(fl);
  }

  /**
   * Blizzard: every `every` s a hit over its circle (a new tag: each tick strikes again) with a
   * deep chill. Its storm (snow, flakes, hail, mist, frost, light, the gust) is IceSpellFx's.
   * @param {Field} fl
   */
  _stepBlizzard(fl) {
    const S = /** @type {VqCasterKit} */ (this.kit).skill;
    const sys = this.sys;
    while (fl.t >= fl.next - EPS && fl.next < S.duration) {
      this._areaHit(fl.x, fl.y, fl.z, S.r, S.mv, S.kb, S.poise, sys.tags.next(), fl.x, fl.z, { chill: S.chill, slow: S.slow });
      fl.next += S.every;
      fl.n++;
    }
    if (fl.t >= S.duration + 0.4) this._closeField(fl);
  }

  /**
   * Glacial Tomb: `delay` s after it opens one hit over the circle (damage and the freeze, the
   * hit-stop); the spikes stand `hold` s and shatter. Its look (the cracks, the 3D crystals rising
   * to the hit, the frost, the light, the shake, the shells, the shards) is IceSpellFx's.
   * @param {Field} fl
   */
  _stepTomb(fl) {
    const S = /** @type {VqCasterKit} */ (this.kit).skill2;
    const sys = this.sys;
    if (fl.n === 0 && fl.t >= S.delay - EPS) {
      fl.n = 1;
      // (a boss is only chilled: the combat core's freeze, BOSS_FREEZE_SLOW)
      this._areaHit(fl.x, fl.y, fl.z, S.r, S.mv, S.kb, S.poise, fl.tag, fl.x, fl.z, { freeze: S.freeze, stop: S.stop });
      sys.sfxAt('iceSpike', fl.x, fl.z, { volume: 0.95 });
      sys.sfxAt('freeze', fl.x, fl.z, { volume: 0.7 });
      sys.shake(0.18, 0.25);
    }
    if (fl.n === 1 && fl.t >= S.delay + S.hold - EPS) {
      fl.n = 2;
      // they shatter
      sys.sfxAt('iceShard', fl.x, fl.z, { volume: 0.7, pitch: 0.7 });
    }
    if (fl.t >= S.delay + S.hold + 0.4) this._closeField(fl);
  }

  /**
   * Earthshatter's slam (at the field's opening): the shockwave (one hit, knockdown, the hit-stop),
   * the cracks, the dust, the shake.
   * @param {Field} fl
   * @param {VqSkill} S
   */
  _quakeSlam(fl, S) {
    const sys = this.sys;
    const p = this.member.position;
    this._areaHit(fl.x, fl.y, fl.z, S.r, S.mv, S.kb, S.poise, fl.tag, p.x, p.z, { knockdown: S.knockdown, stop: S.stop });
    // (the crack, the shockwave, the dust: EarthSpellFx)
    this._earth?.slam(fl, S);
    sys.sfxAt('earthshatter', fl.x, fl.z, { volume: 1 });
    sys.shake(0.32, 0.35);
  }

  /**
   * Earthshatter: `spikes.delay` s after the slam a ring of stone spikes erupts (a ring hit:
   * knockback); they crumble.
   * @param {Field} fl
   */
  _stepQuake(fl) {
    const S = /** @type {VqMeleeKit} */ (this.kit).skill2;
    const K = S.spikes;
    const sys = this.sys;
    if (fl.n === 0 && fl.t >= fl.next - EPS) {
      fl.n = 1;
      this._areaHit(fl.x, fl.y, fl.z, K.r, K.mv, K.kb, K.poise, sys.tags.next(), fl.x, fl.z, { rInner: K.rInner });
      // (the spikes: EarthSpellFx)
      this._earth?.erupt(fl, K);
      sys.sfxAt('crash', fl.x, fl.z, { volume: 0.7, pitch: 0.8 });
    }
    if (fl.t >= 2.2) this._closeField(fl);
  }

  /**
   * Bulwark at its `at` frame: the war cry draws the foes within `r` (`sys.taunt`), the ward dome
   * rises over the party (`sys.ward`), a shockwave of the roar rolls out.
   * @param {VqSkill} S
   */
  _bulwark(S) {
    const sys = this.sys;
    const p = this.member.position;
    sys.taunt(this, p.x, p.z, S.r, S.taunt);
    sys.ward(S.ward, S.wardFor);
    const P = sys.player.position;
    // the dome over the middle of the party (the greatshield and the player)
    const cx = (p.x + P.x) / 2;
    const cz = (p.z + P.z) / 2;
    // (the dome, its glyph, the roar's ring, the sparks, the ward's sigils: EarthSpellFx)
    this._earth?.bulwark(S, cx, cz);
    sys.sfxAt('taunt', p.x, p.z, { volume: 1 });
    sys.sfxAt('ward', cx, cz, { volume: 0.7 });
    sys.shake(0.14, 0.3);
  }

  /**
   * One area hit of a hero's spell, queued now: a circle on the ground (or a ring from `o.rInner`),
   * the spell's statuses, a knockdown, and for the heavy hits (`o.stop`: Judgement's great pillar,
   * Glacial Tomb, Earthshatter's slam) a hit-stop.
   * @param {number} x
   * @param {number} y the ground
   * @param {number} z
   * @param {number} r
   * @param {number} mv
   * @param {number} kb
   * @param {number} poise
   * @param {number} tag
   * @param {number} fromX knockback origin
   * @param {number} fromZ
   * @param {{ rInner?: number, chill?: number, slow?: number, freeze?: number, knockdown?: boolean, stop?: number }} [o]
   */
  _areaHit(x, y, z, r, mv, kb, poise, tag, fromX, fromZ, o) {
    const s = this._baseSpec(mv, kb, poise);
    s.shape = o?.rInner ? 'ring' : 'circle';
    s.x = x;
    s.y = y;
    s.z = z;
    s.r = r;
    s.rInner = o?.rInner ?? 0;
    s.dy = AREA_DY;
    s.tag = tag;
    s.fromX = fromX;
    s.fromZ = fromZ;
    if (o) {
      if (o.chill) {
        s.chill = o.chill;
        s.slow = o.slow ?? 0;
      }
      if (o.freeze) s.freeze = o.freeze;
      if (o.knockdown) s.knockdown = true;
      if (o.stop) s.feel = { stop: o.stop };
    }
    this.sys.addAllyHit(this, s, 'skill');
  }

  // ---- per sub-step, per frame, clean-up ----

  /** A hero's missiles, spells on the ground and effects advance (the combat clock). @param {number} h */
  _stepHero(h) {
    this._stepMissiles(h);
    this._stepFields(h);
    this._fx.step(h);
    this._ice?.step(h);
    this._holy?.step(h);
    this._earth?.step(h);
  }

  /** Every missile, spell and effect gone; the heroes' cooldowns and plans cleared (`reset`, `release`). */
  _clearHero() {
    for (const ms of this._missiles) {
      ms.on = false;
      ms.target = null;
      ms.fx = null;
    }
    for (const fl of this._fields) {
      fl.fx.length = 0;
      fl.on = false;
    }
    this._fx.clear();
    this._ice?.clear();
    this._holy?.clear();
    this._earth?.clear();
    this.skill2Cd = 0;
    this.reviveCd = 0;
    this.gapCd = 0;
    this._downT = 0;
    this._next = null;
    this._reviveWho = null;
    this.casts = {};
  }

  /**
   * Write the hero's effect quads (once a frame, after the combat moved); the ice mage's look
   * (IceSpellFx `visuals`).
   * @param {number} dt combat seconds advanced this frame
   */
  _writeHeroFx(dt) {
    this._ice?.visuals(dt);
    this._holy?.visuals(dt);
    this._earth?.visuals(dt);
    for (const ms of this._missiles) {
      const r = ms.fx;
      if (!ms.on || !r) continue;
      r.x = ms.x;
      r.y = ms.y;
      r.z = ms.z;
      r.dirX = ms.dx;
      r.dirZ = ms.dz;
    }
    const cfx = this.sys.fx;
    this._fx.write(cfx ? cfx.viewX : 0, cfx ? cfx.viewZ : -1);
  }

}

// ---------------------------------------------------------------------------------------------
// The heroes' missiles, spells on the ground and effect quads
// ---------------------------------------------------------------------------------------------

/**
 * A hero's missile in flight.
 * @typedef {{ on: boolean, spec: VqMissile|null, x: number, y: number, z: number, dx: number, dz: number, vy: number,
 *   traveled: number, age: number, trail: number, target: Enemy|null, tag: number, fx: FxRec|null }} Missile
 */
/** @returns {Missile} */
function newMissile() {
  return { on: false, spec: null, x: 0, y: 0, z: 0, dx: 0, dz: 1, vy: 0, traveled: 0, age: 0, trail: 0, target: null, tag: 0, fx: null };
}

/** @typedef {'judgement'|'sanctuary'|'blizzard'|'glacialTomb'|'earthshatter'} FieldKind */
/**
 * A hero's spell on the ground: its kind, spot (and ground), seconds since it opened, a counter
 * (pillars down, ticks, the eruption's stage), the time of its next tick, the last storm beat, its
 * turn (rad, seeded), its hit tag and its effect quads.
 * @typedef {{ on: boolean, kind: FieldKind|'', x: number, y: number, z: number, t: number, n: number, next: number,
 *   m: number, a: number, tag: number, fx: FxRec[] }} Field
 */
/** @returns {Field} */
function newField() {
  return { on: false, kind: '', x: 0, y: 0, z: 0, t: 0, n: 0, next: 0, m: -1, a: 0, tag: 0, fx: [] };
}

/**
 * What `SpellFx.add` takes: an atlas frame (partyFx.js), 'flat' (on the ground, +V along
 * `dirX`/`dirZ`, turned by `rot`) or 'billboard'; the spot; the scale (frame px / 16 × scale u) —
 * or `size`, its width in u —, growing to `scaleTo` (`sizeTo`) over `grow` s (eased out); the turn `rot` (rad) and `spin` (rad/s); the HDR
 * tint; its life (s; Infinity: until it is killed), `fadeIn` / `fadeOut` (s, through the batch's
 * dither); its frames — `fps` (the atlas's when absent; 0: spread over its life), `loop` (the frames
 * cycle), or an explicit `frames` list spread over its life; `follow` a live position it keeps to; `back` u pushed away from the camera
 * (negative: toward it); `foot` (upright frames) the frame's row, counted from its bottom edge,
 * that stands on `y` as it grows (else the frame is centred on `y`); `alpha` its opacity at most
 * (the batch's dither: a ground glyph at about half lets the foes standing on it show through);
 * `soft` the batch's radial dither falloff (FxQuads `soft`, 0: none) and `halo` its additive halo's
 * weight (FxQuads `halo`; the SpellFx's own default when absent: 0 but for the ice mage's,
 * IceSpellFx.js).
 * @typedef {{ frame: string, mode: 'flat'|'billboard', x: number, y: number, z: number, dirX?: number, dirZ?: number,
 *   scale?: number, scaleTo?: number, size?: number, sizeTo?: number, grow?: number, rot?: number, spin?: number, color: readonly number[], life: number,
 *   fadeIn?: number, fadeOut?: number, fps?: number, loop?: boolean, frames?: readonly number[],
 *   follow?: { x: number, y: number, z: number }|null, back?: number, foot?: number, alpha?: number, soft?: number, halo?: number }} FxAdd
 */
/**
 * A live effect quad of `SpellFx` (FxAdd's fields resolved, its FxQuads handle and age).
 * @typedef {{ h: number, frame: string, mode: string, x: number, y: number, z: number, dirX: number, dirZ: number,
 *   s0: number, s1: number, grow: number, rot: number, spin: number, color: readonly number[], life: number,
 *   fadeIn: number, fadeOut: number, n: number, fps: number, loop: boolean, frames: readonly number[]|null,
 *   follow: { x: number, y: number, z: number }|null, followY: number, back: number, lift: number, alpha: number, t: number,
 *   soft: number, halo: number }} FxRec
 */

/**
 * A hero's effect quads on the combat's FX batch (`sys.quads`, the FX atlas with partyFx.js's
 * frames): no material, pool or program of their own. Timed on the combat clock (`step`: they hold
 * through a hit-stop), written once a frame (`write`). A full batch drops the new effect.
 */
class SpellFx {
  /**
   * @param {CombatSystem} sys
   * @param {{ halo?: number }} [opts] halo: the halo weight of an effect that names none (0)
   */
  constructor(sys, { halo = 0 } = {}) {
    this.sys = sys;
    this.halo = halo;
    /** @type {FxRec[]} */
    this.live = [];
    /** @type {FxRec[]} */
    this.pool = [];
    /** @type {FxQuadParams} */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1, flipX: false, soft: 0, halo: 0 };
  }

  /** Live effects. */
  get count() { return this.live.length; }

  /**
   * @param {FxAdd} o
   * @returns {FxRec|null} null: the batch is full
   */
  add(o) {
    const quads = this.sys.quads;
    const h = quads ? quads.alloc() : -1;
    if (h < 0) return null;
    const fr = this.sys.atlasFrames?.[o.frame];
    const r = this.pool.pop() ?? /** @type {FxRec} */ ({});
    r.h = h;
    r.frame = o.frame;
    r.mode = o.mode;
    r.x = o.x;
    r.y = o.y;
    r.z = o.z;
    r.dirX = o.dirX ?? 0;
    r.dirZ = o.dirZ ?? 1;
    // (a size in u: the frame's width, 16 texels a unit, fitted to it)
    const fw = (fr?.w ?? 16) / 16;
    r.s0 = o.size != null ? o.size / fw : o.scale ?? 1;
    r.s1 = o.sizeTo != null ? o.sizeTo / fw : o.scaleTo ?? r.s0;
    r.grow = o.grow ?? 0;
    r.rot = o.rot ?? 0;
    r.spin = o.spin ?? 0;
    r.color = o.color;
    r.life = o.life;
    r.fadeIn = o.fadeIn ?? 0;
    r.fadeOut = o.fadeOut ?? 0;
    r.n = Math.max(1, fr?.n ?? 1);
    r.fps = o.fps ?? (fr?.fps ?? 0);
    r.loop = !!o.loop;
    r.frames = o.frames ?? null;
    r.follow = o.follow ?? null;
    r.followY = r.follow ? o.y - r.follow.y : 0;
    r.back = o.back ?? 0;
    // (the frame's foot on y: its centre is half its height less the foot above, × the scale)
    r.lift = o.foot != null && fr ? (fr.h / 2 - o.foot) / 16 : 0;
    r.alpha = o.alpha ?? 1;
    r.soft = o.soft ?? 0;
    r.halo = o.halo ?? this.halo;
    r.t = 0;
    this.live.push(r);
    return r;
  }

  /** End one effect now. @param {FxRec|null} r */
  kill(r) {
    if (!r) return;
    const i = this.live.indexOf(r);
    if (i >= 0) this._killAt(i);
  }

  /** @param {number} i */
  _killAt(i) {
    const r = this.live[i];
    this.sys.quads?.free(r.h);
    r.h = -1;
    r.follow = null;
    this.live[i] = this.live[this.live.length - 1];
    this.live.pop();
    this.pool.push(r);
  }

  /** Age every effect; the spent ones go. @param {number} h combat seconds */
  step(h) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.t += h;
      if (r.t >= r.life) this._killAt(i);
    }
  }

  /**
   * Write every live effect into the batch.
   * @param {number} vx camera forward on XZ (unit; `back`)
   * @param {number} vz
   * @param {number} [k] every tint × this (1; the ice mage's dim after dark, IceSpellFx.js)
   */
  write(vx, vz, k = 1) {
    const quads = this.sys.quads;
    if (!quads) return;
    const p = this._p;
    for (let i = 0; i < this.live.length; i++) {
      const r = this.live[i];
      const t = r.t;
      if (r.follow) {
        r.x = r.follow.x;
        r.y = r.follow.y + r.followY;
        r.z = r.follow.z;
      }
      p.x = r.x + vx * r.back;
      p.y = r.y;
      p.z = r.z + vz * r.back;
      p.frame = r.frame;
      let idx;
      if (r.frames) idx = r.frames[Math.min(r.frames.length - 1, Math.floor((t / r.life) * r.frames.length))];
      else if (r.fps > 0) {
        idx = Math.floor(t * r.fps + 1e-6);
        idx = r.loop ? idx % r.n : Math.min(r.n - 1, idx);
      } else idx = r.n > 1 ? Math.min(r.n - 1, Math.floor((t / r.life) * r.n)) : 0;
      p.index = idx;
      const u = r.grow > 0 ? Math.min(1, t / r.grow) : 1;
      p.scale = r.s0 + (r.s1 - r.s0) * (1 - (1 - u) * (1 - u));
      p.y += r.lift * p.scale;
      p.rot = r.rot + r.spin * t;
      p.mode = r.mode;
      p.dirX = r.dirX;
      p.dirZ = r.dirZ;
      p.r = r.color[0] * k;
      p.g = r.color[1] * k;
      p.b = r.color[2] * k;
      let a = 1;
      if (r.fadeIn > 0) a = Math.min(a, t / r.fadeIn);
      if (r.fadeOut > 0) a = Math.min(a, (r.life - t) / r.fadeOut);
      p.a = Math.max(0, Math.min(1, a)) * r.alpha;
      p.soft = r.soft;
      p.halo = r.halo;
      quads.set(r.h, p);
    }
  }

  /** Every effect gone. */
  clear() {
    for (let i = this.live.length - 1; i >= 0; i--) this._killAt(i);
  }
}

/**
 * Ground glyphs and rings float this far above the ground (u): over the grass tufts of the ground
 * detail, which hide anything lower from the play camera.
 */
const FLAT_LIFT = 0.3;
/** An area spell reaches foes standing this much above or below its ground (u: two steps). */
const AREA_DY = 1.1;

// (the heroes' tints are their looks' own: IceSpellFx.js, HolySpellFx.js, EarthSpellFx.js)
/**
 * Opacity caps of the companions' ground effects (rv-play #7: glyphs, floors, rings and swirls at
 * full strength buried the small foes standing on them): through the batch's dither.
 */
const GLYPH_A = 0.5;
const RING_A = 0.6;

// (the heroes' looks — IceSpellFx.js, HolySpellFx.js, EarthSpellFx.js — draw with the heroes'
// effect batch and ground rules)
export { SpellFx, FLAT_LIFT, GLYPH_A, RING_A };

/** `_spaceOut`'s spots: [across the screen (its side first), toward the camera]. */
const SPACE_TRIES = [[1, 0], [-1, 0], [1, 0.6], [-1, 0.6]];

/** An aggroed foe this near the player (u; the combat's engage range) means a fight is on. */
const FIGHT_RANGE = 16;

/** A shooter in line with the player on screen steps aside before it shoots (`_spaceOut`; u). */
const SPACING = Object.freeze({ lateral: 0.9, depth: 2.4, step: 1.8 });

/**
 * A member at a spot this little across the screen from the player (u) and between `near` and
 * `depth` u in front of it (toward the camera) hides the player's body (`_covers`; measured: more
 * than a quarter of the player's body under the member's sprite).
 */
const COVER = Object.freeze({ lateral: 0.8, near: -0.1, depth: 2.2, ahead: 0.5 });

/** A melee member steps to a free spot between thrusts only this far (u). */
const RELOC_MAX = 2.2;

/** Going round the player (`_goTo`): ahead within `ahead` u, the radii + `margin` across; turned by up to atan(`turn`). */
const ROUND = Object.freeze({ ahead: 1.6, margin: 0.15, turn: 1.5 });

/** A shooter's spot counts as on screen within ±this (NDC, at shot height); off screen beyond `OFF_SCREEN`. */
const ON_SCREEN = 0.85;
const OFF_SCREEN = 0.95;

/** A holding member keeps facing its foe while that one is at most this much farther from the player than the nearest (u). */
const LOOK_KEEP = 2;

/** A walking member's facing follows its way over this long (s; `_turnTo`). */
const TURN_TAU = 0.12;

/** A standing member turns to its foe only once it is more than 35° off its facing (`_faceSteady`). */
const STEADY_COS = Math.cos((35 * Math.PI) / 180);

/** A Mend that fizzled (no one needed it at its heal frame): the MP back, the next one this soon (s). */
const MEND_FIZZLE_CD = 1;

/**
 * Added to the target score of a foe not yet in the fight (not aggroed, not the lock-on): the
 * fighting ones first — above every rule's bonus (the boss 1e6, an elite 1e5, the lock-on 1e6).
 */
const NOT_FIGHTING = 1e9;

/** A foe not in the fight yet is a target only this near the player (u; never an elite or the boss). */
const JOIN_NEAR = 6;

/** Farther than this from the player (u), an engaged member that nobody fights leaves it to the follow. */
const FAR_BEHIND = 18;

/** Roll directions tried, in order (rad from the way out). */
const ROLL_TRIES = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];

/** @returns {AllyState['counts']} */
function newCounts() {
  return { attacks: 0, hits: 0, crits: 0, skills: 0, heals: 0, healed: 0, rolls: 0, hurts: 0, damageDealt: 0, damageTaken: 0, downs: 0 };
}

/**
 * The action as the enemies read it (`ctx.player.action`): the player's names for the like moves
 * (a goblin hops back from a melee swing: 'attack' / 'skill1').
 * @param {AllyAction|null} a
 * @returns {string|null}
 */
function viewAction(a) {
  switch (a) {
    case 'a1': case 'a2': return 'attack';
    case 'sweep': return 'skill1';
    case 'shot': case 'volley': case 'bolt': case 'flare': return 'skill2';
    case 'roll': return 'roll';
    case 'hurt': return 'hitstun';
    case 'knock': return 'knockdown';
    case 'mend': return 'draught';
    default: return null;
  }
}
