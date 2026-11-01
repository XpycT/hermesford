import * as THREE from 'three';
import { smoothstep, clamp, lerp } from '../../utils/math.js';
import { globalUniforms } from '../../render/GlobalUniforms.js';
import { thawField } from '../ThawField.js';
import { TRIM, centerOff } from './Details.js';

/** @import { PropFactory } from '../Props.js' */

/**
 * Larger diorama structures: well, market stall, bridge, windmill.
 */

const TAU = Math.PI * 2;
const groundAO = (h = 0.7, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);

// ---------------------------------------------------------------------------------------------
// Well
// ---------------------------------------------------------------------------------------------

/**
 * Octagonal stone well with rim, dark water, two posts, a small gable roof, windlass, rope & bucket.
 * opts: { rotation = 0, roof = 'wood_planks' | any roof texture }
 * @param {PropFactory} f
 */
export function buildWell(f, x, y, z, opts = {}) {
  const rng = f.rng('well', x, z, opts.seed);
  const rot = opts.rotation ?? 0;
  const roof = opts.roof ?? 'wood_planks';
  const b = f.builder(groundAO(0.8));
  const segs = 8;
  const R = 0.82;
  const Hw = 0.82;
  const phase = Math.PI / 8;
  // outer wall (flat facets, well_stone), inner wall (darker), rim cap
  b.lathe('well_stone', [{ y: -0.05, r: R + 0.04 }, { y: Hw, r: R }], { segments: segs, smooth: false, phase, uRepeat: 3, vOff: 0.18 });
  b.lathe('well_stone', [{ y: Hw, r: R - 0.2 }, { y: 0.2, r: R - 0.22 }], { segments: segs, smooth: false, phase, uRepeat: 2, color: [0.45, 0.45, 0.5] });
  // rim: flat ring of cap stones
  for (let i = 0; i < segs; i++) {
    const a0 = phase + (i / segs) * Math.PI * 2;
    const a1 = phase + ((i + 1) / segs) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const rm = R - 0.09;
    const len = 2 * (R + 0.06) * Math.sin(Math.PI / segs);
    b.box('stone_brick', [len + 0.02, 0.14, 0.34], { at: [Math.cos(am) * rm, Hw + 0.06 + rng.range(-0.015, 0.015), -Math.sin(am) * rm], rot: am + Math.PI / 2, off: [rng.range(0, 2), 0.2] });
  }
  // water surface
  const water = f.textures.material('riverbed', { vertexColors: true, color: 0x6a8cb8 });
  b.lathe(water, [{ y: 0.38, r: R - 0.21 }, { y: 0.38, r: 0.01 }], { segments: segs, phase, smooth: true, normalUp: 5, color: [0.35, 0.45, 0.6] });
  // posts, beam, roof
  const postH = 2.35;
  for (const s of [-1, 1]) {
    b.box(TRIM, [0.16, postH, 0.16], { at: [s * (R - 0.05), postH / 2 + 0.05, 0], rotUV: true });
  }
  b.box(TRIM, [2 * R + 0.3, 0.14, 0.14], { at: [0, postH - 0.05, 0] });
  // windlass
  b.tube('wood_planks', [-R + 0.1, 1.55, 0], [R - 0.1, 1.55, 0], 0.09, 0.09, { segments: 6, capTop: TRIM, capBottom: TRIM });
  b.tube('rope', [-0.25, 1.55, 0], [0.25, 1.55, 0], 0.13, 0.13, { segments: 6, uRepeat: 2 });
  b.box('metal', [0.04, 0.3, 0.04], { at: [R + 0.02, 1.45, 0] });
  b.box('metal', [0.04, 0.04, 0.22], { at: [R + 0.02, 1.32, 0.11] });
  // rope down to the bucket, bucket on the rim
  b.box('rope', [0.04, 0.55, 0.04], { at: [0.05, 1.2, 0.08] });
  const bx = 0.05;
  const by = 0.72 + 0.23;
  b.lathe('barrel', [{ y: by - 0.2, r: 0.14 }, { y: by + 0.02, r: 0.18 }], { segments: 8, uRepeat: 1, vScale: 0.25, capBottom: 'wood_planks', smooth: true, at: [bx, 0, 0.08] });
  b.box('metal', [0.36, 0.03, 0.03], { at: [bx, by + 0.14, 0.08] });
  // small gable roof
  const Lx = 2 * R + 0.8;
  const span = 0.75;
  const pitch = 0.62;
  const Ts = 0.1;
  const Ls = span / Math.cos(pitch) + 0.1;
  const ry = postH + 0.05;
  const Ur = f.textures.meta(roof).units[0];
  for (const side of [1, -1]) {
    const cS = Ls / 2 - 0.05;
    const center = [0, ry - Math.sin(pitch) * cS + Math.cos(pitch) * Ts / 2 + span * Math.tan(pitch) * 0.35, side * (Math.cos(pitch) * cS)];
    b.push(center, side > 0 ? [pitch, 0, 0] : [pitch, Math.PI, 0, 'YXZ']);
    b.box(roof, [Lx, Ts, Ls], { faces: { py: { off: [centerOff(Lx, Ur), 0] }, ny: TRIM, px: TRIM, nx: TRIM, pz: TRIM, nz: false } });
    b.box(TRIM, [Lx + 0.06, Ts + 0.08, 0.06], { at: [0, -0.03, Ls / 2 + 0.02], faces: { nz: false } });
    b.pop();
  }
  const rTop = ry + span * Math.tan(pitch) * 0.35 + Ts / Math.cos(pitch);
  b.box(TRIM, [Lx + 0.1, 0.14, 0.14], { at: [0, rTop, 0], rot: [Math.PI / 4, 0, 0] });
  // gable braces
  for (const s of [-1, 1]) {
    b.box(TRIM, [0.08, 0.5, 0.08], { at: [s * (R - 0.05), postH + 0.1, 0.2], rot: [-0.7, 0, 0] });
    b.box(TRIM, [0.08, 0.5, 0.08], { at: [s * (R - 0.05), postH + 0.1, -0.2], rot: [0.7, 0, 0] });
  }
  const group = f.finish(b, 'well', x, y, z, rot);
  return f.result(group, {
    colliders: [{ type: 'circle', x, z, r: R + 0.12 }],
    interact: { position: new THREE.Vector3(x, y, z), radius: R + 0.9, id: opts.id ?? 'well' },
  });
}

// ---------------------------------------------------------------------------------------------
// Market stall
// ---------------------------------------------------------------------------------------------

/**
 * Wooden market stall: frame posts, sloped striped awning with a scalloped valance, counter with
 * produce crates of coloured fruit, extra crates & a sack beside it. Front = local +Z.
 * opts: { cloth = 'cloth_stripe', rotation = 0, width = 3, depth = 1.6 }
 * @param {PropFactory} f
 */
export function buildMarketStall(f, x, y, z, opts = {}) {
  const rng = f.rng('stall', x, z, opts.seed);
  const cloth = opts.cloth ?? 'cloth_stripe';
  const rot = opts.rotation ?? 0;
  const W = opts.width ?? 3;
  const D = opts.depth ?? 1.6;
  const hw = W / 2;
  const hd = D / 2;
  const b = f.builder(groundAO(0.6));
  const backH = 2.7;
  const frontH = 2.15;
  // posts
  for (const sx of [-1, 1]) {
    b.box(TRIM, [0.14, backH, 0.14], { at: [sx * (hw - 0.07), backH / 2, -hd + 0.07], rotUV: true });
    b.box(TRIM, [0.14, frontH, 0.14], { at: [sx * (hw - 0.07), frontH / 2, hd - 0.07], rotUV: true });
    b.box(TRIM, [0.1, 0.1, D], { at: [sx * (hw - 0.07), (backH + frontH) / 2 - 0.15, 0], rot: [Math.atan2(backH - frontH, D), 0, 0] });
  }
  // awning (sloped, overhanging front)
  const ov = 0.45;
  const y0 = backH + 0.02;
  const y1 = frontH - 0.12;
  const z0 = -hd - 0.1;
  const z1 = hd + ov;
  const slope = Math.atan2(y0 - y1, z1 - z0);
  const L = Math.hypot(z1 - z0, y0 - y1);
  const Uc = f.textures.meta(cloth).units[0];
  b.push([0, (y0 + y1) / 2, (z0 + z1) / 2], [slope, 0, 0]);
  b.box(cloth, [W + 0.3, 0.05, L], { faces: { py: { off: [centerOff(W + 0.3, Uc), 0] }, ny: { color: [0.62, 0.58, 0.6] }, nz: false } });
  // scalloped valance hanging from the front edge (kept vertical)
  b.pop();
  const vy = y1 - 0.02;
  const vz = z1 + 0.01;
  const nSc = Math.max(4, Math.round((W + 0.3) / 0.38));
  const sw = (W + 0.3) / nSc;
  const vx0 = -(W + 0.3) / 2;
  const U = Uc;
  for (let i = 0; i < nSc; i++) {
    const xa = vx0 + i * sw;
    const xb = xa + sw;
    const top = vy;
    const mid = vy - 0.2;
    const tip = vy - 0.34;
    const u = (xx) => (xx - vx0) / U;
    b.quad(cloth, [[xa, mid, vz], [xb, mid, vz], [xb, top, vz], [xa, top, vz]], [[u(xa), 0.8], [u(xb), 0.8], [u(xb), 0.9], [u(xa), 0.9]], { color: [0.95, 0.92, 0.92] });
    b.tri(cloth, [xa, mid, vz], [(xa + xb) / 2, tip, vz], [xb, mid, vz], [u(xa), 0.8], [u((xa + xb) / 2), 0.73], [u(xb), 0.8], { color: [0.95, 0.92, 0.92] });
  }
  // counter
  const cy = 0.95;
  const cz = hd - 0.42;
  b.box('wood_planks', [W - 0.25, cy - 0.06, 0.62], { at: [0, (cy - 0.06) / 2, cz], faces: { ny: false } });
  b.box(TRIM, [W - 0.1, 0.08, 0.74], { at: [0, cy - 0.02, cz] });
  // cloth skirt on the counter front
  b.box('cloth_red', [W - 0.3, 0.5, 0.03], { at: [0, cy - 0.34, cz + 0.33], faces: { ny: false, nz: false } });
  // produce crates on the counter
  const nCr = Math.max(2, Math.floor((W - 0.4) / 0.72));
  const cw = (W - 0.5) / nCr;
  const produce = f.extra.material('produce');
  for (let i = 0; i < nCr; i++) {
    const px = -((W - 0.5) / 2) + cw * (i + 0.5);
    const kind = (i + rng.int(0, 3)) % 4;
    produceCrate(b, produce, px, cy + 0.02, cz - 0.02, Math.min(0.6, cw - 0.08), 0.46, kind, rng);
  }
  // tilted display crates on low trestles in front of the counter (goods face the street)
  if (opts.display !== false) {
    for (const sx of [-1, 1]) {
      const dx = sx * W * 0.27;
      const dz = hd + 0.22;
      for (const lx of [-0.24, 0.24]) b.box(TRIM, [0.07, 0.36, 0.07], { at: [dx + lx, 0.18, dz], rotUV: true });
      b.push([dx, 0.36, dz], [0.42, 0, 0]);
      produceCrate(b, produce, 0, 0, 0, 0.62, 0.44, (sx > 0 ? 1 : 0) + rng.int(0, 1) * 2, rng, 0.2);
      b.pop();
    }
  }
  // back shelf with a couple of crates
  b.box(TRIM, [W - 0.3, 0.07, 0.4], { at: [0, 1.35, -hd + 0.3] });
  for (let i = 0; i < 2; i++) produceCrate(b, produce, -hw * 0.45 + i * hw * 0.9, 1.39, -hd + 0.3, 0.5, 0.34, (i + 2 + rng.int(0, 1)) % 4, rng);
  // crates & a sack beside the stall: on the side `opts.crates` names (seen from the front), else
  // on one the seed picks (drawn either way, so the rest of the stall does not change)
  const drawn = rng.chance(0.5) ? 1 : -1;
  const side = opts.crates === 'left' ? -1 : opts.crates === 'right' ? 1 : opts.crates === 'none' ? 0 : drawn;
  if (side) {
    const crate = f.textures.material('crate', { vertexColors: true });
    b.box(crate, [0.7, 0.7, 0.7], { at: [side * (hw + 0.5), 0.35, hd - 0.3], rot: rng.range(-0.2, 0.2), uv: 'fit', faces: { ny: false } });
    produceCrate(b, produce, side * (hw + 0.5), 0.0, -hd + 0.45, 0.62, 0.5, rng.int(0, 3), rng, 0.55);
  }
  const group = f.finish(b, 'marketStall', x, y, z, rot);
  const colliders = [f.boxCollider(group, -hw - 0.05, hw + 0.05, -hd - 0.05, hd + (opts.display !== false ? 0.5 : 0.05))];
  // the crates beside the stall have their own box (they could be walked through: KNOWN_ISSUES PROP-14)
  if (side) {
    const sx0 = side > 0 ? hw + 0.12 : -hw - 0.88;
    colliders.push(f.boxCollider(group, sx0, sx0 + 0.76, -hd + 0.18, hd + 0.08));
  }
  return f.result(group, {
    colliders,
    interact: { position: f.world(group, new THREE.Vector3(0, 0, hd + 1.2)), radius: 1.3, id: opts.id ?? 'stall' },
  });
}

/** A shallow crate heaped with fruit (produce atlas cell `kind`). */
function produceCrate(b, produce, cx, by, cz, w, d, kind, rng, h = 0.26) {
  b.box('crate', [w, h, d], { at: [cx, by + h / 2, cz], rot: rng.range(-0.08, 0.08), uv: 'fit', rep: [1, h / 0.9], faces: { ny: false, py: false } });
  // heap: a low pyramid with the produce texture (16 px / unit via the atlas cell)
  const u0 = kind * 0.25;
  const hx = w / 2 - 0.03;
  const hz = d / 2 - 0.03;
  const top = by + h + 0.02;
  const peak = top + 0.1;
  const uv = (xx, zz) => [u0 + clamp((xx + hx) / 1, 0, 0.999) * 0.25, clamp((zz + hz) / 1, 0, 1)];
  const c = [[-hx, top, hz], [hx, top, hz], [hx, top, -hz], [-hx, top, -hz]];
  const ridge = [[-hx * 0.45, peak, 0], [hx * 0.45, peak, 0]];
  b.push([cx, 0, cz]);
  // front & back slopes (quads), side slopes (tris)
  b.quad(produce, [c[0], c[1], ridge[1], ridge[0]], [uv(-hx, 0), uv(hx, 0), uv(hx * 0.45, hz), uv(-hx * 0.45, hz)]);
  b.quad(produce, [c[2], c[3], ridge[0], ridge[1]], [uv(hx, 2 * hz), uv(-hx, 2 * hz), uv(-hx * 0.45, hz), uv(hx * 0.45, hz)]);
  b.tri(produce, c[1], c[2], ridge[1], uv(hx, 0), uv(hx, 2 * hz), uv(hx * 0.45, hz));
  b.tri(produce, c[3], c[0], ridge[0], uv(-hx, 2 * hz), uv(-hx, 0), uv(-hx * 0.45, hz));
  b.pop();
}

// ---------------------------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------------------------

/**
 * Wooden plank bridge from (x0, z0) to (x1, z1) with its deck top at height y (+ optional arch).
 * Returns `walkRects` (stepped along the arch) so the map can treat the deck as walkable ground.
 * opts: { width = 2, arch = auto (≤ 0.4), postDepth = 1.4, rails = true }
 * `rails: false` leaves out the rail planks only: the posts stay, and so do the colliders along
 * both edges (on purpose — nobody walks off a rail-less deck or pier into the water).
 * @param {PropFactory} f
 */
export function buildBridge(f, x0, z0, x1, z1, y, opts = {}) {
  const rng = f.rng('bridge', (x0 + x1) / 2, (z0 + z1) / 2, opts.seed);
  const Wb = opts.width ?? 2;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz); // local +Z = travel direction
  const arch = opts.arch ?? Math.min(0.4, L * 0.05);
  const postDepth = opts.postDepth ?? 1.4;
  const hwid = Wb / 2;
  const b = f.builder();
  const deckY = (t) => arch * Math.sin(Math.PI * clamp(t, 0, 1));
  const zOf = (t) => -L / 2 + t * L;
  // planks across the travel direction
  const pw = 0.5;
  const n = Math.max(2, Math.round(L / pw));
  const pl = L / n;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const tm = (t0 + t1) / 2;
    const slope = Math.atan2(deckY(t1) - deckY(t0), pl);
    const len = Wb + rng.range(-0.06, 0.1);
    b.box('wood_deck', [len, 0.11, pl - 0.035], {
      at: [rng.range(-0.04, 0.04), deckY(tm) - 0.055 + rng.range(-0.012, 0.012), zOf(tm)],
      rot: [-slope, rng.range(-0.03, 0.03), 0],
      faces: { py: { off: [rng.range(0, 4), (i % 8) * 0.5] }, ny: { color: [0.6, 0.6, 0.6] } },
      rotUV: false,
    });
  }
  // stringers under the deck
  const segs = Math.max(2, Math.round(L / 1));
  for (const s of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const la = Math.hypot(L / segs, deckY(t1) - deckY(t0));
      const slope = Math.atan2(deckY(t1) - deckY(t0), L / segs);
      b.box(TRIM, [0.18, 0.2, la + 0.02], { at: [s * (hwid - 0.3), (deckY(t0) + deckY(t1)) / 2 - 0.2, zOf((t0 + t1) / 2)], rot: [-slope, 0, 0] });
    }
  }
  // posts & rails
  const nPosts = Math.max(2, Math.round(L / 1.6) + 1);
  const railHs = [0.5, 0.95];
  for (let i = 0; i < nPosts; i++) {
    const t = i / (nPosts - 1);
    const end = i === 0 || i === nPosts - 1;
    const top = deckY(t) + (end ? 1.15 : 1.02);
    const bot = end ? -0.35 : -postDepth;
    for (const s of [-1, 1]) {
      const pw2 = end ? 0.2 : 0.15;
      b.box(TRIM, [pw2, top - bot, pw2], { at: [s * (hwid + 0.02), (top + bot) / 2, zOf(t)], rotUV: true, color: [1, 1, 1] });
      if (end) b.box(TRIM, [pw2 + 0.08, 0.08, pw2 + 0.08], { at: [s * (hwid + 0.02), top + 0.04, zOf(t)] });
    }
  }
  if (opts.rails !== false) {
    for (let i = 0; i < nPosts - 1; i++) {
      const t0 = i / (nPosts - 1);
      const t1 = (i + 1) / (nPosts - 1);
      const la = Math.hypot(L / (nPosts - 1), deckY(t1) - deckY(t0));
      const slope = Math.atan2(deckY(t1) - deckY(t0), L / (nPosts - 1));
      for (const s of [-1, 1]) {
        for (const rh of railHs) {
          b.box('wood_planks', [0.08, rh > 0.8 ? 0.12 : 0.09, la], {
            at: [s * (hwid + 0.02), (deckY(t0) + deckY(t1)) / 2 + rh + rng.range(-0.015, 0.015), zOf((t0 + t1) / 2)],
            rot: [-slope, 0, 0],
          });
        }
      }
    }
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const group = f.finish(b, 'bridge', cx, y, cz, yaw);
  // walkable deck rects (stepped along the arch) + rail colliders (also with `rails: false`) —
  // strips that follow a bridge laid at a slant, not their pieces' AABBs (KNOWN_ISSUES PROP-02)
  const walkRects = [];
  const colliders = [];
  const nW = arch > 0.02 ? Math.max(2, Math.round(L / 0.5)) : 1;
  for (let i = 0; i < nW; i++) {
    const t0 = i / nW;
    const t1 = (i + 1) / nW;
    const ext0 = i === 0 ? -0.25 : 0;
    const ext1 = i === nW - 1 ? 0.25 : 0;
    // (0.5-wide strips: every walk-height query scans the surfaces; what they cover beyond the deck
    // lies inside the rails' colliders)
    for (const r of f.localRects(group, -hwid + 0.1, hwid - 0.1, zOf(t0) + ext0, zOf(t1) + ext1, 0.5)) walkRects.push({ ...r, y: y + deckY((t0 + t1) / 2) });
  }
  const nC = Math.max(1, Math.round(L / 1));
  for (let i = 0; i < nC; i++) {
    const za = zOf(i / nC);
    const zb = zOf((i + 1) / nC);
    for (const s of [-1, 1]) colliders.push(...f.boxColliders(group, s * (hwid + 0.02) - 0.12, s * (hwid + 0.02) + 0.12, za, zb));
  }
  const res = f.result(group, { colliders });
  res.walkRects = walkRects;
  return res;
}

// ---------------------------------------------------------------------------------------------
// Windmill
// ---------------------------------------------------------------------------------------------

/**
 * Tapered octagonal windmill: stone base, plastered/timber upper tower, conical cap, door,
 * windows, and four lattice sails that rotate in update(dt). Sails face local +Z.
 * opts: { rotation = 0, height = 6, roof = 'roof_thatch', speed = 0.55 }
 * The Bells of Evermere (EVERMERE_CAMPAIGN.md §5.3): the sails stand still where the thaw field is
 * frozen (`thawField.at` < 0.5) and spin up over ≈ 2 s where it thaws (down in ≈ 1.5 s if the frost
 * returns); a level without frost reads 1 everywhere, so they turn exactly as before.
 * @param {PropFactory} f
 */
export function buildWindmill(f, x, y, z, opts = {}) {
  const rng = f.rng('windmill', x, z, opts.seed);
  const rot = opts.rotation ?? 0;
  const Ht = opts.height ?? 6;
  const roof = opts.roof ?? 'roof_thatch';
  const upper = opts.wall ?? 'plaster';
  const b = f.builder(groundAO(1.0));
  const segs = 8;
  const phase = Math.PI / 8;
  const R0 = 1.65;
  const R1 = 1.12;
  const hBase = 2.0;
  const rAt = (h) => lerp(R0, R1, h / Ht);
  // stone base + upper tower (flat facets)
  b.lathe('stone_brick', [{ y: -0.05, r: R0 + 0.08 }, { y: 0.5, r: rAt(0.5) + 0.06 }], { segments: segs, smooth: false, phase, vOff: 0 });
  b.lathe('stone_brick', [{ y: 0.5, r: rAt(0.5) }, { y: hBase, r: rAt(hBase) }], { segments: segs, smooth: false, phase, vOff: 0.5 });
  b.lathe(upper, [{ y: hBase, r: rAt(hBase) }, { y: hBase + 1.0, r: rAt(hBase + 1) }, { y: Ht, r: R1 }], { segments: segs, smooth: false, phase, vOff: 0, color: upper === 'plaster' ? [0.84, 0.8, 0.78] : undefined });
  // trim rings
  const ring = (h, t, extra) => b.lathe(TRIM, [{ y: h - t / 2, r: rAt(h) + extra }, { y: h + t / 2, r: rAt(h) + extra }], { segments: segs, smooth: false, phase, capTop: TRIM, uRepeat: 4 });
  ring(hBase, 0.2, 0.06);
  ring(Ht - 0.05, 0.22, 0.08);
  // vertical corner battens on the upper tower
  for (let i = 0; i < segs; i++) {
    const a = phase + (i / segs) * Math.PI * 2;
    const p0 = [Math.cos(a) * (rAt(hBase) + 0.02), hBase, -Math.sin(a) * (rAt(hBase) + 0.02)];
    const p1 = [Math.cos(a) * (R1 + 0.02), Ht, -Math.sin(a) * (R1 + 0.02)];
    b.tube(TRIM, p0, p1, 0.07, 0.06, { segments: 4, uRepeat: 1 });
  }
  // conical cap
  const capR = R1 + 0.38;
  b.lathe(roof, [{ y: Ht - 0.1, r: capR }, { y: Ht + 0.7, r: capR * 0.62 }, { y: Ht + 1.7, r: 0.05 }], { segments: segs, smooth: true, phase, normalUp: 0.3, colorFn: (i) => (i === 0 ? [0.85, 0.85, 0.85] : [1, 1, 1]) });
  b.lathe(TRIM, [{ y: Ht - 0.22, r: capR + 0.02 }, { y: Ht - 0.08, r: capR + 0.02 }], { segments: segs, smooth: false, phase, capBottom: TRIM, uRepeat: 4 });
  b.box(TRIM, [0.1, 0.4, 0.1], { at: [0, Ht + 1.85, 0] });
  // door + windows on the front (+Z) facet
  const facet = (h) => {
    const r = rAt(h) * Math.cos(Math.PI / segs);
    return r;
  };
  const doorZ = facet(0.5) + 0.02;
  b.quad('door', [[-0.5, 0.35, doorZ], [0.5, 0.35, doorZ], [0.5, 2.35, doorZ - 0.1], [-0.5, 2.35, doorZ - 0.1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.box(TRIM, [1.3, 0.18, 0.22], { at: [0, 2.42, doorZ - 0.06] });
  for (const s of [-1, 1]) b.box(TRIM, [0.15, 2.1, 0.2], { at: [s * 0.58, 1.38, doorZ - 0.04], rot: [-0.05, 0, 0], rotUV: true });
  b.box('stone_brick', [1.5, 0.35, 0.6], { at: [0, 0.175, doorZ + 0.25], faces: { ny: false } });
  const win = f.windowMaterial();
  for (const [wy, wa] of [[3.5, 0], [4.6, Math.PI / 4 * 3]]) {
    b.push([0, 0, 0], wa);
    const wz = facet(wy + 0.5) + 0.03;
    b.quad(win, [[-0.4, wy, wz], [0.4, wy, wz - 0.01], [0.4, wy + 0.8, wz - 0.07], [-0.4, wy + 0.8, wz - 0.06]], [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
    b.box(TRIM, [1.0, 0.08, 0.2], { at: [0, wy - 0.04, wz + 0.04] });
    b.box(TRIM, [0.96, 0.1, 0.14], { at: [0, wy + 0.86, wz - 0.03] });
    b.pop();
  }
  // hub housing
  const hubY = Ht - 0.35;
  const hubZ = facet(hubY) + 0.2;
  b.box('wood_planks', [0.9, 0.8, 0.9], { at: [0, hubY + 0.15, hubZ - 0.35] });
  b.box(roof, [1.1, 0.12, 1.1], { at: [0, hubY + 0.6, hubZ - 0.35], rot: [0.25, 0, 0] });
  const group = f.finish(b, 'windmill', x, y, z, rot);

  // ---- sails (separate rotating group)
  const sb = f.builder();
  const sail = f.extra.material('sail');
  const armL = opts.sailLength ?? 3.7;
  sb.tube(TRIM, [0, 0, -0.1], [0, 0, 0.45], 0.16, 0.14, { segments: 8, capTop: TRIM, uRepeat: 2 });
  sb.box('metal', [0.36, 0.36, 0.08], { at: [0, 0, 0.42], rot: [0, 0, Math.PI / 4] });
  for (let i = 0; i < 4; i++) {
    sb.push([0, 0, 0.3], [0, 0, (i * Math.PI) / 2]);
    sb.box(TRIM, [0.13, armL + 0.35, 0.12], { at: [0, (armL + 0.35) / 2 - 0.15, 0], rotUV: true });
    // lattice sail on one side of the spar (1 × 3 units sail texture, fitted)
    const s0 = 0.55;
    const s1 = armL;
    const sw = 0.95;
    sb.quad(sail, [[0.07, s0, 0.02], [0.07 + sw, s0, 0.02], [0.07 + sw, s1, 0.02], [0.07, s1, 0.02]],
      [[0, 0], [1, 0], [1, 1], [0, 1]], { normals: [[0, 0.3, 0.95], [0, 0.3, 0.95], [0, 0.3, 0.95], [0, 0.3, 0.95]] });
    // leading-edge board on the other side
    sb.box('wood_planks', [0.14, s1 - s0, 0.03], { at: [-0.14, (s0 + s1) / 2, 0.02], rotUV: true });
    sb.pop();
  }
  const { group: sails, geometries } = sb.build('windmill:sails');
  f.track(geometries);
  sails.position.set(0, hubY, hubZ + 0.12);
  sails.userData.dynamic = true; // animated: PropFactory.mergeStatic must leave it alone
  sails.rotation.z = rng.range(0, Math.PI / 2);
  group.add(sails);
  group.updateMatrixWorld(true);
  const speed = opts.speed ?? 0.55;
  let spin = -1;
  const res = f.result(group, {
    colliders: [{ type: 'circle', x, z, r: R0 + 0.1 }],
    emissives: [{ material: win, day: 0, night: 1.6 }],
    update: (dt) => {
      const thawed = thawField.at(x, z) >= 0.5 ? 1 : 0;
      spin = spin < 0 ? thawed : thawed > spin ? Math.min(1, spin + dt / 2) : Math.max(0, spin - dt / 1.5);
      // wrapped so the angle never grows without bound in long sessions
      sails.rotation.z = (sails.rotation.z - dt * speed * (0.6 + 0.4 * globalUniforms.uWindStrength.value) * (spin * spin * (3 - 2 * spin))) % TAU;
    },
  });
  res.sails = sails;
  return res;
}

