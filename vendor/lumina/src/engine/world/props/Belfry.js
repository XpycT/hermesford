import * as THREE from 'three';
import { clamp, smoothstep } from '../../utils/math.js';
import { thawField } from '../ThawField.js';
import { TRIM } from './Details.js';
import { buildCrag } from './Crags.js';

/**
 * @import { PropFactory, PropResult, Bell } from '../Props.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 */

/**
 * Belfry.js — The Bells of Evermere's bell towers (docs/contracts/EVERMERE_CAMPAIGN.md §3, §5.3,
 * §6.3, §7.2) and the bell machinery the wayside chime (./Monuments.js) and the bell blank
 * (./Smithy.js) share. In the season kit's chunk (../SeasonKitParts.js). Owner: the architecture
 * package.
 *
 * Every belfry stands at (x, y, z), its front (door, clock, the bell's best side) toward +Z (the
 * camera; the catalog gives it no rotation). `height` is the bell chamber's eaves above the ground
 * (9, 4–24). Six kinds, each a composed silhouette for the play camera that holds the toll shot's
 * close-up (the bell from below at pitch ≈ 4–12):
 *  - `town`  Evermere's square: a stone tower on a two-step plinth, corner pilasters, an arched
 *    door, a stopped clock (its hands at 7.54 pm, the hub's blue hour), a bell chamber of four round
 *    arches, a slate pyramid and a gilt finial with a vane. `lantern: true` hangs a lamp in the
 *    chamber. **Lantern sockets** — where the author stands the four progress lanterns (`monument`
 *    kind `lantern`, `lit` by a live group per bell; west → east in the order the bells are rung):
 *    `TOWN_LANTERN_SOCKETS`, offsets from the belfry's point: (−3.4, +2.4), (−2.0, +3.4),
 *    (+2.0, +3.4), (+3.4, +2.4) — clear of the plinth's collider (±2.2) and of the door's approach.
 *  - `shrine` the Blossomwood's bell pavilion (shōrō): a stone base, from a height of 6.5 a flared
 *    lower storey of dark boards (hakama) under a balcony, four vermilion-lacquered posts, a deep
 *    vermilion roof whose eaves sweep up at the corners, a patina finial; a temple bell (bonshō)
 *    struck by a hanging log (the log swings in on `ring`, the bell sways).
 *  - `lighthouse` Saltcombe's: a whitewashed round tower with a red band, a gallery and railing, a
 *    glazed lantern room under a patina dome (emissive) and **one light descriptor** (always), the
 *    fog bell hung from a bracket over the gallery's south edge.
 *  - `abbey` Amberfield's: blue-grey ashlar with stepped buttresses, a lancet window, a belfry stage
 *    of pointed arches (open south and north, louvred east and west), a parapet with corner
 *    pinnacles and an octagonal slate spire.
 *  - `citadel` the Bell of Rest's: an old stone tower (battered base, corbelled crown, round
 *    arches, slate pyramid) bound in ice — slabs at its foot, sheets on its corners, spires above its
 *    roof, icicles under its cornice — a dynamic child (no shadow of its own) that sublimates into
 *    the stone, ≈ 4 s, where the thaw field thaws it (`thawField.at` ≥ 0.5) and grows back if the
 *    frost returns.
 *  - `hush` the black Hush Bell under an ice arch (props/Crags.js `ice`, width max(6.5, 0.75 ×
 *    height)), hung from an iron yoke on a heavy chain that runs up into the span. The arch, its
 *    yoke and chain are a dynamic child that sublimates where the thaw field thaws it (`at` ≥ 0.5,
 *    only on a level with a frost: elsewhere it stands), ≈ 4 s, melting down to its feet while the
 *    bell comes down with the yoke and settles on the ground, canted; its legs' colliders go with
 *    the ice; all of it grows back if the frost returns (EVM-26).
 * `bell`: 'bronze' | 'black' (the black bell's frost veins and lip glow cyan, faintly). `lantern`:
 * a lamp in the chamber (one light descriptor, warm, at night).
 *
 * The bell is a dynamic child (never merged) that **swings** on `result.bell.ring(power)`: an
 * impulse (power 1 ≈ 0.45 rad, 0.1–2 accepted), a damped swing (≈ 3.5 s to fade), its clapper a
 * free pendulum that strikes the sound bow at once and on the swings that follow; the shrine's log
 * strikes the bonshō from the side instead. `result.bell.mouth` is the mouth's centre in world space
 * (kept current while it swings: the story's `toll` and `effect toll` start the gold ring there);
 * `kind` is the belfry's kind. The caller plays the sound (EVERMERE_CAMPAIGN.md §7.2).
 *
 * Draw calls: the tower merges into the level's batches (its library materials and this package's
 * textures: pixel/textures/evermereProps.js); the bell is one mesh + its shadow, the clapper (or the
 * log) one more without a shadow, the citadel's ice one more without a shadow, the hush kind's
 * arch (its ice's two materials) and its iron three more with their shadows (they do not merge:
 * they sublimate), the lighthouse's
 * lantern glass merges (emissive, registered like the bell-lanterns). Lights (each spends one of
 * the level's 12 lamp descriptors): the lighthouse always, any kind with `lantern: true`.
 * Colliders: the footprint (the plinth or the base), the hush kind's two ice legs.
 */

/**
 * @typedef {object} BelfryOptions
 * @property {string} [kind] 'town' | 'shrine' | 'lighthouse' | 'abbey' | 'citadel' | 'hush'
 * @property {number} [height] the bell chamber's eaves above the ground (9, 4–24)
 * @property {string} [bell] 'bronze' | 'black'
 * @property {boolean} [lantern] a lamp in the bell chamber (one light descriptor)
 * @property {number} [seed]
 * @property {string} [id]
 */

/** The town belfry's four lantern sockets: offsets (x, z) from its point, in ringing order. */
export const TOWN_LANTERN_SOCKETS = Object.freeze([[-3.4, 2.4], [-2.0, 3.4], [2.0, 3.4], [3.4, 2.4]].map((p) => Object.freeze(p)));

/** The bell-lanterns' glow (one shared material, so every user registers these values). */
export const LANTERN_GLOW = Object.freeze({ day: 0.5, night: 1.8 });

const KINDS = ['town', 'shrine', 'lighthouse', 'abbey', 'citadel', 'hush'];
const SQ2 = Math.SQRT2;
/** Vertex tint of the inside of things (a bell's mouth, a chamber's ceiling). */
const DARK = [0.32, 0.28, 0.27];
const groundAO = (h = 0.8, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);
const _v = new THREE.Vector3();

// =================================================================================================
// The bell (shared with the chime and the bell blank)
// =================================================================================================

/**
 * Profiles (y up from the lip, r) for a mouth radius of 1: a western bell (lip, sound bow, waist,
 * shoulder, crown), its inside, and the temple bell's straight barrel.
 */
const WESTERN = [[0, 1], [0.05, 0.99], [0.16, 0.93], [0.36, 0.79], [0.7, 0.67], [1.0, 0.635], [1.24, 0.585], [1.41, 0.5], [1.5, 0.32], [1.54, 0]];
const WESTERN_IN = [[1.36, 0], [1.3, 0.38], [0.95, 0.53], [0.45, 0.65], [0.12, 0.82], [0.02, 0.9]];
const TEMPLE = [[0, 1], [0.04, 0.99], [0.2, 0.96], [0.62, 0.935], [1.3, 0.925], [1.95, 0.925], [2.08, 0.88], [2.26, 0.72], [2.38, 0.44], [2.42, 0]];
const TEMPLE_IN = [[2.3, 0], [2.22, 0.5], [2.0, 0.8], [1.0, 0.86], [0.2, 0.88], [0.02, 0.9]];

/**
 * The bell's metal material: bronze, or the black Hush Bell's iron (its frost veins glow cyan,
 * faintly, day and night — not registered).
 * @param {PropFactory} f
 * @param {boolean} black
 * @returns {THREE.Material}
 */
export function bellMaterial(f, black) {
  return black
    ? f.textures.material('bell_black', { vertexColors: true, emissive: new THREE.Color('#5fd0e8'), emissiveIntensity: 0.9 })
    : f.textures.material('bell_bronze', { vertexColors: true });
}

/**
 * The bell-lantern glass: lit (emissive, registered `LANTERN_GLOW` by every user) or dark (cooler,
 * never glowing).
 * @param {PropFactory} f
 * @param {boolean} lit
 * @returns {THREE.MeshLambertMaterial}
 */
export function lanternMaterial(f, lit) {
  return lit
    ? f.textures.material('bell_lantern', { vertexColors: true, emissiveIntensity: 0 })
    : f.textures.material('bell_lantern', { vertexColors: true, emissiveIntensity: 0, color: new THREE.Color(0x5c6070) });
}

/**
 * A bell's geometry into `b` (the bell's own builder), hung from (0, 0, 0): crown at y 0, lip at
 * −height. `temple`: the bonshō's barrel and dragon loop, else a western bell with canons.
 * @param {MeshBuilder} b
 * @param {THREE.Material} mat
 * @param {number} R mouth radius
 * @param {{ temple?: boolean, segments?: number, tint?: number[] }} [o] tint: the outside's vertex
 *   colour (a rough casting)
 * @returns {number} the bell's height
 */
export function bellGeom(b, mat, R, { temple = false, segments = 14, tint } = {}) {
  const P = temple ? TEMPLE : WESTERN;
  const Pin = temple ? TEMPLE_IN : WESTERN_IN;
  const Hb = P[P.length - 1][0] * R;
  const rings = P.map(([y, r]) => ({ y: y * R - Hb, r: r * R }));
  let len = 0;
  for (let i = 1; i < rings.length; i++) len += Math.hypot(rings[i].y - rings[i - 1].y, rings[i].r - rings[i - 1].r);
  const uRepeat = Math.max(1, Math.round((Math.PI * 2 * R) / 2));
  b.lathe(mat, rings, { segments, smooth: true, vScale: len, uRepeat, color: tint });
  // the inside (top → down: the faces look inward), dark; the lip's underside
  b.lathe(mat, Pin.map(([y, r]) => ({ y: y * R - Hb, r: r * R })), { segments, smooth: true, uRepeat, color: DARK });
  b.lathe(mat, [{ y: -Hb + 0.001, r: 0.9 * R }, { y: -Hb, r: R }], { segments, smooth: false, uRepeat, color: [0.6, 0.55, 0.5] });
  if (temple) {
    // the dragon loop (ryūzu): an arch on the crown
    b.tube(mat, [-0.18 * R, 0, 0], [-0.1 * R, 0.24 * R, 0], 0.07 * R, 0.06 * R, { segments: 6 });
    b.tube(mat, [-0.1 * R, 0.24 * R, 0], [0.1 * R, 0.24 * R, 0], 0.06 * R, 0.06 * R, { segments: 6 });
    b.tube(mat, [0.1 * R, 0.24 * R, 0], [0.18 * R, 0, 0], 0.06 * R, 0.07 * R, { segments: 6 });
  } else {
    // canons: a loop across the crown
    b.box(mat, [0.1 * R, 0.2 * R, 0.34 * R], { at: [0, 0.1 * R, 0], color: [0.85, 0.85, 0.85] });
    b.box(mat, [0.1 * R, 0.08 * R, 0.5 * R], { at: [0, 0.2 * R, 0], color: [0.9, 0.9, 0.9] });
  }
  return Hb;
}

/**
 * The clapper (iron), hung from (0, −0.1 R): a rod, the ball near the sound bow, the flight a
 * little below the lip (seen from below).
 * @param {MeshBuilder} b
 * @param {number} R @param {number} Hb the bell's height
 */
function clapperGeom(b, R, Hb) {
  const ball = -Hb + 0.3 * R;
  b.tube('metal', [0, 0, 0], [0, ball + 0.12 * R, 0], 0.045 * R, 0.06 * R, { segments: 6 });
  b.lathe('metal', [{ y: ball - 0.15 * R, r: 0.02 }, { y: ball - 0.06 * R, r: 0.13 * R }, { y: ball + 0.06 * R, r: 0.15 * R }, { y: ball + 0.15 * R, r: 0.05 * R }], { segments: 8, smooth: true, color: [0.75, 0.72, 0.72] });
  b.tube('metal', [0, ball - 0.12 * R, 0], [0, -Hb - 0.08 * R, 0], 0.055 * R, 0.035 * R, { segments: 6 });
}

/**
 * A swinging bell: its own group (dynamic, never merged; one mesh and a shadow), the clapper a
 * child group (no shadow), the swing simulated in `update`. Add `group` under the prop's root at
 * the hang point (prop-local `hang`) and call `place(root)` once the root is placed.
 * @param {PropFactory} f
 * @param {{ R: number, black?: boolean, temple?: boolean, segments?: number, omega?: number,
 *   kick?: number, name: string, axis?: 'x'|'z', tint?: number[] }} spec
 *   omega: the swing's angular frequency (rad/s; heavier bells slower), kick: the swing for power 1
 *   (rad), axis: the swing axis in the bell's frame ('z': it swings left–right on screen)
 */
export function makeBell(f, { R, black = false, temple = false, segments = 14, omega = 3.2, kick = 0.45, name, axis = 'z', tint }) {
  const mat = bellMaterial(f, black);
  const bb = f.builder();
  const Hb = bellGeom(bb, mat, R, { temple, segments, tint });
  const { group, geometries } = bb.build(name);
  f.track(geometries);
  group.userData.dynamic = true;
  let clapper = null;
  if (!temple) {
    const cb = f.builder();
    clapperGeom(cb, R, Hb);
    const built = cb.build(`${name}:clapper`, { castShadow: false });
    f.track(built.geometries);
    clapper = built.group;
    clapper.position.set(0, -0.1 * R, 0);
    group.add(clapper);
  }
  /** the mouth's centre in the bell's frame */
  const mouthLocal = new THREE.Vector3(0, -Hb, 0);
  const mouth = /** @type {[number, number, number]} */ ([0, 0, 0]);
  // the swing: θ the bell, α the clapper (absolute: a free pendulum on the bell's axis), φ = α − θ
  // bounded by the sound bow (restitution on contact); semi-implicit Euler in ≤ 1/120 s steps
  const zeta = 1 / (3.5 * omega);
  const wc = omega * 1.35;
  const phiMax = temple ? 0 : 0.3;
  let th = 0, thv = 0, al = 0, alv = 0, awake = false;
  const rot = axis === 'z' ? 'z' : 'x';
  const syncMouth = () => {
    group.updateWorldMatrix(true, false);
    _v.copy(mouthLocal).applyMatrix4(group.matrixWorld);
    mouth[0] = _v.x; mouth[1] = _v.y; mouth[2] = _v.z;
  };
  return {
    group, Hb, mouth, R,
    /** Fix the mouth once the prop's root is placed (and its world matrix current). */
    place: syncMouth,
    /** Ring it: power 0.1–2 (an impulse; the clapper flies to the bow at once). */
    ring(power = 1) {
      const p = clamp(Number(power) || 0, 0.1, 2);
      thv -= kick * omega * p;
      alv += kick * omega * p * (temple ? 0 : 2.2);
      awake = true;
    },
    /** Kick the bell alone (a striker outside it: the shrine's log). @param {number} v rad/s */
    nudge(v) { thv += v; awake = true; },
    update(dt) {
      if (!awake) return;
      let left = Math.min(dt, 0.1);
      while (left > 1e-6) {
        const h = Math.min(left, 1 / 120);
        left -= h;
        thv += (-omega * omega * th - 2 * zeta * omega * thv) * h;
        th += thv * h;
        if (clapper) {
          alv += (-wc * wc * al - 2 * 0.12 * wc * alv) * h;
          al += alv * h;
          const phi = al - th;
          if (Math.abs(phi) > phiMax) {
            const s = Math.sign(phi);
            al = th + s * phiMax;
            const rel = alv - thv;
            if (rel * s > 0) alv = thv - rel * 0.3;
          }
        }
      }
      group.rotation[rot] = th;
      if (clapper) clapper.rotation[rot] = al - th;
      syncMouth();
      if (Math.abs(th) + Math.abs(thv) * 0.2 + Math.abs(al) + Math.abs(alv) * 0.2 < 2e-4) {
        th = thv = al = alv = 0;
        group.rotation[rot] = 0;
        if (clapper) clapper.rotation[rot] = 0;
        syncMouth();
        awake = false;
      }
    },
  };
}

/**
 * The prop's `bell` (§7.2) from a made bell.
 * @param {ReturnType<typeof makeBell>} bell
 * @param {string} kind
 * @param {(power: number) => void} [ring] another way to ring it (the shrine's log)
 * @returns {Bell}
 */
export function bellOf(bell, kind, ring) {
  return { ring: ring ?? ((power = 1) => bell.ring(power)), mouth: bell.mouth, kind };
}

// =================================================================================================
// Building helpers
// =================================================================================================

/**
 * A quad from four points in any order around it, wound to face `n` (its normal for the light),
 * UVs from `uv(p)`.
 * @param {MeshBuilder} b
 * @param {string|THREE.Material} mat
 * @param {number[][]} pts
 * @param {number[]} n
 * @param {((p: number[]) => number[])|number[][]} uv a function of the point, or the four UVs
 * @param {number[]} [color]
 */
function face(b, mat, pts, n, uv, color) {
  const [a, c, d] = [pts[0], pts[1], pts[3]];
  const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1];
  const cy = e1[2] * e2[0] - e1[0] * e2[2];
  const cz = e1[0] * e2[1] - e1[1] * e2[0];
  const uvs = typeof uv === 'function' ? pts.map(uv) : uv;
  const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
  const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
  b.quad(mat, order.map((i) => pts[i]), order.map((i) => uvs[i]), { normals: [n, n, n, n], color });
}
/** `face` for the other props of the package (Monuments.js, Smithy.js, Ships.js). */
export const quadFacing = face;

/**
 * The points of an arch's head from its left springing (−ow/2, ys) over the crown to the right one:
 * a round arch, or (pointed > 0) a pointed one whose arcs' centres stand `pointed × ow/2` off the axis.
 */
function archPoints(ow, ys, pointed, n) {
  const pts = [];
  if (pointed <= 0) {
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (1 - k / n);
      pts.push([Math.cos(a) * ow / 2, ys + Math.sin(a) * ow / 2]);
    }
    return pts;
  }
  const e = pointed * ow / 2;
  const r = ow / 2 + e;
  const a1 = Math.acos(-e / r);
  const half = Math.max(2, Math.round(n / 2));
  const left = [];
  for (let k = 0; k <= half; k++) {
    const a = Math.PI + (a1 - Math.PI) * (k / half);
    left.push([e + r * Math.cos(a), ys + r * Math.sin(a)]);
  }
  left[half][0] = 0;
  const right = left.slice(0, half).reverse().map(([px, py]) => [-px, py]);
  return [...left, ...right];
}

/** Where a ray from (0, ys) at angle a leaves the rectangle [−L/2, L/2] × [ys, y1]. */
function rayRect(a, L, ys, y1) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let t = Infinity;
  if (dx < -1e-9) t = Math.min(t, (-L / 2) / dx);
  if (dx > 1e-9) t = Math.min(t, (L / 2) / dx);
  if (dy > 1e-9) t = Math.min(t, (y1 - ys) / dy);
  return [dx * t, ys + dy * t];
}

/** Where a ray from (0, ys) at angle a meets the arch polyline. */
function rayArch(a, arch, ys) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  for (let k = 0; k < arch.length - 1; k++) {
    const [x0, y0] = arch[k];
    const [x1, y1] = arch[k + 1];
    const ex = x1 - x0, ey = y1 - y0;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (x0 * ey - (y0 - ys) * ex) / den;
    const s = (x0 * dy - (y0 - ys) * dx) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) return [dx * t, ys + dy * t];
  }
  return [0, ys];
}

/**
 * A wall panel with an arched opening in the builder's current frame: x ∈ [−L/2, L/2],
 * y ∈ [y0, y1], the outer face at z = 0 (normal +z), the inner at z = −d (normal −z, tinted
 * `inner`); the opening `ow` wide from `ySill` to the springing line `ys`, its head round or
 * pointed; the jambs, the soffit and the sill through the wall's depth.
 * @param {MeshBuilder} b
 * @param {string|THREE.Material} mat
 * @param {{ L: number, y0: number, y1: number, d: number, ow: number, ySill: number, ys: number,
 *   pointed?: number, n?: number, inner?: number[], uOff?: number, ends?: boolean }} o
 *   ends: close the panel's two ends (x = ±L/2) too
 */
function archWall(b, mat, { L, y0, y1, d, ow, ySill, ys, pointed = 0, n = 10, inner = [0.62, 0.6, 0.62], uOff = 0, ends = false }) {
  const M = b.mat(mat);
  const [Uu, Uv] = b.units(M);
  const uvO = (p) => [(p[0] + uOff) / Uu, p[1] / Uv];
  const uvI = (p) => [(-p[0] + uOff) / Uu, p[1] / Uv];
  const arch = archPoints(ow, ys, pointed, n);
  // the regions of the face, as 2D quads (x, y)
  /** @type {number[][][]} */
  const quads = [
    [[-L / 2, y0], [-ow / 2, y0], [-ow / 2, ys], [-L / 2, ys]],
    [[ow / 2, y0], [L / 2, y0], [L / 2, ys], [ow / 2, ys]],
  ];
  if (ySill > y0 + 1e-3) quads.push([[-ow / 2, y0], [ow / 2, y0], [ow / 2, ySill], [-ow / 2, ySill]]);
  // the head: fanned between the arch and the panel's top corners
  const angles = arch.map(([px, py]) => Math.atan2(py - ys, px));
  angles.push(Math.atan2(y1 - ys, -L / 2), Math.atan2(y1 - ys, L / 2));
  angles.sort((p, q) => q - p);
  for (let k = 0; k < angles.length - 1; k++) {
    const a0 = angles[k], a1 = angles[k + 1];
    if (a0 - a1 < 1e-6) continue;
    quads.push([rayArch(a0, arch, ys), rayRect(a0, L, ys, y1), rayRect(a1, L, ys, y1), rayArch(a1, arch, ys)]);
  }
  for (const q of quads) {
    face(b, M, q.map(([px, py]) => [px, py, 0]), [0, 0, 1], uvO);
    face(b, M, q.map(([px, py]) => [px, py, -d]), [0, 0, -1], uvI, inner);
  }
  // jambs, the sill, the soffit
  const uvZ = (p) => [p[2] / Uu, p[1] / Uv];
  face(b, M, [[-ow / 2, ySill, 0], [-ow / 2, ys, 0], [-ow / 2, ys, -d], [-ow / 2, ySill, -d]], [1, 0, 0], uvZ, [0.86, 0.84, 0.86]);
  face(b, M, [[ow / 2, ySill, 0], [ow / 2, ys, 0], [ow / 2, ys, -d], [ow / 2, ySill, -d]], [-1, 0, 0], uvZ, [0.86, 0.84, 0.86]);
  face(b, M, [[-ow / 2, ySill, 0], [ow / 2, ySill, 0], [ow / 2, ySill, -d], [-ow / 2, ySill, -d]], [0, 1, 0], (p) => [p[0] / Uu, p[2] / Uv], [1.02, 1.02, 1.02]);
  let s = 0;
  for (let k = 0; k < arch.length - 1; k++) {
    const [x0, y0a] = arch[k];
    const [x1, y1a] = arch[k + 1];
    const len = Math.hypot(x1 - x0, y1a - y0a);
    const mx = (x0 + x1) / 2, my = (y0a + y1a) / 2;
    const nl = Math.hypot(mx, my - ys) || 1;
    const nn = [-mx / nl, -(my - ys) / nl, 0];
    const uvs = [[s / Uu, 0], [(s + len) / Uu, 0], [(s + len) / Uu, -d / Uv], [s / Uu, -d / Uv]];
    face(b, M, [[x0, y0a, 0], [x1, y1a, 0], [x1, y1a, -d], [x0, y0a, -d]], nn, uvs, [0.72, 0.7, 0.72]);
    s += len;
  }
  if (ends) {
    for (const sx of [-1, 1]) {
      face(b, M, [[sx * L / 2, y0, 0], [sx * L / 2, y1, 0], [sx * L / 2, y1, -d], [sx * L / 2, y0, -d]], [sx, 0, 0], uvZ);
    }
  }
}

/**
 * Four arch walls round a square chamber of outer width W (walls `d` thick), from y0 to y1, in the
 * builder's frame (centred on the origin). `open(side)`: the opening of that side ('front' +Z,
 * 'back', 'right' +X, 'left') — or null for a louvred one (slats across the opening).
 * @param {MeshBuilder} b
 */
function chamberWalls(b, mat, { W, d, y0, y1, ow, ySill, ys, pointed = 0, louvred = [] }) {
  /** @type {[string, number][]} */
  const sides = [['front', 0], ['right', Math.PI / 2], ['back', Math.PI], ['left', -Math.PI / 2]];
  for (const [side, yaw] of sides) {
    // each wall covers its whole side; the corners close where they meet (the side walls run
    // between the front and back ones)
    const L = side === 'front' || side === 'back' ? W : W - 2 * d;
    b.push([Math.sin(yaw) * W / 2, 0, Math.cos(yaw) * W / 2], yaw);
    const long = side === 'front' || side === 'back';
    archWall(b, mat, { L, y0, y1, d, ow, ySill, ys, pointed, uOff: long ? 0 : 0.37, ends: long });
    if (louvred.includes(side)) {
      // louvres: slats down the opening, tilted to shed rain
      const top = pointed > 0 ? ys + ow * 0.3 : ys + ow * 0.3;
      for (let yy = ySill + 0.2; yy < top; yy += 0.28) b.box(TRIM, [ow - 0.04, 0.05, d * 0.7], { at: [0, yy, -d / 2], rot: [0.55, 0, 0] });
    }
    b.pop();
  }
}

/**
 * A square pyramid roof (4 facets) from `y0` at half-width `hw` (the eaves) to the apex `h` above,
 * a dark soffit under its overhang and a flat ceiling over the chamber.
 * @param {MeshBuilder} b
 */
function pyramidRoof(b, roof, { y0, hw, h, inner }) {
  b.lathe(roof, [{ y: y0, r: hw * SQ2 }, { y: y0 + h, r: 0.03 }], { segments: 4, phase: Math.PI / 4, smooth: false, normalUp: 0.05 });
  b.lathe(TRIM, [{ y: y0 + 0.02, r: inner * SQ2 }, { y: y0 + 0.02, r: hw * SQ2 }], { segments: 4, phase: Math.PI / 4, smooth: false, color: DARK });
}

/** A gilt ball, a rod and a vane at (0, y, 0). @param {MeshBuilder} b */
function finial(b, y, s = 1) {
  b.tube('metal', [0, y - 0.1, 0], [0, y + 1.1 * s, 0], 0.035, 0.03, { segments: 5 });
  b.lathe('metal', [{ y: y + 0.42 * s, r: 0.02 }, { y: y + 0.5 * s, r: 0.12 * s }, { y: y + 0.62 * s, r: 0.11 * s }, { y: y + 0.68 * s, r: 0.02 }], { segments: 8, color: [1.5, 1.25, 0.7] });
  b.box('metal', [0.6 * s, 0.05, 0.03], { at: [0.08 * s, y + 0.9 * s, 0] });
  b.tri('metal', [-0.24 * s, y + 0.84 * s, 0.016], [-0.24 * s, y + 0.98 * s, 0.016], [-0.36 * s, y + 0.91 * s, 0.016], [0, 0], [0, 1], [1, 0.5]);
  b.box('metal', [0.14 * s, 0.14 * s, 0.03], { at: [0.38 * s, y + 0.9 * s, 0], rot: [0, 0, Math.PI / 4] });
}

/** A lamp hanging in a chamber (bell-lantern glass) at (lx, ly, lz). @param {MeshBuilder} b */
function chamberLamp(b, glass, lx, ly, lz, chain = 0.6) {
  b.box('metal', [0.03, chain, 0.03], { at: [lx, ly + 0.25 + chain / 2, lz] });
  b.box(glass, [0.26, 0.34, 0.26], { at: [lx, ly, lz], faces: { py: false, ny: false }, uv: 'fit' });
  b.lathe('metal', [{ y: ly + 0.17, r: 0.24 }, { y: ly + 0.3, r: 0.04 }], { segments: 4, phase: Math.PI / 4, smooth: false, capBottom: true });
  b.box('metal', [0.32, 0.04, 0.32], { at: [lx, ly - 0.19, lz] });
}

// =================================================================================================
// The belfry
// =================================================================================================

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y ground height
 * @param {number} z
 * @param {BelfryOptions} [opts]
 * @returns {PropResult}
 */
export function buildBelfry(f, x, y, z, opts = {}) {
  const kind = KINDS.includes(opts.kind ?? '') ? /** @type {string} */ (opts.kind) : 'town';
  const H = clamp(Number.isFinite(opts.height) ? Number(opts.height) : 9, 4, 24);
  const black = opts.bell === 'black';
  const rng = f.rng('belfry', x, z, opts.seed);
  const b = f.builder(groundAO(1.0));
  const glass = lanternMaterial(f, true);
  /** @type {{ position: THREE.Vector3, color?: THREE.ColorRepresentation, intensity?: number, distance?: number, flicker?: number, nightOnly?: boolean, fire?: boolean }[]} */
  const lights = [];
  /** @type {{ material: THREE.Material, day?: number, night?: number }[]} */
  const emissives = [];
  let hang = [0, H - 1, 0];
  let R = 0.6;
  let foot = 2.2;
  /** @type {{ type: 'circle', x: number, z: number, r: number }[]|null} */
  let circles = null;
  let temple = false;
  /** @type {THREE.Group|null} */
  let ice = null;
  let lampAt = null;
  /** extra dynamic parts: the shrine's log */
  let log = null;
  /** the hush kind's ice arch (a crag's root, re-parented under the belfry's) */
  let archObject = null;
  /** the hush kind's yoke and chain (a dynamic child of the arch: they go with its ice) */
  let hanger = null;

  switch (kind) {
    case 'shrine': {
      ({ hang, R, foot, log, lampAt } = shrine(f, b, H, rng));
      temple = true;
      break;
    }
    case 'lighthouse': {
      ({ hang, R, foot, lampAt } = lighthouse(b, H, glass));
      emissives.push({ material: glass, ...LANTERN_GLOW });
      lights.push({ position: new THREE.Vector3(x, y + H + 1.05, z), color: '#ffe2a0', intensity: 14, distance: 18, flicker: 0.04, nightOnly: true });
      break;
    }
    case 'abbey': {
      ({ hang, R, foot, lampAt } = abbey(b, H, rng));
      break;
    }
    case 'citadel': {
      ({ hang, R, foot, lampAt } = citadel(b, H, rng));
      ice = citadelIce(f, H, rng);
      break;
    }
    case 'hush': {
      const res = hushArch(f, b, x, y, z, H, opts.seed);
      ({ hang, R, lampAt } = res);
      circles = res.circles;
      archObject = res.object;
      hanger = res.hanger;
      foot = 0;
      break;
    }
    default: {
      ({ hang, R, foot, lampAt } = town(b, H, rng));
    }
  }
  if (opts.lantern === true && kind !== 'lighthouse' && lampAt) {
    chamberLamp(b, glass, lampAt[0], lampAt[1], lampAt[2]);
    emissives.push({ material: glass, ...LANTERN_GLOW });
    lights.push({ position: new THREE.Vector3(x + lampAt[0], y + lampAt[1], z + lampAt[2] + 0.4), color: '#ffc070', intensity: 7, distance: 10, flicker: 0.12, nightOnly: true });
  }
  const group = f.finish(b, `belfry:${kind}`, x, y, z, 0);
  if (archObject) {
    archObject.position.set(0, 0, 0);
    group.add(archObject);
  }

  // the bell, hung at `hang`
  const heavy = kind === 'hush' || kind === 'citadel';
  const bell = makeBell(f, {
    R, black: black || false, temple, name: 'belfry:bell', segments: R > 0.8 ? 16 : 14,
    omega: temple ? 2.2 : heavy ? 2.6 : kind === 'lighthouse' ? 4 : 3.2, kick: temple ? 0.06 : heavy ? 0.36 : 0.45,
  });
  bell.group.position.set(hang[0], hang[1], hang[2]);
  group.add(bell.group);
  /** @type {((dt: number) => void)[]} */
  const updates = [bell.update];
  let ring = null;
  if (log) {
    const l = logSwing(f, log, bell);
    group.add(l.group);
    updates.push(l.update);
    ring = l.ring;
  }
  if (ice) {
    group.add(ice);
    updates.push(sublimate(ice, x, z));
  }
  if (archObject && hanger && circles) {
    // (the arch and its iron a dynamic child: never merged, so it can sublimate — EVM-26)
    archObject.userData.dynamic = true;
    archObject.add(hanger);
    updates.push(sublimateArch(archObject, bell, circles, hang[1], x, z));
  }
  group.updateMatrixWorld(true);
  bell.place();

  const colliders = circles ?? (kind === 'lighthouse'
    ? [{ type: /** @type {'circle'} */ ('circle'), x, z, r: foot }]
    : f.boxColliders(group, -foot, foot, -foot, foot));
  const res = f.result(group, {
    colliders,
    lights,
    emissives,
    update: (dt) => { for (const u of updates) u(dt); },
  });
  res.bell = bellOf(bell, kind, ring ?? undefined);
  return res;
}

// ---- the kinds (each emits the tower into `b` in its local frame and says where the bell hangs)

/**
 * Evermere's town belfry.
 * @param {MeshBuilder} b
 */
function town(b, H, rng) {
  const W = 3.2;
  const hw = W / 2;
  const Hc = Math.max(3.2, H - 3.4); // the chamber's floor
  // plinth: two steps
  b.box('stone_tiles', [W + 1.2, 0.24, W + 1.2], { at: [0, 0.12, 0], faces: { ny: false } });
  b.box('stone_brick', [W + 0.6, 0.28, W + 0.6], { at: [0, 0.38, 0], faces: { ny: false } });
  // the shaft, its base course and corner pilasters
  b.box('stone_brick', [W, Hc - 0.5, W], { at: [0, 0.5 + (Hc - 0.5) / 2, 0], faces: { ny: false, py: false } });
  b.box('stone_brick', [W + 0.16, 0.5, W + 0.16], { at: [0, 0.77, 0], faces: { ny: false }, color: [0.92, 0.9, 0.9] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box('stone_brick', [0.44, Hc - 0.55, 0.44], { at: [sx * (hw - 0.17), 0.5 + (Hc - 0.55) / 2, sz * (hw - 0.17)], faces: { ny: false }, off: [0.3, 0], color: [1.1, 1.08, 1.04] });
  }
  // the door: an arched stone surround, the leaf, a step
  const dz = hw + 0.01;
  b.quad('door', [[-0.55, 0.52, dz], [0.55, 0.52, dz], [0.55, 2.55, dz], [-0.55, 2.55, dz]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (const s of [-1, 1]) b.box('stone_tiles', [0.24, 2.2, 0.16], { at: [s * 0.68, 1.6, hw + 0.06], color: [1.08, 1.06, 1.02] });
  b.push([0, 0, hw + 0.06]);
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (k / 6);
    b.box('stone_tiles', [0.26, 0.2, 0.16], { at: [Math.cos(a) * 0.68, 2.7 + Math.sin(a) * 0.6, 0], rot: [0, 0, a + Math.PI / 2], color: [1.08, 1.06, 1.02] });
  }
  b.pop();
  // the stopped clock (7.54 pm: the blue hour of the last night of winter)
  const cy = Hc - 1.15;
  const cz = hw + 0.03;
  const dial = [];
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; dial.push([Math.cos(a) * 0.72, cy + Math.sin(a) * 0.72, cz]); }
  // (the dial's 2 u texture over 1.6 u: axes scaled, not `scale` — poly reads that as a transform)
  b.poly('clock_dial', dial, { uAxis: [1.25, 0, 0], vAxis: [0, 1.25, 0], origin: [-0.8, cy - 0.8, cz], normal: [0, 0, 1] });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
    b.box('stone_tiles', [0.3, 0.16, 0.12], { at: [Math.cos(a) * 0.8, cy + Math.sin(a) * 0.8, cz + 0.03], rot: [0, 0, a + Math.PI / 2], color: [1.06, 1.04, 1.0] });
  }
  const hand = (turn, len, wdt) => {
    const a = -turn * Math.PI * 2;
    b.box('metal', [wdt, len, 0.03], { at: [Math.sin(-a) * len * 0.4, cy + Math.cos(a) * len * 0.4, cz + 0.05], rot: [0, 0, a] });
  };
  hand(7.9 / 12, 0.42, 0.07);
  hand(54 / 60, 0.6, 0.045);
  b.box('metal', [0.1, 0.1, 0.05], { at: [0, cy, cz + 0.07] });
  // string course, the bell chamber, cornice
  b.box('stone_tiles', [W + 0.32, 0.22, W + 0.32], { at: [0, Hc + 0.04, 0], color: [1.04, 1.02, 1.0] });
  const ow = 1.6;
  const ys = Hc + 1.6;
  chamberWalls(b, 'stone_brick', { W, d: 0.4, y0: Hc + 0.15, y1: H, ow, ySill: Hc + 0.4, ys });
  b.box('wood_planks_dark', [W - 0.8, 0.1, W - 0.8], { at: [0, Hc + 0.2, 0], faces: { ny: false } });
  b.box('stone_tiles', [W + 0.42, 0.22, W + 0.42], { at: [0, H + 0.08, 0], color: [1.04, 1.02, 1.0] });
  b.box('stone_tiles', [W + 0.26, 0.14, W + 0.26], { at: [0, H - 0.08, 0], faces: { py: false }, color: [0.9, 0.88, 0.88] });
  pyramidRoof(b, 'roof_slate', { y0: H + 0.18, hw: hw + 0.42, h: W * 0.95, inner: hw - 0.3 });
  finial(b, H + 0.18 + W * 0.95 - 0.08, 1);
  // the headstock: a beam across the chamber (the swing's axis runs along it, front to back)
  const hangY = ys + 0.5;
  b.box('wood_planks_dark', [0.22, 0.26, W - 0.5], { at: [0, hangY + 0.13, 0], rotUV: true });
  for (const s of [-1, 1]) b.box('metal', [0.26, 0.1, 0.12], { at: [0, hangY + 0.13, s * 0.25] });
  return { hang: [0, hangY, 0], R: 0.6, foot: hw + 0.6, lampAt: [0.95, hangY - 0.25, -0.75] };
}

/**
 * The Blossomwood's bell pavilion. The striking log hangs west of the bell (`log`: its pivot and
 * size).
 * @param {PropFactory} f
 * @param {MeshBuilder} b
 */
function shrine(f, b, H, rng) {
  const hw = 1.9; // the base's half width
  const P = 1.25; // the posts' half spacing
  // stone base, two tiers, steps on the south
  b.box('stone_tiles', [2 * hw + 0.6, 0.3, 2 * hw + 0.6], { at: [0, 0.15, 0], faces: { ny: false }, color: [0.92, 0.94, 0.96] });
  b.box('stone_tiles', [2 * hw, 0.3, 2 * hw], { at: [0, 0.45, 0], faces: { ny: false } });
  b.box('stone_tiles', [1.6, 0.15, 0.4], { at: [0, 0.075, hw + 0.5], faces: { ny: false } });
  let floor = 0.6;
  if (H >= 6.5) {
    // the hakama: a flared skirt of dark boards up to the balcony
    floor = H - 3.6;
    b.lathe('plaster', [{ y: 0.6, r: (P + 0.55) * SQ2 }, { y: floor - 0.1, r: (P + 0.12) * SQ2 }], { segments: 4, phase: Math.PI / 4, smooth: false, color: [0.96, 0.94, 0.9] });
    b.lathe('wood_planks_dark', [{ y: 0.58, r: (P + 0.6) * SQ2 }, { y: 1.1, r: (P + 0.52) * SQ2 }], { segments: 4, phase: Math.PI / 4, smooth: false });
    for (let k = 0; k < 4; k++) {
      // a middle post down each face
      b.push([0, 0, 0], (k * Math.PI) / 2);
      b.tube('wood_planks_dark', [0, 0.6, P + 0.55], [0, floor, P + 0.12], 0.08, 0.07, { segments: 4 });
      b.pop();
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.tube('lacquer_red', [sx * (P + 0.5), 0.6, sz * (P + 0.5)], [sx * (P + 0.1), floor, sz * (P + 0.1)], 0.13, 0.12, { segments: 6 });
    }
    // a little door, a white plaster band under the balcony
    const dz = P + 0.42;
    b.quad('door', [[-0.42, 0.62, dz + 0.02], [0.42, 0.62, dz + 0.02], [0.42, 2.1, dz - 0.18], [-0.42, 2.1, dz - 0.18]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    b.box('plaster', [2 * P + 0.3, 0.36, 2 * P + 0.3], { at: [0, floor - 0.3, 0], faces: { ny: false, py: false } });
    // the balcony: a deck, posts and a lacquered rail all round
    b.box('wood_planks_dark', [2 * P + 1.2, 0.16, 2 * P + 1.2], { at: [0, floor, 0] });
    for (let k = 0; k < 4; k++) {
      b.push([0, 0, 0], (k * Math.PI) / 2);
      b.box('lacquer_red', [2 * P + 1.1, 0.08, 0.08], { at: [0, floor + 0.62, P + 0.55] });
      b.box('lacquer_red', [2 * P + 1.1, 0.06, 0.06], { at: [0, floor + 0.3, P + 0.55] });
      for (let i = -2; i <= 2; i++) b.box('lacquer_red', [0.07, 0.62, 0.07], { at: [i * (P + 0.5) / 2, floor + 0.32, P + 0.55] });
      b.pop();
    }
  }
  // the open pavilion: four lacquered posts, tie beams, bracket blocks
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.tube('lacquer_red', [sx * P, floor, sz * P], [sx * P, H - 0.1, sz * P], 0.13, 0.12, { segments: 8 });
    b.box('stone_tiles', [0.34, 0.12, 0.34], { at: [sx * P, floor + 0.08, sz * P] });
    b.box('wood_planks_dark', [0.42, 0.18, 0.42], { at: [sx * P, H - 0.05, sz * P] });
  }
  for (let k = 0; k < 4; k++) {
    b.push([0, 0, 0], (k * Math.PI) / 2);
    b.box('lacquer_red', [2 * P + 0.5, 0.24, 0.18], { at: [0, H - 0.32, P], rotUV: true });
    b.box('lacquer_red', [2 * P + 0.3, 0.12, 0.14], { at: [0, H - 0.75, P], rotUV: true });
    b.box('wood_planks_dark', [2 * P + 0.9, 0.16, 0.26], { at: [0, H + 0.08, P + 0.05] });
    b.pop();
  }
  // the roof: a deep hipped roof whose eaves sweep up at the corners, its soffit, a patina finial
  const sq = (_i, _j, a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  const cornerLift = (i) => (_i2, _j, a) => {
    const c = (1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) - 1) / (SQ2 - 1);
    return [0.42, 0.16, 0, 0, 0][i] * c * c;
  };
  const rings = [{ y: H + 0.12, r: 2.55 }, { y: H + 0.5, r: 2.0 }, { y: H + 1.05, r: 1.45 }, { y: H + 1.75, r: 0.85 }, { y: H + 2.15, r: 0.32 }];
  b.lathe('roof_vermilion', rings, {
    segments: 16, smooth: false, radiusFn: sq, yFn: (i, j, a) => cornerLift(i)(i, j, a), normalUp: 0.08,
  });
  b.lathe('wood_planks_dark', [{ y: H + 0.48, r: 1.95 }, { y: H + 0.1, r: 2.5 }], {
    segments: 16, smooth: false, radiusFn: sq, yFn: (i, j, a) => cornerLift(i === 0 ? 1 : 0)(i, j, a) * 0.9, color: DARK,
  });
  b.box('wood_planks_dark', [2 * P + 0.3, 0.08, 2 * P + 0.3], { at: [0, H + 0.2, 0], faces: { py: false }, color: DARK });
  b.lathe('copper_patina', [{ y: H + 2.1, r: 0.36 }, { y: H + 2.3, r: 0.24 }, { y: H + 2.38, r: 0.12 }], { segments: 8, capTop: true });
  b.lathe('copper_patina', [{ y: H + 2.38, r: 0.05 }, { y: H + 2.5, r: 0.16 }, { y: H + 2.66, r: 0.13 }, { y: H + 2.8, r: 0.02 }], { segments: 8 });
  // the bell hangs from the tie beam's middle; the log hangs west of it
  const hangY = H - 0.45;
  b.box('wood_planks_dark', [0.2, 0.2, 2 * P], { at: [0, hangY + 0.1, 0] });
  const R = 0.52;
  const ropeL = 1.0;
  return {
    hang: [0, hangY, 0], R, foot: hw + 0.3, lampAt: [0.9, hangY - 0.2, -0.9],
    log: { pivot: [-(R + 0.82), hangY + 0.05, 0], ropeL, len: 1.5, r: 0.13 },
  };
}

/**
 * The shrine's striking log: hung on two ropes from a pivot west of the bell; `ring` flings it in,
 * it strikes the bonshō's side (contact: its east end at the bell's skin), bounces and settles.
 * @param {PropFactory} f
 * @param {{ pivot: number[], ropeL: number, len: number, r: number }} log
 * @param {ReturnType<typeof makeBell>} bell
 */
function logSwing(f, log, bell) {
  const lb = f.builder();
  const { ropeL, len, r } = log;
  lb.tube('bark', [-len / 2, -ropeL, 0], [len / 2, -ropeL, 0], r, r * 0.92, { segments: 7, capTop: 'wood_planks', capBottom: 'wood_planks' });
  for (const s of [-1, 1]) lb.box('rope', [0.03, ropeL, 0.03], { at: [s * len * 0.3, -ropeL / 2, 0] });
  const built = lb.build('belfry:log', { castShadow: false });
  f.track(built.geometries);
  const g = built.group;
  g.position.set(log.pivot[0], log.pivot[1], log.pivot[2]);
  g.userData.dynamic = true;
  // the log swings in the x–y plane about the pivot (rotation z > 0 carries its foot toward +x)
  const w = Math.sqrt(9.8 / ropeL);
  // the east end rests 0.1 off the barrel's skin (0.925 R): contact after that much swing
  const contact = 0.1 / ropeL;
  let a = 0, av = 0, awake = false;
  return {
    group: g,
    ring(power = 1) {
      const p = clamp(Number(power) || 0, 0.1, 2);
      a = Math.min(a, -0.05);
      av = 2.6 * p;
      awake = true;
    },
    update(dt) {
      if (!awake) return;
      let left = Math.min(dt, 0.1);
      while (left > 1e-6) {
        const h = Math.min(left, 1 / 120);
        left -= h;
        av += (-w * w * a - 0.6 * av) * h;
        a += av * h;
        if (a > contact) {
          a = contact;
          if (av > 0) {
            bell.nudge(-av * 0.05);
            av = -av * 0.35;
          }
        }
      }
      g.rotation.z = a;
      if (Math.abs(a) + Math.abs(av) * 0.2 < 2e-4) { a = av = 0; g.rotation.z = 0; awake = false; }
    },
  };
}

/**
 * Saltcombe's lighthouse.
 * @param {MeshBuilder} b
 * @param {THREE.Material} glass
 */
function lighthouse(b, H, glass) {
  const r0 = 1.7;
  const r1 = 1.2;
  const rAt = (yy) => r0 + (r1 - r0) * (yy / H);
  const seg = 16;
  b.lathe('stone_brick', [{ y: -0.05, r: r0 + 0.3 }, { y: 0.6, r: r0 + 0.22 }], { segments: seg, smooth: false, capTop: 'stone_tiles' });
  const y1 = H * 0.45;
  const y2 = H * 0.62;
  b.lathe('lighthouse_wall', [{ y: 0.6, r: rAt(0.6) }, { y: y1, r: rAt(y1) }], { segments: seg, smooth: true });
  b.lathe('lighthouse_band', [{ y: y1, r: rAt(y1) }, { y: y2, r: rAt(y2) }], { segments: seg, smooth: true });
  b.lathe('lighthouse_wall', [{ y: y2, r: rAt(y2) }, { y: H, r: r1 }], { segments: seg, smooth: true });
  // the door (south) under a little hood, three windows up the tower
  const dz = rAt(1.6) + 0.02;
  b.quad('door', [[-0.45, 0.62, dz], [0.45, 0.62, dz], [0.45, 2.3, dz - 0.05], [-0.45, 2.3, dz - 0.05]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.box('stone_tiles', [1.2, 0.14, 0.5], { at: [0, 2.45, dz + 0.15], rot: [0.2, 0, 0] });
  for (const [wy, wx] of [[H * 0.3, 0.3], [H * 0.55, -0.35], [H * 0.8, 0.25]]) {
    const wz = rAt(wy) + 0.01;
    b.quad(TRIM, [[wx - 0.2, wy, wz], [wx + 0.2, wy, wz], [wx + 0.2, wy + 0.55, wz], [wx - 0.2, wy + 0.55, wz]], [[0, 0], [1, 0], [1, 1], [0, 1]], { color: [0.3, 0.32, 0.4] });
    b.box('stone_tiles', [0.56, 0.08, 0.14], { at: [wx, wy - 0.04, wz + 0.04] });
  }
  // the gallery: corbels, a stone deck, an iron railing
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.box('stone_tiles', [0.22, 0.3, 0.4], { at: [Math.cos(a) * (r1 + 0.12), H - 0.2, -Math.sin(a) * (r1 + 0.12)], rot: -a + Math.PI / 2 });
  }
  b.lathe('stone_tiles', [{ y: H - 0.02, r: r1 + 0.62 }, { y: H + 0.18, r: r1 + 0.62 }], { segments: seg, smooth: false, capTop: true, capBottom: true });
  const rr = r1 + 0.55;
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    b.box('metal', [0.05, 0.85, 0.05], { at: [Math.cos(a) * rr, H + 0.6, -Math.sin(a) * rr] });
    const a2 = ((k + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a) * rr, H + 1.0, -Math.sin(a) * rr];
    const p1 = [Math.cos(a2) * rr, H + 1.0, -Math.sin(a2) * rr];
    b.tube('metal', p0, p1, 0.03, 0.03, { segments: 4 });
  }
  // the lantern room: a low wall, eight panes between mullions, a patina dome, a vent ball
  const lr = 0.85;
  b.lathe('lighthouse_band', [{ y: H + 0.18, r: lr + 0.05 }, { y: H + 0.5, r: lr + 0.05 }], { segments: 8, smooth: false, phase: Math.PI / 8 });
  for (let k = 0; k < 8; k++) {
    const a0 = Math.PI / 8 + (k / 8) * Math.PI * 2;
    const a1 = a0 + Math.PI / 4;
    const p = (a, yy) => [Math.cos(a) * lr, yy, -Math.sin(a) * lr];
    b.quad(glass, [p(a0, H + 0.5), p(a1, H + 0.5), p(a1, H + 1.7), p(a0, H + 1.7)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    b.quad(glass, [p(a1, H + 0.5), p(a0, H + 0.5), p(a0, H + 1.7), p(a1, H + 1.7)], [[0, 0], [1, 0], [1, 1], [0, 1]], { color: [0.7, 0.62, 0.55] });
    const m = p(a0, 0);
    b.box('metal', [0.07, 1.25, 0.07], { at: [m[0], H + 1.1, m[2]] });
  }
  b.lathe('copper_patina', [{ y: H + 1.68, r: lr + 0.22 }, { y: H + 1.84, r: lr + 0.14 }, { y: H + 2.2, r: lr * 0.75 }, { y: H + 2.5, r: lr * 0.35 }, { y: H + 2.62, r: 0.05 }], { segments: 8, phase: Math.PI / 8, smooth: true, capBottom: TRIM });
  b.lathe('metal', [{ y: H + 2.6, r: 0.03 }, { y: H + 2.72, r: 0.16 }, { y: H + 2.86, r: 0.15 }, { y: H + 2.95, r: 0.03 }], { segments: 8 });
  b.tube('metal', [0, H + 2.9, 0], [0, H + 3.5, 0], 0.03, 0.02, { segments: 4 });
  // the fog bell's bracket over the gallery's south edge
  const by = H + 1.55;
  const bz = rr + 0.3;
  b.box('metal', [0.08, 0.08, bz - lr + 0.05], { at: [0, by + 0.1, (bz + lr) / 2] });
  b.tube('metal', [0, H + 0.95, lr + 0.1], [0, by + 0.06, bz - 0.35], 0.035, 0.03, { segments: 4 });
  b.box('metal', [0.2, 0.1, 0.16], { at: [0, by + 0.04, bz] });
  return { hang: [0, by, bz], R: 0.36, foot: r0 + 0.32, lampAt: null };
}

/**
 * Amberfield's abbey tower.
 * @param {MeshBuilder} b
 */
function abbey(b, H, rng) {
  const W = 3.4;
  const hw = W / 2;
  const S = 'abbey_stone';
  const Hc = Math.max(3.4, H - 3.6);
  b.box(S, [W + 0.7, 0.7, W + 0.7], { at: [0, 0.35, 0], faces: { ny: false }, color: [0.92, 0.92, 0.94] });
  b.box(S, [W + 0.4, 0.2, W + 0.4], { at: [0, 0.76, 0], faces: { ny: false }, rot: 0 });
  b.box(S, [W, Hc - 0.6, W], { at: [0, 0.6 + (Hc - 0.6) / 2, 0], faces: { ny: false, py: false } });
  // stepped buttresses, two at each corner, each stage under a sloped cap
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const [ox, oz] of [[0, sz], [sx, 0]]) {
      const cx = ox ? sx * hw : sx * (hw - 0.26);
      const cz = oz ? sz * hw : sz * (hw - 0.26);
      const u = ox ? [0, 0, 1] : [1, 0, 0];
      for (const [ya, yb, dp, k] of [[0, Hc * 0.42, 0.62, 0.96], [Hc * 0.42, Hc * 0.78, 0.38, 1]]) {
        b.box(S, [ox ? dp : 0.46, yb - ya, oz ? dp : 0.46], { at: [cx + ox * dp / 2, (ya + yb) / 2, cz + oz * dp / 2], faces: { ny: false, py: false }, color: [k, k, k * 1.02] });
        const out = [cx + ox * dp, yb, cz + oz * dp];
        const inn = [cx, yb + 0.36, cz];
        const at = (p, t) => [p[0] + u[0] * t, p[1], p[2] + u[2] * t];
        face(b, S, [at(out, -0.23), at(out, 0.23), at(inn, 0.23), at(inn, -0.23)], [ox * 0.6, 0.8, oz * 0.6], (p) => [(p[0] + p[2]) / 2, (p[1] + (ox ? p[0] : p[2]) * 0.6) / 2], [1.06, 1.06, 1.1]);
        for (const t of [-0.23, 0.23]) {
          const tri = [at(out, t), at([cx, yb, cz], t), at(inn, t)];
          const n = [u[0] * Math.sign(t), 0, u[2] * Math.sign(t)];
          const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
          const e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
          const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const T = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0 ? [tri[0], tri[2], tri[1]] : tri;
          b.tri(S, T[0], T[1], T[2], [0, 0], [0.3, 0], [0.3, 0.2], { normal: n, color: [0.9, 0.9, 0.94] });
        }
      }
    }
  }
  // a tall lancet window on the south face (dark glass in a moulded surround)
  const ly = Hc * 0.45;
  const lz = hw + 0.012;
  const lan = archPoints(0.5, ly + 1.3, 0.45, 8);
  const pts = [[-0.25, ly, lz], [0.25, ly, lz], ...lan.slice().reverse().map(([px, py]) => [px, py, lz])];
  b.poly(TRIM, pts, { uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1], color: [0.28, 0.32, 0.42] });
  for (const s of [-1, 1]) b.box(S, [0.12, 1.3, 0.1], { at: [s * 0.31, ly + 0.65, lz + 0.03], color: [1.08, 1.08, 1.1] });
  b.box(S, [0.8, 0.12, 0.18], { at: [0, ly - 0.06, lz + 0.06], color: [1.08, 1.08, 1.1] });
  // string course, the belfry stage (pointed arches; louvred east and west), corbels, parapet
  b.box(S, [W + 0.3, 0.2, W + 0.3], { at: [0, Hc + 0.02, 0], color: [1.06, 1.06, 1.08] });
  const ow = 1.5;
  const ys = Hc + 1.55;
  chamberWalls(b, S, { W, d: 0.42, y0: Hc + 0.12, y1: H, ow, ySill: Hc + 0.42, ys, pointed: 0.45, louvred: ['left', 'right'] });
  b.box('wood_planks_dark', [W - 0.84, 0.1, W - 0.84], { at: [0, Hc + 0.18, 0], faces: { ny: false } });
  for (let k = 0; k < 4; k++) {
    b.push([0, 0, 0], (k * Math.PI) / 2);
    for (let i = -3; i <= 3; i++) b.box(S, [0.2, 0.2, 0.22], { at: [i * 0.48, H - 0.06, hw + 0.08], color: [0.9, 0.9, 0.94] });
    b.box(S, [W + 0.36, 0.7, 0.24], { at: [0, H + 0.4, hw + 0.06], faces: { ny: false } });
    b.box(S, [W + 0.44, 0.1, 0.32], { at: [0, H + 0.79, hw + 0.06], color: [1.06, 1.06, 1.08] });
    b.pop();
  }
  b.box(TRIM, [W - 0.2, 0.08, W - 0.2], { at: [0, H, 0], color: DARK });
  // corner pinnacles
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (hw + 0.02);
    const pz = sz * (hw + 0.02);
    b.box(S, [0.4, 0.5, 0.4], { at: [px, H + 1.0, pz] });
    b.lathe('roof_slate', [{ y: H + 1.25, r: 0.3 }, { y: H + 2.0, r: 0.02 }], { segments: 4, phase: Math.PI / 4, smooth: false, at: [px, 0, pz] });
  }
  // the spire: eight slate facets from inside the parapet
  const sH = W * 1.9;
  b.lathe('roof_slate', [{ y: H + 0.1, r: hw * 1.02 }, { y: H + 0.1 + sH * 0.35, r: hw * 0.62 }, { y: H + 0.1 + sH, r: 0.03 }], { segments: 8, phase: Math.PI / 8, smooth: false });
  finial(b, H + sH - 0.05, 0.9);
  const hangY = ys + 0.55;
  b.box('wood_planks_dark', [0.22, 0.26, W - 0.6], { at: [0, hangY + 0.13, 0] });
  return { hang: [0, hangY, 0], R: 0.62, foot: hw + 0.5, lampAt: [0.95, hangY - 0.3, -0.8] };
}

/**
 * The Bell of Rest's old stone tower (its ice is `citadelIce`).
 * @param {MeshBuilder} b
 */
function citadel(b, H, rng) {
  const W = 4.0;
  const hw = W / 2;
  const S = 'stone_wall';
  const cool = [0.78, 0.82, 0.94];
  const Hc = Math.max(3.6, H - 4.0);
  // a battered foot, the shaft, corbels and a crenellated crown under the bell chamber
  b.lathe(S, [{ y: -0.05, r: (hw + 0.7) * SQ2 }, { y: 1.6, r: (hw + 0.04) * SQ2 }], { segments: 4, phase: Math.PI / 4, smooth: false, color: cool });
  b.box(S, [W, Hc - 1.6, W], { at: [0, 1.6 + (Hc - 1.6) / 2, 0], faces: { ny: false, py: false }, color: cool });
  for (let k = 0; k < 4; k++) {
    b.push([0, 0, 0], (k * Math.PI) / 2);
    for (let i = -3; i <= 3; i++) b.box(S, [0.3, 0.36, 0.3], { at: [i * 0.6, Hc - 0.3, hw + 0.12], color: [0.7, 0.74, 0.86] });
    b.box(S, [W + 0.5, 0.3, 0.3], { at: [0, Hc, hw + 0.1], color: cool });
    b.pop();
  }
  b.box(S, [W + 0.5, 0.24, W + 0.5], { at: [0, Hc + 0.27, 0], faces: { ny: false }, color: [0.86, 0.9, 1.0] });
  // the chamber: big round arches
  const ow = 2.0;
  const ys = Hc + 1.9;
  chamberWalls(b, S, { W, d: 0.5, y0: Hc + 0.38, y1: H, ow, ySill: Hc + 0.55, ys });
  b.box('wood_planks_dark', [W - 1.0, 0.1, W - 1.0], { at: [0, Hc + 0.42, 0], faces: { ny: false }, color: DARK });
  b.box(S, [W + 0.36, 0.26, W + 0.36], { at: [0, H + 0.1, 0], color: [0.86, 0.9, 1.0] });
  // merlons at the eaves' corners, the slate pyramid, a stone finial
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(S, [0.6, 0.6, 0.6], { at: [sx * (hw - 0.1), H + 0.5, sz * (hw - 0.1)], color: cool });
  pyramidRoof(b, 'roof_slate', { y0: H + 0.24, hw: hw + 0.2, h: W * 0.85, inner: hw - 0.4 });
  b.lathe(S, [{ y: H + W * 0.85 + 0.15, r: 0.2 }, { y: H + W * 0.85 + 0.6, r: 0.14 }, { y: H + W * 0.85 + 0.75, r: 0.02 }], { segments: 4, phase: Math.PI / 4, smooth: false, color: cool });
  const hangY = ys + 0.75;
  b.box('wood_planks_dark', [0.3, 0.32, W - 0.7], { at: [0, hangY + 0.16, 0] });
  return { hang: [0, hangY, 0], R: 0.82, foot: hw + 0.7, lampAt: [1.2, hangY - 0.3, -1.1] };
}

/**
 * The citadel's ice: slabs at the foot, sheets up the corners, spires over the roof, icicles under
 * the cornice — one mesh (the ice cliff), a dynamic child that `sublimate` shrinks into the stone.
 * @param {PropFactory} f
 * @returns {THREE.Group}
 */
function citadelIce(f, H, rng) {
  const W = 4.0;
  const hw = W / 2;
  const ib = f.builder();
  const M = f.textures.material('ice_crag', { vertexColors: true, emissive: new THREE.Color('#5fd8f0'), emissiveIntensity: 1 });
  /** A faceted shard from `a` to `b` (a prism of `n` sides tapering to a point). */
  const shard = (a, bp, r, n = 5, twist = 0) => {
    const dir = new THREE.Vector3(bp[0] - a[0], bp[1] - a[1], bp[2] - a[2]);
    const len = dir.length();
    ib.push(a, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    ib.lathe(M, [{ y: 0, r }, { y: len * 0.62, r: r * 0.78 }, { y: len, r: 0.02 }], { segments: n, phase: twist, smooth: false, capBottom: true });
    ib.pop();
  };
  const Hc = Math.max(3.6, H - 4.0);
  // slabs pressed up round the foot, two rings
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const d = hw + 0.55 + rng.range(0, 0.7);
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const px = Math.cos(a) * d * Math.min(1.25, sq);
    const pz = -Math.sin(a) * d * Math.min(1.25, sq);
    const h = rng.range(1.2, 3.2);
    shard([px, -0.3, pz], [px * 0.84 + rng.range(-0.25, 0.25), h, pz * 0.84 + rng.range(-0.25, 0.25)], rng.range(0.4, 0.75), 5, rng.range(0, 3));
  }
  // plates leaning on each face of the shaft, under the chamber
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const t = rng.range(-hw + 0.5, hw - 0.5);
      const y0 = rng.range(0.6, Math.max(1, Hc - 3.5));
      const len = Math.min(Hc - 0.4 - y0, rng.range(2.0, 3.6));
      if (len < 0.8) continue;
      ib.push([0, 0, 0], yaw);
      shard([t, y0, hw + 0.12], [t + rng.range(-0.2, 0.2), y0 + len, hw + 0.05], rng.range(0.32, 0.48), 4, Math.PI / 4);
      ib.pop();
    }
  }
  // sheets up the corners, stacked to the chamber
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const n = 4;
    for (let k = 0; k < n; k++) {
      const y0 = 0.4 + (k * (Hc - 0.4)) / n;
      const px = sx * (hw + 0.12);
      const pz = sz * (hw + 0.12);
      shard([px, y0, pz], [px + sx * rng.range(0, 0.3), y0 + rng.range(1.8, 2.8), pz + sz * rng.range(0, 0.3)], rng.range(0.3, 0.46), 4, Math.PI / 4);
    }
  }
  // spires over the roof: a tall one at each corner, shorter ones between, the apex encased
  const top = H + 0.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (hw - 0.05);
    const pz = sz * (hw - 0.05);
    shard([px, top - 0.3, pz], [px + sx * 0.5, top + rng.range(2.8, 4.2), pz + sz * 0.5], 0.4, 5, rng.range(0, 3));
    shard([px * 0.62, top + 0.5, pz * 0.62], [px * 0.62 + sx * 0.25, top + rng.range(1.6, 2.6), pz * 0.62 + sz * 0.3], 0.26, 4, rng.range(0, 3));
  }
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2 + Math.PI / 4;
    ib.push([0, 0, 0], yaw);
    shard([0, top - 0.2, hw * 0.9], [0, top + rng.range(1.2, 2.0), hw * 1.25], 0.3, 4, rng.range(0, 3));
    ib.pop();
  }
  shard([0, top + W * 0.55, 0], [rng.range(-0.2, 0.2), top + W * 0.85 + rng.range(2.0, 3.0), rng.range(-0.2, 0.2)], 0.55, 6, rng.range(0, 3));
  // icicles under the cornice
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 9; i++) {
      const t = -hw + 0.2 + (i / 8) * (W - 0.4);
      const len = rng.range(0.3, 1.1);
      const at = [t, H - 0.02, hw + 0.2];
      ib.push([0, 0, 0], (k * Math.PI) / 2);
      ib.lathe(M, [{ y: at[1] - len, r: 0.01 }, { y: at[1], r: rng.range(0.05, 0.1) }], { segments: 4, smooth: false, at: [at[0], 0, at[2]] });
      ib.pop();
    }
  }
  const built = ib.build('belfry:ice', { castShadow: false });
  f.track(built.geometries);
  built.group.userData.dynamic = true;
  return built.group;
}

/**
 * The ice's life: shown (scale 1) while the thaw field is frozen at the tower, sublimating into the
 * stone (≈ 4 s) where it thaws, growing back (≈ 2 s) if the frost returns; hidden at 0.
 * @param {THREE.Object3D} ice
 * @param {number} x @param {number} z the tower's point (the field is read there)
 * @returns {(dt: number) => void}
 */
export function sublimate(ice, x, z) {
  let k = -1;
  return (dt) => {
    const target = thawField.at(x, z) >= 0.5 ? 0 : 1;
    if (k < 0) k = target;
    else if (k !== target) k = target > k ? Math.min(1, k + dt / 2) : Math.max(0, k - dt / 4);
    const e = k * k * (3 - 2 * k);
    ice.visible = e > 0.002;
    // shrinking toward the tower's axis and its foot, the spires last
    ice.scale.set(0.55 + 0.45 * e, e, 0.55 + 0.45 * e);
  };
}

/**
 * The Hush Bell's ice arch (props/Crags.js `ice`), its yoke and chain (their own dynamic group,
 * `hanger`, which the belfry hangs under the arch); the arch's colliders — its two legs, which go with
 * its ice (`sublimateArch`) — are the belfry's.
 * @param {PropFactory} f
 * @param {MeshBuilder} b
 */
function hushArch(f, b, x, y, z, H, seed) {
  const span = Math.max(6.5, H * 0.75);
  const arch = buildCrag(f, x, y, z, { kind: 'arch', stone: 'ice', height: H, width: span, rotation: 0, seed });
  const hangY = H * 0.6;
  const hb = f.builder();
  // a heavy chain from the yoke up into the span
  const chainTop = H * 0.8;
  for (let yy = hangY + 0.3; yy < chainTop; yy += 0.24) {
    const turn = Math.round((yy - hangY) / 0.24) % 2;
    hb.box('metal', turn ? [0.06, 0.28, 0.18] : [0.18, 0.28, 0.06], { at: [0, yy, 0], color: [0.55, 0.58, 0.68] });
  }
  // the yoke: an iron beam with two straps down to the bell's crown
  hb.box('metal', [0.3, 0.3, 1.4], { at: [0, hangY + 0.2, 0], color: [0.5, 0.52, 0.62] });
  for (const s of [-1, 1]) hb.box('metal', [0.08, 0.4, 0.1], { at: [0, hangY, s * 0.22], color: [0.5, 0.52, 0.62] });
  const built = hb.build('belfry:hanger');
  f.track(built.geometries);
  built.group.userData.dynamic = true;
  const circles = arch.colliders.map((c) => /** @type {{ type: 'circle', x: number, z: number, r: number }} */ (c));
  return { hang: [0, hangY, 0], R: 1.05, lampAt: null, circles, object: arch.object, hanger: built.group };
}

/** How far a gone leg's collider is put away (u): out of every query. */
const LEG_AWAY = 1e5;
/** The settled Hush Bell's cant (rad) and how far above its rest it starts to lean (u). */
const BELL_CANT = 0.14;
const CANT_FROM = 0.8;

/**
 * The Hush Bell's arch on a level with a frost (`thawField.active`; without one it stands, as in the
 * editor): where the thaw field thaws its spot (`at` ≥ 0.5) it sublimates like the citadel's ice
 * (≈ 4 s; back in ≈ 2 s if the frost returns), melting down toward its feet with its yoke and chain,
 * and the black bell comes down with the yoke until its lip is on the ground, where it settles
 * canted (its mouth kept current: `place`); the legs' colliders go with the ice and come back with it
 * (EVM-26): put far away and back exactly to their place — they stay static (the walk grids keep
 * avoiding them, as while they stand), and the TileMap's collider grid needs no re-index for that: it
 * lists them at their place (or, re-indexed while they are away, in its always-tested list) and tests
 * them exactly, so while they are away nothing finds them. Nothing is made or added: the arch, its iron and the bell are the
 * belfry's own meshes, scaled and moved (no program, no light).
 * @param {THREE.Object3D} arch
 * @param {ReturnType<typeof makeBell>} bell
 * @param {{ x: number }[]} legs its colliders (static: see below)
 * @param {number} hangY where the bell hangs (prop-local)
 * @param {number} x @param {number} z the belfry's point (the field is read there)
 * @returns {(dt: number) => void}
 */
function sublimateArch(arch, bell, legs, hangY, x, z) {
  const home = legs.map((c) => c.x);
  // (the bell's frame: its crown at the origin, its mouth Hb below — resting, a little in the snow)
  const rest = bell.Hb - 0.05;
  let k = -1;
  let last = -1;
  return (dt) => {
    const target = thawField.active && thawField.at(x, z) >= 0.5 ? 0 : 1;
    if (k < 0) k = target;
    else if (k !== target) k = target > k ? Math.min(1, k + dt / 2) : Math.max(0, k - dt / 4);
    if (k === last) return;
    last = k;
    const e = k * k * (3 - 2 * k);
    arch.visible = e > 0.002;
    arch.scale.set(0.85 + 0.15 * e, Math.max(e, 1e-3), 0.6 + 0.4 * e);
    // the yoke comes down with the ice; the bell under it, until it rests
    const y = Math.max(rest, hangY * e);
    bell.group.position.y = y;
    bell.group.rotation.x = BELL_CANT * (1 - clamp((y - rest) / CANT_FROM, 0, 1));
    bell.place();
    const gone = e < 0.35;
    for (let i = 0; i < legs.length; i++) legs[i].x = gone ? home[i] + LEG_AWAY : home[i];
  };
}

// =================================================================================================
// The frost on houses: icicles on the eaves (House.js `icicles`)
// =================================================================================================

/**
 * A house's icicles (EVERMERE_CAMPAIGN.md §5.3, house `opts.icicles`): cut-out cards (`icicles`,
 * alpha) hung under both eaves' fascias, in two or three runs each of their own length and offset,
 * on their own RNG stream (`house:icicles`) — the house itself builds exactly as without them. A
 * dynamic child of the house's root (one draw call, no shadow): shown while the thaw field is
 * frozen at the house, melting up into the eaves (≈ 1.6 s) where it thaws, growing back (≈ 3 s) if
 * the frost returns. Called by props/House.js through the season kit; returns the house's `update`.
 * @param {PropFactory} f
 * @param {THREE.Object3D} group the house's root (placed)
 * @param {{ W: number, hs: number, O: number, Ts: number, pitch: number, ridgeY: number,
 *   gf: boolean, x: number, z: number, seed?: number }} d the roof's numbers (House.js)
 * @returns {(dt: number) => void}
 */
export function houseIcicles(f, group, { W, hs, O, Ts, pitch, ridgeY, gf, x, z, seed }) {
  const rng = f.rng('house:icicles', x, z, seed);
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  const tn = Math.tan(pitch);
  const Lx = W + 2 * O;
  const Ls = (hs + O) / c + Ts * tn;
  const cS = ((hs + O) / c - Ts * tn) / 2;
  // the fascia's lower front edge, in the roof slab's frame (House.js), then in the house's
  const yb = -0.06 - (Ts + 0.16) / 2;
  const zf = Ls / 2 + 0.075;
  const ye = ridgeY - sn * cS + (c * Ts) / 2 + (yb * c - zf * sn);
  const ze = c * cS + (sn * Ts) / 2 + (yb * sn + zf * c);
  const M = f.textures.material('icicles', { vertexColors: true });
  const b = f.builder();
  /** (a house turned gable-front: its internal frame is turned −90° about y) */
  const P = (px, py, pz) => (gf ? [-pz, py, px] : [px, py, pz]);
  for (const s of [-1, 1]) {
    const runs = rng.int(2, 3);
    let x0 = -Lx / 2 + rng.range(0, 0.2);
    for (let r = 0; r < runs; r++) {
      const x1 = r === runs - 1 ? Lx / 2 - rng.range(0, 0.2) : x0 + (Lx / runs) * rng.range(0.75, 1.1);
      const h = rng.range(0.6, 0.95);
      const u0 = rng.range(0, 1);
      const zz = s * (ze + 0.015);
      const pts = [P(x0, -h, zz), P(x1, -h, zz), P(x1, 0, zz), P(x0, 0, zz)];
      const uv = [[u0, 1 - h], [u0 + (x1 - x0) / 2, 1 - h], [u0 + (x1 - x0) / 2, 1], [u0, 1]];
      b.quad(M, s > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]], s > 0 ? uv : [uv[1], uv[0], uv[3], uv[2]], { color: [1.04, 1.06, 1.1] });
      x0 = Math.min(Lx / 2 - 0.3, x1 + rng.range(0.05, 0.35));
      if (x0 >= Lx / 2 - 0.35) break;
    }
  }
  const built = b.build('house:icicles', { castShadow: false });
  f.track(built.geometries);
  const ice = built.group;
  ice.userData.dynamic = true;
  ice.position.y = ye;
  group.add(ice);
  group.updateMatrixWorld(true);
  let k = -1;
  return (dt) => {
    const target = thawField.at(x, z) >= 0.5 ? 0 : 1;
    if (k < 0) k = target;
    else if (k !== target) k = target > k ? Math.min(1, k + dt / 3) : Math.max(0, k - dt / 1.6);
    const e = k * k * (3 - 2 * k);
    ice.visible = e > 0.01;
    ice.scale.y = Math.max(0.01, e);
  };
}
