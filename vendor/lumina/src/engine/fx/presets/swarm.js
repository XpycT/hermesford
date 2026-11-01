/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §6.7): the
 * swarms' (the swarm package) — the dust of a kobold's lunge and a whelp's bite, the sparks of a
 * whelp's fire spit and of a swarm foe's death, an imp's diving burst and its ash. Spread into
 * `PARTICLE_PRESETS` (../Particles.js; the parameters are documented there).
 *
 * **No new pool, no new program:** a burst pool is keyed by texture, variants, blending, lit, pulse,
 * tumble, aspect, streak, fade, twinkle, blink and nightVisibility, and its uniforms come from the
 * preset that created it — so every preset here copies those fields from an engine preset whose
 * pool a combat level already has (`deathPoof` / `footstep`: smoke, normal, lit; `hitSpark` /
 * `emberBurst`: the additive streak pool) and tunes only the per-particle fields (colours, hdr,
 * life, size, speeds, gravity, drag, spin). They are combat bursts: called override-free with an
 * explicit count (≤ 14).
 */

/** The pool-key fields of the smoke pool (`footstep`, `deathPoof`). */
const SMOKE_POOL = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** The pool-key fields of the additive streak pool (`hitSpark`, `emberBurst`). */
const STREAK_POOL = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
  lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  // sandy dust kicked up by a kobold's lunge or a whelp landing a bite (warm: the arid ground)
  swarmDust: {
    ...SMOKE_POOL,
    count: 5, life: [0.35, 0.6], size: [0.16, 0.26], sizeEnd: 2.0,
    spawnSize: [0.4, 0.04, 0.4], burstSpeed: [0.6, 1.4], burstUp: [0.1, 0.4],
    gravity: -0.3, drag: 5, spin: [0.5, 2],
    color: '#d8b888', alpha: 0.65,
  },
  // the grey-black ash an imp's burst leaves hanging
  swarmAsh: {
    ...SMOKE_POOL,
    count: 5, life: [0.6, 1.1], size: [0.35, 0.5], sizeEnd: 2.4,
    spawnSize: [0.8, 0.2, 0.8], burstSpeed: [0.5, 1.2], burstUp: [0.4, 0.9],
    gravity: 0.2, drag: 3, spin: [0.3, 1.2],
    color: '#5c5458', alpha: 0.6,
  },
  // fire sparks: a whelp's spit leaving the jaws, a swarm foe dying in embers
  swarmSpark: {
    ...STREAK_POOL,
    count: 6, life: [0.25, 0.55], size: [0.04, 0.07], sizeEnd: 0.5,
    spawnSize: [0.2, 0.2, 0.2], burstSpeed: [1.5, 3.5], burstUp: [0.8, 2.2], gravity: -2, drag: 2.5,
    colors: ['#ffb040', '#ff6a1e', '#ffe08a'], hdr: 2.6, alpha: 1,
  },
  // an imp's diving burst: a fast ring of fire streaks thrown out low over the ground
  swarmFlare: {
    ...STREAK_POOL,
    count: 14, life: [0.3, 0.6], size: [0.05, 0.08], sizeEnd: 0.45,
    spawnSize: [0.3, 0.1, 0.3], burstSpeed: [3.5, 6.5], burstUp: [0.6, 2.4], gravity: -3, drag: 3,
    colors: ['#ff8a2a', '#ff4a14', '#ffd27a'], hdr: 3, alpha: 1,
  },
};
