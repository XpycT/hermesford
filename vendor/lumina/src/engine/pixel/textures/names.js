/**
 * The names of the texture sets of Vanquish the Evil Dragon (./arid.js, ./buildings.js), apart from
 * their painters: the painters live in the set-piece kit's chunk (src/engine/world/SetPieceKit.js),
 * the names here are what a level is scanned for to know whether it needs that chunk
 * (`levelNeedsSetPieceKit`). Import-free and Node-safe. The kit checks at registration that each
 * set defines exactly these names (a texture added to a set must be added here).
 */

/** Every arid texture name (./arid.js: the contract's fifteen and the red rock top). */
export const ARID_TEXTURE_NAMES = Object.freeze([
  'arid_dirt', 'cracked_earth', 'dry_grass', 'red_sand', 'sandstone', 'redrock', 'scree', 'flagstone', 'scorched',
  'basalt', 'ash', 'sandstone_cliff', 'redrock_cliff', 'basalt_cliff', 'dry_grass_side', 'arid_dirt_side',
]);

/** Every building texture name (./buildings.js: the arid walls and roofs). */
export const BUILDING_TEXTURE_NAMES = Object.freeze([
  'adobe', 'whitewash', 'sandstone_brick', 'charred_wall', 'roof_terracotta', 'roof_charred',
]);

/**
 * Every season texture name (./seasons.js: The Bells of Evermere's terrain — EVERMERE_CAMPAIGN.md
 * §6.2), painted by the season kit's chunk (src/engine/world/SeasonKit.js): a level whose legend
 * names one loads the kit (`levelNeedsSeasonKit`). Tops 64², cliffs 32², banks 16². Frozen by the
 * foundation for the generator's legend: a rename after content uses a name changes the levels.
 */
export const SEASON_TEXTURE_NAMES = Object.freeze([
  // spring (the Blossomwood, Evermere in spring)
  'spring_grass', 'blossom_grass', 'spring_grass_side',
  // autumn (Amberfield)
  'autumn_grass', 'autumn_grass_side', 'stubble', 'fallen_leaves',
  // the coast (Saltcombe)
  'limestone', 'limestone_cliff', 'cove_sand',
  // streets
  'slate_cobble', 'frost_cobble',
  // winter (Rimeholt, the Bell Court; also the crag / rock stone `ice`)
  'snow_top', 'snow_path', 'snow_side', 'ice_top', 'ice_cliff',
]);
