/**
 * The Rime Crow (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): a big
 * dark slate-violet crow (`#584e72`, a violet-blue sheen on the lit feathers; its darkest tone
 * `#38324a` stays above the night's black — KNOWN_ISSUES EVM-05) crusted with rime on the
 * leading edges of its wings (a band two texels deep, `#e2fbff` over `#b4c4dc`: a light value at
 * night, review EV-46) and its crown, pale ice eyes (glow texels), splayed primaries — the
 * King's eyes. ≈ 0.8 u of body in a 40 × 31 frame (a 32 × 24 layout drawn 4 px in and 6 down:
 * the wings raised clear the top; spread ≈ 1.5 u); a flier, drawn at its hover. Owner: the foes
 * package.
 *
 * Columns: COMMON (`idle0`/`idle1` and `move0`–`move3`: the wingbeat — up, level, down, level; the
 * idle and the flight both play the beat; `windup` wings flung up, the beak open — the caw before the
 * dive; `attack` the dive: wings folded back, beak first; `hurt` tumbling, feathers ruffled; `dead`
 * fallen, wings splayed) + `spitWind` (the head drawn back, the beak opening on a glint of ice) and
 * `spit` (the head thrust out, the beak wide). The side view faces left (the `right` row mirrors it).
 * RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

const FW = 40;
const FH = 31;
/** The layout box (32 × 24) sits this far in from the frame's left and top. */
const OX = 4;
const OY = 6;

/**
 * @typedef {object} CrowPose
 * @property {number} wing  wing angle (deg; 90 straight up, 0 level, −60 down)
 * @property {number} [fold] 0 spread … 1 folded back along the body
 * @property {number} [by]  body drop (px)
 * @property {number} [pitch] the body's nose-down tilt (deg)
 * @property {number} [hx]  head offset forward (− left) @property {number} [hy]
 * @property {number} [beak] 0 shut, 1 open, 2 wide
 * @property {boolean} [ruffle]
 * @property {number} [eyes]
 */

/** @type {Record<string, CrowPose>} */
const POSES = {
  idle0: { wing: 60 },
  idle1: { wing: -20, by: 0.5 },
  move0: { wing: 70 },
  move1: { wing: 15, by: -0.5 },
  move2: { wing: -45, by: -1 },
  move3: { wing: 10, by: 0 },
  windup: { wing: 72, by: -1, pitch: -10, hx: 1, hy: -1, beak: 2, eyes: 4 },
  attack: { wing: 20, fold: 0.85, pitch: 30, hx: -2, hy: 1, beak: 1, eyes: 4 },
  hurt: { wing: -30, by: 1, pitch: -25, hx: 1, hy: -1, beak: 1, ruffle: true, eyes: 0 },
  dead: { wing: 0 },
  spitWind: { wing: 50, by: -0.5, pitch: -15, hx: 2, hy: -1, beak: 1, eyes: 4 },
  spit: { wing: -10, by: 0.5, pitch: 10, hx: -2, hy: 1, beak: 2, eyes: 4 },
};

const DEG = Math.PI / 180;

/**
 * The Rime Crow's sheet recipe.
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function rimecrow(K) {
  const { M } = K;
  const BLACK = M.FUR;
  const SHEEN = M.FUR2;
  const RIME = M.WHITE;
  const BEAK = M.BEAK;
  const GLOW = M.GLOW;
  const ICE = M.STONE;

  /** @param {any} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} mat @param {object} [o] */
  function blob(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.5, lo: -0.15, deep: -0.7, maxShade: 4, ...o });
  }

  /**
   * A wing from the shoulder (x, y) along `ang` (screen deg: 0 right, 90 up), `len` px, `dir` its
   * side (±1 along x): a covert band with a rimed leading edge and four splayed primaries at the
   * tip; `fold` sweeps it back along the body.
   * @param {any} p @param {number} x @param {number} y @param {number} ang @param {number} len
   * @param {number} lift tone shift @param {boolean} rimed
   */
  function wing(p, x, y, ang, len, lift, rimed, width = 3.6) {
    const ux = Math.cos(ang * DEG);
    const uy = -Math.sin(ang * DEG);
    // the trailing edge falls behind the leading one (toward the tail: +x in profile, down in front)
    const bx = -uy;
    const bY = ux;
    const trail = (t) => width - t * (width * 0.45);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x + ux * len * t, y + uy * len * t]);
    }
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      const w = trail(t);
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const sx = Math.sign(bY) || 1;
      K.fillPoly(p, [[x0, y0], [x1, y1], [x1 + bx * w * sx, y1 + bY * w * sx], [x0 + bx * w * sx, y0 + bY * w * sx]], BLACK, Math.max(0, (t < 0.5 ? 2 : 1) + lift));
    }
    // the primaries: four long feathers splayed off the tip
    const tip = pts[8];
    for (let k = 0; k < 4; k++) {
      const a = (ang - 10 - k * 14) * DEG;
      const fl = 4.5 - k * 0.4;
      K.thickLine(p, tip[0] - bx * k * 0.9, tip[1] - bY * k * 0.9, tip[0] - bx * k * 0.9 + Math.cos(a) * fl, tip[1] - bY * k * 0.9 - Math.sin(a) * fl, 1, BLACK, Math.max(0, 1 + lift));
    }
    // the sheen on the coverts, the rimed leading edge
    for (let i = 1; i < 7; i++) {
      const [px, py] = pts[i];
      p.over(Math.round(px + bx * 1.2), Math.round(py + bY * 1.2), SHEEN, Math.max(0, 2 + lift));
    }
    // a crust of rime along the leading edge's inner two thirds: a continuous line just inside it,
    // a paler one under it (a band two texels deep: the crow keeps a light value at night, EV-46)
    if (rimed) {
      const sx = Math.sign(bY) || 1;
      for (let t = 0.04; t <= 0.66; t += 1 / 24) {
        const px = x + ux * len * t - bx * sx * 0.2;
        const py = y + uy * len * t - bY * sx * 0.2;
        p.over(Math.round(px + bx * sx), Math.round(py + bY * sx), RIME, Math.max(1, (t < 0.3 ? 2 : 1) + lift));
        p.over(Math.round(px), Math.round(py), RIME, Math.max(1, (t < 0.3 ? 4 : 3) + lift));
      }
    }
  }

  /**
   * The side view (facing left).
   * @param {any} p @param {CrowPose} P
   */
  function drawSide(p, P) {
    const by = P.by ?? 0;
    const pitch = (P.pitch ?? 0) * DEG;
    const cx = 15;
    const cy = 13 + by;
    const fold = P.fold ?? 0;
    // (in profile a wing beats up and back from the shoulder: 0° is back toward the tail)
    const wa = P.wing * (1 - fold) + 12 * fold;
    // the far wing (behind, darker)
    p.begin(null);
    wing(p, cx + 1, cy - 2, wa * 0.9 + 14, fold ? 8 : 10, -1, false, 2.8);
    p.end();
    // the tail fan
    p.begin('all', 0);
    const tx = cx + 6 * Math.cos(pitch);
    const ty = cy + 6 * Math.sin(pitch);
    K.fillPoly(p, [[cx + 2, cy - 1], [tx + 6, ty - 1.5], [tx + 7.5, ty + 1.5], [tx + 5, ty + 2.5], [cx + 2, cy + 1.5]], BLACK, 1);
    p.end();
    // the body
    p.begin('all', 0);
    blob(p, cx - 0.5, cy, 4.6, 2.9, BLACK);
    p.end();
    p.begin(null);
    for (let x = cx - 3; x <= cx + 2; x++) p.over(x, Math.round(cy - 2), SHEEN, 3);
    if (P.ruffle) for (const [x, y] of [[cx - 2, cy - 4], [cx + 1, cy - 4], [cx + 3, cy - 3]]) p.set(x, Math.round(y), BLACK, 1);
    p.end();
    // the head and the beak
    const hx = cx - 5 + (P.hx ?? 0);
    const hy = cy - 3 + (P.hy ?? 0) + Math.sin(pitch) * -2;
    p.begin('all', 0);
    blob(p, hx, hy, 2.7, 2.5, BLACK);
    p.end();
    p.begin(null);
    const beak = P.beak ?? 0;
    const bAng = (pitch * 0.6);
    const bdx = -Math.cos(bAng);
    const bdy = Math.sin(bAng);
    for (let k = 1; k <= 4; k++) {
      p.set(Math.round(hx - 1.5 + bdx * k), Math.round(hy + bdy * k), BEAK, k < 3 ? 2 : 3);
      if (k < 3) p.set(Math.round(hx - 1.5 + bdx * k), Math.round(hy + 1 + bdy * k), BEAK, 1);
    }
    if (beak) {
      for (let k = 1; k <= 3; k++) p.set(Math.round(hx - 1.5 + bdx * k), Math.round(hy + 1 + beak * 0.6 + bdy * k), BEAK, 1);
      if (beak === 2) p.set(Math.round(hx - 2 + bdx), Math.round(hy + 1), ICE, 4);
    }
    // the rimed crown, the ice eye
    p.over(Math.round(hx), Math.round(hy - 2), RIME, 3);
    p.over(Math.round(hx + 1), Math.round(hy - 2), RIME, 2);
    const e = P.eyes ?? 3;
    if (e) p.set(Math.round(hx - 1), Math.round(hy - 0.5), GLOW, e);
    // the feet tucked
    p.set(cx, Math.round(cy + 3.5), BEAK, 1);
    p.set(cx + 1, Math.round(cy + 3.5), BEAK, 0);
    p.end();
    // the near wing
    p.begin('all', 0);
    wing(p, cx - 1, cy - 1, wa * 0.9 + 4, fold ? 9 : 11, 0, true, 2.9);
    p.end();
  }

  /**
   * The front (facing the viewer) or back view: the wings spread to both sides.
   * @param {any} p @param {CrowPose} P @param {boolean} back
   */
  function drawFront(p, P, back) {
    const by = P.by ?? 0;
    const cx = 16;
    const cy = 13 + by;
    const fold = P.fold ?? 0;
    const wa = P.wing * (1 - fold) - 70 * fold;
    const len = 10.5 - fold * 5;
    p.begin(null);
    wing(p, cx - 2, cy - 1, 180 - wa, len, back ? -1 : 0, !back);
    wing(p, cx + 2, cy - 1, wa, len, -1, !back);
    p.end();
    if (back) {
      // the tail toward the viewer below the body
      p.begin('all', 0);
      K.fillPoly(p, [[cx - 2, cy + 2], [cx + 2, cy + 2], [cx + 3, cy + 7], [cx - 3, cy + 7]], BLACK, 1);
      p.end();
    }
    p.begin('all', 0);
    blob(p, cx, cy, 3.6, 4, BLACK);
    p.end();
    const hy = cy - 4 + (P.hy ?? 0) * 0.5;
    p.begin('all', 0);
    blob(p, cx, hy, 2.8, 2.6, BLACK);
    p.end();
    p.begin(null);
    p.over(cx - 1, Math.round(hy - 2), RIME, 3);
    p.over(cx, Math.round(hy - 2), RIME, 2);
    if (!back) {
      const e = P.eyes ?? 3;
      if (e) {
        p.set(cx - 2, Math.round(hy - 0.5), GLOW, e);
        p.set(cx + 1, Math.round(hy - 0.5), GLOW, Math.max(1, e - 1));
      }
      // the beak toward the viewer: a dark wedge, open when cawing
      p.set(cx - 1, Math.round(hy + 1), BEAK, 3);
      p.set(cx, Math.round(hy + 1), BEAK, 2);
      p.set(cx - 1, Math.round(hy + 2), BEAK, 2);
      if (P.beak) p.set(cx, Math.round(hy + 2), BEAK, 0);
      if (P.beak === 2) p.set(cx - 1, Math.round(hy + 3), ICE, 4);
      for (let y = Math.round(cy - 1); y <= Math.round(cy + 2); y++) p.over(cx - 1, y, SHEEN, 3);
    }
    p.set(cx - 1, Math.round(cy + 4), BEAK, 1);
    p.set(cx + 1, Math.round(cy + 4), BEAK, 0);
    p.end();
  }

  /** Fallen: on its back on the snow, one wing splayed. @param {any} p @param {string} view */
  function drawDead(p, view) {
    const f = view === 'up' ? -1 : 1;
    const X = (x) => 16 + (x - 16) * f;
    p.begin(null);
    wing(p, X(14), 19, view === 'up' ? 10 : 170, 9, -1, true);
    p.end();
    p.begin('all', 0);
    blob(p, 16, 20, 4.5, 2.6, BLACK);
    blob(p, X(20), 19.5, 2.2, 2, BLACK);
    p.end();
    p.begin(null);
    p.set(X(22), 19, BEAK, 2);
    p.set(X(23), 19, BEAK, 3);
    p.set(15, 17, BEAK, 1);
    p.set(17, 17, BEAK, 1);
    for (const x of [13, 16, 19]) p.over(x, 18, RIME, 3);
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
    fw: FW, fh: FH, columns: [...K.COMMON, 'spitWind', 'spit'],
    aliases: {},
    spriteOptions: { castShadow: false, blobSize: /** @type {[number, number]} */ ([0.8, 0.4]) },
    // (it hovers on the wingbeat)
    idle: { poses: ['move0', 'move1', 'move2', 'move3'], fps: 9 },
    draw,
    ramps: () => K.makeRamps({
      [BLACK]: K.ramp5(['#38324a', '#463e5c', '#584e72', '#74688f', '#9084ae']),
      [SHEEN]: K.ramp5(['#3a3456', '#4a4470', '#5c5694', '#6c70b0', '#8690c8']),
      [RIME]: K.ramp5(['#7d8fbe', '#b4c4dc', '#c8dcec', '#e2fbff', '#f4feff']),
      [BEAK]: K.ramp5(['#060608', '#0e0e12', '#1a1a20', '#2c2c34', '#44444e']),
      [ICE]: K.ramp5(['#5aa0c0', '#86c4dc', '#b4e2f2', '#dcf6ff', '#ffffff']),
      [GLOW]: K.glowRamp(['#1a5e74', '#3a9cbc', '#7cd8f2', '#bff2ff', '#f0ffff']),
    }, BLACK),
  };
}
