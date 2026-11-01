/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §6.8): the
 * companions' (the party package; docs/specs/PARTY.md §12.5) — the ice mage's frost shards, glints,
 * snow (and its far streaks), ice chunks and puffs, the greatshield's dust and rubble (the cleric's
 * and most of the greatshield's are ./holy.js's and ./earth.js's). Spread into `PARTICLE_PRESETS`
 * (../Particles.js; the parameters are documented there). Combat levels only, burst from
 * src/game/party/MemberCombat.js and the heroes' looks with an explicit count and no overrides.
 *
 * No new burst pool or program: every preset copies the pool-key fields (texture, variants,
 * blending, lit, pulse, tumble, aspect, streak, fade, twinkle, blink, nightVisibility) of a combat
 * burst the combat's warm-up already made (CombatSystem.warmup) — the additive streaks of
 * `hitSpark` / `emberBurst`, the additive stars of `healGlow` / `magicBurst` / `sparkle`, the lit
 * smoke of `deathPoof` / `footstep`, the square bits of `splash` — and tunes only the per-particle
 * fields (colours, hdr, life, size, speeds, gravity, drag, spin, spawn box). A pool keeps the
 * uniforms of the preset that created it, which is why those fields must match. Names are
 * prefixed `party` (unique across `PARTICLE_PRESETS`: Particles.js throws on a repeated one).
 */

/**
 * The pool-key fields of the warmed combat pools (see above); the heroes' other preset modules
 * (./holy.js, ./earth.js) spread these too, so their presets join the same pools.
 */
export const STREAK = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
  lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
export const STAR = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
  lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
export const SMOKE = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});
export const BITS = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal', variants: 1,
  lit: 0.5, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  // ---- the ice mage: frost ----
  /** Ice shards flung off a lance's hit, Blizzard's whirl, the Tomb's eruption. */
  partyFrostShards: {
    ...STREAK, count: 8, life: [0.25, 0.55], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [0.3, 0.3, 0.3], burstSpeed: [2.5, 6], burstUp: [0.8, 3], gravity: -7, drag: 2,
    colors: ['#c8ecff', '#8cd2ff', '#b0e2ff'], hdr: 1.6, alpha: 1,
  },
  /** Frost glints gathering at the staff, glittering off the shattered Tomb. */
  partyFrostGlint: {
    ...STAR, count: 6, life: [0.4, 0.9], size: [0.12, 0.22], sizeEnd: 0.6,
    spawnSize: [0.6, 0.6, 0.6], burstSpeed: [0.3, 1.1], burstUp: [0.2, 0.8], gravity: -0.4, drag: 2,
    colors: ['#c4eaff', '#92d2ff'], hdr: 1.5, alpha: 1,
  },
  /** The Frost Lance's trail. */
  partyFrostTrail: {
    ...STREAK, count: 1, life: [0.18, 0.32], size: [0.05, 0.07], sizeEnd: 0.4,
    spawnSize: [0.1, 0.1, 0.1], burstSpeed: [0.2, 0.6], burstUp: [-0.2, 0.3], gravity: -1, drag: 3,
    color: '#bfeaff', hdr: 1.8, alpha: 1,
  },
  /** Blizzard's snow: flakes falling slantwise over the field. */
  partySnowfall: {
    ...BITS, count: 8, life: [1.1, 1.7], size: [0.1, 0.16], sizeEnd: 0.7,
    spawnSize: [2.4, 1.2, 2.4], velocity: [1.1, -1.9, 0.4], velocityVariance: [0.5, 0.4, 0.5],
    burstSpeed: [0.1, 0.6], burstUp: [0, 0], gravity: -0.6, drag: 0.15,
    colors: ['#dcefff', '#c4e2fa', '#e8f4ff'], hdr: 1.0, alpha: 1,
  },
  /** Chunks of ice thrown up when the Tomb erupts and shatters. */
  partyIceChunks: {
    ...BITS, count: 12, life: [0.5, 0.9], size: [0.08, 0.15], sizeEnd: 0.7,
    spawnSize: [1.6, 0.3, 1.6], burstSpeed: [1.2, 3.4], burstUp: [2.2, 4.8], gravity: -10, drag: 0.4, ballistic: true,
    colors: ['#d4eeff', '#a6d6f6', '#7cb8e2'], hdr: 1.05, alpha: 1,
  },
  // ---- the ice mage's look (src/game/party/IceSpellFx.js): the Blizzard's far layer, the puffs ----
  /** Fine, fast snow streaks driven slantwise down the wind, high over the whole field (the far layer). */
  partySnowStreak: {
    ...STREAK, count: 6, life: [0.45, 0.7], size: [0.05, 0.075], sizeEnd: 0.8,
    spawnSize: [7, 1.6, 7], velocity: [2.8, -6.5, 1.0], velocityVariance: [0.4, 0.8, 0.4],
    burstSpeed: [0, 0.2], burstUp: [0, 0], gravity: 0, drag: 0,
    colors: ['#b4e0ff', '#8cc6ff', '#cbe9ff'], hdr: 1.4, alpha: 1,
  },
  /** A puff of frost where a shard or a hailstone lands: a few glinting motes kicked up. */
  partyIcePuff: {
    ...STAR, count: 3, life: [0.25, 0.45], size: [0.1, 0.16], sizeEnd: 0.4,
    spawnSize: [0.25, 0.05, 0.25], burstSpeed: [0.4, 1.1], burstUp: [0.3, 0.9], gravity: -1.5, drag: 3,
    colors: ['#b8e4ff', '#8ec8ff'], hdr: 1.3, alpha: 1,
  },
  // ---- the greatshield: earth and the war cry ----
  /** Dust of the slam, the bash, the war cry. */
  partyDust: {
    ...SMOKE, count: 8, life: [0.6, 1.2], size: [0.45, 0.8], sizeEnd: 2.5,
    spawnSize: [1.0, 0.2, 1.0], burstSpeed: [1.4, 3.4], burstUp: [0.2, 0.7], drag: 4, spin: [0.5, 1.5],
    color: '#cdb594', colorEnd: '#9c8770', alpha: 0.7,
  },
  /** Rubble flung up by Earthshatter. */
  partyRubble: {
    ...BITS, count: 12, life: [0.5, 1.0], size: [0.08, 0.16], sizeEnd: 0.8,
    spawnSize: [1.2, 0.2, 1.2], burstSpeed: [1.5, 4], burstUp: [2.5, 5.5], gravity: -11, drag: 0.3, ballistic: true,
    colors: ['#8c7658', '#6c5842', '#a89070', '#5a4a3a'], hdr: 1, alpha: 1,
  },
};
