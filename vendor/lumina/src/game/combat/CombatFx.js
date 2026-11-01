/**
 * CombatFx — the named one-shot effects of COMBAT.md §11.5, drawn as FxQuads instances (one draw
 * call for all of them): slash arcs, the A3 thrust streak, the Whirl Slash ring, hit / crit stars,
 * dust puffs, dizzy stars over a stunned enemy and the level-up pillar. `play(name, x, y, z, opts)`
 * (the context's `ctx.fx`) takes the ground height as `y`; each effect adds its own lift.
 *
 * Effects advance on the combat clock (they freeze with everything else during hit-stop — the
 * slash arc hangs in the air for the impact frames). A full pool drops the new effect.
 *
 * Any atlas frame plays too (COMBAT.md §29 V9): `play(frame, x, y, z, opts)` with a frame of the
 * atlas that is no named effect — a package's frames (FxSprites ./fx/*Fx.js: a spell's ground glyph,
 * a breath cone, a flame pillar) — takes its look from `opts` (`mode`, `lift`, `color`, `loops` /
 * `loop` + `duration`, `rot`, `spin`, `grow`, `back`, `fps`, besides the named effects' `dir`,
 * `flip`, `scale`, `follow`); every effect is one quad of the same batch (no program, no draw call).
 */

/**
 * @import { FxName, FxOptions } from './types.js'
 * @import { FxQuads, FxQuadParams } from '../../engine/fx/FxQuads.js'
 */

/**
 * The look and timing of a named effect (`EFFECTS`).
 * @typedef {object} FxDef
 * @property {string} frame      atlas frame
 * @property {'flat'|'billboard'|'screen'} mode  a ground-parallel quad along the effect's axis, or
 *   facing the camera (upright; 'screen': fully)
 * @property {number} lift       u above the given ground height
 * @property {number[]} color    HDR colour [r, g, b]
 * @property {number} [loops]    one-shots: plays of the frame strip (1)
 * @property {boolean} [loop]    loops until its duration ends
 * @property {number} [duration] looping effects: seconds (the `duration` option overrides it)
 * @property {number} scale
 * @property {number} [rot]      in-plane turn (rad)
 * @property {number} [back]     u pushed away from the camera
 * @property {number} [spin]     in-plane turn speed (rad/s; an atlas frame's effect)
 * @property {number} [grow]     scale growth per second (an atlas frame's effect)
 */

/**
 * A pooled effect record (`_pool` / `_live`).
 * @typedef {object} FxLive
 * @property {number} h          FxQuads handle (−1: free)
 * @property {FxDef|null} def
 * @property {string} name
 * @property {number} t          seconds since it started
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} dirX
 * @property {number} dirZ
 * @property {number} scale
 * @property {boolean} flip
 * @property {{ x: number, y: number, z: number }|null} follow  a live position it follows
 * @property {number} followY    its start offset above `follow.y`
 * @property {number} duration   looping effects: seconds
 * @property {number} n          frames of its strip
 * @property {number} fps
 * @property {FxDef} own         the record's own look (an atlas frame played as an effect: `def` = it)
 */

/**
 * name → { frame (atlas), mode, lift (u above y), color (HDR), loops (plays), loop (until its
 * duration ends), duration (s, looping effects), scale, rot (in-plane turn, rad), back (u pushed
 * away from the camera: the pillar stands behind the player it surrounds instead of hiding it) }. Flat frames:
 * the slashes bulge toward +V (= the facing); the thrust streak is drawn along +U, so `rot = π/2`
 * lays it along the facing.
 * @type {Record<FxName, FxDef>}
 */
// (the integration pass lowered the §11.5 HDR colours of the big white frames by ~40 %: with the
// real atlas the contract values bloomed the arcs and stars into a glare that hid the target; the
// level-up pillar followed later — (2.4, 2.0, 0.9) at scale 1.1, drawn over the player, was a
// white column that hid the player for a second: now below the bloom threshold, narrower, behind;
// COMBAT-16 turned its (1.2, 1.05, 0.5) — luminance 1.04, a cream-white column whose flared foot
// showed as white wings at the player's shoulders — gold (1.05, 0.82, 0.32), luminance 0.83)
const EFFECTS = {
  slash: { frame: 'slash', mode: 'flat', lift: 0.8, color: [1.8, 1.8, 1.55], loops: 1, scale: 1 },
  slashBig: { frame: 'slashBig', mode: 'flat', lift: 0.8, color: [1.95, 1.7, 1.2], loops: 1, scale: 1 },
  thrust: { frame: 'thrust', mode: 'flat', lift: 0.85, color: [1.8, 1.8, 1.7], loops: 1, scale: 1, rot: Math.PI / 2 },
  spin: { frame: 'spin', mode: 'flat', lift: 0.7, color: [1.7, 1.6, 1.2], loops: 2, scale: 1.1 },
  impact: { frame: 'impact', mode: 'billboard', lift: 1.0, color: [2.2, 2.0, 1.5], loops: 1, scale: 1.2 },
  crit: { frame: 'crit', mode: 'billboard', lift: 1.0, color: [2.6, 2.1, 0.8], loops: 1, scale: 1.3 },
  dust: { frame: 'dust', mode: 'billboard', lift: 0.3, color: [1.0, 0.95, 0.85], loops: 1, scale: 1.4 },
  stun: { frame: 'stun', mode: 'billboard', lift: 1.6, color: [3.0, 2.6, 0.8], loop: true, duration: 2.0, scale: 1 },
  pillar: { frame: 'pillar', mode: 'billboard', lift: 2.0, color: [1.05, 0.82, 0.32], loop: true, duration: 1.0, scale: 0.85, back: 0.5 },
  // an ember imp's diving burst, flat on the ground (the swarm package's frame, swarmFx.js; §29 V9)
  swarmBurst: { frame: 'swarmBurst', mode: 'flat', lift: 0.06, color: [2.0, 0.85, 0.28], loops: 1, scale: 1.2 },
};
/** Every named effect (the showcase hook plays one of each). */
export const FX_NAMES = Object.freeze(/** @type {FxName[]} */ (Object.keys(EFFECTS)));

/**
 * Live effects at once: the named effects of a fight plus the spells of a party of four (§29: big
 * area spells play a dozen quads each). The FxQuads batch (CombatSystem) holds them with the
 * projectiles, pickups and the arena's flames.
 */
const CAPACITY = 128;
/** An atlas frame's effect without `color`: its grey levels as painted (never written). */
const WHITE = [1, 1, 1];

export class CombatFx {
  /**
   * @param {FxQuads} quads
   * @param {{ frames: Record<string, { n: number, fps: number }> }} atlas
   */
  constructor(quads, atlas) {
    this.quads = quads;
    this.frames = atlas?.frames ?? {};
    /** @type {FxLive[]} live effects (pooled records) */
    this._live = [];
    /** @type {FxLive[]} free records */
    this._pool = [];
    for (let i = 0; i < CAPACITY; i++) {
      this._pool.push({
        h: -1, def: null, name: '', t: 0, x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, scale: 1, flip: false, follow: null, followY: 0, duration: 0, n: 1, fps: 30,
        own: { frame: '', mode: 'billboard', lift: 0, color: WHITE, loops: 1, loop: false, duration: 1, scale: 1, rot: 0, back: 0, spin: 0, grow: 0 },
      });
    }
    /** @type {FxQuadParams} scratch parameters for FxQuads#set */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1, flipX: false };
    /** Camera forward on XZ (unit; CombatSystem sets it every frame) for the effects' `back`. */
    this.viewX = 0;
    this.viewZ = -1;
  }

  /** Live effect count. */
  get count() { return this._live.length; }

  /**
   * Play a named effect — or any atlas frame, its look from `opts` (§29 V9).
   * @param {FxName|(string & {})} name one of FX_NAMES, or an atlas frame (FX_FRAMES)
   * @param {number} x
   * @param {number} y ground height (the effect adds its lift)
   * @param {number} z
   * @param {FxOptions} [opts] dir: flat effects' forward axis; flip: mirrored along the
   *   frame's U axis (the back-hand slash sweeps the other way); follow: a live position (stun
   *   stars, the pillar); duration: looping effects (s); an atlas frame's look: mode, lift, color,
   *   loops / loop, rot, spin, grow, back, fps
   * @returns {boolean} false when the pool (or the quad batch) is full, or the name is neither
   */
  play(name, x, y, z, opts) {
    const named = Object.hasOwn(EFFECTS, name) ? EFFECTS[/** @type {FxName} */ (name)] : null;
    if ((!named && !Object.hasOwn(this.frames, name)) || !this._pool.length) return false;
    const h = this.quads.alloc();
    if (h < 0) return false;
    const e = this._pool.pop();
    let def = named;
    if (!def) {
      // an atlas frame: the record's own look, from the options
      def = e.own;
      def.frame = name;
      def.mode = opts?.mode === 'flat' || opts?.mode === 'screen' ? opts.mode : 'billboard';
      def.lift = finite(opts?.lift, 0);
      def.color = Array.isArray(opts?.color) && opts.color.length >= 3 ? opts.color : WHITE;
      def.loop = !!opts?.loop;
      def.loops = Math.max(1, finite(opts?.loops, 1));
      def.duration = Math.max(0.05, finite(opts?.duration, 1));
      def.scale = 1;
      def.rot = finite(opts?.rot, 0);
      def.back = finite(opts?.back, 0);
      def.spin = finite(opts?.spin, 0);
      def.grow = finite(opts?.grow, 0);
    }
    const fr = this.frames[def.frame];
    e.h = h;
    e.def = def;
    e.name = name;
    e.t = 0;
    e.x = x;
    e.y = y;
    e.z = z;
    e.dirX = opts?.dirX ?? 0;
    e.dirZ = opts?.dirZ ?? 1;
    e.scale = (opts?.scale ?? 1) * def.scale;
    e.flip = !!opts?.flip;
    e.follow = opts?.follow ?? null;
    e.followY = e.follow ? y - e.follow.y : 0;
    e.duration = opts?.duration ?? def.duration ?? 0;
    e.n = Math.max(1, fr?.n ?? 1);
    e.fps = !named && opts?.fps > 0 ? opts.fps : fr?.fps > 0 ? fr.fps : 12;
    this._live.push(e);
    this._write(e);
    return true;
  }

  /**
   * Stop every live effect following `target` (a stunned enemy recovered, it died).
   * @param {{ x: number, y: number, z: number }} target
   */
  stopFollowing(target) {
    for (let i = this._live.length - 1; i >= 0; i--) if (this._live[i].follow === target) this._kill(i);
  }

  /**
   * Advance every effect.
   * @param {number} dt combat seconds (0 during hit-stop)
   */
  update(dt) {
    for (let i = this._live.length - 1; i >= 0; i--) {
      const e = this._live[i];
      e.t += dt;
      const def = e.def;
      const done = def.loop ? e.t >= e.duration : e.t * e.fps >= e.n * (def.loops ?? 1);
      if (done) this._kill(i);
      else if (dt > 0 || e.follow) this._write(e);
    }
  }

  /** @param {FxLive} e */
  _write(e) {
    const def = e.def;
    const p = this._p;
    const idx = Math.floor(e.t * e.fps + 1e-6) % e.n;
    if (e.follow) {
      e.x = e.follow.x;
      e.y = e.follow.y + e.followY;
      e.z = e.follow.z;
    }
    p.x = e.x + (def.back ? this.viewX * def.back : 0);
    p.y = e.y + def.lift;
    p.z = e.z + (def.back ? this.viewZ * def.back : 0);
    p.frame = def.frame;
    p.index = idx;
    p.scale = def.grow ? e.scale * (1 + def.grow * e.t) : e.scale;
    p.rot = (def.rot ?? 0) + (def.spin ? def.spin * e.t : 0);
    p.flipX = e.flip;
    p.mode = def.mode;
    p.dirX = e.dirX;
    p.dirZ = e.dirZ;
    p.r = def.color[0];
    p.g = def.color[1];
    p.b = def.color[2];
    // the last frames of a one-shot fade out through the dither
    p.a = def.loop ? 1 : Math.min(1, 1.6 - (e.t * e.fps) / (e.n * (def.loops ?? 1)));
    this.quads.set(e.h, p);
  }

  /**
   * @param {number} i index in `_live`
   */
  _kill(i) {
    const e = this._live[i];
    this.quads.free(e.h);
    e.h = -1;
    e.follow = null;
    this._live[i] = this._live[this._live.length - 1];
    this._live.pop();
    this._pool.push(e);
  }

  /** Remove every effect. */
  clear() {
    for (let i = this._live.length - 1; i >= 0; i--) this._kill(i);
  }
}

/**
 * A number option (caller data): `v` when finite, else `d`.
 * @param {unknown} v
 * @param {number} d
 * @returns {number}
 */
function finite(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
