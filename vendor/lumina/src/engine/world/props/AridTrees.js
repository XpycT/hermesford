import { clamp, smoothstep, lerp } from '../../utils/math.js';
import { GOLDEN, swayFn } from './Trees.js';

/**
 * AridTrees.js — the arid tree kinds of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §6.2, docs/design/ARID_LOOK.md §5): juniper (gnarled stems, flat pads of blue-green cards), deadwood
 * (bare forking limbs, sun-bleached), palm (a curved ringed trunk, arching folded fronds, a skirt of
 * dead ones, dates), cypress (a narrow flame of foliage shells and cards); juniper and deadwood also
 * `charred`. Their textures are ./AridPropTextures.js's. Part of the set-piece kit's chunk
 * (src/engine/world/SetPieceKit.js): `buildTree` (./Trees.js) calls `ARID_TREES[kind]` of the
 * loaded kit with the RNG it made, so a tree builds exactly as it did inside Trees.js. Owner: the
 * arid package.
 */

// ---------------------------------------------------------------------------------------------
// The arid trees (DRAGON_CAMPAIGN.md §5.3, §6.2): juniper, deadwood, palm, cypress
// ---------------------------------------------------------------------------------------------

/**
 * One camera-facing leaf card (the broadleaf canopy's method): a card `size` = [w, h] units at `P`
 * (16 px per unit: the texture's own size) whose normals point out of the clump volume centred at
 * `C` (radii `R`), biased up, so a crown of cards shades like one soft volume; `occ` darkens it (the
 * interior, the underside); `roll` turns it in its plane by up to that many radians.
 */
function leafCard(b, mat, P, C, R, size, rng, tint, occ, roll0 = 0.25) {
  const hw = size[0] / 2;
  const h = size[1] / 2;
  const dx0 = (P[0] - C[0]) / R[0];
  const dy0 = (P[1] - C[1]) / R[1];
  const dz0 = (P[2] - C[2]) / R[2];
  b.phase = rng.range(0, 6.283);
  b.center = P;
  const roll = rng.range(-roll0, roll0);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const tv = rng.range(-0.07, 0.07);
  const pts = [];
  const normals = [];
  const colors = [];
  const sz = Math.max(size[0], size[1]);
  for (const [ox, oy] of [[-hw, -h], [hw, -h], [hw, h], [-hw, h]]) {
    const rx = ox * cr - oy * sr;
    const ry = ox * sr + oy * cr;
    pts.push([P[0] + rx, P[1] + ry, P[2]]);
    const nx = dx0 + (rx / sz) * 0.5;
    const ny = dy0 + (ry / sz) * 0.6 + 0.45;
    const nz = dz0 + 0.25;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normals.push([nx / nl, ny / nl, nz / nl]);
    const v = (oy < 0 ? 0.8 : 1.06) * occ * (1 + tv);
    colors.push([tint[0] * v, tint[1] * v, tint[2] * v]);
  }
  b.quad(mat, pts, [[0, 0], [1, 0], [1, 1], [0, 1]], { normals, colors });
  b.center = [0, 0, 0];
}

/** @param {number[]} v @returns {number[]} */
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * A crooked limb: a chain of `joints` tubes from `p0` along `dir`, `len` long, tapering from r0 to
 * r1, its direction wandering by up to `bend` at each joint (and lifted by `rise`).
 * @returns {{ tip: number[], dir: number[] }} the tip and the last direction
 */
function limb(b, mat, p0, dir, len, r0, r1, rng, { joints = 3, bend = 0.35, rise = 0, segments = 5 } = {}) {
  let p = p0;
  let d = normalize3(dir);
  for (let k = 0; k < joints; k++) {
    d = normalize3([d[0] + rng.range(-bend, bend), d[1] + rise + rng.range(-bend, bend) * 0.5, d[2] + rng.range(-bend, bend)]);
    const seg = len / joints;
    const q = [p[0] + d[0] * seg, p[1] + d[1] * seg, p[2] + d[2] * seg];
    b.tube(mat, p, q, lerp(r0, r1, k / joints), lerp(r0, r1, (k + 1) / joints), { segments, rings: 2, uRepeat: 1 });
    p = q;
  }
  return { tip: p, dir: d };
}

/**
 * Juniper: short and gnarled — two or three twisted stems from a flared root, shaggy grey-brown
 * bark, a dense dark blue-green crown in flat pads at the stem tips (billboard leaf cards), now and
 * then a dead silver branch. Charred: black stems and a few burnt, sparse tufts.
 */
function buildJuniper(f, rng, H, x, y, z, yaw, charred) {
  const b = f.builder();
  const barkMat = f.windMaterial(charred ? 'bark_charred' : 'juniper_bark');
  const leafMat = f.foliageMaterial(charred ? 'juniper_charred' : 'juniper', { billboard: true });
  const sway = swayFn(H, H * 0.35);
  b.sway = (px, py, pz) => sway(px, py, pz) * 0.75;
  const r0 = Math.max(0.13, H * 0.052);
  // root flare: a short, lumpy lathe
  const bulge = Array.from({ length: 7 }, () => rng.range(-0.1, 0.45));
  b.lathe(barkMat, [{ y: -0.12, r: r0 * 2.0 }, { y: 0.1, r: r0 * 1.45 }, { y: 0.4, r: r0 * 1.1 }], {
    segments: 7, phase: rng.range(0, Math.PI), radiusFn: (i, j) => (i === 0 ? 1 + bulge[j] : i === 1 ? 1 + bulge[j] * 0.5 : 1),
    colorFn: (i) => { const k = i === 0 ? 0.6 : i === 1 ? 0.8 : 0.95; return [k, k, k]; },
  });
  // stems twisting outward, each ending in a crown pad (and a smaller pad lower down)
  const nStems = rng.int(2, 3);
  const a0 = rng.range(0, Math.PI * 2);
  const pads = [];
  for (let s = 0; s < nStems; s++) {
    const a = a0 + (s / nStems) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const lean = rng.range(0.35, 0.7);
    const len = H * (s === 0 ? rng.range(0.66, 0.78) : rng.range(0.42, 0.62));
    const { tip, dir } = limb(b, barkMat, [0, 0.3, 0], [Math.cos(a) * lean, 1, Math.sin(a) * lean], len, r0 * 0.9, r0 * 0.36, rng, { joints: 3, bend: 0.32 });
    pads.push({ c: [tip[0] + dir[0] * 0.2, tip[1] + 0.12, tip[2] + dir[2] * 0.2], r: H * rng.range(0.2, 0.27) });
    if (rng.chance(0.65)) {
      // a side branch out of the stem with a lower, smaller pad
      const t = rng.range(0.45, 0.65);
      const from = [tip[0] * t, 0.3 + (tip[1] - 0.3) * t, tip[2] * t];
      const sa = a + rng.pick([-1, 1]) * rng.range(0.8, 1.4);
      const side = limb(b, barkMat, from, [Math.cos(sa), 0.45, Math.sin(sa)], H * 0.22, r0 * 0.45, r0 * 0.2, rng, { joints: 2, bend: 0.25, segments: 4 });
      pads.push({ c: [side.tip[0], side.tip[1] + 0.1, side.tip[2]], r: H * rng.range(0.14, 0.19) });
    }
  }
  // a dead silver branch reaching out of the crown
  if (!charred && rng.chance(0.55)) {
    const a = rng.range(0, Math.PI * 2);
    const dmat = f.windMaterial('deadwood');
    const { tip, dir } = limb(b, dmat, [0, H * 0.45, 0], [Math.cos(a) * 0.9, 0.5, Math.sin(a) * 0.9], H * 0.32, r0 * 0.35, r0 * 0.12, rng, { joints: 2, bend: 0.3 });
    limb(b, dmat, tip, [dir[0] + 0.4, dir[1] + 0.4, dir[2] - 0.2], H * 0.12, r0 * 0.12, 0.02, rng, { joints: 1, segments: 4 });
  }
  // the pads: flat layers of wide foliage cards (2 × 1 units: the `juniper` texture is a flat cloud
  // of scale-leaf tufts) spread over a disc, one a little higher in the middle — the crown reads as
  // stacked, wind-flattened layers with the stems showing between them; fewer and burnt when charred
  const lowY = Math.min(...pads.map((p) => p.c[1])) - H * 0.1;
  const topY = Math.max(...pads.map((p) => p.c[1])) + 0.3;
  for (const p of pads) {
    const R3 = [p.r * 1.1, p.r * 0.35, p.r * 1.1];
    const n = Math.max(2, Math.round((charred ? 1 : 2) + p.r * (charred ? 1.6 : 3.2)));
    const off = rng.range(0, 6.28);
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt((i + 0.5) / n) * p.r * 0.85;
      const th = off + i * GOLDEN;
      const P = [p.c[0] + Math.cos(th) * d, p.c[1] + rng.range(-0.1, 0.12), p.c[2] + Math.sin(th) * d];
      // the lower pads darker (the crown's own shade), the pad's rim a touch lighter
      const occ = clamp(0.66 + 0.4 * smoothstep(lowY, topY, P[1]), 0.6, 1.04) * (0.92 + 0.12 * (d / Math.max(0.1, p.r)));
      leafCard(b, leafMat, P, p.c, R3, [2, 1], rng, [1, 1, 1.03], occ, 0.12);
    }
    leafCard(b, leafMat, [p.c[0], p.c[1] + 0.28, p.c[2]], p.c, R3, [2, 1], rng, [1, 1, 1.03], 1.04, 0.1);
  }
  const group = f.finish(b, charred ? 'tree:juniper:charred' : 'tree:juniper', x, y, z, yaw);
  return { group, trunkR: r0 * 1.3 };
}

/**
 * Dead tree: a bare trunk (now and then snapped off, splinters standing up) with crooked branches
 * forking into thinner ones and twigs; sun-bleached silver-grey wood, or charred black. It barely
 * sways.
 */
function buildDeadwood(f, rng, H, x, y, z, yaw, charred) {
  const b = f.builder();
  const mat = f.windMaterial(charred ? 'bark_charred' : 'deadwood');
  const sway = swayFn(H, H * 0.4);
  b.sway = (px, py, pz) => sway(px, py, pz) * 0.3;
  const r0 = Math.max(0.12, H * 0.048);
  const snapped = rng.chance(0.35);
  const th = H * (snapped ? 0.62 : 0.78);
  const bx = rng.range(-0.3, 0.3);
  const bz = rng.range(-0.3, 0.3);
  const bulge = Array.from({ length: 6 }, () => rng.range(-0.05, 0.4));
  b.lathe(mat, [
    { y: -0.12, r: r0 * 1.7 }, { y: 0.15, r: r0 * 1.2 }, { y: th * 0.45, r: r0 * 0.95, cx: bx * 0.35, cz: bz * 0.35 },
    { y: th * 0.8, r: r0 * 0.75, cx: bx * 0.8, cz: bz * 0.8 }, { y: th, r: r0 * (snapped ? 0.7 : 0.45), cx: bx, cz: bz },
  ], {
    segments: 6, phase: rng.range(0, Math.PI), radiusFn: (i, j) => (i === 0 ? 1 + bulge[j] : 1),
    colorFn: (i) => { const k = i === 0 ? 0.62 : i === 1 ? 0.82 : 1; return [k, k, k]; }, capTop: snapped,
  });
  if (snapped) {
    for (let k = 0; k < 3; k++) {
      const a = rng.range(0, Math.PI * 2);
      const p = [bx + Math.cos(a) * r0 * 0.4, th - 0.05, bz + Math.sin(a) * r0 * 0.4];
      b.tube(mat, p, [p[0] + rng.range(-0.08, 0.08), p[1] + rng.range(0.2, 0.45), p[2] + rng.range(-0.08, 0.08)], r0 * 0.25, 0.02, { segments: 4, rings: 2, uRepeat: 1 });
    }
  }
  // branches: 3–5 limbs from the upper trunk, each forking into two thinner ones with twigs
  const nb = rng.int(3, 5);
  const a0 = rng.range(0, Math.PI * 2);
  for (let k = 0; k < nb; k++) {
    const a = a0 + (k / nb) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const hy = th * rng.range(0.45, 0.95);
    const t = hy / th;
    const len = H * rng.range(0.24, 0.36) * (snapped ? 1.1 : 1);
    const r1 = r0 * rng.range(0.42, 0.55);
    const { tip, dir } = limb(b, mat, [bx * t, hy, bz * t], [Math.cos(a), rng.range(0.5, 1.1), Math.sin(a)], len, r1, r1 * 0.45, rng, { joints: 2, bend: 0.28 });
    for (const side of [-1, 1]) {
      const d2 = [dir[0] - dir[2] * side * 0.7, dir[1] + 0.35, dir[2] + dir[0] * side * 0.7];
      const fork = limb(b, mat, tip, d2, len * rng.range(0.5, 0.7), r1 * 0.42, r1 * 0.14, rng, { joints: 2, bend: 0.35, segments: 4 });
      for (let tw = 0; tw < 2; tw++) {
        if (rng.chance(0.75)) limb(b, mat, fork.tip, [fork.dir[0] + rng.range(-0.7, 0.7), fork.dir[1] + 0.5, fork.dir[2] + rng.range(-0.7, 0.7)], len * rng.range(0.22, 0.34), r1 * 0.12, 0.015, rng, { joints: 1, segments: 3 });
      }
    }
  }
  // an unbroken one ends in a last upward fork
  if (!snapped) limb(b, mat, [bx, th - 0.05, bz], [bx, 1, bz], H * 0.22, r0 * 0.42, 0.03, rng, { joints: 2, bend: 0.3, segments: 4 });
  const group = f.finish(b, charred ? 'tree:deadwood:charred' : 'tree:deadwood', x, y, z, yaw);
  return { group, trunkR: r0 * 1.2 };
}

/**
 * Date palm: a tall trunk of old frond bases, gently curved, a crown of long arching fronds (each a
 * folded strip of leaflets), a skirt of dead brown fronds hanging below it and clusters of dates.
 * The crown sways the most of any tree.
 */
function buildPalm(f, rng, H, x, y, z, yaw) {
  const b = f.builder();
  const trunkMat = f.windMaterial('palm_trunk');
  const frondMat = f.foliageMaterial('palm_fronds');
  b.sway = swayFn(H, H * 0.15);
  const top = H * 0.86;
  const bend = rng.range(0.35, 1.0) * (H / 6);
  const ba = rng.range(0, Math.PI * 2);
  const bx = Math.cos(ba) * bend;
  const bz = Math.sin(ba) * bend;
  const at = (t) => [bx * Math.pow(t, 1.7), top * t, bz * Math.pow(t, 1.7)];
  const radii = [0.36, 0.25, 0.2, 0.19, 0.19, 0.2, 0.24];
  const rings = radii.map((r, k) => {
    const p = at(k / (radii.length - 1));
    return { y: k === 0 ? -0.1 : p[1], r: r * (0.85 + H / 40), cx: p[0], cz: p[2] };
  });
  b.lathe(trunkMat, rings, { segments: 7, phase: rng.range(0, Math.PI), colorFn: (i) => { const k = i === 0 ? 0.62 : i === 1 ? 0.82 : 0.95 + i * 0.01; return [k, k, k]; } });
  const T = at(1);
  // a frond: a strip folded along its midrib into a shallow V (u 0–0.5 green, 0.5–1 dry)
  const frond = (az, elev, len, droop, dry, shade) => {
    const S = 7;
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const lat = [-dir[2], 0, dir[0]];
    const fold = 0.42;
    const u0 = dry ? 0.5 : 0;
    const pts = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const along = len * t;
      const yy = Math.sin(elev) * along - (droop * along * along) / len;
      const c = [T[0] + dir[0] * Math.cos(elev) * along * 0.95, T[1] + yy, T[2] + dir[2] * Math.cos(elev) * along * 0.95];
      pts.push({ c, wdt: 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)), 0.6) * (len / 2.8), t });
    }
    b.phase = rng.range(0, 6.283);
    for (let s = 0; s < S; s++) {
      const A = pts[s];
      const B = pts[s + 1];
      for (const side of [-1, 1]) {
        const edge = (p) => [p.c[0] + lat[0] * side * p.wdt * Math.cos(fold), p.c[1] + p.wdt * Math.sin(fold), p.c[2] + lat[2] * side * p.wdt * Math.cos(fold)];
        const quad = side < 0 ? [A.c, edge(A), edge(B), B.c] : [edge(A), A.c, B.c, edge(B)];
        const uv = side < 0 ? [[u0 + 0.25, A.t], [u0, A.t], [u0, B.t], [u0 + 0.25, B.t]] : [[u0 + 0.5, A.t], [u0 + 0.25, A.t], [u0 + 0.25, B.t], [u0 + 0.5, B.t]];
        const n = normalize3([lat[0] * side * 0.35 + dir[0] * 0.2, 1, lat[2] * side * 0.35 + dir[2] * 0.2]);
        const k = shade * (0.82 + 0.25 * A.t);
        b.quad(frondMat, quad, uv, { normals: [n, n, n, n], colors: [[k, k, k], [k, k, k], [k, k, k], [k, k, k]] });
      }
    }
  };
  const nG = rng.int(12, 15);
  const a0 = rng.range(0, Math.PI * 2);
  const scale = H / 6.5;
  for (let k = 0; k < nG; k++) {
    const upper = k % 3 === 0;
    frond(a0 + k * GOLDEN + rng.range(-0.15, 0.15), upper ? rng.range(0.75, 1.05) : rng.range(0.25, 0.6), rng.range(2.4, 3.1) * scale, upper ? 0.55 : 0.9, false, upper ? 1.05 : 0.92);
  }
  for (let k = 0, n = rng.int(4, 6); k < n; k++) frond(a0 + rng.range(0, Math.PI * 2), rng.range(-1.25, -0.8), rng.range(1.6, 2.2) * scale, 0.1, true, 0.75);
  // date clusters under the crown: small knobbly bunches, tinted amber
  for (let k = 0, n = rng.int(2, 3); k < n; k++) {
    const az = a0 + rng.range(0, Math.PI * 2);
    const c = [T[0] + Math.cos(az) * 0.35, T[1] - 0.35, T[2] + Math.sin(az) * 0.35];
    b.tinted([1.5, 0.95, 0.45], () => b.lathe(trunkMat, [{ y: c[1] - 0.45, r: 0.05, cx: c[0], cz: c[2] }, { y: c[1] - 0.3, r: 0.17, cx: c[0], cz: c[2] }, { y: c[1], r: 0.1, cx: c[0], cz: c[2] }], { segments: 5, uRepeat: 1 }));
  }
  const group = f.finish(b, 'tree:palm', x, y, z, yaw);
  return { group, trunkR: 0.3 };
}

/**
 * Cypress: tall and narrow — a dark green flame of a column over a short trunk: a dark core (a
 * lathe shell of dense foliage, so nothing shows through) wrapped in flame-shaped cards (1 × 2
 * units: `cypress_leaves`, tufts pointing up) climbing it in a loose spiral, the top ones narrower
 * and lit, the low ones in the column's own shade.
 */
function buildCypress(f, rng, H, x, y, z, yaw) {
  const b = f.builder();
  const barkMat = f.windMaterial('bark');
  const shellMat = f.foliageMaterial('cypress');
  const cardMat = f.foliageMaterial('cypress_leaves', { billboard: true });
  const sway = swayFn(H, H * 0.25);
  b.sway = (px, py, pz) => sway(px, py, pz) * 0.55;
  b.lathe(barkMat, [{ y: -0.1, r: 0.2 }, { y: 0.15, r: 0.15 }, { y: 0.9, r: 0.12 }], { segments: 6, colorFn: (i) => (i === 0 ? [0.6, 0.6, 0.6] : [0.85, 0.85, 0.85]) });
  const R = H * rng.range(0.085, 0.1);
  const prof = [[0.45, 0.55], [H * 0.16, 0.92], [H * 0.34, 1], [H * 0.56, 0.86], [H * 0.76, 0.56], [H * 0.9, 0.26], [H * 0.98, 0.03]];
  const radiusAt = (yy) => {
    const pk = clamp(prof.findIndex(([py]) => py >= yy), 1, prof.length - 1);
    const [ya, ka] = prof[pk - 1];
    const [yb, kb] = prof[pk];
    return R * lerp(ka, kb, clamp((yy - ya) / Math.max(1e-3, yb - ya), 0, 1));
  };
  b.phase = rng.range(0, 6.283);
  b.lathe(shellMat, prof.map(([yy, k]) => ({ y: yy, r: R * k * 0.85 })), {
    segments: 8, phase: rng.range(0, Math.PI), uRepeat: 2, normalUp: 0.35,
    colorFn: (i) => { const k = lerp(0.5, 0.8, i / (prof.length - 1)); return [k, k, k]; },
  });
  // the flame cards, in a spiral round the core; overlapping, the column's outline ragged
  const n = Math.round(10 + H * 2.2);
  const C = [0, H * 0.45, 0];
  const R3 = [R * 1.3, H * 0.55, R * 1.3];
  const off = rng.range(0, 6.28);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const yy = lerp(0.95, H * 0.93, Math.pow(t, 0.9));
    const r = radiusAt(yy) * rng.range(0.55, 0.85);
    const th = off + i * GOLDEN * 2;
    const k = yy > H * 0.86 ? 0.8 : 1;
    leafCard(b, cardMat, [Math.cos(th) * r, yy, Math.sin(th) * r], C, R3, [k, 2 * k], rng, [1, 1, 1], lerp(0.6, 1.04, t), 0.1);
  }
  const group = f.finish(b, 'tree:cypress', x, y, z, yaw);
  return { group, trunkR: 0.22 };
}

/**
 * The arid kinds' builders, by kind: `(f, rng, H, x, y, z, yaw, charred) → { group, trunkR }`
 * (palm and cypress ignore `charred`).
 */
export const ARID_TREES = Object.freeze({ juniper: buildJuniper, deadwood: buildDeadwood, palm: buildPalm, cypress: buildCypress });
