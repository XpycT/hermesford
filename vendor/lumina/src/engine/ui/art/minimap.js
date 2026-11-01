/**
 * The pixel maps' art (docs/specs/PIXEL_UI.md §2, §5), after mockup G's minimap and map canvas: a
 * flat tile-colour map with cliff and light rows, the muted wash, the dithered view wedge, the
 * stepped vignette, the markers as pixel gems and dots, foes beyond the window as pips on its edge,
 * and the player's 9 × 9 arrow in eight facings (G drew four; the diagonals are drawn in the same
 * hand).
 *
 * Two families of functions:
 * - G's (`mapCanvas`, `renderPixelMap`, `miniMap`, `marker`, `playerArrow`, `viewWedge`, `vignette`):
 *   a painter `p` per call, as G draws its screens;
 * - the game's (`pixelBase`, `resampleMap`, `markerSprite`, `arrowSprite`, `wedgeSprite`,
 *   `vignetteSprite`, `legendKey`, `pulseRing`): the same pixels cached as small canvases, so the
 *   HUD minimap and the world map (src/engine/ui/Minimap.js) redraw each frame with a few drawImage
 *   calls.
 *
 * G's map uses its own tile classes (g G f F s p c k m r t b w and ' ' for the void); `levelMapCells`
 * reads a level's tiles into them through its legend. A painted map (LevelMap.renderLevelMap, the
 * campaign's overview) is turned into art pixels by `resampleMap` (the mean colour of what each art
 * pixel covers).
 */
import { pal, GEMS, gemRamp } from './palette.js';
import { gem, stamp } from './gilt.js';
import { art, pixelCanvas } from './painter.js';

/** @import { PixelPainter } from './painter.js' */

/**
 * A map in G's tile classes: `tiles` and `heights` are one string per row (z), one character per
 * tile (x); heights in base 36 (the level format's).
 * @typedef {{ width: number, depth: number, tiles: string[], heights: string[] }} MapCells
 */

/** The class colours (the level's own tile colours, LevelFormat.js), from the palette's m-* tokens. */
export const mapColors = () => {
  const k = pal();
  return { g: k['m-g'], G: k['m-G'], f: k['m-f'], F: k['m-F'], s: k['m-s'], p: k['m-p'], c: k['m-c'], k: k['m-k'], m: k['m-m'], r: k['m-r'], t: k['m-t'], b: k['m-b'], w: k['m-w'], ' ': k['m-void'] };
};

/** The classes of a lazily registered texture set's tops: top → [walkable class, blocked class]. @type {Record<string, [string, string]>} */
const EXTRA_CLASSES = {};

/**
 * Add the map classes of a lazily registered texture set's tops (the season kit's: props/
 * SeasonTrees.js — G has no snow class, so its snow, ice and limestone take the pale stone's).
 * @param {Record<string, [string, string]>} classes top → [walkable class, blocked class]
 */
export function registerMapClasses(classes) {
  Object.assign(EXTRA_CLASSES, classes);
}

/**
 * The tile class of a level legend entry (a TileMap legend def).
 * @param {any} def
 * @returns {string}
 */
function classOf(def) {
  if (!def || typeof def !== 'object' || def.void) return ' ';
  if (def.water) return 'w';
  if (def.stairs) return 'c';
  const top = String(def.top ?? '');
  const blocked = def.walkable === false;
  switch (top) {
    case 'grass': return 'g';
    case 'grass_dark': return blocked ? 't' : 'G';
    case 'grass_flowers': return 'f';
    case 'farmland': return 'F';
    case 'sand': return 's';
    case 'dirt_path': case 'dirt': return 'p';
    case 'cobblestone': return 'c';
    case 'stone_tiles': return 'k';
    case 'moss_stone': return blocked ? 'r' : 'm';
    case 'wood_deck': return 'b';
    // the arid tops of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §6.2), in G's
    // nearest classes
    case 'arid_dirt': case 'cracked_earth': case 'scorched': return 'p';
    case 'dry_grass': case 'red_sand': return 's';
    case 'sandstone': case 'flagstone': case 'scree': case 'ash': return blocked ? 'r' : 'k';
    case 'basalt': return 'r';
    default: {
      // (a lazily registered set's tops: `registerMapClasses`)
      const x = Object.prototype.hasOwnProperty.call(EXTRA_CLASSES, top) ? EXTRA_CLASSES[top] : null;
      return x ? x[blocked ? 1 : 0] : blocked ? 'r' : 'g';
    }
  }
}

/**
 * A level's tiles in G's classes (through its legend; an unknown character is grass).
 * @param {{ width: number, depth: number, tiles: string[], heights: string[], legend?: Record<string, any> }} level
 * @returns {MapCells}
 */
export function levelMapCells(level) {
  const legend = level.legend ?? {};
  const cls = new Map();
  const tiles = level.tiles.map((row) => {
    let s = '';
    for (const ch of row) {
      if (!cls.has(ch)) cls.set(ch, Object.prototype.hasOwnProperty.call(legend, ch) ? classOf(legend[ch]) : 'g');
      s += cls.get(ch);
    }
    return s;
  });
  return { width: level.width, depth: level.depth, tiles, heights: level.heights };
}

/**
 * The map painted `ppt` art px per tile in tile-class colours (missing classes fall back to grass),
 * with a darker row where the ground drops toward the camera (+z) when `cliff` is a colour and a
 * lighter row on a raised tile's north side when `light` is (G's `mapCanvas`).
 * @param {MapCells} m
 * @param {Record<string, string>} [colors]
 * @param {{ ppt?: number, cliff?: string|null, light?: string|null }} [o]
 * @returns {HTMLCanvasElement}
 */
export function mapCanvas(m, colors = mapColors(), { ppt = 4, cliff = null, light = null } = {}) {
  const H = (c) => parseInt(c, 36) || 0;
  return pixelCanvas(m.width * ppt, m.depth * ppt, (p) => {
    for (let z = 0; z < m.depth; z++) {
      for (let x = 0; x < m.width; x++) {
        const t = m.tiles[z]?.[x] ?? ' ';
        p.rect(x * ppt, z * ppt, ppt, ppt, colors[t] ?? colors.g);
        const h = H(m.heights[z]?.[x]);
        if (cliff && z + 1 < m.depth && H(m.heights[z + 1]?.[x]) < h) p.rect(x * ppt, z * ppt + ppt - 1, ppt, 1, cliff);
        if (light && z > 0 && H(m.heights[z - 1]?.[x]) < h) p.rect(x * ppt, z * ppt, ppt, 1, light);
      }
    }
  });
}

/**
 * The minimap's base: a level painted `ppt` art px per tile, flat tile colours with the cliff and
 * light rows (G's look); with `objects`, the footprints the painted map shows (LevelMap.js) drawn
 * flat on top — fences, bridges, trees, rocks, crags, haystacks, houses, the windmill, market stalls, wells
 * — so a house or a bridge over a river is on the minimap as it is on the world map. Campfires,
 * chests and waystones are left to the live markers. The class colours carry the tint set last
 * (`setMapTint`); the bases painted last are repainted in place when it changes.
 * @param {{ width: number, depth: number, tiles: string[], heights: string[], legend?: Record<string, any>, objects?: any[] }} level
 * @param {number} [ppt]
 * @param {{ objects?: boolean }} [o]
 */
export function renderPixelMap(level, ppt = 3, { objects = false } = {}) {
  const c = paintPixelMap(level, ppt, objects);
  PAINTED.push({ c, level, ppt, objects });
  if (PAINTED.length > 4) PAINTED.shift();
  return c;
}

/** @param {any} level @param {number} ppt @param {boolean} objects */
function paintPixelMap(level, ppt, objects) {
  const k = pal();
  const c = mapCanvas(levelMapCells(level), { ...mapColors(), ...tint }, { ppt, cliff: k['m-cliff'], light: k['m-light'] });
  if (objects && Array.isArray(level.objects)) paintObjects(c, level.objects, ppt);
  return c;
}

/** Class colours over G's on the minimap now (a frozen level's snow and ice), or null. @type {Record<string, string>|null} */
let tint = null;
/** The bases painted last (≤ 4: the running level's, a kept one's): repainted in place by `setMapTint`. */
const PAINTED = [];

/**
 * Tint the minimap's class colours (the seasons' look sets a frozen level's snow and ice — src/game/
 * season/SeasonLook.js — and clears it after the bell and on every level applied): the bases
 * painted last are repainted in place, so the minimap shows it at once.
 * @param {Record<string, string>|null} colors
 */
export function setMapTint(colors) {
  if (tint === colors) return;
  tint = colors;
  for (const p of PAINTED) {
    const g = p.c.getContext('2d');
    g.clearRect(0, 0, p.c.width, p.c.height);
    g.drawImage(paintPixelMap(p.level, p.ppt, p.objects), 0, 0);
  }
}

/** The painted map's object colours (LevelMap.js), for the flat footprints. */
const OBJ = Object.freeze({
  roof: Object.freeze({ roof_red: '#a4493b', roof_blue: '#4a638c', roof_thatch: '#b89452', roof_slate: '#5b606f', roof_terracotta: '#b65a32', roof_charred: '#3a302a' }),
  fence: '#6b4a2e', plank: '#a77a48', plankEdge: '#5e4128', rock: '#8a8580', hay: '#d3b25c', stall: '#c8574a',
  well: '#9a948c', wellWater: '#2f5f82', sail: '#f2e6c4',
  tree: Object.freeze({ autumn: '#b5652e', pine: '#2d5a36', birch: '#6f9a48', oak: '#3e7536', juniper: '#4a6a3a', deadwood: '#8a7656', palm: '#5c8c3a', cypress: '#2a4a2e', blossom: '#e6c4d4', maple: '#b8402a', goldbirch: '#d0a040', snowpine: '#4a6a5e', bare: '#7a6a58' }),
  stone: Object.freeze({ sandstone: '#c49a62', redrock: '#a8553a', basalt: '#3c3a42', ice: '#8fd6ea' }),
  hull: '#8a6440',
});

/**
 * A colour darker or lighter by `t` (−1 … 1) toward black or white.
 * @param {string} hex '#rrggbb'
 * @param {number} t
 */
function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const to = t < 0 ? 0 : 255, a = Math.abs(t);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * a).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The flat object footprints of `renderPixelMap` on its canvas: every art pixel whose centre lies
 * inside a footprint (world units: pixel (i, j) is at ((i + ½) / ppt, (j + ½) / ppt)); a building's
 * rim one shade darker and its ridge one lighter, a bridge's sides darker.
 * @param {HTMLCanvasElement} canvas
 * @param {any[]} objects
 * @param {number} ppt
 */
function paintObjects(canvas, objects, ppt) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const own = (t, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(t, key) ? t[key] : null);
  const px = (i, j, col) => { if (i >= 0 && j >= 0 && i < W && j < H) { ctx.fillStyle = col; ctx.fillRect(i, j, 1, 1); } };
  /**
   * The pixels of a shape (a test on world points) in its pixel box, with its rim (a pixel with a
   * 4-neighbour outside).
   * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 world box
   * @param {(x: number, z: number) => boolean} inside
   * @param {(i: number, j: number, rim: boolean) => string|null} colour
   */
  const fill = (x0, z0, x1, z1, inside, colour) => {
    const i0 = Math.max(0, Math.floor(x0 * ppt) - 1), i1 = Math.min(W - 1, Math.ceil(x1 * ppt) + 1);
    const j0 = Math.max(0, Math.floor(z0 * ppt) - 1), j1 = Math.min(H - 1, Math.ceil(z1 * ppt) + 1);
    const at = (i, j) => inside((i + 0.5) / ppt, (j + 0.5) / ppt);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!at(i, j)) continue;
        const rim = !at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1);
        const col = colour(i, j, rim);
        if (col) px(i, j, col);
      }
    }
  };
  /** A turned rectangle w × d round (o.x, o.z) (LevelMap's `rect`): fill, rim, the ridge along its x. */
  const rect = (o, w, d, col) => {
    const a = -num(o.rotation, 0), ca = Math.cos(a), sa = Math.sin(a);
    const local = (x, z) => { const dx = x - o.x, dz = z - o.z; return [dx * ca + dz * sa, -dx * sa + dz * ca]; };
    const R = Math.hypot(w, d) / 2;
    const rim = shade(col, -0.45), ridge = shade(col, 0.22);
    fill(o.x - R, o.z - R, o.x + R, o.z + R, (x, z) => { const [u, v] = local(x, z); return Math.abs(u) <= w / 2 && Math.abs(v) <= d / 2; },
      (i, j, isRim) => {
        if (isRim) return rim;
        const [, v] = local((i + 0.5) / ppt, (j + 0.5) / ppt);
        return Math.abs(v) < 0.5 / ppt ? ridge : col;
      });
  };
  /** A round footprint of radius r: fill, rim darker (or `rimCol`), a lit pixel up-left. */
  const disc = (x, z, r, col, rimCol = null) => {
    const rr = Math.max(r, 0.6 / ppt);
    fill(x - rr, z - rr, x + rr, z + rr, (X, Z) => (X - x) ** 2 + (Z - z) ** 2 <= rr * rr, (i, j, isRim) => (isRim && rimCol ? rimCol : col));
  };
  /** A capsule from (x0, z0) to (x1, z1), `w` wide. */
  const capsule = (o, w, col, edge) => {
    const dx = o.x1 - o.x0, dz = o.z1 - o.z0, L2 = dx * dx + dz * dz || 1e-9, r = Math.max(w / 2, 0.5 / ppt);
    const dist2 = (x, z) => {
      const t = Math.max(0, Math.min(1, ((x - o.x0) * dx + (z - o.z0) * dz) / L2));
      return (x - o.x0 - t * dx) ** 2 + (z - o.z0 - t * dz) ** 2;
    };
    fill(Math.min(o.x0, o.x1) - r, Math.min(o.z0, o.z1) - r, Math.max(o.x0, o.x1) + r, Math.max(o.z0, o.z1) + r,
      (x, z) => dist2(x, z) <= r * r, (i, j, isRim) => (isRim && edge ? edge : col));
  };
  const seg = (o) => [o.x0, o.z0, o.x1, o.z1].every(Number.isFinite);
  // flat things first, then trees, then buildings on top (LevelMap's order)
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'fence' && seg(o)) capsule(o, 0.01, OBJ.fence, null);
    else if (o.type === 'bridge' && seg(o)) capsule(o, num(o.opts?.width, 2), OBJ.plank, OBJ.plankEdge);
  }
  for (const o of objects) {
    if (!o || typeof o !== 'object' || !Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    if (o.type === 'tree') {
      const col = own(OBJ.tree, o.opts?.kind) ?? OBJ.tree.oak;
      disc(o.x, o.z, 0.7, col, shade(col, -0.35));
    } else if (o.type === 'rock') disc(o.x, o.z, 0.35 * num(o.opts?.size, 1), OBJ.rock, shade(OBJ.rock, -0.3));
    else if (o.type === 'haystack') disc(o.x, o.z, 0.55, OBJ.hay, shade(OBJ.hay, -0.3));
    else if (o.type === 'crag') {
      const col = own(OBJ.stone, o.opts?.stone) ?? OBJ.stone.sandstone;
      disc(o.x, o.z, Math.max(0.6, num(o.opts?.width, 2.5) * 0.45), col, shade(col, -0.4));
    }
  }
  for (const o of objects) {
    if (!o || typeof o !== 'object' || !Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    if (o.type === 'house') rect(o, num(o.opts?.width, 4), num(o.opts?.depth, 3), own(OBJ.roof, o.opts?.roof) ?? OBJ.roof.roof_red);
    else if (o.type === 'marketStall') rect(o, num(o.opts?.width, 3), 1.4, OBJ.stall);
    else if (o.type === 'belfry') rect(o, 2.2, 2.2, OBJ.roof.roof_slate);
    else if (o.type === 'ship') rect(o, 2.4, 6.5, OBJ.hull);
    else if (o.type === 'windmill') {
      const col = own(OBJ.roof, o.opts?.roof) ?? OBJ.roof.roof_thatch;
      capsule({ x0: o.x - 1.6, z0: o.z - 1.6, x1: o.x + 1.6, z1: o.z + 1.6 }, 0.01, OBJ.sail, null);
      capsule({ x0: o.x + 1.6, z0: o.z - 1.6, x1: o.x - 1.6, z1: o.z + 1.6 }, 0.01, OBJ.sail, null);
      disc(o.x, o.z, 1.1, col, shade(col, -0.45));
    } else if (o.type === 'well') {
      disc(o.x, o.z, 0.75, OBJ.well, shade(OBJ.well, -0.4));
      disc(o.x, o.z, 0.3, OBJ.wellWater);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// A painted map in art pixels
// ---------------------------------------------------------------------------------------------

/**
 * A painted map: LevelMap.renderLevelMap's `{ canvas, pixelsPerTile, width, depth }` (world (x, z) ↦
 * canvas (x · ppt, z · ppt)), or a campaign's overview of several of them.
 * @typedef {{ canvas: HTMLCanvasElement, pixelsPerTile: number, width: number, depth: number }} PaintedMap
 */

/**
 * The pixels of a painted map's canvas, read once per canvas (a campaign hands a kept level's map
 * back on every return; repeated readbacks of one canvas make the browser warn about
 * `willReadFrequently`). Null when the canvas cannot be read.
 * @type {WeakMap<HTMLCanvasElement, ImageData|null>}
 */
const PIXELS = new WeakMap();
/** @param {HTMLCanvasElement} canvas */
function pixelsOf(canvas) {
  if (PIXELS.has(canvas)) return PIXELS.get(canvas);
  let data = null;
  try {
    if (canvas.width > 0 && canvas.height > 0) data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
  } catch {
    data = null;
  }
  PIXELS.set(canvas, data);
  return data;
}

/**
 * The CSS colour of a painted map's top-left pixel (the level's border, or the overview's ground
 * round the levels), for the margin of a map smaller than its window; null when it is transparent
 * or unreadable.
 * @param {PaintedMap|null|undefined} map
 * @returns {string|null}
 */
export function mapEdgeColour(map) {
  const d = map?.canvas ? pixelsOf(map.canvas) : null;
  if (!d || d.data[3] < 128) return null;
  return `rgb(${d.data[0]}, ${d.data[1]}, ${d.data[2]})`;
}

/**
 * The source spans of each destination pixel along one axis: n source pixels into m destination
 * pixels, each destination pixel the area mean of the source pixels it covers.
 * @param {number} n
 * @param {number} m
 * @returns {{ i0: Int32Array, i1: Int32Array, w: Float32Array, off: Int32Array }}
 */
function spans(n, m) {
  const r = n / m;
  const i0 = new Int32Array(m), i1 = new Int32Array(m), off = new Int32Array(m + 1);
  const ws = [];
  for (let d = 0; d < m; d++) {
    const a = d * r, b = Math.min(n, (d + 1) * r);
    const s0 = Math.floor(a), s1 = Math.min(n - 1, Math.ceil(b) - 1);
    i0[d] = s0; i1[d] = s1; off[d] = ws.length;
    for (let s = s0; s <= s1; s++) ws.push(Math.max(0, Math.min(b, s + 1) - Math.max(a, s)) / r);
  }
  off[m] = ws.length;
  return { i0, i1, w: Float32Array.from(ws), off };
}

/** Resampled painted maps: canvas → (art px per world unit → canvas). @type {WeakMap<HTMLCanvasElement, Map<number, HTMLCanvasElement>>} */
const RESAMPLED = new WeakMap();

/**
 * A painted map in art pixels, `ppt` art px per world unit (a whole number, or a fraction for a map
 * too big for its window): each art pixel the area mean of the painted pixels it covers
 * (premultiplied, so the void round a level does not darken its edge), opaque or transparent — no
 * pixel in between. Cached per painted canvas and `ppt`. An unreadable canvas gives a canvas of
 * the right size drawn with the browser's own smoothing.
 * @param {PaintedMap} map
 * @param {number} ppt
 * @returns {HTMLCanvasElement}
 */
export function resampleMap(map, ppt) {
  const src = map.canvas;
  let byPpt = RESAMPLED.get(src);
  if (!byPpt) { byPpt = new Map(); RESAMPLED.set(src, byPpt); }
  const hit = byPpt.get(ppt);
  if (hit) return hit;
  const W = Math.max(1, Math.round(map.width * ppt)), H = Math.max(1, Math.round(map.depth * ppt));
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const data = pixelsOf(src);
  if (!data) {
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, W, H);
  } else {
    const sw = data.width, sh = data.height, s = data.data;
    const X = spans(sw, W), Y = spans(sh, H);
    // horizontal pass: sh rows × W columns, premultiplied rgb + alpha
    const tmp = new Float32Array(sh * W * 4);
    for (let y = 0; y < sh; y++) {
      for (let d = 0; d < W; d++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = X.i0[d], k = X.off[d]; i <= X.i1[d]; i++, k++) {
          const o = (y * sw + i) * 4, wa = X.w[k] * s[o + 3];
          r += s[o] * wa; g += s[o + 1] * wa; b += s[o + 2] * wa; a += wa;
        }
        const t = (y * W + d) * 4;
        tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
      }
    }
    const img = octx.createImageData(W, H);
    const o = img.data;
    for (let d = 0; d < H; d++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = Y.i0[d], k = Y.off[d]; j <= Y.i1[d]; j++, k++) {
          const t = (j * W + x) * 4, w = Y.w[k];
          r += tmp[t] * w; g += tmp[t + 1] * w; b += tmp[t + 2] * w; a += tmp[t + 3] * w;
        }
        // a is the mean alpha (0–255); the colour is the alpha-weighted mean
        if (a < 127.5) continue;
        const q = (d * W + x) * 4;
        o[q] = Math.round(r / a); o[q + 1] = Math.round(g / a); o[q + 2] = Math.round(b / a); o[q + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
  }
  out.classList.add('px');
  byPpt.set(ppt, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The player's arrow
// ---------------------------------------------------------------------------------------------

/**
 * The player's arrow (today's: cream with a gold half), hand-drawn 9 × 9 for each facing: a cream
 * body on the lit side (left or top), the gilt half on the shaded side, an ink outline. G drew the
 * four straight facings; the diagonals are the same dart turned (the north-east one drawn, the other
 * three its mirror images), their cream half the one toward the light (north-west).
 */
export const ARROW = Object.freeze({
  up: ['....o....', '...oCo...', '..oCCLo..', '..oCCLo..', '.oCCCLLo.', '.oCCCLLo.', 'oCCCoLLLo', 'oCCo.oLLo', 'ooo...ooo'],
  down: ['ooo...ooo', 'oCCo.oLLo', 'oCCCoLLLo', '.oCCCLLo.', '.oCCCLLo.', '..oCCLo..', '..oCCLo..', '...oCo...', '....o....'],
  left: ['......ooo', '....ooCCo', '..ooCCCCo', '.oCCCCCo.', 'oCCCCCo..', '.oLLLLLo.', '..ooLLLLo', '....ooLLo', '......ooo'],
  right: ['ooo......', 'oCCoo....', 'oCCCCoo..', '.oCCCCCo.', '..oCCCCCo', '.oLLLLLo.', 'oLLLLoo..', 'oLLoo....', 'ooo......'],
  upRight: ['......oo.', '....ooCCo', '.oooCCCLo', 'oCCCCCLo.', '.oCCCLLo.', '..ooLLo..', '...oLLo..', '....oLo..', '.....o...'],
  upLeft: ['.oo......', 'oCCoo....', 'oLCCCooo.', '.oLCCCCCo', '.oLLCCCo.', '..oLLoo..', '..oLLo...', '..oLo....', '...o.....'],
  downRight: ['.....o...', '....oLo..', '...oLLo..', '..ooLLo..', '.oCCCLLo.', 'oCCCCCLo.', '.oooCCCLo', '....ooCCo', '......oo.'],
  downLeft: ['...o.....', '..oCo....', '..oCCo...', '..oCCoo..', '.oCCCLLo.', '.oCCLLLLo', 'oCCLLooo.', 'oCLoo....', '.oo......'],
});

/** The eight facings, clockwise from north (up the map). */
export const FACINGS = Object.freeze(['up', 'upRight', 'right', 'downRight', 'down', 'downLeft', 'left', 'upLeft']);

/**
 * The nearest of the eight facings to a direction on the ground (x east, z south: screen-down is
 * +z); north for a zero vector.
 * @param {number} x
 * @param {number} z
 * @returns {string}
 */
export function facingOf(x, z) {
  if (!x && !z) return 'up';
  const a = Math.atan2(x, -z);
  return FACINGS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/**
 * The player's arrow centred on (cx, cy).
 * @param {PixelPainter} p
 * @param {number} cx
 * @param {number} cy
 * @param {string} facing one of FACINGS
 */
export function playerArrow(p, cx, cy, facing) {
  const k = pal();
  p.rows(cx - 4, cy - 4, [...(Object.prototype.hasOwnProperty.call(ARROW, facing) ? ARROW[facing] : ARROW.up)], { o: k.ink0, C: k.kf0, L: k.g4 });
}

// ---------------------------------------------------------------------------------------------
// Wedge, vignette
// ---------------------------------------------------------------------------------------------

/**
 * The camera's view wedge: a sparse cream dither fanning out from (px, py) — 3 to 24 art px out,
 * ±0.42 rad about `angle` (0: north, up the map; radians clockwise).
 * @param {PixelPainter} p
 * @param {number} V the window's size (art px)
 * @param {number} px
 * @param {number} py
 * @param {number} [angle]
 */
export function viewWedge(p, V, px, py, angle = 0) {
  const k = pal();
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d < 3 || d > 24) continue;
      let a = Math.atan2(dx, -dy) - angle;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > 0.42) continue;
      if ((x + y) % 2 === 0 && (d < 16 || y % 2 === 0)) p.px(x, y, k['m-wedge']);
    }
  }
}

/**
 * The stepped vignette into the frame (three rows: two flat, one checker).
 * @param {PixelPainter} p
 * @param {number} V
 * @param {number} [Vh] the height, when the window is not square
 */
export function vignette(p, V, Vh = V) {
  const k = pal();
  for (let y = 0; y < Vh; y++) {
    for (let x = 0; x < V; x++) {
      const e = Math.min(x, y, V - 1 - x, Vh - 1 - y);
      if (e === 0) p.px(x, y, k['m-vig0']);
      else if (e === 1) p.px(x, y, k['m-vig1']);
      else if (e === 2 && (x + y) % 2 === 0) p.px(x, y, k['m-vig2']);
    }
  }
}

/** The wedge's reach (art px) and the steps it is cached at round the circle. */
const WEDGE_R = 24, WEDGE_STEPS = 64;
/** @type {Map<string, HTMLCanvasElement>} */
const WEDGES = new Map();
/**
 * The view wedge as a (2·24 + 1)² canvas centred on its apex (draw it at the player − WEDGE_APEX):
 * viewWedge's pixels for an apex at (px, py) of the window — `angle` snapped to 1/64 of a turn, the
 * dither kept to the window's grid by the apex's parities ((px + py) % 2 for the checker, py % 2 for
 * the sparse rows). Cached.
 * @param {number} angle radians clockwise from north
 * @param {number} px the apex in the window (art px)
 * @param {number} py
 * @returns {HTMLCanvasElement}
 */
export function wedgeSprite(angle, px, py) {
  const step = ((Math.round((angle / (Math.PI * 2)) * WEDGE_STEPS) % WEDGE_STEPS) + WEDGE_STEPS) % WEDGE_STEPS;
  const sum = ((px + py) % 2 + 2) % 2, row = ((py % 2) + 2) % 2;
  const key = `${step}|${sum}|${row}`;
  let c = WEDGES.get(key);
  if (!c) {
    const S = WEDGE_R * 2 + 1;
    c = art(S, S, (p) => {
      const k = pal();
      const a0 = (step / WEDGE_STEPS) * Math.PI * 2;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = x - WEDGE_R, dy = y - WEDGE_R, d = Math.hypot(dx, dy);
          if (d < 3 || d > WEDGE_R) continue;
          let a = Math.atan2(dx, -dy) - a0;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(a) > 0.42) continue;
          // the window's pixel is (px + dx, py + dy): viewWedge's test on it
          if (((sum + dx + dy) % 2 + 2) % 2 === 0 && (d < 16 || ((row + dy) % 2 + 2) % 2 === 0)) p.px(x, y, k['m-wedge']);
        }
      }
    });
    WEDGES.set(key, c);
  }
  return c;
}
/** The apex's offset inside `wedgeSprite` (draw at player − WEDGE_APEX). */
export const WEDGE_APEX = WEDGE_R;

/** @type {Map<string, HTMLCanvasElement>} */
const VIGNETTES = new Map();
/**
 * The stepped vignette of a w × h window as a canvas (cached per size).
 * @param {number} w
 * @param {number} [h]
 */
export function vignetteSprite(w, h = w) {
  const key = `${w}x${h}`;
  let c = VIGNETTES.get(key);
  if (!c) { c = art(w, h, (p) => vignette(p, w, h)); VIGNETTES.set(key, c); }
  return c;
}

// ---------------------------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------------------------

/**
 * Today's colours of the points of interest without a look of G's own (Minimap.js MARKER_COLORS):
 * their small gems take these as the stone.
 */
export const POI_COLORS = Object.freeze({ door: '#e9d49a', sign: '#f2d27a', well: '#9cc8f0', object: '#f2d27a' });

/** A marker's reach (with its outline) by kind: one closer than a clear pixel to the arrow moves aside. */
export const MARKER_REACH = Object.freeze({ enemy: 2, boss: 4, campfire: 2, waystone: 3, npc: 2, party: 3, chest: 3, door: 2, sign: 2, well: 2, object: 2 });
/** The order markers are drawn in (later on top). */
export const MARKER_ORDER = Object.freeze({ door: 0, sign: 0, well: 0, object: 0, campfire: 0, chest: 1, waystone: 1, npc: 2, enemy: 3, boss: 3, party: 4 });

/**
 * One marker at (x, y) of the window: a foe dot, the boss's ruby, a campfire, a waystone gem, a
 * villager dot, a companion's teal diamond (G's kinds); and, drawn in the same family for today's
 * other points of interest, a treasure chest and a small gem in the old diamond's colour for a
 * door, sign, well or other object.
 * @param {PixelPainter} p
 * @param {string} kind 'enemy' | 'boss' | 'campfire' | 'waystone' | 'npc' | 'party' | 'chest' | 'door' | 'sign' | 'well' | 'object'
 * @param {number} x
 * @param {number} y
 */
export function marker(p, kind, x, y) {
  const k = pal();
  const dot = (col, r = 1) => {
    /** @type {[number, number, string][]} */
    const pts = [];
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (Math.abs(i) + Math.abs(j) <= r + (r > 1 ? 1 : 0)) pts.push([x + i, y + j, col]);
    stamp(p, pts, true, k['m-ol']);
  };
  if (kind === 'enemy') dot(k.foe);
  else if (kind === 'boss') gem(p, x, y, 3, GEMS.ruby());
  else if (kind === 'campfire') { dot(k.fire); p.px(x, y, k.g5); }
  else if (kind === 'waystone') gem(p, x, y, 2, GEMS.way(), { setting: [k['teal-rim'], k.way, k.sa1] });
  else if (kind === 'npc') dot(k.npc);
  else if (kind === 'party') {
    const R = k['teal-rim'], T = k.teal;
    stamp(p, [[x, y - 2, R], [x - 1, y - 1, R], [x, y - 1, T], [x + 1, y - 1, R],
      [x - 2, y, R], [x - 1, y, T], [x, y, T], [x + 1, y, T], [x + 2, y, R],
      [x - 1, y + 1, R], [x, y + 1, T], [x + 1, y + 1, R], [x, y + 2, R]], true, k['m-ol']);
  } else if (kind === 'chest') {
    // a small chest: the lid lit, a dark seam with the lock, the gilt body
    p.rows(x - 3, y - 2, ['.ooooo.', 'oWLLLGo', 'oDDkDDo', 'oGGGGBo', '.ooooo.'], { o: k.ink0, W: k.g5, L: k.g4, G: k.g3, B: k.g2, D: k.g1, k: k.kf0 });
  } else if (Object.prototype.hasOwnProperty.call(POI_COLORS, kind)) {
    const r = gemRamp(POI_COLORS[kind]);
    gem(p, x, y, 1, r, { setting: [r[2], r[1], r[0]] });
  }
}

/** @type {Map<string, HTMLCanvasElement>} */
const MARKERS = new Map();
/** The half size of a marker sprite (its centre's offset): every kind fits 2·5 + 1. */
export const MARKER_HALF = 5;
/**
 * A marker as an 11 × 11 canvas centred on (5, 5) (draw it at the point − MARKER_HALF). Cached; an
 * unknown kind is the gold gem of a point of interest.
 * @param {string} kind
 * @returns {HTMLCanvasElement}
 */
export function markerSprite(kind) {
  const id = kind === 'enemy' || kind === 'boss' || kind === 'campfire' || kind === 'waystone' || kind === 'npc' || kind === 'party' || kind === 'chest'
    || Object.prototype.hasOwnProperty.call(POI_COLORS, kind) ? kind : 'object';
  let c = MARKERS.get(id);
  if (!c) {
    const S = MARKER_HALF * 2 + 1;
    c = art(S, S, (p) => marker(p, id, MARKER_HALF, MARKER_HALF));
    MARKERS.set(id, c);
  }
  return c;
}

/** @type {HTMLCanvasElement|null} */
let PIP = null;
/** A foe beyond the window: a 3 × 3 pip (ink round one foe pixel) for the window's edge. */
export function pipSprite() {
  if (!PIP) PIP = art(3, 3, (p) => { const k = pal(); p.rect(0, 0, 3, 3, k.ink0); p.px(1, 1, k.foe); });
  return PIP;
}

/** @type {Map<string, HTMLCanvasElement>} */
const ARROWS = new Map();
/**
 * The player's arrow for a facing as a 9 × 9 canvas (draw it at the player − 4). Cached.
 * @param {string} facing one of FACINGS
 */
export function arrowSprite(facing) {
  const f = Object.prototype.hasOwnProperty.call(ARROW, facing) ? facing : 'up';
  let c = ARROWS.get(f);
  if (!c) { c = art(9, 9, (p) => playerArrow(p, 4, 4, f)); ARROWS.set(f, c); }
  return c;
}

/** @type {Map<number, HTMLCanvasElement>} */
const RINGS = new Map();
/**
 * The world map's "you are here" ring: a one-pixel circle of radius `r` in cream over an ink one
 * pixel out, as a (2r + 5)² canvas centred on (r + 2, r + 2). Cached per radius.
 * @param {number} r
 */
export function pulseRing(r) {
  const R = Math.max(2, Math.round(r));
  let c = RINGS.get(R);
  if (!c) {
    const S = R * 2 + 5, o = R + 2;
    c = art(S, S, (p) => {
      const k = pal();
      p.circle(o, o, R + 1, k.ink0, false);
      p.circle(o, o, R, k.kf1, false);
    });
    RINGS.set(R, c);
  }
  return c;
}

/**
 * The minimap window (G's `miniMap`): a V × V crop of `base` (a map painted `ppt` art px per tile)
 * round the player, the muted wash, the view wedge, the stepped vignette, the markers (pushed aside
 * from the arrow; foes beyond the window as pips on its edge) and the player's arrow.
 * @param {HTMLCanvasElement} base `mapCanvas` / `renderPixelMap` at the same `ppt`
 * @param {{ player: { x: number, z: number, facing?: string },
 *   markers?: { kind: string, x: number, z: number }[], V?: number, ppt?: number, view?: number }} o
 *   x / z in tiles (world units); view: the wedge's angle (0 north)
 * @returns {HTMLCanvasElement}
 */
export function miniMap(base, { player, markers = [], V = 70, ppt = 3, view = 0 }) {
  const k = pal();
  const mw = base.width, md = base.height;
  const x0 = Math.max(0, Math.min(mw - V, Math.round(player.x * ppt - V / 2)));
  const y0 = Math.max(0, Math.min(md - V, Math.round(player.z * ppt - V / 2)));
  const c = art(V, V, (p) => {
    p.ctx.drawImage(base, -x0, -y0);
    // muted toward today's tone: one flat ink wash over the tiles
    p.rect(0, 0, V, V, k['m-mute']);
    const px = Math.floor(player.x * ppt) - x0, py = Math.floor(player.z * ppt) - y0;
    viewWedge(p, V, px, py, view);
    vignette(p, V);
    const marks = markers.filter((q) => q.kind !== 'player').sort((a, b) => (MARKER_ORDER[a.kind] ?? 0) - (MARKER_ORDER[b.kind] ?? 0));
    for (const q of marks) {
      let x = Math.floor(q.x * ppt) - x0, y = Math.floor(q.z * ppt) - y0;
      const need = 4 + (MARKER_REACH[q.kind] ?? 2) + 2, dx = x - px, dy = y - py;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < need) {
        if (Math.abs(dx) >= Math.abs(dy)) x = px + (dx < 0 ? -need : need);
        else y = py + (dy < 0 ? -need : need);
      }
      const out = x < 3 || y < 3 || x > V - 4 || y > V - 4;
      if (out) {
        if (q.kind !== 'enemy') continue;
        x = Math.max(2, Math.min(V - 3, x)); y = Math.max(2, Math.min(V - 3, y));
        p.rect(x - 1, y - 1, 3, 3, k.ink0); p.px(x, y, k.foe);
        continue;
      }
      marker(p, q.kind, x, y);
    }
    playerArrow(p, px, py, player.facing ?? 'up');
  });
  // (its accessible name, the markers' names in the page's language, is set by the caller)
  c.setAttribute('role', 'img');
  return c;
}

// ---------------------------------------------------------------------------------------------
// The world map's legend keys
// ---------------------------------------------------------------------------------------------

/** The legend keys' size (art px): an 11 × 11 chip of the map. */
export const KEY_SIZE = 11;
/** @type {Map<string, HTMLCanvasElement>} */
const KEYS = new Map();
/**
 * A legend key: an 11 × 11 chip of the map in an ink rim — the maps' own markers on a patch of
 * dark grass (the player's arrow, a villager, a companion, a point of interest, a campfire, a foe,
 * a waystone, a chest) or a swatch of the painted map (a building's roof with its ridge, a road
 * across grass, water, forest crowns). Cached; a copy per call (a canvas stands in one place only).
 * @param {string} kind 'player' | 'npc' | 'party' | 'poi' | 'fire' | 'enemy' | 'waystone' | 'chest' | 'house' | 'road' | 'water' | 'forest'
 * @returns {HTMLCanvasElement}
 */
export function legendKey(kind) {
  let c = KEYS.get(kind);
  if (!c) {
    const S = KEY_SIZE, m = 5;
    c = art(S, S, (p) => {
      const k = pal();
      /** @param {string} fill */
      const chip = (fill) => { p.rect(1, 1, S - 2, S - 2, fill); p.box(0, 0, S, S, k.ink0); };
      const ground = k['m-G'];
      switch (kind) {
        case 'player': chip(ground); playerArrow(p, m, m, 'up'); break;
        case 'npc': chip(ground); marker(p, 'npc', m, m); break;
        case 'party': chip(ground); marker(p, 'party', m, m); break;
        case 'poi': chip(ground); marker(p, 'sign', m, m); break;
        case 'fire': chip(ground); marker(p, 'campfire', m, m); break;
        case 'enemy': chip(ground); marker(p, 'enemy', m, m); break;
        case 'waystone': chip(ground); marker(p, 'waystone', m, m); break;
        case 'chest': chip(ground); marker(p, 'chest', m, m); break;
        case 'house':
          // a roof (LevelMap's red): a darker rim, the lit ridge across the middle
          chip(ground);
          p.rows(1, 2, ['RRRRRRRRR', 'RrrrrrrrR', 'RrrrrrrrR', 'RhhhhhhhR', 'RdddddddR', 'RdddddddR', 'RRRRRRRRR'],
            { R: '#5e2a22', r: '#a4493b', h: '#c8735c', d: '#8c3a2e' });
          break;
        case 'road':
          chip(ground);
          p.rows(1, 3, ['ggggggggg', 'PPPPPPPPP', 'PPpPPPPpP', 'PPPPPpPPP', 'ggggggggg'], { g: '#4a7a36', P: '#b18a5c', p: '#9a7650' });
          break;
        case 'water':
          chip('#3b7fa6');
          p.rows(1, 1, ['.........', '.l.......', '.....l...', '.........', '..l......', '......l..', '.........', '.l.......', '.........'], { l: '#7fb6d4' });
          break;
        case 'forest':
          chip('#25432a');
          p.rows(1, 1, ['.L...L...', 'LLD.LLD.L', '.D...D...', '...L...L.', '..LLD.LLD', '...D...D.', '.L...L...', 'LLD.LLD.L', '.D...D...'], { L: '#3f7434', D: '#1a3020' });
          break;
        default: chip(ground); marker(p, 'object', m, m);
      }
    });
    KEYS.set(kind, c);
  }
  return art(c.width, c.height, (p) => p.ctx.drawImage(c, 0, 0));
}
