/**
 * The gilt primitives of the pixel UI (docs/specs/PIXEL_UI.md §2), ported from mockup G's art: cut
 * gems in a gold setting, outlined stamps, bit grids gilded lit top-left and shaded bottom-right,
 * and the Scale2x / Scale3x enlargers that keep a curve's steps one pixel wide.
 */
import { pal, GEMS } from './palette.js';

/** @import { PixelPainter } from './painter.js' */

/**
 * A cut diamond gem in a gold setting, centre (cx, cy), radius r (the setting on |dx|+|dy| = r,
 * the stone inside, an ink outline at r + 1).
 * @param {PixelPainter} p
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {string[]} [ramp] the stone [dark, mid, light] (GEMS.*())
 * @param {{ outline?: boolean, open?: string, setting?: string[]|null }} [o] open: side tips where a
 *   rule runs on ('r', 'l', 'u', 'd'); setting: the setting's [shaded, mid, lit] (gilt by default)
 */
export function gem(p, cx, cy, r, ramp = GEMS.gold(), { outline = true, open = '', setting = null } = {}) {
  const k = pal();
  const set = setting ?? [k.g4, k.g3, k.g2];
  for (let dy = -(r + 1); dy <= r + 1; dy++) {
    for (let dx = -(r + 1); dx <= r + 1; dx++) {
      const d = Math.abs(dx) + Math.abs(dy), s = dx + dy;
      let col = null;
      if (d === r + 1) {
        if (!outline) continue;
        const tip = (dx === r + 1 && open.includes('r')) || (dx === -(r + 1) && open.includes('l'))
          || (dy === -(r + 1) && open.includes('u')) || (dy === r + 1 && open.includes('d'));
        col = tip ? null : k.ink0;
      } else if (d === r) col = s < 0 ? set[0] : s === 0 ? set[1] : set[2];
      else if (d < r) {
        if (r >= 3) {
          if (dx === -1 && dy === -1) col = k.g5;
          else col = s <= -(r - 1) ? ramp[2] : s >= r - 1 ? ramp[0] : ramp[1];
        } else col = s < 0 ? ramp[2] : s > 0 ? ramp[0] : ramp[1];
        if (r <= 2 && dx === 0 && dy === 0) col = ramp[1];
      }
      if (col) p.px(cx + dx, cy + dy, col);
    }
  }
}

/**
 * Paint a list of [x, y, colour] pixels with an ink outline round them (4-neighbours).
 * @param {PixelPainter} p
 * @param {[number, number, string][]} pts
 * @param {boolean} [outline]
 * @param {string|null} [ink] the outline colour (ink0)
 */
export function stamp(p, pts, outline = true, ink = null) {
  const k = pal();
  const key = (x, y) => `${x},${y}`;
  const on = new Set(pts.map(([x, y]) => key(x, y)));
  if (outline) {
    for (const [x, y] of pts) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!on.has(key(x + dx, y + dy))) p.px(x + dx, y + dy, ink ?? k.ink0);
      }
    }
  }
  for (const [x, y, c] of pts) p.px(x, y, c);
}

/**
 * Scale2x (EPX) on a bit grid: diagonals and curls step one pixel at a time at twice the size.
 * @param {Uint8Array} bits w × h, 1 = on
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array} 2w × 2h
 */
export function scale2x(bits, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bits[y * w + x]);
  const W = w * 2, out = new Uint8Array(W * h * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const B = at(x, y - 1), D = at(x - 1, y), E = at(x, y), F = at(x + 1, y), H = at(x, y + 1);
      const e = B !== H && D !== F ? [D === B ? D : E, B === F ? F : E, D === H ? D : E, H === F ? F : E] : [E, E, E, E];
      out[(y * 2) * W + x * 2] = e[0]; out[(y * 2) * W + x * 2 + 1] = e[1];
      out[(y * 2 + 1) * W + x * 2] = e[2]; out[(y * 2 + 1) * W + x * 2 + 1] = e[3];
    }
  }
  return out;
}

/**
 * Scale3x on a bit grid (the logo's enlarger).
 * @param {Uint8Array} src w × h
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array} 3w × 3h
 */
export function scale3x(src, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x]);
  const W = w * 3, out = new Uint8Array(W * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const A = at(x - 1, y - 1), B = at(x, y - 1), Cc = at(x + 1, y - 1);
      const D = at(x - 1, y), E = at(x, y), F = at(x + 1, y);
      const Gg = at(x - 1, y + 1), H = at(x, y + 1), I = at(x + 1, y + 1);
      let e = [E, E, E, E, E, E, E, E, E];
      if (B !== H && D !== F) {
        e = [
          D === B ? D : E,
          (D === B && E !== Cc) || (B === F && E !== A) ? B : E,
          B === F ? F : E,
          (D === B && E !== Gg) || (D === H && E !== A) ? D : E,
          E,
          (B === F && E !== I) || (H === F && E !== Cc) ? F : E,
          D === H ? D : E,
          (D === H && E !== I) || (H === F && E !== Gg) ? H : E,
          H === F ? F : E,
        ];
      }
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out[(y * 3 + j) * W + x * 3 + i] = e[j * 3 + i];
    }
  }
  return out;
}

/**
 * Bits → gilt pixels at (ox, oy), mirrored by (sx, sy): lit where open toward the top left of the
 * screen, shaded where open toward the bottom right.
 * @param {Uint8Array} bits w × h
 * @param {number} w
 * @param {number} h
 * @param {number} ox
 * @param {number} oy
 * @param {number} [sx] 1 or -1
 * @param {number} [sy] 1 or -1
 * @returns {[number, number, string][]} pixels for `stamp`
 */
export function gild(bits, w, h, ox, oy, sx = 1, sy = 1) {
  const k = pal();
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] === 1;
  /** @type {[number, number, string][]} */
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      const up = !on(x, y - sy), down = !on(x, y + sy), left = !on(x - sx, y), right = !on(x + sx, y);
      let c = k.g3;
      if (up && left) c = k.g5; else if (up || left) c = k.g4;
      else if (down && right) c = k.g1; else if (down || right) c = k.g2;
      pts.push([ox + sx * x, oy + sy * y, c]);
    }
  }
  return pts;
}

/**
 * Rows of characters ('.' off, anything else on) → a bit grid.
 * @param {string[]} rows
 * @returns {{ b: Uint8Array, w: number, h: number }}
 */
export const rowsToBits = (rows) => {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const b = new Uint8Array(w * h);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') b[y * w + x] = 1; });
  return { b, w, h };
};
