import { STREAK, STAR } from './party.js';

/**
 * Particle presets of Vanquish the Evil Dragon's cleric (Seraphine; her look,
 * src/game/party/HolySpellFx.js): holy sparks, motes and trails, the rising light of Sanctuary,
 * Mend and the raise. Spread into `PARTICLE_PRESETS` (../Particles.js; the parameters are documented
 * there) by ./combat.js. Combat levels only, burst with an explicit count and no overrides.
 *
 * No new burst pool or program: every preset spreads the pool-key fields of a warmed combat pool
 * (`STREAK`, `STAR`, `SMOKE`, `BITS` from ./party.js) and tunes only the per-particle fields
 * (colours, hdr, life, size, speeds, gravity, drag, spin, spawn box). Names are prefixed `holy` or
 * `life` (unique across `PARTICLE_PRESETS`: Particles.js throws on a repeated one).
 *
 * Two families (COMBAT_VFX.md, the heroes' palette registry): **holy** — a pale champagne gold
 * that reads as light, not fire (the burning world's embers are orange: no orange spark here) —
 * and **life**, a green for the heals (low in red: the stars add over the noon sand, so a paler
 * lime reads yellow there). hdr ≤ 1.5 (they overlap by the dozen at a payoff).
 */

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /** Sparks of light thrown off a pillar, a bolt's burst, the raise. */
  holySpark: {
    ...STREAK, count: 8, life: [0.3, 0.6], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.3, 0.3, 0.3], burstSpeed: [2, 4.5], burstUp: [1.5, 3.5], gravity: -3, drag: 2.5,
    colors: ['#ffe08a', '#ffd067', '#ffeaa8'], hdr: 1.15, alpha: 1,
  },
  /** Motes of light gathering at the staff's sun, drifting off a burst. */
  holyMotes: {
    ...STAR, count: 6, life: [0.5, 0.9], size: [0.12, 0.2], sizeEnd: 0.6,
    spawnSize: [0.35, 0.3, 0.35], velocity: [0, 0.5, 0], burstSpeed: [0.15, 0.55], burstUp: [0.15, 0.5], gravity: 0.3, drag: 2,
    colors: ['#ffe596', '#ffd473'], hdr: 1.25, alpha: 1,
  },
  /** The Holy Bolt's trail. */
  holyTrail: {
    ...STAR, count: 1, life: [0.22, 0.4], size: [0.11, 0.18], sizeEnd: 0.3,
    spawnSize: [0.12, 0.12, 0.12], burstSpeed: [0, 0.2], burstUp: [0, 0.2], drag: 3,
    color: '#ffe08a', hdr: 1.3, alpha: 1,
  },
  /** A pillar dissolving upward into motes (Judgement's release, the raise's). */
  holyAscend: {
    ...STAR, count: 12, life: [0.5, 0.9], size: [0.1, 0.18], sizeEnd: 0.4,
    spawnSize: [0.3, 3.0, 0.3], velocity: [0, 1.8, 0], burstSpeed: [0.1, 0.3], burstUp: [0, 0.2], gravity: 0.5, drag: 1,
    colors: ['#ffe39a', '#ffecb4'], hdr: 1.15, alpha: 1,
  },
  /** The light of life rising from Sanctuary's circle, a Mend, a raised hero. */
  lifeRise: {
    ...STAR, count: 6, life: [0.9, 1.5], size: [0.12, 0.2], sizeEnd: 0.6,
    spawnSize: [1.4, 0.2, 1.4], velocity: [0, 1.5, 0], burstSpeed: [0.05, 0.25], burstUp: [0.2, 0.6], gravity: 0.4, drag: 0.8,
    colors: ['#9ee67e', '#86dc6e', '#b4ee96'], hdr: 1.0, alpha: 1,
  },
  /** Life gathering at the staff's sun (Sanctuary's wind-up, Mend). */
  lifeMotes: {
    ...STAR, count: 6, life: [0.5, 0.9], size: [0.12, 0.2], sizeEnd: 0.6,
    spawnSize: [0.35, 0.3, 0.35], velocity: [0, 0.5, 0], burstSpeed: [0.15, 0.55], burstUp: [0.15, 0.5], gravity: 0.3, drag: 2,
    colors: ['#9ee67e', '#86dc6e'], hdr: 1.1, alpha: 1,
  },
  /** Sanctuary's circle lifting into motes as it ends (round its rim). */
  lifeAscend: {
    ...STAR, count: 2, life: [0.6, 1.0], size: [0.1, 0.18], sizeEnd: 0.4,
    spawnSize: [0.4, 0.4, 0.4], velocity: [0, 1.6, 0], burstSpeed: [0.1, 0.3], burstUp: [0, 0.3], gravity: 0.5, drag: 1,
    colors: ['#9ee67e', '#b4ee96'], hdr: 1.05, alpha: 1,
  },
};
