/**
 * The Harvest Mawkin — the scarecrow guardian of Amberfield in The Bells of Evermere
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.7): an effigy of straw on a pole, animated by the
 * frost, ≈ 5 u to the top of its hat in a 128 × 128 frame (16 px a unit, the ground row G = 126).
 * Owner: the guardians package.
 *
 * **The look.** A sack-cloth head (coarse hessian weave, a drawstring at the neck with straw
 * bursting out under it) with stitched eyes that glow frost-cyan and a stitched mouth; a battered,
 * wide, floppy felt hat with rime on its brim; **Osmund's coat** — the story's clue (chapter 3): a
 * long bell-founder's working coat in his slate-blue wool, buttoned with brass to a leather belt,
 * a founder's leather apron showing where the flaps part, leather patches, and burns: scorched
 * holes with charred edges and singed halos, straw showing through; arms of bundled straw on a
 * cross-pole (straw tufts at the cuffs, straw dangling from the ragged hem); no feet — it stands
 * and hops on its old pole; a scythe with a dark ash snath and a long curved blade of ice whose
 * cutting edge glows. Rime on the shoulders and hat; a cool frost-blue rim along the right and top
 * edges keeps it readable against the gold field when the low sun of 16.6 h backlights it. The
 * slate coat stays dark against the wheat.
 *
 * **The sheet** (MonsterSprites `layout`, perRow 32): the side view facing left (the `right` strip
 * mirrors it), the front view (`down`, every pose — it faces the party, who come from the south)
 * and the back view (`up`). The poses: `idle0`–`idle2` swaying on the pole, the coat tails stirring;
 * `walk0`–`walk3` a lurching hop on the pole (planted, crouch, airborne, land); `reapWind` the
 * scythe drawn back over its shoulder, `reap` swung through low in front, `reapEnd` the follow
 * through; `spinWind` the scythe raised overhead in both hands (the 360° reap), `spin0` / `spin1`
 * the whirl (the blade on one side, then the other; a smear of ice behind it); `volley` the arms
 * flung wide and the coat thrown open (the brain's crows burst out of it); `sink0`–`sink2` sinking
 * into the furrow, `rise0`–`rise2` rising out of it (the last a burst of wheat and frost);
 * `gustWind` the arms spread and the coat billowing, `gust` the arms swept forward and the coat
 * streaming back; `call` the scythe planted blade-down, the head thrown back; `stun` slumped on its
 * pole; `hurt`; `collapse0`–`collapse2` falling apart into straw; `heap` the end: a heap of straw
 * under Osmund's coat, the sack head on top with dark eyes, the blade melted to a shard — the spot
 * the story's clue lies on.
 *
 * Each pose is a rig (the figure's drop, lean, the coat's flare / opening / streaming, the head, the
 * cuffs of both arms, the scythe's snath and blade) read by one painter per view; the back view is
 * the front rig painted from behind (its light mirrored) and flipped. Glow texels: the stitched eyes
 * and the blade's edge (the brain lights them with `uGlow`). RNG-free: fixed rigs and `hash2` with
 * fixed seeds.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** Every pose of the side view (facing left; the right strip mirrors it) and of the front view. */
export const MAWKIN_COLUMNS = Object.freeze(['idle0', 'idle1', 'idle2', 'walk0', 'walk1', 'walk2', 'walk3',
  'reapWind', 'reap', 'reapEnd', 'spinWind', 'spin0', 'spin1', 'volley', 'sink0', 'sink1', 'sink2', 'rise0', 'rise1', 'rise2',
  'gustWind', 'gust', 'call', 'stun', 'hurt', 'collapse0', 'collapse1', 'collapse2', 'heap']);
/** The front view (the `down` strip): every pose — it faces the party. */
export const MAWKIN_FRONT = MAWKIN_COLUMNS;
/** The back view (the `up` strip). */
export const MAWKIN_BACK = Object.freeze(['idle0', 'idle1', 'idle2', 'walk0', 'walk1', 'walk2', 'walk3', 'sink0', 'sink1', 'sink2',
  'rise0', 'rise1', 'rise2', 'stun', 'collapse0', 'collapse1', 'collapse2', 'heap']);

const FW = 128;
const FH = 128;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** The light's direction on the label buffer (upper left; the back view paints it mirrored before its flip). */
const LY = -0.8;

/** @typedef {[number, number]} Pt */

/**
 * The scythe of a rig: the snath from its butt `B` to its head `T`, the blade from `T` along `a`
 * (screen degrees: 0 right, 90 down), bending toward its edge side `curl` (±1), `bl` px long;
 * `blur` adds the whirl's smear (1: sweeping left, −1: right).
 * @typedef {{ B: Pt, T: Pt, a: number, curl: number, bl: number, blur?: number, melt?: boolean }} Scythe
 */

/**
 * A pose's rig. Coordinates are frame px at the figure's rest height (`dy` moves the whole figure
 * down — a sink — or up — a hop); the arms' cuffs `aL` / `aR` (front: the viewer's left / right
 * arm; side: `aL` the far arm, `aR` the near one); `grip`: the cuffs that hold the snath ('L', 'R',
 * 'LR'); the coat's `flare` (0–1.5), `open` (0–1: thrown open), `stream` (−1…1: its tails blown
 * toward the viewer's left / right); the head's offset `head` and `tilt` (1 thrown back, −1
 * lolling); `straw` flying bits; `ground` (0 none, 1 frost at the pole's foot, 2 the furrow it sinks
 * into, 3 the furrow bursting); `eyes` false: dark thread (no glow).
 * @typedef {{ dy: number, lean: number, flare: number, open: number, stream: number, head: Pt, tilt: number,
 *   aL: Pt, aR: Pt, grip: string, scy: Scythe|null, straw: number, ground: number, eyes: boolean,
 *   feathers?: boolean }} Rig
 */

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function mawkin(K) {
  const { M } = K;
  const STRAW = M.FUR, STRAW2 = M.FUR2, SACK = M.FUR3, COAT = M.TOP, LINING = M.ACCENT, HAT = M.HAT, BAND = M.HATBAND;
  const WOOD = M.WOOD, BRASS = M.GOLD, APRON = M.LEATHER, SINGE = M.SCARF, CHAR = M.HAIR, RIME = M.WHITE, THREAD = M.STRING;
  const ICE = M.GEL, GLOW = M.GLOW, RIM = M.BEAK, SOIL = M.STONE, PATCH = M.BELT;
  const G = FH - 2;
  /** The light's x on the label buffer: −0.55 (from the left); the back view's +0.55 before its flip. */
  let LX = -0.55;
  /** The light's side for the flat shades: 1 = left lit. */
  const litLeft = () => LX < 0;

  // ---------------------------------------------------------------------------------------------
  // Shape helpers
  // ---------------------------------------------------------------------------------------------

  /** Tapered capsule a → b shaded as a cylinder lit from the upper left (the view's light). */
  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { hi = 0.42, lo = -0.2, deep = -0.7, lift = 0, max = 4, min = 0 } = o;
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
        const s = l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0;
        p.set(x, y, mat, Math.max(min, Math.min(max, s + lift)));
      }
    }
  }

  /** An ellipse shaded like a ball lit by the view's light. */
  function ball(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { lx: LX, ly: LY, ...o });
  }

  /**
   * Fill a polygon, then shade each row across its own width (`fn(t, x, y)`: t 0 at the row's lit
   * edge … 1 at its far edge).
   * @param {any} p @param {Pt[]} pts @param {number} mat @param {(t: number, x: number, y: number) => number} fn
   */
  function slab(p, pts, mat, fn) {
    K.fillPoly(p, pts, mat, 2);
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const { w, part, pid } = p;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(FH - 1, Math.ceil(y1)); y++) {
      let xl = -1, xr = -1;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (part[i] !== pid || p.mat[i] !== mat) continue;
        if (xl < 0) xl = x;
        xr = x;
      }
      if (xl < 0) continue;
      const span = Math.max(1, xr - xl);
      for (let x = xl; x <= xr; x++) {
        const i = y * w + x;
        if (part[i] !== pid || p.mat[i] !== mat) continue;
        const t0 = (x - xl) / span;
        p.shade[i] = Math.max(0, Math.min(4, fn(litLeft() ? t0 : 1 - t0, x, y)));
      }
    }
  }

  /**
   * One straw: a slightly curved strand from (x, y) along `ang` (rad), `len` px; its tone brightens
   * toward the tip; `dark` paints it in the shadowed straw.
   */
  function strand(p, x, y, ang, len, bend, s0 = 2, dark = false) {
    const n = Math.max(2, Math.ceil(len * 1.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = ang + bend * t;
      const px = x + Math.cos(ang) * len * t + Math.cos(a) * 0.4 * t;
      const py = y + Math.sin(ang) * len * t + Math.sin(a) * 0.4 * t + bend * t * t * len * 0.3;
      const s = Math.min(4, s0 + (t > 0.7 ? 1 : 0));
      p.set(Math.round(px), Math.round(py), dark ? STRAW2 : STRAW, dark ? Math.max(1, s - 1) : s);
    }
  }

  /** A tuft of `n` straws fanned ±`spread` (rad) round `ang` from (x, y); `seed` picks the lengths. */
  function tuft(p, x, y, ang, spread, n, len, seed) {
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : k / (n - 1);
      const j = K.hash2(k, seed, 71);
      const a = ang + (u - 0.5) * 2 * spread + (j - 0.5) * 0.25;
      const l = len * (0.65 + 0.5 * K.hash2(seed, k, 72));
      strand(p, x + (j - 0.5) * 1.2, y + (K.hash2(k, seed, 73) - 0.5) * 1.2, a, l, (j - 0.5) * 0.8, k % 3 === 0 ? 1 : 2, k % 4 === 1);
    }
  }

  /** A scorched hole in the coat at (x, y): straw inside, a charred rim, a singed halo (coat texels only). */
  function burn(p, x, y, r) {
    for (let yy = Math.floor(y - r - 2); yy <= Math.ceil(y + r + 2); yy++) {
      for (let xx = Math.floor(x - r - 2); xx <= Math.ceil(x + r + 2); xx++) {
        if (p.get(xx, yy) !== COAT && p.get(xx, yy) !== SINGE && p.get(xx, yy) !== CHAR) continue;
        const ang = Math.atan2(yy + 0.5 - y, xx + 0.5 - x);
        const d = Math.hypot(xx + 0.5 - x, (yy + 0.5 - y) * 1.15) - 0.45 * Math.sin(ang * 3 + x);
        if (d < r - 0.6) p.set(xx, yy, STRAW, (xx + yy) % 3 === 0 ? 1 : d < r - 1.6 ? 3 : 2);
        else if (d < r + 0.5) p.set(xx, yy, CHAR, d < r ? 0 : 1);
        else if (d < r + 1.6 && K.hash2(xx, yy, 77) < 0.75) p.set(xx, yy, SINGE, d < r + 1 ? 1 : 2);
      }
    }
  }

  /**
   * Rime along the top edge of `mats` between x0 and x1: the topmost texel of each column turned to
   * frost (most of them), a second texel under it now and then.
   */
  function rime(p, x0, x1, mats, seed, y0 = 2) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      for (let y = Math.max(2, Math.round(y0)); y < FH - 2; y++) {
        const m = p.get(x, y);
        if (!m) continue;
        if (!mats.includes(m)) break;
        const h = K.hash2(x, seed, 79);
        if (h < 0.82) p.set(x, y, RIME, h < 0.3 ? 4 : 3);
        if (h < 0.28 && mats.includes(p.get(x, y + 1))) p.set(x, y + 1, RIME, 2);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The scythe
  // ---------------------------------------------------------------------------------------------

  /** The snath: an ash pole with two grips, lit along its light side. @param {Scythe} S */
  function snath(p, S) {
    const [bx, by] = S.B, [tx, ty] = S.T;
    p.begin('all', 1);
    capsule(p, S.B, 1.2, S.T, 1.1, WOOD, { hi: 0.25, lo: -0.3, max: 3 });
    p.end();
    // the two nibs (grips) sticking out from the snath
    const len = Math.hypot(tx - bx, ty - by) || 1;
    const ux = (tx - bx) / len, uy = (ty - by) / len;
    p.begin(null);
    for (const f of [0.38, 0.7]) {
      const cx = bx + (tx - bx) * f, cy = by + (ty - by) * f;
      const nx = -uy, ny = ux;
      const sgn = nx * LX + ny * LY > 0 ? 1 : -1;
      for (let k = 1; k <= 2; k++) p.set(Math.round(cx + nx * k * sgn), Math.round(cy + ny * k * sgn), WOOD, k === 2 ? 3 : 2);
    }
    p.end();
  }

  /** The blade of ice from the snath's head: a spine of pale ice, a body of deeper ice, a glowing edge. @param {Scythe} S */
  function blade(p, S) {
    const [tx, ty] = S.T;
    const ua = S.a * DEG;
    const ux = Math.cos(ua), uy = Math.sin(ua);
    // the bend: toward the edge side
    const vx = S.curl > 0 ? -uy : uy, vy = S.curl > 0 ? ux : -ux;
    const bl = S.bl;
    const P = (t) => [tx + ux * bl * t + vx * 0.32 * bl * t * t, ty + uy * bl * t + vy * 0.32 * bl * t * t];
    // the blade's collar on the snath
    p.begin('all', 0);
    ball(p, tx, ty, 1.8, 1.8, CHAR, { maxShade: 2 });
    p.end();
    if (S.melt) {
      // the shard it melted to: a short wedge of clouded ice, no glow
      p.begin('all', 1);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12 * 0.35;
        const [cx, cy] = P(t);
        const w = 2.4 * (1 - t / 0.35) + 0.6;
        for (let k = 0; k <= w * 2; k++) p.set(Math.round(cx + vx * k * 0.5), Math.round(cy + vy * k * 0.5), ICE, k < 2 ? 3 : 2);
      }
      p.end();
      return;
    }
    p.begin('all', 1);
    const n = Math.ceil(bl * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const [cx, cy] = P(t);
      // the local normal toward the edge (the curve's tangent turned to the bend side)
      const [qx, qy] = P(Math.min(1, t + 0.02));
      const [rx, ry] = P(Math.max(0, t - 0.02));
      let gx = qx - rx, gy = qy - ry;
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl; gy /= gl;
      let nx = -gy, ny = gx;
      if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }
      const w = 4.2 * Math.pow(1 - t, 0.75) + 0.7;
      for (let k = 0; k <= w * 2; k++) {
        const d = k * 0.5;
        const x = Math.round(cx + nx * d), y = Math.round(cy + ny * d);
        const edge = d > w - 0.9;
        if (edge) p.set(x, y, GLOW, t > 0.85 ? 4 : 3);
        else p.set(x, y, ICE, d < 0.8 ? 4 : d < w * 0.45 ? 3 : 2);
      }
    }
    p.end();
    // a crack of light down the blade's body (the ice's inner streak)
    p.begin(null);
    for (let i = 2; i < n * 0.7; i += 3) {
      const t = i / n;
      const [cx, cy] = P(t);
      const [qx, qy] = P(Math.min(1, t + 0.02));
      let nx = -(qy - cy), ny = qx - cx;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }
      p.over(Math.round(cx + nx * 1.5), Math.round(cy + ny * 1.5), ICE, 4);
    }
    p.end();
    if (S.blur) {
      // the whirl's smear: thin arcs of ice behind the blade, broken up
      p.begin(null);
      const [mx, my] = P(0.6);
      const px = S.B[0], py = S.B[1];
      const R0 = Math.hypot(mx - px, my - py);
      const a0 = Math.atan2(my - py, mx - px);
      for (let ring = 0; ring < 3; ring++) {
        const R = R0 - 3 + ring * 4;
        for (let s = 0; s < 40; s++) {
          const a = a0 + S.blur * (0.06 + s * 0.022) * (ring === 1 ? 1 : 0.8);
          const x = Math.round(px + Math.cos(a) * R), y = Math.round(py + Math.sin(a) * R * 0.45 + (my - py) * 0.55 * (1 - s / 40));
          if ((s + ring) % 3 === 2 || s > 34 - ring * 6) continue;
          if (!p.get(x, y)) p.set(x, y, s < 10 ? ICE : RIME, s < 10 ? 3 : 2);
        }
      }
      p.end();
    }
  }

  /** A straw hand gripping the snath at (x, y). */
  function hand(p, x, y, seed) {
    p.begin('all', 1);
    ball(p, x, y, 2.4, 2.1, STRAW, { maxShade: 3 });
    p.end();
    p.begin(null);
    tuft(p, x, y, (K.hash2(seed, 2, 74) - 0.5) * 2 + Math.PI / 2, 0.9, 3, 3.5, seed);
    p.set(Math.round(x - 1), Math.round(y), STRAW2, 1);
    p.set(Math.round(x + 1), Math.round(y - 1), STRAW, 3);
    p.end();
  }

  /**
   * A sleeve from the shoulder to the cuff, a frayed cuff, the straw bursting out of it; `far`:
   * darker, behind.
   */
  function arm(p, sh, cuff, far, seed, patch) {
    const [sx, sy] = sh, [cx, cy] = cuff;
    const len = Math.hypot(cx - sx, cy - sy) || 1;
    const ux = (cx - sx) / len, uy = (cy - sy) / len;
    const end = [cx - ux * 1.5, cy - uy * 1.5];
    p.begin('all', far ? 0 : 1);
    capsule(p, sh, 3.4, end, 2.7, COAT, { lift: far ? -1 : 0, max: far ? 2 : 3, hi: 0.36 });
    p.end();
    p.begin(null);
    // the frayed cuff: a darker band and two tatters
    for (let k = -3; k <= 3; k++) {
      const x = Math.round(end[0] - uy * k * 0.9), y = Math.round(end[1] + ux * k * 0.9);
      if (p.get(x, y) === COAT) p.set(x, y, COAT, far ? 0 : 1);
    }
    if (patch && !far) {
      const mx = sx + (cx - sx) * 0.5, my = sy + (cy - sy) * 0.5;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (p.get(Math.round(mx + xx), Math.round(my + yy)) === COAT) p.set(Math.round(mx + xx), Math.round(my + yy), PATCH, yy < 0 ? 3 : 2);
      p.set(Math.round(mx - 2), Math.round(my), THREAD, 1);
      p.set(Math.round(mx + 2), Math.round(my + 1), THREAD, 1);
    }
    p.end();
    p.begin(null);
    tuft(p, cx, cy, Math.atan2(uy, ux), 0.75, far ? 4 : 6, far ? 4 : 5.5, seed);
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // The front view (and the back, painted from behind and flipped)
  // ---------------------------------------------------------------------------------------------

  /**
   * The coat's outline in the front view: the collar, the shoulders, the sides, a ragged hem
   * (flared, streaming).
   * @param {Rig} R @param {number} oy
   */
  function coatFront(R, oy) {
    const f = R.flare, s = R.stream;
    const hemY = 104 + oy - f * 2;
    const L = 47 - f * 5 + s * 3, Rr = 81 + f * 5 + s * 3;
    /** @type {Pt[]} */
    const pts = [[58, 66 + oy], [51, 70 + oy], [49, 78 + oy], [49.5 + s, 88 + oy], [L, hemY]];
    const n = 9;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = L + (Rr - L) * t;
      const tatter = k % 2 === 0 ? 2.5 + K.hash2(k, 3, 81) * 2.5 : -0.5;
      const swing = s * 3 * Math.sin(t * Math.PI);
      pts.push([x + swing, hemY + tatter + f * 1.5 * Math.sin(t * Math.PI * 3)]);
    }
    pts.push([Rr, hemY + 1], [78.5 + s, 88 + oy], [79, 78 + oy], [77, 70 + oy], [70, 66 + oy]);
    return pts;
  }

  /** @param {any} p @param {Rig} R @param {boolean} back */
  function drawFront(p, R, back) {
    const oy = R.dy;
    const hx = 64 + R.head[0], hy = 61 + R.head[1] + oy;
    // ---- the scythe behind the body (the back view: it is held in front of the figure)
    if (back && R.scy) {
      snath(p, R.scy);
      blade(p, R.scy);
    }
    // ---- the pole under the hem, the straw dangling from inside the coat
    p.begin('all', 1);
    capsule(p, [64, 96 + oy], 1.6, [64, G + oy - 0.5], 1.4, WOOD, { hi: 0.2, max: 3 });
    p.end();
    p.begin(null);
    for (let k = 0; k < 7; k++) {
      const x = 52 + k * 4 + R.stream * 2;
      strand(p, x, 101 + oy - R.flare * 2, Math.PI / 2 + (K.hash2(k, 5, 82) - 0.5) * 0.6, 4 + K.hash2(k, 6, 83) * 6, (K.hash2(k, 7, 84) - 0.5) * 0.6, 2, k % 3 === 1);
    }
    p.end();
    // ---- the coat
    const pts = coatFront(R, oy);
    p.begin('all', 1);
    slab(p, pts, COAT, (t, x, y) => {
      let s = t < 0.2 ? 3 : t < 0.56 ? 2 : 1;
      if (y < 74 + oy && t < 0.5) s = 3;
      // in the shade under the arms, and toward the hem
      if (y > 73 + oy && y < 84 + oy && (x < 54 || x > 74)) s -= 1;
      if (y > 99 + oy - R.flare * 2) s -= 1;
      const h = K.hash2(x, y, 11);
      if (h < 0.06) s -= 1;
      else if (h > 0.965) s += 1;
      return Math.min(3, Math.max(0, s));
    });
    p.end();
    p.begin(null);
    // folds below the belt (and the lit crease beside each)
    for (const fx of [54, 58, 71, 75]) {
      const k = fx < 64 ? -1 : 1;
      for (let y = 89 + oy; y < 104 + oy; y++) {
        const x = Math.round(fx + k * (y - 89 - oy) * 0.18 * (1 + R.flare) + R.stream * (y - 89 - oy) * 0.12);
        if (p.get(x, y) !== COAT) continue;
        p.set(x, y, COAT, 0);
        if (p.get(x - 1, y) === COAT && litLeft()) p.set(x - 1, y, COAT, Math.min(3, p.getShade(x - 1, y) + 1));
      }
    }
    p.end();
    if (R.open > 0) {
      // the coat thrown open: the lining on the flaps, the straw innards and the cross-pole
      const o = R.open;
      p.begin('all', 0);
      /** @type {Pt[]} */
      const inner = [[60 - o * 3, 70 + oy], [68 + o * 3, 70 + oy], [70 + o * 9, 100 + oy], [58 - o * 9, 100 + oy]];
      K.fillPoly(p, inner, STRAW, 1);
      p.end();
      p.begin(null);
      for (let y = 72 + oy; y < 100 + oy; y += 2) {
        for (let x = 52; x < 77; x++) {
          if (p.get(x, y) !== STRAW) continue;
          const h = K.hash2(x, y, 85);
          p.set(x, y, h < 0.35 ? STRAW2 : STRAW, h < 0.35 ? 1 : h < 0.7 ? 2 : 3);
        }
      }
      capsule(p, [64, 71 + oy], 1.3, [64, 100 + oy], 1.3, WOOD, { max: 2 });
      // the lining down both flaps' inner edges
      for (let y = 70 + oy; y < 102 + oy; y++) {
        const t = (y - 70 - oy) / 30;
        for (const side of [-1, 1]) {
          const x0 = 64 + side * (4 + o * 3 + t * o * 6);
          for (let k = 0; k < 3; k++) {
            const x = Math.round(x0 + side * k);
            if (p.get(x, y)) p.set(x, y, LINING, k === 0 ? 1 : 2);
          }
        }
      }
      p.end();
    } else if (!back) {
      // ---- the founder's apron where the flaps part below the belt, the belt, the brass buttons
      p.begin('all', 0);
      const sp = 2 + R.flare * 2;
      K.fillPoly(p, [[63, 87 + oy], [65, 87 + oy], [70 + sp + R.stream * 2, 104 + oy - R.flare * 2], [58 - sp + R.stream * 2, 104 + oy - R.flare * 2]], APRON, 2);
      p.end();
      p.begin(null);
      for (let y = 88 + oy; y < 106 + oy; y++) {
        for (let x = 54; x < 76; x++) {
          if (p.get(x, y) !== APRON) continue;
          const l = p.get(x - 1, y) !== APRON ? 3 : p.get(x + 1, y) !== APRON ? 1 : 2;
          const scorch = K.hash2(Math.floor(x / 2), Math.floor(y / 2), 86);
          p.set(x, y, scorch < 0.12 ? CHAR : APRON, scorch < 0.12 ? 1 : l);
        }
      }
      // the flaps' edges over the apron
      for (let y = 87 + oy; y < 104 + oy; y++) {
        for (const x of [Math.round(62 - (y - 87 - oy) * (0.25 + R.flare * 0.12) + R.stream * (y - 87 - oy) * 0.1), Math.round(66 + (y - 87 - oy) * (0.25 + R.flare * 0.12) + R.stream * (y - 87 - oy) * 0.1)]) {
          if (p.get(x, y) === APRON) p.set(x, y, COAT, 0);
        }
      }
      for (let x = 50; x < 79; x++) {
        if (p.get(x, 86 + oy) === COAT) p.set(x, 86 + oy, APRON, x < 58 ? 2 : 1);
        if (p.get(x, 87 + oy) === COAT) p.set(x, 87 + oy, APRON, 0);
      }
      p.set(63, 86 + oy, BRASS, 4); p.set(64, 86 + oy, BRASS, 3); p.set(65, 86 + oy, BRASS, 2);
      p.set(63, 87 + oy, BRASS, 2); p.set(65, 87 + oy, BRASS, 1);
      for (const by of [74, 80]) {
        p.set(64, by + oy, BRASS, 3); p.set(63, by + oy, BRASS, 4); p.set(64, by + 1 + oy, BRASS, 1);
      }
      // the button line: the flap's edge
      for (let y = 70 + oy; y < 86 + oy; y++) if (p.get(65, y) === COAT && y % 6 !== 1) p.set(65, y, COAT, 0);
      // a leather patch on the right breast
      for (let y = 76; y < 80; y++) for (let x = 70; x < 74; x++) if (p.get(x, y + oy) === COAT) p.set(x, y + oy, PATCH, y === 76 ? 3 : 2);
      for (const [x, y] of [[69, 76], [69, 78], [74, 77], [71, 80]]) if (p.get(x, y + oy)) p.set(x, y + oy, THREAD, 1);
      p.end();
    } else {
      // ---- the back: the centre seam to the vent, the belt across
      p.begin(null);
      for (let y = 72 + oy; y < 104 + oy; y++) {
        const x = Math.round(64 + R.stream * (y - 88 - oy) * 0.12 * (y > 88 + oy ? 1 : 0));
        if (p.get(x, y) === COAT) p.set(x, y, COAT, y > 92 + oy ? 0 : 1);
      }
      for (let x = 50; x < 79; x++) {
        if (p.get(x, 85 + oy) === COAT) p.set(x, 85 + oy, APRON, 1);
        if (p.get(x, 86 + oy) === COAT) p.set(x, 86 + oy, APRON, 0);
      }
      p.end();
    }
    // ---- the burns: scorched holes, straw showing through
    p.begin(null);
    if (!back) {
      burn(p, 57.5, 77 + oy, 1.5);
      burn(p, 54, 97 + oy, 1.4);
      burn(p, 75, 93 + oy, 2.1);
    } else {
      burn(p, 58, 80 + oy, 2.0);
      burn(p, 71, 74 + oy, 1.3);
      burn(p, 69, 98 + oy, 1.6);
    }
    p.end();
    // ---- the collar turned up round the neck
    p.begin('all', 1);
    K.fillPoly(p, [[55, 66 + oy], [61, 65 + oy], [61, 71 + oy], [57, 72 + oy]], COAT, litLeft() ? 3 : 2);
    K.fillPoly(p, [[67, 65 + oy], [73, 66 + oy], [71, 72 + oy], [67, 71 + oy]], COAT, litLeft() ? 1 : 3);
    p.end();
    // ---- the straw bursting from the neck, the drawstring
    p.begin(null);
    tuft(p, hx, hy + 6, Math.PI / 2, 1.3, 7, 4.5, 3);
    p.end();
    // ---- the head: the sack
    p.begin('all', 1);
    ball(p, hx, hy, 7.2, 7.4, SACK, { maxShade: 3, hi: 0.45 });
    // the gathered neck of the sack
    capsule(p, [hx - 3, hy + 6], 2, [hx + 3, hy + 6], 2, SACK, { max: 2 });
    p.end();
    p.begin(null);
    // the weave and a seam
    for (let y = Math.floor(hy - 7); y <= hy + 8; y++) {
      for (let x = Math.floor(hx - 8); x <= hx + 8; x++) {
        if (p.get(x, y) !== SACK) continue;
        const s = p.getShade(x, y);
        if ((x + y) % 2 === 0 && K.hash2(x, y, 87) < 0.16) p.set(x, y, SACK, Math.max(0, s - 1));
        else if ((x * 3 + y) % 7 === 0 && s < 3) p.set(x, y, SACK, s + 1);
      }
    }
    // the drawstring and its knot
    for (let x = Math.round(hx - 4); x <= Math.round(hx + 4); x++) if (p.get(x, Math.round(hy + 6))) p.set(x, Math.round(hy + 6), THREAD, x % 2 ? 1 : 2);
    p.set(Math.round(hx - 3), Math.round(hy + 7), THREAD, 2);
    p.set(Math.round(hx - 4), Math.round(hy + 8), THREAD, 1);
    p.set(Math.round(hx - 3), Math.round(hy + 9), THREAD, 1);
    if (!back) {
      // the face: two stitched eyes that glow, a stitched mouth, a sewn patch on the cheek
      const up = R.tilt > 0 ? -1 : R.tilt < 0 ? 1 : 0;
      const ey = Math.round(hy - 1 + up);
      for (const ex of [Math.round(hx - 3.5), Math.round(hx + 3)]) {
        if (R.eyes) {
          p.set(ex, ey, GLOW, 4);
          p.set(ex - 1, ey - 1, GLOW, 3); p.set(ex + 1, ey + 1, GLOW, 3);
          p.set(ex + 1, ey - 1, GLOW, 3); p.set(ex - 1, ey + 1, GLOW, 2);
        } else {
          p.set(ex - 1, ey - 1, THREAD, 0); p.set(ex + 1, ey + 1, THREAD, 0);
          p.set(ex + 1, ey - 1, THREAD, 0); p.set(ex - 1, ey + 1, THREAD, 0); p.set(ex, ey, THREAD, 1);
        }
      }
      const my = Math.round(hy + 3 + up);
      for (let x = Math.round(hx - 4); x <= Math.round(hx + 4); x++) p.set(x, my + (x % 2 === 0 ? 0 : (R.tilt < 0 ? 1 : 0)), THREAD, 0);
      for (const x of [Math.round(hx - 3), Math.round(hx - 1), Math.round(hx + 1), Math.round(hx + 3)]) { p.set(x, my - 1, THREAD, 1); p.set(x, my + 1, THREAD, 1); }
      for (let y = Math.round(hy - 5); y <= Math.round(hy - 3); y++) for (let x = Math.round(hx + 3); x <= Math.round(hx + 5); x++) if (p.get(x, y) === SACK) p.set(x, y, PATCH, 2);
      p.set(Math.round(hx + 2), Math.round(hy - 4), THREAD, 1);
      p.set(Math.round(hx + 6), Math.round(hy - 4), THREAD, 1);
    } else {
      for (let y = Math.round(hy - 6); y <= Math.round(hy + 5); y++) if (p.get(Math.round(hx), y) === SACK) p.set(Math.round(hx), y, THREAD, y % 2 ? 1 : 2);
    }
    p.end();
    // ---- the hat
    drawHat(p, hx, hy - 6, R.tilt, false);
    // ---- the arms (the viewer's left one, then the right)
    const shL = [53, 72 + oy], shR = [75, 72 + oy];
    arm(p, /** @type {Pt} */ (shL), R.aL, false, 11, !back);
    arm(p, /** @type {Pt} */ (shR), R.aR, false, 12, back);
    // rime on the shoulders and along the sleeves' tops
    p.begin(null);
    rime(p, 28, 100, [COAT], 5, 63 + oy);
    p.end();
    // ---- the scythe in front (front view), the hands round the snath
    if (!back && R.scy) {
      snath(p, R.scy);
      blade(p, R.scy);
    }
    if (R.scy) {
      if (R.grip.includes('L')) hand(p, R.aL[0], R.aL[1], 21);
      if (R.grip.includes('R')) hand(p, R.aR[0], R.aR[1], 22);
    }
    if (R.feathers) feathers(p, 64, 82 + oy);
    flyingStraw(p, R, 64, 86 + oy);
  }

  /**
   * The hat: a dented, crooked crown and a wide floppy brim, its band, rime on the brim; the brim
   * centre (x, y); `tilt` 1 tips it back, −1 down over the face; `side`: the profile.
   */
  function drawHat(p, x, y, tilt, side) {
    const by = y + (tilt > 0 ? -1 : tilt < 0 ? 1 : 0);
    const rx = side ? 15 : 15.5, ry = side ? 2.4 : 3.2;
    // the crown behind the brim's back edge
    p.begin('all', 1);
    /** @type {Pt[]} */
    const crown = side
      ? [[x - 6, by + 0.5], [x - 5, by - 7], [x - 1, by - 10.5], [x + 3, by - 9.5], [x + 6, by - 7.5], [x + 7, by + 0.5]]
      : [[x - 7, by + 0.5], [x - 6, by - 6.5], [x - 4, by - 10], [x - 0.5, by - 9], [x + 2, by - 10.5], [x + 5.5, by - 8], [x + 6.5, by - 4], [x + 7, by + 0.5]];
    slab(p, crown, HAT, (t, xx, yy) => {
      let s = t < 0.3 ? 3 : t < 0.7 ? 2 : 1;
      if (yy > by - 3) s -= 1;
      if (K.hash2(xx, yy, 88) < 0.08) s -= 1;
      return Math.max(0, s);
    });
    p.end();
    // the dent in the crown's top
    p.begin(null);
    if (!side) {
      for (let k = -1; k <= 1; k++) if (p.get(Math.round(x + k), Math.round(by - 8.5)) === HAT) p.set(Math.round(x + k), Math.round(by - 8.5), HAT, 0);
    }
    // the band
    for (let xx = Math.round(x - 7); xx <= Math.round(x + 7); xx++) {
      for (const yy of [Math.round(by - 2), Math.round(by - 1)]) if (p.get(xx, yy) === HAT) p.set(xx, yy, BAND, yy === Math.round(by - 2) ? 2 : 1);
    }
    p.end();
    // the brim: a wide ellipse drooping at its ends (more on the right), dark underneath
    p.begin('all', 0);
    for (let yy = Math.floor(by - ry - 3); yy <= Math.ceil(by + ry + 4); yy++) {
      for (let xx = Math.floor(x - rx - 1); xx <= Math.ceil(x + rx + 1); xx++) {
        const u = (xx + 0.5 - x) / rx;
        if (Math.abs(u) > 1) continue;
        const droop = (u > 0 ? 2.6 : 1.6) * u * u * u * u * (side ? 1.3 : 1) + (tilt < 0 ? Math.abs(u) * 1.5 : 0) - (tilt > 0 ? (1 - Math.abs(u)) * 0.8 : 0);
        const cy = by + droop;
        const v = (yy + 0.5 - cy) / ry;
        const edge = Math.sqrt(Math.max(0, 1 - u * u));
        if (Math.abs(v) > edge) continue;
        // the top surface (lit toward the light), the underside dark
        const top = v < 0;
        let s = top ? (u * (LX < 0 ? -1 : 1) > 0.15 ? 3 : 2) : (v > edge * 0.45 ? 0 : 1);
        if (K.hash2(xx, yy, 89) < 0.1) s = Math.max(0, s - 1);
        p.set(xx, yy, HAT, s);
      }
    }
    p.end();
    p.begin(null);
    rime(p, x - rx, x + rx, [HAT, BAND], 9);
    // a frayed nick out of the brim
    p.set(Math.round(x - rx * 0.6), Math.round(by + 2), HAT, 0);
    p.end();
  }

  /** Dark feathers loosed from the opened coat (the brain's crows follow). */
  function feathers(p, x, y) {
    p.begin('all', 0);
    for (const [dx, dy, a] of [[-14, -16, -0.5], [12, -20, 0.6], [-4, -26, -0.1], [20, -8, 0.9]]) {
      const cx = x + dx, cy = y + dy;
      for (let k = -2; k <= 2; k++) {
        p.set(Math.round(cx + Math.cos(a) * k), Math.round(cy + Math.sin(a) * k), CHAR, k === -2 ? 2 : 1);
      }
      p.set(Math.round(cx - Math.sin(a)), Math.round(cy + Math.cos(a)), CHAR, 0);
    }
    p.end();
  }

  /** Bits of straw thrown off the figure (`R.straw` of them, fixed spots round (x, y)). @param {Rig} R */
  function flyingStraw(p, R, x, y) {
    if (!R.straw) return;
    p.begin(null);
    // a few wisps of two or three straws each, thrown out from the figure (fewer, longer: a lone
    // short straw under the outline reads as a grain)
    const n = Math.min(4, Math.ceil(R.straw / 2));
    for (let k = 0; k < n; k++) {
      const a = (K.hash2(k, 3, 91) - 0.5) * 2.4 + (k % 2 ? 0 : Math.PI);
      const d = 20 + K.hash2(k, 4, 92) * 10;
      const sx = x + Math.cos(a) * d, sy = y - 6 + Math.sin(a) * d * 0.5;
      if (sx < 6 || sx > FW - 8 || sy < 6 || sy > G - 6) continue;
      const da = a + Math.PI / 2 + (K.hash2(k, 5, 93) - 0.5);
      for (let j = 0; j < 2 + (k % 2); j++) strand(p, sx + j * 1.2, sy + j, da + j * 0.15, 6 + K.hash2(k, j, 94) * 3, 0.3, 2, j === 1);
    }
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // The side view (facing left)
  // ---------------------------------------------------------------------------------------------

  /** @param {any} p @param {Rig} R */
  function drawSide(p, R) {
    const oy = R.dy;
    const f = R.flare, s = R.stream;
    const hx = 62 + R.head[0], hy = 61 + R.head[1] + oy;
    const shN = /** @type {Pt} */ ([63, 73 + oy]), shF = /** @type {Pt} */ ([69, 72 + oy]);
    // ---- the far arm behind the body
    arm(p, shF, R.aL, true, 13, false);
    if (R.scy && R.grip.includes('L') && !R.grip.includes('R')) hand(p, R.aL[0], R.aL[1], 23);
    // ---- the pole, the dangling straw
    p.begin('all', 1);
    capsule(p, [66, 96 + oy], 1.6, [66, G + oy - 0.5], 1.4, WOOD, { hi: 0.2, max: 3 });
    p.end();
    p.begin(null);
    for (let k = 0; k < 5; k++) {
      strand(p, 56 + k * 5 + s * 3, 101 + oy - f * 2, Math.PI / 2 + (K.hash2(k, 8, 82) - 0.5) * 0.7 + s * 0.3, 4 + K.hash2(k, 9, 83) * 6, (K.hash2(k, 10, 84) - 0.5) * 0.6, 2, k % 3 === 1);
    }
    p.end();
    // ---- the coat in profile: the front edge (left), the tails (right), a ragged hem
    const hemY = 104 + oy - f * 2;
    const front = 52 - f * 3 - R.open * 4, back = 79 + f * 6 + s * 6;
    /** @type {Pt[]} */
    const pts = [[59, 67 + oy], [57, 71 + oy], [55, 78 + oy], [55, 88 + oy], [front, hemY]];
    const n = 7;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const tatter = k % 2 === 0 ? 2 + K.hash2(k, 11, 81) * 2.5 : -0.5;
      pts.push([front + (back - front) * t, hemY + tatter - t * t * (f * 4 + Math.abs(s) * 3)]);
    }
    pts.push([back, hemY - f * 4 - Math.abs(s) * 3], [75 + s * 2, 88 + oy], [74, 78 + oy], [72, 70 + oy], [69, 67 + oy]);
    p.begin('all', 1);
    slab(p, pts, COAT, (t, x, y) => {
      let v = t < 0.24 ? 3 : t < 0.6 ? 2 : 1;
      if (y < 74 + oy && t < 0.5) v = 3;
      const h = K.hash2(x, y, 12);
      if (h < 0.06) v -= 1;
      else if (h > 0.965) v += 1;
      return Math.min(3, Math.max(0, v));
    });
    p.end();
    p.begin(null);
    // the tails' fold and the vent
    for (let y = 89 + oy; y < 104 + oy; y++) {
      const x = Math.round(70 + (y - 89 - oy) * (0.35 + f * 0.2 + s * 0.2));
      if (p.get(x, y) === COAT) p.set(x, y, COAT, 0);
      const x2 = Math.round(62 + (y - 89 - oy) * 0.1);
      if (p.get(x2, y) === COAT) p.set(x2, y, COAT, 1);
    }
    if (R.open > 0) {
      // the front flap thrown forward: its lining, the straw inside
      for (let y = 70 + oy; y < 100 + oy; y++) {
        for (let k = 0; k < 3 + R.open * 2; k++) {
          const x = Math.round(56 - (y - 70 - oy) * 0.12 * R.open + k);
          if (p.get(x, y)) p.set(x, y, k < 2 ? LINING : STRAW, k < 2 ? 1 + (k === 1 ? 1 : 0) : 2);
        }
      }
    } else {
      // the apron's edge at the front below the belt, the belt, the buttons down the front edge
      for (let y = 88 + oy; y < 104 + oy; y++) {
        for (let k = 0; k < 2; k++) {
          const x = Math.round(56 - (y - 88 - oy) * 0.18 * (1 + f)) + k;
          if (p.get(x, y) === COAT) p.set(x, y, APRON, k === 0 ? 3 : 2);
        }
      }
      for (const by of [75, 81]) { p.set(56, by + oy, BRASS, 4); p.set(57, by + oy, BRASS, 2); }
    }
    for (let x = 54; x < 77; x++) {
      if (p.get(x, 86 + oy) === COAT) p.set(x, 86 + oy, APRON, x < 62 ? 2 : 1);
      if (p.get(x, 87 + oy) === COAT) p.set(x, 87 + oy, APRON, 0);
    }
    p.set(56, 86 + oy, BRASS, 3);
    p.end();
    p.begin(null);
    burn(p, 66, 81 + oy, 1.7);
    burn(p, 72, 97 + oy - f, 1.6);
    p.end();
    // ---- the collar
    p.begin('all', 1);
    K.fillPoly(p, [[60, 64 + oy], [66, 65 + oy], [66, 71 + oy], [60, 71 + oy]], COAT, 3);
    K.fillPoly(p, [[66, 65 + oy], [71, 66 + oy], [70, 72 + oy], [66, 71 + oy]], COAT, 1);
    p.end();
    p.begin(null);
    tuft(p, hx + 2, hy + 6, Math.PI / 2 + 0.25, 1.2, 6, 4.5, 4);
    p.end();
    // ---- the head in profile: the sack, rounder at the back, its face to the left
    p.begin('all', 1);
    ball(p, hx, hy, 6.4, 7.4, SACK, { maxShade: 3, hi: 0.45 });
    ball(p, hx - 3.5, hy + 1.5, 3.2, 3.6, SACK, { maxShade: 3, hi: 0.5 });
    capsule(p, [hx, hy + 6], 2, [hx + 3, hy + 6], 2, SACK, { max: 2 });
    p.end();
    p.begin(null);
    for (let y = Math.floor(hy - 7); y <= hy + 8; y++) {
      for (let x = Math.floor(hx - 8); x <= hx + 8; x++) {
        if (p.get(x, y) !== SACK) continue;
        const v = p.getShade(x, y);
        if ((x + y) % 2 === 0 && K.hash2(x, y, 87) < 0.16) p.set(x, y, SACK, Math.max(0, v - 1));
        else if ((x * 3 + y) % 7 === 0 && v < 3) p.set(x, y, SACK, v + 1);
      }
    }
    for (let x = Math.round(hx - 2); x <= Math.round(hx + 4); x++) if (p.get(x, Math.round(hy + 6))) p.set(x, Math.round(hy + 6), THREAD, x % 2 ? 1 : 2);
    p.set(Math.round(hx + 4), Math.round(hy + 7), THREAD, 2);
    p.set(Math.round(hx + 5), Math.round(hy + 8), THREAD, 1);
    const up = R.tilt > 0 ? -1 : R.tilt < 0 ? 1 : 0;
    const ex = Math.round(hx - 4), ey = Math.round(hy - 1 + up);
    if (R.eyes) {
      p.set(ex, ey, GLOW, 4); p.set(ex - 1, ey - 1, GLOW, 3); p.set(ex + 1, ey + 1, GLOW, 3); p.set(ex + 1, ey - 1, GLOW, 2); p.set(ex - 1, ey + 1, GLOW, 3);
    } else {
      p.set(ex - 1, ey - 1, THREAD, 0); p.set(ex + 1, ey + 1, THREAD, 0); p.set(ex + 1, ey - 1, THREAD, 0); p.set(ex - 1, ey + 1, THREAD, 0);
    }
    for (let x = Math.round(hx - 7); x <= Math.round(hx - 3); x++) p.set(x, Math.round(hy + 3 + up) + (x % 2 ? 0 : 1), THREAD, 0);
    // the back seam of the sack
    for (let y = Math.round(hy - 5); y <= Math.round(hy + 4); y++) if (p.get(Math.round(hx + 3), y) === SACK && y % 2) p.set(Math.round(hx + 3), y, THREAD, 1);
    p.end();
    drawHat(p, hx + 1, hy - 6, R.tilt, true);
    // ---- the near arm, the scythe, the hands
    arm(p, shN, R.aR, false, 14, true);
    p.begin(null);
    rime(p, 30, 96, [COAT], 6, 63 + oy);
    p.end();
    if (R.scy) {
      snath(p, R.scy);
      blade(p, R.scy);
      if (R.grip.includes('R')) hand(p, R.aR[0], R.aR[1], 24);
      if (R.grip.includes('L') && R.grip.includes('R')) hand(p, R.aL[0], R.aL[1], 25);
    }
    if (R.feathers) feathers(p, 56, 82 + oy);
    flyingStraw(p, R, 64, 86 + oy);
  }

  // ---------------------------------------------------------------------------------------------
  // The collapse and the heap
  // ---------------------------------------------------------------------------------------------

  /**
   * A mound of straw at (x, y): a heap of strands, darker underneath, lit on top; `seed` varies it.
   */
  function mound(p, x, y, rx, ry, seed) {
    p.begin('all', 1);
    ball(p, x, y, rx, ry, STRAW, { maxShade: 3, hi: 0.35, lo: -0.35 });
    p.end();
    p.begin(null);
    for (let yy = Math.floor(y - ry); yy <= y + ry; yy++) {
      for (let xx = Math.floor(x - rx); xx <= x + rx; xx++) {
        if (p.get(xx, yy) !== STRAW) continue;
        const h = K.hash2(xx, yy, seed);
        if ((xx * 2 + yy * 3) % 5 === 0 || h < 0.18) p.set(xx, yy, STRAW2, Math.max(0, p.getShade(xx, yy) - 1));
      }
    }
    // straws sticking out of the heap
    for (let k = 0; k < 14; k++) {
      const a = Math.PI + (k / 13) * Math.PI + (K.hash2(k, seed, 94) - 0.5) * 0.3;
      const ex = x + Math.cos(a) * rx * 0.92, ey = y + Math.sin(a) * ry * 0.92;
      strand(p, ex, ey, a + (K.hash2(k, seed, 95) - 0.5) * 0.8, 3 + K.hash2(k, seed, 96) * 4, (K.hash2(seed, k, 97) - 0.5) * 0.8, 2, k % 4 === 1);
    }
    p.end();
  }

  /**
   * The coat laid over the heap, seen from the front so it reads at a glance as a coat: the two
   * shoulders, the turned-up collar and its lapels in a V, the front opening with its brass buttons,
   * the belt, a ragged hem over the straw, both sleeves hanging down to the ground with straw at
   * their cuffs, the burns.
   */
  function drapedCoat(p, x0, x1, top, bottom, seed) {
    const mid = Math.round((x0 + x1) / 2);
    // the sleeves first: they hang from the shoulders down the heap's sides
    arm(p, [x0 + 9, top + 5], [x0 - 1, bottom], true, seed + 1, false);
    arm(p, [x1 - 9, top + 5], [x1 + 2, bottom - 1], true, seed + 2, false);
    p.begin('all', 1);
    /** @type {Pt[]} */
    const pts = [[x0 + 3, top + 7], [x0 + 9, top + 2], [mid - 5, top + 1], [mid, top + 4], [mid + 5, top + 1], [x1 - 9, top + 2], [x1 - 3, top + 7], [x1 - 1, bottom - 3]];
    const n = 9;
    for (let k = 1; k < n; k++) pts.push([x1 - 1 - (x1 - x0 - 2) * k / n, bottom - 2 + (k % 2 ? 1.5 : -0.5)]);
    pts.push([x0 + 1, bottom - 3]);
    slab(p, pts, COAT, (t, x, y) => {
      let v = t < 0.22 ? 3 : t < 0.62 ? 2 : 1;
      if (y < top + 5) v = Math.min(3, v + 1);
      if (y > bottom - 5) v -= 1;
      if (K.hash2(x, y, seed) < 0.06) v -= 1;
      return Math.max(0, Math.min(3, v));
    });
    p.end();
    // the collar's dark opening (the lining inside it), the lapels and the turned-up collar round the V
    p.begin(null);
    K.fillPoly(p, [[mid - 5, top + 1], [mid + 5, top + 1], [mid, top + 8]], LINING, 0);
    p.end();
    p.begin('all', 0);
    K.fillPoly(p, [[mid - 7, top], [mid - 1, top + 3], [mid - 1, top + 9], [mid - 5, top + 5]], COAT, 3);
    K.fillPoly(p, [[mid + 7, top], [mid + 1, top + 3], [mid + 1, top + 9], [mid + 5, top + 5]], COAT, 1);
    p.end();
    p.begin(null);
    // the opening down from the V, the flap's edge, the buttons, the belt, the apron's sliver
    for (let y = top + 9; y < bottom - 1; y++) {
      const x = Math.round(mid + (y - top - 9) * 0.12);
      if (p.get(x, y) === COAT) p.set(x, y, COAT, 0);
      if (p.get(x + 1, y) === COAT) p.set(x + 1, y, COAT, 1);
      if (y > top + 14 && p.get(x - 1, y) === COAT && y % 3 !== 0) p.set(x - 1, y, APRON, 2);
    }
    for (const by of [top + 8, top + 12]) { p.set(mid - 2, by, BRASS, 4); p.set(mid - 2, by + 1, BRASS, 1); p.set(mid - 3, by, BRASS, 2); }
    for (let x = x0 + 4; x <= x1 - 4; x++) {
      if (p.get(x, top + 15) === COAT) p.set(x, top + 15, APRON, x < mid ? 2 : 1);
      if (p.get(x, top + 16) === COAT) p.set(x, top + 16, APRON, 0);
    }
    p.set(mid, top + 15, BRASS, 4); p.set(mid + 1, top + 15, BRASS, 2); p.set(mid, top + 16, BRASS, 1);
    // folds where it drapes over the straw
    for (const [fx, k] of [[x0 + 8, -0.25], [x0 + 15, -0.1], [x1 - 14, 0.1], [x1 - 7, 0.25]]) {
      for (let y = top + 6; y < bottom - 1; y++) {
        const x = Math.round(fx + (y - top) * k);
        if (p.get(x, y) === COAT) p.set(x, y, COAT, 0);
      }
    }
    // a leather patch on the left breast
    for (let y = top + 6; y < top + 9; y++) for (let x = mid - 11; x < mid - 7; x++) if (p.get(x, y) === COAT) p.set(x, y, PATCH, y === top + 6 ? 3 : 2);
    p.end();
    p.begin(null);
    burn(p, x1 - 11, top + 9, 2.0);
    burn(p, x0 + 9, bottom - 6, 1.5);
    burn(p, mid + 6, bottom - 5, 1.2);
    rime(p, x0, x1, [COAT], seed, top - 2);
    p.end();
  }

  /** A sack head lying (eyes dark unless `glow`), at (x, y). */
  function lyingHead(p, x, y, glow, tiltL) {
    p.begin('all', 1);
    ball(p, x, y, 6.6, 6, SACK, { maxShade: 3 });
    p.end();
    p.begin(null);
    for (let yy = Math.floor(y - 6); yy <= y + 6; yy++) {
      for (let xx = Math.floor(x - 7); xx <= x + 7; xx++) {
        if (p.get(xx, yy) !== SACK) continue;
        if ((xx + yy) % 2 === 0 && K.hash2(xx, yy, 87) < 0.35) p.set(xx, yy, SACK, Math.max(0, p.getShade(xx, yy) - 1));
      }
    }
    const ex0 = Math.round(x - 3), ex1 = Math.round(x + 2), ey = Math.round(y - 1 + (tiltL ? 1 : 0));
    for (const [ex, dy] of [[ex0, 0], [ex1, tiltL ? -1 : 0]]) {
      const yy = ey + dy;
      if (glow) { p.set(ex, yy, GLOW, 3); p.set(ex - 1, yy - 1, GLOW, 2); p.set(ex + 1, yy + 1, GLOW, 2); }
      else { p.set(ex - 1, yy - 1, THREAD, 0); p.set(ex + 1, yy + 1, THREAD, 0); p.set(ex + 1, yy - 1, THREAD, 0); p.set(ex - 1, yy + 1, THREAD, 0); }
    }
    for (let xx = Math.round(x - 3); xx <= Math.round(x + 3); xx++) p.set(xx, Math.round(y + 3) + (xx % 2 ? 0 : 1), THREAD, 0);
    // the burst neck, straw spilling
    tuft(p, x + 5, y + 3, 0.4, 0.9, 6, 4, 6);
    p.end();
  }

  /** A hat fallen on the ground at (x, y): the brim flat, the crown crumpled. */
  function fallenHat(p, x, y) {
    p.begin('all', 0);
    for (let yy = y - 3; yy <= y + 2; yy++) {
      for (let xx = x - 12; xx <= x + 12; xx++) {
        const u = (xx + 0.5 - x) / 12, v = (yy + 0.5 - y) / 2.2;
        if (u * u + v * v > 1) continue;
        p.set(xx, yy, HAT, v < 0 ? (u < 0 ? 3 : 2) : 1);
      }
    }
    p.end();
    p.begin('all', 1);
    K.fillPoly(p, [[x - 6, y - 1], [x - 4, y - 7], [x + 1, y - 8], [x + 5, y - 5], [x + 6, y - 1]], HAT, 2);
    p.end();
    p.begin(null);
    for (let xx = x - 6; xx <= x + 6; xx++) if (p.get(xx, y - 2) === HAT) p.set(xx, y - 2, BAND, 1);
    rime(p, x - 12, x + 12, [HAT, BAND], 31);
    p.end();
  }

  /**
   * collapse0–2 and the heap (every view: a heap reads the same from each side; the back view is
   * flipped like the others, its head shown from behind).
   * @param {any} p @param {string} key @param {'down'|'up'|'side'} view
   */
  function drawFall(p, key, view) {
    const back = view === 'up';
    if (key === 'collapse0') {
      // staggering: the figure leaning, straw bursting from the seams and burns, the scythe slipping
      /** @type {Rig} */
      const R = {
        ...REST, lean: 0.13, flare: 0.8, head: [3, 3], tilt: -1, aL: [42, 95], aR: [86, 96], straw: 9, grip: 'R',
        scy: { B: [104, 66], T: [78, 120], a: 8, curl: -1, bl: 24 },
      };
      if (view === 'side') {
        drawSide(p, { ...R, head: [-2, 3], aL: [76, 92], aR: [52, 96], scy: { B: [42, 66], T: [30, 121], a: 182, curl: 1, bl: 22 } });
      } else drawFront(p, R, back);
      p.begin(null);
      for (const [x, y, a] of [[56, 78, 2.6], [76, 94, 0.3], [54, 97, 2.9], [62, 70, -1.9], [70, 70, -1.2]]) tuft(p, x, y, a, 0.6, 5, 6, x);
      p.end();
      return;
    }
    if (key === 'collapse1') {
      // falling apart: the body sagging on its pole, the head tipping off, the coat sliding, the
      // scythe dropped on the ground
      /** @type {Rig} */
      const R = { ...REST, dy: 14, lean: 0.18, flare: 1.2, head: [0, 0], aL: [44, 110], aR: [82, 112], straw: 6, scy: null };
      const sc = { B: [18, 120], T: [80, 123], a: -6, curl: -1, bl: 20 };
      snath(p, /** @type {Scythe} */ (sc));
      blade(p, /** @type {Scythe} */ (sc));
      if (view === 'side') drawSide(p, { ...R, head: [0, 0] });
      else drawFront(p, R, back);
      // the head is gone from the neck: the tuft gushes there, the head rolls off to the right
      p.begin(null);
      for (let y = 40; y < 86; y++) for (let x = 44; x < 86; x++) {
        const m = p.get(x, y);
        if (m === SACK || m === HAT || m === BAND || m === GLOW || m === THREAD || m === PATCH || (m === RIME && y < 74)) { p.mat[y * FW + x] = 0; }
      }
      p.end();
      p.begin(null);
      tuft(p, 64, 82, -Math.PI / 2, 1.2, 9, 7, 8);
      p.end();
      lyingHead(p, 94, 104, true, true);
      fallenHat(p, 104, 120);
      return;
    }
    if (key === 'collapse2') {
      // crumpled low: a mound of straw, the coat slumped over it, the head beside, the scythe lying
      const sc = { B: [20, 119], T: [84, 123], a: -4, curl: -1, bl: 20 };
      snath(p, /** @type {Scythe} */ (sc));
      blade(p, /** @type {Scythe} */ (sc));
      mound(p, 64, 114, 26, 11, 41);
      drapedCoat(p, 42, 88, 100, 122, 42);
      lyingHead(p, back ? 92 : 36, 115, false, false);
      fallenHat(p, back ? 30 : 100, 122);
      return;
    }
    // the heap: low, the coat over it — the clue's place
    mound(p, 64, 116, 31, 9, 51);
    // the snath behind the heap, the blade melted to a shard in front
    const sc = { B: [30, 109], T: [98, 111], a: 0, curl: 1, bl: 0, melt: true };
    p.begin('all', 1);
    capsule(p, [26, 112], 1.1, [42, 110], 1.1, WOOD, { max: 3 });
    capsule(p, [88, 110], 1.1, [101, 108], 1.1, WOOD, { max: 3 });
    p.end();
    drapedCoat(p, 40, 90, 103, 124, 52);
    lyingHead(p, back ? 90 : 38, 104, false, false);
    blade(p, /** @type {Scythe} */ ({ ...sc, T: [70, 123], a: 190, curl: -1, bl: 16 }));
    p.begin(null);
    for (const [x, y] of [[32, 123], [96, 124], [26, 121]]) strand(p, x, y, -0.2, 5, 0.2, 2, false);
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // The rigs
  // ---------------------------------------------------------------------------------------------

  /** The rest rig (front view): standing on its pole, arms out and drooping, the scythe upright in its right hand. @type {Rig} */
  const REST = Object.freeze({
    dy: 0, lean: 0, flare: 0, open: 0, stream: 0, head: /** @type {Pt} */ ([0, 0]), tilt: 0,
    aL: /** @type {Pt} */ ([37, 80]), aR: /** @type {Pt} */ ([92, 80]), grip: 'R', scy: null, straw: 0, ground: 0, eyes: true,
  });

  /**
   * The snath through a hand: at `g` (0 butt … 1 head) of its `L` px, at `deg` from upright
   * (clockwise on screen), and its blade.
   * @param {Pt} H @param {number} deg @param {number} L @param {number} g
   * @param {number} a @param {number} curl @param {number} bl
   * @returns {Scythe}
   */
  function held(H, deg, L, g, a, curl, bl = 26) {
    const ux = Math.sin(deg * DEG), uy = -Math.cos(deg * DEG);
    return { B: [H[0] - ux * g * L, H[1] - uy * g * L], T: [H[0] + ux * (1 - g) * L, H[1] + uy * (1 - g) * L], a, curl, bl };
  }

  /** Shift a rig's points by dy (its arms and scythe). @param {Rig} R @returns {Rig} */
  function sunk(R) {
    const d = R.dy;
    if (!d) return R;
    const mv = (/** @type {Pt} */ q) => /** @type {Pt} */ ([q[0], q[1] + d]);
    return { ...R, aL: mv(R.aL), aR: mv(R.aR), scy: R.scy ? { ...R.scy, B: mv(R.scy.B), T: mv(R.scy.T) } : null };
  }

  /**
   * The front rig of a pose (the back view uses it too).
   * @param {string} key
   * @returns {Rig}
   */
  function frontRig(key) {
    /** @type {(o: Partial<Rig>) => Rig} */
    const r = (o) => ({ ...REST, ...o });
    const upright = (/** @type {Pt} */ H, deg = 5) => held(H, deg, 66, 0.36, 172, -1);
    switch (key) {
      case 'idle0': return r({ lean: -0.02, stream: 0.2, scy: upright([92, 80]) });
      case 'idle1': return r({ dy: 1, stream: -0.1, aL: [37, 81], aR: [92, 80], scy: upright([92, 80], 4) });
      case 'idle2': return r({ lean: 0.02, stream: -0.35, aL: [37, 79], scy: upright([92, 80], 6) });
      case 'walk0': return r({ lean: 0.04, flare: 0.2, stream: 0.4, scy: upright([92, 80], 8) });
      case 'walk1': return r({ dy: 3, flare: 0.7, stream: 0.2, aL: [37, 75], aR: [92, 76], scy: upright([92, 76], 6) });
      case 'walk2': return r({ dy: -7, lean: -0.04, flare: 0.2, stream: 0.7, aL: [39, 85], aR: [91, 84], straw: 2, scy: upright([91, 84], 2) });
      case 'walk3': return r({ dy: 2, flare: 1.1, stream: 0.1, aL: [36, 83], aR: [92, 84], straw: 3, ground: 1, scy: upright([92, 84], 9) });
      case 'reapWind': return r({
        lean: 0.05, flare: 0.3, stream: 0.4, aL: [62, 84], aR: [84, 66], grip: 'LR',
        scy: { B: [50, 93], T: [107, 47], a: 98, curl: 1, bl: 26 },
      });
      case 'reap': return r({
        lean: -0.06, flare: 1.0, stream: -0.6, aL: [64, 92], aR: [78, 89], grip: 'LR', straw: 2,
        scy: { B: [90, 86], T: [36, 104], a: 152, curl: 1, bl: 26 },
      });
      case 'reapEnd': return r({
        lean: -0.08, flare: 0.6, stream: -1, aL: [46, 78], aR: [56, 83], grip: 'LR', straw: 3,
        scy: { B: [68, 92], T: [26, 58], a: -118, curl: -1, bl: 24 },
      });
      case 'spinWind': return r({
        flare: 0.8, open: 0.25, tilt: 1, aL: [47, 47], aR: [82, 46], grip: 'LR',
        scy: { B: [30, 47], T: [100, 42], a: -82, curl: -1, bl: 26 },
      });
      case 'spin0': return r({
        flare: 1.5, stream: -1, lean: -0.03, aL: [58, 87], aR: [70, 86], grip: 'LR', straw: 5,
        scy: { B: [96, 84], T: [28, 90], a: 112, curl: 1, bl: 24, blur: 1 },
      });
      case 'spin1': return r({
        flare: 1.5, stream: 1, lean: 0.03, aL: [58, 86], aR: [70, 87], grip: 'LR', straw: 5,
        scy: { B: [32, 84], T: [100, 90], a: 68, curl: -1, bl: 24, blur: -1 },
      });
      case 'volley': return r({
        flare: 0.6, open: 1, tilt: 1, aL: [33, 57], aR: [95, 57], feathers: true, straw: 3,
        scy: held([95, 57], 6, 66, 0.5, 176, -1),
      });
      case 'sink0': return r({ dy: 20, flare: 0.4, ground: 2, scy: upright([92, 80], 5) });
      case 'sink1': return r({ dy: 44, aL: [38, 74], aR: [92, 74], ground: 2, scy: upright([92, 74], 4) });
      case 'sink2': return r({ dy: 56, aL: [40, 70], aR: [90, 70], ground: 2, scy: upright([90, 72], 2) });
      case 'rise0': return r({ dy: 44, aL: [40, 66], aR: [90, 66], ground: 2, straw: 2, scy: upright([90, 66], 8) });
      case 'rise1': return r({ dy: 22, flare: 0.5, aL: [40, 60], aR: [90, 60], ground: 3, straw: 3, scy: upright([90, 60], 10) });
      case 'rise2': return r({ dy: -4, flare: 1.2, open: 0.2, tilt: 1, aL: [38, 52], aR: [90, 52], ground: 3, straw: 6, scy: held([90, 52], 12, 66, 0.4, 176, -1) });
      case 'gustWind': return r({ flare: 1.0, open: 0.8, stream: 0.5, aL: [31, 70], aR: [97, 70], scy: held([97, 70], 0, 66, 0.45, 174, -1) });
      case 'gust': return r({
        flare: 0.9, stream: 1, lean: 0.06, aL: [72, 77], aR: [100, 73], grip: 'R', straw: 4,
        scy: held([100, 73], 58, 60, 0.35, 150, -1, 24),
      });
      case 'call': return r({
        flare: 0.4, tilt: 1, head: [0, -1], aL: [61, 85], aR: [68, 85], grip: 'LR', ground: 1,
        scy: { B: [66, 62], T: [64, 114], a: 22, curl: 1, bl: 22 },
      });
      case 'stun': return r({
        lean: 0.1, head: [5, 4], tilt: -1, aL: [41, 93], aR: [87, 92],
        scy: { B: [100, 72], T: [70, 118], a: 178, curl: 1, bl: 24 },
      });
      case 'hurt': return r({ lean: -0.06, head: [-2, 1], aL: [38, 70], aR: [90, 76], stream: -0.5, straw: 3, scy: upright([90, 76], -6) });
      default: return r({ scy: upright([92, 80]) });
    }
  }

  /**
   * The side rig of a pose (facing left): `aR` the near arm, `aL` the far one.
   * @param {string} key
   * @returns {Rig}
   */
  function sideRig(key) {
    /** @type {(o: Partial<Rig>) => Rig} */
    const r = (o) => ({ ...REST, aL: [77, 82], aR: [49, 82], ...o });
    const upright = (/** @type {Pt} */ H, deg = -3) => held(H, deg, 66, 0.36, 186, -1, 24);
    switch (key) {
      case 'idle0': return r({ lean: -0.015, stream: 0.2, scy: upright([49, 82]) });
      case 'idle1': return r({ dy: 1, stream: 0, scy: upright([49, 82], -2) });
      case 'idle2': return r({ lean: 0.015, stream: 0.4, aL: [78, 80], scy: upright([49, 82], -4) });
      case 'walk0': return r({ lean: -0.03, flare: 0.2, stream: 0.5, scy: upright([49, 82], -6) });
      case 'walk1': return r({ dy: 3, flare: 0.7, stream: 0.3, aL: [78, 77], aR: [49, 78], scy: upright([49, 78], -4) });
      case 'walk2': return r({ dy: -7, lean: -0.07, flare: 0.2, stream: 0.9, aL: [79, 85], aR: [48, 85], straw: 2, scy: upright([48, 85], -12) });
      case 'walk3': return r({ dy: 2, flare: 1.1, stream: 0.2, aL: [78, 84], aR: [50, 84], straw: 3, ground: 1, scy: upright([50, 84], -2) });
      case 'reapWind': return r({
        lean: 0.05, flare: 0.3, stream: 0.3, aL: [76, 67], aR: [68, 74], grip: 'LR',
        scy: { B: [50, 94], T: [97, 47], a: 82, curl: -1, bl: 26 },
      });
      case 'reap': return r({
        lean: -0.07, flare: 0.9, stream: 0.7, aL: [52, 90], aR: [46, 92], grip: 'LR', straw: 2,
        scy: { B: [80, 82], T: [30, 106], a: 192, curl: -1, bl: 22 },
      });
      case 'reapEnd': return r({
        lean: -0.04, flare: 0.6, stream: 0.9, aL: [54, 80], aR: [49, 77], grip: 'LR', straw: 3,
        scy: { B: [66, 94], T: [26, 60], a: -72, curl: -1, bl: 24 },
      });
      case 'spinWind': return r({
        flare: 0.8, tilt: 1, aL: [73, 45], aR: [57, 47], grip: 'LR',
        scy: { B: [90, 42], T: [34, 43], a: -96, curl: 1, bl: 24 },
      });
      case 'spin0': return r({
        flare: 1.5, stream: 1, aL: [60, 86], aR: [54, 87], grip: 'LR', straw: 5,
        scy: { B: [90, 85], T: [28, 90], a: 116, curl: 1, bl: 24, blur: 1 },
      });
      case 'spin1': return r({
        flare: 1.5, stream: -1, aL: [74, 86], aR: [68, 87], grip: 'LR', straw: 5,
        scy: { B: [38, 85], T: [100, 90], a: 64, curl: -1, bl: 24, blur: -1 },
      });
      case 'volley': return r({
        flare: 0.6, open: 1, tilt: 1, aL: [80, 54], aR: [50, 55], feathers: true, straw: 3,
        scy: held([50, 55], -8, 66, 0.5, 188, -1, 24),
      });
      case 'sink0': return r({ dy: 20, flare: 0.4, ground: 2, scy: upright([49, 82]) });
      case 'sink1': return r({ dy: 44, aL: [78, 75], aR: [50, 75], ground: 2, scy: upright([50, 75], -2) });
      case 'sink2': return r({ dy: 56, aL: [76, 70], aR: [52, 70], ground: 2, scy: upright([52, 72], 0) });
      case 'rise0': return r({ dy: 44, aL: [78, 66], aR: [50, 66], ground: 2, straw: 2, scy: upright([50, 66], -6) });
      case 'rise1': return r({ dy: 22, flare: 0.5, aL: [80, 60], aR: [50, 60], ground: 3, straw: 3, scy: upright([50, 60], -8) });
      case 'rise2': return r({ dy: -4, flare: 1.2, tilt: 1, aL: [80, 52], aR: [50, 52], ground: 3, straw: 6, scy: held([50, 52], -12, 66, 0.4, 188, -1, 24) });
      case 'gustWind': return r({ flare: 1.0, open: 0.6, stream: 0.6, aL: [88, 68], aR: [42, 70], scy: held([42, 70], -4, 66, 0.45, 188, -1, 24) });
      case 'gust': return r({
        flare: 0.9, stream: 1.2, lean: -0.08, aL: [48, 72], aR: [38, 76], grip: 'R', straw: 4,
        scy: held([38, 76], -58, 60, 0.35, 206, 1, 22),
      });
      case 'call': return r({
        flare: 0.4, tilt: 1, head: [2, -1], aL: [57, 80], aR: [52, 82], grip: 'LR', ground: 1,
        scy: { B: [58, 64], T: [44, 114], a: 160, curl: -1, bl: 22 },
      });
      case 'stun': return r({
        lean: 0.08, head: [-3, 4], tilt: -1, aL: [76, 92], aR: [54, 94],
        scy: { B: [62, 72], T: [36, 117], a: 186, curl: -1, bl: 22 },
      });
      case 'hurt': return r({ lean: 0.07, head: [2, 0], aL: [80, 74], aR: [55, 76], stream: -0.5, straw: 3, scy: upright([55, 76], 6) });
      default: return r({ scy: upright([49, 82]) });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The ground round the pole: the frost, the furrow it sinks into, the burst it rises in
  // ---------------------------------------------------------------------------------------------

  /** @param {any} p @param {Rig} R */
  function ground(p, R) {
    if (!R.ground) return;
    const cx = 64;
    if (R.ground >= 2) {
      // nothing of the figure below the furrow's lip
      const lip = G - 3;
      for (let y = lip; y < FH; y++) for (let x = 0; x < FW; x++) {
        const i = y * FW + x;
        if (p.mat[i] && Math.abs(x - cx) < 34) p.mat[i] = 0;
      }
      // the broken frozen earth round the hole
      p.begin('all', 0);
      for (let x = cx - 22; x <= cx + 22; x++) {
        const u = (x - cx) / 22;
        const h = 2.2 * Math.sqrt(Math.max(0, 1 - u * u)) + K.hash2(x, 3, 98) * 1.5;
        for (let y = Math.round(G - h); y <= G; y++) p.set(x, y, SOIL, y === Math.round(G - h) ? 3 : y < G - 1 ? 2 : 1);
      }
      p.end();
      p.begin(null);
      rime(p, cx - 22, cx + 22, [SOIL], 13);
      p.end();
      // frozen wheat standing in front of it
      p.begin(null);
      for (let k = 0; k < 13; k++) {
        const x = cx - 30 + k * 5 + Math.round(K.hash2(k, 14, 99) * 2);
        const h = 7 + K.hash2(k, 15, 99) * 7;
        const lean = (K.hash2(k, 16, 99) - 0.5) * 0.5 + (R.ground === 3 ? (x < cx ? -0.5 : 0.5) : 0);
        strand(p, x, G, -Math.PI / 2 + lean, h, 0, 2, k % 3 === 1);
        // the ear, frosted
        const ex = Math.round(x + Math.cos(-Math.PI / 2 + lean) * h), ey = Math.round(G + Math.sin(-Math.PI / 2 + lean) * h);
        p.set(ex, ey, STRAW, 3); p.set(ex, ey - 1, RIME, 3); p.set(ex + 1, ey, STRAW, 2);
      }
      p.end();
    }
    if (R.ground === 1 || R.ground === 3) {
      // frost thrown up round the pole's foot (3: clods and wheat flying out of the furrow)
      p.begin(null);
      const n = R.ground === 3 ? 14 : 6;
      for (let k = 0; k < n; k++) {
        const a = Math.PI + (k / Math.max(1, n - 1)) * Math.PI;
        const d = (R.ground === 3 ? 14 : 6) + K.hash2(k, 17, 100) * (R.ground === 3 ? 14 : 6);
        const x = Math.round(cx + Math.cos(a) * d * 1.3), y = Math.round(G - 2 + Math.sin(a) * d * 0.8);
        if (y < 3) continue;
        if (R.ground === 3 && k % 3 === 0) {
          p.set(x, y, SOIL, 2); p.set(x + 1, y, SOIL, 1); p.set(x, y - 1, RIME, 3);
        } else if (R.ground === 3 && k % 3 === 1) strand(p, x, y, a + 1, 4, 0.5, 3, false);
        else { p.set(x, y, RIME, 3); p.set(x + 1, y, RIME, 2); }
      }
      p.end();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Finishing passes
  // ---------------------------------------------------------------------------------------------

  /** The back view: the painting flipped left to right (it was painted from behind with the light mirrored). */
  function flip(p) {
    const { w, h, mat, shade, part } = p;
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < (w >> 1); x++) {
        const a = o + x, b = o + w - 1 - x;
        let t = mat[a]; mat[a] = mat[b]; mat[b] = t;
        t = shade[a]; shade[a] = shade[b]; shade[b] = t;
        t = part[a]; part[a] = part[b]; part[b] = t;
      }
    }
  }

  /** The materials the cool backlight rim catches. */
  const RIMMED = new Set([COAT, HAT, BAND, SACK, ICE]);

  /**
   * The cool rim: the right-edge texels of the coat, hat, head and blade, and the top edge of the
   * right half (the hat, the shoulders), turned to frost-blue — the backlit figure keeps its edge
   * against the gold field. A texel with nothing above and below it (a tatter's tip, a lone
   * texel) stays as it is; the hat and the blade take the brighter tone.
   */
  function rimPass(p) {
    const { w, h, mat, shade } = p;
    /** @type {number[]} */
    const hits = [];
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x;
        const m = mat[i];
        if (!RIMMED.has(m)) continue;
        if (!mat[i - w] && !mat[i + w]) continue;
        const right = !mat[i + 1];
        const top = !mat[i - w] && x > 60 && m !== SACK;
        if (right || top) hits.push(i);
      }
    }
    for (const i of hits) {
      const m = mat[i];
      mat[i] = RIM;
      shade[i] = m === HAT || m === ICE || m === BAND ? 3 : 2;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The frame
  // ---------------------------------------------------------------------------------------------

  /** @type {MonsterKind['draw']} */
  const draw = (p, view, key) => {
    const back = view === 'up';
    LX = back ? 0.55 : -0.55;
    if (key.startsWith('collapse') || key === 'heap') {
      drawFall(p, key, view);
      if (back) flip(p);
      if (key === 'collapse0') K.shear(p, 0.08, G);
      rimPass(p);
      return;
    }
    const R = sunk(view === 'side' ? sideRig(key) : frontRig(key));
    if (view === 'side') drawSide(p, R);
    else drawFront(p, R, back);
    if (back) flip(p);
    if (R.lean) K.shear(p, R.lean, G + Math.min(0, R.dy));
    ground(p, R);
    rimPass(p);
  };

  return {
    fw: FW, fh: FH, columns: MAWKIN_COLUMNS,
    aliases: { kneel: 'sink2', dead: 'collapse0', move0: 'walk0', move1: 'walk1', move2: 'walk2', move3: 'walk3' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.8, 0.9]) },
    draw,
    idle: { poses: ['idle0', 'idle1', 'idle2', 'idle1'], fps: 2.5 },
    layout: {
      perRow: 32,
      strips: [{ dir: 'left' }, { dir: 'right' }, { dir: 'down', poses: MAWKIN_FRONT }, { dir: 'up', poses: MAWKIN_BACK }],
    },
    ramps: () => K.makeRamps({
      // the straw: wheat gold, the stalks of the field it stands in
      [M.FUR]: K.ramp5(['#4a3216', '#8a6428', '#c89a42', '#ecc870', '#fff0b0']),
      // old straw in the shade, the heap's depth
      [M.FUR2]: K.ramp5(['#2a1c0c', '#4e3818', '#74562a', '#9a7a3e', '#bea052']),
      // the sack-cloth head: hessian
      [M.FUR3]: K.ramp5(['#3a3022', '#6e5c40', '#a08a62', '#c8b48a', '#e8dcb8']),
      // Osmund's coat: his slate-blue wool
      [M.TOP]: K.ramp5(['#161a26', '#262e44', '#3e4a66', '#56648a', '#7484aa']),
      // the coat's lining: an old oxblood
      [M.ACCENT]: K.ramp5(['#1e0a0c', '#3a1416', '#5a2022', '#7a3230', '#9a4a40']),
      // the felt hat, its leather band
      [M.HAT]: K.ramp5(['#141216', '#24201f', '#3a332e', '#544a40', '#706254']),
      [M.HATBAND]: K.ramp5(['#1a100a', '#2e1c12', '#4a2e1c', '#6a4428', '#8a5c38']),
      // the pole and the snath: old dark ash wood
      [M.WOOD]: K.ramp5(['#1a120c', '#2e2016', '#4a3422', '#664a32', '#86664a']),
      // brass buttons and buckle
      [M.GOLD]: K.ramp5(['#3a2a10', '#6a4c1c', '#a07a2c', '#d4ac4a', '#f6e08a']),
      // the founder's leather apron and belt; the leather patches
      [M.LEATHER]: K.ramp5(['#22140c', '#3e2616', '#5e3c22', '#7e5432', '#9e6e44']),
      [M.BELT]: K.ramp5(['#2a1a10', '#4a3020', '#6e4a30', '#8e6640', '#ae8456']),
      // the burns: the singed halo, the char
      [M.SCARF]: K.ramp5(['#1e1612', '#3a2c22', '#5a442e', '#7a5c3a', '#9a7648']),
      [M.HAIR]: K.ramp5(['#0c0a0c', '#18141a', '#241e24', '#302830', '#3c3440']),
      // rime and snow
      [M.WHITE]: K.ramp5(['#6a7a9a', '#9aaecb', '#c4d4ea', '#e4eefa', '#ffffff']),
      // stitches and the drawstring
      [M.STRING]: K.ramp5(['#100c0a', '#201814', '#30241c', '#403024', '#50402e']),
      // the blade of ice, its glowing edge and the eyes
      [M.GEL]: K.ramp5(['#1e4a66', '#3a86a8', '#8fd6ea', '#cfeef8', '#f4fdff']),
      [M.GLOW]: K.glowRamp(['#1c5a7a', '#3a9ac0', '#7ad6f0', '#bff0ff', '#f0ffff']),
      // the cool backlight rim
      [M.BEAK]: K.ramp5(['#3a5272', '#5a7ea4', '#80a6cc', '#9fc4e8', '#cfe4f6']),
      // frozen earth of the furrow
      [M.STONE]: K.ramp5(['#1a1612', '#2e2820', '#463c30', '#5e5244', '#7a6c5c']),
    }, M.FUR),
  };
}
