/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §8): the
 * brutes' (the brutes package) — the sparks, splinters, dust and rubble of a besieged house and of
 * the Drakeborn's slam, the fire of the Hellhound's breath and the Pyromancer's fireballs, pillars
 * and blink. Spread into `PARTICLE_PRESETS` (../Particles.js; the parameters are documented there).
 *
 * No new burst pool and no new program: every preset keeps the pool-key fields (texture, variants,
 * blending, lit, pulse, tumble, aspect, streak, fade, twinkle, blink, nightVisibility) of a burst the
 * combat warm-up already primes (CombatSystem `warmup`), so it shares that pool and its program; only
 * per-particle fields (colours, hdr, alpha, life, size, speeds, gravity, drag, spin, spawn size) are
 * the preset's own. The four pools:
 *   STREAK — additive motion-blurred streaks (`hitSpark`, `emberBurst`): sparks, flames, embers;
 *   SMOKE  — normal-blended lit puffs (`deathPoof`, `footstep`): dust and smoke;
 *   STAR   — additive pulsing stars (`healGlow`, `magicBurst`, `sparkle`): fire cores, gathering fire;
 *   CHIP   — normal-blended half-lit squares (`splash`): wood splinters, rock chips.
 * Call them override-free with an explicit count (the combat context clamps it to 24).
 */

/** The pool key of `hitSpark` / `emberBurst` (Particles.js BASE_PRESETS). */
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

/**
 * Flame colours, gold to deep red: with the hdr kept near 2 they stay fire-coloured under the bloom
 * (white-hot colours at hdr 3 bloomed into white streaks).
 */
const FLAME = ['#ffd27a', '#ff9a2a', '#ff6a1a', '#e8400e'];

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /** A cleaver or a claw striking a wall: white-yellow sparks shooting out and falling. */
  bruteSparks: {
    ...STREAK,
    count: 10, life: [0.15, 0.4], size: [0.04, 0.07], sizeEnd: 0.6,
    spawnSize: [0.2, 0.3, 0.2], burstSpeed: [3, 7], burstUp: [0.8, 3], gravity: -9, drag: 2,
    colors: ['#fff4c8', '#ffd27a', '#ff9a3c'], hdr: 4, alpha: 1,
  },
  /** Wood splinters from a door or a beam: brown chips thrown out, tumbling down. */
  bruteSplinters: {
    ...CHIP,
    count: 10, life: [0.5, 0.95], size: [0.06, 0.11], sizeEnd: 0.9,
    spawnSize: [0.3, 0.4, 0.3], burstSpeed: [1.4, 3.4], burstUp: [1.8, 3.8], gravity: -9.8, drag: 0.6, ballistic: true,
    spin: [3, 9], colors: ['#7a5232', '#9a6c40', '#4e3220'], hdr: 1, alpha: 1,
  },
  /** A billow of dry dust (impacts, the slam, a crash, the pounce's landing). */
  bruteDust: {
    ...SMOKE,
    count: 10, life: [0.6, 1.25], size: [0.4, 0.7], sizeEnd: 2.6,
    spawnSize: [0.9, 0.2, 0.9], burstSpeed: [0.8, 2.4], burstUp: [0.2, 0.9], gravity: 0.15, drag: 3.5, spin: [0.4, 1.5],
    // (pale: it must read over sand and dirt as well as over grass)
    color: '#ece2d0', alpha: 0.7,
  },
  /** Rock chips and clods thrown up by the slam. */
  bruteRubble: {
    ...CHIP,
    count: 12, life: [0.45, 0.9], size: [0.08, 0.15], sizeEnd: 1,
    spawnSize: [1.2, 0.2, 1.2], burstSpeed: [1.5, 4.2], burstUp: [3, 5.5], gravity: -12, drag: 0.3, ballistic: true,
    spin: [2, 7], colors: ['#5c4c40', '#7c6858', '#3e332c', '#9a8268'], hdr: 1, alpha: 1,
  },
  /** An explosion's flames: tongues bursting out and up (the fireball, the roof fire). */
  bruteFireBlast: {
    ...STREAK,
    count: 16, life: [0.35, 0.75], size: [0.13, 0.24], sizeEnd: 0.4,
    spawnSize: [0.7, 0.3, 0.7], burstSpeed: [2, 5], burstUp: [1.5, 4.2], gravity: 2, drag: 2.6,
    colors: FLAME, hdr: 2.1, alpha: 1,
  },
  /** An explosion's bright core: a few big pulsing fire stars (under the bloom's glare). */
  bruteFireCore: {
    ...STAR,
    count: 6, life: [0.18, 0.4], size: [0.6, 1.1], sizeEnd: 1.6,
    spawnSize: [0.5, 0.4, 0.5], burstSpeed: [0.3, 1.2], burstUp: [0.3, 1], drag: 3,
    colors: ['#ffc24a', '#ff8a1e'], hdr: 1.6, alpha: 1,
  },
  /** Dark smoke after fire (a burnt roof, an explosion's aftermath). */
  bruteSmoke: {
    ...SMOKE,
    count: 8, life: [0.9, 1.7], size: [0.45, 0.8], sizeEnd: 3,
    spawnSize: [0.8, 0.4, 0.8], burstSpeed: [0.3, 0.9], burstUp: [0.8, 1.7], gravity: 0.4, drag: 2, spin: [0.3, 1.2],
    color: '#4a403a', alpha: 0.55,
  },
  /**
   * The hellhound's breath: slow, fat flame tongues licking upward where each burst lands along the
   * cone (the stream is the bursts' march down the cone; their own drift is small).
   */
  bruteBreath: {
    ...STREAK,
    count: 6, life: [0.3, 0.55], size: [0.2, 0.36], sizeEnd: 0.45,
    spawnSize: [0.7, 0.3, 0.7], burstSpeed: [0.2, 0.9], burstUp: [0.8, 1.8], gravity: 2.2, drag: 2.4,
    colors: ['#ffa83a', '#ff7a1e', '#f0501a', '#d2340e'], hdr: 1.5, alpha: 1,
  },
  /** A flame pillar erupting from the ground: tall rising tongues. */
  brutePillar: {
    ...STREAK,
    count: 18, life: [0.45, 0.9], size: [0.12, 0.22], sizeEnd: 0.4,
    spawnSize: [1.1, 0.3, 1.1], burstSpeed: [0.2, 0.9], burstUp: [4, 8.5], gravity: 2, drag: 1.2,
    colors: FLAME, hdr: 2.2, alpha: 1,
  },
  /** Fire gathering in the pyromancer's orb (a few pulsing stars). */
  bruteGather: {
    ...STAR,
    count: 4, life: [0.22, 0.45], size: [0.18, 0.32], sizeEnd: 0.5,
    spawnSize: [0.6, 0.6, 0.6], burstSpeed: [0.2, 0.8], burstUp: [-0.3, 0.4], drag: 3,
    color: '#ffb84a', hdr: 2.2, alpha: 1,
  },
  /** Embers rising off a fire (the hound's death, the roof after a hit). */
  bruteEmbers: {
    ...STREAK,
    count: 10, life: [0.6, 1.2], size: [0.04, 0.07], sizeEnd: 0.5,
    spawnSize: [0.8, 0.6, 0.8], burstSpeed: [0.3, 1.1], burstUp: [1.4, 3], gravity: 1.5, drag: 1.3,
    colors: ['#ffb84a', '#ff7a1e', '#ff3a12'], hdr: 2.6, alpha: 1,
  },
  /** The pyromancer's blink: a swirl of fire licking up round where it stood. */
  bruteBlink: {
    ...STREAK,
    count: 14, life: [0.3, 0.6], size: [0.1, 0.18], sizeEnd: 0.4,
    spawnSize: [0.7, 1.4, 0.7], burstSpeed: [2, 4], burstUp: [0.5, 2.5], gravity: 2, drag: 4,
    colors: ['#ffc24a', '#ff6a1a', '#c4300e'], hdr: 2.8, alpha: 1,
  },
};
