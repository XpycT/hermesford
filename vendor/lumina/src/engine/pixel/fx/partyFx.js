/**
 * The companions' FX frames (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.8;
 * docs/specs/PARTY.md §12.5), painted into the combat FX atlas (../FxSprites.js: the module shape,
 * the pen and the kit; grey levels the instance colour tints, binary alpha). Owner: the party
 * package. Every name starts with `party`.
 *
 * Ground glyphs lie flat under a spell (drawn at 16 texels per world unit at their full size, the
 * world's own density): the cleric's sun circle (`partyGlyphHoly`: Judgement, Sanctuary, the
 * raise), the ice mage's snowflake sigil (`partyGlyphFrost`: Blizzard, Glacial Tomb), the shield
 * sigil of a ward (`partyGlyphWard`; `partyWardRing` the small ring under each warded member).
 * `partyRing` is an expanding shockwave (Judgement's last pillar, the war cry, the slam, the Tomb),
 * `partyCrack` the ground the slam breaks. Upright: the light pillar (`partyPillar`, striking down
 * over its four frames), a burst of rays (`partySunburst`, also laid flat at a pillar's foot), the
 * Holy Bolt (`partyHolyOrb`), the stone spike of the slam (`partyRockSpike`: rising, standing,
 * cracking, crumbling) and the ward dome (`partyDome`, a hemisphere of hex light). `partySwirl` is
 * Blizzard's vortex (flat, turned by the quad). Closed-form shapes and fixed layouts (no RNG).
 *
 * The ice mage's look (src/game/party/IceSpellFx.js; the Tomb's spikes are 3D crystals there,
 * engine/fx/IceCrystals.js, its frost on the ground engine/fx/GroundFrost.js) draws `partyIce*`
 * frames, two layers where the hue must shift inside one effect (a quad has one tint): a body
 * (shaded faces, tinted deep blue-violet under the FX halo's threshold) and its lit layer drawn
 * over it (lit facets, upper-left edges, tips, glints; tinted cyan above the threshold, so the
 * halo hugs those edges) — the lance
 * (`partyIceLance` / `…Lit`, pointing +U), the shards (`partyIceShard` / `…Lit`: kite, sliver,
 * wedge, chunk) and the frozen foe's shell (`partyIceShell` / `…Lit`: an angular crystal block whose
 * faces are open diagonal streaks, so the body shows through); single layers: a snowflake
 * (`partyIceFlake`), a bokeh disc (`partyIceBokeh`), low mist banks (`partyIceMist`) and a plain
 * disc (`partyIceGlow`) — the last two drawn with FxQuads `soft`. ≈ 12 k texels more.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  partyGlyphHoly: Object.freeze({ w: 128, h: 128, n: 1, fps: 0 }),
  partyGlyphFrost: Object.freeze({ w: 128, h: 128, n: 1, fps: 0 }),
  partyGlyphWard: Object.freeze({ w: 96, h: 96, n: 1, fps: 0 }),
  partyRing: Object.freeze({ w: 96, h: 96, n: 2, fps: 0 }),
  partyCrack: Object.freeze({ w: 96, h: 96, n: 1, fps: 0 }),
  partySwirl: Object.freeze({ w: 80, h: 80, n: 2, fps: 6 }),
  partyPillar: Object.freeze({ w: 24, h: 96, n: 4, fps: 0 }),
  partyDome: Object.freeze({ w: 64, h: 40, n: 2, fps: 8 }),
  partySunburst: Object.freeze({ w: 32, h: 32, n: 4, fps: 0 }),
  partyRockSpike: Object.freeze({ w: 16, h: 24, n: 4, fps: 0 }),
  partyWardRing: Object.freeze({ w: 24, h: 24, n: 1, fps: 0 }),
  partyHolyOrb: Object.freeze({ w: 16, h: 16, n: 2, fps: 12 }),
  // the ice mage (src/game/party/IceSpellFx.js): two layers where the hue must shift — a body
  // (shaded faces, tinted deep blue-violet below the halo's threshold) and its lit facets, tips and
  // glints (tinted cyan above it: the halo hugs the edges, the body does not glow); `late`: packed
  // after the atlas's older frames (none of them moves)
  partyIceLance: Object.freeze({ w: 24, h: 8, n: 2, fps: 10, late: true }),
  partyIceLanceLit: Object.freeze({ w: 24, h: 8, n: 2, fps: 10, late: true }),
  partyIceShard: Object.freeze({ w: 10, h: 10, n: 4, fps: 0, late: true }),
  partyIceShardLit: Object.freeze({ w: 10, h: 10, n: 4, fps: 0, late: true }),
  partyIceFlake: Object.freeze({ w: 9, h: 9, n: 2, fps: 0, late: true }),
  partyIceMist: Object.freeze({ w: 40, h: 16, n: 3, fps: 0, late: true }),
  partyIceGlow: Object.freeze({ w: 56, h: 56, n: 1, fps: 0, late: true }),
  partyIceBokeh: Object.freeze({ w: 10, h: 10, n: 1, fps: 0, late: true }),
  partyIceShell: Object.freeze({ w: 30, h: 38, n: 2, fps: 0, late: true }),
  partyIceShellLit: Object.freeze({ w: 30, h: 38, n: 2, fps: 0, late: true }),
});

/**
 * The cells of the ice mage's retired frames (her old frost floor, ice spike and lance, before
 * IceSpellFx.js), kept empty so no other frame of the atlas moves (FxSprites `RESERVED`).
 * @type {Readonly<Record<string, { w: number, h: number, n: number }>>}
 */
export const RESERVED = Object.freeze({
  partyFrostFloor: Object.freeze({ w: 64, h: 64, n: 1 }),
  partyIceSpike: Object.freeze({ w: 16, h: 32, n: 3 }),
  partyFrostLance: Object.freeze({ w: 24, h: 8, n: 2 }),
});

const TAU = Math.PI * 2;

/**
 * A ring of width `w` at radius `r` round (cx, cy) (pixel centres), keeping the brighter value;
 * `keep(a)` (angle 0 = right, counter-clockwise up) may leave gaps.
 * @param {FxPen} pen @param {number} cx @param {number} cy @param {number} r @param {number} w @param {number} v
 * @param {(a: number) => boolean} [keep]
 */
function ring(pen, cx, cy, r, w, v, keep) {
  const x0 = Math.max(0, Math.floor(cx - r - w)), x1 = Math.min(pen.w - 1, Math.ceil(cx + r + w));
  const y0 = Math.max(0, Math.floor(cy - r - w)), y1 = Math.min(pen.h - 1, Math.ceil(cy + r + w));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (Math.abs(Math.hypot(dx, dy) - r) > w / 2) continue;
      if (keep) {
        let a = Math.atan2(-dy, dx);
        if (a < 0) a += TAU;
        if (!keep(a)) continue;
      }
      pen.max(x, y, v);
    }
  }
}

/**
 * A line of width `w` from (x0, y0) to (x1, y1) (pixel centres), keeping the brighter value.
 * @param {FxPen} pen @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} w @param {number} v
 */
function line(pen, x0, y0, x1, y1, w, v) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w)), maxX = Math.min(pen.w - 1, Math.ceil(Math.max(x0, x1) + w));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w)), maxY = Math.min(pen.h - 1, Math.ceil(Math.max(y0, y1) + w));
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-9;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      if (Math.hypot(px - dx * t, py - dy * t) <= w / 2) pen.max(x, y, v);
    }
  }
}

/** A point at radius r, angle a (0 = right, counter-clockwise up) round (cx, cy). */
const at = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy - Math.sin(a) * r];

/**
 * A radial stroke from radius r0 to r1 at angle a.
 * @param {FxPen} pen @param {number} c @param {number} r0 @param {number} r1 @param {number} a @param {number} w @param {number} v
 */
function ray(pen, c, r0, r1, a, w, v) {
  const [x0, y0] = at(c, c, r0, a);
  const [x1, y1] = at(c, c, r1, a);
  line(pen, x0, y0, x1, y1, w, v);
}

/** A closed polygon outline through `pts`. @param {FxPen} pen @param {number[][]} pts @param {number} w @param {number} v */
function poly(pen, pts, w, v) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    line(pen, a[0], a[1], b[0], b[1], w, v);
  }
}

/** A filled convex-or-not polygon (pixel-centre test), value by `fn(x, y)` (null: skip). */
function fill(pen, pts, fn) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(pen.h - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(pen.w - 1, Math.ceil(x1)); x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) continue;
      const v = fn(x, y);
      if (v != null) pen.set(x, y, v);
    }
  }
}

/** A fixed pseudo-random in [0, 1) of three integers (layouts, no RNG state). */
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 10007) / 10007;
}

// ---------------------------------------------------------------------------
// Ground glyphs
// ---------------------------------------------------------------------------

/** The cleric's sun circle: two outer rings with sixteen runes between, an octagram, a sun of rays, a cross at the heart. */
function glyphHoly(pen, K) {
  const c = 64;
  ring(pen, c, c, 62, 1.7, K.W);
  ring(pen, c, c, 54.5, 1.2, K.L);
  // sixteen runes in the band, three kinds in turn
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU + TAU / 32;
    const ux = Math.cos(a), uy = -Math.sin(a); // radial
    const vx = -uy, vy = ux; // tangential
    const P = (u, v) => [c + ux * (58.2 + u) + vx * v, c + uy * (58.2 + u) + vy * v];
    const kind = k % 3;
    if (kind === 0) {
      const [a0, a1] = [P(-2.2, 0), P(2.2, 0)];
      line(pen, a0[0], a0[1], a1[0], a1[1], 1.1, K.W);
      const [b0, b1] = [P(0.4, -1.8), P(0.4, 1.8)];
      line(pen, b0[0], b0[1], b1[0], b1[1], 1.0, K.L);
    } else if (kind === 1) {
      poly(pen, [P(-2.2, 0), P(0, 1.8), P(2.2, 0), P(0, -1.8)], 1.0, K.L);
    } else {
      const [d0, d1] = [P(-1.6, -1.1), P(1.6, -1.1)];
      line(pen, d0[0], d0[1], d1[0], d1[1], 1.0, K.MID);
      const [e0, e1] = [P(-1.6, 1.1), P(1.6, 1.1)];
      line(pen, e0[0], e0[1], e1[0], e1[1], 1.0, K.MID);
    }
  }
  ring(pen, c, c, 44, 1.2, K.L);
  // the octagram: two squares inscribed in the middle ring
  for (const off of [0, Math.PI / 4]) {
    poly(pen, [0, 1, 2, 3].map((i) => at(c, c, 44, off + (i * Math.PI) / 2)), 1.0, K.MID);
  }
  // the sun: long and short rays between the heart's ring and the octagram's
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    ray(pen, c, 24, k % 2 ? 33 : 40, a, k % 2 ? 1.0 : 1.3, k % 2 ? K.MID : K.L);
  }
  ring(pen, c, c, 22, 1.5, K.W);
  ring(pen, c, c, 12, 1.2, K.L);
  for (let k = 0; k < 4; k++) ray(pen, c, 3.5, 10, (k * Math.PI) / 2, 1.3, K.W);
  ring(pen, c, c, 3, 1.2, K.W);
}

/** The ice mage's sigil: a snowflake of six branched arms in a hexagon, a dotted ring, a bright outer ring. */
function glyphFrost(pen, K) {
  const c = 64;
  ring(pen, c, c, 62, 1.5, K.W);
  ring(pen, c, c, 58, 1.2, K.MID, (a) => (a / TAU) * 72 % 1 < 0.42);
  poly(pen, [0, 1, 2, 3, 4, 5].map((i) => at(c, c, 54, Math.PI / 6 + (i * Math.PI) / 3)), 1.2, K.L);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    ray(pen, c, 8, 50, a, 1.4, K.W);
    // the branches, swept outward at 60° to the arm
    for (const [r, len, v] of [[20, 10, K.L], [33, 8, K.L], [43, 5, K.MID]]) {
      const [bx, by] = at(c, c, r, a);
      for (const s of [-1, 1]) {
        const b = a + s * (Math.PI / 3);
        line(pen, bx, by, bx + Math.cos(b) * len, by - Math.sin(b) * len, 1.1, v);
      }
    }
    // a diamond at the tip
    const tip = (r, d) => at(c, c, r, a + d);
    poly(pen, [tip(53, 0), tip(50, 0.05), tip(47, 0), tip(50, -0.05)], 1.0, K.W);
    // the small arms between
    ray(pen, c, 14, 27, a + Math.PI / 6, 1.0, K.MID);
  }
  poly(pen, [0, 1, 2, 3, 4, 5].map((i) => at(c, c, 11, (i * Math.PI) / 3)), 1.2, K.L);
  ring(pen, c, c, 4, 1.2, K.W);
}

/** A ward's sigil: a rim of shield-wall segments, six kite shields round a ring, a kite at the heart. */
function glyphWard(pen, K) {
  const c = 48;
  ring(pen, c, c, 46, 1.6, K.W);
  ring(pen, c, c, 39.5, 1.1, K.L);
  for (let k = 0; k < 24; k++) ray(pen, c, 39.5, 46, (k / 24) * TAU, 1.0, K.MID);
  ring(pen, c, c, 42.8, 1.0, K.D, (a) => (a / TAU) * 48 % 1 < 0.5);
  // six kite shields pointing outward
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + TAU / 12;
    const ux = Math.cos(a), uy = -Math.sin(a), vx = -uy, vy = ux;
    const P = (u, v) => [c + ux * (28 + u) + vx * v, c + uy * (28 + u) + vy * v];
    poly(pen, [P(-4.5, -3.2), P(-4.5, 3.2), P(1, 3.4), P(5.5, 0), P(1, -3.4)], 1.1, K.L);
    const [m0, m1] = [P(-3.5, 0), P(4, 0)];
    line(pen, m0[0], m0[1], m1[0], m1[1], 1.0, K.MID);
  }
  ring(pen, c, c, 18, 1.3, K.L);
  // the heart: a kite shield, point down
  poly(pen, [[c - 6, c - 7], [c + 6, c - 7], [c + 6, c - 1], [c, c + 8], [c - 6, c - 1]], 1.4, K.W);
  line(pen, c, c - 6, c, c + 5, 1.0, K.L);
  line(pen, c - 5, c - 3, c + 5, c - 3, 1.0, K.L);
}

/** The small ring under a warded member. */
function wardRing(pen, K) {
  const c = 12;
  ring(pen, c, c, 11, 1.3, K.W);
  ring(pen, c, c, 8.4, 1.0, K.MID, (a) => (a / TAU) * 12 % 1 < 0.6);
  for (let k = 0; k < 4; k++) ray(pen, c, 8.6, 11, (k / 4) * TAU + TAU / 8, 1.1, K.L);
}

/** A shockwave ring: a bright crest with dust streaks inside; then thinner, broken, the streaks gone to dust. */
function shockRing(pen, i, K) {
  const c = 48;
  if (i === 0) {
    ring(pen, c, c, 45.5, 1.6, K.W);
    ring(pen, c, c, 43.7, 1.6, K.L);
    ring(pen, c, c, 42, 1.4, K.MID, (a) => (a / TAU) * 40 % 1 < 0.7);
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * TAU + hash3(k, 1, 7) * 0.08;
      ray(pen, c, 33 + hash3(k, 2, 7) * 4, 41, a, 1.0, k % 3 === 0 ? K.L : K.D);
    }
  } else {
    ring(pen, c, c, 46, 1.3, K.L, (a) => (a / TAU) * 14 % 1 < 0.72);
    ring(pen, c, c, 44.2, 1.1, K.D, (a) => (a / TAU) * 20 % 1 < 0.5);
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * TAU;
      const r = 36 + hash3(k, 3, 9) * 8;
      const [x, y] = at(c, c, r, a);
      pen.max(x, y, K.D);
    }
  }
}

/** Ground broken by the slam: jagged cracks from a crater, branching. */
function crack(pen, K) {
  const c = 48;
  ring(pen, c, c, 6.5, 2.4, K.L);
  ring(pen, c, c, 4, 1.4, K.W);
  for (let k = 0; k < 9; k++) {
    let a = (k / 9) * TAU + hash3(k, 4, 1) * 0.4;
    let x = c + Math.cos(a) * 6.5;
    let y = c - Math.sin(a) * 6.5;
    const len = 28 + hash3(k, 5, 1) * 14;
    let r = 6.5;
    let w = 3.4;
    let step = 0;
    while (r < len) {
      const d = 3 + hash3(k, step, 2) * 2.5;
      a += (hash3(k, step, 3) - 0.5) * 0.7;
      const nx = x + Math.cos(a) * d;
      const ny = y - Math.sin(a) * d;
      line(pen, x, y, nx, ny, w, w > 2.2 ? K.L : K.MID);
      // a branch now and then
      if (step % 3 === 2 && r < len - 8) {
        const b = a + (hash3(k, step, 4) < 0.5 ? -0.8 : 0.8);
        const bl = 4 + hash3(k, step, 5) * 4;
        line(pen, nx, ny, nx + Math.cos(b) * bl, ny - Math.sin(b) * bl, 1.0, K.D);
      }
      x = nx;
      y = ny;
      r = Math.hypot(x - c, y - c);
      w = Math.max(1.4, w - 0.22);
      step++;
    }
  }
}

/** Blizzard's vortex: five spiral streaks of wind and snow, bright at their heads; flakes between. */
function swirl(pen, i, K) {
  const c = 40;
  const turn = i * (TAU / 10);
  for (let k = 0; k < 5; k++) {
    const a0 = (k / 5) * TAU + turn;
    const r0 = 10 + (k % 2) * 4;
    const span = 2.2 + (k % 3) * 0.4;
    for (let s = 0; s <= 1; s += 0.004) {
      const a = a0 + s * span;
      const r = r0 + s * 26;
      const [x, y] = at(c, c, r, a);
      const v = s > 0.82 ? K.W : s > 0.55 ? K.L : s > 0.28 ? K.MID : K.D;
      if (s < 0.28 && Math.floor(s * 80) % 2) continue;
      pen.max(x, y, v);
      if (s > 0.2) pen.max(x + Math.cos(a + Math.PI / 2) * 0.9, y - Math.sin(a + Math.PI / 2) * 0.9, s > 0.6 ? K.L : K.MID);
    }
  }
  for (let k = 0; k < 26; k++) {
    const a = hash3(k, i, 11) * TAU;
    const r = 6 + hash3(k, i, 12) * 32;
    const [x, y] = at(c, c, r, a);
    pen.max(x, y, k % 4 === 0 ? K.W : K.L);
  }
}

// ---------------------------------------------------------------------------
// Upright effects
// ---------------------------------------------------------------------------

/** A pillar of light striking down: a thin beam, the full column, its rays and sparks, fading. */
function pillar(pen, i, K) {
  const { w, h } = pen;
  const cx = w / 2;
  const half = [1.5, 5.2, 4.4, 1.8][i];
  for (let y = 0; y < h; y++) {
    const foot = y > h - 10 ? (y - (h - 10)) / 10 : 0; // the flare at the ground
    const top = y < 10 ? y / 10 : 1; // a soft top
    const hw = half * (1 + foot * (i === 0 ? 2.2 : 1.2)) * (0.55 + 0.45 * top);
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d > hw + 1.5) continue;
      if (i === 3 && (y >> 2) % 2 === 1 && d > 0.8) continue; // breaking up
      let v;
      if (d < hw * 0.45) v = K.W;
      else if (d < hw * 0.8) v = K.L;
      else if (d < hw + 0.2) v = K.MID;
      else if ((x + y) % 2 === 0 && i > 0 && i < 3) v = K.D; // the dithered glow
      else continue;
      if (i === 2 && d > hw * 0.45 && (y + Math.floor(d * 3)) % 7 === 0) v = K.W; // rays in the light
      pen.max(x, y, v);
    }
  }
  if (i >= 1) {
    // the burst at its foot
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d < (i === 1 ? 11 : 9)) pen.max(x, h - 2, d < 4 ? K.W : K.L);
      if (d < (i === 1 ? 8 : 6)) pen.max(x, h - 3, K.L);
    }
    // sparks rising beside it
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(hash3(k, i, 21) * w);
      const y = Math.floor(((hash3(k, 0, 22) + i * 0.17) % 1) * (h - 8));
      if (Math.abs(x + 0.5 - cx) < half + 1) continue;
      pen.max(x, y, K.W);
      pen.max(x, y + 1, K.MID);
    }
  }
}

/** A burst of rays: a small star, twelve long rays, the ring they leave, its last sparks. */
function sunburst(pen, i, K) {
  const c = 16;
  if (i === 0) {
    for (let k = 0; k < 6; k++) ray(pen, c, 0, k % 2 ? 4 : 7, (k / 6) * TAU + 0.26, 1.3, K.W);
    ring(pen, c, c, 2, 2.4, K.W);
  } else if (i === 1) {
    for (let k = 0; k < 12; k++) ray(pen, c, 3, k % 2 ? 9 : 13.5, (k / 12) * TAU, k % 2 ? 1.0 : 1.4, k % 2 ? K.L : K.W);
    ring(pen, c, c, 3.2, 1.6, K.W);
    ring(pen, c, c, 7.5, 1.0, K.MID, (a) => (a / TAU) * 12 % 1 < 0.5);
  } else if (i === 2) {
    ring(pen, c, c, 12.5, 1.4, K.L);
    for (let k = 0; k < 12; k++) ray(pen, c, 9.5, 15, (k / 12) * TAU + 0.13, 1.0, k % 2 ? K.MID : K.L);
  } else {
    for (let k = 0; k < 16; k++) {
      const [x, y] = at(c, c, 13.5 + (k % 2) * 1.5, (k / 16) * TAU + 0.2);
      pen.max(x, y, K.L);
    }
  }
}

/** The Holy Bolt: a radiant orb, its four rays turning by 45° between the frames. */
function holyOrb(pen, i, K) {
  const c = 8;
  for (let k = 0; k < 4; k++) ray(pen, c, 2, 7.6, (k * Math.PI) / 2 + (i ? Math.PI / 4 : 0), 1.1, K.L);
  for (let k = 0; k < 4; k++) ray(pen, c, 2, 4.6, (k * Math.PI) / 2 + (i ? 0 : Math.PI / 4), 1.0, K.MID);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r < 1.8) pen.set(x, y, K.W);
      else if (r < 3.1) pen.max(x, y, K.W);
      else if (r < 3.9) pen.max(x, y, K.L);
    }
  }
}

/** A stone spike of the slam: rising, standing, cracking, crumbling. */
function rockSpike(pen, i, K) {
  const { h } = pen;
  const base = h - 1;
  const height = i === 0 ? 8 : i === 3 ? 12 : 22;
  const top = base - height;
  const pts = [[1.5, base + 0.5], [4, top + height * 0.45], [6.5, top + 1], [8.5, top], [11, top + height * 0.3], [14.5, base + 0.5]];
  fill(pen, pts, (x, y) => {
    const t = (y - top) / Math.max(1, height);
    const edge = x + 0.5 < 6 + t * 1.5;
    const s = hash3(x, y, 31);
    if (edge) return s < 0.25 ? K.W : K.L;
    if (x + 0.5 < 10 + t) return s < 0.2 ? K.L : K.MID;
    return s < 0.3 ? K.MID : K.D;
  });
  // strata and a crack
  for (let y = top + 3; y < base; y += 4) for (let x = 0; x < 16; x++) if (pen.get(x, y) && (x + y) % 3 === 0) pen.set(x, y, K.S);
  if (i >= 2) {
    line(pen, 8, top + 2, 6.5, top + 9, 1, K.R);
    line(pen, 6.5, top + 9, 9, top + 15, 1, K.R);
  }
  if (i === 2) {
    // bits falling off its shoulder
    pen.set(13, top + 4, K.MID);
    pen.set(2, top + 8, K.L);
  }
  if (i === 3) {
    // crumbled: a broken stump and rubble round it
    for (const [x, y] of [[0, base], [1, base - 1], [15, base], [14, base - 2], [3, base - 13], [12, base - 15]]) pen.set(x, y, K.MID);
  }
  pen.rim(K.R);
}

/** The ward dome: a hemisphere of hex light, its rim bright, its lattice clear at the edges, the base ring. */
function dome(pen, i, K) {
  const { w, h } = pen;
  const cx = w / 2, cy = h - 3.5;
  const rx = w / 2 - 1, ry = h - 5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const r = Math.hypot(dx, dy);
      if (dy > 0.05) continue;
      if (r > 1) continue;
      if (r > 1 - 1.6 / rx) {
        pen.set(x, y, K.W);
        continue;
      }
      // a lattice of light (diamonds 8 px across) shown toward the rim (a fresnel), the
      // meridians and parallels of the dome curving with it, shimmering between the frames
      if (r < 0.58) continue;
      // (the cell grid follows the dome's curve: angle round the middle and the radius)
      const ang = Math.atan2(-dy, dx); // 0 … π over the dome
      const u = (ang / Math.PI) * 14 + i * 0.5;
      const v = r * 9;
      const du = Math.abs(((u + v) % 2) - 1);
      const dv = Math.abs(((u - v + 40) % 2) - 1);
      if (du > 0.16 && dv > 0.16) continue;
      pen.set(x, y, r > 0.88 ? K.L : r > 0.74 ? K.MID : K.D);
    }
  }
  // the base ring seen in perspective
  for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - cx) / rx;
    if (Math.abs(dx) > 1) continue;
    const yy = Math.sqrt(Math.max(0, 1 - dx * dx)) * 2.6;
    pen.max(x, Math.round(cy + yy), K.L);
    if ((x + i) % 3) pen.max(x, Math.round(cy - yy * 0.6), K.MID);
  }
  // a highlight sweeping over the dome
  const hx = i ? 0.35 : -0.35;
  for (let k = -3; k <= 3; k++) {
    const a = Math.PI / 2 + hx + k * 0.035;
    const x = cx + Math.cos(a) * rx * 0.93, y = cy - Math.sin(a) * ry * 0.93;
    pen.max(x, y, K.W);
  }
}

// ---------------------------------------------------------------------------
// The ice mage: two-layer ice (body + lit), mist, glow, the frozen shell
// ---------------------------------------------------------------------------

/** Pixel centre (x, y) inside the polygon `pts`. @param {number[][]} pts @param {number} x @param {number} y */
function inside(pts, x, y) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/**
 * A faceted ice shape lit from the upper left: the ridge from its highest to its lowest corner
 * splits a lit face (left of it) from a shaded one. `lit` false paints the body (the lit face
 * mid, the shaded face dark, its lower-right outline darker); true only the lit face, its
 * upper-left outline and the tip bright — the layer drawn over the body.
 * @param {FxPen} pen @param {number[][]} pts @param {boolean} lit @param {FxKit} K
 */
function facetShape(pen, pts, lit, K) {
  let top = pts[0], bot = pts[0];
  for (const p of pts) { if (p[1] < top[1]) top = p; if (p[1] > bot[1]) bot = p; }
  const side = (x, y) => (bot[0] - top[0]) * (y + 0.5 - top[1]) - (bot[1] - top[1]) * (x + 0.5 - top[0]);
  fill(pen, pts, (x, y) => {
    const litFace = side(x, y) > 0;
    const ul = !inside(pts, x - 1, y) || !inside(pts, x, y - 1);
    const lr = !inside(pts, x + 1, y) || !inside(pts, x, y + 1);
    const nearTip = Math.hypot(x + 0.5 - top[0], y + 0.5 - top[1]) < 1.6;
    if (lit) {
      if (nearTip) return K.W;
      if (!litFace) return ul && y + 0.5 < (top[1] + bot[1]) / 2 ? K.L : null;
      return ul ? K.W : K.L;
    }
    if (lr) return litFace ? K.D : K.R;
    return litFace ? K.MID : y + 0.5 > (top[1] + bot[1]) / 2 ? K.S : K.D;
  });
}

/** The shard outlines (10 × 10): a kite, a sliver, a wedge, a chunk. */
const SHARDS = Object.freeze([
  [[5, 0.3], [8.6, 4.2], [6, 9.7], [2.4, 5.6]],
  [[3, 0.3], [6.8, 2.6], [8.2, 9.7], [2.2, 7.6]],
  [[1, 9.4], [5.4, 0.3], [9.5, 8.6]],
  [[2.4, 1.8], [7, 0.3], [9.6, 5], [6.4, 9.6], [0.6, 7]],
]);

/** An ice shard (the Tomb's spikes bursting, a shell shattering, the storm's hail). */
function iceShard(pen, i, lit, K) {
  facetShape(pen, SHARDS[i % SHARDS.length], lit, K);
}

/**
 * The Frost Lance pointing +U (seen from above): the frosted shaft and the faceted head.
 * The body holds the shaded half and the shaft; the lit layer the upper facet, its leading edge,
 * the tip, a glint walking along the head and the shaft's top line.
 */
function iceLance(pen, i, lit, K) {
  const head = [[13.5, 3.5], [18, 0.4], [23.7, 3.6], [18, 7.6]];
  if (!lit) {
    for (let x = 2; x <= 15; x++) {
      pen.set(x, 3, x > 7 ? K.MID : K.D);
      pen.set(x, 4, x > 7 ? K.D : K.S);
    }
    fill(pen, head, (x, y) => (y < 3.5 ? K.MID : y < 5 ? K.D : K.S));
    // frost wisps behind
    pen.set(1, 2 + i, K.D);
    pen.set(0, 5 - i, K.S);
    return;
  }
  for (let x = 8; x <= 14; x++) pen.set(x, 3, x > 11 ? K.L : K.MID);
  fill(pen, head, (x, y) => (y >= 3.5 ? null : x >= 21 || y < 1.5 ? K.W : K.L));
  pen.set(23, 3, K.W);
  const g = i ? 19 : 16;
  pen.set(g, 3, K.W);
  pen.set(g + 1, 3, K.W);
  pen.set(g + 1, 4, K.L);
}

/** A snowflake of six arms with tiny branches (frame 1: turned 30°). */
function iceFlake(pen, i, K) {
  const c = 4.5;
  pen.set(4, 4, K.W);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + (i ? Math.PI / 6 : 0);
    for (let r = 1; r <= 4; r++) pen.max(c - 0.5 + Math.cos(a) * r, c - 0.5 - Math.sin(a) * r, r === 4 ? K.L : K.W);
    if (!i) {
      const bx = c + Math.cos(a) * 2.6, by = c - Math.sin(a) * 2.6;
      pen.max(bx - 0.5 + Math.cos(a + 1.1), by - 0.5 - Math.sin(a + 1.1), K.L);
    }
  }
}

/**
 * Low cold mist (drawn with FxQuads `soft`: its rim thins in dither): three lumpy banks, lit from
 * the upper left, shadowed underneath, a few denser speckles.
 */
function iceMist(pen, i, K) {
  const { w, h } = pen;
  const blobs = [];
  for (let k = 0; k < 5; k++) {
    blobs.push([7 + k * 6.5 + hash3(k, i, 61) * 3, 10 + hash3(k, i, 62) * 3 - (k === 2 ? 2 : 0), 4.5 + hash3(k, i, 63) * 3.5]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = -1;
      for (const [bx, by, br] of blobs) best = Math.max(best, 1 - Math.hypot(x + 0.5 - bx, (y + 0.5 - by) * 1.6) / br);
      if (best < 0) continue;
      const lightSide = (x / w) * 0.4 + (1 - y / h);
      const n = hash3(x, y, 64 + i);
      const v = best > 0.55 && lightSide > 0.95 ? K.W : lightSide > 0.8 ? K.L : lightSide > 0.5 ? K.MID : K.D;
      pen.set(x, y, n < 0.06 ? Math.max(K.D, v - 30) : v);
    }
  }
}

/** A bokeh disc (a near flake out of focus): a bright rim round a softer face. */
function iceBokeh(pen, K) {
  const c = pen.w / 2;
  for (let y = 0; y < pen.h; y++) {
    for (let x = 0; x < pen.w; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c) / (c - 0.2);
      if (r <= 1) pen.set(x, y, r > 0.72 ? K.W : K.L);
    }
  }
}

/** A plain disc (the glyph's inner glow: FxQuads `soft` thins it toward the rim). */
function iceGlow(pen, K) {
  const c = pen.w / 2;
  for (let y = 0; y < pen.h; y++) {
    for (let x = 0; x < pen.w; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c) / (c - 0.5);
      if (r <= 1) pen.set(x, y, r < 0.35 ? K.W : K.L);
    }
  }
}

/**
 * The ice a frozen foe wears, drawn over its sprite: a faceted crystal block (a pointed top, three
 * faces) whose body is full of gaps — 2 × 2 holes on a diagonal lattice, denser in the front face —
 * so the foe shows through; the outline and the facet lines stay solid. The lit layer: the left
 * face's sheen, the facet lines, the upper-left outline, a glint (another spot in frame 1), a crack.
 */
function iceShell(pen, i, lit, K) {
  // an angular block of three faces under a sharp, off-centre crown; crystals jut from its shoulders
  const pts = i
    ? [[4.5, 37.6], [2, 26], [3.2, 12], [16.5, 0.3], [27.4, 12.5], [28, 27], [25, 37.6]]
    : [[4, 37.6], [1.5, 25], [2.5, 11.5], [12.5, 0.3], [27.2, 11], [28.2, 26], [25.5, 37.6]];
  const spikes = i
    ? [[[1.5, 20], [-0.5 + 0.5, 12.5], [4.5, 17]], [[27.5, 18], [29.6, 9], [25, 14]]]
    : [[[2, 18], [0.4, 9.5], [5, 14]], [[27, 20], [29.6, 13], [25.5, 16]]];
  const crown = i ? 16.5 : 12.5;
  const f1 = (y) => 9.5 + (y / 38) * 1.5;
  const f2 = (y) => 20.5 - (y / 38) * 1.0;
  const inBlock = (x, y) => inside(pts, x, y);
  fill(pen, pts, (x, y) => {
    const cx = x + 0.5;
    const edge = !inBlock(x - 1, y) || !inBlock(x + 1, y) || !inBlock(x, y - 1) || !inBlock(x, y + 1);
    const ul = !inBlock(x - 1, y) || !inBlock(x, y - 1);
    // the facet lines, and the crown's ridge from its point down to the front face
    const line1 = Math.abs(cx - f1(y)) < 0.75 && y > 6;
    const line2 = Math.abs(cx - f2(y)) < 0.75 && y > 6;
    const ridge = y <= 7 && Math.abs(cx - (crown + (y / 7) * ((f1(7) + f2(7)) / 2 - crown))) < 0.75;
    const face = cx < f1(y) ? 0 : cx < f2(y) ? 1 : 2;
    if (lit) {
      if (ul && (face === 0 || y < 8)) return K.W;
      if (line1 || ridge) return y < 22 ? K.L : K.MID;
      if (line2 && y < 12) return K.MID;
      // a sheen across the left face
      if (face === 0 && !edge && Math.abs(cx + y * 0.5 - 13) < 1.2) return K.L;
      return null;
    }
    if (edge) return face === 2 ? K.S : K.D;
    if (line1 || line2 || ridge) return K.MID;
    // the clear ice: the upper body open (the foe's head and shoulders read through it) but for a
    // few streaks, then diagonal streaks one texel wide growing denser toward the frosted foot
    if (y < 33) {
      const n = y < 16 ? 7 : y < 26 ? 5 : 3;
      if (face === 1 ? (((x - y) % n) + n) % n !== 0 : (x + y) % (n + 1) !== 0) return null;
    }
    return face === 0 ? K.MID : face === 1 ? K.D : K.S;
  });
  // the shoulder crystals (solid: the body's own ice; the lit layer their upper-left edges)
  for (const tri of spikes) {
    fill(pen, tri, (x, y) => {
      const ul = !inside(tri, x - 1, y) || !inside(tri, x, y - 1);
      if (lit) return ul ? K.W : null;
      return ul ? K.MID : K.D;
    });
  }
  if (lit) {
    // a glint
    const [gx, gy] = i ? [6, 15] : [5, 10];
    pen.set(gx, gy, K.W);
    pen.set(gx - 1, gy, K.L);
    pen.set(gx + 1, gy, K.L);
    pen.set(gx, gy - 1, K.L);
    pen.set(gx, gy + 1, K.L);
  }
}

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'partyGlyphHoly': glyphHoly(pen, K); break;
    case 'partyGlyphFrost': glyphFrost(pen, K); break;
    case 'partyGlyphWard': glyphWard(pen, K); break;
    case 'partyWardRing': wardRing(pen, K); break;
    case 'partyRing': shockRing(pen, i, K); break;
    case 'partyCrack': crack(pen, K); break;
    case 'partySwirl': swirl(pen, i, K); break;
    case 'partyPillar': pillar(pen, i, K); break;
    case 'partySunburst': sunburst(pen, i, K); break;
    case 'partyHolyOrb': holyOrb(pen, i, K); break;
    case 'partyRockSpike': rockSpike(pen, i, K); break;
    case 'partyDome': dome(pen, i, K); break;
    case 'partyIceLance': iceLance(pen, i, false, K); break;
    case 'partyIceLanceLit': iceLance(pen, i, true, K); break;
    case 'partyIceShard': iceShard(pen, i, false, K); break;
    case 'partyIceShardLit': iceShard(pen, i, true, K); break;
    case 'partyIceFlake': iceFlake(pen, i, K); break;
    case 'partyIceMist': iceMist(pen, i, K); break;
    case 'partyIceGlow': iceGlow(pen, K); break;
    case 'partyIceBokeh': iceBokeh(pen, K); break;
    case 'partyIceShell': iceShell(pen, i, false, K); break;
    case 'partyIceShellLit': iceShell(pen, i, true, K); break;
    default: break;
  }
}
