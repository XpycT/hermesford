/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §8): the
 * dragon's (the dragon package) — the sky dragon's falling fireballs and their impacts, the boss's
 * breath, gust, landing and stomp dust, debris, the death's ember storm. Spread into
 * `PARTICLE_PRESETS` (../Particles.js; the parameters are documented there).
 *
 * **No new pool, no new program.** A burst pool is keyed by texture, variants, blending, lit,
 * pulse, tumble, aspect, streak, fade, twinkle, blink and nightVisibility, and keeps the uniforms of
 * the preset that created it; every preset here copies those fields from one of the four pools the
 * combat warm-up already creates (CombatSystem.warmup bursts `hitSpark` … `footstep`, `splash`):
 * - `STREAK` — hitSpark / emberBurst's additive streaks (sparks, flame jets, embers);
 * - `SMOKE` — deathPoof / footstep's lit smoke (smoke, dust);
 * - `STAR` — healGlow / sparkle's additive pulsing stars (the impact flare);
 * - `CHUNK` — splash's lit squares (debris).
 * Only per-particle fields (colours, hdr, life, size, speeds, gravity, drag, spin, spawn size) are
 * the presets' own, so a level with the dragon adds no pool and no program (§7.3).
 *
 * The breath and the gust are directional: `dragonBreath0` … `dragonBreath15` and `dragonGust0` …
 * `dragonGust15` jet along 16 compass directions in world space (`dirPreset(prefix, dx, dz)` picks
 * one), so a burst stays override-free (cached, allocation-free).
 */

/** The pool-key fields of hitSpark / emberBurst (additive streaks). */
const STREAK = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
  lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool-key fields of deathPoof / footstep (lit smoke). */
const SMOKE = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool-key fields of healGlow / sparkle (additive pulsing stars). */
const STAR = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
  lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** The pool-key fields of splash (lit squares). */
const CHUNK = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal', variants: 1,
  lit: 0.5, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

const FIRE = ['#fff0b0', '#ffb648', '#ff7a1e', '#ff3a12'];
const EMBER = ['#ff8a2a', '#ff3a12', '#ffd27a'];

/** The compass directions of the directional presets. */
export const DRAGON_DIRS = 16;

/**
 * The directional preset of `prefix` nearest a world direction (dx, dz).
 * @param {'dragonBreath'|'dragonGust'} prefix
 * @param {number} dx
 * @param {number} dz
 * @returns {string}
 */
export function dirPreset(prefix, dx, dz) {
  const a = Math.atan2(dz, dx);
  const k = ((Math.round((a / (Math.PI * 2)) * DRAGON_DIRS) % DRAGON_DIRS) + DRAGON_DIRS) % DRAGON_DIRS;
  return `${prefix}${k}`;
}

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  // ---- the sky dragon's fireball (§6.5) ----
  /** Sparks shed by a falling fireball (a few every frame of its fall). */
  dragonTrail: {
    ...STREAK, count: 3, life: [0.22, 0.45], size: [0.08, 0.14], sizeEnd: 0.4,
    spawnSize: [0.3, 0.3, 0.3], burstSpeed: [0.3, 1.4], burstUp: [0.4, 1.6], gravity: 1.5, drag: 2.2,
    colors: FIRE.slice(1), hdr: 3,
  },
  /** The impact's flames and sparks thrown out. */
  dragonFireBurst: {
    ...STREAK, count: 18, life: [0.3, 0.75], size: [0.12, 0.24], sizeEnd: 0.5,
    spawnSize: [0.8, 0.3, 0.8], burstSpeed: [4, 10], burstUp: [2, 6.5], gravity: -6, drag: 2.4,
    colors: FIRE, hdr: 3.2,
  },
  /** The impact's flash: a few big hot stars (overlapping, just over the bloom threshold). */
  dragonFlare: {
    ...STAR, count: 4, life: [0.14, 0.3], size: [0.9, 1.5], sizeEnd: 1.8,
    spawnSize: [0.6, 0.4, 0.6], burstSpeed: [0, 0.4], burstUp: [0.2, 0.6], drag: 3,
    colors: ['#fff0c8', '#ffd27a'], hdr: 0.7,
  },
  /** Embers rising from a fire (an impact, a burning patch, the death's storm). */
  dragonEmbers: {
    ...STREAK, count: 10, life: [0.8, 1.8], size: [0.05, 0.09], sizeEnd: 0.5,
    spawnSize: [2, 0.4, 2], burstSpeed: [0.3, 1.2], burstUp: [1.5, 3.5], gravity: 1.2, drag: 1.2,
    colors: EMBER, hdr: 2.4,
  },
  /** Black smoke rolling up from an impact or a burning patch. */
  dragonSmoke: {
    ...SMOKE, count: 8, life: [1.6, 2.8], size: [0.8, 1.2], sizeEnd: 3,
    spawnSize: [1.2, 0.4, 1.2], burstSpeed: [0.3, 1], burstUp: [0.8, 1.8], gravity: 0.3, drag: 1.2, spin: [0.3, 1],
    color: '#3a3234', alpha: 0.75,
  },
  /** Dust thrown out low along the ground (a landing, a stomp, a crash). */
  dragonDust: {
    ...SMOKE, count: 12, life: [0.8, 1.6], size: [0.7, 1.1], sizeEnd: 2.6,
    spawnSize: [1.5, 0.2, 1.5], burstSpeed: [2, 5.5], burstUp: [0.2, 0.9], gravity: -0.4, drag: 2.5, spin: [0.3, 1.2],
    color: '#a8927a', alpha: 0.65,
  },
  /** Rock chunks and clods kicked up (ballistic). */
  dragonDebris: {
    ...CHUNK, count: 10, life: [0.6, 1.1], size: [0.12, 0.22], sizeEnd: 0.9,
    spawnSize: [0.8, 0.2, 0.8], burstSpeed: [2, 5], burstUp: [3, 6.5], gravity: -14, drag: 0.6, ballistic: true,
    colors: ['#3a3036', '#5a4a44', '#2a2226', '#6e5a4c'], hdr: 1, alpha: 1,
  },
  /** The death's ember storm: a wide cloud of embers whirling up from the body. */
  dragonDeath: {
    ...STREAK, count: 24, life: [1.2, 2.6], size: [0.06, 0.12], sizeEnd: 0.4,
    spawnSize: [6, 2.5, 3], burstSpeed: [0.5, 2.2], burstUp: [2, 5], gravity: 1.0, drag: 0.8,
    colors: EMBER, hdr: 2.6,
  },
  /** Lava spitting from a crack (phase 3). */
  dragonLavaSpit: {
    ...STREAK, count: 6, life: [0.5, 0.9], size: [0.07, 0.12], sizeEnd: 0.5,
    spawnSize: [1.2, 0.1, 1.2], burstSpeed: [0.4, 1.4], burstUp: [3, 6], gravity: -9, drag: 0.4, ballistic: true,
    colors: EMBER, hdr: 2.8,
  },
  // ---- directional: the breath's flame jets and the gust's dust (16 compass directions) ----
  // (a long jet poured down from the head, 5 u up, onto the ground 6–9 u ahead: fast, little drag.
  // One particle stays under the bloom's threshold — dozens overlap along the jet, and the
  // cinematic look (bloom threshold 0.95, streaks above 1.0) turned an HDR 1.5 jet into a white
  // glare over half the screen)
  ...directional('dragonBreath', (dx, dz) => ({
    ...STREAK, count: 5, life: [0.45, 0.75], size: [0.22, 0.36], sizeEnd: 1.8,
    spawnSize: [0.35, 0.3, 0.35], velocity: [dx * 12, -7, dz * 12], burstSpeed: [0, 2.6], burstUp: [-0.6, 0.6],
    gravity: 0.6, drag: 0.5, colors: ['#ffc25a', '#ff8a2a', '#f05a1a', '#c0300e'], hdr: 0.72,
  })),
  ...directional('dragonGust', (dx, dz) => ({
    ...SMOKE, count: 5, life: [0.6, 1.1], size: [0.6, 1.0], sizeEnd: 2.4,
    spawnSize: [1.4, 0.3, 1.4], velocity: [dx * 8.5, 0.3, dz * 8.5], burstSpeed: [0.2, 1.5], burstUp: [0, 0.6],
    gravity: -0.2, drag: 1.4, spin: [0.4, 1.5], color: '#b8a088', alpha: 0.55,
  })),
};

/**
 * Presets `<prefix>0` … `<prefix>15`, one per compass direction (0 = +X, counter-clockwise toward +Z).
 * @param {string} prefix
 * @param {(dx: number, dz: number) => object} make
 * @returns {Record<string, object>}
 */
function directional(prefix, make) {
  /** @type {Record<string, object>} */
  const out = {};
  for (let k = 0; k < DRAGON_DIRS; k++) {
    const a = (k / DRAGON_DIRS) * Math.PI * 2;
    out[`${prefix}${k}`] = make(+Math.cos(a).toFixed(4), +Math.sin(a).toFixed(4));
  }
  return out;
}
