import { RNG, hashString, globalUniforms } from '../../engine/index.js';
import { RockSpikes } from '../../engine/fx/RockSpikes.js';
import { WardDome } from '../../engine/fx/WardDome.js';
import { F } from '../combat/rules.js';
import { glowSpots } from '../combat/glowSpots.js';
import { SpellFx, FLAT_LIFT, GLYPH_A, RING_A } from './MemberCombat.js';

/**
 * @import { LookStage } from '../combat/types.js'
 * @import { CombatSystem } from '../combat/CombatSystem.js'
 * @import { Enemy } from '../combat/Enemy.js'
 * @import { MemberCombat, Field, FxRec } from './MemberCombat.js'
 * @import { AllyMeleeHit, VqSkill, VqMeleeKit } from './rules.js'
 * @import { SpellLight } from '../../engine/lighting/VfxLights.js'
 */

/**
 * EarthSpellFx — the look of the greatshield's moves (Brannoc of Vanquish the Evil Dragon: the
 * companion class `greatshield`, party/rules.js `KIT.greatshield`; docs/contracts/DRAGON_CAMPAIGN.md
 * §6.8, COMBAT.md §28). Visuals only: `MemberCombat` keeps the moves — their timing, hits, taunt,
 * ward, super armour, hit-stop, shake, sounds — exactly as they are and calls these hooks; nothing
 * here touches a hit, a cooldown or the member's RNG (its own: `earth:<id>` and the combat seed),
 * so the fights play the same. It reads the member's move, frame, facing, hit count and fields,
 * the foes' places, taunts and radii, and nothing more.
 *
 * A module of its own, imported (`import()`) by `CombatSystem.load` only on a level where a
 * greatshield can fight (`classMayFight('greatshield', …)`, mayFight.js): there the combat makes
 * one `EarthStage` (`sys.earth`: the 3D rock spikes, the ward dome, the FX batch's halo, warmed at
 * load, disposed with the combat) and every greatshield member gets a `GreatshieldFx`
 * (`stage.director(member)`). Anywhere else nothing of it exists.
 *
 * "Stone, steel and ward" (docs/design/COMBAT_VFX.md, the palette registry): matte stone and dust
 * (lit, never glowing), a brief warm metal clang off the shield, the azure ward, amber cues under
 * the bloom. Fire, embers, lingering glowing cracks and red-orange ground rings are the foes'
 * language: none here (the slam's crack flashes gold for a moment and is dark by ≈ 0.45 s).
 *  - **Earthshatter, staged.** Anticipation: grit lifts off the ground where the mace will fall
 *    (f8, f14, f20), a low warm charge light gathers over the spot from f14. Impact (the slam; its
 *    5-frame hit-stop holds it): the light flashes, the crack bursts open gold and cools to dark
 *    earth, a matte shock ring, a low dust ring racing out (no veil over the pack). Eruption: 3D
 *    stone spikes (`RockSpikes`: sun-lit, shadow-casting) at the ring hit's own angles and radii
 *    burst up in a sweep from his side round to the far side, small ones beside them on the far
 *    half only; the median spike's overshoot peaks on the ring hit. Hold: they stand, the light
 *    settles low. Release: dark fractures run up them, then they sink back into the ground,
 *    spitting chips and dust. A spike never stands inside a character's clearance or tall between
 *    the camera and one (eased, no pop); the camera's side of the ring stands lower.
 *  - **Bulwark, staged.** Wind-up: a faint ward glyph seeds under him. The cry: a clang of gold at
 *    his shield, an amber roar ring, a dust ring, war-cry sparks, a warm flash that slides over to
 *    the dome and turns ward-azure; a one-shot amber snap ring at each foe the cry drew (no lasting
 *    marker). The ward rises: a 3D hex-lattice dome (`WardDome`, cut-out, open in the middle) grows
 *    from its base ring over the party, its glyph spreading under it; two bands sweep up it, a glint
 *    on each warded hero; then it dissolves top-down into motes. The ward's rings under the heroes
 *    pulse azure for its 6 s and breathe out softly over its last 1.2 s (a member's ring goes with
 *    it when it leaves the fight).
 *  - **The combo and the block.** The bash: a ring-of-rays clang at the shield and warm sparks
 *    (not a spear's streak), a spark of light when it lands; the mace: a steel smear under the
 *    bloom, sparks and light when it bites; a blocked blow rings gold off the shield (rate-limited).
 *  - **Light.** One combat VFX light per greatshield for his skills (re-targeted from one to the
 *    next, never released and asked again between them) and at most one short spark light (`minor`,
 *    only from a free light) per swing or block; warm lights × dayK(0.4), the ward × dayK(0.55),
 *    a flash's part above its hold × dayK(0.25); every flash ages on the frame's own time (through
 *    the slam's hit-stop); dark while the combat does not run, given back on every exit.
 *  - **The scene settle.** A story scene on a set-piece level (the ambient step) fades his look
 *    out over 0.25 s of frames — the quads from the opacity they had, the spikes sinking, the dome
 *    dissolving —, then ends every one-shot; his lights are given back at once. The ward rings only
 *    fade (the ward still holds: the combat's clock stands) and come back after the scene. A talk or
 *    the map only holds the look (lights dark).
 *  - Day and night: his magic quads (the ward, its glints, amber cues) × (1 − 0.6 uNight), the
 *    matter ones (the crack, the shock ring) × (1 − 0.72 uNight), the metal clangs (≤ 0.14 s)
 *    × (1 − 0.35 uNight) — the exposure rises after dark.
 *  - The crest's glow (the glow texels of his shield's gold crest, `gear.crestGlow`;
 *    `sprite.setGlow`): charging through a skill's wind-up, a flash at its moment, the ward's hold
 *    and pulse, a kick at every bash and block; off on a sheet without those texels. The cry's clang
 *    sits on the crest, and is left out when the cell he shows has none (the shield turned away).
 */

/**
 * His tints (linear HDR × the atlas's grey levels; ACES of a white texel in the comments). The
 * halo weighs a quad by its brightest channel (0.9 → 1.8): only the small bright quads ask for it
 * (`halo: 1` — the clangs and glints); the ground frames, the crack and the rings stay at 0.
 */
const TINT = Object.freeze({
  /** The crack once it cools: dark broken earth (96, 74, 60). */
  crackBody: Object.freeze([0.12, 0.08, 0.06]),
  /** The crack at the slam (heat 1, ≤ 0.15 s at full): gold (237, 209, 146). */
  crackFlash: Object.freeze([1.25, 0.62, 0.16]),
  /** The metal clang and glints off the shield (237, 209, 146). */
  clang: Object.freeze([1.25, 0.62, 0.16]),
  /** The mace's smear, under the bloom (220, 202, 163). */
  steel: Object.freeze([0.8, 0.55, 0.25]),
  /** The slam's shock ring: dust, not light (202, 191, 176). */
  shock: Object.freeze([0.55, 0.4, 0.26]),
  /** The roar ring and the taunt's snap, under the bloom (219, 188, 111): never red-orange. */
  amber: Object.freeze([0.75, 0.42, 0.1]),
  /** The ward's seed glyph in the wind-up. */
  seed: Object.freeze([0.08, 0.2, 0.6]),
  /** The ward's glyph on the ground. */
  wardGlyph: Object.freeze([0.1, 0.28, 0.8]),
  /** The ward's rings under the heroes (114, 165, 224). */
  wardRing: Object.freeze([0.1, 0.3, 0.95]),
  /** A warded hero's glint. */
  wardGlint: Object.freeze([0.2, 0.5, 1.45]),
});
/**
 * How much his quads dim at full night: the magic (the ward, amber cues), the matter (crack, ring),
 * the crack's flash, the metal glints (the clangs: 0.12 s at most — at the magic quads' 0.6 a gold
 * clang turned a dull brown ring after dark).
 */
const NIGHT = Object.freeze({ magic: 0.6, matter: 0.72, flash: 0.5, glint: 0.35 });
/**
 * By day his lights are this much of their night strength (lerped by `uNight`): the warm ones, the
 * ward's, and the flashes' part above a hold (`flash`: a flash lands on foes the core's hit flash
 * already whitens — the campaign's rule for every hero's hit-frame light, COMBAT_VFX.md §7).
 */
const DAY = Object.freeze({ warm: 0.4, cool: 0.55, flash: 0.25 });
/** @type {(min: number) => number} a day factor now (`min` at noon, 1 at night) */
const dayK = (min) => min + (1 - min) * globalUniforms.uNight.value;

/**
 * The lights (the combat VFX lights, World.acquireSpellLight; linear HDR colours, intensities in the
 * lanterns' units). Earthshatter: a low `charge` over the spot the mace will hit (`chargeFrom` →
 * the slam), the `slam` flash `slamLift` u over the field (τ `slamTau`) into the `hold`, a `kick` at
 * the ring hit (τ `kickTau`), its falloff easing from decay 1 to 2, faded out from `fadeFrom` over
 * `fadeT` s and given back at `quakeEnd`. Bulwark: the `cry` flash over him (τ `cryTau`), sliding
 * over `blend` s to the dome's centre (`wardLift` up) as the `ward` glow, eased out from `wardOut`
 * over `wardOutT` s and given back at `wardEnd`. Sparks (`minor`): the bash, the mace, a block.
 *
 * Every flash and pulse (the slam's, the ring hit's kick, the cry's, the sparks) ages on the
 * frame's own time — it decays through the slam's hit-stop instead of being held at its peak over
 * foes the core flashes white —, and its part above the hold takes `DAY.flash`: I = hold × day +
 * (flash − hold) × f × dayK(0.25). Peaks at full night stay at ≈ 6 (the slam 6, the kick 3 on a
 * flash mostly spent, the cry 6). The slam's flash was 12 in the design: the warm light is ≈ 2.2 ×
 * as bright to the eye as the ice's blue at one intensity (luminance 0.99 against 0.45), and at 12
 * the held pack's slam frame measured +0.52 pp of white (≥ 235) at night with the foes' flash on.
 */
const LIGHT = Object.freeze({
  // (plain arrays: VfxLights reads a colour array as linear; never written)
  slamColor: [1.5, 0.9, 0.4], cryColor: [1.4, 0.8, 0.3], wardColor: [0.3, 0.55, 1.4], sparkColor: [1.4, 0.9, 0.45],
  charge: 3, chargeLift: 1.2, chargeDistance: 4, chargeFrom: 14, chargeFrames: 8,
  slam: 6, slamTau: 0.1, slamLift: 2.6, slamDistance: 9, hold: 2.5, kick: 3, kickTau: 0.08, fadeFrom: 0.6, fadeT: 0.4, quakeEnd: 1.0,
  cry: 6, cryTau: 0.07, cryLift: 2.2, cryDistance: 7, ward: 2.5, wardLift: 2.4, wardDistance: 7.5, wardDecay: 1.5,
  blend: 0.15, wardOut: 0.8, wardOutT: 0.3, wardEnd: 1.1,
  bash: 4, mace: 3.5, block: 3, sparkLift: 0.9, sparkDistance: 3, blockDistance: 2.5, sparkT: 0.12, blockT: 0.1,
  /** At most one block glint per this many combat seconds, one block light per `blockLightEvery`. */
  blockGlintEvery: 0.15, blockLightEvery: 0.3,
});

/**
 * Earthshatter's staging on the field's clock (s; 0 the slam, frozen through its hit-stop; the
 * ring hit at `KIT.greatshield.skill2.spikes.delay`). The crack: `crackSize` × the slam's radius,
 * growing over `crackGrow` s, `heatTau` its flash's decay. The spikes: the outer ring's start
 * `start` + `sweep` × the sweep order (0 his side … 1 the far side), rising over `rise` s (peak
 * `overshoot` at `peakAt` of it); heights `height[0]` + `height[1]` × u, radii, outward lean ×
 * height, slab aspect; a small companion at ±`compA` rad, r × `compR`, height × `compH`, `compStart`
 * s later, on the far half only. Readability: the camera's side × (1 − `nearLow` × its share), a foot
 * within `clearGone` u of a character's edge none, within `clearStub` u a stub (× `stubH`, radius ×
 * `stubR`), a spike `screenDepth` u in front of a character and `screenSide` u beside it on screen ×
 * `screenLow`; eased with τ `ease`. A spike whose foot is inside a clearance as it is about to rise
 * moves along its own radial line in `moveStep` u steps (at most `moveSteps` each way, between
 * `moveIn` and `moveOut` u from the centre: inside the ring hit's band) to the nearest free spot —
 * with big foes (Sunhallow's ashhounds) most of the ring stood inside them and the eruption did not
 * read. Release: fractures over `crackFrom` → `crackTo`; the payoff: they sink from `sinkAt` over
 * `sinkT` s; the record ends at `end`. The crack is drawn solid (`crackAlpha` 1): at the dither
 * caps' 0.75 its dark lines broke into stitches.
 */
const QUAKE = Object.freeze({
  crackSize: 1.9, crackGrow: 0.1, crackAlpha: 1, crackLife: 1.6, crackFade: 0.7, heatTau: 0.12,
  ring: Object.freeze([1.6, 8.0]), ringGrow: 0.25, ringLife: 0.4, ringFade: 0.2,
  start: 0.07, sweep: 0.05, rise: 0.09, peakAt: 0.5, overshoot: 1.12,
  height: Object.freeze([1.15, 0.4]), radius: Object.freeze([0.36, 0.46]), lean: Object.freeze([0.12, 0.22]), aspect: Object.freeze([0.62, 1]),
  compA: 0.16, compR: 0.92, compH: 0.45, compStart: 0.02, sink: 0.02,
  moveStep: 0.15, moveSteps: 10, moveIn: 1.2, moveOut: 3.6,
  nearLow: 0.5, clearGone: 0.1, clearStub: 0.5, stubH: 0.45, stubR: 0.7, screenDepth: 2.6, screenSide: 0.75, screenLow: 0.5, ease: 0.05,
  crackFrom: 0.42, crackTo: 0.62, sinkAt: 0.62, sinkT: 0.12, end: 1.65,
});
/** The gameplay ring's radius offsets by spike (`MemberCombat._stepQuake`'s, read the same way). */
const RING_OFFSET = Object.freeze([0.45, -0.2, 0.15]);
/** A story scene's settle: his look fades out over this many seconds of frames, the ward rings come back over as many. */
const SETTLE = 0.25;

/**
 * Bulwark's staging on its own clock (s from the cry): the dome rises over `rise` s, two bands sweep
 * up it from `sweeps` over `sweepT` s each, it holds to `hold` and dissolves over `dissolve` s; its
 * radius ½ the distance to the player + `rPad`, clamped to [`rMin`, `rMax`] (over him when they are
 * more than `apart` u apart). The seed glyph's size and alpha in the wind-up; the roar ring; the
 * ground glyph; the glints from `glintAt` (staggered); the ward rings' pulse and their expiry pulse
 * over the last `expiry` s, the last `ringFade` s fading; the taunt's snap ring (`tauntLife` s,
 * shrinking from × 1.3 over `tauntGrow` s), cued `tauntAt` s after the cry.
 */
const WARD = Object.freeze({
  rise: 0.3, sweeps: Object.freeze([0.3, 0.45]), sweepT: 0.35, hold: 0.8, dissolve: 0.3,
  rPad: 1.4, rMin: 2.6, rMax: 3.4, apart: 6,
  seedSize: Object.freeze([1.0, 1.6]), seedAlpha: 0.35,
  roar: Object.freeze([1.6, 12.6]), roarGrow: 0.4, roarLife: 0.5, roarFade: 0.25,
  glyphLife: 1.1, glyphFade: 0.35,
  glintAt: 0.3, glintStagger: 0.06, glintLife: 0.18,
  ringScale: 1.05, ringScaleMember: 0.95, ringAlpha: 0.45, ringPulseHz: 0.8, ringPulse: 0.15,
  expiry: 1.2, expiryHz: 2.5, expiryLow: 0.15, ringFade: 0.4,
  tauntLife: 0.9, tauntGrow: 0.25, tauntPad: 0.4, tauntAt: 0.03,
});

/**
 * The crest's glow (the gold crest's glow texels, `gear.crestGlow`): colour, strengths, decay. A
 * kick decays from its first frame (× 0.87), so the peaks shown are ≈ 1.2 for a bash or a block
 * (the crest clear), ≈ 2.0 at the war cry (a bright flare, never a blob: the crest is ≈ 10 texels
 * from the front, 2 edge-on), ≈ 1.4 at the slam; 3.5 streaks.
 */
const GLOW = Object.freeze({
  rgb: Object.freeze([1.0, 0.72, 0.3]),
  bash: 1.4, block: 1.4, bulwarkCharge: 1.1, bulwarkFlash: 2.2, bulwarkHold: 0.5, wardPulse: Object.freeze([0.25, 0.4]),
  quakeCharge: 0.8, quakeFlash: 1.6, max: 2.5, tau: 0.12,
});

/** The war cry's dust ring runs slower than the slam's (a per-particle override: no new pool). */
const CRY_DUST = Object.freeze({ burstSpeed: [3, 5] });
/** The motes off a ward ring that ends (a small box round it, not the dome's). */
const RING_MOTES = Object.freeze({ spawnSize: [0.6, 0.3, 0.6] });

/** @type {(u: number) => number} smoothstep 0..1 */
const smooth = (u) => {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};
/** @type {(u: number) => number} */
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
/** @type {(a: number) => number} an angle into (−π, π] */
const wrapPi = (a) => {
  const t = Math.PI * 2;
  a = ((a % t) + t) % t;
  return a > Math.PI ? a - t : a;
};

/**
 * A spike's rise at u of its `QUAKE.rise` (0 … 1): a cubic ease-out to the overshoot by `peakAt`,
 * settling to 1.
 * @param {number} u
 * @returns {number}
 */
function riseAt(u) {
  if (u <= 0) return 0;
  const p = QUAKE.peakAt;
  if (u < p) {
    const k = 1 - u / p;
    return QUAKE.overshoot * (1 - k * k * k);
  }
  if (u < 1) return QUAKE.overshoot - (QUAKE.overshoot - 1) * smooth((u - p) / (1 - p));
  return 1;
}

/**
 * One stone spike of an Earthshatter: its foot, size, lean, turn, slab, the second it starts to
 * rise, its RockSpikes handle (−1: not risen yet / gone; −2: none free), its sweep order, small or
 * not, the camera-side factor, its readability factors now (height, radius).
 * @typedef {{ x: number, y: number, z: number, height: number, radius: number, yaw: number, tiltX: number, tiltZ: number,
 *   seed: number, aspect: number, start: number, h: number, order: number, small: boolean, near: number, k: number, kr: number,
 *   r: number }} Spike (r: its rise drawn last — a scene's settle sinks it from there)
 */
/**
 * An Earthshatter as it looks (its clock the field's): the field, its spot and ground, its turn,
 * its age, the crack (and its live tint), the shock ring, the spikes, the light's serial, the
 * light's flash and the ring hit's kick (1 at their moment, decaying on the frame's own time — through
 * the slam's hit-stop), the payoff burst done.
 * @typedef {{ on: boolean, fl: Field|null, x: number, y: number, z: number, a: number, t: number, crack: FxRec|null,
 *   crackRgb: number[], ring: FxRec|null, spikes: Spike[], born: number, flash: number, kick: number, sunk: boolean }} Quake
 */
/** @returns {Quake} */
function newQuake() {
  return { on: false, fl: null, x: 0, y: 0, z: 0, a: 0, t: 0, crack: null, crackRgb: [0, 0, 0], ring: null, spikes: [], born: 0, flash: 0, kick: 0, sunk: false };
}
/**
 * A Bulwark as it looks (its own clock from the cry): his spot, the dome's centre and radius, its
 * glyph, the light's serial and its cry flash (1 at the cry, decaying on the frame's own time), the
 * heroes it warded (positions), what is done (taunt cues, glints, the dissolve's motes).
 * @typedef {{ on: boolean, t: number, x: number, y: number, z: number, cx: number, cy: number, cz: number, R: number,
 *   born: number, flash: number, heroes: { x: number, y: number, z: number }[], cued: boolean, glints: number, motes: boolean }} Bulwark
 */
/**
 * A ward ring under a hero: its quad, the member it marks (null: the player — a member that leaves
 * the fight takes its ring with it), base scale, age, life.
 * @typedef {{ rec: FxRec, owner: MemberCombat|null, base: number, t: number, life: number }} WardRing
 */
/** A taunt's snap ring at a foe's feet, its age. @typedef {{ rec: FxRec, e: Enemy, t: number }} TauntCue */
/** A spark light (`minor`). @typedef {{ light: SpellLight, x: number, y: number, z: number, t: number, dur: number, peak: number, dist: number }} Spark */

/**
 * What a combat on a level where a greatshield can fight adds (`sys.earth`, made by
 * `CombatSystem.load`): the 3D stone spikes and the ward dome (one draw call each — the spikes'
 * shadow too —, their programs compiled by the warm-up), the FX batch's halo, and a
 * `GreatshieldFx` per greatshield member. Disposed with the combat (a travel included): spikes,
 * dome and every VFX light held go.
 * @implements {LookStage}
 */
export class EarthStage {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    /** Earthshatter's 3D stone spikes (one instanced draw + its shadow). */
    this.spikes = new RockSpikes({ capacity: 24 });
    /** Bulwark's 3D ward dome (one draw while up). */
    this.dome = new WardDome();
    sys.scene?.add(this.spikes.object);
    sys.scene?.add(this.dome.object);
    sys.quads?.enableHalo();
    /** @type {GreatshieldFx[]} the greatshields' directors */
    this.directors = [];
    /** The director whose Bulwark shows the dome now (null: hidden). @type {GreatshieldFx|null} */
    this.domeOwner = null;
    /** The warm-up's halo quad (−1: none). */
    this._warmQuad = -1;
  }

  /**
   * The director of a greatshield member (MemberCombat's constructor).
   * @param {MemberCombat} mc
   * @returns {GreatshieldFx}
   */
  director(mc) {
    const d = new GreatshieldFx(this, mc);
    this.directors.push(d);
    return d;
  }

  /** A director goes (its member's fight released). @param {GreatshieldFx} d */
  drop(d) {
    const i = this.directors.indexOf(d);
    if (i >= 0) this.directors.splice(i, 1);
    if (this.domeOwner === d) {
      this.domeOwner = null;
      this.dome.hide();
    }
  }

  /**
   * The combat's warm-up (`CombatSystem.warmup`, before the scene is compiled): one spike, the dome
   * and one halo quad far below the world, so their programs (and the spikes' shadow program)
   * compile at load.
   * @param {{ x: number, y: number, z: number }} far
   */
  warmup(far) {
    this.spikes.warm();
    this.dome.warm();
    const q = this.sys.quads;
    if (!q) return;
    this._warmQuad = q.alloc();
    if (this._warmQuad >= 0) q.set(this._warmQuad, { x: far.x, y: far.y, z: far.z, frame: 'partySunburst', index: 1, scale: 1, mode: 'billboard', r: 2, g: 2, b: 2, a: 1, halo: 1 });
    q.update();
  }

  /** After the warm frames (`CombatSystem.endWarmup`). */
  endWarmup() {
    this.spikes.unwarm();
    this.dome.unwarm();
    if (this._warmQuad >= 0) this.sys.quads.free(this._warmQuad);
    this._warmQuad = -1;
  }

  /**
   * Once a frame after the members' visuals (`CombatSystem.afterPlayer`; `LookStage.update`): the
   * lights (their flashes on the frame's own time), the spikes written. In a story scene on a
   * set-piece level (the ambient step) his look settles out (`GreatshieldFx.settle`); while the
   * combat otherwise does not run (a talk, the map — not the photo mode) his lights are dark and the
   * rest holds; both come back with the fight.
   * @param {number} dt combat seconds of the frame (0: everything holds)
   * @param {boolean} [active] the combat ran this frame
   * @param {number} [frameDt] the frame's own seconds
   * @param {boolean} [ambient] a story run holds the player on a set-piece level
   */
  update(dt, active = true, frameDt = 0, ambient = false) {
    // (a photo freezes the fight as it is: only a scene, a talk, the map hush it)
    const hushed = !active && !this.sys.game?.photoMode;
    for (let i = 0; i < this.directors.length; i++) {
      const d = this.directors[i];
      if (ambient) d.settle(frameDt);
      else if (hushed) d.hush();
      else if (active) d.light(frameDt);
    }
    this.spikes.update(dt);
  }

  /** Every spell light given back (the death reset, `CombatSystem.resetEncounter`): his moves still up go on unlit. */
  dropLights() {
    for (const d of this.directors) d.dropLights();
  }

  /** The combat goes: every director, the spikes, the dome. */
  dispose() {
    for (const d of [...this.directors]) d.dispose();
    this.directors.length = 0;
    this.domeOwner = null;
    this.spikes.dispose();
    this.dome.dispose();
  }

  /** Tests (`__game.combat.system.earth.info()`). */
  info() {
    return { directors: this.directors.length, spikes: this.spikes.count, dome: this.dome.shown, halo: !!this.sys.quads?.halo };
  }
}

/**
 * The look of one greatshield's moves (see the module comment): hooks MemberCombat calls at the
 * moves' moments, its own effects stepped on the combat clock (`step`) and written once a frame
 * (`visuals`); the anticipations and the landed blows derived from the member's state there.
 */
export class GreatshieldFx {
  /**
   * @param {EarthStage} stage
   * @param {MemberCombat} mc
   */
  constructor(stage, mc) {
    this.stage = stage;
    this.mc = mc;
    /** @type {CombatSystem} */
    this.sys = mc.sys;
    /** His magic quads (glints, the ward, amber cues: dim × (1 − 0.6 uNight); the small bright ones ask for the halo). */
    this.fx = new SpellFx(this.sys, { halo: 0 });
    /** His matter quads (the crack, the shock ring: dim × (1 − 0.72 uNight)). */
    this.mfx = new SpellFx(this.sys, { halo: 0 });
    /** His metal glints (the clangs off the shield: brief, dim × (1 − 0.35 uNight); they ask for the halo). */
    this.gfx = new SpellFx(this.sys, { halo: 0 });
    /** @type {Quake[]} his Earthshatters as they look */
    this._quakes = [newQuake(), newQuake()];
    /** @type {Bulwark} his Bulwark as it looks (one at a time) */
    this._bul = { on: false, t: 0, x: 0, y: 0, z: 0, cx: 0, cy: 0, cz: 0, R: 3, born: 0, flash: 0, heroes: [], cued: false, glints: 0, motes: false };
    /** @type {WardRing[]} */
    this._rings = [];
    /** @type {TauntCue[]} */
    this._cues = [];
    /** The crest's glow texels by sheet cell (null: none — the crest glow and the cry's clang stay off). */
    this._crest = glowSpots(mc.member.sprite?.sheet);
    this._crestP = { x: 0, y: 0, z: 0 };
    /** Scratch records handed to the spikes and the lights (no allocation per frame). */
    this._spikeP = { rise: 0, crack: 0, height: 1, radius: 0.3 };
    /** @type {{ color: number[], intensity: number, distance: number, decay: number }} */
    this._lightP = { color: [1, 1, 1], intensity: 0, distance: 8, decay: 1 };
    this._lightC = [1, 1, 1];
    this._kf = { k: 1, kr: 1 };
    this._domeP = { rise: 0, dissolve: 0, sweepA: -9, sweepB: -9 };
    /** A scene's settle: each of his quads' opacity when it began. @type {Map<FxRec, number>} */
    this._snap = new Map();
    this.clear();
  }

  /** His effects live (tests, `heroInfo().quads`). */
  get count() { return this.fx.count + this.mfx.count + this.gfx.count; }

  // ------------------------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------------------------

  /** Everything gone (`_clearHero`: a reset, the release): spikes, dome, quads, lights, the glow. */
  clear() {
    for (const Q of this._quakes) if (Q.on) this._endQuake(Q);
    this._endBulwark();
    this._rings.length = 0;
    this._cues.length = 0;
    this.fx.clear();
    this.mfx.clear();
    this.gfx.clear();
    if (this._field) {
      this._field.off();
      this._field.release();
    }
    /** @type {SpellLight|null} his skills' one VFX light (re-targeted between them) */
    this._field = null;
    if (this._spark) {
      this._spark.light.off();
      this._spark.light.release();
    }
    /** @type {Spark|null} his one spark light */
    this._spark = null;
    /** Serial of his light-driving beats (the newest drives the light); drivers up to `_askedUpTo` never ask again. */
    this._serial = 0;
    this._askedUpTo = 0;
    /** His own combat clock (s; the block's rate limits). */
    this._clock = 0;
    this._glintAt = -Infinity;
    this._blockLightAt = -Infinity;
    /** The move seen last frame, its action clock (a restart), the anticipation beats done, the charge light's serial, the slam made. */
    this._move = /** @type {string|null} */ (null);
    this._moveT = 0;
    this._beats = 0;
    this._chargeBorn = 0;
    this._slammed = false;
    /** @type {FxRec|null} the ward's seed glyph in the wind-up */
    this._seed = null;
    /** The hits counted last frame, the swing a spark was made for. */
    this._hits = this.mc.counts.hits;
    this._sparkSwing = -1;
    /** The crest's glow now, the flash asked for, the value written last (−1: none). */
    this.glow = 0;
    this._kick = 0;
    this._glowShown = -1;
    /** VFX lights acquired so far and refused (none free) — tests. */
    this.lights = { acquired: 0, refused: 0 };
    /**
     * A story scene's settle (`settle`): running, its seconds, done (everything one-shot ended); the
     * ward rings' share (it comes back over `SETTLE` s of frames after the scene) and how long they
     * have been coming back; the move that was running then resumes without its anticipations.
     */
    this._settling = false;
    this._settleT = 0;
    this._settled = false;
    this._back = 1;
    this._backT = 0;
    this._skipMove = false;
    this._snap.clear();
    this.rng = new RNG((hashString(`earth:${this.mc.id}`) ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
    this._writeGlow(0);
  }

  /** The combat does not run this frame (a talk, the map; EarthStage.update): his lights dark until it does, the rest holds. */
  hush() {
    this._field?.off();
    this._spark?.light.off();
  }

  /**
   * A story scene holds the fight on a set-piece level (the ambient step; EarthStage.update): his
   * lights given back at once (the moves up stay unlit), every quad fading out over `SETTLE` s of
   * frames (from the opacity it had), the spikes sinking, the dome dissolving early; then every
   * one-shot effect ends — the slams, the war cry, the snap rings, the seed glyph. The ward rings
   * only fade: the ward still holds after the scene (its time is the combat's), so they come back
   * then (`light`). Nothing new starts while it lasts.
   * @param {number} frameDt the frame's own seconds
   */
  settle(frameDt) {
    if (!this._settling) {
      this._settling = true;
      this._settleT = 0;
      this._settled = false;
      this._skipMove = true;
      this._releaseLights();
      this._snap.clear();
      this._snapOf(this.fx);
      this._snapOf(this.mfx);
      this._snapOf(this.gfx);
    }
    if (this._settled) return;
    this._settleT += frameDt;
    const k = clamp01(this._settleT / SETTLE);
    this._back = 1 - k;
    this._fadeTo(this.fx, 1 - k);
    this._fadeTo(this.mfx, 1 - k);
    this._fadeTo(this.gfx, 1 - k);
    const st = this.stage;
    const cp = this._spikeP;
    for (const Q of this._quakes) {
      if (!Q.on) continue;
      for (const sp of Q.spikes) {
        if (sp.h < 0) continue;
        cp.rise = sp.r * (1 - k);
        cp.crack = 0;
        cp.height = sp.height * Math.max(0.05, sp.k);
        cp.radius = sp.radius * sp.kr;
        st.spikes.set(sp.h, cp);
      }
    }
    if (this._bul.on && st.domeOwner === this) st.dome.set({ dissolve: Math.max(this._domeP.dissolve, k) });
    if (this.glow !== 0) {
      this.glow = 0;
      this._writeGlow(0);
    }
    if (k >= 1) this._endOneShots();
    this._write();
  }

  /** The settle's end: every one-shot effect over (the slams, the war cry, the snap rings, the seed glyph); the ward rings stay. */
  _endOneShots() {
    for (const Q of this._quakes) if (Q.on) this._endQuake(Q);
    this._endBulwark();
    for (const c of this._cues) this.fx.kill(c.rec);
    this._cues.length = 0;
    if (this._seed) this.fx.kill(this._seed);
    this._seed = null;
    this._killAllBut(this.fx);
    this.mfx.clear();
    this.gfx.clear();
    this._back = 0;
    this._settled = true;
  }

  /** Each live quad's opacity now, kept for the settle. @param {SpellFx} b */
  _snapOf(b) {
    for (let i = 0; i < b.live.length; i++) this._snap.set(b.live[i], b.live[i].alpha);
  }

  /** Every quad of a batch at `k` × its opacity when the settle began. @param {SpellFx} b @param {number} k */
  _fadeTo(b, k) {
    for (let i = 0; i < b.live.length; i++) {
      const r = b.live[i];
      r.alpha = (this._snap.get(r) ?? 0) * k;
    }
  }

  /** Every quad of his magic batch ended but the ward rings. @param {SpellFx} b */
  _killAllBut(b) {
    for (let i = b.live.length - 1; i >= 0; i--) {
      const r = b.live[i];
      let ring = false;
      for (const w of this._rings) if (w.rec === r) ring = true;
      if (!ring) b.kill(r);
    }
  }

  /** His lights given back now (a scene's settle); the moves up stay unlit. */
  _releaseLights() {
    if (this._field) {
      this._field.off();
      this._field.release();
    }
    this._field = null;
    if (this._spark) {
      this._spark.light.off();
      this._spark.light.release();
    }
    this._spark = null;
    this._askedUpTo = this._serial;
  }

  /**
   * The fight runs this frame (EarthStage.update): the flashes age on the frame's own time (through
   * a hit-stop: they never hold at their peak over foes the core flashes white), his lights set; after
   * a scene's settle, the ward rings come back.
   * @param {number} frameDt the frame's own seconds
   */
  light(frameDt) {
    if (this._settling) {
      // (a scene shorter than the settle: it ends at once — nothing half-faded comes back)
      if (!this._settled) this._endOneShots();
      this._settling = false;
      this._settled = false;
      this._backT = 0;
    }
    if (this._back < 1) {
      this._backT += frameDt;
      this._back = clamp01(this._backT / SETTLE);
    }
    const kf = Math.exp(-frameDt / LIGHT.slamTau);
    const kk = Math.exp(-frameDt / LIGHT.kickTau);
    for (const Q of this._quakes) {
      Q.flash *= kf;
      Q.kick *= kk;
    }
    this._bul.flash *= Math.exp(-frameDt / LIGHT.cryTau);
    this._fieldLight();
    this._sparkLook(frameDt);
  }

  /** His three batches written (dimmed after dark: the magic, the matter, the glints). */
  _write() {
    const cfx = this.sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    const n = globalUniforms.uNight.value;
    this.fx.write(vx, vz, 1 - NIGHT.magic * n);
    this.mfx.write(vx, vz, 1 - NIGHT.matter * n);
    this.gfx.write(vx, vz, 1 - NIGHT.glint * n);
  }

  /** Every light of his given back at once, his moves going on unlit (the death reset, a rest). */
  dropLights() {
    if (this._field) this._field.release();
    this._field = null;
    if (this._spark) this._spark.light.release();
    this._spark = null;
    // (the moves up now stay unlit: only a later one asks again)
    this._askedUpTo = this._serial;
  }

  /** His member's fight released (`MemberCombat.release`): everything gone, out of the stage. */
  dispose() {
    this.clear();
    this.stage.drop(this);
  }

  /**
   * Take a combat VFX light (World.acquireSpellLight), or null (none free).
   * @param {{ minor?: boolean }} [opts]
   * @returns {SpellLight|null}
   */
  _acquireLight(opts) {
    const w = this.sys.world;
    const l = w && typeof w.acquireSpellLight === 'function' ? w.acquireSpellLight(opts) : null;
    if (l) this.lights.acquired++;
    else this.lights.refused++;
    return l;
  }

  // ------------------------------------------------------------------------------------------
  // The moves' hooks (MemberCombat)
  // ------------------------------------------------------------------------------------------

  /**
   * A blow of the combo lands its look (`_frameMelee` at its effect frame; the sound is
   * MemberCombat's): the bash's clang — a ring of rays at the shield —, its sparks and the dust of
   * the step; the mace's steel smear and its grit.
   * @param {number} k 0: the bash, 1: the mace
   * @param {AllyMeleeHit} H the blow
   */
  melee(k, H) {
    void H;
    const sys = this.sys;
    const p = this.mc.member.position;
    const fc = this.mc.member.facing;
    if (k === 0) {
      const x = p.x + fc.x * 0.75;
      const z = p.z + fc.z * 0.75;
      this.gfx.add({ frame: 'partySunburst', mode: 'billboard', x, y: p.y + 0.95, z, frames: [2], scale: 0.45, scaleTo: 0.75, grow: 0.1, color: TINT.clang, life: 0.12, fadeOut: 0.04, back: -0.2, halo: 1 });
      sys.burst('earthShieldSpark', x, p.y + 0.95, z, 6);
      sys.burst('footstep', p.x + fc.x * 0.4, p.y + 0.05, p.z + fc.z * 0.4, 4);
      this._kick = Math.max(this._kick, GLOW.bash);
    } else {
      this.fx.add({ frame: 'slashBig', mode: 'flat', x: p.x + fc.x * 0.85, y: p.y + 0.8, z: p.z + fc.z * 0.85, dirX: fc.x, dirZ: fc.z, scale: 0.85, fps: 30, color: TINT.steel, life: 4 / 30, fadeOut: 0.05, alpha: 0.9 });
      sys.burst('partyDust', p.x + fc.x * 0.9, p.y + 0.15, p.z + fc.z * 0.9, 3);
    }
  }

  /**
   * A blow rings off his shield (`_heroArmor`: his super armour held; the sound is MemberCombat's):
   * warm sparks, a gold glint (at most one per `blockGlintEvery` s), a spark of light (one per
   * `blockLightEvery` s, a free light only). The red hurt flash stays the core's.
   * @param {number} dirX the blow's direction
   * @param {number} dirZ
   */
  block(dirX, dirZ) {
    const sys = this.sys;
    const p = this.mc.member.position;
    const x = p.x - dirX * 0.35;
    const z = p.z - dirZ * 0.35;
    sys.burst('earthShieldSpark', x, p.y + 0.95, z, 5);
    const now = this._clock;
    if (now - this._glintAt >= LIGHT.blockGlintEvery) {
      this._glintAt = now;
      this.gfx.add({ frame: 'partySunburst', mode: 'billboard', x, y: p.y + 0.95, z, frames: [1], scale: 0.45, color: TINT.clang, life: 0.1, fadeOut: 0.04, back: -0.2, halo: 1 });
      this._kick = Math.max(this._kick, GLOW.block);
    }
    if (now - this._blockLightAt >= LIGHT.blockLightEvery && !this._spark) {
      this._blockLightAt = now;
      this._sparkAt(x, p.y + LIGHT.sparkLift, z, LIGHT.block, LIGHT.blockT, LIGHT.blockDistance);
    }
  }

  /**
   * A skill's wind-up beat (`_skillWindup`, every 6th frame before it takes effect): the dust of
   * his planted step (the rest of the anticipation is derived in `visuals`).
   * @param {VqSkill} S
   * @param {number} f its frame
   */
  windup(S, f) {
    void S;
    const p = this.mc.member.position;
    if (f === 6) this.sys.burst('footstep', p.x, p.y + 0.05, p.z, 4);
  }

  /**
   * Bulwark's war cry (`_bulwark`, after the taunt and the ward; the sounds and the shake are
   * MemberCombat's): the clang at his shield, the amber roar ring, the dust, the sparks, the dome
   * over the middle of the party (its glyph under it), the light, the ward's rings under the heroes.
   * @param {VqSkill} S
   * @param {number} cx the dome's centre (between him and the player)
   * @param {number} cz
   */
  bulwark(S, cx, cz) {
    const sys = this.sys;
    const mc = this.mc;
    const p = mc.member.position;
    const P = sys.player.position;
    const y = sys.groundAt(p.x, p.z);
    const apart = Math.hypot(p.x - P.x, p.z - P.z);
    let x0 = cx;
    let z0 = cz;
    if (apart > WARD.apart) {
      x0 = p.x;
      z0 = p.z;
    }
    const R = Math.max(WARD.rMin, Math.min(WARD.rMax, apart / 2 + WARD.rPad));
    const y0 = sys.groundAt(x0, z0);
    this._endBulwark();
    if (this._seed) this.fx.kill(this._seed);
    this._seed = null;
    // the cry: a clang at the crest (none when the cell he shows has no crest texels: the shield
    // turned away), the roar, dust, sparks
    const c = this._crestAt();
    if (c) this.gfx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, frames: [1], scale: 0.5, color: TINT.clang, life: 0.14, fadeOut: 0.06, back: -0.25, halo: 1 });
    this.fx.add({ frame: 'partyRing', mode: 'flat', x: p.x, y: y + FLAT_LIFT + 0.03, z: p.z, frames: [0], size: WARD.roar[0], sizeTo: WARD.roar[1], grow: WARD.roarGrow, color: TINT.amber, life: WARD.roarLife, fadeOut: WARD.roarFade, alpha: RING_A, soft: 0.3 });
    sys.burst('earthDustRing', p.x, y + 0.1, p.z, 10, CRY_DUST);
    sys.burst('earthCrySpark', p.x, y + 1.2, p.z, 8);
    // the ward rises: the dome, its glyph spreading under it
    this.fx.add({ frame: 'partyGlyphWard', mode: 'flat', x: x0, y: y0 + FLAT_LIFT, z: z0, size: 2, sizeTo: R * 2, grow: WARD.rise, spin: 0.7, color: TINT.wardGlyph, life: WARD.glyphLife, fadeIn: 0.05, fadeOut: WARD.glyphFade, alpha: GLYPH_A });
    const st = this.stage;
    const gl = sys.engine?.renderer?.getContext?.();
    const bw = gl ? gl.drawingBufferWidth : 1280;
    st.dome.artPx = bw >= 2560 ? 4 : bw >= 1920 ? 3 : 2;
    st.dome.show({ x: x0, y: y0, z: z0, radius: R });
    st.domeOwner = this;
    const B = this._bul;
    B.on = true;
    B.t = 0;
    B.x = p.x;
    B.y = y;
    B.z = p.z;
    B.cx = x0;
    B.cy = y0;
    B.cz = z0;
    B.R = R;
    B.born = ++this._serial;
    B.flash = 1;
    B.cued = false;
    B.glints = 0;
    B.motes = false;
    B.heroes.length = 0;
    // the ward's rings under the heroes (the strongest ward counts: a new one replaces the old rings)
    for (const r of this._rings) this.fx.kill(r.rec);
    this._rings.length = 0;
    this._wardRing(P, null, WARD.ringScale, S.wardFor);
    B.heroes.push(P);
    for (const a of sys.allies) {
      if (!a.present) continue;
      this._wardRing(a.position, a, WARD.ringScaleMember, S.wardFor);
      B.heroes.push(a.position);
    }
    this._kick = Math.max(this._kick, GLOW.bulwarkFlash);
  }

  /**
   * Earthshatter's slam (`_quakeSlam`, after its hit; the sound and the shake are MemberCombat's):
   * the crack (a gold flash cooling to dark earth), the matte shock ring, the low dust ring, the
   * rubble; the spikes planned (they rise on the field's clock, the median one peaking on the ring
   * hit).
   * @param {Field} fl
   * @param {VqSkill} S
   */
  slam(fl, S) {
    const sys = this.sys;
    let Q = this._quakes.find((q) => !q.on);
    if (!Q) {
      Q = this._quakes[0];
      for (const q of this._quakes) if (q.t > Q.t) Q = q;
      this._endQuake(Q);
    }
    Q.on = true;
    Q.fl = fl;
    Q.x = fl.x;
    Q.y = fl.y;
    Q.z = fl.z;
    Q.a = fl.a;
    Q.t = 0;
    Q.flash = 1;
    Q.kick = 0;
    Q.sunk = false;
    Q.born = ++this._serial;
    this._slammed = true;
    const y = fl.y + FLAT_LIFT;
    this._crackTint(Q);
    Q.crack = this.mfx.add({ frame: 'partyCrack', mode: 'flat', x: fl.x, y, z: fl.z, size: 2.4, sizeTo: S.r * QUAKE.crackSize, grow: QUAKE.crackGrow, rot: fl.a, color: Q.crackRgb, life: Infinity, alpha: QUAKE.crackAlpha });
    Q.ring = this.mfx.add({ frame: 'partyRing', mode: 'flat', x: fl.x, y: y + 0.03, z: fl.z, frames: [0], size: QUAKE.ring[0], sizeTo: QUAKE.ring[1], grow: QUAKE.ringGrow, color: TINT.shock, life: Infinity, alpha: RING_A, soft: 0.3 });
    sys.burst('earthDustRing', fl.x, fl.y + 0.15, fl.z, 12);
    sys.burst('partyRubble', fl.x, fl.y + 0.2, fl.z, 10);
    this._planSpikes(Q, /** @type {VqMeleeKit} */ (this.mc.kit).skill2.spikes);
    this._kick = Math.max(this._kick, GLOW.quakeFlash);
  }

  /**
   * Earthshatter's ring of stone spikes hits (`_stepQuake`, after the ring's hit; the sound is
   * MemberCombat's): the spikes are already up (timed so the median one peaks now); the light kicks.
   * @param {Field} fl
   * @param {{ rInner: number, r: number, n: number }} K the spikes' rules (`KIT.greatshield.skill2.spikes`)
   */
  erupt(fl, K) {
    void K;
    for (const Q of this._quakes) if (Q.on && Q.fl === fl) Q.kick = 1;
  }

  /**
   * A spell on the ground closes (`_closeField`, before MemberCombat kills `fl.fx`): its look ends
   * with it.
   * @param {Field} fl
   */
  closed(fl) {
    for (const Q of this._quakes) if (Q.on && Q.fl === fl) this._endQuake(Q);
  }

  // ------------------------------------------------------------------------------------------
  // Earthshatter
  // ------------------------------------------------------------------------------------------

  /**
   * The spikes of a slam: one at each of the ring hit's angles and radii (`MemberCombat._stepQuake`:
   * the field's turn, ±, the ring's middle ± its offsets), each its own height, girth, lean, turn
   * and slab, starting in a sweep from his side round to the far side; a small one beside each on
   * the far half (as the camera sees it).
   * @param {Quake} Q
   * @param {{ rInner: number, r: number, n: number }} K
   */
  _planSpikes(Q, K) {
    const sys = this.sys;
    const rng = this.rng;
    const p = this.mc.member.position;
    const ap = Math.atan2(p.z - Q.z, p.x - Q.x);
    const cfx = sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    Q.spikes.length = 0;
    const mid = (K.rInner + K.r) / 2;
    for (let i = 0; i < K.n; i++) {
      const a = Q.a + (i * Math.PI * 2) / K.n + (i % 2 ? 0.18 : -0.12);
      const rr = mid + RING_OFFSET[i % 3];
      const o = Math.abs(wrapPi(a - ap)) / Math.PI;
      const start = QUAKE.start + QUAKE.sweep * o;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const facing = ux * vx + uz * vz;
      const near = 1 - QUAKE.nearLow * Math.max(0, -facing);
      const height = QUAKE.height[0] + QUAKE.height[1] * rng.next();
      this._pushSpike(Q, Q.x + ux * rr, Q.z + uz * rr, ux, uz, height, QUAKE.radius[0] + (QUAKE.radius[1] - QUAKE.radius[0]) * rng.next(), start, o, false, near);
      // a small one beside it, on the far half only (the near half stays low: the party and the foes read)
      if (facing >= 0) {
        const a2 = a + (rng.next() < 0.5 ? -1 : 1) * QUAKE.compA;
        const r2 = rr * QUAKE.compR;
        const c2 = Math.cos(a2);
        const s2 = Math.sin(a2);
        this._pushSpike(Q, Q.x + c2 * r2, Q.z + s2 * r2, c2, s2, height * QUAKE.compH, (0.18 + 0.06 * rng.next()), start + QUAKE.compStart, o, true, near);
      }
    }
  }

  /**
   * @param {Quake} Q
   * @param {number} x @param {number} z the foot
   * @param {number} ux @param {number} uz its way out from the centre
   * @param {number} height @param {number} radius
   * @param {number} start @param {number} order @param {boolean} small @param {number} near
   */
  _pushSpike(Q, x, z, ux, uz, height, radius, start, order, small, near) {
    const rng = this.rng;
    const lean = height * (QUAKE.lean[0] + (QUAKE.lean[1] - QUAKE.lean[0]) * rng.next());
    const side = (rng.next() - 0.5) * 0.2 * height;
    Q.spikes.push({
      x, y: this.sys.groundAt(x, z) - QUAKE.sink, z, height, radius, yaw: rng.next() * Math.PI * 2,
      tiltX: ux * lean - uz * side, tiltZ: uz * lean + ux * side, seed: (rng.next() * 0x7fffffff) | 0,
      aspect: QUAKE.aspect[0] + (QUAKE.aspect[1] - QUAKE.aspect[0]) * rng.next(),
      start, h: -1, order, small, near, k: near, kr: 1, r: 0,
    });
  }

  /**
   * A spike's readability factors now (read only): the camera's side lower; none with a character
   * standing on its foot, a stub beside one; lower when it stands between the camera and one.
   * Characters: the living foes in view, the player, every member up.
   * @param {Spike} sp
   * @returns {{ k: number, kr: number }} (a scratch record)
   */
  _readable(sp) {
    const sys = this.sys;
    const cfx = sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    let gone = false;
    let stub = false;
    let screened = false;
    const list = sys.enemies;
    for (let i = 0; i < list.length && !gone; i++) {
      const e = list[i];
      if (!e.alive || !e.sprite?.visible) continue;
      const dx = e.position.x - sp.x;
      const dz = e.position.z - sp.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d < QUAKE.clearGone) gone = true;
      else if (d < QUAKE.clearStub) stub = true;
      const depth = dx * vx + dz * vz;
      if (depth > -0.3 && depth < QUAKE.screenDepth && Math.abs(dx * vz - dz * vx) < QUAKE.screenSide) screened = true;
    }
    const P = sys.player.position;
    {
      const dx = P.x - sp.x;
      const dz = P.z - sp.z;
      const d = Math.hypot(dx, dz) - (sys.pc?.radius ?? 0.3);
      if (d < QUAKE.clearGone) gone = true;
      else if (d < QUAKE.clearStub) stub = true;
      const depth = dx * vx + dz * vz;
      if (depth > -0.3 && depth < QUAKE.screenDepth && Math.abs(dx * vz - dz * vx) < QUAKE.screenSide) screened = true;
    }
    const allies = sys.allies;
    for (let i = 0; i < allies.length && !gone; i++) {
      const a = allies[i];
      if (!a.present) continue;
      const q = a.position;
      const dx = q.x - sp.x;
      const dz = q.z - sp.z;
      const d = Math.hypot(dx, dz) - a.radius;
      if (d < QUAKE.clearGone) gone = true;
      else if (d < QUAKE.clearStub) stub = true;
      const depth = dx * vx + dz * vz;
      if (depth > -0.3 && depth < QUAKE.screenDepth && Math.abs(dx * vz - dz * vx) < QUAKE.screenSide) screened = true;
    }
    const o = this._kf;
    if (gone) {
      o.k = 0;
      o.kr = QUAKE.stubR;
      return o;
    }
    o.k = sp.near * (stub ? QUAKE.stubH : 1) * (screened ? QUAKE.screenLow : 1);
    o.kr = stub ? QUAKE.stubR : 1;
    return o;
  }

  /**
   * How near the nearest character's edge is to (x, z) (u; the living foes in view, the player,
   * every member up) — read only.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  _clearAt(x, z) {
    const sys = this.sys;
    let best = Infinity;
    for (const e of sys.enemies) {
      if (!e.alive || !e.sprite?.visible) continue;
      best = Math.min(best, Math.hypot(e.position.x - x, e.position.z - z) - e.radius);
    }
    const P = sys.player.position;
    best = Math.min(best, Math.hypot(P.x - x, P.z - z) - (sys.pc?.radius ?? 0.3));
    for (const a of sys.allies) {
      if (!a.present) continue;
      best = Math.min(best, Math.hypot(a.position.x - x, a.position.z - z) - a.radius);
    }
    return best;
  }

  /**
   * A spike about to rise whose foot is inside a character's clearance moves along its own radial
   * line (its angle kept, inside the ring hit's band) to the nearest free spot — a foe stands among
   * the spikes, never on one; with none free it stays (and `_readable` keeps it down).
   * @param {Quake} Q
   * @param {Spike} sp
   * @param {number} i its index (the spikes before it are placed)
   */
  _freeFoot(Q, sp, i) {
    if (this._clearAt(sp.x, sp.z) >= QUAKE.clearStub) return;
    const dx = sp.x - Q.x;
    const dz = sp.z - Q.z;
    const r0 = Math.hypot(dx, dz) || 1;
    const ux = dx / r0;
    const uz = dz / r0;
    for (let k = 1; k <= 2 * QUAKE.moveSteps; k++) {
      const r = r0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * QUAKE.moveStep;
      if (r < QUAKE.moveIn || r > QUAKE.moveOut) continue;
      const x = Q.x + ux * r;
      const z = Q.z + uz * r;
      if (this._clearAt(x, z) < QUAKE.clearStub) continue;
      let crowded = false;
      for (let j = 0; j < i; j++) {
        const o = Q.spikes[j];
        if (o.h >= 0 && Math.hypot(o.x - x, o.z - z) < o.radius + sp.radius + 0.1) crowded = true;
      }
      if (crowded) continue;
      sp.x = x;
      sp.z = z;
      sp.y = this.sys.groundAt(x, z) - QUAKE.sink;
      return;
    }
  }

  /**
   * An Earthshatter on its clock (the field's): its spikes rise when their time comes (rubble, a
   * puff at every second foot); the payoff — they sink, spitting chips and dust; the record ends.
   * @param {Quake} Q
   */
  _stepQuake(Q) {
    const sys = this.sys;
    const st = this.stage.spikes;
    const t = Q.t;
    if (!Q.sunk) {
      for (let i = 0; i < Q.spikes.length; i++) {
        const sp = Q.spikes[i];
        if (sp.h !== -1 || t < sp.start) continue;
        this._freeFoot(Q, sp, i);
        sp.h = st.spawn(sp);
        if (sp.h < 0) {
          sp.h = -2;
          continue;
        }
        const f = this._readable(sp);
        sp.k = f.k;
        sp.kr = f.kr;
        if (sp.small) continue;
        sys.burst('partyRubble', sp.x, sp.y + 0.25, sp.z, 2);
        if (i % 4 === 0) sys.burst('earthChipPuff', sp.x, sp.y + 0.1, sp.z, 1);
      }
    }
    if (!Q.sunk && t >= QUAKE.sinkAt) {
      Q.sunk = true;
      for (const sp of Q.spikes) {
        if (sp.h < 0 || sp.small || sp.k < 0.05) continue;
        sys.burst('earthChips', sp.x, sp.y + 0.3 + 0.4 * sp.height * sp.k, sp.z, 3);
        sys.burst('earthChipPuff', sp.x, sp.y + 0.1, sp.z, 1);
      }
    }
    if (t >= QUAKE.sinkAt + QUAKE.sinkT) {
      for (const sp of Q.spikes) {
        if (sp.h >= 0) st.free(sp.h);
        if (sp.h !== -2) sp.h = -3;
      }
    }
    // (the crack and the ring are kept records — life Infinity, ended here: a spent pooled record would be handed to another effect)
    if (Q.ring && t >= QUAKE.ringLife) {
      this.mfx.kill(Q.ring);
      Q.ring = null;
    }
    if (Q.crack && t >= QUAKE.crackLife) {
      this.mfx.kill(Q.crack);
      Q.crack = null;
    }
    if (t >= QUAKE.end) this._endQuake(Q);
  }

  /** The crack's tint now: the gold flash cooling to dark earth (written through the matter quads). @param {Quake} Q */
  _crackTint(Q) {
    const n = globalUniforms.uNight.value;
    const heat = Math.exp(-Q.t / QUAKE.heatTau);
    // (the matter quads dim × (1 − 0.72 n); the flash only × (1 − 0.5 n): compensated here)
    const comp = (1 - NIGHT.flash * n) / Math.max(0.05, 1 - NIGHT.matter * n);
    for (let c = 0; c < 3; c++) Q.crackRgb[c] = TINT.crackBody[c] * (1 - heat) + TINT.crackFlash[c] * comp * heat;
  }

  /**
   * An Earthshatter's look at its time: the crack's tint, the spikes (rise, fractures, the
   * readability factors eased).
   * @param {Quake} Q
   * @param {number} dt
   */
  _quakeLook(Q, dt) {
    this._crackTint(Q);
    if (Q.crack) Q.crack.alpha = QUAKE.crackAlpha * clamp01((QUAKE.crackLife - Q.t) / QUAKE.crackFade);
    if (Q.ring) Q.ring.alpha = RING_A * clamp01((QUAKE.ringLife - Q.t) / QUAKE.ringFade);
    const st = this.stage.spikes;
    const t = Q.t;
    const crack = smooth((t - QUAKE.crackFrom) / (QUAKE.crackTo - QUAKE.crackFrom));
    const ease = dt > 0 ? 1 - Math.exp(-dt / QUAKE.ease) : 0;
    const cp = this._spikeP;
    for (const sp of Q.spikes) {
      if (sp.h < 0) continue;
      let rise;
      if (t < QUAKE.sinkAt) rise = riseAt((t - sp.start) / QUAKE.rise);
      else {
        const u = clamp01((t - QUAKE.sinkAt) / QUAKE.sinkT);
        rise = 1 - u * u;
      }
      if (ease > 0) {
        const f = this._readable(sp);
        sp.k += (f.k - sp.k) * ease;
        sp.kr += (f.kr - sp.kr) * ease;
      }
      cp.rise = sp.k > 0.03 ? rise : 0;
      sp.r = cp.rise;
      cp.crack = crack;
      cp.height = sp.height * Math.max(0.05, sp.k);
      cp.radius = sp.radius * sp.kr;
      st.set(sp.h, cp);
    }
  }

  /** @param {Quake} Q */
  _endQuake(Q) {
    const st = this.stage.spikes;
    for (const sp of Q.spikes) if (sp.h >= 0) st.free(sp.h);
    Q.spikes.length = 0;
    this.mfx.kill(Q.crack);
    this.mfx.kill(Q.ring);
    Q.crack = null;
    Q.ring = null;
    Q.fl = null;
    Q.on = false;
  }

  // ------------------------------------------------------------------------------------------
  // Bulwark
  // ------------------------------------------------------------------------------------------

  /**
   * A ward ring under a hero for the ward's `seconds`, following it (pulsing in `visuals`).
   * @param {{ x: number, y: number, z: number }} q
   * @param {MemberCombat|null} owner the member it marks (null: the player)
   * @param {number} base its scale
   * @param {number} seconds
   */
  _wardRing(q, owner, base, seconds) {
    const rec = this.fx.add({ frame: 'partyWardRing', mode: 'flat', x: q.x, y: q.y + FLAT_LIFT, z: q.z, follow: q, scale: base, spin: 1.2, color: TINT.wardRing, life: Infinity, fadeIn: 0.2, alpha: WARD.ringAlpha });
    if (rec) this._rings.push({ rec, owner, base, t: 0, life: seconds });
  }

  /** The Bulwark on its clock: the taunt's snap rings, the glints, the dissolve's motes, its end. */
  _stepBulwark() {
    const B = this._bul;
    if (!B.on) return;
    const sys = this.sys;
    if (!B.cued && B.t >= WARD.tauntAt) {
      B.cued = true;
      // (a one-shot snap at each foe the cry drew: read only — the taunt is the combat's)
      for (const e of sys.enemies) {
        if (!e.alive || e.target !== this.mc || !(e.tauntT > 4.9) || !e.sprite?.visible) continue;
        const k = (e.radius + WARD.tauntPad) / 0.75;
        const rec = this.fx.add({ frame: 'partyWardRing', mode: 'flat', x: e.position.x, y: e.position.y + FLAT_LIFT, z: e.position.z, follow: e.position, scale: k * 1.3, scaleTo: k, grow: WARD.tauntGrow, color: TINT.amber, life: Infinity, alpha: RING_A });
        if (rec) this._cues.push({ rec, e, t: 0 });
      }
    }
    while (B.glints < B.heroes.length && B.t >= WARD.glintAt + B.glints * WARD.glintStagger) {
      const q = B.heroes[B.glints++];
      this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: q.x, y: q.y + 1.1, z: q.z, follow: q, frames: [0, 1], scale: 0.4, color: TINT.wardGlint, life: WARD.glintLife, fadeOut: 0.06, back: -0.3, halo: 1 });
    }
    if (!B.motes && B.t >= WARD.hold) {
      B.motes = true;
      sys.burst('earthWardMote', B.cx, B.cy + B.R * 0.45, B.cz, 8);
    }
    if (B.t >= LIGHT.wardEnd && B.t >= WARD.hold + WARD.dissolve) this._endBulwark();
  }

  /** The Bulwark's look ends (its dome hidden if it still shows it). */
  _endBulwark() {
    const B = this._bul;
    B.on = false;
    B.heroes.length = 0;
    const st = this.stage;
    if (st.domeOwner === this) {
      st.domeOwner = null;
      st.dome.hide();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Per sub-step, per frame
  // ------------------------------------------------------------------------------------------

  /** @param {number} h combat seconds of the sub-step (MemberCombat._stepHero) */
  step(h) {
    this._clock += h;
    for (const Q of this._quakes) {
      if (!Q.on) continue;
      // (the field's own clock: frozen through the slam's hit-stop)
      Q.t = Q.fl && Q.fl.on ? Q.fl.t : Q.t + h;
      this._stepQuake(Q);
    }
    if (this._bul.on) {
      this._bul.t += h;
      this._stepBulwark();
    }
    // (the ward rings and the snap rings are kept records — life Infinity —, ended here: a pooled
    // record the batch ended itself would be handed to the next effect while still referenced)
    const rings = this._rings;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += h;
      // (a member that left the fight takes its ring with it, at once)
      const left = r.owner !== null && r.owner.gone;
      if (r.t < r.life && !left) continue;
      const q = r.rec;
      if (!left) this.sys.burst('earthWardMote', q.x, q.y + 0.2, q.z, 2, RING_MOTES);
      this.fx.kill(q);
      rings[i] = rings[rings.length - 1];
      rings.pop();
    }
    const cues = this._cues;
    for (let i = cues.length - 1; i >= 0; i--) {
      const c = cues[i];
      c.t += h;
      if (c.t < WARD.tauntLife) continue;
      this.fx.kill(c.rec);
      cues[i] = cues[cues.length - 1];
      cues.pop();
    }
    this.fx.step(h);
    this.mfx.step(h);
    this.gfx.step(h);
  }

  /**
   * Once a frame (MemberCombat._writeHeroFx, after the combat moved): the anticipations and the
   * landed blows (from his move, frame and hit count), the slams and the ward as they look, the
   * ward rings, the crest, his quads written (dimmed after dark). The lights are set after it, on
   * the frame's own time (`light`, from EarthStage.update); in a scene's settle nothing new starts.
   * @param {number} dt combat seconds of this frame (0 in hit-stop or while the combat waits: everything holds)
   */
  visuals(dt) {
    if (!this._settling) {
      this._beatsLook();
      this._landedLook();
    }
    for (const Q of this._quakes) if (Q.on) this._quakeLook(Q, dt);
    this._bulwarkLook();
    this._ringsLook();
    if (!this._settling) this._glowLook(dt);
    this._write();
  }

  /**
   * The anticipations, from his move and frame: the bash's rear-foot step (f4), grit lifting where
   * the mace will fall (Earthshatter f8, f14, f20), the ward's seed glyph growing under him
   * (Bulwark's wind-up).
   */
  _beatsLook() {
    const mc = this.mc;
    const sys = this.sys;
    const move = mc.down ? null : mc.move;
    if (move !== this._move || mc.t < this._moveT) {
      this._move = move;
      this._beats = 0;
      this._chargeBorn = 0;
      this._slammed = false;
      this._skipMove = false;
    }
    this._moveT = mc.t;
    // (a move a scene's settle cut short resumes without its anticipations)
    if (this._skipMove) return;
    const f = mc.frame;
    const p = mc.member.position;
    const fc = mc.member.facing;
    if (move === 'bash' && f >= 4 && !(this._beats & 1)) {
      this._beats |= 1;
      sys.burst('footstep', p.x - fc.x * 0.3, p.y + 0.05, p.z - fc.z * 0.3, 3);
    }
    if (move === 'earthshatter' && !this._slammed) {
      for (let b = 0; b < 3; b++) {
        const bit = 2 << b;
        if (f < 8 + 6 * b || this._beats & bit) continue;
        this._beats |= bit;
        const x = p.x + fc.x * 0.9;
        const z = p.z + fc.z * 0.9;
        sys.burst('earthGrit', x, sys.groundAt(x, z) + 0.05, z, 5);
      }
      if (f >= LIGHT.chargeFrom && this._chargeBorn === 0) this._chargeBorn = ++this._serial;
    }
    const seeding = move === 'bulwark' && f < 16;
    if (seeding) {
      const k = smooth(mc.t / F(16));
      if (!this._seed) this._seed = this.fx.add({ frame: 'partyGlyphWard', mode: 'flat', x: p.x, y: p.y + FLAT_LIFT, z: p.z, follow: p, size: WARD.seedSize[0], sizeTo: WARD.seedSize[1], grow: F(16), spin: 1.5, color: TINT.seed, life: Infinity, alpha: 0 });
      if (this._seed) this._seed.alpha = WARD.seedAlpha * k;
    } else if (this._seed) {
      this.fx.kill(this._seed);
      this._seed = null;
    }
  }

  /**
   * A blow of his combo landed (his hit count rose during the bash or the mace; one per swing): a
   * spark of light where it bit (a free light only), and the mace's sparks.
   */
  _landedLook() {
    const mc = this.mc;
    const hits = mc.counts.hits;
    if (hits < this._hits) this._hits = hits;
    if (hits === this._hits) return;
    this._hits = hits;
    const move = mc.move;
    if ((move !== 'bash' && move !== 'mace') || this._sparkSwing === mc.swings) return;
    this._sparkSwing = mc.swings;
    const p = mc.member.position;
    const fc = mc.member.facing;
    const x = p.x + fc.x * 1.2;
    const z = p.z + fc.z * 1.2;
    if (move === 'mace') this.sys.burst('earthShieldSpark', x, p.y + 0.8, z, 4);
    if (!this._spark) this._sparkAt(x, p.y + LIGHT.sparkLift, z, move === 'bash' ? LIGHT.bash : LIGHT.mace, LIGHT.sparkT, LIGHT.sparkDistance);
  }

  /**
   * A spark of light (`minor`: a free light only — a spell's light may take it over).
   * @param {number} x @param {number} y @param {number} z
   * @param {number} peak @param {number} dur @param {number} dist
   */
  _sparkAt(x, y, z, peak, dur, dist) {
    const light = this._acquireLight({ minor: true });
    if (light) this._spark = { light, x, y, z, t: 0, dur, peak, dist };
  }

  /** The spark's quick fall on the frame's own time (its light taken over: over at once). @param {number} frameDt */
  _sparkLook(frameDt) {
    const s = this._spark;
    if (!s) return;
    s.t += frameDt;
    if (s.t >= s.dur || !s.light.held) {
      s.light.off();
      s.light.release();
      this._spark = null;
      return;
    }
    const k = 1 - s.t / s.dur;
    const lp = this._lightP;
    lp.color = LIGHT.sparkColor;
    lp.decay = 1;
    lp.intensity = s.peak * k * k * dayK(DAY.warm);
    lp.distance = s.dist;
    s.light.set(s.x, s.y, s.z, lp);
  }

  /** The dome as it looks at the Bulwark's time: rise, sweeps, dissolve. */
  _bulwarkLook() {
    const B = this._bul;
    if (!B.on || this.stage.domeOwner !== this) return;
    const t = B.t;
    const u = clamp01(t / WARD.rise);
    const dp = this._domeP;
    dp.rise = 1 - (1 - u) * (1 - u) * (1 - u);
    dp.dissolve = smooth((t - WARD.hold) / WARD.dissolve);
    const a0 = WARD.sweeps[0];
    const b0 = WARD.sweeps[1];
    dp.sweepA = t >= a0 && t < a0 + WARD.sweepT ? (t - a0) / WARD.sweepT : -9;
    dp.sweepB = t >= b0 && t < b0 + WARD.sweepT ? (t - b0) / WARD.sweepT : -9;
    this.stage.dome.set(dp);
  }

  /** The ward rings breathe (× 1 ↔ 1.15) and pulse softly over their last seconds; the snap rings drop with their foe. */
  _ringsLook() {
    for (const r of this._rings) {
      const rec = r.rec;
      const s = r.base * (1 + WARD.ringPulse * (0.5 - 0.5 * Math.cos(Math.PI * 2 * WARD.ringPulseHz * r.t)));
      rec.s0 = rec.s1 = s;
      const left = r.life - r.t;
      let a = WARD.ringAlpha;
      if (left < WARD.expiry) {
        const lo = WARD.expiryLow;
        a = lo + (WARD.ringAlpha - lo) * (0.5 + 0.5 * Math.cos(Math.PI * 2 * WARD.expiryHz * (WARD.expiry - left)));
      }
      // (`_back`: gone in a scene's settle, coming back after it)
      rec.alpha = a * clamp01(left / WARD.ringFade) * this._back;
    }
    for (let i = this._cues.length - 1; i >= 0; i--) {
      const c = this._cues[i];
      if (c.e.alive && c.e.sprite?.visible) {
        c.rec.alpha = RING_A * clamp01(1 - c.t / WARD.tauntLife);
        continue;
      }
      this.fx.kill(c.rec);
      this._cues[i] = this._cues[this._cues.length - 1];
      this._cues.pop();
    }
  }

  /**
   * His skills' one light: the newest of its beats drives it — the Earthshatter's charge, a slam's
   * flash and hold, the Bulwark's cry sliding into the ward's glow; kept from one to the next
   * (re-targeted), given back once none is up. A beat asks once (refused: it goes on unlit).
   */
  _fieldLight() {
    const mc = this.mc;
    // the driver: the newest beat still lit
    let born = 0;
    let kind = 0; // 1 charge, 2 a slam, 3 the cry / ward
    /** @type {Quake|null} */
    let Qd = null;
    const charging = this._chargeBorn > 0 && !this._slammed && mc.move === 'earthshatter' && !mc.down && mc.frame < 22;
    if (charging) {
      born = this._chargeBorn;
      kind = 1;
    }
    for (const Q of this._quakes) {
      if (Q.on && Q.t < LIGHT.quakeEnd && Q.born > born) {
        born = Q.born;
        kind = 2;
        Qd = Q;
      }
    }
    const B = this._bul;
    if (B.on && B.t < LIGHT.wardEnd && B.born > born) {
      born = B.born;
      kind = 3;
    }
    if (kind === 0) {
      if (this._field) {
        this._field.off();
        this._field.release();
        this._field = null;
      }
      return;
    }
    if (this._field && !this._field.held) this._field = null;
    if (!this._field) {
      if (born <= this._askedUpTo) return;
      this._askedUpTo = born;
      this._field = this._acquireLight();
      if (!this._field) return;
    }
    const L = this._field;
    const lp = this._lightP;
    if (kind === 1) {
      const p = mc.member.position;
      const fc = mc.member.facing;
      const x = p.x + fc.x * 0.9;
      const z = p.z + fc.z * 0.9;
      lp.color = LIGHT.slamColor;
      lp.intensity = LIGHT.charge * smooth((mc.t - F(LIGHT.chargeFrom)) / F(LIGHT.chargeFrames)) * dayK(DAY.warm);
      lp.distance = LIGHT.chargeDistance;
      lp.decay = 1;
      L.set(x, this.sys.groundAt(x, z) + LIGHT.chargeLift, z, lp);
    } else if (kind === 2 && Qd) {
      const t = Qd.t;
      // the hold under the flash and the ring hit's kick, those two on the frame's own time
      // (`light`) and on the flashes' day factor
      const I = LIGHT.hold * dayK(DAY.warm) + ((LIGHT.slam - LIGHT.hold) * Qd.flash + LIGHT.kick * Qd.kick) * dayK(DAY.flash);
      lp.color = LIGHT.slamColor;
      lp.intensity = I * (1 - smooth((t - LIGHT.fadeFrom) / LIGHT.fadeT));
      lp.distance = LIGHT.slamDistance;
      // (the flash's falloff gentle, the hold's the lamps': a glow from the stone, no wash)
      lp.decay = 1 + smooth((t - 0.1) / 0.3);
      L.set(Qd.x, Qd.y + LIGHT.slamLift, Qd.z, lp);
    } else {
      const t = B.t;
      const u = smooth(t / LIGHT.blend);
      const cry = LIGHT.cry * B.flash * dayK(DAY.flash);
      const ward = LIGHT.ward * dayK(DAY.cool) * (1 - smooth((t - LIGHT.wardOut) / LIGHT.wardOutT));
      const c = this._lightC;
      for (let i = 0; i < 3; i++) c[i] = LIGHT.cryColor[i] + (LIGHT.wardColor[i] - LIGHT.cryColor[i]) * u;
      lp.color = c;
      lp.intensity = cry + ward * u;
      lp.distance = LIGHT.cryDistance + (LIGHT.wardDistance - LIGHT.cryDistance) * u;
      lp.decay = 1 + (LIGHT.wardDecay - 1) * u;
      // (the light slides from over him to over the dome: it never jumps)
      L.set(B.x + (B.cx - B.x) * u, B.y + LIGHT.cryLift + (B.cy + LIGHT.wardLift - B.y - LIGHT.cryLift) * u, B.z + (B.cz - B.z) * u, lp);
    }
  }

  /**
   * The crest's glow (`sprite.setGlow`; only once his sheet has the crest's glow texels): charging
   * through a skill's wind-up, a flash at its moment, the ward's hold and pulse, the blows' kicks;
   * decaying; 0 while he is down.
   * @param {number} dt
   */
  _glowLook(dt) {
    if (!this._crest) return;
    const mc = this.mc;
    let target = 0;
    if (mc.move === 'earthshatter' && mc.frame < 22) target = GLOW.quakeCharge * smooth(mc.t / F(22));
    else if (mc.move === 'bulwark' && mc.frame < 16) target = GLOW.bulwarkCharge * smooth(mc.t / F(16));
    else if (this._bul.on && this._bul.t < WARD.hold) target = GLOW.bulwarkHold;
    else if (this._rings.length) target = GLOW.wardPulse[0] + (GLOW.wardPulse[1] - GLOW.wardPulse[0]) * (0.5 + 0.5 * Math.sin(this._clock * Math.PI * 2 * 0.8));
    if (this._kick > 0) {
      this.glow = Math.max(this.glow, this._kick);
      this._kick = 0;
    }
    if (mc.down) this.glow = 0;
    else if (target >= this.glow) this.glow = target;
    else this.glow = target + (this.glow - target) * Math.exp(-dt / GLOW.tau);
    this.glow = Math.min(GLOW.max, this.glow);
    if (this.glow < 0.01) this.glow = 0;
    this._writeGlow(this.glow);
  }

  /** @param {number} a */
  _writeGlow(a) {
    if (!this._crest) return;
    const v = Math.round(a * 100) / 100;
    if (v === this._glowShown) return;
    this._glowShown = v;
    this.mc.member.sprite?.setGlow(GLOW.rgb[0], GLOW.rgb[1], GLOW.rgb[2], v);
  }

  /**
   * The crest's world spot in the cell his sprite shows (the centre of its glow texels), or null
   * when that cell has none (the shield turned away, a sheet without the crest's glow texels).
   * @returns {{ x: number, y: number, z: number }|null}
   */
  _crestAt() {
    const mc = this.mc;
    const cell = this._crest?.[mc._lastRow]?.[mc._lastCol] ?? null;
    if (!cell) return null;
    const p = mc.member.position;
    const o = this._crestP;
    const yaw = globalUniforms.uCameraYaw.value;
    o.x = p.x + Math.cos(yaw) * cell.right;
    o.y = p.y + cell.up;
    o.z = p.z - Math.sin(yaw) * cell.right;
    return o;
  }

  /** Tests: his look's state (`heroInfo().earth`). */
  info() {
    let spikes = 0;
    for (const Q of this._quakes) for (const sp of Q.spikes) if (sp.h >= 0) spikes++;
    return {
      effects: this.count, quakes: this._quakes.filter((q) => q.on).length, spikes,
      bulwark: this._bul.on, dome: this.stage.domeOwner === this && this.stage.dome.shown,
      wardRings: this._rings.length, taunts: this._cues.length, glow: +this.glow.toFixed(3), crest: !!this._crest,
      settling: this._settling, settled: this._settled, back: +this._back.toFixed(3),
      lights: { ...this.lights, held: (this._field?.held ? 1 : 0) + (this._spark?.light.held ? 1 : 0), field: !!this._field?.held, spark: !!this._spark?.light.held },
    };
  }
}
