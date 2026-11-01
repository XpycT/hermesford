import { PixelCanvas, mixColor } from './PixelCanvas.js';
import { RNG, clamp, hash2, valueNoise2 } from '../utils/math.js';
import { _spriteKit } from './PropSprites.js';

/**
 * SeasonSprites.js — the season ground's billboard sprites of The Bells of Evermere
 * (docs/contracts/EVERMERE_CAMPAIGN.md §6.2, docs/design/SEASONS_LOOK.md §5): young spring grass,
 * daisies, lilac-pink campion, primroses, bluebells and drifts of fallen petals; russet autumn
 * grass, a red bush, bracken, chicory and leaf piles; marram, thrift, sea campion and shells on the
 * coast; winter tufts and stems under snow, a snowy shrub, a snow-capped stone, twigs; and the crops
 * (wheat, its ripe variant, stubble, a sheaf). Kept out of PROP_SPRITE_KINDS (whose sheets are the
 * hashed baseline, sandbox/sprite_art.hashes.json): `SEASON_SPRITES` is registered with
 * `registerPropSprites` by the season kit's chunk (props/SeasonTrees.js, which the kit loads), and
 * `createPropSprite` then makes them like any other kind (seeded the same way). GroundDetail's
 * season families and crops ask for them by name (src/game/GroundDetail.js `SEASON_FAMILIES`).
 */

const { finish, outlineSides, drawBlade, OUT } = _spriteKit;

// ---------------------------------------------------------------------------
// Ramps (dark → light; six tones unless said)
// ---------------------------------------------------------------------------

const YOUNG = ['#1f3a2c', '#2f5e34', '#3f7a3a', '#6fae48', '#a4d064', '#d6ec90'];
const RUSSET = ['#3a2a26', '#5e4228', '#8a6430', '#b48c3c', '#d6b058', '#eed28c'];
const STRAW = ['#4a3a2e', '#6e5838', '#94784a', '#b89c66', '#d6bf8c', '#ece0b8'];
const MARRAM = ['#22362e', '#365444', '#56765c', '#7e9c78', '#a6bc96', '#ccdab8'];
const WHEAT = ['#4a3418', '#6a4c22', '#a8822e', '#d8b456', '#f2dc96', '#fbefc8'];
const MAPLE = ['#3a1218', '#6e1c1c', '#a8301e', '#d4521e', '#ec8a2a', '#f6c060'];
const GOLD = ['#3e2a12', '#6a4a16', '#a8781e', '#d8a630', '#f0cc52', '#faea94'];
const BRACKEN = ['#2e1a14', '#5a3018', '#8a4c1e', '#b8702a', '#d8983e', '#ecc070'];
const PINK = ['#5a2a50', '#8e4a72', '#c27aa4', '#e8a6c8', '#fbd8e8', '#fff2f6'];
const BELL = ['#1e1e52', '#34348a', '#5050b8', '#7a78dc', '#a8a2ee', '#d2ccfa'];
const CHICORY = ['#1c2a5a', '#2e4290', '#4a64c4', '#6e8ae0', '#9cb2f0', '#cad8fa'];
const PRIM = ['#6a5a1a', '#a8902a', '#dcc44a', '#f0de7a', '#fbf0b0', '#fffbe0'];
const WHITE = ['#6e7488', '#9aa0b0', '#c4c8d2', '#e4e6ea', '#f6f6f4', '#ffffff'];
const SNOW = ['#4b5788', '#61709e', '#7d8fbe', '#9eaed0', '#c0cee4', '#dfe8f4'];
const STONE = ['#16161e', '#262836', '#383a4c', '#4e5266', '#686c80', '#8a8ea0'];
const BARK = ['#1a1214', '#2a1e1e', '#3c2c28', '#524036', '#6a5646'];
const SHELL = ['#7e6a5e', '#b49c8c', '#dcc8b8', '#f2e8dc', '#fff8f0'];

/** A lean-weighted tuft of blades (the library's grass tuft, any ramp): `n` blades over `W` px. */
function bladeTuft(pc, W, H, rng, ramp, { n = 14, height = 10, spread = 4, lean = 4, by = H - 1, base = true } = {}) {
  const blades = [];
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    blades.push({
      bx: Math.round((W - 1) / 2 + u * spread + rng.range(-0.6, 0.6)),
      h: (height - Math.abs(u) * height * 0.45) * rng.range(0.72, 1.05),
      lean: u * rng.range(lean * 0.6, lean) + rng.range(-0.8, 0.8),
      depth: (i * 7) % 3 === 0 ? 1 : 0,
    });
  }
  blades.sort((a, b) => b.depth - a.depth || a.h - b.h);
  for (const b of blades) {
    const steps = Math.max(3, Math.round(b.h));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = Math.round(b.bx + b.lean * t * t);
      const y = by - k;
      let s = t < 0.2 ? 1 : t < 0.45 ? 2 : t < 0.78 ? 3 : 4;
      if (b.lean < -0.8 && t > 0.35) s = Math.min(5, s + 1);
      if (b.lean > 1.5 && t > 0.5) s = Math.max(2, s - 1);
      s = clamp(s - b.depth, 0, 5);
      pc.set(x, y, ramp[s]);
      if (t < 0.45) pc.set(x + (b.lean >= 0 ? 1 : -1), y, ramp[clamp(s - 1, 0, 5)]);
    }
  }
  if (base) {
    const x0 = Math.round(W / 2 - spread), x1 = Math.round(W / 2 + spread - 1);
    for (let x = x0; x <= x1; x++) { pc.set(x, by, ramp[x < x0 + 2 ? 2 : 1]); if (x > x0 && x < x1) pc.set(x, by - 1, ramp[x < x0 + 3 ? 2 : 1]); }
  }
  return blades;
}

/** Stamp a digit-coded template with a ramp; 'k' = the outline colour; other letters from `extra`. */
function stamp(pc, rows, x0, y0, ramp, extra = {}) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      const col = extra[ch] ?? (ch === 'k' ? OUT : ramp[Number(ch)]);
      if (col !== undefined) pc.set(x0 + c, y0 + r, col);
    }
  }
}

/** A wiry stem from the root to a head (a quadratic bend). */
function stem(pc, x0, y0, x1, y1, ramp) {
  const n = Math.max(1, y0 - y1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pc.set(Math.round(x0 + (x1 - x0) * t * t), y0 - i, i < n * 0.4 ? ramp[1] : ramp[2]);
  }
}

/** Leafy base of a flower clump (blades of `ramp`). */
function leaves(pc, cx, by, rng, ramp, spread = 4, n = 7) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    drawBlade(pc, cx + side * rng.int(0, 2), by, rng.range(2.5, 5.5), side * rng.range(1.5, spread), ramp, { depth: i < 2 ? 1 : 0, baseW: 2, tipLight: i > 3 });
  }
}

/**
 * A rounded leaf mass (the library's bush, any ramp): clumps shaded as spheres lit from the
 * upper left, scalloped rims, leaf marks, a grounded base; `dots` paint berries or blossoms.
 */
function leafMass(pc, W, H, seed, ramp, clumps) {
  const shade = new Int8Array(W * H).fill(-1);
  const rng = new RNG(seed);
  for (const [cx, cy, rx, ry] of clumps) {
    const jx = rng.range(-0.4, 0.4), jy = rng.range(-0.3, 0.3);
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x + 0.5 - cx - jx) / rx, dy = (y + 0.5 - cy - jy) / ry;
        const edge = 1 - 0.2 * valueNoise2(x * 0.9, y * 0.9, seed);
        const d = dx * dx + dy * dy;
        if (d > edge) continue;
        const l = -dx * 0.5 - dy * 0.9 - (y / H) * 0.6 + 0.35;
        let s = l > 0.65 ? 4 : l > 0.2 ? 3 : l > -0.3 ? 2 : 1;
        if (d > edge * 0.72 && l < 0.3) s = Math.max(1, s - 1);
        shade[y * W + x] = s;
      }
    }
  }
  const base = shade.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const cur = base[y * W + x];
      if (cur < 0) continue;
      const r = hash2(x, y, seed);
      if (r < 0.12 && cur >= 2) shade[y * W + x] = Math.min(5, cur + 1);
      else if (r > 0.9 && cur >= 2 && cur <= 3) shade[y * W + x] = cur - 1;
    }
  }
  for (let x = 0; x < W; x++) for (let y = H - 3; y < H; y++) if (shade[y * W + x] >= 0) shade[y * W + x] = y === H - 1 ? 0 : 1;
  for (let i = 0; i < W * H; i++) if (shade[i] >= 0) pc.set(i % W, (i / W) | 0, ramp[shade[i]]);
}

/** Snow on the upward faces of whatever is drawn: the topmost opaque texel of each run gets a cap. */
function snowCaps(pc, { chance = 1, seed = 0, thick = 1 } = {}) {
  const src = pc.clone();
  for (let x = 0; x < pc.width; x++) {
    for (let y = 1; y < pc.height; y++) {
      if (!src.getAlpha(x, y) || src.getAlpha(x, y - 1)) continue;
      if (hash2(x, y, seed) > chance) continue;
      pc.set(x, y - 1, SNOW[4]);
      pc.set(x, y, SNOW[5]);
      if (thick > 1 && src.getAlpha(x, y + 1)) pc.set(x, y + 1, SNOW[3]);
    }
  }
}

// ---------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------

function springTuft(seed) {
  const pc = new PixelCanvas(16, 12);
  bladeTuft(pc, 16, 12, new RNG(seed), YOUNG, { n: 15, height: 10.5 });
  return finish(pc, 'spring_tuft');
}

function springTall(seed) {
  // young tall grass with cow parsley: white umbels on a few stems
  const pc = new PixelCanvas(16, 22);
  const rng = new RNG(seed);
  const blades = [];
  for (let i = 0; i < 13; i++) {
    const u = (i / 12) * 2 - 1;
    blades.push({ bx: Math.round(8 + u * 4.5 + rng.range(-0.6, 0.6)), h: (18 - Math.abs(u) * 7) * rng.range(0.7, 1.05), lean: u * rng.range(2.5, 5) + rng.range(-1.2, 1.2), depth: i % 3 === 1 ? 1 : 0 });
  }
  blades.sort((a, b) => b.depth - a.depth);
  for (const b of blades) drawBlade(pc, b.bx, 21, b.h, b.lean, YOUNG, { depth: b.depth });
  for (const [sx, h, lean] of [[5, 19, -1.5], [10, 21, 1], [8, 16, 0]]) {
    for (let i = 0; i < h; i++) pc.set(Math.round(sx + lean * (i / h) ** 2), 21 - i, YOUNG[i < h * 0.5 ? 1 : 2]);
    const tx = Math.round(sx + lean), ty = 21 - h;
    stamp(pc, ['.545.', '54445', '.333.'], tx - 2, ty - 1, WHITE);
  }
  for (let x = 4; x <= 12; x++) pc.set(x, 21, YOUNG[1]);
  return finish(pc, 'spring_tall');
}

function daisy(seed) {
  const pc = new PixelCanvas(14, 14);
  const rng = new RNG(seed);
  leaves(pc, 7, 13, rng, YOUNG);
  const heads = [[3, 4], [10, 2], [7, 7], [11, 8]];
  for (const [hx, hy] of heads) stem(pc, 7 + Math.sign(hx - 7), 13, hx + 1, hy + 3, YOUNG);
  for (const [hx, hy] of heads) stamp(pc, ['.45.', '4ab4', '3bc3', '.33.'], hx - 1, hy - 1, WHITE, { a: '#f6d44a', b: '#e8b032', c: '#c48a22' });
  outlineSides(pc, mixColor(WHITE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'daisy');
}

function pinkFlower(seed) {
  // red campion / ragged robin on the lilac side: five-petal stars, a darker eye
  const pc = new PixelCanvas(13, 15);
  const rng = new RNG(seed);
  leaves(pc, 6, 14, rng, YOUNG);
  const heads = [[3, 3], [9, 2], [6, 6], [10, 8]];
  for (const [hx, hy] of heads) stem(pc, 6 + Math.sign(hx - 6), 13, hx, hy + 2, YOUNG);
  for (const [hx, hy] of heads) stamp(pc, ['.4.', '4a4', '.3.'], hx - 1, hy - 1, PINK, { a: PINK[1] });
  pc.set(3, 1, PINK[5]); pc.set(9, 0, PINK[5]);
  outlineSides(pc, mixColor(PINK[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'pink_flower');
}

function primrose(seed) {
  // a cushion of crinkled leaves with pale yellow flowers
  const pc = new PixelCanvas(13, 10);
  leafMass(pc, 13, 10, seed, YOUNG, [[4, 7, 3.6, 2.6], [9, 7, 3.6, 2.6], [6.5, 6, 3.4, 2.4]]);
  const rng = new RNG(seed + 1);
  for (let i = 0; i < 5; i++) {
    const x = rng.int(2, 10), y = rng.int(2, 6);
    stamp(pc, ['.4.', '4a3', '.2.'], x - 1, y - 1, PRIM, { a: '#e88a2a' });
  }
  outlineSides(pc, mixColor(YOUNG[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'primrose');
}

function bluebell(seed) {
  // nodding violet-blue bells on arching stems
  const pc = new PixelCanvas(12, 15);
  const rng = new RNG(seed);
  leaves(pc, 6, 14, rng, YOUNG, 3.5, 6);
  stem(pc, 5, 14, 3, 2, YOUNG);
  stem(pc, 7, 14, 9, 3, YOUNG);
  for (const [bx, by] of [[3, 3], [2, 6], [4, 8], [9, 4], [10, 7], [8, 9]]) stamp(pc, ['.4', '43', '21'], bx - 1, by, BELL);
  outlineSides(pc, mixColor(BELL[0], OUT, 0.35), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'bluebell');
}

function petalDrift(seed) {
  // a low drift of fallen petals (mostly white and cream, some lilac pink) on the grass
  const W = 16, H = 5;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  for (let i = 0; i < 26; i++) {
    const x = rng.int(1, W - 2), y = rng.int(1, H - 1);
    const pink = rng.chance(0.3);
    pc.set(x, y, pink ? PINK[3] : rng.chance(0.5) ? '#fff6f2' : '#fbe2ea');
    if (rng.chance(0.4)) pc.set(x + 1, y, pink ? PINK[2] : PINK[4]);
  }
  return finish(pc, 'petal_drift');
}

// ---------------------------------------------------------------------------
// Autumn
// ---------------------------------------------------------------------------

function autumnTuft(seed) {
  const pc = new PixelCanvas(16, 12);
  bladeTuft(pc, 16, 12, new RNG(seed), RUSSET, { n: 14, height: 10 });
  return finish(pc, 'autumn_tuft');
}

function autumnTall(seed) {
  // tall russet grass with feathery pale seed heads
  const pc = new PixelCanvas(16, 24);
  const rng = new RNG(seed);
  const blades = [];
  for (let i = 0; i < 14; i++) {
    const u = (i / 13) * 2 - 1;
    blades.push({ bx: Math.round(8 + u * 4.5 + rng.range(-0.6, 0.6)), h: (21 - Math.abs(u) * 9) * rng.range(0.7, 1.05), lean: u * rng.range(2.5, 5) + rng.range(-1.2, 1.2), depth: i % 3 === 1 ? 1 : 0 });
  }
  blades.sort((a, b) => b.depth - a.depth);
  for (const b of blades) drawBlade(pc, b.bx, 23, b.h, b.lean, RUSSET, { depth: b.depth });
  for (const b of [...blades].sort((a, c) => c.h - a.h).slice(0, 4)) {
    const tx = Math.round(b.bx + b.lean), ty = Math.round(23 - b.h);
    pc.set(tx, ty - 1, STRAW[5]); pc.set(tx, ty - 2, STRAW[4]); pc.set(tx - 1, ty - 1, STRAW[4]); pc.set(tx + 1, ty, STRAW[3]); pc.set(tx, ty, STRAW[3]);
  }
  for (let x = 4; x <= 12; x++) pc.set(x, 23, RUSSET[1]);
  return finish(pc, 'autumn_tall');
}

function autumnBush(seed) {
  const pc = new PixelCanvas(24, 18);
  leafMass(pc, 24, 18, seed, MAPLE, [[6, 11, 5, 4.5], [17, 11, 5.5, 4.5], [11.5, 12, 6.5, 5], [8, 7, 4.5, 4], [15, 6.5, 5, 4.2], [11.5, 5, 4.5, 4]]);
  const rng = new RNG(seed + 2);
  // a few gold leaves and dark berries
  for (let i = 0; i < 6; i++) {
    const x = rng.int(4, 19), y = rng.int(3, 12);
    if (!pc.getAlpha(x, y)) continue;
    if (i < 4) pc.set(x, y, GOLD[4]); else { pc.set(x, y, '#2a1020'); pc.set(x + 1, y, '#5a1a30'); }
  }
  outlineSides(pc, mixColor(MAPLE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'autumn_bush');
}

function bracken(seed) {
  // golden-brown fern fronds arching outward
  const W = 20, H = 15;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const fronds = [{ ang: -2.7, len: 8, depth: 1 }, { ang: -0.45, len: 8, depth: 1 }, { ang: -1.9, len: 11, depth: 1 }, { ang: -2.35, len: 10, depth: 0 }, { ang: -0.8, len: 10, depth: 0 }, { ang: -1.45, len: 12, depth: 0 }];
  for (const f of fronds) {
    const dir = Math.cos(f.ang) >= 0 ? 1 : -1;
    let px = 9.5, py = H - 1, ang = f.ang + rng.range(-0.08, 0.08);
    const steps = Math.round(f.len / 0.75);
    const pts = [];
    for (let i = 0; i < steps; i++) {
      ang += dir * 0.06 * (0.2 + i / steps);
      px += Math.cos(ang) * 0.75;
      py += Math.sin(ang) * 0.75;
      pts.push([px, py, ang, i / steps]);
    }
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [x, y, a, t] = pts[i];
      for (const side of [-1, 1]) {
        const la = a + side * 1.05;
        const upper = Math.sin(la) < -0.2;
        for (let k = 1; k <= (t < 0.55 ? 2 : 1); k++) pc.set(Math.round(x + Math.cos(la) * k), Math.round(y + Math.sin(la) * k), BRACKEN[clamp((upper ? 4 : 3) - f.depth, 1, 5)]);
      }
    }
    for (const [x, y, , t] of pts) pc.set(Math.round(x), Math.round(y), BRACKEN[clamp((t < 0.3 ? 2 : 3) - f.depth, 1, 5)]);
  }
  outlineSides(pc, mixColor(BRACKEN[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'bracken');
}

function chicory(seed) {
  // wiry stems, blue star flowers (the autumn's cool counterweight)
  const pc = new PixelCanvas(12, 16);
  const rng = new RNG(seed);
  leaves(pc, 6, 15, rng, RUSSET, 3, 5);
  const heads = [[3, 3], [8, 1], [6, 6], [10, 7]];
  for (const [hx, hy] of heads) stem(pc, 6, 15, hx, hy + 1, ['#2a3a24', '#3e5430', '#56703c']);
  for (const [hx, hy] of heads) stamp(pc, ['.4.', '4a3', '.2.'], hx - 1, hy - 1, CHICORY, { a: CHICORY[1] });
  outlineSides(pc, mixColor(CHICORY[0], OUT, 0.35), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'chicory');
}

/** A heap of fallen leaves (16 × 7): layered leaf marks, lit on top, a grounded shadow. */
function leafPile(seed, ramp, kind) {
  const W = 16, H = 7;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  for (let i = 0; i < 46; i++) {
    const u = rng.range(-1, 1);
    const x = Math.round(7.5 + u * 6.5);
    const top = Math.round(H - 1 - (1 - u * u) * 4.2 * rng.range(0.6, 1));
    const y = rng.int(top, H - 1);
    const k = y === top ? rng.int(4, 5) : y >= H - 2 ? rng.int(1, 2) : rng.int(2, 4);
    pc.set(x, y, ramp[k]);
    if (rng.chance(0.5)) pc.set(x + 1, y, ramp[clamp(k - 1, 0, 5)]);
  }
  for (let x = 2; x <= 13; x++) if (pc.getAlpha(x, H - 1)) pc.set(x, H - 1, ramp[0]);
  return finish(pc, kind);
}

// ---------------------------------------------------------------------------
// The coast
// ---------------------------------------------------------------------------

function duneGrass(seed) {
  // marram: stiff, pale sea-green blades, rolled and spiky
  const pc = new PixelCanvas(16, 14);
  bladeTuft(pc, 16, 14, new RNG(seed), MARRAM, { n: 12, height: 12.5, spread: 3.5, lean: 3 });
  return finish(pc, 'dune_grass');
}

function duneTall(seed) {
  // tall marram with straw seed spikes
  const pc = new PixelCanvas(16, 22);
  const rng = new RNG(seed);
  const blades = bladeTuft(pc, 16, 22, rng, MARRAM, { n: 12, height: 17, spread: 4, lean: 3.5 });
  for (const b of [...blades].sort((a, c) => c.h - a.h).slice(0, 3)) {
    const tx = Math.round(b.bx + b.lean), ty = Math.round(21 - b.h);
    for (let k = 0; k < 4; k++) pc.set(tx, ty - k, STRAW[k < 2 ? 3 : 5]);
    pc.set(tx + 1, ty - 1, STRAW[2]);
  }
  return finish(pc, 'dune_tall');
}

function thrift(seed) {
  // sea pink: a tight cushion of fine leaves, round lilac-pink heads on stalks
  const pc = new PixelCanvas(13, 11);
  const rng = new RNG(seed);
  leafMass(pc, 13, 11, seed, MARRAM, [[6.5, 9, 5.2, 2.2], [4.5, 8.5, 3, 2], [8.5, 8.5, 3, 2]]);
  for (const [hx, hy] of [[3, 2], [6, 1], [9, 2], [5, 4], [10, 5]]) {
    stem(pc, hx, 8, hx + rng.int(-1, 1), hy + 2, MARRAM);
    stamp(pc, ['.43.', '4553', '.32.'], hx - 1, hy - 1, PINK);
  }
  outlineSides(pc, mixColor(PINK[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'thrift');
}

function campion(seed) {
  // sea campion: white flowers over puffed pale calyxes, blue-green leaves
  const pc = new PixelCanvas(13, 12);
  const rng = new RNG(seed);
  leaves(pc, 6, 11, rng, MARRAM, 4, 7);
  for (const [hx, hy] of [[3, 3], [8, 2], [10, 5], [5, 6]]) {
    stem(pc, 6, 11, hx, hy + 2, MARRAM);
    stamp(pc, ['454', '4a4', '.b.'], hx - 1, hy - 1, WHITE, { a: WHITE[3], b: '#c8b4c0' });
  }
  outlineSides(pc, mixColor(WHITE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'campion');
}

function shells(seed) {
  // two shells and a pebble lying on the sand
  const pc = new PixelCanvas(12, 5);
  stamp(pc, ['.343.', '34443', '.212.'], 1, 1, SHELL);
  stamp(pc, ['.43', '342', '.1.'], 7, 2, ['#6e4a50', '#a86e78', '#d49aa2', '#ecc4c8', '#fae6e8']);
  pc.set(10, 4, STONE[3]); pc.set(11, 4, STONE[2]); pc.set(10, 3, STONE[4]);
  return finish(pc, 'shells');
}

// ---------------------------------------------------------------------------
// Winter
// ---------------------------------------------------------------------------

function winterTuft(seed) {
  // pale dry tufts poking through the snow, snow on their tips and a cushion at their foot
  const pc = new PixelCanvas(16, 12);
  bladeTuft(pc, 16, 12, new RNG(seed), STRAW, { n: 11, height: 9, base: false });
  snowCaps(pc, { chance: 0.5, seed });
  for (let x = 3; x <= 12; x++) { pc.set(x, 11, SNOW[x < 6 ? 4 : 3]); if (x > 4 && x < 11) pc.set(x, 10, SNOW[x < 8 ? 5 : 4]); }
  return finish(pc, 'winter_tuft');
}

function winterTall(seed) {
  // tall dry stems with seed heads, a cap of snow on each
  const pc = new PixelCanvas(14, 20);
  const rng = new RNG(seed);
  for (let i = 0; i < 6; i++) {
    const bx = 3 + Math.round(i * 1.6 + rng.range(-0.5, 0.5));
    const h = rng.range(11, 18);
    const lean = (bx - 7) * rng.range(0.3, 0.8);
    for (let k = 0; k <= h; k++) pc.set(Math.round(bx + lean * (k / h) ** 2), 19 - k, STRAW[k < h * 0.4 ? 1 : 2]);
    const tx = Math.round(bx + lean), ty = Math.round(19 - h);
    stamp(pc, ['.5.', '434', '.3.'], tx - 1, ty - 2, SNOW);
  }
  for (let x = 2; x <= 11; x++) { pc.set(x, 19, SNOW[3]); if (x > 3 && x < 10) pc.set(x, 18, SNOW[4]); }
  return finish(pc, 'winter_tall');
}

function snowShrub(seed) {
  // a bare twiggy shrub, snow lying along its twigs
  const W = 20, H = 16;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const twig = (x, y, ang, len, depth) => {
    let px = x, py = y;
    for (let i = 0; i < len; i++) {
      px += Math.cos(ang) * 0.9;
      py += Math.sin(ang) * 0.9;
      pc.set(Math.round(px), Math.round(py), BARK[depth === 0 ? 2 : 3]);
      if (depth < 2 && i > 1 && rng.chance(0.35)) twig(px, py, ang + rng.range(0.35, 0.7) * (rng.chance(0.5) ? 1 : -1), Math.max(2, Math.round(len * 0.5)), depth + 1);
    }
  };
  for (const a of [-2.5, -2.0, -1.6, -1.15, -0.65]) twig(9.5, H - 1, a + rng.range(-0.1, 0.1), rng.int(8, 12), 0);
  snowCaps(pc, { chance: 0.85, seed, thick: 2 });
  for (let x = 5; x <= 14; x++) pc.set(x, H - 1, SNOW[x < 8 ? 4 : 3]);
  return finish(pc, 'snow_shrub');
}

function snowRock(seed) {
  // a dark cold stone with a snow cap
  const pc = new PixelCanvas(14, 9);
  stamp(pc, ['....4455......', '..344554432...', '.3444443333...', '3443343332232.', '33333322222221', '.2222221111111', '..11111111....'], 0, 2, STONE);
  stamp(pc, ['....5555......', '..55555544....', '.554444.......'], 0, 1, SNOW);
  outlineSides(pc, mixColor(STONE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'snow_rock');
}

function twigs(seed) {
  // fallen twigs lying on the snow
  const pc = new PixelCanvas(14, 5);
  const rng = new RNG(seed);
  for (let t = 0; t < 3; t++) {
    let x = rng.int(0, 4), y = rng.int(1, 3);
    for (let k = 0, len = rng.int(6, 10); k < len; k++) {
      pc.set(x, y, BARK[rng.int(2, 4)]);
      if (rng.chance(0.25)) pc.set(x, y - 1, SNOW[5]);
      x += 1; if (rng.chance(0.25)) y += rng.chance(0.5) ? 1 : -1;
      y = clamp(y, 0, 4);
    }
  }
  return finish(pc, 'twigs');
}

// ---------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------

/** A bunch of wheat stalks with bearded heads (12 × 18); `ripe` leaner, paler, the heads bowing. */
function wheatBunch(seed, ripe, kind) {
  const W = 12, H = 18;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const n = 7;
  const stalks = [];
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    stalks.push({ bx: Math.round(5.5 + u * 3 + rng.range(-0.5, 0.5)), h: rng.range(12.5, 16) - Math.abs(u) * 1.5, lean: u * rng.range(1, 2.2) + rng.range(-0.5, 0.5) + (ripe ? 0.8 : 0), depth: i % 3 === 1 ? 1 : 0 });
  }
  stalks.sort((a, b) => b.depth - a.depth);
  for (const s of stalks) {
    const steps = Math.round(s.h);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      pc.set(Math.round(s.bx + s.lean * t * t), H - 1 - k, WHEAT[clamp((t < 0.3 ? 1 : 2) - s.depth, 0, 5)]);
    }
    // the ear: 4 px of grain, lit left, with awns; ripe ears bow over
    const tx = Math.round(s.bx + s.lean), ty = H - 1 - steps;
    const bow = ripe ? (s.lean >= 0 ? 1 : -1) : 0;
    for (let k = 0; k < 4; k++) {
      const ex = tx + (k >= 2 ? bow : 0), ey = ty - k + (ripe ? 1 : 0);
      pc.set(ex, ey, WHEAT[clamp((ripe ? 5 : 4) - s.depth - (k === 0 ? 1 : 0), 0, 5)]);
      pc.set(ex + 1, ey, WHEAT[clamp(3 - s.depth, 0, 5)]);
    }
    pc.set(tx + bow, ty - 4 + (ripe ? 1 : 0), WHEAT[5]);
    if (!ripe) pc.set(tx - 1, ty - 4, WHEAT[3]);
  }
  for (let x = 2; x <= 9; x++) pc.set(x, H - 1, WHEAT[0]);
  return finish(pc, kind);
}

function stubbleTuft(seed) {
  // cut stalks: short straw stubs, lit tips
  const pc = new PixelCanvas(12, 6);
  const rng = new RNG(seed);
  for (let x = 1; x < 11; x += rng.int(1, 2)) {
    const h = rng.int(2, 4);
    for (let k = 0; k < h; k++) pc.set(x, 5 - k, WHEAT[k === h - 1 ? 5 : k === 0 ? 1 : 3]);
  }
  for (let x = 1; x <= 10; x++) if (!pc.getAlpha(x, 5)) pc.set(x, 5, WHEAT[1]);
  return finish(pc, 'stubble_tuft');
}

function sheaf() {
  // a stook: sheaves leaned together in a rounded tent, their stalks in vertical strokes (lit on the
  // left, shaded on the right), the ears bunched at the peak, a twine band (the same pixels
  // whatever the seed)
  const W = 15, H = 15;
  const pc = new PixelCanvas(W, H);
  const cx = 7;
  for (let y = 2; y < H; y++) {
    const half = Math.min(6.5, 1.2 + (y - 2) * 0.62 - (y > 10 ? (y - 10) * 0.12 : 0));
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const u = (x - cx) / Math.max(1, half);
      let k = u < -0.35 ? 4 : u > 0.45 ? 2 : 3;
      if ((x + (y >> 2)) % 3 === 0) k -= 1; // the stalks' strokes
      if (y >= H - 2) k = Math.max(0, k - 2);
      pc.set(x, y, WHEAT[clamp(k, 0, 5)]);
    }
  }
  // the ears at the peak
  stamp(pc, ['.454.', '45554', '.343.'], cx - 2, 0, WHEAT);
  // the twine
  for (let x = cx - 3; x <= cx + 3; x++) pc.set(x, 7, x < cx ? '#7a5430' : '#4a3020');
  outlineSides(pc, mixColor(WHEAT[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'sheaf');
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** The season ground's kinds (registered by the season kit: `registerPropSprites`). */
export const SEASON_SPRITES = Object.freeze({
  spring_tuft: springTuft, spring_tall: springTall, daisy, pink_flower: pinkFlower, primrose, bluebell, petal_drift: petalDrift,
  autumn_tuft: autumnTuft, autumn_tall: autumnTall, autumn_bush: autumnBush, bracken, chicory,
  leaf_pile: (seed) => leafPile(seed, MAPLE, 'leaf_pile'), leaf_pile_gold: (seed) => leafPile(seed, GOLD, 'leaf_pile_gold'),
  dune_grass: duneGrass, dune_tall: duneTall, thrift, campion, shells,
  winter_tuft: winterTuft, winter_tall: winterTall, snow_shrub: snowShrub, snow_rock: snowRock, twigs,
  wheat: (seed) => wheatBunch(seed, false, 'wheat'), wheat_ripe: (seed) => wheatBunch(seed, true, 'wheat_ripe'), stubble_tuft: stubbleTuft, sheaf,
});

/** Every season ground kind (`SEASON_SPRITES`' names). */
export const SEASON_SPRITE_KINDS = Object.freeze(Object.keys(SEASON_SPRITES));

// ---------------------------------------------------------------------------
// What grows where (src/game/GroundDetail.js reads it through the season kit: `SEASON_LAND`)
// ---------------------------------------------------------------------------

/** A growth (GroundDetail's ARID_GROWTH fields) from a row: tufts, tall share, accent chance, odds, clutter 0 / 1 chances. */
const grow = (tufts, tall, shrub, odds, pebbles, bones) => ({ tufts, tall, shrub, odds, pebbles, bones });

/**
 * The season families of the season tops (docs/design/SEASONS_LOOK.md §5) — spring, autumn, the
 * cove's sand, the limestone headland, winter: the sprite kinds of their grass (tuft, tall), accent
 * (`odds` index the frames) and clutter strips — these kinds, with a few of the library's (bush,
 * fern, mushroom, rock_small) —, their grass tints, the reed chance beside water and the growth of a
 * blocked border tile (`T`). GroundDetail grows them like the arid ground (`growTile`), on a stream
 * of their own.
 */
export const SEASON_FAMILIES = Object.freeze({
  spring: { grass: ['spring_tuft', 'spring_tall'], accents: ['daisy', 'pink_flower', 'primrose', 'bluebell', 'bush', 'fern'], clutter: ['petal_drift', 'rock_small'],
    tints: ['#ffffff', '#ffffff', '#f4fadc', '#e6f2c4'], reed: 0.6, thicket: grow(2, 0.5, 0.55, [0.08, 0.06, 0.04, 0.04, 0.45, 0.33], 0.02, 0.02) },
  autumn: { grass: ['autumn_tuft', 'autumn_tall'], accents: ['autumn_bush', 'bracken', 'mushroom', 'chicory'], clutter: ['leaf_pile', 'leaf_pile_gold'],
    tints: ['#ffffff', '#ffffff', '#fff0d8', '#f0e6c8'], reed: 0.6, thicket: grow(2, 0.5, 0.55, [0.45, 0.4, 0.1, 0.05], 0.15, 0.1) },
  coast: { grass: ['dune_grass', 'dune_tall'], accents: ['thrift', 'campion', 'rock_small'], clutter: ['shells', 'rock_small'],
    tints: ['#ffffff', '#ffffff', '#f6f0d4', '#eaf0d0'], reed: 0, thicket: grow(1.6, 0.6, 0.3, [0.4, 0.2, 0.4], 0.04, 0.05) },
  headland: { grass: ['spring_tuft', 'dune_grass'], accents: ['thrift', 'campion', 'bush', 'fern'], clutter: ['shells', 'rock_small'],
    tints: ['#ffffff', '#f2f6dc', '#e8eecc', '#dce8c4'], reed: 0, thicket: grow(1.8, 0.4, 0.5, [0.15, 0.1, 0.5, 0.25], 0.02, 0.05) },
  winter: { grass: ['winter_tuft', 'winter_tall'], accents: ['snow_shrub', 'rock_small'], clutter: ['snow_rock', 'twigs'],
    tints: ['#ffffff', '#ffffff', '#eef2f8', '#e2e8f0'], reed: 0, thicket: grow(0.8, 0.4, 0.35, [0.75, 0.25], 0.06, 0.04) },
});

/** What grows on each season top: its family and its growth. */
export const SEASON_GROWTH = Object.freeze({
  spring_grass: ['spring', grow(3, 0.18, 0.3, [0.3, 0.26, 0.16, 0.12, 0.1, 0.06], 0.008, 0.01)],
  blossom_grass: ['spring', grow(2.6, 0.12, 0.36, [0.24, 0.36, 0.12, 0.12, 0.1, 0.06], 0.25, 0.005)],
  autumn_grass: ['autumn', grow(3, 0.3, 0.1, [0.35, 0.3, 0.15, 0.2], 0.08, 0.05)],
  fallen_leaves: ['autumn', grow(0.8, 0.2, 0.06, [0.35, 0.3, 0.2, 0.15], 0.3, 0.25)],
  stubble: ['autumn', grow(0.3, 0.1, 0.02, [0.3, 0.2, 0.2, 0.3], 0.02, 0.03)],
  limestone: ['headland', grow(0.7, 0.12, 0.1, [0.5, 0.2, 0.15, 0.15], 0.015, 0.04)],
  cove_sand: ['coast', grow(0.45, 0.4, 0.02, [0.5, 0.2, 0.3], 0.06, 0.02)],
  snow_top: ['winter', grow(0.22, 0.3, 0.025, [0.7, 0.3], 0.03, 0.02)],
  snow_path: ['winter', grow(0.05, 0, 0, [1], 0.01, 0.01)],
});

/**
 * The season ground's fields (GroundDetail's `groundDetailSteps`, after its own; its `add` makes
 * each — one Foliage, k-d split on a big level — and `kinds` a strip of sprite kinds): the families'
 * grass, accents (casting shadows), clutter and reeds in the order the families were met, then the
 * crops of `cropAreas`, one field a kind.
 * @param {{ fams: Record<string, { grass: object[], shrubs: object[], clutter: object[], reeds: object[] }>,
 *   cropAreas: { x: number, z: number, w: number, h: number, kind: string }[],
 *   tileMap: { width: number, depth: number, tileAt: (i: number, j: number) => any },
 *   isFree: (x: number, z: number) => boolean, inClearing: (x: number, z: number) => boolean, seed: number,
 *   add: (name: string, sprite: any, list: object[], opts?: object) => Generator<undefined, { castShadow: boolean }[]>,
 *   kinds: (list: string[]) => any, reedSprite: any }} ctx
 * @returns {Generator<undefined, { seasonal?: number, crops?: number }>} the stats (none without either)
 */
export function* seasonFieldSteps({ fams, cropAreas, tileMap, isFree, inClearing, seed, add, kinds, reedSprite }) {
  let seasonal = 0;
  for (const [fam, S] of Object.entries(fams)) {
    const F = SEASON_FAMILIES[fam];
    seasonal += S.grass.length + S.shrubs.length + S.clutter.length + S.reeds.length;
    if (S.grass.length) yield* add(`Foliage:${fam}-grass`, kinds(F.grass), S.grass, { wind: 1.0 });
    if (S.shrubs.length) for (const sh of yield* add(`Foliage:${fam}-accents`, kinds(F.accents), S.shrubs, { wind: 0.7, rootDarken: 0.25 })) sh.castShadow = true;
    if (S.clutter.length) yield* add(`Foliage:${fam}-clutter`, kinds(F.clutter), S.clutter, { wind: 0, rootDarken: 0.1 });
    if (S.reeds.length) yield* add(`Foliage:${fam}-reeds`, reedSprite, S.reeds, { wind: 1.4 });
  }
  let cropped = 0;
  if (cropAreas.length) {
    const crops = cropInstances({ cropAreas, tileMap, isFree, inClearing, seed });
    for (const [kind, list] of Object.entries(crops)) {
      const C = CROP_FIELDS[kind];
      cropped += list.length;
      if (list.length) for (const f of yield* add(`Foliage:crops-${kind}`, kinds(C.kinds), list, { wind: C.wind, rootDarken: C.rootDarken })) f.castShadow = C.castShadow;
    }
  }
  return seasonal + cropped ? { seasonal, crops: cropped } : {};
}

/** @typedef {{ x: number, y: number, z: number, scale: number, frame: number, tint: string }} CropPlant a crop: a Foliage instance */
/** Crop tints: ripe, sun-bleached, a little paler. */
const CROP_TINTS = ['#ffffff', '#fff6e2', '#f4ead2', '#fffaee'];
/** The most crop plants a level grows, all fields together (a hostile list of 32 map-sized fields stops here). */
export const CROP_BUDGET = 24000;
/** The crops' fields: their sprite kinds (frames), wind, root shade and shadows. */
export const CROP_FIELDS = Object.freeze({
  wheat: { kinds: ['wheat', 'wheat_ripe'], wind: 1.3, rootDarken: 0.45, castShadow: true },
  stubble: { kinds: ['stubble_tuft', 'sheaf'], wind: 0.3, rootDarken: 0.3, castShadow: false },
});

/**
 * The crops of `foliage.cropAreas` (world rects): rows across each area every 0.5 u, a plant every
 * 0.3 u (jittered, smaller at the field's edge), on walkable dry ground off the props and the
 * villagers' clearings, on their own stream (`seed + 9157`). Each area is clipped to the map and the
 * plants stop at `CROP_BUDGET`.
 * @param {{ cropAreas: { x: number, z: number, w: number, h: number, kind: string }[],
 *   tileMap: { width: number, depth: number, tileAt: (i: number, j: number) => any },
 *   isFree: (x: number, z: number) => boolean, inClearing: (x: number, z: number) => boolean, seed: number }} ctx
 * @returns {{ wheat: CropPlant[], stubble: CropPlant[] }} Foliage instances by kind
 */
export function cropInstances({ cropAreas, tileMap, isFree, inClearing, seed }) {
  const crops = { wheat: [], stubble: [] };
  const crng = new RNG(seed + 9157);
  let left = CROP_BUDGET;
  for (const a0 of cropAreas) {
    const list = Object.hasOwn(crops, a0.kind) ? crops[a0.kind] : null;
    if (!list) continue;
    // (clipped to the map)
    const x0 = Math.max(0, a0.x), z0 = Math.max(0, a0.z);
    const a = { x: x0, z: z0, w: Math.min(tileMap.width, a0.x + a0.w) - x0, h: Math.min(tileMap.depth, a0.z + a0.h) - z0 };
    if (!(a.w > 0 && a.h > 0)) continue;
    for (let z = a.z + 0.25; z < a.z + a.h && left > 0; z += 0.5) {
      for (let x = a.x + 0.15; x < a.x + a.w && left > 0; x += 0.3) {
        const px = x + crng.range(-0.07, 0.07);
        const pz = z + crng.range(-0.09, 0.09);
        const scale = crng.range(0.86, 1.1) * (Math.min(px - a.x, a.x + a.w - px, pz - a.z, a.z + a.h - pz) < 0.5 ? 0.82 : 1);
        const frame = list === crops.wheat ? crng.int(0, 1) : crng.chance(0.012) ? 1 : 0;
        const t = tileMap.tileAt(Math.floor(px), Math.floor(pz));
        if (t && !t.water && !t.stairs && t.type.walkable !== false && isFree(px, pz) && !inClearing(px, pz)) {
          list.push({ x: px, y: t.h, z: pz, scale, frame, tint: CROP_TINTS[(px * 7 + pz * 3 | 0) & 3] });
          left--;
        }
      }
    }
  }
  return crops;
}
