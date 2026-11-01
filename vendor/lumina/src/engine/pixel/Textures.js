import * as THREE from 'three';
import { PPU } from '../constants.js';
import { clamp, smoothstep, RNG, hash2, hashString, bayer4 } from '../utils/math.js';
import { PixelCanvas, parseColor, mixColor, shadeColor, makePixelTexture, normalMapFromHeight } from './PixelCanvas.js';
import { PALETTE } from './Palette.js';
import { isOwnKey, showValue } from '../utils/own.js';
// (the texture sets of Vanquish the Evil Dragon's packages — ./textures/arid.js, buildings.js — are
// merged into DEFS at run time by the set-piece kit: `registerTextureSet`, src/engine/world/SetPieceKit.js)

/**
 * Textures.js — Luminati's procedural world texture library (2.5D pixel art, inspired by Square Enix's HD-2D games).
 *
 * Every texture is painted texel by texel at 16 px per world unit from the shared PALETTE
 * ramps, with a top-left key light baked subtly into the forms (highlights on upper-left
 * edges, shadows on lower-right). Relief textures paint a height field alongside the color,
 * which is turned into a tangent-space normal map so the pixel art reacts to real lights.
 *
 * Orientation conventions (canvas space, before three's flipY):
 *  - canvas "up" (row 0) = texture v = 1. For terrain tops mapped with world UVs
 *    (u = x, v = -z) canvas up points toward -Z, i.e. away from the default camera, so
 *    grass blades stand "up" on screen.
 *  - Wall / side textures: canvas up = world up.
 *  - Roofs: canvas up = up-slope (toward the ridge); each tile row overlaps the row below it.
 *  - `pine` tiers and `bark` grain run along v; both tile horizontally so they can wrap cylinders/cones.
 *
 * Sizes: most prop/building details are 1×1 unit (16×16 px); large repeating ground surfaces
 * (all terrain tops + plaster) are 4×4 units (64×64 px) and most walls/roofs 2×2 units, to avoid
 * visible repetition. Always read `meta(name).units` to scale world-space UVs
 * (uv = worldPos / units).
 *
 * Layout notes for geometry authors:
 *  - cliff / grass_side (1×1): two irregular rock strata per unit; a half-unit (LEVEL_HEIGHT) vertical
 *    phase shift between faces shows no seam. grass_side = the cliff body with a grass lip in the
 *    top 3–6 px (+ hanging blades); map its v = 1 to the top edge of the face (anchor it per column,
 *    NOT world v), and texture the rest of the face with cliff using world-space v = y.
 *  - stone_wall / stone_brick / well_stone: 8 px block rows (align with LEVEL_HEIGHT too).
 *  - crag (2×2, on demand): tall angular rock pieces split by mostly vertical joints — no strata, so
 *    stacked shelves of it read as one broken rock face.
 *  - timber_frame (2×2): posts straddle the vertical seam and sill/plate straddle the horizontal
 *    seam (2 px each side → 4 px beams when tiled); mid rail at 1 unit; knee braces above,
 *    St Andrew's cross below.
 *  - roofs (2×2): 2 tile rows per unit; canvas up = toward the ridge.
 *  - door (1×2), window (1×1), lantern_glass (1×1), crate/barrel/metal (1×1), sign_board (2×1):
 *    whole-object decals — map 0..1 across the face. barrel hoops sit near v≈0.15 and v≈0.85.
 *  - leaves / leaves_autumn (2×2, alpha): 5 clumps kept inside the canvas (fine on single cards).
 *  - pine (2×2, alpha): 4 drooping tiers of 8 px, tiles horizontally (wrap it around cones).
 *  - fence_wood (1×1, alpha): two posts (x 2–4, 10–12) and two full-width rails → tiles along u.
 *  - flowerbox (1×1, alpha): planter box in the bottom 7 px, flowers above; tiles along u.
 *  - window / lantern_glass have emissive masks (white = glows) for night lighting.
 *  - furniture (on demand): furniture_wood (2×2) boards 8 px wide along u; books / pantry (2 × 0.5)
 *    one shelf compartment, items standing on canvas row 7, tile along u; quilt_* (2×2) 8 px
 *    patches; rug_* (2×2) one diamond per unit; rug_border (1 × 0.5) outer edge on row 0, rows 0–5
 *    used; window_inside (1 × 1.5) one casement, tiles along u; light_beam (1 × 2) a window's light
 *    shaft (rows 0–23) and its floor patch (rows 24–31); embers / window_inside / light_beam are
 *    emissive.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const mod = (a, n) => ((a % n) + n) % n;
/** Ramp lookup with clamping. */
const ri = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
const mix = mixColor;
const OUTLINE = PALETTE.outline;

/** Extend a ramp with one hue-shifted darker and one lighter step. */
function extRamp(R, dark = 0.22, light = 0.16) {
  return [shadeColor(R[0], -dark), ...R.map(parseColor), shadeColor(R[R.length - 1], light)];
}
/** Blend two ramps element-wise (b is index-clamped). */
const blendRamp = (a, b, t) => a.map((c, i) => mix(c, ri(b, i), t));

// Periodic value noise with independent periods on x and y (lattice cells).
function pnoise(x, y, px, py, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = mod(xi, px), x1 = mod(xi + 1, px), y0 = mod(yi, py), y1 = mod(yi + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function pfbm(x, y, px, py, seed, oct = 4, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * pnoise(x * f, y * f, px * f, py * f, seed + o * 131);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Rank-equalise a field in place so its values are uniformly distributed in [0, 1]. */
function equalize(f) {
  const n = f.length;
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => f[a] - f[b]);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[order[k]] = k / (n - 1);
  f.set(out);
  return f;
}

/**
 * Seamless fbm field over a w×h texture with (cx, cy) integer lattice cells across it.
 * Equalised by default so thresholds read as area fractions.
 */
function field(w, h, cx, cy, seed, { oct = 4, gain = 0.5, eq = true } = {}) {
  const f = new Float32Array(w * h);
  cx = Math.max(1, Math.round(cx));
  cy = Math.max(1, Math.round(cy));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[y * w + x] = pfbm(((x + 0.5) / w) * cx, ((y + 0.5) / h) * cy, cx, cy, seed, oct, gain);
  }
  return eq ? equalize(f) : f;
}

/**
 * Jittered-grid Voronoi (periodic when `wrap`). Returns per-pixel nearest cell id, distance
 * to the cell border (`edge`, px; soft-min rounded when `round` > 0), distance to the cell
 * point (`dist`) and the offset from the cell point (`ox`, `oy`).
 */
function voronoi(w, h, cols, rows, seed, { jitter = 0.8, sy = 1, round = 0, wrap = true } = {}) {
  const cw = w / cols, ch = h / rows;
  const n = cols * rows;
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      px[k] = (i + 0.5 + (hash2(i, j, seed) - 0.5) * jitter) * cw;
      py[k] = (j + 0.5 + (hash2(i, j, seed + 7) - 0.5) * jitter) * ch;
    }
  }
  const N = w * h;
  const id = new Int32Array(N), edge = new Float32Array(N), dist = new Float32Array(N);
  const ox = new Float32Array(N), oy = new Float32Array(N);
  const cx = new Float32Array(25), cy = new Float32Array(25), ck = new Int32Array(25);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const ci = Math.floor(X / cw), cj = Math.floor(Y / ch);
      let m = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const ii = ci + di, jj = cj + dj;
          if (!wrap && (ii < 0 || jj < 0 || ii >= cols || jj >= rows)) continue;
          const mi = mod(ii, cols), mj = mod(jj, rows);
          const k = mj * cols + mi;
          cx[m] = px[k] + ((ii - mi) / cols) * w;
          cy[m] = (py[k] + ((jj - mj) / rows) * h) * sy;
          ck[m] = k;
          m++;
        }
      }
      const Ys = Y * sy;
      let best = 0, bd = Infinity;
      for (let q = 0; q < m; q++) {
        const dx = X - cx[q], dy = Ys - cy[q];
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = q; }
      }
      const bx = cx[best], by = cy[best];
      let e = Infinity, e2 = Infinity;
      for (let q = 0; q < m; q++) {
        if (q === best) continue;
        const dx = cx[q] - bx, dy = cy[q] - by;
        const len = Math.hypot(dx, dy) || 1e-6;
        const dd = -((X - (bx + cx[q]) / 2) * dx + (Ys - (by + cy[q]) / 2) * dy) / len;
        if (dd < e) { e2 = e; e = dd; } else if (dd < e2) e2 = dd;
      }
      const i = y * w + x;
      id[i] = ck[best];
      // polynomial smooth-min of the two nearest borders → rounded corners
      if (round > 0) {
        const k = round * 2;
        const hh = Math.max(k - Math.abs(e - e2), 0) / k;
        e = Math.min(e, e2) - hh * hh * k * 0.25;
      }
      edge[i] = e;
      dist[i] = Math.sqrt(bd);
      ox[i] = X - bx;
      oy[i] = (Ys - by) / sy;
    }
  }
  return { id, edge, dist, ox, oy, count: n, px, py, cols, rows };
}

/** Split `total` into widths within [minW, maxW] that sum exactly to total. */
function splitWidths(total, minW, maxW, rng) {
  const out = [];
  let rem = total;
  while (rem > 0) {
    if (rem <= maxW) {
      if (rem < minW && out.length) out[out.length - 1] += rem;
      else out.push(rem);
      break;
    }
    const bw = rng.int(minW, Math.min(maxW, rem - minW));
    out.push(bw);
    rem -= bw;
  }
  return out;
}

const jointsOf = (widths, off, w) => {
  const j = [];
  let x = off;
  for (const bw of widths) { j.push(mod(x, w)); x += bw; }
  return j;
};
function minJointDist(a, b, w) {
  let m = Infinity;
  for (const p of a) for (const q of b) { const d = Math.abs(p - q); m = Math.min(m, d, w - d); }
  return m;
}

/** Rows of blocks in running bond (joints of consecutive rows kept apart). */
function bondRows(w, heights, minW, maxW, rng, { widths = null } = {}) {
  const rows = [];
  let y = 0;
  let prev = null;
  for (const rh of heights) {
    const ws = widths ? widths.slice() : splitWidths(w, minW, maxW, rng);
    let bestOff = 0, bestScore = -1;
    for (let t = 0; t < 16; t++) {
      const off = rng.int(0, w - 1);
      const score = prev ? minJointDist(jointsOf(ws, off, w), prev, w) : 99;
      if (score > bestScore) { bestScore = score; bestOff = off; }
      if (score >= Math.min(minW, 6) * 0.5) break;
    }
    rows.push({ y, h: rh, widths: ws, offset: bestOff });
    prev = jointsOf(ws, bestOff, w);
    y += rh;
  }
  return rows;
}

/**
 * Rasterise block rows into an id map + inner distance (px from the block border, 0.5 at the
 * border pixel). Each block reserves `gap` px at its right and bottom for mortar.
 * `corner(block)` may return per-corner rounding radii [tl, tr, bl, br].
 */
function layoutBlocks(w, h, rows, { gap = 1, corner = null } = {}) {
  const N = w * h;
  const id = new Int32Array(N).fill(-1);
  const dist = new Float32Array(N);
  const blocks = [];
  for (const row of rows) {
    let x = row.offset;
    for (const bw of row.widths) {
      const b = { x, y: row.y, w: bw, h: row.h, index: blocks.length };
      blocks.push(b);
      const iw = bw - gap, ih = row.h - gap;
      const rr = corner ? corner(b) : [0, 0, 0, 0];
      for (let v = 0; v < ih; v++) {
        for (let u = 0; u < iw; u++) {
          const fx = u + 0.5, fy = v + 0.5;
          let d = Math.min(fx, fy, iw - fx, ih - fy);
          const left = fx < iw / 2, top = fy < ih / 2;
          const r = rr[(top ? 0 : 2) + (left ? 0 : 1)];
          if (r > 0) {
            const ccx = left ? r : iw - r, ccy = top ? r : ih - r;
            if ((left ? fx < ccx : fx > ccx) && (top ? fy < ccy : fy > ccy)) {
              const e = Math.hypot(fx - ccx, fy - ccy);
              if (e > r) continue;
              d = Math.min(d, r - e + 0.5);
            }
          }
          const i = mod(row.y + v, h) * w + mod(x + u, w);
          id[i] = b.index;
          dist[i] = d;
        }
      }
      x += bw;
    }
  }
  return { id, dist, blocks };
}

/** Quantise a light response into ramp steps. */
const stepOf = (v, t1 = 0.3, t2 = 1.0) => (v > t2 ? 2 : v > t1 ? 1 : v < -t2 ? -2 : v < -t1 ? -1 : 0);

// ---------------------------------------------------------------------------
// Surf — a color canvas + height field painted together
// ---------------------------------------------------------------------------

class Surf {
  constructor(w, h, wrap = true) {
    this.w = w;
    this.h = h;
    this.wrap = wrap;
    this.pc = new PixelCanvas(w, h);
    this.pc.wrap = wrap;
    this.hf = new Float32Array(w * h);
    this.em = null;
  }
  ix(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.wrap) { x = mod(x, this.w); y = mod(y, this.h); }
    else if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }
  H(x, y) { const i = this.ix(x, y); return i < 0 ? 0 : this.hf[i]; }
  setH(x, y, v) { const i = this.ix(x, y); if (i >= 0) this.hf[i] = v; }
  set(x, y, c) { this.pc.set(x, y, c); return this; }
  get(x, y) { return this.pc.get(x, y); }
  A(x, y) { return this.pc.getAlpha(x, y); }
  /** Light response from the height field: > 0 faces the top-left key light. */
  slope(x, y) { return (this.H(x + 1, y) - this.H(x - 1, y)) * 0.9 + (this.H(x, y + 1) - this.H(x, y - 1)); }
  each(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y, y * this.w + x);
  }
  /** Darken/lighten an existing pixel toward a color. */
  tint(x, y, c, t) { this.pc.set(x, y, mix(this.pc.get(x, y), c, t)); }
  emissive() {
    if (!this.em) { this.em = new PixelCanvas(this.w, this.h, '#000000'); this.em.wrap = this.wrap; }
    return this.em;
  }
}

// ---------------------------------------------------------------------------
// Shared painting motifs
// ---------------------------------------------------------------------------

/** A seeded random walk crack. Stays inside `idMap === idv` when an id map is given. */
function crack(s, x, y, len, rng, { dark, light = null, idMap = null, idv = -1, depth = 0.3 }) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let d = rng.int(0, 7);
  const path = [];
  for (let k = 0; k < len; k++) {
    const i = s.ix(x, y);
    if (i < 0 || (idMap && idMap[i] !== idv)) break;
    path.push([x, y]);
    const r = rng.next();
    const dd = r < 0.55 ? 0 : r < 0.78 ? 1 : -1;
    const [dx, dy] = dirs[mod(d + dd, 8)];
    x += dx; y += dy;
  }
  if (light) {
    for (const [px, py] of path) {
      const i = s.ix(px + 1, py + 1);
      if (i >= 0 && (!idMap || idMap[i] === idv)) s.set(px + 1, py + 1, light);
    }
  }
  for (const [px, py] of path) { s.set(px, py, dark); s.setH(px, py, s.H(px, py) - depth); }
  return path;
}

const PEBBLE_SHAPES = [
  ['X'],
  ['XX'],
  ['XX', 'XX'],
  ['XXX', 'XX.'],
  ['.XX', 'XXX', '.X.'],
  ['.XX.', 'XXXX', '.XX.'],
  ['XXX', 'XXX'],
];

/** Draw a small shaded pebble with a cast shadow toward the lower right. */
function pebble(s, x, y, shape, R, base, shadow, { h = 0.8, spec = null } = {}) {
  const rows = PEBBLE_SHAPES[shape];
  const inside = (u, v) => v >= 0 && v < rows.length && u >= 0 && u < rows[v].length && rows[v][u] === 'X';
  if (shadow) {
    for (let v = 0; v <= rows.length; v++) {
      for (let u = 0; u <= rows[0].length; u++) {
        if (!inside(u, v) && inside(u - 1, v - 1)) s.set(x + u, y + v, shadow);
        else if (!inside(u, v) && inside(u - 1, v) && v === rows.length - 1) s.set(x + u, y + v, shadow);
      }
    }
  }
  let first = true;
  for (let v = 0; v < rows.length; v++) {
    for (let u = 0; u < rows[v].length; u++) {
      if (!inside(u, v)) continue;
      const tl = !inside(u - 1, v) || !inside(u, v - 1);
      const br = !inside(u + 1, v) || !inside(u, v + 1);
      let k = base;
      if (tl && !br) k += 1;
      else if (br && !tl) k -= 1;
      if (first && rows.length > 1) { k = base + 1; }
      first = false;
      s.set(x + u, y + v, ri(R, k));
      s.setH(x + u, y + v, h * (tl && br ? 0.8 : 1));
    }
  }
  if (spec) {
    const u0 = rows[0].indexOf('X');
    s.set(x + u0, y, spec);
  }
}

const FLOWER_COLORS = {
  white: { petal: '#f4f1e4', shade: '#b9bccb', center: '#f2cf52' },
  yellow: { petal: '#f7dc5a', shade: '#c98f24', center: '#fff4b0' },
  pink: { petal: '#f5a9c2', shade: '#c9607f', center: '#fff0c8' },
  blue: { petal: '#9bb8f2', shade: '#5570bf', center: '#eef0ff' },
  red: { petal: '#e8504a', shade: '#8c2330', center: '#f7d06a' },
  purple: { petal: '#b98ad6', shade: '#6b3f8c', center: '#f5e2a0' },
};

/** Tiny 1–5 px flower with a leaf-shadow below-right. kind: 0 dot, 1 pair, 2 plus. */
function flower(s, x, y, colors, kind, shadow) {
  if (shadow) s.set(x + 1, y + 1, shadow);
  if (kind === 0) {
    s.set(x, y, colors.petal);
  } else if (kind === 1) {
    if (shadow) s.set(x + 2, y + 1, shadow);
    s.set(x, y, colors.petal);
    s.set(x + 1, y, colors.shade);
  } else {
    if (shadow) { s.set(x + 1, y + 2, shadow); s.set(x + 2, y + 1, shadow); }
    s.set(x, y - 1, colors.petal);
    s.set(x - 1, y, colors.petal);
    s.set(x + 1, y, colors.shade);
    s.set(x, y + 1, colors.shade);
    s.set(x, y, colors.center);
  }
  s.setH(x, y, 0.9);
}

// ---------------------------------------------------------------------------
// Terrain tops
// ---------------------------------------------------------------------------

const GRASS_DARK_RAMP = ['#12231d', '#1a3327', '#264b2f', '#386636', '#52833d', '#7da64c'];

/** Ramp with midpoints inserted between neighbouring colours (n → 2n-1 steps). */
function halfRamp(R) {
  const out = [];
  for (let i = 0; i < R.length; i++) {
    out.push(parseColor(R[i]));
    if (i < R.length - 1) out.push(mix(R[i], R[i + 1], 0.5));
  }
  return out;
}

/** Quantise a field into integer levels: base + number of thresholds exceeded. */
function quantize(A, thresholds, base = 0) {
  const lv = new Int8Array(A.length);
  for (let i = 0; i < A.length; i++) {
    let L = base;
    for (const t of thresholds) if (A[i] >= t) L++;
    lv[i] = L;
  }
  return lv;
}

/**
 * 1 px emboss of a level map lit from the top-left: +1 on the upper-left rim of raised
 * ground, -1 in the shadow just below/right of higher ground, else 0.
 */
function emboss(lv, w, h, x, y) {
  const L = lv[y * w + x];
  const up = lv[mod(y - 1, h) * w + x];
  const left = lv[y * w + mod(x - 1, w)];
  if (up > L || left > L) return -1;
  if (up < L || left < L) return 1;
  return 0;
}

function genGrass(s, ctx, o = {}) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  // Half-step ramp (palette colours at even indices, midpoints between) → subtle patches,
  // while tufts still jump a full palette step.
  const G = halfRamp((o.ramp ?? PALETTE.grass).map(parseColor));
  const warm = halfRamp(blendRamp((o.ramp ?? PALETTE.grass).map(parseColor), PALETTE.grassDry, o.warm ?? 0.24));
  const A = field(w, h, w / 16, h / 16, seed + 1, { oct: 3, gain: 0.45 });
  const B = field(w, h, w / 32, h / 32, seed + 2, { oct: 2 });
  for (let i = 0; i < A.length; i++) A[i] += (hash2(i % w, (i / w) | 0, seed + 9) - 0.5) * 0.07; // ragged grassy borders
  const lv = quantize(A, o.levels ?? [0.12, 0.45, 0.8], 3);
  const pal = new Uint8Array(w * h);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    const q = hash2(x, y, seed);
    const k = lv[i] + (e > 0 ? (q < 0.5 ? 1 : 0) : e < 0 ? (q < 0.45 ? -1 : 0) : 0);
    const warmT = smoothstep(0.7, 0.78, B[i]);
    pal[i] = warmT > 0.5 ? 1 : 0;
    let c = ri(G, k);
    if (warmT > 0) c = mix(c, ri(warm, k), warmT > 0.99 ? 1 : 0.5);
    s.set(x, y, c);
    s.hf[i] = 0.1 + lv[i] * 0.05 + e * 0.03;
  });

  // Blade tufts on a jittered grid (even but organic density).
  const cell = o.cell ?? 6;
  const nx = Math.max(1, Math.round(w / cell)), ny = Math.max(1, Math.round(h / cell));
  const tufts = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!rng.chance(o.density ?? 0.8)) continue;
      const r = rng.next();
      tufts.push({ x: Math.floor(((i + rng.next()) * w) / nx), y: Math.floor(((j + rng.next()) * h) / ny), n: r < 0.12 ? 1 : r < 0.4 ? 2 : r < 0.82 ? 3 : 4, tall: rng.chance(0.3) });
    }
  }
  tufts.sort((a, b) => a.y - b.y);
  for (const t of tufts) {
    const i0 = s.ix(t.x, t.y);
    const L = lv[i0];
    const P = pal[i0] ? warm : G;
    const first = -Math.floor((t.n - 1) / 2);
    // grounded shadow under the tuft
    for (let dx = first - 1; dx <= first + t.n - 1; dx++) s.set(t.x + dx + 1, t.y + 1, ri(P, L - 2));
    s.set(t.x + first + t.n, t.y, ri(P, L - 2));
    for (let b = 0; b < t.n; b++) {
      const dx0 = first + b;
      const lean = dx0 < 0 ? -1 : dx0 > 0 ? 1 : t.n === 1 ? (rng.chance(0.5) ? 1 : -1) : rng.chance(0.25) ? (rng.chance(0.5) ? 1 : -1) : 0;
      const len = Math.max(2, (dx0 === 0 ? 3 : 2) + (t.tall ? 1 : 0) - (rng.chance(0.25) ? 1 : 0));
      const tip = L >= 6 ? (rng.chance(0.35) ? L + 3 : L + 2) : L + (rng.chance(0.5) ? 4 : 3);
      for (let k = 0; k < len; k++) {
        const x = t.x + dx0 + lean * Math.floor((k + 1) / 2);
        const y = t.y - k;
        s.set(x, y, ri(P, Math.min(10, k === len - 1 ? tip : L + 2)));
        s.setH(x, y, 0.5 + k * 0.12);
      }
    }
  }

  // Sparse lit leaf specks between tufts.
  for (let n = 0; n < (w * h) / 40; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const i = s.ix(x, y);
    if (s.hf[i] > 0.45) continue;
    const P = pal[i] ? warm : G;
    s.set(x, y, ri(P, lv[i] + 2));
    s.set(x + 1, y + 1, ri(P, lv[i] - 2));
  }

  // Flowers in little groups.
  if (o.flowers) {
    const kinds = ['white', 'yellow', 'pink', 'white', 'yellow', 'blue'];
    for (let g = 0; g < o.flowers; g++) {
      const cx = rng.int(0, w - 1), cy = rng.int(0, h - 1);
      const col = FLOWER_COLORS[kinds[g % kinds.length]];
      const n = rng.int(3, 6);
      for (let f = 0; f < n; f++) {
        const fx = Math.round(cx + rng.gaussian() * 2.6), fy = Math.round(cy + rng.gaussian() * 2.0);
        const i = s.ix(fx, fy);
        flower(s, fx, fy, col, rng.chance(0.25) ? 2 : rng.chance(0.4) ? 1 : 0, ri(G, lv[i] - 2));
      }
    }
  }
  return { normal: o.normal ?? 1.4 };
}

function genDirt(s, ctx, o = {}) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const D = extRamp(o.ramp ?? PALETTE.dirt, 0.15, 0.08); // 8 steps
  const base = (o.base ?? 3) + 1;
  const A = field(w, h, w / 16, h / 16, seed + 1, { oct: 3, gain: 0.5 });
  const lv = quantize(A, [0.3, 0.86], base - 1);
  const DW = blendRamp(D, PALETTE.dirt.map((c) => shadeColor(c, 0.05)), 0.5);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e < 0 ? -1 : e > 0 && hash2(x, y, seed) < 0.6 ? 1 : 0);
    s.set(x, y, ri(DW, k));
    s.hf[i] = 0.3 + lv[i] * 0.06 + e * 0.05;
  });
  // Crumbs: small clods lit on the upper-left with a shadow below-right.
  const cv = voronoi(w, h, Math.round(w / 5), Math.round(h / 5), seed + 12, { jitter: 0.9 });
  s.each((x, y, i) => {
    const d = cv.dist[i];
    if (d > 1.6 || hash2(cv.id[i], 1, seed) < 0.35) return;
    const L = lv[i];
    const lit = cv.ox[i] + cv.oy[i] < 0;
    s.set(x, y, ri(DW, L + (lit ? 1 : 0)));
    s.hf[i] = 0.5;
    if (!lit) s.set(x + 1, y + 1, ri(DW, L - 1));
  });

  // Ruts / scuffs: shallow elongated grooves with a lit far wall.
  for (let r = 0; r < (o.ruts ?? 0); r++) {
    const horiz = rng.chance(0.6);
    const len = rng.int(6, 12);
    let x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    for (let k = 0; k < len; k++) {
      const px = horiz ? x + k : x, py = horiz ? y : y + k;
      const L = lv[s.ix(px, py)];
      s.set(px, py, ri(D, L - 1));
      s.setH(px, py, 0.15);
      if (horiz) s.set(px, py + 1, ri(D, L + 1)); else s.set(px + 1, py, ri(D, L + 1));
      if (rng.chance(0.2)) { if (horiz) y += rng.chance(0.5) ? 1 : -1; else x += rng.chance(0.5) ? 1 : -1; }
    }
  }
  for (let c = 0; c < (o.cracks ?? 2); c++) crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(3, 6), rng, { dark: D[base - 2], light: D[base + 1], depth: 0.2 });

  // Pebbles (mostly warm stone), each with highlight, body, shade and a cast shadow.
  const nPeb = o.pebbles ?? Math.round((w * h) / 200);
  for (let p = 0; p < nPeb; p++) {
    const shape = rng.chance(0.4) ? rng.int(0, 1) : rng.int(2, 6);
    const R = rng.chance(0.25) ? STONE_COOL : STONE_WARM;
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    pebble(s, x, y, shape, R, rng.int(4, 5), ri(D, lv[s.ix(x, y)] - 2));
  }
  for (let g = 0; g < (o.sprigs ?? 0); g++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y + 1, D[base - 2]);
    s.set(x + 1, y + 1, D[base - 1]);
    s.set(x, y, PALETTE.grass[3]);
    s.set(x + 1, y - 1, PALETTE.grass[4]);
    if (rng.chance(0.6)) s.set(x - 1, y - 1, PALETTE.grass[3]);
  }
  return { normal: 1.6 };
}

function genSand(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = extRamp(PALETTE.sand, 0.2, 0.08); // 7 steps
  const A = field(w, h, 4, 4, seed + 1, { oct: 3, gain: 0.45 });
  const M = field(w, h, 2, 2, seed + 5, { oct: 3 });
  const lv = quantize(A, [0.35, 0.9], 3);
  const wave = new Float32Array(w);
  for (let x = 0; x < w; x++) wave[x] = pfbm((x / w) * 4, 0.5, 4, 1, seed + 9, 3) * 9;
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e > 0 && hash2(x, y, seed) < 0.5 ? 1 : e < 0 && hash2(x, y, seed) < 0.4 ? -1 : 0);
    let hh = 0.35 + lv[i] * 0.05;
    // wind ripples: a lit crest line + soft lee shadow, faded in and out by M
    if (M[i] > 0.3) {
      const crest = Math.floor(mod(y + Math.round(wave[x]), 8));
      if (crest === 0) { k += 1; hh += 0.1; }
      else if (crest === 1 && hash2(x, y, seed + 3) < 0.55) k -= 1;
    }
    if (hash2(x, y, seed + 4) < 0.012) k += 2;
    else if (hash2(x, y, seed + 5) < 0.008) k -= 2;
    s.set(x, y, ri(S, k));
    s.hf[i] = hh;
  });
  for (let p = 0; p < 6; p++) pebble(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(0, 4), STONE_WARM, 5, S[2]);
  for (let p = 0; p < 3; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, '#f4ece0'); s.set(x + 1, y, '#e8c9b8'); s.set(x + 1, y + 1, S[2]); s.set(x + 2, y + 1, S[2]);
  }
  return { normal: 1.3 };
}

function genFarmland(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const D = ['#1d130f', '#2e1f17', '#45301f', '#5d4029', '#785335', '#936843', '#ae8255'].map(parseColor);
  const period = 8;
  const A = field(w, h, 4, 4, seed + 1, { oct: 2 });
  const wob = new Float32Array(w);
  for (let x = 0; x < w; x++) wob[x] = (pfbm((x / w) * 3, 0.5, 3, 1, seed + 3, 2) - 0.5) * 2.4;
  s.each((x, y, i) => {
    const ph = mod(y + wob[x], period);
    // ridge crest at ph≈2, furrow bottom at ph≈6
    s.hf[i] = 0.5 + 0.5 * Math.cos(((ph - 2) / period) * Math.PI * 2);
  });
  s.each((x, y, i) => {
    const ph = mod(y + wob[x], period);
    let k;
    if (ph < 1) k = 4; // ridge back, facing the light
    else if (ph < 2) k = 5; // lit crest
    else if (ph < 3.5) k = 4;
    else if (ph < 4.5) k = 3;
    else if (ph < 6) k = 2; // lee slope
    else if (ph < 7) k = 1; // furrow bottom
    else k = 2;
    if (A[i] > 0.85 && k >= 3) k += 1;
    const r = hash2(x, y, seed + 6);
    if (k >= 3 && r < 0.06) k += 1; else if (r > 0.95) k -= 1;
    s.set(x, y, ri(D, k));
  });
  // Clods on the crests.
  for (let c = 0; c < 26; c++) {
    const x = rng.int(0, w - 1);
    const row = rng.int(0, h / period - 1);
    const y = Math.round(row * period + 1 - wob[x]);
    pebble(s, x, y, rng.int(0, 2), D, 5, D[2], { h: 0.9 });
  }
  // Rows of young sprouts, in patches.
  const S = field(w, h, 2, 2, seed + 8, { oct: 2 });
  for (let row = 0; row < h / period; row++) {
    for (let x = rng.int(0, 2); x < w; x += rng.int(3, 4)) {
      const y = Math.round(row * period + 2 - wob[x]);
      if (S[s.ix(x, y)] < 0.45) continue;
      s.set(x + 1, y + 1, D[1]);
      s.set(x, y + 1, D[2]);
      s.set(x, y, PALETTE.grass[3]);
      s.set(x - 1, y - 1, PALETTE.grass[4]);
      s.set(x + 1, y - 1, PALETTE.grass[3]);
      if (rng.chance(0.5)) s.set(x, y - 2, PALETTE.grass[5]);
      s.setH(x, y, 0.9);
    }
  }
  return { normal: 1.8 };
}

const STONE_COOL = extRamp(PALETTE.stone, 0.15, 0.08);
const STONE_WARM = extRamp(PALETTE.stoneWarm, 0.15, 0.08);
const COBBLE_WARM = blendRamp(STONE_WARM, STONE_COOL, 0.2);
const COBBLE_COOL = blendRamp(STONE_COOL, STONE_WARM, 0.4);

/**
 * Voronoi stones (cobbles, pebbles, rubble): rounded bevelled stones with dark gaps.
 * info(k) → { R, base } per stone.
 */
function paintVoronoiStones(s, v, info, { gap = 0.9, bevel = 2.6, dome = 0.25, rough = 0.1, fine = null, gapColor, t1 = 0.28, t2 = 1.0, maxUp = 2, maxDown = -2, seed = 0 }) {
  const { w, h } = s;
  const N = field(w, h, w / 4, h / 4, seed + 77, { oct: 2 });
  const ids = new Int32Array(w * h);
  s.each((x, y, i) => {
    const e = v.edge[i];
    if (e < gap) { ids[i] = -1; s.hf[i] = 0; return; }
    ids[i] = v.id[i];
    const st = info(v.id[i]);
    const r = Math.max(2, st.r ?? 3);
    s.hf[i] = 0.25 + 0.75 * smoothstep(gap - 0.3, gap + bevel, e) * (st.bump ?? 1) + dome * clamp(1 - v.dist[i] / (r * 2)) + (N[i] - 0.5) * rough;
  });
  s.each((x, y, i) => {
    const id = ids[i];
    if (id < 0) {
      // Mortar / soil: darker where a stone sits above-left (cast shadow).
      const shade = ids[s.ix(x - 1, y)] >= 0 || ids[s.ix(x, y - 1)] >= 0 ? 1 : 0;
      s.set(x, y, gapColor(x, y, shade));
      return;
    }
    const st = info(id);
    let k = clamp(stepOf(s.slope(x, y), t1, t2), maxDown, maxUp);
    if (fine) k += fine(x, y, i, st, N[i]);
    s.set(x, y, ri(st.R, st.base + k));
  });
  return ids;
}

function genCobblestone(s, ctx, o = {}) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, o.cols ?? 10, o.rows ?? 10, seed + 11, { jitter: 0.72, round: 1.2 });
  const stones = [];
  for (let k = 0; k < v.count; k++) {
    const warm = rng.chance(0.5);
    stones.push({ R: warm ? COBBLE_WARM : COBBLE_COOL, base: rng.pick([3, 4, 4, 4, 5]), bump: rng.range(0.85, 1.05), r: 3 });
  }
  const M = field(w, h, 2, 2, seed + 21, { oct: 3 });
  const D = PALETTE.dirt;
  const ids = paintVoronoiStones(s, v, (k) => stones[k], {
    seed,
    gap: 0.55,
    bevel: 2.2,
    maxDown: -1,
    fine: (x, y, i, st, n) => (n > 0.93 ? 1 : n < 0.06 ? -1 : 0),
    gapColor: (x, y, shade) => {
      const m = M[s.ix(x, y)];
      if (m > 0.72 && !shade) return (x + y) & 1 ? PALETTE.moss[2] : PALETTE.moss[1];
      return shade ? D[1] : (hash2(x, y, seed) < 0.3 ? D[3] : D[2]);
    },
  });
  // Cracks in a few stones, moss creeping on stones in mossy zones.
  for (let k = 0; k < v.count; k++) {
    if (!rng.chance(0.14)) continue;
    const cx = Math.floor(v.px[k]), cy = Math.floor(v.py[k]);
    crack(s, cx, cy, rng.int(2, 4), rng, { dark: ri(stones[k].R, stones[k].base - 2), light: ri(stones[k].R, stones[k].base + 1), idMap: ids, idv: k });
  }
  s.each((x, y, i) => {
    if (ids[i] < 0 || M[i] < 0.8) return;
    const nearGap = ids[s.ix(x + 1, y)] < 0 || ids[s.ix(x, y + 1)] < 0 || ids[s.ix(x - 1, y)] < 0;
    if (nearGap && hash2(x, y, seed + 3) < 0.7) s.set(x, y, hash2(x, y, seed + 4) < 0.3 ? PALETTE.moss[3] : PALETTE.moss[2]);
  });
  return { normal: 2.4 };
}

function genStoneTiles(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rows = bondRows(w, [14, 18, 15, 17], 13, 24, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0, 1, 2, 3].map(() => (rng.chance(0.25) ? rng.range(1.5, 3) : rng.range(0.6, 1.2))) });
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  const info = L.blocks.map(() => {
    const warm = rng.chance(0.6);
    return { R: warm ? COBBLE_WARM : COBBLE_COOL, base: rng.pick([4, 4, 4, 5, 3]), tilt: rng.range(-0.08, 0.08) };
  });
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) { s.hf[i] = 0; return; }
    const d = L.dist[i];
    s.hf[i] = 0.3 + 0.7 * smoothstep(0, 1.8, d) + (N[i] - 0.5) * 0.1;
  });
  const M = field(w, h, 2, 2, seed + 9, { oct: 3 });
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) {
      const sh = L.id[s.ix(x - 1, y)] >= 0 || L.id[s.ix(x, y - 1)] >= 0;
      const moss = M[i] > 0.78;
      s.set(x, y, moss ? (sh ? PALETTE.moss[1] : PALETTE.moss[2]) : sh ? STONE_COOL[1] : STONE_COOL[2]);
      return;
    }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.3, 1.1), -1, 2);
    if (N[i] > 0.94) k += 1; else if (N[i] < 0.05) k -= 1;
    // subtle wear gradient per stone
    const blk = L.blocks[b];
    const fy = mod(y - blk.y, h) / blk.h;
    if (fy > 0.75 && hash2(x, y, seed) < 0.25) k -= 1;
    s.set(x, y, ri(st.R, st.base + k));
  });
  for (const b of L.blocks) {
    if (rng.chance(0.3)) {
      const x = b.x + rng.int(2, b.w - 4), y = b.y + rng.int(2, b.h - 4);
      const st = info[b.index];
      crack(s, x, y, rng.int(4, 8), rng, { dark: ri(st.R, st.base - 2), light: ri(st.R, st.base + 1), idMap: L.id, idv: b.index });
    }
    if (rng.chance(0.35)) {
      // pits / chisel dots
      const st = info[b.index];
      for (let p = 0; p < 3; p++) {
        const x = b.x + rng.int(2, b.w - 3), y = b.y + rng.int(2, b.h - 3);
        if (L.id[s.ix(x, y)] !== b.index) continue;
        s.set(x, y, ri(st.R, st.base - 1));
        s.set(x + 1, y + 1, ri(st.R, st.base + 1));
      }
    }
  }
  return { normal: 2.2 };
}

function genMossStone(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 7, 7, seed + 13, { jitter: 0.8, round: 1.6 });
  const stones = [];
  for (let k = 0; k < v.count; k++) stones.push({ R: rng.chance(0.6) ? STONE_COOL : STONE_WARM, base: rng.pick([2, 3, 3, 4]), bump: rng.range(0.9, 1.1), r: 4.5 });
  const MZ = field(w, h, 3, 3, seed + 5);
  const MF = voronoi(w, h, 22, 22, seed + 6, { jitter: 0.9 });
  const MO = extRamp(PALETTE.moss, 0.15, 0.1).concat([parseColor(PALETTE.grass[4])]);
  const ids = paintVoronoiStones(s, v, (k) => stones[k], {
    seed, gap: 0.6, bevel: 3.0, dome: 0.35,
    gapColor: (x, y, shade) => (shade ? '#15201b' : hash2(x, y, seed) < 0.5 ? MO[1] : MO[2]),
  });
  // Moss: fluffy tufts (small Voronoi cells) covering high zones, thicker on stone tops.
  s.each((x, y, i) => {
    const m = MZ[i] + (ids[i] < 0 ? 0.12 : 0) + (s.hf[i] - 0.6) * 0.1;
    if (m < 0.52) return;
    const e = MF.edge[i];
    const lit = MF.ox[i] + MF.oy[i] < -0.8;
    const dark = MF.ox[i] + MF.oy[i] > 1.2 || e < 0.5;
    let k = m > 0.8 ? 3 : 2;
    if (lit) k += 1;
    if (dark) k -= 1;
    if (m < 0.56 && hash2(x, y, seed + 2) < 0.5) return; // ragged border
    s.set(x, y, ri(MO, k));
    s.hf[i] = Math.max(s.hf[i], 0.7 + (lit ? 0.15 : 0) - (dark ? 0.15 : 0));
  });
  // A few lit moss sprigs.
  for (let p = 0; p < 30; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (MZ[s.ix(x, y)] < 0.6) continue;
    s.set(x, y, MO[5]); s.set(x + 1, y + 1, MO[1]);
  }
  return { normal: 2.2 };
}

function genRiverbed(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 12, 12, seed + 17, { jitter: 0.9, round: 1.0 });
  const tints = [
    extRamp(['#1b1f26', '#2a313a', '#3d4650', '#56626a', '#7b8b8c']),
    extRamp(['#231c1a', '#3a2d27', '#554236', '#735c48', '#91795c']),
    extRamp(['#172321', '#223532', '#314d44', '#46685a', '#628a72']),
  ];
  const stones = [];
  for (let k = 0; k < v.count; k++) stones.push({ R: tints[rng.chance(0.5) ? 0 : rng.chance(0.6) ? 1 : 2], base: rng.pick([2, 3, 3, 4]), bump: rng.range(0.7, 1.05), r: 2.5 });
  const silt = ['#0f1419', '#172027', '#1f2a31'];
  const ids = paintVoronoiStones(s, v, (k) => stones[k], {
    seed, gap: 0.5, bevel: 1.8, dome: 0.3, maxDown: -1,
    gapColor: (x, y, shade) => silt[shade ? 0 : hash2(x, y, seed) < 0.4 ? 2 : 1],
  });
  // Wet specular glints on the upper-left of each pebble.
  for (let k = 0; k < v.count; k++) {
    if (!rng.chance(0.75)) continue;
    const x = Math.floor(v.px[k] - 1.2), y = Math.floor(v.py[k] - 1.2);
    if (ids[s.ix(x, y)] !== k) continue;
    s.set(x, y, '#cfe9e4');
    if (rng.chance(0.4) && ids[s.ix(x + 1, y)] === k) s.set(x + 1, y, '#8fb8b4');
  }
  return { normal: 2.0 };
}

function genWoodDeck(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const W = blendRamp(extRamp(PALETTE.wood, 0.15, 0.1), extRamp(PALETTE.woodGray, 0.15, 0.1), 0.22);
  const pitch = 8;
  const rows = bondRows(w, new Array(h / pitch).fill(pitch), 18, 40, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0.6, 0.6, 0.6, 0.6] });
  const info = L.blocks.map(() => ({ base: rng.pick([3, 4, 4, 4, 5]), gray: rng.chance(0.25) }));
  const G = field(w, h, 2, 16, seed + 3, { oct: 3 });
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.35 + 0.65 * smoothstep(0, 1.4, L.dist[i]);
  });
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) {
      s.set(x, y, L.id[s.ix(x, y - 1)] >= 0 ? W[0] : W[1]);
      return;
    }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.3, 1.1), -1, 1);
    // long grain streaks along the plank
    const g = G[i];
    if (g < 0.12) k -= 1; else if (g > 0.92) k += 1;
    const R = st.gray ? blendRamp(W, PALETTE.woodGray, 0.45) : W;
    s.set(x, y, ri(R, st.base + k));
  });
  // Nails at each plank end and knots.
  const M = PALETTE.metal;
  for (const b of L.blocks) {
    for (const nx of [b.x + 1, b.x + b.w - 3]) {
      for (const ny of [b.y + 1, b.y + b.h - 3]) {
        s.set(nx, ny, M[1]);
        s.set(nx + 1, ny + 1, W[2]);
        s.setH(nx, ny, 0.9);
      }
    }
    if (rng.chance(0.3) && b.w > 14) {
      const kx = b.x + rng.int(5, b.w - 7), ky = b.y + rng.int(2, 4);
      s.set(kx, ky, W[1]); s.set(kx + 1, ky, W[1]); s.set(kx - 1, ky, W[2]); s.set(kx + 2, ky, W[2]);
      s.set(kx, ky - 1, W[4]); s.set(kx + 1, ky + 1, W[3]);
    }
  }
  return { normal: 1.4 };
}

// ---------------------------------------------------------------------------
// Terrain sides
// ---------------------------------------------------------------------------

const CLIFF_RAMP = ['#141119', '#29222c', '#433638', '#5f4e47', '#7d6858', '#9d8469', '#bea37e', '#d9c39c'].map(parseColor);

/** Cooler grey and warmer ochre rock variants blended into the cliff ramp for per-block variety. */
const CLIFF_COOL = ['#121320', '#232536', '#3a3d4e', '#565a66', '#747a80', '#959b9c', '#b6bbb5', '#d4d6cc'].map(parseColor);
const CLIFF_WARM = ['#1a1216', '#35231f', '#573a2a', '#7b5437', '#9c7045', '#bb8e57', '#d6ad72', '#ecca96'].map(parseColor);

/**
 * Cliff: layered rock. Rock pieces are cells of a periodic jittered Voronoi (3 × 2 per unit, i.e. two
 * strata of ~8 px), strongly flattened so they run along the strata. Near-horizontal borders between
 * pieces are dark crevices (the strata lines — irregular and angled, never straight mortar courses)
 * with a lit ledge on the piece below and a
 * rounded, shaded underside on the piece above; near-vertical borders are only a soft tone seam.
 * Pieces vary a little in value and more in hue (warm ochre / neutral / cool grey) so no single
 * piece becomes a repeat hot-spot. Heights follow the same structure so the normal map agrees.
 * Tiles in both directions; the strata are irregular enough that a half-unit vertical phase shift
 * (grass_side anchored at a x.5 top above a world-v cliff) shows no visible seam.
 */
function genCliff(s, ctx) {
  const { w, h } = s;
  const seed = ctx.seedOf('cliff');
  const rng = new RNG(seed);
  const R = CLIFF_RAMP;
  const RAMPS = [R, R, blendRamp(R, CLIFF_COOL, 0.32), blendRamp(R, CLIFF_WARM, 0.45)];
  const v = voronoi(w, h, 3, 2, seed + 5, { jitter: 0.85, sy: 2.8 });
  const pieces = [];
  for (let k = 0; k < v.count; k++) pieces.push({ R: rng.pick(RAMPS), base: rng.pick([4, 4, 4, 3, 5]), facet: rng.range(0.8, 1.2) });
  const N = field(w, h, 4, 4, seed + 3, { oct: 2 });
  const id = v.id;
  const idAt = (x, y) => id[s.ix(x, y)];
  // crevice pixels: the bottom row of a piece whose lower neighbour is another piece
  const crev = new Uint8Array(w * h);
  s.each((x, y, i) => { if (idAt(x, y + 1) !== id[i]) crev[i] = 1; });
  // thicken a few crevices to 2 px where the piece above overhangs more
  s.each((x, y, i) => { if (crev[s.ix(x, y + 1)] === 1 && crev[i] === 0 && hash2(id[i], 3, seed) < 0.3 && idAt(x, y + 2) !== id[i]) crev[i] = 2; });
  s.each((x, y, i) => {
    const p = pieces[id[i]];
    if (crev[i]) { s.set(x, y, ri(p.R, crev[i] === 1 ? 1 : 2)); s.hf[i] = 0.12; return; }
    let k = p.base, hh = 0.72;
    const up = crev[s.ix(x, y - 1)] > 0 && idAt(x, y - 1) !== id[i];
    const up2 = !up && crev[s.ix(x, y - 2)] > 0 && idAt(x, y - 2) !== id[i];
    const down = crev[s.ix(x, y + 1)] > 0;
    // facet: upper-left of each piece a touch brighter, lower-right a touch darker
    const f = v.ox[i] * 0.12 + v.oy[i] * 0.35 * p.facet;
    if (f < -0.9) { k += 1; hh = 0.8; } else if (f > 0.75) { k -= 1; hh = 0.64; }
    if (up) { k = p.base + 2; hh = 0.95; } // lit ledge under a crevice
    else if (up2 && hash2(x, y, seed + 4) < 0.6) { k = p.base + 1; hh = 0.88; }
    else if (down) { k -= 1; hh = 0.52; } // rounded underside
    else if (N[i] > 0.9) k += 1;
    else if (N[i] < 0.1) k -= 1;
    // soft seam at near-vertical borders: shade on the left of the border, light on the right
    if (!up && idAt(x + 1, y) !== id[i]) k -= 1;
    else if (!up && idAt(x - 1, y) !== id[i] && !down) k += 1;
    s.set(x, y, ri(p.R, k));
    s.hf[i] = hh + (N[i] - 0.5) * 0.06;
  });
  // Moss tufts on a couple of ledges.
  const MO = PALETTE.moss;
  let placed = 0;
  for (let t = 0; t < 40 && placed < 2; t++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (!crev[s.ix(x, y - 1)] || crev[s.ix(x, y)]) continue;
    s.set(x, y, MO[3]); s.set(x + 1, y, MO[2]); s.set(x - 1, y, MO[2]); s.set(x, y + 1, MO[1]);
    placed++;
  }
  return { normal: 2.4 };
}

function genGrassSide(s, ctx) {
  const { w, h } = s;
  genCliff(s, ctx);
  const { rng, seed } = ctx;
  const G = PALETTE.grass.map(parseColor);
  const lip = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const n = pnoise((x / w) * 4, 0.5, 4, 1, seed + 1);
    lip[x] = 4 + Math.round((n - 0.5) * 3.2) + (hash2(x, 0, seed) < 0.25 ? 1 : 0);
    lip[x] = clamp(lip[x], 3, 6);
  }
  // Shadow cast by the overhang onto the rock/dirt below.
  for (let x = 0; x < w; x++) {
    for (let d = 1; d <= 3; d++) {
      const y = lip[x] + d;
      s.tint(x, y, OUTLINE, d === 1 ? 0.55 : d === 2 ? 0.35 : 0.15);
      s.setH(x, y, s.H(x, y) * 0.6);
    }
  }
  // The grass mass.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y <= lip[x]; y++) {
      let k;
      if (y === 0) k = hash2(x, 1, seed) < 0.3 ? 4 : 3;
      else if (y === 1) k = hash2(x, 2, seed) < 0.55 ? 4 : 3;
      else if (y === lip[x]) k = 1;
      else if (y === lip[x] - 1) k = hash2(x, y, seed) < 0.5 ? 1 : 2;
      else k = hash2(x, y, seed + 5) < 0.3 ? 3 : 2;
      s.set(x, y, G[k]);
      s.setH(x, y, 1 - y * 0.07);
    }
  }
  // Downward blade strokes inside the lip and hanging blades below it.
  for (let x = 0; x < w; x++) {
    if (hash2(x, 3, seed) < 0.45) {
      const y = 2 + Math.floor(hash2(x, 4, seed) * 2);
      if (y < lip[x] - 1) { s.set(x, y, G[3]); s.set(x, y + 1, G[2]); }
    }
  }
  const hang = rng.int(4, 6);
  for (let k = 0; k < hang; k++) {
    const x = rng.int(0, w - 1);
    const len = rng.int(1, 3);
    for (let d = 1; d <= len; d++) {
      s.set(x, lip[x] + d, d === len ? G[1] : G[2]);
      s.setH(x, lip[x] + d, 0.8);
    }
    s.tint(x + 1, lip[x] + len + 1, OUTLINE, 0.3);
  }
  return { normal: 2.2 };
}

/**
 * Dirt side (1×1): packed soil in two soft, gently undulating layers per unit (continuous across the
 * width, so the 1-unit repeat reads as natural layering rather than a lattice), each with a lighter
 * crumbly top and a darker, partly broken seam at its base; low-contrast clods, a tiny embedded stone
 * and a thin rootlet (no high-contrast repeat markers).
 */
function genDirtSide(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const D = extRamp(PALETTE.dirt, 0.12, 0.08); // 8 steps
  const A = field(w, h, 2, 4, seed + 1, { oct: 3 });
  const F = field(w, h, 5, 5, seed + 2, { oct: 2 });
  const wob = new Float32Array(w);
  for (let x = 0; x < w; x++) wob[x] = (pnoise((x / w) * 2, 0.5, 2, 1, seed + 7) - 0.5) * 3;
  s.each((x, y, i) => {
    const ly = mod(y + Math.round(wob[x]), 8); // row within a soil layer
    const d = (bayer4(x, y) - 0.5) * 0.14;
    const a = (A[i] - 0.5) * 0.6 + 0.5 + d + (ly <= 2 ? 0.16 : ly >= 6 ? -0.14 : 0);
    let k = a < 0.3 ? 2 : a > 0.72 ? 4 : 3;
    if (F[i] > 0.93) k += 1; else if (F[i] < 0.06) k -= 1;
    if (ly === 7 && hash2(x >> 1, y, seed + 3) < 0.6) k = 1; // broken seam under the layer above
    else if (ly === 0 && hash2(x, y, seed + 4) < 0.5) k += 1; // crumbly lit top
    s.set(x, y, D[k]);
    s.hf[i] = 0.4 + (A[i] - 0.5) * 0.25 + (ly <= 1 ? 0.12 : ly === 7 ? -0.2 : 0);
  });
  // thin rootlet
  let x = rng.int(0, w - 1), y = rng.int(2, h - 3);
  const len = rng.int(3, 4);
  for (let k = 0; k < len; k++) {
    s.set(x, y, PALETTE.bark[1]); s.setH(x, y, 0.55);
    x += 1; if (rng.chance(0.45)) y += rng.chance(0.5) ? 1 : -1;
  }
  pebble(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(0, 1), STONE_WARM, 3, D[2]);
  return { normal: 1.8 };
}

/**
 * Crag (2×2): a fractured rock face for tall blocked rock (Cinder Ridge's flanks, through a custom
 * legend char; no default tile type uses it and `preload()` never paints it). The inverse of the
 * cliff's strata: rock pieces are cells of a periodic jittered Voronoi stretched upright (4 × 3 per
 * repeat), and it is their near-vertical borders that open into dark fissures (half of them), while
 * the near-horizontal ones stay a soft ledge (a lit lip under a shaded underside) — so the face
 * reads as one mass split by vertical cracks, never as stacked layers. Each piece is chiselled into
 * two flat facets meeting along an arris within 45° of vertical (the one turned to the upper-left
 * key light a step brighter). Blue-grey stone (the boulders' ramp) with warmer and cooler
 * pieces, a few hairline fractures and moss specks on the ledges; the height field follows it all.
 */
function genCrag(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const cool = extRamp(PALETTE.stone, 0.2, 0.1); // 8 steps
  const warm = extRamp(PALETTE.stoneWarm, 0.2, 0.1);
  const B = blendRamp(cool, warm, 0.3);
  const RAMPS = [B, B, B, blendRamp(cool, warm, 0.62), blendRamp(cool, warm, 0.08)];
  const v = voronoi(w, h, 4, 3, seed + 5, { jitter: 0.9, sy: 0.6 });
  const pieces = [];
  for (let k = 0; k < v.count; k++) {
    // the arris: a line within ±45° of vertical, near the centre (a = its normal's angle); the facet
    // on the side the upper-left key light (−0.6, −0.8) falls on is the lit one
    const a = rng.range(-0.8, 0.8);
    const ax = Math.cos(a), ay = Math.sin(a);
    pieces.push({ R: rng.pick(RAMPS), base: rng.pick([4, 4, 3, 4, 3]), ax, ay, off: rng.range(-1.5, 1.5), litNeg: -0.6 * ax - 0.8 * ay < 0 });
  }
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  const id = v.id;
  const idAt = (x, y) => id[s.ix(x, y)];
  const pair = (a, b, salt) => hash2(Math.min(a, b), Math.max(a, b), seed + salt);
  // 1 = open fissure (a near-vertical border, half of the pairs; a near-horizontal one 10 %),
  // 2 = soft ledge border (the rest of the near-horizontal ones), 3 = closed seam (the rest: only
  // the two pieces' facets meet there)
  const kind = new Uint8Array(w * h);
  s.each((x, y, i) => {
    const r = idAt(x + 1, y), d = idAt(x, y + 1);
    if (r !== id[i]) kind[i] = pair(id[i], r, 11) < 0.5 ? 1 : 3;
    else if (d !== id[i]) kind[i] = pair(id[i], d, 12) < 0.1 ? 1 : 2;
  });
  s.each((x, y, i) => {
    const p = pieces[id[i]];
    if (kind[i] === 1) {
      s.set(x, y, ri(p.R, hash2(x, y, seed + 9) < 0.35 ? 0 : 1));
      s.hf[i] = 0.08;
      return;
    }
    const dd = v.ox[i] * p.ax + v.oy[i] * p.ay + p.off;
    const lit = (dd < 0) === p.litNeg;
    let k = p.base + (lit ? 1 : -1);
    let hh = 0.66 + (lit ? 0.04 : -0.04) - Math.abs(dd) * 0.012;
    const ledge = kind[s.ix(x, y - 1)] === 2 || kind[s.ix(x, y - 1)] === 1;
    if (kind[i] === 2) { k -= 1; hh -= 0.12; } // shaded underside of the piece above a ledge
    else if (kind[i] === 3) hh -= 0.04; // closed seam
    else if (ledge) { k += 1; hh += 0.06; } // lit lip of a ledge
    else if (kind[s.ix(x - 1, y)] === 1) { k += 1; hh += 0.04; } // the fissure's lit far wall
    if (N[i] > 0.93) k += 1;
    else if (N[i] < 0.07) k -= 1;
    s.set(x, y, ri(p.R, k));
    s.hf[i] = hh + (N[i] - 0.5) * 0.05;
  });
  // hairline fractures inside a few pieces
  for (let n = 0; n < 5; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (kind[s.ix(x, y)]) continue;
    crack(s, x, y, rng.int(3, 6), rng, { dark: ri(B, 2), idMap: id, idv: idAt(x, y), depth: 0.2 });
  }
  // moss specks on a few ledges (the ridge's crest is moss stone)
  const MO = PALETTE.moss;
  let placed = 0;
  for (let t = 0; t < 80 && placed < 5; t++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (kind[s.ix(x, y)] || kind[s.ix(x, y - 1)] !== 2) continue;
    s.set(x, y, MO[3]); s.set(x + 1, y, MO[2]); s.set(x - 1, y, MO[2]);
    placed++;
  }
  return { normal: 2.4 };
}

function genStoneWall(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rows = bondRows(w, [8, 8, 8, 8], 8, 15, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0, 1, 2, 3].map(() => rng.range(0.8, 2.2)) });
  const info = L.blocks.map(() => ({ R: rng.chance(0.7) ? STONE_COOL : STONE_WARM, base: rng.pick([2, 3, 3, 3, 4]) }));
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  const M = field(w, h, 2, 2, seed + 4, { oct: 3 });
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.3 + 0.7 * smoothstep(0, 2.2, L.dist[i]) + (N[i] - 0.5) * 0.2;
  });
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) {
      const sh = L.id[s.ix(x, y - 1)] >= 0 || L.id[s.ix(x - 1, y)] >= 0;
      s.set(x, y, M[i] > 0.8 ? PALETTE.moss[sh ? 0 : 1] : sh ? STONE_COOL[0] : STONE_COOL[1]);
      return;
    }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.3, 1.1), -2, 2);
    if (N[i] > 0.92) k += 1; else if (N[i] < 0.07) k -= 1;
    let c = ri(st.R, st.base + k);
    if (M[i] > 0.86 && L.dist[i] < 2.5) c = mix(c, PALETTE.moss[2], 0.6);
    s.set(x, y, c);
  });
  for (const b of L.blocks) {
    if (!rng.chance(0.3)) continue;
    const st = info[b.index];
    crack(s, b.x + rng.int(1, b.w - 3), b.y + 1, rng.int(3, 5), rng, { dark: ri(st.R, st.base - 2), light: ri(st.R, st.base + 1), idMap: L.id, idv: b.index });
  }
  return { normal: 2.4 };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function paintPlaster(s, ctx, { base = 4, cracks = 3, chips = 1, stains = true } = {}) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const P = extRamp(PALETTE.plaster, 0.1, 0.04); // 8 steps
  const A = field(w, h, w / 16, h / 16, seed + 1, { oct: 3, gain: 0.5 });
  const S = field(w, h, w / 32, h / 16, seed + 3, { oct: 3 });
  const lv = quantize(A, [0.4], base);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i];
    if (e > 0 && hash2(x, y, seed) < 0.5) k += 1;
    else if (e < 0 && hash2(x, y, seed + 1) < 0.7) k -= 1;
    else if (hash2(x, y, seed + 2) < 0.025) k -= 1; // pores
    let c = ri(P, k);
    if (stains && S[i] < 0.12) c = mix(c, P[3], 0.4);
    s.set(x, y, c);
    s.hf[i] = 0.35 + lv[i] * 0.03 + e * 0.03;
  });
  for (let c = 0; c < cracks; c++) {
    crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(3, 6), rng, { dark: P[3], light: null, depth: 0.08 });
  }
  const Bk = extRamp(PALETTE.brick, 0.1, 0.05);
  for (let c = 0; c < chips; c++) {
    // chipped plaster revealing brickwork beneath
    const x0 = rng.int(0, w - 1), y0 = rng.int(0, h - 1), cw = rng.int(7, 10), ch = rng.int(5, 7);
    const inside = (u, v) => {
      const e = ((u + 0.5 - cw / 2) ** 2) / ((cw / 2) ** 2) + ((v + 0.5 - ch / 2) ** 2) / ((ch / 2) ** 2);
      return e <= 1 + (hash2(u, v, seed + c) - 0.5) * 0.45;
    };
    for (let v = -1; v <= ch; v++) {
      for (let u = -1; u <= cw; u++) {
        const x = x0 + u, y = y0 + v;
        if (inside(u, v)) {
          const row = Math.floor(v / 3);
          const mortar = mod(v, 3) === 2 || mod(u + (row & 1) * 3, 6) === 5;
          const top = mod(v, 3) === 0;
          s.set(x, y, mortar ? P[2] : mix(Bk[top ? 4 : 3], P[3], 0.35));
          s.setH(x, y, mortar ? 0.1 : 0.2);
        } else if (inside(u - 1, v) || inside(u, v - 1)) {
          s.set(x, y, P[6]); // broken edge on the lower-right faces the light
          s.setH(x, y, 0.45);
        } else if (inside(u + 1, v) || inside(u, v + 1)) {
          s.set(x, y, P[2]); // shaded upper-left lip
        }
      }
    }
  }
}

function genPlaster(s, ctx) {
  paintPlaster(s, ctx, { base: 4, cracks: 5, chips: 1 });
  return { normal: 1.2 };
}

/** Dark oak for half-timbering. */
const BEAM = ['#150f0c', '#231915', '#35261e', '#4a3427', '#604433', '#7a5840'].map(parseColor);
const OAK = extRamp(['#1c120d', '#2e1d14', '#46291a', '#5f3a22', '#7c5030'], 0.1, 0.1);

/** Paint a set of beam pixels (orientation map: 1 horiz, 2 vert, 3 diag) over plaster. */
function paintBeams(s, ori, ctx, { R = BEAM, base = 2, height = 1.0 } = {}) {
  const { w, h } = s;
  const { seed } = ctx;
  const isB = (x, y) => { const i = s.ix(x, y); return i >= 0 && ori[i] > 0; };
  // Cast shadow of beams on the plaster (lower-right of beams).
  s.each((x, y, i) => {
    if (ori[i]) return;
    if (isB(x - 1, y - 1) || isB(x, y - 1) || isB(x - 1, y)) s.tint(x, y, '#5e4a44', 0.42);
    else if (isB(x - 2, y - 2) || isB(x, y - 2)) s.tint(x, y, '#6e5a50', 0.18);
  });
  s.each((x, y, i) => {
    if (!ori[i]) return;
    s.hf[i] = height;
  });
  s.each((x, y, i) => {
    if (!ori[i]) return;
    let k = base;
    const tl = !isB(x - 1, y) || !isB(x, y - 1);
    const br = !isB(x + 1, y) || !isB(x, y + 1);
    if (tl && !br) k += 1;
    if (br && !tl) k -= 1;
    // grain streaks along the beam
    const o = ori[i];
    const across = o === 1 ? y : o === 2 ? x : x + y;
    const along = o === 1 ? x : o === 2 ? y : x - y;
    const g = hash2(across, Math.floor(along / 5), seed + 9);
    if (g < 0.18) k -= 1;
    else if (g > 0.93 && !br) k += 1;
    s.set(x, y, ri(R, k));
    s.hf[i] = height - (br ? 0.2 : 0) - (g < 0.18 ? 0.1 : 0);
  });
  // A couple of pegs.
}

function genTimberFrame(s, ctx) {
  const { w, h } = s; // 32×32 = 2×2 units
  paintPlaster(s, ctx, { base: 4, cracks: 2, chips: 0, stains: true });
  const ori = new Uint8Array(w * h);
  const put = (x, y, o) => { const i = s.ix(x, y); if (i >= 0 && !ori[i]) ori[i] = o; };
  // Posts straddle the vertical seam (2 px each side → a 4 px post when tiled horizontally).
  for (let y = 0; y < h; y++) { put(w - 2, y, 2); put(w - 1, y, 2); put(0, y, 2); put(1, y, 2); }
  // Sill/plate straddle the horizontal seam; 3 px mid rail.
  for (let x = 0; x < w; x++) { put(x, h - 2, 1); put(x, h - 1, 1); put(x, 0, 1); put(x, 1, 1); }
  for (let x = 0; x < w; x++) { put(x, 15, 1); put(x, 16, 1); put(x, 17, 1); }
  const brace = (x0, y0, x1, y1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
      put(x, y, 3); put(x + 1, y, 3); put(x + 2, y, 3);
    }
  };
  // Upper panel: knee braces framing the window zone. Lower panel: a long St Andrew's cross.
  brace(2, 11, 9, 2);
  brace(27, 11, 20, 2);
  brace(2, 18, 27, 29);
  brace(27, 18, 2, 29);
  paintBeams(s, ori, ctx);
  // Oak pegs at the main joints.
  for (const [x, y] of [[0, 16], [31, 16], [0, 0], [31, 0], [15, 0], [15, 16]]) s.set(x, y, BEAM[4]);
  return { normal: 2.0 };
}

function plankWall(s, ctx, { R, heights, minW, maxW, nails = true, knots = 0.35, gray = 0 }) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rows = bondRows(w, heights, minW, maxW, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0.5, 0.7, 0.5, 0.7] });
  const G = field(w, h, 2, 12, seed + 3, { oct: 3 });
  const info = L.blocks.map(() => ({ base: rng.pick([2, 3, 3, 3, 4]), gray: rng.chance(gray) }));
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.35 + 0.65 * smoothstep(0, 1.3, L.dist[i]) + (G[i] - 0.5) * 0.12;
  });
  const RG = blendRamp(R, PALETTE.woodGray, 0.5);
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) { s.set(x, y, L.id[s.ix(x, y - 1)] >= 0 ? R[1] : R[2]); return; }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.3, 1.1), -1, 1);
    if (G[i] < 0.12) k -= 1; else if (G[i] > 0.93) k += 1;
    s.set(x, y, ri(st.gray ? RG : R, st.base + 1 + k));
  });
  const M = PALETTE.metal;
  for (const b of L.blocks) {
    if (nails) {
      for (const nx of [b.x + 1, b.x + b.w - 3]) {
        const ny = b.y + Math.floor((b.h - 1) / 2) - 1;
        s.set(nx, ny, M[1]); s.set(nx + 1, ny + 1, R[1]); s.set(nx, ny - 1, R[4]);
      }
    }
    if (rng.chance(knots) && b.w > 12) {
      const kx = b.x + rng.int(4, b.w - 6), ky = b.y + Math.floor((b.h - 1) / 2);
      s.set(kx, ky, R[1]); s.set(kx + 1, ky, R[0]); s.set(kx - 1, ky, R[2]); s.set(kx + 2, ky, R[2]);
      s.set(kx, ky - 1, R[4]); s.set(kx + 1, ky + 1, R[4]);
      s.setH(kx, ky, 0.2); s.setH(kx + 1, ky, 0.2);
    }
  }
}

function genWoodPlanks(s, ctx) {
  plankWall(s, ctx, { R: extRamp(PALETTE.wood, 0.12, 0.08), heights: [6, 5, 5, 6, 5, 5], minW: 20, maxW: 32, gray: 0.15 });
  return { normal: 1.3 };
}

function genWoodPlanksDark(s, ctx) {
  const R = extRamp(['#17110e', '#231915', '#33241c', '#453126', '#5b4230', '#74563d'], 0.08, 0.06);
  plankWall(s, ctx, { R, heights: [6, 5, 5, 6, 5, 5], minW: 20, maxW: 32, gray: 0.3, knots: 0.45 });
  return { normal: 1.3 };
}

function genLogWall(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const R = extRamp(['#24160f', '#3a2517', '#553722', '#734c2e', '#93663d', '#b3844f'], 0.1, 0.08);
  const logH = 8;
  const G = field(w, h, 2, 8, seed + 3, { oct: 3 });
  s.each((x, y, i) => {
    const v = y % logH;
    // cylinder profile: v=0 is the dark chink gap
    const t = (v - 0.5) / (logH - 1);
    const prof = v === 0 ? 0 : Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    s.hf[i] = prof * 0.9 + (G[i] - 0.5) * 0.1;
  });
  s.each((x, y, i) => {
    const v = y % logH;
    if (v === 0) { s.set(x, y, hash2(x, y, seed) < 0.3 ? '#6b5a48' : R[0]); return; }
    let k = [0, 4, 5, 4, 3, 3, 2, 1][v];
    if (G[i] < 0.14) k -= 1; else if (G[i] > 0.92 && v < 5) k += 1;
    s.set(x, y, ri(R, k));
  });
  // Knots / branch stubs and cracks.
  for (let n = 0; n < 5; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h / logH - 1) * logH + rng.int(3, 5);
    s.set(x, y, R[1]); s.set(x + 1, y, R[1]);
    s.set(x - 1, y, R[3]); s.set(x + 2, y, R[2]);
    s.set(x, y - 1, R[5]); s.set(x + 1, y - 1, R[4]);
    s.set(x, y + 1, R[2]); s.set(x + 1, y + 1, R[2]);
  }
  for (let c = 0; c < 4; c++) {
    let x = rng.int(0, w - 1);
    const y = rng.int(0, h / logH - 1) * logH + rng.int(3, 5);
    for (let k = 0; k < rng.int(4, 8); k++) { s.set(x + k, y, R[1]); s.set(x + k, y + 1, R[3]); s.setH(x + k, y, 0.3); }
  }
  return { normal: 1.5 };
}

function genBrick(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const B = blendRamp(extRamp(PALETTE.brick, 0.12, 0.12), STONE_WARM, 0.22);
  const rows = [];
  for (let r = 0; r < h / 4; r++) rows.push({ y: r * 4, h: 4, widths: [8, 8, 8, 8], offset: (r % 2) * 4 + (r % 4 === 3 ? 1 : 0) });
  const L = layoutBlocks(w, h, rows, { gap: 1 });
  const info = L.blocks.map(() => ({ base: rng.pick([3, 3, 3, 4, 4, 5]), burnt: rng.chance(0.1) }));
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.4 + 0.6 * smoothstep(0, 1.2, L.dist[i]) + (N[i] - 0.5) * 0.15;
  });
  const mortar = extRamp(['#4b3e3a', '#6b5c54', '#86766a', '#a09080']);
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) {
      const sh = L.id[s.ix(x, y - 1)] >= 0 || L.id[s.ix(x - 1, y)] >= 0;
      s.set(x, y, sh ? mortar[1] : mortar[2 + (hash2(x, y, seed) < 0.3 ? 1 : 0)]);
      return;
    }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.35, 1.2), -1, 1);
    if (N[i] > 0.93) k += 1; else if (N[i] < 0.06) k -= 1;
    let c = ri(B, st.base + k);
    if (st.burnt) c = mix(c, '#2a1a22', 0.35);
    s.set(x, y, c);
  });
  // chipped corners
  for (const b of L.blocks) {
    if (!rng.chance(0.15)) continue;
    const cx = rng.chance(0.5) ? b.x : b.x + b.w - 2, cy = rng.chance(0.5) ? b.y : b.y + b.h - 2;
    s.set(cx, cy, mortar[1]); s.setH(cx, cy, 0.1);
  }
  return { normal: 1.6 };
}

function genStoneBrick(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rows = bondRows(w, [8, 8, 8, 8], 11, 17, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0.7, 0.9, 0.9, 1.2] });
  const R = extRamp(['#3a3230', '#5a4e48', '#7d7066', '#a09282', '#c2b5a0', '#ded4bf'], 0.12, 0.06);
  const info = L.blocks.map(() => ({ base: rng.pick([2, 3, 3, 3, 4]), cool: rng.chance(0.25) }));
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.3 + 0.7 * smoothstep(0, 1.8, L.dist[i]) + (N[i] - 0.5) * 0.12;
  });
  const RC = blendRamp(R, STONE_COOL, 0.45);
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) { s.set(x, y, L.id[s.ix(x, y - 1)] >= 0 || L.id[s.ix(x - 1, y)] >= 0 ? R[1] : R[2]); return; }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.3, 1.1), -1, 2);
    if (N[i] > 0.94) k += 1; else if (N[i] < 0.06) k -= 1;
    s.set(x, y, ri(st.cool ? RC : R, st.base + k + 1));
  });
  for (const b of L.blocks) {
    const st = info[b.index];
    if (rng.chance(0.2)) crack(s, b.x + rng.int(2, b.w - 4), b.y + 1, rng.int(3, 5), rng, { dark: ri(R, st.base - 1), light: ri(R, st.base + 3), idMap: L.id, idv: b.index });
    // chisel marks
    if (rng.chance(0.5)) {
      const y = b.y + rng.int(2, 4);
      for (let x = b.x + 2; x < b.x + b.w - 3; x += 3) if (L.id[s.ix(x, y)] === b.index && hash2(x, y, seed) < 0.6) s.set(x, y, ri(R, st.base + 1));
    }
  }
  return { normal: 2.2 };
}

/** Roof tile rows (8 px each) of curved clay tiles. */
function genClayRoof(s, ctx, R0) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const R = extRamp(R0, 0.15, 0.06);
  const rowH = 8;
  const nRows = h / rowH;
  const tileOf = new Int32Array(w * h).fill(-1);
  const tiles = [];
  const uOf = new Float32Array(w * h);
  for (let r = 0; r < nRows; r++) {
    const widths = splitWidths(w, 5, 6, rng);
    const off = rng.int(0, w - 1);
    let x = off;
    for (const tw of widths) {
      const t = { base: rng.pick([3, 3, 4, 4, 4, 5]), lichen: rng.chance(0.12), dark: rng.chance(0.1), w: tw };
      tiles.push(t);
      for (let u = 0; u < tw; u++) {
        for (let v = 0; v < rowH; v++) {
          const i = s.ix(x + u, r * rowH + v);
          tileOf[i] = tiles.length - 1;
          uOf[i] = (u + 0.5) / tw;
        }
      }
      x += tw;
    }
  }
  s.each((x, y, i) => {
    const v = y % rowH;
    const u = uOf[i];
    const tw = tiles[tileOf[i]].w;
    const cyl = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    const lipCut = v === rowH - 1 && (u * tw < 1 || u * tw > tw - 1);
    s.hf[i] = lipCut ? 0.05 : 0.15 + 0.55 * cyl + v * 0.04;
  });
  s.each((x, y, i) => {
    const v = y % rowH;
    const t = tiles[tileOf[i]];
    const u = uOf[i];
    const tw = t.w;
    const px = Math.floor(u * tw);
    const edgeL = px === 0, edgeR = px === tw - 1;
    let k = t.base;
    if (edgeR) k -= 2; // valley between tiles
    else if (edgeL) k += 1;
    else if (px === tw - 2) k -= 1;
    if (v === 0) k = Math.min(k, t.base - 2) - 1; // deep shadow under the row above
    else if (v === 1) k -= 1;
    else if (v === rowH - 2 && !edgeR && !edgeL) k += 1; // rounded lip catches light
    if (v === rowH - 1 && (edgeL || edgeR)) k = 0; // lip corners reveal shadow beneath
    if (t.dark) k -= 1;
    let c = ri(R, k);
    if (t.lichen && v >= 3 && v <= 5 && px >= 1 && px <= 2 && hash2(x, y, seed) < 0.6) c = mix(c, '#4f5a3a', 0.35);
    s.set(x, y, c);
  });
  // A few chipped tiles.
  for (let c = 0; c < 3; c++) {
    const x = rng.int(0, w - 1), y = rng.int(0, nRows - 1) * rowH + rowH - 2;
    s.set(x, y, R[1]); s.set(x, y + 1, R[0]);
  }
  return { normal: 2.4 };
}

function genRoofThatch(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const T = extRamp(PALETTE.thatch, 0.14, 0.04); // 8 steps
  const rowH = 8;
  const nRows = h / rowH;
  const A = field(w, h, 4, 4, seed + 1, { oct: 3 });
  const strandK = (x, r) => { const q = hash2(x >> 1, r, seed + 2) * 0.6 + hash2(x, r, seed + 12) * 0.4; return q < 0.25 ? 3 : q < 0.75 ? 4 : 5; };
  // Layer bodies: vertical straw strands, shadowed under the layer above.
  s.each((x, y, i) => {
    const r = Math.floor(y / rowH), v = y % rowH;
    let k = strandK(x, r);
    if (hash2(x, Math.floor((y + hash2(x, r, seed + 3) * 4) / 4), seed + 4) < 0.12) k -= 1;
    if (v === 0) k -= 3;
    else if (v === 1) k -= 2;
    else if (v === 2) k -= 1;
    if (A[i] < 0.18) k -= 1;
    s.set(x, y, ri(T, k));
    s.hf[i] = 0.2 + v * 0.08 + (k - 3) * 0.03;
  });
  // Ragged fringe of each layer hanging over the next (strand ends catch the light).
  for (let r = 0; r < nRows; r++) {
    const yb = r * rowH + rowH - 1;
    for (let x = 0; x < w; x++) {
      const q = hash2(x, r, seed + 5);
      const len = q < 0.35 ? 2 : q < 0.8 ? 1 : 0;
      const k = strandK(x, r);
      for (let d = 1; d <= len; d++) {
        s.set(x, yb + d, ri(T, d === len ? k : k + 1));
        s.setH(x, yb + d, 0.85);
      }
      if (len === 0) s.set(x, yb, ri(T, k - 1));
    }
  }
  return { normal: 1.8 };
}

function genRoofSlate(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const R = extRamp(PALETTE.slate, 0.12, 0.1);
  const rowH = 8;
  const rows = bondRows(w, [8, 8, 8, 8], 6, 9, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0, 0, rng.range(0.5, 2.0), rng.range(0.5, 2.0)] });
  const info = L.blocks.map(() => ({ base: rng.pick([3, 4, 4, 5]), tint: rng.chance(0.2) }));
  s.each((x, y, i) => {
    const v = y % rowH;
    s.hf[i] = L.id[i] < 0 ? 0 : 0.2 + v * 0.1;
  });
  s.each((x, y, i) => {
    const b = L.id[i];
    const v = y % rowH;
    if (b < 0) { s.set(x, y, R[0]); return; }
    const st = info[b];
    let k = st.base;
    if (v === 0) k -= 2;
    else if (v === 1) k -= 1;
    if (v === rowH - 2) k += 1;
    if (L.id[s.ix(x - 1, y)] !== b) k += 1;
    if (L.id[s.ix(x + 1, y)] !== b) k -= 1;
    if (hash2(x, y, seed) < 0.05) k += 1;
    let c = ri(R, k);
    if (st.tint) c = mix(c, '#5a6a5a', 0.25);
    s.set(x, y, c);
  });
  return { normal: 2.2 };
}

function genDoor(s, ctx) {
  const { w, h } = s; // 16×32
  const { seed } = ctx;
  const W = extRamp(PALETTE.wood, 0.12, 0.08);
  const F = OAK;
  const M = PALETTE.metal;
  const G = field(w, h, 2, 8, seed + 3, { oct: 3 });
  // planks x 2..13: [2-5] [6] [7-9] [10] [11-13]
  const plankOf = (x) => (x <= 5 ? 0 : x <= 9 ? 1 : 2);
  s.each((x, y, i) => {
    let c, hh = 0.55;
    const frame = x <= 1 || x >= 14 || y <= 1;
    if (frame) {
      let k = 3;
      if (x === 0 || y === 0) k = 4;
      if (x === 1 && y > 1) k = 2;
      if (x === 15 || (x === 14 && y > 0)) k = x === 15 ? 2 : 1;
      if (y === 1 && x > 1 && x < 14) k = 1;
      c = ri(F, k);
      hh = 1;
    } else if (x === 6 || x === 10) {
      c = W[1]; hh = 0.3;
    } else {
      const p = plankOf(x);
      const left = x === 2 || x === 7 || x === 11;
      const right = x === 5 || x === 9 || x === 13;
      let k = 3 + (p === 1 ? 1 : 0);
      if (left) k += 1;
      if (right) k -= 1;
      if (G[i] < 0.14) k -= 1; else if (G[i] > 0.93) k += 1;
      if (y === 2) k -= 1;
      if (y === h - 1) k -= 2;
      c = ri(W, k);
    }
    s.set(x, y, c);
    s.hf[i] = hh;
  });
  // arched top corners
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [13, 2], [12, 2], [13, 3]]) { s.set(x, y, F[2]); s.setH(x, y, 1); }
  // hinges
  for (const hy of [7, 24]) {
    for (let x = 1; x <= 10; x++) {
      const tip = x === 10;
      s.set(x, hy, tip ? M[2] : M[3]);
      s.set(x, hy + 1, M[1]);
      if (!tip) s.set(x, hy + 2, W[1]);
      s.setH(x, hy, 0.95); s.setH(x, hy + 1, 0.85);
    }
    s.set(11, hy, M[1]); s.set(11, hy + 1, M[0]);
    s.set(9, hy - 1, M[2]); s.set(9, hy + 2, M[1]);
    for (const rx of [3, 8]) { s.set(rx, hy, M[5]); }
  }
  // ring handle + backplate + keyhole
  s.set(11, 15, M[2]); s.set(12, 15, M[1]);
  s.set(10, 16, M[4]); s.set(13, 16, M[1]);
  s.set(10, 17, M[3]); s.set(13, 17, M[0]);
  s.set(11, 18, M[2]); s.set(12, 18, M[0]);
  s.set(11, 16, W[1]); s.set(12, 16, W[1]); s.set(11, 17, W[2]); s.set(12, 17, W[1]);
  s.set(11, 14, M[3]); s.set(12, 14, M[2]);
  for (const [x, y] of [[11, 14], [12, 14], [10, 16], [13, 16], [10, 17], [13, 17], [11, 18], [12, 18]]) s.setH(x, y, 1);
  s.set(12, 21, M[0]); s.set(12, 22, M[0]); s.set(13, 22, W[4]);
  // threshold shadow
  for (let x = 2; x < 14; x++) s.tint(x, h - 2, OUTLINE, 0.25);
  return { normal: 2.0 };
}

function genWindow(s, ctx) {
  const { w, h } = s; // 16×16
  const F = extRamp(['#1f140e', '#34221a', '#4f3322', '#6b4a30', '#8a6440'], 0.1, 0.1);
  const Wt = PALETTE.water;
  const em = s.emissive();
  const glassArea = (x, y) => x >= 2 && x <= 13 && y >= 2 && y <= 12;
  const mullion = (x, y) => x === 7 || x === 8 || y === 7;
  s.each((x, y, i) => {
    if (glassArea(x, y) && !mullion(x, y)) {
      // pane-local coords
      const px = x <= 6 ? x - 2 : x - 9;
      const py = y <= 6 ? y - 2 : y - 8;
      let c = y <= 6 ? Wt[2] : Wt[1];
      if (py === 0 || px === 0) c = Wt[0]; // recess shadow from the frame (top/left)
      else if (py === 1 && hash2(x, y, 3) < 0.5) c = y <= 6 ? Wt[3] : Wt[2];
      // reflection streak (diagonal)
      const d = px + py;
      if (d === 5 || d === 6) c = d === 5 ? Wt[5] : Wt[4];
      if (d === 5 && px === 3) c = Wt[6];
      s.set(x, y, c);
      s.hf[i] = 0.2;
      // warm lit interior: brighter lower centre, curtains dimmer at the outer sides
      let e = 1 - Math.abs(x + 0.5 - (x <= 6 ? 5 : 11)) * 0.06 - Math.abs(y - 9) * 0.03;
      if ((x === 2 || x === 13) && py > 0) e *= 0.55;
      if (px === 0 || py === 0) e *= 0.8;
      const g = Math.round(clamp(e, 0, 1) * 255);
      em.set(x, y, [g, g, g, 255]);
      return;
    }
    // frame & mullions
    let k = 3;
    const outer = x <= 1 || x >= 14 || y <= 1 || y >= 13;
    if (outer) {
      if (x === 0 || y === 0) k = 4;
      if (x === 15 || (y >= 13 && y === 15)) k = 1;
      if (x === 1 && y >= 1 && y <= 12) k = 2;
      if (y === 1 && x >= 1 && x <= 14) k = 2;
      if (x === 14 && y >= 1 && y <= 12) k = 3;
      // sill
      if (y === 13) k = 5;
      if (y === 14) k = 3;
      if (y === 15) k = 1;
    } else {
      // mullions: lit top/left pixel, darker bottom/right
      k = x === 7 || (y === 7 && x !== 8) ? 4 : 2;
      if (y === 7 && (x === 7 || x === 8)) k = 3;
    }
    s.set(x, y, ri(F, k));
    s.hf[i] = outer ? (y >= 13 ? 1 : 0.9) : 0.7;
  });
  // sill shadow line under the glass
  for (let x = 2; x <= 13; x++) s.tint(x, 12, OUTLINE, 0.35);
  return { normal: 1.8, wrap: false };
}

function genChimneyStone(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 4, 6, seed + 19, { jitter: 0.7, sy: 1.5, round: 1.2 });
  const R = extRamp(['#231f22', '#3b3436', '#5a5050', '#7c6f68', '#9d8f82', '#bdb09e'], 0.1, 0.06);
  const stones = [];
  for (let k = 0; k < v.count; k++) stones.push({ R, base: rng.pick([2, 3, 3, 4]), bump: rng.range(0.85, 1.05), r: 3 });
  const S = field(w, h, 2, 2, seed + 7, { oct: 3 });
  paintVoronoiStones(s, v, (k) => stones[k], {
    seed, gap: 0.55, bevel: 2.2,
    gapColor: (x, y, shade) => (shade ? '#1a1618' : hash2(x, y, seed) < 0.4 ? '#4a4240' : '#3a3334'),
  });
  // soot stains
  s.each((x, y, i) => { if (S[i] < 0.25) s.tint(x, y, '#1c1a20', 0.35 * (1 - S[i] / 0.25)); });
  return { normal: 2.3 };
}

// ---------------------------------------------------------------------------
// Nature & props
// ---------------------------------------------------------------------------

function genBark(s, ctx) {
  const { w, h } = s; // 16×32
  const { rng, seed } = ctx;
  const B = extRamp(PALETTE.bark, 0.1, 0.1);
  // Furrow lines: wavy vertical lines, 4 per unit.
  const nF = 4;
  const fx = [];
  for (let f = 0; f < nF; f++) fx.push((f + 0.3 + rng.next() * 0.4) * (w / nF));
  const off = (f, y) => (pfbm(f * 1.7 + 0.5, (y / h) * 4, 8, 4, seed + 3, 2) - 0.5) * 3.2;
  const knots = [];
  for (let k = 0; k < 2; k++) knots.push({ x: rng.int(2, w - 3), y: rng.int(3, h - 4) });
  s.each((x, y, i) => {
    let dmin = Infinity;
    for (let f = 0; f < nF; f++) {
      let d = x + 0.5 - (fx[f] + off(f, y));
      d = mod(d + w / 2, w) - w / 2;
      if (Math.abs(d) < Math.abs(dmin)) dmin = d;
    }
    // ridge height grows away from furrows
    s.hf[i] = smoothstep(0, 2.2, Math.abs(dmin)) * 0.8 + 0.1;
  });
  for (const kn of knots) {
    for (let y = -3; y <= 3; y++) {
      for (let x = -2; x <= 2; x++) {
        const e = (x * x) / 5 + (y * y) / 10;
        if (e <= 1.2) s.setH(kn.x + x, kn.y + y, 0.9 - e * 0.4);
      }
    }
  }
  s.each((x, y, i) => {
    let k = 2 + stepOf(s.slope(x, y), 0.25, 0.8);
    if (s.hf[i] < 0.25) k = 0;
    else if (s.hf[i] < 0.4) k = Math.min(k, 1);
    // horizontal bark cracks across ridges
    if (hash2(x >> 2, y, seed + 5) < 0.06 && s.hf[i] > 0.5) k -= 1;
    s.set(x, y, ri(B, k + 1));
  });
  for (const kn of knots) {
    s.set(kn.x, kn.y, B[0]); s.set(kn.x, kn.y + 1, B[0]);
    s.set(kn.x - 1, kn.y - 1, B[4]); s.set(kn.x, kn.y - 2, B[5]);
    s.set(kn.x + 1, kn.y + 1, B[2]); s.set(kn.x + 1, kn.y + 2, B[1]); s.set(kn.x - 1, kn.y, B[3]);
  }
  // lichen / moss specks
  const MO = PALETTE.moss;
  for (let n = 0; n < 6; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, n < 3 ? MO[2] : '#8c9a7a'); if (n < 3) s.set(x, y + 1, MO[1]);
  }
  return { normal: 2.4 };
}

/**
 * Alpha foliage cut-out: lush leaf clumps with scalloped silhouettes (each clump is a core plus a
 * ring of round leaf bunches), dark interiors and lit upper-left rims, separated by transparent
 * gaps. Clumps stay inside the texture so it works on single cards as well as wrapped shells.
 */
function genFoliage(s, ctx, R0) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const R = extRamp(R0, 0.12, 0.05); // 8 steps
  const sc = w / 32;
  const L = [-0.55, -0.68, 0.48];
  const Ll = Math.hypot(...L);
  const lx = L[0] / Ll, ly = L[1] / Ll, lz = L[2] / Ll;
  const layout = [[0.47, 0.3, 7.2], [0.19, 0.5, 5.2], [0.8, 0.47, 5.6], [0.36, 0.77, 6.2], [0.72, 0.8, 5.3]];
  const clumps = layout.map(([tx, ty, tr]) => {
    const r = tr * sc * rng.range(0.9, 1.06);
    const m = r * 1.08 + 1;
    return { cx: clamp(tx * w + rng.range(-1.5, 1.5), m, w - m - 1), cy: clamp(ty * h + rng.range(-1.5, 1.5), m, h - m - 1), r };
  });
  // Bunches (core + scalloped ring), back to front.
  const bunches = [];
  clumps.forEach((c, ci) => {
    const n = Math.max(6, Math.round(c.r * 1.15));
    const a0 = rng.next() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const d = c.r * rng.range(0.55, 0.68);
      bunches.push({ ci, x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d * 0.92, r: c.r * rng.range(0.33, 0.44), core: false });
    }
    bunches.push({ ci, x: c.cx - c.r * 0.08, y: c.cy - c.r * 0.1, r: c.r * 0.66, core: true });
  });
  // Clumps lower in the texture are in front; within a clump the core sits behind its top bunches.
  bunches.forEach((b, i) => { b.order = clumps[b.ci].cy * 10 + (b.core ? -2 : b.y - clumps[b.ci].cy) * 0.5 + i * 1e-3; });
  bunches.sort((a, b) => a.order - b.order);
  const owner = new Int16Array(w * h).fill(-1);
  bunches.forEach((b, bi) => {
    for (let y = Math.floor(b.y - b.r - 1); y <= b.y + b.r + 1; y++) {
      for (let x = Math.floor(b.x - b.r - 1); x <= b.x + b.r + 1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y);
        if (d <= b.r + 0.35) owner[y * w + x] = bi;
      }
    }
  });
  const shade = new Float32Array(w * h);
  s.each((x, y, i) => {
    const bi = owner[i];
    if (bi < 0) { s.set(x, y, null); return; }
    const b = bunches[bi];
    const c = clumps[b.ci];
    const dx = (x + 0.5 - c.cx) / (c.r * 1.05), dy = (y + 0.5 - c.cy) / (c.r * 1.05);
    const nz = Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy));
    const sph = dx * lx + dy * ly + nz * lz; // clump-scale light
    const bx = (x + 0.5 - b.x) / b.r, by = (y + 0.5 - b.y) / b.r;
    const bl = -(bx + by) * 0.7; // bunch-scale light
    let k = 2.5 + sph * 2.3 + (bl > 0.35 ? 1 : bl < -0.5 ? -1 : 0);
    if (b.core) k -= 0.6;
    // ambient occlusion where a bunch in front overlaps this one
    for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const o = owner[yy * w + xx];
      if (o > bi) { k -= 1.1; break; }
    }
    // sparse leaf flecks
    const r = hash2(x, y, seed + 3);
    if (r < 0.1) k += 1; else if (r > 0.93) k -= 1;
    shade[i] = k;
    s.hf[i] = 0.35 + nz * 0.45 + (bl > 0 ? 0.1 : 0);
  });
  // Silhouette rims: lit upper-left, dark lower-right.
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && owner[y * w + x] >= 0;
  s.each((x, y, i) => {
    if (owner[i] < 0) return;
    const tl = !solid(x - 1, y) || !solid(x, y - 1);
    const br = !solid(x + 1, y) || !solid(x, y + 1);
    let k = shade[i];
    if (tl && !br) k += 1.2;
    else if (br && !tl) k -= 1;
    s.set(x, y, R[clamp(Math.round(k), 1, 7)]);
  });
  // A few loose leaves near the silhouette.
  for (let n = 0; n < 6; n++) {
    const c = clumps[rng.int(0, clumps.length - 1)];
    const a = rng.range(Math.PI * 0.9, Math.PI * 2.1);
    const x = Math.round(c.cx + Math.cos(a) * (c.r + 2)), y = Math.round(c.cy + Math.sin(a) * (c.r + 2));
    if (x < 1 || y < 1 || x >= w - 2 || y >= h - 2 || solid(x, y) || solid(x + 1, y) || solid(x, y + 1)) continue;
    s.set(x, y, R[5]); s.set(x + 1, y, R[3]);
    s.setH(x, y, 0.7);
  }
  return { normal: 1.6, alpha: true };
}

function genPine(s, ctx) {
  const { w, h } = s; // 32×32, tiles horizontally; tiers of 8 px along v
  const { rng } = ctx;
  const P = ['#071216', '#0e2024', '#163338', '#1f4c3d', '#2f6846', '#4b8752', '#78a95f', '#a9cf80'].map(parseColor);
  const tierH = 8;
  const nT = h / tierH;
  const kmap = new Int8Array(w * h).fill(-1);
  const hmap = new Float32Array(w * h);
  const put = (x, y, k, hh) => { const i = s.ix(x, y); kmap[i] = k; hmap[i] = hh; };
  // Inner body of every tier (upper rows): deep shadow under the tier above.
  for (let t = 0; t < nT; t++) {
    for (let v = 0; v < 4; v++) for (let x = 0; x < w; x++) put(x, t * tierH + v, v < 3 ? 1 : 2, 0.2 + v * 0.05);
  }
  // Drooping fronds: V-shaped needle sprays pointing down, drawn bottom tier first so upper
  // tiers hang in front. Gaps between fronds stay transparent.
  for (let t = nT - 1; t >= 0; t--) {
    const y0 = t * tierH;
    const widths = splitWidths(w, 8, 11, rng);
    let x0 = rng.int(0, w - 1);
    for (const fw of widths) {
      const depth = rng.int(10, 11);
      const cxf = (fw - 1) / 2;
      for (let u = 0; u < fw; u++) {
        const a = Math.abs(u - cxf) / (cxf + 0.5); // 0 centre → 1 edge
        const bottom = Math.round(y0 + 5 + (depth - 5) * (1 - a * a * a));
        for (let y = y0 + 1; y <= bottom; y++) {
          const x = x0 + u;
          const f = (y - y0) / Math.max(1, bottom - y0);
          const left = u < cxf;
          let k = f < 0.2 ? 2 : 3 + Math.round((f - 0.2) * 2);
          if (left) k += 1; else if (u > cxf + 0.5) k -= 1;
          // herringbone needles running down and outward from the spine
          const side = left ? 1 : -1;
          if (mod(u * side + y, 3) === 0 && y < bottom) k -= 1;
          if (y === bottom) k = left || a < 0.2 ? 6 : 4; // tips catch the light
          if (a < 0.15 && y > y0 + 2 && y < bottom) k += 1; // lighter spine
          put(x, y, clamp(k, 1, 7), 0.35 + f * 0.55);
        }
      }
      x0 += fw;
    }
  }
  s.each((x, y, i) => {
    if (kmap[i] < 0) { s.set(x, y, null); return; }
    s.set(x, y, P[kmap[i]]);
    s.hf[i] = hmap[i];
  });
  for (let n = 0; n < 12; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1), i = s.ix(x, y);
    if (kmap[i] >= 5) s.set(x, y, P[7]);
  }
  return { normal: 1.6, alpha: true };
}

/**
 * Hay: straw bundles. Clumps are cells of a periodic Voronoi elongated along the straw; inside each
 * clump the strands run parallel (per-clump angle near vertical), alternating tones strand by strand,
 * brighter toward the clump's lit upper-left and darker at its lower end, with dark gaps between
 * clumps and a few loose lit straws lying across.
 */
function genHay(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const T = extRamp(PALETTE.thatch, 0.12, 0.05); // 8 steps
  const v = voronoi(w, h, 4, 3, seed + 3, { jitter: 0.85, sy: 0.6 });
  const clumps = [];
  for (let k = 0; k < v.count; k++) {
    const a = rng.range(-0.45, 0.45); // strand angle from vertical
    clumps.push({ c: Math.cos(a), s: Math.sin(a), off: rng.next() * 2, base: rng.pick([3, 4, 4, 4, 5]) });
  }
  const A = field(w, h, 4, 4, seed + 1, { oct: 2 });
  s.each((x, y, i) => {
    const cl = clumps[v.id[i]];
    const e = v.edge[i];
    if (e < 0.5) { s.set(x, y, T[hash2(x, y, seed) < 0.5 ? 2 : 1]); s.hf[i] = 0.1; return; }
    // coordinates across / along the strands
    const across = v.ox[i] * cl.c - v.oy[i] * cl.s + cl.off;
    const along = v.ox[i] * cl.s + v.oy[i] * cl.c;
    const strand = Math.floor(across);
    const q = hash2(v.id[i] * 31 + strand, Math.floor((along + 20) / 4), seed + 5);
    let k = cl.base + (q < 0.25 ? -1 : q < 0.85 ? 0 : 1);
    if (mod(strand, 2) === 1) k -= 1;
    const lit = -(v.ox[i] * 0.4 + v.oy[i]) / 6; // brighter toward the clump's upper-left
    if (lit > 0.35) k += 1; else if (lit < -0.45) k -= 1;
    if (e < 1.2 && v.ox[i] + v.oy[i] > 0) k -= 1; // shaded lower-right rim of the bundle
    if (A[i] < 0.1) k -= 1;
    s.set(x, y, ri(T, k));
    s.hf[i] = 0.3 + clamp(e / 4, 0, 1) * 0.5 + (mod(strand, 2) ? 0 : 0.08);
  });
  // loose straws lying across the bundles
  for (let n = 0; n < 14; n++) {
    const x0 = rng.int(0, w - 1), y0 = rng.int(0, h - 1);
    const ang = rng.range(-0.9, 0.9) + (rng.chance(0.5) ? Math.PI / 2 : 0);
    const len = rng.int(4, 7);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let t = 0; t < len; t++) {
      const px = Math.round(x0 + dx * t), py = Math.round(y0 + dy * t);
      s.set(px + 1, py + 1, T[1]);
    }
    for (let t = 0; t < len; t++) {
      const px = Math.round(x0 + dx * t), py = Math.round(y0 + dy * t);
      s.set(px, py, T[t === 0 ? 6 : 5]);
      s.setH(px, py, 0.9);
    }
  }
  return { normal: 1.6 };
}

function paintCloth(s, ctx, colorAt) {
  const { w, h } = s;
  const { seed } = ctx;
  const fold = new Float32Array(w);
  for (let x = 0; x < w; x++) fold[x] = pfbm((x / w) * 2, 0.5, 2, 1, seed + 1, 2);
  s.each((x, y, i) => {
    s.hf[i] = fold[x] * 0.9 + ((y & 1) ? 0.02 : 0);
  });
  s.each((x, y, i) => {
    const sl = (fold[mod(x + 1, w)] - fold[mod(x - 1, w)]) * 4;
    let k = sl > 0.3 ? 1 : sl < -0.3 ? -1 : 0;
    if (fold[x] < 0.3) k -= 1;
    const weave = hash2(x, y, seed + 5) < 0.06 ? 1 : 0; // sparse slubs in the weave
    s.set(x, y, colorAt(x, y, k, weave));
  });
}

function genClothRed(s, ctx) {
  const Rr = extRamp(PALETTE.red, 0.1, 0.05);
  paintCloth(s, ctx, (x, y, k, weave) => {
    const c = ri(Rr, 4 + k);
    return weave ? mix(c, ri(Rr, 3 + k), 0.3) : c;
  });
  return { normal: 6 };
}

function genClothStripe(s, ctx) {
  const Rr = extRamp(PALETTE.red, 0.1, 0.05);
  const Cr = extRamp(PALETTE.cream, 0.1, 0.03);
  paintCloth(s, ctx, (x, y, k, weave) => {
    const stripe = Math.floor(x / 4) % 2 === 0;
    const R = stripe ? Rr : Cr;
    const base = stripe ? 4 : 4;
    let kk = base + k;
    if (x % 4 === 3) kk -= 1; // stitched seam
    const c = ri(R, kk);
    return weave ? mix(c, ri(R, kk - 1), 0.25) : c;
  });
  return { normal: 6 };
}

function genMetal(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const M = extRamp(PALETTE.metal, 0.1, 0);
  const v = voronoi(w, h, 4, 4, seed + 3, { jitter: 0.9 });
  s.each((x, y, i) => {
    const dent = v.dist[i] / 3;
    s.hf[i] = 0.6 - dent * 0.12;
    if (x === 15 || y === 15) s.hf[i] = 0.2;
  });
  s.each((x, y, i) => {
    let k = 2 + clamp(stepOf(s.slope(x, y), 0.08, 0.3), -1, 1);
    if (x === 0 || y === 0) k = 4;
    if (x === 15 || y === 15) k = 1;
    s.set(x, y, M[k]);
  });
  for (const [rx, ry] of [[2, 2], [12, 2], [2, 12], [12, 12]]) {
    s.set(rx, ry, M[5]); s.set(rx + 1, ry, M[4]); s.set(rx, ry + 1, M[3]); s.set(rx + 1, ry + 1, M[2]);
    s.set(rx + 2, ry + 1, M[0]); s.set(rx + 1, ry + 2, M[0]); s.set(rx + 2, ry + 2, M[0]);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s.setH(rx + dx, ry + dy, 1);
    // a touch of rust
    s.tint(rx + 1, ry + 3, '#7a3f22', 0.5);
  }
  return { normal: 2.0 };
}

function genBarrel(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const W = extRamp(PALETTE.wood, 0.12, 0.08);
  const M = PALETTE.metal;
  s.each((x, y, i) => {
    const u = x % 4;
    let k = [5, 4, 4, 2][u];
    const g = hash2(x, y >> 2, seed);
    if (g < 0.12) k -= 1; else if (g > 0.94) k += 1;
    if (u === 3 && hash2(x, 0, seed + 1) < 0.5) k = 1;
    s.set(x, y, ri(W, k));
    s.hf[i] = [0.7, 0.8, 0.75, 0.4][u];
  });
  for (const hy of [2, 12]) {
    for (let x = 0; x < w; x++) {
      s.set(x, hy, M[3]); s.set(x, hy + 1, M[1]); s.tint(x, hy + 2, OUTLINE, 0.45);
      s.setH(x, hy, 1); s.setH(x, hy + 1, 0.9);
      if (x % 4 === 1) s.set(x, hy + 1, M[4]);
    }
  }
  return { normal: 1.8 };
}

function genCrate(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const W = extRamp(['#2a1a10', '#4a2f1c', '#6e4a2c', '#91683f', '#b58a55', '#d4ac72'], 0.1, 0.05);
  s.each((x, y, i) => {
    const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
    let k, hh;
    if (frame) {
      k = 4;
      if (x === 0 || y === 0) k = 5;
      if (x === 15 || y === 15) k = 2;
      if ((x === 1 && y >= 1 && y <= 14) || (y === 1 && x >= 1 && x <= 14)) k = 3;
      if ((x === 14 && y >= 1) || (y === 14 && x >= 1)) k = 3;
      hh = 1;
    } else {
      const v = (y - 2) % 4;
      k = v === 0 ? 1 : v === 1 ? 4 : 3;
      if (hash2(x >> 1, y, seed) < 0.1) k -= 1;
      hh = v === 0 ? 0.2 : 0.55;
      if (x === 2 || y === 2) k = Math.min(k, 2); // recessed shadow from frame
    }
    s.set(x, y, ri(W, k));
    s.hf[i] = hh;
  });
  // diagonal brace (bottom-left → top-right)
  for (let t = 2; t <= 13; t++) {
    const x = t, y = 15 - t;
    s.set(x, y, W[5]); s.set(x + 1, y, W[4]); s.set(x + 1, y + 1, W[1]);
    s.setH(x, y, 0.9); s.setH(x + 1, y, 0.9);
  }
  const M = PALETTE.metal;
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) { s.set(x, y, M[3]); }
  return { normal: 2.0 };
}

function genFenceWood(s, ctx) {
  const { w, h } = s; // 16×16 alpha, tiles horizontally
  const { seed } = ctx;
  const W = extRamp(['#2a1a10', '#46301f', '#664630', '#87603f', '#a87c52', '#c89c6c'], 0.1, 0.05);
  const M = PALETTE.metal;
  s.pc.clear();
  const posts = [2, 10];
  for (const px of posts) {
    for (let y = 2; y < h; y++) {
      for (let u = 0; u < 3; u++) {
        if (y === 2 && u !== 1) continue; // pointed top
        let k = [5, 4, 2][u];
        if (y === 2) k = 5;
        if (y === 3 && u === 0) k = 5;
        if (hash2(px + u, y >> 1, seed + 5) < 0.12) k -= 1;
        s.set(px + u, y, W[k]);
        s.setH(px + u, y, [0.7, 0.8, 0.6][u]);
      }
    }
  }
  for (const ry of [5, 10]) {
    for (let x = 0; x < w; x++) {
      s.set(x, ry, W[5]); s.set(x, ry + 1, W[3]); s.setH(x, ry, 1); s.setH(x, ry + 1, 0.9);
      if (hash2(x, ry, seed + 9) < 0.15) s.set(x, ry + 1, W[2]);
      // shadow of the rail onto the posts below it
      if (s.A(x, ry + 2)) s.set(x, ry + 2, W[1]);
    }
    for (const px of posts) { s.set(px + 1, ry, M[2]); s.set(px + 1, ry + 1, M[1]); }
  }
  return { normal: 1.6, alpha: true };
}

function genRope(s, ctx) {
  const { seed } = ctx;
  const R = extRamp(['#3a2a15', '#6b5530', '#9a8050', '#c4a870', '#e6d29a'], 0.1, 0.05);
  s.each((x, y, i) => {
    const t = mod(x + y, 4);
    let k = [4, 3, 3, 1][t];
    if (hash2(x, y, seed) < 0.12) k += t === 3 ? 0 : -1;
    s.set(x, y, R[k + 1]);
    s.hf[i] = [0.9, 0.75, 0.55, 0.15][t];
  });
  return { normal: 2.0 };
}

function genWellStone(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rows = bondRows(w, [8, 8, 8, 8], 7, 11, rng);
  const L = layoutBlocks(w, h, rows, { gap: 1, corner: () => [0, 1, 2, 3].map(() => rng.range(2.2, 3.2)) });
  const info = L.blocks.map(() => ({ R: rng.chance(0.65) ? STONE_COOL : STONE_WARM, base: rng.pick([2, 3, 3, 4]) }));
  const M = field(w, h, 2, 2, seed + 4, { oct: 3 });
  const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
  s.each((x, y, i) => {
    const b = L.id[i];
    s.hf[i] = b < 0 ? 0 : 0.25 + 0.75 * smoothstep(0, 3, L.dist[i]) + (N[i] - 0.5) * 0.12;
  });
  s.each((x, y, i) => {
    const b = L.id[i];
    if (b < 0) { s.set(x, y, L.id[s.ix(x, y - 1)] >= 0 ? '#16171e' : '#2a2c36'); return; }
    const st = info[b];
    let k = clamp(stepOf(s.slope(x, y), 0.25, 0.9), -2, 2);
    if (N[i] > 0.93) k += 1;
    let c = ri(st.R, st.base + k);
    if (M[i] > 0.74 && k >= 0 && L.dist[i] < 3 && mod(y, 8) < 4) c = mix(c, k > 0 ? PALETTE.moss[3] : PALETTE.moss[2], 0.55);
    else if (M[i] < 0.12) c = mix(c, '#1c2230', 0.3); // damp
    s.set(x, y, c);
  });
  return { normal: 2.4 };
}

function genLanternGlass(s, ctx) {
  const { w, h } = s; // 16×16
  const M = extRamp(['#0c0b10', '#1b1a22', '#2e2d38', '#4b4a58', '#6e6d7c'], 0.05, 0.1);
  const Gl = [parseColor('#7a3f12'), parseColor('#b3621c'), parseColor('#e08a2a'), parseColor('#f5b041'), parseColor('#ffd86e'), parseColor('#fff2c2')];
  const em = s.emissive();
  s.each((x, y, i) => {
    const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14 || x === 7 || x === 8;
    if (frame) {
      let k = 2;
      if (x === 0 || y === 0) k = 3;
      if (x === 15 || y === 15) k = 1;
      if (x === 7) k = 3;
      if (x === 8) k = 1;
      if ((x === 1 && y > 0 && y < 15) || (y === 1 && x > 0 && x < 15)) k = 1;
      s.set(x, y, M[k]);
      s.hf[i] = 1;
      return;
    }
    const d = Math.hypot((x + 0.5 - 8) / 5.5, (y + 0.5 - 9.5) / 6.5);
    let k = d < 0.35 ? 5 : d < 0.6 ? 4 : d < 0.85 ? 3 : d < 1.05 ? 2 : 1;
    if (y <= 3) k = Math.min(k, 2); // soot at the top
    if ((x === 2 || x === 9) && y > 2) k = Math.min(5, k + 1); // glass edge glint
    s.set(x, y, Gl[k]);
    s.hf[i] = 0.3;
    const g = Math.round(clamp(1.05 - d * 0.45, 0.45, 1) * 255);
    em.set(x, y, [g, g, g, 255]);
  });
  // corner brackets
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { s.set(x, y, M[2]); em.set(x, y, '#000000'); }
  return { normal: 1.5 };
}

function genSignBoard(s, ctx) {
  const { w, h } = s; // 32×16
  const { seed } = ctx;
  const W = extRamp(['#2a1a10', '#4a2f1c', '#6e4a2c', '#91683f', '#b58a55', '#d4ac72'], 0.1, 0.05);
  const G = field(w, h, 2, 4, seed + 2, { oct: 3 });
  s.each((x, y, i) => {
    const border = x === 0 || x === w - 1 || y === 0 || y === h - 1;
    let k;
    if (border) {
      k = x === 0 || y === 0 ? 3 : 1;
      s.hf[i] = 0.7;
    } else {
      const v = y <= 7 ? y - 1 : y - 8;
      k = v === 0 ? 4 : v === 6 ? 2 : 3;
      if (y === 7) k = 1;
      if (G[i] < 0.12) k -= 1; else if (G[i] > 0.93) k += 1;
      s.hf[i] = y === 7 ? 0.2 : 0.6;
    }
    s.set(x, y, ri(W, k + 1));
  });
  // carved pseudo-lettering (two words), lit lower-right edges
  const glyphs = ['101111101', '111100111', '110101110', '111010010', '101101111', '010101101', '111101101', '100111101'];
  let gx = 5;
  const gy = 5;
  for (let g = 0; g < 7; g++) {
    if (g === 3) { gx += 3; continue; }
    const pat = glyphs[Math.floor(hash2(g, 1, seed) * glyphs.length)];
    for (let v = 0; v < 3; v++) {
      for (let u = 0; u < 3; u++) {
        if (pat[v * 3 + u] !== '1') continue;
        for (let dy = 0; dy < 2; dy++) {
          const x = gx + u, y = gy + v * 2 + dy;
          if (y > 12) continue;
          s.set(x, y, W[1]);
          s.setH(x, y, 0.2);
          if (s.H(x + 1, y + 1) > 0.3 && y + 1 !== 7) s.set(x + 1, y + 1, W[5]);
        }
      }
    }
    gx += 4;
  }
  const M = PALETTE.metal;
  for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) { s.set(x, y, M[3]); s.set(x + 1, y + 1, W[1]); }
  return { normal: 1.8 };
}

function genFlowerbox(s, ctx) {
  const { w, h } = s; // 16×16 alpha on top
  const { rng, seed } = ctx;
  const W = extRamp(['#2a1a10', '#46301f', '#664630', '#87603f', '#a87c52', '#c89c6c'], 0.1, 0.05);
  const G = extRamp(PALETTE.leaves, 0.1, 0.05);
  s.pc.clear();
  // leaf mass with ragged top
  const top = new Int32Array(w);
  for (let x = 0; x < w; x++) top[x] = 5 + Math.round(pnoise((x / w) * 4, 0.3, 4, 1, seed) * 3) - (hash2(x, 0, seed) < 0.3 ? 1 : 0);
  for (let x = 0; x < w; x++) {
    for (let y = top[x]; y <= 9; y++) {
      const lo = (hash2(x >> 1, y >> 1, seed + 1) - 0.5) * 2;
      let k = 3 + (y - top[x] <= 1 ? 2 : 0) + Math.round(lo) - (y >= 8 ? 2 : 0);
      if (x % 3 === 0 && y > top[x]) k -= 1;
      s.set(x, y, G[clamp(k, 1, 6)]);
      s.setH(x, y, 0.6);
    }
  }
  // flowers
  const kinds = ['red', 'yellow', 'white', 'pink', 'purple', 'red', 'yellow'];
  let x = rng.int(0, 2);
  let n = 0;
  while (x < w) {
    const col = FLOWER_COLORS[kinds[n % kinds.length]];
    const y = top[mod(x, w)] - rng.int(0, 1);
    // stem
    s.set(x, y + 2, G[2]);
    s.set(x, y - 1, col.petal); s.set(x - 1, y, col.petal); s.set(x + 1, y, col.shade); s.set(x, y + 1, col.shade); s.set(x, y, col.center);
    s.setH(x, y, 0.9);
    x += rng.int(3, 4);
    n++;
  }
  // box
  for (let y = 9; y < h; y++) {
    for (let bx = 0; bx < w; bx++) {
      let k;
      if (y === 9) k = 5;
      else if (y === 10) k = 3;
      else if (y === 13) k = 1;
      else if (y === 15) k = 1;
      else k = hash2(bx >> 2, y, seed) < 0.2 ? 2 : 3;
      if (y > 9 && (bx === 0 || bx === 7 || bx === 8 || bx === 15) && y !== 13) k = bx === 0 || bx === 8 ? 4 : 2; // corner posts / plank joint
      s.set(bx, y, W[k]);
      s.setH(bx, y, y === 9 ? 1 : 0.7);
    }
  }
  const M = PALETTE.metal;
  for (const nx of [1, 6, 9, 14]) s.set(nx, 11, M[2]);
  return { normal: 1.6, alpha: true };
}

// ---------------------------------------------------------------------------
// Furniture (on demand — not in TEXTURE_NAMES: painted only when a room's furniture asks for
// them, src/engine/world/props/Furniture.js; a level without furniture paints none of them)
// ---------------------------------------------------------------------------

/** Warm, planed furniture oak. */
const FURN = extRamp(['#3a2316', '#5a3822', '#7a4f2e', '#9a6a3c', '#b8854c', '#d2a265'], 0.1, 0.05);
/** Dark shelf back behind books and jars (darkest under the board above). */
const SHELF_BACK = ['#0e0a09', '#18110e', '#221812'].map(parseColor);

/**
 * furniture_wood (32×32 = 2×2 u): smooth joined boards 8 px wide running along u, long grain
 * streaks, a planed edge catching the light on each board and a butt joint on most — no nails.
 */
function genFurnitureWood(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const G = field(w, h, 2, 16, seed + 3, { oct: 3 });
  const rows = Array.from({ length: h / 8 }, () => ({ base: rng.pick([3, 3, 4, 4, 5]), joint: rng.chance(0.7) ? rng.int(0, w - 1) : -1 }));
  s.each((x, y, i) => {
    const r = y % 8;
    const b = rows[(y / 8) | 0];
    const seam = r === 7;
    const joint = x === b.joint && !seam;
    s.hf[i] = seam || joint ? 0.15 : 0.55 + (r === 0 ? 0.15 : 0) + (G[i] - 0.5) * 0.1;
    let k = b.base;
    if (G[i] < 0.14) k -= 1; else if (G[i] > 0.9) k += 1;
    if (r === 0) k += 1;
    if (r === 6) k -= 1;
    if (seam) k = 1;
    if (joint) k = 2;
    s.set(x, y, ri(FURN, k));
  });
  return { normal: 1.1 };
}

/** Book cloth colours (spines). */
const BOOK_RAMPS = [PALETTE.red, PALETTE.blue, PALETTE.green, PALETTE.brown, PALETTE.purple, PALETTE.cream,
  ['#3a2410', '#6b4515', '#a5701f', '#c98a2e', '#e0a94a']].map((R) => extRamp(R, 0.1, 0.05));

/**
 * books (32×8 = 2 × 0.5 u, tiles along u): one shelf compartment — book spines 2–4 px wide and 4–7
 * px tall standing on the bottom row (lit left edge, shaded right edge, gilt bands on some), a
 * stack lying flat now and then, gaps; the dark shelf back above them.
 */
function genBooks(s, ctx) {
  const { w, h } = s;
  const { rng } = ctx;
  const Gd = extRamp(PALETTE.gold, 0.1, 0.05);
  s.each((x, y, i) => { s.set(x, y, SHELF_BACK[y <= 1 ? 0 : 1]); s.hf[i] = 0.05; });
  const spine = (x0, bw, top, R, band) => {
    for (let dx = 0; dx < bw; dx++) {
      for (let y = top; y < h; y++) {
        let k = dx === 0 ? 4 : dx === bw - 1 && bw > 1 ? 2 : 3;
        if (y === top) k += 1;
        let c = ri(R, k);
        if (band && (y === top + 1 || y === h - 2) && h - top >= 5) c = ri(Gd, dx === 0 ? 5 : 3);
        s.set(x0 + dx, y, c);
        s.setH(x0 + dx, y, dx === 0 ? 0.9 : dx === bw - 1 ? 0.55 : 0.8);
      }
    }
  };
  let x = 0;
  while (x < w) {
    if (x > 0 && x < w - 2 && rng.chance(0.08)) { x += 1; continue; } // a gap
    if (x <= w - 6 && rng.chance(0.1)) {
      // a short stack of books lying flat, each 2 px thick
      const bw = rng.int(5, 6);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const R = rng.pick(BOOK_RAMPS);
        const y0 = h - 2 * (k + 1);
        const off = k === 0 ? 0 : rng.int(0, 1);
        for (let dx = off; dx < bw - (k ? rng.int(0, 1) : 0); dx++) {
          s.set(x + dx, y0, ri(R, 5)); s.set(x + dx, y0 + 1, ri(R, dx === off ? 3 : 2));
          s.setH(x + dx, y0, 0.8); s.setH(x + dx, y0 + 1, 0.7);
        }
      }
      x += bw;
      continue;
    }
    const bw = Math.min(rng.pick([2, 2, 3, 3, 3, 4]), w - x);
    spine(x, bw, h - rng.int(4, 7), rng.pick(BOOK_RAMPS), rng.chance(0.5));
    x += bw;
  }
  return { normal: 1.6 };
}

/**
 * pantry (32×8 = 2 × 0.5 u, tiles along u): a shelf of stores — glass jars of pickles, jam and honey
 * with cloth or tin lids, bottles, a stoneware crock, a tied sack, a cheese wheel; the dark shelf
 * back above them.
 */
function genPantry(s, ctx) {
  const { w, h } = s;
  const { rng } = ctx;
  s.each((x, y, i) => { s.set(x, y, SHELF_BACK[y <= 1 ? 0 : 1]); s.hf[i] = 0.05; });
  const P = (c) => parseColor(c);
  const contents = [
    ['#1d3a1c', '#2f5a28', '#4f7f34', '#7aa64a'], // pickles
    ['#3a0c14', '#6e1522', '#a8283a', '#d65a5a'], // jam
    ['#5a3008', '#9a5a10', '#d6921e', '#f2c45a'], // honey
    ['#3a2a3a', '#5a3a5e', '#80507e', '#a878a6'], // plums
  ].map((R) => R.map(P));
  const M = PALETTE.metal;
  const Rd = extRamp(PALETTE.red, 0.1, 0.05);
  const Cr = extRamp(PALETTE.cream, 0.1, 0.03);
  const put = (x, y, c, hh = 0.8) => { s.set(x, y, c); s.setH(x, y, hh); };
  const jar = (x0, bw, bh) => {
    const R = rng.pick(contents);
    const top = h - bh;
    for (let dx = 0; dx < bw; dx++) {
      for (let y = top + 1; y < h; y++) put(x0 + dx, y, R[dx === 0 ? 3 : dx === bw - 1 ? 0 : y === top + 1 ? 1 : 2], dx === 0 ? 0.9 : 0.7);
    }
    // the glass: a glint on the shoulder, the lid (tin or a red-checked cloth)
    put(x0, top + 1, P('#e8f4f0'));
    const cloth = rng.chance(0.5);
    for (let dx = -1; dx <= bw; dx++) {
      if (!cloth && (dx < 0 || dx >= bw)) continue;
      put(x0 + dx, top, cloth ? (dx & 1 ? ri(Rd, 4) : ri(Cr, 5)) : M[dx === 0 ? 4 : 3], 1);
    }
  };
  const bottle = (x0, bh) => {
    const glass = rng.pick([['#0c1e14', '#16361f', '#2a5a30'], ['#1e1006', '#3a2210', '#5e3a18']].map((R) => R.map(P)));
    const top = h - bh;
    for (let y = top; y < h; y++) {
      const neck = y < top + 2;
      put(x0, y, neck ? (y === top ? P('#c9a46a') : glass[2]) : glass[2]);
      if (!neck) put(x0 + 1, y, glass[y === top + 2 ? 1 : 0], 0.6);
    }
    put(x0, top + 3, P('#9fd6b0'));
  };
  const crock = (x0) => {
    const top = h - 5;
    const C = ['#3a2a20', '#5e4636', '#86684e', '#ab8c6a'].map(P);
    for (let dx = 0; dx < 4; dx++) {
      for (let y = top; y < h; y++) {
        let c = C[dx === 0 ? 3 : dx === 3 ? 0 : 2];
        if (y === top + 2) c = P(dx === 0 ? '#5a7aa6' : '#3d5a86'); // blue band
        if (y === top && (dx === 0 || dx === 3)) continue;
        put(x0 + dx, y, c);
      }
    }
  };
  const sack = (x0) => {
    const B = ['#4a3a26', '#6e5838', '#94784e', '#b89c6a', '#d6bf8e'].map(P);
    const top = h - 6;
    for (let dx = 0; dx < 5; dx++) {
      for (let y = top; y < h; y++) {
        const pinch = y <= top + 1 && (dx === 0 || dx === 4);
        if (pinch || (y === top && dx !== 2)) continue;
        let k = dx === 0 ? 4 : dx === 4 ? 1 : 3;
        if (y === top + 2) k = 1; // the tie
        if (((dx + y) & 1) && k > 1) k -= 1;
        put(x0 + dx, y, B[k]);
      }
    }
  };
  const cheese = (x0) => {
    const Y = extRamp(PALETTE.yellow, 0.1, 0.05);
    for (let dx = 0; dx < 5; dx++) {
      for (let y = h - 3; y < h; y++) put(x0 + dx, y, y === h - 3 ? ri(Y, 6) : dx === 0 ? ri(Y, 5) : dx === 4 ? ri(Y, 3) : ri(Y, 4));
    }
    put(x0 + 1, h - 2, ri(Y, 2));
  };
  let x = 0;
  while (x < w) {
    const kind = rng.pick(['jar', 'jar', 'jar', 'bottle', 'bottle', 'crock', 'sack', 'cheese']);
    const need = { jar: 5, bottle: 3, crock: 5, sack: 6, cheese: 6 }[kind];
    if (x + need > w) {
      if (x + 3 <= w) bottle(x);
      break;
    }
    if (kind === 'jar') { const bw = rng.int(3, 4); jar(x + 1, bw, rng.int(5, 6)); x += bw + 2; }
    else if (kind === 'bottle') { bottle(x, rng.int(6, 7)); x += 3; }
    else if (kind === 'crock') { crock(x); x += 5; }
    else if (kind === 'sack') { sack(x); x += 6; }
    else { cheese(x); x += 6; }
  }
  return { normal: 1.5 };
}

/** linen (16×16): off-white woven cloth with soft folds — sheets, pillows, table cloths. */
function genLinen(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const R = ['#776d62', '#a39888', '#c7bcab', '#e0d8c8', '#efe9dc', '#faf6ee'].map(parseColor);
  const G = field(w, h, 2, 2, seed + 1, { oct: 2 });
  s.each((x, y, i) => { s.hf[i] = G[i] * 0.5 + ((x + y) & 1 ? 0.025 : 0); });
  s.each((x, y) => {
    let k = 4 + clamp(stepOf(s.slope(x, y), 0.1, 0.35), -1, 1);
    if (hash2(x, y, seed) < 0.05) k -= 1;
    s.set(x, y, ri(R, k));
  });
  return { normal: 1.2 };
}

/**
 * quilt_<colour> (32×32 = 2×2 u): a patchwork of 8 px quilted squares — plain, lighter, checked,
 * cream and diamond patches — puffed between dark seams with light stitches.
 */
function genQuilt(s, ctx, R0) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const R = extRamp(R0, 0.1, 0.05);
  const A = extRamp(PALETTE.cream, 0.1, 0.03);
  const n = w / 8;
  const pat = Array.from({ length: n * n }, () => rng.pick(['main', 'main', 'light', 'check', 'accent', 'diamond']));
  s.each((x, y, i) => {
    const d = Math.max(Math.abs((x % 8) - 3.5), Math.abs((y % 8) - 3.5)) / 4;
    s.hf[i] = 0.75 - d * d * 0.5 + (hash2(x, y, seed) - 0.5) * 0.04;
  });
  s.each((x, y) => {
    const px = x % 8;
    const py = y % 8;
    const p = pat[(y >> 3) * n + (x >> 3)];
    let k = clamp(stepOf(s.slope(x, y), 0.12, 0.4), -1, 1);
    let ramp = R;
    let base = 4;
    if (p === 'light') base = 5;
    else if (p === 'accent') ramp = A;
    else if (p === 'check' && (((px >> 1) + (py >> 1)) & 1)) ramp = A;
    else if (p === 'diamond' && Math.abs(px - 3.5) + Math.abs(py - 3.5) < 3) ramp = A;
    if (px === 7 || py === 7) {
      ramp = R; base = 2; k = 0;
      if ((x + y) % 3 === 0) { ramp = A; base = 3; }
    }
    s.set(x, y, ri(ramp, base + k));
  });
  return { normal: 1.6 };
}

/**
 * rug_<colour> (32×32 = 2×2 u, tiles): the woven field of a rug — a gold-ringed diamond per unit
 * with a dark heart and a cream eye, cream dots between, a fine weave.
 */
function genRug(s, ctx, R0) {
  const { w, h } = s;
  const { seed } = ctx;
  const R = extRamp(R0, 0.1, 0.04);
  const A = extRamp(PALETTE.cream, 0.1, 0.03);
  const Gd = extRamp(PALETTE.gold, 0.1, 0.05);
  s.each((x, y, i) => {
    const px = x % 16;
    const py = y % 16;
    const d = Math.abs(px - 7.5) + Math.abs(py - 7.5);
    const weave = (x + y) & 1;
    s.hf[i] = 0.5 + weave * 0.05 + (d < 7.5 ? 0.08 : 0);
    let c;
    if (d >= 6 && d < 7.5) c = ri(Gd, weave ? 4 : 3);
    else if (d < 1.5) c = ri(A, 5);
    else if (d < 3.5) c = ri(R, 2 + weave);
    else if (d < 6) c = ri(R, 5 - weave);
    else if (d > 13.5) c = ri(A, 4);
    else c = ri(R, 3 + (hash2(x >> 1, y, seed) < 0.15 ? -1 : weave));
    s.set(x, y, c);
  });
  return { normal: 1 };
}

/**
 * rug_border (16×8 = 1 × 0.5 u, tiles along u): the woven band around a rug, outer edge on canvas
 * row 0 — dark edge, gold, a cream band with a red zigzag, gold, dark (rows 0–5; 6–7 repeat dark).
 */
function genRugBorder(s, ctx) {
  const Gd = extRamp(PALETTE.gold, 0.1, 0.05);
  const A = extRamp(PALETTE.cream, 0.1, 0.03);
  const dark = ['#2a160f', '#3b2216'].map(parseColor);
  s.each((x, y, i) => {
    const weave = (x + y) & 1;
    let c;
    if (y === 0 || y >= 5) c = dark[weave];
    else if (y === 1 || y === 4) c = ri(Gd, 3 + weave);
    else {
      const zig = (y === 2 && x % 4 === 1) || (y === 3 && x % 4 === 3);
      c = zig ? parseColor('#8c2330') : ri(A, 4 + weave);
    }
    s.set(x, y, c);
    s.hf[i] = y === 0 || y >= 5 ? 0.35 : 0.55 + weave * 0.05;
  });
  return { normal: 1 };
}

/**
 * embers (16×16, emissive): a bed of charcoal lumps split by glowing cracks, a few coals still red
 * hot — the emissive mask is white where it glows.
 */
function genEmbers(s, ctx) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 4, 4, seed + 7, { jitter: 0.85, round: 0.8 });
  const C = ['#0d0a0b', '#1a1314', '#29201f', '#3c302c', '#574740'].map(parseColor);
  const F = PALETTE.fire.map(parseColor);
  const hot = Array.from({ length: v.count }, () => rng.chance(0.3));
  const em = s.emissive();
  s.each((x, y, i) => { s.hf[i] = clamp(v.edge[i] / 3, 0, 1) * 0.8; });
  s.each((x, y, i) => {
    const e = v.edge[i];
    if (e < 0.9) {
      s.set(x, y, F[e < 0.45 ? 4 : 3]);
      const g = e < 0.45 ? 255 : 200;
      em.set(x, y, [g, g, g, 255]);
    } else if (hot[v.id[i]]) {
      const k = e < 1.8 ? 2 : 1;
      s.set(x, y, F[k]);
      const g = k === 2 ? 150 : 90;
      em.set(x, y, [g, g, g, 255]);
    } else {
      const k = clamp(2 + stepOf(s.slope(x, y), 0.1, 0.3), 0, 4);
      s.set(x, y, C[k]);
    }
  });
  return { normal: 1.4 };
}

/**
 * window_inside (16×24 = 1 × 1.5 u, tiles along u): a casement seen from inside a room — 2 × 3
 * panes between dark muntins, a glint across them. The colour map is a dusky sky (the night); the
 * emissive mask lights the panes by day (the window's material picks the colour: daylight or warm).
 */
function genWindowInside(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const F = extRamp(['#1f140e', '#34221a', '#4f3322', '#6b4a30', '#8a6440'], 0.1, 0.1);
  // a dusky sky in the colour map (what shows at night); the emissive (daylight / warm) brightens it
  const sky = ['#1d2f48', '#27405e', '#335274', '#43668a', '#587d9e', '#7397b3'].map(parseColor);
  const em = s.emissive();
  const muntinY = (y) => y === 0 || y === 7 || y === 15 || y === h - 1;
  const muntinX = (x) => x === 0 || x === 7 || x === 8 || x === w - 1;
  const G = field(w, h, 2, 3, seed + 5, { oct: 2 });
  s.each((x, y, i) => {
    if (muntinX(x) || muntinY(y)) {
      let k = 3;
      if (x === 0 || y === 0 || x === 7) k = 4;
      if (x === w - 1 || y === h - 1 || x === 8) k = 2;
      s.set(x, y, ri(F, k));
      s.hf[i] = 0.9;
      return;
    }
    // panes: lighter toward the top, a soft cloud, a recess shadow under the muntin above
    const t = y / h;
    let k = clamp(Math.round(4.6 - t * 3 + (G[i] - 0.5) * 1.6), 1, 5);
    if (muntinY(y - 1) || muntinX(x - 1)) k = Math.max(1, k - 2);
    const px = x <= 6 ? x - 1 : x - 9;
    const py = y < 7 ? y - 1 : y < 15 ? y - 8 : y - 16;
    if (px + py === 4 || px + py === 5) k = Math.min(5, k + 1); // glint
    s.set(x, y, sky[k]);
    s.hf[i] = 0.2;
    const g = Math.round(clamp(0.78 + (1 - t) * 0.22 - (muntinY(y - 1) ? 0.15 : 0), 0, 1) * 255);
    em.set(x, y, [g, g, g, 255]);
  });
  return { normal: 1.6 };
}

/**
 * light_beam (16×32, emissive only — its material is black and additive): a shaft of window light.
 * Rows 0–23 (v 1 → 0.25) the shaft, brightest at the window and fading toward the floor in a few
 * flat steps, with faint rays and soft sides; rows 24–31 (v 0.25 → 0) the lit patch on the floor.
 */
function genLightBeam(s, ctx) {
  const { w } = s;
  const { seed } = ctx;
  const em = s.emissive();
  const ray = Array.from({ length: w }, (_, x) => 0.86 + 0.14 * hash2(x >> 1, 0, seed));
  s.each((x, y, i) => {
    s.set(x, y, '#ffffff');
    s.hf[i] = 0.5;
    const side = Math.min(1, (Math.min(x, w - 1 - x) + 0.5) / 3);
    let e;
    if (y < 24) e = (1 - (y / 23) * 0.78) * ray[x] * side;
    else e = 0.32 * side * Math.min(1, (Math.min(y - 24, 31 - y) + 0.5) / 2.5);
    // flat pixel-art steps (no dither: an ordered dither reads as a checkerboard at this size)
    const g = Math.round(clamp(Math.round(e * 8) / 8, 0, 1) * 255);
    em.set(x, y, [g, g, g, 255]);
  });
  return { normal: 0 };
}

/** burlap (16×16): sack cloth — pale oat, a fine weave, soft creases and a few darker flecks. */
function genBurlap(s, ctx) {
  const { w, h } = s;
  const { seed } = ctx;
  const B = ['#5e4c36', '#857055', '#a99270', '#c4ad86', '#d8c49c', '#e8dbb8'].map(parseColor);
  const G = field(w, h, 2, 2, seed + 2, { oct: 2 });
  s.each((x, y, i) => { s.hf[i] = G[i] * 0.7 + ((x + y) & 1 ? 0.03 : 0); });
  s.each((x, y) => {
    let k = 3 + clamp(stepOf(s.slope(x, y), 0.07, 0.25), -2, 1);
    if (hash2(x, y, seed) < 0.05) k -= 1;
    if ((x & 3) === 0 && (y & 1) === 0 && k > 1) k -= 1; // the weave's rows
    s.set(x, y, ri(B, k));
  });
  return { normal: 1.2 };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/**
 * A texture definition of the library.
 * @typedef {object} TexDef
 * @property {[number, number]} px  canvas size (units = px / PPU)
 * @property {Function} gen  gen(surf, ctx) paints color + height (+ emissive) and returns
 *   { normal: strength }
 * @property {number} [normalScale]
 * @property {boolean} [emissive]
 * @property {boolean} [alpha]
 * @property {boolean} [wrap]  seamless painting (defaults to !alpha)
 */
/**
 * A painter re-coloured onto a ramp by luminance: `gen` paints as it does (its height field, hence
 * its normals, stays), then every opaque pixel takes the ramp tone of its luminance band (the 2nd to
 * 98th percentile of the texture spread over the ramp, dark → light). The foundation's stub
 * textures of ./textures/*.js are made this way.
 * @param {(s: Surf, ctx: any) => any} gen a painter (`TexDef.gen`)
 * @param {string[]} hexes the ramp, dark → light
 * @returns {(s: Surf, ctx: any) => any}
 */
function gradientMap(gen, hexes) {
  const ramp = hexes.map(parseColor);
  return (s, ctx) => {
    const res = gen(s, ctx);
    const lum = new Float32Array(s.w * s.h).fill(-1);
    const seen = [];
    s.each((x, y, i) => {
      const c = s.get(x, y);
      if (!c[3]) return;
      lum[i] = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      seen.push(lum[i]);
    });
    if (!seen.length) return res;
    seen.sort((a, b) => a - b);
    const lo = seen[Math.floor((seen.length - 1) * 0.02)];
    const hi = seen[Math.ceil((seen.length - 1) * 0.98)];
    const span = Math.max(1, hi - lo);
    s.each((x, y, i) => {
      if (lum[i] < 0) return;
      const k = clamp(Math.round(((lum[i] - lo) / span) * (ramp.length - 1)), 0, ramp.length - 1);
      const c = ramp[k];
      s.set(x, y, [c[0], c[1], c[2], s.A(x, y)]);
    });
    return res;
  };
}

/**
 * What a texture set module (./textures/*.js) builds its definitions with: the painters of this file
 * (each `gen(surf, ctx, …)`), the shared painting helpers and colour tools, and `gradientMap`.
 * Modules import nothing of this file at run time (no cycle): `@import { TextureKit, TexDef } from
 * '../Textures.js'` for the types.
 */
const TEXTURE_KIT = Object.freeze({
  PALETTE, parseColor, mixColor, shadeColor, extRamp, blendRamp, clamp, smoothstep, RNG, hash2, bayer4,
  field, stepOf, gradientMap,
  genGrass, genDirt, genSand, genCobblestone, genStoneTiles, genMossStone, genCliff, genGrassSide, genDirtSide, genCrag,
  genPlaster, genBrick, genStoneBrick, genClayRoof, genRoofSlate,
  // (the season set's canopies and barks: ./textures/seasons.js)
  genFoliage, genBark,
});
/** @typedef {typeof TEXTURE_KIT} TextureKit */

/** @type {Record<string, TexDef>} */
const BASE_DEFS = {
  // terrain tops (4×4 units so large fields don't repeat visibly)
  grass: { px: [64, 64], gen: (s, c) => genGrass(s, c), normalScale: 0.45 },
  grass_dark: { px: [64, 64], gen: (s, c) => genGrass(s, c, { ramp: GRASS_DARK_RAMP, warm: 0.2, density: 0.85 }), normalScale: 0.45 },
  grass_flowers: { px: [64, 64], gen: (s, c) => genGrass(s, c, { flowers: 14, density: 0.72 }), normalScale: 0.45 },
  dirt: { px: [64, 64], gen: (s, c) => genDirt(s, c, { base: 3, cracks: 3, sprigs: 4 }), normalScale: 0.6 },
  dirt_path: { px: [64, 64], gen: (s, c) => genDirt(s, c, { base: 4, ruts: 6, cracks: 2, pebbles: 30, cool: true }), normalScale: 0.6 },
  cobblestone: { px: [64, 64], gen: (s, c) => genCobblestone(s, c), normalScale: 0.7 },
  stone_tiles: { px: [64, 64], gen: genStoneTiles, normalScale: 0.6 },
  sand: { px: [64, 64], gen: genSand, normalScale: 0.5 },
  farmland: { px: [64, 64], gen: genFarmland, normalScale: 0.6 },
  moss_stone: { px: [64, 64], gen: genMossStone, normalScale: 0.7 },
  riverbed: { px: [64, 64], gen: genRiverbed, normalScale: 0.7 },
  wood_deck: { px: [64, 64], gen: genWoodDeck, normalScale: 0.55 },
  // terrain sides
  cliff: { px: [16, 16], gen: genCliff, normalScale: 0.7 },
  grass_side: { px: [16, 16], gen: genGrassSide, normalScale: 0.7 },
  dirt_side: { px: [16, 16], gen: genDirtSide, normalScale: 0.7 },
  stone_wall: { px: [32, 32], gen: genStoneWall, normalScale: 0.65 },
  // on demand only (not in TEXTURE_NAMES): a level's legend asks for it by name
  crag: { px: [32, 32], gen: genCrag, normalScale: 0.7 },
  // buildings
  plaster: { px: [64, 64], gen: genPlaster, normalScale: 0.5 },
  timber_frame: { px: [32, 32], gen: genTimberFrame, normalScale: 0.6 },
  wood_planks: { px: [32, 32], gen: genWoodPlanks, normalScale: 0.5 },
  wood_planks_dark: { px: [32, 32], gen: genWoodPlanksDark, normalScale: 0.5 },
  log_wall: { px: [32, 32], gen: genLogWall, normalScale: 0.6 },
  brick: { px: [32, 32], gen: genBrick, normalScale: 0.6 },
  stone_brick: { px: [32, 32], gen: genStoneBrick, normalScale: 0.6 },
  roof_red: { px: [32, 32], gen: (s, c) => genClayRoof(s, c, PALETTE.roofRed), normalScale: 0.7 },
  roof_blue: { px: [32, 32], gen: (s, c) => genClayRoof(s, c, PALETTE.roofBlue), normalScale: 0.7 },
  roof_thatch: { px: [32, 32], gen: genRoofThatch, normalScale: 0.6 },
  roof_slate: { px: [32, 32], gen: genRoofSlate, normalScale: 0.65 },
  door: { px: [16, 32], gen: genDoor, normalScale: 0.6 },
  window: { px: [16, 16], gen: genWindow, normalScale: 0.7, emissive: true },
  chimney_stone: { px: [32, 32], gen: genChimneyStone, normalScale: 0.65 },
  // nature & props
  bark: { px: [16, 32], gen: genBark, normalScale: 0.7 },
  leaves: { px: [32, 32], gen: (s, c) => genFoliage(s, c, PALETTE.leaves), normalScale: 0.6, alpha: true },
  leaves_autumn: { px: [32, 32], gen: (s, c) => genFoliage(s, c, PALETTE.leavesAutumn), normalScale: 0.6, alpha: true },
  pine: { px: [32, 32], gen: genPine, normalScale: 0.6, alpha: true, wrap: true },
  hay: { px: [32, 32], gen: genHay, normalScale: 0.7 },
  cloth_red: { px: [32, 32], gen: genClothRed, normalScale: 0.5 },
  cloth_stripe: { px: [32, 32], gen: genClothStripe, normalScale: 0.5 },
  metal: { px: [16, 16], gen: genMetal, normalScale: 0.6 },
  barrel: { px: [16, 16], gen: genBarrel, normalScale: 0.6 },
  crate: { px: [16, 16], gen: genCrate, normalScale: 0.6 },
  fence_wood: { px: [16, 16], gen: genFenceWood, normalScale: 0.7, alpha: true, wrap: true },
  rope: { px: [16, 16], gen: genRope, normalScale: 0.8 },
  well_stone: { px: [32, 32], gen: genWellStone, normalScale: 0.65 },
  lantern_glass: { px: [16, 16], gen: genLanternGlass, normalScale: 0.5, emissive: true },
  sign_board: { px: [32, 16], gen: genSignBoard, normalScale: 0.8 },
  flowerbox: { px: [16, 16], gen: genFlowerbox, normalScale: 0.7, alpha: true, wrap: true },
  // furniture — on demand only (not in TEXTURE_NAMES): props/Furniture.js asks for them by name
  furniture_wood: { px: [32, 32], gen: genFurnitureWood, normalScale: 0.5 },
  books: { px: [32, 8], gen: genBooks, normalScale: 0.6 },
  pantry: { px: [32, 8], gen: genPantry, normalScale: 0.6 },
  linen: { px: [16, 16], gen: genLinen, normalScale: 0.5 },
  quilt_red: { px: [32, 32], gen: (s, c) => genQuilt(s, c, PALETTE.red), normalScale: 0.6 },
  quilt_blue: { px: [32, 32], gen: (s, c) => genQuilt(s, c, PALETTE.blue), normalScale: 0.6 },
  quilt_green: { px: [32, 32], gen: (s, c) => genQuilt(s, c, PALETTE.green), normalScale: 0.6 },
  quilt_ochre: { px: [32, 32], gen: (s, c) => genQuilt(s, c, PALETTE.yellow), normalScale: 0.6 },
  quilt_plum: { px: [32, 32], gen: (s, c) => genQuilt(s, c, PALETTE.purple), normalScale: 0.6 },
  rug_red: { px: [32, 32], gen: (s, c) => genRug(s, c, PALETTE.red), normalScale: 0.4 },
  rug_blue: { px: [32, 32], gen: (s, c) => genRug(s, c, PALETTE.blue), normalScale: 0.4 },
  rug_green: { px: [32, 32], gen: (s, c) => genRug(s, c, PALETTE.green), normalScale: 0.4 },
  rug_border: { px: [16, 8], gen: genRugBorder, normalScale: 0.4 },
  embers: { px: [16, 16], gen: genEmbers, normalScale: 0.6, emissive: true },
  window_inside: { px: [16, 24], gen: genWindowInside, normalScale: 0.6, emissive: true },
  light_beam: { px: [16, 32], gen: genLightBeam, normalScale: 0, emissive: true },
  burlap: { px: [16, 16], gen: genBurlap, normalScale: 0.6 },
};

/**
 * Every texture definition: the library's own, then the packages' sets merged at run time by
 * `registerTextureSet` (arid: ./textures/arid.js; siege: ./textures/buildings.js — the set-piece
 * kit's, src/engine/world/SetPieceKit.js) — on demand, none in TEXTURE_NAMES.
 * @type {Record<string, TexDef>}
 */
const DEFS = { ...BASE_DEFS };
/** The set factories `registerTextureSet` merged already. */
const REGISTERED_SETS = new Set();

/**
 * Merge a package's texture set into the library's definitions (additive; once per factory — again
 * is harmless): `make(TEXTURE_KIT)` → `{ [name]: TexDef }` (./textures/*.js `aridTextures`,
 * `buildingTextures`). Called by the set-piece kit when it loads (src/engine/world/SetPieceKit.js),
 * before anything asks for one of its names: until then a name of the set is unknown (`has` false,
 * `get` the fallback with a warning). A name already defined throws; with `names`, so does a set
 * that does not define exactly those names (the static lists the levels are scanned for:
 * ./textures/names.js).
 * @param {(kit: TextureKit) => Record<string, TexDef>} make
 * @param {readonly string[]} [names]
 */
export function registerTextureSet(make, names) {
  if (REGISTERED_SETS.has(make)) return;
  const set = make(TEXTURE_KIT);
  const keys = Object.keys(set);
  if (names && (keys.length !== names.length || keys.some((k) => !names.includes(k)))) {
    throw new Error(`Textures: the texture set defines [${keys.join(', ')}], its name list [${names.join(', ')}]`);
  }
  for (const name of keys) if (Object.hasOwn(DEFS, name)) throw new Error(`Textures: the texture "${name}" is defined twice`);
  for (const name of keys) DEFS[name] = set[name];
  REGISTERED_SETS.add(make);
}

/**
 * All texture names provided by the library (exactly the contract list; `preload()` paints these).
 * On-demand extras outside the list — painted only when something asks for them by name, so a level
 * that does not use them paints nothing new: `crag` (a fractured rock face; Cinderwatch Pass's ridge)
 * and the furniture set (props/Furniture.js): `furniture_wood`, `books`, `pantry`, `linen`,
 * `quilt_red|blue|green|ochre|plum`, `rug_red|blue|green`, `rug_border`, `embers` (emissive),
 * `window_inside` (emissive), `light_beam` (emissive only), `burlap`; and, once the set-piece kit
 * registered them (`registerTextureSet`), the sets of Vanquish the Evil Dragon (./textures/arid.js:
 * the arid tops and sides; ./textures/buildings.js: adobe, sandstone_brick, whitewash, charred_wall,
 * roof_terracotta, roof_charred).
 */
export const TEXTURE_NAMES = [
  'grass', 'grass_dark', 'grass_flowers', 'dirt', 'dirt_path', 'cobblestone', 'stone_tiles', 'sand', 'farmland',
  'moss_stone', 'riverbed', 'wood_deck',
  'cliff', 'grass_side', 'dirt_side', 'stone_wall',
  'plaster', 'timber_frame', 'wood_planks', 'wood_planks_dark', 'log_wall', 'brick', 'stone_brick', 'roof_red',
  'roof_blue', 'roof_thatch', 'roof_slate', 'door', 'window', 'chimney_stone',
  'bark', 'leaves', 'leaves_autumn', 'pine', 'hay', 'cloth_red', 'cloth_stripe', 'metal', 'barrel', 'crate',
  'fence_wood', 'rope', 'well_stone', 'lantern_glass', 'sign_board', 'flowerbox',
];

const EMISSIVE_COLOR = 0xffb870;

/**
 * JSON of the material params used in the cache key. Plain params serialise as-is; textures and other
 * three objects with a uuid are keyed by uuid (JSON.stringify would call Texture#toJSON, which encodes
 * the whole image on every lookup) and functions (e.g. onBeforeCompile) by their source, which
 * JSON.stringify would otherwise drop, making different hooks collide on one cached material.
 */
function materialKey(extra) {
  if (!extra) return '{}';
  const norm = {};
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    norm[k] = typeof v === 'function' ? `fn:${String(v)}` : v && typeof v === 'object' && typeof v.uuid === 'string' ? `uuid:${v.uuid}` : v;
  }
  return JSON.stringify(norm);
}

// ---------------------------------------------------------------------------
// TextureLibrary
// ---------------------------------------------------------------------------

/**
 * Procedural world texture library. Textures are painted lazily on first use and cached.
 *
 * @example
 *   const tex = new TextureLibrary({ seed: 1337, anisotropy: 4 });
 *   const mat = tex.material('cobblestone');          // MeshLambertMaterial with map + normalMap
 *   const [uw, uh] = tex.meta('cobblestone').units;   // world size of one repeat → uv = pos / units
 */
export class TextureLibrary {
  /** @param {{ seed?: number, anisotropy?: number }} [opts] */
  constructor({ seed = 1337, anisotropy = 4 } = {}) {
    this.seed = seed >>> 0;
    this.anisotropy = anisotropy;
    /** @type {Map<string, {color:PixelCanvas, normal:PixelCanvas|null, emissive:PixelCanvas|null, height:Float32Array|null, normalScale:number}>} */
    this._painted = new Map();
    /** @type {Map<string, {map:THREE.Texture, normal:THREE.Texture|null, emissive:THREE.Texture|null}>} */
    this._tex = new Map();
    /** @type {Map<string, THREE.MeshLambertMaterial>} */
    this._materials = new Map();
    this._fallback = null;
    this._warned = new Set();
  }

  /** Deterministic per-texture seed. */
  seedOf(name) {
    return (Math.imul(hashString(name), 0x9e3779b1) ^ Math.imul(this.seed, 0x85ebca6b)) >>> 0;
  }

  /** @param {string} name */
  has(name) { return isOwnKey(DEFS, name); }

  /** @returns {string[]} all texture names */
  list() { return TEXTURE_NAMES.slice(); }

  /**
   * @param {string} name
   * @returns {{ px:[number,number], units:[number,number], alpha:boolean, emissive:boolean, normal:boolean }}
   */
  meta(name) {
    const d = this.has(name) ? DEFS[name] : null;
    if (!d) { this._warn(name); return { px: [16, 16], units: [1, 1], alpha: false, emissive: false, normal: false }; }
    return { px: [d.px[0], d.px[1]], units: [d.px[0] / PPU, d.px[1] / PPU], alpha: !!d.alpha, emissive: !!d.emissive, normal: true };
  }

  /**
   * Painted pixel data (generated on demand; cached). Useful for atlases/debug views.
   * `normalScale` is the texture's normal-map strength (its DEFS entry, 0.8 by default); null for
   * an unknown name.
   * @param {string} name
   * @returns {{ color: PixelCanvas, normal: PixelCanvas|null, emissive: PixelCanvas|null,
   *   height: Float32Array|null, normalScale: number }|null}
   */
  pixels(name) {
    let p = this._painted.get(name);
    if (p) return p;
    const d = this.has(name) ? DEFS[name] : null;
    if (!d) return null;
    const [w, h] = d.px;
    const wrap = d.wrap ?? !d.alpha;
    const s = new Surf(w, h, wrap);
    const seed = this.seedOf(name);
    const ctx = { rng: new RNG(seed), seed: seed % 100000, seedOf: (n) => this.seedOf(n) % 100000, name };
    const res = d.gen(s, ctx) || {};
    if (d.alpha) s.pc.wrap = false;
    const strength = res.normal ?? 2;
    const wrapN = wrap && res.wrap !== false;
    const normal = normalMapFromHeight(w, h, (x, y) => s.hf[y * w + x], { strength, wrap: wrapN });
    p = { color: s.pc, normal, emissive: s.em, height: s.hf, normalScale: d.normalScale ?? 0.8 };
    this._painted.set(name, p);
    return p;
  }

  /** HTMLCanvasElement with the color pixels of `name` (for DOM previews). */
  canvas(name) {
    const p = this.pixels(name);
    return p ? p.color.toCanvas() : null;
  }

  _textures(name) {
    let t = this._tex.get(name);
    if (t) return t;
    const p = this.pixels(name);
    if (!p) return null;
    /** @type {{ wrap: 'repeat', mipmaps: boolean, anisotropy: number }} */
    const opt = { wrap: 'repeat', mipmaps: true, anisotropy: this.anisotropy };
    const map = makePixelTexture(p.color.toCanvas(), { ...opt, srgb: true, name: `luminati:${name}` });
    // Separate canvases: PixelCanvas#toCanvas caches one canvas per PixelCanvas.
    const normal = p.normal ? makePixelTexture(p.normal.toCanvas(), { ...opt, srgb: false, name: `luminati:${name}:normal` }) : null;
    const emissive = p.emissive ? makePixelTexture(p.emissive.toCanvas(), { ...opt, srgb: true, name: `luminati:${name}:emissive` }) : null;
    t = { map, normal, emissive };
    this._tex.set(name, t);
    return t;
  }

  /**
   * Color texture (SRGB, RepeatWrapping, mipmaps, NEAREST magnification). Cached.
   * @param {string} name
   * @returns {THREE.Texture}
   */
  get(name) {
    const t = this._textures(name);
    if (t) return t.map;
    this._warn(name);
    return this._fallbackTexture();
  }

  /** Tangent-space normal map (NoColorSpace) or null. @param {string} name */
  normal(name) {
    const t = this._textures(name);
    return t ? t.normal : null;
  }

  /** Emissive mask (SRGB; white where it glows) or null. @param {string} name */
  emissive(name) {
    const t = this._textures(name);
    return t ? t.emissive : null;
  }

  /**
   * Cached MeshLambertMaterial wearing the texture: map, normalMap (+normalScale), emissiveMap
   * (warm #ffb870, intensity `extra.emissiveIntensity ?? 1`) and alpha cut-out setup
   * (alphaTest 0.5, DoubleSide, userData.alpha = true). `extra` = additional material params
   * (a numeric `normalScale` is accepted as a shorthand; an `onBeforeCompile` hook is set on the
   * material and keyed by its source text, like any function in `extra`).
   * @param {string} name
   * @param {Omit<THREE.MeshLambertMaterialParameters, 'normalScale'>
   *   & { normalScale?: number | THREE.Vector2,
   *     onBeforeCompile?: THREE.Material['onBeforeCompile'] }} [extra]
   * @returns {THREE.MeshLambertMaterial}
   */
  material(name, extra = {}) {
    extra = extra ?? {};
    const key = `${name}|${materialKey(extra)}`;
    let m = this._materials.get(key);
    if (m) return m;
    const meta = this.meta(name);
    const params = { map: this.get(name) };
    const n = this.normal(name);
    const p = this._painted.get(name);
    if (n) {
      const ns = p ? p.normalScale : 0.8;
      params.normalMap = n;
      params.normalScale = new THREE.Vector2(ns, ns);
    }
    const e = this.emissive(name);
    if (e) {
      params.emissiveMap = e;
      params.emissive = new THREE.Color(EMISSIVE_COLOR);
      params.emissiveIntensity = extra.emissiveIntensity ?? 1;
    }
    if (meta.alpha) {
      params.alphaTest = 0.5;
      params.side = THREE.DoubleSide;
    }
    const rest = { ...extra };
    if (typeof rest.normalScale === 'number') rest.normalScale = new THREE.Vector2(rest.normalScale, rest.normalScale);
    // rest.normalScale is a Vector2 by now (converted above); TS cannot see that through the spread
    m = new THREE.MeshLambertMaterial(/** @type {THREE.MeshLambertMaterialParameters} */ ({ ...params, ...rest }));
    m.name = `luminati:${name}`;
    if (rest.userData) m.userData = { ...rest.userData }; // never mutate the caller's object
    if (meta.alpha) m.userData.alpha = true;
    m.userData.texture = name;
    this._materials.set(key, m);
    return m;
  }

  /** Generate every texture up front (e.g. behind a loading screen). */
  preload(names = TEXTURE_NAMES) {
    for (const n of names) this._textures(n);
  }

  _warn(name) {
    if (this._warned.has(name)) return;
    this._warned.add(name);
    console.warn(`[TextureLibrary] unknown texture "${showValue(name)}"`);
  }

  _fallbackTexture() {
    if (!this._fallback) {
      const pc = new PixelCanvas(16, 16);
      pc.map((x, y) => (((x >> 2) + (y >> 2)) & 1 ? '#ff00ff' : '#200020'));
      this._fallback = pc.toTexture({ mipmaps: true });
    }
    return this._fallback;
  }

  /** Dispose every texture and material created by the library. */
  dispose() {
    for (const t of this._tex.values()) {
      t.map.dispose();
      t.normal?.dispose();
      t.emissive?.dispose();
    }
    for (const m of this._materials.values()) m.dispose();
    this._fallback?.dispose();
    this._tex.clear();
    this._materials.clear();
    this._painted.clear();
    this._fallback = null;
  }
}
