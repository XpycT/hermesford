import { buildFire, buildDebris, buildGarland, siegeDecalMaterial, fireWindowMaterial, FIRE_WINDOW_GLOW } from './props/SetPieces.js';
import { buildCrag } from './props/Crags.js';
import { FlameSet, mergeFlames } from './props/FlameBatch.js';
import { brokenWalls, ruinedRoof, flatRoofGeom, balconyGeom, siegeDetails, burnFlames } from './props/HouseSiege.js';
import { ARID_TREES } from './props/AridTrees.js';
import { ARID_PROP_TEXTURES } from './props/AridPropTextures.js';
import { registerPropTextures } from './props/PropTextures.js';
import { ARID_SPRITES } from '../pixel/AridSprites.js';
import { registerPropSprites } from '../pixel/PropSprites.js';
import { registerTextureSet } from '../pixel/Textures.js';
import { aridTextures } from '../pixel/textures/arid.js';
import { buildingTextures } from '../pixel/textures/buildings.js';
import { ARID_TEXTURE_NAMES, BUILDING_TEXTURE_NAMES } from '../pixel/textures/names.js';
import { PRESETS as SIEGE_FX } from '../fx/presets/siege.js';
import { registerPresets } from '../fx/Particles.js';
import { installSetPieceKit } from './SetPieceKit.js';

/**
 * SetPieceKitParts — the set-piece kit of Vanquish the Evil Dragon itself, a chunk of its own
 * (./SetPieceKit.js says what it holds and who loads it). Importing it registers its tables into
 * the engine's — the arid and building texture sets (Textures.js `registerTextureSet`, checked
 * against ../pixel/textures/names.js), the arid ground's sprites (PropSprites.js
 * `registerPropSprites`), the arid trees' prop textures (props/PropTextures.js
 * `registerPropTextures`), the siege's particle presets (Particles.js `registerPresets`) — and
 * installs its builders (`installSetPieceKit`) for PropFactory's set-piece methods, `buildHouse`,
 * `buildTree` and World's flame batch. Each registration is additive and harmless to repeat.
 */

/** The kit's builders (`needSetPieceKit(what)` / `setPieceKit()` return this). */
export const SET_PIECE_PARTS = Object.freeze({
  // the set-piece props (PropFactory.fire / debris / garland / crag)
  buildFire, buildDebris, buildGarland, buildCrag,
  // a house's siege parts (buildHouse) and what they draw with
  brokenWalls, ruinedRoof, flatRoofGeom, balconyGeom, siegeDetails, burnFlames,
  siegeDecalMaterial, fireWindowMaterial, FIRE_WINDOW_GLOW, FlameSet,
  // every set-piece flame of a level in one instanced batch (World)
  mergeFlames,
  // the arid tree kinds (buildTree)
  ARID_TREES,
});

registerTextureSet(aridTextures, ARID_TEXTURE_NAMES);
registerTextureSet(buildingTextures, BUILDING_TEXTURE_NAMES);
registerPropSprites(ARID_SPRITES);
registerPropTextures(ARID_PROP_TEXTURES);
registerPresets(SIEGE_FX);
installSetPieceKit(SET_PIECE_PARTS);
