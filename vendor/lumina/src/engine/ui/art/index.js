/**
 * The pixel UI's art kit (docs/specs/PIXEL_UI.md §2), core modules re-exported in one place: the
 * palette, the painter, the gilt, the frames, the pieces, the logo, portraits, the minimap and the
 * core icons. The combat-only and party-only art (combat.js, party.js, icons/combat.js,
 * icons/party.js) is not re-exported: their chunks import those files directly (COMBAT_PURE /
 * PARTY_PURE, vite.config.js).
 */
export { PALETTE, pal, cssVar, cssColor, applyPalette, GEMS, gemRamp } from './palette.js';
export { pixelCanvas, art, rowsToCanvas, copyCanvas } from './painter.js';
export { gem, stamp, scale2x, scale3x, gild, rowsToBits } from './gilt.js';
export { SCROLL, crown, GLASS, GLASS_STOPS, frame, ornaments, FRAME_MARGIN, frameCanvas, clearFrameCache } from './frames.js';
export {
  rampRows, bar, GLYPHS, glyph, dimGlyph, gemGlyph, keycapArt, fade, rgbOf, ramp, BAND_STEPS, band, hairline, plate,
  selBand, bubble, star, halo, dayBar, coin, divider, veilCanvas,
} from './pieces.js';
export { LETTERS, logo, logoFit, canLogo, gildLogo, textLogo, LOGO_FONT, LOGO_FALLBACK_FONT } from './logo.js';
export { PORTRAIT_CROPS, portraitCanvas, spriteCrop } from './portrait.js';
export {
  mapColors, levelMapCells, mapCanvas, renderPixelMap, ARROW, playerArrow, viewWedge, vignette, MARKER_REACH, MARKER_ORDER,
  marker, miniMap,
} from './minimap.js';
export { CORE_ICONS, ICON_RAMPS, PHASE_ICONS, iconCanvas, icon, GOLD_ICON, DUSK_ICON } from './icons/core.js';
