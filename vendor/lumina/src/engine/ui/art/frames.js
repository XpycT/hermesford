/**
 * The frame family of the pixel UI (docs/specs/PIXEL_UI.md §1.3, §2), ported from mockup G's art:
 * A · Gilded Court's frames in today's navy glass, their ornaments (corner gems, signature scrolls,
 * the trio, side studs, the crown), and `frameCanvas`, which paints a framed box once per style and
 * size and hands out copies.
 *
 * Frames are repainted per size, not nine-sliced: the glass bands sit at fractions of the height,
 * their seams are dithered, the lattice has a 16-px phase and the ornaments are centred.
 */
import { pal, GEMS } from './palette.js';
import { gem, stamp, gild, scale2x, rowsToBits } from './gilt.js';
import { art, copyCanvas } from './painter.js';

/** @import { PixelPainter } from './painter.js' */

/**
 * The options of `frame()` and `ornaments()` (G's `win()` options; one object serves both).
 * @typedef {object} FrameStyle
 * @property {'L'|'M'|'S'|'XS'} [size] 'L' big windows (signature scrolls, sapphire corners r5),
 *   'M' (corners r3), 'S' a cartouche (notch 4), 'XS' (corners r2); default 'M'
 * @property {string|null} [fill] a flat glass colour; null: no glass at all
 * @property {string[]} [bands] the glass bands, top → bottom (default: today's four)
 * @property {number[]} [stops] where each band starts (fractions of the height)
 * @property {'dim'} [tone] dim gilt (idle cards, locked slots)
 * @property {boolean} [sel] lit gilt (the chosen card)
 * @property {boolean} [socket] a recessed inside (skill slots)
 * @property {boolean} [lattice] A's damask on the glass
 * @property {boolean|number} [beads] a dotted gilt line inside (true: at depth 6)
 * @property {boolean} [sheen] a lit line under the top rim (default on)
 * @property {number} [notch] the corner radius (overrides the size's)
 * @property {string[]|null} [corners] the corner gems' ramp (null: none; default by size)
 * @property {number} [cornerR] the corner gems' radius
 * @property {boolean} [scrolls] 'M' only: the plain scroll corners
 * @property {boolean} [trio] today's trio (a stud between two small ones) on the top and bottom edges
 * @property {boolean} [trioTop] false: no top trio (under a long name plate)
 * @property {number} [trioR] the trio's middle stud radius (3)
 * @property {string[]} [trioGem] the trio's middle stud ramp
 * @property {boolean} [sides] a stud at the middle of each side
 * @property {number} [sideR]
 * @property {boolean} [crown] the crown on top (instead of the top trio)
 * @property {string[]} [crownGem]
 * @property {boolean} [pendant] a stud at the middle of the bottom edge (without the trio)
 * @property {boolean} [ends] cartouche studs on the two ends
 * @property {number} [endR]
 * @property {string[]} [endGem]
 * @property {boolean} [orn] false: no ornaments canvas (`win` / `frameCanvas`)
 */

/** A's corner scroll (origin = the frame's corner pixel; mirrored for the other corners). */
export const SCROLL = Object.freeze([
  '...........',
  '...........',
  '...........',
  '...WLGGGGD.',
  '...LL.....D',
  '...G.L.G..D',
  '...G..G.DD.',
  '...G.G.....',
  '...G..D....',
  '...D..D....',
  '....DD.....',
]);

/** @type {{ b: Uint8Array, w: number, h: number }|null} */
let SIG = null;
/** The big windows' signature corner: the scroll at twice the size (Scale2x). */
function sigBits() {
  if (SIG) return SIG;
  const { b, w, h } = rowsToBits([...SCROLL]);
  SIG = { b: scale2x(b, w, h), w: w * 2, h: h * 2 };
  return SIG;
}

/**
 * A's pixel crown standing on (cx, by): three points topped with pearls, a band set with a gem and
 * two pearls. 27 × 17 art pixels.
 * @param {PixelPainter} p
 * @param {number} cx
 * @param {number} by
 * @param {string[]} [ramp] the band's gem
 */
export function crown(p, cx, by, ramp = GEMS.sapphire()) {
  const k = pal();
  const W = 27, H = 15, x0 = cx - 13, top = by - H;
  const ctl = [[0, 7], [4, 4], [8, 9], [13, 1], [18, 9], [22, 4], [26, 7]];
  const edge = (x) => {
    for (let i = 0; i < ctl.length - 1; i++) {
      const [a, ya] = ctl[i], [b, yb] = ctl[i + 1];
      if (x >= a && x <= b) return Math.round(ya + (yb - ya) * (x - a) / (b - a));
    }
    return H;
  };
  const bits = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) for (let y = edge(x); y < H; y++) bits[y * W + x] = 1;
  const pts = gild(bits, W, H, x0, top);
  for (const q of pts) {
    const ry = q[1] - top;
    if (ry === 10) q[2] = k.g5;
    else if (ry === 11) q[2] = k.ink0;
    else if (ry === H - 1) q[2] = k.g2;
  }
  stamp(p, pts);
  for (const [x, y] of [[4, 2], [13, -1], [22, 2]]) {
    stamp(p, [[x0 + x, top + y, k.tx1], [x0 + x - 1, top + y, k.tx2], [x0 + x + 1, top + y, k.tx2], [x0 + x, top + y - 1, k.g5], [x0 + x, top + y + 1, k.tx3]]);
  }
  gem(p, cx, top + 12, 2, ramp);
  for (const x of [6, 20]) { p.px(x0 + x, top + 12, k.tx1); p.px(x0 + x + (x < 13 ? -1 : 1), top + 12, k.tx3); }
}

/** Today's glass: navy shading darker toward the bottom, in four hard bands (dithered seams). */
export const GLASS = () => [pal().glass0, pal().glass1, pal().glass2, pal().glass3];
/** Where today's four glass bands start (fractions of the height). */
export const GLASS_STOPS = Object.freeze([0, 0.22, 0.46, 0.74]);

/**
 * The frame family (A), painted from each pixel's distance to the shape's outside, so cartouche
 * plates (concave corners) and plain boxes share every layer: ink outline · 2 px gilt (lit
 * top-left, shaded bottom-right) · ink line · glass (today's banded navy). The box is w × h at
 * (x, y); the ink outline lies one pixel outside it. Ornaments are painted separately
 * (`ornaments()`, above the content).
 * @param {PixelPainter} p
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {FrameStyle} [o]
 */
export function frame(p, x, y, w, h, o = {}) {
  const k = pal();
  const size = o.size ?? 'M';
  const dim = o.tone === 'dim';
  const notch = o.notch ?? (size === 'S' ? 4 : 0);
  const n2 = notch * notch;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    if (notch) for (const [cx, cy] of corners) if ((i - cx) ** 2 + (j - cy) ** 2 < n2) return false;
    return true;
  };
  const CAP = 9;
  const D = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)) { D[j * w + i] = 1; q[qt++] = j * w + i; }
    }
  }
  while (qh < qt) {
    const id = q[qh++], d = D[id];
    if (d >= CAP) continue;
    const i = id % w, j = (id - i) / w;
    for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (!inside(a, b)) continue;
      const nid = b * w + a;
      if (D[nid] === 0) { D[nid] = d + 1; q[qt++] = nid; }
    }
  }
  // the glass: a flat fill, or today's bands (each seam dithered over two rows)
  const bands = o.fill === null ? null : o.fill ? [o.fill] : (o.bands ?? GLASS());
  const stops = o.stops ?? GLASS_STOPS;
  const rowFill = (j, i) => {
    if (!bands) return null;
    if (bands.length === 1) return bands[0];
    const t = j / Math.max(1, h - 1);
    let b = 0;
    for (let s = 1; s < bands.length; s++) if (t >= stops[s]) b = s;
    // dither the seam: the row just above a stop takes the next band on every other pixel
    const nb = b + 1;
    if (nb < bands.length) {
      const sy = Math.round(stops[nb] * (h - 1));
      if (j === sy - 1 && (i + j) % 2 === 0) return bands[nb];
    }
    return bands[b];
  };
  const gl = dim ? [k.dm1, k.dm2, k.dm3, k.dm2] : o.sel ? [k.g5, k.g4, k.g3, k.g4] : [k.g4, k.g3, k.g2, k.g3];
  const sigR = size === 'L' ? 26 : 0;
  const nearCorner = (i, j) => sigR && (i < sigR || i >= w - sigR) && (j < sigR || j >= h - sigR);
  const sheen = o.sheen !== false && h > 10 && !o.socket;
  // the glass first, in runs of one colour along each row (a pixel's later layers — the lattice, the
  // rim — paint over it as before; one fillRect per run instead of one per pixel: the same pixels)
  if (bands) {
    for (let j = 0; j < h; j++) {
      let run = 0, col = null;
      for (let i = 0; i <= w; i++) {
        const c = i < w && inside(i, j) ? rowFill(j, i) : null;
        if (c === col && c) { run++; continue; }
        if (col && run) p.rect(x + i - run, y + j, run, 1, col);
        col = c;
        run = c ? 1 : 0;
      }
    }
  }
  for (let j = -1; j <= h; j++) {
    for (let i = -1; i <= w; i++) {
      const X = x + i, Y = y + j;
      if (!inside(i, j)) {
        if (inside(i - 1, j) || inside(i + 1, j) || inside(i, j - 1) || inside(i, j + 1)) p.px(X, Y, k.ink0);
        continue;
      }
      const d = D[j * w + i];
      if (d === 0) {
        if (o.lattice && !nearCorner(i, j)) {
          const a = (i + j) % 16, b = (i - j + 1600) % 16;
          if (a === 0 && b === 0) p.px(X, Y, k['glass-x']);
          else if ((a === 0 || b === 0) && (i + j) % 2 === 0) p.px(X, Y, k['glass-lat']);
        }
        continue;
      }
      const up = !inside(i, j - d), left = !inside(i - d, j);
      const lit = up || left;
      let col = null;
      if (d === 1) col = lit ? gl[0] : gl[2];
      else if (d === 2) col = lit ? gl[1] : gl[3];
      else if (d === 3) col = k.ink0;
      else if (o.socket) {
        if (d === 4) col = lit ? k.ink0 : k.ink3;
      } else if (d === 4 && up && sheen) col = k['glass-hi'];
      else if (d === 5 && up && sheen && (i + j) % 2 === 0) col = k['glass-hi'];
      if (o.beads && d === (o.beads === true ? 6 : o.beads) && !nearCorner(i, j)) col = (i + j) % 2 === 0 ? (dim ? k.dm3 : k.g2) : null;
      if (col) p.px(X, Y, col);
    }
  }
  if (!dim && !notch) { p.px(x, y, k.g5); p.px(x + 1, y, k.g5); p.px(x, y + 1, k.g5); }
}

/**
 * The ornaments, where today sets its ◆: corner gems (and on 'L' A's signature scrolls), today's
 * trio (a stud between two small ones) centred on the top and bottom edges, a stud at the middle of
 * each side, or the crown on top. Painted on their own canvas above the content.
 * @param {PixelPainter} p
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {FrameStyle} [o]
 */
export function ornaments(p, x, y, w, h, o = {}) {
  const k = pal();
  const size = o.size ?? 'M';
  const dim = o.tone === 'dim';
  const setting = dim ? [k.dm1, k.dm2, k.dm3] : null;
  const ramp = o.corners === undefined ? (size === 'L' ? GEMS.sapphire() : GEMS.gold()) : o.corners;
  const x1 = x + w - 1, y1 = y + h - 1;
  const quad = [[1, 1, x, y], [-1, 1, x1, y], [1, -1, x, y1], [-1, -1, x1, y1]];
  if (size === 'L') {
    const S = sigBits();
    for (const [sx, sy, ox, oy] of quad) stamp(p, gild(S.b, S.w, S.h, ox, oy, sx, sy));
  } else if (size === 'M' && o.scrolls) {
    const mp = { L: k.g4, G: k.g3, D: k.g2, B: k.g1, W: k.g5 };
    for (const [sx, sy, ox, oy] of quad) {
      SCROLL.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') p.px(ox + sx * (i + 1), oy + sy * (j + 1), mp[row[i]]); });
    }
  }
  const cr = o.cornerR ?? (size === 'L' ? 5 : size === 'M' ? 3 : 2);
  if (ramp && cr > 0) for (const [sx, sy, ox, oy] of quad) gem(p, size === 'L' ? ox + sx : ox, size === 'L' ? oy + sy : oy, cr, ramp, { setting });
  const cx = x + Math.floor((w - 1) / 2);
  const trio = (cy) => {
    gem(p, cx - 7, cy, 1, GEMS.gold(), { setting });
    gem(p, cx + 7, cy, 1, GEMS.gold(), { setting });
    gem(p, cx, cy, o.trioR ?? 3, o.trioGem ?? GEMS.gold(), { setting });
  };
  if (o.crown) crown(p, cx, y + 2, o.crownGem ?? GEMS.sapphire());
  else if (o.trio && o.trioTop !== false) trio(y);
  if (o.trio) trio(y1);
  else if (o.pendant) gem(p, cx, y1, 3, GEMS.gold(), { setting });
  if (o.sides) {
    const cy = y + Math.floor((h - 1) / 2);
    gem(p, x, cy, o.sideR ?? 2, GEMS.gold(), { setting });
    gem(p, x1, cy, o.sideR ?? 2, GEMS.gold(), { setting });
  }
  if (o.ends) {
    // cartouche studs on the two ends (today's plate studs)
    const cy = y + Math.floor((h - 1) / 2);
    gem(p, x, cy, o.endR ?? 2, o.endGem ?? GEMS.gold(), { setting });
    gem(p, x1, cy, o.endR ?? 2, o.endGem ?? GEMS.gold(), { setting });
  }
}

/** The margin round a framed box on its canvases (art px; G's `win()` M): room for the ornaments. */
export const FRAME_MARGIN = 18;

/** Painted frames by style and size: { base, orn, px } originals (copies go to the page). */
const CACHE = new Map();
/** How many style × size pairs the cache keeps at most (least recently used dropped first). */
const CACHE_MAX = 256;
/**
 * How many canvas pixels the cache keeps at most (4 bytes each: 24 MB; an L window the size of the
 * screen is ≈ 0.25 M pixels a canvas, two canvases a frame).
 */
const CACHE_MAX_PX = 6_000_000;
/** The canvas pixels the cache holds now. */
let cachePx = 0;

/**
 * A framed box w × h art px in `style`, as two canvases of (w + 2·FRAME_MARGIN) × (h + 2·FRAME_MARGIN)
 * art px with the box at (FRAME_MARGIN, FRAME_MARGIN): `base` (the rim and glass, under the content)
 * and `orn` (the gems, scrolls and crown, above it; null with `style.orn === false`). Each style and
 * size is painted once and cached; every call returns fresh copies (a canvas can stand in one place
 * only), so callers may keep them.
 * @param {FrameStyle} style
 * @param {number} w
 * @param {number} h
 * @returns {{ base: HTMLCanvasElement, orn: HTMLCanvasElement|null }}
 */
export function frameCanvas(style, w, h) {
  const key = `${Math.round(w)}x${Math.round(h)}|${JSON.stringify(style)}`;
  let hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit);
  } else {
    const M = FRAME_MARGIN, W = Math.round(w), H = Math.round(h);
    const base = art(W + 2 * M, H + 2 * M, (p) => frame(p, M, M, W, H, style));
    const orn = style.orn === false ? null : art(W + 2 * M, H + 2 * M, (p) => ornaments(p, M, M, W, H, style));
    hit = { base, orn, px: base.width * base.height * (orn ? 2 : 1) };
    CACHE.set(key, hit);
    cachePx += hit.px;
    // least recently used out first, by count and by size (the newest always stays)
    while (CACHE.size > 1 && (CACHE.size > CACHE_MAX || cachePx > CACHE_MAX_PX)) {
      const oldest = CACHE.keys().next().value;
      cachePx -= CACHE.get(oldest).px;
      CACHE.delete(oldest);
    }
  }
  return { base: copyCanvas(hit.base), orn: hit.orn ? copyCanvas(hit.orn) : null };
}

/** Forget every cached frame (tests). */
export function clearFrameCache() { CACHE.clear(); cachePx = 0; }
