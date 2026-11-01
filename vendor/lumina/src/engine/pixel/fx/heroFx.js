/**
 * The swordmaster's FX frames (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.8),
 * painted into the combat FX atlas (../FxSprites.js: the module shape, the pen and the kit) in grey
 * levels that FxQuads' instance colours tint (alpha binary). Owner: the player package. Played by
 * `PlayerCombat`'s hero effects (src/game/combat/PlayerCombat.js `HeroFx`):
 *
 * | Frame | Size × n | Mode | Use |
 * | --- | --- | --- | --- |
 * | `heroGale` | 64×32 × 4 | flat | the combo's wind-blade arc: a blade-bright crescent sweeping right → left (bulging toward +V, the facing) with three wind lines trailing inside it; the A3 finisher flies one forward |
 * | `heroBlade` | 40×12 × 2 | flat | a spectral sword along +U (tip right): Tempest Edge's orbiting blades; frame 1 a glint |
 * | `heroCyclone` | 96×96 × 4 | flat | Tempest Edge's storm ring: three broken wind bands with bright heads turning counter-clockwise (as seen from above, +V up), a 4-frame loop |
 * | `heroWave` | 64×32 × 4 | flat | Dragonfang Wave's crescent (bulging toward +V), a white-hot leading edge, fang teeth on its inner edge and speed lines behind |
 * | `heroSword` | 40×128 × 2 | billboard | Skyfall Judgement's giant spectral sword, point down; frame 1 its runes lit |
 * | `heroSigil` | 160×160 × 1 | flat | Skyfall Judgement's ground glyph (r ≈ 5 u at scale 1): rings, a rune band, a hexagram |
 * | `heroCrack` | 96×96 × 1 | flat | the cracks the sword leaves (tinted from a gold glow to scorch as they fade) |
 *
 * The second batch (`late: 2`, the swordmaster's look of src/game/combat/SwordmasterFx.js; the
 * atlas packs them after every older frame, so none of those moves). The `…Lit` frames are the lit
 * layer of a two-quad effect: only the texels that catch the light, drawn over the body in a
 * brighter tint of the same hue (the halo hugs them):
 *
 * | Frame | Size × n | Mode | Use |
 * | --- | --- | --- | --- |
 * | `heroGaleLit` | 64×32 × 4 | flat | `heroGale`'s lit layer: the blade's bright edge near its head, the first wind line |
 * | `heroThrustLit` | 48×12 × 3 | flat | the base `thrust` streak's lit layer: its core line and tip |
 * | `heroWaveLit` | 64×32 × 4 | flat | `heroWave`'s lit layer: the crescent's leading edge and the fangs' lit sides |
 * | `heroFangCrest` | 48×40 × 4 | billboard | Dragonfang Wave's crest: three curved fangs rising off the ground (frames 0–2 a loop, 3 their collapse) |
 * | `heroFangCrestLit` | 48×40 × 4 | billboard | the crest's lit layer: the fangs' lit edges and tips |
 * | `heroCut` | 24×12 × 3 | billboard | a short slash cut across a foe (Tempest Edge's hits) |
 * | `heroBite` | 32×32 × 3 | billboard | two fang slashes crossing on a foe (Dragonfang Wave's bites) |
 * | `heroRunes` | 48×16 × 2 | flat | a plate of three runes on an arc (radius 79 px at its top: Skyfall's sigil band); 0 engraved, 1 lit |
 *
 * Closed-form shapes and a fixed integer hash (no RNG). ≈ 104 k texels of the atlas, ≈ 39 k more in
 * the second batch.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  heroGale: Object.freeze({ w: 64, h: 32, n: 4, fps: 30 }),
  heroBlade: Object.freeze({ w: 40, h: 12, n: 2, fps: 12 }),
  heroCyclone: Object.freeze({ w: 96, h: 96, n: 4, fps: 24 }),
  heroWave: Object.freeze({ w: 64, h: 32, n: 4, fps: 24 }),
  heroSword: Object.freeze({ w: 40, h: 128, n: 2, fps: 8 }),
  heroSigil: Object.freeze({ w: 160, h: 160, n: 1, fps: 0 }),
  heroCrack: Object.freeze({ w: 96, h: 96, n: 1, fps: 0 }),
  // the second batch (generation 2: packed after every older frame; frozen once it lands)
  heroGaleLit: Object.freeze({ w: 64, h: 32, n: 4, fps: 30, late: 2 }),
  heroThrustLit: Object.freeze({ w: 48, h: 12, n: 3, fps: 30, late: 2 }),
  heroWaveLit: Object.freeze({ w: 64, h: 32, n: 4, fps: 24, late: 2 }),
  heroFangCrest: Object.freeze({ w: 48, h: 40, n: 4, fps: 24, late: 2 }),
  heroFangCrestLit: Object.freeze({ w: 48, h: 40, n: 4, fps: 24, late: 2 }),
  heroCut: Object.freeze({ w: 24, h: 12, n: 3, fps: 30, late: 2 }),
  heroBite: Object.freeze({ w: 32, h: 32, n: 3, fps: 24, late: 2 }),
  heroRunes: Object.freeze({ w: 48, h: 16, n: 2, fps: 0, late: 2 }),
});

/** A small integer hash → [0, 1) (closed form: the same pixels on every run). */
function hash(a, b = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * A line of `v` from (x0, y0) to (x1, y1), `w` px thick (brighter kept: `pen.max`).
 * @param {FxPen} pen
 */
function line(pen, x0, y0, x1, y1, v, w = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const r = (w - 1) / 2;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (r <= 0) pen.max(x, y, v);
    else for (let dy = -r; dy <= r + 1e-6; dy += 1) for (let dx = -r; dx <= r + 1e-6; dx += 1) pen.max(x + dx, y + dy, v);
  }
}

/**
 * Points of an ellipse arc (angles a0 → a1, 0 = texture right, π/2 = top) at `v`, dashed: `dash`
 * px drawn of every `period` (0: solid); `keep(a)` (optional) skips the points it refuses — the same
 * dashes as the whole arc's, only fewer of them (a lit layer over the arc).
 * @param {FxPen} pen
 * @param {((a: number) => boolean)|null} [keep]
 */
function ellipseArc(pen, cx, cy, rx, ry, a0, a1, v, dash = 0, period = 0, phase = 0, keep = null) {
  const len = Math.abs(a1 - a0) * Math.max(rx, ry);
  const n = Math.max(2, Math.ceil(len * 2));
  for (let k = 0; k <= n; k++) {
    const a = a0 + (a1 - a0) * (k / n);
    if (period > 0 && ((k / 2 + phase) % period) >= dash) continue;
    if (keep && !keep(a)) continue;
    pen.max(cx + Math.cos(a) * rx, cy - Math.sin(a) * ry, v);
  }
}

// ---------------------------------------------------------------------------------------------
// heroGale — the combo's wind blade
// ---------------------------------------------------------------------------------------------

/** The sweep of the blade arc per frame (like the base `slashBig`, a touch thinner). */
const GALE = [
  { a0: 0.12, a1: 1.3, thick: 0.24 },
  { a0: 0.08, a1: 2.45, thick: 0.3 },
  { a0: 0.3, a1: 3.05, thick: 0.27 },
  { a0: 1.65, a1: 3.08, thick: 0.15 },
];

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function gale(pen, i, K) {
  const P = GALE[i];
  K.arc(pen, { cx: 32, cy: 30.5, rx: 31, ry: 29, lead: 'left', ...P });
  // three wind lines inside the blade, each lagging further behind the head and broken into dashes
  const lines = [[0.8, 0.28, K.L, 0], [0.66, 0.55, K.MID, 3], [0.52, 0.85, K.D, 5]];
  for (const [k, lag, v, ph] of lines) {
    const a1 = P.a1 - lag;
    const a0 = Math.max(P.a0 + 0.1, i === 3 ? P.a0 + 0.4 : P.a0);
    if (a1 <= a0) continue;
    ellipseArc(pen, 32, 30.5, 31 * k, 29 * k, a0, a1, v, i === 3 ? 2 : 5, i === 3 ? 4 : 6, ph + i * 2);
  }
  // wisps flung off the edge, curling at the tail
  if (i >= 1) {
    for (let k = 0; k < 5; k++) {
      const a = P.a0 + 0.25 + k * 0.45 + i * 0.05;
      if (a > P.a1 - 0.2) break;
      const r = 1.04 + 0.04 * ((k + i) % 2);
      const x = 32 + Math.cos(a) * 31 * r;
      const y = 30.5 - Math.sin(a) * 29 * r;
      pen.max(x, y, i === 3 ? K.D : K.L);
      if (i >= 2) pen.max(x + 1, y + (k % 2 ? 1 : -1), K.MID);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// heroBlade — a spectral sword along +U
// ---------------------------------------------------------------------------------------------

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function blade(pen, i, K) {
  // pommel, grip (wrapped), the guard swept back, the blade (fuller lit) tapering to the tip at x 39
  for (const [x, y, v] of [[1, 5, K.L], [1, 6, K.MID], [2, 4, K.MID], [2, 5, K.W], [2, 6, K.L], [2, 7, K.D]]) pen.set(x, y, v);
  for (let x = 3; x <= 8; x++) {
    pen.set(x, 5, x % 2 ? K.MID : K.L);
    pen.set(x, 6, x % 2 ? K.D : K.MID);
  }
  for (let y = 1; y <= 10; y++) {
    const back = y <= 1 || y >= 10 ? 1 : 0;
    pen.set(9 - back, y, y < 4 ? K.L : y > 7 ? K.D : K.MID);
    pen.set(10 - back, y, y < 4 ? K.W : y > 7 ? K.MID : K.L);
  }
  for (let x = 11; x <= 39; x++) {
    const hw = x < 31 ? 2 : Math.max(0, Math.round(2 * (39.5 - x) / 8.5));
    for (let y = 6 - hw; y <= 5 + hw; y++) {
      const fromTop = y - (6 - hw);
      const v = hw === 0 ? K.L : fromTop === 0 ? K.L : y === 5 ? K.W : y === 6 ? K.L : fromTop >= 2 * hw - 1 ? K.D : K.MID;
      pen.set(x, y, v);
    }
  }
  if (i === 1) {
    // a glint running down the blade
    for (const [x, y] of [[26, 2], [26, 3], [26, 8], [26, 9], [24, 5], [25, 5], [27, 5], [28, 5], [25, 4], [27, 7]]) pen.max(x, y, K.W);
  }
}

// ---------------------------------------------------------------------------------------------
// heroCyclone — the storm ring
// ---------------------------------------------------------------------------------------------

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function cyclone(pen, i, K) {
  const c = 48;
  // bands: [inner r, outer r, heads, turn per frame (rad), trail length (rad)] — 4 frames loop
  // (each band's turn over the loop is a multiple of its heads' spacing)
  const bands = [
    [41.5, 46.5, 4, Math.PI / 8, 1.25],
    [32.5, 36, 2, Math.PI / 4, 1.9],
    [23.5, 26, 4, Math.PI / 8, 0.95],
  ];
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(-dy, dx);
      for (let b = 0; b < bands.length; b++) {
        const [r0, r1, heads, turn, trail] = bands[b];
        if (r < r0 || r > r1) continue;
        const spacing = (Math.PI * 2) / heads;
        const head = turn * i + b * 0.7;
        // angle behind the nearest head (heads turn counter-clockwise: the trail lies clockwise)
        let d = (head - a) % spacing;
        if (d < 0) d += spacing;
        if (d > trail) continue;
        const u = d / trail; // 0 head … 1 tail end
        const outer = r > r1 - 1.3;
        if (u > 0.55 && ((x + y + i) & 1)) continue; // the tail breaks up
        if (u > 0.8 && ((x * 3 + y) % 4)) continue;
        const v = u < 0.12 ? (outer ? K.W : K.L) : u < 0.4 ? (outer ? K.L : K.MID) : u < 0.7 ? K.MID : K.D;
        pen.max(x, y, v);
      }
    }
  }
  // dust motes swept round with the outer band
  for (let k = 0; k < 10; k++) {
    const a = k * 0.63 + (Math.PI / 8) * i + hash(k, 7) * 0.4;
    const r = 28 + hash(k, 3) * 18;
    const x = c + Math.cos(a) * r;
    const y = c - Math.sin(a) * r;
    pen.max(x, y, k % 3 ? K.D : K.MID);
    if (k % 4 === 0) pen.max(x - Math.sin(a), y - Math.cos(a), K.D);
  }
}

// ---------------------------------------------------------------------------------------------
// heroWave — Dragonfang Wave's crescent
// ---------------------------------------------------------------------------------------------

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function wave(pen, i, K) {
  const grow = i === 3 ? 0.6 : 0;
  // the band between an outer ellipse and an inner one set lower and flatter: 6 px at the centre,
  // thinning to long sharp horns
  const inOuter = (x, y) => ((x - 32) / (31 + grow)) ** 2 + ((y - 31) / (27 + grow)) ** 2 <= 1;
  const inInner = (x, y) => ((x - 32) / 31.5) ** 2 + ((y - 35.5) / 25.5) ** 2 <= 1;
  const inBand = (x, y) => inOuter(x, y) && !inInner(x, y);
  for (let y = 0; y < 31; y++) {
    for (let x = 0; x < 64; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inBand(px, py)) continue;
      // depth from the leading (outer) edge: rows of the outer ellipse above this point
      let depth = 0;
      while (depth < 6 && inOuter(px, py - depth - 1)) depth++;
      const flick = (x + i * 5) % 9 === 0;
      const v = depth === 0 ? K.W : depth === 1 ? (flick ? K.W : K.L) : depth <= 3 ? K.L : depth === 4 ? K.MID : K.D;
      pen.set(x, y, v);
    }
  }
  // two fangs hanging from the inner edge, curving in toward the middle
  for (const [tx, dir] of [[21, 1], [43, -1]]) {
    let ty = 0;
    while (ty < 31 && !inBand(tx + 0.5, ty + 0.5)) ty++;
    while (ty < 31 && inBand(tx + 0.5, ty + 1.5)) ty++;
    const len = 7;
    for (let s = 1; s <= len; s++) {
      const half = s < 3 ? 1.5 : s < 5 ? 1 : s < 7 ? 0.5 : 0;
      const cx = tx + 0.5 + dir * Math.floor((s - 1) / 3);
      for (let x = Math.round(cx - half - 0.5); x <= Math.round(cx + half - 0.5); x++) {
        const lit = dir > 0 ? x < cx - 0.5 : x > cx - 0.5;
        pen.set(x, ty + s, s >= len - 1 ? K.MID : lit ? K.W : K.L);
      }
    }
  }
  // speed lines behind the middle (+y), shifting with the frames
  for (let k = 0; k < 4; k++) {
    const x = 27 + k * 3 + ((i + k) % 2);
    const yTop = 13 + ((k * 5 + i * 3) % 4);
    const len = 4 + ((k + i) % 3);
    for (let s = 0; s < len; s++) if (yTop + s < 32 && !pen.get(x, yTop + s)) pen.set(x, yTop + s, s === 0 ? K.MID : K.D);
  }
}

// ---------------------------------------------------------------------------------------------
// heroSword — the giant spectral sword, point down
// ---------------------------------------------------------------------------------------------

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function sword(pen, i, K) {
  const cx = 19.5;
  // pommel: a round gem
  for (let y = 0; y < 8; y++) {
    for (let x = 14; x < 26; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - 4);
      if (r > 3.6) continue;
      pen.set(x, y, r < 1.3 ? K.W : r < 2.4 ? K.L : r < 3.1 ? K.MID : K.D);
    }
  }
  // grip: wrapped bands
  for (let y = 8; y <= 22; y++) {
    for (let x = 17; x <= 22; x++) {
      const edge = x === 17 || x === 22;
      const band = (y >> 1) % 2 === 0;
      pen.set(x, y, edge ? K.D : band ? (x < 20 ? K.L : K.MID) : K.D);
    }
  }
  // crossguard: a bar with wing tips swept down and a diamond boss
  for (let x = 3; x <= 36; x++) {
    const dx = Math.abs(x + 0.5 - cx);
    const droop = dx > 12 ? Math.round((dx - 12) * 0.55) : 0;
    for (let s = 0; s < 3; s++) pen.set(x, 24 + s + droop, s === 0 ? K.L : s === 1 ? K.MID : K.D);
    if (dx > 14.5) pen.set(x, 27 + droop, K.D);
  }
  for (let y = 21; y <= 31; y++) {
    const half = 4 - Math.abs(y - 26) * 0.75;
    for (let x = Math.ceil(cx - half); x <= Math.floor(cx + half); x++) {
      const d = Math.abs(x + 0.5 - cx) + Math.abs(y - 26) * 0.75;
      pen.set(x, y, d < 1.2 ? K.W : d < 2.6 ? K.L : K.MID);
    }
  }
  // blade: 14 px wide, tapering to the point at the bottom; a lit fuller, the left face lit, the
  // right face in shade, a dark bevel on both edges
  for (let y = 31; y < 128; y++) {
    const hw = y < 100 ? 7 : Math.max(0, 7 * (126.5 - y) / 26.5);
    for (let x = 0; x < 40; x++) {
      const d = x + 0.5 - cx;
      if (Math.abs(d) > hw) continue;
      const a = Math.abs(d);
      const v = a <= 1 ? K.W : a > hw - 1 ? (d < 0 ? K.D : K.S) : d < 0 ? (a < 4 ? K.L : K.MID) : (a < 3 ? K.MID : K.D);
      pen.set(x, y, v);
    }
  }
  // runes along the fuller: engraved (dark) on frame 0, lit on frame 1 — every other one alternates
  for (let k = 0; k < 7; k++) {
    const y = 38 + k * 9;
    const lit = i === 1 ? k % 2 === 0 : k % 2 === 1;
    const v = lit ? K.W : K.S;
    const g = k % 3;
    const pts = g === 0 ? [[0, 0], [0, 1], [0, 2], [1, 1]] : g === 1 ? [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2]] : [[1, 0], [0, 1], [1, 1], [1, 2]];
    for (const [dx, dy] of pts) pen.set(19 + dx, y + dy, v);
  }
  // an edge glint
  if (i === 1) for (let k = 0; k < 6; k++) pen.set(13 + (k >> 1), 58 + k, K.W);
  pen.rim(K.S);
}

// ---------------------------------------------------------------------------------------------
// heroSigil — the ground glyph
// ---------------------------------------------------------------------------------------------

/** Rune templates (3 × 5) for the glyph band. */
const RUNES = [
  ['#.#', '###', '.#.', '.#.', '.#.'],
  ['##.', '#.#', '##.', '#.#', '##.'],
  ['.#.', '#.#', '###', '#.#', '#.#'],
  ['###', '..#', '.#.', '#..', '###'],
  ['#..', '#..', '###', '#.#', '###'],
  ['.#.', '###', '.#.', '###', '.#.'],
];

/** @param {FxPen} pen @param {FxKit} K */
function sigil(pen, K) {
  const c = 80;
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < 160; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r >= 76 && r < 78.2) pen.set(x, y, K.L);
      else if (r >= 78.2 && r < 79.4) pen.set(x, y, K.MID);
      else if (r >= 70 && r < 71.2) pen.set(x, y, K.MID);
      else if (r >= 56.2 && r < 57.8) pen.set(x, y, K.L);
      else if (r >= 27 && r < 28.2) pen.set(x, y, K.MID);
      else if (r < 3.6) pen.set(x, y, r < 2 ? K.W : K.L);
    }
  }
  // the rune band between the outer rings: 24 runes
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.13;
    const rx = c + Math.cos(a) * 73.6 - 1;
    const ry = c - Math.sin(a) * 73.6 - 2;
    K.stamp(pen, RUNES[k % RUNES.length].map((row) => row.replace(/#/g, k % 4 === 0 ? 'L' : 'M')), Math.round(rx), Math.round(ry));
  }
  // the hexagram inscribed in the inner ring, with a node at each point
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + (k / 6) * Math.PI * 2;
    pts.push([c + Math.cos(a) * 56, c - Math.sin(a) * 56]);
  }
  for (const tri of [[0, 2, 4], [1, 3, 5]]) {
    for (let k = 0; k < 3; k++) {
      const [x0, y0] = pts[tri[k]];
      const [x1, y1] = pts[tri[(k + 1) % 3]];
      line(pen, x0, y0, x1, y1, K.L);
    }
  }
  for (const [px, py] of pts) {
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const r = Math.hypot(x, y);
      if (r <= 3.2) pen.max(px + x, py + y, r < 1.5 ? K.W : r < 2.5 ? K.L : K.MID);
    }
  }
  // spokes in the inner circle: four long and lit, four short
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r1 = k % 2 ? 16 : 24;
    line(pen, c + Math.cos(a) * 6, c - Math.sin(a) * 6, c + Math.cos(a) * r1, c - Math.sin(a) * r1, k % 2 ? K.MID : K.W);
  }
}

// ---------------------------------------------------------------------------------------------
// heroCrack — the cracks of the impact
// ---------------------------------------------------------------------------------------------

/** @param {FxPen} pen @param {FxKit} K */
function crack(pen, K) {
  const c = 48;
  // the crater's rim
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r >= 8.5 && r < 10.5) pen.set(x, y, (x + y) % 3 ? K.MID : K.D);
      else if (r < 8.5 && hash(x, y) < 0.18) pen.set(x, y, K.D);
    }
  }
  // eleven jagged cracks running out, thick and hot near the centre, with a branch on some
  const n = 11;
  for (let k = 0; k < n; k++) {
    let a = (k / n) * Math.PI * 2 + (hash(k, 1) - 0.5) * 0.35;
    const len = 26 + hash(k, 2) * 20;
    let x = c + Math.cos(a) * 10;
    let y = c - Math.sin(a) * 10;
    let r = 10;
    let seg = 0;
    while (r < len) {
      a += (hash(k, 10 + seg) - 0.5) * 0.7;
      const step = 3 + hash(k, 30 + seg) * 2;
      const nx = x + Math.cos(a) * step;
      const ny = y - Math.sin(a) * step;
      r = Math.hypot(nx - c, ny - c);
      const v = r < 22 ? K.W : r < 33 ? K.L : K.MID;
      line(pen, x, y, nx, ny, v, r < 18 ? 2 : 1);
      if (seg === 3 && k % 2 === 0) {
        // a branch
        const b = a + (k % 4 ? 0.65 : -0.65);
        const bl = 7 + hash(k, 50) * 6;
        line(pen, nx, ny, nx + Math.cos(b) * bl, ny - Math.sin(b) * bl, K.MID);
      }
      x = nx;
      y = ny;
      seg++;
    }
  }
  // flung grit
  for (let k = 0; k < 26; k++) {
    const a = hash(k, 70) * Math.PI * 2;
    const r = 12 + hash(k, 71) * 32;
    pen.max(c + Math.cos(a) * r, c - Math.sin(a) * r, K.D);
  }
}

// ---------------------------------------------------------------------------------------------
// The second batch (late: 2): lit layers, the crest, cuts, bites, rune plates
// ---------------------------------------------------------------------------------------------

/**
 * `heroGale`'s lit layer: the blade's edge band where it is brightest (near the head: W, then L)
 * and the first wind line's dashes near the head (the body's own dashes, fewer of them).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function galeLit(pen, i, K) {
  const P = GALE[i];
  const cx = 32, cy = 30.5, rx = 31, ry = 29;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (cy - (y + 0.5)) / ry;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < P.a0 || a > P.a1 || dy < -0.05) continue;
      // (the kit's arc with lead 'left': thick and bright at a0, thinning toward a1)
      const toLead = (a - P.a0) / Math.max(1e-6, P.a1 - P.a0);
      const t = P.thick * (0.35 + 0.65 * (1 - toLead));
      if (r > 1 || r < 1 - t) continue;
      if (r <= 1 - t * 0.35 || toLead >= 0.55) continue;
      pen.set(x, y, toLead < 0.3 ? K.W : K.L);
    }
  }
  const a1 = P.a1 - 0.28;
  const a0 = Math.max(P.a0 + 0.1, i === 3 ? P.a0 + 0.4 : P.a0);
  if (a1 > a0) ellipseArc(pen, 32, 30.5, 31 * 0.8, 29 * 0.8, a0, a1, K.L, i === 3 ? 2 : 5, i === 3 ? 4 : 6, i * 2, (a) => a < a0 + 0.9);
}

/**
 * The base `thrust` streak's lit layer (FxSprites' painter, its core and tip only).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function thrustLit(pen, i, K) {
  const len = [26, 44, 40][i];
  const x0 = [20, 3, 7][i];
  for (let x = 0; x < len; x++) {
    const t = x / len;
    const half = Math.max(0, (t < 0.85 ? 1 + Math.round(3 * t) : Math.round((4 * (1 - t)) / 0.15)) - (i === 2 ? 1 : 0));
    if (i === 2 && t < 0.35 && x % 4 === 1) continue;
    for (let dy = -half; dy <= half; dy++) {
      const core = Math.abs(dy) <= Math.max(0, half - 2);
      if (core) pen.set(x0 + x, 6 + dy, t > 0.3 ? K.W : K.L);
      else if (t > 0.85 && Math.abs(dy) < half) pen.set(x0 + x, 6 + dy, K.L);
    }
  }
}

/**
 * `heroWave`'s lit layer: the crescent's leading edge (the first two rows of the band, as the body
 * draws them) and the fangs' lit sides.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function waveLit(pen, i, K) {
  const grow = i === 3 ? 0.6 : 0;
  const inOuter = (x, y) => ((x - 32) / (31 + grow)) ** 2 + ((y - 31) / (27 + grow)) ** 2 <= 1;
  const inInner = (x, y) => ((x - 32) / 31.5) ** 2 + ((y - 35.5) / 25.5) ** 2 <= 1;
  const inBand = (x, y) => inOuter(x, y) && !inInner(x, y);
  for (let y = 0; y < 31; y++) {
    for (let x = 0; x < 64; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inBand(px, py)) continue;
      let depth = 0;
      while (depth < 2 && inOuter(px, py - depth - 1)) depth++;
      if (depth > 1) continue;
      const flick = (x + i * 5) % 9 === 0;
      pen.set(x, y, depth === 0 || flick ? K.W : K.L);
    }
  }
  for (const [tx, dir] of [[21, 1], [43, -1]]) {
    let ty = 0;
    while (ty < 31 && !inBand(tx + 0.5, ty + 0.5)) ty++;
    while (ty < 31 && inBand(tx + 0.5, ty + 1.5)) ty++;
    const len = 7;
    for (let s = 1; s < len - 1; s++) {
      const half = s < 3 ? 1.5 : s < 5 ? 1 : s < 7 ? 0.5 : 0;
      const cx = tx + 0.5 + dir * Math.floor((s - 1) / 3);
      for (let x = Math.round(cx - half - 0.5); x <= Math.round(cx + half - 0.5); x++) {
        const lit = dir > 0 ? x < cx - 0.5 : x > cx - 0.5;
        if (lit) pen.set(x, ty + s, K.W);
      }
    }
  }
}

/** The crest's fangs per frame: [height, base half-width, bend] of the left, middle, right fang. */
const CREST = [
  [[25, 4.5, -6], [34, 5.5, 2.5], [25, 4.5, 6]],
  [[27, 4.5, -7], [32, 5.5, 3], [24, 4.5, 5.5]],
  [[24, 4.5, -5.5], [35, 5.5, 2], [27, 4.5, 7]],
  [[12, 4, -8], [15, 5, 4], [11, 4, 8]],
];

/**
 * Dragonfang Wave's crest (billboard, the ground at its foot): three fangs curving out of a jagged
 * ridge, lit from the upper left; frame 3 their collapse. `lit`: only the lit edges and tips.
 * @param {FxPen} pen @param {number} i @param {FxKit} K @param {boolean} lit
 */
function crest(pen, i, K, lit) {
  const base = 38;
  const xs = [12, 24, 36];
  for (let f = 0; f < 3; f++) {
    const [height, hw0, bend] = CREST[i][f];
    for (let y = base; y >= base - height; y--) {
      const t = (base - y) / height;
      // (the collapse breaks up toward the tips)
      if (i === 3 && t > 0.45 && hash(f * 97 + y, 3) < 0.35) continue;
      const xc = xs[f] + bend * t * t;
      const hw = hw0 * Math.pow(1 - t, 0.8);
      if (hw < 0.3 && t < 0.97) continue;
      const x0 = Math.round(xc - hw);
      const x1 = Math.max(x0, Math.round(xc + hw) - 1);
      for (let x = x0; x <= x1; x++) {
        const left = x === x0;
        const right = x === x1 && x1 > x0;
        const tip = t > 0.86;
        if (lit) {
          if (left || (tip && !right)) pen.set(x, y, left && t > 0.2 ? K.W : K.L);
          continue;
        }
        const u = (x - x0) / Math.max(1, x1 - x0);
        pen.set(x, y, left ? K.L : right ? K.S : tip ? K.L : u < 0.45 ? K.MID : K.D);
      }
    }
  }
  if (lit) return;
  // the jagged ridge the fangs rise from
  for (let x = 3; x < 45; x++) {
    const top = base - 1 - Math.round(2 * hash(x >> 1, 11 + i));
    for (let y = top; y <= base + 1; y++) if (!pen.get(x, y)) pen.set(x, y, y === top ? K.MID : y > base ? K.S : K.D);
  }
}

/**
 * A short slash cut (billboard): a thin lens along the diagonal; forming, full, breaking up.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function cut(pen, i, K) {
  const ax = 1.5, ay = 10, bx = 22.5, by = 1.5;
  const lx = bx - ax, ly = by - ay;
  const L2 = lx * lx + ly * ly;
  const L = Math.sqrt(L2);
  const maxW = [0.9, 1.7, 0.85][i];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 24; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = (px * lx + py * ly) / L2;
      if (t < 0 || t > 1) continue;
      if (i === 0 && (t < 0.22 || t > 0.78)) continue;
      if (i === 2 && Math.floor(t * 9) % 3 === 1) continue;
      const d = Math.abs(px * ly - py * lx) / L;
      const w = maxW * Math.sin(Math.PI * t);
      if (d > w) continue;
      pen.set(x, y, d < w * 0.45 ? K.W : K.L);
    }
  }
}

/**
 * Two fang slashes crossing (billboard): curved strokes tapering at both ends; forming, full,
 * breaking up.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bite(pen, i, K) {
  const strokes = [[5, 4, 27, 28, 1], [27, 4, 5, 28, -1]];
  const w0 = [1.1, 2.0, 1.1][i];
  for (const [x0, y0, x1, y1, side] of strokes) {
    const n = 90;
    const lx = x1 - x0, ly = y1 - y0;
    const L = Math.hypot(lx, ly);
    const nx = (-ly / L) * side, ny = (lx / L) * side;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (i === 0 && t > 0.62) break;
      if (i === 2 && Math.floor(t * 10) % 3 === 2) continue;
      const bulge = 3.2 * Math.sin(Math.PI * t);
      const cx = x0 + lx * t + nx * bulge;
      const cy = y0 + ly * t + ny * bulge;
      const w = w0 * Math.pow(Math.sin(Math.PI * Math.min(1, t * (i === 0 ? 1.6 : 1))), 0.7);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > w + 0.25) continue;
          pen.max(cx + dx, cy + dy, d < w * 0.5 ? K.W : d < w ? K.L : K.MID);
        }
      }
    }
  }
}

/** The rune plate's arc: its centre below the frame (y 79), the plate between these radii. */
const RUNE_ARC = Object.freeze({ cx: 24, cy: 79, rOut: 78.5, rIn: 68, rGlyph: 76.5, spacing: 19.3 });

/**
 * A plate of three runes on an arc (flat; its centre of curvature toward −V, so laid round a
 * circle with +V outward it follows the circle): 0 engraved — a dark plate, its runes a step
 * lighter —, 1 lit — the runes white over a mid plate, its rim light.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function runes(pen, i, K) {
  const A = RUNE_ARC;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = x + 0.5 - A.cx;
      const dy = A.cy - (y + 0.5);
      const r = Math.hypot(dx, dy);
      if (r > A.rOut || r < A.rIn) continue;
      const rim = r > A.rOut - 1 || r < A.rIn + 1;
      // the glyphs, upright along the arc: s along it (px), v down from the glyph line
      const s = Math.atan2(dx, dy) * A.rGlyph;
      const v = A.rGlyph - r;
      let on = false;
      for (let g = 0; g < 3; g++) {
        const u = s - (g - 1) * A.spacing + 3;
        if (u < 0 || u >= 6 || v < 0 || v >= 10) continue;
        const row = RUNES[(g * 2 + 1) % RUNES.length][Math.floor(v / 2)];
        on = row[Math.floor(u / 2)] === '#';
      }
      if (i === 0) pen.set(x, y, on ? K.D : rim ? K.D : K.S);
      else pen.set(x, y, on ? K.W : rim ? K.L : K.D);
    }
  }
}

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'heroGale': gale(pen, i, K); break;
    case 'heroBlade': blade(pen, i, K); break;
    case 'heroCyclone': cyclone(pen, i, K); break;
    case 'heroWave': wave(pen, i, K); break;
    case 'heroSword': sword(pen, i, K); break;
    case 'heroSigil': sigil(pen, K); break;
    case 'heroCrack': crack(pen, K); break;
    case 'heroGaleLit': galeLit(pen, i, K); break;
    case 'heroThrustLit': thrustLit(pen, i, K); break;
    case 'heroWaveLit': waveLit(pen, i, K); break;
    case 'heroFangCrest': crest(pen, i, K, false); break;
    case 'heroFangCrestLit': crest(pen, i, K, true); break;
    case 'heroCut': cut(pen, i, K); break;
    case 'heroBite': bite(pen, i, K); break;
    case 'heroRunes': runes(pen, i, K); break;
    default: break;
  }
}
