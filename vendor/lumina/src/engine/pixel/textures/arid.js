import { valueNoise2, hash2, clamp, smoothstep, bayer4 } from '../../utils/math.js';

/**
 * The arid textures of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §6.2,
 * docs/design/ARID_LOOK.md): terrain tops `arid_dirt`, `cracked_earth`, `dry_grass`, `red_sand`,
 * `sandstone`, `redrock`, `scree`, `flagstone`, `scorched`, `basalt`, `ash`; sides
 * `sandstone_cliff`, `redrock_cliff`, `basalt_cliff`, `arid_dirt_side`; the dry grass brim
 * `dry_grass_side` (a `lip`). Registered by name in the TextureLibrary's definitions (../Textures.js)
 * and painted on demand — not in TEXTURE_NAMES: a level's legend (the generator's custom legend
 * characters; no new TILE_TYPES), a rock's or a crag's stone names them, so a level without them
 * paints none. Owner: the arid package.
 *
 * Every painter works like the library's own (see the header of ../Textures.js): colour and a
 * height field painted together on a seamless `Surf` (the normal map comes from the height), the
 * key light at the top-left baked into the forms — lit upper-left rims, shaded lower-right ones,
 * one ramp step at a time —, ramps of 8 hand-picked tones that shift toward violet in the shade and
 * toward gold in the light. Sizes:
 *  - tops 64 × 64 (4 × 4 units, like every terrain top; the organic ones are turned and mirrored
 *    per tile by the TileMap when it lists them in ORGANIC_TOPS);
 *  - `sandstone_cliff`, `redrock_cliff`, `basalt_cliff` 32 × 32 (2 × 2 units, like `stone_wall`):
 *    the strata are whole multiples of 4 px and change at multiples of 8 px (LEVEL_HEIGHT), so a
 *    terrace edge or a crag's ledge always falls on a stratum boundary;
 *  - `arid_dirt_side` and `dry_grass_side` 16 × 16 (like `dirt_side` / `grass_side`): two soil
 *    layers per unit; the brim's body is the dirt bank's own painter with the dirt bank's seed, so a
 *    dry grass edge over a dirt bank shows no seam (as `grass_side` over `cliff`).
 *
 * The module exports `aridTextures(kit) → { [name]: TexDef }` (`TexDef`: px — canvas size, units =
 * px / 16 —, gen(surf, ctx) painting colour + height and returning { normal }, normalScale; the
 * kit: ../Textures.js `TEXTURE_KIT`). Painting helpers the kit does not carry (a periodic Voronoi,
 * level maps with a top-left emboss, cracks, pebbles) are this module's own, below.
 *
 * @import { TextureKit, TexDef } from '../Textures.js'
 */

// ---------------------------------------------------------------------------------------------
// Ramps (8 tones each, dark → light)
// ---------------------------------------------------------------------------------------------

const HEX = {
  ochre: ['#2b1b16', '#47291e', '#6a3f27', '#8b5832', '#a8723f', '#c38f50', '#d9ad6a', '#ebca8e'],
  clay: ['#2a1613', '#46231a', '#673524', '#874a2d', '#a46339', '#bc7e49', '#d29b60', '#e5ba82'],
  straw: ['#3a2617', '#5a3c1e', '#7e5726', '#a2742f', '#c1923c', '#d8ae52', '#ebca72', '#f7e3a0'],
  // genGrass's six-tone ramp for the dry grass (golden straw; soil brown in the shade)
  straw6: ['#4a2f1a', '#6e4a22', '#94692c', '#b88b3b', '#d6ac55', '#eed284'],
  sage: ['#262a1c', '#363d26', '#4b5532', '#626e3f', '#7c8750', '#98a065', '#b4b87e'],
  rust: ['#2b1310', '#461e15', '#672d1b', '#874024', '#a2562f', '#b86e3e', '#cc8852', '#dca46e'],
  sand: ['#3c271d', '#5d3c27', '#7e5634', '#9e7043', '#ba8b55', '#d0a66c', '#e2c189', '#f0daa8'],
  cream: ['#3e2c24', '#614532', '#836143', '#a37d56', '#bf9a6c', '#d5b585', '#e6cea0', '#f3e4c0'],
  redrock: ['#260f0e', '#3f1714', '#5c2419', '#7c3420', '#984829', '#ae5f35', '#c27a48', '#d49660'],
  maroon: ['#1d0b0e', '#331113', '#4c1a19', '#682520', '#843328', '#9c4532', '#b25c40', '#c67a55'],
  scree: ['#1c1819', '#2f2727', '#463a36', '#5e4f47', '#786659', '#937f6e', '#ae9b86', '#c9b8a0'],
  char: ['#090708', '#120e0e', '#1c1614', '#271f1b', '#342922', '#43362c', '#574739', '#6e5b4a'],
  ashg: ['#1b1a1c', '#2a2829', '#3c3837', '#514c49', '#68625d', '#817a73', '#9c948b', '#b9b1a6'],
  basalt: ['#09090e', '#111118', '#1a1a23', '#24242f', '#30303c', '#3e3d4a', '#504e5b', '#68656f'],
  bone: ['#6e6455', '#988c76', '#bdb197', '#dcd2b8', '#efe8d2', '#fbf7ea'],
};

/** Ramp lookup with clamping. */
const ri = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
const mod = (a, n) => ((a % n) + n) % n;

/** Seamless 1D value noise along x (period `p` cells across the width `w`), in [0, 1). */
const wobble = (x, w, p, seed) => valueNoise2((x / w) * p, 0.5, seed, p);

/**
 * Jittered-grid Voronoi, periodic (the library's own in ../Textures.js, kept here: the kit does not
 * carry it). Per pixel: the nearest cell `id`, the distance to the cell border (`edge`, px), the
 * distance to the cell point (`dist`), the offset from it (`ox`, `oy`), and `id2` — the second
 * nearest cell (the one across the nearest border).
 */
function voronoi(w, h, cols, rows, seed, { jitter = 0.8, sy = 1 } = {}) {
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
  const id = new Int32Array(N), id2 = new Int32Array(N), edge = new Float32Array(N), dist = new Float32Array(N);
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
      let e = Infinity, other = best;
      for (let q = 0; q < m; q++) {
        if (q === best) continue;
        const dx = cx[q] - bx, dy = cy[q] - by;
        const len = Math.hypot(dx, dy) || 1e-6;
        const dd = -((X - (bx + cx[q]) / 2) * dx + (Ys - (by + cy[q]) / 2) * dy) / len;
        if (dd < e) { e = dd; other = q; }
      }
      const i = y * w + x;
      id[i] = ck[best];
      id2[i] = ck[other];
      edge[i] = e;
      dist[i] = Math.sqrt(bd);
      ox[i] = X - bx;
      oy[i] = (Ys - by) / sy;
    }
  }
  return { id, id2, edge, dist, ox, oy, count: n, px, py };
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
 * 1 px emboss of a level map lit from the top-left: +1 on the upper-left rim of a raised level, -1
 * in the shadow just below / right of a higher one, else 0 (wrapping).
 */
function emboss(lv, w, h, x, y) {
  const L = lv[y * w + x];
  const up = lv[mod(y - 1, h) * w + x];
  const left = lv[y * w + mod(x - 1, w)];
  if (up > L || left > L) return -1;
  if (up < L || left < L) return 1;
  return 0;
}

/**
 * A seeded random-walk crack (wrapping). `dark` on the path, `light` one pixel below-right (the lit
 * far wall); `branch` spawns a shorter side crack. Lowers the height along the path.
 */
function crack(s, x, y, len, rng, { dark, light = null, depth = 0.25, dir = -1, branch = 0, keep = null, straight = false }) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let d = dir >= 0 ? dir : rng.int(0, 7);
  const d0 = d;
  const path = [];
  for (let k = 0; k < len; k++) {
    if (keep && !keep(x, y)) break;
    path.push([x, y]);
    const r = rng.next();
    const dd = r < (straight ? 0.78 : 0.6) ? 0 : r < (straight ? 0.89 : 0.8) ? 1 : -1;
    const [dx, dy] = dirs[mod(d + dd, 8)];
    if (!straight && rng.chance(0.18)) d = mod(d + dd, 8);
    else if (straight) d = d0;
    x += dx; y += dy;
  }
  if (light) for (const [px, py] of path) if (!path.some(([qx, qy]) => qx === px + 1 && qy === py + 1)) s.set(px + 1, py + 1, light);
  for (const [px, py] of path) { s.set(px, py, dark); s.setH(px, py, s.H(px, py) - depth); }
  if (branch > 0 && path.length > 4) {
    const [bx, by] = path[rng.int(1, path.length - 2)];
    crack(s, bx, by, Math.max(2, Math.round(len * 0.45)), rng, { dark, light, depth, branch: branch - 1, keep });
  }
  return path;
}

const PEBBLES = [
  ['X'], ['XX'], ['XX', 'XX'], ['XXX', 'XX.'], ['.XX', 'XXX', '.X.'], ['.XX.', 'XXXX', '.XX.'], ['XXX', 'XXX'],
  ['.XXX', 'XXXX', 'XXX.'],
];

/**
 * A small shaded pebble (wrapping): lit top-left pixels, a shaded lower-right, a cast shadow toward
 * the lower right (`shadow`, or none), a one-pixel glint (`spec`).
 */
function pebble(s, x, y, shape, R, base, shadow, { h = 0.8, spec = null } = {}) {
  const rows = PEBBLES[shape];
  const inside = (u, v) => v >= 0 && v < rows.length && u >= 0 && u < rows[v].length && rows[v][u] === 'X';
  if (shadow) {
    for (let v = 0; v <= rows.length; v++) {
      for (let u = 0; u <= rows[0].length; u++) {
        if (!inside(u, v) && (inside(u - 1, v - 1) || (inside(u - 1, v) && v === rows.length - 1))) s.set(x + u, y + v, shadow);
      }
    }
  }
  for (let v = 0; v < rows.length; v++) {
    for (let u = 0; u < rows[v].length; u++) {
      if (!inside(u, v)) continue;
      const tl = !inside(u - 1, v) || !inside(u, v - 1);
      const br = !inside(u + 1, v) || !inside(u, v + 1);
      let k = base;
      if (tl && !br) k += 1;
      else if (br && !tl) k -= 1;
      s.set(x + u, y + v, ri(R, k));
      s.setH(x + u, y + v, h * (tl && br ? 0.85 : 1));
    }
  }
  if (spec) s.set(x + rows[0].indexOf('X'), y, spec);
}

// ---------------------------------------------------------------------------------------------
// Tops (64 × 64)
// ---------------------------------------------------------------------------------------------

/** Ramp with midpoints inserted between neighbouring tones (n → 2n − 1 steps). */
function halfRamp(K, Rm) {
  const out = [];
  for (let i = 0; i < Rm.length; i++) {
    out.push(Rm[i]);
    if (i < Rm.length - 1) out.push(K.mixColor(Rm[i], Rm[i + 1], 0.5));
  }
  return out;
}

/** Ochre packed earth: soft patches, crumbs, hairline cracks, pebbles, wind-sorted pale streaks. */
function genAridDirt(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const STONE = R.sand;
  const O = halfRamp(K, R.ochre); // 15 steps: the patches differ by half a step
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3, gain: 0.5 });
  const B = K.field(w, h, 2, 6, seed + 2, { oct: 3 }); // wind streaks (elongated across)
  const lv = quantize(A, [0.25, 0.7], 7);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    const q = hash2(x, y, seed);
    let k = lv[i] + (e > 0 && q < 0.65 ? 1 : e < 0 ? -1 : 0);
    if (B[i] > 0.86 && q < 0.7) k += 1; // a pale drift of fine sand
    else if (q > 0.965) k -= 2; // grit
    else if (q < 0.03) k += 2;
    s.set(x, y, ri(O, k));
    s.hf[i] = 0.3 + (lv[i] - 7) * 0.05 + e * 0.04 + (B[i] > 0.86 ? 0.03 : 0);
  });
  // crumbs: little clods lit on the upper left
  const cv = voronoi(w, h, 13, 13, seed + 12, { jitter: 0.9 });
  s.each((x, y, i) => {
    if (cv.dist[i] > 1.3 || hash2(cv.id[i], 1, seed) < 0.45) return;
    const lit = cv.ox[i] + cv.oy[i] < 0;
    s.set(x, y, ri(O, lv[i] + (lit ? 2 : 0)));
    s.hf[i] = 0.48;
    if (!lit) s.set(x + 1, y + 1, ri(O, lv[i] - 2));
  });
  // hairline cracks of baked earth
  for (let c = 0; c < 6; c++) crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(5, 11), rng, { dark: R.ochre[1], light: R.ochre[5], depth: 0.18, branch: 1 });
  // dry twigs
  for (let t = 0; t < 4; t++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const len = rng.int(2, 4);
    const dx = rng.chance(0.5) ? 1 : -1;
    for (let k = 0; k < len; k++) { s.set(x + k * dx, y + (k >> 1), R.ochre[1]); s.set(x + k * dx, y + (k >> 1) - 1, R.straw[3]); }
  }
  // pebbles: warm stone, a few pale ones with a glint
  for (let p = 0; p < 20; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const shape = rng.chance(0.45) ? rng.int(0, 2) : rng.int(3, 7);
    const pale = rng.chance(0.3);
    pebble(s, x, y, shape, pale ? R.cream : STONE, pale ? 5 : rng.int(3, 4), ri(O, lv[s.ix(x, y)] - 4), { spec: pale ? R.cream[7] : null });
  }
  // dry grass sprigs
  for (let g = 0; g < 4; g++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y + 1, R.ochre[1]); s.set(x + 1, y + 1, R.ochre[2]);
    s.set(x, y, R.straw[4]); s.set(x + 1, y - 1, R.straw[6]); s.set(x - 1, y - 1, R.straw[5]);
    s.setH(x, y, 0.7);
  }
  return { normal: 1.6 };
}

/** Dry clay plates, curled at the rims, split by dark cracks (wider at some), dust in a few. */
function genCrackedEarth(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const C = R.clay;
  const v = voronoi(w, h, 7, 7, seed + 3, { jitter: 0.9 });
  const fine = voronoi(w, h, 17, 17, seed + 4, { jitter: 0.9 });
  const T = K.field(w, h, 3, 3, seed + 5, { oct: 3 });
  const plate = [];
  for (let k = 0; k < v.count; k++) plate.push({ base: rng.pick([4, 4, 5, 5, 5, 3, 6]), split: rng.chance(0.35), pale: rng.chance(0.18) });
  const pair = (a, b, salt) => hash2(Math.min(a, b), Math.max(a, b), seed + salt);
  s.each((x, y, i) => {
    const p = plate[v.id[i]];
    const wide = pair(v.id[i], v.id2[i], 21) < 0.35;
    const e = v.edge[i];
    if (e < (wide ? 1.3 : 0.75)) {
      // the crack: deep and dark; dust has settled in some
      const dusty = pair(v.id[i], v.id2[i], 22) < 0.22;
      s.set(x, y, dusty ? C[3] : e < 0.4 && wide ? C[0] : C[1]);
      s.hf[i] = dusty ? 0.22 : 0.05;
      return;
    }
    let k = p.base;
    const rim = e < 2.4;
    const lit = v.ox[i] * 0.7 + v.oy[i] < 0;
    if (rim) k += lit ? 1 : -1; // the plate's edge curls up: lit toward the light, shaded away
    if (p.split && fine.edge[i] < 0.6 && fine.id[i] % 3 === 0) { k -= 2; } // a fine crack across the plate
    if (T[i] > 0.88) k += 1;
    else if (T[i] < 0.08) k -= 1;
    const q = hash2(x, y, seed + 9);
    if (q < 0.04) k += 1; else if (q > 0.97) k -= 1;
    let c = ri(C, k);
    if (p.pale) c = K.mixColor(c, ri(R.ochre, k + 1), 0.5);
    s.set(x, y, c);
    s.hf[i] = 0.35 + smoothstep(0.6, 3.2, e) * 0.35 + (rim ? 0.08 : 0) - (p.split && fine.edge[i] < 0.6 && fine.id[i] % 3 === 0 ? 0.2 : 0);
  });
  // flakes curling off a few plates: a lit chip with a shadow
  for (let n = 0; n < 9; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (v.edge[s.ix(x, y)] < 2) continue;
    s.set(x, y, C[7]); s.set(x + 1, y, C[6]); s.set(x + 1, y + 1, C[2]); s.set(x + 2, y + 1, C[2]);
  }
  for (let p = 0; p < 6; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    pebble(s, x, y, rng.int(0, 3), R.sand, 4, C[2]);
  }
  return { normal: 2.0 };
}

/**
 * Golden dry grass on earth: tufts of straw blades (bleached tips, olive bases) on a jittered grid,
 * patches of bare ochre earth between them, a few sage-green clumps and seed heads.
 */
function genDryGrass(s, ctx, K, R) {
  const { w, h } = s;
  const seed = ctx.seed;
  // the library's own grass (patches, embossed level edges, blade tufts on a jittered grid, lit
  // specks) on the straw ramp — so it sits beside Emberfall's grass as the same kind of surface
  K.genGrass(s, ctx, { ramp: R.straw6, warm: 0, density: 0.82, levels: [0.14, 0.5, 0.84] });
  const rng = new K.RNG(seed + 77);
  const G = R.straw;
  const E = K.field(w, h, 3, 3, seed + 2, { oct: 3 }); // bare earth
  const S = K.field(w, h, 2, 2, seed + 3, { oct: 2 }); // sage
  const O = halfRamp(K, R.ochre);
  const bare = new Uint8Array(w * h);
  s.each((x, y, i) => {
    const q = hash2(x, y, seed);
    if (E[i] >= 0.17 + (q - 0.5) * 0.05) return;
    bare[i] = 1;
    s.set(x, y, ri(O, 8 + (E[i] < 0.08 ? -1 : 0) + (q < 0.08 ? 2 : 0)));
    s.hf[i] = 0.22;
  });
  // the grass throws a little shade onto the earth below-right of it; a sprig or two stands in it
  s.each((x, y, i) => {
    if (!bare[i]) return;
    if (!bare[s.ix(x - 1, y)] || !bare[s.ix(x, y - 1)]) s.set(x, y, O[4]);
  });
  for (let p = 0; p < 9; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (!bare[s.ix(x, y)]) continue;
    if (p % 3) pebble(s, x, y, rng.int(0, 4), R.sand, 4, O[4]);
    else { s.set(x, y + 1, O[4]); s.set(x, y, G[5]); s.set(x - 1, y - 1, G[6]); s.set(x + 1, y - 1, G[6]); }
  }
  // sage-green clumps among the straw (the dry steppe's few living plants)
  for (let n = 0; n < 40; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (bare[s.ix(x, y)] || S[s.ix(x, y)] < 0.78) continue;
    s.set(x + 1, y + 1, R.sage[0]);
    s.set(x, y, R.sage[3]); s.set(x + 1, y, R.sage[2]); s.set(x, y - 1, R.sage[5]); s.set(x - 1, y, R.sage[4]);
    s.setH(x, y, 0.75);
  }
  // seed heads: bleached tips
  for (let k = 0; k < 14; k++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (bare[s.ix(x, y)]) continue;
    s.set(x, y, G[7]); s.set(x + 1, y + 1, G[3]);
  }
  return { normal: 1.4 };
}

/**
 * Wind-rippled rust sand: crests (a lit line) and lee slopes (a shaded one) every 8 px, bending
 * along the width and fading in and out in patches; darker grit, a few stones.
 */
function genRedSand(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = R.rust;
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3, gain: 0.45 });
  const M = K.field(w, h, 2, 2, seed + 5, { oct: 3 });
  const lv = quantize(A, [0.3, 0.85], 4);
  const wave = new Float32Array(w);
  const wave2 = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    wave[x] = (wobble(x, w, 4, seed + 9) - 0.5) * 10 + (wobble(x, w, 8, seed + 10) - 0.5) * 3;
    wave2[x] = (wobble(x, w, 2, seed + 11) - 0.5) * 6;
  }
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e > 0 && hash2(x, y, seed) < 0.5 ? 1 : e < 0 && hash2(x, y, seed) < 0.4 ? -1 : 0);
    let hh = 0.35 + lv[i] * 0.05;
    if (M[i] > 0.28) {
      const ph = mod(y + Math.round(wave[x] + (M[i] > 0.6 ? wave2[x] : 0)), 8);
      if (ph === 0) { k += 1; hh += 0.12; } // crest
      else if (ph === 1) { k -= 1; hh -= 0.02; } // the lee side under the crest
      else if (ph === 2 && hash2(x, y, seed + 3) < 0.4) k -= 1;
      else if (ph === 7 && hash2(x, y, seed + 4) < 0.5) k += 1; // the windward slope catches light
      hh += (ph >= 5 ? (ph - 5) * 0.03 : 0);
    }
    const q = hash2(x, y, seed + 6);
    if (q < 0.012) k += 2;
    else if (q > 0.985) k -= 2;
    s.set(x, y, ri(S, k));
    s.hf[i] = hh;
  });
  // dark grit (iron sand) collecting in a few troughs
  for (let n = 0; n < 40; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (M[s.ix(x, y)] <= 0.28 || mod(y + Math.round(wave[x]), 8) !== 2) continue;
    s.set(x, y, S[2]);
  }
  for (let p = 0; p < 7; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    pebble(s, x, y, rng.int(1, 6), rng.chance(0.5) ? R.redrock : R.maroon, rng.int(4, 5), S[3], { spec: rng.chance(0.3) ? R.rust[7] : null });
  }
  return { normal: 1.4 };
}

/**
 * Flat layered rock tops (sandstone, red rock): terraces from a contoured height field — each step
 * a ledge with a lit rim and a shaded drop —, the levels banded in alternating tones like the
 * strata seen from above, cross-joints, potholes with sand, sand drifts in the low terraces
 * (`drift`: the sand's ramp — pale on sandstone, rust on red rock).
 */
function genSlickrock(s, ctx, K, R, { main, alt, drift }) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const M = halfRamp(K, main);
  const A = halfRamp(K, alt);
  const H = K.field(w, h, 2, 2, seed + 1, { oct: 4, gain: 0.5 });
  const lv = quantize(H, [0.2, 0.45, 0.7, 0.9], 0);
  const N = K.field(w, h, 8, 8, seed + 2, { oct: 2 });
  const D = K.field(w, h, 2, 2, seed + 3, { oct: 3 });
  const at = (x, y) => lv[s.ix(x, y)];
  s.each((x, y, i) => {
    const L = lv[i];
    const band = L % 2 ? A : M;
    let k = 8 + (L >= 3 ? 1 : 0);
    const e = emboss(lv, w, h, x, y);
    // a step: its rim lit 1 px, its drop shaded 2 px deep (the second px half a step)
    const drop2 = at(x - 1, y - 1) > L || at(x, y - 2) > L;
    if (e > 0) k += 3;
    else if (e < 0) k -= 3;
    else if (drop2) k -= 1;
    if (N[i] > 0.92) k += 1;
    else if (N[i] < 0.07) k -= 1;
    const q = hash2(x, y, seed);
    if (q < 0.03) k += 2; else if (q > 0.975) k -= 2;
    s.set(x, y, ri(band, k));
    s.hf[i] = 0.2 + L * 0.12 + e * 0.03;
  });
  // sand drifted into the low terraces
  s.each((x, y, i) => {
    if (lv[i] > 1 || D[i] < 0.72) return;
    const d = D[i] + (bayer4(x, y) - 0.5) * 0.08;
    if (d < 0.75) return;
    s.set(x, y, ri(drift, d > 0.86 ? 6 : 5));
    s.hf[i] = 0.25;
  });
  // cross-joints: two long, nearly straight cracks at right angles
  for (let c = 0; c < 2; c++) {
    crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(24, 44), rng, { dark: main[1], light: main[6], depth: 0.3, dir: c ? 2 : 0, straight: true });
  }
  // potholes: a dark rim, sand in the bottom
  for (let p = 0; p < 2; p++) {
    const cx = rng.int(0, w - 1), cy = rng.int(0, h - 1);
    const rx = rng.range(1.8, 3.2), ry = rx * 0.8;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (d > 1) continue;
        const rim = d > 0.55;
        s.set(cx + x, cy + y, rim ? (y < 0 || x < 0 ? main[1] : main[5]) : ri(drift, 4 + (y > 0 ? 1 : 0)));
        s.setH(cx + x, cy + y, rim ? 0.1 : 0.15);
      }
    }
  }
  return { normal: 2.0 };
}

/** Broken stone and gravel: angular faceted stones of mixed ramps on dark soil, gravel between. */
function genScree(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 9, 9, seed + 11, { jitter: 0.95 });
  const g = voronoi(w, h, 22, 22, seed + 12, { jitter: 0.9 });
  const M = K.field(w, h, 3, 3, seed + 13, { oct: 3 });
  const RAMPS = [R.scree, R.scree, R.cream, R.redrock, R.sand];
  const stones = [];
  for (let k = 0; k < v.count; k++) {
    const a = rng.range(-1.2, 1.2);
    const ax = Math.cos(a), ay = Math.sin(a);
    stones.push({ R: rng.pick(RAMPS), base: rng.pick([3, 4, 4, 5]), ax, ay, off: rng.range(-1, 1), litNeg: -0.6 * ax - 0.8 * ay < 0 });
  }
  const pebs = [];
  for (let k = 0; k < g.count; k++) pebs.push({ R: rng.pick(RAMPS), base: rng.pick([3, 4, 5]) });
  s.each((x, y, i) => {
    const gravel = M[i] < 0.38;
    const V = gravel ? g : v;
    const e = V.edge[i];
    if (e < (gravel ? 0.7 : 0.85)) {
      const shade = hash2(x, y, seed) < 0.5;
      s.set(x, y, ri(R.ochre, shade ? 0 : 1));
      s.hf[i] = 0.05;
      return;
    }
    if (gravel) {
      const p = pebs[g.id[i]];
      const lit = g.ox[i] + g.oy[i] < -0.5;
      const dark = g.ox[i] + g.oy[i] > 1;
      s.set(x, y, ri(p.R, p.base + (lit ? 1 : dark ? -1 : 0)));
      s.hf[i] = 0.35 + smoothstep(0.7, 2.2, e) * 0.3;
      return;
    }
    const st = stones[v.id[i]];
    const dd = v.ox[i] * st.ax + v.oy[i] * st.ay + st.off;
    const lit = (dd < 0) === st.litNeg;
    let k = st.base + (lit ? 1 : -1);
    const tl = v.ox[i] + v.oy[i] < 0;
    if (e < 1.6) k += tl ? 1 : -1; // bevel: the rim facing the light catches it
    if (hash2(x, y, seed + 2) < 0.05) k += 1;
    s.set(x, y, ri(st.R, k));
    s.hf[i] = 0.5 + smoothstep(0.85, 3, e) * 0.4 + (lit ? 0.04 : -0.04);
  });
  // shadows cast by the big stones onto the gravel / soil below-right
  const src = new Float32Array(s.hf);
  s.each((x, y, i) => {
    const up = src[s.ix(x - 1, y - 1)];
    if (src[i] < 0.45 && up > 0.6) s.tint(x, y, R.ochre[0], 0.5);
  });
  return { normal: 2.3 };
}

/** The village's sandy paving: irregular sandstone flags, sand in the joints, worn and chipped. */
function genFlagstone(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const v = voronoi(w, h, 5, 5, seed + 21, { jitter: 0.75 });
  const N = K.field(w, h, 8, 8, seed + 22, { oct: 2 });
  const D = K.field(w, h, 2, 2, seed + 23, { oct: 3 });
  const RAMPS = [R.sand, R.sand, R.cream, R.cream, R.ochre];
  const flags = [];
  for (let k = 0; k < v.count; k++) flags.push({ R: rng.pick(RAMPS), base: rng.pick([4, 4, 5, 5, 3]), cracked: rng.chance(0.3) });
  s.each((x, y, i) => {
    const e = v.edge[i];
    // sand drifts over the joints and the flags' edges
    const drift = D[i] > 0.8 && e < 1.2 + (D[i] - 0.8) * 20;
    if (e < 1.05 || drift) {
      const shade = !drift && (v.ox[i] + v.oy[i] < 0 ? false : hash2(x, y, seed) < 0.35);
      s.set(x, y, ri(R.sand, drift ? 5 + (hash2(x, y, seed + 1) < 0.2 ? 1 : 0) : shade ? 3 : 4));
      s.hf[i] = drift ? 0.32 : 0.18;
      return;
    }
    const f = flags[v.id[i]];
    let k = f.base;
    const tl = v.ox[i] * 0.8 + v.oy[i] < 0;
    if (e < 2.1) k += tl ? 1 : -1; // worn bevel
    else if (v.dist[i] < 3 && hash2(v.id[i], 2, seed) < 0.5) k += 1; // polished centre
    if (N[i] > 0.9) k += 1; else if (N[i] < 0.07) k -= 1;
    const q = hash2(x, y, seed + 3);
    if (q < 0.03) k -= 1;
    s.set(x, y, ri(f.R, k));
    s.hf[i] = 0.45 + smoothstep(1.05, 3, e) * 0.35;
  });
  // the shade of a joint under a flag's lower-right edge
  s.each((x, y, i) => {
    if (s.hf[i] > 0.2) return;
    if (s.H(x - 1, y) > 0.5 || s.H(x, y - 1) > 0.5) s.set(x, y, R.sand[2]);
  });
  for (let k = 0; k < v.count; k++) {
    if (!flags[k].cracked) continue;
    const cx = Math.floor(v.px[k]), cy = Math.floor(v.py[k]);
    const F = flags[k];
    crack(s, cx, cy, rng.int(3, 7), rng, { dark: ri(F.R, F.base - 2), light: ri(F.R, F.base + 1), depth: 0.2, keep: (x, y) => v.id[s.ix(x, y)] === k && v.edge[s.ix(x, y)] > 1.2 });
  }
  // chipped corners
  for (let n = 0; n < 8; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const i = s.ix(x, y);
    if (v.edge[i] < 1.1 || v.edge[i] > 2) continue;
    s.set(x, y, R.sand[3]); s.set(x + 1, y, R.sand[4]); s.setH(x, y, 0.2);
  }
  return { normal: 2.0 };
}

/** Burnt ground: char, burnt earth and grey ash in patches, stubble, cracks, a few faint embers. */
function genScorched(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const C = R.char;
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3 });
  const B = K.field(w, h, 3, 3, seed + 2, { oct: 3 });
  const lv = quantize(A, [0.3, 0.7], 2);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    const q = hash2(x, y, seed);
    let c;
    if (B[i] > 0.74 + (bayer4(x, y) - 0.5) * 0.06) {
      // drifts of grey ash
      c = ri(R.ashg, 3 + (B[i] > 0.88 ? 1 : 0) + (q < 0.1 ? 1 : 0) + (e < 0 ? -1 : 0));
      s.hf[i] = 0.35;
    } else if (B[i] < 0.12) {
      // earth scorched brown, not black
      c = ri(R.ochre, 1 + (q < 0.3 ? 1 : 0));
      s.hf[i] = 0.3;
    } else {
      c = ri(C, lv[i] + (e > 0 && q < 0.6 ? 1 : e < 0 ? -1 : 0) + (q > 0.96 ? 1 : 0));
      s.hf[i] = 0.25 + lv[i] * 0.05 + e * 0.03;
    }
    s.set(x, y, c);
  });
  // burnt stubble: short dark stalks with grey tips
  const cell = 6;
  for (let j = 0; j < h / cell; j++) {
    for (let i = 0; i < w / cell; i++) {
      if (!rng.chance(0.55)) continue;
      const x = Math.floor((i + rng.next()) * cell), y = Math.floor((j + rng.next()) * cell);
      if (B[s.ix(x, y)] > 0.74) continue;
      const n = rng.int(1, 3);
      for (let b = 0; b < n; b++) {
        const bx = x + b * 2 - (n - 1);
        const len = rng.int(1, 3);
        for (let k = 0; k < len; k++) s.set(bx, y - k, k === len - 1 ? R.ashg[4] : C[0]);
        s.set(bx + 1, y + 1, C[0]);
        s.setH(bx, y, 0.6);
      }
    }
  }
  for (let c = 0; c < 5; c++) crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(5, 10), rng, { dark: C[0], light: C[4], depth: 0.2, branch: 1 });
  // charred twigs
  for (let t = 0; t < 5; t++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const len = rng.int(3, 6);
    for (let k = 0; k < len; k++) { s.set(x + k, y + (k > len / 2 ? 1 : 0), C[0]); s.set(x + k, y - 1 + (k > len / 2 ? 1 : 0), C[3]); }
  }
  // faint embers in the char (no glow: a warm pixel and its dull rim)
  for (let n = 0; n < 7; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (B[s.ix(x, y)] > 0.7 || B[s.ix(x, y)] < 0.12) continue;
    s.set(x, y, n % 3 ? '#b8461c' : '#e0742c');
    s.set(x + 1, y, '#5c1e10'); s.set(x, y + 1, '#40160c');
  }
  return { normal: 1.6 };
}

/**
 * Dark volcanic rock: the tops of basalt columns (near-hexagonal cells) split by dark joints, each
 * top a little tilted (two tones), vesicles (pits with a lit far rim), sulphur stains by the joints.
 */
function genBasalt(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const B = halfRamp(K, R.basalt);
  // broken plates of lava rock (irregular, ≈ 13 px) on a rolling surface; half the plate borders
  // are open fractures, the rest only a change of tilt
  const v = voronoi(w, h, 5, 5, seed + 31, { jitter: 0.95 });
  const A = K.field(w, h, 4, 4, seed + 33, { oct: 3 });
  const lv = quantize(A, [0.3, 0.7], 6);
  const N = K.field(w, h, 10, 10, seed + 32, { oct: 2 });
  const plates = [];
  for (let k = 0; k < v.count; k++) {
    const a = rng.range(0, Math.PI * 2);
    plates.push({ base: rng.pick([0, 0, 1, -1]), tx: Math.cos(a), ty: Math.sin(a), warm: rng.chance(0.2) });
  }
  const pair = (a, b) => hash2(Math.min(a, b), Math.max(a, b), seed + 7);
  s.each((x, y, i) => {
    const e = v.edge[i];
    const open = pair(v.id[i], v.id2[i]) < 0.55;
    if (open && e < 0.8) { s.set(x, y, B[0]); s.hf[i] = 0.05; return; }
    const c = plates[v.id[i]];
    const tilt = v.ox[i] * c.tx + v.oy[i] * c.ty;
    const em = emboss(lv, w, h, x, y);
    let k = lv[i] + c.base + (tilt < -3 ? 1 : tilt > 3 ? -1 : 0) + em;
    if (open && e < 1.8) k += v.ox[i] + v.oy[i] < 0 ? 2 : -2; // the fracture's lit and shaded lips
    if (N[i] > 0.9) k += 1; else if (N[i] < 0.08) k -= 1;
    const q = hash2(x, y, seed);
    if (q < 0.05) k += 2; else if (q > 0.96) k -= 2;
    let col = ri(B, k);
    if (c.warm) col = K.mixColor(col, ri(R.scree, k >> 1), 0.18);
    s.set(x, y, col);
    s.hf[i] = 0.45 + (open ? smoothstep(0.8, 2.6, e) * 0.25 : 0.2) + (lv[i] - 6) * 0.05 - tilt * 0.01;
  });
  // vesicles
  for (let n = 0; n < 40; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (v.edge[s.ix(x, y)] < 1.6) continue;
    s.set(x, y, B[0]); s.set(x + 1, y + 1, B[11]); s.setH(x, y, 0.2);
    if (rng.chance(0.3)) { s.set(x + 1, y, B[2]); s.set(x + 2, y + 1, B[9]); }
  }
  // sulphur and rust stains along a few joints
  for (let n = 0; n < 60; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const i = s.ix(x, y);
    if (v.edge[i] < 0.9 || v.edge[i] > 1.6 || hash2(v.id[i], v.id2[i], seed + 5) > 0.3) continue;
    s.set(x, y, rng.chance(0.6) ? '#8a7a3a' : '#7a4a2a');
  }
  return { normal: 2.2 };
}

/** Grey ash of the lair: soft drifts, black cinders, bone-white fragments, a rust speck or two. */
function genAsh(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const G = R.ashg;
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3, gain: 0.45 });
  const M = K.field(w, h, 2, 2, seed + 2, { oct: 3 });
  const GH = halfRamp(K, G);
  const lv = quantize(A, [0.3, 0.75], 7);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e > 0 && hash2(x, y, seed) < 0.5 ? 1 : e < 0 ? -1 : 0);
    // soft drifts: a paler, finer ash where the wind laid it
    if (M[i] > 0.7) k += M[i] > 0.85 ? 2 : 1;
    const q = hash2(x, y, seed + 4);
    if (q < 0.06) k += 2; else if (q > 0.94) k -= 2;
    s.set(x, y, ri(GH, k));
    s.hf[i] = 0.35 + (lv[i] - 7) * 0.05 + (M[i] > 0.7 ? 0.04 : 0);
  });
  // cinders (black scoria)
  for (let p = 0; p < 26; p++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    pebble(s, x, y, rng.int(0, 5), R.basalt, rng.int(2, 4), G[1], { spec: rng.chance(0.25) ? R.basalt[7] : null });
  }
  // bone fragments: a shaft between two knobs, lying at an angle, with a shadow
  const BONE = R.bone;
  const SHARDS = [
    ['X...', '.XX.', '..XX'], ['XX..', '.XXX', '...X'], ['.X..', 'XXX.', '..XX'], ['X.X', '.X.', 'X.X'], ['XX', '.X', '.XX'],
  ];
  for (let b = 0; b < 7; b++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const rows = rng.pick(SHARDS);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== 'X') continue;
        const under = r + 1 < rows.length && rows[r + 1][c] === 'X';
        if (!under) s.set(x + c + 1, y + r + 1, G[1]);
        s.set(x + c, y + r, r === 0 || c === 0 ? BONE[4] : BONE[3]);
        s.setH(x + c, y + r, 0.7);
      }
    }
  }
  for (let n = 0; n < 5; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, R.rust[3]); s.set(x + 1, y, R.rust[2]);
  }
  return { normal: 1.4 };
}

// ---------------------------------------------------------------------------------------------
// Sides (32 × 32 cliffs, 16 × 16 banks)
// ---------------------------------------------------------------------------------------------

/**
 * Stratified cliff (32 × 32), the library cliff's method (`genCliff`: rock pieces as cells of a
 * periodic Voronoi flattened along the strata) with a colour and a hardness per stratum. The canvas
 * holds four strata of 8 px (LEVEL_HEIGHT); a piece takes its stratum's ramp from the row of its
 * cell point (one in six its neighbour's, so the colour boundaries run ragged). Near-horizontal
 * borders between pieces are the bedding: dark crevices with a lit ledge on the piece below and a
 * shaded, rounded underside on the piece above — deeper under a hard stratum, which also throws a
 * shadow onto the top of the one below it. Near-vertical borders are soft seams, a third of them
 * open joints. Soft strata carry fine wavy bedding lines (or cross-bedding: diagonal laminae) and
 * weathering pits; dark desert varnish runs down from under a few hard ledges. Seamless both ways.
 * @param {Array<{ R: any[], hard?: boolean, cross?: boolean, base?: number }>} strata top → bottom
 *   (four: the rows of 8 px)
 */
function paintStrata(s, ctx, K, R, strata, { varnish = 3, pits = 6, cols = 3 } = {}) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const rowsN = strata.length;
  const rowH = h / rowsN;
  const v = voronoi(w, h, cols, rowsN, seed + 5, { jitter: 0.75, sy: 3.2 });
  const N = K.field(w, h, 4, 8, seed + 3, { oct: 2 });
  const pieces = [];
  for (let k = 0; k < v.count; k++) {
    let row = Math.floor(v.py[k] / rowH) % rowsN;
    if (rng.chance(1 / 6)) row = mod(row + (rng.chance(0.5) ? 1 : -1), rowsN);
    const st = strata[row];
    pieces.push({ st, row, R: st.R, base: (st.base ?? 4) + rng.pick([0, 0, 0, 1, -1]), facet: rng.range(0.8, 1.2) });
  }
  const id = v.id;
  const idAt = (x, y) => id[s.ix(x, y)];
  // crevice pixels: the bottom row of a piece whose lower neighbour is another piece (2 px under a
  // hard stratum where it overhangs)
  const crev = new Uint8Array(w * h);
  s.each((x, y, i) => { if (idAt(x, y + 1) !== id[i]) crev[i] = 1; });
  s.each((x, y, i) => {
    if (crev[s.ix(x, y + 1)] !== 1 || crev[i] || idAt(x, y + 2) === id[i]) return;
    if (pieces[id[i]].st.hard || hash2(id[i], 3, seed) < 0.25) crev[i] = 2;
  });
  const pair = (a, b) => hash2(Math.min(a, b), Math.max(a, b), seed + 11);
  s.each((x, y, i) => {
    const p = pieces[id[i]];
    const hard = !!p.st.hard;
    if (crev[i]) { s.set(x, y, ri(p.R, crev[i] === 1 ? 2 : 3)); s.hf[i] = 0.1; return; }
    let k = p.base;
    let hh = hard ? 0.78 : 0.66;
    const up = crev[s.ix(x, y - 1)] > 0 && idAt(x, y - 1) !== id[i];
    const up2 = !up && crev[s.ix(x, y - 2)] > 0 && idAt(x, y - 2) !== id[i];
    const down = crev[s.ix(x, y + 1)] > 0;
    const down2 = !down && crev[s.ix(x, y + 2)] > 0;
    // facet: the upper-left of a piece a touch brighter, its lower-right a touch darker
    const f = v.ox[i] * 0.1 + v.oy[i] * 0.35 * p.facet;
    if (f < -1) { k += 1; hh += 0.06; } else if (f > 0.8) { k -= 1; hh -= 0.06; }
    // the piece above: a hard one overhangs and shades this ledge's back
    const aboveHard = up && pieces[idAt(x, y - 1)].st.hard;
    if (up) { k = p.base + (aboveHard ? 0 : 1); hh = 0.92; } // a lit ledge (in the overhang's shade under a hard stratum)
    else if (up2) { k = p.base + (aboveHard ? 1 : hash2(x, y, seed + 4) < 0.6 ? 1 : 0); hh = 0.86; }
    else if (down) { k -= hard ? 2 : 1; hh = 0.5; } // the rounded underside
    else if (down2 && hard) { k -= 1; hh = 0.6; }
    else if (!hard && !p.st.cross && mod(y + Math.round((wobble(x, w, 4, seed + p.row) - 0.5) * 2.4), 3) === 1 && hash2(x, y, seed + 41) < 0.6) k -= 1; // fine bedding
    if (p.st.cross && !up && !down && mod(x + (y % rowH) * 2 + Math.round((wobble(x, w, 2, seed + 40) - 0.5) * 4), 6) === 0) k -= 1; // cross-bedding
    // vertical borders: a soft seam (shade left of it, light right of it), or an open joint
    const r = idAt(x + 1, y);
    if (!up && r !== id[i]) {
      if (pair(id[i], r) < 0.22) { s.set(x, y, ri(p.R, 1)); s.hf[i] = 0.12; return; }
      k -= 1;
    } else if (!up && !down && idAt(x - 1, y) !== id[i]) k += 1;
    if (N[i] > 0.9) k += 1; else if (N[i] < 0.08) k -= 1;
    if (hash2(x, y, seed + 7) < 0.03) k += 1;
    s.set(x, y, ri(p.R, k));
    s.hf[i] = hh + (N[i] - 0.5) * 0.05;
  });
  // weathering pits (tafoni) in the soft strata
  for (let n = 0, placed = 0; n < 80 && placed < pits; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const i = s.ix(x, y);
    const p = pieces[id[i]];
    if (p.st.hard || crev[i] || crev[s.ix(x, y + 1)] || crev[s.ix(x, y - 1)] || crev[s.ix(x + 1, y)]) continue;
    s.set(x, y, ri(p.R, 1)); s.set(x + 1, y, ri(p.R, 2)); s.set(x, y + 1, ri(p.R, p.base + 1)); s.set(x + 1, y + 1, ri(p.R, p.base));
    s.setH(x, y, 0.25); s.setH(x + 1, y, 0.3);
    placed++;
  }
  // desert varnish: dark streaks running down from under a hard stratum's crevice
  for (let n = 0, placed = 0; n < 120 && placed < varnish; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const i = s.ix(x, y);
    if (crev[i] !== 1 || !pieces[id[i]].st.hard) continue;
    const len = rng.int(5, 11);
    for (let k = 1; k <= len; k++) {
      if (hash2(x, y + k, seed + 9) < 0.12 + (k / len) * 0.5) continue;
      s.tint(x, y + k, '#1c110d', 0.5 - (k / len) * 0.3);
      if (k < len / 2 && hash2(x + 1, y + k, seed + 10) < 0.45) s.tint(x + 1, y + k, '#1c110d', 0.28);
    }
    placed++;
  }
  return { normal: 2.4 };
}

/** Sandstone cliff: ochre, cream and rust strata — a hard sandstone ledge, a cross-bedded one. */
function genSandstoneCliff(s, ctx, K, R) {
  return paintStrata(s, ctx, K, R, [
    { R: R.sand, hard: true }, { R: R.cream, base: 5, cross: true }, { R: R.rust }, { R: R.ochre, hard: true },
  ], { varnish: 3, pits: 6 });
}

/** Red rock cliff: massive deep-red strata, cross-bedded, a bleached pale band, a maroon one. */
function genRedrockCliff(s, ctx, K, R) {
  return paintStrata(s, ctx, K, R, [
    { R: R.redrock, hard: true }, { R: R.cream, base: 5 }, { R: R.maroon, base: 5, cross: true }, { R: R.redrock, hard: true },
  ], { varnish: 4, pits: 4 });
}

/**
 * Columnar basalt (32 × 32): vertical columns 3–6 px wide split by dark joints, each column's face
 * from its lit left edge to its shaded right one, cross-fractures at random heights (a dark line,
 * slanted, over a lit lip), cool blue-grey columns and a few warmer brown-grey ones, vesicles.
 */
function genBasaltCliff(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const B = halfRamp(K, R.basalt);
  const cols = [];
  let x0 = rng.int(0, w - 1);
  let left = w;
  while (left > 0) {
    let cw = Math.min(left, rng.int(4, 6));
    if (left - cw > 0 && left - cw < 4) cw = left;
    const fr = [];
    for (let f = 0, n = rng.int(2, 4); f < n; f++) fr.push({ y: rng.int(0, h - 1), slant: rng.pick([-1, 0, 0, 1]) });
    cols.push({ x: x0, w: cw, base: rng.pick([8, 9, 9, 10]), warm: rng.chance(0.15), fr });
    x0 += cw;
    left -= cw;
  }
  const N = K.field(w, h, 4, 8, seed + 3, { oct: 2 });
  for (const c of cols) {
    for (let u = 0; u < c.w; u++) {
      const x = mod(c.x + u, w);
      const right = u === c.w - 1;
      for (let y = 0; y < h; y++) {
        const i = s.ix(x, y);
        let k = c.base + (u === 0 ? 3 : u === 1 ? 1 : u === c.w - 2 ? -2 : 0);
        let hh = 0.7 - Math.abs(u - (c.w - 1) / 2) * 0.05;
        if (right) { k = 0; hh = 0.08; } // the joint
        else {
          for (const f of c.fr) {
            const fy = mod(f.y + Math.round(f.slant * (u - c.w / 2) * 0.5), h);
            if (y === fy) { k = 2; hh = 0.2; }
            else if (y === mod(fy + 1, h)) { k += 2; hh += 0.05; }
            else if (y === mod(fy - 1, h)) k -= 1;
          }
        }
        if (!right) {
          if (N[i] > 0.92) k += 1; else if (N[i] < 0.06) k -= 1;
          if (hash2(x, y, seed + 5) < 0.04) k += 2;
        }
        let col = ri(B, k);
        if (c.warm) col = K.mixColor(col, ri(R.scree, k >> 1), 0.3);
        s.set(x, y, col);
        s.hf[i] = hh;
      }
    }
  }
  for (let n = 0; n < 14; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, B[0]); s.set(x + 1, y + 1, B[12]);
    s.setH(x, y, 0.2);
  }
  return { normal: 2.4 };
}

/**
 * Dirt bank (16 × 16): two soil layers per unit, gently undulating across the width (continuous, so
 * the repeat reads as layering), each with a crumbly lit top and a darker broken seam at its base;
 * low-contrast clods, a pale dry rootlet, an embedded stone.
 */
function genAridDirtSide(s, ctx, K, R) {
  const { w, h } = s;
  const seed = ctx.seedOf('arid_dirt_side');
  const rng = new K.RNG(seed);
  const D = R.ochre;
  const A = K.field(w, h, 2, 4, seed + 1, { oct: 3 });
  const F = K.field(w, h, 5, 5, seed + 2, { oct: 2 });
  const wob = new Float32Array(w);
  for (let x = 0; x < w; x++) wob[x] = (wobble(x, w, 2, seed + 7) - 0.5) * 3;
  s.each((x, y, i) => {
    const ly = mod(y + Math.round(wob[x]), 8);
    const d = (bayer4(x, y) - 0.5) * 0.14;
    const a = (A[i] - 0.5) * 0.6 + 0.5 + d + (ly <= 2 ? 0.16 : ly >= 6 ? -0.14 : 0);
    let k = a < 0.3 ? 3 : a > 0.72 ? 5 : 4;
    if (F[i] > 0.93) k += 1; else if (F[i] < 0.06) k -= 1;
    if (ly === 7 && hash2(x >> 1, y, seed + 3) < 0.6) k = 2;
    else if (ly === 0 && hash2(x, y, seed + 4) < 0.5) k += 1;
    s.set(x, y, D[k]);
    s.hf[i] = 0.4 + (A[i] - 0.5) * 0.25 + (ly <= 1 ? 0.12 : ly === 7 ? -0.2 : 0);
  });
  // a pale dry rootlet
  let x = rng.int(0, w - 1), y = rng.int(2, h - 3);
  for (let k = 0, len = rng.int(3, 5); k < len; k++) {
    s.set(x, y, R.straw[4]); s.set(x, y + 1, D[2]); s.setH(x, y, 0.55);
    x += 1; if (rng.chance(0.45)) y += rng.chance(0.5) ? 1 : -1;
  }
  pebble(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(1, 3), R.sand, 4, D[2]);
  return { normal: 1.8 };
}

/** The dry grass brim (16 × 16 lip): the dirt bank's body, a straw lip of 3–6 px, hanging blades. */
function genDryGrassSide(s, ctx, K, R) {
  const { w, h } = s;
  genAridDirtSide(s, ctx, K, R);
  const { rng, seed } = ctx;
  const G = R.straw;
  const lip = new Int32Array(w);
  for (let x = 0; x < w; x++) lip[x] = clamp(4 + Math.round((wobble(x, w, 4, seed + 1) - 0.5) * 3.2) + (hash2(x, 0, seed) < 0.25 ? 1 : 0), 3, 6);
  // the overhang's shadow on the bank below
  for (let x = 0; x < w; x++) {
    for (let d = 1; d <= 3; d++) {
      s.tint(x, lip[x] + d, '#24140e', d === 1 ? 0.5 : d === 2 ? 0.3 : 0.12);
      s.setH(x, lip[x] + d, s.H(x, lip[x] + d) * 0.6);
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y <= lip[x]; y++) {
      let k;
      if (y === 0) k = hash2(x, 1, seed) < 0.35 ? 6 : 5;
      else if (y === 1) k = hash2(x, 2, seed) < 0.5 ? 5 : 4;
      else if (y === lip[x]) k = 2;
      else if (y === lip[x] - 1) k = hash2(x, y, seed) < 0.5 ? 2 : 3;
      else k = hash2(x, y, seed + 5) < 0.3 ? 4 : 3;
      s.set(x, y, G[k]);
      s.setH(x, y, 1 - y * 0.07);
    }
  }
  // downward blade strokes and a few olive bases inside the lip
  for (let x = 0; x < w; x++) {
    if (hash2(x, 3, seed) < 0.45) {
      const y = 2 + Math.floor(hash2(x, 4, seed) * 2);
      if (y < lip[x] - 1) { s.set(x, y, G[5]); s.set(x, y + 1, G[3]); }
    }
    if (hash2(x, 6, seed) < 0.2) s.set(x, lip[x] - 1, R.sage[2]);
  }
  // hanging dry blades, some bleached to the tip
  for (let k = 0, n = rng.int(4, 6); k < n; k++) {
    const x = rng.int(0, w - 1);
    const len = rng.int(1, 3);
    for (let d = 1; d <= len; d++) {
      s.set(x, lip[x] + d, d === len ? G[6] : G[3]);
      s.setH(x, lip[x] + d, 0.8);
    }
    s.tint(x + 1, lip[x] + len + 1, '#24140e', 0.3);
  }
  return { normal: 2.2 };
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

/** Every arid texture name (the contract's fifteen and the red rock top): ./names.js. */
export { ARID_TEXTURE_NAMES } from './names.js';

/**
 * @param {TextureKit} K
 * @returns {Record<string, TexDef>}
 */
export function aridTextures(K) {
  const R = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, v.map(K.parseColor)]));
  /**
   * @param {(s: any, ctx: any, K: TextureKit, R: Record<string, any[]>, o?: any) => any} fn
   * @param {any} [o] the painter's options
   */
  const g = (fn, o) => (s, ctx) => fn(s, ctx, K, R, o);
  return {
    // tops (4 × 4 units)
    arid_dirt: { px: [64, 64], gen: g(genAridDirt), normalScale: 0.6 },
    cracked_earth: { px: [64, 64], gen: g(genCrackedEarth), normalScale: 0.65 },
    dry_grass: { px: [64, 64], gen: g(genDryGrass), normalScale: 0.45 },
    red_sand: { px: [64, 64], gen: g(genRedSand), normalScale: 0.5 },
    sandstone: { px: [64, 64], gen: g(genSlickrock, { main: R.sand, alt: R.cream, drift: R.sand }), normalScale: 0.6 },
    redrock: { px: [64, 64], gen: g(genSlickrock, { main: R.redrock, alt: R.rust, drift: R.rust }), normalScale: 0.6 },
    scree: { px: [64, 64], gen: g(genScree), normalScale: 0.7 },
    flagstone: { px: [64, 64], gen: g(genFlagstone), normalScale: 0.6 },
    scorched: { px: [64, 64], gen: g(genScorched), normalScale: 0.55 },
    basalt: { px: [64, 64], gen: g(genBasalt), normalScale: 0.7 },
    ash: { px: [64, 64], gen: g(genAsh), normalScale: 0.5 },
    // cliffs (2 × 2 units, like stone_wall) and banks (1 × 1, like dirt_side / grass_side)
    sandstone_cliff: { px: [32, 32], gen: g(genSandstoneCliff), normalScale: 0.7 },
    redrock_cliff: { px: [32, 32], gen: g(genRedrockCliff), normalScale: 0.7 },
    basalt_cliff: { px: [32, 32], gen: g(genBasaltCliff), normalScale: 0.7 },
    dry_grass_side: { px: [16, 16], gen: g(genDryGrassSide), normalScale: 0.7 },
    arid_dirt_side: { px: [16, 16], gen: g(genAridDirtSide), normalScale: 0.7 },
  };
}
