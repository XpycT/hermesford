import { STREAK, STAR, SMOKE, BITS } from './party.js';

/**
 * Particle presets of the Hushed King and the Hush Bell's toll (The Bells of Evermere,
 * docs/contracts/EVERMERE_CAMPAIGN.md §6.7; the king package). Registered at load by the Evermere
 * enemy pack (src/game/combat/packs/evermere/hushedking.js → `registerPresets`), so only a level of
 * the pack's kinds holds their names. Burst with an explicit count and no overrides.
 *
 * No new burst pool or program: every preset spreads the pool-key fields of a combat pool the
 * combat's warm-up already made (`STREAK`, `STAR`, `SMOKE`, `BITS`, ./party.js) and tunes only the
 * per-particle fields. Names are prefixed `evk` (unique across `PARTICLE_PRESETS`).
 *
 * Two families: **rime** — cyan-white frost light (the crown, the slam, the spikes), hdr ≤ 1.5 so it
 * blooms a little and never streaks; **hush** — the black bell's frost ash, dark navy bits and smoke
 * in normal blending (they read as dark on snow, and their cyan-grey tops read on dark ice).
 */

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /** Frost light thrown off the slam, a spike's eruption, the crown's motes. */
  evkRime: {
    ...STAR, count: 8, life: [0.4, 0.8], size: [0.1, 0.18], sizeEnd: 0.5,
    spawnSize: [0.6, 0.3, 0.6], burstSpeed: [0.6, 2.2], burstUp: [0.6, 2.0], gravity: -1.2, drag: 2,
    colors: ['#bdeeff', '#8ad6f6', '#e4fbff'], hdr: 1.35, alpha: 1,
  },
  /** Ice splinters flung off the crown as it shatters, off a cracking spike. */
  evkSplinter: {
    ...STREAK, count: 10, life: [0.35, 0.75], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.3, 0.3, 0.3], burstSpeed: [3, 7.5], burstUp: [1.5, 4.5], gravity: -9, drag: 1.4,
    colors: ['#d8f6ff', '#9ee2ff', '#ffffff'], hdr: 1.5, alpha: 1,
  },
  /** The crown's glints hanging in the air after it breaks. */
  evkGlint: {
    ...STAR, count: 6, life: [0.9, 1.6], size: [0.14, 0.24], sizeEnd: 0.4,
    spawnSize: [1.2, 0.8, 1.2], velocity: [0, 0.4, 0], burstSpeed: [0.1, 0.5], burstUp: [0.1, 0.5], gravity: 0.1, drag: 1.6,
    colors: ['#c8f2ff', '#a6e6ff'], hdr: 1.4, alpha: 1,
  },
  /** Frost ash shaken off a black bell's ring and the Hush Bell's rolling ring: dark bits rising. */
  evkAsh: {
    ...BITS, count: 8, life: [0.6, 1.2], size: [0.06, 0.1], sizeEnd: 0.6,
    spawnSize: [0.8, 0.2, 0.8], velocity: [0, 0.9, 0], burstSpeed: [0.4, 1.4], burstUp: [0.4, 1.4], gravity: 0.6, drag: 1.8,
    colors: ['#1c2638', '#2a3a52', '#46648a'], hdr: 1.0, alpha: 1,
  },
  /** A brazier snuffed by the toll; the black bell sinking away: dark smoke. */
  evkSmoke: {
    ...SMOKE, count: 6, life: [0.8, 1.4], size: [0.35, 0.6], sizeEnd: 1.7,
    spawnSize: [0.6, 0.3, 0.6], velocity: [0, 0.9, 0], burstSpeed: [0.2, 0.7], burstUp: [0.4, 1.0], gravity: 0.4, drag: 1.2,
    colors: ['#1e2430', '#2a3242', '#384356'], hdr: 1.0, alpha: 0.85,
  },
};
