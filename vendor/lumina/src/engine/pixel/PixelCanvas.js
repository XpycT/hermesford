import * as THREE from 'three';
import { clamp, fbm2, bayer4 } from '../utils/math.js';
import { ownValue, showValue } from '../utils/own.js';

/**
 * PixelCanvas — a tiny RGBA pixel buffer with pixel-art drawing primitives.
 *
 * All procedural art in the engine (world textures, character sheets, prop sprites,
 * UI icons) is drawn through this class, then converted to a THREE texture with
 * nearest-neighbour filtering via `toTexture()` / `makePixelTexture()`.
 *
 * Colors may be given as '#rgb', '#rrggbb', '#rrggbbaa', a 0xRRGGBB number, a CSS colour name,
 * [r, g, b] / [r, g, b, a] (0-255, alpha optional) or { r, g, b, a }. `null` / 'transparent'
 * clears a pixel (see `parseColor`).
 */

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const _colorCache = new Map();
const TRANSPARENT = Object.freeze([0, 0, 0, 0]);

const OPAQUE_BLACK = Object.freeze([0, 0, 0, 255]);
/** Hex digits only, with or without a leading '#': parsed as hex (as before PROP-11). */
const HEX_LIKE = /^#|^[0-9a-f]+$/i;
/** Colour values parseColor has warned about (once each). */
const _warnedColors = new Set();

/**
 * Parse any supported color form into an [r, g, b, a] array (0-255). Result must not be mutated.
 * Accepts '#rgb' / '#rgba' / '#rrggbb' / '#rrggbbaa' (the '#' optional), a 0xRRGGBB number, a CSS
 * colour name ('red', 'beige'; THREE.Color.NAMES), [r, g, b(, a)] and { r, g, b, a? }; null /
 * 'transparent' is transparent. Anything else (an unknown name, a boolean …) is opaque black
 * after a console warning, once per value.
 * @param {*} c
 * @returns {readonly number[]}
 */
export function parseColor(c) {
  if (c == null || c === 'transparent') return TRANSPARENT;
  if (Array.isArray(c)) return c.length === 4 ? c : [c[0], c[1], c[2], 255];
  if (typeof c === 'object') return [c.r, c.g, c.b, c.a ?? 255];
  let out = _colorCache.get(c);
  if (out) return out;
  if (typeof c === 'number') {
    const n = Number.isFinite(c) ? (c >>> 0) & 0xffffff : 0;
    if (!Number.isFinite(c)) warnColor(c);
    out = Object.freeze([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]);
  } else if (typeof c !== 'string') {
    warnColor(c);
    return OPAQUE_BLACK;
  } else {
    let h = c.trim();
    if (HEX_LIKE.test(h)) {
      h = h.replace('#', '');
      if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
      const n = parseInt(h.slice(0, 6), 16);
      out = Object.freeze([(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255]);
    } else {
      const named = ownValue(THREE.Color.NAMES, h.toLowerCase());
      if (named !== undefined) out = Object.freeze([(named >> 16) & 255, (named >> 8) & 255, named & 255, 255]);
      else {
        warnColor(c);
        out = OPAQUE_BLACK;
      }
    }
  }
  _colorCache.set(c, out);
  return out;
}

/** parseColor's warning for a value it does not understand (once per value). */
function warnColor(c) {
  if (_warnedColors.has(c)) return;
  _warnedColors.add(c);
  console.warn(`[PixelCanvas] unknown colour ${typeof c === 'string' ? `"${c}"` : showValue(c)}; using black`);
}

/** Convert a color to '#rrggbb' (or '#rrggbbaa' when not opaque). */
export function toHex(c) {
  const [r, g, b, a] = parseColor(c);
  const hx = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}${a < 255 ? hx(a) : ''}`;
}

/** Convert a color to a CSS rgba() string. */
export function toCss(c) {
  const [r, g, b, a] = parseColor(c);
  return `rgba(${r | 0},${g | 0},${b | 0},${(a / 255).toFixed(3)})`;
}

/** Convert a color to a THREE.Color (sRGB input → linear working space). */
export function toThreeColor(c) {
  const [r, g, b] = parseColor(c);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

/** Linear interpolation between two colors (in sRGB byte space). */
export function mixColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return [0, 1, 2, 3].map((i) => Math.round(ca[i] + (cb[i] - ca[i]) * t));
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Pixel-artist style shading: amount in [-1, 1]. Negative darkens and shifts the hue
 * toward blue/purple (cool shadows); positive lightens and shifts toward yellow
 * (warm highlights). Saturation is nudged so ramps stay rich rather than muddy.
 */
export function shadeColor(c, amount) {
  const [r, g, b, a] = parseColor(c);
  let [h, s, l] = rgbToHsl([r, g, b]);
  const target = amount < 0 ? 245 : 55;
  let dh = target - h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  h += dh * Math.min(1, Math.abs(amount)) * 0.18;
  l = clamp(l + amount * 0.42, 0, 1);
  s = clamp(s * (amount < 0 ? 1 + -amount * 0.15 : 1 - amount * 0.25), 0, 1);
  const [nr, ng, nb] = hslToRgb([h, s, l]);
  return [nr, ng, nb, a];
}

/** Build an n-step ramp (dark → light) around a base color. */
export function rampFrom(base, n = 5, spread = 0.5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 .. 1
    out.push(shadeColor(base, t * spread));
  }
  return out;
}

// ---------------------------------------------------------------------------
// PixelCanvas
// ---------------------------------------------------------------------------

export class PixelCanvas {
  /**
   * @param {number} width
   * @param {number} height
   * @param {*} [fill] optional initial fill color
   */
  constructor(width, height, fill = null) {
    this.width = width | 0;
    this.height = height | 0;
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    /** When true, out-of-range coordinates wrap around (for seamless tiles). */
    this.wrap = false;
    this._canvas = null;
    if (fill != null) this.fill(fill);
  }

  static fromCanvas(canvas) {
    const pc = new PixelCanvas(canvas.width, canvas.height);
    const ctx = canvas.getContext('2d');
    pc.data.set(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    return pc;
  }

  clone() {
    const pc = new PixelCanvas(this.width, this.height);
    pc.data.set(this.data);
    pc.wrap = this.wrap;
    return pc;
  }

  _index(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.wrap) {
      x = ((x % this.width) + this.width) % this.width;
      y = ((y % this.height) + this.height) % this.height;
    } else if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }
    return (y * this.width + x) * 4;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Returns [r, g, b, a] (a fresh array) or [0,0,0,0] out of bounds. */
  get(x, y) {
    const i = this._index(x, y);
    if (i < 0) return [0, 0, 0, 0];
    const d = this.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  getAlpha(x, y) {
    const i = this._index(x, y);
    return i < 0 ? 0 : this.data[i + 3];
  }

  /** Overwrite a pixel. */
  set(x, y, color) {
    const i = this._index(x, y);
    if (i < 0) return this;
    const c = parseColor(color);
    const d = this.data;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    return this;
  }

  /** Alpha-composite a color over a pixel. `alpha` (0-1) multiplies the color's alpha. */
  blend(x, y, color, alpha = 1) {
    const i = this._index(x, y);
    if (i < 0) return this;
    const c = parseColor(color);
    const sa = (c[3] / 255) * alpha;
    if (sa <= 0) return this;
    const d = this.data;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return this;
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * sa + d[i + k] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
    return this;
  }

  /** Multiply RGB of a pixel by a factor (e.g. 0.8 to darken). Keeps alpha. */
  scale(x, y, f) {
    const i = this._index(x, y);
    if (i < 0) return this;
    const d = this.data;
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
    return this;
  }

  fill(color) {
    const c = parseColor(color);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = c[3];
    }
    return this;
  }

  clear() {
    this.data.fill(0);
    return this;
  }

  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
    return this;
  }

  strokeRect(x, y, w, h, color) {
    this.hline(x, x + w - 1, y, color);
    this.hline(x, x + w - 1, y + h - 1, color);
    this.vline(x, y, y + h - 1, color);
    this.vline(x + w - 1, y, y + h - 1, color);
    return this;
  }

  hline(x0, x1, y, color) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.set(x, y, color);
    return this;
  }

  vline(x, y0, y1, color) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; y++) this.set(x, y, color);
    return this;
  }

  /** Bresenham line (inclusive endpoints). */
  line(x0, y0, x1, y1, color) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  /** Filled circle (pixel-art friendly: uses r + 0.5 test). */
  circle(cx, cy, r, color) {
    return this.ellipse(cx, cy, r, r, color);
  }

  /** Circle outline. */
  ring(cx, cy, r, color) {
    const rr0 = (r - 0.5) * (r - 0.5);
    const rr1 = (r + 0.5) * (r + 0.5);
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d >= rr0 && d <= rr1) this.set(x, y, color);
      }
    }
    return this;
  }

  /** Filled axis-aligned ellipse centred at (cx, cy). */
  ellipse(cx, cy, rx, ry, color) {
    const rxs = (rx + 0.5) * (rx + 0.5);
    const rys = (ry + 0.5) * (ry + 0.5);
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if ((dx * dx) / rxs + (dy * dy) / rys <= 1) this.set(x, y, color);
      }
    }
    return this;
  }

  /** Filled polygon from [[x, y], ...] using even-odd scanline fill at pixel centres. */
  polygon(points, color) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.set(x, y, color);
      }
    }
    return this;
  }

  /**
   * Map every pixel: fn(x, y, [r,g,b,a]) → new color, or undefined to keep.
   */
  map(fn) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const out = fn(x, y, this.get(x, y));
        if (out !== undefined) this.set(x, y, out);
      }
    }
    return this;
  }

  /**
   * Fill with fbm noise quantised onto a color ramp, with optional ordered dithering
   * between ramp steps. The canvas spans `scale` noise cells; `period` (in noise cells) makes the
   * noise repeat, so pass period = scale (an integer) for a tile that wraps seamlessly.
   * @param {Array} ramp colors dark → light
   * @param {{scale?:number, seed?:number, octaves?:number, period?:number, dither?:number, bias?:number, mask?:(x,y)=>boolean}} opts
   */
  fillNoise(ramp, { scale = 4, seed = 0, octaves = 3, period = 0, dither = 0.5, bias = 0, mask = null } = {}) {
    const n = ramp.length;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (mask && !mask(x, y)) continue;
        const v = fbm2((x / this.width) * scale, (y / this.height) * scale, { octaves, seed, period: period || 0 });
        const t = clamp((v - 0.5) * 1.6 + 0.5 + bias, 0, 0.9999) * n;
        const d = (bayer4(x, y) - 0.5) * dither;
        const idx = clamp(Math.floor(t + d), 0, n - 1);
        this.set(x, y, ramp[idx]);
      }
    }
    return this;
  }

  /** Scatter single pixels of `color` with probability p (seeded). */
  speckle(color, p, rng, mask = null) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (mask && !mask(x, y)) continue;
        if (rng.next() < p) this.set(x, y, color);
      }
    }
    return this;
  }

  /**
   * Add a 1px outline around opaque pixels (alpha >= threshold).
   * @param {*} color outline color
   * @param {{diagonals?:boolean, threshold?:number}} opts
   */
  outline(color, { diagonals = false, threshold = 128 } = {}) {
    const src = this.clone();
    src.wrap = false;
    const offs = diagonals
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (src.getAlpha(x, y) >= threshold) continue;
        if (offs.some(([dx, dy]) => src.getAlpha(x + dx, y + dy) >= threshold)) this.set(x, y, color);
      }
    }
    return this;
  }

  /** Copy another PixelCanvas onto this one (alpha-composited). */
  blit(src, dx, dy, { flipX = false, flipY = false, alpha = 1 } = {}) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const sx = flipX ? src.width - 1 - x : x;
        const sy = flipY ? src.height - 1 - y : y;
        const c = src.get(sx, sy);
        if (c[3] === 0) continue;
        if (c[3] === 255 && alpha === 1) this.set(dx + x, dy + y, c);
        else this.blend(dx + x, dy + y, c, alpha);
      }
    }
    return this;
  }

  /** Copy a sub-rectangle into a new PixelCanvas. */
  crop(x, y, w, h) {
    const pc = new PixelCanvas(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) pc.set(xx, yy, this.get(x + xx, y + yy));
    return pc;
  }

  /** Mirror horizontally (returns a new PixelCanvas). */
  flippedX() {
    const pc = new PixelCanvas(this.width, this.height);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) pc.set(this.width - 1 - x, y, this.get(x, y));
    return pc;
  }

  replaceColor(from, to) {
    const f = parseColor(from);
    return this.map((x, y, c) => (c[0] === f[0] && c[1] === f[1] && c[2] === f[2] && c[3] === f[3] ? to : undefined));
  }

  /** Per-pixel luminance in [0, 1] (useful as a height source). */
  luminance(x, y) {
    const [r, g, b] = this.get(x, y);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /** Write the buffer into (and return) an HTMLCanvasElement. */
  toCanvas() {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = this.width;
      this._canvas.height = this.height;
    }
    const ctx = this._canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(this.data), this.width, this.height), 0, 0);
    return this._canvas;
  }

  toDataURL() {
    return this.toCanvas().toDataURL('image/png');
  }

  /** Create a nearest-filtered THREE texture from this canvas (see makePixelTexture). */
  toTexture(opts = {}) {
    return makePixelTexture(this.toCanvas(), opts);
  }
}

// ---------------------------------------------------------------------------
// Texture helpers
// ---------------------------------------------------------------------------

const WRAP = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
};

/**
 * Configure a canvas as a pixel-art texture.
 * @param {HTMLCanvasElement} canvas
 * @param {{wrap?:'repeat'|'clamp'|'mirror', mipmaps?:boolean, srgb?:boolean, anisotropy?:number, name?:string}} opts
 *   - mipmaps: true for tiling world textures (magnified with NEAREST, minified smoothly),
 *              false for sprites / UI (pure nearest, crisp alpha edges).
 *   - srgb:    true for color data, false for data maps (normal / height / masks).
 */
export function makePixelTexture(canvas, { wrap = 'repeat', mipmaps = false, srgb = true, anisotropy = 1, name = '' } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = name;
  tex.wrapS = tex.wrapT = WRAP[wrap] ?? THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = mipmaps;
  tex.anisotropy = anisotropy;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build a tangent-space normal map (as a PixelCanvas) from a height function.
 * @param {number} w
 * @param {number} h
 * @param {(x:number, y:number) => number} heightAt height in [0,1]; coordinates wrap if `wrap`
 * @param {{strength?:number, wrap?:boolean}} opts
 */
export function normalMapFromHeight(w, h, heightAt, { strength = 2, wrap = true } = {}) {
  const pc = new PixelCanvas(w, h);
  const H = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
    return heightAt(x, y);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      // Canvas y goes down while texture v goes up (flipY), so invert dy for +Y-up normals.
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      pc.set(x, y, [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255, 255]);
    }
  }
  return pc;
}
