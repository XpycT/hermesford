/**
 * The mouse cursors (docs/specs/PIXEL_UI.md §3, D29): G's gilt arrow everywhere and an ivory gauntlet
 * with a gilt cuff over what a click acts on, painted at runtime from palette rows like the glyphs
 * (art/pieces.js `GLYPHS`) and handed to CSS as `cursor` values (UI.js sets them on the page:
 * `--lu-cursor`, `--lu-cursor-pointer`).
 *
 * One cursor art pixel is `k` whole device pixels: the UI's `px`, but never so many that the cursor
 * outgrows Chrome's 32 × 32 CSS-pixel limit for custom cursors (a bigger one falls back to the
 * system arrow near the window's edges). The image is declared at the device's resolution
 * (`image-set(… <dpr>x)`), so its pixels land on whole device pixels at any zoom; the hotspot is in
 * CSS pixels of the shown cursor.
 *
 * Keys: o ink, W g5, L g4, G g3, D g2, B g1 (the gilt ramp, light to dark), I i k K the glove's
 * ivory (the keycaps' kf0–kf3), a b c the sapphire.
 */
import { pal } from './palette.js';
import { rowsToCanvas } from './painter.js';

/** Chrome's largest custom cursor (CSS px a side) that is always shown. */
export const CURSOR_MAX_CSS = 32;

/**
 * The cursors: palette rows and the hotspot (the point that points, in art px from the top left).
 * @type {Readonly<Record<'arrow'|'pointer', { rows: readonly string[], hot: readonly [number, number] }>>}
 */
export const CURSORS = Object.freeze({
  // the arrow: a gilt blade, lit along its left edge, darker toward its back and down its tail
  arrow: {
    hot: [0.5, 0.5],
    rows: [
      'o.........',
      'oo........',
      'oWo.......',
      'oWLo......',
      'oWLLo.....',
      'oWLLGo....',
      'oWLLGDo...',
      'oWLLLGDo..',
      'oWLLLGGDo.',
      'oWLLGooooo',
      'oWLoLGo...',
      'oLo.oLGo..',
      'oo..oLGo..',
      'o....oLDo.',
      '.....oGDo.',
      '......oo..',
    ],
  },
  // the gauntlet: an ivory glove pointing up (the fingertip is the hotspot), a gilt cuff with a
  // sapphire stud
  pointer: {
    hot: [5, 0.5],
    rows: [
      '....oo.......',
      '...oIio......',
      '...oIio......',
      '...oIio......',
      '...oIiooo....',
      '...oIioIiooo.',
      '.oooIioIioIio',
      'oIioIikIikIio',
      'oIiiIiiiiiiko',
      'oiiiiiiiiikko',
      '.oiiiiiiiikko',
      '..okiiiiiikko',
      '.oLLLLLLLLLo.',
      '.oGGGGbGGGDo.',
      '.oDDDDDDDDBo.',
      '.ooooooooooo.',
    ],
  },
});

/** The cursors' palette (G's tokens). */
function cursorPalette() {
  const k = pal();
  return { o: k.ink0, W: k.g5, L: k.g4, G: k.g3, D: k.g2, B: k.g1, I: k.kf0, i: k.kf1, k: k.kf2, K: k.kf3, a: k.sa1, b: k.sa2, c: k.sa3 };
}

/**
 * Device pixels per cursor art pixel: the UI's `px`, at most what keeps the cursor within
 * `CURSOR_MAX_CSS` CSS px (and at least 1).
 * @param {'arrow'|'pointer'} name
 * @param {{ px: number, dpr: number }} scale
 */
export function cursorScale(name, { px, dpr }) {
  const rows = CURSORS[name].rows;
  const side = Math.max(rows.length, ...rows.map((r) => r.length));
  return Math.max(1, Math.min(Math.round(px), Math.floor((CURSOR_MAX_CSS * dpr) / side + 1e-6)));
}

/**
 * The cursor's canvas at `k` device pixels per art pixel.
 * @param {'arrow'|'pointer'} name
 * @param {number} k
 * @returns {HTMLCanvasElement}
 */
export function cursorCanvas(name, k) {
  return rowsToCanvas([...CURSORS[name].rows], cursorPalette(), k);
}

/**
 * A CSS `cursor` value for the cursor at the UI's scale: the image at the device's resolution, the
 * hotspot, and `fallback` (a keyword) when the image cannot be used.
 * @param {'arrow'|'pointer'} name
 * @param {{ px: number, dpr: number }} scale
 * @param {string} fallback
 * @returns {string}
 */
export function cursorCss(name, scale, fallback) {
  const k = cursorScale(name, scale);
  const url = cursorCanvas(name, k).toDataURL('image/png');
  const dpr = +scale.dpr.toFixed(4);
  const [hx, hy] = CURSORS[name].hot;
  // (CSS px of the shown cursor, whole)
  const x = Math.floor((hx * k) / scale.dpr + 1e-6);
  const y = Math.floor((hy * k) / scale.dpr + 1e-6);
  return `image-set(url("${url}") ${dpr}x) ${x} ${y}, ${fallback}`;
}
