import { valueNoise2, hash2, clamp, smoothstep, bayer4 } from '../../utils/math.js';

/**
 * The season texture set of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §6.2,
 * docs/design/SEASONS_LOOK.md §3): the tops, cliffs and brims named in ./names.js
 * (`SEASON_TEXTURE_NAMES`) — spring young grass and grass strewn with blossom, autumn grass, stubble
 * and fallen leaves, warm limestone and its cliffs and the cove's sand, slate and frosted cobbles,
 * snow, a trodden snow path, snowy banks, thick ice and an ice cliff — and, apart, the season trees'
 * canopies, pine tiers and barks (`SEASON_TREE_TEXTURE_NAMES`: blossom, maple, golden birch, the
 * snow-laden pine, cherry and frosted bark). Registered by the season kit's chunk
 * (src/engine/world/SeasonKitParts.js for the terrain set, props/SeasonTrees.js for the tree set:
 * `registerTextureSet`), so a level that names none of them paints and downloads none of them.
 *
 * Every painter works like the library's own (the header of ../Textures.js) and the arid set's
 * (./arid.js): colour and a height field painted together on a seamless `Surf`, the key light at the
 * top-left baked into the forms, ramps of 8 hand-picked tones that shift toward violet in the shade
 * and toward warm in the light. Sizes: tops 64 × 64 (4 × 4 units; the organic ones turned per tile:
 * TileMap ORGANIC_TOPS), cliffs 32 × 32 (strata on multiples of 8 px: LEVEL_HEIGHT), banks and brims
 * 16 × 16, canopies and pine tiers 32 × 32 (alpha), barks 16 × 32. The palettes keep the visual
 * critic's rules (SEASONS_LOOK.md §2): blossom ≈ 70 % white and cream with its pinks on the lilac side,
 * limestone never above `#d8ccb0`, lit snow at `#dfe8f4` at most.
 *
 * @import { TextureKit, TexDef } from '../Textures.js'
 */

export { SEASON_TEXTURE_NAMES } from './names.js';

/** The season trees' textures (canopies, pine tiers, barks): their own set, ./SeasonTrees.js registers it. */
export const SEASON_TREE_TEXTURE_NAMES = Object.freeze([
  'leaves_blossom', 'leaves_maple', 'leaves_gold', 'pine_snow', 'bark_cherry', 'bark_frost',
]);

// ---------------------------------------------------------------------------------------------
// Ramps (dark → light)
// ---------------------------------------------------------------------------------------------

const HEX = {
  // spring: young grass (genGrass's six tones), its full ramp; blossom petals (lilac-side pinks)
  young6: ['#1f3a2c', '#2f5e34', '#3f7a3a', '#6fae48', '#a4d064', '#d6ec90'],
  young: ['#18302a', '#244a30', '#3f7a3a', '#56913f', '#6fae48', '#8fc454', '#b4d86a', '#dcee98'],
  petal: ['#8e4a72', '#c27aa4', '#d98ab4', '#f2bcd6', '#fbe2ea', '#fff0ee', '#fff6f2'],
  // autumn: russet grass (six), the leaves of the canopy ramp, wheat and the soil under it
  russet6: ['#3a2a26', '#5e4228', '#8a6430', '#b48c3c', '#d6b058', '#eed28c'],
  leaf: ['#3a1620', '#4a1a22', '#8a2a22', '#c8502a', '#ec9234', '#f6c860', '#fbe2a0'],
  wheat: ['#2e2016', '#4a3418', '#6a4c22', '#a8822e', '#d8b456', '#f2dc96', '#fbefc8'],
  soil: ['#1c1418', '#2c1e1c', '#402c26', '#563c2e', '#6e4e38', '#866444', '#9c7a56', '#b29470'],
  // the coast: warm limestone (never above #d8ccb0), the cove's sand, sea-pink lichen and yellow lichen
  lime: ['#38323a', '#4e463e', '#6e6050', '#8a7c66', '#a89878', '#baac8c', '#c8bc9e', '#d8ccb0'],
  sand: ['#5a4c40', '#7a6a56', '#9c8a6e', '#b8a684', '#cbbb98', '#d8caa8', '#e2d6b8', '#ece2c8'],
  lichen: ['#8a6a2a', '#b8902e', '#d8b440', '#ecd27a'],
  // streets: blue slate; the frosted cobbles' stone
  slate: ['#16192a', '#22283a', '#2e3650', '#3e4a66', '#4c5876', '#5e6c8a', '#76849e', '#929eb4'],
  stone: ['#1c1c26', '#2a2a36', '#3a3c4c', '#4c5062', '#626678', '#7a7e8e', '#9498a6', '#aeb2be'],
  // winter: the frozen base snow, packed snow, cold stone, ice
  snow: ['#3a4474', '#4b5788', '#61709e', '#7d8fbe', '#98a8cc', '#b4c4dc', '#c8d4e8', '#dfe8f4'],
  packed: ['#2e3654', '#3e4a66', '#52607e', '#687694', '#808caa', '#98a4be', '#aebad0', '#c2cce0'],
  rock: ['#12121c', '#1c1c28', '#282a38', '#3a3e50', '#4a4e62', '#5c6074', '#727688', '#8a8ea0'],
  ice: ['#0e2236', '#14304a', '#1c4a68', '#2a6888', '#3a86a8', '#5ca8c8', '#8fd6ea', '#bcecf6', '#e2fbff'],
  // trees: cherry bark (dark plum-brown), frosted grey bark; the canopies' ramps
  cherry: ['#140c10', '#1e1418', '#2a1c22', '#3a2a30', '#4c383c', '#604a4a', '#76605a'],
  frost: ['#1a1c26', '#2a2c38', '#3c3e4c', '#525462', '#6a6c7a', '#8a8e9c', '#aeb4c2'],
  // (genFoliage's six tones: the shade a sakura rose — warm enough that the grade's teal shadows
  // leave it pink, not hydrangea purple —, the lit tones a pink white on the lilac side, so the warm
  // sun and the grade's orange turn land on sakura, not peach — review EV-70)
  blossomCanopy: ['#b06a84', '#e6a6be', '#f2bcd6', '#f8d4e2', '#fbe2ea', '#fef0f4'],
  // (the darks lifted: a backlit maple's shade reads red, not brown murk — VQ-09)
  maple: ['#5a1e26', '#8a2a22', '#b8401e', '#dc6224', '#f0962e', '#f8c868'],
  gold: ['#3e2a12', '#6a4a16', '#a8781e', '#d8a630', '#f0cc52', '#faea94'],
  greens: ['#3e6a2e', '#5e8e38', '#8cc054'],
};

/** Ramp lookup with clamping. */
const ri = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
const mod = (a, n) => ((a % n) + n) % n;
/** Seamless 1D value noise along x (period `p` cells across the width `w`), in [0, 1). */
const wobble = (x, w, p, seed) => valueNoise2((x / w) * p, 0.5, seed, p);

// ---------------------------------------------------------------------------------------------
// Painting helpers the kit does not carry (as ./arid.js keeps its own)
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

/** 1 px emboss of a level map lit from the top-left (+1 lit rim, −1 shade below a higher level). */
function emboss(lv, w, h, x, y) {
  const L = lv[y * w + x];
  const up = lv[mod(y - 1, h) * w + x];
  const left = lv[y * w + mod(x - 1, w)];
  if (up > L || left > L) return -1;
  if (up < L || left < L) return 1;
  return 0;
}

/**
 * Jittered-grid Voronoi, periodic: per pixel the nearest cell `id`, the one across the nearest border
 * (`id2`), the distance to the cell border (`edge`, px), the distance to the cell point (`dist`) and
 * the offset from it (`ox`, `oy`).
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

/** A seeded random-walk crack (wrapping): `dark` on the path, `light` below-right of it. */
function crack(s, x, y, len, rng, { dark, light = null, depth = 0.25, keep = null }) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let d = rng.int(0, 7);
  const path = [];
  for (let k = 0; k < len; k++) {
    if (keep && !keep(x, y)) break;
    path.push([x, y]);
    const r = rng.next();
    const dd = r < 0.6 ? 0 : r < 0.8 ? 1 : -1;
    const [dx, dy] = dirs[mod(d + dd, 8)];
    if (rng.chance(0.18)) d = mod(d + dd, 8);
    x += dx; y += dy;
  }
  if (light) for (const [px, py] of path) if (!path.some(([qx, qy]) => qx === px + 1 && qy === py + 1)) s.set(px + 1, py + 1, light);
  for (const [px, py] of path) { s.set(px, py, dark); s.setH(px, py, s.H(px, py) - depth); }
  return path;
}

const PEBBLES = [['X'], ['XX'], ['XX', 'XX'], ['XXX', 'XX.'], ['.XX', 'XXX', '.X.'], ['.XX.', 'XXXX', '.XX.']];

/** A small shaded pebble (wrapping): lit top-left, shaded lower-right, a cast shadow below-right. */
function pebble(s, x, y, shape, R, base, shadow, { h = 0.8, spec = null } = {}) {
  const rows = PEBBLES[shape];
  const inside = (u, v) => v >= 0 && v < rows.length && u >= 0 && u < rows[v].length && rows[v][u] === 'X';
  if (shadow) {
    for (let v = 0; v <= rows.length; v++) {
      for (let u = 0; u <= rows[0].length; u++) if (!inside(u, v) && inside(u - 1, v - 1)) s.set(x + u, y + v, shadow);
    }
  }
  for (let v = 0; v < rows.length; v++) {
    for (let u = 0; u < rows[v].length; u++) {
      if (!inside(u, v)) continue;
      const tl = !inside(u - 1, v) || !inside(u, v - 1);
      const br = !inside(u + 1, v) || !inside(u, v + 1);
      s.set(x + u, y + v, ri(R, base + (tl && !br ? 1 : br && !tl ? -1 : 0)));
      s.setH(x + u, y + v, h);
    }
  }
  if (spec) s.set(x + rows[0].indexOf('X'), y, spec);
}

/**
 * Recolour the library's grass greens (PALETTE.grass, as genGrassSide paints its lip) with another
 * six-tone ramp, tone for tone: a brim of another season over the same bank.
 */
function recolourGrass(s, K, R6) {
  const G = K.PALETTE.grass.map(K.parseColor);
  s.each((x, y) => {
    const c = s.get(x, y);
    if (!c[3]) return;
    for (let k = 0; k < G.length; k++) {
      const g = G[k];
      if (c[0] === g[0] && c[1] === g[1] && c[2] === g[2]) { s.set(x, y, R6[k]); return; }
    }
  });
}

/** A fallen petal (1–2 px with a shaded pixel) or a tiny five-petal blossom on the ground. */
function petal(s, x, y, P, kind, shade) {
  if (kind === 2) {
    // a whole blossom: a pale centre ring around a pink eye
    s.set(x, y - 1, P[5]); s.set(x - 1, y, P[5]); s.set(x + 1, y, P[4]); s.set(x, y + 1, P[4]);
    s.set(x, y, P[1]);
    s.set(x + 1, y + 1, shade);
    s.setH(x, y, 0.62);
    return;
  }
  s.set(x, y, kind ? P[3] : P[6]);
  if (kind === 0 || (x + y) & 1) s.set(x + 1, y, kind ? P[2] : P[5]);
  s.set(x, y + 1, shade);
  s.setH(x, y, 0.55);
}

/** A fallen leaf (3–5 px): a pointed oval along a diagonal, lit rim, a darker vein, a shadow. */
function leafOnGround(s, x, y, L, base, dir, shade) {
  const dx = dir & 1 ? 1 : -1;
  const pts = [[0, 0], [dx, 0], [0, 1], [dx, 1], [2 * dx, 1], [dx, 2]];
  for (const [u, v] of pts) s.set(x + u + 1, y + v + 1, shade);
  for (const [u, v] of pts) {
    const lit = v === 0 || (u === 0 && dx > 0) || (u === dx * 2);
    s.set(x + u, y + v, ri(L, base + (lit ? 1 : v === 2 ? -1 : 0)));
    s.setH(x + u, y + v, 0.6);
  }
  s.set(x + dx, y + 1, ri(L, base - 1));
}

// ---------------------------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------------------------

/**
 * Young spring grass: the library's grass on the young ramp (lush, a little yellow in the light),
 * clover patches a tone darker, a few daisies and buttercup specks.
 */
function genSpringGrass(s, ctx, K, R) {
  const { w, h } = s;
  const seed = ctx.seed;
  K.genGrass(s, ctx, { ramp: R.young6, warm: 0.08, density: 0.82, levels: [0.12, 0.46, 0.82] });
  const rng = new K.RNG(seed + 71);
  const C = K.field(w, h, 3, 3, seed + 4, { oct: 3 });
  // clover: round leaflets in the darker patches
  for (let n = 0; n < 34; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (C[s.ix(x, y)] < 0.62 || s.H(x, y) > 0.45) continue;
    s.set(x + 1, y + 1, R.young[1]);
    s.set(x, y, R.young[3]); s.set(x + 1, y, R.young[4]); s.set(x, y - 1, R.young[5]);
    s.setH(x, y, 0.5);
  }
  // daisies (white, a yellow eye) and buttercups, sparse
  for (let n = 0; n < 10; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (n % 3 === 2) { s.set(x, y, '#f2d84a'); s.set(x + 1, y + 1, R.young[2]); continue; }
    s.set(x, y - 1, '#f6f2ea'); s.set(x - 1, y, '#f6f2ea'); s.set(x + 1, y, '#e8e4dc'); s.set(x, y, '#e8c048');
    s.set(x, y + 1, R.young[2]);
    s.setH(x, y, 0.7);
  }
  return { normal: 1.4 };
}

/**
 * Grass strewn with blossom: the young grass with drifts of fallen petals (white and cream mostly,
 * pinks on the lilac side), thickest where the drift field is high, whole blossoms here and there.
 */
function genBlossomGrass(s, ctx, K, R) {
  const { w, h } = s;
  genSpringGrass(s, ctx, K, R);
  const rng = new K.RNG(ctx.seed + 91);
  const D = K.field(w, h, 2, 2, ctx.seed + 6, { oct: 3 });
  const P = R.petal;
  for (let n = 0; n < 420; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const d = D[s.ix(x, y)];
    if (rng.next() > d * d * 1.25) continue;
    const r = rng.next();
    const shade = K.mixColor(s.get(x, y + 1), '#3a2448', 0.35);
    // ≈ 70 % white and cream, the rest lilac pink; one in twelve a whole blossom
    petal(s, x, y, P, r < 0.085 ? 2 : r < 0.7 ? 0 : 1, shade);
  }
  return { normal: 1.4 };
}

/** The spring brim (a `lip` over a cliff): the library's grass brim on the young ramp. */
function genSpringGrassSide(s, ctx, K, R) {
  K.genGrassSide(s, ctx);
  recolourGrass(s, K, R.young6);
  return { normal: 2.2 };
}

// ---------------------------------------------------------------------------------------------
// Autumn
// ---------------------------------------------------------------------------------------------

/**
 * Autumn grass: the library's grass on a russet ramp (golden straw lit, violet-brown shade), a few
 * green clumps left (the cool counterweight), fallen leaves and chicory's blue.
 */
function genAutumnGrass(s, ctx, K, R) {
  const { w, h } = s;
  const seed = ctx.seed;
  K.genGrass(s, ctx, { ramp: R.russet6, warm: 0, density: 0.84, levels: [0.14, 0.48, 0.84] });
  const rng = new K.RNG(seed + 73);
  const G = K.field(w, h, 3, 3, seed + 5, { oct: 3 });
  // green clumps still holding on
  for (let n = 0; n < 46; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (G[s.ix(x, y)] < 0.74) continue;
    s.set(x + 1, y + 1, '#2a2a1e');
    s.set(x, y, R.greens[0]); s.set(x + 1, y, R.greens[0]); s.set(x, y - 1, R.greens[1]); s.set(x - 1, y - 1, R.greens[2]);
    s.setH(x, y, 0.7);
  }
  // fallen leaves
  for (let n = 0; n < 22; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    leafOnGround(s, x, y, R.leaf, rng.int(2, 5), rng.int(0, 3), K.mixColor(s.get(x + 1, y + 2), '#1e1020', 0.4));
  }
  // chicory: a few blue stars
  for (let n = 0; n < 5; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, '#5a7ad8'); s.set(x + 1, y, '#8aa2ec'); s.set(x, y + 1, '#3a4a8a');
  }
  return { normal: 1.4 };
}

/** The autumn brim: the library's grass brim on the russet ramp. */
function genAutumnGrassSide(s, ctx, K, R) {
  K.genGrassSide(s, ctx);
  recolourGrass(s, K, R.russet6);
  return { normal: 2.2 };
}

/**
 * Stubble: a harvested field — rows every 8 px of cut straw stalks (a lit tip, a dark foot) on soil,
 * loose straw between the rows, a few green weeds. Rows stay unturned (not in ORGANIC_TOPS).
 */
function genStubble(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = R.soil;
  const W = R.wheat;
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3 });
  const wob = new Float32Array(w);
  for (let x = 0; x < w; x++) wob[x] = (wobble(x, w, 3, seed + 3) - 0.5) * 2.2;
  s.each((x, y, i) => {
    const ph = mod(y + wob[x], 8);
    let k = ph < 2 ? 4 : ph < 4 ? 3 : ph < 6 ? 2 : 3;
    if (A[i] > 0.8) k += 1; else if (A[i] < 0.12) k -= 1;
    const q = hash2(x, y, seed + 5);
    if (q < 0.045 && ph >= 3) {
      // loose straw in the furrows
      s.set(x, y, ri(W, q < 0.015 ? 5 : 3));
      s.hf[i] = 0.4;
      return;
    }
    s.set(x, y, ri(S, k));
    s.hf[i] = 0.3 + (ph < 3 ? 0.1 : 0);
  });
  // the stalks: on each row's crest, every 2–3 px, 2–3 px tall
  for (let row = 0; row < h / 8; row++) {
    for (let x = rng.int(0, 1); x < w; x += rng.int(2, 3)) {
      const y = Math.round(row * 8 + 2 - wob[x]);
      const tall = rng.int(2, 3);
      s.set(x + 1, y + 1, S[1]);
      for (let k = 0; k < tall; k++) {
        s.set(x, y - k, ri(W, k === tall - 1 ? 6 : k === 0 ? 3 : 5));
        s.setH(x, y - k, 0.6 + k * 0.12);
      }
      s.set(x, y + 1, S[2]);
    }
  }
  // weeds
  for (let n = 0; n < 8; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, R.greens[1]); s.set(x - 1, y - 1, R.greens[2]); s.set(x + 1, y - 1, R.greens[1]); s.set(x, y + 1, S[1]);
  }
  return { normal: 1.8 };
}

/**
 * Fallen leaves: ground carpeted in leaves — layered pointed ovals in red, orange, gold and brown,
 * each with its lit rim and a shadow on what lies below; the dark soil and a few blades between.
 */
function genFallenLeaves(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = R.soil;
  const A = K.field(w, h, 3, 3, seed + 1, { oct: 3 });
  s.each((x, y, i) => {
    const q = hash2(x, y, seed);
    s.set(x, y, ri(S, 2 + (A[i] > 0.6 ? 1 : 0) + (q < 0.1 ? 1 : 0)));
    s.hf[i] = 0.25;
  });
  // blades of grass between
  for (let n = 0; n < 60; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, ri(R.russet6, rng.int(2, 4))); s.set(x, y - 1, ri(R.russet6, 4));
  }
  // two layers of leaves, back to front; reds, oranges and golds in broad patches (one colour family
  // a patch, so the carpet reads in areas, not as confetti), a few brown
  const T = K.field(w, h, 2, 2, seed + 2, { oct: 2 });
  for (let layer = 0; layer < 2; layer++) {
    for (let n = 0; n < 125; n++) {
      const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
      const t = T[s.ix(x, y)];
      const base = t > 0.62 ? 5 : t < 0.36 ? (rng.chance(0.7) ? 3 : 2) : 4;
      const brown = rng.chance(0.1);
      const L = brown ? R.soil : R.leaf;
      leafOnGround(s, x, y, L, brown ? 5 : base, rng.int(0, 3), K.mixColor(s.get(x + 1, y + 2), '#140a14', 0.45));
    }
  }
  return { normal: 1.7 };
}

// ---------------------------------------------------------------------------------------------
// The coast
// ---------------------------------------------------------------------------------------------

/**
 * Warm limestone pavement: clints (rounded slabs, lit at the top-left) in courses, split by grykes
 * with turf on both lips and a soil floor (a third grown over), rain pits, gold and grey lichen
 * (review EV-40: dark, every-way grykes read as cracked dry mud).
 */
function genLimestone(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const L = halfRamp(K, R.lime);
  const G = R.greens;
  // clints in courses (2 × 4 cells: the joints run mostly one way, as real clints' do), rounded at
  // their rims, split by grykes with turf on both lips and, in a third of them, across the floor
  const v = voronoi(w, h, 2, 4, seed + 3, { jitter: 0.8 });
  const N = K.field(w, h, 4, 4, seed + 4, { oct: 3 });
  const P = K.field(w, h, 6, 6, seed + 6, { oct: 2 });
  const base = [];
  for (let k = 0; k < v.count; k++) base.push(rng.pick([9, 10, 10, 11, 11, 12]));
  s.each((x, y, i) => {
    const e = v.edge[i] + (N[i] - 0.5) * 1.2;
    const lit = v.ox[i] * 0.6 + v.oy[i] < 0;
    if (e < 1.7) {
      // the gryke: turf on both lips (lit on the near one), a soil floor a few tones down — not a
      // black crack (desiccation mud) —, grown over in a third of the grykes
      const q = hash2(x, y, seed + 2);
      const grown = hash2(Math.min(v.id[i], v.id2[i]), Math.max(v.id[i], v.id2[i]), seed + 5) < 0.34;
      const c = e < 0.6 && !grown ? L[2] : lit ? (q < 0.5 ? G[1] : G[2]) : q < 0.55 ? G[0] : G[1];
      s.set(x, y, c);
      s.hf[i] = e < 0.6 && !grown ? 0.25 : 0.4;
      return;
    }
    let k = base[v.id[i]];
    // the clint's rounded rim: lit toward the top-left, shaded away from it
    if (e < 3.2) k += lit ? 2 : -2;
    if (N[i] > 0.86) k += 1; else if (N[i] < 0.12) k -= 1;
    // solution pits in clusters, a pale weathered skin elsewhere
    if (P[i] > 0.8 && hash2(x, y, seed + 9) < 0.35) k -= 4;
    else if (hash2(x, y, seed + 10) > 0.985) k += 1;
    s.set(x, y, ri(L, k));
    s.hf[i] = 0.55 + smoothstep(1.7, 4.5, e) * 0.3 + (N[i] - 0.5) * 0.08;
  });
  // runnels: short wavy channels running down the clints from their middles
  for (let n = 0; n < 10; n++) {
    let x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    for (let k = 0, len = rng.int(3, 6); k < len; k++) {
      if (v.edge[s.ix(x, y)] < 2.5) break;
      s.set(x, y, L[5]); s.set(x + 1, y, L[12]);
      y += 1; if (rng.chance(0.35)) x += rng.chance(0.5) ? 1 : -1;
    }
  }
  // lichen: gold rosettes and grey crusts on the clints
  for (let n = 0; n < 22; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (v.edge[s.ix(x, y)] < 3) continue;
    const gold = n % 3 !== 0;
    const C = gold ? R.lichen : ['#7e7a6c', '#9c9888', '#b6b2a2'];
    s.set(x, y, C[1]); s.set(x + 1, y, C[2]); s.set(x, y + 1, C[0]);
    if (rng.chance(0.5)) s.set(x - 1, y, C[1]);
  }
  return { normal: 1.9 };
}

/**
 * Limestone cliff (32 × 32): horizontal beds of 4–8 px (the bedding planes dark, a lit lip at each
 * bed's top, every change on a multiple of 4 px so a terrace edge falls on one), vertical joints
 * offset bed to bed, rain streaks and lichen; never brighter than #d8ccb0.
 */
function genLimestoneCliff(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const L = halfRamp(K, R.lime);
  // beds of 4 or 8 px (their tops on multiples of 4 px), each cut into blocks by joints that wander a
  // pixel and stop short in places; the bedding planes undulate a pixel across the width
  const beds = [];
  let y0 = 0;
  while (y0 < h) {
    const hh = Math.min(h - y0, rng.pick([4, 8, 8, 8]));
    const blocks = [];
    let x = rng.int(0, 7);
    const x0 = x;
    while (x < x0 + w) {
      const bw = rng.int(5, 13);
      blocks.push({ x, w: bw, base: rng.pick([8, 9, 10, 10, 11, 12]), stop: rng.chance(0.3) ? rng.int(1, Math.max(1, hh - 2)) : hh });
      x += bw;
    }
    beds.push({ y0, hh, blocks });
    y0 += hh;
  }
  const N = K.field(w, h, 4, 4, seed + 2, { oct: 2 });
  const wob = new Int8Array(w);
  for (let x = 0; x < w; x++) wob[x] = Math.round((wobble(x, w, 4, seed + 5) - 0.5) * 1.6);
  const streak = new Float32Array(w);
  for (let x = 0; x < w; x++) streak[x] = wobble(x, w, 8, seed + 7);
  s.each((x, y, i) => {
    const yy = mod(y - wob[x], h);
    let b = beds[0];
    for (const bd of beds) if (yy >= bd.y0) b = bd;
    const v = yy - b.y0;
    let blk = b.blocks[0];
    for (const bl of b.blocks) if (mod(x - bl.x, w) < bl.w) blk = bl;
    const u = mod(x - blk.x, w);
    let k = blk.base;
    let hh = 0.7;
    if (v === b.hh - 1) { k = 2; hh = 0.1; } // the bedding plane
    else if (v === 0) { k = blk.base + (hash2(x, y, seed + 9) < 0.8 ? 3 : 1); hh = 0.95; } // the lit top, worn in places
    else if (v === b.hh - 2) { k = blk.base - 2; hh = 0.55; }
    else if (u === 0 && v < blk.stop) { k = 3; hh = 0.2; } // a joint
    else if (u === 1 && v < blk.stop) { k = blk.base + 2; hh = 0.8; }
    else if (u === blk.w - 1) { k = blk.base - 1; hh = 0.6; }
    if (v > 0 && v < b.hh - 1) {
      if (N[i] > 0.88) k += 2; else if (N[i] < 0.1) k -= 2;
      if (streak[x] > 0.8 && hash2(x, y, seed + 3) < 0.7) k -= 2; // rain streaks
    }
    s.set(x, y, ri(L, k));
    s.hf[i] = hh + (N[i] - 0.5) * 0.06;
  });
  for (let n = 0; n < 7; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    s.set(x, y, R.lichen[rng.int(1, 2)]); s.set(x + 1, y, R.lichen[0]);
  }
  return { normal: 2.2 };
}

/**
 * The cove's sand: pale warm grains (dithered half tones), soft damp patches a tone darker, shells
 * (white and pink spirals) and small pebbles; no ripples (it turns per tile).
 */
function genCoveSand(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = halfRamp(K, R.sand);
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3, gain: 0.45 });
  const M = K.field(w, h, 2, 2, seed + 2, { oct: 3 });
  const lv = quantize(A, [0.3, 0.8], 9);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e > 0 && hash2(x, y, seed) < 0.5 ? 1 : e < 0 && hash2(x, y, seed) < 0.4 ? -1 : 0);
    if (M[i] < 0.2) k -= 2; // damp sand
    const d = bayer4(x, y);
    if (d < 0.12) k += 1; else if (d > 0.9) k -= 1;
    const q = hash2(x, y, seed + 4);
    if (q < 0.01) k -= 4; else if (q > 0.99) k += 2;
    s.set(x, y, ri(S, k));
    s.hf[i] = 0.35 + lv[i] * 0.02;
  });
  for (let n = 0; n < 9; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    const pink = n % 3 === 0;
    s.set(x, y, pink ? '#ecc8c4' : '#f2ece0'); s.set(x + 1, y, pink ? '#d8a6a4' : '#e2d8c8'); s.set(x + 1, y + 1, S[6]); s.set(x, y + 1, S[8]);
    s.setH(x, y, 0.7);
  }
  for (let p = 0; p < 8; p++) pebble(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(0, 3), R.lime, 4, S[7]);
  return { normal: 1.2 };
}

// ---------------------------------------------------------------------------------------------
// Streets
// ---------------------------------------------------------------------------------------------

/**
 * Slate setts: flat rectangular slates in bonded rows (8 px), each split along its grain, a lit
 * top-left edge, a few blue and plum tints, dark joints.
 */
function genSlateCobble(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = R.slate;
  const rowH = 8;
  const rows = [];
  for (let r = 0; r < h / rowH; r++) {
    const cuts = [];
    let x = rng.int(0, 9);
    while (cuts.length < 12) { cuts.push(x); x += rng.int(7, 12); if (x - cuts[0] >= w) break; }
    rows.push({ cuts: cuts.map((c) => mod(c, w)).sort((a, b) => a - b), base: rng.int(3, 5) });
  }
  const tone = (r, c) => hash2(r, c, seed + 3);
  s.each((x, y, i) => {
    const r = Math.floor(y / rowH);
    const v = y - r * rowH;
    const row = rows[r];
    let c = row.cuts.length - 1;
    for (let k = 0; k < row.cuts.length; k++) if (x >= row.cuts[k]) c = k;
    const left = row.cuts[c];
    const u = mod(x - left, w);
    const isJoint = u === 0 || v === rowH - 1;
    if (isJoint) { s.set(x, y, S[0]); s.hf[i] = 0.05; return; }
    const t = tone(r, c);
    let k = row.base + (t < 0.25 ? -1 : t > 0.8 ? 1 : 0);
    if (u === 1 || v === 0) k += 2;
    else if (v === rowH - 2) k -= 1;
    if (hash2(x >> 2, y, seed + 5) < 0.05) k -= 1; // the grain
    let col = ri(S, k);
    if (t > 0.92) col = K.mixColor(col, '#5a4466', 0.25); // a plum slate
    s.set(x, y, col);
    s.hf[i] = 0.6 + (u === 1 || v === 0 ? 0.2 : 0);
  });
  return { normal: 2.0 };
}

/**
 * Frosted cobbles: rounded cold stones (the library's cobbles re-toned to cold grey) with rime on
 * their lit upper faces and snow packed in the joints.
 */
function genFrostCobble(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const ST = halfRamp(K, R.stone);
  const SN = R.snow;
  const v = voronoi(w, h, 7, 7, seed + 11, { jitter: 0.72 });
  const stones = [];
  for (let k = 0; k < v.count; k++) stones.push({ base: rng.pick([8, 9, 9, 10, 11]), blue: rng.chance(0.3), rime: rng.range(0.25, 0.6) });
  const N = K.field(w, h, 4, 4, seed + 3, { oct: 2 });
  s.each((x, y, i) => {
    const e = v.edge[i];
    // a dome lit from the top-left (-1 … 1 across the stone)
    const r = Math.hypot(v.ox[i], v.oy[i]) || 1;
    const facing = -(v.ox[i] + v.oy[i] * 1.2) / r;
    if (e < 0.75) {
      // the joint: a thin line of packed snow, a stone's shadow on its far side
      s.set(x, y, ri(SN, facing < 0 ? 3 : 4));
      s.hf[i] = 0.3;
      return;
    }
    const st = stones[v.id[i]];
    let k = st.base + (e < 1.8 ? (facing > 0.3 ? 2 : facing < -0.3 ? -3 : 0) : facing > 0.5 ? 1 : 0);
    if (N[i] > 0.9) k += 1; else if (N[i] < 0.08) k -= 1;
    let c = ri(ST, k);
    if (st.blue) c = K.mixColor(c, '#3e4a66', 0.25);
    // rime: crystals over the upper, lit part of each stone (its share by the stone), dense at the rim
    const rime = facing > 0.5 - st.rime ? (e < 2 ? 0.85 : 0.55) : 0;
    if (rime && hash2(x, y, seed + 2) < rime) c = K.mixColor(c, hash2(x, y, seed + 5) < 0.3 ? SN[7] : SN[6], 0.8);
    s.set(x, y, c);
    s.hf[i] = 0.55 + smoothstep(0.75, 3, e) * 0.35;
  });
  return { normal: 2.2 };
}

// ---------------------------------------------------------------------------------------------
// Winter
// ---------------------------------------------------------------------------------------------

/**
 * Snow: soft wind-sculpted drifts (a height field, its lit top-left faces the warm white, the lee
 * slopes violet-blue), a few sastrugi ridges, sparkle points, the odd twig or stone poking through.
 */
function genSnowTop(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const S = halfRamp(K, R.snow);
  const A = K.field(w, h, 3, 3, seed + 1, { oct: 4, gain: 0.5 });
  const B = K.field(w, h, 6, 6, seed + 2, { oct: 2 });
  s.each((x, y, i) => { s.hf[i] = 0.35 + A[i] * 0.4 + B[i] * 0.08; });
  s.each((x, y, i) => {
    const sl = s.slope(x, y);
    let k = 11 + (sl > 0.03 ? 2 : sl > 0.008 ? 1 : sl < -0.03 ? -3 : sl < -0.01 ? -2 : sl < -0.002 ? -1 : 0);
    if (A[i] < 0.08) k -= 1;
    const d = bayer4(x, y);
    if (d > 0.88) k -= 1;
    const q = hash2(x, y, seed + 7);
    if (q < 0.006) k = 14; // a glint (a texel; the lit white, not above it)
    s.set(x, y, ri(S, k));
  });
  // sastrugi: short wind ridges with a lit crest and a blue lee
  for (let n = 0; n < 7; n++) {
    let x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    for (let k = 0, len = rng.int(5, 9); k < len; k++) {
      s.set(x, y, S[13]); s.set(x, y + 1, S[8]);
      s.setH(x, y, s.H(x, y) + 0.08);
      x += 1; if (rng.chance(0.3)) y += rng.chance(0.5) ? 1 : -1;
    }
  }
  // a twig and two stones through the snow
  for (let n = 0; n < 3; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (n === 0) { s.set(x, y, R.soil[2]); s.set(x + 1, y - 1, R.soil[3]); s.set(x + 2, y - 1, R.soil[1]); continue; }
    s.set(x, y, R.rock[4]); s.set(x + 1, y, R.rock[3]); s.set(x, y - 1, S[13]); s.set(x + 1, y + 1, S[6]);
  }
  return { normal: 1.2 };
}

/**
 * A trodden snow path: packed blue-grey snow, footprints in pairs along two lanes, slush ruts with
 * a dark wet line, specks of earth; loose snow brighter at its edges.
 */
function genSnowPath(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const P = halfRamp(K, R.packed);
  const A = K.field(w, h, 4, 4, seed + 1, { oct: 3 });
  const lv = quantize(A, [0.3, 0.75], 8);
  s.each((x, y, i) => {
    const e = emboss(lv, w, h, x, y);
    let k = lv[i] + (e > 0 ? 1 : e < 0 ? -1 : 0);
    if (hash2(x, y, seed) < 0.05) k += 1;
    s.set(x, y, ri(P, k));
    s.hf[i] = 0.4 + lv[i] * 0.03;
  });
  // ruts: two shallow lanes along the path (canvas up = north), wet at the bottom
  for (const lane of [rng.int(10, 20), rng.int(38, 50)]) {
    for (let y = 0; y < h; y++) {
      const x0 = lane + Math.round((wobble(y, h, 2, seed + lane) - 0.5) * 5);
      for (let u = 0; u < 4; u++) {
        const x = x0 + u;
        s.set(x, y, u === 0 ? P[4] : u === 3 ? P[11] : P[6]);
        s.setH(x, y, u === 3 ? 0.42 : 0.28);
      }
      if (hash2(lane, y, seed + 2) < 0.2) s.set(x0 + 1, y, R.soil[2]);
    }
  }
  // footprints (pairs, staggered)
  for (let n = 0; n < 22; n++) {
    const x = rng.int(0, w - 3), y = rng.int(0, h - 4);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]) s.set(x + u, y + v, P[v === 0 ? 5 : 7]);
    s.set(x + 2, y + 1, P[13]);
    s.setH(x, y + 1, 0.3);
  }
  // earth specks
  for (let n = 0; n < 16; n++) s.set(rng.int(0, w - 1), rng.int(0, h - 1), R.soil[rng.int(1, 3)]);
  return { normal: 1.4 };
}

/**
 * A snowy bank (16 × 16 side): dark cold rock in two beds per unit, a cap of snow on each ledge (a
 * lit rim, a soft lower edge), drifted snow in the cracks.
 */
function genSnowSide(s, ctx, K, R) {
  const { w, h } = s;
  const seed = ctx.seedOf('snow_side');
  const Rk = R.rock;
  const S = R.snow;
  const A = K.field(w, h, 2, 4, seed + 1, { oct: 3 });
  const wob = new Float32Array(w);
  for (let x = 0; x < w; x++) wob[x] = (wobble(x, w, 2, seed + 7) - 0.5) * 2.4;
  s.each((x, y, i) => {
    const ly = mod(y + Math.round(wob[x]), 8);
    const cap = 2 + (hash2(x, 3, seed) < 0.4 ? 1 : 0);
    if (ly < cap) {
      // the snow cap on the ledge
      s.set(x, y, ly === 0 ? S[7] : ly === cap - 1 ? S[4] : S[6]);
      s.hf[i] = 0.95 - ly * 0.08;
      return;
    }
    let k = 4 + (A[i] > 0.65 ? 1 : A[i] < 0.3 ? -1 : 0);
    if (ly === cap) k = 1; // the cap's shadow
    else if (ly === 7) k = 2;
    if (hash2(x, y, seed + 4) < 0.06) k += 1;
    s.set(x, y, ri(Rk, k));
    s.hf[i] = 0.55 + (A[i] - 0.5) * 0.2 - (ly === cap ? 0.3 : 0);
  });
  return { normal: 2.0 };
}

/**
 * Thick ice: deep teal-blue, white fracture lines (a dark side, a lit side), trapped bubbles,
 * frost-bloom feathers, snow dust in a few cracks; reads as a surface, not as water.
 */
function genIceTop(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const I = R.ice;
  const A = K.field(w, h, 3, 3, seed + 1, { oct: 4 });
  const B = K.field(w, h, 2, 2, seed + 2, { oct: 2 });
  s.each((x, y, i) => {
    let k = 3 + (A[i] > 0.55 ? 1 : 0) + (A[i] > 0.85 ? 1 : 0) - (B[i] < 0.2 ? 1 : 0);
    if (bayer4(x, y) > 0.92 && A[i] > 0.4) k += 1;
    s.set(x, y, ri(I, k));
    s.hf[i] = 0.5;
  });
  // fractures
  for (let n = 0; n < 9; n++) {
    crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(8, 18), rng, { dark: I[1], light: I[7], depth: 0.12 });
  }
  // bubbles and frost blooms
  for (let n = 0; n < 30; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    if (n % 4 === 0) {
      for (let k = 0; k < 4; k++) { s.set(x + k, y - (k >> 1), I[8]); s.set(x - (k >> 1), y + k, I[7]); }
    } else { s.set(x, y, I[7]); s.set(x + 1, y + 1, I[2]); }
  }
  // snow dust
  for (let n = 0; n < 20; n++) s.set(rng.int(0, w - 1), rng.int(0, h - 1), R.snow[6]);
  return { normal: 0.9 };
}

/**
 * Ice cliff (32 × 32): vertical fracture planes (each a column 4–7 px wide, lit at its left edge,
 * deepening to the right), diagonal light streaks inside the ice, deep teal at the foot of each
 * 8 px course rising to pale cyan, a bright rim at a few edges.
 */
function genIceCliff(s, ctx, K, R) {
  const { w, h } = s;
  const { rng, seed } = ctx;
  const I = halfRamp(K, R.ice);
  // fracture planes: columns 3–8 px wide, each broken into facets at a few heights (a dark crack
  // over a lit lip), each facet its own depth of ice, lit at its left edge, deepening to the right
  const cols = [];
  let x0 = rng.int(0, w - 1);
  let left = w;
  while (left > 0) {
    let cw = Math.min(left, rng.int(3, 8));
    if (left - cw > 0 && left - cw < 3) cw = left;
    const cuts = [];
    for (let y = rng.int(0, 9); y < h; y += rng.int(10, 20)) cuts.push(y);
    cols.push({ x: x0, w: cw, cuts, slant: cuts.map(() => rng.pick([-0.6, -0.3, 0.3, 0.6])), bases: cuts.map(() => rng.pick([5, 6, 7, 8, 8, 9])), rim: rng.chance(0.3) });
    x0 += cw;
    left -= cw;
  }
  const N = K.field(w, h, 4, 8, seed + 3, { oct: 2 });
  for (const c of cols) {
    for (let u = 0; u < c.w; u++) {
      const x = mod(c.x + u, w);
      // the slanted cracks across this column at this u
      const cy = c.cuts.map((y0, q) => mod(y0 + Math.round(u * c.slant[q]), h));
      for (let y = 0; y < h; y++) {
        // the facet this texel lies in (the last crack at or above it, wrapping)
        let f = c.cuts.length - 1;
        let best = Infinity;
        for (let q = 0; q < cy.length; q++) { const d = mod(y - cy[q], h); if (d < best) { best = d; f = q; } }
        const fy = best;
        const i = s.ix(x, y);
        let k = c.bases[f] - Math.round((u / c.w) * 3) + (fy < 3 ? 1 : 0);
        let hh = 0.7 - u * 0.03;
        if (fy === 0) { k = 2; hh = 0.2; } // the crack
        else if (fy === 1 && hash2(x, y, seed + 7) < 0.65) { k = c.bases[f] + 4; hh = 0.9; } // the lip under it, chipped
        else if (u === 0) { k = c.rim ? 15 : c.bases[f] + 3; hh = 0.85; }
        else if (u === c.w - 1) { k = 2; hh = 0.15; }
        // light caught inside the ice: short diagonal glints
        if (u > 0 && u < c.w - 1 && fy > 1 && mod(fy + u, 7) === 0 && hash2(x, c.cuts[f], seed + 6) < 0.6) k += 3;
        if (N[i] > 0.9) k += 1; else if (N[i] < 0.08) k -= 1;
        s.set(x, y, ri(I, k));
        s.hf[i] = hh;
      }
    }
  }
  // snow on a few ledges
  for (let n = 0; n < 5; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h / 8 - 1) * 8;
    for (let k = 0; k < rng.int(2, 4); k++) s.set(x + k, y, R.snow[6]);
  }
  return { normal: 2.2 };
}

// ---------------------------------------------------------------------------------------------
// The season trees' textures (SEASON_TREE_TEXTURE_NAMES)
// ---------------------------------------------------------------------------------------------

/**
 * Blossom canopy (32 × 32, alpha): the library's foliage clumps on a white-cream ramp whose shade
 * runs to lilac pink (≈ 70 % of the canopy white and cream), then tiny five-petal blossoms on the lit
 * rims, deeper pink eyes, and a few young green leaves peeking out of the shade.
 */
function genBlossom(s, ctx, K, R) {
  K.genFoliage(s, ctx, R.blossomCanopy);
  const { w, h } = s;
  const rng = new K.RNG(ctx.seed + 31);
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && s.A(x, y) > 0;
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  // green leaves in the shade (the cool counterweight)
  for (let n = 0; n < 26; n++) {
    const x = rng.int(1, w - 2), y = rng.int(1, h - 2);
    if (!solid(x, y) || lum(s.get(x, y)) > 190) continue;
    s.set(x, y, R.greens[1]); s.set(x + 1, y, R.greens[0]);
    if (solid(x, y - 1)) s.set(x, y - 1, R.greens[2]);
  }
  // blossoms on the lit parts: a white ring around a pink eye
  for (let n = 0; n < 34; n++) {
    const x = rng.int(1, w - 2), y = rng.int(1, h - 2);
    if (!solid(x, y) || lum(s.get(x, y)) < 200) continue;
    s.set(x, y, n % 3 ? '#d98ab4' : '#c27aa4');
    if (solid(x - 1, y)) s.set(x - 1, y, '#fdf0f4');
    if (solid(x, y - 1)) s.set(x, y - 1, '#fff6fa');
  }
  return { normal: 1.6, alpha: true };
}

/**
 * The snow-laden pine (32 × 32 tiers, wraps around cones): the library's pine tiers, darkened a
 * little toward blue, with snow lying on each frond's upper side and spine (lit white at the
 * top-left, blue in its own shade) and a few snow clumps hanging at the tips.
 */
function genSnowPine(s, ctx, K, R) {
  const { w, h } = s; // 32 × 32, tiles horizontally; tiers of 8 px along v (as the library's pine)
  const { rng } = ctx;
  const P = ['#08121a', '#0e1e26', '#15303a', '#1c4440', '#2a5c4a', '#3e7454', '#5e9064', '#86ae7c'].map(K.parseColor);
  const S = R.snow;
  const nT = h / 8;
  const kmap = new Int8Array(w * h).fill(-1);
  const snow = new Int8Array(w * h).fill(-1);
  const hmap = new Float32Array(w * h);
  const at = (x, y) => mod(y, h) * w + mod(x, w);
  // the shadowed body of each tier (its upper rows), as the library's pine
  for (let t = 0; t < nT; t++) for (let v = 0; v < 4; v++) for (let x = 0; x < w; x++) { kmap[at(x, t * 8 + v)] = v < 3 ? 1 : 2; hmap[at(x, t * 8 + v)] = 0.2 + v * 0.05; }
  // the fronds (drooping V sprays), the bottom tier first; on each a pillow of snow along its top,
  // deepest at the spine, lit at the top-left and blue in its own shade
  for (let t = nT - 1; t >= 0; t--) {
    const y0 = t * 8;
    let x0 = rng.int(0, w - 1);
    let left = w;
    while (left > 0) {
      let fw = Math.min(left, rng.int(8, 11));
      if (left - fw > 0 && left - fw < 8) fw = left;
      const depth = rng.int(10, 11);
      const cx = (fw - 1) / 2;
      const capD = rng.int(2, 3);
      for (let u = 0; u < fw; u++) {
        const a = Math.abs(u - cx) / (cx + 0.5);
        const bottom = Math.round(y0 + 5 + (depth - 5) * (1 - a * a * a));
        const cap = y0 + 1 + Math.round(capD * (1 - a * a)) + (hash2(x0 + u, t, ctx.seed + 3) < 0.3 ? 1 : 0);
        for (let y = y0 + 1; y <= bottom; y++) {
          const i = at(x0 + u, y);
          const f = (y - y0) / Math.max(1, bottom - y0);
          const lft = u < cx;
          let k = f < 0.2 ? 2 : 3 + Math.round((f - 0.2) * 2);
          if (lft) k += 1; else if (u > cx + 0.5) k -= 1;
          if (mod(u * (lft ? 1 : -1) + y, 3) === 0 && y < bottom) k -= 1;
          if (y === bottom) k = lft || a < 0.2 ? 6 : 4;
          kmap[i] = clamp(k, 1, 7);
          hmap[i] = 0.35 + f * 0.55;
          snow[i] = -1;
          if (y <= cap) {
            // the snow: lit on the left half and the top row, shaded at the right and the lower edge
            snow[i] = y === y0 + 1 ? (lft ? 7 : 6) : y === cap ? (lft ? 5 : 4) : lft ? 6 : 5;
            hmap[i] = 0.9;
          } else if (y === bottom && hash2(x0 + u, y, ctx.seed + 5) < 0.35) snow[i] = 6; // snow on a tip
        }
      }
      x0 += fw;
      left -= fw;
    }
  }
  s.each((x, y, i) => {
    if (kmap[i] < 0) { s.set(x, y, null); return; }
    s.set(x, y, snow[i] >= 0 ? S[snow[i]] : P[kmap[i]]);
    s.hf[i] = hmap[i];
  });
  return { normal: 1.6, alpha: true };
}

/** Cherry bark (16 × 32): the library's bark re-toned dark plum-brown, with pale horizontal lenticels. */
function genCherryBark(s, ctx, K, R) {
  K.gradientMap(K.genBark, HEX.cherry)(s, ctx);
  const { w, h } = s;
  const rng = new K.RNG(ctx.seed + 5);
  for (let n = 0; n < 10; n++) {
    const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    for (let k = 0; k < rng.int(2, 3); k++) s.set(x + k, y, R.cherry[5]);
    s.set(x, y + 1, R.cherry[1]);
  }
  return { normal: 2.4 };
}

// ---------------------------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------------------------

/** The ramps as colour arrays (once per kit). @param {TextureKit} K */
const ramps = (K) => Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, v.map(K.parseColor)]));

/**
 * The terrain set (`SEASON_TEXTURE_NAMES`).
 * @param {TextureKit} K
 * @returns {Record<string, TexDef>}
 */
export function seasonTextures(K) {
  const R = ramps(K);
  /** @param {(s: any, ctx: any, K: TextureKit, R: Record<string, any[]>) => any} fn */
  const g = (fn) => (s, ctx) => fn(s, ctx, K, R);
  return {
    // spring
    spring_grass: { px: [64, 64], gen: g(genSpringGrass), normalScale: 0.45 },
    blossom_grass: { px: [64, 64], gen: g(genBlossomGrass), normalScale: 0.45 },
    spring_grass_side: { px: [16, 16], gen: g(genSpringGrassSide), normalScale: 0.7 },
    // autumn
    autumn_grass: { px: [64, 64], gen: g(genAutumnGrass), normalScale: 0.45 },
    autumn_grass_side: { px: [16, 16], gen: g(genAutumnGrassSide), normalScale: 0.7 },
    stubble: { px: [64, 64], gen: g(genStubble), normalScale: 0.55 },
    fallen_leaves: { px: [64, 64], gen: g(genFallenLeaves), normalScale: 0.55 },
    // the coast
    limestone: { px: [64, 64], gen: g(genLimestone), normalScale: 0.6 },
    limestone_cliff: { px: [32, 32], gen: g(genLimestoneCliff), normalScale: 0.7 },
    cove_sand: { px: [64, 64], gen: g(genCoveSand), normalScale: 0.45 },
    // streets
    slate_cobble: { px: [64, 64], gen: g(genSlateCobble), normalScale: 0.65 },
    frost_cobble: { px: [64, 64], gen: g(genFrostCobble), normalScale: 0.7 },
    // winter
    snow_top: { px: [64, 64], gen: g(genSnowTop), normalScale: 0.35 },
    snow_path: { px: [64, 64], gen: g(genSnowPath), normalScale: 0.45 },
    snow_side: { px: [16, 16], gen: g(genSnowSide), normalScale: 0.7 },
    ice_top: { px: [64, 64], gen: g(genIceTop), normalScale: 0.35 },
    ice_cliff: { px: [32, 32], gen: g(genIceCliff), normalScale: 0.7 },
  };
}

/**
 * The season trees' set (`SEASON_TREE_TEXTURE_NAMES`): canopies (2 × 2 units, alpha, like
 * `leaves`), the snow-laden pine's tiers (like `pine`: alpha, wrapping), barks (1 × 2 units, like
 * `bark`).
 * @param {TextureKit} K
 * @returns {Record<string, TexDef>}
 */
export function seasonTreeTextures(K) {
  const R = ramps(K);
  /** @param {(s: any, ctx: any, K: TextureKit, R: Record<string, any[]>) => any} fn */
  const g = (fn) => (s, ctx) => fn(s, ctx, K, R);
  return {
    leaves_blossom: { px: [32, 32], gen: g(genBlossom), normalScale: 0.6, alpha: true },
    leaves_maple: { px: [32, 32], gen: (s, c) => K.genFoliage(s, c, HEX.maple), normalScale: 0.6, alpha: true },
    leaves_gold: { px: [32, 32], gen: (s, c) => K.genFoliage(s, c, HEX.gold), normalScale: 0.6, alpha: true },
    pine_snow: { px: [32, 32], gen: g(genSnowPine), normalScale: 0.6, alpha: true, wrap: true },
    bark_cherry: { px: [16, 32], gen: g(genCherryBark), normalScale: 0.7 },
    bark_frost: { px: [16, 32], gen: K.gradientMap(K.genBark, HEX.frost), normalScale: 0.7 },
  };
}
