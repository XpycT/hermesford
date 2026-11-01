/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §6.3): the
 * burning village's and the festival's (the siege package; docs/design/SIEGE_AND_FESTIVAL.md).
 * Spread into `PARTICLE_PRESETS` (../Particles.js; the parameters are documented there). All three
 * are emitter presets — continuous GPU emitters made from a prop's descriptors at load (one draw
 * call each, culled with the far particle areas on a big level), never bursts, so they add no burst
 * pool. A fire's sparks are no emitter: they rise in the instanced flame batch
 * (world/props/FlameBatch.js), so a fire or a burning house costs one emitter, its smoke. Names
 * must be unique across `PARTICLE_PRESETS` (Particles.js throws on a repeated one); no preset here
 * is named `smoke`, so World's chimney-smoke override (LevelLook `SMOKE`) never touches
 * them.
 *
 *  - `smokeDark`  the tall dark column over a burning house or a blaze: soot-black at the fire,
 *                 greying and swelling as it climbs and leans with the wind
 *  - `smokeWisp`  a thin pale wisp from embers and from the festival's spent fires
 *  - `bonfireSmoke` the festival bonfire's warm, lit smoke: lighter than the burning village's
 */

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  smokeDark: {
    mode: 'point', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 40, life: [7, 11], size: [0.9, 1.3], sizeEnd: 7,
    spawnSize: [1.0, 0.25, 1.0], velocity: [0, 1.55, 0], velocityVariance: [0.18, 0.35, 0.18],
    gravity: 0.14, drag: 0.2, windInfluence: 0.45, turbulence: [0.35, 0.8], spin: [0.08, 0.3],
    color: '#1c1816', colorEnd: '#5c5858', alpha: 0.82, fade: [0.06, 0.5], lit: 0.75,
  },
  smokeWisp: {
    mode: 'point', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 12, life: [3.5, 6], size: [0.18, 0.3], sizeEnd: 4,
    spawnSize: [0.4, 0.1, 0.4], velocity: [0, 0.55, 0], velocityVariance: [0.08, 0.12, 0.08],
    gravity: 0.05, drag: 0.3, windInfluence: 0.3, turbulence: [0.3, 1.1], spin: [0.1, 0.4],
    color: '#8e8986', colorEnd: '#76747c', alpha: 0.32, fade: [0.15, 0.55], lit: 1,
  },
  bonfireSmoke: {
    mode: 'point', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 26, life: [4, 7], size: [0.5, 0.8], sizeEnd: 4.8,
    spawnSize: [0.6, 0.2, 0.6], velocity: [0, 1.1, 0], velocityVariance: [0.12, 0.2, 0.12],
    gravity: 0.1, drag: 0.25, windInfluence: 0.3, turbulence: [0.25, 1.0], spin: [0.1, 0.35],
    color: '#6a5c56', colorEnd: '#8c8890', alpha: 0.42, fade: [0.12, 0.55], lit: 1,
  },
};
