/**
 * PropSprites.js — small billboard sprites & animated FX sprites (2.5D pixel art).
 *
 * Every sprite is painted procedurally into a PixelCanvas with the shared PALETTE ramps (so the
 * plants match the world textures), seeded for determinism. Animated kinds lay their frames out
 * horizontally in one strip.
 *
 * Returned object (contract §4.3):
 *   { texture, canvas, width, height, pixelsPerUnit: 16, anchor: [0.5, 0], frames?, fps? }
 *   `width` / `height` are the size of ONE frame in pixels (world size = px / pixelsPerUnit).
 *   For animated kinds the canvas is `width * frames` wide; extras `frameWidth`, `frameHeight`,
 *   `sheetWidth` and `columns` spell that out, and `rows: 1` + `animations` (`idle` loops every frame
 *   of animated kinds; `{}` for static ones) make the result a valid SpriteSheet for Sprite3D.
 */
import * as THREE from 'three';
import { PixelCanvas, parseColor, mixColor, makePixelTexture } from './PixelCanvas.js';
import { PALETTE } from './Palette.js';
import { PPU } from '../constants.js';
import { RNG, clamp, lerp, smoothstep, hashString, valueNoise2, hash2 } from '../utils/math.js';

const OUT = PALETTE.outline;
const G = PALETTE.grass; // ['#1f3a2c', '#2e5a34', '#4a7d3a', '#77a345', '#a9c95d', '#d6e58a']
const LV = PALETTE.leaves;
const FIRE = PALETTE.fire; // ['#5a1208', '#a8260c', '#e0561a', '#f59a2e', '#ffd36a', '#fff6d0']

/** Every kind createPropSprite() understands. */
export const PROP_SPRITE_KINDS = [
  'grass_tuft', 'grass_tall', 'flower_red', 'flower_yellow', 'flower_white', 'flower_blue',
  'bush', 'fern', 'reeds', 'mushroom', 'rock_small',
  'campfire', 'torch_flame', 'candle_flame',
  'speech_bubble', 'exclamation', 'sparkle',
  'leaf', 'petal', 'ember', 'smoke_puff', 'dust', 'bokeh_soft',
];

/**
 * The arid ground's kinds (docs/contracts/DRAGON_CAMPAIGN.md §6.2; GroundDetail's arid fields):
 * dry grass tufts, tall dry grass, sagebrush scrub, an agave rosette, a thornbush, a prickly pear,
 * sandstone pebbles, black cinders (basalt and ash ground), a bleached horned skull with a bone. Their
 * painters are ./AridSprites.js, in the set-piece kit's chunk (src/engine/world/SetPieceKit.js),
 * which registers them (`registerPropSprites`) when it loads; createPropSprite() then makes them like
 * any other kind (seeded the same way: the plants vary with the seed, pebbles and bones flip or
 * shift). They are kept out of PROP_SPRITE_KINDS, whose sheets are the hashed baseline of the
 * existing art (sandbox/sprite_art.hashes.json).
 */
export const ARID_SPRITE_KINDS = Object.freeze([
  'dry_tuft', 'dry_grass_tall', 'scrub', 'agave', 'thornbush', 'prickly_pear', 'pebbles', 'cinders', 'bones',
]);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function finish(pc, kind, { frames = 0, fps = 0, smooth = false } = {}) {
  const canvas = pc.toCanvas();
  const texture = makePixelTexture(canvas, { wrap: 'clamp', mipmaps: false, srgb: true, name: `prop:${kind}` });
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  if (smooth) {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
  }
  const n = frames || 1;
  const fw = pc.width / n;
  // The result doubles as a one-row SpriteSheet (frameWidth/frameHeight/columns/rows/animations), so
  // it can be handed straight to Sprite3D: animated kinds get a looping `idle` over all frames.
  const animations = {};
  if (frames) {
    animations.idle = { frames: Array.from({ length: n }, (_, col) => ({ col, row: 0 })), fps, loop: true };
  }
  const out = {
    texture, canvas, width: fw, height: pc.height, pixelsPerUnit: PPU, anchor: [0.5, 0],
    frameWidth: fw, frameHeight: pc.height, sheetWidth: pc.width, columns: n, rows: 1, animations, kind,
    /** Free the GPU texture. */
    dispose() { texture.dispose(); },
  };
  if (frames) { out.frames = frames; out.fps = fps; }
  return out;
}

/** Soft-alpha set: colour with an explicit 0..1 alpha (for particles / glows). */
function setA(pc, x, y, color, a) {
  const c = parseColor(color);
  pc.set(x, y, [c[0], c[1], c[2], Math.round(clamp(a) * 255)]);
}

/** Outline only the given sides of opaque pixels (selective outline). */
function outlineSides(pc, color, { top = true, bottom = true, left = true, right = true, diag = false } = {}) {
  const src = pc.clone();
  const offs = [];
  if (left) offs.push([1, 0]);
  if (right) offs.push([-1, 0]);
  if (top) offs.push([0, 1]);
  if (bottom) offs.push([0, -1]);
  if (diag) offs.push([1, 1], [-1, 1]);
  for (let y = 0; y < pc.height; y++) {
    for (let x = 0; x < pc.width; x++) {
      if (src.getAlpha(x, y) > 0) continue;
      // pixel (x,y) is empty; outline it if a solid neighbour sits on the requested side
      for (const [dx, dy] of offs) {
        if (src.getAlpha(x + dx, y + dy) >= 128) { pc.set(x, y, color); break; }
      }
    }
  }
}

/** Grass blade from a base point, bending toward (lean) with a quadratic curve. */
function drawBlade(pc, bx, by, h, lean, ramp, { depth = 0, baseW = 2, tipLight = true } = {}) {
  const n = Math.max(2, Math.round(h));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(bx + lean * t * t);
    const y = by - i;
    let s;
    if (t < 0.22) s = 1;
    else if (t < 0.5) s = 2;
    else if (t < 0.82) s = 3;
    else s = tipLight ? 4 : 3;
    if (lean < -0.5 && t > 0.3) s = Math.min(s + 1, ramp.length - 1); // leaning into the light
    s = clamp(s - depth, 0, ramp.length - 1);
    pc.set(x, y, ramp[s]);
    if (t < 0.3 && baseW > 1) pc.set(x + (lean >= 0 ? 1 : -1), y, ramp[clamp(s - 1, 0, ramp.length - 1)]);
  }
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

function grassTuft(seed) {
  const W = 16, H = 12;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const ramp = G;
  const blades = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) * 2 - 1; // -1 .. 1 across the clump
    const bx = Math.round(7.5 + u * 4 + rng.range(-0.6, 0.6));
    blades.push({
      bx,
      h: (10.5 - Math.abs(u) * 5) * rng.range(0.75, 1.05),
      lean: u * rng.range(2.5, 4.5) + rng.range(-0.8, 0.8),
      depth: (i * 7) % 3 === 0 ? 1 : 0,
    });
  }
  blades.sort((a, b) => b.depth - a.depth || a.h - b.h);
  for (const b of blades) {
    const steps = Math.max(3, Math.round(b.h));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = Math.round(b.bx + b.lean * t * t);
      const y = H - 1 - k;
      let s = t < 0.2 ? 1 : t < 0.45 ? 2 : t < 0.78 ? 3 : 4;
      if (b.lean < -0.8 && t > 0.35) s = Math.min(5, s + 1); // blades bending toward the light
      if (b.lean > 1.5 && t > 0.5) s = Math.max(2, s - 1);
      s = clamp(s - b.depth, 0, 5);
      pc.set(x, y, ramp[s]);
      if (t < 0.45) pc.set(x + (b.lean >= 0 ? 1 : -1), y, ramp[clamp(s - 1, 0, 5)]);
    }
  }
  // dense root mass
  for (let x = 4; x <= 11; x++) { pc.set(x, H - 1, ramp[x < 6 ? 2 : 1]); if (x > 4 && x < 11) pc.set(x, H - 2, ramp[x < 7 ? 2 : 1]); }
  return finish(pc, 'grass_tuft');
}

function grassTall(seed) {
  const pc = new PixelCanvas(16, 24);
  const rng = new RNG(seed);
  const ramp = G;
  const dry = PALETTE.grassDry;
  const blades = [];
  for (let i = 0; i < 15; i++) {
    const u = i / 14 * 2 - 1;
    const bx = Math.round(8 + u * 4.5 + rng.range(-0.6, 0.6));
    blades.push({ bx, h: (21 - Math.abs(u) * 9) * rng.range(0.7, 1.05), lean: u * rng.range(2.5, 5) + rng.range(-1.2, 1.2), depth: i % 3 === 1 ? 1 : 0 });
  }
  blades.sort((a, b) => b.depth - a.depth);
  for (const b of blades) drawBlade(pc, b.bx, 23, b.h, b.lean, ramp, { depth: b.depth });
  // seed heads on a few of the tallest blades
  const tall = [...blades].sort((a, b) => b.h - a.h).slice(0, 3);
  for (const b of tall) {
    const tx = Math.round(b.bx + b.lean);
    const ty = Math.round(23 - b.h);
    pc.set(tx, ty - 1, dry[4]); pc.set(tx, ty - 2, dry[3]); pc.set(tx + (b.lean > 0 ? 1 : -1), ty - 1, dry[3]); pc.set(tx, ty, dry[2]);
  }
  for (let x = 4; x <= 12; x++) { pc.set(x, 23, ramp[1]); if (x > 4 && x < 12) pc.set(x, 22, ramp[x < 8 ? 2 : 1]); }
  return finish(pc, 'grass_tall');
}

/** Leafy base shared by the flower clumps. */
function flowerLeaves(pc, cx, by, rng, spread = 4) {
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const bx = cx + side * rng.int(0, 2);
    drawBlade(pc, bx, by, rng.range(2.5, 5.5), side * rng.range(1.5, spread), G, { depth: i < 2 ? 1 : 0, baseW: 2, tipLight: i > 3 });
  }
}

function stem(pc, x0, y0, x1, y1) {
  const n = Math.max(1, y0 - y1);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(lerp(x0, x1, t * t));
    pc.set(x, y0 - i, i < n * 0.4 ? G[1] : G[2]);
  }
}

/** Stamp a digit-coded template with a colour ramp; 'k' = outline colour. */
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

function flowerRed(seed) {
  // poppies: bright cupped petals, dark hearts, silky highlight
  const pc = new PixelCanvas(13, 15);
  const rng = new RNG(seed);
  const R = PALETTE.red;
  flowerLeaves(pc, 6, 14, rng);
  const heads = [[3, 3], [9, 2], [6, 6]];
  for (const [hx, hy] of heads) stem(pc, 6 + Math.sign(hx - 6), 13, hx, hy + 3);
  for (const [hx, hy] of heads) {
    stamp(pc, [
      '.454.',
      '45543',
      '44k32',
      '.332.',
    ], hx - 2, hy, R);
  }
  outlineSides(pc, mixColor(R[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'flower_red');
}

function flowerYellow(seed) {
  // buttercups: small bright cups on thin stems
  const pc = new PixelCanvas(12, 12);
  const rng = new RNG(seed);
  const Y = PALETTE.yellow;
  flowerLeaves(pc, 6, 11, rng, 3.5);
  const heads = [[3, 4], [6, 2], [9, 4], [5, 6], [8, 7]];
  for (const [hx, hy] of heads) stem(pc, 6, 11, hx, hy + 1);
  for (const [hx, hy] of heads) stamp(pc, ['454', '343', '.2.'], hx - 1, hy - 1, Y);
  outlineSides(pc, mixColor(Y[1], OUT, 0.35), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'flower_yellow');
}

function flowerWhite(seed) {
  // daisies: a ring of white petals around a golden heart
  const pc = new PixelCanvas(14, 14);
  const rng = new RNG(seed);
  const W = PALETTE.white; // ['#8a8f9e', '#b3b8c4', '#d6dae0', '#eef0f2', '#ffffff']
  const Y = PALETTE.yellow;
  flowerLeaves(pc, 7, 13, rng);
  const heads = [[3, 3], [10, 2], [7, 6]];
  for (const [hx, hy] of heads) stem(pc, 7 + Math.sign(hx - 7), 13, hx + 1, hy + 4);
  for (const [hx, hy] of heads) {
    stamp(pc, [
      '.44.',
      '4ab3',
      '3bc2',
      '.22.',
    ], hx - 1, hy, W, { a: Y[5], b: Y[4], c: Y[3] });
  }
  outlineSides(pc, mixColor(W[0], OUT, 0.45), { top: true, left: true, bottom: true, right: true });
  return finish(pc, 'flower_white');
}

function flowerBlue(seed) {
  // bluebells: nodding bell flowers on arching stems + a cornflower star
  const pc = new PixelCanvas(12, 14);
  const rng = new RNG(seed);
  const B = PALETTE.blue;
  flowerLeaves(pc, 6, 13, rng);
  stem(pc, 5, 13, 3, 3);
  stem(pc, 7, 13, 9, 5);
  const bells = [[3, 4], [2, 7], [4, 8], [9, 6], [10, 9]];
  for (const [bx, by] of bells) stamp(pc, ['.43', '342', '2.1'], bx - 1, by, B);
  stamp(pc, ['.4.', '453', '.2.'], 7, 1, B);
  outlineSides(pc, mixColor(B[0], OUT, 0.3), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'flower_blue');
}

function bush(seed) {
  const W = 24, H = 18;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const ramp = LV; // 6 tones dark → light
  const shade = new Int8Array(W * H).fill(-1); // -1 = empty
  // leaf clusters (back → front, bottom → top), each shaded as a sphere lit from the upper left
  const clumps = [
    [6, 11, 5, 4.5], [17, 11, 5.5, 4.5], [11.5, 12, 6.5, 5],
    [8, 7, 4.5, 4], [15, 6.5, 5, 4.2], [11.5, 5, 4.5, 4],
  ];
  for (const [cx, cy, rx, ry] of clumps) {
    const jx = rng.range(-0.4, 0.4), jy = rng.range(-0.3, 0.3);
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x + 0.5 - cx - jx) / rx, dy = (y + 0.5 - cy - jy) / ry;
        const edge = 1 - 0.18 * valueNoise2(x * 0.9, y * 0.9, seed); // leafy scalloped rim
        const d = dx * dx + dy * dy;
        if (d > edge) continue;
        const l = -dx * 0.5 - dy * 0.9 - (y / H) * 0.6 + 0.35;
        let s = l > 0.65 ? 4 : l > 0.2 ? 3 : l > -0.3 ? 2 : 1;
        if (d > edge * 0.72 && l < 0.3) s = Math.max(1, s - 1); // clump rim falls into shadow
        shade[y * W + x] = s;
      }
    }
  }
  // leaf texture: small lit leaf marks on the light side, dark gaps in the mid tones
  const base = shade.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const cur = base[y * W + x];
      if (cur < 0) continue;
      const r = hash2(x, y, seed);
      if (r < 0.11 && cur >= 2) {
        shade[y * W + x] = Math.min(5, cur + 1);
        if (base[(y - 1) * W + x + 1] >= 2) shade[(y - 1) * W + x + 1] = Math.min(5, cur + 1);
      } else if (r > 0.9 && cur >= 2 && cur <= 3) shade[y * W + x] = cur - 1;
    }
  }
  // grounded base: the bottom rows sink into shadow
  for (let x = 0; x < W; x++) for (let y = H - 3; y < H; y++) if (shade[y * W + x] >= 0) shade[y * W + x] = y === H - 1 ? 0 : 1;
  for (let i = 0; i < W * H; i++) if (shade[i] >= 0) pc.set(i % W, (i / W) | 0, ramp[shade[i]]);
  // a few blossoms (seeded colour)
  const bl = rng.chance(0.5) ? PALETTE.white : ['#8c3a5a', '#c85a82', '#ec8fb0', '#f8bdd0', '#fff0f4'];
  for (let i = 0; i < 4; i++) {
    const x = rng.int(5, 18), y = rng.int(3, 11);
    if (pc.getAlpha(x, y) && pc.getAlpha(x + 1, y + 1)) { pc.set(x, y, bl[4]); pc.set(x + 1, y, bl[2]); pc.set(x, y + 1, bl[2]); }
  }
  // selective outline: dark on the shadow sides, soft green on the lit top edge
  outlineSides(pc, mixColor(ramp[0], OUT, 0.5), { top: false, left: false, bottom: true, right: true });
  outlineSides(pc, ramp[1], { top: true, left: true, bottom: false, right: false });
  return finish(pc, 'bush');
}

function fern(seed) {
  const W = 20, H = 16;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const ramp = PALETTE.green; // ['#0f261c', '#1a4028', '#2b6236', '#468a45', '#78b35b']
  const tipHi = PALETTE.grass[4];
  const fronds = [
    { ang: -2.75, len: 8, depth: 1 }, { ang: -0.4, len: 8, depth: 1 }, { ang: -1.9, len: 11, depth: 1 },
    { ang: -2.3, len: 11, depth: 0 }, { ang: -0.85, len: 11, depth: 0 }, { ang: -1.45, len: 12.5, depth: 0 },
  ];
  const bx = 9.5, by = H - 1;
  for (const f of fronds) {
    const dir = Math.cos(f.ang) >= 0 ? 1 : -1;
    let px = bx, py = by, ang = f.ang + rng.range(-0.06, 0.06);
    const steps = Math.round(f.len / 0.75);
    const pts = [];
    for (let i = 0; i < steps; i++) {
      ang += dir * 0.05 * (0.2 + i / steps); // fronds arch outward and droop at the tip
      px += Math.cos(ang) * 0.75;
      py += Math.sin(ang) * 0.75;
      pts.push([px, py, ang, i / steps]);
    }
    // pinnae (leaflets) first, angled toward the frond tip
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [x, y, a, t] = pts[i];
      const ll = t < 0.55 ? 2 : 1;
      for (const side of [-1, 1]) {
        const la = a + side * 1.05;
        const upper = Math.sin(la) < -0.2;
        for (let k = 1; k <= ll; k++) {
          const lx = Math.round(x + Math.cos(la) * k), ly = Math.round(y + Math.sin(la) * k);
          const s = clamp((upper ? 3 : 2) - f.depth + (k === ll && upper ? 1 : 0), 1, 4);
          pc.set(lx, ly, ramp[s]);
        }
      }
    }
    // rachis (midrib) on top
    for (const [x, y, , t] of pts) pc.set(Math.round(x), Math.round(y), ramp[clamp((t < 0.3 ? 2 : 3) - f.depth, 1, 4)]);
    const last = pts[pts.length - 1];
    pc.set(Math.round(last[0]), Math.round(last[1]), f.depth ? ramp[3] : tipHi);
  }
  for (let x = 7; x <= 12; x++) pc.set(x, H - 1, ramp[x < 9 ? 2 : 1]);
  outlineSides(pc, mixColor(ramp[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'fern');
}

function reeds(seed) {
  const W = 14, H = 26;
  const pc = new PixelCanvas(W, H);
  const rng = new RNG(seed);
  const ramp = G;
  const dry = PALETTE.grassDry;
  const B = PALETTE.brown;
  // long leaves
  for (let i = 0; i < 7; i++) {
    const bx = 3 + Math.round(i * 1.3 + rng.range(-0.5, 0.5));
    drawBlade(pc, bx, H - 1, rng.range(9, 17), (bx - 7) * rng.range(0.6, 1.3) + rng.range(-1.5, 1.5), ramp, { depth: i % 2, baseW: 1 });
  }
  // stalks with cattail heads
  const stalks = [[5, 23, -1], [8, 25, 1], [10, 19, 1]];
  for (const [sx, h, lean] of stalks) {
    for (let i = 0; i < h; i++) {
      const t = i / h;
      const x = Math.round(sx + lean * t * t * 1.5);
      pc.set(x, H - 1 - i, t < 0.4 ? dry[1] : dry[2]);
    }
    const tx = Math.round(sx + lean * 1.5), ty = H - 1 - h;
    // cattail: 2x5 brown with a highlight and a spike on top
    for (let k = 0; k < 5; k++) { pc.set(tx, ty + 2 + k, k === 0 ? B[4] : B[3]); pc.set(tx + 1, ty + 2 + k, k === 4 ? B[1] : B[2]); }
    pc.set(tx, ty + 1, dry[3]); pc.set(tx, ty, dry[2]);
  }
  for (let x = 3; x <= 11; x++) pc.set(x, H - 1, ramp[1]);
  outlineSides(pc, mixColor(ramp[0], OUT, 0.4), { top: false, left: false, bottom: true, right: true });
  return finish(pc, 'reeds');
}

function mushroom(seed) {
  const pc = new PixelCanvas(13, 11);
  const R = PALETTE.red;
  const C = PALETTE.cream;
  const W = PALETTE.white;
  // big amanita
  const cap = [
    '..3455..',
    '.345W43.',
    '34W44432',
    '34443W32',
    '.222211.',
  ];
  const draw = (rows, x0, y0, pal) => {
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      pc.set(x0 + c, y0 + r, ch === 'W' ? W[4] : ch === 'w' ? W[2] : pal[Number(ch)]);
    }
  };
  // stems
  for (let y = 5; y <= 10; y++) { pc.set(4, y, C[4]); pc.set(5, y, C[3]); pc.set(6, y, C[2]); }
  pc.set(3, 10, C[3]); pc.set(7, 10, C[1]);
  for (let y = 7; y <= 10; y++) { pc.set(10, y, C[4]); pc.set(11, y, C[2]); }
  draw(cap, 1, 1, R);
  // small one
  draw(['.34.', '3W42', '2211'], 9, 5, R);
  // grass tuft at the foot
  pc.set(2, 10, G[3]); pc.set(8, 10, G[3]); pc.set(8, 9, G[4]); pc.set(12, 10, G[2]);
  pc.outline(mixColor(R[0], OUT, 0.6));
  return finish(pc, 'mushroom');
}

function rockSmall(seed) {
  const pc = new PixelCanvas(14, 9);
  const S = PALETTE.stone; // ['#1e1e2a', '#34364a', '#4f5468', '#727a8a', '#9aa3ad', '#c9cfd0']
  const MS = PALETTE.moss;
  const rows = [
    '....4455......',
    '..344554432...',
    '.3444443333...',
    '3443343332232.',
    '33333322222221',
    '.2222221111111',
    '..11111111....',
  ];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const ch = rows[r][c];
    if (ch === '.') continue;
    pc.set(c, r + 1, S[Number(ch)]);
  }
  // crack + moss on top
  pc.set(6, 4, S[1]); pc.set(7, 5, S[1]);
  pc.set(3, 2, MS[3]); pc.set(4, 2, MS[3]); pc.set(5, 1, MS[3]); pc.set(2, 3, MS[2]); pc.set(3, 3, MS[2]); pc.set(8, 2, MS[2]);
  pc.outline(mixColor(S[0], OUT, 0.5));
  return finish(pc, 'rock_small');
}

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

/**
 * Looping flame "heat" field. t in [0,1) loops seamlessly (all motion is periodic in t).
 * Returns heat in [0, 1+]; x/y in pixel space of a frame.
 */
function flameHeat(x, y, t, { cx, baseY, height, halfW, seed = 0, tongues = 3 }) {
  const up = (baseY - y) / height; // 0 at the base, 1 at the nominal tip
  if (up < -0.15 || up > 1.35) return 0;
  const TAU = Math.PI * 2;
  // lateral sway growing with height, looping in t
  const sway = Math.sin(t * TAU + up * 3.1 + seed) * 0.9 * up + Math.sin(t * TAU * 2 + up * 5.3 + seed * 1.7) * 0.5 * up * up;
  const u = (x + 0.5 - cx - sway) / halfW;
  // envelope: wide at the base, narrowing to a tip
  const width = Math.max(0.05, 1 - Math.pow(Math.max(0, up), 1.25));
  let heat = 1 - Math.abs(u) / width;
  // tongues of flame licking upward
  let tongue = 0;
  for (let k = 0; k < tongues; k++) {
    const ph = t * TAU * (k % 2 ? 1 : 2) + k * 2.1 + seed;
    const tx = Math.sin(ph) * 0.55 + (k - (tongues - 1) / 2) * 0.35;
    const th = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(ph * 1 + k));
    const du = (x + 0.5 - cx - sway) / halfW - tx;
    const tw = 0.28 * (1 - up / th);
    if (up < th && tw > 0) tongue = Math.max(tongue, 1 - Math.abs(du) / tw);
  }
  heat = Math.max(heat, tongue * 0.85);
  // vertical heat falloff + flicker noise scrolling upward (periodic in t)
  const n = valueNoise2(x * 0.55, (y + t * 12) * 0.55, seed, 0) * 0.5 + valueNoise2(x * 1.3, (y + t * 24) * 1.1, seed + 3, 0) * 0.25;
  heat = heat * (1.05 - up * 0.55) + (n - 0.38) * 0.55;
  if (up < 0) heat *= 1 + up * 5; // hard base
  return heat;
}

function flameColor(h) {
  if (h > 0.86) return FIRE[5];
  if (h > 0.68) return FIRE[4];
  if (h > 0.5) return FIRE[3];
  if (h > 0.33) return FIRE[2];
  if (h > 0.2) return FIRE[1];
  return null;
}

function paintFlame(pc, ox, t, params) {
  const { fw, fh } = params;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const h = flameHeat(x, y, t, params);
      const c = flameColor(h);
      if (c) pc.set(ox + x, y, c);
    }
  }
}

function campfire(seed) {
  const FW = 24, FH = 26, N = 8;
  const pc = new PixelCanvas(FW * N, FH);
  const W = PALETTE.wood;
  const S = PALETTE.stone;
  // static logs + stones (drawn per frame so embers can pulse)
  const logs = (ox, f) => {
    // two crossed logs + one across the front
    const log = (x0, y0, x1, y1, thick) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = Math.round(lerp(x0, x1, t)), y = Math.round(lerp(y0, y1, t));
        for (let k = 0; k < thick; k++) pc.set(ox + x, y + k, W[k === 0 ? 4 : k === thick - 1 ? 1 : 2]);
        if (i % 4 === 2) pc.set(ox + x, y + 1, W[1]); // bark notch
      }
      // glowing cut ends
      pc.set(ox + x0, y0, FIRE[3]); pc.set(ox + x0, y0 + 1, FIRE[2]);
    };
    log(4, 18, 17, 22, 3);
    log(19, 18, 6, 22, 3);
    log(7, 21, 17, 21, 3);
    // stones ring
    const stones = [[2, 22], [5, 23], [9, 24], [14, 24], [18, 23], [21, 22]];
    for (const [sx, sy] of stones) {
      pc.set(ox + sx, sy, S[4]); pc.set(ox + sx + 1, sy, S[3]);
      pc.set(ox + sx, sy + 1, S[3]); pc.set(ox + sx + 1, sy + 1, S[2]);
      pc.set(ox + sx - 1, sy + 1, S[2]);
    }
    // embers in the bed, pulsing per frame
    for (let i = 0; i < 7; i++) {
      const ex = 7 + ((i * 5 + seed) % 11), ey = 20 + (i % 3);
      const on = (i + f) % 3 !== 0;
      pc.set(ox + ex, ey, on ? FIRE[4] : FIRE[2]);
    }
  };
  for (let f = 0; f < N; f++) {
    const ox = f * FW;
    logs(ox, f);
    paintFlame(pc, ox, f / N, { fw: FW, fh: FH, cx: FW / 2, baseY: 21, height: 17, halfW: 5.2, seed: seed % 97, tongues: 3 });
    // a detached flicker / spark above the flame on some frames
    const sy = 4 - (f % 4) * 1, sx = 11 + ((f * 3) % 4) - 1;
    if (f % 2 === 0) pc.set(ox + sx, sy, FIRE[4]);
    if (f % 4 === 1) pc.set(ox + sx + 2, sy + 2, FIRE[3]);
  }
  return finish(pc, 'campfire', { frames: N, fps: 10 });
}

function torchFlame(seed) {
  const FW = 10, FH = 16, N = 6;
  const pc = new PixelCanvas(FW * N, FH);
  for (let f = 0; f < N; f++) {
    paintFlame(pc, f * FW, f / N, { fw: FW, fh: FH, cx: FW / 2, baseY: FH - 2, height: 12, halfW: 3.4, seed: 11 + (seed % 13), tongues: 2 });
  }
  return finish(pc, 'torch_flame', { frames: N, fps: 12 });
}

function candleFlame(seed) {
  const FW = 5, FH = 8, N = 4;
  const pc = new PixelCanvas(FW * N, FH);
  const shapes = [
    ['..5..', '.454.', '.454.', '.353.', '..3..', '.....'],
    ['..4..', '..5..', '.454.', '.353.', '..3..', '.....'],
    ['.....', '..5..', '.455.', '.354.', '..3..', '.....'],
    ['..4..', '.45..', '.454.', '.353.', '..3..', '.....'],
  ];
  for (let f = 0; f < N; f++) {
    const rows = shapes[f];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < FW; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      pc.set(f * FW + c, r + 1, FIRE[Number(ch)]);
    }
    // blue-ish base of the flame
    pc.set(f * FW + 2, 6, '#8fb0ff');
  }
  return finish(pc, 'candle_flame', { frames: N, fps: 9 });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function speechBubble() {
  const pc = new PixelCanvas(17, 15);
  const W = PALETTE.white;
  const C = PALETTE.cream;
  // rounded rect 15x10 at (1,1)
  const x0 = 1, y0 = 1, w = 15, h = 10;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
      if (corner) continue;
      const shade = y >= y0 + h - 2 ? C[4] : W[4];
      pc.set(x, y, shade);
    }
  }
  // inner edge shading (lit from the upper left)
  for (let x = x0 + 1; x < x0 + w - 1; x++) pc.set(x, y0 + h - 1, C[3]);
  for (let y = y0 + 1; y < y0 + h - 1; y++) pc.set(x0 + w - 1, y, W[2]);
  // tail
  pc.set(6, 11, W[4]); pc.set(7, 11, C[4]); pc.set(8, 11, C[3]);
  pc.set(6, 12, C[4]); pc.set(7, 12, C[3]);
  pc.set(6, 13, C[3]);
  // ellipsis
  const dot = (x) => { pc.set(x, 5, OUT); pc.set(x + 1, 5, OUT); pc.set(x, 6, OUT); pc.set(x + 1, 6, '#3a3346'); };
  dot(4); dot(8); dot(12);
  pc.outline(OUT);
  return finish(pc, 'speech_bubble');
}

function exclamation() {
  const pc = new PixelCanvas(6, 15);
  const Gd = PALETTE.gold; // ['#3a2410', '#6b4515', '#a5701f', '#d6a33a', '#f2d072', '#fff3c0']
  stamp(pc, [
    '4553',
    '4553',
    '4543',
    '.443',
    '.443',
    '.433',
    '.43.',
    '.32.',
    '....',
    '.44.',
    '4553',
    '.32.',
  ], 1, 1, Gd);
  pc.outline(OUT);
  return finish(pc, 'exclamation');
}

function sparkle() {
  const S = 11, c = 5;
  const pc = new PixelCanvas(S, S);
  const core = '#ffffff', warm = FIRE[5], gold = FIRE[4];
  for (let i = 1; i <= 5; i++) {
    const a = 1 - (i - 1) / 5;
    const col = i <= 1 ? core : i <= 3 ? warm : gold;
    for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) setA(pc, c + dx, c + dy, col, Math.min(1, a * 1.15));
  }
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) setA(pc, c + dx, c + dy, warm, 0.55);
  setA(pc, c, c, core, 1);
  return finish(pc, 'sparkle');
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function leaf() {
  const pc = new PixelCanvas(7, 6);
  const L = LV;
  const rows = [
    '....45.',
    '..3444.',
    '.33343.',
    '32233..',
    '222....',
    '1......',
  ];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 7; c++) {
    const ch = rows[r][c];
    if (ch !== '.') pc.set(c, r, L[Number(ch)]);
  }
  pc.set(3, 3, L[2]); // midrib
  return finish(pc, 'leaf');
}

function petal() {
  const pc = new PixelCanvas(5, 4);
  const P = ['#8c3a5a', '#c85a82', '#ec8fb0', '#f8bdd0', '#fff0f4'];
  const rows = ['.34.', '3443', '2332', '.21.'];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 4; c++) {
    const ch = rows[r][c];
    if (ch !== '.') pc.set(c, r, P[Number(ch)]);
  }
  return finish(pc, 'petal');
}

function ember() {
  const pc = new PixelCanvas(5, 5);
  setA(pc, 2, 2, FIRE[5], 1);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setA(pc, 2 + dx, 2 + dy, FIRE[4], 0.95);
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) setA(pc, 2 + dx, 2 + dy, FIRE[3], 0.55);
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) setA(pc, 2 + dx, 2 + dy, FIRE[2], 0.3);
  return finish(pc, 'ember');
}

function smokePuff(seed) {
  const S = 24;
  const pc = new PixelCanvas(S, S);
  const rng = new RNG(seed);
  const lobes = [[12, 13, 7], [8.5, 11, 5], [15.5, 10.5, 5.5], [12, 8, 5], [9, 15, 4.5], [16, 15, 4.5]];
  for (const l of lobes) { l[0] += rng.range(-0.5, 0.5); l[1] += rng.range(-0.5, 0.5); }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let a = 0, light = 0;
      for (const [cx, cy, r] of lobes) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d < 1) {
          const v = 1 - d * d;
          a = Math.max(a, v);
          light = Math.max(light, v * (1 - ((x - cx) * 0.4 + (y - cy) * 0.7) / r * 0.5));
        }
      }
      if (a <= 0.02) continue;
      const n = valueNoise2(x * 0.35, y * 0.35, seed) * 0.35;
      a = smoothstep(0.0, 0.75, a) * (0.75 + n);
      const tone = clamp(0.45 + light * 0.45 + n * 0.2);
      const c = mixColor('#6f7480', '#e8e6e2', tone);
      setA(pc, x, y, c, a * 0.9);
    }
  }
  return finish(pc, 'smoke_puff', { smooth: true });
}

function dust() {
  const pc = new PixelCanvas(4, 4);
  setA(pc, 1, 1, '#fff8e6', 1); setA(pc, 2, 1, '#fff2d0', 0.8);
  setA(pc, 1, 2, '#fff2d0', 0.8); setA(pc, 2, 2, '#ffe6b0', 0.6);
  setA(pc, 0, 1, '#ffe6b0', 0.25); setA(pc, 3, 2, '#ffe6b0', 0.2); setA(pc, 1, 0, '#ffe6b0', 0.25); setA(pc, 2, 3, '#ffe6b0', 0.2);
  return finish(pc, 'dust');
}

function bokehSoft() {
  const S = 32;
  const pc = new PixelCanvas(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
      if (d >= 1) continue;
      // soft disc: bright plateau, gentle falloff, faint rim
      const a = Math.pow(1 - smoothstep(0.0, 1.0, d), 1.6) * 0.95 + smoothstep(0.55, 0.8, d) * (1 - smoothstep(0.8, 1.0, d)) * 0.08;
      setA(pc, x, y, '#ffffff', a);
    }
  }
  return finish(pc, 'bokeh_soft', { smooth: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const BUILDERS = {
  grass_tuft: grassTuft, grass_tall: grassTall,
  flower_red: flowerRed, flower_yellow: flowerYellow, flower_white: flowerWhite, flower_blue: flowerBlue,
  bush, fern, reeds, mushroom, rock_small: rockSmall,
  campfire, torch_flame: torchFlame, candle_flame: candleFlame,
  speech_bubble: speechBubble, exclamation, sparkle,
  leaf, petal, ember, smoke_puff: smokePuff, dust, bokeh_soft: bokehSoft,
};

/**
 * Add sprite kinds at run time (additive): `builders` maps a kind to its painter (`(seed) => sprite`,
 * made with `_spriteKit`'s `finish`). The arid ground's kinds (`ARID_SPRITE_KINDS`, ./AridSprites.js)
 * are registered by the set-piece kit when it loads (src/engine/world/SetPieceKit.js): until then
 * `createPropSprite` does not know them. A kind already there throws, unless it is the same painter
 * (registering again is harmless).
 * @param {Readonly<Record<string, (seed: number) => ReturnType<typeof finish>>>} builders
 */
export function registerPropSprites(builders) {
  const table = /** @type {Record<string, (seed: number) => ReturnType<typeof finish>>} */ (BUILDERS);
  for (const [kind, build] of Object.entries(builders)) {
    if (Object.hasOwn(table, kind)) {
      if (table[kind] === build) continue;
      throw new Error(`createPropSprite: the kind "${kind}" is defined twice`);
    }
    table[kind] = build;
  }
}

/**
 * The painting helpers a sprite module registered at run time paints with (./AridSprites.js):
 * `finish` (the canvas into the sprite result), `outlineSides`, `drawBlade` and the outline colour.
 * Internal to the engine's pixel modules.
 */
export const _spriteKit = Object.freeze({ finish, outlineSides, drawBlade, OUT });

/**
 * Create a small billboard / FX sprite.
 * `width` / `height` are ONE frame in pixels; animated kinds are a horizontal strip `width * frames`
 * wide. The result is also a valid one-row SpriteSheet (`frameWidth`, `frameHeight`, `columns`,
 * `rows: 1`, `animations` with a looping `idle` for animated kinds), so Sprite3D accepts it directly.
 * @param {string} kind one of PROP_SPRITE_KINDS, or of ARID_SPRITE_KINDS once registered
 *   (`registerPropSprites`: the set-piece kit)
 * @param {{seed?:number|string}} [opts] seed varies the procedural layout of the grasses, flowers,
 *   bush, fern, reeds, campfire, torch_flame and smoke_puff (same seed → same pixels); the other
 *   kinds (mushroom, rock_small, candle_flame, speech_bubble, exclamation, sparkle, leaf, petal,
 *   ember, dust, bokeh_soft) draw the same pixels whatever the seed
 * @returns {{texture: THREE.Texture, canvas: HTMLCanvasElement, width: number, height: number,
 *   pixelsPerUnit: number, anchor: [number, number], frames?: number, fps?: number,
 *   frameWidth: number, frameHeight: number, sheetWidth: number, columns: number, rows: number,
 *   animations: Record<string, {frames: {col:number,row:number}[], fps: number, loop: boolean}>,
 *   kind: string, dispose: () => void}}
 */
export function createPropSprite(kind, opts) {
  const build = Object.hasOwn(BUILDERS, kind) ? BUILDERS[kind] : null;
  if (!build) throw new Error(`createPropSprite: unknown kind "${kind}"`);
  const seed = opts ? opts.seed : undefined;
  const s = seed == null ? hashString(kind) : typeof seed === 'string' ? hashString(seed) : Number(seed) || 0;
  return build(s >>> 0);
}
