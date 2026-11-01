import * as THREE from 'three';
import { smoothstep } from '../../utils/math.js';
import { TRIM, lanternGeom } from './Details.js';

/** @import { PropFactory } from '../Props.js' */

/**
 * Light-emitting props: lamppost, wall torch and campfire. Lights / emitters / emissives are
 * returned as descriptors (PropResult) for the integrator to wire into LightingSystem & Particles.
 */

/**
 * Iron lamppost: stone footing, square iron post with collars, curled arm and a hanging lantern.
 * opts: { rotation = 0 (arm points toward local +X), height = 2.9, style = 'arm'|'top' }
 * @param {PropFactory} f
 */
export function buildLamppost(f, x, y, z, opts = {}) {
  const rot = opts.rotation ?? 0;
  const Hp = opts.height ?? 2.9;
  const style = opts.style ?? 'arm';
  const b = f.builder((px, py) => 0.7 + 0.3 * smoothstep(0, 0.6, py));
  const glass = f.glassMaterial();
  const M = 'metal';
  // footing
  b.box('stone_brick', [0.5, 0.26, 0.5], { at: [0, 0.13, 0], faces: { ny: false }, off: [0.2, 0] });
  b.box('stone_brick', [0.38, 0.12, 0.38], { at: [0, 0.32, 0], faces: { ny: false }, off: [0.6, 0.1] });
  // post + collars
  b.box(M, [0.2, 0.3, 0.2], { at: [0, 0.53, 0] });
  b.box(M, [0.13, Hp - 0.6, 0.13], { at: [0, 0.68 + (Hp - 0.6) / 2 - 0.1, 0], faces: { ny: false } });
  b.box(M, [0.2, 0.06, 0.2], { at: [0, 1.25, 0] });
  b.box(M, [0.2, 0.08, 0.2], { at: [0, Hp - 0.04, 0] });
  b.box(M, [0.08, 0.14, 0.08], { at: [0, Hp + 0.07, 0] });
  b.box(M, [0.14, 0.05, 0.14], { at: [0, Hp + 0.16, 0] });
  let lanternPos;
  if (style === 'top') {
    lanternGeom(b, glass, 0, Hp + 0.45, 0, { w: 0.3, h: 0.4 });
    lanternPos = [0, Hp + 0.45, 0];
  } else {
    // arm with a scroll curl underneath
    const armY = Hp - 0.1;
    const reach = 0.62;
    b.box(M, [reach, 0.06, 0.06], { at: [reach / 2, armY, 0] });
    b.box(M, [0.08, 0.08, 0.08], { at: [reach, armY + 0.02, 0] });
    const segs = 9;
    const cr = 0.17;
    const ccx = 0.24;
    const ccy = armY - 0.2;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI * 0.5 + (i / segs) * Math.PI * 1.75;
      const a1 = Math.PI * 0.5 + ((i + 1) / segs) * Math.PI * 1.75;
      const rr0 = cr * (1 - (i / segs) * 0.55);
      const rr1 = cr * (1 - ((i + 1) / segs) * 0.55);
      const p0 = [ccx + Math.cos(a0) * rr0, ccy + Math.sin(a0) * rr0];
      const p1 = [ccx + Math.cos(a1) * rr1, ccy + Math.sin(a1) * rr1];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      b.box(M, [len + 0.03, 0.04, 0.045], { at: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0], rot: [0, 0, Math.atan2(p1[1] - p0[1], p1[0] - p0[0])] });
    }
    // brace from the post up to the curl
    b.box(M, [0.04, 0.24, 0.04], { at: [0.08, armY - 0.12, 0], rot: [0, 0, -0.6] });
    // hook + chain + lantern
    b.box(M, [0.025, 0.14, 0.025], { at: [reach, armY - 0.09, 0] });
    const ly = armY - 0.46;
    lanternGeom(b, glass, reach, ly, 0, { w: 0.26, h: 0.34 });
    lanternPos = [reach, ly, 0];
  }
  const group = f.finish(b, 'lamppost', x, y, z, rot);
  const lp = f.world(group, new THREE.Vector3(...lanternPos));
  return f.result(group, {
    colliders: [{ type: 'circle', x, z, r: 0.26 }],
    lights: [{ position: lp, color: 0xffb46b, intensity: opts.intensity ?? 12, distance: opts.distance ?? 9, flicker: 0.2, nightOnly: true }],
    emissives: [{ material: glass, day: 0, night: 2.4 }],
    emitters: [],
  });
}

/**
 * Wall-mounted torch: iron wall plate + angled bracket, wooden handle, animated flame billboard.
 * (x, y, z) is the mount point on the wall; local +Z (after `rotation`) points out of the wall.
 * @param {PropFactory} f
 */
export function buildWallTorch(f, x, y, z, opts = {}) {
  const rng = f.rng('walltorch', x, z, opts.seed);
  const rot = opts.rotation ?? 0;
  const b = f.builder();
  const M = 'metal';
  b.box(M, [0.2, 0.34, 0.04], { at: [0, 0, 0.02] });
  b.box(M, [0.05, 0.05, 0.3], { at: [0, -0.06, 0.16] });
  b.box(M, [0.14, 0.05, 0.14], { at: [0, -0.02, 0.3] });
  // handle (tilted outward)
  const tilt = 0.28;
  const base = [0, -0.22, 0.26];
  const tip = [0, 0.3, 0.26 + Math.sin(tilt) * 0.5];
  b.tube('bark', base, tip, 0.05, 0.065, { segments: 6 });
  // pitch-soaked wrap at the head
  b.tube(TRIM, [0, tip[1] - 0.12, tip[2] - 0.035], [0, tip[1] + 0.02, tip[2] + 0.005], 0.085, 0.08, { segments: 6, capTop: true, color: [0.35, 0.3, 0.3] });
  const group = f.finish(b, 'wallTorch', x, y, z, rot);
  const fl = f.flame({ width: 0.56, height: 0.8, seed: rng.range(0, 100), glowSize: 2.4, glowIntensity: 0.5 });
  fl.object.position.set(0, tip[1] + 0.01, tip[2]);
  group.add(fl.object);
  group.updateMatrixWorld(true);
  const lp = f.world(group, new THREE.Vector3(0, tip[1] + 0.35, tip[2] + 0.2));
  return f.result(group, {
    colliders: [],
    lights: [{ position: lp, color: 0xff9a45, intensity: opts.intensity ?? 7, distance: opts.distance ?? 7, flicker: 0.45, nightOnly: false }],
    emissives: [],
    emitters: opts.embers ? [{ preset: 'embers', position: f.world(group, new THREE.Vector3(0, tip[1] + 0.5, tip[2])), rate: 2 }] : [],
    flames: [fl],
  });
}

/**
 * Campfire: ring of stones, ash bed, crossed logs, a log seat, animated flame + glow,
 * embers & smoke emitters and a strongly flickering warm light (burns day and night).
 * @param {PropFactory} f
 */
export function buildCampfire(f, x, y, z, opts = {}) {
  const rng = f.rng('campfire', x, z, opts.seed);
  const rot = opts.rotation ?? rng.range(0, Math.PI * 2);
  const b = f.builder();
  // ash bed
  const ash = f.extra.material('ash');
  b.lathe(ash, [{ y: 0.012, r: 0.72 }, { y: 0.05, r: 0.5 }, { y: 0.06, r: 0.01 }], { segments: 10, smooth: true, normalUp: 2 });
  // stone ring
  const n = opts.stones ?? 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const rr = 0.8 + rng.range(-0.04, 0.04);
    const s = rng.range(0.17, 0.23);
    f.rockGeom(b, Math.cos(a) * rr, 0, Math.sin(a) * rr, [s * 1.2, s * 0.8, s], rng, { top: f.extra.material('boulder'), side: f.extra.material('boulder'), detail: 0, yaw: -a });
  }
  // crossed logs (teepee-ish)
  const logs = opts.logs ?? 4;
  for (let i = 0; i < logs; i++) {
    const a = (i / logs) * Math.PI * 2 + 0.4;
    const ex = Math.cos(a);
    const ez = Math.sin(a);
    const s = [ex * 0.62, 0.08, ez * 0.62];
    const e = [-ex * 0.1, 0.36, -ez * 0.1];
    b.tube('bark', s, e, 0.085, 0.06, {
      segments: 6, capBottom: 'wood_planks', twist: i,
      colorFn: (ri) => (ri === 0 ? [0.95, 0.9, 0.9] : [0.28, 0.22, 0.22]), rings: 2,
    });
  }
  // a log seat beside the fire
  if (opts.seat !== false) {
    const a = rng.range(0, Math.PI * 2);
    const cx = Math.cos(a) * 1.7;
    const cz = Math.sin(a) * 1.7;
    const tx = -Math.sin(a) * 0.7;
    const tz = Math.cos(a) * 0.7;
    b.tube('bark', [cx - tx, 0.2, cz - tz], [cx + tx, 0.21, cz + tz], 0.21, 0.2, { segments: 7, capTop: 'wood_planks', capBottom: 'wood_planks', twist: 0.5 });
  }
  const group = f.finish(b, 'campfire', x, y, z, rot);
  const fl = f.flame({ width: 1.15, height: 1.3, seed: rng.range(0, 100), glowSize: 2.7, glowIntensity: 0.55 });
  fl.object.position.set(0, 0.05, 0);
  group.add(fl.object);
  group.updateMatrixWorld(true);
  return f.result(group, {
    colliders: [{ type: 'circle', x, z, r: 0.95 }],
    lights: [{ position: new THREE.Vector3(x, y + 0.9, z), color: 0xff8c3a, intensity: opts.intensity ?? 14, distance: opts.distance ?? 10, flicker: 0.5, nightOnly: false }],
    emissives: [],
    emitters: [
      { preset: 'embers', position: new THREE.Vector3(x, y + 0.7, z), rate: 6 },
      { preset: 'smoke', position: new THREE.Vector3(x, y + 1.5, z), rate: 2.5 },
    ],
    interact: { position: new THREE.Vector3(x, y, z), radius: 1.6, id: opts.id ?? 'campfire' },
    flames: [fl],
  });
}
