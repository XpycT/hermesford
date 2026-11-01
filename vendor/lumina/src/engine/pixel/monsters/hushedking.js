/**
 * The Hushed King — Osmund Halloway under the crown of frost, The Bells of Evermere's final boss
 * (docs/contracts/EVERMERE_CAMPAIGN.md §2.4, §5.4, §6.7). Owner: the king package; registered by
 * src/game/combat/packs/evermere/hushedking.js through the pack API.
 *
 * Who he is, in pixels: an old bell-founder, tall and a little stooped — a pale, tired face with
 * heavy lids, a long white beard and white hair to the shoulders; the tall crown of frost (five ice
 * spikes on a dark band, glow texels: the brain lights them cyan); a long cloak of dark slate crusted
 * with rime at the hem and the shoulders over a navy robe and the scorched leather apron of his
 * craft; a black bell-founder's hammer of ice (a long dark haft, a black-ice head with a cyan rim on
 * its striking faces). Dark values with a cyan rim, so he reads on snow and on dark ice alike. The
 * villager `osmund` of the cutscene after the crown breaks has the same white hair and beard, so the
 * uncrowned kneel (`kneelBare`) is the same man.
 *
 * ≈ 2.6 u to the top of his head (2.75 u with the crown) in a 64 × 64 frame (4 u: room for the
 * hammer raised overhead). Each pose is a rig in body space (x his left, y up, z forward, px) —
 * hands, the hammer's direction, the legs, the cloak's flare, the head's tilt — projected into the
 * three views (front `down`, back `up`, side `side` facing left, which the sheet mirrors for the
 * right row) and painted from shaded capsules, ellipses and polygons lit from the upper left, the
 * parts in depth order. In the side view the hammer's hand is the near one. RNG-free (fixed rigs,
 * `hash2` with fixed seeds).
 *
 * Columns: `idle0` `idle1` (leaning on the hammer, breathing), `move0`–`move3` (a slow walk, the
 * hammer trailing), `pealWind` / `peal` (Black Peal), `plant` (Black Toll: the hammer struck into
 * the ground), `leapWind` / `leap` / `slam` (the Leap Slam), `sweepWind` / `sweep`, `raise` (the
 * hammer overhead: the Carillon, ringing the Hush Bell), `hum` (the phase changes: head raised,
 * eyes closed — he never roars), `kneel` (stunned after his Carillon or broken: the crown tipped to
 * the camera), `crownBreak` (the release: the crown bursting) and `kneelBare` (after it: an old man
 * without a crown, the hammer fallen). Aliases: windup → sweepWind, attack → sweep, hurt / roar →
 * hum, dead → crownBreak (the core's kill shows it first; the brain kneels him uncrowned after),
 * stun → kneel, ring / carillon → raise.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number, number]} V3 */
/** @typedef {[number, number]} Pt */

/**
 * A pose's rig (body space, px; y up from the ground under his feet).
 * @typedef {object} KingRig
 * @property {'stand'|'walk'|'crouch'|'kneel'|'air'} legs
 * @property {number} [step]   walk phase 0–3
 * @property {number} [crouch] 0–1 (legs 'crouch')
 * @property {number} [bob]    px the upper body rises (+) or sinks (−)
 * @property {number} [stoop]  px the shoulders and head lean forward
 * @property {number} [tilt]   head pitch: + bowed (px the face drops), − raised
 * @property {V3} handR        the hammer hand
 * @property {V3} handL
 * @property {V3|null} hammer  direction from the grip to the head (normalised here); null: lying on the ground
 * @property {number} [flare]  0–1: the cloak spreads and lifts
 * @property {'whole'|'break'|'none'} [crown]
 * @property {boolean} [eyesShut]
 * @property {boolean} [mouth]  open (humming)
 */

const LX = -0.55, LY = -0.8;

/** The sheet's columns. */
const COLUMNS = ['idle0', 'idle1', 'move0', 'move1', 'move2', 'move3', 'pealWind', 'peal', 'plant',
  'leapWind', 'leap', 'slam', 'sweepWind', 'sweep', 'raise', 'hum', 'kneel', 'crownBreak', 'kneelBare'];

/** @type {Record<string, KingRig>} */
const RIGS = {
  idle0: { legs: 'stand', stoop: 1, handR: [-8.5, 15, 2.5], handL: [7.5, 15.5, 1.5], hammer: [-0.12, -1, 0.18] },
  idle1: { legs: 'stand', stoop: 1, bob: -0.6, handR: [-8.5, 14.5, 2.5], handL: [7.5, 15, 1.5], hammer: [-0.12, -1, 0.18], flare: 0.1 },
  move0: { legs: 'walk', step: 0, stoop: 2, handR: [-8, 16, 4], handL: [7.5, 16, -2], hammer: [-0.15, -0.55, -0.82] },
  move1: { legs: 'walk', step: 1, stoop: 2, bob: 0.6, handR: [-8, 16.5, 2], handL: [7.5, 16.5, 0], hammer: [-0.15, -0.6, -0.78] },
  move2: { legs: 'walk', step: 2, stoop: 2, handR: [-8, 16, -1], handL: [7.5, 16, 3.5], hammer: [-0.15, -0.65, -0.74] },
  move3: { legs: 'walk', step: 3, stoop: 2, bob: 0.6, handR: [-8, 16.5, 1], handL: [7.5, 16.5, 1.5], hammer: [-0.15, -0.6, -0.78] },
  pealWind: { legs: 'crouch', crouch: 0.3, stoop: 1, handR: [-10, 25, -5], handL: [5, 26, 8], hammer: [-0.55, 0.35, -0.76], flare: 0.25 },
  peal: { legs: 'crouch', crouch: 0.35, stoop: 3, handR: [3, 23, 10], handL: [9, 22, 4], hammer: [0.82, 0.12, 0.56], flare: 0.55 },
  plant: { legs: 'crouch', crouch: 0.45, stoop: 3, tilt: 1, handR: [-2, 13, 8], handL: [1.5, 15, 7], hammer: [0.05, -0.9, 0.45], flare: 0.3 },
  leapWind: { legs: 'crouch', crouch: 1, stoop: 3, handR: [-7, 26, -4], handL: [-3.5, 24.5, -2], hammer: [-0.22, 0.72, -0.66], flare: 0.15 },
  leap: { legs: 'air', bob: 2, handR: [-2, 42, 2], handL: [2, 42, 2], hammer: [0, 0.82, -0.57], flare: 1 },
  slam: { legs: 'crouch', crouch: 0.85, stoop: 4, tilt: 1, handR: [-1.5, 12, 10], handL: [1.5, 13, 9], hammer: [0, -0.74, 0.67], flare: 0.65 },
  sweepWind: { legs: 'crouch', crouch: 0.3, stoop: 1, handR: [6, 17, 4], handL: [8.5, 18, 2], hammer: [0.74, -0.2, -0.64], flare: 0.2 },
  sweep: { legs: 'crouch', crouch: 0.35, stoop: 2, handR: [-9, 18, 6], handL: [-5.5, 19, 7], hammer: [-0.92, 0.06, 0.4], flare: 0.6 },
  raise: { legs: 'stand', bob: 1, tilt: -1, handR: [-1.5, 43, 1.5], handL: [1.5, 43, 1.5], hammer: [0, 1, 0.12], flare: 0.35 },
  hum: { legs: 'stand', tilt: -2, eyesShut: true, mouth: true, handR: [-9, 17, 2], handL: [10.5, 19.5, 3], hammer: [-0.2, -0.96, 0.2], flare: 0.2 },
  kneel: { legs: 'kneel', stoop: 3, tilt: 3, handR: [-7.5, 12, 4.5], handL: [5, 9.5, 5.5], hammer: [0, -1, 0.1] },
  crownBreak: { legs: 'kneel', stoop: 1, tilt: -3, crown: 'break', eyesShut: true, mouth: true, handR: [-10.5, 15, 2.5], handL: [10, 16, 3], hammer: [-0.55, -0.6, 0.58], flare: 0.4 },
  kneelBare: { legs: 'kneel', stoop: 4, tilt: 4, crown: 'none', eyesShut: true, handR: [-4, 7, 7], handL: [4, 8.5, 6], hammer: null },
};

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function hushedking(K) {
  const { M, hash2 } = K;
  const ROBE = M.TOP, ROBE2 = M.BOTTOM, CLOAK = M.CAPE, LINING = M.CAPEIN, RIME = M.FUR3, SKIN = M.SKIN, HAIR = M.HAIR,
    BEARD = M.BEARD, EYE = M.EYE, APRON = M.LEATHER, HAFT = M.WOOD, BAND = M.METAL, ICE = M.STONE, GLOW = M.GLOW, CROWN = M.HAT,
    BOOT = M.BOOT, TRIM = M.ACCENT;

  /** Shade 0–4 of a capsule / ellipse texel from its normal-ish offset (light from the upper left). */
  const tone = (l, hi = 0.42, lo = -0.22, deep = -0.72) => (l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0);

  /**
   * A capsule between two screen points (radii ar → br), shaded.
   * @param {any} p @param {Pt} a @param {number} ar @param {Pt} b @param {number} br @param {number} mat
   * @param {{ lift?: number, max?: number, min?: number }} [o]
   */
  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { lift = 0, max = 4, min = 0 } = o;
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
        p.set(x, y, mat, Math.max(min, Math.min(max, tone(l) + lift)));
      }
    }
  }

  /** Filled polygon with a per-texel shade function (or a constant). */
  function poly(p, pts, mat, shade) {
    K.fillPoly(p, pts, mat, shade);
  }

  // ---------------------------------------------------------------------------------------------
  // the projection
  // ---------------------------------------------------------------------------------------------

  /**
   * Body space → screen: [sx, sy, depth] (depth: larger is nearer the viewer).
   * @param {'down'|'up'|'side'} view @param {V3} v @param {number} G
   * @returns {[number, number, number]}
   */
  function proj(view, v, G) {
    const [x, y, z] = v;
    if (view === 'down') return [32 + x, G - y, z];
    if (view === 'up') return [32 - x, G - y, -z];
    // facing left: forward is screen left; the hammer's side (his right) is the near one
    return [32 - z, G - y, -x];
  }

  /** @param {V3} a @param {V3} b @param {number} t @returns {V3} */
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /** @param {V3} v @returns {V3} */
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  // ---------------------------------------------------------------------------------------------
  // the body
  // ---------------------------------------------------------------------------------------------

  /**
   * The pose's joints in body space.
   * @param {KingRig} R
   */
  function joints(R) {
    const c = R.legs === 'crouch' ? (R.crouch ?? 0.5) : 0;
    const hip = R.legs === 'kneel' ? 8.5 : R.legs === 'air' ? 17 : 15 - 4 * c;
    const bob = R.bob ?? 0;
    const st = R.stoop ?? 0;
    const up = hip - 15 + bob;
    /** @type {V3} */ const chest = [0, 22 + up, st * 0.4];
    /** @type {V3} */ const shR = [-6.5, 27 + up, st * 0.7];
    /** @type {V3} */ const shL = [6.5, 27 + up, st * 0.7];
    /** @type {V3} */ const head = [0, 33 + up - Math.max(0, (R.tilt ?? 0)) * 0.3, st + Math.max(0, R.tilt ?? 0) * 0.5];
    return { hip, up, chest, shR, shL, head, c };
  }

  /**
   * An arm: sleeve (shoulder → elbow → wrist) and the hand.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {V3} sh @param {V3} hand
   * @param {number} out elbow bowing outward (body x sign) @param {boolean} far (darker)
   */
  function arm(p, view, G, sh, hand, out, far) {
    const mid = mix3(sh, hand, 0.5);
    /** @type {V3} */ const elbow = [mid[0] + out * 1.6, mid[1] - 1.2, mid[2] - 0.6];
    const a = proj(view, sh, G), e = proj(view, elbow, G), h = proj(view, hand, G);
    const lift = far ? -1 : 0;
    p.begin('all', 0);
    capsule(p, [a[0], a[1]], 2.4, [e[0], e[1]], 2.1, ROBE, { lift });
    capsule(p, [e[0], e[1]], 2.1, [h[0], h[1]], 2.5, ROBE, { lift });
    p.end();
    // the wide sleeve's frosted cuff
    p.begin(null);
    const cx = e[0] + (h[0] - e[0]) * 0.78, cy = e[1] + (h[1] - e[1]) * 0.78;
    K.blob(p, cx, cy, 2.2, 1.6, TRIM, { maxShade: far ? 2 : 3 });
    p.end();
    p.begin('all', 1);
    K.blob(p, h[0], h[1], 1.5, 1.5, SKIN, { maxShade: far ? 2 : 3 });
    p.end();
  }

  /**
   * The hammer: the haft from the grip, the black-ice head across its end (its striking faces
   * rimmed with glow texels), an iron band at the join.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {V3} grip @param {V3} dir
   */
  function hammer(p, view, G, grip, dir) {
    const d = norm(dir);
    /** @type {V3} */ const butt = [grip[0] - d[0] * 4, grip[1] - d[1] * 4, grip[2] - d[2] * 4];
    /** @type {V3} */ const top = [grip[0] + d[0] * 15, grip[1] + d[1] * 15, grip[2] + d[2] * 15];
    const a = proj(view, butt, G), b = proj(view, top, G);
    p.begin('all', 0);
    capsule(p, [a[0], a[1]], 0.85, [b[0], b[1]], 0.85, HAFT, { max: 3 });
    p.end();
    // the head: across the haft in the screen (its long axis ⟂ the projected haft), 10 × 5 px
    let hx = b[0] - a[0], hy = b[1] - a[1];
    const hl = Math.hypot(hx, hy);
    // (a haft seen end-on: the head lies flat across the screen)
    if (hl < 2.5) { hx = 0; hy = -1; } else { hx /= hl; hy /= hl; }
    const ax = -hy, ay = hx; // the head's long axis
    const cx = b[0] + hx * 1.5, cy = b[1] + hy * 1.5;
    const half = hl < 2.5 ? 3.5 : 5, thick = 2.6;
    const pts = /** @type {Pt[]} */ ([
      [cx - ax * half - hx * thick, cy - ay * half - hy * thick], [cx + ax * half - hx * thick, cy + ay * half - hy * thick],
      [cx + ax * (half + 0.6) + hx * thick, cy + ay * (half + 0.6) + hy * thick], [cx - ax * (half + 0.6) + hx * thick, cy - ay * (half + 0.6) + hy * thick],
    ]);
    p.begin('all', 0);
    poly(p, pts, ICE, (x, y) => {
      const u = ((x + 0.5 - cx) * ax + (y + 0.5 - cy) * ay) / half;
      const v = ((x + 0.5 - cx) * hx + (y + 0.5 - cy) * hy) / thick;
      const l = u * LX * ax + v * LY;
      return l > 0.45 ? 3 : l > -0.1 ? 2 : l > -0.6 ? 1 : 0;
    });
    p.end();
    // the striking faces' rims: glow texels (the brain lights them cyan)
    p.begin(null);
    for (const s of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const fx = cx + ax * s * (half + 0.2) + hx * k * 0.9;
        const fy = cy + ay * s * (half + 0.2) + hy * k * 0.9;
        p.set(Math.floor(fx), Math.floor(fy), GLOW, Math.abs(k) === 2 ? 1 : k === 0 ? 3 : 2);
      }
    }
    // a vein of light through the ice
    p.set(Math.floor(cx - ax * 1.5), Math.floor(cy - ay * 1.5), GLOW, 1);
    p.set(Math.floor(cx + ax * 0.5 - hx), Math.floor(cy + ay * 0.5 - hy), GLOW, 2);
    // the iron band at the join
    p.set(Math.floor(b[0] - hx * 1.2), Math.floor(b[1] - hy * 1.2), BAND, 3);
    p.set(Math.floor(b[0] - hx * 1.2 + ax), Math.floor(b[1] - hy * 1.2 + ay), BAND, 1);
    p.end();
  }

  /** The hammer lying on the ground in front of him (kneelBare). */
  function hammerDown(p, view, G) {
    if (view === 'up') return;
    if (view === 'side') {
      p.begin('all', 0);
      capsule(p, [17, G - 1], 0.8, [30, G - 1.5], 0.8, HAFT, { max: 2 });
      p.end();
      p.begin('all', 0);
      p.rect(13, G - 4, 5, 4, ICE, 1);
      p.hline(13, 17, G - 4, ICE, 2);
      p.set(13, G - 3, GLOW, 1);
      p.set(17, G - 3, GLOW, 1);
      p.end();
      return;
    }
    p.begin('all', 0);
    capsule(p, [20, G - 0.5], 0.8, [33, G - 2.5], 0.8, HAFT, { max: 2 });
    p.end();
    p.begin('all', 0);
    p.rect(15, G - 5, 6, 5, ICE, 1);
    p.hline(15, 20, G - 5, ICE, 2);
    p.set(15, G - 3, GLOW, 1);
    p.set(20, G - 4, GLOW, 2);
    p.end();
  }

  /**
   * The cloak behind him (front and side) or over him (back): dark slate, its lining at the inner
   * edges, a crust of rime with icicle dags along the hem.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {KingRig} R @param {ReturnType<typeof joints>} J
   */
  function cloak(p, view, G, R, J) {
    const fl = R.flare ?? 0;
    const sy = G - (27 + J.up);
    const kneel = R.legs === 'kneel';
    const air = R.legs === 'air';
    const hemY = air ? G - 7 - fl * 3 : kneel ? G - 0.5 : G - 0.5 - fl * 2;
    if (view === 'side') {
      // trailing behind (screen right): from the shoulder's back to a hem far behind
      const back = 32 + J.chest[2] + 3;
      const reach = 9 + fl * 7 + (kneel ? 4 : 0) + (R.legs === 'walk' ? (R.step === 1 || R.step === 3 ? 1 : 0) : 0);
      const pts = /** @type {Pt[]} */ ([[back - 3, sy - 1], [back + 1.5, sy - 1.5], [back + reach * 0.6, sy + (hemY - sy) * 0.55], [back + reach, hemY], [back - 4, hemY], [back - 4.5, sy + 4]]);
      p.begin('all', 0);
      poly(p, pts, CLOAK, (x, y) => {
        const fold = ((x + Math.floor(y / 5)) % 4 === 0) ? -1 : 0;
        return Math.max(0, Math.min(3, (y < sy + 6 ? 2 : 1) + fold));
      });
      p.end();
      // the lining showing at the trailing edge
      p.begin(null);
      for (let y = Math.ceil(sy + 5); y < hemY - 2; y++) {
        const t = (y - sy) / (hemY - sy);
        const x = Math.round(back + reach * (0.6 * Math.min(1, t / 0.55) + (t > 0.55 ? 0.4 * (t - 0.55) / 0.45 : 0)));
        p.over(x, y, LINING, 1);
        p.over(x - 1, y, LINING, 2);
      }
      p.end();
      rimeHem(p, back - 4, back + reach, hemY, 31);
      return;
    }
    const wTop = 8.5;
    const wBot = (kneel ? 15 : 12.5) + fl * 4;
    const front = view === 'down';
    const pts = /** @type {Pt[]} */ ([[32 - wTop, sy], [32 + wTop, sy], [32 + wBot, hemY], [32 - wBot, hemY]]);
    p.begin('all', 0);
    poly(p, pts, CLOAK, (x, y) => {
      const u = (x + 0.5 - 32) / wBot;
      const fold = (hash2(x, 3, 41) > 0.72 || (x % 5 === 0 && y > sy + 8)) ? -1 : 0;
      const base = front ? (u < -0.55 ? 2 : u > 0.55 ? 1 : 1) : (u < -0.35 ? 2 : u > 0.45 ? 1 : 2);
      return Math.max(0, Math.min(3, base + fold - (y > hemY - 6 ? 0 : 0)));
    });
    p.end();
    if (front) {
      // the lining at the inner edges (seen past the robe)
      p.begin(null);
      for (let y = Math.ceil(sy + 6); y < hemY - 2; y++) {
        const t = (y - sy) / (hemY - sy);
        const w = 7 + (wBot - 7) * t * 0.55;
        p.over(Math.round(32 - w), y, LINING, 1);
        p.over(Math.round(32 + w), y, LINING, 0);
      }
      p.end();
    } else {
      // the back: a seam and the folds falling straight
      p.begin(null);
      for (let y = Math.ceil(sy + 3); y < hemY - 2; y++) {
        p.over(32, y, CLOAK, 0);
        if (y > sy + 10 && y % 2 === 0) p.over(32 - 5 - Math.floor((y - sy) / 9), y, CLOAK, 1);
      }
      p.end();
    }
    rimeHem(p, 32 - wBot, 32 + wBot, hemY, 17);
    // (the back: the rime mantle lies over the cloak's top)
    if (!front) mantle(p, 32, sy, 9, view);
  }

  /** A crust of rime along a hem with icicle dags hanging from it (RNG-free). */
  function rimeHem(p, x0, x1, y, seed) {
    p.begin(null);
    for (let x = Math.ceil(x0); x <= Math.floor(x1); x++) {
      if (!p.get(x, Math.floor(y) - 1) && !p.get(x, Math.floor(y) - 2)) continue;
      const h = hash2(x, seed, 7);
      p.over(x, Math.floor(y) - 1, RIME, h > 0.5 ? 3 : 2);
      p.over(x, Math.floor(y) - 2, RIME, h > 0.25 ? 2 : 1);
      if (h > 0.6) p.over(x, Math.floor(y) - 3, RIME, 1);
      // icicle dags below the hem
      if (h > 0.55 && Math.floor(y) < 62) {
        p.set(x, Math.floor(y), RIME, 3);
        if (h > 0.82 && Math.floor(y) + 1 < 63) p.set(x, Math.floor(y) + 1, RIME, 4);
      }
    }
    p.end();
  }

  /**
   * The robe's skirt, the legs under it and the boots.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {KingRig} R @param {ReturnType<typeof joints>} J
   */
  function skirt(p, view, G, R, J) {
    const waist = G - (J.hip + 3);
    const air = R.legs === 'air';
    const kneel = R.legs === 'kneel';
    const hem = air ? G - 6 : G - 1;
    const step = R.step ?? 0;
    if (view === 'side') {
      const cx = 32 - J.chest[2] * 0.5;
      const sway = R.legs === 'walk' ? [-1.5, 0, 1.5, 0][step] : 0;
      const pts = kneel
        ? /** @type {Pt[]} */ ([[cx - 4, waist], [cx + 4, waist], [cx + 8, hem], [cx - 11, hem], [cx - 10, hem - 4]])
        : /** @type {Pt[]} */ ([[cx - 4, waist], [cx + 4, waist], [cx + 6 + sway * 0.5, hem], [cx - 6 + sway, hem]]);
      p.begin('all', 0);
      poly(p, pts, ROBE, (x, y) => ((x + y) % 7 === 0 ? 1 : x < cx - 1 ? 2 : 1));
      p.end();
      if (!air && !kneel) {
        // the boots: one forward on the stride
        const fx = cx - 4 + (R.legs === 'walk' ? [-2, -0.5, 1, -0.5][step] : 0);
        p.begin('all', 0);
        p.rect(Math.round(fx) - 2, G - 2, 4, 2, BOOT, 1);
        p.set(Math.round(fx) - 2, G - 2, BOOT, 2);
        p.end();
      }
      if (kneel) {
        // the knee raised in front, the boot behind
        p.begin('all', 0);
        K.blob(p, cx - 7, hem - 4, 3.2, 2.8, ROBE, { maxShade: 2 });
        p.rect(Math.round(cx + 5), G - 2, 3, 2, BOOT, 1);
        p.end();
      }
      rimeHem(p, kneel ? cx - 11 : cx - 6, kneel ? cx + 8 : cx + 6, hem + 1, 53);
      return;
    }
    const wT = 6, wB = kneel ? 10 : 8.5 + (R.legs === 'crouch' ? 1.5 * J.c : 0);
    const sway = R.legs === 'walk' ? [1, 0, -1, 0][step] : 0;
    const pts = /** @type {Pt[]} */ ([[32 - wT, waist], [32 + wT, waist], [32 + wB + sway, hem], [32 - wB + sway, hem]]);
    p.begin('all', 0);
    poly(p, pts, ROBE, (x, y) => {
      const u = (x + 0.5 - 32 - sway * ((y - waist) / Math.max(1, hem - waist))) / wB;
      return u < -0.45 ? 2 : u > 0.5 ? 0 : 1;
    });
    p.end();
    if (view === 'down') {
      // the robe's front split showing the darker under-robe
      p.begin(null);
      for (let y = Math.ceil(waist + 4); y < hem; y++) p.over(32 + Math.round(sway * (y - waist) / Math.max(1, hem - waist)), y, ROBE2, 0);
      p.end();
    }
    if (!air) {
      // the boots under the hem (walking: one forward and lower in the frame)
      const feet = R.legs === 'walk' ? [[-3, step === 0 ? 0 : -1], [3, step === 2 ? 0 : -1]] : kneel ? [[-5, 0], [4, -1]] : [[-3.5, 0], [3.5, 0]];
      p.begin('all', 0);
      for (const [fx, dy] of feet) {
        p.rect(Math.round(32 + fx) - 2, G - 2 + dy, 4, 2 - dy, BOOT, 1);
        p.set(Math.round(32 + fx) - 2, G - 2 + dy, BOOT, 2);
      }
      p.end();
    }
    rimeHem(p, 32 - wB + sway, 32 + wB + sway, hem + 1, 29);
  }

  /**
   * The torso, the leather apron (front), the rime mantle over the shoulders.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {KingRig} R @param {ReturnType<typeof joints>} J
   */
  function torso(p, view, G, R, J) {
    const top = G - (27 + J.up);
    const waist = G - (J.hip + 3);
    if (view === 'side') {
      const cx = 32 - J.chest[2];
      p.begin('all', 0);
      poly(p, /** @type {Pt[]} */ ([[cx - 3.5, top], [cx + 4, top], [cx + 4, waist + 2], [cx - 4, waist + 2]]), ROBE, (x) => (x < cx - 1 ? 2 : 1));
      p.end();
      // the apron in profile: a strip down the front
      p.begin(null);
      for (let y = Math.ceil(top + 5); y < G - 5; y++) p.over(Math.round(cx - 4 + (y > waist ? -0.5 : 0)), y, APRON, y > G - 9 ? 0 : 1);
      for (let y = Math.ceil(top + 5); y < Math.min(G - 5, waist + 9); y++) p.set(Math.round(cx - 5 + (y > waist ? -0.5 : 0)), y, APRON, 2);
      p.end();
      mantle(p, cx, top, 5.5, view);
      return;
    }
    p.begin('all', 0);
    poly(p, /** @type {Pt[]} */ ([[32 - 7, top], [32 + 7, top], [32 + 6, waist + 1], [32 - 6, waist + 1]]), ROBE, (x) => {
      const u = (x + 0.5 - 32) / 7;
      return u < -0.4 ? 2 : u > 0.45 ? 0 : 1;
    });
    p.end();
    if (view === 'down') {
      // the apron: bib to below the knee, scorched at its hem, tied at the waist
      const ay0 = top + 6, ay1 = Math.min(G - 4, waist + 13);
      p.begin('all', 0);
      poly(p, /** @type {Pt[]} */ ([[32 - 3, ay0], [32 + 3, ay0], [32 + 4.4, ay1], [32 - 4.4, ay1]]), APRON, (x, y) => {
        const u = (x + 0.5 - 32) / 5;
        const burn = y > ay1 - 3 && hash2(x, y, 61) > 0.45;
        return burn ? 0 : u < -0.3 ? 2 : u > 0.5 ? 0 : 1;
      });
      p.end();
      p.begin(null);
      p.hline(32 - 6, 32 + 6, Math.round(waist), APRON, 0);
      p.set(32 + 3, Math.round(waist) + 1, APRON, 0);
      p.set(32 + 4, Math.round(waist) + 2, APRON, 0);
      // a little bronze bell on its cord, the bell-founder's sign
      p.set(32 - 2, Math.round(ay0) + 3, M.GOLD, 3);
      p.set(32 - 3, Math.round(ay0) + 4, M.GOLD, 2);
      p.set(32 - 2, Math.round(ay0) + 4, M.GOLD, 3);
      p.set(32 - 1, Math.round(ay0) + 4, M.GOLD, 1);
      p.end();
    }
    mantle(p, 32, top, 9, view);
  }

  /** The rime-crusted mantle over the shoulders (a short capelet of the cloak). */
  function mantle(p, cx, top, w, view) {
    p.begin('all', 0);
    const pts = /** @type {Pt[]} */ ([[cx - w + 2, top - 1.5], [cx + w - 2, top - 1.5], [cx + w, top + 3.5], [cx - w, top + 3.5]]);
    poly(p, pts, CLOAK, (x) => (x < cx - 1 ? 2 : 1));
    p.end();
    p.begin(null);
    for (let x = Math.ceil(cx - w); x <= Math.floor(cx + w); x++) {
      const h = hash2(x, 13, view === 'up' ? 3 : 9);
      p.over(x, Math.floor(top - 1), RIME, h > 0.5 ? 4 : 3);
      p.over(x, Math.floor(top), RIME, h > 0.3 ? 3 : 2);
      if (h > 0.55) p.over(x, Math.floor(top + 1), RIME, 2);
      if (h > 0.8) p.over(x, Math.floor(top + 2), RIME, 1);
      // the mantle's dagged rime edge
      if (h > 0.62) p.over(x, Math.floor(top + 3.5), RIME, 2);
    }
    p.end();
  }

  /**
   * The head: face, white hair, beard; the crown on it.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G @param {KingRig} R @param {ReturnType<typeof joints>} J
   */
  function head(p, view, G, R, J) {
    const [hx, hy] = proj(view, J.head, G);
    const tilt = R.tilt ?? 0;
    const cx = hx, cy = hy;
    if (view === 'up') {
      // the back of the head: white hair falling over the mantle
      p.begin('all', 0);
      K.blob(p, cx, cy, 4.3, 4.7, HAIR, { maxShade: 3 });
      // long hair over the shoulders, its ends uneven
      for (let x = Math.round(cx - 4.5); x <= Math.round(cx + 3.5); x++) {
        const len = 6 + Math.round(2.4 * hash2(x, 5, 23)) - (Math.abs(x + 0.5 - cx) > 3.5 ? 2 : 0);
        for (let y = Math.round(cy); y <= Math.round(cy) + len; y++) {
          const strand = hash2(x, Math.floor(y / 2), 31) > 0.7 ? -1 : 0;
          p.set(x, y, HAIR, Math.max(0, (x < cx - 1.5 ? 3 : x < cx + 1.5 ? 2 : 1) + strand - (y > cy + len - 2 ? 1 : 0)));
        }
      }
      p.end();
      crown(p, view, cx, cy - 4.4 + Math.max(0, tilt) * 0.3, R);
      return;
    }
    if (view === 'side') {
      // profile facing left: the face forward, the hair long down the back
      p.begin('all', 0);
      poly(p, /** @type {Pt[]} */ ([[cx - 0.5, cy - 3], [cx + 4.6, cy - 3], [cx + 5.6, cy + 7], [cx + 1, cy + 6]]), HAIR, (x, y) => ((x + y) % 3 === 0 ? 1 : 2));
      p.end();
      p.begin('all', 0);
      K.blob(p, cx - 0.4, cy + 0.2, 3.6, 4.5, SKIN, { maxShade: 3 });
      p.end();
      p.begin('above', 1);
      // the crown of the hair over the brow and the temple
      for (let x = Math.round(cx - 3); x <= Math.round(cx + 4); x++) p.set(x, Math.round(cy - 4), HAIR, x < cx ? 3 : 2);
      for (let y = Math.round(cy - 3); y <= Math.round(cy + 1); y++) { p.set(Math.round(cx + 2), y, HAIR, 2); p.set(Math.round(cx + 3), y, HAIR, 1); }
      p.end();
      p.begin(null);
      const ey = Math.round(cy - 0.5 + Math.max(0, tilt) * 0.4 - Math.max(0, -tilt) * 0.3);
      // the nose (a long bell-founder's nose), the heavy brow, the tired eye
      p.set(Math.round(cx - 4), ey + 1, SKIN, 3);
      p.set(Math.round(cx - 4), ey + 2, SKIN, 2);
      p.set(Math.round(cx - 3), ey - 1, HAIR, 2);
      p.set(Math.round(cx - 2), ey - 1, HAIR, 2);
      if (R.eyesShut) p.set(Math.round(cx - 2), ey, SKIN, 0);
      else {
        p.set(Math.round(cx - 2), ey, EYE, 1);
        p.set(Math.round(cx - 2), ey + 1, SKIN, 1);
      }
      p.end();
      // the beard: from the chin forward and down to the chest
      p.begin('all', 0);
      const by0 = cy + 2 + Math.max(0, tilt) * 0.3;
      poly(p, /** @type {Pt[]} */ ([[cx - 3.4, by0 + 0.5], [cx + 0.4, by0 + 0.5], [cx - 0.2, by0 + 5], [cx - 1.8, by0 + 10], [cx - 3.8, by0 + 4]]), BEARD,
        (x, y) => Math.max(0, (x < cx - 2 ? 3 : 2) + (hash2(x, Math.floor(y / 3), 79) > 0.62 ? -1 : 0) + (y > by0 + 6 ? -1 : 0)));
      p.end();
      if (R.mouth) { p.begin(null); p.set(Math.round(cx - 3), Math.round(by0) + 1, EYE, 0); p.end(); }
      crown(p, view, cx + 0.6, cy - 4.4, R);
      return;
    }
    // the front: long white hair at the sides
    p.begin('all', 0);
    poly(p, /** @type {Pt[]} */ ([[cx - 5, cy - 2], [cx + 5, cy - 2], [cx + 6, cy + 7.5], [cx - 6, cy + 7.5]]), HAIR, (x, y) => ((x + y) % 3 === 0 ? 1 : x < cx ? 3 : 2));
    p.end();
    p.begin('all', 0);
    K.blob(p, cx, cy + 0.3, 4.1, 4.6, SKIN, { maxShade: 3 });
    p.end();
    const ey = Math.round(cy + Math.max(0, tilt) * 0.5 - Math.max(0, -tilt) * 0.35);
    // (the face's columns: the head spans cx − 4 … cx + 3; symmetric pairs round cx − 0.5)
    const c0 = Math.round(cx) - 1, c1 = Math.round(cx);
    p.begin('above', 1);
    // the hair over the brow, parted, thin on top (combed back over the bowed head without the crown)
    const bare = (R.crown ?? 'whole') === 'none';
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 3); x++) {
      p.set(x, Math.round(cy - 4.2), HAIR, x < cx - 1 ? 3 : 2);
      if (x <= cx - 2 || x >= cx + 1 || bare) p.set(x, Math.round(cy - 3.3), HAIR, x < cx ? 3 : 2);
      if (bare && (x <= cx - 3 || x >= cx + 2 || (x + 1) % 2 === 0)) p.set(x, Math.round(cy - 2.4), HAIR, x < cx ? 2 : 1);
    }
    p.end();
    p.begin(null);
    // heavy brows, the tired eyes (one dark texel, a shadow under it), the long nose, hollow cheeks
    for (const [ex, out] of [[c0 - 1, c0 - 2], [c1 + 1, c1 + 2]]) {
      p.set(out, ey - 1, HAIR, 2);
      p.set(ex, ey - 1, HAIR, 1);
      if (R.eyesShut) p.set(ex, ey, SKIN, 0);
      else {
        p.set(ex, ey, EYE, 1);
        p.set(out, ey, SKIN, 1);
      }
      p.set(ex, ey + 1, SKIN, 1);
      p.over(out, ey + 2, SKIN, 1);
    }
    p.set(c0, ey + 1, SKIN, 3);
    p.set(c1, ey + 1, SKIN, 2);
    p.set(c0, ey + 2, SKIN, 2);
    p.end();
    // the beard: a moustache over the mouth and a long beard to the chest (grey-white, lit on the left)
    p.begin('all', 0);
    const by = ey + 3;
    poly(p, /** @type {Pt[]} */ ([[cx - 3.7, by], [cx + 3.4, by], [cx + 2.8, by + 5], [cx + 0.6, by + 10], [cx - 1.2, by + 10], [cx - 3.2, by + 5]]), BEARD,
      (x, y) => {
        const strand = hash2(x, Math.floor(y / 3), 77) > 0.62 ? -1 : 0;
        const side = x < cx - 1.5 ? 3 : x < cx + 0.5 ? 2 : 1;
        return Math.max(0, side + strand + (y > by + 6 ? -1 : 0));
      });
    p.end();
    p.begin(null);
    p.hline(c0 - 2, c1 + 1, by, BEARD, 3);
    p.set(c0 - 2, by, BEARD, 4);
    if (R.mouth) { p.set(c0, by + 1, EYE, 0); p.set(c1, by + 1, EYE, 0); }
    p.end();
    crown(p, view, cx, cy - 4.3 + Math.max(0, tilt) * 0.3, R);
  }

  /**
   * The crown of frost: a dark ice band and five spikes of glowing ice (the middle tallest); bowed
   * forward it shows to the camera; breaking, the spikes fly off; absent after.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} cx @param {number} by the band's row
   * @param {KingRig} R
   */
  function crown(p, view, cx, by, R) {
    const kind = R.crown ?? 'whole';
    if (kind === 'none') return;
    const band = Math.round(by);
    const bowed = Math.max(0, R.tilt ?? 0) >= 3;
    p.begin('all', 0);
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 3); x++) {
      p.set(x, band, CROWN, x < cx - 1 ? 3 : 2);
      p.set(x, band + 1, CROWN, 1);
    }
    p.end();
    /** @type {[number, number][]} spike offset, height */
    const spikes = view === 'side' ? [[-3, 3], [-1, 6], [1, 5], [3, 3]] : [[-4, 3], [-2, 5], [0, 7], [2, 5], [4, 3]];
    p.begin(null);
    for (const [dx, h0] of spikes) {
      const h = bowed ? Math.max(2, h0 - 2) : h0;
      const x = Math.round(cx + dx - (view !== 'side' && dx > 0 ? 1 : 0));
      if (kind === 'break' && Math.abs(dx) >= 2) {
        // the outer spikes snapped off and flying apart
        const fx = x + Math.sign(dx) * 3, fy = band - h - 2;
        p.set(fx, fy, GLOW, 4);
        p.set(fx + Math.sign(dx), fy - 1, GLOW, 3);
        p.set(fx, fy + 1, GLOW, 2);
        p.set(x, band - 1, GLOW, 2);
        continue;
      }
      for (let k = 1; k <= h; k++) {
        const t = k / h;
        p.set(x, band - k, GLOW, t > 0.8 ? 4 : t > 0.45 ? 3 : 2);
        if (k <= h * 0.45 && h >= 5) p.set(x + 1, band - k, GLOW, 1);
      }
      if (kind === 'break') {
        // the middle spike cracking: a dark split and sparks
        p.set(x, band - Math.ceil(h / 2), CROWN, 0);
        p.set(x - 2, band - h - 1, GLOW, 4);
        p.set(x + 2, band - h, GLOW, 4);
      }
    }
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // a frame
  // ---------------------------------------------------------------------------------------------

  /**
   * @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f
   */
  function draw(p, view, key, f) {
    const R = Object.hasOwn(RIGS, key) ? RIGS[key] : RIGS.idle0;
    const G = f.G;
    const J = joints(R);
    /** @type {Array<{ d: number, fn: () => void }>} */
    const parts = [];
    const handR = R.handR, handL = R.handL;
    const dR = proj(view, handR, G)[2];
    const dL = proj(view, handL, G)[2];
    const body = view === 'side' ? 0 : 0;
    // the hammer's depth: its head's
    let hamD = -99;
    if (R.hammer) {
      const d = norm(R.hammer);
      hamD = proj(view, [handR[0] + d[0] * 15, handR[1] + d[1] * 15, handR[2] + d[2] * 15], G)[2];
    }
    // (a hammer or an arm behind the body is painted before it)
    const behindR = view === 'up' ? dR < 2 : dR < -1.5;
    const behindL = view === 'up' ? dL < 2 : dL < -1.5;
    const hamBehind = view === 'up' ? hamD < 3 : hamD < -2 && dR < 0.5;
    if (view !== 'up') parts.push({ d: -50, fn: () => cloak(p, view, G, R, J) });
    if (R.hammer && hamBehind) parts.push({ d: -40, fn: () => hammer(p, view, G, handR, R.hammer) });
    if (behindR) parts.push({ d: -30, fn: () => arm(p, view, G, view === 'side' ? J.shR : J.shR, handR, -1, true) });
    if (behindL) parts.push({ d: -29, fn: () => arm(p, view, G, J.shL, handL, 1, true) });
    parts.push({ d: body - 10, fn: () => skirt(p, view, G, R, J) });
    parts.push({ d: body - 5, fn: () => torso(p, view, G, R, J) });
    if (view === 'up') parts.push({ d: body - 1, fn: () => cloak(p, view, G, R, J) });
    parts.push({ d: body, fn: () => head(p, view, G, R, J) });
    if (!behindL) parts.push({ d: 10 + dL, fn: () => arm(p, view, G, J.shL, handL, 1, view === 'side') });
    if (!behindR) parts.push({ d: 11 + dR, fn: () => arm(p, view, G, J.shR, handR, -1, false) });
    if (R.hammer && !hamBehind) parts.push({ d: 30, fn: () => hammer(p, view, G, handR, R.hammer) });
    if (!R.hammer) parts.push({ d: 40, fn: () => hammerDown(p, view, G) });
    parts.sort((a, b) => a.d - b.d);
    for (const part of parts) part.fn();
    // (the hand on the haft over the hammer: the grip reads)
    if (R.hammer && !hamBehind) {
      const h = proj(view, handR, G);
      p.begin('all', 1);
      K.blob(p, h[0], h[1], 1.5, 1.5, SKIN, { maxShade: 3 });
      p.end();
      // a raised hammer is held in both hands
      if (Math.hypot(handR[0] - handL[0], handR[1] - handL[1], handR[2] - handL[2]) < 6) {
        const l = proj(view, handL, G);
        p.begin('all', 1);
        K.blob(p, l[0], l[1], 1.4, 1.4, SKIN, { maxShade: 3 });
        p.end();
      }
    }
    rimLight(p);
  }

  /**
   * The moon behind him (the camera looks north): a cold rim on the dark cloth's right and top
   * edges — the lightest (cyan-slate) tone of the cloak and the robe.
   * @param {any} p
   */
  function rimLight(p) {
    const { w, h, mat, shade } = p;
    const rimmed = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mat[i];
        if (m !== CLOAK && m !== ROBE) continue;
        if (!mat[i + 1] || (!mat[i - w] && !mat[i - w + 1])) rimmed.push(i);
      }
    }
    for (const i of rimmed) shade[i] = 4;
  }

  return {
    fw: 64, fh: 64, columns: COLUMNS,
    aliases: { windup: 'sweepWind', attack: 'sweep', hurt: 'hum', roar: 'hum', dead: 'crownBreak', stun: 'kneel', ring: 'raise', carillon: 'raise' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.5, 0.75]) },
    idle: { poses: ['idle0', 'idle1'], fps: 1.6 },
    draw,
    ramps: () => K.makeRamps({
      // the navy robe and the darker under-robe
      [ROBE]: K.ramp5(['#0a0c14', '#141824', '#202638', '#2e3850', '#4f6f92']),
      [ROBE2]: K.ramp5(['#06070c', '#0c0e16', '#141824', '#1e2434', '#2a3246']),
      // the cloak of dark slate, its blue-violet lining, the rime crust (white with a cyan cast)
      [CLOAK]: K.ramp5(['#0e121c', '#192030', '#26324a', '#3a4c6c', '#6390b8']),
      [LINING]: K.ramp5(['#120e26', '#1e1a3e', '#2c2a5a', '#3e3e78', '#565a96']),
      [RIME]: K.ramp5(['#3c5a7a', '#6e94b8', '#a6c8e2', '#d6ecf8', '#f4fcff']),
      // the old man: pale cool skin, white hair and beard
      [SKIN]: K.ramp5(['#4e3e44', '#7c6668', '#a89290', '#ccb8b0', '#e8d8cc']),
      [HAIR]: K.ramp5(['#5c6478', '#8c96aa', '#bcc6d6', '#dfe6ef', '#f8fbff']),
      [BEARD]: K.ramp5(['#646c80', '#949eb2', '#c4ccda', '#e4eaf2', '#ffffff']),
      [EYE]: K.eyeRamp('#121620', '#2a3448'),
      // the craft: the scorched leather apron, the dark haft, the iron band, the bronze bell
      [APRON]: K.ramp5(['#0e0906', '#1c130c', '#2c1f14', '#3e2e1e', '#56412a']),
      [HAFT]: K.ramp5(['#0a0a0e', '#16161c', '#24242c', '#363642', '#4a4a58']),
      [BAND]: K.ramp5(['#2a2e38', '#4a505e', '#727a8a', '#9ea6b4', '#cfd6e0']),
      [M.GOLD]: K.ramp5(['#3a2410', '#6a4420', '#9a6a30', '#c89448', '#e8c070']),
      // the black ice of the hammer's head and the crown's band
      [ICE]: K.ramp5(['#070b14', '#0e1828', '#18283e', '#2a4462', '#4a7096']),
      [CROWN]: K.ramp5(['#0a1422', '#14263c', '#1f3a58', '#33587e', '#5482aa']),
      // the frost's light: crown spikes, the hammer's rims (glow texels: the brain lights them)
      [GLOW]: K.glowRamp(['#164a68', '#2a82aa', '#58c2e6', '#a4ecff', '#eefcff']),
      [TRIM]: K.ramp5(['#2a3446', '#46546c', '#6c7e98', '#9cb0c8', '#cad8e8']),
      [BOOT]: K.ramp5(['#08080c', '#121218', '#1c1c24', '#2a2a34', '#3a3a48']),
    }, ROBE),
  };
}
