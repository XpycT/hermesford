/**
 * Ashwing Whelp — a dragonling of Vanquish the Evil Dragon's swarms (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7): ≈ 1 u in a 32 × 24 frame, an ash-black hatchling of the Ashen Tyrant with ember belly
 * plates, ivory horns, ember-red wing membranes, glowing eyes and a throat that glows when it
 * gathers fire. Owner: the swarm package.
 *
 * Columns: COMMON (`idle0`/`idle1` breathing, `move0`–`move3` one short hop — crouch, launch with
 * the wings up, airborne with the wings spread, landing —, `windup` rearing back with the jaws open,
 * `attack` the snapping bite, `hurt`, `dead` on its side) + `spitWind` (the head drawn back, the
 * throat glowing white-hot) and `spit` (the head thrust forward, fire at the jaws). The throat, the
 * eyes and the fire are glow texels (alpha 204), which the brain's `glow` brightens as the tell.
 * Painted like the other monsters (label buffer, light from the upper left, plum outline); the side
 * view faces left. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/**
 * A pose: body drop `by` / lean, head offset `hx`/`hy`, jaw ('shut' | 'open' | 'fire'), eyes, throat
 * glow (0–4), wings ('fold' | 'half' | 'up' | 'spread' | 'back' | 'limp'), front / back feet (dx,
 * lift) and the tail tip lift.
 * @typedef {{ by?: number, lean?: number, hx?: number, hy?: number, jaw?: string, eye?: string,
 *   throat?: number, wing: string, ff?: [number, number], fb?: [number, number], tail?: number,
 *   flame?: boolean }} WhelpPose
 */

/** @type {Record<string, WhelpPose>} */
const POSES = {
  idle0: { wing: 'fold', throat: 1 },
  idle1: { by: 0.5, hy: 1, wing: 'fold', throat: 2, tail: 1 },
  move0: { by: 1.5, hx: -1, hy: 1, wing: 'half', ff: [-1, 0], fb: [1, 0], tail: -1 },
  move1: { by: -0.5, hx: -1, hy: -1, wing: 'up', ff: [-2, 2], fb: [3, 0], tail: 1 },
  move2: { by: -1, hx: -1, hy: -1, wing: 'spread', ff: [-1, 3], fb: [2, 3], tail: 2 },
  move3: { by: 0, hx: -1, wing: 'half', ff: [-2, 0], fb: [1, 2], tail: 0 },
  windup: { by: 1, lean: 1, hx: 2, hy: -2, jaw: 'open', eye: 'fierce', throat: 2, wing: 'half', ff: [-1, 0], fb: [0, 0], tail: 2 },
  attack: { by: 0.5, lean: -1, hx: -3, hy: 2, jaw: 'open', eye: 'fierce', throat: 1, wing: 'back', ff: [-3, 0], fb: [2, 0], tail: -1 },
  hurt: { by: 0, lean: 1, hx: 2, hy: -1, jaw: 'open', eye: 'shut', throat: 0, wing: 'limp', ff: [1, 0], fb: [0, 0], tail: 1 },
  dead: { wing: 'limp' },
  spitWind: { by: 1, lean: 1, hx: 2, hy: -3, jaw: 'shut', eye: 'fierce', throat: 4, wing: 'half', ff: [-1, 0], fb: [0, 0], tail: 2 },
  spit: { by: 0, lean: -1, hx: -2, hy: 0, jaw: 'fire', eye: 'fierce', throat: 3, wing: 'up', ff: [-2, 0], fb: [1, 0], tail: 0, flame: true },
};

/** Column names after COMMON. */
const EXTRA = ['spitWind', 'spit'];

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function whelp(K) {
  const { M } = K;
  const ASH = M.FUR, ASH2 = M.FUR2, BELLY = M.FUR3, HORN = M.BONE, FIRE = M.GLOW, MEM = M.WING;

  /** @param {any} p @param {string[]} rows @param {Record<string, [number, number]>} lg @param {number} x0 @param {number} y0 */
  function stamp(p, rows, lg, x0, y0) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const e = lg[rows[r][c]];
        if (e) p.set(x0 + c, y0 + r, e[0], e[1]);
      }
    }
  }

  /** @type {Record<string, [number, number]>} */

  const HL = {
    D: [ASH, 0], d: [ASH, 1], o: [ASH, 2], O: [ASH, 3], L: [ASH, 4],
    c: [BELLY, 2], C: [BELLY, 3], m: [M.NOSE, 1], M: [M.NOSE, 2], f: [FIRE, 2], F: [FIRE, 4],
    t: [HORN, 4], n: [ASH, 0],
  };
  /** Side heads (facing left): the skull centre at column 6, row 3. */
  const HEAD_SIDE = {
    shut: ['....ddOOd..', '..dOOOOLOd.', '.dOOOOOOOod', 'nOOOOOOoood', 'tDDDtDDdodd', '.cCCCccdd..'],
    open: ['....ddOOd..', '..dOOOOLOd.', '.dOOOOOOOod', 'nOOOOOOoood', 'tMMMMmmdodd', 'dmmmmmmddd.', '.tcCCcdd...'],
    fire: ['....ddOOd..', '..dOOOOLOd.', '.dOOOOOOOod', 'nOOOOOOoood', 'tFFFFffdodd', 'dfFFFffddd.', '.tcCCcdd...'],
  };
  /** Front heads: the skull centre at column 5, row 3. */
  const HEAD_FRONT = {
    shut: ['...dOOOd...', '..dOOLOOd..', '.dOOOOOOOd.', 'dOOOOOOOOod', '.dOOOOOOod.', '..dnOOOnd..', '..DtDDDtD..', '...cCCcc...'],
    open: ['...dOOOd...', '..dOOLOOd..', '.dOOOOOOOd.', 'dOOOOOOOOod', '.dOOOOOOod.', '..dnOOOnd..', '..DtmmmtD..', '..dmMMMmd..', '...cCCcc...'],
    fire: ['...dOOOd...', '..dOOLOOd..', '.dOOOOOOOd.', 'dOOOOOOOOod', '.dOOOOOOod.', '..dnOOOnd..', '..DtfffDD..', '..dfFFFfd..', '...cCCcc...'],
    back: ['...dOOOd...', '..dOOLOOd..', '.dOOOOOOOd.', 'dOOOOOOOOod', '.dOOOOOOod.', '..dooooodd.', '...dddddd..'],
  };

  /** @param {any} p @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} w @param {number} mat @param {any} s */
  function seg(p, x0, y0, x1, y1, w, mat, s) { K.thickLine(p, x0, y0, x1, y1, w, mat, s); }

  /**
   * A wing (side view): the bone arm from the shoulder to the wrist, two fingers to the tips, the
   * ember membrane between them, scalloped; `far` darker.
   * @param {any} p @param {number} sx @param {number} sy @param {string} state @param {boolean} far
   */
  function wingSide(p, sx, sy, state, far) {
    const W = {
      fold: { w: [2.5, -4.5], t: [[7.5, -2.5], [6, 0.5]] },
      half: { w: [2, -6.5], t: [[8, -5.5], [7.5, -1]] },
      up: { w: [1, -8.5], t: [[5.5, -10], [8.5, -5.5]] },
      spread: { w: [3, -7], t: [[9.5, -8], [11, -3]] },
      back: { w: [4, -4], t: [[9.5, -3.5], [8.5, -0.5]] },
      limp: { w: [3, -2.5], t: [[7, 1], [5, 2]] },
    }[state] ?? { w: [2.5, -4.5], t: [[7.5, -2.5], [6, 0.5]] };
    const dx = far ? 1.5 : 0;
    const dy = far ? -0.5 : 0;
    const wr = [sx + W.w[0] + dx, sy + W.w[1] + dy];
    const tips = W.t.map(([x, y]) => [sx + x + dx, sy + y + dy]);
    const base = [sx + 5 + dx, sy + 0.5];
    const sc = (a, b) => [(a[0] + b[0]) / 2 + (wr[0] - (a[0] + b[0]) / 2) * 0.3, (a[1] + b[1]) / 2 + (wr[1] - (a[1] + b[1]) / 2) * 0.3];
    const poly = [[sx + dx, sy + dy], wr, tips[0], sc(tips[0], tips[1]), tips[1], sc(tips[1], base), base];
    K.fillPoly(p, poly, MEM, (x, y) => {
      const d = Math.hypot(x + 0.5 - wr[0], y + 0.5 - wr[1]);
      return Math.max(0, (d < 2.5 ? 3 : d < 5 ? 2 : 1) - (far ? 1 : 0));
    });
    const bone = far ? 1 : 3;
    p.line2(sx + dx, sy + dy, wr[0], wr[1], ASH, bone);
    for (const t of tips) p.line2(wr[0], wr[1], t[0], t[1], ASH, bone - 1);
    p.set(Math.round(wr[0]), Math.round(wr[1]) - 1, HORN, far ? 2 : 3); // the wrist claw
  }

  /**
   * A wing seen from the front / back: the arm out to the side, fingers fanning down.
   * @param {any} p @param {number} sx @param {number} sy @param {number} dir ±1 outward @param {string} state @param {number} tone
   */
  function wingFront(p, sx, sy, dir, state, tone) {
    const W = {
      fold: { w: [3, -4], t: [[5, -1], [4, 2]] },
      half: { w: [4.5, -5.5], t: [[8, -3], [6.5, 1.5]] },
      up: { w: [3.5, -8], t: [[7, -9], [9, -4]] },
      spread: { w: [6, -5], t: [[11, -5], [11, 0]] },
      back: { w: [3, -3], t: [[5, 0], [3.5, 2]] },
      limp: { w: [4, -1], t: [[6, 2], [4, 3]] },
    }[state] ?? { w: [3, -4], t: [[5, -1], [4, 2]] };
    const pt = ([x, y]) => [sx + x * dir, sy + y];
    const wr = pt(W.w);
    const tips = W.t.map(pt);
    const base = [sx + 1 * dir, sy + 3];
    const sc = (a, b) => [(a[0] + b[0]) / 2 + (wr[0] - (a[0] + b[0]) / 2) * 0.3, (a[1] + b[1]) / 2 + (wr[1] - (a[1] + b[1]) / 2) * 0.3];
    K.fillPoly(p, [[sx, sy], wr, tips[0], sc(tips[0], tips[1]), tips[1], sc(tips[1], base), base], MEM, (x, y) => {
      const d = Math.hypot(x + 0.5 - wr[0], y + 0.5 - wr[1]);
      return Math.max(0, (d < 2.5 ? 3 : d < 5 ? 2 : 1) + tone - 1);
    });
    p.line2(sx, sy, wr[0], wr[1], ASH, Math.min(4, tone + 2));
    for (const t of tips) p.line2(wr[0], wr[1], t[0], t[1], ASH, Math.min(4, tone + 1));
    p.set(Math.round(wr[0]), Math.round(wr[1]) - 1, HORN, 3);
  }

  /**
   * A leg (side): thigh / upper leg from (x, top) to a clawed paw on the ground.
   * @param {any} p @param {number} x @param {number} top @param {number} G @param {[number, number]} f
   * @param {boolean} far @param {boolean} hind
   */
  function legSide(p, x, top, G, f, far, hind) {
    const [dx, lift] = f;
    const gy = G - lift;
    const mat = far ? ASH2 : ASH;
    if (hind) K.blob(p, x + 0.5, top + 0.5, 2.2, 2.3, mat, { hi: 0.3, lo: -0.3, maxShade: far ? 2 : 3 });
    const kx = x + dx * 0.5 + (hind ? 1.2 : -0.3);
    const ky = top + (gy - top) * 0.55;
    seg(p, x, top + 1, kx, ky, 2, mat, far ? 1 : 2);
    seg(p, kx, ky, x + dx, gy - 0.5, 1.6, mat, far ? 0 : 1);
    p.set(Math.round(x + dx) - 1, gy, mat, far ? 1 : 2);
    p.set(Math.round(x + dx), gy, mat, far ? 0 : 1);
    p.set(Math.round(x + dx) - 2, gy, HORN, far ? 1 : 3); // claws
  }

  /**
   * Side view (facing left).
   * @param {any} p @param {WhelpPose} P @param {number} G
   */
  function drawSide(p, P, G) {
    const by = P.by ?? 0;
    const lean = P.lean ?? 0;
    const bx = 17.5 + lean * 0.5;
    const byy = 15.5 + by;
    const hx = Math.round(7.5 + (P.hx ?? 0) + lean);
    const hy = Math.round(9 + by + (P.hy ?? 0));
    // the far wing behind everything
    p.begin(null);
    wingSide(p, bx - 2.5, byy - 3, P.wing, true);
    p.end();
    // far legs
    p.begin(null);
    legSide(p, 13.5 + lean * 0.5, byy + 1, G, [(P.ff ?? [0, 0])[0] + 1, (P.ff ?? [0, 0])[1]], true, false);
    legSide(p, 21.5 + lean * 0.5, byy + 0.5, G, [(P.fb ?? [0, 0])[0] + 1, (P.fb ?? [0, 0])[1]], true, true);
    p.end();
    // tail: thick at the rump, tapering, the tip curling up into a spade
    p.begin(null);
    const tl = P.tail ?? 0;
    const tp = [[bx + 4, byy], [bx + 7, byy + 1.5], [bx + 9.5, byy + 1.5 - tl * 0.5], [bx + 11.5, byy - 0.5 - tl]];
    for (let i = 0; i < tp.length - 1; i++) seg(p, tp[i][0], tp[i][1], tp[i + 1][0], tp[i + 1][1], 2.8 - i * 0.7, ASH, (t) => (i === 0 ? 2 : 1));
    const [qx, qy] = tp[tp.length - 1];
    p.set(Math.round(qx), Math.round(qy) - 1, ASH, 2); p.set(Math.round(qx) + 1, Math.round(qy), ASH, 1); p.set(Math.round(qx), Math.round(qy), ASH, 2);
    p.end();
    // body: haunch, barrel and chest; ember belly plates underneath; spines along the back
    p.begin(null);
    K.blob(p, bx + 2.5, byy, 3.6, 3, ASH, { hi: 0.35, lo: -0.25 });
    K.blob(p, bx - 1.5, byy - 0.3, 4.3, 3.2, ASH, { hi: 0.4, lo: -0.2 });
    for (let x = Math.round(bx - 5); x <= Math.round(bx + 4); x++) {
      for (let y = Math.round(byy + 1); y <= Math.round(byy + 3.5); y++) {
        if (p.get(x, y) !== ASH || p.get(x, y + 1) === 0 && y < byy + 2) continue;
        if (y >= byy + 1.5) p.set(x, y, BELLY, (x % 2 === 0 && y > byy + 2) ? 1 : x < bx ? 3 : 2);
      }
    }
    for (let k = 0; k < 4; k++) { const x = Math.round(bx - 3 + k * 2.2); const y = Math.round(byy - 3.2 + Math.abs(k - 1.2) * 0.4); p.set(x, y - 1, ASH2, 3); }
    p.end();
    // near legs
    p.begin('sides', 1);
    legSide(p, 12.5 + lean * 0.5, byy + 1.2, G, P.ff ?? [0, 0], false, false);
    legSide(p, 20.5 + lean * 0.5, byy + 0.8, G, P.fb ?? [0, 0], false, true);
    p.end();
    // neck from the chest up to the head, the throat underneath glowing
    p.begin(null);
    const nx0 = bx - 4.5;
    const ny0 = byy - 1.5;
    seg(p, nx0, ny0, hx + 2.5, hy + 1.5, 3.4, ASH, 2);
    const th = P.throat ?? 1;
    if (th > 0) {
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        const x = nx0 - 0.5 + (hx + 2 - nx0) * t;
        const y = ny0 + 1.5 + (hy + 2.5 - ny0) * t;
        p.set(Math.round(x), Math.round(y), FIRE, Math.max(1, Math.min(4, th - (k === 0 || k === 3 ? 1 : 0))));
      }
    }
    p.end();
    // head, horns, eye
    p.begin('all', 0);
    stamp(p, P.jaw === 'open' ? HEAD_SIDE.open : P.jaw === 'fire' ? HEAD_SIDE.fire : HEAD_SIDE.shut, HL, hx - 6, hy - 3);
    p.end();
    p.begin(null);
    // horns sweeping back from the brow (the far one darker)
    p.line2(hx + 2, hy - 3, hx + 5, hy - 4, HORN, (t) => (t > 0.7 ? 4 : 2));
    p.set(hx + 6, hy - 5, HORN, 4);
    p.line2(hx + 3, hy - 2, hx + 6, hy - 2, HORN, 1);
    // eye: ember glow under a heavy brow
    if (P.eye === 'shut') { p.set(hx - 1, hy - 1, ASH, 0); p.set(hx, hy - 1, ASH, 0); }
    else {
      p.set(hx - 1, hy - 1, FIRE, 4);
      p.set(hx, hy - 1, FIRE, 2);
      p.set(hx - 1, hy - 2, ASH, 0); p.set(hx, hy - 2, ASH, P.eye === 'fierce' ? 0 : 1);
    }
    if (P.flame) {
      // fire licking out of the jaws
      p.set(hx - 7, hy + 1, FIRE, 4); p.set(hx - 8, hy + 1, FIRE, 3); p.set(hx - 7, hy + 2, FIRE, 3); p.set(hx - 8, hy, FIRE, 2);
    }
    p.end();
    // the near wing over the back
    p.begin('all', 0);
    wingSide(p, bx - 2.5, byy - 2.5, P.wing, false);
    p.end();
  }

  /**
   * Front (down) / back (up) view.
   * @param {any} p @param {WhelpPose} P @param {number} G @param {boolean} back
   */
  function drawFront(p, P, G, back) {
    const by = P.by ?? 0;
    const cx = 16;
    const cy = 15.5 + by;
    const hx = 16;
    const hy = Math.round(9.5 + by + (P.hy ?? 0) * 0.6 + (P.hx ?? 0) * (back ? 0.3 : -0.4));
    // tail: behind (front view: curling out to one side), toward the viewer from the back
    p.begin(null);
    if (back) {
      seg(p, cx, cy + 1, cx + 1, G - 1, 3, ASH, 2);
      seg(p, cx + 1, G - 1, cx + 5, G, 2, ASH, 1);
      p.set(cx + 6, G - 1, ASH, 2); p.set(cx + 6, G, ASH, 1);
    } else {
      seg(p, cx + 2, cy + 1, cx + 8, cy + 3, 2.4, ASH2, 1);
      seg(p, cx + 8, cy + 3, cx + 11, cy + 1 - (P.tail ?? 0), 1.6, ASH2, 1);
    }
    p.end();
    // wings behind the body
    p.begin(null);
    wingFront(p, cx - 2.5, cy - 3, -1, P.wing, back ? 1 : 2);
    wingFront(p, cx + 2.5, cy - 3, 1, P.wing, back ? 2 : 1);
    p.end();
    // hind legs (outside), front legs
    p.begin(null);
    const ff = P.ff ?? [0, 0];
    const fb = P.fb ?? [0, 0];
    for (const [lx, lift, s] of [[cx - 5, fb[1], 2], [cx + 5, fb[1], 1]]) {
      K.blob(p, lx, cy + 1.5, 2, 2.2, ASH, { hi: 0.3, lo: -0.3 });
      seg(p, lx, cy + 2, lx, G - lift, 2, ASH, s);
      p.set(lx - 1, G - lift, HORN, 2);
    }
    p.end();
    p.begin(null);
    K.blob(p, cx, cy, 4.2, 3.6, ASH, { hi: 0.35, lo: -0.25 });
    if (!back) {
      // ember belly plates down the chest
      for (let y = Math.round(cy - 1); y <= Math.round(cy + 3); y++) for (let x = cx - 2; x <= cx + 1; x++) p.over(x, y, BELLY, (y % 2 === 0) ? (x < cx ? 3 : 2) : 1);
    } else {
      for (let y = Math.round(cy - 3); y <= Math.round(cy + 2); y += 2) p.over(cx, y, ASH2, 3);
    }
    p.end();
    p.begin('sides', 1);
    for (const [lx, s] of [[cx - 2.5, 3], [cx + 2.5, 1]]) {
      seg(p, lx, cy + 1, lx, G - ff[1], 1.8, ASH, s);
      p.set(Math.round(lx), G - ff[1], HORN, 3);
      p.set(Math.round(lx) - 1, G - ff[1], ASH, s);
    }
    p.end();
    // neck and head
    p.begin(null);
    seg(p, cx, cy - 2, hx, hy + 2, 3.6, ASH, 2);
    if (!back && (P.throat ?? 1) > 0) {
      const th = P.throat ?? 1;
      for (let y = hy + 4; y <= Math.round(cy - 1); y++) p.set(hx, y, FIRE, Math.max(1, Math.min(4, th)));
    }
    p.end();
    p.begin('below', 1);
    const key = back ? 'back' : P.jaw === 'open' ? 'open' : P.jaw === 'fire' ? 'fire' : 'shut';
    stamp(p, HEAD_FRONT[key], HL, hx - 5, hy - 3);
    p.end();
    p.begin(null);
    // horns rising out and back from the crown
    for (const [dir, s] of [[-1, 3], [1, 2]]) {
      p.line2(hx + dir * 3, hy - 3, hx + dir * 5, hy - 6, HORN, (t) => (t > 0.6 ? s + 1 : s - 1));
    }
    if (!back) {
      for (const [ex, s] of [[hx - 3, 4], [hx + 3, 3]]) {
        if (P.eye === 'shut') { p.set(ex, hy - 1, ASH, 0); continue; }
        p.set(ex, hy - 1, FIRE, s);
        p.set(ex + (ex < hx ? 1 : -1), hy - 2, ASH, 0);
      }
      if (P.flame) { p.set(hx - 1, hy + 6, FIRE, 4); p.set(hx, hy + 6, FIRE, 3); p.set(hx, hy + 7, FIRE, 2); }
    }
    p.end();
  }

  /**
   * Dead: on its side, the wings limp, the throat's fire out.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G
   */
  function drawDead(p, view, G) {
    p.begin(null);
    wingSide(p, 15, G - 4, 'limp', true);
    p.end();
    p.begin(null);
    seg(p, 21, G - 2, 27, G - 1, 2.2, ASH, 1);
    seg(p, 27, G - 1, 29, G - 2, 1.2, ASH, 1);
    K.blob(p, 17, G - 2.6, 5.4, 2.6, ASH, { hi: 0.3, lo: -0.3 });
    for (let x = 13; x <= 20; x++) p.over(x, G - 1, BELLY, x < 16 ? 2 : 1);
    p.end();
    p.begin('all', 0);
    stamp(p, HEAD_SIDE.shut, HL, 3, G - 6);
    p.end();
    p.begin(null);
    p.set(8, G - 4, ASH, 0); p.set(9, G - 4, ASH, 0);
    p.line2(11, G - 6, 13, G - 7, HORN, 2);
    for (const [lx] of [[14], [19]]) { p.set(lx, G - 5, ASH, 2); p.set(lx + 1, G - 6, ASH, 1); }
    p.end();
    void view;
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    const G = f.G;
    if (key === 'dead') { drawDead(p, view, G); return; }
    const P = POSES[key] ?? POSES.idle0;
    if (view === 'side') drawSide(p, P, G);
    else drawFront(p, P, G, view === 'up');
    if (key === 'hurt') K.shear(p, view === 'side' ? -0.12 : 0.1, G);
  }

  return {
    fw: 32, fh: 24, columns: [...K.COMMON, ...EXTRA], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.05, 0.5]) },
    draw,
    ramps: () => K.makeRamps({
      // ash-black scales with a cool sheen, ember belly plates, ivory horns, ember-red membranes
      [M.FUR]: K.ramp5(['#100d11', '#221d23', '#383138', '#584e56', '#82767c']),
      [M.FUR2]: K.ramp5(['#0a080b', '#161317', '#242026', '#383138', '#584e56']),
      [M.FUR3]: K.ramp5(['#4a160a', '#7e2a10', '#b84a18', '#e0782a', '#f8b04a']),
      [M.WING]: K.ramp5(['#2a0806', '#561410', '#8a2416', '#c24620', '#e87a34']),
      [M.BONE]: K.ramp5(['#6a6052', '#9a8e78', '#c8bca0', '#e6dcc0', '#fff8e6']),
      [M.NOSE]: K.ramp5(['#200606', '#3e0c0c', '#661a14', '#94281c', '#c04028']),
      [M.GLOW]: K.glowRamp(['#7a1e06', '#c84410', '#ff7e22', '#ffbe50', '#fff2b0']),
    }, M.FUR),
  };
}
