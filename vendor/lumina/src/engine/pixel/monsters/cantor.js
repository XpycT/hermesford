/**
 * The Hush Cantor (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): a tall
 * hooded singer of the Hush ≈ 2 u in a 40 × 44 frame — a long slate-violet robe (`#5e5688`, its
 * darkest tone `#383252` above the night's black: KNOWN_ISSUES EVM-05) frosted at the hem, a pale stole of rime down its front, nothing under the hood but shadow and
 * two cyan eyes (glow texels, the Hushguard's), the hood's opening rimmed in pale bronze, grey gloves
 * and a pale bronze handbell on a dark handle (the bronze keeps a light value at night: review EV-46).
 * Owner: the foes package.
 *
 * Columns: COMMON (`idle0`/`idle1` the bell held low, swaying; `move0`–`move3` a gliding walk, the
 * hem swinging; `windup` the hush gathering — the free hand drawn in; `attack` the hush cast — the
 * hand thrust out; `hurt`; `dead` a crumpled robe, the bell fallen) + `raise` (the bell lifted over
 * the hood: the 30-frame call), `ring0` / `ring1` (the bell swung to one side and the other over
 * the hood: the ring that seals the broken Hushguard) and `step` (a gliding step back, the robe
 * swept). The side view faces left (the `right` row mirrors it). RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number]} Pt */

const FW = 40;
const FH = 44;

/**
 * A pose: the bell hand (the right; front view: screen left) and the free hand as offsets from their
 * shoulders, the bell's tilt (deg from hanging), the body's sway and drop, the hem's swing.
 * @typedef {object} CantorPose
 * @property {Pt} bell  the bell hand from the right shoulder (front view; the side view reads `bs`)
 * @property {Pt} free  the free hand from the left shoulder
 * @property {Pt} [bs]  side view: the bell hand from the far shoulder
 * @property {Pt} [fs]  side view: the free hand from the near shoulder
 * @property {number} [tilt] the bell's swing (deg; + toward screen right)
 * @property {number} [by] @property {number} [bx]
 * @property {number} [hem] the hem's swing (px)
 * @property {number} [eyes]
 */

/** @type {Record<string, CantorPose>} */
const POSES = {
  idle0: { bell: [-1, 10], free: [1, 9], bs: [-2, 10], fs: [-1, 9], tilt: 0 },
  idle1: { bell: [-1, 10], free: [1, 9], bs: [-2, 10], fs: [-1, 9], tilt: 8, by: 0.5, hem: 0.5 },
  move0: { bell: [0, 9], free: [1, 8], bs: [-3, 9], fs: [-2, 8], tilt: -10, hem: -1.5 },
  move1: { bell: [0, 9], free: [1, 8], bs: [-3, 9], fs: [-2, 8], tilt: 0, by: -0.5, hem: 0 },
  move2: { bell: [0, 9], free: [1, 8], bs: [-3, 9], fs: [-2, 8], tilt: 10, hem: 1.5 },
  move3: { bell: [0, 9], free: [1, 8], bs: [-3, 9], fs: [-2, 8], tilt: 0, by: -0.5, hem: 0 },
  windup: { bell: [-1, 9], free: [-3, 3], bs: [-1, 10], fs: [2, 2], tilt: -5, by: 1, eyes: 4 },
  attack: { bell: [-2, 9], free: [3, 2], bs: [-1, 10], fs: [-8, 1], tilt: 10, by: 0, hem: -1, eyes: 4 },
  hurt: { bell: [-4, 5], free: [4, 4], bs: [3, 6], fs: [3, 4], tilt: 40, by: -1, bx: 1, hem: 1.5, eyes: 1 },
  dead: { bell: [0, 0], free: [0, 0], tilt: 0 },
  raise: { bell: [-3, -13], free: [2, 6], bs: [-3, -13], fs: [-2, 6], tilt: 0, by: -1, eyes: 4 },
  ring0: { bell: [-5, -13], free: [2, 6], bs: [-5, -13], fs: [-2, 6], tilt: -35, by: -1, hem: -0.5, eyes: 4 },
  ring1: { bell: [-1, -14], free: [2, 6], bs: [-1, -14], fs: [-2, 6], tilt: 35, by: -1, hem: 0.5, eyes: 4 },
  step: { bell: [-2, 8], free: [3, 7], bs: [-1, 8], fs: [0, 7], tilt: -15, by: 1, bx: 1, hem: 3, eyes: 3 },
};

const EXTRA = ['raise', 'ring0', 'ring1', 'step'];
const DEG = Math.PI / 180;

/**
 * The Hush Cantor's sheet recipe.
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function cantor(K) {
  const { M } = K;
  const ROBE = M.TOP;
  const ROBE2 = M.CAPE;    // the sleeves' and the hood's lining: deeper
  const STOLE = M.WHITE;
  const VOID = M.SKIN;
  const GLOVE = M.SHIRT;
  const BELL = M.METAL;
  const HANDLE = M.WOOD;
  const TRIM = M.GOLD;
  const GLOW = M.GLOW;
  const G = FH - 2;
  const CX = 20;

  /** @param {any} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} mat @param {object} [o] */
  function blob(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.42, lo: -0.22, deep: -0.72, maxShade: 4, ...o });
  }

  /**
   * The handbell held at `hand`, hanging (tilt 0) or swung: a dark handle up from the fist, a silver
   * bell below it with a bright lip and a clapper.
   * @param {any} p @param {number[]} hand @param {number} tilt
   */
  function handbell(p, hand, tilt) {
    const a = (tilt - 90) * DEG; // the bell's axis: down from the hand
    const ux = Math.cos(a);
    const uy = -Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const at = (s, u) => [hand[0] + ux * s + nx * u, hand[1] + uy * s + ny * u];
    p.begin('all', 0);
    K.thickLine(p, ...at(-3, 0), ...at(0.5, 0), 1.2, HANDLE, 2);
    p.end();
    p.begin('all', 0);
    K.fillPoly(p, [at(1, -1), at(1, 1), at(3.5, 1.7), at(5.5, 2.8), at(6, 3), at(6, -3), at(5.5, -2.8), at(3.5, -1.7)], BELL, (x, y) => {
      const px = x + 0.5 - hand[0];
      const py = y + 0.5 - hand[1];
      const u = px * nx + py * ny;
      const l = -u * 0.7 + (px * ux + py * uy) * -0.08;
      return l > 1.2 ? 4 : l > 0 ? 3 : l > -1.6 ? 2 : 1;
    });
    p.end();
    p.begin(null);
    for (let u = -3; u <= 3; u++) { const [x, y] = at(5.8, u); p.over(Math.round(x), Math.round(y), BELL, u < 0 ? 4 : 2); }
    const [kx, ky] = at(7, 0);
    p.set(Math.round(kx), Math.round(ky), BELL, 1); // the clapper
    p.end();
  }

  /**
   * A wide sleeve from the shoulder to the hand, the glove at its end.
   * @param {any} p @param {number[]} sh @param {number[]} hand @param {number} lift
   */
  function sleeve(p, sh, hand, lift) {
    const vx = hand[0] - sh[0];
    const vy = hand[1] - sh[1];
    const l = Math.hypot(vx, vy) || 1;
    const cuff = [hand[0] - (vx / l) * 2, hand[1] - (vy / l) * 2];
    p.begin('all', 0);
    K.thickLine(p, sh[0], sh[1], cuff[0], cuff[1], 3.2, ROBE, (t) => Math.max(0, (t < 0.5 ? 2 : 1) + lift));
    K.thickLine(p, cuff[0] - (vx / l) * 0.5, cuff[1] - (vy / l) * 0.5, cuff[0], cuff[1], 4.2, ROBE2, Math.max(0, 1 + lift));
    p.end();
    p.begin('all', 0);
    blob(p, hand[0], hand[1], 1.4, 1.4, GLOVE);
    p.end();
  }

  /**
   * The hood's rim: every robe texel beside the dark opening (left, right or above it) turns pale
   * bronze (`TRIM`), lit on the left — a light value step round the face at night (review EV-46).
   * @param {any} p @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   * @param {number} cx the light's divide
   */
  function hoodRim(p, x0, y0, x1, y1, cx) {
    const rim = [];
    for (let y = Math.round(y0); y <= Math.round(y1); y++) {
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        if (p.get(x, y) !== ROBE) continue;
        if (p.get(x + 1, y) === VOID || p.get(x - 1, y) === VOID || p.get(x, y + 1) === VOID) rim.push([x, y]);
      }
    }
    for (const [x, y] of rim) p.set(x, y, TRIM, x + 0.5 < cx ? 3 : 2);
  }

  /**
   * The hood (front / back): a peaked cowl, its opening dark, the eyes glowing deep inside.
   * @param {any} p @param {number[]} c @param {boolean} back @param {number} eyes
   */
  function hood(p, c, back, eyes) {
    const [cx, cy] = c;
    p.begin('all', 0);
    K.fillPoly(p, [[cx, cy - 7], [cx + 3.5, cy - 4.5], [cx + 5, cy + 1], [cx + 4.5, cy + 5], [cx - 4.5, cy + 5], [cx - 5, cy + 1], [cx - 3.5, cy - 4.5]], ROBE, (x) => (x + 0.5 < cx - 1.5 ? 3 : x + 0.5 < cx + 1.5 ? 2 : 1));
    p.end();
    p.begin(null);
    if (!back) {
      K.fillPoly(p, [[cx - 0.5, cy - 4], [cx + 2.5, cy - 1.5], [cx + 2.5, cy + 4], [cx - 3.5, cy + 4], [cx - 3.5, cy - 1.5]], VOID, 0);
      const e = eyes ?? 3;
      p.set(Math.round(cx - 2), Math.round(cy), GLOW, e);
      p.set(Math.round(cx + 1), Math.round(cy), GLOW, Math.max(1, e - 1));
      // the hood's rim of pale bronze round the opening, frost caught on its crown
      hoodRim(p, cx - 6, cy - 6, cx + 5, cy + 5, cx);
      for (const [x, y] of [[-1, -6], [1, -6]]) p.over(Math.round(cx + x), Math.round(cy + y), STOLE, 3);
    } else {
      for (let y = Math.round(cy - 6); y <= Math.round(cy + 4); y++) p.over(Math.round(cx - 0.5), y, ROBE2, 1);
    }
    p.end();
  }

  /**
   * The robe: shoulders to the hem, an A-line skirt swinging by `hem`, a ragged frosted hem; the
   * stole of rime down the front (front view).
   * @param {any} p @param {number} cx @param {number} top @param {number} hem @param {boolean} back
   * @param {boolean} side
   */
  function robe(p, cx, top, hem, back, side) {
    const w0 = side ? 4.2 : 5.4;
    const w1 = side ? 6.6 : 8.6;
    p.begin('all', 0);
    for (let y = top; y <= G; y++) {
      const t = (y - top) / (G - top);
      const sw = hem * t * t;
      const w = w0 + (w1 - w0) * t;
      const x0 = cx - w + sw - (side ? 1 : 0);
      const x1 = cx + w + sw;
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        if (y >= G - 1 && ((x * 5 + y) % 4 === 0)) continue; // the ragged hem
        const u = (x + 0.5 - (x0 + x1) / 2) / ((x1 - x0) / 2 + 0.5);
        // vertical folds: darker grooves every few pixels
        const fold = ((x - Math.round(sw)) % 4 + 4) % 4 === 0 && t > 0.25;
        const s = u < -0.5 ? 3 : u < 0.3 ? 2 : u < 0.75 ? 1 : 0;
        p.set(x, y, ROBE, Math.max(0, s - (fold ? 1 : 0)));
      }
    }
    p.end();
    p.begin(null);
    // frost on the hem, a silver trim above it
    for (let x = Math.round(cx - w1 + hem); x <= Math.round(cx + w1 + hem); x++) {
      p.over(x, G - 2, TRIM, x < cx ? 3 : 2);
      if ((x * 3) % 5 < 2) p.over(x, G - 1, STOLE, 3);
    }
    if (!back && !side) {
      // the stole: two pale bands from the shoulders down to the knees
      for (let y = top; y <= top + 15; y++) {
        const sw = hem * ((y - top) / (G - top)) ** 2;
        p.over(Math.round(cx - 2 + sw), y, STOLE, 3);
        p.over(Math.round(cx + 1 + sw), y, STOLE, 2);
      }
      for (const [dx, dy] of [[-2, 16], [1, 16], [-2, 17], [1, 17]]) p.over(Math.round(cx + dx + hem * 0.3), top + dy, STOLE, 1);
    }
    if (side) for (let y = top + 1; y <= top + 15; y++) p.over(Math.round(cx - w0 - 0.5 + hem * ((y - top) / (G - top)) ** 2), y, STOLE, 3);
    p.end();
  }

  /** @param {any} p @param {CantorPose} P @param {boolean} back */
  function drawFront(p, P, back) {
    const m = back ? -1 : 1;
    const by = P.by ?? 0;
    const bx = (P.bx ?? 0) * m;
    const top = 22 + by;
    const shR = [CX - 4.5 * m + bx, 23.5 + by];
    const shL = [CX + 4.5 * m + bx, 23.5 + by];
    const bellHand = [shR[0] + P.bell[0] * m, shR[1] + P.bell[1]];
    const freeHand = [shL[0] + P.free[0] * m, shL[1] + P.free[1]];
    const raised = P.bell[1] < 0;
    // a raised bell behind the hood when seen from behind
    if (back) {
      sleeve(p, shR, bellHand, -1);
      handbell(p, bellHand, -(P.tilt ?? 0));
      sleeve(p, shL, freeHand, -1);
    }
    robe(p, CX + bx, top, (P.hem ?? 0) * m, back, false);
    hood(p, [CX + bx, 16 + by], back, P.eyes ?? 3);
    if (!back) {
      sleeve(p, shL, freeHand, 0);
      sleeve(p, shR, bellHand, raised ? 0 : 0);
      handbell(p, bellHand, P.tilt ?? 0);
    }
  }

  /** @param {any} p @param {CantorPose} P */
  function drawSide(p, P) {
    const by = P.by ?? 0;
    const bx = P.bx ?? 0;
    const top = 22 + by;
    const shN = [CX - 1 + bx, 23.5 + by];
    const shF = [CX + 1 + bx, 23 + by];
    const bs = P.bs ?? P.bell;
    const fs = P.fs ?? P.free;
    // (in profile the bell is in the near hand — the free one behind: the bell must show)
    const bellHand = [shN[0] + bs[0], shN[1] + bs[1]];
    const freeHand = [shF[0] + fs[0] + 2, shF[1] + fs[1]];
    sleeve(p, shF, freeHand, -1);
    robe(p, CX + bx, top, P.hem ?? 0, false, true);
    // the hood in profile: the peak forward, the opening on the left
    const hx = CX - 0.5 + bx;
    const hy = 16 + by;
    p.begin('all', 0);
    K.fillPoly(p, [[hx - 3, hy - 6], [hx + 2, hy - 5.5], [hx + 4.5, hy - 1], [hx + 4.5, hy + 5], [hx - 4, hy + 5], [hx - 5, hy + 1], [hx - 5, hy - 3]], ROBE, (x) => (x + 0.5 < hx ? 3 : x + 0.5 < hx + 2.5 ? 2 : 1));
    p.end();
    p.begin(null);
    K.fillPoly(p, [[hx - 5, hy - 2.5], [hx - 2, hy - 2], [hx - 1.5, hy + 4], [hx - 5, hy + 4]], VOID, 0);
    p.set(Math.round(hx - 4), Math.round(hy), GLOW, P.eyes ?? 3);
    hoodRim(p, hx - 6, hy - 6, hx + 5, hy + 5, hx);
    for (const [x, y] of [[-3, -6], [-2, -6]]) p.over(Math.round(hx + x), Math.round(hy + y), STOLE, 3);
    p.end();
    // the bell arm in front
    sleeve(p, shN, bellHand, 0);
    handbell(p, bellHand, P.tilt ?? 0);
  }

  /** A crumpled robe on the snow, the hood empty, the bell fallen. @param {any} p @param {string} view */
  function drawDead(p, view) {
    const f = view === 'up' ? -1 : 1;
    const X = (x) => CX + (x - CX) * f;
    p.begin('all', 0);
    K.fillPoly(p, [[X(9), 42], [X(12), 37], [X(22), 36], [X(30), 38], [X(32), 42]], ROBE, (x) => (x < CX ? 2 : 1));
    p.end();
    p.begin('all', 0);
    blob(p, X(11), 38.5, 3.5, 2.6, ROBE);
    p.end();
    p.begin(null);
    p.set(X(10), 38, VOID, 0);
    p.set(X(11), 38, VOID, 0);
    for (let x = 14; x <= 27; x += 3) p.over(X(x), 41, STOLE, 3);
    p.end();
    handbell(p, [X(27), 38.5], f * 75);
  }

  /**
   * @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} _f
   */
  function draw(p, view, key, _f) {
    const P = POSES[key] ?? POSES.idle0;
    if (key === 'dead') drawDead(p, view);
    else if (view === 'side') drawSide(p, P);
    else drawFront(p, P, view === 'up');
  }

  return {
    fw: FW, fh: FH, columns: [...K.COMMON, ...EXTRA],
    aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.0, 0.5]) },
    idle: { poses: ['idle0', 'idle1'], fps: 1.4 },
    draw,
    ramps: () => K.makeRamps({
      [ROBE]: K.ramp5(['#383252', '#48416a', '#5e5688', '#7e74ae', '#9a90c8']),
      [ROBE2]: K.ramp5(['#2a2640', '#3a3554', '#4a4468', '#5c5580', '#706898']),
      [STOLE]: K.ramp5(['#6c7c9a', '#98a8c4', '#c4d2e6', '#e4eef8', '#f8fbff']),
      [VOID]: K.ramp5(['#020306', '#04060b', '#070a12', '#0c111c', '#121a28']),
      [GLOVE]: K.ramp5(['#353546', '#525269', '#70708a', '#86869e', '#9c9cb2']),
      [BELL]: K.ramp5(['#4e3a20', '#82643a', '#b8955c', '#e0c48e', '#f8ecc8']),
      [HANDLE]: K.ramp5(['#120c08', '#21170f', '#342618', '#4a3722', '#624a2e']),
      [TRIM]: K.ramp5(['#4a3a24', '#7a6240', '#a88c5e', '#d2b886', '#ecdcb4']),
      [GLOW]: K.glowRamp(['#0e5068', '#1c8cb0', '#46cdf0', '#9ff2ff', '#eaffff']),
    }, ROBE),
  };
}
