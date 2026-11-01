/**
 * Small math / randomness / noise helpers shared by every engine module.
 * Everything here is deterministic for a given seed so procedural art is stable.
 */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const fract = (x) => x - Math.floor(x);
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/**
 * Frame-rate independent exponential smoothing factor.
 * `x = lerp(x, target, damp(lambda, dt))` converges at rate `lambda` (1/s).
 */
export const damp = (lambda, dt) => 1 - Math.exp(-lambda * dt);

/** Shortest signed difference between two angles (radians), in (-PI, PI]. */
export const angleDelta = (from, to) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded random number generator with convenience helpers. */
export class RNG {
  /** @param {number|string} [seed] a number, or a string that is hashed with hashString */
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  /** Float in [0, 1). */
  next() { return this._next(); }
  /** Float in [a, b). */
  range(a, b) { return a + (b - a) * this._next(); }
  /** Integer in [a, b] (inclusive). */
  int(a, b) { return a + Math.floor(this._next() * (b - a + 1)); }
  /** True with probability p. */
  chance(p) { return this._next() < p; }
  /** Random element of an array. */
  pick(arr) { return arr[Math.floor(this._next() * arr.length)]; }
  /** Approximately normal distributed value (mean 0, sd 1). */
  gaussian() {
    const u = 1 - this._next();
    const v = this._next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Fisher-Yates shuffle (in place). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Integer lattice hash → float in [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 2D value noise in [0, 1). If `period` is given the noise tiles with that
 * integer period (useful for seamless textures).
 */
export function valueNoise2(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v) => (period > 0 ? ((v % period) + period) % period : v);
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/**
 * Fractal Brownian motion over value noise, normalised to [0, 1).
 * `period` (in base-frequency cells) makes it tile seamlessly.
 */
export function fbm2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0, period = 0 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + o * 101, period ? period * freq : 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 4x4 Bayer ordered-dither threshold in [0, 1) for pixel (x, y). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer4 = (x, y) => (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
