import { clamp } from '../../engine/utils/math.js';

/**
 * The thaw front's one-shots (docs/contracts/EVERMERE_CAMPAIGN.md §6.1 "Front life"): what happens
 * where it passes — a tree shakes off its snow (and, by the season, its petals or leaves), a roof's
 * snow slides off the eaves, a frozen fall breaks in a burst of mist, a frost foe shatters. Bursts
 * into the pools the thaw kit primed at load (`primeThawPools`: no program at play); the runtime
 * keeps them to a budget near the camera (src/game/thaw/LevelStates.js).
 *
 * @import { Game } from '../Game.js'
 */

/**
 * The pool-key fields of the cut-out bits (unlit pixel squares, alpha-tested, dithered fades): the
 * frost foes' shatter, the toll's ring (Effects.js `bit`) — primed by the thaw kit.
 */
export const CUTOUT_BITS = Object.freeze({ blending: 'cutout', lit: 0 });

const _p = { x: 0, y: 0, z: 0 };
/** @param {number} x @param {number} y @param {number} z */
const at = (x, y, z) => ((_p.x = x), (_p.y = y), (_p.z = z), _p);

/** Petals by the pink rule (≈ 70 % white and cream, the pinks on the lilac side). */
const PETALS = Object.freeze(['#fff6f2', '#fff6f2', '#fffaf0', '#fbe2ea', '#fff6f2', '#fbe2ea', '#fffaf0', '#f2bcd6', '#f2bcd6', '#d98ab4']);
/** Autumn leaves. */
const LEAVES = Object.freeze(['#f6c860', '#ec9234', '#ec9234', '#c8502a', '#8a2a22', '#f6c860']);

/** The broadleaf kinds that drop leaves in autumn (the conifers, palms and dead wood keep theirs). */
const DECIDUOUS = new Set(['oak', 'autumn', 'birch', 'maple', 'goldbirch', 'blossom']);

/**
 * What a tree of `kind` lets go when it thaws in `season`: petals (a blossom in spring), leaves (a
 * broadleaf in autumn), or nothing but its snow.
 * @param {string} kind @param {'spring'|'summer'|'autumn'|'winter'|null} season
 * @returns {'spring'|'autumn'|null}
 */
export function treeRelease(kind, season) {
  if (season === 'spring' && kind === 'blossom') return 'spring';
  if (season === 'autumn' && DECIDUOUS.has(kind)) return 'autumn';
  return null;
}

/**
 * A tree the front passed: its snow falls off the crown (clumps and a puff of powder) and — a
 * blossom in spring, a broadleaf in autumn (`treeRelease`) — its petals or leaves go up on the wind.
 * @param {Game} game
 * @param {number} x @param {number} z
 * @param {number} height the tree's height (u)
 * @param {'spring'|'autumn'|null} season what it releases (`treeRelease`)
 */
export function treeBurst(game, x, z, height, season) {
  const ps = game.particles;
  if (!ps) return;
  const y = (game.world?.groundAt(x, z) ?? 0) + Math.max(1.6, height * 0.72);
  const s = clamp(height / 4.5, 0.6, 1.6);
  ps.burst('snow', at(x, y, z), Math.round(10 * s), {
    life: [0.7, 1.3], size: [0.14, 0.24], velocity: [0, -2.2, 0], velocityVariance: [0.3, 0.7, 0.3], burstSpeed: [0.2, 0.9], burstUp: [0, 0.6],
    gravity: -4, drag: 0.2, windInfluence: 0.2, spawnSize: [1.6 * s, 0.8 * s, 1.6 * s], color: '#f4f8fc', alpha: 0.95, spin: [0.5, 1],
  });
  ps.burst('smoke', at(x, y - 0.4, z), 3, {
    life: [1.0, 1.6], size: [0.6, 0.9], sizeEnd: 2.6, velocity: [0, 0, 0], velocityVariance: [0.1, 0.05, 0.1], burstSpeed: [0.3, 0.8], burstUp: [-0.2, 0.2],
    gravity: -0.05, drag: 1.4, windInfluence: 0.3, spawnSize: [1.4 * s, 0.6, 1.4 * s], color: '#eef4f8', alpha: 0.22, spin: [0.1, 0.4],
  });
  const leaves = season === 'spring' ? PETALS : season === 'autumn' ? LEAVES : null;
  if (leaves) {
    ps.burst(season === 'spring' ? 'petals' : 'leaves', at(x, y + 0.3, z), Math.round(12 * s), {
      life: [2.4, 3.6], size: season === 'spring' ? [0.24, 0.32] : [0.32, 0.42], velocity: [0.5, -0.35, 0.15], velocityVariance: [0.4, 0.2, 0.4],
      burstSpeed: [0.4, 1.4], burstUp: [0.6, 1.8], gravity: -0.45, drag: 0.9, windInfluence: 0.9, spawnSize: [1.8 * s, 1.0 * s, 1.8 * s],
      colors: leaves, alpha: 1, spin: [1, 3.5],
    });
  }
}

/**
 * A roof the front passed: the snow on its eaves slides off — clumps over the eave line and a
 * puff of powder where they land.
 * @param {Game} game
 * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1  the eave line (world)
 * @param {number} y the eave's height
 */
export function roofSlide(game, x0, z0, x1, z1, y) {
  const ps = game.particles;
  if (!ps) return;
  const n = clamp(Math.round(Math.hypot(x1 - x0, z1 - z0) * 2.4), 4, 16);
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    ps.burst('snow', at(x0 + (x1 - x0) * k, y, z0 + (z1 - z0) * k), 2, {
      life: [0.5, 0.8], size: [0.16, 0.26], velocity: [0, -1, 0.9], velocityVariance: [0.2, 0.4, 0.3], burstSpeed: [0, 0.3], burstUp: [0, 0.4],
      gravity: -9, drag: 0.1, windInfluence: 0, spawnSize: [0.5, 0.1, 0.2], color: '#f4f8fc', alpha: 0.95, spin: [0.5, 1],
    });
  }
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2 + 0.8;
  ps.burst('smoke', at(mx, (game.world?.groundAt(mx, mz) ?? 0) + 0.2, mz), 3, {
    life: [0.8, 1.4], size: [0.5, 0.8], sizeEnd: 2.4, velocity: [0, 0, 0], velocityVariance: [0.1, 0.05, 0.1], burstSpeed: [0.4, 1.0], burstUp: [0.1, 0.4],
    gravity: -0.05, drag: 1.6, windInfluence: 0.2, spawnSize: [Math.abs(x1 - x0) * 0.8 + 0.4, 0.2, 0.6], color: '#eef4f8', alpha: 0.24, spin: [0.1, 0.4],
  });
}

/**
 * A frozen fall breaking: a burst of mist rolling out of its foot, ice chips thrown, glints.
 * @param {Game} game
 * @param {{ x: number, z: number, width: number, dir: number[], anchor: { x: number, y: number, z: number } }} f World.falls entry
 * @param {boolean} near close to the camera: its sound
 */
export function fallsBreak(game, f, near) {
  const ps = game.particles;
  if (!ps) return;
  const a = f.anchor;
  const w = Math.max(1, f.width);
  ps.burst('smoke', at(a.x + f.dir[0] * 0.4, a.y + 0.3, a.z + f.dir[1] * 0.4), Math.round(10 + w * 3), {
    life: [1.6, 2.6], size: [0.8, 1.2], sizeEnd: 3.2, velocity: [f.dir[0] * 1.2, 0.5, f.dir[1] * 1.2], velocityVariance: [0.5, 0.3, 0.5],
    burstSpeed: [0.6, 1.8], burstUp: [0.4, 1.2], gravity: 0.05, drag: 1.2, windInfluence: 0.2, spawnSize: [w, 0.4, w],
    color: '#eef8ff', alpha: 0.36, spin: [0.1, 0.5],
  });
  ps.burst('splash', at(a.x, a.y + 0.4, a.z), 14, {
    life: [0.5, 0.9], size: [0.08, 0.14], burstSpeed: [1.2, 3.2], burstUp: [2.4, 4.6], spawnSize: [w * 0.8, 0.4, 0.5],
    colors: ['#cfe8f0', '#8cc0d6', '#eef4f8'], hdr: 1.1,
  });
  ps.burst('sparkle', at(a.x, a.y + 1.2, a.z), 6, { size: [0.18, 0.28], hdr: 1.35, spawnSize: [w, 1.6, 0.8], life: [0.4, 0.8] });
  if (near) game.audio?.playSfx?.('fallsBreak', { volume: 0.85 });
}

/**
 * Something of the frost the front took or brought (a live story group switching as it passes):
 * a puff of steam and powder where it stands.
 * @param {Game} game
 * @param {number} x @param {number} z
 * @param {number} w its size across (u)
 */
export function puff(game, x, z, w) {
  const ps = game.particles;
  if (!ps) return;
  const y = game.world?.groundAt(x, z) ?? 0;
  const s = clamp(w / 2, 0.6, 3);
  ps.burst('smoke', at(x, y + 0.4, z), Math.round(6 * s), {
    life: [1.0, 1.8], size: [0.6, 0.9], sizeEnd: 2.6, velocity: [0, 0, 0], velocityVariance: [0.1, 0.05, 0.1], burstSpeed: [0.3, 1.0], burstUp: [0.3, 0.9],
    gravity: 0.08, drag: 1.4, windInfluence: 0.25, spawnSize: [w, 0.6, w], color: '#eef4f8', alpha: 0.2, spin: [0.1, 0.4],
  });
  ps.burst('snow', at(x, y + 1.2, z), Math.round(8 * s), {
    life: [0.5, 0.9], size: [0.14, 0.22], velocity: [0, -1.6, 0], velocityVariance: [0.3, 0.5, 0.3], burstSpeed: [0.3, 1.2], burstUp: [0.4, 1.4],
    gravity: -6, drag: 0.2, spawnSize: [w * 0.8, 0.8, w * 0.8], color: '#f4f8fc', alpha: 0.95, spin: [0.5, 1],
  });
}

/**
 * The ice on a stretch of water the front passed: it breaks — pale chips thrown, a breath of steam.
 * @param {Game} game
 * @param {number} x @param {number} y the water's surface @param {number} z
 * @param {number} w the stretch's size across (u)
 */
export function iceBreak(game, x, y, z, w) {
  const ps = game.particles;
  if (!ps) return;
  ps.burst('splash', at(x, y + 0.15, z), Math.round(clamp(w * 2.5, 6, 18)), {
    life: [0.45, 0.85], size: [0.08, 0.14], burstSpeed: [0.6, 2.2], burstUp: [1.6, 3.4], spawnSize: [w * 0.7, 0.1, w * 0.7],
    colors: ['#cfe8f0', '#8cc0d6', '#eef4f8'], hdr: 1.05,
  });
  ps.burst('smoke', at(x, y + 0.3, z), 3, {
    life: [1.2, 2.0], size: [0.6, 0.9], sizeEnd: 2.6, velocity: [0, 0, 0], velocityVariance: [0.1, 0.05, 0.1], burstSpeed: [0.2, 0.7], burstUp: [0.3, 0.8],
    gravity: 0.1, drag: 1.4, windInfluence: 0.3, spawnSize: [w * 0.8, 0.2, w * 0.8], color: '#eef4f8', alpha: 0.16, spin: [0.1, 0.4],
  });
}

/**
 * A frost foe the front passed (an `unless: <bell>` group): it shatters — cut-out shards of ice
 * thrown, steam, glints.
 * @param {Game} game
 * @param {number} x @param {number} y @param {number} z
 */
export function shatter(game, x, y, z) {
  const ps = game.particles;
  if (!ps) return;
  ps.burst('splash', at(x, y + 0.9, z), 16, {
    life: [0.5, 1.0], size: [0.1, 0.18], sizeEnd: 0.8, burstSpeed: [1.6, 3.8], burstUp: [2, 4.4], gravity: -12, drag: 0.3, spawnSize: [0.6, 1.4, 0.6],
    colors: ['#cfe8f0', '#8cc0d6', '#4a88a8', '#eef4f8'], hdr: 1, ...CUTOUT_BITS,
  });
  ps.burst('smoke', at(x, y + 0.6, z), 6, {
    life: [1.2, 2.0], size: [0.6, 0.9], sizeEnd: 2.6, velocity: [0, 0, 0], velocityVariance: [0.1, 0.05, 0.1], burstSpeed: [0.4, 1.2], burstUp: [0.4, 1.0],
    gravity: 0.1, drag: 1.4, windInfluence: 0.2, spawnSize: [0.8, 1.0, 0.8], color: '#eef4f8', alpha: 0.18, spin: [0.1, 0.4],
  });
  ps.burst('sparkle', at(x, y + 1.0, z), 5, { size: [0.18, 0.28], hdr: 1.35, spawnSize: [0.8, 1.4, 0.8], life: [0.4, 0.8] });
  game.audio?.playSfx?.('iceCrack', { volume: 0.7 });
}
