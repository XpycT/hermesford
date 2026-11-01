// The per-owner modules of the kit (EVERMERE_CAMPAIGN.md §4): architecture's props, seasons' trees
// and textures — each owner edits its own module, this file only lists them
import { buildBelfry, houseIcicles } from './props/Belfry.js';
import { buildCrag, buildSeasonRock } from './props/Crags.js';
import { mergeFlames } from './props/FlameBatch.js';
import { evermerePropTextures, EVERMERE_PROP_TEXTURE_NAMES } from '../pixel/textures/evermereProps.js';
import { buildShip } from './props/Ships.js';
import { buildMonument } from './props/Monuments.js';
import { buildSmithy } from './props/Smithy.js';
import { buildSeasonTree, SEASON_LAND } from './props/SeasonTrees.js';
import { registerTextureSet } from '../pixel/Textures.js';
import { seasonTextures } from '../pixel/textures/seasons.js';
import { SEASON_TEXTURE_NAMES } from '../pixel/textures/names.js';
import { installSeasonKit } from './SeasonKit.js';

/**
 * SeasonKitParts — The Bells of Evermere's season kit itself, a chunk of its own (./SeasonKit.js
 * says what it holds and who loads it). Importing it registers the season texture set
 * (Textures.js `registerTextureSet`, checked against ../pixel/textures/names.js) and installs its
 * builders (`installSeasonKit`) for PropFactory's methods of the owned types and tree kinds. Each
 * registration is additive and harmless to repeat.
 */

/** The kit's builders (`needSeasonKit(what)` / `seasonKit()` return this). */
export const SEASON_KIT_PARTS = Object.freeze({
  // the owned object types (PropFactory.belfry / ship / monument / smithy)
  buildBelfry, buildShip, buildMonument, buildSmithy,
  // the architecture package's: a house's icicles (buildHouse), the crags and rocks of the
  // campaign's stones (PropFactory.crag / rock: `ice`, `snow`), the flame batch (World: the
  // braziers' and the forge's fire on a level without the set-piece kit)
  houseIcicles, buildCrag, buildSeasonRock, mergeFlames,
  // the owned tree kinds (PropFactory.tree)
  buildSeasonTree,
  // the seasons package's land: GroundDetail's season growth and crops, Scenery's forest mixes,
  // outer ground and relief (EVERMERE_CAMPAIGN.md review EV-24: out of the game's static graph)
  SEASON_LAND,
});

registerTextureSet(seasonTextures, SEASON_TEXTURE_NAMES);
registerTextureSet(evermerePropTextures, EVERMERE_PROP_TEXTURE_NAMES);
installSeasonKit(SEASON_KIT_PARTS);
