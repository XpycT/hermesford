import { RNG, hashString, globalUniforms } from '../../engine/index.js';
import { registerPresets } from '../../engine/fx/Particles.js';
import { SpectralBells } from '../../engine/fx/SpectralBells.js';
import { glowSpots } from './glowSpots.js';

/**
 * @import { LookStage } from './types.js'
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { PlayerCombat, HeroFx, HeroFxLive, HeroFxSpec, BellMoves } from './PlayerCombat.js'
 * @import { ComboStep } from './rules.js'
 * @import { Enemy } from './Enemy.js'
 * @import { SpellLight } from '../../engine/lighting/VfxLights.js'
 * @import { TollBell, KitRules } from './kits/bellwarden.js'
 * @import { FxFrameSpec, FxPen, FxKit, FxModule } from '../../engine/pixel/FxSprites.js'
 */

/**
 * BellwardenFx — the look of the bellwarden's kit (Linnet Halloway, the player of The Bells of
 * Evermere: `campaign.player.kit: 'bellwarden'`; docs/contracts/EVERMERE_CAMPAIGN.md §5.5, §6.5).
 * Visuals only: the kit (src/game/combat/kits/bellwarden.js) keeps the moves — their frames, hits,
 * marks, hit-stop, shake and sounds — and calls these hooks at their beats; nothing here touches a
 * hit, a tag, a cooldown or the fight's RNG (the look has its own: `bell:player` and the combat
 * seed), so the fights play the same (the hit listener only reads which foe a blow landed on, and
 * rings the hammer's sound once a swing).
 *
 * A module of its own, imported (`import()`) by `CombatSystem.load` only when the player's kit is the
 * bellwarden's: there the combat makes one `BellStage` (`sys.bell`: the 3D bells, warmed at load,
 * disposed with the combat) and its `director(pc)` gives the player's kit its look (`pc.bellLook`).
 * Anywhere else nothing of it exists — no program, draw call, object or download.
 *
 * The look — bells, not blades: rhythm, resonance, a struck bell you can strike again:
 *  - **Gold on snow, cut-out.** Every ring and arc is a cut-out FxQuads quad whose grey levels run
 *    from a dark amber core to a gold edge in one tint (her FX frames, `FRAMES`): the core reads on
 *    white ground, the edge on dark; no additive layer, no halo, nothing white-hot (the lit tints stay
 *    ≤ 1.3); the tints dim after dark (HeroFx) and under a low sun (`goldK`).
 *  - **The hammer.** Each blow a heavy bronze crescent (`hammerArc`) with sparks where it lands; the
 *    overhead slam a crater with cracks (`hammerCrack`), a small sound ring and thrown snow; the
 *    hammer's glow texels (`gear.hammerGlow` paints them) charge through each wind-up and flash at the
 *    blow. Its marks: small gold rings over the foe (`bellMark`, one to three), popping as they come,
 *    bursting as they are detonated.
 *  - **Peal**: the cone of sound (`bellPeal`) rolling out from the hammer, a burst on every foe whose
 *    marks it detonates.
 *  - **Toll**: a 3D spectral bell (`SpectralBells`) taking shape over the point as the hammer comes
 *    down, falling there, standing a hand above the ground with its crack beneath; at every toll it
 *    swings (away from the blow that struck it), its sound bow flares and a broken sound ring rolls
 *    out to its reach (`bellArc` segments) with an echo behind; it dissolves crown first at its end.
 *  - **Carillon**: four bells dropping round her one after another, each ringing its note as it lands
 *    (a small ring, a note glyph rising); at the last chord all four swing and flare together and a
 *    great sound ring rolls out to 8 u, then they dissolve.
 *  - **Light** (COMBAT_VFX.md §4.8): one field light — the planted bell's low glow with a flash at
 *    each toll, or Carillon's gathering glow with a flash per note and at the chord (a new skill takes
 *    the other's light over) — and at most one `minor` spark (the slam, Peal's burst, the draught).
 *    Warm lights × dayK(0.4); a flash's part above its light's hold × dayK(0.25), aging on the frame's
 *    own time (a hit-stop holds a lit frame, not a glare); no pulse at a hit; none above 6; all ≥ 2 u
 *    up; dark while the combat does not run; given back after every move, a reset, a travel.
 *  - **The scene settle** (D-3): a story scene that starts on a set-piece level while effects are up
 *    (the ambient step) fades them out over 0.25 s of frames — the bells dissolve, the lights go dark
 *    and are given back; a bell still standing in the kit takes shape again when the fight resumes.
 */

/** The kit's rules (its module's `M`: rules.js's through PlayerCombat and its own): set when a director is made. @type {KitRules} */
let M;

/**
 * The bellwarden's particle presets (registered by `BellStage`: in her chunk, never in the combat
 * chunk every combat level downloads). Bronze and amber, never white-hot: on snow a gold spark stays
 * a spark (hdr ≤ 1.3). Each shares a pool the combat's warm-up made (presets/hero.js's rule: its
 * pool-key fields are those of `hitSpark`, `sparkle` and `footstep`), so none adds a pool or a program.
 */
const BELL_PRESETS = Object.freeze({
  /** Bronze sparks off a hammer blow (short, heavy: they fall). */
  bellSpark: {
    mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
    lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 7, life: [0.14, 0.3], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.4, 0.4, 0.4], burstSpeed: [3, 7], burstUp: [0.8, 2.4], gravity: 9, drag: 2.5,
    colors: ['#ffb84a', '#e8892a', '#ffd88a'], hdr: 1.3, alpha: 1,
  },
  /** Pale-gold shimmer shed by a bell's ring (the toll, a Carillon bell landing). */
  bellShimmer: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
    lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 6, life: [0.4, 0.8], size: [0.1, 0.18], sizeEnd: 0.6,
    spawnSize: [1.2, 0.6, 1.2], velocity: [0, 0.8, 0], burstSpeed: [0.6, 1.8], burstUp: [0.3, 1.0], gravity: 0.3, drag: 2.2, spin: [0.5, 2],
    color: '#ffd27a', hdr: 1.2, alpha: 1,
  },
  /** Snow and grit thrown up by the slam and a planted bell (lit: it takes the ground's light). */
  bellPuff: {
    mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
    lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 10, life: [0.45, 0.85], size: [0.24, 0.4], sizeEnd: 2.0,
    spawnSize: [0.9, 0.08, 0.9], burstSpeed: [2.2, 4.6], burstUp: [0.3, 1.1], gravity: -0.3, drag: 4.0, spin: [0.4, 2],
    color: '#d6dbe2', alpha: 0.55,
  },
});

/**
 * The tints (linear HDR × the atlas's grey levels: W 1.0 … R 0.3). A gold whose R-level is a dark
 * amber (≈ 0.33, 0.2, 0.07) and whose W-level stays ≤ 1.3 (no bloom-white on snow); a bronze for
 * the hammer's swing (darker: a heavy head, not a light).
 */
const TINT = Object.freeze({
  ring: Object.freeze([1.3, 0.7, 0.12]),
  ringEcho: Object.freeze([1.05, 0.52, 0.09]),
  wave: Object.freeze([1.3, 0.74, 0.14]),
  bronze: Object.freeze([1.0, 0.5, 0.13]),
  crack: Object.freeze([0.55, 0.3, 0.1]),
  mark: Object.freeze([1.35, 0.76, 0.14]),
  note: Object.freeze([1.3, 0.8, 0.2]),
  peal: Object.freeze([1.3, 0.72, 0.13]),
});
/**
 * Under a low sun (the golden hour's warm light and grade push gold toward fire) the gold tints and
 * the warm lights dim: × goldK = 1 − `lowSun` · low by day (SwordmasterFx's rule).
 */
const SUN = Object.freeze({ lowSun: 0.3, lo: 0.3, hi: 0.65 });
/** @type {() => number} */
const goldK = () => {
  const y = globalUniforms.uSunDirection.value.y;
  const x = (y - SUN.lo) / (SUN.hi - SUN.lo);
  const low = 1 - (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return 1 - SUN.lowSun * low * (1 - globalUniforms.uNight.value);
};
/** Day factors (`dayK`): warm lights, a flash's part above its hold, the hammer's glow. */
const DAY = Object.freeze({ warm: 0.4, flash: 0.25, glow: 0.8 });
/** @type {(min: number) => number} */
const dayK = (min) => min + (1 - min) * globalUniforms.uNight.value;

/**
 * The lights (linear colours; intensities in the lanterns' units). The field light: Toll's (`t*`:
 * its hold over the bell, its flash at a toll) or Carillon's (`c*`); the minor spark: the slam, Peal,
 * the draught. Flashes decay on the frame's own time (`tau`).
 */
const LIGHT = Object.freeze({
  gold: [1.5, 1.0, 0.42], amber: [1.5, 0.82, 0.3], heal: [0.5, 1.3, 0.45],
  tHold: 1.0, tFlash: 3.2, tTau: 0.14, tLift: 2.2, tFront: 1.1, tDist: 6.5, tFade: 0.3,
  cGather: 1.6, cNote: 3.2, cChord: 5.2, cTau: 0.12, cLift: 2.8, cDist: 7, cChordDist: 11,
  slamI: 3.2, slamT: 0.16, pealI: 2.6, pealT: 0.2, sparkLift: 2.0, sparkDist: 4.5,
  draughtI: 2, draughtTau: 0.25, draughtT: 0.5, draughtLift: 2.0, draughtDist: 3.5,
  /** No light of hers above this (the night's peak: dayK is 1 there). */
  cap: 6,
  /** Seconds a light stays held after its effect went dark (then given back). */
  after: 0.1,
});

/**
 * The bells: the Toll bell's height and its hover (the lip over the ground), its swing (amplitude,
 * angular frequency, damping), its strike's decay; Carillon's bells' height, hover, the drop's height
 * and its swing; the see-through share (spectral bells: a foe behind stays in view); the dissolves.
 */
const BELL = Object.freeze({
  tollH: 1.9, tollHover: 0.35, fallFrom: 4.5, swing: 0.3, swingW: 7.2, swingDamp: 2.4, strikeTau: 0.22,
  carH: 1.45, carHover: 0.25, carFrom: 6, carSwing: 0.22, ghost: 0.06, appear: 0.08, dissolve: 0.3, chordHold: 0.35,
});
/** The sound rings: the Toll ring's segments, their scale, lift, open time, life; the chord's. */
const RING = Object.freeze({
  tollN: 8, tollScale: 0.78, lift: 0.32, waveY: 0.7, tollWaves: 6, tollOpen: 0.32, tollLife: 0.5, echoDelay: 0.12,
  chordN: 16, chordWaves: 10, chordScale: 1, chordOpen: 0.42, chordLife: 0.65, arcR: 84 / 16,
});
/** The hammer's glow texels: colour, decay after a flash (s), cap. */
const GLOW = Object.freeze({ rgb: Object.freeze([1.0, 0.62, 0.2]), tau: 0.12, max: 2.2 });
/** A story scene's settle (s of frames). */
const SETTLE = 0.25;
/** The marks over the foes: at most this many shown, their lift over the head, pop. */
const MARKS = Object.freeze({ max: 24, lift: 0.4, pop: 0.12 });

/** @type {(u: number) => number} */
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
/** @type {(u: number) => number} */
const smooth = (u) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const TAU = Math.PI * 2;

/** A HeroFx record and the id it had when taken. @typedef {{ rec: HeroFxLive|null, id: number }} Ref */
/** @returns {Ref} */
const ref = () => ({ rec: null, id: 0 });

/**
 * What a combat with the bellwarden's kit adds (`sys.bell`, made by `CombatSystem.load`): the 3D
 * bells (one instanced draw + its shadow while any lives, its programs compiled by the warm-up), a
 * read-only listener on the combat's hits, and the director of the player's kit.
 * @implements {LookStage}
 */
export class BellStage {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    // her presets (her FX frames are in the atlas already: `registerBellFrames`, before it was built)
    registerPresets(BELL_PRESETS);
    // her marks are drawn by her look (`bellMark`: one to three gold rings, popping, bursting) — not
    // core's default rings (COMBAT.md §30.4: `marksLook` null)
    sys.marksLook = null;
    /** Toll's bell and Carillon's four (+ room for a planted bell's successor). */
    this.bells = new SpectralBells({ capacity: 8 });
    sys.scene?.add(this.bells.object);
    /** @type {BellwardenFx[]} */
    this.directors = [];
    /** @type {(e: Enemy|'player', damage: number, crit: boolean, source: string) => void} */
    this._onHit = (e, damage, crit, source) => {
      if (!e || e === 'player') return;
      for (let i = 0; i < this.directors.length; i++) this.directors[i].onHit(e, source);
    };
    sys.events?.on('hit', this._onHit);
  }

  /**
   * The director of the player's kit (PlayerCombat's constructor).
   * @param {PlayerCombat} pc
   * @returns {BellwardenFx}
   */
  director(pc) {
    M = /** @type {NonNullable<PlayerCombat['bell']>} */ (pc.bell).M;
    const d = new BellwardenFx(this, pc);
    this.directors.push(d);
    return d;
  }

  /** A director goes. @param {BellwardenFx} d */
  drop(d) {
    const i = this.directors.indexOf(d);
    if (i >= 0) this.directors.splice(i, 1);
  }

  /**
   * The combat's warm-up: a bell of each palette far below the world (their programs — the shadow
   * one too — compile at load). The FX frames share the combat batch's program.
   * @param {{ x: number, y: number, z: number }} _far
   */
  warmup(_far) {
    this.bells.warm();
  }

  endWarmup() {
    this.bells.unwarm();
  }

  /**
   * Once a frame after the members' visuals (`LookStage.update`): the lights (their flashes on the
   * frame's own time), the bells written. Hushed (a talk, the map): lights dark. A story scene on a
   * set-piece level (the ambient step): the effects settle out.
   * @param {number} dt combat seconds of the frame (0: everything holds)
   * @param {boolean} [active]
   * @param {number} [frameDt]
   * @param {boolean} [ambient]
   */
  update(dt, active = true, frameDt = 0, ambient = false) {
    const hushed = !active && !this.sys.game?.photoMode;
    for (let i = 0; i < this.directors.length; i++) {
      const d = this.directors[i];
      if (ambient) d.settle(frameDt);
      else if (hushed) d.hush();
      else if (active) d.lights(frameDt);
    }
    this.bells.update(dt);
  }

  dropLights() {
    for (const d of this.directors) d.dropLights();
  }

  dispose() {
    this.sys.events?.off('hit', this._onHit);
    for (const d of [...this.directors]) d.dispose();
    this.directors.length = 0;
    this.bells.dispose();
  }

  /** Tests (`__game.combat.system.bell.info()`). */
  info() {
    const d = this.directors[0] ?? null;
    const di = d ? d.info() : null;
    return {
      directors: this.directors.length, bells: this.bells.count, triangles: this.bells.triangles,
      frames: Object.keys(FRAMES).filter((n) => Object.hasOwn(this.sys.atlasFrames ?? {}, n)).length,
      lights: di ? { held: di.lights.held, asks: di.lights.acquired + di.lights.refused, refused: di.lights.refused } : { held: 0, asks: 0, refused: 0 },
      look: di,
    };
  }
}

/**
 * A 3D bell of the look: its handle in `SpectralBells`, where it hangs, its swing and its strike.
 * @typedef {object} BellShow
 * @property {number} h the handle (−1: none)
 * @property {number} x @property {number} y @property {number} z the pivot
 * @property {number} ground the ground under it
 * @property {number} t seconds since it was made
 * @property {number} swing @property {number} swingV the swing angle (rad) and its speed
 * @property {number} sx @property {number} sz the swing's direction
 * @property {number} strike the blow's flare (decaying)
 * @property {number} dis the dissolve (0 whole … 1 gone)
 * @property {''|'falling'|'standing'|'fading'} phase
 * @property {number} fallT the fall's length (s)
 * @property {number} from the height it falls from (over its pivot)
 */

/** @returns {BellShow} */
const bellShow = () => ({ h: -1, x: 0, y: 0, z: 0, ground: 0, t: 0, swing: 0, swingV: 0, sx: 1, sz: 0, strike: 0, dis: 1, phase: '', fallT: 0.15, from: 0 });

/**
 * The look of the player's bellwarden kit (see the module comment).
 */
export class BellwardenFx {
  /**
   * @param {BellStage} stage
   * @param {PlayerCombat} pc
   */
  constructor(stage, pc) {
    this.stage = stage;
    this.pc = pc;
    /** @type {CombatSystem} */
    this.sys = pc.sys;
    /** The kit's quads (PlayerCombat's `HeroFx`). */
    this.hfx = /** @type {HeroFx} */ (pc.hfx);
    /** Sheet cells → the hammer head's spot (glow texels; null: none — beside the hand). */
    this._spots = glowSpots(pc.sheet);
    this._anchor = { x: 0, y: 0, z: 0 };
    /** @type {{ color: number[], intensity: number, distance: number, decay: number, flicker: number }} */
    this._lp = { color: LIGHT.gold, intensity: 0, distance: 6, decay: 1, flicker: 0 };
    this.lights_ = { acquired: 0, refused: 0 };
    /** @type {SpellLight|null} the field light and whose it is */
    this.light = null;
    /** @type {''|'toll'|'carillon'} */
    this.lightOwner = '';
    /** @type {SpellLight|null} the minor spark */
    this.spark = null;
    /** @type {''|'slam'|'peal'|'draught'} */
    this._sparkKind = '';
    this._sparkT = 0;
    this._sparkX = 0;
    this._sparkY = 0;
    this._sparkZ = 0;
    this._initState();
    this.rng = new RNG((hashString('bell:player') ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
  }

  _initState() {
    /** Toll's bell shown, its flash for the light, its toll count seen, the light's fade at its end. */
    this._toll = { show: bellShow(), flash: 0, fade: 0, ended: false, crack: ref(), swingSign: 1 };
    /** Carillon: running, its four bells, the flash for the light, the chord (and when). */
    this._car = { on: false, t: 0, bells: [0, 1, 2, 3].map(() => bellShow()), flash: 0, chord: false, chordT: 0, gather: 0, ended: false };
    /** The combo's wind-up beat, the hammer's glow, its colour written. */
    this._combo = { on: false, step: 0, last: -1, swingTag: -1 };
    this.glow = 0;
    this._kick = 0;
    this._glowShown = -1;
    /** The marks shown over the foes. @type {Map<Enemy, { ref: Ref, n: number, pop: number }>} */
    this._marks = new Map();
    /** The scene settle. */
    this._settling = false;
    this._settleT = 0;
    /** Scratch gold tint. */
    this._gc = [0, 0, 0];
    this._gc2 = [0, 0, 0];
  }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  /** Everything gone (a reset, a revive): bells, lights, marks, records, the glow. */
  clear() {
    this._freeBell(this._toll.show);
    for (const b of this._car.bells) this._freeBell(b);
    for (const m of this._marks.values()) this._drop(m.ref);
    this._marks.clear();
    this._releaseLights();
    this._initState();
    this.rng = new RNG((hashString('bell:player') ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
    this._writeGlow(0);
  }

  hush() {
    if (this.light?.held) this.light.off();
    if (this.spark?.held) this.spark.off();
  }

  dropLights() {
    this._releaseLights();
  }

  dispose() {
    this.clear();
    this.stage.drop(this);
  }

  /**
   * A story scene holds the fight on a set-piece level (the ambient step): the lights dark and given
   * back, every effect fading out over `SETTLE` s of frames, the bells dissolving, the marks gone.
   * @param {number} frameDt
   */
  settle(frameDt) {
    if (!this._settling) {
      this._settling = true;
      this._settleT = 0;
      this._releaseLights();
      for (const m of this._marks.values()) this._drop(m.ref);
      this._marks.clear();
    }
    this._settleT += frameDt;
    const k = clamp01(this._settleT / SETTLE);
    this.hfx.settle(frameDt, SETTLE);
    const B = this.stage.bells;
    for (const b of [this._toll.show, ...this._car.bells]) {
      if (b.h < 0) continue;
      if (k < 1) B.set(b.h, { dissolve: Math.max(b.dis, k), dissolveDir: 1 });
      else this._freeBell(b);
    }
    if (k >= 1) this._car.on = false;
    if (this.glow !== 0) {
      this.glow = 0;
      this._writeGlow(0);
    }
  }

  /** @param {boolean} minor @returns {SpellLight|null} */
  _acquire(minor) {
    const w = this.sys.world;
    const l = w && typeof w.acquireSpellLight === 'function' ? w.acquireSpellLight({ minor }) : null;
    if (l) this.lights_.acquired++;
    else this.lights_.refused++;
    return l;
  }

  /** @param {'toll'|'carillon'} owner */
  _takeField(owner) {
    if (!this.light?.held) {
      this.light = null;
      this.light = this._acquire(false);
    }
    this.lightOwner = this.light ? owner : '';
  }

  _releaseField() {
    if (this.light) {
      this.light.off();
      this.light.release();
    }
    this.light = null;
    this.lightOwner = '';
  }

  /** @param {'slam'|'peal'|'draught'} kind @param {number} x @param {number} y @param {number} z */
  _takeSpark(kind, x, y, z) {
    if (!this.spark) this.spark = this._acquire(true);
    if (!this.spark) return;
    this._sparkKind = kind;
    this._sparkT = 0;
    this._sparkX = x;
    this._sparkY = y;
    this._sparkZ = z;
  }

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

  /** @param {SpellLight} L @param {number} x @param {number} y @param {number} z @param {{ color: number[], intensity: number, distance: number, decay: number, flicker: number }} lp */
  _put(L, x, y, z, lp) {
    if (lp.intensity > LIGHT.cap) lp.intensity = LIGHT.cap;
    L.set(x, y, z, lp);
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

  /** @param {Ref} r @returns {HeroFxLive|null} */
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

  /** A gold tint under the sun now. @param {readonly number[]} c @param {number[]} [out] */
  _gold(c, out = this._gc) {
    const k = goldK();
    out[0] = c[0] * k;
    out[1] = c[1] * k;
    out[2] = c[2] * k;
    return out;
  }

  /** @param {BellShow} b */
  _freeBell(b) {
    if (b.h >= 0) this.stage.bells.free(b.h);
    b.h = -1;
    b.phase = '';
  }

  /**
   * The hammer head's world spot in the cell the player's sprite shows (its glow texels; without
   * them: beside the hand, along the facing).
   */
  _headAt() {
    const pc = this.pc;
    const p = pc.player.position;
    const o = this._anchor;
    const cell = this._spots?.[pc._lastRow]?.[pc._lastCol] ?? null;
    if (cell) {
      const yaw = globalUniforms.uCameraYaw.value;
      o.x = p.x + Math.cos(yaw) * cell.right;
      o.y = p.y + cell.up;
      o.z = p.z - Math.sin(yaw) * cell.right;
    } else {
      const f = pc.player.facing;
      o.x = p.x + f.x * 0.5;
      o.y = p.y + 0.9;
      o.z = p.z + f.z * 0.5;
    }
    return o;
  }

  /**
   * A broken sound ring rolling out round (x, z): `n` `bellArc` segments on a circle opening from
   * `r0` to `r1` over `open` s, living `life` s.
   * @param {number} x @param {number} y @param {number} z
   * With `waves`, as many upright sound waves (`bellWave`) roll out over it at knee height, each
   * turned to bulge outward as the camera sees it.
   * @param {{ n: number, r0: number, r1: number, open: number, life: number, scale: number, color: readonly number[], delay?: number, a?: number, tag?: string, waves?: number }} o
   */
  _soundRing(x, y, z, o) {
    const a0 = this.rng.next() * TAU;
    const tint = this._gold(o.color, [0, 0, 0]);
    for (let k = 0; k < o.n; k++) {
      this.hfx.spawn({
        kind: 'orbit', frame: 'bellArc', tag: o.tag ?? 'ring', x, y: y + RING.lift, z, a0: a0 + (k / o.n) * TAU, w: 0,
        r0: o.r0, r1: o.r1, open: o.open, life: o.life, s0: o.scale * 0.85, s1: o.scale, grow: o.open,
        color: tint, a: o.a ?? 1, fadeOut: o.life * 0.45, index: 0,
      });
    }
    const n = o.waves ?? 0;
    if (!n) return;
    const wt = this._gold(TINT.wave, [0, 0, 0]);
    for (let k = 0; k < n; k++) {
      const a = a0 + ((k + 0.5) / n) * TAU;
      this.hfx.spawn({
        kind: 'orbit', frame: 'bellWave', mode: 'billboard', tag: o.tag ?? 'ring', x, y: y + RING.waveY, z, a0: a, w: 0,
        r0: o.r0 + 0.2, r1: o.r1 * 0.92, open: o.open, life: o.life * 0.85, s0: 0.55, s1: 0.95, grow: o.open,
        rot: this._uprightRot(Math.cos(a), Math.sin(a)), color: wt, a: o.a ?? 1, fadeOut: o.life * 0.4, index: 0,
      });
    }
  }

  /**
   * The in-plane turn of an upright (billboard) arc whose bulge should point along the world
   * direction (dx, dz) as the camera sees it: sideways along the camera's right, up for away from
   * the camera, down toward it (the depth part foreshortened).
   * @param {number} dx @param {number} dz
   */
  _uprightRot(dx, dz) {
    const yaw = globalUniforms.uCameraYaw.value;
    const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const away = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
    return Math.atan2(-sx, away * 0.55);
  }

  /**
   * Place a shown bell (its pivot over its ground, its swing and strike written).
   * @param {BellShow} b
   * @param {number} ghost
   */
  _writeBell(b, ghost) {
    if (b.h < 0) return;
    this.stage.bells.set(b.h, { x: b.x, y: b.y, z: b.z, swing: b.swing, swingX: b.sx, swingZ: b.sz, strike: b.strike, dissolve: b.dis, dissolveDir: b.phase === 'fading' ? 1 : -1, ghost, glow: 1 + 0.6 * b.strike });
  }

  /**
   * A bell's swing and strike over `dt` (a damped pendulum; the strike's flare decays).
   * @param {BellShow} b @param {number} dt
   */
  _swingStep(b, dt) {
    if (dt <= 0) return;
    // (semi-implicit: θ'' = −ω² θ − 2ζω θ')
    const w = BELL.swingW;
    b.swingV += (-w * w * b.swing - BELL.swingDamp * b.swingV) * dt;
    b.swing += b.swingV * dt;
    b.strike *= Math.exp(-dt / BELL.strikeTau);
    if (b.strike < 0.005) b.strike = 0;
  }

  /**
   * Strike a shown bell: a swing away from (fx, fz) and its flare.
   * @param {BellShow} b @param {number} dirX @param {number} dirZ @param {number} amp
   */
  _ringBell(b, dirX, dirZ, amp) {
    const l = Math.hypot(dirX, dirZ);
    if (l > 1e-4) {
      b.sx = dirX / l;
      b.sz = dirZ / l;
    }
    b.swingV += amp * BELL.swingW;
    b.strike = 1;
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: the combo (PlayerCombat) and the slam (the kit)
  // ------------------------------------------------------------------------------------------

  /** A hammer step starts (f0): its wind-up's glow. @param {Readonly<ComboStep>} S */
  windup(S) {
    const C = this._combo;
    C.on = true;
    C.step = S.finisher ? 3 : this.pc.combo;
    C.last = 0;
  }

  /**
   * A hammer step's swing (its sound is PlayerCombat's): the heavy bronze crescent where the head
   * travels (the back-hand mirrored), the glow's flash; the slam's crescent runs downward along the
   * facing (its impact is `slam`).
   * @param {Readonly<ComboStep>} S
   */
  swing(S) {
    if (this._settling) return;
    const p = this.pc.player.position;
    const fx = this.pc.player.facing;
    this._combo.on = false;
    this._kick = S.finisher ? 1.8 : 1.1;
    const tint = this._gold(TINT.bronze);
    if (S.finisher) {
      this.hfx.spawn({
        frame: 'hammerArc', x: p.x + fx.x * 0.85, y: p.y + 0.55, z: p.z + fx.z * 0.85, dirX: fx.x, dirZ: fx.z, rot: Math.PI / 2,
        life: 0.16, strip: 0.12, s0: 0.95, s1: 1.05, color: tint, fadeOut: 0.06,
      });
    } else {
      this.hfx.spawn({
        frame: 'hammerArc', x: p.x + fx.x * 0.6, y: p.y + 0.75, z: p.z + fx.z * 0.6, dirX: fx.x, dirZ: fx.z, flip: S.flip,
        life: 0.2, strip: 0.13, s0: 1.0, s1: 1.1, color: tint, fadeOut: 0.07,
      });
    }
  }

  /**
   * The overhead slam lands at (x, y, z): the crater and its cracks, a small sound ring, thrown snow
   * and grit, bronze sparks, the spark of light.
   * @param {number} x @param {number} y @param {number} z
   */
  slam(x, y, z) {
    if (this._settling) return;
    const sys = this.sys;
    const fx = this.pc.player.facing;
    this.hfx.spawn({
      frame: 'hammerCrack', x, y: y + 0.06, z, dirX: fx.x, dirZ: fx.z, life: 1.1, s0: 0.9, s1: 1.05, grow: 0.08,
      color: this._gold(TINT.crack), fadeOut: 0.5, a: 1,
    });
    this.hfx.spawn({
      frame: 'bellRingS', x, y: y + RING.lift, z, life: 0.32, s0: 0.35, s1: M.HAMMER_SLAM.r / 1.39, grow: 0.22,
      color: this._gold(TINT.ring), fadeOut: 0.14, strip: 0, index: 0,
    });
    sys.burst('bellPuff', x, y + 0.05, z, 10);
    sys.burst('bellSpark', x, y + 0.3, z, 8);
    sys.burst('heroDebris', x, y + 0.1, z, 8);
    this._takeSpark('slam', x, y + LIGHT.sparkLift, z);
  }

  /** The Healing Draught taken: a soft green light (a free light only). */
  draught() {
    if (this.spark) return;
    const p = this.pc.player.position;
    this._takeSpark('draught', p.x, p.y + LIGHT.draughtLift, p.z);
  }

  /**
   * A blow of the player landed on `e` (CombatSystem `'hit'`): bronze sparks where the hammer struck
   * and its sound, once a swing.
   * @param {Enemy} e @param {string} source
   */
  onHit(e, source) {
    if (this._settling) return;
    const pc = this.pc;
    if (source !== 'melee' || pc.action !== 'attack' || !pc._swing) return;
    const sys = this.sys;
    const b = e.def.body;
    const y = sys.bodyBase(e) + Math.min(1.1, (b[0] + b[1]) * 0.5);
    const p = pc.player.position;
    const dx = e.position.x - p.x;
    const dz = e.position.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    sys.burst('bellSpark', e.position.x - (dx / l) * e.radius * 0.6, y, e.position.z - (dz / l) * e.radius * 0.6, pc.combo === 3 ? 8 : 5);
    if (this._combo.swingTag !== pc._swing.tag) {
      this._combo.swingTag = pc._swing.tag;
      sys.sfxAt('hammerHit', e.position.x, e.position.z, { volume: pc.combo === 3 ? 1 : 0.85 });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: the marks (the kit) and Peal
  // ------------------------------------------------------------------------------------------

  /**
   * `n` marks on `e` were detonated (Peal, the chord): a ring bursts round it, sparks fly.
   * @param {Enemy} e @param {number} n
   */
  detonate(e, n) {
    if (this._settling) return;
    const sys = this.sys;
    const y = sys.bodyBase(e);
    const m = this._marks.get(e);
    if (m) {
      this._drop(m.ref);
      this._marks.delete(e);
    }
    this.hfx.spawn({
      frame: 'bellRingS', x: e.position.x, y: y + RING.lift + 0.05, z: e.position.z, life: 0.3, s0: 0.3, s1: 0.5 + 0.22 * n,
      grow: 0.18, color: this._gold(TINT.ring), fadeOut: 0.12, index: n >= 3 ? 0 : 1,
    });
    const b = e.def.body;
    sys.burst('bellShimmer', e.position.x, y + Math.min(1.2, (b[0] + b[1]) * 0.5), e.position.z, 2 + 2 * n);
  }

  /**
   * Peal's beats: 'start' (the glow gathers), 'wind' (the hammer drawn back), 'ring' (the cone rolls
   * out from the hammer; `n` marks it detonated).
   * @param {'start'|'wind'|'ring'} beat
   * @param {number} [n]
   */
  peal(beat, n = 0) {
    if (this._settling) return;
    const pc = this.pc;
    const p = pc.player.position;
    const kit = pc.bell;
    if (beat === 'ring') {
      const dx = kit ? kit.peal.dirX : pc.player.facing.x;
      const dz = kit ? kit.peal.dirZ : pc.player.facing.z;
      const sc = M.PEAL.r / 4;
      // (the quad's centre: half its depth ahead of the apex)
      const ahead = 2 * sc + 0.15;
      this.hfx.spawn({
        frame: 'bellPeal', x: p.x + dx * ahead, y: p.y + 0.36, z: p.z + dz * ahead, dirX: dx, dirZ: dz,
        life: 0.3, strip: 0.26, s0: sc, s1: sc, color: this._gold(TINT.peal), fadeOut: 0.08,
      });
      // the sound itself rolling out at chest height: three upright arcs, their bulge along the way
      // the cone points (as the camera sees it: sideways, or up / down for away / toward it)
      const rot = this._uprightRot(dx, dz);
      const tint = this._gold(TINT.wave, [0, 0, 0]);
      for (let k = 0; k < 3; k++) {
        const d0 = 0.8 + 0.8 * k;
        this.hfx.spawn({
          frame: 'bellWave', mode: 'billboard', x: p.x + dx * d0, y: p.y + 0.95, z: p.z + dz * d0, vx: dx * 8, vz: dz * 8, rot,
          life: 0.32 - 0.04 * k, s0: 0.6 + 0.25 * k, s1: 1.0 + 0.3 * k, color: tint, fadeIn: 0.02 * k, fadeOut: 0.12, index: k === 2 ? 1 : 0,
        });
      }
      this._kick = 1.6 + 0.2 * n;
      this.sys.burst('bellShimmer', p.x + dx * 1.2, p.y + 0.9, p.z + dz * 1.2, 4);
      this._takeSpark('peal', p.x + dx * 1.4, p.y + LIGHT.sparkLift, p.z + dz * 1.4);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: Toll
  // ------------------------------------------------------------------------------------------

  /**
   * Toll's beats: 'raise' (the hammer goes up: the glow, the light gathering), 'fall' (the bell takes
   * shape over the point and falls), 'plant' (it lands: its crack, thrown snow), 'ring' (it tolls —
   * `struck` by a blow or Peal: it swings away from her), 'end' (its time is out: it dissolves),
   * 'cancel' (cut short before it landed).
   * @param {'raise'|'fall'|'plant'|'ring'|'end'|'cancel'} beat
   * @param {TollBell} T the kit's bell
   * @param {boolean} [struck]
   */
  toll(beat, T, struck = false) {
    const S = this._toll;
    const b = S.show;
    const B = this.stage.bells;
    const sys = this.sys;
    switch (beat) {
      case 'raise':
        this._takeField('toll');
        S.flash = 0;
        S.ended = false;
        S.fade = 0;
        // (a bell still standing — a new one takes its place — dissolves now)
        if (b.h >= 0 && b.phase !== 'falling') this._freeBell(b);
        break;
      case 'fall':
        if (this._settling) break;
        if (b.h < 0) b.h = B.spawn({ height: BELL.tollH, palette: 0, seed: 7 });
        b.ground = T.y;
        b.x = T.x;
        b.z = T.z;
        b.from = BELL.fallFrom;
        b.fallT = (M.TOLL.plant - 2) / 60;
        b.t = 0;
        b.y = T.y + BELL.tollHover + BELL.tollH + b.from;
        b.swing = 0;
        b.swingV = 0;
        b.strike = 0;
        b.dis = 1;
        b.phase = 'falling';
        this._writeBell(b, BELL.ghost);
        break;
      case 'plant': {
        if (this._settling) break;
        if (b.h < 0) b.h = B.spawn({ height: BELL.tollH, palette: 0, seed: 7 });
        b.x = T.x;
        b.z = T.z;
        b.ground = T.y;
        b.y = T.y + BELL.tollHover + BELL.tollH;
        b.dis = 0;
        b.phase = 'standing';
        const fx = this.pc.player.facing;
        this._drop(S.crack);
        this._keep(S.crack, this.hfx.spawn({
          frame: 'hammerCrack', x: T.x, y: T.y + 0.06, z: T.z, dirX: fx.x, dirZ: fx.z, life: M.TOLL.life + 0.4, s0: 1.1, s1: 1.2, grow: 0.1,
          color: this._gold(TINT.crack), fadeOut: 0.6, live: true,
        }));
        sys.burst('bellPuff', T.x, T.y + 0.05, T.z, 12);
        sys.burst('heroDebris', T.x, T.y + 0.1, T.z, 6);
        break;
      }
      case 'ring': {
        if (this._settling) break;
        const p = this.pc.player.position;
        S.flash = 1;
        if (b.h >= 0 && b.phase === 'standing') {
          // (away from her when struck; its own tolls swing it back and forth)
          const dx = struck ? b.x - p.x : b.sx * -S.swingSign;
          const dz = struck ? b.z - p.z : b.sz * -S.swingSign;
          S.swingSign = struck ? 1 : -S.swingSign;
          this._ringBell(b, dx, dz, struck ? BELL.swing * 1.25 : BELL.swing);
        }
        const r = M.TOLL.r;
        this._soundRing(T.x, T.y, T.z, { n: RING.tollN, r0: 0.7, r1: r, open: RING.tollOpen, life: RING.tollLife, scale: RING.tollScale, color: TINT.ring, waves: RING.tollWaves });
        this._soundRing(T.x, T.y, T.z, { n: RING.tollN, r0: 0.5, r1: r * 0.82, open: RING.tollOpen + RING.echoDelay, life: RING.tollLife * 0.9, scale: RING.tollScale * 0.8, color: TINT.ringEcho, a: 0.7 });
        sys.burst('bellShimmer', T.x, T.y + BELL.tollHover + 0.3, T.z, struck ? 8 : 5);
        break;
      }
      case 'end':
        S.ended = true;
        if (b.h >= 0 && b.phase === 'standing') {
          b.phase = 'fading';
          b.t = 0;
          sys.burst('heroMote', b.x, b.y - BELL.tollH * 0.5, b.z, 4);
        }
        this._drop(S.crack);
        break;
      case 'cancel':
        S.ended = true;
        if (b.h >= 0 && b.phase === 'falling') {
          b.phase = 'fading';
          b.t = 0;
        }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Hooks: Carillon
  // ------------------------------------------------------------------------------------------

  /**
   * Carillon's beats: 'start' (the light gathers), 'fall' (bell `k` takes shape above its point and
   * drops), 'land' (it lands on its note: a small ring, a note rising), 'chord' (all four swing and
   * flare; the great ring rolls out), 'end' (cut short: the bells dissolve).
   * @param {'start'|'fall'|'land'|'chord'|'end'} beat
   * @param {number} k the bell (fall, land) or the marks detonated (chord)
   */
  carillon(beat, k) {
    const C = this._car;
    const B = this.stage.bells;
    const sys = this.sys;
    const kit = this.pc.bell;
    switch (beat) {
      case 'start':
        for (const b of C.bells) this._freeBell(b);
        C.on = true;
        C.t = 0;
        C.flash = 0;
        C.chord = false;
        C.gather = 0;
        C.ended = false;
        this._takeField('carillon');
        break;
      case 'fall': {
        if (this._settling || !kit) break;
        const q = kit.car.pts[k];
        const b = C.bells[k];
        if (b.h < 0) b.h = B.spawn({ height: BELL.carH, palette: 0, seed: 21 + k });
        b.x = q.x;
        b.z = q.z;
        b.ground = q.y;
        b.from = BELL.carFrom;
        b.fallT = M.CARILLON.fall / 60;
        b.t = 0;
        b.y = q.y + BELL.carHover + BELL.carH + b.from;
        b.swing = 0;
        b.swingV = 0;
        b.strike = 0;
        b.dis = 1;
        b.phase = 'falling';
        this._writeBell(b, BELL.ghost);
        break;
      }
      case 'land': {
        if (this._settling || !kit) break;
        const q = kit.car.pts[k];
        const b = C.bells[k];
        const p = this.pc.player.position;
        if (b.h >= 0) {
          b.y = q.y + BELL.carHover + BELL.carH;
          b.dis = 0;
          b.phase = 'standing';
          this._ringBell(b, q.x - p.x, q.z - p.z, BELL.carSwing);
        }
        C.flash = Math.max(C.flash, 1);
        this.hfx.spawn({
          frame: 'bellRingS', x: q.x, y: q.y + RING.lift, z: q.z, life: 0.34, s0: 0.4, s1: M.CARILLON.dropHit / 1.39, grow: 0.2,
          color: this._gold(TINT.ring), fadeOut: 0.14,
        });
        this.hfx.spawn({
          frame: 'bellNote', mode: 'billboard', x: q.x, y: q.y + BELL.carHover + BELL.carH + 0.5, z: q.z, vy: 1.6, life: 0.7, s0: 1, s1: 1.15,
          color: this._gold(TINT.note), fadeIn: 0.05, fadeOut: 0.3,
        });
        sys.burst('bellPuff', q.x, q.y + 0.05, q.z, 6);
        sys.burst('bellShimmer', q.x, q.y + 0.6, q.z, 5);
        this._kick = 0.9;
        break;
      }
      case 'chord': {
        if (this._settling) break;
        const p = this.pc.player.position;
        C.chord = true;
        C.chordT = C.t;
        C.flash = 1.6;
        for (const b of C.bells) if (b.h >= 0 && b.phase === 'standing') this._ringBell(b, b.x - p.x, b.z - p.z, BELL.carSwing * 1.6);
        this._soundRing(p.x, p.y, p.z, { n: RING.chordN, r0: 0.6, r1: M.CARILLON.r, open: RING.chordOpen, life: RING.chordLife, scale: RING.chordScale, color: TINT.ring, waves: RING.chordWaves });
        this._soundRing(p.x, p.y, p.z, { n: RING.chordN, r0: 0.4, r1: M.CARILLON.r * 0.75, open: RING.chordOpen + RING.echoDelay, life: RING.chordLife * 0.9, scale: RING.chordScale * 0.85, color: TINT.ringEcho, a: 0.7 });
        this.hfx.spawn({
          frame: 'hammerCrack', x: p.x, y: p.y + 0.06, z: p.z, dirX: this.pc.player.facing.x, dirZ: this.pc.player.facing.z, life: 1.2, s0: 1.1, s1: 1.25, grow: 0.1,
          color: this._gold(TINT.crack), fadeOut: 0.5,
        });
        sys.burst('bellPuff', p.x, p.y + 0.05, p.z, 14);
        sys.burst('heroDustRing', p.x, p.y + 0.1, p.z, 10);
        this._kick = 2;
        break;
      }
      case 'end':
        C.ended = true;
        for (const b of C.bells) {
          if (b.h < 0) continue;
          b.phase = 'fading';
          b.t = 0;
        }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Per frame
  // ------------------------------------------------------------------------------------------

  /**
   * Once a frame while the combat runs (PlayerCombat._applyVisuals, before HeroFx writes): the bells
   * (falling, swinging, dissolving), the marks over the foes, the hammer's glow.
   * @param {number} dt combat seconds of the frame (0 in a hit-stop: everything holds)
   */
  visuals(dt) {
    if (this._settling) return;
    const pc = this.pc;
    const kit = pc.bell;
    // ---- Toll's bell ----
    const S = this._toll;
    const b = S.show;
    if (kit && kit.toll.alive && b.h < 0 && !this._settling) {
      // (a bell the kit still holds after a scene's settle: it takes shape again)
      b.h = this.stage.bells.spawn({ height: BELL.tollH, palette: 0, seed: 7 });
      b.x = kit.toll.x;
      b.z = kit.toll.z;
      b.ground = kit.toll.y;
      b.y = b.ground + BELL.tollHover + BELL.tollH;
      b.dis = 1;
      b.phase = 'standing';
      b.t = 0;
    }
    this._bellFrame(b, dt, BELL.tollH, BELL.tollHover);
    // ---- Carillon ----
    const C = this._car;
    if (C.on) {
      C.t += dt;
      // the chord rung: they hold a moment, then dissolve
      if (C.chord && C.t - C.chordT > BELL.chordHold) {
        for (const q of C.bells) if (q.phase === 'standing') { q.phase = 'fading'; q.t = 0; }
      }
      let any = false;
      for (const q of C.bells) {
        this._bellFrame(q, dt, BELL.carH, BELL.carHover);
        if (q.h >= 0) any = true;
      }
      if (!any && (C.chord || C.ended) && pc.action !== 'skill3') C.on = false;
    }
    // ---- the marks ----
    this._marksFrame(dt);
    // ---- the hammer's glow ----
    this._glowFrame(dt);
  }

  /**
   * One bell's frame: its fall (accelerating onto its stand; it takes shape as it falls), its swing,
   * its dissolve at the end.
   * @param {BellShow} b @param {number} dt @param {number} H @param {number} hover
   */
  _bellFrame(b, dt, H, hover) {
    if (b.h < 0) return;
    b.t += dt;
    const stand = b.ground + hover + H;
    if (b.phase === 'falling') {
      const u = clamp01(b.t / Math.max(1e-3, b.fallT));
      b.y = stand + b.from * (1 - u * u);
      b.dis = 1 - smooth(b.t / Math.max(BELL.appear, b.fallT * 0.6));
    } else if (b.phase === 'standing') {
      b.y = stand;
      if (b.dis > 0) b.dis = Math.max(0, b.dis - dt / BELL.appear);
    } else if (b.phase === 'fading') {
      b.dis = Math.min(1, b.dis + dt / BELL.dissolve);
      if (b.dis >= 1) {
        this._freeBell(b);
        return;
      }
    }
    this._swingStep(b, dt);
    this._writeBell(b, BELL.ghost);
  }

  /**
   * The marks over the foes: a `bellMark` quad on each marked foe (its count as its frame), popping
   * when a mark comes, gone with the marks.
   * @param {number} dt
   */
  _marksFrame(dt) {
    const kit = this.pc.bell;
    if (!kit) return;
    const sys = this.sys;
    let popped = false;
    for (const [e, m] of this._marks) {
      const n = e.alive ? kit.marksOn(e) : 0;
      const rec = this._get(m.ref);
      if (!n || !rec) {
        this._drop(m.ref);
        this._marks.delete(e);
        continue;
      }
      if (n > m.n) {
        m.pop = MARKS.pop;
        // (a mark rings in: one soft pop a frame, however many come)
        if (!popped) sys.sfxAt('markPop', e.position.x, e.position.z, { volume: 0.35 });
        popped = true;
      }
      m.n = n;
      m.pop = Math.max(0, m.pop - dt);
      rec.index = Math.min(2, n - 1);
      rec.x = e.position.x;
      rec.z = e.position.z;
      rec.y = sys.bodyBase(e) + e.def.body[1] + MARKS.lift;
      const s = 1 + 0.3 * (m.pop / MARKS.pop);
      rec.s0 = rec.s1 = s;
      rec.t = 0;
    }
    if (this._marks.size >= MARKS.max) return;
    for (const e of sys.enemies) {
      if (!e.alive || this._marks.has(e)) continue;
      const n = kit.marksOn(e);
      if (!n) continue;
      const rec = this.hfx.spawn({
        tag: 'mark', frame: 'bellMark', mode: 'billboard', x: e.position.x, y: sys.bodyBase(e) + e.def.body[1] + MARKS.lift, z: e.position.z,
        index: Math.min(2, n - 1), life: 1e9, color: this._gold(TINT.mark, [0, 0, 0]), live: true, s0: 1.3, s1: 1.3,
      });
      if (!rec) break;
      const r = ref();
      this._keep(r, rec);
      this._marks.set(e, { ref: r, n, pop: MARKS.pop });
      if (this._marks.size >= MARKS.max) break;
    }
  }

  /**
   * The lights, once a frame while the combat runs (BellStage.update): their flashes age on the
   * frame's own time.
   * @param {number} frameDt
   */
  lights(frameDt) {
    this._settling = false;
    if (this.light && !this.light.held) {
      this.light = null;
      this.lightOwner = '';
    }
    if (this.light) {
      if (this.lightOwner === 'toll') this._tollLight(frameDt);
      else if (this.lightOwner === 'carillon') this._carLight(frameDt);
      else this._releaseField();
    }
    this._sparkLight(frameDt);
  }

  /** @param {number} frameDt */
  _tollLight(frameDt) {
    const S = this._toll;
    const L = /** @type {SpellLight} */ (this.light);
    const lp = this._lp;
    const kit = this.pc.bell;
    S.flash *= Math.exp(-frameDt / LIGHT.tTau);
    const gk = goldK();
    lp.color = LIGHT.gold;
    lp.flicker = 0;
    lp.decay = 1;
    lp.distance = LIGHT.tDist;
    const T = kit?.toll;
    if (T?.falling) {
      // (the hammer goes up: the light gathers over the point the bell will fall on)
      S.fade = 0;
      lp.intensity = LIGHT.tHold * smooth(this.pc.frame / M.TOLL.plant) * dayK(DAY.warm) * gk;
      this._put(L, T.x, T.y + LIGHT.tLift, T.z, lp);
      return;
    }
    if (!T?.alive) {
      // (its end, or cut short: the hold fades out, then the light is given back)
      S.fade += frameDt;
      const k = 1 - clamp01(S.fade / LIGHT.tFade);
      if (k <= 0 || !T) {
        if (S.fade > LIGHT.tFade + LIGHT.after || !T) this._releaseField();
        else L.off();
        return;
      }
      lp.intensity = LIGHT.tHold * k * dayK(DAY.warm) * gk;
      this._put(L, T.x, T.y + LIGHT.tLift, T.z, lp);
      return;
    }
    S.fade = 0;
    // the hold before the bell (toward the camera: its face lit, the snow round its foot warm), its
    // flash at a toll (the part above the hold × dayK(0.25))
    lp.intensity = (LIGHT.tHold * dayK(DAY.warm) + (LIGHT.tFlash - LIGHT.tHold) * S.flash * dayK(DAY.flash)) * gk;
    this._put(L, T.x - this._viewX() * LIGHT.tFront, T.y + LIGHT.tLift, T.z - this._viewZ() * LIGHT.tFront, lp);
  }

  /** The camera's forward on XZ (CombatFx's view axis). */
  _viewX() { return this.sys.fx ? this.sys.fx.viewX : 0; }
  _viewZ() { return this.sys.fx ? this.sys.fx.viewZ : -1; }

  /** @param {number} frameDt */
  _carLight(frameDt) {
    const C = this._car;
    const L = /** @type {SpellLight} */ (this.light);
    const lp = this._lp;
    const p = this.pc.player.position;
    C.flash *= Math.exp(-frameDt / LIGHT.cTau);
    const gk = goldK();
    lp.color = LIGHT.gold;
    lp.flicker = 0;
    lp.decay = 1;
    if (!C.on) {
      this._releaseField();
      return;
    }
    C.gather = Math.min(1, C.gather + frameDt / 0.2);
    const fading = C.chord && C.t - C.chordT > BELL.chordHold;
    const hold = LIGHT.cGather * C.gather * (fading ? Math.max(0, 1 - (C.t - C.chordT - BELL.chordHold) / BELL.dissolve) : 1);
    const peak = C.chord ? LIGHT.cChord : LIGHT.cNote;
    lp.intensity = (hold * dayK(DAY.warm) + Math.max(0, peak - LIGHT.cGather) * Math.min(1, C.flash) * dayK(DAY.flash)) * gk;
    lp.distance = C.chord ? LIGHT.cChordDist : LIGHT.cDist;
    this._put(L, p.x, p.y + LIGHT.cLift, p.z, lp);
  }

  /** The minor spark's quick fall (the slam, Peal, the draught). @param {number} frameDt */
  _sparkLight(frameDt) {
    const L = this.spark;
    if (!L) return;
    this._sparkT += frameDt;
    const kind = this._sparkKind;
    const T = kind === 'slam' ? LIGHT.slamT : kind === 'peal' ? LIGHT.pealT : LIGHT.draughtT;
    if (this._sparkT >= T || !L.held) {
      this._releaseSpark();
      return;
    }
    const lp = this._lp;
    lp.decay = 1;
    lp.flicker = 0;
    if (kind === 'draught') {
      lp.color = LIGHT.heal;
      lp.intensity = LIGHT.draughtI * Math.exp(-this._sparkT / LIGHT.draughtTau) * dayK(DAY.warm);
      lp.distance = LIGHT.draughtDist;
    } else {
      const k = 1 - this._sparkT / T;
      lp.color = LIGHT.amber;
      lp.intensity = (kind === 'slam' ? LIGHT.slamI : LIGHT.pealI) * k * k * dayK(DAY.flash) * goldK();
      lp.distance = LIGHT.sparkDist;
    }
    this._put(L, this._sparkX, this._sparkY, this._sparkZ, lp);
  }

  /**
   * The hammer's glow texels: charging through each wind-up, a flash at the blow, decaying.
   * @param {number} dt
   */
  _glowFrame(dt) {
    const pc = this.pc;
    const f = pc.frame;
    let target = 0;
    switch (pc.action) {
      case 'attack': {
        const S = pc.comboSteps[pc.combo - 1];
        if (S && f < S.fxAt) target = (S.finisher ? 1.0 : 0.55) * smooth(f / S.fxAt);
        break;
      }
      case 'skill1': if (f < M.PEAL.at) target = 1.1 * smooth(f / M.PEAL.at); break;
      case 'skill2': if (f < M.TOLL.plant) target = 1.2 * smooth(f / M.TOLL.plant); break;
      case 'skill3': if (f < M.CARILLON.chord) target = 0.8 + 0.4 * smooth(f / M.CARILLON.chord); break;
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
    this._writeGlow(Math.min(GLOW.max, this.glow) * dayK(DAY.glow));
  }

  /** @param {number} a */
  _writeGlow(a) {
    const v = Math.round(a * 100) / 100;
    if (v === this._glowShown) return;
    this._glowShown = v;
    const c = GLOW.rgb;
    this.pc.sprite?.setGlow?.(c[0], c[1], c[2], v);
  }

  /** Tests: the look's state (`sys.bell.info().look`). */
  info() {
    const t = this._toll.show;
    return {
      effects: this.hfx.count, rings: this.hfx.countTag('ring'), marks: this._marks.size,
      toll: { phase: t.phase, swing: +t.swing.toFixed(3), strike: +t.strike.toFixed(3), dissolve: +t.dis.toFixed(3) },
      carillon: { on: this._car.on, bells: this._car.bells.filter((b) => b.h >= 0).length, chord: this._car.chord },
      settling: this._settling, glow: +this.glow.toFixed(2),
      lights: { ...this.lights_, held: (this.light?.held ? 1 : 0) + (this.spark?.held ? 1 : 0), owner: this.lightOwner, spark: this._sparkKind },
    };
  }
}

// ---------------------------------------------------------------------------------------------
// The FX frames (generation 3: The Bells of Evermere's batch)
// ---------------------------------------------------------------------------------------------

/**
 * Her FX frames (FxSprites.js's module shape: `FRAMES` + `paint`), registered into the combat atlas
 * only where she fights (`registerBellFrames`) — their painters live in this chunk, not in the combat
 * chunk every combat level downloads, and no other atlas holds their cells. Gold on snow is cut-out,
 * never a white glare: every frame spans the grey levels from the rim (R / S: the dark amber core
 * once tinted gold) to the light (L / W: the gold edge), so one quad in one gold tint shows both — a
 * dark core that reads on white ground and a gold edge that reads on dark — and a dark outline round
 * it. Closed-form shapes and a fixed integer hash (no RNG); ≈ 36 k texels.
 *
 * | Frame | Size × n | Mode | Use |
 * | --- | --- | --- | --- |
 * | `bellArc` | 48×12 × 2 | flat | a segment of a sound ring (its centre of curvature toward −V, 84 px below its top: laid round a circle with +V outward it follows it); 0 the full band — a lit outer edge over a dark core —, 1 thinned and broken (the ring fading) |
 * | `bellRingS` | 48×48 × 2 | flat | a small sound ring (r ≈ 1.45 u at scale 1), broken by eight notches; 0 full, 1 thin |
 * | `bellPeal` | 80×64 × 4 | flat | Peal's cone of sound (apex at the bottom middle = the hammer, ± 35°, r 4 u at scale 1): three arcs travelling outward with dashed cone edges; frame 3 dispersing |
 * | `hammerArc` | 64×32 × 3 | flat | the hammer's heavy swing: a thick blunt crescent, its leading edge lit, a squared head at the lead |
 * | `hammerCrack` | 48×48 × 1 | flat | the slam's impact: a crater ring and six jagged cracks |
 * | `bellMark` | 32×12 × 3 | billboard | resonance marks over a foe: frame k shows k + 1 small rings |
 * | `bellNote` | 12×16 × 1 | billboard | a small bell glyph (Carillon's notes rising) |
 * | `bellWave` | 32×14 × 2 | billboard | an upright sound wave: an arc bulging toward +V (turned to point the way the sound travels); 1 thin |
 * @type {Readonly<Record<string, Readonly<FxFrameSpec>>>}
 */
export const FRAMES = Object.freeze({
  bellArc: Object.freeze({ w: 48, h: 12, n: 2, fps: 0, late: 3 }),
  bellRingS: Object.freeze({ w: 48, h: 48, n: 2, fps: 0, late: 3 }),
  bellPeal: Object.freeze({ w: 80, h: 64, n: 4, fps: 24, late: 3 }),
  hammerArc: Object.freeze({ w: 64, h: 32, n: 3, fps: 30, late: 3 }),
  hammerCrack: Object.freeze({ w: 48, h: 48, n: 1, fps: 0, late: 3 }),
  bellMark: Object.freeze({ w: 32, h: 12, n: 3, fps: 0, late: 3 }),
  bellNote: Object.freeze({ w: 12, h: 16, n: 1, fps: 0, late: 3 }),
  bellWave: Object.freeze({ w: 32, h: 14, n: 2, fps: 0, late: 3 }),
});

/**
 * A ring band's grey level by its depth into the band (0 its outer edge … 1 its inner edge): the
 * outer edge lit (white toward the upper left — `lit` — light elsewhere), a mid row, a dark core,
 * the inner edge a step lighter (a cast ring seen from above: a raised rim round a dark bed).
 * @param {number} u @param {boolean} lit @param {FxKit} K
 */
function ringLevel(u, lit, K) {
  return u < 0.25 ? (lit ? K.W : K.L) : u < 0.5 ? K.MID : u < 0.8 ? K.S : K.D;
}

/** The sound-ring segment's circle: its centre 84 px below the frame's top, its outer radius. */
const BELL_ARC = Object.freeze({ cx: 24, cy: 84, rOut: 82.5 });

/**
 * A segment of a sound ring (flat): the band along the arc, its ends tapered; 1 thinned and broken
 * into three dashes (the ring fading out).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellArc(pen, i, K) {
  const A = BELL_ARC;
  const T = i === 0 ? 4.2 : 2.2;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - A.cx;
      const dy = A.cy - (y + 0.5);
      const r = Math.hypot(dx, dy);
      const s = Math.atan2(dx, dy) * A.rOut;
      const as = Math.abs(s);
      if (as > 23.5) continue;
      // (the ends taper to a point over their last 6 px)
      const t = as > 17.5 ? T * Math.max(0.3, (23.5 - as) / 6) : T;
      if (r > A.rOut || r < A.rOut - t) continue;
      if (i === 1 && Math.floor((s + 24) / 8) % 3 === 1) continue;
      pen.set(x, y, ringLevel((A.rOut - r) / t, s < -4, K));
    }
  }
  // (a dark outline: the gold reads on snow and on grass alike)
  pen.rim(K.R);
}

/**
 * A small sound ring (flat, r 23 px): the band broken by eight notches; 1 thinner.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellRingS(pen, i, K) {
  const ro = 22.2;
  const T = i === 0 ? 3.4 : 1.9;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - 24;
      const dy = 24 - (y + 0.5);
      const r = Math.hypot(dx, dy);
      if (r > ro || r < ro - T) continue;
      const a = Math.atan2(dy, dx);
      // (notches between the eight strike points)
      const q = ((a / (Math.PI / 4)) % 1 + 1) % 1;
      if (Math.abs(q - 0.5) < 0.07) continue;
      // lit toward the upper left
      const lit = dx * -0.7 + dy * 0.7 > 4;
      pen.set(x, y, ringLevel((ro - r) / T, lit, K));
    }
  }
  pen.rim(K.R);
}

/**
 * Peal's cone of sound (flat; the apex — the hammer — at the bottom middle, +V forward): three arcs
 * travelling outward, thinning toward the cone's edges, the edges dashed; 3 breaking up. A strike
 * burst at the apex on frame 0.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellPeal(pen, i, K) {
  const ax = 40, ay = 63.5;
  const half = (35 * Math.PI) / 180;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 80; x++) {
      const dx = x + 0.5 - ax;
      const dy = ay - (y + 0.5);
      if (dy <= 0) continue;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dx, dy);
      const aa = Math.abs(a);
      if (aa > half + 0.02 || r > 62) continue;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const R = 14 + 16 * k + 5 * i;
        if (R > 62) continue;
        // (thinner toward the cone's edges)
        const T = aa > half * 0.78 ? 2.2 : 3.4;
        if (r > R || r < R - T) continue;
        if (i === 3 && Math.floor((a * R + 40) / 5) % 2 === 1) continue;
        v = Math.max(v, ringLevel((R - r) / T, aa < half * 0.45, K));
      }
      // the cone's edges, dashed
      if (!v && Math.abs(aa - half) * r < 0.75 && r > 8 && r < 58 && Math.floor(r / 3) % 2 === 0 && i < 3) v = K.S;
      if (v) pen.set(x, y, v);
    }
  }
  if (i === 0) for (const [x, y, v] of [[40, 61, K.W], [39, 62, K.L], [41, 62, K.L], [37, 60, K.MID], [43, 60, K.MID], [40, 58, K.L]]) pen.set(x, y, v);
  pen.rim(K.R);
}

/**
 * The hammer's swing (flat): a thick blunt crescent sweeping right → left (bulging toward +V), its
 * leading edge lit, a squared head at the lead, a dark rim round it all (it reads on snow).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function hammerArc(pen, i, K) {
  const P = [{ a0: 0.2, a1: 1.45, thick: 0.36 }, { a0: 0.12, a1: 2.55, thick: 0.44 }, { a0: 0.6, a1: 3.0, thick: 0.28 }][i];
  K.arc(pen, { cx: 32, cy: 30.5, rx: 29, ry: 27, lead: 'left', ...P });
  // the head at the lead: a squared block, lit on its upper left
  const hx = 32 + Math.cos(P.a1) * 29 * 0.84;
  const hy = 30.5 - Math.sin(P.a1) * 27 * 0.84;
  if (i < 2) {
    for (let y = -3; y <= 2; y++) for (let x = -3; x <= 2; x++) pen.set(hx + x, hy + y, x < -1 || y < -1 ? K.L : x > 0 || y > 0 ? K.S : K.MID);
    pen.set(hx - 3, hy - 3, K.W);
  }
  pen.rim(K.R);
}

/**
 * The slam's impact (flat): a crater ring round the point struck and six jagged cracks running out,
 * chips thrown beside them; dark, their upper edges catching the light.
 * @param {FxPen} pen @param {FxKit} K
 */
function hammerCrack(pen, K) {
  const c = 24;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - c;
      const dy = c - (y + 0.5);
      const r = Math.hypot(dx, dy);
      if (r > 5.2 && r < 8.2) pen.set(x, y, r > 7.2 ? (dy > 1 ? K.L : K.MID) : K.S);
      else if (r <= 5.2 && r > 3.6) pen.set(x, y, K.R);
    }
  }
  for (let k = 0; k < 6; k++) {
    let a = (k / 6) * Math.PI * 2 + (hash(k, 7) - 0.5) * 0.5;
    let x = c + Math.cos(a) * 7.5;
    let y = c - Math.sin(a) * 7.5;
    const len = 9 + Math.round(hash(k, 3) * 7);
    for (let s = 0; s < len; s++) {
      a += (hash(k, s + 11) - 0.5) * 0.7;
      x += Math.cos(a) * 1.0;
      y -= Math.sin(a) * 1.0;
      pen.set(x, y, s < len - 3 ? K.R : K.S);
      // its lit lip (the upper side) and its width near the crater
      pen.max(x, y - 1, s < 4 ? K.MID : K.D);
      if (s < 4) pen.set(x + Math.sin(a), y + Math.cos(a), K.S);
    }
    // a chip beside the crack's end
    pen.set(x + 2 * Math.cos(a + 1.2), y - 2 * Math.sin(a + 1.2), K.L);
  }
}

/**
 * Resonance marks (billboard): `i` + 1 small rings side by side (the middle one a row higher: a
 * chord), lit on their upper left, each outlined on its own.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellMark(pen, i, K) {
  const n = i + 1;
  for (let j = 0; j < n; j++) {
    const cx = 16 + (j - (n - 1) / 2) * 9;
    const cy = n === 3 && j === 1 ? 5 : 6.5;
    const ring = [];
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x + 0.5 - cx;
        const dy = cy - (y + 0.5);
        const r = Math.hypot(dx, dy);
        if (r > 3.1 || r < 1.6) continue;
        ring.push([x, y, dy > 0.5 && dx < 0.5 ? K.W : dy > -0.5 ? K.L : K.MID]);
      }
    }
    for (const [x, y, v] of ring) pen.set(x, y, v);
    // its own outline (the rings stay apart)
    const has = new Set(ring.map(([x, y]) => x + y * 64));
    for (const [x, y] of ring) {
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + ox, Y = y + oy;
        if (!has.has(X + Y * 64) && !pen.get(X, Y)) pen.set(X, Y, K.R);
      }
    }
  }
}

/**
 * An upright sound wave (billboard): an arc of radius 19 px bulging toward +V, its outer edge lit,
 * its ends tapered, outlined; 1 thinner (fading).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellWave(pen, i, K) {
  const cx = 16, cy = 22, ro = 18.5;
  const T = i === 0 ? 3.4 : 2;
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - cx;
      const dy = cy - (y + 0.5);
      if (dy <= 0) continue;
      const r = Math.hypot(dx, dy);
      const a = Math.abs(Math.atan2(dx, dy));
      if (a > 0.92) continue;
      const t = a > 0.6 ? T * Math.max(0.35, (0.92 - a) / 0.32) : T;
      if (r > ro || r < ro - t) continue;
      pen.set(x, y, ringLevel((ro - r) / t, dx < 2, K));
    }
  }
  pen.rim(K.R);
}

/**
 * A small bell (billboard): the loop, the shoulder, the flared lip, the clapper beneath; lit from
 * the left, outlined.
 * @param {FxPen} pen @param {FxKit} K
 */
function bellNote(pen, K) {
  const c = 6;
  pen.set(c - 1, 1, K.MID); pen.set(c, 1, K.L); pen.set(c - 1, 2, K.D); pen.set(c, 2, K.D);
  for (let y = 3; y <= 12; y++) {
    const hw = y < 5 ? 2 : y < 10 ? 2.4 + (y - 5) * 0.32 : y < 12 ? 4.4 : 5;
    for (let x = 0; x < 12; x++) {
      const dx = x + 0.5 - c;
      if (Math.abs(dx) > hw) continue;
      const u = (dx + hw) / (2 * hw);
      pen.set(x, y, y === 12 ? (u < 0.5 ? K.W : K.L) : u < 0.3 ? K.L : u < 0.7 ? K.MID : K.D);
    }
  }
  pen.set(c - 1, 14, K.L); pen.set(c, 14, K.MID);
  pen.rim(K.R);
}

/** A small integer hash → [0, 1) (closed form: the same pixels on every run; heroFx.js's). */
function hash(a, b = 0) {
  let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
}

/** The painters, by frame (`paint`). @type {Readonly<Record<string, (pen: FxPen, i: number, K: FxKit) => void>>} */
const PAINTERS = Object.freeze({
  bellArc, bellRingS, bellPeal, hammerArc, bellMark, bellWave,
  hammerCrack: (pen, i, K) => hammerCrack(pen, K),
  bellNote: (pen, i, K) => bellNote(pen, K),
});

/**
 * Paint frame `i` of `name` (FxSprites.js's `FxModule.paint`: the atlas's pen and kit).
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} kit
 */
export function paint(name, pen, i, kit) {
  PAINTERS[name](pen, i, kit);
}

let registered = false;

/**
 * Put her FX frames into the combat atlas (`CombatSystem.load`, where the player's kit is the
 * bellwarden's, before it builds the atlas: generation 3, packed after every shipped frame, as a
 * lazy enemy pack's — COMBAT.md §30, FxSprites.js `registerFxModule`). Once a page: they stay
 * registered, and every later atlas of the page holds them.
 * @param {{ registerFxModule: (mod: FxModule) => void }} api the combat's pack API (`COMBAT_PACK_API`)
 */
export function registerBellFrames(api) {
  if (registered) return;
  registered = true;
  api.registerFxModule({ FRAMES, paint });
}
