import * as THREE from 'three';
import { Sprite3D, RNG, hashString, hash2, EventEmitter, clamp, UI } from '../../engine/index.js';
// the combat-only engine modules come straight from their files, not through the engine barrel:
// peaceful levels never download them (KNOWN_ISSUES COMBAT-17; vite.config.js marks them pure)
import { FxQuads } from '../../engine/fx/FxQuads.js';
import { GroundMarkers, registerMarkerStyles } from '../../engine/fx/GroundMarkers.js';
import { createFxAtlas } from '../../engine/pixel/FxSprites.js';
import { createEnemySheet } from '../../engine/pixel/MonsterSprites.js';
import { registerCombatPresets } from '../../engine/fx/presets/combat.js';
import { CombatHUD } from '../../engine/ui/CombatHUD.js';
import { BossBar } from '../../engine/ui/BossBar.js';
import { WorldLabels } from '../../engine/ui/WorldLabels.js';
import { Announcer } from '../../engine/ui/Announcer.js';
import { DeathScreen } from '../../engine/ui/DeathScreen.js';
import { registerStrings, t, tn, sep } from '../../engine/i18n/I18n.js';
import { term, quietly } from '../../engine/i18n/ContentText.js';
import { enemyStartPoints, ENEMY_INFO } from '../../engine/level/ObjectCatalog.js';
import { hasStoryCondition } from '../../engine/level/Travel.js';
import { isOwnKey } from '../../engine/utils/own.js';
import { CHARACTER_SPRITE_OPTS } from '../config.js';
import { createEnemy } from './Enemy.js';
import { scaledDef, ENEMY_DEFS } from './defs.js';
import {
  EPS, F, SHOT_Y, MELEE_DY, mitigation, CRIT, DRAUGHT, DRAUGHT_HEAL, POTION_MAX, HEART_HEAL, MANA_MOTE, SHOP_WARES, shopWare,
  ENGAGE, GOLD_LOSS, RESPAWN_IFRAMES, RESPAWN_GUARD, DEATH_SCREEN_DELAY, PERFECT, WAYSTONE, PLAYER_SEP_MASS, LEVEL_CAP, UPGRADES,
} from './rules.js';
import { COMBAT_BINDINGS, COMBAT_CONTROLS } from './bindings.js';
import { hitOverlaps, HitQueue, TagRegistry } from './Hitboxes.js';
import { CombatInput } from './CombatInput.js';
import { PlayerCombat, PLAYER_HIT_META } from './PlayerCombat.js';
import { Targeting } from './Targeting.js';
import { Projectiles } from './Projectiles.js';
import { Pickups } from './Pickups.js';
import { lootRng, rollLoot, splitCoins } from './Loot.js';
import { Waystones, Chests, placeName } from './Waystones.js';
import { BossArena } from './BossArena.js';
import { SkyDragon } from './SkyDragon.js';
import { CombatFx } from './CombatFx.js';
import { CombatLook, HIT_STOP, SHAKE, playerHitStop, ENEMY_FLASH_TIME } from './Feel.js';
import { CombatMusic } from './CombatMusic.js';
import { makeHooks } from './hooks.js';
import { Nav } from './Nav.js';
import COMBAT_STRINGS from './strings.js';
import { packsFor, loadEnemyPacks, packSystems, packMarkerStyles } from './packs/index.js';
import { COMBAT_PACK_API } from './packs/api.js';
// the party's companions (docs/specs/PARTY.md §5): a member's fight, made by `addAlly`
import { MemberCombat } from '../party/MemberCombat.js';
import { classMayFight } from '../party/mayFight.js';
import { ALLY } from '../party/rules.js';

/**
 * @import { CombatContext, PlayerView, MarkerSpec, HitSpec, CombatState, CombatStats, EnemyKind,
 *   EnemySheet, EnemyInit, EnemyGroup, BossSignal, SfxOptions, ProjectileSpec, LiveProjectile,
 *   ProjectileContact, PlayerHitMeta, SwingRecord, PointXZ, UpgradeKind, Splash, StrikeSpec, StrikeResult, BossAdds, EnemyDef,
 *   HitStatus, HitFeel, LookStage, PulseSpec, PulseResult, WarmthZone, MarksLook, CombatPackSystem,
 *   MarkerStyle } from './types.js'
 * @import { Enemy } from './Enemy.js'
 * @import { LevelObject, LevelObjectOf } from '../../engine/level/types.js'
 * @import { Checkpoint } from './Waystones.js'
 * @import { Game } from '../Game.js'
 * @import { SfxName } from '../../engine/audio/AudioSystem.js'
 * @import { PartyMember } from '../party/PartyMember.js'
 */

/**
 * A marker slot of core's table (`_mk`).
 * @typedef {object} MarkerSlot
 * @property {number} h  the GroundMarkers handle (−1: free)
 * @property {Enemy|'core'|null} owner
 * @property {number} gen  generation: stale handles held by brains are ignored
 * @property {Required<MarkerSpec>} spec  the full spec
 */

/**
 * `_spawnAdd` as ctx.spawnAdd calls it: with the add's `level` as a 5th argument, which it does not
 * take (adds are pooled at ADD_LEVEL), so the argument is dropped.
 * @typedef {(...a: [...Parameters<CombatSystem['_spawnAdd']>, number]) => Enemy|null} SpawnAddCall
 */
/**
 * `_onSignal` as ctx.emit calls it: `_onSignal` takes (event, e, a) only (a = the bossPhase
 * phase), so the 4th argument `b` is dropped.
 * @typedef {(...a: [...Parameters<CombatSystem['_onSignal']>, any]) => void} OnSignalCall
 */

/**
 * CombatSystem — the ARPG combat of a combat level (COMBAT.md §4, §9.1): created by `Game.init`
 * only when `levelHasCombat(level)`; peaceful levels never construct it.
 *
 * It owns the combat clock (sub-steps of ≤ 1/60 s, a combat-wide hit-stop and per-side time
 * scales — `engine.time.timeScale` is never touched), the player kit (`PlayerCombat`), every
 * enemy (created at load from the level's `enemy` groups, the boss adds pooled), hit resolution,
 * projectiles, pickups, loot, checkpoints and chests, the boss arena and every global consequence
 * of the boss's signals, the feedback (hit-stop, shake, flashes, numbers, sparks, the look),
 * battle music, the combat HUD values and `window.__game.combat` (the `hooks`).
 *
 * Frame protocol (Game.update): `update(dt, active, ambient)` → `player.update` →
 * `afterPlayer(dt, active, ambient)` → … → `applyLook(dt)` after `weather.update` (`ambient`: combat
 * is inactive only because a story run holds the player — DRAGON_CAMPAIGN.md §6.4). Nothing is
 * created or disposed mid-game: pools, hidden sprites (opacity 0) and parked handles only.
 *
 * With a story, every enemy group, chest and waystone is loaded, present or not, and comes and goes
 * live (`applyPresence`, STORY_SCRIPT.md §9.5); a campaign remembers the groups defeated in a level
 * until a waystone rest (`defeatedGroups` / `markGroupsCleared`, CAMPAIGN_FORMAT.md §6.4).
 *
 * The party's members fight beside the player (`addAlly` → a MemberCombat per member, `allies`;
 * PARTY.md §5, COMBAT.md §28): they step after the player's kit, each enemy sees its target —
 * the player, or a companion that hit it — as `ctx.player`, their hits and the enemies' hits on
 * them are resolved after the player's. With no companion nothing of it runs.
 *
 * Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §6.4, COMBAT.md §29): bosses by their def
 * (`def.boss`: arena, the adds' pool `def.adds`, the bar's phases `def.phases`, the see-through box
 * from `radius` / `body`; several boss groups, `_boss` the one whose fight runs; `def.introOnSpawn`:
 * the intro starts as the group appears); on a **set-piece** level (`setpiece`: a sky dragon, a
 * set-piece kind, a besieging or swarming group) the **ambient step** while a story scene holds
 * the player (idle foes, a boss's intro, the dying, shots, effects and the sky dragons go on and
 * hurt no one); `swarm` groups wake as they appear; `respawn` (`environment.respawn: false`: a rest
 * only heals); status effects on enemies from player-side hits (`HitStatus`: chill, freeze, stun)
 * and their `feel`; `taunt` and `ward`; the sky dragons (`skyDragons`, SkyDragon.js); `strike(spec)`
 * (an enemy-side area hit from no enemy).
 */

const SUBSTEP = 1 / 60;
const BUDGETS = Object.freeze({ melee: 3, ranged: 2 });
const DORMANT_RANGE = 32;
const CHECK_EVERY = 0.25;
const BAR_SLOTS = 32;
const EDGE_SLOTS = 8;
const EDGE_RANGE = 20;
const PIP_RANGE = 16;
const ELITE_BAR_RANGE = 20;
const BAR_TIME = 4;
const DUMMY_REFILL = F(120);
const LOW_HP = 0.25;
const HEART_BOOST_HP = 0.3;
const CALM_TIME = 5;
const HEARTBEAT = 0.9;
const INTRO_LOCK = F(108);
const KNEEL_CAP = 0.08;
const KNEEL_TIME = F(90);
const ADDS_PER_BOSS = 6;
const ADD_LEVEL = 5;
/** A boss's adds as a list (§30.3): at most this many in its pool, all entries together. */
const MAX_ADDS = 12;
const MARKER_SLOTS = 48;
const TICK_SAMPLES = 240;
const SEP_ITER = 1;
/** The boss's sprite dithers to this opacity while the player stands behind it on screen. */
const SEE_THROUGH = 0.45;
/** Damage numbers of non-boss enemies spawn this far above their bar anchor (`labelY`). */
const NUMBER_OVER_BAR = 0.4;
/** A hit star moved to the head top of a target behind the player is drawn a little smaller. */
const STAR_SMALL = Object.freeze({ scale: 0.8 });
/** A companion's hit star: smaller than the player's (its hits are not the player's to feel). */
const ALLY_STAR = Object.freeze({ scale: 0.55 });
/** Path searches (Nav.findPath) allowed per combat sub-step; a refused enemy asks again later. */
const NAV_SEARCHES = 2;
/** The combat UI classes (`ui.enableCombat`; imported here so peaceful levels never load them). */
const COMBAT_UI = Object.freeze({ CombatHUD, BossBar, WorldLabels, Announcer, DeathScreen });
/**
 * The WorldLabels kind of a companion's damage number: the party's teal, a little smaller than the
 * player's (`.lu-num--ally`, combat.css).
 * @type {'ally'}
 */
const ALLY_NUMBER = 'ally';
/**
 * Volume of a companion's hit sound. Its hits have no hit-stop and no shake (the whole fight would
 * stutter with every companion's hit; the player's own hits keep theirs).
 */
const ALLY_HIT_SFX_VOLUME = 0.55;
/**
 * A companion's hitbox kinds as QueuedHit metadata (only `source` is read: no hit-stop, combo or
 * finisher for companions).
 * @type {Readonly<Record<'melee'|'skill'|'projectile', Readonly<PlayerHitMeta>>>}
 */
const ALLY_HIT_META = Object.freeze({
  melee: Object.freeze({ source: 'melee', stop: 0, finisher: false, combo: 0 }),
  skill: Object.freeze({ source: 'skill', stop: 0, finisher: false, combo: 0 }),
  projectile: Object.freeze({ source: 'projectile', stop: 0, finisher: false, combo: 0 }),
});

/**
 * The FxQuads batch: effects (CombatFx's 128), projectiles (64), pickups, the arena's flames and the
 * sky dragons' fireballs (COMBAT.md §29: a party of four's spells and a dragon's barrage at once).
 */
const QUAD_CAPACITY = 512;
/**
 * The gold line of the loot feed (`_goldFeedStep`): coins collected in a row add up, shown after
 * `quiet` s without a coin or `most` s after the first.
 */
const GOLD_FEED = Object.freeze({ quiet: 0.45, most: 1.6 });
/**
 * After the player's fall (the death reset): the surviving foes, back home, are calm this long (no
 * sight aggro; a swarm's rush is spent) — the player does not rise into a swarm (rv-play #10).
 */
const RESPAWN_CALM = 6;
/** Sky dragons a level may fly (`skyDragon` objects beyond it are left out, with a warning). */
const MAX_SKY_DRAGONS = 2;
/** Wards at once (`ward`): the strongest counts. */
const WARD_SLOTS = 8;
/** A warded hit's glint on the one it spared (the magicBurst pool, gold). */
const WARD_GLINT = Object.freeze({ colors: ['#ffe9a8', '#fff6d8'], hdr: 2.2 });
/** One hitbox hitting this many foes in a sub-step softens their hit flashes (`Enemy.softenFlash`). */
const CROWD = 3;
/** A big hit's camera shake is capped (`HitFeel.shake`). */
const FEEL_SHAKE_MAX = [0.6, 1.5];
/**
 * The ambient step wakes the idle foes this near the camera's look-at point (or the player): a
 * cutscene shot of a besieged house far from the party shows its besiegers at work.
 */
const AMBIENT_RANGE = DORMANT_RANGE;
/** The player counts as inside an arena (its intro may close it) this far within its rect. */
const ARENA_ENTER_INSET = 0.6;

/** @type {Required<MarkerSpec>} MarkerSpec keys (GroundMarkers.set) with their defaults */
const MARKER_DEFAULTS = {
  shape: 'circle', x: 0, y: 0.03, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1,
  w: 1, d: 1, progress: 0, style: 'enemy', alpha: 1, flash: 0,
};
const MARKER_KEYS = Object.keys(MARKER_DEFAULTS);

/** `ctx.bells` without a world (the enemies sandbox): no bell. */
const NO_BELLS = new Map();
const _v = new THREE.Vector3();
const _vp = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _ndc2 = new THREE.Vector2();
const _plane = new THREE.Plane();

/**
 * A boss's pool of adds (COMBAT.md §8, DRAGON_CAMPAIGN.md §6.4, §30.3): its def's `adds` — one kind:
 * `ADDS_PER_BOSS` foes of it at `ADD_LEVEL` (the golem's six level-5 bats), as ever; a list
 * `[{ kind, count = 6, level = 5 }]`: each entry's (a known kind that is no boss; `MAX_ADDS` in all)
 * — or none: no `adds`, or no boss.
 * @param {EnemyDef} def
 * @returns {BossAdds[]}
 */
function bossAdds(def) {
  const a = def.adds;
  if (!def.boss || !a) return [];
  if (!Array.isArray(a)) return [{ kind: /** @type {EnemyKind} */ (a), count: ADDS_PER_BOSS, level: ADD_LEVEL }];
  /** @type {BossAdds[]} */
  const out = [];
  let total = 0;
  for (const s of a) {
    const k = s?.kind;
    const count = clamp(Math.round(s?.count ?? ADDS_PER_BOSS) || 0, 0, MAX_ADDS - total);
    if (!isOwnKey(ENEMY_DEFS, k) || ENEMY_DEFS[/** @type {EnemyKind} */ (k)].boss || !(count > 0)) continue;
    out.push({ kind: k, count, level: clamp(Math.round(s.level ?? ADD_LEVEL) || ADD_LEVEL, 1, 10) });
    total += count;
  }
  return out;
}

/**
 * The `skyDragon` objects a level flies (`CombatSystem.load`): the first `MAX_SKY_DRAGONS` in level
 * order; `left` counts the rest (level data is untrusted: each one is a draw call, a terrain drape
 * and up to 60 FX quads; rv-tech minor 13).
 * @param {LevelObject[]} objects
 * @returns {{ kept: LevelObjectOf<'skyDragon'>[], left: number }}
 */
export function skyDragonObjects(objects) {
  /** @type {LevelObjectOf<'skyDragon'>[]} */
  const kept = [];
  let left = 0;
  for (const o of objects) {
    if (o.type !== 'skyDragon') continue;
    if (kept.length < MAX_SKY_DRAGONS) kept.push(o);
    else left++;
  }
  return { kept, left };
}

export class CombatSystem {
  /** @param {{ game: Game }} opts */
  constructor({ game }) {
    this.game = game;
    this.engine = game.engine;
    this.scene = game.engine.scene;
    this.tileMap = game.tileMap;
    this.level = game.level;
    this.world = game.world;
    this.player = game.player;
    this.rig = game.rig;
    this.ui = game.ui;
    this.audio = game.audio;
    this.particles = game.particles;
    this.lighting = game.lighting;
    this.spriteManager = game.spriteManager;
    this.postfx = game.postfx;
    this.input = game.engine.input;
    this.env = game.env ?? game.level.environment ?? {};

    /** Combat events (§9.6). */
    this.events = new EventEmitter();
    /** @type {Enemy[]} level object order, then index; adds last */
    this.enemies = [];
    /**
     * Every enemy, boss and add sprite (the Game's sprite loop registers their fill / blob).
     * @type {Sprite3D[]}
     */
    this.actorSprites = [];
    this.engaged = false;
    this.locksPlayer = false;
    this.bossDefeated = false;
    /**
     * Aggroed enemies' live positions (the minimap's red dots), refilled in place.
     * @type {PointXZ[]}
     */
    this.minimapEnemies = [];
    /** @type {PointXZ[]} the records `minimapEnemies` reuses */
    this._mmPool = [];
    this.tutorial = { combo: false, dodge: false, rewarded: false };
    /** Ids of the one-time shop wares bought this session (SHOP_WARES; the reset hook clears it). */
    this.purchased = new Set();

    // clock
    this.seedValue = hashString(this.level.name) >>> 0;
    this.rng = new RNG(this.seedValue);
    this.stop = 0;
    this.playerScale = 1;
    this.enemyScale = 1;
    this._slow = 0;
    this.clock = 0;
    this.enemyTime = 0;
    this.frame = 0;
    this.stepNo = 1;
    this._advanced = 0;
    this._wasActive = false;
    this.kills = 0;
    this.god = false;
    this.freezeAI = false;
    /** @type {PointXZ|null} the `aim` hook's aim point (null: the mouse) */
    this.aimOverride = null;
    this._tokens = { melee: 0, ranged: 0 };
    this._engageLinger = 0;
    this._calm = 0;
    this._heartbeat = 0;
    this._checkT = 0;
    this._deathT = -1;
    this._introT = 0;
    this._respawning = false;
    /** @type {{ t: number, fn: () => void }[]} `_later` callbacks (real seconds left) */
    this._timers = [];
    /** @type {(Enemy|'player')[]} hit-stop victims (they jitter while it lasts) */
    this._stopVictims = [];
    /**
     * Lines the game adds to the combat legend (a story's journal key, the party's *G — Party*).
     * @type {{ keys: string, label: string }[]}
     */
    this.legendExtra = [];
    /**
     * Combat legend rows the game leaves out, by id (a campaign that turned T or R off drops the
     * `toggles` row and lists the keys still on in `legendExtra`).
     * @type {string[]}
     */
    this.legendSkip = [];
    /** @type {Map<Enemy, EnemyGroup|null>} enemy → its level `enemy` object (adds: the boss's) */
    this._groupOf = new Map();
    /** @type {Map<Enemy, Enemy[]>} boss → its pooled adds */
    this._addsOf = new Map();
    /**
     * Pooled adds not spawned, and the foes of the groups the story has taken away (`_absent`):
     * hidden, dormant, excluded from everything.
     * @type {Set<Enemy>}
     */
    this._hidden = new Set();
    /** @type {Map<LevelObjectOf<'enemy'>, Enemy[]>} level `enemy` object → its foes (adds not included) */
    this._members = new Map();
    /** @type {Set<Enemy>} foes of a group the story has taken away (`applyPresence`; also in `_hidden`) */
    this._absent = new Set();
    /** @type {Set<LevelObjectOf<'enemy'>>} the groups absent now */
    this._absentGroups = new Set();
    /**
     * The burst pools this level's warm-up created — the presets only combat uses — released by
     * `dispose` (a campaign's next, peaceful level keeps its own program count: KNOWN_ISSUES CMP-05).
     * @type {ReturnType<import('../../engine/fx/Particles.js').Particles['burstPools']>}
     */
    this._ownPools = [];
    /** @type {Enemy|null} the level's boss (the first golem) */
    this._boss = null;
    /** @type {Enemy|null} the boss whose fight runs (intro to defeat / reset) */
    this._bossFight = null;
    this._bossAwake = false;
    /**
     * The phase-3 kneel window of a brain without `hpFloor` (fallback of `_bossClamp`).
     * @type {{ boss: Enemy, until: number, cap: number, taken: number }|null}
     */
    this._kneel = null;
    this._fightStart = 0;
    this._phaseStart = [0, 0, 0];
    this._phaseTimes = [0, 0, 0];
    /** @type {{ x: number, z: number, kind: string, arena: BossArena }[]} the arenas' map markers */
    this._bossMarkers = [];
    this.programsAtLoad = 0;
    this._programWarned = false;
    this._ticks = new Float32Array(TICK_SAMPLES);
    this._tickN = 0;
    this._tickT = 0;
    /** Bumped by every death screen and by the `respawn()` hook (a stale death screen stops). */
    this._deathGen = 0;
    /**
     * A level-up at the boss's kill waits for the results card ({ level, gains } or null).
     * @type {{ level: number, gains: string }|null}
     */
    this._levelAfterResults = null;
    this._bossKillXp = false;
    /**
     * The party's members fighting beside the player (docs/specs/PARTY.md §5; `addAlly`): their
     * MemberCombat, in join order.
     * @type {MemberCombat[]}
     */
    this.allies = [];
    /**
     * The ice mage's look (src/game/party/IceSpellFx.js `IceStage`: the Tomb's 3D crystals, the
     * ground frost, the FX batch's halo, an `IceSpellFx` per ice-mage member): made by `load` only
     * on a level where an ice mage can fight (`classMayFight('icemage', …)`), warmed with the combat, disposed
     * with it. Null everywhere else.
     * @type {import('../party/IceSpellFx.js').IceStage|null}
     */
    this.ice = null;
    /**
     * The cleric's look (src/game/party/HolySpellFx.js `HolyStage`, a `HolySpellFx` per cleric
     * member): made by `load` only where a cleric can fight (`classMayFight('cleric', …)`). Null
     * everywhere else.
     * @type {import('../party/HolySpellFx.js').HolyStage|null}
     */
    this.holy = null;
    /**
     * The greatshield's look (src/game/party/EarthSpellFx.js `EarthStage`, a `GreatshieldFx` per
     * greatshield member): made by `load` only where a greatshield can fight
     * (`classMayFight('greatshield', …)`). Null everywhere else.
     * @type {import('../party/EarthSpellFx.js').EarthStage|null}
     */
    this.earth = null;
    /**
     * The swordmaster's look (src/game/combat/SwordmasterFx.js `SwordStage`, its director on
     * `PlayerCombat#look`): made by `load` only when the player's kit is the swordmaster's. Null
     * everywhere else (the traveler's kit has none).
     * @type {import('./SwordmasterFx.js').SwordStage|null}
     */
    this.sword = null;
    /**
     * The bellwarden's look (src/game/combat/BellwardenFx.js `BellStage`; EVERMERE_CAMPAIGN.md §6.5):
     * made by `load` only when the player's kit is the bellwarden's. Null everywhere else.
     * @type {import('./BellwardenFx.js').BellStage|null}
     */
    this.bell = null;
    /**
     * The player's kit's own module (src/game/combat/kits/<kit>.js, a lazy chunk: the bellwarden's),
     * imported by `load` with the looks; null for the traveler and the swordmaster.
     * @type {typeof import('./kits/bellwarden.js')|null}
     */
    this.kitModule = null;
    /**
     * Every look stage made (`ice`, `holy`, `earth`, `sword`, `bell`, in that order): each is warmed with the
     * combat (`warmup` / `endWarmup`), updated once a frame after the members (`update`; hushed while
     * the combat does not run), gives its VFX lights back on an encounter's reset (`dropLights`)
     * and goes with the combat (`dispose`).
     * @type {LookStage[]}
     */
    this.looks = [];
    /** No enemy hit reaches a companion (the `allyGod` test hook). */
    this.allyGod = false;
    /** Path searches the companions may still run in this sub-step (one per sub-step for all). */
    this.allySearches = 0;
    /**
     * The level's sky dragons (`skyDragon` objects, present or not; DRAGON_CAMPAIGN.md §6.5): made
     * by `load`, driven every frame combat runs and in the ambient step.
     * @type {SkyDragon[]}
     */
    this.skyDragons = [];
    /**
     * Fallen foes come back at a waystone rest (`environment.respawn` not false;
     * DRAGON_CAMPAIGN.md §5.2): `resetEncounter({ full: true })`.
     */
    this.respawn = this.env.respawn !== false;
    /**
     * A set-piece level of Vanquish the Evil Dragon (COMBAT.md §29 V1; `load`): a sky dragon, an
     * enemy group of a set-piece kind (`ENEMY_INFO[k].setpiece`), a besieging or a swarming group.
     * Only there does a story scene run the **ambient step** — every other level (Cinderwatch Pass's
     * talk scripts) freezes combat in a scene as before.
     */
    this.setpiece = false;
    /** This frame's step is the ambient step (from `update` to the end of `afterPlayer`). */
    this._ambient = false;
    /** The last frame ran the ambient step (`applyLook`, `state().ambient`). */
    this.ambientFrame = false;
    /**
     * Every boss of the level (one per boss group, level order). `_boss` is the one whose fight runs
     * or ran last (the first until a fight starts).
     * @type {Enemy[]}
     */
    this._bosses = [];
    /**
     * Bosses whose intro starts at the next step, active or ambient (`def.introOnSpawn`: present at
     * load, or their group came back through the story).
     * @type {Enemy[]}
     */
    this._introPending = [];
    /**
     * Swarm groups that wake at the next active step (present at load, or come through the story).
     * @type {LevelObjectOf<'enemy'>[]}
     */
    this._swarmPending = [];
    /** A boss that woke (`bossAwake`) in the ambient step: its bar and framing at the next active frame. @type {Enemy|null} */
    this._awakePending = null;
    /**
     * The arena of a boss fight that began with the player outside it (an intro on appearing): it
     * closes when the player walks in. @type {BossArena|null}
     */
    this._closePending = null;
    /** The companions go into the arena at the next active frame (it closed in a scene). @type {BossArena|null} */
    this._pullPending = null;
    /**
     * Wards over the party (`ward`): damage × (1 − the strongest `frac`) while its `t` lasts.
     * @type {{ frac: number, t: number }[]}
     */
    this._wards = [];
    // ---- The Bells of Evermere (COMBAT.md §30) ----
    /**
     * The resonance marks' look over a foe (§30.4): the Evermere pack's core part (`ev`) draws
     * `marks` quads of it in a row over each marked foe; a hero's look may restyle it, or set null
     * and draw its own from `e.marks`.
     * @type {MarksLook|null}
     */
    this.marksLook = { frame: 'partyWardRing', color: [1.25, 0.85, 0.3], scale: 0.3, lift: 0.45, spacing: 0.42 };
    /**
     * The Evermere pack's core part (src/game/combat/packs/evermere/core.js `EvCore`, one of the
     * `systems`): the pulse and its rings, the marks drawn — on a level with the pack; null elsewhere.
     * @type {import('./packs/evermere/core.js').EvCore|null}
     */
    this.ev = null;
    /** Releases asked by brains this sub-step (`ctx.release`): run after the enemy updates. @type {Enemy[]} */
    this._releaseAsk = [];
    /**
     * Warmth the combat holds (§30.8: the bellwarden's Toll bell — `addWarmth`): live discs read by
     * `warmthZones()` with the world's lit braziers.
     * @type {WarmthZone[]}
     */
    this._warmth = [];
    /** The packs' level systems made by `load` (`registerSystem`, §30.1). @type {CombatPackSystem[]} */
    this.systems = [];
    this._ambientCheckT = 0;
    /** Scratch: the foes one hitbox hit in this sub-step (`_resolve`: a crowd's soft flashes). @type {Enemy[]} */
    this._crowd = [];
    /** Gold collected since the feed's last gold line (`_goldFeedStep`), the quiet left, its age. */
    this._goldFeed = 0;
    this._goldFeedT = 0;
    this._goldFeedAge = 0;
    /** Scratch: the camera's look-at point on the ground (the ambient step's wake range). */
    this._focus = { x: 0, z: 0 };
    this._ready = false;
  }

  /** Whether `load` has finished (Game's `state()` reports the combat state only then). */
  get loaded() {
    return this._ready;
  }

  /**
   * A party member fights beside the player on this level (Party.join / attachLevel; PARTY.md
   * §5.1): its MemberCombat, also set as `member.combat`. Again for the same member: the one it
   * has. Its sheet's texture is uploaded now (a join mid-game: not in a frame's draw; before the
   * warm-up, `warmup` uploads it again harmlessly). Null before `load`.
   * @param {PartyMember} member
   * @returns {MemberCombat|null}
   */
  addAlly(member) {
    if (!member || !this._ready) return null;
    const have = this.allies.find((a) => a.member === member);
    if (have) {
      member.combat = have;
      return have;
    }
    const a = new MemberCombat(this, member);
    this.allies.push(a);
    member.combat = a;
    try {
      const tex = member.sprite?.sheet?.texture;
      if (tex) this.engine.renderer.initTexture(tex);
    } catch { /* not a texture */ }
    return a;
  }

  /**
   * A member leaves the fight (it left the party, the level goes): the foes after it turn back to
   * the player, its shots in flight go, its sprite's look is plain again.
   * @param {PartyMember} member
   */
  removeAlly(member) {
    if (!member) return;
    const i = this.allies.findIndex((a) => a.member === member);
    if (i < 0) {
      if (member.combat && !this.allies.includes(/** @type {MemberCombat} */ (member.combat))) member.combat = null;
      return;
    }
    const a = this.allies[i];
    this.allies.splice(i, 1);
    for (const e of this.enemies) if (e.target === a) { e.target = null; e.tauntT = 0; }
    this.projectiles?.removeOwner(a);
    a.release();
    member.combat = null;
  }

  /**
   * The story's `heal` (and the `healAllies` hook): every companion full and up again.
   * @returns {number} the companions refilled
   */
  healAllies() {
    for (const a of this.allies) a.refill();
    return this.allies.length;
  }

  /** The boss whose fight runs (intro to defeat), or null. */
  get bossFight() { return this._bossFight; }

  /** The closed boss arena (the player is sealed in with its boss), or null. @returns {BossArena|null} */
  sealedArena() {
    for (let i = 0; i < this.arenas.length; i++) if (this.arenas[i].active) return this.arenas[i];
    return null;
  }

  /**
   * Is a fight on for the companions now (PARTY.md §11 PC27)? The combat is `engaged` and the boss
   * fight runs, the combat clock is held or slowed (a hit-stop, a slow motion: the members stand
   * still with the foes), or an awake foe is still aggroed — anywhere (how far is the linger's
   * business). Unlike `engaged`, which lingers `ENGAGE.linger` s of free play after the last foe
   * within `ENGAGE.range` (music, look, HUD, the rest and shop refusals), it is false the moment
   * the last foe of the fight dies, walks home or is taken away by the story — read live, so a
   * hook's kill or the story taking a foe away between frames counts at once. A teleport changes
   * nothing here: a foe still aggroed anywhere keeps the fight on until it gives up or the linger
   * ends. Pure. Only `MemberCombat` reads it: a combat without a companion never calls it.
   * @returns {boolean}
   */
  fightOn() {
    if (!this.engaged) return false;
    if (this._bossFight || this.stop > 0 || this._slow > 0) return true;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // (_engagement's filter, without its range)
      if (e.alive && e.aggro && !e.passive && !e.dormant && e.sprite.visible) return true;
    }
    return false;
  }

  /** Does a live foe have this companion as its target? @param {MemberCombat} a */
  isTargeted(a) {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) if (list[i].target === a && list[i].alive) return true;
    return false;
  }

  /** How many live foes target this companion. @param {MemberCombat} a */
  targetedBy(a) {
    let n = 0;
    for (const e of this.enemies) if (e.target === a && e.alive) n++;
    return n;
  }

  // =============================================================================================
  // Load
  // =============================================================================================

  /** Everything of COMBAT.md §4.5: sheets, atlas, batches, enemies, UI, bindings, checkpoints. */
  async load() {
    const t0 = performance.now();
    const { scene, tileMap: tm, level } = this;
    // the lazy enemy packs of the kinds the level uses (./packs/index.js; EVERMERE_CAMPAIGN.md §6.4):
    // their defs, brains, sheet painters, FX frames and presets registered before anything below
    // reads them — a level of the shipped kinds needs none (and waits on nothing)
    const packs = packsFor(level);
    if (packs.length) await loadEnemyPacks(packs, COMBAT_PACK_API);
    // the combat packages' particle presets (engine/fx/presets/combat.js; this chunk's own): before
    // anything bursts one, the warm-up priming them included
    registerCombatPresets();

    // ---- art ----
    const groups = level.objects.filter((o) => o.type === 'enemy');
    const kinds = new Set(groups.map((g) => g.kind));
    // a set piece (§29 V1): its world goes on in a story scene
    this.setpiece = level.objects.some((o) => o.type === 'skyDragon')
      || groups.some((g) => (isOwnKey(ENEMY_INFO, g.kind) && !!ENEMY_INFO[g.kind].setpiece) || g.swarm === true || Array.isArray(g.besiege));
    // (a boss's pool of adds: its def's `adds` kind — the golem's bats — or list; bossAdds)
    for (const k of [...kinds]) {
      const adds = isOwnKey(ENEMY_DEFS, k) ? bossAdds(ENEMY_DEFS[/** @type {EnemyKind} */ (k)]) : [];
      for (const s of adds) kinds.add(s.kind);
    }
    /** @type {Map<string, EnemySheet>} kind → EnemySheet (shared by every sprite of the kind) */
    this.sheets = new Map();
    for (const k of kinds) {
      try { this.sheets.set(k, createEnemySheet(/** @type {EnemyKind} */ (k))); } catch (err) { console.warn(`[combat] no sheet for "${k}":`, err); }
    }
    // the bellwarden's FX frames (generation 3; EVERMERE_CAMPAIGN.md §6.5): her look's chunk puts
    // them in before the atlas is built (once a page)
    if (this.game?.playerKit === 'bellwarden') (await import('./BellwardenFx.js')).registerBellFrames(COMBAT_PACK_API);
    this.atlas = createFxAtlas();
    this.atlasFrames = this.atlas.frames;
    this.quads = new FxQuads({ atlas: this.atlas, capacity: QUAD_CAPACITY });
    scene.add(this.quads.object);
    // (a pack's marker styles go into the batch's shader: §30.6)
    for (const m of packMarkerStyles(packs)) registerMarkerStyles(m.ids, m.glsl);
    this.markers = new GroundMarkers({
      capacity: MARKER_SLOTS,
      heightField: { sample: (x, z) => tm.getHeight(x, z), minX: 0, minZ: 0, maxX: tm.width, maxZ: tm.depth },
    });
    scene.add(this.markers.object);
    /** @type {MarkerSlot[]} */
    this._mk = [];
    for (let i = 0; i < MARKER_SLOTS; i++) this._mk.push({ h: -1, owner: null, gen: 0, spec: { ...MARKER_DEFAULTS } });
    this._markerSpec = { ...MARKER_DEFAULTS };

    // ---- runtime pieces ----
    this.fx = new CombatFx(this.quads, this.atlas);
    this.tags = new TagRegistry();
    this.playerHits = new HitQueue(16);
    this.enemyHits = new HitQueue(32);
    /** The companions' hitboxes of the sub-step (owner: the MemberCombat; resolved after the player's). */
    this.allyHits = new HitQueue(8);
    /** @type {ProjectileContact[]} pooled; the first `_contactN` are this sub-step's */
    this._contacts = [];
    this._contactN = 0;
    this.projectiles = new Projectiles(this);
    this.pickups = new Pickups(this);
    this.cin = new CombatInput(this.input);
    this.look = new CombatLook(this.postfx);
    // (the environment as it stands: a level's states may change its soundtrack — EVERMERE_CAMPAIGN.md §7.4)
    this.music = new CombatMusic(this.audio, () => this.game.envNow ?? this.env);
    /** @type {PlayerView} the player as enemies see it (`ctx.player`, §9.2) */
    this._pv = {
      position: this.player.position, radius: 0.3, body: [0, 1.8], facing: { x: 0, z: 1 }, velocity: { x: 0, z: 0 },
      alive: true, invulnerable: false, dodging: false, action: null, swing: 0, sealed: false,
    };
    this._prevPos = new THREE.Vector3().copy(this.player.position);
    this.ctx = this._makeContext();
    // the heroes' looks, each only where its hero can fight (its chunk, its programs and draw
    // calls): a member of the party of that class, a villager with its weapon, a story line that
    // joins one as it (`classMayFight`); the swordmaster's where the player's kit is its. Made
    // before the player's kit and the members, which take their directors from them.
    const game = this.game;
    const story = game?.campaign?.story;
    const records = game?.party?.records ?? game?.story?.state?.party;
    const bellwarden = game?.playerKit === 'bellwarden';
    const [iceMod, holyMod, earthMod, swordMod, bellMod, kitMod] = await Promise.all([
      classMayFight('icemage', level, story, records) ? import('../party/IceSpellFx.js') : null,
      classMayFight('cleric', level, story, records) ? import('../party/HolySpellFx.js') : null,
      classMayFight('greatshield', level, story, records) ? import('../party/EarthSpellFx.js') : null,
      game?.playerKit === 'swordmaster' ? import('./SwordmasterFx.js') : null,
      // the bellwarden's look and kit (EVERMERE_CAMPAIGN.md §6.5): each a chunk of its own
      bellwarden ? import('./BellwardenFx.js') : null,
      bellwarden ? import('./kits/bellwarden.js') : null,
    ]);
    if (iceMod) this.ice = new iceMod.IceStage(this);
    if (holyMod) this.holy = new holyMod.HolyStage(this);
    if (earthMod) this.earth = new earthMod.EarthStage(this);
    if (swordMod) this.sword = new swordMod.SwordStage(this);
    if (bellMod) this.bell = new bellMod.BellStage(this);
    this.kitModule = kitMod;
    this.looks = [this.ice, this.holy, this.earth, this.sword, this.bell].filter((l) => l !== null);
    this._ndc = { x: 0, y: 0, on: false };
    this._vpe = new Float32Array(16);
    this._cacheViewProjection();

    // ---- UI, bindings ----
    // the combat's words (docs/specs/I18N.md §2): registered before the UI that shows them
    registerStrings('combat', COMBAT_STRINGS);
    /** @type {WeakMap<Enemy, string>} each enemy's name as shown (`displayName`) */
    this._shownNames = new WeakMap();
    UI.useCombatUI(COMBAT_UI);
    this.ui.enableCombat();
    // (put back by dispose: a campaign may travel on to a peaceful level)
    this._savedBindings = this.input.saveBindings();
    this.input.addBindings(COMBAT_BINDINGS);
    this.input.enableMouseButtons?.(this.engine.renderer.domElement);

    // ---- zones: the level's regions, first match (the location plate's rule, `minY` included) ----
    this.zones = level.objects.filter((o) => o.type === 'region' && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(o[k])))
      .map((o) => ({ id: o.id, minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ, minY: Number.isFinite(o.minY) ? o.minY : null }));

    // ---- enemies (level object order, then index), adds last ----
    /** @type {BossArena[]} one per boss group */
    this.arenas = [];
    for (const g of groups) this._spawnGroup(g);
    this._bosses = this.enemies.filter((e) => e.boss);
    for (const boss of this._bosses) this._createAdds(boss);
    this._armSetPieces();

    // ---- the enemies' walk grid (paths up stairs, around rocks, home; the arenas are closed) ----
    const tn = performance.now();
    this.nav = new Nav(tm, { blocked: (x, z) => this._inArena(x, z) });
    this.nav.buildMs = Math.round((performance.now() - tn) * 10) / 10;
    this.nav.warm();
    this.ctx.nav = this.nav;

    // ---- player kit, targeting, checkpoints, chests ----
    this.pc = new PlayerCombat(this);
    this.targeting = new Targeting(this);
    this.waystones = new Waystones(this);
    this.chests = new Chests(this);
    this.waystones.bind(this.world.interactables);
    this.chests.bind(this.world.interactables);
    // the story's conditions on them (`applyPresence`): only the objects that carry one are read
    /** @type {LevelObjectOf<'enemy'>[]} */
    this._storyGroups = [...this._members.keys()].filter((g) => hasStoryCondition(g));
    this._storyChests = this.chests.list.filter((c) => hasStoryCondition(c.obj));
    this._storyStones = this.waystones.list.filter((w) => w.obj && hasStoryCondition(w.obj));

    // ---- the sky dragons (DRAGON_CAMPAIGN.md §6.5): one per `skyDragon` object, present or not —
    // at most `MAX_SKY_DRAGONS` (each is a draw call, its terrain drape and up to 60 FX quads: level
    // data is untrusted), the first in level order ----
    const sky = skyDragonObjects(level.objects);
    if (sky.left) console.warn(`[combat] ${sky.left} sky dragon(s) beyond the first ${MAX_SKY_DRAGONS} are left out`);
    for (const o of sky.kept) {
      this.skyDragons.push(new SkyDragon({ sys: this, obj: o, seed: hashString(typeof o.id === 'string' ? o.id : '') >>> 0 }));
    }

    // ---- the caldera ember emitter per arena (created disabled; the boss's phase 2 enables it) —
    // or its def's own (`arena.emitter`, §30.2: a preset with overrides, null: none) ----
    this._emitters = this.arenas.map((a) => {
      const r = a.rect;
      const em = a.emitter;
      if (!em) return null;
      const bounds = { center: new THREE.Vector3(a.center.x, a.y + 1.6, a.center.z), size: new THREE.Vector3(r.maxX - r.minX, 3.2, r.maxZ - r.minZ) };
      if (typeof em === 'string') return this.particles.createEmitter({ preset: /** @type {any} */ (em), bounds, count: 90, enabled: false });
      return this.particles.createEmitter({ count: 90, ...em, preset: /** @type {any} */ (em.preset), bounds, enabled: false });
    });

    // ---- the packs' level systems (§30.1: the Hush Bell's toll where a black bell stands) ----
    for (const make of packSystems(packs)) {
      const s = make(this);
      if (s) this.systems.push(s);
    }

    this.hooks = makeHooks(this);
    this.loadMs = Math.round(performance.now() - t0);
    this._ready = true;
  }

  /**
   * The set pieces that start at the first step (load, the reset hook; §29 V3, V4): every boss with
   * an intro on appearing and every swarm group — after the story's presence was applied (the
   * level's attach): an absent group waits for its coming (`_setGroupPresent`).
   */
  _armSetPieces() {
    this._introPending.length = 0;
    this._swarmPending.length = 0;
    for (const b of this._bosses) if (b.def.introOnSpawn) this._introPending.push(b);
    for (const g of this._members.keys()) if (g.swarm === true) this._swarmPending.push(g);
  }

  /**
   * Create the enemies of one level `enemy` object.
   * @param {LevelObjectOf<'enemy'>} g
   */
  _spawnGroup(g) {
    // (a kind without an enemy sheet — not an ENEMY_KINDS entry — returns below)
    const kind = /** @type {EnemyKind} */ (g.kind);
    const sheet = this.sheets.get(kind);
    if (!sheet) return;
    const def = scaledDef(kind, g.level ?? 1, !!g.elite);
    const tm = this.tileMap;
    /** @type {(x: number, z: number) => boolean} */
    const walk = def.flier
      ? (x, z) => tm.isWalkable(x, z) || tm.getWaterSurface(x, z) !== null
      : (x, z) => this.standable(x, z);
    const spots = enemyStartPoints(g, walk);
    const arena = def.boss ? new BossArena(g, this, def.arena ?? null) : null;
    if (arena) this.arenas.push(arena);
    spots.forEach(([x, z], index) => {
      const e = this._createEnemy({
        uid: `${g.id}#${index}`, group: g, index, kind, level: def.level, elite: !!g.elite,
        name: g.name || (g.elite ? `Elite ${def.name}` : def.name), home: { x, z }, def, sheet, arena, isAdd: false,
      });
      if (e.boss) this._boss ??= e;
    });
  }

  /** @param {Omit<EnemyInit, 'sprite'|'rng'|'tagSlot'>} init @returns {Enemy} */
  _createEnemy(init) {
    const sprite = new Sprite3D(init.sheet, { ...CHARACTER_SPRITE_OPTS, ...init.sheet.spriteOptions, combatFx: true });
    sprite.position.set(init.home.x, this.groundAt(init.home.x, init.home.z), init.home.z);
    const e = createEnemy({ ...init, sprite, rng: new RNG((hashString(init.uid) ^ this.seedValue) >>> 0), tagSlot: this.enemies.length + 1 });
    // (a swarm has no zone: it rushes the party wherever it is, §29 V4)
    if (!init.isAdd && !e.boss && init.group && !e.swarm) {
      // the zone of its group's centre (COMBAT-19: wake, sight aggro and leash stay in the zone);
      // the rect grows to hold the whole home disc (a pack at a region's edge)
      const gx = Number(init.group.x);
      const gz = Number(init.group.z);
      e.zone = this.zoneAt(gx, gz, this.groundAt(gx, gz));
      if (e.zone >= 0) {
        const r = this.zones[e.zone];
        const R = e.homeRadius;
        e.zoneRect = { minX: Math.min(r.minX, gx - R), maxX: Math.max(r.maxX, gx + R), minZ: Math.min(r.minZ, gz - R), maxZ: Math.max(r.maxZ, gz + R) };
      }
    }
    this.scene.add(sprite);
    this.spriteManager.add(sprite);
    this.actorSprites.push(sprite);
    this.enemies.push(e);
    this._groupOf.set(e, init.group);
    if (!init.isAdd && init.group) {
      const g = /** @type {LevelObjectOf<'enemy'>} */ (init.group);
      const list = this._members.get(g);
      if (list) list.push(e);
      else this._members.set(g, [e]);
    }
    e._barT = -Infinity;
    return e;
  }

  /**
   * The boss's pool of adds (`bossAdds`: 6 level-5 foes of its def's `adds` kind — the golem's bats
   * —, or each entry's of a list; no XP, no loot, never return), hidden until spawnAdd. Uids
   * `<boss>:add#<n>`, n counting on through the entries.
   * @param {Enemy} boss
   */
  _createAdds(boss) {
    const specs = bossAdds(boss.def);
    if (!specs.length) return;
    const a = boss.arena;
    const list = [];
    let i = 0;
    for (const spec of specs) {
      const sheet = this.sheets.get(spec.kind);
      if (!sheet) continue;
      const def = scaledDef(spec.kind, spec.level, false);
      for (let k = 0; k < spec.count; k++, i++) {
        const home = a ? { x: a.center.x, z: a.center.z } : { x: boss.home.x, z: boss.home.z };
        const e = this._createEnemy({
          uid: `${boss.uid}:add#${i}`, group: this._groupOf.get(boss), index: i, kind: spec.kind, level: spec.level, elite: false,
          name: def.name, home, def, sheet, arena: null, isAdd: true,
        });
        e._boss = boss;
        this._hideAdd(e);
        list.push(e);
      }
    }
    if (list.length) this._addsOf.set(boss, list);
  }

  /**
   * Out of play: a pooled add not spawned, or a foe of a group the story has taken away.
   * @param {Enemy} e
   */
  _hideAdd(e) {
    e.sleep();
    e.aggro = false;
    e.sprite.opacity = 0;
    e.sprite.visible = false;
    this._hidden.add(e);
  }

  // =============================================================================================
  // UI and maps
  // =============================================================================================

  /**
   * (Re)build the enemies' walk grid from the tile map as it is now: objects the story brought or
   * took away (StoryRunner.applyPresence) — a bridge, a wall of crates — are walked around. With a
   * `rect` (world units: the union of the colliders and walk surfaces that changed, as
   * `World.applyStory` returns it) only the cells a change there can reach are recomputed
   * (`Nav.buildRect`: the same grid as a full build, a fraction of a millisecond for a bridge);
   * without one, the whole grid.
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }|null} [rect]
   */
  rebuildNav(rect = null) {
    if (!this.nav) return;
    if (rect) this.nav.buildRect(rect.minX, rect.maxX, rect.minZ, rect.maxZ);
    else this.nav.build((x, z) => this._inArena(x, z));
  }

  /**
   * The walk grid's closed ground: inside an arena (grown 0.5 u, the other enemies' exclusion, §7.6)
   * whose boss's group is there.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  _inArena(x, z) {
    for (const a of this.arenas) if (a.present && a.containsGrown(x, z, 0.5)) return true;
    return false;
  }

  /** Legend, vitals, skill slots (after `ui.hud.setControls(CONTROLS)`). */
  setupUI() {
    const hud = this.ui.combat?.hud;
    this._showLegend();
    // (the kit's slots, the names translated by their `str`: rules.js stays English; `unlock`: a
    // locked slot's plate)
    const skills = this.pc.skills;
    hud?.configureSkills([
      ...skills.map((K) => ({ id: K.id, label: t(`combat.skill.${K.str}`), keys: K.keys, icon: K.icon, unlock: K.unlock })),
      { id: 'draught', label: t('combat.skill.draught'), keys: 'C/4', icon: 'draught' },
    ]);
    this._skillArgs = [0, 1, 2, 3].map(() => ({ cooldown: 0, seconds: 0, left: 0, locked: false, affordable: true }));
    // a click on a slot casts it (a press through the combat input: buffer, guards, refusals)
    if (hud) hud.onSlotPress = (i) => this.cin.press(i < skills.length ? skills[i].id : 'draught');
    this._vitals = { hp: 0, hpMax: 0, mp: 0, mpMax: 0, sp: 0, spMax: 0, level: 1, xp: 0, xpNext: 1, winded: false };
    this._updateHud(0);
  }

  /**
   * End of `Game._setupMaps`: the minimap's enemy dots, chest markers only once discovered, the
   * boss marker at each undefeated arena.
   * @param {{ markers: { x: number, z: number, kind: string }[], enemies?: PointXZ[] }} map the
   *   shared minimap / world-map state
   */
  attachMaps(map) {
    this._map = map;
    map.enemies = this.minimapEnemies;
    for (let i = map.markers.length - 1; i >= 0; i--) if (map.markers[i].kind === 'chest') map.markers.splice(i, 1);
    this.chests.markers = map.markers;
    for (const c of this.chests.list) if (c.discovered) map.markers.push(c.marker);
    for (const a of this.arenas) {
      const m = { x: a.center.x, z: a.center.z, kind: 'boss', arena: a };
      // (the maps skip a hidden marker: an arena whose group the story took away)
      Object.defineProperty(m, 'hidden', { get: () => !a.present, enumerable: true });
      this._bossMarkers.push(m);
      map.markers.push(m);
    }
  }

  // =============================================================================================
  // Warm-up (§19)
  // =============================================================================================

  /**
   * Before `Game._compileScene()`: upload every combat texture, one FxQuads / GroundMarkers
   * instance far below the world (kept through the warm frames), one particle of every burst.
   * @param {THREE.Vector3} far
   */
  warmup(far) {
    const r = this.engine.renderer;
    /** @type {(t: THREE.Texture|null|undefined) => void} */
    const init = (t) => { try { if (t) r.initTexture(t); } catch { /* not a texture */ } };
    for (const s of this.sheets.values()) init(s.texture);
    init(this.player.sheet?.texture);
    // the companions already here (a level built with the party: travel, a kept level)
    for (const a of this.allies) init(a.member.sprite?.sheet?.texture);
    init(this.atlas.texture);
    init(this.markers.heightTexture);
    this._warmQuad = this.quads.alloc();
    if (this._warmQuad >= 0) this.quads.set(this._warmQuad, { x: far.x, y: far.y, z: far.z, frame: 'impact', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1 });
    this._warmMarker = this.markers.alloc();
    if (this._warmMarker >= 0) this.markers.set(this._warmMarker, { ...MARKER_DEFAULTS, x: far.x, y: far.y, z: far.z, progress: 0.5 });
    this.quads.object.frustumCulled = false;
    this.markers.object.frustumCulled = false;
    this.quads.update();
    this.markers.update();
    const before = new Set(this.particles.burstPools());
    for (const p of ['hitSpark', 'emberBurst', 'deathPoof', 'gooPoof', 'healGlow', 'magicBurst', 'sparkle', 'splash', 'footstep', 'victoryEmbers', 'victorySparkle', 'levelSparkle']) {
      this.particles.burst(p, far, 1);
    }
    // the sky dragons' meshes, materials and bursts (DRAGON_CAMPAIGN.md §6.5)
    for (const d of this.skyDragons) d.warmup(far);
    // the heroes' looks: the ice mage's crystals, ground frost and halo … (far below the world)
    for (const l of this.looks) l.warmup(far);
    // the packs' level systems (§30.1)
    for (const s of this.systems) s.warmup?.(far);
    // the pools only combat made (the game's warm-up made the level's own before): `dispose` frees them
    this._ownPools = this.particles.burstPools().filter((p) => !before.has(p));
  }

  /** After the warm frames: free the warm instances, record the program count. */
  endWarmup() {
    if (this._warmQuad >= 0) this.quads.free(this._warmQuad);
    if (this._warmMarker >= 0) this.markers.free(this._warmMarker);
    this._warmQuad = -1;
    this._warmMarker = -1;
    for (const l of this.looks) l.endWarmup();
    for (const s of this.systems) s.endWarmup?.();
    this.quads.update();
    this.markers.update();
    this.programsAtLoad = this.engine.renderer.info.programs?.length ?? 0;
  }

  // =============================================================================================
  // The combat context (§9.2)
  // =============================================================================================

  /** The one context every enemy update receives (types: ./types.d.ts). @returns {CombatContext} */
  _makeContext() {
    const sys = this;
    return {
      time: 0,
      frame: 0,
      player: this._pv,
      tileMap: this.tileMap,
      moveGround: (e, dx, dz) => sys._moveGround(e, dx, dz),
      moveFly: (e, dx, dz) => sys._moveFly(e, dx, dz),
      groundAt: (x, z) => sys.tileMap.getHeight(x, z),
      walkable: (x, z) => sys.standable(x, z),
      los: (ax, az, bx, bz) => sys.los(ax, az, bx, bz),
      onScreen: (x, y, z) => sys.projectNdc(x, y, z, sys._ndc, 0.92),
      requestToken: (e) => sys._requestToken(e),
      releaseToken: (e) => sys._releaseToken(e),
      hitbox: (e, spec) => { sys.enemyHits.add(e, spec); },
      projectile: (e, spec) => sys.spawnProjectile(e, spec),
      marker: (spec) => sys._markerAlloc(sys._cur, spec),
      setMarker: (h, spec) => sys._markerSet(h, spec),
      freeMarker: (h) => sys._markerFree(h),
      fx: (name, x, y, z, opts) => sys.fx.play(name, x, y, z, opts),
      burst: (preset, x, y, z, count, opts) => sys.burst(preset, x, y, z, count, opts),
      sfx: (name, x, z, opts) => sys.sfxAt(name, x, z, opts),
      shake: (amp, dur) => sys.shake(amp, dur),
      heal: (target, amount) => sys._healEnemy(target, amount),
      alert: (e) => sys.ui.combat?.labels.alert(e.position, sys.labelY(e)),
      wakeGroup: (e) => sys._wakeGroup(e),
      /** The walk grid (Nav.js; set once the enemies are created): paths for chase and return. */
      nav: null,
      enemiesNear: (x, z, r, out) => sys._enemiesNear(x, z, r, out),
      // (the casts allow the one extra argument each, see SpawnAddCall / OnSignalCall)
      spawnAdd: (kind, x, z, level) => /** @type {SpawnAddCall} */ (sys._spawnAdd)(sys._cur, kind, x, z, level),
      emit: (event, e, a, b) => /** @type {OnSignalCall} */ (sys._onSignal)(event, e, a, b),
      // the ambient step (§29 V2; set for its sub-steps)
      ambient: false,
      // The Bells of Evermere (COMBAT.md §30)
      release: (e) => sys._askRelease(e),
      consumeMarks: (e) => sys.consumeMarks(e),
      submerge: (e) => sys.submerge(e),
      surface: (e, x, z) => sys.surface(e, x, z),
      pulse: (spec) => sys.pulse(spec),
      get bells() { return sys.world?.bells ?? NO_BELLS; },
      warmthZones: () => sys.warmthZones(),
      setFlag: (name, value) => sys.setFlag(name, value),
    };
  }

  /**
   * Ground height.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  groundAt(x, z) {
    return this.tileMap.getHeight(x, z);
  }

  /**
   * Index of the first level region containing (x, z) — the location plate's rule (Game
   * `_updateRegion`): a region with `minY` holds only ground above that height (`y`; omitted: any)
   * — or -1: none.
   * @param {number} x
   * @param {number} z
   * @param {number|null} [y]
   * @returns {number}
   */
  zoneAt(x, z, y = null) {
    const zs = this.zones;
    if (!zs) return -1;
    for (let i = 0; i < zs.length; i++) {
      const r = zs[i];
      if (x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ && (r.minY == null || y == null || y > r.minY)) return i;
    }
    return -1;
  }

  /**
   * Standable: walkable and not water (bridges count).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  standable(x, z) {
    const tm = this.tileMap;
    if (!tm.isWalkable(x, z)) return false;
    // a walk surface (bridge deck) over water is ground; open water is not
    const t = tm.tileAt(Math.floor(x), Math.floor(z));
    return !(t && t.water) || tm.getHeight(x, z) > (t.waterSurface ?? -Infinity);
  }

  /**
   * Body-band base of an enemy (fliers: the live hover height).
   * @param {Enemy} e
   * @returns {number}
   */
  bodyBase(e) {
    return e.position.y + (e.flier ? e.hover ?? 0 : 0);
  }

  /**
   * Height (u above the feet) for the enemy's bar and '!' alert.
   * @param {Enemy} e
   * @returns {number}
   */
  labelY(e) {
    return e.def.labelY ?? 2;
  }

  /**
   * World y of an enemy's damage numbers: above its HP bar (the bar is anchored at `labelY`;
   * numbers under it ran into the bar), an elite's name plate included; the boss (no world bar)
   * just above its body.
   * @param {Enemy} e
   * @returns {number}
   */
  numberY(e) {
    if (e.boss) return this.bodyBase(e) + e.def.body[1] + 0.2;
    return e.position.y + this.labelY(e) + NUMBER_OVER_BAR + (e.elite ? 0.3 : 0);
  }

  /**
   * The hit / crit star of a player hit. Normally on the body just in front of the target; when
   * the target stands behind the player on screen (up-screen attacks, the main direction of
   * travel) the star moves to the target's head top and a little aside along the camera's right
   * axis, so it no longer crowns the player's own head (a landed hit read as being struck).
   * @param {Enemy} e
   * @param {boolean} crit
   * @param {number} dx
   * @param {number} dz
   */
  _impactStar(e, crit, dx, dz) {
    const x = e.position.x;
    const z = e.position.z;
    const hy = this.bodyBase(e);
    const top = e.def.body[1];
    let sx = x - dx * 0.2;
    let sy = hy + (top - 1.0) * 0.5;
    let sz = z - dz * 0.2;
    const m = this.engine.camera.matrixWorld.elements;
    // camera right (column 0) and forward (−column 2) on XZ
    const rx = m[0];
    const rz = m[2];
    let fx = -m[8];
    let fz = -m[10];
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const P = this.player.position;
    const ex = x - P.x;
    const ez = z - P.z;
    const depth = ex * fx + ez * fz;
    const lateral = ex * rx + ez * rz;
    const behind = depth > 0.3 && Math.abs(lateral) < 1.2;
    if (behind) {
      const side = lateral >= 0 ? 1 : -1;
      sx = x + rx * 0.6 * side;
      sz = z + rz * 0.6 * side;
      sy = hy + top + 0.4 - 1.0; // the effects add their lift (1.0)
    }
    this.fx.play(crit ? 'crit' : 'impact', sx, sy, sz, behind ? STAR_SMALL : undefined);
  }

  /**
   * Straight-shot line of sight (§7.6): from `groundAt(a) + 0.9` to `groundAt(b) + 0.9`, blocked
   * where the ground rises above the line − 0.1 or inside a static collider (samples every 0.25 u).
   * @param {number} ax
   * @param {number} az
   * @param {number} bx
   * @param {number} bz
   * @returns {boolean}
   */
  los(ax, az, bx, bz) {
    const tm = this.tileMap;
    const ya = tm.getHeight(ax, az) + SHOT_Y;
    const yb = tm.getHeight(bx, bz) + SHOT_Y;
    const dx = bx - ax;
    const dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    const cs = tm.queryColliders(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._losCs ??= []);
    for (let s = 0.25; s < d - 0.2; s += 0.25) {
      const u = s / d;
      const x = ax + dx * u;
      const z = az + dz * u;
      const y = ya + (yb - ya) * u;
      if (tm.getHeight(x, z) > y - 0.1) return false;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.dynamic) continue;
        if (c.type === 'circle') {
          const ex = x - c.x;
          const ez = z - c.z;
          if (ex * ex + ez * ez < c.r * c.r) return false;
        } else if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
      }
    }
    return true;
  }

  /** Cache the camera's view-projection (the matrix rendered last frame; §9.1). */
  _cacheViewProjection() {
    const cam = this.engine.camera;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._vpe.set(_vp.elements);
  }

  /**
   * Project a world point with the cached view-projection into `out` ({x, y} NDC).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{ x: number, y: number }} out
   * @param {number} [limit]
   * @returns {boolean} in front of the camera and within ±limit
   */
  projectNdc(x, y, z, out, limit = 1) {
    const m = this._vpe;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-6) {
      out.x = out.y = 99;
      return false;
    }
    out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return Math.abs(out.x) <= limit && Math.abs(out.y) <= limit;
  }

  /**
   * World-space move input into `out` ({x, z} unit); returns its magnitude (0..1).
   * @param {PointXZ} out
   * @returns {number}
   */
  moveWorld(out) {
    const mo = this.player.moveOverride;
    let mx;
    let mz;
    if (mo) {
      mx = mo.x;
      mz = mo.z;
    } else {
      const mv = this.input.getMoveVector();
      const { forward, right } = this.rig.getMoveBasis();
      mx = right.x * mv.x + forward.x * mv.y;
      mz = right.z * mv.x + forward.z * mv.y;
      const mag = Math.min(1, Math.hypot(mv.x, mv.y));
      const l = Math.hypot(mx, mz);
      if (l < 1e-6 || mag < 1e-3) { out.x = 0; out.z = 0; return 0; }
      out.x = mx / l;
      out.z = mz / l;
      return mag;
    }
    const l = Math.hypot(mx, mz);
    if (l < 1e-6) { out.x = 0; out.z = 0; return 0; }
    out.x = mx / l;
    out.z = mz / l;
    return Math.min(1, l);
  }

  /**
   * The mouse aim point (the `aim` hook's override first): the camera ray through the pointer on
   * the plane y = player.y + 0.8. Returns false when there is none.
   * @param {{x:number, z:number}} out
   * @returns {boolean}
   */
  aimPoint(out) {
    if (this.aimOverride) {
      out.x = this.aimOverride.x;
      out.z = this.aimOverride.z;
      return true;
    }
    const canvas = this.engine.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const pt = this.input.pointer;
    if (!rect.width || !rect.height) return false;
    _ndc2.set(((pt.x - rect.left) / rect.width) * 2 - 1, -((pt.y - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc2, this.engine.camera);
    _plane.set(_v.set(0, 1, 0), -(this.player.position.y + 0.8));
    const hit = _ray.ray.intersectPlane(_plane, _v);
    if (!hit) return false;
    out.x = hit.x;
    out.z = hit.z;
    return true;
  }

  // ---- movement (§7.6) ----

  /**
   * tileMap.move with the move radius; blockedBy; the arena exclusion for every other enemy.
   * @param {Enemy} e
   * @param {number} dx
   * @param {number} dz
   * @returns {number} the fraction moved
   */
  _moveGround(e, dx, dz) {
    const len = Math.hypot(dx, dz);
    e.blockedBy = null;
    if (len < 1e-9) return 1;
    const p = e.position;
    const out = this.tileMap.move(p, dx, dz, e.def.moveRadius ?? 0.3, 0.55, this._moveOut ??= { x: 0, z: 0 });
    let nx = out.x;
    let nz = out.z;
    const excluded = !e.boss && !e.isAdd;
    if (excluded && this.arenas.length) {
      for (const a of this.arenas) {
        if (a.present && a.containsGrown(nx, nz, 0.5) && !a.containsGrown(p.x, p.z, 0.5)) {
          // stop where the path enters the grown rect
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) / 2;
            if (a.containsGrown(p.x + (nx - p.x) * m, p.z + (nz - p.z) * m, 0.5)) hi = m; else lo = m;
          }
          nx = p.x + (nx - p.x) * lo;
          nz = p.z + (nz - p.z) * lo;
          e.blockedBy = 'arena';
        }
      }
    }
    const moved = Math.hypot(nx - p.x, nz - p.z);
    const frac = Math.min(1, moved / len);
    if (!e.blockedBy && frac < 0.999) e.blockedBy = this._blockKind(p.x, p.z, dx / len, dz / len, e.def.moveRadius ?? 0.3);
    p.x = nx;
    p.z = nz;
    return frac;
  }

  /**
   * What stopped a ground move: a static collider ahead, or terrain.
   * @param {number} x
   * @param {number} z
   * @param {number} ux
   * @param {number} uz
   * @param {number} r
   * @returns {'collider'|'terrain'}
   */
  _blockKind(x, z, ux, uz, r) {
    const tm = this.tileMap;
    const ax = x + ux * (r + 0.2);
    const az = z + uz * (r + 0.2);
    const cs = tm.queryColliders(ax - 0.3, az - 0.3, ax + 0.3, az + 0.3, this._blkCs ??= []);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.type === 'circle') {
        const ex = ax - c.x;
        const ez = az - c.z;
        const rr = c.r + 0.15;
        if (ex * ex + ez * ez < rr * rr) return 'collider';
      } else if (ax > c.minX - 0.15 && ax < c.maxX + 0.15 && az > c.minZ - 0.15 && az < c.maxZ + 0.15) return 'collider';
    }
    return 'terrain';
  }

  /**
   * Fliers: free movement clamped to home ± (radius + 8) (adds: their arena; a swarm: none), the
   * map, the arena exclusion.
   * @param {Enemy} e
   * @param {number} dx
   * @param {number} dz
   */
  _moveFly(e, dx, dz) {
    const p = e.position;
    const tm = this.tileMap;
    e.blockedBy = null;
    let nx = p.x + dx;
    let nz = p.z + dz;
    if (e.isAdd && e._boss?.arena) {
      const r = e._boss.arena.rect;
      nx = clamp(nx, r.minX + 0.5, r.maxX - 0.5);
      nz = clamp(nz, r.minZ + 0.5, r.maxZ - 0.5);
    } else if (!e.swarm) {
      // (a swarm flier is held to the map only: it rushes the party wherever it is, §29 V4)
      const R = (Number(this._groupOf.get(e)?.radius) || 3) + 8;
      nx = clamp(nx, e.home.x - R, e.home.x + R);
      nz = clamp(nz, e.home.z - R, e.home.z + R);
    }
    nx = clamp(nx, 0.3, tm.width - 0.3);
    nz = clamp(nz, 0.3, tm.depth - 0.3);
    if (!e.boss && !e.isAdd) {
      for (const a of this.arenas) {
        if (a.present && a.containsGrown(nx, nz, 0.5) && !a.containsGrown(p.x, p.z, 0.5)) {
          nx = p.x;
          nz = p.z;
          e.blockedBy = 'arena';
        }
      }
    }
    if (!e.blockedBy && (Math.abs(nx - (p.x + dx)) > 1e-6 || Math.abs(nz - (p.z + dz)) > 1e-6)) e.blockedBy = 'terrain';
    p.x = nx;
    p.z = nz;
  }

  // ---- tokens (§7.5) ----

  /** @param {Enemy} e @returns {boolean} */
  _requestToken(e) {
    const t = e.def.token;
    if (!t) return false;
    if (e.token) return true;
    // the player fights a boss inside its closed arena: nobody from outside attacks
    if (this._pv.sealed && !e.boss && !e.isAdd) return false;
    const budget = BUDGETS[t.type] ?? 0;
    if (this._tokens[t.type] + t.cost > budget) return false;
    this._tokens[t.type] += t.cost;
    e.token = true;
    return true;
  }

  /** @param {Enemy} e */
  _releaseToken(e) {
    const t = e.def.token;
    if (!t || !e.token) return;
    this._tokens[t.type] = Math.max(0, this._tokens[t.type] - t.cost);
    e.token = false;
  }

  // ---- markers: slot table with generations (a freed handle held by a brain is ignored) ----

  /**
   * @param {Enemy|'core'|null} owner
   * @param {Partial<MarkerSpec>|null} spec
   * @returns {number} handle or −1
   */
  _markerAlloc(owner, spec) {
    let slot = -1;
    for (let i = 0; i < MARKER_SLOTS; i++) if (this._mk[i].h < 0) { slot = i; break; }
    if (slot < 0) return -1;
    const h = this.markers.alloc();
    if (h < 0) return -1;
    const m = this._mk[slot];
    m.h = h;
    m.owner = owner ?? null;
    m.gen = (m.gen + 1) & 0x3ffff;
    const s = m.spec;
    for (let k = 0; k < MARKER_KEYS.length; k++) s[MARKER_KEYS[k]] = MARKER_DEFAULTS[MARKER_KEYS[k]];
    this._markerCopy(s, spec);
    this.markers.set(h, s);
    return m.gen * 64 + slot;
  }

  /** @param {number} id @returns {MarkerSlot|null} */
  _markerSlot(id) {
    if (!(id >= 0)) return null;
    const m = this._mk[id % 64];
    if (!m || m.h < 0 || m.gen !== Math.floor(id / 64)) return null;
    return m;
  }

  /** @param {Required<MarkerSpec>} s @param {Partial<MarkerSpec>|null} spec */
  _markerCopy(s, spec) {
    if (!spec) return;
    for (let k = 0; k < MARKER_KEYS.length; k++) {
      const key = MARKER_KEYS[k];
      const v = spec[key];
      if (v !== undefined) s[key] = v;
    }
  }

  /** @param {number} id @param {Partial<MarkerSpec>} spec */
  _markerSet(id, spec) {
    const m = this._markerSlot(id);
    if (!m) return;
    this._markerCopy(m.spec, spec);
    this.markers.set(m.h, m.spec);
  }

  /** @param {number} id */
  _markerFree(id) {
    const m = this._markerSlot(id);
    if (!m) return;
    this.markers.free(m.h);
    m.h = -1;
    m.owner = null;
  }

  /**
   * Free every marker of `owner` (an enemy sent home) or, with null, every enemy marker.
   * @param {Enemy|null} owner
   */
  _freeMarkersOf(owner) {
    for (const m of this._mk) {
      if (m.h < 0 || m.owner === 'core') continue;
      // (cast: TS narrowed 'core' away above, which makes the null case's re-test always true)
      if (owner === null ? /** @type {MarkerSlot['owner']} */ (m.owner) !== 'core' : m.owner === owner) {
        this.markers.free(m.h);
        m.h = -1;
        m.owner = null;
      }
    }
  }

  /**
   * Core-owned markers (lock ring, nova ring, the arena barrier).
   * @returns {number}
   */
  markerAllocCore() { return this._markerAlloc('core', null); }
  /** @param {number} id @param {Partial<MarkerSpec>} spec */
  markerSetCore(id, spec) { this._markerSet(id, spec); }
  /** @param {number} id */
  markerFreeCore(id) { this._markerFree(id); }

  /**
   * A ground marker for a combat actor that is no enemy (a sky dragon: DRAGON_CAMPAIGN.md §6.5) —
   * the enemies' `ctx.marker` API, owned by core (a death reset leaves it: its owner frees it).
   * @param {Partial<MarkerSpec>} spec
   * @returns {number} handle or −1
   */
  marker(spec) { return this._markerAlloc('core', spec); }
  /** @param {number} id @param {Partial<MarkerSpec>} spec */
  setMarker(id, spec) { this._markerSet(id, spec); }
  /** @param {number} id */
  freeMarker(id) { this._markerFree(id); }

  // ---- hits from no enemy, status on the party (DRAGON_CAMPAIGN.md §6.4) ----

  /**
   * One enemy-side area hit resolved now against the player and every companion (a sky dragon's
   * fireball, §6.5): the shapes of an enemy hitbox (`hitOverlaps`; `y` the ground at x, z when
   * absent; `dy` 0.6), and the rules of one — god mode and i-frames (a dodge through it counts as a
   * perfect dodge unless it is `flat`), knockdown, knockback away from (`fromX`, `fromZ`, else the
   * origin), the companions' i-frames — through `_hitPlayer` / `_hitAlly` with an owner whose ATK is
   * `atk` (0 when absent: `mv` then deals the minimum, 1; `flat` > 0 deals that flat damage). A
   * `tag` (≠ 0) hits each target once while the tag lives (a hit spread over sub-steps).
   * @param {StrikeSpec} spec
   * @returns {StrikeResult} who was hit
   */
  strike(spec) {
    /** @type {StrikeResult} */
    const out = { player: false, allies: 0 };
    // (a story scene hurts no one: the ambient step's fireballs fall harmlessly, §29 V2)
    if (!this._ready || !spec || this._ambient) return out;
    const x = Number(spec.x);
    const z = Number(spec.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return out;
    /** @type {HitSpec} */
    const s = {
      shape: spec.shape ?? 'circle', x, z, y: Number.isFinite(spec.y) ? spec.y : this.groundAt(x, z),
      r: spec.r, rInner: spec.rInner, dirX: spec.dirX, dirZ: spec.dirZ, halfAngle: spec.halfAngle, len: spec.len, width: spec.width,
      dy: spec.dy, mv: spec.mv ?? 0, kb: spec.kb ?? 0, poise: spec.poise ?? 0, knockdown: !!spec.knockdown, flat: spec.flat ?? 0,
      tag: spec.tag ?? 0,
    };
    const fromX = Number.isFinite(spec.fromX) ? spec.fromX : x;
    const fromZ = Number.isFinite(spec.fromZ) ? spec.fromZ : z;
    // (a pseudo owner: `_hitPlayer` / `_hitAlly` read `owner.def.atk`)
    const owner = /** @type {Enemy} */ (/** @type {unknown} */ ({ def: { atk: Number.isFinite(spec.atk) ? spec.atk : 0 } }));
    const S = this.stepNo;
    if (s.tag) this.tags.touch(s.tag, S);
    const pp = this.player.position;
    if (this.pc.alive && !this.god && !(s.tag && this.tags.has(s.tag, 'player')) && hitOverlaps(s, pp.x, pp.y, pp.z, this.pc.radius)) {
      if (!this.pc.hittable) {
        if (!(s.flat > 0)) this.pc.notePerfectDodge();
      } else {
        if (s.tag) this.tags.add(s.tag, 'player', S);
        this._hitPlayer(owner, s.mv, s.kb, !!s.knockdown, s.flat, fromX, fromZ, 'projectile');
        out.player = true;
      }
    }
    for (let i = 0; i < this.allies.length; i++) {
      const a = this.allies[i];
      if (!a.present || (s.tag && this.tags.has(s.tag, a))) continue;
      const q = a.position;
      if (!hitOverlaps(s, q.x, q.y, q.z, ALLY.radius) || !a.hittable) continue;
      if (s.tag) this.tags.add(s.tag, a, S);
      this._hitAlly(a, owner, s.mv, s.kb, !!s.knockdown, s.flat, fromX, fromZ);
      out.allies++;
    }
    return out;
  }

  /**
   * A companion draws the foes near it (the greatshield's roar, DRAGON_CAMPAIGN.md §6.4, COMBAT.md
   * §29 V7): every foe within `r` of (x, z) (its body radius added) — awake or idle (woken), not a
   * boss, an add, a passive kind, a foe walking home or one the story took away — targets that
   * companion for `seconds` (`Enemy.tauntT`: no turn back to the player until it ends, the
   * companion falls or leaves; event `allyTargeted`). In enemy time; numbers clamped (r 0–20,
   * seconds 0–30).
   * @param {MemberCombat} ally
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} seconds
   * @returns {number} the foes drawn
   */
  taunt(ally, x, z, r, seconds) {
    if (!this._ready || !ally || ally.gone || ally.down || !this.allies.includes(ally)) return 0;
    const R = clamp(Number(r) || 0, 0, 20);
    const s = clamp(Number(seconds) || 0, 0, 30);
    if (!(R > 0) || !(s > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.boss || e.isAdd || e.passive || e.state === 'return' || this._hidden.has(e)) continue;
      if (Math.hypot(e.position.x - x, e.position.z - z) > R + e.radius) continue;
      if (!e.aggro) {
        e.dormant = false;
        e.wake(this.ctx);
      }
      e.target = ally;
      e.tauntT = s;
      e.targetHold = Math.max(e.targetHold, s);
      e.targetCheck = ALLY.checkTarget;
      this.events.emit('allyTargeted', e, ally.id);
      n++;
    }
    return n;
  }

  /**
   * A ward over the party (§6.4, COMBAT.md §29 V7): damage to the player and the companions
   * × (1 − `frac`) for `seconds` (combat time, hit-stop included) — every hit, shot, flat tick and
   * `strike`; with several wards the strongest counts. `frac` is clamped to 0–0.9, `seconds` to 0–60.
   * @param {number} frac 0–0.9
   * @param {number} seconds
   */
  ward(frac, seconds) {
    if (!this._ready) return;
    const f = clamp(Number(frac) || 0, 0, 0.9);
    const s = clamp(Number(seconds) || 0, 0, 60);
    if (!(f > 0) || !(s > 0)) return;
    const W = this._wards;
    if (W.length < WARD_SLOTS) {
      W.push({ frac: f, t: s });
      return;
    }
    // (full: the one that would end first gives way)
    let k = 0;
    for (let i = 1; i < W.length; i++) if (W[i].t < W[k].t) k = i;
    W[k].frac = f;
    W[k].t = s;
  }

  /** The strongest ward now (0: none). */
  get wardFrac() {
    let f = 0;
    for (let i = 0; i < this._wards.length; i++) if (this._wards[i].frac > f) f = this._wards[i].frac;
    return f;
  }

  /**
   * The wards' time (each sub-step, hit-stop included).
   * @param {number} h
   */
  _wardStep(h) {
    const W = this._wards;
    for (let i = W.length - 1; i >= 0; i--) {
      W[i].t -= h;
      if (W[i].t <= 0) W.splice(i, 1);
    }
  }

  // ---- The Bells of Evermere (COMBAT.md §30) ----

  /**
   * Take every resonance mark off `e` (§30.4; `ctx.consumeMarks`, a hit's `consume`) → how many it
   * had. Event `marksConsumed` (e, n) when it had any.
   * @param {Enemy} e
   * @returns {number}
   */
  consumeMarks(e) {
    const n = e?.marks ?? 0;
    if (!(n > 0)) return 0;
    e.marks = 0;
    this.events.emit('marksConsumed', e, n);
    return n;
  }

  /**
   * Submerge `e` (§30.5; `ctx.submerge`): out of the lock-on, every hit loop and the targets of the
   * companions, guarded, its sprite fading out over 12 f — the Evermere pack's core part does it
   * (`ev`); without the pack nothing happens.
   * @param {Enemy} e
   */
  submerge(e) {
    if (!this.ev || !e?.alive || e.submerged) return;
    if (this.targeting.lock === e) this.targeting.release();
    this.ev.submerge(e);
  }

  /**
   * Bring `e` up again (§30.5; `ctx.surface`), at (x, z) when given (the ground there): drawn, fading
   * in over 12 f, hittable at once (the pack's core part, as `submerge`).
   * @param {Enemy} e
   * @param {number} [x]
   * @param {number} [z]
   */
  surface(e, x, z) {
    this.ev?.surface(e, x, z);
  }

  /**
   * A brain asks to release `e` (§30.7; `ctx.release`): run after the enemy updates of this active
   * sub-step (never inside the ambient step: it waits for the next active one).
   * @param {Enemy} e
   * @returns {boolean} false: not alive, or asked already
   */
  _askRelease(e) {
    if (!e?.alive || this._releaseAsk.includes(e)) return false;
    this._releaseAsk.push(e);
    return true;
  }

  /** The releases asked for (`_askRelease`): each a kill that is no death (`release`). */
  _runReleases() {
    const list = this._releaseAsk;
    for (let i = 0; i < list.length; i++) this.release(list[i]);
    list.length = 0;
  }

  /**
   * Release `e` now (§30.7; the `release` hook, `_runReleases`): HP 0 and a kill that is no death —
   * XP, loot, the `kill` event (a story's `cleared` trigger), a boss's victory (its def's words and
   * drop; the arena opens, the bar goes, the music settles) — with `e.released` set: its brain's
   * `die` gives it its pose, `dead` holds the body (true) until it lets it go (false: a 90 f fade).
   * @param {Enemy} e
   * @returns {boolean} false: not alive
   */
  release(e) {
    if (!this._ready || !e?.alive) return false;
    e.hp = 0;
    e._barT = this.clock;
    this._kill(e, { release: true });
    return true;
  }

  /**
   * A warm (safe) disc the combat holds (§30.8: the bellwarden's Toll bell while it stands): read
   * live by `warmthZones()` — move it by writing its x, z, r. → a function that removes it.
   * @param {WarmthZone} zone
   * @returns {() => void}
   */
  addWarmth(zone) {
    if (!zone || this._warmth.includes(zone)) return () => {};
    this._warmth.push(zone);
    return () => {
      const i = this._warmth.indexOf(zone);
      if (i >= 0) this._warmth.splice(i, 1);
    };
  }

  /**
   * The warmth there now (§30.8; `ctx.warmthZones`): the world's lit braziers (`world.warmth`, present
   * story groups) and the combat's own (`addWarmth`), as discs { x, z, r } (a new list).
   * @returns {WarmthZone[]}
   */
  warmthZones() {
    /** @type {WarmthZone[]} */
    const out = [];
    for (const w of this.world?.warmth ?? []) {
      const at = w?.at;
      if (Array.isArray(at) && Number.isFinite(at[0]) && Number.isFinite(at[1]) && w.r > 0) out.push({ x: at[0], z: at[1], r: w.r });
    }
    for (const w of this._warmth) if (Number.isFinite(w.x) && Number.isFinite(w.z) && w.r > 0) out.push({ x: w.x, z: w.z, r: w.r });
    return out;
  }

  /**
   * Set a story variable (§30.9; `ctx.setFlag`): 1 / true sets a flag, 0 / false clears it, another
   * number is the value. A no-op without a story. Presence follows at the story's next frame.
   * @param {string} name
   * @param {number|boolean} [value]
   * @returns {boolean} it changed
   */
  setFlag(name, value = 1) {
    const st = this.game?.story?.state;
    if (!st || typeof name !== 'string') return false;
    const v = value === true ? 1 : value === false ? 0 : Number(value);
    if (!Number.isFinite(v)) return false;
    return v === 1 || v === 0 ? st.setFlag(name, v === 1) : st.setVar(name, v);
  }

  /**
   * A hazard pulse over the party (§30.8; `ctx.pulse`): flat `power` damage and a knock-down push
   * (`knock`) away from `at` to the player and every companion within `radius` (absent: everywhere)
   * and in no `safe` disc — only while the combat is engaged in an active frame (never in the
   * ambient step, a scene, god mode or a dodge's i-frames: a dodge through it slips it). Its ring is
   * drawn either way (`look`; null: none). Event `pulse` (the result). The Evermere pack's core part
   * does it (`ev`); without the pack nothing happens.
   * @param {PulseSpec} spec
   * @returns {PulseResult}
   */
  pulse(spec) {
    return this._ready && this.ev ? this.ev.pulse(spec) : { harmful: false, player: false, allies: 0, spared: 0 };
  }

  get markerCount() {
    let n = 0;
    for (const m of this._mk) if (m.h >= 0) n++;
    return n;
  }

  // ---- feedback helpers ----

  /**
   * @param {string} preset
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} count
   * @param {object} [opts] per-particle overrides of the preset (colours, hdr, size, speeds — never
   *   its pool keys, so no new pool or program: COMBAT.md §11.3)
   */
  burst(preset, x, y, z, count, opts) {
    const n = Math.max(0, Math.min(24, count | 0));
    if (opts) this.particles.burst(preset, _v.set(x, y, z), n, opts);
    else this.particles.burst(preset, _v.set(x, y, z), n);
  }

  /**
   * A combat sound at a world point: pan by its screen x (±0.8), volume 1 within 6 u of the
   * player → 0 at 30 u, pitch jitter ±4 % from hash2(position, frame).
   * @param {SfxName} name
   * @param {number} x
   * @param {number} z
   * @param {SfxOptions} [opts]
   */
  sfxAt(name, x, z, opts) {
    const p = this.player.position;
    const d = Math.hypot(x - p.x, z - p.z);
    const vol = d <= 6 ? 1 : Math.max(0, 1 - (d - 6) / 24);
    if (vol <= 0.01) return;
    this.projectNdc(x, p.y + 1, z, this._ndc, 1);
    const pan = clamp(Number.isFinite(this._ndc.x) ? this._ndc.x : 0, -0.8, 0.8);
    const j = (hash2(Math.floor(x * 16), Math.floor(z * 16), this.frame) - 0.5) * 0.08;
    this.audio.playSfx(name, { volume: vol * (opts?.volume ?? 1), pitch: (opts?.pitch ?? 1) * (1 + j), pan });
  }

  /** @param {number} amp @param {number} dur */
  shake(amp, dur) {
    this.rig.shake(amp, dur);
  }

  /** The player's hurt shake (a knock-down's when `down`): a pulse's hit (§30.8). @param {boolean} down */
  hurtShake(down) {
    const sh = down ? SHAKE.knockdown : SHAKE.hurt;
    this.rig.shake(sh[0], sh[1]);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   * @param {'crit'|'dmg'|'guard'|'heal'|'hurt'|'mp'|'perfect'} kind
   */
  number(x, y, z, text, kind) {
    this.ui.combat?.labels.number(x, y, z, text, kind);
  }

  /**
   * A companion's damage number (`ALLY_NUMBER`: the kind WorldLabels draws it in).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} text
   */
  allyNumber(x, y, z, text) {
    this.ui.combat?.labels.number(x, y, z, text, ALLY_NUMBER);
  }

  /** @param {number} seconds @param {Enemy|'player'} [victim] */
  _hitStop(seconds, victim) {
    if (seconds > this.stop) this.stop = seconds;
    if (victim && !this._stopVictims.includes(victim)) this._stopVictims.push(victim);
  }

  /**
   * Slow motion (combat real time): scales for `time` s (the stronger slow wins).
   * @param {number} playerScale
   * @param {number} enemyScale
   * @param {number} time
   */
  _slowMotion(playerScale, enemyScale, time) {
    if (this._slow > 0 && enemyScale > this.enemyScale && playerScale >= this.playerScale) return;
    this.playerScale = playerScale;
    this.enemyScale = enemyScale;
    this._slow = time;
  }

  // =============================================================================================
  // Frame
  // =============================================================================================

  /**
   * Input → player action, enemies, projectiles, hits — in `n = ceil(dt·60 − EPS)` sub-steps; then
   * the sky dragons. Inactive (title, dialog, map, photo, death screen): nothing advances — except
   * on a set-piece level in the **ambient** step (`ambient`: inactive only because a story run
   * holds the player, a cutscene or a talk; DRAGON_CAMPAIGN.md §6.4, COMBAT.md §29 V2,
   * `_ambientStep`), where the world goes on around the scene and hurts no one. An active step first
   * starts what waited for one: the intros on appearing, the swarms' rush, a boss that woke in a
   * scene (its bar and framing), the companions' way into an arena closed in a scene.
   * @param {number} dt
   * @param {boolean} active
   * @param {boolean} [ambient] (Game.update)
   */
  update(dt, active, ambient = false) {
    if (!this._ready) return;
    const t0 = performance.now();
    this._tickT = 0;
    this._ambient = false;
    if (!active) {
      this._wasActive = false;
      if (ambient && this.setpiece) this._ambientStep(dt);
      this._tickT += performance.now() - t0;
      return;
    }
    const resuming = !this._wasActive;
    this._wasActive = true;
    this._cacheViewProjection();
    this.cin.collect(dt, resuming);
    if (this.cin.lockEvent && this.pc.alive) this.targeting.onLockEvent(this.cin.lockEvent);
    if (this._introPending.length) this._startIntros();
    if (this._swarmPending.length) this._wakeSwarms();
    if (this._awakePending) {
      const b = this._awakePending;
      this._awakePending = null;
      if (b.alive && this._bossFight === b) this._showBoss(b, false);
    }
    if (this._pullPending) {
      const a = this._pullPending;
      this._pullPending = null;
      if (a.active && this.allies.length) this._alliesIntoArena(a, true);
    }
    this._advanced = 0;
    this._realAdvanced = 0;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - EPS));
    const h = dt / n;
    for (let k = 0; k < n; k++) this._substep(h);
    // the sky dragons fly in real time (their fireballs: `strike`)
    for (let i = 0; i < this.skyDragons.length; i++) this.skyDragons[i].update(dt, false);
    this._tickT += performance.now() - t0;
  }

  /**
   * The **ambient step** (COMBAT.md §29 V2; a set-piece level while a story scene holds the player):
   * in sub-steps like an active frame, but only idle foes (their idle — besieging, wandering — with
   * no aggro check: `ctx.ambient`), a boss in its intro, and the dying (their fade, a boss's death
   * throes) are updated, foes near the camera's look-at point woken first; shots fly on and touch no
   * one; every hitbox of the step is dropped unresolved, and no hit of any path lands (`_hitEnemy`,
   * `_allyHitEnemy`, `_hitPlayer`, `_hitAlly`, the splashes, `strike`: none in this step); the sky
   * dragons fly (`update(dt, true)`); effects, the arena's flames and those foes' sprites play on
   * (`afterPlayer`). Everything else — foes in a fight, the player's kit, the companions' fights,
   * pickups, the combat clock, the enemy clock (`ctx.time`), the wards — stays frozen as in any
   * inactive frame. A fight never starts in it: a boss's intro on appearing may run (its bar and
   * framing wait for the next active frame).
   * @param {number} dt
   */
  _ambientStep(dt) {
    this._ambient = true;
    const ctx = this.ctx;
    this._cacheViewProjection();
    if (this._introPending.length) this._startIntros();
    this._ambientWake(dt);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - EPS));
    const h = dt / n;
    ctx.ambient = true;
    try {
      for (let k = 0; k < n; k++) this._ambientSubstep(h);
    } finally {
      ctx.ambient = false;
    }
    for (let i = 0; i < this.skyDragons.length; i++) this.skyDragons[i].update(dt, true);
  }

  /**
   * One sub-step of the ambient step.
   * @param {number} h
   */
  _ambientSubstep(h) {
    this.frame++;
    const ctx = this.ctx;
    ctx.frame = this.frame;
    // (the combat clock, the enemy clock and the wards stand still in a scene, §29 V2: a ward cast
    // before a cutscene is not spent by it)
    this._syncPlayerView();
    this.nav.beginStep(NAV_SEARCHES);
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const run = this._ambientRuns(e);
      e.ambientRun = run;
      if (!run) continue;
      this._cur = e;
      e.update(h, ctx);
    }
    this._cur = null;
    // (the packs' systems, §30.1: `ctx.ambient` set — a pulse there harms no one; a release waits)
    for (let i = 0; i < this.systems.length; i++) this.systems[i].update?.(h, ctx);
    this.projectiles.step(h, h);
    // (the boss intro's player lock runs out with the intro it belongs to)
    if (this._introT > 0) this._introT = Math.max(0, this._introT - h);
    // nothing of the step is resolved: its hitboxes and shots hurt no one
    this.tags.sweep(this.stepNo);
    this.playerHits.clear();
    this.enemyHits.clear();
    this.allyHits.clear();
    this._contactN = 0;
    this.stepNo++;
  }

  /**
   * Does the ambient step update this enemy? An idle foe (awake, not aggroed), a boss in its intro,
   * the dying until faded; never one the story took away or a pooled add.
   * @param {Enemy} e
   * @returns {boolean}
   */
  _ambientRuns(e) {
    if (this._hidden.has(e)) return false;
    if (!e.alive) return e.sprite.visible && e.sprite.opacity > 0.001;
    if (e.boss) return e.state === 'intro';
    if (e.dormant || e.aggro || e.isAdd) return false;
    return e.state === 'idle' || e.state === 'dormant';
  }

  /**
   * Every 0.25 s of the ambient step: the idle foes within `AMBIENT_RANGE` of the player or of the
   * camera's look-at point wake from their dormancy (a shot of a besieged house far from the party
   * shows its besiegers at work). The active frames' dormancy puts the far ones back to sleep.
   * @param {number} dt
   */
  _ambientWake(dt) {
    this._ambientCheckT -= dt;
    if (this._ambientCheckT > 0) return;
    this._ambientCheckT = CHECK_EVERY;
    const f = this._cameraFocus(this._focus);
    const P = this.player.position;
    for (const e of this.enemies) {
      if (!e.dormant || !e.alive || e.aggro || e.boss || this._hidden.has(e)) continue;
      const dp = Math.hypot(e.position.x - P.x, e.position.z - P.z);
      const df = Math.hypot(e.position.x - f.x, e.position.z - f.z);
      if (Math.min(dp, df) <= AMBIENT_RANGE) e.dormant = false;
    }
  }

  /**
   * Where the camera looks on the ground: its forward ray on the plane of the player's feet (a
   * camera looking level or up: its own position).
   * @param {PointXZ} out
   * @returns {PointXZ}
   */
  _cameraFocus(out) {
    const m = this.engine.camera.matrixWorld.elements;
    const fy = -m[9];
    const dy = m[13] - this.player.position.y;
    const t = fy < -0.05 ? Math.min(400, Math.max(0, dy / -fy)) : 0;
    out.x = m[12] - m[8] * t;
    out.z = m[14] - m[10] * t;
    return out;
  }

  /**
   * Start the intros waiting for a step (`def.introOnSpawn`, COMBAT.md §29 V3): a boss there as the
   * story stands, alive, kneeling in its dormant state, while no other boss fight runs, enters its
   * `intro` at once (its brain plays it: the dragon's descent; `bossIntro` closes the arena — or,
   * the player outside it, when the player walks in).
   */
  _startIntros() {
    const list = this._introPending;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || this._hidden.has(e) || e.state !== 'dormant' || (this._bossFight && this._bossFight !== e)) continue;
      e.dormant = false;
      e.setState('intro');
    }
    list.length = 0;
  }

  /**
   * Wake the swarms waiting for an active step (COMBAT.md §29 V4): every living foe of a group there
   * as the story stands rushes the party — the player, or the nearest companion when one is nearer.
   */
  _wakeSwarms() {
    for (const g of this._swarmPending) {
      if (this._absentGroups.has(g)) continue;
      for (const e of this._members.get(g) ?? []) this._swarmWake(e);
    }
    this._swarmPending.length = 0;
  }

  /** @param {Enemy} e */
  _swarmWake(e) {
    if (!e.alive || e.aggro || this._hidden.has(e)) return;
    e.dormant = false;
    e.wake(this.ctx);
    if (!e.aggro) return;
    const P = this.player.position;
    let best = null;
    let bd = Math.hypot(e.position.x - P.x, e.position.z - P.z);
    for (const a of this.allies) {
      if (a.gone || a.down || !a.present) continue;
      const d = Math.hypot(e.position.x - a.position.x, e.position.z - a.position.z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best) return;
    e.target = best;
    e.targetHold = ALLY.holdTarget;
    e.targetCheck = ALLY.checkTarget;
    this.events.emit('allyTargeted', e, best.id);
  }

  /** @param {number} h */
  _substep(h) {
    this.frame++;
    this.ctx.frame = this.frame;
    this.clock += h;
    if (this._wards.length) this._wardStep(h);
    if (this.stop > 0) {
      this.stop = Math.max(0, this.stop - h);
      return;
    }
    this._realAdvanced += h;
    if (this._slow > 0) {
      this._slow -= h;
      if (this._slow <= EPS) {
        this._slow = 0;
        this.playerScale = 1;
        this.enemyScale = 1;
      }
    }
    const hp = h * this.playerScale;
    const he = h * this.enemyScale;
    this._advanced += hp;
    this.enemyTime += he;
    this.ctx.time = this.enemyTime;
    this._syncPlayerView();

    // player (the input buffer counts down after the decision: a press lives 10 full frames)
    this.pc.step(hp);
    this.cin.tick(h);
    this._syncPlayerView();

    // the companions (PARTY.md §5.1: after the player's kit, on the player's time scale)
    const allies = this.allies;
    if (allies.length) {
      this.allySearches = 1;
      for (let i = 0; i < allies.length; i++) allies[i].step(hp);
    }

    // enemies (each sees its target as `ctx.player`: the player's view, or a companion's)
    this.nav.beginStep(NAV_SEARCHES);
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dormant) continue;
      if (!e.alive && e.sprite.opacity <= 0.001) continue;
      if (this.freezeAI && e.alive) {
        // frozen AI (tests): only the hit flash keeps decaying (the enemy writes its own uFlash)
        e.decayFlash(he);
        continue;
      }
      this._cur = e;
      if (e.target) this._retarget(e, he);
      const t = e.target;
      if (t) {
        // (back to the player's view whatever the brain does: a throw must not leave the next
        // enemies — and every later sub-step — seeing the companion as the player)
        this.ctx.player = t.view;
        try {
          e.update(he, this.ctx);
        } finally {
          this.ctx.player = this._pv;
        }
      } else e.update(he, this.ctx);
    }
    this._cur = null;
    // (the releases the brains asked for this sub-step, §30.7; then the packs' systems, §30.1)
    if (this._releaseAsk.length) this._runReleases();
    for (let i = 0; i < this.systems.length; i++) this.systems[i].update?.(he, this.ctx);

    // projectiles, hits, timers
    this.projectiles.step(hp, he);
    this._resolve();
    this._timersStep(he);
    this.tags.sweep(this.stepNo);
    this.playerHits.clear();
    this.enemyHits.clear();
    this.allyHits.clear();
    this._contactN = 0;
    this.stepNo++;
  }

  _syncPlayerView() {
    const v = this._pv;
    const pc = this.pc;
    v.facing.x = this.player.facing.x;
    v.facing.z = this.player.facing.z;
    v.alive = pc.alive;
    v.invulnerable = pc.invulnerable || this.god;
    v.dodging = pc.dodging;
    v.action = pc.action;
    v.swing = pc.swings;
    // a closed arena holds the player inside (the clamp of afterPlayer; a knockback slide may
    // cross the rect for a sub-step): while one is closed the player is sealed in with its boss
    let sealed = false;
    for (let i = 0; i < this.arenas.length; i++) if (this.arenas[i].active) { sealed = true; break; }
    v.sealed = sealed;
  }

  /**
   * An enemy whose target is a companion (PARTY.md §5.3): back to the player at once when the
   * companion is down or gone (or the player fell, or it walks home); every `ALLY.checkTarget` s,
   * once the hold of `ALLY.holdTarget` s is over, back to the player when the player is clearly
   * nearer (< `ALLY.playerNearer` × the companion's distance); a companion that falls back
   * (`mode` 'retreat') is let go as soon as the player is the nearer, hold or not.
   * @param {Enemy} e
   * @param {number} he enemy-scaled seconds
   */
  _retarget(e, he) {
    const t = e.target;
    if (!t) return;
    if (t.gone || t.down || !e.alive || !this.pc.alive || e.state === 'return' || e.boss || e.isAdd) {
      e.target = null;
      e.tauntT = 0;
      return;
    }
    e.targetHold -= he;
    // a taunt holds it on the companion until it ends (§29 V7)
    if (e.tauntT > 0) {
      e.tauntT -= he;
      if (e.tauntT > 0) return;
      e.tauntT = 0;
    }
    e.targetCheck -= he;
    if (e.targetCheck > 0) return;
    e.targetCheck += ALLY.checkTarget;
    if (e.targetCheck <= 0) e.targetCheck = ALLY.checkTarget;
    // (a companion falling back behind the player — its `retreat` rule — leaves its foes to the
    // player: the hold does not keep them on it, and the player only has to be the nearer)
    const back = t.mode === 'retreat';
    if (e.targetHold > 0 && !back) return;
    const P = this.player.position;
    const q = t.position;
    const dA = Math.hypot(e.position.x - q.x, e.position.z - q.z);
    const dP = Math.hypot(e.position.x - P.x, e.position.z - P.z);
    if (dP < (back ? 1 : ALLY.playerNearer) * dA) e.target = null;
  }

  /**
   * A companion hit an enemy (PARTY.md §5.3): it turns on the companion when the companion is
   * nearer to it than `ALLY.threat` × the player's distance — an archer or a shaman (a ranged foe)
   * also when the companion's shot came from within `ALLY.rangedAggro` u — and holds it ≥
   * `ALLY.holdTarget` s (another hit renews the hold). The boss and its adds stay on the player; a
   * foe held on another companion stays.
   * @param {Enemy} e
   * @param {MemberCombat} a
   * @param {'melee'|'skill'|'projectile'} [source] the companion's hit
   */
  _allyAggro(e, a, source = 'melee') {
    if (e.boss || e.isAdd || e.passive || !e.alive || a.down || a.gone) return;
    if (e.target === a) {
      e.targetHold = Math.max(e.targetHold, ALLY.holdTarget);
      return;
    }
    if (e.target && e.targetHold > 0) return;
    const P = this.player.position;
    const q = a.position;
    const dA = Math.hypot(e.position.x - q.x, e.position.z - q.z);
    const dP = Math.hypot(e.position.x - P.x, e.position.z - P.z);
    const shotBack = source === 'projectile' && e.def.token?.type === 'ranged' && dA <= ALLY.rangedAggro;
    if (dA < dP * ALLY.threat || shotBack) {
      e.target = a;
      e.targetHold = ALLY.holdTarget;
      e.targetCheck = ALLY.checkTarget;
      this.events.emit('allyTargeted', e, a.id);
    }
  }

  /**
   * A companion went down: the foes after it turn back to the player (at once, not at their next
   * check), and it is announced (`allyDown`).
   * @param {MemberCombat} a
   */
  onAllyDown(a) {
    for (const e of this.enemies) if (e.target === a) { e.target = null; e.tauntT = 0; }
    this.events.emit('allyDown', a.id);
  }

  /**
   * Per-sub-step timers: the dummies' refill (120 f after the last hit), the intro lock.
   * @param {number} he enemy-scaled seconds
   */
  _timersStep(he) {
    if (this._introT > 0) {
      this._introT -= he;
      if (this._introT <= 0) this._introT = 0;
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.kind === 'dummy' && e.alive && e.hp < e.hpMax && this.enemyTime - (e._refillFrom ?? 0) >= DUMMY_REFILL - EPS) e.hp = e.hpMax;
    }
  }

  // =============================================================================================
  // Hits (§6.3, §9.1 step 5)
  // =============================================================================================

  /**
   * Queue a player hitbox for this sub-step (meta: PLAYER_HIT_META entry; swing: MP bookkeeping).
   * @param {HitSpec} spec
   * @param {PlayerHitMeta} meta
   * @param {SwingRecord|null} swing
   * @returns {Required<HitSpec>}
   */
  addPlayerHit(spec, meta, swing) {
    const s = this.playerHits.add('player', spec);
    const it = this.playerHits.items[this.playerHits.length - 1];
    it.meta = meta;
    it.swing = swing;
    return s;
  }

  /**
   * A companion's hitbox for this sub-step (resolved after the player's, with its ATK).
   * @param {MemberCombat} a
   * @param {HitSpec} spec
   * @param {'melee'|'skill'|'projectile'} source
   */
  addAllyHit(a, spec, source) {
    this.allyHits.add(a, spec);
    const it = this.allyHits.items[this.allyHits.length - 1];
    it.meta = ALLY_HIT_META[source] ?? ALLY_HIT_META.melee;
    it.swing = null;
  }

  /**
   * A companion's shot: a player-side projectile (it tests the enemies, on the player's time
   * scale) owned by the companion.
   * @param {MemberCombat} a
   * @param {ProjectileSpec} spec
   * @returns {number} handle, or −1
   */
  spawnAllyProjectile(a, spec) {
    return this.projectiles.spawn('player', spec, a);
  }

  /**
   * @param {Enemy|'player'|'fx'} owner
   * @param {ProjectileSpec} spec
   * @returns {number} handle, or −1
   */
  spawnProjectile(owner, spec) {
    return this.projectiles.spawn(owner, spec);
  }

  /** @returns {ProjectileContact} */
  _contact() {
    if (this._contactN === this._contacts.length) {
      this._contacts.push({
        p: null, target: null, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, mv: 1, kb: 0, poise: 0, tag: 0, owner: null, splash: null, splashTag: 0, kind: '', player: false, ally: null,
        chill: 0, slow: 0, freeze: 0, stun: 0, mark: 0, consume: 0, feel: null, look: null,
      });
    }
    return this._contacts[this._contactN++];
  }

  /**
   * A projectile touched a target (resolved in order after every contact of the sub-step): an
   * enemy (player-side shots, a companion's too), the player or a companion (enemy shots).
   * @param {LiveProjectile} p
   * @param {Enemy|'player'|MemberCombat} target
   */
  queueProjectileHit(p, target) {
    const c = this._contact();
    c.target = target;
    c.x = p.x;
    c.y = p.y;
    c.z = p.z;
    c.dirX = p.dirX;
    c.dirZ = p.dirZ;
    c.mv = p.mv;
    c.kb = p.kb;
    c.poise = p.poise;
    c.tag = p.tag;
    c.owner = /** @type {Enemy|'player'|MemberCombat} */ (p.owner); // ('fx' shots never touch: Projectiles._contact)
    c.splash = p.splash;
    c.splashTag = p.splashTag;
    c.kind = p.kind;
    c.player = p.player;
    c.ally = p.ally;
    c.chill = p.chill;
    c.slow = p.slow;
    c.freeze = p.freeze;
    c.stun = p.stun;
    c.mark = p.mark;
    c.consume = p.consume;
    c.feel = p.feel;
    c.look = p.look;
    this.tags.add(p.tag, target, this.stepNo);
  }

  /**
   * An Ember Bolt that hit a wall splashes (no primary target).
   * @param {LiveProjectile} p
   */
  queueSplash(p) {
    // (the ambient step hurts no one and wakes no one: a bolt that hits a wall in a scene only bursts)
    if (this._ambient) return;
    if (p.ally) this._allySplash(p.ally, p.x, p.y, p.z, p.splash, null, p.tag, p.splashTag);
    else this._splash(p.x, p.y, p.z, p.splash, null, p.tag, p.splashTag);
  }

  /**
   * An arc projectile landed: a circle hit at its target (melee height rule).
   * @param {LiveProjectile} p
   */
  queueLanding(p) {
    const s = this._landSpec ??= /** @type {HitSpec} */ ({});
    s.shape = 'circle';
    s.x = p.arc.tx;
    s.y = p.ty;
    s.z = p.arc.tz;
    s.r = p.radius;
    s.dy = MELEE_DY;
    s.mv = p.mv;
    s.kb = p.kb;
    s.poise = p.poise;
    s.knockdown = false;
    s.flat = 0;
    s.thin = false;
    s.tag = p.tag;
    s.fromX = p.arc.tx;
    s.fromZ = p.arc.tz;
    if (p.owner !== 'fx') this.enemyHits.add(p.owner, s);
    // (a shot with its own look: its impact; §29 V10)
    if (this.projectiles.impact(p)) return;
    this.fx.play('dust', s.x, s.y, s.z, { scale: 1.6 });
    this.burst('emberBurst', s.x, s.y + 0.2, s.z, 8);
    this.sfxAt('slam', s.x, s.z, { volume: 0.7 });
  }

  _resolve() {
    const S = this.stepNo;
    const list = this.enemies;
    // 1. player hitboxes vs enemies (enemy order)
    const ph = this.playerHits;
    for (let k = 0; k < ph.length; k++) {
      const it = ph.items[k];
      const spec = it.spec;
      this.tags.touch(spec.tag, S);
      /** @type {Enemy|null} the first enemy this hitbox hit (its feel, §29 V6) */
      let first = null;
      const crowd = this._crowd;
      crowd.length = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
        if (this.tags.has(spec.tag, e)) continue;
        if (!hitOverlaps(spec, e.position.x, e.position.y, e.position.z, e.radius)) continue;
        this.tags.add(spec.tag, e, S);
        first ??= e;
        crowd.push(e);
        this._hitEnemy(e, spec.mv, spec.kb, spec.poise, spec.knockdown && !e.boss,
          Number.isFinite(spec.fromX) ? spec.fromX : spec.x, Number.isFinite(spec.fromZ) ? spec.fromZ : spec.z, it.meta, it.swing, spec.tag, spec);
      }
      if (first && spec.feel) this._applyFeel(spec.feel, first);
      // (one hit on a crowd: soft hit flashes, §29 V6)
      if (crowd.length >= CROWD) for (let i = 0; i < crowd.length; i++) crowd[i].softenFlash();
    }
    // 1b. the companions' hitboxes vs enemies (PARTY.md §5.2; no friendly fire)
    const ah = this.allyHits;
    for (let k = 0; k < ah.length; k++) {
      const it = ah.items[k];
      const spec = it.spec;
      const a = /** @type {MemberCombat} */ (it.owner);
      this.tags.touch(spec.tag, S);
      /** @type {Enemy|null} */
      let first = null;
      const crowd = this._crowd;
      crowd.length = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
        if (this.tags.has(spec.tag, e)) continue;
        if (!hitOverlaps(spec, e.position.x, e.position.y, e.position.z, e.radius)) continue;
        this.tags.add(spec.tag, e, S);
        first ??= e;
        crowd.push(e);
        this._allyHitEnemy(a, e, spec.mv, spec.kb, spec.poise, spec.knockdown && !e.boss,
          Number.isFinite(spec.fromX) ? spec.fromX : spec.x, Number.isFinite(spec.fromZ) ? spec.fromZ : spec.z, it.meta.source, spec.tag, spec);
      }
      // (a companion's big spell may stop and shake: once per hitbox, §29 V6)
      if (first && spec.feel) this._applyFeel(spec.feel, first);
      // (one hit on a crowd: soft hit flashes, §29 V6)
      if (crowd.length >= CROWD) for (let i = 0; i < crowd.length; i++) crowd[i].softenFlash();
    }
    // 2. player projectiles vs enemies (a companion's shots too)
    for (let k = 0; k < this._contactN; k++) {
      const c = this._contacts[k];
      if (!c.player || c.target === 'player') continue;
      // (a player-side shot only ever touches enemies: Projectiles._contact)
      const e = /** @type {Enemy} */ (c.target);
      if (!e.alive) continue;
      if (c.ally) {
        this._allyShotHit(c, e);
        continue;
      }
      this._hitEnemy(e, c.mv, c.kb, c.poise, false, c.x - c.dirX, c.z - c.dirZ, PLAYER_HIT_META.bolt, null, c.tag, c);
      if (c.feel) this._applyFeel(c.feel, e);
      if (c.splash) this._splash(c.x, c.y, c.z, c.splash, e, c.tag, c.splashTag);
      if (this.projectiles.impact(c)) continue;
      this.fx.play('impact', c.x, c.y - 1.0, c.z);
      this.burst('emberBurst', c.x, c.y, c.z, 8);
      this.sfxAt('boltHit', c.x, c.z);
    }
    // 3. enemy hitboxes vs the player
    const eh = this.enemyHits;
    const pp = this.player.position;
    for (let k = 0; k < eh.length; k++) {
      const it = eh.items[k];
      const spec = it.spec;
      this.tags.touch(spec.tag, S);
      if (!this.pc.alive || this.tags.has(spec.tag, 'player')) continue;
      if (!hitOverlaps(spec, pp.x, pp.y, pp.z, this.pc.radius)) continue;
      if (this.god) continue;
      if (!this.pc.hittable) {
        // (a magma tick is no attack to dodge)
        if (!(spec.flat > 0)) this.pc.notePerfectDodge();
        continue;
      }
      this.tags.add(spec.tag, 'player', S);
      this._hitPlayer(/** @type {Enemy} */ (it.owner), spec.mv, spec.kb, spec.knockdown, spec.flat,
        Number.isFinite(spec.fromX) ? spec.fromX : spec.x, Number.isFinite(spec.fromZ) ? spec.fromZ : spec.z);
    }
    // 4. enemy projectiles vs the player
    for (let k = 0; k < this._contactN; k++) {
      const c = this._contacts[k];
      if (c.player || c.target !== 'player') continue;
      if (!this.pc.alive || this.god) continue;
      if (!this.pc.hittable) {
        this.pc.notePerfectDodge();
        continue;
      }
      // (an enemy shot: its owner is the enemy)
      this._hitPlayer(/** @type {Enemy} */ (c.owner), c.mv, c.kb, false, 0, c.x - c.dirX, c.z - c.dirZ, 'projectile');
      if (!this.projectiles.impact(c)) this.sfxAt('arrowHit', c.x, c.z);
    }
    if (this.allies.length) this._resolveAllies(S);
  }

  /**
   * Enemy hitboxes and shots against the companions (PARTY.md §5.3), after the player: one hit per
   * tag per companion; a companion with i-frames (rolling, after a hit) or down is passed through.
   * @param {number} S the sub-step
   */
  _resolveAllies(S) {
    const A = this.allies;
    // 3b. enemy hitboxes
    const eh = this.enemyHits;
    for (let k = 0; k < eh.length; k++) {
      const it = eh.items[k];
      const spec = it.spec;
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        if (!a.present || this.tags.has(spec.tag, a)) continue;
        const q = a.position;
        if (!hitOverlaps(spec, q.x, q.y, q.z, ALLY.radius)) continue;
        if (!a.hittable) continue;
        this.tags.add(spec.tag, a, S);
        this._hitAlly(a, /** @type {Enemy} */ (it.owner), spec.mv, spec.kb, spec.knockdown, spec.flat,
          Number.isFinite(spec.fromX) ? spec.fromX : spec.x, Number.isFinite(spec.fromZ) ? spec.fromZ : spec.z);
      }
    }
    // 4b. enemy shots (Projectiles._contact queued them with the companion as the target)
    for (let k = 0; k < this._contactN; k++) {
      const c = this._contacts[k];
      if (c.player || !c.target || c.target === 'player' || !(/** @type {MemberCombat} */ (c.target).isAlly)) continue;
      const a = /** @type {MemberCombat} */ (c.target);
      if (!a.hittable) continue;
      this._hitAlly(a, /** @type {Enemy} */ (c.owner), c.mv, c.kb, false, 0, c.x - c.dirX, c.z - c.dirZ);
      if (!this.projectiles.impact(c)) this.sfxAt('arrowHit', c.x, c.z, { volume: 0.7 });
    }
  }

  /**
   * An enemy hit on a companion: flat damage (magma) or the player's formula against the
   * companion's DEF (its own RNG), hit stun / knockdown / down; a number in the hurt colour, sparks
   * and a sound — no hit-stop, shake or vignette (those are the player's). Event `allyHurt`.
   * @param {MemberCombat} a
   * @param {Enemy|null} owner
   * @param {number} mv
   * @param {number} kb
   * @param {boolean} knockdown
   * @param {number} flat
   * @param {number} fromX
   * @param {number} fromZ
   */
  _hitAlly(a, owner, mv, kb, knockdown, flat, fromX, fromZ) {
    if (this._ambient) return;
    const p = a.position;
    let dx = p.x - fromX;
    let dz = p.z - fromZ;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = -a.member.facing.x; dz = -a.member.facing.z; }
    // (a ward over the party takes its share of every hit, §29 V7)
    const wf = this._wards.length ? this.wardFrac : 0;
    if (flat > 0) {
      const f = wf > 0 ? Math.max(1, Math.round(flat * (1 - wf))) : flat;
      a.hurtFlat(f);
      this.number(p.x, p.y + 1.9, p.z, String(f), 'hurt');
      if (wf > 0) this._wardGlint(p);
      this.events.emit('allyHurt', a.id, f);
      return;
    }
    if (!(mv > 0)) {
      if (kb > 0) a.shove(kb, dx, dz);
      return;
    }
    const atk = owner?.def?.atk ?? 10;
    const roll = 0.92 + 0.16 * a.rng.next();
    const damage = Math.max(1, Math.round(atk * mv * roll * mitigation(a.def) * (1 - wf)));
    if (wf > 0) this._wardGlint(p);
    a.takeHit(damage, kb, dx, dz, knockdown);
    this.number(p.x, p.y + 1.9, p.z, String(damage), 'hurt');
    this.sfxAt('hurt', p.x, p.z, { volume: 0.55, pitch: 1.15 });
    this.burst('hitSpark', p.x, p.y + 1.0, p.z, 5);
    this.events.emit('allyHurt', a.id, damage);
  }

  /**
   * A companion's hit (a hitbox, a shot, a splash) on an enemy (PARTY.md §5.1–5.3): the player's
   * damage formula with the companion's ATK and its own RNG (crits: base, rear, exposed), the
   * boss's floors; the kill gives the player XP and loot and counts; the foe may turn on the
   * companion. A companion's damage number (`ALLY_NUMBER`), a smaller star and sound — no
   * hit-stop or shake. Events `allyHit` (id, enemy, damage, crit) and, on a kill, `allyKill`.
   * @param {MemberCombat} a
   * @param {Enemy} e
   * @param {number} mv
   * @param {number} kb
   * @param {number} poise
   * @param {boolean} knockdown
   * @param {number} fromX
   * @param {number} fromZ
   * @param {'melee'|'skill'|'projectile'} source
   * @param {number} tag
   * @param {HitStatus|null} [st] the hit's status effects (§29 V5)
   */
  _allyHitEnemy(a, e, mv, kb, poise, knockdown, fromX, fromZ, source, tag, st = null) {
    if (a.gone || this._ambient) return;
    let dx = e.position.x - fromX;
    let dz = e.position.z - fromZ;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = a.member.facing.x; dz = a.member.facing.z; }
    const info = this._allyInfo ??= {
      damage: 0, crit: false, mv: 0, kb: 0, kbDirX: 0, kbDirZ: 0, poise: 0, knockdown: false, source: 'melee', tag: 0, guarded: false,
    };
    info.mv = mv;
    info.kb = kb;
    info.kbDirX = dx;
    info.kbDirZ = dz;
    info.poise = poise;
    info.knockdown = knockdown;
    info.source = source;
    info.tag = tag;
    const x = e.position.x;
    const z = e.position.z;
    const yNum = this.numberY(e);
    if (e.guarded) {
      info.damage = 0;
      info.crit = false;
      info.guarded = true;
      e.receiveHit(info, this.ctx);
      this.number(x, yNum, z, 'Guard', 'guard');
      this.sfxAt('guard', x, z, { volume: 0.5 });
      this.burst('hitSpark', x, this.bodyBase(e) + 0.9, z, 3);
      return;
    }
    info.guarded = false;
    // (a hit that consumes the foe's resonance marks lands harder for each, §30.4)
    if (st?.consume > 0 && e.marks > 0) info.mv = mv *= 1 + st.consume * this.consumeMarks(e);
    const roll = 0.92 + 0.16 * a.rng.next();
    const critRoll = a.rng.next();
    const rear = dx * e.facing.x + dz * e.facing.z > 0.3;
    const exposed = !!e.exposed || e.state === 'stagger' || e.state === 'stun';
    const kneel = e.boss && (typeof e.hpFloor === 'number'
      ? e.state === 'kneel'
      : !!this._kneel && this._kneel.boss === e && this.enemyTime < this._kneel.until);
    const chance = CRIT.base + (rear ? CRIT.rear : 0) + (exposed ? CRIT.exposed : 0);
    const crit = kneel || critRoll < chance;
    let damage = Math.max(1, Math.round(a.atk * mv * roll * mitigation(e.def.def ?? 0) * (crit ? CRIT.mult : 1) * (e.vuln || 1)));
    if (e.boss) damage = this._bossClamp(e, damage, kneel);
    e.hp = Math.max(0, e.hp - damage);
    info.damage = damage;
    info.crit = crit;
    e.hitFlash = ENEMY_FLASH_TIME;
    e._barT = this.clock;
    if (e.kind === 'dummy') e._refillFrom = this.enemyTime;
    a.counts.hits++;
    a.counts.damageDealt += damage;
    if (crit) a.counts.crits++;
    if (e.hp <= 0) {
      this._kill(e);
      a.kills++;
      this.events.emit('allyKill', a.id, e);
    } else {
      e.receiveHit(info, this.ctx);
      this._allyAggro(e, a, source);
      if (st) this._applyStatus(e, st);
    }
    const hy = this.bodyBase(e);
    this.allyNumber(x, yNum, z, damage > 0 ? String(damage) : 'Guard');
    this.fx.play(crit ? 'crit' : 'impact', x - dx * 0.2, hy + (e.def.body[1] - 1.0) * 0.5, z - dz * 0.2, ALLY_STAR);
    this.burst('hitSpark', x - dx * 0.25, hy + Math.min(1.1, e.def.body[1] * 0.55), z - dz * 0.25, crit ? 7 : 4);
    this.sfxAt(crit ? 'crit' : 'hit', x, z, { volume: ALLY_HIT_SFX_VOLUME });
    this.events.emit('allyHit', a.id, e, damage, crit);
  }

  /**
   * A companion's shot reached an enemy: the hit, a bolt's splash, its impact look and sound.
   * @param {ProjectileContact} c
   * @param {Enemy} e
   */
  _allyShotHit(c, e) {
    const a = c.ally;
    this._allyHitEnemy(a, e, c.mv, c.kb, c.poise, false, c.x - c.dirX, c.z - c.dirZ, 'projectile', c.tag, c);
    if (c.feel) this._applyFeel(c.feel, e);
    if (c.splash) this._allySplash(a, c.x, c.y, c.z, c.splash, e, c.tag, c.splashTag);
    if (this.projectiles.impact(c)) return;
    if (c.kind === 'emberBolt') {
      this.fx.play('impact', c.x, c.y - 1.0, c.z, { scale: 0.8 });
      this.burst('emberBurst', c.x, c.y, c.z, 6);
      this.sfxAt('boltHit', c.x, c.z, { volume: 0.7 });
    } else this.sfxAt('arrowHit', c.x, c.z, { volume: 0.6 });
  }

  /**
   * A companion's bolt splash (as `_splash`, with the companion's ATK).
   * @param {MemberCombat} a
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {Splash} splash
   * @param {Enemy|null} primary
   * @param {number} tag
   * @param {number} splashTag
   */
  _allySplash(a, x, y, z, splash, primary, tag, splashTag) {
    if (this._ambient) return;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === primary || !e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d >= splash.r + e.radius) continue;
      const b = e.def.body;
      const base = this.bodyBase(e);
      if (y < base + b[0] - splash.r || y > base + b[1] + splash.r) continue;
      if (this.tags.has(splashTag, e)) continue;
      this.tags.add(splashTag, e, this.stepNo);
      this._allyHitEnemy(a, e, splash.mv, 0.4, 0, false, x, z, 'projectile', tag);
    }
  }

  /**
   * Damage a companion directly (the `allyHurt` hook; no RNG, no reaction but going down).
   * @param {MemberCombat} a
   * @param {number} n
   * @returns {number} its HP after
   */
  hurtAlly(a, n) {
    if (!a || a.gone || a.down) return a ? Math.ceil(a.hp) : 0;
    const d = Math.max(0, Math.round(Number(n) || 0));
    const p = a.position;
    this.number(p.x, p.y + 1.9, p.z, String(d), 'hurt');
    a.hp = Math.max(0, a.hp - d);
    a.counts.damageTaken += d;
    if (a.hp <= 0) a._goDown();
    return Math.ceil(a.hp);
  }

  /**
   * Ember Bolt splash: r 1.0 at mv 0.6 around the impact (not the primary target); `splashTag`
   * (the projectile's precomputed `<tag>:s`) keeps it to one splash hit per enemy.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {Splash} splash
   * @param {Enemy|null} primary
   * @param {number} tag
   * @param {number} splashTag
   */
  _splash(x, y, z, splash, primary, tag, splashTag) {
    if (this._ambient) return;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === primary || !e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d >= splash.r + e.radius) continue;
      const b = e.def.body;
      const base = this.bodyBase(e);
      if (y < base + b[0] - splash.r || y > base + b[1] + splash.r) continue;
      if (this.tags.has(splashTag, e)) continue;
      this.tags.add(splashTag, e, this.stepNo);
      this._hitEnemy(e, splash.mv, 0.4, 0, false, x, z, PLAYER_HIT_META.bolt, null, tag);
    }
  }

  /**
   * A player hit on an enemy: guard, damage (combat RNG draws #1 roll, #2 crit), boss floors,
   * flash, reactions or death, numbers, sparks, hit-stop, shake, MP.
   * @param {Enemy} e
   * @param {number} mv
   * @param {number} kb
   * @param {number} poise
   * @param {boolean} knockdown
   * @param {number} fromX
   * @param {number} fromZ
   * @param {PlayerHitMeta} meta
   * @param {SwingRecord|null} swing
   * @param {number} tag
   * @param {HitStatus|null} [st] the hit's status effects (§29 V5)
   */
  _hitEnemy(e, mv, kb, poise, knockdown, fromX, fromZ, meta, swing, tag, st = null) {
    // (no hit of any path lands in the ambient step: a scene hurts no one, wakes no one, §29 V2)
    if (this._ambient) return;
    const pc = this.pc;
    // (a companion with `attack: assist` goes for a foe the player hit lately)
    e.playerHitAt = this.clock;
    let dx = e.position.x - fromX;
    let dz = e.position.z - fromZ;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = this.player.facing.x; dz = this.player.facing.z; }
    const info = this._info ??= {
      damage: 0, crit: false, mv: 0, kb: 0, kbDirX: 0, kbDirZ: 0, poise: 0, knockdown: false, source: 'melee', tag: 0, guarded: false,
    };
    info.mv = mv;
    info.kb = kb;
    info.kbDirX = dx;
    info.kbDirZ = dz;
    info.poise = poise;
    info.knockdown = knockdown;
    info.source = meta.source;
    info.tag = tag;
    const x = e.position.x;
    const z = e.position.z;
    const yNum = this.numberY(e);
    if (e.guarded) {
      info.damage = 0;
      info.crit = false;
      info.guarded = true;
      e.receiveHit(info, this.ctx);
      this.number(x, yNum, z, 'Guard', 'guard');
      this.sfxAt('guard', x, z, { volume: 0.8 });
      this.burst('hitSpark', x, this.bodyBase(e) + 0.9, z, 4);
      this._hitStop(F(HIT_STOP.guard), e);
      return;
    }
    info.guarded = false;
    // (a hit that consumes the foe's resonance marks lands harder for each, §30.4)
    if (st?.consume > 0 && e.marks > 0) info.mv = mv *= 1 + st.consume * this.consumeMarks(e);
    // damage (§6.3)
    const roll = 0.92 + 0.16 * this.rng.next();
    const critRoll = this.rng.next();
    const rear = dx * e.facing.x + dz * e.facing.z > 0.3;
    const exposed = !!e.exposed || e.state === 'stagger' || e.state === 'stun';
    // the phase-3 exposed core: the boss's own 'kneel' state (a brain without one: the 90 f
    // window after the bossPhase(3) signal)
    const kneel = e.boss && (typeof e.hpFloor === 'number'
      ? e.state === 'kneel'
      : !!this._kneel && this._kneel.boss === e && this.enemyTime < this._kneel.until);
    const chance = CRIT.base + (rear ? CRIT.rear : 0) + (exposed ? CRIT.exposed : 0) + (meta.finisher ? CRIT.finisher : 0);
    const crit = kneel || critRoll < chance;
    let damage = Math.max(1, Math.round(pc.atk * mv * roll * mitigation(e.def.def ?? 0) * (crit ? CRIT.mult : 1) * (e.vuln || 1)));
    if (e.boss) damage = this._bossClamp(e, damage, kneel);
    const kill = damage >= e.hp;
    e.hp = Math.max(0, e.hp - damage);
    info.damage = damage;
    info.crit = crit;
    e.hitFlash = ENEMY_FLASH_TIME;
    e._barT = this.clock;
    if (e.kind === 'dummy') e._refillFrom = this.enemyTime;
    // reactions / death
    if (e.hp <= 0) this._kill(e);
    else {
      e.receiveHit(info, this.ctx);
      if (st) this._applyStatus(e, st);
    }
    // feedback
    const hy = this.bodyBase(e);
    if (damage > 0) this.number(x, yNum, z, String(damage), crit ? 'crit' : 'dmg');
    else this.number(x, yNum, z, 'Guard', 'guard');
    this._impactStar(e, crit, dx, dz);
    this.burst('hitSpark', x - dx * 0.25, hy + Math.min(1.1, e.def.body[1] * 0.55), z - dz * 0.25, crit ? 10 : 6);
    this.sfxAt(crit ? 'crit' : 'hit', x, z, { volume: 0.9 });
    const stopBase = e.boss ? HIT_STOP.boss : meta.stop;
    this._hitStop(playerHitStop(stopBase, crit, kill && e.hp <= 0, e.boss), e);
    const sh = crit ? SHAKE.crit : meta.finisher ? SHAKE.finisher : kill ? SHAKE.kill : SHAKE.hit;
    this.shake(sh[0], sh[1]);
    if (meta.source === 'melee') pc.onMeleeLanded(swing);
    if (meta.combo === 3 && e.kind === 'dummy') this.tutorial.combo = true;
    this.events.emit('hit', e, damage, crit, meta.source);
  }

  /**
   * A player-side hit's status effects on a living foe it hurt (§29 V5; not a guarded hit): a freeze
   * (a boss: a chill instead), a stun (not a boss or a passive kind) with dizzy stars over it while
   * it lasts, a chill (`slow` 0: 0.35). The enemy enters its hold at its next update.
   * @param {Enemy} e
   * @param {HitStatus} st
   */
  _applyStatus(e, st) {
    const fr = st.freeze ?? 0;
    const sn = st.stun ?? 0;
    const ch = st.chill ?? 0;
    const mk = st.mark ?? 0;
    if (!e.alive || !(fr > 0 || sn > 0 || ch > 0 || mk > 0)) return;
    // resonance marks (§30.4): +n, capped, the 6 s renewed
    if (mk > 0) e.addMarks(mk);
    if (fr > 0) e.freeze(fr);
    if (sn > 0 && !e.boss && !e.passive) {
      e.stun(sn);
      const p = e.position;
      this.fx.stopFollowing(p);
      // (the stars circle 0.35 u over its head: the effect lifts itself 1.6 u — the boar's rule)
      this.fx.play('stun', p.x, this.bodyBase(e) + e.def.body[1] - 1.25, p.z, { follow: p, duration: Math.min(30, sn) });
    }
    if (ch > 0) e.chill(ch, st.slow ?? 0);
  }

  /**
   * A big player-side hit's feel (§29 V6): hit-stop (`stop` frames, capped) with the first foe it hit
   * jittering, and a camera shake (capped at 0.6 u, 1.5 s).
   * @param {HitFeel} feel
   * @param {Enemy} victim
   */
  _applyFeel(feel, victim) {
    const stop = Number(feel.stop) || 0;
    if (stop > 0) this._hitStop(F(Math.min(HIT_STOP.cap, stop)), victim);
    const sh = feel.shake;
    if (Array.isArray(sh) && sh.length >= 2) {
      const amp = clamp(Number(sh[0]) || 0, 0, FEEL_SHAKE_MAX[0]);
      const dur = clamp(Number(sh[1]) || 0, 0, FEEL_SHAKE_MAX[1]);
      if (amp > 0 && dur > 0) this.shake(amp, dur);
    }
  }

  /**
   * A warded hit: a gold glint on the one the ward spared.
   * @param {{ x: number, y: number, z: number }} p
   */
  _wardGlint(p) {
    this.burst('magicBurst', p.x, p.y + 1.1, p.z, 4, WARD_GLINT);
  }

  /**
   * The boss's HP floors (§8.3): never below the next phase threshold while it is pending or
   * running, and at most 8 % of max HP during the phase-3 kneel. The Enemy's own `hpFloor`
   * (when it provides one) is authoritative.
   * @param {Enemy} e
   * @param {number} damage
   * @param {boolean} kneel
   * @returns {number}
   */
  _bossClamp(e, damage, kneel) {
    let floor = 0;
    if (typeof e.hpFloor === 'number') floor = e.hpFloor;
    else {
      const ph = e.def.phases ?? [0.7, 0.35];
      const phase = Math.max(e.phase || 1, this._bossPhaseSeen ?? 1);
      if (phase <= ph.length) floor = Math.ceil(e.hpMax * ph[phase - 1]);
      if (kneel) floor = Math.max(floor, e.hp - Math.max(0, this._kneel.cap - this._kneel.taken));
    }
    if (kneel && typeof e.hpFloor !== 'number') {
      const room = Math.max(0, this._kneel.cap - this._kneel.taken);
      damage = Math.min(damage, room);
    }
    damage = Math.max(0, Math.min(damage, e.hp - floor));
    if (kneel && this._kneel) this._kneel.taken += damage;
    return damage;
  }

  /**
   * An enemy's HP reached 0: die, XP, loot, events; the boss's victory.
   * @param {Enemy} e
   * @param {{ loot?: boolean, release?: boolean }} [opts] loot: XP and loot (false: remaining adds);
   *   release: a release, not a death (§30.7; its def's `release` by default)
   */
  _kill(e, { loot = true, release = !!e.def.release } = {}) {
    const x = e.position.x;
    const y = e.position.y;
    const z = e.position.z;
    // a release (§30.7): dead to the fight, its body its brain's (`Enemy.released`)
    if (release) e.released = true;
    e.die(this.ctx);
    this._releaseToken(e);
    this.fx.stopFollowing(e.position);
    this.kills += e.passive ? 0 : 1;
    if (!release) this.sfxAt('enemyDie', x, z, { volume: 0.9 });
    const rewarded = loot && !e.passive && !e.isAdd;
    if (rewarded) {
      this._bossKillXp = e.boss;
      this.pc.gainXp(e.def.xp ?? 0);
      this._bossKillXp = false;
      if (e.boss) this._bossLoot(e);
      else this._dropLoot(e, x, y, z);
    }
    e.deathCount++;
    this.events.emit('kill', e);
    if (e.boss) this._bossDefeated(e);
  }

  /** @param {Enemy} e @param {number} x @param {number} y @param {number} z */
  _dropLoot(e, x, y, z) {
    const rng = lootRng(e.uid, e.deathCount, this.seedValue);
    const r = rollLoot(e.def, rng, this.pc.hp < this.pc.hpMax * HEART_BOOST_HP, this._loot ??= { gold: 0, heart: false, mana: false, draught: false });
    this.dropGold(r.gold, x, y, z, rng);
    if (r.heart) this.pickups.drop('heart', 1, x, y, z, rng);
    if (r.mana) this.pickups.drop('mana', 1, x, y, z, rng);
    if (r.draught) this.pickups.drop('draught', 1, x, y, z, rng);
  }

  /**
   * Gold as coin pickups (25 / 5 / 1, at most 6).
   * @param {number} gold
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {RNG} rng
   */
  dropGold(gold, x, y, z, rng) {
    if (!(gold > 0)) return;
    const coins = this._coins ??= Array.from({ length: 6 }, () => ({ kind: 'coin1', amount: 0 }));
    const n = splitCoins(gold, coins);
    for (let i = 0; i < n; i++) this.pickups.drop(coins[i].kind, coins[i].amount, x, y, z, rng);
  }

  /**
   * Would this pickup give the player anything now? A heart at full HP, a mana mote at full MP
   * and a draught at the carry cap stay on the ground (§7.8; Pickups asks before magnetising,
   * every frame of the magnet and before collecting).
   * @param {string} kind
   * @returns {boolean}
   */
  wantsPickup(kind) {
    const pc = this.pc;
    if (kind === 'heart') return pc.hp < pc.hpMax;
    if (kind === 'mana') return pc.mp < pc.mpMax - EPS;
    if (kind === 'draught') return pc.potions < POTION_MAX;
    return true;
  }

  /**
   * An upgrade as the loot feed and its toast name it ("Max HP +20", "Cinderheart Core · Max HP
   * +20"), in the page's language.
   * @param {string} what 'maxHp' | 'maxMp' | 'attack' | 'core'
   * @returns {string}
   */
  upgradeText(what) {
    if (what === 'maxHp') return t('combat.upgrade.maxHp', { n: UPGRADES.maxHp });
    if (what === 'maxMp') return t('combat.upgrade.maxMp', { n: UPGRADES.maxMp });
    if (what === 'attack') return t('combat.upgrade.attack', { n: UPGRADES.attack });
    if (what === 'core') return `${t('combat.upgrade.core')}${sep()}${t('combat.upgrade.maxHp', { n: UPGRADES.core })}`;
    return t('combat.upgrade.other');
  }

  /**
   * An upgrade's toast as a sentence of the page's language ('最大HPが20上がった', not
   * '最大HP +20を手に入れた'; the English reads as before: "Obtained: Max HP +20").
   * @param {string} what 'maxHp' | 'maxMp' | 'attack' | 'core'
   * @returns {string}
   */
  _upgradeToast(what) {
    if (what === 'maxHp' || what === 'maxMp' || what === 'attack') return t(`combat.upgraded.${what}`, { n: UPGRADES[what] });
    if (what === 'core') return t('combat.upgraded.core', { item: t('combat.upgrade.core'), n: UPGRADES.core });
    return t('combat.obtained', { item: t('combat.upgrade.other') });
  }

  /**
   * An enemy's name as the player reads it (the bars of elites, the boss bar and banner),
   * translated at display — `e.name` stays the English (identity, `state()`): a named group's
   * name as a term (`term`, docs/specs/I18N.md §4.8), else its kind's name ("Elite …" for an
   * elite). Cached per enemy (the page's language never changes).
   * @param {Enemy} e
   * @returns {string}
   */
  displayName(e) {
    let n = this._shownNames.get(e);
    if (n !== undefined) return n;
    const key = `combat.enemy.${e.kind}`;
    const kindName = t(key);
    const base = kindName === key ? e.def.name : kindName;
    const g = e.isAdd ? null : /** @type {LevelObjectOf<'enemy'>|undefined} */ (this._groupOf.get(e));
    const own = g?.name ? String(g.name) : '';
    // a group named as its kind (Cinderwatch's 'Cinderheart') reads as the kind's name where the
    // content tables have no term for it (asked quietly: then the untranslated term is no miss)
    const shown = own ? quietly(() => term(own)) : '';
    const asKind = !!own && shown === own && own === e.def.name;
    if (own && !asKind) term(own);
    n = own ? (asKind ? base : shown) : e.elite ? t('combat.elite', { name: base }) : base;
    this._shownNames.set(e, n);
    return n;
  }

  /**
   * A pickup reached the player.
   * @param {string} kind
   * @param {number} amount
   * @param {string} extra an upgrade's kind
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {boolean} false when it gave nothing (it stays on the ground)
   */
  collectPickup(kind, amount, extra, x, y, z) {
    const pc = this.pc;
    const feed = this.ui.combat?.hud;
    const p = this.player.position;
    if (!this.wantsPickup(kind)) return false;
    if (kind.startsWith('coin')) {
      pc.gold += amount;
      // (one feed line for coins collected in a row: `_goldFeedStep`, §29 V18)
      if (this._goldFeed === 0) this._goldFeedAge = 0;
      this._goldFeed += amount;
      this._goldFeedT = GOLD_FEED.quiet;
      this.audio.playSfx('coin', { volume: 0.55, pitch: kind === 'coin25' ? 0.85 : kind === 'coin5' ? 1 : 1.12 });
    } else if (kind === 'heart') {
      const got = pc.heal(Math.round(pc.hpMax * HEART_HEAL));
      feed?.loot(t('combat.loot.heart', { n: got }), 'heart');
      this.audio.playSfx('pickup', { volume: 0.6 });
    } else if (kind === 'mana') {
      const before = pc.mp;
      pc.mp = Math.min(pc.mpMax, pc.mp + MANA_MOTE);
      const got = Math.max(1, Math.round(pc.mp - before));
      if (got > 0) this.number(p.x, p.y + 1.9, p.z, `+${got}`, 'mp');
      feed?.loot(t('combat.loot.mana', { n: got }), 'mana');
      this.audio.playSfx('pickup', { volume: 0.6, pitch: 1.15 });
    } else if (kind === 'draught') {
      pc.potions = Math.min(POTION_MAX, pc.potions + 1);
      feed?.loot(t('combat.loot.draught'), 'draught');
      this.audio.playSfx('pickup', { volume: 0.7 });
    } else if (kind === 'upgrade' || kind === 'core') {
      const what = kind === 'core' ? 'core' : extra;
      pc.upgrade(/** @type {UpgradeKind} */ (what)); // (a chest's kind, checked when it was read)
      const text = this.upgradeText(what);
      feed?.loot(text, kind === 'core' ? 'core' : 'upgrade');
      this.ui.hud.toast(this._upgradeToast(what), 2.4);
      this.audio.playSfx('levelup', { volume: 0.5 });
      // (the level-up's sparkles, below the bloom threshold and around the head: the hdr-6
      // 'sparkle' on the chest whited the player out when the core was collected, COMBAT-16)
      this.burst('levelSparkle', p.x, p.y + 1.9, p.z, 12);
    }
    this.events.emit('pickup', kind, amount);
    return true;
  }

  /**
   * An enemy hit on the player (§6.3, §6.8): flat damage (magma) or ATK·mv·roll·mit, reaction,
   * hit-stop 6 f, shake, red flash, vignette pulse, SFX, number; events `hit('player', damage,
   * false, source)` (source 'melee' | 'projectile' | 'hazard' for flat damage) and `playerHurt`.
   * @param {Enemy|'player'|null} owner
   * @param {number} mv
   * @param {number} kb
   * @param {boolean} knockdown
   * @param {number} flat
   * @param {number} fromX
   * @param {number} fromZ
   * @param {'melee'|'projectile'} [source]
   */
  _hitPlayer(owner, mv, kb, knockdown, flat, fromX, fromZ, source = 'melee') {
    if (this._ambient) return;
    const pc = this.pc;
    const p = this.player.position;
    // (a ward over the party takes its share of every hit, §29 V7)
    const wf = this._wards.length ? this.wardFrac : 0;
    if (flat > 0) {
      const f = wf > 0 ? Math.max(1, Math.round(flat * (1 - wf))) : flat;
      pc.hurtFlat(f);
      this.number(p.x, p.y + 1.9, p.z, String(f), 'hurt');
      this.look.pulseHurt();
      if (wf > 0) this._wardGlint(p);
      this.events.emit('hit', 'player', f, false, 'hazard');
      if (!pc.alive) return;
      this.events.emit('playerHurt', f);
      return;
    }
    let dx = p.x - fromX;
    let dz = p.z - fromZ;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = -this.player.facing.x; dz = -this.player.facing.z; }
    if (!(mv > 0)) {
      // a push without damage (the boss's phase-2 ring, mv 0, §8.3): the slide only
      if (kb > 0) pc.shove(kb, dx, dz);
      this.shake(SHAKE.hurt[0] * 0.6, SHAKE.hurt[1]);
      return;
    }
    const atk = owner && owner !== 'player' ? owner.def?.atk ?? 10 : 10;
    const roll = 0.92 + 0.16 * this.rng.next();
    const damage = Math.max(1, Math.round(atk * mv * roll * mitigation(pc.def) * (1 - wf)));
    if (wf > 0) this._wardGlint(p);
    const res = pc.hurt({ damage, kb, kbDirX: dx, kbDirZ: dz, knockdown });
    this.number(p.x, p.y + 1.9, p.z, String(damage), 'hurt');
    this.look.pulseHurt();
    this.sfxAt('hurt', p.x, p.z, { volume: 1 });
    this.burst('hitSpark', p.x, p.y + 1.0, p.z, 6);
    this._hitStop(F(HIT_STOP.playerHurt), 'player');
    const sh = res === 'knockdown' ? SHAKE.knockdown : SHAKE.hurt;
    this.shake(sh[0], sh[1]);
    this.events.emit('hit', 'player', damage, false, source);
    this.events.emit('playerHurt', damage);
  }

  /**
   * Mend (shaman): HP capped, green number, healGlow 8.
   * @param {Enemy} target
   * @param {number} amount
   */
  _healEnemy(target, amount) {
    if (!target || !target.alive) return;
    const before = target.hp;
    target.hp = Math.min(target.hpMax, target.hp + Math.max(0, amount));
    const got = Math.round(target.hp - before);
    const p = target.position;
    if (got > 0) this.number(p.x, this.bodyBase(target) + target.def.body[1] + 0.2, p.z, `+${got}`, 'heal');
    this.burst('healGlow', p.x, this.bodyBase(target) + 0.8, p.z, 8);
    target._barT = this.clock;
  }

  /**
   * A noticing enemy wakes its group and any enemy of its own zone within 6 u in line of sight
   * (COMBAT-19: never the pack of another zone; the quarry terrace's goblins, bats and west boar
   * are one zone and still wake together).
   * @param {Enemy} e
   */
  _wakeGroup(e) {
    const gid = e.groupId;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === e || !o.alive || o.isAdd || o.boss || this._hidden.has(o)) continue;
      if (o.groupId === gid && gid) o.wake(this.ctx);
      else if (!o.aggro && o.zone === e.zone && Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z) <= 6
        && this.los(e.position.x, e.position.z, o.position.x, o.position.z)) o.wake(this.ctx);
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {Enemy[]} [out]
   * @returns {Enemy[]}
   */
  _enemiesNear(x, z, r, out = []) {
    out.length = 0;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
      if (Math.hypot(e.position.x - x, e.position.z - z) <= r) out.push(e);
    }
    return out;
  }

  /**
   * Boss adds: a pooled bat of `boss`, placed, shown and woken (null when the pool is used up).
   * @param {Enemy|null} boss
   * @param {EnemyKind} kind
   * @param {number} x
   * @param {number} z
   * @returns {Enemy|null}
   */
  _spawnAdd(boss, kind, x, z) {
    const pool = boss ? this._addsOf.get(boss) : null;
    if (!pool) return null;
    const e = pool.find((a) => a.kind === kind && (this._hidden.has(a) || (!a.alive && a.sprite.opacity <= 0.001)));
    if (!e) return null;
    this._hidden.delete(e);
    e.home.x = x;
    e.home.z = z;
    e.reset(this.ctx);
    e.dormant = false;
    e.wake(this.ctx);
    this.burst('deathPoof', x, this.groundAt(x, z) + 1.2, z, 8);
    return e;
  }

  // =============================================================================================
  // Boss signals (§8.1, §8.3)
  // =============================================================================================

  /**
   * @param {BossSignal} event
   * @param {Enemy} e
   * @param {number} [a] `bossPhase`: the new phase
   */
  _onSignal(event, e, a) {
    if (!e) return;
    const arena = /** @type {BossArena|null} */ (e.arena); // (core's enemies carry a BossArena)
    if (event === 'bossIntro') {
      // the arena closes on the player inside it; an intro on appearing (the player outside, §29 V3)
      // closes it when the player walks in (`_closeCheck`)
      const inside = !!arena && this._playerInArena(arena, 0);
      if (inside) arena.close();
      else this._closePending = arena;
      this._introT = INTRO_LOCK;
      this._bossFight = e;
      this._boss = e;
      this._bossAwake = false;
      this._fightStart = this.clock;
      this._phaseStart = this._phaseSlots(e);
      this._phaseStart[0] = this.clock;
      this._phaseTimes = this._phaseSlots(e);
      this._bossPhaseSeen = 1;
      this.targeting.release();
      // every other enemy aggroed or inside the arena goes home (inside: at once)
      for (const o of this.enemies) {
        if (o === e || !o.alive || o._boss === e || this._hidden.has(o)) continue;
        const inside = arena?.contains ? arena.contains(o.position.x, o.position.z) : false;
        if (!o.aggro && !inside) continue;
        this._sendHome(o, inside);
      }
      this.projectiles.clearEnemy();
      // the companions near the player come in with them (PARTY.md §5.3) — in a scene, at its end
      if (inside && this.allies.length) {
        if (this._ambient) this._pullPending = arena;
        else this._alliesIntoArena(arena);
      }
    } else if (event === 'bossAwake') {
      // woken in a story scene (§29 V3): the bar and the framing when the scene ends, no banner
      // (the story names it: a title card)
      if (this._ambient) this._awakePending = e;
      else this._showBoss(e, true);
    } else if (event === 'bossPhase') {
      const n = Number(a) || 2;
      this._hitStop(F(HIT_STOP.bossPhase), e);
      this.look.pulsePhase();
      this._bossPhaseSeen = n;
      if (n >= 2 && n <= this._phaseTimes.length) {
        this._phaseTimes[n - 2] = this.clock - this._phaseStart[n - 2];
        this._phaseStart[n - 1] = this.clock;
      }
      this.ui.combat?.boss.set(e.hp / e.hpMax, n);
      if (n >= 2) {
        const i = this.arenas.indexOf(arena);
        if (i >= 0 && this._emitters[i]) this._emitters[i].enabled = true;
        // (the boss track's section for the phase: B, the dragon's C in phase 3 — CombatMusic.setPhase)
        this.music.setPhase(n);
      }
      if (n === 3) this._kneel = { boss: e, until: this.enemyTime + KNEEL_TIME, cap: Math.round(e.hpMax * KNEEL_CAP), taken: 0 };
      this.events.emit('bossPhase', n);
    }
  }

  /**
   * The boss awakes (`bossAwake`): the bar (phases: one more than the def's thresholds — the
   * golem's 3), the boss framing and — unless it woke in a story scene, which names it with its own
   * title — the name banner.
   * @param {Enemy} e
   * @param {boolean} banner
   */
  _showBoss(e, banner) {
    this._bossAwake = true;
    // (shown translated: the group's name from the content tables, the epithet by kind)
    const shown = this.displayName(e);
    const ek = `combat.epithet.${e.kind}`;
    const epithet = e.def.epithet ? (t(ek) !== ek ? t(ek) : e.def.epithet) : '';
    const nk = `combat.enemy.${e.kind}`;
    if (banner) this.ui.banner.show(shown || (t(nk) !== nk ? t(nk) : e.def.name), epithet, { duration: 3 });
    this.ui.combat?.boss.show({ name: shown, epithet, phases: (e.def.phases?.length ?? 0) + 1 });
    this.ui.combat?.boss.set(e.hp / e.hpMax, Math.max(1, this._bossPhaseSeen ?? 1));
    this.targeting.setBoss(e);
  }

  /**
   * The phase-time slots of a boss's fight: one per phase (its thresholds + 1; the golem's 3).
   * @param {Enemy} e
   * @returns {number[]}
   */
  _phaseSlots(e) {
    const n = Math.max(1, Math.min(8, (Array.isArray(e.def.phases) ? e.def.phases.length : 2) + 1));
    return new Array(n).fill(0);
  }

  /**
   * Does the player stand inside the arena (its floor height, `inset` u within the rect)?
   * @param {BossArena} a
   * @param {number} inset
   * @returns {boolean}
   */
  _playerInArena(a, inset) {
    const P = this.player.position;
    const r = a.rect;
    return P.x >= r.minX + inset && P.x <= r.maxX - inset && P.z >= r.minZ + inset && P.z <= r.maxZ - inset && Math.abs(P.y - a.y) < 1.0;
  }

  /**
   * A boss fight that began with the player outside its arena (an intro on appearing, §29 V3): the
   * arena closes once the player stands well inside it (`ARENA_ENTER_INSET`), the companions near
   * the player come in.
   */
  _closeCheck() {
    const a = this._closePending;
    if (!a) return;
    if (!this._bossFight || this._bossFight.arena !== a || !this._bossFight.alive || a.active) {
      this._closePending = null;
      return;
    }
    // its boss gave up and climbed back to the sky (dormant again, ai/dragon.js 'outside'): the
    // fight ends — the bar and the framing go, the music and the engagement settle, rests work; its
    // brain's dormant rule starts the next intro when the player comes in
    if (this._bossFight.state === 'dormant') {
      this._resetBoss();
      return;
    }
    if (!this.pc.alive || !this._playerInArena(a, ARENA_ENTER_INSET)) return;
    this._closePending = null;
    a.close();
    if (this.allies.length) this._alliesIntoArena(a, true);
  }

  /**
   * The arena closes: every companion within `ALLY.arenaPull` u of the player is placed inside,
   * behind the player (fanned out, on standable ground within the rect); the others wait at the
   * gate (MemberCombat: `wait`) until it opens. With `stay` a companion already inside stays where
   * it is (an arena closed in a story scene, or after the player walked in: §29 V3).
   * @param {BossArena} arena
   * @param {boolean} [stay]
   */
  _alliesIntoArena(arena, stay = false) {
    const P = this.player.position;
    const f = this.player.facing;
    const r = arena.rect;
    let k = 0;
    for (const a of this.allies) {
      if (a.gone || !a.member.sprite) continue;
      const q = a.position;
      if (Math.hypot(q.x - P.x, q.z - P.z) > ALLY.arenaPull) continue;
      if (stay && q.x > r.minX + 0.8 && q.x < r.maxX - 0.8 && q.z > r.minZ + 0.8 && q.z < r.maxZ - 0.8) continue;
      const side = (k % 2 === 0 ? 1 : -1) * (0.75 + 0.6 * Math.floor(k / 2));
      k++;
      let placed = false;
      for (const back of [1.4, 0.8, 0.3]) {
        const x = Math.min(r.maxX - 0.8, Math.max(r.minX + 0.8, P.x - f.x * back - f.z * side));
        const z = Math.min(r.maxZ - 0.8, Math.max(r.minZ + 0.8, P.z - f.z * back + f.x * side));
        if (!this.standable(x, z)) continue;
        a.placeAt(x, z);
        placed = true;
        break;
      }
      if (!placed) a.placeAt(Math.min(r.maxX - 0.8, Math.max(r.minX + 0.8, P.x)), Math.min(r.maxZ - 0.8, Math.max(r.minZ + 0.8, P.z)));
    }
  }

  /**
   * Send an enemy home (return, guarded); `now`: place it at home at once.
   * @param {Enemy} o
   * @param {boolean} now
   */
  _sendHome(o, now) {
    this._releaseToken(o);
    this._freeMarkersOf(o);
    this.projectiles.removeOwner(o);
    if (now) {
      o.reset(this.ctx);
      return;
    }
    if (typeof o.sendHome === 'function') o.sendHome(this.ctx);
    else o.reset(this.ctx);
  }

  /** @param {Enemy} e */
  _bossLoot(e) {
    // dropped 1.2 u beyond the boss from the player (like its death bursts, COMBAT-16): the coins'
    // arcs no longer glow over the player's head at the kill
    let x = e.position.x;
    let z = e.position.z;
    const P = this.player.position;
    const dx = x - P.x;
    const dz = z - P.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3 && this.standable(x + (dx / d) * 1.2, z + (dz / d) * 1.2)) {
      x += (dx / d) * 1.2;
      z += (dz / d) * 1.2;
    }
    const y = this.groundAt(x, z);
    const rng = lootRng(e.uid, e.deathCount, this.seedValue);
    const g = e.def.gold ?? [150, 150];
    this.dropGold(Math.round(g[1]), x, y, z, rng);
    // its def's drop (§30.7): the Cinderheart Core, an upgrade of a kind, or none
    const v = e.def.victory;
    const drop = v?.drop === undefined ? 'core' : v.drop;
    if (drop === 'core') this.pickups.drop('core', 1, x, y, z, rng);
    else if (drop === 'maxHp' || drop === 'maxMp' || drop === 'attack') this.pickups.drop('upgrade', 1, x, y, z, rng, drop);
  }

  /** @param {Enemy} e */
  _bossDefeated(e) {
    const x = e.position.x;
    const y = e.position.y;
    const z = e.position.z;
    this._hitStop(F(HIT_STOP.bossDeath), e);
    this._slowMotion(0.4, 0.4, 1.5);
    // (COMBAT-16: dimmer bursts beyond the boss, so a kill in melee range leaves the player readable;
    // a released boss bursts nothing of core's — its brain shows the release, §30.7)
    if (e.released) { /* the brain's */ } else if (e.arena?.deathBursts) e.arena.deathBursts(e);
    else {
      for (let k = 0; k < 3; k++) this.burst('emberBurst', x + (k - 1) * 0.8, y + 1.2 + k * 0.6, z, 24);
      this.burst('sparkle', x, y + 2, z, 24);
    }
    this.shake(SHAKE.bossDeath[0], SHAKE.bossDeath[1]);
    this.music.victory();
    e.arena?.open?.();
    // (a release — the frost lets go: its arena's phase-2 emitter stops; Cinderwatch's embers stay, EV-51)
    if (e.released) {
      const i = this.arenas.indexOf(/** @type {BossArena} */ (e.arena));
      if (i >= 0 && this._emitters[i]) this._emitters[i].enabled = false;
    }
    this.bossDefeated = true;
    {
      const i = Math.max(0, Math.min(this._phaseTimes.length - 1, (this._bossPhaseSeen ?? 1) - 1));
      this._phaseTimes[i] = this.clock - this._phaseStart[i];
    }
    this._fightTime = this.clock - this._fightStart;
    this._bossFight = null;
    this._bossAwake = false;
    this._kneel = null;
    this.targeting.setBoss(null);
    // remaining adds die without loot — released with a released boss (no creature is killed, EV-78)
    for (const a of this._addsOf.get(e) ?? []) if (a.alive && !this._hidden.has(a)) this._kill(a, e.released ? { loot: false, release: true } : { loot: false });
    this._dropBossMarker(e);
    this.events.emit('bossDefeated', e);
    // the banner once the slow motion eases, the results card 1.5 s after the stinger (§6.12); the
    // banner's words are its def's (`victory`, §30.7; a null line: none)
    const v = e.def.victory;
    const title = v?.title ?? 'combat.victory.title';
    const line = v?.line === undefined ? 'combat.victory.sub' : v.line;
    if (line !== null) this._later(0.4, () => this.ui.banner.show(t(title), t(line), { duration: 3.4 }));
    // (`results: false`: no results card — a boss whose defeat a cutscene carries on, §30.7)
    if (v?.results !== false) this._later(1.5, () => this._resultsCard());
    // (no results card: the level-up the kill granted shows on its own, after the scene)
    else this._later(1.5, () => {
      const lv = this._levelAfterResults;
      this._levelAfterResults = null;
      if (!lv) return;
      this.ui.combat?.announcer.announce(t('combat.level.title', { n: lv.level }), lv.gains, { duration: 2.6, kind: 'level', y: this._announceAt('level') });
      this._levelUpFlare();
    });
    // (a defeat a cutscene carries on — `results: false`: the bar goes at once; a timer runs on the
    // combat's clock, which the scene holds, and would show the bar again for 2 s after it)
    if (v?.results === false) this.ui.combat?.boss.hide();
    else this._later(2.0, () => this.ui.combat?.boss.hide());
  }

  /**
   * The boss's arena marker leaves the map (its defeat).
   * @param {Enemy} e
   */
  _dropBossMarker(e) {
    for (let i = this._bossMarkers.length - 1; i >= 0; i--) {
      const m = this._bossMarkers[i];
      if (m.arena !== e.arena) continue;
      const k = this._map?.markers.indexOf(m) ?? -1;
      if (k >= 0) this._map.markers.splice(k, 1);
    }
  }

  _resultsCard() {
    const secs = Math.round(this.clock);
    const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const pc = this.pc;
    // (the level's name translated at display: `level.name` seeds the noise and stays English)
    const line = [mmss, tn('combat.results.foes', this.kills), tn('combat.results.falls', pc.deaths),
      tn('combat.results.dodges', pc.perfectDodges), t('combat.results.lv', { n: pc.level })].join(sep());
    this.ui.combat?.announcer.announce(t('combat.results.title', { place: term(this.level.name) }), line,
      { duration: 7, kind: 'results', y: this._announceAt('results') });
    // a level-up granted by the boss's kill: its card follows the results (the announcer queues)
    // and its pillar, sparkles and chime play now, not over the boss's death bursts (COMBAT-16)
    const lv = this._levelAfterResults;
    this._levelAfterResults = null;
    if (lv) {
      this.ui.combat?.announcer.announce(t('combat.level.title', { n: lv.level }), lv.gains, { duration: 2.6, kind: 'level', y: this._announceAt('level') });
      this._levelUpFlare();
    }
  }

  /**
   * Where an announcement's card goes (the Announcer's `y`, read when the card shows — it may wait
   * in the queue): below the area banner while one shows (a region's foes woken by entering it, a
   * kill levelling the player under 'MOSSY GLADE'; the VICTORY banner over the results card) — the
   * level card at 108 art px, the results window at 104, under the banner's lower rule (93–97) and
   * its shade —, else the card's own place (null).
   * @param {'level'|'results'} kind
   * @returns {() => (number|null)}
   */
  _announceAt(kind) {
    return () => (this.ui.banner?.visible ? (kind === 'results' ? 104 : 108) : null);
  }

  /**
   * Run `fn` after `seconds` of active combat (real time).
   * @param {number} seconds
   * @param {() => void} fn
   */
  _later(seconds, fn) {
    this._timers.push({ t: seconds, fn });
  }

  // =============================================================================================
  // Player events
  // =============================================================================================

  onPerfectDodge() {
    const p = this.player.position;
    this._slowMotion(1, PERFECT.enemyScale, PERFECT.time);
    this.number(p.x, p.y + 2.1, p.z, 'Perfect!', 'perfect');
    this.sfxAt('perfect', p.x, p.z, { volume: 1 });
    this.look.pulsePerfect();
    this.burst('sparkle', p.x, p.y + 1, p.z, 10);
  }

  /**
   * Level-up: the card (smaller and higher on screen while engaged, so it does not cover the
   * fight; after the results card when the boss's kill granted it), pillar, sparkles, SFX.
   * @param {number} level
   * @param {string} gains the card's text
   */
  onLevelUp(level, gains) {
    if (this._bossKillXp) {
      // (the boss's kill: card, pillar and sparkles wait for the results card, 1.5 s later)
      this._levelAfterResults = { level, gains };
    } else {
      this.ui.combat?.announcer.announce(t('combat.level.title', { n: level }), gains, { duration: 2.6, kind: 'level', compact: this.engaged, y: this._announceAt('level') });
      this._levelUpFlare();
    }
    // the party levels with the player: the companions are refreshed with it
    for (const a of this.allies) {
      a.syncLevel();
      if (a.down) continue;
      a.hp = a.hpMax;
      a.mp = a.mpMax;
    }
    this.events.emit('levelup', level);
  }

  /** The level-up pillar, sparkles and chime on the player. */
  _levelUpFlare() {
    const p = this.player.position;
    this.fx.play('pillar', p.x, p.y, p.z, { follow: p, duration: F(60) });
    this.burst('levelSparkle', p.x, p.y + 1.9, p.z, 14);
    this.sfxAt('levelup', p.x, p.z, { volume: 1 });
  }

  /**
   * Skill (or draught, i = 3) refused: the slot shakes, SFX cancel.
   * @param {number} i
   */
  refuseSkill(i) {
    this.audio.playSfx('cancel', { volume: 0.5 });
    this.ui.combat?.hud.refuse?.(i);
  }

  onPlayerDeath() {
    const p = this.player.position;
    this._slowMotion(0.3, 0.3, 1.0);
    this.look.startDeath();
    this.sfxAt('playerDown', p.x, p.z, { volume: 1 });
    this.music.death();
    this.targeting.release();
    this.cin.clearBuffer();
    this.locksPlayer = true;
    this._deathT = DEATH_SCREEN_DELAY;
    for (const e of this.enemies) {
      if (!e.alive || e.boss || e.isAdd || e.passive || this._hidden.has(e)) continue;
      if (e.aggro || e.token) this._sendHome(e, false);
    }
    // the companions stop where they stand (PARTY.md §5.3); no foe goes after them
    for (const e of this.enemies) { e.target = null; e.tauntT = 0; }
    for (const a of this.allies) a.onPlayerDeath();
    this.events.emit('playerDeath');
  }

  /**
   * The death screen → fade → reset → checkpoint (the restUntilMorning pattern, §6.11). The
   * `respawn()` test hook bumps `_deathGen` and resets at once; a death screen of an older
   * generation then stops after its await (it would otherwise reset and cut gold a second time).
   */
  async _deathScreen() {
    const game = this.game;
    const ui = this.ui;
    const cp = this.waystones.checkpoint;
    const place = placeName(cp);
    const gen = ++this._deathGen;
    game.busy = true;
    this._respawning = true;
    try {
      game.toggleMap(false);
      await ui.combat.death.show({ title: t('combat.death.title'), subtitle: '', prompt: t('combat.death.prompt', { place }), armDelay: 1.0 });
      if (game._disposed || gen !== this._deathGen) return;
      await ui.fader.fadeOut(0.8);
      if (game._disposed || gen !== this._deathGen) {
        ui.fader.fadeIn?.(0.3);
        return;
      }
      ui.combat.death.hide();
      // (read again: the story may have taken the stone away while the screen waited)
      const at = this.waystones.checkpoint;
      this.resetEncounter();
      this._respawnAt(at);
      await ui.fader.fadeIn(1.0);
      ui.hud.toast(t('combat.death.risen', { place: placeName(at) }), 2.4);
    } finally {
      if (gen === this._deathGen) {
        this._respawning = false;
        game.busy = false;
      }
    }
  }

  /**
   * Put the player at a checkpoint's stand point with the respawn i-frames and guard.
   * @param {Checkpoint} cp
   */
  _respawnAt(cp) {
    const stand = cp.stand ?? cp;
    this.game.teleport(stand.x, stand.z);
    this.pc.iframes = RESPAWN_IFRAMES;
    this.pc.blink = true;
    this.cin.respawnGuard = RESPAWN_GUARD;
    this.cin.clearBuffer();
    this.locksPlayer = false;
    this._deathT = -1;
    this.look.reset();
    this.music.respawn();
    this.events.emit('respawn', cp.id);
  }

  // =============================================================================================
  // After the player moved (§9.1)
  // =============================================================================================

  /**
   * Separation, arena clamp, pickups, checkpoints, chests, dormancy, lock-on / boss focus,
   * engagement, music, sprite speeds, HUD, bars / pips / edge arrows, minimap.
   * In the ambient step (`update` ran it: `ambient` and a set-piece level) the effects, the arena's
   * flames and the engagement's linger go on, the foes it updated play their sprites (§29 V2).
   * @param {number} dt
   * @param {boolean} active
   * @param {boolean} [ambient] (Game.update; the step itself is `update`'s `_ambient`)
   */
  afterPlayer(dt, active, ambient = false) {
    if (!this._ready) return;
    const t0 = performance.now();
    const playing = this.game.mode === 'play';
    const amb = !active && ambient && this._ambient;
    if (active) {
      this._playerVelocity(dt);
      this._separation();
      if (this.allies.length) this._allySeparation();
      this._arenaClamp();
      const adv = this._advanced;
      this.pickups.update(adv);
      this._viewAxis();
      this.fx.update(this._realAdvanced);
      for (const a of this.arenas) a.update(dt);
      if (this._closePending) this._closeCheck();
      this.waystones.update(dt);
      this.chests.update(dt);
      this._dormancy(dt);
      this._engagement(dt);
      this.music.update(dt, this.engaged, !!this._bossFight && this._bossAwake);
      this.pc._applyVisuals(this._realAdvanced, this.clock);
      this._runTimers(dt);
      if (this._deathT > 0 && !this._respawning) {
        this._deathT -= dt;
        if (this._deathT <= 0) this._deathScreen().catch((err) => console.error('[combat] death screen failed:', err));
      }
      this._heartbeatStep(dt);
      if (this._goldFeed > 0) this._goldFeedStep(dt);
    } else if (amb) {
      // the ambient step's world (§29 V2): effects, the arena's wall, the engagement's linger
      this._viewAxis();
      this.fx.update(dt);
      for (const a of this.arenas) a.update(dt);
      this._engagement(dt);
    }
    // the packs' systems (§30.1: the Evermere core part's pulse rings and marks)
    for (let i = 0; i < this.systems.length; i++) this.systems[i].frame?.(dt, active, amb);
    this.pc.refreshPose();
    for (let i = 0; i < this.allies.length; i++) this.allies[i].afterFrame(dt, active, playing, active ? this._realAdvanced : 0);
    // (after the members' visuals: the ice mages' crystals, frost and storms' gust, the other
    // heroes' looks; `dt` is the frame's own time, which runs through a hit-stop)
    for (const l of this.looks) l.update(active ? this._realAdvanced : 0, active, dt, amb);
    this.locksPlayer = !this.pc.alive || this._respawning || this._introT > 0;
    this.targeting.update(dt, active);
    this._seeThrough(dt);
    this._spriteSpeeds(playing, active, amb);
    this._jitterStep();
    this._updateHud(active ? dt : 0);
    this._updateLabels();
    this._updateMinimap();
    this.quads.update();
    this.markers.update();
    const ad = this.game.audioDirector;
    if (ad) {
      const target = this.engaged ? 1 : 0;
      const cur = ad.combatIntensity ?? 0;
      ad.combatIntensity = target > cur ? target : Math.max(0, cur - dt / 3);
    }
    this._programCheck();
    this._tickT += performance.now() - t0;
    // (only frames where combat ran: title / map / dialog frames would flatter the percentiles)
    if (active || amb) this._ticks[this._tickN++ % TICK_SAMPLES] = this._tickT;
    // (read by applyLook and state(); a hook between two frames sees no ambient step)
    this.ambientFrame = amb;
    this._ambient = false;
  }

  /**
   * The loot feed's gold line (rv-play #7: a pack's coins stacked a column of "+1 gold" lines down
   * the screen): coins collected in a row add up into one line — shown once `GOLD_FEED.quiet` s pass
   * without a coin, or `GOLD_FEED.most` s after the first. The gold itself is counted at once.
   * @param {number} dt
   */
  _goldFeedStep(dt) {
    this._goldFeedT -= dt;
    this._goldFeedAge += dt;
    if (this._goldFeedT > 0 && this._goldFeedAge < GOLD_FEED.most) return;
    this._flushGoldFeed();
  }

  /** Show the gold collected since the last line (`_goldFeedStep`), if any. */
  _flushGoldFeed() {
    const n = this._goldFeed;
    this._goldFeed = 0;
    this._goldFeedT = 0;
    this._goldFeedAge = 0;
    if (n > 0) this.ui.combat?.hud?.loot(t('combat.loot.gold', { n }), 'gold');
  }

  /** The effects' view axis: the camera's forward on XZ (their `back`). */
  _viewAxis() {
    const cm = this.engine.camera.matrixWorld.elements;
    const cl = Math.hypot(cm[8], cm[10]) || 1;
    this.fx.viewX = -cm[8] / cl;
    this.fx.viewZ = -cm[10] / cl;
  }

  /**
   * The boss's sprite dithers to SEE_THROUGH while the player stands behind it inside its screen
   * footprint (the 4 u sprite hid the player completely; the x-ray silhouette ignores occluders
   * this close). Eased; only while the boss is alive. Through `Sprite3D.bodyOpacity`: the quad
   * dithers, its shadow and contact blob stay solid (COMBAT-16).
   * @param {number} dt
   */
  _seeThrough(dt) {
    for (let i = 0; i < this._bosses.length; i++) this._seeThroughBoss(this._bosses[i], dt);
  }

  /**
   * `_seeThrough` for one boss (every boss of the level: several boss groups, §29 V3).
   * @param {Enemy} b
   * @param {number} dt
   */
  _seeThroughBoss(b, dt) {
    if (!b || !b.alive || this._hidden.has(b)) return;
    const P = this.player.position;
    const cam = this.engine.camera;
    const m = cam.matrixWorld.elements;
    let behind = false;
    const ex = P.x - b.position.x;
    const ez = P.z - b.position.z;
    // farther from the camera than the boss (camera forward on XZ) …
    const fx = -m[8];
    const fz = -m[10];
    const fl = Math.hypot(fx, fz) || 1;
    if ((ex * fx + ez * fz) / fl > 0.05) {
      // … and inside the sprite's footprint on screen: laterally within its half width, and the
      // player's body (feet … head) overlapping the sprite's height band once projected
      const lateral = Math.abs(ex * m[0] + ez * m[2]);
      // (the boss's sprite box from its def: half width radius + 0.4, top the body's + 0.3 — the
      // golem's 1.6 and 3.9)
      const half = b.def.radius + 0.4;
      if (lateral < half + 0.3) {
        const n = this._ndc;
        this.projectNdc(b.position.x, b.position.y + b.def.body[1] + 0.3, b.position.z, n, 99);
        const top = n.y;
        this.projectNdc(b.position.x, b.position.y, b.position.z, n, 99);
        const bottom = n.y;
        this.projectNdc(P.x, P.y + 0.4, P.z, n, 99);
        const feet = n.y;
        this.projectNdc(P.x, P.y + 1.4, P.z, n, 99);
        const head = n.y;
        behind = Math.max(feet, head) > bottom && Math.min(feet, head) < top;
      }
    }
    const target = behind && this.pc.alive ? SEE_THROUGH : 1;
    const cur = b.sprite.bodyOpacity;
    let next = cur + (target - cur) * Math.min(1, dt * 12);
    if (Math.abs(next - target) < 0.01) next = target;
    if (next !== cur) b.sprite.bodyOpacity = next;
  }

  /** @param {number} dt */
  _playerVelocity(dt) {
    const p = this.player.position;
    const v = this._pv.velocity;
    if (dt > 0) {
      v.x = (p.x - this._prevPos.x) / dt;
      v.z = (p.z - this._prevPos.z) / dt;
    }
    this._prevPos.copy(p);
  }

  /**
   * Inverse-mass separation of overlapping actors (move radii; the player counts with mass 4).
   * The boss keeps the player at its hurt radius (1.2 u) instead of its move radius (0.6 u): at
   * 0.9 u the player stood inside the 4 u sprite, hidden (melee still reaches: 1.6 + 1.2 u).
   */
  _separation() {
    const act = this._act ??= [];
    act.length = 0;
    for (const e of this.enemies) if (e.alive && !e.dormant && e.sprite.visible) act.push(e);
    for (let it = 0; it < SEP_ITER; it++) {
      for (let i = 0; i < act.length; i++) {
        const a = act[i];
        for (let j = i + 1; j < act.length; j++) {
          const b = act[j];
          if (a.flier !== b.flier) continue;
          this._separatePair(a, b, i, j);
        }
      }
    }
    const pc = this.pc;
    if (!pc.alive || pc.dodging) return;
    const p = this.player.position;
    for (let i = 0; i < act.length; i++) {
      const e = act[i];
      if (e.flier) continue;
      const r = pc.radius + (e.boss ? e.radius : (e.def.moveRadius ?? 0.3));
      let dx = p.x - e.position.x;
      let dz = p.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d >= r || Math.abs(p.y - e.position.y) > 1.0) continue;
      if (d < 1e-5) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
      const overlap = r - d;
      const ip = 1 / PLAYER_SEP_MASS;
      // an armoured enemy (a charging boar or boss) plows through: infinite mass against the player
      const ie = !e.armored && !e.frozen && Number.isFinite(e.mass) && e.mass > 0 ? 1 / e.mass : 0;
      const sp = ip / (ip + ie);
      this.player.moveBy(dx * overlap * sp, dz * overlap * sp);
      if (ie > 0) this._separateMove(e, -dx * overlap * (1 - sp), -dz * overlap * (1 - sp));
    }
  }

  /** @param {Enemy} a @param {Enemy} b @param {number} i @param {number} j */
  _separatePair(a, b, i, j) {
    const r = (a.def.moveRadius ?? 0.3) + (b.def.moveRadius ?? 0.3);
    let dx = b.position.x - a.position.x;
    let dz = b.position.z - a.position.z;
    const d = Math.hypot(dx, dz);
    if (d >= r || (!a.flier && Math.abs(a.position.y - b.position.y) > 1.0)) return;
    if (d < 1e-5) {
      const ang = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
      dx = Math.cos(ang);
      dz = Math.sin(ang);
    } else { dx /= d; dz /= d; }
    const overlap = r - d;
    // (a frozen foe stands in its ice: it is not pushed, §29 V5)
    const ia = !a.frozen && Number.isFinite(a.mass) && a.mass > 0 ? 1 / a.mass : 0;
    const ib = !b.frozen && Number.isFinite(b.mass) && b.mass > 0 ? 1 / b.mass : 0;
    if (ia + ib <= 0) return;
    const sa = ia / (ia + ib);
    if (ia > 0) this._separateMove(a, -dx * overlap * sa, -dz * overlap * sa);
    if (ib > 0) this._separateMove(b, dx * overlap * (1 - sa), dz * overlap * (1 - sa));
  }

  /** @param {Enemy} e @param {number} dx @param {number} dz */
  _separateMove(e, dx, dz) {
    if (e.flier) this._moveFly(e, dx, dz);
    else {
      const keep = e.blockedBy;
      this._moveGround(e, dx, dz);
      e.blockedBy = keep;
    }
  }

  _arenaClamp() {
    const p = this.player.position;
    for (const a of this.arenas) if (a.active && this.pc.alive) a.clamp(p, 0.35);
    // companions sealed in with the player are held inside too
    for (const m of this.allies) {
      const ar = m.gone ? null : m._arena;
      if (ar && ar.active) ar.clamp(m.position, 0.35);
    }
  }

  /**
   * The companions in the separation (PARTY.md §5.3), after the enemies' and the player's: an
   * enemy and a companion split the overlap by inverse mass (a companion's is `ALLY.mass`; an
   * armoured enemy plows through), companions split evenly, and a companion gives way to the
   * player entirely (it never pushes the player). Only companions the combat drives, up and not
   * rolling; fliers are not separated (as for the player).
   */
  _allySeparation() {
    const act = this._act ?? [];
    const A = this.allies;
    const sep = this._allySep ??= [];
    sep.length = 0;
    for (const m of A) if (m.present && m.active && m.action !== 'roll') sep.push(m);
    if (!sep.length) return;
    const im = 1 / ALLY.mass;
    for (let i = 0; i < sep.length; i++) {
      const m = sep[i];
      const p = m.position;
      for (let j = 0; j < act.length; j++) {
        const e = act[j];
        if (e.flier) continue;
        const r = ALLY.radius + (e.boss ? e.radius : (e.def.moveRadius ?? 0.3));
        let dx = p.x - e.position.x;
        let dz = p.z - e.position.z;
        const d = Math.hypot(dx, dz);
        if (d >= r || Math.abs(p.y - e.position.y) > 1.0) continue;
        if (d < 1e-5) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
        const overlap = r - d;
        const ie = !e.armored && !e.frozen && Number.isFinite(e.mass) && e.mass > 0 ? 1 / e.mass : 0;
        const sm = im / (im + ie);
        m.push(dx * overlap * sm, dz * overlap * sm);
        if (ie > 0) this._separateMove(e, -dx * overlap * (1 - sm), -dz * overlap * (1 - sm));
      }
    }
    for (let i = 0; i < sep.length; i++) {
      for (let j = i + 1; j < sep.length; j++) {
        const a = sep[i].position;
        const b = sep[j].position;
        const r = ALLY.radius * 2;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= r || Math.abs(a.y - b.y) > 1.0) continue;
        if (d < 1e-5) {
          const ang = ((i * 7 + j * 13) % 16) * (Math.PI / 8);
          dx = Math.cos(ang);
          dz = Math.sin(ang);
        } else { dx /= d; dz /= d; }
        const half = (r - d) / 2;
        sep[i].push(-dx * half, -dz * half);
        sep[j].push(dx * half, dz * half);
      }
    }
    const pc = this.pc;
    if (!pc.alive) return;
    const P = this.player.position;
    for (const m of sep) {
      const p = m.position;
      const r = ALLY.radius + pc.radius;
      let dx = p.x - P.x;
      let dz = p.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d >= r || Math.abs(p.y - P.y) > 1.0) continue;
      if (d < 1e-5) { dx = -this.player.facing.x; dz = -this.player.facing.z; } else { dx /= d; dz /= d; }
      m.push(dx * (r - d), dz * (r - d));
    }
  }

  /** @param {number} dt */
  _dormancy(dt) {
    this._checkT -= dt;
    if (this._checkT > 0) return;
    this._checkT = CHECK_EVERY;
    const p = this.player.position;
    for (const e of this.enemies) {
      if (!e.alive || this._hidden.has(e)) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      // (an enemy walking home keeps walking: it would otherwise wake up away from home)
      if (!e.aggro && e.state !== 'return' && d > DORMANT_RANGE) {
        if (!e.dormant) {
          this._releaseToken(e);
          e.sleep();
        }
      } else if (e.dormant && d <= DORMANT_RANGE) e.dormant = false;
    }
    // faded corpses stop drawing
    for (const e of this.enemies) if (!e.alive && e.sprite.visible && e.sprite.opacity <= 0.001) e.sprite.visible = false;
  }

  /**
   * Force the engaged state (resets): emits `engaged(false)` when it was on (§9.6).
   * @param {boolean} on
   */
  setEngaged(on) {
    this._engageLinger = 0;
    if (this.engaged === !!on) return;
    this.engaged = !!on;
    this.events.emit('engaged', this.engaged);
  }

  /** @param {number} dt */
  _engagement(dt) {
    const p = this.player.position;
    // a boss fight engages — but one whose arena waits for the player (an intro on appearing, the
    // player outside: `_closePending`) only while its boss is within ENGAGE.range, like any foe
    // (EV-17·b: it held `engaged`, and so the rests, for good)
    const bf = this._bossFight;
    let cond = !!bf;
    if (cond && this._closePending && this._closePending === bf.arena) {
      cond = bf.alive && Math.hypot(bf.position.x - p.x, bf.position.z - p.z) <= ENGAGE.range;
    }
    if (!cond) {
      for (const e of this.enemies) {
        if (!e.alive || !e.aggro || e.passive || e.dormant || !e.sprite.visible) continue;
        if (Math.hypot(e.position.x - p.x, e.position.z - p.z) <= ENGAGE.range) { cond = true; break; }
      }
    }
    if (cond) {
      this._engageLinger = ENGAGE.linger;
      if (!this.engaged) {
        this.engaged = true;
        this.events.emit('engaged', true);
      }
    } else if (this.engaged) {
      this._engageLinger -= dt;
      if (this._engageLinger <= 0) {
        this.engaged = false;
        this.events.emit('engaged', false);
      }
    }
  }

  /** @param {number} dt */
  _runTimers(dt) {
    const T = this._timers;
    for (let i = T.length - 1; i >= 0; i--) {
      T[i].t -= dt;
      if (T[i].t <= 0) {
        const fn = T[i].fn;
        T.splice(i, 1);
        fn();
      }
    }
  }

  /** @param {number} dt */
  _heartbeatStep(dt) {
    const pc = this.pc;
    const low = pc.alive && pc.hp < pc.hpMax * LOW_HP;
    if (!low) {
      this._heartbeat = 0;
      return;
    }
    this._heartbeat -= dt;
    if (this._heartbeat <= 0) {
      this._heartbeat = HEARTBEAT;
      this.audio.playSfx('heartbeat', { volume: 0.7 });
    }
  }

  /**
   * Enemy sprites: `speed = !playing ? 1 : (!active || stop > 0 ? 0 : enemyScale)` (§4.3); in the
   * ambient step 1 for the foes it updated (§29 V2); × the status time scale (a chill slows the
   * animation, a freeze stops it; §29 V5).
   * @param {boolean} playing
   * @param {boolean} active
   * @param {boolean} [amb] the ambient step ran
   */
  _spriteSpeeds(playing, active, amb = false) {
    const s = !playing ? 1 : !active || this.stop > 0 ? 0 : this.enemyScale;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      let v = amb && e.ambientRun ? 1 : s;
      if (v > 0 && e.statusOn) v *= e.timeScale;
      e.sprite.speed = v;
    }
  }

  /** Hit-stop victims shake ±1/16 u on alternate frames (mesh.position.x; Sprite3D never writes it). */
  _jitterStep() {
    const V = this._stopVictims;
    if (!V.length) return;
    const on = this.stop > 0;
    const off = (this.frame & 1 ? 1 : -1) / 16;
    for (let i = V.length - 1; i >= 0; i--) {
      const v = V[i];
      const mesh = v === 'player' ? this.player.sprite.mesh : v.sprite.mesh;
      mesh.position.x = on ? off : 0;
      if (!on) V.splice(i, 1);
    }
  }

  /**
   * Build the combat legend again (the game changed `legendExtra`, e.g. the party's *G — Party*
   * line): at once while the combat is loaded.
   */
  refreshLegend() {
    if (this._ready) this._showLegend();
  }

  /** The combat legend (§5.2): the combat rows, then the game's own lines (`legendExtra`). */
  _showLegend() {
    // the rows' labels translated by id (bindings.js keeps the English: tests read it)
    const rows = COMBAT_CONTROLS.filter((r) => !this.legendSkip.includes(r.id)).map((r) => ({ ...r, label: t(`combat.controls.${r.id}`) }));
    this.ui.hud.setControls([...rows, ...this.legendExtra]);
  }

  /** @param {number} dt */
  _updateHud(dt) {
    const hud = this.ui.combat?.hud;
    if (!hud || !this._vitals) return;
    const pc = this.pc;
    const v = this._vitals;
    v.hp = Math.ceil(pc.hp);
    v.hpMax = pc.hpMax;
    v.mp = Math.floor(pc.mp);
    v.mpMax = pc.mpMax;
    v.sp = Math.floor(pc.sp);
    v.spMax = pc.spMax;
    v.level = pc.level;
    v.xp = pc.xp;
    v.xpNext = pc.xpNext;
    v.winded = pc.winded;
    hud.setVitals(v);
    for (let i = 0; i < 3; i++) {
      const K = pc.skills[i];
      const a = this._skillArgs[i];
      a.cooldown = pc.cooldowns[i] > 0 ? pc.cooldowns[i] / K.cooldown : 0;
      a.seconds = Math.ceil(pc.cooldowns[i] - EPS);
      a.left = Math.max(0, pc.cooldowns[i]);
      a.locked = pc.level < K.unlock;
      a.affordable = pc.mp >= K.mp - EPS;
      hud.setSkill(i, a);
    }
    const d = this._skillArgs[3];
    d.cooldown = pc.draughtCd > 0 ? pc.draughtCd / DRAUGHT.cooldown : 0;
    d.seconds = Math.ceil(pc.draughtCd - EPS);
    d.left = Math.max(0, pc.draughtCd);
    d.locked = false;
    d.affordable = pc.potions > 0;
    hud.setSkill(3, d);
    hud.setPotions(pc.potions, POTION_MAX);
    hud.setGold(pc.gold);
    const full = pc.hp >= pc.hpMax && pc.mp >= pc.mpMax - 0.5;
    this._calm = !this.engaged && full ? this._calm + dt : 0;
    const calm = this._calm >= CALM_TIME;
    if (calm !== this._calmShown) {
      /** @type {boolean|undefined} the calm hint on the HUD (undefined before the first update) */
      this._calmShown = calm;
      hud.setCalm(calm);
    }
  }

  /** Enemy HP bars / aggro pips (32 slots, nearest first) and off-screen edge arrows (8). */
  _updateLabels() {
    const labels = this.ui.combat?.labels;
    if (!labels) return;
    const p = this.player.position;
    const cands = this._barCands ??= [];
    const edges = this._edgeCands ??= [];
    cands.length = 0;
    edges.length = 0;
    const lock = this.targeting.lock;
    for (const e of this.enemies) {
      if (!e.alive || e.boss || !e.sprite.visible || e.dormant) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      e._barD = d;
      const damaged = this.clock - (e._barT ?? -Infinity) < BAR_TIME;
      const bar = damaged || e === lock || (e.elite && d <= ELITE_BAR_RANGE);
      const pip = !bar && e.aggro && d <= PIP_RANGE;
      e._barMode = bar ? 1 : pip ? 2 : 0;
      if (e._barMode) cands.push(e);
      if (e.aggro && d <= EDGE_RANGE) {
        const b = e.def.body;
        if (!this.projectNdc(e.position.x, this.bodyBase(e) + (b[0] + b[1]) / 2, e.position.z, this._ndc, 0.92)) edges.push(e);
      }
    }
    sortByDist(cands);
    sortByDist(edges);
    // stable slots: the 32 nearest candidates get bars, but an enemy keeps the slot it already
    // holds (re-anchoring a slot snaps its lagging fill, so re-sorting by distance every frame
    // made the recent-damage chunk of a pack's bars vanish whenever two enemies swapped order)
    const bars = this._barOf ??= new Array(BAR_SLOTS).fill(null);
    const opts = this._barOpts ??= { elite: false, level: 1, name: '', pip: false };
    const stamp = this._barStamp = (this._barStamp ?? 0) + 1;
    const n = Math.min(BAR_SLOTS, cands.length);
    for (let i = 0; i < n; i++) cands[i]._barPick = stamp;
    for (let s = 0; s < BAR_SLOTS; s++) {
      const e = bars[s];
      if (e && e._barPick !== stamp) {
        e.barSlot = -1;
        bars[s] = null;
        labels.bar(s).hide();
      }
    }
    let free = 0;
    for (let i = 0; i < n; i++) {
      const e = cands[i];
      if (e.barSlot >= 0 && bars[e.barSlot] === e) continue;
      while (bars[free]) free++;
      bars[free] = e;
      e.barSlot = free;
      labels.bar(free).anchor(e.position, this.labelY(e)).show();
    }
    for (let s = 0; s < BAR_SLOTS; s++) {
      const e = bars[s];
      if (!e) continue;
      opts.elite = e.elite;
      opts.level = e.level;
      opts.name = e.elite ? this.displayName(e) : '';
      opts.pip = e._barMode === 2;
      labels.bar(s).set(e.hp / e.hpMax, opts);
    }
    const arrows = this._edgeOf ??= new Array(EDGE_SLOTS).fill(null);
    const eo = this._edgeOpts ??= { windup: false };
    this._edgeCount = Math.min(EDGE_SLOTS, edges.length);
    for (let s = 0; s < EDGE_SLOTS; s++) {
      const e = s < edges.length ? edges[s] : null;
      const h = labels.edge(s);
      if (!e) {
        if (arrows[s]) { h.hide(); arrows[s] = null; }
        continue;
      }
      if (arrows[s] !== e) {
        h.anchor(e.position, this.labelY(e) * 0.5);
        h.show();
        arrows[s] = e;
      }
      eo.windup = e.state === 'windup';
      h.set(eo);
    }
    // the boss bar follows the boss's HP
    if (this._bossFight && this._bossAwake) this.ui.combat.boss.set(this._bossFight.hp / this._bossFight.hpMax, Math.max(1, this._bossPhaseSeen ?? this._bossFight.phase ?? 1));
  }

  _updateMinimap() {
    const out = this.minimapEnemies;
    const pool = this._mmPool;
    let n = 0;
    for (const e of this.enemies) {
      if (!e.alive || !e.aggro || e.passive || !e.sprite.visible) continue;
      if (n === pool.length) pool.push({ x: 0, z: 0 });
      const m = pool[n];
      m.x = e.position.x;
      m.z = e.position.z;
      out[n++] = m;
    }
    out.length = n;
  }

  _programCheck() {
    if (!this.programsAtLoad || this._programWarned || !import.meta.env?.DEV) return;
    const n = this.engine.renderer.info.programs?.length ?? 0;
    if (n > this.programsAtLoad) {
      this._programWarned = true;
      console.warn(`[combat] program compiled mid-game: ${this.programsAtLoad} → ${n}`);
    }
  }

  // =============================================================================================
  // Look
  // =============================================================================================

  /**
   * After `weather.update`: the grade / DOF offsets (§11.4).
   * @param {number} dt
   */
  applyLook(dt) {
    if (!this._ready) return;
    const pc = this.pc;
    const low = pc.alive && pc.hp < pc.hpMax * LOW_HP;
    // (the ambient step's frames ease the look too: a hit's red pulse fades in a cutscene)
    this.look.apply(this._wasActive || this.ambientFrame ? dt : 0, this.engaged, low);
  }

  // =============================================================================================
  // Encounters, rest, shop
  // =============================================================================================

  /**
   * The death reset (§6.11): alive non-boss enemies home at full HP (killed ones stay dead), an
   * undefeated boss reset (arena open), projectiles / markers / pickups / FX cleared, the lock
   * released, tokens reset; the player loses 10 % gold and gets HP / MP / SP full, draughts ≥ 2.
   * `full` (rest, the reset hook): every non-boss enemy respawns (killed ones too) — unless the
   * level's foes never come back (`respawn` false, `environment.respawn: false`: a rest only heals) —,
   * nothing is taken from the player.
   * @param {{ full?: boolean }} [opts]
   */
  resetEncounter({ full = false } = {}) {
    const ctx = this.ctx;
    for (const e of this.enemies) {
      if (e.isAdd) {
        if (!this._hidden.has(e)) {
          e.reset(ctx);
          this._hideAdd(e);
        }
        continue;
      }
      if (e.boss) {
        if (e.alive || !this.bossDefeated) e.reset(ctx);
        continue;
      }
      if ((full && this.respawn) || e.alive) e.reset(ctx);
    }
    // a group the story has taken away stays away (its foes were reset above like the others)
    for (const e of this._absent) this._hideAdd(e);
    this._resetBoss();
    this._tokens.melee = 0;
    this._tokens.ranged = 0;
    for (const e of this.enemies) e.token = false;
    this.projectiles.clear();
    this._freeMarkersOf(null);
    this.fx.clear();
    if (!full) this.pickups.clear();
    this.targeting.release();
    this.stop = 0;
    this._slow = 0;
    this.playerScale = 1;
    this.enemyScale = 1;
    this.setEngaged(false);
    // (a ward was a spell of the fight: gone with it)
    this._wards.length = 0;
    // (a release asked for this sub-step is spent; the packs' systems start over, §30)
    this._releaseAsk.length = 0;
    for (const s of this.systems) s.reset?.();
    // (the heroes' spell lights back to the combat VFX lights, parked: their spells still up go on unlit)
    for (const l of this.looks) l.dropLights();
    const pc = this.pc;
    if (!full) {
      pc.gold = Math.floor(pc.gold * (1 - GOLD_LOSS));
      pc.revive();
    }
    // the companions: no foe after them, full and up (a respawn, a rest)
    for (const e of this.enemies) { e.target = null; e.tauntT = 0; }
    this.healAllies();
    // after the player's fall a swarm's survivors, home again, stay calm a while and their rush is
    // spent: the player does not rise into a swarm (rv-play #10, §29 V4; any other foe keeps to its
    // sight range and zone as before)
    if (!full) for (const e of this.enemies) if (e.swarm && e.alive) e.settle(RESPAWN_CALM);
    this._flushGoldFeed();
  }

  /**
   * The foes fallen in groups not yet defeated — on a level whose foes never come back
   * (`environment.respawn: false`; elsewhere a rest brings them back, so none are kept): their uids
   * (`<group id>#<index>`), level order, for a campaign to keep with its save (CampaignState
   * `fallen`; rv-play #8, §29 V18). Whole groups defeated are `defeatedGroups()`'.
   * @returns {string[]}
   */
  fallenFoes() {
    if (this.respawn) return [];
    const out = [];
    for (const members of this._members.values()) {
      if (members.every((e) => !e.alive)) continue;
      for (const e of members) if (!e.alive && !e.boss) out.push(e.uid);
    }
    return out;
  }

  /**
   * Foes a campaign remembers as fallen (CampaignRuntime._restoreCombat, as the level is entered):
   * like `markGroupsCleared` for single foes — not there, no death, drop, XP or event. Unknown uids
   * are ignored (a chapter's variant of the level may lack them); bosses and adds are never in it.
   * @param {string[]} uids
   */
  markFoesFallen(uids) {
    const want = new Set((Array.isArray(uids) ? uids : []).filter((id) => typeof id === 'string'));
    if (!want.size) return;
    for (const members of this._members.values()) {
      for (const e of members) {
        if (!e.alive || e.boss || !want.has(e.uid)) continue;
        if (this.targeting.lock === e) this.targeting.release();
        this._releaseToken(e);
        this._freeMarkersOf(e);
        this.projectiles.removeOwner(e);
        e.vanish();
      }
    }
  }

  /**
   * Release the player's lock-on (a cutscene begins: the director's `StoryRunner`; also the map, a
   * teleport). The boss framing of a running boss fight stays.
   */
  releaseLock() {
    if (this._ready) this.targeting.release();
  }

  /** An undefeated boss's fight state back to the start (arena open, framing off, bar hidden). */
  _resetBoss() {
    for (const a of this.arenas) a.open();
    for (const em of this._emitters ?? []) if (em) em.enabled = false;
    this._bossFight = null;
    this._bossAwake = false;
    this._awakePending = null;
    this._closePending = null;
    this._pullPending = null;
    this._kneel = null;
    this._bossPhaseSeen = 1;
    this._introT = 0;
    this.targeting.setBoss(null);
    this.ui.combat?.boss.hide();
    this.music.setSection('A');
  }

  /** Rest at a waystone: full resources, draughts ≥ 3, every non-boss group home (§6.12). */
  restAll() {
    this.resetEncounter({ full: true });
    const pc = this.pc;
    pc.refill();
    pc.potions = Math.max(pc.potions, WAYSTONE.restDraughts);
  }

  /**
   * Buy from a shop NPC on a combat level (`action: 'shop'`, or the `shopkeeper` script's menu): the
   * Healing Draught (up to the carry cap) or a one-time ware of SHOP_WARES (its upgrade is applied at
   * once; `sold` when already bought this session). Emits `purchase` (item, price).
   * @param {string} item
   * @returns {{ ok: boolean, reason?: 'gold'|'full'|'item'|'sold' }}
   */
  buy(item) {
    const w = shopWare(item);
    if (!w) return { ok: false, reason: 'item' };
    const pc = this.pc;
    if (w.once && this.purchased.has(w.id)) return { ok: false, reason: 'sold' };
    if (!w.upgrade && pc.potions >= POTION_MAX) return { ok: false, reason: 'full' };
    if (pc.gold < w.price) return { ok: false, reason: 'gold' };
    pc.gold -= w.price;
    if (w.upgrade) pc.upgrade(w.upgrade, w.amount);
    else pc.potions++;
    if (w.once) this.purchased.add(w.id);
    this.events.emit('purchase', w.name, w.price);
    return { ok: true };
  }

  /**
   * The player's progress a campaign carries to its next combat level (src/game/campaign/
   * CampaignState.js): level, XP, gold, draughts, upgrades and the one-time wares bought.
   * @returns {import('../campaign/CampaignState.js').CombatProgress}
   */
  exportProgress() {
    const pc = this.pc;
    return { level: pc.level, xp: pc.xp, gold: pc.gold, potions: pc.potions, upgrades: { ...pc.upgrades }, wares: [...this.purchased] };
  }

  /**
   * Restore `exportProgress`'s result on entering a combat level of a campaign (a saved game is
   * untrusted: every number is clamped); the player starts with full HP, MP and SP, and the
   * companions — added at the fresh combat's level 1 — are scaled to the player's level
   * (`MemberCombat.syncLevel`: full stays full).
   * @param {import('../campaign/CampaignState.js').CombatProgress} p
   */
  importProgress(p) {
    const pc = this.pc;
    const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    pc.level = n(p.level, 1, LEVEL_CAP);
    pc.xp = n(p.xp, 0, 1e7);
    pc.gold = n(p.gold, 0, 1e7);
    pc.potions = n(p.potions, 0, POTION_MAX);
    for (const k of ['maxHp', 'maxMp', 'attack', 'def']) pc.upgrades[k] = n(p.upgrades?.[k], 0, 999);
    this.purchased = new Set((Array.isArray(p.wares) ? p.wares : []).filter((w) => typeof w === 'string' && SHOP_WARES.some((s) => s.id === w)));
    pc.refill();
    for (const a of this.allies) a.syncLevel();
  }

  /** Ids of the level's chests opened this visit (a campaign keeps them open). */
  openedChests() {
    return this.chests.list.filter((c) => c.opened).map((c) => c.id);
  }

  /**
   * Chests opened on an earlier visit of this level (a campaign): open, empty, on the map.
   * @param {string[]} ids
   */
  markChestsOpened(ids) {
    for (const c of this.chests.list) {
      if (!ids.includes(c.id) || c.opened) continue;
      c.opened = true;
      if (c.it) c.it.disabled = true;
      // (at once: opened on an earlier visit — no swing when the story brings it into view later)
      c.prop?.open?.(true);
      this.chests.discover(c);
    }
  }

  /**
   * The price of a shop ware (25 for 'Healing Draught'), null when it is not for sale.
   * @param {string} item @returns {number|null}
   */
  priceOf(item) {
    return shopWare(item)?.price ?? null;
  }

  /**
   * The shop menu (the `shopkeeper` script lists the ones not `sold`): every ware of SHOP_WARES in
   * order, with whether buying it now would work (`available`) or why not (`reason`). `name` and
   * `gain` are the English (`buy(name)` looks the ware up by it); `label` and `gainLabel` are what
   * a menu shows, in the page's language (additive; `wareLabel`).
   * @returns {{ id: string, name: string, price: number, gain: string, once: boolean, upgrade: string|null,
   *   sold: boolean, available: boolean, reason: null|'gold'|'full'|'sold', label: string, gainLabel: string }[]}
   */
  shopOffers() {
    const pc = this.pc;
    return SHOP_WARES.map((w) => {
      const sold = w.once && this.purchased.has(w.id);
      const reason = sold ? 'sold' : !w.upgrade && pc.potions >= POTION_MAX ? 'full' : pc.gold < w.price ? 'gold' : null;
      return {
        id: w.id, name: w.name, price: w.price, gain: w.gain, once: w.once, upgrade: w.upgrade, sold, available: !reason, reason,
        label: t(`combat.ware.${w.id}.name`), gainLabel: t(`combat.ware.${w.id}.gain`, { n: w.upgrade ? w.amount : Math.round(DRAUGHT_HEAL * 100) }),
      };
    });
  }

  /**
   * A shop ware's name as a menu or a toast shows it, in the page's language (`buy`, `priceOf` and
   * the `purchase` event keep the English name): a ware of SHOP_WARES by its English name, else the
   * name as a term (an NPC's `item`, docs/specs/I18N.md §4.8).
   * @param {string} item the English name
   * @returns {string}
   */
  wareLabel(item) {
    const w = shopWare(item);
    return w ? t(`combat.ware.${w.id}.name`) : term(String(item ?? ''));
  }

  /**
   * The drillmaster's reward (once, after a full combo on a dummy and a dodge): 2 draughts, capped.
   * @returns {number} draughts given (0 when not due or the satchel is full)
   */
  rewardTutorial() {
    const t = this.tutorial;
    if (t.rewarded || !t.combo || !t.dodge) return 0;
    t.rewarded = true;
    const pc = this.pc;
    const given = Math.max(0, Math.min(2, POTION_MAX - pc.potions));
    pc.potions += given;
    return given;
  }

  // =============================================================================================
  // The story: groups, chests and waystones that come and go (STORY_SCRIPT.md §9.5)
  // =============================================================================================

  /**
   * Who is there as the story stands (StoryRunner.applyPresence, after `World.applyStory`: when the
   * level is attached and on every story change). Every enemy group, chest and waystone of the level
   * was loaded and warmed, present or not (they are `LIVE_STORY_TYPES`: a campaign keeps them in the
   * level); an absent one is out of play. Only the objects with a `when` / `unless` are read.
   * - An **enemy group** the story takes away goes silently, also mid-fight: its foes leave the
   *   lock-on and the aggro, their tokens, markers and projectiles go, the living are put back home
   *   at full HP, and all are hidden and dormant (`_absent`, `_hidden`: no AI, not drawn, not hit,
   *   not on the minimap, not counted — `state().combat.enemies.absent` —, no `kill` and so no
   *   `cleared` event). Its boss's fight ends (the gate opens, the adds go, the bar hides) and its
   *   arena closes nothing (no exclusion, the walk grid opens there, no map marker). A group that
   *   comes back spawns at home, no reward replayed; its fallen stay fallen (a waystone rest brings
   *   them back as usual, present or not).
   * - A **chest** or **waystone**: the World's story group shows / hides the prop, its collider and
   *   its prompt; here an absent chest is not discovered, opened or on the maps (an opened chest
   *   that comes back still offers nothing), an absent waystone is not attuned or rested at (the
   *   checkpoint it held falls back to the level's start).
   * - A **sky dragon** (DRAGON_CAMPAIGN.md §6.5): absent, it leaves toward its `leave` (at once with
   *   `instant`: on entering the level, the story applied); present again, it comes back.
   * - A group that comes back and **swarms** rushes the party at the next active step; its **boss**
   *   with an intro on appearing (`def.introOnSpawn`) starts the intro at the next step, a scene's
   *   too (COMBAT.md §29 V3, V4).
   * @param {(o: LevelObject) => boolean} present
   * @param {{ instant?: boolean }} [opts] instant: the level is being entered (StoryRunner's
   *   `applyPresence({ instant: true })`) — nothing animates away
   */
  applyPresence(present, { instant = false } = {}) {
    if (!this._ready) return;
    for (const g of this._storyGroups) {
      const on = !!present(g);
      if (on !== this._absentGroups.has(g)) continue;
      this._setGroupPresent(g, on);
    }
    for (const c of this._storyChests) {
      c.absent = !present(c.obj);
      // (World.applyStory enables a prompt whose group came back: an opened chest offers nothing)
      if (c.it) c.it.disabled = c.absent || c.opened;
    }
    for (const w of this._storyStones) this.waystones.setAbsent(w, !present(w.obj));
    // the sky dragons: an absent one flies off (at once on entering a level: `instant`)
    for (const d of this.skyDragons) d.applyPresence(!!present(d.obj), instant);
  }

  /**
   * One group comes or goes (`applyPresence`).
   * @param {LevelObjectOf<'enemy'>} g
   * @param {boolean} on
   */
  _setGroupPresent(g, on) {
    const members = this._members.get(g) ?? [];
    const ctx = this.ctx;
    if (on) this._absentGroups.delete(g);
    else this._absentGroups.add(g);
    // a set piece's group (§29 V3, V4): a boss with an intro on appearing starts it, a swarm rushes
    if (on && g.swarm === true && !this._swarmPending.includes(g)) this._swarmPending.push(g);
    for (const e of members) {
      if (on) {
        this._absent.delete(e);
        this._hidden.delete(e);
        // the living spawn at home (visible, idle); the fallen stay fallen
        if (e.alive) e.reset(ctx);
        if (e.alive && e.boss && e.def.introOnSpawn && !this._introPending.includes(e)) this._introPending.push(e);
        continue;
      }
      if (this.targeting.lock === e) this.targeting.release();
      if (e.boss && this._bossFight === e) {
        // its fight ends: the gate opens, the bar and the framing go, the adds below
        this._resetBoss();
      }
      for (const a of e.boss ? this._addsOf.get(e) ?? [] : []) {
        if (this._hidden.has(a)) continue;
        this._sendHome(a, true);
        this._hideAdd(a);
      }
      if (e.alive) this._sendHome(e, true);
      else {
        this._freeMarkersOf(e);
        this.projectiles.removeOwner(e);
      }
      this.fx.stopFollowing(e.position);
      this._absent.add(e);
      this._hideAdd(e);
    }
    // a boss's arena: its exclusion, walk-grid block and map marker follow the group
    for (const e of members) {
      const a = e.boss ? /** @type {BossArena|null} */ (e.arena) : null;
      if (!a || a.present === on) continue;
      a.present = on;
      const r = a.rect;
      this.nav?.buildRect(r.minX - 0.5, r.maxX + 0.5, r.minZ - 0.5, r.maxZ + 0.5);
    }
  }

  // =============================================================================================
  // A campaign's memory of the level (CAMPAIGN_FORMAT.md §6.4, §7)
  // =============================================================================================

  /**
   * The level's enemy groups defeated now — every foe of the group fallen (a boss's adds do not
   * count), present or not — for a campaign to remember (`CampaignState.cleared`). A waystone rest
   * brings the fallen back (a boss excepted) and so takes their groups off this list.
   * @returns {string[]} group ids, in level order
   */
  defeatedGroups() {
    const out = [];
    for (const [g, members] of this._members) {
      const id = typeof g.id === 'string' ? g.id : '';
      if (id && members.length && members.every((e) => !e.alive)) out.push(id);
    }
    return out;
  }

  /**
   * Groups a campaign remembers as defeated on an earlier visit (CampaignRuntime._restoreCombat,
   * as the level is entered): their foes are simply not there — fallen, not drawn — with no death,
   * drop, XP, `kill` event (so no `cleared` event) or effect; a boss stays defeated (its arena
   * open, off the maps, `bossDefeated`). A waystone rest brings the non-boss ones back as usual.
   * Unknown ids are ignored (a chapter's variant of the level may not have them). A released boss
   * (`def.release`) of a group in `released` — the groups whose `cleared` scene a save cut and a
   * Continue replays (CampaignRuntime._restoreCombat) — comes back as a released body under its
   * brain (`e.released`, its `die` and `dead`; no XP, drop or event), not vanished (EV-52).
   * @param {string[]} ids
   * @param {{ released?: ReadonlySet<string>|null }} [opts]
   */
  markGroupsCleared(ids, { released = null } = {}) {
    const want = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'));
    if (!want.size) return;
    for (const [g, members] of this._members) {
      if (!want.has(g.id)) continue;
      for (const e of members) {
        if (!e.alive) continue;
        if (this.targeting.lock === e) this.targeting.release();
        this._releaseToken(e);
        this._freeMarkersOf(e);
        this.projectiles.removeOwner(e);
        if (e.boss && e.def.release && released?.has(g.id)) {
          e.released = true;
          e.hp = 0;
          e.die(this.ctx);
        } else e.vanish();
        if (!e.boss) continue;
        this.bossDefeated = true;
        if (this._bossFight === e) this._resetBoss();
        this._dropBossMarker(e);
      }
    }
  }

  /** The track combat wants (Game.setMusic restarts it). */
  get musicTrack() { return this.music?.musicTrack ?? 'emberfall'; }

  // ---- Game notifications ----

  /** Game.teleport: the lock releases, the focus vectors jump with the player. */
  onTeleport() {
    if (!this._ready) return;
    this.targeting.release();
    this.targeting.snap();
    this._prevPos.copy(this.player.position);
  }

  /** The world map opened: the lock releases. */
  onMapOpen() {
    if (this._ready) this.targeting.release();
  }

  // =============================================================================================
  // State (§20.2)
  // =============================================================================================

  /** The `state()` hook and `Game.state().combat`. @returns {CombatState} */
  state() {
    const pc = this.pc;
    let alive = 0;
    let activeN = 0;
    let aggro = 0;
    let total = 0;
    let absent = 0;
    for (const e of this.enemies) {
      if (this._absent.has(e)) absent++;
      // (hidden: an add not spawned, or a foe of a group the story has taken away)
      if (this._hidden.has(e)) continue;
      total++;
      if (e.alive) alive++;
      if (e.alive && !e.dormant) activeN++;
      if (e.alive && e.aggro) aggro++;
    }
    const b = this._boss;
    /** @type {(v: number) => number} */
    const r3 = (v) => +v.toFixed(3);
    const fightTime = this._bossFight ? this.clock - this._fightStart : this._fightTime ?? 0;
    const ph = [...this._phaseTimes];
    if (this._bossFight) {
      const i = Math.max(0, Math.min(ph.length - 1, (this._bossPhaseSeen ?? 1) - 1));
      ph[i] = this.clock - this._phaseStart[i];
    }
    return {
      player: {
        hp: Math.ceil(pc.hp), hpMax: pc.hpMax, mp: r3(pc.mp), mpMax: pc.mpMax, sp: r3(pc.sp), spMax: pc.spMax,
        level: pc.level, xp: pc.xp, xpNext: pc.xpNext, gold: pc.gold, potions: pc.potions, atk: pc.atk, def: pc.def,
        action: pc.action, actionFrame: pc.frame, invulnerable: pc.invulnerable, combo: pc.combo, winded: pc.winded,
        lock: this.targeting.lock?.uid ?? null, checkpoint: this.waystones.checkpoint.id, kit: pc.kit.id,
        cooldowns: pc.cooldowns.map(r3), deaths: pc.deaths, perfectDodges: pc.perfectDodges,
      },
      engaged: this.engaged,
      time: r3(this.clock),
      frame: this.frame,
      seed: this.seedValue,
      kills: this.kills,
      bossDefeated: this.bossDefeated,
      device: this.input.lastDevice,
      enemies: { total, alive, active: activeN, aggro, absent },
      boss: b ? {
        uid: b.uid, hp: Math.ceil(b.hp), hpMax: b.hpMax, phase: Math.max(b.phase || 1, this._bossFight ? this._bossPhaseSeen ?? 1 : 1),
        state: b.state, broken: !!b.broken, defeated: this.bossDefeated && !b.alive,
        fightTime: r3(fightTime), phaseTimes: ph.map(r3),
      } : null,
      projectiles: this.projectiles.count,
      markers: this.markerCount,
      pickups: this.pickups.count,
      fx: this.fx.count,
      edgeArrows: this._edgeCount ?? 0,
      tokens: { melee: this._tokens.melee, ranged: this._tokens.ranged },
      guards: { resume: this.cin.resumeGuard, respawn: this.cin.respawnGuard > 0 },
      tutorial: { ...this.tutorial },
      shop: { purchased: [...this.purchased] },
      // the party's companions (PARTY.md §8; only once one fights here)
      ...(this.allies.length ? { allies: this.allies.map((a) => a.info()) } : {}),
      // the sky dragons (DRAGON_CAMPAIGN.md §6.4; only on a level with one)
      ...(this.skyDragons.length ? { sky: this.skyDragons.map((d) => d.state()) } : {}),
      // Vanquish the Evil Dragon (COMBAT.md §29): the party's ward, the set piece, its ambient step
      wardFrac: r3(this.wardFrac),
      setpiece: this.setpiece,
      ambient: this.ambientFrame,
    };
  }

  /** Performance / pool figures (the `stats()` hook). @returns {CombatStats} */
  stats() {
    const n = Math.min(this._tickN, TICK_SAMPLES);
    const s = Array.from(this._ticks.subarray(0, n)).sort((a, b) => a - b);
    /** @type {(f: number) => number} the `f` quantile (ms) */
    const q = (f) => (n ? +s[Math.min(n - 1, Math.floor(n * f))].toFixed(3) : 0);
    return {
      programs: this.engine.renderer.info.programs?.length ?? 0,
      programsAtLoad: this.programsAtLoad,
      drawCalls: this.postfx.sceneInfo.calls,
      tickMsP50: q(0.5),
      tickMsP95: q(0.95),
      pools: { fx: this.quads.count, markers: this.markerCount, projectiles: this.projectiles.count, pickups: this.pickups.count },
      nav: { ...this.nav.stats, cells: this.nav.cols * this.nav.rows, buildMs: this.nav.buildMs },
    };
  }

  // =============================================================================================
  // Dispose
  // =============================================================================================

  dispose() {
    if (!this._ready) return;
    this._ready = false;
    // the companions' fights go (the party keeps the members; a next combat level adds them again)
    for (const a of this.allies) a.release();
    this.allies.length = 0;
    // (the heroes' looks: the crystals, the frost, every VFX light held — given back — and the gust go with them)
    for (const l of this.looks) l.dispose();
    this.looks.length = 0;
    this.ice = null;
    this.holy = null;
    this.earth = null;
    this.sword = null;
    this.bell = null;
    this.kitModule = null;
    for (const d of this.skyDragons) d.dispose();
    this.skyDragons.length = 0;
    try { this.look.restore(); } catch { /* post already gone */ }
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    for (const s of this.actorSprites) {
      this.spriteManager.remove(s);
      s.dispose();
    }
    this.actorSprites.length = 0;
    this.enemies.length = 0;
    for (const em of this._emitters ?? []) em?.dispose?.();
    // the packs' systems and the pulse rings (§30)
    for (const s of this.systems) s.dispose?.();
    this.systems.length = 0;
    this._warmth.length = 0;
    // the burst pools only combat made (and their programs): a next, peaceful level has its own count
    this.particles.releaseBurstPools(this._ownPools);
    this._ownPools = [];
    this.quads.dispose();
    this.markers.dispose();
    this.atlas.texture.dispose();
    for (const s of this.sheets.values()) s.dispose?.();
    this.sheets.clear();
    this.events.clear();
    this._timers.length = 0;
    // what load() installed on the shared game objects (a campaign travels on without a reload)
    if (this._savedBindings) this.input.restoreBindings(this._savedBindings);
    this.input.disableMouseButtons?.();
    this.ui.disableCombat?.();
  }
}

/**
 * Insertion sort by `_barD` (allocation-free; a few dozen entries).
 * @param {Enemy[]} a
 */
function sortByDist(a) {
  for (let i = 1; i < a.length; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= 0 && a[j]._barD > x._barD) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = x;
  }
}
