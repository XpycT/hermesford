/**
 * Ashen Hellhound — a fire hound of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3,
 * §6.7): a lean, deep-chested hound in charcoal hide split by glowing magma cracks, a mane of flame
 * from the brow down the neck and shoulders, ember eyes, bone spurs along the spine and a flame-tipped
 * tail. ≈ 1.3 u at the shoulder and 2.4 u long in a 64 × 48 frame (the contract's 48 × 32 had no
 * room for the hound rearing up to claw at a door, howling or stretched out in a leap). Owner: the brutes package.
 *
 * Columns: COMMON (`windup` = jaws open, head low before a bite; `attack` = the snapping lunge) and
 * `crouch` (the pounce's coil), `leap`, `land`, `breathWind` (reared back, the throat glowing),
 * `breath0` / `breath1` (fire pouring from the jaws), `claw0` / `claw1` (reared up, raking a wall)
 * and `howl`. Idle flickers the mane over three frames (`idle0` `idle1` `idle2`). Each pose is a rig
 * (spine, neck, head, four legs, tail) for the side view (facing left; the `right` row mirrors it)
 * and the front / back views, painted from shaded capsules lit from the upper left. Glow texels (the
 * mane, the cracks, the eyes) light up with the brain's `uGlow`. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number]} Pt */

const DEG = Math.PI / 180;
/** The rigs' 56 × 40 layout box sits this far in from the frame's left and top (the frame is 64 × 48). */
const OX = 4, OY = 8;
const LX = -0.55, LY = -0.8;

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function ashhound(K) {
  const { M } = K;
  const HIDE = M.FUR, DARK = M.FUR2, BONE = M.BONE, GLOW = M.GLOW, MOUTH = M.NOSE;

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  /** Tapered capsule a → b shaded as a cylinder lit from the upper left. */
  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { hi = 0.42, lo = -0.22, deep = -0.72, lift = 0, shine = 0, max = 4 } = o;
    const [ax, ay] = a, [bx, by] = b;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1e-9;
    const R = Math.max(ar, br);
    for (let y = Math.floor(Math.min(ay, by) - R - 1); y <= Math.ceil(Math.max(ay, by) + R + 1); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - R - 1); x <= Math.ceil(Math.max(ax, bx) + R + 1); x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
        const r = ar + (br - ar) * t;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const l = (dx * LX + dy * LY) / Math.max(0.5, r);
        let s = l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0;
        if (shine && l > shine && d2 > r * r * 0.3) s = 4;
        p.set(x, y, mat, Math.max(0, Math.min(max, s + lift)));
      }
    }
  }
  function chain(p, pts, rs, mat, o) {
    for (let i = 0; i + 1 < pts.length; i++) capsule(p, pts[i], rs[i], pts[i + 1], rs[i + 1], mat, o);
  }
  function body(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.42, lo: -0.25, deep: -0.75, ...o });
  }

  /**
   * A flame tongue from a base point, leaning by `lean` (px over its height), `h` tall: hot (4/3)
   * at the base, orange in the middle, red at the flickering tip. Glow texels.
   */
  function tongue(p, x, y, h, lean, w = 1) {
    for (let k = 0; k < h; k++) {
      const t = k / Math.max(1, h - 1);
      const cx = x + lean * t * t;
      const hw = w * (1 - t);
      const core = t < 0.45 ? 4 : t < 0.75 ? 3 : 2;
      const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
      for (let px = x0; px <= x1; px++) {
        const edge = px === x0 || px === x1;
        p.set(px, y - k, GLOW, edge && x1 > x0 ? Math.max(1, core - 2) : core);
      }
    }
  }

  /** A magma crack (glow texels) along a polyline. */
  function crack(p, pts, s = 3) { K.crack(p, pts, s); }

  // -------------------------------------------------------------------------------------------
  // Side view (facing left)
  // -------------------------------------------------------------------------------------------

  /**
   * A side rig: the body's three masses, the neck and head, four legs (front: shoulder, elbow,
   * wrist, paw; hind: hip, stifle, hock, paw), the tail, the mane's flare (0 calm … 2 flaring)
   * and its flicker phase.
   * @typedef {object} SideRig
   * @property {Pt} chest @property {Pt} belly @property {Pt} haunch @property {Pt} neck
   * @property {Pt} head  skull centre
   * @property {number} snout  degrees (180 = left)
   * @property {number} jaw    0 closed … 1 wide
   * @property {Pt[]} FN @property {Pt[]} FF @property {Pt[]} HN @property {Pt[]} HF
   * @property {Pt[]} tail
   * @property {number} flare @property {number} flick
   * @property {boolean} [throat] the throat glows (the breath)
   */

  function frontLeg(p, L, near) {
    const [s, e, w, paw] = L;
    const lift = near ? 0 : -1;
    const mat = near ? HIDE : DARK;
    p.begin(near ? 'all' : null, 1);
    capsule(p, s, 3.0, e, 2.0, mat, { lift });
    capsule(p, e, 1.9, w, 1.3, mat, { lift });
    capsule(p, w, 1.3, [paw[0] + 1, paw[1] - 0.5], 1.4, mat, { lift });
    p.end();
    p.begin(null);
    p.set(paw[0] - 1, paw[1], BONE, near ? 3 : 2); p.set(paw[0], paw[1], BONE, near ? 2 : 1);
    if (near) crack(p, [[e[0] + 0.5, e[1] - 1], [w[0], w[1] - 1]], 2);
    p.end();
  }

  function hindLeg(p, L, near) {
    const [hip, knee, hock, paw] = L;
    const lift = near ? 0 : -1;
    const mat = near ? HIDE : DARK;
    p.begin(near ? 'all' : null, 1);
    capsule(p, hip, 4.0, knee, 2.6, mat, { lift });
    capsule(p, knee, 2.2, hock, 1.4, mat, { lift });
    capsule(p, hock, 1.3, [paw[0] + 1, paw[1] - 0.5], 1.3, mat, { lift });
    p.end();
    p.begin(null);
    p.set(paw[0] - 1, paw[1], BONE, near ? 3 : 2); p.set(paw[0], paw[1], BONE, near ? 2 : 1);
    p.set(Math.round(hock[0] + 1), Math.round(hock[1] - 1), BONE, near ? 2 : 1);
    if (near) crack(p, [[hip[0] - 2, hip[1] - 2], [hip[0], hip[1] + 1], [knee[0] + 1, knee[1]]], 2);
    p.end();
  }

  function headSide(p, S) {
    const [hx, hy] = S.head;
    const a = S.snout * DEG;
    const dx = Math.cos(a), dy = -Math.sin(a);
    const jaw = S.jaw;
    const tip = [hx + dx * 8, hy + dy * 8 + 0.5];
    // the far ear, the skull, the long upper muzzle
    p.begin(null);
    capsule(p, [hx + 2.5, hy - 2], 1.5, [hx + 6.5, hy - 6.5], 0.4, DARK, { lift: -1 });
    p.end();
    p.begin('all', 1);
    body(p, hx + 0.8, hy - 0.2, 4.6, 3.7, HIDE, { hi: 0.35 });
    capsule(p, [hx + dx * 1.5, hy + dy * 1.5 + 0.3], 2.8, tip, 1.4, HIDE, { hi: 0.3, shine: 0.75 });
    p.end();
    // the lower jaw (dropped when open), the glowing mouth and fangs
    const jd = jaw * 4;
    p.begin('all', 0);
    capsule(p, [hx + dx * 1, hy + 2.4], 1.8, [tip[0] + 0.5 - dx * 0.5 - dy * jd * 0.2, tip[1] + 1.6 + jd], 1.0, HIDE, { lift: -1 });
    p.end();
    p.begin(null);
    if (jaw > 0) {
      for (let k = 1; k <= 6; k++) {
        const x = Math.round(hx + dx * (1 + k * 0.9)), y0 = Math.round(hy + dy * (1 + k * 0.9) + 1.6);
        for (let y = y0; y <= y0 + Math.round(jd * k / 7); y++) p.set(x, y, S.throat ? GLOW : MOUTH, S.throat ? (k < 3 ? 4 : 3) : (y === y0 ? 2 : 1));
      }
      p.set(Math.round(tip[0] + 0.5), Math.round(tip[1] + 1), BONE, 4);
      p.set(Math.round(tip[0] + 1.5 - dy * jd * 0.2), Math.round(tip[1] + jd), BONE, 3);
      p.set(Math.round(tip[0] + 3.5), Math.round(tip[1] + 1.5), BONE, 3);
    } else {
      for (let k = 1; k <= 6; k++) p.set(Math.round(hx + dx * (1 + k)), Math.round(hy + dy * (1 + k) + 1.8), DARK, 0);
      p.set(Math.round(tip[0] + 1), Math.round(tip[1] + 1.5), BONE, 4);
    }
    p.set(Math.round(tip[0] - 0.5), Math.round(tip[1] - 0.6), DARK, 0); // nose
    p.end();
    // the near ear swept back, the ember eye under a heavy brow, a crack over the cheek
    p.begin('all', 0);
    capsule(p, [hx + 1.5, hy - 2.5], 1.8, [hx + 6, hy - 7.5], 0.4, HIDE, { lift: 0, shine: 0.6 });
    p.end();
    p.begin(null);
    p.over(Math.round(hx + 3), Math.round(hy - 4), MOUTH, 2); // the inner ear
    p.end();
    p.begin(null);
    const ex = Math.round(hx + dx * 1.8 - 0.5), ey = Math.round(hy - 1 + dy * 1.8);
    p.set(ex - 1, ey - 1, DARK, 0); p.set(ex, ey - 1, DARK, 0);
    p.set(ex, ey, GLOW, 4); p.set(ex + 1, ey, GLOW, 3);
    crack(p, [[hx + 2, hy + 1], [hx + 4, hy - 1]], 2);
    p.end();
  }

  /**
   * The mane: a crest of flame from the brow down the neck to the withers (glow) — a hot band along
   * the crest and packed tongues leaning back, taller in the middle, flickering by `flick`.
   */
  function maneSide(p, S) {
    const [hx, hy] = S.head;
    const [nx, ny] = S.neck;
    const f = S.flare;
    const x0 = hx + 1.5, y0 = hy - 3.2, x1 = nx + 5, y1 = ny - 2.5;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const flick = ((i * 5 + S.flick * 3) % 4) - 1.5;
      const swell = Math.sin(Math.PI * Math.min(1, 0.15 + t * 1.1));
      const h = Math.round(3 + swell * (3.5 + f * 1.5) + flick * 0.8);
      tongue(p, x, y + 1, Math.max(3, h), 2.6 + f + flick * 0.6 + t * 1.5, 1.4);
    }
    // the hot crest line where the flames root
    p.begin(null);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      p.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t + 1.5), GLOW, t < 0.8 ? 4 : 3);
    }
    p.end();
  }

  function drawSide(p, S) {
    // the far legs, the tail behind the body
    hindLeg(p, S.HF, false);
    frontLeg(p, S.FF, false);
    p.begin('all', 1);
    chain(p, S.tail, S.tail.map((_, i) => 2.0 - i * (1.4 / (S.tail.length - 1))), HIDE, { lift: 0 });
    p.end();
    const tt = S.tail[S.tail.length - 1];
    tongue(p, tt[0], tt[1] + 1, 4 + S.flare, 1.5, 0.8);
    // the body: haunch, belly, the deep chest
    p.begin('all', 1);
    body(p, S.haunch[0], S.haunch[1], 5.8, 4.6, HIDE);
    body(p, S.belly[0], S.belly[1] - 0.5, 6.4, 3.2, HIDE);
    body(p, S.chest[0], S.chest[1], 6.0, 5.8, HIDE, { hi: 0.38 });
    p.end();
    // ribs and the tucked belly in shadow, magma cracks over the flank and shoulder
    p.begin(null);
    for (let k = 0; k < 3; k++) {
      const x = Math.round(S.chest[0] + 3 + k * 2.5), y = Math.round(S.chest[1] - 1 + k * 0.5);
      p.over(x, y, DARK, 1); p.over(x, y + 1, DARK, 1); p.over(x + 1, y + 2, DARK, 1);
    }
    for (let x = Math.round(S.belly[0] - 5); x <= Math.round(S.belly[0] + 5); x++) p.over(x, Math.round(S.belly[1] + 3), DARK, 0);
    crack(p, [[S.chest[0] - 2, S.chest[1] - 3], [S.chest[0] + 1, S.chest[1]], [S.chest[0] - 1, S.chest[1] + 3]], 3);
    crack(p, [[S.belly[0] - 3, S.belly[1] - 2], [S.belly[0], S.belly[1]], [S.belly[0] + 4, S.belly[1] - 1]], 2);
    crack(p, [[S.haunch[0] - 1, S.haunch[1] - 3], [S.haunch[0] + 2, S.haunch[1] - 1]], 2);
    p.end();
    // bone spurs along the spine
    p.begin('all', 0);
    for (let k = 0; k < 4; k++) {
      const t = k / 3;
      const x = Math.round(S.neck[0] + 6 + t * (S.haunch[0] - S.neck[0] - 6));
      const y = Math.round(Math.min(S.belly[1] - 4.5, S.haunch[1] - 5) + (k === 0 ? -0.5 : 0));
      if (!p.get(x, y + 1)) continue;
      p.set(x, y, BONE, 3); p.set(x + 1, y - 1, BONE, 2);
    }
    p.end();
    // the neck up to the head, the mane behind the head
    p.begin('all', 1);
    capsule(p, S.neck, 4.0, [S.head[0] + 2, S.head[1] + 1], 3.0, HIDE, { hi: 0.35 });
    p.end();
    maneSide(p, S);
    headSide(p, S);
    // near legs over the body
    hindLeg(p, S.HN, true);
    frontLeg(p, S.FN, true);
  }

  /** @returns {SideRig} */
  function sideRig(key) {
    /** @type {SideRig} */
    const S = {
      chest: [19, 24], belly: [28, 23], haunch: [37, 22], neck: [20, 19], head: [11, 14], snout: 188, jaw: 0,
      FN: [[18, 25], [17, 30], [17, 35], [15, 38]], FF: [[21, 25], [22, 30], [22, 35], [20, 38]],
      HN: [[37, 24], [34, 29], [40, 33], [38, 38]], HF: [[40, 23], [38, 29], [43, 33], [42, 38]],
      tail: [[43, 20], [47, 18], [50, 15], [52, 12]],
      flare: 0, flick: 0,
    };
    const mv = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
    const shift = (dx, dy) => {
      for (const k of ['chest', 'belly', 'haunch', 'neck', 'head']) S[k] = [S[k][0] + dx, S[k][1] + dy];
      S.tail = mv(S.tail, dx, dy);
    };
    switch (key) {
      case 'idle1': S.flick = 1; S.chest = [19, 25]; S.neck = [20, 20]; S.head = [11, 15]; break;
      case 'idle2': S.flick = 2; S.tail = [[43, 20], [47, 17], [50, 14], [51, 10]]; break;
      case 'move0': // gallop: gathered
        S.FN = [[18, 25], [20, 29], [23, 33], [24, 37]]; S.FF = [[21, 25], [19, 30], [15, 33], [13, 36]];
        S.HN = [[37, 24], [31, 28], [32, 33], [29, 37]]; S.HF = [[40, 23], [36, 28], [38, 33], [35, 38]];
        shift(0, 1); S.flick = 1; break;
      case 'move1': // extended forward
        S.FN = [[18, 25], [13, 28], [9, 31], [6, 33]]; S.FF = [[21, 25], [16, 29], [12, 33], [10, 36]];
        S.HN = [[37, 24], [37, 29], [43, 33], [45, 37]]; S.HF = [[40, 23], [41, 28], [47, 31], [50, 34]];
        shift(0, -1); S.flick = 2; break;
      case 'move2': // front paws down, hind swinging
        S.FN = [[18, 25], [16, 30], [16, 35], [14, 38]]; S.FF = [[21, 25], [23, 29], [26, 33], [28, 36]];
        S.HN = [[37, 24], [35, 29], [39, 33], [41, 37]]; S.HF = [[40, 23], [36, 28], [36, 33], [33, 37]];
        S.flick = 3; break;
      case 'move3': // airborne gather
        S.FN = [[18, 25], [21, 28], [24, 31], [25, 34]]; S.FF = [[21, 25], [22, 29], [24, 33], [27, 35]];
        S.HN = [[37, 24], [33, 28], [31, 32], [28, 34]]; S.HF = [[40, 23], [36, 28], [35, 32], [31, 35]];
        shift(0, -2); S.flick = 0; break;
      case 'windup': // the bite's coil: head low, jaws open, weight back
        shift(1, 2); S.head = [10, 21]; S.snout = 196; S.jaw = 0.7; S.neck = [20, 22]; S.flare = 1;
        S.FN = [[19, 27], [16, 31], [15, 35], [13, 38]];
        S.HN = [[38, 26], [34, 31], [39, 34], [37, 38]]; S.HF = [[41, 25], [37, 31], [42, 34], [40, 38]];
        break;
      case 'attack': // the snap: lunged forward, jaws closing
        shift(-2, 0); S.head = [8, 18]; S.snout = 184; S.jaw = 0.3; S.neck = [17, 20]; S.flare = 1;
        S.FN = [[16, 25], [12, 29], [10, 33], [8, 37]]; S.FF = [[19, 25], [16, 30], [14, 34], [12, 38]];
        S.HN = [[35, 24], [34, 29], [41, 33], [43, 38]]; S.HF = [[38, 23], [38, 29], [45, 33], [47, 38]];
        break;
      case 'hurt':
        shift(2, 1); S.head = [13, 13]; S.snout = 170; S.jaw = 0.6; S.neck = [22, 19];
        S.FN = [[20, 26], [19, 31], [19, 35], [17, 38]];
        break;
      case 'crouch': // the pounce's coil: haunches low, chest down, ready to spring
        S.chest = [19, 28]; S.belly = [28, 27]; S.haunch = [38, 26]; S.neck = [20, 24]; S.head = [10, 22]; S.snout = 190; S.flare = 1;
        S.FN = [[18, 29], [14, 33], [14, 36], [11, 38]]; S.FF = [[21, 29], [19, 33], [19, 36], [16, 38]];
        S.HN = [[37, 28], [32, 33], [38, 35], [36, 38]]; S.HF = [[40, 27], [35, 33], [42, 35], [40, 38]];
        S.tail = [[44, 25], [48, 25], [51, 23], [54, 21]];
        break;
      case 'leap': // airborne, stretched long, forelegs reaching
        S.chest = [17, 18]; S.belly = [27, 19]; S.haunch = [37, 20]; S.neck = [17, 14]; S.head = [8, 12]; S.snout = 192; S.jaw = 0.5; S.flare = 2;
        S.FN = [[16, 19], [11, 21], [6, 23], [3, 24]]; S.FF = [[19, 19], [14, 22], [9, 25], [6, 27]];
        S.HN = [[36, 22], [40, 25], [46, 26], [50, 28]]; S.HF = [[39, 21], [43, 24], [48, 24], [52, 25]];
        S.tail = [[43, 19], [47, 18], [51, 17], [54, 16]];
        break;
      case 'land':
        shift(-1, 3); S.head = [9, 22]; S.neck = [19, 23]; S.snout = 200; S.flare = 1;
        S.FN = [[17, 28], [14, 32], [13, 36], [10, 38]]; S.FF = [[20, 28], [18, 32], [18, 36], [15, 38]];
        S.HN = [[36, 27], [33, 32], [38, 35], [36, 38]];
        break;
      case 'breathWind': // reared back, head high, the throat glowing, the mane flaring
        shift(2, 0); S.head = [15, 9]; S.snout = 150; S.jaw = 0.5; S.throat = true; S.neck = [22, 17]; S.flare = 2;
        S.FN = [[21, 25], [19, 30], [20, 35], [18, 38]];
        S.HN = [[39, 25], [35, 30], [40, 34], [38, 38]];
        break;
      case 'breath0':
      case 'breath1': // head thrust forward and low, jaws wide, fire pouring out
        shift(-1, 1); S.head = [8, 17]; S.snout = 194; S.jaw = 1; S.throat = true; S.neck = [18, 20]; S.flare = 2;
        S.flick = key === 'breath0' ? 1 : 3;
        S.FN = [[17, 26], [13, 30], [12, 35], [10, 38]];
        S.HN = [[36, 25], [33, 30], [39, 34], [38, 38]];
        break;
      case 'claw0':
      case 'claw1': { // reared up on the hind legs, raking at a wall ahead
        const c1 = key === 'claw1';
        S.chest = [19, 15]; S.belly = [24, 21]; S.haunch = [30, 27]; S.neck = [18, 10]; S.head = [11, 7]; S.snout = 196; S.jaw = c1 ? 0.6 : 0.2; S.flare = 1;
        S.FN = c1 ? [[17, 16], [12, 20], [8, 24], [6, 26]] : [[17, 16], [13, 13], [9, 10], [6, 8]];
        S.FF = c1 ? [[20, 16], [16, 13], [12, 11], [9, 10]] : [[20, 16], [16, 20], [12, 23], [9, 25]];
        S.HN = [[30, 29], [27, 33], [32, 35], [29, 38]]; S.HF = [[33, 28], [31, 33], [35, 35], [33, 38]];
        S.tail = [[35, 29], [40, 31], [45, 32], [49, 30]];
        S.flick = c1 ? 2 : 0;
        break;
      }
      case 'howl':
        shift(1, 1); S.head = [14, 6]; S.snout = 120; S.jaw = 0.6; S.neck = [20, 15]; S.flare = 2;
        S.chest = [20, 24]; S.FN = [[19, 26], [18, 31], [18, 35], [16, 38]];
        S.HN = [[38, 26], [34, 31], [39, 34], [37, 38]];
        break;
      default: break;
    }
    return S;
  }

  // -------------------------------------------------------------------------------------------
  // Front (down) and back (up) views
  // -------------------------------------------------------------------------------------------

  /**
   * A front rig: chest centre, head centre, how low the head hangs, the forelegs (paw x, lift),
   * the hindlegs behind, the jaw, the mane's flare, flicker, reared up (the claw poses), the
   * snout's angle toward the camera (`up`: the howl).
   * @typedef {{ chest: Pt, head: Pt, jaw: number, flare: number, flick: number, fore: number[][],
   *   hind: number[][], rear: boolean, up: boolean, throat: boolean }} FrontRig
   */

  /** @returns {FrontRig} */
  function frontRig(key) {
    /** @type {FrontRig} */
    const R = {
      chest: [28, 26], head: [28, 16], jaw: 0, flare: 0, flick: 0,
      fore: [[24, 0], [32, 0]], hind: [[22, 0], [34, 0]], rear: false, up: false, throat: false,
    };
    switch (key) {
      case 'idle1': R.flick = 1; R.chest = [28, 27]; R.head = [28, 17]; break;
      case 'idle2': R.flick = 2; break;
      case 'move0': R.fore = [[24, 2], [32, 0]]; R.hind = [[22, 0], [34, 1]]; R.flick = 1; break;
      case 'move1': R.chest = [28, 25]; R.head = [28, 15]; R.flick = 2; break;
      case 'move2': R.fore = [[24, 0], [32, 2]]; R.hind = [[22, 1], [34, 0]]; R.flick = 3; break;
      case 'move3': R.chest = [28, 25]; R.head = [28, 15]; break;
      case 'windup': R.head = [28, 22]; R.chest = [28, 28]; R.jaw = 0.7; R.flare = 1; break;
      case 'attack': R.head = [28, 21]; R.chest = [28, 27]; R.jaw = 0.4; R.flare = 1; R.fore = [[23, 1], [33, 1]]; break;
      case 'hurt': R.head = [29, 14]; R.jaw = 0.6; break;
      case 'crouch': R.chest = [28, 30]; R.head = [28, 23]; R.flare = 1; break;
      case 'leap': R.chest = [28, 22]; R.head = [28, 14]; R.jaw = 0.5; R.flare = 2; R.fore = [[22, 4], [34, 4]]; R.hind = [[22, 5], [34, 5]]; break;
      case 'land': R.chest = [28, 29]; R.head = [28, 23]; R.flare = 1; break;
      case 'breathWind': R.head = [28, 12]; R.jaw = 0.5; R.throat = true; R.flare = 2; R.up = true; break;
      case 'breath0': case 'breath1': R.head = [28, 19]; R.chest = [28, 27]; R.jaw = 1; R.throat = true; R.flare = 2; R.flick = key === 'breath0' ? 1 : 3; break;
      case 'claw0': case 'claw1': R.rear = true; R.chest = [28, 18]; R.head = [28, 8]; R.flare = 1; R.jaw = key === 'claw1' ? 0.6 : 0.2;
        R.fore = key === 'claw1' ? [[20, 14], [36, 18]] : [[20, 18], [36, 13]]; R.flick = key === 'claw1' ? 2 : 0; break;
      case 'howl': R.head = [28, 10]; R.jaw = 0.6; R.up = true; R.flare = 2; break;
      default: break;
    }
    return R;
  }

  /** The head facing the camera (front) or away (back). */
  function headFront(p, R, back) {
    const [hx, hy] = R.head;
    // tall ears up and out
    p.begin('all', 0);
    capsule(p, [hx - 3, hy - 2], 1.8, [hx - 6, hy - 8], 0.4, HIDE, { lift: 0, shine: 0.6 });
    capsule(p, [hx + 3, hy - 2], 1.8, [hx + 6, hy - 8], 0.4, HIDE, { lift: -1 });
    p.end();
    p.begin('all', 1);
    body(p, hx, hy, 5, 4, HIDE, { hi: 0.35 });
    p.end();
    if (back) {
      p.begin(null);
      for (let y = hy - 3; y <= hy + 3; y++) p.over(hx, y, DARK, 1);
      p.end();
      return;
    }
    p.begin(null);
    p.over(hx - 4, hy - 4, MOUTH, 2); p.over(hx + 4, hy - 4, MOUTH, 1); // inner ears
    p.end();
    // the long muzzle toward the viewer (foreshortened: a lighter wedge under the eyes; shorter
    // when the head is raised)
    const my = hy + (R.up ? 1.5 : 3);
    p.begin('all', 1);
    capsule(p, [hx, hy + 0.5], 3.0, [hx, my + 0.5], R.up ? 2.2 : 2.6, HIDE, { hi: 0.25, lo: -0.35, shine: 0.7 });
    p.end();
    p.begin(null);
    const ny = Math.round(my - 0.5);
    p.set(hx - 1, ny, DARK, 0); p.set(hx, ny, DARK, 0); p.set(hx - 1, ny - 1, HIDE, 4); // nose
    const jd = Math.round(R.jaw * 3);
    const mo = Math.round(my + 2);
    if (jd > 0) {
      for (let y = mo; y <= mo + jd; y++) for (let x = hx - 2; x <= hx + 1; x++) p.set(x, y, R.throat ? GLOW : MOUTH, R.throat ? (y === mo ? 4 : 3) : (y === mo ? 2 : 1));
      p.set(hx - 2, mo, BONE, 4); p.set(hx + 1, mo, BONE, 3); p.set(hx - 2, mo + jd, BONE, 3); p.set(hx + 1, mo + jd, BONE, 3);
      body(p, hx, mo + jd + 1, 2.2, 1.0, HIDE, { hi: 0.2, lo: -0.5 });
    } else {
      for (let x = hx - 2; x <= hx + 1; x++) p.set(x, mo, DARK, 0);
      p.set(hx - 2, mo + 1, BONE, 4); p.set(hx + 1, mo + 1, BONE, 3);
    }
    // ember eyes slanting under a heavy brow, cracks over the brow
    const ey = Math.round(hy - 1);
    p.set(hx - 4, ey - 1, DARK, 0); p.set(hx - 3, ey - 1, DARK, 0); p.set(hx + 2, ey - 1, DARK, 0); p.set(hx + 3, ey - 1, DARK, 0);
    p.set(hx - 3, ey, GLOW, 4); p.set(hx - 2, ey, GLOW, 3); p.set(hx + 2, ey, GLOW, 4); p.set(hx + 1, ey, GLOW, 3);
    K.crack(p, [[hx, hy - 4], [hx, hy - 2]], 2);
    p.end();
  }

  /** The collar of flame round the head and down the neck (front / back view). */
  function maneFront(p, R, back) {
    const [hx, hy] = R.head;
    const f = R.flare;
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = (-110 + t * 220) * DEG; // round the top of the head, down to the neck's sides
      const x = hx + Math.sin(a) * 6;
      const y = hy - Math.cos(a) * 4 + 2;
      const flick = ((i * 3 + R.flick * 5) % 4) - 1.5;
      const top = Math.cos(a);
      const h = Math.round(3 + f * 1.4 + Math.max(0, top) * 2.5 + (i % 3 === 1 ? 1 : 0) + flick * 0.6);
      tongue(p, x, y, Math.max(2, h), Math.sin(a) * (2.5 + f) + flick * 0.4, 1.1);
    }
    p.begin(null);
    for (let k = -5; k <= 5; k++) p.set(hx + k, Math.round(hy + 4 + Math.abs(k) * -0.4 + (back ? -1 : 0)), GLOW, Math.abs(k) < 3 ? 4 : 3);
    p.end();
  }

  function drawFront(p, R, back) {
    const G = 38;
    const [cx, cy] = R.chest;
    // the hind legs behind / under the body
    if (!R.rear) {
      p.begin(null);
      for (const [x, lift] of R.hind) {
        capsule(p, [x, cy + 3], 2.4, [x, G - 2 - lift], 1.3, DARK, { lift: -1 });
        p.set(x - 1, G - lift, BONE, 1); p.set(x + 1, G - lift, BONE, 1);
      }
      p.end();
    }
    // the body: seen from the front the back runs away behind the head (the camera looks down), the
    // rump a darker hump beyond it; from the back the haunches are in front, the chest beyond
    p.begin('all', 1);
    if (R.rear) {
      body(p, cx, G - 9, 6.5, 5.5, HIDE);
      body(p, cx, cy + 6, 5.5, 6, HIDE);
      body(p, cx, cy, 5.6, 5.8, HIDE, { hi: 0.38 });
    } else if (back) {
      body(p, cx, cy - 4, 5.5, 4, DARK);
      body(p, cx, cy + 2, 7.2, 6.2, HIDE, { hi: 0.38 });
    } else {
      body(p, cx, cy - 5, 6.2, 3.6, DARK);
      body(p, cx, cy + 1, 5.4, 5.2, HIDE, { hi: 0.38 });
    }
    p.end();
    p.begin(null);
    if (!back) {
      crack(p, [[cx - 3, cy - 2], [cx - 1, cy + 1], [cx - 2, cy + 4]], 3);
      crack(p, [[cx + 3, cy - 1], [cx + 2, cy + 3]], 2);
    } else {
      for (let y = Math.round(cy - 4); y <= Math.round(cy + 7); y++) p.over(cx, y, DARK, 1);
      for (let k = 0; k < 4; k++) p.set(cx, Math.round(cy - 4 + k * 3), BONE, 3);
      crack(p, [[cx - 5, cy], [cx - 3, cy + 4]], 2);
      crack(p, [[cx + 4, cy + 1], [cx + 6, cy + 4]], 2);
    }
    p.end();
    if (R.rear) {
      // hind legs planted
      p.begin('all', 1);
      for (const x of [cx - 4, cx + 4]) capsule(p, [x, G - 9], 2.8, [x, G - 1], 1.6, HIDE, { lift: x > cx ? -1 : 0 });
      p.end();
      p.begin(null);
      for (const x of [cx - 4, cx + 4]) { p.set(x - 1, G, BONE, 2); p.set(x + 1, G, BONE, 2); }
      p.end();
    }
    if (back) {
      // the tail hanging behind, its flame tip
      p.begin('all', 1);
      chain(p, [[cx, cy + 5], [cx + 1, cy + 9], [cx + 3, cy + 12]], [1.8, 1.3, 0.8], HIDE);
      p.end();
      tongue(p, cx + 3, cy + 13, 4 + R.flare, 1.5, 0.9);
    }
    // the neck's flame collar and the head
    maneFront(p, R, back);
    headFront(p, R, back);
    // the forelegs (in front, or raised)
    p.begin('all', 1);
    for (const [x, lift] of R.fore) {
      const lit = (x < cx) !== back;
      if (R.rear) capsule(p, [x < cx ? cx - 3 : cx + 3, cy + 1], 2.2, [x, lift], 1.2, HIDE, { lift: lit ? 0 : -1 });
      else {
        const ox = x < cx ? -1 : 1;
        capsule(p, [x - ox, cy + 2], 2.3, [x, cy + 7], 1.5, HIDE, { lift: lit ? 0 : -1 });
        capsule(p, [x, cy + 7], 1.4, [x + ox * 0.5, G - 1 - lift], 1.2, HIDE, { lift: lit ? 0 : -1 });
      }
    }
    p.end();
    p.begin(null);
    for (const [x, lift] of R.fore) {
      const y = R.rear ? lift : G - lift;
      p.set(x - 1, y, BONE, 3); p.set(x, y + (R.rear ? -1 : 0), BONE, 4); p.set(x + 1, y, BONE, 3);
      if (!R.rear) crack(p, [[x, cy + 4], [x, cy + 8]], 2);
    }
    p.end();
  }

  // -------------------------------------------------------------------------------------------

  function drawDead(p, view, G) {
    // on its side, legs out stiff, the mane guttered to embers
    p.begin('all', 1);
    body(p, 30, G - 4, 12, 4.2, HIDE);
    body(p, 17, G - 4, 5, 3.6, HIDE);
    capsule(p, [14, G - 3], 2.4, [7, G - 2], 1.5, HIDE);
    p.end();
    p.begin('all', 0);
    for (const [x0, x1] of [[24, 20], [28, 25], [36, 40], [40, 45]]) capsule(p, [x0, G - 2], 1.6, [x1, G], 1.1, HIDE, { lift: -1 });
    chain(p, [[41, G - 5], [46, G - 4], [50, G - 2]], [1.8, 1.2, 0.7], HIDE);
    p.end();
    p.begin(null);
    K.crack(p, [[24, G - 6], [29, G - 4], [34, G - 6]], 1);
    for (const x of [15, 18, 21]) p.set(x, G - 8, GLOW, 1);
    if (view !== 'up') { p.set(13, G - 5, DARK, 0); p.set(14, G - 5, DARK, 0); }
    p.end();
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    // the rigs are laid out in a 56 × 40 box (ground row 38), drawn 4 px in and 8 px down
    p.ox = OX;
    p.oy = OY;
    if (key === 'dead') drawDead(p, view, f.G - OY);
    else if (view === 'side') drawSide(p, sideRig(key));
    else drawFront(p, frontRig(key), view === 'up');
    if (key === 'hurt') K.shear(p, view === 'side' ? -0.1 : 0.08, f.G);
  }

  return {
    fw: 56 + 2 * OX, fh: 40 + OY,
    columns: [...K.COMMON, 'idle2', 'crouch', 'leap', 'land', 'breathWind', 'breath0', 'breath1', 'claw0', 'claw1', 'howl'],
    aliases: { bite: 'attack', biteWind: 'windup' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.9, 0.75]) },
    idle: { poses: ['idle0', 'idle1', 'idle2', 'idle1'], fps: 6 },
    draw,
    ramps: () => K.makeRamps({
      [HIDE]: K.ramp5(['#0e0a0b', '#1e1617', '#332825', '#54423a', '#86684f']),
      [DARK]: K.ramp5(['#080607', '#110c0d', '#1c1515', '#2a201e', '#3c2e28']),
      [BONE]: K.ramp5(['#5c5244', '#8e826c', '#bfb294', '#ded2b2', '#f8f0d6']),
      [MOUTH]: K.ramp5(['#1c0606', '#3e0c0a', '#6a1612', '#94261a', '#c04428']),
      [GLOW]: K.glowRamp(['#7a1606', '#d2420c', '#ff8a1e', '#ffc24a', '#fff2b0']),
    }, HIDE),
  };
}
