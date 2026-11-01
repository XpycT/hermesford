import { buildBroadleaf, buildPine, swayFn } from './Trees.js';
import { registerTextureSet } from '../../pixel/Textures.js';
import { seasonTreeTextures, SEASON_TREE_TEXTURE_NAMES } from '../../pixel/textures/seasons.js';
import { registerPropSprites } from '../../pixel/PropSprites.js';
import { SEASON_SPRITES, SEASON_FAMILIES, SEASON_GROWTH, seasonFieldSteps } from '../../pixel/SeasonSprites.js';
import { fbm2, smoothstep } from '../../utils/math.js';
import { registerTops } from '../TileMap.js';
import { registerTopColors } from '../../level/LevelMap.js';
import { registerMapClasses } from '../../ui/art/minimap.js';

/** @import { PropFactory, PropResult } from '../Props.js' */
/** @import { TreeOptions, BroadleafKind } from './Trees.js' */

/**
 * The tree kinds of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §5.3, §6.2;
 * docs/design/SEASONS_LOOK.md §4): `blossom` (a cherry: a wide, flat-topped crown of white and
 * cream blossom shading to lilac pink, dark plum bark), `maple` (red-orange, leaves at its foot),
 * `goldbirch` (the birch's slender shape in gold), `snowpine` (the pine's tiers with snow lying on
 * them, baked into its texture) and `bare` (a winter tree: trunk and forking limbs, no cards) —
 * `PropFactory.tree` hands them here. Part of the season kit's chunk (../SeasonKitParts.js), so their
 * builders, textures and sprites stay out of the game chunk. Importing this module registers the
 * season trees' texture set (canopies, the snow pine's tiers, the cherry and frosted barks:
 * ../../pixel/textures/seasons.js `seasonTreeTextures`) and the season ground's sprites
 * (../../pixel/SeasonSprites.js) — additive, harmless to repeat.
 *
 * Same materials as the library's trees (the wind-swayed bark, the billboard foliage — one more
 * material per canopy texture, no new program); the randomness of each on its own stream
 * (`tree:<kind>`, like every kind).
 */

/** The broadleaf season kinds (Trees.js `buildBroadleaf` with these shapes). @type {Record<string, BroadleafKind>} */
const BROADLEAF = {
  // (warmed and lifted, the inner cards less dark: white blossom in shade reads rose, not slate or
  // lilac. Review EV-70 asked for a cooler [1.02, 0.97, 1.0]: it doubled the lilac in the shade and
  // left the lit hue where the grade's warm highlights put it — the lit tones are the ramp's)
  blossom: { leaves: 'leaves_blossom', tint: [1.1, 0.99, 0.97], clusters: [11, 14], crown: 0.5, flat: 0.62, trunk: 0.07, card: 2.0, bark: 'bark_cherry', inner: 0.72 },
  maple: { leaves: 'leaves_maple', tint: [1, 1, 1], clusters: [9, 12], crown: 0.45, flat: 0.86, trunk: 0.072, card: 2.0, litter: true },
  goldbirch: { leaves: 'leaves_gold', tint: [1, 1, 1], clusters: [6, 8], crown: 0.3, flat: 1.25, trunk: 0.036, card: 2.0, birch: true },
};

registerTextureSet(seasonTreeTextures, SEASON_TREE_TEXTURE_NAMES);
registerPropSprites(SEASON_SPRITES);

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y ground height
 * @param {number} z
 * @param {TreeOptions} [opts]
 * @returns {PropResult}
 */
export function buildSeasonTree(f, x, y, z, opts = {}) {
  const kind = opts.kind ?? 'blossom';
  const rng = f.rng(`tree:${kind}`, x, z, opts.seed);
  const H = (opts.height ?? 4.5) * rng.range(0.94, 1.06);
  const yaw = opts.rotation ?? rng.range(0, Math.PI * 2);
  let built;
  if (kind === 'snowpine') built = buildPine(f, rng, H, x, y, z, yaw, 'pine_snow', 'snowpine');
  else if (kind === 'bare') built = buildBare(f, rng, H, x, y, z, yaw);
  else {
    const name = Object.hasOwn(BROADLEAF, kind) ? kind : 'blossom';
    built = buildBroadleaf(f, rng, name, H, x, y, z, yaw, opts, BROADLEAF[name]);
  }
  return f.result(built.group, { colliders: [{ type: 'circle', x, z, r: built.trunkR + 0.12 }] });
}

/**
 * A bare winter tree: a tapered trunk forking at about half its height into four or five rising
 * limbs, each forking twice more (the twigs no thinner than half a texel's worth), in the frosted
 * grey bark — a silhouette against the snow, no leaf cards.
 * @param {PropFactory} f
 * @param {import('../../utils/math.js').RNG} rng
 * @param {number} H @param {number} x @param {number} y @param {number} z @param {number} yaw
 * @returns {{ group: import('three').Group, trunkR: number }}
 */
function buildBare(f, rng, H, x, y, z, yaw) {
  const b = f.builder();
  const bark = f.windMaterial('bark_frost');
  b.sway = swayFn(H, H * 0.3);
  const r0 = Math.max(0.11, H * 0.048);
  const h1 = H * rng.range(0.4, 0.5);
  const bx = rng.range(-0.18, 0.18);
  const bz = rng.range(-0.18, 0.18);
  b.lathe(bark, [
    { y: -0.12, r: r0 * 1.7 }, { y: 0.12, r: r0 * 1.25 }, { y: h1 * 0.6, r: r0 * 0.95, cx: bx * 0.4, cz: bz * 0.4 },
    { y: h1 + 0.15, r: r0 * 0.72, cx: bx, cz: bz },
  ], {
    segments: 7,
    phase: rng.range(0, Math.PI),
    colorFn: (i) => { const k = i === 0 ? 0.6 : i === 1 ? 0.8 : 1; return [k, k, k]; },
    vOff: rng.range(0, 2),
  });
  /** A limb from `s` along `d` (unit), forking `depth` more times. */
  const limb = (s, d, len, r, depth) => {
    const e = [s[0] + d[0] * len, s[1] + d[1] * len, s[2] + d[2] * len];
    const r1 = Math.max(0.03, r * 0.62);
    b.tube(bark, s, e, Math.max(0.035, r), r1, { segments: depth === 0 ? 5 : 4, rings: 2, uRepeat: 1 });
    if (depth >= 2) return;
    const n = depth === 0 ? rng.int(2, 3) : 2;
    for (let k = 0; k < n; k++) {
      // turn about the vertical and lift a little: the crown spreads and rises
      const a = Math.atan2(d[2], d[0]) + rng.range(-0.75, 0.75);
      const tilt = Math.min(1.25, Math.acos(Math.max(-1, Math.min(1, d[1]))) + rng.range(-0.15, 0.3));
      const nd = [Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)];
      const at = rng.range(0.55, 1);
      limb([s[0] + (e[0] - s[0]) * at, s[1] + (e[1] - s[1]) * at, s[2] + (e[2] - s[2]) * at], nd, len * rng.range(0.5, 0.68), r1, depth + 1);
    }
  };
  const n = rng.int(4, 5);
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const tilt = rng.range(0.35, 0.75);
    limb([bx, h1, bz], [Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)], (H - h1) * rng.range(0.6, 0.8), r0 * 0.58, 0);
  }
  // the leader: a little taller than the limbs
  limb([bx, h1 + 0.1, bz], [rng.range(-0.15, 0.15), 1, rng.range(-0.15, 0.15)], (H - h1) * 0.8, r0 * 0.55, 1);
  const group = f.finish(b, 'tree:bare', x, y, z, yaw);
  return { group, trunkR: r0 * 1.1 };
}

// ---------------------------------------------------------------------------------------------
// The season land: what the game's Scenery and GroundDetail read through the season kit
// (`seasonKit().SEASON_LAND`), so a level without the kit carries none of it
// ---------------------------------------------------------------------------------------------

/**
 * The forest mix of a season (Scenery `scatterForestSteps` with `season`): cumulative odds in the
 * north rows, in the dense noise blobs and elsewhere — at the temperate scatter's positions and
 * draws. Docs: SEASONS_LOOK.md §6.
 * @type {Readonly<Record<string, Record<'north'|'dense'|'open', [string, number][]>>>}
 */
const SEASON_MIX = Object.freeze({
  spring: { north: [['pine', 0.45], ['birch', 0.7], ['blossom', 1]], dense: [['blossom', 0.62], ['oak', 1]], open: [['blossom', 0.45], ['oak', 0.75], ['birch', 0.9], ['pine', 1]] },
  summer: { north: [['pine', 0.6], ['oak', 1]], dense: [['pine', 0.55], ['oak', 1]], open: [['oak', 0.6], ['pine', 0.9], ['birch', 1]] },
  autumn: { north: [['pine', 0.45], ['goldbirch', 0.65], ['maple', 0.85], ['autumn', 1]], dense: [['maple', 0.45], ['autumn', 0.75], ['pine', 1]],
    open: [['maple', 0.35], ['goldbirch', 0.55], ['autumn', 0.8], ['oak', 0.9], ['pine', 1]] },
  winter: { north: [['snowpine', 0.85], ['bare', 1]], dense: [['snowpine', 0.75], ['bare', 1]], open: [['snowpine', 0.6], ['bare', 1]] },
});

/**
 * The outer ground of a season (Scenery `outerGroundSteps` with `season`): its texture (the season
 * set's), the far hills' and the steep faces' tints, the shade of the ground right at the map.
 * @type {Readonly<Record<string, [string, number[], number[], number]>>}
 */
const SEASON_OUTER = Object.freeze({
  spring: ['spring_grass', [0.8, 0.88, 0.74], [0.64, 0.62, 0.66], 0.66],
  summer: ['limestone', [0.7, 0.78, 0.6], [0.96, 0.92, 0.86], 0.82],
  autumn: ['autumn_grass', [0.88, 0.8, 0.7], [0.66, 0.62, 0.66], 0.66],
  winter: ['snow_top', [0.9, 0.93, 1.0], [0.62, 0.65, 0.76], 0.84],
});

/** Ridged noise in [0, 1) (Scenery's own: sharp crests where fbm crosses its middle). */
const ridged = (x, z, seed, octaves = 4) => 1 - Math.abs(fbm2(x, z, { seed, octaves }) * 2 - 1);

/**
 * A season's relief beyond the map (Scenery `makeOuterHeight` adds it to the temperate one): in
 * summer limestone headlands rising within 4.5 u beyond water at the map's north, east and west
 * edges (a cove: the sea never runs out at an edge; the south, toward the camera, stays low); in
 * winter ridged foothills and sharper crests on the far range.
 * @param {string} season
 * @param {{ width: number, depth: number, tileAt: (i: number, j: number) => any }} tileMap
 * @param {number} x @param {number} z the point
 * @param {number} px @param {number} pz the nearest point on the map's edge
 * @param {number} d its distance from the map
 * @param {number} north @param {number} far Scenery's weights of the northern hills and the far range
 * @returns {number} the height to add
 */
function seasonRelief(season, tileMap, x, z, px, pz, d, north, far) {
  if (season === 'summer') {
    if (z > tileMap.depth) return 0;
    const t = tileMap.tileAt(Math.min(Math.max(Math.floor(px), 0), tileMap.width - 1), Math.min(Math.max(Math.floor(pz), 0), tileMap.depth - 1));
    return t?.water ? smoothstep(0.6, 4.5, d) * (3.2 + 2.6 * fbm2(x * 0.09, z * 0.09, { seed: 47, octaves: 2 })) : 0;
  }
  if (season === 'winter') return north * ridged(x * 0.04, z * 0.05, 41) * 8 * smoothstep(-4, -30, z) + far * (ridged(x * 0.02, z * 0.025, 43, 5) - 0.5) * 18;
  return 0;
}

/**
 * The season land (the season kit's `SEASON_LAND`): GroundDetail's growth by season top
 * (`growth`, `families`) and crops (`crops`, `cropFields`; ../../pixel/SeasonSprites.js), Scenery's
 * forest mixes (`mix`), outer ground (`outer`) and relief (`relief`).
 */
export const SEASON_LAND = Object.freeze({
  growth: SEASON_GROWTH, families: SEASON_FAMILIES, fields: seasonFieldSteps,
  mix: SEASON_MIX, outer: SEASON_OUTER, relief: seasonRelief,
});

// the season tops (../../pixel/textures/seasons.js) in the engine's tables, as the kit loads — before
// any level that names them is built: the TileMap's behaviour sets (the stubble's rows, the paths
// and the cobbles stay unturned), the painted map's flat colours, the minimap's classes (G has no
// snow class: snow, ice and limestone take the pale stone's)
registerTops({
  organic: ['spring_grass', 'blossom_grass', 'autumn_grass', 'fallen_leaves', 'limestone', 'cove_sand', 'snow_top', 'ice_top'],
  grass: ['spring_grass', 'blossom_grass', 'autumn_grass', 'fallen_leaves'],
  receivers: ['stubble', 'limestone', 'cove_sand', 'slate_cobble', 'frost_cobble', 'snow_path'],
  priority: { spring_grass: 2, autumn_grass: 2, blossom_grass: 1, fallen_leaves: 1 },
});
registerTopColors({
  spring_grass: '#6ea648', blossom_grass: '#a6b472', autumn_grass: '#b8984a', stubble: '#c6a660', fallen_leaves: '#ac5e2e',
  limestone: '#c4b898', cove_sand: '#dacaa0', slate_cobble: '#5e6678', frost_cobble: '#9aa6b8', snow_top: '#dce6f2',
  snow_path: '#b2c2da', ice_top: '#8ec6da',
});
registerMapClasses({
  spring_grass: ['g', 't'], blossom_grass: ['f', 'f'], autumn_grass: ['s', 't'], fallen_leaves: ['F', 'F'], stubble: ['F', 'F'],
  cove_sand: ['s', 's'], slate_cobble: ['c', 'c'], frost_cobble: ['c', 'c'], snow_path: ['p', 'p'],
  limestone: ['k', 'r'], snow_top: ['k', 'r'], ice_top: ['k', 'r'],
});
