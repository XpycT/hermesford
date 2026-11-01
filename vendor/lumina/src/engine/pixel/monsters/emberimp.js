/**
 * Ember Imp — a flying fire imp of Vanquish the Evil Dragon's swarms (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7): ≈ 0.8 u, a flier, in a 24 × 24 frame — a pot-bellied ember-red imp with charcoal horns,
 * long ears, a flickering flame for hair, a glowing grin, cracks of fire in its belly, bat wings and
 * a flame-tipped tail. Owner: the swarm package.
 *
 * Columns: COMMON (`move0`–`move3` the wing beat — up, mid, down, mid — which the idle animation
 * plays at 10 fps, like the bat's; `idle0`/`idle1` two of them; `windup` = cast: the hands cupped
 * round a growing fire orb; `attack` = throw: one arm flung forward, the orb gone; `hurt`; `dead`
 * crumpled) + `flare` (the dive's wind-up: the wings thrown up, the arms out, the flame roaring, a
 * shriek) and `dive` (head first, the wings swept back, a trail of fire). Fire, eyes and the belly
 * cracks are glow texels (alpha 204): the brain's `glow` makes them burn brighter as the tells.
 * No shadow caster (a flier: `castShadow: false`; the blob stays on the ground). The side view
 * faces left. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/**
 * A pose: the wing state, the body's offset, the arms ('down' | 'cup' | 'throw' | 'wide' | 'back'
 * | 'limp'), the orb's radius (cast), the mouth ('grin' | 'open' | 'shut'), eyes, the flame's size,
 * the tail's swing, a tilt (dive), the flame-tuft frame.
 * @typedef {{ wing: string, dy?: number, arms: string, orb?: number, mouth?: string, eye?: string,
 *   flame?: number, tail?: number, tilt?: number, fr?: number }} ImpPose
 */

/** @type {Record<string, ImpPose>} */
const POSES = {
  idle0: { wing: 'up', arms: 'down', flame: 1, tail: 0, fr: 0 },
  idle1: { wing: 'down', dy: 1, arms: 'down', flame: 1, tail: 1, fr: 1 },
  move0: { wing: 'up', dy: -1, arms: 'down', flame: 1, tail: 0, fr: 0 },
  move1: { wing: 'mid', arms: 'down', flame: 2, tail: 1, fr: 1 },
  move2: { wing: 'down', dy: 1, arms: 'down', flame: 2, tail: 0, fr: 2 },
  move3: { wing: 'mid', arms: 'down', flame: 1, tail: -1, fr: 1 },
  windup: { wing: 'mid', arms: 'cup', orb: 2.4, mouth: 'grin', eye: 'wide', flame: 2, tail: 1, fr: 0 },
  attack: { wing: 'up', dy: -1, arms: 'throw', mouth: 'open', eye: 'wide', flame: 2, tail: -1, fr: 2 },
  hurt: { wing: 'crumple', dy: 1, arms: 'limp', mouth: 'open', eye: 'shut', flame: 1, tail: 1, fr: 1 },
  dead: { wing: 'fold', arms: 'limp', mouth: 'shut', eye: 'dead', flame: 0, tail: 0, fr: 0 },
  flare: { wing: 'high', dy: -1, arms: 'wide', mouth: 'open', eye: 'wide', flame: 3, tail: 2, fr: 2 },
  dive: { wing: 'swept', dy: 1, arms: 'back', mouth: 'open', eye: 'wide', flame: 3, tail: -2, tilt: 1, fr: 0 },
};

/** Column names after COMMON. */
const EXTRA = ['flare', 'dive'];

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function emberimp(K) {
  const { M } = K;
  const SKIN = M.FUR, DARK = M.FUR2, MEM = M.WING, FIRE = M.GLOW, FANG = M.BONE;

  /** @param {any} p @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} w @param {number} mat @param {any} s */
  function seg(p, x0, y0, x1, y1, w, mat, s) { K.thickLine(p, x0, y0, x1, y1, w, mat, s); }

  /** Wing shapes: the wrist and three finger tips relative to the shoulder (screen-right wing). */
  const WINGS = {
    up: { wr: [3, -5], t: [[5, -9], [8, -7], [8, -3]] },
    mid: { wr: [4, -2], t: [[8, -4], [9, -1], [7, 2]] },
    down: { wr: [3, 1], t: [[7, 2], [6, 5], [3, 6]] },
    high: { wr: [2, -7], t: [[3, -10], [7, -10], [9, -6]] },
    swept: { wr: [3, -4], t: [[6, -8], [7, -6], [5, -3]] },
    crumple: { wr: [3, 0], t: [[5, 3], [6, 1], [2, 4]] },
    fold: { wr: [1, -2], t: [[2, 2], [3, 3], [1, 4]] },
  };

  /**
   * One bat wing: charcoal bones, a dark ember membrane, scalloped between the tips.
   * @param {any} p @param {number} x0 @param {number} y0 @param {string} state @param {number} dir ±1
   * @param {number} tone 0 far … 2 lit @param {number} [sx] x scale (side views foreshorten)
   */
  function wing(p, x0, y0, state, dir, tone, sx = 1) {
    const W = WINGS[state] ?? WINGS.mid;
    const pt = ([x, y]) => [x0 + x * dir * sx * 0.8, y0 + y * 0.8];
    const wr = pt(W.wr);
    const tips = W.t.map(pt);
    const hip = [x0 + 0.5 * dir, y0 + 3];
    const sc = (a, b) => [(a[0] + b[0]) / 2 + (wr[0] - (a[0] + b[0]) / 2) * 0.35, (a[1] + b[1]) / 2 + (wr[1] - (a[1] + b[1]) / 2) * 0.35];
    const poly = [[x0, y0 - 0.5], wr, tips[0]];
    for (let i = 0; i + 1 < tips.length; i++) poly.push(sc(tips[i], tips[i + 1]), tips[i + 1]);
    poly.push(sc(tips[tips.length - 1], hip), hip);
    K.fillPoly(p, poly, MEM, (x, y) => {
      const d = Math.hypot(x + 0.5 - wr[0], y + 0.5 - wr[1]);
      return Math.max(0, (d < 2.2 ? 3 : d < 4.4 ? 2 : 1) + tone - 1);
    });
    p.line2(x0, y0, wr[0], wr[1], DARK, Math.min(4, tone + 2));
    for (const t of tips) p.line2(wr[0], wr[1], t[0], t[1], DARK, Math.min(4, tone + 1));
    p.set(Math.round(wr[0]), Math.round(wr[1]) - 1, FANG, 2);
  }

  /**
   * The flame for hair: a flickering tongue of fire (frame `fr`, size 0–4) rising from (x, y).
   * @param {any} p @param {number} x @param {number} y @param {number} size @param {number} fr @param {number} lean px per row
   */
  function flame(p, x, y, size, fr, lean) {
    if (size <= 0) return;
    const h = 1 + size;
    for (let k = 0; k < h; k++) {
      const t = k / h;
      const w = Math.max(0, Math.round((1 - t) * (0.4 + size * 0.3)));
      const wob = [0, 1, -1][(fr + k) % 3] * (t > 0.4 ? 1 : 0);
      const cx = Math.round(x + lean * k + wob * 0.6);
      for (let dx = -w; dx <= w; dx++) {
        const edge = Math.abs(dx) === w && w > 0;
        p.set(cx + dx, Math.round(y - k), FIRE, edge ? 1 : t < 0.3 ? (size >= 3 ? 4 : 3) : t < 0.7 ? 3 : 2);
      }
    }
  }

  /**
   * Front (down) / back (up) view.
   * @param {any} p @param {ImpPose} P @param {boolean} back
   */
  function drawFront(p, P, back) {
    const dy = P.dy ?? 0;
    const cx = 12;
    const cy = 13.5 + dy;
    const hy = 8.5 + dy;
    // wings behind
    p.begin(null);
    wing(p, cx - 2, cy - 2.5, P.wing, -1, back ? 0 : 1);
    wing(p, cx + 2, cy - 2.5, P.wing, 1, back ? 1 : 0);
    p.end();
    // tail swinging below, its flame tip
    p.begin(null);
    const tl = P.tail ?? 0;
    seg(p, cx + 1, cy + 2, cx + 3 + tl, cy + 5, 1.4, SKIN, 1);
    seg(p, cx + 3 + tl, cy + 5, cx + 5 + tl, cy + 4.5, 1, SKIN, 1);
    p.end();
    p.begin(null);
    p.set(cx + 6 + tl, Math.round(cy + 4), FIRE, 4); p.set(cx + 6 + tl, Math.round(cy + 3), FIRE, 2); p.set(cx + 7 + tl, Math.round(cy + 4), FIRE, 2);
    p.end();
    // dangling legs with claws
    p.begin(null);
    for (const [lx, d, s] of [[cx - 1.5, -1, 2], [cx + 1.5, 1, 1]]) {
      seg(p, lx, cy + 2, lx + d * 0.5, cy + 4.2, 1.4, SKIN, s);
      p.set(Math.round(lx + d * 0.8), Math.round(cy + 5), DARK, 2);
    }
    p.end();
    // pot belly with ember cracks
    p.begin(null);
    K.blob(p, cx, cy, 3, 3.1, SKIN, { hi: 0.35, lo: -0.25 });
    if (!back) {
      const ys = Math.round(cy);
      p.set(cx, ys - 1, FIRE, 2); p.set(cx - 1, ys, FIRE, 3); p.set(cx - 1, ys + 1, FIRE, 3); p.set(cx, ys + 2, FIRE, 2); p.set(cx + 1, ys, FIRE, 1);
    } else {
      p.set(cx, Math.round(cy - 1), DARK, 2); p.set(cx, Math.round(cy + 1), DARK, 2);
    }
    p.end();
    // head: big, ears out, horns up, the flame between them
    p.begin('below', 1);
    K.blob(p, cx, hy, 3.4, 2.9, SKIN, { hi: 0.3, lo: -0.3 });
    p.end();
    p.begin(null);
    // ears
    for (const [dir, s] of [[-1, 3], [1, 1]]) {
      p.set(cx + dir * 4, Math.round(hy), SKIN, s);
      p.set(cx + dir * 5, Math.round(hy - 1), SKIN, s);
      p.set(cx + dir * 6, Math.round(hy - 2), SKIN, Math.max(1, s - 1));
    }
    // horns
    for (const [dir, s] of [[-1, 3], [1, 2]]) {
      p.set(cx + dir * 2, Math.round(hy - 2), FANG, s - 2);
      p.set(cx + dir * 2, Math.round(hy - 3), FANG, s - 1);
      p.set(cx + dir * 3, Math.round(hy - 3), FANG, s - 2);
      p.set(cx + dir * 3, Math.round(hy - 4), FANG, s);
      p.set(cx + dir * 4, Math.round(hy - 5), FANG, s + 1);
    }
    p.end();
    p.begin(null);
    flame(p, cx, Math.round(hy - 2.5), P.flame ?? 2, P.fr ?? 0, 0);
    p.end();
    if (!back) {
      p.begin(null);
      const ey = Math.round(hy - 0.5);
      if (P.eye === 'shut' || P.eye === 'dead') { p.set(cx - 2, ey, DARK, 0); p.set(cx + 1, ey, DARK, 0); p.set(cx - 1, ey, DARK, 0); p.set(cx + 2, ey, DARK, 0); }
      else {
        // slanted glowing eyes
        p.set(cx - 2, ey, FIRE, 4); p.set(cx - 1, ey, FIRE, 3); p.set(cx - 2, ey - 1, SKIN, 0);
        p.set(cx + 1, ey, FIRE, 3); p.set(cx + 2, ey, FIRE, 4); p.set(cx + 2, ey - 1, SKIN, 0);
        if (P.eye === 'wide') { p.set(cx - 2, ey - 1, FIRE, 2); p.set(cx + 2, ey - 1, FIRE, 2); }
      }
      // the grin
      const my = Math.round(hy + 1.5);
      if (P.mouth === 'open') {
        for (let x = cx - 1; x <= cx + 1; x++) { p.set(x, my, FIRE, 2); p.set(x, my + 1, FIRE, x === cx ? 3 : 1); }
        p.set(cx - 2, my, SKIN, 0); p.set(cx + 2, my, SKIN, 0);
      } else if (P.mouth !== 'shut') {
        for (let x = cx - 2; x <= cx + 2; x++) p.set(x, my, x === cx - 2 || x === cx + 2 ? SKIN : FIRE, x === cx - 2 || x === cx + 2 ? 0 : 1);
        p.set(cx - 2, my - 1, SKIN, 0); p.set(cx + 2, my - 1, SKIN, 0); // the corners curl up
      } else p.set(cx, my, SKIN, 0);
      if (P.mouth !== 'shut') { p.set(cx - 1, my, FANG, 4); p.set(cx + 1, my, FANG, 3); }
      p.end();
    }
    // arms (in front)
    p.begin('all', 0);
    arms(p, P, cx, cy, back ? 1 : -1, back);
    p.end();
    if (P.orb) {
      p.begin(null);
      orb(p, cx, Math.round(cy - 0.5), P.orb);
      p.end();
    }
  }

  /**
   * The fire orb between the cupped hands.
   * @param {any} p @param {number} x @param {number} y @param {number} r
   */
  function orb(p, x, y, r) {
    for (let yy = Math.floor(y - r - 1); yy <= Math.ceil(y + r + 1); yy++) {
      for (let xx = Math.floor(x - r - 1); xx <= Math.ceil(x + r + 1); xx++) {
        const d = Math.hypot(xx + 0.5 - (x + 0.5), yy + 0.5 - (y + 0.5));
        if (d > r) continue;
        p.set(xx, yy, FIRE, d < r * 0.45 ? 4 : d < r * 0.8 ? 3 : 2);
      }
    }
  }

  /**
   * The arms for the front / back view; `sd` = the throwing arm's side (−1 screen-left).
   * @param {any} p @param {ImpPose} P @param {number} cx @param {number} cy @param {number} sd @param {boolean} back
   */
  function arms(p, P, cx, cy, sd, back) {
    const sh = cy - 2;
    const lit = back ? 1 : 3;
    const hand = (x, y, s) => { p.set(Math.round(x), Math.round(y), SKIN, s); p.set(Math.round(x), Math.round(y) + 1, DARK, 2); };
    switch (P.arms) {
      case 'cup':
        seg(p, cx - 2.5, sh, cx - 1.5, cy + 1, 1.2, SKIN, lit); hand(cx - 1.5, cy + 1, lit);
        seg(p, cx + 2.5, sh, cx + 1.5, cy + 1, 1.2, SKIN, 1); hand(cx + 1.5, cy + 1, 1);
        break;
      case 'throw':
        seg(p, cx + sd * 2.5, sh, cx + sd * 3, cy + 3.5, 1.2, SKIN, lit); hand(cx + sd * 3, cy + 3.5, lit);
        seg(p, cx - sd * 2.5, sh, cx - sd * 5, sh - 2, 1.2, SKIN, 1); hand(cx - sd * 5, sh - 2.5, 1);
        break;
      case 'wide':
        seg(p, cx - 2.5, sh, cx - 6, sh - 1.5, 1.2, SKIN, lit); hand(cx - 6.5, sh - 2, lit);
        seg(p, cx + 2.5, sh, cx + 6, sh - 1.5, 1.2, SKIN, 1); hand(cx + 6.5, sh - 2, 1);
        break;
      case 'back':
        seg(p, cx - 2.5, sh, cx - 4, sh + 3, 1.2, SKIN, lit);
        seg(p, cx + 2.5, sh, cx + 4, sh + 3, 1.2, SKIN, 1);
        break;
      case 'limp':
        seg(p, cx - 2.5, sh, cx - 3.5, cy + 2.5, 1.2, SKIN, 2);
        seg(p, cx + 2.5, sh, cx + 3.5, cy + 2.5, 1.2, SKIN, 1);
        break;
      default:
        seg(p, cx - 2.5, sh, cx - 4, cy + 1, 1.2, SKIN, lit); hand(cx - 4, cy + 1.5, lit);
        seg(p, cx + 2.5, sh, cx + 4, cy + 1, 1.2, SKIN, 1); hand(cx + 4, cy + 1.5, 1);
    }
  }

  /**
   * Side view (facing left).
   * @param {any} p @param {ImpPose} P
   */
  function drawSide(p, P) {
    const dy = P.dy ?? 0;
    const tilt = P.tilt ?? 0;
    // body centre, head centre (the dive tips it head-first)
    const cx = 12.5 + tilt;
    const cy = 13.5 + dy - tilt * 0.5;
    const hx = Math.round(10 - tilt * 2.5);
    const hy = Math.round(8.5 + dy + tilt * 2.5);
    // both wings stroke from the shoulder blades behind the body (the far one higher, darker)
    p.begin(null);
    wing(p, cx + 2, cy - 3.5, P.wing, 1, 0, 0.55);
    p.end();
    p.begin(null);
    wing(p, cx + 1, cy - 2.5, P.wing, 1, 1, 0.75);
    p.end();
    // tail: down and back, curling up into its flame
    p.begin(null);
    const tl = P.tail ?? 0;
    seg(p, cx + 1.5, cy + 2, cx + 4.5, cy + 3.5 - tl * 0.3, 1.4, SKIN, 1);
    seg(p, cx + 4.5, cy + 3.5 - tl * 0.3, cx + 6.5, cy + 1.5 - tl, 1, SKIN, 1);
    p.end();
    p.begin(null);
    const qx = Math.round(cx + 7);
    const qy = Math.round(cy + 0.5 - tl);
    p.set(qx, qy, FIRE, 4); p.set(qx, qy - 1, FIRE, 3); p.set(qx + 1, qy - 1, FIRE, 2); p.set(qx, qy - 2, FIRE, 2);
    p.end();
    // legs tucked under the belly (a flier), clawed feet
    p.begin(null);
    if (P.tilt) {
      seg(p, cx + 1, cy + 1.5, cx + 3.5, cy + 3, 1.4, SKIN, 1);
      p.set(Math.round(cx + 4), Math.round(cy + 3), DARK, 2);
    } else {
      seg(p, cx + 1, cy + 2, cx, cy + 3.5, 1.4, SKIN, 1);
      seg(p, cx, cy + 3.5, cx - 1, cy + 4, 1.2, SKIN, 1);
      p.set(Math.round(cx - 2), Math.round(cy + 4), DARK, 2);
      seg(p, cx - 0.5, cy + 2, cx - 1.5, cy + 3, 1.4, SKIN, 2);
      p.set(Math.round(cx - 2.5), Math.round(cy + 3), DARK, 3);
    }
    p.end();
    // pot belly bulging forward, a crack of fire in it
    p.begin(null);
    K.blob(p, cx + 0.5, cy - 0.5, 2.4, 2.6, SKIN, { hi: 0.35, lo: -0.25 });
    K.blob(p, cx - 0.8, cy + 0.6, 2.1, 2.1, SKIN, { hi: 0.3, lo: -0.3 });
    p.set(Math.round(cx - 2), Math.round(cy), FIRE, 3); p.set(Math.round(cx - 2), Math.round(cy + 1), FIRE, 2); p.set(Math.round(cx - 1), Math.round(cy + 2), FIRE, 1);
    p.end();
    // head: a big round skull, a hooked nose; outlined off the body
    p.begin('all', 0);
    K.blob(p, hx, hy, 3.2, 2.8, SKIN, { hi: 0.3, lo: -0.3 });
    p.set(hx - 4, hy, SKIN, 3); p.set(hx - 4, hy + 1, SKIN, 2); p.set(hx - 5, hy + 1, SKIN, 2); // the hooked nose
    p.end();
    // the long ear swept back, the horn curving up and back (bone), the flame at the crown
    p.begin('all', 0);
    p.set(hx + 3, hy, SKIN, 2); p.set(hx + 4, hy - 1, SKIN, 2); p.set(hx + 5, hy - 1, SKIN, 1); p.set(hx + 6, hy - 2, SKIN, 1); p.set(hx + 4, hy, SKIN, 1);
    p.end();
    p.begin('all', 0);
    p.set(hx, hy - 3, FANG, 2); p.set(hx + 1, hy - 3, FANG, 1); p.set(hx + 1, hy - 4, FANG, 3); p.set(hx + 2, hy - 5, FANG, 3); p.set(hx + 3, hy - 5, FANG, 4);
    p.end();
    p.begin(null);
    flame(p, hx - 1, hy - 3, Math.max(0, (P.flame ?? 2) - 1), P.fr ?? 0, 0.5 + tilt * 0.5);
    p.end();
    // face: the glowing eye under a dark brow, the grin with a fang
    p.begin(null);
    const fx = hx - 2;
    const fy = hy - 1;
    if (P.eye === 'shut' || P.eye === 'dead') { p.set(fx, fy, DARK, 0); p.set(fx + 1, fy, DARK, 0); }
    else {
      p.set(fx, fy, FIRE, 4); p.set(fx + 1, fy, FIRE, 3);
      p.set(fx, fy - 1, SKIN, 0); p.set(fx + 1, fy - 1, SKIN, 0);
      if (P.eye === 'wide') p.set(fx, fy - 1, FIRE, 2);
    }
    const my = hy + 1;
    if (P.mouth === 'open') { p.set(fx - 2, my + 1, FIRE, 3); p.set(fx - 1, my + 1, FIRE, 3); p.set(fx, my + 1, FIRE, 2); p.set(fx - 1, my + 2, FIRE, 2); p.set(fx - 2, my, FANG, 4); }
    else if (P.mouth === 'shut') { p.set(fx - 1, my + 1, SKIN, 0); p.set(fx, my + 1, SKIN, 0); }
    else { p.set(fx - 2, my + 1, SKIN, 0); p.set(fx - 1, my + 1, FIRE, 1); p.set(fx, my + 1, FIRE, 1); p.set(fx + 1, my, SKIN, 0); p.set(fx - 1, my + 2, FANG, 4); }
    p.end();
    // the near arm
    p.begin('all', 0);
    const sx = cx - 0.5;
    const sy = cy - 2;
    switch (P.arms) {
      case 'cup': seg(p, sx, sy, cx - 3, cy + 0.5, 1.2, SKIN, 3); break;
      case 'throw': seg(p, sx, sy, cx - 6, cy - 3, 1.2, SKIN, 3); p.set(Math.round(cx - 6.5), Math.round(cy - 3.5), SKIN, 3); break;
      case 'wide': seg(p, sx, sy, cx - 4, sy - 3, 1.2, SKIN, 3); break;
      case 'back': seg(p, sx, sy, cx + 3, sy + 2, 1.2, SKIN, 2); break;
      case 'limp': seg(p, sx, sy, cx - 1, cy + 3, 1.2, SKIN, 2); break;
      default: seg(p, sx, sy, cx - 2.5, cy + 1.5, 1.2, SKIN, 3); p.set(Math.round(cx - 3), Math.round(cy + 2), DARK, 2);
    }
    p.end();
    if (P.orb) { p.begin(null); orb(p, Math.round(cx - 4), Math.round(cy - 0.5), P.orb); p.end(); }
    if (P.tilt) {
      // the trail of fire behind the dive
      p.begin(null);
      for (const [x, y, s] of [[cx + 4, cy - 5, 3], [cx + 5, cy - 6, 2], [cx + 6, cy - 6, 2], [cx + 6, cy - 7, 1], [cx + 3, cy - 6, 2]]) p.set(Math.round(x), Math.round(y), FIRE, s);
      p.end();
    }
  }

  /**
   * Dead: crumpled on the ground (the frame's bottom; the Enemy lowers its hover to 0 as it falls),
   * the flame out, the wings folded.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G
   */
  function drawDead(p, view, G) {
    p.begin(null);
    wing(p, 13, G - 3, 'crumple', 1, 0, 0.9);
    p.end();
    p.begin(null);
    seg(p, 15, G - 1, 19, G - 1, 1.2, SKIN, 1);
    K.blob(p, 12.5, G - 2, 3.2, 2, SKIN, { hi: 0.3, lo: -0.3 });
    p.end();
    p.begin('all', 0);
    K.blob(p, 8.5, G - 2.5, 2.6, 2.2, SKIN, { hi: 0.3, lo: -0.3 });
    p.end();
    p.begin(null);
    p.set(8, G - 3, DARK, 0); p.set(9, G - 3, DARK, 0);
    p.set(9, G - 5, DARK, 2); p.set(10, G - 6, DARK, 3);
    p.set(12, G - 2, FIRE, 1); // a last ember
    p.end();
    void view;
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    if (key === 'dead') { drawDead(p, view, f.G); return; }
    const P = POSES[key] ?? POSES.move1;
    if (view === 'side') drawSide(p, P);
    else drawFront(p, P, view === 'up');
    if (key === 'hurt') K.shear(p, 0.15, 17);
  }

  return {
    fw: 24, fh: 24, columns: [...K.COMMON, ...EXTRA], aliases: {},
    spriteOptions: { castShadow: false, blobSize: /** @type {[number, number]} */ ([0.6, 0.3]) },
    draw,
    idle: { poses: ['move0', 'move1', 'move2', 'move3'], fps: 10 },
    ramps: () => K.makeRamps({
      // ember-red skin, charcoal horns and wing bones, a smouldering membrane, white-hot fire
      [M.FUR]: K.ramp5(['#2a070a', '#520e12', '#841c18', '#b4321e', '#de5228']),
      [M.FUR2]: K.ramp5(['#0e0a0c', '#1e1418', '#2e2026', '#46323a', '#644a50']),
      [M.WING]: K.ramp5(['#200a0c', '#3e1214', '#62201a', '#8e3622', '#bc5a2e']),
      [M.BONE]: K.ramp5(['#3a2e2a', '#5e4c44', '#8a7464', '#b49c88', '#dcc8b2']),
      [M.GLOW]: K.glowRamp(['#8a2206', '#d8500e', '#ff9426', '#ffcc5c', '#fff8c8']),
    }, M.FUR),
  };
}
