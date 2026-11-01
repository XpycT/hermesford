import * as THREE from 'three';
import { clamp, smoothstep } from '../../utils/math.js';
import { thawField } from '../ThawField.js';
import { SHIP_BANDS } from '../../pixel/textures/evermereProps.js';

/**
 * @import { PropFactory, PropResult } from '../Props.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 * @import { Collider } from '../TileMap.js'
 */

/**
 * Ships.js — The Bells of Evermere's ships (docs/contracts/EVERMERE_CAMPAIGN.md §3, §5.3): a cog
 * (high clinker sides, an aftcastle and a forecastle, one mast with a square sail on a yard), a
 * sloop (a transom stern, a cabin trunk, a gaff mainsail and a jib on a bowsprit) and a rowboat
 * (thwarts and a pair of oars). (x, y, z): the hull's middle at the waterline (ObjectBuilder gives
 * the water surface); rotation 0 points the bow toward +Z. In the season kit's chunk
 * (../SeasonKitParts.js). Owner: the architecture package.
 *
 *  - The hull, deck, castles, spars, sails, rigging and name boards are **one mesh** on the ship
 *    atlas (pixel/textures/evermereProps.js `ship_atlas`, bands `SHIP_BANDS`: clinker strakes that
 *    follow the sheer, a painted wale, a tarred bottom, deck planks, spar wood, rope, sailcloth, the
 *    name board with carved marks — no words): one draw call and its shadow. `sails`: 'furled' (the
 *    sail rolled on its yard or boom) or 'set'.
 *  - `frozen` (default true): while the thaw field is frozen at the ship (`thawField.at` < 0.5) it
 *    sits heaved up 0.12 and listed (5° toward its gangplank, the bow up 2°) in a collar of pressed-up
 *    sea ice (a second mesh, no shadow); where the field thaws the collar sinks away (≈ 2 s) and the
 *    hull settles (≈ 3 s) and then bobs gently. `frozen: false`: afloat from the start.
 *  - The cog and the sloop are **walkable**: `walkRects` at deck height (stepped with the sheer; kept
 *    at the hull's pose every frame), a step and the gunwale at the gangplank, and the gangplank
 *    itself (a static plank down the starboard side, +X, to the waterline: the ice) in steps of
 *    ≤ 0.42; colliders along the bulwarks (left open at the gangplank), round the castles and the
 *    mast. The rowboat is a solid box.
 * Draw calls: the ship mesh + its shadow, the collar; the gangplank merges into the level's batches.
 * No light. Randomness: `f.rng('ship', x, z, seed)`.
 */

/**
 * @typedef {object} ShipOptions
 * @property {string} [kind] 'cog' | 'sloop' | 'rowboat'
 * @property {boolean} [frozen] locked in the ice while the level is frozen (default true)
 * @property {string} [sails] 'furled' | 'set'
 * @property {number} [rotation]
 * @property {number} [seed]
 * @property {string} [id]
 */

/**
 * The hulls: length, beam, freeboard amidships (the gunwale over the waterline), draft, the
 * sheer's rise at the bow and the stern, the transom's width (0: a pointed stern), the bulwark (the
 * deck under the gunwale; the rowboat's is its floor), the mast's place and height (deck to top),
 * the gangplank's place (z; null: none).
 */
export const SHIP_HULLS = Object.freeze({
  cog: Object.freeze({ L: 8, B: 3, F: 1.6, D: 0.82, bow: 0.5, stern: 0.7, transom: 0, bulwark: 0.55, mast: [0.4, 8.2], plank: -1.1 }),
  sloop: Object.freeze({ L: 6, B: 2.2, F: 1.0, D: 0.65, bow: 0.35, stern: 0.18, transom: 0.55, bulwark: 0.42, mast: [0.8, 7.0], plank: -0.6 }),
  rowboat: Object.freeze({ L: 3.2, B: 1.25, F: 0.45, D: 0.28, bow: 0.16, stern: 0.1, transom: 0.45, bulwark: 0.37, mast: null, plank: null }),
});

/**
 * The hull at a station: `t` from −1 (the stern) to 1 (the bow) → the gunwale's half-width, its
 * height (with the sheer), the keel's depth. Shared with the level checks' copy (tools/lib/
 * levelgen.mjs `shipColliders`, which must agree).
 * @param {typeof SHIP_HULLS[keyof typeof SHIP_HULLS]} H
 * @param {number} t
 */
export function hullStation(H, t) {
  const a = Math.abs(t);
  const hw = t >= 0
    ? (H.B / 2) * Math.pow(Math.max(0, 1 - Math.pow(a, 2.4)), 0.55)
    : H.transom > 0
      ? (H.B / 2) * (1 + (H.transom - 1) * Math.pow(a, 2.2))
      : (H.B / 2) * Math.pow(Math.max(0, 1 - Math.pow(a, 2.6)), 0.55);
  const G = H.F + (t >= 0 ? H.bow : H.stern) * t * t;
  const keel = -H.D * (1 - Math.pow(a, 5) * (t > 0 || H.transom <= 0 ? 0.85 : 0.3));
  return { hw, G, keel };
}

/** The hull's half-width at height y of a station (a round bilge narrowing to the keel). */
function widthAt(st, y) {
  const s = clamp((y - st.keel) / Math.max(1e-3, st.G - st.keel), 0, 1);
  return st.hw * Math.pow(Math.sin((s * Math.PI) / 2), 0.5);
}

/** A texture v in an atlas band, `d` units down from the band's top (kept off its edges). */
const V = (band, d) => 1 - band / 8 - clamp(d, 0.01, 0.99) / 8;

/**
 * A quad wound to face `ref` (its flat normal is used for the light).
 * @param {MeshBuilder} b @param {THREE.Material} M @param {number[][]} P @param {number[][]} uv
 * @param {number[]} ref @param {number[]} [color]
 */
function quad(b, M, P, uv, ref, color) {
  const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
  const e2 = [P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  // (a degenerate first corner: take the other diagonal's)
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) {
    const f1 = [P[2][0] - P[1][0], P[2][1] - P[1][1], P[2][2] - P[1][2]];
    const f2 = [P[3][0] - P[2][0], P[3][1] - P[2][1], P[3][2] - P[2][2]];
    n = [f1[1] * f2[2] - f1[2] * f2[1], f1[2] * f2[0] - f1[0] * f2[2], f1[0] * f2[1] - f1[1] * f2[0]];
  }
  const l = Math.hypot(n[0], n[1], n[2]);
  if (l < 1e-9) return;
  n = n.map((v) => v / l);
  const flip = n[0] * ref[0] + n[1] * ref[1] + n[2] * ref[2] < 0;
  const o = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const nn = flip ? n.map((v) => -v) : n;
  b.quad(M, o.map((i) => P[i]), o.map((i) => uv[i]), { normals: [nn, nn, nn, nn], color });
}

/**
 * A spar or a line: an `n`-sided prism from `a` to `c` (radius r0 → r1), u along it, v round it
 * in a band (from `vOff`).
 * @param {MeshBuilder} b @param {THREE.Material} M
 * @param {number[]} a @param {number[]} c @param {number} r0 @param {number} r1
 * @param {number} n @param {number} band @param {number} [vOff] @param {number[]} [color]
 */
function prism(b, M, a, c, r0, r1, n, band, vOff = 0, color = undefined) {
  const A = new THREE.Vector3(...a);
  const C = new THREE.Vector3(...c);
  const dir = C.clone().sub(A);
  const len = dir.length();
  if (len < 1e-6) return;
  dir.normalize();
  const p = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u1 = new THREE.Vector3().crossVectors(dir, p).normalize();
  const u2 = new THREE.Vector3().crossVectors(dir, u1).normalize();
  const circ = Math.PI * 2 * Math.max(r0, r1);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    /** @type {(ang: number, base: THREE.Vector3, r: number) => number[]} */
    const rim = (ang, base, r) => base.clone().addScaledVector(u1, Math.cos(ang) * r).addScaledVector(u2, Math.sin(ang) * r).toArray();
    const mid = (a0 + a1) / 2;
    const ref = u1.clone().multiplyScalar(Math.cos(mid)).addScaledVector(u2, Math.sin(mid)).toArray();
    const v0 = V(band, vOff + (k / n) * Math.min(circ, 0.9));
    const v1 = V(band, vOff + ((k + 1) / n) * Math.min(circ, 0.9));
    quad(b, M, [rim(a0, A, r0), rim(a0, C, r1), rim(a1, C, r1), rim(a1, A, r0)], [[0, v0], [len / 4, v0], [len / 4, v1], [0, v1]], ref, color);
  }
}

/**
 * A box on the atlas: each face's u along its longer side (/4), v down a band.
 * @param {MeshBuilder} b @param {THREE.Material} M
 * @param {number[]} c centre @param {number[]} s size @param {number} band
 * @param {number[]} [color]
 */
function atlasBox(b, M, c, s, band, color = undefined) {
  const h = s.map((v) => v / 2);
  const P = (dx, dy, dz) => [c[0] + dx * h[0], c[1] + dy * h[1], c[2] + dz * h[2]];
  /** @type {[number[], number[][], number[]][]} */
  const faces = [
    [[1, 0, 0], [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], [s[2], s[1]]],
    [[-1, 0, 0], [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], [s[2], s[1]]],
    [[0, 0, 1], [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [s[0], s[1]]],
    [[0, 0, -1], [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], [s[0], s[1]]],
    [[0, 1, 0], [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], [s[0], s[2]]],
  ];
  for (const [n, pts, [eu, ev]] of faces) {
    const long = Math.max(eu, ev);
    const short = Math.min(eu, ev);
    const swap = ev > eu;
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, bb]) => {
      const [pu, pv] = swap ? [bb, a] : [a, bb];
      return [(pu * long) / 4, V(band, (1 - pv) * short)];
    });
    quad(b, M, pts, uv, n, color);
  }
}

/**
 * A sail as a bilinear patch (corners: foot-fore, foot-aft, head-aft, head-fore), in rows ≤ 1 u
 * tall so each row maps into the band from its own top; `belly` bulges it along `bellyDir`; both
 * faces (the back darker). `uOf(p)` picks u (world along the hull, or a column of the striped cloth).
 */
function sail(b, M, corners, { rows, cols, band, belly, bellyDir, uOf, ref }) {
  const [p00, p10, p11, p01] = corners.map((c) => new THREE.Vector3(...c));
  const at = (s, t) => {
    const lo = p00.clone().lerp(p10, s);
    const hi = p01.clone().lerp(p11, s);
    const p = lo.lerp(hi, t);
    const k = Math.sin(Math.PI * s) * Math.sin(Math.PI * (0.1 + 0.85 * t)) * belly;
    return p.addScaledVector(new THREE.Vector3(...bellyDir), k).toArray();
  };
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows;
    const t1 = (r + 1) / rows;
    for (let cI = 0; cI < cols; cI++) {
      const s0 = cI / cols;
      const s1 = (cI + 1) / cols;
      const P = [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
      // v: down from the row's top edge, per column side
      const top0 = P[3][1], top1 = P[2][1];
      const uv = [[uOf(P[0], cI), V(band, top0 - P[0][1])], [uOf(P[1], cI), V(band, top1 - P[1][1])], [uOf(P[2], cI), V(band, 0)], [uOf(P[3], cI), V(band, 0)]];
      quad(b, M, P, uv, ref);
      quad(b, M, P, uv, ref.map((v) => -v), [0.78, 0.76, 0.74]);
    }
  }
}

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y the water surface (the ground where there is none)
 * @param {number} z
 * @param {ShipOptions} [opts]
 * @returns {PropResult}
 */
export function buildShip(f, x, y, z, opts = {}) {
  const kind = Object.hasOwn(SHIP_HULLS, opts.kind ?? '') ? /** @type {keyof typeof SHIP_HULLS} */ (opts.kind) : 'cog';
  const H = SHIP_HULLS[kind];
  const rng = f.rng('ship', x, z, opts.seed);
  const set = opts.sails === 'set';
  const M = f.textures.material('ship_atlas', { vertexColors: true });
  const hb = f.builder((px, py) => 0.8 + 0.2 * smoothstep(-0.8, 1.2, py));
  const { L } = H;
  const N = kind === 'cog' ? 14 : kind === 'sloop' ? 12 : 8;
  const zAt = (i) => -L / 2 + (i / N) * L;
  const tAt = (i) => (i / N) * 2 - 1;
  const stations = Array.from({ length: N + 1 }, (_, i) => hullStation(H, tAt(i)));
  const floor = kind === 'rowboat';
  const deckY = (st) => (floor ? 0.08 : st.G - H.bulwark);
  const wale = (st) => Math.min(0.7, (st.G - 0.12) * 0.45);
  /** a station's rows: [y, band, d] from the gunwale down to the keel */
  const levels = (st) => {
    const wH = wale(st);
    const yr = st.G - wH;
    const ys = [st.G, yr, Math.max(0.12, yr - 1), 0.12, (0.12 + st.keel) / 2, st.keel].map((v) => Math.max(st.keel, v));
    for (let k = 1; k < ys.length; k++) ys[k] = Math.min(ys[k], ys[k - 1]);
    return ys;
  };
  const rowUV = (k, st, yy) => {
    const wH = wale(st);
    const yr = st.G - wH;
    if (k === 0) return V(SHIP_BANDS.wale, st.G - yy);
    if (k === 1) return V(SHIP_BANDS.hull, yr - yy);
    if (k === 2) return V(SHIP_BANDS.hull, yr - 1 - yy);
    return V(SHIP_BANDS.lower, 0.12 - yy);
  };
  // ---- the hull's sides
  for (const s of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const A = stations[i], B = stations[i + 1];
      const la = levels(A), lb = levels(B);
      for (let k = 0; k < la.length - 1; k++) {
        const P = [
          [s * widthAt(A, la[k]), la[k], zAt(i)], [s * widthAt(B, lb[k]), lb[k], zAt(i + 1)],
          [s * widthAt(B, lb[k + 1]), lb[k + 1], zAt(i + 1)], [s * widthAt(A, la[k + 1]), la[k + 1], zAt(i)],
        ];
        const ua = (zAt(i) + L / 2) / 4, ub = (zAt(i + 1) + L / 2) / 4;
        // (rows k reference their own top: the upper corners at their row's top, the lower ones below)
        const uv = [[ua, rowUV(k, A, la[k])], [ub, rowUV(k, B, lb[k])], [ub, rowUV(k, B, lb[k + 1])], [ua, rowUV(k, A, la[k + 1])]];
        quad(hb, M, P, uv, [s, 0, (tAt(i) + tAt(i + 1)) * 0.3]);
      }
      // the bulwark's inside and its cap rail
      const ya = deckY(A), yb = deckY(B);
      const wi = (st, yy) => Math.max(0, widthAt(st, yy) - 0.09);
      const ua = (zAt(i) + L / 2) / 4, ub = (zAt(i + 1) + L / 2) / 4;
      quad(hb, M, [[s * wi(A, A.G), A.G, zAt(i)], [s * wi(B, B.G), B.G, zAt(i + 1)], [s * wi(B, yb), yb, zAt(i + 1)], [s * wi(A, ya), ya, zAt(i)]],
        [[ua, V(SHIP_BANDS.hull, 0)], [ub, V(SHIP_BANDS.hull, 0)], [ub, V(SHIP_BANDS.hull, B.G - yb)], [ua, V(SHIP_BANDS.hull, A.G - ya)]], [-s, 0, 0], [0.7, 0.66, 0.64]);
      quad(hb, M, [[s * widthAt(A, A.G), A.G, zAt(i)], [s * widthAt(B, B.G), B.G, zAt(i + 1)], [s * wi(B, B.G), B.G, zAt(i + 1)], [s * wi(A, A.G), A.G, zAt(i)]],
        [[ua, V(SHIP_BANDS.wale, 0.02)], [ub, V(SHIP_BANDS.wale, 0.02)], [ub, V(SHIP_BANDS.wale, 0.12)], [ua, V(SHIP_BANDS.wale, 0.12)]], [0, 1, 0], [1.08, 1.06, 1.04]);
    }
  }
  // ---- the deck (or the boat's floor): strips 1 u wide across, seamless (the band repeats per unit)
  for (let i = 0; i < N; i++) {
    const A = stations[i], B = stations[i + 1];
    const ya = deckY(A), yb = deckY(B);
    const wa = Math.max(0, widthAt(A, ya) - 0.09), wb = Math.max(0, widthAt(B, yb) - 0.09);
    for (let k = -2; k < 2; k++) {
      const xa0 = clamp(k, -wa, wa), xa1 = clamp(k + 1, -wa, wa);
      const xb0 = clamp(k, -wb, wb), xb1 = clamp(k + 1, -wb, wb);
      if (xa1 - xa0 < 1e-3 && xb1 - xb0 < 1e-3) continue;
      const ua = (zAt(i) + L / 2) / 4, ub = (zAt(i + 1) + L / 2) / 4;
      quad(hb, M, [[xa0, ya, zAt(i)], [xa1, ya, zAt(i)], [xb1, yb, zAt(i + 1)], [xb0, yb, zAt(i + 1)]],
        [[ua, V(SHIP_BANDS.deck, xa0 - k)], [ua, V(SHIP_BANDS.deck, xa1 - k)], [ub, V(SHIP_BANDS.deck, xb1 - k)], [ub, V(SHIP_BANDS.deck, xb0 - k)]], [0, 1, 0], floor ? [0.8, 0.78, 0.76] : undefined);
    }
  }
  // ---- the stern: a transom (with the inside of its bulwark) or a sternpost; the stem
  const S0 = stations[0];
  if (H.transom > 0) {
    const ls = levels(S0);
    for (let k = 0; k < ls.length - 1; k++) {
      const wa = widthAt(S0, ls[k]), wb = widthAt(S0, ls[k + 1]);
      quad(hb, M, [[-wa, ls[k], -L / 2], [wa, ls[k], -L / 2], [wb, ls[k + 1], -L / 2], [-wb, ls[k + 1], -L / 2]],
        [[-wa / 4, rowUV(k, S0, ls[k])], [wa / 4, rowUV(k, S0, ls[k])], [wb / 4, rowUV(k, S0, ls[k + 1])], [-wb / 4, rowUV(k, S0, ls[k + 1])]], [0, 0, -1]);
    }
    const yd = deckY(S0);
    const wi = Math.max(0, widthAt(S0, yd) - 0.09);
    quad(hb, M, [[-wi, yd, -L / 2 + 0.06], [wi, yd, -L / 2 + 0.06], [wi, S0.G, -L / 2 + 0.06], [-wi, S0.G, -L / 2 + 0.06]],
      [[0, V(SHIP_BANDS.hull, S0.G - yd)], [wi / 2, V(SHIP_BANDS.hull, S0.G - yd)], [wi / 2, V(SHIP_BANDS.hull, 0)], [0, V(SHIP_BANDS.hull, 0)]], [0, 0, 1], [0.7, 0.66, 0.64]);
    quad(hb, M, [[-widthAt(S0, S0.G), S0.G, -L / 2], [widthAt(S0, S0.G), S0.G, -L / 2], [wi, S0.G, -L / 2 + 0.06], [-wi, S0.G, -L / 2 + 0.06]],
      [[0, V(SHIP_BANDS.wale, 0.02)], [0.5, V(SHIP_BANDS.wale, 0.02)], [0.5, V(SHIP_BANDS.wale, 0.1)], [0, V(SHIP_BANDS.wale, 0.1)]], [0, 1, 0]);
    if (!floor) {
      // the name board across the transom
      const bw = Math.min(1.5, widthAt(S0, S0.G - 0.5) * 1.5);
      const by = S0.G - 0.42;
      quad(hb, M, [[-bw / 2, by - 0.16, -L / 2 - 0.03], [bw / 2, by - 0.16, -L / 2 - 0.03], [bw / 2, by + 0.16, -L / 2 - 0.03], [-bw / 2, by + 0.16, -L / 2 - 0.03]],
        [[0.5, V(SHIP_BANDS.board, 0.99)], [0, V(SHIP_BANDS.board, 0.99)], [0, V(SHIP_BANDS.board, 0.01)], [0.5, V(SHIP_BANDS.board, 0.01)]], [0, 0, -1]);
    }
  } else {
    prism(hb, M, [0, S0.keel + 0.05, -L / 2 + 0.05], [0, S0.G + 0.35, -L / 2 - 0.2], 0.1, 0.09, 4, SHIP_BANDS.spar);
  }
  const SN = stations[N];
  prism(hb, M, [0, stations[N - 1].keel, L / 2 - 0.25], [0, SN.G + (floor ? 0.12 : 0.4), L / 2 + 0.18], 0.1, 0.085, 4, SHIP_BANDS.spar);
  // ---- the name boards on the bows (cog, sloop), following the hull's side
  if (!floor) {
    const i0 = Math.round(N * 0.74), i1 = i0 + 1;
    for (const s of [-1, 1]) {
      const A = stations[i0], B = stations[i1];
      const pa = (st, yy, zz) => [s * (widthAt(st, yy) + 0.02), yy, zz];
      const ya0 = A.G - wale(A) - 0.36, ya1 = A.G - wale(A) - 0.06;
      const yb0 = B.G - wale(B) - 0.36, yb1 = B.G - wale(B) - 0.06;
      const uL = s > 0 ? 0 : 0.5, uR = s > 0 ? 0.5 : 0;
      quad(hb, M, [pa(A, ya0, zAt(i0)), pa(B, yb0, zAt(i1)), pa(B, yb1, zAt(i1)), pa(A, ya1, zAt(i0))],
        [[uL, V(SHIP_BANDS.board, 0.99)], [uR, V(SHIP_BANDS.board, 0.99)], [uR, V(SHIP_BANDS.board, 0.01)], [uL, V(SHIP_BANDS.board, 0.01)]], [s, 0, 0.2]);
    }
  }
  // ---- castles, spars, sails, rigging, oars
  /** local collider boxes [minX, maxX, minZ, maxZ] and circles [x, z, r] */
  const boxes = [];
  const circles = [];
  const mid = stations[Math.round(N / 2)];
  const deckMid = deckY(mid);
  let masthead = null;
  if (kind === 'cog') {
    // the aftcastle: a deck house with a railed roof
    const z0 = -L / 2 + 0.55, z1 = -L / 2 + 2.45;
    const ia = Math.round(((z0 + L / 2) / L) * N);
    const cw = Math.max(0.6, widthAt(stations[ia], deckY(stations[ia])) - 0.12);
    const yb = deckY(stations[Math.round(((z1 + L / 2) / L) * N)]);
    const yt = yb + 1.45;
    atlasBox(hb, M, [0, (yb + yt) / 2, (z0 + z1) / 2], [cw * 2, yt - yb, z1 - z0], SHIP_BANDS.hull, [0.92, 0.88, 0.86]);
    for (let k = -1; k < 1; k++) {
      const xa = Math.max(k, -cw), xb = Math.min(k + 1, cw);
      quad(hb, M, [[xa, yt + 0.005, z0], [xb, yt + 0.005, z0], [xb, yt + 0.005, z1], [xa, yt + 0.005, z1]],
        [[0, V(SHIP_BANDS.deck, xa - k)], [0, V(SHIP_BANDS.deck, xb - k)], [(z1 - z0) / 4, V(SHIP_BANDS.deck, xb - k)], [(z1 - z0) / 4, V(SHIP_BANDS.deck, xa - k)]], [0, 1, 0]);
    }
    // a door into it from the waist, rails round its roof
    quad(hb, M, [[-0.32, yb, z1 + 0.01], [0.32, yb, z1 + 0.01], [0.32, yb + 1.05, z1 + 0.01], [-0.32, yb + 1.05, z1 + 0.01]],
      [[0.5, V(SHIP_BANDS.lower, 0.6)], [0.66, V(SHIP_BANDS.lower, 0.6)], [0.66, V(SHIP_BANDS.lower, 0.2)], [0.5, V(SHIP_BANDS.lower, 0.2)]], [0, 0, 1]);
    for (const [ax, az, bx, bz] of [[-cw, z0, -cw, z1], [cw, z0, cw, z1], [-cw, z1, cw, z1], [-cw, z0, cw, z0]]) {
      prism(hb, M, [ax, yt + 0.5, az], [bx, yt + 0.5, bz], 0.04, 0.04, 4, SHIP_BANDS.spar);
      for (let k = 0; k <= 3; k++) {
        const px = ax + ((bx - ax) * k) / 3, pz = az + ((bz - az) * k) / 3;
        prism(hb, M, [px, yt, pz], [px, yt + 0.5, pz], 0.035, 0.035, 4, SHIP_BANDS.spar);
      }
    }
    boxes.push([-cw - 0.05, cw + 0.05, z0 - 0.1, z1 + 0.05]);
    // the forecastle: a railed platform over the bow
    const f0 = L / 2 - 2.1, f1 = L / 2 - 0.5;
    const iF = Math.round(((f0 + L / 2) / L) * N);
    const fw = Math.max(0.5, widthAt(stations[iF], deckY(stations[iF])) - 0.12);
    const fy = deckY(stations[iF]) + 0.95;
    atlasBox(hb, M, [0, fy - 0.06, (f0 + f1) / 2], [fw * 2, 0.12, f1 - f0], SHIP_BANDS.deck);
    atlasBox(hb, M, [0, (deckY(stations[iF]) + fy) / 2, f0], [fw * 2, fy - deckY(stations[iF]), 0.1], SHIP_BANDS.hull, [0.85, 0.82, 0.8]);
    prism(hb, M, [-fw, fy + 0.45, f0], [fw, fy + 0.45, f0], 0.04, 0.04, 4, SHIP_BANDS.spar);
    for (const sx of [-1, 1]) prism(hb, M, [sx * fw, fy, f0], [sx * fw, fy + 0.45, f0], 0.035, 0.035, 4, SHIP_BANDS.spar);
    boxes.push([-fw - 0.05, fw + 0.05, f0 - 0.1, L / 2]);
  }
  if (kind === 'sloop') {
    // a cabin trunk aft of the mast
    const c0 = -L / 2 + 1.0, c1 = -0.6;
    const ic = Math.round(((c0 + L / 2) / L) * N);
    const cw = Math.max(0.5, widthAt(stations[ic], deckY(stations[ic])) - 0.32);
    const yb = deckY(mid);
    atlasBox(hb, M, [0, yb + 0.28, (c0 + c1) / 2], [cw * 2, 0.56, c1 - c0], SHIP_BANDS.hull, [0.95, 0.9, 0.88]);
    atlasBox(hb, M, [0, yb + 0.6, (c0 + c1) / 2], [cw * 2 + 0.1, 0.08, c1 - c0 + 0.1], SHIP_BANDS.deck);
    boxes.push([-cw - 0.05, cw + 0.05, c0 - 0.05, c1 + 0.05]);
  }
  if (H.mast) {
    const [mz, mh] = H.mast;
    const top = deckMid + mh;
    masthead = [0, top - 0.3, mz];
    prism(hb, M, [0, deckMid - 0.2, mz], [0, top, mz], 0.15, 0.1, 6, SHIP_BANDS.spar);
    atlasBox(hb, M, [0, top - 0.55, mz], [0.42, 0.18, 0.42], SHIP_BANDS.spar, [0.85, 0.8, 0.78]);
    circles.push([0, mz, 0.3]);
    const fore = SN.G + 0.35;
    if (kind === 'cog') {
      // the yard and its square sail (set: the striped cloth, columns of 1.5 u)
      const yy = deckMid + mh * (set ? 0.8 : 0.66);
      const yw = 2.55;
      prism(hb, M, [-yw, yy, mz + 0.22], [yw, yy, mz + 0.22], 0.08, 0.08, 6, SHIP_BANDS.spar);
      if (set) {
        const foot = deckMid + 1.7;
        sail(hb, M, [[-2.25, foot, mz + 0.3], [2.25, foot, mz + 0.3], [2.25, yy - 0.1, mz + 0.3], [-2.25, yy - 0.1, mz + 0.3]], {
          rows: Math.ceil((yy - 0.1 - foot) / 0.95), cols: 3, band: SHIP_BANDS.board, belly: 0.5, bellyDir: [0, 0, 1], ref: [0, 0, 1],
          uOf: (p, c) => 0.5 + (p[0] + 2.25 - c * 1.5) / 4,
        });
        for (const sx of [-1, 1]) prism(hb, M, [sx * 2.25, foot, mz + 0.3], [sx * widthAt(mid, mid.G), mid.G + 0.05, mz - 1.4], 0.025, 0.025, 4, SHIP_BANDS.rope);
      } else {
        prism(hb, M, [-2.3, yy - 0.2, mz + 0.26], [2.3, yy - 0.2, mz + 0.26], 0.2, 0.2, 6, SHIP_BANDS.sail);
        for (const gx of [-1.6, -0.6, 0.6, 1.6]) prism(hb, M, [gx, yy - 0.42, mz + 0.26], [gx, yy + 0.02, mz + 0.26], 0.03, 0.03, 4, SHIP_BANDS.rope);
      }
      for (const sx of [-1, 1]) prism(hb, M, [sx * yw, yy, mz + 0.22], [0, top - 0.4, mz], 0.022, 0.022, 4, SHIP_BANDS.rope);
      prism(hb, M, masthead, [0, fore, L / 2 + 0.1], 0.03, 0.03, 4, SHIP_BANDS.rope);
    } else {
      // the bowsprit, the boom and gaff, the mainsail and the jib
      const bs = [0, fore + 0.25, L / 2 + 1.7];
      prism(hb, M, [0, SN.G - 0.1, L / 2 - 0.7], bs, 0.09, 0.06, 6, SHIP_BANDS.spar);
      const boomA = [0, deckMid + 1.05, mz - 0.2], boomB = [0, deckMid + 1.2, mz - 3.3];
      prism(hb, M, boomA, boomB, 0.07, 0.06, 6, SHIP_BANDS.spar);
      const gaffA = [0, deckMid + 4.6, mz - 0.18], gaffB = [0, deckMid + 6.0, mz - 2.7];
      prism(hb, M, gaffA, gaffB, 0.06, 0.05, 6, SHIP_BANDS.spar);
      if (set) {
        sail(hb, M, [[0, boomA[1] + 0.06, mz - 0.25], [0, boomB[1] + 0.06, boomB[2] + 0.1], [0, gaffB[1] - 0.06, gaffB[2] + 0.1], [0, gaffA[1] - 0.06, mz - 0.25]], {
          rows: 6, cols: 4, band: SHIP_BANDS.sail, belly: 0.35, bellyDir: [1, 0, 0], ref: [1, 0, 0], uOf: (p) => (p[2] + L / 2) / 4,
        });
        const head = [0, top - 0.5, mz + 0.06];
        const clew = [0, deckMid + 1.3, mz + 1.15];
        sail(hb, M, [clew, [0, bs[1] + 0.05, bs[2] - 0.1], head, head], {
          rows: 6, cols: 3, band: SHIP_BANDS.sail, belly: 0.25, bellyDir: [1, 0, 0], ref: [1, 0, 0], uOf: (p) => (p[2] + L / 2) / 4,
        });
      } else {
        prism(hb, M, [0, boomA[1] + 0.18, mz - 0.35], [0, boomB[1] + 0.16, boomB[2] + 0.2], 0.17, 0.12, 6, SHIP_BANDS.sail);
      }
      prism(hb, M, masthead, bs, 0.025, 0.025, 4, SHIP_BANDS.rope);
      prism(hb, M, masthead, [0, S0.G + 0.05, -L / 2 + 0.1], 0.025, 0.025, 4, SHIP_BANDS.rope);
    }
    // shrouds
    for (const sx of [-1, 1]) {
      for (const dz of kind === 'cog' ? [-0.5, -0.95, -1.4] : [-0.45, -0.9]) {
        const st = hullStation(H, ((mz + dz) / L) * 2);
        prism(hb, M, [0, top - 0.6, mz], [sx * widthAt(st, st.G), st.G + 0.02, mz + dz], 0.022, 0.022, 4, SHIP_BANDS.rope);
      }
    }
  }
  if (floor) {
    // thwarts, oars shipped across them
    for (const tz of [-0.45, 0.55]) {
      const st = hullStation(H, (tz / L) * 2);
      const w = Math.max(0.2, widthAt(st, 0.3) - 0.04);
      atlasBox(hb, M, [0, 0.3, tz], [w * 2, 0.06, 0.26], SHIP_BANDS.deck);
    }
    for (const sx of [-1, 1]) {
      const ox = sx * 0.25;
      prism(hb, M, [ox, 0.4, -1.2 + rng.range(-0.1, 0.1)], [ox + sx * 0.05, 0.42, 1.0], 0.035, 0.035, 5, SHIP_BANDS.spar);
      atlasBox(hb, M, [ox + sx * 0.05, 0.41, 1.25], [0.12, 0.025, 0.5], SHIP_BANDS.spar);
    }
  }
  // the gangplank's step inside the bulwark (it moves with the hull)
  let plank = null;
  if (H.plank != null) {
    const pz = H.plank;
    const st = hullStation(H, (pz / L) * 2);
    const yd = deckY(st);
    const wIn = Math.max(0, widthAt(st, yd) - 0.09);
    atlasBox(hb, M, [wIn - 0.18, yd + 0.135, pz], [0.36, 0.27, 0.8], SHIP_BANDS.deck);
    plank = { z: pz, yd, wIn, G: st.G, wOut: widthAt(st, st.G) };
  }
  const built = hb.build(`ship:${kind}`);
  f.track(built.geometries);
  const hull = built.group;
  hull.userData.dynamic = true;

  // ---- the collar of pressed-up sea ice (frozen ships)
  let collar = null;
  if (opts.frozen !== false) {
    const cb = f.builder();
    const ice = f.textures.material('ice_crag_top', { vertexColors: true });
    const sc = kind === 'rowboat' ? 0.6 : 1;
    const up = new THREE.Vector3(0, 1, 0);
    const n = kind === 'rowboat' ? 10 : 20;
    for (let k = 0; k < n; k++) {
      const s = k % 2 ? 1 : -1;
      const t = -0.95 + (1.9 * Math.floor(k / 2)) / Math.max(1, Math.ceil(n / 2) - 1);
      const st = hullStation(H, t);
      const w = widthAt(st, 0.1);
      const zz = (t * L) / 2;
      // a broken floe heaved up round the waterline
      const r = rng.range(0.3, 0.62) * sc;
      f.rockGeom(cb, s * (w + r * 0.55), -0.05, zz, [r, r * rng.range(0.45, 0.8), r * 0.85], rng, { top: ice, side: ice, detail: 0, flatTop: 0.35, yaw: rng.range(0, 6.28), rough: 0.35, sink: 0.25 });
      // a slab of the pressure ridge tipped up against the hull
      if (k % 3 !== 2) {
        const len = rng.range(0.55, 0.95) * sc;
        const a0 = [s * (w + 0.45 * sc), -0.15, zz + rng.range(-0.2, 0.2)];
        const dir = new THREE.Vector3(-s * rng.range(0.4, 0.7), 1, rng.range(-0.2, 0.2)).normalize();
        cb.push(a0, new THREE.Quaternion().setFromUnitVectors(up, dir));
        cb.lathe(ice, [{ y: 0, r: 0.26 * sc }, { y: len * 0.8, r: 0.2 * sc }, { y: len, r: 0.04 }], { segments: 4, phase: rng.range(0, 1.5), smooth: false, scale: [1, 1, 0.45] });
        cb.pop();
      }
    }
    for (const e of [-1, 1]) {
      const r = rng.range(0.45, 0.75) * sc;
      f.rockGeom(cb, rng.range(-0.2, 0.2), -0.05, e * (L / 2 + r * 0.5), [r, r * 0.6, r], rng, { top: ice, side: ice, detail: 0, flatTop: 0.3, yaw: rng.range(0, 6.28), rough: 0.35, sink: 0.25 });
    }
    const cbuilt = cb.build(`ship:${kind}:collar`, { castShadow: false });
    f.track(cbuilt.geometries);
    collar = cbuilt.group;
    collar.userData.dynamic = true;
  }

  // ---- the static part: the gangplank down the starboard side
  const sb = f.builder();
  const plankRects = [];
  if (plank) {
    const drop = plank.G - 0.05;
    const n = Math.max(2, Math.ceil(drop / 0.42));
    const run = n * 0.5;
    const x0 = plank.wOut - 0.05;
    const x1 = x0 + run;
    const len = Math.hypot(run, drop);
    const ang = Math.atan2(drop, run);
    sb.box('wood_planks', [len, 0.08, 0.72], { at: [(x0 + x1) / 2, (plank.G + 0.05) / 2 + 0.04, plank.z], rot: [0, 0, -ang] });
    for (let k = 1; k < n * 2; k++) {
      const t = k / (n * 2);
      sb.box('wood_planks_dark', [0.05, 0.04, 0.7], { at: [x0 + run * t, plank.G - drop * t + 0.09, plank.z] });
    }
    for (const s of [-1, 1]) {
      sb.box('rope', [len, 0.03, 0.03], { at: [(x0 + x1) / 2, (plank.G + 0.05) / 2 + 0.75, plank.z + s * 0.38], rot: [0, 0, -ang] });
      for (const t of [0.15, 0.85]) sb.box('wood_planks_dark', [0.05, 0.7, 0.05], { at: [x0 + run * t, plank.G - drop * t + 0.4, plank.z + s * 0.38] });
    }
    for (let k = 0; k < n; k++) {
      const xa = x0 + (run * k) / n, xb = x0 + (run * (k + 1)) / n;
      plankRects.push({ lx0: xa, lx1: xb, lz0: plank.z - 0.36, lz1: plank.z + 0.36, y: plank.G - (drop * (k + 0.5)) / n + 0.06, moves: false });
    }
  }
  const rot = Number(opts.rotation) || 0;
  const group = f.finish(sb, `ship:${kind}`, x, y, z, rot);
  group.add(hull);
  if (collar) group.add(collar);
  group.updateMatrixWorld(true);

  // ---- walk surfaces and colliders (local rects → world)
  /** @type {{ lx0: number, lx1: number, lz0: number, lz1: number, y: number, moves: boolean }[]} */
  const local = [...plankRects];
  if (!floor) {
    for (let i = 0; i < N; i++) {
      const A = stations[i], B = stations[i + 1];
      const w = Math.min(widthAt(A, deckY(A)), widthAt(B, deckY(B))) - 0.25;
      if (w < 0.45) continue;
      local.push({ lx0: -w, lx1: w, lz0: zAt(i), lz1: zAt(i + 1), y: Math.max(deckY(A), deckY(B)), moves: true });
    }
    if (plank) {
      local.push({ lx0: plank.wIn - 0.36, lx1: plank.wIn, lz0: plank.z - 0.36, lz1: plank.z + 0.36, y: plank.yd + 0.27, moves: true });
      local.push({ lx0: plank.wIn, lx1: plank.wOut + 0.05, lz0: plank.z - 0.36, lz1: plank.z + 0.36, y: plank.G, moves: true });
    }
  }
  /** @type {{ rect: { minX: number, maxX: number, minZ: number, maxZ: number, y: number }, base: number, cx: number, cz: number, moves: boolean }[]} */
  const walk = [];
  for (const r of local) {
    for (const wr of f.localRects(group, r.lx0, r.lx1, r.lz0, r.lz1)) {
      walk.push({ rect: { ...wr, y: y + r.y }, base: y + r.y, cx: (r.lx0 + r.lx1) / 2, cz: (r.lz0 + r.lz1) / 2, moves: r.moves });
    }
  }
  /** @type {Collider[]} */
  const colliders = [];
  if (floor) colliders.push(...f.boxColliders(group, -H.B / 2, H.B / 2, -L / 2, L / 2));
  else {
    // the bulwarks: circles every ≈ 0.45 along both sides and round the ends (open at the plank)
    const pts = [];
    for (let i = 0; i <= N * 2; i++) {
      const t = (i / (N * 2)) * 2 - 1;
      const st = hullStation(H, t);
      const zz = (t * L) / 2;
      for (const s of [-1, 1]) {
        if (plank && s > 0 && Math.abs(zz - plank.z) < 0.5) continue;
        pts.push([s * Math.max(0, st.hw - 0.12), zz]);
      }
    }
    for (const [lx, lz] of pts) {
      const p = f.world(group, new THREE.Vector3(lx, 0, lz));
      colliders.push({ type: 'circle', x: p.x, z: p.z, r: 0.24 });
    }
    for (const [mnx, mxx, mnz, mxz] of boxes) colliders.push(...f.boxColliders(group, mnx, mxx, mnz, mxz));
    for (const [cx, cz, r] of circles) {
      const p = f.world(group, new THREE.Vector3(cx, 0, cz));
      colliders.push({ type: 'circle', x: p.x, z: p.z, r });
    }
  }

  // ---- the life: frozen (heaved, listed, in its collar) → afloat (settling, bobbing)
  const roll = plank ? -0.09 : (rng.chance(0.5) ? 1 : -1) * 0.07;
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  let k = -1;
  let time = rng.range(0, 10);
  const pose = { heave: 0, roll: 0, pitch: 0 };
  const update = (dt) => {
    const target = opts.frozen !== false && thawField.at(x, z) < 0.5 ? 1 : 0;
    if (k < 0) k = target;
    else if (k !== target) k = target > k ? Math.min(1, k + dt / 1.5) : Math.max(0, k - dt / 3);
    time = (time + dt) % 628.3;
    const e = k * k * (3 - 2 * k);
    const bob = 1 - e;
    pose.heave = 0.12 * e + bob * 0.045 * Math.sin(1.1 * time + ph[0]);
    pose.roll = roll * e + bob * 0.022 * Math.sin(0.8 * time + ph[1]);
    pose.pitch = -0.035 * e + bob * 0.012 * Math.sin(0.62 * time + ph[2]);
    hull.position.y = pose.heave;
    hull.rotation.set(pose.pitch, 0, pose.roll);
    if (collar) {
      collar.visible = e > 0.01;
      collar.position.y = -0.7 * (1 - e);
    }
    const sr = Math.sin(pose.roll), sp = Math.sin(pose.pitch);
    for (const w of walk) if (w.moves) w.rect.y = w.base + pose.heave + w.cx * sr - w.cz * sp;
  };
  return f.result(group, { colliders, walkRects: walk.map((w) => w.rect), update });
}
