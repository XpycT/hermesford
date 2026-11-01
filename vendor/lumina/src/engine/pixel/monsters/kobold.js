/**
 * Scalekin Skirmisher — the small lizardfolk of Vanquish the Evil Dragon's swarms
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7): ≈ 0.9 u tall in a 24 × 24 frame, a hunched
 * slate-teal lizard with a cream belly, a red crest, bone war paint across the snout, a bronze-tipped
 * spear with a red tassel and a round hide shield with a painted sun. Owner: the swarm package.
 *
 * Columns: COMMON (`idle0`/`idle1` breathing, `move0`–`move3` a scuttling run with the spear
 * levelled, `windup` the spear drawn back behind the shield, `attack` the jab, `hurt`, `dead` on its
 * side) + `lungeWind` (a deep crouch, the spear low and back, the tail up), `lunge` (stretched low,
 * the spear driven forward) and `guard` / `guard2` (the shield up, the spear over it, breathing — a
 * pack member waiting its turn). Painted like the other monsters: shaded parts in the label buffer, light from the upper
 * left, the plum outline; the side view faces left (the right row mirrors it). RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/**
 * The rig of each pose (side view; the front / back views read the same numbers): body drop `by`
 * (+ = lower), forward lean `lean` (px toward the facing), head offset `hx`/`hy`, `jaw` (0 shut,
 * 1 open), eyes, the legs' feet (`fn`/`ff`: near / far foot x offset, `ln`/`lf`: lift), the tail tip
 * (`tx`, `ty` offsets of the curl), the spear (`sp`: 'up' upright at the side, 'level' slanted forward
 * for the run, 'back' drawn back for the jab, 'jab' thrust, 'low' held low and back, 'drive' driven
 * forward, 'over' over the shield, 'drop' tilted away) and the shield (`sh`: 'side', 'front', 'raised',
 * 'low').
 * @typedef {{ by?: number, lean?: number, hx?: number, hy?: number, jaw?: number, eye?: string,
 *   fn?: number, ff?: number, ln?: number, lf?: number, tx?: number, ty?: number, sp: string,
 *   sh: string, stretch?: boolean }} KoboldPose
 */

/** @type {Record<string, KoboldPose>} */
const POSES = {
  idle0: { sp: 'up', sh: 'side' },
  idle1: { by: 1, hy: 0, tx: 1, ty: -1, sp: 'up', sh: 'side' },
  move0: { lean: 1, fn: -2, ff: 2, lf: 1, tx: 1, sp: 'level', sh: 'front' },
  move1: { lean: 1, by: -1, fn: 0, ff: 0, ln: 1, tx: 0, ty: -1, sp: 'level', sh: 'front' },
  move2: { lean: 1, fn: 2, ff: -2, ln: 1, tx: -1, sp: 'level', sh: 'front' },
  move3: { lean: 1, by: -1, fn: 0, ff: 0, lf: 1, tx: 0, ty: 1, sp: 'level', sh: 'front' },
  windup: { by: 1, lean: -1, hx: 1, jaw: 1, eye: 'fierce', fn: -1, ff: 2, tx: 1, ty: -2, sp: 'back', sh: 'front' },
  attack: { lean: 2, hx: -1, jaw: 1, eye: 'fierce', fn: -3, ff: 3, tx: 0, ty: 1, sp: 'jab', sh: 'low' },
  hurt: { by: 0, lean: -1, hx: 2, hy: -1, jaw: 1, eye: 'shut', fn: 1, ff: -1, tx: 2, ty: -1, sp: 'drop', sh: 'side' },
  dead: { sp: 'drop', sh: 'side' },
  lungeWind: { by: 2, lean: 0, hx: 1, hy: 1, jaw: 1, eye: 'fierce', fn: -1, ff: 3, tx: 1, ty: -4, sp: 'low', sh: 'front' },
  lunge: { by: 2, lean: 3, hx: -2, hy: 1, jaw: 1, eye: 'fierce', fn: -4, ff: 4, lf: 0, tx: -1, ty: 0, sp: 'drive', sh: 'low', stretch: true },
  guard: { by: 1, sp: 'over', sh: 'raised', eye: 'fierce' },
  guard2: { by: 2, tx: 1, ty: -1, sp: 'over', sh: 'raised', eye: 'fierce' },
};

/** Column names after COMMON. */
const EXTRA = ['lungeWind', 'lunge', 'guard', 'guard2'];

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function kobold(K) {
  const { M } = K;
  const SCALE = M.FUR, DARK = M.FUR2, BELLY = M.FUR3, CREST = M.COMB, TIP = M.METAL, TASSEL = M.SCARF;

  /** Thin limb segment (1–2 px) with a shade. */
  function seg(p, x0, y0, x1, y1, w, mat, s) {
    K.thickLine(p, x0, y0, x1, y1, w, mat, s);
  }

  /**
   * A digitigrade leg: hip → knee (forward) → ankle (back) → a clawed foot on the ground.
   * @param {any} p @param {number} hx @param {number} hy @param {number} fx foot x @param {number} G
   * @param {number} lift @param {number} dir −1: toes point left @param {number} mat @param {number} s0
   */
  function leg(p, hx, hy, fx, G, lift, dir, mat, s0) {
    const gy = G - lift;
    const kx = (hx + fx) / 2 + dir * 1.5;
    const ky = hy + (gy - hy) * 0.45;
    const ax = fx - dir * 1;
    const ay = gy - 1;
    seg(p, hx, hy, kx, ky, 2.2, mat, s0 + 1);
    seg(p, kx, ky, ax, ay, 1.4, mat, s0);
    p.set(Math.round(ax), Math.round(gy), mat, s0);
    p.set(Math.round(ax + dir), Math.round(gy), mat, s0 + 1);
    p.set(Math.round(ax + dir * 2), Math.round(gy), M.BONE, 2); // claw
  }

  /**
   * The tail: a tapering curl from the base, `n` points, its tip lifted by `ty`.
   * @param {any} p @param {number} bx @param {number} by @param {number} dir +1: grows right
   * @param {number} len @param {number} tx @param {number} ty
   */
  function tail(p, bx, by, dir, len, tx, ty) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = bx + dir * (len * t + tx * t * t);
      const y = by + 3.2 * t - 4.2 * t * t * t + ty * t * t + 1.2 * t * t;
      pts.push([x, y]);
    }
    for (let i = 0; i < 6; i++) {
      const w = 2.6 - i * 0.32;
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      seg(p, x0, y0, x1, y1, w, SCALE, (t) => (y0 + (y1 - y0) * t < by + 1.5 ? 2 : 1));
    }
    // a light ridge on top of the base
    p.over(Math.round(pts[1][0]), Math.round(pts[1][1] - 1), SCALE, 3);
  }

  /**
   * Scale texture: every few pixels of a part one tone darker (the scales), lit side kept.
   * @param {any} p @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
   */
  function scales(p, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (p.get(x, y) !== SCALE) continue;
        const s = p.getShade(x, y);
        if (s >= 1 && s <= 3 && (x * 2 + y * 3) % 5 === 0) p.set(x, y, SCALE, s - 1);
      }
    }
  }

  /**
   * The spear: shaft from (bx, by) to (tx, ty) — the tip end — with a leaf blade and a red tassel.
   * @param {any} p @param {number} bx @param {number} by @param {number} tx @param {number} ty
   * @param {boolean} far drawn behind (darker)
   */
  function spear(p, bx, by, tx, ty, far) {
    const dx = tx - bx;
    const dy = ty - by;
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    // shaft (stops under the blade)
    p.line2(bx, by, tx - ux * 3, ty - uy * 3, M.WOOD, (t) => (far ? 1 : t > 0.5 ? 3 : 2));
    // blade: 3 px along the line, 1 px wider at its base
    for (let k = 0; k < 3; k++) {
      const x = tx - ux * k;
      const y = ty - uy * k;
      p.set(Math.round(x), Math.round(y), TIP, k === 0 ? 4 : far ? 2 : 3);
    }
    const nx = -uy;
    const ny = ux;
    p.set(Math.round(tx - ux * 2 + nx), Math.round(ty - uy * 2 + ny), TIP, far ? 1 : 2);
    p.set(Math.round(tx - ux * 2 - nx), Math.round(ty - uy * 2 - ny), TIP, far ? 2 : 4);
    // tassel under the blade, hanging down
    const qx = Math.round(tx - ux * 3.6);
    const qy = Math.round(ty - uy * 3.6);
    p.set(qx, qy + 1, TASSEL, far ? 1 : 3);
    p.set(qx, qy + 2, TASSEL, far ? 0 : 2);
  }

  /**
   * A round hide shield: rim, hide, a painted sun and a bone boss. `rx` < `ry` foreshortens it.
   * @param {any} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry
   * @param {boolean} back the strapped back (no paint)
   */
  function shield(p, cx, cy, rx, ry, back) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const l = -dx * 0.6 - dy * 0.75;
        let s = l > 0.35 ? 3 : l > -0.3 ? 2 : 1;
        if (d > 0.62) s = l > 0.1 ? 2 : 0; // the darker rim (stitched hide over a hoop)
        if (d > 0.62 && l > 0.5) s = 3;
        p.set(x, y, M.LEATHER, s);
      }
    }
    const ix = Math.round(cx - 0.5);
    const iy = Math.round(cy - 0.5);
    if (back) {
      // straps and the hoop's cross-brace
      p.line2(ix - Math.floor(rx) + 1, iy, ix + Math.floor(rx) - 1, iy, M.WOOD, 1);
      p.line2(ix, iy - Math.floor(ry) + 1, ix, iy + Math.floor(ry) - 1, M.WOOD, 2);
      return;
    }
    // the painted sun: a red ring of rays round the bone boss
    if (rx >= 2.2) {
      for (const [dx, dy] of [[0, -2], [2, 0], [0, 2], [-2, 0]]) p.over(ix + dx, iy + dy, CREST, dx < 0 || dy < 0 ? 3 : 2);
      if (rx >= 2.8) for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.over(ix + dx, iy + dy, CREST, 1);
    } else {
      p.over(ix, iy - 2, CREST, 3);
      p.over(ix, iy + 2, CREST, 2);
    }
    p.set(ix, iy, M.BONE, 3);
    if (rx >= 2.2) p.set(ix - 1, iy, M.BONE, 4);
  }

  /**
   * Stamp hand-placed pixels: `rows` of legend characters ('.' = nothing) at (x0, y0).
   * @param {any} p @param {string[]} rows @param {Record<string, [number, number]>} lg
   * @param {number} x0 @param {number} y0
   */
  function stamp(p, rows, lg, x0, y0) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const e = lg[rows[r][c]];
        if (e) p.set(x0 + c, y0 + r, e[0], e[1]);
      }
    }
  }

  /** Head legend: scales by tone, cream under the jaw, the eye and its slit, mouth, fangs. */
  /** @type {Record<string, [number, number]>} */
  const HL = {
    D: [SCALE, 0], d: [SCALE, 1], o: [SCALE, 2], O: [SCALE, 3], L: [SCALE, 4],
    c: [BELLY, 2], C: [BELLY, 3], e: [M.EYE, 3], E: [M.EYE, 4], p: [M.EYE, 0],
    m: [M.NOSE, 1], M: [M.NOSE, 2], t: [M.BONE, 4], n: [SCALE, 0], w: [M.BONE, 3],
  };
  /** Side heads (facing left), the skull centre at column 6, row 3. */
  const HEAD_SIDE = {
    shut: ['....dOOOd.', '..dOOLLOOd', '.nOOOOOOod', 'oOOOOOoood', 'DDDDDDDood', '.cCCCcdd..'],
    open: ['....dOOOd.', '..dOOLLOOd', '.nOOOOOOod', 'oOOOOOoood', 'tMMMMmmdod', 'dmcCCcddd.', '.DccccDd..'],
  };
  /** Front heads, the skull centre at column 4, row 3. */
  const HEAD_FRONT = {
    shut: ['..dOOOd..', '.dOOLOOod', 'dOOOOOOod', 'dOOLOOOod', '.dOOOOod.', '.dnOOnod.', '..DDDDD..', '..cCCcc..'],
    open: ['..dOOOd..', '.dOOLOOod', 'dOOOOOOod', 'dOOLOOOod', '.dOOOOod.', '.dnOOnod.', '..DtmtD..', '..cMMMc..', '...ccc...'],
    back: ['..dOOOd..', '.dOOLOOod', 'dOOOOOOod', 'dOOOOOood', '.dOOoood.', '..doood..', '...ddd...'],
  };

  /**
   * The side head (facing left) with the pose's jaw and eyes; (x, y) = skull centre.
   * @param {any} p @param {number} x @param {number} y @param {KoboldPose} P
   */
  function headSide(p, x, y, P) {
    p.begin('all', 0);
    stamp(p, P.jaw ? HEAD_SIDE.open : HEAD_SIDE.shut, HL, x - 6, y - 3);
    p.end();
    p.begin(null);
    // eye: amber with a dark slit, a brow ridge (heavy when fierce); shut: a dark line
    const ex = x - 1;
    const ey = y - 1;
    if (P.eye === 'shut') { p.set(ex, ey, SCALE, 0); p.set(ex + 1, ey, SCALE, 0); p.set(ex - 1, ey + 1, SCALE, 1); }
    else {
      p.set(ex, ey, M.EYE, P.eye === 'fierce' ? 4 : 3);
      p.set(ex + 1, ey, M.EYE, 0);
      p.set(ex, ey - 1, SCALE, P.eye === 'fierce' ? 0 : 1);
      p.set(ex + 1, ey - 1, SCALE, P.eye === 'fierce' ? 0 : 2);
    }
    // a bone stripe of war paint down the cheek
    p.over(x + 1, y, M.BONE, 3);
    p.over(x + 1, y + 1, M.BONE, 2);
    p.end();
  }

  /**
   * The front or back head; (x, y) = skull centre.
   * @param {any} p @param {number} x @param {number} y @param {KoboldPose} P @param {boolean} back
   */
  function headFront(p, x, y, P, back) {
    p.begin('below', 1);
    stamp(p, back ? HEAD_FRONT.back : P.jaw ? HEAD_FRONT.open : HEAD_FRONT.shut, HL, x - 4, y - 3);
    p.end();
    if (back) return;
    p.begin(null);
    // wide-set eyes: amber, the slits toward the snout; the lit one brighter
    for (const [ex, dir, s] of [[x - 4, 1, 3], [x + 4, -1, 2]]) {
      if (P.eye === 'shut') { p.set(ex, y - 1, SCALE, 0); p.set(ex + dir, y - 1, SCALE, 0); continue; }
      p.set(ex, y - 1, M.EYE, P.eye === 'fierce' ? s + 1 : s);
      p.set(ex + dir, y - 1, M.EYE, 0);
      if (P.eye === 'fierce') p.set(ex + dir, y - 2, SCALE, 0);
    }
    // bone war paint: two dabs on the brow
    p.over(x - 2, y - 2, M.BONE, 4);
    p.over(x + 2, y - 2, M.BONE, 3);
    p.end();
  }

  /** The crest: three red spines rising back from the skull (side view). */
  function crestSide(p, x, y) {
    const spikes = [[0, 0, 3], [2, 1, 3], [4, 2.5, 2], [5.5, 4, 1]];
    for (const [dx, dy, h] of spikes) {
      for (let k = 0; k < h; k++) p.set(Math.round(x + dx + k * 0.5), Math.round(y + dy - k), CREST, k === h - 1 ? 3 : k === 0 ? 1 : 2);
    }
  }

  /**
   * Side view (facing left).
   * @param {any} p @param {KoboldPose} P @param {number} G
   */
  function drawSide(p, P, G) {
    const by = P.by ?? 0;
    const lean = P.lean ?? 0;
    const hipX = 13 + (P.stretch ? 1 : 0);
    const hipY = 17 + by;
    const cx = 11.6 - lean * 0.6;
    const cy = 14.6 + by;
    const hx = 7.6 - lean + (P.hx ?? 0) - (P.stretch ? 1 : 0);
    const hy = 10.6 + by + (P.hy ?? 0) + (P.stretch ? 1.5 : 0);
    const sp = P.sp;
    // spear behind the body (the far hand): upright, levelled for the run
    p.begin(null);
    if (sp === 'up') spear(p, 14.5, G, 14.5, 3 + by, true);
    p.end();
    // far leg, tail
    p.begin(null);
    leg(p, hipX + 1, hipY, 12 + (P.ff ?? 0), G, P.lf ?? 0, -1, DARK, 1);
    p.end();
    p.begin(null);
    tail(p, hipX + 2, hipY - 1, 1, P.stretch ? 7.5 : 6.5, P.tx ?? 0, P.ty ?? 0);
    p.end();
    // body: a hunched chest and a round belly, cream belly plates on the front
    p.begin(null);
    K.blob(p, hipX - 0.3, hipY - 1, 3, 2.6, SCALE, { hi: 0.35, lo: -0.25 });
    K.blob(p, cx, cy, P.stretch ? 3.6 : 3.2, 3.3, SCALE, { hi: 0.4, lo: -0.2 });
    for (let y = Math.round(cy - 1); y <= hipY; y++) {
      for (let x = Math.round(cx - 4); x <= Math.round(cx); x++) {
        if (p.get(x, y) !== SCALE) continue;
        const edge = p.get(x - 1, y) === 0;
        if (edge || x > cx - 1.5 + (y - cy) * 0.3) continue;
        p.set(x, y, BELLY, (y - Math.round(cy)) % 2 === 0 ? 3 : 2);
      }
    }
    scales(p, Math.round(cx - 3), Math.round(cy - 4), hipX + 3, hipY + 1);
    p.end();
    // near leg
    p.begin('sides', 1);
    leg(p, hipX - 0.5, hipY + 0.5, 11 + (P.fn ?? 0), G, P.ln ?? 0, -1, SCALE, 1);
    p.end();
    // head: a round skull and a long tapering snout; cream under the jaw; the crest behind
    headSide(p, Math.round(hx), Math.round(hy), P);
    p.begin(null);
    crestSide(p, hx + 0.5, hy - 2.6);
    p.end();
    // the levelled spear of the run passes in front of the body, under the shield
    if (sp === 'level') {
      p.begin(null);
      spear(p, 17.5, 20 + by, 5, 3 + by, false);
      armTo(p, cx, cy - 1, 10.5, 13 + by);
      p.end();
    }
    // near arm with the shield, the far hand's spear when it is in front
    p.begin('all', 0);
    const sh = P.sh;
    if (sh === 'raised') shield(p, hx - 1.5, hy + 1.5, 2.1, 3.4, false);
    else if (sh === 'front') shield(p, cx - 2.4, cy + 0.6, 2.1, 3.3, false);
    else if (sh === 'low') shield(p, cx + 1.5, cy + 2, 2, 3, false);
    else shield(p, cx - 1.2, cy + 0.6, 2.1, 3.3, false);
    p.end();
    p.begin(null);
    if (sp === 'back') { spear(p, 21, 14.5 + by, 7.5, 14 + by, false); armTo(p, cx + 0.5, cy - 1.5, 15.5, 14.5 + by); }
    else if (sp === 'jab') { spear(p, 14, 15 + by, 2.5, 14.5 + by, false); armTo(p, cx, cy - 1.5, 8.5, 15 + by); }
    else if (sp === 'low') { spear(p, 21, 16 + by, 8.5, 15 + by, false); armTo(p, cx + 0.5, cy - 1, 15, 15.5 + by); }
    else if (sp === 'drive') { spear(p, 13.5, 15 + by, 2.5, 14 + by, false); armTo(p, cx - 0.5, cy - 1, 7.5, 14.5 + by); }
    else if (sp === 'over') { spear(p, 18, 11 + by, 4, 8 + by, false); armTo(p, cx + 0.5, cy - 1.5, 12, 10 + by); }
    else if (sp === 'drop') { spear(p, 6, G, 17, 6 + by, true); }
    else if (sp === 'up') armTo(p, cx + 0.5, cy - 1, 14, cy + 0.5);
    p.end();
  }

  /** The far arm reaching its spear hand (a 1 px forearm with a clawed hand). */
  function armTo(p, sx, sy, hx, hy) {
    seg(p, sx, sy, hx, hy, 1.4, SCALE, 2);
    p.set(Math.round(hx), Math.round(hy), SCALE, 3);
  }

  /**
   * Front (down) or back (up) view.
   * @param {any} p @param {KoboldPose} P @param {number} G @param {boolean} back
   */
  function drawFront(p, P, G, back) {
    const by = P.by ?? 0;
    const cx = 12;
    const cy = 15.2 + by;
    const hx = 12 + (P.hx ?? 0) * 0.5;
    const hy = 10.4 + by + (P.hy ?? 0) + (P.stretch ? 1 : 0);
    // the spear hand is screen-left from the front, screen-right from the back
    const sd = back ? 1 : -1;
    const sp = P.sp;
    const stride = (P.fn ?? 0) - (P.ff ?? 0);
    // tail: behind (front view: a curl peeking out at the side; back view: toward the viewer)
    p.begin(null);
    if (back) {
      seg(p, 12, 17 + by, 13 + (P.tx ?? 0) * 0.5, 20.5, 2.6, SCALE, 2);
      seg(p, 13 + (P.tx ?? 0) * 0.5, 20.5, 16 + (P.tx ?? 0), 21.5 + Math.min(0, (P.ty ?? 0) * 0.3), 1.6, SCALE, 1);
    } else {
      seg(p, 13, 18 + by, 17, 19.5 + by, 2, DARK, 1);
      seg(p, 17, 19.5 + by, 19 + (P.tx ?? 0) * 0.5, 18 + (P.ty ?? 0) * 0.5, 1.2, DARK, 1);
    }
    p.end();
    // spear behind (upright at the side, or held behind the shield)
    p.begin(null);
    if (sp === 'up') spear(p, cx + sd * 5, G, cx + sd * 5, 3 + by, false);
    p.end();
    // legs (stride: one foot forward = lower on screen is not possible; lift one instead)
    p.begin(null);
    const lifts = [Math.max(0, P.ln ?? 0), Math.max(0, P.lf ?? 0)];
    for (const [k, lx] of [[0, cx - 2], [1, cx + 2]]) {
      const lift = lifts[k];
      const gy = G - lift;
      seg(p, lx, 17 + by, lx + (k ? 0.5 : -0.5), gy - 1, 2.2, SCALE, k === 0 ? 2 : 1);
      p.set(lx - 1, gy, SCALE, 1); p.set(lx, gy, SCALE, 2); p.set(lx + 1, gy, SCALE, 1);
      p.set(lx - 1 + (k ? 2 : 0), gy, M.BONE, 2);
    }
    void stride;
    p.end();
    // body
    p.begin(null);
    K.blob(p, cx, cy, 3.4, 3.5, SCALE, { hi: 0.35, lo: -0.25 });
    if (!back) {
      for (let y = Math.round(cy - 1.5); y <= Math.round(cy + 2.5); y++) {
        for (let x = cx - 1; x <= cx + 1; x++) p.over(x, y, BELLY, (y - Math.round(cy)) % 2 === 0 ? (x < cx ? 3 : 2) : (x < cx ? 2 : 1));
      }
    } else {
      // spine ridge
      for (let y = Math.round(cy - 3); y <= Math.round(cy + 2); y += 2) { p.over(cx, y, SCALE, 3); p.over(cx - 1, y + 1, SCALE, 1); }
    }
    scales(p, cx - 4, Math.round(cy - 4), cx + 4, Math.round(cy + 4));
    // hide belt
    for (let x = cx - 3; x <= cx + 3; x++) p.over(x, Math.round(cy + 2.5), M.LEATHER, x < cx ? 2 : 1);
    p.end();
    // head (the muzzle toward the viewer), the crest's three spines on the crown
    headFront(p, Math.round(hx), Math.round(hy) - 1, P, back);
    p.begin(null);
    const top = Math.round(hy) - 4;
    for (const [dx, h] of [[-2, 2], [0, 3], [2, 2]]) {
      for (let k = 0; k < h; k++) p.set(Math.round(hx) + dx, top - k, CREST, k === h - 1 ? 3 : k === 0 ? 1 : 2);
    }
    p.end();
    // arms, shield, spear in front
    const sh = P.sh;
    const shx = cx - sd * 4.2;
    p.begin(null);
    // spear arm
    const ax = cx + sd * 3;
    if (sp === 'up') { seg(p, ax, cy - 2, cx + sd * 4.5, cy + 0.5, 1.4, SCALE, back ? 1 : 3); p.set(cx + sd * 5, Math.round(cy + 0.5), SCALE, 3); }
    p.end();
    p.begin('all', 0);
    const raise = sh === 'raised' ? -3 : sh === 'low' ? 2 : sh === 'front' ? -0.5 : 0;
    const shX = sh === 'front' || sh === 'raised' ? shx + sd * 1.6 : shx;
    shield(p, shX, cy + 0.2 + raise, sh === 'front' || sh === 'raised' ? 3.2 : 2.6, 3.2, back);
    p.end();
    p.begin(null);
    if (sp === 'level') spear(p, cx + sd * 4, 19 + by, cx + sd * 2, 4 + by, false);
    else if (sp === 'back') spear(p, cx + sd * 6, 18 + by, cx + sd * 2, 6 + by, false);
    else if (sp === 'jab') spear(p, cx + sd * 1, 10 + by, cx + sd * 0.5, 21, false);
    else if (sp === 'low') spear(p, cx + sd * 7, 13 + by, cx + sd * 3, 20, false);
    else if (sp === 'drive') spear(p, cx + sd * 1, 11 + by, cx, 21, false);
    else if (sp === 'over') spear(p, cx + sd * 6, 16 + by, cx - sd * 1, 5 + by, false);
    else if (sp === 'drop') spear(p, cx - sd * 6, G, cx + sd * 6, 5 + by, true);
    if (sp !== 'up' && sp !== 'drop') {
      const hy2 = sp === 'jab' || sp === 'drive' ? 13 + by : 13.5 + by;
      seg(p, ax, cy - 2, cx + sd * (sp === 'jab' || sp === 'drive' ? 1.2 : 3.5), hy2, 1.4, SCALE, back ? 1 : 3);
    }
    p.end();
  }

  /**
   * Dead: on its side, the spear and the shield dropped beside it.
   * @param {any} p @param {'down'|'up'|'side'} view @param {number} G
   */
  function drawDead(p, view, G) {
    const side = view === 'side';
    p.begin(null);
    spear(p, side ? 3 : 4, G - 1, side ? 21 : 20, G - 4, true);
    p.end();
    p.begin(null);
    seg(p, 15, G - 2, 20, G - 1, 2, SCALE, 1); // tail
    seg(p, 20, G - 1, 21, G - 3, 1.2, SCALE, 1);
    K.blob(p, 12.5, G - 2.2, 4.2, 2.2, SCALE, { hi: 0.3, lo: -0.3 });
    for (let x = 10; x <= 14; x++) p.over(x, G - 1, BELLY, x < 12 ? 2 : 1);
    scales(p, 8, G - 5, 17, G);
    p.end();
    p.begin('all', 0);
    K.blob(p, 7, G - 2.5, 2.6, 2, SCALE, { hi: 0.3, lo: -0.3 });
    K.blob(p, 4.5, G - 1.8, 1.8, 1.2, SCALE);
    p.end();
    p.begin(null);
    p.set(7, G - 3, SCALE, 0); p.set(8, G - 2, SCALE, 0); // shut eye
    p.set(5, G - 3, M.BONE, 3);
    for (const [dx, h] of [[0, 2], [2, 1]]) for (let k = 0; k < h; k++) p.set(8 + dx, G - 5 - k, CREST, 2);
    p.end();
    p.begin('all', 0);
    shield(p, side ? 16 : 17, G - 1.2, 2.8, 1.2, view === 'up');
    p.end();
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    const G = f.G;
    if (key === 'dead') { drawDead(p, view, G); return; }
    const P = POSES[key] ?? POSES.idle0;
    if (view === 'side') drawSide(p, P, G);
    else drawFront(p, P, G, view === 'up');
    if (key === 'hurt') K.shear(p, view === 'side' ? -0.14 : 0.1, G);
  }

  return {
    fw: 24, fh: 24, columns: [...K.COMMON, ...EXTRA], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([0.75, 0.38]) },
    draw,
    ramps: () => K.makeRamps({
      // slate-teal scales (cool against the ochre ground), a cream belly, a rust-red crest
      [M.FUR]: K.ramp5(['#101e1c', '#1d3531', '#2c5047', '#3f7360', '#6aa284']),
      [M.FUR2]: K.ramp5(['#0b1514', '#142623', '#203a34', '#2c5047', '#3f7360']),
      [M.FUR3]: K.ramp5(['#4a3820', '#7c6038', '#a88a54', '#cdb274', '#ecd9a0']),
      [M.COMB]: K.ramp5(['#3a0c0a', '#6e1a12', '#a42c18', '#d24a22', '#f07a36']),
      [M.SCARF]: K.ramp5(['#3a0a10', '#6a1420', '#9e2230', '#c83a3c', '#e8665a']),
      [M.LEATHER]: K.ramp5(['#2a170c', '#4e2e18', '#7a4c2a', '#a6743e', '#ca9a5a']),
      [M.WOOD]: K.ramp5(['#2a1a0e', '#4a3018', '#6e4a26', '#946a3a', '#b88c52']),
      [M.METAL]: K.ramp5(['#3a2410', '#6e4a1e', '#a8762e', '#dcae52', '#fff0b0']),
      [M.BONE]: K.ramp5(['#6a6050', '#9c9078', '#cabe9e', '#e8dec2', '#fffaea']),
      [M.NOSE]: K.ramp5(['#2a0808', '#4e1010', '#7a1c18', '#a83024', '#d04a34']),
      [M.EYE]: K.eyeRamp('#d89a1a', '#ffd84a'),
    }, M.FUR),
  };
}
