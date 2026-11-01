/**
 * The pixel UI's painter (docs/specs/PIXEL_UI.md §2): mockup G's 2D-context painter, one canvas
 * pixel per art pixel, shown at `--px` CSS pixels per art pixel with `image-rendering: pixelated`.
 *
 * Not `PixelCanvas` (src/engine/pixel/PixelCanvas.js): the UI's colours are CSS strings, rgba()
 * included, and its art relies on the canvas's source-over blending (glass highlights over glass,
 * the minimap's washes and wedge); PixelCanvas parses colours into opaque pixels and overwrites.
 */

/**
 * The drawing helpers `draw(p)` gets. Every coordinate is a whole canvas pixel; a falsy colour
 * draws nothing.
 * @typedef {object} PixelPainter
 * @property {number} w canvas width (art px)
 * @property {number} h canvas height (art px)
 * @property {CanvasRenderingContext2D} ctx the canvas's 2D context (image smoothing off)
 * @property {(x: number, y: number, col: string|null|undefined) => void} px one pixel
 * @property {(x: number, y: number, w: number, h: number, col: string|null|undefined) => void} rect a filled rectangle
 * @property {(x: number, y: number, w: number, h: number, col: string|null|undefined) => void} box a 1-pixel rectangle outline
 * @property {(x: number, y: number, len: number, col: string|null|undefined) => void} hline a row of `len` pixels
 * @property {(x: number, y: number, len: number, col: string|null|undefined) => void} vline a column of `len` pixels
 * @property {(x0: number, y0: number, x1: number, y1: number, col: string|null|undefined) => void} line a Bresenham line
 * @property {(cx: number, cy: number, r: number, col: string|null|undefined, fill?: boolean) => void} circle a pixel circle (midpoint), filled or outlined
 * @property {(x: number, y: number, w: number, h: number, a: string, b: string, pattern?: 'check'|'sparse'|'rows') => void} dither
 *   two colours in an ordered pattern: 'check' (50 %), 'sparse' (25 %), 'rows'
 * @property {(x: number, y: number, rows: string[], palette: Record<string, string|null|undefined>) => void} rows
 *   palette rows at (x, y): one character per pixel, '.' (or a character the palette lacks) transparent
 */

/**
 * A canvas of w × h pixels to paint pixel art on with whole-pixel coordinates; `draw(p)` gets the
 * helpers. Scale it with CSS and `image-rendering: pixelated`, or pass `scale` (canvas pixels per
 * pixel). The canvas gets the class `px`.
 * @param {number} w
 * @param {number} h
 * @param {(p: PixelPainter) => void} draw
 * @param {number} [scale]
 * @returns {HTMLCanvasElement}
 */
export function pixelCanvas(w, h, draw, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(0, Math.round(w * scale));
  c.height = Math.max(0, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = scale;
  /** @type {PixelPainter} */
  const p = {
    w, h, ctx,
    px(x, y, col) { if (!col) return; ctx.fillStyle = col; ctx.fillRect(x * s, y * s, s, s); },
    rect(x, y, rw, rh, col) { if (!col) return; ctx.fillStyle = col; ctx.fillRect(x * s, y * s, rw * s, rh * s); },
    box(x, y, rw, rh, col) {
      this.rect(x, y, rw, 1, col); this.rect(x, y + rh - 1, rw, 1, col);
      this.rect(x, y, 1, rh, col); this.rect(x + rw - 1, y, 1, rh, col);
    },
    hline(x, y, len, col) { this.rect(x, y, len, 1, col); },
    vline(x, y, len, col) { this.rect(x, y, 1, len, col); },
    line(x0, y0, x1, y1, col) {
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.px(x0, y0, col);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
    circle(cx, cy, r, col, fill = true) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          const d = x * x + y * y;
          if (fill ? d <= r * r + r * 0.8 : (d <= r * r + r * 0.8 && d > (r - 1) * (r - 1) + (r - 1) * 0.8)) this.px(cx + x, cy + y, col);
        }
      }
    },
    dither(x, y, rw, rh, a, b, pattern = 'check') {
      for (let j = 0; j < rh; j++) {
        for (let i = 0; i < rw; i++) {
          const X = x + i, Y = y + j;
          const on = pattern === 'check' ? (X + Y) % 2 === 0
            : pattern === 'sparse' ? (X % 2 === 0 && Y % 2 === 0)
              : pattern === 'rows' ? Y % 2 === 0 : false;
          this.px(X, Y, on ? a : b);
        }
      }
    },
    rows(x, y, rows, palette) {
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') this.px(x + i, y + j, palette[row[i]]); });
    },
  };
  draw(p);
  c.classList.add('px');
  return c;
}

/** A canvas of w × h art pixels (G's `art()`: `pixelCanvas` at scale 1). */
export const art = (/** @type {number} */ w, /** @type {number} */ h, /** @type {(p: PixelPainter) => void} */ draw) => pixelCanvas(w, h, draw);

/**
 * Palette rows (one character per pixel; '.' or a character missing from the palette is
 * transparent) on a new canvas, `scale` canvas pixels per pixel (G's `rowsToCanvas`).
 * @param {string[]} rows
 * @param {Record<string, string|null|undefined>} palette character → CSS colour
 * @param {number} [scale]
 * @returns {HTMLCanvasElement}
 */
export function rowsToCanvas(rows, palette, scale = 1) {
  const h = rows.length, w = Math.max(0, ...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (!col || row[x] === '.') continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  c.classList.add('px');
  return c;
}

/**
 * A copy of a canvas (one canvas cannot stand in two places of the page; cached art is copied
 * into each element's own canvas).
 * @param {HTMLCanvasElement} src
 * @returns {HTMLCanvasElement}
 */
export function copyCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (src.width && src.height) ctx.drawImage(src, 0, 0);
  for (const k of src.classList) c.classList.add(k);
  return c;
}
