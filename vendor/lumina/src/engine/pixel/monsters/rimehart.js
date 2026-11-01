/**
 * Rimehart, the Stag of the Waking Wood — the first guardian of The Bells of Evermere
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): a great frost stag, a forest spirit the Hush
 * froze. ≈ 4 u at the withers, the head ≈ 5.4 u, a crown of antlers to ≈ 7.3 u, in 128 × 128 frames
 * (8 × 8 u). Owner: the guardians package.
 *
 * **A parametric rig, rasterised** (the dragon's method, src/engine/pixel/monsters/dragon.js): every
 * frame is one 3D skeleton in a pose — a torso of three tapered tubes (the deep chest, the barrel,
 * the haunch) under a withers hump, a neck turned by an angle and a yaw, a head (skull, long muzzle
 * with a dark tip, a hinged jaw, ears) carrying two antler beams with a brow, a bez and a trez tine
 * and a crown of three points each, four legs posed by two-bone IK (the elbow bends back, the stifle
 * forward) above a cannon and a dark hoof, a white flag of a tail and a shaggy ruff of rime down the
 * throat and chest. `draw` builds the rig for the pose (`poseOf`), projects it orthographically —
 * the side view from ≈ 16° above, the front and back views from ≈ 25° above (the diorama camera
 * looks down on a stag facing it) — and rasterises it into a z-buffer with view-space normals: the
 * 5-tone ramps by the light from the upper left; the coat a frost-blue hatch of short fur strokes
 * laid out in each tube's own surface coordinates (they ride with the bones from frame to frame),
 * the undersides a deeper violet-blue, hoar-frost sparkles on the lit planes; the ruff's edge torn
 * into tufts; the antlers dark at the burr and a little paler toward the tips. A far part touching a
 * nearer one gets a dark inner line; a cool rim of the snow's light runs along every edge facing up
 * and left. MonsterSprites adds the silhouette outline. RNG-free: the textures are `hash2` lattices
 * with fixed seeds.
 *
 * **The look by phase and by beat** (the brain picks the cell, src/game/combat/packs/evermere/
 * rimehart.js): the fight in frost-blue and white with dark antlers, a dark muzzle and hooves and
 * pale-cyan eyes (glow texels); `<pose>X` (phase 2) the same with clusters of ice crystals grown on
 * the tines and rime spikes along the withers (glow texels: the brain's `uGlow` lights them);
 * `bow` / `bowX` the fall (kneeling, head bowed), `shell` the kneel in a faceted shell of ice, then the release —
 * `rise0` (the shell cracking), `rise1` (up, the frost sliding off in clumps), `shake0` / `shake1`
 * (shaking it off like a wet dog, flecks of ice flying), `free0–3` (the thawed walk: a warm ivory
 * coat, blossom caught in the antlers, dark gentle eyes — no glow) and `freeIdle` (the head turned
 * back toward the camera: a last look).
 *
 * **Seen from the front** (the party comes from the south: what the player mostly sees) the head is
 * drawn bigger and tipped up toward the camera, the antlers spread a little wider (a crown), the
 * legs a little farther apart (`poseOf`).
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** The fight's poses (phase 1, frost-blue). */
const FIGHT = ['idle0', 'idle1', 'idle2', 'walk0', 'walk1', 'walk2', 'walk3', 'run0', 'run1', 'run2', 'run3',
  'chargeWind0', 'chargeWind1', 'sweepWind', 'sweep', 'rear', 'stomp', 'leapWind', 'leap', 'land', 'bellowWind', 'bellow',
  'stun', 'hurt', 'bow'];
/** The release after the fight: the frost shell, the rise, the shake, the thawed walk. */
const RELEASE = ['shell', 'rise0', 'rise1', 'shake0', 'shake1', 'free0', 'free1', 'free2', 'free3', 'freeIdle'];
/** Phase 2: every fight pose again with ice crystals grown on the antlers (`<pose>X`). */
export const RIMEHART_CRYSTAL = Object.freeze([...FIGHT]);
/**
 * Every pose of the side view (facing left; the right strip mirrors it): the fight's, `bowX`
 * (the fall in phase 2 — in the first row with `idle0`, so the Enemy's own `kneel` (→ idle0) / `dead` (→ bowX) poses
 * show a side cell), the release, then the crystal variants.
 */
export const RIMEHART_COLUMNS = Object.freeze([...FIGHT, 'bowX', ...RELEASE, ...FIGHT.filter((n) => n !== 'bow').map((n) => `${n}X`)]);
const FRONT_FIGHT = ['idle0', 'idle1', 'idle2', 'walk0', 'walk1', 'walk2', 'walk3', 'chargeWind0', 'chargeWind1',
  'bellowWind', 'bellow', 'stun', 'hurt', 'bow', 'rear', 'stomp', 'leapWind', 'land'];
/** The front view (the `down` strip): the poses a stag facing the camera shows. */
export const RIMEHART_FRONT = Object.freeze([...FRONT_FIGHT, ...FRONT_FIGHT.map((n) => `${n}X`), 'shell', 'rise0', 'rise1', 'shake0', 'shake1', 'freeIdle']);
/** The back view (the `up` strip): walking away — in the fight and thawed, out of the glade. */
export const RIMEHART_BACK = Object.freeze(['idle0', 'walk0', 'walk1', 'walk2', 'walk3', 'idle0X', 'walk0X', 'walk1X', 'walk2X', 'walk3X',
  'free0', 'free1', 'free2', 'free3', 'freeIdle']);

/** Frame size (px) and the model origin's column. */
const FW = 128;
const FH = 128;
const CX = 64;
/** The projection's look from above (sin, cos): the side view, the front / back views. */
const TS = 0.28;
const TCS = Math.sqrt(1 - TS * TS);
const TF = 0.42;
const TCF = Math.sqrt(1 - TF * TF);
/** The back view looks down less (the head and the crown, farthest, rise up the frame). */
const TU = 0.18;
const TCU = Math.sqrt(1 - TU * TU);
/** The ground line's lift (px) per view: the nearest hooves, lower on screen seen from above, stay in the frame. */
const LIFT_SIDE = 2;
const LIFT_FRONT = 14;
const LIFT_BACK = 8;
/** The light in view space (x right, y down, z toward the viewer): from the upper left and the front. */
const LIGHT = norm3([-0.55, -0.72, 0.42]);
/**
 * The front view's light: more from the side and above, less from the camera — a stag facing the
 * camera on snow keeps a lit upper-left and a blue shadow side (value contrast on white ground).
 */
const LIGHT_FRONT = norm3([-0.66, -0.7, 0.18]);
/** The snow's cool rim light on screen (x right, y down): from up and left. */
const RIM = [-0.6, -0.8];
/** A far part this much (px) behind a nearer neighbour gets a dark inner line. */
const LINE_DEPTH = 4;
/** The front view's inner lines start nearer (the neck over the chest, the forelegs over the belly). */
const LINE_DEPTH_FRONT = 2;
const DEG = Math.PI / 180;

// =================================================================================================
// small vector maths (model space: x forward — the way the stag faces —, y up, z the near side)
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
/** @param {number[]} a @param {number[]} b */
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** @param {number[]} a @param {number[]} b @param {number} t @returns {V3} */
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Two-bone IK: the joint between `a` and `c` (bone lengths l1, l2), bent toward `bend`.
 * @param {V3} a @param {V3} c @param {number} l1 @param {number} l2 @param {number[]} bend
 * @returns {V3}
 */
function ik(a, c, l1, l2, bend) {
  const ac = sub(c, a);
  let d = Math.hypot(ac[0], ac[1], ac[2]);
  const dir = mul(ac, 1 / (d || 1));
  d = Math.min(d, l1 + l2 - 0.01);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const bp = norm3(sub(bend, mul(dir, dot(bend, dir))));
  return add(add(a, mul(dir, x)), mul(bp, h));
}

// =================================================================================================
// the rig
// =================================================================================================

/**
 * Surfaces: `coat` (the frost coat, or the thawed coat: the pose's `frost` mixes them in clumps),
 * `ruff` (the shaggy rime on the throat and chest; the thawed mane), `tail` (the white flag),
 * `antler`, `muzzle`, `hoof`, `mouth`, `crystal` (glow), `ice` (the shell), `blossom`.
 * @typedef {'coat'|'ruff'|'tail'|'antler'|'muzzle'|'hoof'|'mouth'|'crystal'|'ice'|'blossom'|'inner'} Tex
 */

/**
 * A tapered tube from `a` (radius ra) to `b` (rb) in model space; `u0` / `uLen` its place along its
 * chain (the textures and the antlers' paling run on them), `part` its inner-line group, `lift` a
 * tone offset (the far limbs darker), `seed` its texture's seed, `far` the far limbs' deeper coat.
 * @typedef {{ a: V3, b: V3, ra: number, rb: number, tex: Tex, part: number, u0: number, uLen: number,
 *   lift: number, seed: number, far: boolean }} Tube
 */

/** Inner-line groups. */
const PART = {
  torso: 1, neck: 2, head: 3, jaw: 4, earN: 5, earF: 6, antN: 7, antF: 8, legFN: 9, legFF: 10, legHN: 11, legHF: 12,
  tail: 13, ruff: 14, ice: 15, crystal: 16, blossom: 17, mouth: 18,
};

/**
 * A pose's parameters (`POSES`, `BASE`).
 * @typedef {object} Pose
 * @property {number} dx  the body's shift (px)
 * @property {number} dy
 * @property {number} pitch  the torso's pitch (deg, nose up +)
 * @property {number[]} pivot  the pitch's pivot (torso frame)
 * @property {number} roll  the torso's roll about the spine (deg: the shake)
 * @property {number} chest  the chest's swell (px)
 * @property {number} neck  the neck's angle above the torso's line (deg)
 * @property {number} neckLen
 * @property {number} yaw  the neck and head turned toward the near side (deg)
 * @property {number} head  the muzzle's angle above the horizontal (deg)
 * @property {number} headRoll  the head rolled about the muzzle (deg: the antlers cocked)
 * @property {number} jaw  0 shut … 1 wide
 * @property {number} ears  0 up … 1 drooping … -1 laid back
 * @property {number} tail  the flag raised (0 … 1)
 * @property {any} FN @property {any} FF @property {any} HN @property {any} HF  feet: `{ x, y, f }`
 *   (ground point, lift, the cannon folded forward in deg), `{ rel: [dx, dy], f }` (from the
 *   shoulder / hip, carried with the body) or `{ knee | hock: [x, y], foot: [x, y] }` (folded)
 * @property {boolean} crystals  phase 2's ice
 * @property {number} frost  1 the frost coat … 0 thawed
 * @property {number} shell  0 none, 1 the shell, 2 the shell cracking
 * @property {number} spray  0 none, ±1 flecks of ice flying (the shake's side)
 * @property {number} breath  0, 1, 2 the frost breath's puff
 * @property {'open'|'shut'|'dim'|'warm'} eye
 * @property {number} headScale  @property {number} antlerScale  @property {number} splay
 * @property {number} breadth  the shoulders' and haunches' breadth (the front view broader)
 * @property {number} legBulk  the forelegs' thickness
 */

/** @type {Pose} */
const BASE = {
  dx: 0, dy: 0, pitch: 0, pivot: [0, 52], roll: 0, chest: 0,
  neck: 60, neckLen: 24, yaw: 0, head: -20, headRoll: 0, jaw: 0, ears: 0, tail: 0,
  FN: { x: 28, y: 0 }, FF: { x: 23, y: 0 }, HN: { x: -27, y: 0 }, HF: { x: -32, y: 0 },
  crystals: false, frost: 1, shell: 0, spray: 0, breath: 0, eye: 'open',
  headScale: 1, antlerScale: 1, splay: 1, breadth: 1, legBulk: 1,
};

/** The rig being built for one pose: its tubes and the points the decals use. */
class Rig {
  constructor() {
    /** @type {Tube[]} */
    this.tubes = [];
    /** @type {{ p: V3, kind: 'eye'|'nostril', part: number }[]} */
    this.decals = [];
    /** @type {V3|null} the muzzle's tip (the breath) */
    this.nose = null;
    /** @type {V3} the body's middle (the spray) */
    this.mid = [0, 50, 0];
  }

  /**
   * @param {V3} a @param {number} ra @param {V3} b @param {number} rb @param {Tex} tex @param {number} part
   * @param {{ lift?: number, seed?: number, u0?: number, uLen?: number, far?: boolean }} [o]
   */
  tube(a, ra, b, rb, tex, part, o = {}) {
    const len = dist3(a, b);
    this.tubes.push({ a, b, ra, rb, tex, part, u0: o.u0 ?? 0, uLen: o.uLen ?? len, lift: o.lift ?? 0, seed: o.seed ?? part * 7, far: !!o.far });
  }

  /**
   * A chain of tubes through `pts` (radii per point): the texture's along-coordinate runs on.
   * @param {V3[]} pts @param {number[]} rs @param {Tex} tex @param {number} part
   * @param {{ lift?: number, seed?: number, far?: boolean }} [o]
   */
  chain(pts, rs, tex, part, o = {}) {
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) total += dist3(pts[i], pts[i + 1]);
    let u = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      this.tube(pts[i], rs[i], pts[i + 1], rs[i + 1], tex, part, { ...o, u0: u, uLen: total });
      u += dist3(pts[i], pts[i + 1]);
    }
  }
}

/**
 * The rig of a pose.
 * @param {Pose} P
 * @param {'down'|'up'|'side'} view
 * @returns {Rig}
 */
function build(P, view) {
  const R = new Rig();
  const pc = Math.cos(P.pitch * DEG);
  const ps = Math.sin(P.pitch * DEG);
  const rc = Math.cos(P.roll * DEG);
  const rs = Math.sin(P.roll * DEG);
  const [px, py] = P.pivot;
  /** a point of the torso's frame → model @type {(x: number, y: number, z?: number) => V3} */
  const T = (x, y, z = 0) => {
    const y1 = 52 + (y - 52) * rc - z * rs;
    const z1 = (y - 52) * rs + z * rc;
    const xr = px + (x - px) * pc - (y1 - py) * ps;
    const yr = py + (x - px) * ps + (y1 - py) * pc;
    return [xr + P.dx, yr + P.dy, z1];
  };
  R.mid = T(0, 50);
  const ch = P.chest;

  // ---- torso: the haunch, the barrel, the deep chest, the withers ----
  R.tube(T(-31, 54), 11, T(-15, 53), 12.5, 'coat', PART.torso, { seed: 3 });
  R.tube(T(-14, 52.5), 12.5, T(8, 51.5), 13 + ch * 0.5, 'coat', PART.torso, { seed: 5, u0: 17 });
  R.tube(T(9, 51), 13.5 + ch, T(28, 50), 12.5 + ch, 'coat', PART.torso, { seed: 7, u0: 40 });
  R.tube(T(4, 56), 8, T(22, 55.5), 9.5, 'coat', PART.torso, { seed: 9, u0: 40 });
  // the shoulders' and the haunches' muscle either side (the breadth the front and back views show)
  const br = P.breadth;
  const bk = 1 + (br - 1) * 0.6;
  for (const z of [-7 * br, 7 * br]) {
    R.tube(T(15, 50, z), 9.5 * bk, T(28, 49, z * 0.85), 9 * bk, 'coat', PART.torso, { seed: 43 });
    R.tube(T(-31, 55, z * 0.85), 9.5 * bk, T(-19, 54, z), 9.5 * bk, 'coat', PART.torso, { seed: 47 });
    // (the front view's broad brisket between the shoulders)
    if (br > 1) R.tube(T(22, 47, z * 0.7), 10.5, T(33, 45, z * 0.6), 9, 'coat', PART.torso, { seed: 53 });
  }
  // the rump's top, a little higher than the back
  R.tube(T(-34, 57), 7.5, T(-22, 59), 8, 'coat', PART.torso, { seed: 11 });
  // the flag of a tail
  const tl = P.tail;
  R.tube(T(-38, 59), 3.4, T(-42 - tl * 2, 53 + tl * 9), 2.6, 'tail', PART.tail, { seed: 13 });

  // ---- the neck (turned by `yaw`), the ruff of rime down its throat ----
  const n0 = T(27, 58);
  const na = (P.neck + P.pitch) * DEG;
  const yw = P.yaw * DEG;
  const nd = [Math.cos(na) * Math.cos(yw), Math.sin(na), Math.cos(na) * Math.sin(yw)];
  const H = add(n0, mul(nd, P.neckLen));
  R.tube(n0, 9.5, lerp3(n0, H, 0.45), 7.2, 'coat', PART.neck, { seed: 17 });
  R.tube(lerp3(n0, H, 0.45), 7.2, H, 6, 'coat', PART.neck, { seed: 18, u0: 11 });
  // the throat's ruff: tufts along the neck's underside, the beard of rime on the chest
  const under = norm3(cross(nd, [Math.sin(yw), 0, -Math.cos(yw)]));
  const throat = under[1] > 0 ? mul(under, -1) : under;
  R.tube(add(n0, add(mul(throat, 5), mul(nd, 2))), 7, add(H, mul(throat, 3.5)), 4, 'ruff', PART.ruff, { seed: 19 });
  for (let k = 0; k < 5; k++) {
    const q = add(lerp3(n0, H, 0.12 + k * 0.19), mul(throat, 6.5 - k * 0.6));
    const zs = (k % 2 ? 1 : -1) * (2 + (k % 3));
    R.tube(add(q, [0, 0, zs * 0.5]), 4 - k * 0.3, add(q, [1.5 + k * 0.3, -5.5 + k * 0.4, zs]), 1.3, 'ruff', PART.ruff, { seed: 25 + k });
  }
  R.tube(T(35, 50), 8 + ch * 0.5, T(37, 40), 6, 'ruff', PART.ruff, { seed: 23 });
  for (const [x, z] of [[32, -7], [35, -3], [37, 1], [35, 5], [32, 8]]) R.tube(T(x, 42, z), 3.6, T(x + 2, 32.5 + Math.abs(z) * 0.4, z * 1.25), 1.2, 'ruff', PART.ruff, { seed: 31 + x + z });

  // ---- the head ----
  head(R, P, H, view);

  // ---- legs: the far pair first (darker), the near pair ----
  const sp = P.splay;
  const farLift = view === 'side' ? -0.7 : -0.15;
  foreleg(R, T(25, 46, -6.5 * sp), P.FF, -6.5 * sp, PART.legFF, farLift, view === 'side', P.legBulk);
  hindleg(R, T(-27, 52, -7 * sp), P.HF, -7 * sp, PART.legHF, farLift, view === 'side');
  foreleg(R, T(25, 46, 6.5 * sp), P.FN, 6.5 * sp, PART.legFN, 0, false, P.legBulk);
  hindleg(R, T(-27, 52, 7 * sp), P.HN, 7 * sp, PART.legHN, 0, false);

  // ---- phase 2: rime spikes along the withers and the back ----
  if (P.crystals) {
    for (const [x, y, z, a] of [[19, 64, 1, -0.3], [12, 64.5, -2, -0.45], [5, 64, 2, -0.55]]) {
      const b = T(x, y, z);
      R.tube(b, 1.4, add(b, [a * 5, 5, z * 0.6]), 0.4, 'crystal', PART.crystal);
    }
  }

  // ---- the shell of ice over the kneeling stag (and its pieces breaking off) ----
  if (P.shell) shell(R, P, T, H);
  return R;
}

/**
 * The head: skull, muzzle (its dark tip), the jaw, ears, the antlers; the eyes and nostrils as
 * decals. Head frame: x along the muzzle, y up the forehead, z the near side — rolled by
 * `headRoll`, pitched by `head`, turned by `yaw`.
 * @param {Rig} R @param {Pose} P @param {V3} Hp @param {'down'|'up'|'side'} view
 */
function head(R, P, Hp, view) {
  const k = P.headScale;
  const hr = P.headRoll * DEG;
  const hp = P.head * DEG;
  const yw = P.yaw * DEG;
  const cr = Math.cos(hr), sr = Math.sin(hr), cp = Math.cos(hp), sp = Math.sin(hp), cy = Math.cos(yw), sy = Math.sin(yw);
  /** head frame → model @type {(x: number, y: number, z?: number, s?: number) => V3} */
  const Hf = (x, y, z = 0, s = k) => {
    x *= s; y *= s; z *= s;
    const y1 = y * cr - z * sr;
    const z1 = y * sr + z * cr;
    const x2 = x * cp - y1 * sp;
    const y2 = x * sp + y1 * cp;
    return [Hp[0] + x2 * cy - z1 * sy, Hp[1] + y2, Hp[2] + x2 * sy + z1 * cy];
  };
  const r = (v) => v * k;
  // skull and the long face
  R.tube(Hf(-1, 2), r(6.2), Hf(7, 1.5), r(6.4), 'coat', PART.head, { seed: 29 });
  R.tube(Hf(8, 0.5), r(5.2), Hf(16, -2), r(3.8), 'coat', PART.head, { seed: 31, u0: 8 });
  R.tube(Hf(15, -2.3), r(3.9), Hf(20.5, -3.3), r(3.1), 'muzzle', PART.head);
  // the jaw (dropped when it bellows) and the dark mouth between
  const j = P.jaw;
  if (j > 0.08) R.tube(Hf(8, -3.5), r(2.4), Hf(18.5, -4.6 - 2.6 * j), r(1.8), 'mouth', PART.mouth);
  R.tube(Hf(4, -3.5), r(3.3), Hf(17, -5.5 - 5.5 * j), r(2.2), 'coat', PART.jaw, { seed: 37, lift: -0.35 });
  R.tube(Hf(16, -5.4 - 5.2 * j), r(2.3), Hf(18.8, -6 - 5.6 * j), r(1.9), 'muzzle', PART.jaw);
  // ears: up and out, laid back in the charge, drooping when beaten
  const e = P.ears;
  const ey = e > 0 ? 10 - 9 * e : 10 + e * 2;
  const ex = e > 0 ? -6 + 2 * e : -7 + e * 4;
  const ez = e > 0 ? 12 + 3 * e : 11 + e;
  for (const s of [-1, 1]) {
    const part = s > 0 ? PART.earN : PART.earF;
    const mid = Hf(ex * 0.45 - 0.5, 4.5 + (ey - 4.5) * 0.5, (3.8 + (ez - 3.8) * 0.5) * s);
    R.tube(Hf(-1, 4.5, 3.8 * s), r(2.3), mid, r(3.1), 'coat', part, { seed: 41 + s, lift: s > 0 ? 0 : -0.3 });
    R.tube(mid, r(3.1), Hf(ex, ey, ez * s), r(0.8), 'coat', part, { seed: 43 + s, lift: s > 0 ? 0 : -0.3, u0: 4 });
  }
  // the antlers
  antlers(R, P, Hf, view);
  // the eyes and nostrils
  for (const s of [-1, 1]) {
    R.decals.push({ p: view === 'down' ? Hf(9.4, 3.3, 4.7 * s) : Hf(8.6, 2.9, 5.3 * s), kind: 'eye', part: PART.head });
    R.decals.push({ p: Hf(20.6, -2.4, 1.6 * s), kind: 'nostril', part: PART.head });
  }
  R.nose = Hf(22, -3);
}

/**
 * The antlers: a beam from each pedicle up, back and out, curving forward at the crown; the brow,
 * bez and trez tines forward; a crown of three points. Phase 2: ice crystals on every tip and along
 * the beam; thawed: blossom caught in them.
 * @param {Rig} R @param {Pose} P @param {(x: number, y: number, z?: number, s?: number) => V3} Hf
 * @param {'down'|'up'|'side'} view
 */
function antlers(R, P, Hf, view) {
  const ka = P.headScale * P.antlerScale;
  // the antler frame: the head frame scaled (x × 0.84, y × 0.78, the spread × 1.18)
  /** @type {(x: number, y: number, z: number) => V3} */
  const A = (x, y, z) => Hf(x * 0.84, y * 0.78, z * 1.18, ka);
  const r = (v) => v * ka;
  for (const s of [-1, 1]) {
    const part = s > 0 ? PART.antN : PART.antF;
    const lift = s > 0 || view !== 'side' ? 0 : -0.35;
    // the beam: out and back from the pedicle, up, the crown cupping inward at the top (a candelabra
    // from the front, a comb of tines on a curved beam in profile)
    const beam = [A(1, 7, 3 * s), A(-6, 11.5, 11.5 * s), A(-12, 18.5, 19.5 * s), A(-13, 28, 23.5 * s), A(-9.5, 37.5, 22 * s)];
    R.chain(beam, [r(2.8), r(2.4), r(2.1), r(1.7), r(1.1)], 'antler', part, { lift });
    // the burr at the base
    R.tube(A(0.8, 8.2, 3.3 * s), r(2.9), A(0.2, 9.4, 3.9 * s), r(2.5), 'antler', part, { lift: lift - 0.3, uLen: 40 });
    /** @type {[V3, V3, number][]} tines: root, tip, root radius */
    const tines = [
      [A(-0.8, 9.5, 6 * s), A(10, 15.5, 8 * s), 1.75],
      [A(-7.5, 12.5, 13 * s), A(0, 24, 12 * s), 1.6],
      [A(-12.4, 20.5, 20.5 * s), A(-8.5, 31.5, 17.5 * s), 1.5],
      [A(-13, 28, 23.5 * s), A(-20, 37, 28 * s), 1.35],
      [A(-11.4, 33, 23.2 * s), A(-10, 43.5, 18 * s), 1.25],
    ];
    const tips = [beam[4]];
    for (const [a, b, ra] of tines) {
      R.tube(a, r(ra), b, r(0.6), 'antler', part, { lift, u0: 22, uLen: 22 + dist3(a, b) * 1.3 });
      tips.push(b);
    }
    if (P.crystals) {
      // shards on every tip, pointing on along the tine and fanning out; a few along the beam
      for (const t of tips) {
        const up = [0, 1, 0];
        const out = [0, 0, s];
        crystal(R, t, add(t, add(mul(up, 4.2 * ka), mul(out, 2.2 * ka))), 1.9 * ka);
        crystal(R, t, add(t, add(mul(up, 2.5 * ka), mul(out, 4.2 * ka))), 1.5 * ka);
      }
      for (const [x, y, z, ux, uy, uz] of [[-12, 18.5, 19.5, -3, 3, 3], [-12.8, 25.5, 22.8, 2, 4, 2.5], [-11, 34.5, 22.6, -2, 3, 3]]) {
        const b = A(x, y, z * s);
        crystal(R, b, add(b, [ux * ka, uy * ka, uz * s * ka]), 1.6 * ka);
      }
    }
    if (P.frost < 0.5 && !P.shell) {
      // blossom caught in the tines (≈ 70 % white and cream, pink on the lilac side)
      for (const [x, y, z, rr] of [[-7.6, 13.5, 13, 2.3], [-12.4, 22, 21.2, 2.0], [-12, 31.5, 23, 2.2], [-0.4, 10.5, 6.6, 1.7]]) {
        const c = A(x, y, z * s);
        R.tube(c, r(rr * 1.45), add(c, [0.8 * ka, 0.6 * ka, 0.5 * s * ka]), r(rr * 1.25), 'blossom', PART.blossom, { seed: 61 + x * 3 + s });
      }
    }
  }
}

/** An ice shard (phase 2): a short crystal from `a` to its point `b`. @param {Rig} R @param {V3} a @param {V3} b @param {number} ra */
function crystal(R, a, b, ra) {
  R.tube(a, ra, b, Math.max(0.35, ra * 0.25), 'crystal', PART.crystal);
}

/**
 * A foreleg: the shoulder → the elbow (bent back) → the knee, the cannon down to the fetlock, the
 * dark hoof. `foot`: a ground point (`x`, lift `y`, the cannon folded forward `f` deg), a point
 * relative to the shoulder (`rel`), or folded under the kneeling stag (`knee`, `foot`).
 * @param {Rig} R @param {V3} S @param {any} foot @param {number} z @param {number} part @param {number} lift
 * @param {boolean} far @param {number} [b] the thickness
 */
function foreleg(R, S, foot, z, part, lift, far, b = 1) {
  let F;
  let Kn;
  if (foot.knee) {
    Kn = [foot.knee[0], foot.knee[1], z];
    F = [foot.foot[0], foot.foot[1], z];
  } else {
    F = foot.rel ? [S[0] + foot.rel[0], S[1] + foot.rel[1], z] : [foot.x, foot.y + 1.5, z];
    const f = (foot.f ?? 0) * DEG;
    Kn = add(add(F, [-0.6, 4.5, 0]), [Math.sin(f) * 13, Math.cos(f) * 13, 0]);
  }
  const E = ik(S, Kn, 15, 16, [-1, 0, 0]);
  const o = { lift, far };
  R.tube(S, 7.5 * b, E, 5 * b, 'coat', part, { ...o, seed: part * 5 });
  R.tube(E, 4.4 * b, Kn, 3 * b, 'coat', part, { ...o, seed: part * 5 + 1, u0: 15 });
  const fet = foot.knee ? F : add(F, [-0.6, 4.5, 0]);
  R.tube(Kn, 2.7 * b, fet, 2.2 * b, 'coat', part, { ...o, seed: part * 5 + 2, u0: 31 });
  // the hoof: the pastern down to the ground ahead of the fetlock (dark)
  const dir = foot.knee ? norm3(sub(F, Kn)) : null;
  const tip = dir ? add(F, mul(dir, 4)) : add(F, [2, -1.3, 0]);
  R.tube(fet, 2.5, tip, 2.6, 'hoof', part, { lift });
}

/**
 * A hind leg: the hip → the stifle (forward) → the hock, the cannon slanting down to the fetlock,
 * the hoof. `foot` as the foreleg's (`hock` instead of `knee` when folded).
 * @param {Rig} R @param {V3} Hh @param {any} foot @param {number} z @param {number} part @param {number} lift
 * @param {boolean} far
 */
function hindleg(R, Hh, foot, z, part, lift, far) {
  let F;
  let Hk;
  if (foot.hock) {
    Hk = [foot.hock[0], foot.hock[1], z];
    F = [foot.foot[0], foot.foot[1], z];
  } else {
    F = foot.rel ? [Hh[0] + foot.rel[0], Hh[1] + foot.rel[1], z] : [foot.x, foot.y + 1.5, z];
    const f = (-13 + (foot.f ?? 0)) * DEG;
    Hk = add(add(F, [-0.6, 4.5, 0]), [Math.sin(f) * 16, Math.cos(f) * 16, 0]);
  }
  const St = ik(Hh, Hk, 17, 18.5, [1, 0, 0]);
  const o = { lift, far };
  R.tube(Hh, 10.5, St, 6, 'coat', part, { ...o, seed: part * 5 });
  R.tube(St, 5.2, Hk, 2.7, 'coat', part, { ...o, seed: part * 5 + 1, u0: 17 });
  const fet = foot.hock ? F : add(F, [-0.6, 4.5, 0]);
  R.tube(Hk, 2.6, fet, 2.1, 'coat', part, { ...o, seed: part * 5 + 2, u0: 35 });
  const dir = foot.hock ? norm3(sub(F, Hk)) : null;
  const tip = dir ? add(F, mul(dir, 4)) : add(F, [2, -1.3, 0]);
  R.tube(fet, 2.4, tip, 2.5, 'hoof', part, { lift });
}

/**
 * The shell of ice over the kneeling stag: faceted slabs along the back, chunks on the flanks, a
 * collar over the neck, crusts on the brow and the antler beams, spikes round its foot — gaps
 * between them show the dark body. `shell` 2: cracking — every other slab lifted off and out, the
 * rest standing.
 * @param {Rig} R @param {Pose} P @param {(x: number, y: number, z?: number) => V3} T @param {V3} H
 */
function shell(R, P, T, H) {
  const crack = P.shell === 2;
  /** @type {[number, number, number, number, number, number, number][]} a (x, y, z), b (x, y, z), r */
  const slabs = [
    [-36, 55, 5, -26, 66, 1, 9],
    [-22, 61, -4, -9, 68, 3, 10.5],
    [-6, 63, 5, 7, 68, -3, 10.5],
    [9, 62, -5, 21, 68, 4, 10],
    [23, 59, 6, 31, 66, 0, 8.5],
    [-28, 44, 12, -16, 50, 13, 6.5],
    [-2, 42, 12, 10, 48, 13.5, 6.5],
    [16, 42, 11, 26, 50, 12, 6],
    [-14, 40, -12, 2, 46, -13, 6],
  ];
  slabs.forEach(([ax, ay, az, bx, by, bz, r], i) => {
    if (crack && i % 2 === 1) return;
    const off = crack && i % 4 === 0 ? [0, 7, az > 0 ? 6 : -6] : [0, 0, 0];
    const A0 = add(T(ax, ay, az), off);
    const B0 = add(T(bx, by, bz), off);
    // a crust hugging the body, then a cluster of shards growing out of it, each its own facet group
    R.tube(A0, r * 0.62, B0, r * 0.55, 'ice', PART.ice, { seed: 70 + i });
    const out = az >= 0 ? 1 : -1;
    const top = i < 5;
    for (let k = 0; k < 3; k++) {
      const h = hash(i, k, 131);
      const dir = top
        ? [(k - 1) * 0.55 + (h - 0.5) * 0.3, 1, out * (0.25 + 0.3 * h)]
        : [(k - 1) * 0.5, 0.45 + 0.3 * h, out * (0.9 + 0.2 * h)];
      const len = (top ? 10 : 7) + 4 * h;
      const root = lerp3(A0, B0, 0.2 + 0.3 * k);
      R.tube(root, r * (0.42 + 0.1 * h), add(root, mul(norm3(dir), len)), 0.5, 'ice', 30 + i * 3 + k, { seed: 140 + i * 3 + k });
    }
  });
  // the collar over the neck, crusts on the brow
  const n0 = T(27, 58);
  const nm = lerp3(n0, H, 0.55);
  if (!crack) R.tube(lerp3(n0, H, 0.15), 8.5, add(nm, [1, 3, 0]), 7, 'ice', PART.ice, { seed: 91 });
  R.tube(add(H, [2, 6, 0]), 6.2, add(H, [-3, 9, 2]), 4.5, 'ice', PART.ice, { seed: 93 });
  // spikes round its foot (the frost grew up from the ground)
  const spikes = [[-40, 6], [-30, 9], [-12, 11], [6, 10], [24, 9], [38, 6], [44, 3]];
  spikes.forEach(([x, z], i) => {
    if (crack && i % 2 === 0) return;
    for (const s of [-1, 1]) {
      /** @type {V3} */
      const b = [x + P.dx, 0.5, z * s];
      R.tube(b, 3, add(b, [(i % 3) - 1, 7 + (i % 2) * 4, 2.5 * s]), 0.6, 'ice', PART.ice, { seed: 95 + i });
    }
  });
}

// =================================================================================================
// the raster
// =================================================================================================

const NPX = FW * FH;
const ZB = new Float32Array(NPX);
const MAT = new Uint8Array(NPX);
const TONE = new Float32Array(NPX);
const PRT = new Uint8Array(NPX);
const DARK = new Uint8Array(NPX);
/** The view-space normal of each pixel (x right, y down): the rim pass. */
const NXB = new Float32Array(NPX);
const NYB = new Float32Array(NPX);
/** What each pixel is for the rim pass: 0 nothing / a decal, 1 a lit surface, 2 glow. */
const KND = new Uint8Array(NPX);
/** Scratch of the rim pass. */
const RIMB = new Uint8Array(NPX);

/**
 * Model → view: [screen x, screen y (down), toward the viewer].
 * @param {'down'|'up'|'side'} view @param {number[]} v @param {number} G @returns {V3}
 */
function project(view, v, G) {
  const [x, y, z] = v;
  if (view === 'side') return [CX - x, G - LIFT_SIDE - y * TCS + z * TS, z * TCS + y * TS];
  if (view === 'down') return [CX - z, G - LIFT_FRONT - y * TCF + x * TF, x * TCF + y * TF];
  return [CX + z, G - LIFT_BACK - y * TCU - x * TU, -x * TCU + y * TU];
}

/**
 * View → model for a normal (the transpose of `project`'s rotation), into one scratch vector.
 * @param {'down'|'up'|'side'} view @param {number} nx @param {number} ny @param {number} nz @returns {V3}
 */
function unproject(view, nx, ny, nz) {
  const o = _nm;
  if (view === 'side') { o[0] = -nx; o[1] = -TCS * ny + TS * nz; o[2] = TS * ny + TCS * nz; }
  else if (view === 'down') { o[0] = TF * ny + TCF * nz; o[1] = -TCF * ny + TF * nz; o[2] = -nx; }
  else { o[0] = -TU * ny - TCU * nz; o[1] = -TCU * ny + TU * nz; o[2] = nx; }
  return o;
}
const _nm = /** @type {V3} */ ([0, 0, 0]);

/** Material ids by surface (set by `rimehart(kit)`). @type {Record<string, number>} */
let MATS = {};
/** Lattice hash in [0, 1) (the kit's `hash2`: fixed seeds). */
let hash = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) => {
  void x; void y; void s;
  return 0.5;
};
/** The pose being shaded (its frost mix). @type {Pose} */
let _pose = BASE;
/** The view being shaded. @type {'down'|'up'|'side'} */
let _view = 'side';

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
  for (const t of R.tubes) rasterTube(t, view, G);
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
  // the tube's own frame in model space: the around-coordinate of the textures
  const d3 = norm3(sub(t.b, t.a));
  const upRef = norm3(Math.abs(d3[1]) > 0.9 ? [1, 0, 0] : sub([0, 1, 0], mul(d3, d3[1])));
  const sideRef = cross(d3, upRef);
  const jag = t.tex === 'ruff' || t.tex === 'tail' || t.tex === 'blossom';
  const facet = t.tex === 'ice' || t.tex === 'crystal';
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let s = l2 > 1e-6 ? ((px - A[0]) * dx + (py - A[1]) * dy) / l2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const cx = A[0] + dx * s;
      const cy = A[1] + dy * s;
      let r = t.ra + (t.rb - t.ra) * s;
      const ox = px - cx;
      const oy = py - cy;
      const rho2 = ox * ox + oy * oy;
      if (jag) {
        // a torn edge of tufts: the radius by the angle round the axis (bins of 25°) and the place along it
        const ang = Math.floor((Math.atan2(oy, ox) + Math.PI) / (25 * DEG));
        const k = t.tex === 'blossom' ? 0.62 + 0.38 * hash(ang, Math.round(s * 3), t.seed) : 0.7 + 0.3 * hash(ang, Math.round(s * len3 / 2.5), t.seed);
        r *= k;
      }
      if (rho2 >= r * r) continue;
      const nz = Math.sqrt(1 - rho2 / (r * r));
      const vz = A[2] + dz * s + nz * r;
      const i = y * FW + x;
      if (vz <= ZB[i]) continue;
      let nx = ox / r;
      let ny = oy / r;
      let nzz = nz;
      if (facet) {
        // flat facets: the normal snapped to one of six directions round the axis
        const a = Math.round(Math.atan2(ny, nx) / (Math.PI / 3)) * (Math.PI / 3);
        const q = Math.sqrt(Math.max(0, 1 - nz * nz));
        nx = Math.cos(a) * q * 0.9;
        ny = Math.sin(a) * q * 0.9;
        nzz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      }
      const nm = unproject(view, nx, ny, nzz);
      toneOf(t, nx, ny, nzz, nm, t.u0 + s * len3, upRef, sideRef, r, x, y, t.a[1] + (t.b[1] - t.a[1]) * s + nm[1] * r);
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
let _kind = 0;

/**
 * Material and tone of a tube pixel (into `_tone`, `_kind`).
 * @param {Tube} t
 * @param {number} nx @param {number} ny @param {number} nz the view-space normal
 * @param {V3} nm the model-space normal
 * @param {number} u distance along the chain (px)
 * @param {V3} upRef @param {V3} sideRef the tube's frame
 * @param {number} r its radius here
 * @param {number} x @param {number} y the pixel (the sparkles)
 * @param {number} wy the surface point's height (model px): the lower body's shadow
 */
function toneOf(t, nx, ny, nz, nm, u, upRef, sideRef, r, x, y, wy) {
  const L = _view === 'down' ? LIGHT_FRONT : LIGHT;
  const l = nx * L[0] + ny * L[1] + nz * L[2];
  _kind = 1;
  switch (t.tex) {
    case 'antler': {
      // dark at the burr, a little paler over the tines' last third
      const q = u / Math.max(1, t.uLen);
      _tone[0] = MATS.antler;
      _tone[1] = 1.25 + 1.35 * l + t.lift + (q > 0.6 ? 1.6 * (q - 0.6) / 0.4 : 0) + (hash(Math.floor(u / 2), 0, t.seed) - 0.5) * 0.4;
      return;
    }
    case 'muzzle': _tone[0] = MATS.muzzle; _tone[1] = 1.5 + 1.6 * l + t.lift; return;
    case 'hoof': _tone[0] = MATS.muzzle; _tone[1] = 0.9 + 1.5 * l + t.lift; return;
    case 'mouth': _tone[0] = MATS.muzzle; _tone[1] = 0.2; _kind = 0; return;
    case 'crystal': {
      _kind = 2;
      _tone[0] = MATS.glow;
      _tone[1] = 2.1 + 1.9 * l + (nz > 0.93 ? 0.6 : 0);
      return;
    }
    case 'ice': {
      // pale faceted ice: the facet's tone, a glint on the lit edges, darker deep in the slab
      const g = hash(Math.floor(u / 3), Math.round(Math.atan2(ny, nx) * 2), t.seed);
      _tone[0] = MATS.ice;
      _tone[1] = 1.75 + 2.0 * l + (g - 0.5) * 0.7 + (l > 0.55 && nz < 0.6 ? 0.8 : 0);
      return;
    }
    case 'blossom': {
      _tone[0] = MATS.blossom;
      const g = hash(x, y, t.seed);
      _tone[1] = 2.7 + 1.1 * l + (g < 0.3 ? -1.2 : g > 0.8 ? 0.6 : 0);
      return;
    }
    default: break;
  }
  // the coats: the fur's around-coordinate from the normal's angle in the tube's frame
  const a = Math.atan2(dot(nm, sideRef), dot(nm, upRef));
  const v = a * r;
  // frosted or thawed here: the frost lingers on the top, sliding off in clumps
  const f = _pose.frost;
  const clump = hash(Math.floor(u / 5), Math.floor(v / 4) + 50, t.seed + 3);
  const frosted = f >= 1 || (f > 0 && clump < f + 0.35 * Math.max(0, nm[1]) - 0.1);
  if (t.tex === 'ruff' || t.tex === 'tail') {
    // the shaggy rime: tufts lighter at their tips, dark gaps between them
    const g = hash(Math.floor(u / 2), Math.floor(v / 2) + 30, t.seed);
    _tone[0] = frosted ? MATS.ruff : MATS.mane;
    _tone[1] = 2.35 + 1.45 * l + t.lift + (g < 0.18 ? -1.1 : g > 0.75 ? 0.45 : 0);
    return;
  }
  // the coat: short fur strokes (2 px long down the hair's lie), the underside deeper
  const su = Math.floor(u / 2.2);
  const sv = Math.floor(v / 1.4);
  const g = hash(su, sv, t.seed);
  const front = _view === 'down';
  // the lower body carries the snow's blue shadow: the undersides, the legs below the chest's line
  // (but their lit side), the legs' inner sides, the far limbs — and in the front view the side
  // turned from the light
  const leg = t.part >= PART.legFN && t.part <= PART.legHF;
  const inner = leg && nm[2] * (t.a[2] < 0 ? -1 : 1) < -0.15;
  const low = leg && wy < 34 + _pose.dy && l < 0.3;
  const below = nm[1] < (front ? -0.12 : -0.1) || inner || low || (front && l < 0.04);
  let tone = (front ? 1.15 + 2.15 * l : 1.5 + 1.9 * l) + t.lift + (g - 0.5) * 0.55;
  // the back's top plane (the withers behind the neck, seen from above) catches the sky
  if (nm[1] > (front ? 0.78 : 0.55) && !below) tone += front ? 0.6 : 0.5;
  if (frosted) {
    // hoar-frost sparkles on the lit planes
    if (l > 0.45 && !below && hash(x, y, 97) < 0.035) tone = 4.4;
    _tone[0] = below || t.far ? MATS.coatDeep : MATS.coat;
    if (below || t.far) tone = 1.15 + 1.5 * l + t.lift + (g - 0.5) * 0.45 + (wy < 20 ? -0.3 : 0);
  } else {
    _tone[0] = below || t.far ? MATS.warmDeep : MATS.warm;
    tone += below || t.far ? 0.35 : 0.55;
  }
  _tone[1] = tone;
}

/**
 * Decals over the raster: the eyes (pale-cyan glow under a dark brow; shut in the shell, warm and
 * dark when thawed), the nostrils, the frost breath, the flecks of the shake.
 * @param {Rig} R @param {'down'|'up'|'side'} view @param {number} G @param {Pose} P
 */
function decals(R, view, G, P) {
  for (const d of R.decals) {
    const q = project(view, d.p, G);
    const x = Math.floor(q[0]);
    const y = Math.floor(q[1]);
    if (x < 1 || y < 1 || x >= FW - 2 || y >= FH - 2) continue;
    const i = y * FW + x;
    if (PRT[i] !== d.part || (view !== 'down' && ZB[i] - q[2] > 6 * P.headScale)) continue;
    if (d.kind === 'nostril') {
      set(x, y, MATS.muzzle, 0);
      continue;
    }
    if (P.eye === 'shut') {
      set(x, y, MATS.coatDeep, 0); set(x + 1, y, MATS.coatDeep, 0);
      continue;
    }
    if (P.eye === 'warm') {
      set(x, y, MATS.muzzle, 0); set(x + 1, y, MATS.muzzle, 0); set(x, y + 1, MATS.muzzle, 1);
      set(x + (view === 'down' ? 0 : 1), y, MATS.ruff, 4);
      continue;
    }
    // a dark almond round a pale-cyan core, the brow over it
    const hot = P.eye === 'dim' ? 2 : 4;
    for (const k of [-1, 0, 1, 2]) set(x + k, y - 1, MATS.muzzle, 0);
    set(x - 1, y, MATS.muzzle, 1); set(x + 2, y, MATS.muzzle, 1);
    set(x, y + 1, MATS.muzzle, 1); set(x + 1, y + 1, MATS.muzzle, 1);
    set(x, y, MATS.glow, hot); set(x + 1, y, MATS.glow, hot - 1);
  }
  // the frost breath: a small puff ahead of the nose
  if (P.breath && R.nose && view !== 'up') {
    const q = project(view, R.nose, G);
    const n = P.breath;
    const pts = n === 1 ? [[0, 0], [1, -1], [2, 0], [1, 1]] : [[0, 0], [1, -1], [2, -1], [3, 0], [2, 1], [4, -1], [5, 0], [3, -2]];
    const dir = view === 'side' ? -1 : 0;
    for (const [a, b] of pts) {
      const x = Math.round(q[0] + dir * a + (view === 'side' ? -1 : (a % 2 ? 1 : -1) * Math.ceil(a / 2)));
      const y = Math.round(q[1] + b + (view === 'side' ? 0 : a));
      paint(x, y, MATS.ruff, (a + b) % 2 ? 3 : 4);
    }
  }
  // the shake's flecks of ice flying off one side
  if (P.spray) {
    const m = project(view, R.mid, G);
    for (let k = 0; k < 26; k++) {
      const ang = (-150 + 120 * hash(k, 1, 211)) * DEG;
      const rad = 22 + 16 * hash(k, 2, 211);
      const side = view === 'side' ? P.spray : (k % 2 ? 1 : -1);
      const x = Math.round(m[0] + Math.cos(ang) * rad * (k % 3 === 0 ? 0.6 : 1) * side * (view === 'side' ? 1 : 1.1));
      const y = Math.round(m[1] - 10 + Math.sin(ang) * rad * 0.8);
      const t = hash(k, 3, 211) < 0.5 ? 4 : 3;
      paint(x, y, MATS.ice, t);
      if (k % 4 === 0) paint(x + 1, y, MATS.ice, t - 1);
    }
  }
}

/** A decal's pixel on the body (the passes leave it as it is). @param {number} x @param {number} y @param {number} m @param {number} tone */
function set(x, y, m, tone) {
  if (x < 0 || y < 0 || x >= FW || y >= FH) return;
  const i = y * FW + x;
  if (!MAT[i]) return;
  MAT[i] = m;
  TONE[i] = tone;
  KND[i] = m === MATS.glow ? 2 : 0;
}

/** A free pixel anywhere in the frame (breath, flecks). @param {number} x @param {number} y @param {number} m @param {number} tone */
function paint(x, y, m, tone) {
  if (x < 1 || y < 1 || x >= FW - 1 || y >= FH - 1) return;
  const i = y * FW + x;
  MAT[i] = m;
  TONE[i] = tone;
  KND[i] = 0;
  if (ZB[i] < -1e8) ZB[i] = 999;
}

/** The frame rows kept free above the highest painted pixel (a free row and the outline's). */
const TOP_MARGIN = 3;

/** The first row with a painted pixel (FH: none). */
function topRow() {
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (MAT[y * FW + x]) return y;
  return FH;
}

/** Inner lines: a pixel next to a nearer pixel of another part goes dark. */
function innerLines() {
  DARK.fill(0);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      if (!MAT[i] || KND[i] === 2) continue;
      const z = ZB[i];
      const p = PRT[i];
      if ((x > 0 && near(i - 1, p, z)) || (x < FW - 1 && near(i + 1, p, z)) || (y > 0 && near(i - FW, p, z)) || (y < FH - 1 && near(i + FW, p, z))) DARK[i] = 1;
    }
  }
  for (let i = 0; i < NPX; i++) if (DARK[i]) TONE[i] = Math.min(TONE[i], MAT[i] === MATS.ice ? 1 : 0.4);
}

/** @param {number} j @param {number} p @param {number} z */
function near(j, p, z) {
  return MAT[j] !== 0 && PRT[j] !== p && ZB[j] - z > (_view === 'down' ? LINE_DEPTH_FRONT : LINE_DEPTH) && KND[j] !== 0;
}

/**
 * The snow's cool rim: a pixel facing up-left whose neighbour toward the light is empty or a farther
 * part takes the light's tone, the pixel inside it a step up.
 */
function rim() {
  RIMB.fill(0);
  for (let y = 1; y < FH; y++) {
    for (let x = 1; x < FW; x++) {
      const i = y * FW + x;
      if (KND[i] !== 1 || DARK[i]) continue;
      if (NXB[i] * RIM[0] + NYB[i] * RIM[1] < 0.25) continue;
      const z = ZB[i] - LINE_DEPTH;
      const p = PRT[i];
      const l = i - 1;
      const u = i - FW;
      if (!MAT[l] || !MAT[u] || (ZB[l] < z && PRT[l] !== p) || (ZB[u] < z && PRT[u] !== p)) RIMB[i] = 1;
    }
  }
  for (let i = 0; i < NPX; i++) {
    if (RIMB[i] !== 1) continue;
    const m = MAT[i];
    if (m === MATS.antler || m === MATS.muzzle) TONE[i] = Math.max(TONE[i] + 1, 3);
    else TONE[i] = Math.max(TONE[i] + 0.9, 3.6);
  }
}

// =================================================================================================
// poses
// =================================================================================================

/** The walk's four frames (8 fps): the diagonal pairs, the head nodding. @type {Partial<Pose>[]} */
const WALK = [
  { FN: { x: 34, y: 0 }, FF: { x: 18, y: 4, f: 55 }, HN: { x: -35, y: 0 }, HF: { x: -22, y: 4, f: 45 }, head: -18 },
  { FN: { x: 28, y: 0 }, FF: { x: 28, y: 7, f: 85 }, HN: { x: -30, y: 0 }, HF: { x: -27, y: 7, f: 70 }, head: -22, dy: 1 },
  { FN: { x: 19, y: 4, f: 55 }, FF: { x: 33, y: 0 }, HN: { x: -22, y: 4, f: 45 }, HF: { x: -36, y: 0 }, head: -18 },
  { FN: { x: 29, y: 7, f: 85 }, FF: { x: 27, y: 0 }, HN: { x: -27, y: 7, f: 70 }, HF: { x: -31, y: 0 }, head: -22, dy: 1 },
];

/** The folded legs of the kneeling stag. */
const KNEEL_LEGS = {
  FN: { knee: [35, 3], foot: [21, 1.6] }, FF: { knee: [31, 3.2], foot: [17, 1.6] },
  HN: { hock: [-41, 3], foot: [-24, 1.6] }, HF: { hock: [-37, 3.2], foot: [-21, 1.6] },
};

/** The poses' own parameters (the rest from `BASE`; `<pose>X` is its pose with the crystals). @type {Record<string, Partial<Pose>>} */
const POSES = {
  idle0: {},
  idle1: { chest: 0.6, head: -19, breath: 1 },
  idle2: { chest: 1.1, head: -18, breath: 2, ears: -0.4 },
  walk0: WALK[0], walk1: WALK[1], walk2: WALK[2], walk3: WALK[3],
  run0: { FN: { x: 13, y: 10, f: 105 }, FF: { x: 22, y: 4, f: 65 }, HN: { x: -6, y: 0 }, HF: { x: -12, y: 2, f: 20 }, pitch: 6, dy: 1, neck: 30, head: -50, ears: -1 },
  run1: { FN: { x: 46, y: 6, f: 20 }, FF: { x: 40, y: 0 }, HN: { x: -26, y: 8, f: 70 }, HF: { x: -36, y: 12, f: 60 }, pitch: 2, dy: 3, neck: 28, head: -54, ears: -1 },
  run2: { FN: { x: 50, y: 13, f: 5 }, FF: { x: 43, y: 16, f: 10 }, HN: { x: -52, y: 15, f: -10 }, HF: { x: -58, y: 11, f: -5 }, dy: 8, neck: 26, head: -55, ears: -1, tail: 0.6 },
  run3: { FN: { x: 35, y: 0 }, FF: { x: 28, y: 8, f: 55 }, HN: { x: -44, y: 15, f: 30 }, HF: { x: -38, y: 10, f: 40 }, pitch: -5, dy: 2, neck: 28, head: -56, ears: -1 },
  chargeWind0: { neck: 16, head: -64, pitch: -5, dy: -2, FN: { x: 33, y: 9, f: 85 }, FF: { x: 23, y: 0 }, HN: { x: -31, y: 0 }, HF: { x: -35, y: 0 }, ears: -1, tail: 0.4 },
  chargeWind1: { neck: 16, head: -64, pitch: -5, dy: -2, FN: { x: 20, y: 2, f: 30 }, FF: { x: 23, y: 0 }, HN: { x: -31, y: 0 }, HF: { x: -35, y: 0 }, ears: -1, tail: 0.4 },
  sweepWind: { pitch: 3, dy: -1, neck: 48, yaw: -32, head: -32, headRoll: 28, FN: { x: 31, y: 0 }, FF: { x: 21, y: 0 }, HN: { x: -31, y: 0 }, HF: { x: -25, y: 0 }, ears: -0.6 },
  sweep: { pitch: -6, dy: -2, neck: 14, yaw: 30, head: -58, headRoll: -26, FN: { x: 42, y: 0 }, FF: { x: 19, y: 0 }, HN: { x: -35, y: 0 }, HF: { x: -26, y: 0 }, ears: -1 },
  rear: {
    pitch: 28, pivot: [-27, 52], dy: -17, neck: 42, head: -22, ears: -0.5, tail: 0.5,
    HN: { x: -23, y: 0 }, HF: { x: -29, y: 0 }, FN: { rel: [10, -20], f: 105 }, FF: { rel: [16, -15], f: 95 },
  },
  stomp: { pitch: -10, dy: -4, neck: 20, head: -52, FN: { x: 44, y: 0 }, FF: { x: 38, y: 0 }, HN: { x: -31, y: 0 }, HF: { x: -25, y: 0 }, ears: -1 },
  leapWind: { pitch: 9, dy: -10, neck: 46, head: -28, FN: { x: 27, y: 0 }, FF: { x: 23, y: 0 }, HN: { x: -23, y: 0 }, HF: { x: -19, y: 0 }, ears: -0.6, tail: 0.3 },
  leap: { pitch: 7, dy: 7, neck: 46, head: -22, ears: -1, tail: 0.7, FN: { rel: [11, -24], f: 115 }, FF: { rel: [5, -21], f: 100 }, HN: { rel: [-16, -21], f: -35 }, HF: { rel: [-22, -18], f: -25 } },
  land: { pitch: -8, dy: -7, neck: 22, head: -52, FN: { x: 42, y: 0 }, FF: { x: 34, y: 0 }, HN: { x: -40, y: 0 }, HF: { x: -32, y: 0 }, ears: -0.6 },
  bellowWind: { pitch: 6, chest: 1.8, neck: 84, head: 40, jaw: 0.15, ears: -0.6, FN: { x: 28, y: 0 }, FF: { x: 22, y: 0 }, HN: { x: -30, y: 0 }, HF: { x: -26, y: 0 } },
  bellow: { pitch: 2, chest: 1.2, neck: 50, neckLen: 28, head: 16, jaw: 1, ears: -1, FN: { x: 32, y: 0 }, FF: { x: 24, y: 0 }, HN: { x: -32, y: 0 }, HF: { x: -26, y: 0 } },
  stun: { pitch: -5, dy: -4, neck: 6, head: -72, headRoll: 22, ears: 1, FN: { x: 42, y: 0 }, FF: { x: 14, y: 0 }, HN: { x: -42, y: 0 }, HF: { x: -18, y: 0 } },
  hurt: { dx: -3, pitch: 5, neck: 72, head: 12, jaw: 0.4, ears: -1 },
  bow: { ...KNEEL_LEGS, dy: -33, pitch: -3, neck: 22, head: -46, ears: 1 },
  shell: { ...KNEEL_LEGS, dy: -33, pitch: -3, neck: 22, head: -46, ears: 1, shell: 1, eye: 'shut' },
  rise0: {
    FN: { x: 37, y: 0 }, FF: { knee: [31, 3.2], foot: [17, 1.6] }, HN: { hock: [-41, 3], foot: [-24, 1.6] }, HF: { hock: [-37, 3.2], foot: [-21, 1.6] },
    dy: -22, pitch: 8, neck: 44, head: -14, ears: 0.3, shell: 2, eye: 'dim',
  },
  rise1: { dy: -4, pitch: -2, neck: 54, head: -18, frost: 0.55, eye: 'dim', FN: { x: 30, y: 0 }, FF: { x: 22, y: 0 }, HN: { x: -30, y: 0 }, HF: { x: -24, y: 0 } },
  shake0: { roll: 13, yaw: 26, headRoll: -18, neck: 50, head: -16, frost: 0.3, spray: 1, eye: 'warm', ears: -0.5, FN: { x: 32, y: 0 }, FF: { x: 20, y: 0 }, HN: { x: -33, y: 0 }, HF: { x: -23, y: 0 } },
  shake1: { roll: -13, yaw: -26, headRoll: 18, neck: 50, head: -16, frost: 0.12, spray: -1, eye: 'warm', ears: 0.4, FN: { x: 32, y: 0 }, FF: { x: 20, y: 0 }, HN: { x: -33, y: 0 }, HF: { x: -23, y: 0 } },
  free0: { ...WALK[0], frost: 0, eye: 'warm' },
  free1: { ...WALK[1], frost: 0, eye: 'warm' },
  free2: { ...WALK[2], frost: 0, eye: 'warm' },
  free3: { ...WALK[3], frost: 0, eye: 'warm' },
  freeIdle: { frost: 0, eye: 'warm', yaw: 108, neck: 58, head: -10, ears: -0.3, tail: 0.2 },
};

/** The front view's own parameters of a few poses (the rear lower: the crown in the frame). @type {Record<string, Partial<Pose>>} */
const FRONT = {
  rear: { neck: 44, head: -30, dy: -14, pitch: 24 },
  hurt: { neck: 60, head: 0 },
  bellowWind: { neck: 74, head: 30 },
};

/**
 * The pose of a cell: its parameters over `BASE`; `<pose>X` with the crystals; the front view's
 * look (the head bigger and tipped up toward the camera, the crown wider, the legs apart).
 * @param {string} key @param {'down'|'up'|'side'} view
 * @returns {Pose}
 */
function poseOf(key, view) {
  const x2 = key.endsWith('X') && Object.hasOwn(POSES, key.slice(0, -1));
  const own = POSES[x2 ? key.slice(0, -1) : key] ?? {};
  /** @type {Pose} */
  const P = { ...BASE, ...own, crystals: x2, ...(view === 'down' ? FRONT[x2 ? key.slice(0, -1) : key] ?? {} : {}) };
  if (view === 'down') {
    P.headScale = 1.34;
    P.breadth = 1.18;
    P.legBulk = 1.15;
    P.antlerScale = 1.0;
    P.head += 6;
    P.splay = 1.35;
    // a turned head faces the camera less far in the front view (the last look turns its face to the
    // camera over its shoulder only from the side and the back)
    P.yaw *= key === 'freeIdle' ? 0.2 : 0.5;
  } else if (view === 'up') {
    P.splay = 1.3;
    // (walking away the head is carried lower: the crown stays in the frame)
    P.neck -= 18;
    P.head -= 4;
    P.antlerScale = 0.9;
    if (key === 'freeIdle') P.yaw = 150;
  }
  return P;
}

// =================================================================================================
// the kind
// =================================================================================================

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function rimehart(K) {
  const { M } = K;
  hash = (x, y, s) => K.hash2(x, y, s);
  MATS = {
    coat: M.FUR, coatDeep: M.FUR2, warm: M.FUR3, warmDeep: M.COMB, ruff: M.WHITE, mane: M.SHIRT,
    antler: M.BONE, muzzle: M.NOSE, glow: M.GLOW, ice: M.GEL, blossom: M.SCARF,
  };
  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    let P = poseOf(key, view);
    _view = view;
    let R;
    // a crown (or its crystals) reaching the frame's top rows is drawn a little smaller, so every
    // cell keeps a free row and its outline above the tips
    for (let k = 0; ; k++) {
      _pose = P;
      R = build(P, view);
      rasterise(R, view, f.G);
      if (k >= 8 || topRow() >= TOP_MARGIN) break;
      P = { ...P, antlerScale: P.antlerScale * 0.95 };
    }
    innerLines();
    rim();
    decals(R, view, f.G, P);
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
    fw: FW, fh: FH, columns: RIMEHART_COLUMNS,
    aliases: { kneel: 'idle0', dead: 'bowX', move0: 'walk0', move1: 'walk1', move2: 'walk2', move3: 'walk3' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([3.4, 1.4]) },
    draw,
    idle: { poses: ['idle0', 'idle1', 'idle2', 'idle1'], fps: 2.5 },
    layout: {
      perRow: 32,
      strips: [{ dir: 'left' }, { dir: 'right' }, { dir: 'down', poses: RIMEHART_FRONT }, { dir: 'up', poses: RIMEHART_BACK }],
    },
    ramps: () => K.makeRamps({
      // the frost coat: shade toward violet-blue, light toward the snow's white
      [M.FUR]: K.ramp5(['#3a4a6e', '#667ea8', '#a4bad8', '#d6e4f2', '#f6fbff']),
      // the undersides and the far limbs
      [M.FUR2]: K.ramp5(['#20283f', '#34426a', '#506491', '#7488b2', '#9cb0d2']),
      // the ruff of rime: tufts white at their tips
      [M.WHITE]: K.ramp5(['#56668c', '#90a6c8', '#c8d8ec', '#eaf2fb', '#ffffff']),
      // the thawed coat (ivory, warm shade) and its undersides; the thawed mane
      [M.FUR3]: K.ramp5(['#5a4a3c', '#9a8468', '#d2c0a0', '#f0e6d2', '#fffaf0']),
      [M.COMB]: K.ramp5(['#3a2e26', '#5e4c3c', '#86705a', '#a89078', '#c8b296']),
      [M.SHIRT]: K.ramp5(['#6a5a4a', '#a8967c', '#dccdb2', '#f4ecdc', '#fffcf4']),
      // the antlers: near-black with a violet lean, the tips a little paler
      [M.BONE]: K.ramp5(['#16141e', '#262230', '#3a3446', '#564c60', '#7a6e84']),
      // the muzzle and the hooves
      [M.NOSE]: K.ramp5(['#121219', '#20202c', '#323244', '#4a4a5e', '#66667c']),
      // the shell of ice (not glow)
      [M.GEL]: K.ramp5(['#1e4a66', '#3a86a8', '#8fd6ea', '#cfeef8', '#f4fdff']),
      // blossom: ≈ 70 % white and cream, pinks on the lilac side
      [M.SCARF]: K.ramp5(['#8e4a72', '#d98ab4', '#f2bcd6', '#fbe2ea', '#fff6f2']),
      // the eyes and phase 2's crystals (glow texels)
      [M.GLOW]: K.glowRamp(['#1c5a7a', '#3a9ac0', '#7ad6f0', '#bff0ff', '#f0ffff']),
    }, M.FUR),
  };
}
