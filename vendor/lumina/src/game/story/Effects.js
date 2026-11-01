/**
 * Effects — the named visual effects of the story's `effect <name> <where> [scale]` command
 * (set-piece direction, built for Vanquish the Evil Dragon: docs/contracts/DRAGON_CAMPAIGN.md §5.5,
 * §6.10; docs/specs/STORY_SCRIPT.md): an explosion, a fireball falling from the sky, flames, smoke,
 * holy light, frost, a shockwave, dust, sparkles, fireworks, embers, a roar — each a short layered
 * set of particle bursts (a hot core, fire puffs, sparks, smoke, dust, debris, rings of light),
 * with its sound (by distance and side of the screen), a camera shake and, for the big ones near
 * the camera, a faint screen flash. Usable on any level (peaceful ones too). Nothing is hurt,
 * nothing is waited for.
 *
 * **Bursts and pools.** Every layer bursts one of `POOLS`: an engine preset (`PARTICLE_PRESETS`)
 * with the pool-key fields of its style (texture, fade, twinkle, lit — Particles.js keys a burst
 * pool by them); the per-particle fields (colours, sizes, speeds, life, gravity, drag) are the
 * layer's. So the effects add at most six burst pools (the glow, fire, flame and ice styles; the
 * streak and sparkle pools are combat's and the waterfalls' too) and no program beyond the three
 * burst programs (additive, normal, streak). Fire is painted in two blends: `flame` puffs in normal
 * blend (painterly pixel puffs that keep their orange and their outline) over a few additive `fire`
 * and `glow` ones (the heat that blooms). `prime` bursts one particle of each pool the given effects use far
 * below the world: the runtime calls it when a level is attached (StoryRunner.attachLevel, before
 * the game's warm-up compiles the scene) with the effects that level's scripts and the story files
 * name — no program compiles mid-cutscene (CLAUDE.md "Shader warm-up").
 *
 * **Timing.** An effect's later layers (a fireball's fall, fireworks' rockets, a blaze that burns
 * for seconds) are jobs of a per-game schedule in game time: `tick(game, dt)` runs them (the story
 * runtime ticks it every frame — slow motion slows them), `clear(game)` drops them (a level left, a
 * cutscene skipped).
 * Everything random is seeded (the effect, its place and how many played before): `&fixedstep=1`
 * runs reproduce.
 *
 * Part of the story chunk (StoryRunner imports it): a level without a story loads none of it.
 * Node-safe (no DOM, no three.js): the story runtime's Node test plays effects on a stub game.
 *
 * @import { Game } from '../Game.js'
 */
import { EFFECT_NAMES } from '../../engine/level/StoryScript.js';
import { ownValue } from '../../engine/utils/own.js';
import { RNG, hashString, clamp } from '../../engine/utils/math.js';

/**
 * One named effect.
 * @typedef {object} StoryEffect
 * @property {(game: Game, x: number, y: number, z: number, scale: number) => void} play  plays it
 *   at the world point (x, y the ground height there, z), `scale` 0.1–5 (1: its natural size)
 * @property {readonly string[]} presets  the `PARTICLE_PRESETS` names it bursts (its pools' presets)
 * @property {readonly PoolName[]} pools  the burst pools it uses (`POOLS`; primed at load by `prime`)
 */

/**
 * The burst styles: an engine preset and the pool-key fields that make the style (Particles.js
 * `_pool`: texture, variants, blending, lit, pulse, tumble, aspect, streak, fade, twinkle, blink,
 * nightVisibility come from the config that creates a pool). `glow` (a soft additive halo: hot cores,
 * pillars and rings of light), `fire` (additive painterly puffs: flames), `ice` (additive snow
 * crystals), `spark` (additive streaks — combat's ember pool), `star` (additive four-point glints —
 * the sparkle pool), `flame` (unlit smoke puffs in normal blend: the body of a fire, its colour kept
 * at night), `ember` (additive pixel squares), `dust` (lit smoke puffs — the footstep pool,
 * on every level), `smoke` (lit smoke, longer), `chips` (lit pixel squares: debris — the splash
 * pool), `snow` (lit snowflakes).
 */
const POOLS = Object.freeze({
  glow: { preset: 'embers', keys: Object.freeze({ texture: 'glow', twinkle: 0, fade: Object.freeze([0.02, 0.6]) }) },
  fire: { preset: 'embers', keys: Object.freeze({ texture: 'smoke', twinkle: 0, fade: Object.freeze([0.04, 0.55]) }) },
  flame: { preset: 'footstep', keys: Object.freeze({ lit: 0, fade: Object.freeze([0.02, 0.45]) }) },
  ice: { preset: 'sparkle', keys: Object.freeze({ texture: 'snow' }) },
  spark: { preset: 'emberBurst', keys: Object.freeze({}) },
  star: { preset: 'sparkle', keys: Object.freeze({}) },
  ember: { preset: 'embers', keys: Object.freeze({}) },
  dust: { preset: 'footstep', keys: Object.freeze({}) },
  smoke: { preset: 'smoke', keys: Object.freeze({}) },
  chips: { preset: 'splash', keys: Object.freeze({}) },
  snow: { preset: 'snow', keys: Object.freeze({}) },
  // (The Bells of Evermere's: cut-out pixel squares, unlit — the toll's ring, never additive white
  // on snow; tumbling petals and leaves — the thaw kit primes the same pools)
  bit: { preset: 'splash', keys: Object.freeze({ blending: 'cutout', lit: 0 }) },
  petal: { preset: 'petals', keys: Object.freeze({}) },
  leaf: { preset: 'leaves', keys: Object.freeze({}) },
});
/** @typedef {keyof typeof POOLS} PoolName */
/**
 * The order `prime` makes the pools in: the normal-blend ones first — dust, debris, smoke, snow,
 * then the flames, so they draw over the smoke (three draws transparent meshes of one render order
 * and depth in the order they were made) — then the additive ones (a later render order anyway).
 * @type {readonly PoolName[]}
 */
const POOL_ORDER = Object.freeze(/** @type {PoolName[]} */ (['dust', 'chips', 'smoke', 'snow', 'flame', 'bit', 'petal', 'leaf', 'fire', 'glow', 'ice', 'star', 'spark', 'ember']));

/**
 * The per-particle defaults every layer starts from (a preset's own motion — embers rise 1.5 u/s,
 * snow falls — is not wanted under a layer that says nothing of it).
 */
const LAYER = Object.freeze({
  velocity: [0, 0, 0], velocityVariance: [0, 0, 0], windInfluence: 0, spin: [0, 0], gravity: 0, drag: 0,
  alpha: 1, hdr: 1, sizeEnd: 1, spawnSize: [0.2, 0.2, 0.2], burstSpeed: [0, 0], burstUp: [0, 0], ballistic: false,
});

/** The most particles one layer bursts. */
const MAX_LAYER = 96;
/** Where `prime` bursts (far below every level). */
const FAR_BELOW = Object.freeze({ x: 0, y: -1000, z: 0 });
const _p = { x: 0, y: 0, z: 0 };

/**
 * Burst one layer: `n` particles of a pool's style at (x, y, z) with the layer's fields.
 * @param {Game} game
 * @param {PoolName} pool
 * @param {number} x @param {number} y @param {number} z
 * @param {number} n
 * @param {Record<string, unknown>} layer per-particle fields (sizes, speeds, colours …)
 */
function emit(game, pool, x, y, z, n, layer) {
  const ps = game.particles;
  const count = Math.min(MAX_LAYER, Math.round(n));
  if (!ps || count <= 0) return;
  _p.x = x;
  _p.y = y;
  _p.z = z;
  const style = POOLS[pool];
  ps.burst(style.preset, _p, count, { ...LAYER, ...layer, ...style.keys });
}

/** `[a, b]` scaled by `k`. @param {number} a @param {number} b @param {number} k @returns {[number, number]} */
const sc = (a, b, k) => [a * k, b * k];

// -------------------------------------------------------------------------------------------------
// The schedule (game time)
// -------------------------------------------------------------------------------------------------

/**
 * Per game: its clock, the jobs waiting and how many effects played (the seeds).
 * @type {WeakMap<object, { time: number, jobs: { at: number, fn: () => void }[], plays: number }>}
 */
const SCHEDULES = new WeakMap();

/** @param {Game} game */
function scheduleOf(game) {
  let s = SCHEDULES.get(game);
  if (!s) {
    s = { time: 0, jobs: [], plays: 0 };
    SCHEDULES.set(game, s);
  }
  return s;
}

/**
 * Run `fn` `delay` seconds of game time from now (0: at once).
 * @param {Game} game @param {number} delay @param {() => void} fn
 */
function later(game, delay, fn) {
  if (!(delay > 0)) {
    fn();
    return;
  }
  const s = scheduleOf(game);
  s.jobs.push({ at: s.time + delay, fn });
}

/**
 * Advance the effects' clock: the jobs whose time came run (in order). The story runtime calls it
 * every frame with the game's (scaled) dt.
 * @param {Game} game
 * @param {number} dt seconds
 */
export function tick(game, dt) {
  const s = SCHEDULES.get(game);
  if (!s) return;
  s.time += Math.max(0, dt);
  if (!s.jobs.length) return;
  const due = [];
  const keep = [];
  for (const j of s.jobs) (j.at <= s.time ? due : keep).push(j);
  if (!due.length) return;
  s.jobs = keep;
  due.sort((a, b) => a.at - b.at);
  for (const j of due) {
    try {
      j.fn();
    } catch (err) {
      console.warn('[Luminati] story: an effect failed:', err);
    }
  }
}

/**
 * Drop the jobs waiting: a level left (nothing of an effect plays on in the next), a cutscene
 * skipped (StoryRunner.skip: a fireball in its fall never lands; what already burst fades out).
 * @param {Game} game
 */
export function clear(game) {
  const s = SCHEDULES.get(game);
  if (s) s.jobs.length = 0;
}

/** How many effect jobs wait (tests). @param {Game} game */
export function pending(game) {
  return SCHEDULES.get(game)?.jobs.length ?? 0;
}

// -------------------------------------------------------------------------------------------------
// Sound, shake, flash — by where the effect is from the camera's focus
// -------------------------------------------------------------------------------------------------

/**
 * How an effect at (x, z) is heard and felt: `vol` (1 at the focus, down to 0.12 far off), `pan`
 * (−0.9 left … 0.9 right of the screen), `near` (1 at the focus, 0 from 26 u: the shake's and the
 * flash's weight).
 * @param {Game} game @param {number} x @param {number} z
 */
function presence(game, x, z) {
  const rig = game.rig;
  const f = rig?.focusPoint;
  if (!f) return { vol: 1, pan: 0, near: 1 };
  const dx = x - f.x;
  const dz = z - f.z;
  const d = Math.hypot(dx, dz);
  const yaw = Number.isFinite(rig.yaw) ? rig.yaw : 0;
  return {
    vol: clamp(1.15 - d / 36, 0.12, 1),
    pan: clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / 14, -0.9, 0.9),
    near: clamp(1 - d / 26, 0, 1),
  };
}

/** A sound of the effect (AudioSystem names), by distance and side. @param {Game} game @param {string} name @param {number} x @param {number} z @param {number} [volume] @param {number} [pitch] */
function sound(game, name, x, z, volume = 1, pitch = 1) {
  const h = presence(game, x, z);
  game.audio?.playSfx?.(/** @type {any} */ (name), { volume: volume * h.vol, pan: h.pan, pitch });
}

/** A camera shake by distance. @param {Game} game @param {number} x @param {number} z @param {number} amount @param {number} seconds */
function shake(game, x, z, amount, seconds) {
  const k = presence(game, x, z).near;
  if (k > 0.02) game.rig?.shake?.(amount * k, seconds);
}

/**
 * A faint screen flash for a big effect near the camera (the story runtime's ScreenFlash; nothing
 * without one).
 * @param {Game} game @param {number} x @param {number} z @param {'white'|'gold'|'red'} color @param {number} strength 0–1 at the focus
 */
function glare(game, x, z, color, strength) {
  const k = presence(game, x, z).near * strength;
  const story = /** @type {{ screenFlash?: (c: string, s: number, k: number) => void }|null|undefined} */ (game.story);
  if (k > 0.04) story?.screenFlash?.(color, 0.32, Math.min(0.6, k));
}

// -------------------------------------------------------------------------------------------------
// Layers shared by several effects
// -------------------------------------------------------------------------------------------------

/**
 * A ring that runs out along the ground: `n` particles from the centre at one speed in every
 * direction (`r` u in `life` s).
 * @param {Game} game @param {PoolName} pool @param {number} x @param {number} y @param {number} z
 * @param {number} r @param {number} life @param {number} n @param {Record<string, unknown>} look
 */
function ring(game, pool, x, y, z, r, life, n, look) {
  // (with drag the ring slows as it runs: the speed that still reaches r at the end of its life)
  const k = typeof look.drag === 'number' && look.drag > 0 ? look.drag : 0;
  const v = k ? (r * k) / (1 - Math.exp(-k * life)) : r / life;
  emit(game, pool, x, y, z, n, { life: [life * 0.92, life], burstSpeed: [v, v * 1.04], burstUp: [0, 0.05], spawnSize: [0.15, 0.05, 0.15], ...look });
}

/** Rocks and grit thrown up (they fall back and stop where they land). */
function debris(game, x, y, z, s, n, colors = ['#3b2f28', '#5a4a3a', '#2a2220', '#6e5c48']) {
  emit(game, 'chips', x, y + 0.2, z, n, {
    life: [0.7, 1.4], size: sc(0.08, 0.17, s), sizeEnd: 0.9, burstSpeed: sc(1.8, 4.6, s), burstUp: sc(3.5, 7.5, Math.sqrt(s)),
    gravity: -14, drag: 0.3, spawnSize: sc(0.5, 0.5, s).concat(0.5 * s), colors, hdr: 1, ballistic: true, spin: [2, 8],
  });
}

/**
 * A fiery blast: a white-hot flash, the fireball in two blends — painterly flame puffs in three
 * heats (the dark red ones thrown widest drawn first, the orange over them, the yellow-white heart
 * on top: puffs of one pool draw in the order they were burst) round a few additive ones that
 * bloom — a second roll of fire climbing out of it, sparks, a dust ring along the ground, debris,
 * then a dark plume rolling up and embers drifting.
 */
function blast(game, x, y, z, s) {
  const c = clamp(s, 0.4, 3);
  const cy = y + 0.5 * s;
  // the fireball: deep red puffs thrown widest, orange round the heart, the hot heart on top
  emit(game, 'flame', x, cy, z, 10 * c, {
    life: [0.8, 1.25], size: sc(0.85, 1.3, s), sizeEnd: 2.1, burstSpeed: sc(2.2, 4.0, s), burstUp: sc(0.4, 1.6, s),
    drag: 3.6, gravity: 2.2, spawnSize: sc(0.8, 0.4, s).concat(0.8 * s), colors: ['#c8401a', '#a8301a', '#e0581c'], hdr: 1.05, spin: [0.4, 1.4],
  });
  emit(game, 'flame', x, cy, z, 14 * c, {
    life: [0.6, 1.0], size: sc(0.8, 1.2, s), sizeEnd: 1.9, burstSpeed: sc(1.3, 2.9, s), burstUp: sc(0.6, 2.0, s),
    drag: 3.4, gravity: 1.9, spawnSize: sc(0.7, 0.4, s).concat(0.7 * s), colors: ['#ff9a3c', '#ff7a24', '#f6682a'], hdr: 1.2, spin: [0.4, 1.4],
  });
  emit(game, 'flame', x, cy, z, 12 * c, {
    life: [0.45, 0.8], size: sc(0.65, 1.0, s), sizeEnd: 1.7, burstSpeed: sc(0.6, 1.8, s), burstUp: sc(0.8, 2.2, s),
    drag: 3.2, gravity: 1.6, spawnSize: sc(0.5, 0.4, s).concat(0.5 * s), colors: ['#fff3b8', '#ffe08a', '#ffc45a'], hdr: 1.35, spin: [0.4, 1.4],
  });
  // the heat that blooms: a short flash, a few additive puffs inside
  emit(game, 'fire', x, cy, z, 5 * c, {
    life: [0.2, 0.36], size: sc(0.6, 0.9, s), sizeEnd: 1.7, burstSpeed: sc(0.4, 1.4, s), burstUp: sc(0.4, 1.2, s),
    drag: 3.6, gravity: 1, spawnSize: sc(0.4, 0.3, s).concat(0.4 * s), colors: ['#ffd27a', '#ffa23c'], hdr: 1.25, spin: [0.5, 2],
  });
  emit(game, 'glow', x, cy, z, 1, { life: [0.1, 0.12], size: sc(1.6, 1.6, s), sizeEnd: 1.8, color: '#fff0c8', hdr: 2.4, spawnSize: [0, 0, 0] });
  // sparks flying
  emit(game, 'spark', x, cy, z, 18 * c, {
    life: [0.3, 0.75], size: [0.05, 0.08], sizeEnd: 0.5, burstSpeed: sc(4.5, 10.5, Math.sqrt(s)), burstUp: sc(2.5, 8, Math.sqrt(s)),
    gravity: -9, drag: 1.2, spawnSize: [0.3, 0.3, 0.3], colors: ['#fff2c0', '#ffb04a', '#ff7a2a'], hdr: 2.8,
  });
  // the dust ring along the ground and debris
  ring(game, 'dust', x, y + 0.2, z, 3.8 * s, 1.2, 20 * c, { size: sc(0.6, 0.9, s), sizeEnd: 3, drag: 2.2, colors: ['#c9b391', '#b39c7a', '#d8c4a0'], alpha: 0.75, spin: [0.5, 2] });
  debris(game, x, y, z, s, 10 * c);
  // a second roll of fire climbing out of it, darkening as it goes
  later(game, 0.14, () => {
    emit(game, 'flame', x, cy + 0.5 * s, z, 8 * c, {
      life: [0.7, 1.1], size: sc(0.7, 1.05, s), sizeEnd: 1.9, burstSpeed: sc(0.4, 1.2, s), burstUp: sc(1.6, 2.8, Math.sqrt(s)),
      drag: 1.8, gravity: 1.6, spawnSize: sc(0.7, 0.5, s).concat(0.7 * s), colors: ['#d8501c', '#b8381a', '#ff7a24'], hdr: 1.1, spin: [0.4, 1.4],
    });
    emit(game, 'flame', x, cy + 0.4 * s, z, 6 * c, {
      life: [0.5, 0.85], size: sc(0.55, 0.85, s), sizeEnd: 1.7, burstSpeed: sc(0.3, 1.0, s), burstUp: sc(1.8, 3.0, Math.sqrt(s)),
      drag: 1.8, gravity: 1.4, spawnSize: sc(0.5, 0.4, s).concat(0.5 * s), colors: ['#ffc45a', '#ffa23c'], hdr: 1.25, spin: [0.4, 1.4],
    });
  });
  // a dark plume rolling up out of it as the fire dies (the flames draw over it)
  later(game, 0.3, () => emit(game, 'smoke', x, cy + 0.8 * s, z, 12 * c, {
    life: [2.4, 3.8], size: sc(0.8, 1.2, s), sizeEnd: 3.6, burstSpeed: sc(0.5, 1.3, s), burstUp: sc(1.4, 2.6, Math.sqrt(s)),
    drag: 1.2, gravity: 0.45, windInfluence: 0.25, spawnSize: sc(1.0, 0.6, s).concat(1.0 * s), colors: ['#2c2624', '#3a3330', '#4a413c'], alpha: 0.8, spin: [0.1, 0.5],
  }));
  // embers drifting up out of it
  later(game, 0.12, () => emit(game, 'ember', x, cy, z, 14 * c, {
    life: [1.4, 2.8], size: [0.06, 0.1], sizeEnd: 0.4, burstSpeed: [0.4, 1.8], burstUp: [1.4, 3.4], gravity: 0.6, drag: 0.8,
    windInfluence: 0.45, spawnSize: sc(1.4, 0.6, s).concat(1.4 * s), colors: ['#ff8a2a', '#ffc070', '#ff5a1a'], hdr: 2.2,
  }));
}

// -------------------------------------------------------------------------------------------------
// The effects
// -------------------------------------------------------------------------------------------------

/** Firework palettes (centre colours of a burst; the rocket and the glints follow them). */
const FIREWORKS = Object.freeze([
  ['#fff1c4', '#ffd06a', '#ffb04a'], // gold
  ['#e6fbff', '#9fdcff', '#5288e6'], // frost
  ['#ffd0e6', '#ff8ab4', '#fff1c4'], // rose
  ['#d8ffe8', '#7fe3b0', '#e6fbff'], // jade
  ['#fff6e0', '#ff9a7a', '#d0452f'], // ember red
]);

/** The pools of a blast. @type {PoolName[]} */
const BLAST_POOLS = ['glow', 'fire', 'flame', 'spark', 'dust', 'chips', 'smoke', 'ember'];

/**
 * The effects by name. Each `play(game, x, y, z, s)`: (x, z) the place, y its ground height, s the
 * scale (1: natural).
 * @type {Record<string, { play: (game: Game, x: number, y: number, z: number, s: number, rng: RNG) => void, pools: PoolName[] }>}
 */
const RECIPES = {
  // a fiery blast on the ground
  explosion: {
    pools: BLAST_POOLS,
    play(game, x, y, z, s) {
      blast(game, x, y, z, s);
      sound(game, 'explosion', x, z, Math.min(1, 0.7 + 0.15 * s));
      shake(game, x, z, Math.min(0.9, 0.42 * s), 0.55);
      glare(game, x, z, 'gold', 0.18 * Math.min(1.5, s));
    },
  },
  // a fireball streaks down from the sky on a slant — across the screen, from high up and aside —
  // with a trail of fire and dark smoke, and explodes where it lands
  fireball: {
    pools: BLAST_POOLS,
    play(game, x, y, z, s, rng) {
      const FALL = 1.05;
      const STEP = 1 / 60;
      // from up and well to one side of the place as the camera sees it, a little behind: a long
      // slant across the screen that stays near the focus band (straight down it would be off the
      // top of most shots until its last moment, from far behind a blur)
      const yaw = Number.isFinite(game.rig?.yaw) ? game.rig.yaw : 0;
      const side = (rng.chance(0.5) ? -1 : 1) * rng.range(9, 13);
      const back = rng.range(2, 5);
      const sx = x + Math.cos(yaw) * side - Math.sin(yaw) * back;
      const sz = z - Math.sin(yaw) * side - Math.cos(yaw) * back;
      const sy = y + 13 + rng.range(0, 3);
      const ty = y + 0.4 * s;
      sound(game, 'fireballFall', x, z, 0.85);
      const n = Math.round(FALL / STEP);
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        // accelerating as it falls
        const e = k * k * (1.6 - 0.6 * k);
        const px = sx + (x - sx) * e;
        const py = sy + (ty - sy) * e;
        const pz = sz + (z - sz) * e;
        later(game, i * STEP, () => {
          // the head: a hot core blooming, flame puffs boiling off it
          emit(game, 'glow', px, py, pz, 1, { life: [0.07, 0.09], size: sc(1.1, 1.2, s), sizeEnd: 0.9, color: '#ffe6a8', hdr: 2.6, spawnSize: [0, 0, 0] });
          emit(game, 'flame', px, py, pz, 2, {
            life: [0.28, 0.5], size: sc(0.45, 0.7, s), sizeEnd: 1.6, burstSpeed: [0.2, 0.8], burstUp: [0.2, 0.9], drag: 2, gravity: 1,
            spawnSize: sc(0.25, 0.25, s).concat(0.25 * s), colors: ['#ffe08a', '#ffaa3c', '#ff7a2a'], hdr: 1.35, spin: [0.5, 2],
          });
          // the trail: dark smoke behind it, sparks shed
          if (i % 2 === 0) {
            emit(game, 'smoke', px, py, pz, 1, {
              life: [1.2, 2.0], size: sc(0.6, 0.85, s), sizeEnd: 3.4, burstSpeed: [0.1, 0.4], burstUp: [0.2, 0.6], drag: 1, gravity: 0.25,
              windInfluence: 0.25, spawnSize: [0.2, 0.2, 0.2], colors: ['#2e2826', '#3d3532'], alpha: 0.78, spin: [0.1, 0.5],
            });
          }
          if (i % 3 === 0) {
            emit(game, 'spark', px, py, pz, 2, {
              life: [0.25, 0.5], size: [0.05, 0.07], sizeEnd: 0.5, burstSpeed: [0.5, 2], burstUp: [-0.5, 1.5], gravity: -6, drag: 1.5,
              spawnSize: [0.2, 0.2, 0.2], colors: ['#ffd27a', '#ff8a2a'], hdr: 2.6,
            });
          }
        });
      }
      later(game, FALL + STEP, () => {
        blast(game, x, y, z, s * 1.15);
        sound(game, 'explosion', x, z, Math.min(1, 0.8 + 0.12 * s));
        shake(game, x, z, Math.min(1, 0.5 * s), 0.6);
        glare(game, x, z, 'gold', 0.22 * Math.min(1.5, s));
      });
    },
  },
  // a blaze that flares up and burns for a few seconds: tongues of flame rising and shrinking, the
  // heat glowing at its foot, embers, smoke above it
  flames: {
    pools: ['glow', 'fire', 'flame', 'ember', 'smoke'],
    play(game, x, y, z, s) {
      const DUR = 2.6;
      const STEP = 0.05;
      const n = Math.round(DUR / STEP);
      sound(game, 'fireRoar', x, z, 0.75);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        // up in 0.3 s, down over the last 0.6
        const env = Math.min(1, (i * STEP) / 0.3, (DUR - i * STEP) / 0.6);
        later(game, i * STEP, () => {
          const w = s * (0.6 + 0.4 * env);
          emit(game, 'flame', x, y + 0.15, z, Math.max(1, 2.6 * env * clamp(s, 0.5, 2.5)), {
            life: [0.45, 0.85], size: sc(0.45, 0.8, w), sizeEnd: 0.3, burstSpeed: [0.05, 0.3], burstUp: sc(1.4, 2.6, Math.sqrt(s)),
            gravity: 1.4, drag: 1.4, spawnSize: sc(1.1, 0.2, s).concat(1.1 * s), colors: ['#ffe08a', '#ffb347', '#ff8a2a', '#f0601c'], hdr: 1.3, spin: [0.5, 1.5],
          });
          if (i % 2 === 0) {
            emit(game, 'fire', x, y + 0.2, z, 1, {
              life: [0.35, 0.6], size: sc(0.6, 0.9, w), sizeEnd: 0.4, burstSpeed: [0.05, 0.2], burstUp: sc(1.0, 1.8, Math.sqrt(s)),
              gravity: 1, drag: 1.4, spawnSize: sc(0.8, 0.2, s).concat(0.8 * s), colors: ['#ffc45a', '#ff8a2a'], hdr: 1.3, spin: [0.5, 1.5],
            });
          }
          if (i % 4 === 0) emit(game, 'glow', x, y + 0.45 * s, z, 1, { life: [0.3, 0.4], size: sc(1.7, 2.0, w), sizeEnd: 1.1, color: '#ffa04a', hdr: 1.3, spawnSize: sc(0.4, 0.2, s).concat(0.4 * s) });
          if (i % 3 === 0) {
            emit(game, 'ember', x, y + 0.4, z, 2, {
              life: [1.0, 2.0], size: [0.06, 0.1], sizeEnd: 0.4, burstSpeed: [0.2, 0.8], burstUp: [1.5, 3], gravity: 0.6, drag: 0.7,
              windInfluence: 0.5, spawnSize: sc(1, 0.4, s).concat(1 * s), colors: ['#ff8a2a', '#ffc070'], hdr: 2.2,
            });
          }
          if (i % 5 === 0 && k > 0.1) {
            emit(game, 'smoke', x, y + 1.3 * s, z, 1, {
              life: [2.2, 3.4], size: sc(0.6, 0.9, s), sizeEnd: 3.4, burstSpeed: [0.1, 0.3], burstUp: [0.8, 1.3], drag: 0.6, gravity: 0.2,
              windInfluence: 0.3, spawnSize: sc(0.6, 0.2, s).concat(0.6 * s), colors: ['#2e2826', '#3d3532', '#4a423e'], alpha: 0.7, spin: [0.1, 0.4],
            });
          }
        });
      }
    },
  },
  // a billowing column of smoke: a dark puff at its foot, then rolls of smoke climbing and spreading
  smoke: {
    pools: ['dust', 'smoke'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.5, 2.5);
      sound(game, 'breath', x, z, 0.35, 0.7);
      emit(game, 'dust', x, y + 0.2, z, 10 * c, {
        life: [0.9, 1.4], size: sc(0.7, 1.0, s), sizeEnd: 2.8, burstSpeed: sc(1, 2.4, s), burstUp: [0.2, 0.7], drag: 2.4,
        colors: ['#6a6460', '#57514d', '#7a7470'], alpha: 0.7, spin: [0.5, 2],
      });
      for (let i = 0; i < 26; i++) {
        const k = i / 26;
        later(game, i * 0.11, () => emit(game, 'smoke', x, y + 0.4 * s, z, 3 * c, {
          life: [3.2, 5.2], size: sc(0.8, 1.2, s), sizeEnd: 4.4, burstSpeed: sc(0.2, 0.7, s), burstUp: [0.9, 1.7], drag: 0.45, gravity: 0.18,
          windInfluence: 0.3, spawnSize: sc(1.0, 0.3, s).concat(1.0 * s),
          // dark at the start, greyer as the fire under it dies down
          colors: k < 0.5 ? ['#3a3432', '#47413e', '#2e2a28'] : ['#5a5552', '#6b6662', '#47423f'], alpha: 0.72, spin: [0.1, 0.4],
        }));
      }
    },
  },
  // a pillar of holy light: a beam of gold falling on the place, rays climbing it, a ring of light
  // on the ground, motes rising and glitter drifting down
  holy: {
    pools: ['glow', 'star', 'spark'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'holyPillar', x, z, 0.85);
      // the beam: soft halos stacked close (they melt into one shaft), coming down from the top
      for (let i = 0; i < 24; i++) {
        const h = 23 - i;
        later(game, i * 0.01, () => emit(game, 'glow', x, y + (0.3 + h * 0.34) * s, z, 1, {
          life: [0.9, 1.1], size: sc(0.95, 1.1, s), sizeEnd: 0.25, color: h < 3 ? '#fff6e0' : '#ffe6a0', hdr: 1.05, spawnSize: [0.04, 0.06, 0.04],
        }));
      }
      // where it lands: a warm bloom, a ring of light running out
      later(game, 0.22, () => {
        emit(game, 'glow', x, y + 0.5 * s, z, 1, { life: [0.4, 0.5], size: sc(2.6, 2.6, s), sizeEnd: 1.4, color: '#fff0c0', hdr: 1.6, spawnSize: [0, 0, 0] });
        ring(game, 'glow', x, y + 0.15, z, 3.2 * s, 0.6, 28, { size: sc(0.32, 0.42, s), sizeEnd: 0.5, color: '#ffd77a', hdr: 1.9, drag: 1 });
        ring(game, 'star', x, y + 0.3, z, 2.4 * s, 0.8, 14, { size: sc(0.22, 0.3, Math.sqrt(s)), sizeEnd: 0.6, colors: ['#fff6d0', '#ffe08a'], hdr: 2.2, drag: 1.5, spin: [0.5, 2] });
      });
      // rays climbing the beam (thin streaks), motes rising round it
      for (let w = 0; w < 4; w++) {
        later(game, 0.1 + w * 0.18, () => emit(game, 'spark', x, y + 0.4, z, 6 * c, {
          life: [0.5, 0.9], size: [0.05, 0.07], sizeEnd: 0.6, velocity: [0, 7, 0], velocityVariance: [0.15, 1.5, 0.15], burstSpeed: [0, 0.2],
          spawnSize: sc(1.1, 0.3, s).concat(1.1 * s), colors: ['#fff6e0', '#ffe08a'], hdr: 2,
        }));
      }
      emit(game, 'star', x, y + 0.3, z, 18 * c, {
        life: [0.9, 1.7], size: sc(0.24, 0.38, Math.sqrt(s)), sizeEnd: 0.8, burstSpeed: [0.3, 1.0], burstUp: [1.4, 3.2], gravity: 0.2, drag: 1.2,
        spawnSize: sc(1.4, 0.4, s).concat(1.4 * s), colors: ['#fff6d0', '#ffe08a', '#e6f2ff'], hdr: 2.2, spin: [0.5, 2],
      });
      later(game, 0.35, () => emit(game, 'star', x, y + 5 * s, z, 14 * c, {
        life: [1.2, 2.0], size: sc(0.18, 0.3, Math.sqrt(s)), sizeEnd: 0.6, velocity: [0, -1.4, 0], burstSpeed: [0.1, 0.5], burstUp: [0, 0], drag: 0.4,
        spawnSize: sc(2.4, 1.5, s).concat(2.4 * s), colors: ['#fff6e0', '#ffe9a8'], hdr: 2, spin: [0.5, 2],
      }));
      glare(game, x, z, 'gold', 0.12 * Math.min(1.5, s));
    },
  },
  // a burst of frost: ice crystals flung out, frost chips, a cold blue mist rolling along the
  // ground, a ring of frost, glints, snow settling after
  frost: {
    pools: ['ice', 'chips', 'smoke', 'star', 'glow', 'snow'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      const cy = y + 0.5 * s;
      sound(game, 'freeze', x, z, 0.85);
      sound(game, 'iceSpike', x, z, 0.55, 1.1);
      emit(game, 'smoke', x, y + 0.25, z, 12 * c, {
        life: [1.4, 2.4], size: sc(0.8, 1.2, s), sizeEnd: 2.8, burstSpeed: sc(1.2, 2.8, s), burstUp: [0.1, 0.4], drag: 2.4, gravity: 0.02,
        spawnSize: sc(0.6, 0.2, s).concat(0.6 * s), colors: ['#bfe0f6', '#a8d0ee', '#d6ecfa'], alpha: 0.45, spin: [0.1, 0.5],
      });
      emit(game, 'chips', x, cy, z, 14 * c, {
        life: [0.6, 1.2], size: sc(0.08, 0.15, s), sizeEnd: 0.9, burstSpeed: sc(2, 4.5, s), burstUp: sc(3, 6, Math.sqrt(s)), gravity: -14, drag: 0.3,
        spawnSize: sc(0.4, 0.3, s).concat(0.4 * s), colors: ['#e6fbff', '#b0d6ff', '#8fc4ee'], hdr: 1.2, ballistic: true, spin: [2, 8],
      });
      emit(game, 'ice', x, cy, z, 20 * c, {
        life: [0.6, 1.2], size: sc(0.22, 0.36, s), sizeEnd: 0.6, burstSpeed: sc(1.8, 4.2, Math.sqrt(s)), burstUp: [0.8, 3], gravity: -5, drag: 2,
        spawnSize: [0.3, 0.3, 0.3], colors: ['#e6fbff', '#b0d6ff', '#8fd0ff'], hdr: 1.8, spin: [2, 6],
      });
      ring(game, 'glow', x, y + 0.12, z, 3 * s, 0.55, 24, { size: sc(0.32, 0.42, s), sizeEnd: 0.6, color: '#8fd0ff', hdr: 1.9, drag: 1.2 });
      emit(game, 'glow', x, cy, z, 1, { life: [0.16, 0.2], size: sc(2.2, 2.2, s), sizeEnd: 1.5, color: '#d6f0ff', hdr: 1.8, spawnSize: [0, 0, 0] });
      emit(game, 'star', x, cy, z, 12 * c, {
        life: [0.7, 1.3], size: sc(0.22, 0.36, Math.sqrt(s)), sizeEnd: 0.8, burstSpeed: [0.5, 1.6], burstUp: [0.3, 1.2], drag: 1.6,
        spawnSize: sc(1.4, 0.8, s).concat(1.4 * s), colors: ['#e6fbff', '#9fdcff'], hdr: 2.4, spin: [0.5, 2],
      });
      later(game, 0.3, () => emit(game, 'snow', x, y + 3 * s, z, 16 * c, {
        life: [1.6, 2.6], size: sc(0.08, 0.13, Math.sqrt(s)), velocity: [0, -0.9, 0], velocityVariance: [0.2, 0.25, 0.2], burstSpeed: [0, 0.2],
        drag: 0.2, windInfluence: 0.4, spawnSize: sc(3, 1, s).concat(3 * s), color: '#ffffff', alpha: 0.95, spin: [0.5, 1],
      }));
    },
  },
  // a shockwave along the ground: a ring of dust, a ring of light, grit thrown up
  shockwave: {
    pools: ['dust', 'glow', 'chips'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'quake', x, z, 0.9);
      shake(game, x, z, Math.min(1, 0.55 * s), 0.7);
      ring(game, 'dust', x, y + 0.2, z, 5.4 * s, 1.0, 30 * c, { size: sc(0.6, 0.9, s), sizeEnd: 3, drag: 1.4, colors: ['#c8b08a', '#b39a76', '#d6c09a'], alpha: 0.75, spin: [0.5, 2] });
      ring(game, 'glow', x, y + 0.25, z, 5.8 * s, 0.45, 28, { size: sc(0.45, 0.6, s), sizeEnd: 0.7, color: '#fff0c8', hdr: 1.6 });
      emit(game, 'glow', x, y + 0.3, z, 1, { life: [0.16, 0.18], size: sc(2.6, 2.6, s), sizeEnd: 1.6, color: '#fff3d6', hdr: 1.8, spawnSize: [0, 0, 0] });
      debris(game, x, y, z, s, 12 * c);
    },
  },
  // a cloud of dust rising (a landing, a fall, a collapse): a ring of it along the ground, a cloud
  // climbing, grit
  dust: {
    pools: ['dust', 'smoke', 'chips'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'quake', x, z, 0.4, 1.2);
      ring(game, 'dust', x, y + 0.2, z, 3.2 * s, 1.1, 18 * c, { size: sc(0.6, 0.9, s), sizeEnd: 3, drag: 2, colors: ['#cdb48c', '#b89e78', '#d8c4a0'], alpha: 0.72, spin: [0.5, 2] });
      emit(game, 'dust', x, y + 0.3, z, 16 * c, {
        life: [1.0, 1.8], size: sc(0.7, 1.1, s), sizeEnd: 3.2, burstSpeed: sc(0.8, 2.4, s), burstUp: [0.4, 1.4], drag: 2.6,
        spawnSize: sc(1.0, 0.4, s).concat(1.0 * s), colors: ['#cdb48c', '#b89e78', '#a08a6a'], alpha: 0.75, spin: [0.5, 2],
      });
      later(game, 0.14, () => emit(game, 'smoke', x, y + 0.6 * s, z, 10 * c, {
        life: [2.0, 3.0], size: sc(0.9, 1.3, s), sizeEnd: 3.4, burstSpeed: sc(0.4, 1.2, s), burstUp: [0.5, 1.1], drag: 1, gravity: 0.14,
        windInfluence: 0.3, spawnSize: sc(1.4, 0.4, s).concat(1.4 * s), colors: ['#c2ad8a', '#a8936f', '#b8a382'], alpha: 0.55, spin: [0.1, 0.4],
      }));
      debris(game, x, y, z, s * 0.8, 8 * c, ['#6e5c48', '#8a7660', '#5a4a3a']);
    },
  },
  // magical glitter
  sparkle: {
    pools: ['star', 'glow'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'chime', x, z, 0.55, 1.2);
      emit(game, 'star', x, y + 0.9 * s, z, 22 * c, {
        life: [0.7, 1.5], size: sc(0.26, 0.42, Math.sqrt(s)), sizeEnd: 0.8, burstSpeed: [0.2, 0.9], burstUp: [0.3, 1.2], gravity: 0.15, drag: 1.6,
        spawnSize: sc(1.6, 1.4, s).concat(1.6 * s), colors: ['#fff6d0', '#ffe08a', '#bfe0ff', '#ffd0f0'], hdr: 3, spin: [0.5, 2],
      });
      emit(game, 'glow', x, y + 0.9 * s, z, 3, { life: [0.5, 0.8], size: sc(1.2, 1.8, s), sizeEnd: 0.6, color: '#fff3d0', hdr: 1.4, spawnSize: sc(1, 0.8, s).concat(1 * s) });
    },
  },
  // fireworks: rockets climb one after another and burst into spheres of colour with glitter after
  fireworks: {
    pools: ['spark', 'glow', 'star'],
    play(game, x, y, z, s, rng) {
      const rockets = clamp(Math.round(3 * s), 1, 8);
      const first = rng.int(0, FIREWORKS.length - 1);
      for (let r = 0; r < rockets; r++) {
        const delay = r * 0.42 + rng.range(0, 0.12);
        const rise = 1.0 + rng.range(0, 0.35);
        const top = y + (9 + rng.range(0, 3.5)) * Math.sqrt(s);
        const ox = x + rng.range(-1.6, 1.6) * Math.sqrt(s);
        const oz = z + rng.range(-1.6, 1.6) * Math.sqrt(s);
        const drift = rng.range(-1.2, 1.2);
        const pal = FIREWORKS[(first + r) % FIREWORKS.length];
        const STEP = 1 / 30;
        const n = Math.round(rise / STEP);
        later(game, delay, () => sound(game, 'whirl', ox, oz, 0.3, 1.6));
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          // decelerating as it climbs
          const e = 1 - (1 - k) * (1 - k);
          const px = ox + drift * k;
          const py = y + 0.3 + (top - y - 0.3) * e;
          later(game, delay + i * STEP, () => {
            emit(game, 'spark', px, py, oz, 1, { life: [0.3, 0.45], size: [0.05, 0.07], sizeEnd: 0.4, velocity: [0, -1.5, 0], burstSpeed: [0.1, 0.4], burstUp: [0, 0], gravity: -3, drag: 1, spawnSize: [0.05, 0.05, 0.05], color: pal[0], hdr: 2.4 });
            emit(game, 'glow', px, py, oz, 1, { life: [0.06, 0.08], size: [0.45, 0.5], sizeEnd: 0.8, color: pal[0], hdr: 3, spawnSize: [0, 0, 0] });
          });
        }
        later(game, delay + rise + STEP, () => {
          const bx = ox + drift;
          // the burst: a sphere of streaks and stars, a flash in its colour, glitter crackling after
          emit(game, 'glow', bx, top, oz, 2, { life: [0.18, 0.26], size: sc(2.8, 3.4, s), sizeEnd: 1.5, color: pal[0], hdr: 3.6, spawnSize: [0, 0, 0] });
          emit(game, 'spark', bx, top, oz, 34 * clamp(s, 0.5, 2), {
            life: [0.9, 1.5], size: [0.06, 0.09], sizeEnd: 0.5, burstSpeed: sc(4.4, 5.6, Math.sqrt(s)), burstUp: sc(-4.6, 4.6, Math.sqrt(s)),
            gravity: -2.2, drag: 1.5, spawnSize: [0.2, 0.2, 0.2], colors: pal, hdr: 3.4,
          });
          emit(game, 'star', bx, top, oz, 18 * clamp(s, 0.5, 2), {
            life: [1.0, 1.7], size: sc(0.26, 0.4, Math.sqrt(s)), sizeEnd: 0.6, burstSpeed: sc(3.4, 4.6, Math.sqrt(s)), burstUp: sc(-3.5, 3.5, Math.sqrt(s)),
            gravity: -1.6, drag: 1.7, spawnSize: [0.2, 0.2, 0.2], colors: pal, hdr: 3, spin: [0.5, 2],
          });
          later(game, 0.55, () => emit(game, 'star', bx, top - 1.2, oz, 14 * clamp(s, 0.5, 2), {
            life: [0.4, 0.8], size: [0.14, 0.24], sizeEnd: 0.5, burstSpeed: [0.4, 1.2], burstUp: [-0.8, 0.4], gravity: -1.2, drag: 1.2,
            spawnSize: sc(4.5, 3.5, Math.sqrt(s)).concat(4.5 * Math.sqrt(s)), colors: ['#fff6e0', pal[1]], hdr: 2.6, spin: [1, 3],
          }));
          sound(game, 'firework', bx, oz, 0.85, 0.9 + 0.08 * r);
        });
      }
    },
  },
  // a swirl of embers rising
  embers: {
    pools: ['ember', 'spark'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'fireRoar', x, z, 0.3, 1.25);
      for (let w = 0; w < 3; w++) {
        later(game, w * 0.4, () => {
          emit(game, 'ember', x, y + 0.4, z, 12 * c, {
            life: [1.5, 3], size: [0.06, 0.11], sizeEnd: 0.4, burstSpeed: [0.3, 1.1], burstUp: [1, 2.6], gravity: 0.6, drag: 0.6,
            windInfluence: 0.6, spawnSize: sc(2, 0.5, s).concat(2 * s), colors: ['#ff8a2a', '#ffb04a', '#ff5a1a', '#ffd27a'], hdr: 2.6,
          });
          emit(game, 'spark', x, y + 0.4, z, 4 * c, {
            life: [0.6, 1.1], size: [0.04, 0.06], sizeEnd: 0.4, burstSpeed: [0.3, 1], burstUp: [1.5, 3], gravity: 0.4, drag: 0.8,
            spawnSize: sc(1.6, 0.4, s).concat(1.6 * s), colors: ['#ffd27a', '#ff8a2a'], hdr: 2.6,
          });
        });
      }
    },
  },
  // a roar: a shockwave of dust and a heavy shake (a dragon's, a beast's)
  roar: {
    pools: ['dust', 'glow', 'chips'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'roar', x, z, 1);
      later(game, 0.18, () => sound(game, 'quake', x, z, 0.5, 0.8));
      game.rig?.shake?.(Math.min(1.1, 0.7 * s), 1.3);
      for (let w = 0; w < 2; w++) {
        later(game, w * 0.28, () => {
          ring(game, 'dust', x, y + 0.25, z, (6.5 + w * 2) * s, 1.1, 30 * c, { size: sc(0.7, 1.05, s), sizeEnd: 3, drag: 0.6, colors: ['#c8b08a', '#a8926f', '#d6c09a'], alpha: 0.62, spin: [0.5, 2] });
          ring(game, 'glow', x, y + 0.6, z, (7 + w * 2) * s, 0.5, 24, { size: sc(0.6, 0.8, s), sizeEnd: 1.2, color: '#f4e3b3', hdr: 1.1, alpha: 0.7 });
        });
      }
      debris(game, x, y, z, s * 0.7, 8 * c, ['#6e5c48', '#8a7660', '#5a4a3a']);
    },
  },

  // ---- The Bells of Evermere (EVERMERE_CAMPAIGN.md §5.6; the thaw package's — the sounds are
  // the composer's names). Snow is white: nothing here is additive white — the toll's ring is cut-out
  // gold with a dark amber core, the glints stay ≤ 1.4 HDR (they bloom, they never streak)
  // a bell's toll at its mouth (y high above the ground; silent: the `toll` command plays the
  // bell): a ring of gold pixels running out with the strike, a dark amber core just inside it, a
  // second, wider ring as the hum swells, gold motes settling
  toll: {
    pools: ['bit'],
    play(game, x, y, z, s) {
      const q = Math.sqrt(s);
      ring(game, 'bit', x, y, z, 4.6 * s, 0.75, 34, { size: sc(0.13, 0.18, q), sizeEnd: 0.7, colors: ['#ffd877', '#f0c050', '#e8b04a'], hdr: 1.1, drag: 1.2 });
      ring(game, 'bit', x, y - 0.12, z, 3.1 * s, 0.7, 24, { size: sc(0.14, 0.2, q), sizeEnd: 0.6, colors: ['#8a5418', '#6e3a10', '#5c300c'], hdr: 1, drag: 1.4 });
      emit(game, 'bit', x, y - 0.3, z, 10, {
        life: [1.0, 1.6], size: [0.08, 0.12], sizeEnd: 0.6, burstSpeed: sc(0.3, 1.0, q), burstUp: [-0.2, 0.3], gravity: -0.8, drag: 1.2,
        spawnSize: sc(1.2, 0.4, s).concat(1.2 * s), colors: ['#ffd877', '#e8b04a', '#c88a30'], hdr: 1.05,
      });
      later(game, 0.32, () => ring(game, 'bit', x, y, z, 6.6 * s, 0.95, 30, { size: sc(0.1, 0.14, q), sizeEnd: 0.5, colors: ['#f0c050', '#c88a30', '#8a5418'], hdr: 1, drag: 0.8 }));
    },
  },
  // the thaw where it is played (a frost foe shattering, a spot thawing at once): steam puffs, glints
  // (≤ 1.4 HDR), clumps of snow falling, cut-out shards of ice thrown
  thaw: {
    pools: ['smoke', 'star', 'snow', 'bit'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'thawSweep', x, z, 0.8);
      emit(game, 'smoke', x, y + 0.3, z, 14 * c, {
        life: [1.6, 2.6], size: sc(0.7, 1.1, s), sizeEnd: 2.6, burstSpeed: sc(0.6, 1.8, s), burstUp: [0.4, 1.2], drag: 1.6, gravity: 0.12,
        spawnSize: sc(2.4, 0.3, s).concat(2.4 * s), color: '#eef4f8', alpha: 0.16, spin: [0.1, 0.4],
      });
      emit(game, 'star', x, y + 0.5, z, 12 * c, { life: [0.5, 1.0], size: [0.16, 0.26], sizeEnd: 0.6, burstSpeed: [0.2, 0.8], burstUp: [0.2, 0.8], drag: 1.4, spawnSize: sc(3, 0.6, s).concat(3 * s), colors: ['#e6fbff', '#fff6e0'], hdr: 1.35 });
      emit(game, 'snow', x, y + 2.5 * s, z, 10 * c, { life: [0.8, 1.4], size: [0.14, 0.22], velocity: [0, -2.4, 0], velocityVariance: [0.2, 0.5, 0.2], gravity: -2, spawnSize: sc(2.5, 0.8, s).concat(2.5 * s), color: '#f4f8fc', alpha: 0.95, spin: [0.5, 1] });
      emit(game, 'bit', x, y + 0.8, z, 12 * c, {
        life: [0.5, 1.0], size: [0.1, 0.17], sizeEnd: 0.8, burstSpeed: sc(1.4, 3.4, Math.sqrt(s)), burstUp: [2, 4.2], gravity: -12, drag: 0.3,
        spawnSize: sc(0.8, 1.0, s).concat(0.8 * s), colors: ['#cfe8f0', '#8cc0d6', '#4a88a8', '#eef4f8'], hdr: 1, ballistic: true, spin: [2, 8],
      });
    },
  },
  // petals released on the wind (tumbling cut-out petals; ≈ 70 % white and cream, the pinks on the
  // lilac side: the grade's turn lands them on sakura, not salmon)
  petals: {
    pools: ['petal'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'windGust', x, z, 0.35, 1.2);
      emit(game, 'petal', x, y + 2.2 * s, z, 34 * c, {
        life: [2.6, 4.0], size: [0.24, 0.32], velocity: [0.7, -0.35, 0.2], velocityVariance: [0.5, 0.25, 0.5], burstSpeed: [0.4, 1.6], burstUp: [0.5, 1.6],
        gravity: -0.4, drag: 0.8, windInfluence: 1, spin: [1, 3.5], spawnSize: sc(3.2, 1.4, s).concat(3.2 * s),
        colors: ['#fff6f2', '#fff6f2', '#fffaf0', '#fbe2ea', '#fff6f2', '#fbe2ea', '#fffaf0', '#f2bcd6', '#f2bcd6', '#d98ab4'], alpha: 1,
      });
    },
  },
  // leaves torn off by the wind (tumbling cut-out leaves in the autumn canopy's colours)
  leaves: {
    pools: ['leaf'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'windGust', x, z, 0.4);
      emit(game, 'leaf', x, y + 2.4 * s, z, 28 * c, {
        life: [2.4, 3.6], size: [0.32, 0.42], velocity: [0.9, -0.5, 0.3], velocityVariance: [0.6, 0.3, 0.6], burstSpeed: [0.4, 1.6], burstUp: [0.4, 1.4],
        gravity: -0.5, drag: 0.8, windInfluence: 1, spin: [1, 4], spawnSize: sc(3.2, 1.4, s).concat(3.2 * s),
        colors: ['#f6c860', '#ec9234', '#ec9234', '#c8502a', '#8a2a22', '#f6c860'], alpha: 1,
      });
    },
  },
  // a memory: a soft white veil (unlit puffs drifting up slowly) and white motes in it
  memory: {
    pools: ['flame', 'star'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'memoryChime', x, z, 0.6);
      emit(game, 'flame', x, y + 1.0 * s, z, 10 * c, {
        life: [2.4, 3.6], size: sc(1.2, 1.8, s), sizeEnd: 2.4, burstSpeed: [0.05, 0.3], burstUp: [0.1, 0.35], gravity: 0.02, drag: 0.6,
        spawnSize: sc(3.6, 1.6, s).concat(3.6 * s), color: '#f6f2ec', alpha: 0.22, spin: [0.05, 0.2],
      });
      emit(game, 'star', x, y + 1.2 * s, z, 22 * c, {
        life: [1.8, 3.0], size: [0.1, 0.18], sizeEnd: 0.6, burstSpeed: [0.05, 0.25], burstUp: [0.15, 0.45], drag: 0.6,
        spawnSize: sc(4, 2, s).concat(4 * s), colors: ['#ffffff', '#f6f0e4', '#e8f0ff'], hdr: 1.15,
      });
    },
  },
  // a burst of crows taking flight: dark wings flapping up and away north (the King's eyes fly
  // north), in two lifts, a few feathers drifting down after
  crows: {
    pools: ['leaf', 'bit'],
    play(game, x, y, z, s) {
      const c = clamp(s, 0.4, 3);
      sound(game, 'crowFlock', x, z, 0.8);
      for (let w = 0; w < 2; w++) {
        later(game, w * 0.18, () => emit(game, 'leaf', x, y + 0.6, z, 9 * c, {
          life: [2.4, 3.4], size: [0.36, 0.5], velocity: [0.3, 1.4, -2.2], velocityVariance: [1.0, 0.5, 0.8], burstSpeed: [1.0, 2.6], burstUp: [1.6, 3.2],
          gravity: 0.6, drag: 0.35, windInfluence: 0.2, spin: [5, 9], spawnSize: sc(1.4, 0.4, s).concat(1.4 * s), colors: ['#1a1620', '#24202c', '#2e2834'], alpha: 1,
        }));
      }
      later(game, 0.35, () => emit(game, 'bit', x, y + 2.2, z, 6 * c, {
        life: [1.6, 2.4], size: [0.07, 0.1], sizeEnd: 0.8, burstSpeed: [0.3, 1.0], burstUp: [0, 0.4], gravity: -0.7, drag: 1.4, windInfluence: 0.6,
        spawnSize: sc(2, 1, s).concat(2 * s), colors: ['#1a1620', '#2e2834'], hdr: 1, spin: [1, 3],
      }));
    },
  },
};

/**
 * The registry: one entry per `EFFECT_NAMES` name.
 * @type {Readonly<Record<typeof EFFECT_NAMES[number], StoryEffect>>}
 */
export const EFFECTS = Object.freeze(/** @type {Record<typeof EFFECT_NAMES[number], StoryEffect>} */ (
  Object.fromEntries(EFFECT_NAMES.map((name) => {
    const r = /** @type {(typeof RECIPES)[string]} */ (ownValue(RECIPES, name));
    if (!r) throw new Error(`Effects: no recipe for the effect "${name}"`);
    const pools = Object.freeze([...r.pools]);
    return [name, Object.freeze({
      /** @type {StoryEffect['play']} */
      play: (game, x, y, z, scale) => {
        const s = scheduleOf(game);
        const rng = new RNG(hashString(`${name}:${Math.round(x * 16)}:${Math.round(z * 16)}:${s.plays++}`));
        r.play(game, x, y, z, scale, rng);
      },
      presets: Object.freeze([...new Set(pools.map((p) => POOLS[p].preset))]),
      pools,
    })];
  }))
));

/**
 * Play a named effect at a world point (the story's `effect`). An unknown name (data is untrusted:
 * the parser accepts only `EFFECT_NAMES`, a hand-made call may not) does nothing.
 * @param {Game} game
 * @param {string} name an `EFFECT_NAMES` name
 * @param {number} x
 * @param {number} y the ground height there
 * @param {number} z
 * @param {number} [scale] 0.1–5 (1)
 * @returns {boolean} whether the name is an effect
 */
export function play(game, name, x, y, z, scale = 1) {
  const fx = /** @type {StoryEffect|undefined} */ (ownValue(EFFECTS, name));
  if (!fx || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  fx.play(game, x, y, z, Math.min(5, Math.max(0.1, Number.isFinite(scale) ? scale : 1)));
  return true;
}

/**
 * The particle presets of the given effects (their pools' base presets), each once, in order.
 * Unknown names are skipped.
 * @param {Iterable<string>} names
 * @returns {string[]}
 */
export function presetsFor(names) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const n of names) {
    const fx = /** @type {StoryEffect|undefined} */ (ownValue(EFFECTS, n));
    for (const p of fx?.presets ?? []) out.add(p);
  }
  return [...out];
}

/**
 * The burst pools of the given effects, each once, in order. Unknown names are skipped.
 * @param {Iterable<string>} names
 * @returns {PoolName[]}
 */
export function poolsFor(names) {
  /** @type {Set<PoolName>} */
  const out = new Set();
  for (const n of names) {
    const fx = /** @type {StoryEffect|undefined} */ (ownValue(EFFECTS, n));
    for (const p of fx?.pools ?? []) out.add(p);
  }
  return [...out];
}

/**
 * Prime the given effects: one particle of each burst pool they use, far below the world, so the
 * pools — and their programs — exist before the game's warm-up compiles the scene (the story runtime
 * calls it when a level is attached). Cheap when the pools exist already.
 * @param {Game} game
 * @param {Iterable<string>} names `EFFECT_NAMES` names (others skipped)
 * @returns {PoolName[]} the pools primed
 */
export function prime(game, names) {
  const want = new Set(poolsFor(names));
  // (in `POOL_ORDER`: a pool's mesh draws after the ones made before it at the same render order —
  // the flames over the smoke they rise through)
  const pools = POOL_ORDER.filter((p) => want.has(p));
  if (!game.particles) return pools;
  for (const p of pools) emit(game, p, FAR_BELOW.x, FAR_BELOW.y, FAR_BELOW.z, 1, { life: [0.05, 0.05], size: [0.1, 0.1] });
  return pools;
}
