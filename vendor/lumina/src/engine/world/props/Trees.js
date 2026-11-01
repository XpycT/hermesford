import { clamp, smoothstep, lerp } from '../../utils/math.js';
import { isOwnKey } from '../../utils/own.js';
import { ARID_TREE_KINDS, needSetPieceKit } from '../SetPieceKit.js';

/** @import { PropFactory, PropResult } from '../Props.js' */

/**
 * Procedural pixel-art trees: oak / autumn / birch (tapered 7-sided trunk + branches + canopy of
 * alpha-tested foliage clusters) and pine (stacked drooping cone tiers); and the arid kinds
 * (docs/contracts/DRAGON_CAMPAIGN.md §6.2, docs/design/ARID_LOOK.md §5): juniper (gnarled stems,
 * flat pads of blue-green cards), deadwood (bare forking limbs, sun-bleached), palm (a curved ringed
 * trunk, arching folded fronds, a skirt of dead ones, dates), cypress (a narrow flame of foliage
 * shells and cards); juniper and deadwood also `charred`. Their textures are PropTextureSet's
 * (`juniper`, `juniper_bark`, `deadwood`, `bark_charred`, `palm_trunk`, `palm_fronds`, `cypress`,
 * `cypress_leaves`), painted on first use.
 *
 * Canopy clusters are billboard clumps of 2×2-unit leaf cards (exactly 16 px / unit; they face
 * the camera yaw in the colour pass and the sun in the shadow pass) with authored
 * "spherical" normals (outward from the canopy centre, biased up) so the whole crown shades like
 * one soft rounded volume, plus per-cluster tint variation and vertex-colour occlusion that
 * darkens the interior and the underside. Everything above the lower trunk sways with the wind
 * (height-weighted) in both the colour and the shadow pass.
 */

export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * A broadleaf kind (`buildBroadleaf`): its canopy texture, the canopy tint, the cluster count range,
 * the crown radius and flattening (× the height), the trunk radius (× the height), the card size;
 * `birch` the slender birch shape (a narrow tall crown, the `birch` bark), `bark` another bark
 * texture, `litter` fallen leaves at the foot (unless `fallenLeaves: false`), `inner` the shade of the
 * crown's inner cards (0.5).
 * @typedef {{ leaves: string, tint: number[], clusters: number[], crown: number, flat: number,
 *   trunk: number, card: number, birch?: boolean, bark?: string, litter?: boolean, inner?: number }} BroadleafKind
 */
/** @type {Record<'oak'|'autumn'|'birch', BroadleafKind>} */
const KINDS = {
  oak: { leaves: 'leaves', tint: [1, 1, 1], clusters: [9, 12], crown: 0.44, flat: 0.8, trunk: 0.075, card: 2.0 },
  autumn: { leaves: 'leaves_autumn', tint: [1, 1, 1], clusters: [9, 11], crown: 0.43, flat: 0.78, trunk: 0.072, card: 2.0, litter: true },
  birch: { leaves: 'leaves', tint: [1.1, 1.15, 0.72], clusters: [6, 8], crown: 0.3, flat: 1.25, trunk: 0.036, card: 2.0, birch: true },
};

/**
 * Options of `buildTree` / `PropFactory.tree`. Mirrored in src/engine/level/types.d.ts
 * (ObjectExtras.tree.opts), kept separate so the Node tools stay free of three.js: change both.
 * @typedef {object} TreeOptions
 * @property {'oak'|'autumn'|'pine'|'birch'|'juniper'|'deadwood'|'palm'|'cypress'|string} [kind]  an
 *   unknown kind builds an oak
 * @property {number} [height]  4.5, ±6 %
 * @property {number} [seed]
 * @property {number} [rotation]  yaw (random)
 * @property {boolean} [fallenLeaves]  autumn trees: leaves around the foot (on unless false)
 * @property {boolean} [charred]  deadwood and juniper: burnt black (a juniper keeps a few charred
 *   tufts); ignored by the other kinds
 */

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {TreeOptions} [opts]
 * @returns {PropResult}
 */
export function buildTree(f, x, y, z, opts = {}) {
  const kind = opts.kind ?? 'oak';
  const rng = f.rng(`tree:${kind}`, x, z, opts.seed);
  const H = (opts.height ?? 4.5) * rng.range(0.94, 1.06);
  const yaw = opts.rotation ?? rng.range(0, Math.PI * 2);
  const charred = opts.charred === true;
  let trunkR;
  let group;
  if (kind === 'pine') {
    ({ group, trunkR } = buildPine(f, rng, H, x, y, z, yaw));
  } else if (ARID_TREE_KINDS.includes(kind)) {
    // the arid kinds (./AridTrees.js): the set-piece kit's, loaded for a level that has them
    ({ group, trunkR } = needSetPieceKit(`a "${kind}" tree`).ARID_TREES[/** @type {'juniper'|'deadwood'|'palm'|'cypress'} */ (kind)](f, rng, H, x, y, z, yaw, charred));
  } else {
    ({ group, trunkR } = buildBroadleaf(f, rng, isOwnKey(KINDS, kind) ? kind : 'oak', H, x, y, z, yaw, opts));
  }
  return f.result(group, { colliders: [{ type: 'circle', x, z, r: trunkR + 0.12 }] });
}

export function swayFn(H, start) {
  return (px, py, pz) => {
    const h = clamp((py - start) / Math.max(0.1, H - start), 0, 1);
    const radial = Math.min(1, Math.hypot(px, pz) / (H * 0.45));
    return Math.pow(h, 1.35) * (0.75 + 0.35 * radial);
  };
}

/**
 * A broadleaf tree (trunk, branches, a canopy of billboard leaf cards): a built-in kind's and, with
 * `K`, another kind's (the season kinds: ./SeasonTrees.js).
 * @param {PropFactory} f
 * @param {import('../../utils/math.js').RNG} rng the tree's stream (`buildTree`'s)
 * @param {string} kind the group's name (`tree:<kind>`)
 * @param {number} H @param {number} x @param {number} y @param {number} z @param {number} yaw
 * @param {TreeOptions} opts
 * @param {BroadleafKind} [K] the kind's shape (default: the built-in kind's)
 * @returns {{ group: import('three').Group, trunkR: number }}
 */
export function buildBroadleaf(f, rng, kind, H, x, y, z, yaw, opts, K = KINDS[kind]) {
  const isBirch = K.birch === true;
  const b = f.builder();
  const barkMat = f.windMaterial(K.bark ?? (isBirch ? 'birch' : 'bark'));
  const leafMat = f.foliageMaterial(K.leaves, { billboard: true });

  // ---- crown layout
  const Rc = H * K.crown;
  const radii = isBirch ? [Rc * 0.78, Rc * 1.05, Rc * 0.78] : [Rc, Rc * K.flat, Rc];
  const C = [rng.range(-0.12, 0.12), H - radii[1] * 0.78 - (isBirch ? 0.35 : 0.2), rng.range(-0.12, 0.12)];
  const h1 = C[1] - radii[1] * (isBirch ? 0.1 : 0.25);
  const r0 = Math.max(0.12, H * K.trunk);
  b.sway = swayFn(H, H * 0.28);

  // ---- trunk: tapered 7-sided, root flare with seeded bulges, gentle bend
  const bendX = rng.range(-0.25, 0.25) * (isBirch ? 1.5 : 1);
  const bendZ = rng.range(-0.25, 0.25) * (isBirch ? 1.5 : 1);
  const bulge = Array.from({ length: 7 }, () => rng.range(-0.06, 0.38));
  const rings = isBirch
    ? [
      { y: -0.1, r: r0 * 1.45 }, { y: 0.14, r: r0 * 1.12 }, { y: h1 * 0.35, r: r0, cx: bendX * 0.2, cz: bendZ * 0.2 },
      { y: h1 * 0.7, r: r0 * 0.82, cx: bendX * 0.6, cz: bendZ * 0.6 }, { y: h1 + 0.4, r: r0 * 0.55, cx: bendX + C[0], cz: bendZ + C[2] },
    ]
    : [
      { y: -0.12, r: r0 * 1.75 }, { y: 0.12, r: r0 * 1.28 }, { y: 0.45, r: r0 * 1.04 },
      { y: h1 * 0.55, r: r0 * 0.86, cx: bendX * 0.4, cz: bendZ * 0.4 }, { y: h1, r: r0 * 0.66, cx: bendX + C[0] * 0.5, cz: bendZ + C[2] * 0.5 },
      { y: h1 + 0.5, r: r0 * 0.4, cx: bendX * 0.8 + C[0], cz: bendZ * 0.8 + C[2] },
    ];
  b.lathe(barkMat, rings, {
    segments: 7,
    phase: rng.range(0, Math.PI),
    radiusFn: (i, j) => (i === 0 ? 1 + bulge[j] : i === 1 ? 1 + bulge[j] * 0.45 : 1),
    colorFn: (i) => { const k = i === 0 ? 0.6 : i === 1 ? 0.8 : 1; return [k, k, k]; },
    vOff: rng.range(0, 2),
  });

  // ---- clusters (fibonacci points on a flattened ellipsoid)
  const [n0, n1] = K.clusters;
  const n = rng.int(n0, n1);
  const clusters = [];
  const off = rng.range(0, 1);
  for (let i = 0; i < n; i++) {
    const t = (i + off) / n;
    const py = 1 - t * 1.8; // skip the very bottom of the ellipsoid
    const pr = Math.sqrt(Math.max(0, 1 - py * py));
    const th = i * GOLDEN + rng.range(-0.3, 0.3);
    const k = rng.range(0.48, 0.72);
    clusters.push({ p: [C[0] + Math.cos(th) * pr * radii[0] * k, C[1] + py * radii[1] * k, C[2] + Math.sin(th) * pr * radii[2] * k], inner: false });
  }
  clusters.push({ p: [C[0] + rng.range(-0.2, 0.2), C[1] + radii[1] * 0.55, C[2] + rng.range(-0.2, 0.2)], inner: false });
  const nInner = isBirch ? 2 : 4;
  for (let i = 0; i < nInner; i++) {
    const a = (i / nInner) * Math.PI * 2 + rng.range(-0.4, 0.4);
    clusters.push({ p: [C[0] + Math.cos(a) * radii[0] * 0.3, C[1] + rng.range(-0.25, 0.15) * radii[1], C[2] + Math.sin(a) * radii[2] * 0.3], inner: true });
  }

  // ---- branches from the upper trunk toward a few low clusters
  const nb = rng.int(2, 3);
  const lowC = clusters.filter((c) => !c.inner).sort((a, bb) => a.p[1] - bb.p[1]);
  for (let i = 0; i < nb && i < lowC.length; i++) {
    const tgt = lowC[(i * 2) % lowC.length].p;
    const sy = h1 * rng.range(0.72, 0.95);
    const s = [bendX * (sy / h1), sy, bendZ * (sy / h1)];
    const e = [lerp(C[0], tgt[0], 0.8), lerp(sy, tgt[1], 0.7), lerp(C[2], tgt[2], 0.8)];
    b.tube(barkMat, s, e, r0 * 0.46, r0 * 0.16, { segments: 5, rings: 3, uRepeat: 1 });
  }

  // ---- foliage: each cluster is a billboard clump of 2 camera-facing leaf cards
  //      (2×2 units = exactly 16 px / unit); the second card sits lower/aside and a bit darker
  const baseTint = K.tint;
  const cards = [];
  for (const cl of clusters) {
    cards.push({ p: cl.p, inner: cl.inner, shade: 1 });
    if (cl.inner) continue;
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.4, 0.6);
    cards.push({ p: [cl.p[0] + Math.cos(a) * d, cl.p[1] - rng.range(0.2, 0.38), cl.p[2] + Math.sin(a) * d], inner: false, shade: 0.9 });
  }
  for (let ci = 0; ci < cards.length; ci++) {
    const cl = cards[ci];
    const cs = K.card * rng.range(0.94, 1.08);
    const h = cs / 2;
    const tv = rng.range(-0.07, 0.07);
    const hue = rng.range(-0.05, 0.05);
    const P = cl.p;
    const dx0 = (P[0] - C[0]) / radii[0];
    const dy0 = (P[1] - C[1]) / radii[1];
    const dz0 = (P[2] - C[2]) / radii[2];
    const dCen = Math.hypot(dx0, dy0, dz0);
    // outer clumps brighter, interior + underside darker (the clump shadowing pixel artists paint)
    const occC = cl.inner ? (K.inner ?? 0.5) : cl.shade * clamp(0.66 + 0.5 * dCen, 0.6, 1.05) * (0.8 + 0.2 * smoothstep(-0.8, 0.6, dy0));
    const tint = [baseTint[0] * (1 + tv + hue) * occC, baseTint[1] * (1 + tv) * occC, baseTint[2] * (1 + tv - hue) * occC];
    b.phase = rng.range(0, 6.283);
    b.center = P;
    const roll = rng.range(-0.22, 0.22);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const pts = [];
    const normals = [];
    const colors = [];
    for (const [ox, oy] of corners) {
      const rx = ox * cr - oy * sr;
      const ry = ox * sr + oy * cr;
      pts.push([P[0] + rx, P[1] + ry, P[2]]);
      const nx = dx0 + (rx / cs) * 0.5;
      const ny = dy0 + (ry / cs) * 0.6 + 0.45;
      const nz = dz0 + 0.25;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals.push([nx / nl, ny / nl, nz / nl]);
      const v = oy < 0 ? 0.8 : 1.06;
      colors.push([tint[0] * v, tint[1] * v, tint[2] * v]);
    }
    b.quad(leafMat, pts, [[0, 0], [1, 0], [1, 1], [0, 1]], { normals, colors });
  }
  b.center = [0, 0, 0];

  // ---- fallen leaves (autumn)
  if (K.litter && opts.fallenLeaves !== false) {
    const litter = f.decalMaterial('leaf_litter');
    b.sway = 0;
    for (let i = 0; i < 2; i++) {
      const a = rng.range(0, Math.PI * 2);
      const cx = C[0] + Math.cos(a) * rng.range(0.4, 1.1);
      const cz = C[2] + Math.sin(a) * rng.range(0.4, 1.1);
      const r = rng.range(0, Math.PI);
      const e1 = [Math.cos(r), -Math.sin(r)];
      const e2 = [Math.sin(r), Math.cos(r)];
      const yy = 0.025 + i * 0.004;
      const pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([u, v]) => [cx + e1[0] * u + e2[0] * v, yy, cz + e1[1] * u + e2[1] * v]);
      b.quad(litter, pts, [[0, 0], [1, 0], [1, 1], [0, 1]], { normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]] });
    }
  }

  const group = f.finish(b, `tree:${kind}`, x, y, z, yaw);
  return { group, trunkR: r0 * 1.1 };
}

/**
 * A pine (stacked drooping cone tiers): the built-in `pine` and, with another needle texture and
 * kind, a season kind's (./SeasonTrees.js: the snow-laden pine).
 * @param {PropFactory} f
 * @param {import('../../utils/math.js').RNG} rng @param {number} H @param {number} x @param {number} y
 * @param {number} z @param {number} yaw
 * @param {string} [needleTex] the tiers' texture ('pine')
 * @param {string} [kind] the group's name (`tree:<kind>`; 'pine')
 * @returns {{ group: import('three').Group, trunkR: number }}
 */
export function buildPine(f, rng, H, x, y, z, yaw, needleTex = 'pine', kind = 'pine') {
  const b = f.builder();
  const barkMat = f.windMaterial('bark');
  const needles = f.foliageMaterial(needleTex);
  b.sway = swayFn(H, H * 0.25);
  const r0 = Math.max(0.14, H * 0.042);
  b.lathe(barkMat, [
    { y: -0.1, r: r0 * 1.5 }, { y: 0.15, r: r0 * 1.1 }, { y: H * 0.55, r: r0 * 0.7 }, { y: H * 0.8, r: r0 * 0.3 },
  ], { segments: 6, colorFn: (i) => (i === 0 ? [0.6, 0.6, 0.6] : [0.9, 0.9, 0.9]) });

  const tiers = clamp(Math.round(H / 0.95), 4, 7);
  const R0 = H * 0.34;
  const baseY = H * 0.19;
  const tierR = [];
  const tierH = [];
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    tierR.push(R0 * (1 - 0.78 * t) * rng.range(0.95, 1.05));
    tierH.push(tierR[k] * 1.12 + 0.3);
  }
  const span = H - baseY - tierH[tiers - 1];
  const segs = 12;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const r = tierR[k];
    const th = tierH[k];
    const by = baseY + span * t;
    const droop = 0.2 + 0.14 * (1 - t);
    const jag = Array.from({ length: segs }, (_, j) => (j % 2 === 0 ? 1 : 0) + rng.range(-0.25, 0.25));
    const dark = lerp(0.74, 1.0, t);
    const cx = rng.range(-0.05, 0.05);
    const cz = rng.range(-0.05, 0.05);
    b.phase = rng.range(0, 6.283);
    b.lathe(needles, [
      { y: by, r, cx, cz },
      { y: by + th * 0.3, r: r * 0.66, cx, cz },
      { y: by + th, r: 0.03, cx: cx * 0.5, cz: cz * 0.5 },
    ], {
      segments: segs,
      phase: rng.range(0, 1),
      uRepeat: Math.max(3, Math.round((Math.PI * 2 * r) / 2)),
      vOff: rng.range(0, 0.5),
      normalUp: 0.9,
      radiusFn: (i, j) => (i === 0 ? 1 + 0.1 * jag[j] : i === 1 ? 1 + 0.05 * jag[(j + 1) % segs] : 1),
      yFn: (i, j) => (i === 0 ? -droop * (0.35 + 0.65 * jag[j]) : 0),
      colorFn: (i) => { const k = dark * (i === 0 ? 0.52 : i === 1 ? 1.0 : 1.12); return [k, k, k]; },
    });
  }
  const group = f.finish(b, `tree:${kind}`, x, y, z, yaw);
  return { group, trunkR: r0 * 1.2 };
}
