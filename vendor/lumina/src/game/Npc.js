import * as THREE from 'three';
import { Sprite3D } from '../engine/sprite/Sprite3D.js';
import { createCharacterSheet, CHARACTER_PRESETS } from '../engine/pixel/CharacterSprites.js';
import { RNG, damp, hashString } from '../engine/utils/math.js';
import { NPC_BEHAVIOURS, SETPIECE_BEHAVIOURS } from '../engine/level/ObjectCatalog.js';
import { globalUniforms } from '../engine/render/GlobalUniforms.js';
import { t, getLang } from '../engine/i18n/I18n.js';
import { festivalKit } from './siege/festival.js';
import { CHARACTER_SPRITE_OPTS, IDLE_SPEED } from './config.js';

/**
 * @import { TileMap } from '../engine/world/TileMap.js'
 * @import { Rect } from '../engine/level/types.js'
 * @import { Game } from './Game.js'
 */

const RADIUS = 0.3;

/**
 * The four facings as world directions (x, z) — a level's `facing`, a look round: 'down' is +Z,
 * the way the default camera (yaw 0) looks at it, so at yaw 0 each shows its own row.
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
const WORLD_DIRS = Object.freeze({ down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] });
/** The camera turned by more than this (radians, ≈ 3°) since a villager's row was chosen: chosen again. */
const FACE_YAW_EPS = 0.05;
const TAU = Math.PI * 2;

/**
 * A villager definition in world coordinates (Game.js `npcDef` builds it from a level `npc`
 * object, resolving its object-relative `talkOffset` / `area`).
 * @typedef {object} NpcDef
 * @property {string} id
 * @property {string} name            its identity (scripts match villagers by it): the level's name, or
 *   'Villager' for none
 * @property {boolean} [unnamed]      the level gave it no name: shown as the UI's default
 *   (`t('game.default.villager')`; Game.js `villagerName`), not as the term 'Villager'
 * @property {string} preset          a CHARACTER_PRESETS name
 * @property {object} [spec]          createCharacterSheet spec overrides merged over the preset
 * @property {[number, number]} home  [x, z]
 * @property {number} [wander]        wander radius (1.2)
 * @property {number} [speed]         walk speed (1, the catalog default)
 * @property {string} [facing]        'down' | 'up' | 'left' | 'right' (default 'down')
 * @property {string} [behaviour]     an NPC_BEHAVIOURS name (default 'wander')
 * @property {boolean} [festival]     made with the festival sheet (FestivalPoses.js) although its
 *   behaviour does not need it — a villager a story poses (`pose <who> …`); the set-piece
 *   behaviours (panic, dance, cheer, cower) always have it
 * @property {number} [talkRadius]    (1.6)
 * @property {[number, number]} [talkPoint]   [x, z] where the player talks to the villager
 * @property {string} [portraitColor] dialog name-plate colour
 * @property {string} [title]         the small title beside the name plate (the level's npc `title`; Game.js `speakerTitle`, by its key)
 * @property {string} [titleKey]      the text key the npc object holds for its `title` (`textKeyOf(obj, 'title')`,
 *   docs/specs/I18N.md §4.2); absent: none (the title shows its English)
 * @property {Rect} [bounds]
 *   where a 'chase' villager may run; default the square of `wander` around home
 */

/**
 * What a villager's frame reads of the game (Game.update's `_npcCtx`).
 * @typedef {object} NpcContext
 * @property {THREE.Vector3} player
 * @property {{ position: THREE.Vector3, absent?: boolean }[]} [chickens]
 * @property {Game|null} [game]  the running game: a panicking villager reads its foes and danger
 *   circles (`game.combat`) and barks through `game.ui.emotes` (a story level's); absent: they run
 *   and cower, silent
 */

/**
 * Barks (the siege's set pieces): each villager's own timer (its range by kind), at most one bark
 * in the whole village every BARK_GAP game seconds, only within BARK_RANGE of the player, never a
 * line heard among the last few; none while a dialog window is open (a cutscene's line, a talk).
 */
const BARK_EVERY = Object.freeze({ panic: [4.5, 9], cower: [7, 13], relief: [6, 12], cheer: [8, 16] });
const BARK_GAP = 1.8;
const BARK_RANGE = 15;
/** After the victory: relief barks for this long (game seconds), then the village is quiet. */
const RELIEF_BARKS_FOR = 45;
/** After the victory: how far from home a calmed villager wanders (u; its own radius if smaller). */
const CALM_WANDER = 2.5;
/** How long a bark's bubble may stay up (game seconds; Emotes: 2–6 s by its length). */
const SPOKE_FOR = 6;

/**
 * What the villagers of one level share, by its TileMap (each level has its own — a travel builds
 * a new one; a room set aside keeps its own): the game time of the village's last bark, the lines
 * barked last (never repeated), and whether the level's foes are all routed (`foesRouted`, once
 * per game frame).
 * @typedef {{ last: number, recent: string[], routedFrame: number, routed: boolean }} VillageState
 * @type {WeakMap<TileMap, VillageState>}
 */
const VILLAGES = new WeakMap();

/** @param {TileMap} tileMap @returns {VillageState} */
function villageOf(tileMap) {
  let v = VILLAGES.get(tileMap);
  if (!v) VILLAGES.set(tileMap, (v = { last: -Infinity, recent: [], routedFrame: -1, routed: false }));
  return v;
}

/**
 * The language whose bark glyphs are in, and the job loading them: the page's fonts, not the
 * game's state — only whether a bark is drawn waits for them, never what the villagers decide.
 * @type {string|null}
 */
let barkGlyphs = null;
/** @type {Promise<void>|null} */
let barkGlyphJob = null;

/** Panic: how far a fleeing villager feels a foe (u), and a danger circle's margin. */
const FOE_RANGE = 5.5;
const DANGER_MARGIN = 1.4;

/**
 * A villager: idles, wanders within a small radius of home (TileMap.move collisions), turns to face
 * the player when talked to and resumes afterwards. Optional behaviours: 'chase' (the child
 * running after chickens), 'perform' (the bard at the campfire), 'post' (stands at a post and
 * looks around), and the set pieces of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §6.3, docs/design/SIEGE_AND_FESTIVAL.md; the siege package): 'panic' (runs between random
 * points of its wander radius, stops to cower, flees from foes and from danger circles, cries out),
 * 'dance', 'cheer', 'cower' — these four with the festival sheet (FestivalPoses.js), which a story's
 * `pose` plays too.
 */
export class Npc {
  /**
   * @param {{ def: NpcDef, tileMap: TileMap,
   *           sheetCache?: Map<string, ReturnType<typeof createCharacterSheet>> }} ctx
   */
  constructor({ def, tileMap, sheetCache }) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.tileMap = tileMap;
    /**
     * Made with the festival sheet: the set-piece behaviours' poses, and the story's `pose`
     * (StoryRunner plays `cheer_<dir>` / `dance_<dir>` and the `poses` columns `cower`, `kneel`,
     * `bow` on it, directing the villager meanwhile).
     */
    this.festival = SETPIECE_BEHAVIOURS.includes(def.behaviour) || def.festival === true;
    const specKey = JSON.stringify({ preset: def.preset, ...(def.spec || {}) }) + (this.festival ? '|festival' : '');
    let sheet = sheetCache?.get(specKey);
    if (!sheet) {
      const spec = { ...CHARACTER_PRESETS[def.preset], preset: def.preset, ...(def.spec || {}) };
      sheet = this.festival ? festivalKit(`the villager "${def.id}"`).createFestivalSheet(spec) : createCharacterSheet(spec);
      sheetCache?.set(specKey, sheet);
    }
    this.sheet = sheet;
    this.sprite = new Sprite3D(sheet, { ...CHARACTER_SPRITE_OPTS, direction: def.facing ?? 'down' });
    this.sprite.name = `NPC:${def.id}`;
    this.home = new THREE.Vector3(def.home[0], 0, def.home[1]);
    this.position = this.sprite.position;
    this.position.set(def.home[0], tileMap.getHeight(def.home[0], def.home[1]), def.home[1]);
    this.wander = def.wander ?? 1.2;
    this.speed = def.speed ?? 1;
    this.behaviour = NPC_BEHAVIOURS.includes(def.behaviour) ? def.behaviour : 'wander';
    const w = Math.max(0.5, this.wander);
    this.chaseBounds = def.bounds ?? { minX: def.home[0] - w, maxX: def.home[0] + w, minZ: def.home[1] - w, maxZ: def.home[1] + w };
    this.homeFacing = def.facing ?? 'down';
    /**
     * What it faces in the world (unit x, z): set wherever it turns (`faceWorld`, `faceDir`); its
     * sprite's row is this seen from the camera, chosen again when the camera turns (`_followCamera`)
     * — a story's shot from the far side shows it still facing the hero.
     */
    this.facing = new THREE.Vector3(0, 0, 1);
    const fv = Object.hasOwn(WORLD_DIRS, this.sprite.direction) ? WORLD_DIRS[this.sprite.direction] : WORLD_DIRS.down;
    this.facing.set(fv[0], 0, fv[1]);
    /** The camera yaw its row was chosen for (null: not yet), and that row. @type {number|null} */
    this._faceYaw = null;
    this._faceRow = this.sprite.direction;
    this.talkRadius = def.talkRadius ?? 1.6;
    this.talkPoint = def.talkPoint ? new THREE.Vector3(def.talkPoint[0], 0, def.talkPoint[1]) : null;
    this.rng = new RNG(hashString(def.id));
    // dynamic: it moves in place every frame (TileMap tests it on every query instead of gridding it)
    this.collider = tileMap.addCollider({ type: 'circle', x: this.position.x, z: this.position.z, r: 0.34, dynamic: true });
    this.state = 'idle';
    this.timer = this.rng.range(0.5, 3);
    this.target = new THREE.Vector3();
    this.talking = false;
    /** There as the story stands (`setPresent`; always true without a story). */
    this.present = true;
    /** Moved by a story script (`direct` … `release`): its own behaviour waits. */
    this.directed = false;
    /**
     * The level object it was built from (the story reads its `talk`, `actor`, `when` / `unless`;
     * its texts' keys are the ones this object holds: docs/specs/I18N.md §4.2). @type {any}
     */
    this.storyObj = null;
    /** Its parsed talk script (StoryRunner.attachLevel), or null: its plain conversation. @type {any[]|null} */
    this.storyTalk = null;
    this._out = { x: 0, z: 0 };
    this._stuck = 0;
    this._lookTimer = 0;
    // idle "breathing": slower than the sheet's default and slightly different per villager, so
    // the village doesn't breathe in lockstep
    this.idleSpeed = this.rng.range(IDLE_SPEED[0], IDLE_SPEED[1]);
    if (this.festival) {
      /**
       * The barks' own RNG (when, which line): never the movement's, and drawn the same way whether
       * a bark is shown or not (the glyphs loading, no story UI) — a fixed-step run repeats frame
       * for frame.
       */
      this.barkRng = new RNG(hashString(`bark:${def.id}`));
      this._barkT = this.barkRng.range(1.5, 9);
      /** The level's foes all routed (`_calmed`): a panicking or cowering villager calms down. */
      this._calm = false;
      /** Calmed: the seconds of relief barks left (counted down by its own frames). */
      this._reliefT = 0;
      /** SPOKE_FOR at each bark it decides, counted down: above 0, its bubble may still be up. */
      this._spokeT = 0;
      // the set pieces' own timers (staggered per villager: the village does not move in step)
      this._threatT = this.rng.range(0, 0.25);
      this._danceSpeed = this.rng.range(0.85, 1.15);
      this._runSpeed = Math.min(4.2, Math.max(2.6, this.speed * this.rng.range(2.9, 3.5)));
    }
    this._idle();
  }

  _idle() {
    this.sprite.play('idle', { speed: this.idleSpeed });
  }

  /**
   * Running in panic now (the `panic` behaviour, there, not talking, not held by a script — a
   * walk, a pose —, not calmed by the victory): the `crowd` ambience counts these near the camera.
   */
  get panicking() {
    return this.behaviour === 'panic' && this.present && !this.talking && !this.directed && !this._calm;
  }

  /** Cowering now (the `cower` behaviour, there, not held by a script, not calmed by the victory): the `crowd` ambience's whimpers. */
  get cowering() {
    return this.behaviour === 'cower' && this.present && !this.directed && !this._calm;
  }

  /** World point the player talks to (NPC position, or e.g. the front of a market counter). */
  get interactPoint() {
    if (this.talkPoint) {
      this.talkPoint.y = this.position.y;
      return this.talkPoint;
    }
    return this.position;
  }

  beginTalk(px, pz) {
    this.talking = true;
    this.state = 'talk';
    this._idle();
    // (a `still` villager does not turn to the player)
    if (this.behaviour !== 'still') this.faceWorld(px - this.position.x, pz - this.position.z);
  }

  endTalk() {
    this.talking = false;
    this.state = 'idle';
    this.timer = this.rng.range(1.2, 2.5);
  }

  /**
   * Face a world direction (x, z; any length — none: unchanged): the sprite shows it from the
   * camera now and again whenever the camera turns. The story's `face` and anything else that
   * turns a villager should call this rather than set the sprite's row.
   * @param {number} dx @param {number} dz
   */
  faceWorld(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-6)) return;
    this.facing.set(dx / len, 0, dz / len);
    this._applyFacing(globalUniforms.uCameraYaw.value);
  }

  /**
   * Face one of the four world directions by name ('down' = +Z: a level's `facing`).
   * @param {string} dir
   */
  faceDir(dir) {
    const v = Object.hasOwn(WORLD_DIRS, dir) ? WORLD_DIRS[dir] : null;
    if (v) this.faceWorld(v[0], v[1]);
  }

  /** The sprite's row for the world facing seen from camera yaw `yaw`. @param {number} yaw */
  _applyFacing(yaw) {
    this.sprite.faceVector(this.facing.x, this.facing.z, yaw);
    this._faceYaw = yaw;
    this._faceRow = this.sprite.direction;
  }

  /**
   * Once per update: the camera turned more than FACE_YAW_EPS since the row was chosen — the row
   * again from the world facing; a row someone else set on the sprite (a script, a member leaving
   * the party) is taken as the world facing it shows from the camera now.
   */
  _followCamera() {
    const s = this.sprite;
    const yaw = globalUniforms.uCameraYaw.value;
    if (s.direction !== this._faceRow) {
      // (screen right / down at this yaw, back into the world: the inverse of faceVector's turn)
      const rx = s.direction === 'right' ? 1 : s.direction === 'left' ? -1 : 0;
      const rz = s.direction === 'down' ? 1 : s.direction === 'up' ? -1 : 0;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      this.facing.set(rx * c + rz * sn, 0, rz * c - rx * sn);
      this._faceYaw = yaw;
      this._faceRow = s.direction;
      return;
    }
    if (this._faceYaw === null) {
      this._applyFacing(yaw);
      return;
    }
    let d = yaw - this._faceYaw;
    d -= Math.round(d / TAU) * TAU;
    if (d > FACE_YAW_EPS || d < -FACE_YAW_EPS) this._applyFacing(yaw);
  }

  /**
   * Run `fn` with this NPC's own collider parked out of the world, so collision queries made on
   * its behalf (move, isWalkable) never push it away from — or reject targets near — itself.
   * TileMap._pushOut uses `c.r + moverRadius`, so shrinking the radius alone is not enough.
   */
  _withoutSelf(fn) {
    const c = this.collider;
    const cx = c.x;
    c.x = Infinity;
    try {
      return fn();
    } finally {
      c.x = cx;
    }
  }

  /** A walkable point within `radius` of home (home when six tries find none). */
  _pickTarget(radius = this.wander) {
    return this._withoutSelf(() => {
      for (let k = 0; k < 6; k++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0.4, radius);
        const x = this.home.x + Math.cos(a) * r;
        const z = this.home.z + Math.sin(a) * r;
        if (this.tileMap.isWalkable(x, z)) return this.target.set(x, 0, z);
      }
      return this.target.copy(this.home);
    });
  }

  _walkTowards(dt, tx, tz, speed, player) {
    const p = this.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) return true;
    // yield to the player: don't walk into them
    if (player) {
      const pdx = player.x - p.x;
      const pdz = player.z - p.z;
      const pd = Math.hypot(pdx, pdz);
      if (pd < 1.0 && (pdx * dx + pdz * dz) > 0) {
        this._idle();
        return false;
      }
    }
    const step = Math.min(dist, speed * dt);
    const c = this.collider;
    const cx = c.x;
    c.x = Infinity; // park our own collider: it must not push us (see _withoutSelf)
    const out = this.tileMap.move(p, (dx / dist) * step, (dz / dist) * step, RADIUS, 0.55, this._out);
    c.x = cx;
    const moved = Math.hypot(out.x - p.x, out.z - p.z);
    p.x = out.x;
    p.z = out.z;
    this.faceWorld(dx, dz);
    this.sprite.play(speed > 2.2 ? 'run' : 'walk');
    this.sprite.speed = speed > 2.2 ? 0.8 : Math.max(0.45, speed / 2.8);
    this._stuck = moved < step * 0.25 ? this._stuck + dt : 0;
    return this._stuck > 0.4;
  }

  /**
   * Show or hide the villager as the story has it: hidden, it neither moves, talks nor blocks the
   * way (its collider is parked far away).
   * @param {boolean} on
   */
  setPresent(on) {
    this.present = on;
    this.sprite.visible = on;
    if (on) {
      this.collider.x = this.position.x;
      this.collider.z = this.position.z;
    } else this.collider.x = Infinity;
  }

  /** A story script takes over (its walk, its facing); `release` gives the villager back its behaviour. */
  direct() {
    this.directed = true;
  }

  release() {
    this.directed = false;
    this.state = 'idle';
    this.timer = this.rng.range(1.2, 2.5);
    this._idle();
  }

  /** One frame of a story walk toward (tx, tz) (the player is not yielded to: the script decides). */
  walkStep(dt, tx, tz, running) {
    this.directed = true;
    this._walkTowards(dt, tx, tz, running ? Math.max(2.6, this.speed * 2) : Math.max(1.1, this.speed), null);
  }

  /** A story walk ended. */
  stopWalk() {
    this._idle();
  }

  /** Put the villager at (x, z) at once (a story `teleport`). */
  placeAt(x, z) {
    this.position.set(x, this.tileMap.getHeight(x, z), z);
    if (this.present) {
      this.collider.x = x;
      this.collider.z = z;
    }
  }

  /**
   * Where the villager lives from now on (a story `home`): wandering, posts and chases are centred
   * there. `move`: also put it there at once.
   */
  setHome(x, z, { move = false } = {}) {
    const dx = x - this.home.x;
    const dz = z - this.home.z;
    this.home.set(x, 0, z);
    const b = this.chaseBounds;
    this.chaseBounds = { minX: b.minX + dx, maxX: b.maxX + dx, minZ: b.minZ + dz, maxZ: b.maxZ + dz };
    if (this.talkPoint) this.talkPoint.set(this.talkPoint.x + dx, 0, this.talkPoint.z + dz);
    if (move) this.placeAt(x, z);
  }

  /** Back home at once (the ground under it went away). */
  teleportHome() {
    this.placeAt(this.home.x, this.home.z);
  }

  /**
   * @param {number} dt
   * @param {NpcContext} ctx
   */
  update(dt, ctx) {
    const player = ctx.player;
    const p = this.position;
    // (absent as the story stands: nothing to do; its collider stays parked)
    if (!this.present) return;
    if (!this.talking && !this.directed) {
      switch (this.behaviour) {
        case 'perform':
        case 'post':
          this._updatePost(dt, player);
          break;
        case 'still':
          // (a statue's stillness — The Bells of Evermere's knights: it keeps its facing, never glances)
          break;
        case 'chase':
          this._updateChase(dt, ctx);
          break;
        case 'panic':
          this._updatePanic(dt, ctx);
          break;
        case 'dance':
        case 'cheer':
          this._updateFestive(dt, ctx);
          break;
        case 'cower':
          this._updateCower(dt, ctx);
          break;
        default:
          this._updateWander(dt, player);
      }
    }
    // its row as the camera sees its world facing now (idle, talking, directed or posed alike)
    this._followCamera();
    // terrain height + collider follow
    const gy = this.tileMap.getHeight(p.x, p.z);
    p.y += (gy - p.y) * damp(18, dt);
    this.collider.x = p.x;
    this.collider.z = p.z;
  }

  /** Idle, glance at the player near, now and then a walk to a point within `radius` of home. */
  _updateWander(dt, player, radius = this.wander) {
    if (this.state === 'idle') {
      this._idle();
      this.timer -= dt;
      // glance at the player when they come close
      const d = Math.hypot(player.x - this.position.x, player.z - this.position.z);
      if (d < 2.4) {
        this._lookTimer -= dt;
        if (this._lookTimer <= 0) {
          this.faceWorld(player.x - this.position.x, player.z - this.position.z);
          this._lookTimer = 0.4;
        }
        this.timer = Math.max(this.timer, 0.8);
      }
      if (this.timer <= 0 && radius > 0.2) {
        this._pickTarget(radius);
        this.state = 'walk';
        this.timer = 6;
      }
    } else if (this.state === 'walk') {
      this.timer -= dt;
      const stuck = this._walkTowards(dt, this.target.x, this.target.z, this.speed, player);
      const arrived = Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z) < 0.1;
      if (arrived || stuck || this.timer <= 0) {
        this.state = 'idle';
        this.timer = this.rng.range(2.5, 6.5);
        this._idle();
      }
    }
  }

  _updatePost(dt, player) {
    // stand at home; drift back if pushed; look around now and then
    const p = this.position;
    const off = Math.hypot(this.home.x - p.x, this.home.z - p.z);
    if (off > 0.15) {
      this._walkTowards(dt, this.home.x, this.home.z, this.speed, null);
      return;
    }
    this._idle();
    this.timer -= dt;
    const d = Math.hypot(player.x - p.x, player.z - p.z);
    if (d < 2.2) {
      this.faceWorld(player.x - p.x, player.z - p.z);
      this.timer = 1;
    } else if (this.timer <= 0) {
      const dirs = this.behaviour === 'perform' ? ['down', 'down', 'left', 'right'] : ['down', 'left', 'right', this.homeFacing, this.homeFacing];
      this.faceDir(this.rng.pick(dirs));
      this.timer = this.rng.range(2.5, 5);
    }
  }

  _updateChase(dt, ctx) {
    const chickens = ctx.chickens ?? [];
    const b = this.chaseBounds;
    // (a chicken whose story group went away is no prey: look for another)
    if (this._prey?.absent) {
      this._prey = null;
      this.state = 'idle';
    }
    if (this.state === 'idle' || !this._prey) {
      this._idle();
      this.timer -= dt;
      if (this.timer <= 0 && chickens.length) {
        // only chickens in (or right beside) this villager's own patch — not every chicken on the map
        const near = this._near ??= [];
        near.length = 0;
        for (let i = 0; i < chickens.length; i++) {
          const c = chickens[i].position;
          if (c.x > b.minX - 2 && c.x < b.maxX + 2 && c.z > b.minZ - 2 && c.z < b.maxZ + 2) near.push(chickens[i]);
        }
        if (!near.length) { this.timer = 1; return; }
        this._prey = this.rng.pick(near);
        this.state = 'walk';
        this.timer = this.rng.range(2.5, 4.5);
      }
      return;
    }
    const tx = Math.min(b.maxX, Math.max(b.minX, this._prey.position.x));
    const tz = Math.min(b.maxZ, Math.max(b.minZ, this._prey.position.z));
    this.timer -= dt;
    const stuck = this._walkTowards(dt, tx, tz, 2.6, ctx.player);
    const d = Math.hypot(tx - this.position.x, tz - this.position.z);
    if (d < 0.55 || stuck || this.timer <= 0) {
      this.state = 'idle';
      this._prey = null;
      this.timer = this.rng.range(0.8, 2.2);
    }
  }

  // -------------------------------------------------------------------------------------------
  // The set pieces (Vanquish the Evil Dragon): panic, dance, cheer, cower, story poses
  // -------------------------------------------------------------------------------------------

  /**
   * Panic: run (at a run) to random points of the wander radius; at each, sometimes cower a moment,
   * else look round and run on; a foe or a danger circle near makes it flee away from it at once.
   * Barks now and then (`_bark`). The level's foes all routed: calm (`_updateCalm`).
   * @param {number} dt @param {NpcContext} ctx
   */
  _updatePanic(dt, ctx) {
    if (this._calmed(ctx)) {
      this._updateCalm(dt, ctx);
      return;
    }
    const p = this.position;
    this._threatT -= dt;
    if (this._threatT <= 0) {
      this._threatT = 0.25;
      const th = this._threatNear(ctx.game);
      // (already fleeing away from it: run on; toward it, or not fleeing: turn and flee)
      if (th && !(this.state === 'flee' && (this.target.x - p.x) * (th.x - p.x) + (this.target.z - p.z) * (th.z - p.z) < 0)) this._flee(th.x, th.z);
    }
    switch (this.state) {
      case 'run':
      case 'flee': {
        this.timer -= dt;
        const flee = this.state === 'flee';
        const stuck = this._walkTowards(dt, this.target.x, this.target.z, flee ? this._runSpeed * 1.1 : this._runSpeed, flee ? null : ctx.player);
        const arrived = Math.hypot(this.target.x - p.x, this.target.z - p.z) < 0.15;
        if (arrived || stuck || this.timer <= 0) {
          if (this.rng.chance(flee ? 0.55 : 0.3)) {
            this.state = 'cower';
            this.timer = this.rng.range(1.2, 2.8);
            this.sprite.play('cower');
          } else {
            this.state = 'look';
            this.timer = this.rng.range(0.25, 0.8);
            this._idle();
            this.faceDir(this.rng.pick(['down', 'left', 'right', 'up']));
          }
        }
        break;
      }
      case 'cower':
        this.sprite.play('cower');
        this.timer -= dt;
        if (this.timer <= 0) this._runOn();
        break;
      case 'look':
        this._idle();
        this.timer -= dt;
        if (this.timer <= 0) this._runOn();
        break;
      default:
        // (idle after a talk or a script: off again)
        this._runOn();
    }
    this._bark(dt, ctx, 'panic');
  }

  /** Panic: on to a random point of the wander radius, at a run. */
  _runOn() {
    this._pickTarget();
    this.state = 'run';
    this.timer = 5;
  }

  /**
   * Flee from (fx, fz): a point 3–5.5 away from it (within 1.5 × the wander radius of home,
   * walkable), tried at six angles; home when none is.
   */
  _flee(fx, fz) {
    const p = this.position;
    let ax = p.x - fx;
    let az = p.z - fz;
    const d = Math.hypot(ax, az);
    if (d < 1e-3) { ax = 1; az = 0; } else { ax /= d; az /= d; }
    const base = Math.atan2(az, ax);
    const reach = Math.max(2.5, this.wander * 1.5);
    // (the first walkable point well away from the threat; else the farthest walkable one tried)
    let best = -1;
    const found = this._withoutSelf(() => {
      for (let k = 0; k < 8; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42 + this.rng.range(-0.15, 0.15);
        const r = this.rng.range(3, 5.5);
        let x = p.x + Math.cos(a) * r;
        let z = p.z + Math.sin(a) * r;
        const hx = x - this.home.x;
        const hz = z - this.home.z;
        const hd = Math.hypot(hx, hz);
        if (hd > reach) { x = this.home.x + (hx / hd) * reach; z = this.home.z + (hz / hd) * reach; }
        if (!this.tileMap.isWalkable(x, z)) continue;
        const away = Math.hypot(x - fx, z - fz);
        if (away > d + 1.5) {
          this.target.set(x, 0, z);
          return true;
        }
        if (away > best) {
          best = away;
          this.target.set(x, 0, z);
        }
      }
      return best > d;
    });
    if (!found) this.target.copy(this.home);
    this.state = 'flee';
    this.timer = 3.5;
  }

  /**
   * The nearest threat to a panicking villager, or null: a living foe within FOE_RANGE (visible,
   * awake or not), or a danger circle it stands in or next to (an enemy-style telegraph of the
   * combat's ground markers: a fireball's, a slam's). Cheap: a few dozen distances, 4 × a second.
   * @param {Game|null|undefined} game
   * @returns {{ x: number, z: number }|null}
   */
  _threatNear(game) {
    const combat = game?.combat;
    if (!combat) return null;
    const p = this.position;
    let best = null;
    let bd = Infinity;
    const list = combat.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || !e.sprite.visible) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d < FOE_RANGE && d < bd) { bd = d; best = e.position; }
    }
    // (core's marker table: the live slots of the enemy side's telegraphs)
    const slots = combat._mk;
    for (let i = 0; i < slots.length; i++) {
      const m = slots[i];
      if (m.h < 0) continue;
      const s = m.spec;
      if (s.style !== 'enemy' || (s.shape !== 'circle' && s.shape !== 'ring')) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < s.r + DANGER_MARGIN && d - s.r < bd) { bd = d - s.r; best = s; }
    }
    return best;
  }

  /**
   * Dance / cheer at home (the festival): dance — the 4-frame dance, a step or a turn now and then,
   * sometimes a cheer between; cheer — bursts of cheering with breaths between, facing its own way.
   * Both shout a cheer now and then.
   * @param {number} dt @param {NpcContext} ctx
   */
  _updateFestive(dt, ctx) {
    const p = this.position;
    const off = Math.hypot(this.home.x - p.x, this.home.z - p.z);
    if (this.state === 'step') {
      this.timer -= dt;
      const stuck = this._walkTowards(dt, this.target.x, this.target.z, 1.2, ctx.player);
      if (stuck || this.timer <= 0 || Math.hypot(this.target.x - p.x, this.target.z - p.z) < 0.08) {
        this.state = 'idle';
        this.timer = 0;
      }
      return;
    }
    if (off > Math.max(0.6, this.wander) + 0.3) {
      // pushed away: back home first
      this._walkTowards(dt, this.home.x, this.home.z, this.speed, ctx.player);
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      const dance = this.behaviour === 'dance';
      const r = this.rng.next();
      if (dance && r < 0.25 && this.wander > 0.3) {
        // a few steps to another spot of the dance floor
        this._pickTarget();
        this.state = 'step';
        this.timer = 2;
        return;
      }
      if (dance) {
        this.state = r < 0.85 ? 'dance' : 'cheer';
        this.timer = this.rng.range(3, 7);
        if (r < 0.6) this.faceDir(this.rng.pick(['down', 'left', 'right', 'down']));
      } else {
        this.state = this.state === 'cheer' ? 'rest' : 'cheer';
        this.timer = this.state === 'cheer' ? this.rng.range(2, 4.5) : this.rng.range(1, 3);
        if (r < 0.3) this.faceDir(this.rng.pick(['down', 'left', 'right', this.homeFacing]));
      }
    }
    if (this.state === 'dance') this.sprite.play('dance', { speed: this._danceSpeed });
    else if (this.state === 'cheer') this.sprite.play('cheer', { speed: this._danceSpeed });
    else this._idle();
    this._bark(dt, ctx, 'cheer');
  }

  /**
   * Cower: crouched at home, now and then looking up (a breath of idle, a glance round), whimpering.
   * The level's foes all routed: calm (`_updateCalm`).
   * @param {number} dt @param {NpcContext} ctx
   */
  _updateCower(dt, ctx) {
    if (this._calmed(ctx)) {
      this._updateCalm(dt, ctx);
      return;
    }
    const p = this.position;
    if (Math.hypot(this.home.x - p.x, this.home.z - p.z) > 0.3) {
      this._walkTowards(dt, this.home.x, this.home.z, Math.max(1.2, this.speed), null);
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.state = this.state === 'look' ? 'cower' : this.rng.chance(0.3) ? 'look' : 'cower';
      this.timer = this.state === 'look' ? this.rng.range(0.4, 0.9) : this.rng.range(2.5, 6);
      if (this.state === 'look') this.faceDir(this.rng.pick(['down', 'left', 'right']));
    }
    if (this.state === 'look') this._idle();
    else this.sprite.play('cower');
    this._bark(dt, ctx, 'cower');
  }

  /**
   * Is the level's victory won — its foes all routed (`foesRouted`)? On the change a panicking or
   * cowering villager calms down (a cheer of relief toward the player, then `_updateCalm`); foes
   * back in play (a waystone rest revives them, the story brings a group) send it back to its panic
   * or its corner. A level without a combat never calms its set piece (no foes ever came).
   * @param {NpcContext} ctx
   * @returns {boolean}
   */
  _calmed(ctx) {
    const calm = foesRouted(ctx.game, this.tileMap);
    if (calm === this._calm) return calm;
    this._calm = calm;
    if (calm) {
      this._reliefT = RELIEF_BARKS_FOR;
      // (a cry of panic of its own may still be over its head: it pops out — the drawing only)
      if (this._spokeT > 0) ctx.game.ui.emotes?.clear(this.sprite);
      this.state = 'relief';
      this.timer = this.rng.range(1.5, 3.5);
      this.faceWorld(ctx.player.x - this.position.x, ctx.player.z - this.position.z);
    } else {
      this.state = 'idle';
      this.timer = 0;
    }
    return calm;
  }

  /**
   * Calm after the victory: a cheer of relief, then idle and short walks near home (within
   * CALM_WANDER, or its own wander radius if smaller — a cowering villager stands where it is),
   * glancing at the player; relief barks for RELIEF_BARKS_FOR seconds, then quiet.
   * @param {number} dt @param {NpcContext} ctx
   */
  _updateCalm(dt, ctx) {
    if (this.state === 'relief') {
      this.sprite.play('cheer', { speed: this._danceSpeed });
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'idle';
        this.timer = this.rng.range(0.4, 1.5);
        this._idle();
      }
    } else this._updateWander(dt, ctx.player, Math.min(this.wander, CALM_WANDER));
    if (this._reliefT > 0) {
      this._reliefT -= dt;
      this._bark(dt, ctx, 'relief');
    }
  }

  /**
   * A bark over the villager's head now and then (its kind's lines from the 'siege' string table,
   * through the story UI's `emotes.bark`: story levels only), at most one in the village every
   * BARK_GAP seconds and only near the player; none while a dialog window, a title card (StoryRunner
   * `cardUp`) or the end card is up (a line of a cutscene, a conversation, a card over the scene:
   * the timers run on, the barks resume after) — between the lines a cutscene's shots keep the
   * village's cries and cheers (the opening, the festival). What is decided —
   * when, who, which line — is the game's state, drawn from the bark RNG and the level's
   * `VillageState` alike in every run; only the drawing waits for the language's glyphs.
   * @param {number} dt @param {NpcContext} ctx @param {'panic'|'cower'|'relief'|'cheer'} kind
   */
  _bark(dt, ctx, kind) {
    if (this._spokeT > 0) this._spokeT -= dt;
    this._barkT -= dt;
    if (this._barkT > 0) return;
    const rng = this.barkRng;
    const [a, b] = BARK_EVERY[kind];
    this._barkT = rng.range(a, b);
    const game = ctx.game;
    if (!game || game.mode !== 'play' || game.ui.dialog.isOpen || game.story?.cardUp || game.ui.endCard?.active) return;
    const village = villageOf(this.tileMap);
    const now = game.engine.time.elapsed;
    // (a hair under BARK_GAP: two barks exactly BARK_GAP apart — fixed steps of 1/60 s — read alike
    // however long the game has run; a difference of `elapsed` values carries its float error)
    if (now - village.last < BARK_GAP - 1e-6) {
      this._barkT = rng.range(0.5, 2);
      return;
    }
    if (Math.hypot(ctx.player.x - this.position.x, ctx.player.z - this.position.z) > BARK_RANGE) return;
    village.last = now;
    this._spokeT = SPOKE_FOR;
    const keys = festivalKit('a bark').SIEGE_BARKS[kind];
    // (a line not heard among the last few)
    const recent = village.recent;
    let key = rng.pick(keys);
    for (let k = 0; k < 4 && recent.includes(key); k++) key = rng.pick(keys);
    recent.push(key);
    if (recent.length > Math.min(4, keys.length - 1)) recent.shift();
    const emotes = game.ui.emotes;
    if (emotes && barksReady(game)) emotes.bark(this.sprite, t(`siege.${key}`), undefined, { offsetY: this.def.preset === 'child' ? 1.9 : 2.35 });
  }

  /**
   * A card comes up over the scene (StoryRunner: a `title`, the `ending`'s end card): its own bark
   * still over its head (`_bark`, within SPOKE_FOR) pops out — the drawing only, nothing decided
   * changes.
   * @param {{ clear(target: THREE.Object3D): void } | null | undefined} emotes the story UI's bubbles
   */
  hush(emotes) {
    if (this._spokeT > 0) emotes?.clear(this.sprite);
  }

  dispose() {
    this.tileMap.removeCollider(this.collider);
    this.sprite.dispose();
  }
}

/**
 * The level's victory: a combat level whose every foe has fallen or is out of play (a pooled add
 * not spawned, a group the story took away: hidden, `sprite.visible` false — as `_threatNear`
 * reads them). Worked out once per game frame for the whole village (`VillageState`).
 * @param {Game|null|undefined} game
 * @param {TileMap} tileMap
 * @returns {boolean}
 */
function foesRouted(game, tileMap) {
  const combat = game?.combat;
  if (!combat) return false;
  const village = villageOf(tileMap);
  const frame = game.engine.time.frame;
  if (village.routedFrame === frame) return village.routed;
  village.routedFrame = frame;
  const list = combat.enemies;
  let routed = list.length > 0;
  for (let i = 0; routed && i < list.length; i++) if (list[i].alive && list[i].sprite.visible) routed = false;
  village.routed = routed;
  return routed;
}

/**
 * The 'siege' strings registered and the page language's glyphs of them loaded (CJK fonts come in
 * slices: `fonts.ensure` before the first bark measures; I18N.md §5). False until they are in.
 * @param {Game} game
 */
function barksReady(game) {
  const lang = getLang();
  if (barkGlyphs === lang) return true;
  const { registerSiegeStrings, SIEGE_STRINGS } = festivalKit('a bark');
  registerSiegeStrings();
  if (!barkGlyphJob) {
    const fonts = game.ui?.fonts;
    const table = SIEGE_STRINGS[/** @type {'en'|'ja'|'zh'} */ (lang)] ?? SIEGE_STRINGS.en;
    barkGlyphJob = (fonts ? fonts.ensure(Object.values(table)) : Promise.resolve()).then(() => {
      barkGlyphs = lang;
      barkGlyphJob = null;
    });
  }
  return false;
}
