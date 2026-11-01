/**
 * Old Gullet, the Thing under the Bay — the head of The Bells of Evermere's kraken boss
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): ≈ 4 u of barnacled, rime-crusted mantle in a
 * 96 × 96 frame, rising out of a hole in the sea ice — a pale glowing eye, a ring of arm roots at the
 * waterline, the frost-ink siphon. Its arms are the `tentacle` kind (./tentacle.js), painted with
 * the same skin, underside and suckers (`armKit`, shared from here) so the two read as one creature.
 * Owner: the gullet package.
 *
 * The frame's bottom row is the waterline: the quad stands on the ice at its hole, and what the
 * brain sinks below it (`Enemy.lift` < 0) the ice and the hole's water hide. Columns: COMMON (`idle0`
 * / `idle1` breathing, `move0`–`move3` the swell of the water, `windup` the ink — the mantle swollen,
 * the siphon glowing —, `attack` the spray, `hurt`, `dead` freed: the eye soft and warm) +
 * `roar` (the arms thrown up round the head, the beak open), `burst` (slabs of ice on its crown, the
 * eye wide: the rise through the ice), `daze` (Broken: the eye half shut, the mantle slumped). The
 * eye and the siphon are glow texels (alpha 204) for the brain's `glow`. Painted like the other
 * monsters (label buffer, light from the upper left, plum outline); the side view faces left.
 * RNG-free (fixed layouts, `hash2` with fixed seeds).
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/**
 * A pose of the head: the bob (px down), the mantle's swell (px), the eye ('open' | 'wide' | 'narrow'
 * | 'shut' | 'calm'), the arms ('rest' | 'up' | 'in' | 'limp'), the beak open, the siphon's glow
 * (0–4), ice on the crown, a lean (px of shear at the crown, + back).
 * @typedef {{ bob?: number, swell?: number, eye?: string, arms?: string, beak?: boolean,
 *   siphon?: number, ice?: boolean, lean?: number, sway?: number }} HeadPose
 */

/** @type {Record<string, HeadPose>} */
const POSES = {
  idle0: { eye: 'open', siphon: 1 },
  idle1: { bob: 1, swell: 1, eye: 'open', siphon: 1, sway: 1 },
  move0: { bob: 0, eye: 'open', sway: -1 },
  move1: { bob: 1, eye: 'open', sway: 0 },
  move2: { bob: 2, swell: 1, eye: 'open', sway: 1 },
  move3: { bob: 1, eye: 'open', sway: 0 },
  windup: { bob: 0, swell: 3, eye: 'narrow', arms: 'in', siphon: 4, lean: 2 },
  attack: { bob: 1, swell: -1, eye: 'wide', arms: 'in', siphon: 3, lean: -2, beak: true },
  hurt: { bob: 2, swell: -1, eye: 'shut', lean: 3, sway: 1 },
  dead: { bob: 2, swell: -1, eye: 'calm', arms: 'limp', siphon: 0, lean: 1 },
  roar: { bob: -1, swell: 2, eye: 'wide', arms: 'up', beak: true, siphon: 2, lean: 2 },
  burst: { bob: -1, swell: 1, eye: 'wide', arms: 'up', ice: true, siphon: 1 },
  daze: { bob: 3, swell: -2, eye: 'narrow', arms: 'limp', lean: -1, sway: -1 },
};

/** Column names after COMMON. */
const EXTRA = ['roar', 'burst', 'daze'];

/** The light (screen x right, y down, z toward the viewer): from the upper left, in front. */
const LX = -0.502, LY = -0.623, LZ = 0.6;

/**
 * The skin, underside and suckers shared by the head's arm roots and the `tentacle` sheet: a tapered
 * tube along a smoothed centreline, lit from the upper left, the pale underside on one side with its
 * suckers, the dorsal skin mottled. Returned by `armKit(K)` for both painters.
 * @param {MonsterKit} K
 */
export function armKit(K) {
  const { M } = K;
  /** The skin (violet-navy), its darker mottle, the pale underside, the suckers. */
  const SKIN = M.FUR, MOTTLE = M.FUR2, UNDER = M.FUR3, SUCK = M.NOSE, RIME = M.WHITE, WET = M.GEL, BOUNCE = M.COMB;

  /**
   * Catmull-Rom through the control points, resampled every `step` px of arc length.
   * @param {number[][]} pts
   * @param {number} [step]
   * @returns {number[][]} [x, y, tx, ty, s] — point, unit tangent, arc length
   */
  function spline(pts, step = 0.5) {
    /** @type {number[][]} */
    const dense = [];
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let k = 0; k < 12; k++) {
        const t = k / 12, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    dense.push([pts[n - 1][0], pts[n - 1][1]]);
    /** @type {number[][]} */
    const out = [];
    let s = 0, next = 0;
    for (let i = 0; i < dense.length; i++) {
      if (i > 0) s += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
      if (s + 1e-6 < next && i < dense.length - 1) continue;
      const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push([dense[i][0], dense[i][1], (b[0] - a[0]) / tl, (b[1] - a[1]) / tl, s]);
      next = s + step;
    }
    return out;
  }

  /**
   * One arm: a tube along `pts` from the base (radius `r0`) to the tip (`r1`); `side` ±1 puts the
   * pale underside and its suckers on that side of the centreline (the left-hand normal of the
   * direction of travel: +1), 0 none (the dorsal side faces the viewer); `tone` darkens (a far
   * arm −1); `rime` a frost crust along its top; `seed` the mottle.
   * @param {any} p
   * @param {number[][]} pts
   * @param {{ r0: number, r1: number, side?: number, tone?: number, rime?: boolean, seed?: number, under?: number }} o
   */
  function arm(p, pts, { r0, r1, side = 0, tone = 0, rime = false, seed = 1, under = 0.3 }) {
    const line = spline(pts);
    if (!line.length) return;
    const total = line[line.length - 1][4] || 1;
    /** The radius along the arm: full at the base, tapering faster toward the tip. @param {number} t */
    const radius = (t) => r1 + (r0 - r1) * Math.pow(1 - t, 0.9);
    // the body, base to tip (the tip end over the base where the curl crosses itself)
    for (const [cx, cy, tx, ty, s] of line) {
      const t = s / total;
      const r = radius(t);
      const nx = -ty, ny = tx;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
        for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > r * r + 0.15) continue;
          // a round tube: the normal leans across it (the cross-section's), lit from the upper left
          const across = Math.max(-1, Math.min(1, (dx * nx + dy * ny) / Math.max(0.8, r)));
          const nz = Math.sqrt(Math.max(0, 1 - across * across));
          const d = across * (nx * LX + ny * LY) + nz * LZ;
          let sh = d > 0.62 ? 3 : d > 0.25 ? 2 : d > -0.12 ? 1 : 0;
          let mat = SKIN;
          if (side && across * side > under && r > 1.6) {
            mat = UNDER;
            sh = Math.min(4, sh + 1);
          } else if (r > 2 && Math.sin(s * 0.62 + seed * 1.3) + Math.sin(across * 4.1 + s * 0.21 + seed) > 1.3) {
            mat = MOTTLE;
          }
          p.set(x, y, mat, Math.max(0, Math.min(4, sh + tone)));
        }
      }
    }
    // the suckers along the underside: rings on the thick part, single beads toward the tip
    if (side) {
      let nextS = 2;
      for (const [cx, cy, tx, ty, s] of line) {
        if (s < nextS) continue;
        const t = s / total;
        const r = radius(t);
        if (r < 1.4) break;
        nextS = s + Math.max(2.2, r * 0.9);
        const nx = -ty * side, ny = tx * side;
        const sx = cx + nx * r * 0.62, sy = cy + ny * r * 0.62;
        if (r > 4.2) {
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.set(Math.round(sx) + ox, Math.round(sy) + oy, SUCK, Math.min(4, 3 + Math.max(0, tone)));
          p.set(Math.round(sx), Math.round(sy), SUCK, 1);
        } else {
          p.set(Math.round(sx), Math.round(sy), SUCK, Math.min(4, 3 + Math.max(0, tone)));
        }
      }
    }
    // a wet glint on the lit crest, a frost crust where it turns up
    let nextG = 5 + (seed % 4);
    for (const [cx, cy, tx, ty, s] of line) {
      const t = s / total;
      const r = radius(t);
      if (r < 2) break;
      const lx = Math.round(cx - 0.6 * r * 0.7), ly = Math.round(cy - 0.8 * r * 0.7);
      if (rime && ty < 0.2 && K.hash2(s * 0.3 + seed, 4.2) > 0.45) p.over(lx, ly, RIME, 3);
      if (s >= nextG) {
        nextG = s + 9 + ((seed * 3 + Math.floor(s)) % 5);
        p.over(lx, ly, WET, 3);
      }
    }
  }

  /**
   * The cold light the ice throws back: the skin's shadowed silhouette edge (the lower right, away
   * from the light) turns a pale blue-lavender, one texel deep — the creature sits in a bright
   * world.
   * @param {any} p
   */
  function bounce(p) {
    const hits = [];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const m = p.get(x, y);
        if (m !== SKIN && m !== MOTTLE) continue;
        if (p.getShade(x, y) > 1) continue;
        const open = !p.get(x + 1, y) || !p.get(x, y + 1) || !p.get(x + 1, y + 1);
        if (open && y < p.h - 3) hits.push(x, y);
      }
    }
    for (let k = 0; k < hits.length; k += 2) p.set(hits[k], hits[k + 1], BOUNCE, 2);
  }

  return { spline, arm, bounce, SKIN, MOTTLE, UNDER, SUCK, RIME, WET };
}

/**
 * The skin ramps of the head and its arms (40 material ramps): violet-navy skin and mottle, the pale
 * lilac underside and suckers, the barnacles, the rime, the pale glowing eye, the beak, the freed
 * eye's warm amber, the wet glints.
 * @param {MonsterKit} K
 */
export function gulletRamps(K) {
  const { M } = K;
  return K.makeRamps({
    [M.FUR]: K.ramp5(['#0c091c', '#191433', '#27214b', '#383166', '#504786']),
    [M.FUR2]: K.ramp5(['#070515', '#110e26', '#1c1838', '#29234e', '#3a3368']),
    [M.FUR3]: K.ramp5(['#3a2c4c', '#64527a', '#9481a8', '#c0aed0', '#e6dcee']),
    [M.NOSE]: K.ramp5(['#46365a', '#7a6690', '#b2a0c6', '#dccee6', '#f6eefa']),
    [M.BONE]: K.ramp5(['#36343c', '#605c5a', '#908878', '#bdb5a0', '#e6e0cc']),
    [M.WHITE]: K.ramp5(['#4c6c8a', '#84a6c0', '#b6d2e4', '#def0f8', '#ffffff']),
    [M.GLOW]: K.glowRamp(['#2a5868', '#5a9cb0', '#9ed8e8', '#d6f4fa', '#ffffff']),
    [M.EYE]: K.ramp5(['#04030a', '#0c0a18', '#1a1628', '#2a243c', '#3c3450']),
    [M.BEAK]: K.ramp5(['#0c080c', '#1c141a', '#30242c', '#4a3a44', '#6a5862']),
    [M.GEM]: K.ramp5(['#3a3a14', '#6a6a22', '#a8a440', '#dcd474', '#fbf4b6']),
    [M.GEL]: K.ramp5(['#5c64a6', '#7c86c2', '#9ea8dc', '#c2ccf2', '#e8eeff']),
    [M.COMB]: K.ramp5(['#262c4a', '#36406a', '#4e5c88', '#6c7eaa', '#94a6cc']),
  }, M.FUR);
}

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function gullet(K) {
  const { M } = K;
  const A = armKit(K);
  const { SKIN, MOTTLE, UNDER, RIME, WET } = A;
  const BARN = M.BONE, EYEW = M.GLOW, PUPIL = M.EYE, BEAK = M.BEAK, CALM = M.GEM;

  /**
   * The body as one relief: the height field of a few ellipsoids (mantle, crown, face, base — the
   * highest wins, so they meet in creases), each texel lit by the field's own normal (round, from
   * the upper left: the terminator curves like on a living thing); then the blotches, a few pale
   * scars and the wet sheen of the lit crown.
   * @param {any} p @param {number[][]} shapes [cx, cy, rx, ry, depth]
   * @param {number} seed
   */
  function relief(p, shapes, seed) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [cx, cy, rx, ry] of shapes) {
      x0 = Math.min(x0, Math.floor(cx - rx - 2)); x1 = Math.max(x1, Math.ceil(cx + rx + 2));
      y0 = Math.min(y0, Math.floor(cy - ry - 2)); y1 = Math.max(y1, Math.ceil(cy + ry + 2));
    }
    /** @type {(x: number, y: number) => number} */
    const height = (x, y) => {
      let h = 0;
      for (const [cx, cy, rx, ry, dz] of shapes) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1) h = Math.max(h, dz * Math.sqrt(1 - d2));
      }
      return h;
    };
    p.begin(null);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const h = height(x, y);
        if (h <= 0) continue;
        const gx = (height(x + 1, y) - height(x - 1, y)) / 2, gy = (height(x, y + 1) - height(x, y - 1)) / 2;
        const l = Math.hypot(gx, gy, 1);
        const d = (-gx * LX - gy * LY + LZ) / l;
        const sh = d > 0.93 ? 4 : d > 0.66 ? 3 : d > 0.26 ? 2 : d > -0.12 ? 1 : 0;
        p.set(x, y, SKIN, sh);
      }
    }
    p.end();
    // the blotches: soft dark spots of every size (fixed), and a few pale scars
    const [mx, my, mrx, mry] = shapes[0];
    for (let k = 0; k < 26; k++) {
      const sx = mx + (K.hash2(k * 1.37 + seed, 2.1) - 0.5) * mrx * 1.9;
      const sy = my + (K.hash2(k * 2.11 + seed, 5.3) - 0.6) * mry * 2.3;
      const sr = 0.7 + K.hash2(k * 0.73, seed + 9) * 2;
      for (let y = Math.floor(sy - sr); y <= Math.ceil(sy + sr); y++) {
        for (let x = Math.floor(sx - sr); x <= Math.ceil(sx + sr); x++) {
          if (Math.hypot(x + 0.5 - sx, y + 0.5 - sy) > sr || p.get(x, y) !== SKIN) continue;
          p.set(x, y, MOTTLE, Math.max(0, p.getShade(x, y) - (k % 4 === 0 ? 1 : 0)));
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const sx = mx - mrx * 0.45 + k * mrx * 0.42, sy = my - mry * 0.1 + k * 4;
      for (let j = 0; j < 6; j++) p.over(Math.round(sx + j), Math.round(sy + j * 0.55 * (k % 2 ? 1 : -1)), UNDER, 1);
    }
    for (let k = 0; k < 9; k++) {
      const gx = Math.round(mx - mrx * 0.6 + K.hash2(k, seed) * mrx), gy = Math.round(my - mry * 1.1 + K.hash2(seed, k) * mry * 1.1);
      if (p.get(gx, gy) === SKIN && p.getShade(gx, gy) >= 3) p.set(gx, gy, WET, 3);
    }
  }

  /**
   * A crust of barnacles: small shell cones packed together, plates lit on their upper left, a dark
   * slit at each top — a rough patch, not a set of rings.
   * @param {any} p @param {number} cx @param {number} cy @param {number} n @param {number} seed
   */
  function barnacles(p, cx, cy, n, seed) {
    for (let k = 0; k < n; k++) {
      const bx = Math.round(cx + (K.hash2(k * 3.1 + seed, 1.7) - 0.5) * 9);
      const by = Math.round(cy + (K.hash2(k * 1.9 + seed, 8.3) - 0.5) * 6);
      if (p.get(bx, by) !== SKIN && p.get(bx, by) !== MOTTLE) continue;
      const w = 2 + (k % 3 === 0 ? 1 : 0);
      p.begin('below', 0);
      for (let y = 0; y <= w; y++) {
        for (let x = -w + Math.floor(y / 2); x <= w - Math.floor(y / 2); x++) {
          const yy = by + 1 - y;
          const lit = x < 0 ? 2 : 1;
          p.set(bx + x, yy, BARN, y === w ? 2 : x === -w + Math.floor(y / 2) ? 3 : lit);
        }
      }
      p.set(bx, by + 1 - w, PUPIL, 1);
      p.end();
    }
  }

  /**
   * The rime on the crown: the topmost texels of every column turn to frost, with a few drips.
   * @param {any} p @param {number} xa @param {number} xb @param {number} depth @param {number} seed
   */
  function rime(p, xa, xb, depth, seed) {
    for (let x = xa; x <= xb; x++) {
      let top = -1;
      for (let y = 0; y < p.h; y++) {
        const m = p.get(x, y);
        if (m === SKIN || m === MOTTLE || m === WET || m === BARN) { top = y; break; }
        if (m) break;
      }
      if (top < 0) continue;
      const dd = depth + Math.round(K.hash2(x * 0.7 + seed, 1.3) * 2);
      for (let k = 0; k < dd; k++) {
        const m = p.get(x, top + k);
        if (m !== SKIN && m !== MOTTLE && m !== WET && m !== BARN) break;
        p.set(x, top + k, RIME, k === 0 ? 4 : k === 1 ? 3 : 2);
      }
      if (K.hash2(x * 1.9 + seed, 7.7) > 0.84) for (let k = dd; k < dd + 3; k++) p.over(x, top + k, RIME, 2);
    }
  }

  /**
   * Slabs of sea ice resting on the crown (the burst): pale wedges with a lit face and a dark edge.
   * @param {any} p @param {number} cx @param {number} top
   */
  function iceSlabs(p, cx, top) {
    const slabs = [[-13, 4, 8, 3, -0.3], [-3, -1, 10, 3, 0.15], [9, 3, 7, 3, 0.5], [-9, 9, 5, 2, -0.6], [4, 7, 4, 2, 0.2]];
    p.begin('all', 1);
    for (const [ox, oy, w, h, k] of slabs) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = Math.round(cx + ox + x), py = Math.round(top + oy + y + x * k);
          p.set(px, py, RIME, y === 0 ? 4 : y === h - 1 ? 1 : 3);
        }
      }
    }
    p.end();
  }

  /**
   * An eye: a pale glowing orb under a heavy lid that slopes toward the snout (`slope` px per px),
   * the long dark bar of a pupil, a glint; `kind` its state.
   * @param {any} p @param {number} ex @param {number} ey @param {number} rx @param {number} ry
   * @param {string} kind @param {number} slope
   */
  function eye(p, ex, ey, rx, ry, kind, slope) {
    // the socket: a fold of darker skin under it, a lit fold over it (the brow does the rest)
    p.begin(null);
    for (let x = Math.floor(ex - rx - 1); x <= Math.ceil(ex + rx + 1); x++) {
      const t = (x + 0.5 - ex) / (rx + 1);
      if (Math.abs(t) > 1) continue;
      const lo = Math.round(ey + (ry + 1) * Math.sqrt(1 - t * t));
      p.set(x, lo, MOTTLE, 0);
      p.set(x, lo + 1, MOTTLE, 1);
    }
    p.end();
    if (kind === 'shut') {
      for (let x = Math.round(ex - rx); x <= Math.round(ex + rx); x++) {
        const y = Math.round(ey + (x - ex) * slope * 0.5 + 0.6 * Math.cos(((x - ex) / rx) * 1.4));
        p.set(x, y, PUPIL, 0);
        p.set(x, y - 1, SKIN, 2);
        p.set(x, y + 1, MOTTLE, 1);
      }
      return;
    }
    const lid = kind === 'narrow' ? 0.62 : kind === 'calm' ? 0.55 : kind === 'wide' ? 0.05 : 0.3;
    const open = kind === 'wide' ? 1.12 : 1;
    const mat = kind === 'calm' ? CALM : EYEW;
    const RY = ry * open;
    for (let y = Math.floor(ey - RY - 1); y <= Math.ceil(ey + RY + 1); y++) {
      for (let x = Math.floor(ex - rx - 1); x <= Math.ceil(ex + rx + 1); x++) {
        const dx = (x + 0.5 - ex) / rx, dy = (y + 0.5 - ey) / RY;
        if (dx * dx + dy * dy > 1) continue;
        // the lid's edge: lower toward the snout, a dark rim along it
        const edge = -1 + lid * 2 + (x + 0.5 - ex) * slope / RY;
        if (dy < edge) {
          p.set(x, y, dy > edge - 0.22 ? PUPIL : SKIN, dy > edge - 0.22 ? 1 : 2);
          continue;
        }
        const r = Math.hypot(dx, dy);
        // (the lid's shadow on the orb just under its edge: the eye sits deep)
        const shaded = dy < edge + 0.32;
        p.set(x, y, mat, r > 0.84 ? 1 : shaded ? 2 : dx + dy < -0.55 ? 4 : r > 0.6 ? 2 : 3);
      }
    }
    if (kind === 'calm') {
      // a soft round pupil
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) p.set(Math.round(ex) + ox - 1, Math.round(ey) + oy, PUPIL, 2);
    } else {
      // the bar of the pupil, longer when it stares
      const half = Math.round(rx * (kind === 'wide' ? 0.72 : kind === 'narrow' ? 0.52 : 0.62));
      const py = Math.round(ey + 0.3 + lid * RY * 0.5);
      // the iris darkening round the slot first, then the slot itself
      for (let x = -half - 1; x <= half + 1; x++) {
        for (const oy of [-1, 2]) if (p.get(Math.round(ex + x), py + oy) === mat) p.set(Math.round(ex + x), py + oy, mat, 1);
      }
      for (let x = -half; x <= half; x++) {
        p.set(Math.round(ex + x), py, PUPIL, 0);
        if (Math.abs(x) < half && kind !== 'narrow') p.set(Math.round(ex + x), py + 1, PUPIL, 1);
      }
      // the glint, high on the orb
      p.set(Math.round(ex - rx * 0.4), Math.round(ey - RY * 0.15 + lid * RY), mat, 4);
    }
  }

  /**
   * The siphon on the body's flank: a short ribbed tube; its mouth glows with the gathering ink.
   * @param {any} p @param {number} sx @param {number} sy @param {number} dir ±1 (where it points) @param {number} glow
   */
  function siphon(p, sx, sy, dir, glow) {
    p.begin('all', 0);
    for (let k = 0; k < 7; k++) {
      const x = Math.round(sx + dir * k * 0.9), y = Math.round(sy + k * 0.45);
      for (let j = -2; j <= 1; j++) p.set(x, y + j, k % 2 ? UNDER : SKIN, j < 0 ? 3 : j === 0 ? 2 : 1);
    }
    const mx = Math.round(sx + dir * 6.5), my = Math.round(sy + 2.8);
    if (glow > 0) {
      p.set(mx, my - 1, EYEW, Math.min(4, glow));
      p.set(mx, my, EYEW, Math.max(1, glow - 1));
      if (glow >= 3) { p.set(mx + dir, my, EYEW, glow - 1); p.set(mx + dir, my - 1, EYEW, glow); }
    } else {
      p.set(mx, my, PUPIL, 0);
      p.set(mx, my - 1, PUPIL, 1);
    }
    p.end();
  }

  /**
   * The arm roots at the waterline: thick curls spreading out over the water and into it.
   * @param {any} p @param {'side'|'down'|'up'} view @param {string} state @param {number} G
   * @param {number} bob @param {boolean} far behind the mantle (true) or in front
   */
  function roots(p, view, state, G, bob, far) {
    /** @type {{ pts: number[][], r0: number, r1: number, side: number, tone: number }[]} */
    let arms = [];
    const b = bob;
    const dorsal = view === 'up';
    if (state === 'up') {
      // thrown up round the head (the roar, the burst)
      if (view === 'side') {
        arms = far
          ? [{ pts: [[62, G], [70, G - 14], [78, G - 34], [82, G - 56], [76, G - 68], [69, G - 64]], r0: 7, r1: 1.2, side: -1, tone: -1 },
            { pts: [[54, G], [52, G - 18], [55, G - 42], [63, G - 64], [70, G - 74]], r0: 6, r1: 1.2, side: 1, tone: -1 }]
          : [{ pts: [[38, G], [26, G - 12], [17, G - 32], [14, G - 54], [20, G - 66], [28, G - 62]], r0: 8, r1: 1.4, side: 1, tone: 0 },
            { pts: [[48, G], [40, G - 8], [31, G - 22], [31, G - 38], [37, G - 44]], r0: 6.5, r1: 1.2, side: 1, tone: 0 }];
      } else {
        arms = far
          ? [{ pts: [[34, G], [22, G - 16], [12, G - 40], [10, G - 62], [17, G - 72]], r0: 7, r1: 1.2, side: dorsal ? 0 : 1, tone: -1 },
            { pts: [[62, G], [74, G - 16], [84, G - 40], [86, G - 62], [79, G - 72]], r0: 7, r1: 1.2, side: dorsal ? 0 : -1, tone: -1 }]
          : [{ pts: [[40, G], [31, G - 10], [22, G - 25], [20, G - 42], [27, G - 49]], r0: 7, r1: 1.2, side: dorsal ? 0 : 1, tone: 0 },
            { pts: [[56, G], [65, G - 10], [74, G - 25], [76, G - 42], [69, G - 49]], r0: 7, r1: 1.2, side: dorsal ? 0 : -1, tone: 0 }];
      }
    } else if (state === 'in') {
      // drawn in under the swelling mantle
      arms = view === 'side'
        ? (far ? [{ pts: [[60, G], [68, G - 4], [74, G - 5], [76, G - 9]], r0: 6.5, r1: 1.2, side: -1, tone: -1 }]
          : [{ pts: [[40, G], [33, G - 3], [29, G - 8], [31, G - 11]], r0: 7, r1: 1.2, side: 1, tone: 0 }])
        : (far ? [{ pts: [[36, G], [27, G - 3], [23, G - 8]], r0: 6.5, r1: 1.2, side: dorsal ? 0 : 1, tone: -1 }, { pts: [[60, G], [69, G - 3], [73, G - 8]], r0: 6.5, r1: 1.2, side: dorsal ? 0 : -1, tone: -1 }]
          : [{ pts: [[46, G], [43, G - 5], [45, G - 10]], r0: 6, r1: 1.2, side: dorsal ? 0 : 1, tone: 0 }]);
    } else {
      // at rest: thick curls spreading out over the water ('limp': flat, the curls slack)
      const s = state === 'limp' ? 1 : 0;
      if (view === 'side') {
        arms = far
          ? [{ pts: [[62, G], [72, G - 3 + b], [83, G - 2], [89, G - 7 + s * 5], [86, G - 12 + s * 7]], r0: 7, r1: 1.2, side: -1, tone: -1 },
            { pts: [[55, G], [60, G - 7], [68, G - 9 + s * 3], [72, G - 14 + s * 7]], r0: 5.5, r1: 1.2, side: -1, tone: -1 }]
          : [{ pts: [[40, G], [30, G - 2 + b], [18, G - 1], [9, G - 6 + s * 5], [11, G - 12 + s * 8], [16, G - 11 + s * 7]], r0: 8, r1: 1.4, side: 1, tone: 0 },
            { pts: [[48, G], [45, G - 5], [38, G - 8 + s * 2], [34, G - 7 + s * 3]], r0: 6, r1: 1.2, side: 1, tone: 0 }];
      } else {
        arms = far
          ? [{ pts: [[36, G], [23, G - 3 + b], [11, G - 2], [5, G - 8 + s * 6], [9, G - 13 + s * 8]], r0: 7, r1: 1.2, side: dorsal ? 0 : 1, tone: -1 },
            { pts: [[60, G], [73, G - 3 + b], [85, G - 2], [91, G - 8 + s * 6], [87, G - 13 + s * 8]], r0: 7, r1: 1.2, side: dorsal ? 0 : -1, tone: -1 }]
          : [{ pts: [[42, G], [33, G - 2], [24, G - 1], [19, G - 7 + s * 5], [23, G - 10 + s * 6]], r0: 7.5, r1: 1.2, side: dorsal ? 0 : 1, tone: 0 },
            { pts: [[54, G], [63, G - 2], [72, G - 1], [77, G - 7 + s * 5], [73, G - 10 + s * 6]], r0: 7.5, r1: 1.2, side: dorsal ? 0 : -1, tone: 0 },
            ...(dorsal ? [] : [{ pts: [[48, G], [47, G - 6], [50, G - 10 + s * 3], [54, G - 9 + s * 3]], r0: 5.5, r1: 1.2, side: -1, tone: 0 }])];
      }
    }
    let seed = far ? 11 : 3;
    for (const a of arms) {
      p.begin('all', 0);
      A.arm(p, a.pts, { r0: a.r0, r1: a.r1, side: a.side, tone: a.tone, seed: seed++, rime: state === 'up', under: 0.25 });
      p.end();
    }
  }

  /**
   * A heavy brow fold over an eye, sloping (the scowl).
   * @param {any} p @param {number} x0 @param {number} x1 @param {number} y @param {number} slope
   */
  function brow(p, x0, x1, y, slope) {
    p.begin(null);
    for (let x = x0; x <= x1; x++) {
      const yy = Math.round(y + (x - (x0 + x1) / 2) * slope - 1.8 * Math.sin(((x - x0) / Math.max(1, x1 - x0)) * Math.PI));
      p.set(x, yy - 1, SKIN, 3);
      p.set(x, yy, MOTTLE, 1);
      p.set(x, yy + 1, MOTTLE, 0);
    }
    p.end();
  }

  /**
   * One frame.
   * @param {any} p @param {'down'|'up'|'side'} view @param {HeadPose} P @param {number} G
   */
  function draw(p, view, P, G) {
    const bob = P.bob ?? 0;
    const sw = P.swell ?? 0;
    const arms = P.arms ?? 'rest';
    const lean = P.lean ?? 0;
    const sway = P.sway ?? 0;
    const eyeKind = P.eye ?? 'open';
    roots(p, view, arms, G, bob, true);
    if (view === 'side') {
      relief(p, [[55 + sway * 0.5, 42 + bob, 21 + sw, 23 + sw, 20], [63 + lean, 22 + bob, 14 + sw * 0.6, 13 + sw * 0.5, 13],
        [39 + sway * 0.3, 67 + bob, 17, 13, 14], [50, 83 + bob, 21, 11, 12]], 5);
      siphon(p, 62, 74 + bob, 1, P.siphon ?? 0);
      brow(p, 23, 46, 58 + bob, -0.12);
      eye(p, 34 + sway * 0.3, 66 + bob, 8.5, 6.8, eyeKind, -0.1);
      if (P.beak) {
        p.begin('all', 0);
        K.fillPoly(p, [[24, 76 + bob], [34, 74 + bob], [37, 79 + bob], [30, 83 + bob]], BEAK, (x, y) => (y < 77 + bob ? 3 : 1));
        K.fillPoly(p, [[25, 84 + bob], [35, 81 + bob], [33, 87 + bob]], BEAK, 2);
        p.set(31, 80 + bob, PUPIL, 0);
        p.set(32, 81 + bob, PUPIL, 0);
        p.end();
      }
      barnacles(p, 62 + lean, 23 + bob, 6, 3);
      barnacles(p, 71 + lean * 0.5, 41 + bob, 5, 7);
      barnacles(p, 60, 52 + bob, 4, 11);
      rime(p, 36, 82, 2, 3);
      if (P.ice) iceSlabs(p, 60 + lean, 12 + bob);
    } else if (view === 'down') {
      relief(p, [[48 + sway * 0.4, 42 + bob, 23 + sw, 24 + sw, 21], [48 + lean * 0.3, 21 + bob, 15 + sw * 0.6, 12 + sw * 0.5, 13],
        [48, 67 + bob, 24, 13, 15], [48, 82 + bob, 22, 10, 12]], 9);
      siphon(p, 68, 74 + bob, 1, Math.max(0, (P.siphon ?? 0) - 1));
      brow(p, 22, 39, 59 + bob, 0.16);
      brow(p, 57, 74, 59 + bob, -0.16);
      eye(p, 31 + sway * 0.3, 66 + bob, 6.5, 5.4, eyeKind, 0.14);
      eye(p, 65 + sway * 0.3, 66 + bob, 6.5, 5.4, eyeKind, -0.14);
      // the cleft over the beak
      p.begin(null);
      for (let y = 73; y <= 79; y++) p.set(48, y + bob, MOTTLE, 0);
      p.end();
      if (P.beak) {
        p.begin('all', 0);
        K.fillPoly(p, [[41, 72 + bob], [55, 72 + bob], [53, 82 + bob], [43, 82 + bob]], BEAK, (x, y) => (y < 76 + bob ? 3 : 2));
        for (let x = 44; x <= 52; x++) p.set(x, 77 + bob, PUPIL, 0);
        p.set(48, 78 + bob, PUPIL, 0);
        p.end();
      }
      barnacles(p, 38, 21 + bob, 6, 13);
      barnacles(p, 60, 28 + bob, 5, 17);
      barnacles(p, 30, 41 + bob, 4, 19);
      barnacles(p, 66, 46 + bob, 4, 23);
      rime(p, 26, 72, 2, 9);
      if (P.ice) iceSlabs(p, 48, 12 + bob);
    } else {
      relief(p, [[48 + sway * 0.4, 44 + bob, 24 + sw, 24 + sw, 21], [48 - lean * 0.3, 23 + bob, 16 + sw * 0.6, 13 + sw * 0.5, 13],
        [48, 74 + bob, 24, 14, 14]], 13);
      barnacles(p, 38, 23 + bob, 6, 29);
      barnacles(p, 56, 20 + bob, 6, 31);
      barnacles(p, 46, 38 + bob, 5, 37);
      barnacles(p, 64, 46 + bob, 5, 41);
      barnacles(p, 32, 52 + bob, 4, 43);
      rime(p, 24, 72, 3, 13);
      if (P.ice) iceSlabs(p, 48, 14 + bob);
    }
    roots(p, view, arms, G, bob, false);
    A.bounce(p);
  }

  return {
    fw: 96, fh: 96, columns: [...K.COMMON, ...EXTRA], aliases: { rise: 'burst', ink: 'windup', spray: 'attack', calm: 'dead', kneel: 'daze' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([3.4, 1.4]) },
    idle: { poses: ['idle0', 'idle1'], fps: 1.6 },
    draw(p, view, key, f) {
      draw(p, view, POSES[key] ?? POSES.idle0, f.G);
    },
    ramps: () => gulletRamps(K),
  };
}
