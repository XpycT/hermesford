/**
 * The Hushed King's and the Hush Bell's FX frames (The Bells of Evermere,
 * docs/contracts/EVERMERE_CAMPAIGN.md §6.7) — painted into the combat FX atlas (../FxSprites.js: the
 * module shape, the pen and the kit) in grey levels that the FxQuads instance colour tints. Owner:
 * the king package; registered at load by the Evermere enemy pack
 * (src/game/combat/packs/evermere/hushedking.js) — generation `late: 3`. RNG-free: closed forms.
 *
 * The look (survey: black bell `#0d0d14` rim `#5fd0e8`; "cut-out, never additive white on snow"):
 * dark grey bodies with a bright rim, tinted toward navy / cyan — so the black reads as black on
 * snow, and the rim reads on dark ice.
 * - `evkBell` 20 × 24 × 2 (billboard): the planted black bell — at rest, and struck (its sound-bow
 *   lit).
 * - `evkBellDrop` 20 × 40 × 4 (20 fps, billboard): a bell dropping from the sky into its place at
 *   the frame's foot (the Black Carillon's four).
 * - `evkRing` 48 × 48 × 4 (16 fps, flat): a black bell's sound ring racing out — a dark band with a
 *   bright inner edge, breaking up.
 * - `evkPeal` 64 × 40 × 4 (24 fps, flat): the Black Peal — three dark arcs of sound fanning out
 *   from the apex at the frame's foot (toward +V, the facing; the last reaches 37 px), bright
 *   leading edges.
 * - `evkWave` 32 × 12 × 2 (8 fps, flat): a segment of the Hush Bell's rolling ring (U along the
 *   ring, +V outward: its bright front edge toward +V), frost ash trailing.
 * - `evkWarm` 64 × 64 × 1 (flat): a warm safe zone's dashed ring (radius 29 px: × 1.93 for r 3.5)
 *   flashed on every beat of the toll.
 * - `evkSpike` 12 × 24 × 4 (18 fps, billboard): an ice spike of the Rime Lane erupting, standing,
 *   cracking.
 * - `evkBurst` 32 × 32 × 5 (30 fps, billboard): the crown's shattering — a star of ice splinters.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps, late }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  evkBell: Object.freeze({ w: 20, h: 24, n: 2, fps: 0, late: 3 }),
  evkBellDrop: Object.freeze({ w: 20, h: 40, n: 4, fps: 20, late: 3 }),
  evkRing: Object.freeze({ w: 48, h: 48, n: 4, fps: 16, late: 3 }),
  evkPeal: Object.freeze({ w: 64, h: 40, n: 4, fps: 24, late: 3 }),
  evkWave: Object.freeze({ w: 32, h: 12, n: 2, fps: 8, late: 3 }),
  evkWarm: Object.freeze({ w: 64, h: 64, n: 1, fps: 0, late: 3 }),
  evkSpike: Object.freeze({ w: 12, h: 24, n: 4, fps: 18, late: 3 }),
  evkBurst: Object.freeze({ w: 32, h: 32, n: 5, fps: 30, late: 3 }),
});

/** Dark greys of the black bodies (below the kit's rim level). */
const K0 = 34, K1 = 52, K2 = 74;

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'evkBell': bell(pen, 10, 2, i === 1, K); break;
    case 'evkBellDrop': bellDrop(pen, i, K); break;
    case 'evkRing': ring(pen, i, K); break;
    case 'evkPeal': peal(pen, i, K); break;
    case 'evkWave': wave(pen, i, K); break;
    case 'evkWarm': warm(pen, K); break;
    case 'evkSpike': spike(pen, i, K); break;
    case 'evkBurst': burst(pen, i, K); break;
    default: break;
  }
}

/**
 * The black bell, its crown at (cx, top): the canons, a waisted body flaring to the lip, a bright
 * sound-bow rim (the struck bell: the whole bow lit, the clapper showing).
 * @param {FxPen} pen @param {number} cx @param {number} top @param {boolean} struck @param {FxKit} K
 */
function bell(pen, cx, top, struck, K) {
  // the canons (the hanging loop)
  for (const [x, y] of [[-1, 0], [0, 0], [1, 0], [-2, 1], [2, 1]]) pen.set(cx + x - 0.5, top + y, K2);
  // the body: half-width by row (waist to lip)
  const rows = [3, 4, 4.5, 4.8, 5, 5.2, 5.4, 5.7, 6, 6.4, 6.9, 7.5, 8.2, 8.8, 9.2, 9.4];
  rows.forEach((hw, k) => {
    const y = top + 2 + k;
    for (let x = Math.floor(cx - hw); x < Math.ceil(cx + hw); x++) {
      const u = (x + 0.5 - cx) / hw;
      // lit from the upper left: a soft highlight streak on the shoulder, dark toward the right
      let v = u < -0.55 ? K2 : u < 0.1 ? K1 : K0;
      if (u > -0.62 && u < -0.42 && k > 1 && k < 11) v = K.S;
      if (k >= rows.length - 3) v = k === rows.length - 1 ? (struck ? K.W : K.L) : struck ? K.MID : K.D;
      if (Math.abs(u) > 0.92) v = Math.max(v, K.S);
      pen.set(x, y, v);
    }
  });
  // a band of the founder's mark across the waist
  for (let x = cx - 5; x < cx + 5; x++) pen.set(x, top + 7, K.R);
  if (struck) {
    // the clapper swinging out under the lip
    pen.set(cx + 2, top + 2 + rows.length, K.MID);
    pen.set(cx + 3, top + 3 + rows.length, K.L);
  }
}

/**
 * A bell falling into place: high and streaked (frames 0–1), landing at the foot (2), settled with a
 * crack of frost at its lip (3).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bellDrop(pen, i, K) {
  const top = [0, 7, 15, 15][i];
  if (i < 2) {
    // the streak above it
    for (let y = 0; y < top + 2; y++) {
      if ((y + i) % 3 === 0) continue;
      pen.set(9, y, K.D);
      if (y > top - 4) pen.set(11, y, K.S);
    }
  }
  bell(pen, 10, top, i === 2, K);
  if (i >= 2) {
    // frost bursting out at the lip
    const y = top + 18;
    for (const [x, dy, v] of [[1, -1, K.L], [2, 0, K.MID], [18, -1, K.L], [17, 0, K.MID], [0, -2, K.D], [19, -2, K.D]]) pen.set(x, y + dy, i === 3 ? Math.max(K.R, v - 60) : v);
  }
}

/**
 * The sound ring: a dark band (radius 10 → 22 px) with a bright inner edge, thinning and breaking up.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function ring(pen, i, K) {
  const c = 24;
  const R = [10, 15, 19, 22][i];
  const band = [4, 3.5, 2.8, 2][i];
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r > R || r < R - band) continue;
      const a = Math.atan2(y + 0.5 - c, x + 0.5 - c);
      if (i >= 2 && Math.sin(a * 11 + i) > 0.55) continue;
      const t = (R - r) / band; // 0 outer … 1 inner
      pen.set(x, y, t > 0.72 ? (i < 2 ? K.W : K.L) : t > 0.45 ? K.D : t > 0.2 ? K1 : K0);
    }
  }
}

/**
 * The Black Peal: three arcs fanning out (± 35°) from the apex at the frame's bottom middle.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function peal(pen, i, K) {
  const ax = 32, ay = 39;
  const half = (35 * Math.PI) / 180;
  const radii = [[11, 0, 0], [19, 11, 0], [28, 19, 11], [37, 28, 19]][i];
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = x + 0.5 - ax;
      const dy = ay - (y + 0.5);
      if (dy < 0) continue;
      const a = Math.atan2(dx, dy);
      if (Math.abs(a) > half) continue;
      const r = Math.hypot(dx, dy);
      for (const [k, R] of radii.entries()) {
        if (R <= 0) continue;
        const band = 4 - k * 0.8;
        if (r > R || r < R - band) continue;
        const t = (R - r) / band;
        const edge = Math.abs(a) > half * 0.86;
        // (the oldest arc breaking up)
        if (k === 2 && (x + y) % 3 === 0) break;
        pen.set(x, y, t < 0.3 ? (k === 0 ? K.W : K.L) : edge ? K1 : t < 0.65 ? K.D : K0);
        break;
      }
    }
  }
}

/**
 * A segment of the Hush Bell's rolling ring: a bright front edge (top rows), a dark band behind, a
 * ragged trail of frost ash.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function wave(pen, i, K) {
  for (let x = 0; x < 32; x++) {
    // the ends taper (segments overlap along the ring)
    const end = Math.min(x, 31 - x);
    const lift = end < 3 ? 3 - end : 0;
    const ragged = Math.round(2.5 + 2 * Math.sin(x * 0.9 + i * 1.7) + Math.sin(x * 2.3 - i));
    for (let y = lift; y < 12; y++) {
      const fromTop = y - lift;
      if (fromTop > 4 + ragged) continue;
      const v = fromTop === 0 ? (end < 2 ? K.D : K.L) : fromTop === 1 ? K.D : fromTop < 4 ? K1 : K0;
      if (fromTop > 4 && (x + y + i) % 3 === 0) continue;
      pen.set(x, y, v);
    }
  }
}

/**
 * A warm safe zone's ring: a dashed band at radius 29 px, a brighter dash every eighth.
 * @param {FxPen} pen @param {FxKit} K
 */
function warm(pen, K) {
  const c = 32;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r > 30.5 || r < 27.5) continue;
      const a = Math.atan2(y + 0.5 - c, x + 0.5 - c);
      const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 32);
      if (k % 2 === 1) continue;
      pen.set(x, y, r > 29.4 ? K.D : k % 8 === 0 ? K.W : K.L);
    }
  }
}

/**
 * An ice spike: breaking the ground (0), shooting up (1), standing (2), cracked and crumbling (3).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function spike(pen, i, K) {
  const H = [6, 20, 22, 18][i];
  const base = 23;
  for (let k = 0; k < H; k++) {
    const y = base - k;
    const t = k / Math.max(1, H - 1);
    const hw = 4.2 * (1 - t) + 0.4;
    for (let x = Math.floor(6 - hw); x < Math.ceil(6 + hw); x++) {
      const u = (x + 0.5 - 6) / hw;
      if (i === 3 && (x + y) % 4 === 0 && t > 0.4) continue;
      // facets: lit left face, dark right, a bright ridge
      const v = Math.abs(u + 0.15) < 0.18 ? K.W : u < 0 ? K.L : u < 0.6 ? K.MID : K.D;
      pen.set(x, y, v);
    }
  }
  // ground shards at the foot
  for (const [x, dy] of [[0, 0], [1, -1], [11, 0], [10, -1]]) pen.set(x, base + dy, i === 0 ? K.L : K.D);
  if (i === 3) for (const [x, y] of [[2, 8], [9, 5], [1, 13], [10, 11]]) pen.set(x, y, K.L);
}

/**
 * The crown bursting: a star of ice splinters flying out over five frames, a white core first.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function burst(pen, i, K) {
  const c = 16;
  const R = [5, 9, 12, 14, 15][i];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // eight splinter rays, long and thin, and a core that fades
      const ray = Math.abs(Math.sin(a * 4)) < 0.16 + 0.06 * (4 - i);
      if (r < [4, 3, 1.5, 0, 0][i]) { pen.set(x, y, K.W); continue; }
      if (ray && r < R && r > R - [5, 6, 5, 4, 2][i]) pen.set(x, y, r > R - 2 ? K.W : K.L);
      else if (!ray && i < 2 && r < R * 0.5 && (x + y) % 2 === 0) pen.set(x, y, K.MID);
    }
  }
}
