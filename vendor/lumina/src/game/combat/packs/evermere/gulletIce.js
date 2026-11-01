/**
 * Old Gullet's ice (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.7): what it does to
 * the sea ice and what stays there — the holes (open water with a broken white rim, a gold glint on
 * the one it is about to rise through), the cracks its arms run along, and its own dark shape moving
 * under the ice. Drawn with the combat's FX quads (one shared batch: no program, no draw call, no
 * ground marker — the 48 markers stay the telegraphs'), the frames of
 * src/engine/pixel/fx/evGulletFx.js. Owner: the gullet package.
 *
 * One `GulletIce` per CombatSystem with a head (`iceOf(sys)`; the pack's level system `gulletIce`,
 * COMBAT.md §30.1: `register` in ./gullet.js), so it runs every frame — the fight, a story scene,
 * the frames after the boss is gone — is cleared on an encounter's reset and disposed with the
 * combat. The brain owns the gameplay (when a hole opens and
 * closes, its hazard); this owns the look: the holes' snap open and their dither out, the ripples
 * and glints, the cracks growing, the shadow easing after its target, and the thaw: a hole the frost
 * held (`thawField.at` ≤ 0.5 while it was open) fades when the thaw passes it (`at` > 0.5) — the
 * bay breaking up takes the holes with it. A hole released by the boss's end (`releaseAll`) stays
 * until then; on a level the frost never held, it closes after `RELEASE_S`.
 *
 * @import { CombatSystem } from '../../CombatSystem.js'
 * @import { CombatPackSystem, MarkerStyle } from '../../types.js'
 * @import { FxQuadParams } from '../../../../engine/fx/FxQuads.js'
 */
import { thawField } from '../../../../engine/world/ThawField.js';
import { TINTS } from '../../../../engine/pixel/fx/evGulletFx.js';

/**
 * The head's and the arms' telegraphs on the bay (EV-22, D15: a warm style of the gullet's own; the
 * core's `frost` fill — cyan on cyan ice — vanished there, and so does the stock `enemy` fill, whose
 * red tone-maps to the pale ice's own brightness: its rim reads, its fill does not). `gulletWarm`
 * (9): the `enemy` rim — red-orange, white at progress 1 — with a dark ember texel outside it, its
 * bright leading edge, and a deep ember fill (0.24, 0.028, 0.012) at alpha 0.46 → 0.76 that
 * darkens the ice under it (on Saltcombe's ice at 10:30 its fill reads ≥ 25 / 255 darker than the
 * ice from 60 % of its fill on: sandbox/gullet.arena.json). Registered by ./gullet.js
 * (`registerMarkerStyles`, COMBAT.md §30.6); linear HDR, below the bloom threshold but for the
 * rim's red channel, as `enemy`'s (a name of the `MarkerStyle` union, src/game/combat/types.d.ts).
 * @type {MarkerStyle}
 */
export const WARM_STYLE = /** @type {MarkerStyle} */ ('gulletWarm');
/** Its style id (core's `frost` 5, `crack` 6). */
export const WARM_ID = 9;
/** Its fragment branch (GroundMarkers' locals: `registerMarkerStyles`). */
export const WARM_GLSL = /* glsl */ `
	} else if ( style == 9 ) {
		vec3 rimC = vec3( 2.6, 0.34, 0.12 ) * ( 0.85 + 0.25 * prog + 0.1 * pulse );
		if ( rim ) {
			bool outer = sd > - TX;
			col = outer ? vec3( 0.16, 0.03, 0.015 ) : mix( rimC, vec3( 0.95, 0.88, 0.78 ), flash );
			a = 0.92;
		} else if ( lead ) { col = vec3( 2.6, 0.45, 0.14 ); a = 0.8; }
		else if ( shape != 4 ) { col = vec3( 0.24, 0.028, 0.012 ); a = filled ? mix( 0.46, 0.76, prog ) : 0.16; }
`;

/** Seconds a hole takes to snap open, and to dither out when it closes. */
const OPEN_S = 0.14;
const CLOSE_S = 0.7;
/** A hole released by the end of the fight on ice the frost never held closes after this long (s). */
const RELEASE_S = 8;
/** Lift of the hole's water and rim above the ice (the shadow lies under them). */
const LIFT = { shadow: 0.02, pool: 0.035, rim: 0.05, crack: 0.04 };
/** A crack: one segment every this many units (the frame is 3 u long), its life after it grew. */
const CRACK_STEP = 2.5;
/** The shadow's speed easing after its target (u/s) and its dither density at full strength. */
const SHADOW = { speed: 5, density: 0.5, soft: 0.75 };
/** The gold glints over a glinting hole: how many, their height above the water. */
const GLINTS = 3;

/**
 * A hole on the ice (`open`).
 * @typedef {object} IceHole
 * @property {number} id
 * @property {number} x
 * @property {number} z
 * @property {number} y        the ice's height there
 * @property {boolean} big
 * @property {number} pool     the water's quad
 * @property {number} rim      the rim's quad
 * @property {number} variant  the rim's break pattern
 * @property {number} t        seconds since it opened
 * @property {number} closing  seconds since it began to close (−1: open)
 * @property {boolean} held    the frost held it (it fades when the thaw passes)
 * @property {number} release  seconds left before a released hole on unfrozen ice closes (−1: none)
 * @property {boolean} glint
 * @property {number[]} glints the glints' quads
 */

/**
 * A crack (`crack`): its segments' quads, growing over `grow` s, fading after `life` s.
 * @typedef {{ id: number, x: number, z: number, dx: number, dz: number, len: number, grow: number,
 *   life: number, t: number, quads: number[], y: number[] }} IceCrack
 */

/** One per combat. @type {WeakMap<CombatSystem, GulletIce>} */
const STAGES = new WeakMap();

/**
 * The ice stage of a combat (made on first use: the head's brain at its creation, then the level
 * system's maker, which hands it to the combat).
 * @param {CombatSystem} sys
 * @returns {GulletIce}
 */
export function iceOf(sys) {
  let s = STAGES.get(sys);
  if (!s) {
    s = new GulletIce(sys);
    STAGES.set(sys, s);
  }
  return s;
}

/**
 * The level system's maker (`registerSystem('gulletIce', …)`): the stage where a head is, else none.
 * @param {CombatSystem} sys
 * @returns {GulletIce|null}
 */
export function makeIceSystem(sys) {
  return sys.enemies.some((e) => String(e.kind) === 'gullet') ? iceOf(sys) : null;
}

/** @implements {CombatPackSystem} */
export class GulletIce {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    /** @type {IceHole[]} */
    this.holes = [];
    /** @type {IceCrack[]} */
    this.cracks = [];
    this._ids = 0;
    this._clock = 0;
    /** The shadow under the ice: its quad, where it is, where it goes, its strength now and wanted. */
    this.shadow = { h: -1, x: 0, z: 0, tx: 0, tz: 0, a: 0, ta: 0, hx: 0, hz: -1, on: false };
    /** @type {FxQuadParams} */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'flat', dirX: 0, dirZ: -1, r: 1, g: 1, b: 1, a: 1, flipX: false, soft: 0 };
  }

  /** The combat's quad batch. */
  get quads() { return this.sys.quads; }

  /**
   * Open a hole at (x, z): the big one (the head's, the lasting ones) or a small one (an arm's, an
   * ice burst's). Its look only — the brain keeps its hazard and closes it.
   * @param {number} x @param {number} z @param {boolean} big
   * @returns {number} its id (0: no quad free)
   */
  open(x, z, big) {
    const pool = this.quads.alloc();
    const rim = this.quads.alloc();
    if (pool < 0 || rim < 0) {
      if (pool >= 0) this.quads.free(pool);
      if (rim >= 0) this.quads.free(rim);
      return 0;
    }
    const id = ++this._ids;
    const y = this.sys.groundAt(x, z);
    this.holes.push({
      id, x, z, y, big, pool, rim, variant: id % 2, t: 0, closing: -1, held: thawField.at(x, z) <= 0.5, release: -1, glint: false, glints: [],
    });
    return id;
  }

  /**
   * Close a hole (it refreezes: a dither out over `CLOSE_S`).
   * @param {number} id
   */
  close(id) {
    const o = this.holes.find((k) => k.id === id);
    if (o && o.closing < 0) o.closing = 0;
  }

  /**
   * Gold glints over a hole's water (the head is about to rise through it), or none.
   * @param {number} id @param {boolean} on
   */
  glint(id, on) {
    const o = this.holes.find((k) => k.id === id);
    if (!o) return;
    o.glint = on;
    if (!on) this._freeGlints(o);
  }

  /** @param {number} id @returns {boolean} the hole is there (open or closing) */
  has(id) {
    return this.holes.some((k) => k.id === id);
  }

  /**
   * The fight is over: every hole still open stays until the thaw passes it (on ice the frost never
   * held: `RELEASE_S`), the cracks fade, the glints and the shadow go.
   */
  releaseAll() {
    for (const o of this.holes) {
      if (o.closing >= 0) continue;
      o.release = o.held ? -1 : RELEASE_S;
      o.glint = false;
      this._freeGlints(o);
    }
    for (const c of this.cracks) c.life = Math.min(c.life, c.t + 0.6);
    this.shadow.ta = 0;
  }

  /**
   * A crack growing from (x, z) along (dx, dz) for `len` u over `grow` s, fading `life` s after it
   * began.
   * @param {number} x @param {number} z @param {number} dx @param {number} dz @param {number} len
   * @param {number} grow @param {number} life
   * @returns {number} its id
   */
  crack(x, z, dx, dz, len, grow, life) {
    const l = Math.hypot(dx, dz) || 1;
    const n = Math.max(1, Math.round(len / CRACK_STEP));
    /** @type {number[]} */
    const quads = [];
    /** @type {number[]} */
    const ys = [];
    for (let k = 0; k < n; k++) {
      const h = this.quads.alloc();
      if (h < 0) break;
      quads.push(h);
      const t = (k + 0.5) / n;
      ys.push(this.sys.groundAt(x + (dx / l) * len * t, z + (dz / l) * len * t));
    }
    const id = ++this._ids;
    this.cracks.push({ id, x, z, dx: dx / l, dz: dz / l, len, grow: Math.max(0.05, grow), life, t: 0, quads, y: ys });
    return id;
  }

  /**
   * Its shape under the ice: eases toward (x, z) heading along (hx, hz); `strength` 0 hides it.
   * @param {number} x @param {number} z @param {number} strength 0–1
   * @param {number} [hx] @param {number} [hz]
   */
  shadowTo(x, z, strength, hx, hz) {
    const s = this.shadow;
    if (!s.on || s.a <= 0.001) {
      s.x = x;
      s.z = z;
    }
    s.on = true;
    s.tx = x;
    s.tz = z;
    s.ta = Math.max(0, Math.min(1, strength));
    if (hx !== undefined && hz !== undefined && Math.hypot(hx, hz) > 1e-4) {
      s.hx = hx;
      s.hz = hz;
    }
  }

  /** Everything gone at once (an encounter's reset, the reset hook). */
  clear() {
    for (const o of this.holes) this._freeHole(o);
    this.holes.length = 0;
    for (const c of this.cracks) for (const h of c.quads) this.quads.free(h);
    this.cracks.length = 0;
    const s = this.shadow;
    if (s.h >= 0) this.quads.free(s.h);
    s.h = -1;
    s.a = 0;
    s.ta = 0;
    s.on = false;
  }

  /** @param {IceHole} o */
  _freeGlints(o) {
    for (const h of o.glints) this.quads.free(h);
    o.glints.length = 0;
  }

  /** @param {IceHole} o */
  _freeHole(o) {
    this.quads.free(o.pool);
    this.quads.free(o.rim);
    this._freeGlints(o);
  }

  // ---- the level system (CombatPackSystem) ----

  /** An encounter's reset (a death, a rest): the ice whole again (the head's brain clears it too). */
  reset() {
    this.clear();
  }

  /**
   * Once a frame: the holes, cracks and shadow on the frame's own time while the combat runs or a
   * story scene plays it (the ambient step), held otherwise.
   * @param {number} dt the frame's seconds
   * @param {boolean} active the combat runs
   * @param {boolean} [ambient] a story scene plays its world (the ambient step)
   */
  frame(dt, active, ambient = false) {
    const step = active || ambient ? Math.max(0, dt) : 0;
    this._clock += step;
    // (unlit quads: dimmed with the night — the lighting's own night factor)
    const light = 1 - 0.62 * Math.min(1, Math.max(0, this.sys.lighting?.nightFactor ?? 0));
    const p = this._p;
    const pool = TINTS.gulletPool;
    const rimT = TINTS.gulletRim;
    // ---- the holes ----
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const o = this.holes[i];
      o.t += step;
      const at = thawField.at(o.x, o.z);
      if (at <= 0.5) o.held = true;
      else if (o.held && o.closing < 0) o.closing = 0; // the thaw passed it: the bay breaks up
      if (o.release > 0) {
        o.release -= step;
        if (o.release <= 0 && o.closing < 0) o.closing = 0;
      }
      if (o.closing >= 0) o.closing += step;
      const a = o.closing >= 0 ? Math.max(0, 1 - o.closing / CLOSE_S) : 1;
      if (a <= 0) {
        this._freeHole(o);
        this.holes.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, 0.45 + 0.55 * (o.t / OPEN_S));
      p.mode = 'flat';
      p.dirX = 0;
      p.dirZ = -1;
      p.rot = 0;
      p.flipX = false;
      p.soft = 0;
      p.x = o.x;
      p.z = o.z;
      p.scale = grow;
      p.a = a;
      // the water: a slow ripple
      p.y = o.y + LIFT.pool;
      p.frame = o.big ? 'gulletPool' : 'gulletPoolS';
      p.index = Math.floor(this._clock * 3 + o.id * 0.7) % 3;
      p.r = pool[0] * light;
      p.g = pool[1] * light;
      p.b = pool[2] * light;
      this.quads.set(o.pool, p);
      // the broken rim
      p.y = o.y + LIFT.rim;
      p.frame = o.big ? 'gulletRim' : 'gulletRimS';
      p.index = o.variant;
      p.flipX = o.id % 4 >= 2;
      p.r = rimT[0] * light;
      p.g = rimT[1] * light;
      p.b = rimT[2] * light;
      this.quads.set(o.rim, p);
      p.flipX = false;
      // the gold glints, drifting over the water
      if (o.glint && o.closing < 0) {
        while (o.glints.length < GLINTS) {
          const h = this.quads.alloc();
          if (h < 0) break;
          o.glints.push(h);
        }
        const gt = TINTS.gulletGlint;
        const R = o.big ? 0.9 : 0.55;
        for (let k = 0; k < o.glints.length; k++) {
          const ph = this._clock * 1.7 + k * 2.1;
          p.mode = 'billboard';
          p.frame = 'gulletGlint';
          p.index = Math.floor(this._clock * 10 + k * 1.3) % 3;
          p.x = o.x + Math.cos(ph) * R * (0.4 + 0.6 * ((k * 0.37) % 1));
          p.z = o.z + Math.sin(ph * 1.3) * R * 0.6;
          p.y = o.y + 0.22 + 0.12 * Math.sin(ph * 2.3);
          p.scale = 1;
          p.a = 1;
          p.r = gt[0];
          p.g = gt[1];
          p.b = gt[2];
          this.quads.set(o.glints[k], p);
        }
        p.mode = 'flat';
      }
    }
    // ---- the cracks ----
    const ct = TINTS.gulletCrack;
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i];
      c.t += step;
      const fade = c.t > c.life ? Math.max(0, 1 - (c.t - c.life) / CLOSE_S) : 1;
      if (fade <= 0) {
        for (const h of c.quads) this.quads.free(h);
        this.cracks.splice(i, 1);
        continue;
      }
      const n = c.quads.length;
      const grown = Math.min(1, c.t / c.grow) * n;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const shown = Math.max(0, Math.min(1, grown - k));
        p.mode = 'flat';
        p.frame = 'gulletCrack';
        p.index = (c.id + k) % 3;
        p.x = c.x + c.dx * c.len * t;
        p.z = c.z + c.dz * c.len * t;
        p.y = c.y[k] + LIFT.crack;
        p.dirX = c.dx;
        p.dirZ = c.dz;
        p.rot = 0;
        p.flipX = (c.id + k) % 2 === 1;
        p.scale = 1;
        p.a = shown * fade;
        p.r = ct[0] * light;
        p.g = ct[1] * light;
        p.b = ct[2] * light;
        this.quads.set(c.quads[k], p);
      }
      p.flipX = false;
    }
    // ---- the shadow under the ice ----
    const s = this.shadow;
    if (s.on) {
      const d = Math.hypot(s.tx - s.x, s.tz - s.z);
      const mv = Math.min(d, SHADOW.speed * step);
      if (d > 1e-4) {
        s.x += ((s.tx - s.x) / d) * mv;
        s.z += ((s.tz - s.z) / d) * mv;
      }
      s.a += Math.max(-step * 1.2, Math.min(step * 1.6, s.ta - s.a));
      if (s.a > 0.01) {
        if (s.h < 0) s.h = this.quads.alloc();
        if (s.h >= 0) {
          const st = TINTS.gulletShadow;
          p.mode = 'flat';
          p.frame = 'gulletShadow';
          p.index = 0;
          p.x = s.x;
          p.z = s.z;
          p.y = this.sys.groundAt(s.x, s.z) + LIFT.shadow;
          p.dirX = s.hx;
          p.dirZ = s.hz;
          p.rot = 0;
          p.scale = 1;
          p.a = s.a * SHADOW.density;
          p.soft = SHADOW.soft;
          p.r = st[0];
          p.g = st[1];
          p.b = st[2];
          this.quads.set(s.h, p);
          p.soft = 0;
        }
      } else if (s.h >= 0) {
        this.quads.free(s.h);
        s.h = -1;
      }
    }
  }

  /** The combat goes. */
  dispose() {
    this.clear();
    STAGES.delete(this.sys);
  }

  /** For tests: the holes, cracks and shadow now. */
  info() {
    return {
      holes: this.holes.map((o) => ({ id: o.id, x: +o.x.toFixed(2), z: +o.z.toFixed(2), big: o.big, closing: o.closing >= 0, held: o.held, released: o.release >= 0, glint: o.glint })),
      cracks: this.cracks.length,
      shadow: { x: +this.shadow.x.toFixed(2), z: +this.shadow.z.toFixed(2), a: +this.shadow.a.toFixed(2) },
      quads: this.holes.reduce((n, o) => n + 2 + o.glints.length, 0) + this.cracks.reduce((n, c) => n + c.quads.length, 0) + (this.shadow.h >= 0 ? 1 : 0),
    };
  }
}
