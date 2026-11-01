/**
 * CharacterSprites.js — procedural 2.5D pixel-art character & creature sprite sheets.
 *
 * Characters are painted as layered pixel art (body → legs → clothing → arms → head/face → hair →
 * hat → cape → gear) into a "material + shade" label buffer, then resolved to per-character
 * 5-tone colour ramps and wrapped in a dark plum silhouette outline. Every direction has its own
 * template set; `right` mirrors `left` but keeps asymmetric gear (sheathed sword, satchel, staff
 * hand) on the correct side of the body.
 *
 * Sheet layout (contract §4.3): frames 32×32, rows = DIRECTIONS (down, left, right, up),
 * columns = [idle0, idle1, walk0, walk1, walk2, walk3].
 */
import * as THREE from 'three';
import { PixelCanvas, parseColor, shadeColor, mixColor, makePixelTexture, rgbToHsl, hslToRgb } from './PixelCanvas.js';
import { PALETTE } from './Palette.js';
import { DIRECTIONS, PPU } from '../constants.js';
import { RNG, hashString } from '../utils/math.js';
import { ownValue } from '../utils/own.js';

/** @import { SpriteSheet } from '../sprite/Sprite3D.js' */

// ---------------------------------------------------------------------------
// Colour ramps
// ---------------------------------------------------------------------------

const OUTLINE = parseColor(PALETTE.outline);
const FALLBACK_HEX = '#8a7a6a';
const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Normalise a single colour value that is not a PALETTE ramp name into something parseColor()
 * understands: hex strings ('#rgb', 'rrggbb' …), 0xRRGGBB numbers, THREE.Color, CSS colour names,
 * single-colour PALETTE entries ('outline', 'glowWarm') or [r, g, b(, a)] arrays. Unknown → fallback.
 */
function normColor(spec, fallback = FALLBACK_HEX) {
  if (spec == null || spec === false) return fallback;
  if (typeof spec === 'number' && Number.isFinite(spec)) return `#${((spec >>> 0) & 0xffffff).toString(16).padStart(6, '0')}`;
  if (spec && spec.isColor) return `#${spec.getHexString()}`;
  if (Array.isArray(spec) && spec.length >= 3 && typeof spec[0] === 'number') return spec;
  if (typeof spec === 'string') {
    const pal = ownValue(PALETTE, spec);
    if (typeof pal === 'string') return pal;
    if (Array.isArray(pal)) return pal[Math.floor(pal.length / 2)];
    if (HEX_RE.test(spec.trim())) return spec.trim();
    const named = ownValue(THREE.Color.NAMES, spec.trim().toLowerCase());
    if (named !== undefined) return `#${named.toString(16).padStart(6, '0')}`;
  }
  return fallback;
}

/**
 * Build a 5-tone material ramp [deep, shadow, base, light, shine] from a PALETTE ramp name,
 * a hex colour (string or 0xRRGGBB number), a CSS colour name, a THREE.Color or an explicit
 * array of colours (dark → light).
 * @param {string|number|THREE.Color|Array} spec
 * @param {{base?:number}} [opts] index of the base tone inside a palette ramp (negative = from end)
 * @returns {number[][]} five RGBA arrays
 */
export function materialRamp(spec, { base } = {}) {
  let ramp = null;
  if (Array.isArray(spec) && spec.length && typeof spec[0] !== 'number') ramp = spec;
  else if (typeof spec === 'string' && Array.isArray(PALETTE[spec])) ramp = PALETTE[spec];
  if (!ramp) {
    const hex = normColor(spec);
    return [-0.62, -0.3, 0, 0.24, 0.46].map((a) => (a === 0 ? [...parseColor(hex)] : shadeColor(hex, a)));
  }
  const n = ramp.length;
  let b = base ?? (n >= 6 ? 3 : 2);
  if (b < 0) b = n + b;
  const out = [];
  for (let k = -2; k <= 2; k++) {
    const i = b + k;
    if (i < 0) out.push(shadeColor(ramp[0], -0.22 * -i));
    else if (i >= n) out.push(shadeColor(ramp[n - 1], 0.16 * (i - n + 1)));
    else out.push([...parseColor(ramp[i])]);
  }
  return out;
}

/** Alpha of glow texels (COMBAT.md §10.1): passes the 0.5 alpha test, marks emissive pixels for combatFx sprites. */
const GLOW_ALPHA = 204;

/** A ramp colour turned into a glow texel (same rgb, alpha 204). */
function glowTexel(col) {
  return [col[0], col[1], col[2], GLOW_ALPHA];
}

/** Normalise a colour spec (palette ramp name / hex / array) into a 5-tone ramp for a material kind. */
function rampForKind(spec, kind) {
  const isName = typeof spec === 'string' && Array.isArray(PALETTE[spec]);
  if (isName) {
    const n = PALETTE[spec].length;
    if (kind === 'skin') return materialRamp(spec, { base: n - 2 });
    if (kind === 'hair' && spec === 'hairBlack') return materialRamp(spec, { base: 3 });
    if (kind === 'hair' && spec === 'hairWhite') return materialRamp(spec, { base: 3 });
    if (spec === 'white') return materialRamp(spec, { base: 3 });
    if (spec === 'cream') return materialRamp(spec, { base: 3 });
    if (spec === 'black') return materialRamp(spec, { base: 3 });
  }
  return materialRamp(spec);
}

// ---------------------------------------------------------------------------
// Materials & label painter
// ---------------------------------------------------------------------------

/** Material ids used in the label buffer. */
const M = {
  SKIN: 1, HAIR: 2, TOP: 3, BOTTOM: 4, ACCENT: 5, CAPE: 6, CAPEIN: 7, HAT: 8, BOOT: 9,
  METAL: 10, WOOD: 11, GOLD: 12, LEATHER: 13, EYE: 14, WHITE: 15, SHIRT: 16, SCARF: 17,
  BLUSH: 18, LINE: 19, BEARD: 20, PACK: 21, GEM: 22, STRING: 23, FEATHER: 24, BOOK: 25,
  HATBAND: 26, BELT: 27, SASH: 28,
  // creature materials
  FUR: 29, FUR2: 30, FUR3: 31, BEAK: 32, COMB: 33, NOSE: 34,
  // combat materials (COMBAT.md §10.3): gel (slime; potion liquid on characters), bone, glow
  // (alpha 204 → emissive with Sprite3D combatFx), stone, wing membrane
  GEL: 35, BONE: 36, GLOW: 37, STONE: 38, WING: 39,
  // the party classes' weapons (DRAGON_CAMPAIGN.md §5.4): the holy staff's gilded shaft and its sun
  // (glow), the ice staff's crystal (glow), the tower shield's field (`gear.shield`)
  GILT: 40, HOLY: 41, ICE: 42, SHIELD: 43,
  // the drawn sword's blade and the tower shield's crest: the metal's and the gold's ramps, painted
  // as glow texels only with `gear.bladeGlow` / `gear.crestGlow` (the heroes' looks light them)
  BLADE: 44, CREST: 45,
  // The Bells of Evermere (EVERMERE_CAMPAIGN.md §6.5): the bell-founder's hammer's bronze collar
  // (glow texels with `gear.hammerGlow`) and a hood's fur rim (`hoodTrim`) — drawn only for them
  HCOLLAR: 46, TRIM: 47,
  // … and the Hushguard's greathelm's eye slit (`hat: 'greathelm'`: the eyes' colour, glow texels)
  SLIT: 48,
};
const MAT_COUNT = 49;

/**
 * The Bells of Evermere's sprite parts (EVERMERE_CAMPAIGN.md §5.3, §6.5): the bell-founder's hammer,
 * the frost crown, the Hushguard's greathelm, a hood's fur rim (`hoodTrim`), the tower shield's
 * other crests (`gear.crest`) — CharacterKit.js, a chunk of its own, installed here at run time by
 * `loadCharacterKit` (the game before it builds a level whose villagers, player or party use them;
 * the editor at start), so the chunk every level downloads holds only their names and seams. A spec
 * using them while the kit is not loaded throws (`usesCharacterKit`); every other spec draws as it
 * always did.
 * @type {CharacterKitParts|null}
 */
let KIT = null;
/** @type {Promise<CharacterKitParts>|null} */
let kitJob = null;
/** @typedef {ReturnType<typeof import('./CharacterKit.js').createCharacterKit>} CharacterKitParts */

/**
 * Does a spec use a part of The Bells of Evermere's sprite kit — the hat `crown` or `greathelm`, the
 * weapon `hammer`, a hood's `hoodTrim`, a shield's `gear.crest`? Specs are untrusted data: any shape.
 * @param {unknown} spec
 * @returns {boolean}
 */
export function usesCharacterKit(spec) {
  if (!spec || typeof spec !== 'object') return false;
  const s = /** @type {Record<string, any>} */ (spec);
  const gear = s.gear && typeof s.gear === 'object' ? s.gear : null;
  return s.hat === 'crown' || s.hat === 'greathelm' || s.weapon === 'hammer' || !!s.hoodTrim || (!!gear && (gear.crest === 'anchor' || gear.crest === 'plain'));
}

/**
 * Do a level's villagers (`npc` objects' `spec`) use the sprite kit? Level data is untrusted.
 * @param {{ objects?: unknown }|null|undefined} level
 * @returns {boolean}
 */
export function levelUsesCharacterKit(level) {
  const objects = level && Array.isArray(level.objects) ? level.objects : [];
  return objects.some((o) => !!o && o.type === 'npc' && usesCharacterKit(o.spec));
}

/**
 * Load the sprite kit (once; later calls share the import) and install it.
 * @returns {Promise<CharacterKitParts>}
 */
export function loadCharacterKit() {
  if (KIT) return Promise.resolve(KIT);
  kitJob ??= import('./CharacterKit.js').then((m) => {
    const kit = m.createCharacterKit(_painterKit);
    Object.assign(HATS, kit.HATS);
    KIT = kit;
    return kit;
  }, (err) => {
    kitJob = null;
    throw err;
  });
  return kitJob;
}

/**
 * Pixel painter over a (material, shade) label buffer. Parts are drawn in z-order between
 * begin()/end(); a part may cast a darker "inner line" onto whatever it was drawn over, which is
 * how selective inner outlines (hair over forehead, arm over torso …) are produced.
 */
class Painter {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.mat = new Uint8Array(w * h);
    this.shade = new Int8Array(w * h);
    this.part = new Uint16Array(w * h);
    this.pid = 0;
    this.line = null;
    this.lineShade = 0;
    /** Drawing offset applied to every coordinate (lets a layout be re-centred in a wider frame). */
    this.ox = 0;
    this.oy = 0;
    this.minX = 0; this.minY = 0; this.maxX = -1; this.maxY = -1;
  }

  clear() {
    this.mat.fill(0);
    this.shade.fill(0);
    this.part.fill(0);
    this.pid = 0;
    return this;
  }

  /**
   * Start a part.
   * @param {null|'all'|'below'|'sides'|'belowSides'|'above'} line which neighbours of the part get darkened
   * @param {number} shade shade the darkened neighbours are clamped to (0 = deepest tone)
   */
  begin(line = null, shade = 0) {
    this.pid++;
    this.line = line;
    this.lineShade = shade;
    this.minX = this.w; this.minY = this.h; this.maxX = -1; this.maxY = -1;
  }

  end() {
    const offs = LINE_OFFS[this.line];
    if (!offs || this.maxX < 0) return;
    const { w, h, mat, part, shade, pid } = this;
    const hits = [];
    for (let y = this.minY; y <= this.maxY; y++) {
      for (let x = this.minX; x <= this.maxX; x++) {
        const i = y * w + x;
        if (part[i] !== pid || !mat[i]) continue;
        for (const [dx, dy] of offs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mat[j] && part[j] !== pid && mat[j] !== M.EYE && mat[j] !== M.LINE) hits.push(j);
        }
      }
    }
    for (const j of hits) if (shade[j] > this.lineShade) shade[j] = this.lineShade;
  }

  set(x, y, m, s = 2) {
    x = (x | 0) + this.ox; y = (y | 0) + this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.mat[i] = m;
    this.shade[i] = s;
    this.part[i] = this.pid;
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  get(x, y) {
    x = (x | 0) + this.ox; y = (y | 0) + this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.mat[y * this.w + x];
  }

  getShade(x, y) {
    x = (x | 0) + this.ox; y = (y | 0) + this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.shade[y * this.w + x];
  }

  /** Darken (or lighten with negative) an existing pixel's shade. */
  tone(x, y, delta) {
    x = (x | 0) + this.ox; y = (y | 0) + this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (!this.mat[i]) return;
    this.shade[i] = Math.max(0, Math.min(4, this.shade[i] + delta));
  }

  /** Set only if the pixel is already filled (paint "onto" existing shapes). */
  over(x, y, m, s) {
    if (this.get(x, y)) this.set(x, y, m, s);
  }

  rect(x, y, w, h, m, s = 2) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, m, s);
  }

  hline(x0, x1, y, m, s = 2) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.set(x, y, m, s);
  }

  vline(x, y0, y1, m, s = 2) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; y++) this.set(x, y, m, s);
  }

  /**
   * Bresenham line with a material/shade (or shade function of t along the line).
   * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   * @param {number} m material id (M.*)
   * @param {number | ((t: number, x: number, y: number) => number)} [s] shade 0–4 (2), or a
   *   function of t ∈ [0, 1] along the line and the pixel
   */
  line2(x0, y0, x1, y1, m, s = 2) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const n = Math.max(dx, -dy) || 1;
    let k = 0;
    for (;;) {
      this.set(x0, y0, m, typeof s === 'function' ? s(k / n, x0, y0) : s);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      k++;
    }
  }

  /** Stamp a template ({rows, legend, ox, oy}). */
  tpl(t, x, y, legendOverride = null) {
    const lg = legendOverride || t.legend;
    const rows = t.rows;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        const e = lg[ch];
        if (!e) continue;
        if (e === ERASE) { this.erase(x + (t.ox || 0) + c, y + (t.oy || 0) + r); continue; }
        this.set(x + (t.ox || 0) + c, y + (t.oy || 0) + r, e[0], e[1]);
      }
    }
  }

  erase(x, y) {
    x = (x | 0) + this.ox; y = (y | 0) + this.oy;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.mat[i] = 0;
    this.part[i] = 0;
  }
}

const ERASE = Object.freeze(['erase']);

const LINE_OFFS = {
  all: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  below: [[0, 1]],
  above: [[0, -1]],
  sides: [[1, 0], [-1, 0]],
  belowSides: [[1, 0], [-1, 0], [0, 1]],
};

/**
 * Resolve a painter into a PixelCanvas region: colour pass + 1px silhouette outline.
 * @param {Painter} p
 * @param {Array<number[][]>} ramps material id → 5-tone ramp
 * @param {PixelCanvas} dst
 * @param {number} dx
 * @param {number} dy
 * @param {boolean} flip mirror horizontally
 * @param {{outline?:boolean, selout?:boolean}} opts
 */
function resolvePainter(p, ramps, dst, dx, dy, flip = false, { outline = true } = {}) {
  const { w, h, mat, shade } = p;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const tx = dx + (flip ? w - 1 - x : x);
      const ty = dy + y;
      const m = mat[i];
      if (m) {
        const ramp = ramps[m] || ramps[M.TOP];
        dst.set(tx, ty, ramp[Math.max(0, Math.min(4, shade[i]))]);
      } else if (outline) {
        const l = x > 0 && mat[i - 1];
        const r = x < w - 1 && mat[i + 1];
        const u = y > 0 && mat[i - w];
        const d = y < h - 1 && mat[i + w];
        if (l || r || u || d) dst.set(tx, ty, OUTLINE);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Template data (head box = 12 × 11, origin at the top-left of the skull box)
// ---------------------------------------------------------------------------

const SKIN_L = { d: [M.SKIN, 0], s: [M.SKIN, 1], m: [M.SKIN, 2], l: [M.SKIN, 3], L: [M.SKIN, 4] };
const HAIR_L = { 1: [M.HAIR, 0], 2: [M.HAIR, 1], 3: [M.HAIR, 2], 4: [M.HAIR, 3], 5: [M.HAIR, 4], x: ERASE };
const BEARD_L = { 1: [M.BEARD, 0], 2: [M.BEARD, 1], 3: [M.BEARD, 2], 4: [M.BEARD, 3], 5: [M.BEARD, 4], s: [M.SKIN, 1] };
const HAT_L = {
  1: [M.HAT, 0], 2: [M.HAT, 1], 3: [M.HAT, 2], 4: [M.HAT, 3], 5: [M.HAT, 4],
  a: [M.HATBAND, 0], b: [M.HATBAND, 1], c: [M.HATBAND, 2], d: [M.HATBAND, 3],
  g: [M.GOLD, 1], G: [M.GOLD, 3], h: [M.GOLD, 4], j: [M.GEM, 2], J: [M.GEM, 4],
  f: [M.FEATHER, 1], F: [M.FEATHER, 3], e: [M.FEATHER, 4],
  k: [M.HAT, 0], x: ERASE, m: [M.SKIN, 2], s: [M.SKIN, 1], S: [M.SKIN, 0], 9: [M.HAIR, 2], 8: [M.HAIR, 1],
};

const T = (rows, legend, ox = 0, oy = 0) => ({ rows, legend, ox, oy });

const HEAD = {
  down: T([
    '............',
    '...mmmmmm...',
    '..mmmmmmmm..',
    '.mmmmmmmmmm.',
    '.mmmmmmmmms.',
    'smmmmmmmmmss',
    'smmmmmmmmmss',
    '.mmmmmmmmms.',
    '.lmmmmmmmss.',
    '..mmmmmmss..',
    '...mmssss...',
  ], SKIN_L),
  side: T([
    '............',
    '....mmmmmm..',
    '..mmmmmmmmm.',
    '.mmmmmmmmmmm',
    '.mmmmmmmmmms',
    '.mmmmmmmmmss',
    '.mmmmmmmmmss',
    'mmmmmmmmmss.',
    '.mmmmmmmss..',
    '..mmmmsss...',
    '...mss......',
  ], SKIN_L),
  up: T([
    '............',
    '...mmmmmm...',
    '..mmmmmmmm..',
    '.mmmmmmmmmm.',
    '.mmmmmmmmms.',
    'smmmmmmmmmss',
    'smmmmmmmmmss',
    '.mmmmmmmmms.',
    '..mmmmmmss..',
    '...smmmss...',
    '....ssss....',
  ], SKIN_L),
};

/**
 * Hair templates per style & view. `front` is drawn over the face, `back` behind the body.
 * Coordinates are relative to the head box (ox/oy shift the template). `swayFrom` marks the first
 * template row that follows the secondary-motion sway (long hair tips).
 */
const HAIR = {
  short: {
    down: {
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.344433333222.',
        '.333233233322.',
        '.33.33.23..22.',
        '.32........22.',
        '.2..........1.',
      ], HAIR_L, -1, -1),
    },
    side: {
      front: T([
        '.....33443....',
        '...334444433..',
        '..33455443332.',
        '.3445543333322',
        '.3443333333222',
        '.33.3.33333222',
        '.3......333222',
        '........332221',
        '........33221.',
        '.........221..',
      ], HAIR_L, -1, -1),
    },
    up: {
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.344443333322.',
        '.343343333222.',
        '.333332333222.',
        '.233333323221.',
        '.223333332221.',
        '..2223332221..',
        '...22222211...',
      ], HAIR_L, -1, -1),
    },
  },
  spiky: {
    down: {
      front: T([
        '...3.....4....',
        '...43..3.43...',
        '..3443344433..',
        '.3344554443322',
        '3334554433322.',
        '.334433333322.',
        '.3343332333222',
        '.33.33.23.322.',
        '.32...3....2..',
        '.2..........1.',
      ], HAIR_L, -1, -2),
    },
    side: {
      front: T([
        '.....3.4......',
        '....343433.3..',
        '...334444333..',
        '..33455443332.',
        '.3345543333322',
        '.3343333332222',
        '.33.3.33332222',
        '.3......333222',
        '........332221',
        '........33221.',
        '.........221..',
      ], HAIR_L, -1, -2),
    },
    up: {
      front: T([
        '...3.....3....',
        '...33..3.33...',
        '..3343334333..',
        '.3334443333322',
        '3333443333322.',
        '.334433333222.',
        '.343343333222.',
        '.333332333222.',
        '.233333323221.',
        '.223333332221.',
        '..2223332221..',
        '...22222211...',
      ], HAIR_L, -1, -2),
    },
  },
  long: {
    down: {
      swayFrom: 12,
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.3444433.3222.',
        '.34433.3..322.',
        '3343.......322',
        '343.........22',
        '343.........21',
        '33..........21',
        '343........321',
        '343........221',
        '.33........22.',
        '.32........21.',
        '..2........1..',
      ], HAIR_L, -1, -1),
      back: T([
        '.333333333322.',
        '.333333333322.',
        '.233333333221.',
        '..2222222221..',
      ], HAIR_L, -1, 9),
    },
    side: {
      swayFrom: 11,
      front: T([
        '.....33443....',
        '...334444433..',
        '..33455443332.',
        '.3445543333322',
        '.3443333333222',
        '.33.3.33433222',
        '.3.....3433222',
        '.......3433221',
        '.......3333221',
        '.......3332221',
        '.......3332221',
        '.......3332221',
        '.......233221.',
        '........2321..',
        '........221...',
      ], HAIR_L, -1, -1),
    },
    up: {
      swayFrom: 12,
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.344443333322.',
        '.344343333222.',
        '33433323332221',
        '34433323332221',
        '34333323332221',
        '33433323322221',
        '33433233322221',
        '33333233322221',
        '.2333233322211',
        '.233223232221.',
        '..22.22.221...',
      ], HAIR_L, -1, -1),
    },
  },
  ponytail: {
    down: {
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.344433333222.',
        '.33.3.32..222.',
        '.3..........2.',
        '.2..........1.',
      ], HAIR_L, -1, -1),
    },
    side: {
      front: T([
        '.....33443....',
        '...334444433..',
        '..33455443332.',
        '.3445543333322',
        '.3443333333222',
        '.3..3.3333222.',
        '.3......3322..',
        '........322...',
      ], HAIR_L, -1, -1),
    },
    up: {
      front: T([
        '.....3443.....',
        '...33444433...',
        '..3345544333..',
        '.334554433322.',
        '.344443333322.',
        '.343343333222.',
        '.233332333221.',
        '..2333323221..',
        '...22333221...',
      ], HAIR_L, -1, -1),
    },
  },
  bun: {
    down: {
      front: T([
        '.....3443.....',
        '....345542....',
        '...33244233...',
        '..3345544333..',
        '.334554433322.',
        '.344433333222.',
        '.3332333.3322.',
        '.3..3.....2...',
        '.2..........1.',
      ], HAIR_L, -1, -2),
    },
    side: {
      // round knot at the back-top of the skull, separated from the crown by a shadow crease
      front: T([
        '............343.',
        '.....33443324543',
        '...3344444334332',
        '..3345544333222.',
        '.3445543333322..',
        '.3443333333222..',
        '.33.3.3333222...',
        '.3......3322....',
        '........322.....',
      ], HAIR_L, -1, -2),
    },
    up: {
      front: T([
        '....345543....',
        '....344432....',
        '....233322....',
        '..3344433332..',
        '.334454333322.',
        '.344433333222.',
        '.333333323222.',
        '.233332333221.',
        '..2333323221..',
        '...22333221...',
      ], HAIR_L, -1, -2),
    },
  },
  bald: {
    down: {
      front: T([
        '.4..........3.',
        '.43........32.',
        '.33........22.',
        '.32........21.',
        '.2..........1.',
      ], HAIR_L, -1, 3),
    },
    side: {
      front: T([
        '.........332.',
        '........33221',
        '........3222.',
        '.........21..',
      ], HAIR_L, -1, 5),
    },
    up: {
      front: T([
        '.4..........3.',
        '.43........32.',
        '.343333333322.',
        '.233332333221.',
        '..2223332221..',
        '...22222211...',
      ], HAIR_L, -1, 3),
    },
  },
};

/** Beards (drawn after hair; `BEARD` material defaults to the hair colour). */
const BEARDS = {
  full: {
    down: T([
      '.3........2.',
      '.34.4433.32.',
      '.3445ss5432.',
      '..44433332..',
      '..34433322..',
      '...343322...',
      '....3322....',
      '.....21.....',
    ], { ...BEARD_L, s: [M.BEARD, 0] }, 0, 6),
    side: T([
      '.....2......',
      '.44..32.....',
      '.4433332....',
      '.344332.....',
      '.34433......',
      '..3432......',
      '..332.......',
      '...2........',
    ], BEARD_L, 0, 7),
  },
  mustache: {
    down: T([
      '...443342...',
      '...3.22.2...',
    ], BEARD_L, 0, 8),
    side: T([
      '443.........',
      '.3..........',
    ], BEARD_L, 0, 8),
  },
  goatee: {
    down: T([
      '....4432....',
      '.....32.....',
    ], BEARD_L, 0, 9),
    side: T([
      '.44.........',
      '.32.........',
    ], BEARD_L, 0, 9),
  },
};

/** Hats. `front` is drawn over the hair; `mask` rows erase hair outside the hat where needed. */
const HATS = {
  hood: {
    down: T([
      '......44......',
      '....344332....',
      '...34444332...',
      '..3445433322..',
      '.344333333322.',
      '.3431111111222',
      '.341........22',
      '342.........22',
      '342.........21',
      '332.........21',
      '332.........21',
      '3321.......221',
      '33321.....2221',
      '.333222222222.',
    ], HAT_L, -1, -2),
    side: T([
      '.......444....',
      '.....3443332..',
      '...344443332..',
      '..34544333322.',
      '..34433333322.',
      '.3431113333222',
      '.3..1..3333222',
      '.3.....3333222',
      '.......3332222',
      '.......3332221',
      '.......3332221',
      '......23332221',
      '.....233332221',
      '....2333332221',
    ], HAT_L, -1, -2),
    up: T([
      '......44......',
      '....344332....',
      '...34444332...',
      '..3445433322..',
      '.344333333322.',
      '.3443333333222',
      '.3433333333222',
      '33433333323222',
      '33333333323222',
      '33333333323221',
      '33333333323221',
      '33233333232221',
      '32233333232221',
      '.222222222221.',
    ], HAT_L, -1, -2),
  },
  wide: {
    down: T([
      '......34433.......',
      '.....3444433......',
      '....aabbbbcca.....',
      '..3344444443332...',
      '3344444433333322..',
      '.22222222222221...',
    ], HAT_L, -3, -2),
    side: T([
      '.....34433........',
      '....3444433.......',
      '...aabbbbcca......',
      '.334444444333322..',
      '334444443333332221',
      '.2222222222222211.',
    ], HAT_L, -3, -2),
    up: T([
      '......33332.......',
      '.....3443332......',
      '....aabbbbcca.....',
      '..3344443333322...',
      '3344443333333222..',
      '.22222222222221...',
    ], HAT_L, -3, -2),
  },
  cap: {
    down: T([
      '.....33333...eF...',
      '...3344443332fF...',
      '..33445443333322..',
      '..3444433333332...',
      '..aabbbbbbbbca....',
    ], HAT_L, -3, -2),
    side: T([
      '.....33333..eF....',
      '...33444433fF.....',
      '..3445443333332...',
      '..34443333333322..',
      '..abbbbbbbbba2....',
    ], HAT_L, -3, -2),
    up: T([
      '.....33333....eF..',
      '...3344433332fF...',
      '..33443333333322..',
      '..3443333333332...',
      '..aabbbbbbbbca....',
    ], HAT_L, -3, -2),
  },
  helmet: {
    down: T([
      '....GhGGgg....',
      '...33445332...',
      '..3445543322..',
      '.334544333222.',
      '.344443333222.',
      'dccccccccccbba',
      '.2.....g....2.',
      '.2..........2.',
      '.1..........1.',
    ], { ...HAT_L, 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3], 5: [M.METAL, 4], a: [M.METAL, 0], b: [M.METAL, 1], c: [M.METAL, 2], d: [M.METAL, 3] }, -1, -2),
    side: T([
      '.....GhGgg....',
      '....3344533...',
      '...34455333...',
      '..3445433332..',
      '..34443333322.',
      '.dccccccccbbba',
      '.........22222',
      '.........2322.',
      '.........122..',
    ], { ...HAT_L, 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3], 5: [M.METAL, 4], a: [M.METAL, 0], b: [M.METAL, 1], c: [M.METAL, 2], d: [M.METAL, 3] }, -1, -2),
    up: T([
      '....GhGGgg....',
      '...33445332...',
      '..3445433322..',
      '.334433333222.',
      '.343333333222.',
      'dccccccccccbba',
      '.2222222222222',
      '.2333333333322',
      '.1222222222211',
    ], { ...HAT_L, 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3], 5: [M.METAL, 4], a: [M.METAL, 0], b: [M.METAL, 1], c: [M.METAL, 2], d: [M.METAL, 3] }, -1, -2),
  },
  circlet: {
    down: T([
      '.GGGGhjgggg.',
    ], HAT_L, 0, 3),
    side: T([
      '.GGhGggggg..',
    ], HAT_L, 0, 3),
    up: T([
      '.ggggggggGg.',
    ], HAT_L, 0, 3),
  },
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Character presets (spec objects). Every field can be overridden in createCharacterSheet(spec).
 * Colours are PALETTE ramp names or hex strings.
 */
export const CHARACTER_PRESETS = {
  traveler: {
    skin: 'skinLight', hair: 'hairBrown', hairStyle: 'short',
    outfit: { top: '#2f9a92', bottom: '#4a4a5e', accent: 'wood', style: 'tunic', shirt: 'cream' },
    cape: { color: '#a0703f', style: 'cloak', lining: '#5a3a2a' }, hat: 'none', weapon: 'none', beard: false,
    gear: { satchel: true, boots: '#4a3428', leather: '#6a4428' }, eyes: 'green',
  },
  swordsman: {
    skin: 'skinTan', hair: 'hairBlack', hairStyle: 'spiky',
    outfit: { top: '#39445e', bottom: 'brown', accent: 'metal', style: 'tunic', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'sword', beard: false,
    gear: { scarf: 'red', pauldrons: true, bracers: true, boots: 'black' }, eyes: 'brown',
  },
  merchant: {
    skin: 'skinLight', hair: 'hairRed', hairStyle: 'short',
    outfit: { top: 'green', bottom: '#6b4a34', accent: 'gold', style: 'vest', shirt: 'cream' },
    cape: false, hat: 'wide', hatColor: '#7a5a3c', hatBand: 'red', weapon: 'none', beard: 'mustache',
    gear: { pack: true, boots: 'brown' }, build: 'stout', eyes: 'brown',
  },
  cleric: {
    skin: 'skinLight', hair: 'hairBlonde', hairStyle: 'long',
    outfit: { top: 'white', bottom: 'white', accent: 'blue', style: 'robe', shirt: 'white' },
    cape: false, hat: 'circlet', weapon: 'staff', beard: false,
    gear: { boots: 'cream', sash: 'gold', staffGem: 'blue' }, eyes: 'blue', blush: true,
  },
  scholar: {
    skin: 'skinLight', hair: 'hairWhite', hairStyle: 'short',
    outfit: { top: 'purple', bottom: 'purple', accent: 'gold', style: 'robe', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'none', beard: 'goatee',
    gear: { glasses: true, book: true, boots: 'brown' }, eyes: 'blue',
  },
  dancer: {
    skin: 'skinTan', hair: 'hairBlack', hairStyle: 'ponytail',
    outfit: { top: 'red', bottom: 'red', accent: 'gold', style: 'dancer', shirt: 'gold' },
    cape: false, hat: 'circlet', weapon: 'none', beard: false,
    gear: { sashes: true, boots: 'gold' }, eyes: 'brown', blush: true, female: true,
  },
  hunter: {
    skin: 'skinTan', hair: 'hairBlonde', hairStyle: 'short',
    outfit: { top: '#7a5a38', bottom: '#3f4a36', accent: 'brown', style: 'tunic', shirt: 'cream' },
    cape: { color: '#3f7a3c', style: 'short', lining: '#2b4a2c' }, hat: 'hood', hatColor: '#3f7a3c', weapon: 'bow', beard: false,
    gear: { quiver: true, boots: 'brown', gloves: 'brown' }, eyes: 'green',
  },
  villager: {
    skin: 'skinLight', hair: 'hairBrown', hairStyle: 'short',
    outfit: { top: 'cream', bottom: '#5a6b82', accent: 'brown', style: 'tunic', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'none', beard: false,
    gear: { boots: 'brown' }, eyes: 'brown',
  },
  farmer: {
    skin: 'skinTan', hair: 'hairBrown', hairStyle: 'short',
    outfit: { top: '#c9b48a', bottom: '#3f5f88', accent: 'gold', style: 'overalls', shirt: '#c9b48a' },
    cape: false, hat: 'wide', hatColor: 'thatch', hatBand: 'red', weapon: 'none', beard: false,
    gear: { boots: 'brown' }, eyes: 'brown',
  },
  elder: {
    skin: 'skinLight', hair: 'hairWhite', hairStyle: 'bald',
    outfit: { top: '#7a6a5a', bottom: '#5c4d3f', accent: 'brown', style: 'robe', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'cane', beard: 'full',
    gear: { boots: 'brown', sash: 'red' }, build: 'elder', eyes: 'brown',
  },
  child: {
    skin: 'skinLight', hair: 'hairBlonde', hairStyle: 'ponytail',
    outfit: { top: '#d9776a', bottom: '#5a6b82', accent: 'cream', style: 'tunic', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'none', beard: false,
    gear: { boots: 'brown' }, build: 'child', eyes: 'blue', blush: true,
  },
  guard: {
    skin: 'skinLight', hair: 'hairBrown', hairStyle: 'short',
    outfit: { top: 'blue', bottom: '#4a4450', accent: 'gold', style: 'tabard', shirt: 'metal' },
    cape: false, hat: 'helmet', weapon: 'spear', beard: false,
    gear: { pauldrons: true, boots: 'black', gloves: 'brown' }, eyes: 'brown',
  },
  innkeeper: {
    skin: 'skinLight', hair: 'hairBrown', hairStyle: 'bun',
    outfit: { top: '#a8563f', bottom: '#6e3a3a', accent: 'white', style: 'dress', shirt: 'cream' },
    cape: false, hat: 'none', weapon: 'none', beard: false,
    gear: { apron: 'cream', boots: 'brown' }, eyes: 'brown', blush: true, female: true,
  },
  bard: {
    skin: 'skinLight', hair: 'hairBlonde', hairStyle: 'short',
    outfit: { top: '#3d5fb4', bottom: '#5a3a24', accent: 'gold', style: 'tunic', shirt: 'cream' },
    cape: { color: '#8c2330', style: 'short', lining: '#5a1420' }, hat: 'cap', hatColor: 'red', hatBand: 'gold', feather: 'white', weapon: 'lute', beard: false,
    gear: { boots: 'brown' }, eyes: 'blue',
  },
};

const EYE_COLORS = {
  brown: '#5a3a2a', blue: '#3a5ab0', green: '#3a7a4a', grey: '#5a6070', violet: '#6a3a8a', gold: '#a8781d',
};

// ---------------------------------------------------------------------------
// Spec resolution
// ---------------------------------------------------------------------------

const RANDOM_CLOTH = ['cream', 'brown', 'green', 'blue', 'red', 'purple', '#5a6b82', '#8a6a4a', '#6e3a3a', '#3f5f5a', '#a8563f', '#c9b48a', '#4a4450'];
const RANDOM_HAIR = ['hairBrown', 'hairBrown', 'hairBlonde', 'hairBlack', 'hairRed', 'hairWhite'];

/**
 * Seeded NPC variation: fills every field the caller did not set explicitly with a random pick
 * (used when spec.randomize is true or spec.preset === 'random').
 */
function randomizeSpec(spec, seed) {
  const rng = new RNG(seed);
  const out = { preset: 'villager', ...spec };
  const female = spec.female ?? rng.chance(0.5);
  out.female = female;
  out.skin ??= rng.pick(['skinLight', 'skinLight', 'skinTan', 'skinDark']);
  out.hair ??= rng.pick(RANDOM_HAIR);
  out.hairStyle ??= female ? rng.pick(['long', 'ponytail', 'bun', 'short']) : rng.pick(['short', 'short', 'spiky', 'bald']);
  const top = rng.pick(RANDOM_CLOTH);
  let bottom = rng.pick(RANDOM_CLOTH);
  if (bottom === top) bottom = 'brown';
  out.outfit = { top, bottom, accent: rng.pick(['brown', 'gold', 'cream', 'red']), style: female ? rng.pick(['dress', 'dress', 'tunic']) : rng.pick(['tunic', 'tunic', 'vest', 'overalls']), shirt: 'cream', ...(spec.outfit || {}) };
  out.hat ??= rng.pick(['none', 'none', 'none', 'cap', 'wide']);
  if (out.hat === 'cap') out.hatColor ??= rng.pick(RANDOM_CLOTH);
  if (out.hat === 'wide') out.hatColor ??= rng.pick(['thatch', '#7a5a3c']);
  out.beard ??= !female && out.hairStyle !== 'long' && rng.chance(0.3) ? rng.pick(['full', 'mustache', 'goatee']) : false;
  out.blush ??= female && rng.chance(0.6);
  out.eyes ??= rng.pick(Object.keys(EYE_COLORS));
  out.gear = { boots: rng.pick(['brown', 'black', '#5a3a24']), apron: out.outfit.style === 'dress' && rng.chance(0.5) ? 'cream' : undefined, ...(spec.gear || {}) };
  if (!out.gear.apron) delete out.gear.apron;
  out.cape ??= false;
  out.weapon ??= 'none';
  return out;
}

/** Shallow copy without `undefined` values (also inside `outfit` / `gear`), so `{ hair: undefined }` keeps the preset's value. */
function stripUndefined(spec) {
  if (!spec || typeof spec !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (v === undefined) continue;
    out[k] = (k === 'outfit' || k === 'gear') && v && typeof v === 'object' ? stripUndefined(v) : v;
  }
  return out;
}

/** Seeds may be numbers or strings; everything downstream wants an unsigned 32-bit integer. */
function normSeed(seed) {
  if (typeof seed === 'string') return hashString(seed);
  const n = Number(seed);
  return Number.isFinite(n) ? n >>> 0 : 1;
}

function resolveSpec(spec = {}) {
  if (typeof spec === 'string') spec = { preset: spec }; // createCharacterSheet('traveler')
  spec = stripUndefined(spec);
  if (spec.seed !== undefined) spec.seed = normSeed(spec.seed);
  if (spec.randomize || spec.preset === 'random') {
    const seed = spec.seed ?? 1;
    const { randomize, ...rest } = spec;
    spec = randomizeSpec({ ...rest, preset: spec.preset === 'random' ? 'villager' : (spec.preset ?? 'villager') }, seed);
    spec.seed = seed;
    spec._random = true;
  }
  const known = typeof spec.preset === 'string' && Object.hasOwn(CHARACTER_PRESETS, spec.preset);
  const presetName = known ? spec.preset : String(spec.preset ?? 'villager');
  const base = spec._random ? { ...CHARACTER_PRESETS.villager, gear: {} } : (known ? CHARACTER_PRESETS[presetName] : CHARACTER_PRESETS.villager);
  const c = {
    ...base,
    ...spec,
    outfit: { ...base.outfit, ...(spec.outfit || {}) },
    gear: { ...base.gear, ...(spec.gear || {}) },
  };
  c.preset = presetName;
  c.seed = spec.seed ?? hashString(String(presetName));
  // an explicit seed on a preset → subtle deterministic variation of the colours not overridden
  if (spec.seed !== undefined && !spec._random) {
    c.jitter = {
      top: !(spec.outfit && spec.outfit.top), bottom: !(spec.outfit && spec.outfit.bottom),
      hair: spec.hair === undefined, eyes: spec.eyes === undefined,
    };
  }
  // cape normalisation
  let cape = spec.cape !== undefined ? spec.cape : base.cape;
  if (cape === true) cape = { color: base.cape?.color ?? 'brown', style: base.cape?.style ?? 'cape' };
  else if (typeof cape === 'string' && cape !== 'none') cape = { color: cape, style: (base.cape && base.cape.style) || 'cape' };
  else if (typeof cape === 'number' || (cape && cape.isColor)) cape = { color: cape, style: (base.cape && base.cape.style) || 'cape' };
  else if (!cape || cape === 'none') cape = null;
  else cape = { ...(base.cape || {}), ...cape };
  c.cape = cape;
  // (a spec using the sprite kit's parts before it is loaded: Game._buildLevel loads it for the
  // characters it makes — Player.js `characterKitFor` —, the editor at start)
  if (!KIT && usesCharacterKit(c)) throw new Error(`createCharacterSheet: "${c.preset}" needs CharacterKit.js (loadCharacterKit)`);
  c.hat = typeof c.hat === 'string' && Object.hasOwn(HATS, c.hat) ? c.hat : 'none';
  c.weapon = c.weapon || 'none';
  let beard = c.beard;
  if (beard === true) beard = 'full';
  if (beard === 'none') beard = null;
  if ((typeof beard === 'string' && !Object.hasOwn(BEARDS, beard)) || typeof beard === 'number' || (beard && beard.isColor)) {
    c.beardColor = c.beardColor ?? beard; beard = 'full';
  }
  c.beard = beard || null;
  c.hairStyle = typeof c.hairStyle === 'string' && Object.hasOwn(HAIR, c.hairStyle) ? c.hairStyle : 'short';
  c.build = c.build || 'normal';
  c.rig = makeRig(c.build);
  return c;
}

/** Body measurements for a build. All y values are frame rows (feet on row 30, outline row 31). */
function makeRig(build) {
  if (build === 'child') {
    return {
      cx: 16, ground: 30, headY: 11, torsoTop: 22, waist: 25, hem: 27, hip: 26, robeHem: 29,
      armTop: 23, armLen: 2, half: 3, legW: 2, legGap: 1, bootH: 1, child: true,
    };
  }
  const r = {
    cx: 16, ground: 30, headY: 4, torsoTop: 15, waist: 21, hem: 24, hip: 24, robeHem: 28,
    armTop: 16, armLen: 5, half: 4, legW: 3, legGap: 2, bootH: 2, child: false,
  };
  if (build === 'stout') r.half = 5;
  if (build === 'elder') { r.headY = 5; r.torsoTop = 16; r.armTop = 17; r.armLen = 4; }
  return r;
}

function buildRamps(c) {
  const ramps = new Array(MAT_COUNT).fill(null);
  const rng = new RNG(c.seed);
  const set = (m, spec, kind) => { ramps[m] = rampForKind(spec, kind); };
  /** Colour-or-flag fields: `true` (or another non-colour flag) means "use the default colour". */
  const col = (v, d) => (v === true || v === false || v == null || v === '' ? d : v);
  set(M.SKIN, c.skin || 'skinLight', 'skin');
  set(M.HAIR, c.hair || 'hairBrown', 'hair');
  set(M.BEARD, c.beardColor || c.hair || 'hairBrown', 'hair');
  set(M.TOP, c.outfit.top || 'cream');
  set(M.BOTTOM, c.outfit.bottom || 'brown');
  set(M.ACCENT, c.outfit.accent || 'gold');
  set(M.SHIRT, c.outfit.shirt || 'cream');
  set(M.CAPE, col(c.cape?.color, 'brown'));
  ramps[M.CAPEIN] = c.cape?.lining ? rampForKind(c.cape.lining) : ramps[M.CAPE].map((col) => shadeColor(col, -0.25));
  set(M.HAT, c.hatColor || (c.hat === 'hood' ? (c.cape?.color || 'green') : (KIT && KIT.HAT_COLORS[c.hat]) || 'brown'));
  set(M.HATBAND, c.hatBand || c.outfit.accent || 'red');
  set(M.BOOT, col(c.gear.boots, 'brown'));
  set(M.METAL, 'metal');
  set(M.WOOD, 'wood');
  set(M.GOLD, 'gold');
  set(M.LEATHER, col(c.gear.leather, 'brown'));
  set(M.WHITE, col(c.gear.apron, c.gear.apron === true ? 'cream' : 'white'));
  set(M.SCARF, col(c.gear.scarf, 'red'));
  set(M.PACK, col(c.gear.packColor, '#b09a70'));
  set(M.GEM, col(c.gear.staffGem, 'blue'));
  set(M.STRING, 'cream');
  set(M.FEATHER, col(c.feather, 'white'));
  set(M.BOOK, col(c.gear.bookColor, 'red'));
  set(M.BELT, col(c.gear.belt, 'brown'));
  set(M.SASH, col(c.gear.sash, col(c.outfit.accent, 'gold')));
  // combat-only parts (never drawn by the plain poses): bead necklace, healing-draught liquid
  set(M.BONE, col(c.gear.beads, '#d8ccae'));
  set(M.GEL, '#4fbf5f');
  if (c.gear.gemGlow) ramps[M.GEM] = ramps[M.GEM].map(glowTexel); // staff gem → glow texels (alpha 204)
  // the drawn sword's blade and the shield's crest: the metal and the gold, as glow texels on request
  ramps[M.BLADE] = c.gear.bladeGlow ? ramps[M.METAL].map(glowTexel) : ramps[M.METAL];
  ramps[M.CREST] = c.gear.crestGlow ? ramps[M.GOLD].map(glowTexel) : ramps[M.GOLD];
  // the party classes' weapons (drawn only for them): the sun and the crystal glow (alpha 204)
  ramps[M.GILT] = materialRamp(['#3e2a14', '#6e4c20', '#a87a34', '#d6aa56', '#f6d98a']);
  ramps[M.HOLY] = materialRamp(['#b07a1c', '#e8b23a', '#ffd968', '#fff0b0', '#fffbe8']).map(glowTexel);
  ramps[M.ICE] = materialRamp(['#2c5c96', '#4f94d2', '#86c8f2', '#c4ecff', '#f4fdff']).map(glowTexel);
  set(M.SHIELD, col(c.gear.shield, '#2c4f86'));
  ramps[M.LINE] = [OUTLINE, OUTLINE, OUTLINE, OUTLINE, OUTLINE];
  if (c.jitter) {
    const jr = new RNG(c.seed ^ 0x5bd1e995);
    const shift = (ramp, dh, dl, ds = 1) => ramp.map((col) => {
      const [h, sat, l] = rgbToHsl(col);
      return [...hslToRgb([h + dh, Math.min(1, sat * ds), Math.max(0, Math.min(1, l + dl))]), col[3] ?? 255];
    });
    if (c.jitter.top) ramps[M.TOP] = shift(ramps[M.TOP], jr.range(-14, 14), jr.range(-0.05, 0.05), jr.range(0.85, 1.1));
    if (c.jitter.bottom) ramps[M.BOTTOM] = shift(ramps[M.BOTTOM], jr.range(-12, 12), jr.range(-0.05, 0.04));
    if (c.jitter.hair) ramps[M.HAIR] = shift(ramps[M.HAIR], jr.range(-6, 6), jr.range(-0.04, 0.04));
    if (c.jitter.eyes) c.eyes = jr.pick(Object.keys(EYE_COLORS));
  }
  const skin = ramps[M.SKIN];
  ramps[M.BLUSH] = [0, 1, 2, 3, 4].map(() => mixColor(skin[2], '#e0607a', 0.35));
  const eyeHex = normColor(ownValue(EYE_COLORS, c.eyes) || c.eyes || rng.pick(Object.values(EYE_COLORS)), EYE_COLORS.brown);
  const eyeDark = mixColor(OUTLINE, eyeHex, 0.25);
  ramps[M.EYE] = [OUTLINE, eyeDark, [...parseColor(eyeHex)], shadeColor(eyeHex, 0.3), [255, 255, 255, 255]];
  // The Bells of Evermere's parts' ramps: the hammer's collar, a hood's fur rim, the greathelm's slit
  if (KIT) KIT.ramps(c, ramps, eyeDark, eyeHex);
  for (let i = 0; i < MAT_COUNT; i++) if (!ramps[i]) ramps[i] = ramps[M.TOP];
  return ramps;
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/** Column poses: idle0, idle1, walk0 (contact A), walk1 (passing), walk2 (contact B), walk3 (passing). */
const POSES = [
  { key: 'idle0', bob: 0, br: 0, walk: -1 },
  { key: 'idle1', bob: 0, br: 1, walk: -1 },
  { key: 'walk0', bob: 0, br: 0, walk: 0 },
  { key: 'walk1', bob: -1, br: 0, walk: 1 },
  { key: 'walk2', bob: 0, br: 0, walk: 2 },
  { key: 'walk3', bob: -1, br: 0, walk: 3 },
];

/** Secondary motion (1-frame lag): hem/hair offset relative to the body. */
function lagOf(pose) {
  if (pose.lag) return pose.lag; // combat poses carry their own secondary motion
  if (pose.walk < 0) return { dy: pose.br ? -1 : 0, sway: 0, trail: 0 };
  const prev = (pose.walk + 3) % 4;
  const prevBob = prev === 1 || prev === 3 ? -1 : 0;
  return {
    dy: prevBob - pose.bob, // +1 = hem lower than rest (body just rose)
    sway: [1, 0, -1, 0][prev],
    trail: pose.walk === 1 || pose.walk === 3 ? 2 : 1,
  };
}

// ---------------------------------------------------------------------------
// Part drawing helpers
// ---------------------------------------------------------------------------

/** Cylinder-ish column shading (light from the left). */
function colShade(i, w) {
  if (w <= 1) return 2;
  if (i === 0) return 3;
  if (i === w - 1) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// DOWN / UP views (front & back)
// ---------------------------------------------------------------------------

function legsFront(p, c, pose, back) {
  const r = c.rig;
  const cl = pose.act ? combatFrontLegs(pose, back) : null;
  const lifts = cl ? cl.lifts : [[0, 0], [0, 0], [0, 1], [0, 2], [1, 0], [2, 0]][pose.walk + 2] || [0, 0];
  const hip = r.hip + pose.bob;
  const legX = r.child ? [r.cx - 3, r.cx + 1] : [r.cx - 4, r.cx + 1];
  if (cl) { legX[0] -= cl.spread; legX[1] += cl.spread; }
  const robe = c.outfit.style === 'robe' || c.outfit.style === 'dress';
  for (let k = 0; k < 2; k++) {
    let lift = lifts[k];
    const x0 = legX[k];
    const footY = r.ground - lift;
    p.begin(k === 1 ? 'sides' : null, 1);
    for (let y = hip; y <= footY; y++) {
      const boot = y > footY - r.bootH;
      for (let i = 0; i < r.legW; i++) {
        let s = colShade(i, r.legW);
        if (y <= hip + 1) s = Math.min(s, 1);
        if (boot) {
          s = y === footY ? 1 : colShade(i, r.legW);
          if (back && y === footY) s = 0;
          p.set(x0 + i, y, M.BOOT, s);
        } else {
          p.set(x0 + i, y, robe ? M.BOTTOM : M.BOTTOM, robe ? Math.max(0, s - 1) : s);
        }
      }
    }
    // toe cap (front view: foot pointing at the camera widens a little)
    if (!back && lift === 0 && !r.child) {
      p.set(k === 0 ? x0 - 1 : x0 + r.legW, footY, M.BOOT, k === 0 ? 2 : 1);
    }
    p.end();
  }
}

function armSwingFront(pose) {
  // [A (screen-left), B] vertical hand offsets
  switch (pose.walk) {
    case 0: return [-1, 1];
    case 2: return [1, -1];
    default: return [0, 0];
  }
}

/** Front/back torso for all outfit styles. */
function torsoFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  const waist = r.waist + up;
  const hem = r.hem + pose.bob;
  const cx = r.cx;
  const half = r.half;
  const style = c.outfit.style;
  const lag = lagOf(pose);
  const L = cx - half, R = cx + half - 1;

  p.begin(null);
  // upper torso
  for (let y = top; y < waist; y++) {
    const inset = y === top ? 1 : 0;
    for (let x = L + inset; x <= R - inset; x++) {
      const i = x - L;
      let s = colShade(i, R - L + 1);
      if (y === top) s = Math.min(s, 1);
      p.set(x, y, M.TOP, s);
    }
  }
  if (style === 'robe' || style === 'dress' || style === 'dancer') {
    // long skirt / robe with A-line flare, hem sways with lag
    const bottom = style === 'dancer' ? r.ground - 1 : r.robeHem + (style === 'dress' ? 0 : 0);
    const mat = style === 'robe' ? M.TOP : M.BOTTOM;
    for (let y = waist; y <= bottom + pose.bob; y++) {
      const t = (y - waist) / Math.max(1, bottom + pose.bob - waist);
      const flare = Math.round(t * (r.child ? 1 : 2));
      const sway = y >= bottom + pose.bob - 1 ? lag.sway : 0;
      const xl = L - flare + (y === bottom + pose.bob ? Math.max(0, sway) : 0);
      const xr = R + flare + (y === bottom + pose.bob ? Math.min(0, sway) : 0);
      for (let x = xl; x <= xr; x++) {
        const i = x - xl;
        let s = colShade(i, xr - xl + 1);
        // fabric folds
        const fx = x - cx;
        if (y > waist + 1 && (fx === -2 || fx === 2)) s = Math.max(1, s - 1);
        if (y > waist + 2 && fx === 0 && style !== 'dancer') s = Math.min(3, s + 0);
        if (y === bottom + pose.bob) s = Math.max(0, s - 1);
        p.set(x, y, mat, s);
      }
    }
  } else {
    // tunic skirt flaring past the belt
    for (let y = waist; y <= hem; y++) {
      const flare = y > waist ? 1 : 0;
      const xl = L - (y === hem ? flare : 0) - (y > waist && style !== 'overalls' ? 0 : 0);
      const xr = R + (y === hem ? flare : 0);
      const mat = style === 'overalls' ? M.BOTTOM : M.TOP;
      for (let x = xl; x <= xr; x++) {
        let s = colShade(x - xl, xr - xl + 1);
        if (y === hem) s = Math.max(1, s - 1);
        if (y > waist && (x === cx - 2 || x === cx + 1) && style === 'tunic') s = Math.max(1, s - 1);
        p.set(x, y, mat, s);
      }
    }
  }
  p.end();

  // ---- style details ----
  if (!back && (style === 'tunic' || style === 'dress' || style === 'tabard' || style === 'overalls')) {
    // chest highlight (light from the upper left)
    p.over(L + 1, top + 1, M.TOP, 3); p.over(L + 1, top + 2, M.TOP, 3); p.over(L + 2, top + 1, M.TOP, 3);
  }
  if (!back) {
    // collar / neckline under the chin
    if (style === 'robe') {
      p.set(cx - 1, top, M.SHIRT, 2); p.set(cx, top, M.SHIRT, 1);
      // trim down the centre
      for (let y = top + 1; y <= r.robeHem + pose.bob; y++) p.set(cx - (y > waist ? 0 : 0), y, M.ACCENT, y < waist ? 3 : 2);
      for (let y = top + 1; y <= r.robeHem + pose.bob; y++) p.set(cx - 1, y, M.ACCENT, y < waist ? 3 : 3);
      p.set(cx - 1, top + 1, M.ACCENT, 4);
    } else if (style === 'tunic') {
      p.set(cx - 1, top, M.TOP, 0); p.set(cx, top, M.TOP, 0);
      p.set(cx - 1, top + 1, M.TOP, 1);
      p.set(cx - 2, top, M.TOP, 2); p.set(cx + 1, top, M.TOP, 1);
    } else if (style === 'vest') {
      for (let y = top; y < waist; y++) { p.set(cx - 1, y, M.SHIRT, y === top ? 1 : 3); p.set(cx, y, M.SHIRT, y === top ? 1 : 2); }
      p.set(cx - 2, top + 1, M.GOLD, 3); p.set(cx + 1, top + 1, M.GOLD, 2);
      p.set(cx - 2, top + 3, M.GOLD, 3); p.set(cx + 1, top + 3, M.GOLD, 2);
    } else if (style === 'overalls') {
      // shirt on the upper torso, bib + straps in denim
      for (let y = top + 2; y < waist; y++) for (let x = cx - 2; x <= cx + 1; x++) p.set(x, y, M.BOTTOM, x === cx - 2 ? 3 : x === cx + 1 ? 1 : 2);
      p.set(cx - 3, top, M.BOTTOM, 2); p.set(cx - 3, top + 1, M.BOTTOM, 2);
      p.set(cx + 2, top, M.BOTTOM, 1); p.set(cx + 2, top + 1, M.BOTTOM, 1);
      p.set(cx - 2, top + 2, M.GOLD, 3); p.set(cx + 1, top + 2, M.GOLD, 2);
      p.set(cx - 1, top + 3, M.BOTTOM, 1); p.set(cx, top + 3, M.BOTTOM, 1); // pocket
    } else if (style === 'tabard') {
      for (let y = top; y <= hem + 1; y++) {
        for (let x = cx - 2; x <= cx + 1; x++) {
          const s = x === cx - 2 ? 3 : x === cx + 1 ? 1 : 2;
          p.set(x, y, M.TOP, y === hem + 1 ? Math.max(0, s - 1) : s);
        }
      }
      // emblem
      p.set(cx - 1, top + 2, M.GOLD, 4); p.set(cx, top + 2, M.GOLD, 3);
      p.set(cx - 1, top + 3, M.GOLD, 3); p.set(cx, top + 3, M.GOLD, 2);
      // chainmail sides
      for (let y = top + 1; y < waist; y++) { p.set(L, y, M.METAL, (y & 1) ? 3 : 2); p.set(R, y, M.METAL, (y & 1) ? 1 : 2); }
    } else if (style === 'dress') {
      p.set(cx - 1, top, M.TOP, 0); p.set(cx, top, M.TOP, 0);
      p.set(cx - 2, top, M.SHIRT, 3); p.set(cx + 1, top, M.SHIRT, 2);
    } else if (style === 'dancer') {
      // bodice with gold trim and a bare midriff
      p.set(cx - 1, top, M.SKIN, 2); p.set(cx, top, M.SKIN, 1);
      for (let x = L; x <= R; x++) p.set(x, waist - 1, M.SKIN, x === L ? 3 : x === R ? 1 : 2);
      for (let x = L; x <= R; x++) p.set(x, waist - 2, M.GOLD, x === R ? 2 : 3);
      p.set(cx - 1, waist - 1, M.SKIN, 1);
    }
  } else {
    // back: seams / folds
    if (style === 'tunic' || style === 'vest') {
      // shoulder-blade light & centre seam shadow
      p.set(L + 1, top + 1, M.TOP, 3); p.set(L + 2, top + 1, M.TOP, 3);
      p.set(R - 1, top + 2, M.TOP, 1);
    }
    if (style === 'overalls') {
      p.set(cx - 2, top, M.BOTTOM, 2); p.set(cx + 1, top, M.BOTTOM, 1);
      for (let y = top + 1; y < waist; y++) { p.set(cx - 1 - Math.floor((waist - y) / 3), y, M.BOTTOM, 2); p.set(cx + Math.floor((waist - y) / 3), y, M.BOTTOM, 1); }
    }
    if (style === 'tabard') {
      for (let y = top; y <= hem + 1; y++) for (let x = cx - 2; x <= cx + 1; x++) p.set(x, y, M.TOP, x === cx - 2 ? 3 : x === cx + 1 ? 1 : 2);
      for (let y = top + 1; y < waist; y++) { p.set(L, y, M.METAL, (y & 1) ? 3 : 2); p.set(R, y, M.METAL, (y & 1) ? 1 : 2); }
    }
    if (style === 'dancer') {
      for (let x = L; x <= R; x++) p.set(x, waist - 1, M.SKIN, x === L ? 3 : x === R ? 1 : 2);
      for (let x = L; x <= R; x++) p.set(x, waist - 2, M.GOLD, x === R ? 2 : 3);
    }
  }

  // belt / sash
  if (style === 'tunic' || style === 'vest' || style === 'tabard') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.BELT, x === L ? 3 : x === R ? 1 : 2);
    if (!back) { p.set(cx - 1, waist, M.GOLD, 4); p.set(cx, waist, M.GOLD, 2); }
  } else if (style === 'robe') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.SASH, x === L ? 3 : x === R ? 1 : 2);
    if (!back) { p.set(cx + 1, waist + 1, M.SASH, 1); p.set(cx + 1, waist + 2, M.SASH, 2); p.set(cx + 2, waist + 3, M.SASH, 1); }
    else { p.set(cx - 2, waist + 1, M.SASH, 2); p.set(cx - 2, waist + 2, M.SASH, 1); }
  } else if (style === 'dress') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.ACCENT, x === L ? 3 : x === R ? 1 : 2);
    if (back) { p.set(cx - 1, waist + 1, M.ACCENT, 3); p.set(cx, waist + 1, M.ACCENT, 2); p.set(cx - 2, waist + 2, M.ACCENT, 2); p.set(cx + 1, waist + 2, M.ACCENT, 1); }
  } else if (style === 'dancer') {
    for (let x = L - 1; x <= R + 1; x++) p.set(x, waist, M.GOLD, x <= L ? 4 : x >= R ? 2 : 3);
  }

  // apron (front)
  if (c.gear.apron && !back) {
    for (let y = waist + 1; y <= (style === 'dress' ? r.robeHem - 1 : hem) + pose.bob; y++) {
      const w = 2 + (y > waist + 2 ? 1 : 0);
      for (let x = cx - w; x <= cx + w - 1; x++) p.set(x, y, M.WHITE, x === cx - w ? 3 : x === cx + w - 1 ? 1 : 2);
    }
    for (let x = cx - 2; x <= cx + 1; x++) p.set(x, top + 1, M.WHITE, 3);
    for (let y = top + 2; y < waist; y++) for (let x = cx - 2; x <= cx + 1; x++) p.set(x, y, M.WHITE, x === cx + 1 ? 1 : 2);
    p.set(cx - 1, waist + 3, M.WHITE, 1); // pocket line
  }
}

function armsFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const swing = armSwingFront(pose);
  const half = r.half;
  const style = c.outfit.style;
  const sleeve = style === 'vest' || style === 'overalls' ? M.SHIRT : style === 'tabard' ? M.METAL : style === 'dancer' ? M.SKIN : M.TOP;
  const wide = style === 'robe';
  for (let k = 0; k < 2; k++) {
    const dy = back ? -swing[k] : swing[k];
    const x0 = k === 0 ? r.cx - half - 2 : r.cx + half;
    const top = r.armTop + up;
    const len = r.armLen + (dy > 0 ? 0 : dy);
    p.begin('sides', 1);
    for (let y = top; y < top + len; y++) {
      for (let i = 0; i < 2; i++) {
        let s = k === 0 ? (i === 0 ? 2 : 1) : (i === 0 ? 2 : 1);
        if (y === top) s = k === 0 ? 3 : 2;
        if (sleeve === M.SKIN) s = k === 0 ? (i === 0 ? 3 : 2) : (i === 0 ? 2 : 1);
        p.set(x0 + i, y, sleeve, s);
      }
      if (wide && y >= top + len - 2) p.set(k === 0 ? x0 - 1 : x0 + 2, y, M.TOP, k === 0 ? 2 : 1);
    }
    // cuff
    if (wide) { p.set(x0, top + len - 1, M.ACCENT, 3); p.set(x0 + 1, top + len - 1, M.ACCENT, 2); p.set(k === 0 ? x0 - 1 : x0 + 2, top + len - 1, M.ACCENT, 2); }
    if (c.gear.bracers && !r.child) { p.set(x0, top + len - 1, M.METAL, 3); p.set(x0 + 1, top + len - 1, M.METAL, 2); }
    if (style === 'dancer') { p.set(x0, top + len - 1, M.GOLD, 3); p.set(x0 + 1, top + len - 1, M.GOLD, 2); }
    // hand
    const hy = top + len;
    const handM = c.gear.gloves ? M.LEATHER : M.SKIN;
    p.set(x0, hy, handM, k === 0 ? 3 : 2); p.set(x0 + 1, hy, handM, k === 0 ? 2 : 1);
    if (!r.child) { p.set(x0, hy + 1, handM, 1); p.set(x0 + 1, hy + 1, handM, 1); }
    p.end();
    // shoulder pads: rounded metal guards with a bright rim
    if (c.gear.pauldrons && !r.child) {
      p.begin('below', 1);
      const PL = { 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3], 5: [M.METAL, 4] };
      const rows = k === 0 ? ['.45.', '4543', '2332'] : ['.43.', '3432', '1221'];
      p.tpl(T(rows, PL), k === 0 ? x0 - 1 : x0 - 1, top - 1);
      p.end();
    }
  }
}

function faceDown(p, c, hx, hy, pose) {
  const eyeY = hy + 6;
  const eL = hx + 3, eR = hx + 8;
  if (pose && HURT_FACE.has(pose.act)) { hurtFaceDown(p, c, hx, hy); return; }
  if (c.face === 'fierce') { fierceFaceDown(p, c, hx, hy); return; }
  // eyes: dark lash pixel over a coloured iris; lashes flick outward for feminine faces
  p.set(eL, eyeY, M.EYE, 0); p.set(eL, eyeY + 1, M.EYE, 2);
  p.set(eR, eyeY, M.EYE, 0); p.set(eR, eyeY + 1, M.EYE, 2);
  if (c.female) { p.set(eL - 1, eyeY, M.EYE, 1); p.set(eR + 1, eyeY, M.EYE, 1); }
  // soft mouth
  if (!c.beard || c.beard === 'goatee') p.set(hx + 6, hy + 9, M.SKIN, 1);
  if (c.blush) { p.set(hx + 2, hy + 8, M.BLUSH, 2); p.set(hx + 9, hy + 8, M.BLUSH, 2); }
  if (c.gear.glasses) {
    // round gold rims
    for (const e of [eL, eR]) {
      p.set(e - 1, eyeY, M.GOLD, 3); p.set(e + 1, eyeY, M.GOLD, 2);
      p.set(e - 1, eyeY + 1, M.GOLD, 2); p.set(e + 1, eyeY + 1, M.GOLD, 1);
      p.set(e, eyeY - 1, M.GOLD, 4); p.set(e, eyeY + 2, M.GOLD, 1);
      p.set(e, eyeY, M.WHITE, 3);
    }
    for (let x = eL + 2; x <= eR - 2; x++) p.set(x, eyeY, M.GOLD, 2);
  }
}

function faceSide(p, c, hx, hy, pose) {
  const eyeY = hy + 6;
  if (pose && HURT_FACE.has(pose.act)) { hurtFaceSide(p, c, hx, hy); return; }
  if (c.face === 'fierce') { fierceFaceSide(p, c, hx, hy); return; }
  p.set(hx + 2, eyeY, M.EYE, 0); p.set(hx + 2, eyeY + 1, M.EYE, 2);
  if (c.female) p.set(hx + 3, eyeY, M.EYE, 1);
  if (!c.beard) p.set(hx + 1, hy + 9, M.SKIN, 1);
  // ear
  p.set(hx + 6, eyeY, M.SKIN, 1); p.set(hx + 6, eyeY + 1, M.SKIN, 1); p.set(hx + 7, eyeY, M.SKIN, 2); p.set(hx + 7, eyeY + 1, M.SKIN, 0);
  if (c.blush) p.set(hx + 3, hy + 8, M.BLUSH, 2);
  if (c.gear.glasses) {
    p.set(hx + 1, eyeY, M.GOLD, 4); p.set(hx + 3, eyeY, M.GOLD, 3); p.set(hx + 2, eyeY - 1, M.GOLD, 4); p.set(hx + 2, eyeY + 2, M.GOLD, 2);
    p.set(hx + 1, eyeY + 1, M.GOLD, 3); p.set(hx + 3, eyeY + 1, M.GOLD, 2);
    for (let x = hx + 4; x <= hx + 6; x++) p.set(x, eyeY - 1, M.GOLD, 2);
  }
}

/** Stamp a template with the rows from `swayFrom` on shifted by dx (secondary motion). */
function tplSway(p, t, x, y, swayFrom, dx, dy = 0) {
  if (!swayFrom || (!dx && !dy)) { p.tpl(t, x, y); return; }
  const oy = t.oy || 0;
  p.tpl({ ...t, rows: t.rows.slice(0, swayFrom) }, x, y);
  // a downward lag stretches the hair (repeat the first swaying row) instead of tearing a see-through gap
  for (let k = 0; k < dy; k++) p.tpl({ ...t, rows: [t.rows[swayFrom]], oy: oy + swayFrom + k }, x, y);
  p.tpl({ ...t, rows: t.rows.slice(swayFrom), oy: oy + swayFrom + dy }, x + dx, y);
}

// ---------------------------------------------------------------------------
// Capes
// ---------------------------------------------------------------------------

const CAPE_L = {
  1: [M.CAPE, 0], 2: [M.CAPE, 1], 3: [M.CAPE, 2], 4: [M.CAPE, 3], 5: [M.CAPE, 4],
  i: [M.CAPEIN, 1], I: [M.CAPEIN, 2], j: [M.CAPEIN, 3], g: [M.GOLD, 2], G: [M.GOLD, 4],
};

/** Cloak mantle over the shoulders, front view (hood bunched behind the neck, clasp, open front). */
const MANTLE_FRONT = T([
  '..3444433322..',
  '.344443333322.',
  '.34444Gg33322.',
  '344444Ii333221',
  '34444I..i33221',
  '34443I..i32221',
  '34443I..i32221',
  '.3333i..i2221.',
], CAPE_L, -7, -2);

/** Short shoulder cape, front view. */
const CAPELET_FRONT = T([
  '.34444Gg33322.',
  '343........221',
  '.3..........1.',
], CAPE_L, -7, 0);

/** Cloak mantle, side view (facing left). */
const MANTLE_SIDE = T([
  '.....34443....',
  '...G44443332..',
  '..34444433322.',
  '.344444333222.',
  '.34443333222..',
  '..33332222I...',
  '...2...2......',
], CAPE_L, -5, -1);

/** Hood lying on the upper back (back view). */
const HOOD_BACK = T([
  '.2IjjjjI2.',
  '3444444332',
  '3444433322',
  '.34443322.',
  '..343322..',
  '...3322...',
  '....32....',
], CAPE_L, -5, -1);

/** Long cloak / cape panel behind the body in the front view (lining visible around the legs). */
function capeFrontBack(p, c, pose) {
  const r = c.rig;
  const short = c.cape.style === 'short';
  const up = pose.bob + pose.br;
  const lag = lagOf(pose);
  const top = r.torsoTop + up + 2;
  const bottom = (short ? r.waist + up + 1 : r.robeHem) + lag.dy;
  p.begin(null);
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const w = r.half + 2 + (t > 0.7 && !short ? 1 : 0);
    const sw = y >= bottom - 1 ? lag.sway : 0;
    const xl = r.cx - w + sw, xr = r.cx + w - 1 + sw;
    for (let x = xl; x <= xr; x++) {
      if (x === xl) p.set(x, y, M.CAPE, y === bottom ? 1 : 2);
      else if (x === xr) p.set(x, y, M.CAPE, y === bottom ? 0 : 1);
      else p.set(x, y, M.CAPEIN, y === bottom ? 1 : 2);
    }
  }
  p.end();
}

/** Cloak mantle / capelet over the shoulders (front view). */
function capeFrontMantle(p, c, pose) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  p.begin('below', 1);
  p.tpl(c.cape.style === 'cloak' ? MANTLE_FRONT : CAPELET_FRONT, r.cx, top);
  p.end();
}

/** Cape seen from behind (covers the back). */
function capeBackView(p, c, pose) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const lag = lagOf(pose);
  const top = r.torsoTop + up;
  const cloak = c.cape.style === 'cloak';
  const short = c.cape.style === 'short';
  const bottom = (short ? top + 7 : r.robeHem) + lag.dy;
  p.begin(null);
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const w = (y === top ? r.half + 1 : r.half + 2) + (t > 0.6 ? 1 : 0);
    const sw = y >= bottom - 2 ? lag.sway : 0;
    const xl = r.cx - w + sw, xr = r.cx + w - 1 + sw;
    for (let x = xl; x <= xr; x++) {
      let s = colShade(x - xl, xr - xl + 1);
      const fx = x - r.cx - sw;
      if (y > top + 3) {
        if (fx === -3 || fx === 2) s = 1; // fold valleys
        else if (fx === -2 || fx === 3) s = Math.min(3, s + 1); // fold ridges catch the light
      }
      if (y === bottom) s = Math.max(0, s - 1);
      if (y === bottom && (fx === -3 || fx === 2)) continue; // scalloped hem between folds
      p.set(x, y, M.CAPE, s);
    }
  }
  p.end();
  if (cloak) {
    p.begin('all', 1);
    p.tpl(HOOD_BACK, r.cx, top);
    p.end();
  } else {
    // collar
    p.begin(null);
    for (let x = r.cx - r.half - 1; x <= r.cx + r.half; x++) p.set(x, top, M.CAPE, x < r.cx - 2 ? 4 : x > r.cx + 2 ? 2 : 3);
    p.end();
  }
}

// ---------------------------------------------------------------------------
// Gear (front/back views)
// ---------------------------------------------------------------------------

/**
 * The pole weapons: held upright in the plain poses, at the grip in the combat poses (the party
 * classes' holy staff and ice staff are staves with their own heads, DRAGON_CAMPAIGN.md §5.4).
 */
const POLE_KINDS = Object.freeze(['staff', 'spear', 'cane', 'holystaff', 'icestaff']);
/** A staff (the ornament end up, leaning a little in the side view): the mystic's, the cleric's, the ice mage's. */
const isStaff = (kind) => kind === 'staff' || kind === 'holystaff' || kind === 'icestaff';
/** The shaft material of a pole weapon: the holy staff's gilded wood, the ice staff's silver, else wood. */
const poleMat = (kind) => (kind === 'holystaff' ? M.GILT : kind === 'icestaff' ? M.METAL : M.WOOD);

/**
 * The holy staff's head: a gold sun disc round a glowing core — `(x, y)` the shaft's top pixel.
 * `big` (the plain poses, held upright) adds a ray either side.
 */
function sunDisc(p, x, y, big = true) {
  // the gold ring (lit from the upper left)
  const ringPx = [[-1, -4, 4], [0, -4, 4], [1, -4, 3], [-2, -3, 4], [2, -3, 2], [-2, -2, 3], [2, -2, 1], [-2, -1, 3], [2, -1, 1], [-1, 0, 2], [0, 0, 2], [1, 0, 1]];
  for (const [dx, dy, s] of ringPx) p.set(x + dx, y + dy, M.GOLD, s);
  // the glowing core
  p.set(x - 1, y - 3, M.HOLY, 4); p.set(x, y - 3, M.HOLY, 4); p.set(x + 1, y - 3, M.HOLY, 3);
  p.set(x - 1, y - 2, M.HOLY, 3); p.set(x, y - 2, M.HOLY, 4); p.set(x + 1, y - 2, M.HOLY, 2);
  p.set(x - 1, y - 1, M.HOLY, 2); p.set(x, y - 1, M.HOLY, 3); p.set(x + 1, y - 1, M.HOLY, 2);
  // the rays either side (the ring's top stays a row inside the frame: its outline needs one)
  if (big) { p.set(x - 3, y - 2, M.GOLD, 3); p.set(x + 3, y - 2, M.GOLD, 1); }
  p.set(x, y + 1, M.GOLD, 2);
}

/**
 * The ice staff's head: a long crystal in a silver claw — `(x, y)` the shaft's top pixel.
 */
function iceCrystal(p, x, y) {
  // (its tip a row inside the frame: the outline needs one)
  p.set(x, y - 4, M.ICE, 4);
  p.set(x - 1, y - 3, M.ICE, 4); p.set(x, y - 3, M.ICE, 4); p.set(x + 1, y - 3, M.ICE, 2);
  p.set(x - 1, y - 2, M.ICE, 3); p.set(x, y - 2, M.ICE, 4); p.set(x + 1, y - 2, M.ICE, 1);
  p.set(x - 1, y - 1, M.ICE, 3); p.set(x, y - 1, M.ICE, 3); p.set(x + 1, y - 1, M.ICE, 1);
  p.set(x, y, M.ICE, 2);
  // the silver claw round its foot
  p.set(x - 1, y, M.METAL, 3); p.set(x + 1, y, M.METAL, 1);
  p.set(x - 1, y + 1, M.METAL, 2); p.set(x, y + 1, M.METAL, 3); p.set(x + 1, y + 1, M.METAL, 1);
  // a shard flying beside it
  p.set(x + 2, y - 3, M.ICE, 3);
}

function staffTop(p, c, x, y, kind) {
  if (kind === 'holystaff') {
    sunDisc(p, x, y);
    return;
  }
  if (kind === 'icestaff') {
    iceCrystal(p, x, y);
    return;
  }
  if (kind === 'spear') {
    p.set(x, y - 3, M.METAL, 4);
    p.set(x - 1, y - 2, M.METAL, 3); p.set(x, y - 2, M.METAL, 4); p.set(x + 1, y - 2, M.METAL, 2);
    p.set(x - 1, y - 1, M.METAL, 2); p.set(x, y - 1, M.METAL, 3); p.set(x + 1, y - 1, M.METAL, 1);
    p.set(x, y, M.METAL, 2);
    p.set(x - 1, y + 1, M.SCARF, 3); p.set(x, y + 1, M.GOLD, 3); p.set(x + 1, y + 1, M.SCARF, 1);
  } else if (kind === 'staff') {
    p.set(x - 1, y - 1, M.GOLD, 3); p.set(x, y - 2, M.GOLD, 4); p.set(x + 1, y - 1, M.GOLD, 2);
    p.set(x - 1, y, M.GOLD, 3); p.set(x + 1, y, M.GOLD, 1);
    p.set(x, y - 1, M.GEM, 4); p.set(x, y, M.GEM, 2);
    p.set(x, y + 1, M.GOLD, 2);
  } else if (kind === 'cane') {
    p.set(x, y, M.WOOD, 3); p.set(x + 1, y - 1, M.WOOD, 3); p.set(x + 2, y - 1, M.WOOD, 2); p.set(x + 3, y, M.WOOD, 1);
  }
}

/**
 * Top row of a pole weapon held at hand row `hy`. Spears and staves reach above the head so the
 * spear tip / staff ornament stays readable next to the head instead of vanishing behind the hair.
 */
function poleTopY(kind, hy) {
  return kind === 'spear' || isStaff(kind) ? hy - 16 : hy - 3;
}

/** Side-view staff lean (px forward per px up) so the ornament clears the face profile. */
const STAFF_LEAN = 0.125;

/** Long pole weapon held in a hand at (hx, hy). */
function drawPole(p, c, hx, hy, kind) {
  const r = c.rig;
  const top = poleTopY(kind, hy);
  const bottom = r.ground;
  const mat = poleMat(kind);
  p.begin(null);
  for (let y = top; y <= bottom; y++) p.set(hx, y, mat, y < hy ? 3 : 2);
  staffTop(p, c, hx, top, kind);
  p.end();
}

// ---- the greatshield's tower shield and flanged mace (DRAGON_CAMPAIGN.md §5.4) ----

/** The crest a spec asks for (`gear.crest`: CharacterKit.js's `CRESTS`), or null: the wyvern. @param {any} c */
const crestOf = (c) => (c?.gear?.crest === 'anchor' || c?.gear?.crest === 'plain' ? c.gear.crest : null);

/**
 * The tower shield's face, 7 × 11 px with its top-left at (x0, y0): a steel rim lit from the upper
 * left, the field (`gear.shield`) with a sheen down its left, a gold boss, and a dragon crest — a
 * wyvern, wings raised — in gold (`M.CREST`: glow texels with `gear.crestGlow`); another crest with
 * `crest` (CharacterKit.js's `CRESTS`).
 * @param {Painter} p @param {number} x0 @param {number} y0 @param {'anchor'|'plain'|null} [crest]
 */
function shieldFace(p, x0, y0, crest = null) {
  const rows = crest ? KIT.CRESTS[crest] : [
    '.rRRRr.',
    'rLFFFFr',
    'rLgFgFr',
    'rFGGGFr',
    'rLFGFFr',
    'rLGgGFr',
    'rFFbFFr',
    'rLFGFFr',
    'rFFFFFd',
    '.rFFFd.',
    '..rdd..',
  ];
  const lg = {
    R: [M.METAL, 4], r: [M.METAL, 3], d: [M.METAL, 1], L: [M.SHIELD, 3], F: [M.SHIELD, 2],
    G: [M.CREST, 3], g: [M.CREST, 4], b: [M.GOLD, 2],
  };
  p.tpl(T(rows, lg), x0, y0);
  // the field darkens toward its right edge
  for (let y = 1; y <= 8; y++) if (p.get(x0 + 5, y0 + y) === M.SHIELD) p.set(x0 + 5, y0 + y, M.SHIELD, 1);
}

/** The tower shield seen from behind (the back view): its planks, two straps and the steel rim. */
function shieldBack(p, x0, y0) {
  const rows = [
    '.rRRRr.',
    'rWWwWWr',
    'rWsSsWr',
    'rWWwWWr',
    'rWWwWWr',
    'rWsSsWr',
    'rWWwWWr',
    'rWWwWWr',
    'rWWwWWd',
    '.rWwWd.',
    '..rdd..',
  ];
  const lg = { R: [M.METAL, 3], r: [M.METAL, 2], d: [M.METAL, 1], W: [M.WOOD, 2], w: [M.WOOD, 1], S: [M.LEATHER, 2], s: [M.LEATHER, 1] };
  p.tpl(T(rows, lg), x0, y0);
}

/**
 * The tower shield edge-on (the side views): the rim, a sliver of the field and its crest, 3 × 11 px
 * with its top-left at (x0, y0); the field toward the facing (left). A plain crest (`crest`) shows
 * the field there.
 * @param {Painter} p @param {number} x0 @param {number} y0 @param {'anchor'|'plain'|null} [crest]
 */
function shieldEdge(p, x0, y0, crest = null) {
  const rows = crest === 'plain' ? KIT.CREST_EDGE_PLAIN : ['rR.', 'LrR', 'GrR', 'GrR', 'LrR', 'FrR', 'brR', 'FrR', 'FrR', 'Frd', '.d.'];
  const lg = { R: [M.METAL, 3], r: [M.METAL, 2], d: [M.METAL, 1], L: [M.SHIELD, 3], F: [M.SHIELD, 2], G: [M.CREST, 3], b: [M.GOLD, 2] };
  p.tpl(T(rows, lg), x0, y0);
}

/**
 * The flanged mace hanging from the hand at (hx, hy) (the plain poses): the grip in the fist, the haft
 * down, the flanged head by the knee.
 */
function maceHanging(p, hx, hy, near = true) {
  const s = near ? 1 : 0;
  p.set(hx, hy + 1, M.LEATHER, 1 + s);
  p.set(hx, hy + 2, M.WOOD, 1 + s);
  p.set(hx, hy + 3, M.WOOD, 1 + s);
  p.set(hx, hy + 4, M.METAL, 3 + s);
  p.set(hx - 1, hy + 5, M.METAL, 3 + s); p.set(hx, hy + 5, M.METAL, 2 + s); p.set(hx + 1, hy + 5, M.METAL, 1 + s);
  p.set(hx, hy + 6, M.METAL, 1 + s);
  p.set(hx, hy, M.METAL, 3); // the pommel above the fist
}

/**
 * The greatshield's gear in the plain poses (front / back views): the tower shield on the left arm
 * (screen-right in front, its back on screen-left behind), the mace in the right hand.
 */
function drawGreatshieldFront(p, c, pose, back, handY) {
  const r = c.rig;
  const wx = back ? r.cx + r.half : r.cx - r.half - 2; // the weapon (right) hand's column
  const ox = back ? r.cx - r.half - 2 : r.cx + r.half; // the off (left) hand's column
  p.begin('all', 0);
  maceHanging(p, wx, handY(back ? 1 : 0));
  p.end();
  p.begin('all', 0);
  const sy = r.armTop + pose.bob + pose.br - 1;
  if (back) shieldBack(p, ox - 4, sy);
  else shieldFace(p, ox - 1, sy, crestOf(c));
  p.end();
}

/** The greatshield's gear in the plain side poses: the shield before the body facing left (behind it mirrored), the mace in the right hand. */
function drawGreatshieldSide(p, c, pose, far, hand, layer) {
  const r = c.rig;
  const sy = r.armTop + pose.bob + pose.br - 1;
  if (layer === 'shield' && !far) {
    // the near (left) arm carries it before the body
    p.begin('all', 0);
    shieldEdge(p, r.cx - 6, sy, crestOf(c));
    p.end();
  } else if (layer === 'shield' && far) {
    p.begin(null);
    shieldEdge(p, r.cx + 1, sy, crestOf(c));
    p.end();
  } else if (layer === 'mace' && hand) {
    p.begin('all', 0);
    maceHanging(p, hand[0], hand[1], far);
    p.end();
  }
}

function drawSwordFront(p, c, pose, x, y) {
  // sheathed at the hip: hilt up, scabbard down-out (combat poses draw the sword: the empty scabbard stays)
  p.begin('sides', 0);
  if (!pose.act) {
    p.set(x, y - 2, M.GOLD, 4);
    p.set(x - 1, y - 1, M.GOLD, 3); p.set(x, y - 1, M.LEATHER, 2); p.set(x + 1, y - 1, M.GOLD, 2);
  } else p.set(x, y - 1, M.GOLD, 2);
  for (let i = 0; i < 6; i++) p.set(x + (i > 3 ? 1 : 0), y + i, M.LEATHER, i === 5 ? 1 : 2);
  p.set(x + 1, y + 5, M.METAL, 3);
  p.end();
}

function drawBackGear(p, c, pose, view) {
  // items worn on the back, drawn behind the body in the front view / on top in the back view
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  const front = view === 'down';
  if (c.gear.pack && front) {
    // pack behind the body: only its sides and the bedroll strapped on top peek out
    p.begin(null);
    const w = r.half + 4;
    const py = top - 5;
    for (let y = py + 2; y <= top + 8; y++) {
      p.set(r.cx - w, y, M.PACK, 3); p.set(r.cx - w + 1, y, M.PACK, 2);
      p.set(r.cx + w - 2, y, M.PACK, 1); p.set(r.cx + w - 1, y, M.PACK, 1);
    }
    for (let x = r.cx - w; x <= r.cx + w - 1; x++) p.set(x, top + 8, M.PACK, 0);
    // bedroll (rolled blanket) across the top, sticking out on both sides of the head
    for (let x = r.cx - w - 1; x <= r.cx + w; x++) {
      const e = x === r.cx - w - 1 || x === r.cx + w;
      p.set(x, py, M.CAPE, e ? 2 : 3);
      p.set(x, py + 1, M.CAPE, e ? 1 : x < r.cx ? 3 : 2);
      p.set(x, py + 2, M.CAPE, e ? 0 : 1);
    }
    p.set(r.cx - w - 1, py + 1, M.CAPEIN, 2); p.set(r.cx + w, py + 1, M.CAPEIN, 1);
    p.set(r.cx - w + 2, py, M.LEATHER, 2); p.set(r.cx - w + 2, py + 1, M.LEATHER, 1); p.set(r.cx - w + 2, py + 2, M.LEATHER, 0);
    p.set(r.cx + w - 3, py, M.LEATHER, 2); p.set(r.cx + w - 3, py + 1, M.LEATHER, 1); p.set(r.cx + w - 3, py + 2, M.LEATHER, 0);
    p.end();
  }
  if (c.gear.pack && !front) {
    p.begin(front ? null : 'all', 0);
    const w = r.half + 3;
    const py = top - 4;
    for (let y = py; y <= top + 9; y++) {
      for (let x = r.cx - w; x <= r.cx + w - 1; x++) {
        let s = colShade(x - (r.cx - w), 2 * w);
        if (y === top + 9) s = 1;
        p.set(x, y, M.PACK, s);
      }
    }
    // bedroll on top
    for (let x = r.cx - w - 1; x <= r.cx + w; x++) {
      p.set(x, py - 1, M.CAPE, 3); p.set(x, py - 2, M.CAPE, x < r.cx ? 3 : 2); p.set(x, py, M.CAPE, 1);
    }
    p.set(r.cx - w - 1, py - 2, M.CAPE, 1); p.set(r.cx + w, py - 1, M.CAPE, 0);
    if (!front) {
      // straps, flap & buckle
      for (let x = r.cx - w + 1; x <= r.cx + w - 2; x++) p.set(x, py + 4, M.LEATHER, 2);
      for (let y = py + 1; y <= py + 4; y++) { p.set(r.cx - w + 1, y, M.PACK, 1); p.set(r.cx + w - 2, y, M.PACK, 1); }
      p.set(r.cx - 1, py + 4, M.GOLD, 4); p.set(r.cx, py + 4, M.GOLD, 2);
      for (let y = py + 6; y <= top + 7; y++) { p.set(r.cx - 3, y, M.LEATHER, 2); p.set(r.cx + 2, y, M.LEATHER, 1); }
      // pot hanging on the side
      p.set(r.cx + w, top + 3, M.METAL, 2); p.set(r.cx + w, top + 4, M.METAL, 1); p.set(r.cx + w + 1, top + 3, M.METAL, 1); p.set(r.cx + w + 1, top + 4, M.METAL, 0);
    }
    p.end();
  }
  if (c.gear.quiver) {
    p.begin(front ? null : 'all', 1);
    const qx = front ? r.cx + r.half : r.cx + 2;
    for (let i = 0; i < 9; i++) {
      const x = qx - Math.floor(i / 3) + (front ? 0 : 0);
      const y = top - 3 + i;
      p.set(x, y, M.LEATHER, 2); p.set(x + 1, y, M.LEATHER, 1);
    }
    // fletching
    p.set(qx, top - 4, M.WHITE, 3); p.set(qx + 1, top - 5, M.WHITE, 4); p.set(qx + 2, top - 4, M.SCARF, 3); p.set(qx + 1, top - 4, M.SCARF, 2);
    p.end();
  }
  if (c.weapon === 'bow' && !pose.act) {
    p.begin(front ? null : 'all', 1);
    // bow slung diagonally across the back
    const bx = front ? r.cx - r.half - 2 : r.cx - r.half;
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = bx + Math.round(t * (r.half * 2 + 2) + Math.sin(t * Math.PI) * -2);
      const y = top - 3 + Math.round(t * 12);
      pts.push([x, y]);
    }
    for (const [x, y] of pts) p.set(x, y, M.WOOD, 3);
    if (!front) for (let i = 0; i <= 12; i++) p.set(bx + 1 + Math.round((i / 12) * (r.half * 2)), top - 2 + i, M.STRING, 3);
    p.end();
  }
  if (c.weapon === 'lute') {
    p.begin(front ? null : 'all', 1);
    if (front) {
      // neck peeking above the right shoulder
      const x = r.cx + r.half + 1;
      for (let i = 0; i < 5; i++) p.set(x - Math.floor(i / 3), top - 4 + i, M.WOOD, 2);
      p.set(x, top - 5, M.WOOD, 1); p.set(x + 1, top - 5, M.WOOD, 1);
    } else {
      const lx = r.cx - 2;
      const ly = top + 3;
      // body (bowl) seen from the back
      const body = [
        '.3332.',
        '344332',
        '343332',
        '343322',
        '.3322.',
        '..22..',
      ];
      p.tpl(T(body, { 2: [M.WOOD, 1], 3: [M.WOOD, 2], 4: [M.WOOD, 3] }), lx - 1, ly);
      for (let i = 1; i <= 6; i++) p.set(lx + 3 + Math.floor(i / 2), ly - i, M.WOOD, 2);
      p.set(lx + 6, ly - 7, M.WOOD, 1); p.set(lx + 7, ly - 7, M.WOOD, 1);
      // strap
      for (let i = 0; i < 7; i++) p.set(r.cx - r.half + i, top + i, M.LEATHER, 2);
    }
    p.end();
  }
}

function satchelFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  p.begin(null);
  // diagonal strap: right shoulder (screen-left in front view) → left hip (hidden under a cloak)
  const n = r.waist - r.torsoTop;
  const hidden = !back && c.cape && c.cape.style === 'cloak';
  for (let i = 0; i <= n && !hidden; i++) {
    const x = back ? r.cx + r.half - 1 - Math.round(i * (r.half * 2 - 1) / n) : r.cx - r.half + Math.round(i * (r.half * 2 - 1) / n);
    p.set(x, top + i, M.LEATHER, 1);
  }
  p.end();
  // bag on the hip (screen-right in front, screen-left behind)
  p.begin('all', 0);
  const bx = back ? r.cx - r.half - 1 : r.cx + r.half - 1;
  const by = r.waist + up + 1;
  // leather bag: lit flap with a brass buckle over a shaded pouch
  const rows = back ? ['.4443', '43332', '33322', '.222.'] : ['4443.', '34g32', '33322', '.222.'];
  p.tpl(T(rows, { 2: [M.LEATHER, 1], 3: [M.LEATHER, 2], 4: [M.LEATHER, 3], g: [M.GOLD, 4] }), bx - 1, by);
  p.end();
}

function scarfFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  const lag = lagOf(pose);
  p.begin('below', 0);
  for (let x = r.cx - r.half; x <= r.cx + r.half - 1; x++) {
    const i = x - (r.cx - r.half);
    p.set(x, top, M.SCARF, i < 2 ? 3 : i > 2 * r.half - 3 ? 1 : 2);
    p.set(x, top - 1, M.SCARF, i < 2 ? 4 : i > 2 * r.half - 3 ? 2 : 3);
  }
  if (!back) {
    // knot + tail hanging down the chest (right side)
    const kx = r.cx + 1;
    p.set(kx, top + 1, M.SCARF, 2); p.set(kx + 1, top + 1, M.SCARF, 1);
    for (let i = 2; i <= 5; i++) p.set(kx + 1 + (i > 3 ? lag.sway > 0 ? 1 : 0 : 0), top + i, M.SCARF, i === 5 ? 1 : 2);
  } else {
    // knot at the nape + two tails hanging down the back, tips swaying with a 1-frame lag
    p.set(r.cx - 2, top + 1, M.SCARF, 3); p.set(r.cx - 1, top + 1, M.SCARF, 3); p.set(r.cx, top + 1, M.SCARF, 2);
    const n = 6 + lag.dy;
    for (let i = 2; i <= n; i++) {
      const sw = i >= n - 1 ? lag.sway : 0;
      const xa = r.cx - 2 + sw;
      p.set(xa, top + i, M.SCARF, 3); p.set(xa + 1, top + i, M.SCARF, i === n ? 1 : 2);
      if (i <= n - 2) p.set(xa + 2, top + i, M.SCARF, 1);
    }
  }
  p.end();
}

function sashesFront(p, c, pose, back) {
  // dancer's flowing sashes from the hips
  const r = c.rig;
  const up = pose.bob;
  const lag = lagOf(pose);
  const y0 = r.waist + up;
  p.begin(null);
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const x0 = side < 0 ? r.cx - r.half - 1 : r.cx + r.half;
    for (let i = 0; i < 7 + lag.dy; i++) {
      const drift = Math.floor(i / 3) * side + (i > 3 ? lag.sway : 0);
      p.set(x0 + drift, y0 + i, M.GOLD, k === 0 ? 3 : 2);
    }
  }
  p.end();
}

// ---------------------------------------------------------------------------
// Head assembly (all views)
// ---------------------------------------------------------------------------

function drawHeadFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const hx = r.cx - 6;
  const hy = r.headY + up;
  const view = back ? 'up' : 'down';
  const lag = lagOf(pose);

  // back hair layer (long hair behind shoulders) is drawn earlier in drawFront
  p.begin(null);
  p.tpl(HEAD[view], hx, hy);
  p.end();
  if (!back) {
    p.begin(null);
    faceDown(p, c, hx, hy, pose);
    p.end();
  }
  // hair
  const hat = c.hat;
  const hs = HAIR[c.hairStyle][view];
  if (hat !== 'hood') {
    p.begin(back ? null : 'below', 1);
    tplSway(p, hs.front, hx, hy, hs.swayFrom, lag.sway, Math.max(0, lag.dy));
    p.end();
    // ponytail
    if (c.hairStyle === 'ponytail') ponytailFront(p, c, hx, hy, lag, back);
  } else if (!back) {
    // bangs peeking out of the hood
    p.begin('below', 1);
    p.tpl(T(['.33432332.', '..3.3..2..'], HAIR_L), hx + 1, hy + 3);
    p.end();
  }
  if (c.beard && !back) {
    p.begin(null);
    p.tpl(BEARDS[c.beard].down, hx, hy);
    p.end();
  }
  if (c.ears === 'pointed' && hat !== 'hood' && hat !== 'helmet' && hat !== 'greathelm') pointedEarsFront(p, hx, hy, back);
  if (hat !== 'none' && HATS[hat]) {
    p.begin(hat === 'wide' || hat === 'cap' ? 'below' : hat === 'circlet' ? null : 'below', 1);
    p.tpl(HATS[hat][view], hx, hy, hatLegend(c, HATS[hat][view]));
    p.end();
  }
  if (hat === 'hood' && c.hoodTrim) KIT.hoodTrim(p, hx, hy, view);
  if (hat === 'hood' && c.feather) hoodFeathers(p, hx, hy, view);
}

/** Hat legend without the feather unless the spec asks for one. */
function hatLegend(c, t) {
  if (c.feather) return null;
  return { ...t.legend, f: null, F: null, e: null };
}

function ponytailFront(p, c, hx, hy, lag, back) {
  if (back) {
    // gathered tail hanging down the centre of the back, outlined so it reads over dark hair
    p.begin('all', 0);
    const x = hx + 5;
    const n = 12 + lag.dy;
    for (let i = 3; i <= n; i++) {
      const sx = x + (i > 8 ? lag.sway : 0);
      const w = i > n - 2 ? 1 : 2;
      const lit = i % 3 !== 0;
      p.set(sx, hy + i, M.HAIR, lit ? 3 : 2);
      if (w > 1) p.set(sx + 1, hy + i, M.HAIR, lit ? 2 : 1);
      if (i > 4 && i < n - 2) p.set(sx - 1, hy + i, M.HAIR, 2);
    }
    p.end();
    p.begin(null);
    p.set(x - 1, hy + 3, M.ACCENT, 3); p.set(x, hy + 3, M.ACCENT, 4); p.set(x + 1, hy + 3, M.ACCENT, 2); // hair tie
    p.end();
    return;
  }
  p.begin(null);
  {
    // tail swinging out behind the head, visible on the right
    const x = hx + 11;
    for (let i = 0; i < 7 + lag.dy; i++) {
      const sx = x + (i > 2 ? 1 : 0) + (i > 4 ? lag.sway : 0);
      p.set(sx, hy + 1 + i, M.HAIR, i < 3 ? 2 : 1);
      if (i > 1 && i < 6) p.set(sx + 1, hy + 1 + i, M.HAIR, 1);
    }
  }
  p.end();
}

/** Full front (down) or back (up) view. */
function drawFront(p, c, pose, back) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  // combat poses: arm / weapon layout for this view and the upper-body lean (legs stay planted)
  const act = pose.act ? combatLayout(c, pose, back ? 'up' : 'down') : null;
  if (act) leanOn(p, act);
  // behind everything
  if (!back) {
    if (c.cape) capeFrontBack(p, c, pose);
    drawBackGear(p, c, pose, 'down');
    if (HAIR[c.hairStyle].down.back && c.hat !== 'hood') {
      p.begin(null);
      p.tpl(HAIR[c.hairStyle].down.back, r.cx - 6, r.headY + up);
      p.end();
    }
  }
  // pole weapon held in the far hand in the back view → drawn before the body
  const poleKind = POLE_KINDS.includes(c.weapon) ? c.weapon : null;
  const swing = armSwingFront(pose);
  const handY = (k) => r.armTop + up + r.armLen + (back ? -swing[k] : swing[k]);
  if (poleKind && back && !act) drawPole(p, c, r.cx + r.half + 2, handY(1), poleKind);
  if (act) combatArms(p, c, act, 'behind');

  if (act) leanOff(p);
  legsFront(p, c, pose, back);
  if (act) leanOn(p, act);
  torsoFront(p, c, pose, back);
  if (c.gear.beads) beadsFront(p, c, pose, back);
  if (c.gear.sashes) sashesFront(p, c, pose, back);
  if (c.gear.satchel && !c.cape) satchelFront(p, c, pose, back);
  if (c.gear.satchel && c.cape && !back) satchelFront(p, c, pose, back);
  if (c.weapon === 'sword' && !back) drawSwordFront(p, c, pose, r.cx + r.half + 1, r.waist + up + 1);
  if (c.weapon === 'sword' && back) drawSwordFront(p, c, pose, r.cx - r.half - 2, r.waist + up + 1);
  if (act) combatArms(p, c, act, 'under');
  else armsFront(p, c, pose, back);
  if (c.weapon === 'greatshield' && !act) drawGreatshieldFront(p, c, pose, back, handY);
  if (c.weapon === 'hammer' && !act) KIT.hammerFront(p, c, back, handY);
  if (c.gear.book && !back && !act) {
    p.begin('all', 1);
    const bx = r.cx - r.half - 3, by = handY(0) - 2;
    p.tpl(T(['2332', '3443', '3443', '2332', '1221'], { 1: [M.BOOK, 0], 2: [M.BOOK, 1], 3: [M.BOOK, 2], 4: [M.WHITE, 3] }), bx, by);
    p.set(bx + 2, by + 2, M.SKIN, 2); p.set(bx + 3, by + 2, M.SKIN, 1);
    p.end();
  }
  if (poleKind && !back && !act) drawPole(p, c, r.cx - r.half - 3, handY(0), poleKind);
  if (poleKind && !back && !act) { p.begin(null); p.set(r.cx - r.half - 4, handY(0), M.SKIN, 3); p.set(r.cx - r.half - 2, handY(0), M.SKIN, 2); p.set(r.cx - r.half - 3, handY(0) + 1, M.SKIN, 1); p.end(); }
  if (c.gear.scarf && !back) scarfFront(p, c, pose, false);
  if (c.cape && !back) capeFrontMantle(p, c, pose);
  drawHeadFront(p, c, pose, back);
  if (isStaff(poleKind) && !act) {
    // keep the staff ornament readable over long hair / hoods beside the head
    const k = back ? 1 : 0;
    const sx = back ? r.cx + r.half + 2 : r.cx - r.half - 3;
    p.begin(null);
    staffTop(p, c, sx, poleTopY(poleKind, handY(k)), poleKind);
    p.end();
  }
  if (back) {
    if (c.cape) capeBackView(p, c, pose);
    drawBackGear(p, c, pose, 'up');
    if (c.gear.scarf) scarfFront(p, c, pose, true);
  }
  if (act) combatArms(p, c, act, 'over');
}

// ---------------------------------------------------------------------------
// SIDE view (facing left; right = mirrored with gear moved to the far side)
// ---------------------------------------------------------------------------

/**
 * Leg joints for the side view (facing left): [near, far] with x offsets (negative = forward) of
 * knee and ankle relative to the hip, `lift` (foot raised px) and `tip` (only the toe touches).
 */
function sideLegs(pose, child) {
  const s = child ? 0.67 : 1;
  const L = (knee, ankle, lift = 0, tip = false) => ({ knee: Math.round(knee * s), ankle: Math.round(ankle * s), lift: Math.round(lift * s), tip });
  if (pose.act) return combatSideLegs(pose, L);
  switch (pose.walk) {
    case 0: return [L(-2, -3), L(1, 3, 0, true)];          // contact: near leg forward
    case 1: return [L(0, 0), L(-2, -1, 2)];                 // passing: far leg swings through, knee bent
    case 2: return [L(1, 3, 0, true), L(-2, -3)];          // contact: far leg forward
    case 3: return [L(-2, -1, 2), L(0, 0)];                 // passing: near leg swings through
    default: return [L(-1, -1), L(1, 1)];
  }
}

function drawSideLeg(p, c, pose, leg, far) {
  const r = c.rig;
  const hip = r.hip + pose.bob;
  const ankleY = r.ground - leg.lift - (r.bootH - 1);
  const footY = r.ground - leg.lift;
  const kneeY = Math.round((hip + ankleY) / 2);
  const hx = r.cx - (r.child ? 1 : 2) + (far ? 1 : 0); // hip column
  const w = r.child ? 2 : 3;
  const dk = far ? -1 : 0;
  p.begin(far ? null : 'sides', 0);
  for (let y = hip; y < ankleY; y++) {
    let off;
    if (y <= kneeY) off = Math.round(leg.knee * ((y - hip) / Math.max(1, kneeY - hip)));
    else off = Math.round(leg.knee + (leg.ankle - leg.knee) * ((y - kneeY) / Math.max(1, ankleY - kneeY)));
    const ww = y <= kneeY ? w : Math.max(2, w - 1);
    for (let i = 0; i < ww; i++) {
      let s = colShade(i, ww) + dk;
      if (y === hip) s = Math.min(s, 1 + dk);
      p.set(hx + off + i, y, M.BOTTOM, Math.max(0, s));
    }
  }
  // boot: ankle rows + sole with the toe pointing forward
  const ax = hx + leg.ankle;
  for (let y = ankleY; y <= footY; y++) {
    const sole = y === footY;
    const bw = r.child ? 2 : 3;
    for (let i = 0; i < bw; i++) {
      let s = sole ? (i === 0 ? 2 : 1) : colShade(i, bw);
      p.set(ax + i - (sole && !leg.tip ? 1 : 0), y, M.BOOT, Math.max(0, s + dk));
    }
    if (!sole && !r.child) p.set(ax, y, M.BOOT, Math.max(0, 3 + dk)); // cuff highlight
  }
  if (leg.tip) {
    // heel lifted: shift the sole back and leave only the toe down
    p.set(ax + (r.child ? 2 : 3), footY - 1, M.BOOT, Math.max(0, 1 + dk));
  }
  p.end();
}

function sideArm(p, c, pose, near, swingX) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const sx = r.cx - 1; // shoulder column
  const sy = r.armTop + up;
  const len = r.armLen;
  const style = c.outfit.style;
  const sleeve = style === 'vest' || style === 'overalls' ? M.SHIRT : style === 'tabard' ? M.METAL : style === 'dancer' ? M.SKIN : M.TOP;
  p.begin(near ? 'all' : null, 1);
  for (let i = 0; i < len; i++) {
    const t = i / Math.max(1, len - 1);
    const x = sx + Math.round(swingX * t);
    let s1 = near ? 3 : 1, s2 = near ? 2 : 0;
    if (sleeve === M.SKIN) { s1 = near ? 3 : 1; s2 = near ? 2 : 1; }
    p.set(x, sy + i, sleeve, s1);
    p.set(x + 1, sy + i, sleeve, s2);
    if (style === 'robe' && i >= len - 2) p.set(x + (swingX > 0 ? 2 : -1), sy + i, M.TOP, near ? 2 : 0);
  }
  const hx = sx + swingX;
  const hy = sy + len;
  if (style === 'robe') { p.set(hx, hy - 1, M.ACCENT, near ? 3 : 1); p.set(hx + 1, hy - 1, M.ACCENT, near ? 2 : 1); }
  if (c.gear.bracers && !r.child) { p.set(hx, hy - 1, M.METAL, near ? 3 : 1); p.set(hx + 1, hy - 1, M.METAL, near ? 2 : 1); }
  if (style === 'dancer') { p.set(hx, hy - 1, M.GOLD, near ? 3 : 1); p.set(hx + 1, hy - 1, M.GOLD, near ? 2 : 1); }
  const handM = c.gear.gloves ? M.LEATHER : M.SKIN;
  p.set(hx, hy, handM, near ? 3 : 1); p.set(hx + 1, hy, handM, near ? 2 : 1);
  if (!r.child) p.set(hx + (swingX < 0 ? 0 : 1), hy + 1, handM, near ? 1 : 0);
  p.end();
  return [hx, hy];
}

function torsoSide(p, c, pose) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  const waist = r.waist + up;
  const hem = r.hem + pose.bob;
  const style = c.outfit.style;
  const lag = lagOf(pose);
  const L = r.cx - (r.child ? 3 : 4) + 1, R = r.cx + (r.child ? 2 : 3) - (r.half >= 5 ? -1 : 0);
  p.begin(null);
  for (let y = top; y < waist; y++) {
    const inset = y === top ? 1 : 0;
    for (let x = L + inset; x <= R - inset; x++) {
      let s = colShade(x - L, R - L + 1);
      if (y === top) s = Math.min(s, 1);
      p.set(x, y, M.TOP, s);
    }
  }
  if (style === 'robe' || style === 'dress' || style === 'dancer') {
    const bottom = (style === 'dancer' ? r.ground - 1 : r.robeHem) + pose.bob;
    const mat = style === 'robe' ? M.TOP : M.BOTTOM;
    for (let y = waist; y <= bottom; y++) {
      const t = (y - waist) / Math.max(1, bottom - waist);
      const fl = Math.round(t * 1.5);
      const trail = y >= bottom - 2 && pose.walk >= 0 ? lag.trail - 1 : 0;
      const xl = L - fl + (y >= bottom - 1 && pose.walk >= 0 ? 1 : 0);
      const xr = R + fl + trail;
      for (let x = xl; x <= xr; x++) {
        let s = colShade(x - xl, xr - xl + 1);
        if (y > waist + 1 && x === r.cx) s = Math.max(1, s - 1);
        if (y === bottom) s = Math.max(0, s - 1);
        p.set(x, y, mat, s);
      }
    }
  } else {
    for (let y = waist; y <= hem; y++) {
      const xl = L - (y === hem ? 1 : 0);
      const xr = R + (y >= hem - 1 ? 1 : 0) + (y === hem && pose.walk >= 0 ? 0 : 0);
      const mat = style === 'overalls' ? M.BOTTOM : M.TOP;
      for (let x = xl; x <= xr; x++) {
        let s = colShade(x - xl, xr - xl + 1);
        if (y === hem) s = Math.max(1, s - 1);
        p.set(x, y, mat, s);
      }
    }
  }
  p.end();
  // details
  if (style === 'tunic' || style === 'vest' || style === 'tabard') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.BELT, x === L ? 3 : x === R ? 1 : 2);
    p.set(L, waist, M.GOLD, 3);
  } else if (style === 'robe') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.SASH, x === L ? 3 : x === R ? 1 : 2);
    p.set(R + 1, waist + 1, M.SASH, 1); p.set(R + 1, waist + 2, M.SASH, 1);
    for (let y = top + 1; y <= r.robeHem + pose.bob; y++) if (y !== waist) p.set(L - (y > waist + 2 ? 1 : 0), y, M.ACCENT, 3);
  } else if (style === 'dress') {
    for (let x = L; x <= R; x++) p.set(x, waist, M.ACCENT, 2);
    p.set(R + 1, waist, M.ACCENT, 1); p.set(R + 2, waist + 1, M.ACCENT, 1);
  } else if (style === 'dancer') {
    for (let x = L; x <= R; x++) p.set(x, waist - 1, M.SKIN, x === L ? 3 : 2);
    for (let x = L; x <= R; x++) p.set(x, waist - 2, M.GOLD, 3);
    for (let x = L - 1; x <= R + 1; x++) p.set(x, waist, M.GOLD, 3);
  } else if (style === 'overalls') {
    for (let y = top + 2; y < waist; y++) { p.set(L, y, M.BOTTOM, 3); p.set(L + 1, y, M.BOTTOM, 2); }
    p.set(L + 2, top, M.BOTTOM, 2); p.set(L + 2, top + 1, M.BOTTOM, 2);
    p.set(L + 1, top + 2, M.GOLD, 3);
  }
  if (style === 'tabard') {
    for (let y = top; y <= hem + 1; y++) { p.set(L, y, M.TOP, 3); p.set(L + 1, y, M.TOP, 2); }
    for (let y = top + 1; y < waist; y++) for (let x = L + 2; x <= R; x++) p.set(x, y, M.METAL, ((x + y) & 1) ? 1 : 2);
  }
  if (c.gear.apron) {
    for (let y = top + 1; y <= (style === 'dress' ? r.robeHem - 1 : hem) + pose.bob; y++) {
      p.set(L - (y > waist + 1 ? 1 : 0), y, M.WHITE, 3);
      if (y > waist) p.set(L - (y > waist + 1 ? 0 : -1), y, M.WHITE, 2);
    }
  }
  return { L, R, top, waist };
}

function drawSide(p, c, pose, far) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const lag = lagOf(pose);
  const legs = sideLegs(pose, r.child);
  // arm swing: opposite to legs
  let armSwing = 0;
  const amp = r.child ? 2 : 3;
  if (pose.walk === 0) armSwing = amp;
  if (pose.walk === 2) armSwing = -amp;
  if (pose.walk === 1 || pose.walk === 3) armSwing = 0;
  const hx = r.cx - 6;
  const hy = r.headY + up;
  const poleKind = POLE_KINDS.includes(c.weapon) ? c.weapon : null;
  // combat poses: arm / weapon layout (weapon hand = far hand facing left, near hand when mirrored)
  const act = pose.act ? combatLayout(c, pose, far ? 'right' : 'left') : null;
  if (act) leanOn(p, act);

  // --- far layer ---
  if (c.cape) capeSide(p, c, pose, 'back');
  if (c.hairStyle === 'long' && c.hat !== 'hood') { /* included in front template */ }
  // a pole carrier keeps that hand forward, swinging only a little
  const poleSwing = (sw) => -2 - Math.sign(sw);
  let poleTip = null;
  if (act) combatArms(p, c, act, 'behind');
  else {
    const farHand = sideArm(p, c, pose, false, poleKind && !far ? poleSwing(-armSwing) : -armSwing);
    // pole held in the right hand: far hand when facing left (unless mirrored → near)
    if (poleKind && !far) poleTip = drawPoleSide(p, c, farHand[0] - 1, farHand[1], poleKind);
    // the greatshield: the mace in the far (right) hand facing left, the shield behind the body mirrored
    if (c.weapon === 'greatshield') drawGreatshieldSide(p, c, pose, far, far ? null : farHand, far ? 'shield' : 'mace');
    // the hammer in the far (right) hand facing left (mirrored: the near hand, below)
    if (c.weapon === 'hammer' && !far) KIT.hammerHanging(p, farHand[0], farHand[1], true, false);
  }
  if (act) leanOff(p);
  drawSideLeg(p, c, pose, legs[1], true);
  // back gear
  if (act) leanOn(p, act);
  sideBackGear(p, c, pose);
  if (act) leanOff(p);
  drawSideLeg(p, c, pose, legs[0], false);
  if (act) leanOn(p, act);
  const tor = torsoSide(p, c, pose);
  if (c.gear.beads) beadsSide(p, c, pose, tor);
  if (c.gear.sashes) {
    p.begin(null);
    for (let i = 0; i < 7 + lag.dy; i++) p.set(tor.R + 1 + Math.floor(i / 2) + (pose.walk >= 0 ? Math.floor(i / 3) : 0), r.waist + pose.bob + i, M.GOLD, 2);
    p.end();
  }
  // sword on the left hip = near side when facing left, far side when mirrored
  if (c.weapon === 'sword') swordSide(p, c, pose, far);
  if (c.gear.satchel) {
    p.begin('all', 0);
    const bx = far ? tor.R - 1 : tor.L;
    const rows = far ? ['.443', '3332', '.22.'] : ['4443', '3g32', '3322', '.22.'];
    p.tpl(T(rows, { 2: [M.LEATHER, 1], 3: [M.LEATHER, 2], 4: [M.LEATHER, 3], g: [M.GOLD, 4] }), bx, r.waist + up + 1);
    p.end();
    if (!far) { p.begin(null); for (let y = tor.top; y < r.waist + up + 1; y++) p.set(tor.L + 2 + Math.floor((y - tor.top) / 4), y, M.LEATHER, 1); p.end(); }
  }
  if (c.gear.scarf) scarfSide(p, c, pose, tor);
  if (c.gear.pauldrons && !r.child) {
    p.begin('below', 1);
    const sx = r.cx - 2, sy = r.armTop + up - 1;
    p.tpl(T(['.344.', '34432', '33221'], { 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3] }), sx, sy);
    p.end();
  }
  const nearHand = act ? combatArms(p, c, act, 'under') : sideArm(p, c, pose, true, poleKind && far ? poleSwing(armSwing) : armSwing);
  if (c.gear.pauldrons && !r.child) {
    p.begin(null);
    const sx = r.cx - 2, sy = r.armTop + up - 1;
    p.tpl(T(['.344.', '34432', '33221'], { 1: [M.METAL, 0], 2: [M.METAL, 1], 3: [M.METAL, 2], 4: [M.METAL, 3] }), sx, sy);
    p.end();
  }
  if (poleKind && far && !act) poleTip = drawPoleSide(p, c, nearHand[0] - 1, nearHand[1], poleKind, true);
  // the greatshield: its shield before the body facing left, the mace in the near hand mirrored
  if (c.weapon === 'greatshield' && !act) drawGreatshieldSide(p, c, pose, far, far ? nearHand : null, far ? 'mace' : 'shield');
  if (c.weapon === 'hammer' && far && !act) KIT.hammerHanging(p, nearHand[0], nearHand[1], true, true);
  if (c.gear.book && !act) {
    p.begin('all', 1);
    p.tpl(T(['233', '343', '343', '221'], { 1: [M.BOOK, 0], 2: [M.BOOK, 1], 3: [M.BOOK, 2], 4: [M.WHITE, 3] }), nearHand[0] - 2, nearHand[1] - 3);
    p.set(nearHand[0], nearHand[1], M.SKIN, 3);
    p.end();
  }
  if (c.cape) capeSide(p, c, pose, 'front');
  // head
  p.begin(null);
  p.tpl(HEAD.side, hx, hy);
  faceSide(p, c, hx, hy, pose);
  p.end();
  if (c.hat !== 'hood') {
    p.begin('below', 1);
    const hsd = HAIR[c.hairStyle].side;
    tplSway(p, hsd.front, hx, hy, hsd.swayFrom, pose.walk >= 0 ? lag.trail - 1 : 0, Math.max(0, lag.dy));
    p.end();
    if (c.hairStyle === 'ponytail') {
      p.begin(null);
      const tx = hx + 11, ty = hy + 1;
      p.set(tx, ty, M.SCARF, 3);
      for (let i = 1; i < 9 + lag.dy; i++) {
        const sx = tx + 1 + Math.floor(i / 3) + (pose.walk >= 0 && i > 3 ? lag.trail - 1 : 0);
        p.set(sx, ty + i, M.HAIR, i % 3 === 1 ? 3 : 2);
        if (i < 7) p.set(sx - 1, ty + i, M.HAIR, 3);
        if (i > 2 && i < 6) p.set(sx + 1, ty + i, M.HAIR, 1);
      }
      p.end();
    }
  } else {
    p.begin('below', 1);
    p.tpl(T(['3432', '3.3.'], HAIR_L), hx + 1, hy + 3);
    p.end();
  }
  if (c.beard) {
    p.begin(null);
    p.tpl(BEARDS[c.beard].side, hx, hy);
    p.end();
  }
  if (c.ears === 'pointed' && c.hat !== 'hood' && c.hat !== 'helmet' && c.hat !== 'greathelm') pointedEarSide(p, hx, hy);
  if (c.hat !== 'none' && HATS[c.hat]) {
    p.begin(c.hat === 'circlet' ? null : 'below', 1);
    p.tpl(HATS[c.hat].side, hx, hy, hatLegend(c, HATS[c.hat].side));
    p.end();
  }
  if (c.hat === 'hood' && c.hoodTrim) KIT.hoodTrim(p, hx, hy, 'side');
  if (c.hat === 'hood' && c.feather) hoodFeathers(p, hx, hy, 'side');
  // the staff ornament reads in front of the hair (it is held forward of the face)
  if (poleTip && isStaff(poleKind)) {
    p.begin(null);
    staffTop(p, c, poleTip.x, poleTip.y, poleKind);
    p.end();
  }
  if (c.weapon === 'lute') {
    // lute on the back, neck over the shoulder
    p.begin('all', 1);
    const lx = r.cx + 3, ly = r.torsoTop + up + 2;
    p.tpl(T(['.33.', '3432', '3432', '3322', '.22.'], { 2: [M.WOOD, 1], 3: [M.WOOD, 2], 4: [M.WOOD, 3] }), lx, ly);
    for (let i = 1; i <= 5; i++) p.set(lx + 1 - Math.floor(i / 3), ly - i, M.WOOD, 2);
    p.end();
  }
  if (act) combatArms(p, c, act, 'over');
}

/**
 * Pole weapon in the side view, gripped at (x, hy). A staff leans slightly forward (toward -x) so its
 * ornament sits in front of the face instead of behind the hair.
 * @returns {{x:number, y:number}} where the pole's top ornament was drawn (for re-stamping over the head)
 */
function drawPoleSide(p, c, x, hy, kind, nearHand = false) {
  const r = c.rig;
  const top = poleTopY(kind, hy);
  const lean = isStaff(kind) ? STAFF_LEAN : 0;
  const px = (y) => x - Math.round((hy - y) * lean);
  const mat = poleMat(kind);
  p.begin(null);
  for (let y = top; y <= r.ground; y++) p.set(px(y), y, mat, nearHand ? 3 : 2);
  if (kind === 'cane') {
    p.set(x, top, M.WOOD, 3); p.set(x - 1, top - 1, M.WOOD, 3); p.set(x - 2, top - 1, M.WOOD, 2); p.set(x - 3, top, M.WOOD, 1);
  } else staffTop(p, c, px(top), top, kind);
  p.end();
  return { x: px(top), y: top };
}

function swordSide(p, c, pose, far) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const y = r.waist + up;
  p.begin(far ? null : 'all', 0);
  // hilt forward-up, scabbard back-down (combat poses draw the sword: the empty scabbard stays)
  const x = r.cx - 4;
  if (!pose.act) {
    p.set(x - 1, y - 2, M.GOLD, 4);
    p.set(x, y - 1, M.LEATHER, 2);
  }
  p.set(x + 1, y - 1, M.GOLD, 3); p.set(x + 1, y, M.GOLD, 2);
  if (!pose.act) p.set(x + 1, y - 2, M.GOLD, 3);
  for (let i = 0; i < 9; i++) {
    const sx = x + 2 + i;
    const sy = y + Math.floor(i / 2.5);
    p.set(sx, sy, M.LEATHER, far ? 1 : 2);
    p.set(sx, sy + 1, M.LEATHER, far ? 0 : 1);
  }
  p.set(x + 11, y + 4, M.METAL, 3);
  p.end();
}

function sideBackGear(p, c, pose) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const top = r.torsoTop + up;
  if (c.gear.pack) {
    p.begin(null);
    const x0 = r.cx + 2, py = top - 4;
    for (let y = py; y <= top + 9; y++) for (let x = x0; x <= x0 + 6; x++) p.set(x, y, M.PACK, x === x0 ? 3 : x >= x0 + 5 ? 1 : 2);
    for (let x = x0 - 1; x <= x0 + 7; x++) { p.set(x, py - 1, M.CAPE, 3); p.set(x, py - 2, M.CAPE, 2); p.set(x, py, M.CAPE, 1); }
    p.set(x0 - 1, py - 1, M.CAPE, 4); p.set(x0 - 1, py - 2, M.CAPE, 3);
    for (let y = py + 1; y <= top + 8; y++) p.set(x0 + 3, y, M.LEATHER, 1);
    p.set(x0 + 3, py + 4, M.GOLD, 4);
    p.set(x0 + 7, top + 3, M.METAL, 2); p.set(x0 + 7, top + 4, M.METAL, 1);
    p.end();
  }
  if (c.gear.quiver) {
    p.begin(null);
    const qx = r.cx + 3;
    for (let i = 0; i < 9; i++) { p.set(qx + Math.floor(i / 4), top - 2 + i, M.LEATHER, 2); p.set(qx + 1 + Math.floor(i / 4), top - 2 + i, M.LEATHER, 1); }
    p.set(qx, top - 3, M.WHITE, 4); p.set(qx - 1, top - 4, M.WHITE, 3); p.set(qx + 1, top - 3, M.SCARF, 3); p.set(qx + 1, top - 4, M.SCARF, 2);
    p.end();
  }
  if (c.weapon === 'bow' && !pose.act) {
    p.begin(null);
    const bx = r.cx + 1;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = bx + Math.round(Math.sin(t * Math.PI) * 3);
      p.set(x, top - 3 + i, M.WOOD, 3);
    }
    for (let i = 1; i < 14; i++) p.set(bx, top - 3 + i, M.STRING, 3);
    p.end();
  }
}

function scarfSide(p, c, pose, tor) {
  const r = c.rig;
  const lag = lagOf(pose);
  const y = tor.top;
  p.begin('below', 0);
  for (let x = tor.L; x <= tor.R + 1; x++) { p.set(x, y - 1, M.SCARF, x === tor.L ? 4 : 3); p.set(x, y, M.SCARF, x === tor.L ? 3 : 2); }
  // tails streaming behind
  const moving = pose.walk >= 0;
  for (let i = 0; i < 6; i++) {
    const x = tor.R + 1 + i;
    const yy = y + (moving ? Math.floor(i / 3) + ((i + lag.sway) % 2 === 0 ? 0 : 1) - 1 + (lag.dy > 0 ? 1 : 0) : i);
    const xx = moving ? x : tor.R + 1 + Math.floor(i / 3);
    p.set(xx, yy + 1, M.SCARF, i % 2 ? 1 : 2);
    if (moving && i < 4) p.set(xx, yy + 2, M.SCARF, 1);
  }
  p.end();
}

function capeSide(p, c, pose, layer) {
  const r = c.rig;
  const up = pose.bob + pose.br;
  const lag = lagOf(pose);
  const top = r.torsoTop + up;
  const moving = pose.walk >= 0;
  const short = c.cape.style === 'short';
  const bottom = (short ? top + 6 : r.robeHem - (moving ? 1 : 0)) + (moving ? lag.dy : 0);
  if (layer === 'back') {
    // body of the cape hanging down the back, trailing behind (to the right) when walking
    p.begin(null);
    for (let y = top; y <= bottom; y++) {
      const t = (y - top) / Math.max(1, bottom - top);
      const trail = moving ? Math.round(t * t * (1.5 + lag.trail)) : Math.round(t * 1.2);
      const xl = r.cx - 1 + (moving ? Math.round(t * 1) : 0);
      const xr = r.cx + 4 + trail;
      for (let x = xl; x <= xr; x++) {
        let s = x === xl ? 3 : x >= xr - 1 ? 1 : 2;
        if (y > top + 4 && x === xr - 3) s = 1; // fold
        if (y > top + 4 && x === xr - 4) s = 3;
        if (y === bottom) s = Math.max(0, s - 1);
        // lining flashes at the trailing edge while walking
        if (moving && x === xr && y > top + 3) { p.set(x, y, M.CAPEIN, 2); continue; }
        p.set(x, y, M.CAPE, s);
      }
    }
    p.end();
  } else if (c.cape.style === 'cloak') {
    p.begin('below', 1);
    p.tpl(MANTLE_SIDE, r.cx, top);
    p.end();
  } else {
    p.begin('below', 1);
    const sy = top;
    for (let x = r.cx - 3; x <= r.cx + 4; x++) { p.set(x, sy, M.CAPE, x < r.cx ? 3 : 2); p.set(x, sy + 1, M.CAPE, x < r.cx - 1 ? 3 : 1); }
    p.set(r.cx - 3, sy, M.GOLD, 4);
    p.end();
  }
}

// ---------------------------------------------------------------------------
// Spec extras used by combat enemies (absent on every existing spec → unchanged drawing)
// ---------------------------------------------------------------------------

/** Pointed ears (spec `ears: 'pointed'`, goblins): long, up-swept ears on both sides of the head (down / up views). */
function pointedEarsFront(p, hx, hy, back) {
  p.begin(null);
  // screen-left ear (lit), then the mirrored screen-right ear (shadowed); inner ear darker
  const L = [[-1, 7, 3], [-1, 6, 2], [-2, 6, 3], [-2, 5, 4], [-3, 5, 3], [-3, 4, 4], [-4, 3, 3], [0, 6, 2], [0, 7, 1]];
  for (const [dx, dy, s] of L) p.set(hx + dx, hy + dy, M.SKIN, s);
  const R = [[12, 7, 1], [12, 6, 1], [13, 6, 2], [13, 5, 2], [14, 5, 1], [14, 4, 2], [15, 3, 1], [11, 6, 1], [11, 7, 0]];
  for (const [dx, dy, s] of R) p.set(hx + dx, hy + dy, M.SKIN, s);
  if (!back) { p.set(hx - 1, hy + 6, M.SKIN, 1); p.set(hx + 12, hy + 6, M.SKIN, 0); } // ear hollows
  p.end();
}

/** Pointed ear in the side view (facing left): swept back and up from behind the cheek. */
function pointedEarSide(p, hx, hy) {
  p.begin('all', 1);
  // long ear swept back and a little up, sticking out past the back of the skull, dark hollow along it
  const E = [[13, 4, 3], [14, 4, 4], [11, 5, 3], [12, 5, 3], [13, 5, 2], [8, 6, 3], [9, 6, 3], [10, 6, 3], [11, 6, 2], [12, 6, 1],
    [7, 7, 2], [8, 7, 1], [9, 7, 1], [10, 7, 1], [7, 8, 1]];
  for (const [dx, dy, s] of E) p.set(hx + dx, hy + dy, M.SKIN, s);
  p.set(hx + 9, hy + 7, M.BLUSH, 1); p.set(hx + 10, hy + 7, M.SKIN, 0); // hollow
  p.end();
}

/** Two or three feathers stuck upright in a hood (spec `hat: 'hood'` with `feather`). */
function hoodFeathers(p, hx, hy, view) {
  // a tuft of three feathers tucked into the hood's crown, fanning back and outward; dark tips
  p.begin('all', 1);
  const F = view === 'side'
    ? [[9, -1, 3], [10, -2, 4], [11, -3, 3], [12, -4, 1], [10, -1, 2], [11, -1, 3], [12, -2, 3], [13, -2, 1], [9, -2, 2], [9, -3, 3], [9, -4, 1]]
    : view === 'up'
      ? [[4, -1, 3], [3, -2, 3], [2, -3, 1], [6, -1, 3], [6, -2, 4], [6, -3, 3], [6, -4, 1], [8, -1, 2], [9, -2, 3], [10, -3, 1]]
      : [[8, -1, 3], [9, -2, 4], [10, -3, 3], [11, -4, 1], [7, -2, 3], [7, -3, 4], [7, -4, 1], [9, -1, 2], [10, -1, 3], [11, -2, 3], [12, -2, 1]];
  for (const [dx, dy, s] of F) p.set(hx + dx, hy + dy, s === 1 ? M.SCARF : M.FEATHER, s === 1 ? 2 : s);
  p.end();
}

/** Bead necklace across the chest (spec `gear.beads`: colour; bone beads by default). */
function beadsFront(p, c, pose, back) {
  const r = c.rig;
  const top = r.torsoTop + pose.bob + pose.br;
  p.begin(null);
  const n = r.half * 2;
  for (let i = 0; i < n; i++) {
    const x = r.cx - r.half + i;
    const sag = back ? 0 : Math.min(i, n - 1 - i) >= 2 ? 1 : 0;
    p.set(x, top + sag, M.BONE, i % 2 ? 2 : 4);
  }
  if (!back) { p.set(r.cx - 1, top + 2, M.BONE, 4); p.set(r.cx, top + 2, M.BONE, 3); p.set(r.cx - 1, top + 3, M.BONE, 2); } // pendant tooth
  p.end();
}

function beadsSide(p, c, pose, tor) {
  p.begin(null);
  for (let x = tor.L; x <= tor.R; x++) p.set(x, tor.top + (x <= tor.L + 1 ? 1 : 0), M.BONE, x % 2 ? 2 : 4);
  p.set(tor.L, tor.top + 2, M.BONE, 3);
  p.end();
}

/** Angry face (spec `face: 'fierce'`): slanted brows over bright eyes, a fanged grin. */
function fierceFaceDown(p, c, hx, hy) {
  const eyeY = hy + 6;
  const eL = hx + 3, eR = hx + 8;
  p.set(eL, eyeY, M.EYE, 3); p.set(eL, eyeY + 1, M.EYE, 2); p.set(eL + 1, eyeY + 1, M.EYE, 0);
  p.set(eR, eyeY, M.EYE, 3); p.set(eR, eyeY + 1, M.EYE, 2); p.set(eR - 1, eyeY + 1, M.EYE, 0);
  // brows slanting down toward the nose
  p.set(eL - 1, eyeY - 2, M.SKIN, 0); p.set(eL, eyeY - 1, M.SKIN, 0); p.set(eL + 1, eyeY - 1, M.SKIN, 0);
  p.set(eR + 1, eyeY - 2, M.SKIN, 0); p.set(eR, eyeY - 1, M.SKIN, 0); p.set(eR - 1, eyeY - 1, M.SKIN, 0);
  // nose shadow and a wide grin with one fang
  p.set(hx + 6, hy + 8, M.SKIN, 1);
  for (let x = hx + 4; x <= hx + 7; x++) p.set(x, hy + 9, M.EYE, 0);
  p.set(hx + 5, hy + 9, M.EYE, 4);
}

function fierceFaceSide(p, c, hx, hy) {
  const eyeY = hy + 6;
  p.set(hx + 2, eyeY, M.EYE, 3); p.set(hx + 2, eyeY + 1, M.EYE, 2); p.set(hx + 3, eyeY + 1, M.EYE, 0);
  p.set(hx + 1, eyeY - 1, M.SKIN, 0); p.set(hx + 2, eyeY - 1, M.SKIN, 0); p.set(hx + 3, eyeY - 2, M.SKIN, 0);
  p.set(hx, hy + 8, M.SKIN, 1);
  p.set(hx + 1, hy + 9, M.EYE, 0); p.set(hx + 2, hy + 9, M.EYE, 0); p.set(hx + 1, hy + 10, M.EYE, 4);
}

// ---------------------------------------------------------------------------
// Combat poses (COMBAT.md §10.2): columns 6–17 of `createCharacterSheet(spec, { combat: true })`
// ---------------------------------------------------------------------------

/** Acts whose face is drawn with shut eyes and an open mouth. */
const HURT_FACE = new Set(['hurt', 'down']);

/**
 * Combat pose columns 6–17. `act` selects the arm / weapon / leg layout (every drawing branch that
 * differs from the plain poses keys on it), `phase` is the step inside a swing (0 wind-up, 1 strike,
 * 2 follow-through; −1 for non-swing poses), `lag` the secondary motion of capes, hems and hair.
 */
const COMBAT_POSES = [
  { key: 'wind', bob: 0, br: 0, walk: -1, act: 'wind', phase: 0, lag: { dy: 0, sway: -1, trail: 1 } },
  { key: 'slash', bob: 0, br: 0, walk: -1, act: 'slash', phase: 1, lag: { dy: 0, sway: 1, trail: 3 } },
  { key: 'follow', bob: 0, br: 0, walk: -1, act: 'follow', phase: 2, lag: { dy: 1, sway: 1, trail: 2 } },
  { key: 'backhand', bob: 0, br: 0, walk: -1, act: 'backhand', phase: 1, lag: { dy: 0, sway: -1, trail: 3 } },
  { key: 'thrust', bob: 1, br: 0, walk: -1, act: 'thrust', phase: 1, lag: { dy: 0, sway: 1, trail: 3 } },
  { key: 'spin', bob: 0, br: 0, walk: -1, act: 'spin', phase: 1, lag: { dy: -1, sway: 1, trail: 4 } },
  { key: 'cast', bob: 0, br: -1, walk: -1, act: 'cast', phase: -1, lag: { dy: 0, sway: 0, trail: 1 } },
  { key: 'aim', bob: 0, br: 0, walk: -1, act: 'aim', phase: -1, lag: { dy: 0, sway: 0, trail: 1 } },
  { key: 'hurt', bob: 0, br: 0, walk: -1, act: 'hurt', phase: -1, lag: { dy: -1, sway: -1, trail: 0 } },
  { key: 'tuck', bob: 4, br: 0, walk: -1, act: 'tuck', phase: -1, lag: { dy: 0, sway: 0, trail: 2 } },
  { key: 'roll', bob: 4, br: 0, walk: -1, act: 'roll', phase: -1, lag: { dy: 0, sway: 0, trail: 2 } },
  { key: 'down', bob: 0, br: 0, walk: -1, act: 'down', phase: -1, lag: { dy: 0, sway: 0, trail: 1 } },
];

/**
 * Arm / weapon layout per act and view (adult units; the child build scales offsets by 0.6).
 * `w` = weapon arm (right hand), `o` = off arm (left hand). `h` = hand offset from that arm's
 * shoulder, `d` = weapon direction (screen space; side views are drawn facing left), `l` = draw
 * layer when the arm is the far one ('behind' the body, 'under' the head, 'over' everything;
 * front / back views: default 'under'). `lean` shifts the upper body; `legs` is a side-view stance
 * or `{ spread, lifts }` for the front / back views.
 */
const ACTS = {
  wind: {
    side: { lean: [1, 0], w: { h: [4, 2], l: 'behind', d: [1, -0.45] }, o: { h: [-3, 3], l: 'under' }, legs: 'stance' },
    down: { w: { h: [-2, -2], d: [-0.55, -1] }, o: { h: [1, 4] }, legs: { spread: 1 } },
    up: { w: { h: [2, 4], d: [0.7, 0.8] }, o: { h: [-1, 4] }, legs: { spread: 1 } },
  },
  slash: {
    side: { lean: [-1, 0], w: { h: [-5, 3], l: 'under', d: [-1, 0.3] }, o: { h: [3, 3], l: 'behind' }, legs: 'lunge' },
    down: { w: { h: [7, 4], d: [0.9, 0.8] }, o: { h: [-1, 4] }, legs: { spread: 1 } },
    up: { w: { h: [-8, -1], l: 'behind', d: [-0.7, -1] }, o: { h: [1, 4] }, legs: { spread: 1 } },
  },
  follow: {
    side: { lean: [-1, 0], w: { h: [-4, 5], l: 'under', d: [-0.45, 1] }, o: { h: [3, 2], l: 'behind' }, legs: 'stance' },
    down: { w: { h: [9, 4], d: [1, 0.35] }, o: { h: [1, 3] }, legs: { spread: 1 } },
    up: { w: { h: [-9, 3], l: 'behind', d: [-1, 0.35] }, o: { h: [-1, 3] }, legs: { spread: 1 } },
  },
  backhand: {
    side: { lean: [0, 0], w: { h: [-5, 1], l: 'under', d: [-1, -0.7] }, o: { h: [3, 4], l: 'behind' }, legs: 'stance' },
    down: { w: { h: [-2, 4], d: [-1, 0.55] }, o: { h: [-1, 4] }, legs: { spread: 1 } },
    up: { w: { h: [0, -2], d: [0.55, -1] }, o: { h: [-1, 4] }, legs: { spread: 1 } },
  },
  thrust: {
    side: { lean: [-2, 0], w: { h: [-5, 2], l: 'under', d: [-1, 0] }, o: { h: [4, 1], l: 'behind' }, legs: 'lunge' },
    down: { w: { h: [4, 3], d: [0, 1] }, o: { h: [-4, 3] }, legs: { spread: 1, lifts: [0, 1] } },
    up: { w: { h: [2, -2], d: [0, -1] }, o: { h: [-2, 3] }, legs: { spread: 1, lifts: [1, 0] } },
  },
  spin: {
    side: { lean: [0, 0], w: { h: [5, 1], l: 'behind', d: [1, 0.1] }, o: { h: [-5, 1], l: 'under' }, legs: 'wide' },
    down: { w: { h: [-3, 0], d: [-1, 0.2] }, o: { h: [3, 0] }, legs: { spread: 2 } },
    up: { w: { h: [3, 0], d: [1, 0.2] }, o: { h: [-3, 0] }, legs: { spread: 2 } },
  },
  cast: {
    side: { lean: [0, 0], w: { h: [-7, -2], l: 'under', d: [-0.2, -1] }, o: { h: [-6, -1], l: 'under' }, legs: 'idle' },
    down: { w: { h: [-3, -4], d: [0, -1] }, o: { h: [3, -4] }, legs: { spread: 0 } },
    up: { w: { h: [3, -4], d: [0, -1] }, o: { h: [-3, -4] }, legs: { spread: 0 } },
  },
  aim: {
    side: { lean: [0, 0], w: { h: [1, 5], l: 'behind', d: [0.35, 1] }, o: { h: [-3, -2], l: 'over', item: 'flask' }, legs: 'idle' },
    down: { w: { h: [0, 5], d: [-0.25, 1] }, o: { h: [-4, -3], l: 'over', item: 'flask' }, legs: { spread: 0 } },
    up: { w: { h: [0, 5], d: [0.25, 1] }, o: { h: [3, -3], l: 'behind', item: 'flask' }, legs: { spread: 0 } },
  },
  hurt: {
    side: { lean: [1, 0], w: { h: [4, 3], l: 'behind', d: [0.8, 0.7] }, o: { h: [-3, 1], l: 'under' }, legs: 'stagger' },
    down: { lean: [0, -1], w: { h: [-3, 1], d: [-1, 0.8] }, o: { h: [3, 1] }, legs: { spread: 1, lifts: [1, 0] } },
    up: { lean: [0, 1], w: { h: [3, 1], d: [1, 0.8] }, o: { h: [-3, 1] }, legs: { spread: 1, lifts: [0, 1] } },
  },
  tuck: {
    side: { lean: [0, 0], w: { h: [-2, 3], l: 'under', d: [-0.6, 1] }, o: { h: [-3, 3], l: 'under' }, legs: 'crouch' },
    down: { w: { h: [3, 3], d: [-0.7, -1] }, o: { h: [-3, 3] }, legs: { spread: 0 } },
    up: { w: { h: [-3, 3], d: [0.7, -1] }, o: { h: [3, 3] }, legs: { spread: 0 } },
  },
  down: {
    side: { lean: [0, 0], w: { h: [1, 5], l: 'under', d: [0.2, 1] }, o: { h: [-1, 5], l: 'under' }, legs: 'idle' },
    down: { w: { h: [-1, 5], d: [-0.2, 1] }, o: { h: [1, 5] }, legs: { spread: 0 } },
    up: { w: { h: [1, 5], d: [0.2, 1] }, o: { h: [-1, 5] }, legs: { spread: 0 } },
  },
};

/**
 * Bow layouts (the bow in the left hand `o`, the right hand `w` draws the string). `b` = bow
 * aim direction (the bow's belly faces it), `drawn` = string pulled to the `w` hand with a nocked
 * arrow. Acts without an entry hold the bow at the sword layout's off-hand position, aiming forward.
 * The child build's `aim` draws at chest height (hands one row below the chin, the front view off to
 * the screen-right side, the side view tipped a little down): drawn at eye level the string and
 * the arrow crossed the big head's face.
 */
const BOW_ACTS = {
  aim: {
    side: { w: { h: [-1, 0], hc: [0, 1], l: 'over' }, o: { h: [-6, 1], hc: [-7, 1], l: 'over' }, b: [-1, 0.35], drawn: true, legs: 'stance' },
    down: { w: { h: [-3, 1], hc: [5, 1], l: 'over' }, o: { h: [-3, 3], hc: [4, 1], l: 'over' }, b: [1, 0.25], drawn: true, legs: { spread: 1 } },
    up: { w: { h: [-1, 0], hc: [-3, -3], l: 'over' }, o: { h: [2, 1], hc: [-3, -2], l: 'under' }, b: [-1, -0.3], drawn: true, legs: { spread: 1 } },
  },
  follow: {
    side: { w: { h: [3, 0], hc: [3, -3], l: 'behind' }, o: { h: [-6, 1], hc: [-6, -4], l: 'over' }, b: [-1, 0], drawn: false, legs: 'stance' },
    down: { w: { h: [-1, 4], hc: [2, 0] }, o: { h: [-3, 3], hc: [3, -2], l: 'over' }, b: [1, 0.3], drawn: false, legs: { spread: 1 } },
    up: { w: { h: [2, 2], hc: [-1, 0] }, o: { h: [2, 1], hc: [-3, -2], l: 'under' }, b: [-1, -0.3], drawn: false, legs: { spread: 1 } },
  },
  cast: {
    side: { w: { h: [-2, -2], l: 'over' }, o: { h: [-5, -3], l: 'over' }, b: [-0.6, -1], drawn: true, legs: 'idle' },
    down: { w: { h: [1, -1] }, o: { h: [4, -4] }, b: [0.35, -1], drawn: true, legs: { spread: 0 } },
    up: { w: { h: [-1, -1] }, o: { h: [-4, -4] }, b: [-0.35, -1], drawn: true, legs: { spread: 0 } },
  },
  thrust: {
    side: { lean: [-2, 0], w: { h: [-4, 3], l: 'under' }, o: { h: [-6, 1], l: 'under' }, b: [-1, 0], drawn: false, legs: 'lunge' },
    down: { w: { h: [4, 3] }, o: { h: [-4, 3] }, b: [-0.5, 1], drawn: false, legs: { spread: 1, lifts: [0, 1] } },
    up: { w: { h: [-3, 2] }, o: { h: [3, 2] }, b: [0.5, -1], drawn: false, legs: { spread: 1 } },
  },
};

/** Staff overrides (the staff in the right hand; `d` points at the ornament end). */
const STAFF_ACTS = {
  cast: {
    side: { w: { h: [-4, -3], hc: [-6, -5], l: 'over', d: [-0.12, -1] }, o: { h: [-4, -1], hc: [-5, -3], l: 'over' }, legs: 'idle' },
    down: { w: { h: [-4, -3], hc: [-3, -6], d: [0, -1] }, o: { h: [4, -3], hc: [3, -4] }, legs: { spread: 0 } },
    up: { w: { h: [4, -3], hc: [3, -6], d: [0, -1] }, o: { h: [-4, -3], hc: [-3, -4] }, legs: { spread: 0 } },
  },
  aim: {
    side: { lean: [-1, 0], w: { h: [-5, 1], l: 'under', d: [-1, -0.4] }, o: { h: [3, 3], l: 'behind' }, legs: 'stance' },
    down: { w: { h: [4, 3], d: [0.35, 1] }, o: { h: [1, 3] }, legs: { spread: 1 } },
    up: { w: { h: [0, -2], d: [0.3, -1] }, o: { h: [-1, 3] }, legs: { spread: 1 } },
  },
  tuck: {
    side: { w: { h: [-3, 2], l: 'under', d: [-0.2, -1] }, o: { h: [-2, 3], l: 'under' }, legs: 'crouch' },
    down: { w: { h: [0, 2], d: [0, -1] }, o: { h: [-3, 3] }, legs: { spread: 0 } },
    up: { w: { h: [0, 2], d: [0, -1] }, o: { h: [3, 3] }, legs: { spread: 0 } },
  },
};

/**
 * The greatshield's overrides (DRAGON_CAMPAIGN.md §5.4): the tower shield on the left hand `o`,
 * braced before the body (thrust at the foe in the shield bash, raised in the war cry), the flanged
 * mace in the right hand `w` (raised high behind the head in `backhand`, the slam's wind-up). No
 * flask in the shield hand. Acts without an entry keep ACTS' arms with the shield at the off hand.
 */
const SHIELD_ACTS = {
  wind: {
    side: { o: { h: [-4, 2], l: 'under' } },
    down: { o: { h: [0, 3] } },
    up: { o: { h: [0, 3] } },
  },
  thrust: {
    side: { lean: [-2, 0], w: { h: [4, 2], l: 'behind', d: [0.9, -0.6] }, o: { h: [-7, 2], l: 'under' } },
    down: { w: { h: [-2, 0], d: [-0.6, -1] }, o: { h: [-4, 3] } },
    up: { w: { h: [2, 0], d: [0.6, -1] }, o: { h: [4, 3] } },
  },
  slash: {
    side: { o: { h: [-2, 3], l: 'under' } },
    down: { o: { h: [1, 4] } },
    up: { o: { h: [-1, 4] } },
  },
  follow: {
    side: { o: { h: [-2, 3], l: 'under' } },
    down: { o: { h: [1, 3] } },
    up: { o: { h: [-1, 3] } },
  },
  backhand: {
    side: { w: { h: [3, -5], l: 'behind', d: [0.5, -1] }, o: { h: [-4, 2], l: 'under' } },
    down: { w: { h: [-2, -5], d: [-0.4, -1] }, o: { h: [0, 3] } },
    up: { w: { h: [2, -5], d: [0.4, -1] }, o: { h: [0, 3] } },
  },
  cast: {
    side: { w: { h: [3, -4], l: 'behind', d: [0.3, -1] }, o: { h: [-5, -2], l: 'under' } },
    down: { w: { h: [-3, -4], d: [-0.3, -1] }, o: { h: [3, -3] } },
    up: { w: { h: [3, -4], d: [0.3, -1] }, o: { h: [-3, -3] } },
  },
  spin: {
    side: { o: { h: [-5, 1], l: 'under' } },
    down: { o: { h: [3, 1] } },
    up: { o: { h: [-3, 1] } },
  },
  aim: {
    side: { o: { h: [-4, 2], l: 'under' } },
    down: { o: { h: [1, 3] } },
    up: { o: { h: [-1, 3] } },
  },
};

/** Side-view leg stances: [near, far] leg joints (see sideLegs). */
function combatSideLegs(pose, L) {
  const stance = pose.act === 'roll' ? 'crouch' : (ACTS[pose.act]?.side.legs ?? 'idle');
  switch (stance) {
    case 'stance': return [L(-2, -3), L(2, 3, 0, true)];
    case 'lunge': return [L(-3, -4), L(3, 5, 0, true)];
    case 'wide': return [L(-2, -4), L(2, 4)];
    case 'stagger': return [L(-1, -2), L(2, 3, 0, true)];
    case 'crouch': return [L(-2, -2), L(1, 1)];
    default: return [L(-1, -1), L(1, 1)];
  }
}

/** Front / back leg spread and lifts for a combat pose. */
function combatFrontLegs(pose, back) {
  const t = ACTS[pose.act]?.[back ? 'up' : 'down']?.legs ?? {};
  return { spread: t.spread ?? 0, lifts: t.lifts ?? [0, 0] };
}

/** Upper-body lean (painter offset) on / off. drawCharacterFrame resets it after the frame. */
function leanOn(p, act) { p.ox = act.lean[0]; p.oy = act.lean[1]; }
function leanOff(p) { p.ox = 0; p.oy = 0; }

/**
 * Resolve the combat layout of a pose for one view ('down' | 'up' | 'left' | 'right') into absolute
 * shoulder / hand positions and layers, with the weapon kind's overrides applied.
 * @returns {{ lean: [number, number], arms: object[], bow: object|null, key: string, view: string,
 *   child: boolean }}
 */
function combatLayout(c, pose, view) {
  const r = c.rig;
  const side = view === 'left' || view === 'right';
  const key = side ? 'side' : view;
  const base = ACTS[pose.act] ?? ACTS.down;
  const bowT = c.weapon === 'bow' ? BOW_ACTS[pose.act]?.[key] : null;
  const staffT = isStaff(c.weapon) ? STAFF_ACTS[pose.act]?.[key] : null;
  const shield = c.weapon === 'greatshield';
  const shieldT = shield ? SHIELD_ACTS[pose.act]?.[key] : null;
  const hammerT = c.weapon === 'hammer' ? KIT.HAMMER_ACTS[pose.act]?.[key] : null;
  const t = { ...base[key], ...(staffT || {}), ...(shieldT || {}), ...(hammerT || {}), ...(bowT || {}) };
  // the child build (goblins) has short arms under a wide head: less vertical reach, more sideways
  const kx = r.child ? 0.75 : 1, ky = r.child ? 0.6 : 1;
  const up = pose.bob + pose.br;
  const sy = r.armTop + up;
  // shoulders: side view = one column for both arms; front: weapon arm screen-left, back: screen-right
  const shoulder = (which) => {
    if (side) return [r.cx - 1, sy];
    const left = [r.cx - r.half - 2, sy], right = [r.cx + r.half, sy];
    return (which === 'w') === (view === 'down') ? left : right;
  };
  const far = view === 'right'; // mirrored row: the right (weapon) hand is the near one
  const arms = [];
  for (const which of ['w', 'o']) {
    const a = t[which];
    if (!a) continue;
    const [sx, sy0] = shoulder(which);
    // `hc`: an explicit child-build hand offset where scaling the adult one cannot reach (the bow drawn at chest height, below the big head)
    const hx = sx + (r.child && a.hc ? a.hc[0] : Math.round(a.h[0] * kx));
    const hy = sy0 + (r.child && a.hc ? a.hc[1] : Math.round(a.h[1] * ky));
    // side view: the right arm is far facing left, near when mirrored
    const isFar = side ? (which === 'w') !== far : false;
    let layer = a.l ?? 'under';
    if (side && !isFar && layer === 'behind') layer = 'under';
    // (the tower shield on the far arm — the mirrored row — stays behind the body)
    if (shield && side && which === 'o' && isFar) layer = 'behind';
    arms.push({ which, sx, sy: sy0, hx, hy, near: side ? !isFar : true, layer, d: a.d ?? null, item: shield && which === 'o' ? null : a.item ?? null, view });
  }
  const bow = c.weapon === 'bow' ? { b: t.b ?? (side ? [-1, 0] : view === 'down' ? [-0.5, 1] : [0.5, -1]), drawn: !!t.drawn } : null;
  return { lean: t.lean ?? [0, 0], arms, bow, key, view, child: r.child };
}

/** Sleeve material of an outfit style (as the plain arms). */
function sleeveOf(c) {
  const s = c.outfit.style;
  return s === 'vest' || s === 'overalls' ? M.SHIRT : s === 'tabard' ? M.METAL : s === 'dancer' ? M.SKIN : M.TOP;
}

/** Draw the arms (and what they hold) whose layer is `slot`. Returns the last hand drawn as [x, y]. */
function combatArms(p, c, act, slot) {
  let hand;
  for (const a of act.arms) {
    if (a.layer !== slot) continue;
    drawCombatArm(p, c, a);
    hand = [a.hx, a.hy];
    if (a.which === 'w' && c.weapon !== 'bow') drawWeaponDrawn(p, c, act, a);
    if (a.which === 'o' && c.weapon === 'bow') {
      drawBowHeld(p, c, act, a);
      const right = act.arms.find((b) => b.which === 'w');
      if (act.bow.drawn && right) drawBowString(p, c, act, right); // string pulled to the right hand, arrow nocked
    }
    if (a.which === 'o' && c.weapon === 'greatshield') drawShieldHeld(p, act, a, crestOf(c));
    if (a.item === 'flask' && c.weapon !== 'bow' && !isStaff(c.weapon)) drawFlask(p, a.hx, a.hy, act.view);
  }
  return hand;
}

/**
 * One combat arm: a 2 px limb from the shoulder to the hand (sleeve, lit on the near / screen-left
 * side), with the hand (glove or skin) at the end.
 */
function drawCombatArm(p, c, a) {
  const r = c.rig;
  const sleeve = sleeveOf(c);
  const handM = c.gear.gloves ? M.LEATHER : M.SKIN;
  const bright = a.near && (a.view !== 'up' || a.which === 'o') ? 3 : a.near ? 2 : 1;
  p.begin(a.near ? 'all' : null, 1);
  const dx = a.hx - a.sx, dy = a.hy - a.sy;
  const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (let i = 0; i < n; i++) {
    const x = Math.round(a.sx + (dx * i) / n), y = Math.round(a.sy + (dy * i) / n);
    const top = i === 0;
    p.set(x, y, sleeve, top ? Math.min(4, bright + 1) : bright);
    if (vertical) p.set(x + 1, y, sleeve, bright - 1);
    else p.set(x, y + 1, sleeve, bright - 1);
  }
  // cuff / bracer one step before the hand
  const cx = Math.round(a.sx + (dx * (n - 1)) / n), cy = Math.round(a.sy + (dy * (n - 1)) / n);
  if (c.gear.bracers && !r.child) { p.set(cx, cy, M.METAL, bright); p.set(vertical ? cx + 1 : cx, vertical ? cy : cy + 1, M.METAL, bright - 1); }
  if (c.outfit.style === 'robe') { p.set(cx, cy, M.ACCENT, bright); p.set(vertical ? cx + 1 : cx, vertical ? cy : cy + 1, M.ACCENT, bright - 1); }
  // hand
  p.set(a.hx, a.hy, handM, bright);
  p.set(a.hx + 1, a.hy, handM, bright - 1);
  if (!r.child) { p.set(a.hx, a.hy + 1, handM, bright - 1); p.set(a.hx + 1, a.hy + 1, handM, Math.max(0, bright - 2)); }
  p.end();
}

/** Unit vector. */
function unit(d) {
  const l = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / l, d[1] / l];
}

/** Keep drawn weapons inside the frame's 1 px transparent margin (the outline needs the next pixel). */
let _framePainter = null;
const inFrame = (x, y) => { const X = x + _framePainter.ox, Y = y + _framePainter.oy; return X >= 2 && X <= 29 && Y >= 2 && Y <= 30; };

/**
 * The right hand's weapon, drawn where the sheathed / slung one was: a sword, or a staff / spear /
 * cane held at the grip (other weapons — none, lute — leave the hand empty; the bow is drawBowHeld).
 */
function drawWeaponDrawn(p, c, act, a) {
  if (!a.d) return;
  const d = unit(a.d);
  const gx = a.hx + 0.5, gy = a.hy + (act.child ? 0 : 0.5);
  // ≤ 8 px pommel to tip (COMBAT.md §10.2): blade 5 (child 4) + guard, grip and pommel
  if (c.weapon === 'sword') drawSwordDrawn(p, gx, gy, d, act.child ? 4 : 5, a.near);
  else if (c.weapon === 'hammer') KIT.hammerDrawn(p, gx, gy, d, a.near);
  else if (POLE_KINDS.includes(c.weapon)) {
    drawStaffDrawn(p, c, gx, gy, d, 6, 2, c.weapon, a.near); // 8 px: 6 ahead of the grip, 2 behind
  } else if (c.weapon === 'greatshield') drawMaceDrawn(p, gx, gy, d, a.near);
}

/**
 * The greatshield's flanged mace held at the grip (≤ 8 px): a pommel behind the fist, a leather grip,
 * the haft, and the head — a steel knob with its four flanges — lit on the near side.
 */
function drawMaceDrawn(p, gx, gy, d, near) {
  const [ux, uy] = d;
  const px = -uy, py = ux;
  p.begin('all', 0);
  const at = (t, o = 0) => [Math.round(gx + ux * t + px * o - 0.5), Math.round(gy + uy * t + py * o - 0.5)];
  const put = (xy, m, sh) => { if (inFrame(xy[0], xy[1])) p.set(xy[0], xy[1], m, sh); };
  put(at(-1.2), M.METAL, 2);
  put(at(0.6), M.LEATHER, 2);
  put(at(1.8), M.WOOD, near ? 3 : 2);
  put(at(2.9), M.WOOD, near ? 2 : 1);
  // the head: a knob with flanges either side and a cap
  put(at(4.2), M.METAL, near ? 4 : 3);
  put(at(5.2), M.METAL, near ? 3 : 2);
  put(at(4.4, -1.1), M.METAL, 3);
  put(at(4.4, 1.1), M.METAL, 1);
  put(at(5.6, -0.9), M.METAL, 2);
  put(at(5.6, 0.9), M.METAL, 1);
  put(at(6.3), M.METAL, near ? 4 : 3);
  p.end();
}

/**
 * The tower shield on the off hand: its face toward the camera (front view; thrust at the foe in the
 * bash: before the body), its back (back view), edge-on before or behind the body (side views).
 */
function drawShieldHeld(p, act, a, crest = null) {
  p.begin('all', 0);
  if (act.key === 'side') shieldEdge(p, a.hx - 2, a.hy - 6, crest);
  else if (act.key === 'up') shieldBack(p, a.hx - 4, a.hy - 6);
  else shieldFace(p, a.hx - (a.hx - a.sx < -1 ? 3 : 1), a.hy - 6, crest);
  p.end();
}

/**
 * Drawn sword: pommel behind the fist, cross-guard across the blade, a bright 1 px blade with a
 * darker spine on the shadow side and a pale tip (`M.BLADE`: glow texels with `gear.bladeGlow`).
 * Blade length `len` (the whole sword stays ≤ 8 px: big arcs are FX).
 */
function drawSwordDrawn(p, gx, gy, d, len, near) {
  const [ux, uy] = d;
  const px = -uy, py = ux; // perpendicular
  p.begin('all', 0);
  const at = (t, o = 0) => [Math.round(gx + ux * t + px * o - 0.5), Math.round(gy + uy * t + py * o - 0.5)];
  const put = (xy, m, s) => { if (inFrame(xy[0], xy[1])) p.set(xy[0], xy[1], m, s); };
  put(at(-1.4), M.GOLD, 3);                                // pommel
  put(at(1.3, -1), M.GOLD, 4); put(at(1.3), M.GOLD, 3); put(at(1.3, 1), M.GOLD, 2); // guard
  for (let i = 0; i < len; i++) {
    const t = 2.2 + i;
    const tip = i === len - 1;
    put(at(t), M.BLADE, tip ? 3 : 4);
    // spine: thickens the blade on its shadow side for the first two thirds
    if (!tip && i < len - 2 && (Math.abs(ux) > 0.35 && Math.abs(uy) > 0.35)) put(at(t + 0.5, uy > 0 === ux > 0 ? 0.6 : -0.6), M.BLADE, near ? 2 : 1);
  }
  p.end();
}

/** Staff (or spear / cane) held at the grip: the ornament end points along `d`. */
function drawStaffDrawn(p, c, gx, gy, d, ahead, behind, kind, near) {
  const [ux, uy] = d;
  const mat = poleMat(kind);
  p.begin(null);
  let tip = null;
  for (let t = -behind; t <= ahead; t += 0.5) {
    const x = Math.round(gx + ux * t - 0.5), y = Math.round(gy + uy * t - 0.5);
    if (!inFrame(x, y)) continue;
    p.set(x, y, mat, near ? 3 : 2);
    tip = [x, y];
  }
  p.end();
  if (tip && kind !== 'cane') {
    p.begin('all', 1);
    const [tx, ty] = tip;
    const put = (x, y, m, s) => { if (inFrame(x, y)) p.set(x, y, m, s); };
    if (kind === 'spear') staffTop(p, c, tx, ty + (uy < 0 ? 0 : 0), 'spear');
    else if (kind === 'holystaff') {
      // the sun at the staff's head: a glowing core in a gold ring, a ray beyond it
      const cx = Math.round(tx + ux * 1.4), cy = Math.round(ty + uy * 1.4);
      for (const [ox, oy, s] of [[-1, -2, 4], [0, -2, 4], [1, -2, 3], [-2, -1, 4], [2, -1, 2], [-2, 0, 3], [2, 0, 1], [-2, 1, 3], [2, 1, 1], [-1, 2, 2], [0, 2, 2], [1, 2, 1]]) put(cx + ox, cy + oy, M.GOLD, s);
      for (const [ox, oy, s] of [[-1, -1, 4], [0, -1, 4], [1, -1, 3], [-1, 0, 3], [0, 0, 4], [1, 0, 2], [-1, 1, 2], [0, 1, 3], [1, 1, 2]]) put(cx + ox, cy + oy, M.HOLY, s);
      put(Math.round(cx + ux * 3), Math.round(cy + uy * 3), M.HOLY, 4);
      // its rays on the diagonals
      for (const [ox, oy, s] of [[-3, -3, 4], [3, -3, 3], [-3, 3, 3], [3, 3, 2]]) put(cx + ox, cy + oy, M.GOLD, s);
    } else if (kind === 'icestaff') {
      // the crystal along the staff, in its silver claw
      put(tx - (ux > 0.5 ? 0 : 1), ty, M.METAL, 3);
      put(tx + (ux < -0.5 ? 0 : 1), ty, M.METAL, 1);
      // (a long faceted crystal: three wide through its middle, lit on one face)
      const px = -uy, py = ux;
      for (let k = 1; k <= 4; k++) put(Math.round(tx + ux * k), Math.round(ty + uy * k), M.ICE, k === 2 || k === 3 ? 4 : 3);
      for (const k of [1.6, 2.6]) {
        put(Math.round(tx + ux * k + px), Math.round(ty + uy * k + py), M.ICE, 3);
        put(Math.round(tx + ux * k - px), Math.round(ty + uy * k - py), M.ICE, 1);
      }
      put(Math.round(tx + ux * 5.2), Math.round(ty + uy * 5.2), M.ICE, 4);
    } else {
      // gem ornament: a gold claw around the gem at the staff's head (the gem may glow, alpha 204)
      p.set(tx, ty, M.GEM, 4);
      p.set(tx + (ux > 0.5 ? -1 : 1), ty, M.GEM, 2);
      p.set(tx, ty + (uy > 0.5 ? -1 : 1), M.GEM, 3);
      for (const [ox, oy, s] of [[-1, -1, 3], [1, -1, 2], [-1, 1, 2], [1, 1, 1]]) if (inFrame(tx + ox, ty + oy)) p.set(tx + ox, ty + oy, M.GOLD, s);
    }
    p.end();
  }
}

/** Bow held in the left hand: a curved stave facing `act.bow.b`; drawn = the string pulled to the right hand. */
function drawBowHeld(p, c, act, a) {
  const [bx, by] = unit(act.bow.b);
  const px = -by, py = bx;
  const H = act.child ? 5.5 : 6.5;
  const B = act.child ? 2.4 : 2.8;
  const gx = a.hx + 0.5, gy = a.hy + 0.5;
  p.begin('all', 0);
  const tips = [];
  // stave bowed toward the aim, the tips recurved back; leather grip in the middle
  const bend = (t) => B * (1 - (t / H) * (t / H)) - (Math.abs(t) > H - 1.2 ? 0.8 : 0);
  for (let t = -H; t <= H; t += 0.5) {
    const x = Math.round(gx + px * t + bx * bend(t) - 0.5), y = Math.round(gy + py * t + by * bend(t) - 0.5);
    if (!inFrame(x, y)) continue;
    const grip = Math.abs(t) < 1;
    p.set(x, y, grip ? M.LEATHER : M.WOOD, grip ? 2 : Math.abs(t) > H - 1.5 ? 4 : t < 0 ? 3 : 2);
  }
  for (const t of [-H + 0.5, H - 0.5]) tips.push([Math.round(gx + px * t + bx * bend(t) - 0.5), Math.round(gy + py * t + by * bend(t) - 0.5)]);
  if (!act.bow.drawn) {
    // relaxed string straight between the tips
    const [a0, a1] = tips;
    p.line2(a0[0], a0[1], a1[0], a1[1], M.STRING, 3);
  }
  p.end();
  act.bow.tips = tips;
  act.bow.grip = [gx, gy];
}

/** Drawn bow string: from both tips to the drawing hand, plus the nocked arrow along the aim. */
function drawBowString(p, c, act, a) {
  const tips = act.bow.tips;
  if (!tips) return;
  const nx = a.hx, ny = a.hy;
  p.begin(null);
  for (const [tx, ty] of tips) p.line2(tx, ty, nx, ny, M.STRING, 3);
  // arrow: shaft from the nock through the grip, metal head one pixel past the bow
  const [bx, by] = unit(act.bow.b);
  const [gx, gy] = act.bow.grip;
  const len = Math.hypot(gx - nx, gy - ny) + 2.5;
  for (let t = 0; t <= len; t += 0.5) {
    const x = Math.round(nx + 0.5 + bx * t - 0.5), y = Math.round(ny + 0.5 + by * t - 0.5);
    if (!inFrame(x, y)) continue;
    p.set(x, y, t > len - 1.5 ? M.METAL : M.WOOD, t > len - 1.5 ? 4 : 3);
  }
  p.set(nx, ny, M.FEATHER, 3);
  p.end();
}

/** Healing draught raised in the hand: cork, glass neck, green liquid with a highlight. */
function drawFlask(p, hx, hy, view) {
  p.begin('all', 0);
  const x = hx, y = hy - 3;
  p.set(x, y, M.WOOD, 3);                             // cork
  p.set(x, y + 1, M.WHITE, 3);                        // neck
  p.set(x - 1, y + 2, M.GEL, 3); p.set(x, y + 2, M.GEL, 4); p.set(x + 1, y + 2, M.GEL, 2);
  p.set(x - 1, y + 3, M.GEL, 2); p.set(x, y + 3, M.GEL, 2); p.set(x + 1, y + 3, M.GEL, 1);
  if (view === 'up') p.set(x, y + 2, M.GEL, 2);
  p.end();
}

/**
 * Mid-roll (act 'roll'): the traveller a quarter turn into a forward tumble, curled up behind the
 * big chibi head so it still reads as them. Side views (drawn facing left): the head tipped forward
 * — crown leading, the face turned down to the knees, eyes shut — the cloaked back arched behind it,
 * the tunic under the cloak's edge, the tucked shins (trousers, boots) along the underside with the
 * hands clasping them, the weapon along the back, and the cloak's hem whipping up behind with its
 * lining showing. Front view: the crown of the ducked head toward the camera under the arched back,
 * the boots swinging over the top, the arms at the sides. Back view: the back and the hair over its
 * far edge, the seat and the boot soles toward the camera. A cape-less build shows its tunic instead.
 */
function drawRoll(p, c, dir) {
  const r = c.rig;
  const k = r.child ? 0.84 : 1;
  const G = r.ground; // bottom row of the figure
  const X = r.cx; // frame centre column
  const cloak = !!c.cape && c.cape.style !== 'short';
  const back = cloak ? M.CAPE : M.TOP;
  const chest = cloak ? M.TOP : M.BOTTOM;
  const headM = c.hat === 'hood' || c.hat === 'greathelm' ? M.HAT : M.HAIR;
  const handM = c.gear.gloves ? M.LEATHER : M.SKIN;
  const sleeve = sleeveOf(c);
  const put = (x, y, m, sh) => {
    const px = Math.round(x - 0.5), py = Math.round(y - 0.5);
    if (inFrame(px, py)) p.set(px, py, m, sh);
  };
  /** Fill a polygon of [x, y] points (pixel-centre test); `sh` = shade, or shade(x, y) (null: skip). */
  const poly = (pts, m, sh) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
        }
        const v = inside && inFrame(x, y) ? (typeof sh === 'function' ? sh(x + 0.5, y + 0.5) : sh) : null;
        if (v != null) p.set(x, y, m, v);
      }
    }
  };
  /** A limb `w` px thick from a to b, lit along its top edge. */
  const limb = (ax, ay, bx, by, w, m, lit = 3) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    const hw = w / 2;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      for (let yy = Math.floor(y - hw); yy <= Math.ceil(y + hw); yy++) {
        for (let xx = Math.floor(x - hw); xx <= Math.ceil(x + hw); xx++) {
          const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
          if (dx * dx + dy * dy > hw * hw + 0.05 || !inFrame(xx, yy)) continue;
          p.set(xx, yy, m, Math.max(0, dy < -hw * 0.3 ? lit : dy > hw * 0.35 ? lit - 2 : lit - 1));
        }
      }
    }
  };
  /** The cloak's hem flaring out: the lining (dark) under a lit rim of the cloak's outer face. */
  const hem = (pts, rim) => {
    if (!cloak) return;
    p.begin('all', 0);
    poly(pts, M.CAPEIN, (x, y) => (rim(x, y) ? null : 1));
    poly(pts, M.CAPE, (x, y) => (rim(x, y) ? 3 : null));
    p.end();
  };
  /** The weapon hugged along the back (hilt at a, point at b). */
  const weapon = (ax, ay, bx, by) => {
    const holy = c.weapon === 'holystaff', ice = c.weapon === 'icestaff', mace = c.weapon === 'greatshield', hammer = c.weapon === 'hammer';
    if (!(c.weapon === 'sword' || c.weapon === 'staff' || c.weapon === 'spear' || holy || ice || mace || hammer)) return;
    p.begin('all', 0);
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
      if (c.weapon === 'sword') put(x, y, i < 2 ? M.GOLD : M.METAL, i < 2 ? 3 : 4);
      else if (holy) put(x, y, i === n ? M.HOLY : M.GILT, i === n ? 4 : 3);
      else if (ice) put(x, y, i === n ? M.ICE : M.METAL, i === n ? 4 : 3);
      else if (mace) put(x, y, i >= n - 1 ? M.METAL : M.WOOD, i >= n - 1 ? 4 : 3);
      else if (hammer) put(x, y, i >= n - 1 ? M.METAL : M.WOOD, i >= n - 1 ? 3 : 2);
      else put(x, y, M.WOOD, 3);
    }
    p.end();
  };
  /** Paint `m` over the already drawn pixels of an ellipse where `f(dx, dy)` (normalised offsets) holds. */
  const overIn = (ex, ey, rx, ry, m, f, shade = null) => {
    for (let y = Math.floor(ey - ry); y <= Math.ceil(ey + ry); y++) {
      for (let x = Math.floor(ex - rx); x <= Math.ceil(ex + rx); x++) {
        const dx = (x + 0.5 - ex) / rx, dy = (y + 0.5 - ey) / ry;
        if (dx * dx + dy * dy > 1 || !f(dx, dy)) continue;
        p.over(x, y, m, shade ?? Math.max(1, Math.min(3, p.getShade(x, y))));
      }
    }
  };

  if (dir === 'left' || dir === 'right') {
    // ---- side view, facing left: head leading low, the back arched behind it, shins underneath ----
    const hx = X - 3.8 * k, hy = G - 5.2 * k, hr = 5.4 * k, hv = 5 * k; // the head
    const bx = X + 3 * k, by = G - 8 * k, br = 5.3 * k, bv = 5.2 * k; // the curled back, arched over
    // the hem whips up and back from the shoulders (a lit rim of the cloak along its top edge)
    const h0 = [bx - 0.5 * k, by - bv * 0.85], h1 = [bx + br + 3.4 * k, by - bv - 1.6 * k];
    hem([h0, h1, [bx + br + 2.6 * k, by - bv * 0.05], [bx + br * 0.6, by + bv * 0.3]],
      (x, y) => y < h0[1] + ((x - h0[0]) * (h1[1] - h0[1])) / (h1[0] - h0[0]) + 1.4);
    weapon(bx + br * 0.75, by - bv * 0.45, bx - br * 0.7, by - bv * 1.15);
    p.begin(null);
    blob(p, bx, by, br, bv, back, { hi: 0.35, lo: -0.25 });
    // the chest under the cloak's front edge, the belt along the fold
    overIn(bx, by, br, bv, chest, (dx, dy) => dy > 0.35 - dx * 0.35 && dx < 0.35);
    overIn(bx, by, br, bv, M.BELT, (dx, dy) => dy > 0.2 - dx * 0.35 && dy <= 0.35 - dx * 0.35 && dx < 0.3, 1);
    p.end();
    // the shins along the underside, the boots trailing up behind
    p.begin('all', 0);
    const kx = X - 0.5 * k, ky = G - 1.4 * k, fx = X + 7 * k, fy = G - 1.4 * k;
    limb(kx, ky, fx, fy, 2.8 * k, M.BOTTOM, 3);
    for (const [ox, oy, sh] of [[0.5, -1.5, 3], [1.5, -1.5, 2], [0.5, -0.5, 2], [1.5, -0.5, 1], [0.5, 0.5, 0], [1.5, 0.5, 0], [2.5, -2.5, 2], [1.5, -2.5, 3]]) put(fx + ox * k, fy + oy * k, M.BOOT, sh);
    p.end();
    // the hands clasping the shins
    p.begin('all', 1);
    const cxh = X + 2.5 * k, cyh = G - 2.8 * k;
    put(cxh - 1, cyh - 1, sleeve, 3); put(cxh, cyh - 1, sleeve, 2);
    put(cxh, cyh, handM, 3); put(cxh + 1, cyh, handM, 2);
    p.end();
    // the big head, crown leading, the face turned down to the knees
    p.begin('all', 0);
    blob(p, hx, hy, hr, hv, headM, { hi: 0.3, lo: -0.3, maxShade: 4 });
    overIn(hx, hy, hr, hv, M.SKIN, (dx, dy) => dy > 0.38 - dx * 0.25 && dx > -0.55, null);
    for (let y = Math.floor(hy - hv); y <= Math.ceil(hy + hv); y++) {
      for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) {
        if (p.get(x, y) !== M.SKIN) continue;
        const dx = (x + 0.5 - hx) / hr;
        p.set(x, y, M.SKIN, dx < 0 ? 3 : 2);
      }
    }
    put(hx - 0.5 * k, hy + 2 * k, M.EYE, 0); put(hx + 0.5 * k, hy + 2.2 * k, M.EYE, 0); // shut eye
    put(hx + 2.5 * k, hy + 0.5 * k, M.SKIN, 2); put(hx + 2.5 * k, hy + 1.5 * k, M.SKIN, 1); // ear
    p.end();
    return;
  }

  const up = dir === 'up';
  if (!up) {
    // ---- front view: the ducked head's crown toward the camera under the arched back ----
    const hx = X + 0.5, hy = G - 5 * k, hr = 5.4 * k, hv = 4.8 * k;
    const bx = X + 0.5, by = G - 8.6 * k, br = 7 * k, bv = 4.6 * k;
    hem([[bx + br * 0.2, by - bv * 0.6], [bx + br * 0.55, by - bv - 3.4 * k], [bx + br + 1.6 * k, by - bv - 1.6 * k], [bx + br * 0.85, by - bv * 0.15]],
      (x, y) => x < bx + br * 0.55 + (y - by + bv) * 0.1);
    // the boots swinging over the top
    p.begin('all', 0);
    for (const sx of [-1, 1]) {
      const fx = bx + sx * 2.4 * k, fy = by - bv - 0.4 * k;
      put(fx - 0.5, fy - 0.5, M.BOOT, 1); put(fx + 0.5, fy - 0.5, M.BOOT, 1);
      put(fx - 0.5, fy + 0.5, M.BOOT, sx < 0 ? 3 : 2); put(fx + 0.5, fy + 0.5, M.BOOT, 2);
    }
    p.end();
    weapon(bx - br * 0.95, by + bv * 0.2, bx - br * 0.45, by - bv * 1.1);
    p.begin(null);
    blob(p, bx, by, br, bv, back, { hi: 0.35, lo: -0.25 });
    overIn(bx, by, br, bv, chest, (dx, dy) => Math.abs(dx) > 0.62 && dy > 0.1);
    p.end();
    // the arms at the head's sides, the hands meeting under it
    p.begin('all', 1);
    for (const sx of [-1, 1]) {
      const lit = sx < 0 ? 3 : 2;
      put(hx + sx * (hr + 0.6), hy - 1.2 * k, sleeve, lit); put(hx + sx * (hr + 0.4), hy - 0.2 * k, sleeve, lit - 1);
      put(hx + sx * (hr - 0.2), hy + 1.6 * k, handM, lit); put(hx + sx * (hr - 1.2), hy + 2.8 * k, handM, lit - 1);
    }
    p.end();
    p.begin('all', 0);
    blob(p, hx, hy, hr, hv, headM, { hi: 0.3, lo: -0.3, maxShade: 4 });
    // the bowed face along the bottom (brow, shut eyes), the crown's whorl above, the ears
    overIn(hx, hy, hr, hv, M.SKIN, (dx, dy) => dy > 0.5 - Math.abs(dx) * 0.2, null);
    for (let y = Math.floor(hy); y <= Math.ceil(hy + hv); y++) {
      for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) if (p.get(x, y) === M.SKIN) p.set(x, y, M.SKIN, x + 0.5 < hx ? 3 : 2);
    }
    for (const sx of [-1, 1]) { put(hx + sx * 2 * k - 0.5, hy + hv * 0.72, M.EYE, 0); put(hx + sx * 2 * k + 0.5, hy + hv * 0.72, M.EYE, 0); }
    put(hx - 1.2, hy - 1.6, headM, 4); put(hx - 0.2, hy - 2.1, headM, 4);
    put(hx - hr - 0.2, hy + 0.8, M.SKIN, 3); put(hx + hr + 0.2, hy + 0.8, M.SKIN, 1);
    p.end();
    return;
  }

  // ---- back view: the back arched over, the hair over its far edge, the seat and soles toward us ----
  const bx = X + 0.5, by = G - 5.8 * k, br = 6.8 * k, bv = 5.2 * k;
  weapon(bx + br * 0.95, by + bv * 0.1, bx + br * 0.4, by - bv * 1.15);
  p.begin(null);
  blob(p, bx, by, br, bv, back, { hi: 0.35, lo: -0.25 });
  overIn(bx, by, br, bv, M.BOTTOM, (dx, dy) => dy > 0.45 && Math.abs(dx) < 0.62);
  p.end();
  // the crown of the tucked head over the back's far edge: its upper half drawn after the back and
  // outlined (a dark line along the cloak's top), a shade darker than the cloak's lit tan, so hair
  // and cloak no longer merge into one brown ball (COMBAT-08)
  {
    const hx = bx - 0.3, hy = by - bv * 0.95, hr = 5.2 * k, hv = 3.4 * k;
    p.begin('all', 0);
    for (let y = Math.floor(hy - hv); y <= Math.floor(hy); y++) {
      for (let x = Math.floor(hx - hr); x <= Math.ceil(hx + hr); x++) {
        const dx = (x + 0.5 - hx) / hr, dy = (y + 0.5 - hy) / hv;
        if (dx * dx + dy * dy > 1 || !inFrame(x, y)) continue;
        const l = -0.55 * dx - 0.8 * dy;
        p.set(x, y, headM, l > 0.6 ? 3 : l > 0.05 ? 2 : 1);
      }
    }
    if (headM === M.HAIR) { put(hx - hr + 0.6, hy - 0.2 * k, M.SKIN, 2); put(hx + hr - 0.4, hy - 0.2 * k, M.SKIN, 1); } // the ears
    p.end();
  }
  hem([[bx + br * 0.45, by + bv * 0.05], [bx + br + 3.2 * k, by - bv * 0.45], [bx + br + 2.6 * k, by + bv * 0.4], [bx + br * 0.6, by + bv * 0.6]],
    (x, y) => y < by + bv * 0.05 - (x - bx - br) * 0.25);
  // the arms at the sides
  p.begin('all', 1);
  for (const sx of [-1, 1]) {
    const lit = sx < 0 ? 3 : 2;
    put(bx + sx * (br - 0.4), by + bv * 0.1, sleeve, lit); put(bx + sx * (br - 0.9), by + bv * 0.4, handM, lit);
  }
  p.end();
  // the boot soles toward the camera
  p.begin('all', 0);
  for (const sx of [-1, 1]) {
    const fx = bx + sx * 2.2 * k, fy = G - 1.2 * k;
    put(fx - 0.5, fy - 0.5, M.BOOT, sx < 0 ? 3 : 2); put(fx + 0.5, fy - 0.5, M.BOOT, 2);
    put(fx - 0.5, fy + 0.5, M.BOOT, 0); put(fx + 0.5, fy + 0.5, M.BOOT, 0);
  }
  p.end();
}

/**
 * Knocked-down pose: the standing 'down' layout rotated 90° clockwise (the head points backward and
 * the light from the left becomes light from above), settled on the ground row and centred.
 */
function layDown(p, c) {
  const { w, h, mat, shade } = p;
  const m2 = new Uint8Array(w * h), s2 = new Int8Array(w * h);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mat[i]) continue;
      const nx = h - 1 - y, ny = x;
      if (nx < 0 || nx >= w || ny >= h) continue;
      m2[ny * w + nx] = mat[i]; s2[ny * w + nx] = shade[i];
      if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
    }
  }
  mat.fill(0); shade.fill(0); p.part.fill(0);
  if (maxX < 0) return;
  const sx = Math.round(c.rig.cx - (minX + maxX + 1) / 2), sy = c.rig.ground - maxY;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if (!m2[i]) continue;
      const tx = x + sx, ty = y + sy;
      if (tx < 1 || tx > w - 2 || ty < 1 || ty >= h - 1) continue;
      mat[ty * w + tx] = m2[i]; shade[ty * w + tx] = s2[i];
    }
  }
}

/** Hurt / knocked-down face: eyes squeezed shut, mouth open (down view). */
function hurtFaceDown(p, c, hx, hy) {
  const eyeY = hy + 6;
  for (const e of [hx + 3, hx + 8]) { p.set(e - 1, eyeY + 1, M.EYE, 0); p.set(e, eyeY + 1, M.EYE, 0); }
  p.set(hx + 2, eyeY, M.EYE, 0); p.set(hx + 9, eyeY, M.EYE, 0);
  p.set(hx + 5, hy + 9, M.EYE, 0); p.set(hx + 6, hy + 9, M.EYE, 0);
  if (c.blush) { p.set(hx + 2, hy + 8, M.BLUSH, 2); p.set(hx + 9, hy + 8, M.BLUSH, 2); }
}

/** Hurt face, side view. */
function hurtFaceSide(p, c, hx, hy) {
  const eyeY = hy + 6;
  p.set(hx + 1, eyeY + 1, M.EYE, 0); p.set(hx + 2, eyeY + 1, M.EYE, 0); p.set(hx + 3, eyeY, M.EYE, 0);
  p.set(hx + 1, hy + 9, M.EYE, 0);
  p.set(hx + 6, eyeY, M.SKIN, 1); p.set(hx + 6, eyeY + 1, M.SKIN, 1); p.set(hx + 7, eyeY, M.SKIN, 2); p.set(hx + 7, eyeY + 1, M.SKIN, 0);
}

// ---------------------------------------------------------------------------
// Frame + sheet assembly
// ---------------------------------------------------------------------------

function drawCharacterFrame(p, c, dir, pose) {
  p.clear();
  _framePainter = p; // inFrame() checks the drawn position including the combat lean
  if (pose.act === 'roll') drawRoll(p, c, dir);
  else if (dir === 'down') drawFront(p, c, pose, false);
  else if (dir === 'up') drawFront(p, c, pose, true);
  else drawSide(p, c, pose, dir === 'right');
  if (pose.act === 'down') layDown(p, c);
  p.ox = 0; p.oy = 0; // combat lean
}

function finishTexture(canvas, name) {
  const tex = makePixelTexture(canvas, { wrap: 'clamp', mipmaps: false, srgb: true, name });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function buildAnimations(rows, { idleFps = 2.5, walkFps = 8, runFps = 13, extra = null } = {}) {
  const animations = {};
  DIRECTIONS.forEach((d, row) => {
    animations[`idle_${d}`] = { frames: [{ col: 0, row }, { col: 1, row }], fps: idleFps, loop: true };
    const walk = [2, 3, 4, 5].map((col) => ({ col, row }));
    animations[`walk_${d}`] = { frames: walk, fps: walkFps, loop: true };
    animations[`run_${d}`] = { frames: walk.map((f) => ({ ...f })), fps: runFps, loop: true };
    if (extra) extra(animations, d, row);
  });
  return animations;
}

/**
 * Create a character sprite sheet (contract §4.3).
 *
 * Spec fields (all optional; defaults come from `CHARACTER_PRESETS[spec.preset]`, 'villager' if omitted).
 * A bare preset name is accepted too: `createCharacterSheet('traveler')`. `undefined` fields keep the preset value.
 * Colours are PALETTE ramp names (e.g. 'red', 'hairBlonde', 'skinTan') or hex strings (also 0xRRGGBB numbers,
 * THREE.Color and CSS colour names; unknown strings fall back to a neutral brown-grey).
 *  - preset      one of CHARACTER_PRESETS keys (or 'random' — see randomize)
 *  - seed        integer; on a preset it adds a subtle deterministic colour variation (crowds)
 *  - skin, hair  colours; hairStyle 'short'|'long'|'ponytail'|'bald'|'spiky'|'bun'
 *  - outfit      { top, bottom, accent, style?: 'tunic'|'vest'|'robe'|'dress'|'dancer'|'overalls'|'tabard', shirt? }
 *  - cape        false | colour | true | { color, style?: 'cloak'|'cape'|'short', lining? }
 *  - hat         'none'|'hood'|'wide'|'cap'|'helmet'|'circlet'|'crown'|'greathelm'  (+ hatColor?, hatBand?, feather?,
 *                hoodTrim? — a hood's fur rim colour round the face; 'crown': a tall crown of frost
 *                spikes, its ice `hatColor`, its gem `gear.staffGem`; 'greathelm': the Hushguard's barrel
 *                helm over the whole head, its T-slit glowing in the `eyes` colour, iron by default)
 *  - weapon      'none'|'sword'|'staff'|'bow'|'lute'  (+ extras 'spear', 'cane'; the party classes'
 *                'holystaff' — a gilded staff with a glowing sun —, 'icestaff' — a silver staff with a
 *                glowing ice crystal — and 'greatshield' — a tower shield with a dragon crest on the
 *                left arm and a flanged mace in the right hand; `gear.crest` 'anchor' | 'plain' another
 *                crest than the wyvern); 'hammer' (The Bells of Evermere's bell-founder's hammer: a
 *                long haft, a heavy square head, a bronze collar — glow texels with
 *                `gear.hammerGlow`)
 *  - beard       false | true ('full') | 'full'|'mustache'|'goatee' | colour (full beard in that colour)
 *  - extras      eyes (colour or 'brown'|'blue'|'green'|'grey'|'violet'|'gold'), blush, female,
 *                build 'normal'|'stout'|'elder'|'child', gear { satchel, pack, quiver, scarf, pauldrons,
 *                bracers, gloves, glasses, book, apron, sash, sashes, boots, leather, belt, staffGem, shield
 *                — the tower shield's field colour —, bladeGlow / crestGlow — the drawn sword's blade /
 *                the shield's crest painted as glow texels },
 *                randomize (true → seeded random villager filling every unspecified field)
 *
 * Sheet: frames 32×32, rows = DIRECTIONS (down, left, right, up), columns = [idle0, idle1, walk0..walk3];
 * animations `idle_<dir>` (2 f, 2.5 fps), `walk_<dir>` (4 f, 8 fps), `run_<dir>` (same 4 f, 13 fps).
 *
 * `opts.combat` (combat levels only, COMBAT.md §10.2) returns a separate sheet named
 * `character:<preset>:combat` that also carries a `poses` map (pose name → column) and the
 * one-shot combat animations; without it the result is exactly the plain sheet.
 *
 * @param {string|object|null} [spec] a spec object, a bare preset name (`createCharacterSheet('guard')`)
 *   or null (the default preset)
 * @param {{ combat?: boolean }} [opts]
 * @returns {{texture: THREE.Texture, canvas: HTMLCanvasElement, frameWidth: number, frameHeight: number,
 *   columns: number, rows: number, pixelsPerUnit: number, anchor: [number, number],
 *   animations: Record<string, {frames: {col:number,row:number}[], fps: number, loop: boolean}>,
 *   name: string, spec: object, dispose: () => void, poses?: Record<string, number>}}
 */
export function createCharacterSheet(spec = {}, opts = {}) {
  const c = resolveSpec(spec);
  const ramps = buildRamps(c);
  const FW = 32, FH = 32;
  const cols = POSES.length;
  const rows = DIRECTIONS.length;
  const sheet = new PixelCanvas(FW * cols, FH * rows);
  const p = new Painter(FW, FH);
  DIRECTIONS.forEach((dir, row) => {
    POSES.forEach((pose, col) => {
      drawCharacterFrame(p, c, dir, pose);
      resolvePainter(p, ramps, sheet, col * FW, row * FH, dir === 'right');
    });
  });
  if (opts && opts.combat) return combatSheet(c, ramps, sheet, p);
  const canvas = sheet.toCanvas();
  const texture = finishTexture(canvas, `character:${c.preset}`);
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: cols, rows,
    pixelsPerUnit: PPU, anchor: [0.5, 0], animations: buildAnimations(rows),
    name: c.preset, spec: c,
    /** Free the GPU texture (clones made by sprites share the image and must be disposed by their owners). */
    dispose() { texture.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Combat sheet (COMBAT.md §10.2)
// ---------------------------------------------------------------------------

/** Combat pose columns 6–17 of a combat character sheet, in column order. */
export const COMBAT_POSE_NAMES = Object.freeze(['wind', 'slash', 'follow', 'backhand', 'thrust', 'spin',
  'cast', 'aim', 'hurt', 'tuck', 'roll', 'down']);

/** One-shot combat animations per direction (pose names; for sandboxes — the game uses setFrame). */
const COMBAT_ANIMS = {
  attack1: ['wind', 'slash', 'follow'], attack2: ['backhand', 'follow'], attack3: ['wind', 'thrust'],
  spin: ['spin'], cast: ['cast'], aim: ['aim'], hurt: ['hurt'], dodge: ['tuck', 'roll', 'tuck'], down: ['down'],
};

/**
 * The combat sheet: columns 0–5 are the plain sheet's pixels (copied byte for byte), columns 6–17
 * the combat poses (COMBAT_POSES, in COMBAT_POSE_NAMES order); texture `character:<preset>:combat`,
 * a `poses` map (pose name → column) and the one-shot combat animations.
 * @param {ReturnType<typeof resolveSpec>} c resolved spec
 * @param {Array<number[][]>} ramps
 * @param {PixelCanvas} plain the painted 6-column sheet
 * @param {Painter} p the 32 × 32 frame painter
 * @returns {ReturnType<typeof createCharacterSheet>}
 */
function combatSheet(c, ramps, plain, p) {
  const FW = 32, FH = 32;
  const rows = DIRECTIONS.length;
  const cols = POSES.length + COMBAT_POSES.length;
  const pc = new PixelCanvas(FW * cols, FH * rows);
  const rowBytes = plain.width * 4;
  for (let y = 0; y < plain.height; y++) pc.data.set(plain.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * pc.width * 4);
  DIRECTIONS.forEach((dir, row) => {
    COMBAT_POSES.forEach((pose, i) => {
      drawCharacterFrame(p, c, dir, pose);
      resolvePainter(p, ramps, pc, (POSES.length + i) * FW, row * FH, dir === 'right');
    });
  });
  const canvas = pc.toCanvas();
  const texture = finishTexture(canvas, `character:${c.preset}:combat`);
  const poses = {};
  POSES.forEach((pose, col) => { poses[pose.key] = col; });
  COMBAT_POSES.forEach((pose, i) => { poses[pose.key] = POSES.length + i; });
  const animations = buildAnimations(rows, {
    extra: (anims, d, row) => {
      for (const [name, list] of Object.entries(COMBAT_ANIMS)) {
        anims[`${name}_${d}`] = { frames: list.map((p) => ({ col: poses[p], row })), fps: 12, loop: false };
      }
    },
  });
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: cols, rows,
    pixelsPerUnit: PPU, anchor: [0.5, 0], animations, name: c.preset, spec: c, poses,
    /** Free the GPU texture (clones made by sprites share the image and must be disposed by their owners). */
    dispose() { texture.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------

/**
 * Shaded ellipse ("blob") lit from the upper left. Pixel-centre test so integer/half-integer
 * centres give symmetric shapes.
 */
function blob(p, cx, cy, rx, ry, mat, { lx = -0.55, ly = -0.8, hi = 0.5, lo = -0.2, deep = -0.75, maxShade = 3, minShade = 0 } = {}) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const l = dx * lx + dy * ly;
      let s = l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0;
      s = Math.max(minShade, Math.min(maxShade, s));
      p.set(x, y, mat, s);
    }
  }
}

/** Material legend for creature templates. */
const CRE_L = {
  D: [M.FUR, 0], d: [M.FUR, 1], o: [M.FUR, 2], O: [M.FUR, 3], L: [M.FUR, 4],
  s: [M.FUR2, 1], S: [M.FUR2, 2],
  c: [M.FUR3, 1], C: [M.FUR3, 2], w: [M.FUR3, 3], W: [M.FUR3, 4],
  e: [M.EYE, 2], E: [M.EYE, 0], g: [M.EYE, 4],
  n: [M.NOSE, 1], N: [M.NOSE, 2], p: [M.NOSE, 3],
  b: [M.BEAK, 1], B: [M.BEAK, 3], r: [M.COMB, 1], R: [M.COMB, 2], k: [M.LINE, 0],
};

/** Gait: [nearFront, farFront, nearBack, farBack] foot offsets {dx, lift} per pose (quadrupeds, side view). */
function quadGait(pose) {
  switch (pose.walk) {
    case 0: return [{ dx: -1, lift: 0 }, { dx: 1, lift: 0 }, { dx: 1, lift: 0 }, { dx: -1, lift: 0 }];
    case 1: return [{ dx: 0, lift: 0 }, { dx: 0, lift: 1 }, { dx: 0, lift: 1 }, { dx: 0, lift: 0 }];
    case 2: return [{ dx: 1, lift: 0 }, { dx: -1, lift: 0 }, { dx: -1, lift: 0 }, { dx: 1, lift: 0 }];
    case 3: return [{ dx: 0, lift: 1 }, { dx: 0, lift: 0 }, { dx: 0, lift: 0 }, { dx: 0, lift: 1 }];
    default: return [{ dx: 0, lift: 0 }, { dx: 0, lift: 0 }, { dx: 0, lift: 0 }, { dx: 0, lift: 0 }];
  }
}

function quadLeg(p, x, top, ground, lift, dx, far, pawMat, legMat = M.FUR, w = 2) {
  const bottom = ground - lift;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const ox = Math.round(dx * t);
    for (let i = 0; i < w; i++) {
      const paw = y === bottom;
      const m = paw ? pawMat : legMat;
      let s = i === 0 ? 2 : 1;
      if (far) s -= 1;
      if (paw) s = far ? 1 : 2;
      p.set(x + ox + i, y, m, Math.max(0, s));
    }
  }
}

/** Tail as a chain of points; 2 px wide near the base; tabby stripes optional. */
function tailChain(p, pts, { mat = M.FUR, stripe = false, tipMat = null, widthBase = 2 } = {}) {
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const t = i / (pts.length - 1);
    const striped = stripe && i % 3 === 1;
    const m = tipMat && i >= pts.length - 2 ? tipMat : striped ? M.FUR2 : mat;
    p.set(x, y, m, striped ? 1 : 2);
    if (t < 0.55 && widthBase > 1) p.set(x + 1, y, m, 1);
  }
}

const walkPair = (pose) => (pose.walk === 0 || pose.walk === 1 ? [0, 1] : pose.walk === 2 || pose.walk === 3 ? [1, 0] : [0, 0]);

// --- cat -------------------------------------------------------------------

function drawCat(p, c, view, pose) {
  const G = 14; // ground row
  const lag = lagOf(pose);
  const bob = pose.bob;
  const blink = pose.key === 'idle1';
  const sw = pose.walk >= 0 ? lag.sway : (pose.key === 'idle1' ? 1 : 0);
  if (view === 'side') {
    const gait = quadGait(pose);
    // tail (behind body): curls up from the rump, sways with a lag
    const tb = 9 + bob;
    const tail = [[18, tb], [19, tb - 1], [20, tb - 2], [20 + (sw > 0 ? 1 : 0), tb - 3], [21 + (sw > 0 ? 1 : 0), tb - 4], [21 + sw, tb - 5], [20 + sw, tb - 6], [20 + sw * 2, tb - 7]];
    p.begin(null); tailChain(p, tail, { stripe: true }); p.end();
    // far legs
    p.begin(null);
    quadLeg(p, 9, 11 + bob, G, gait[1].lift, gait[1].dx, true, M.FUR3);
    quadLeg(p, 17, 11 + bob, G, gait[3].lift, gait[3].dx, true, M.FUR3);
    p.end();
    // body
    p.begin(null);
    blob(p, 13, 9.5 + bob, 5.6, 2.6, M.FUR);
    for (let x = 9; x <= 17; x += 2) { p.over(x, 7 + bob, M.FUR2, 1); p.over(x, 8 + bob, M.FUR2, 1); if (x % 4 === 1) p.over(x + 1, 9 + bob, M.FUR2, 1); }
    for (let x = 9; x <= 16; x++) p.over(x, 11 + bob, M.FUR3, 1);
    p.end();
    // near legs
    p.begin('sides', 1);
    quadLeg(p, 8, 11 + bob, G, gait[0].lift, gait[0].dx, false, M.FUR3);
    quadLeg(p, 16, 11 + bob, G, gait[2].lift, gait[2].dx, false, M.FUR3);
    p.end();
    // head
    const hy = 3 + bob;
    p.begin(null);
    p.tpl(T([
      '..O..o....',
      '.OpooDo...',
      '.OOooood..',
      'OOOEeoood.',
      'nwwOoooodd',
      '.wwwCood..',
      '..wwcd....',
    ], CRE_L), 1, hy);
    if (blink) { p.set(4, hy + 3, M.FUR, 1); p.set(5, hy + 3, M.FUR, 1); }
    p.end();
  } else if (view === 'down') {
    const legs = walkPair(pose);
    const tb = 12 + bob;
    p.begin(null); tailChain(p, [[15, tb], [16, tb - 1], [17, tb - 2], [17 + (sw > 0 ? 1 : 0), tb - 3], [17 + sw, tb - 4], [16 + sw, tb - 5], [16 + sw, tb - 6]], { stripe: true }); p.end();
    p.begin(null);
    blob(p, 12, 10.5 + bob, 3.6, 2.8, M.FUR);
    for (let y = 9; y <= 12; y++) { p.over(11, y + bob, M.FUR3, 3); p.over(12, y + bob, M.FUR3, 2); }
    p.end();
    p.begin('sides', 1);
    quadLeg(p, 9, 12 + bob, G, legs[0], 0, false, M.FUR3);
    quadLeg(p, 13, 12 + bob, G, legs[1], 0, false, M.FUR3);
    p.end();
    const hy = 2 + bob;
    p.begin(null);
    p.tpl(T([
      '.O......o.',
      '.Op....po.',
      '.OOooooood',
      'OOOooooood',
      'OOeEooEedd',
      'OOoowwoood',
      '.OwwnNwod.',
      '..wwwwcd..',
    ], CRE_L), 7, hy);
    p.set(11, hy + 2, M.FUR2, 1); p.set(12, hy + 2, M.FUR2, 1); p.set(10, hy + 3, M.FUR2, 2); p.set(13, hy + 3, M.FUR2, 1);
    if (blink) { p.set(9, hy + 4, M.FUR, 1); p.set(10, hy + 4, M.FUR, 1); p.set(13, hy + 4, M.FUR, 1); p.set(14, hy + 4, M.FUR, 1); }
    p.end();
  } else {
    const legs = walkPair(pose);
    p.begin(null);
    quadLeg(p, 9, 12 + bob, G, legs[0], 0, true, M.FUR3);
    quadLeg(p, 13, 12 + bob, G, legs[1], 0, true, M.FUR3);
    p.end();
    p.begin(null);
    blob(p, 12, 10 + bob, 4.1, 3.3, M.FUR);
    // tabby bands across the back
    for (const y of [8, 10, 12]) for (let x = 9; x <= 14; x++) if (x !== 9 || y !== 12) p.over(x, y + bob, M.FUR2, x > 12 ? 1 : 2);
    p.end();
    const hy = 2 + bob;
    p.begin('below', 1);
    blob(p, 12, hy + 4.2, 3.7, 2.9, M.FUR);
    // ears (backs) + stripes on the crown
    p.set(8, hy, M.FUR, 3); p.set(8, hy + 1, M.FUR, 3); p.set(9, hy + 1, M.FUR, 2); p.set(9, hy + 2, M.FUR, 2);
    p.set(15, hy, M.FUR, 2); p.set(15, hy + 1, M.FUR, 1); p.set(14, hy + 1, M.FUR, 1); p.set(14, hy + 2, M.FUR, 1);
    p.set(11, hy + 3, M.FUR2, 2); p.set(12, hy + 3, M.FUR2, 1); p.set(11, hy + 5, M.FUR2, 2); p.set(12, hy + 5, M.FUR2, 1);
    p.end();
    p.begin('sides', 1);
    tailChain(p, [[11, 13 + bob], [11, 12 + bob], [11 + (sw < 0 ? -1 : 0), 11 + bob], [11 + sw, 10 + bob], [11 + sw, 9 + bob], [11 + sw * 2, 8 + bob], [11 + sw * 2, 7 + bob]], { stripe: true, widthBase: 2 });
    p.end();
  }
}

// --- dog -------------------------------------------------------------------

function drawDog(p, c, view, pose) {
  const G = 18;
  const lag = lagOf(pose);
  const bob = pose.bob;
  const wag = pose.walk >= 0 ? lag.sway : (pose.key === 'idle1' ? 1 : -1);
  if (view === 'side') {
    const gait = quadGait(pose);
    p.begin(null);
    tailChain(p, [[20, 11 + bob], [21, 10 + bob], [22, 9 + bob], [22 + (wag > 0 ? 1 : 0), 8 + bob], [22 + wag, 7 + bob]], { tipMat: M.FUR3 });
    p.end();
    p.begin(null);
    quadLeg(p, 8, 13 + bob, G, gait[1].lift, gait[1].dx, true, M.FUR3, M.FUR, 2);
    quadLeg(p, 18, 13 + bob, G, gait[3].lift, gait[3].dx, true, M.FUR3, M.FUR, 2);
    p.end();
    p.begin(null);
    blob(p, 14, 11.5 + bob, 7, 3.3, M.FUR);
    for (let x = 8; x <= 19; x++) p.over(x, 14 + bob, M.FUR3, 1);
    for (let x = 7; x <= 10; x++) for (let y = 11; y <= 13; y++) p.over(x, y + bob, M.FUR3, x === 7 ? 3 : 2);
    p.end();
    p.begin('sides', 1);
    quadLeg(p, 7, 13 + bob, G, gait[0].lift, gait[0].dx, false, M.FUR3, M.FUR, 2);
    quadLeg(p, 17, 13 + bob, G, gait[2].lift, gait[2].dx, false, M.FUR3, M.FUR, 2);
    p.end();
    const hy = 3 + bob;
    p.begin(null);
    p.tpl(T([
      '...OOoo...',
      '..OOoooo..',
      '.OOEeoSSd.',
      'OOOooSSSd.',
      'wwwoooSSd.',
      'nwwwooSd..',
      '.wwwwod...',
      '..ccc.....',
    ], CRE_L), 0, hy);
    p.end();
  } else if (view === 'down') {
    const legs = walkPair(pose);
    p.begin(null);
    tailChain(p, [[15, 12 + bob], [16, 11 + bob], [17, 10 + bob], [17 + wag, 9 + bob]], { tipMat: M.FUR3 });
    p.end();
    p.begin(null);
    blob(p, 12, 13 + bob, 4, 3.4, M.FUR);
    for (let y = 11; y <= 15; y++) { p.over(11, y + bob, M.FUR3, 3); p.over(12, y + bob, M.FUR3, 2); p.over(13, y + bob, M.FUR3, 1); }
    p.end();
    p.begin('sides', 1);
    quadLeg(p, 9, 15 + bob, G, legs[0], 0, false, M.FUR3, M.FUR, 2);
    quadLeg(p, 13, 15 + bob, G, legs[1], 0, false, M.FUR3, M.FUR, 2);
    p.end();
    const hy = 3 + bob;
    p.begin(null);
    p.tpl(T([
      '..OOoooo..',
      '.OOOoooodd',
      'SOOoooooSS',
      'SSOEooEdSS',
      'SSowwwwdSS',
      'SSwwnNwdS.',
      '..wwwwwd..',
      '...ccc....',
    ], CRE_L), 7, hy);
    if (pose.key === 'idle1') { p.set(11, hy + 7, M.NOSE, 3); p.set(12, hy + 7, M.NOSE, 2); }
    p.end();
  } else {
    const legs = walkPair(pose);
    p.begin(null);
    quadLeg(p, 9, 15 + bob, G, legs[0], 0, true, M.FUR3, M.FUR, 2);
    quadLeg(p, 13, 15 + bob, G, legs[1], 0, true, M.FUR3, M.FUR, 2);
    p.end();
    p.begin(null);
    blob(p, 12, 12 + bob, 4.8, 4, M.FUR);
    // darker saddle along the spine
    for (let y = 10; y <= 14; y++) for (let x = 10; x <= 13; x++) if (!(y === 14 && (x === 10 || x === 13))) p.over(x, y + bob, M.FUR2, x < 12 ? 2 : 1);
    p.end();
    const hy = 2 + bob;
    p.begin('below', 1);
    p.tpl(T([
      '..OOoooo..',
      '.OOOoooodd',
      'SOOoooooSS',
      'SSOoooodSS',
      'SSoooooddS',
      '.S.oood.S.',
    ], CRE_L), 7, hy);
    p.end();
    p.begin('sides', 1);
    tailChain(p, [[11, 14 + bob], [11, 13 + bob], [11 + wag, 12 + bob], [11 + wag, 11 + bob], [11 + wag * 2, 10 + bob]], { tipMat: M.FUR3 });
    p.end();
  }
}

// --- chicken ---------------------------------------------------------------

function drawChicken(p, c, view, pose) {
  const G = 14;
  const bob = pose.bob;
  const peck = pose.key === 'idle1';
  const legsA = pose.walk === 0 || pose.walk === 3 ? [0, 1] : pose.walk === 1 || pose.walk === 2 ? [1, 0] : [0, 0];
  if (view === 'side') {
    p.begin(null);
    p.tpl(T(['.S', 'SS', 'sS', 's.'], CRE_L), 12, 4 + bob);
    p.end();
    p.begin(null);
    const lx = [7, 9];
    for (let k = 0; k < 2; k++) {
      const lift = legsA[k];
      const fx = pose.walk === 0 ? (k === 0 ? -1 : 1) : pose.walk === 2 ? (k === 0 ? 1 : -1) : 0;
      p.vline(lx[k], 12 + bob, G - lift, M.BEAK, k === 0 ? 2 : 1);
      p.set(lx[k] - 1 + fx, G - lift, M.BEAK, k === 0 ? 2 : 1);
      p.set(lx[k] + fx, G - lift, M.BEAK, k === 0 ? 3 : 1);
    }
    p.end();
    p.begin(null);
    blob(p, 8.5, 9.5 + bob + (peck ? 0.5 : 0), 4.3, 3.2, M.FUR, { hi: 0.35, lo: -0.35 });
    p.tpl(T(['.SSS.', 'sSSSs', '.sss.'], CRE_L), 6, 8 + bob + (peck ? 1 : 0));
    p.end();
    const hx = peck ? 1 : 3, hy = peck ? 8 + bob : 2 + bob;
    p.begin(null);
    p.tpl(T([
      '.rR..',
      'rRRR.',
      '.OOo.',
      'OEoo.',
      'bOoo.',
      '.rOo.',
      '.rOd.',
    ], CRE_L), hx, hy);
    p.set(hx - 1, hy + 4, M.BEAK, 3);
    p.end();
    if (peck) { p.begin(null); p.set(5, 9 + bob, M.FUR, 2); p.set(5, 10 + bob, M.FUR, 2); p.set(4, 10 + bob, M.FUR, 2); p.end(); }
  } else {
    const back = view === 'up';
    p.begin(null);
    for (let k = 0; k < 2; k++) {
      const x = k === 0 ? 6 : 9;
      p.vline(x, 12 + bob, G - legsA[k], M.BEAK, 2);
      p.set(x - 1, G - legsA[k], M.BEAK, 2); p.set(x + 1, G - legsA[k], M.BEAK, 1);
    }
    p.end();
    if (back) { p.begin(null); p.tpl(T(['.SS.', 'SSSs', 'sSss'], CRE_L), 6, 3 + bob); p.end(); }
    p.begin(null);
    blob(p, 8, 9.5 + bob, 3.7, 3.3, M.FUR, { hi: 0.35, lo: -0.35 });
    p.set(4, 9 + bob, M.FUR2, 2); p.set(4, 10 + bob, M.FUR2, 1); p.set(11, 9 + bob, M.FUR2, 1); p.set(11, 10 + bob, M.FUR2, 1);
    p.end();
    const hy = (peck && !back ? 6 : 2) + bob;
    p.begin(null);
    if (!back) {
      p.tpl(T([
        '..rR..',
        '.rRRr.',
        '.OOoo.',
        'OEOoEd',
        '.ObBo.',
        '..rr..',
      ], CRE_L), 5, hy);
    } else {
      p.tpl(T([
        '..rR..',
        '.rRRr.',
        '.OOoo.',
        'OOoood',
        '.Oood.',
      ], CRE_L), 5, hy);
    }
    p.end();
  }
}

// --- small bird --------------------------------------------------------------

function drawBird(p, c, view, pose) {
  const G = 14;
  // hop cycle: crouch → airborne → land → small hop
  const hop = pose.walk >= 0 ? [0, -3, 0, -1][pose.walk] : 0;
  const crouch = pose.walk === 0 || pose.walk === 2 ? 1 : 0;
  const y0 = hop + crouch;
  const flick = pose.key === 'idle1';
  if (view === 'side') {
    p.begin(null);
    p.set(11, 10 + y0 - (flick ? 1 : 0), M.FUR2, 2); p.set(12, 10 + y0 - (flick ? 2 : 0), M.FUR2, 1); p.set(12, 11 + y0 - (flick ? 1 : 0), M.FUR2, 1);
    p.end();
    p.begin(null);
    if (hop < -1) { p.set(8, 13 + y0, M.BEAK, 1); p.set(7, 13 + y0, M.BEAK, 1); }
    else { p.vline(8, 12 + y0, G, M.BEAK, 1); p.set(7, G, M.BEAK, 2); }
    p.end();
    p.begin(null);
    blob(p, 8.5, 10.5 + y0, 3, 2.2, M.FUR, { hi: 0.3, lo: -0.3 });
    for (let x = 6; x <= 9; x++) p.over(x, 12 + y0, M.FUR3, 2);
    p.set(9, 9 + y0, M.FUR2, 2); p.set(10, 10 + y0, M.FUR2, 1); p.set(9, 10 + y0, M.FUR2, 1);
    p.end();
    p.begin(null);
    blob(p, 6, 8 + y0, 1.9, 1.8, M.FUR, { hi: 0.2, lo: -0.4 });
    p.set(5, 8 + y0, M.EYE, 0);
    p.set(6, 9 + y0, M.FUR3, 3);
    p.set(3, 8 + y0, M.BEAK, 3); p.set(4, 8 + y0, M.BEAK, 2);
    p.end();
  } else {
    const back = view === 'up';
    p.begin(null);
    if (hop < -1) { p.set(6, 13 + y0, M.BEAK, 1); p.set(9, 13 + y0, M.BEAK, 1); }
    else { p.vline(6, 13 + y0, G, M.BEAK, 1); p.vline(9, 13 + y0, G, M.BEAK, 1); p.set(5, G, M.BEAK, 2); p.set(10, G, M.BEAK, 1); }
    p.end();
    if (back) { p.begin(null); p.tpl(T(['.SS.', '.Ss.', '..s.'], CRE_L), 6, 12 + y0); p.end(); }
    p.begin(null);
    blob(p, 8, 10.8 + y0, 3.1, 2.4, M.FUR, { hi: 0.3, lo: -0.3 });
    if (!back) { for (let y = 10; y <= 12; y++) for (let x = 6; x <= 9; x++) p.over(x, y + y0, M.FUR3, x < 8 ? 3 : 2); }
    else { p.over(5, 10 + y0, M.FUR2, 2); p.over(10, 10 + y0, M.FUR2, 1); p.over(6, 11 + y0, M.FUR2, 2); p.over(9, 11 + y0, M.FUR2, 1); }
    p.end();
    p.begin(null);
    blob(p, 8, 7.6 + y0, 2.3, 2, M.FUR, { hi: 0.2, lo: -0.4 });
    if (!back) {
      p.set(6, 7 + y0, M.EYE, 0); p.set(9, 7 + y0, M.EYE, 0);
      p.set(7, 8 + y0, M.BEAK, 3); p.set(8, 8 + y0, M.BEAK, 2);
    } else {
      p.set(7, 6 + y0, M.FUR2, 2); p.set(8, 6 + y0, M.FUR2, 1);
    }
    p.end();
  }
}

const CREATURE_DEFS = {
  cat: {
    fw: 24, fh: 16, draw: drawCat, idleFps: 2, walkFps: 9, runFps: 14,
    colors: { fur: '#d9822b', fur2: '#8c4a1c', fur3: '#f2e3c4', eyes: '#7ab04a', nose: '#e08a8a' },
  },
  dog: {
    fw: 28, fh: 20, ox: 2, draw: drawDog, idleFps: 3, walkFps: 9, runFps: 14,
    colors: { fur: '#a8703e', fur2: '#5a3a24', fur3: '#f2e3c4', eyes: '#3a2418', nose: '#2a1c1c' },
  },
  chicken: {
    fw: 18, fh: 16, ox: 1, draw: drawChicken, idleFps: 3, walkFps: 8, runFps: 12,
    colors: { fur: '#f4efe6', fur2: '#b8844e', fur3: '#fff8ee', eyes: '#1e1418', beak: '#e8b030', comb: '#d23a2e' },
  },
  bird: {
    fw: 16, fh: 16, draw: drawBird, idleFps: 2.5, walkFps: 8, runFps: 12,
    colors: { fur: '#8a6040', fur2: '#5a3a24', fur3: '#e8dcc0', eyes: '#141018', beak: '#e0a040' },
  },
};

/**
 * Create a creature sprite sheet (same row / animation naming as characters).
 * @param {'cat'|'dog'|'chicken'|'bird'} kind
 * @param {{seed?:number, fur?:string, fur2?:string, fur3?:string, eyes?:string, beak?:string, comb?:string, nose?:string}} [spec]
 *   optional colour overrides (hex or PALETTE ramp names)
 * @returns {SpriteSheet & { name: string, dispose: () => void }}
 *   (see createCharacterSheet)
 */
export function createCreatureSheet(kind, spec = {}) {
  spec = stripUndefined(spec);
  const def = ownValue(CREATURE_DEFS, kind) || CREATURE_DEFS.cat;
  const col = { ...def.colors, ...spec };
  const c = { ...col, kind, seed: normSeed(spec.seed ?? hashString(String(kind))) };
  const ramps = new Array(MAT_COUNT).fill(null);
  ramps[M.FUR] = rampForKind(col.fur);
  ramps[M.FUR2] = rampForKind(col.fur2);
  ramps[M.FUR3] = rampForKind(col.fur3);
  ramps[M.NOSE] = rampForKind(col.nose || '#d08080');
  ramps[M.BEAK] = rampForKind(col.beak || '#e0a040');
  ramps[M.COMB] = rampForKind(col.comb || '#c83a30');
  const eye = parseColor(normColor(col.eyes, '#202020'));
  ramps[M.EYE] = [OUTLINE, mixColor(OUTLINE, eye, 0.5), [...eye], shadeColor(eye, 0.3), [255, 255, 255, 255]];
  ramps[M.LINE] = [OUTLINE, OUTLINE, OUTLINE, OUTLINE, OUTLINE];
  for (let i = 0; i < MAT_COUNT; i++) if (!ramps[i]) ramps[i] = ramps[M.FUR];
  const FW = def.fw, FH = def.fh;
  const cols = POSES.length, rows = DIRECTIONS.length;
  const sheet = new PixelCanvas(FW * cols, FH * rows);
  const p = new Painter(FW, FH);
  p.ox = def.ox || 0;
  DIRECTIONS.forEach((dir, row) => {
    POSES.forEach((pose, colI) => {
      p.clear();
      def.draw(p, c, dir === 'down' ? 'down' : dir === 'up' ? 'up' : 'side', pose);
      resolvePainter(p, ramps, sheet, colI * FW, row * FH, dir === 'right');
    });
  });
  const canvas = sheet.toCanvas();
  const texture = finishTexture(canvas, `creature:${kind}`);
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: cols, rows,
    pixelsPerUnit: PPU, anchor: [0.5, 0], name: kind,
    animations: buildAnimations(rows, { idleFps: def.idleFps, walkFps: def.walkFps, runFps: def.runFps }),
    dispose() { texture.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Painter kit (MonsterSprites and other sheet painters in the engine)
// ---------------------------------------------------------------------------

/**
 * Internal building blocks shared with MonsterSprites.js (COMBAT.md §10.2): the label painter and
 * its resolver, template helper, material ids, creature legend and helpers, ramp / texture /
 * animation builders, the plain poses and their secondary motion, plus `glowTexel` / `GLOW_ALPHA`
 * (alpha-204 glow texels) and the outline colour. Not a stable public API.
 */
export const _painterKit = {
  Painter, resolvePainter, T, M, CRE_L, blob, quadGait, quadLeg, tailChain, rampForKind, finishTexture,
  buildAnimations, POSES, lagOf, glowTexel, GLOW_ALPHA, OUTLINE, ERASE,
  // (and CharacterKit.js's: the hats' legend and table, the combat frame's clip)
  HAT_L, HATS, inFrame,
};
