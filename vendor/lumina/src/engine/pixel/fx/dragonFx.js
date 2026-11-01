/**
 * The dragon's FX frames (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.5, §6.6),
 * painted into the combat FX atlas (../FxSprites.js: the module shape, the pen and the kit) in grey
 * levels the instance colour tints (white-hot cores bloom with an HDR colour). Owner: the dragon
 * package. Every name is prefixed `dragon`.
 *
 * - `dragonFireball` (24 × 24, 4 frames): a falling fireball — a white-hot head toward +U, flame
 *   tongues licking back toward −U (turn it along its flight with `rot`).
 * - `dragonBlast` (48 × 48, 6): the impact — a hot flash, the fireball's lobes swelling, breaking
 *   into a ring of fire, smoke puffs with embers, the last wisps.
 * - `dragonRing` (64 × 64, 4): the shockwave seen from above (a flat quad): a hot thin ring
 *   widening into broken dust fragments.
 * - `dragonScorch` (48 × 48, 2 variants): the burnt mark left on the ground (a flat quad tinted
 *   near black, fading through the dither): a charred blot with radial streaks.
 * - `dragonEmbers` (48 × 48, 2): the embers glowing in the scorch (tinted HDR orange, dimming).
 *
 * RNG-free: shapes are closed forms and `hash2` lattices with fixed seeds.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */
import { hash2 } from '../../utils/math.js';

/** Frame name → { w, h, n, fps }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  dragonFireball: Object.freeze({ w: 24, h: 24, n: 4, fps: 14 }),
  dragonBlast: Object.freeze({ w: 48, h: 48, n: 6, fps: 16 }),
  dragonRing: Object.freeze({ w: 64, h: 64, n: 4, fps: 14 }),
  dragonScorch: Object.freeze({ w: 48, h: 48, n: 2, fps: 0 }),
  dragonEmbers: Object.freeze({ w: 48, h: 48, n: 2, fps: 3 }),
});

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'dragonFireball': fireball(pen, i, K); break;
    case 'dragonBlast': blast(pen, i, K); break;
    case 'dragonRing': ring(pen, i, K); break;
    case 'dragonScorch': scorch(pen, i, K); break;
    case 'dragonEmbers': embers(pen, i, K); break;
    default: break;
  }
}

/** Smooth lattice noise in [0, 1) (bilinear `hash2`). @param {number} x @param {number} y @param {number} seed */
function noise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * The falling fireball: the head toward +U, tongues of flame streaming back (they flicker from
 * frame to frame), a few sparks shed behind.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function fireball(pen, i, K) {
  const cx = 16.5;
  const cy = 12;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const back = Math.max(0, -dx);
      // the head (a disc) and the tail (a flame widening, then thinning, back toward −U)
      const flick = noise(x * 0.45 - i * 1.7, y * 0.5, 31) - 0.5;
      const half = back > 0 ? (5.6 - back * 0.32) + flick * 3.2 : Math.sqrt(Math.max(0, 31 - dx * dx));
      if (Math.abs(dy) > half) continue;
      const r = Math.hypot(dx * 1.15, dy);
      const t = back / 16;
      let v;
      if (r < 2.6) v = K.W;
      else if (r < 4.2 && t < 0.3) v = K.L;
      else if (t < 0.45 && Math.abs(dy) < half * 0.55) v = K.L;
      else if (t < 0.75) v = K.MID;
      else v = K.D;
      pen.set(x, y, v);
    }
  }
  // sparks shed from the tail
  for (let k = 0; k < 4; k++) {
    const sx = 1 + Math.floor(hash2(k, i, 7) * 7);
    const sy = 4 + Math.floor(hash2(k, i, 9) * 16);
    pen.max(sx, sy, k & 1 ? K.L : K.MID);
  }
}

/**
 * The impact: frame 0 a hot star, 1–2 the swelling fireball (lobed, a hot core), 3 a ring of fire
 * round a dark heart, 4 smoke puffs with embers, 5 wisps.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function blast(pen, i, K) {
  const c = 24;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const n = noise(x * 0.22 + i * 3.1, y * 0.22, 53 + i);
      if (i === 0) {
        // a hot star: a core and eight rays
        const ray = Math.pow(Math.abs(Math.cos(a * 4)), 6) * 9;
        if (r < 6) pen.set(x, y, K.W);
        else if (r < 6 + ray) pen.set(x, y, r < 9 ? K.W : K.L);
      } else if (i <= 2) {
        // the fireball: lobes from the noise, white core, orange body, a dark sooty rim at frame 2
        const R = (i === 1 ? 14 : 19) + (n - 0.5) * 9 + Math.sin(a * 5 + i) * 1.5;
        if (r > R) continue;
        const k = r / R;
        const v = k < (i === 1 ? 0.42 : 0.28) ? K.W : k < 0.62 ? K.L : k < 0.84 ? K.MID : i === 2 ? K.S : K.D;
        pen.set(x, y, v);
      } else if (i === 3) {
        // a ring of fire breaking up round a dark, smoking heart
        const R = 20 + (n - 0.5) * 6;
        if (r > R) continue;
        if (r > R - 5) pen.set(x, y, n > 0.42 ? K.L : K.MID);
        else if (n > 0.55) pen.set(x, y, K.S);
        else if (n > 0.48) pen.set(x, y, K.R);
      } else if (i === 4) {
        // smoke puffs, embers among them
        const R = 22 + (n - 0.5) * 8;
        if (r > R) continue;
        const m = noise(x * 0.3, y * 0.3 - 4, 91);
        if (m > 0.52) pen.set(x, y, m > 0.68 ? K.D : K.S);
        else if (hash2(x, y, 17) > 0.975) pen.set(x, y, K.W);
      } else {
        // the last wisps
        const R = 23;
        if (r > R) continue;
        const m = noise(x * 0.34, y * 0.34 - 8, 92);
        if (m > 0.64) pen.set(x, y, K.S);
        else if (hash2(x, y, 19) > 0.99) pen.set(x, y, K.L);
      }
    }
  }
}

/**
 * The shockwave seen from above: a hot thin ring at frame 0 widening into broken dust fragments.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function ring(pen, i, K) {
  const c = 32;
  const R = [11, 19, 25.5, 30][i];
  const w = [2.6, 3.4, 3.2, 2.4][i];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const d = Math.abs(r - R);
      if (d > w) continue;
      const a = Math.atan2(dy, dx);
      const n = noise(Math.cos(a) * 6 + 10, Math.sin(a) * 6 + 10 + i * 2.3, 61);
      // breaks open as it widens
      if (n < [0.1, 0.25, 0.4, 0.52][i]) continue;
      const v = d < w * 0.4 ? (i < 2 ? K.W : K.L) : d < w * 0.75 ? (i < 2 ? K.L : K.MID) : K.D;
      pen.set(x, y, v);
    }
  }
}

/**
 * The scorch mark: an irregular charred blot, darker toward its middle, streaked outward.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function scorch(pen, i, K) {
  const c = 24;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const n = noise(x * 0.18, y * 0.18, 71 + i * 13);
      const streak = Math.pow(Math.abs(Math.sin(a * (7 + i * 2) + i)), 8) * 7;
      const R = 14 + (n - 0.5) * 10 + streak;
      if (r > R) continue;
      const k = r / R;
      // a soft edge: the rim is broken up
      if (k > 0.82 && hash2(x, y, 5 + i) > 1.6 - k * 1.2) continue;
      pen.set(x, y, k < 0.35 ? K.R : k < 0.65 ? K.S : k < 0.85 ? K.D : K.MID);
    }
  }
}

/**
 * Embers in the scorch: scattered glowing specks and short cracks round the middle.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function embers(pen, i, K) {
  const c = 24;
  for (let k = 0; k < 26; k++) {
    const a = hash2(k, 3, 41) * Math.PI * 2;
    const r = 3 + hash2(k, 5, 41) * 14;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const on = hash2(k, i, 43) > 0.3;
    if (!on) continue;
    pen.set(x, y, hash2(k, 7, 41) > 0.5 ? K.W : K.L);
    if (k % 3 === 0) {
      // a short crack running outward
      for (let s = 1; s < 4; s++) pen.max(x + Math.cos(a) * s, y + Math.sin(a) * s, s < 2 ? K.L : K.MID);
    }
  }
  // the heart still glowing
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= (i ? 3 : 5)) pen.max(c + x, c + y, K.MID);
}
