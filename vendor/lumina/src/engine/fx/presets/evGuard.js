/**
 * The guardians' particle presets (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.7):
 * Rimehart's frost and the Harvest Mawkin's straw, leaves and feathers. Registered by the guardians'
 * pack modules (src/game/combat/packs/evermere/rimehart.js, `api.registerPresets`) when the pack
 * loads — before the combat's warm-up — into `PARTICLE_PRESETS` (../Particles.js; the parameters are
 * documented there). Owner: the guardians package.
 *
 * **No new pool, no new program:** a burst pool is keyed by texture, variants, blending, lit, pulse,
 * tumble, aspect, streak, fade, twinkle, blink and nightVisibility, and its uniforms come from the
 * preset that created it — so every preset here copies those fields from an engine preset whose pool
 * the combat's warm-up makes on every combat level (`deathPoof` / `footstep`: smoke, normal, lit;
 * `splash`: square chips, normal, half lit) and tunes only the per-particle fields. **Never additive
 * on snow**: frost, shards and snow are normal-blended (a pale chip with the light on it, not a
 * glare). Combat bursts: called with an explicit count (≤ 16) and, for a stream, a `velocity`
 * override (a per-particle field).
 */

/** The pool-key fields of the smoke pool (`footstep`, `deathPoof`). */
const SMOKE_POOL = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** The pool-key fields of the chip pool (`splash`). */
const CHIP_POOL = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal', variants: 1,
  lit: 0.5, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  // a puff of frost: Rimehart's landings and stomps, the breath of its bellow, a rise from the furrow
  evgFrost: {
    ...SMOKE_POOL,
    count: 6, life: [0.45, 0.85], size: [0.3, 0.48], sizeEnd: 2.4,
    spawnSize: [0.8, 0.15, 0.8], burstSpeed: [0.6, 1.6], burstUp: [0.2, 0.7],
    gravity: -0.1, drag: 3.2, spin: [0.3, 1.4],
    color: '#e4f0fc', alpha: 0.62,
  },
  // the blizzard of the bellow: a dense frost breath (given a velocity along the cone)
  evgBreath: {
    ...SMOKE_POOL,
    count: 8, life: [0.5, 0.9], size: [0.34, 0.56], sizeEnd: 2.8,
    spawnSize: [0.4, 0.3, 0.4], burstSpeed: [0.3, 0.9], burstUp: [0.0, 0.3],
    gravity: -0.15, drag: 1.2, spin: [0.4, 1.6],
    color: '#d6e8fa', alpha: 0.55,
  },
  // ice shards: crystals growing on the antlers, a shell cracking, the frost stalks erupting
  evgShards: {
    ...CHIP_POOL,
    count: 10, life: [0.4, 0.8], size: [0.07, 0.13], sizeEnd: 0.6,
    spawnSize: [0.4, 0.3, 0.4], burstSpeed: [1.2, 3.2], burstUp: [1.6, 3.6], gravity: -9.8, drag: 0.5, ballistic: true,
    colors: ['#bfeaff', '#8fd6ea', '#e6faff', '#5aa8cc'], hdr: 1, alpha: 1,
  },
  // snow knocked off a tree's crown by the charge, off the stag's back as it shakes
  evgSnow: {
    ...CHIP_POOL,
    count: 12, life: [0.7, 1.3], size: [0.08, 0.14], sizeEnd: 0.8,
    spawnSize: [1.6, 0.6, 1.6], burstSpeed: [0.2, 0.8], burstUp: [0.0, 0.6], gravity: -4.5, drag: 1.4,
    colors: ['#f4f8ff', '#e2ecf8', '#ffffff'], hdr: 1, alpha: 1,
  },
  // blossom petals drifting behind the thawed stag as it walks away
  evgPetals: {
    ...CHIP_POOL,
    count: 4, life: [1.1, 1.8], size: [0.08, 0.12], sizeEnd: 0.8,
    spawnSize: [1.2, 1.4, 1.2], burstSpeed: [0.1, 0.4], burstUp: [0.1, 0.5], gravity: -0.6, drag: 1.8,
    colors: ['#fff6f2', '#fbe2ea', '#f2bcd6', '#fffaf0'], hdr: 1, alpha: 1,
  },
  // straw bursting from the Mawkin's seams (its hurt, its collapse, the spin)
  evgStraw: {
    ...CHIP_POOL,
    count: 10, life: [0.5, 1.0], size: [0.07, 0.12], sizeEnd: 0.7,
    spawnSize: [0.6, 1.0, 0.6], burstSpeed: [0.8, 2.4], burstUp: [0.8, 2.4], gravity: -6, drag: 1.2,
    colors: ['#ecc870', '#c89a42', '#fff0b0', '#8a6428'], hdr: 1, alpha: 1,
  },
  // wheat chaff and frost thrown up as it rises from the furrow
  evgChaff: {
    ...CHIP_POOL,
    count: 12, life: [0.5, 0.9], size: [0.07, 0.12], sizeEnd: 0.7,
    spawnSize: [1.2, 0.2, 1.2], burstSpeed: [0.8, 2.2], burstUp: [2.2, 4.2], gravity: -9.8, drag: 0.6, ballistic: true,
    colors: ['#f2dc96', '#d8b456', '#e4f0fc', '#a8822e'], hdr: 1, alpha: 1,
  },
  // autumn leaves streaming west to east on the North Wind (given a velocity: the gust)
  evgLeaves: {
    ...CHIP_POOL,
    count: 6, life: [0.7, 1.1], size: [0.09, 0.14], sizeEnd: 0.9,
    spawnSize: [0.6, 1.2, 1.6], burstSpeed: [0.1, 0.5], burstUp: [0.2, 0.8], gravity: -0.8, drag: 0.4,
    colors: ['#e0752f', '#f2b04a', '#b8462a', '#ecc870'], hdr: 1, alpha: 1,
  },
  // black feathers: crows bursting from the coat, a diver hitting
  evgFeathers: {
    ...CHIP_POOL,
    count: 8, life: [0.6, 1.1], size: [0.08, 0.12], sizeEnd: 0.8,
    spawnSize: [0.6, 0.6, 0.6], burstSpeed: [0.6, 1.8], burstUp: [0.6, 1.6], gravity: -2.2, drag: 2,
    colors: ['#1c1c26', '#2c2c3a', '#3a3a4c'], hdr: 1, alpha: 1,
  },
};
