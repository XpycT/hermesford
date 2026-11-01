import { THAW_DEPTH } from '../../engine/world/ThawField.js';
import { RNG, hashString, clamp, smoothstep } from '../../engine/utils/math.js';

/**
 * The Thaw's melt front (docs/contracts/EVERMERE_CAMPAIGN.md §6.1): a ring that runs out from the
 * bell over the whole level — ≈ 26 u/s for the first 0.6 s (the shock), then 10 u/s easing to 7 u/s
 * at the far edge (≈ 13 s across 120 tiles); a `thaw … <seconds>` scales every speed so it ends in
 * about that time. It ends when the ring has passed the level's farthest corner by the depth of the
 * colour's return (`THAW_DEPTH`) and the wobble. While it runs, `life` puts its three emitters'
 * worth of particles on the part of the ring the camera sees: steam (#eef4f8, alpha ≤ 0.18),
 * glints (≤ 1.4 HDR, bloom but no streak) and falling clumps of snow — bursts into the pools the
 * thaw kit primed at load (`primeThawPools`), at fixed rates, seeded (the level and the front).
 *
 * Node-safe (no three.js): the camera's ground footprint is worked out from its matrices' numbers.
 *
 * @import { Game } from '../Game.js'
 */

/** The first-shock speed (u/s) and how long it lasts (s), then the speeds near and far. */
const SHOCK = 26;
const SHOCK_S = 0.6;
const NEAR = 10;
const FAR = 7;

/** Particles per second on the visible arc: steam, glints, clumps. */
const RATES = Object.freeze({ steam: 70, glint: 46, clump: 30 });

/**
 * The time (s) the contract's speeds take to run `rMax` u.
 * @param {number} rMax
 */
function nominalSeconds(rMax) {
  if (!(rMax > 0)) return 0;
  let r = SHOCK * SHOCK_S;
  if (r >= rMax) return rMax / SHOCK;
  let t = SHOCK_S;
  const r0 = r;
  // (0.05 s steps — at most ≈ 4,000 of them: a radius no level reaches takes longer steps, never a
  // loop that runs on)
  const dt = Math.max(0.05, (rMax - r0) / (FAR * 4000));
  while (r < rMax) {
    const v = NEAR + (FAR - NEAR) * smoothstep(0, 1, (r - r0) / Math.max(1, rMax - r0));
    r += v * dt;
    t += dt;
  }
  return t;
}

export class ThawFront {
  /**
   * @param {Game} game
   * @param {{ x: number, z: number, seconds?: number, n?: number }} opts  where it starts, about how long
   *   it runs (default: the contract's speeds), n: how many fronts the level ran before (the seed)
   */
  constructor(game, { x, z, seconds, n = 0 }) {
    this.game = game;
    const L = game.level;
    const W = L?.width ?? 0;
    const D = L?.depth ?? 0;
    // (a centre off the level — a hostile `frost.at` or place — starts at its nearest edge; one that
    // is no number, at its middle)
    x = Number.isFinite(x) ? clamp(x, 0, W) : W / 2;
    z = Number.isFinite(z) ? clamp(z, 0, D) : D / 2;
    this.x = x;
    this.z = z;
    /** The radius at which every point of the level is past the colour's return. */
    this.rMax = Math.max(Math.hypot(x, z), Math.hypot(W - x, z), Math.hypot(x, D - z), Math.hypot(W - x, D - z)) + THAW_DEPTH + 1.5;
    const t0 = nominalSeconds(this.rMax);
    /** Every speed × this (a `thaw … <seconds>`). */
    this.k = Number.isFinite(seconds) && seconds > 0 ? t0 / seconds : 1;
    /** How long it runs (s). */
    this.duration = t0 / this.k;
    this.r = 0;
    this.t = 0;
    this.done = false;
    this._rng = new RNG(hashString(`thaw:${L?.name ?? ''}:${n}`));
    this._acc = { steam: 0, glint: 0, clump: 0 };
    /** @type {number[]} the visible arc's points this frame [x, z, …] */
    this._arc = [];
  }

  /** Seconds left (≥ 0). */
  get left() {
    return this.done ? 0 : Math.max(0, this.duration - this.t);
  }

  /**
   * Run on by `dt` seconds of game time.
   * @param {number} dt
   */
  update(dt) {
    if (this.done) return;
    this.t += dt;
    const r0 = SHOCK * SHOCK_S;
    let v;
    if (this.t <= SHOCK_S / this.k) v = SHOCK;
    else v = NEAR + (FAR - NEAR) * smoothstep(0, 1, (this.r - r0) / Math.max(1, this.rMax - r0));
    this.r += v * this.k * dt;
    if (this.r >= this.rMax) {
      this.r = this.rMax;
      this.done = true;
    }
  }

  /** To the end at once (a skip). */
  finish() {
    this.r = this.rMax;
    this.t = this.duration;
    this.done = true;
  }

  /**
   * The camera's view of the ground (the plane at `y`) as a quad [x0, z0, … x3, z3], or null.
   * @param {any} camera a three.js camera (matrixWorld, projectionMatrixInverse)
   * @param {number} y
   * @returns {number[]|null}
   */
  static footprint(camera, y) {
    if (!camera?.matrixWorld || !camera.projectionMatrixInverse) return null;
    const P = camera.projectionMatrixInverse.elements;
    const M = camera.matrixWorld.elements;
    const cx = M[12];
    const cy = M[13];
    const cz = M[14];
    const out = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      // the NDC corner on the far plane → view space → world (a direction from the camera)
      const w = P[3] * nx + P[7] * ny + P[11] + P[15];
      const vx = (P[0] * nx + P[4] * ny + P[8] + P[12]) / w;
      const vy = (P[1] * nx + P[5] * ny + P[9] + P[13]) / w;
      const vz = (P[2] * nx + P[6] * ny + P[10] + P[14]) / w;
      let dx = M[0] * vx + M[4] * vy + M[8] * vz;
      let dy = M[1] * vx + M[5] * vy + M[9] * vz;
      let dz = M[2] * vx + M[6] * vy + M[10] * vz;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      // (a ray above the horizon: as far as 160 u along its ground direction)
      const t = dy < -0.02 ? (y - cy) / dy : 160;
      out.push(cx + dx * Math.min(t, 160), cz + dz * Math.min(t, 160));
    }
    return out;
  }

  /**
   * The front's life on the ring the camera sees: steam, glints and falling snow at fixed rates.
   * @param {number} dt
   */
  life(dt) {
    const g = this.game;
    const ps = g.particles;
    const world = g.world;
    if (this.done || !ps || !world || this.r < 0.5) return;
    const fp = g.rig?.focusPoint;
    const quad = ThawFront.footprint(g.engine?.camera, fp?.y ?? 0);
    const arc = this._arc;
    arc.length = 0;
    // the ring sampled every ≈ 1.2 u (≤ 720 points), the ones the camera sees kept
    const n = Math.min(720, Math.max(24, Math.ceil((2 * Math.PI * this.r) / 1.2)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = this.x + Math.cos(a) * this.r;
      const z = this.z + Math.sin(a) * this.r;
      if (!world.inMap(x, z)) continue;
      if (quad && !inQuad(quad, x, z)) continue;
      arc.push(x, z);
    }
    if (!arc.length) return;
    const rng = this._rng;
    const acc = this._acc;
    const pick = () => {
      const k = rng.int(0, arc.length / 2 - 1) * 2;
      const x = arc[k] + rng.range(-0.6, 0.6);
      const z = arc[k + 1] + rng.range(-0.6, 0.6);
      return { x, y: world.groundAt(x, z), z };
    };
    const span = clamp(arc.length / 60, 0.35, 1);
    acc.steam += RATES.steam * span * dt;
    acc.glint += RATES.glint * span * dt;
    acc.clump += RATES.clump * span * dt;
    for (; acc.steam >= 1; acc.steam--) {
      const p = pick();
      p.y += 0.15;
      ps.burst('smoke', p, 1, STEAM);
    }
    for (; acc.glint >= 1; acc.glint--) {
      const p = pick();
      p.y += 0.2 + rng.range(0, 0.8);
      ps.burst('sparkle', p, 1, GLINT);
    }
    for (; acc.clump >= 1; acc.clump--) {
      const p = pick();
      p.y += 1.2 + rng.range(0, 2.2);
      ps.burst('snow', p, 1, CLUMP);
    }
  }
}

/** Is (x, z) inside the convex quad [x0, z0, … x3, z3]? */
function inQuad(q, x, z) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const ax = q[i * 2];
    const az = q[i * 2 + 1];
    const bx = q[((i + 1) % 4) * 2];
    const bz = q[((i + 1) % 4) * 2 + 1];
    const c = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The burst layers (Particles `burst` overrides; per-particle fields only — the pools stay the presets'). */
const STEAM = Object.freeze({
  life: [1.3, 2.2], size: [0.5, 0.8], sizeEnd: 2.4, velocity: [0, 0, 0], velocityVariance: [0.15, 0.05, 0.15],
  burstSpeed: [0.1, 0.4], burstUp: [0.35, 0.8], gravity: 0.12, drag: 1.1, windInfluence: 0.25, spawnSize: [1.2, 0.2, 1.2],
  color: '#eef4f8', alpha: 0.16, spin: [0.1, 0.4],
});
const GLINT = Object.freeze({
  life: [0.35, 0.75], size: [0.16, 0.26], sizeEnd: 0.6, velocity: [0, 0.1, 0], burstSpeed: [0.05, 0.3], burstUp: [0.05, 0.3],
  gravity: 0, drag: 2, spawnSize: [0.8, 0.4, 0.8], colors: ['#e6fbff', '#fff6e0', '#d6f0ff'], hdr: 1.35, spin: [0.5, 2],
});
const CLUMP = Object.freeze({
  life: [0.6, 1.1], size: [0.14, 0.22], velocity: [0, -2.6, 0], velocityVariance: [0.2, 0.6, 0.2], burstSpeed: [0, 0.2], burstUp: [0, 0],
  gravity: -3, drag: 0.1, windInfluence: 0.2, spawnSize: [0.8, 0.4, 0.8], color: '#f4f8fc', alpha: 0.95, spin: [0.5, 1],
});
