/**
 * The brutes' FX frames (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.7) — painted
 * into the combat FX atlas (../FxSprites.js: the module shape, the pen and the kit) in grey levels
 * that the FxQuads instance colour tints (white-hot cores, dark rims). The brains play them through
 * `ctx.fx(frame, x, groundY, z, opts)` (an atlas frame's look from `opts`: mode, lift, colour, loops)
 * and the pyromancer's fireball flies as one (`ProjectileSpec.look`). Owner: the brutes package.
 * RNG-free: closed-form shapes and a fixed lattice hash.
 *
 * Flat frames lie on the ground with their +V axis (texture up) along the effect's direction.
 * - `bruteCleave` 80 × 44 × 4 (30 fps, flat): the greatcleaver's heavy crescent, wider and
 *   thicker than the player's slash, a ragged sawtooth inner edge, chips flung off the tip.
 * - `bruteQuake` 64 × 64 × 3 (12 fps, flat): the slam's ground cracks racing out from the impact
 *   and a broken ring of heaved earth; tinted ember, they read as magma glowing in the cracks.
 * - `bruteBreath` 56 × 56 × 3 (14 fps, flat): the hound's breath, a fan of flame from its jaws
 *   (the frame's bottom centre) spreading to the far edge, tongues flickering frame to frame.
 * - `bruteFireball` 16 × 16 × 4 (14 fps, billboard): the pyromancer's fireball, a white-hot core in
 *   a ragged corona that rolls round.
 * - `brutePillar` 24 × 56 × 4 (14 fps, billboard): a column of fire erupting from the ground, wide at
 *   the foot, tongues twisting up it.
 * - `bruteSigil` 48 × 48 × 2 (6 fps, flat): the cult's fire sigil under a channelling pyromancer —
 *   two rings, a six-fold star and runes, pulsing.
 * - `bruteFlames` 24 × 24 × 4 (12 fps, billboard): a cluster of flames (fire on a roof's edge, a
 *   pyromancer burning up, a blink's flare).
 * - `bruteBite` 24 × 20 × 3 (30 fps, billboard): the hound's jaws snapping shut, a spark of fangs.
 * - `bruteClaw` 24 × 24 × 3 (24 fps, billboard): three raking claw streaks.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  bruteCleave: Object.freeze({ w: 80, h: 44, n: 4, fps: 30 }),
  bruteQuake: Object.freeze({ w: 64, h: 64, n: 3, fps: 12 }),
  bruteBreath: Object.freeze({ w: 56, h: 56, n: 3, fps: 14 }),
  bruteFireball: Object.freeze({ w: 16, h: 16, n: 4, fps: 14 }),
  brutePillar: Object.freeze({ w: 24, h: 56, n: 4, fps: 14 }),
  bruteSigil: Object.freeze({ w: 48, h: 48, n: 2, fps: 6 }),
  bruteFlames: Object.freeze({ w: 24, h: 24, n: 4, fps: 12 }),
  bruteBite: Object.freeze({ w: 24, h: 20, n: 3, fps: 30 }),
  bruteClaw: Object.freeze({ w: 24, h: 24, n: 3, fps: 24 }),
});

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'bruteCleave': cleave(pen, i, K); break;
    case 'bruteQuake': quake(pen, i, K); break;
    case 'bruteBreath': breath(pen, i, K); break;
    case 'bruteFireball': fireball(pen, i, K); break;
    case 'brutePillar': pillar(pen, i, K); break;
    case 'bruteSigil': sigil(pen, i, K); break;
    case 'bruteFlames': flames(pen, i, K); break;
    case 'bruteBite': bite(pen, i, K); break;
    case 'bruteClaw': claw(pen, i, K); break;
    default: break;
  }
}

/** A fixed lattice hash in [0, 1) (no RNG: the same atlas every time). */
function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A flame's grey level by its heat 0 … 1 (1: the white core). */
function heat(K, t) {
  return t > 0.8 ? K.W : t > 0.6 ? K.L : t > 0.4 ? K.MID : t > 0.2 ? K.D : K.S;
}

/**
 * The cleave's crescent: a thick band between two ellipses bulging forward (the frame's top), swept
 * from the right to the left over the frames, its inner edge a sawtooth (the cleaver's teeth), a
 * dim tail, chips flying off the leading tip.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function cleave(pen, i, K) {
  const { w, h } = pen;
  const cx = w / 2, cy = h - 2.5, rx = w / 2 - 1.5, ry = h - 4;
  const P = [
    { a0: 0.1, a1: 1.15 }, { a0: 0.08, a1: 2.3 }, { a0: 0.35, a1: 3.05 }, { a0: 1.7, a1: 3.08 },
  ][i];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (cy - (y + 0.5)) / ry;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < P.a0 || a > P.a1 || dy < -0.04) continue;
      const u = (a - P.a0) / Math.max(1e-6, P.a1 - P.a0); // 0 at the start (right) … 1 at the leading tip
      const thick = (0.2 + 0.36 * u) * (i === 3 ? 0.6 : 1);
      // the sawtooth inner edge
      const tooth = ((a * 22) % 1) < 0.5 ? 0.05 : 0;
      if (r > 1 || r < 1 - thick + tooth) continue;
      if (i === 3 && hash(x, y, 7) < 0.35) continue; // breaking up
      const edge = r > 1 - thick * 0.3;
      pen.set(x, y, edge ? (u > 0.7 ? K.W : K.L) : u > 0.55 ? K.MID : u > 0.25 ? K.D : K.S);
    }
  }
  // chips off the leading tip
  if (i >= 1) {
    const ta = P.a1;
    for (let k = 0; k < 7; k++) {
      const d = 1.05 + 0.1 * k + 0.06 * i;
      const aa = ta - 0.15 * (k % 3) + 0.08 * i;
      const x = cx + Math.cos(aa) * rx * d, y = cy - Math.sin(aa) * ry * d;
      pen.set(x, y, k < 2 ? K.W : K.L);
      if (k % 2 === 0) pen.set(x + 1, y, K.MID);
    }
  }
}

/**
 * The slam's cracks: nine jagged cracks racing out from the centre (longer each frame), a heaved
 * ring of broken earth at their ends, fading on the last frame.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function quake(pen, i, K) {
  const c = 32;
  const reach = [14, 24, 29][i];
  for (let k = 0; k < 9; k++) {
    let a = (k / 9) * Math.PI * 2 + hash(k, 1, 3) * 0.5;
    let x = c, y = c;
    const len = reach * (0.7 + 0.3 * hash(k, 2, 3));
    for (let s = 0; s < len; s += 1) {
      a += (hash(k, s, 5) - 0.5) * 0.5;
      x += Math.cos(a);
      y += Math.sin(a);
      const t = s / len;
      const v = i === 2 ? (t < 0.5 ? K.MID : K.D) : t < 0.3 ? K.W : t < 0.7 ? K.L : K.MID;
      pen.max(x, y, v);
      if (t < 0.4) pen.max(x + 1, y, i === 2 ? K.D : K.MID); // wider near the centre
      // a fork
      if (s === Math.round(len * 0.55) && k % 2 === 0) {
        let fx = x, fy = y, fa = a + 0.7;
        for (let q = 0; q < len * 0.3; q++) { fa += (hash(k, q, 9) - 0.5) * 0.6; fx += Math.cos(fa); fy += Math.sin(fa); pen.max(fx, fy, K.D); }
      }
    }
  }
  // the heaved ring: chunks of broken earth at the cracks' reach
  if (i >= 1) {
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2 + hash(k, 4, 11) * 0.2;
      const rr = reach + 1 + hash(k, 5, 11) * 2;
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      if (i === 2 && hash(k, 6, 11) < 0.5) continue;
      pen.set(x, y, K.D); pen.set(x + 1, y, K.S);
      if (k % 3 === 0) pen.set(x, y - 1, K.MID);
    }
  }
  // the scorched centre
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 9) pen.max(c + x, c + y, i === 2 ? K.D : K.L);
  if (i < 2) pen.set(c, c, K.W);
}

/**
 * The breath's fan: from the frame's bottom centre (the jaws) spreading ±28° to the far edge; heat
 * falls with the distance and toward the fan's sides; the far edge breaks into tongues that move
 * each frame.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function breath(pen, i, K) {
  const { w, h } = pen;
  const ox = w / 2, oy = h - 1;
  const half = 30 * Math.PI / 180;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - ox, dy = oy - (y + 0.5);
      if (dy <= 0) continue;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dx, dy); // 0 straight ahead
      // tongues along the far rim and the sides, flickering per frame
      const wob = Math.sin(a * 9 + i * 2.1 + r * 0.35) * 0.5 + Math.sin(a * 23 - i * 1.3) * 0.25;
      const reach = h - 2 + wob * 5 - Math.abs(a) * 6;
      const side = half * (0.82 + 0.12 * Math.sin(r * 0.4 + i * 1.7));
      if (r > reach || Math.abs(a) > side) continue;
      const core = 1 - Math.abs(a) / side;
      const near = 1 - r / reach;
      let t = 0.15 + 0.55 * core + 0.35 * near * core;
      if (r < 6) t = Math.max(t, 0.9);
      // licks of darker flame inside
      if (hash(x >> 1, y >> 1, i + 31) < 0.12) t -= 0.25;
      pen.set(x, y, heat(K, t));
    }
  }
}

/**
 * The fireball: a white-hot core, a corona of tongues rolling round (a quarter turn over the frames).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function fireball(pen, i, K) {
  const c = 7.5;
  const turn = (i * Math.PI) / 2 / 4;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const tongue = Math.max(0, Math.sin(5 * (a - turn) + r * 0.4));
      const edge = 4.6 + 2.6 * tongue * tongue;
      if (r > edge) continue;
      pen.set(x, y, r < 2.2 ? K.W : r < 3.4 ? K.L : r < 4.6 ? K.MID : r < edge - 0.8 ? K.D : K.S);
    }
  }
}

/**
 * The fire pillar: a column wide at the foot (the frame's bottom), narrowing and breaking into
 * tongues at the top; a bright core twisting up its middle; frame 0 the eruption (short), 1–2 full,
 * 3 dying down.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function pillar(pen, i, K) {
  const { w, h } = pen;
  const cx = w / 2;
  const top = [h * 0.45, h * 0.02, h * 0.08, h * 0.35][i];
  for (let y = 0; y < h; y++) {
    if (y < top) continue;
    const t = (y - top) / (h - top); // 0 at the top … 1 at the foot
    const twist = Math.sin(y * 0.32 + i * 1.6) * 2.2 * (1 - t);
    const halfW = 3.2 + 6 * t * t + (t > 0.9 ? 2 : 0) + Math.sin(y * 0.7 + i * 2.3) * 1.1;
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx - twist;
      if (Math.abs(dx) > halfW) continue;
      // tongues at the top break the column
      if (t < 0.25 && hash(x, y >> 1, i + 41) < 0.35 * (1 - t / 0.25)) continue;
      const core = 1 - Math.abs(dx) / halfW;
      let v = 0.2 + 0.7 * core + 0.2 * t;
      if (i === 3) v -= 0.25;
      pen.set(x, y, heat(K, v));
    }
  }
}

/**
 * The fire sigil: an outer and an inner ring, a six-pointed star between them, rune ticks round the
 * outer ring; frame 1 brighter (the pulse).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function sigil(pen, i, K) {
  const c = 23.5;
  const hi = i === 1;
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      if (r > 21.5 && r < 23.2) pen.set(x, y, hi ? K.W : K.L);
      else if (r > 15.6 && r < 16.8) pen.set(x, y, hi ? K.L : K.MID);
    }
  }
  // the six-pointed star (two triangles) inscribed in the inner ring
  for (let t = 0; t < 2; t++) {
    const pts = [0, 1, 2].map((k) => {
      const a = -Math.PI / 2 + t * Math.PI / 3 + (k * 2 * Math.PI) / 3;
      return [c + Math.cos(a) * 16, c + Math.sin(a) * 16];
    });
    for (let k = 0; k < 3; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 3];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let s = 0; s <= n; s++) pen.max(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, hi ? K.L : K.MID);
    }
  }
  // runes: short marks between the rings
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const x = c + Math.cos(a) * 19.2, y = c + Math.sin(a) * 19.2;
    pen.set(x, y, hi ? K.W : K.L);
    const kind = k % 3;
    if (kind === 0) { pen.set(x + Math.cos(a), y + Math.sin(a), K.MID); pen.set(x - Math.cos(a), y - Math.sin(a), K.MID); }
    else if (kind === 1) { pen.set(x - Math.sin(a), y + Math.cos(a), K.MID); }
    else pen.set(x + Math.sin(a), y - Math.cos(a), K.D);
  }
  // the burning heart
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 4) pen.set(c + x, c + y, hi ? K.W : K.L);
}

/**
 * A cluster of flames: three tongues of different heights rising from a hot bed, swaying per frame.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function flames(pen, i, K) {
  const base = 22;
  const T = [[12, 17, 0], [7, 11, 1.7], [17, 10, 3.1]];
  for (const [tx, th, ph] of T) {
    const hh = th + Math.round(Math.sin(i * 1.6 + ph) * 2);
    for (let k = 0; k < hh; k++) {
      const t = k / hh; // 0 at the bed … 1 at the tip
      const sway = Math.sin(t * 3 + i * 1.5 + ph) * 1.6 * t;
      const half = (tx === 12 ? 4.2 : 3) * (1 - t * 0.85);
      for (let x = Math.floor(tx - half + sway); x <= Math.ceil(tx + half + sway); x++) {
        const d = Math.abs(x + 0.5 - tx - sway) / Math.max(0.6, half);
        if (d > 1) continue;
        pen.max(x, base - k, heat(K, 0.95 - t * 0.6 - d * 0.45));
      }
    }
  }
  for (let x = 5; x <= 19; x++) pen.max(x, base + 1, x % 3 ? K.MID : K.L); // the hot bed
  // a spark above
  pen.set(10 + i * 2, 3 + (i % 2) * 2, K.L);
}

/**
 * The jaws snapping: an upper and a lower crescent closing on each other, fang ticks, a spark at
 * the bite on the last frame.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bite(pen, i, K) {
  const cx = 12, cy = 10;
  const gap = [6, 3, 0.5][i];
  for (const s of [-1, 1]) {
    for (let k = -10; k <= 10; k++) {
      const x = cx + k;
      const curve = (k * k) / 22;
      const y = cy + s * (gap + 3 - curve);
      const v = Math.abs(k) < 4 ? K.W : Math.abs(k) < 8 ? K.L : K.MID;
      pen.set(x, y, v);
      if (Math.abs(k) < 7) pen.set(x, y + s, K.D);
      // fangs
      if (k % 4 === 0 && Math.abs(k) < 9) pen.set(x, y - s, K.L);
    }
  }
  if (i === 2) {
    for (const [dx, dy] of [[0, -3], [0, 3], [-4, 0], [4, 0], [-2, -2], [2, 2], [2, -2], [-2, 2]]) pen.max(cx + dx, cy + dy, K.L);
    pen.set(cx, cy, K.W);
  }
}

/**
 * Three claw streaks raking down and across, drawn in over the frames, the last one fading.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function claw(pen, i, K) {
  const len = [0.55, 1, 1][i];
  for (let k = 0; k < 3; k++) {
    const x0 = 5 + k * 6, y0 = 3;
    const x1 = 2 + k * 6, y1 = 21;
    const n = 20;
    for (let s = 0; s <= n * len; s++) {
      const t = s / n;
      const x = x0 + (x1 - x0) * t + Math.sin(t * Math.PI) * 2.5;
      const y = y0 + (y1 - y0) * t;
      if (i === 2 && hash(s, k, 13) < 0.4) continue;
      const v = t > len - 0.25 ? K.W : t > 0.3 ? K.L : K.MID;
      pen.set(x, y, v);
      if (t > 0.2 && t < 0.8) pen.set(x + 1, y, K.D);
    }
  }
}
