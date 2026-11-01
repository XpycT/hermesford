import { Sprite3D, DIRECTIONS, globalUniforms, damp, hashString } from '../../engine/index.js';
import { BRAINS } from './ai/index.js';
import { TAG_SPAN, TAG_SLOTS } from './Hitboxes.js';
import { MELEE_DY } from './rules.js';

/**
 * @import { HitSpec, ProjectileSpec, MarkerSpec, MarkerShape, EnemyHazard, HazardSnapshot, HitInfo,
 *   CombatContext, EnemyState, BlockedBy, RectXZ, PointXZ, EnemyInit,
 *   HazardType } from './types.js'
 * @import { MemberCombat } from '../party/MemberCombat.js'
 */

/**
 * Enemy — one hostile actor on a combat level (COMBAT.md §7, §9.3). The combat core creates every
 * enemy at load (`createEnemy`), adds `e.sprite` to the scene and the SpriteManager, and runs
 * `e.update(h, ctx)` once per combat sub-step for every non-dormant enemy (h already scaled; never
 * 0). Core owns damage (it writes `hp` and `hitFlash`), XP / loot, tokens (`ctx.requestToken`),
 * `deathCount` and `barSlot`; the enemy owns its state machine, poses, flash / glow uniforms,
 * movement (`ctx.moveGround` / `ctx.moveFly`), markers, hitboxes and projectiles.
 *
 * Shared state machine (§7.4): dormant → idle → notice → engage ⇄ windup → active → recover, with
 * the interrupts hitstun / stagger / stun, `return` when the leash breaks and `dead`. The kind's
 * brain (`ai/<kind>.js`, picked from `ai/index.js`) supplies idle / engage / attack behaviour; the
 * boss brain (`golem`) drives every state itself (§8). Brains talk to the world only through the
 * CombatContext of §9.2 and the helpers below, and draw randomness only from `e.rng`.
 *
 * Time: every state keeps `e.t`, the scaled seconds already spent in it at the start of the
 * current sub-step (frame index `e.fr`, `e.after(n)` = "n frames have passed"); a state entered
 * during a sub-step runs its frame 0 in that same sub-step. Windows are specified in frames (f)
 * and stored in seconds (`f / 60`), compared with EPS = 1e-6.
 *
 * Helpers for brains (all allocation-free in steady state):
 * - movement: `move(dx, dz, ctx)` (raw, through moveGround / moveFly), `walk(dirX, dirZ, speed,
 *   h, ctx, anim, faceMove)`, `seek(x, z, speed, h, ctx, anim)` (stuck detours), `chase(speed,
 *   h, ctx, anim)` (the player: straight while the way is clear, else along a path of the level's
 *   walk grid `ctx.nav` — stairs, ledges, around rocks), `freeRun(...)`; `canMelee(ctx)` (the
 *   player within the melee height rule and a straight walk away: a melee brain winds up only
 *   then, else it chases);
 * - telegraphs: `mark(i, ctx, spec)` / `markProgress` / `unmark` (marker slots owned by the
 *   current attack, freed on every interrupt), `markToFade`, hazards (`hazardCircle`,
 *   `hazardRing`, `hazardMagma`, `hazardVisual`: delayed effects that outlive the attack);
 * - attacks: `hitSpec()` / `projSpec()` (pooled spec objects), `newTag()` (a number),
 *   `takeToken(ctx)`,
 *   `dropToken(ctx)`, `canWindup(ctx)` (on-screen rule, §7.3), `midY()`.
 *
 * Status effects (COMBAT.md §29 V5): `chill(s, slow)` scales its whole step by (1 − slow) — its
 * moves, its attack timelines and (core) its animation — with a frost tint; `freeze(s)` and
 * `stun(s)` hold it in the shared `stun` state (the attack cancelled, its brain not called: its
 * timers paused) — frozen with an ice tint and its animation stopped, stunned with the hurt pose
 * and core's dizzy stars. A boss is only chilled (its brain drives every state). The status timers
 * run on the enemy's unscaled time; `statusOn`, `timeScale`, `frozen` and `held` tell core.
 *
 * Set pieces (§29): in the ambient step (`ctx.ambient`) an idle enemy runs its idle without the
 * aggro check; a `swarm` enemy has no leash and no zone and aggroes at any distance; a dying
 * enemy's brain may play its death throes (`brain.dead`).
 */

const EPS = 1e-6;
/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;

/** Frames of the shared states (§7.4). */
const NOTICE_F = 21;
const HITSTUN_F = 13;
const STAGGER_F = 36;
const STAGGER_BOAR_F = 60;
const STUN_F = 120;
const DEATH_FADE_F = 30;
const BOSS_FADE_F = 90;
/**
 * The boss's death flash: 6 f of a warm ember tint (1, 0.5, 0.2) at 0.55 — its full-white flash
 * (a 1) on the collapsing heap drew white "wings" round a player standing in front (COMBAT-16).
 */
const BOSS_FLASH_F = 6;
const BOSS_DEATH_FLASH = Object.freeze([1, 0.5, 0.2, 0.55]);
const BAT_FALL_F = 12;
const POISE_REGEN_F = 120;
const TOKEN_RETRY_F = 18;
const KB_F = 11;
const KB_CAP = 3;
/** Aggro sensing cadence (LOS is sampled, not free). */
const SENSE_F = 6;
/** Stuck: < 25 % of the intended distance for 30 f → detour; 90 f → give up (return). */
const STUCK_F = 30;
const GIVEUP_F = 90;
const DETOUR_F = 24;
/**
 * A seeking enemy that got < 1 u away from where it was 4 s ago (and is not there) gives up —
 * unless its quarry (the player while it is aggroed, else the point it walks to) moved more than
 * 1.5 u meanwhile: following a player who runs up and down a stair, it can end the 4 s where it
 * began without being stuck (COMBAT-18 review). A wind-up (an attack begins) starts the 4 s afresh.
 */
const ANCHOR_S = 4;
const ANCHOR_GOAL = 1.5;
/** Returning home: 1.5 × speed, 20 % max HP/s; a return blocked this long snaps home. */
const RETURN_SNAP_F = 150;
/** A snap home in view fades the sprite out (and in again at home) over this many frames. */
const SNAP_FADE_F = 18;
const HOME_EPS = 0.35;
/** After giving up (unreachable player) sight aggro is suppressed this long (s). */
const CALM_S = 6;
/**
 * Paths on the walk grid (`ctx.nav`, Nav.js). A chaser re-decides "straight or path" every 6 f; a
 * chase path is renewed after 60 f, when the player moved 1.5 u from its goal, when the walk is
 * stuck or its way to the current waypoint is no longer clear (never sooner than 20 f after the
 * last search); a walk home is renewed when stuck or off its way the same way. A waypoint counts as
 * passed within 0.4 u only when the next one is in a straight line from where the enemy stands
 * (or it stands in the waypoint's own cell) — cutting the corner at a stair's foot ran it into the
 * cliff beside the stair (COMBAT-18); a walk blocked for 6 f right after such an early pass goes
 * back to the waypoint and passes it only on the spot (the ramp beside a stair's foot is steeper
 * for the body's rim than the cell centres say). Searches are bounded: a chase accepts a path of <= max(24,
 * 2.5 x (leash + home radius)) u (longer or none: the player is unreachable, give up), a walk home
 * <= max(40, 4 x (leash + radius)) u.
 */
const NAV_EVERY = 6;
const REPLAN_F = 60;
const REPLAN_MIN_F = 20;
const REPLAN_D = 1.5;
const WP_REACH = 0.4;
/** A waypoint to be reached exactly (after a cut the body could not take) counts within this. */
const WP_EXACT = 0.05;
/** A walk blocked this long right after passing a waypoint early goes back to that waypoint. */
const CUT_BACK_F = 6;
const MAX_WP = 24;
const CHASE_COST = [24, 2.5];
const HOME_COST = [40, 4];
/** A swarm's chase accepts paths this long (u): it rushes the party from where it appeared (§29 V4). */
const SWARM_REACH = 80;
const PATH_CHASE = 1;
const PATH_HOME = 2;
/**
 * Zones (the level's `region` objects, COMBAT-19): an enemy that leaves its group's region grown by
 * 3 u goes home at once; the player outside it (grown by 3 u) is not sight-aggroed and makes an
 * engaged enemy go home after 1 s.
 */
const ZONE_MARGIN = 3;
const ZONE_LEAVE_S = 1;

/** Enemy hit flash (§11.4): (2.2, 2.2, 2.2) a 0.85 for 2 f, then a 0.4 for 2 f. */
const FLASH_STRONG = F(2);
/**
 * Wind-up pulse (§7.3) and elite shimmer (§7.2) as a Sprite3D **highlight**: it brightens and
 * colours the sprite's own shading (`setHighlight`), so the wind-up pose — the tell — keeps its
 * detail on every sheet, the dark boar and golem included. (A `uFlash` mix toward the HDR colour
 * flattened them into a peach silhouette, KNOWN_ISSUES COMBAT-03.) Strengths: the wind-up pulses
 * 0.45 ↔ 0.9 at 8 Hz, the elite shimmer 0.12 ↔ 0.24 at 1 Hz.
 */
const WINDUP_HL = Object.freeze({ r: 1.6, g: 0.7, b: 0.3, lo: 0.45, hi: 0.9 });
const ELITE_HL = Object.freeze({ r: 1.6, g: 1.3, b: 0.5, lo: 0.12, hi: 0.24 });
/**
 * Status tints (§29 V5), on the same uniforms and programs. The highlight adds `c · rgb · a` to a
 * texel's own lit colour `c` (below luminance 0.45), so a highlight with a negative red and a
 * positive blue is a cold colour *ratio*: the sprite's shading and hues stay, its reds sink and its
 * blues rise — whereas any mix toward a fixed colour (`uFlash`) swamps these dark linear colours.
 * A chilled enemy: that cold ratio breathing (a 0.5 ↔ 0.62 at 1.5 Hz: r × ≈0.74, b × ≈1.65) and a
 * faint rime mix 0.07 (it keeps its cold cast while the wind-up pulse — which still wins the
 * highlight, the tell readable — plays). A frozen one: a mix 0.3 toward pale glacier ice (a bright
 * shell over its pose) under a strong cold ratio: the two read apart at a glance.
 */
const RIME_FLASH = Object.freeze({ r: 0.5, g: 0.78, b: 1.1, a: 0.07 });
const CHILL_HL = Object.freeze({ r: -0.45, g: -0.08, b: 1.15, lo: 0.5, hi: 0.62 });
const ICE_FLASH = Object.freeze({ r: 0.5, g: 0.78, b: 1.15, a: 0.3 });
const ICE_HL = Object.freeze({ r: -0.3, g: 0.25, b: 1.5, a: 0.6 });
/** Frozen under an ice shell (`iceShell`): the shell is the ice — a faint rime, a milder cold ratio. */
const SHELL_FLASH = Object.freeze({ r: 0.5, g: 0.78, b: 1.15, a: 0.16 });
const SHELL_HL = Object.freeze({ r: -0.3, g: 0.2, b: 1.4, a: 0.5 });
/** Seconds between two ice glints of a frozen enemy. */
const GLINT_EVERY = 0.38;
/** A chill without a slow (`chill(s, 0)`), a boss frozen (only chilled), and the slow's cap. */
const CHILL_SLOW = 0.35;
const BOSS_FREEZE_SLOW = 0.2;
/**
 * A boss resists the cold (rv-play #4: an ice mage's lances kept Vorthrax at half speed and frost-
 * blue for a whole fight): its slow is at most 0.2, one chill lasts at most 3 s however often it is
 * renewed, and after it the boss is immune for 6 s (≤ a third of a fight chilled); its frost look
 * is half as strong (it stays red).
 */
const BOSS_SLOW_MAX = 0.2;
const BOSS_CHILL_MAX = 3;
const BOSS_CHILL_REST = 6;
const BOSS_TINT = 0.5;
const SLOW_MAX = 0.9;
/** Status seconds are capped (level / caller data). */
const STATUS_MAX = 30;
/** Seconds between two frost-mote bursts of a chilled enemy. */
const FROST_EVERY = 0.45;
/**
 * The status bursts: frost motes rising from a chilled body, ice glints as it freezes, a shatter of
 * ice chips and streaks as it thaws — overrides of the combat's warmed burst presets (healGlow,
 * magicBurst, splash, hitSpark: per-particle fields only, so their pools and programs are shared).
 */
const FROST_MOTES = Object.freeze({ color: '#cfeeff', hdr: 1.9, size: [0.12, 0.2] });
const ICE_GLINT = Object.freeze({ colors: ['#e6f7ff', '#8fd0ff'], hdr: 2.6 });
const ICE_TWINKLE = Object.freeze({ color: '#e8f8ff', hdr: 1.8, size: [0.14, 0.24], spawnSize: [0.7, 1.0, 0.7], burstUp: [0, 0.2], velocity: [0, 0.15, 0] });
const ICE_CHIPS = Object.freeze({ color: '#dff4ff', hdr: 1.6, size: [0.08, 0.14] });
const ICE_STREAK = Object.freeze({ color: '#f2fbff', colorEnd: '#7fc4ff', hdr: 3.2 });

const DETOUR_ANGLES = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

/**
 * The Bells of Evermere (COMBAT.md §30): resonance marks — at most 3 on any foe (a boss too), all
 * gone 6 s (enemy time) after the last one came.
 */
export const MARK_CAP = 3;
export const MARK_DECAY = 6;

export class Enemy {
  /** @param {EnemyInit} init */
  constructor(init) {
    const { def, sprite } = init;
    // identity / data (read by core)
    this.uid = init.uid;
    this.groupId = init.group?.id ?? '';
    this.index = init.index ?? 0;
    this.kind = init.kind;
    this.level = init.level ?? 1;
    this.elite = !!init.elite;
    this.name = init.name || def.name;
    this.def = def;
    this.sheet = init.sheet;
    this.sprite = sprite;
    this.rng = init.rng;
    this.boss = !!def.boss;
    this.flier = !!def.flier;
    this.passive = !!def.passive;
    this.isAdd = !!init.isAdd;
    this.arena = init.arena ?? null;
    /** @type {BlockedBy} what stopped the last ctx.moveGround / moveFly */
    this.blockedBy = null;
    /** Core-owned: this enemy's deaths this session (loot seed, §7.8). */
    this.deathCount = 0;
    /**
     * Core-owned: the index of the level region (`region` object) its group's centre lies in (-1:
     * none) and that region's rect `{ minX, maxX, minZ, maxZ }` (null: no zone rules, COMBAT-19).
     */
    this.zone = -1;
    /** @type {RectXZ|null} */
    this.zoneRect = null;
    /**
     * The point its group besieges while idle (the group's `besiege` [x, z] or [x, z, r], a house:
     * DRAGON_CAMPAIGN.md §5.3) — it attacks it from a ring of radius `r` (default 2.6) until its
     * normal aggro turns it on the party; null for none (and for a boss's add). The idle behaviour
     * is the brains' (brutes package).
     * @type {{ x: number, z: number, r: number }|null}
     */
    this.besiege = init.isAdd ? null : besiegeOf(init.group?.besiege);
    /**
     * Its group swarms (the group's `swarm: true`, §5.3): on appearing — or at load when present —
     * the whole group wakes and rushes the party, no leash, no zone, aggro at any distance (core
     * and the swarm brains). False for a boss's add.
     */
    this.swarm = !init.isAdd && init.group?.swarm === true;
    /** A swarm foe's rush was spent by the player's fall (`settle`): it aggroes like any foe until a reset. */
    this.rushed = false;
    /** Hit tags of this enemy: `tagBase + 0 … TAG_SPAN - 1` (a core-assigned slot, else by uid). */
    this._tagBase = ((Number.isInteger(init.tagSlot) && init.tagSlot > 0 ? init.tagSlot : (hashString(this.uid) % (TAG_SLOTS - 1)) + 1) % TAG_SLOTS) * TAG_SPAN;

    // live state
    /** === sprite.position (group origin at the feet; y = ground, fliers hover above it). */
    this.position = sprite.position;
    this.home = { x: init.home.x, z: init.home.z };
    /** The group's home radius (u): wander area, leash slack (`leash + radius`), flier clamp. */
    this.homeRadius = Math.max(0.5, Number(init.group?.radius) || 3);
    /** Unit facing on XZ. */
    this.facing = { x: 0, z: 1 };
    this.hpMax = def.hp;
    this.hp = def.hp;
    this.poiseMax = def.poise;
    this.poise = def.poise;
    this.alive = true;
    /** @type {EnemyState} (the boss's Broken state is 'stagger') */
    this.state = 'idle';
    this.aggro = false;
    this.dormant = false;
    /** Hits show 'Guard' and deal no damage (return, boss roar / intro). */
    this.guarded = false;
    /** No poise damage, no knockback (charge, super armour). */
    this.armored = false;
    /** Crits +0.30 or forced (boss core). */
    this.exposed = false;
    /** Damage multiplier (1, 1.3, 1.5). */
    this.vuln = 1;
    /** Seconds of hit flash left; set by core on damage. */
    this.hitFlash = 0;
    /** Holds an attack token (set by ctx.requestToken, cleared by ctx.releaseToken). */
    this.token = false;
    /** Core-owned WorldLabels bar slot (−1 = none). */
    this.barSlot = -1;
    /**
     * Core-owned (docs/specs/PARTY.md §5.3): the party companion this enemy fights, or null — the
     * player. Before its update core shows it the target's view as `ctx.player`; the enemy itself
     * never reads it. Cleared by `reset`, `sendHome`, `die` and `vanish`.
     * @type {MemberCombat|null}
     */
    this.target = null;
    /** Core-owned: seconds it keeps a companion target at least (after the switch / a hit). */
    this.targetHold = 0;
    /** Core-owned: seconds to its next look whether the player is clearly nearer than its companion target. */
    this.targetCheck = 0;
    /** Core-owned: combat clock time of the player's last hit on it (a companion's `assist` rule). */
    this.playerHitAt = -Infinity;
    /**
     * Core-owned (COMBAT.md §29 V7): seconds left of a companion's taunt — `target` stays on that
     * companion until it ends (or the companion falls). Cleared with `target`.
     */
    this.tauntT = 0;
    /** Core-owned: the last ambient step updated it (§29 V2; its sprite plays at speed 1 then). */
    this.ambientRun = false;
    this.radius = def.radius;
    this.mass = def.mass;
    /** Live hover height above the ground (fliers; 0 otherwise) — the flier body band is [hover − 0.45, hover + 0.45]. */
    this.hover = def.hover ?? 0;
    /** Boss only: 1..3 (0 for every other kind). */
    this.phase = this.boss ? 1 : 0;
    /**
     * Boss only (0 otherwise): the HP the boss may not drop below right now — the next phase
     * threshold (70 % / 35 % of max) and, during the phase-3 kneel, the 8 % damage cap (§8.3).
     * Core may apply it as `hp = max(hp − damage, hpFloor)`.
     */
    this.hpFloor = 0;

    /** Scaled seconds spent in the current state at the start of this sub-step. */
    this.t = 0;
    /** The kind's brain (`ai/<kind>.js`) and its per-enemy state. */
    this.brain = BRAINS[this.kind] ?? BRAINS.dummy;
    this.ai = null;
    /** Toward the player, refreshed every sub-step: unit (dx, dz), horizontal d, dy = player ground − own ground. */
    this.tp = { dx: 0, dz: 1, d: Infinity, dy: 0 };
    /**
     * The last chase path search found no way to the player (or only one longer than the chase
     * accepts): an engaged enemy gives up (walks home, calm for 6 s). Cleared by a straight way or
     * a path found.
     */
    this.unreachable = false;

    // internals
    this._enterN = 0;
    this._poseName = null;
    this._poseCol = -1;
    this._poseRow = -1;
    this._grounded = false;
    this._poiseT = 0;
    this._tokenWait = 0;
    this._senseT = 0;
    this._farT = 0;
    this._calmT = 0;
    this._stuckT = 0;
    this._detourT = 0;
    this._detourX = 0;
    this._detourZ = 1;
    this._detourSide = 1;
    this._anchorT = 0;
    this._anchorX = 0;
    this._anchorZ = 0;
    this._anchorTX = 0;
    this._anchorTZ = 0;
    /** Snap-home fade: 0 = opaque; > 0 fading out (direction 1) or back in (−1). */
    this._ghost = 0;
    this._ghostDir = 0;
    this._kbDist = 0;
    this._kbT = 0;
    this._kbX = 0;
    this._kbZ = 0;
    /** Visual lift of the quad above the hover (slime hops, dying bats). */
    this.lift = 0;
    /** Own clock (s) for visual pulses; seeded phase so packs do not pulse in unison. */
    this._clock = (hashString(this.uid) % 997) / 997;
    this._wander = { has: false, x: 0, z: 0, pause: 0 };
    // path on the walk grid: waypoints [x0, z0, …], count, the one walked to, what it leads to
    this._path = new Float32Array(MAX_WP * 2);
    this._pathN = 0;
    this._pathI = 0;
    this._pathFor = 0;
    this._pathAt = -Infinity;
    this._pathGX = 0;
    this._pathGZ = 0;
    this._homeLost = false;
    /** The way from here to the current waypoint is blocked (pushed off the path): search again. */
    this._pathBad = false;
    /** The waypoint index reached by passing the one before it early (−1: none), and the one to reach exactly. */
    this._pathCut = -1;
    this._pathExact = -1;
    /** `canMelee`'s cached straight-way test and the frame it is due again. */
    this._meleeWay = true;
    this._meleeNext = 0;
    this._navNext = 0;
    this._navDirect = true;
    this._navPhase = hashString(this.uid) % NAV_EVERY;
    this._zoneT = 0;
    this._slots = [-1, -1, -1, -1];
    this._slotSpec = { progress: 0 };
    this._fadeSpec = { progress: 1, alpha: 1 };
    /** Result of `bestAway` (unit direction). */
    this.away = { x: 0, z: 1 };
    /** Result of `chasePoint`. */
    this.cp = { x: 0, z: 0 };
    /** @type {MarkerSpec} the shared spec of `markerSpec()` */
    this._ms = { shape: 'circle', x: 0, y: 0.03, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1, w: 1, d: 1, progress: 0, style: 'enemy', alpha: 1 };
    /** @type {EnemyHazard[]} pooled delayed hazards (a free record has `on` false) */
    this._hazards = [];
    // HitSpecs in rotation: the boss can register a slam, 3 rings, magma ticks and rain circles in one sub-step
    this._hs = [];
    for (let i = 0; i < 16; i++) this._hs.push(/** @type {HitSpec} */ ({}));
    this._hsI = 0;
    this._ps = /** @type {ProjectileSpec[]} */ ([{}, {}, {}]);
    this._psI = 0;
    this._tagN = 0;
    this._flash = [0, 0, 0, -1];
    this._highlight = [0, 0, 0, -1];
    this._glowOut = [0, 0, 0, 0];
    this._glow = [0, 0, 0, -1];
    this._deathFx = false;
    this._deathHover = 0;
    // status effects (§29 V5): seconds left (unscaled enemy time), the chill's slow, the hold
    this._chillT = 0;
    this._chillSlow = 0;
    this._freezeT = 0;
    /**
     * An ice shell is drawn over it while it is frozen (the ice mage's Glacial Tomb,
     * src/game/party/IceSpellFx.js: a cut-out crystal quad whose gaps show the body): the frozen tint
     * is then the lighter `SHELL_FLASH` / `SHELL_HL`, so its own colours read through the gaps.
     * False: the full frozen tint (every other freeze).
     */
    this.iceShell = false;
    /** Seconds left of the status hold (a stun or a freeze) in the `stun` state. */
    this._holdT = 0;
    /** In the status hold (`stun` state entered by `freeze` / `stun`, not a brain's own stun). */
    this._holding = false;
    /**
     * A hold asked for between two updates: entered at the next update (which has the context).
     * @type {''|'freeze'|'stun'}
     */
    this._holdAsk = '';
    this._frostT = 0;
    /** A boss: seconds of the current chill so far (≤ BOSS_CHILL_MAX) and of its rest after one. */
    this._chillSpent = 0;
    this._chillRest = 0;
    // The Bells of Evermere (COMBAT.md §30)
    /** Resonance marks on it (0–`MARK_CAP`; core's `addMarks` / `consumeMarks`; read by the kit). */
    this.marks = 0;
    /** Enemy seconds left before its marks fade. */
    this._markT = 0;
    /**
     * Under the ice / water (core's `submerge` / `surface`, §30.5): untargetable, out of every hit
     * loop, guarded; its sprite fades out over 12 f (the Evermere pack's core part owns
     * `sprite.opacity` meanwhile), then is not drawn.
     */
    this.submerged = false;
    /**
     * Released, not killed (core's `release`, §30.7): dead to the fight (`alive` false, its rewards
     * given) while its body stays under its brain — `Brain.dead` returning true holds it, false lets
     * it fade (90 f, no death flash).
     */
    this.released = false;
    /** Seconds a released body has been let go by its brain (its fade). */
    this._goneT = 0;

    sprite.name = `Enemy:${this.uid}`;
    this.position.set(this.home.x, this.position.y, this.home.z);
    this._enterInitial();
    // the look before the first update (title screen: combat inactive): hover, glow
    this._applyHover();
    this._writeGlow();
  }

  // ---------------------------------------------------------------------------------------------
  // §9.3 interface
  // ---------------------------------------------------------------------------------------------

  /** Alive, awake, not walking home and visible: lock-on / auto-aim may pick it. */
  get targetable() {
    return this.alive && !this.dormant && !this.submerged && this.state !== 'return' && this.state !== 'dormant'
      && this.sprite.visible && this.sprite.opacity > 0.001;
  }

  /** Boss only: Broken (poise 0, §8.3) — the 'stagger' state. */
  get broken() { return this.boss && this.state === 'stagger'; }

  /**
   * Chilled (an ice mage's frost, DRAGON_CAMPAIGN.md §6.4, COMBAT.md §29 V5): its whole step — moves,
   * attack timelines, animation — × (1 − `slow`) and a frost tint for `seconds` (the longer time and
   * the stronger slow win). `slow` ≤ 0 takes 0.35; capped at 0.9.
   * @param {number} seconds
   * @param {number} [slow] 0–0.9
   */
  chill(seconds, slow = CHILL_SLOW) {
    let s = statusSeconds(seconds);
    if (!this.alive || s <= 0) return;
    let k = typeof slow === 'number' && slow > 0 ? Math.min(SLOW_MAX, slow) : CHILL_SLOW;
    if (this.boss) {
      // (a boss: a short, light chill, then a rest — see BOSS_SLOW_MAX)
      if (this._chillRest > 0) return;
      k = Math.min(k, BOSS_SLOW_MAX);
      s = Math.min(s, BOSS_CHILL_MAX - this._chillSpent);
      if (s <= 0) return;
    }
    if (this._chillT <= 0) this._frostT = 0;
    this._chillT = Math.max(this._chillT, s);
    this._chillSlow = Math.max(this._chillSlow, k);
  }

  /**
   * Frozen (§6.4, §29 V5): held in place like a stun for `seconds` — its attack cancelled, its brain
   * and timers paused, its animation stopped (core: sprite speed 0), an ice tint; it thaws with a
   * shatter of ice. A boss is only chilled (slow ≤ 0.2, its rules: BOSS_SLOW_MAX); a passive kind (a dummy) only tinted. The
   * hold starts at its next update (it needs the context to free the attack's markers).
   * @param {number} seconds
   */
  freeze(seconds) {
    const s = statusSeconds(seconds);
    if (!this.alive || s <= 0) return;
    if (this.boss) {
      this.chill(s, BOSS_FREEZE_SLOW);
      return;
    }
    if (this._freezeT <= 0) this._holdAsk = 'freeze';
    this._freezeT = Math.max(this._freezeT, s);
    if (!this.passive) this._holdT = Math.max(this._holdT, s);
  }

  /**
   * Stunned by a hit (§29 V5): held in the hurt pose for `seconds` (its attack cancelled; core shows
   * the dizzy stars). Not a boss or a passive kind (their brains keep their own states).
   * @param {number} seconds
   */
  stun(seconds) {
    const s = statusSeconds(seconds);
    if (!this.alive || s <= 0 || this.boss || this.passive) return;
    if (!this._holdAsk) this._holdAsk = 'stun';
    this._holdT = Math.max(this._holdT, s);
  }

  /**
   * One hit landed on many foes at once (an area skill, §29 V6): its hit flash is the soft half only
   * (0.4, not 0.85) — a crowd frozen in a hit-stop does not turn into white blobs.
   */
  softenFlash() {
    if (this.hitFlash > FLASH_STRONG) {
      this.hitFlash = FLASH_STRONG;
      this._writeFlash();
    }
  }

  /**
   * After the player's fall (core's death reset; rv-play #10): calm for `seconds` — no sight aggro,
   * only a touch within melee height — and a swarm's rush is spent (it aggroes like any foe until
   * its group comes back or a reset).
   * @param {number} seconds
   */
  settle(seconds) {
    this._calmT = Math.max(this._calmT, Math.max(0, Number(seconds) || 0));
    this.rushed = true;
  }

  /** A status effect runs (or waits to start): core's per-frame look reads the others only then. */
  get statusOn() { return this._chillT > 0 || this._freezeT > 0 || this._holdT > 0 || this._holdAsk !== '' || this._chillRest > 0; }

  /** Frozen now (its animation stopped). */
  get frozen() { return this._freezeT > 0; }

  /** Held by a status (a stun or a freeze) in the `stun` state. */
  get held() { return this._holding; }

  /** Its time scale from the status effects: 0 frozen, 1 − slow chilled, else 1 (core: sprite speed). */
  get timeScale() { return this._freezeT > 0 ? 0 : this._chillT > 0 ? 1 - this._chillSlow : 1; }

  /**
   * The status effects as the `statusOf` hook reports them (seconds left).
   * (`chillRest`: a boss's rest from the cold — no chill takes until it ends.)
   * @returns {{ chill: number, slow: number, freeze: number, stun: number, held: boolean, timeScale: number, chillRest: number }}
   */
  statusInfo() {
    const r3 = (v) => +Math.max(0, v).toFixed(3);
    return { chill: r3(this._chillT), slow: r3(this._chillT > 0 ? this._chillSlow : 0), freeze: r3(this._freezeT), stun: r3(this._holdT), held: this._holding, timeScale: +this.timeScale.toFixed(3), chillRest: r3(this._chillRest) };
  }

  /** Every status effect off (reset, death, a walk home, vanish). */
  _clearStatus() {
    this._chillT = 0;
    this._chillSlow = 0;
    this._chillSpent = 0;
    this._chillRest = 0;
    this._freezeT = 0;
    this._holdT = 0;
    this._holding = false;
    this._holdAsk = '';
    this._frostT = 0;
  }

  /**
   * One combat sub-step (h in scaled seconds, never 0).
   * @param {number} h
   * @param {CombatContext} ctx (COMBAT.md §9.2)
   */
  update(h, ctx) {
    if (!(h > 0)) return;
    this._clock += h;
    if (!this.alive) {
      this._updateDead(h, ctx);
      return;
    }
    // resonance marks fade 6 s after the last one (§30.4)
    if (this.marks > 0 && (this._markT -= h) <= 0) this.marks = 0;
    // status effects (§29 V5): their timers on the unscaled step; a chill slows the rest of it
    if (this.statusOn) h = this._statusStep(h, ctx);
    this._followGround(h, ctx);
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - h);
    if (this._tokenWait > 0) this._tokenWait -= h;
    if (this._calmT > 0) this._calmT -= h;
    this._poiseT += h;
    // poise refills 120 f after the last hit (the boss's poise is per phase instead, §8.3)
    if (!this.boss && this._poiseT >= F(POISE_REGEN_F) - EPS && this.poise < this.poiseMax && this.state !== 'stagger') this.poise = this.poiseMax;
    this._sense(ctx);
    this._updateHazards(h, ctx);
    if (this.boss) this.brain.update(this, h, ctx);
    else this._step(h, ctx);
    if (this._ghostDir < 0) this._fadeBackIn(h);
    if (this.alive && this._freezeT <= 0) this._knockback(h, ctx);
    this.t += h;
    this._applyHover();
    this._refreshRow();
    this._writeFlash();
    this._writeGlow();
  }

  /**
   * Reactions to a hit after core reduced `hp` (still > 0): aggro, poise / stagger, hitstun,
   * knockback (§7.4). Guarded hits change nothing.
   * @param {HitInfo} info (COMBAT.md §9.5)
   * @param {CombatContext} ctx
   */
  receiveHit(info, ctx) {
    if (!this.alive) return;
    this._writeFlash();
    if (info.guarded || this.guarded || this.state === 'return') return;
    if (this.brain.onHit) this.brain.onHit(this, info, ctx);
    if (this.boss || this.passive) {
      this._writeFlash();
      return;
    }
    if (!this.aggro) this._startNotice(ctx, true, false);
    if (this.state === 'notice' || this.state === 'idle' || this.state === 'dormant') this.setState('engage');
    if (!this.armored) {
      const stunned = this.state === 'stun';
      if (this.poiseMax === 0) {
        if (!stunned) this._interruptTo('hitstun', ctx);
      } else if (Number.isFinite(this.poiseMax)) {
        this.poise -= info.poise || 0;
        this._poiseT = 0;
        if ((this.poise <= 0 || info.knockdown) && this.state !== 'stagger' && !stunned) this._interruptTo('stagger', ctx);
      }
      // (a frozen enemy is held in its ice: no slide)
      if (info.kb > 0 && Number.isFinite(this.mass) && this.mass > 0 && this._freezeT <= 0) {
        const dist = Math.min(KB_CAP, info.kb / this.mass) * (this.flier ? 1.5 : 1);
        const l = Math.hypot(info.kbDirX || 0, info.kbDirZ || 0);
        if (dist > 0 && l > 1e-6) {
          this._kbDist = dist;
          this._kbT = 0;
          this._kbX = info.kbDirX / l;
          this._kbZ = info.kbDirZ / l;
        }
      }
    }
    this._writeFlash();
  }

  /**
   * hp ≤ 0: state 'dead', pose `dead`, dither fade (30 f; the boss 90 f after a 6 f ember flash;
   * bats fall to the ground over 12 f first), then opacity 0. Core already granted XP / loot and
   * owns the death SFX; the enemy fires its kind's death burst (slime `gooPoof` 12 at once, the
   * others `deathPoof` 8 when the fade ends; the boss none — core owns its effects).
   * @param {CombatContext} ctx
   */
  die(ctx) {
    if (!this.alive) return;
    if (this.brain.cancel) this.brain.cancel(this, ctx);
    this.dropToken(ctx);
    this._freeAll(ctx);
    this.alive = false;
    this.marks = 0;
    this._goneT = 0;
    // (a release leaves a submerged body's fade where it is — it is the brain's —; a death shows it)
    if (this.submerged) {
      this.submerged = false;
      this.sprite.visible = true;
      if (!this.released) this.sprite.opacity = 1;
    }
    this.aggro = false;
    this.target = null;
    this.tauntT = 0;
    this._clearStatus();
    this.guarded = false;
    this.armored = false;
    this.exposed = false;
    this.vuln = 1;
    this.hpFloor = 0;
    this._kbDist = 0;
    this._deathFx = false;
    this._deathHover = this.hover;
    this._ghost = 0;
    this._ghostDir = 0;
    this.state = 'dead';
    this.t = 0;
    this._enterN++;
    if (this.brain.die) this.brain.die(this, ctx);
    // (a released body keeps the pose its brain gave it in `die`)
    if (!(this.released && this.brain.die)) this.pose('dead');
    this._writeGlow();
    if (this.kind === 'slime') ctx?.burst('gooPoof', this.position.x, this.position.y + 0.3, this.position.z, 12);
    this._writeFlash();
  }

  /**
   * Fallen without a death (core: a group a campaign remembers as defeated, entered again —
   * KNOWN_ISSUES CMP-03): hp 0, state 'dead', not drawn — no brain call, no burst, no fade (core
   * grants nothing and emits nothing). `reset` brings it back like any fallen foe (a waystone rest).
   * Core frees its token, markers and projectiles first.
   */
  vanish() {
    this._forgetAll();
    this.alive = false;
    this.hp = 0;
    this.marks = 0;
    this.submerged = false;
    this.aggro = false;
    this.target = null;
    this.tauntT = 0;
    this._clearStatus();
    this.dormant = false;
    this.token = false;
    this.guarded = false;
    this.armored = false;
    this.exposed = false;
    this.vuln = 1;
    this.hpFloor = 0;
    this.hitFlash = 0;
    this._kbDist = 0;
    this._ghost = 0;
    this._ghostDir = 0;
    this._deathFx = true;
    this.state = 'dead';
    this.t = 0;
    this._enterN++;
    this.pose('dead');
    this.sprite.opacity = 0;
    this.sprite.visible = false;
    this._writeFlash();
    this._writeGlow();
  }

  /**
   * Back home with full HP and poise, idle (the boss: dormant kneel, phase 1), visible, no flash,
   * no markers (freed through ctx when given), fresh brain state. Does not call releaseToken (core
   * resets the token budgets itself).
   * @param {CombatContext} [ctx]
   */
  reset(ctx) {
    if (ctx) this._freeAll(ctx);
    else this._forgetAll();
    const gy = ctx ? ctx.groundAt(this.home.x, this.home.z) : this.position.y;
    this.position.set(this.home.x, gy, this.home.z);
    this._grounded = !!ctx;
    this.hp = this.hpMax;
    this.poise = this.poiseMax;
    this.alive = true;
    this.aggro = false;
    this.target = null;
    this.tauntT = 0;
    this._clearStatus();
    this.targetHold = 0;
    this.targetCheck = 0;
    this.playerHitAt = -Infinity;
    this.rushed = false;
    this.dormant = false;
    this.guarded = false;
    this.armored = false;
    this.exposed = false;
    this.vuln = 1;
    this.hitFlash = 0;
    this.token = false;
    this.blockedBy = null;
    this.marks = 0;
    this.released = false;
    this._goneT = 0;
    this.submerged = false;
    this.phase = this.boss ? 1 : 0;
    this.hpFloor = 0;
    this.hover = this.def.hover ?? 0;
    this.lift = 0;
    this._poiseT = 0;
    this._tokenWait = 0;
    this._senseT = 0;
    this._farT = 0;
    this._calmT = 0;
    this._kbDist = 0;
    this._deathFx = false;
    this._ghost = 0;
    this._ghostDir = 0;
    this._wander.has = false;
    this._wander.pause = 0;
    this._clearStuck();
    // (the side the next detour tries first, flipped by every detour: back to the first side, or
    // a reset foe's first detour would depend on how many it made before)
    this._detourSide = 1;
    this._clearPath();
    this._zoneT = 0;
    this.sprite.visible = true;
    this.sprite.opacity = 1;
    this.sprite.bodyOpacity = 1;
    this.sprite.tint.setRGB(1, 1, 1);
    this.sprite.mesh.position.x = 0;
    this.facing.x = 0;
    this.facing.z = 1;
    this._enterInitial();
    this._applyHover();
    this._writeFlash();
    this._writeGlow();
  }

  /**
   * Force aggro (the 'notice' beat, then engage). Passive kinds (the dummy) and the boss (its
   * fight starts when the player enters the arena) ignore it. Does not wake others.
   * @param {CombatContext} ctx
   */
  wake(ctx) {
    if (!this.alive || this.passive || this.boss) return;
    this.dormant = false;
    if (this.aggro || this.state === 'return') return;
    this._startNotice(ctx, false, true);
  }

  /** → dormant (core stops updating it), idle animation. A dead enemy finishes its fade at once. */
  sleep() {
    if (!this.alive) {
      this.sprite.opacity = 0;
      return;
    }
    this.dormant = true;
    if (this.boss) return; // keeps its pre-fight kneel (core never sleeps an aggroed boss)
    this.state = 'dormant';
    this.t = 0;
    this._enterN++;
    this.lift = 0;
    this._applyHover();
    this.anim('idle');
  }

  /**
   * Leash broken / sent away by core (boss intro, player death): cancel the attack, free markers,
   * hazards and the token, stop aggro and walk home guarded (§7.4 `return`). Boss and adds ignore it.
   * (Additive to §9.3.)
   * @param {CombatContext} ctx
   */
  sendHome(ctx) {
    if (!this.alive || this.boss || this.isAdd || this.passive) return;
    if (this.brain.cancel) this.brain.cancel(this, ctx);
    this.dropToken(ctx);
    this._freeAll(ctx);
    this.aggro = false;
    this.target = null;
    this.tauntT = 0;
    this._clearStatus();
    this.armored = false;
    this.exposed = false;
    this.vuln = 1;
    this.guarded = true;
    this.marks = 0;
    this._kbDist = 0;
    this._clearStuck();
    this._clearPath();
    this._farT = 0;
    this._zoneT = 0;
    this.setState('return');
  }

  // ---------------------------------------------------------------------------------------------
  // The Bells of Evermere (COMBAT.md §30): marks, the submerged state
  // ---------------------------------------------------------------------------------------------

  /**
   * Add resonance marks (core: a hit's `mark`, the `marks` hook): up to `MARK_CAP`, the 6 s renewed.
   * @param {number} n
   * @returns {number} its marks now
   */
  addMarks(n) {
    if (!this.alive || !(n > 0)) return this.marks;
    this.marks = Math.min(MARK_CAP, this.marks + Math.floor(n));
    this._markT = MARK_DECAY;
    return this.marks;
  }

  /**
   * Show a combat pose: `sheet.poses[name]` in the row of the current facing.
   * @param {string} name
   */
  pose(name) {
    const col = this.sheet.poses[name] ?? this.sheet.poses.idle0 ?? 0;
    const row = Math.max(0, DIRECTIONS.indexOf(this.sprite.direction));
    this._poseName = name;
    if (col === this._poseCol && row === this._poseRow && this.sprite.animation === null) return;
    this._poseCol = col;
    this._poseRow = row;
    this.sprite.setFrame(col, row);
  }

  /**
   * Play a locomotion animation ('idle' | 'walk' | 'run', resolved with the facing).
   * @param {string} name
   */
  anim(name) {
    this._poseName = null;
    this._poseCol = -1;
    this.sprite.play(name);
  }

  /**
   * Face a world point: sets `facing` and the sprite's direction row (Sprite3D.directionFromVector
   * with its hysteresis, relative to the camera yaw); a shown pose switches rows with it.
   * @param {number} x
   * @param {number} z
   */
  face(x, z) {
    this.faceDir(x - this.position.x, z - this.position.z);
  }

  /**
   * Face a direction vector (need not be unit length; zero is ignored).
   * @param {number} dx
   * @param {number} dz
   */
  faceDir(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    this.facing.x = dx / len;
    this.facing.z = dz / len;
    this._refreshRow();
  }

  // ---------------------------------------------------------------------------------------------
  // State helpers (for brains)
  // ---------------------------------------------------------------------------------------------

  /**
   * Enter a state (t = 0; re-entering the same state restarts it, e.g. a follow-up wind-up).
   * @param {EnemyState} s
   */
  setState(s) {
    this.state = s;
    this.t = 0;
    this._enterN++;
    // an attack begins — the approach got there: `seek`'s stuck watch starts afresh (an archer that
    // chases only beyond 10 u and shoots in between summed its short chases into a 4 s "stuck")
    if (s === 'windup') this._clearStuck();
  }

  /**
   * True once `n` frames of the current state have passed.
   * @param {number} n frames
   * @returns {boolean}
   */
  after(n) { return this.t >= n / 60 - EPS; }

  /** Current frame index within the state (0 at entry). */
  get fr() { return Math.floor(this.t * 60 + EPS); }

  /** True only in the sub-step that entered the current state (one-shot cues; sub-steps may be < 1 f). */
  get entered() { return this.t === 0; }

  /** Increments on every state entry (dispatch loops re-run a state entered during a sub-step). */
  get serial() { return this._enterN; }

  /**
   * Boss only: jump straight to phase n (1–3) without the transition — the `bossPhase(n)` test
   * hook; signals `bossPhase` like a real transition. (Additive to §9.3.)
   * @param {number} n
   * @param {CombatContext} ctx
   */
  setPhase(n, ctx) {
    if (this.alive && this.brain.jumpPhase) this.brain.jumpPhase(this, n, ctx);
  }

  /** World Y of the body middle (§7.1 body band; fliers around the live hover). */
  midY() {
    const b = this.def.body;
    return this.position.y + (this.flier ? this.hover : 0) + (b[0] + b[1]) / 2;
  }

  /**
   * The on-screen rule (§7.3): may this (non-boss) enemy start a wind-up now?
   * @param {CombatContext} ctx
   * @returns {boolean}
   */
  canWindup(ctx) {
    return this.boss || ctx.onScreen(this.position.x, this.midY(), this.position.z);
  }

  /**
   * Hold or request this kind's attack token; a refused request retries after 18 f.
   * @param {CombatContext} ctx
   * @returns {boolean} holds a token (or needs none)
   */
  takeToken(ctx) {
    if (this.token) return true;
    if (!this.def.token) return true;
    if (this._tokenWait > 0) return false;
    if (ctx.requestToken(this)) {
      this.token = true;
      return true;
    }
    this._tokenWait = F(TOKEN_RETRY_F);
    return false;
  }

  /**
   * Return the attack token (if held).
   * @param {CombatContext} [ctx]
   */
  dropToken(ctx) {
    if (!this.token) return;
    ctx?.releaseToken(this);
    this.token = false;
  }

  /**
   * A fresh hit tag (one hit per target per tag): a number, `tagBase + n` cycling through this
   * enemy's TAG_SPAN tags — unique among the live tags of every actor, allocation-free.
   * @returns {number}
   */
  newTag() {
    this._tagN = (this._tagN + 1) % TAG_SPAN;
    return this._tagBase + this._tagN;
  }

  /**
   * A pooled HitSpec (§9.5) reset to its defaults, origin at the enemy's feet; fill it and pass it
   * to `ctx.hitbox(e, spec)` in the same sub-step (16 in rotation: core must copy or consume it
   * within the sub-step).
   * @returns {HitSpec}
   */
  hitSpec() {
    const s = this._hs[this._hsI];
    this._hsI = (this._hsI + 1) % this._hs.length;
    s.shape = 'circle';
    s.x = this.position.x;
    s.y = this.position.y;
    s.z = this.position.z;
    s.r = 1;
    s.rInner = 0;
    s.dirX = this.facing.x;
    s.dirZ = this.facing.z;
    s.halfAngle = 60;
    s.len = 1;
    s.width = 1;
    s.dy = 0.6;
    s.mv = 1;
    s.kb = 0;
    s.poise = 0;
    s.knockdown = false;
    s.flat = 0;
    s.thin = false;
    s.tag = 0;
    s.fromX = undefined;
    s.fromZ = undefined;
    // (status effects and feel are the player side's: an enemy's hit carries none)
    s.chill = 0;
    s.slow = 0;
    s.freeze = 0;
    s.stun = 0;
    s.feel = null;
    return s;
  }

  /**
   * A pooled ProjectileSpec (§9.5) reset to its defaults (3 in rotation).
   * @returns {ProjectileSpec}
   */
  projSpec() {
    const s = this._ps[this._psI];
    this._psI = (this._psI + 1) % this._ps.length;
    s.kind = 'arrow';
    s.x = this.position.x;
    s.y = this.position.y + 0.9;
    s.z = this.position.z;
    s.dirX = this.facing.x;
    s.dirZ = this.facing.z;
    s.vy = 0;
    s.speed = 10;
    s.range = 10;
    s.radius = 0.2;
    s.mv = 1;
    s.kb = 0;
    s.poise = 0;
    s.pierce = false;
    s.splash = null;
    s.arc = null;
    return s;
  }

  // ----- markers owned by the current attack (slots 0–3; freed on every interrupt) -----

  /**
   * Show / update the attack's marker in slot `i` (allocates on first use; y = 0.03 draped).
   * @param {number} i slot 0..3
   * @param {CombatContext} ctx
   * @param {Partial<MarkerSpec>} spec (shape, x, z, r, … progress, style)
   * @returns {number} handle or −1
   */
  mark(i, ctx, spec) {
    let h = this._slots[i];
    if (h < 0) {
      h = ctx.marker(spec);
      this._slots[i] = h;
    } else {
      ctx.setMarker(h, spec);
    }
    return h;
  }

  /**
   * Update only the fill of slot `i`.
   * @param {number} i
   * @param {CombatContext} ctx
   * @param {number} progress
   */
  markProgress(i, ctx, progress) {
    const h = this._slots[i];
    if (h < 0) return;
    this._slotSpec.progress = progress;
    ctx.setMarker(h, this._slotSpec);
  }

  /**
   * Free slot `i`.
   * @param {number} i
   * @param {CombatContext} ctx
   */
  unmark(i, ctx) {
    const h = this._slots[i];
    if (h >= 0) ctx.freeMarker(h);
    this._slots[i] = -1;
  }

  /**
   * Free every slot.
   * @param {CombatContext} ctx
   */
  unmarkAll(ctx) {
    for (let i = 0; i < this._slots.length; i++) this.unmark(i, ctx);
  }

  /**
   * Hand slot `i` over to a hazard that fades it out over `dur` seconds (arrow lanes after release).
   * @param {number} i
   * @param {CombatContext} ctx
   * @param {number} dur
   */
  markToFade(i, ctx, dur) {
    const h = this._slots[i];
    this._slots[i] = -1;
    if (h < 0) return;
    const z = this._newHazard('fade');
    z.h = h;
    z.dur = Math.max(F(1), dur);
  }

  /**
   * The lane-lock rim flash of a tracking lane (§7.3, MarkerSpec `flash`): 0 while it tracks,
   * white (1) for the first 5 f after it locks, then a faint 0.35 until it resolves.
   * @param {number} sinceLock seconds since the lane locked (negative while tracking)
   * @returns {number}
   */
  lockFlash(sinceLock) {
    if (sinceLock < -EPS) return 0;
    return sinceLock < F(5) - EPS ? 1 : 0.35;
  }

  /**
   * The shared MarkerSpec object, reset: fill it and pass it to `mark` (ctx copies it).
   * @param {MarkerShape} shape
   * @param {number} x
   * @param {number} z
   * @returns {MarkerSpec}
   */
  markerSpec(shape, x, z) {
    const m = this._ms;
    m.shape = shape;
    m.x = x;
    m.y = 0.03;
    m.z = z;
    m.r = 1;
    m.rInner = 0;
    m.dirX = this.facing.x;
    m.dirZ = this.facing.z;
    m.halfAngle = 60;
    m.len = 1;
    m.width = 1;
    m.w = 1;
    m.d = 1;
    m.progress = 0;
    m.style = 'enemy';
    m.alpha = 1;
    m.flash = 0;
    return m;
  }

  // ----- hazards: delayed effects that outlive the attack (freed on death / return / reset) -----

  /**
   * A delayed circle (§7.3): after `delay` s it appears (at x, z — or, with `track`, at the
   * player's position + (x, z) then, clamped by `clamp` {minX,maxX,minZ,maxZ}), fills over `dur`
   * s and resolves a circle hit at progress 1 (rim white 5 f), then frees its marker.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} dur
   * @param {number} [delay]
   * @param {boolean} [track]
   * @param {RectXZ|null} [clamp]
   * @returns {EnemyHazard} the hazard (set mv, kb, knockdown, burst, burstN, sfx, visualOnly on it)
   */
  hazardCircle(x, z, r, dur, delay = 0, track = false, clamp = null) {
    const hz = this._newHazard('circle');
    hz.x = x;
    hz.z = z;
    hz.r = r;
    hz.dur = dur;
    hz.delay = delay;
    hz.track = track;
    hz.clamp = clamp;
    hz.tag = this.newTag();
    return hz;
  }

  /**
   * A telegraph-only circle (Rock Toss landing: the boulder projectile resolves the hit).
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} dur
   * @returns {EnemyHazard}
   */
  hazardVisual(x, z, r, dur) {
    const hz = this.hazardCircle(x, z, r, dur);
    hz.visualOnly = true;
    return hz;
  }

  /**
   * An expanding ring wave (Shockwave Slam, phase-2 push): after `delay` s, radius grows from
   * `r0` at `speed` u/s to `rMax`, `width` wide; hits once per ring (tag), `thin` tests the
   * target centre (§9.5).
   * @param {number} x
   * @param {number} z
   * @param {number} r0
   * @param {number} rMax
   * @param {number} speed
   * @param {number} width
   * @param {number} [delay]
   * @returns {EnemyHazard}
   */
  hazardRing(x, z, r0, rMax, speed, width, delay = 0) {
    const hz = this._newHazard('ring');
    hz.x = x;
    hz.z = z;
    hz.r = r0;
    hz.r0 = r0;
    hz.rMax = rMax;
    hz.speed = speed;
    hz.width = width;
    hz.delay = delay;
    hz.thin = true;
    hz.tag = this.newTag();
    return hz;
  }

  /**
   * A magma pool: `magma` marker r for `dur` s; flat damage `flat` every `tick` s while inside.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} dur
   * @param {number} flat
   * @param {number} tick
   * @returns {EnemyHazard}
   */
  hazardMagma(x, z, r, dur, flat, tick) {
    const hz = this._newHazard('magma');
    hz.x = x;
    hz.z = z;
    hz.r = r;
    hz.dur = dur;
    hz.flat = flat;
    hz.tick = tick;
    hz.n = 0;
    hz.tag = this.newTag();
    return hz;
  }

  /** Live hazards (for tests). */
  get hazardCount() {
    let n = 0;
    for (const hz of this._hazards) if (hz.on) n++;
    return n;
  }

  /**
   * Snapshots of the live hazards (tests; allocates): `{ type, x, z, r, rInner, delay, t, dur, mv,
   * kb }` — `r` is a ring's current radius. (Additive to §9.3.)
   * @param {string} [type] only this type ('circle' | 'ring' | 'magma' | 'fade')
   * @returns {HazardSnapshot[]}
   */
  hazardList(type) {
    const out = [];
    for (const hz of this._hazards) {
      if (!hz.on || (type && hz.type !== type)) continue;
      const ring = hz.type === 'ring';
      const r = ring ? hz.r0 + hz.speed * hz.t : hz.r;
      out.push({
        type: hz.type, x: hz.x, z: hz.z, r, rInner: ring ? Math.max(0, r - hz.width) : 0,
        delay: hz.delay, t: hz.t, dur: hz.dur, mv: hz.mv, kb: hz.kb,
      });
    }
    return out;
  }

  // ----- movement -----

  /**
   * Raw displacement through the context (moveGround, or moveFly for fliers); the boss is also
   * kept inside its arena rect. Returns the fraction of the requested distance achieved.
   * @param {number} dx
   * @param {number} dz
   * @param {CombatContext} ctx
   * @returns {number}
   */
  move(dx, dz, ctx) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return 1;
    const p = this.position;
    if (this.flier) {
      const x0 = p.x;
      const z0 = p.z;
      ctx.moveFly(this, dx, dz);
      return Math.min(1, Math.hypot(p.x - x0, p.z - z0) / len);
    }
    let fr = ctx.moveGround(this, dx, dz);
    if (this.boss && this.arena) fr = this._keepInArena(len, fr);
    return fr;
  }

  /**
   * Walk along a unit direction at `speed` for h: locomotion animation (null: keep the current
   * pose) and facing (unless `faceMove` is false). No stuck bookkeeping (strafes and retreats
   * handle a blocked step themselves; `seek` / `chase` count it).
   * @param {number} dirX
   * @param {number} dirZ
   * @param {number} speed
   * @param {number} h
   * @param {CombatContext} ctx
   * @param {string|null} [animName] null: keep the current pose
   * @param {boolean} [faceMove]
   * @returns {number} fraction moved
   */
  walk(dirX, dirZ, speed, h, ctx, animName = 'walk', faceMove = true) {
    const step = speed * h;
    if (step <= 0) return 1;
    const fr = this.move(dirX * step, dirZ * step, ctx);
    if (faceMove) this.faceDir(dirX, dirZ);
    if (animName) this.anim(animName);
    return fr;
  }

  /**
   * Walk toward a point (stops on it). After 30 f of < 25 % progress takes the best of 5 probe
   * directions (±45°, ±90°, back; `ctx.walkable`) for 24 f; `stuck` turns true after 90 f or when
   * the enemy has not got 1 u away from where it was 4 s ago while its quarry (the player when
   * aggroed, else the point) stayed within 1.5 u of where it was then (`_anchor`).
   * @param {number} tx
   * @param {number} tz
   * @param {number} speed
   * @param {number} h
   * @param {CombatContext} ctx
   * @param {string|null} [animName]
   * @returns {number} fraction moved
   */
  seek(tx, tz, speed, h, ctx, animName = 'walk') {
    const p = this.position;
    let dx = tx - p.x;
    let dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      this._stuckT = 0;
      return 1;
    }
    dx /= d;
    dz /= d;
    const Q = this.aggro ? ctx.player?.position : null;
    this._anchor(h, d, Q ? Q.x : tx, Q ? Q.z : tz);
    if (this._detourT > 0) {
      this._detourT -= h;
      const fr = this.walk(this._detourX, this._detourZ, speed, h, ctx, animName);
      if (fr < 0.25) this._stuckT += h;
      else if (this._detourT <= 0) this._stuckT = 0;
      return fr;
    }
    if (!this.flier && this._stuckT >= F(STUCK_F) - EPS) {
      this._pickDetour(dx, dz, ctx);
      return this.seek(tx, tz, speed, h, ctx, animName);
    }
    const v = Math.min(speed, d / h);
    const fr = this.walk(dx, dz, v, h, ctx, animName);
    if (fr < 0.25) this._stuckT += h;
    else this._stuckT = 0;
    return fr;
  }

  /**
   * Approach the player: straight while it is on the same level and the way is clear, else along
   * a path of the walk grid (stairs, ledges, around obstacles), with the detours of `seek`.
   * @param {number} speed
   * @param {number} h
   * @param {CombatContext} ctx
   * @param {string|null} [animName]
   * @returns {number} fraction moved
   */
  chase(speed, h, ctx, animName = 'walk') {
    const c = this.chasePoint(ctx);
    return this.seek(c.x, c.z, speed, h, ctx, animName);
  }

  /**
   * Where `chase` goes now: the player while the straight way is clear (about the same level, the
   * walk grid open all the way and the walk not stuck), else the next waypoint of a path to the
   * player (`ctx.nav`; searched again when the player moved away from its goal, when it is old or
   * the walk is stuck). No path within the chase's reach sets `unreachable` (the engage state gives
   * up). Fliers and a context without `nav` go straight. Returns the reused `this.cp` {x, z}.
   * @param {CombatContext} ctx
   * @returns {PointXZ}
   */
  chasePoint(ctx) {
    const P = ctx.player.position;
    const c = this.cp;
    c.x = P.x;
    c.z = P.z;
    const nav = ctx.nav;
    if (this.flier || !nav) return c;
    const p = this.position;
    const f = ctx.frame;
    const stuck = this._stuckT >= F(STUCK_F) - EPS;
    if (f >= this._navNext || f < this._navNext - NAV_EVERY || stuck) {
      this._navNext = f + NAV_EVERY;
      this._navDirect = !stuck && Math.abs(this.tp.dy) <= 0.3 && nav.lineClear(p.x, p.z, P.x, P.z, 0.3);
      if (this._navDirect) {
        this.unreachable = false;
        if (this._pathFor === PATH_CHASE) this._clearPath();
      }
    }
    if (this._navDirect) return c;
    let age = f - this._pathAt;
    if (age < 0) age = Infinity;
    const plan = this._pathFor !== PATH_CHASE
      || (age >= REPLAN_MIN_F && (age >= REPLAN_F || stuck || this._pathBad || Math.hypot(P.x - this._pathGX, P.z - this._pathGZ) > REPLAN_D));
    if (plan && nav.spend()) {
      const n = nav.findPath(p.x, p.z, P.x, P.z, this._reach(CHASE_COST), this._path);
      this._pathFor = PATH_CHASE;
      this._pathAt = f;
      this._pathGX = P.x;
      this._pathGZ = P.z;
      this._pathI = 0;
      this._pathN = Math.max(0, n);
      this._pathBad = false;
      this._pathCut = -1;
      this._pathExact = -1;
      this.unreachable = n < 0;
    }
    if (this._pathFor === PATH_CHASE && this._pathN > 0) {
      const k = this._followPath(ctx) * 2;
      c.x = this._path[k];
      c.z = this._path[k + 1];
    }
    return c;
  }

  /** True when the enemy has given up reaching its target (see `seek`). */
  get stuck() { return this._stuckT >= F(GIVEUP_F) - EPS; }

  /** The player's ground is within the melee height rule of this enemy's (|dy| ≤ MELEE_DY, §6.3). */
  get inReach() { return Math.abs(this.tp.dy) <= MELEE_DY; }

  /**
   * Can a melee attack reach the player from here? `inReach`, and on the walk grid a straight
   * walkable way to it (re-tested every 6 f): a player on a ledge edge 1 u up, or across a stair's
   * side from the enemy, is out of reach. The melee brains (goblin, slime, boar) wind up only then;
   * otherwise they chase along the walk grid instead of swinging at the cliff (COMBAT-06).
   * @param {CombatContext} ctx
   * @returns {boolean}
   */
  canMelee(ctx) {
    if (!this.inReach) return false;
    const nav = ctx.nav;
    if (this.flier || !nav) return true;
    const f = ctx.frame;
    if (f >= this._meleeNext || f < this._meleeNext - NAV_EVERY) {
      this._meleeNext = f + NAV_EVERY;
      const P = ctx.player.position;
      this._meleeWay = nav.lineClear(this.position.x, this.position.z, P.x, P.z, 0.3);
    }
    return this._meleeWay;
  }

  /**
   * Frozen AI (the `freezeAI` test hook): only the hit flash decays; the enemy writes its own
   * `uFlash` (core never calls `sprite.setFlash`). (Additive to §9.3.)
   * @param {number} h
   */
  decayFlash(h) {
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - h);
    this._writeFlash();
  }

  /** Forget `seek`'s stuck bookkeeping and any detour (a new target, a pause). (Additive to §9.3.) */
  resetSeek() { this._clearStuck(); }

  /** End a running `seek` detour but keep the stuck counter (a slime's hop ended). (Additive to §9.3.) */
  endDetour() { this._detourT = 0; }

  /**
   * Free run along a unit direction (§7.7 boar charge, §8.2 boss charge): sampled every 0.25 u
   * with the move radius; stops at the first unwalkable sample (terrain, water, static collider),
   * a height step > 0.55, `maxLen`, or outside `rect` (the boss: its arena inset 1).
   * @param {number} dirX
   * @param {number} dirZ
   * @param {number} maxLen
   * @param {CombatContext} ctx
   * @param {RectXZ|null} [rect]
   * @returns {number} length; `this.runEnd` = 'obstacle' | 'rect' | 'max'
   */
  freeRun(dirX, dirZ, maxLen, ctx, rect = null) {
    const p = this.position;
    const r = this.def.moveRadius;
    const px = -dirZ;
    const pz = dirX;
    let prevH = ctx.groundAt(p.x, p.z);
    let len = 0;
    this.runEnd = 'max';
    for (let s = 0.25; s <= maxLen + EPS; s += 0.25) {
      const x = p.x + dirX * s;
      const z = p.z + dirZ * s;
      if (rect && (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ)) {
        this.runEnd = 'rect';
        break;
      }
      const gh = ctx.groundAt(x, z);
      if (Math.abs(gh - prevH) > 0.55
        || !ctx.walkable(x, z)
        || !ctx.walkable(x + dirX * r, z + dirZ * r)
        || !ctx.walkable(x + px * r, z + pz * r)
        || !ctx.walkable(x - px * r, z - pz * r)) {
        this.runEnd = 'obstacle';
        break;
      }
      prevH = gh;
      len = s;
    }
    return len;
  }

  /**
   * Best walkable direction of 8 away from a point (archer / shaman retreat, blink), scored by the
   * distance gained; probes at `probe` u (and half of it) must be walkable within one step. With
   * `body` (a walked retreat) the way must also be clear for the body on the walk grid
   * (`ctx.nav.lineClear`): a probe point past a cliff's edge or a wall corner is walkable, but a
   * body walking there is stopped at once — a cornered archer walked into the wall for good.
   * (Additive to §9.3.)
   * @param {number} fromX
   * @param {number} fromZ
   * @param {number} probe
   * @param {CombatContext} ctx
   * @param {boolean} [body]
   * @returns {boolean} found; the direction is in `this.away` {x, z}
   */
  bestAway(fromX, fromZ, probe, ctx, body = false) {
    const nav = body && !this.flier ? ctx.nav : null;
    const p = this.position;
    const h0 = ctx.groundAt(p.x, p.z);
    let best = -Infinity;
    const out = this.away;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const x1 = p.x + dx * probe * 0.5;
      const z1 = p.z + dz * probe * 0.5;
      const x2 = p.x + dx * probe;
      const z2 = p.z + dz * probe;
      if (!ctx.walkable(x1, z1) || !ctx.walkable(x2, z2)) continue;
      const h1 = ctx.groundAt(x1, z1);
      const h2 = ctx.groundAt(x2, z2);
      if (Math.abs(h1 - h0) > 0.55 || Math.abs(h2 - h1) > 0.55) continue;
      if (nav && !nav.lineClear(p.x, p.z, x2, z2, 0, true)) continue;
      const gain = Math.hypot(x2 - fromX, z2 - fromZ);
      if (gain > best + 1e-6) {
        best = gain;
        out.x = dx;
        out.z = dz;
      }
    }
    return best > -Infinity;
  }

  // ---------------------------------------------------------------------------------------------
  // internals: state machine
  // ---------------------------------------------------------------------------------------------

  _enterInitial() {
    this.ai = this.brain.init ? this.brain.init(this) : {};
    this.t = 0;
    this._enterN++;
    if (this.boss) {
      this.state = 'dormant';
      this.guarded = true;
      this.pose('kneel');
    } else {
      this.state = 'idle';
      this.anim('idle');
    }
  }

  /**
   * Non-boss dispatch (a state entered in this sub-step runs its frame 0 at once).
   * @param {number} h
   * @param {CombatContext} ctx
   */
  _step(h, ctx) {
    for (let n = 0; n < 4; n++) {
      const k = this._enterN;
      switch (this.state) {
        case 'dormant':
          if (!this.dormant) this.setState('idle');
          break;
        case 'idle':
          this._idle(h, ctx);
          break;
        case 'notice':
          this._notice(ctx);
          break;
        case 'engage':
          this._engage(h, ctx);
          break;
        case 'windup':
        case 'active':
        case 'recover':
          this.brain.attack(this, h, ctx);
          break;
        case 'hitstun':
          this.pose('hurt');
          if (this.after(HITSTUN_F)) this.setState('engage');
          break;
        case 'stagger':
          this.pose('hurt');
          if (this.after(this.kind === 'boar' ? STAGGER_BOAR_F : STAGGER_F)) {
            this.poise = this.poiseMax;
            this.setState('engage');
          }
          break;
        case 'stun':
          // a status hold (§29 V5): no brain, until its time is up (the frozen keep their pose)
          if (this._holding) {
            if (this._freezeT <= 0) this.pose('hurt');
            if (this._holdT <= 0) {
              this._holding = false;
              this.setState(this.aggro ? 'engage' : 'idle');
            }
          } else if (this.brain.stun) this.brain.stun(this, h, ctx);
          else if (this.after(STUN_F)) this.setState('engage');
          break;
        case 'return':
          this._return(h, ctx);
          break;
        default:
          break;
      }
      if (this._enterN === k) break;
    }
  }

  /**
   * The status effects' timers (unscaled `h`), a hold asked for since the last update, the frost
   * motes, the thaw. Returns the step the rest of the update runs on: × (1 − slow) while chilled.
   * @param {number} h
   * @param {CombatContext} ctx
   * @returns {number}
   */
  _statusStep(h, ctx) {
    if (this._holdAsk) this._enterHold(ctx);
    const p = this.position;
    if (this._chillRest > 0) this._chillRest = Math.max(0, this._chillRest - h);
    if (this._chillT > 0) {
      this._chillT -= h;
      if (this.boss) this._chillSpent += h;
      if (this._chillT <= 0) {
        this._chillT = 0;
        this._chillSlow = 0;
        // (a boss rests from the cold before the next chill)
        if (this.boss) {
          this._chillSpent = 0;
          this._chillRest = BOSS_CHILL_REST;
        }
      } else if (this._freezeT <= 0) {
        this._frostT -= h;
        if (this._frostT <= 0) {
          this._frostT += FROST_EVERY;
          ctx.burst('healGlow', p.x, this.midY() - 0.2, p.z, 2, FROST_MOTES);
        }
      }
    }
    if (this._freezeT > 0) {
      this._freezeT -= h;
      // glints on the ice
      this._frostT -= h;
      if (this._frostT <= 0 && this._freezeT > 0) {
        this._frostT += GLINT_EVERY;
        ctx.burst('victorySparkle', p.x, this.midY(), p.z, 1, ICE_TWINKLE);
      }
      if (this._freezeT <= 0) {
        this._freezeT = 0;
        // the ice shatters
        const y = this.midY();
        ctx.burst('splash', p.x, y, p.z, 12, ICE_CHIPS);
        ctx.burst('hitSpark', p.x, y, p.z, 8, ICE_STREAK);
        ctx.sfx('guard', p.x, p.z, { volume: 0.55, pitch: 1.35 });
      }
    }
    if (this._holdT > 0) this._holdT = Math.max(0, this._holdT - h);
    return this._chillT > 0 && this._freezeT <= 0 ? h * (1 - this._chillSlow) : h;
  }

  /**
   * Enter the status hold asked for (`freeze` / `stun`): the attack cancelled (markers, token, the
   * brain's attack state), the `stun` state; frozen: no slide, ice glints; stunned: the hurt pose.
   * A passive kind is only tinted.
   * @param {CombatContext} ctx
   */
  _enterHold(ctx) {
    const kind = this._holdAsk;
    this._holdAsk = '';
    const p = this.position;
    if (kind === 'freeze') {
      const y = this.midY();
      ctx.burst('magicBurst', p.x, y, p.z, 10, ICE_GLINT);
      ctx.sfx('guard', p.x, p.z, { volume: 0.5, pitch: 1.6 });
    }
    if (this.passive || this.boss || this._holdT <= 0 || this.state === 'return') return;
    if (kind === 'freeze') this._kbDist = 0;
    // (held already: the hold was only lengthened)
    if (this._holding && this.state === 'stun') return;
    if (this.brain.cancel) this.brain.cancel(this, ctx);
    this.unmarkAll(ctx);
    this.dropToken(ctx);
    this.armored = false;
    this.lift = 0;
    this._holding = true;
    this.setState('stun');
    if (this._freezeT <= 0) this.pose('hurt');
  }

  /** @param {number} h @param {CombatContext} ctx */
  _idle(h, ctx) {
    // the calm of a give-up lasts while the player stays close above or below it, out of reach
    if (this._calmT > 0 && this.tp.d < 3.5 && !this.inReach) this._calmT = Math.max(this._calmT, F(SENSE_F) + h);
    // (the ambient step: a story scene holds the player — no aggro check, §29 V2)
    if (!this.passive && !ctx.ambient && this._senseTick(h) && this._shouldAggro(ctx)) {
      this._startNotice(ctx, true, true);
      return;
    }
    if (this.brain.idle) this.brain.idle(this, h, ctx);
    else this.wander(h, ctx);
  }

  /** @param {CombatContext} ctx */
  _notice(ctx) {
    const P = ctx.player.position;
    this.face(P.x, P.z);
    if (this.entered && !this.brain.idle) this.anim('idle');
    if (this.after(NOTICE_F)) this.setState('engage');
  }

  /** @param {number} h @param {CombatContext} ctx */
  _engage(h, ctx) {
    if (!ctx.player.alive) {
      if (this.isAdd) this.anim('idle');
      else this.sendHome(ctx);
      return;
    }
    // the player fights a boss inside its closed arena: nobody from outside joins in
    if (ctx.player.sealed && !this.isAdd) {
      this._calmT = CALM_S;
      this.sendHome(ctx);
      return;
    }
    if (this._leashBroken(h, ctx)) {
      this.sendHome(ctx);
      return;
    }
    this.brain.engage(this, h, ctx);
    if (this.state === 'engage' && (this.stuck || this.unreachable) && !this.isAdd) {
      // a swarm never gives up (§29 V4): it waits and tries again — its next path search, a detour
      if (this.swarm) {
        if (this.stuck) this._clearStuck();
        return;
      }
      this._calmT = CALM_S;
      this.sendHome(ctx);
    }
  }

  /** @param {number} h @param {CombatContext} ctx */
  _return(h, ctx) {
    this.guarded = true;
    this.hp = Math.min(this.hpMax, this.hp + 0.2 * this.hpMax * h);
    const p = this.position;
    const d = Math.hypot(this.home.x - p.x, this.home.z - p.z);
    if (d < HOME_EPS) {
      this.hp = this.hpMax;
      this.poise = this.poiseMax;
      this.guarded = false;
      this._clearStuck();
      this._clearPath();
      this._wander.has = false;
      this._wander.pause = F(60);
      this.setState('idle');
      this.anim('idle');
      return;
    }
    if (this._ghostDir > 0) {
      // a snap in view: fade out where it stands, then appear at home and fade back in
      this.anim('idle');
      this._ghost = Math.min(1, this._ghost + h / F(SNAP_FADE_F));
      this.sprite.opacity = 1 - this._ghost;
      if (this._ghost >= 1) this._snapHome(ctx);
      return;
    }
    // home along a path of the walk grid (up the stairs it came down); straight for fliers
    let tx = this.home.x;
    let tz = this.home.z;
    const nav = ctx.nav;
    const pathed = !!nav && !this.flier;
    if (pathed) {
      const f = ctx.frame;
      let age = f - this._pathAt;
      if (age < 0) age = Infinity;
      // (again when stuck, off its way, or at the end of a path that was too long to hold in full)
      const plan = this._pathFor !== PATH_HOME || (age >= REPLAN_F && this._stuckT >= F(STUCK_F) - EPS)
        || (age >= REPLAN_MIN_F && (this._pathBad || this._pathEnded(this.home.x, this.home.z)));
      if (plan && nav.spend()) {
        const n = nav.findPath(p.x, p.z, this.home.x, this.home.z, this._reach(HOME_COST), this._path);
        this._pathFor = PATH_HOME;
        this._pathAt = f;
        this._pathI = 0;
        this._pathN = Math.max(0, n);
        this._pathBad = false;
        this._pathCut = -1;
        this._pathExact = -1;
        this._homeLost = n < 0;
      }
      if (this._pathFor === PATH_HOME && this._pathN > 0) {
        const k = this._followPath(ctx) * 2;
        tx = this._path[k];
        tz = this._path[k + 1];
      }
    }
    this.seek(tx, tz, this.def.speed * 1.5, h, ctx, 'run');
    if (this.flier) this.hover += ((this.def.hover ?? 0) - this.hover) * damp(6, h);
    const blocked = pathed && !this._homeLost ? this.stuck : this._stuckT >= F(STUCK_F);
    if (this.t >= F(RETURN_SNAP_F) && (blocked || this.t >= 30)) {
      // the last resort (no path home, or a walk blocked this long): snap home — through a short
      // fade while it is on screen, so it never visibly teleports
      if (ctx.onScreen(p.x, this.midY(), p.z) || ctx.onScreen(this.home.x, ctx.groundAt(this.home.x, this.home.z) + 1, this.home.z)) {
        this._ghostDir = 1;
      } else this._snapHome(ctx);
    }
  }

  /**
   * Put a returning enemy at home (the blocked-return snap).
   * @param {CombatContext} ctx
   */
  _snapHome(ctx) {
    this.position.set(this.home.x, ctx.groundAt(this.home.x, this.home.z), this.home.z);
    this._grounded = true;
    this._clearStuck();
    this._clearPath();
    if (this._ghostDir > 0) this._ghostDir = -1;
  }

  /**
   * After a faded snap: back to full opacity over the same time.
   * @param {number} h
   */
  _fadeBackIn(h) {
    this._ghost = Math.max(0, this._ghost - h / F(SNAP_FADE_F));
    this.sprite.opacity = 1 - this._ghost;
    if (this._ghost <= 0) this._ghostDir = 0;
  }

  /**
   * Default idle: seeded wander inside the home radius (walks at 40 % speed, pauses 1.5–4 s).
   * Brains may call it from their own idle.
   * @param {number} h
   * @param {CombatContext} ctx
   * @param {number} [speedMul]
   */
  wander(h, ctx, speedMul = 0.4) {
    const w = this._wander;
    if (this.def.speed <= 0) {
      this.anim('idle');
      return;
    }
    if (w.pause > 0) {
      w.pause -= h;
      this.anim('idle');
      return;
    }
    if (!w.has) {
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * this.homeRadius;
      w.x = this.home.x + Math.cos(a) * r;
      w.z = this.home.z + Math.sin(a) * r;
      w.has = true;
      this._clearStuck();
    }
    const p = this.position;
    const fr = this.seek(w.x, w.z, this.def.speed * speedMul, h, ctx, 'walk');
    if (Math.hypot(w.x - p.x, w.z - p.z) < 0.25 || (fr < 0.25 && this._stuckT >= F(20)) || this.stuck) {
      w.has = false;
      w.pause = F(this.rng.int(90, 240));
      this._clearStuck();
    }
  }

  /**
   * @param {CombatContext} ctx
   * @param {boolean} spread wake the group (`ctx.wakeGroup`)
   * @param {boolean} notice enter the notice beat
   */
  _startNotice(ctx, spread, notice) {
    this.aggro = true;
    this.dormant = false;
    this._farT = 0;
    this._zoneT = 0;
    this._clearStuck();
    this._clearPath();
    this.lift = 0;
    // (held by a status, §29 V5: it notices, and fights when the hold ends)
    if (notice && !this._holding) this.setState('notice');
    ctx.alert(this);
    ctx.sfx('enemyAlert', this.position.x, this.position.z);
    if (spread) ctx.wakeGroup(this);
  }

  /** @param {number} h @returns {boolean} */
  _senseTick(h) {
    this._senseT += h;
    if (this._senseT < F(SENSE_F) - EPS) return false;
    this._senseT = 0;
    return true;
  }

  /**
   * Aggro trigger (§7.4): < aggro with LOS and |dy| < 1.5, or < 3 u (|dy| < 1.5). Sight aggro also
   * needs the player inside the enemy's zone grown by 3 u (COMBAT-19: a fight in one region does
   * not pull in the pack of the next).
   * @param {CombatContext} ctx
   * @returns {boolean}
   */
  _shouldAggro(ctx) {
    const P = ctx.player;
    if (!P.alive || (P.sealed && !this.isAdd)) return false;
    // a swarm aggroes at any distance (§29 V4) — after a give-up's calm; once its rush is spent (the
    // player fell: `settle`) like any foe
    if (this.swarm && !this.rushed) return this._calmT <= 0;
    const tp = this.tp;
    if (Math.abs(tp.dy) >= 1.5) return false;
    // (calm after giving up: touch aggro only once the player is back within melee height — a player
    // on an unreachable ledge above its home no longer loops notice → give up → return, ~1.25 s)
    if (tp.d < 3 && (this._calmT <= 0 || this.inReach)) return true;
    if (this._calmT > 0 || tp.d >= this.def.aggro) return false;
    if (outsideZone(this.zoneRect, P.position.x, P.position.z)) return false;
    return ctx.los(this.position.x, this.position.z, P.position.x, P.position.z);
  }

  /**
   * Leash (§7.4): |position − home| > leash + radius, or the player far from home for 3 s; by zone
   * (COMBAT-19): the enemy outside its zone grown by 3 u, or the player outside it for 1 s.
   * @param {number} h
   * @param {CombatContext} ctx
   * @returns {boolean}
   */
  _leashBroken(h, ctx) {
    // (a swarm has no leash and no zone, §29 V4)
    if (this.isAdd || this.boss || this.passive || this.swarm) return false;
    const p = this.position;
    const slack = this.def.leash + this.homeRadius;
    if (Math.hypot(p.x - this.home.x, p.z - this.home.z) > slack) return true;
    const zr = this.zoneRect;
    if (outsideZone(zr, p.x, p.z)) return true;
    const P = ctx.player.position;
    if (Math.hypot(P.x - this.home.x, P.z - this.home.z) > slack + 6) this._farT += h;
    else this._farT = 0;
    if (outsideZone(zr, P.x, P.z)) this._zoneT += h;
    else this._zoneT = 0;
    return this._farT >= 3 - EPS || this._zoneT >= ZONE_LEAVE_S - EPS;
  }

  /**
   * Cancel the current attack into an interrupt state; releases the token, frees attack markers.
   * @param {EnemyState} state
   * @param {CombatContext} ctx
   */
  _interruptTo(state, ctx) {
    if (this.brain.cancel) this.brain.cancel(this, ctx);
    this.unmarkAll(ctx);
    this.dropToken(ctx);
    this.armored = false;
    this.lift = 0;
    this.setState(state);
    this.pose('hurt');
  }

  /** @param {CombatContext} ctx */
  _sense(ctx) {
    const P = ctx.player.position;
    const p = this.position;
    const dx = P.x - p.x;
    const dz = P.z - p.z;
    const d = Math.hypot(dx, dz);
    const tp = this.tp;
    tp.d = d;
    if (d > 1e-6) {
      tp.dx = dx / d;
      tp.dz = dz / d;
    }
    tp.dy = P.y - p.y;
  }

  /** @param {number} h @param {CombatContext} ctx */
  _followGround(h, ctx) {
    const p = this.position;
    const gy = ctx.groundAt(p.x, p.z);
    if (!this._grounded) {
      p.y = gy;
      this._grounded = true;
    } else {
      p.y += (gy - p.y) * damp(18, h);
    }
  }

  /**
   * Knockback slide: kb/mass (≤ 3 u) over 11 f, ease-out, through moveGround (§7.4).
   * @param {number} h
   * @param {CombatContext} ctx
   */
  _knockback(h, ctx) {
    if (this._kbDist <= 0) return;
    if (this.armored) {
      this._kbDist = 0;
      return;
    }
    const T = F(KB_F);
    const t0 = this._kbT;
    const t1 = Math.min(T, t0 + h);
    const e0 = 1 - (1 - t0 / T) ** 2;
    const e1 = 1 - (1 - t1 / T) ** 2;
    const s = this._kbDist * (e1 - e0);
    if (s > 0) this.move(this._kbX * s, this._kbZ * s, ctx);
    this._kbT = t1;
    if (t1 >= T - EPS) this._kbDist = 0;
  }

  /** @param {number} h @param {CombatContext} ctx */
  _updateDead(h, ctx) {
    this.t += h;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - h);
    const s = this.sprite;
    // the kind's death throes (§29 V8): the brain may fade the sprite itself
    if (this.brain.dead && ctx && this.brain.dead(this, h, ctx)) {
      this._writeFlash();
      this._writeGlow();
      return;
    }
    // a released body (§30.7) its brain let go — or has no hold of — fades from then, no death flash
    if (this.released) {
      this._goneT += h;
      s.opacity = Math.min(s.opacity, 1 - Math.min(1, this._goneT / F(BOSS_FADE_F)));
      this._writeFlash();
      return;
    }
    if (this.boss) {
      const k = BOSS_DEATH_FLASH;
      if (this.t < F(BOSS_FLASH_F)) this._setFlash(k[0], k[1], k[2], k[3]);
      else this._setFlash(0, 0, 0, 0);
      // (the see-through `bodyOpacity` it may have died with stays: the quad fades from there)
      s.opacity = Math.min(s.opacity, 1 - Math.min(1, this.t / F(BOSS_FADE_F)));
      return;
    }
    let fadeT = this.t;
    if (this.flier) {
      // falls from where it died (a diving bat is already low) to the ground over 12 f
      const k = Math.min(1, this.t / F(BAT_FALL_F));
      this.hover = (this._deathHover ?? 0) * (1 - k * k);
      this._applyHover();
      fadeT = this.t - F(BAT_FALL_F);
    }
    if (fadeT > 0) s.opacity = 1 - Math.min(1, fadeT / F(DEATH_FADE_F));
    if (s.opacity <= 0.001 && !this._deathFx) {
      this._deathFx = true;
      if (this.kind !== 'slime' && ctx) ctx.burst('deathPoof', this.position.x, this.position.y + 0.4, this.position.z, 8);
    }
    this._writeFlash();
  }

  // ---------------------------------------------------------------------------------------------
  // internals: movement support
  // ---------------------------------------------------------------------------------------------

  _clearStuck() {
    this._stuckT = 0;
    this._detourT = 0;
    this._anchorT = 0;
  }

  /**
   * Net-progress watchdog of `seek`: < 1 u net movement in 4 s of seeking while > 1.5 u from the
   * target → stuck. A window begins at the first `seek` after a clear or the last check, where the
   * enemy stands then, and begins again when the quarry (qx, qz) — the player while aggroed, else
   * the seek point — moves more than ANCHOR_GOAL from where it was at the window's start.
   * @param {number} h
   * @param {number} d
   * @param {number} qx
   * @param {number} qz
   */
  _anchor(h, d, qx, qz) {
    const p = this.position;
    if (this._anchorT > 0 && Math.hypot(qx - this._anchorTX, qz - this._anchorTZ) > ANCHOR_GOAL) this._anchorT = 0;
    if (this._anchorT === 0) {
      this._anchorX = p.x;
      this._anchorZ = p.z;
      this._anchorTX = qx;
      this._anchorTZ = qz;
    }
    this._anchorT += h;
    if (this._anchorT < ANCHOR_S) return;
    const moved = Math.hypot(p.x - this._anchorX, p.z - this._anchorZ);
    if (moved < 1 && d > 1.5) this._stuckT = Math.max(this._stuckT, F(GIVEUP_F));
    this._anchorT = 0;
  }

  /** @param {number} dx @param {number} dz @param {CombatContext} ctx */
  _pickDetour(dx, dz, ctx) {
    const p = this.position;
    const h0 = ctx.groundAt(p.x, p.z);
    let best = -Infinity;
    let bx = -dx;
    let bz = -dz;
    this._detourSide = -(this._detourSide || 1);
    for (let k = 0; k < DETOUR_ANGLES.length; k++) {
      const a = DETOUR_ANGLES[k] * (k < 4 ? this._detourSide : 1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cx = dx * c - dz * s;
      const cz = dx * s + dz * c;
      const x1 = p.x + cx * 0.7;
      const z1 = p.z + cz * 0.7;
      const x2 = p.x + cx * 1.4;
      const z2 = p.z + cz * 1.4;
      if (!ctx.walkable(x1, z1) || !ctx.walkable(x2, z2)) continue;
      const h1 = ctx.groundAt(x1, z1);
      if (Math.abs(h1 - h0) > 0.55 || Math.abs(ctx.groundAt(x2, z2) - h1) > 0.55) continue;
      const score = cx * dx + cz * dz;
      if (score > best + 1e-6) {
        best = score;
        bx = cx;
        bz = cz;
      }
    }
    this._detourX = bx;
    this._detourZ = bz;
    this._detourT = F(DETOUR_F);
  }

  /** Forget the current path (a new target, home reached, a reset). */
  _clearPath() {
    this._pathN = 0;
    this._pathI = 0;
    this._pathFor = 0;
    this._pathAt = -Infinity;
    this._homeLost = false;
    this._pathBad = false;
    this._pathCut = -1;
    this._pathExact = -1;
    this._navDirect = true;
    this._navNext = 0;
    this.unreachable = false;
  }

  /**
   * Advance along the current path: past a waypoint within 0.4 u when the next one is in a straight
   * line from here (the body fits all along it) or the enemy stands in the waypoint's own cell, and
   * (every 6 f) past the current one when the next is already in such a line (a corner cut). A
   * walk blocked for 6 f just after such an early pass goes back to that waypoint, which then
   * counts only on the spot. On the 6 f frames a way to the current waypoint that is no longer
   * clear (pushed off the path, e.g. down a ledge) asks for a new search (`_pathBad`).
   * @param {CombatContext} ctx
   * @returns {number} the index of the waypoint to walk to
   */
  _followPath(ctx) {
    const p = this.position;
    const w = this._path;
    const n = this._pathN;
    const nav = ctx.nav;
    let i = this._pathI;
    if (this._pathCut === i && i > 0 && this._stuckT >= F(CUT_BACK_F) - EPS) {
      i--;
      this._pathExact = i;
      this._pathCut = -1;
    }
    while (i < n - 1) {
      const wx = w[i * 2];
      const wz = w[i * 2 + 1];
      const dx = wx - p.x;
      const dz = wz - p.z;
      const d2 = dx * dx + dz * dz;
      if (i === this._pathExact) {
        if (d2 > WP_EXACT * WP_EXACT) break;
      } else {
        if (d2 > WP_REACH * WP_REACH) break;
        if (nav.cellAt(p.x, p.z) !== nav.cellAt(wx, wz) && !nav.lineClear(p.x, p.z, w[i * 2 + 2], w[i * 2 + 3], 0, true)) break;
      }
      this._pathCut = d2 > WP_EXACT * WP_EXACT ? i + 1 : -1;
      i++;
    }
    if (ctx.frame % NAV_EVERY === this._navPhase) {
      if (i < n - 1 && i !== this._pathExact && nav.lineClear(p.x, p.z, w[i * 2 + 2], w[i * 2 + 3], 0, true)) {
        this._pathCut = i + 1;
        i++;
      }
      // (the last waypoint is the goal itself, which may stand in a closed cell: its spot is left out)
      else if (!nav.lineClear(p.x, p.z, w[i * 2], w[i * 2 + 1], i === n - 1 ? 0.3 : 0)) this._pathBad = true;
    }
    this._pathI = i;
    return i;
  }

  /**
   * At the last waypoint of a path that stops short of (gx, gz) (a path longer than MAX_WP)?
   * @param {number} gx
   * @param {number} gz
   * @returns {boolean}
   */
  _pathEnded(gx, gz) {
    const n = this._pathN;
    if (n === 0 || this._pathI < n - 1) return false;
    const w = this._path;
    const lx = w[n * 2 - 2];
    const lz = w[n * 2 - 1];
    const p = this.position;
    return Math.hypot(lx - p.x, lz - p.z) < WP_REACH && Math.hypot(lx - gx, lz - gz) > WP_REACH;
  }

  /**
   * The longest path accepted (u) for [minimum, x (leash + home radius)].
   * @param {number[]} k
   * @returns {number}
   */
  _reach(k) {
    // (a swarm rushes the party from wherever it appeared: a long way, §29 V4)
    if (this.swarm && k === CHASE_COST) return SWARM_REACH;
    const leash = Number.isFinite(this.def.leash) ? this.def.leash : 12;
    return Math.max(k[0], k[1] * (leash + this.homeRadius));
  }

  /**
   * Keep the boss inside its arena rect (inset by its move radius); a clamp reads as 'arena'.
   * @param {number} len
   * @param {number} fr
   * @returns {number}
   */
  _keepInArena(len, fr) {
    const r = this.arena.rect;
    const m = this.def.moveRadius + 0.1;
    const p = this.position;
    const x = Math.min(r.maxX - m, Math.max(r.minX + m, p.x));
    const z = Math.min(r.maxZ - m, Math.max(r.minZ + m, p.z));
    if (x === p.x && z === p.z) return fr;
    p.x = x;
    p.z = z;
    this.blockedBy = 'arena';
    return Math.min(fr, 0.2);
  }

  // ---------------------------------------------------------------------------------------------
  // internals: hazards and markers
  // ---------------------------------------------------------------------------------------------

  /** @param {HazardType} type @returns {EnemyHazard} */
  _newHazard(type) {
    /** @type {EnemyHazard} */
    let hz = null;
    for (const z of this._hazards) {
      if (!z.on) {
        hz = z;
        break;
      }
    }
    if (!hz) {
      hz = /** @type {EnemyHazard} */ ({});
      this._hazards.push(hz);
    }
    hz.on = true;
    hz.type = type;
    hz.h = -1;
    hz.t = 0;
    hz.delay = 0;
    hz.dur = 1;
    hz.x = this.position.x;
    hz.z = this.position.z;
    hz.r = 1;
    hz.mv = 1;
    hz.kb = 0;
    hz.knockdown = false;
    hz.flat = 0;
    hz.thin = false;
    hz.track = false;
    hz.clamp = null;
    hz.visualOnly = false;
    hz.resolved = false;
    hz.started = false;
    hz.burst = null;
    hz.burstN = 0;
    hz.sfx = null;
    hz.tag = 0;
    return hz;
  }

  /** @param {number} h @param {CombatContext} ctx */
  _updateHazards(h, ctx) {
    const list = this._hazards;
    for (let i = 0; i < list.length; i++) {
      const hz = list[i];
      if (!hz.on) continue;
      if (hz.delay > 0) {
        hz.delay -= h;
        if (hz.delay > EPS) continue;
        hz.delay = 0;
      }
      switch (hz.type) {
        case 'circle': this._hzCircle(hz, h, ctx); break;
        case 'ring': this._hzRing(hz, h, ctx); break;
        case 'magma': this._hzMagma(hz, h, ctx); break;
        case 'fade': this._hzFade(hz, h, ctx); break;
        default: this._killHazard(hz, ctx);
      }
    }
  }

  /** @param {EnemyHazard} hz @param {number} h @param {CombatContext} ctx */
  _hzCircle(hz, h, ctx) {
    if (!hz.started) {
      hz.started = true;
      if (hz.track) {
        const P = ctx.player.position;
        hz.x += P.x;
        hz.z += P.z;
      }
      if (hz.clamp) {
        hz.x = Math.min(hz.clamp.maxX, Math.max(hz.clamp.minX, hz.x));
        hz.z = Math.min(hz.clamp.maxZ, Math.max(hz.clamp.minZ, hz.z));
      }
      const m = this.markerSpec('circle', hz.x, hz.z);
      m.r = hz.r;
      hz.h = ctx.marker(m);
    }
    const prog = Math.min(1, hz.t / hz.dur);
    if (hz.h >= 0) {
      this._slotSpec.progress = prog;
      ctx.setMarker(hz.h, this._slotSpec);
    }
    if (!hz.resolved && hz.t >= hz.dur - EPS) {
      hz.resolved = true;
      if (!hz.visualOnly) {
        const s = this.hitSpec();
        s.shape = 'circle';
        s.x = hz.x;
        s.z = hz.z;
        s.y = ctx.groundAt(hz.x, hz.z);
        s.r = hz.r;
        s.mv = hz.mv;
        s.kb = hz.kb;
        s.knockdown = hz.knockdown;
        s.tag = hz.tag;
        ctx.hitbox(this, s);
        const gy = s.y;
        if (hz.burst) ctx.burst(hz.burst, hz.x, gy + 0.2, hz.z, hz.burstN || 10);
        if (hz.sfx) ctx.sfx(hz.sfx, hz.x, hz.z);
      }
    }
    hz.t += h;
    if (hz.t >= hz.dur + F(5) - EPS) this._killHazard(hz, ctx);
  }

  /** @param {EnemyHazard} hz @param {number} h @param {CombatContext} ctx */
  _hzRing(hz, h, ctx) {
    if (!hz.started) {
      hz.started = true;
      const m = this.markerSpec('ring', hz.x, hz.z);
      m.r = hz.r;
      m.rInner = Math.max(0, hz.r - hz.width);
      m.progress = 1;
      hz.h = ctx.marker(m);
    }
    const r = hz.r0 + hz.speed * hz.t;
    const rIn = Math.max(0, r - hz.width);
    if (r > hz.rMax + EPS) {
      this._killHazard(hz, ctx);
      return;
    }
    if (hz.h >= 0) {
      const m = this.markerSpec('ring', hz.x, hz.z);
      m.r = r;
      m.rInner = rIn;
      m.progress = 1;
      ctx.setMarker(hz.h, m);
    }
    const s = this.hitSpec();
    s.shape = 'ring';
    s.x = hz.x;
    s.z = hz.z;
    s.y = ctx.groundAt(hz.x, hz.z);
    s.r = r;
    s.rInner = rIn;
    s.mv = hz.mv;
    s.kb = hz.kb;
    s.thin = hz.thin;
    s.knockdown = hz.knockdown;
    s.tag = hz.tag;
    ctx.hitbox(this, s);
    hz.t += h;
  }

  /** @param {EnemyHazard} hz @param {number} h @param {CombatContext} ctx */
  _hzMagma(hz, h, ctx) {
    if (!hz.started) {
      hz.started = true;
      const m = this.markerSpec('circle', hz.x, hz.z);
      m.r = hz.r;
      m.progress = 1;
      m.style = 'magma';
      hz.h = ctx.marker(m);
    }
    hz.t += h;
    // a flat tick every `tick` s while the pool lasts (new tag per tick, §8.2)
    const due = Math.floor((hz.t + EPS) / hz.tick);
    if (due > hz.n && hz.t < hz.dur + EPS) {
      hz.n = due;
      const s = this.hitSpec();
      s.shape = 'circle';
      s.x = hz.x;
      s.z = hz.z;
      s.y = ctx.groundAt(hz.x, hz.z);
      s.r = hz.r;
      s.mv = 0;
      s.kb = 0;
      s.flat = hz.flat;
      s.tag = this.newTag();
      ctx.hitbox(this, s);
    }
    if (hz.t >= hz.dur - EPS) this._killHazard(hz, ctx);
  }

  /** @param {EnemyHazard} hz @param {number} h @param {CombatContext} ctx */
  _hzFade(hz, h, ctx) {
    hz.t += h;
    const a = 1 - Math.min(1, hz.t / hz.dur);
    if (hz.h >= 0) {
      this._fadeSpec.alpha = a;
      ctx.setMarker(hz.h, this._fadeSpec);
    }
    if (hz.t >= hz.dur - EPS) this._killHazard(hz, ctx);
  }

  /** @param {EnemyHazard} hz @param {CombatContext} [ctx] */
  _killHazard(hz, ctx) {
    if (hz.h >= 0 && ctx) ctx.freeMarker(hz.h);
    hz.h = -1;
    hz.on = false;
  }

  /**
   * Free every marker (slots and hazards).
   * @param {CombatContext} ctx
   */
  _freeAll(ctx) {
    this.unmarkAll(ctx);
    for (const hz of this._hazards) if (hz.on) this._killHazard(hz, ctx);
  }

  /** Forget handles without freeing them (reset without a context: core cleared the batch). */
  _forgetAll() {
    this._slots.fill(-1);
    for (const hz of this._hazards) {
      hz.h = -1;
      hz.on = false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // internals: look
  // ---------------------------------------------------------------------------------------------

  /** Direction row from `facing` at the current camera yaw (the camera may have turned). */
  _refreshRow() {
    const s = this.sprite;
    const dir = Sprite3D.directionFromVector(this.facing.x, this.facing.z, globalUniforms.uCameraYaw.value, s.direction);
    if (dir === s.direction) return;
    if (this._poseName !== null) {
      s.direction = dir;
      this.pose(this._poseName);
    } else {
      s.setDirection(dir);
    }
  }

  /** Fliers draw their quad and shadow proxy at the hover height (+ lift); the blob stays on the ground. */
  _applyHover() {
    const y = (this.flier ? this.hover : 0) + this.lift;
    this.sprite.mesh.position.y = y;
    this.sprite.shadowProxy.position.y = y;
  }

  /**
   * uFlash / uHighlight priority (§9.3): hit flash > frozen ice > wind-up pulse > chill frost > elite
   * shimmer > off (a chilled foe keeps its faint rime mix under the wind-up pulse; §29 V5). The hit
   * flash mixes toward white (a short silhouette flash, 0.85 / 0.4); the boss's is a white
   * highlight instead (0.6 / 0.3: the stone blanches but keeps its shape — a 4 u tall white
   * silhouette bloomed into a glare). The wind-up and the elite shimmer are highlights that keep
   * the sprite's shading (see `WINDUP_HL`); the integration pass's lower mix alphas (COMBAT.md
   * "Deviations (integration)" I3) no longer apply to them.
   */
  _writeFlash() {
    const f = this.hitFlash;
    if (f > 0) {
      const strong = f > FLASH_STRONG + EPS;
      if (this.boss) {
        this._setFlash(0, 0, 0, 0);
        this._setHighlight(2.2, 2.2, 2.2, strong ? 0.6 : 0.3);
      } else {
        this._setFlash(2.2, 2.2, 2.2, strong ? 0.85 : 0.4);
        this._setHighlight(0, 0, 0, 0);
      }
      return;
    }
    // frozen: the ice shell (§29 V5) — a mix toward pale glacier ice under a cold colour ratio
    if (this._freezeT > 0 && this.alive) {
      const I = this.iceShell ? SHELL_FLASH : ICE_FLASH;
      const H = this.iceShell ? SHELL_HL : ICE_HL;
      this._setFlash(I.r, I.g, I.b, I.a);
      this._setHighlight(H.r, H.g, H.b, H.a);
      return;
    }
    const chilled = this._chillT > 0 && this.alive;
    // (a boss's frost is half as strong: it stays itself, rv-play #4)
    const tint = this.boss ? BOSS_TINT : 1;
    if (chilled) this._setFlash(RIME_FLASH.r, RIME_FLASH.g, RIME_FLASH.b, RIME_FLASH.a * tint);
    else if (this.alive || !this.boss) this._setFlash(0, 0, 0, 0);
    if (this.state === 'windup' && this.alive) {
      // lo ↔ hi at 8 Hz, restarted from lo by every wind-up (§7.3)
      const H = WINDUP_HL;
      this._setHighlight(H.r, H.g, H.b, H.lo + (H.hi - H.lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * 8 * this.t)));
    } else if (chilled) {
      // chilled: the cold colour ratio, breathing
      const H = CHILL_HL;
      this._setHighlight(H.r, H.g, H.b, (H.lo + (H.hi - H.lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * 1.5 * this._clock))) * tint);
    } else if (this.elite && this.alive) {
      const H = ELITE_HL;
      this._setHighlight(H.r, H.g, H.b, H.lo + (H.hi - H.lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * this._clock)));
    } else {
      this._setHighlight(0, 0, 0, 0);
    }
  }

  /** @param {number} r @param {number} g @param {number} b @param {number} a */
  _setFlash(r, g, b, a) {
    const c = this._flash;
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) return;
    c[0] = r;
    c[1] = g;
    c[2] = b;
    c[3] = a;
    this.sprite.setFlash(r, g, b, a);
  }

  /** @param {number} r @param {number} g @param {number} b @param {number} a */
  _setHighlight(r, g, b, a) {
    const c = this._highlight;
    if (c[0] === r && c[1] === g && c[2] === b && c[3] === a) return;
    c[0] = r;
    c[1] = g;
    c[2] = b;
    c[3] = a;
    this.sprite.setHighlight(r, g, b, a);
  }

  /** uGlow for the kind (§7.7, §8.3): brain.glow(e, out) fills [r, g, b, a]. */
  _writeGlow() {
    const o = this._glowOut;
    o[0] = 0;
    o[1] = 0;
    o[2] = 0;
    o[3] = 0;
    if (this.brain.glow) this.brain.glow(this, o);
    const c = this._glow;
    if (c[0] === o[0] && c[1] === o[1] && c[2] === o[2] && c[3] === o[3]) return;
    c[0] = o[0];
    c[1] = o[1];
    c[2] = o[2];
    c[3] = o[3];
    this.sprite.setGlow(o[0], o[1], o[2], o[3]);
  }
}

/**
 * Is (x, z) outside the zone rect grown by ZONE_MARGIN? (false without a zone)
 * @param {RectXZ|null} r
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
function outsideZone(r, x, z) {
  return !!r && (x < r.minX - ZONE_MARGIN || x > r.maxX + ZONE_MARGIN || z < r.minZ - ZONE_MARGIN || z > r.maxZ + ZONE_MARGIN);
}

/**
 * A status effect's seconds (caller or level data): finite and > 0, capped at `STATUS_MAX`; else 0.
 * @param {unknown} v
 * @returns {number}
 */
function statusSeconds(v) {
  return typeof v === 'number' && v > 0 ? Math.min(STATUS_MAX, v) : 0;
}

/** A besieger's ring radius when its group's `besiege` gives none (DRAGON_CAMPAIGN.md §5.3). */
const BESIEGE_RING = 2.6;

/**
 * A group's `besiege` ([x, z] or [x, z, r]; level data, untrusted) → `{ x, z, r }` (r clamped to
 * 0.5–12, `BESIEGE_RING` when absent), or null when it is none.
 * @param {unknown} v
 * @returns {{ x: number, z: number, r: number }|null}
 */
function besiegeOf(v) {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) return null;
  const [x, z, r] = v;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z, r: Number.isFinite(r) ? Math.min(12, Math.max(0.5, r)) : BESIEGE_RING };
}

/**
 * Create an enemy actor; its brain comes from `ai/index.js` by kind.
 * @param {EnemyInit} init
 * @returns {Enemy}
 */
export function createEnemy(init) {
  return new Enemy(init);
}
