// Combat contract types (docs/contracts/COMBAT.md §9, deviations §27). Types only: nothing here
// reaches a bundle. They describe what the code in src/game/combat/ does today; where the contract
// text and the code differ the code wins and the member says so (§27 row or "Code:").
//
// Core → enemy: `CombatContext` (§9.2, built by `CombatSystem._makeContext`), `PlayerView`.
// Core ↔ enemy records: `HitSpec`, `ProjectileSpec`, `MarkerSpec`, `HitInfo` (§9.5).
// Enemy construction: `EnemyInit` (§9.3), `EnemyGroup`; `EnemyDef` / `ScaledEnemyDef` (§9.4) are
// JSDoc typedefs in `defs.js` (re-exported here), so the Node tools that import it stay light.
// Enemy → brain: `Brain` (the `ai/*.js` objects, `ai/index.js`), `EnemyHazard`.
// Tests: `CombatHooks` (`window.__game.combat`, §20.1), `CombatState` (§20.2), `CombatStats`.

import type { Vector3 } from 'three';
import type { Enemy } from './Enemy.js';
import type { Nav } from './Nav.js';
import type { TileMap } from '../../engine/world/TileMap.js';
import type { Sprite3D } from '../../engine/sprite/Sprite3D.js';
import type { RNG } from '../../engine/utils/math.js';
import type { createEnemySheet } from '../../engine/pixel/MonsterSprites.js';
import type { Rect, LevelObjectOf } from '../../engine/level/types.js';
import type { CombatSystem } from './CombatSystem.js';
import type { EnemyKind, EnemyToken, EnemyDrops, EnemyDef, ScaledEnemyDef } from './defs.js';
import type { COMBAT_BINDINGS } from './bindings.js';
import type { SfxName } from '../../engine/audio/AudioSystem.js';
import type { LootRoll } from './Loot.js';
import type { MemberCombat } from '../party/MemberCombat.js';

declare module '../../engine/core/types.js' {
  /** The combat actions CombatSystem binds (`input.addBindings(COMBAT_BINDINGS)`). */
  interface ExtraActions extends Record<keyof typeof COMBAT_BINDINGS, true> {}
}

export type { EnemyKind, EnemyToken, EnemyDrops, EnemyDef, ScaledEnemyDef };

// -------------------------------------------------------------------------------------------------
// Small shapes
// -------------------------------------------------------------------------------------------------

/**
 * A point or a direction on the ground plane (world units; a direction is usually unit length).
 * An object { x, z }, unlike the level format's `XZ` tuple [x, z] (engine/level/types.d.ts).
 */
export interface PointXZ {
  /** World x (a direction: its x component). */
  x: number;
  /** World z (a direction: its z component). */
  z: number;
}

/**
 * An axis-aligned world rectangle on XZ (arena rects, zone rects, clamps): the level `Rect`, under
 * the name the contract uses (an alias, not a second shape).
 */
export type RectXZ = Rect;

/** A splash on impact (the player's Ember Bolt): radius and motion value. */
export interface Splash {
  r: number;
  mv: number;
}

/** An arc flight (boulder): lands at (tx, ground height, tz) after `time` s; `apex`: peak height. */
export interface ArcFlight {
  tx: number;
  tz: number;
  time: number;
  /** Optional in a ProjectileSpec (the pool computes one); always set on a live projectile. */
  apex?: number;
}

/**
 * `Enemy.state` (§7.4 shared machine; the boss adds `intro`, `phase` = transition roar and `kneel`
 * = phase-3 exposed core, §27.5 E6; its Broken state is `stagger`).
 */
export type EnemyState =
  | 'dormant' | 'idle' | 'notice' | 'engage' | 'windup' | 'active' | 'recover'
  | 'hitstun' | 'stagger' | 'stun' | 'return' | 'dead'
  | 'intro' | 'phase' | 'kneel';

/** What stopped the last `ctx.moveGround` / `ctx.moveFly` (`Enemy.blockedBy`, §7.6). */
export type BlockedBy = null | 'terrain' | 'collider' | 'arena';

/** Named effects of `CombatFx` (`FX_NAMES`, §11.5). */
export type FxName =
  'slash' | 'slashBig' | 'thrust' | 'spin' | 'impact' | 'crit' | 'dust' | 'stun' | 'pillar'
  /** An ember imp's diving burst, flat on the ground (the swarm package's frame; COMBAT.md §29 V9). */
  | 'swarmBurst';

/** Options of a named effect (`ctx.fx`, `CombatFx.play`, §11.5). */
export interface FxOptions {
  /** Forward axis of a flat effect, x component (default (0, 1)). */
  dirX?: number;
  /** Forward axis, z component. */
  dirZ?: number;
  /** Mirror the frame along its U axis (the back-hand slash, §27.1 I2). */
  flip?: boolean;
  /** Multiplies the effect's own scale. */
  scale?: number;
  /** A live position the effect follows (stun stars, the pillar); `y` keeps the start offset. */
  follow?: { x: number; y: number; z: number };
  /** Seconds a looping effect lasts (`stun`, `pillar`); default the effect's own. */
  duration?: number;
  // ---- an atlas frame played as an effect (`CombatFx.play` with a frame name instead of an
  // FxName; COMBAT.md §29 V9): the look a named effect takes from its table. A named effect
  // ignores these.
  /** 'billboard' (upright, facing the camera; default), 'flat' (on the ground plane along dir) or 'screen'. */
  mode?: 'billboard' | 'flat' | 'screen';
  /** u above the given ground height [0]. */
  lift?: number;
  /** HDR colour [r, g, b] the grey frame is tinted with [1, 1, 1] (a max channel above ~1.4 blooms). */
  color?: number[];
  /** One-shot: plays of the frame strip [1]; the last frames dissolve. */
  loops?: number;
  /** Loop the strip until `duration` (default 1 s) ends. */
  loop?: boolean;
  /** In-plane turn (rad) [0]. */
  rot?: number;
  /** In-plane turn speed (rad/s) [0]. */
  spin?: number;
  /** Scale growth per second (scale × (1 + grow · t)) [0]. */
  grow?: number;
  /** u pushed away from the camera (the pillar's 0.5) [0]. */
  back?: number;
  /** Frame rate of the strip [the frame's own; 12 for a still frame]. */
  fps?: number;
}

/**
 * The look of a projectile that is none of the `ProjectileKind` looks (`ProjectileSpec.look`, COMBAT.md
 * §29 V10): a packages's atlas frame (its FX module), drawn by the projectile pool. Kept by
 * reference: pass a constant.
 */
export interface ProjectileLook {
  /** Atlas frame (FxSprites `FX_FRAMES`). */
  frame: string;
  /** 'billboard' [default] or 'flat' (along the flight: +V of the frame forward). */
  mode?: 'billboard' | 'flat';
  /** HDR colour [r, g, b] [1, 1, 1]. */
  color?: number[];
  /** Scale [1]. */
  scale?: number;
  /** In-plane turn (rad) [0]; a flat frame drawn along +U takes π/2. */
  rot?: number;
  /** In-plane turn speed (rad/s) [0] (a tumbling rock, a spinning orb). */
  spin?: number;
  /** Strip rate [the frame's own; 8 for a still frame]. */
  fps?: number;
  /** A particle preset burst along the flight (a fire trail) [none]. */
  trail?: string | null;
  /** Seconds between two trail bursts [0.05]. */
  trailEvery?: number;
  /** Particles per trail burst [2]. */
  trailCount?: number;
  /** At impact (a target, a wall, an arc's landing): a particle burst … [none] */
  hitBurst?: string | null;
  /** … of this many particles [8], */
  hitCount?: number;
  /** a named effect or an atlas frame played at the impact (as `ctx.fx`) [none], */
  hitFx?: string | null;
  /** at this scale [1], */
  hitFxScale?: number;
  /** and a sound [none: the kind's] … */
  hitSfx?: SfxName | null;
  /** … at this volume [0.8] … */
  hitVolume?: number;
  /** … and pitch [1]. */
  hitPitch?: number;
  /** At the end of its range (no hit): a particle burst [none] … */
  fadeBurst?: string | null;
  /** … of this many particles [3]. */
  fadeCount?: number;
}

/** Options of a positional combat sound (`ctx.sfx`, `CombatSystem.sfxAt`). */
export interface SfxOptions {
  /** Multiplies the distance attenuation (1). */
  volume?: number;
  /** Multiplies the ±4 % hashed pitch jitter (1). */
  pitch?: number;
}

/** Brain → core signals (`ctx.emit`, §8.1, §8.3); core applies the global consequences. */
export type BossSignal = 'bossIntro' | 'bossAwake' | 'bossPhase';

// -------------------------------------------------------------------------------------------------
// Hit, projectile and marker records (§9.5)
// -------------------------------------------------------------------------------------------------

/** Hitbox shapes (`Hitboxes.hitOverlaps`). */
export type HitShape = 'circle' | 'sector' | 'lane' | 'ring';

/**
 * Status effects a player-side hit puts on the enemies it hits (the player's and the companions'
 * hitboxes and shots; COMBAT.md §29 V5). Enemy-side records may carry them too: they are ignored
 * there (the party takes no status). Seconds; 0 / absent = none.
 */
export interface HitStatus {
  /** Chill for this many seconds: the enemy's speed and animation × (1 − `slow`), a frost tint [0]. */
  chill?: number;
  /** The chill's slow, 0–0.9 [0.35 when `chill` > 0 and this is 0]. */
  slow?: number;
  /** Freeze for this many seconds: held like a stun, an ice tint (a boss: chilled instead) [0]. */
  freeze?: number;
  /** Stun for this many seconds: held, dizzy stars (not a boss) [0]. */
  stun?: number;
  /**
   * Resonance marks put on the enemy it hurts (COMBAT.md §30.4: +n, up to `MARK_CAP` 3 — a boss
   * too; each new mark renews the 6 s before they all fade); after `consume` [0].
   */
  mark?: number;
  /**
   * > 0: the hit first consumes the enemy's marks (`n`) and lands with its motion value
   * × (1 + `consume` × n) — the Peal's +50 % a mark is 0.5 (COMBAT.md §30.4) [0].
   */
  consume?: number;
}

/**
 * The feel of a big hit (a player-side HitSpec / ProjectileSpec, COMBAT.md §29 V6): hit-stop and a
 * camera shake, once per hitbox per sub-step (a companion's spells: their hits have none otherwise).
 */
export interface HitFeel {
  /** Hit-stop frames (capped at `HIT_STOP.cap`) [0]. */
  stop?: number;
  /** Camera shake [amplitude u (≤ 0.6), seconds (≤ 1.5)] [none]. */
  shake?: number[];
}

/**
 * A hitbox, active for one combat sub-step (`ctx.hitbox`, `CombatSystem.addPlayerHit`). The queue
 * copies it (`HitQueue.add`), so callers reuse their record; a missing optional field takes the
 * default in brackets (`Hitboxes.js` DEFAULTS). `mv`, `kb` and `tag` stay required (the contract's
 * shape) although DEFAULTS has values for them too (1, 0, 0). Overlap rules: COMBAT.md §9.5.
 * Player-side hits may carry status effects (`HitStatus`) and a `feel` (§29 V5, V6).
 */
export interface HitSpec extends HitStatus {
  /** Which overlap test applies. */
  shape: HitShape;
  /** Origin x (circle / ring centre, sector apex, lane start). */
  x: number;
  /** Ground height of the attack (attacker's feet; a hazard: its ground); targets count within `dy`. */
  y: number;
  /** Origin z. */
  z: number;
  /** Radius: circle, sector, ring outer [1]. */
  r?: number;
  /** Ring inner radius [0]. */
  rInner?: number;
  /** Sector / lane axis x (normalised by the test) [0; enemy specs: the facing]. */
  dirX?: number;
  /** Sector / lane axis z [1; enemy specs: the facing]. */
  dirZ?: number;
  /** Sector half angle in degrees [60]. */
  halfAngle?: number;
  /** Lane length along the axis [1]. */
  len?: number;
  /** Lane width [1]. */
  width?: number;
  /** Height tolerance between the target's ground and `y` [0.6]. */
  dy?: number;
  /** Motion value: multiplier of the attacker's ATK (0 with no `flat`: a push only, §27.1 I5). */
  mv: number;
  /** Knockback strength (u before mass). */
  kb: number;
  /** Poise damage [0]. */
  poise?: number;
  /** Knocks the target down [false]. */
  knockdown?: boolean;
  /** > 0: flat damage, no ATK / mitigation / hit-stop (magma ticks, §6.3) [0]. */
  flat?: number;
  /** Target radius treated as 0 (ring waves) [false]. */
  thin?: boolean;
  /** One hit per target per tag; a number, 0 = untagged (§27.13 R6; §9.5 says a string). */
  tag: number;
  /** Knockback origin x; NaN / undefined = the origin. */
  fromX?: number;
  /** Knockback origin z; NaN / undefined = the origin. */
  fromZ?: number;
  /** Hit-stop and shake of a big player-side hit, once per hitbox per sub-step [null] (§29 V6). */
  feel?: HitFeel | null;
}

/**
 * A hit shape of a player move table (`rules.js` `COMBO[i].hits`): PlayerCombat copies these onto
 * its full HitSpec for every active frame.
 */
export type HitShapeSpec = Pick<HitSpec, 'shape' | 'r' | 'halfAngle' | 'len' | 'width'>;

/** Projectile kinds (`Projectiles.js` `PROJECTILE_KINDS`); an unknown kind flies as an arrow. */
export type ProjectileKind = 'arrow' | 'emberBolt' | 'boulder'
  /** The swarms' shots (Vanquish the Evil Dragon, COMBAT.md §29 V10): the imp's orb, the whelp's spit. */
  | 'swarmOrb' | 'swarmSpit';

/**
 * A projectile to launch (`ctx.projectile`, `CombatSystem.spawnProjectile`); copied by
 * `Projectiles.spawn`, which draws its hit tag itself. Defaults in brackets are the code's;
 * `dirX`, `dirZ`, `speed`, `range` and `radius` stay required (the contract's shape) all the same.
 * A player-side shot may carry status effects and a `feel` (§29 V5, V6); any shot a `look` (§29 V10).
 */
export interface ProjectileSpec extends HitStatus {
  /** Look, sound and flight rules. */
  kind: ProjectileKind;
  /** Release point x. */
  x: number;
  /** Release height, absolute (enemies: ground + 0.9, §7.6). */
  y: number;
  /** Release point z. */
  z: number;
  /** Horizontal direction x (normalised by the pool) [0]. */
  dirX: number;
  /** Horizontal direction z [1]. */
  dirZ: number;
  /** Vertical speed (u/s) from the aim formula of §7.6 (`aimVy`) [0]. */
  vy?: number;
  /** Horizontal speed (u/s) [10]. */
  speed: number;
  /** Horizontal range (u) [12]. */
  range: number;
  /** Collision radius [0.2]. */
  radius: number;
  /** Motion value of the hit (× the shooter's ATK). */
  mv: number;
  /** Knockback strength of the hit. */
  kb: number;
  /** Poise damage of the hit [0]. */
  poise?: number;
  /** Flies on through the first target [false]. */
  pierce?: boolean;
  /** Splash on impact (the player's Ember Bolt): radius and motion value [null]. */
  splash?: Splash | null;
  /** Arc shot (boulder): no collision in flight, lands at (tx, groundAt, tz) after `time` s [null]. */
  arc?: ArcFlight | null;
  /** Hit-stop and shake when a player-side shot hits [null]. */
  feel?: HitFeel | null;
  /** Its look instead of the kind's (a package's frame, trail and impact; kept by reference) [null]. */
  look?: ProjectileLook | null;
}

/** Ground-marker shapes (`GroundMarkers`, §11.2). */
export type MarkerShape = 'circle' | 'ring' | 'sector' | 'lane' | 'rect';

/** Ground-marker styles (§11.2). */
export type MarkerStyle = 'enemy' | 'player' | 'lock' | 'barrier' | 'magma' | 'frost' | 'crack' | 'gulletWarm';

/**
 * A telegraph / decal on the draped ground (`GroundMarkers.set`, §9.5, §11.2). Core keeps a full
 * copy per handle (`MARKER_DEFAULTS` in CombatSystem.js); `ctx.marker` / `ctx.setMarker` copy only
 * the fields given, so callers pass partial records (`Partial<MarkerSpec>`).
 */
export interface MarkerSpec {
  /** The outline drawn. */
  shape: MarkerShape;
  /** Centre x (circle / ring / rect), apex (sector) or start (lane). */
  x: number;
  /** Lift above the draped ground (0.03). */
  y?: number;
  /** Centre / apex / start z. */
  z: number;
  /** Radius (circle, ring outer, sector). */
  r: number;
  /** Ring inner radius. */
  rInner: number;
  /** Sector / lane / rect axis x. */
  dirX: number;
  /** Sector / lane / rect axis z. */
  dirZ: number;
  /** Sector half angle (degrees). */
  halfAngle: number;
  /** Lane length. */
  len: number;
  /** Lane width. */
  width: number;
  /** Rect width (across the axis); outline only. */
  w: number;
  /** Rect depth (along the axis); outline only. */
  d: number;
  /** Fill 0..1; 1 resolves (rim white for 5 f). */
  progress: number;
  /**
   * Colour scheme: enemy telegraph, player skill, lock-on, arena barrier, magma pool; the ice
   * telegraph (`frost`; a rect: the ice barrier) and the lane of cracking ice (`crack`; §30.6).
   */
  style: MarkerStyle;
  /** Opacity multiplier (1). */
  alpha?: number;
  /** Rim whitening 0..1: the lane lock flash (§27.1 I4, §27.3 F4) (0). */
  flash?: number;
}

/** Where a hit on an enemy came from (`HitInfo.source`; the player's PLAYER_HIT_META). */
export type HitSource = 'melee' | 'skill' | 'projectile' | 'enemy';

/**
 * Core → `Enemy.receiveHit` after the damage was applied (hp still > 0), and brain `onHit`. One
 * record reused by core (`CombatSystem._info`). The player's hurt takes its own record
 * (`PlayerCombat.hurt`).
 */
export interface HitInfo {
  /** HP taken (0 when guarded). */
  damage: number;
  /** A critical hit (damage × 1.75, §6.3). */
  crit: boolean;
  /** The hit's motion value. */
  mv: number;
  /** The hit's knockback strength (before the enemy's mass). */
  kb: number;
  /** Unit knockback direction x (away from `fromX/fromZ` of the hit). */
  kbDirX: number;
  /** Unit knockback direction z. */
  kbDirZ: number;
  /** Poise damage of the hit. */
  poise: number;
  /** Knockdown (never for the boss). */
  knockdown: boolean;
  /** Code: 'melee' | 'skill' | 'projectile' ('enemy' is listed in §9.5 but never produced). */
  source: HitSource;
  /** The hit's tag (a number, §27.13 R6). */
  tag: number;
  /** True: the enemy was guarded, no damage was dealt. */
  guarded: boolean;
}

// -------------------------------------------------------------------------------------------------
// The combat context (core → enemies, §9.2)
// -------------------------------------------------------------------------------------------------

/**
 * The player as enemies see it: one record owned by core (`CombatSystem._pv`), refreshed before
 * and after the player's sub-step (§9.2).
 */
export interface PlayerView {
  /** Live `player.position` (y = ground). */
  position: Vector3;
  /** Hurt radius (0.3). */
  radius: number;
  /** Body band [y0, y1] above the feet ([0, 1.8]). */
  body: [number, number];
  /** Unit facing on XZ. */
  facing: PointXZ;
  /** Ground velocity (u/s), measured per frame by core (`_playerVelocity`). */
  velocity: PointXZ;
  /** HP above 0 (false from the death until the respawn). */
  alive: boolean;
  /** I-frames (or the `god` hook). */
  invulnerable: boolean;
  /** Rolling or backstepping. */
  dodging: boolean;
  /**
   * The PlayerCombat action or null. Core's names: 'attack' (every combo step), 'roll', 'backstep',
   * 'skill1'–'skill3', 'draught', 'hitstun', 'knockdown', 'dead' (the enemies sandbox mock uses 'a1').
   */
  action: string | null;
  /** Swings started (every combo step; §27.1 I7); core always sets it, readers allow it absent. */
  swing?: number;
  /** A boss arena is closed (§27.9 G4). Core always sets it; readers treat absent as false. */
  sealed?: boolean;
}

/**
 * The boss arena as the golem brain reads it (`EnemyInit.arena`, `e.arena`, §9.3): core passes its
 * `BossArena`; the enemies sandbox passes a plain object with the brain-facing members only.
 */
export interface EnemyArena {
  /** World rect (the fight area). */
  rect: RectXZ;
  /** World gate segment [x0, z0, x1, z1]. */
  gate: number[];
  /** Floor height. */
  y: number;
  /** Closed: the fight runs. */
  active: boolean;
  /** Is (x, z) inside `rect`? */
  contains(x: number, z: number): boolean;
  /** Core only (`BossArena`; absent on a mock): the rect centre. */
  center?: PointXZ;
  /** Core only (`BossArena`): inside the rect grown by `g` u (the other enemies' exclusion, §7.6). */
  containsGrown?(x: number, z: number, g: number): boolean;
  /** Core only (`BossArena`): close the gate on `bossIntro` (barrier, flames). */
  close?(): void;
  /** Core only (`BossArena`): open it again on the boss's death (and on resets). */
  open?(): void;
  /** Core only (`BossArena`): the kill's particle bursts (§27.14 X4). */
  deathBursts?(boss: Enemy): void;
}

/**
 * Everything an enemy (and its brain) may use of the world (COMBAT.md §9.2). One object per
 * CombatSystem, shared by all enemies; built by `CombatSystem._makeContext()`. The enemies sandbox
 * (`sandbox/enemy_ai.js`) implements the same list on a mock core.
 */
export interface CombatContext {
  /** Combat time (s, enemy-scaled: `CombatSystem.enemyTime`). */
  time: number;
  /** Combat sub-step counter (hash input for visual jitter, path cadence). */
  frame: number;
  /** The player as enemies see it (one live record). */
  player: PlayerView;
  /** The level's TileMap (heights, walkability, colliders). */
  tileMap: TileMap;
  /** Ground move (radius, step 0.55, arena exclusion); sets `e.blockedBy` → fraction moved 0..1. */
  moveGround(e: Enemy, dx: number, dz: number): number;
  /** Flier move, clamped to home ± (group radius + 8) (adds: arena), the map, arena exclusion. */
  moveFly(e: Enemy, dx: number, dz: number): void;
  /** Ground height. */
  groundAt(x: number, z: number): number;
  /** Standable: walkable and not open water (bridge decks count). */
  walkable(x: number, z: number): boolean;
  /** Straight-shot line of sight with the height model of §7.6. */
  los(ax: number, az: number, bx: number, bz: number): boolean;
  /** Within NDC |x|, |y| ≤ 0.92 of the camera cached at the start of the frame (§7.3). */
  onScreen(x: number, y: number, z: number): boolean;
  /** Take the kind's attack token (`def.token`); sets `e.token`; false: the budget is spent (§7.5). */
  requestToken(e: Enemy): boolean;
  /** Return the token; clears `e.token`. */
  releaseToken(e: Enemy): void;
  /** Register a hitbox for this sub-step (copied). */
  hitbox(e: Enemy, spec: HitSpec): void;
  /** Launch a projectile; its handle, or −1 when the pool is full. */
  projectile(e: Enemy, spec: ProjectileSpec): number;
  /**
   * Allocate a ground marker (missing fields take core's defaults), owned by the enemy being
   * updated (freed when core sends it home); its handle, or −1 (§11.2).
   */
  marker(spec: Partial<MarkerSpec>): number;
  /** Update the given fields of a marker (a stale or freed handle is ignored). */
  setMarker(h: number, spec: Partial<MarkerSpec>): void;
  /** Free a marker (−1, a stale or an already freed handle is ignored). */
  freeMarker(h: number): void;
  /**
   * A named effect at ground height `y` (§11.5) — or any atlas frame, its look from `opts` (mode,
   * lift, color, loops / loop, rot, spin, grow, back; §29 V9). Code: core's returns false when its
   * pool is full.
   */
  fx(name: FxName | (string & {}), x: number, y: number, z: number, opts?: FxOptions): void;
  /**
   * A particle burst of a `PARTICLE_PRESETS` preset (count clamped to 0..24); `opts` overrides
   * per-particle fields of the preset (colours, hdr, size, speeds — never its pool keys: §11.3).
   */
  burst(preset: string, x: number, y: number, z: number, count: number, opts?: object): void;
  /** A combat sound, panned and attenuated by the distance to the player. */
  sfx(name: SfxName, x: number, z: number, opts?: SfxOptions): void;
  /** Camera shake (amplitude, seconds). */
  shake(amp: number, dur: number): void;
  /** Heal an enemy: HP capped, green number, `healGlow` 8, bar refresh (the shaman's Mend). */
  heal(target: Enemy, amount: number): void;
  /** The DOM '!' above an enemy that noticed the player. */
  alert(e: Enemy): void;
  /** Aggro `e`'s group and the enemies of its zone within 6 u in line of sight (§27.13 R5). */
  wakeGroup(e: Enemy): void;
  /**
   * The walk grid (§27.13 R1): `findPath`, `lineClear`, `spend`; null until `load` built it
   * (without it enemies chase and return in straight lines).
   */
  nav: Nav | null;
  /** Alive, non-dormant, visible enemies within r of (x, z), written into `out` (cleared first). */
  enemiesNear(x: number, z: number, r: number, out: Enemy[]): Enemy[];
  /**
   * Show one of the calling boss's pooled adds at (x, z), reset and woken (golem only); null when
   * none of `kind` is free. Code: `level` is ignored (the pool is created at level 5).
   */
  spawnAdd(kind: EnemyKind, x: number, z: number, level: number): Enemy | null;
  /**
   * Brain → core signal; `bossPhase` passes the new phase (1..3) as the third argument. Code: core
   * forwards a 4th argument `b` too (no brain passes one; `_onSignal` drops it).
   */
  emit(event: BossSignal, e: Enemy, phase?: number, b?: unknown): void;
  /**
   * True during combat's *ambient* step (§29 V2: a story scene holds the player on a set-piece
   * level): only idle enemies, a boss's intro and the dying run — no aggro check, and the hitboxes,
   * shots and markers of the step hurt nobody. A brain's idle (a besieger's swings) may read it to
   * stay calm; absent (the enemies sandbox's mock) = false.
   */
  ambient?: boolean;
  // ---- The Bells of Evermere (COMBAT.md §30): core's context has every one; the enemies sandbox's
  // mock has none (optional only for it) ----
  /**
   * Release `e` (§30.7): its fight ends as a kill would end it — XP, loot, the `kill` event (a
   * `cleared` trigger) and, for a boss, its victory — but it does not die: `e.released`, its body
   * stays under its brain (`Brain.dead` returning true holds it; false lets it fade). Deferred to
   * the end of the enemy updates of the sub-step (never inside the ambient step: it waits for the
   * next active one). False: not alive or already asked.
   */
  release?(e: Enemy): boolean;
  /** Take every resonance mark off `e` → how many it had (§30.4). */
  consumeMarks?(e: Enemy): number;
  /**
   * Submerge `e` (§30.5): untargetable, out of every hit loop, guarded; its sprite fades to 0 over
   * 12 f (core owns `sprite.opacity` meanwhile), then is not drawn. Idempotent.
   */
  submerge?(e: Enemy): void;
  /** Bring `e` up again (§30.5), at (x, z) when given: drawn, fading in over 12 f, hittable at once. */
  surface?(e: Enemy, x?: number, z?: number): void;
  /**
   * A hazard pulse over the party (§30.8): harms the player and every companion outside the safe
   * zones (and within `radius`) only while the combat is engaged — never in the ambient step or a
   * scene; its ring is drawn either way.
   */
  pulse?(spec: PulseSpec): PulseResult;
  /** The level's bells there now (`world.bells`, EVERMERE_CAMPAIGN.md §7.2; read-only). */
  readonly bells?: ReadonlyMap<string, { ring(power?: number): void; mouth: number[]; kind: string }>;
  /** The warmth there now (§30.8): the lit braziers (`world.warmth`) and the combat's own sources (`addWarmth`). */
  warmthZones?(): WarmthZone[];
  /**
   * Set a story variable (§30.9; `game.story.set`): a pack's brain or system changing presence (a
   * brazier put out). A no-op without a story; allowed in the ambient step. → whether it was set.
   */
  setFlag?(name: string, value?: number | boolean): boolean;
}

// -------------------------------------------------------------------------------------------------
// Enemy construction (§9.3; the data types `EnemyDef` … are in defs.js, §9.4)
// -------------------------------------------------------------------------------------------------

/** An enemy sprite sheet (`createEnemySheet(kind)`, shared by every sprite of the kind; §10.3). */
export type EnemySheet = ReturnType<typeof createEnemySheet>;

/**
 * The level `enemy` object an enemy belongs to (ObjectCatalog `enemy`, COMBAT.md §14.1; members
 * documented in engine/level/types.d.ts). Every field is optional here because the Enemy reads
 * only `id` and `radius` (the home radius: wander area, leash slack, flier clamp); the enemies
 * sandbox passes just those. Core and `BossArena` take the full `LevelObjectOf<'enemy'>`.
 */
export type EnemyGroup = Partial<LevelObjectOf<'enemy'>>;

/** `createEnemy(init)` / `new Enemy(init)` (COMBAT.md §9.3). */
export interface EnemyInit {
  /** `<groupId>#<index>` (adds: `<bossUid>:add#<i>`). */
  uid: string;
  /** The level `enemy` object (adds: the boss's); may be null. */
  group: EnemyGroup | null;
  /** Index within the group. */
  index: number;
  /** Its kind: brain, sheet and stats. */
  kind: EnemyKind;
  /** Enemy level 1..10 (`def.level`; adds: 5). */
  level: number;
  /** An elite (gold name plate and shimmer; `def` carries the multipliers). */
  elite: boolean;
  /** Display name (the group's name plate or the kind's name); '' = `def.name`. */
  name: string;
  /** Start spot (world). */
  home: PointXZ;
  /** `scaledDef(kind, level, elite)`. */
  def: ScaledEnemyDef;
  /** The kind's shared sheet. */
  sheet: EnemySheet;
  /** This enemy's sprite (`combatFx: true`); `e.position` is its position. */
  sprite: Sprite3D;
  /** The enemy's seeded RNG (`hashString(uid) ^ seed`). */
  rng: RNG;
  /** A boss add (pooled, hidden until spawned). */
  isAdd: boolean;
  /** Golem: its arena; null for every other kind. */
  arena: EnemyArena | null;
  /** Hit-tag slot (§27.13 R6): core passes creation index + 1; absent: derived from the uid. */
  tagSlot?: number;
}

// -------------------------------------------------------------------------------------------------
// Brains (ai/*.js) and hazards
// -------------------------------------------------------------------------------------------------

/** The boss's moves (§8.2; `boss.force(move)`). */
export type BossMove = 'slam' | 'sweep' | 'toss' | 'rain' | 'charge'
  // the dragon's (ai/dragon.js)
  | 'claw' | 'bite' | 'tail' | 'breath' | 'gust' | 'stomp' | 'flight' | 'rise'
  // The Bells of Evermere's guardians (packs/evermere: rimehart.js, mawkin.js, gullet.js)
  | 'leap' | 'bellow' | 'reap' | 'volley' | 'swap' | 'wind' | 'reaping' | 'spin'
  | 'burst' | 'barrage' | 'surface';

/**
 * An enemy brain (`ai/<kind>.js`, registry `ai/index.js` `BRAINS`): a plain object the Enemy calls
 * into; brains touch the world only through the context, the Enemy helpers and `e.rng`. Every
 * member is optional in the type; in practice a non-boss brain has `engage` and `attack` (the
 * Enemy calls them unguarded) and the boss brain has `update`.
 */
export interface Brain {
  /** Construction and every reset: the per-enemy brain state (`e.ai`). */
  init?(e: Enemy): any;
  /** State `idle` instead of the default wander. */
  idle?(e: Enemy, h: number, ctx: CombatContext): void;
  /** State `engage`: archetype movement; starts attacks (`e.setState('windup')`). */
  engage?(e: Enemy, h: number, ctx: CombatContext): void;
  /** States `windup` / `active` / `recover`: the current attack's timeline. */
  attack?(e: Enemy, h: number, ctx: CombatContext): void;
  /** State `stun` (boar wall stun). */
  stun?(e: Enemy, h: number, ctx: CombatContext): void;
  /** Interrupt, return, death, reset: drop attack-local state (no ctx on a context-less reset). */
  cancel?(e: Enemy, ctx?: CombatContext): void;
  /** `receiveHit` when neither guarded nor walking home: kind reactions (dummy wobble, boss poise). */
  onHit?(e: Enemy, info: HitInfo, ctx: CombatContext): void;
  /** `die`: the kind's death look. */
  die?(e: Enemy, ctx: CombatContext): void;
  /**
   * Every sub-step while dead and not faded yet (also in the ambient step: a death cutscene), before
   * the default fade (§29 V8): the kind's death throes (poses, bursts, its own fade). Return true to
   * keep the default fade off — the brain then fades `e.sprite.opacity` to 0 itself (core stops
   * updating a dead enemy at opacity ≤ 0.001).
   */
  dead?(e: Enemy, h: number, ctx: CombatContext): boolean;
  /** Every sub-step: write `uGlow` [r, g, b, a] into `out`. */
  glow?(e: Enemy, out: number[]): void;
  /** Boss only: drives every state itself. */
  update?(e: Enemy, h: number, ctx: CombatContext): void;
  /** Golem test hook `boss.force(move)` (§27.13 R7): only `move` may be picked next; null: none. */
  force?(e: Enemy, move: BossMove | null): void;
  /** Golem test hook `boss.info()`: the move in progress, a pending approach, the charge skid. */
  info?(e: Enemy): { move: BossMove | null; pending: BossMove | null; skid: boolean;
    /** the dragon's flight stage, lift above the ground, lava cracks, adds alive (ai/dragon.js) */
    stage?: 'up' | 'circle' | 'lane' | 'swoop' | null; lift?: number; lava?: number; adds?: number };
  /** Golem test hook `bossPhase(n)` / `Enemy.setPhase`: jump to phase n, signals `bossPhase`. */
  jumpPhase?(e: Enemy, n: number, ctx: CombatContext): void;
}

/** Hazard types (`Enemy` delayed effects). */
export type HazardType = 'circle' | 'ring' | 'magma' | 'fade';

/**
 * A delayed effect that outlives the attack (`Enemy.hazardCircle` / `hazardVisual` / `hazardRing`
 * / `hazardMagma` / `markToFade`; pooled records freed on death / return / reset). Brains set the
 * hit fields on the returned record (`mv`, `kb`, `knockdown`, `burst`, `burstN`, `sfx`).
 */
export interface EnemyHazard {
  /** In use (pooled records are reused). */
  on: boolean;
  /** Which update runs it: a filling circle, a growing ring, a magma pool, a marker fade-out. */
  type: HazardType;
  /** Its marker handle (−1: none). */
  h: number;
  /** Seconds since it started (after `delay`). */
  t: number;
  /** Seconds before it appears. */
  delay: number;
  /** Fill / life time (s). */
  dur: number;
  /** Centre x (a tracking circle: the offset from the player until it appears). */
  x: number;
  /** Centre z (see x). */
  z: number;
  /** Radius (ring: the start radius of the record, see `r0`). */
  r: number;
  /** Motion value of its hit (circle, ring). */
  mv: number;
  /** Knockback strength of its hit. */
  kb: number;
  /** Its hit knocks the player down. */
  knockdown: boolean;
  /** Magma: flat damage per tick. */
  flat: number;
  /** Ring: the target's radius counts as 0. */
  thin: boolean;
  /** Circle: (x, z) is an offset from the player's position when it appears. */
  track: boolean;
  /** Circle: clamp the start point into this rect. */
  clamp: RectXZ | null;
  /** Circle: telegraph only (a projectile resolves the hit). */
  visualOnly: boolean;
  /** Circle: the hit was registered at full fill (the record lives 5 f more for the rim flash). */
  resolved: boolean;
  /** The first update after `delay` ran: marker allocated (a circle: tracked and clamped). */
  started: boolean;
  /** Particle burst preset at resolution (circle). */
  burst: string | null;
  /** Particles of that burst (0: 10). */
  burstN: number;
  /** Sound at resolution. */
  sfx: SfxName | null;
  /** Hit tag of the circle / ring (one hit per target); magma draws a new tag per tick. */
  tag: number;
  /** Ring: start radius. */
  r0?: number;
  /** Ring: end radius (the record ends past it). */
  rMax?: number;
  /** Ring: growth (u/s). */
  speed?: number;
  /** Ring: band width (inner radius = r − width). */
  width?: number;
  /** Magma: tick period (s). */
  tick?: number;
  /** Magma: ticks done. */
  n?: number;
}

/** A snapshot of a live hazard (`Enemy.hazardList`, the `boss.hazards()` hook). */
export interface HazardSnapshot {
  /** The hazard's type. */
  type: HazardType;
  /** Centre x. */
  x: number;
  /** Centre z. */
  z: number;
  /** Current radius (a ring's grows). */
  r: number;
  /** Inner radius (rings; 0 otherwise). */
  rInner: number;
  /** Seconds left before it appears. */
  delay: number;
  /** Seconds since it appeared. */
  t: number;
  /** Fill / life time (s). */
  dur: number;
  /** Motion value of its hit. */
  mv: number;
  /** Knockback strength of its hit. */
  kb: number;
}

// -------------------------------------------------------------------------------------------------
// Test hooks (`window.__game.combat`, §20.1) and state (§20.2)
// -------------------------------------------------------------------------------------------------

/** Virtual combat actions (`bindings.js` `COMBAT_ACTIONS`); another name is refused (false). */
export type CombatAction = 'dodge' | 'skill1' | 'skill2' | 'skill3' | 'attack' | 'draught' | 'lock';

/** The boss part of `CombatState` (null on a level without a golem). */
export interface CombatBossState {
  /** The boss's enemy uid. */
  uid: string;
  /** HP (rounded up). */
  hp: number;
  /** Max HP. */
  hpMax: number;
  /** Phase 1..3 (during the fight: the highest reached). */
  phase: number;
  /** Its `Enemy.state`. */
  state: EnemyState;
  /** Broken (the boss's `stagger`). */
  broken: boolean;
  /** Killed (the defeat stays recorded after a respawn). */
  defeated: boolean;
  /** Combat seconds since the intro (the last fight's when over). */
  fightTime: number;
  /** Seconds spent in phases 1..3. */
  phaseTimes: number[];
}

/** `CombatSystem.state()`, the `state()` hook and `Game.state().combat` (§20.2). */
export interface CombatState {
  /** The player's combat stats and action (PlayerCombat). */
  player: {
    /** HP (rounded up). */
    hp: number;
    /** Max HP (level and upgrades). */
    hpMax: number;
    /** MP (3 decimals). */
    mp: number;
    /** Max MP. */
    mpMax: number;
    /** Stamina (SP, 3 decimals): attacks and dodges spend it. */
    sp: number;
    /** Max SP. */
    spMax: number;
    /** Player level. */
    level: number;
    /** XP gathered towards the next level. */
    xp: number;
    /** XP the next level needs. */
    xpNext: number;
    /** Gold carried. */
    gold: number;
    /** Healing Draughts carried. */
    potions: number;
    /** Attack (level and upgrades). */
    atk: number;
    /** Defence (level and upgrades). */
    def: number;
    /** PlayerCombat action or null. */
    action: string | null;
    /** Frame of the current action (0 without one). */
    actionFrame: number;
    /** I-frames now (dodge window, respawn grace, or `god`). */
    invulnerable: boolean;
    /** Combo step of the current / last attack (1..3; 0: none). */
    combo: number;
    /** SP ran out: attack recovery runs 1.35× longer until SP is back at 30 (`WINDED_UNTIL`). */
    winded: boolean;
    /** Locked enemy uid or null. */
    lock: string | null;
    /** Checkpoint id ('spawn' or a waystone id). */
    checkpoint: string;
    /** The player's kit (`campaign.player.kit`): 'traveler' or 'swordmaster' (§29). */
    kit: string;
    /** Skill cooldowns (s) [s1, s2, s3]. */
    cooldowns: number[];
    /** Times the player fell. */
    deaths: number;
    /** Perfect dodges so far (§6.5). */
    perfectDodges: number;
  };
  /**
   * In combat: an aggroed enemy within 16 u, or the boss fight (drives the music and HUD; §6.12);
   * it lingers `ENGAGE.linger` s of free play after the last one. The companions read the live
   * `CombatSystem.fightOn()` instead (§28, PARTY.md §11 PC27).
   */
  engaged: boolean;
  /** Combat clock (s). */
  time: number;
  /** Combat sub-step counter. */
  frame: number;
  /** The combat RNG seed (default `hashString(level.name)`; the `seed(n)` hook sets it). */
  seed: number;
  /** Enemies killed (dummies excluded). */
  kills: number;
  /** The boss was defeated. */
  bossDefeated: boolean;
  /** `input.lastDevice` ('keyboard' | 'mouse'). */
  device: 'keyboard' | 'mouse';
  /**
   * Hidden adds excluded, and the foes of the groups the story has taken away (counted in `absent`
   * only: STORY_SCRIPT.md §9.5).
   */
  enemies: { total: number; alive: number; active: number; aggro: number; absent: number };
  /** The boss, or null without one. */
  boss: CombatBossState | null;
  /** Live projectiles. */
  projectiles: number;
  /** Live ground markers. */
  markers: number;
  /** Live pickups. */
  pickups: number;
  /** Live named effects (`CombatFx`). */
  fx: number;
  /** Off-screen enemy arrows shown at the screen edge (at most 8). */
  edgeArrows: number;
  /** Token budget in use. */
  tokens: { melee: number; ranged: number };
  /** An input guard is active. */
  guards: { resume: boolean; respawn: boolean };
  /** The drillmaster's tutorial: a full combo on a dummy, a dodge, the reward given. */
  tutorial: { combo: boolean; dodge: boolean; rewarded: boolean };
  /** Ids of the one-time wares bought (§27.19 W3). */
  shop: { purchased: string[] };
  /** The party's companions fighting here (§28; the key only once one was added). */
  allies?: AllyState[];
  /** The level's sky dragons (DRAGON_CAMPAIGN.md §6.4–6.5; the key only on a level with one). */
  sky?: SkyDragonState[];
  /** The strongest ward over the party now (`ward(frac, s)`: damage × (1 − wardFrac)); 0: none (§29 V7). */
  wardFrac: number;
  /** A set-piece level (§29 V1): its world goes on in a story scene (the ambient step). */
  setpiece: boolean;
  /** The last frame ran the ambient step (§29 V2). */
  ambient: boolean;
}

/** An enemy's status effects (the `statusOf(uid)` hook; §29 V5). */
export interface EnemyStatusState {
  /** The enemy's uid. */
  uid: string;
  /** Its `Enemy.state`. */
  state: EnemyState;
  /** Seconds of chill left (3 decimals) and its slow. */
  chill: number;
  slow: number;
  /** Seconds of freeze left: held, its animation stopped. */
  freeze: number;
  /** Seconds of the hold (a stun or a freeze) left. */
  stun: number;
  /** Held by a status now (a stun or a freeze). */
  held: boolean;
  /** Its time scale now (1 − slow while chilled, 0 frozen, else 1). */
  timeScale: number;
  /** A boss's rest from the cold (s): no chill takes until it ends (§29 V5). */
  chillRest: number;
  /** The companion that taunted it (its id), while the taunt lasts; else null. */
  taunt: string | null;
  /** Seconds of the taunt left. */
  tauntT: number;
  /** Whom it fights: 'player' or a companion's id. */
  target: string;
  /** Aggroed. */
  aggro: boolean;
  /** Its group swarms. */
  swarm: boolean;
  /** Its group's besieged point, or null. */
  besiege: { x: number; z: number; r: number } | null;
  /** Its resonance marks (COMBAT.md §30.4). */
  marks: number;
  /** Submerged (§30.5). */
  submerged: boolean;
  /** Released, not killed (§30.7). */
  released: boolean;
}

// -------------------------------------------------------------------------------------------------
// Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §6.4–6.5): additions, all optional
// -------------------------------------------------------------------------------------------------

/**
 * A hero's look package on the combat (`CombatSystem.looks`): the ice mage's `IceStage`, the
 * cleric's `HolyStage`, the greatshield's `EarthStage`, the swordmaster's `SwordStage` — each made
 * by `CombatSystem.load` only where its hero can fight (docs/design/COMBAT_VFX.md §6.12).
 * Visuals only: none of it touches a hit, a cooldown or an RNG of the fight.
 */
export interface LookStage {
  /** At the combat's warm-up: one of everything it draws, far below the world (programs compile at load). */
  warmup(far: { x: number; y: number; z: number }): void;
  /** After the warm frames: free what `warmup` made. */
  endWarmup(): void;
  /**
   * Once a frame, after the members' visuals and before the FX batch uploads: `dt` the combat
   * seconds advanced (0 while it does not run or in a hit-stop), `active` the combat runs (else
   * hushed: lights dark, a gust eased out — photo mode excepted), `frameDt` the frame's own
   * seconds, `ambient` a story run holds the player on a set-piece level (the ambient step).
   */
  update(dt: number, active: boolean, frameDt?: number, ambient?: boolean): void;
  /** An encounter's reset (a death, a rest): every VFX light it holds given back; spells still up go on unlit. */
  dropLights(): void;
  /** The combat goes (a travel included): meshes, lights, listeners, the gust. */
  dispose(): void;
  /** For tests (`heroInfo`, the sandboxes). */
  info(): object;
}

/**
 * A boss's pool of adds (CombatSystem `bossAdds`, from `EnemyDef.adds`): `count` foes of `kind` at
 * `level` (6 at level 5), hidden until its brain calls `ctx.spawnAdd`. A boss def without `adds`
 * has none.
 */
export interface BossAdds {
  kind: EnemyKind;
  count: number;
  level: number;
}

/**
 * `CombatSystem.strike(spec)`: one enemy-side area hit resolved at once against the player and
 * every companion (a sky dragon's fireball). The shape fields are a `HitSpec`'s.
 */
export interface StrikeSpec {
  /** The overlap test [circle]. */
  shape?: HitShape;
  x: number;
  z: number;
  /** Ground height of the hit [the ground at x, z]. */
  y?: number;
  /** Radius [1]. */
  r?: number;
  /** Ring inner radius [0]. */
  rInner?: number;
  /** Sector / lane axis [0, 1]. */
  dirX?: number;
  dirZ?: number;
  /** Sector half angle (degrees) [60]. */
  halfAngle?: number;
  /** Lane length [1] and width [1]. */
  len?: number;
  width?: number;
  /** Height tolerance [0.6]. */
  dy?: number;
  /** The attacker's ATK the motion value multiplies (as an enemy's `def.atk`) [0]. */
  atk?: number;
  /** Motion value (× `atk`; 0 with no `flat`: a push only) [0]. */
  mv?: number;
  /** > 0: flat damage (no ATK, no mitigation) [0]. */
  flat?: number;
  /** Knockback [0]. */
  kb?: number;
  /** Knocks down [false]. */
  knockdown?: boolean;
  /** Poise damage (unused against the party; kept for a HitSpec's shape) [0]. */
  poise?: number;
  /** Knockback origin [x, z]. */
  fromX?: number;
  fromZ?: number;
  /** ≠ 0: each target is hit once while the tag lives (`tags.next()`) [0: no tag]. */
  tag?: number;
}

// -------------------------------------------------------------------------------------------------
// The Bells of Evermere (COMBAT.md §30): additions, all optional
// -------------------------------------------------------------------------------------------------

/** One entry of a boss's adds as a list (`EnemyDef.adds`, §30.3). */
export interface BossAddSpec {
  /** The add's kind (not a boss). */
  kind: EnemyKind;
  /** How many of it are pooled [6]; the pool of a boss holds at most 12 in all. */
  count?: number;
  /** Their level [5]. */
  level?: number;
}

/** A boss arena's look (`EnemyDef.arena`, §30.2); every field absent: Cinderheart's. */
export interface BossArenaLook {
  /** The gate's wall: its quads' HDR colour [1.5, 0.75, 0.25] and atlas frame ['wallFlame']; null: no wall drawn. */
  wall?: { color?: readonly number[]; frames?: string } | null;
  /**
   * The phase-2 emitter over the arena: a particle preset ['embers'], or one with per-emitter
   * overrides (`{ preset, …DEFAULTS keys }`); null: none.
   */
  emitter?: string | ({ preset: string } & Record<string, unknown>) | null;
  /** The ground outline's marker style ['barrier'; Evermere's 'frost']. */
  outline?: MarkerStyle;
}

/** A boss's victory (`EnemyDef.victory`, §30.7); every field absent: Cinderwatch's. */
export interface EnemyVictory {
  /** The banner's title: a string key ['combat.victory.title']. */
  title?: string;
  /** The banner's line: a string key ['combat.victory.sub']; null: no banner. */
  line?: string | null;
  /** The upgrade it drops: 'core' (the Cinderheart Core), an upgrade pickup of that kind, null: none ['core']. */
  drop?: 'core' | 'maxHp' | 'maxMp' | 'attack' | null;
  /** false: no results card (a cutscene carries the defeat on) [true]. */
  results?: boolean;
}

/** A safe or warm disc on the ground (§30.8). */
export interface WarmthZone {
  x: number;
  z: number;
  r: number;
}

/** `ctx.pulse(spec)` / `CombatSystem.pulse` (§30.8). */
export interface PulseSpec {
  /** Its centre: [x, z] or { x, z } [the player]. */
  at?: readonly number[] | PointXZ;
  /** Its reach (u) from `at`; absent / Infinity: the whole level. */
  radius?: number;
  /** Flat damage to everyone it catches (no ATK, no DEF; a ward still takes its share) [0]. */
  power?: number;
  /** Knockback away from `at`; > 0 knocks down too [0]. */
  knock?: number;
  /** Discs that spare whoever stands in one [none]. */
  safe?: readonly WarmthZone[];
  /**
   * The ring drawn from `at` (a ground ring marker growing to `max` u — [radius, else 30] — at
   * `speed` u/s [24], `width` u [0.7], `style` ['frost'], `alpha` [1]); null: none [the default ring].
   */
  look?: { style?: MarkerStyle; speed?: number; width?: number; max?: number; alpha?: number } | null;
}

/** What a pulse did. */
export interface PulseResult {
  /** It could harm (engaged, an active step, not a scene). */
  harmful: boolean;
  /** The player was caught. */
  player: boolean;
  /** Companions caught. */
  allies: number;
  /** The player and companions a safe zone spared. */
  spared: number;
}

/** The resonance marks' look over a foe (`CombatSystem.marksLook`, §30.4); null: core draws none. */
export interface MarksLook {
  /** An atlas frame ['partyWardRing']. */
  frame: string;
  /** HDR colour (cut-out, below bloom) [1.25, 0.85, 0.3]. */
  color: number[];
  /** Quad scale [0.3]. */
  scale: number;
  /** Height above the body's top (u) [0.45]. */
  lift: number;
  /** Spacing of the marks in a row (u) [0.42]. */
  spacing: number;
}

/**
 * A pack's level system (`registerSystem`, src/game/combat/packs/index.js; §30.1): made by
 * `CombatSystem.load` after the enemies when its factory returns one (the Hush Bell's toll where a
 * black bell stands). Every member optional.
 */
export interface CombatPackSystem {
  /** Every active sub-step after the enemies (enemy-scaled seconds), and every ambient sub-step (`ctx.ambient` true). */
  update?(h: number, ctx: CombatContext): void;
  /** Every frame after the enemies' visuals: real seconds, the combat running, a scene's ambient step. */
  frame?(dt: number, active: boolean, ambient?: boolean): void;
  /** At the combat's warm-up (one of everything it draws, far below the world). */
  warmup?(far: { x: number; y: number; z: number }): void;
  /** After the warm frames: free what `warmup` made. */
  endWarmup?(): void;
  /** An encounter's reset (a death, a rest, the reset hook). */
  reset?(): void;
  /** The combat goes. */
  dispose?(): void;
  /** For tests: read through `sys.systems` (`__game.combat.system.systems`; the king suites, COMBAT.md §30.19). */
  info?(): object;
}

/** What `CombatSystem.strike` hit. */
export interface StrikeResult {
  /** The player was hit (not god mode, not in i-frames). */
  player: boolean;
  /** Companions hit. */
  allies: number;
}

/** A sky dragon's row of `state().combat.sky` (`SkyDragon.state()`). */
export interface SkyDragonState {
  /** Its level object's id. */
  id: string;
  /** There as the story stands. */
  present: boolean;
  /** Its shadow's world position. */
  x: number;
  z: number;
  /** Fireballs thrown so far. */
  volleys: number;
  /** Its heading (radians), its shadow's strength now (0–1), leaving, diving to a boss's landing, fireballs in flight. */
  heading: number;
  alpha: number;
  leaving: boolean;
  diving: boolean;
  live: number;
}

/**
 * A companion's running action (`MemberCombat.action`, §28): the warden's thrusts `a1` / `a2`
 * and `sweep`, the ranger's `shot` / `volley`, the mystic's `bolt` / `flare`, `mend`, the dodge
 * `roll`, `hurt` (hit stun), `knock` (knockdown), `getup` (after being down).
 */
export type AllyAction = 'a1' | 'a2' | 'sweep' | 'shot' | 'volley' | 'bolt' | 'flare' | 'mend' | 'roll' | 'hurt' | 'knock' | 'getup';

/** A companion's state (`MemberCombat.info()`: the `allies()` hook, `state().combat.allies`; §28). */
export interface AllyState {
  /** The member's id (its villager's). */
  id: string;
  /** Display name. */
  name: string;
  /** Its class: 'warden' | 'ranger' | 'mystic' | 'cleric' | 'icemage' | 'greatshield'. */
  cls: string;
  /** The preset its rule matches, or 'custom'. */
  preset: string;
  /** The party's level (the player's). */
  level: number;
  /** HP (rounded up; 0 while down). */
  hp: number;
  hpMax: number;
  /** MP (3 decimals). */
  mp: number;
  mpMax: number;
  /** ATK and DEF at the party's level (3 decimals). */
  atk: number;
  def: number;
  /** HP 0: it lies down until `ALLY.calm` s after the fight. */
  down: boolean;
  /** The combat drives it now (else the follow): `AllyCombatView.active`. */
  active: boolean;
  /** What its AI does: 'idle' (the follow), 'hold', 'attack', 'retreat', 'heal', 'evade', 'wait' (a closed arena), 'down', 'stop' (the player fell). */
  mode: string;
  /** Its running action, or null. */
  action: AllyAction | null;
  /** The frame of the action. */
  actionFrame: number;
  /** The uid of the foe it goes for, or null. */
  target: string | null;
  /** Live foes that have it as their target. */
  targetedBy: number;
  /** Foes it killed. */
  kills: number;
  /** Position (3 decimals). */
  x: number;
  z: number;
  /** Enemy hits pass through it now. */
  invulnerable: boolean;
  /** Seconds left: the next basic attack, the skill, Mend, the roll. */
  cooldowns: { attack: number; skill: number; heal: number; roll: number };
  /** Counters since its fight began (or the `reset` hook). */
  counts: {
    attacks: number; hits: number; crits: number; skills: number; heals: number; healed: number;
    rolls: number; hurts: number; damageDealt: number; damageTaken: number; downs: number;
  };
}

/** `CombatSystem.stats()` / the `stats()` hook. */
export interface CombatStats {
  /** `renderer.info.programs.length` now. */
  programs: number;
  /** The program count after the combat warm-up (must equal `programs` after a fight). */
  programsAtLoad: number;
  /** Scene draw calls of the last frame (PostFX `sceneInfo`). */
  drawCalls: number;
  /** Combat tick time, median (ms, last 240 frames). */
  tickMsP50: number;
  /** Combat tick time, 95th percentile (ms, last 240 frames). */
  tickMsP95: number;
  /** Entries in use per pool (`fx`: FxQuads quads, effects and pickups alike). */
  pools: { fx: number; markers: number; projectiles: number; pickups: number };
  /** Walk-grid counters (`Nav.stats`) plus its cell count and build time (§27.13 R1). */
  nav: {
    /** Path searches run. */
    searches: number;
    /** Searches that found a path. */
    found: number;
    /** Searches that failed (no path within the bounds: "unreachable"). */
    failed: number;
    /** Cells expanded, all searches together. */
    expanded: number;
    /** Most cells one search expanded. */
    maxExpanded: number;
    /** Open cells (an enemy may stand there). */
    open: number;
    /** Tight cells (open, but an enemy's body does not fit on the centre). */
    tight: number;
    /** Grid cells (cols × rows, 0.5 u each). */
    cells: number;
    /** Build time of the grid at load (ms). */
    buildMs: number;
  };
}

/** A row of the `enemies()` hook (hidden adds excluded). */
export interface CombatEnemyRow {
  /** Enemy uid. */
  uid: string;
  /** Its kind. */
  kind: EnemyKind;
  /** HP (rounded up). */
  hp: number;
  /** Max HP. */
  hpMax: number;
  /** Its `Enemy.state`. */
  state: EnemyState;
  /** Position x (3 decimals). */
  x: number;
  /** Position z (3 decimals). */
  z: number;
  /** Has noticed the player. */
  aggro: boolean;
  /** Not updated (far away and not aggroed, §7.5). */
  dormant: boolean;
  /** Its zone's region id, or null (§27.13 R5). */
  zone: string | null;
}

/** The `boss.info()` hook. */
export interface CombatBossInfo {
  /** The boss's uid. */
  uid: string;
  /** Its `Enemy.state`. */
  state: EnemyState;
  /** Frames spent in the state. */
  t: number;
  /** Phase 1..3. */
  phase: number;
  /** Not dead. */
  alive: boolean;
  /** Live hazard count. */
  hazards: number;
  /** The move in progress (null: none). */
  move?: BossMove | null;
  /** A move waiting for its approach walk to end (null: none). */
  pending?: BossMove | null;
  /** The charge ended at the arena edge: the 45 f skid (open, no vulnerability). */
  skid?: boolean;
}

/** `setPlayer(o)` fields (each optional). */
export interface CombatPlayerSettings {
  /** HP (capped at max). */
  hp?: number;
  /** MP (capped at max). */
  mp?: number;
  /** SP (capped at max). */
  sp?: number;
  /** Player level. */
  level?: number;
  /** XP towards the next level. */
  xp?: number;
  /** Gold carried. */
  gold?: number;
  /** Healing Draughts carried. */
  potions?: number;
  /** Upgrade totals to replace (refills HP / MP; §27.19 W2). */
  upgrades?: { maxHp?: number; maxMp?: number; attack?: number; def?: number };
}

/**
 * `window.__game.combat` on a combat level (`makeHooks`, `hooks.js`; COMBAT.md §20.1,
 * docs/specs/AUTOMATION_API.md §3). Uids: an enemy uid or 'all' where noted.
 */
export interface CombatHooks {
  /** `CombatState` (§20.2). */
  state(): CombatState;
  /** Reseed the combat RNG, every enemy RNG and the loot seed; the seed used (uint32). */
  seed(n: number): number;
  /** Full reset to a reproducible state (chests stay); the new state. */
  reset(): CombatState;
  /** Stop the loop, run n frames of dt, restart it if it ran; the state after. */
  step(n?: number, dt?: number): CombatState;
  /** Step until `pred(hooks)` holds → frames stepped (0: at once), −1: it never did (§27.13 R7). */
  stepUntil(pred: (hooks: CombatHooks) => boolean, maxFrames?: number, dt?: number): number;
  /** A virtual press held `frames` frames (1); a name not a `CombatAction` is refused (false). */
  press(action: CombatAction | (string & {}), frames?: number): boolean;
  /** A virtual hold (30 frames). */
  hold(action: CombatAction | (string & {}), frames?: number): boolean;
  /** World-space move override (null: real input); the override set. */
  move(x: number | null, z?: number): PointXZ | null;
  /** Aim-point override like the mouse (null: off); the override set. */
  aim(x: number | null, z?: number): PointXZ | null;
  /** Move an enemy and its home (uid or 'all'); false: no such enemy. */
  place(uid: string, x: number, z: number): boolean;
  /** Force aggro (uid or 'all'). */
  wake(uid: string): boolean;
  /** Kill through the normal path: XP, loot, events (uid or 'all'). */
  kill(uid: string): boolean;
  /** Deal n damage (no RNG, no floors; uid or 'all'). */
  damage(uid: string, n: number): boolean;
  /** Direct player damage (ignores i-frames and god): HP left, false when already dead. */
  damagePlayer(n: number): number | false;
  /** Set player values; the player part of the state. */
  setPlayer(o?: CombatPlayerSettings): CombatState['player'];
  /** No enemy hit reaches the player; the flag. */
  god(on?: boolean): boolean;
  /** Enemies stop updating (hits, deaths, fades and hit flashes go on); the flag. */
  freezeAI(on?: boolean): boolean;
  /** Jump the boss to phase n (HP lowered to its threshold); its phase, null without a live boss. */
  bossPhase(n: number): number | null;
  /** Boss test control (§27.13 R7). */
  boss: {
    /** Only `move` may be picked next (null: none); false without a live boss. */
    force(move: BossMove | null): boolean;
    /** Its state and move; null without a boss. */
    info(): CombatBossInfo | null;
    /** Snapshots of its live hazards. */
    hazards(type?: HazardType): HazardSnapshot[];
  };
  /** A walk-grid path `[[x, z], …]` (null: none within `maxU` u; 80). */
  path(x0: number, z0: number, x1: number, z1: number, maxU?: number): number[][] | null;
  /** Set the boss's HP fraction (no floors); its HP, null without a boss. */
  setBossHp(frac: number): number | null;
  /** Attune a waystone ('spawn': the level start); its id, null when unknown. */
  checkpoint(id: string): string | null;
  /** Rest at once at `id` (or the current checkpoint); false when unknown. */
  rest(id?: string): boolean;
  /** The death reset at once (no screen); the new state. */
  respawn(): CombatState;
  /** Fire every effect, marker, projectile, pickup, burst and SFX once: the counts. */
  showcase(): { fx: number; markers: number; projectiles: number; pickups: number };
  /** Every enemy (hidden adds excluded). */
  enemies(): CombatEnemyRow[];
  /** Performance and pool figures (`CombatStats`). */
  stats(): CombatStats;
  /** The CombatSystem itself (§27.6 C3). */
  system: CombatSystem;
  /** Every companion's state, join order (§28; [] without a party). */
  allies(): AllyState[];
  /** n damage to a companion (member id or name; no RNG or reaction; 0 HP: down) → its HP, null: none. */
  allyHurt(id: string, n: number): number | null;
  /** Whom enemy `uid` fights ('player' or a companion's id; null: no such enemy); `who` sets it first ('player' / null: the player). */
  allyTarget(uid: string, who?: string | null): string | null;
  /** Set a companion's { hp, mp } (hp 0: down) → its state, null: none. */
  allySet(id: string, o?: { hp?: number; mp?: number }): AllyState | null;
  /** No enemy hit reaches a companion; the flag. */
  allyGod(on?: boolean): boolean;
  /** Every companion full and up (the story's `heal`) → how many. */
  healAllies(): number;
  // ---- Vanquish the Evil Dragon (COMBAT.md §29) ----
  /**
   * The party's ward: with `frac` / `seconds` a new one first (`CombatSystem.ward`) → the strongest
   * fraction now and every ward `{ frac, t }` (t: seconds left).
   */
  ward(frac?: number, seconds?: number): { frac: number; wards: { frac: number; t: number }[] };
  /** An enemy's status effects, taunt and target; null: no such enemy. */
  statusOf(uid: string): EnemyStatusState | null;
  /**
   * Put status effects on an enemy (uid or 'all') as a player-side hit would (`HitStatus`: chill,
   * slow, freeze, stun) → false: no such enemy.
   */
  status(uid: string, st: HitStatus): boolean;
  /** A companion's taunt (`CombatSystem.taunt`) at (x, z) → the foes it drew; null: no such companion. */
  taunt(id: string, x: number, z: number, r: number, seconds: number): number | null;
  /** `CombatSystem.strike(spec)` (an enemy-side area hit from no enemy). */
  strike(spec: StrikeSpec): StrikeResult;
  // ---- The Bells of Evermere (COMBAT.md §30) ----
  /** An enemy's resonance marks; with `n` set first (0–3, the 6 s renewed) → its marks, null: no such enemy. */
  marks(uid: string, n?: number): number | null;
  /** Submerge (true) or surface (false, at x, z when given) an enemy → its `submerged`, null: no such enemy. */
  submerge(uid: string, on: boolean, x?: number, z?: number): boolean | null;
  /** `CombatSystem.pulse(spec)`. */
  pulse(spec: PulseSpec): PulseResult;
  /** Release an enemy at once (`CombatSystem.release`) → false: no such enemy, or not alive. */
  release(uid: string): boolean;
}

// -------------------------------------------------------------------------------------------------
// Core records (CombatSystem, PlayerCombat, Hitboxes, Projectiles; not part of §9)
// -------------------------------------------------------------------------------------------------

/**
 * `PlayerCombat.action` (null: locomotion): every combo step is 'attack'; the skills are their
 * slot ids.
 */
export type PlayerAction =
  | 'attack' | 'roll' | 'backstep' | 'skill1' | 'skill2' | 'skill3' | 'draught'
  | 'hitstun' | 'knockdown' | 'dead';

/** Chest / boss-core / shop upgrades (`PlayerCombat.upgrade`; `def` has no default amount). */
export type UpgradeKind = 'maxHp' | 'maxMp' | 'attack' | 'core' | 'def';

/** Hit metadata carried next to a player HitSpec (`PlayerCombat.js` `PLAYER_HIT_META`). */
export interface PlayerHitMeta {
  /** `HitInfo.source` of the hit. */
  source: 'melee' | 'skill' | 'projectile';
  /** Hit-stop base (frames) before the crit / kill bonus (`playerHitStop`). */
  stop: number;
  /** The combo finisher (A3): crit chance +0.10, the finisher shake. */
  finisher: boolean;
  /** Combo step 1..3 (0: not a combo swing; step 3 on a dummy counts for the tutorial). */
  combo: number;
}

/** One player swing: its hit tag and the MP it gained so far (`PlayerCombat.onMeleeLanded`). */
export interface SwingRecord {
  /** The swing's hit tag (`TagRegistry.next()`). */
  tag: number;
  /** MP gained by this swing (at most `MP_PER_SWING_MAX`). */
  mp: number;
}

/** A registered hitbox of the current sub-step (`HitQueue.items`). */
export interface QueuedHit {
  /** The attacker (a companion's hitboxes: the MemberCombat, `allyHits`); null for a free pool record. */
  owner: Enemy | 'player' | MemberCombat | null;
  /** The pooled copy of the spec, every field filled (`Hitboxes.js` DEFAULTS). */
  spec: Required<HitSpec>;
  /** Player hits: `CombatSystem.addPlayerHit` writes the meta entry. */
  meta?: PlayerHitMeta;
  /** Player hits: the swing's MP record (null: skills). */
  swing?: SwingRecord | null;
}

/** A pooled projectile (`Projectiles.items`); the core's contact and landing code reads it. */
export interface LiveProjectile extends HitStatus {
  /** Hit-stop and shake when a player-side shot hits (null: none). */
  feel: HitFeel | null;
  /** Its own look (null: the kind's). */
  look: ProjectileLook | null;
  /** Seconds to its next trail burst (a look with a `trail`). */
  trailT: number;
  /** In flight (pooled records are reused). */
  alive: boolean;
  /** The shooter; 'fx': a showcase shot that touches nothing; a companion's shot: the companion; null: free. */
  owner: Enemy | 'player' | 'fx' | MemberCombat | null;
  /** A player shot (tests the enemies; player time scale) — a companion's shots too. */
  player: boolean;
  /** A party companion's shot: the companion (`Projectiles.spawn(owner, spec, ally)`), else null. */
  ally: MemberCombat | null;
  /** Look, sound and flight rules. */
  kind: ProjectileKind;
  /** Position x. */
  x: number;
  /** Position y (absolute). */
  y: number;
  /** Position z. */
  z: number;
  /** Unit horizontal direction x. */
  dirX: number;
  /** Unit horizontal direction z. */
  dirZ: number;
  /** Vertical speed (u/s). */
  vy: number;
  /** Horizontal speed (u/s). */
  speed: number;
  /** Horizontal range (u). */
  range: number;
  /** Horizontal distance flown. */
  traveled: number;
  /** Collision radius. */
  radius: number;
  /** Motion value of its hit. */
  mv: number;
  /** Knockback strength of its hit. */
  kb: number;
  /** Poise damage of its hit. */
  poise: number;
  /** Flies on through the first target. */
  pierce: boolean;
  /** Splash on impact (Ember Bolt) or null. */
  splash: Splash | null;
  /** The splash's own hit tag (0: none). */
  splashTag: number;
  /** Arc flight (boulder): `_arc` while it flies an arc, else null. */
  arc: Required<ArcFlight> | null;
  /** Launch point x (arc flight). */
  sx: number;
  /** Launch height (arc flight). */
  sy: number;
  /** Launch point z (arc flight). */
  sz: number;
  /** Ground height at the arc's landing point. */
  ty: number;
  /** Seconds of arc flight. */
  t: number;
  /** Its hit tag (`TagRegistry.next()`). */
  tag: number;
  /** Its FxQuads handle (−1: none). */
  h: number;
  /** Seconds since launch (frame animation). */
  age: number;
  /** Launch counter. */
  serial: number;
  /** The record's own arc object (`arc` points to it while arcing). */
  _arc: Required<ArcFlight>;
}

/**
 * A projectile contact of the current sub-step (`CombatSystem._contacts`, pooled; filled by
 * `queueProjectileHit`, resolved in order by `_resolve`). The shot's status effects, feel and look
 * are copied (the shot's record may be reused before the contact is resolved).
 */
export interface ProjectileContact extends HitStatus {
  /** The shot's feel (null: none). */
  feel: HitFeel | null;
  /** The shot's look (null: the kind's). */
  look: ProjectileLook | null;
  /** Code: never written (always null; the pool record's initial field). */
  p: LiveProjectile | null;
  /** What it touched: an enemy (player shots), 'player' or a party companion (enemy shots). */
  target: Enemy | 'player' | MemberCombat | null;
  /** Contact point x. */
  x: number;
  /** Contact height. */
  y: number;
  /** Contact point z. */
  z: number;
  /** The shot's unit direction x (knockback). */
  dirX: number;
  /** The shot's unit direction z. */
  dirZ: number;
  /** Motion value of the hit. */
  mv: number;
  /** Knockback strength of the hit. */
  kb: number;
  /** Poise damage of the hit. */
  poise: number;
  /** The shot's hit tag. */
  tag: number;
  /** The shooter (never 'fx': showcase shots touch nothing; a companion's shot: the companion). */
  owner: Enemy | 'player' | MemberCombat | null;
  /** Splash on impact (Ember Bolt) or null. */
  splash: Splash | null;
  /** The splash's hit tag. */
  splashTag: number;
  /** The projectile kind ('' on a fresh pool record). */
  kind: ProjectileKind | '';
  /** A player shot (a companion's shots are player shots too). */
  player: boolean;
  /** A party companion's shot: the companion (its ATK, its RNG; PARTY.md §5.2), else null. */
  ally: MemberCombat | null;
}

// -------------------------------------------------------------------------------------------------
// Fields created lazily or from other modules (declared here: declaring them in the classes would
// change the code)
// -------------------------------------------------------------------------------------------------

declare module './Enemy.js' {
  interface Enemy {
    /** CombatSystem: combat clock of the last damage or heal (the HP bar shows for 4 s after it). */
    _barT?: number;
    /** CombatSystem: enemy time of the last hit on a dummy (its HP refills 120 f later). */
    _refillFrom?: number;
    /** CombatSystem: a boss add's boss (`_createAdds`). */
    _boss?: Enemy;
    /** CombatSystem `_updateLabels`: distance to the player this frame (bar / arrow order). */
    _barD?: number;
    /** CombatSystem `_updateLabels`: 0 nothing, 1 HP bar, 2 aggro pip. */
    _barMode?: number;
    /** CombatSystem `_updateLabels`: the frame stamp of the enemies that get a bar slot. */
    _barPick?: number;
    /** Targeting `_gather`: the body middle's NDC x (lock order). */
    _ndcX?: number;
    /** Targeting `_gather`: distance to the player (lock order). */
    _lockDist?: number;
  }
}

declare module './CombatSystem.js' {
  interface CombatSystem {
    /** `los`: reused collider query list. */
    _losCs?: TileMap['colliders'];
    /** `_blockKind`: reused collider query list. */
    _blkCs?: TileMap['colliders'];
    /** `_moveGround`: reused `tileMap.move` result. */
    _moveOut?: PointXZ;
    /** `_hitEnemy`: the one HitInfo record passed to `e.receiveHit`. */
    _info?: HitInfo;
    /** `queueLanding`: the arc projectile's landing hitbox. */
    _landSpec?: HitSpec;
    /** `_dropLoot`: the reused `rollLoot` result. */
    _loot?: LootRoll;
    /** `dropGold`: the reused `splitCoins` records. */
    _coins?: { kind: string; amount: number }[];
    /** `_separation`: the enemies taking part this frame. */
    _act?: Enemy[];
    /** `_updateLabels`: enemies that want an HP bar or a pip. */
    _barCands?: Enemy[];
    /** `_updateLabels`: aggroed enemies off screen (edge arrows). */
    _edgeCands?: Enemy[];
    /** `_updateLabels`: the enemy holding each of the 32 bar slots. */
    _barOf?: (Enemy | null)[];
    /** `_updateLabels`: the reused bar options. */
    _barOpts?: { elite: boolean; level: number; name: string; pip: boolean };
    /** `_updateLabels`: the enemy of each of the 8 edge arrows. */
    _edgeOf?: (Enemy | null)[];
    /** `_updateLabels`: the reused edge-arrow options. */
    _edgeOpts?: { windup: boolean };
    /** `_allyHitEnemy`: the HitInfo record of a companion's hits. */
    _allyInfo?: HitInfo;
    /** `_allySeparation`: the companions taking part this frame. */
    _allySep?: MemberCombat[];
  }
}

declare module './Nav.js' {
  interface Nav {
    /** CombatSystem `load`: build time of the grid (ms), for `stats().nav`. */
    buildMs?: number;
  }
}
