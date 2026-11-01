import { PixelCanvas, mixColor } from './PixelCanvas.js';
import { RNG, clamp, hash2, valueNoise2 } from '../utils/math.js';
import { _spriteKit, ARID_SPRITE_KINDS } from './PropSprites.js';

/**
 * AridSprites.js — the arid ground's billboard sprites of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §6.2; `ARID_SPRITE_KINDS` in ./PropSprites.js: dry grass tufts,
 * tall dry grass, sagebrush scrub, an agave rosette, a thornbush, a prickly pear, sandstone pebbles,
 * black cinders, a bleached horned skull with a bone). Part of the set-piece kit's chunk
 * (src/engine/world/SetPieceKit.js), which registers `ARID_SPRITES` with `registerPropSprites` when
 * it loads; `createPropSprite` then makes them like any other kind (seeded the same way). Owner:
 * the arid package.
 */

const { finish, outlineSides, drawBlade, OUT } = _spriteKit;

// ---------------------------------------------------------------------------
// Arid plants and ground clutter (docs/contracts/DRAGON_CAMPAIGN.md §6.2; ARID_SPRITE_KINDS)
// ---------------------------------------------------------------------------

/** Straw: dry grass, from the soil-brown base to the bleached tip (6 tones). */
const STRAW = ['#3a2617', '#5e3f1e', '#86602a', '#ad8338', '#d0a64e', '#ecd07c'];
/** Sage: the grey-green of sagebrush and desert scrub. */
const SAGE = ['#22261a', '#363e26', '#515b38', '#6f7a4a', '#919a62', '#b8bc86'];
/** Agave: blue-green succulent leaves. */
const AGAVE = ['#11262a', '#1b3d3e', '#2b5a55', '#43796b', '#6a9a82', '#a2c0a0'];
/** Cactus pads: a warm green. */
const CACTUS = ['#152b1c', '#214428', '#326134', '#4b8040', '#6fa04e', '#9ec26a'];
/** Bleached bone. */
const BONE = ['#4a4236', '#7a6e5c', '#a89c84', '#cdc3a8', '#e8e0c8', '#fbf7ea'];
/** Sandstone pebbles. */
const PEBBLE = ['#3c271d', '#6a4a30', '#946b45', '#b88b5a', '#d6ad78', '#ecd2a2'];
/** Dry wood (thorny branches, scrub stems). */
const DRYWOOD = ['#1c130f', '#33241a', '#4e3726', '#6c5038', '#8c6c4c'];

function dryTuft(seed) {
  const W = 16, H = 12;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const blades = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) * 2 - 1;
    blades.push({
      bx: Math.round(7.5 + u * 4 + rng.range(-0.6, 0.6)),
      h: (10 - Math.abs(u) * 4.5) * rng.range(0.7, 1.05),
      lean: u * rng.range(2.5, 5) + rng.range(-1, 1),
      depth: (i * 5) % 3 === 0 ? 1 : 0,
      broken: rng.chance(0.18), // a snapped blade bends over halfway
    });
  }
  blades.sort((a, b) => b.depth - a.depth || a.h - b.h);
  for (const b of blades) {
    const steps = Math.max(3, Math.round(b.h));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      let x = Math.round(b.bx + b.lean * t * t);
      let y = H - 1 - k;
      if (b.broken && t > 0.55) { x = Math.round(b.bx + b.lean * 0.3 + (t - 0.55) * 8 * Math.sign(b.lean || 1)); y = H - 1 - Math.round(steps * 0.55) + Math.round((t - 0.55) * 3); }
      let s = t < 0.2 ? 1 : t < 0.45 ? 2 : t < 0.75 ? 3 : t < 0.92 ? 4 : 5;
      if (b.lean < -0.8 && t > 0.35) s = Math.min(5, s + 1);
      if (b.lean > 1.5 && t > 0.5) s = Math.max(2, s - 1);
      s = clamp(s - b.depth, 0, 5);
      pc.set(x, y, STRAW[s]);
      if (t < 0.4) pc.set(x + (b.lean >= 0 ? 1 : -1), y, STRAW[clamp(s - 1, 0, 5)]);
    }
  }
  for (let x = 4; x <= 11; x++) { pc.set(x, H - 1, STRAW[x < 6 ? 2 : 1]); if (x > 4 && x < 11) pc.set(x, H - 2, STRAW[x < 7 ? 2 : 1]); }
  return finish(pc, 'dry_tuft');
}

function dryGrassTall(seed) {
  const W = 16, H = 24;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const blades = [];
  for (let i = 0; i < 14; i++) {
    const u = i / 13 * 2 - 1;
    blades.push({ bx: Math.round(8 + u * 4.5 + rng.range(-0.6, 0.6)), h: (20 - Math.abs(u) * 8) * rng.range(0.7, 1.05), lean: u * rng.range(2.5, 5.5) + rng.range(-1.2, 1.2), depth: i % 3 === 1 ? 1 : 0 });
  }
  blades.sort((a, b) => b.depth - a.depth);
  for (const b of blades) drawBlade(pc, b.bx, H - 1, b.h, b.lean, STRAW, { depth: b.depth });
  // feathery seed heads on the tallest stalks: a pale spike with a shaded side
  const tall = [...blades].sort((a, b) => b.h - a.h).slice(0, 4);
  for (const b of tall) {
    const tx = Math.round(b.bx + b.lean);
    const ty = Math.round(H - 1 - b.h);
    for (let k = 0; k < 4; k++) {
      pc.set(tx, ty - k, k === 3 ? STRAW[5] : STRAW[4]);
      if (k % 2 === 0) pc.set(tx + (b.lean > 0 ? 1 : -1), ty - k, STRAW[3]);
      if (k === 1) pc.set(tx - (b.lean > 0 ? 1 : -1), ty - k, STRAW[5]);
    }
  }
  for (let x = 4; x <= 12; x++) { pc.set(x, H - 1, STRAW[1]); if (x > 4 && x < 12) pc.set(x, H - 2, STRAW[x < 8 ? 2 : 1]); }
  outlineSides(pc, mixColor(STRAW[0], OUT, 0.5), { top: false, left: false, bottom: true, right: false });
  return finish(pc, 'dry_grass_tall');
}

/**
 * Sphere-shaded leaf mass (lit from the upper left) of overlapping clumps into a shade map:
 * `shade[i]` = ramp index, -1 = empty. Scalloped rims from value noise.
 */
function leafMass(W, H, clumps, seed, { rim = 0.2, scale = 0.9 } = {}) {
  const shade = new Int8Array(W * H).fill(-1);
  for (const [cx, cy, rx, ry] of clumps) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const edge = 1 - rim * valueNoise2(x * scale, y * scale, seed);
        const d = dx * dx + dy * dy;
        if (d > edge) continue;
        const l = -dx * 0.5 - dy * 0.9 - (y / H) * 0.6 + 0.35;
        let s = l > 0.65 ? 4 : l > 0.2 ? 3 : l > -0.3 ? 2 : 1;
        if (d > edge * 0.72 && l < 0.3) s = Math.max(1, s - 1);
        shade[y * W + x] = s;
      }
    }
  }
  return shade;
}

function scrub(seed) {
  // sagebrush: a low, rounded mass of small grey-green leaves on woody stems
  const W = 20, H = 14;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const clumps = [[5.5, 8.5, 4.5, 3.6], [14.5, 8.5, 4.8, 3.6], [10, 7, 5.5, 4.4], [7.5, 4.6, 3.6, 3], [13, 4.4, 3.8, 3]];
  for (const c of clumps) { c[0] += rng.range(-0.5, 0.5); c[1] += rng.range(-0.4, 0.4); }
  const shade = leafMass(W, H - 2, clumps, seed, { rim: 0.32, scale: 1.3 });
  // woody stems under and through the mass
  for (const [x0, lean] of [[8, -2], [10, 0], [12, 2], [9, -4]]) {
    for (let k = 0; k < 5; k++) pc.set(Math.round(x0 + (lean * k) / 5), H - 1 - k, DRYWOOD[k < 2 ? 2 : 3]);
  }
  for (let y = 0; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const s = shade[y * W + x];
      if (s < 0) continue;
      const r = hash2(x, y, seed);
      // tiny leaves: speckled light flecks, dark gaps, a few silvery tips
      let k = s + (r < 0.14 ? 1 : r > 0.86 ? -1 : 0);
      if (r > 0.95 && s <= 2) { pc.set(x, y, DRYWOOD[2]); continue; }
      pc.set(x, y, SAGE[clamp(k, 0, 5)]);
    }
  }
  // grounded base
  for (let x = 3; x < W - 3; x++) if (pc.getAlpha(x, H - 3) || pc.getAlpha(x, H - 2)) pc.set(x, H - 2, SAGE[0]);
  outlineSides(pc, mixColor(SAGE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  outlineSides(pc, SAGE[1], { top: true, left: true, bottom: false, right: false });
  return finish(pc, 'scrub');
}

function agave(seed) {
  // a rosette of thick pointed leaves, a pale margin on the lit side and a dark spine at each tip
  const W = 22, H = 16;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const leaves = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i / (n - 1)) - 0.5) * Math.PI * 1.05 + rng.range(-0.08, 0.08);
    const len = (Math.abs(Math.cos(a)) > 0.75 ? 8.5 : 11.5) * rng.range(0.85, 1.05);
    leaves.push({ a, len, depth: i % 2 });
  }
  // back leaves (the ones pointing up) first, the low wide ones in front
  leaves.sort((p, q) => p.depth - q.depth || Math.abs(Math.cos(p.a)) - Math.abs(Math.cos(q.a)));
  const bx = W / 2, by = H - 1.5;
  for (const lf of leaves) {
    const steps = Math.round(lf.len * 1.6);
    const dx = Math.cos(lf.a), dy = Math.sin(lf.a) * 0.92;
    const nx = -dy, ny = dx;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const cx = bx + dx * lf.len * t;
      const cy = by + dy * lf.len * t + t * t * 1.2; // the tip droops a little
      const half = 1.6 * (1 - t) + 0.25;
      for (let o = -half; o <= half; o += 0.5) {
        const x = Math.round(cx + nx * o), y = Math.round(cy + ny * o);
        const lit = o * (nx * -0.6 + ny * -0.8) > 0; // the half facing the upper-left light
        let s = (lit ? 4 : 2) - lf.depth + (t > 0.7 ? 1 : 0);
        if (Math.abs(o) > half - 0.5) s = lit ? 5 : 1; // margins: pale lit edge, dark shade edge
        pc.set(x, y, AGAVE[clamp(s, 0, 5)]);
      }
      if (k === steps) pc.set(Math.round(cx), Math.round(cy) - 1, OUT); // the terminal spine
    }
  }
  // the heart of the rosette
  for (let x = Math.round(bx) - 2; x <= Math.round(bx) + 2; x++) pc.set(x, H - 1, AGAVE[1]);
  outlineSides(pc, mixColor(AGAVE[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'agave');
}

function thornbush(seed) {
  // a dome of dark, tangled thorny twigs, sparse olive leaves, a few red berries
  const W = 22, H = 16;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const grow = (x, y, a, len, depth) => {
    let px = x, py = y;
    for (let k = 0; k < len; k++) {
      px += Math.cos(a) * 0.9;
      py += Math.sin(a) * 0.9;
      a += rng.range(-0.35, 0.35);
      const ix = Math.round(px), iy = Math.round(py);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) break;
      pc.set(ix, iy, DRYWOOD[clamp(1 + depth + (k > len * 0.6 ? 1 : 0), 0, 4)]);
      if (k % 3 === 2 && rng.chance(0.5)) pc.set(ix + (rng.chance(0.5) ? 1 : -1), iy - 1, DRYWOOD[3]); // a thorn
      if (depth < 2 && k > 1 && rng.chance(0.22)) grow(px, py, a + rng.range(-0.9, 0.9), Math.round(len * 0.55), depth + 1);
    }
  };
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i / 8 - 0.5) * Math.PI * 1.1;
    grow(W / 2 + rng.range(-1.5, 1.5), H - 1, a, rng.int(8, 13), 0);
  }
  // sparse leaves: tiny olive pairs near the twig ends
  for (let n = 0; n < 26; n++) {
    const x = rng.int(2, W - 3), y = rng.int(1, H - 5);
    if (!pc.getAlpha(x, y)) continue;
    pc.set(x + 1, y, SAGE[rng.chance(0.5) ? 3 : 2]);
    if (rng.chance(0.5)) pc.set(x, y - 1, SAGE[4]);
  }
  for (let n = 0; n < 4; n++) {
    const x = rng.int(4, W - 5), y = rng.int(2, H - 7);
    if (!pc.getAlpha(x, y)) continue;
    pc.set(x, y, '#c4283c'); pc.set(x + 1, y, '#7a1424'); pc.set(x, y - 1, '#f06a6a');
  }
  outlineSides(pc, mixColor(DRYWOOD[0], OUT, 0.5), { top: false, left: false, bottom: true, right: false });
  return finish(pc, 'thornbush');
}

function pricklyPear(seed) {
  // flat oval pads, one on another, with spine dots and a few magenta fruit on the top edges
  const W = 18, H = 20;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const pads = [
    { x: 9, y: 14.5, rx: 3.4, ry: 4.2, tilt: 0.05 },
    { x: 5.5, y: 8.5, rx: 3, ry: 3.8, tilt: -0.35 },
    { x: 12.5, y: 8, rx: 3.1, ry: 3.9, tilt: 0.3 },
    { x: 8.5, y: 3.8, rx: 2.5, ry: 3.1, tilt: -0.1 },
  ];
  for (const p of pads) { p.x += rng.range(-0.4, 0.4); p.y += rng.range(-0.3, 0.3); }
  for (let pi = 0; pi < pads.length; pi++) {
    const p = pads[pi];
    const c = Math.cos(p.tilt), s = Math.sin(p.tilt);
    for (let y = Math.floor(p.y - p.ry - 1); y <= Math.ceil(p.y + p.ry + 1); y++) {
      for (let x = Math.floor(p.x - p.ry - 1); x <= Math.ceil(p.x + p.ry + 1); x++) {
        const lx = (x + 0.5 - p.x) * c + (y + 0.5 - p.y) * s;
        const ly = -(x + 0.5 - p.x) * s + (y + 0.5 - p.y) * c;
        const d = (lx * lx) / (p.rx * p.rx) + (ly * ly) / (p.ry * p.ry);
        if (d > 1) continue;
        const l = -lx / p.rx * 0.55 - ly / p.ry * 0.75 + 0.3;
        let k = l > 0.6 ? 4 : l > 0.15 ? 3 : l > -0.35 ? 2 : 1;
        if (d > 0.72) k = l > 0.2 ? 5 : 1; // the pad's rim: lit or dark
        pc.set(x, y, CACTUS[k]);
      }
    }
    // spine areoles in a loose grid on the pad
    for (let k = 0; k < 5; k++) {
      const ax = Math.round(p.x + rng.range(-p.rx * 0.6, p.rx * 0.6)), ay = Math.round(p.y + rng.range(-p.ry * 0.6, p.ry * 0.6));
      if (pc.getAlpha(ax, ay)) { pc.set(ax, ay, '#e6e2b4'); if (rng.chance(0.4)) pc.set(ax + 1, ay + 1, CACTUS[1]); }
    }
  }
  // fruit (tunas) on the upper pads' rims
  for (const p of [pads[1], pads[2], pads[3]]) {
    if (!rng.chance(0.75)) continue;
    const fx = Math.round(p.x + rng.range(-1.5, 1.5)), fy = Math.round(p.y - p.ry - 0.5);
    pc.set(fx, fy, '#c4264e'); pc.set(fx + 1, fy, '#8c1638'); pc.set(fx, fy - 1, '#ee6a8a'); pc.set(fx + 1, fy - 1, '#c4264e');
  }
  pc.outline(mixColor(CACTUS[0], OUT, 0.55));
  return finish(pc, 'prickly_pear');
}

function pebbles(seed) {
  // a few sandstone stones, each lit on the upper left, with a shadow toward the lower right
  const pc = new PixelCanvas(16, 8);
  const rng = new RNG(seed);
  const stones = [[3, 5, 2.4, 1.7], [8.5, 5.5, 3.2, 2.1], [13, 6, 1.7, 1.3], [6, 2.8, 1.5, 1.1]];
  for (const [cx, cy, rx, ry] of stones) {
    const jx = rng.range(-0.3, 0.3);
    const base = rng.int(2, 3);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = (x + 0.5 - cx - jx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) {
          // the cast shadow, offset down-right
          const sx = (x - 0.5 - cx - jx) / rx, sy = (y - 0.8 - cy) / ry;
          if (sx * sx + sy * sy <= 1 && !pc.getAlpha(x, y)) pc.set(x, y, mixColor(PEBBLE[0], OUT, 0.3));
          continue;
        }
        const l = -dx * 0.6 - dy * 0.8;
        pc.set(x, y, PEBBLE[clamp(base + (l > 0.45 ? 2 : l > -0.1 ? 1 : 0), 0, 5)]);
      }
    }
  }
  return finish(pc, 'pebbles');
}

function cinders(seed) {
  // black volcanic stones (scoria): angular, pitted, a cool rim light — the pebbles of basalt and ash
  const pc = new PixelCanvas(16, 8);
  const rng = new RNG(seed);
  const C = ['#0c0b10', '#18171f', '#24232e', '#33323f', '#4a4856', '#6a6874'];
  const stones = [[3.5, 5, 2.2, 1.6], [8.5, 5.5, 2.9, 2], [13, 6, 1.6, 1.2], [6.5, 2.6, 1.4, 1.1]];
  for (const [cx, cy, rx, ry] of stones) {
    const jx = rng.range(-0.3, 0.3);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        // a diamond-ish (angular) footprint, not a disc
        const dx = (x + 0.5 - cx - jx) / rx, dy = (y + 0.5 - cy) / ry;
        const d = Math.abs(dx) * 0.8 + Math.abs(dy) * 0.9 + (dx * dx + dy * dy) * 0.3;
        if (d > 1) continue;
        const l = -dx * 0.6 - dy * 0.8;
        let k = l > 0.4 ? 4 : l > -0.15 ? 3 : 2;
        if (hash2(x, y, seed) < 0.18) k -= 1; // pits
        pc.set(x, y, C[clamp(k, 0, 5)]);
      }
    }
  }
  pc.outline(mixColor(C[0], OUT, 0.4));
  return finish(pc, 'cinders');
}

function bones(seed) {
  // a bleached horned skull lying on the ground beside a leg bone
  const pc = new PixelCanvas(22, 11);
  const rng = new RNG(seed);
  const flip = rng.chance(0.5);
  const X = (x) => (flip ? 21 - x : x);
  stampBone(pc, [
    'k3........3k',
    '.43......34.',
    '..45....54..',
    '...455554...',
    '..45554554..',
    '..4k5554k4..',
    '...45553....',
    '....4442....',
    '....3k32....',
    '.....22.....',
  ], X, 0, 0);
  // a leg bone, knobbed at both ends, lying at a slant
  for (let k = 0; k < 8; k++) {
    const x = 12 + k, y = 8 - Math.floor(k / 3);
    pc.set(X(x), y, k === 0 || k === 7 ? BONE[5] : BONE[4]);
    pc.set(X(x), y + 1, k === 0 || k === 7 ? BONE[3] : BONE[2]);
  }
  pc.set(X(11), 8, BONE[4]); pc.set(X(11), 9, BONE[3]); pc.set(X(20), 5, BONE[4]); pc.set(X(20), 6, BONE[3]);
  outlineSides(pc, mixColor(BONE[0], OUT, 0.55), { top: false, left: !flip, bottom: true, right: flip });
  return finish(pc, 'bones');
}

/** Stamp a digit-coded bone template ('k' = a dark socket), x mapped through `X`. */
function stampBone(pc, rows, X, x0, y0) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      pc.set(X(x0 + c), y0 + r, ch === 'k' ? '#2a2018' : BONE[Number(ch)]);
    }
  }
}

/** The arid kinds' painters, by kind (exactly `ARID_SPRITE_KINDS`). */
export const ARID_SPRITES = Object.freeze({
  dry_tuft: dryTuft, dry_grass_tall: dryGrassTall, scrub, agave, thornbush, prickly_pear: pricklyPear, pebbles, cinders, bones,
});
for (const k of Object.keys(ARID_SPRITES)) if (!ARID_SPRITE_KINDS.includes(k)) throw new Error(`AridSprites: "${k}" is not in ARID_SPRITE_KINDS`);
if (Object.keys(ARID_SPRITES).length !== ARID_SPRITE_KINDS.length) throw new Error('AridSprites: ARID_SPRITE_KINDS has kinds without a painter');
