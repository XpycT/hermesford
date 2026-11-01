import { RNG, hashString, hash2, globalUniforms } from '../../engine/index.js';
import { IceCrystals } from '../../engine/fx/IceCrystals.js';
import { GroundFrost } from '../../engine/fx/GroundFrost.js';
import { F } from '../combat/rules.js';
import { glowSpots } from '../combat/glowSpots.js';
import { SpellFx, FLAT_LIFT, GLYPH_A, RING_A } from './MemberCombat.js';

/**
 * @import { CombatSystem } from '../combat/CombatSystem.js'
 * @import { Enemy } from '../combat/Enemy.js'
 * @import { MemberCombat, FxRec, Missile, Field } from './MemberCombat.js'
 * @import { VqCasterKit } from './rules.js'
 * @import { SpellLight } from '../../engine/lighting/VfxLights.js'
 */

/**
 * IceSpellFx — the look of the ice mage's spells (Lyra of Vanquish the Evil Dragon: the companion
 * class `icemage`, party/rules.js `KIT.icemage`; docs/contracts/DRAGON_CAMPAIGN.md §6.8, COMBAT.md
 * §28). Visuals only: `MemberCombat` keeps the moves — their timing, aim, hits, statuses, hit-stop,
 * sounds — exactly as they are and calls these hooks; nothing here touches a hit, a cooldown or the
 * member's RNG (its own: `ice:<id>` and the combat seed), so the fights play the same.
 *
 * A module of its own, imported (`import()`) by `CombatSystem.load` only on a level where an ice
 * mage can fight (`classMayFight('icemage', …)`, mayFight.js): there the combat makes one `IceStage`
 * (`sys.ice`: the 3D crystals, the ground frost, the FX batch's halo, warmed at load, disposed
 * with the combat) and every ice-mage member gets an `IceSpellFx` (`stage.director(member)`).
 * Anywhere else nothing of it exists — no program, draw call, object or download.
 *
 * The look (no alpha blending anywhere: cut-out quads with dither fades, additive halos and light):
 *  - **Light.** Spells take one of the combat VFX lights (`World.acquireSpellLight`: the game's
 *    `VFX_LIGHT_COUNT` point lights beside the lamps', made by Game.init on every level before the
 *    first frame — VfxLights.js; the lamps are never touched), one at a time per ice mage: the
 *    Tomb's small charge light riding its leading crack, its cold flash at the eruption, then a low
 *    glow while it stands; a dim cold flicker under the Blizzard; a spark at a lance's impact when
 *    a light is free (a spell's light takes a spark's over). Colours are linear blues; by day they and the frost's own glow are dimmer
 *    (`DAY`); while a scene holds the fight they are dark and the gust eases out.
 *  - **Glacial Tomb, staged.** Anticipation: cracks race over the ground from her staff to the ring
 *    (`GroundFrost` cracks; a star and the charge light ride their tips, which the grass would
 *    hide) while the glyph fills with frost (a `soft` glow disc, spent within 0.16 s of the
 *    eruption). The eruption: 3D crystals (`IceCrystals`: lit, shadow-casting, bloom on their rims)
 *    burst up ring by ring — the outer ring first, sweeping from her side round to the far side,
 *    then the inner ring, the great spike just beyond the centre last (the camera's side of the ring
 *    stands lower: the frozen foes stay in view): each overshoots and settles; the centre's peak is
 *    the hit (`KIT.icemage.skill2.delay`; the move's own hit-stop holds the overshoot, its own
 *    shake), the frost spreads with frozen grass tufts, the light flashes. The hold: glints slide
 *    down the spikes; the foes it froze wear an ice shell (a cut-out crystal quad over the sprite,
 *    its gaps showing the body; `Enemy.iceShell` lightens their frozen tint). The release: the
 *    spikes crack, then burst into shards that fly, bounce once (a puff where they land) and
 *    dissolve in pixel steps; the frost recedes; a shell shatters when its freeze ends.
 *  - **Blizzard, layered.** Fine far streaks high over the field, the mid snow, flakes circling the
 *    centre, a few big flakes between the camera and the field (the depth of field blurs them into
 *    bokeh), hail that lands in puffs, low mist banks (cut-out, `soft` rims), the vortex's `soft`
 *    edge, frost building up over its 4 s (`GroundFrost`), a gust bending the grass
 *    (`Weather.gust`; gentler on a level with set-piece fire, which it bends too), the dim
 *    flickering cold light.
 *  - **Two-layer ice**: the lance, the shards and the shells are a body quad (shaded faces, deep
 *    blue-violet, under the halo's threshold: no glow) and a lit layer over it (facets, edges,
 *    tips: cyan above it — the halo hugs those edges). Her bright quads (the lit layers, flakes,
 *    bursts, stars) ask for the FX batch's halo (`halo` 1; the bodies, glyphs, vortex, ring, mist,
 *    glow disc and bokeh do not, and FxQuads keeps it off every other effect); all of hers dim
 *    after dark (`NIGHT_DIM`).
 *  - Her staff crystal: a star while she casts, its glow texels (`sprite.setGlow` on her combatFx
 *    sprite) building through the wind-up, a flash at the release, fading out.
 *  - **The scene settle.** A story scene that starts on a set-piece level while her spells are up
 *    (the ambient step: a kill may start one) fades them out over `SETTLE` s of frames — the quads
 *    from the opacity they had, the crystals sinking, the frost receding —, then ends them; her
 *    lights stay dark. The ice shells only fade: the foes stay frozen through the scene (the
 *    combat's clock stands), so the shells come back after it. The spells resume unseen (their
 *    hits are the move's); nothing new starts while it lasts. The map or a talk only holds them.
 */

/**
 * Her tints (linear HDR × the atlas's grey levels). The halo weighs a quad by its brightest
 * channel (0.9 → 1.8, FxQuads.js) — only the quads that ask for it (`halo: 1`). Lit layers
 * (`*Lit`, the flakes, the burst, the star) sit high in that ramp with a cyan lead and ask; bodies,
 * glyphs, the glow disc, mist, the vortex and the ring do not (most stay at or below 0.9), the
 * bodies leaning blue-violet.
 */
const ICE_TINT = Object.freeze({
  lance: Object.freeze([0.34, 0.36, 0.88]),
  lanceLit: Object.freeze([0.62, 1.4, 1.85]),
  burst: Object.freeze([0.55, 1.2, 1.8]),
  glyph: Object.freeze([0.26, 0.54, 0.9]),
  swirl: Object.freeze([0.6, 0.78, 1.0]),
  flake: Object.freeze([0.6, 1.25, 1.75]),
  flakeNear: Object.freeze([0.22, 0.5, 0.85]),
  shard: Object.freeze([0.26, 0.3, 0.78]),
  shardLit: Object.freeze([0.3, 0.62, 0.95]),
  shell: Object.freeze([0.3, 0.34, 0.8]),
  shellLit: Object.freeze([0.38, 0.74, 1.02]),
  mist: Object.freeze([0.5, 0.6, 0.85]),
  ring: Object.freeze([0.42, 0.74, 1.15]),
  star: Object.freeze([0.45, 0.85, 1.7]),
  starFlash: Object.freeze([0.5, 0.95, 1.8]),
});
/** How much her quads dim at full night (`uNight` 1; the exposure rises after dark). */
const NIGHT_DIM = 0.6;
/** The Tomb's glyph-glow disc: its tint at full charge (it fills from black), its alpha cap, its softness. */
const GLOW_DISC = Object.freeze({ rgb: Object.freeze([0.2, 0.45, 0.88]), alpha: 0.55, soft: 0.85 });

/** The staff crystal's glow colour (the ice ramp's own hue). */
const GLOW_RGB = Object.freeze([0.55, 0.85, 1.0]);
/** Glow strength while charging (peak at the release / `at`) and the release's flash, per move. */
const GLOW = Object.freeze({
  frostLance: Object.freeze({ peak: 1.1, flash: 1.8 }),
  blizzard: Object.freeze({ peak: 1.4, flash: 2.2 }),
  glacialTomb: Object.freeze({ peak: 1.5, flash: 2.4 }),
  /** Seconds of the decay after the flash (exp). */
  tau: 0.12,
});

/**
 * The spell lights (the combat VFX lights, World.acquireSpellLight; decay 1; linear HDR colours,
 * intensities in the lanterns' units: a torch is 6 … 14). One at a time per ice mage (a new spell
 * takes over the light of the one before; a lance's spark only from a free light, a `minor` one
 * that a spell's light may take over). Tomb: a small `charge` light
 * riding the leading crack (`chargeLift` above it) while the glyph fills, then the `flash`
 * `tombLift` u over the ring's centre at the eruption, decaying over `flashTau` s into `hold` while
 * the spikes stand (its falloff turning from 1 to `holdDecay` with it: a glow from the ice, no wash
 * over the ring's surroundings), a `shatter` blink; Blizzard: `storm` × a flicker, circling
 * `stormLift` u up; a lance: `impact` for `impactT` s. By day all of it × `DAY.light`, but the part
 * of the flash and of the shatter blink above the hold × `DAY.flash` (the heroes' hit-frame rule:
 * a flash over foes the core flashes white stays low by day); those two age on the frame's own
 * time, so they fade through the Tomb's hit-stop; no light of hers above `cap`.
 */
const LIGHT = Object.freeze({
  tombColor: [0.15, 0.4, 1.8], tombDistance: 10.5, tombLift: 3,
  charge: 5, chargeLift: 0.6, chargeDistance: 4.5, flash: 12, flashTau: 0.1, hold: 2.5, holdDecay: 2, shatter: 12,
  stormColor: [0.16, 0.4, 1.6], stormDistance: 11, stormLift: 3, storm: 7,
  impactColor: [0.25, 0.6, 1.8], impactDistance: 3.5, impact: 6, impactT: 0.16,
  cap: 6,
});
/**
 * By day her lights, the frost's own glow (sparkle, front, cracks: GroundFrost `glow`) and the
 * crystals' (IceCrystals `glow`: core, rims, seams) are this much of their night strength (lerped
 * by `uNight`): under the noon sun two spells of hers lit together would bloom the fight into white.
 */
const DAY = Object.freeze({ light: 0.55, glow: 0.5, crystal: 0.75, flash: 0.25 });
/** @type {(min: number) => number} a day factor now (`min` at noon, 1 at night) */
const dayK = (min) => min + (1 - min) * globalUniforms.uNight.value;
/** The lit layer over its body: a hair above a flat quad (u), toward the camera for an upright one (`back`). */
const LIT_DY = 0.012;
const LIT_BACK = -0.03;
/** Shards in flight at most (per ice mage); their gravity (u/s²). */
const SHARDS_MAX = 64;
const SHARD_G = 16;
/** Spells of hers on the ground at once (a Blizzard and a Tomb, one more lingering). */
const FIELDS = 3;
/** A story scene's settle: her look fades out over this many seconds of frames, the ice shells come back over as many. */
const SETTLE = 0.25;

/**
 * The Tomb's staging (s from the field's opening; the kit's `delay` is the hit): the cracks race
 * until `delay − crackLead`; spikes rise over `rise` s (peak `overshoot` at `peakAt` of it); the
 * outer ring starts `outer` s before the hit and sweeps for `sweep` s, the inner ring `inner` s
 * before over `innerSweep` s, the centre so that its peak is the hit; the spikes crack over the
 * last `crackT` s of the hold; the shards live `shardLife` s (their last `dissolve` s dissolving);
 * the frost recedes over `recede` s after the shatter. Crystals: heights × `size`, the camera's side
 * of the ring `nearLow` lower, the inner ring × `innerLow` and a crystal less than `screenDepth` u
 * in front of a foe and `screenSide` u beside it (as the camera sees it) × `screenLow` (the frozen
 * foes stand among them: they stay in view), the centre spike `centreBack` u beyond the centre (away from the camera), feet
 * `sink` u in the ground.
 */
const TOMB = Object.freeze({
  size: 1.3, nearLow: 0.62, innerLow: 0.72, screenLow: 0.5, screenDepth: 2.6, screenSide: 0.75, sink: 0.02, centreBack: 0.8,
  crackLead: 0.22, rise: 0.13, peakAt: 0.55, overshoot: 1.15,
  outer: 0.25, sweep: 0.11, inner: 0.14, innerSweep: 0.05,
  crackT: 0.32, glintT: 0.38, discOut: 0.16, shardLife: [0.9, 1.3], dissolve: 0.3, recede: 1.1,
});
/**
 * The Blizzard's staging: the gust (Weather.gust) at most — `gustFire` on a level with set-piece
 * fire (World.flames: the gust bends every flame and smoke column of the level, not only the
 * storm's grass) —, its rise / fall (s); the frost recedes over `recede` s.
 */
const STORM = Object.freeze({ gust: 1.2, gustFire: 0.5, gustRise: 0.4, gustFall: 0.7, recede: 1.0, flakes: 18, near: 4 });

/**
 * One crystal of a Tomb: its foot, size, lean, the second it starts to rise, its crystal handle
 * (−1: not risen yet / gone; −2: the batch was full), its order in the sweep (0 … 1: the glints follow it), small or not,
 * its way out from the centre.
 * @typedef {{ x: number, y: number, z: number, height: number, radius: number, yaw: number, tiltX: number, tiltZ: number,
 *   seed: number, start: number, h: number, order: number, small: boolean, dx: number, dz: number, r: number }} Spike
 */
/**
 * A spell of hers on the ground as it looks (its own clock, stepped with the move's field): kind,
 * spot and ground, age, stage `n` (the Tomb: 0 rising, 1 standing, 2 shattered), the storm's beat
 * `m` (the Tomb: its first crystal up), the turn `a`, a tag (the light's flicker), the next flake /
 * near flake / hail / mist, its quads; its crystals, its ground frost (`gf`, −1: none), its light,
 * the glow disc and its tint, where the cracks start, the riding stars, the second its frost was
 * painted (−1: not yet — GroundFrost paints over a few frames; the Tomb's cracks run from then).
 * @typedef {{ on: boolean, kind: 'blizzard'|'glacialTomb', x: number, y: number, z: number, t: number, n: number,
 *   m: number, a: number, tag: number, flake: number, near: number, hail: number, mist: number, fx: FxRec[],
 *   spikes: Spike[], gf: number, light: SpellLight|null, disc: FxRec|null, discRgb: number[], fromX: number, fromZ: number,
 *   tipFx: (FxRec|null)[], ready: number, fade: number, lph: number, lt: number }} IceField
 */
/** @returns {IceField} */
function newField() {
  return {
    on: false, kind: 'blizzard', x: 0, y: 0, z: 0, t: 0, n: 0, m: -1, a: 0, tag: 0, flake: 0, near: 0, hail: 0, mist: 0, fx: [],
    spikes: [], gf: -1, light: null, disc: null, discRgb: [0, 0, 0], fromX: 0, fromZ: 0, tipFx: [null, null, null], ready: -1, fade: 0,
    lph: 0, lt: 0,
  };
}
/** A lance in flight as it looks: the move's missile, its body and lit layer. @typedef {{ ms: Missile, body: FxRec|null, lit: FxRec|null }} Lance */
/**
 * A circling flake of the Blizzard: its field, angle round the centre, radius, height above the
 * ground, angular speed, fall speed, age, life.
 * @typedef {{ rec: FxRec, fl: IceField, a: number, r: number, y: number, w: number, vy: number, age: number, life: number }} Flake
 */
/** A drifting quad (a near flake, a mist bank): velocity, age, life. @typedef {{ rec: FxRec, vx: number, vy: number, vz: number, age: number, life: number }} Drift */
/**
 * A flying ice shard (two quads: body + lit): position, velocity, spin, age, life, bounced, half its height.
 * @typedef {{ body: FxRec, lit: FxRec|null, x: number, y: number, z: number, vx: number, vy: number, vz: number,
 *   spin: number, age: number, life: number, bounced: boolean, half: number }} Shard
 */
/** A frozen foe's ice shell (two quads), its lit layer's own tint (the glint), its beat. @typedef {{ e: Enemy, body: FxRec, lit: FxRec|null, rgb: number[], ph: number }} Shell */
/** A light spark at a lance's impact. @typedef {{ light: SpellLight, x: number, y: number, z: number, t: number }} Spark */

/** @type {(u: number) => number} smoothstep 0..1 */
const smooth = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

/** @type {(u: number) => number} */
const clamp01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);

/**
 * A shard's quad at its shard (`_stepShards`): place, spin, dissolve.
 * @param {FxRec} r @param {Shard} s @param {number} h @param {number} a
 */
function placeShard(r, s, h, a) {
  r.x = s.x;
  r.y = s.y;
  r.z = s.z;
  r.rot += s.spin * h;
  r.alpha = a;
}

/**
 * A lance's quad on its missile (`visuals`), `dy` above it.
 * @param {FxRec} r @param {Missile} ms @param {number} dy
 */
function placeLance(r, ms, dy) {
  r.x = ms.x;
  r.y = ms.y + dy;
  r.z = ms.z;
  r.dirX = ms.dx;
  r.dirZ = ms.dz;
}

/** @type {(a: number) => number} an angle into (−π, π] */
const wrapPi = (a) => {
  const t = Math.PI * 2;
  a = ((a % t) + t) % t;
  return a > Math.PI ? a - t : a;
};

/**
 * A Tomb crystal's rise at u of its `TOMB.rise` (0 … 1): an ease-out to the overshoot by `peakAt`,
 * settling to 1.
 * @param {number} u
 * @returns {number}
 */
function riseAt(u) {
  if (u <= 0) return 0;
  const p = TOMB.peakAt;
  if (u < p) {
    const k = 1 - u / p;
    return TOMB.overshoot * (1 - k * k * k);
  }
  if (u < 1) return TOMB.overshoot - (TOMB.overshoot - 1) * smooth((u - p) / (1 - p));
  return 1;
}

/**
 * What a combat on a level where an ice mage can fight adds (`sys.ice`, made by `CombatSystem.load`):
 * the Tomb's 3D crystals and the ground frost (one draw call each and the crystals' shadow, their
 * programs compiled by the warm-up), the FX batch's halo (`enableHalo`), the gust into the weather,
 * and an `IceSpellFx` per ice-mage member. Disposed with the combat (a travel included): crystals,
 * frost, the VFX lights held (given back) and the gust all go.
 */
export class IceStage {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    const tm = sys.tileMap;
    /** The Tomb's 3D spikes (one instanced draw + its shadow). */
    this.crystals = new IceCrystals({ capacity: 48 });
    /** Frost and racing cracks on the ground under both spells. */
    this.frost = new GroundFrost({
      capacity: 4,
      // (`surface`: the drawn, stepped ground — frost on a stair lies on its steps)
      heightField: { sample: (x, z) => tm.getHeight(x, z), surface: (x, z) => tm._surface(x, z), minX: 0, minZ: 0, maxX: tm.width, maxZ: tm.depth },
    });
    sys.scene?.add(this.crystals.object);
    sys.scene?.add(this.frost.object);
    sys.quads?.enableHalo();
    /** @type {IceSpellFx[]} the ice mages' directors */
    this.directors = [];
    /** The gust last written into the weather (0: it leaves `Weather.gust` alone). */
    this._gust = 0;
    /** The storms' gust at most here (a level with set-piece fire: less, STORM.gustFire). */
    this.gustMax = sys.world?.flames ? STORM.gustFire : STORM.gust;
    /** The warm-up's halo quad (−1: none). */
    this._warmQuad = -1;
  }

  /**
   * The director of an ice-mage member (MemberCombat's constructor).
   * @param {MemberCombat} mc
   * @returns {IceSpellFx}
   */
  director(mc) {
    const d = new IceSpellFx(this, mc);
    this.directors.push(d);
    return d;
  }

  /** A director goes (its member's fight released). @param {IceSpellFx} d */
  drop(d) {
    const i = this.directors.indexOf(d);
    if (i >= 0) this.directors.splice(i, 1);
  }

  /**
   * The combat's warm-up (`CombatSystem.warmup`, before the scene is compiled): one crystal, one
   * frost patch and one halo quad far below the world, so their programs (and the crystals' shadow
   * program) compile at load.
   * @param {{ x: number, y: number, z: number }} far
   */
  warmup(far) {
    this.crystals.warm();
    this.frost.warm();
    this.crystals.update(0);
    this.frost.update(0);
    const q = this.sys.quads;
    this._warmQuad = q.alloc();
    if (this._warmQuad >= 0) q.set(this._warmQuad, { x: far.x, y: far.y, z: far.z, frame: 'partyIceGlow', index: 0, scale: 1, mode: 'billboard', r: 2, g: 2, b: 2, a: 1, halo: 1 });
    q.update();
  }

  /** After the warm frames (`CombatSystem.endWarmup`). */
  endWarmup() {
    this.crystals.unwarm();
    this.frost.unwarm();
    this.crystals.update(0);
    this.frost.update(0);
    if (this._warmQuad >= 0) this.sys.quads.free(this._warmQuad);
    this._warmQuad = -1;
  }

  /**
   * Once a frame after the members' visuals (`CombatSystem.afterPlayer`): the gust of the storms,
   * the crystals and the frost written. While the combat does not run (a story scene holds the
   * player, a talk, the map — not the photo mode) the gust eases out and the spell lights are
   * dark; both come back with the fight. In a story scene on a set-piece level (the ambient step) her
   * look settles out (`IceSpellFx.settle`).
   * @param {number} dt combat seconds of the frame (0: everything holds)
   * @param {boolean} [active] the combat ran this frame
   * @param {number} [frameDt] the frame's own seconds
   * @param {boolean} [ambient] a story run holds the player on a set-piece level
   */
  update(dt, active = true, frameDt = 0, ambient = false) {
    // (a photo freezes the fight as it is: only a scene, a talk, the map hush it)
    const hushed = !active && !this.sys.game?.photoMode;
    let g = 0;
    for (const d of this.directors) {
      d._frameDt = frameDt;
      if (ambient) {
        d.hush();
        d.settle(frameDt);
      } else if (hushed) d.hush();
      else {
        if (active) d.resume(frameDt);
        g = Math.max(g, d.gust);
      }
    }
    this._setGust(Math.round(Math.min(g, this.gustMax) * 100) / 100);
    this.crystals.update(dt);
    this.frost.update(dt);
  }

  /**
   * The storms' gust into the weather (only while a storm drives it: 0 once, then hands off).
   * @param {number} g
   */
  _setGust(g) {
    if (g === 0 && this._gust === 0) return;
    const w = this.sys.game?.weather;
    if (w && 'gust' in w) w.gust = g;
    this._gust = g;
  }

  /**
   * Every spell light given back (the death reset, `CombatSystem.resetEncounter`): the VFX lights
   * parked and free, the spells still up going on unlit.
   */
  dropLights() {
    for (const d of this.directors) d.dropLights();
  }

  /** The combat goes: every director, the gust, the crystals and the frost. */
  dispose() {
    for (const d of [...this.directors]) d.dispose();
    this.directors.length = 0;
    this._setGust(0);
    this.crystals.dispose();
    this.frost.dispose();
  }

  /** Tests (`__game.combat.system.ice.info()`). */
  info() {
    return { directors: this.directors.length, crystals: this.crystals.count, frost: this.frost.count, gust: this._gust, halo: !!this.sys.quads?.halo };
  }
}

/**
 * The look of one ice mage's spells (see the module comment): hooks MemberCombat calls at the
 * moves' moments, its own effects stepped on the combat clock (`step`) and written once a frame
 * (`visuals`).
 */
export class IceSpellFx {
  /**
   * @param {IceStage} stage
   * @param {MemberCombat} mc
   */
  constructor(stage, mc) {
    this.stage = stage;
    this.mc = mc;
    /** @type {CombatSystem} */
    this.sys = mc.sys;
    /** Her effect quads on the combat's FX batch (the bright ones ask for the halo: `halo: 1`). */
    this.fx = new SpellFx(this.sys, { halo: 0 });
    /** @type {Lance[]} her lances in flight */
    this._lances = [];
    /** @type {IceField[]} her spells on the ground as they look */
    this._fields = Array.from({ length: FIELDS }, newField);
    /** @type {Flake[]} */
    this._flakes = [];
    /** @type {Drift[]} the near flakes (bokeh) and the mist banks */
    this._drifts = [];
    /** @type {Shard[]} */
    this._shards = [];
    /** @type {Map<Enemy, Shell>} the shells of the foes her Tombs froze */
    this._shells = new Map();
    /** @type {Spark[]} */
    this._sparks = [];
    /** Sheet cells → the crystal's spot (glow texels; null: none found). */
    this._crystal = glowSpots(mc.member.sprite?.sheet);
    this._crys = { x: 0, y: 0, z: 0 };
    this._wind = { x: 1, z: 0 };
    /** Scratch records handed to the crystals, the frost and the lights (no allocation per frame). */
    this._crysP = { rise: 0, crack: 0, glint: 0, glow: 1 };
    this._frostP = { spread: 0, fade: 0, cracks: 0, crackFrom: { x: 0, z: 0 }, glow: 1 };
    /** A scene's settle: the crystals' sinking rise, the frost's receding fade (everything else kept). */
    this._riseP = { rise: 0 };
    this._fadeP = { fade: 0 };
    /** @type {{ color: number[], intensity: number, distance: number, decay: number }} */
    this._lightP = { color: LIGHT.tombColor, intensity: 0, distance: 8, decay: 1 };
    /** The last frame's own seconds (IceStage.update): the Tomb's flash and blink age on it. */
    this._frameDt = 0;
    /** `GroundFrost.crackTips`' scratch (the main run, the two round the ring). */
    this._tips = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
    /** Her storms' gust now (IceStage takes the strongest). */
    this.gust = 0;
    /** A scene's settle: each of her quads' opacity when it began. @type {Map<FxRec, number>} */
    this._snap = new Map();
    this.clear();
  }

  /** Her effects live (tests, `heroInfo().quads`). */
  get count() { return this.fx.count; }

  /** Everything gone (the member's reset, its release): lances, spells, effects, lights, the glow. */
  clear() {
    this._lances.length = 0;
    for (const fl of this._fields) if (fl.on) this._closeField(fl);
    this._flakes.length = 0;
    this._drifts.length = 0;
    this._shards.length = 0;
    for (const e of this._shells.keys()) e.iceShell = false;
    this._shells.clear();
    for (const s of this._sparks) s.light.release();
    this._sparks.length = 0;
    this.fx.clear();
    this.gust = 0;
    /** @type {FxRec|null} the staff's star while she charges */
    this._star = null;
    /** The crystal's glow strength now, the flash a release asked for (`visuals` applies it). */
    this.glow = 0;
    this._kick = 0;
    this._glowShown = -1;
    /** VFX lights acquired so far and refused (none free) — tests. */
    this.lights = { acquired: 0, refused: 0 };
    /** A story scene's settle (`settle`): running, its seconds, done; the shells' share (it comes back after the scene) and its clock. */
    this._settling = false;
    this._settleT = 0;
    this._settled = false;
    this._back = 1;
    this._backT = 0;
    this._snap.clear();
    this.rng = new RNG((hashString(`ice:${this.mc.id}`) ^ (Number(this.sys.seedValue) >>> 0)) >>> 0);
    this._writeGlow(0);
  }

  /** The combat does not run this frame (IceStage.update): her spell lights dark until it does. */
  hush() {
    for (const fl of this._fields) if (fl.on && fl.light) fl.light.off();
    for (const s of this._sparks) s.light.off();
  }

  /**
   * A story scene holds the fight on a set-piece level (the ambient step; IceStage.update): every
   * quad of hers fading out over `SETTLE` s of frames from the opacity it had, the crystals sinking,
   * the frost receding, the staff's glow out; then every spell's look ends (its quads, crystals,
   * frost, light), the lances' quads, flakes, drifts, shards and sparks with them. The ice shells
   * only fade: they come back after the scene (`resume`). Nothing new starts while it lasts.
   * @param {number} frameDt the frame's own seconds
   */
  settle(frameDt) {
    if (!this._settling) {
      this._settling = true;
      this._settleT = 0;
      this._settled = false;
      this._snap.clear();
      for (let i = 0; i < this.fx.live.length; i++) this._snap.set(this.fx.live[i], this.fx.live[i].alpha);
    }
    if (this._settled) return;
    this._settleT += frameDt;
    const k = clamp01(this._settleT / SETTLE);
    this._back = 1 - k;
    for (let i = 0; i < this.fx.live.length; i++) {
      const r = this.fx.live[i];
      r.alpha = (this._snap.get(r) ?? 0) * (1 - k);
    }
    const { crystals, frost } = this.stage;
    const rp = this._riseP;
    const fp = this._fadeP;
    for (const fl of this._fields) {
      if (!fl.on) continue;
      for (const sp of fl.spikes) {
        if (sp.h < 0) continue;
        rp.rise = sp.r * (1 - k);
        crystals.set(sp.h, rp);
      }
      if (fl.gf >= 0) {
        fp.fade = Math.max(fl.fade, k);
        frost.set(fl.gf, fp);
      }
    }
    if (this.glow !== 0) {
      this.glow = 0;
      this._writeGlow(0);
    }
    if (k >= 1) this._endOneShots();
    const cfx = this.sys.fx;
    this.fx.write(cfx ? cfx.viewX : 0, cfx ? cfx.viewZ : -1, 1 - NIGHT_DIM * globalUniforms.uNight.value);
  }

  /** The settle's end: every spell's look over (lances, fields, flakes, drifts, shards, sparks, the star); the shells stay, unseen. */
  _endOneShots() {
    for (const L of this._lances) {
      this.fx.kill(L.body);
      this.fx.kill(L.lit);
    }
    this._lances.length = 0;
    for (const fl of this._fields) if (fl.on) this._closeField(fl);
    for (const f of this._flakes) this.fx.kill(f.rec);
    this._flakes.length = 0;
    for (const d of this._drifts) this.fx.kill(d.rec);
    this._drifts.length = 0;
    for (const sh of this._shards) {
      this.fx.kill(sh.body);
      this.fx.kill(sh.lit);
    }
    this._shards.length = 0;
    for (const sp of this._sparks) sp.light.release();
    this._sparks.length = 0;
    if (this._star) this.fx.kill(this._star);
    this._star = null;
    this.gust = 0;
    this._back = 0;
    this._settled = true;
  }

  /**
   * The fight runs this frame (IceStage.update): after a scene's settle, the shells come back over
   * `SETTLE` s of frames (a scene shorter than the settle ends it at once).
   * @param {number} frameDt the frame's own seconds
   */
  resume(frameDt) {
    if (this._settling) {
      if (!this._settled) this._endOneShots();
      this._settling = false;
      this._settled = false;
      this._backT = 0;
    }
    if (this._back < 1) {
      this._backT += frameDt;
      this._back = clamp01(this._backT / SETTLE);
    }
  }

  /**
   * Every light of hers given back at once, her spells going on unlit (the combat's death reset —
   * `IceStage.dropLights`): the VFX lights parked and free.
   */
  dropLights() {
    for (const fl of this._fields) {
      if (!fl.light) continue;
      fl.light.release();
      fl.light = null;
    }
    for (const s of this._sparks) s.light.release();
    this._sparks.length = 0;
  }

  /** Her fight is released (MemberCombat.release): everything gone, out of the stage. */
  dispose() {
    this.clear();
    this.stage.drop(this);
  }

  /**
   * Take a combat VFX light (World.acquireSpellLight), or null (none free).
   * @param {{ minor?: boolean }} [opts] minor: a short spark — a free light only, and a spell's
   *   light may take it over
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
  // Hooks (MemberCombat)
  // ------------------------------------------------------------------------------------------

  /** Frost gathering at the staff (the wind-up's beats). @param {number} [count] */
  gather(count = 3) {
    const c = this._crystalAt();
    this.sys.burst('partyFrostGlint', c.x, c.y, c.z, count);
  }

  /**
   * A move takes effect (a lance leaves the staff, a spell lands): the crystal flashes, a burst of
   * rays at the staff.
   * @param {'frostLance'|'blizzard'|'glacialTomb'} move
   */
  released(move) {
    this._kick = GLOW[move].flash;
    const c = this._crystalAt();
    this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, scale: 0.55, color: ICE_TINT.starFlash, life: 0.16, fadeOut: 0.14, frames: [1], back: -0.25, halo: 1 });
    this.sys.burst('partyFrostGlint', c.x, c.y, c.z, 4);
  }

  /** A lance was launched (`_launch`): its body and lit facets. @param {Missile} ms */
  launch(ms) {
    const o = { frame: 'partyIceLance', mode: /** @type {'flat'} */ ('flat'), x: ms.x, y: ms.y, z: ms.z, dirX: ms.dx, dirZ: ms.dz, rot: Math.PI / 2, scale: 1.6, color: ICE_TINT.lance, life: Infinity, loop: true };
    const body = this.fx.add(o);
    const lit = this.fx.add({ ...o, frame: 'partyIceLanceLit', y: ms.y + LIT_DY, color: ICE_TINT.lanceLit, halo: 1 });
    this._lances.push({ ms, body, lit });
  }

  /**
   * A lance ends (`_endMissile`): its frost burst where it struck (a foe, a wall) — chips thrown
   * back, a breath of cold mist, a spark of light if one is free —, else it fades into glints.
   * @param {Missile} ms
   * @param {boolean} hit
   */
  lanceEnd(ms, hit) {
    const i = this._lances.findIndex((l) => l.ms === ms);
    if (i >= 0) {
      const L = this._lances[i];
      this.fx.kill(L.body);
      this.fx.kill(L.lit);
      this._lances.splice(i, 1);
    }
    const sys = this.sys;
    if (!hit) {
      sys.burst('partyFrostGlint', ms.x, ms.y, ms.z, 3);
      return;
    }
    this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: ms.x, y: ms.y - 0.1, z: ms.z, scale: 0.9, color: ICE_TINT.burst, life: 0.24, back: 0.2, halo: 1 });
    sys.burst('partyFrostShards', ms.x, ms.y, ms.z, 8);
    const g = sys.groundAt(ms.x, ms.z);
    for (let k = 0; k < 3; k++) {
      const a = Math.atan2(-ms.dz, -ms.dx) + (this.rng.next() - 0.5) * 2.2;
      const v = 1.4 + 1.6 * this.rng.next();
      this._shard(ms.x, ms.y, ms.z, Math.cos(a) * v, 1.5 + 2 * this.rng.next(), Math.sin(a) * v, 0.45 + 0.15 * this.rng.next(), 0.7);
    }
    this._mist(ms.x, g, ms.z, 1.1, 0.7);
    // (a spark only from a free light: a spell's light comes first)
    if (this._sparks.length < 2) {
      const light = this._acquireLight({ minor: true });
      if (light) this._sparks.push({ light, x: ms.x, y: ms.y + 0.6, z: ms.z, t: 0 });
    }
  }

  /**
   * A spell of hers opens on the ground (`_openFx`; the move's field `fl`: kind, spot, ground,
   * turn): its glyph, the frost patch under it, a VFX light; the Tomb plans its crystals, the
   * Blizzard opens its vortex. Timed from here on its own clock (`step`), as the move's field is.
   * @param {Field} mf
   */
  open(mf) {
    const kind = mf.kind === 'blizzard' ? 'blizzard' : 'glacialTomb';
    let fl = this._fields.find((q) => !q.on);
    if (!fl) {
      fl = this._fields[0];
      for (const q of this._fields) if (q.t > fl.t) fl = q;
      this._closeField(fl);
    }
    const kit = /** @type {VqCasterKit} */ (this.mc.kit);
    fl.on = true;
    fl.kind = kind;
    fl.x = mf.x;
    fl.z = mf.z;
    fl.y = mf.y;
    fl.t = 0;
    fl.n = 0;
    fl.m = -1;
    fl.flake = 0;
    fl.near = 0.15;
    fl.hail = 0.05;
    fl.mist = 0.1;
    fl.a = mf.a;
    fl.tag = mf.tag;
    fl.fx.length = 0;
    fl.spikes.length = 0;
    fl.disc = null;
    fl.ready = -1;
    fl.lph = 0;
    fl.lt = 0;
    fl.fade = 0;
    // (the cracks start under her staff)
    const c = this._crystalAt();
    fl.fromX = c.x;
    fl.fromZ = c.z;
    const seed = (this.rng.next() * 0x7fffffff) | 0;
    const { x, z } = fl;
    const y = fl.y + FLAT_LIFT;
    const fx = this.fx;
    /** @type {(r: FxRec|null) => FxRec|null} */
    const keep = (r) => { if (r) fl.fx.push(r); return r; };
    const frost = this.stage.frost;
    if (kind === 'blizzard') {
      const S = kit.skill;
      fl.gf = frost.add({ x, z, radius: S.r * 1.1, seed });
      keep(fx.add({ frame: 'partyGlyphFrost', mode: 'flat', x, y, z, size: 2, sizeTo: S.r * 2, grow: 0.35, rot: fl.a, spin: 0.5, color: ICE_TINT.glyph, life: S.duration + 0.3, fadeIn: 0.2, fadeOut: 0.4, alpha: GLYPH_A }));
      // the vortex overhead, its rim thinning in dither (the cloud's soft edge), and a tighter one
      // lower down, turning faster (the eye of the storm)
      keep(fx.add({ frame: 'partySwirl', mode: 'flat', x, y: y + 2.0, z, size: 2, sizeTo: S.r * 1.7, grow: 0.6, rot: fl.a + 1.7, spin: 2.4, color: ICE_TINT.swirl, life: S.duration, fadeIn: 0.4, fadeOut: 0.6, fps: 6, loop: true, alpha: 0.75, soft: 0.6 }));
      keep(fx.add({ frame: 'partySwirl', mode: 'flat', x, y: y + 1.1, z, size: 1.5, sizeTo: S.r * 1.05, grow: 0.5, rot: fl.a - 0.6, spin: 3.6, color: ICE_TINT.swirl, life: S.duration - 0.1, fadeIn: 0.35, fadeOut: 0.5, fps: 6, loop: true, alpha: 0.8, soft: 0.5 }));
    } else {
      const S = kit.skill2;
      fl.gf = frost.add({ x, z, radius: S.r * 1.15, seed });
      // the glyph's inner glow fills with frost under it, then the glyph
      fl.disc = keep(fx.add({ frame: 'partyIceGlow', mode: 'flat', x, y: y - 0.03, z, size: S.r * 0.4, sizeTo: S.r * 1.0, grow: S.delay, rot: fl.a, color: fl.discRgb, life: S.delay + S.hold + 0.4, alpha: 0, soft: GLOW_DISC.soft }));
      keep(fx.add({ frame: 'partyGlyphFrost', mode: 'flat', x, y, z, size: 1.2, sizeTo: S.r * 2, grow: S.delay, rot: fl.a, spin: 1.6, color: ICE_TINT.glyph, life: S.delay + S.hold + 0.2, fadeIn: 0.1, fadeOut: 0.3, alpha: GLYPH_A }));
      this._planTomb(fl, S);
      this._mist(x, fl.y, z, 1.6, 0.9);
    }
    // one light per ice mage: a spell of hers still holding one hands it over
    const prev = this._fields.find((q) => q !== fl && q.on && q.light);
    if (prev) {
      fl.light = prev.light;
      prev.light = null;
    } else fl.light = this._acquireLight();
  }

  // ------------------------------------------------------------------------------------------
  // The spells on the ground
  // ------------------------------------------------------------------------------------------

  /**
   * The Tomb's crystals: the outer ring (a small crystal beside each) sweeping from her side round
   * to the far side, the inner ring after it, the great centre spike last — its overshoot's peak is
   * the hit (`delay`). Each leans outward a little, its own height, girth and turn.
   * @param {IceField} fl
   * @param {VqCasterKit['skill2']} S
   */
  _planTomb(fl, S) {
    const sys = this.sys;
    const rng = this.rng;
    const outer = Math.ceil(S.spikes * 0.6);
    const inner = S.spikes - outer;
    const ap = Math.atan2(fl.fromZ - fl.z, fl.fromX - fl.x);
    /** @type {(a: number) => number} 0 her side … 1 the far side */
    const order = (a) => Math.abs(wrapPi(a - ap)) / Math.PI;
    // (the camera's side of the ring stands lower: the frozen foes inside stay in view)
    const cfx = sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    /** @type {(a: number) => number} a crystal's height factor at angle a round the centre */
    const tall = (a) => TOMB.size * (1 - TOMB.nearLow * Math.max(0, -(Math.cos(a) * vx + Math.sin(a) * vz)));
    // (and a crystal standing just in front of a foe, as the camera sees it, stands lower still:
    // the frozen foes stay in view — read only, nothing of the fight changes)
    /** @type {{ x: number, z: number }[]} */
    const foes = [];
    for (const e of sys.enemies) if (e.alive && Math.hypot(e.position.x - fl.x, e.position.z - fl.z) < S.r + 1) foes.push(e.position);
    /** @type {(x: number, z: number) => boolean} */
    const screens = (x, z) => foes.some((p) => {
      const dx = p.x - x;
      const dz = p.z - z;
      const depth = dx * vx + dz * vz;
      return depth > -0.3 && depth < TOMB.screenDepth && Math.abs(dx * vz - dz * vx) < TOMB.screenSide;
    });
    /** @type {(x: number, z: number, height: number, radius: number, lean: number, start: number, ord: number, small: boolean) => void} */
    const push = (x, z, height, radius, lean, start, ord, small) => {
      let ux = x - fl.x;
      let uz = z - fl.z;
      const d = Math.hypot(ux, uz);
      if (d > 1e-3) {
        ux /= d;
        uz /= d;
      } else {
        const a = rng.next() * Math.PI * 2;
        ux = Math.cos(a);
        uz = Math.sin(a);
      }
      const side = (rng.next() - 0.5) * 0.24;
      fl.spikes.push({
        x, y: sys.groundAt(x, z) - TOMB.sink, z, height: screens(x, z) ? height * TOMB.screenLow : height, radius, yaw: rng.next() * Math.PI * 2,
        tiltX: ux * lean - uz * side, tiltZ: uz * lean + ux * side, seed: (rng.next() * 0x7fffffff) | 0,
        start, h: -1, order: ord, small, dx: ux, dz: uz, r: 0,
      });
    };
    for (let i = 0; i < outer; i++) {
      const a = fl.a + (i * Math.PI * 2) / outer + (rng.next() - 0.5) * 0.2;
      const ring = S.r * (0.78 + 0.08 * rng.next());
      const o = order(a);
      const start = S.delay - TOMB.outer + TOMB.sweep * o;
      const k = tall(a);
      push(fl.x + Math.cos(a) * ring, fl.z + Math.sin(a) * ring, (1.15 + 0.45 * rng.next()) * k, 0.24 + 0.08 * rng.next(), 0.3 + 0.2 * rng.next(), start, o, false);
      // a small crystal at its side
      const a2 = a + (rng.next() < 0.5 ? -1 : 1) * (0.15 + 0.08 * rng.next());
      const r2 = ring * (0.9 + 0.14 * rng.next());
      push(fl.x + Math.cos(a2) * r2, fl.z + Math.sin(a2) * r2, (0.55 + 0.25 * rng.next()) * k, 0.14 + 0.05 * rng.next(), 0.35 + 0.25 * rng.next(), start + 0.03, o, true);
    }
    for (let i = 0; i < inner; i++) {
      const a = fl.a + ((i + 0.5) * Math.PI * 2) / inner + (rng.next() - 0.5) * 0.25;
      const ring = S.r * (0.38 + 0.08 * rng.next());
      const o = order(a);
      push(fl.x + Math.cos(a) * ring, fl.z + Math.sin(a) * ring, (1.5 + 0.4 * rng.next()) * tall(a) * TOMB.innerLow, 0.28 + 0.08 * rng.next(), 0.16 + 0.12 * rng.next(), S.delay - TOMB.inner + TOMB.innerSweep * o, o, false);
    }
    // the centre, a little beyond it (it frames the foe there, never hides it): its peak is the hit
    push(fl.x + vx * TOMB.centreBack + (rng.next() - 0.5) * 0.2, fl.z + vz * TOMB.centreBack + (rng.next() - 0.5) * 0.2, 2.2 * TOMB.size, 0.45, 0.06, S.delay - TOMB.rise * TOMB.peakAt, 0.5, false);
  }

  /**
   * A spell's look ends early or late: its quads, crystals, frost and light go.
   * @param {IceField} fl
   */
  _closeField(fl) {
    for (const r of fl.fx) this.fx.kill(r);
    fl.fx.length = 0;
    fl.disc = null;
    for (let i = 0; i < fl.tipFx.length; i++) {
      if (fl.tipFx[i]) this.fx.kill(fl.tipFx[i]);
      fl.tipFx[i] = null;
    }
    const { crystals, frost } = this.stage;
    for (const sp of fl.spikes) {
      if (sp.h >= 0) crystals.free(sp.h);
      sp.h = -1;
    }
    fl.spikes.length = 0;
    if (fl.gf >= 0) frost.free(fl.gf);
    fl.gf = -1;
    if (fl.light) {
      fl.light.off();
      fl.light.release();
    }
    fl.light = null;
    fl.on = false;
  }

  /**
   * The Blizzard's layers on its clock: the far streaks high up, the mid snow, shards and glints on
   * a beat; the flakes circling the centre, the near flakes (bokeh), the hail, the mist banks on
   * their own timers.
   * @param {IceField} fl
   * @param {number} h
   */
  _stepBlizzard(fl, h) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill;
    const sys = this.sys;
    const rng = this.rng;
    const live = fl.t < S.duration;
    const k = Math.floor(fl.t * 10);
    if (k !== fl.m && live) {
      fl.m = k;
      const a = fl.a + k * 2.39996;
      const rr = S.r * (0.25 + 0.6 * (((k * 7) % 10) / 10));
      const x = fl.x + Math.cos(a) * rr;
      const z = fl.z + Math.sin(a) * rr;
      const g = sys.groundAt(x, z);
      sys.burst('partySnowStreak', fl.x - 1.2, fl.y + 4.6, fl.z - 0.4, 10);
      sys.burst('partySnowfall', x, g + 2.8, z, 9);
      if (k % 2 === 0) sys.burst('partyFrostShards', x, g + 0.9, z, 2);
      if (k % 3 === 0) sys.burst('partyFrostGlint', x, g + 1.2, z, 3);
    }
    if (fl.t >= S.duration + STORM.recede + 0.2) {
      this._closeField(fl);
      return;
    }
    if (!live) return;
    // the flakes circling the centre
    fl.flake -= h;
    if (fl.t < S.duration - 0.3 && fl.flake <= 0 && this._flakes.length < STORM.flakes) {
      fl.flake += 0.07;
      const rec = this.fx.add({ frame: 'partyIceFlake', mode: 'billboard', x: fl.x, y: fl.y, z: fl.z, scale: 0.55 + 0.25 * rng.next(), color: ICE_TINT.flake, life: Infinity, frames: [rng.next() < 0.5 ? 0 : 1], rot: rng.next() * 6.3, spin: 2 + 2 * rng.next(), alpha: 0, halo: 1 });
      if (rec) {
        const r = S.r * (0.45 + 0.5 * rng.next());
        this._flakes.push({ rec, fl, a: rng.next() * Math.PI * 2, r, y: 0.7 + 2.0 * rng.next(), w: 2.6 * (S.r / (r + 1)), vy: -0.45 - 0.4 * rng.next(), age: 0, life: 1.1 + 0.5 * rng.next() });
      }
    }
    // a few big flakes between the camera and the field (the depth of field turns them into bokeh)
    fl.near -= h;
    if (fl.near <= 0 && fl.t < S.duration - 0.6) {
      fl.near += 0.2 + 0.15 * rng.next();
      let n = 0;
      for (const d of this._drifts) if (d.rec.frame === 'partyIceBokeh') n++;
      if (n < STORM.near) this._nearFlake(fl);
    }
    // hail: shards falling slantwise down the wind, landing in puffs
    fl.hail -= h;
    if (fl.hail <= 0 && fl.t < S.duration - 0.4) {
      fl.hail += 0.11;
      const w = this._windDir();
      const a = rng.next() * Math.PI * 2;
      const rr = S.r * Math.sqrt(rng.next()) * 0.9;
      const tx = fl.x + Math.cos(a) * rr;
      const tz = fl.z + Math.sin(a) * rr;
      const fall = 0.42;
      const vx = w.x * 3.2;
      const vz = w.z * 3.2;
      const g = sys.groundAt(tx, tz);
      this._shard(tx - vx * fall, g + 2.9, tz - vz * fall, vx, -5.5, vz, 0.32 + 0.14 * rng.next(), 0.9);
    }
    // low mist banks drifting with the wind, round the storm's rim
    fl.mist -= h;
    if (fl.mist <= 0 && fl.t < S.duration - 0.5) {
      fl.mist += 0.4;
      const a = rng.next() * Math.PI * 2;
      const rr = S.r * (0.7 + 0.35 * rng.next());
      const x = fl.x + Math.cos(a) * rr;
      const z = fl.z + Math.sin(a) * rr;
      this._mist(x, sys.groundAt(x, z), z, 1.7 + 0.8 * rng.next(), 1.5);
    }
  }

  /**
   * The Tomb on its clock: its crystals rise when their time comes; at `delay` (the move's hit) the
   * ring, the bursts and the shake; after `hold` s the spikes burst into shards.
   * @param {IceField} fl
   */
  _stepTomb(fl) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill2;
    const sys = this.sys;
    const EPS = 1e-6;
    if (fl.n < 2) {
      for (const sp of fl.spikes) {
        if (sp.h !== -1 || fl.t < sp.start - EPS) continue;
        // (a full batch: −2, never tried again)
        sp.h = this.stage.crystals.spawn(sp);
        if (sp.h < 0) {
          sp.h = -2;
          continue;
        }
        if (sp.small) continue;
        sys.burst('partyIceChunks', sp.x, sp.y + 0.2, sp.z, 2);
        sys.burst('partyFrostShards', sp.x, sp.y + 0.5, sp.z, 2);
        if (fl.m < 0) {
          // the first crystal breaks the ground
          fl.m = 1;
          sys.sfxAt('iceSpike', fl.x, fl.z, { volume: 0.6, pitch: 1.25 });
        }
      }
    }
    if (fl.n === 0 && fl.t >= S.delay - EPS) {
      fl.n = 1;
      const ring = this.fx.add({ frame: 'partyRing', mode: 'flat', x: fl.x, y: fl.y + FLAT_LIFT + 0.03, z: fl.z, size: 2, sizeTo: S.r * 2.3, grow: 0.3, color: ICE_TINT.ring, life: 0.4, fadeOut: 0.2, fps: 0, alpha: RING_A, soft: 0.3 });
      if (ring) fl.fx.push(ring);
      sys.burst('partyFrostShards', fl.x, fl.y + 0.6, fl.z, 10);
      sys.burst('partyIceChunks', fl.x, fl.y + 0.3, fl.z, 8);
      sys.burst('partyFrostGlint', fl.x, fl.y + 1.4, fl.z, 6);
    }
    if (fl.n === 1 && fl.t >= S.delay + S.hold - EPS) {
      fl.n = 2;
      this._shatterTomb(fl);
      sys.burst('partyIceChunks', fl.x, fl.y + 0.6, fl.z, 10);
      sys.burst('partyFrostGlint', fl.x, fl.y + 1.0, fl.z, 6);
    }
    if (fl.t >= S.delay + S.hold + TOMB.recede + 0.1) this._closeField(fl);
  }

  /**
   * The Tomb's spikes burst: each into shards flung outward and up (the tall ones into more), mist
   * where they stood.
   * @param {IceField} fl
   */
  _shatterTomb(fl) {
    const rng = this.rng;
    const sys = this.sys;
    for (const sp of fl.spikes) {
      if (sp.h < 0) continue;
      this.stage.crystals.free(sp.h);
      sp.h = -1;
      const n = sp.small ? 1 : sp.height > 2 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const k = 0.25 + 0.55 * rng.next();
        const x = sp.x + sp.tiltX * k;
        const z = sp.z + sp.tiltZ * k;
        const y = sp.y + sp.height * k;
        const out = 1.2 + 2.2 * rng.next();
        const lat = (rng.next() - 0.5) * 2;
        const vx = sp.dx * out - sp.dz * lat;
        const vz = sp.dz * out + sp.dx * lat;
        const scale = sp.small ? 0.5 + 0.15 * rng.next() : 0.7 + 0.35 * rng.next();
        this._shard(x, y, z, vx, 2.2 + 2.6 * rng.next(), vz, scale, TOMB.shardLife[0] + (TOMB.shardLife[1] - TOMB.shardLife[0]) * rng.next());
      }
      if (!sp.small && rng.next() < 0.5) sys.burst('partyIcePuff', sp.x, sp.y + 0.3, sp.z, 2);
    }
    this._mist(fl.x, fl.y, fl.z, 2.4, 1.2);
  }

  /**
   * A big flake on the line between the camera and the field, off to one side of it, drifting down
   * the wind.
   * @param {IceField} fl
   */
  _nearFlake(fl) {
    const rng = this.rng;
    const cam = globalUniforms.uCameraPosition.value;
    const f = 0.45 + 0.17 * rng.next();
    const cfx = this.sys.fx;
    const vx = cfx ? cfx.viewX : 0;
    const vz = cfx ? cfx.viewZ : -1;
    const side = (rng.next() < 0.5 ? -1 : 1) * (2.2 + 3 * rng.next());
    const px = fl.x - vz * side;
    const pz = fl.z + vx * side;
    const py = fl.y + 1.2 + 1.5 * rng.next();
    const x = px + (cam.x - px) * f;
    const y = py + (cam.y - py) * f;
    const z = pz + (cam.z - pz) * f;
    const rec = this.fx.add({ frame: 'partyIceBokeh', mode: 'billboard', x, y, z, scale: 0.24 + 0.16 * rng.next(), color: ICE_TINT.flakeNear, life: Infinity, alpha: 0 });
    if (!rec) return;
    const w = this._windDir();
    this._drifts.push({ rec, vx: w.x * 1.4, vy: -1.1, vz: w.z * 1.4, age: 0, life: 1.1 + 0.4 * rng.next() });
  }

  /**
   * A bank of cold mist (cut-out, its rim thinning: FxQuads `soft`), drifting with the wind.
   * @param {number} x
   * @param {number} g the ground
   * @param {number} z
   * @param {number} size u across
   * @param {number} life s
   */
  _mist(x, g, z, size, life) {
    const rng = this.rng;
    const rec = this.fx.add({ frame: 'partyIceMist', mode: 'billboard', x, y: g + size * 0.16, z, size, color: ICE_TINT.mist, life: Infinity, frames: [Math.floor(rng.next() * 3)], alpha: 0, soft: 0.85 });
    if (!rec) return;
    const w = this._windDir();
    this._drifts.push({ rec, vx: w.x * 0.45, vy: 0.08, vz: w.z * 0.45, age: 0, life });
  }

  /** The wind's direction on XZ (unit; the global wind uniform). @returns {{ x: number, z: number }} */
  _windDir() {
    const w = globalUniforms.uWind.value;
    const l = Math.hypot(w.x, w.y) || 1;
    const o = this._wind;
    o.x = w.x / l;
    o.z = w.y / l;
    return o;
  }

  /**
   * An ice shard (two quads: its body, its lit facets over it) thrown from (x, y, z): it flies,
   * bounces once on the ground (a puff), rests and dissolves in dither steps.
   * @param {number} x @param {number} y @param {number} z
   * @param {number} vx @param {number} vy @param {number} vz
   * @param {number} scale (the frame is 10 px: 0.625 u × scale)
   * @param {number} life s
   */
  _shard(x, y, z, vx, vy, vz, scale, life) {
    if (this._shards.length >= SHARDS_MAX) return;
    const rng = this.rng;
    const idx = Math.floor(rng.next() * 4);
    const rot = rng.next() * Math.PI * 2;
    const body = this.fx.add({ frame: 'partyIceShard', mode: 'billboard', x, y, z, scale, rot, color: ICE_TINT.shard, life: Infinity, frames: [idx] });
    if (!body) return;
    const lit = this.fx.add({ frame: 'partyIceShardLit', mode: 'billboard', x, y, z, scale, rot, color: ICE_TINT.shardLit, life: Infinity, frames: [idx], back: LIT_BACK, halo: 1 });
    this._shards.push({ body, lit, x, y, z, vx, vy, vz, spin: (rng.next() - 0.5) * 14, age: 0, life, bounced: false, half: 0.2 * scale });
  }

  // ------------------------------------------------------------------------------------------
  // Per sub-step, per frame
  // ------------------------------------------------------------------------------------------

  /** @param {number} h combat seconds of the sub-step (MemberCombat._stepHero) */
  step(h) {
    for (const fl of this._fields) {
      if (!fl.on) continue;
      fl.t += h;
      if (fl.kind === 'blizzard') this._stepBlizzard(fl, h);
      else this._stepTomb(fl);
    }
    this._stepFlakes(h);
    this._stepDrifts(h);
    this._stepShards(h);
    this.fx.step(h);
  }

  /** The circling flakes: round the centre, inward a little, down; in and out in dither. @param {number} h */
  _stepFlakes(h) {
    const list = this._flakes;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      f.age += h;
      if (f.age >= f.life) {
        this.fx.kill(f.rec);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      f.a += f.w * h;
      f.r *= Math.exp(-0.15 * h);
      f.y = Math.max(0.15, f.y + f.vy * h);
      const r = f.rec;
      r.x = f.fl.x + Math.cos(f.a) * f.r;
      r.z = f.fl.z + Math.sin(f.a) * f.r;
      r.y = f.fl.y + f.y;
      r.alpha = clamp01(Math.min(f.age / 0.15, (f.life - f.age) / 0.3));
    }
  }

  /** The near flakes and the mist banks drift; in and out in dither. @param {number} h */
  _stepDrifts(h) {
    const list = this._drifts;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.age += h;
      if (d.age >= d.life) {
        this.fx.kill(d.rec);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      const r = d.rec;
      r.x += d.vx * h;
      r.y += d.vy * h;
      r.z += d.vz * h;
      const mist = r.frame === 'partyIceMist';
      r.alpha = clamp01(Math.min(d.age / (mist ? 0.3 : 0.2), (d.life - d.age) / (mist ? 0.55 : 0.35))) * (mist ? 0.85 : 1);
    }
  }

  /**
   * The shards: gravity, one bounce (a puff of frost where they land), then they slide to rest and
   * dissolve in dither steps over their last `TOMB.dissolve` s.
   * @param {number} h
   */
  _stepShards(h) {
    const sys = this.sys;
    const list = this._shards;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.age += h;
      if (s.age >= s.life) {
        this.fx.kill(s.body);
        this.fx.kill(s.lit);
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      s.vy -= SHARD_G * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
      s.z += s.vz * h;
      const g = sys.groundAt(s.x, s.z);
      if (s.y - s.half <= g && s.vy <= 0) {
        s.y = g + s.half;
        if (!s.bounced) {
          s.bounced = true;
          s.vy = -s.vy * 0.3;
          s.vx *= 0.45;
          s.vz *= 0.45;
          s.spin *= 0.4;
          sys.burst('partyIcePuff', s.x, g + 0.08, s.z, 2);
        } else {
          s.vy = 0;
          const k = Math.exp(-10 * h);
          s.vx *= k;
          s.vz *= k;
          s.spin *= k;
        }
      }
      const a = clamp01((s.life - s.age) / TOMB.dissolve);
      placeShard(s.body, s, h, a);
      if (s.lit) placeShard(s.lit, s, h, a);
    }
  }

  /**
   * Once a frame (MemberCombat.afterFrame, after the combat moved): the lances follow their
   * missiles, the spells' look (crystals, frost, glow disc, lights, gust), the shells, the impact
   * sparks, the staff's star, the crystal's glow, her quads written (dimmed after dark).
   * @param {number} dt combat seconds of this frame (0 in hit-stop or while the combat waits: everything holds)
   */
  visuals(dt) {
    for (const L of this._lances) {
      if (L.body) placeLance(L.body, L.ms, 0);
      if (L.lit) placeLance(L.lit, L.ms, LIT_DY);
    }
    let gust = 0;
    for (const fl of this._fields) {
      if (!fl.on) continue;
      if (fl.kind === 'blizzard') gust = Math.max(gust, this._stormLook(fl));
      else this._tombLook(fl);
    }
    this.gust = this._settling ? 0 : gust;
    this._shellsLook();
    this._sparksLook(dt);
    if (this._settling) {
      // (a scene's settle: no star, no glow; `settle` writes the quads)
      return;
    }
    const mc = this.mc;
    // the charge: one of her moves running, its release / `at` not reached yet
    const move = mc.move;
    const G = move === 'frostLance' || move === 'blizzard' || move === 'glacialTomb' ? GLOW[move] : null;
    const kit = /** @type {VqCasterKit} */ (mc.kit);
    const rel = move === 'frostLance' ? kit.basic.release : move === 'blizzard' ? kit.skill.at : move === 'glacialTomb' ? kit.skill2.at : 0;
    const charging = !!G && !mc.down && mc.frame < rel;
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
    this._writeGlow(this.glow);
    // the star at the crystal while she charges
    if (charging) {
      const c = this._crystalAt();
      if (!this._star) this._star = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: c.x, y: c.y, z: c.z, scale: 0.3, color: ICE_TINT.star, life: Infinity, frames: [0], spin: 2.0, back: -0.25, halo: 1 });
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
    const cfx = this.sys.fx;
    // (the night's higher exposure would turn the lit ice white: her tints dim after dark)
    this.fx.write(cfx ? cfx.viewX : 0, cfx ? cfx.viewZ : -1, 1 - NIGHT_DIM * globalUniforms.uNight.value);
  }

  /**
   * The Tomb's look at its time: the crystals (rise, glints, glow, cracks), the frost (cracks
   * racing from her staff, the spread at the eruption, the recession), the glow disc filling, the
   * stars riding the cracks, the light (a faint charge, the flash, the hold, the shatter's blink).
   * @param {IceField} fl
   */
  _tombLook(fl) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill2;
    const { crystals, frost } = this.stage;
    const t = fl.t;
    const hitT = S.delay;
    const endT = S.delay + S.hold;
    const crack = smooth((t - (endT - TOMB.crackT)) / TOMB.crackT);
    const flare = t >= hitT ? Math.exp(-(t - hitT) / 0.15) : 0;
    const cp = this._crysP;
    const cday = dayK(DAY.crystal);
    for (const sp of fl.spikes) {
      if (sp.h < 0) continue;
      const g0 = hitT + 0.08 + 0.3 * sp.order;
      const g1 = g0 + 0.42;
      cp.rise = riseAt((t - sp.start) / TOMB.rise);
      cp.crack = crack;
      cp.glint = t < g1 ? clamp01((t - g0) / TOMB.glintT) : clamp01((t - g1) / TOMB.glintT);
      const born = Math.max(0, t - sp.start - TOMB.rise * TOMB.peakAt);
      cp.glow = (1 + 0.35 * Math.exp(-born / 0.1) + 0.2 * flare + 0.5 * crack) * cday;
      crystals.set(sp.h, cp);
      sp.r = cp.rise;
    }
    if (fl.gf >= 0) {
      const eruptT = hitT - TOMB.outer;
      const fp = this._frostP;
      // (painted over a few frames: the cracks run from then, still reaching the ring on time)
      if (fl.ready < 0 && frost.ready(fl.gf)) fl.ready = t;
      const r0 = fl.ready;
      fp.spread = t < eruptT ? 0.12 * smooth(t / eruptT) : 0.12 + 0.88 * smooth((t - eruptT) / (TOMB.outer + 0.25));
      fp.fade = smooth((t - endT) / TOMB.recede);
      fp.cracks = r0 < 0 ? 0 : smooth((t - r0) / Math.max(0.05, hitT - TOMB.crackLead - r0));
      fp.glow = (1 + 0.8 * flare) * dayK(DAY.glow);
      fp.crackFrom.x = fl.fromX;
      fp.crackFrom.z = fl.fromZ;
      frost.set(fl.gf, fp);
      fl.fade = fp.fade;
    }
    const disc = fl.disc;
    if (disc) {
      const fill = smooth(t / hitT);
      // (it spends itself in the eruption: gone within `discOut` s, so it never veils the frozen foes)
      const fade = 1 - smooth((t - hitT) / TOMB.discOut);
      const kk = 0.35 + 0.65 * fill;
      for (let i = 0; i < 3; i++) fl.discRgb[i] = GLOW_DISC.rgb[i] * kk;
      disc.alpha = GLOW_DISC.alpha * fill * fade;
    }
    // the anticipation: a star rides each running crack (the grass hides the cracks themselves)
    const nt = t < hitT && fl.gf >= 0 ? frost.crackTips(fl.gf, this._tips) : 0;
    for (let i = 0; i < fl.tipFx.length; i++) {
      const r = fl.tipFx[i];
      if (!r) continue;
      if (i >= nt) {
        this.fx.kill(r);
        fl.tipFx[i] = null;
        continue;
      }
      const q = this._tips[i];
      r.x = q.x;
      r.y = q.y + 0.3;
      r.z = q.z;
    }
    for (let i = 0; i < nt; i++) {
      if (fl.tipFx[i]) continue;
      const q = this._tips[i];
      fl.tipFx[i] = this.fx.add({ frame: 'partySunburst', mode: 'billboard', x: q.x, y: q.y + 0.3, z: q.z, scale: 0.42, color: ICE_TINT.star, life: Infinity, frames: [0], spin: 5, back: -0.3, halo: 1 });
    }
    const L = fl.light;
    if (L) {
      const lp = this._lightP;
      const day = dayK(DAY.light);
      lp.color = LIGHT.tombColor;
      lp.decay = 1;
      if (t < hitT) {
        // (the charge rides the leading crack; once they are round, it sits over the glyph)
        const q = nt > 0 ? this._tips[0] : null;
        lp.intensity = Math.min(LIGHT.cap, LIGHT.charge * (0.3 + 0.7 * smooth(t / hitT)) * day);
        lp.distance = LIGHT.chargeDistance;
        if (q) L.set(q.x, q.y + LIGHT.chargeLift, q.z, lp);
        else L.set(fl.x, fl.y + LIGHT.chargeLift * 2, fl.z, lp);
      } else if (fl.n >= 2 && t > endT + 0.5) {
        L.off();
        L.release();
        fl.light = null;
      } else {
        // (the flash and the shatter blink age on the frame's own time: through the hit-stop)
        const ph = fl.n < 2 ? 1 : 2;
        if (fl.lph !== ph) {
          fl.lph = ph;
          fl.lt = 0;
        } else fl.lt += this._frameDt;
        let I;
        let f;
        if (ph === 1) {
          f = Math.exp(-fl.lt / LIGHT.flashTau);
          I = LIGHT.hold * day + (LIGHT.flash - LIGHT.hold) * f * dayK(DAY.flash);
        } else {
          f = Math.exp(-fl.lt / 0.1);
          I = LIGHT.shatter * f * dayK(DAY.flash) + LIGHT.hold * (1 - smooth((t - endT) / 0.4)) * (1 - f) * day;
        }
        // (the flash's falloff gentle, the hold's the lamps': a glow from the ice, no wash)
        lp.decay = LIGHT.holdDecay + (1 - LIGHT.holdDecay) * f;
        lp.intensity = Math.min(LIGHT.cap, I);
        lp.distance = LIGHT.tombDistance;
        L.set(fl.x, fl.y + LIGHT.tombLift, fl.z, lp);
      }
    }
  }

  /**
   * The Blizzard's look at its time: the frost building up and receding, the dim flickering light
   * circling over the field. Returns its gust (Weather.gust).
   * @param {IceField} fl
   * @returns {number}
   */
  _stormLook(fl) {
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill;
    const t = fl.t;
    const env = smooth(t / 0.35) * (1 - smooth((t - S.duration) / 0.5));
    if (fl.gf >= 0) {
      const fp = this._frostP;
      fp.spread = 0.1 + 0.9 * smooth(t / S.duration);
      fp.fade = smooth((t - S.duration) / STORM.recede);
      fp.cracks = 0;
      fp.glow = dayK(DAY.glow);
      fp.crackFrom.x = fl.x;
      fp.crackFrom.z = fl.z;
      this.stage.frost.set(fl.gf, fp);
      fl.fade = fp.fade;
    }
    const L = fl.light;
    if (L) {
      if (t > S.duration + 0.6) {
        L.off();
        L.release();
        fl.light = null;
      } else {
        const flick = 0.78 + 0.22 * (0.6 * Math.sin(t * 23.1) + 0.4 * Math.sin(t * 37.7 + 1.3));
        const kick = hash2(Math.floor(t * 6), fl.tag, 77) > 0.8 ? 1.5 : 1;
        const lp = this._lightP;
        lp.color = LIGHT.stormColor;
        lp.decay = 1;
        lp.intensity = Math.min(LIGHT.cap, LIGHT.storm * env * flick * kick * dayK(DAY.light));
        lp.distance = LIGHT.stormDistance;
        L.set(fl.x + Math.cos(t * 2.4) * 0.9, fl.y + LIGHT.stormLift, fl.z + Math.sin(t * 2.4) * 0.9, lp);
      }
    }
    return STORM.gust * smooth(t / STORM.gustRise) * (1 - smooth((t - S.duration) / STORM.gustFall)) * (0.85 + 0.15 * Math.sin(t * 4.3));
  }

  /**
   * The frozen foes' ice shells: one for every living foe frozen inside one of her standing Tombs
   * (grown over it, kept on it while it stays frozen — after the Tomb too), shattered into shards
   * when its freeze ends or it dies. A foe another ice mage's shell already covers gets none.
   */
  _shellsLook() {
    const sys = this.sys;
    const S = /** @type {VqCasterKit} */ (this.mc.kit).skill2;
    let tombs = false;
    for (const fl of this._fields) if (fl.on && fl.kind === 'glacialTomb' && fl.n >= 1) tombs = true;
    if (tombs && !this._settling) {
      const list = sys.enemies;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || !e.frozen || !e.sprite.visible || e.iceShell || this._shells.has(e)) continue;
        const p = e.position;
        let inside = false;
        for (const fl of this._fields) {
          if (fl.on && fl.kind === 'glacialTomb' && fl.n >= 1 && Math.hypot(p.x - fl.x, p.z - fl.z) <= S.r + e.radius + 0.25) inside = true;
        }
        if (!inside) continue;
        const b = e.def.body;
        const H = Math.max(0.6, b[1] - b[0]) + 0.2;
        const scale = H / (38 / 16);
        const y = sys.bodyBase(e) + b[0] + H / 2 - 0.12;
        const back = -(e.radius * 0.6 + 0.12);
        const idx = hashString(String(e.uid)) & 1;
        const body = this.fx.add({ frame: 'partyIceShell', mode: 'billboard', x: p.x, y, z: p.z, scale: scale * 1.15, scaleTo: scale, grow: 0.09, color: ICE_TINT.shell, life: Infinity, frames: [idx], back, follow: p });
        if (!body) continue;
        const rgb = [...ICE_TINT.shellLit];
        const lit = this.fx.add({ frame: 'partyIceShellLit', mode: 'billboard', x: p.x, y, z: p.z, scale: scale * 1.15, scaleTo: scale, grow: 0.09, color: rgb, life: Infinity, frames: [idx], back: back + LIT_BACK, follow: p, halo: 1 });
        e.iceShell = true;
        this._shells.set(e, { e, body, lit, rgb, ph: this.rng.next() });
      }
    }
    const clock = sys.clock;
    for (const s of this._shells.values()) {
      const e = s.e;
      if (e.alive && e.frozen && e.sprite.visible) {
        // the glint: a short flare of the lit layer every ~0.9 s, each shell on its own beat
        const u = (clock / 0.9 + s.ph) % 1;
        const k = 1 + 0.55 * Math.max(0, 1 - Math.abs(u - 0.5) / 0.08);
        for (let c = 0; c < 3; c++) s.rgb[c] = ICE_TINT.shellLit[c] * k;
        // (`_back`: gone in a scene's settle, coming back after it)
        s.body.alpha = this._back;
        if (s.lit) s.lit.alpha = this._back;
        continue;
      }
      this._shatterShell(s);
      this._shells.delete(e);
    }
  }

  /**
   * A shell shatters: its quads go, shards fly off the body, a puff.
   * @param {Shell} s
   */
  _shatterShell(s) {
    s.e.iceShell = false;
    const rng = this.rng;
    const sys = this.sys;
    const b = s.body;
    const cfx = sys.fx;
    const x = b.x + (cfx ? cfx.viewX : 0) * b.back;
    const z = b.z + (cfx ? cfx.viewZ : -1) * b.back;
    const H = b.s1 * (38 / 16);
    this.fx.kill(s.body);
    this.fx.kill(s.lit);
    for (let i = 0; i < 6; i++) {
      const a = rng.next() * Math.PI * 2;
      const v = 1.3 + 1.6 * rng.next();
      this._shard(x + Math.cos(a) * 0.25, b.y + (rng.next() - 0.5) * H * 0.6, z + Math.sin(a) * 0.25, Math.cos(a) * v, 1.8 + 1.8 * rng.next(), Math.sin(a) * v, 0.45 + 0.25 * rng.next(), 0.8 + 0.3 * rng.next());
    }
    sys.burst('partyIcePuff', x, b.y, z, 3);
  }

  /** The lances' impact sparks: a light's quick fall. @param {number} dt */
  _sparksLook(dt) {
    const list = this._sparks;
    const lp = this._lightP;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.t += dt;
      // (its light taken over by a spell — VfxLights.acquire: the spark is over at once)
      if (s.t >= LIGHT.impactT || !s.light.held) {
        s.light.off();
        s.light.release();
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      const k = 1 - s.t / LIGHT.impactT;
      lp.color = LIGHT.impactColor;
      lp.decay = 1;
      lp.intensity = LIGHT.impact * k * k * dayK(DAY.light);
      lp.distance = LIGHT.impactDistance;
      s.light.set(s.x, s.y, s.z, lp);
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
   * The staff crystal's world spot in the cell her sprite shows (the sheet's glow texels; without
   * them: above the right hand).
   * @returns {{ x: number, y: number, z: number }}
   */
  _crystalAt() {
    const mc = this.mc;
    const p = mc.member.position;
    const o = this._crys;
    const cell = this._crystal?.[mc._lastRow]?.[mc._lastCol] ?? null;
    const right = cell ? cell.right : 0.3;
    const up = cell ? cell.up : 1.7;
    const yaw = globalUniforms.uCameraYaw.value;
    o.x = p.x + Math.cos(yaw) * right;
    o.y = p.y + up;
    o.z = p.z - Math.sin(yaw) * right;
    return o;
  }

  /** Tests: her look's state (`heroInfo().ice`). @returns {import('./types.js').IceLookState} */
  info() {
    return {
      effects: this.fx.count, glow: +this.glow.toFixed(3), star: !!this._star, lances: this._lances.length,
      fields: this._fields.filter((f) => f.on).map((f) => f.kind), flakes: this._flakes.length, drifts: this._drifts.length,
      shards: this._shards.length, shells: this._shells.size,
      crystals: this._fields.reduce((n, f) => n + f.spikes.filter((s) => s.h >= 0).length, 0),
      frost: this._fields.filter((f) => f.on && f.gf >= 0).length, gust: +this.gust.toFixed(2),
      lights: { ...this.lights, held: this._fields.filter((f) => f.on && f.light?.held).length + this._sparks.filter((s) => s.light.held).length },
    };
  }
}
