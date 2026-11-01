/**
 * Particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §4, §8): the
 * swordmaster's (the player package; burst by its look, src/game/combat/SwordmasterFx.js, at the
 * moments `PlayerCombat` calls it). Their colours keep the look's hues through the tone map: the
 * wind slate-steel, Dragonfang Wave crimson and coral (never orange: fire and embers are the foes'),
 * Skyfall Judgement burnished gold; their `hdr` stays ≤ 1.6 (COMBAT_VFX.md §4.4).
 * Spread into `PARTICLE_PRESETS` (../Particles.js; the parameters are documented there).
 *
 * Every one is a burst that shares a combat pool the combat warm-up already made (COMBAT.md §11.3,
 * §19), so none adds a pool or a program: its pool-key fields (texture, variants, blending, lit,
 * pulse, tumble, aspect, streak, fade, twinkle, blink, nightVisibility) are exactly those of
 *  - `hitSpark` (the additive streaks): `heroWindSpark`, `heroFangEmber`;
 *  - `sparkle` / `healGlow` (the additive stars): `heroHoly`, `heroGlint`, `heroMote`;
 *  - `footstep` / `deathPoof` (the lit smoke): `heroGust`, `heroDustRing`;
 *  - `splash` (the square chips): `heroDebris`.
 * Only per-particle fields (colours, hdr, life, size, speeds, gravity, drag, spin, spawn box) are
 * their own. Call them override-free through `CombatSystem.burst` (≤ 24 a call).
 */

/** The pool-key fields of the additive streak pool (`hitSpark`). */
const STREAK = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
  lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** … of the additive star pool (`sparkle`). */
const STAR = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
  lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** … of the lit smoke pool (`footstep`). */
const SMOKE = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
  lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
});
/** … of the square chip pool (`splash`). */
const CHIP = Object.freeze({
  mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal', variants: 1,
  lit: 0.5, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
});

/** @satisfies {Record<string, object>} */
export const PRESETS = {
  /** Slate-steel wind streaks off a blade (the combo's gale, Tempest Edge's spin, hits and release). */
  heroWindSpark: {
    ...STREAK,
    count: 8, life: [0.16, 0.34], size: [0.04, 0.07], sizeEnd: 0.5,
    spawnSize: [0.5, 0.3, 0.5], burstSpeed: [4, 9], burstUp: [0.2, 1.4], gravity: -3, drag: 4.5,
    colors: ['#9fb4d8', '#7f96c0', '#c4d2ea'], hdr: 1.4, alpha: 1,
  },
  /** Crimson and coral sparks shed by Dragonfang Wave (never orange: fire is the foes' colour). */
  heroFangEmber: {
    ...STREAK,
    count: 6, life: [0.25, 0.55], size: [0.05, 0.08], sizeEnd: 0.45,
    spawnSize: [1.6, 0.4, 0.6], burstSpeed: [1.2, 3.5], burstUp: [0.6, 2.2], gravity: 1.2, drag: 2.2,
    colors: ['#e0283c', '#ff5a48', '#ff9a88'], hdr: 1.6, alpha: 1,
  },
  /** Gold motes rising round Skyfall Judgement (the leap, the sword, the impact). */
  heroHoly: {
    ...STAR,
    count: 10, life: [0.6, 1.2], size: [0.16, 0.3], sizeEnd: 0.8,
    spawnSize: [2.4, 0.6, 2.4], velocity: [0, 1.4, 0], burstSpeed: [0.3, 1.6], burstUp: [0.4, 1.4], gravity: 0.4, drag: 1.6, spin: [0.5, 2],
    color: '#ffc860', hdr: 1.25, alpha: 1,
  },
  /** Steel glints round Tempest Edge's blades. */
  heroGlint: {
    ...STAR,
    count: 8, life: [0.3, 0.6], size: [0.14, 0.24], sizeEnd: 0.7,
    spawnSize: [0.6, 0.6, 0.6], burstSpeed: [0.5, 2.0], burstUp: [0.1, 0.6], drag: 2.5, spin: [1, 3],
    color: '#c8d6ea', hdr: 1.3, alpha: 1,
  },
  /** A gust of dust at the feet (a spin, a lunge, a kick-off). */
  heroGust: {
    ...SMOKE,
    count: 8, life: [0.35, 0.7], size: [0.22, 0.36], sizeEnd: 2.4,
    spawnSize: [0.6, 0.05, 0.6], burstSpeed: [1.6, 3.4], burstUp: [0.1, 0.5], gravity: -0.2, drag: 4.5, spin: [0.5, 2.5],
    color: '#dccbb0', alpha: 0.6,
  },
  /** The dust ring of Skyfall Judgement's impact: low, wide and dark, rolling out (no veil over the foes). */
  heroDustRing: {
    ...SMOKE,
    count: 12, life: [0.9, 1.6], size: [0.5, 0.8], sizeEnd: 2.6,
    spawnSize: [3.2, 0.15, 3.2], burstSpeed: [4.5, 8.5], burstUp: [0.1, 0.5], gravity: -0.1, drag: 3.0, spin: [0.3, 1.5],
    color: '#7d6a52', alpha: 0.45,
  },
  /** Rock and earth chips thrown up by Skyfall Judgement (and a wave breaking on a wall). */
  heroDebris: {
    ...CHIP,
    count: 16, life: [0.8, 1.3], size: [0.11, 0.2], sizeEnd: 0.85,
    spawnSize: [1.4, 0.2, 1.4], burstSpeed: [2, 5.5], burstUp: [4, 8], gravity: -16, drag: 0.4, ballistic: true,
    colors: ['#4e3f33', '#6e5946', '#33291f', '#8a7259'], hdr: 1, alpha: 1,
  },
  /** Burnished-gold motes rising off Skyfall's sword (its hold, its dissolve). */
  heroMote: {
    ...STAR,
    count: 3, life: [0.6, 1.0], size: [0.1, 0.18], sizeEnd: 0.5,
    spawnSize: [0.3, 0.4, 0.3], velocity: [0, 1.2, 0], burstSpeed: [0.1, 0.5], burstUp: [0.2, 0.6], gravity: 0.2, drag: 1.4, spin: [0.5, 2],
    color: '#ffcf70', hdr: 1.15, alpha: 1,
  },
};
