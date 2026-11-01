import * as THREE from 'three';
import { smoothstep, clamp, hash2 } from '../../utils/math.js';
import { TRIM, flowerBoxGeom } from './Details.js';

/**
 * @import { PropFactory } from '../Props.js'
 * @import { Collider } from '../TileMap.js'
 */

/**
 * Small props: fence, barrel, crate, crate stack, signpost, rock, bench, haystack, flower box.
 */

const groundAO = (h = 0.5, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);

// ---------------------------------------------------------------------------------------------
// Fence
// ---------------------------------------------------------------------------------------------

/**
 * Straight run of posts and two rails between (x0, z0) and (x1, z1) at ground height y.
 * opts: { spacing = 1.0, height = 0.95, rails = 2, endPosts = true }
 * @param {PropFactory} f
 */
export function buildFence(f, x0, z0, x1, z1, y, opts = {}) {
  const rng = f.rng('fence', (x0 + x1) / 2, (z0 + z1) / 2, opts.seed);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  const yaw = Math.atan2(dz, dx) * -1; // local +X = run direction
  const Hf = opts.height ?? 0.95;
  const nSeg = Math.max(1, Math.round(L / (opts.spacing ?? 1.0)));
  const seg = L / nSeg;
  const b = f.builder(groundAO(0.45));
  const posts = [];
  for (let i = 0; i <= nSeg; i++) {
    const px = -L / 2 + i * seg;
    const h = Hf + rng.range(-0.05, 0.04);
    const lean = [rng.range(-0.04, 0.04), 0, rng.range(-0.04, 0.04)];
    posts.push({ px, h });
    b.push([px, 0, 0], lean);
    b.box(TRIM, [0.15, h, 0.15], { at: [0, h / 2 - 0.05, 0], rotUV: true, faces: { ny: false, py: false }, off: [rng.range(0, 2), rng.range(0, 2)] });
    // pointed cap
    const t = h - 0.05;
    const e = 0.075;
    const A = [0, t + 0.12, 0];
    const C = [[-e, t, e], [e, t, e], [e, t, -e], [-e, t, -e]];
    for (let k = 0; k < 4; k++) b.tri(TRIM, C[k], C[(k + 1) % 4], A, [0, 0], [0.15, 0], [0.075, 0.12]);
    b.pop();
  }
  const railY = (opts.rails ?? 2) === 1 ? [0.62] : [0.34, 0.7];
  for (let i = 0; i < nSeg; i++) {
    const a = posts[i];
    const c = posts[i + 1];
    for (const ry of railY) {
      const y0 = ry * (a.h / Hf) + rng.range(-0.02, 0.02);
      const y1 = ry * (c.h / Hf) + rng.range(-0.02, 0.02);
      const len = Math.hypot(seg, y1 - y0) + 0.12;
      b.box('wood_planks', [len, 0.1, 0.06], { at: [(a.px + c.px) / 2, (y0 + y1) / 2, 0.09], rot: [0, 0, Math.atan2(y1 - y0, seg)], off: [rng.range(0, 2), rng.range(0, 2)] });
    }
  }
  const group = f.finish(b, 'fence', (x0 + x1) / 2, y, (z0 + z1) / 2, yaw);
  // world AABBs along the run; diagonal runs are split into short pieces so the boxes hug the fence
  const colliders = [];
  const diag = Math.abs(Math.sin(2 * yaw)) > 0.05;
  const pieces = diag ? Math.max(1, Math.ceil(seg / 0.3)) : 1;
  for (let i = 0; i < nSeg; i++) {
    for (let k = 0; k < pieces; k++) {
      const a0 = posts[i].px + (seg * k) / pieces;
      colliders.push(f.boxCollider(group, a0, a0 + seg / pieces, -0.1, 0.1));
    }
  }
  return f.result(group, { colliders });
}

// ---------------------------------------------------------------------------------------------
// Barrel / crate / crate stack
// ---------------------------------------------------------------------------------------------

/** Emit a bulged barrel standing at (cx, cy, cz) into a builder. */
export function barrelGeom(b, cx, cy, cz, { h = 1.0, r = 0.4, yaw = 0, lid = true, bottom = false } = {}) {
  const rings = [
    { y: 0, r: r * 0.86 }, { y: h * 0.15, r: r * 0.95 }, { y: h * 0.5, r }, { y: h * 0.85, r: r * 0.95 }, { y: h, r: r * 0.86 },
  ];
  b.lathe('barrel', rings, { segments: 10, uRepeat: 3, vScale: h, at: [cx, cy, cz], rot: yaw, smooth: true });
  // inset lid + rim (the bottom one is the same lid turned over about the barrel's centre)
  const lidAt = (flip) => {
    b.push([cx, cy + h / 2, cz], flip ? [Math.PI, yaw, 0] : [0, yaw, 0]);
    b.lathe('barrel', [{ y: h / 2, r: r * 0.86 }, { y: h / 2 - 0.04, r: r * 0.78 }], { segments: 10, uRepeat: 3, vScale: 1, vOff: 0.9, capTop: 'wood_planks', color: [0.8, 0.8, 0.8] });
    b.pop();
  };
  if (lid) lidAt(false);
  if (bottom) lidAt(true);
}

/**
 * Barrel. opts: { height = 1, radius = 0.4, lying = false }
 * @param {PropFactory} f
 */
export function buildBarrel(f, x, y, z, opts = {}) {
  const rng = f.rng('barrel', x, z, opts.seed);
  const b = f.builder(groundAO(0.5));
  const h = opts.height ?? 1.0;
  const r = opts.radius ?? 0.4;
  if (opts.lying) {
    b.push([0, r * 0.95, -h / 2], [Math.PI / 2, 0, 0]);
    barrelGeom(b, 0, 0, 0, { h, r, yaw: rng.range(0, 6), bottom: true });
    b.pop();
  } else barrelGeom(b, 0, 0, 0, { h, r, yaw: rng.range(0, 6) });
  const group = f.finish(b, 'barrel', x, y, z, opts.rotation ?? rng.range(0, Math.PI * 2));
  return f.result(group, { colliders: [{ type: 'circle', x, z, r: r + 0.04 }] });
}

/**
 * Crate. opts: { size = 0.9 }
 * @param {PropFactory} f
 */
export function buildCrate(f, x, y, z, opts = {}) {
  const rng = f.rng('crate', x, z, opts.seed);
  const s = opts.size ?? 0.9;
  const b = f.builder(groundAO(0.5));
  b.box('crate', [s, s, s], { at: [0, s / 2, 0], uv: 'fit', faces: { ny: false } });
  const rot = opts.rotation ?? rng.range(-0.3, 0.3);
  const group = f.finish(b, 'crate', x, y, z, rot);
  const e = s * 0.5 * (Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot)));
  return f.result(group, { colliders: [{ type: 'box', minX: x - e, maxX: x + e, minZ: z - e, maxZ: z + e }] });
}

/**
 * A small pile of crates (2–3 on the ground, 1–2 on top) with an optional barrel.
 * @param {PropFactory} f
 */
export function buildCrateStack(f, x, y, z, opts = {}) {
  const rng = f.rng('crateStack', x, z, opts.seed);
  const b = f.builder(groundAO(0.6));
  const s = opts.size ?? 0.85;
  const n0 = opts.count ?? rng.int(2, 3);
  const bottom = [];
  for (let i = 0; i < n0; i++) {
    const cx = (i - (n0 - 1) / 2) * (s + 0.04) + rng.range(-0.05, 0.05);
    const cz = rng.range(-0.08, 0.08);
    const r = rng.range(-0.12, 0.12);
    bottom.push([cx, cz]);
    b.box('crate', [s, s, s], { at: [cx, s / 2, cz], rot: r, uv: 'fit', faces: { ny: false } });
  }
  const n1 = n0 >= 3 ? rng.int(1, 2) : 1;
  for (let i = 0; i < n1; i++) {
    const cx = n1 === 1 ? rng.range(-0.25, 0.25) : (i - 0.5) * (s + 0.02);
    b.box('crate', [s * 0.92, s * 0.92, s * 0.92], { at: [cx, s + (s * 0.92) / 2, rng.range(-0.06, 0.06)], rot: rng.range(-0.35, 0.35), uv: 'fit', faces: { ny: false } });
  }
  // (the box covers what was built: the crates, and the barrel only on its side when there is one —
  // it used to reserve room for a barrel at both ends: KNOWN_ISSUES PROP-14)
  const hx = (n0 / 2) * (s + 0.04) + 0.06;
  let lo = -hx;
  let hi = hx;
  if (opts.barrel ?? rng.chance(0.6)) {
    const side = rng.chance(0.5) ? 1 : -1;
    const bx = side * ((n0 / 2) * (s + 0.04) + 0.3);
    barrelGeom(b, bx, 0, rng.range(0.1, 0.4), { yaw: rng.range(0, 6) });
    if (side > 0) hi = bx + 0.42;
    else lo = bx - 0.42;
  }
  const rot = opts.rotation ?? rng.range(-0.4, 0.4);
  const group = f.finish(b, 'crateStack', x, y, z, rot);
  return f.result(group, { colliders: [f.boxCollider(group, lo, hi, -s * 0.6, s * 0.6)] });
}

// ---------------------------------------------------------------------------------------------
// Signpost
// ---------------------------------------------------------------------------------------------

/**
 * Wooden signpost with `boards` arrow boards (sign_board texture; the editor offers 1–3) stacked
 * down the post, pointing alternately right and left.
 * opts: { rotation = 0, boards = 2, seed, id = 'signpost' }
 * @param {PropFactory} f
 */
export function buildSignpost(f, x, y, z, opts = {}) {
  const rng = f.rng('signpost', x, z, opts.seed);
  const b = f.builder(groundAO(0.5));
  const Hp = 2.3;
  b.box(TRIM, [0.16, Hp, 0.16], { at: [0, Hp / 2 - 0.05, 0], rotUV: true, faces: { ny: false } });
  b.box(TRIM, [0.24, 0.08, 0.24], { at: [0, Hp - 0.02, 0] });
  b.box(TRIM, [0.1, 0.1, 0.1], { at: [0, Hp + 0.06, 0], rot: [0, Math.PI / 4, 0] });
  const nb = opts.boards ?? 2;
  for (let i = 0; i < nb; i++) {
    const by = Hp - 0.45 - i * 0.55;
    const dir = (i % 2 === 0 ? 1 : -1);
    const yaw = rng.range(-0.35, 0.35) + (i === 1 ? rng.range(-0.5, 0.5) : 0);
    b.push([0, by, 0], yaw);
    const bw = 1.15;
    const bh = 0.42;
    const cx = dir * (bw / 2 + 0.02);
    b.box('sign_board', [bw, bh, 0.07], {
      at: [cx, 0, 0.09],
      faces: {
        pz: { off: [(2 - bw) / 2, (1 - bh) / 2 - 0.02] },
        nz: { off: [(2 - bw) / 2, (1 - bh) / 2 - 0.02] },
        py: TRIM, ny: TRIM, px: TRIM, nx: TRIM,
      },
    });
    // arrow tip (prism)
    const tx = cx + dir * bw / 2;
    const z0 = 0.09 - 0.035;
    const z1 = 0.09 + 0.035;
    const tip = [tx + dir * 0.24, 0, 0];
    const up = [tx, bh / 2, 0];
    const dn = [tx, -bh / 2, 0];
    const Uu = [0.5, 0.5];
    if (dir > 0) {
      b.tri('sign_board', [up[0], up[1], z1], [dn[0], dn[1], z1], [tip[0], 0, z1], [0.9, 0.7], [0.9, 0.3], [1, 0.5]);
      b.tri('sign_board', [dn[0], dn[1], z0], [up[0], up[1], z0], [tip[0], 0, z0], [0.9, 0.3], [0.9, 0.7], [1, 0.5]);
    } else {
      b.tri('sign_board', [dn[0], dn[1], z1], [up[0], up[1], z1], [tip[0], 0, z1], [0.1, 0.3], [0.1, 0.7], [0, 0.5]);
      b.tri('sign_board', [up[0], up[1], z0], [dn[0], dn[1], z0], [tip[0], 0, z0], [0.1, 0.7], [0.1, 0.3], [0, 0.5]);
    }
    // bevel faces of the tip
    const e1 = dir > 0 ? [[up[0], up[1], z1], [tip[0], 0, z1], [tip[0], 0, z0], [up[0], up[1], z0]] : [[tip[0], 0, z1], [up[0], up[1], z1], [up[0], up[1], z0], [tip[0], 0, z0]];
    const e2 = dir > 0 ? [[tip[0], 0, z1], [dn[0], dn[1], z1], [dn[0], dn[1], z0], [tip[0], 0, z0]] : [[dn[0], dn[1], z1], [tip[0], 0, z1], [tip[0], 0, z0], [dn[0], dn[1], z0]];
    b.quad(TRIM, e1, [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]]);
    b.quad(TRIM, e2, [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]]);
    b.box('metal', [0.05, 0.05, 0.06], { at: [dir * 0.1, 0.1, 0.14] });
    b.box('metal', [0.05, 0.05, 0.06], { at: [dir * 0.1, -0.1, 0.14] });
    void Uu;
    b.pop();
  }
  // a few stones at the foot
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    rockGeom(b, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, [0.2, 0.14, 0.18], rng, { detail: 0, top: f.extra.material('boulder_moss'), side: f.extra.material('boulder') });
  }
  const group = f.finish(b, 'signpost', x, y, z, opts.rotation ?? 0);
  return f.result(group, {
    colliders: [{ type: 'circle', x, z, r: 0.22 }],
    interact: { position: new THREE.Vector3(x, y, z), radius: 1.2, id: opts.id ?? 'signpost' },
  });
}

// ---------------------------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------------------------

const _ico = new Map();
function icoPositions(detail) {
  let pos = _ico.get(detail);
  if (!pos) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    pos = g.getAttribute('position').array.slice();
    g.dispose();
    _ico.set(detail, pos);
  }
  return pos;
}

/**
 * Emit an irregular low-poly rock (faceted) into a builder. Faces pointing up wear `top`
 * (mossy), the others `side`; UVs are planar world projections (16 px / unit).
 * @param {number[]} size [sx, sy, sz] half extents
 */
export function rockGeom(b, cx, cy, cz, size, rng, { top = 'moss_stone', side = 'cliff', detail = 1, yaw = 0, sink = 0.22, flatTop = 0,
  tint = [1, 1, 1], rough = 0.3 } = {}) {
  const pos = icoPositions(detail);
  const seed = rng.int(0, 1e6);
  const disp = (x, y, z) => {
    const kx = Math.round(x * 1000);
    const ky = Math.round(y * 1000);
    const kz = Math.round(z * 1000);
    const h = hash2(kx * 7 + kz, ky * 13 - kx, seed);
    return 1 - rough / 2 + h * rough;
  };
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const pts = [];
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i];
    let y = pos[i + 1];
    let z = pos[i + 2];
    const d = disp(x, y, z);
    x *= d * size[0];
    y *= d * size[1];
    z *= d * size[2];
    if (flatTop && y > size[1] * (1 - flatTop)) y = size[1] * (1 - flatTop) + (y - size[1] * (1 - flatTop)) * 0.3;
    y = Math.max(y, -size[1] * sink) + size[1] * sink;
    const rx = x * cyw + z * syw;
    const rz = -x * syw + z * cyw;
    pts.push([cx + rx, cy + y, cz + rz]);
  }
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  for (let i = 0; i < pts.length; i += 3) {
    const A = pts[i];
    const B = pts[i + 1];
    const C = pts[i + 2];
    va.fromArray(A);
    vb.fromArray(B).sub(va);
    vc.fromArray(C).sub(va);
    vb.cross(vc);
    if (vb.lengthSq() < 1e-10) continue;
    vb.normalize();
    const mat = vb.y > 0.62 ? top : side;
    const m = b.mat(mat);
    const u = b.units(m);
    let uv;
    if (vb.y > 0.62 || vb.y < -0.62) uv = (p) => [p[0] / u[0], -p[2] / u[1]];
    else if (Math.abs(vb.x) > Math.abs(vb.z)) uv = (p) => [(-Math.sign(vb.x) * p[2]) / u[0], p[1] / u[1]];
    else uv = (p) => [(Math.sign(vb.z) * p[0]) / u[0], p[1] / u[1]];
    // lift the tops (sky light / moss), keep the flanks cool and a little darker toward the ground
    const lowY = Math.min(A[1], B[1], C[1]) - cy;
    const shade = (0.9 + 0.25 * clamp(vb.y, 0, 1)) * (0.78 + 0.22 * clamp(lowY / Math.max(0.01, size[1]), 0, 1));
    const col = vb.y > 0.62 ? [shade, shade, shade] : [shade * tint[0], shade * tint[1], shade * tint[2]];
    b.tri(m, A, B, C, uv(A), uv(B), uv(C), { normal: [vb.x, vb.y, vb.z], color: col });
  }
}

/**
 * The stones of the arid rocks and crags (`opts.stone` of a `rock` and a `crag`, DRAGON_CAMPAIGN.md
 * §5.3): top and wall textures (TextureLibrary names, src/engine/pixel/textures/arid.js) and how a
 * rock of it breaks — `rough` (the facets' displacement), `flat` (a flattened top: layered stone
 * splits into slabs).
 * @type {Record<string, { top: string, side: string, rough: number, flat: number }>}
 */
export const STONE_TEXTURES = {
  sandstone: { top: 'sandstone', side: 'sandstone_cliff', rough: 0.26, flat: 0.28 },
  redrock: { top: 'redrock', side: 'redrock_cliff', rough: 0.28, flat: 0.22 },
  basalt: { top: 'basalt', side: 'basalt_cliff', rough: 0.36, flat: 0.1 },
};

/**
 * Irregular boulder: mossy grey granite, or with `stone` (sandstone, redrock, basalt — the arid
 * stones, `STONE_TEXTURES`; anything else: the mossy grey) one of the arid stones, its walls in the
 * stone's strata. opts: { size = 1, flat = false, stone }
 * @param {PropFactory} f
 */
export function buildRock(f, x, y, z, opts = {}) {
  const rng = f.rng('rock', x, z, opts.seed);
  const s = opts.size ?? 1;
  const b = f.builder(groundAO(0.4 * s, 0.7));
  const sx = 0.7 * s * rng.range(0.85, 1.15);
  const sy = 0.62 * s * rng.range(0.85, 1.1);
  const sz = 0.62 * s * rng.range(0.85, 1.15);
  const arid = typeof opts.stone === 'string' && Object.hasOwn(STONE_TEXTURES, opts.stone) ? STONE_TEXTURES[opts.stone] : null;
  const stone = arid
    ? { top: arid.top, side: arid.side, rough: arid.rough }
    : { top: f.extra.material('boulder_moss'), side: f.extra.material('boulder') };
  const flatTop = opts.flat ? 0.3 : arid ? arid.flat : 0.12;
  rockGeom(b, 0, 0, 0, [sx, sy, sz], rng, { ...stone, detail: s > 0.55 ? 1 : 0, flatTop });
  // a smaller boulder leaning on the big one
  const side = s >= 1 ? [sx * 0.75, sz * 0.55, Math.max(sx, sz) * 0.45] : null;
  if (side) rockGeom(b, side[0], 0, side[1], [sx * 0.5, sy * 0.55, sz * 0.5], rng, { ...stone, detail: 1, yaw: rng.range(0, 6) });
  // a pebble or two
  if (s >= 0.8) {
    for (let i = 0; i < 2; i++) {
      const a = rng.range(0, Math.PI * 2);
      rockGeom(b, Math.cos(a) * (sx + 0.2), 0, Math.sin(a) * (sz + 0.2), [0.18 * s, 0.12 * s, 0.16 * s], rng, { ...stone, detail: 0 });
    }
  }
  const group = f.finish(b, 'rock', x, y, z, opts.rotation ?? rng.range(0, Math.PI * 2));
  /** @type {Collider[]} */
  const colliders = [{ type: 'circle', x, z, r: Math.max(sx, sz) * 0.95 }];
  if (side) {
    // the leaning boulder sticks out past the main circle (the group is randomly rotated)
    const p = f.world(group, new THREE.Vector3(side[0], 0, side[1]));
    colliders.push({ type: 'circle', x: p.x, z: p.z, r: side[2] });
  }
  return f.result(group, { colliders });
}

// ---------------------------------------------------------------------------------------------
// Bench, haystack, flower box
// ---------------------------------------------------------------------------------------------

/**
 * Wooden bench with stone feet and a backrest. opts: { rotation = 0, length = 1.8, back = true }
 * @param {PropFactory} f
 */
export function buildBench(f, x, y, z, opts = {}) {
  const rng = f.rng('bench', x, z, opts.seed);
  const b = f.builder(groundAO(0.4));
  const L = opts.length ?? 1.8;
  for (const s of [-1, 1]) {
    b.box('stone_brick', [0.2, 0.42, 0.44], { at: [s * (L / 2 - 0.25), 0.21, 0], faces: { ny: false }, off: [rng.range(0, 2), 0.3] });
  }
  b.box('wood_planks', [L, 0.1, 0.24], { at: [0, 0.47, 0.1], faces: { ny: TRIM } });
  b.box('wood_planks', [L, 0.1, 0.24], { at: [0, 0.47, -0.15], faces: { ny: TRIM }, off: [0.6, 0.4] });
  if (opts.back !== false) {
    for (const s of [-1, 1]) b.box(TRIM, [0.1, 0.7, 0.1], { at: [s * (L / 2 - 0.25), 0.8, -0.26], rot: [-0.12, 0, 0], rotUV: true });
    b.box('wood_planks', [L - 0.1, 0.22, 0.07], { at: [0, 1.0, -0.3], rot: [-0.12, 0, 0], off: [0.3, 0.2] });
  }
  const rot = opts.rotation ?? 0;
  const group = f.finish(b, 'bench', x, y, z, rot);
  return f.result(group, {
    colliders: [f.boxCollider(group, -L / 2, L / 2, -0.35, 0.25)],
    interact: { position: f.world(group, new THREE.Vector3(0, 0, 0.6)), radius: 0.9, id: opts.id ?? 'bench' },
  });
}

/**
 * Round haystack with a centre pole and a loose straw skirt. opts: { size = 1 }
 * @param {PropFactory} f
 */
export function buildHaystack(f, x, y, z, opts = {}) {
  const rng = f.rng('haystack', x, z, opts.seed);
  const s = opts.size ?? 1;
  const b = f.builder(groundAO(0.7 * s, 0.6));
  const R = 1.0 * s;
  const H = 1.9 * s;
  const segs = 12;
  const jag = Array.from({ length: segs }, () => rng.range(0.9, 1.08));
  b.lathe('hay', [
    { y: -0.05, r: R * 1.08 }, { y: H * 0.18, r: R * 1.02 }, { y: H * 0.45, r: R * 0.9 }, { y: H * 0.7, r: R * 0.64 },
    { y: H * 0.9, r: R * 0.3 }, { y: H, r: 0.05 },
  ], {
    segments: segs, phase: rng.range(0, 1), smooth: true, normalUp: 0.15,
    radiusFn: (i, j) => (i === 0 ? jag[j] * 1.04 : i < 5 ? 1 + (jag[(j + i) % segs] - 1) * 0.6 : 1),
    colorFn: (i) => { const k = [0.8, 0.9, 1, 1.05, 1.08, 1.1][i]; return [k, k, k]; },
  });
  // pole
  b.box(TRIM, [0.09, 0.9 * s, 0.09], { at: [0.03, H + 0.3 * s, 0.02], rot: [0.08, 0, 0.05], rotUV: true });
  // loose straw clumps at the base
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = R * rng.range(1.05, 1.25);
    b.lathe('hay', [{ y: -0.02, r: 0.28 * s }, { y: 0.14 * s, r: 0.02 }], { segments: 6, at: [Math.cos(a) * rr, 0, Math.sin(a) * rr], smooth: true, normalUp: 0.5 });
  }
  const group = f.finish(b, 'haystack', x, y, z, opts.rotation ?? rng.range(0, Math.PI * 2));
  return f.result(group, { colliders: [{ type: 'circle', x, z, r: R * 1.05 }] });
}

/**
 * Stand-alone flower box: a planter on short legs (or wall-mounted with `wall: true`).
 * opts: { rotation = 0, length = 1.2, wall = false }
 * @param {PropFactory} f
 */
export function buildFlowerbox(f, x, y, z, opts = {}) {
  const rng = f.rng('flowerbox', x, z, opts.seed);
  const b = f.builder(opts.wall ? null : groundAO(0.4));
  const L = opts.length ?? 1.2;
  const depth = 0.34;
  const lift = opts.wall ? 0 : 0.22;
  if (!opts.wall) {
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) b.box(TRIM, [0.07, lift + 0.05, 0.07], { at: [s * (L / 2 - 0.06), (lift + 0.05) / 2, t * (depth / 2 - 0.05)], rotUV: true });
    }
  }
  flowerBoxGeom(b, 0, lift, depth / 2, L, depth, rng.range(0, 1));
  const group = f.finish(b, 'flowerbox', x, y, z, opts.rotation ?? 0);
  return f.result(group, { colliders: opts.wall ? [] : [f.boxCollider(group, -L / 2, L / 2, -depth / 2, depth / 2)] });
}
