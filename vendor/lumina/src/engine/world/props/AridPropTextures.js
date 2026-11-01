import { RNG, hash2, clamp } from '../../utils/math.js';
import { PixelCanvas } from '../../pixel/PixelCanvas.js';
import { _propTextureKit } from './PropTextures.js';

/**
 * AridPropTextures.js — the arid trees' prop textures of Vanquish the Evil Dragon (./AridTrees.js:
 * juniper, deadwood, palm, cypress; docs/contracts/DRAGON_CAMPAIGN.md §6.2): `juniper_bark`,
 * `deadwood`, `bark_charred`, `juniper`, `juniper_charred`, `cypress`, `cypress_leaves`,
 * `palm_trunk`, `palm_fronds`. Part of the set-piece kit's chunk (src/engine/world/SetPieceKit.js),
 * which registers `ARID_PROP_TEXTURES` with `registerPropTextures` (./PropTextures.js) when it
 * loads; a PropTextureSet paints them on first use like its own (seeded the same way). Owner: the
 * arid package.
 */

const { finish } = _propTextureKit;

// ---------------------------------------------------------------------------------------------
// The arid trees (props/Trees.js: juniper, deadwood, palm, cypress; DRAGON_CAMPAIGN.md §6.2)
// ---------------------------------------------------------------------------------------------

/** Ramp lookup with clamping. */
const rr = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
const wrapI = (v, n) => ((v % n) + n) % n;

/**
 * Bark with vertical fibres (16 × 32, 1 × 2 units, seamless): `strips` fibrous strips of varying
 * width separated by dark furrows that wander a little along the height, each strip lit on its
 * left edge and shaded on its right, with cross cracks (`cracks`), pale peeling flecks (`flecks`)
 * and the ramp's tones. Juniper's shaggy bark, sun-bleached dead wood and charred wood are this
 * with different ramps and settings.
 */
function paintFibres(seed, R, { strips = 5, cracks = 0.05, flecks = 0, fleck = null, ember = 0 } = {}) {
  const W = 16;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  pc.wrap = true;
  const hf = new Float32Array(W * H);
  // strip borders along x, each wandering with y (periodic in y)
  const borders = [];
  for (let k = 0; k < strips; k++) borders.push({ x: (k + rng.range(0.15, 0.85)) * (W / strips), a: rng.range(0.6, 1.4), p: rng.range(0, 6.28) });
  const off = (b, y) => Math.sin((y / H) * Math.PI * 2 * 2 + b.p) * b.a;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let dmin = Infinity;
      for (const b of borders) {
        let d = x + 0.5 - (b.x + off(b, y));
        d = wrapI(d + W / 2, W) - W / 2;
        if (Math.abs(d) < Math.abs(dmin)) dmin = d;
      }
      const ad = Math.abs(dmin);
      let k = 3;
      let h = 0.8;
      if (ad < 0.6) { k = 0; h = 0.1; } // the furrow
      else if (ad < 1.4) { k = dmin > 0 ? 4 : 1; h = 0.5; } // the strip's lit left / shaded right edge
      const n = hash2(x, y >> 1, seed) * 0.6 + hash2(x >> 1, y >> 2, seed + 3) * 0.4;
      if (k === 3) k = n > 0.72 ? 4 : n < 0.25 ? 2 : 3;
      if (k >= 2 && hash2(x >> 2, y, seed + 5) < cracks) { k = 1; h = 0.3; } // a cross crack
      pc.set(x, y, rr(R, k));
      hf[y * W + x] = h + n * 0.1;
    }
  }
  for (let n = 0; n < flecks; n++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
    pc.set(x, y, fleck); pc.set(x, y + 1, rr(R, 3));
  }
  for (let n = 0; n < ember; n++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
    if (hf[y * W + x] > 0.2) continue;
    pc.set(x, y, n % 2 ? '#7a2a12' : '#a83c16');
  }
  return finish(pc, hf, { normalStrength: 2.4 });
}

/**
 * A flat pad of foliage for wide billboard cards (32 × 16, 2 × 1 units, alpha): a row of tufts
 * along a flat underside, their tops a lumpy line, lit from the upper left — the top edge bright,
 * the underside in shade, dark gaps where one tuft overlaps the next — with `berries` sprinkled on
 * the lit side (juniper) or holes punched through (`sparse`: burnt).
 */
function paintPad(seed, R, { sparse = 0, berries = null } = {}) {
  const W = 32;
  const H = 16;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H);
  const tufts = [];
  for (let x = 3; x < W - 3; x += rng.range(3.2, 4.6)) {
    const r = rng.range(3, 4.6) * (1 - 0.35 * Math.abs(x - W / 2) / (W / 2));
    tufts.push({ x: x + rng.range(-0.6, 0.6), y: 10.5 - r * 0.45 + rng.range(-0.8, 0.8), r });
  }
  // a second, lower row in front (darker), so the pad has thickness
  for (let x = 6; x < W - 6; x += rng.range(4, 5.5)) tufts.push({ x, y: 12 + rng.range(-0.5, 0.5), r: rng.range(2.4, 3.2), front: true });
  const owner = new Int16Array(W * H).fill(-1);
  tufts.forEach((t, ti) => {
    for (let y = Math.floor(t.y - t.r - 1); y <= t.y + t.r + 1; y++) {
      for (let x = Math.floor(t.x - t.r - 1); x <= t.x + t.r + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H - 1) continue;
        const dx = x + 0.5 - t.x;
        const dy = (y + 0.5 - t.y) * (y + 0.5 > t.y ? 1.6 : 1); // flatter below
        const edge = 1 - 0.22 * hash2(x, y, seed + ti);
        if (dx * dx + dy * dy <= t.r * t.r * edge) owner[y * W + x] = ti;
      }
    }
  });
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && owner[y * W + x] >= 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ti = owner[i];
      if (ti < 0) continue;
      if (sparse && hash2(x >> 1, y, seed + 9) < sparse) { owner[i] = -1; continue; }
      const t = tufts[ti];
      const ly = (y + 0.5 - t.y) / t.r;
      const lx = (x + 0.5 - t.x) / t.r;
      let k = 3.4 - ly * 2.2 - lx * 0.8 - (t.front ? 0.8 : 0) - (y / H) * 1.2;
      // a tuft in front casts a shade on the one behind it
      for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0]]) {
        const xx = x + ox, yy = y + oy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && owner[yy * W + xx] > ti) { k -= 1.2; break; }
      }
      const q = hash2(x, y, seed + 3);
      if (q < 0.14) k += 1; else if (q > 0.9) k -= 1;
      pc.set(x, y, rr(R, Math.round(clamp(k, 1, R.length - 1))));
      hf[i] = 0.4 + (1 - Math.min(1, Math.hypot(lx, ly))) * 0.5;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1) && hash2(x, y, seed + 5) < 0.7) pc.set(x, y, rr(R, R.length - 1)); // the lit top edge
      else if (!solid(x, y + 1)) pc.set(x, y, R[1]); // the shaded underside
    }
  }
  if (berries) {
    for (let k = 0; k < 5; k++) {
      const x = rng.int(2, W - 3), y = rng.int(2, 9);
      if (!solid(x, y) || !solid(x + 1, y + 1)) continue;
      pc.set(x, y, berries[1]); pc.set(x + 1, y + 1, berries[0]);
      if (rng.chance(0.5)) pc.set(x, y - 1, berries[2]);
    }
  }
  return finish(pc, hf, { alpha: true, normalStrength: 1.6, wrap: false });
}

/**
 * A cypress flame for tall billboard cards (16 × 32, 1 × 2 units, alpha): a narrow flame of dense
 * upward tufts — widest low down, a pointed tip at the top —, lit down its left side, its right in
 * shade, the tufts' tips catching the light.
 */
function paintFlameCard(seed, R) {
  const W = 16;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H);
  const half = (y) => {
    const t = y / (H - 1); // 0 top … 1 bottom
    return 7 * Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5), 0.8) * (t > 0.85 ? 1 - (t - 0.85) * 3 : 1);
  };
  const cx = W / 2 + rng.range(-0.4, 0.4);
  for (let y = 0; y < H; y++) {
    const hw = half(y) + (hash2(0, y >> 1, seed) - 0.5) * 1.4;
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      // tufts: upward chevrons in staggered rows of 5 px
      const row = Math.floor(y / 5);
      const u = ((x + (row % 2) * 2) % 4 + 4) % 4;
      const v = y % 5;
      const tuftEdge = v === 0 && u !== 1;
      let k = 4 - (dx / Math.max(1, hw)) * 2 - (y / H) * 1.2;
      if (tuftEdge) k -= 1.4; // the seam between two tufts
      else if (v === 1 && u === 1) k += 1.2; // a tuft's lit tip
      if (Math.abs(dx) > hw - 1) k += dx < 0 ? 1.2 : -1.2; // the silhouette's rim
      const q = hash2(x, y, seed + 4);
      if (q < 0.1) k += 1; else if (q > 0.92) k -= 1;
      pc.set(x, y, rr(R, Math.round(clamp(k, 1, R.length - 1))));
      hf[y * W + x] = 0.4 + (1 - Math.abs(dx) / Math.max(1, hw)) * 0.4 + (tuftEdge ? -0.15 : 0);
    }
  }
  return finish(pc, hf, { alpha: true, normalStrength: 1.8, wrap: false });
}

/**
 * Cypress foliage shell (32 × 32, seamless, alpha at a few gaps): dense upward flames of dark
 * green in staggered rows, lit on their upper-left, a dark seam between rows; it wraps the lathe
 * shells of a cypress's column (like `pine` its cones).
 */
function paintCypressShell(seed) {
  const W = 32;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  pc.wrap = true;
  const hf = new Float32Array(W * H);
  const R = ['#06120e', '#0c1f17', '#132e20', '#1c3f29', '#285335', '#386a42', '#4e8450', '#6ca062'];
  const rows = 4;
  const rh = H / rows;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const row = Math.floor(y / rh);
      const fw = 6;
      const shift = (row % 2) * (fw / 2) + Math.round(hash2(row, 7, seed) * 2);
      const u = wrapI(x + shift, fw);
      const v = (y % rh) / rh; // 0 at a flame's tip row … 1 at its base
      const half = (fw / 2) * (0.35 + 0.65 * v);
      const d = Math.abs(u + 0.5 - fw / 2);
      let k;
      let h;
      if (d > half) { k = 1; h = 0.2; } // between two flames: the shade of the row behind
      else {
        const lit = u + 0.5 < fw / 2;
        k = 3 + (lit ? 2 : 0) + (v < 0.3 ? 1 : 0) - (v > 0.85 ? 1 : 0);
        h = 0.5 + (1 - d / Math.max(0.5, half)) * 0.4;
      }
      const q = hash2(x, y, seed + 2);
      if (q < 0.08) k += 1; else if (q > 0.94) k -= 1;
      pc.set(x, y, rr(R, k));
      hf[y * W + x] = h;
    }
  }
  for (let n = 0; n < 6; n++) {
    const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
    pc.set(x, y, null);
  }
  return finish(pc, hf, { alpha: true, normalStrength: 1.8 });
}

/**
 * Date palm trunk (16 × 16, seamless): the stubs of old frond bases in a diamond lattice, each a
 * rounded scale lit on its upper-left, dark gaps between them, a fibrous brown.
 */
function paintPalmTrunk(seed) {
  const W = 16;
  const H = 16;
  const pc = new PixelCanvas(W, H);
  pc.wrap = true;
  const hf = new Float32Array(W * H);
  const R = ['#1c120c', '#33231a', '#4e3726', '#6a4c34', '#896645', '#a8835a', '#c49e72'];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // a diamond lattice: scale centres at (0, 0), (8, 4) … (period 8 × 8, offset rows)
      const u = wrapI(x - (Math.floor(y / 4) % 2) * 4, 8) - 3.5;
      const v = wrapI(y, 4) - 1.5;
      const d = Math.abs(u) / 4 + Math.abs(v) / 2;
      let k;
      let h;
      if (d > 0.95) { k = 0; h = 0.1; }
      else {
        k = 3 + (u < 0 ? 1 : -1) + (v < 0 ? 1 : 0);
        if (d > 0.75) k -= 1;
        h = 0.9 - d * 0.6;
      }
      if (hash2(x, y, seed) < 0.1) k += 1;
      pc.set(x, y, rr(R, k));
      hf[y * W + x] = h;
    }
  }
  return finish(pc, hf, { normalStrength: 2.4 });
}

/**
 * Palm fronds (64 × 64, alpha): two fronds side by side along v (base at v = 0, tip at v = 1, the
 * canvas bottom is the base) — u 0–0.5 a green one, u 0.5–1 a dead one, dry and brown. Each: a
 * midrib down the middle and stiff leaflets angled toward the tip on both sides, longest at the
 * middle, the upper-left ones lit; transparent between leaflets.
 */
function paintPalmFronds(seed) {
  const W = 64;
  const H = 64;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H);
  const GREEN = ['#0f2214', '#183620', '#24502c', '#356a36', '#4e8842', '#72a650', '#9cc464'];
  const DRY = ['#2a1a10', '#45301c', '#634626', '#836032', '#a37c42', '#c29a58', '#dcbc78'];
  for (const half of [0, 1]) {
    const x0 = half * 32;
    const R = half ? DRY : GREEN;
    const cx = x0 + 15.5;
    // leaflets (from the base at the canvas bottom to the tip at the top)
    for (let y = H - 4; y >= 2; y -= 2) {
      const t = 1 - y / H; // 0 base … 1 tip
      const len = 14 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * rng.range(0.85, 1.05) + 2;
      for (const side of [-1, 1]) {
        if (rng.chance(R === DRY ? 0.18 : 0.06)) continue; // a missing leaflet
        for (let k = 1; k <= len; k++) {
          const x = Math.round(cx + side * k);
          const yy = Math.round(y - k * 0.75); // angled toward the tip
          if (yy < 0 || x < x0 || x >= x0 + 32) break;
          const lit = side < 0;
          let s = (lit ? 4 : 2) + (k > len - 2 ? 1 : 0) + (t > 0.75 ? 1 : 0);
          if (R === DRY && hash2(x, yy, seed) < 0.15) s -= 2;
          pc.set(x, yy, rr(R, s));
          hf[yy * W + x] = 0.6;
          if (k < len * 0.5 && yy + 1 < H) { pc.set(x, yy + 1, rr(R, s - 2)); hf[(yy + 1) * W + x] = 0.45; }
        }
      }
    }
    // the midrib
    for (let y = 0; y < H; y++) {
      const t = 1 - y / H;
      const wdt = t < 0.6 ? 2 : 1;
      for (let o = 0; o < wdt; o++) { pc.set(Math.round(cx) + o, y, rr(R, o ? 3 : 5)); hf[y * W + Math.round(cx) + o] = 0.9; }
    }
  }
  return finish(pc, hf, { alpha: true, normalStrength: 1.6, wrap: false });
}

/** The arid trees' painters, by texture name. */
export const ARID_PROP_TEXTURES = Object.freeze({
  juniper_bark: (seed) => paintFibres(seed, ['#1c1512', '#3a2c24', '#5a4638', '#7a6450', '#9c8670'], { strips: 6, cracks: 0.04, flecks: 10, fleck: '#c2b49c' }),
  deadwood: (seed) => paintFibres(seed, ['#2c2622', '#5c544c', '#8a8076', '#b0a698', '#d4ccbe'], { strips: 4, cracks: 0.08, flecks: 4, fleck: '#ece4d4' }),
  bark_charred: (seed) => paintFibres(seed, ['#070606', '#121010', '#1e1a18', '#2c2622', '#433a34'], { strips: 5, cracks: 0.16, ember: 3 }),
  juniper: (seed) => paintPad(seed, ['#0b1916', '#12261f', '#1a382b', '#254a39', '#335e46', '#477456', '#628c66', '#8aa87e'], { berries: ['#2e3850', '#55648a', '#8494b8'] }),
  juniper_charred: (seed) => paintPad(seed, ['#080606', '#120e0c', '#1c1612', '#2a221c', '#3a3029', '#4e4339', '#6a5e52'], { sparse: 0.32 }),
  cypress: paintCypressShell,
  cypress_leaves: (seed) => paintFlameCard(seed, ['#06120e', '#0b1d16', '#12291e', '#1a3826', '#244a30', '#315e3a', '#437246', '#5e8a56']),
  palm_trunk: paintPalmTrunk,
  palm_fronds: paintPalmFronds,
});
