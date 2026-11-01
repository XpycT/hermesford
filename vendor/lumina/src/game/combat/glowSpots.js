/**
 * glowSpots.js — where a combat sheet's glow texels sit in each cell, for the heroes' look packages
 * (IceSpellFx: the ice mage's staff crystal; its siblings: the cleric's sun …), which put a star
 * and the gathering light there. Lazy-chunk code only: imported by those packages, never by the
 * game's main chunk.
 */

/**
 * The centre of a sheet's glow texels in every cell (the ice mage's staff crystal, the cleric's
 * sun, any gear painted with glow texels): the texels of alpha 204 (CharacterSprites `glowTexel`)
 * of each frame, averaged, as offsets from the feet in u — `right` along the camera's right, `up`
 * above the ground; null for a cell with fewer than two. Null for a sheet without a canvas or
 * without glow texels. Read once per sheet (a sheet outlives the levels).
 * @param {any} sheet a combat sheet (`canvas`, `frameWidth`, `frameHeight`, `columns`, `rows`, `pixelsPerUnit`)
 * @returns {({ right: number, up: number }|null)[][]|null} [row][column]
 */
export function glowSpots(sheet) {
  if (!sheet || typeof sheet !== 'object') return null;
  if (SPOTS.has(sheet)) return SPOTS.get(sheet) ?? null;
  const table = readSpots(sheet);
  SPOTS.set(sheet, table);
  return table;
}

/** `glowSpots`' results by sheet. @type {WeakMap<object, ({ right: number, up: number }|null)[][]|null>} */
const SPOTS = new WeakMap();

/** @param {any} sheet @returns {({ right: number, up: number }|null)[][]|null} */
function readSpots(sheet) {
  const cv = sheet?.canvas;
  if (!cv || typeof cv.getContext !== 'function') return null;
  const FW = sheet.frameWidth | 0;
  const FH = sheet.frameHeight | 0;
  const ppu = sheet.pixelsPerUnit || 32;
  if (!(FW > 0 && FH > 0)) return null;
  // (a copy read back once: the sheet's own canvas stays as it is — its context is the sheet's)
  const copy = document.createElement('canvas');
  copy.width = cv.width;
  copy.height = cv.height;
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(cv, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  /** @type {({ right: number, up: number }|null)[][]} */
  const out = [];
  let any = false;
  for (let row = 0; row < (sheet.rows | 0); row++) {
    const line = [];
    for (let col = 0; col < (sheet.columns | 0); col++) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < FH; y++) {
        const py = row * FH + y;
        for (let x = 0; x < FW; x++) {
          if (img[(py * cv.width + col * FW + x) * 4 + 3] !== 204) continue;
          sx += x;
          sy += y;
          n++;
        }
      }
      if (n >= 2) {
        any = true;
        line.push({ right: (sx / n + 0.5 - FW / 2) / ppu, up: (FH - (sy / n + 0.5)) / ppu });
      } else line.push(null);
    }
    out.push(line);
  }
  return any ? out : null;
}
