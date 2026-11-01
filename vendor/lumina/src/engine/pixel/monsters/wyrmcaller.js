/**
 * Wyrmcult Pyromancer — a cultist of the dragon in Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7): a tall hooded robe of ember crimson over black,
 * brass-trimmed, a scaled mantle, a bone dragon-skull mask with swept horns and ember eyes, a sash of
 * talismans, and a gnarled staff whose dragon-claw head grips a burning orb. ≈ 2.1 u tall in a
 * 56 × 56 frame (the contract's 40 × 40 had no room for the staff and its flame raised over the
 * horns).
 * Owner: the brutes package.
 *
 * Columns: COMMON (`windup` = the staff raised, fire gathering; `attack` = the fireball flung) and
 * `idle2` (the staff's flame flickers over `idle0` `idle1` `idle2`), `channel` (both arms high — the
 * pillars), `blink` (wrapped in the robe, sinking) and `throw` (an overhand fling at a roof). Each
 * pose is a rig painted from shaded capsules and polygons lit from the upper left. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number]} Pt */

const LX = -0.55, LY = -0.8;
/** The rigs' 48 × 48 layout box sits this far in from the frame's left and top (the frame is 56 × 56). */
const OX = 4, OY = 8;

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function wyrmcaller(K) {
  const { M } = K;
  const ROBE = M.TOP, DARK = M.BOTTOM, TRIM = M.GOLD, MANTLE = M.FUR2, BONE = M.BONE, WOOD = M.WOOD, GLOW = M.GLOW, SKIN = M.SKIN, SASH = M.SASH;

  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { hi = 0.42, lo = -0.22, deep = -0.72, lift = 0, max = 4 } = o;
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
        if (dx * dx + dy * dy > r * r) continue;
        const l = (dx * LX + dy * LY) / Math.max(0.5, r);
        const s = l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0;
        p.set(x, y, mat, Math.max(0, Math.min(max, s + lift)));
      }
    }
  }
  function body(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.42, lo: -0.25, deep: -0.75, ...o });
  }

  /** A flame tongue (glow) rising from (x, y), `h` tall, leaning `lean` px at the tip. */
  function tongue(p, x, y, h, lean, w = 1) {
    for (let k = 0; k < h; k++) {
      const t = k / Math.max(1, h - 1);
      const cx = x + lean * t * t;
      const hw = w * (1 - t);
      const core = t < 0.45 ? 4 : t < 0.75 ? 3 : 2;
      const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
      for (let px = x0; px <= x1; px++) p.set(px, y - k, GLOW, (px === x0 || px === x1) && x1 > x0 ? Math.max(1, core - 2) : core);
    }
  }

  /**
   * The staff from its foot to its head: gnarled dark wood, a brass ferrule, a dragon-claw head
   * gripping an ember orb, and the orb's flame (`flame` 0 calm … 2 roaring; `flick` its phase).
   */
  function staff(p, foot, head, flame, flick) {
    const [fx, fy] = foot, [hx, hy] = head;
    p.begin('all', 0);
    capsule(p, foot, 0.9, head, 1.1, WOOD, { lift: 0 });
    p.end();
    // knots along the shaft
    p.begin(null);
    for (const t of [0.3, 0.55, 0.78]) p.set(Math.round(fx + (hx - fx) * t + 1), Math.round(fy + (hy - fy) * t), WOOD, 1);
    p.set(Math.round(hx + (fx - hx) * 0.08), Math.round(hy + (fy - hy) * 0.08) + 1, TRIM, 3); // brass collar
    p.end();
    // the claw: three bone talons curling round the orb
    p.begin('all', 0);
    capsule(p, [hx - 2, hy + 1], 0.7, [hx - 2.5, hy - 3], 0.5, BONE, { lift: 1 });
    capsule(p, [hx + 2, hy + 1], 0.7, [hx + 2.5, hy - 3], 0.5, BONE, { lift: 0 });
    p.end();
    // the orb and its fire
    p.begin(null);
    body(p, hx, hy - 2, 2.0, 2.0, GLOW, { hi: 0.2, lo: -0.4, maxShade: 4, minShade: 2 });
    p.set(Math.round(hx - 1), Math.round(hy - 3), GLOW, 4);
    p.end();
    const f = flame;
    tongue(p, hx, hy - 3, 4 + f * 2 + (flick % 2), 1 + (flick === 2 ? -1 : 0), 1.3);
    tongue(p, hx - 2, hy - 2, 2 + f + ((flick + 1) % 2), -1, 0.8);
    tongue(p, hx + 2, hy - 2, 2 + f + (flick % 3 === 1 ? 1 : 0), 1.5, 0.8);
  }

  // -------------------------------------------------------------------------------------------
  // Rigs
  // -------------------------------------------------------------------------------------------

  /**
   * A pose: body sway / drop, the hood, the near (staff) arm's shoulder → hand and the staff's foot
   * and head, the free arm, the flame's strength and flicker. Front coordinates (48 × 48, the
   * cultist facing the viewer, the staff in its right hand on the screen's left); side coordinates
   * for the side view (facing left).
   * @typedef {{ drop: number, sway: number, head: Pt, armS: Pt[], staff: Pt[]|null, armF: Pt[],
   *   flame: number, flick: number, wrap: boolean, hem: number }} Rig
   */

  /** @returns {Rig} */
  function frontRig(key) {
    /** @type {Rig} */
    const R = {
      drop: 0, sway: 0, head: [24, 14],
      armS: [[18, 22], [14, 28], [14, 31]], staff: [[13, 46], [12, 9]],
      armF: [[30, 22], [33, 28], [31, 33]],
      flame: 0, flick: 0, wrap: false, hem: 0,
    };
    switch (key) {
      case 'idle1': R.drop = 1; R.flick = 1; R.armS = [[18, 23], [14, 29], [14, 32]]; R.armF = [[30, 23], [33, 29], [31, 34]]; break;
      case 'idle2': R.flick = 2; break;
      case 'move0': R.sway = 1; R.hem = 1; R.flick = 1; break;
      case 'move1': R.drop = 1; R.flick = 2; break;
      case 'move2': R.sway = -1; R.hem = -1; R.flick = 0; break;
      case 'move3': R.drop = 1; R.flick = 1; break;
      case 'windup':
        // the staff raised high in both hands, fire gathering in the orb
        R.head = [24, 15]; R.armS = [[18, 22], [13, 18], [15, 13]]; R.staff = [[17, 32], [13, 7]];
        R.armF = [[30, 22], [29, 16], [20, 15]]; R.flame = 2; break;
      case 'attack':
        // the fireball flung: the staff thrust out to the side, the free hand open after it
        R.armS = [[18, 22], [12, 25], [8, 24]]; R.staff = [[15, 33], [4, 15]];
        R.armF = [[30, 22], [35, 24], [39, 22]]; R.flame = 1; break;
      case 'hurt': R.head = [25, 13]; R.drop = -1; R.armS = [[18, 22], [13, 27], [12, 30]]; R.staff = [[10, 45], [14, 9]]; break;
      case 'channel':
        // both arms high, the staff upright overhead: the pillars rise
        R.head = [24, 14]; R.armS = [[18, 22], [14, 16], [17, 11]]; R.staff = [[18, 28], [17, 7]];
        R.armF = [[30, 22], [34, 16], [31, 11]]; R.flame = 2; R.flick = 1; break;
      case 'blink':
        // wrapped in the robe, sinking low, the staff held close
        R.drop = 6; R.wrap = true; R.head = [24, 21]; R.armS = [[19, 28], [18, 33], [20, 35]]; R.staff = [[17, 46], [16, 18]];
        R.armF = [[29, 28], [28, 33], [25, 35]]; break;
      case 'throw':
        // an overhand fling: the free arm high forward, the staff back
        R.armF = [[30, 22], [32, 14], [36, 8]]; R.armS = [[18, 22], [13, 27], [11, 31]]; R.staff = [[8, 45], [15, 10]]; R.flame = 1; break;
      default: break;
    }
    return R;
  }

  /** @returns {Rig} */
  function sideRig(key) {
    /** @type {Rig} */
    const R = {
      drop: 0, sway: 0, head: [21, 14],
      armS: [[22, 22], [20, 28], [17, 31]], staff: [[15, 46], [14, 8]],
      armF: [[26, 22], [28, 28], [26, 32]],
      flame: 0, flick: 0, wrap: false, hem: 0,
    };
    switch (key) {
      case 'idle1': R.drop = 1; R.flick = 1; R.armS = [[22, 23], [20, 29], [17, 32]]; break;
      case 'idle2': R.flick = 2; break;
      case 'move0': R.hem = 2; R.flick = 1; R.staff = [[12, 46], [14, 8]]; break;
      case 'move1': R.drop = 1; R.flick = 2; R.hem = 1; break;
      case 'move2': R.hem = -2; R.staff = [[17, 46], [14, 8]]; break;
      case 'move3': R.drop = 1; R.flick = 1; R.hem = -1; break;
      case 'windup':
        R.head = [22, 15]; R.armS = [[22, 22], [22, 16], [22, 12]]; R.staff = [[27, 32], [20, 7]]; R.flame = 2;
        R.armF = [[26, 22], [26, 16], [23, 12]]; break;
      case 'attack':
        R.head = [19, 15]; R.armS = [[21, 22], [15, 23], [10, 22]]; R.staff = [[18, 28], [3, 17]]; R.flame = 1;
        R.armF = [[25, 22], [21, 26], [16, 27]]; break;
      case 'hurt': R.head = [23, 13]; R.drop = -1; R.armS = [[23, 22], [22, 28], [20, 31]]; R.staff = [[19, 46], [17, 9]]; break;
      case 'channel':
        R.armS = [[22, 22], [19, 16], [19, 11]]; R.staff = [[20, 29], [18, 7]]; R.armF = [[26, 22], [27, 16], [24, 11]]; R.flame = 2; R.flick = 1; break;
      case 'blink':
        R.drop = 6; R.wrap = true; R.head = [21, 21]; R.armS = [[22, 28], [20, 33], [18, 35]]; R.staff = [[17, 46], [17, 19]];
        R.armF = [[26, 28], [24, 33], [21, 35]]; break;
      case 'throw':
        R.armF = [[25, 22], [20, 14], [14, 9]]; R.armS = [[22, 22], [24, 28], [25, 31]]; R.staff = [[28, 46], [22, 9]]; R.flame = 1; break;
      default: break;
    }
    return R;
  }

  // -------------------------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------------------------

  /** A wide bell sleeve with a bony hand: shoulder → elbow → hand. */
  function sleeve(p, A, lit) {
    const [s, e, h] = A;
    const lift = lit ? 0 : -1;
    p.begin('all', 1);
    capsule(p, s, 2.6, e, 2.4, ROBE, { lift });
    capsule(p, e, 2.4, h, 3.0, ROBE, { lift });
    p.end();
    // the brass cuff at the sleeve's mouth, the hand out of it
    const vx = h[0] - e[0], vy = h[1] - e[1], l = Math.hypot(vx, vy) || 1;
    p.begin(null);
    for (let k = -3; k <= 3; k++) {
      const x = Math.round(h[0] - (vy / l) * k * 0.8), y = Math.round(h[1] + (vx / l) * k * 0.8);
      if (p.get(x, y)) p.set(x, y, TRIM, k < 0 ? 3 : 2);
    }
    p.end();
    p.begin('all', 0);
    body(p, h[0] + (vx / l) * 1.8, h[1] + (vy / l) * 1.8, 1.4, 1.3, SKIN, { hi: 0.3 });
    p.end();
  }

  /** The hood and the horned dragon-skull mask (front: `side` 0; side view: facing left; `back`). */
  function head(p, R, view) {
    const [hx, hy0] = R.head;
    const hy = hy0 + R.drop;
    const side = view === 'side', back = view === 'up';
    // horns sweeping back from the mask's brow, behind the hood's rim
    p.begin('all', 0);
    if (side) {
      capsule(p, [hx + 1, hy - 3], 1.3, [hx + 6, hy - 6], 0.9, BONE, { lift: -1 });
      capsule(p, [hx + 6, hy - 6], 0.9, [hx + 9, hy - 4], 0.4, BONE, { lift: -1 });
    } else {
      for (const sx of [-1, 1]) {
        capsule(p, [hx + sx * 3, hy - 3], 1.3, [hx + sx * 6, hy - 7], 0.9, BONE, { lift: sx < 0 ? 0 : -1 });
        capsule(p, [hx + sx * 6, hy - 7], 0.9, [hx + sx * 7, hy - 10], 0.4, BONE, { lift: sx < 0 ? 0 : -1 });
      }
    }
    p.end();
    // the hood
    p.begin('all', 1);
    body(p, hx + (side ? 1 : 0), hy - 0.5, 4.6, 4.8, ROBE, { hi: 0.35 });
    p.end();
    if (back) {
      p.begin(null);
      for (let y = hy - 3; y <= hy + 4; y++) p.over(hx, y, DARK, 1); // the hood's seam
      p.end();
      return;
    }
    // the mask: a bone dragon skull under the hood's shadow, a short snout, ember eyes
    p.begin('all', 0);
    if (side) {
      body(p, hx - 1, hy + 0.5, 2.8, 3, BONE, { hi: 0.25, lo: -0.4 });
      capsule(p, [hx - 2, hy + 1.5], 1.6, [hx - 5, hy + 2.5], 1.1, BONE, { lift: 0 });
    } else {
      body(p, hx, hy + 0.8, 3, 3.2, BONE, { hi: 0.25, lo: -0.4 });
      capsule(p, [hx, hy + 2], 1.6, [hx, hy + 4], 1.2, BONE, { lift: 0 });
    }
    p.end();
    p.begin(null);
    // the hood's shadow over the brow
    for (let x = hx - 3; x <= hx + 3; x++) p.over(side ? x - 1 : x, hy - 2, ROBE, 0);
    if (side) {
      p.set(hx - 2, hy, GLOW, 4); p.set(hx - 1, hy, BONE, 0);
      p.set(hx - 5, hy + 3, BONE, 4); // fang
      p.set(hx - 4, hy + 2, BONE, 1); // nostril
    } else {
      // dark sockets round the ember eyes, the nasal ridge, nostrils and fangs
      for (const ex of [hx - 2, hx + 1]) { p.set(ex, hy - 1, BONE, 0); p.set(ex + (ex < hx ? -1 : 1), hy, BONE, 0); p.set(ex, hy + 1, BONE, 1); }
      p.set(hx - 2, hy, GLOW, 4); p.set(hx + 1, hy, GLOW, 3);
      p.set(hx - 1, hy + 1, BONE, 4);
      p.set(hx - 1, hy + 3, BONE, 0); p.set(hx, hy + 3, BONE, 0); // nostrils
      p.set(hx - 2, hy + 4, BONE, 4); p.set(hx + 1, hy + 4, BONE, 3); // fangs
    }
    p.end();
  }

  /** The robe: a long tapering bell from the shoulders to the hem, the mantle, the sash and its talismans. */
  function robe(p, R, view) {
    const G = 46;
    const side = view === 'side', back = view === 'up';
    const d = R.drop;
    const cx = (side ? 23 : 24) + R.sway * 0.5;
    const top = 20 + d;
    const hw = R.wrap ? 9 : side ? 7.5 : 9;
    const hemL = cx - hw - (side ? 0 : 0) + Math.min(0, R.hem);
    const hemR = cx + hw + (side ? 2 : 0) + Math.max(0, R.hem);
    // the robe's bell (dark lining at the hem)
    p.begin('all', 1);
    K.fillPoly(p, [[cx - 3.5, top], [cx + 3.5, top], [cx + 5, top + 8], [hemR, G], [hemL, G], [cx - 5, top + 8]], ROBE, (x, y) => {
      const u = (x + 0.5 - cx) / (hw + 1);
      // folds: darker grooves, a lit left half
      const fold = Math.abs(Math.round(x - cx + R.hem * (y - top) / 26)) % 4 === 2;
      if (y >= G - 1) return 0;
      if (fold) return 1;
      return u < -0.3 ? 3 : u < 0.35 ? 2 : 1;
    });
    p.end();
    // the black front panel (or back seam) and the brass hem
    p.begin(null);
    if (!back) {
      for (let y = top + 3; y <= G - 1; y++) {
        const t = (y - top) / (G - top);
        const w = 1 + Math.round(t * 2);
        for (let x = Math.round(cx - w + (side ? -2 : 0)); x <= Math.round(cx + w - 1 + (side ? -2 : 0)); x++) p.over(x, y, DARK, x < cx ? 2 : 1);
      }
      // the dragon sigil on the panel: a glowing ember rune
      const sx = Math.round(cx + (side ? -2 : 0)), sy = top + 12;
      p.set(sx, sy, GLOW, 3); p.set(sx - 1, sy + 1, GLOW, 2); p.set(sx + 1, sy + 1, GLOW, 2); p.set(sx, sy + 2, GLOW, 3); p.set(sx, sy - 1, GLOW, 2);
    } else {
      for (let y = top + 2; y <= G - 1; y++) p.over(Math.round(cx), y, DARK, 1);
    }
    for (let x = Math.round(hemL); x <= Math.round(hemR); x++) { p.over(x, G - 2, TRIM, x < cx ? 3 : 2); p.over(x, G - 3, TRIM, 1); }
    p.end();
    // the sash with talismans
    p.begin('all', 0);
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 5); x++) { p.over(x, top + 7, SASH, x < cx ? 3 : 2); p.over(x, top + 8, SASH, 1); }
    p.end();
    p.begin(null);
    if (!back) {
      for (const [x, n] of [[cx - 3, 3], [cx + 2, 2], [cx + 4, 3]]) for (let k = 1; k <= n; k++) p.set(Math.round(x), top + 8 + k, k === n ? BONE : SASH, k === n ? 3 : 1);
    }
    p.end();
    // the scaled mantle over the shoulders
    p.begin('all', 0);
    body(p, cx + (side ? 1 : 0), top + 1.5, side ? 4.8 : 5.8, 3.2, MANTLE, { hi: 0.35 });
    p.end();
    p.begin(null);
    for (let x = Math.round(cx - 5); x <= Math.round(cx + 5); x += 2) p.over(x, top + 3, MANTLE, 0);
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 4); x += 2) p.over(x, top + 1, MANTLE, 3);
    p.end();
  }

  function drawView(p, view, key) {
    const side = view === 'side', back = view === 'up';
    const R0 = side ? sideRig(key) : frontRig(key);
    // the back view mirrors the front rig: the staff on the screen's right
    const R = back ? {
      ...R0,
      head: [48 - R0.head[0], R0.head[1]], armS: R0.armS.map(([x, y]) => [48 - x, y]), armF: R0.armF.map(([x, y]) => [48 - x, y]),
      staff: R0.staff ? R0.staff.map(([x, y]) => [48 - x, y]) : null, sway: -R0.sway, hem: -R0.hem,
    } : R0;
    const d = R.drop;
    const dn = (pts) => pts.map(([x, y]) => [x, y + d]);
    const staffPts = R.staff ? dn(R.staff) : null;
    // the far arm behind (the side view), the staff behind the body in the back view
    if (side) sleeve(p, dn(R.armF), false);
    if (back && staffPts) staff(p, staffPts[0], staffPts[1], R.flame, R.flick);
    robe(p, R, view);
    head(p, R, view);
    if (!side) sleeve(p, dn(R.armF), back);
    if (!back && staffPts) staff(p, staffPts[0], staffPts[1], R.flame, R.flick);
    sleeve(p, dn(R.armS), !back);
  }

  function drawDead(p, view, G) {
    // collapsed: the robe a heap, the mask fallen beside it, the staff dropped, its fire guttered
    p.begin('all', 1);
    K.fillPoly(p, [[8, G - 5], [16, G - 8], [30, G - 7], [36, G - 3], [36, G], [6, G]], ROBE, (x) => (x % 4 === 1 ? 1 : x < 20 ? 3 : 2));
    p.end();
    p.begin(null);
    for (let x = 7; x <= 35; x++) p.over(x, G - 1, TRIM, x < 20 ? 3 : 2);
    p.end();
    p.begin('all', 0);
    capsule(p, [10, G - 1], 0.9, [40, G - 4], 0.9, WOOD);
    body(p, 38, G - 6, 2.6, 2.6, BONE, { hi: 0.25 });
    p.end();
    p.begin(null);
    if (view !== 'up') { p.set(37, G - 6, M.LINE, 0); p.set(39, G - 6, M.LINE, 0); }
    p.set(41, G - 5, GLOW, 1); p.set(42, G - 4, GLOW, 2);
    p.end();
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    // the rigs are laid out in a 48 × 48 box (ground row 46), drawn 4 px in and 8 px down
    p.ox = OX;
    p.oy = OY;
    if (key === 'dead') drawDead(p, view, f.G - OY);
    else drawView(p, view, key);
    if (key === 'hurt') K.shear(p, view === 'side' ? -0.1 : 0.08, f.G);
  }

  return {
    fw: 48 + 2 * OX, fh: 48 + OY,
    columns: [...K.COMMON, 'idle2', 'channel', 'blink', 'throw'],
    aliases: { cast: 'attack', castWind: 'windup' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.0, 0.5]) },
    idle: { poses: ['idle0', 'idle1', 'idle2', 'idle1'], fps: 5 },
    draw,
    ramps: () => K.makeRamps({
      [ROBE]: K.ramp5(['#1a070b', '#3a0e15', '#62161e', '#8e2a26', '#ba4a34']),
      [DARK]: K.ramp5(['#08060a', '#121016', '#1e1a22', '#2c2632', '#3e3646']),
      [TRIM]: K.ramp5(['#3a2208', '#6e4612', '#a8741e', '#d8a838', '#f6d878']),
      [MANTLE]: K.ramp5(['#100a0a', '#221616', '#382422', '#523632', '#704a40']),
      [BONE]: K.ramp5(['#5e5446', '#948670', '#c6b898', '#e6dabc', '#fbf6e0']),
      [WOOD]: K.ramp5(['#140c08', '#28180e', '#3e2616', '#563622', '#704a30']),
      [SKIN]: K.ramp5(['#3a2a26', '#5e4640', '#82645a', '#a48478', '#c4a496']),
      [SASH]: K.ramp5(['#1a1206', '#34240e', '#4e3814', '#6a4e1e', '#8a682a']),
      [GLOW]: K.glowRamp(['#7a1606', '#d2420c', '#ff8a1e', '#ffc24a', '#fff2b0']),
    }, ROBE),
  };
}
