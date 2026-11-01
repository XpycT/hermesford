import * as THREE from 'three';
import { smoothstep } from '../../utils/math.js';
import { FlameSet } from './FlameBatch.js';
import { makeBell, bellOf, quadFacing } from './Belfry.js';
import { emberMaterial, EMBER_GLOW, fireGroup } from './Monuments.js';

/**
 * @import { PropFactory, PropResult, PropParts } from '../Props.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 */

/**
 * Smithy.js — the Halloway Forge's furniture (The Bells of Evermere, docs/contracts/
 * EVERMERE_CAMPAIGN.md §2.6, §5.3): the bell-founder's forge, anvil, bellows, mould stand, tool rack
 * and bell blank. (x, z): the footprint's centre on the floor; rotation 0 turns the front toward +Z
 * (the camera) and a wall piece's back to the north. In the season kit's chunk
 * (../SeasonKitParts.js). Owner: the architecture package.
 *
 *  - `forge`  a brick hearth (stone rim, a firepot of glowing coals — the hearth's ember material,
 *    `EMBER_GLOW` — and its fire through the flame batch: flames, a glow, sparks), a brick hood on a
 *    timber mantel up into a chimney (to 3.9), the bellows' pipe on its east side, tongs and a
 *    bucket. **One light** (warm, day and night: the room's key light). Footprint 2.0 × 1.4.
 *  - `anvil`  a London-pattern anvil (face, horn, heel, waist) on an elm stump. 0.9 × 0.6.
 *  - `bellows` the great bellows on a trestle, its nozzle toward −X (west: the forge in the
 *    Halloway Forge stands west of it), leather pleats between two boards, the rocking pole and its
 *    chain. 1.5 × 0.84.
 *  - `mould`  the founder's mould stand **without its mould** (the clue: the mould is gone): a brick
 *    pit kerb, a loam bed with the pale ring where the cope stood, the iron spindle and the strickle
 *    board cut to a bell's profile, two loam shards on the floor. Ø 1.3.
 *  - `rack`   a tool board on the wall: two hammers, tongs, a file, callipers, and an empty hook under
 *    the pale outline of the tuning fork that hung there. 1.6 × 0.4.
 *  - `bellblank` a rough-cast bell (dark bronze) hung on a chain from a beam on two trestles:
 *    `result.bell` (kind 'bellblank') swings it like a belfry's (props/Belfry.js `makeBell`).
 *    1.9 × 0.7.
 * Library materials and this package's textures only (no program of its own); the forge's fire is
 * the level's flame batch (FlameBatch.js).
 */

/**
 * @typedef {object} SmithyOptions
 * @property {string} [kind] 'forge' | 'anvil' | 'bellows' | 'mould' | 'rack' | 'bellblank'
 * @property {number} [rotation]
 * @property {number} [seed]
 * @property {string} [id]
 */

/** Half width and half depth of each piece's footprint (its collider). */
export const SMITHY_FOOT = Object.freeze({ forge: [1.0, 0.7], anvil: [0.45, 0.3], bellows: [0.75, 0.42], mould: [0.65, 0.65], rack: [0.8, 0.2], bellblank: [0.95, 0.35] });

const groundAO = (h = 0.7, k = 0.6) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);
const SOOT = [0.5, 0.44, 0.42];

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y floor height
 * @param {number} z
 * @param {SmithyOptions} [opts]
 * @returns {PropResult}
 */
export function buildSmithy(f, x, y, z, opts = {}) {
  const kind = Object.hasOwn(SMITHY_FOOT, opts.kind ?? '') ? /** @type {keyof typeof SMITHY_FOOT} */ (opts.kind) : 'forge';
  const [hw, hd] = SMITHY_FOOT[kind];
  const rng = f.rng(`smithy:${kind}`, x, z, opts.seed);
  const b = f.builder(groundAO());
  /** @type {PropParts} */
  const parts = {};
  /** @type {(() => THREE.Group|null)|null} */
  let fire = null;
  /** @type {number[]|null} the bell blank's hang point */
  let bellAt = null;
  let lightAt = null;
  switch (kind) {
    case 'forge': {
      // the hearth: brick bed, a stone rim, the firepot in the middle
      b.box('brick', [2.0, 0.86, 1.4], { at: [0, 0.43, 0], faces: { ny: false, py: false } });
      b.box('stone_tiles', [2.1, 0.1, 1.5], { at: [0, 0.91, 0], faces: { ny: false }, cutsS: [0.6, 1.5] });
      const coals = emberMaterial(f, 'warm');
      b.lathe('brick', [{ y: 0.95, r: 0.46 }, { y: 1.04, r: 0.42 }], { segments: 8, smooth: false, color: SOOT, capTop: 'metal' });
      b.lathe(coals, [{ y: 1.02, r: 0.38 }, { y: 1.1, r: 0.28 }, { y: 1.15, r: 0.1 }], { segments: 8, smooth: false, at: [0, 0, 0.05] });
      parts.emissives = [{ material: coals, ...EMBER_GLOW }];
      // the hood on a timber mantel, the chimney
      b.box('wood_planks_dark', [2.1, 0.2, 0.22], { at: [0, 1.8, 0.55], rotUV: true });
      for (const s of [-1, 1]) b.box('metal', [0.06, 0.6, 0.06], { at: [s * 0.95, 1.35, 0.6] });
      b.lathe('brick', [{ y: 1.9, r: 1.0 * Math.SQRT2 }, { y: 2.75, r: 0.4 * Math.SQRT2 }], { segments: 4, phase: Math.PI / 4, smooth: false, at: [0, 0, -0.1], color: [0.86, 0.8, 0.78] });
      b.box('brick', [0.8, 1.2, 0.7], { at: [0, 3.3, -0.12], faces: { ny: false }, color: [0.86, 0.8, 0.78] });
      b.box('brick', [1.95, 0.1, 1.35], { at: [0, 1.9, -0.05], faces: { py: false }, color: [0.2, 0.17, 0.16] });
      // the bellows' pipe from the east into the firepot, tongs on the rim, a bucket
      b.tube('metal', [1.05, 0.98, 0.1], [0.42, 1.02, 0.05], 0.07, 0.06, { segments: 6 });
      b.box('metal', [0.62, 0.03, 0.05], { at: [-0.62, 0.98, 0.42], rot: [0, 0.2, 0] });
      b.box('metal', [0.58, 0.03, 0.05], { at: [-0.6, 0.99, 0.48], rot: [0, -0.1, 0] });
      b.lathe('metal', [{ y: 0, r: 0.17 }, { y: 0.36, r: 0.21 }], { segments: 8, capBottom: true, at: [-0.82, 0, 0.92] });
      b.lathe('metal', [{ y: 0.34, r: 0.19 }, { y: 0.1, r: 0.15 }], { segments: 8, at: [-0.82, 0, 0.92], color: [0.25, 0.3, 0.38] });
      fire = () => {
        const set = new FlameSet();
        const seed = rng.range(0, 100);
        set.add({ x: 0, y: 1.08, z: 0.05, width: 0.46, height: 0.62, seed, intensity: 0.7, glow: 2.8, glowIntensity: 0.55 });
        set.add({ x: -0.16, y: 1.06, z: -0.02, width: 0.3, height: 0.42, seed: seed + 5, speed: 1.2, intensity: 0.78 });
        set.add({ x: 0.17, y: 1.06, z: 0.0, width: 0.26, height: 0.36, seed: seed + 11, speed: 0.85, intensity: 0.78 });
        set.spark({ x: 0, y: 1.2, z: 0.05, spread: 0.24, height: 1.3, count: 10, seed, size: 0.06, life: 1.6 });
        return fireGroup(f, set, false);
      };
      lightAt = new THREE.Vector3(0, 1.35, 0.6);
      break;
    }
    case 'anvil': {
      // the stump
      b.lathe('bark', [{ y: 0, r: 0.32 }, { y: 0.08, r: 0.29 }, { y: 0.46, r: 0.27 }], { segments: 8, smooth: true });
      b.lathe('wood_planks', [{ y: 0.46, r: 0.27 }, { y: 0.48, r: 0.26 }], { segments: 8, capTop: true, color: [0.9, 0.82, 0.74] });
      // the anvil: feet, waist, face, horn, heel
      const M = 'metal';
      b.box(M, [0.46, 0.08, 0.3], { at: [0, 0.52, 0] });
      b.box(M, [0.26, 0.14, 0.2], { at: [0, 0.62, 0], color: [0.85, 0.85, 0.88] });
      b.box(M, [0.6, 0.15, 0.24], { at: [-0.02, 0.765, 0], color: [1.1, 1.1, 1.12] });
      b.box(M, [0.5, 0.01, 0.2], { at: [-0.04, 0.845, 0], color: [1.4, 1.4, 1.45] });
      b.tube(M, [0.28, 0.79, 0], [0.62, 0.81, 0], 0.08, 0.015, { segments: 6, color: [1.05, 1.05, 1.08] });
      b.box(M, [0.12, 0.1, 0.18], { at: [-0.36, 0.79, 0] });
      b.box(M, [0.03, 0.005, 0.03], { at: [-0.22, 0.852, 0], color: [0.1, 0.1, 0.12] });
      // a set hammer resting against the stump
      b.box('wood_planks', [0.05, 0.5, 0.05], { at: [0.3, 0.25, 0.24], rot: [0, 0, 0.25], rotUV: true });
      b.box(M, [0.16, 0.08, 0.08], { at: [0.37, 0.5, 0.24], rot: [0, 0, 0.25] });
      break;
    }
    case 'bellows': {
      // the trestle
      for (const s of [-1, 1]) {
        b.box('wood_planks_dark', [0.08, 0.62, 0.08], { at: [s * 0.45, 0.31, -0.25], rot: [0.12, 0, 0] });
        b.box('wood_planks_dark', [0.08, 0.62, 0.08], { at: [s * 0.45, 0.31, 0.25], rot: [-0.12, 0, 0] });
      }
      b.box('wood_planks_dark', [1.1, 0.08, 0.08], { at: [0, 0.6, 0], rotUV: true });
      // the body: a pear of two boards (wide end east, the nozzle west), leather pleats between
      const outline = [];
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const cx = Math.cos(a);
        const r = 0.36 * (0.62 + 0.38 * Math.max(0, cx)) + 0.06;
        outline.push([0.12 + cx * 0.58, Math.sin(a) * r]);
      }
      const y0 = 0.66, y1 = 0.9;
      const board = (yy, up) => {
        const pts = outline.slice(0, 12).map(([px, pz]) => [px, yy, pz]);
        b.poly('wood_planks', up ? pts.slice().reverse() : pts, { uAxis: [1, 0, 0], vAxis: [0, 0, -1], normal: [0, up ? 1 : -1, 0] });
      };
      board(y1 + 0.04, true);
      board(y0, false);
      b.box('wood_planks', [0.05, 0.04, 0.01], { at: [0, y1 + 0.02, 0] });
      for (let k = 0; k < 12; k++) {
        const [ax, az] = outline[k];
        const [bx, bz] = outline[k + 1];
        const nx = bz - az, nz = -(bx - ax);
        const nl = Math.hypot(nx, nz) || 1;
        const n = [-nx / nl, 0, -nz / nl];
        // pleats: the leather bulges out at mid height
        for (const [ya, yb, out0, out1] of [[y0, (y0 + y1) / 2, 0, 0.06], [(y0 + y1) / 2, y1 + 0.04, 0.06, 0]]) {
          const P = (px, pz, yy, o) => [px + n[0] * o, yy, pz + n[2] * o];
          quadFacing(b, 'leather', [P(ax, az, ya, out0), P(bx, bz, ya, out0), P(bx, bz, yb, out1), P(ax, az, yb, out1)], [n[0], ya < (y0 + y1) / 2 - 0.01 ? -0.3 : 0.3, n[2]], (p) => [(p[0] + p[2]) * 2, p[1] * 4]);
        }
      }
      // the nozzle (west), the rocking pole and its chain
      b.tube('metal', [-0.44, 0.78, 0], [-0.78, 0.8, 0], 0.07, 0.04, { segments: 6 });
      b.box('wood_planks_dark', [0.1, 1.5, 0.1], { at: [0.62, 0.75, -0.3] });
      b.box('wood_planks', [1.5, 0.07, 0.07], { at: [0.2, 1.52, -0.3], rot: [0, 0, -0.18], rotUV: true });
      b.box('metal', [0.03, 0.52, 0.03], { at: [0.2, 1.2, -0.12] });
      break;
    }
    case 'mould': {
      // a brick kerb round the casting pit, a loam bed, the pale ring where the cope stood
      b.lathe('brick', [{ y: 0, r: 0.64 }, { y: 0.3, r: 0.6 }], { segments: 12, smooth: false, phase: rng.range(0, 1) });
      b.lathe('loam', [{ y: 0.3, r: 0.6 }, { y: 0.34, r: 0.52 }, { y: 0.36, r: 0.02 }], { segments: 12, smooth: false });
      b.lathe('loam', [{ y: 0.362, r: 0.5 }, { y: 0.362, r: 0.4 }], { segments: 12, smooth: false, color: [1.35, 1.3, 1.22] });
      // the spindle and the strickle board: a half bell profile turned about the spindle
      b.tube('metal', [0, 0.3, 0], [0, 2.1, 0], 0.035, 0.03, { segments: 6 });
      b.box('wood_planks_dark', [0.7, 0.06, 0.08], { at: [0.3, 2.0, 0] });
      const prof = [[0.48, 0.4], [0.45, 0.5], [0.36, 0.72], [0.3, 1.1], [0.27, 1.4], [0.22, 1.58], [0.1, 1.66], [0.02, 1.68]];
      for (let k = 0; k < prof.length - 1; k++) {
        const [r0, y0] = prof[k];
        const [r1, y1] = prof[k + 1];
        const pts = [[r0, y0, 0], [r0 + 0.16, y0, 0], [r1 + 0.16, y1, 0], [r1, y1, 0]];
        quadFacing(b, 'wood_planks', pts, [0, 0, 1], (p) => [p[0], p[1]]);
        quadFacing(b, 'wood_planks', pts.map((p) => [p[0], p[1], -0.04]), [0, 0, -1], (p) => [p[0], p[1]], [0.8, 0.8, 0.8]);
      }
      b.box('wood_planks', [0.18, 1.3, 0.04], { at: [0.62, 1.05, -0.02] });
      b.box('wood_planks_dark', [0.5, 0.05, 0.05], { at: [0.25, 0.42, -0.02] });
      // two shards of the old loam on the floor
      const loam = f.textures.material('loam', { vertexColors: true });
      for (let k = 0; k < 2; k++) {
        const a = rng.range(0, Math.PI * 2);
        f.rockGeom(b, Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85, [0.18, 0.08, 0.13], rng, { top: loam, side: loam, detail: 0, flatTop: 0.4, yaw: a });
      }
      break;
    }
    case 'rack': {
      // the board on the wall, pegs and tools
      b.box('wood_planks', [1.6, 1.2, 0.06], { at: [0, 1.6, -0.17] });
      b.box('wood_planks_dark', [1.7, 0.08, 0.1], { at: [0, 2.24, -0.15] });
      b.box('wood_planks_dark', [1.7, 0.08, 0.1], { at: [0, 0.96, -0.15] });
      const hammer = (hx, hy, head) => {
        b.box('wood_planks', [0.05, 0.5, 0.04], { at: [hx, hy - 0.2, -0.1], rotUV: true });
        b.box('metal', [head, 0.08, 0.08], { at: [hx, hy + 0.06, -0.1] });
        b.box('metal', [0.03, 0.06, 0.08], { at: [hx, hy + 0.12, -0.12] });
      };
      hammer(-0.6, 1.95, 0.22);
      hammer(-0.38, 1.95, 0.16);
      for (const s of [-1, 1]) b.box('metal', [0.025, 0.6, 0.025], { at: [-0.12 + s * 0.04, 1.65, -0.1], rot: [0, 0, s * 0.08] });
      b.box('metal', [0.03, 0.42, 0.015], { at: [0.62, 1.7, -0.11] });
      b.box('wood_planks_dark', [0.05, 0.14, 0.04], { at: [0.62, 1.95, -0.11] });
      for (const s of [-1, 1]) b.tube('metal', [0.42, 1.95, -0.11], [0.42 + s * 0.08, 1.55, -0.11], 0.015, 0.012, { segments: 4 });
      // the empty hook, under the pale outline of the fork that hung there seven years
      const fx = 0.16;
      const pale = [1.4, 1.34, 1.24];
      b.box('wood_planks', [0.03, 0.3, 0.004], { at: [fx, 1.38, -0.137], color: pale });
      b.box('wood_planks', [0.14, 0.03, 0.004], { at: [fx, 1.54, -0.137], color: pale });
      for (const s of [-1, 1]) b.box('wood_planks', [0.03, 0.26, 0.004], { at: [fx + s * 0.055, 1.68, -0.137], color: pale });
      b.box('metal', [0.025, 0.025, 0.12], { at: [fx, 1.86, -0.08] });
      b.box('metal', [0.025, 0.06, 0.025], { at: [fx, 1.89, -0.03] });
      break;
    }
    default: {
      // the bell blank: two trestles, a beam, the chain
      for (const s of [-1, 1]) {
        b.box('wood_planks_dark', [0.1, 2.15, 0.1], { at: [s * 0.82, 1.06, -0.18], rot: [-0.12, 0, 0] });
        b.box('wood_planks_dark', [0.1, 2.15, 0.1], { at: [s * 0.82, 1.06, 0.18], rot: [0.12, 0, 0] });
      }
      b.box('wood_planks_dark', [1.9, 0.16, 0.16], { at: [0, 2.1, 0], rotUV: true });
      for (let yy = 1.86; yy < 2.02; yy += 0.12) b.box('metal', [0.05, 0.12, 0.1], { at: [0, yy, 0] });
      bellAt = [0, 1.82, 0];
    }
  }
  const rot = Number(opts.rotation) || 0;
  const group = f.finish(b, `smithy:${kind}`, x, y, z, rot);
  if (fire) {
    const fl = fire();
    if (fl) group.add(fl);
  }
  /** @type {ReturnType<typeof makeBell>|null} */
  let bell = null;
  if (bellAt) {
    bell = makeBell(f, { R: 0.44, name: 'smithy:bell', segments: 12, omega: 4.2, kick: 0.4, tint: [0.68, 0.6, 0.56] });
    bell.group.position.set(bellAt[0], bellAt[1], bellAt[2]);
    group.add(bell.group);
  }
  group.updateMatrixWorld(true);
  bell?.place();
  if (lightAt) {
    parts.lights = [{ position: f.world(group, lightAt), color: '#ff8a3a', intensity: 9, distance: 8.5, flicker: 0.38, nightOnly: false, fire: true }];
  }
  parts.colliders = f.boxColliders(group, -hw, hw, -hd, hd);
  if (bell) parts.update = bell.update;
  const res = f.result(group, parts);
  if (bell) res.bell = bellOf(bell, 'bellblank');
  return res;
}
