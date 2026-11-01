/**
 * Old Gullet's FX frames (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.7): the
 * holes it breaks in the sea ice and everything thrown up through them — painted into the combat FX
 * atlas (../FxSprites.js: the module shape, the pen and the kit) in grey levels that the FxQuads
 * instance colour tints (`TINTS`: the game's). Generation `late: 3` (the pack's batch). Owner: the
 * gullet package. RNG-free: closed-form shapes and fixed hashes.
 *
 * A hole is two flat quads, centred and turned alike (+V north): the open water (`gulletPool`, the
 * small `gulletPoolS`: dark teal, the deep centre darker, a slow broken ripple, a few glints) and its
 * broken white rim (`gulletRim` / `gulletRimS`: slabs of ice round the edge, gaps between them, the
 * ice's cut face showing on the far edge, a few floes adrift) — the rim's inner edge follows the
 * pool's own outline (`poolRadius`). The rest:
 * - `gulletCrack` 24 × 48 × 3 (flat, along +V): a fracture in the ice, a lit lip on one side.
 * - `gulletShard` 12 × 12 × 2 (billboard): an ice shard tumbling (the barrage).
 * - `gulletBurst` 48 × 48 × 4 (billboard, 16 fps): slabs of ice and spray flung up through the ice.
 * - `gulletShadow` 80 × 64 (flat): the creature seen from above — the mantle and eight arms — drawn
 *   dark and dithered thin: its shape moving under the ice.
 * - `gulletGlint` 9 × 9 × 3 (billboard): a gold glint on the water where the head will rise.
 * - `gulletFoam` 48 × 48 × 3 (flat, 12 fps): a ring of foam spreading on a hole's water.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps, late }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  gulletPool: Object.freeze({ w: 56, h: 56, n: 3, fps: 3, late: 3 }),
  gulletPoolS: Object.freeze({ w: 40, h: 40, n: 3, fps: 3, late: 3 }),
  gulletRim: Object.freeze({ w: 64, h: 64, n: 2, fps: 0, late: 3 }),
  gulletRimS: Object.freeze({ w: 48, h: 48, n: 2, fps: 0, late: 3 }),
  gulletCrack: Object.freeze({ w: 24, h: 48, n: 3, fps: 0, late: 3 }),
  gulletShard: Object.freeze({ w: 12, h: 12, n: 2, fps: 8, late: 3 }),
  gulletBurst: Object.freeze({ w: 48, h: 48, n: 4, fps: 16, late: 3 }),
  gulletShadow: Object.freeze({ w: 80, h: 64, n: 1, fps: 0, late: 3 }),
  gulletGlint: Object.freeze({ w: 9, h: 9, n: 3, fps: 10, late: 3 }),
  gulletFoam: Object.freeze({ w: 48, h: 48, n: 3, fps: 12, late: 3 }),
});

/**
 * The colours the game tints each frame with (linear HDR; a max channel above ~1.4 blooms): the
 * open water a deep teal (`#0c2230` where the frame is dark, `#2a6a88` at its brightest), the ice
 * pale in the morning sun, the cracks blue, the shadow almost black, the glint gold.
 * @type {Readonly<Record<string, readonly number[]>>}
 */
export const TINTS = Object.freeze({
  gulletPool: Object.freeze([0.024, 0.15, 0.25]),
  gulletPoolS: Object.freeze([0.024, 0.15, 0.25]),
  gulletRim: Object.freeze([0.8, 0.9, 1.0]),
  gulletRimS: Object.freeze([0.8, 0.9, 1.0]),
  gulletCrack: Object.freeze([0.3, 0.46, 0.6]),
  gulletShard: Object.freeze([0.95, 1.05, 1.15]),
  gulletBurst: Object.freeze([0.95, 1.04, 1.12]),
  gulletShadow: Object.freeze([0.03, 0.045, 0.09]),
  gulletGlint: Object.freeze([1.8, 1.3, 0.45]),
  gulletFoam: Object.freeze([0.85, 0.95, 1.0]),
});

/**
 * A hole's water outline (px from its centre) at angle `a` (texture space, y down): an uneven
 * break, the big hole's or the small one's. The rim frames follow the same outline.
 * @param {number} a
 * @param {boolean} small
 */
export function poolRadius(a, small) {
  return small
    ? 15 + 1.1 * Math.sin(5 * a + 1.9) + 0.7 * Math.sin(8 * a + 0.4) + 0.4 * Math.sin(13 * a + 2.6)
    : 22 + 1.4 * Math.sin(5 * a + 0.7) + 0.9 * Math.sin(9 * a + 2.1) + 0.6 * Math.sin(13 * a + 0.3);
}

/** A fixed hash in [0, 1) of two numbers (the atlas is painted once: no RNG). */
function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'gulletPool': pool(pen, i, K, false); break;
    case 'gulletPoolS': pool(pen, i, K, true); break;
    case 'gulletRim': rim(pen, i, K, false); break;
    case 'gulletRimS': rim(pen, i, K, true); break;
    case 'gulletCrack': crack(pen, i, K); break;
    case 'gulletShard': shard(pen, i, K); break;
    case 'gulletBurst': burst(pen, i, K); break;
    case 'gulletShadow': shadow(pen, K); break;
    case 'gulletGlint': glint(pen, i, K); break;
    case 'gulletFoam': foam(pen, i, K); break;
    default: break;
  }
}

/**
 * Open water: the deep centre, a broken ripple ring moving outward over the three frames, the far
 * edge lighter under the ice's lip, the near edge darker, a few glints.
 * @param {FxPen} pen @param {number} i @param {FxKit} K @param {boolean} small
 */
function pool(pen, i, K, small) {
  const c = pen.w / 2;
  for (let y = 0; y < pen.h; y++) {
    for (let x = 0; x < pen.w; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const R = poolRadius(a, small) + 0.6;
      if (r > R) continue;
      /** @type {number} */
      let v = r < R * 0.42 ? K.R : K.S;
      // the ripple: two broken rings drifting out with the frames
      for (const k of [0, 1]) {
        const rr = (R * 0.3 + (k * R * 0.36) + i * (R * 0.12)) % (R * 0.82);
        if (Math.abs(r - rr) < 0.65 && h2(Math.round(a * 9), k + i * 3) > 0.35) v = K.D;
      }
      // the far edge (north, the frame's top) lit by the ice wall above it, the near edge shadowed
      if (r > R - 2.6) v = dy < 0 ? K.MID : K.R;
      if (r > R - 1.2 && dy < -R * 0.3) v = K.L;
      pen.set(x, y, v);
    }
  }
  // glints on the dark water, somewhere else every frame
  const n = small ? 2 : 4;
  for (let k = 0; k < n; k++) {
    const a = h2(k * 3.7, i * 1.3 + 2) * Math.PI * 2;
    const rr = (0.25 + 0.5 * h2(k + 9, i * 2.1)) * (small ? 13 : 19);
    const gx = Math.round(c + Math.cos(a) * rr), gy = Math.round(c + Math.sin(a) * rr);
    pen.set(gx, gy, K.W);
    if (!small && k % 2 === 0) pen.set(gx + 1, gy, K.L);
  }
}

/**
 * The broken rim: slabs of ice round the water's edge (gaps where the ice broke away), each slab lit
 * on its top, a dark outer break; on the far side the ice's cut face shows below the lip, on the
 * near side the lip catches the light; a few floes adrift inside. `i` picks the break pattern.
 * @param {FxPen} pen @param {number} i @param {FxKit} K @param {boolean} small
 */
function rim(pen, i, K, small) {
  const c = pen.w / 2;
  const thick = small ? 3 : 3.6;
  const ragged = small ? 2 : 2.6;
  const gaps = small ? 6 : 8;
  for (let y = 0; y < pen.h; y++) {
    for (let x = 0; x < pen.w; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const R = poolRadius(a, small);
      const inner = R - (small ? 0.9 : 1.2);
      const outer = R + thick + ragged * (0.5 + 0.5 * Math.sin(11 * a + i * 2.3) * Math.cos(7 * a - 0.8 + i));
      if (r < inner || r > outer) continue;
      // the breaks between slabs (the outer half only: the edge itself stays whole)
      const brk = Math.sin(gaps * a + i * 1.7 + 0.6 * Math.sin(3 * a + i));
      if (brk > 0.82 && r > R + 0.8) continue;
      let v;
      const t = r - inner;
      if (t < 1.6) v = dy < 0 ? (t < 0.9 ? K.D : K.MID) : (t < 0.9 ? K.W : K.L); // the lip (far: the cut face below it)
      else if (r > outer - 1) v = K.S; // the slab's broken outer edge
      else {
        // the slab's top, lit from the upper left, a crack here and there
        const lit = (-dx - dy) / Math.max(1, r);
        v = lit > 0.35 ? K.W : lit > -0.45 ? K.L : K.MID;
        if (Math.abs(Math.sin(gaps * 1.5 * a + i * 0.9)) < 0.07) v = K.D;
      }
      pen.set(x, y, v);
    }
  }
  // floes adrift just inside the edge
  const floes = small ? 2 : 4;
  for (let k = 0; k < floes; k++) {
    const a = (k / floes) * Math.PI * 2 + 0.9 + i * 1.1;
    const rr = poolRadius(a, small) - (small ? 3.2 : 4.5);
    const fx = c + Math.cos(a) * rr, fy = c + Math.sin(a) * rr;
    const fw = small ? 2 : 3;
    for (let y = 0; y < 2; y++) for (let x = 0; x < fw; x++) pen.set(fx + x, fy + y, y === 0 ? K.W : K.MID);
  }
}

/**
 * A fracture in the ice along +V (the frame's height): a jagged dark line with a lit lip on its left,
 * two short branches; `i` another break.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function crack(pen, i, K) {
  /** @type {number[][]} */
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const y = 47 - k * 6;
    const x = 12 + (k === 0 || k === 8 ? 0 : (h2(k * 1.7, i * 5.3) - 0.5) * 7);
    pts.push([x, Math.max(0, y)]);
  }
  const line = (x0, y0, x1, y1, main) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2);
    for (let s = 0; s <= n; s++) {
      const t = s / Math.max(1, n);
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      pen.set(x, y, K.R);
      if (main) {
        pen.max(x - 1, y, K.W);
        if ((x + y) % 2 === 0) pen.set(x + 1, y, K.S);
      }
    }
  };
  for (let k = 0; k + 1 < pts.length; k++) line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], true);
  // branches
  for (const [k, dir, len] of [[2 + (i % 2), 1, 7], [5 - (i % 2), -1, 6]]) {
    const [x, y] = pts[k];
    line(x, y, x + dir * len, y - len * 0.7, false);
  }
}

/**
 * An ice shard: an elongated crystal, its lit edge, its body, its dark edge (frame 1: turned).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function shard(pen, i, K) {
  const A = i === 0 ? [2, 10] : [1, 5];
  const Bp = i === 0 ? [10, 2] : [11, 7];
  const dx = Bp[0] - A[0], dy = Bp[1] - A[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const px = x + 0.5 - A[0], py = y + 0.5 - A[1];
      const along = px * ux + py * uy;
      const across = -px * uy + py * ux;
      if (along < 0 || along > len) continue;
      const t = along / len;
      const half = 2.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.3;
      if (Math.abs(across) > half) continue;
      pen.set(x, y, across < -half * 0.4 ? K.W : across > half * 0.45 ? K.D : t > 0.7 ? K.W : K.L);
    }
  }
}

/**
 * The eruption through the ice: a column of spray and slabs of ice flung up and out, falling back on
 * the last frames (the frame's bottom is the ice).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function burst(pen, i, K) {
  const c = 24;
  const t = (i + 0.5) / 4;
  // the spray: lumps rising from the hole, thinning out
  const top = 46 - (14 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.25)));
  for (let y = Math.floor(top); y < 47; y++) {
    const k = (47 - y) / Math.max(1, 47 - top);
    const half = 3 + 6 * k * (1 - k) * 2 + (i >= 2 ? 3 * k : 0);
    for (let x = Math.floor(c - half); x <= Math.ceil(c + half); x++) {
      const n = h2(x * 0.7 + i * 3, y * 0.6);
      if (n < (i >= 3 ? 0.55 : i === 2 ? 0.35 : 0.15)) continue;
      pen.set(x, y, n > 0.75 ? K.W : n > 0.45 ? K.L : K.MID);
    }
  }
  // the slabs: six wedges on ballistic arcs
  for (let s = 0; s < 6; s++) {
    const vx = (s - 2.5) * 3.2 + (h2(s, 1) - 0.5) * 2;
    const vy = 30 + 10 * h2(s, 2);
    const T = t * 1.35;
    const x = c + vx * T;
    const y = 44 - (vy * T - 24 * T * T);
    if (y > 46) continue;
    const w = 3 + (s % 3);
    const tilt = (s % 2 ? 0.5 : -0.5) + i * 0.3 * (s % 2 ? 1 : -1);
    for (let k = 0; k < w; k++) {
      const px = x + k - w / 2, py = y + (k - w / 2) * tilt;
      pen.set(px, py, K.W);
      pen.set(px, py + 1, K.L);
      pen.set(px, py + 2, K.D);
    }
  }
}

/**
 * The creature seen from above (texture up = north): the mantle, eight tapering arms curling out
 * from under it. One grey (the quad's colour and dither make it a shadow).
 * @param {FxPen} pen @param {FxKit} K
 */
function shadow(pen, K) {
  const cx = 40, cy = 24;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 80; x++) {
      const dx = (x + 0.5 - cx) / 14, dy = (y + 0.5 - cy) / 12;
      if (dx * dx + dy * dy <= 1) pen.set(x, y, K.W);
    }
  }
  for (let k = 0; k < 8; k++) {
    const a0 = Math.PI * (0.05 + k / 7 * 0.9) ;
    let x = cx + Math.cos(a0) * 10, y = cy + Math.sin(a0) * 8;
    let a = a0;
    const curl = (k % 2 ? 1 : -1) * 0.05;
    for (let s = 0; s < 30; s++) {
      const r = 3.2 * (1 - s / 30) + 0.6;
      for (let oy = -Math.ceil(r); oy <= Math.ceil(r); oy++) {
        for (let ox = -Math.ceil(r); ox <= Math.ceil(r); ox++) if (ox * ox + oy * oy <= r * r) pen.set(x + ox, y + oy, K.W);
      }
      a += curl;
      x += Math.cos(a) * 1.15;
      y += Math.sin(a) * 1.15;
    }
  }
}

/**
 * A gold glint: a four-point star growing and shrinking.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function glint(pen, i, K) {
  const len = [1, 4, 2][i];
  for (let k = -len; k <= len; k++) {
    const v = Math.abs(k) < 1 ? K.W : Math.abs(k) < len ? K.L : K.MID;
    pen.set(4 + k, 4, v);
    pen.set(4, 4 + k, v);
  }
  if (i === 1) for (const [x, y] of [[3, 3], [5, 3], [3, 5], [5, 5]]) pen.set(x, y, K.MID);
}

/**
 * A ring of foam spreading on a hole's water, breaking up as it goes.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function foam(pen, i, K) {
  const c = 24;
  const R = [9, 14, 19][i];
  const band = [2.4, 1.9, 1.3][i];
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (Math.abs(r - R) > band) continue;
      const n = h2(x * 1.3 + i, y * 1.1);
      if (n < 0.2 + 0.18 * i) continue;
      pen.set(x, y, r < R ? K.L : n > 0.7 ? K.W : K.MID);
    }
  }
}
