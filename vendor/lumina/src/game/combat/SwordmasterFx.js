import { RNG, hashString, hash2, globalUniforms } from '../../engine/index.js';
import { SpectralBlades } from '../../engine/fx/SpectralBlades.js';
import { glowSpots } from './glowSpots.js';

/**
 * @import { LookStage } from './types.js'
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { PlayerCombat, HeroFx, HeroFxLive, HeroFxSpec } from './PlayerCombat.js'
 * @import { ComboStep, F as FrameTime, TEMPEST as TempestRules, DRAGONFANG as DragonfangRules, SKYFALL as SkyfallRules } from './rules.js'
 * @import { Enemy } from './Enemy.js'
 * @import { SpellLight } from '../../engine/lighting/VfxLights.js'
 * @import { BladeParams } from '../../engine/fx/SpectralBlades.js'
 */

/**
 * SwordmasterFx — the look of the swordmaster's kit (Aldric, the player of Vanquish the Evil Dragon:
 * `campaign.player.kit: 'swordmaster'`; docs/contracts/DRAGON_CAMPAIGN.md §6.8, COMBAT.md §29).
 * Visuals only: `PlayerCombat` keeps the moves — their frames, hits, hit-stop, shake, sounds — exactly
 * as they are and calls these hooks at their moments; nothing here touches a hit, a tag, a cooldown
 * or the fight's RNG (the look has its own: `sword:player` and the combat seed), so the fights play
 * the same (the hit listener only reads which foe a hit landed on).
 *
 * A module of its own, imported (`import()`) by `CombatSystem.load` only when the player's kit is the
 * swordmaster's: there the combat makes one `SwordStage` (`sys.sword`: the 3D swords, the FX batch's
 * halo, warmed at load, disposed with the combat) and its `director(pc)` gives the player's kit its
 * look (`pc.look`). Anywhere else nothing of it exists — no program, draw call, object or download.
 *
 * The look (no alpha blending anywhere: cut-out quads with dither fades, additive halos, light and
 * real 3D swords), after the ice mage's (docs/design/COMBAT_VFX.md):
 *  - **Palette.** Three hues that keep through the tone map and stay apart from the companions' and
 *    the foes': slate-steel and silver wind (the combo, Tempest Edge), crimson with coral edges and a
 *    white-hot core (Dragonfang Wave; never orange — fire and embers are the foes'), burnished gold —
 *    a dark engraved sigil, small pale-gold runes, a giant sword of blackened steel edged and hilted
 *    in gold (Skyfall Judgement: its value apart from a sunlit village's golds). Every effect is a
 *    body quad under the halo's gate and a lit layer over it (`HeroFx.pair`: the halo hugs the lit
 *    edges); every tint dims after dark (HeroFx), the gold lit ones under a low sun too (`SUN`).
 *  - **Light.** One of the combat VFX lights at a time for the moves (`World.acquireSpellLight`; a
 *    new skill takes its own previous light over), a `minor` spark for the combo's finisher and the
 *    draught: Tempest Edge's dim flicker orbiting over the storm; Dragonfang Wave's crimson glow
 *    riding the wave's front; Skyfall's gold light riding the falling sword's point, its flash at the
 *    slam, a low glow while the sword stands. Warm lights × dayK(0.4), steel × dayK(0.55); a flash's
 *    part above its light's hold × dayK(0.25), aging on the frame's own time (a hit-stop holds a lit
 *    frame, not a glare); no pulse at a hit (the foe struck is in its core flash); none above 6, all
 *    ≥ 2 u up (`LIGHT`); dark while the combat does not run; given back after every move, a reset,
 *    a travel.
 *  - **3D swords** (`SpectralBlades`: lit, shadow-casting, pixel-snapped): Tempest Edge's four steel
 *    blades on their orbit (two ghosts each, a smear of motion), their runes filling hit by hit,
 *    flying out and dissolving at the release; Skyfall's giant gold sword falling point first onto
 *    the landing point — its shadow converging there —, biting at the slam, standing through the
 *    hold with its runes pulsing, dissolving point to pommel at the end. A foe the camera sees behind
 *    its upper part (never the one struck) makes it a cut-out ghost while it stands, the boss a
 *    lighter one while the blade overlaps it, so the foes stay in view.
 *  - **Staging.** Anticipation for every move (the gathering ring and light of Tempest Edge, the
 *    three gathering stars of Dragonfang Wave, Skyfall's crouch star and its rune plates igniting in
 *    turn round the sigil), the impact (cuts and bites on each foe struck, the bite star, the crack
 *    cooling within 0.45 s, a low dark dust ring: no veil), the hold, the release.
 *  - **The scene settle.** A story scene that starts on a set-piece level while effects are up (the
 *    ambient step: a kill may start one) fades them out over 0.25 s of frames — the wave's quads
 *    veiled and shown again when the fight resumes (the wave hits on after the scene) —, its lights
 *    dark; the map or a talk only holds them.
 *  - The blade's glow texels (`setGlow` on the player's combatFx sprite; `gear.bladeGlow` paints
 *    them, Aldric's campaign spec sets it) charge with each move and flash at its release.
 */

/**
 * The moves' timings (rules.js), handed over by the player's kit (`PlayerCombat#moves`, set when its
 * director is made): imported here, rules.js would be split out of the combat chunk.
 */
/** @type {typeof FrameTime} */
let F = (f) => f / 60;
/** @type {typeof TempestRules} */
let TEMPEST;
/** @type {typeof DragonfangRules} */
let DRAGONFANG;
/** @type {typeof SkyfallRules} */
let SKYFALL;

/**
 * The tints (linear HDR × the atlas's grey levels). Bodies stay under the halo's gate (max < 0.9);
 * lit layers sit at 1.3–1.5 (crimson keeps its second channel ≤ 0.2 × the lead; the steel ones keep
 * their smallest channel ≥ 0.6 × the largest: silver, not Lyra's cyan). The gold lit layers are a
 * PALE gold (blue ≥ 0.33 × the lead, on screen B/R ≥ 0.55): a saturated gold read as fire under the
 * golden hour's warm light, right over Vorthrax's telegraphs — fire is the foes' (COMBAT_VFX §4); the
 * engraved bodies (sigil, slash) stay a dark, unlit gold.
 */
const TINT = Object.freeze({
  galeBody: Object.freeze([0.22, 0.33, 0.41]),
  galeLit: Object.freeze([0.8, 0.98, 1.12]),
  fangBody: Object.freeze([0.6, 0.04, 0.05]),
  fangLit: Object.freeze([1.35, 0.12, 0.11]),
  fangCore: Object.freeze([1.5, 0.42, 0.32]),
  sigilBody: Object.freeze([0.42, 0.22, 0.04]),
  sigilPulse: Object.freeze([0.84, 0.5, 0.16]),
  runeLit: Object.freeze([1.3, 0.95, 0.45]),
  goldFlash: Object.freeze([1.4, 1.02, 0.5]),
  goldBody: Object.freeze([0.45, 0.22, 0.04]),
  crackBody: Object.freeze([0.12, 0.08, 0.06]),
});
/**
 * Under a low sun (golden hour: the warm light, exposure and grade push gold toward fire) the gold lit
 * layers and Skyfall's light dim: × goldK = 1 − `lowSun` · low, low = 1 − smoothstep(lo, hi, the
 * sun's height) by day (the night has NIGHT_DIM) — 0.73 at the Wyrmspine's 17.3; the engraved bodies
 * (the sigil, the plates unlit) × goldK²; Skyfall's ground rings in PlayerCombat (`RING_LOW_SUN`).
 */
const SUN = Object.freeze({ lowSun: 0.35, lo: 0.3, hi: 0.65 });
/** @type {() => number} the gold lit layers' factor now (1 under a high sun) */
const goldK = () => {
  const y = globalUniforms.uSunDirection.value.y;
  const x = (y - SUN.lo) / (SUN.hi - SUN.lo);
  const low = 1 - (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return 1 - SUN.lowSun * low * (1 - globalUniforms.uNight.value);
};

/**
 * The companions' ground caps (MemberCombat.js: `GLYPH_A`, `RING_A`, `FLAT_LIFT` — the same values;
 * not imported: that module is the party chunk's): a glyph's and a ring's dither cap (small foes
 * show through) and the lift that keeps a ground glyph over the grass tufts.
 */
const GLYPH_A = 0.5;
const RING_A = 0.6;
const FLAT_LIFT = 0.3;
const LIT_DY = 0.012;

/**
 * The lights (linear colours; intensities in the lanterns' units). One field light at a time
 * (Tempest Edge, Dragonfang Wave, Skyfall: a new one takes its predecessor's over), a `minor` spark
 * (A3, the draught). Tempest: `t*`; Dragonfang: `f*`; Skyfall: `s*`. The rule for hit-frame light
 * (COMBAT_VFX §7, D-1): a flash ages on the frame's own time (it decays through a hit-stop), its part
 * above the light's hold is × dayK(`DAY.flash`), no pulse lands on a hit (the foe struck is in its
 * core flash and hit-stop: a light on it only spreads that flash's bloom), and no light of his passes
 * `cap` (the night's peak). Every light hangs ≥ 2 u up (low warm lights whiten pale sand).
 */
const LIGHT = Object.freeze({
  // (plain arrays: VfxLights reads a colour array as linear; never written)
  steel: [0.5, 0.7, 1.5], crimson: [1.6, 0.22, 0.12], gold: [1.5, 1.0, 0.4], heal: [0.5, 1.3, 0.45],
  sparkI: 3.5, sparkT: 0.14, sparkLift: 2.0, sparkDist: 3.5,
  draughtI: 2, draughtTau: 0.25, draughtT: 0.5, draughtLift: 2.0, draughtDist: 3.5,
  tGather: 2.5, tGatherLift: 2.0, tGatherDist: 4.5, tStorm: 3, tOrbit: 1.0, tLift: 2.6, tOutLift: 2.0, tW: 5, tDist: 7.5,
  fGather: 2.5, fGatherLift: 2.0, fGatherDist: 4.5, fLift: 2.4, fRide: 2.5, fDist: 5.5, fOut: 0.15,
  sFall0: 2, sFall1: 6, sFallLift: 2.0, sDist0: 6, sDist1: 8, sFlash: 11, sFlashLift: 3, sFlashDist: 11, sTau: 0.1,
  sHold: 2.5, sHoldDecay: 2, sPulse: 0.15, sPulseHz: 3, sBlink: 7, sBlinkTau: 0.08,
  /** No light of his above this (the night's peak: dayK is 1 there). */
  cap: 6,
  /** Seconds a light stays held after its effect went dark (then given back). */
  after: 0.1,
});
/**
 * The 3D swords' own glow (SpectralBlades `glow`: seams, runes, the fuller's core, the gems): its
 * level while they stand, the flare of a Tempest hit and of Skyfall's slam (decaying, 0.1 / 0.12 s).
 * Kept low: on a sword 8 u tall every term blooms (a flare of 2 whited the slam out at noon).
 */
const BLADE_GLOW = Object.freeze({ base: 0.75, tempestFlare: 0.5, skyFlare: 0.6 });
/**
 * Day factors (`dayK`): warm lights, cool lights, the swords' own glow; a flash's part above its
 * light's hold (Skyfall's slam and release blink, the A3 spark): it falls on foes the core's hit
 * flash already whitens through the hit-stop — at noon × 0.4 lifted the zoomed slam frame 1.25
 * points over master with their flash on.
 */
const DAY = Object.freeze({ warm: 0.4, cool: 0.55, blade: 0.8, flash: 0.25 });
/** @type {(min: number) => number} a day factor now (`min` at noon, 1 at night) */
const dayK = (min) => min + (1 - min) * globalUniforms.uNight.value;

/** The blade's glow texels: colours per move, the decay after a flash (s), the cap. */
const GLOW = Object.freeze({
  steel: Object.freeze([0.75, 0.85, 1.0]), crimson: Object.freeze([1.0, 0.16, 0.12]), gold: Object.freeze([1.0, 0.6, 0.15]),
  tau: 0.12, max: 2.5,
});

/**
 * Tempest Edge's blades: length, width; their ghosts' lag (rad) and share cut out; the pitch (the
 * point down) and the roll of the flats; the release's spin about the axis (rad/s) and dissolve.
 */
const TBLADE = Object.freeze({
  length: 1.9, width: 0.22, lag: Object.freeze([0.25, 0.5]), ghost: Object.freeze([0.5, 0.75]), ghostGlow: 0.6,
  pitch: (25 * Math.PI) / 180, roll: (70 * Math.PI) / 180, appear: 0.1, spinOut: 20, outDelay: 0.08, outT: 0.12,
});
/**
 * Skyfall's sword: length, width, how deep its point sinks, the extra bite at the slam and its
 * spring back (s), how far beyond the landing point (away from the camera) it stands, its lean, the
 * seconds it materialises over, the release (frame) and its dissolve (s); its ghosts' height above
 * it and their share cut out. 6.4 u long, sunk 0.8: its guard and hilt (≈ 4–5.6 u up) stay in the
 * game camera's frame (at 8 u the hilt left it: a gold beam, not a sword). The readability ghost
 * (share cut out, ease s): a foe seen behind the blade's upper part (from `upper` u over the ground
 * to the pommel) — standing at least `behind` u past it, not the one struck (within its radius +
 * `struck` of the landing point) — makes it a ghost at `screenGhost`; the boss only while the blade
 * overlaps it on screen, at `bossGhost`. A foe's body on screen: `bodyW` × its frame's width (or
 * its radius), `bodyH` × its height (the frames have air round the body).
 */
const SWORD = Object.freeze({
  length: 6.4, width: 0.85, sink: 0.8, bite: 0.25, biteT: 0.1, beyond: 0.75, lean: Math.tan((4 * Math.PI) / 180), appear: 0.08,
  release: 58, dissolve: 0.25, ghostUp: Object.freeze([0.6, 1.2]), ghostCut: Object.freeze([0.55, 0.75]),
  screenGhost: 0.45, bossGhost: 0.25, screenEase: 0.1, behind: 1.0, struck: 1.0, upper: 1.5, bodyW: 0.3, bodyH: 0.8,
});
/** Skyfall's rune plates (heroRunes on the sigil's band): count, their middle's radius in sigil px, when they ignite / go out. */
const PLATES = Object.freeze({ n: 8, radiusPx: 71, igniteFrom: 1, igniteEvery: 3, outFrom: 46, outEvery: 2 });
/** The cuts and bites on the foes struck: at most this many live. */
const CUTS_MAX = 8;
/** A story scene's settle (s of frames). */
const SETTLE = 0.25;

/** @type {(u: number) => number} smoothstep 0..1 */
const smooth = (u) => {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};
/** @type {(u: number) => number} */
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
/** @type {(u: number) => number} ease-out (HeroFx's) */
const ease = (u) => 1 - (1 - u) * (1 - u);
const TAU = Math.PI * 2;

/** A HeroFx record and the id it had when taken (a record is recycled once it dies). @typedef {{ rec: HeroFxLive|null, id: number }} Ref */
/** @returns {Ref} */
const ref = () => ({ rec: null, id: 0 });

/** One of Tempest Edge's blades: its sword and its two ghosts (SpectralBlades handles, −1: none). @typedef {{ h: number, g0: number, g1: number }} TBladeRec */

/**
 * What a combat with the swordmaster's kit adds (`sys.sword`, made by `CombatSystem.load`): the 3D
 * swords (one instanced draw + its shadow while any lives, its programs compiled by the warm-up), the
 * FX batch's halo (`enableHalo`), a read-only listener on the combat's hits (which foe a move struck),
 * and the director of the player's kit. Disposed with the combat (a travel included).
 * @implements {LookStage}
 */
export class SwordStage {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    /** Tempest Edge's blades and Skyfall's sword (+ their ghosts). */
    this.blades = new SpectralBlades({ capacity: 16 });
    sys.scene?.add(this.blades.object);
    sys.quads?.enableHalo();
    /** @type {SwordmasterFx[]} */
    this.directors = [];
    /** The warm-up's halo quad (−1: none). */
    this._warmQuad = -1;
    /** @type {(e: Enemy|'player', damage: number, crit: boolean, source: string) => void} */
    this._onHit = (e) => {
      if (!e || e === 'player') return;
      for (let i = 0; i < this.directors.length; i++) this.directors[i].onHit(e);
    };
    sys.events?.on('hit', this._onHit);
  }

  /**
   * The director of the player's kit (PlayerCombat's constructor).
   * @param {PlayerCombat} pc
   * @returns {SwordmasterFx}
   */
  director(pc) {
    ({ F, TEMPEST, DRAGONFANG, SKYFALL } = pc.moves);
    const d = new SwordmasterFx(this, pc);
    this.directors.push(d);
    return d;
  }

  /** A director goes. @param {SwordmasterFx} d */
  drop(d) {
    const i = this.directors.indexOf(d);
    if (i >= 0) this.directors.splice(i, 1);
  }

  /**
   * The combat's warm-up (`CombatSystem.warmup`, before the scene is compiled): a steel and a gold
   * sword and one halo-weighted quad far below the world, so their programs (the swords' shadow
   * program too) compile at load.
   * @param {{ x: number, y: number, z: number }} far
   */
  warmup(far) {
    this.blades.warm();
    const q = this.sys.quads;
    this._warmQuad = q.alloc();
    if (this._warmQuad >= 0) q.set(this._warmQuad, { x: far.x, y: far.y, z: far.z, frame: 'heroGaleLit', index: 0, scale: 1, mode: 'billboard', r: 1.3, g: 1.3, b: 1.3, a: 1, soft: 0, halo: 1 });
    q.update();
  }

  /** After the warm frames (`CombatSystem.endWarmup`). */
  endWarmup() {
    this.blades.unwarm();
    if (this._warmQuad >= 0) this.sys.quads.free(this._warmQuad);
    this._warmQuad = -1;
  }

  /**
   * Once a frame after the members' visuals (`CombatSystem.afterPlayer`; `LookStage.update`): the
   * lights (their flashes on the frame's own time), the swords written. While the combat does not
   * run the lights are dark (a talk, the map: the rest holds — not the photo mode); in a story
   * scene on a set-piece level (the ambient step) the effects settle out.
   * @param {number} dt combat seconds of the frame (0: everything holds)
   * @param {boolean} [active] the combat ran this frame
   * @param {number} [frameDt] the frame's own seconds
   * @param {boolean} [ambient] a story run holds the player on a set-piece level
   */
  update(dt, active = true, frameDt = 0, ambient = false) {
    const hushed = !active && !this.sys.game?.photoMode;
    for (let i = 0; i < this.directors.length; i++) {
      const d = this.directors[i];
      if (ambient) d.settle(frameDt);
      else if (hushed) d.hush();
      else if (active) d.lights(frameDt);
    }
    this.blades.update(dt);
  }

  /** Every light given back (the death reset, a rest: `CombatSystem.resetEncounter`). */
  dropLights() {
    for (const d of this.directors) d.dropLights();
  }

  /** The combat goes: the listener, every director, the swords. */
  dispose() {
    this.sys.events?.off('hit', this._onHit);
    for (const d of [...this.directors]) d.dispose();
    this.directors.length = 0;
    if (this._warmQuad >= 0) this.sys.quads?.free(this._warmQuad);
    this._warmQuad = -1;
    this.blades.dispose();
  }

  /** Tests (`__game.combat.system.sword.info()`). */
  info() {
    const d = this.directors[0] ?? null;
    const di = d ? d.info() : null;
    return {
      directors: this.directors.length, blades: this.blades.count, halo: !!this.sys.quads?.halo,
      lights: di ? { held: di.lights.held, asks: di.lights.acquired + di.lights.refused, refused: di.lights.refused } : { held: 0, asks: 0, refused: 0 },
      look: di,
    };
  }
}

/**
 * The look of the player's swordmaster kit (see the module comment): hooks PlayerCombat calls at the
 * moves' moments, the per-frame placing (`visuals`, before HeroFx writes its quads), the lights
 * (`lights`, on the frame's own time).
 */
export class SwordmasterFx {
  /**
   * @param {SwordStage} stage
   * @param {PlayerCombat} pc
   */
  constructor(stage, pc) {
    this.stage = stage;
    this.pc = pc;
    /** @type {CombatSystem} */
    this.sys = pc.sys;
    /** The kit's quads (PlayerCombat's `HeroFx`). */
    this.hfx = /** @type {HeroFx} */ (pc.hfx);
    /** Sheet cells → the blade's spot (glow texels; null: none yet — the fallback beside the hand). */
    this._spots = glowSpots(pc.sheet);
    this._anchor = { x: 0, y: 0, z: 0 };
    /** @type {BladeParams & { x: number, y: number, z: number, ax: number, ay: number, az: number, nx: number, ny: number, nz: number, dissolve: number, dissolveDir: number, ghost: number, glow: number, runes: number }} */
    this._bp = { x: 0, y: 0, z: 0, ax: 0, ay: 1, az: 0, nx: 0, ny: 0, nz: 1, dissolve: 0, dissolveDir: 0, ghost: 0, glow: 1, runes: 0 };
    /** @type {{ color: number[], intensity: number, distance: number, decay: number, flicker: number }} */
    this._lp = { color: LIGHT.steel, intensity: 0, distance: 6, decay: 1, flicker: 0 };
    /** VFX lights asked for and given / refused (tests). */
    this.lights_ = { acquired: 0, refused: 0 };
    /** @type {SpellLight|null} the moves' light (one at a time) and whose it is */
    this.light = null;
    /** @type {''|'tempest'|'fang'|'skyfall'} */
    this.lightOwner = '';
    /** @type {SpellLight|null} the minor spark (A3, the draught) */
    this.spark = null;
    /** @type {''|'a3'|'draught'} */
    this._sparkKind = '';
    this._sparkT = 0;
    this._sparkX = 0;
    this._sparkY = 0;
    this._sparkZ = 0;
    this._initState();
    this.rng = new RNG((hashString('sword:player') ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
  }

  /** Every move's state back to rest. */
  _initState() {
    /** The combo: the step whose wind-up runs, the frame last seen. */
    this._combo = { on: false, step: 0, last: -1 };
    /**
     * Tempest Edge: running; seconds since its start / since the blades came (−1: not yet); the
     * base angle; released (and when); the blades; runes now / to reach; the rune flare; the light's
     * hit pulse; the gathering ring.
     */
    this._tem = {
      on: false, st: 0, t: -1, a0: 0, released: false, relT: 0, runes: 0, runesTo: 0, flare: 0, ring: ref(), storm: ref(),
      /** @type {TBladeRec[]} */ blades: [0, 1, 2, 3].map(() => ({ h: -1, g0: -1, g1: -1 })),
    };
    /**
     * Dragonfang Wave: running; seconds since its wind-up; released (and when); ended (and when) and
     * on a wall; the frame last seen; the crest (body, lit layer); where its light was last.
     */
    this._fang = {
      on: false, t: 0, released: false, relT: 0, ended: false, endT: 0, last: -1,
      crest: ref(), crestLit: ref(), x: 0, y: 0, z: 0,
    };
    /**
     * Skyfall: running; its clock (the action's own while it runs, then its own); the action ended;
     * landed (and when); the sword and its ghosts; the sigil, the plates (their order of ignition),
     * the crouch star, the crack; the rune flare; the readability ghost now; the light's flash and
     * blink; the frame last seen (beats), released.
     */
    this._sky = {
      on: false, t: 0, ended: false, landed: false, landT: 0, sword: -1, ghosts: [-1, -1],
      sigil: ref(), plates: Array.from({ length: PLATES.n }, ref), order: new Array(PLATES.n).fill(0), star: ref(), crack: ref(),
      flare: 0, ghostK: 0, flash: 0, blink: 0, last: -1, released: false, sx: 0, sz: 0, py: 0, dissolve: 0, screened: false,
    };
    /** The blade's glow texels: now, a flash asked, the value last written, its colour. */
    this.glow = 0;
    this._kick = 0;
    this._glowShown = -1;
    /** @type {readonly number[]} */
    this._glowRgb = GLOW.steel;
    /** Scratch: a gold tint under the sun now (`_gold`). */
    this._gc = [0, 0, 0];
    /** A story scene's settle running (until the fight runs again), its seconds. */
    this._settling = false;
    this._settleT = 0;
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  /** Everything gone (a reset, a revive — PlayerCombat._clearHeroFx): swords, lights, records, the glow. */
  clear() {
    const B = this.stage.blades;
    for (const b of this._tem.blades) this._freeBlade(b);
    const S = this._sky;
    if (S.sword >= 0) B.free(S.sword);
    for (const g of S.ghosts) if (g >= 0) B.free(g);
    this._releaseLights();
    this._initState();
    this.rng = new RNG((hashString('sword:player') ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
    this._writeGlow(0);
  }

  /** The combat does not run this frame (a talk, the map): the lights dark until it does. */
  hush() {
    if (this.light?.held) this.light.off();
    if (this.spark?.held) this.spark.off();
  }

  /** Every light given back at once, the moves going on unlit (the death reset, a rest). */
  dropLights() {
    this._releaseLights();
  }

  /** The combat goes. */
  dispose() {
    this.clear();
    this.stage.drop(this);
  }

  /**
   * A story scene holds the fight on a set-piece level (the ambient step): the lights dark and given
   * back, every effect fading out over `SETTLE` s of frames (the swords dissolving; the wave's quads
   * only veiled — the wave hits on after the scene, shown again), the gold ground rings run out; the
   * moves resume after the scene without their ornaments.
   * @param {number} frameDt
   */
  settle(frameDt) {
    if (!this._settling) {
      this._settling = true;
      this._settleT = 0;
      this._releaseLights();
    }
    this._settleT += frameDt;
    const k = clamp01(this._settleT / SETTLE);
    this.hfx.settle(frameDt, SETTLE);
    this.pc._updateRings(frameDt);
    const B = this.stage.blades;
    const T = this._tem;
    const S = this._sky;
    if (k < 1) {
      // (the swords dissolve: a share cut out that grows to all of them)
      const P = this._bp;
      P.ghost = k * 0.99;
      for (const b of T.blades) {
        if (b.h >= 0) B.set(b.h, { ghost: P.ghost });
        if (b.g0 >= 0) B.set(b.g0, { ghost: Math.max(TBLADE.ghost[0], P.ghost) });
        if (b.g1 >= 0) B.set(b.g1, { ghost: Math.max(TBLADE.ghost[1], P.ghost) });
      }
      if (S.sword >= 0) B.set(S.sword, { ghost: Math.max(S.ghostK, P.ghost) });
      for (let j = 0; j < 2; j++) if (S.ghosts[j] >= 0) B.set(S.ghosts[j], { ghost: Math.max(SWORD.ghostCut[j], P.ghost) });
    } else if (T.on || S.on || this._fang.on) {
      for (const b of T.blades) this._freeBlade(b);
      if (S.sword >= 0) B.free(S.sword);
      for (const g of S.ghosts) if (g >= 0) B.free(g);
      S.sword = S.ghosts[0] = S.ghosts[1] = -1;
      T.on = false;
      S.on = false;
      // (the wave's own quads stay, veiled: its light is gone, it is drawn on after the scene)
      this._fang.on = this.pc._wave.alive && this._fang.on;
    }
    if (this.glow !== 0) {
      this.glow = 0;
      this._writeGlow(0);
    }
  }

  /**
   * Take a combat VFX light (World.acquireSpellLight), or null (none free).
   * @param {boolean} minor a short spark: a free light only (a move's light may take it over)
   * @returns {SpellLight|null}
   */
  _acquire(minor) {
    const w = this.sys.world;
    const l = w && typeof w.acquireSpellLight === 'function' ? w.acquireSpellLight({ minor }) : null;
    if (l) this.lights_.acquired++;
    else this.lights_.refused++;
    return l;
  }

  /**
   * The moves' light for `owner` (its predecessor's taken over, else a new one).
   * @param {'tempest'|'fang'|'skyfall'} owner
   */
  _takeField(owner) {
    if (!this.light?.held) {
      this.light = null;
      this.light = this._acquire(false);
    }
    this.lightOwner = this.light ? owner : '';
  }

  /** The moves' light given back. */
  _releaseField() {
    if (this.light) {
      this.light.off();
      this.light.release();
    }
    this.light = null;
    this.lightOwner = '';
  }

  /**
   * A light set this frame, its intensity capped at `LIGHT.cap` (the night's peak, D-1).
   * @param {SpellLight} L @param {number} x @param {number} y @param {number} z
   * @param {{ color: number[], intensity: number, distance: number, decay: number, flicker: number }} lp
   */
  _put(L, x, y, z, lp) {
    if (lp.intensity > LIGHT.cap) lp.intensity = LIGHT.cap;
    L.set(x, y, z, lp);
  }

  /** The spark given back. */
  _releaseSpark() {
    if (this.spark) {
      this.spark.off();
      this.spark.release();
    }
    this.spark = null;
    this._sparkKind = '';
  }

  _releaseLights() {
    this._releaseField();
    this._releaseSpark();
  }

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------

  /** @param {Ref} r @param {HeroFxLive|null} rec */
  _keep(r, rec) {
    r.rec = rec;
    r.id = rec ? rec.id : 0;
    return rec;
  }

  /** @param {Ref} r @returns {HeroFxLive|null} the record if it is still that effect */
  _get(r) {
    return this.hfx.alive(r.rec, r.id) ? r.rec : null;
  }

  /** @param {Ref} r */
  _drop(r) {
    const rec = this._get(r);
    if (rec) this.hfx.kill(rec);
    r.rec = null;
    r.id = 0;
  }

  /** @param {TBladeRec} b */
  _freeBlade(b) {
    const B = this.stage.blades;
    if (b.h >= 0) B.free(b.h);
    if (b.g0 >= 0) B.free(b.g0);
    if (b.g1 >= 0) B.free(b.g1);
    b.h = b.g0 = b.g1 = -1;
  }

  /** The camera's forward on XZ (CombatFx's view axis). */
  _viewX() { return this.sys.fx ? this.sys.fx.viewX : 0; }
  _viewZ() { return this.sys.fx ? this.sys.fx.viewZ : -1; }

  /**
   * The blade's world spot in the cell the player's sprite shows (the sheet's glow texels; without
   * them: beside the hand, along the facing), the Skyfall leap's lift included.
   * @returns {{ x: number, y: number, z: number }}
   */
  _bladeAt() {
    const pc = this.pc;
    const p = pc.player.position;
    const o = this._anchor;
    const cell = this._spots?.[pc._lastRow]?.[pc._lastCol] ?? null;
    if (cell) {
      const yaw = globalUniforms.uCameraYaw.value;
      o.x = p.x + Math.cos(yaw) * cell.right;
      o.y = p.y + pc._lift + cell.up;
      o.z = p.z - Math.sin(yaw) * cell.right;
    } else {
      const f = pc.player.facing;
      o.x = p.x + f.x * 0.3;
      o.y = p.y + pc._lift + 1.0;
      o.z = p.z + f.z * 0.3;
    }
    return o;
  }

  /**
   * A frame crossed since the last look (`last`): the beats the director keeps itself.
   * @param {number} last @param {number} now @param {number} n
   */
  static crossed(last, now, n) {
    return last < n && now >= n;
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: the combo
  // ------------------------------------------------------------------------------------------

  /** A combo step starts (f0): its wind-up's beats follow (`visuals`). @param {Readonly<ComboStep>} S */
  windup(S) {
    const C = this._combo;
    C.on = true;
    C.step = S.finisher ? 3 : this.pc.combo;
    C.last = 0;
    this._glowRgb = GLOW.steel;
  }

  /**
   * A combo step's swing (its sound is PlayerCombat's): a wind-blade arc where the traveler's slash
   * is — A1 / A2 a slate gale crescent with its silver edge (the back-hand mirrored), A3 the thrust
   * streak and a wind blade flung on along the facing with two after-images, its spark of light —
   * and wind streaks off the edge.
   * @param {Readonly<ComboStep>} S
   */
  swing(S) {
    const sys = this.sys;
    const hfx = this.hfx;
    const p = this.pc.player.position;
    const fx = this.pc.player.facing;
    this._combo.on = false;
    if (S.finisher) {
      this._kick = 1.6;
      hfx.pair({
        frame: 'thrust', x: p.x + fx.x * 0.9, y: p.y + 0.85, z: p.z + fx.z * 0.9, dirX: fx.x, dirZ: fx.z, rot: Math.PI / 2,
        life: 0.13, strip: 0.1, color: TINT.galeBody, fadeOut: 0.05,
      }, 'heroThrustLit', TINT.galeLit);
      const flung = { frame: 'heroGale', x: p.x + fx.x * 0.7, y: p.y + 0.85, z: p.z + fx.z * 0.7, vx: fx.x * 10, vz: fx.z * 10,
        dirX: fx.x, dirZ: fx.z, life: 0.32, strip: 0.12, s0: 1.15, s1: 1.45, color: TINT.galeBody, fadeOut: 0.14 };
      hfx.pair(flung, 'heroGaleLit', TINT.galeLit);
      // (two after-images trailing it)
      for (const [back, a] of [[0.5, 0.55], [1.0, 0.35]]) {
        hfx.spawn({ ...flung, x: flung.x - fx.x * back, z: flung.z - fx.z * back, a, s0: 1.1, s1: 1.35 });
      }
      sys.burst('heroWindSpark', p.x + fx.x * 1.6, p.y + 0.85, p.z + fx.z * 1.6, 10);
      sys.burst('heroGust', p.x + fx.x * 0.6, p.y + 0.08, p.z + fx.z * 0.6, 4);
      // the thrust's spark of light (a free light only)
      if (!this.spark) {
        this.spark = this._acquire(true);
        if (this.spark) {
          this._sparkKind = 'a3';
          this._sparkT = 0;
          this._sparkX = p.x + fx.x * 1.6;
          this._sparkY = p.y + LIGHT.sparkLift;
          this._sparkZ = p.z + fx.z * 1.6;
        }
      }
    } else {
      this._kick = 1.0;
      hfx.pair({
        frame: 'heroGale', x: p.x + fx.x * 0.6, y: p.y + 0.8, z: p.z + fx.z * 0.6, dirX: fx.x, dirZ: fx.z,
        flip: S.flip, life: 0.2, strip: 0.13, s0: 1.02, s1: 1.12, color: TINT.galeBody, fadeOut: 0.08,
      }, 'heroGaleLit', TINT.galeLit);
      sys.burst('heroWindSpark', p.x + fx.x * 1.1, p.y + 0.8, p.z + fx.z * 1.1, 6);
    }
  }

  /** The Healing Draught taken: a soft green light for half a second (a free light only). */
  draught() {
    if (this.spark) return;
    this.spark = this._acquire(true);
    if (!this.spark) return;
    const p = this.pc.player.position;
    this._sparkKind = 'draught';
    this._sparkT = 0;
    this._sparkX = p.x;
    this._sparkY = p.y + LIGHT.draughtLift;
    this._sparkZ = p.z;
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: Tempest Edge
  // ------------------------------------------------------------------------------------------

  /**
   * Tempest Edge's beats: 'start' (f0: the gathering ring, the light), 'wind' (f1: dust), 'blades'
   * (the blades open round the player inside the storm ring), 'spin' (every 4th frame: wind torn off
   * the ring, dust), 'hit' (`i`: runes, flare, light pulse, glints), 'release' (the blades fly out,
   * the shock ring).
   * @param {'start'|'wind'|'blades'|'spin'|'hit'|'release'} beat
   * @param {number} [i] the hit (0 … 2)
   */
  tempest(beat, i = 0) {
    const T = TEMPEST;
    const sys = this.sys;
    const pc = this.pc;
    const p = pc.player.position;
    const S = this._tem;
    switch (beat) {
      case 'start': {
        for (const b of S.blades) this._freeBlade(b);
        this._drop(S.ring);
        this._drop(S.storm);
        S.on = true;
        S.st = 0;
        S.t = -1;
        S.a0 = Math.atan2(pc._baseZ, pc._baseX);
        S.released = false;
        S.runes = S.runesTo = 0;
        S.flare = 0;
        this._glowRgb = GLOW.steel;
        this._takeField('tempest');
        // the gathering ring: drawn in round the feet as the blades are called
        this._keep(S.ring, this.hfx.spawn({
          frame: 'heroCyclone', follow: p, oy: 0.3, dirX: 0, dirZ: -1, life: F(T.bladesAt + 2), s0: 1.5, spin: 6,
          color: TINT.galeBody, a: 0.5, soft: 0.4, live: true,
        }));
        break;
      }
      case 'wind':
        sys.burst('heroGust', p.x, p.y + 0.08, p.z, 8);
        break;
      case 'blades': {
        if (!S.on) break;
        S.t = 0;
        const B = this.stage.blades;
        for (let k = 0; k < S.blades.length; k++) {
          const b = S.blades[k];
          this._freeBlade(b);
          const seed = 11 + k;
          b.h = B.spawn({ length: TBLADE.length, width: TBLADE.width, palette: 0, seed });
          b.g0 = B.spawn({ length: TBLADE.length, width: TBLADE.width, palette: 0, seed });
          b.g1 = B.spawn({ length: TBLADE.length, width: TBLADE.width, palette: 0, seed });
        }
        // the storm ring at the knees (one way round), dithered so the foes show through
        const open = F(T.bladeOpen - T.bladesAt);
        const release = F(T.release - T.bladesAt);
        this._keep(S.storm, this.hfx.spawn({
          frame: 'heroCyclone', follow: p, oy: 0.35, dirX: 0, dirZ: -1, flip: true, life: release + 0.14, fps: 24, loop: true,
          s0: 0.45, s1: 1.25, grow: open, spin: -T.spin * 0.55, color: TINT.galeBody, a: RING_A, soft: 0.35, fadeIn: 0.05, fadeOut: 0.14,
        }));
        this._placeTempest();
        break;
      }
      case 'spin': {
        // wind torn off the blades' ring, dust whirled up at the feet
        const a = Math.atan2(pc._baseZ, pc._baseX) + T.spin * (pc.t - F(T.bladesAt));
        const r = T.bladeR;
        sys.burst('heroWindSpark', p.x + Math.cos(a) * r, p.y + 0.8, p.z + Math.sin(a) * r, 3);
        sys.burst('heroGust', p.x - Math.cos(a) * r * 0.7, p.y + 0.08, p.z - Math.sin(a) * r * 0.7, 2);
        break;
      }
      case 'hit': {
        const last = i === 2;
        sys.burst('heroWindSpark', p.x, p.y + 0.8, p.z, last ? 16 : 10);
        sys.burst('heroGust', p.x, p.y + 0.08, p.z, last ? 8 : 5);
        // glints on the blades' ring
        const a = Math.atan2(pc._baseZ, pc._baseX) + T.spin * (pc.t - F(T.bladesAt));
        for (let k = 0; k < 3; k++) {
          const b = a + (k * TAU) / 3;
          sys.burst('heroGlint', p.x + Math.cos(b) * T.bladeR, p.y + 0.85, p.z + Math.sin(b) * T.bladeR, 3);
        }
        if (!S.on) break;
        // the storm charges: the blades' runes fill a third more, they flare (the light does not
        // pulse: the foes struck are in their core flash)
        S.runesTo = Math.min(1, (i + 1) / 3);
        S.flare = BLADE_GLOW.tempestFlare;
        this._kick = 1.8;
        break;
      }
      case 'release': {
        sys.burst('heroWindSpark', p.x, p.y + 0.8, p.z, 18);
        sys.burst('heroGust', p.x, p.y + 0.08, p.z, 10);
        if (!S.on) break;
        S.released = true;
        S.relT = Math.max(0, S.t);
        // the shock ring
        this.hfx.spawn({
          frame: 'heroCyclone', x: p.x, y: p.y + 0.35, z: p.z, dirX: 0, dirZ: -1, life: 0.24, s0: 1.25, s1: 2.4, grow: 0.2,
          color: TINT.galeBody, a: RING_A, soft: 0.3, fadeOut: 0.12,
        });
        break;
      }
      default: break;
    }
  }

  /** Tempest Edge's blades on their orbit (and their ghosts, a step behind), their runes and glow. */
  _placeTempest() {
    const T = TEMPEST;
    const S = this._tem;
    const B = this.stage.blades;
    const P = this._bp;
    const p = this.pc.player.position;
    const t = Math.max(0, S.t);
    const open = F(T.bladeOpen - T.bladesAt);
    const rel = F(T.release - T.bladesAt);
    const after = S.released ? t - S.relT : -1;
    const cp = Math.cos(TBLADE.pitch);
    const sp = Math.sin(TBLADE.pitch);
    const glow = (BLADE_GLOW.base + S.flare) * dayK(DAY.blade);
    const out = after >= 0 ? smooth((after - TBLADE.outDelay) / TBLADE.outT) : 0;
    let any = false;
    for (let k = 0; k < S.blades.length; k++) {
      const b = S.blades[k];
      if (b.h < 0 && b.g0 < 0 && b.g1 < 0) continue;
      any = true;
      const r1 = T.bladeR - (k % 2) * 0.7;
      const oy = 0.75 + (k % 2) * 0.3;
      const r = t < open ? 0.5 + (r1 - 0.5) * ease(t / open) : after < 0 ? r1 : r1 + 16 * after;
      const base = S.a0 + (k * TAU) / T.blades + T.spin * t;
      const roll = TBLADE.roll + (after > 0 ? TBLADE.spinOut * after : 0);
      for (let j = 0; j < 3; j++) {
        const h = j === 0 ? b.h : j === 1 ? b.g0 : b.g1;
        if (h < 0) continue;
        const a = base - (j === 0 ? 0 : TBLADE.lag[j - 1]);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // the motion (the tangent); the axis (point → pommel) against it, raised: the point leads, low
        const ax = sa * cp;
        const ay = sp;
        const az = -ca * cp;
        const cx = p.x + ca * r;
        const cy = p.y + oy + 0.1 * Math.sin(t * 11 + k * 3);
        const cz = p.z + sa * r;
        const half = TBLADE.length * 0.5;
        P.x = cx - ax * half;
        P.y = cy - ay * half;
        P.z = cz - az * half;
        P.ax = ax;
        P.ay = ay;
        P.az = az;
        // the flat: "up" made perpendicular to the axis, rolled about it
        let ux = -ay * ax;
        let uy = 1 - ay * ay;
        let uz = -ay * az;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = ay * uz - az * uy;
        const vy = az * ux - ax * uz;
        const vz = ax * uy - ay * ux;
        const cr = Math.cos(roll);
        const sr = Math.sin(roll);
        P.nx = cr * ux + sr * vx;
        P.ny = cr * uy + sr * vy;
        P.nz = cr * uz + sr * vz;
        // materialising pommel first; at the release the pommel goes first, the point last
        if (t < TBLADE.appear) {
          P.dissolve = 1 - t / TBLADE.appear;
          P.dissolveDir = 1;
        } else if (out > 0) {
          P.dissolve = out;
          P.dissolveDir = -1;
        } else {
          P.dissolve = 0;
          P.dissolveDir = 0;
        }
        P.ghost = j === 0 ? 0 : Math.min(0.99, TBLADE.ghost[j - 1] + (after > 0 ? 0.5 * smooth(after / 0.1) : 0));
        P.glow = j === 0 ? glow : glow * TBLADE.ghostGlow;
        P.runes = S.runes;
        B.set(h, P);
      }
      if (out >= 1) this._freeBlade(b);
    }
    if (!any && S.t >= 0) S.on = S.on && t < rel + 0.5;
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: Dragonfang Wave
  // ------------------------------------------------------------------------------------------

  /**
   * Dragonfang Wave's beats: 'windup' (f2: dust, the first gathering star, the light), 'release'
   * (the swing's arc, the crescent riding the wave's front with its crest, the light riding it — no
   * flash: the wave bites at once, and a foe in its core flash only blooms wider under a light).
   * @param {'windup'|'release'} beat
   */
  fang(beat) {
    const sys = this.sys;
    const pc = this.pc;
    const p = pc.player.position;
    const fx = pc.player.facing;
    const S = this._fang;
    if (beat === 'windup') {
      this._drop(S.crest);
      this._drop(S.crestLit);
      S.on = true;
      S.t = 0;
      S.released = false;
      S.ended = false;
      S.last = 2;
      this._glowRgb = GLOW.crimson;
      this._takeField('fang');
      sys.burst('heroGust', p.x - fx.x * 0.4, p.y + 0.08, p.z - fx.z * 0.4, 5);
      this._gatherStar(0);
      return;
    }
    // the release
    const W = pc._wave;
    S.on = true;
    S.released = true;
    S.relT = S.t;
    S.ended = false;
    this._kick = 2.0;
    if (this.lightOwner !== 'fang') this._takeField('fang');
    this.hfx.pair({
      frame: 'heroGale', x: p.x + fx.x * 0.6, y: p.y + 0.8, z: p.z + fx.z * 0.6, dirX: fx.x, dirZ: fx.z,
      life: 0.2, strip: 0.12, s0: 1.25, s1: 1.4, color: TINT.fangBody, fadeOut: 0.08,
    }, 'heroGaleLit', TINT.fangLit);
    // the crescent skims the ground at the wave's front — a crimson band, its coral edge, a white-hot
    // line inside — and two after-images trail it
    const wave = { kind: /** @type {'wave'} */ ('wave'), frame: 'heroWave', grow: 0.25, life: 2, fps: 24, loop: true, fadeIn: 0.03, fadeOut: 0.12, wave: W };
    this.hfx.spawn({ ...wave, trail: 1.6, oy: 0.35, a: 0.4, s0: 1.1 * 0.8, s1: 1.1 * 1.12, color: TINT.fangBody });
    this.hfx.spawn({ ...wave, trail: 0.8, oy: 0.35, a: 0.6, s0: 1.2 * 0.8, s1: 1.2 * 1.12, color: TINT.fangBody });
    this.hfx.pair({ ...wave, trail: 0, oy: 0.35, a: 1, s0: 1.3 * 0.8, s1: 1.3 * 1.12, color: TINT.fangBody }, 'heroWaveLit', TINT.fangLit);
    this.hfx.spawn({ ...wave, frame: 'heroWaveLit', trail: 0.12, oy: 0.37, a: 1, s0: 0.98 * 0.8, s1: 0.98 * 1.12, color: TINT.fangCore, halo: 1 });
    // the crest: three fangs rising off the ground at the front, behind what they pass
    const crest = { kind: /** @type {'wave'} */ ('wave'), frame: 'heroFangCrest', mode: /** @type {'billboard'} */ ('billboard'), wave: W, trail: -0.05, oy: 0.8, back: 0.25,
      s0: 0.7, life: 2, a: 0.85, fadeIn: 0.04, fadeOut: 0.12, color: TINT.fangBody, live: true };
    this._keep(S.crest, this.hfx.spawn(crest));
    this._keep(S.crestLit, this.hfx.spawn({ ...crest, frame: 'heroFangCrestLit', back: 0.25 - 0.03, color: TINT.fangLit, halo: 1 }));
    sys.burst('heroFangEmber', W.x, W.y + 0.6, W.z, 8);
    sys.burst('heroGust', p.x + fx.x * 0.5, p.y + 0.08, p.z + fx.z * 0.5, 6);
  }

  /**
   * One of Dragonfang Wave's three gathering stars (the wind-up's f2 / f5 / f8): a star off to one
   * side, drawn in to the blade over 0.1 s.
   * @param {number} k 0 … 2
   */
  _gatherStar(k) {
    const c = this._bladeAt();
    const a = this.rng.next() * TAU;
    const d = 0.7 + 0.2 * k;
    const ox = Math.cos(a) * d;
    const oy = 0.25 + 0.3 * this.rng.next();
    const oz = Math.sin(a) * d;
    this.hfx.spawn({
      frame: 'partySunburst', mode: 'billboard', x: c.x + ox, y: c.y + oy, z: c.z + oz, vx: -ox / 0.1, vy: -oy / 0.1, vz: -oz / 0.1,
      index: 0, s0: 0.25, s1: 0.18, life: 0.12, back: -0.25, spin: 4, color: TINT.fangLit, halo: 1, fadeOut: 0.04,
    });
  }

  /** The wave ran 0.8 u more: dust and crimson sparks at its front. @param {{ x: number, y: number, z: number }} W */
  waveBeat(W) {
    this.sys.burst('heroGust', W.x, W.y + 0.06, W.z, 2);
    this.sys.burst('heroFangEmber', W.x, W.y + 0.6, W.z, 2);
  }

  /**
   * The wave is spent or broken on a wall: its quads fade where it stopped, the crest collapses, the
   * light fades; on a wall a burst of crimson rays, chips and dust.
   * @param {{ x: number, y: number, z: number }} W
   * @param {boolean} wall
   */
  waveEnd(W, wall) {
    const sys = this.sys;
    const S = this._fang;
    for (const r of [S.crest, S.crestLit]) {
      const rec = this._get(r);
      if (!rec) continue;
      // (it falls apart: the collapse frame, then gone)
      rec.index = 3;
      rec.loop = false;
      rec.strip = 0;
      rec.fadeOut = 0.1;
      rec.life = Math.min(rec.life, rec.t + 0.12);
      rec.kind = 'basic';
      rec.x = W.x;
      rec.y = W.y;
      rec.z = W.z;
      rec.wave = null;
    }
    this.hfx.endWave();
    S.ended = true;
    S.endT = S.t;
    S.x = W.x;
    S.y = W.y;
    S.z = W.z;
    sys.burst('heroFangEmber', W.x, W.y + 0.6, W.z, wall ? 12 : 6);
    if (wall) {
      sys.burst('heroDebris', W.x, W.y + 0.5, W.z, 10);
      sys.burst('heroGust', W.x, W.y + 0.1, W.z, 6);
      this.hfx.spawn({ frame: 'partySunburst', mode: 'billboard', x: W.x, y: W.y + 0.7, z: W.z, index: 1, s0: 1.0, life: 0.16, back: -0.2, color: TINT.fangLit, halo: 1, fadeOut: 0.1 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: Skyfall Judgement
  // ------------------------------------------------------------------------------------------

  /**
   * Skyfall's beats: 'crouch' (f1: the sigil, its rune plates, the crouch star), 'leap' (f8: dust,
   * gold motes), 'sword' (the giant sword appears high above the landing point and falls, the light
   * riding its point), 'impact' (the slam: the sword bites, the bite star, the glyph's pulse, the
   * crack, dust, chips, motes, the light's flash).
   * @param {'crouch'|'leap'|'sword'|'impact'} beat
   */
  skyfall(beat) {
    const sys = this.sys;
    const pc = this.pc;
    const p = pc.player.position;
    const L = pc._land;
    const S = this._sky;
    const hfx = this.hfx;
    switch (beat) {
      case 'crouch': {
        this._endSkyfall(true);
        S.on = true;
        S.t = pc.t;
        S.ended = false;
        S.landed = false;
        S.released = false;
        S.flare = 0;
        S.ghostK = 0;
        S.flash = 0;
        S.blink = 0;
        S.last = 1;
        S.dissolve = 0;
        this._glowRgb = GLOW.gold;
        // the sigil: a dark engraved gold, dithered (the foes inside show through), lifted over the grass
        this._keep(S.sigil, hfx.spawn({
          tag: 'skyfall', frame: 'heroSigil', follow: L, oy: FLAT_LIFT, dirX: 0, dirZ: -1, life: F(SKYFALL.total - 2), s0: 0.5, s1: 1.1,
          grow: F(SKYFALL.land - 1), spin: 1.1, color: TINT.sigilBody, a: GLYPH_A, fadeIn: 0.12, fadeOut: 0.35,
        }));
        // its rune plates, igniting one by one clockwise from his side
        const pa = Math.atan2(p.z - L.z, p.x - L.x);
        const rank = [];
        for (let k = 0; k < PLATES.n; k++) {
          const phi = this._plateAngle(k, 0);
          rank.push([((phi - pa) % TAU + TAU) % TAU, k]);
          this._keep(S.plates[k], hfx.spawn({
            tag: 'skyfall', frame: 'heroRunes', x: L.x, y: L.y + FLAT_LIFT + LIT_DY, z: L.z, life: F(SKYFALL.total - 2), s0: 0.5,
            color: TINT.sigilBody, a: 0, live: true,
          }));
        }
        rank.sort((a, b) => a[0] - b[0]);
        rank.forEach(([, k], i) => { S.order[k] = i; });
        // the crouch star at the blade: the power has a source before the leap
        const c = this._bladeAt();
        this._keep(S.star, hfx.spawn({
          tag: 'skyfall', frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, index: 0, s0: 0.25, life: F(SKYFALL.rise + 2),
          back: -0.25, spin: 2, color: TINT.runeLit, halo: 1, fadeIn: 0.05, fadeOut: 0.06, live: true,
        }));
        break;
      }
      case 'leap':
        sys.burst('heroGust', p.x, p.y + 0.08, p.z, 10);
        sys.burst('heroHoly', p.x, p.y + 0.6, p.z, 8);
        break;
      case 'sword': {
        if (!S.on) break;
        const B = this.stage.blades;
        if (S.sword < 0) S.sword = B.spawn({ length: SWORD.length, width: SWORD.width, palette: 1, seed: 7 });
        for (let j = 0; j < 2; j++) if (S.ghosts[j] < 0) S.ghosts[j] = B.spawn({ length: SWORD.length, width: SWORD.width, palette: 1, seed: 7 });
        this._takeField('skyfall');
        this._placeSword();
        sys.burst('heroHoly', S.sx, S.py + SWORD.length * 0.6, S.sz, 10);
        break;
      }
      case 'impact': {
        S.landed = true;
        S.landT = S.t;
        S.flare = BLADE_GLOW.skyFlare;
        S.flash = LIGHT.sFlash - LIGHT.sHold;
        this._kick = 2.2;
        const B = this.stage.blades;
        for (let j = 0; j < 2; j++) {
          if (S.ghosts[j] >= 0) B.free(S.ghosts[j]);
          S.ghosts[j] = -1;
        }
        const vx = this._viewX();
        const vz = this._viewZ();
        const sx = L.x + vx * SWORD.beyond;
        const sz = L.z + vz * SWORD.beyond;
        // (a scene settled its look away: the slam lands without its ornaments)
        if (S.on) this._skyImpact(sx, sz);
        sys.burst('heroDebris', L.x, L.y + 0.2, L.z, 24);
        // (one low, dark, rolling dust ring: no veil over the knocked-down foes)
        sys.burst('heroDustRing', p.x, p.y + 0.15, p.z, 12);
        sys.burst('heroHoly', L.x, L.y + 0.5, L.z, 12);
        break;
      }
      default: break;
    }
  }

  /**
   * The slam's ornaments: the crack, the bite star, the glyph's pulse.
   * @param {number} sx @param {number} sz the bite's point (the sword's foot)
   */
  _skyImpact(sx, sz) {
    const pc = this.pc;
    const L = pc._land;
    const S = this._sky;
    const hfx = this.hfx;
    // the crack the sword drives into the ground: gold where it bit, dark within 0.45 s
    this._keep(S.crack, hfx.spawn({
      frame: 'heroCrack', x: L.x, y: L.y + 0.06, z: L.z, dirX: pc._leapX, dirZ: pc._leapZ, life: 1.6, s0: 0.9, s1: 1.05, grow: 0.12,
      color: TINT.runeLit, a: 0.75, fadeOut: 0.7, live: true,
    }));
    // the bite: a gold star where the point went in (toward the camera from the blade)
    hfx.spawn({
      frame: 'partySunburst', mode: 'billboard', x: sx, y: L.y + 0.45, z: sz, index: 1, s0: 1.2, life: 0.16, back: -0.25,
      color: this._gold(TINT.goldFlash), halo: 1, fadeOut: 0.1,
    });
    // the glyph's pulse: the sigil a moment brighter (still dithered, under the gate)
    const sig = this._get(S.sigil);
    hfx.spawn({
      frame: 'heroSigil', x: L.x, y: L.y + FLAT_LIFT + 0.02, z: L.z, dirX: 0, dirZ: -1, rot: sig ? sig.rot + sig.spin * sig.t : 0, spin: 1.1,
      life: 0.25, s0: 1.1, s1: 1.25, color: this._gold(TINT.sigilPulse), a: GLYPH_A, fadeOut: 0.2,
    });
  }

  /**
   * Skyfall's action ends at frame `frame` (PlayerCombat._clearActionState): cut short before the
   * slam — its glyph, plates and star fade at once, no sword, its light given back —; after it, the
   * sword stands on and dissolves on its own clock.
   * @param {number} frame
   */
  skyfallEnd(frame) {
    const S = this._sky;
    if (!S.on) return;
    if (frame < SKYFALL.land && !S.landed) {
      this.hfx.fadeTag('skyfall', 0.15);
      this._endSkyfall(false);
    } else S.ended = true;
  }

  /**
   * Skyfall's look off: the sword and its ghosts gone, its light given back (`quads`: its records killed too).
   * @param {boolean} quads
   */
  _endSkyfall(quads) {
    const S = this._sky;
    const B = this.stage.blades;
    if (S.sword >= 0) B.free(S.sword);
    for (let j = 0; j < 2; j++) if (S.ghosts[j] >= 0) B.free(S.ghosts[j]);
    S.sword = S.ghosts[0] = S.ghosts[1] = -1;
    if (quads) {
      this._drop(S.sigil);
      for (const r of S.plates) this._drop(r);
      this._drop(S.star);
      this._drop(S.crack);
    }
    if (this.lightOwner === 'skyfall') this._releaseField();
    S.on = false;
  }

  /**
   * A rune plate's angle round the landing point (world, atan2(z, x)) — on the sigil's rune band, the
   * three runes of plate k over the band's runes 3k … 3k + 2, turning with the sigil.
   * @param {number} k
   * @param {number} rot the sigil's turn now
   */
  _plateAngle(k, rot) {
    // the sigil's runes sit at 0.13 + j·2π/24 (its texture's angle); a flat quad facing −Z maps a
    // texture angle α turned by `rot` to the world angle −(α + rot)
    return -(0.13 + ((3 * k + 1) * TAU) / 24 + rot);
  }

  /** Skyfall's sword: falling, biting, standing, dissolving; its ghosts; the readability ghost. */
  _placeSword() {
    const S = this._sky;
    const pc = this.pc;
    const L = pc._land;
    const B = this.stage.blades;
    const P = this._bp;
    const vx = this._viewX();
    const vz = this._viewZ();
    const t0 = F(SKYFALL.swordAt);
    const t1 = F(SKYFALL.land);
    const t = S.t;
    const k = clamp01((t - t0) / (t1 - t0));
    S.sx = L.x + vx * SWORD.beyond;
    S.sz = L.z + vz * SWORD.beyond;
    let py = L.y - SWORD.sink + SKYFALL.swordY * (1 - k * k);
    if (S.landed) py -= SWORD.bite * clamp01(1 - (t - S.landT) / SWORD.biteT);
    S.py = py;
    // leaning back along the leap a little (it came down along it); its flat to the camera
    const ax = -pc._leapX * SWORD.lean;
    const az = -pc._leapZ * SWORD.lean;
    const al = Math.hypot(ax, 1, az);
    P.ax = ax / al;
    P.ay = 1 / al;
    P.az = az / al;
    P.nx = -vx;
    P.ny = 0;
    P.nz = -vz;
    const relT = F(SWORD.release);
    S.dissolve = t >= relT ? clamp01((t - relT) / SWORD.dissolve) : 0;
    const appear = t - t0;
    if (appear < SWORD.appear) {
      P.dissolve = 1 - appear / SWORD.appear;
      P.dissolveDir = 1;
    } else {
      P.dissolve = S.dissolve;
      P.dissolveDir = 1;
    }
    const pulse = S.landed ? 1 + LIGHT.sPulse * Math.sin(TAU * LIGHT.sPulseHz * (t - S.landT)) : 1;
    const glow = (BLADE_GLOW.base * pulse + S.flare) * dayK(DAY.blade);
    P.runes = S.landed ? 1 : smooth(k * 1.1);
    P.glow = glow;
    if (S.sword >= 0) {
      P.x = S.sx;
      P.y = py;
      P.z = S.sz;
      P.ghost = S.ghostK;
      B.set(S.sword, P);
    }
    for (let j = 0; j < 2; j++) {
      const g = S.ghosts[j];
      if (g < 0) continue;
      P.x = S.sx;
      P.y = py + SWORD.ghostUp[j];
      P.z = S.sz;
      P.ghost = Math.min(0.99, SWORD.ghostCut[j] + 0.4 * k * k);
      P.glow = glow * 0.6;
      B.set(g, P);
    }
    if (S.sword >= 0 && S.dissolve >= 1) {
      B.free(S.sword);
      S.sword = -1;
    }
  }

  /**
   * How much the standing sword should be a ghost now: `screenGhost` when a foe stands behind the
   * blade's upper part as the camera sees it (its sprite's rays to the camera crossing the blade's
   * plane between `upper` u over the ground and the pommel, within the blade's width), `bossGhost`
   * while the blade overlaps the boss that way, else 0. The foes at the landing point (the soft
   * target, the ones struck: within their radius + `struck`) never count. Read only.
   * @returns {number}
   */
  _screens() {
    const S = this._sky;
    const L = this.pc._land;
    const vx = this._viewX();
    const vz = this._viewZ();
    const C = globalUniforms.uCameraPosition.value;
    // (depth along the view, lateral across it: the sword's plane faces the camera)
    const dC = C.x * vx + C.z * vz;
    const lC = -C.x * vz + C.z * vx;
    const dS = S.sx * vx + S.sz * vz;
    const lS = -S.sx * vz + S.sz * vx;
    if (dS - dC < 0.5) return 0;
    const yLow = L.y + SWORD.upper;
    const yTop = S.py + SWORD.length;
    const half = SWORD.width * 0.5;
    let ghost = 0;
    const list = this.sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || !e.sprite.visible) continue;
      const q = e.position;
      if (Math.hypot(q.x - L.x, q.z - L.z) < e.radius + SWORD.struck) continue;
      const dQ = q.x * vx + q.z * vz;
      if (dQ < dS + (e.boss ? 0.1 : SWORD.behind)) continue;
      // where the camera's rays to its sprite cross the sword's plane
      const k = (dS - dC) / (dQ - dC);
      const size = e.sprite.size;
      const lat = lC + (-q.x * vz + q.z * vx - lC) * k;
      if (Math.abs(lat - lS) > half + Math.max(e.radius, size.x * SWORD.bodyW) * k) continue;
      const y0 = q.y + e.hover;
      const yb = C.y + (y0 - C.y) * k;
      const yt = C.y + (y0 + size.y * SWORD.bodyH - C.y) * k;
      if (yt < yLow || yb > yTop) continue;
      if (!e.boss) return SWORD.screenGhost;
      ghost = SWORD.bossGhost;
    }
    return ghost;
  }

  /** Skyfall's plates, crouch star and crack at their time. */
  _skyLook() {
    const S = this._sky;
    const L = this.pc._land;
    const t = S.t;
    const sig = this._get(S.sigil);
    // the sigil's scale, turn and fade now (HeroFx's own formulas for that record)
    let scale = 1.1;
    let rot = 0;
    let sa = 0;
    if (sig) {
      const g = sig.grow > 0 ? Math.min(1, sig.t / sig.grow) : 1;
      scale = sig.s0 + (sig.s1 - sig.s0) * ease(g);
      rot = sig.rot + sig.spin * sig.t;
      sa = (sig.fadeIn > 0 ? Math.min(1, sig.t / sig.fadeIn) : 1) * (sig.fadeOut > 0 ? clamp01((sig.life - sig.t) / sig.fadeOut) : 1);
    }
    const pulse = S.landed ? 1 + LIGHT.sPulse * Math.sin(TAU * LIGHT.sPulseHz * (t - S.landT)) : 1;
    const gk = goldK();
    // (the engraved body darker still under a low sun — × goldK²: the golden hour's exposure and
    // grade lifted its dark gold to R ≈ 200, into the fire band)
    const bk = gk * gk;
    if (sig) {
      const B = TINT.sigilBody;
      sig.cr0 = sig.cr1 = B[0] * bk;
      sig.cg0 = sig.cg1 = B[1] * bk;
      sig.cb0 = sig.cb1 = B[2] * bk;
    }
    const rad = (PLATES.radiusPx / 16) * scale;
    for (let k = 0; k < PLATES.n; k++) {
      const rec = this._get(S.plates[k]);
      if (!rec) continue;
      if (!sig) {
        this.hfx.kill(rec);
        continue;
      }
      const phi = this._plateAngle(k, rot);
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      rec.x = L.x + c * rad;
      rec.y = L.y + FLAT_LIFT + LIT_DY;
      rec.z = L.z + s * rad;
      rec.dirX = c;
      rec.dirZ = s;
      rec.s0 = rec.s1 = scale;
      const o = S.order[k];
      const lit = t >= F(PLATES.igniteFrom + PLATES.igniteEvery * o) && t < F(PLATES.outFrom + PLATES.outEvery * o);
      rec.index = lit ? 1 : 0;
      const cc = lit ? TINT.runeLit : TINT.sigilBody;
      const m = lit ? pulse * gk : bk;
      rec.cr0 = rec.cr1 = cc[0] * m;
      rec.cg0 = rec.cg1 = cc[1] * m;
      rec.cb0 = rec.cb1 = cc[2] * m;
      rec.halo = lit ? 1 : 0;
      rec.a = (lit ? 0.85 : GLYPH_A) * sa;
    }
    const star = this._get(S.star);
    if (star) {
      const c = this._bladeAt();
      star.x = c.x;
      star.y = c.y;
      star.z = c.z;
      star.s0 = star.s1 = 0.25 + 0.15 * smooth(t / F(SKYFALL.rise - 1));
      const H = TINT.runeLit;
      star.cr0 = star.cr1 = H[0] * gk;
      star.cg0 = star.cg1 = H[1] * gk;
      star.cb0 = star.cb1 = H[2] * gk;
    }
  }

  /**
   * The slam's crack cooling: gold where it bit, dark within 0.45 s (e^(−t / 0.12); ground cracks
   * that glow on are the foes' language) — every frame while it lives, Skyfall's show on or not.
   */
  _coolCrack() {
    const crack = this._get(this._sky.crack);
    if (!crack) return;
    const heat = Math.exp(-crack.t / 0.12) * goldK();
    const B = TINT.crackBody;
    const H = TINT.runeLit;
    crack.cr0 = crack.cr1 = B[0] + (H[0] - B[0]) * heat;
    crack.cg0 = crack.cg1 = B[1] + (H[1] - B[1]) * heat;
    crack.cb0 = crack.cb1 = B[2] + (H[2] - B[2]) * heat;
  }

  /**
   * A gold lit tint under the sun now (× goldK: dimmer under a low sun), in a scratch array (HeroFx
   * copies a colour at its spawn).
   * @param {readonly number[]} c
   */
  _gold(c) {
    const k = goldK();
    const o = this._gc;
    o[0] = c[0] * k;
    o[1] = c[1] * k;
    o[2] = c[2] * k;
    return o;
  }

  // ------------------------------------------------------------------------------------------
  // The foes struck (read only: the combat's 'hit' event)
  // ------------------------------------------------------------------------------------------

  /**
   * A hit of the player landed on `e` (CombatSystem `'hit'`, inside a sub-step): a cut across it for
   * Tempest Edge, a bite for Dragonfang Wave (which move by the hit's tag — read only).
   * @param {Enemy} e
   */
  onHit(e) {
    const pc = this.pc;
    const sys = this.sys;
    if (this._settling) return;
    if (pc.action === 'skill1' && this._tem.on) {
      for (let i = 0; i < 3; i++) {
        const [h0, h1] = TEMPEST.hits[i];
        const tag = i === 0 ? pc._tagA : i === 1 ? pc._tagB : pc._tagC;
        if (pc.frame >= h0 && pc.frame <= h1 && sys.tags.has(tag, e)) {
          this._mark(e, 'heroCut', TINT.galeLit, 0.1, 0.9);
          return;
        }
      }
    }
    const W = pc._wave;
    if (W.alive && this._fang.on && sys.tags.has(W.tag, e)) {
      this._mark(e, 'heroBite', TINT.fangLit, 0.12, 0.85);
    }
  }

  /**
   * A short mark on a struck foe's chest, a little toward the camera (at most `CUTS_MAX` live).
   * @param {Enemy} e @param {string} frame @param {readonly number[]} color @param {number} life @param {number} scale
   */
  _mark(e, frame, color, life, scale) {
    if (this.hfx.countTag('mark') >= CUTS_MAX) return;
    const sys = this.sys;
    const b = e.def.body;
    const y = sys.bodyBase(e) + Math.min(1.2, (b[0] + b[1]) * 0.5);
    // across the foe the way the blades travel round the player (their tangent there, as the camera
    // sees it: the frame's cut runs 22° up from its +U)
    const p = this.pc.player.position;
    const s = Math.atan2(e.position.z - p.z, e.position.x - p.x) + globalUniforms.uCameraYaw.value;
    const rot = Math.atan2(-0.56 * Math.cos(s), -Math.sin(s)) - 0.385 + (this.rng.next() - 0.5) * 0.3;
    this.hfx.spawn({
      tag: 'mark', frame, mode: 'billboard', x: e.position.x, y, z: e.position.z, back: -(e.radius * 0.6 + 0.15), rot,
      life, strip: life, s0: scale, s1: scale * 1.1, color, halo: 1, fadeOut: life * 0.3,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Per frame
  // ------------------------------------------------------------------------------------------

  /**
   * Once a frame while the combat runs (PlayerCombat._applyVisuals, before HeroFx writes): the moves'
   * clocks, the beats they keep themselves, the swords, plates and stars placed, the glow texels.
   * @param {number} dt combat seconds of the frame (0 in a hit-stop: everything holds)
   */
  visuals(dt) {
    const pc = this.pc;
    if (this._settling) return;
    // ---- the combo's wind-up ----
    const C = this._combo;
    if (C.on && pc.action === 'attack') {
      const f = pc.frame;
      const p = pc.player.position;
      const fx = pc.player.facing;
      if (C.step < 3 && SwordmasterFx.crossed(C.last, f, 3)) {
        // dust at the push-off foot
        this.sys.burst('heroGust', p.x - fx.x * 0.35, p.y + 0.08, p.z - fx.z * 0.35, 2);
      }
      if (C.step === 3 && SwordmasterFx.crossed(C.last, f, 4)) {
        // two wind arcs drawn in to the blade
        const c = this._bladeAt();
        for (const side of [-1, 1]) {
          const ox = -fx.z * side * 0.7;
          const oz = fx.x * side * 0.7;
          this.hfx.spawn({
            frame: 'heroGale', x: c.x + ox, y: c.y - 0.1, z: c.z + oz, vx: -ox / 0.12, vz: -oz / 0.12, dirX: fx.x, dirZ: fx.z, flip: side > 0,
            index: 3, life: 0.12, s0: 0.7, s1: 0.5, color: TINT.galeBody, a: 0.7, fadeOut: 0.05,
          });
        }
      }
      C.last = f;
    } else C.on = false;
    // ---- Tempest Edge ----
    const T = this._tem;
    if (T.on && !T.released && pc.action !== 'skill1') {
      // cut short (a death, a knock-down, a reset): the blades fly out and dissolve now, the storm
      // ring fades, the light rides out with them; before the blades, it just ends
      if (T.t >= 0) {
        T.released = true;
        T.relT = T.t;
        const storm = this._get(T.storm);
        if (storm) storm.life = Math.min(storm.life, storm.t + storm.fadeOut);
      } else {
        T.on = false;
        this._drop(T.ring);
      }
    }
    if (T.on) {
      T.st += dt;
      if (T.t >= 0) T.t += dt;
      T.flare *= Math.exp(-dt / 0.1);
      if (T.runes < T.runesTo) T.runes = Math.min(T.runesTo, T.runes + dt / 0.06);
      const ring = this._get(T.ring);
      if (ring) {
        const u = clamp01(T.st / F(TEMPEST.bladesAt + 2));
        ring.s0 = ring.s1 = 1.5 - 1.0 * u * u;
      }
      if (T.t >= 0) this._placeTempest();
    }
    // ---- Dragonfang Wave ----
    const D = this._fang;
    if (D.on) {
      D.t += dt;
      if (pc.action === 'skill2' && !D.released) {
        const f = pc.frame;
        if (SwordmasterFx.crossed(D.last, f, 5)) this._gatherStar(1);
        if (SwordmasterFx.crossed(D.last, f, 8)) this._gatherStar(2);
        D.last = f;
      }
      this._crestFrame(D.crest);
      this._crestFrame(D.crestLit);
      if (D.ended && D.t > D.endT + LIGHT.fOut + LIGHT.after + 0.05 && this.lightOwner !== 'fang') D.on = false;
      if (!D.released && pc.action !== 'skill2') D.on = false;
    }
    // ---- Skyfall ----
    const S = this._sky;
    if (S.on) {
      if (pc.action === 'skill3' && !S.ended) S.t = pc.t;
      else S.t += dt;
      S.flare *= Math.exp(-dt / 0.12);
      const f = Math.floor(S.t * 60 + 1e-6);
      const last = S.last;
      // gold motes shed by the falling sword
      if (S.sword >= 0 && !S.landed && f > SKYFALL.swordAt && f < SKYFALL.land && (f - SKYFALL.swordAt) % 4 === 0 && last < f) {
        this.sys.burst('heroHoly', S.sx, S.py + SWORD.length * 0.4, S.sz, 4);
      }
      // the cut from the sky (the airborne slash pose)
      if (SwordmasterFx.crossed(last, f, 20) && !S.landed && pc.action === 'skill3') {
        const p = pc.player.position;
        this.hfx.pair({
          tag: 'skyfall', frame: 'heroGale', x: p.x + pc._leapX * 0.6, y: p.y + pc._lift + 0.9, z: p.z + pc._leapZ * 0.6, vx: pc._leapX * 3, vz: pc._leapZ * 3,
          dirX: pc._leapX, dirZ: pc._leapZ, life: 0.15, strip: 0.12, s0: 1.05, s1: 1.2, color: TINT.goldBody, fadeOut: 0.06,
        }, 'heroGaleLit', this._gold(TINT.runeLit));
      }
      if (SwordmasterFx.crossed(last, f, SKYFALL.rise)) {
        const star = this._get(S.star);
        if (star) star.life = Math.min(star.life, star.t + 0.06);
      }
      if (S.landed && S.sword >= 0) {
        // the hold: motes off the blade; the release: motes along the dissolving line
        if (f < SWORD.release && (f - SKYFALL.land) % 6 === 3 && last < f) {
          const y = S.py + 1 + this.rng.next() * 5;
          this.sys.burst('heroMote', S.sx, y, S.sz, 3);
        }
        if (SwordmasterFx.crossed(last, f, SWORD.release)) {
          S.released = true;
          S.blink = LIGHT.sBlink;
        }
        if (S.released && (f - SWORD.release) % 3 === 0 && last < f) {
          this.sys.burst('heroMote', S.sx, S.py + S.dissolve * SWORD.length * 0.82, S.sz, 4);
        }
      }
      S.last = f;
      // the readability ghost: a foe behind the standing sword's upper part, the boss behind it
      const want = S.sword >= 0 && S.t >= F(SKYFALL.swordAt) + SWORD.appear ? this._screens() : 0;
      S.screened = want > 0;
      const step = dt / SWORD.screenEase * SWORD.screenGhost;
      S.ghostK = want > S.ghostK ? Math.min(want, S.ghostK + step) : Math.max(want, S.ghostK - step);
      if (S.sword >= 0 || S.ghosts[0] >= 0 || S.ghosts[1] >= 0) this._placeSword();
      this._skyLook();
      // the show ends once the sword is gone and its light given back
      if (S.sword < 0 && S.landed && S.dissolve >= 1 && this.lightOwner !== 'skyfall' && !this._get(S.sigil)) S.on = false;
      if (S.sword < 0 && !S.landed && S.ended) S.on = false;
    }
    this._coolCrack();
    this._glowFrame(dt);
  }

  /** The fang crest's flicker frame (a wave record: its frame at 24 fps). @param {Ref} r */
  _crestFrame(r) {
    const rec = this._get(r);
    if (rec && rec.kind === 'wave') rec.index = Math.floor(rec.t * 24 + 1e-6) % 3;
  }

  /**
   * The lights, once a frame while the combat runs (SwordStage.update): their flashes and pulses age
   * on the frame's own time (a hit-stop holds a lit frame, not a glare).
   * @param {number} frameDt
   */
  lights(frameDt) {
    this._settling = false;
    if (this.light && !this.light.held) {
      this.light = null;
      this.lightOwner = '';
    }
    if (this.light) {
      switch (this.lightOwner) {
        case 'tempest': this._tempestLight(frameDt); break;
        case 'fang': this._fangLight(frameDt); break;
        case 'skyfall': this._skyLight(frameDt); break;
        default: this._releaseField(); break;
      }
    }
    this._sparkLight(frameDt);
  }

  /** @param {number} frameDt */
  _tempestLight(frameDt) {
    const T = TEMPEST;
    const S = this._tem;
    const L = /** @type {SpellLight} */ (this.light);
    const lp = this._lp;
    const p = this.pc.player.position;
    const day = dayK(DAY.cool);
    lp.color = LIGHT.steel;
    lp.decay = 1;
    lp.flicker = 0;
    // (the light rides the first blade out over the action's last frames, then is given back)
    const tail = F(T.total - T.release) + LIGHT.after;
    if (!S.on || (S.released && S.t - S.relT > tail)) {
      this._releaseField();
      return;
    }
    if (S.t < 0) {
      // gathering over the blade
      lp.intensity = LIGHT.tGather * smooth(S.st / F(T.bladesAt + 1)) * day;
      lp.distance = LIGHT.tGatherDist;
      this._put(L, p.x, p.y + LIGHT.tGatherLift, p.z, lp);
      return;
    }
    if (!S.released) {
      // the storm: a dim flicker circling overhead (no pulse at the hits: the foes struck are in
      // their core flash and hit-stop then — a light only spreads its bloom)
      const flick = 0.85 + 0.15 * hash2(Math.floor(S.t * 14), 37, 5);
      const a = S.t * LIGHT.tW;
      const g = LIGHT.tGather + (LIGHT.tStorm - LIGHT.tGather) * smooth(S.t / 0.1);
      lp.intensity = g * flick * day;
      lp.distance = LIGHT.tDist;
      this._put(L, p.x + Math.cos(a) * LIGHT.tOrbit, p.y + LIGHT.tLift, p.z + Math.sin(a) * LIGHT.tOrbit, lp);
      return;
    }
    // the release: it rides the first blade outward, fading
    const u = clamp01((S.t - S.relT) / (tail - LIGHT.after));
    const k = (1 - u) * (1 - u);
    const r = T.bladeR + 16 * (S.t - S.relT);
    const a = S.a0 + T.spin * S.t;
    lp.intensity = LIGHT.tStorm * k * day;
    lp.distance = LIGHT.tDist;
    this._put(L, p.x + Math.cos(a) * r, p.y + LIGHT.tOutLift, p.z + Math.sin(a) * r, lp);
  }

  /** @param {number} frameDt */
  _fangLight(frameDt) {
    const S = this._fang;
    const L = /** @type {SpellLight} */ (this.light);
    const lp = this._lp;
    const pc = this.pc;
    const p = pc.player.position;
    const W = pc._wave;
    const day = dayK(DAY.warm);
    lp.color = LIGHT.crimson;
    lp.decay = 1;
    lp.flicker = 0;
    if (!S.on) {
      this._releaseField();
      return;
    }
    if (!S.released) {
      lp.intensity = LIGHT.fGather * smooth((S.t) / F(DRAGONFANG.release - 2)) * day;
      lp.distance = LIGHT.fGatherDist;
      this._put(L, p.x, p.y + LIGHT.fGatherLift, p.z, lp);
      return;
    }
    let out = 1;
    if (S.ended) {
      const u = (S.t - S.endT) / LIGHT.fOut;
      if (u >= 1 + LIGHT.after / LIGHT.fOut) {
        this._releaseField();
        return;
      }
      out = clamp01(1 - u);
    } else if (W.alive) {
      // (over the front, high: behind it the light falls on the foes bitten a moment ago, whose
      // hit flash it brightens — measured worse)
      S.x = W.x;
      S.y = W.y;
      S.z = W.z;
    }
    const flick = 0.85 + 0.25 * hash2(Math.floor(S.t * 16), 53, 9);
    // (no flash at the release, no pulse at a bite: the foe bitten is in its core flash and hit-stop
    // — the light only rides the front)
    lp.intensity = LIGHT.fRide * flick * day * out;
    lp.distance = LIGHT.fDist;
    this._put(L, S.x, S.y + LIGHT.fLift, S.z, lp);
  }

  /** @param {number} frameDt */
  _skyLight(frameDt) {
    const S = this._sky;
    const L = /** @type {SpellLight} */ (this.light);
    const lp = this._lp;
    const Ld = this.pc._land;
    S.flash *= Math.exp(-frameDt / LIGHT.sTau);
    S.blink *= Math.exp(-frameDt / LIGHT.sBlinkTau);
    // (dimmer under a low sun, like the gold lit layers: on a golden-hour ground it reads as fire)
    const gk = goldK();
    const day = dayK(DAY.warm) * gk;
    lp.color = LIGHT.gold;
    lp.flicker = 0;
    if (!S.on) {
      this._releaseField();
      return;
    }
    if (!S.landed) {
      // riding the falling point: brighter as it nears the ground
      const t0 = F(SKYFALL.swordAt);
      const k = clamp01((S.t - t0) / (F(SKYFALL.land) - t0));
      lp.intensity = (LIGHT.sFall0 + (LIGHT.sFall1 - LIGHT.sFall0) * k) * day;
      lp.distance = LIGHT.sDist0 + (LIGHT.sDist1 - LIGHT.sDist0) * k;
      lp.decay = 1;
      this._put(L, S.sx, Math.max(Ld.y + LIGHT.sFallLift, S.py), S.sz, lp);
      return;
    }
    if (S.sword < 0 && S.dissolve >= 1) {
      // (gone with the sword, a moment after)
      if (S.t > F(SWORD.release) + SWORD.dissolve + LIGHT.after) {
        this._releaseField();
        return;
      }
      L.off();
      return;
    }
    // the flash at the slam into the hold's low glow (its falloff turning from 1 to the lamps' 2),
    // pulsing with the runes; at the release a blink, then it fades with the dissolve
    const f = S.flash / (LIGHT.sFlash - LIGHT.sHold);
    const pulse = 1 + LIGHT.sPulse * Math.sin(TAU * LIGHT.sPulseHz * (S.t - S.landT));
    const hold = LIGHT.sHold * pulse * (1 - S.dissolve);
    lp.intensity = hold * day + (S.flash + S.blink) * dayK(DAY.flash) * gk;
    lp.decay = LIGHT.sHoldDecay + (1 - LIGHT.sHoldDecay) * f;
    lp.distance = LIGHT.sFlashDist;
    this._put(L, Ld.x, Ld.y + LIGHT.sFlashLift, Ld.z, lp);
  }

  /** The minor spark's quick fall (A3's thrust, the draught). @param {number} frameDt */
  _sparkLight(frameDt) {
    const L = this.spark;
    if (!L) return;
    this._sparkT += frameDt;
    const a3 = this._sparkKind === 'a3';
    const T = a3 ? LIGHT.sparkT : LIGHT.draughtT;
    // (its light taken over by a move: the spark is over at once)
    if (this._sparkT >= T || !L.held) {
      this._releaseSpark();
      return;
    }
    const lp = this._lp;
    lp.decay = 1;
    lp.flicker = 0;
    if (a3) {
      const k = 1 - this._sparkT / T;
      lp.color = LIGHT.steel;
      lp.intensity = LIGHT.sparkI * k * k * dayK(DAY.flash);
      lp.distance = LIGHT.sparkDist;
    } else {
      lp.color = LIGHT.heal;
      lp.intensity = LIGHT.draughtI * Math.exp(-this._sparkT / LIGHT.draughtTau) * dayK(DAY.warm);
      lp.distance = LIGHT.draughtDist;
    }
    this._put(L, this._sparkX, this._sparkY, this._sparkZ, lp);
  }

  /**
   * The blade's glow texels: charging through each move's wind-up, a flash at its release, decaying
   * (only lights anything once the sheet has glow texels).
   * @param {number} dt
   */
  _glowFrame(dt) {
    const pc = this.pc;
    const f = pc.frame;
    let target = 0;
    switch (pc.action) {
      case 'attack': {
        const a3 = pc.combo === 3;
        const fxAt = a3 ? 10 : 5;
        if (f < fxAt) target = (a3 ? 1.0 : 0.6) * smooth(f / fxAt);
        break;
      }
      case 'skill1': if (f <= TEMPEST.release) target = 1.2 * smooth(f / 5); break;
      case 'skill2': if (f < DRAGONFANG.release) target = 1.4 * smooth((f - 2) / (DRAGONFANG.release - 2)); break;
      case 'skill3': if (f < SKYFALL.land) target = 1.3 * smooth(f / 7); break;
      default: break;
    }
    if (this._kick > 0) {
      this.glow = Math.max(this.glow, this._kick);
      this._kick = 0;
    }
    if (!pc.alive) this.glow = 0;
    else if (target >= this.glow) this.glow = target;
    else this.glow = target + (this.glow - target) * Math.exp(-dt / GLOW.tau);
    if (this.glow < 0.01) this.glow = 0;
    this._writeGlow(Math.min(GLOW.max, this.glow));
  }

  /** @param {number} a */
  _writeGlow(a) {
    const v = Math.round(a * 100) / 100;
    if (v === this._glowShown) return;
    this._glowShown = v;
    const c = this._glowRgb;
    this.pc.sprite?.setGlow?.(c[0], c[1], c[2], v);
  }

  /** Tests: the look's state (`sys.sword.info().look`). */
  info() {
    const T = this._tem;
    const S = this._sky;
    let blades = 0;
    for (const b of T.blades) blades += (b.h >= 0 ? 1 : 0) + (b.g0 >= 0 ? 1 : 0) + (b.g1 >= 0 ? 1 : 0);
    blades += (S.sword >= 0 ? 1 : 0) + (S.ghosts[0] >= 0 ? 1 : 0) + (S.ghosts[1] >= 0 ? 1 : 0);
    return {
      effects: this.hfx.count, blades, sword: S.sword >= 0, screened: S.screened, ghost: +S.ghostK.toFixed(2),
      tempest: T.on, fang: this._fang.on, skyfall: S.on, settling: this._settling, glow: +this.glow.toFixed(2),
      lights: {
        ...this.lights_, held: (this.light?.held ? 1 : 0) + (this.spark?.held ? 1 : 0), owner: this.lightOwner, spark: this._sparkKind,
      },
    };
  }
}
