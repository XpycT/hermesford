/**
 * The guardians' FX frames (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.7):
 * Rimehart's and the Harvest Mawkin's — painted into the combat FX atlas (../FxSprites.js: the module
 * shape, the pen and the kit) in grey levels that the FxQuads instance colour tints. Frost on snow:
 * every frame carries a dark rim (the kit's `R`), so a pale ice tint reads on white ground, and the
 * guardians tint them below the bloom threshold (never additive white). Generation 3 (`late: 3`,
 * the Evermere batch), registered by the guardians' pack modules (src/game/combat/packs/evermere/
 * rimehart.js) through `registerFxModule`. Owner: the guardians package. RNG-free: closed-form
 * shapes.
 *
 * - `evgFrostBurst` 32 × 32 × 4 (20 fps, flat): a ring of ice crystals bursting out (r 6 → 15 px)
 *   and breaking up — a landing, a stomp, a shell cracking.
 * - `evgIcePatch` 32 × 32 × 1 (still, flat): an irregular sheet of ice with crack lines — the
 *   Blizzard Bellow's patches (looped for their life).
 * - `evgStalk` 12 × 24 × 5 (12 fps, billboard): a cluster of three ice spikes erupting, standing,
 *   cracking and shattering — the Mawkin's frost stalks.
 * - `evgCrow` 16 × 12 × 4 (12 fps, billboard): a crow beating its wings (up, level, down, level) —
 *   the Crow Volley's divers.
 * - `evgGust` 12 × 48 × 4 (12 fps, flat along +V): streaks of wind with flecks of leaf racing
 *   forward — the North Wind's lanes.
 * - `evgReap` 64 × 32 × 4 (30 fps, flat, bulging toward +V): the ice scythe's crescent sweeping
 *   from the right to the left, rimed with shards along its edge, a dark rim — the Mawkin's Reap
 *   (twice, back to back, for the full turn).
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps, late }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  evgFrostBurst: Object.freeze({ w: 32, h: 32, n: 4, fps: 20, late: 3 }),
  evgIcePatch: Object.freeze({ w: 32, h: 32, n: 1, fps: 0, late: 3 }),
  evgStalk: Object.freeze({ w: 12, h: 24, n: 5, fps: 12, late: 3 }),
  evgCrow: Object.freeze({ w: 16, h: 12, n: 4, fps: 12, late: 3 }),
  evgGust: Object.freeze({ w: 12, h: 48, n: 4, fps: 12, late: 3 }),
  evgReap: Object.freeze({ w: 64, h: 32, n: 4, fps: 30, late: 3 }),
});

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  if (name === 'evgFrostBurst') frostBurst(pen, i, K);
  else if (name === 'evgIcePatch') icePatch(pen, K);
  else if (name === 'evgStalk') stalk(pen, i, K);
  else if (name === 'evgCrow') crow(pen, i, K);
  else if (name === 'evgGust') gust(pen, i, K);
  else if (name === 'evgReap') reap(pen, i, K);
}

/**
 * The reaping crescent: the kit's arc (as `slashBig`), ice shards standing off its outer edge, the
 * tail breaking into flecks, a dark rim (it reads on wheat and on snow).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function reap(pen, i, K) {
  const P = [
    { a0: 0.12, a1: 1.3, lead: 'left', thick: 0.26 },
    { a0: 0.08, a1: 2.4, lead: 'left', thick: 0.32 },
    { a0: 0.3, a1: 3.05, lead: 'left', thick: 0.28 },
    { a0: 1.6, a1: 3.08, lead: 'left', thick: 0.16 },
  ][i];
  K.arc(pen, { cx: 32, cy: 30.5, rx: 30, ry: 28, ...P });
  // shards off the outer edge, along the revealed part
  for (let k = 0; k < 9; k++) {
    const a = P.a0 + ((k + 0.5) / 9) * (P.a1 - P.a0);
    if ((k + i) % 3 === 2) continue;
    const ex = 32 + Math.cos(a) * 30.5;
    const ey = 30.5 - Math.sin(a) * 28.5;
    const ox = Math.cos(a);
    const oy = -Math.sin(a);
    for (let s = 0; s < 3; s++) pen.max(ex + ox * s, ey + oy * s, s === 0 ? K.L : K.MID);
  }
  if (i === 3) for (let x = 4; x < 30; x += 4) pen.max(x, 26 - (x % 3), K.D);
  pen.rim(K.R);
}

/** Point in triangle (barycentric signs). */
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * The burst: eight ice crystals (diamonds pointing out) on a ring that grows with `i`, a dusting of
 * frost inside it; the last frames break the ring up.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function frostBurst(pen, i, K) {
  const c = 16;
  const R = [6, 10, 13, 15][i];
  const len = [5, 6, 5, 3][i];
  const half = [1.6, 1.8, 1.5, 1.0][i];
  for (let k = 0; k < 8; k++) {
    if (i === 3 && k % 2 === 1) continue;
    const a = (k / 8) * Math.PI * 2 + (k % 2 ? 0.2 : 0) + i * 0.08;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const r0 = R - len * 0.4;
    const r1 = R + len * 0.6;
    const bx = c + ux * r0;
    const by = c + uy * r0;
    const tx = c + ux * r1;
    const ty = c + uy * r1;
    const px = -uy * half;
    const py = ux * half;
    const mx = c + ux * (r0 + r1) * 0.5;
    const my = c + uy * (r0 + r1) * 0.5;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const qx = x + 0.5;
        const qy = y + 0.5;
        const inA = inTri(qx, qy, bx, by, mx + px, my + py, tx, ty);
        const inB = inTri(qx, qy, bx, by, mx - px, my - py, tx, ty);
        if (!inA && !inB) continue;
        // the lit facet (toward the upper left) and the shaded one
        const lit = (px * -0.6 + py * -0.8) > 0 ? inA : inB;
        pen.set(x, y, lit ? (i === 0 ? K.W : K.L) : K.MID);
      }
    }
  }
  // frost dust inside the ring (sparse, thinning)
  const dust = [0.55, 0.35, 0.2, 0.08][i];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r > R - 1 || r < R * 0.35) continue;
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      if (n - Math.floor(n) < dust) pen.max(x, y, (x + y) % 3 ? K.D : K.MID);
    }
  }
  pen.rim(K.R);
}

/**
 * An irregular sheet of ice: a blob whose edge wanders by angle, pale in the upper left, crack lines
 * from a point off its centre, a dark rim.
 * @param {FxPen} pen @param {FxKit} K
 */
function icePatch(pen, K) {
  const c = 16;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const a = Math.atan2(dy, dx);
      const edge = 12.2 + 1.4 * Math.sin(3 * a + 0.7) + 0.9 * Math.cos(5 * a - 1.1) + 0.5 * Math.sin(9 * a);
      const r = Math.hypot(dx, dy * 1.05);
      if (r > edge) continue;
      const lit = -(dx * 0.6 + dy * 0.8) / 12;
      const v = r > edge - 1.5 ? K.D : lit > 0.45 ? K.L : lit > -0.2 ? K.MID : K.D;
      pen.set(x, y, v);
    }
  }
  // the cracks: five lines from a point up-left of the centre
  const ox = 13;
  const oy = 14;
  for (const [ang, n] of [[0.3, 11], [1.6, 10], [2.7, 9], [3.9, 12], [5.2, 9]]) {
    for (let t = 0; t <= n; t++) {
      const wob = Math.sin(t * 1.7 + ang) * 0.8;
      const x = ox + Math.cos(ang) * t - Math.sin(ang) * wob;
      const y = oy + Math.sin(ang) * t + Math.cos(ang) * wob;
      if (pen.get(Math.round(x), Math.round(y))) pen.set(x, y, K.S);
    }
  }
  // glints on the lit side
  for (const [x, y] of [[9, 10], [10, 9], [15, 8], [20, 11], [8, 16]]) if (pen.get(x, y)) pen.set(x, y, K.W);
  pen.rim(K.R);
}

/**
 * Three ice spikes (the middle one tallest) erupting over the frames: rising, standing, cracked,
 * shattering. The lit face left, the shade right, a dark rim.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function stalk(pen, i, K) {
  const G = 23;
  const grow = [0.25, 0.7, 1, 1, 0.75][i];
  const spikes = [[6, 22, 2.6], [2.5, 13, 1.8], [9.5, 15, 1.9]];
  for (const [sx, h0, hw] of spikes) {
    const h = h0 * grow;
    if (h < 1) continue;
    for (let y = 0; y < 24; y++) {
      const t = (G - y) / h; // 0 at the foot, 1 at the tip
      if (t < 0 || t > 1) continue;
      const w = hw * (1 - t);
      for (let x = 0; x < 12; x++) {
        const dx = x + 0.5 - sx;
        if (Math.abs(dx) > w + 0.15) continue;
        /** @type {number} */
        let v = dx < -0.2 ? K.L : dx < 0.6 ? K.MID : K.D;
        if (t > 0.8) v = K.W;
        // cracked (frame 3), breaking up (frame 4)
        if (i >= 3 && ((y * 5 + x * 3 + Math.round(sx)) % 7 === 0)) v = K.S;
        if (i === 4 && ((y + Math.round(sx)) % 4 === 0)) continue;
        pen.set(x, y, v);
      }
    }
  }
  // chips of ice at the foot
  if (i >= 1) for (const [x, y] of [[1, 23], [4, 22], [10, 23], [7, 23]]) pen.max(x, y, K.MID);
  pen.rim(K.R);
}

/**
 * A crow flying to the right (the quad's billboard faces the camera): the body, the head and beak,
 * the wings up / level / down / level.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function crow(pen, i, K) {
  const cy = 6;
  // body and tail
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 7.5) / 3.6;
      const dy = (y + 0.5 - cy) / 1.7;
      if (dx * dx + dy * dy <= 1) pen.set(x, y, dy < -0.2 ? K.MID : K.D);
    }
  }
  for (const [x, y] of [[3, 6], [2, 6], [2, 7], [1, 7], [3, 7]]) pen.set(x, y, K.D);
  // head and beak
  for (const [x, y] of [[11, 5], [12, 5], [11, 6], [12, 6], [12, 4]]) pen.set(x, y, K.MID);
  pen.set(13, 6, K.L);
  pen.set(14, 6, K.L);
  pen.set(12, 5, K.W); // the eye's glint
  // wings
  const wing = [
    [[6, 5], [5, 4], [5, 3], [4, 2], [4, 1], [3, 0], [7, 4], [6, 3], [6, 2], [5, 1]],
    [[6, 5], [5, 5], [4, 5], [3, 4], [2, 4], [7, 5], [8, 5], [1, 4]],
    [[6, 7], [5, 8], [5, 9], [4, 10], [4, 11], [7, 8], [6, 9], [6, 10]],
    [[6, 5], [5, 5], [4, 6], [3, 6], [2, 5], [7, 5], [8, 5], [1, 5]],
  ][i];
  for (const [x, y] of wing) pen.set(x, y, K.S);
  pen.rim(K.R);
}

/**
 * Wind streaks along +V (the flat quad's forward axis): four thin lines of different lengths that
 * race forward over the frames, flecks of leaf among them.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function gust(pen, i, K) {
  const lines = [[2, 18, 0], [5, 28, 11], [8, 14, 23], [10, 22, 35]];
  for (const [x, len, off] of lines) {
    const y0 = (48 - ((off + i * 12) % 48)) - len;
    for (let k = 0; k < len; k++) {
      const y = y0 + k;
      if (y < 0 || y >= 48) continue;
      const t = k / len;
      pen.set(x, y, t < 0.25 ? K.W : t < 0.6 ? K.L : K.D);
    }
  }
  // leaf flecks riding the wind
  for (const [x, yb] of [[3, 7], [7, 21], [9, 38], [4, 33]]) {
    const y = (yb + 48 - i * 12) % 48;
    pen.set(x, y, K.MID);
    pen.set(x + 1, y, K.D);
    pen.set(x, y + 1, K.S);
  }
}
