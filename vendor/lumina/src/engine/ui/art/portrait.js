/**
 * Portraits from the real character sheets (docs/specs/PIXEL_UI.md §1.5, §2.1), ported from
 * mockup G's art: frame (0, 0) of a `createCharacterSheet(...).canvas` — the idle frame facing
 * the camera, 32 × 32 — cropped, enlarged by whole pixels, set on a stepped glow in a thin gilt
 * frame.
 */
import { pal } from './palette.js';
import { frame } from './frames.js';
import { art, copyCanvas } from './painter.js';

/** The size of one frame of a character sheet (src/engine/pixel/CharacterSprites.js). */
const FRAME = 32;

/**
 * G's crops of frame (0, 0): `crop` [x, y, w, h] in sprite pixels, `k` art px per sprite px,
 * `size` the framed square (art px). `slot` is the party slot's plain sprite (no frame; `spriteCrop`).
 */
export const PORTRAIT_CROPS = Object.freeze({
  dialogue: Object.freeze({ size: 40, crop: Object.freeze([8, 2, 17, 17]), k: 2 }),
  tactics: Object.freeze({ size: 68, crop: Object.freeze([1, 0, 31, 31]), k: 2 }),
  slot: Object.freeze({ size: 32, crop: Object.freeze([8, 1, 16, 16]), k: 2 }),
});

/** @type {WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>} */
const CACHE = new WeakMap();

/**
 * The pixels of a crop of frame (0, 0) of a sheet.
 * @param {HTMLCanvasElement} sheetCanvas
 * @param {readonly number[]} crop [x, y, w, h]
 */
function cropData(sheetCanvas, crop) {
  const [x, y, w, h] = crop;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheetCanvas, x, y, w, h, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, canvas: c };
}

/**
 * The plain crop of frame (0, 0) as its own canvas, one canvas pixel per sprite pixel (the party
 * slot's sprite: `put(g, spriteCrop(sheet, PORTRAIT_CROPS.slot.crop), x, y, 2)`).
 * @param {HTMLCanvasElement} sheetCanvas
 * @param {readonly number[]} [crop]
 * @returns {HTMLCanvasElement}
 */
export function spriteCrop(sheetCanvas, crop = PORTRAIT_CROPS.slot.crop) {
  const c = cropData(sheetCanvas, crop).canvas;
  c.classList.add('px');
  return c;
}

/**
 * A framed portrait from a character sheet: a square of `size` art px with a thin gilt frame
 * (A's 'XS' frame when size ≥ 30, else a 1-px gilt ring), a stepped glow behind (navy with a warm
 * heart: Sela's amber, or a sapphire, or any CSS colour), the crop `crop` [x, y, w, h] of frame
 * (0, 0) drawn `k` art px per sprite px, its foot on the frame's bottom. (size + 2) art px square.
 * Painted once per sheet and options; every call returns a copy.
 * @param {HTMLCanvasElement} sheetCanvas `createCharacterSheet(...).canvas`
 * @param {{ size?: number, crop?: readonly number[], k?: number, glow?: 'amber'|'sapphire'|string }} [o]
 *   default: the dialogue's (PORTRAIT_CROPS.dialogue) with the amber glow
 * @returns {HTMLCanvasElement}
 */
export function portraitCanvas(sheetCanvas, o = {}) {
  const size = o.size ?? PORTRAIT_CROPS.dialogue.size;
  const crop = o.crop ?? PORTRAIT_CROPS.dialogue.crop;
  const kz = o.k ?? PORTRAIT_CROPS.dialogue.k;
  const glow = o.glow ?? 'amber';
  const key = `${size}|${crop.join(',')}|${kz}|${glow}`;
  let byKey = CACHE.get(sheetCanvas);
  if (!byKey) { byKey = new Map(); CACHE.set(sheetCanvas, byKey); }
  let hit = byKey.get(key);
  if (!hit) {
    hit = paintPortrait(sheetCanvas, size, crop, kz, glow);
    byKey.set(key, hit);
  }
  return copyCanvas(hit);
}

/**
 * @param {HTMLCanvasElement} sheetCanvas
 * @param {number} size
 * @param {readonly number[]} crop
 * @param {number} kz
 * @param {string} glow
 */
function paintPortrait(sheetCanvas, size, crop, kz, glow) {
  const k = pal();
  const c = [Math.max(0, crop[0]), Math.max(0, crop[1]), Math.min(FRAME, crop[2]), Math.min(FRAME, crop[3])];
  const spr = cropData(sheetCanvas, c);
  const data = spr.data;
  const warm = glow === 'amber' ? k.se1 : glow === 'sapphire' ? k.sa1 : glow;
  const thick = size >= 30;
  const b = thick ? 3 : 1;
  return art(size + 2, size + 2, (p) => {
    if (thick) frame(p, 1, 1, size, size, { size: 'XS', fill: k.ink1, sheen: false });
    else { p.box(0, 0, size + 2, size + 2, k.ink0); p.box(1, 1, size, size, k.g3); p.px(1, 1, k.g5); p.hline(2, size, size - 1, k.g2); p.vline(size, 2, size - 1, k.g2); }
    const inner = size - 2 * b, ox = 1 + b, oy = 1 + b;
    const cc = (inner - 1) / 2;
    for (let y = 0; y < inner; y++) {
      for (let x = 0; x < inner; x++) {
        const d = Math.hypot(x - cc, (y - cc) * 1.1) / (inner / 2);
        let col = k.ink1;
        if (d < 0.95) col = (x + y) % 2 ? k.ink2 : k.ink1;
        if (d < 0.7) col = k.ink2;
        if (d < 0.5) col = (x + y) % 2 ? warm : k.ink2;
        p.px(ox + x, oy + y, col);
      }
    }
    const sw = spr.w * kz, sh = spr.h * kz;
    const sx0 = ox + Math.floor((inner - sw) / 2), sy0 = oy + inner - sh;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const X = sx0 + x, Y = sy0 + y;
        if (X < ox || Y < oy || X >= ox + inner || Y >= oy + inner) continue;
        const i = (Math.floor(y / kz) * spr.w + Math.floor(x / kz)) * 4;
        if (data[i + 3] > 0) p.px(X, Y, `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`);
      }
    }
  });
}
