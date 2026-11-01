import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../../utils/math.js';
import { isOwnKey } from '../../utils/own.js';
import { rockGeom, STONE_TEXTURES } from './SmallProps.js';
import { thawField } from '../ThawField.js';

/**
 * @import { PropFactory, PropResult } from '../Props.js'
 * @import { Collider } from '../TileMap.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 */

/**
 * Crags.js — the `crag` set piece of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.2; docs/design/ARID_LOOK.md §6): spires, mesas, arches, pillars, boulder piles and
 * hoodoos of sandstone, red rock or basalt. `PropFactory.crag` calls `buildCrag`. Owner: the arid
 * package.
 *
 * A crag is built like the rock it is: a stack of strata. Each stratum is a slab — an irregular
 * polygon (one outline shared by the whole stack, so the body reads as one mass, each slab a little
 * wider or narrower) extruded half a unit or a whole one; a hard stratum juts out as a ledge, a
 * soft one is worn back. The walls wear the stone's cliff texture (`sandstone_cliff`,
 * `redrock_cliff`, `basalt_cliff`) with v = the world height, so the painted strata line up with
 * the geometric ones (both change at multiples of LEVEL_HEIGHT when the crag stands on a whole
 * level), the ledges and the top its top texture (`sandstone`, `redrock`, `basalt`). Flat-shaded
 * facets, a darker band under each overhang, ground occlusion at the foot; every part casts
 * shadows. An arch is one extruded profile (the legs and the span, the opening walkable), boulders
 * are faceted lumps (SmallProps `rockGeom`) in the same stones.
 *
 * Colliders follow the footprint: circles over the base slab's outline (several along a long mesa),
 * one per leg of an arch, one per boulder. Options are level data: numbers clamped, kinds and stones
 * looked up (an unknown one: the default); randomness from `f.rng('crag', x, z, opts.seed)` only.
 *
 * The Bells of Evermere's stone `ice` (EVERMERE_CAMPAIGN.md §5.3, §6.3; owner: the architecture
 * package — the rest of this file is the arid package's and builds as before): the citadel's
 * spires, walls and arches in painted ice (`ice_crag`: vertical fracture planes, internal light
 * streaks, deep teal → pale cyan, a lit left rim; its tops `ice_crag_top`, dusted with snow; both
 * in pixel/textures/evermereProps.js), glowing ≈ 0.15 (cyan) with brighter heart veins. An ice
 * spire is fewer, taller facets with small ledges and a sharp tip; every ice crag has a few
 * crystals at its foot. Built from the season kit (src/engine/world/SeasonKitParts.js) — an
 * Evermere level downloads no set-piece chunk for it — and from the set-piece kit as before for
 * the other stones. `buildSeasonRock` builds a `rock` of the stones `ice` (an angular ice boulder)
 * and `snow` (a soft drift: no collider, no shadow, a dynamic child that melts into the ground
 * where the thaw field thaws and builds up again if the frost returns).
 */

/** Ground occlusion: the foot of the rock darker, fading out over `h` units. */
const groundAO = (h = 0.5, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);
/** A number option (anything else: the default), clamped. */
const num = (v, d, lo, hi) => clamp(Number.isFinite(v) ? v : d, lo, hi);

const KINDS = ['spire', 'mesa', 'arch', 'pillar', 'boulders', 'hoodoo'];

/**
 * A slab of a stack: from y0 to y1 (local), its centre and half extents, the wall's radius scale
 * at the top relative to the bottom (`taper`), whether it is a hard ledge-forming stratum.
 * @typedef {{ y0: number, y1: number, cx: number, cz: number, rx: number, rz: number, taper?: number,
 *   cap?: boolean, under?: boolean, dark?: number }} Slab
 */

/**
 * Emit a stack of slabs sharing one outline (`J`: a radial scale per outline vertex) into `b`:
 * the walls of every slab (v = world height / the texture's repeat), each slab's top cap (the part
 * not under the next slab shows as a ledge), an underside where a slab is marked `under` (a hoodoo's
 * cap, an overhang seen from below). Walls under a wider slab get a shaded band at their top.
 * @param {MeshBuilder} b
 * @param {{ top: string, side: string }} S
 * @param {Slab[]} slabs bottom → top
 * @param {number[]} J
 * @param {number} baseY the ground height (world) of the stack's local y 0
 * @param {() => number} rnd a seeded random number in [0, 1)
 */
function slabStack(b, S, slabs, J, baseY, rnd) {
  const n = J.length;
  const sideMat = b.mat(S.side);
  const topMat = b.mat(S.top);
  const su = b.units(sideMat);
  const tu = b.units(topMat);
  for (let si = 0; si < slabs.length; si++) {
    const s = slabs[si];
    const above = slabs[si + 1];
    const taper = s.taper ?? 1;
    // per-vertex wobble of this slab around the shared outline (vertical continuity)
    const jw = J.map((j) => j * (1 + (rnd() - 0.5) * 0.08));
    const ring = (y, k) => jw.map((j, v) => {
      const a = (v / n) * Math.PI * 2;
      return [s.cx + Math.cos(a) * s.rx * j * k, y, s.cz + Math.sin(a) * s.rz * j * k];
    });
    const lo = ring(s.y0, 1);
    const hi = ring(s.y1, taper);
    // a wider slab above throws its shade on this one's top band
    const shaded = above && above.rx > s.rx * taper * 1.02;
    const dark = s.dark ?? 1;
    let u = 0;
    for (let v = 0; v < n; v++) {
      const w = (v + 1) % n;
      const A = lo[v], B = lo[w], C = hi[w], D = hi[v];
      const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
      const k = (0.9 + 0.14 * rnd()) * dark;
      const kt = k * (shaded ? 0.72 : 1);
      // [A, D, C, B]: counter-clockwise seen from outside (the normal points out)
      b.quad(sideMat, [A, D, C, B],
        [[u / su[0], (baseY + s.y0) / su[1]], [u / su[0], (baseY + s.y1) / su[1]], [(u + len) / su[0], (baseY + s.y1) / su[1]], [(u + len) / su[0], (baseY + s.y0) / su[1]]],
        { colors: [[k, k, k], [kt, kt, kt], [kt, kt, kt], [k, k, k]] });
      u += len;
    }
    // the top cap (a fan); hidden inside the next slab where that one covers it
    if (s.cap !== false) {
      const c = [s.cx, s.y1, s.cz];
      const uvTop = (p) => [p[0] / tu[0], -p[2] / tu[1]];
      const kc = 1.06 * dark;
      for (let v = 0; v < n; v++) {
        const w = (v + 1) % n;
        b.tri(topMat, c, hi[w], hi[v], uvTop(c), uvTop(hi[w]), uvTop(hi[v]), { normal: [0, 1, 0], color: [kc, kc, kc] });
      }
    }
    if (s.under) {
      const c = [s.cx, s.y0, s.cz];
      const uvB = (p) => [p[0] / tu[0], p[2] / tu[1]];
      for (let v = 0; v < n; v++) {
        const w = (v + 1) % n;
        b.tri(topMat, c, lo[v], lo[w], uvB(c), uvB(lo[v]), uvB(lo[w]), { normal: [0, -1, 0], color: [0.55, 0.55, 0.55] });
      }
    }
  }
}

/** A closed outline of `n` radial scales: smoothed noise around 1 (± `rough`). */
function outline(rng, n, rough) {
  const raw = Array.from({ length: n }, () => 1 + rng.range(-rough, rough));
  return raw.map((v, i) => (raw[(i + n - 1) % n] + v * 2 + raw[(i + 1) % n]) / 4);
}

/** `count` deep notches cut into an outline (a vertex pulled in): fissures down the rock's side. */
function notched(rng, J, count) {
  const out = J.slice();
  for (let k = 0; k < count; k++) out[rng.int(0, out.length - 1)] *= rng.range(0.62, 0.75);
  return out;
}

/**
 * Strata heights from the ground to `H`: half-unit or whole-unit slabs (LEVEL_HEIGHT steps), the
 * last one taking what is left.
 * @returns {number[]} the slab boundaries, 0 … H
 */
function strata(rng, H, { thin = 0.45, unit = 1 } = {}) {
  const out = [0];
  let y = 0;
  while (y < H - 0.01) {
    // (`unit`: the ice's tall crystal facets; the rock strata keep 1)
    const t = rng.chance(thin) ? 0.5 * unit : unit;
    y = Math.min(H, y + t);
    if (H - y < 0.3) y = H;
    out.push(y);
  }
  return out;
}

/**
 * A crag.
 * @param {PropFactory} f
 * @param {number} x @param {number} y ground height @param {number} z
 * @param {{ kind?: string, stone?: string, height?: number, width?: number, seed?: number,
 *   rotation?: number, id?: string }} [opts] kind ('spire'), stone ('sandstone'), height (6, 1–24),
 *   width (2.5, 0.8–14: the base's diameter, an arch's span, a pile's spread), rotation, seed
 * @returns {PropResult}
 */
export function buildCrag(f, x, y, z, opts = {}) {
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'spire';
  const ice = opts.stone === 'ice';
  const S = ice ? iceStone(f) : STONE_TEXTURES[isOwnKey(STONE_TEXTURES, opts.stone) ? opts.stone : 'sandstone'];
  const H = num(opts.height, 6, 1, 24);
  const W = num(opts.width, 2.5, 0.8, 14);
  const rng = f.rng('crag', x, z, opts.seed);
  const rnd = () => rng.next();
  const b = f.builder(groundAO(clamp(H * 0.25, 0.5, 2.2), 0.66));
  /** @type {[number, number, number][]} local colliders: x, z, r */
  const circles = [];
  switch (kind) {
    case 'mesa': {
      // a flat-topped table of stone, vertical walls broken by ledges, a talus apron at the foot,
      // now and then a smaller butte standing on top
      const n = clamp(Math.round(8 + W * 0.9), 9, 18);
      const J = outline(rng, n, 0.16);
      const aspect = rng.range(0.72, 1);
      const R = W / 2;
      const ys = strata(rng, H, ice ? { thin: 0.35, unit: 2 } : { thin: 0.35 });
      /** @type {Slab[]} */
      const slabs = [{ y0: -0.2, y1: Math.min(0.5, H * 0.2), cx: 0, cz: 0, rx: R * 1.12, rz: R * 1.12 * aspect, taper: 0.93 }];
      for (let k = 0; k < ys.length - 1; k++) {
        if (ys[k + 1] <= slabs[0].y1) continue;
        const hard = rng.chance(0.4);
        const r = R * (hard ? 1.02 : rng.range(0.9, 0.97)) * (1 - 0.06 * (ys[k] / H));
        slabs.push({ y0: Math.max(ys[k], slabs[0].y1), y1: ys[k + 1], cx: 0, cz: 0, rx: r, rz: r * aspect, taper: hard ? 1 : 0.97 });
      }
      if (H > 3 && W > 4 && rng.chance(0.45)) {
        // a butte on the table, off centre
        const br = R * rng.range(0.32, 0.45);
        const bx = rng.range(-0.25, 0.25) * R;
        const bz = rng.range(-0.25, 0.25) * R * aspect;
        const bh = clamp(H * rng.range(0.25, 0.4), 1, 4);
        let yy = H;
        for (const t of strata(rng, bh)) if (t > 0) { slabs.push({ y0: yy, y1: H + t, cx: bx, cz: bz, rx: br * (1 - 0.1 * (t / bh)), rz: br * aspect * (1 - 0.1 * (t / bh)), taper: 0.97 }); yy = H + t; }
      }
      slabStack(b, S, slabs, J, y, rnd);
      // colliders: circles of the short half-axis along the long one (x), one when round
      const rz = R * aspect;
      const span = R - rz;
      const m = span > 0.25 ? Math.max(2, Math.ceil(span / Math.max(0.5, rz * 0.8)) + 1) : 1;
      for (let k = 0; k < m; k++) circles.push([m === 1 ? 0 : -span + (2 * span * k) / (m - 1), 0, rz * 1.1]);
      // talus: a few fallen blocks at the foot
      const nt = rng.int(2, 4);
      for (let k = 0; k < nt; k++) {
        const a = rng.range(0, Math.PI * 2);
        const s = rng.range(0.28, 0.5) * Math.min(1.6, W / 4);
        rockGeom(b, Math.cos(a) * R * 1.12, 0, Math.sin(a) * R * 1.12 * aspect, [s, s * 0.7, s * 0.9], rng, { top: S.top, side: S.side, detail: 0, yaw: a });
      }
      break;
    }
    case 'arch': {
      buildArch(b, S, W, H, y, rng, circles);
      break;
    }
    case 'boulders': {
      // a pile: one big block, a few leaning on it, small ones around
      const n = rng.int(4, 6);
      const R = W / 2;
      for (let i = 0; i < n; i++) {
        const big = i === 0;
        const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const d = big ? rng.range(0, 0.15) * R : R * rng.range(0.45, 0.7);
        const r = (big ? 0.5 : rng.range(0.24, 0.36)) * W * 0.6;
        const h = Math.min(big ? H * 0.95 : H * rng.range(0.35, 0.6), r * 2.4);
        const cx = Math.cos(a) * d;
        const cz = Math.sin(a) * d;
        rockGeom(b, cx, big ? 0 : rng.range(0, 0.15), cz, [r, h / 1.22, r * rng.range(0.8, 1)], rng, { top: S.top, side: S.side, detail: 1, yaw: rng.range(0, 6.28), flatTop: rng.range(0.1, 0.3), rough: 0.25 });
        circles.push([cx, cz, r * 0.92]);
      }
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        const s = rng.range(0.12, 0.22) * Math.min(2, W / 2.5);
        rockGeom(b, Math.cos(a) * R * 1.05, 0, Math.sin(a) * R * 1.05, [s, s * 0.7, s * 0.9], rng, { top: S.top, side: S.side, detail: 0 });
      }
      break;
    }
    case 'hoodoo': {
      // a stem of soft stone, flared at the foot and worn into a wavy waist, under a wide, darker
      // cap of hard stone that overhangs it on every side
      const J = notched(rng, outline(rng, 9, 0.2), 1);
      const capH = clamp(H * 0.16, 0.5, 1.6);
      const stemH = H - capH;
      const ys = strata(rng, stemH, { thin: 0.75 });
      /** @type {Slab[]} */
      const slabs = [];
      const r0 = W * 0.27;
      const freq = rng.range(2.2, 3.4);
      const ph = rng.range(0, 6.28);
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < ys.length - 1; k++) {
        const t = ys[k] / stemH;
        const wave = 1 + 0.16 * Math.sin(t * Math.PI * freq + ph);
        const flare = 1 + 0.45 * Math.pow(1 - t, 4);
        const r = r0 * lerp(1.05, 0.62, t) * wave * flare;
        slabs.push({ y0: k === 0 ? -0.2 : ys[k], y1: ys[k + 1], cx, cz, rx: r, rz: r * rng.range(0.88, 1), taper: 0.95 });
        cx += rng.range(-0.05, 0.05) * r0;
        cz += rng.range(-0.05, 0.05) * r0;
      }
      // the cap: two slabs, its own rougher outline (it is another stone), an underside
      const capR = W * rng.range(0.4, 0.5);
      const capJ = outline(rng, 9, 0.24);
      const ox = cx + rng.range(-0.1, 0.1) * capR;
      const oz = cz + rng.range(-0.1, 0.1) * capR;
      slabStack(b, S, slabs, J, y, rnd);
      slabStack(b, S, [
        { y0: stemH, y1: stemH + capH * 0.55, cx: ox, cz: oz, rx: capR, rz: capR * rng.range(0.82, 1), taper: 1.02, under: true, dark: 0.78 },
        { y0: stemH + capH * 0.55, y1: H, cx: ox + rng.range(-0.08, 0.08), cz: oz, rx: capR * 0.92, rz: capR * 0.8, taper: 0.8, dark: 0.82 },
      ], capJ, y, rnd);
      circles.push([0, 0, r0 * 1.25]);
      break;
    }
    case 'pillar': {
      // a column with straight walls, a few ledges, a flat top; of basalt a hexagonal prism (the
      // stone's columnar jointing)
      const hex = S.side === 'basalt_cliff';
      const n = hex ? 6 : 10;
      const J = outline(rng, n, hex ? 0.04 : 0.12);
      const ys = strata(rng, H, ice ? { thin: 0.4, unit: 2 } : { thin: 0.4 });
      const R = W * 0.42;
      /** @type {Slab[]} */
      const slabs = ys.slice(0, -1).map((y0, k) => {
        const hard = rng.chance(0.35);
        const r = R * (hard ? 1.04 : rng.range(0.92, 0.98)) * (1 - 0.08 * (y0 / H));
        return { y0, y1: ys[k + 1], cx: 0, cz: 0, rx: r, rz: r, taper: hard ? 1 : 0.97 };
      });
      slabs[0].y0 = -0.2;
      slabStack(b, S, slabs, J, y, rnd);
      circles.push([0, 0, R * 1.0]);
      break;
    }
    default: {
      // spire: a tapering tower of strata — its axis wandering, hard ledges jutting out every few
      // strata over softer recessed ones, one or two deep fissures down its side, its waist
      // bulging and narrowing — topped by a broken, leaning tip
      const n = ice ? clamp(Math.round(5 + W * 0.5), 6, 8) : clamp(Math.round(7 + W), 8, 12);
      const J = notched(rng, outline(rng, n, ice ? 0.3 : 0.24), rng.int(1, 2));
      const ys = strata(rng, H, ice ? { thin: 0.15, unit: 2.4 } : { thin: 0.55 });
      const R = W / 2;
      const lean = [rng.range(-0.05, 0.05), rng.range(-0.05, 0.05)];
      const freq = rng.range(1.5, 2.6);
      const ph = rng.range(0, 6.28);
      /** @type {Slab[]} */
      const slabs = [];
      let cx = 0;
      let cz = 0;
      let next = rng.int(1, 3);
      for (let k = 0; k < ys.length - 1; k++) {
        const t = ys[k] / H;
        const hard = k === next;
        if (hard) next += rng.int(2, 4);
        const r = R * Math.pow(1 - (ice ? 0.8 : 0.74) * t, ice ? 1.1 : 0.85) * (1 + 0.1 * Math.sin(t * Math.PI * freq + ph)) * (hard ? (ice ? 1.04 : 1.1) : rng.range(0.9, 0.97));
        slabs.push({ y0: k === 0 ? -0.2 : ys[k], y1: ys[k + 1], cx, cz, rx: r, rz: r * rng.range(0.86, 1), taper: hard ? 0.97 : ice ? 0.84 : 0.92 });
        cx += (lean[0] + rng.range(-0.04, 0.04)) * Math.min(1, ys[k + 1] - ys[k]) * R;
        cz += (lean[1] + rng.range(-0.04, 0.04)) * Math.min(1, ys[k + 1] - ys[k]) * R;
      }
      // the broken tip: a small block leaning off the top, a chip beside it
      const last = slabs[slabs.length - 1];
      const tipH = ice ? clamp(H * 0.22, 0.8, 3.2) : clamp(H * 0.1, 0.4, 1.2);
      slabs.push({ y0: H, y1: H + tipH, cx: last.cx + rng.range(-0.15, 0.15) * R, cz: last.cz + rng.range(-0.15, 0.15) * R, rx: last.rx * (ice ? 0.9 : 0.62), rz: last.rz * (ice ? 0.8 : 0.5), taper: ice ? 0.08 : 0.5 });
      slabStack(b, S, slabs, J, y, rnd);
      const chipA = rng.range(0, 6.28);
      const cr = last.rx * 0.3;
      rockGeom(b, last.cx + Math.cos(chipA) * last.rx * 0.6, H - 0.05, last.cz + Math.sin(chipA) * last.rx * 0.6, [cr, cr * 0.8, cr * 0.9], rng, { top: S.top, side: S.side, detail: 0, sink: 0.1 });
      circles.push([0, 0, R * 0.95]);
    }
  }
  // (an arch's feet have their fallen blocks; its opening stays clear)
  if (ice && kind !== 'arch') iceCrystals(b, S, rng, W * 0.55, 4);
  const group = f.finish(b, `crag:${kind}`, x, y, z, Number.isFinite(opts.rotation) ? opts.rotation : rng.range(0, Math.PI * 2));
  /** @type {Collider[]} */
  const colliders = circles.map(([lx, lz, r]) => {
    const p = f.world(group, new THREE.Vector3(lx, 0, lz));
    return { type: 'circle', x: p.x, z: p.z, r };
  });
  return f.result(group, { colliders });
}

/**
 * A natural arch: one stone profile in the x-y plane — two legs on the ground and the span between
 * them, its underside an elliptic arc (the opening, walkable), its top nearly flat — swept along x
 * with a bevelled cross-section (front, back, top and underside joined by chamfers, so it reads as
 * worn rock, not a cut-out), its depth wandering (the legs thicker, flaring at the foot) and its
 * faces bulging a little; the strata of the side texture run across it, the top wears the top
 * texture; fallen blocks at each foot. Colliders: one circle per leg.
 */
function buildArch(b, S, W, H, baseY, rng, circles) {
  const sideMat = b.mat(S.side);
  const topMat = b.mat(S.top);
  const su = b.units(sideMat);
  const tu = b.units(topMat);
  const half = W / 2;
  const legW = clamp(W * 0.19, 0.5, 2.6);
  const inner = half - legW; // the opening's half width
  const spring = H * rng.range(0.32, 0.42); // where the opening starts curving
  const crown = H * rng.range(0.66, 0.74); // the opening's top
  const N = 18;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const px = -half + (i / N) * W;
    const t = Math.abs(px) / half;
    const inOpen = Math.abs(px) < inner;
    const bottom = inOpen ? spring + (crown - spring) * Math.sqrt(Math.max(0, 1 - (px / inner) ** 2)) : 0;
    const top = H * (1 - 0.1 * t * t) + rng.range(-0.1, 0.1);
    const foot = inOpen ? 0 : Math.pow(smoothstep(inner, half, Math.abs(px)), 0.5); // the legs' outer flare
    const depth = (inOpen ? lerp(legW * 0.95, legW * 1.35, Math.abs(px) / inner) : legW * (1.4 + 0.25 * foot)) * rng.range(0.92, 1.08);
    const zc = rng.range(-0.06, 0.06);
    prof.push({ x: px, bottom, top, zf: zc + depth / 2, zb: zc - depth / 2, ch: Math.min(0.32, depth * 0.22, (top - bottom) * 0.2) });
  }
  /**
   * The cross-section at a column: eight points going round from the front's foot (z, y) and which
   * face each edge to the next is: 'f' front, 'c' chamfer, 't' top, 'k' back, 'u' underside.
   */
  const section = (P) => {
    const { zf, zb, top, bottom, ch } = P;
    return [[zf, bottom + ch], [zf, top - ch], [zf - ch, top], [zb + ch, top], [zb, top - ch], [zb, bottom + ch], [zb + ch, bottom], [zf - ch, bottom]];
  };
  const FACE = ['f', 'c', 't', 'c', 'k', 'c', 'u', 'c'];
  const SHADE = [0.98, 1.02, 1.06, 0.96, 0.9, 0.72, 0.6, 0.72];
  const v = (yy) => (baseY + yy) / su[1];
  for (let i = 0; i < N; i++) {
    const P = prof[i];
    const Q = prof[i + 1];
    const A = section(P);
    const B = section(Q);
    const k0 = 0.92 + 0.12 * rng.next();
    for (let e = 0; e < 8; e++) {
      const f = FACE[e];
      if (f === 'u' && P.bottom < 0.01 && Q.bottom < 0.01) continue; // a leg's foot on the ground
      const e2 = (e + 1) % 8;
      const a0 = [P.x, A[e][1], A[e][0]], a1 = [P.x, A[e2][1], A[e2][0]];
      const b0 = [Q.x, B[e][1], B[e][0]], b1 = [Q.x, B[e2][1], B[e2][0]];
      // the quad [a1, a0, b0, b1] winds counter-clockwise seen from outside (the section goes
      // round clockwise seen from +x)
      const pts = [a1, a0, b0, b1];
      const k = k0 * SHADE[e];
      const col = [k, k, k];
      if (f === 't') {
        b.quad(topMat, pts, pts.map((p) => [p[0] / tu[0], -p[2] / tu[1]]), { color: col });
      } else if (f === 'u') {
        b.quad(sideMat, pts, pts.map((p) => [p[0] / su[0], p[2] / su[1]]), { color: col });
      } else {
        const sgn = f === 'k' || (f === 'c' && e >= 3 && e <= 5) ? -1 : 1;
        b.quad(sideMat, pts, pts.map((p) => [(sgn * p[0]) / su[0], v(p[1])]), { color: col });
      }
    }
  }
  // the ends of the legs (x = ±half): the cross-section as a fan
  for (const s of [-1, 1]) {
    const P = prof[s < 0 ? 0 : N];
    const sec = section(P);
    const c = [P.x, (P.top + P.bottom) / 2, (P.zf + P.zb) / 2];
    for (let e = 0; e < 8; e++) {
      const p0 = [P.x, sec[e][1], sec[e][0]];
      const p1 = [P.x, sec[(e + 1) % 8][1], sec[(e + 1) % 8][0]];
      // (the section goes round counter-clockwise seen from −x, clockwise seen from +x)
      const tri = s < 0 ? [c, p0, p1] : [c, p1, p0];
      b.tri(sideMat, tri[0], tri[1], tri[2], ...tri.map((p) => [p[2] / su[0], v(p[1])]), { normal: [s, 0, 0], color: [0.94, 0.94, 0.94] });
    }
  }
  // (the legs' inner walls are the underside quads where the profile's bottom rises from the
  // ground to the springing line)
  for (const s of [-1, 1]) {
    circles.push([s * (half - legW / 2), 0, legW * 0.7]);
    // fallen blocks at the foot
    for (let k = 0; k < 3; k++) {
      const r = rng.range(0.16, 0.3) * Math.min(1.8, legW * 1.5);
      rockGeom(b, s * (half + rng.range(-0.3, 0.35)), 0, rng.range(-1, 1) * legW * 0.8, [r, r * 0.7, r * 0.9], rng, { top: S.top, side: S.side, detail: 0, yaw: rng.range(0, 6.28) });
    }
  }
}

// =================================================================================================
// The Bells of Evermere: the ice stone, ice boulders and snow drifts (the architecture package)
// =================================================================================================

/** The ice's glow: ≈ 0.15 over the ice, the heart veins full (the texture's emissive mask). */
const ICE_GLOW = '#5fd8f0';

/**
 * The ice stone's materials: the painted ice cliff (cyan emissive through its mask) and its
 * snow-dusted top. Shared with the citadel belfry's ice (props/Belfry.js).
 * @param {PropFactory} f
 * @returns {{ top: any, side: any }} two materials (slabStack and rockGeom take a texture name or a
 *   material where they name one)
 */
export function iceStone(f) {
  return {
    top: f.textures.material('ice_crag_top', { vertexColors: true }),
    side: f.textures.material('ice_crag', { vertexColors: true, emissive: new THREE.Color(ICE_GLOW), emissiveIntensity: 1 }),
  };
}

/**
 * A few ice crystals leaning out round a crag's foot: faceted prisms with sharp tips.
 * @param {MeshBuilder} b
 * @param {{ side: string|THREE.Material }} S
 * @param {import('../../utils/math.js').RNG} rng
 * @param {number} R the ring's radius
 * @param {number} count
 */
function iceCrystals(b, S, rng, R, count) {
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < count; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = R * rng.range(0.85, 1.15);
    const h = rng.range(0.6, 1.5);
    const r = rng.range(0.1, 0.22);
    const dir = new THREE.Vector3(Math.cos(a) * rng.range(0.2, 0.5), 1, Math.sin(a) * rng.range(0.2, 0.5)).normalize();
    b.push([Math.cos(a) * d, -0.1, Math.sin(a) * d], new THREE.Quaternion().setFromUnitVectors(up, dir));
    b.lathe(S.side, [{ y: 0, r }, { y: h * 0.7, r: r * 0.85 }, { y: h, r: 0.01 }], { segments: 5, phase: rng.range(0, 3), smooth: false });
    b.pop();
  }
}

/** Ground occlusion for the small things (a drift is lit to its foot). */
const softAO = (h = 0.4, k = 0.8) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);

/**
 * A `rock` of an owned stone (EVERMERE_CAMPAIGN.md §5.3): `ice` — an angular ice boulder (and a
 * leaning shard), a collider like a rock's; `snow` — a soft drift of snow (a broad low mound and a
 * smaller lobe), no collider, no shadow, melting where the thaw field thaws (≈ 2.5 s, back in ≈ 2 s
 * if the frost returns). From the season kit: PropFactory.rock routes these stones here.
 * @param {PropFactory} f
 * @param {number} x @param {number} y ground height @param {number} z
 * @param {{ size?: number, stone?: string, flat?: boolean, rotation?: number, seed?: number, id?: string }} [opts]
 * @returns {PropResult}
 */
export function buildSeasonRock(f, x, y, z, opts = {}) {
  const s = clamp(Number.isFinite(opts.size) ? Number(opts.size) : 1, 0.3, 2.5);
  const rot = Number.isFinite(opts.rotation) ? Number(opts.rotation) : null;
  if (opts.stone === 'snow') {
    const rng = f.rng('rock:snow', x, z, opts.seed);
    const b = f.builder(softAO());
    const drift = /** @type {any} */ (f.textures.material('snow_drift', { vertexColors: true }));
    const sx = 1.25 * s * rng.range(0.85, 1.15);
    const sy = 0.38 * s * rng.range(0.8, 1.15);
    const sz = 0.9 * s * rng.range(0.85, 1.15);
    rockGeom(b, 0, 0, 0, [sx, sy, sz], rng, { top: drift, side: drift, detail: 2, rough: 0.1, flatTop: 0.25, sink: 0.35, tint: [0.96, 0.97, 1.0] });
    rockGeom(b, sx * 0.7, 0, sz * rng.range(-0.4, 0.4), [sx * 0.55, sy * 0.7, sz * 0.6], rng, { top: drift, side: drift, detail: 1, rough: 0.1, flatTop: 0.2, sink: 0.35 });
    const built = b.build('rock:snow', { castShadow: false });
    f.track(built.geometries);
    const mound = built.group;
    mound.userData.dynamic = true;
    mound.rotation.y = rot ?? rng.range(0, Math.PI * 2);
    const root = new THREE.Group();
    root.name = 'rock:snow';
    root.position.set(x, y, z);
    root.add(mound);
    root.updateMatrixWorld(true);
    let k = -1;
    return f.result(root, {
      update: (dt) => {
        const target = thawField.at(x, z) >= 0.5 ? 0 : 1;
        if (k < 0) k = target;
        else if (k !== target) k = target > k ? Math.min(1, k + dt / 2) : Math.max(0, k - dt / 2.5);
        const e = k * k * (3 - 2 * k);
        mound.visible = e > 0.002;
        mound.scale.set(0.8 + 0.2 * e, e, 0.8 + 0.2 * e);
      },
    });
  }
  // ice: an angular boulder in the ice stone, a shard leaning on it
  const rng = f.rng('rock:ice', x, z, opts.seed);
  const S = iceStone(f);
  const b = f.builder(softAO(0.4 * s, 0.7));
  const sx = 0.72 * s * rng.range(0.85, 1.15);
  const sy = 0.66 * s * rng.range(0.85, 1.15);
  const sz = 0.62 * s * rng.range(0.85, 1.15);
  rockGeom(b, 0, 0, 0, [sx, sy, sz], rng, { top: S.top, side: S.side, detail: s > 0.55 ? 1 : 0, rough: 0.4, flatTop: opts.flat ? 0.3 : 0.05 });
  if (s >= 0.8) iceCrystals(b, S, rng, Math.max(sx, sz) * 0.9, 2);
  const group = f.finish(b, 'rock:ice', x, y, z, rot ?? rng.range(0, Math.PI * 2));
  /** @type {Collider[]} */
  const colliders = [{ type: 'circle', x, z, r: Math.max(sx, sz) * 0.95 }];
  return f.result(group, { colliders });
}
