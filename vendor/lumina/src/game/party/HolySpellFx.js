import { RNG, hashString, globalUniforms } from '../../engine/index.js';
import { F } from '../combat/rules.js';
import { glowSpots } from '../combat/glowSpots.js';
import { SpellFx, FLAT_LIFT, GLYPH_A, RING_A } from './MemberCombat.js';

/**
 * @import { LookStage } from '../combat/types.js'
 * @import { CombatSystem } from '../combat/CombatSystem.js'
 * @import { MemberCombat, Missile, Field, FxRec } from './MemberCombat.js'
 * @import { VqCasterKit } from './rules.js'
 * @import { SpellLight } from '../../engine/lighting/VfxLights.js'
 * @import { Sprite3D } from '../../engine/sprite/Sprite3D.js'
 */

/**
 * HolySpellFx — the look of the cleric's spells (Seraphine of Vanquish the Evil Dragon: the
 * companion class `cleric`, party/rules.js `KIT.cleric`; docs/contracts/DRAGON_CAMPAIGN.md §6.8,
 * COMBAT.md §28, COMBAT_VFX.md). Visuals only: `MemberCombat` keeps the moves — their timing, aim,
 * hits, heals, wards, hit-stop, shake, sounds — exactly as they are and calls these hooks; nothing
 * here touches a hit, a heal, a cooldown or the member's RNG (its own: `holy:<id>` and the combat
 * seed), so the fights play the same.
 *
 * A module of its own, imported (`import()`) by `CombatSystem.load` only on a level where a cleric
 * can fight (`classMayFight('cleric', …)`, mayFight.js): there the combat makes one `HolyStage`
 * (`sys.holy`: the FX batch's halo, warmed at load) and every cleric member gets a `HolySpellFx`
 * (`stage.director(member)`). Anywhere else nothing of it exists — no program, object or download.
 *
 * The look (cut-out quads with dither fades, additive halos on small bright quads, light; built on
 * the ice mage's findings, COMBAT_VFX.md):
 *  - **Two palettes that survive ACES**: a pale champagne gold for her light (bodies under the halo
 *    gate, cores and stars above it with `halo: 1`) — on screen G/R ≈ 0.94, B/R ≈ 0.65, never the
 *    burning world's orange (G/R 0.72) and never white — and a life green for the heals.
 *  - **Light**: one combat VFX light for her spells on the ground (Judgement, the raise: `field`)
 *    and one for her short ones (the bolt, Mend, Sanctuary's dim fill: `minor`) — never more than
 *    two of the game's four; high up (≥ 2 u: a low light whitens the pale sand), warm, × 0.4 by
 *    day. Every flash and pulse ages on the frame's own time (a hit-stop does not hold it; the
 *    payoff's flash waits for the hit-stop's end) and is × 0.25 by day — they land on foes the
 *    core's hit flash whitens —; none brighter than 6 at night. Dark while a scene holds the fight.
 *  - **A story scene** on a set-piece level (the ambient step) settles her effects out over 0.25 s
 *    of frames — the one-shots gone, the spells still up (a circle, a ward ring, a bolt in flight)
 *    faded and back when the fight runs again; the map or a talk only holds them.
 *  - **Judgement, staged**: the staff's sun charges; a glyph opens over a filling glow disc; sigils
 *    mark where the pillars will fall; each pillar strikes as a thin bright core, its body
 *    following two frames later (the camera's side lower, a body that screens a foe or a hero at
 *    half); an inhale — the bodies fading, stars sliding in from the sigils, the glyph turning
 *    faster, the light drawing down —; the payoff: the great pillar just beyond the centre (a
 *    backlight behind the foe there, never over it), the ring, the flash held by the move's
 *    hit-stop; the hold: burn marks, the glyph flaring; the release: the pillar dissolves upward,
 *    the glyph burns out from its rim.
 *  - **Sanctuary**: a green circle that blooms open — one continuous ward ring on its edge, which
 *    reads at the play camera by day, over a faint glyph —, a pulse ring and a light pulse at every
 *    heal tick, a few rising motes, the ward rings and a short shimmer on every warded hero, the
 *    healed heroes' pulse; lifting into motes as it ends.
 *  - **Mend**: three stars fly from her sun to the one she heals and arrive with the heal: a green
 *    column of light on it. **The raise**: a glyph and a disc filling under the fallen, its sprite
 *    warming, then a pillar of light; a failed raise burns out.
 *  - **Holy Bolt**: an orb (body + haloed core) riding a small light, bursting where it strikes —
 *    a splash ring on the ground the size of its gameplay splash.
 *  - Her staff's sun: a star while she casts, its glow texels (`sprite.setGlow`) building through
 *    the wind-up, a flash at the release. The heroes' highlights (`setHighlight` on the player and
 *    the members: ward shimmer, heal pulses, the raised one's) are this package's alone; every one
 *    it wrote is cleared while hushed, on a reset, a rest, a death and a travel.
 */

/** @type {(c: number[]) => readonly number[]} */
const tint = (c) => Object.freeze(c);
/**
 * Her light (linear HDR × the atlas's grey levels): a pale champagne gold. Bodies and ground
 * frames under the halo's gate (max ≤ 1.15; big ground frames ≤ 0.95, halo 0), cores, stars and
 * bursts above it (1.45–1.6, `halo: 1`); the second channel ≈ 0.7–0.78 × the lead and the third
 * ≈ 0.14–0.2 ×: through ACES (233, 219, 152) … (240, 233, 189) — light, not fire, not white.
 */
const HOLY = Object.freeze({
  body: tint([1.15, 0.8, 0.16]),
  bodyBig: tint([1.265, 0.88, 0.176]),
  core: tint([1.6, 1.25, 0.3]),
  star: tint([1.55, 1.2, 0.28]),
  burst: tint([1.45, 1.08, 0.22]),
  orb: tint([1.25, 0.88, 0.18]),
  glyph: tint([0.85, 0.6, 0.12]),
  ring: tint([0.8, 0.56, 0.1]),
  disc: tint([0.7, 0.5, 0.1]),
});
/** The heals' green-lime (Sanctuary, Mend): readable on the noon sand by its hue. */
const LIFE = Object.freeze({
  body: tint([0.32, 0.85, 0.1]),
  lit: tint([0.18, 1.35, 0.14]),
  core: tint([0.75, 1.65, 0.25]),
  /** Sanctuary's opening bloom (a soft disc over the sand: as deep a green as the rim, or it blends olive). */
  disc: tint([0.08, 0.6, 0.12]),
  /**
   * Sanctuary's ring, glyph and tick pulses (one continuous ring, its crest the lit rim), the ward
   * rings: a deep green, red near none — ACES lends the red channel a third of the green, and the
   * noon grade warms it further, so a paler or brighter green reaches the screen yellow on the sand.
   */
  rim: tint([0.06, 0.62, 0.1]),
});
/** How much her quads dim at full night (`uNight` 1; the exposure rises after dark). */
const NIGHT_DIM = 0.35;

/** The staff sun's glow colour (the HOLY ramp's own hue: its palest texel does not go white first). */
const GLOW_RGB = Object.freeze([1.0, 0.75, 0.25]);
/**
 * Glow strength while charging (peak at the release / `at`) and the release's flash, per move;
 * `tau` the decay after the flash (s), `max` its ceiling.
 */
const GLOW = Object.freeze({
  holyBolt: Object.freeze({ peak: 1.0, flash: 1.6 }),
  mend: Object.freeze({ peak: 1.0, flash: 1.5 }),
  sanctuary: Object.freeze({ peak: 1.2, flash: 1.8 }),
  judgement: Object.freeze({ peak: 1.3, flash: 2.0 }),
  revive: Object.freeze({ peak: 1.4, flash: 1.8 }),
  tau: 0.12,
  max: 2.3,
});

/**
 * Her spell lights (the combat VFX lights, World.acquireSpellLight; linear colours, decay 1 unless
 * said, intensities in the lanterns' units). Judgement (`field`): a charge over the glyph
 * (`chargeFrom` → `charge`), a pulse at every pillar, drawn down to `inhale` before the payoff's
 * `flash` (held by the hit-stop), decaying over `flashTau` into `hold` (its falloff easing to
 * `holdDecay`), out by `outT`. The raise (`field`): `raiseFrom` → `raise` over the fallen, a
 * `raiseFlash` into `raiseHold`. Sanctuary (`minor`): a dim life light swaying over the circle, a
 * pulse per tick. The bolt (`minor`): riding the orb, a spark at the impact. Mend (`minor`): a
 * fall over the healed. Never lower than `minLift` u over the ground (a low warm light whitens the
 * pale sand: COMBAT_VFX.md §7.2). Every flash and pulse ages on the frame's own time (a hit-stop does
 * not hold it) and is × `DAY.flash` by day, the lights that stand × `DAY.steady`; none brighter than
 * `cap` (the peak at night).
 */
const LIGHT = Object.freeze({
  holy: [1.6, 1.0, 0.35], life: [0.85, 1.4, 0.45], minLift: 2.0, cap: 6,
  chargeFrom: 1.5, charge: 3, chargeLift: 2.8, chargeDistance: 7, pulse: 2, pulseTau: 0.06, inhale: 1.6,
  flash: 12, flashTau: 0.07, hold: 2.0, holdDecay: 2, flashLift: 3, flashDistance: 10.5, outFrom: 1.25, outT: 1.5,
  raiseFrom: 0.5, raise: 3.5, raiseLift: 3.0, raiseDistance: 5.5, raiseFlash: 4, raiseHold: 1.2, raiseHoldT: 0.3, raiseFade: 0.3, failFade: 0.2,
  sanct: 3, sanctRise: 0.3, sanctLift: 2.6, sanctDistance: 9, sanctSway: 0.6, sanctTurn: 1.2, tick: 2.5, tickTau: 0.15,
  sanctOut: 3.6, sanctOutT: 0.4, reask: 0.5,
  bolt: 3.5, boltDistance: 3, impact: 4, impactT: 0.16, impactDistance: 3.5,
  mend: 4, mendT: 0.25, mendLift: 2.2, mendDistance: 4,
});
/**
 * By day her lights are this much of their night strength: `steady` the lights that stand (a charge,
 * a hold, Sanctuary's fill, the bolt riding: a warm light on pale sand, 0.4), `flash` every flash and
 * pulse above them — they land on foes the core's hit flash already whitens (COMBAT_VFX.md §7.4,
 * decision D-1 of the heroes' review).
 */
const DAY = Object.freeze({ steady: 0.4, flash: 0.25 });
/** @type {(min: number) => number} a day factor now (`min` by day and at golden hour, 1 at night) */
const dayK = (min) => min + (1 - min) * globalUniforms.uNight.value;
/** A story scene's settle (s of frames): her effects fade out over it (the ambient step). */
const SETTLE = 0.25;
/** A lit layer over its body: toward the camera for an upright one (`back`). */
const LIT_BACK = -0.03;
/** Spells of hers on the ground at once as they look (a Judgement, a Sanctuary, one more lingering). */
const FIELDS = 3;
/** Decor (motes, ward stars, burn marks, inhale stars) is skipped while fewer quads than this are free. */
const DECOR_FREE = 96;

/**
 * Judgement's staging (s of the field's clock; the pillars and the payoff come from the kit): the
 * sigils from `sigilAt` + n × the kit's `every`, growing over `sigilGrow` to `sigilSize` u, gone
 * `sigilAfter` s after their pillar; a pillar's core for `coreLife` s, its body `bodyDelay` s
 * later for `bodyLife` s (scale `scale`; the camera's side × `near`; one that screens a foe or a
 * hero — within `screenSide` u across and 0 … `screenDepth` u behind it as the camera sees it —
 * at alpha `screenA`); the inhale from `inhaleAt` (`inhaleT` s of stars sliding in, the glyph's
 * spin to `spinIn`); the payoff's great pillar (`bigScale`, `bigBack` u beyond the centre; thinning
 * through the hold, its tint settling by `bigSettle`) and its burst (`burstY` u up, `burstBack` u
 * further back); burn marks; the release's ascent at `ascendAt`, the glyph burning out over
 * `burnOut` s from then; the glow disc spent within `discOut` s of the payoff.
 */
const JUDG = Object.freeze({
  sigilAt: 0.2, sigilGrow: 0.2, sigilSize0: 0.3, sigilSize: 0.9, sigilAfter: 0.25,
  coreLife: 0.24, coreFade: 0.1, bodyDelay: 2 / 60, bodyLife: 0.32, bodyFade: 0.14,
  scale: 0.85, near: 0.75, nearDot: -0.3, bodyA: 0.9, screenA: 0.5, screenDepth: 2.6, screenSide: 0.75,
  inhaleAt: 0.81, inhaleT: 0.16, spin: 0.9, spinIn: 3, spinOut: 0.3,
  bigScale: 1.25, bigBack: 0.4, bigLife: 0.6, bigSettle: 0.25, burstY: 1.4, burstBack: 0.4,
  burnLife: 0.45, burnFade: 0.3, flare: 0.25, flareT: 0.2, ascendAt: 1.25, burnOut: 0.3, discOut: 0.16,
  discA: 0.4, glyphIn: 0.15,
});
/**
 * Sanctuary's staging: the ward ring on its edge (one continuous ring at alpha `ringA2`, its crest on
 * the circle's radius: the frame's crest sits at `ringR` of its half-width) over a faint glyph (alpha
 * `glyphA`), both burning out from `burnAt` over `burnOut` s; the opening bloom (`bloomT` s, alpha up
 * to `bloomA`); a pulse ring at every tick; up to `motes` rising motes, one every `moteEvery` s; the
 * ascent round the rim at `ascendAt`.
 */
const SANCT = Object.freeze({
  glyphA: 0.22, glyphIn: 0.2, burnAt: 3.9, burnOut: 0.4, bloomT: 0.6, bloomA: 0.35, ringA2: 1, ringR: 45.5 / 48,
  motes: 5, moteEvery: 0.24, moteR: 0.85, ringA: 0.4, ascendAt: 4.0,
});
/** Mend's tether: stars launched at these frames of the move, flying `fly` frames to the one she heals. */
const MEND = Object.freeze({ launch: Object.freeze([2, 7, 12]), fly: 6 });
/** The heroes' highlights (setHighlight; never a flash: the hurt flash reads over them). */
const HL = Object.freeze({
  ward: Object.freeze([1.2, 0.9, 0.3]), wardLo: 0.06, wardHi: 0.12, wardHz: 1.2, wardFor: 1.5,
  heal: Object.freeze([0.45, 1.15, 0.35]), healA: 0.3, healT: 0.35,
  raise: Object.freeze([1.2, 0.9, 0.3]), raiseA: 0.4, raisedA: 0.45, raisedT: 0.5,
});

/** @type {(u: number) => number} smoothstep 0..1 */
const smooth = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};
/**
 * A quad onto its missile (a bolt's orb and core, every frame).
 * @param {FxRec|null} r @param {Missile} ms
 */
function placeOn(r, ms) {
  if (!r) return;
  r.x = ms.x;
  r.y = ms.y;
  r.z = ms.z;
}

/** @type {(u: number) => number} */
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);

/**
 * One of her two light slots (`field`: Judgement, the raise; `minor`: the bolt, Mend, Sanctuary):
 * the VFX light it holds, whose effect drives it now (a newer effect of hers of the same kind takes
 * it over; an effect that ends hands it back to an older one still up), the intensity last set.
 * @typedef {{ light: SpellLight|null, who: object|null, I: number, minor: boolean }} LightSlot
 */
/**
 * A spell of hers on the ground as it looks (its move's field `src` mirrored; closed with it):
 * kind, spot and ground, the turn `a`, its clock, the glyph and its tint, the glow disc and its
 * tint, Sanctuary's ward ring, the glyph's turn, the pillars' spots, the sigils lit so far, the bodies
 * due, the inhale stars, the stages reached, the light's pulses (frame-clock times: the pillars', the
 * ticks') and the payoff's flash (its frame-clock time; −1: none yet, −2: waiting for the hit-stop's
 * end), Sanctuary's motes, its light state.
 * @typedef {{ on: boolean, kind: 'judgement'|'sanctuary', src: Field|null, x: number, y: number, z: number, a: number,
 *   t: number, fx: FxRec[], glyph: FxRec|null, glyphRgb: number[], disc: FxRec|null, discRgb: number[], ring: FxRec|null, bigRgb: number[], rot: number,
 *   spots: { x: number, y: number, z: number }[], sig: number, due: number[], stars: (FxRec|null)[],
 *   inhaled: boolean, payT: number, flash0: number, ascended: boolean, mote: number, ticks: number[], unlit: boolean, ask: number }} HolyField
 */
/** @returns {HolyField} */
function newField() {
  return {
    on: false, kind: 'judgement', src: null, x: 0, y: 0, z: 0, a: 0, t: 0, fx: [], glyph: null, glyphRgb: [0, 0, 0],
    disc: null, discRgb: [0, 0, 0], ring: null, bigRgb: [0, 0, 0], rot: 0, spots: Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0 })),
    sig: 0, due: [-1, -1, -1, -1, -1, -1], stars: [null, null, null, null, null, null],
    inhaled: false, payT: -1, flash0: -1, ascended: false, mote: 0, ticks: [], unlit: false, ask: 0,
  };
}
/** A Holy Bolt in flight as it looks: the move's missile, its orb and haloed core, unlit (its light given back: no spark at its end). @typedef {{ ms: Missile, body: FxRec|null, core: FxRec|null, unlit: boolean }} Bolt */
/** A short light of hers falling off (a bolt's impact, a Mend): where, when it started (the frame clock), its kind. @typedef {{ x: number, y: number, z: number, t: number, kind: 'impact'|'mend' }} Spark */
/** A mote rising in Sanctuary: its quad, field, spot, rise speed, sway phase, age, life. @typedef {{ rec: FxRec, fl: HolyField, x: number, z: number, y: number, vy: number, ph: number, age: number, life: number }} Mote */
/** A warded hero's look (Sanctuary's ward): who, its ring, its orbiting stars, its age, its beat's phase, the ward's length (s). @typedef {{ who: 'player'|MemberCombat, ring: FxRec|null, stars: (FxRec|null)[], age: number, ph: number, T: number }} Ward */
/**
 * The raise as it looks: the fallen, the glyph and disc under it and the disc's tint, the stage
 * (`charge` until it lands, then `raised` or `out`), the seconds since it landed or went out, the
 * ascent done.
 * @typedef {{ who: MemberCombat, glyph: FxRec|null, disc: FxRec|null, discRgb: number[], phase: 'charge'|'raised'|'out',
 *   t: number, f0: number, from: number, k: number, ascended: boolean, x: number, y: number, z: number, unlit: boolean }} Raise
 */
/** A hero's pulse (a heal, the raised one's): who, colour, strength at its start, length, age. @typedef {{ who: 'player'|MemberCombat, rgb: readonly number[], a: number, T: number, age: number }} Pulse */

/**
 * A hero's highlight as the stage holds it: the strongest ask of this frame (its colour, strength,
 * frame stamp, the director that asked it) and the highlight last written on the sprite.
 * @typedef {{ r: number, g: number, b: number, a: number, stamp: number, shown: number[], owner: HolySpellFx|null }} HeroHighlight
 */

/**
 * What a combat on a level where a cleric can fight adds (`sys.holy`, made by `CombatSystem.load`):
 * the FX batch's halo (`enableHalo`, the shared strength; warmed at load), a `HolySpellFx` per
 * cleric member, and the heroes' highlights its directors ask for (resolved once a frame: the
 * strongest wins, written only on a change, cleared while hushed). Disposed with the combat (a
 * travel included): every VFX light held given back, every highlight and glow cleared.
 * @implements {LookStage}
 */
export class HolyStage {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    sys.quads?.enableHalo();
    /** @type {HolySpellFx[]} the clerics' directors */
    this.directors = [];
    /** The warm-up's halo quad (−1: none). */
    this._warmQuad = -1;
    /** The heroes' highlights asked for this frame (sprite → the strongest ask) and as last written. @type {Map<Sprite3D, HeroHighlight>} */
    this._hl = new Map();
    /** This frame's stamp (asks carry it; `update` resolves them). */
    this._stamp = 1;
    /** Hushed last frame (a scene, a talk, the map). */
    this.hushed = false;
    /** `_resolveHighlights`' frame state and its callback, made once (no closure per frame). */
    this._resolveHushed = false;
    /** @type {(e: HeroHighlight, sprite: Sprite3D) => void} */
    this._resolveOne = (e, sprite) => {
      const on = !this._resolveHushed && e.stamp === this._stamp;
      const a = on ? Math.round(e.a * 200) / 200 : 0;
      const s = e.shown;
      if (a === 0) {
        if (s[3] !== 0) sprite.setHighlight(0, 0, 0, 0);
        this._hl.delete(sprite);
        return;
      }
      if (s[3] === a && s[0] === e.r && s[1] === e.g && s[2] === e.b) return;
      s[0] = e.r;
      s[1] = e.g;
      s[2] = e.b;
      s[3] = a;
      sprite.setHighlight(e.r, e.g, e.b, a);
    };
    /** `clearHighlights` / `forget`'s owner filter (null: every highlight) and callback. @type {HolySpellFx|null} */
    this._clearOwner = null;
    /** @type {(e: HeroHighlight, sprite: Sprite3D) => void} */
    this._clearOne = (e, sprite) => {
      if (this._clearOwner !== null && e.owner !== this._clearOwner) return;
      if (e.shown[3] !== 0) sprite.setHighlight(0, 0, 0, 0);
      this._hl.delete(sprite);
    };
  }

  /**
   * The director of a cleric member (MemberCombat's constructor).
   * @param {MemberCombat} mc
   * @returns {HolySpellFx}
   */
  director(mc) {
    const d = new HolySpellFx(this, mc);
    this.directors.push(d);
    return d;
  }

  /** A director goes (its member's fight released). @param {HolySpellFx} d */
  drop(d) {
    const i = this.directors.indexOf(d);
    if (i >= 0) this.directors.splice(i, 1);
  }

  /**
   * The combat's warm-up (`CombatSystem.warmup`): one halo-weighted quad far below the world (the
   * halo's program compiles at load — on Vanquish's levels the ice mage's stage has made it too: the
   * same program).
   * @param {{ x: number, y: number, z: number }} far
   */
  warmup(far) {
    const q = this.sys.quads;
    if (!q) return;
    this._warmQuad = q.alloc();
    if (this._warmQuad >= 0) q.set(this._warmQuad, { x: far.x, y: far.y, z: far.z, frame: 'partySunburst', index: 0, scale: 1, mode: 'billboard', r: 1.6, g: 1.25, b: 0.3, a: 1, halo: 1 });
    q.update();
  }

  /** After the warm frames (`CombatSystem.endWarmup`). */
  endWarmup() {
    if (this._warmQuad >= 0) this.sys.quads?.free(this._warmQuad);
    this._warmQuad = -1;
  }

  /**
   * Once a frame after the members' visuals (`CombatSystem.afterPlayer`; `LookStage.update`): the
   * lights' flashes and pulses age on the frame's own time (a hit-stop does not hold a flash), the
   * staff suns' glow and the heroes' highlights are written. While the combat does not run (a talk,
   * the map — not the photo mode) the spell lights are dark and the glow and highlights off, the
   * quads holding; in a story scene on a set-piece level (the ambient step) her effects settle out
   * as well (`HolySpellFx.settle`). All of it comes back with the fight.
   * @param {number} dt combat seconds of the frame (0: everything holds)
   * @param {boolean} [active] the combat ran this frame
   * @param {number} [frameDt] the frame's own seconds
   * @param {boolean} [ambient] a story run holds the player on a set-piece level
   */
  update(dt, active = true, frameDt = 0, ambient = false) {
    const hushed = !active && !this.sys.game?.photoMode;
    this.hushed = hushed;
    for (let i = 0; i < this.directors.length; i++) {
      const d = this.directors[i];
      if (ambient) d.settle(frameDt);
      else {
        if (active) d.resume(frameDt);
        d.overlay(hushed);
      }
    }
    this._resolveHighlights(hushed || ambient);
  }

  /**
   * A hero's highlight this frame (`setHighlight`; its strongest ask wins).
   * @param {Sprite3D|null|undefined} sprite
   * @param {readonly number[]} rgb
   * @param {number} a
   * @param {HolySpellFx|null} [owner] the director asking
   */
  highlight(sprite, rgb, a, owner = null) {
    if (!sprite || !(a > 0.004)) return;
    let e = this._hl.get(sprite);
    if (!e) {
      e = { r: 0, g: 0, b: 0, a: 0, stamp: 0, shown: [0, 0, 0, 0], owner: null };
      this._hl.set(sprite, e);
    }
    if (e.stamp === this._stamp && e.a >= a) return;
    e.stamp = this._stamp;
    e.r = rgb[0];
    e.g = rgb[1];
    e.b = rgb[2];
    e.a = a;
    e.owner = owner;
  }

  /** @param {boolean} hushed */
  _resolveHighlights(hushed) {
    this._resolveHushed = hushed;
    this._hl.forEach(this._resolveOne);
    this._stamp++;
  }

  /** Every highlight this package wrote back to none at once (a rest, a death, a travel). */
  clearHighlights() {
    this._clearOwner = null;
    this._hl.forEach(this._clearOne);
    this._stamp++;
  }

  /**
   * The highlights one director asked for back to none at once (its reset, its release): another
   * cleric's stay (they ask again every frame).
   * @param {HolySpellFx} d
   */
  forget(d) {
    this._clearOwner = d;
    this._hl.forEach(this._clearOne);
    this._clearOwner = null;
  }

  /**
   * Every spell light given back (the death reset, a rest: `CombatSystem.resetEncounter`), the
   * spells still up going on unlit; the ward's look gone with the ward, the highlights cleared.
   */
  dropLights() {
    for (const d of this.directors) d.dropLights();
    this.clearHighlights();
  }

  /** The combat goes: every director (lights, glow, quads), every highlight. */
  dispose() {
    for (const d of [...this.directors]) d.dispose();
    this.directors.length = 0;
    this.clearHighlights();
  }

  /** Tests (`__game.combat.system.holy.info()`). */
  info() {
    let held = 0;
    let asks = 0;
    let refused = 0;
    for (const d of this.directors) {
      const L = d.lights;
      held += d.heldLights();
      asks += L.acquired + L.refused;
      refused += L.refused;
    }
    return { directors: this.directors.length, lights: { held, asks, refused }, halo: !!this.sys.quads?.halo, highlights: this._hl.size };
  }
}

/**
 * The look of one cleric's spells (see the module comment): hooks MemberCombat calls at the moves'
 * moments, her own effects stepped on the combat clock (`step`) and written once a frame
 * (`visuals`); her glow and the heroes' highlights written by the stage after (`overlay`).
 */
export class HolySpellFx {
  /**
   * @param {HolyStage} stage
   * @param {MemberCombat} mc
   */
  constructor(stage, mc) {
    this.stage = stage;
    this.mc = mc;
    /** @type {CombatSystem} */
    this.sys = mc.sys;
    /** Her effect quads on the combat's FX batch (her bright small ones ask for the halo: `halo: 1`). */
    this.fx = new SpellFx(this.sys, { halo: 0 });
    /** @type {HolyField[]} */
    this._fields = Array.from({ length: FIELDS }, newField);
    /** @type {Bolt[]} her bolts in flight */
    this._bolts = [];
    /** @type {Spark[]} */
    this._sparks = [];
    /** @type {Mote[]} */
    this._motes = [];
    /** @type {Ward[]} */
    this._wards = [];
    /** @type {Pulse[]} */
    this._pulses = [];
    /** @type {(FxRec|null)[]} Mend's tether stars */
    this._tether = [null, null, null];
    /** Sheet cells → the sun's spot (glow texels; null: none found). */
    this._spots = glowSpots(mc.member.sprite?.sheet);
    this._sun = { x: 0, y: 0, z: 0 };
    this._tgt = { x: 0, y: 0, z: 0 };
    /** @type {{ color: number[], intensity: number, distance: number, decay: number }} */
    this._lightP = { color: LIGHT.holy, intensity: 0, distance: 8, decay: 1 };
    /** @type {LightSlot} */
    this._field = { light: null, who: null, I: 0, minor: false };
    /** @type {LightSlot} */
    this._minor = { light: null, who: null, I: 0, minor: true };
    /** Both slots (no array made per frame). */
    this._slots = [this._field, this._minor];
    /** Frame seconds while the combat runs (`resume`): the clock her lights' flashes and pulses age on. */
    this._fclock = 0;
    /** Her held quads' share shown (1; 0 … 1 while a story scene settles them out and they come back). */
    this._show = 1;
    /** A story scene's settle running, its seconds (`settle`). */
    this._settling = false;
    this._settleT = 0;
    /** `_write`'s scratch: the quads' own alphas while the settle scales them. @type {number[]} */
    this._alphaSave = [];
    this.clear();
  }

  /** Her effects live (tests, `heroInfo().quads`). */
  get count() { return this.fx.count; }

  /** Everything gone (the member's reset, its release): bolts, spells, effects, lights, glow, highlights. */
  clear() {
    for (const fl of this._fields) if (fl.on) this._closeField(fl);
    this._bolts.length = 0;
    this._sparks.length = 0;
    this._motes.length = 0;
    this._wards.length = 0;
    this._pulses.length = 0;
    this._tether.fill(null);
    this.fx.clear();
    this._release(this._field, null);
    this._release(this._minor, null);
    /** @type {Raise|null} */
    this._raise = null;
    /** @type {FxRec|null} the staff's star while she charges */
    this._star = null;
    /** The sun's glow strength now, the flash a release asked for. */
    this.glow = 0;
    this._kick = 0;
    this._glowShown = -1;
    /** Her move and action frame as last seen (`visuals`: the bolt's second gather). */
    this._seenMove = /** @type {string|null} */ (null);
    this._seenFrame = -1;
    /**
     * VFX lights asked for so far, by kind (given / refused), and the lowest any of hers stood
     * over the ground (u) — tests.
     */
    this.lights = { acquired: 0, refused: 0, field: 0, fieldRefused: 0, minor: 0, minorRefused: 0, lowest: Infinity };
    this.rng = new RNG((hashString(`holy:${this.mc.id}`) ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
    this._writeGlow(0);
    this._show = 1;
    this._settling = false;
    this._settleT = 0;
    this.stage.forget(this);
  }

  /**
   * The stage's frame (`HolyStage.update`, after the visuals): her lights dark while hushed, the
   * sun's glow written (0 while hushed).
   * @param {boolean} hushed
   */
  overlay(hushed) {
    if (hushed) {
      for (const s of this._slots) {
        if (s.light && s.light.held) s.light.off();
        s.I = 0;
      }
      this._writeGlow(0);
    } else this._writeGlow(this.glow);
  }

  /**
   * A frame of the fight (`HolyStage.update` while the combat runs, a hit-stop included): the clock
   * her lights' flashes and pulses age on advances; after a story scene her held effects (the circle,
   * the ward rings, a bolt still flying …) come back over `SETTLE` s.
   * @param {number} frameDt the frame's own seconds
   */
  resume(frameDt) {
    this._fclock += frameDt;
    if (this._settling) {
      this._settling = false;
      this._settleT = 0;
    }
    if (this._show < 1) {
      this._show = Math.min(1, this._show + frameDt / SETTLE);
      this._write();
    }
  }

  /**
   * A story scene holds the fight on a set-piece level (the ambient step): her lights dark (still
   * hers) and her glow off, as hushed; every one-shot effect (a pillar, a burst, a ring running out …)
   * fades out over `SETTLE` s of frames and is gone, nothing new starts; her held effects — the
   * spells still up: a circle, a ward ring, a bolt in flight — fade out too and come back if the fight
   * finds them still up (`resume`).
   * @param {number} frameDt the frame's own seconds
   */
  settle(frameDt) {
    const live = this.fx.live;
    if (!this._settling) {
      this._settling = true;
      this._settleT = 0;
      // (the one-shots run out on the frame's time: none may outlive the settle)
      for (let i = 0; i < live.length; i++) {
        const r = live[i];
        if (r.life === Infinity) continue;
        r.fadeIn = 0;
        r.fadeOut = Math.max(1e-3, Math.min(SETTLE, r.life - r.t));
        r.life = r.t + r.fadeOut;
      }
    }
    this._settleT += frameDt;
    for (let i = live.length - 1; i >= 0; i--) {
      const r = live[i];
      if (r.life === Infinity) continue;
      r.t += frameDt;
      if (r.t >= r.life) this.fx.kill(r);
    }
    this._show = Math.max(0, Math.min(this._show, 1 - this._settleT / SETTLE));
    this.overlay(true);
    this._write();
  }

  /**
   * Her quads written into the batch (once a frame; a settle writes again): every tint dimmed after
   * dark (the night's higher exposure would whiten the gold), her held quads × `_show`.
   */
  _write() {
    const cfx = this.sys.fx;
    const live = this.fx.live;
    const show = this._show;
    const save = this._alphaSave;
    if (show < 1) {
      save.length = 0;
      for (let i = 0; i < live.length; i++) {
        const r = live[i];
        save.push(r.alpha);
        if (r.life === Infinity) r.alpha *= show;
      }
    }
    this.fx.write(cfx ? cfx.viewX : 0, cfx ? cfx.viewZ : -1, 1 - NIGHT_DIM * globalUniforms.uNight.value);
    if (show < 1) for (let i = 0; i < live.length; i++) live[i].alpha = save[i];
  }

  /**
   * Every light of hers given back at once, her spells going on unlit (the death reset, a rest —
   * `HolyStage.dropLights`); the ward's look ends with the ward (CombatSystem drops it), the
   * heroes' pulses and the raise's warmth with the highlights.
   */
  dropLights() {
    this._release(this._field, null);
    this._release(this._minor, null);
    for (const fl of this._fields) if (fl.on) fl.unlit = true;
    for (const b of this._bolts) b.unlit = true;
    this._sparks.length = 0;
    for (const w of this._wards) this._endWard(w);
    this._wards.length = 0;
    this._pulses.length = 0;
    if (this._raise) {
      this._raise.unlit = true;
      this._raise.k = 0;
    }
  }

  /** Her fight is released (MemberCombat.release): everything gone, out of the stage. */
  dispose() {
    this.clear();
    this.stage.drop(this);
  }

  /** Lights of hers held now. */
  heldLights() {
    return (this._field.light?.held ? 1 : 0) + (this._minor.light?.held ? 1 : 0);
  }

  // ------------------------------------------------------------------------------------------
  // Her two light slots
  // ------------------------------------------------------------------------------------------

  /**
   * An effect of hers takes its slot's light: over from an older effect of hers if the slot holds
   * one, else a VFX light (World.acquireSpellLight; a `minor` one only from a free light).
   * @param {LightSlot} slot
   * @param {object} who
   * @param {boolean} [ask] may ask the lights for one (false: only a takeover)
   * @returns {boolean} lit by it from now on
   */
  _take(slot, who, ask = true) {
    if (slot.light && !slot.light.held) {
      slot.light = null;
      slot.who = null;
    }
    if (slot.light) {
      slot.who = who;
      return true;
    }
    if (!ask) return false;
    const w = this.sys.world;
    const l = w && typeof w.acquireSpellLight === 'function' ? w.acquireSpellLight(slot.minor ? { minor: true } : undefined) : null;
    const L = this.lights;
    if (l) {
      L.acquired++;
      if (slot.minor) L.minor++;
      else L.field++;
    } else {
      L.refused++;
      if (slot.minor) L.minorRefused++;
      else L.fieldRefused++;
    }
    slot.light = l;
    slot.who = l ? who : null;
    slot.I = 0;
    return !!l;
  }

  /**
   * An effect lights its slot's light, if the slot is still its own (a dead handle — taken over by
   * a spell of another hero, a travel — is dropped).
   * @param {LightSlot} slot
   * @param {object} who
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number[]} color
   * @param {number} I with its day factors (capped at `LIGHT.cap`)
   * @param {number} distance
   * @param {number} [decay]
   */
  _lit(slot, who, x, y, z, color, I, distance, decay = 1) {
    if (slot.who !== who || !slot.light) return;
    if (!slot.light.held) {
      slot.light = null;
      slot.who = null;
      slot.I = 0;
      return;
    }
    // (never low: a warm light near the pale ground whitens it — COMBAT_VFX.md §7.2)
    const g = this.sys.groundAt(x, z);
    if (y < g + LIGHT.minLift) y = g + LIGHT.minLift;
    if (y - g < this.lights.lowest) this.lights.lowest = +(y - g).toFixed(3);
    const lp = this._lightP;
    lp.color = color;
    lp.intensity = Math.min(LIGHT.cap, Math.max(0, I));
    lp.distance = distance;
    lp.decay = decay;
    slot.light.set(x, y, z, lp);
    slot.I = lp.intensity;
  }

  /**
   * An effect is done with its slot: the light goes back to an older effect of hers still up that
   * wants it (Sanctuary under a bolt, a Judgement under a raise), else it is given back.
   * @param {LightSlot} slot
   * @param {object|null} who (null: whoever holds it)
   */
  _release(slot, who) {
    if (who !== null && slot.who !== who) return;
    const next = who === null ? null : this._heir(slot, who);
    if (next && slot.light && slot.light.held) {
      slot.who = next;
      return;
    }
    if (slot.light) {
      slot.light.off();
      slot.light.release();
    }
    slot.light = null;
    slot.who = null;
    slot.I = 0;
  }

  /**
   * An older effect of hers still up that would take the slot's light back.
   * @param {LightSlot} slot
   * @param {object} gone
   * @returns {object|null}
   */
  _heir(slot, gone) {
    for (const fl of this._fields) {
      if (!fl.on || fl.unlit || fl === gone) continue;
      if (slot.minor && fl.kind === 'sanctuary' && fl.t < LIGHT.sanctOut + LIGHT.sanctOutT) return fl;
      if (!slot.minor && fl.kind === 'judgement' && fl.t < LIGHT.outT) return fl;
    }
    const r = this._raise;
    if (!slot.minor && r && r !== gone && r.phase === 'charge') return r;
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // Hooks (MemberCombat)
  // ------------------------------------------------------------------------------------------

  /**
   * A wind-up beat: Holy Bolt's at its frame 4, a skill's every 6th frame before it takes effect —
   * light (Sanctuary: life) gathering at her staff's sun.
   * @param {'holyBolt'|'judgement'|'sanctuary'} id
   */
  gather(id) {
    const c = this._sunAt();
    this.sys.burst(id === 'sanctuary' ? 'lifeMotes' : 'holyMotes', c.x, c.y, c.z, 3);
  }

  /**
   * A move takes effect (the bolt leaves the staff, a spell lands, Mend heals, the fallen rises):
   * the sun flashes, a burst of rays at the staff.
   * @param {'holyBolt'|'judgement'|'sanctuary'|'mend'|'revive'} move
   */
  _released(move) {
    this._kick = GLOW[move].flash;
    const c = this._sunAt();
    const life = move === 'mend' || move === 'sanctuary';
    this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, scale: 0.55, color: life ? LIFE.lit : HOLY.star, life: 0.16, fadeOut: 0.14, frames: [1], back: -0.25, halo: 1 });
    this.sys.burst(life ? 'lifeMotes' : 'holySpark', c.x, c.y, c.z, 4);
  }

  /** A Holy Bolt leaves the staff (`_launch`): its orb and haloed core, a small light riding it. @param {Missile} ms */
  launch(ms) {
    this._released('holyBolt');
    const body = this.fx.add({ frame: 'partyHolyOrb', mode: 'billboard', x: ms.x, y: ms.y, z: ms.z, scale: 1.2, color: HOLY.orb, life: Infinity, loop: true });
    const core = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: ms.x, y: ms.y, z: ms.z, scale: 0.5, color: HOLY.star, life: Infinity, frames: [0], spin: 6, back: LIT_BACK, halo: 1 });
    const b = { ms, body, core, unlit: false };
    this._bolts.push(b);
    this._take(this._minor, b);
  }

  /** Its trail, every 0.05 s of flight (`_stepMissile`). @param {Missile} ms */
  trail(ms) {
    this.sys.burst('holyTrail', ms.x, ms.y, ms.z, 1);
  }

  /**
   * A Holy Bolt ends (`_endMissile`): where it struck, a burst of rays (haloed, behind the foe),
   * a splash ring on the ground the size of its splash and a spark of its light; else it fades
   * into motes.
   * @param {Missile} ms
   * @param {boolean} hit
   */
  boltEnd(ms, hit) {
    const i = this._bolts.findIndex((b) => b.ms === ms);
    /** @type {Bolt|null} */
    let b = null;
    if (i >= 0) {
      b = this._bolts[i];
      this.fx.kill(b.body);
      this.fx.kill(b.core);
      this._bolts.splice(i, 1);
    }
    const sys = this.sys;
    if (!hit) {
      sys.burst('holyMotes', ms.x, ms.y, ms.z, 3);
      if (b) this._release(this._minor, b);
      return;
    }
    const B = /** @type {VqCasterKit} */ (this.mc.kit).basic;
    const g = sys.groundAt(ms.x, ms.z);
    this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: ms.x, y: ms.y - 0.1, z: ms.z, scale: 0.8, color: HOLY.burst, life: 0.26, frames: [1, 1, 2, 3], back: 0.2, halo: 1 });
    this.fx.add({ frame: 'partySunburst', mode: 'flat', x: ms.x, y: g + FLAT_LIFT + 0.02, z: ms.z, size: (B.splash?.r ?? 1) * 2, color: HOLY.ring, life: 0.3, fadeOut: 0.2, frames: [2], alpha: 0.55, soft: 0.3 });
    sys.burst('holySpark', ms.x, ms.y, ms.z, 5);
    sys.burst('holyMotes', ms.x, ms.y, ms.z, 2);
    // the bolt's light becomes the impact's spark (a free light, if it had none)
    const s = { x: ms.x, y: g + LIGHT.minLift, z: ms.z, t: this._fclock, kind: /** @type {'impact'} */ ('impact') };
    if (b && this._minor.who === b) this._minor.who = s;
    else if (!b?.unlit) this._take(this._minor, s);
    if (this._minor.who === s) this._sparks.push(s);
  }

  /**
   * A spell opens on the ground (`_openFx`: Judgement, Sanctuary): its glyph, the glow disc or the
   * opening bloom, the light; Sanctuary's ward look on every hero. Timed from here on its own clock.
   * @param {Field} mf
   */
  open(mf) {
    const kind = mf.kind === 'sanctuary' ? 'sanctuary' : 'judgement';
    this._released(kind);
    let fl = this._fields.find((q) => !q.on);
    if (!fl) {
      fl = this._fields[0];
      for (const q of this._fields) if (q.t > fl.t) fl = q;
      this._closeField(fl);
    }
    const kit = /** @type {VqCasterKit} */ (this.mc.kit);
    const sys = this.sys;
    fl.on = true;
    fl.kind = kind;
    fl.src = mf;
    fl.x = mf.x;
    fl.y = mf.y;
    fl.z = mf.z;
    fl.a = mf.a;
    fl.t = 0;
    fl.fx.length = 0;
    fl.rot = mf.a;
    fl.sig = 0;
    fl.due.fill(-1);
    fl.stars.fill(null);
    fl.inhaled = false;
    fl.payT = -1;
    fl.ascended = false;
    fl.mote = 0.1;
    fl.ticks.length = 0;
    fl.flash0 = -1;
    fl.ring = null;
    fl.unlit = false;
    fl.ask = 0;
    const y = fl.y + FLAT_LIFT;
    const fx = this.fx;
    if (kind === 'judgement') {
      const S = kit.skill;
      for (let n = 0; n < 6; n++) {
        const a = fl.a + (n * Math.PI * 2) / S.pillars;
        const p = fl.spots[n];
        p.x = fl.x + Math.cos(a) * S.ring;
        p.z = fl.z + Math.sin(a) * S.ring;
        p.y = sys.groundAt(p.x, p.z);
      }
      for (let i = 0; i < 3; i++) fl.glyphRgb[i] = HOLY.glyph[i];
      // (the glow disc fills under the glyph until the payoff, then it is spent)
      fl.disc = this._keep(fl, fx.add({ frame: 'partyIceGlow', mode: 'flat', x: fl.x, y: y - 0.03, z: fl.z, size: 1.4, sizeTo: S.r * 2, grow: 0.45, rot: fl.a, color: fl.discRgb, life: Infinity, alpha: 0, soft: 0.85 }));
      fl.glyph = this._keep(fl, fx.add({ frame: 'partyGlyphHoly', mode: 'flat', x: fl.x, y, z: fl.z, size: 1.6, sizeTo: S.r * 2, grow: 0.3, rot: fl.a, color: fl.glyphRgb, life: Infinity, alpha: 0 }));
      this._take(this._field, fl);
    } else {
      const S = kit.skill2;
      for (let i = 0; i < 3; i++) fl.glyphRgb[i] = LIFE.rim[i];
      for (let i = 0; i < 3; i++) fl.discRgb[i] = LIFE.disc[i];
      // (the circle blooms open, then only its lines stay: no disc under the melee for 4 s)
      fl.disc = this._keep(fl, fx.add({ frame: 'partyIceGlow', mode: 'flat', x: fl.x, y: y - 0.03, z: fl.z, size: 3, sizeTo: S.r * 2, grow: SANCT.bloomT, color: fl.discRgb, life: Infinity, alpha: 0, soft: 0.85 }));
      fl.glyph = this._keep(fl, fx.add({ frame: 'partyGlyphHoly', mode: 'flat', x: fl.x, y, z: fl.z, size: 2.4, sizeTo: S.r * 2, grow: 0.45, rot: fl.a, spin: 0.35, color: fl.glyphRgb, life: Infinity, alpha: 0 }));
      // (its edge: one continuous ring, its crest — the frame's brightest texels — on the circle's radius:
      // the circle reads at the play camera by day, where the glyph's fine lines dither into specks)
      fl.ring = this._keep(fl, fx.add({ frame: 'partyRing', mode: 'flat', x: fl.x, y: y + 0.01, z: fl.z, size: 2.4, sizeTo: (S.r * 2) / SANCT.ringR, grow: 0.45, rot: fl.a, spin: 0.2, color: LIFE.rim, life: Infinity, frames: [0], alpha: 0 }));
      this._wardLook(S.wardFor);
      this._take(this._minor, fl);
    }
  }

  /**
   * A spell on the ground closes (`_closeField`, MemberCombat's record `mf`): its look goes too.
   * @param {Field} mf
   */
  closed(mf) {
    const fl = this._mirror(mf);
    if (fl) this._closeField(fl);
  }

  /**
   * One of Judgement's pillars comes down (`_stepJudgement`, after its hit): a thin bright core at
   * once, its body two frames later, a flare at its foot, a pulse of the light.
   * @param {Field} mf
   * @param {number} n the pillar (0 …)
   * @param {number} x
   * @param {number} y the ground
   * @param {number} z
   */
  pillar(mf, n, x, y, z) {
    const fl = this._mirror(mf);
    if (!fl) return;
    fl.t = mf.t;
    const i = Math.min(5, Math.max(0, n));
    fl.spots[i].x = x;
    fl.spots[i].y = y;
    fl.spots[i].z = z;
    const k = this._nearScale(fl, x, z);
    // (transient quads: left to their life, never held — SpellFx pools a spent record for the next)
    this.fx.add({ frame: 'partyPillar', mode: 'billboard', x, y, z, foot: 1, scale: JUDG.scale * k, color: HOLY.core, life: JUDG.coreLife, fadeOut: JUDG.coreFade, frames: [0], back: 0.12, halo: 1 });
    this.fx.add({ frame: 'partySunburst', mode: 'flat', x, y: y + FLAT_LIFT + 0.02, z, scale: 0.6, scaleTo: 1.1, grow: 0.25, color: HOLY.ring, life: 0.3, fadeOut: 0.15, frames: [1] });
    fl.due[i] = fl.t + JUDG.bodyDelay;
    fl.ticks.push(this._fclock);
    this.sys.burst('holySpark', x, y + 0.4, z, 3);
  }

  /**
   * Judgement's great pillar (`_stepJudgement`, after its hit: the move's hit-stop holds this
   * frame): the column just beyond the centre, its core, the ground flare and the ring, a burst of
   * rays behind the foe there, the flash; burn marks where the pillars stood.
   * @param {Field} mf
   */
  payoff(mf) {
    const fl = this._mirror(mf);
    const sys = this.sys;
    const F2 = /** @type {VqCasterKit} */ (this.mc.kit).skill.final;
    if (!fl) return;
    fl.t = mf.t;
    fl.payT = fl.t;
    // (its light's flash after the hit-stop, on the frame's own time: `_judgementLook`)
    fl.flash0 = -2;
    for (let i = 0; i < 6; i++) {
      this._drop(fl, fl.stars[i]);
      fl.stars[i] = null;
    }
    const cfx = sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    // (just beyond the centre, away from the camera: it frames the foe there, never hides it)
    const bx = fl.x + vx * JUDG.bigBack;
    const bz = fl.z + vz * JUDG.bigBack;
    const by = sys.groundAt(bx, bz);
    const fx = this.fx;
    // (the wide column is the payoff only — its hit-stop and 0.1 s —, then it thins through the hold:
    // its rays, breaking; its light settles: `bigRgb`)
    for (let i = 0; i < 3; i++) fl.bigRgb[i] = HOLY.bodyBig[i];
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: bx, y: by, z: bz, foot: 1, scale: JUDG.bigScale, color: fl.bigRgb, life: JUDG.bigLife, fadeOut: 0.25, frames: [1, 2, 3, 3, 3, 3], back: 0.2 });
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: bx, y: by, z: bz, foot: 1, scale: JUDG.bigScale, color: HOLY.core, life: 0.45, fadeOut: 0.2, frames: [0], back: 0.2 + LIT_BACK, halo: 1 });
    fx.add({ frame: 'partySunburst', mode: 'flat', x: fl.x, y: fl.y + FLAT_LIFT + 0.03, z: fl.z, size: 3, sizeTo: 5, grow: 0.3, color: HOLY.ring, life: 0.35, fadeOut: 0.2, frames: [1], alpha: 0.6 });
    fx.add({ frame: 'partyRing', mode: 'flat', x: fl.x, y: fl.y + FLAT_LIFT + 0.04, z: fl.z, size: 2, sizeTo: F2.r * 2.1, grow: 0.35, color: HOLY.ring, life: 0.45, fadeOut: 0.2, fps: 0, alpha: RING_A, soft: 0.3 });
    fx.add({ frame: 'partySunburst', mode: 'billboard', x: bx, y: by + JUDG.burstY, z: bz, scale: 1.0, color: HOLY.burst, life: 0.3, fadeOut: 0.12, frames: [1], back: JUDG.burstBack, halo: 1 });
    if (this._decorOk()) {
      for (let i = 0; i < 6; i++) {
        const p = fl.spots[i];
        fx.add({ frame: 'partySunburst', mode: 'flat', x: p.x, y: p.y + FLAT_LIFT + 0.01, z: p.z, scale: 0.9, rot: fl.a + i, color: HOLY.glyph, life: JUDG.burnLife, fadeOut: JUDG.burnFade, frames: [3], alpha: 0.5 });
      }
    }
    sys.burst('holySpark', bx, by + 0.6, bz, 8);
    sys.burst('holyMotes', bx, by + 0.3, bz, 5);
    // the light: the flash (lit this very frame), held by the hit-stop — unless its lights were given back
    if (!fl.unlit) this._take(this._field, fl);
  }

  /**
   * A hero inside Sanctuary at one of its ticks (`_stepSanctuary`, after its heal; in heal order:
   * the player, then the members): the heal's glow, and a pulse of life on its sprite if it healed.
   * @param {Field} mf
   * @param {{ x: number, y: number, z: number }} q the hero's position
   * @param {number} n HP it got (0: already full)
   */
  healed(mf, q, n) {
    this.sys.burst('healGlow', q.x, q.y + 0.9, q.z, 5);
    if (n > 0) this._pulse(this._heroAt(q), HL.heal, HL.healA, HL.healT);
  }

  /**
   * Sanctuary's tick, after the heroes inside it healed (`_stepSanctuary`): a ring of life runs
   * out over the circle, light rises from its rim, the light pulses.
   * @param {Field} mf
   */
  tick(mf) {
    const fl = this._mirror(mf);
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill2;
    const sys = this.sys;
    if (fl) {
      fl.t = mf.t;
      fl.ticks.push(this._fclock);
      this.fx.add({ frame: 'partyRing', mode: 'flat', x: fl.x, y: fl.y + FLAT_LIFT + 0.03, z: fl.z, size: 1.5, sizeTo: S.r * 2, grow: 0.35, color: LIFE.rim, life: 0.42, fadeOut: 0.18, fps: 0, frames: [0], alpha: SANCT.ringA, soft: 0.3 });
    }
    for (let k = 0; k < 4; k++) {
      const a = mf.a + mf.n * 0.7 + (k * Math.PI) / 2;
      const x = mf.x + Math.cos(a) * S.r * 0.75;
      const z = mf.z + Math.sin(a) * S.r * 0.75;
      sys.burst('lifeRise', x, sys.groundAt(x, z) + 0.15, z, 2);
    }
    sys.burst('lifeRise', mf.x, mf.y + 0.15, mf.z, 3);
  }

  /**
   * Mend lands (`_frameMend` at its frame, after the heal): a green column of light on the one
   * healed, a ring at its feet, its sprite's pulse, a light falling over it.
   * @param {{ x: number, y: number, z: number }|null} q the healed one (null: nobody alive to heal)
   */
  mended(q) {
    this._killTether();
    const sys = this.sys;
    if (!q) {
      const c = this._sunAt();
      sys.burst('lifeMotes', c.x, c.y, c.z, 3);
      return;
    }
    this._released('mend');
    const y = sys.groundAt(q.x, q.z);
    const fx = this.fx;
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: q.x, y, z: q.z, foot: 1, scale: 0.6, color: LIFE.body, life: 0.4, fadeOut: 0.18, frames: [1, 2, 3], back: 0.3, alpha: 0.85 });
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: q.x, y, z: q.z, foot: 1, scale: 0.6, color: LIFE.core, life: 0.25, fadeOut: 0.1, frames: [0], back: 0.3 + LIT_BACK, halo: 1 });
    fx.add({ frame: 'partyWardRing', mode: 'flat', x: q.x, y: y + FLAT_LIFT, z: q.z, size: 0.6, sizeTo: 1.6, grow: 0.25, color: LIFE.body, life: 0.35, fadeOut: 0.15, alpha: 0.6, soft: 0.3 });
    sys.burst('lifeRise', q.x, y + 0.2, q.z, 6);
    sys.burst('healGlow', q.x, q.y + 0.9, q.z, 3);
    this._pulse(this._heroAt(q), HL.heal, HL.healA, HL.healT);
    const s = { x: q.x, y: y + LIGHT.mendLift, z: q.z, t: this._fclock, kind: /** @type {'mend'} */ ('mend') };
    if (this._take(this._minor, s)) this._sparks.push(s);
  }

  /** Mend fizzles (`_frameMend`: nobody needs it any more; the MP back): the tether rises off her sun. */
  fizzled() {
    this._killTether();
    const c = this._sunAt();
    this.sys.burst('lifeMotes', c.x, c.y, c.z, 3);
  }

  /**
   * The raise begins (`_frameRevive` frame 2): a glyph and a disc filling under the fallen, a light
   * gathering over it.
   * @param {MemberCombat} who
   */
  raiseStart(who) {
    this._raiseOut(true);
    const q = who.position;
    const sys = this.sys;
    const g = sys.groundAt(q.x, q.z);
    /** @type {Raise} */
    const r = { who, glyph: null, disc: null, discRgb: [0, 0, 0], phase: 'charge', t: 0, f0: 0, from: 0, k: 0, ascended: false, x: q.x, y: g, z: q.z, unlit: false };
    r.disc = this.fx.add({ frame: 'partyIceGlow', mode: 'flat', x: q.x, y: g + FLAT_LIFT - 0.03, z: q.z, size: 0.6, sizeTo: 1.8, grow: 0.8, color: r.discRgb, life: Infinity, alpha: 0, soft: 0.85 });
    r.glyph = this.fx.add({ frame: 'partyGlyphHoly', mode: 'flat', x: q.x, y: g + FLAT_LIFT, z: q.z, size: 0.8, sizeTo: 1.8, grow: 0.5, spin: 0.8, color: HOLY.glyph, life: Infinity, alpha: 0 });
    this._raise = r;
    this._take(this._field, r);
  }

  /** A beat of the raise's charge (`_frameRevive`, every 8th frame before it lands). @param {MemberCombat} who */
  raiseMote(who) {
    const q = who.position;
    this.sys.burst('holyMotes', q.x, q.y + 0.4, q.z, 3);
  }

  /**
   * The fallen is raised (`_frameRevive`, after `who.revive`): a pillar of light, its core, a flare
   * on the ground, the light's flash, the raised one's pulse of life, rising light.
   * @param {MemberCombat} who
   */
  raised(who) {
    this._released('revive');
    const sys = this.sys;
    const q = who.position;
    const y = sys.groundAt(q.x, q.z);
    const fx = this.fx;
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: q.x, y, z: q.z, foot: 1, scale: 1.0, color: HOLY.body, life: 0.6, fadeOut: 0.25, frames: [1, 1, 2, 3], back: 0.3 });
    fx.add({ frame: 'partyPillar', mode: 'billboard', x: q.x, y, z: q.z, foot: 1, scale: 1.0, color: HOLY.core, life: 0.3, fadeOut: 0.12, frames: [0], back: 0.3 + LIT_BACK, halo: 1 });
    fx.add({ frame: 'partySunburst', mode: 'flat', x: q.x, y: y + FLAT_LIFT + 0.02, z: q.z, size: 1.2, sizeTo: 2.6, grow: 0.3, color: HOLY.ring, life: 0.35, fadeOut: 0.2, frames: [1], alpha: 0.6 });
    sys.burst('lifeRise', q.x, y + 0.3, q.z, 14);
    sys.burst('holySpark', q.x, y + 1.0, q.z, 10);
    this._pulse(who, HL.heal, HL.raisedA, HL.raisedT);
    const r = this._raise;
    if (r && r.who === who && r.phase === 'charge') {
      r.phase = 'raised';
      r.t = 0;
      r.f0 = this._fclock;
      if (!r.unlit) this._take(this._field, r);
    }
  }

  /** The raise fails (`_frameRevive`: the fallen got up or left before it landed; half the MP back): it burns out. */
  raiseFailed() {
    this._raiseOut(false);
  }

  // ------------------------------------------------------------------------------------------
  // The spells' parts
  // ------------------------------------------------------------------------------------------

  /**
   * A quad the field holds on to (its glyph, its disc, the inhale's stars): `life: Infinity` only —
   * SpellFx pools a spent record for the next effect, so a held quad must never die by its life;
   * killed by `_drop` or with the field.
   * @param {HolyField} fl @param {FxRec|null} r @returns {FxRec|null}
   */
  _keep(fl, r) {
    if (r) fl.fx.push(r);
    return r;
  }

  /** A held quad of the field goes now (out of its list: never killed twice). @param {HolyField} fl @param {FxRec|null} r */
  _drop(fl, r) {
    if (!r) return;
    const i = fl.fx.indexOf(r);
    if (i >= 0) {
      fl.fx[i] = fl.fx[fl.fx.length - 1];
      fl.fx.pop();
    }
    this.fx.kill(r);
  }

  /** The look of MemberCombat's field `mf`, or null. @param {Field} mf */
  _mirror(mf) {
    for (const fl of this._fields) if (fl.on && fl.src === mf) return fl;
    return null;
  }

  /** @param {HolyField} fl */
  _closeField(fl) {
    for (const r of fl.fx) this.fx.kill(r);
    fl.fx.length = 0;
    fl.glyph = null;
    fl.disc = null;
    fl.ring = null;
    fl.stars.fill(null);
    fl.due.fill(-1);
    for (let i = this._motes.length - 1; i >= 0; i--) {
      if (this._motes[i].fl !== fl) continue;
      this.fx.kill(this._motes[i].rec);
      this._motes.splice(i, 1);
    }
    fl.on = false;
    fl.src = null;
    if (this._field.who === fl) this._release(this._field, fl);
    if (this._minor.who === fl) this._release(this._minor, fl);
  }

  /** Room left in the FX batch for decor (motes, ward stars, burn marks, inhale stars). */
  _decorOk() {
    const q = this.sys.quads;
    return !!q && q.capacity - q.count >= DECOR_FREE;
  }

  /**
   * A pillar's scale at (x, z): lower on the camera's side of the ring (the foes inside stay in view).
   * @param {HolyField} fl
   * @param {number} x
   * @param {number} z
   */
  _nearScale(fl, x, z) {
    const cfx = this.sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    const dx = x - fl.x;
    const dz = z - fl.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * vx + dz * vz) / d < JUDG.nearDot ? JUDG.near : 1;
  }

  /**
   * Does an upright quad at (x, z) stand in front of a foe or a hero as the camera sees it (within
   * `JUDG.screenSide` u across, 0 … `screenDepth` u behind it)? Positions read only.
   * @param {number} x
   * @param {number} z
   */
  _screens(x, z) {
    const sys = this.sys;
    const cfx = sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    /** @type {(p: { x: number, z: number }) => boolean} */
    const behind = (p) => {
      const dx = p.x - x;
      const dz = p.z - z;
      const depth = dx * vx + dz * vz;
      return depth > -0.3 && depth < JUDG.screenDepth && Math.abs(dx * vz - dz * vx) < JUDG.screenSide;
    };
    if (behind(sys.player.position)) return true;
    for (const a of sys.allies) if (a.present && behind(a.position)) return true;
    const list = sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive && e.sprite.visible && behind(e.position)) return true;
    }
    return false;
  }

  /**
   * Sanctuary's ward on every hero up: a ring of the circle's green turning under each (following
   * it, 6 s), three life stars circling it and a gold shimmer on its sprite for the first moments
   * (gold: the heal pulse is the green one).
   * @param {number} seconds
   */
  _wardLook(seconds) {
    const sys = this.sys;
    for (const w of this._wards) this._endWard(w);
    this._wards.length = 0;
    /** @type {(who: 'player'|MemberCombat, q: { x: number, y: number, z: number }, scale: number) => void} */
    // (held quads: `life: Infinity`, faded and killed here — `_wardsLook`)
    const add = (who, q, scale) => {
      const ring = this.fx.add({ frame: 'partyWardRing', mode: 'flat', x: q.x, y: q.y + FLAT_LIFT, z: q.z, follow: q, scale, spin: 1.2, color: LIFE.rim, life: Infinity, alpha: 0 });
      /** @type {(FxRec|null)[]} */
      const stars = [null, null, null];
      if (this._decorOk()) {
        for (let k = 0; k < 3; k++) stars[k] = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: q.x, y: q.y + 0.4, z: q.z, scale: 0.18, color: LIFE.lit, life: Infinity, frames: [0], spin: 3, alpha: 0, halo: 1 });
      }
      this._wards.push({ who, ring, stars, age: 0, ph: this.rng.next() * Math.PI * 2, T: seconds });
    };
    add('player', sys.player.position, 1.05);
    for (const a of sys.allies) if (a.present) add(a, a.position, 0.95);
  }

  /** @param {Ward} w */
  _endWard(w) {
    this.fx.kill(w.ring);
    w.ring = null;
    for (let k = 0; k < 3; k++) {
      this.fx.kill(w.stars[k]);
      w.stars[k] = null;
    }
  }

  /**
   * A hero's sprite pulse (setHighlight, through the stage): `rgb` at `a`, falling to 0 over `T` s.
   * @param {'player'|MemberCombat|null} who
   * @param {readonly number[]} rgb
   * @param {number} a
   * @param {number} T
   */
  _pulse(who, rgb, a, T) {
    if (!who) return;
    for (const p of this._pulses) {
      if (p.who !== who) continue;
      p.rgb = rgb;
      p.a = a;
      p.T = T;
      p.age = 0;
      return;
    }
    this._pulses.push({ who, rgb, a, T, age: 0 });
  }

  /**
   * The hero standing at a position object (the player's, a member's: MemberCombat hands those).
   * @param {{ x: number, y: number, z: number }} q
   * @returns {'player'|MemberCombat|null}
   */
  _heroAt(q) {
    const sys = this.sys;
    if (q === sys.player.position) return 'player';
    for (const a of sys.allies) if (a.position === q) return a;
    return null;
  }

  /** @param {'player'|MemberCombat} who */
  _spriteOf(who) {
    return who === 'player' ? this.sys.player.sprite : who.member.sprite;
  }

  /** @param {'player'|MemberCombat} who @returns {{ x: number, y: number, z: number }} */
  _posOf(who) {
    return who === 'player' ? this.sys.player.position : who.position;
  }

  /** Mend's tether stars gone. */
  _killTether() {
    for (let i = 0; i < 3; i++) {
      if (this._tether[i]) this.fx.kill(this._tether[i]);
      this._tether[i] = null;
    }
  }

  /**
   * The raise ends without a raise (interrupted, failed, a new one): its glyph burns out, its disc
   * goes, its light fades.
   * @param {boolean} [now] at once (a new raise replaces it)
   */
  _raiseOut(now = false) {
    const r = this._raise;
    if (!r) return;
    if (now) {
      this.fx.kill(r.glyph);
      this.fx.kill(r.disc);
      if (this._field.who === r) this._release(this._field, r);
      this._raise = null;
      return;
    }
    if (r.phase !== 'charge') return;
    r.phase = 'out';
    r.t = 0;
    r.from = r.k;
  }

  // ------------------------------------------------------------------------------------------
  // Per sub-step, per frame
  // ------------------------------------------------------------------------------------------

  /** @param {number} h combat seconds of the sub-step (MemberCombat._stepHero) */
  step(h) {
    for (const fl of this._fields) {
      if (!fl.on) continue;
      // (her move's field and its look run on the same clock: MemberCombat stepped it already)
      fl.t = fl.src && fl.src.on ? fl.src.t : fl.t + h;
      if (fl.kind === 'judgement') this._stepJudgement(fl, h);
      else this._stepSanctuary(fl, h);
    }
    this._stepMotes(h);
    const r = this._raise;
    if (r && r.phase !== 'charge') {
      r.t += h;
      if (r.phase === 'raised' && !r.ascended && r.t >= 0.2) {
        r.ascended = true;
        this.sys.burst('holyAscend', r.x, r.y + 1.7, r.z, 8);
      }
    }
    for (const w of this._wards) w.age += h;
    for (let i = this._pulses.length - 1; i >= 0; i--) {
      const p = this._pulses[i];
      p.age += h;
      if (p.age >= p.T) this._pulses.splice(i, 1);
    }
    this.fx.step(h);
  }

  /**
   * Judgement on its clock: the sigils light where the pillars will fall, the pillars' bodies two
   * frames after their cores, the inhale's stars, the release's ascent.
   * @param {HolyField} fl
   * @param {number} h
   */
  _stepJudgement(fl, h) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill;
    const fx = this.fx;
    const t = fl.t;
    // the glyph's turn: faster in the inhale, settling after the payoff
    let spin = JUDG.spin;
    if (fl.payT < 0) spin += (JUDG.spinIn - JUDG.spin) * smooth((t - JUDG.inhaleAt) / JUDG.inhaleT);
    else spin += (JUDG.spinIn - JUDG.spin) * Math.exp(-(t - fl.payT) / JUDG.spinOut);
    fl.rot += spin * h;
    while (fl.sig < S.pillars && t >= JUDG.sigilAt + fl.sig * S.every - 1e-6) {
      const n = fl.sig++;
      const p = fl.spots[n];
      const life = S.delay + n * S.every + JUDG.sigilAfter - t;
      fx.add({ frame: 'partyWardRing', mode: 'flat', x: p.x, y: p.y + FLAT_LIFT + 0.02, z: p.z, size: JUDG.sigilSize0, sizeTo: JUDG.sigilSize, grow: JUDG.sigilGrow, rot: fl.a + n, spin: 3, color: HOLY.glyph, life: Math.max(0.05, life), fadeOut: 0.1, alpha: 0.7 });
    }
    for (let n = 0; n < 6; n++) {
      if (fl.due[n] < 0 || t < fl.due[n] - 1e-6) continue;
      fl.due[n] = -1;
      const p = fl.spots[n];
      const k = this._nearScale(fl, p.x, p.z);
      const screened = this._screens(p.x, p.z);
      fx.add({ frame: 'partyPillar', mode: 'billboard', x: p.x, y: p.y, z: p.z, foot: 1, scale: JUDG.scale * k, color: HOLY.body, life: JUDG.bodyLife, fadeOut: JUDG.bodyFade, frames: [1, 2, 3], back: 0.15, alpha: screened ? JUDG.screenA : JUDG.bodyA });
    }
    // the inhale: stars slide in from the sigils (decor)
    if (!fl.inhaled && fl.payT < 0 && t >= JUDG.inhaleAt) {
      fl.inhaled = true;
      if (this._decorOk()) {
        for (let n = 0; n < 6; n++) {
          const p = fl.spots[n];
          fl.stars[n] = this._keep(fl, fx.add({ frame: 'partySunburst', mode: 'billboard', x: p.x, y: p.y + 0.3, z: p.z, scale: 0.35, color: HOLY.star, life: Infinity, frames: [0], spin: 4, back: -0.1, halo: 1 }));
        }
      }
    }
    // the release: the great pillar dissolves upward
    if (fl.payT >= 0 && !fl.ascended && t >= JUDG.ascendAt) {
      fl.ascended = true;
      const cfx = this.sys.fx;
      const bx = fl.x + (cfx ? cfx.viewX : 0) * JUDG.bigBack;
      const bz = fl.z + (cfx ? cfx.viewZ : -1) * JUDG.bigBack;
      this.sys.burst('holyAscend', bx, this.sys.groundAt(bx, bz) + 1.6, bz, 12);
    }
  }

  /**
   * Sanctuary on its clock: motes rising over the circle (decor), the ascent round its rim at the end.
   * @param {HolyField} fl
   * @param {number} h
   */
  _stepSanctuary(fl, h) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill2;
    const t = fl.t;
    const rng = this.rng;
    fl.mote -= h;
    if (t < S.duration - 0.4 && fl.mote <= 0) {
      fl.mote += SANCT.moteEvery;
      let n = 0;
      for (const m of this._motes) if (m.fl === fl) n++;
      if (n < SANCT.motes && this._decorOk()) {
        const a = rng.next() * Math.PI * 2;
        const r = S.r * SANCT.moteR * Math.sqrt(rng.next());
        const x = fl.x + Math.cos(a) * r;
        const z = fl.z + Math.sin(a) * r;
        const y = this.sys.groundAt(x, z) + 0.2;
        const rec = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x, y, z, scale: 0.2 + 0.1 * rng.next(), color: LIFE.lit, life: Infinity, frames: [0], spin: 2, alpha: 0, halo: 1 });
        if (rec) this._motes.push({ rec, fl, x, z, y, vy: 0.6 + 0.4 * rng.next(), ph: rng.next() * Math.PI * 2, age: 0, life: 1.2 + 0.6 * rng.next() });
      }
    }
    if (!fl.ascended && t >= SANCT.ascendAt) {
      fl.ascended = true;
      const sys = this.sys;
      for (let k = 0; k < 5; k++) {
        const a = fl.a + (k * Math.PI * 2) / 5;
        const x = fl.x + Math.cos(a) * S.r * 0.9;
        const z = fl.z + Math.sin(a) * S.r * 0.9;
        sys.burst('lifeAscend', x, sys.groundAt(x, z) + 0.4, z, 2);
      }
    }
  }

  /** Sanctuary's motes rise and sway; in and out in dither. @param {number} h */
  _stepMotes(h) {
    const list = this._motes;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.age += h;
      if (m.age >= m.life) {
        this.fx.kill(m.rec);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      m.y += m.vy * h;
      const r = m.rec;
      const s = 0.15 * Math.sin(m.ph + m.age * 3.1);
      r.x = m.x + s;
      r.y = m.y;
      r.z = m.z + 0.5 * s;
      r.alpha = clamp01(Math.min(m.age / 0.2, (m.life - m.age) / 0.4));
    }
  }

  /**
   * Once a frame (MemberCombat.afterFrame, after the combat moved): the bolts follow their
   * missiles, the spells' look (glyphs, discs, stars, lights), the raise, the tether, the wards,
   * the sun's charge and star, the heroes' highlights asked for, her quads written (dimmed after
   * dark).
   * @param {number} dt combat seconds of this frame (0 in hit-stop or while the combat waits: everything holds)
   */
  visuals(dt) {
    const sys = this.sys;
    // the bolts ride their missiles (and their light)
    for (let i = this._bolts.length - 1; i >= 0; i--) {
      const b = this._bolts[i];
      const ms = b.ms;
      if (!ms.on) {
        // (ended without its hook — never expected: the look goes)
        this.fx.kill(b.body);
        this.fx.kill(b.core);
        this._release(this._minor, b);
        this._bolts.splice(i, 1);
        continue;
      }
      placeOn(b.body, ms);
      placeOn(b.core, ms);
      this._lit(this._minor, b, ms.x, ms.y + 0.9, ms.z, LIGHT.holy, LIGHT.bolt * dayK(DAY.steady), LIGHT.boltDistance);
    }
    this._sparksLook();
    for (const fl of this._fields) {
      if (!fl.on) continue;
      if (fl.kind === 'judgement') this._judgementLook(fl);
      else this._sanctuaryLook(fl);
    }
    this._raiseLook(dt);
    this._tetherLook();
    this._wardsLook();
    this._chargeLook(dt);
    this._highlights();
    this._write();
  }

  /**
   * Judgement's look at its time: the glyph (fading in, turning, flaring at the payoff, burning out
   * from its rim), the glow disc filling then spent, the inhale's stars sliding in, the light.
   * @param {HolyField} fl
   */
  _judgementLook(fl) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill;
    const t = fl.t;
    const payT = S.delay + S.pillars * S.every + S.final.delay;
    const paid = fl.payT >= 0;
    const g = fl.glyph;
    if (g) {
      g.rot = fl.rot;
      g.spin = 0;
      const burn = smooth((t - JUDG.ascendAt) / JUDG.burnOut);
      g.alpha = GLYPH_A * clamp01(t / JUDG.glyphIn) * (1 - burn);
      g.soft = 0.9 * burn;
      const flare = paid ? 1 + JUDG.flare * (1 - smooth((t - fl.payT) / JUDG.flareT)) : 1;
      for (let i = 0; i < 3; i++) fl.glyphRgb[i] = HOLY.glyph[i] * flare;
    }
    if (paid) {
      const k = 1 - JUDG.bigSettle * smooth((t - fl.payT - 0.08) / 0.27);
      for (let i = 0; i < 3; i++) fl.bigRgb[i] = HOLY.bodyBig[i] * k;
    }
    const d = fl.disc;
    if (d) {
      const fill = smooth(t / payT);
      // (spent in the payoff: gone within `discOut` s, so it never veils the struck foes)
      const spent = paid ? 1 - smooth((t - fl.payT) / JUDG.discOut) : 1;
      const kk = 0.35 + 0.65 * fill;
      for (let i = 0; i < 3; i++) fl.discRgb[i] = HOLY.disc[i] * kk;
      d.alpha = JUDG.discA * fill * spent;
    }
    // the inhale's stars: from the sigils to the centre, low over the ground
    if (!paid) {
      const u = smooth((t - JUDG.inhaleAt) / JUDG.inhaleT);
      for (let n = 0; n < 6; n++) {
        const r = fl.stars[n];
        if (!r) continue;
        const p = fl.spots[n];
        r.x = p.x + (fl.x - p.x) * u;
        r.z = p.z + (fl.z - p.z) * u;
        r.y = p.y + (fl.y - p.y) * u + 0.3 + FLAT_LIFT * 0.5;
        r.alpha = u >= 1 ? 0 : 1;
      }
    }
    // the light: a charge over the glyph, a pulse per pillar, drawn down before the payoff's flash
    const slot = this._field;
    if (slot.who !== fl) return;
    const ds = dayK(DAY.steady);
    const df = dayK(DAY.flash);
    const fc = this._fclock;
    if (!paid) {
      let I;
      if (t < S.delay) I = LIGHT.chargeFrom + (LIGHT.charge - LIGHT.chargeFrom) * smooth(t / S.delay);
      else I = LIGHT.charge + (LIGHT.inhale - LIGHT.charge) * smooth((t - JUDG.inhaleAt) / JUDG.inhaleT);
      // (each pillar's pulse on the frame's own time)
      let P = 0;
      for (const tn of fl.ticks) if (fc >= tn) P += LIGHT.pulse * Math.exp(-(fc - tn) / LIGHT.pulseTau);
      this._lit(slot, fl, fl.x, fl.y + LIGHT.chargeLift, fl.z, LIGHT.holy, I * ds + P * df, LIGHT.chargeDistance);
    } else if (t >= LIGHT.outT) {
      this._release(slot, fl);
    } else {
      // the flash waits at the inhale's level through the move's hit-stop (the core's flash whitens
      // the struck foes all through it), then falls on the frame's own time
      if (fl.flash0 === -2 && !(this.sys.stop > 0)) fl.flash0 = fc;
      const f = fl.flash0 >= 0 ? Math.exp(-(fc - fl.flash0) / LIGHT.flashTau) : 0;
      const base = fl.flash0 === -2 ? LIGHT.inhale : LIGHT.hold;
      const out = 1 - smooth((t - LIGHT.outFrom) / (LIGHT.outT - LIGHT.outFrom));
      // (the flash's falloff gentle, the hold's the lamps': a glow from the light, no wash)
      const decay = LIGHT.holdDecay + (1 - LIGHT.holdDecay) * f;
      this._lit(slot, fl, fl.x, fl.y + LIGHT.flashLift, fl.z, LIGHT.holy, (base * ds + (LIGHT.flash - LIGHT.hold) * f * df) * out, LIGHT.flashDistance, decay);
    }
  }

  /**
   * Sanctuary's look at its time: the ward ring on its edge and the faint glyph inside (fading in,
   * burning out from their rims), the opening bloom, the dim life light swaying over it with a pulse
   * per tick (re-asked while lost).
   * @param {HolyField} fl
   */
  _sanctuaryLook(fl) {
    const t = fl.t;
    const burn = smooth((t - SANCT.burnAt) / SANCT.burnOut);
    const fadeIn = clamp01(t / SANCT.glyphIn);
    const g = fl.glyph;
    if (g) {
      g.alpha = SANCT.glyphA * fadeIn * (1 - burn);
      g.soft = 0.9 * burn;
    }
    const ring = fl.ring;
    if (ring) {
      ring.alpha = SANCT.ringA2 * fadeIn * (1 - burn);
      ring.soft = 0.9 * burn;
    }
    const d = fl.disc;
    if (d && t >= SANCT.bloomT) {
      this._drop(fl, d);
      fl.disc = null;
    } else if (d) d.alpha = SANCT.bloomA * Math.sin(Math.PI * clamp01(t / SANCT.bloomT));
    const slot = this._minor;
    if (fl.unlit || t >= LIGHT.sanctOut + LIGHT.sanctOutT) {
      if (slot.who === fl) this._release(slot, fl);
      return;
    }
    // (lost to a spell of another hero: asked again now and then, a free light only)
    if (slot.who !== fl && !slot.light && t >= fl.ask) {
      fl.ask = t + LIGHT.reask;
      this._take(slot, fl);
    }
    if (slot.who !== fl) return;
    const fc = this._fclock;
    let P = 0;
    for (const tk of fl.ticks) if (fc >= tk) P += LIGHT.tick * Math.exp(-(fc - tk) / LIGHT.tickTau);
    const I = (LIGHT.sanct * smooth(t / LIGHT.sanctRise) * dayK(DAY.steady) + P * dayK(DAY.flash)) * (1 - smooth((t - LIGHT.sanctOut) / LIGHT.sanctOutT));
    const a = t * LIGHT.sanctTurn;
    this._lit(slot, fl, fl.x + Math.cos(a) * LIGHT.sanctSway, fl.y + LIGHT.sanctLift, fl.z + Math.sin(a) * LIGHT.sanctSway, LIGHT.life, I, LIGHT.sanctDistance);
  }

  /** The short lights' fall (a bolt's impact, a Mend), on the frame's own time. */
  _sparksLook() {
    const list = this._sparks;
    const slot = this._minor;
    const df = dayK(DAY.flash);
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      const age = this._fclock - s.t;
      const T = s.kind === 'impact' ? LIGHT.impactT : LIGHT.mendT;
      if (age >= T || slot.who !== s) {
        this._release(slot, s);
        list.splice(i, 1);
        continue;
      }
      const k = 1 - age / T;
      if (s.kind === 'impact') this._lit(slot, s, s.x, s.y, s.z, LIGHT.holy, LIGHT.impact * k * k * df, LIGHT.impactDistance);
      else this._lit(slot, s, s.x, s.y, s.z, LIGHT.life, LIGHT.mend * k * k * df, LIGHT.mendDistance);
    }
  }

  /**
   * The raise's look: while she kneels the glyph and disc fill under the fallen, its sprite warms,
   * the light gathers; once raised the light flashes and falls; interrupted or failed, the glyph
   * burns out from its rim and the light fades.
   * @param {number} dt
   */
  _raiseLook(dt) {
    const r = this._raise;
    if (!r) return;
    const mc = this.mc;
    const R = /** @type {VqCasterKit} */ (mc.kit).revive;
    if (r.phase === 'charge') {
      // (an interrupted raise — a stagger, a knockdown, her fall — ends by itself)
      if (mc.move !== 'revive' || mc.down) this._raiseOut(false);
    }
    const slot = this._field;
    const q = r.who.position;
    if (r.phase === 'charge') {
      r.k = smooth((mc.t - F(2)) / F(R.at - 2));
      const k = r.k;
      if (r.glyph) {
        r.glyph.alpha = 0.6 * clamp01((mc.t - F(2)) / 0.25);
        r.glyph.soft = 0;
      }
      if (r.disc) {
        for (let i = 0; i < 3; i++) r.discRgb[i] = HOLY.disc[i] * k;
        r.disc.alpha = 0.45 * k;
      }
      this._lit(slot, r, r.x, r.y + LIGHT.raiseLift, r.z, LIGHT.holy, (LIGHT.raiseFrom + (LIGHT.raise - LIGHT.raiseFrom) * k) * dayK(DAY.steady), LIGHT.raiseDistance);
      if (!r.unlit && !r.who.gone) this.stage.highlight(this._spriteOf(r.who), HL.raise, HL.raiseA * k, this);
      return;
    }
    const t = r.t;
    const out = r.phase === 'out';
    const burnT = out ? 0.3 : 0.35;
    const burn = smooth(t / burnT);
    if (r.glyph) {
      r.glyph.alpha = 0.6 * (1 - burn);
      r.glyph.soft = 0.9 * burn;
    }
    if (r.disc) r.disc.alpha = 0.45 * (out ? r.from : 1) * (1 - smooth(t / JUDG.discOut));
    if (out) {
      if (r.from > 0.01 && !r.unlit) this.stage.highlight(this._spriteOf(r.who), HL.raise, HL.raiseA * r.from * (1 - smooth(t / 0.2)), this);
      if (slot.who === r) {
        if (t >= LIGHT.failFade) this._release(slot, r);
        else this._lit(slot, r, r.x, r.y + LIGHT.raiseLift, r.z, LIGHT.holy, (LIGHT.raiseFrom + (LIGHT.raise - LIGHT.raiseFrom) * r.from) * (1 - t / LIGHT.failFade) * dayK(DAY.steady), LIGHT.raiseDistance);
      }
    } else if (slot.who === r) {
      const end = LIGHT.raiseHoldT + LIGHT.raiseFade;
      if (t >= end) this._release(slot, r);
      else {
        // (its flash on the frame's own time)
        const f = Math.exp(-(this._fclock - r.f0) / LIGHT.flashTau);
        const I = (LIGHT.raiseHold * dayK(DAY.steady) + (LIGHT.raiseFlash - LIGHT.raiseHold) * f * dayK(DAY.flash)) * (1 - smooth((t - LIGHT.raiseHoldT) / LIGHT.raiseFade));
        this._lit(slot, r, q.x, r.y + LIGHT.raiseLift, q.z, LIGHT.holy, I, LIGHT.raiseDistance);
      }
    }
    // (out: once the glyph burnt out and the light faded; raised: once its light has fallen too)
    if (t >= Math.max(burnT, out ? LIGHT.failFade : LIGHT.raiseHoldT + LIGHT.raiseFade) + 0.05) {
      this.fx.kill(r.glyph);
      this.fx.kill(r.disc);
      if (slot.who === r) this._release(slot, r);
      this._raise = null;
    }
    void dt;
  }

  /**
   * Mend's tether: three life stars fly from her sun to the one she heals (re-read every frame),
   * arriving at the frames 8, 13 and 18 — the last with the heal; with nobody to heal they rise off
   * her sun.
   */
  _tetherLook() {
    const mc = this.mc;
    const M = /** @type {VqCasterKit} */ (mc.kit).mend;
    const on = mc.move === 'mend' && !mc.down && !!M && mc.frame <= M.at;
    if (!on) {
      if (this._tether[0] || this._tether[1] || this._tether[2]) this._killTether();
      return;
    }
    const c = this._sunAt();
    const who = mc._healWho;
    const sys = this.sys;
    /** @type {{ x: number, y: number, z: number }|null} */
    let q = null;
    if (who === 'player') q = sys.player.position;
    else if (who && who !== mc) q = who.position;
    const T = this._tgt;
    if (q) {
      T.x = q.x;
      T.y = q.y + 1.0;
      T.z = q.z;
    }
    for (let k = 0; k < 3; k++) {
      const u = (mc.t - F(MEND.launch[k])) / F(MEND.fly);
      let r = this._tether[k];
      if (u < 0 || u >= 1) {
        if (r) this.fx.kill(r);
        this._tether[k] = null;
        continue;
      }
      if (!r) r = this._tether[k] = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, scale: 0.22, color: LIFE.lit, life: Infinity, frames: [0], spin: 5, back: -0.2, halo: 1 });
      if (!r) continue;
      if (q) {
        // (drawn in: slow off the staff, fast into the one healed, a little arc)
        const e = u * u;
        r.x = c.x + (T.x - c.x) * e;
        r.z = c.z + (T.z - c.z) * e;
        r.y = c.y + (T.y - c.y) * e + 0.35 * Math.sin(Math.PI * u);
        r.alpha = 1;
      } else {
        r.x = c.x;
        r.z = c.z;
        r.y = c.y + 0.6 * u;
        r.alpha = 1 - u;
      }
    }
  }

  /**
   * The ward's look on each warded hero: its ring fading in and out (it follows by itself), the
   * stars circling it for the first moments; all gone when the ward is.
   */
  _wardsLook() {
    for (let i = this._wards.length - 1; i >= 0; i--) {
      const w = this._wards[i];
      // (over with the ward — or at once when its member left the fight: its look would stay behind)
      if (w.age >= w.T || (w.who !== 'player' && w.who.gone)) {
        this._endWard(w);
        this._wards.splice(i, 1);
        continue;
      }
      if (w.ring) w.ring.alpha = GLYPH_A * clamp01(Math.min(w.age / 0.2, (w.T - w.age) / 0.6));
      const q = this._posOf(w.who);
      for (let k = 0; k < 3; k++) {
        const s = w.stars[k];
        if (!s) continue;
        if (w.age >= HL.wardFor) {
          this.fx.kill(s);
          w.stars[k] = null;
          continue;
        }
        const a = w.ph + w.age * 2.5 + (k * Math.PI * 2) / 3;
        s.x = q.x + Math.cos(a) * 0.45;
        s.z = q.z + Math.sin(a) * 0.45;
        s.y = q.y + 0.4 + 0.08 * Math.sin(a * 2);
        s.alpha = clamp01(Math.min(w.age / 0.15, (HL.wardFor - w.age) / 0.3));
      }
    }
  }

  /** The heroes' highlights asked for this frame (the stage writes the strongest). */
  _highlights() {
    const stage = this.stage;
    for (const w of this._wards) {
      if (w.age >= HL.wardFor) continue;
      if (w.who === 'player' ? !this.sys.pc.alive : w.who.down) continue;
      const fade = 1 - smooth((w.age - (HL.wardFor - 0.4)) / 0.4);
      const a = (HL.wardLo + (HL.wardHi - HL.wardLo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * HL.wardHz * w.age + w.ph))) * fade * clamp01(w.age / 0.2);
      stage.highlight(this._spriteOf(w.who), HL.ward, a, this);
    }
    for (const p of this._pulses) if (p.who === 'player' || !p.who.gone) stage.highlight(this._spriteOf(p.who), p.rgb, p.a * (1 - p.age / p.T), this);
  }

  /**
   * The staff's sun while she casts: its glow builds to the move's peak at the release, flashes
   * there and fades; a star at the sun while she charges; the bolt's second gathering beat.
   * @param {number} dt
   */
  _chargeLook(dt) {
    const mc = this.mc;
    const move = mc.move;
    const G = move === 'holyBolt' || move === 'judgement' || move === 'sanctuary' || move === 'mend' || move === 'revive' ? GLOW[move] : null;
    const kit = /** @type {VqCasterKit} */ (mc.kit);
    let rel = 0;
    if (move === 'holyBolt') rel = kit.basic.release;
    else if (move === 'judgement') rel = kit.skill.at;
    else if (move === 'sanctuary') rel = kit.skill2.at;
    else if (move === 'mend') rel = kit.mend?.at ?? 0;
    else if (move === 'revive') rel = kit.revive?.at ?? 0;
    const charging = !!G && !mc.down && mc.frame < rel;
    // (the bolt's second gathering beat: frame 10, beside MemberCombat's frame 4)
    if (move === 'holyBolt' && this._seenMove === move && this._seenFrame < 10 && mc.frame >= 10 && charging) {
      const c = this._sunAt();
      this.sys.burst('holyMotes', c.x, c.y, c.z, 3);
    }
    this._seenMove = move;
    this._seenFrame = mc.frame;
    let target = 0;
    let k = 0;
    if (charging) {
      k = smooth(mc.t / F(rel));
      target = G.peak * k * (1 + 0.08 * Math.sin(Math.PI * 2 * 9 * mc.t));
    }
    if (this._kick > 0) {
      this.glow = Math.max(this.glow, this._kick);
      this._kick = 0;
    }
    if (mc.down) this.glow = 0;
    else if (target >= this.glow) this.glow = target;
    else this.glow = target + (this.glow - target) * Math.exp(-dt / GLOW.tau);
    if (this.glow < 0.01) this.glow = 0;
    this.glow = Math.min(GLOW.max, this.glow);
    if (charging) {
      const c = this._sunAt();
      if (!this._star) this._star = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, scale: 0.3, color: HOLY.star, life: Infinity, frames: [0], spin: 2.0, back: -0.25, halo: 1 });
      const st = this._star;
      if (st) {
        st.x = c.x;
        st.y = c.y;
        st.z = c.z;
        st.s0 = st.s1 = 0.3 + 0.25 * k;
        st.alpha = Math.min(1, 0.25 + k);
      }
    } else if (this._star) {
      this.fx.kill(this._star);
      this._star = null;
    }
  }

  /** @param {number} a */
  _writeGlow(a) {
    const v = Math.round(a * 100) / 100;
    if (v === this._glowShown) return;
    this._glowShown = v;
    this.mc.member.sprite?.setGlow(GLOW_RGB[0], GLOW_RGB[1], GLOW_RGB[2], v);
  }

  /**
   * The staff sun's world spot in the cell her sprite shows (the sheet's glow texels; without them:
   * above the right hand).
   * @returns {{ x: number, y: number, z: number }}
   */
  _sunAt() {
    const mc = this.mc;
    const p = mc.member.position;
    const o = this._sun;
    const cell = this._spots?.[mc._lastRow]?.[mc._lastCol] ?? null;
    const right = cell ? cell.right : 0.35;
    const up = cell ? cell.up : 1.8;
    const yaw = globalUniforms.uCameraYaw.value;
    o.x = p.x + Math.cos(yaw) * right;
    o.y = p.y + up;
    o.z = p.z - Math.sin(yaw) * right;
    return o;
  }

  /** Tests: her look's state (`heroInfo().holy`). */
  info() {
    const L = this.lights;
    return {
      effects: this.fx.count, glow: +this.glow.toFixed(3), star: !!this._star, bolts: this._bolts.length,
      fields: this._fields.filter((f) => f.on).map((f) => f.kind), motes: this._motes.length, wards: this._wards.length,
      tether: this._tether.filter(Boolean).length, raise: this._raise ? this._raise.phase : null, pulses: this._pulses.length,
      settling: this._settling, show: +this._show.toFixed(2), oneShots: this.fx.live.reduce((n, r) => n + (r.life === Infinity ? 0 : 1), 0),
      lights: {
        acquired: L.acquired, refused: L.refused, field: L.field, fieldRefused: L.fieldRefused, minor: L.minor, minorRefused: L.minorRefused,
        held: this.heldLights(), lit: (this._field.light?.held && this._field.I > 0 ? 1 : 0) + (this._minor.light?.held && this._minor.I > 0 ? 1 : 0),
        lowest: Number.isFinite(L.lowest) ? L.lowest : null,
      },
    };
  }
}
