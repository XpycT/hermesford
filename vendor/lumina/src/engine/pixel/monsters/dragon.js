/**
 * Vorthrax, the Ashen Tyrant — the dragon boss of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.6): ≈ 12 u wingspan in 192 × 176 frames (12 × 11 u: room for the raised wings). Owner: the
 * dragon package.
 *
 * **A parametric rig, rasterised.** Every frame is the same 3D skeleton in a pose — a torso of
 * tapered tubes, an S-curved neck (a Bézier sampled into tubes), a horned head with a hinged jaw,
 * a tail chain curling round toward the viewer and ending in a barbed blade, four legs posed by
 * two-bone IK (the forelegs' elbows bend back, the hind legs are digitigrade), and two wings: arm,
 * forearm and four finger bones with a scalloped membrane between them, raised / beaten / folded by
 * three angles. `draw` builds the rig for the pose (`POSES`), projects it orthographically — the
 * side view from 17.5° above (the engine's sprites face the camera; a little of the top shows, as
 * the diorama camera sees it), the front view for the poses that face the camera — and rasterises
 * it into a z-buffer with per-pixel normals: the 5-tone ramps by the light from the upper left,
 * mottled scales laid out in each tube's own surface coordinates (they ride with the bones from
 * frame to frame) with lighter crimson scales on the lit side, bone-ash belly plates on the
 * underside with magma glowing between them, ember cracks (glow texels) between the plates of the
 * shaded flanks, horns and spikes charred dark with a pale tip. A far part touching a nearer one
 * gets a dark inner line. Then the light of the lair (`light`): a golden-hour **rim** along every
 * edge that faces the low sun behind the dragon's left (the silhouette and the edges of the nearer
 * parts — the neck over the chest, the arms over the body), and the **lava's bounce** from below,
 * hot orange on whatever faces down (the chest's underside, the belly plates, the jaw's underside,
 * the limbs' inner sides). MonsterSprites adds the silhouette outline. RNG-free: the textures are
 * `hash2` lattices with fixed seeds.
 *
 * **Seen from the front** (the party comes from the south, the camera looks north: what the player
 * mostly sees) the dragon is drawn for that view: the big head lowered and glowering, its snout
 * foreshortened toward the camera (a broad grooved muzzle, nostrils, the jaw line, fangs jutting
 * over the lips, burning slanted eyes under heavy brows), the horns swept back, out and down
 * along the skull in a wide crown, the neck an S-curve up from the chest, the forelegs bowed out
 * at the elbow on four splayed gripping claws, the hind legs crouched wide, the wings folded behind
 * the shoulders at rest and half-spread round the body in the moves, the tail curled round from
 * behind into view on the near side (`poseOf`).
 *
 * **The sheet** (MonsterSprites `layout`): the 54 poses (`DRAGON_COLUMNS`) in the side view facing
 * left, the same mirrored for right, and in the front view (`DRAGON_FRONT`: a dragon facing the
 * camera) — 9 rows of 21 cells, 4032 × 1584 px. The brain (src/game/combat/ai/dragon.js) shows them
 * through `sheet.cell(name, dir)`; facing away from the camera it shows the side view.
 *
 * Glow texels (alpha 204: the brain's `glow` lights them): the eyes, the ember cracks, the maw and
 * the throat's furnace in the breath poses.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** Frame size (px) and the model's origin column. */
const FW = 192;
const FH = 176;
const CX = 96;
/**
 * The projection's look from above (sin, cos): 17.5° for the side view, 28° for the front view
 * (the diorama camera looks down on a dragon facing it: its back and spread wings show).
 */
const TILT_SIDE = 0.3;
const TILT_FRONT = 0.47;
const TC_SIDE = Math.sqrt(1 - TILT_SIDE * TILT_SIDE);
const TC_FRONT = Math.sqrt(1 - TILT_FRONT * TILT_FRONT);
/** The light in view space (x right, y down, z toward the viewer): from the upper left and the front. */
const LIGHT = norm3([-0.5, -0.74, 0.46]);
/** A far part this much (px) behind a nearer neighbour gets a dark inner line. */
const LINE_DEPTH = 5;

/**
 * The poses (the sheet's columns, the side view): idle (breathing), walk (heavy steps), hover
 * (a wing-beat), land (the descent: flared, reaching, touchdown, rising), roar, bite, claw, tail
 * sweep, breath, take-off, dive, hurt, stagger (crashed, stunned), death (throes to the heap), gust
 * (a wing beat forward) and stomp (reared up, then down).
 */
export const DRAGON_COLUMNS = Object.freeze([
  'idle0', 'idle1', 'idle2', 'idle3',
  'walk0', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5',
  'hover0', 'hover1', 'hover2', 'hover3', 'hover4', 'hover5',
  'land0', 'land1', 'land2', 'land3',
  'roar0', 'roar1', 'roar2',
  'bite0', 'bite1', 'bite2',
  'claw0', 'claw1', 'claw2',
  'tail0', 'tail1', 'tail2', 'tail3',
  'breath0', 'breath1', 'breath2', 'breath3',
  'takeoff0', 'takeoff1', 'takeoff2',
  'dive0', 'dive1',
  'hurt',
  'stagger0', 'stagger1',
  'death0', 'death1', 'death2', 'death3', 'death4',
  'gust0', 'gust1',
  'stomp0', 'stomp1',
]);

/**
 * The poses with a front view (facing the camera): every pose — a move aimed at the camera shows
 * the dragon turned toward it (three rows of the sheet).
 */
export const DRAGON_FRONT = DRAGON_COLUMNS;

/**
 * The front view's look over every pose: the head drawn bigger (it is nearer the camera), bulkier
 * limbs, the elbows and knees turned well out, the neck swaying in an S; and the feet set wider
 * apart, the tail curled round into view (`poseOf`).
 * @type {PoseParams}
 */
const FRONT_LOOK = { headScale: 1.6, bulk: 1.2, splay: 1.0, neckZ: 6 };
/**
 * The front view's tail: down from the haunch behind the body, swinging out early round the near
 * side to lie on the ground beside it, its blade turned forward (a pose's own `front.tail` wins:
 * the tail sweep's).
 * @type {number[]}
 */
const FRONT_TAIL = [-0.85, 1.0, 3.1, 0.7];

// =================================================================================================
// small vector maths (model space: x forward, y up, z toward the near side)
// =================================================================================================

/** @typedef {[number, number, number]} V3 */

/** @param {number[]} v @returns {V3} */
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** @param {number[]} a @param {number[]} b @returns {V3} */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {number[]} a @param {number[]} b @returns {V3} */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number} k @returns {V3} */
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** @param {number[]} a @param {number[]} b */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {number[]} a @param {number[]} b @returns {V3} */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a @param {number[]} b @param {number} t @returns {V3} */
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** @param {number[]} a @param {number[]} b */
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Rotate (x, y) in the XY plane by `a`. @param {number} x @param {number} y @param {number} a @returns {[number, number]} */
const rot2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const DEG = Math.PI / 180;

// =================================================================================================
// primitives
// =================================================================================================

/**
 * Surface treatments: `scales` (the body: mottled scales, belly plates, ember cracks), `dark`
 * (darker scales: the brows), `bone` (claws, teeth: dark root → pale tip), `horn` (horns and
 * spikes: charred dark, pale only at the tip), `membrane` (wing skin), `glow` (the maw, the throat).
 * @typedef {'scales'|'dark'|'bone'|'horn'|'membrane'|'glow'} Tex
 */

/**
 * A tapered tube (a capsule) from `a` (radius ra) to `b` (rb), in model space; `u0` its start's
 * distance along its chain and `uLen` the chain's length (the textures and the bone gradient run
 * on them), `belly` the chain's underside direction (null: no belly plates), `part` its inner-line
 * group, `crack` its ember-crack amount (0..1), `furnace` its belly plates' inner glow (0..1: the
 * gaps between the plates glow — the breath kindling), `lift` a tone offset (darker far limbs).
 * @typedef {object} Tube
 * @property {'tube'} k
 * @property {V3} a
 * @property {V3} b
 * @property {number} ra
 * @property {number} rb
 * @property {Tex} tex
 * @property {number} part
 * @property {number} u0
 * @property {number} uLen
 * @property {V3|null} belly
 * @property {number} crack
 * @property {number} furnace
 * @property {number} lift
 * @property {number} seed
 */

/**
 * A flat triangle: `a` the root (a wrist, a shoulder), `b` / `c` the rim; `edge` true when its
 * b–c side is a trailing edge (darkened toward it).
 * @typedef {object} Tri
 * @property {'tri'} k
 * @property {V3} a
 * @property {V3} b
 * @property {V3} c
 * @property {Tex} tex
 * @property {number} part
 * @property {boolean} edge
 * @property {number} lift
 */

/** @typedef {Tube|Tri} Prim */

/** Inner-line groups. */
const PART = { torso: 1, neck: 2, head: 3, jaw: 4, tail: 5, legFN: 6, legFF: 7, legHN: 8, legHF: 9, wingN: 10, wingF: 11, boneN: 12, boneF: 13, horn: 14, spike: 15, maw: 16, blade: 17 };

/** The rig being built for one pose (`build`): its primitives and the points the decals use. */
class Rig {
  constructor() {
    /** @type {Prim[]} */
    this.prims = [];
    /** @type {{ p: V3, kind: 'eye'|'nostril', part: number }[]} */
    this.decals = [];
    /** @type {{ a: V3, b: V3, part: number }[]} teeth rows (upper and lower) */
    this.teeth = [];
    /** @type {V3|null} the snout's tip (the eyes slant down toward it) */
    this.snout = null;
    this._seed = 1;
    /** Radii multiplier of the tubes added now (a head drawn bigger, bulkier limbs). */
    this.rscale = 1;
  }

  /**
   * @param {V3} a @param {V3} b @param {number} ra @param {number} rb
   * @param {Tex} tex @param {number} part
   * @param {{ u0?: number, uLen?: number, belly?: V3|null, crack?: number, furnace?: number, lift?: number, seed?: number }} [o]
   */
  tube(a, b, ra, rb, tex, part, o = {}) {
    this.prims.push({
      k: 'tube', a, b, ra: ra * this.rscale, rb: rb * this.rscale, tex, part, u0: o.u0 ?? 0, uLen: o.uLen ?? dist3(a, b),
      belly: o.belly ?? null, crack: o.crack ?? 0, furnace: o.furnace ?? 0, lift: o.lift ?? 0, seed: o.seed ?? this._seed++,
    });
  }

  /**
   * Tubes through `pts` with `radii` (one per point), the textures continuous along them.
   * @param {V3[]} pts @param {number[]} radii @param {Tex} tex @param {number} part
   * @param {{ belly?: V3|null, crack?: number, furnace?: number, lift?: number }} [o]
   */
  chain(pts, radii, tex, part, o = {}) {
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += dist3(pts[i], pts[i + 1]);
    let u = 0;
    const seed = this._seed++;
    for (let i = 0; i + 1 < pts.length; i++) {
      this.tube(pts[i], pts[i + 1], radii[i], radii[i + 1], tex, part, { ...o, u0: u, uLen: total, seed });
      u += dist3(pts[i], pts[i + 1]);
    }
  }

  /** @param {V3} a @param {V3} b @param {V3} c @param {Tex} tex @param {number} part @param {boolean} [edge] @param {number} [lift] */
  tri(a, b, c, tex, part, edge = false, lift = 0) {
    this.prims.push({ k: 'tri', a, b, c, tex, part, edge, lift });
  }
}

// =================================================================================================
// the rig
// =================================================================================================

/**
 * A pose's parameters (`POSES`; every field optional over `BASE`). `front` overrides some of them
 * for the front view.
 * @typedef {object} PoseParams
 * @property {number} [bx]       torso origin x (px)
 * @property {number} [by]       torso origin height above the ground (px)
 * @property {number} [pitch]    torso pitch (rad, + = chest up)
 * @property {number} [breathe]  chest swell 0..1
 * @property {[number, number, number, number]} [head]  skull centre x, y, head angle (rad, + = nose up), jaw (rad)
 * @property {number} [neckBend] the neck's S-curve depth (px)
 * @property {number} [neckZ]    the neck's sideways sway (px: an S seen from the front)
 * @property {number} [headZ]    the head's lateral offset (px; a turned head)
 * @property {number[]} [tail]  start elevation (rad, + = up), curl (rad over the tail, + = up), yaw (rad at the tip: round toward the viewer), and how late the yaw comes (the exponent along the tail: 1.15; less swings it out early)
 * @property {V3} [fn]  near foreleg's foot (x, lift, z)
 * @property {V3} [ff]  far foreleg's foot
 * @property {V3} [hn]  near hind foot
 * @property {V3} [hf]  far hind foot
 * @property {number[]} [wn]  near wing: beat (deg; 90 = straight up, 0 = out to the side), fold 0..1, sweep (deg, + = forward), twist (deg) — `wing`
 * @property {number[]} [wf]  far wing
 * @property {'open'|'narrow'|'shut'|'wide'} [eye]
 * @property {number} [furnace]  throat / chest glow 0..1 (breath)
 * @property {number} [lean]     roll of the whole body toward the near side (rad; a collapse)
 * @property {number} [headScale] the head's size (× 1; the front view draws it bigger: it is nearer)
 * @property {number} [bulk]     the limbs' thickness (× 1)
 * @property {number} [splay]    how far the elbows and knees turn out (0.35; the front view's stance more)
 * @property {PoseParams} [front] overrides for the front view
 */

/** @type {Required<PoseParams>} the standing rest pose */
const BASE = {
  bx: 2, by: 56, pitch: 0.12, breathe: 0,
  head: [56, 114, -0.1, 0.05], neckBend: 9, neckZ: 0, headZ: 0,
  tail: [-0.45, 0.75, 1.9],
  fn: [26, 0, 14], ff: [16, 0, -14], hn: [-20, 0, 13], hf: [-32, 0, -13],
  wn: [60, 1, 0], wf: [66, 1, 0],
  eye: 'open', furnace: 0, lean: 0, headScale: 1, bulk: 1, splay: 0.35, front: {},
};

/**
 * The rig of a pose.
 * @param {Required<PoseParams>} P
 * @returns {Rig}
 */
function build(P) {
  const R = new Rig();
  const O = [P.bx, P.by, 0];
  const pitch = P.pitch;
  /** a point of the torso's frame (x along the spine, y up from it, z lateral) → model @type {(x: number, y: number, z?: number) => V3} */
  const T = (x, y, z = 0) => {
    const [rx, ry] = rot2(x, y, pitch);
    return rollZ([O[0] + rx, O[1] + ry, z], P.lean, O);
  };
  const sw = P.breathe;

  // ---- torso: tail root → haunch → waist → deep chest → shoulders ----
  const spine = [T(-42, 0), T(-27, 3), T(-8, 1), T(12, 4), T(27, 9)];
  const radii = [12.5, 17.5, 17 + 0.8 * sw, 20.5 + 1.8 * sw, 16 + sw];
  R.chain(spine, radii, 'scales', PART.torso, { belly: down(pitch), crack: 0.85, furnace: P.furnace * 0.6 });
  spikes(R, spine, radii, 6.5, 8, PART.spike, 0);

  // ---- neck: an S-curve from the shoulders up to the head ----
  const [hx, hy, ha, jaw] = P.head;
  const Hp = rollZ([hx, hy, P.headZ], P.lean, O);
  const f = [Math.cos(ha), Math.sin(ha), 0];
  const up = [-Math.sin(ha), Math.cos(ha), 0];
  const hk = P.headScale;
  /** @type {(a: number, b: number, z?: number) => V3} a point of the head's frame */
  const H = (a, b, z = 0) => [Hp[0] + (f[0] * a + up[0] * b) * hk, Hp[1] + (f[1] * a + up[1] * b) * hk, Hp[2] + z * hk];
  const n0 = T(26, 13);
  const nd = norm3([0.42, 0.9, 0]);
  const hb = H(-10, -2);
  const c1 = add(n0, add(mul(nd, 22), [0, 0, P.neckZ]));
  const c2 = add(hb, [-P.neckBend - 3, -P.neckBend - 8, -P.neckZ * 0.75]);
  const neck = [];
  const nr = [];
  const NS = 9;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    neck.push(bezier(n0, c1, c2, hb, t));
    nr.push(13.5 - 5.2 * t);
  }
  R.chain(neck, nr, 'scales', PART.neck, { belly: [1, -0.3, 0], crack: 0.5, furnace: P.furnace });
  spikes(R, neck.slice(1, NS), nr.slice(1, NS), 5, 5.5, PART.spike, 1);

  // ---- head ----
  R.rscale = hk;
  head(R, H, Hp, ha, jaw, P);
  R.rscale = 1;

  // ---- tail: back and down from the haunch, curling up and round toward the viewer ----
  const [elev, curl, yawTip, yawPow = 1.15] = P.tail;
  const tail = [spine[0]];
  const tr = [radii[0]];
  let p = spine[0];
  const TS = 10;
  for (let i = 1; i <= TS; i++) {
    const t = i / TS;
    const e = elev + pitch * 0.5 + curl * t * t;
    const yaw = yawTip * Math.pow(t, yawPow);
    const seg = 10.6 - 2.2 * t;
    p = [p[0] - Math.cos(e) * Math.cos(yaw) * seg, p[1] + Math.sin(e) * seg, p[2] + Math.cos(e) * Math.sin(yaw) * seg];
    tail.push(rollZ(p, P.lean * (1 - t), O));
    tr.push(12 - 10.4 * Math.pow(t, 0.8));
  }
  R.chain(tail, tr, 'scales', PART.tail, { belly: [0, -1, 0], crack: 0.25 });
  spikes(R, tail.slice(0, 7), tr.slice(0, 7), 6, 4.4, PART.spike, 2);
  tailBlade(R, tail[TS - 1], tail[TS]);

  // ---- legs ----
  R.rscale = P.bulk;
  foreleg(R, T(20, -5, -13), P.ff, PART.legFF, -0.6, P.lean, O, P.splay);
  hindleg(R, T(-27, -1, -12), P.hf, PART.legHF, -0.6, P.lean, O, P.splay);
  foreleg(R, T(20, -5, 13), P.fn, PART.legFN, 0, P.lean, O, P.splay);
  hindleg(R, T(-27, -1, 12), P.hn, PART.legHN, 0, P.lean, O, P.splay);
  R.rscale = 1;

  // ---- wings ----
  wing(R, T(8, 16, -9), -1, P.wf, pitch, PART.wingF, PART.boneF, -0.5);
  wing(R, T(8, 16, 9), 1, P.wn, pitch, PART.wingN, PART.boneN, 0);
  return R;
}

/** Roll a point about the torso's long axis through `o` (a collapse onto the near side). @param {V3} p @param {number} a @param {number[]} o @returns {V3} */
function rollZ(p, a, o) {
  if (!a) return p;
  const y = p[1] - o[1];
  const z = p[2];
  return [p[0], o[1] + y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

/** The torso's underside for a pitch. @param {number} pitch @returns {V3} */
function down(pitch) {
  return [Math.sin(pitch), -Math.cos(pitch), 0];
}

/** Cubic Bézier. @param {V3} a @param {V3} b @param {V3} c @param {V3} d @param {number} t @returns {V3} */
function bezier(a, b, c, d, t) {
  const s = 1 - t;
  return /** @type {V3} */ ([0, 1, 2].map((k) => s * s * s * a[k] + 3 * s * s * t * b[k] + 3 * s * t * t * c[k] + t * t * t * d[k]));
}

/**
 * Dorsal spikes along a chain's top: every `step` px a horn-dark spike leaning back (`len` px).
 * @param {Rig} R @param {V3[]} pts @param {number[]} radii
 * @param {number} step @param {number} len @param {number} part
 * @param {number} kind 0 the back, 1 the neck (leaning down the neck), 2 the tail
 */
function spikes(R, pts, radii, step, len, part, kind) {
  let carry = step * 0.5;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const d = norm3(sub(b, a));
    // the chain's up: perpendicular to it in its vertical plane, pointing up (the neck: backward-up)
    let u = norm3(sub([0, 1, 0], mul(d, d[1])));
    if (kind === 1) u = norm3([-d[1], d[0], 0]);
    if (kind === 1 && u[0] > 0.1) u = mul(u, -1);
    const segLen = dist3(a, b);
    let s = carry;
    for (; s < segLen; s += step) {
      const t = s / segLen;
      const r = radii[i] + (radii[i + 1] - radii[i]) * t;
      const base = add(lerp3(a, b, t), mul(u, r * 0.8));
      // lean away from the head: down the neck, back along the spine and the tail
      const back = kind === 1 ? mul(d, -0.6) : kind === 2 ? mul(d, 0.55) : mul(d, -0.55);
      const k = 0.75 + 0.35 * Math.abs(Math.sin(i * 1.7 + s * 0.45));
      const tip = add(base, add(mul(u, len * k), mul(back, len * 0.9)));
      R.tube(base, tip, Math.max(1.5, Math.min(2.8, r * 0.17)), 0.45, 'horn', part, { lift: -0.3 });
    }
    carry = s - segLen;
  }
}

/**
 * The head: skull, snout, the hinged jaw, brows, horns, cheek and chin spikes, the maw.
 * @param {Rig} R
 * @param {(a: number, b: number, z?: number) => V3} H a point of the head's frame
 * @param {V3} Hp the skull centre
 * @param {number} ha head angle
 * @param {number} jaw jaw opening (rad)
 * @param {Required<PoseParams>} P
 */
function head(R, H, Hp, ha, jaw, P) {
  const belly = /** @type {V3} */ ([0, -1, 0]);
  // the cranium (a broad dome) and the jaw muscles either side: the head reads wide from the front
  R.tube(H(-6, 1.5), H(4, 2.5), 10, 9.5, 'scales', PART.head, { belly });
  for (const z of [-5.6, 5.6]) R.tube(H(-4, -2.4, z), H(9, -3, z * 0.9), 6.8, 4.6, 'scales', PART.head, { belly });
  // the upper jaw: two ridges converging on the nose (a broad grooved muzzle), the nose's knob
  for (const z of [-2.9, 2.9]) R.tube(H(3, 1.2, z), H(26, -1.5, z * 0.72), 7, 4.4, 'scales', PART.head, { belly });
  R.tube(H(25, -1.1), H(29.6, -1.8), 5, 4.2, 'scales', PART.head, { belly });
  // the lower jaw, hinged under the ear: two mandibles meeting at the chin (the jaw line)
  const J = H(-2, -5);
  const ja = ha - jaw;
  const fj = [Math.cos(ja), Math.sin(ja), 0];
  const uj = [-Math.sin(ja), Math.cos(ja), 0];
  const k = P.headScale;
  /** @type {(a: number, b: number, z?: number) => V3} */
  const Jp = (a, b, z = 0) => [J[0] + (fj[0] * a + uj[0] * b) * k, J[1] + (fj[1] * a + uj[1] * b) * k, J[2] + z * k];
  for (const z of [-4.8, 4.8]) R.tube(Jp(0, 0, z), Jp(21, -0.4, z * 0.42), 5.2, 3.1, 'scales', PART.jaw, { belly });
  R.tube(Jp(19, -0.5), Jp(25.5, -0.8), 3.8, 3, 'scales', PART.jaw, { belly });
  // the maw: glowing deep inside, behind the jaws (a cone of glow from the throat to the lips:
  // seen from the side and from the front)
  if (jaw > 0.08) {
    R.tri(Jp(2, 1.5), H(26, -4.5), Jp(24, 1.5), 'glow', PART.maw);
    const lips = lerp3(H(25, -4.2), Jp(23, 1.6), 0.5);
    R.tube(Jp(3, 2), lips, 2.5, Math.max(1.5, (dist3(H(25, -4.2), Jp(23, 1.6)) / k) * 0.36), 'glow', PART.maw);
    R.teeth.push({ a: H(9, -6.6), b: H(26, -5.4), part: PART.head });
    R.teeth.push({ a: Jp(8, 3.6), b: Jp(24, 2.6), part: PART.jaw });
  }
  // fangs jutting over the lips, shut or open: the long upper pair at the front, a shorter pair
  // behind, the lower pair up past the upper lip
  for (const z of [-3.3, 3.3]) {
    R.tube(H(21.5, -4.6, z), H(22.6, -9.8, z * 1.04), 1.6, 0.45, 'bone', PART.head, { lift: 0.9 });
    R.tube(H(13.5, -5.4, z * 1.5), H(14, -8.6, z * 1.5), 1.25, 0.4, 'bone', PART.head, { lift: 0.6 });
    R.tube(Jp(19.5, 2.4, z * 0.8), Jp(20.5, 6.6, z * 0.8), 1.35, 0.4, 'bone', PART.jaw, { lift: 0.7 });
  }
  // heavy brows over the eyes (ending above them: seen from above a longer brow hides them), the
  // nose horns
  for (const z of [-6.2, 6.2]) R.tube(H(-2, 7.2, z), H(10, 5.6, z * 0.95), 4.6, 2.8, 'dark', PART.head);
  R.tube(H(23, 2.5), H(26.6, 7.8), 2.2, 0.5, 'horn', PART.horn);
  R.tube(H(16.5, 4.2), H(18.5, 7.4), 1.6, 0.5, 'horn', PART.horn, { lift: -0.4 });
  // the great horns: back, out and down along the skull (a wide crown from the front, a hook
  // behind the head from the side); the lesser horns under them, the cheek frill
  for (const z of [-5.5, 5.5]) {
    const far = z < 0 ? -0.6 : 0;
    R.chain(
      [H(-2, 6.2, z), H(-8, 8.6, z * 1.8), H(-16, 8.2, z * 2.6), H(-24, 4.6, z * 3.1), H(-29, -1, z * 3.25), H(-30, -7.5, z * 3.05)],
      [4.1, 3.5, 2.8, 2.1, 1.3, 0.5], 'horn', PART.horn, { lift: far },
    );
    R.tube(H(-6, 2.6, z * 1.35), H(-18, 2, z * 2.25), 2.1, 0.5, 'horn', PART.horn, { lift: far - 0.2 });
    R.tube(H(-7, -3, z * 1.5), H(-17, -8.5, z * 2.4), 2.1, 0.5, 'horn', PART.horn, { lift: far - 0.3 });
    R.tube(H(-1, -6, z * 1.4), H(-8, -12, z * 2.1), 1.8, 0.5, 'horn', PART.horn, { lift: far - 0.3 });
  }
  // chin barbs
  R.tube(Jp(7, -3.5), Jp(3, -10), 1.9, 0.5, 'horn', PART.jaw, { lift: -0.3 });
  R.tube(Jp(14, -3), Jp(12, -8), 1.5, 0.5, 'horn', PART.jaw, { lift: -0.3 });
  // the burning eyes under the brows, the nostrils (decals: drawn where visible)
  R.decals.push({ p: H(11, 3.2, 7.4), kind: 'eye', part: PART.head });
  R.decals.push({ p: H(11, 3.2, -7.4), kind: 'eye', part: PART.head });
  R.decals.push({ p: H(29.2, 0.6, 2.3), kind: 'nostril', part: PART.head });
  R.decals.push({ p: H(29.2, 0.6, -2.3), kind: 'nostril', part: PART.head });
  R.snout = H(30, -1.5);
  void Hp;
}

/**
 * The tail's blade: a barbed spade at the tip.
 * @param {Rig} R @param {V3} a the last joint @param {V3} b the tip
 */
function tailBlade(R, a, b) {
  const d = norm3(sub(b, a));
  const u = norm3(cross(d, [0, 0, 1]));
  const tip = add(b, mul(d, 12));
  const l = add(add(b, mul(u, 6.5)), mul(d, -3));
  const r = add(add(b, mul(u, -6.5)), mul(d, -3));
  R.tri(b, l, tip, 'bone', PART.blade, false, -0.4);
  R.tri(b, tip, r, 'bone', PART.blade, false, -1);
  R.tube(add(b, mul(d, -3)), tip, 2.2, 0.6, 'bone', PART.blade, { lift: -0.2 });
}

/**
 * Two-bone IK: the joint between `a` and `c` with bone lengths l1, l2, bent toward `bend`.
 * @param {V3} a @param {V3} c @param {number} l1 @param {number} l2 @param {V3} bend @returns {V3}
 */
function ik(a, c, l1, l2, bend) {
  const ac = sub(c, a);
  let d = Math.hypot(...ac);
  const dir = mul(ac, 1 / (d || 1));
  d = Math.min(d, l1 + l2 - 0.01);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const bp = norm3(sub(bend, mul(dir, dot(bend, dir))));
  return add(add(a, mul(dir, x)), mul(bp, h));
}

/**
 * A foreleg: the shoulder's mass → the upper arm (its muscle bulging) → the elbow (bent back and
 * turned out by `splay`: the front view's bowed, bulldog stance) → the forearm (thick below the
 * elbow) → the wrist → four splayed fingers gripping the ground, each a knuckle and a claw curving
 * down into it, and a dewclaw.
 * @param {Rig} R @param {V3} S shoulder @param {V3} foot (x, lift, z) @param {number} part
 * @param {number} lift tone offset @param {number} lean @param {number[]} O
 * @param {number} splay how far the elbow turns out
 */
function foreleg(R, S, foot, part, lift, lean, O, splay) {
  const F = rollZ([foot[0], foot[1], foot[2]], lean * 0.5, O);
  const side = Math.sign(S[2]) || 1;
  const W = add(F, [-2, 7, 0]);
  const E = ik(S, W, 25, 25, [-1, 0.25, side * splay * 1.6]);
  // (the shoulder's mass belongs to the torso: no inner line round it)
  R.tube(S, S, 11, 11, 'scales', PART.torso, { lift: lift * 0.5, crack: 0.3 });
  R.tube(S, E, 10.5, 7.2, 'scales', part, { lift, crack: 0.3 });
  R.tube(lerp3(S, E, 0.22), lerp3(S, E, 0.72), 9.8, 7.8, 'scales', part, { lift });
  R.tube(E, W, 7.6, 5.2, 'scales', part, { lift });
  R.tube(lerp3(E, W, 0.06), lerp3(E, W, 0.5), 8.2, 6, 'scales', part, { lift });
  const hand = add(F, [5, 2.4, 0]);
  R.tube(W, hand, 5.8, 4.8, 'scales', part, { lift });
  for (const dz of [-5.2, -1.75, 1.75, 5.2]) {
    const kn = add(F, [8.5, 2.2, dz * 1.3]);
    R.tube(hand, kn, 3.3, 2.7, 'scales', part, { lift });
    R.tube(kn, add(F, [14, -1, dz * 1.6]), 2.4, 0.5, 'bone', part, { lift: lift - 0.1 });
  }
  R.tube(add(W, [0, -1, side * 3]), add(W, [-2, -6, side * 5.5]), 1.8, 0.5, 'bone', part, { lift: lift - 0.2 });
}

/**
 * A hind leg (digitigrade): the haunch → the thigh (its muscle) → the knee (bent forward and out)
 * → the hock → the foot, three splayed toes with claws, and a spur.
 * @param {Rig} R @param {V3} Hh hip @param {V3} foot @param {number} part @param {number} lift
 * @param {number} lean @param {number[]} O @param {number} splay how far the knee turns out
 */
function hindleg(R, Hh, foot, part, lift, lean, O, splay) {
  const F = rollZ([foot[0], foot[1], foot[2]], lean * 0.5, O);
  const A = add(F, [-8, 12, 0]);
  const K = ik(Hh, A, 24, 21, [1, -0.1, Math.sign(Hh[2]) * splay]);
  R.tube(Hh, Hh, 13.5, 13.5, 'scales', PART.torso, { lift: lift * 0.5, crack: 0.3 });
  R.tube(Hh, K, 13.5, 8.6, 'scales', part, { lift, crack: 0.3 });
  R.tube(lerp3(Hh, K, 0.2), lerp3(Hh, K, 0.65), 12, 9.6, 'scales', part, { lift });
  R.tube(K, A, 7.8, 5.2, 'scales', part, { lift });
  const toe = add(F, [4.5, 2.2, 0]);
  R.tube(A, toe, 5.4, 4.6, 'scales', part, { lift });
  for (const dz of [-4.6, 0, 4.6]) {
    const kn = add(F, [8, 1.8, dz * 1.25]);
    R.tube(toe, kn, 3.2, 2.6, 'scales', part, { lift });
    R.tube(kn, add(F, [13, -1, dz * 1.5]), 2.3, 0.5, 'bone', part, { lift: lift - 0.1 });
  }
  R.tube(add(A, [0, 1, 0]), add(A, [-6, -3, 0]), 1.9, 0.5, 'bone', part, { lift: lift - 0.2 });
}

/** Wing shape in its own plane (a: along the body, b: out along the span), spread and folded. */
const WING_SPREAD = { E: [-6, 30], W: [8, 64], T: [[0, 106], [-38, 99], [-63, 76], [-68, 44]], A: [-46, 4] };
const WING_FOLDED = { E: [-16, 12], W: [-2, 36], T: [[-50, 20], [-62, 6], [-60, -8], [-48, -16]], A: [-38, -10] };

/**
 * A wing: arm, forearm, four fingers and the membrane between them. `w`: beat (deg; 90 = straight
 * up, 0 = out to the side), fold (0 spread … 1 folded), sweep (deg: the outer wing turned forward
 * +, back −), twist (deg: the chord turned about the span — the membrane faces forward, a
 * threat display seen from the front).
 * @param {Rig} R @param {V3} S shoulder @param {number} side +1 near, −1 far
 * @param {number[]} w beat, fold, sweep, twist
 * @param {number} pitch the torso's
 * @param {number} part membrane group @param {number} bonePart bone group @param {number} lift
 */
function wing(R, S, side, w, pitch, part, bonePart, lift) {
  const [beat, fold, sweep, twist = 0] = w;
  const b = beat * DEG;
  const out = /** @type {V3} */ ([0, Math.sin(b), Math.cos(b) * side]);
  let along = /** @type {V3} */ ([Math.cos(pitch), Math.sin(pitch), 0]);
  if (twist) {
    // turn the chord about the span axis (Rodrigues), the trailing edge down and out
    const k = twist * DEG * side;
    const c = Math.cos(k);
    const sn = Math.sin(k);
    along = add(add(mul(along, c), mul(cross(out, along), sn)), mul(out, dot(out, along) * (1 - c)));
  }
  const sw = sweep * DEG;
  /** a point of the wing plane → model (the sweep turns the outer wing forward / back) @type {(p: number[]) => V3} */
  const P = (p) => {
    const [pa, pb] = rot2(p[0], p[1], sw * Math.min(1, p[1] / 90));
    return add(S, add(mul(along, pa), mul(out, pb)));
  };
  /** @type {(a: number[], c: number[]) => number[]} */
  const mix = (a, c) => [a[0] + (c[0] - a[0]) * fold, a[1] + (c[1] - a[1]) * fold];
  const E = P(mix(WING_SPREAD.E, WING_FOLDED.E));
  const Wr = P(mix(WING_SPREAD.W, WING_FOLDED.W));
  const tips = WING_SPREAD.T.map((t, i) => P(mix(t, WING_FOLDED.T[i])));
  const A = P(mix(WING_SPREAD.A, WING_FOLDED.A));
  // the membrane: fans between the fingers (their trailing edges scalloped toward the wrist, less
  // when folded), then wrist → last finger → body, and the arm's panel down to the body
  const rim = [...tips, A];
  const scallop = 0.22 * (1 - 0.7 * fold);
  for (let i = 0; i + 1 < rim.length; i++) {
    const p0 = rim[i];
    const p1 = rim[i + 1];
    const m = lerp3(lerp3(p0, p1, 0.5), Wr, i === rim.length - 2 ? scallop * 0.5 : scallop);
    R.tri(Wr, p0, m, 'membrane', part, true, lift);
    R.tri(Wr, m, p1, 'membrane', part, true, lift);
  }
  R.tri(S, E, A, 'membrane', part, false, lift);
  R.tri(E, Wr, A, 'membrane', part, false, lift);
  // bones: the arm, the forearm, the fingers (finer when folded; scaled, so the light and the rim
  // catch them over the membrane), the thumb claw at the wrist
  R.tube(S, E, 6.8, 5, 'scales', bonePart, { lift });
  R.tube(E, Wr, 5, 3.6, 'scales', bonePart, { lift });
  const fr = 1 - 0.35 * fold;
  for (let i = 0; i < tips.length; i++) R.tube(Wr, tips[i], (2.6 - i * 0.25) * fr, 0.9, 'scales', bonePart, { lift: lift + 0.2 });
  const thumb = add(Wr, mul(norm3(sub(Wr, E)), 8));
  R.tube(Wr, add(thumb, [2, 2, 0]), 2.6, 0.5, 'bone', bonePart, { lift: lift - 0.1 });
}

// =================================================================================================
// the rasteriser
// =================================================================================================

const NPX = FW * FH;
const ZB = new Float32Array(NPX);
const MAT = new Uint8Array(NPX);
const TONE = new Float32Array(NPX);
const PRT = new Uint8Array(NPX);
const DARK = new Uint8Array(NPX);
/** The view-space normal of each pixel (x right, y down, z toward the viewer): the light pass. */
const NXB = new Float32Array(NPX);
const NYB = new Float32Array(NPX);
/** What each pixel is for the light pass (`KIND`). */
const KND = new Uint8Array(NPX);
/** Scratch of the light pass: 1 the rim's edge pixel, 2 the pixel inside it. */
const RIMB = new Uint8Array(NPX);
/** Pixel kinds: the body's scales, the belly plates, the membrane, horn and bone, glow (unlit). */
const KIND = Object.freeze({ none: 0, body: 1, belly: 2, membrane: 3, horn: 4, glow: 5 });
/** The kind of the pixel `toneOf` just shaded. */
let _kind = 0;

/**
 * Model → view for a view: [screen x, screen y (down), toward the viewer].
 * @param {'down'|'up'|'side'} view @param {number[]} v @param {number} G @returns {V3}
 */
function project(view, v, G) {
  const [x, y, z] = v;
  // (the ground line lifted so the nearest feet — lower on screen, seen from above — stay in the frame)
  if (view === 'side') return [CX - x, G - 3 - y * TC_SIDE + z * TILT_SIDE, z * TC_SIDE + y * TILT_SIDE];
  if (view === 'down') return [CX - z, G - 11 - y * TC_FRONT + x * TILT_FRONT, x * TC_FRONT + y * TILT_FRONT];
  return [CX + z, G - 11 - y * TC_FRONT - x * TILT_FRONT, -x * TC_FRONT + y * TILT_FRONT];
}

/**
 * View → model for a normal (the transpose of `project`'s rotation).
 * @param {'down'|'up'|'side'} view @param {number} nx @param {number} ny @param {number} nz @returns {V3}
 */
function unproject(view, nx, ny, nz) {
  // (into one scratch vector: a few hundred thousand normals per sheet)
  const o = _nm;
  if (view === 'side') { o[0] = -nx; o[1] = -TC_SIDE * ny + TILT_SIDE * nz; o[2] = TILT_SIDE * ny + TC_SIDE * nz; }
  else if (view === 'down') { o[0] = TILT_FRONT * ny + TC_FRONT * nz; o[1] = -TC_FRONT * ny + TILT_FRONT * nz; o[2] = -nx; }
  else { o[0] = -TILT_FRONT * ny - TC_FRONT * nz; o[1] = -TC_FRONT * ny + TILT_FRONT * nz; o[2] = nx; }
  return o;
}
const _nm = /** @type {V3} */ ([0, 0, 0]);

/** Material ids by surface (set by `dragon(kit)`). @type {Record<string, number>} */
let MATS = {};

/**
 * Rasterise a rig into the z-buffer.
 * @param {Rig} R @param {'down'|'up'|'side'} view @param {number} G
 */
function rasterise(R, view, G) {
  ZB.fill(-1e9);
  MAT.fill(0);
  TONE.fill(0);
  PRT.fill(0);
  KND.fill(0);
  for (const pr of R.prims) {
    if (pr.k === 'tube') rasterTube(pr, view, G);
    else rasterTri(pr, view, G);
  }
}

/** @param {Tube} t @param {'down'|'up'|'side'} view @param {number} G */
function rasterTube(t, view, G) {
  const A = project(view, t.a, G);
  const B = project(view, t.b, G);
  const rMax = Math.max(t.ra, t.rb);
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0]) - rMax - 1));
  const x1 = Math.min(FW - 1, Math.ceil(Math.max(A[0], B[0]) + rMax + 1));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1]) - rMax - 1));
  const y1 = Math.min(FH - 1, Math.ceil(Math.max(A[1], B[1]) + rMax + 1));
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const dz = B[2] - A[2];
  const l2 = dx * dx + dy * dy;
  const len3 = dist3(t.a, t.b);
  // the tube's own frame in model space, for the texture's around-coordinate and the belly
  const d3 = norm3(sub(t.b, t.a));
  let ref = t.belly ? norm3(sub(t.belly, mul(d3, dot(t.belly, d3)))) : null;
  if (ref && !Number.isFinite(ref[0])) ref = null;
  const upRef = ref ? mul(ref, -1) : norm3(Math.abs(d3[1]) > 0.9 ? [1, 0, 0] : sub([0, 1, 0], mul(d3, d3[1])));
  const sideRef = cross(d3, upRef);
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let s = l2 > 1e-6 ? ((px - A[0]) * dx + (py - A[1]) * dy) / l2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const cx = A[0] + dx * s;
      const cy = A[1] + dy * s;
      const r = t.ra + (t.rb - t.ra) * s;
      const ox = px - cx;
      const oy = py - cy;
      const rho2 = ox * ox + oy * oy;
      if (rho2 >= r * r) continue;
      const nz = Math.sqrt(1 - rho2 / (r * r));
      const vz = A[2] + dz * s + nz * r;
      const i = y * FW + x;
      if (vz <= ZB[i]) continue;
      const nx = ox / r;
      const ny = oy / r;
      const nm = t.tex === 'scales' ? unproject(view, nx, ny, nz) : _nm;
      toneOf(t, nx, ny, nz, nm, t.u0 + s * len3, upRef, sideRef, r);
      ZB[i] = vz;
      MAT[i] = _tone[0];
      TONE[i] = _tone[1];
      PRT[i] = t.part;
      NXB[i] = nx;
      NYB[i] = ny;
      KND[i] = _kind;
    }
  }
}

const _tone = /** @type {[number, number]} */ ([0, 0]);

/**
 * Material and tone of a tube pixel (into `_tone`).
 * @param {Tube} t
 * @param {number} nx @param {number} ny @param {number} nz the view-space normal
 * @param {V3} nm the model-space normal
 * @param {number} u distance along the chain (px)
 * @param {V3} upRef @param {V3} sideRef the tube's frame
 * @param {number} r its radius here
 */
function toneOf(t, nx, ny, nz, nm, u, upRef, sideRef, r) {
  const l = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  if (t.tex === 'bone') {
    // dark root → pale tip along the chain
    _kind = KIND.horn;
    _tone[0] = MATS.bone;
    _tone[1] = 1.45 + 1.6 * l + t.lift + 1.5 * (u / Math.max(1, t.uLen) - 0.35);
    return;
  }
  if (t.tex === 'horn') {
    // charred dark along the chain, paling only over its last third
    const q = u / Math.max(1, t.uLen);
    _kind = KIND.horn;
    _tone[0] = MATS.horn;
    _tone[1] = 1.15 + 1.3 * l + t.lift + (q > 0.62 ? 2.9 * Math.pow((q - 0.62) / 0.38, 1.2) : 0);
    return;
  }
  if (t.tex === 'dark') {
    _kind = KIND.body;
    _tone[0] = MATS.dark;
    _tone[1] = 1.7 + 1.7 * l + t.lift;
    return;
  }
  if (t.tex === 'glow') {
    _kind = KIND.glow;
    _tone[0] = MATS.glow;
    _tone[1] = 2 + 1.6 * nz;
    return;
  }
  _kind = KIND.body;
  // scales: the around-coordinate (px) from the normal's angle in the tube's frame
  const a = Math.atan2(dot(nm, sideRef), dot(nm, upRef));
  const v = a * r;
  const under = dot(nm, upRef);
  if (t.belly && under < -0.4) {
    // bone-ash belly plates, one every 4.6 px along the chain; magma glows in the gaps between
    // them (brighter as the furnace kindles for the breath)
    _kind = KIND.belly;
    const k = u / 4.6;
    const fk = k - Math.floor(k);
    if (fk < 0.2 && (t.crack > 0.2 || t.furnace > 0.05)) {
      _kind = KIND.glow;
      _tone[0] = MATS.glow;
      _tone[1] = 1 + 3 * t.furnace;
      return;
    }
    _tone[0] = MATS.belly;
    _tone[1] = 1.95 + 1.5 * l + t.lift + (fk < 0.24 ? -1.05 : fk > 0.72 ? 0.3 : 0) + 0.8 * t.furnace;
    return;
  }
  let tone = 1.8 + 1.8 * l + t.lift;
  // overlapping scales: a staggered lattice of 5 × 4 px cells, each a rounded scale whose lower rim
  // lies in shade over the next row, a lit crown on the light side, each a little lighter or darker
  const sv = v / 4 + 60;
  const row = Math.floor(sv);
  const su = u / 5 + (row & 1) * 0.5;
  const col = Math.floor(su);
  const fu = su - col - 0.5;
  const fv = sv - row;
  const h = hash(col, row, t.seed);
  tone += (h - 0.5) * 0.26;
  const d = (fu / 0.56) ** 2 + ((fv - 0.28) / 0.78) ** 2;
  // ember seams along the flanks (glow texels: the brain's glow lights them)
  if (t.crack > 0 && under > -0.38 && under < 0.5 && crackAt(u, v, t.seed, t.crack)) {
    _kind = KIND.glow;
    _tone[0] = MATS.glow;
    _tone[1] = l < 0 ? 1 : 2;
    return;
  }
  if (d > 0.72 && fv > 0.42) tone -= 0.62;
  else if (d < 0.32 && fu < 0.1 && l > 0.1) tone += 0.38;
  // the top of the back catches the light: a rim of the light tone
  if (under > 0.82 && l > 0.2) tone += 0.35;
  // the lit planes turn crimson (the scales' pattern goes on in the crimson ramp); the far limbs
  // and the shade stay ash-black
  if (tone > 3.15 && t.lift > -0.3) {
    _tone[0] = MATS.crimson;
    _tone[1] = tone - 0.8;
    return;
  }
  _tone[0] = MATS.scales;
  _tone[1] = tone;
}

/**
 * Ember cracks on the scales: the borders of a jittered lattice of plates (in the tube's own
 * surface coordinates), only between plates a fixed hash makes cracked.
 * @param {number} u @param {number} v @param {number} seed @param {number} amount
 */
function crackAt(u, v, seed, amount) {
  const su = u / 16;
  const sv = v / 7 + 40;
  const iu = Math.floor(su);
  const iv = Math.floor(sv);
  let f1 = 9;
  let f2 = 9;
  let c1 = 0;
  let c2 = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cu = iu + i;
      const cv = iv + j;
      const pu = cu + 0.15 + 0.7 * hash(cu, cv, 11 + seed);
      const pv = cv + 0.15 + 0.7 * hash(cu, cv, 23 + seed);
      const d = (su - pu) * (su - pu) + (sv - pv) * (sv - pv);
      if (d < f1) { f2 = f1; c2 = c1; f1 = d; c1 = cu * 131 + cv; }
      else if (d < f2) { f2 = d; c2 = cu * 131 + cv; }
    }
  }
  if (Math.sqrt(f2) - Math.sqrt(f1) > 0.11) return false;
  // a border is a crack when either plate beside it is a cracked one
  return hash(c1, seed, 5) < amount * 0.55 || hash(c2, seed, 5) < amount * 0.25;
}

/** Lattice hash in [0, 1) (set by `dragon(kit)` to the kit's `hash2`: fixed seeds). */
let hash = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) => {
  void x; void y; void s;
  return 0.5;
};

/** @param {Tri} t @param {'down'|'up'|'side'} view @param {number} G */
function rasterTri(t, view, G) {
  const A = project(view, t.a, G);
  const B = project(view, t.b, G);
  const C = project(view, t.c, G);
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
  const x1 = Math.min(FW - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
  const y1 = Math.min(FH - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
  const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  if (Math.abs(den) < 1e-6) return;
  // the face's normal (two-sided: toward the viewer)
  let n = norm3(cross(sub(B, A), sub(C, A)));
  if (n[2] < 0) n = mul(n, -1);
  const l = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
      const w1 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
      const vz = w0 * A[2] + w1 * B[2] + w2 * C[2] - (t.tex === 'glow' ? 2 : 0);
      const i = y * FW + x;
      if (vz <= ZB[i]) continue;
      let mat;
      let tone;
      let kind;
      if (t.tex === 'membrane') {
        // the skin is thin: the low sun behind the dragon shines through it (warm, lighter in the
        // middle of each panel than at the bones)
        mat = MATS.membrane;
        kind = KIND.membrane;
        tone = 1.75 + 0.8 * l + t.lift;
        if (t.edge) {
          // a fan panel: light glows through its thin middle, the finger bones' edges and the
          // root stay dark, a dark hem runs along the trailing edge, veins fan from the wrist
          const mid = Math.min(w1, w2) * 2;
          tone += 1.1 * Math.min(1, mid * 1.6) * (1 - 0.6 * w0) - 0.25 * w0;
          if (w0 < 0.07) tone -= 0.9;
          else if (((w1 / (w1 + w2 + 1e-6)) * 5 + 0.5) % 1 < 0.1 && w0 > 0.2) tone -= 0.5;
        } else tone += 0.15;
        // mottled skin
        tone += (hash(x >> 1, y >> 1, 77) - 0.5) * 0.35;
      } else if (t.tex === 'glow') {
        mat = MATS.glow;
        kind = KIND.glow;
        tone = 1 + 2.6 * w0;
      } else {
        mat = MATS.horn;
        kind = KIND.horn;
        tone = 1.1 + 1.4 * l + t.lift + 2.2 * Math.max(0, 0.55 - w0);
      }
      ZB[i] = vz;
      MAT[i] = mat;
      TONE[i] = tone;
      PRT[i] = t.part;
      NXB[i] = n[0];
      NYB[i] = n[1];
      KND[i] = kind;
    }
  }
}

/**
 * Decals over the raster: eyes (glowing slits under a dark brow), nostrils, teeth.
 * @param {Rig} R @param {'down'|'up'|'side'} view @param {number} G @param {Required<PoseParams>} P
 */
function decals(R, view, G, P) {
  const sn = R.snout ? project(view, R.snout, G) : null;
  for (const d of R.decals) {
    const q = project(view, d.p, G);
    const x = Math.floor(q[0]);
    const y = Math.floor(q[1]);
    if (x < 2 || y < 1 || x >= FW - 3 || y >= FH - 2) continue;
    const i = y * FW + x;
    // visible: the head's surface there is not much nearer than the decal point (a point a little
    // inside the head's tubes shows; the far eye of a profile, a head's width behind, does not)
    if (PRT[i] !== d.part || ZB[i] - q[2] > 7) continue;
    if (d.kind === 'nostril') {
      // a flared nostril, an ember inside
      set(x, y, MATS.dark, 0); set(x + 1, y, MATS.dark, 0); set(x, y + 1, MATS.glow, 1);
      continue;
    }
    // the eye under its brow: a slit slanting down toward the snout (a glower), burning
    const s = sn && Math.abs(sn[0] - q[0]) > 0.5 ? Math.sign(sn[0] - q[0]) : 1;
    const lid = P.eye;
    for (const k of [-2, -1, 0, 1, 2]) set(x + k, y - 1, MATS.dark, 0);
    set(x - 2 * s, y - 1, MATS.dark, 0);
    if (lid === 'shut') {
      for (const k of [-1, 0, 1]) set(x + k, y, MATS.dark, 0);
      set(x + 2 * s, y + 1, MATS.dark, 0);
      continue;
    }
    set(x - s, y, MATS.glow, 3); set(x, y, MATS.glow, 4); set(x + s, y, MATS.glow, 4); set(x + 2 * s, y + 1, MATS.glow, 3);
    set(x - 2 * s, y, MATS.dark, 0);
    if (lid === 'wide') { set(x, y + 1, MATS.glow, 3); set(x + s, y + 1, MATS.glow, 3); set(x - s, y + 1, MATS.glow, 2); }
    else if (lid === 'open') set(x + s, y + 1, MATS.glow, 2);
  }
  for (const row of R.teeth) {
    const a = project(view, row.a, G);
    const b = project(view, row.b, G);
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.4));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(a[0] + (b[0] - a[0]) * (k / n));
      const y = Math.floor(a[1] + (b[1] - a[1]) * (k / n));
      if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
      const i = y * FW + x;
      if (!MAT[i] || (PRT[i] !== PART.maw && PRT[i] !== row.part)) continue;
      set(x, y, MATS.bone, k % 2 ? 3 : 4);
    }
  }
}

/** A decal's pixel (the light pass leaves it as it is). @param {number} x @param {number} y @param {number} m @param {number} tone */
function set(x, y, m, tone) {
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const i = y * FW + x;
  if (!MAT[i]) return;
  MAT[i] = m;
  TONE[i] = tone;
  KND[i] = m === MATS.glow ? KIND.glow : KIND.none;
}

/**
 * Inner lines: a pixel next to a nearer pixel of another part goes dark (the line the far part
 * shows along the near part's edge).
 */
function innerLines() {
  DARK.fill(0);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      if (!MAT[i] || MAT[i] === MATS.glow) continue;
      const z = ZB[i];
      const p = PRT[i];
      if ((x > 0 && near(i - 1, p, z)) || (x < FW - 1 && near(i + 1, p, z)) || (y > 0 && near(i - FW, p, z)) || (y < FH - 1 && near(i + FW, p, z))) DARK[i] = 1;
    }
  }
  for (let i = 0; i < NPX; i++) if (DARK[i]) TONE[i] = Math.min(TONE[i], MAT[i] === MATS.membrane ? 0.4 : 0);
}

/** @param {number} j @param {number} p @param {number} z */
function near(j, p, z) {
  return MAT[j] !== 0 && PRT[j] !== p && ZB[j] - z > LINE_DEPTH;
}

/** The low golden-hour sun behind the dragon's left, on screen (x right, y down): up and left. */
const RIM = norm3([-0.6, -0.8, 0]);

/**
 * The lair's light over the shaded frame (after the inner lines):
 * - the lava's **bounce** from below: the body's and the belly's pixels facing down take the hot
 *   ramp, the more the more they face down (the chest's underside, the belly plates, the jaw's
 *   underside, the limbs' inner sides);
 * - the golden **rim**: a pixel whose normal faces the sun (up-left on screen) and whose neighbour
 *   toward it is empty or much farther (the silhouette, a nearer part's edge over a farther one)
 *   takes the rim ramp, and the pixel inside it a softer rim tone — on the body, the horns and the
 *   wing bones; on the membrane the rim is the skin lit through.
 * Inner lines, glow texels and decals stay as they are.
 */
function light() {
  for (let i = 0; i < NPX; i++) {
    const k = KND[i];
    if ((k !== KIND.body && k !== KIND.belly) || DARK[i]) continue;
    const ny = NYB[i];
    if (ny <= 0.4) continue;
    const t = Math.min(1, (ny - 0.4) / 0.55);
    MAT[i] = MATS.hot;
    TONE[i] = 0.3 + 1.9 * t + (k === KIND.belly ? 0.6 : 0);
  }
  RIMB.fill(0);
  for (let y = 1; y < FH; y++) {
    for (let x = 1; x < FW; x++) {
      const i = y * FW + x;
      const k = KND[i];
      if (k === KIND.none || k === KIND.glow || DARK[i]) continue;
      if (NXB[i] * RIM[0] + NYB[i] * RIM[1] < 0.2) continue;
      // (an edge against the empty frame or a farther part of another group: within one group —
      // the head's own tubes — no rim)
      const z = ZB[i] - LINE_DEPTH;
      const p = PRT[i];
      const l = i - 1;
      const u = i - FW;
      const ul = i - FW - 1;
      if (!MAT[l] || !MAT[u] || !MAT[ul] || (ZB[l] < z && PRT[l] !== p) || (ZB[u] < z && PRT[u] !== p) || (ZB[ul] < z && PRT[ul] !== p)) RIMB[i] = 1;
    }
  }
  for (let y = 1; y < FH; y++) {
    for (let x = 1; x < FW; x++) {
      const i = y * FW + x;
      if (RIMB[i] || !MAT[i] || DARK[i] || KND[i] === KIND.none || KND[i] === KIND.glow) continue;
      if (NXB[i] * RIM[0] + NYB[i] * RIM[1] < 0.45) continue;
      const p = PRT[i];
      if ((RIMB[i - 1] === 1 && PRT[i - 1] === p) || (RIMB[i - FW] === 1 && PRT[i - FW] === p)) RIMB[i] = 2;
    }
  }
  for (let i = 0; i < NPX; i++) {
    const r = RIMB[i];
    if (!r) continue;
    const d = NXB[i] * RIM[0] + NYB[i] * RIM[1];
    if (KND[i] === KIND.membrane) {
      TONE[i] = Math.max(TONE[i], r === 1 ? 4 : 3);
      continue;
    }
    MAT[i] = MATS.rim;
    TONE[i] = r === 1 ? (d > 0.6 ? 4 : 3) : 2;
  }
}

// =================================================================================================
// poses
// =================================================================================================

/** @type {Record<string, PoseParams>} */
const POSES = {};
{
  /** The front view's planted stance: the forefeet wide under the bowed elbows, crouched. */
  /** @type {PoseParams} */
  const WIDE = { fn: [26, 0, 24], ff: [26, 0, -24], hn: [-16, 0, 30], hf: [-16, 0, -30], by: 47 };

  // ---- idle: breathing (the chest swells, the head rises a little, the tail tip stirs); from the
  // front the head low and glowering, the wings folded behind the shoulders ----
  [0, 0.5, 1, 0.5].forEach((b, i) => {
    POSES[`idle${i}`] = {
      breathe: b, by: 56 + b * 1.2, head: [56 - b * 0.8, 114 + b * 2.5, -0.1 + b * 0.05, 0.05 + b * 0.05],
      tail: [-0.45, 0.75 + [0, 0.04, 0.08, 0.04][i], 1.9 + [0, 0.05, 0.1, 0.05][i]],
      wn: [60 + b * 3, 1, 0], wf: [66 + b * 3, 1, 0],
      front: {
        // (the folded wings lie back over the shoulders: humps either side behind the head)
        ...WIDE, by: 47 + b, wn: [38 + b * 2, 1, -20, 0], wf: [38 + b * 2, 1, -20, 0], head: [62 - b, 100 + b * 2.5, 0.12 + b * 0.03, 0.06 + b * 0.05],
        tail: [FRONT_TAIL[0], FRONT_TAIL[1] + [0, 0.03, 0.06, 0.03][i], FRONT_TAIL[2] + [0, 0.04, 0.08, 0.04][i], FRONT_TAIL[3]],
      },
    };
  });

  // ---- walk: a heavy diagonal gait (near fore with far hind), the body dipping on each step ----
  for (let k = 0; k < 6; k++) {
    const ph = (k / 6) * Math.PI * 2;
    /** @type {(off: number) => [number, number]} stride offset and lift of a foot */
    const foot = (off) => [9 * Math.cos(ph + off), Math.max(0, Math.sin(ph + off)) * 8];
    const [fnx, fny] = foot(0);
    const [ffx, ffy] = foot(Math.PI);
    const [hnx, hny] = foot(Math.PI + 0.5);
    const [hfx, hfy] = foot(0.5);
    const dip = Math.cos(ph * 2);
    POSES[`walk${k}`] = {
      by: 55 + dip * 1.6, pitch: 0.1 + 0.03 * Math.sin(ph), head: [57 + 2 * Math.sin(ph), 112 - dip * 2, -0.1, 0.06],
      fn: [26 + fnx, fny, 14], ff: [16 + ffx, ffy, -14], hn: [-20 + hnx, hny, 13], hf: [-32 + hfx, hfy, -13],
      tail: [-0.45, 0.75, 1.9 + 0.25 * Math.sin(ph)],
      wn: [60 + 4 * dip, 1, 0], wf: [66 + 4 * dip, 1, 0],
    };
  }

  // ---- hover: a full wing-beat, the legs hanging (the brain lifts the sprite) ----
  /** beat (deg), fold, body height */
  const BEAT = [[78, 0.45, 52], [55, 0.1, 50], [18, 0, 51], [-22, 0.05, 54], [-5, 0.35, 55], [40, 0.5, 53]];
  BEAT.forEach(([bt, fd, by], k) => {
    POSES[`hover${k}`] = {
      by, pitch: 0.2, head: [56, by + 56, 0.0, 0.1],
      fn: [26, 24, 13], ff: [20, 22, -13], hn: [-14, 12, 12], hf: [-24, 14, -12],
      tail: [-0.85, 0.9, 0.8 + 0.2 * Math.sin(k)],
      wn: [bt, fd, 0], wf: [bt + 4, fd, 0],
      front: {
        head: [62, by + 44, 0.08, 0.1], wn: [bt, fd, 0, 50], wf: [bt, fd, 0, 50],
        fn: [22, 24, 20], ff: [22, 24, -20], hn: [-16, 12, 18], hf: [-16, 12, -18], headScale: 1.3, bulk: 1.18, splay: 0.9,
      },
    };
  });

  // ---- land: flared and reaching → touchdown → the impact crouch → rising ----
  POSES.land0 = {
    by: 66, pitch: 0.5, head: [44, 134, 0.25, 0.2], eye: 'wide',
    fn: [36, 28, 14], ff: [30, 26, -14], hn: [-2, 10, 13], hf: [-10, 12, -13],
    tail: [-1.0, 0.7, 0.5], wn: [62, 0, -15], wf: [66, 0, -15],
  };
  POSES.land1 = {
    by: 58, pitch: 0.32, head: [50, 124, 0.1, 0.2],
    fn: [34, 14, 14], ff: [28, 12, -14], hn: [-14, 0, 14], hf: [-26, 0, -14],
    tail: [-0.8, 0.7, 1.0], wn: [18, 0, -5], wf: [22, 0, -5],
  };
  POSES.land2 = {
    by: 44, pitch: 0.02, head: [62, 88, -0.3, 0.3], eye: 'narrow',
    fn: [32, 0, 18], ff: [22, 0, -18], hn: [-18, 0, 17], hf: [-30, 0, -17],
    tail: [-0.3, 0.5, 2.1], wn: [-12, 0.2, 0], wf: [-8, 0.2, 0],
  };
  POSES.land3 = {
    by: 54, pitch: 0.1, head: [56, 110, -0.05, 0.1],
    tail: [-0.45, 0.75, 1.9], wn: [50, 0.6, 0], wf: [54, 0.6, 0],
  };

  // ---- roar: rearing back, then the head thrust up and out, jaws wide ----
  POSES.roar0 = {
    by: 60, pitch: 0.3, head: [42, 128, 0.42, 0.18], eye: 'narrow', breathe: 1,
    fn: [28, 6, 14], tail: [-0.4, 0.9, 1.6], wn: [55, 0.45, 0], wf: [58, 0.45, 0],
    front: { ...WIDE, head: [54, 118, 0.05, 0.18], wn: [62, 0.3, 0, 50], wf: [62, 0.3, 0, 50], fn: [26, 4, 20] },
  };
  POSES.roar1 = {
    by: 59, pitch: 0.22, head: [58, 126, 0.32, 0.8], eye: 'wide', breathe: 0.6,
    tail: [-0.3, 1.0, 1.4], wn: [42, 0.05, 0], wf: [46, 0.05, 0],
    front: { ...WIDE, head: [66, 112, -0.05, 0.8], wn: [44, 0, 0, 65], wf: [44, 0, 0, 65] },
  };
  POSES.roar2 = {
    by: 58, pitch: 0.2, head: [61, 122, 0.18, 0.7], eye: 'wide', breathe: 0.4,
    tail: [-0.35, 0.95, 1.5], wn: [34, 0.1, 0], wf: [38, 0.1, 0],
    front: { ...WIDE, head: [66, 110, -0.1, 0.7], wn: [36, 0.05, 0, 65], wf: [36, 0.05, 0, 65] },
  };

  // ---- bite: the head drawn back, the lunge down and forward, the recovery ----
  POSES.bite0 = {
    by: 58, pitch: 0.18, head: [42, 122, 0.18, 0.5], eye: 'narrow', neckBend: 12,
    wn: [62, 0.85, 0], wf: [66, 0.85, 0],
    front: { ...WIDE, head: [54, 112, 0.0, 0.5], wn: [52, 0.3, 0, 50], wf: [52, 0.3, 0, 50] },
  };
  POSES.bite1 = {
    by: 52, pitch: -0.04, head: [72, 80, -0.38, 0.1], eye: 'wide', neckBend: 2,
    fn: [34, 0, 15], ff: [22, 0, -15], tail: [-0.35, 0.7, 2.0], wn: [55, 0.9, 0], wf: [60, 0.9, 0],
    front: { ...WIDE, head: [74, 76, -0.55, 0.1], wn: [44, 0.3, 0, 50], wf: [44, 0.3, 0, 50], fn: [30, 0, 20], ff: [30, 0, -20] },
  };
  POSES.bite2 = {
    by: 54, pitch: 0.04, head: [66, 98, -0.22, 0.05], neckBend: 6,
    fn: [30, 0, 14], wn: [58, 1, 0], wf: [63, 1, 0],
    front: { ...WIDE, head: [68, 96, -0.1, 0.05], wn: [48, 0.3, 0, 50], wf: [48, 0.3, 0, 50] },
  };

  // ---- claw: the near foreleg raised high, the swipe, the follow-through ----
  POSES.claw0 = {
    by: 60, pitch: 0.3, head: [48, 120, 0.05, 0.3], eye: 'narrow',
    fn: [30, 36, 16], ff: [18, 0, -14], tail: [-0.4, 0.8, 1.5], wn: [58, 0.6, 0], wf: [62, 0.6, 0],
  };
  POSES.claw1 = {
    by: 52, pitch: 0.0, head: [62, 104, -0.18, 0.35], eye: 'wide',
    fn: [48, 4, 9], ff: [20, 0, -15], tail: [-0.4, 0.7, 2.2], wn: [52, 0.6, 0], wf: [56, 0.6, 0],
  };
  POSES.claw2 = {
    by: 53, pitch: 0.04, head: [58, 108, -0.12, 0.12],
    fn: [38, 0, 6], ff: [18, 0, -14], tail: [-0.45, 0.75, 2.0], wn: [58, 0.85, 0], wf: [62, 0.85, 0],
  };

  // ---- tail sweep: the tail cocked away, swung round low on the near side, through, back ----
  POSES.tail0 = {
    by: 54, pitch: 0.06, head: [52, 108, -0.05, 0.2], headZ: 6, eye: 'narrow',
    tail: [-0.15, 0.4, -1.3], hn: [-16, 0, 15], hf: [-30, 0, -11], wn: [55, 0.7, 0], wf: [60, 0.7, 0],
    // (from the front: wound round the far side)
    front: { tail: [-0.85, 1.0, -2.6, 0.75] },
  };
  POSES.tail1 = {
    by: 50, pitch: 0.0, head: [56, 104, -0.1, 0.25], headZ: 10,
    tail: [-0.55, 0.25, 2.5], hn: [-14, 0, 17], hf: [-34, 0, -9], wn: [45, 0.6, 0], wf: [50, 0.6, 0],
    // (from the front: swung low round the near side…)
    front: { tail: [-0.9, 0.95, 2.4, 0.7] },
  };
  POSES.tail2 = {
    by: 50, pitch: 0.0, head: [56, 104, -0.12, 0.2], headZ: 8,
    tail: [-0.6, 0.2, 3.1], hn: [-16, 0, 16], hf: [-32, 0, -10], wn: [45, 0.6, 0], wf: [50, 0.6, 0],
    // (… and on round toward the camera)
    front: { tail: [-0.9, 0.95, 3.5, 0.7] },
  };
  POSES.tail3 = {
    by: 53, pitch: 0.06, head: [56, 110, -0.1, 0.08], headZ: 3,
    tail: [-0.5, 0.6, 2.4], wn: [55, 0.85, 0], wf: [60, 0.85, 0],
  };

  // ---- breath: the inhale (the furnace kindles), the aim, two frames of the gout ----
  POSES.breath0 = {
    by: 60, pitch: 0.24, head: [44, 126, 0.38, 0.12], eye: 'narrow', breathe: 1, furnace: 0.6,
    tail: [-0.4, 0.9, 1.6], wn: [50, 0.5, 0], wf: [54, 0.5, 0],
    front: { ...WIDE, head: [56, 118, 0.1, 0.12], wn: [56, 0.3, 0, 45], wf: [56, 0.3, 0, 45] },
  };
  POSES.breath1 = {
    by: 56, pitch: 0.1, head: [66, 104, -0.2, 0.55], eye: 'wide', breathe: 0.5, furnace: 1,
    fn: [32, 0, 16], tail: [-0.4, 0.8, 1.9], wn: [44, 0.4, 0], wf: [48, 0.4, 0],
    front: { ...WIDE, head: [68, 100, -0.2, 0.6], wn: [46, 0.2, 0, 55], wf: [46, 0.2, 0, 55], fn: [28, 0, 26], ff: [28, 0, -26] },
  };
  POSES.breath2 = {
    by: 54, pitch: 0.06, head: [70, 98, -0.3, 0.72], eye: 'wide', furnace: 1,
    fn: [34, 0, 17], ff: [24, 0, -16], tail: [-0.45, 0.7, 2.0], wn: [40, 0.35, 0], wf: [44, 0.35, 0],
    front: { ...WIDE, head: [70, 96, -0.22, 0.8], wn: [42, 0.15, 0, 60], wf: [42, 0.15, 0, 60], fn: [30, 0, 26], ff: [30, 0, -26] },
  };
  POSES.breath3 = {
    by: 54.5, pitch: 0.07, head: [69, 99, -0.27, 0.66], eye: 'wide', furnace: 0.9,
    fn: [34, 0, 17], ff: [24, 0, -16], tail: [-0.45, 0.72, 2.05], wn: [41, 0.35, 0], wf: [45, 0.35, 0],
    front: { ...WIDE, head: [69, 97, -0.2, 0.74], wn: [43, 0.15, 0, 60], wf: [43, 0.15, 0, 60], fn: [30, 0, 26], ff: [30, 0, -26] },
  };

  // ---- take-off: the crouch under raised wings, the leap on the downbeat, the climb ----
  POSES.takeoff0 = {
    by: 45, pitch: 0.15, head: [58, 98, 0.1, 0.12], eye: 'narrow',
    fn: [30, 0, 16], ff: [22, 0, -16], hn: [-18, 0, 15], hf: [-30, 0, -15],
    tail: [-0.3, 0.6, 1.7], wn: [74, 0.2, -10], wf: [78, 0.2, -10],
  };
  POSES.takeoff1 = {
    by: 64, pitch: 0.32, head: [52, 124, 0.25, 0.25], eye: 'wide',
    fn: [32, 18, 14], ff: [26, 16, -14], hn: [-22, 0, 13], hf: [-32, 2, -13],
    tail: [-0.9, 0.6, 1.0], wn: [-22, 0, 0], wf: [-18, 0, 0],
  };
  POSES.takeoff2 = {
    by: 62, pitch: 0.38, head: [50, 124, 0.25, 0.15],
    fn: [24, 26, 12], ff: [20, 24, -12], hn: [-12, 16, 12], hf: [-22, 18, -12],
    tail: [-1.0, 0.8, 0.6], wn: [56, 0.3, 0], wf: [60, 0.3, 0],
  };

  // ---- dive: wings swept back, plunging; then the claws thrown forward ----
  POSES.dive0 = {
    by: 70, pitch: -0.45, head: [58, 64, -0.65, 0.3], eye: 'wide', neckBend: 4,
    fn: [10, 34, 12], ff: [6, 36, -12], hn: [-34, 52, 12], hf: [-40, 54, -12],
    tail: [0.2, 0.2, 0.3], wn: [32, 0.55, -35], wf: [36, 0.55, -35],
  };
  POSES.dive1 = {
    by: 64, pitch: -0.22, head: [62, 82, -0.45, 0.55], eye: 'wide', neckBend: 5,
    fn: [44, 20, 13], ff: [40, 18, -13], hn: [-20, 28, 12], hf: [-28, 30, -12],
    tail: [-0.2, 0.4, 0.6], wn: [44, 0.15, -15], wf: [48, 0.15, -15],
  };

  // ---- hurt: the flinch ----
  POSES.hurt = {
    by: 58, pitch: 0.16, head: [46, 120, 0.32, 0.35], eye: 'shut', lean: -0.06,
    fn: [28, 4, 14], tail: [-0.3, 0.9, 1.5], wn: [52, 0.6, 0], wf: [56, 0.6, 0],
    front: { ...WIDE, head: [54, 114, 0.1, 0.35], wn: [58, 0.4, 0, 45], wf: [58, 0.4, 0, 45] },
  };

  // ---- stagger: crashed down, stunned — slumped, wings sprawled, the head on the ground ----
  POSES.stagger0 = {
    by: 34, pitch: -0.06, head: [56, 22, -0.22, 0.22], eye: 'shut', lean: 0.12, neckBend: -2,
    fn: [36, 0, 24], ff: [24, 0, -22], hn: [-14, 0, 22], hf: [-30, 0, -20],
    tail: [-0.2, 0.3, 2.2], wn: [-24, 0.25, 0], wf: [-12, 0.3, 0],
  };
  POSES.stagger1 = {
    by: 35, pitch: -0.04, head: [55, 30, -0.1, 0.3], eye: 'narrow', lean: 0.1, neckBend: -1,
    fn: [36, 0, 24], ff: [24, 0, -22], hn: [-14, 0, 22], hf: [-30, 0, -20],
    tail: [-0.2, 0.32, 2.3], wn: [-20, 0.25, 0], wf: [-10, 0.3, 0],
  };

  // ---- death: the throes, the sway, the collapse, down, the heap ----
  POSES.death0 = {
    by: 64, pitch: 0.48, head: [34, 132, 0.85, 0.65], eye: 'wide', breathe: 1,
    fn: [32, 10, 14], ff: [26, 6, -14], hn: [-12, 0, 13], hf: [-24, 0, -13],
    tail: [-0.2, 1.1, 1.4], wn: [70, 0.1, 0], wf: [74, 0.1, 0],
    // (from the front: braced wide, the head thrown back and the maw to the sky)
    front: { ...WIDE, by: 54, head: [44, 128, 0.75, 0.65] },
  };
  POSES.death1 = {
    by: 56, pitch: 0.24, head: [50, 110, 0.15, 0.5], eye: 'narrow', lean: 0.1,
    tail: [-0.4, 0.8, 1.7], wn: [24, 0.4, 0], wf: [30, 0.4, 0],
    front: { ...WIDE, by: 50, head: [56, 106, 0.3, 0.5] },
  };
  POSES.death2 = {
    by: 40, pitch: 0.02, head: [58, 58, -0.3, 0.4], eye: 'narrow', lean: 0.26,
    fn: [34, 0, 22], ff: [22, 0, -18], hn: [-16, 0, 20], hf: [-28, 0, -16],
    tail: [-0.3, 0.5, 2.0], wn: [-8, 0.4, 0], wf: [4, 0.4, 0],
  };
  POSES.death3 = {
    by: 28, pitch: -0.04, head: [57, 20, -0.18, 0.3], eye: 'shut', lean: 0.48, neckBend: -2,
    fn: [36, 4, 30], ff: [26, 8, -10], hn: [-12, 4, 28], hf: [-28, 8, -8],
    tail: [-0.15, 0.25, 2.3], wn: [-34, 0.3, 0], wf: [-6, 0.5, 0],
  };
  POSES.death4 = {
    by: 24, pitch: -0.05, head: [58, 16, -0.12, 0.26], eye: 'shut', lean: 0.58, neckBend: -3,
    fn: [38, 6, 32], ff: [28, 12, -6], hn: [-10, 6, 30], hf: [-26, 12, -4],
    tail: [-0.1, 0.2, 2.35], wn: [-42, 0.3, 0], wf: [-4, 0.5, 0],
  };

  // ---- gust: the wings raised and swept back, then beaten forward and down ----
  POSES.gust0 = {
    by: 62, pitch: 0.34, head: [50, 122, 0.2, 0.2], eye: 'narrow',
    fn: [30, 4, 14], tail: [-0.4, 0.9, 1.5], wn: [72, 0, -25], wf: [76, 0, -25],
  };
  POSES.gust1 = {
    by: 57, pitch: 0.16, head: [60, 112, 0.0, 0.35], eye: 'wide',
    tail: [-0.4, 0.8, 1.8], wn: [6, 0, 35], wf: [10, 0, 35],
  };

  // ---- stomp: reared up on the hind legs, then down on the forefeet ----
  POSES.stomp0 = {
    by: 70, pitch: 0.72, head: [38, 136, 0.35, 0.35], eye: 'wide',
    fn: [36, 40, 14], ff: [30, 36, -14], hn: [-18, 0, 14], hf: [-28, 0, -14],
    tail: [-0.8, 0.8, 1.3], wn: [58, 0.5, 0], wf: [62, 0.5, 0],
  };
  POSES.stomp1 = {
    by: 50, pitch: -0.05, head: [62, 92, -0.3, 0.42], eye: 'wide',
    fn: [36, 0, 17], ff: [30, 0, -17], hn: [-20, 0, 14], hf: [-32, 0, -14],
    tail: [-0.3, 0.6, 2.1], wn: [22, 0.3, 0], wf: [26, 0.3, 0],
  };
}

/**
 * The full parameters of a pose in a view (BASE, the pose's, the view's overrides).
 * @param {string} key @param {'down'|'up'|'side'} view
 * @returns {Required<PoseParams>}
 */
function poseOf(key, view) {
  const own = POSES[key] ?? {};
  const P = /** @type {Required<PoseParams>} */ ({ ...BASE, ...own });
  if (view !== 'down') return P;
  // the front view: the feet half as far apart again (a dragon seen from the front sprawls), then
  // the front look and the pose's own front overrides
  for (const k of /** @type {const} */ (['fn', 'ff', 'hn', 'hf'])) P[k] = [P[k][0], P[k][1], P[k][2] * 1.5];
  // the tail curls round from behind into view on the near side, lying on the ground (a pose
  // whose tail moves, the sweep, gives its own); spread wings turn their membranes toward the
  // camera (seen along the body they were edges)
  P.tail = FRONT_TAIL;
  // the head tipped up toward the camera (the camera looks down 28°: a head held level would show
  // its snout as a column down the face; turned toward the camera the muzzle foreshortens and the
  // face reads) — a pose's own front head wins
  P.head = [P.head[0], P.head[1], P.head[2] + 0.24, P.head[3]];
  for (const k of /** @type {const} */ (['wn', 'wf'])) {
    const w = P[k];
    if (w[3] === undefined) P[k] = [w[0], w[1], w[2], 50 * (1 - w[1])];
  }
  return /** @type {Required<PoseParams>} */ ({ ...P, ...FRONT_LOOK, ...(own.front ?? {}) });
}

// =================================================================================================
// the kind
// =================================================================================================

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function dragon(K) {
  const { M } = K;
  hash = (x, y, s) => K.hash2(x, y, s);
  // (the kit's spare ids carry the dragon's own ramps: the horn, the golden rim, the lava's
  // bounce, the crimson scales)
  MATS = {
    scales: M.FUR, dark: M.FUR2, belly: M.FUR3, membrane: M.WING, bone: M.BONE, glow: M.GLOW,
    horn: M.BEAK, rim: M.GOLD, hot: M.ACCENT, crimson: M.COMB,
  };
  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    const P = poseOf(key, view);
    const R = build(P);
    rasterise(R, view, f.G);
    decals(R, view, f.G, P);
    innerLines();
    light();
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const i = y * FW + x;
        const m = MAT[i];
        if (!m) continue;
        const t = Math.round(TONE[i]);
        p.set(x, y, m, t < 0 ? 0 : t > 4 ? 4 : t);
      }
    }
  }
  return {
    fw: FW, fh: FH, columns: DRAGON_COLUMNS,
    // the Enemy's own poses (kneel: before the first update; dead: Enemy.die) and the locomotion
    aliases: { kneel: 'idle0', dead: 'death4', move0: 'walk0', move1: 'walk1', move2: 'walk3', move3: 'walk4' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([7, 3]) },
    draw,
    idle: { poses: ['idle0', 'idle1', 'idle2', 'idle3'], fps: 3 },
    layout: {
      perRow: 21,
      strips: [{ dir: 'left' }, { dir: 'right' }, { dir: 'down', poses: DRAGON_FRONT }],
    },
    ramps: () => K.makeRamps({
      // ash-black scales, a cold violet in the shade warming to a dark garnet toward the light
      [M.FUR]: K.ramp5(['#0c080d', '#1a121a', '#2e2028', '#4a3034', '#6e4844']),
      [M.FUR2]: K.ramp5(['#060408', '#100b11', '#1d141b', '#30212a', '#4a3238']),
      // the lit scales' crowns: crimson
      [M.COMB]: K.ramp5(['#2a0a10', '#4c1018', '#761a1e', '#a42a26', '#d24a36']),
      // ember-bronze belly plates
      [M.FUR3]: K.ramp5(['#22140f', '#432718', '#6a3d24', '#955733', '#bd814b']),
      // the lava's bounce on whatever faces down
      [M.ACCENT]: K.ramp5(['#2c0e08', '#5a1a0c', '#902c12', '#c84c1c', '#f4823a']),
      // the golden-hour rim
      [M.GOLD]: K.ramp5(['#3a2410', '#6c4418', '#a6702a', '#dca448', '#ffde8c']),
      // the membrane: ember crimson, the low sun shining through it
      [M.WING]: K.ramp5(['#1e0709', '#440f0e', '#721c12', '#a6321a', '#de642c']),
      // claws and teeth: charred root → old ivory
      [M.BONE]: K.ramp5(['#1a1416', '#3b3030', '#6b5c4e', '#a39276', '#d9cca9']),
      // horns and spikes: charred black, the tip worn pale
      [M.BEAK]: K.ramp5(['#0b0709', '#191113', '#2c2022', '#5c4a40', '#cdbb96']),
      [M.GLOW]: K.glowRamp(['#5a1204', '#b2340a', '#f0701a', '#ffb648', '#fff0b0']),
    }, M.FUR),
  };
}
