import * as THREE from 'three';
import { smoothstep } from '../../utils/math.js';
import { toThreeColor } from '../../pixel/PixelCanvas.js';
import { FlameSet, flameMaterials } from './FlameBatch.js';
import { makeBell, bellOf, lanternMaterial, LANTERN_GLOW, quadFacing } from './Belfry.js';

/**
 * @import { PropFactory, PropResult, PropParts } from '../Props.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 */

/**
 * Monuments.js — The Bells of Evermere's small set pieces (docs/contracts/EVERMERE_CAMPAIGN.md §3,
 * §5.3, §7.2): a grave, a statue, a cairn, a wayside chime, a brazier, a bell-lantern. In the season
 * kit's chunk (../SeasonKitParts.js). Owner: the architecture package. No rotation (the catalog gives
 * none): each is composed to read from the north-looking camera, its face toward +Z.
 *
 *  - `grave`   a round-topped headstone of blue-grey ashlar with a carved bell, leaning a little,
 *    over a kerbed plot (the plot walkable; the stone's collider only).
 *  - `statue`  a hooded figure holding a bell before its chest, on a moulded plinth.
 *  - `cairn`   five stones stacked by a path.
 *  - `chime`   a wayside chime: a small vermilion-lacquered gate (two posts, a beam, a little
 *    vermilion roof) with a bronze hand-bell and its pull cord; `result.bell` (kind 'chime') swings
 *    it like a belfry's bell (props/Belfry.js `makeBell`). One mesh + shadow, a clapper without one.
 *  - `brazier` a stone pedestal and an iron bowl. `fire`: 'warm' (absent too) — coals and flames
 *    through the flame batch (props/FlameBatch.js: the level's three fire draw calls), sparks, a
 *    warm light and `result.warmth` = { at: [x, z], r: 3.5 } (the Hush Bell's safe zone);
 *    'cold' — the cyan cold fire (#7fe0ff: the batch's program with its own palette — the
 *    level's flame batch gets up to three more draw calls, no program) and a cyan light, no warmth;
 *    'out' — black charcoal, no light, no flame.
 *  - `lantern` a bell-lantern (an iron bell-shaped hood over four leaded panes) hanging in a small
 *    iron gate: `lit` → the panes glow (the shared bell-lantern glass, registered `LANTERN_GLOW`),
 *    no light descriptor; unlit → dark glass. The town belfry's progress lanterns
 *    (Belfry.js `TOWN_LANTERN_SOCKETS`).
 *
 * Lights (each spends one of the level's 12 lamp descriptors): a warm brazier, a cold brazier. A
 * relit brazier is a pair of objects (`when` / `unless`): two descriptors, the hidden one faded.
 * Every part is a library material or this package's texture (no program of its own).
 */

/**
 * @typedef {object} MonumentOptions
 * @property {string} [kind] 'grave' | 'statue' | 'cairn' | 'chime' | 'brazier' | 'lantern'
 * @property {string} [fire] a brazier's fire: 'warm' (default) | 'cold' | 'out'
 * @property {boolean} [lit] a lantern glows
 * @property {number} [seed]
 * @property {string} [id]
 */

/** The warm brazier's warmth radius (the Hush Bell's safe zone, EVERMERE_CAMPAIGN.md §3). */
export const BRAZIER_WARMTH = 3.5;

/** The embers' glow — the hearth's (props/Furniture.js EMBER_GLOW): one shared library material. */
export const EMBER_GLOW = Object.freeze({ day: 1.3, night: 1.9 });

/** The flame shader's per-band gains (Flame.js FIRE_GAINS) applied to the cold-fire ramp. */
const FIRE_GAINS = [0.55, 0.62, 0.75, 0.9, 1.0, 2.4];
/** The cold fire's ramp, dark rim → a pale cyan core (the contract's cold fire #7fe0ff its heart). */
const COLD_FIRE = ['#0a2440', '#1650a0', '#2a8ad8', '#4fc8f0', '#7fe0ff', '#b8f2ff'];

const groundAO = (h = 0.6, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);

/**
 * The embers material: lit warm (the hearth's, registered `EMBER_GLOW`), cold (cyan, steady, not
 * registered) or out (black charcoal).
 * @param {PropFactory} f
 * @param {'warm'|'cold'|'out'} fire
 * @returns {THREE.Material}
 */
export function emberMaterial(f, fire) {
  if (fire === 'warm') return f.textures.material('embers', { vertexColors: true, emissiveIntensity: 0, emissive: new THREE.Color(0xff6a1e) });
  if (fire === 'cold') return f.textures.material('embers', { vertexColors: true, emissiveIntensity: 1.1, emissive: new THREE.Color('#7fe0ff'), color: new THREE.Color(0x587890) });
  return f.textures.material('embers', { vertexColors: true, emissiveIntensity: 0, color: new THREE.Color(0x3a3434) });
}

/**
 * The cold fire's three batch materials: the flame batch's own (same shaders, so the same
 * programs — no new one), their uniforms shared but for the palette.
 * @param {PropFactory} f
 * @returns {Record<'flame'|'glow'|'spark', THREE.ShaderMaterial>}
 */
function coldFlameMaterials(f) {
  const warm = flameMaterials(f);
  const ramp = COLD_FIRE.map((c, i) => toThreeColor(c).multiplyScalar(FIRE_GAINS[i]));
  const variant = (key, src, own) => /** @type {THREE.ShaderMaterial} */ (f._cachedMaterial(key, () => {
    const m = /** @type {THREE.ShaderMaterial} */ (src.clone());
    m.uniforms = { ...src.uniforms, ...own };
    m.name = `${src.name}:cold`;
    return m;
  }));
  return {
    flame: variant('ev:flame:cold', warm.flame, { uFire: { value: ramp } }),
    glow: variant('ev:glow:cold', warm.glow, { uColor: { value: new THREE.Color('#2aa8e0') } }),
    spark: variant('ev:spark:cold', warm.spark, { uFire: { value: ramp } }),
  };
}

/**
 * A FlameSet's group for a fire: warm on the batch's own materials, cold on the cold variants.
 * @param {PropFactory} f
 * @param {FlameSet} set
 * @param {boolean} cold
 * @returns {THREE.Group|null}
 */
export function fireGroup(f, set, cold) {
  const g = set.build(f);
  if (g && cold) {
    const mats = coldFlameMaterials(f);
    for (const o of g.children) {
      const m = /** @type {THREE.Mesh} */ (o);
      const kind = /** @type {'flame'|'glow'|'spark'} */ (m.userData.flameBatch);
      if (mats[kind]) m.material = mats[kind];
    }
  }
  return g;
}

/**
 * A small gate of two posts and a beam (the chime's and the lantern's), its opening along x.
 * @param {MeshBuilder} b
 */
function gate(b, { post, w, h, r }) {
  for (const s of [-1, 1]) {
    b.box('stone_tiles', [0.3, 0.16, 0.3], { at: [s * w / 2, 0.08, 0], color: [0.92, 0.94, 0.98] });
    b.tube(post, [s * w / 2, 0.1, 0], [s * w / 2, h, 0], r, r * 0.85, { segments: 6 });
  }
  b.box(post, [w + 0.34, 0.12, 0.14], { at: [0, h - 0.02, 0], rotUV: true });
}

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y ground height
 * @param {number} z
 * @param {MonumentOptions} [opts]
 * @returns {PropResult}
 */
export function buildMonument(f, x, y, z, opts = {}) {
  const kind = opts.kind ?? 'grave';
  const rng = f.rng(`monument:${kind}`, x, z, opts.seed);
  const b = f.builder(groundAO());
  /** @type {PropParts} */
  const parts = {};
  /** @type {[number, number, number][]} local colliders: x, z, r */
  const circles = [];
  /** @type {(() => THREE.Group|null)|null} */
  let fire = null;
  let bellSpec = null;
  switch (kind) {
    case 'statue': {
      const S = 'stone_tiles';
      const cool = [0.86, 0.9, 0.98];
      b.box('abbey_stone', [1.15, 0.24, 1.15], { at: [0, 0.12, 0], faces: { ny: false } });
      b.box('abbey_stone', [0.9, 0.62, 0.9], { at: [0, 0.55, 0], faces: { ny: false } });
      b.box('abbey_stone', [1.05, 0.12, 1.05], { at: [0, 0.92, 0], color: [1.06, 1.06, 1.08] });
      // a hooded figure: robe, shoulders, the hood, arms holding a bell before the chest
      b.lathe(S, [{ y: 0.98, r: 0.4 }, { y: 1.5, r: 0.32 }, { y: 2.05, r: 0.27 }, { y: 2.18, r: 0.2 }], { segments: 8, smooth: false, color: cool, phase: Math.PI / 8 });
      b.lathe(S, [{ y: 2.1, r: 0.14 }, { y: 2.3, r: 0.2 }, { y: 2.5, r: 0.17 }, { y: 2.62, r: 0.06 }], { segments: 8, smooth: false, color: cool, capBottom: true });
      b.quad(S, [[-0.09, 2.2, 0.17], [0.09, 2.2, 0.17], [0.07, 2.42, 0.15], [-0.07, 2.42, 0.15]], [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]], { color: [0.3, 0.3, 0.36] });
      for (const s of [-1, 1]) b.tube(S, [s * 0.26, 1.95, 0.02], [s * 0.08, 1.62, 0.32], 0.08, 0.07, { segments: 6, color: cool });
      b.lathe('bell_bronze', [{ y: 1.36, r: 0.17 }, { y: 1.44, r: 0.13 }, { y: 1.56, r: 0.1 }, { y: 1.62, r: 0.03 }], { segments: 8, at: [0, 0, 0.36], color: [0.8, 0.86, 0.9] });
      circles.push([0, 0, 0.6]);
      break;
    }
    case 'cairn': {
      const top = f.extra.material('boulder_moss');
      const side = f.extra.material('boulder');
      let yy = 0;
      for (const [sx, sy, sz] of [[0.55, 0.22, 0.48], [0.44, 0.2, 0.4], [0.34, 0.18, 0.31], [0.24, 0.16, 0.22], [0.15, 0.15, 0.14]]) {
        f.rockGeom(b, rng.range(-0.05, 0.05), yy, rng.range(-0.05, 0.05), [sx, sy, sz], rng, { top, side, detail: 0, flatTop: 0.35, sink: 0.05, yaw: rng.range(0, 6) });
        yy += sy * 1.55;
      }
      circles.push([0, 0, 0.55]);
      break;
    }
    case 'chime': {
      gate(b, { post: 'lacquer_red', w: 0.9, h: 2.25, r: 0.07 });
      // a little roof over the beam
      for (const s of [-1, 1]) b.box('roof_vermilion', [1.4, 0.07, 0.5], { at: [0, 2.42, s * 0.2], rot: [s * 0.5, 0, 0] });
      b.box('wood_planks_dark', [1.46, 0.1, 0.1], { at: [0, 2.53, 0] });
      b.box('wood_planks_dark', [0.1, 0.18, 0.1], { at: [0, 2.13, 0] });
      bellSpec = { R: 0.2, hang: [0, 2.04, 0] };
      circles.push([-0.45, 0, 0.2], [0.45, 0, 0.2]);
      break;
    }
    case 'brazier': {
      const which = opts.fire === 'cold' ? 'cold' : opts.fire === 'out' ? 'out' : 'warm';
      // an octagonal stone pedestal, a moulded cap, the iron bowl on four claws
      b.lathe('stone_brick', [{ y: 0, r: 0.42 }, { y: 0.16, r: 0.42 }, { y: 0.2, r: 0.32 }, { y: 0.78, r: 0.28 }, { y: 0.84, r: 0.38 }], { segments: 8, phase: Math.PI / 8, smooth: false, capTop: 'stone_tiles' });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        b.tube('metal', [Math.cos(a) * 0.25, 0.84, Math.sin(a) * 0.25], [Math.cos(a) * 0.42, 1.02, Math.sin(a) * 0.42], 0.04, 0.03, { segments: 4 });
      }
      b.lathe('metal', [{ y: 0.9, r: 0.16 }, { y: 0.96, r: 0.38 }, { y: 1.1, r: 0.52 }, { y: 1.16, r: 0.56 }], { segments: 10, smooth: true, capBottom: true });
      b.lathe('metal', [{ y: 1.13, r: 0.5 }, { y: 1.0, r: 0.26 }], { segments: 10, smooth: true, color: [0.4, 0.38, 0.4] });
      // coals heaped in the bowl
      const coal = emberMaterial(f, which);
      b.lathe(coal, [{ y: 1.06, r: 0.46 }, { y: 1.14, r: 0.38 }, { y: 1.2, r: 0.18 }, { y: 1.22, r: 0.02 }], { segments: 8, smooth: false, phase: rng.range(0, 1) });
      if (which === 'warm') parts.emissives = [{ material: coal, ...EMBER_GLOW }];
      if (which !== 'out') {
        const cold = which === 'cold';
        parts.lights = [{ position: new THREE.Vector3(x, y + 1.6, z), color: cold ? '#7fe0ff' : '#ff9a40', intensity: cold ? 7 : 9, distance: cold ? 6.5 : 7.5, flicker: cold ? 0.15 : 0.32, nightOnly: false, fire: true }];
        fire = () => {
          const set = new FlameSet();
          const seed = rng.range(0, 100);
          // (intensity < 1: the white core stays under the cinematic look's lens streaks)
          set.add({ x: 0, y: 1.14, z: 0.02, width: 0.62, height: 0.95, seed, intensity: 0.72, glow: 2.4, glowIntensity: cold ? 0.45 : 0.5 });
          set.add({ x: -0.18, y: 1.12, z: -0.06, width: 0.36, height: 0.6, seed: seed + 7, speed: 1.15, intensity: 0.8 });
          set.add({ x: 0.2, y: 1.12, z: -0.04, width: 0.32, height: 0.52, seed: seed + 13, speed: 0.9, intensity: 0.8 });
          set.spark({ x: 0, y: 1.3, z: 0, spread: 0.26, height: 1.9, count: cold ? 6 : 9, seed, size: 0.07 });
          return fireGroup(f, set, cold);
        };
      }
      circles.push([0, 0, 0.5]);
      break;
    }
    case 'lantern': {
      // an iron gate with scrolled tops, the bell-lantern hung from its middle
      gate(b, { post: 'metal', w: 0.8, h: 2.45, r: 0.045 });
      for (const s of [-1, 1]) {
        b.tube('metal', [s * 0.4, 2.45, 0], [s * 0.52, 2.62, 0], 0.03, 0.025, { segments: 4 });
        b.tube('metal', [s * 0.52, 2.62, 0], [s * 0.42, 2.7, 0], 0.025, 0.02, { segments: 4 });
      }
      b.box('metal', [0.025, 0.22, 0.025], { at: [0, 2.32, 0] });
      const lit = opts.lit === true;
      const glass = lanternMaterial(f, lit);
      const ly = 1.9;
      // the hood: a little bell of iron; the panes under it; a base and a drip finial
      b.lathe('metal', [{ y: ly + 0.16, r: 0.24 }, { y: ly + 0.21, r: 0.2 }, { y: ly + 0.3, r: 0.13 }, { y: ly + 0.38, r: 0.11 }, { y: ly + 0.42, r: 0.02 }], { segments: 8, phase: Math.PI / 8, smooth: true, capBottom: 'metal' });
      b.box(glass, [0.26, 0.3, 0.26], { at: [0, ly, 0], faces: { py: false, ny: false }, uv: 'fit' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('metal', [0.035, 0.32, 0.035], { at: [sx * 0.135, ly, sz * 0.135] });
      b.box('metal', [0.32, 0.04, 0.32], { at: [0, ly - 0.17, 0] });
      b.lathe('metal', [{ y: ly - 0.32, r: 0.01 }, { y: ly - 0.19, r: 0.06 }], { segments: 6 });
      if (lit) parts.emissives = [{ material: glass, ...LANTERN_GLOW }];
      circles.push([-0.4, 0, 0.18], [0.4, 0, 0.18]);
      break;
    }
    default: {
      // a grave: a round-topped headstone (a carved bell on its face) over a kerbed plot
      const S = 'abbey_stone';
      const lean = rng.range(-0.06, 0.04);
      const tilt = rng.range(-0.04, 0.04);
      b.push([0, 0, -0.42], [lean, 0, tilt]);
      const w = 0.78;
      const hRect = 0.66;
      const t = 0.16;
      const outline = [[-w / 2, 0], [w / 2, 0]];
      for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; outline.push([Math.cos(a) * w / 2, hRect + Math.sin(a) * w / 2]); }
      // (fan polygons: the front from the right foot round over the top)
      const fr = [[w / 2, 0, t / 2], ...outline.slice(2).map(([px, py]) => [px, py, t / 2]), [-w / 2, 0, t / 2]];
      b.poly(S, fr, { uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1] });
      b.poly(S, fr.slice().reverse().map(([px, py]) => [px, py, -t / 2]), { uAxis: [-1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, -1], color: [0.9, 0.9, 0.92] });
      const ring = [[-w / 2, 0], ...outline.slice(2).reverse(), [w / 2, 0]];
      for (let k = 0; k < ring.length - 1; k++) {
        const [ax, ay] = ring[k];
        const [bx, by] = ring[k + 1];
        const nx = by - ay, ny = -(bx - ax);
        const nl = Math.hypot(nx, ny) || 1;
        quadFacing(b, S, [[ax, ay, t / 2], [bx, by, t / 2], [bx, by, -t / 2], [ax, ay, -t / 2]], [-nx / nl, -ny / nl, 0], (p) => [(p[0] + p[1]) / 2, p[2] / 2], [0.94, 0.94, 0.96]);
      }
      // the carved bell: a darker inset on the face
      const bellPts = [[-0.14, 0.42], [0.14, 0.42], [0.11, 0.48], [0.09, 0.66], [0.04, 0.72], [-0.04, 0.72], [-0.09, 0.66], [-0.11, 0.48]];
      b.poly(S, bellPts.map(([px, py]) => [px, py, t / 2 + 0.004]), { uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1], color: [0.62, 0.64, 0.7] });
      b.box(S, [0.5, 0.03, 0.01], { at: [0, 0.28, t / 2 + 0.004], color: [0.62, 0.64, 0.7] });
      b.box(S, [0.36, 0.03, 0.01], { at: [0, 0.2, t / 2 + 0.004], color: [0.62, 0.64, 0.7] });
      b.pop();
      // the plot: a low stone kerb round a mound of earth
      b.box('dirt', [0.66, 0.14, 1.2], { at: [0, 0.07, 0.3], faces: { ny: false } });
      for (const s of [-1, 1]) b.box('stone_tiles', [0.1, 0.16, 1.4], { at: [s * 0.42, 0.08, 0.28], faces: { ny: false } });
      b.box('stone_tiles', [0.94, 0.16, 0.1], { at: [0, 0.08, 0.98], faces: { ny: false } });
      circles.push([0, -0.42, 0.42]);
    }
  }
  const group = f.finish(b, `monument:${kind}`, x, y, z, 0);
  if (fire) {
    const fl = fire();
    if (fl) group.add(fl);
  }
  /** @type {ReturnType<typeof makeBell>|null} */
  let bell = null;
  if (bellSpec) {
    bell = makeBell(f, { R: bellSpec.R, name: 'monument:chime', segments: 10, omega: 6.5, kick: 0.5 });
    bell.group.position.set(bellSpec.hang[0], bellSpec.hang[1], bellSpec.hang[2]);
    group.add(bell.group);
    // the pull cord from the clapper
    const cb = f.builder();
    cb.box('rope', [0.025, 0.7, 0.025], { at: [0, -0.35, 0] });
    cb.box('lacquer_red', [0.06, 0.1, 0.06], { at: [0, -0.72, 0] });
    const cord = cb.build('monument:cord', { castShadow: false });
    f.track(cord.geometries);
    cord.group.position.set(0, -bell.Hb - 0.02, 0);
    bell.group.add(cord.group);
  }
  group.updateMatrixWorld(true);
  bell?.place();
  parts.colliders = circles.map(([lx, lz, r]) => {
    const p = f.world(group, new THREE.Vector3(lx, 0, lz));
    return { type: /** @type {'circle'} */ ('circle'), x: p.x, z: p.z, r };
  });
  if (bell) parts.update = bell.update;
  const res = f.result(group, parts);
  if (kind === 'brazier' && (opts.fire ?? 'warm') === 'warm') res.warmth = { at: [x, z], r: BRAZIER_WARMTH };
  if (bell) res.bell = bellOf(bell, 'chime');
  return res;
}
