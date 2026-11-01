import * as THREE from 'three';
import { Sprite3D, createCharacterSheet, CHARACTER_PRESETS, damp, clamp, hashString } from '../../engine/index.js';
import { makeShadowOnly } from '../../engine/world/ShadowCasters.js';
import { PARTY_CLASSES } from '../../engine/level/PartyRules.js';
import { festivalKit } from '../siege/festival.js';
import { CHARACTER_SPRITE_OPTS, IDLE_SPEED, SPRITE_FILL } from '../config.js';

/**
 * @import { Party } from './Party.js'
 * @import { PartyRecord, AllyCombatView } from './types.js'
 * @import { Game } from '../Game.js'
 */

const RADIUS = 0.3;
/** The player's walk and run speeds (Player.js): a member's gait is read against them. */
const WALK_SPEED = 3.2;
const RUN_SPEED = 5.6;
/** Gait thresholds (u/s, smoothed speed): run above RUN_ON, back to the walk below RUN_OFF. */
const RUN_ON = 4.4;
const RUN_OFF = 3.8;
/** Below this smoothed speed for IDLE_HOLD s the member stands (no walk ↔ idle flicker). */
const MOVE_MIN = 0.15;
const IDLE_HOLD = 0.08;
/** A story walk's speeds (walk / run). */
const STORY_WALK = 2.6;
const STORY_RUN = 5.2;

const _v = new THREE.Vector3();

/**
 * A party member in the level being played (docs/specs/PARTY.md §4): the villager who joined, as
 * an actor of its own — not the level's `Npc` (that one is hidden while it is in the party). Made
 * by the Party for every level (`attach`), released when the level goes (`detach`); its record
 * (`PartyRecord`) is what lasts.
 *
 * Out of a fight it follows the player along their trail (the Party decides where it goes each
 * frame — `Party._follow` — and moves it with `stepToward` / `stand`); in one the combat drives it
 * (`combat`, a MemberCombat, set by `CombatSystem.addAlly`; the follow waits while
 * `combat.active`). A story script directs it like a villager — it has the staging members
 * StoryRunner uses on an `Npc` (`walkStep`, `stopWalk`, `placeAt`, `direct`, `release`,
 * `beginTalk`, `endTalk` …).
 *
 * Registered on its level like the level's actors (`attach`): the scene, the sprite manager, the
 * warm fill (`SPRITE_FILL`), the contact-shadow batch and the shadow-only sun quad on batched /
 * combat levels — each released by `detach`. Its sprite uses the player's material kind of the
 * level (lit; `combatFx` on combat levels): no program of its own.
 */
export class PartyMember {
  /** @param {{ party: Party, record: PartyRecord }} opts */
  constructor({ party, record }) {
    this.party = party;
    this.record = record;
    this.id = record.id;
    this.name = record.name;
    /** The sprite on the current level (null while detached). @type {Sprite3D|null} */
    this.sprite = null;
    /** Its position (the sprite's while attached; kept while detached). */
    this.position = new THREE.Vector3();
    /** Unit facing on XZ (the way it last moved). */
    this.facing = { x: 0, z: 1 };
    /** The member's fight on a combat level (MemberCombat; CombatSystem.addAlly), else null. @type {AllyCombatView|null} */
    this.combat = null;
    /** The story / the talk read these like a villager's. */
    this.def = { preset: record.preset, portraitColor: record.color };
    /**
     * The villager's level object while the member is on that villager's level (its talk script,
     * its actor, its `title` and the text keys it holds for them: docs/specs/I18N.md §4.2), else a
     * stand-in `{ id, actor }` (no keyed text). @type {any}
     */
    this.storyObj = { id: record.id, actor: record.actor || undefined };
    /** Its parsed talk script (the story sets it), or null. @type {any[]|null} */
    this.storyTalk = null;
    /** Its plain conversation (unused: the party's built-in one, `Party.talk`). @type {any} */
    this.talk = null;
    this.storyFlag = '';
    this.present = true;
    this.talking = false;
    /** A story script directs it (`direct` … `release`): it neither follows nor fights. */
    this.directed = false;
    this.talkRadius = 1.6;
    /** @type {Game|null} */
    this.game = null;
    /**
     * The follow's state (Party._follow): `mode` 'placed' (put behind the player: it waits there
     * until the player moves on), 'trail' (on its trail point), 'catchup' (running back to it);
     * `held` the frame's reason not to follow ('' | 'combat' | 'script' | 'talk').
     */
    const h = hashString(record.id);
    this.follow = {
      mode: 'trail', held: '', stuck: 0, idle: 0, still: 0, speed: 0, run: false, replan: 0,
      /** @type {number[]|null} catch-up waypoints [x0, z0, x1, z1 …] */
      path: null, pathI: 0, snaps: 0, catchups: 0,
      /** Catch-up: seconds to the next straight-way test, and its answer. */
      lineT: 0, clear: false,
      /**
       * Catch-up with no way on the walk grid: where on the player's way it runs to — the trail's
       * length (`Party.trail.total`) at that point (`Party._trailWay`; null: not along the trail).
       * @type {number|null}
       */
      crumb: null,
      /** Seconds the story has not held it while it was still directed (`Party._scriptDone`). */
      free: 0,
      /** Seconds a fight, a script or a talk has held it (`held`) so far. */
      heldT: 0,
      /** The trail's length (Party.trail.total) when it was placed. */
      placedAt: 0,
      /** The pace it walks at now (u/s; eased: it speeds up and brakes, `Party._follow`). */
      v: 0,
      /**
       * Its sideways offset from the trail (u along the screen's right; eased), the offset it would
       * take where nothing walls it in (`need`), the side it keeps (±1, 0: none yet), and how far it
       * hangs back (u of trail; eased) where it cannot step aside.
       */
      lat: 0, need: 0, side: 0, hang: 0,
      /** It follows the trail (the player walks, as it sees it a beat late) — else it rests. */
      walking: false,
      /** The spot it stepped aside to, out of the walking player's way (`Party._makeWay`), or null. @type {{ x: number, z: number }|null} */
      way: null,
      /** The player stopped while it stood aside: it rests (no beat along the trail first) until the player walks again. */
      wayHold: false,
      /** Its own small spacing offset (u) and the phase of its sway along the way (seeded by its id: no randomness). */
      jit: (((h & 0xffff) / 0xffff) * 2 - 1) * 1,
      phase: (((h >>> 16) & 0xffff) / 0xffff) * Math.PI * 2,
      /** Where it walked to this frame (the trail point it follows, delayed and offset; its rest spot; the catch-up's). */
      gx: 0, gz: 0,
    };
    this._out = { x: 0, z: 0 };
    /** What `attach` registered on the level (released by `detach`). */
    this._reg = { emissive: null, blobs: null, spriteManager: null };
    /**
     * Its festival sheet (a peaceful level whose story poses it, `festival`), kept across levels
     * for its look (`key`) and freed by `dispose`; null until one is needed.
     * @type {{ key: string, sheet: ReturnType<import('../siege/festival.js').FestivalKitModule['createFestivalSheet']> }|null}
     */
    this._festival = null;
  }

  /** The class (PARTY_CLASSES entry). */
  get cls() { return PARTY_CLASSES[this.record.cls] ?? PARTY_CLASSES.warden; }

  /** Where the player talks to it. */
  get interactPoint() { return this.position; }

  /** The follow's mode for `state().party` ('placed' | 'trail' | 'catchup'). */
  get followMode() { return this.follow.mode; }

  /**
   * Into the level being played: a sprite of its sheet (the combat sheet with its class weapon on a
   * combat level) at (x, z), registered like the level's actors (scene, sprite manager, warm fill,
   * contact shadow; the shadow quad drawn only in the shadow pass on batched / combat levels). On a
   * peaceful level whose story poses it (`game.posed`: its id, actor or name) the sheet is its
   * festival sheet (`festivalSheet`). Its sheet's texture is uploaded now (no hitch at its first frame).
   * @param {Game} game
   * @param {number} x
   * @param {number} z
   * @param {{ x: number, z: number }} [face] the way it faces (default: its last facing)
   */
  attach(game, x, z, face) {
    if (this.sprite) this.detach();
    this.game = game;
    const combat = !!game.combatEnabled;
    const sheet = !combat && this.posedBy(game.posed) ? this.festivalSheet() : this.party.sheetFor(this.record, combat);
    const sprite = new Sprite3D(sheet, combat ? { ...CHARACTER_SPRITE_OPTS, combatFx: true } : { ...CHARACTER_SPRITE_OPTS });
    sprite.name = `Party:${this.id}`;
    this.sprite = sprite;
    sprite.position.copy(this.position);
    this.position = sprite.position;
    // (the villager's level object while on its level: the story reads its talk and actor)
    const villager = game.npcById?.get(this.id);
    this.storyObj = villager?.storyObj ?? { id: this.record.id, actor: this.record.actor || undefined };
    this.placeAt(x, z);
    game.engine.scene.add(sprite);
    game.spriteManager.add(sprite);
    this._reg.spriteManager = game.spriteManager;
    // warm fill like every character (fades down at night)
    this._reg.emissive = game.lighting.registerEmissive(/** @type {THREE.MeshLambertMaterial} */ (sprite.material), SPRITE_FILL);
    // big / combat level: the blob in the level's batch, the sun quad only in the shadow pass
    if (game.blobs) {
      if (sprite.shadowProxy) makeShadowOnly(sprite.shadowProxy, [game.lighting.sun]);
      if (game.blobs.adopt(sprite)) {
        this._reg.blobs = game.blobs;
        if (game.blobs.mesh && !game.blobs.mesh.parent) game.engine.scene.add(game.blobs.mesh);
      }
    }
    // (the sheet's texture now: a member that arrives with a level is drawn behind the fader)
    try { game.engine.renderer.initTexture(sprite.texture); } catch { /* (no GPU: uploaded at its first draw) */ }
    const f = face ?? this.facing;
    if (Math.hypot(f.x, f.z) > 1e-6) {
      this.facing.x = f.x;
      this.facing.z = f.z;
      sprite.faceVector(f.x, f.z);
    }
    sprite.play('idle', { speed: IDLE_SPEED[0] });
    // running: a puff of dust on the contact frames, as the player's
    sprite.onFrameChange = (frame, anim) => {
      if (!this.game || !anim || !anim.startsWith('run') || (frame !== 0 && frame !== 2)) return;
      this.game.particles.burst('footstep', this.position, 3);
    };
    const fo = this.follow;
    fo.speed = 0;
    fo.run = false;
    fo.stuck = 0;
    fo.idle = 0;
    fo.still = 0;
    fo.path = null;
    fo.crumb = null;
    fo.v = 0;
    fo.lat = 0;
    fo.side = 0;
    fo.hang = 0;
    fo.way = null;
    fo.wayHold = false;
    fo.gx = this.position.x;
    fo.gz = this.position.z;
  }

  /**
   * Whether a story poses it (`Game.posed`: the names its level's and campaign's scripts pose,
   * lower-cased): its id, its actor or its name.
   * @param {Set<string>|null|undefined} posed
   */
  posedBy(posed) {
    if (!posed?.size) return false;
    const r = this.record;
    return [r.id, r.actor, r.name].some((k) => typeof k === 'string' && k !== '' && posed.has(k.toLowerCase()));
  }

  /**
   * Its festival sheet (FestivalPoses.js: the plain sheet's pixels and the festival poses, for the
   * story's `pose` on a peaceful level), made once per look. The poses a member plays from its
   * combat sheet elsewhere map to the nearest festival frames: `cast` (both arms up) → `cheer0`,
   * `wind` (`ready`, the first of `victory`) → `dance2`.
   */
  festivalSheet() {
    const key = JSON.stringify([this.record.preset, this.record.spec]);
    if (this._festival?.key === key) return this._festival.sheet;
    this._festival?.sheet.dispose();
    const sheet = festivalKit(`the party member "${this.id}" posed by the story`).createFestivalSheet(memberSpec(this.record, false));
    const poses = /** @type {Record<string, number>} */ (/** @type {{ poses?: Record<string, number> }} */ (sheet).poses);
    poses.cast = poses.cheer0;
    poses.wind = poses.dance2;
    this._festival = { key, sheet };
    return sheet;
  }

  /** Out of the level (its sprite and everything `attach` registered released; the position is kept). */
  detach() {
    const s = this.sprite;
    this.combat = null;
    this.talking = false;
    this.directed = false;
    if (!s) return;
    const reg = this._reg;
    reg.emissive?.dispose();
    reg.blobs?.release(s);
    reg.spriteManager?.remove(s);
    reg.emissive = null;
    reg.blobs = null;
    reg.spriteManager = null;
    const pos = this.position.clone();
    // (a speech bubble over it goes with it: Part ways, a leave, the level going)
    this.game?.ui.emotes?.clear(s, true);
    s.removeFromParent();
    s.dispose();
    this.sprite = null;
    this.position = pos;
    this.game = null;
  }

  // ---- movement (the follow, the story's walks; MemberCombat's moves) ----

  /**
   * Move by (dx, dz) through the terrain and the colliders (`tileMap.move`, radius 0.3). Members
   * have no collider of their own: they never block the player or a villager.
   * @returns {number} the fraction of the requested distance achieved (0..1)
   */
  moveBy(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9 || !this.game) return 1;
    const p = this.position;
    const out = this.game.tileMap.move(p, dx, dz, RADIUS, 0.55, this._out);
    const moved = Math.hypot(out.x - p.x, out.z - p.z);
    p.x = out.x;
    p.z = out.z;
    if (moved > 1e-6) {
      this.facing.x = dx / len;
      this.facing.z = dz / len;
    }
    return Math.min(1, moved / len);
  }

  /**
   * One frame of the follow's walk toward (tx, tz) at `speed` (u/s): moves, faces the way it goes,
   * animates walk / run by the speed it really made (smoothed, with hysteresis).
   * @param {number} dt
   * @param {number} tx
   * @param {number} tz
   * @param {number} speed
   * @returns {number} the distance moved
   */
  stepToward(dt, tx, tz, speed) {
    const p = this.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6 || speed <= 0 || dt <= 0) {
      this._gait(dt, 0);
      return 0;
    }
    const step = Math.min(d, speed * dt);
    const x0 = p.x;
    const z0 = p.z;
    this.moveBy((dx / d) * step, (dz / d) * step);
    const moved = Math.hypot(p.x - x0, p.z - z0);
    if (moved > 1e-5) this.sprite?.faceVector(dx, dz);
    this._gait(dt, moved / dt);
    return moved;
  }

  /**
   * Stand where it is this frame (idle once the gait has settled); after `turnAfter` s of standing
   * it faces `face` (the player's facing) — every frame, so a camera turn keeps it in step — and,
   * given `dir` (the player's sprite direction), shows exactly that one (a diagonal facing picks
   * its sprite direction with a hysteresis of the sprite's own: it showed the other one).
   * @param {number} dt
   * @param {{ x: number, z: number }|null} face
   * @param {number} [turnAfter]
   * @param {import('../../engine/constants.js').Direction} [dir]
   */
  stand(dt, face, turnAfter = 0.6, dir) {
    this._gait(dt, 0);
    const fo = this.follow;
    fo.idle += dt;
    const s = this.sprite;
    if (!s) return;
    const turned = !!face && fo.idle >= turnAfter && Math.hypot(face.x, face.z) > 1e-6;
    if (turned) {
      this.facing.x = face.x;
      this.facing.z = face.z;
    }
    if (turned && dir) s.setDirection(dir);
    else s.faceVector(this.facing.x, this.facing.z);
  }

  /** Walk / run / idle by the speed made (u/s). */
  _gait(dt, v) {
    const fo = this.follow;
    const s = this.sprite;
    if (!s) return;
    fo.speed += (v - fo.speed) * damp(14, dt);
    if (v > MOVE_MIN || fo.speed > MOVE_MIN * 2) {
      fo.still = 0;
      fo.idle = 0;
      fo.run = fo.run ? fo.speed > RUN_OFF : fo.speed > RUN_ON;
      if (fo.run) {
        s.play('run');
        s.speed = clamp(fo.speed / RUN_SPEED, 0.7, 1.3);
      } else {
        s.play('walk');
        s.speed = clamp(fo.speed / WALK_SPEED, 0.5, 1.3);
      }
      return;
    }
    fo.still += dt;
    if (fo.still >= IDLE_HOLD || fo.speed < 0.02) {
      fo.run = false;
      s.play('idle');
      s.speed = IDLE_SPEED[0];
    }
  }

  /** Follow the ground (damped, like a villager); `snap` puts it on it at once. @param {number} dt */
  followGround(dt, snap = false) {
    if (!this.game) return;
    const p = this.position;
    const gy = this.game.tileMap.getHeight(p.x, p.z);
    p.y = snap ? gy : p.y + (gy - p.y) * damp(18, dt);
  }

  // ---- what a story (and the talk) use, as on an Npc ----

  /** Put it at (x, z) at once (on the ground). @param {number} x @param {number} z */
  placeAt(x, z) {
    const y = this.game ? this.game.tileMap.getHeight(x, z) : this.position.y;
    this.position.set(x, y, z);
    this.follow.path = null;
    this.follow.crumb = null;
    this.follow.stuck = 0;
  }

  /** A member has no home: a story `home` changes nothing. */
  setHome() {}

  /** Back behind the player (the ground under it went away). */
  teleportHome() {
    if (this.game) this.party.placeBehind([this]);
  }

  /** @param {number} px @param {number} pz */
  beginTalk(px, pz) {
    this.talking = true;
    this.follow.speed = 0;
    this.sprite?.play('idle', { speed: IDLE_SPEED[0] });
    this.sprite?.faceVector(px - this.position.x, pz - this.position.z);
    _v.set(px - this.position.x, 0, pz - this.position.z);
    if (_v.lengthSq() > 1e-8) {
      _v.normalize();
      this.facing.x = _v.x;
      this.facing.z = _v.z;
    }
  }

  /** The talk ended: back to the follow (it catches up when it fell behind). */
  endTalk() {
    this.talking = false;
    this.follow.idle = 0;
  }

  /** A story script takes over (its walk, its facing): the follow waits. */
  direct() {
    this.directed = true;
  }

  /** The script gave it back: the follow again (it catches up when it fell behind). */
  release() {
    this.directed = false;
    this.follow.path = null;
    this.follow.stuck = 0;
    this.sprite?.play('idle', { speed: IDLE_SPEED[0] });
  }

  /**
   * One frame of a story walk toward (tx, tz) (StoryRunner moves it along its waypoints).
   * @param {number} dt @param {number} tx @param {number} tz @param {boolean} running
   */
  walkStep(dt, tx, tz, running) {
    this.directed = true;
    this.stepToward(dt, tx, tz, running ? STORY_RUN : STORY_WALK);
  }

  /** A story walk ended. */
  stopWalk() {
    this.follow.speed = 0;
    this.sprite?.play('idle', { speed: IDLE_SPEED[0] });
  }

  dispose() {
    this.detach();
    this._festival?.sheet.dispose();
    this._festival = null;
  }
}

/**
 * The character spec of a member's sheet: the villager's look; on a combat level with its class
 * weapon drawn by the combat poses.
 * @param {PartyRecord} record
 * @param {boolean} combat
 */
export function memberSpec(record, combat) {
  const preset = Object.hasOwn(CHARACTER_PRESETS, record.preset) ? record.preset : 'villager';
  const base = { ...CHARACTER_PRESETS[preset], preset, ...(record.spec ?? {}) };
  if (combat) base.weapon = (PARTY_CLASSES[record.cls] ?? PARTY_CLASSES.warden).weapon;
  return base;
}

/**
 * A member's sprite sheet.
 * @param {PartyRecord} record
 * @param {boolean} combat
 */
export function createMemberSheet(record, combat) {
  return combat ? createCharacterSheet(memberSpec(record, true), { combat: true }) : createCharacterSheet(memberSpec(record, false));
}
