import * as THREE from 'three';
import { smoothstep } from '../../utils/math.js';
import { RENDER_ORDER } from '../../constants.js';
import { TRIM } from './Details.js';
import { createGlowMaterial } from './Flame.js';

/** @import { PropFactory } from '../Props.js' */

/**
 * Combat-level props (docs/contracts/COMBAT.md §14.3): the treasure chest and the waystone
 * (checkpoint). Both are ordinary PropResults — no light descriptors (they glow through bloom
 * only) — with a small `controls` object the combat system drives:
 *
 *  - chest     `controls = { open(instant?), opened }`: the lid swings open over 0.4 s in `update`
 *  - waystone  `controls = { setAttuned(on), attuned }`: the floating crystal (and its runes) wear a
 *              per-instance emissive material registered as `{ material, day: 0.9, night: 1.6 }`, so
 *              it glows by day too; attuning changes that material's emissive colour (#3a8fb0 →
 *              #7fe3ff), never its intensity (LightingSystem rewrites the intensity every frame)
 *
 * The lid, the crystal and the runes are flagged `userData.dynamic`, so PropFactory.mergeStatic
 * leaves them (and the per-instance material) out of the static batches.
 */

const TAU = Math.PI * 2;
const groundAO = (h = 0.5, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);

/** Gold tint for brass fittings (the `metal` texture × this vertex colour). */
const GOLD = [1.55, 1.18, 0.52];
/** The lid's tints over the plank texture: iron bands, dark trim. */
const IRON = [0.34, 0.33, 0.36];
const DARK = [0.5, 0.42, 0.38];
/** Lid swing: seconds and final angle (radians, about the back hinge). */
const LID_TIME = 0.4;
const LID_OPEN = 1.95;

/** Waystone crystal emissive colours (COMBAT.md §14.3): dim teal, attuned bright cyan. */
export const WAYSTONE_COLORS = Object.freeze({ idle: '#3a8fb0', attuned: '#7fe3ff' });

// ---------------------------------------------------------------------------------------------
// Chest
// ---------------------------------------------------------------------------------------------

/**
 * Iron-banded wooden treasure chest, ~0.9 × 0.6 × 0.6 u, front facing local +Z (rotation 0 faces
 * the camera). A barrel-vault lid hinged at the back opens with `controls.open()`; gold glints
 * inside. Collider: circle r 0.45. Interact point: 0.8 u in front, radius 1.2.
 * opts: { rotation = 0, id, seed }
 * @param {PropFactory} f
 */
export function buildChest(f, x, y, z, opts = {}) {
  const rng = f.rng('chest', x, z, opts.seed);
  const rot = opts.rotation ?? 0;
  const W = 0.88;
  const Dp = 0.58;
  const Hb = 0.4; // body height (the lid seam)
  const b = f.builder(groundAO(0.45));
  // runners, body panels, dark corner posts and rims
  b.box(TRIM, [W + 0.04, 0.06, Dp + 0.04], { at: [0, 0.03, 0], faces: { ny: false } });
  b.box('wood_planks', [W - 0.04, Hb - 0.08, Dp - 0.04], { at: [0, 0.06 + (Hb - 0.08) / 2, 0], faces: { ny: false, py: false }, off: [rng.range(0, 1), 0.1] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(TRIM, [0.07, Hb - 0.02, 0.07], { at: [sx * (W / 2 - 0.02), (Hb - 0.02) / 2 + 0.01, sz * (Dp / 2 - 0.02)], rotUV: true });
  }
  // the rim round the opening (a frame: the treasure shows once the lid is up)
  for (const sz of [-1, 1]) b.box(TRIM, [W, 0.05, 0.07], { at: [0, Hb - 0.025, sz * (Dp / 2 - 0.035)], faces: { ny: false } });
  for (const sx of [-1, 1]) b.box(TRIM, [0.07, 0.05, Dp - 0.14], { at: [sx * (W / 2 - 0.035), Hb - 0.025, 0], faces: { ny: false } });
  // iron bands (front, back, sides of the body) and a brass lock plate
  for (const sx of [-1, 1]) b.box('metal', [0.07, Hb - 0.1, Dp + 0.02], { at: [sx * 0.25, 0.06 + (Hb - 0.1) / 2, 0], faces: { py: false, ny: false } });
  b.box('metal', [0.17, 0.15, 0.03], { at: [0, Hb - 0.12, Dp / 2 + 0.01], color: GOLD, uv: 'fit' });
  b.box('metal', [0.05, 0.06, 0.02], { at: [0, Hb - 0.14, Dp / 2 + 0.03], color: [0.25, 0.2, 0.18] });
  // the treasure: a heap of coins just under the lid (seen once it opens)
  b.box('metal', [W - 0.12, 0.04, Dp - 0.12], { at: [0, Hb - 0.07, 0], faces: { ny: false }, color: GOLD });
  for (let k = 0; k < 5; k++) {
    const s = rng.range(0.07, 0.11);
    b.box('metal', [s, 0.03, s], { at: [rng.range(-0.3, 0.3), Hb - 0.035, rng.range(-0.16, 0.16)], rot: rng.range(0, 1.5), color: [1.8, 1.4, 0.6] });
  }
  const group = f.finish(b, 'chest', x, y, z, rot);

  // ---- the lid: its own group, pivoting on the back edge. It is never merged (it moves), so it is
  // built from ONE material — plank texture, the iron bands, rim and brass hasp as vertex tints —
  // to cost a single draw call (plus its shadow) ----
  const lb = f.builder();
  const R = Dp / 2;
  const Hl = 0.17; // vault rise
  const N = 6;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    prof.push([R + Math.cos(a) * R, Math.sin(a) * Hl + 0.04]); // [z from the hinge, y]
  }
  const planks = b.mat('wood_planks');
  const pu = b.units(planks);
  let arc = 0;
  for (let i = 0; i < N; i++) {
    const [z0, y0] = prof[i];
    const [z1, y1] = prof[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const v0 = arc / pu[1];
    const v1 = (arc + len) / pu[1];
    arc += len;
    const u0 = -W / 2 / pu[0];
    const u1 = W / 2 / pu[0];
    // (outward normal: the profile runs front → back over the top)
    lb.quad(planks, [[-W / 2, y0, z0], [W / 2, y0, z0], [W / 2, y1, z1], [-W / 2, y1, z1]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    // iron bands over the vault, 12 mm proud of the planks (pushed out from the vault's axis)
    const k = 0.012 / Math.max(1e-3, Math.hypot((z0 + z1) / 2 - R, (y0 + y1) / 2 - 0.04));
    const o0 = [(y0 - 0.04) * k, (z0 - R) * k];
    const o1 = [(y1 - 0.04) * k, (z1 - R) * k];
    for (const sx of [-1, 1]) {
      lb.quad(planks, [[sx * 0.25 - 0.035, y0 + o0[0], z0 + o0[1]], [sx * 0.25 + 0.035, y0 + o0[0], z0 + o0[1]], [sx * 0.25 + 0.035, y1 + o1[0], z1 + o1[1]], [sx * 0.25 - 0.035, y1 + o1[0], z1 + o1[1]]],
        [[0, v0], [0.07, v0], [0.07, v1], [0, v1]], { color: IRON });
    }
  }
  // gable ends of the vault
  const endPts = (sx) => prof.map(([pz, py]) => [sx * W / 2, py, pz]);
  const endR = endPts(1);
  lb.poly(planks, [[W / 2, 0.04, 0], [W / 2, 0.04, Dp], ...endR.slice(1, -1)].reverse(), { uAxis: [0, 0, 1], vAxis: [0, 1, 0], normal: [1, 0, 0], color: DARK });
  lb.poly(planks, [[-W / 2, 0.04, Dp], [-W / 2, 0.04, 0], ...endPts(-1).slice(1, -1).reverse()].reverse(), { uAxis: [0, 0, -1], vAxis: [0, 1, 0], normal: [-1, 0, 0], color: DARK });
  // the lid's rim and underside, the brass hasp over the seam
  lb.box(planks, [W + 0.02, 0.045, Dp + 0.02], { at: [0, 0.022, R], faces: { py: false }, color: DARK });
  lb.box(planks, [0.1, 0.13, 0.025], { at: [0, -0.02, Dp + 0.02], color: [1.9, 1.45, 0.62] });
  const { group: lid, geometries } = lb.build('chest:lid');
  f.track(geometries);
  lid.position.set(0, Hb, -R);
  lid.userData.dynamic = true; // animated: PropFactory.mergeStatic must leave it alone
  group.add(lid);
  group.updateMatrixWorld(true);

  let t = 0; // lid progress 0 → 1
  const controls = {
    opened: false,
    /** Swing the lid open (0.4 s; `instant` = already open). Returns false if it was open. */
    open(instant = false) {
      if (controls.opened) return false;
      controls.opened = true;
      if (instant) {
        t = 1;
        lid.rotation.x = -LID_OPEN;
      }
      return true;
    },
  };
  const front = f.world(group, new THREE.Vector3(0, 0, 0.8));
  front.y = y;
  const res = f.result(group, {
    colliders: [{ type: 'circle', x, z, r: 0.45 }],
    interact: { position: front, radius: 1.2, id: opts.id ?? 'chest' },
    update: (dt) => {
      if (!controls.opened || t >= 1) return;
      t = Math.min(1, t + dt / LID_TIME);
      // ease out with a little overshoot, settling open
      const e = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
      lid.rotation.x = -LID_OPEN * e;
    },
  });
  res.controls = controls;
  res.lid = lid;
  return res;
}

// ---------------------------------------------------------------------------------------------
// Waystone
// ---------------------------------------------------------------------------------------------

/**
 * Rune pillar (~2.1 u) on a two-step octagonal base with a floating, slowly turning crystal above
 * it and an additive glow card that reads by day. The crystal and the runes share one
 * per-instance emissive material (`controls.setAttuned(on)` swaps its emissive colour).
 * Collider: circle r 0.5. Interact point: the stone, radius 1.5.
 * opts: { id, seed }
 * @param {PropFactory} f
 */
export function buildWaystone(f, x, y, z, opts = {}) {
  const rng = f.rng('waystone', x, z, opts.seed);
  const b = f.builder(groundAO(0.7, 0.55));
  const oct = { segments: 8, smooth: false, phase: Math.PI / 8 };
  // two stepped plinths (stone blocks, tile caps)
  b.lathe('stone_brick', [{ y: -0.06, r: 0.7 }, { y: 0.2, r: 0.66 }], { ...oct, capTop: 'stone_tiles', uRepeat: 4, vOff: 0.3 });
  b.lathe('stone_brick', [{ y: 0.2, r: 0.5 }, { y: 0.38, r: 0.47 }], { ...oct, capTop: 'stone_tiles', uRepeat: 3, vOff: 0.1 });
  // the pillar: four faces tapering up, a cap slab, a mossy foot
  const r0 = 0.34;
  const r1 = 0.25;
  const H = 2.0;
  const quad = { segments: 4, smooth: false, phase: Math.PI / 4 };
  b.lathe('stone_brick', [{ y: 0.36, r: r0 }, { y: H, r: r1 }], { ...quad, uRepeat: 2, colorFn: (ring) => (ring === 0 ? [0.86, 0.96, 0.8] : [1.12, 1.1, 1.04]) });
  b.box('stone_tiles', [0.5, 0.1, 0.5], { at: [0, H + 0.04, 0] });
  b.box('stone_brick', [0.4, 0.07, 0.4], { at: [0, H + 0.125, 0], off: [0.3, 0.2] });
  // four iron claws reaching up for the crystal
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const cx = Math.cos(a) * 0.17;
    const cz = -Math.sin(a) * 0.17;
    b.tube('metal', [cx, H + 0.14, cz], [cx * 1.25, H + 0.36, cz * 1.25], 0.028, 0.02, { segments: 4, uRepeat: 1 });
  }
  // a couple of fallen stones and moss at the foot
  for (let k = 0; k < 2; k++) {
    const a = rng.range(0, TAU);
    const s = rng.range(0.1, 0.16);
    f.rockGeom(b, Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82, [s * 1.3, s, s * 1.1], rng, {
      top: f.extra.material('boulder_moss'), side: f.extra.material('boulder'), detail: 0, yaw: a,
    });
  }
  const group = f.finish(b, 'waystone', x, y, z, 0);

  // ---- per-instance emissive material (crystal + runes): a clone of a library material shares its
  // program and textures; only the colours are its own ----
  const mat = f.textures.material('plaster', { vertexColors: true }).clone();
  mat.name = 'luminati:waystone-crystal';
  mat.color.set('#6aa6b5');
  mat.emissive = new THREE.Color(WAYSTONE_COLORS.idle);
  mat.emissiveIntensity = 0.9;
  // (the runes and the crystal are unmerged meshes; their shadows would be specks on the pillar —
  // not worth a shadow-pass draw call each)
  mat.userData.castShadow = false;

  // ---- runes: glowing strokes carved into the four faces (static, but unmerged: own material) ----
  const rb = f.builder();
  const faceR = (yy) => (r0 + ((r1 - r0) * (yy - 0.36)) / (H - 0.36)) * Math.SQRT1_2;
  const GLYPHS = [
    [[0, -1, 0, 1], [0, 0.4, 0.55, 0.95], [0, -0.1, 0.55, 0.4]],
    [[-0.45, -1, -0.45, 1], [0.45, -1, 0.45, 1], [-0.45, 0.6, 0.45, -0.2]],
    [[0, -1, 0, 1], [-0.5, 0.5, 0.5, -0.1], [0.5, 0.5, -0.5, -0.1]],
    [[-0.5, 1, 0.5, 0], [0.5, 0, -0.5, -1], [0, -1, 0, 1]],
  ];
  const stroke = (side, ax, ay, bx, by) => {
    // (a, b) in face space: u across the face, y up; the stroke is a thin quad just proud of the face
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * 0.022;
    const ny = ((bx - ax) / len) * 0.022;
    const P = (u, yy) => {
      const d = faceR(yy) + 0.012;
      const c = Math.cos(side);
      const s = Math.sin(side);
      // face `side` looks along (cos side, -sin side) in XZ; u runs along its tangent
      return [c * d + s * u, yy, -s * d + c * u];
    };
    // (u runs right-to-left seen from outside the face: this order keeps the quad facing out)
    rb.quad(mat, [P(ax + nx, ay + ny), P(bx + nx, by + ny), P(bx - nx, by - ny), P(ax - nx, ay - ny)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  };
  for (let k = 0; k < 4; k++) {
    const side = (k * Math.PI) / 2;
    for (let g = 0; g < 3; g++) {
      const gl = GLYPHS[(k + g + rng.int(0, 3)) % GLYPHS.length];
      const cy = 0.72 + g * 0.42;
      for (const [ax, ay, bx, by] of gl) stroke(side, ax * 0.07, cy + ay * 0.1, bx * 0.07, cy + by * 0.1);
    }
  }
  const { group: runes, geometries: runeGeos } = rb.build('waystone:runes');
  f.track(runeGeos);
  runes.userData.dynamic = true;
  group.add(runes);

  // ---- the crystal: an elongated octahedron, bobbing and turning ----
  const cb = f.builder();
  const cr = 0.2;
  const top = [0, 0.44, 0];
  const bot = [0, -0.3, 0];
  const eq = [0, 1, 2, 3].map((k) => [Math.cos((k * Math.PI) / 2) * cr, 0, -Math.sin((k * Math.PI) / 2) * cr]);
  for (let k = 0; k < 4; k++) {
    const a = eq[k];
    const c = eq[(k + 1) % 4];
    cb.tri(mat, a, c, top, [0, 0], [0.4, 0], [0.2, 0.44], { color: k % 2 ? [1.15, 1.2, 1.25] : [0.95, 1.0, 1.05] });
    cb.tri(mat, c, a, bot, [0.4, 0], [0, 0], [0.2, 0.3], { color: k % 2 ? [0.62, 0.72, 0.82] : [0.5, 0.6, 0.72] });
  }
  const { group: crystal, geometries: crystalGeos } = cb.build('waystone:crystal');
  f.track(crystalGeos);
  const baseY = H + 0.62;
  crystal.position.set(0, baseY, 0);
  crystal.rotation.y = rng.range(0, TAU);
  crystal.userData.dynamic = true;
  group.add(crystal);

  // additive glow card behind the crystal (billboard, the flame glow shader: no new program)
  const gsz = 1.7;
  const glowGeo = new THREE.PlaneGeometry(gsz, gsz);
  f.track([glowGeo]);
  const glowMat = createGlowMaterial({ color: WAYSTONE_COLORS.idle, intensity: 0.34, seed: rng.range(0, 100), day: 0.8 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'waystone:glow';
  glow.renderOrder = RENDER_ORDER.PARTICLES + 5;
  glow.castShadow = false;
  glow.receiveShadow = false;
  glow.position.y = 0.05;
  crystal.add(glow);
  group.updateMatrixWorld(true);

  const controls = {
    attuned: false,
    /** Light the crystal up (attuned: the player's checkpoint) or dim it again. */
    setAttuned(on) {
      controls.attuned = !!on;
      mat.emissive.set(on ? WAYSTONE_COLORS.attuned : WAYSTONE_COLORS.idle);
      glowMat.uniforms.uColor.value.set(on ? WAYSTONE_COLORS.attuned : WAYSTONE_COLORS.idle);
      glowMat.uniforms.uIntensity.value = on ? 0.62 : 0.34;
      return controls.attuned;
    },
  };
  let t = rng.range(0, 10);
  const res = f.result(group, {
    colliders: [{ type: 'circle', x, z, r: 0.5 }],
    emissives: [{ material: mat, day: 0.9, night: 1.6 }],
    interact: { position: new THREE.Vector3(x, y, z), radius: 1.5, id: opts.id ?? 'waystone' },
    materials: [mat, glowMat],
    update: (dt) => {
      t = (t + dt) % 1000;
      crystal.position.y = baseY + Math.sin(t * 1.7) * 0.06;
      crystal.rotation.y = (crystal.rotation.y + dt * 0.7) % TAU;
    },
  });
  res.controls = controls;
  res.crystal = crystal;
  return res;
}
