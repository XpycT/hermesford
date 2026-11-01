/**
 * Engine-wide constants and conventions.
 *
 * World conventions (see ARCHITECTURE.md):
 *  - Y is up. 1 world unit = 1 map tile = PPU texels of pixel art.
 *  - Tile (i, j) covers x ∈ [i, i+1], z ∈ [j, j+1]; its centre is (i + 0.5, h, j + 0.5).
 *  - The default camera (yaw 0) sits on the +Z side of its target looking toward -Z,
 *    so "screen down" is +Z and a sprite facing "down" faces the camera.
 */

/** Pixels (texels) per world unit, for both world textures and sprites. */
export const PPU = 16;

/** Size of one map tile in world units. */
export const TILE_SIZE = 1;

/** Height of one terrain level (map height digit) in world units. */
export const LEVEL_HEIGHT = 0.5;

/** @typedef {'down'|'left'|'right'|'up'} Direction  a facing / sprite-sheet row */

/**
 * Directions used by sprite sheets, in sheet row order.
 * @type {Direction[]}
 */
export const DIRECTIONS = ['down', 'left', 'right', 'up'];

/** Render order buckets for transparent effects (lower draws first). */
export const RENDER_ORDER = {
  WATER: 10,
  DECALS: 20,
  GODRAYS: 40,
  PARTICLES: 50,
  UI_WORLD: 90,
};
