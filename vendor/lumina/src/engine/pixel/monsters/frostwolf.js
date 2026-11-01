/**
 * The Frost Wolf (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): a lean
 * winter wolf ≈ 1.1 u tall at the ears in a 56 × 34 frame (its 48 × 32 layout drawn 4 px in and
 * 2 down: the head thrust out and the muzzle raised stay clear of the clip margin) — pale frost fur
 * (`#dfe8f4` / `#b4c4dc` / `#7d8fbe`) with a darker slate dorsal stripe from the ruff to the tail, a
 * near-white throat and belly, a band of rime two texels deep along the ruff (`#e2fbff` over
 * `#b4c4dc`), a dark muzzle and dark-rimmed ice-blue eyes (glow texels). Pale on purpose: the old
 * slate wolf went near-black at night (review EV-46); the plum outline holds it against the snow by
 * day. Owner: the foes package.
 *
 * Columns: COMMON (`idle0`/`idle1` standing, breathing; `move0`–`move3` a loping run; `windup` the
 * bite's coil — head low, jaws open; `attack` the snap, stretched forward; `hurt`; `dead` on its
 * side) + `guard` / `guard2` (the pack's waiting stance: head low, hackles up, a growl — the kobold's
 * hold), `lungeWind` (crouched to pounce, the hind legs gathered), `lunge` (the leap, stretched, off
 * the ground), `breathWind` (reared back, the chest swelling), `breath` (jaws wide, the head thrust
 * forward), `howl` (the muzzle raised to the sky). The side view faces left (the `right` row mirrors
 * it). Painted like the other monsters; RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

const FW = 56;
const FH = 34;
/** The layout box (48 × 32) sits this far in from the frame's left and top. */
const OX = 4;
const OY = 2;

/**
 * A pose (side view; the front and back views read the same numbers where they apply).
 * @typedef {object} WolfPose
 * @property {number} [by]    body drop (px; + lower)
 * @property {number} [bx]    body shift (px; − forward)
 * @property {number} [hx]    head offset from the neck (px)
 * @property {number} [hy]
 * @property {number} [snout] snout angle (deg below level: + down, − up)
 * @property {number} [jaw]   0 shut, 1 open, 2 wide
 * @property {number[][]} [legs] feet [nearFront, farFront, nearHind, farHind] as [dx, lift]
 * @property {number} [tail]  tail angle (deg below level behind; + down)
 * @property {boolean} [air]  off the ground (the leap): legs stretched fore and aft
 * @property {boolean} [hackles] the ruff and the back bristling
 * @property {number} [eyes]  eye tone (3 default, 4 fierce, 0 shut)
 * @property {number} [ears]  0 up, 1 pinned back
 */

/** @type {Record<string, WolfPose>} */
const POSES = {
  idle0: { tail: 40 },
  idle1: { by: 0.5, hy: 1, tail: 46 },
  move0: { by: -1, legs: [[-3, 1], [2, 0], [3, 0], [-2, 1]], tail: 20, hy: 1 },
  move1: { by: 0, legs: [[0, 0], [-2, 1], [0, 1], [2, 0]], tail: 25, hy: 0 },
  move2: { by: -1, legs: [[3, 0], [-2, 1], [-3, 1], [2, 0]], tail: 20, hy: 1 },
  move3: { by: 0, legs: [[0, 1], [2, 0], [0, 0], [-2, 1]], tail: 25, hy: 0 },
  windup: { by: 2, bx: 1, hx: 1, hy: 3, snout: 15, jaw: 1, legs: [[-1, 0], [1, 0], [2, 0], [0, 0]], tail: 5, hackles: true, eyes: 4, ears: 1 },
  attack: { by: 1, bx: -2, hx: -2, hy: 2, snout: 5, jaw: 2, legs: [[-4, 0], [-2, 0], [2, 0], [4, 0]], tail: 0, eyes: 4, ears: 1 },
  hurt: { by: 0, bx: 2, hx: 2, hy: -2, snout: -20, jaw: 1, legs: [[1, 0], [2, 1], [1, 0], [-1, 0]], tail: 60, eyes: 0, ears: 1 },
  dead: { tail: 0 },
  guard: { by: 2, hy: 3, snout: 10, jaw: 1, legs: [[-1, 0], [1, 0], [1, 0], [-1, 0]], tail: 10, hackles: true, eyes: 4, ears: 1 },
  guard2: { by: 2.5, hy: 4, snout: 12, jaw: 0, legs: [[-1, 0], [1, 0], [1, 0], [-1, 0]], tail: 12, hackles: true, eyes: 4, ears: 1 },
  lungeWind: { by: 3, bx: 2, hx: 1, hy: 3, snout: 8, jaw: 1, legs: [[-2, 0], [0, 0], [-3, 0], [-1, 0]], tail: -5, hackles: true, eyes: 4, ears: 1 },
  lunge: { by: -3, bx: -3, hx: -2, hy: -1, snout: 0, jaw: 2, air: true, tail: -10, eyes: 4, ears: 1 },
  breathWind: { by: 0, bx: 2, hx: 1, hy: -3, snout: -25, jaw: 1, legs: [[0, 0], [2, 0], [2, 0], [0, 0]], tail: 30, eyes: 4 },
  breath: { by: 1, bx: -2, hx: -2, hy: 1, snout: 5, jaw: 2, legs: [[-3, 0], [-1, 0], [2, 0], [3, 0]], tail: 15, eyes: 4, ears: 1 },
  howl: { by: 0, bx: 1, hx: 1, hy: -4, snout: -60, jaw: 1, legs: [[0, 0], [1, 0], [1, 0], [0, 0]], tail: 50, eyes: 3 },
};

const EXTRA = ['guard', 'guard2', 'lungeWind', 'lunge', 'breathWind', 'breath', 'howl'];

const DEG = Math.PI / 180;

/**
 * The Frost Wolf's sheet recipe.
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function frostwolf(K) {
  const { M } = K;
  const FUR = M.FUR;
  const STRIPE = M.FUR2;
  const PALE = M.FUR3;
  const RIME = M.WHITE;
  const NOSE = M.NOSE;
  const BONE = M.BONE;
  const GLOW = M.GLOW;
  const G = FH - 2 - OY;

  /** @param {any} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} mat @param {object} [o] */
  function blob(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.45, lo: -0.2, deep: -0.7, maxShade: 4, ...o });
  }

  /**
   * A leg: from the shoulder / hip down to the paw, a bend at the knee (front) or the hock (hind).
   * @param {any} p @param {number} x top x @param {number} y top y @param {number} fx paw x
   * @param {number} fy paw y @param {boolean} hind @param {number} lift tone shift
   */
  function leg(p, x, y, fx, fy, hind, lift) {
    const kx = hind ? (x + fx) / 2 + 2 : (x + fx) / 2 - 0.5;
    const ky = y + (fy - y) * (hind ? 0.55 : 0.5);
    K.thickLine(p, x, y, kx, ky, hind ? 2.6 : 2, FUR, (t) => Math.max(0, (t < 0.5 ? 2 : 1) + lift));
    K.thickLine(p, kx, ky, fx, fy - 0.5, 1.5, FUR, Math.max(0, 1 + lift));
    p.set(Math.round(fx - 1), Math.round(fy), FUR, Math.max(0, 2 + lift));
    p.set(Math.round(fx), Math.round(fy), FUR, Math.max(0, 1 + lift));
    p.set(Math.round(fx - 2), Math.round(fy), BONE, 1); // a claw
  }

  /**
   * The head in profile (facing left): skull, a tapering muzzle along `snout`, the jaw, ears, eye.
   * @param {any} p @param {number} hx @param {number} hy skull centre @param {WolfPose} P
   */
  function headSide(p, hx, hy, P) {
    const a = (P.snout ?? 0) * DEG;
    const dx = -Math.cos(a);
    const dy = Math.sin(a);
    const jaw = P.jaw ?? 0;
    // ears (behind the skull)
    p.begin('all', 0);
    const pin = P.ears ? 2 : 0;
    K.fillPoly(p, [[hx + 0.5, hy - 2], [hx + 2.5 + pin, hy - 6.5 + pin * 1.5], [hx + 3.5, hy - 1.5]], FUR, 1);
    K.fillPoly(p, [[hx - 1.5, hy - 2.2], [hx - 0.5 + pin, hy - 7 + pin * 1.5], [hx + 1.5, hy - 2]], FUR, 3);
    p.end();
    // the skull
    p.begin('all', 0);
    blob(p, hx, hy, 3.6, 3.1, FUR);
    p.end();
    // the muzzle: upper jaw along the snout, the lower jaw dropping when open
    p.begin('all', 0);
    const tip = [hx + dx * 7, hy + dy * 7 + 0.5];
    K.thickLine(p, hx + dx * 1.5, hy + dy * 1.5 + 0.3, hx + dx * 4.5, hy + dy * 4.5 + 0.4, 2.8, FUR, 3);
    // (the muzzle's front half dark: the pale wolf's face reads by it)
    K.thickLine(p, hx + dx * 4.5, hy + dy * 4.5 + 0.4, tip[0], tip[1] - 0.2, 1.9, STRIPE, 2);
    p.end();
    p.begin('all', 0);
    const drop = jaw === 2 ? 3 : jaw === 1 ? 1.6 : 0.6;
    K.thickLine(p, hx + dx * 1.5, hy + dy * 1.5 + 2, tip[0] + dx * -1.2, tip[1] + 0.8 + drop, 1.1, PALE, 1);
    p.end();
    p.begin(null);
    // the nose, the mouth's line, teeth when open
    p.set(Math.round(tip[0] - 0.5), Math.round(tip[1] - 1), NOSE, 1);
    p.set(Math.round(tip[0] + 0.5), Math.round(tip[1] - 1), NOSE, 2);
    if (jaw) {
      for (let k = 1; k <= 4; k++) {
        const x = Math.round(tip[0] - dx * k);
        const y = Math.round(tip[1] - dy * k + 0.5 + drop * 0.5);
        p.set(x, y, NOSE, 0);
      }
      p.set(Math.round(tip[0] - dx * 1.5), Math.round(tip[1] + 0.5), BONE, 4); // the fangs
      p.set(Math.round(tip[0] - dx * 1.5), Math.round(tip[1] + 0.5 + drop), BONE, 3);
    }
    // the eye: pale ice, glowing, under a dark brow
    const e = P.eyes ?? 3;
    const ex = Math.round(hx - 1.5 + dx * 0.5);
    const ey = Math.round(hy - 1);
    if (e) {
      p.set(ex, ey, GLOW, e);
      if (e >= 4) p.set(ex + 1, ey, GLOW, 2);
    } else p.set(Math.round(hx - 1.5), ey, STRIPE, 0);
    for (const x of [ex, ex + 1]) if (p.get(x, ey - 1) === FUR) p.set(x, ey - 1, STRIPE, x === ex ? 0 : 1);
    // pale cheek fur
    p.over(Math.round(hx + 0.5), Math.round(hy + 2), PALE, 2);
    p.over(Math.round(hx - 0.5), Math.round(hy + 2), PALE, 3);
    p.end();
  }

  /**
   * The bushy tail from the rump, `ang` below level behind.
   * @param {any} p @param {number} x @param {number} y @param {number} ang @param {number} dir +1 behind = right
   */
  function tail(p, x, y, ang, dir) {
    const a = ang * DEG;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const aa = a + t * 0.5;
      pts.push([x + dir * Math.cos(aa) * 9 * t, y + Math.sin(aa) * 9 * t]);
    }
    p.begin('all', 0);
    for (let i = 0; i < 5; i++) {
      const w = 3.6 - i * 0.35;
      K.thickLine(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, i >= 4 ? STRIPE : FUR, (t) => (i < 2 ? 2 : 1));
    }
    p.end();
    p.begin(null);
    for (let i = 1; i < 4; i++) p.over(Math.round(pts[i][0]), Math.round(pts[i][1] - 1), STRIPE, 1);
    p.end();
  }

  /** Rime in the fur: frost-white tips on the upper edge of the ruff and the back. @param {any} p @param {number} x0 @param {number} x1 */
  function rime(p, x0, x1) {
    // (a frosted crest over the ruff — contiguous, pale blue at its ends — not a row of studs)
    p.begin(null);
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < FH; y++) {
        const m = p.get(x, y);
        if (m === FUR || m === STRIPE) {
          const end = x === x0 || x === x1;
          p.set(x, y, RIME, end ? 1 : x < (x0 + x1) / 2 ? 3 : 2);
          break;
        }
        if (m) break;
      }
    }
    p.end();
  }

  /**
   * The side view (facing left).
   * @param {any} p @param {WolfPose} P
   */
  function drawSide(p, P) {
    const by = P.by ?? 0;
    const bx = P.bx ?? 0;
    const legs = P.legs ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    const air = !!P.air;
    const body = [25 + bx, 19 + by];
    const chest = [18 + bx, 19.5 + by];
    const neck = [14 + bx + (P.hx ?? 0) * 0.4, 15 + by + (P.hy ?? 0) * 0.5];
    const head = [10 + bx + (P.hx ?? 0), 12 + by + (P.hy ?? 0)];
    const rump = [33 + bx, 17 + by];
    // far legs and the tail behind
    tail(p, rump[0] + 1, rump[1] - 1, P.tail ?? 30, 1);
    p.begin('all', 0);
    if (air) {
      leg(p, chest[0] + 2, chest[1] + 2, chest[0] - 7, chest[1] + 5, false, -1);
      leg(p, rump[0] - 1, rump[1] + 3, rump[0] + 9, rump[1] + 6, true, -1);
    } else {
      leg(p, chest[0] + 2, chest[1] + 2, 20 + bx + legs[1][0], G - legs[1][1], false, -1);
      leg(p, rump[0] - 1, rump[1] + 3, 32 + bx + legs[3][0], G - legs[3][1], true, -1);
    }
    p.end();
    // the body: barrel, deep chest, haunch
    p.begin('all', 0);
    blob(p, body[0], body[1], 9.2, 4.3, FUR);
    blob(p, chest[0], chest[1], 5.2, 5.0, FUR);
    blob(p, rump[0] - 1, rump[1] + 1, 4.4, 4.2, FUR);
    p.end();
    p.begin(null);
    // the pale belly and throat
    for (let x = Math.round(chest[0] - 3); x <= Math.round(body[0] + 6); x++) {
      for (let y = Math.round(body[1] + 2); y <= Math.round(body[1] + 5); y++) if (p.get(x, y) === FUR && !p.get(x, y + 1)) p.set(x, y, PALE, 1);
    }
    for (let y = Math.round(chest[1] - 1); y <= Math.round(chest[1] + 4); y++) p.over(Math.round(chest[0] - 4), y, PALE, 2);
    p.end();
    // the ruff: a thick mane round the neck
    p.begin('all', 0);
    blob(p, neck[0], neck[1], 4.4, 4.8, FUR, { hi: 0.3 });
    p.end();
    // the dorsal stripe: from the ruff along the back to the tail
    p.begin(null);
    for (let x = Math.round(neck[0] - 1); x <= Math.round(rump[0] + 2); x++) {
      for (let y = 0; y < FH; y++) {
        if (p.get(x, y) === FUR) {
          p.set(x, y, STRIPE, 1);
          if (p.get(x, y + 1) === FUR) p.set(x, y + 1, STRIPE, P.hackles && x % 2 ? 2 : 0);
          break;
        }
      }
    }
    if (P.hackles) for (let x = Math.round(neck[0] - 1); x <= Math.round(body[0]); x += 2) {
      for (let y = 0; y < FH; y++) if (p.get(x, y)) { if (!p.get(x, y - 1)) p.set(x, y - 1, STRIPE, 1); break; }
    }
    p.end();
    // near legs
    p.begin('sides', 0);
    if (air) {
      leg(p, chest[0], chest[1] + 2, chest[0] - 10, chest[1] + 3, false, 0);
      leg(p, rump[0] - 2, rump[1] + 3, rump[0] + 11, rump[1] + 4, true, 0);
    } else {
      leg(p, chest[0], chest[1] + 2, 18 + bx + legs[0][0], G - legs[0][1], false, 0);
      leg(p, rump[0] - 2, rump[1] + 3, 30 + bx + legs[2][0], G - legs[2][1], true, 0);
    }
    p.end();
    headSide(p, head[0], head[1], P);
    rime(p, Math.round(neck[0] - 3), Math.round(neck[0] + 3));
  }

  /**
   * The front (facing the viewer) or back view.
   * @param {any} p @param {WolfPose} P @param {boolean} back
   */
  function drawFront(p, P, back) {
    const by = P.by ?? 0;
    const cx = 24;
    const legs = P.legs ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    const lift = (i) => (P.air ? 3 : legs[i][1]);
    const hy = 12 + by + (P.hy ?? 0) * 0.7;
    if (!back) {
      // behind: the back's hump, the hind legs, the tail's tip
      p.begin('all', 0);
      blob(p, cx, 17 + by, 6.2, 3.6, FUR);
      p.end();
      p.begin(null);
      for (let x = cx - 1; x <= cx; x++) p.over(x, Math.round(14 + by), STRIPE, 1);
      p.end();
      p.begin('all', 0);
      leg(p, cx - 5, 20 + by, cx - 5.5, G - lift(2) - 1, false, -1);
      leg(p, cx + 5, 20 + by, cx + 5.5, G - lift(3) - 1, false, -1);
      p.end();
      // the chest and the front legs
      p.begin('all', 0);
      blob(p, cx, 20 + by, 5.4, 5.2, FUR);
      p.end();
      p.begin(null);
      for (let y = Math.round(18 + by); y <= Math.round(24 + by); y++) for (let x = cx - 2; x <= cx + 1; x++) p.over(x, y, PALE, y < 21 + by ? 3 : 2);
      p.end();
      p.begin('sides', 0);
      leg(p, cx - 2.5, 23 + by, cx - 2.5 + legs[0][0] * 0.2, G - lift(0), false, 0);
      leg(p, cx + 2.5, 23 + by, cx + 3.5 + legs[1][0] * 0.2, G - lift(1), false, -1);
      p.end();
      // the ruff and the head, the muzzle toward the viewer
      p.begin('all', 0);
      blob(p, cx, hy + 4, 6, 4.4, FUR, { hi: 0.3 });
      p.end();
      const pin = P.ears ? 1.5 : 0;
      p.begin('all', 0);
      K.fillPoly(p, [[cx - 4, hy - 1], [cx - 4.5 - pin, hy - 7.5 + pin], [cx - 1.5, hy - 2.5]], FUR, 3);
      K.fillPoly(p, [[cx + 4, hy - 1], [cx + 4.5 + pin, hy - 7.5 + pin], [cx + 1.5, hy - 2.5]], FUR, 1);
      blob(p, cx, hy, 3.9, 3.4, FUR);
      p.end();
      p.begin(null);
      // the dark stripe down the brow, the muzzle (pale), the nose; the jaws when open
      p.over(cx - 1, hy - 3, STRIPE, 1);
      p.over(cx, hy - 3, STRIPE, 0);
      p.over(cx - 1, hy - 2, STRIPE, 1);
      const jaw = P.jaw ?? 0;
      const up = (P.snout ?? 0) < -30;
      if (!up) {
        // the muzzle, foreshortened toward the viewer: dark, narrowing, the nose at its end
        for (let y = hy; y <= hy + 4; y++) for (let x = cx - 2; x <= cx + 1; x++) {
          if (y > hy + 2 && (x === cx - 2 || x === cx + 1)) continue;
          p.set(x, Math.round(y), STRIPE, x < cx ? 3 : 2);
        }
        p.set(cx - 1, Math.round(hy + 4), NOSE, 1);
        p.set(cx, Math.round(hy + 4), NOSE, 2);
        if (jaw) {
          for (let x = cx - 2; x <= cx + 1; x++) p.set(x, Math.round(hy + 5), NOSE, 0);
          p.set(cx - 2, Math.round(hy + 5), BONE, 4);
          p.set(cx + 1, Math.round(hy + 5), BONE, 3);
          if (jaw === 2) for (let x = cx - 1; x <= cx; x++) p.set(x, Math.round(hy + 6), NOSE, 0);
        }
      } else {
        // the muzzle raised: the throat shows, the nose high
        for (let y = hy - 4; y <= hy - 2; y++) for (let x = cx - 1; x <= cx; x++) p.set(x, Math.round(y), PALE, 3);
        p.set(cx - 1, Math.round(hy - 5), NOSE, 1);
        p.set(cx, Math.round(hy - 5), NOSE, 2);
        for (let y = hy; y <= hy + 3; y++) p.over(cx - 1, Math.round(y), PALE, 3);
      }
      const e = P.eyes ?? 3;
      // (dark brows over the eyes)
      for (const x of [cx - 3, cx + 2]) if (p.get(x, Math.round(hy - 2)) === FUR) p.set(x, Math.round(hy - 2), STRIPE, 0);
      if (e) {
        p.set(cx - 3, Math.round(hy - 1), GLOW, e);
        p.set(cx + 2, Math.round(hy - 1), GLOW, Math.max(1, e - 1));
      } else {
        p.set(cx - 3, Math.round(hy - 1), STRIPE, 0);
        p.set(cx + 2, Math.round(hy - 1), STRIPE, 0);
      }
      p.end();
      rime(p, cx - 4, cx + 3);
      return;
    }
    // back view: the head and ears beyond, the back with its stripe, the rump, the tail, hind legs
    p.begin('all', 0);
    const pin = P.ears ? 1.5 : 0;
    K.fillPoly(p, [[cx - 4, hy], [cx - 4.5 - pin, hy - 5.5 + pin], [cx - 1, hy - 1.5]], FUR, 2);
    K.fillPoly(p, [[cx + 4, hy], [cx + 4.5 + pin, hy - 5.5 + pin], [cx + 1, hy - 1.5]], FUR, 1);
    blob(p, cx, hy + 1, 4, 3.2, FUR);
    p.end();
    p.begin('all', 0);
    leg(p, cx - 3, 21 + by, cx - 3.5, G - lift(1) - 2, false, -1);
    leg(p, cx + 3, 21 + by, cx + 3.5, G - lift(0) - 2, false, -1);
    blob(p, cx, 16 + by, 6, 4.2, FUR);
    p.end();
    p.begin('all', 0);
    blob(p, cx, 20.5 + by, 6.4, 4.6, FUR);
    p.end();
    p.begin(null);
    for (let y = Math.round(12 + by); y <= Math.round(19 + by); y++) { p.over(cx - 1, y, STRIPE, 1); p.over(cx, y, STRIPE, 0); }
    p.end();
    p.begin('sides', 0);
    leg(p, cx - 4.5, 23 + by, cx - 5 + legs[2][0] * 0.2, G - lift(2), true, 0);
    leg(p, cx + 4.5, 23 + by, cx + 5 + legs[3][0] * 0.2, G - lift(3), true, -1);
    p.end();
    // the tail hanging down the middle (raised in the howl / the hurt)
    const ta = P.tail ?? 30;
    p.begin('all', 0);
    const tl = ta < 15 ? -1 : 1;
    K.thickLine(p, cx, 19 + by, cx + 0.5, 19 + by + tl * 6, 3.4, FUR, 2);
    K.thickLine(p, cx + 0.5, 19 + by + tl * 6, cx + 1, 19 + by + tl * 8.5, 2.4, STRIPE, 1);
    p.end();
    rime(p, cx - 3, cx + 2);
  }

  /**
   * Dead: on its side, the legs stiff, the eye dark, rime settling.
   * @param {any} p @param {string} view
   */
  function drawDead(p, view) {
    const f = view === 'up' ? -1 : 1;
    const X = (x) => 24 + (x - 24) * f;
    p.begin('all', 0);
    K.thickLine(p, X(33), 27, X(41), 28.5, 3, FUR, 1);
    p.end();
    p.begin('all', 0);
    leg(p, X(19), 26, X(13), 23, false, -1);
    leg(p, X(30), 26, X(36), 23, true, -1);
    blob(p, 25, 26.5, 9.5, 3.4, FUR);
    blob(p, X(14), 26.5, 3.6, 3, FUR);
    K.thickLine(p, X(12), 27, X(6), 28, 2.4, FUR, 2);
    p.end();
    p.begin(null);
    for (let x = 18; x <= 32; x++) p.over(x, 24, STRIPE, 1);
    for (let x = 17; x <= 31; x++) p.over(x, 29, PALE, 1);
    p.set(X(13), 26, STRIPE, 0);
    p.set(X(6), 27, NOSE, 1);
    for (const x of [16, 20, 25, 29]) p.over(x, 23, RIME, 3);
    p.end();
  }

  /**
   * @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} _f
   */
  function draw(p, view, key, _f) {
    p.ox = OX;
    p.oy = OY;
    const P = POSES[key] ?? POSES.idle0;
    if (key === 'dead') drawDead(p, view);
    else if (view === 'side') drawSide(p, P);
    else drawFront(p, P, view === 'up');
  }

  return {
    fw: FW, fh: FH, columns: [...K.COMMON, ...EXTRA],
    // (the kobold's pack brain shows `windup` / `attack` for its jab, `lungeWind` / `lunge`, `guard`)
    aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.3, 0.55]) },
    idle: { poses: ['idle0', 'idle1'], fps: 2 },
    draw,
    ramps: () => K.makeRamps({
      [FUR]: K.ramp5(['#56679a', '#7d8fbe', '#b4c4dc', '#dfe8f4', '#f2f6fb']),
      [STRIPE]: K.ramp5(['#2c385a', '#44537c', '#5f71a2', '#7788b5', '#92a1c9']),
      [PALE]: K.ramp5(['#a2b0cc', '#c6d2e6', '#e4ecf6', '#f2f6fb', '#ffffff']),
      [RIME]: K.ramp5(['#9fb2d2', '#b4c4dc', '#cfe4f2', '#e2fbff', '#f6ffff']),
      [NOSE]: K.ramp5(['#06070b', '#0d0f16', '#171a24', '#252a36', '#363c4a']),
      [BONE]: K.ramp5(['#7c7a74', '#a8a69e', '#cfcdc4', '#ebe9e0', '#ffffff']),
      [GLOW]: K.glowRamp(['#1a5e74', '#3a9cbc', '#7cd8f2', '#bff2ff', '#f0ffff']),
    }, FUR),
  };
}
