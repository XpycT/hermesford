/**
 * Particle presets of The Bells of Evermere's foes (docs/contracts/EVERMERE_CAMPAIGN.md §6.6; the
 * foes package): the frost a Hushguard's broken armour throws and the motes of its open core, the
 * rime of a seal and of a death, a crow's black feathers and ice chips, the snow a wolf kicks up and
 * the mist of its breath. Registered by the pack (src/game/combat/packs/evermere/hushguard.js) at the
 * start of `CombatSystem.load`, so the combat warm-up primes them.
 *
 * **No new pool, no new program:** every preset keeps the pool-key fields (texture, variants,
 * blending, lit, pulse, tumble, aspect, streak, fade, twinkle, blink, nightVisibility) of a burst the
 * combat warm-up already primes, so it shares that pool and its program (the four pools of
 * ./brutes.js: STREAK, SMOKE, STAR, CHIP); only per-particle fields are the preset's own. On snow a
 * white puff vanishes: the rime and the snow here are tinted toward a cold blue and kept below full
 * alpha; the feathers are near-black. Call them override-free with an explicit count (≤ 24).
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

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  // a Hushguard's armour blown open: ice shards streaking out of the chest (cyan, below the glare)
  evFrostBurst: {
    ...STREAK,
    count: 12, life: [0.2, 0.45], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.25, 0.3, 0.25], burstSpeed: [3, 6.5], burstUp: [0.4, 2.2], gravity: -6, drag: 3,
    colors: ['#9fe6ff', '#4fc4ec', '#cff6ff'], hdr: 1.6, alpha: 1,
  },
  // motes of frost rising off an open core (a slow cyan twinkle)
  evMotes: {
    ...STAR,
    count: 3, life: [0.5, 0.9], size: [0.1, 0.16], sizeEnd: 0.6,
    spawnSize: [0.3, 0.35, 0.3], velocity: [0, 0.8, 0], burstSpeed: [0.1, 0.4], burstUp: [0.2, 0.6], drag: 1.5,
    color: '#8ee6ff', hdr: 1.6, alpha: 1,
  },
  // the plates closing over the core / a Hushguard falling empty: a cold rime puff
  evRimePuff: {
    ...SMOKE,
    count: 8, life: [0.4, 0.75], size: [0.28, 0.4], sizeEnd: 1.8,
    spawnSize: [0.45, 0.4, 0.45], burstSpeed: [0.5, 1.3], burstUp: [0.2, 0.7], drag: 4, spin: [0.4, 1.6],
    color: '#8ea4c2', alpha: 0.5,
  },
  // a crow's death: black feathers fluttering down (and a few at its hits)
  evFeathers: {
    ...CHIP,
    count: 10, life: [0.7, 1.3], size: [0.08, 0.12], sizeEnd: 0.8,
    spawnSize: [0.3, 0.25, 0.3], burstSpeed: [0.6, 1.8], burstUp: [0.4, 1.4], gravity: -1.4, drag: 2.6,
    colors: ['#16121c', '#241e30', '#0c0a10'], alpha: 1,
  },
  // ice chips: a shard breaking on a hit, a Hushguard's plates hitting the snow
  evIceChips: {
    ...CHIP,
    count: 8, life: [0.3, 0.6], size: [0.06, 0.1], sizeEnd: 0.6,
    spawnSize: [0.2, 0.1, 0.2], burstSpeed: [1, 2.6], burstUp: [1.2, 3], gravity: -9, drag: 0.6,
    colors: ['#d6f2ff', '#8cc8e6', '#5a9cc4'], alpha: 1,
  },
  // snow kicked up by a wolf's pounce and landing (cold blue-white, low)
  evSnowKick: {
    ...SMOKE,
    count: 6, life: [0.35, 0.65], size: [0.16, 0.26], sizeEnd: 2.0,
    spawnSize: [0.45, 0.04, 0.45], burstSpeed: [0.6, 1.5], burstUp: [0.15, 0.5], gravity: -0.4, drag: 5, spin: [0.5, 2],
    color: '#a4b6d2', alpha: 0.55,
  },
  // a wolf's frost breath pouring down its cone
  evBreathMist: {
    ...SMOKE,
    count: 4, life: [0.45, 0.8], size: [0.28, 0.4], sizeEnd: 2.4,
    spawnSize: [0.25, 0.15, 0.25], velocity: [0, 0.1, 0], burstSpeed: [2.2, 3.6], burstUp: [-0.1, 0.3], drag: 2.6, spin: [0.3, 1.2],
    color: '#8eb2d6', alpha: 0.5,
  },
};
