/**
 * Particle presets of Old Gullet, the Thing under the Bay (The Bells of Evermere,
 * docs/contracts/EVERMERE_CAMPAIGN.md §6.7; the gullet package): the spray and the ice thrown up when
 * it breaks through, the mist of a hole, the frost-ink of its siphon and the rime that leaves it when
 * it is freed. Registered by the enemy pack (src/game/combat/packs/evermere/gullet.js →
 * `registerPresets`) before the combat's warm-up; the parameters are Particles.js's.
 *
 * No new burst pool and no new program: every preset keeps the pool-key fields of a burst the combat
 * warm-up already primes (CombatSystem `warmup`), as fx/presets/brutes.js explains — STREAK
 * (`hitSpark`), SMOKE (`deathPoof`), STAR (`healGlow`), CHIP (`splash`); only per-particle fields
 * are the preset's own. Call them with an explicit count (the combat context clamps it to 24).
 */

/** The pool key of `hitSpark` / `emberBurst`. */
const STREAK = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
  lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool key of `deathPoof` / `footstep`. */
const SMOKE = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool key of `healGlow` / `magicBurst` / `sparkle`. */
const STAR = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
  lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool key of `splash`. */
const CHIP = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal', variants: 1,
  lit: 0.5, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /** Sea spray flung up through a hole: white and pale teal droplets, falling back. */
  gulletSpray: {
    ...CHIP,
    count: 14, life: [0.45, 0.95], size: [0.06, 0.12], sizeEnd: 0.6,
    spawnSize: [0.7, 0.2, 0.7], burstSpeed: [1.2, 3.2], burstUp: [3.2, 6.4], gravity: -11, drag: 0.5, ballistic: true,
    colors: ['#f4fbff', '#d2ecf4', '#9fd0e0', '#6aa8c0'], hdr: 1, alpha: 1,
  },
  /** Chunks and splinters of sea ice thrown up, tumbling down. */
  gulletIce: {
    ...CHIP,
    count: 12, life: [0.5, 1.0], size: [0.08, 0.17], sizeEnd: 0.85,
    spawnSize: [0.8, 0.2, 0.8], burstSpeed: [1.6, 4.2], burstUp: [2.6, 5.4], gravity: -12, drag: 0.3, ballistic: true,
    spin: [2, 8], colors: ['#ffffff', '#e2f4fa', '#b4dcec', '#7ab4cc'], hdr: 1, alpha: 1,
  },
  /** A pale breath of mist off broken ice and open water. */
  gulletMist: {
    ...SMOKE,
    count: 8, life: [0.9, 1.7], size: [0.5, 0.9], sizeEnd: 2.4,
    spawnSize: [1.4, 0.2, 1.4], burstSpeed: [0.4, 1.2], burstUp: [0.4, 1.1], gravity: 0.25, drag: 2.6, spin: [0.2, 0.9],
    color: '#e6f2f8', alpha: 0.5,
  },
  /** The frost-ink: dark violet clouds billowing out of the siphon. */
  gulletInk: {
    ...SMOKE,
    count: 10, life: [0.7, 1.3], size: [0.35, 0.6], sizeEnd: 2.2,
    spawnSize: [0.4, 0.3, 0.4], burstSpeed: [3.5, 7.5], burstUp: [0.1, 0.6], gravity: 0.1, drag: 2.2, spin: [0.3, 1.2],
    color: '#1e1838', alpha: 0.85,
  },
  /** Frost glitter in the ink. */
  gulletInkFrost: {
    ...STAR,
    count: 8, life: [0.5, 1.0], size: [0.08, 0.14], sizeEnd: 0.4,
    spawnSize: [0.4, 0.3, 0.4], burstSpeed: [3, 7], burstUp: [0.2, 0.9], gravity: -0.4, drag: 2, spin: [1, 3],
    color: '#bff0ff', hdr: 1.5, alpha: 1,
  },
  /** The rime leaving it as it is freed: pale motes rising slowly off its skin. */
  gulletRime: {
    ...STAR,
    count: 10, life: [1.2, 2.2], size: [0.1, 0.18], sizeEnd: 0.5,
    spawnSize: [1.6, 2.2, 1.0], velocity: [0, 1.0, 0], burstSpeed: [0.1, 0.5], burstUp: [0.4, 1.0], gravity: 0.3, drag: 1.2, spin: [0.5, 2],
    color: '#e4f8ff', hdr: 1.3, alpha: 1,
  },
  /** Bubbles breaking on a hole's water where it is about to rise. */
  gulletBubbles: {
    ...STAR,
    count: 6, life: [0.35, 0.7], size: [0.07, 0.13], sizeEnd: 1.3,
    spawnSize: [1.2, 0.05, 1.2], velocity: [0, 0.6, 0], burstSpeed: [0, 0.2], burstUp: [0.2, 0.5], gravity: 0, drag: 1.5,
    color: '#bfefff', hdr: 1.1, alpha: 1,
  },
  /** Ice dust off a crack as it grows. */
  gulletCrackDust: {
    ...STREAK,
    count: 4, life: [0.2, 0.45], size: [0.04, 0.07], sizeEnd: 0.5,
    spawnSize: [0.3, 0.05, 0.3], burstSpeed: [0.8, 2], burstUp: [0.8, 2], gravity: -6, drag: 2,
    colors: ['#ffffff', '#cfeeff'], hdr: 1.2, alpha: 1,
  },
};
