import * as THREE from 'three';
import { RNG, hash2, clamp, fbm2, bayer4 } from '../../utils/math.js';
import { PixelCanvas, makePixelTexture, normalMapFromHeight, shadeColor, mixColor } from '../../pixel/PixelCanvas.js';
import { PALETTE } from '../../pixel/Palette.js';
import { PPU } from '../../constants.js';

/**
 * A few prop-specific pixel textures that the shared TextureLibrary does not provide
 * (birch bark, market produce, windmill sail lattice, fallen-leaf litter). Painted with
 * PixelCanvas at 16 px / unit from the shared palette, with normal maps from a height field.
 * Materials carry `userData.units` so MeshBuilder's world-space UVs keep the texel density.
 */

const OUTLINE = PALETTE.outline;

function finish(pc, height, { alpha = false, normalStrength = 2, wrap = true } = {}) {
  const w = pc.width;
  const h = pc.height;
  const map = makePixelTexture(pc.toCanvas(), { wrap: 'repeat', mipmaps: true, anisotropy: 4 });
  const nrm = normalMapFromHeight(w, h, (x, y) => height[y * w + x], { strength: normalStrength, wrap });
  const normal = makePixelTexture(nrm.toCanvas(), { wrap: 'repeat', mipmaps: true, srgb: false, anisotropy: 4 });
  return { map, normal, units: [w / PPU, h / PPU], alpha };
}

/** Birch bark: chalky white with dark horizontal lenticels and black knots. 16×32 px (1×2 units). */
function paintBirch(seed) {
  const W = 16;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  pc.wrap = true;
  const hf = new Float32Array(W * H).fill(0.6);
  const ramp = ['#9c9a9a', '#c4c1bb', '#dedad2', '#eeebe3', '#f8f6ef'];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(x, y >> 1, seed) * 0.5 + hash2(x >> 1, y >> 2, seed + 3) * 0.5;
      const idx = clamp(Math.floor(n * 3.2 + 1), 0, 4);
      pc.set(x, y, ramp[idx]);
      hf[y * W + x] = 0.55 + n * 0.1;
    }
  }
  // lenticels: short dark horizontal dashes with a light lip below
  for (let k = 0; k < 16; k++) {
    const y = rng.int(0, H - 1);
    const x0 = rng.int(0, W - 1);
    const len = rng.int(2, 6);
    for (let i = 0; i < len; i++) {
      pc.set(x0 + i, y, i === 0 || i === len - 1 ? '#56555f' : '#2b2a33');
      pc.set(x0 + i, y + 1, '#fbfaf5');
      hf[((y % H + H) % H) * W + ((x0 + i) % W)] = 0.3;
    }
  }
  // a couple of black knot scars (chevrons)
  for (let k = 0; k < 2; k++) {
    const cx = rng.int(0, W - 1);
    const cy = rng.int(0, H - 1);
    const pts = [[0, 0], [1, 0], [-1, 0], [0, 1], [2, 1], [-2, 1], [1, 1], [-1, 1], [0, -1]];
    for (const [dx, dy] of pts) {
      pc.set(cx + dx, cy + dy, dy === -1 ? '#3d3c47' : OUTLINE);
      hf[(((cy + dy) % H + H) % H) * W + (((cx + dx) % W + W) % W)] = 0.2;
    }
  }
  return finish(pc, hf, { normalStrength: 2.2 });
}

/**
 * Produce atlas, 4 cells of 16×16 px (apples, oranges, greens, grapes). Map a crate's top with
 * u = cell/4 + localX/4 (world units ≤ 1) so the fruit keeps 16 px / unit.
 */
function paintProduce(seed) {
  const W = 64;
  const H = 16;
  const pc = new PixelCanvas(W, H, '#1d1311');
  const hf = new Float32Array(W * H).fill(0.1);
  const kinds = [
    { ramp: ['#3a0c14', '#7a1a22', '#b8302e', '#e0584a', '#f7a37e'], r: 2.2, step: 4 }, // apples
    { ramp: ['#4a1d0c', '#9c4414', '#dd7a1f', '#f5a93a', '#ffe08a'], r: 2.2, step: 4 }, // oranges
    { ramp: ['#0f261c', '#1f4a2a', '#3c7a36', '#68a845', '#a8d466'], r: 3.1, step: 6 }, // cabbages
    { ramp: ['#170c24', '#34194a', '#5a2d78', '#8a4aa8', '#c08ad6'], r: 1.3, step: 3 }, // grapes
  ];
  kinds.forEach((k, ci) => {
    const rng = new RNG(seed + ci * 97);
    const ox = ci * 16;
    const pts = [];
    for (let gy = -1; gy * k.step < 16 + k.step; gy++) {
      for (let gx = -1; gx * k.step < 16 + k.step; gx++) {
        pts.push([gx * k.step + (gy & 1 ? k.step / 2 : 0) + rng.range(-0.7, 0.7) + 1.5, gy * k.step + rng.range(-0.7, 0.7) + 1.5]);
      }
    }
    // paint back to front so lower fruit overlaps (screen-down = toward the viewer)
    pts.sort((a, b) => a[1] - b[1]);
    for (const [fx, fy] of pts) {
      const r = k.r * rng.range(0.9, 1.1);
      for (let y = Math.floor(fy - r - 1); y <= Math.ceil(fy + r + 1); y++) {
        for (let x = Math.floor(fx - r - 1); x <= Math.ceil(fx + r + 1); x++) {
          if (x < 0 || y < 0 || x >= 16 || y >= 16) continue;
          const dx = x + 0.5 - fx;
          const dy = y + 0.5 - fy;
          const d = Math.hypot(dx, dy) / (r + 0.35);
          if (d > 1) continue;
          const light = clamp(0.62 - dx * 0.12 - dy * 0.16 - d * 0.35 + (ci === 2 ? (hash2(x, y, seed) - 0.5) * 0.3 : 0), 0, 0.999);
          let c = k.ramp[Math.floor(light * k.ramp.length)];
          if (d > 0.84) c = k.ramp[0];
          pc.set(ox + x, y, c);
          hf[y * W + ox + x] = 0.4 + (1 - d * d) * 0.6;
        }
      }
      // specular glint
      const hx = Math.round(fx - r * 0.45 - 0.5);
      const hy = Math.round(fy - r * 0.45 - 0.5);
      if (ci !== 2 && hx >= 0 && hy >= 0 && hx < 16 && hy < 16) pc.set(ox + hx, hy, k.ramp[4]);
      if (ci === 0 && rng.chance(0.5)) {
        const sx = Math.round(fx - 0.5);
        const sy = Math.round(fy - r + 0.2);
        if (sx >= 0 && sy >= 0 && sx < 16 && sy < 16) pc.set(ox + sx, sy, '#4a2a18');
      }
    }
  });
  return finish(pc, hf, { normalStrength: 2.5, wrap: false });
}

/**
 * Windmill sail: a wooden lattice with canvas cloth, 16×48 px (1×3 units), alpha.
 * The lower (hub) end has bare lattice cells.
 */
function paintSail(seed) {
  const W = 16;
  const H = 48;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H).fill(0);
  const wood = PALETTE.wood;
  const cloth = ['#8f8170', '#b8a88e', '#d6c8aa', '#ebe1c9', '#f6efdd'];
  // cloth panel (rows 0..H-9 in canvas = tip ... near hub)
  for (let y = 0; y < H - 9; y++) {
    for (let x = 1; x < W - 1; x++) {
      const fold = Math.sin((x / (W - 2)) * Math.PI * 2.2 + 0.4) * 0.5 + 0.5;
      const n = hash2(x, y, seed);
      const li = clamp(Math.floor(1 + fold * 2.2 + n * 0.9 - (y > H - 14 ? 0.8 : 0)), 0, 4);
      pc.set(x, y, cloth[li]);
      hf[y * W + x] = 0.35 + fold * 0.15;
    }
  }
  // occasional patch
  const py = rng.int(6, 24);
  const px = rng.int(3, 9);
  pc.rect(px, py, 3, 3, '#c9a77a');
  pc.strokeRect(px, py, 3, 3, '#9a7a55');
  // lattice: outer rails + cross bars every 5 px
  const bar = (x, y, c, hgt = 0.9) => { pc.set(x, y, c); if (x >= 0 && y >= 0 && x < W && y < H) hf[y * W + x] = hgt; };
  for (let y = 0; y < H; y++) {
    bar(0, y, wood[1]);
    bar(W - 1, y, wood[2]);
    if (y >= H - 9) bar(W >> 1, y, wood[3]);
  }
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x++) bar(x, y, x === 0 ? wood[1] : wood[3], 0.85);
    for (let x = 0; x < W; x++) if (y + 1 < H && pc.getAlpha(x, y + 1) > 0) pc.set(x, y + 1, shadeColor(pc.get(x, y + 1), -0.25));
  }
  for (let x = 0; x < W; x++) bar(x, H - 1, wood[2]);
  return finish(pc, hf, { alpha: true, normalStrength: 2, wrap: false });
}

/** Fallen autumn leaves scattered on the ground, 32×32 px (2×2 units), alpha, radial falloff. */
function paintLeafLitter(seed) {
  const W = 32;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H).fill(0);
  const ramp = PALETTE.leavesAutumn;
  for (let k = 0; k < 70; k++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * 14;
    const x = Math.round(16 + Math.cos(a) * r);
    const y = Math.round(16 + Math.sin(a) * r * 0.9);
    const c = ramp[rng.int(1, 4)];
    const hl = ramp[Math.min(5, rng.int(3, 5))];
    pc.set(x, y, c);
    pc.set(x + 1, y, rng.chance(0.5) ? c : hl);
    if (rng.chance(0.6)) pc.set(x, y + 1, shadeColor(c, -0.2));
    if (rng.chance(0.3)) pc.set(x - 1, y, hl);
    hf[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)] = 1;
  }
  return finish(pc, hf, { alpha: true, normalStrength: 1, wrap: false });
}

/** Ash & charcoal bed for campfires, 16×16 (1×1 unit). */
function paintAsh(seed) {
  const W = 16;
  const H = 16;
  const pc = new PixelCanvas(W, H);
  const hf = new Float32Array(W * H);
  const ramp = ['#141116', '#221c20', '#352c2c', '#4a3f3b', '#6b5f58'];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(x, y, seed) * 0.6 + hash2(x >> 1, y >> 1, seed + 1) * 0.4;
      pc.set(x, y, ramp[clamp(Math.floor(n * 5), 0, 4)]);
      hf[y * W + x] = n;
      if (hash2(x, y, seed + 9) > 0.93) pc.set(x, y, mixColor('#ff7a2a', '#5a1208', hash2(y, x, seed)));
    }
  }
  return finish(pc, hf, { normalStrength: 1.5 });
}

/**
 * Boulder stone: cool grey granite with dithered tonal blotches, dark cracks with lit lips and a
 * few lichen specks; `moss` adds soft green moss cushions (for the upward-facing facets).
 * 32×32 px (2×2 units), seamless.
 */
function paintBoulder(seed, moss = false) {
  const W = 32;
  const H = 32;
  const rng = new RNG(seed);
  const pc = new PixelCanvas(W, H);
  pc.wrap = true;
  const hf = new Float32Array(W * H);
  const ramp = ['#3d4053', '#4f5468', '#626a7c', '#767e8d', '#8e97a3']; // mid greys of PALETTE.stone
  const mossR = ['#1c2f25', '#2e4a31', '#4b6b3a', '#6f8d45', '#93ad55'];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm2(x / 8, y / 8, { octaves: 3, seed, period: 4 });
      const d = (bayer4(x, y) - 0.5) * 0.35;
      const t = clamp((n - 0.5) * 1.35 + 0.55 + d * 0.5, 0, 0.999);
      pc.set(x, y, ramp[Math.floor(t * ramp.length)]);
      hf[y * W + x] = 0.45 + n * 0.3;
    }
  }
  // cracks: short random walks, dark with a lit lip below
  for (let k = 0; k < 3; k++) {
    let x = rng.int(0, W - 1);
    let y = rng.int(0, H - 1);
    const len = rng.int(4, 8);
    let dx = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < len; i++) {
      pc.set(x, y, '#2a2b3a');
      pc.set(x, y + 1, '#9aa3ad');
      hf[((y % H) + H) % H * W + ((x % W) + W) % W] = 0.15;
      x += dx;
      if (rng.chance(0.45)) y += rng.chance(0.5) ? 1 : -1;
      if (rng.chance(0.15)) dx = -dx;
    }
  }
  // lichen specks
  for (let k = 0; k < 10; k++) {
    const x = rng.int(0, W - 1);
    const y = rng.int(0, H - 1);
    pc.set(x, y, rng.chance(0.5) ? '#a9a86a' : '#c8b77a');
  }
  if (moss) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const m = fbm2(x / 8 + 11.3, y / 8 + 7.1, { octaves: 3, seed: seed + 5, period: 4 });
        if (m < 0.4) continue;
        const t = clamp((m - 0.4) * 3.6 + (bayer4(x, y) - 0.5) * 0.4, 0, 0.999);
        pc.set(x, y, mossR[Math.min(4, 1 + Math.floor(t * 4))]);
        hf[y * W + x] = 0.7 + t * 0.25;
      }
    }
    // darker rim where the moss meets stone
    const src = pc.clone();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = src.get(x, y);
        const isMoss = c[1] > c[2] + 8;
        if (isMoss) continue;
        if (src.get(x, y - 1)[1] > src.get(x, y - 1)[2] + 8) pc.set(x, y, '#2e3b30');
      }
    }
  }
  return finish(pc, hf, { normalStrength: 2.2 });
}

const PAINTERS = {
  birch: paintBirch, produce: paintProduce, sail: paintSail, leaf_litter: paintLeafLitter, ash: paintAsh,
  boulder: (seed) => paintBoulder(seed, false), boulder_moss: (seed) => paintBoulder(seed, true),
};

/**
 * Add prop textures at run time (additive): `painters` maps a name to its painter (`(seed) =>
 * { map, normal, units, alpha }`, made with `_propTextureKit`'s `finish`). The arid trees' textures
 * (./AridPropTextures.js) are registered by the set-piece kit when it loads
 * (src/engine/world/SetPieceKit.js): until then a PropTextureSet does not know them. A name already
 * there throws, unless it is the same painter (registering again is harmless).
 * @param {Readonly<Record<string, (seed: number) => ReturnType<typeof finish>>>} painters
 */
export function registerPropTextures(painters) {
  const table = /** @type {Record<string, (seed: number) => ReturnType<typeof finish>>} */ (PAINTERS);
  for (const [name, paint] of Object.entries(painters)) {
    if (Object.hasOwn(table, name)) {
      if (table[name] === paint) continue;
      throw new Error(`PropTextureSet: the texture "${name}" is defined twice`);
    }
    table[name] = paint;
  }
}

/**
 * What a prop texture module registered at run time paints with (./AridPropTextures.js): `finish`
 * (the canvas and its height field into the textures) and the outline colour. Internal to the props.
 */
export const _propTextureKit = Object.freeze({ finish, OUTLINE });

/**
 * Names of the prop textures a PropTextureSet paints (keys of `PAINTERS`).
 * @typedef {'birch'|'produce'|'sail'|'leaf_litter'|'ash'|'boulder'|'boulder_moss'|'juniper_bark'|'deadwood'
 *   |'bark_charred'|'juniper'|'juniper_charred'|'cypress'|'cypress_leaves'|'palm_trunk'|'palm_fronds'} PropTextureName
 */

/**
 * Lazily painted, cached prop textures + materials.
 */
export class PropTextureSet {
  constructor(seed = 42) {
    this.seed = seed >>> 0;
    this._tex = new Map();
    this._mats = new Map();
  }

  /** @param {PropTextureName} name */
  textures(name) {
    let t = this._tex.get(name);
    if (!t) {
      const paint = Object.hasOwn(PAINTERS, name) ? PAINTERS[name] : null;
      if (!paint) throw new Error(`PropTextureSet: unknown texture "${name}" (the arid trees' are the set-piece kit's: src/engine/world/SetPieceKit.js)`);
      t = paint(this.seed + (name === 'boulder_moss' ? 'boulder' : name).length * 7919);
      this._tex.set(name, t);
    }
    return t;
  }

  /**
   * Cached MeshLambertMaterial for `name` (vertex colours on; alpha cut-out when the texture has alpha).
   * @param {PropTextureName} name
   * @param {object} [extra] extra material params
   */
  material(name, extra = {}) {
    const key = `${name}|${JSON.stringify(extra)}`;
    let m = this._mats.get(key);
    if (m) return m;
    const t = this.textures(name);
    m = new THREE.MeshLambertMaterial({
      map: t.map,
      normalMap: t.normal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      vertexColors: true,
      ...(t.alpha ? { alphaTest: 0.5, side: THREE.DoubleSide } : {}),
      ...extra,
    });
    m.name = `luminati:prop:${name}`;
    m.userData.units = t.units;
    m.userData.texture = null;
    if (t.alpha) m.userData.alpha = true;
    this._mats.set(key, m);
    return m;
  }

  dispose() {
    for (const t of this._tex.values()) { t.map.dispose(); t.normal.dispose(); }
    for (const m of this._mats.values()) m.dispose();
    this._tex.clear();
    this._mats.clear();
  }
}
