import { STREAK, STAR, SMOKE, BITS } from './party.js';

/**
 * Particle presets of Vanquish the Evil Dragon's greatshield (Brannoc; his look,
 * src/game/party/EarthSpellFx.js): dust rings, grit, stone chips and their puffs, the shield's
 * sparks, the war cry's sparks, the ward's motes. Spread into `PARTICLE_PRESETS` (../Particles.js;
 * the parameters are documented there) by ./combat.js. Combat levels only, burst with an explicit
 * count and no overrides (the war cry's slower dust ring passes one frozen override record).
 *
 * No new burst pool or program: every preset spreads the pool-key fields of a warmed combat pool
 * (`STREAK`, `STAR`, `SMOKE`, `BITS` from ./party.js) and tunes only the per-particle fields
 * (colours, hdr, life, size, speeds, gravity, drag, spin, spawn box). Names are prefixed `earth`
 * (unique across `PARTICLE_PRESETS`: Particles.js throws on a repeated one).
 *
 * His earth is matte (docs/design/COMBAT_VFX.md §4 registry: stone and dust, no embers): the dust
 * and the chips are lit smoke and square bits under the bloom; only the shield's sparks and the
 * war cry's are additive, at hdr 1.6 (the ally ceiling), and the ward's motes are azure.
 */

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /**
   * A low ring of dust thrown out along the ground (the slam; the war cry, slower): small puffs
   * racing outward and settling, never a veil over the pack (they age on real time, so they leave
   * the centre during the slam's hit-stop).
   */
  earthDustRing: {
    ...SMOKE, count: 12, life: [0.6, 1.0], size: [0.3, 0.5], sizeEnd: 1.6,
    spawnSize: [0.5, 0.1, 0.5], burstSpeed: [5, 7.5], burstUp: [0.03, 0.15], gravity: -0.6, drag: 3, spin: [0.5, 1.5],
    color: '#c9b08c', colorEnd: '#9c8770', alpha: 0.5,
  },
  /** Grit lifting off the ground where the mace will fall (Earthshatter's wind-up): it hangs. */
  earthGrit: {
    ...BITS, count: 5, life: [0.6, 0.9], size: [0.05, 0.09], sizeEnd: 0.8,
    spawnSize: [1.2, 0.05, 1.2], burstSpeed: [0.05, 0.25], burstUp: [0.6, 1.2], gravity: 0.4, drag: 2.5,
    colors: ['#8c7658', '#6c5842', '#a89070'], hdr: 1, alpha: 1,
  },
  /** Stone chips of a spike that crumbles: thrown up and out, falling back hard. */
  earthChips: {
    ...BITS, count: 3, life: [0.5, 0.9], size: [0.08, 0.15], sizeEnd: 0.8,
    spawnSize: [0.3, 0.5, 0.3], burstSpeed: [1.2, 3.0], burstUp: [2, 4], gravity: -16, drag: 0.4, ballistic: true,
    colors: ['#7a6650', '#5a4a3a', '#9c8468'], hdr: 0.9, alpha: 1,
  },
  /** A small puff of dust at a spike's foot (it breaks the ground, it crumbles). */
  earthChipPuff: {
    ...SMOKE, count: 2, life: [0.4, 0.6], size: [0.2, 0.3], sizeEnd: 2.4,
    spawnSize: [0.3, 0.05, 0.3], burstSpeed: [0.3, 0.8], burstUp: [0.1, 0.4], gravity: -0.3, drag: 3, spin: [0.5, 1.5],
    color: '#b8a080', colorEnd: '#9c8770', alpha: 0.5,
  },
  /** Sparks off the shield (the bash, a blocked blow, the mace biting): short warm metal streaks. */
  earthShieldSpark: {
    ...STREAK, count: 6, life: [0.15, 0.3], size: [0.04, 0.06], sizeEnd: 0.5,
    spawnSize: [0.2, 0.2, 0.2], burstSpeed: [3, 6.5], burstUp: [0.5, 2], gravity: -9, drag: 2,
    colors: ['#ffe0a0', '#ffc060'], hdr: 1.6, alpha: 1,
  },
  /** Sparks of the war cry (Bulwark): amber-gold, under the ally ceiling. */
  earthCrySpark: {
    ...STREAK, count: 8, life: [0.3, 0.6], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.6, 0.6, 0.6], burstSpeed: [3, 6.5], burstUp: [0.5, 2.5], gravity: -4, drag: 2.5,
    colors: ['#ffd070', '#ffb040'], hdr: 1.6, alpha: 1,
  },
  /** Motes of the ward rising as the dome dissolves, and off a ward ring that ends. */
  earthWardMote: {
    ...STAR, count: 8, life: [0.6, 1.0], size: [0.12, 0.2], sizeEnd: 0.5,
    spawnSize: [3.6, 1.4, 3.6], velocity: [0, 0.8, 0], burstSpeed: [0.1, 0.4], burstUp: [0.2, 0.6], gravity: 0.3, drag: 1.5,
    colors: ['#a8d2ff', '#7cb4f2'], hdr: 1.3, alpha: 1,
  },
};
