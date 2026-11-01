import * as THREE from 'three';
import { smoothstep, clamp } from '../../utils/math.js';
import { TRIM, centerOff, flowerBoxGeom } from './Details.js';
import { barrelGeom } from './SmallProps.js';

/** @import { PropFactory, PropResult } from '../Props.js' */

/**
 * Interior furniture — the catalog's `interior: true` types (docs/specs/OBJECT_CATALOG.md
 * § Interior): bed, table, chair, shelf, hearth, counter, rug, staircase, wardrobe, wall window and
 * grain sacks, so the rooms of a house, an inn, a barn or a mill read as what they are.
 *
 * Conventions, every piece: (x, y, z) is the centre of its footprint on the floor (the wall window:
 * a point on the wall face, like a wall torch); local +Z is the front — rotation 0 turns the front
 * toward the camera, and a wall piece (bed head, shelf, hearth, wardrobe, staircase, window) has
 * its back on z = −depth / 2, flush with a north wall when placed depth / 2 south of it. The
 * footprints are mirrored by `interiorFootprint` (src/engine/level/ObjectCatalog.js: picking, the
 * 2D map, the level checks) — change both. Colliders: `boxColliders` over the footprint (they follow
 * a turned piece); rugs and windows have none. Textures: the library's on-demand furniture set
 * (`furniture_wood`, `books`, `pantry`, `linen`, `quilt_*`, `rug_*`, `rug_border`, `embers`,
 * `window_inside`, `burlap`, `light_beam`), painted only on a level that places furniture.
 */

const TAU = Math.PI * 2;
/** Planed furniture oak (library, on demand). */
const FW = 'furniture_wood';
const groundAO = (h = 0.5, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);
/** A number option from level data (anything else: the default), clamped. */
const num = (v, d, lo, hi) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return clamp(Number.isFinite(n) ? n : d, lo, hi);
};
/** A name option from level data: one of `list`, else the default. */
const pick = (list, v, d) => (list.includes(v) ? v : d);

/** Blanket colours of a bed (`quilt_<colour>`; mirrored by ObjectCatalog's BLANKET_COLORS). */
export const BLANKETS = ['red', 'blue', 'green', 'ochre', 'plum'];
/** Rug colours (`rug_<colour>`; mirrored by ObjectCatalog's RUG_COLORS). */
export const RUGS = ['red', 'blue', 'green'];

/** Pewter, terracotta and crockery tints for small tableware. */
const PEWTER = [1.3, 1.3, 1.36];
const TERRACOTTA = [1.05, 0.62, 0.45];

// ---------------------------------------------------------------------------------------------
// Small tableware (emitted into a builder at a local point on a surface of height `y`)
// ---------------------------------------------------------------------------------------------

/** A plate (white crockery disc with a rim). */
function plateGeom(b, x, y, z, r = 0.16) {
  b.lathe('linen', [{ y, r: r * 0.62 }, { y: y + 0.018, r }, { y: y + 0.028, r: r * 1.02 }], { segments: 10, smooth: false, capTop: 'linen', at: [x, 0, z], color: [1.02, 1.0, 0.98] });
}

/** A pewter mug with ale in it and a handle facing `yaw`. */
function mugGeom(b, x, y, z, yaw = 0) {
  b.lathe('metal', [{ y, r: 0.075 }, { y: y + 0.17, r: 0.08 }], { segments: 8, capTop: TRIM, at: [x, 0, z], color: PEWTER });
  b.box('metal', [0.03, 0.1, 0.06], { at: [x + Math.cos(yaw) * 0.1, y + 0.09, z - Math.sin(yaw) * 0.1], rot: yaw, color: PEWTER });
}

/** A terracotta jug (bulbous body, narrow neck). */
function jugGeom(b, x, y, z) {
  b.lathe('linen', [{ y, r: 0.08 }, { y: y + 0.1, r: 0.115 }, { y: y + 0.21, r: 0.075 }, { y: y + 0.29, r: 0.06 }, { y: y + 0.31, r: 0.07 }],
    { segments: 9, capTop: TRIM, at: [x, 0, z], color: TERRACOTTA });
}

/** A loaf of bread (an oval dome). */
function breadGeom(b, x, y, z, yaw = 0) {
  b.push([x, y, z], yaw, [1.45, 1, 0.9]);
  b.lathe('hay', [{ y: 0, r: 0.1 }, { y: 0.05, r: 0.11 }, { y: 0.09, r: 0.07 }, { y: 0.105, r: 0.01 }], { segments: 8, color: [1.0, 0.68, 0.38], normalUp: 0.3 });
  b.pop();
}

/** A candle on a pewter holder; returns the flame's base point (local). */
function candleGeom(b, x, y, z, h = 0.18) {
  b.lathe('metal', [{ y, r: 0.08 }, { y: y + 0.02, r: 0.07 }, { y: y + 0.035, r: 0.035 }], { segments: 8, smooth: false, capTop: 'metal', at: [x, 0, z], color: PEWTER });
  b.lathe('linen', [{ y: y + 0.03, r: 0.032 }, { y: y + 0.03 + h, r: 0.03 }], { segments: 6, capTop: 'linen', at: [x, 0, z], color: [1.05, 1.0, 0.86] });
  return new THREE.Vector3(x, y + 0.03 + h, z);
}

// ---------------------------------------------------------------------------------------------
// Bed
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildBed` / `PropFactory.bed`.
 * @typedef {object} BedOptions
 * @property {number} [width] 0.8–2.4 (1.2 a single bed; from 1.6 two pillows)
 * @property {number} [length] head to foot, 1.6–2.8 (2.2)
 * @property {string} [blanket] quilt colour, one of BLANKETS ('red')
 * @property {number} [rotation] yaw (0: the head against a north wall, the foot toward the camera)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A wooden bed: corner posts with finials, a boarded head panel (local −Z) taller than the foot
 * panel, side rails, a linen mattress, a patchwork quilt hanging over the sides, the sheet turned
 * down and one pillow (two from a width of 1.6) leaning on the head.
 * Footprint: (width + 0.1) × length.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {BedOptions} [opts]
 * @returns {PropResult}
 */
export function buildBed(f, x, y, z, opts = {}) {
  const rng = f.rng('bed', x, z, opts.seed);
  const W = num(opts.width, 1.2, 0.8, 2.4);
  const L = num(opts.length, 2.2, 1.6, 2.8);
  const quilt = `quilt_${pick(BLANKETS, opts.blanket, 'red')}`;
  const b = f.builder(groundAO(0.7));
  const hw = W / 2;
  const hl = L / 2;
  const headH = 1.2;
  const footH = 0.75;
  // posts with caps and finials
  for (const sx of [-1, 1]) {
    for (const [pz, ph] of [[-hl + 0.06, headH], [hl - 0.06, footH]]) {
      b.box(TRIM, [0.12, ph, 0.12], { at: [sx * (hw - 0.01), ph / 2, pz], rotUV: true, faces: { ny: false } });
      b.box(TRIM, [0.16, 0.05, 0.16], { at: [sx * (hw - 0.01), ph + 0.025, pz], faces: { ny: false } });
      b.box(TRIM, [0.08, 0.07, 0.08], { at: [sx * (hw - 0.01), ph + 0.085, pz], faces: { ny: false } });
    }
    b.box(FW, [0.07, 0.2, L - 0.24], { at: [sx * (hw - 0.02), 0.3, 0], faces: { ny: false } });
  }
  // head panel (upright boards) + top rail; the low foot panel + rail
  const Uf = f.textures.meta(FW).units[0];
  b.box(FW, [W - 0.12, 0.72, 0.06], { at: [0, 0.34 + 0.36, -hl + 0.06], rotUV: true, faces: { ny: false, pz: { off: [0, centerOff(W - 0.12, Uf)] } } });
  b.box(TRIM, [W - 0.08, 0.09, 0.1], { at: [0, 1.1, -hl + 0.06] });
  b.box(FW, [W - 0.12, 0.3, 0.06], { at: [0, 0.25 + 0.15, hl - 0.06], rotUV: true, faces: { ny: false } });
  b.box(TRIM, [W - 0.08, 0.07, 0.1], { at: [0, 0.585, hl - 0.06] });
  // mattress, quilt (over the sides), turned-down sheet
  const mTop = 0.56;
  b.box('linen', [W - 0.12, 0.2, L - 0.22], { at: [0, mTop - 0.1, 0], faces: { ny: false } });
  const qz0 = -hl + 0.72;
  const qz1 = hl - 0.11;
  const qL = qz1 - qz0;
  const qc = (qz0 + qz1) / 2;
  const Uq = f.textures.meta(quilt).units[0];
  b.box(quilt, [W + 0.1, 0.05, qL], { at: [0, mTop + 0.025, qc], faces: { ny: false, py: { off: [centerOff(W + 0.1, Uq), 0] } } });
  for (const sx of [-1, 1]) b.box(quilt, [0.035, 0.34, qL], { at: [sx * (hw + 0.0325), mTop + 0.05 - 0.17, qc], faces: { ny: false, py: false } });
  b.box('linen', [W + 0.06, 0.06, 0.15], { at: [0, mTop + 0.045, qz0 + 0.04], faces: { ny: false } });
  // pillows leaning on the head
  const nP = W >= 1.6 ? 2 : 1;
  const pw = (W - 0.26) / nP - (nP > 1 ? 0.05 : 0);
  for (let i = 0; i < nP; i++) {
    const px = nP === 1 ? 0 : (i - 0.5) * (pw + 0.08);
    const tilt = -0.35 + rng.range(-0.04, 0.04);
    b.box('linen', [pw, 0.13, 0.42], { at: [px, mTop + 0.11, -hl + 0.37], rot: [tilt, rng.range(-0.05, 0.05), 0], color: [1.03, 1.03, 1.03] });
    b.box('linen', [pw - 0.1, 0.05, 0.3], { at: [px, mTop + 0.19, -hl + 0.355], rot: [tilt, 0, 0], color: [1.05, 1.05, 1.05] });
  }
  const group = f.finish(b, 'bed', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: f.boxColliders(group, -hw - 0.05, hw + 0.05, -hl, hl) });
}

// ---------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildTable` / `PropFactory.table`.
 * @typedef {object} TableOptions
 * @property {'rect'|'round'|string} [shape] ('rect')
 * @property {number} [width] rect: along x, 0.6–3.2 (1.6); round: the diameter (1.2 when absent —
 *   a level object always has one: the catalog writes 1.6)
 * @property {number} [depth] rect only, 0.6–2 (0.9)
 * @property {boolean} [cloth] a linen table cloth (false)
 * @property {boolean} [items] tableware: plates, mugs, a jug, bread (true)
 * @property {boolean} [candle] a lit candle in the middle (a flame, no point light) (false)
 * @property {number} [rotation]
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A table: a planed top with a dark edge on four legs and an apron (rect) or on a pedestal with a
 * cross foot (round), height 0.82; optionally a linen cloth, seeded tableware (plates, pewter mugs,
 * a terracotta jug, a loaf) and a candle with a small flame. Footprint: width × depth (round: a
 * circle of the width).
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {TableOptions} [opts]
 * @returns {PropResult}
 */
export function buildTable(f, x, y, z, opts = {}) {
  const rng = f.rng('table', x, z, opts.seed);
  const round = opts.shape === 'round';
  const W = num(opts.width, round ? 1.2 : 1.6, 0.6, 3.2);
  const D = round ? W : num(opts.depth, 0.9, 0.6, 2);
  const H = 0.82;
  const cloth = opts.cloth === true;
  const b = f.builder(groundAO(0.55));
  const R = W / 2;
  if (round) {
    b.lathe(FW, [{ y: H - 0.07, r: R - 0.03 }, { y: H - 0.03, r: R }, { y: H, r: R - 0.01 }], { segments: 18, smooth: true, capTop: FW, capBottom: TRIM, color: [0.92, 0.9, 0.9] });
    b.tube(TRIM, [0, 0.08, 0], [0, H - 0.07, 0], 0.075, 0.065, { segments: 8 });
    b.lathe(TRIM, [{ y: 0.3, r: 0.07 }, { y: 0.36, r: 0.11 }, { y: 0.42, r: 0.07 }], { segments: 8 });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const len = R * 0.8;
      b.box(TRIM, [len, 0.08, 0.1], { at: [Math.cos(a) * len / 2, 0.04, -Math.sin(a) * len / 2], rot: a, faces: { ny: false } });
      b.box(TRIM, [0.13, 0.05, 0.13], { at: [Math.cos(a) * len, 0.025, -Math.sin(a) * len], rot: a, faces: { ny: false } });
    }
  } else {
    const Uf = f.textures.meta(FW).units;
    b.box(FW, [W, 0.07, D], { at: [0, H - 0.035, 0], faces: { py: { off: [centerOff(W, Uf[0]), centerOff(D, Uf[1])] }, ny: TRIM, px: TRIM, nx: TRIM, pz: TRIM, nz: TRIM } });
    b.box(TRIM, [W - 0.22, 0.12, D - 0.22], { at: [0, H - 0.13, 0], faces: { py: false, ny: false } });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(TRIM, [0.09, H - 0.07, 0.09], { at: [sx * (W / 2 - 0.11), (H - 0.07) / 2, sz * (D / 2 - 0.11)], rotUV: true, faces: { ny: false, py: false } });
        b.box(TRIM, [0.12, 0.05, 0.12], { at: [sx * (W / 2 - 0.11), 0.025, sz * (D / 2 - 0.11)], faces: { ny: false } });
      }
    }
  }
  let top = H;
  if (cloth) {
    const cc = [1.0, 0.99, 0.96];
    if (round) {
      b.lathe('linen', [{ y: H - 0.24, r: R + 0.08 }, { y: H - 0.03, r: R + 0.03 }, { y: H + 0.012, r: R + 0.02 }], { segments: 18, smooth: true, capTop: 'linen', color: cc });
    } else {
      b.box('linen', [W + 0.04, 0.015, D + 0.04], { at: [0, H + 0.007, 0], faces: { ny: false }, color: cc });
      for (const sz of [-1, 1]) b.box('linen', [W + 0.04, 0.22, 0.015], { at: [0, H - 0.1, sz * (D / 2 + 0.0275)], faces: { py: false, ny: false }, color: cc });
      for (const sx of [-1, 1]) b.box('linen', [0.015, 0.22, D + 0.07], { at: [sx * (W / 2 + 0.0275), H - 0.1, 0], faces: { py: false, ny: false }, color: cc });
    }
    top = H + 0.015;
  }
  // tableware: seeded spots on the top, kept apart
  const spots = [];
  const free = (px, pz, r) => spots.every(([qx, qz, qr]) => Math.hypot(px - qx, pz - qz) > r + qr);
  const spot = (r) => {
    for (let t = 0; t < 10; t++) {
      let px;
      let pz;
      if (round) {
        const a = rng.range(0, TAU);
        const d = Math.sqrt(rng.next()) * Math.max(0, R - r - 0.08);
        px = Math.cos(a) * d; pz = Math.sin(a) * d;
      } else {
        px = rng.range(-W / 2 + r + 0.08, W / 2 - r - 0.08);
        pz = rng.range(-D / 2 + r + 0.08, D / 2 - r - 0.08);
      }
      if (free(px, pz, r)) { spots.push([px, pz, r]); return [px, pz]; }
    }
    return null;
  };
  const flames = [];
  let candle = null;
  if (opts.candle === true) {
    spots.push([0, 0, 0.1]);
    candle = candleGeom(b, 0, top, 0);
  }
  if (opts.items !== false) {
    const n = clamp(Math.round(W * D * 2.2), 2, 6);
    const kinds = ['plate', 'mug', 'plate', 'jug', 'mug', 'bread'];
    for (let i = 0; i < n; i++) {
      const k = kinds[(i + rng.int(0, 1)) % kinds.length];
      const at = spot(k === 'plate' ? 0.17 : k === 'bread' ? 0.17 : 0.1);
      if (!at) continue;
      if (k === 'plate') {
        plateGeom(b, at[0], top, at[1]);
        if (rng.chance(0.5)) breadGeom(b, at[0], top + 0.025, at[1], rng.range(0, TAU));
      } else if (k === 'mug') mugGeom(b, at[0], top, at[1], rng.range(0, TAU));
      else if (k === 'jug') jugGeom(b, at[0], top, at[1]);
      else breadGeom(b, at[0], top, at[1], rng.range(0, TAU));
    }
  }
  const group = f.finish(b, 'table', x, y, z, opts.rotation ?? 0);
  if (candle) {
    const fl = f.flame({ width: 0.14, height: 0.22, seed: rng.range(0, 100), glowSize: 3, glowIntensity: 0.45 });
    fl.object.position.copy(candle);
    group.add(fl.object);
    group.updateMatrixWorld(true);
    flames.push(fl);
  }
  return f.result(group, {
    colliders: round ? [{ type: 'circle', x, z, r: R + 0.02 }] : f.boxColliders(group, -W / 2, W / 2, -D / 2, D / 2),
    flames,
  });
}

// ---------------------------------------------------------------------------------------------
// Chair / stool
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildChair` / `PropFactory.chair`.
 * @typedef {object} ChairOptions
 * @property {'chair'|'stool'|string} [style] ('chair')
 * @property {number} [rotation] yaw (0: the seat faces +Z, the back to the north)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A wooden chair (seat 0.47 high, four legs with stretchers, a slatted back leaning back a little at
 * local −Z) or a round three-legged stool. Collider: a circle (0.27; stool 0.22).
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {ChairOptions} [opts]
 * @returns {PropResult}
 */
export function buildChair(f, x, y, z, opts = {}) {
  const rng = f.rng('chair', x, z, opts.seed);
  const stool = opts.style === 'stool';
  const b = f.builder(groundAO(0.45));
  if (stool) {
    const sh = 0.5;
    b.lathe(FW, [{ y: sh - 0.06, r: 0.18 }, { y: sh - 0.02, r: 0.2 }, { y: sh, r: 0.19 }], { segments: 10, smooth: true, capTop: FW, capBottom: TRIM });
    const a0 = rng.range(0, TAU);
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * TAU) / 3;
      b.tube(TRIM, [Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21], [Math.cos(a) * 0.11, sh - 0.05, Math.sin(a) * 0.11], 0.03, 0.028, { segments: 5 });
    }
    // a ring of stretchers
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * TAU) / 3;
      const a1 = a + TAU / 3;
      const r = 0.175;
      b.tube(TRIM, [Math.cos(a) * r, 0.2, Math.sin(a) * r], [Math.cos(a1) * r, 0.2, Math.sin(a1) * r], 0.016, 0.016, { segments: 4 });
    }
  } else {
    const sh = 0.47;
    const S = 0.46;
    const e = S / 2 - 0.04;
    b.box(FW, [S, 0.06, S], { at: [0, sh, 0] });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(TRIM, [0.06, sh - 0.03, 0.06], { at: [sx * e, (sh - 0.03) / 2, sz * e], rotUV: true, faces: { ny: false, py: false } });
      b.box(TRIM, [0.035, 0.035, S - 0.1], { at: [sx * e, 0.15, 0], faces: { ny: false } });
      // the back posts carry on up, leaning back
      b.box(TRIM, [0.06, 0.62, 0.06], { at: [sx * e, sh + 0.31, -e - 0.012], rot: [-0.08, 0, 0], rotUV: true, faces: { ny: false } });
    }
    b.box(TRIM, [S - 0.1, 0.035, 0.035], { at: [0, 0.22, e] });
    b.box(FW, [S - 0.02, 0.11, 0.045], { at: [0, sh + 0.55, -e - 0.04], rot: [-0.08, 0, 0] });
    b.box(FW, [S - 0.1, 0.07, 0.035], { at: [0, sh + 0.32, -e - 0.025], rot: [-0.08, 0, 0] });
  }
  const group = f.finish(b, stool ? 'stool' : 'chair', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: [{ type: 'circle', x, z, r: stool ? 0.22 : 0.27 }] });
}

// ---------------------------------------------------------------------------------------------
// Shelf (bookshelf / pantry)
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildShelf` / `PropFactory.shelf`.
 * @typedef {object} ShelfOptions
 * @property {'books'|'pantry'|string} [kind] ('books')
 * @property {number} [width] 0.8–3.2 (1.6)
 * @property {number} [height] 1.0–3.0 (2.2)
 * @property {number} [rotation] yaw (0: the back on a north wall)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A tall open shelf against a wall (depth 0.5): sides, a dark back, a cornice and a plinth, shelf
 * boards every 0.55 with one compartment of the `books` (book spines, lying stacks) or `pantry`
 * (jars, bottles, a crock, a sack, cheese) texture each, its seeded slice of the texture; a few
 * things on top. Footprint: width × 0.5.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {ShelfOptions} [opts]
 * @returns {PropResult}
 */
export function buildShelf(f, x, y, z, opts = {}) {
  const rng = f.rng('shelf', x, z, opts.seed);
  const pantry = opts.kind === 'pantry';
  const W = num(opts.width, 1.6, 0.8, 3.2);
  const H = num(opts.height, 2.2, 1.0, 3.0);
  const D = 0.5;
  const hw = W / 2;
  const hd = D / 2;
  const b = f.builder(groundAO(0.4));
  for (const sx of [-1, 1]) b.box(FW, [0.07, H - 0.07, D - 0.02], { at: [sx * (hw - 0.035), (H - 0.07) / 2, 0], rotUV: true, faces: { ny: false } });
  b.box(TRIM, [W + 0.08, 0.08, D + 0.04], { at: [0, H - 0.04, 0.01] });
  b.box(TRIM, [W - 0.02, 0.12, D - 0.04], { at: [0, 0.06, 0], faces: { ny: false } });
  b.box(TRIM, [W - 0.12, H - 0.18, 0.03], { at: [0, 0.12 + (H - 0.18) / 2, -hd + 0.03], faces: { ny: false, py: false }, color: [0.7, 0.66, 0.64] });
  // compartments: 0.5 high (the 8 px of the books / pantry texture) + 0.05 boards
  const tex = pantry ? 'pantry' : 'books';
  const inner = W - 0.14;
  const iw = inner / 2;
  const comp = 0.5;
  const board = 0.05;
  const zc = hd - 0.13;
  // as many compartments as fit; the space left over is shared out as headroom above the items
  const avail = H - 0.08 - 0.12;
  const nC = Math.max(1, Math.floor((avail + board + 1e-6) / (comp + board)));
  const cell = (avail - (nC - 1) * board) / nC;
  for (let i = 0; i < nC; i++) {
    const yb = 0.12 + i * (cell + board);
    const u0 = rng.int(0, 31) / 32;
    b.quad(tex, [[-iw, yb, zc], [iw, yb, zc], [iw, yb + comp, zc], [-iw, yb + comp, zc]],
      [[u0, 0], [u0 + inner / 2, 0], [u0 + inner / 2, 1], [u0, 1]]);
    if (i < nC - 1) b.box(FW, [inner, board, D - 0.05], { at: [0, yb + cell + board / 2, -0.01] });
  }
  // a few things on top (the camera looks down on them)
  const topY = H;
  if (pantry) {
    jugGeom(b, -hw * 0.5, topY, 0.02);
    b.box('burlap', [0.36, 0.16, 0.28], { at: [hw * 0.35, topY + 0.08, 0], rot: rng.range(-0.3, 0.3), faces: { ny: false } });
  } else {
    b.box('crate', [0.3, 0.2, 0.26], { at: [-hw * 0.45, topY + 0.1, 0], rot: rng.range(-0.25, 0.25), uv: 'fit', faces: { ny: false } });
    if (W >= 1.2) {
      // a lying stack of two books
      b.box(FW, [0.34, 0.06, 0.24], { at: [hw * 0.4, topY + 0.03, 0.02], rot: 0.15, color: [0.75, 0.4, 0.35] });
      b.box(FW, [0.3, 0.05, 0.22], { at: [hw * 0.4, topY + 0.085, 0.0], rot: -0.1, color: [0.45, 0.55, 0.85] });
    }
  }
  const group = f.finish(b, 'shelf', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: f.boxColliders(group, -hw, hw, -hd, hd) });
}

// ---------------------------------------------------------------------------------------------
// Hearth
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildHearth` / `PropFactory.hearth`.
 * @typedef {object} HearthOptions
 * @property {number} [width] 1.6–3.6 (2.2)
 * @property {number} [height] top of the chimney breast, 1.8–4.5 (2.6): match the wall height
 * @property {boolean} [lit] a fire: flame, glowing embers, a point light (true)
 * @property {boolean} [embers] sparks rising from a lit fire (true)
 * @property {boolean} [pot] an iron cooking pot hanging over the fire (false)
 * @property {number} [intensity] light intensity (10)
 * @property {number} [distance] light range (9)
 * @property {number} [rotation] yaw (0: the back on a north wall)
 * @property {number} [seed]
 * @property {string} [id]
 */

/** The embers' emissive look, day and night (one shared library material, so one descriptor). */
const EMBER_GLOW = Object.freeze({ day: 1.3, night: 1.9 });

/**
 * A stone fireplace against a wall, footprint width × 1.0: jambs and a lintel of chimney stone 0.7
 * deep around a sooty firebox, a hearthstone 0.3 in front, a mantel shelf at 1.6 with a few things
 * on it, the chimney breast up to `height`. Lit: logs on a bed of glowing embers (emissive
 * `{ day 1.3, night 1.9 }`), an animated flame, sparks, and one flickering point light that burns
 * day and night (priority 0 like a campfire). Unlit: cold ash, no light.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {HearthOptions} [opts]
 * @returns {PropResult}
 */
export function buildHearth(f, x, y, z, opts = {}) {
  const rng = f.rng('hearth', x, z, opts.seed);
  const W = num(opts.width, 2.2, 1.6, 3.6);
  const H = num(opts.height, 2.6, 1.8, 4.5);
  const lit = opts.lit !== false;
  const b = f.builder(groundAO(0.9));
  const zw = -0.5; // the wall
  const Db = 0.7; // body depth
  const zf = zw + Db; // the body's front
  const jw = Math.min(0.5, W * 0.22);
  const ow = W - 2 * jw; // the opening
  const oh = 1.2;
  const S = 'stone_brick';
  const soot = [0.42, 0.36, 0.34];
  const Us = f.textures.meta(S).units[0];
  // hearthstone (in front) and the firebox floor
  b.box('stone_brick', [W + 0.3, 0.1, 0.36], { at: [0, 0.05, zf + 0.12], faces: { ny: false }, off: [0.2, 0] });
  b.box('stone_brick', [ow, 0.1, Db - 0.16], { at: [0, 0.05, zw + 0.1 + (Db - 0.16) / 2], faces: { ny: false, pz: false }, color: soot });
  // jambs (their inner faces sooty), lintel, firebox back
  for (const sx of [-1, 1]) {
    const inner = sx < 0 ? 'px' : 'nx';
    b.box(S, [jw, oh, Db], { at: [sx * (W / 2 - jw / 2), oh / 2, zw + Db / 2], faces: { ny: false, py: false, nz: false, [inner]: { color: soot } }, off: [sx > 0 ? 0.37 : 0, 0] });
  }
  b.box(S, [W, 0.34, Db], { at: [0, oh + 0.17, zw + Db / 2], faces: { nz: false, ny: { color: [0.3, 0.26, 0.25] }, pz: { off: [centerOff(W, Us), 0.2] } } });
  b.box(S, [ow, oh, 0.1], { at: [0, oh / 2, zw + 0.05], faces: { nz: false, ny: false, py: false, px: false, nx: false }, color: [0.36, 0.3, 0.29] });
  // mantel shelf, chimney breast
  const my = oh + 0.34;
  b.box(TRIM, [W + 0.26, 0.1, Db + 0.16], { at: [0, my + 0.05, zw + (Db + 0.16) / 2] });
  b.box(TRIM, [W + 0.1, 0.06, Db + 0.06], { at: [0, my - 0.03, zw + (Db + 0.06) / 2], faces: { py: false } });
  const bw = W - 0.36;
  const bd = Db - 0.2;
  b.box(S, [bw, H - my - 0.1, bd], { at: [0, (H + my + 0.1) / 2, zw + bd / 2], faces: { ny: false, nz: false, pz: { off: [centerOff(bw, Us), 0.1] } } });
  b.box(S, [bw + 0.12, 0.12, bd + 0.06], { at: [0, my + 0.16, zw + (bd + 0.06) / 2], faces: { nz: false } });
  // things on the mantel, in front of the breast
  const mTop = my + 0.1;
  const mz = zw + bd + 0.17;
  candleGeom(b, -W / 2 + 0.28, mTop, mz, 0.16);
  if (W >= 2) candleGeom(b, -W / 2 + 0.5, mTop, mz + 0.02, 0.11);
  jugGeom(b, W / 2 - 0.32, mTop, mz);
  // the fire: logs on embers (or cold ash), fire dogs, an optional pot
  const fz = zw + 0.1 + (Db - 0.1) * 0.45;
  const embers = lit
    ? f.textures.material('embers', { vertexColors: true, emissiveIntensity: 0, emissive: new THREE.Color(0xff6a1e) })
    : f.extra.material('ash');
  b.box(embers, [ow - 0.08, 0.05, Db - 0.3], { at: [0, 0.125, fz], faces: { ny: false } });
  const logL = Math.min(ow * 0.72, 1.1);
  for (const [lz, ly, tw] of [[fz - 0.1, 0.2, 0.3], [fz + 0.09, 0.19, 1.2]]) {
    b.tube('bark', [-logL / 2, ly, lz], [logL / 2, ly + 0.02, lz + rng.range(-0.05, 0.05)], 0.075, 0.07, { segments: 6, capTop: embers, capBottom: embers, twist: tw, color: lit ? [0.55, 0.42, 0.4] : [0.4, 0.36, 0.36] });
  }
  b.tube('bark', [-0.15, 0.17, fz + 0.2], [0.12, 0.42, fz - 0.12], 0.06, 0.05, { segments: 6, capTop: embers, twist: 0.4, color: [0.5, 0.4, 0.38] });
  for (const sx of [-1, 1]) {
    const dx = sx * (ow / 2 - 0.16);
    b.box('metal', [0.05, 0.05, 0.42], { at: [dx, 0.16, fz], faces: { ny: false } });
    b.box('metal', [0.06, 0.22, 0.06], { at: [dx, 0.24, fz + 0.2] });
    b.box('metal', [0.09, 0.07, 0.09], { at: [dx, 0.38, fz + 0.2] });
  }
  if (opts.pot === true) {
    b.box('metal', [0.025, oh - 0.75, 0.025], { at: [0, oh - (oh - 0.75) / 2, fz - 0.06] });
    b.lathe('metal', [{ y: 0.5, r: 0.09 }, { y: 0.56, r: 0.16 }, { y: 0.7, r: 0.155 }, { y: 0.73, r: 0.13 }], { segments: 10, smooth: true, capBottom: 'metal', capTop: b.mat(TRIM), at: [0, 0, fz - 0.06], color: [0.62, 0.6, 0.62] });
    b.box('metal', [0.34, 0.025, 0.025], { at: [0, 0.77, fz - 0.06] });
  }
  const group = f.finish(b, 'hearth', x, y, z, opts.rotation ?? 0);
  const flames = [];
  const lights = [];
  const emitters = [];
  const emissives = [];
  if (lit) {
    const fl = f.flame({ width: Math.min(0.95, ow * 0.7), height: 0.95, seed: rng.range(0, 100), glowSize: 2.0, glowIntensity: 0.5 });
    fl.object.position.set(0, 0.14, fz - 0.02);
    group.add(fl.object);
    group.updateMatrixWorld(true);
    flames.push(fl);
    emissives.push({ material: embers, ...EMBER_GLOW });
    lights.push({ position: f.world(group, new THREE.Vector3(0, 0.75, zf + 0.35)), color: 0xff8a3a, intensity: opts.intensity ?? 10, distance: opts.distance ?? 9, flicker: 0.5, nightOnly: false });
    if (opts.embers !== false) emitters.push({ preset: 'embers', position: f.world(group, new THREE.Vector3(0, 0.55, fz)), rate: 3 });
  }
  return f.result(group, {
    colliders: f.boxColliders(group, -W / 2 - 0.15, W / 2 + 0.15, -0.5, 0.5),
    lights, emissives, emitters, flames,
  });
}

// ---------------------------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildCounter` / `PropFactory.counter`.
 * @typedef {object} CounterOptions
 * @property {'bar'|'shop'|string} [style] ('bar')
 * @property {number} [width] 1.2–6 (2.6)
 * @property {boolean} [items] bar: mugs, bottles and a keg on a cradle; shop: scales, a ledger,
 *   jars (true)
 * @property {number} [rotation] yaw (0: the customer side, the front, faces +Z)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A long counter, 0.7 deep and 1.05 high: a kick plinth, a panelled front (upright boards between
 * dark posts and rails) toward the customers (+Z), a planed top with a dark edge overhanging the
 * front; an inn bar's mugs, bottles and a keg on a cradle, or a shop's scales, ledger and jars.
 * Footprint: width × 0.76.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {CounterOptions} [opts]
 * @returns {PropResult}
 */
export function buildCounter(f, x, y, z, opts = {}) {
  const rng = f.rng('counter', x, z, opts.seed);
  const W = num(opts.width, 2.6, 1.2, 6);
  const shop = opts.style === 'shop';
  const D = 0.7;
  const H = 1.05;
  const hw = W / 2;
  const hd = D / 2;
  const b = f.builder(groundAO(0.5));
  b.box(TRIM, [W - 0.04, 0.12, D - 0.08], { at: [0, 0.06, -0.02], faces: { ny: false } });
  const Uf = f.textures.meta(FW).units[0];
  b.box(FW, [W - 0.06, H - 0.18, D - 0.12], { at: [0, 0.12 + (H - 0.18) / 2, -0.04], rotUV: true, faces: { ny: false, py: false } });
  const nP = Math.max(2, Math.round(W / 0.8) + 1);
  const fz = -0.04 + (D - 0.12) / 2 + 0.02;
  for (let i = 0; i < nP; i++) {
    const px = -hw + 0.07 + (i * (W - 0.14)) / (nP - 1);
    b.box(TRIM, [0.08, H - 0.22, 0.04], { at: [px, 0.12 + (H - 0.22) / 2, fz], rotUV: true, faces: { ny: false } });
  }
  b.box(TRIM, [W - 0.04, 0.07, 0.05], { at: [0, H - 0.13, fz] });
  b.box(TRIM, [W - 0.04, 0.05, 0.05], { at: [0, 0.16, fz] });
  b.box(FW, [W + 0.08, 0.07, D + 0.08], { at: [0, H - 0.035, 0.03], faces: { py: { off: [centerOff(W + 0.08, Uf), 0] }, ny: TRIM, px: TRIM, nx: TRIM, pz: TRIM, nz: TRIM } });
  if (opts.items !== false) {
    const top = H;
    if (shop) {
      // scales: a base, a post, a beam and two pans
      const sx = -hw * 0.45;
      b.box('metal', [0.3, 0.04, 0.16], { at: [sx, top + 0.02, -0.05] });
      b.box('metal', [0.04, 0.42, 0.04], { at: [sx, top + 0.23, -0.05] });
      b.box('metal', [0.56, 0.03, 0.03], { at: [sx, top + 0.44, -0.05], rot: [0, 0, 0.06] });
      for (const s of [-1, 1]) {
        b.box('metal', [0.012, 0.22, 0.012], { at: [sx + s * 0.26, top + 0.33 + s * 0.016, -0.05] });
        b.lathe('metal', [{ y: 0, r: 0.04 }, { y: 0.04, r: 0.13 }], { segments: 8, at: [sx + s * 0.26, top + 0.2 + s * 0.016, -0.05], capBottom: 'metal', color: [1.05, 0.85, 0.55] });
      }
      // a ledger, open
      b.box('linen', [0.36, 0.04, 0.26], { at: [hw * 0.05, top + 0.02, 0.05], rot: 0.12 });
      b.box(FW, [0.38, 0.02, 0.28], { at: [hw * 0.05, top + 0.005, 0.05], rot: 0.12, color: [0.8, 0.35, 0.3] });
      // jars of sweets / spice
      for (let i = 0; i < 2 + (W > 2.2 ? 1 : 0); i++) {
        const jx = hw * 0.4 + i * 0.24;
        if (jx > hw - 0.15) break;
        b.lathe('linen', [{ y: top, r: 0.08 }, { y: top + 0.2, r: 0.085 }, { y: top + 0.23, r: 0.06 }], { segments: 8, capTop: 'metal', at: [jx, 0, -0.1 + rng.range(-0.05, 0.05)], color: [[0.7, 0.95, 0.75], [1.05, 0.7, 0.5], [0.85, 0.75, 1.05]][i % 3] });
      }
    } else {
      // mugs along the front edge, bottles at the back, a keg on a cradle at one end
      const keg = W >= 1.8;
      const kx = keg ? hw - 0.38 : hw + 1;
      const n = Math.max(2, Math.floor((W - (keg ? 0.9 : 0.3)) / 0.45));
      for (let i = 0; i < n; i++) {
        const mx = -hw + 0.3 + i * 0.45 + rng.range(-0.06, 0.06);
        if (mx > kx - 0.4) break;
        mugGeom(b, mx, top, 0.12 + rng.range(-0.04, 0.04), rng.range(0, TAU));
      }
      for (let i = 0; i < 2; i++) {
        const bx = -hw + 0.4 + i * 0.22 + rng.range(-0.04, 0.04);
        b.lathe('metal', [{ y: top, r: 0.06 }, { y: top + 0.2, r: 0.06 }, { y: top + 0.26, r: 0.025 }, { y: top + 0.32, r: 0.022 }], { segments: 6, capTop: TRIM, at: [bx, 0, -0.16], color: [0.35, 0.6, 0.4] });
      }
      if (keg) {
        for (const s of [-1, 1]) b.box(TRIM, [0.06, 0.12, 0.4], { at: [kx + s * 0.18, top + 0.06, -0.02], faces: { ny: false } });
        b.push([kx, top + 0.27, -0.02], [0, 0, Math.PI / 2]);
        barrelGeom(b, 0, -0.27, 0, { h: 0.54, r: 0.24, yaw: rng.range(0, 6), bottom: true });
        b.pop();
        b.box('metal', [0.06, 0.06, 0.08], { at: [kx - 0.3, top + 0.24, -0.02] });
      }
    }
  }
  const group = f.finish(b, 'counter', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: f.boxColliders(group, -hw, hw, -hd, hd + 0.06) });
}

// ---------------------------------------------------------------------------------------------
// Rug
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildRug` / `PropFactory.rug`.
 * @typedef {object} RugOptions
 * @property {string} [color] one of RUGS ('red')
 * @property {number} [width] across x, 1–6 (2)
 * @property {number} [length] along z, 1–8 (3)
 * @property {boolean} [fringe] cream tassels at both ends (true)
 * @property {number} [rotation]
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A woven rug flat on the floor (0.025 thick): a diamond field (`rug_<colour>`) inside a woven
 * border band, cream tassels at the two short ends (local ±Z). No collider, casts no shadow.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {RugOptions} [opts]
 * @returns {PropResult}
 */
export function buildRug(f, x, y, z, opts = {}) {
  const rng = f.rng('rug', x, z, opts.seed);
  const W = num(opts.width, 2, 1, 6);
  const L = num(opts.length, 3, 1, 8);
  const flat = { userData: { castShadow: false } };
  const b = f.builder();
  const field = b.mat(`rug_${pick(RUGS, opts.color, 'red')}`, flat);
  const band = b.mat('rug_border', flat);
  const T = 0.025;
  const B = Math.min(0.375, W / 5, L / 5);
  const hw = W / 2;
  const hl = L / 2;
  b.box(field, [W - 2 * B, T, L - 2 * B], { at: [0, T / 2, 0], faces: { py: { off: [centerOff(W - 2 * B, 2), centerOff(L - 2 * B, 2)] }, ny: false, pz: false, nz: false, px: false, nx: false } });
  // the border band: canvas row 0 (v = 1) on the outer edge, row 5 (v = 0.25) inside
  const vIn = 1 - (B * 16) / 8;
  const top = (xa, xb, za, zb, uv) => b.quad(band, [[xa, T, zb], [xb, T, zb], [xb, T, za], [xa, T, za]], uv);
  top(-hw, hw, hl - B, hl, [[0, 1], [W, 1], [W, vIn], [0, vIn]]);
  top(-hw, hw, -hl, -hl + B, [[0, vIn], [W, vIn], [W, 1], [0, 1]]);
  b.quad(band, [[hw - B, T, hl - B], [hw, T, hl - B], [hw, T, -hl + B], [hw - B, T, -hl + B]], [[0, vIn], [0, 1], [L - 2 * B, 1], [L - 2 * B, vIn]]);
  b.quad(band, [[-hw, T, hl - B], [-hw + B, T, hl - B], [-hw + B, T, -hl + B], [-hw, T, -hl + B]], [[L - 2 * B, 1], [L - 2 * B, vIn], [0, vIn], [0, 1]]);
  // the rug's edges (the band's dark outer rows)
  b.box(band, [W, T, L], { at: [0, T / 2, 0], faces: { py: false, ny: false } });
  // tassels at both short ends: 1 px strands every 2 px
  if (opts.fringe !== false) {
    const lin = b.mat('linen', flat);
    for (const sz of [-1, 1]) {
      for (let px = -hw + 0.06; px < hw - 0.06; px += 0.125) {
        const len = 0.1 + rng.range(0, 0.05);
        const z0 = sz * hl;
        const z1 = sz * (hl + len);
        const pts = sz > 0
          ? [[px, 0.008, z1], [px + 0.0625, 0.008, z1], [px + 0.0625, 0.008, z0], [px, 0.008, z0]]
          : [[px, 0.008, z0], [px + 0.0625, 0.008, z0], [px + 0.0625, 0.008, z1], [px, 0.008, z1]];
        b.quad(lin, pts, [[0, 0], [0.06, 0], [0.06, len], [0, len]], { color: [0.98, 0.92, 0.8] });
      }
    }
  }
  const group = f.finish(b, 'rug', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: [] });
}

// ---------------------------------------------------------------------------------------------
// Staircase
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildStaircase` / `PropFactory.staircase`.
 * @typedef {object} StaircaseOptions
 * @property {'up'|'down'|string} [dir] ('up')
 * @property {number} [width] 0.8–2.4 (1.2): up — the flight's depth from the wall; down — the
 *   stairwell's width
 * @property {number} [steps] 3–14 (7; tread 0.4 up, 0.38 down)
 * @property {number} [height] up: the top step's height, 1–5 (2.5): match the wall height
 * @property {boolean} [flip] up: rises toward local −X instead of +X (false)
 * @property {boolean} [rail] a banister on the open side(s) (true)
 * @property {number} [rotation] yaw (up, 0: along a north wall; down, 0: the open end toward +Z)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * An interior staircase — a marker for a `use` exit (it is not walkable: its footprint is one
 * collider). **Up**: a solid flight of `steps` boarded steps along a wall, its back on local −Z,
 * rising toward local +X (`flip`: −X) to `height`, a banister on the open front side with a newel
 * post at the foot; footprint steps × 0.4 by width, the foot at local x = −run / 2 (flip: +run / 2).
 * **Down**: a stairwell in the floor, width × steps × 0.38: a framed opening whose steps fall away
 * from the open end (local +Z) into darkness, railed on the other three sides.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {StaircaseOptions} [opts]
 * @returns {PropResult}
 */
export function buildStaircase(f, x, y, z, opts = {}) {
  const rng = f.rng('staircase', x, z, opts.seed);
  const down = opts.dir === 'down';
  const W = num(opts.width, 1.2, 0.8, 2.4);
  const n = Math.round(num(opts.steps, 7, 3, 14));
  const rail = opts.rail !== false;
  const b = f.builder(groundAO(0.6));
  if (!down) {
    const Hs = num(opts.height, 2.5, 1, 5);
    const s = opts.flip === true ? -1 : 1;
    const T = 0.4;
    const L = n * T;
    const r = Hs / n;
    const hw = W / 2;
    for (let i = 0; i < n; i++) {
      const h = (i + 1) * r;
      const cx = s * (-L / 2 + (i + 0.5) * T);
      const left = Math.min(cx - T / 2, cx + T / 2) + L / 2;
      b.box(FW, [T, h, W], {
        at: [cx, h / 2, 0],
        faces: {
          ny: false, nz: false,
          pz: { off: [left, 0], color: [0.86, 0.82, 0.8] },
          py: { rotUV: true, off: [0, Math.round(rng.range(0, 32)) / 16] },
          px: s > 0 && i < n - 1 ? false : { color: [0.7, 0.66, 0.64] },
          nx: s < 0 && i < n - 1 ? false : { color: [0.7, 0.66, 0.64] },
        },
      });
      // the tread's nosing on its lower edge
      b.box(TRIM, [0.06, 0.05, W + 0.02], { at: [cx - s * (T / 2 - 0.02), h - 0.02, 0.01], faces: { ny: false } });
    }
    if (rail) {
      const postH = 0.95;
      // newel at the foot, a post at the top
      const footX = -s * L / 2 + s * 0.08;
      b.box(TRIM, [0.12, postH + r + 0.1, 0.12], { at: [footX, (postH + r + 0.1) / 2, hw - 0.06], rotUV: true, faces: { ny: false } });
      b.box(TRIM, [0.16, 0.06, 0.16], { at: [footX, postH + r + 0.13, hw - 0.06] });
      b.box(TRIM, [0.09, 0.09, 0.09], { at: [footX, postH + r + 0.2, hw - 0.06], rot: [0, Math.PI / 4, 0] });
      const topX = s * (L / 2 - 0.06);
      b.box(TRIM, [0.1, postH, 0.1], { at: [topX, Hs + postH / 2, hw - 0.06], rotUV: true });
      // balusters, one per step, and the hand rail
      for (let i = 1; i < n - 1; i++) {
        const cx = s * (-L / 2 + (i + 0.5) * T);
        const ty = (i + 1) * r;
        b.box(TRIM, [0.04, postH - 0.05, 0.04], { at: [cx, ty + (postH - 0.05) / 2, hw - 0.06], rotUV: true });
      }
      const y0 = postH + r + 0.05;
      const y1 = Hs + postH - 0.02;
      const x0 = footX;
      const x1 = topX;
      const rl = Math.hypot(x1 - x0, y1 - y0);
      b.box(TRIM, [rl, 0.07, 0.08], { at: [(x0 + x1) / 2, (y0 + y1) / 2, hw - 0.06], rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)] });
    }
    const group = f.finish(b, 'staircase', x, y, z, opts.rotation ?? 0);
    return f.result(group, { colliders: f.boxColliders(group, -L / 2, L / 2, -hw, hw + 0.04) });
  }
  // ---- down: a stairwell
  const Ld = n * 0.38;
  const hw = W / 2;
  const hl = Ld / 2;
  const dark = f.textures.material('stone_wall', { vertexColors: true });
  b.box(dark, [W, 0.01, Ld], { at: [0, 0.004, 0], faces: { ny: false, pz: false, nz: false, px: false, nx: false }, color: [0.05, 0.045, 0.05] });
  // receding treads (each shorter than the last), darker with depth, a riser shadow on each
  let wsum = 0;
  for (let k = 0; k < n; k++) wsum += 0.86 ** k;
  let zc = hl;
  for (let k = 0; k < n; k++) {
    const t = (Ld * 0.86 ** k) / wsum;
    const lum = 0.04 + 0.86 * (1 - k / n) ** 2;
    const tz = zc - t;
    b.box(FW, [W - 0.24, 0.012, t - 0.06], { at: [0, 0.012, zc - (t - 0.06) / 2], faces: { ny: false, pz: false, nz: false, px: false, nx: false, py: { rotUV: true, off: [0, Math.round(rng.range(0, 32)) / 16] } }, color: [lum, lum * 0.95, lum * 0.92] });
    // the riser's shadow under the next tread
    b.box(dark, [W - 0.24, 0.012, 0.06], { at: [0, 0.013, tz + 0.03], faces: { ny: false }, color: [lum * 0.2, lum * 0.18, lum * 0.2] });
    zc = tz;
  }
  // the well's side walls, darker with depth (their front ends catch the light)
  for (const sx of [-1, 1]) {
    b.quad(dark, sx < 0
      ? [[-hw, 0.016, hl], [-hw + 0.12, 0.016, hl], [-hw + 0.12, 0.016, -hl], [-hw, 0.016, -hl]]
      : [[hw - 0.12, 0.016, hl], [hw, 0.016, hl], [hw, 0.016, -hl], [hw - 0.12, 0.016, -hl]],
    [[0, 0], [0.12, 0], [0.12, Ld], [0, Ld]], { colors: [[0.3, 0.27, 0.27], [0.3, 0.27, 0.27], [0.03, 0.03, 0.035], [0.03, 0.03, 0.035]] });
  }
  // the frame on the floor
  b.box(TRIM, [W + 0.2, 0.07, 0.1], { at: [0, 0.035, -hl - 0.05], faces: { ny: false } });
  for (const sx of [-1, 1]) b.box(TRIM, [0.1, 0.07, Ld + 0.2], { at: [sx * (hw + 0.05), 0.035, 0], faces: { ny: false } });
  b.box(TRIM, [W, 0.05, 0.08], { at: [0, 0.025, hl + 0.04], faces: { ny: false } });
  if (rail) {
    const postH = 0.95;
    const posts = [[-hw - 0.05, -hl - 0.05], [hw + 0.05, -hl - 0.05], [-hw - 0.05, hl + 0.02], [hw + 0.05, hl + 0.02]];
    for (const [px, pz] of posts) {
      b.box(TRIM, [0.1, postH, 0.1], { at: [px, postH / 2, pz], rotUV: true, faces: { ny: false } });
      b.box(TRIM, [0.14, 0.05, 0.14], { at: [px, postH + 0.025, pz] });
    }
    b.box(TRIM, [W + 0.1, 0.06, 0.07], { at: [0, postH - 0.05, -hl - 0.05] });
    b.box(TRIM, [W + 0.1, 0.04, 0.05], { at: [0, postH * 0.5, -hl - 0.05] });
    for (const sx of [-1, 1]) {
      b.box(TRIM, [0.07, 0.06, Ld + 0.07], { at: [sx * (hw + 0.05), postH - 0.05, -0.015] });
      b.box(TRIM, [0.05, 0.04, Ld + 0.07], { at: [sx * (hw + 0.05), postH * 0.5, -0.015] });
    }
  }
  const group = f.finish(b, 'staircase', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: f.boxColliders(group, -hw - 0.1, hw + 0.1, -hl - 0.1, hl) });
}

// ---------------------------------------------------------------------------------------------
// Wardrobe / chest of drawers
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildWardrobe` / `PropFactory.wardrobe`.
 * @typedef {object} WardrobeOptions
 * @property {'wardrobe'|'drawers'|string} [kind] ('wardrobe')
 * @property {number} [width] 0.6–2.6 (1.4; a chest of drawers 1.2 when absent — a level object
 *   always has one: the catalog writes 1.4)
 * @property {number} [rotation] yaw (0: the back on a north wall)
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * A wardrobe (2.2 high, 0.6 deep: two panelled doors with knobs, a cornice) or a chest of drawers
 * (1.0 high, 0.5 deep: two small drawers over two wide ones, a candle or a jug and a folded cloth
 * on top). Footprint: width × depth.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {WardrobeOptions} [opts]
 * @returns {PropResult}
 */
export function buildWardrobe(f, x, y, z, opts = {}) {
  const rng = f.rng('wardrobe', x, z, opts.seed);
  const drawers = opts.kind === 'drawers';
  const W = num(opts.width, drawers ? 1.2 : 1.4, 0.6, 2.6);
  const D = drawers ? 0.5 : 0.6;
  const H = drawers ? 1.0 : 2.2;
  const hw = W / 2;
  const hd = D / 2;
  const b = f.builder(groundAO(0.5));
  const panel = [0.84, 0.8, 0.78];
  b.box(TRIM, [W, 0.1, D], { at: [0, 0.05, 0], faces: { ny: false } });
  b.box(FW, [W - 0.04, H - 0.18, D - 0.04], { at: [0, 0.1 + (H - 0.18) / 2, -0.02], rotUV: true, faces: { ny: false, py: false } });
  b.box(TRIM, [W + 0.1, 0.08, D + 0.06], { at: [0, H - 0.04, 0.01] });
  if (!drawers) {
    b.box(TRIM, [W + 0.03, 0.06, D + 0.02], { at: [0, H - 0.11, 0] });
    const dw = (W - 0.14) / 2;
    const dh = H - 0.42;
    const y0 = 0.16;
    for (const sx of [-1, 1]) {
      const cx = sx * (dw / 2 + 0.015);
      b.box(FW, [dw - 0.02, dh, 0.03], { at: [cx, y0 + dh / 2, hd - 0.025], rotUV: true, faces: { ny: false } });
      for (const yy of [y0 + 0.03, y0 + dh - 0.03, y0 + dh * 0.5]) b.box(TRIM, [dw - 0.02, 0.06, 0.02], { at: [cx, yy, hd - 0.005] });
      for (const ex of [-1, 1]) b.box(TRIM, [0.06, dh, 0.02], { at: [cx + ex * (dw / 2 - 0.04), y0 + dh / 2, hd - 0.005] });
      for (const py of [y0 + dh * 0.27, y0 + dh * 0.73]) b.box(FW, [dw - 0.2, dh * 0.38, 0.015], { at: [cx, py, hd - 0.003], rotUV: true, color: panel });
      b.box('metal', [0.04, 0.06, 0.04], { at: [sx * 0.06, y0 + dh * 0.5, hd + 0.02] });
    }
  } else {
    const rows = 3;
    const rh = (H - 0.22) / rows;
    for (let r = 0; r < rows; r++) {
      const cy = 0.12 + rh * (r + 0.5);
      const cols = r === rows - 1 ? 2 : 1;
      for (let c = 0; c < cols; c++) {
        const fw = (W - 0.1) / cols - (cols > 1 ? 0.02 : 0);
        const cx = cols === 1 ? 0 : (c - 0.5) * (fw + 0.02);
        b.box(FW, [fw, rh - 0.04, 0.035], { at: [cx, cy, hd - 0.01], faces: { ny: false } });
        b.box(TRIM, [fw, 0.025, 0.01], { at: [cx, cy - rh / 2 + 0.02, hd + 0.005] });
        for (const kx of cols === 1 ? [-fw * 0.28, fw * 0.28] : [0]) b.box('metal', [0.06, 0.035, 0.04], { at: [cx + kx, cy, hd + 0.025] });
      }
    }
    // on top: a candle or a jug, a folded cloth
    const top = H;
    if (rng.chance(0.5)) candleGeom(b, -hw * 0.5, top, 0);
    else jugGeom(b, -hw * 0.5, top, 0);
    b.box('linen', [0.34, 0.06, 0.26], { at: [hw * 0.35, top + 0.03, 0.02], rot: rng.range(-0.2, 0.2) });
    b.box('linen', [0.3, 0.05, 0.24], { at: [hw * 0.35, top + 0.085, 0.02], rot: rng.range(-0.2, 0.2), color: [0.6, 0.72, 1.0] });
  }
  const group = f.finish(b, drawers ? 'drawers' : 'wardrobe', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: f.boxColliders(group, -hw - 0.04, hw + 0.04, -hd, hd + 0.04) });
}

// ---------------------------------------------------------------------------------------------
// Wall window
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildWallWindow` / `PropFactory.wallWindow`.
 * @typedef {object} WallWindowOptions
 * @property {number} [panes] casements side by side, 1 unit wide each, 1–3 (1)
 * @property {number} [sill] sill height above the floor, 0.3–2 (0.9)
 * @property {'daylight'|'warm'|string} [glow] ('daylight')
 * @property {'red'|'linen'|'none'|string} [curtains] ('red')
 * @property {boolean} [beam] a shaft of light falling into the room by day (true)
 * @property {boolean} [flowers] a flower box on the sill (false)
 * @property {number} [rotation] yaw: local +Z points into the room (0: on a north wall)
 * @property {string} [id]
 */

/**
 * The emissive looks of an inside window by `glow` (one shared material each, so one descriptor):
 * daylight — pale sky light, bright by day, a faint blue at night; warm — golden, glowing day and
 * night. `beam`: the light shaft's (day only).
 */
const WINDOW_GLOW = Object.freeze({
  daylight: { color: 0xdcecff, day: 1.15, night: 0.03, beam: 0.32, beamColor: 0xfff2d8 },
  warm: { color: 0xffc070, day: 0.95, night: 1.1, beam: 0.36, beamColor: 0xffc883 },
});

/**
 * A window in a room's wall, seen from inside: `panes` casements of sky (`window_inside`, emissive)
 * in a dark frame with a deep sill, curtains on a rod, optionally a flower box on the sill and —
 * by day — a soft shaft of light falling from it onto the floor (additive, emissive only, no
 * shadow). (x, y, z): the wall face at floor height; local +Z points into the room. No collider
 * (the wall's keeps the player away), no point light.
 * @param {PropFactory} f
 * @param {number} x @param {number} y floor height in front of the wall
 * @param {number} z
 * @param {WallWindowOptions} [opts]
 * @returns {PropResult}
 */
export function buildWallWindow(f, x, y, z, opts = {}) {
  const n = Math.round(num(opts.panes, 1, 1, 3));
  const sill = num(opts.sill, 0.9, 0.3, 2);
  const glowName = pick(['daylight', 'warm'], opts.glow, 'daylight');
  const glow = WINDOW_GLOW[glowName];
  const curtains = pick(['red', 'linen', 'none'], opts.curtains, 'red');
  const Wp = n;
  const Hp = 1.5;
  const hw = Wp / 2;
  const top = sill + Hp;
  const b = f.builder();
  const pane = f.textures.material('window_inside', { vertexColors: true, emissiveIntensity: 0, emissive: new THREE.Color(glow.color) });
  b.quad(pane, [[-hw, sill, 0.012], [hw, sill, 0.012], [hw, top, 0.012], [-hw, top, 0.012]], [[0, 0], [n, 0], [n, 1], [0, 1]]);
  // frame: casing, head, a deep sill on an apron
  for (const sx of [-1, 1]) b.box(TRIM, [0.12, Hp + 0.12, 0.1], { at: [sx * (hw + 0.06), sill + Hp / 2 + 0.02, 0.05], rotUV: true, faces: { nz: false } });
  b.box(TRIM, [Wp + 0.4, 0.16, 0.14], { at: [0, top + 0.08, 0.07], faces: { nz: false } });
  b.box(TRIM, [Wp + 0.44, 0.07, 0.26], { at: [0, sill - 0.035, 0.13], faces: { nz: false } });
  b.box(TRIM, [Wp + 0.2, 0.14, 0.04], { at: [0, sill - 0.14, 0.02], faces: { nz: false } });
  if (opts.flowers === true) flowerBoxGeom(b, 0, sill, 0.25, Math.min(Wp * 0.8, Wp - 0.1), 0.2, 0.3);
  if (curtains !== 'none') {
    const cloth = curtains === 'red' ? 'cloth_red' : 'linen';
    const tint = curtains === 'red' ? [1, 1, 1] : [1.0, 0.97, 0.9];
    b.box('metal', [Wp + 0.9, 0.035, 0.035], { at: [0, top + 0.26, 0.2] });
    for (const sx of [-1, 1]) b.box('metal', [0.06, 0.06, 0.06], { at: [sx * (hw + 0.47), top + 0.26, 0.2] });
    const cy0 = sill - 0.25;
    const cy1 = top + 0.24;
    for (const sx of [-1, 1]) {
      for (const [dx, dz, w] of [[0.16, 0.2, 0.18], [0.32, 0.17, 0.16]]) {
        b.box(cloth, [w, cy1 - cy0, 0.035], { at: [sx * (hw + dx), (cy0 + cy1) / 2, dz], faces: { nz: false }, off: [dx * 3, 0], color: tint });
      }
      // a tie-back band
      b.box(cloth, [0.36, 0.06, 0.07], { at: [sx * (hw + 0.24), sill + 0.35, 0.19], color: [0.75, 0.62, 0.45] });
    }
  }
  const emissives = [{ material: pane, day: glow.day, night: glow.night }];
  if (opts.beam !== false) {
    const beam = f.textures.material('light_beam', {
      vertexColors: true, color: 0x000000, emissive: new THREE.Color(glow.beamColor), emissiveIntensity: 0,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      userData: { castShadow: false, receiveShadow: false },
    });
    // two sheets (from the top and the bottom of the opening down to the floor) and the lit patch
    const d = 1; // horizontal run per unit of drop (a 45° sun)
    const zt = top * d;
    const zb = sill * d;
    const fy = 0.02;
    const sheet = (y0, z1) => b.quad(beam, [[-hw, fy, z1], [hw, fy, z1], [hw, y0, 0.03], [-hw, y0, 0.03]], [[0, 0.25], [1, 0.25], [1, 1], [0, 1]]);
    sheet(top - 0.05, zt);
    sheet(sill + 0.05, zb);
    b.quad(beam, [[-hw, fy, zt], [hw, fy, zt], [hw, fy, zb], [-hw, fy, zb]], [[0, 0], [1, 0], [1, 0.25], [0, 0.25]]);
    emissives.push({ material: beam, day: glow.beam, night: 0 });
  }
  const group = f.finish(b, 'wallWindow', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: [], emissives });
}

// ---------------------------------------------------------------------------------------------
// Grain sacks
// ---------------------------------------------------------------------------------------------

/**
 * Options of `buildSacks` / `PropFactory.sacks`.
 * @typedef {object} SacksOptions
 * @property {number} [count] 1–4 (3): a row of up to three standing sacks, the fourth lying on top
 * @property {number} [rotation]
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * Burlap grain / flour sacks, tied at the neck: a row of up to three standing sacks (0.52 apart)
 * and, with four, one lying across their shoulders. Footprint: (min(count, 3) × 0.52 + 0.1) × 0.66.
 * @param {PropFactory} f
 * @param {number} x @param {number} y @param {number} z
 * @param {SacksOptions} [opts]
 * @returns {PropResult}
 */
export function buildSacks(f, x, y, z, opts = {}) {
  const rng = f.rng('sacks', x, z, opts.seed);
  const count = Math.round(num(opts.count, 3, 1, 4));
  const nb = Math.min(count, 3);
  const b = f.builder(groundAO(0.5));
  const sack = (lumpy) => {
    const jag = Array.from({ length: 10 }, () => rng.range(0.95, 1.04));
    b.lathe('burlap', [{ y: 0, r: 0.2 }, { y: 0.06, r: 0.26 }, { y: 0.3, r: 0.28 }, { y: 0.52, r: 0.24 }, { y: 0.62, r: 0.14 }, { y: 0.67, r: 0.07 }],
      { segments: 10, smooth: true, uRepeat: 2, phase: rng.range(0, 1), radiusFn: (i, j) => (lumpy && i > 0 && i < 4 ? jag[j] : 1) });
    b.tube('rope', [0, 0.65, 0], [0, 0.71, 0], 0.06, 0.06, { segments: 6 });
    b.lathe('burlap', [{ y: 0.7, r: 0.04 }, { y: 0.78, r: 0.09 }, { y: 0.8, r: 0.05 }], { segments: 7, smooth: true, uRepeat: 1 });
  };
  for (let i = 0; i < nb; i++) {
    const sx = (i - (nb - 1) / 2) * 0.52 + rng.range(-0.03, 0.03);
    b.push([sx, 0, rng.range(-0.04, 0.04)], rng.range(-0.5, 0.5), [1, rng.range(0.92, 1.05), 0.72]);
    sack(true);
    b.pop();
  }
  if (count >= 4) {
    b.push([rng.range(-0.08, 0.08), 0.7, 0.02], [0, rng.range(-0.25, 0.25), Math.PI / 2 - 0.05], [0.8, 1.0, 0.75]);
    b.push([0, -0.38, 0]);
    sack(false);
    b.pop();
    b.pop();
  }
  const group = f.finish(b, 'sacks', x, y, z, opts.rotation ?? 0);
  const hw = (nb * 0.52 + 0.1) / 2;
  return f.result(group, { colliders: f.boxColliders(group, -hw, hw, -0.33, 0.33) });
}
