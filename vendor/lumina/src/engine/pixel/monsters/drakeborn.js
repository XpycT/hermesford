/**
 * Drakeborn Ravager — a dragonkin brute of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7): crimson-black scales over a hunched, heavy frame, ochre belly scutes, digitigrade legs
 * with bone claws, swept ivory horns and ember eyes, bone armour (a beast-skull pauldron, a rib plate
 * strapped across the chest), a jagged sawback greatcleaver and a spined tail. ≈ 2.6 u tall in a
 * 76 × 72 frame (the contract's 48 × 48 had no room for the cleaver raised over the horns or swept
 * out to the side).
 * Owner: the brutes package.
 *
 * Columns: COMMON (`windup` = the cleaver raised behind the shoulder, `attack` = the cleave) and
 * `cleave2` (the backhand), `follow` (the blade down after a cleave), `goreWind` (crouched, horns
 * lowered), `gore0` / `gore1` (the charge), `slamWind` (the cleaver overhead in both hands), `slam`
 * (driven into the ground), `roar` (arms spread, maw open). Each pose is a rig — joints for the front
 * view (the back view mirrors it) and for the side view (facing left; the `right` row mirrors it) —
 * painted from shaded capsules lit from the upper left, with the kit's ramps and outlines. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number]} Pt */

/**
 * A front-view rig (screen px of the 64 × 64 frame; the brute faces the viewer, its right hand on
 * the screen's left). Feet carry a lift (px off the ground).
 * @typedef {object} FrontRig
 * @property {Pt} hip      pelvis centre
 * @property {Pt} chest    chest centre
 * @property {Pt} head     head centre
 * @property {number} look -1 head down (gore), 0 level, 1 up (roar)
 * @property {number} jaw  0 closed, 1 open
 * @property {Pt[]} armR   right arm (screen left): shoulder, elbow, hand
 * @property {Pt[]} armL   left arm (screen right)
 * @property {number[][]} legR  right leg: hip, knee, ankle, foot [x, y, lift]
 * @property {number[][]} legL
 * @property {{ hand: 'R'|'L', ang: number, len: number, edge: number, front: boolean }|null} blade
 *   the cleaver: in which hand, its direction (degrees, 0 = screen right, 90 = up), length (px),
 *   which side its edge faces (±1 across the direction) and whether it is drawn over the body
 * @property {Pt[]} tail   tail points (base first)
 */

/**
 * A side-view rig (facing left).
 * @typedef {object} SideRig
 * @property {Pt} hip @property {Pt} chest @property {Pt} head
 * @property {number} snout  snout direction (degrees; 180 = left, 200 = left and down)
 * @property {number} jaw
 * @property {Pt[]} armN  near arm: shoulder, elbow, hand
 * @property {Pt[]} armF  far arm
 * @property {Pt[]} legN  near leg: hip, knee, hock, toe
 * @property {Pt[]} legF
 * @property {{ ang: number, len: number, edge: number, front: boolean, hand?: Pt }|null} blade (near hand)
 * @property {Pt[]} tail
 * @property {Pt[]} horn  horn points (base first)
 */

const DEG = Math.PI / 180;
/** The rigs' 64 × 64 layout box sits this far in from the frame's left and top (the frame is 76 × 72). */
const OX = 6, OY = 8;
/** Light direction (toward the light, the upper left), as the kit's blob uses it. */
const LX = -0.55, LY = -0.8;

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function drakeborn(K) {
  const { M } = K;
  const SCALE = M.FUR, DARK = M.FUR2, BELLY = M.FUR3, BONE = M.BONE, IRON = M.METAL, HIDE = M.LEATHER, GLOW = M.GLOW, GRIP = M.WOOD;

  // -------------------------------------------------------------------------------------------
  // Painting helpers (all RNG-free)
  // -------------------------------------------------------------------------------------------

  /**
   * A tapered capsule from a (radius ar) to b (radius br), shaded as a cylinder lit from the upper
   * left: tones by the facing of each pixel's offset from the axis; `shine` turns the lit rim to 4.
   * @param {any} p @param {number[]} a @param {number} ar @param {number[]} b @param {number} br
   * @param {number} mat @param {{ hi?: number, lo?: number, deep?: number, lift?: number, shine?: number, max?: number }} [o]
   */
  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { hi = 0.42, lo = -0.22, deep = -0.72, lift = 0, shine = 0, max = 4 } = o;
    const [ax, ay] = a, [bx, by] = b;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1e-9;
    const R = Math.max(ar, br);
    const x0 = Math.floor(Math.min(ax, bx) - R - 1), x1 = Math.ceil(Math.max(ax, bx) + R + 1);
    const y0 = Math.floor(Math.min(ay, by) - R - 1), y1 = Math.ceil(Math.max(ay, by) + R + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const cx = ax + vx * t, cy = ay + vy * t;
        const r = ar + (br - ar) * t;
        const dx = px - cx, dy = py - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const l = (dx * LX + dy * LY) / Math.max(0.5, r);
        let s = l > hi ? 3 : l > lo ? 2 : l > deep ? 1 : 0;
        if (shine && l > shine && d2 > r * r * 0.3) s = 4;
        s = Math.max(0, Math.min(max, s + lift));
        p.set(x, y, mat, s);
      }
    }
  }

  /** A chain of capsules through `pts` with radii `rs` (one per point). */
  function chain(p, pts, rs, mat, o) {
    for (let i = 0; i + 1 < pts.length; i++) capsule(p, pts[i], rs[i], pts[i + 1], rs[i + 1], mat, o);
  }

  /** An ellipse shaded like the kit's blob, with an optional bright rim. */
  function body(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.42, lo: -0.25, deep: -0.75, ...o });
  }

  /** Scale texture: dark dashes in a staggered lattice over the lit tones of `mat` in a box. */
  function scales(p, x0, y0, x1, y1, mat, phase = 0) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (p.get(x, y) !== mat) continue;
        const s = p.getShade(x, y);
        if (s < 2 || s > 3) continue;
        const row = Math.floor((y + phase) / 3);
        const u = (x + (row & 1) * 2) & 3;
        const v = (y + phase) % 3;
        if (v === 2 && u !== 3) p.tone(x, y, -1);
        else if (v === 0 && u === 0 && s === 3) p.tone(x, y, 1);
      }
    }
  }

  /** Bone claws: `n` short hooked strokes from (x, y) along dx (−1 left / 1 right), down. */
  function claws(p, x, y, dir, n = 3, spread = 2) {
    for (let k = 0; k < n; k++) {
      const cx = x + (k - (n - 1) / 2) * spread;
      p.set(cx, y, BONE, 3);
      p.set(cx + dir, y + 1, BONE, 2);
    }
  }

  /**
   * The greatcleaver from `hand` along `ang` (degrees): a leather grip with a bone pommel behind the
   * fist, then a broad sawback blade widening toward a squared, hooked tip; the cutting edge (side
   * `edge` across the direction) bright and notched, the spine dark with saw teeth.
   */
  function cleaver(p, hand, ang, len, edge) {
    const dx = Math.cos(ang * DEG), dy = -Math.sin(ang * DEG);
    const nx = -dy * edge, ny = dx * edge; // toward the edge
    const [hx, hy] = hand;
    /** A point `s` along the blade and `u` across it (toward the edge). */
    const at = (s, u) => [hx + dx * s + nx * u, hy + dy * s + ny * u];
    // grip (leather-wrapped) and a bone pommel
    p.begin('all', 0);
    capsule(p, at(-5, 0), 1.2, at(2, 0), 1.2, GRIP, { lift: -1 });
    p.end();
    p.begin(null);
    for (let s = -4; s <= 1; s += 2) { const [x, y] = at(s, 0); p.over(Math.round(x), Math.round(y), GRIP, 3); }
    const [qx, qy] = at(-6, 0);
    p.set(Math.round(qx), Math.round(qy), BONE, 3);
    p.end();
    // the blade: the straight spine (−u), the edge widening to a squared, hooked tip
    const b0 = 2.5, sp = -1.6, w0 = 4.8, w1 = 7.6;
    const edgeAt = (s) => w0 + (w1 - w0) * Math.max(0, Math.min(1, (s - b0) / (len - b0)));
    p.begin('all', 0);
    K.fillPoly(p, [at(b0, sp), at(len + 1.5, sp), at(len + 0.5, w1), at(len - 1.5, w1 + 0.6), at(b0 + 1.5, w0)], IRON, (x, y) => {
      const px = x + 0.5 - hx, py = y + 0.5 - hy;
      const s = px * dx + py * dy;
      const u = px * nx + py * ny;
      const e = edgeAt(s);
      if (u > e - 1.0) return 4;                         // the honed edge
      if (u > e - 2.2) return 3;                         // its bevel
      if (u < sp + 1.1) return 1;                        // the dark spine
      if (u < sp + 2.0) return 2;
      return ((Math.round(s) * 3 + Math.round(u) * 5) % 11 === 0) ? 1 : 2; // hammer marks and pitting
    });
    p.end();
    // a guard collar, notches in the edge, saw teeth on the spine, the tip's hook, rivets
    p.begin(null);
    for (let u = sp; u <= w0 - 0.5; u += 0.5) { const [x, y] = at(b0, u); p.set(Math.round(x), Math.round(y), BONE, u < 1 ? 3 : 2); }
    for (let s = b0 + 4; s < len - 1; s += 4.5) { const [x, y] = at(s, edgeAt(s) - 0.3); p.erase(Math.round(x), Math.round(y)); }
    for (let s = b0 + 3; s < len; s += 3) { const [x, y] = at(s, sp - 1); p.set(Math.round(x), Math.round(y), IRON, 1); }
    const [kx, ky] = at(len + 1.6, sp - 1.2);
    p.set(Math.round(kx), Math.round(ky), IRON, 3);
    for (const s of [b0 + 2, b0 + 5]) { const [x, y] = at(s, 1); p.set(Math.round(x), Math.round(y), BONE, 4); }
    p.end();
  }

  /** A bone-studded bracer: a band across the forearm near the wrist (elbow e → hand h). */
  function bracer(p, e, h, lift) {
    const vx = h[0] - e[0], vy = h[1] - e[1];
    const l = Math.hypot(vx, vy) || 1;
    const ux = vx / l, uy = vy / l;
    const c = [h[0] - ux * 2.6, h[1] - uy * 2.6];
    p.begin(null);
    for (let k = -3; k <= 3; k++) {
      const x = Math.round(c[0] - uy * k * 0.9), y = Math.round(c[1] + ux * k * 0.9);
      if (!p.get(x, y)) continue;
      p.set(x, y, HIDE, Math.max(0, 2 + lift - (k > 1 ? 1 : 0)));
      const x2 = Math.round(x - ux), y2 = Math.round(y - uy);
      if (p.get(x2, y2) === SCALE) p.set(x2, y2, HIDE, Math.max(0, 1 + lift));
      if ((k & 1) === 0 && k > -3 && k < 3) p.set(x, y, BONE, Math.max(1, 3 + lift));
    }
    p.end();
  }

  /** A clawed hand (fist) at (x, y). */
  function fist(p, x, y, r = 2.6) {
    body(p, x, y, r, r * 0.9, SCALE, { hi: 0.3, lo: -0.3 });
    p.set(Math.round(x - 1), Math.round(y + r - 0.2), BONE, 3);
    p.set(Math.round(x + 1), Math.round(y + r - 0.2), BONE, 2);
  }

  // -------------------------------------------------------------------------------------------
  // Front (down) and back (up) views
  // -------------------------------------------------------------------------------------------

  /** One leg of the front / back view: thigh, shin, clawed foot. */
  function legFront(p, L, lit) {
    const [hip, knee, ankle, foot] = L;
    const lift = lit ? 0 : -1;
    p.begin('all', 1);
    capsule(p, hip, 4.6, knee, 3.6, SCALE, { lift });
    p.end();
    p.begin('all', 1);
    capsule(p, knee, 3.3, ankle, 2.4, SCALE, { lift });
    p.end();
    // the foot: a wedge with three bone claws
    p.begin('all', 0);
    const fy = foot[1] - (foot[2] ?? 0);
    body(p, foot[0], fy - 1.2, 3.6, 1.9, DARK);
    claws(p, foot[0], fy, 0, 3, 2);
    p.end();
  }

  /** The beast-skull pauldron on a shoulder (front view): a bone dome with an eye socket and a horn. */
  function pauldron(p, s, side, back) {
    p.begin('all', 0);
    body(p, s[0] + side * 0.5, s[1] - 0.5, 5.4, 4.4, BONE, { hi: 0.25, lo: -0.3 });
    p.end();
    p.begin(null);
    if (!back) {
      p.set(Math.round(s[0] + side * 1), Math.round(s[1] + 0), BONE, 0); // eye socket
      p.set(Math.round(s[0] + side * 2), Math.round(s[1] + 0), BONE, 0);
      p.set(Math.round(s[0] + side * 1.5), Math.round(s[1] + 1), BONE, 1);
      for (let k = -2; k <= 2; k++) p.set(Math.round(s[0] + k), Math.round(s[1] + 3.6), BONE, k & 1 ? 1 : 3); // teeth
    }
    p.end();
    // a short curved horn off the skull
    p.begin('all', 0);
    chain(p, [[s[0] + side * 3, s[1] - 3], [s[0] + side * 6, s[1] - 6], [s[0] + side * 6.5, s[1] - 9]], [1.6, 1.1, 0.6], BONE, { lift: 1 });
    p.end();
  }

  /** The horned head, front view (`back`: from behind). */
  function headFront(p, R, back) {
    const [hx, hy] = R.head;
    const up = R.look;
    // horns: from the temples out, up and back (lowered for the charge: out and toward the viewer)
    const horn = up < 0
      ? (sx) => [[hx + sx * 4, hy - 2], [hx + sx * 8, hy - 2], [hx + sx * 10.5, hy + 1], [hx + sx * 10, hy + 5]]
      : (sx) => [[hx + sx * 4, hy - 3], [hx + sx * 8, hy - 5 - up], [hx + sx * 10.5, hy - 9 - up], [hx + sx * 10, hy - 13 - up]];
    p.begin('all', 0);
    // (lowered for the charge they point at the viewer: thicker, foreshortened)
    const hr = up < 0 ? [2.6, 2.3, 1.8, 1.0] : [2.2, 1.9, 1.4, 0.7];
    chain(p, horn(-1), hr, BONE, { lift: 0 });
    chain(p, horn(1), hr, BONE, { lift: -1 });
    p.end();
    // ridges of horn rings
    for (const sx of [-1, 1]) { p.over(Math.round(hx + sx * 7), Math.round(hy - 5 - up), BONE, 1); p.over(Math.round(hx + sx * 9.5), Math.round(hy - 8 - up), BONE, 1); }
    // the skull and brow
    p.begin('all', 0);
    body(p, hx, hy, 5.6, 5.2, SCALE, { hi: 0.35, lo: -0.3 });
    p.end();
    if (back) {
      // the back of the head: a frill of dark spines down the nape
      p.begin(null);
      for (let k = -2; k <= 2; k++) { p.set(hx + k * 2, hy - 4, DARK, 3); p.set(hx + k * 2, hy - 5, DARK, 2); }
      for (let y = hy - 2; y <= hy + 4; y++) p.over(hx, y, DARK, y & 1 ? 2 : 1);
      p.end();
      return;
    }
    // the muzzle toward the viewer: a lighter wedge with nostrils, the jaw and fangs
    const my = hy + 2 + (up < 0 ? 1 : 0);
    p.begin('all', 1);
    body(p, hx, my + 1.5, 3.8, 2.8, SCALE, { hi: 0.2, lo: -0.4 });
    p.end();
    p.begin(null);
    p.set(hx - 2, my + 1, DARK, 0); p.set(hx + 1, my + 1, DARK, 0); // nostrils
    p.set(hx - 1, my - 1, SCALE, 4); // bridge highlight
    if (R.jaw) {
      // open maw: the glowing throat, teeth top and bottom
      for (let x = hx - 3; x <= hx + 2; x++) { p.set(x, my + 3, GLOW, x === hx - 1 || x === hx ? 4 : 3); p.set(x, my + 4, GLOW, 2); }
      p.set(hx - 3, my + 2, BONE, 4); p.set(hx + 2, my + 2, BONE, 3); p.set(hx - 2, my + 5, BONE, 3); p.set(hx + 1, my + 5, BONE, 3);
      body(p, hx, my + 6.2, 3.2, 1.3, SCALE, { hi: 0.2, lo: -0.5 });
    } else {
      for (let x = hx - 3; x <= hx + 2; x++) p.set(x, my + 3, DARK, 0); // mouth line
      p.set(hx - 3, my + 4, BONE, 4); p.set(hx + 2, my + 4, BONE, 3); // fangs
    }
    p.end();
    // brow ridge and ember eyes
    p.begin(null);
    const ey = hy - 1 - (up > 0 ? 1 : 0);
    for (let x = hx - 5; x <= hx + 4; x++) if (x !== hx - 1 && x !== hx) p.set(x, ey - 1, DARK, x < hx ? 1 : 0);
    p.set(hx - 3, ey, GLOW, 4); p.set(hx - 4, ey, GLOW, 3);
    p.set(hx + 2, ey, GLOW, 4); p.set(hx + 3, ey, GLOW, 3);
    p.end();
  }

  /** Torso of the front / back view: chest, belly scutes, rib plate and strap (front) or spines (back). */
  function torsoFront(p, R, back) {
    const [cx, cy] = R.chest;
    const [px, py] = R.hip;
    // hide tasset hanging from the belt
    p.begin('all', 1);
    K.fillPoly(p, [[px - 6, py - 2], [px + 6, py - 2], [px + 5, py + 7], [px + 1, py + 9], [px - 2, py + 8], [px - 5, py + 7]], HIDE,
      (x, y) => (Math.abs(Math.round(x - px)) % 3 === 1 ? 1 : y > py + 6 ? 1 : x < px ? 3 : 2));
    p.end();
    p.begin(null);
    p.set(Math.round(px - 3), Math.round(py + 8), BONE, 3); p.set(Math.round(px + 3), Math.round(py + 7), BONE, 2);
    p.end();
    p.begin('all', 1);
    body(p, (cx + px) / 2, py - 3, 8.5, 6, SCALE);            // waist
    body(p, cx, cy, 12.5, 9.8, SCALE, { hi: 0.4 });            // the great chest
    p.end();
    if (!back) {
      // belly scutes: ochre bands down the middle
      p.begin(null);
      for (let y = Math.round(cy + 2); y <= py; y++) {
        const w = 3 + ((y - cy) < 6 ? 1 : 0);
        for (let x = Math.round((cx + px) / 2) - w; x <= Math.round((cx + px) / 2) + w - 1; x++) {
          p.over(x, y, BELLY, (y - Math.round(cy)) % 3 === 0 ? 1 : x < (cx + px) / 2 ? 3 : 2);
        }
      }
      p.end();
      // pectoral plates: two lit curves
      p.begin(null);
      for (let k = -1; k <= 1; k += 2) {
        for (let i = 0; i < 7; i++) p.over(Math.round(cx + k * (2 + i)), Math.round(cy - 3 + i * 0.35 + (i > 4 ? 1 : 0)), SCALE, k < 0 ? 4 : 3);
        for (let i = 0; i < 6; i++) p.over(Math.round(cx + k * (2 + i)), Math.round(cy + 2 + i * 0.3), DARK, 1);
      }
      p.end();
      // the rib plate of bone strapped across the chest (character's left shoulder to right hip)
      p.begin('all', 0);
      for (let i = 0; i < 4; i++) {
        const y = cy - 4 + i * 3;
        capsule(p, [cx + 3, y], 0.9, [cx + 8 - i, y + 1], 0.8, BONE, { lift: 1 });
      }
      p.end();
      p.begin('all', 0);
      capsule(p, [cx + 11, cy - 7], 1.1, [px - 6, py - 1], 1.1, HIDE, { lift: 0 });
      p.end();
      p.begin(null);
      for (let t = 0.2; t < 1; t += 0.3) p.set(Math.round(cx + 11 + (px - 6 - cx - 11) * t), Math.round(cy - 7 + (py - 1 - cy + 7) * t), BONE, 4);
      p.end();
    } else {
      // the back: a ridge of bone spines down the middle, darker scales
      p.begin(null);
      for (let y = Math.round(cy - 8); y <= py + 1; y++) { p.over(Math.round(cx), y, DARK, y & 1 ? 1 : 2); p.over(Math.round(cx) - 1, y, SCALE, 3); }
      for (let k = 0; k < 5; k++) {
        const y = Math.round(cy - 8 + k * 4);
        p.set(Math.round(cx), y, BONE, 3); p.set(Math.round(cx), y - 1, BONE, 4);
      }
      p.end();
      // shoulder-blade shading
      p.begin(null);
      for (const k of [-1, 1]) for (let i = 0; i < 5; i++) p.over(Math.round(cx + k * (4 + i)), Math.round(cy - 2 + i), DARK, 1);
      p.end();
    }
    scales(p, Math.round(cx - 13), Math.round(cy - 10), Math.round(cx + 13), Math.round(py + 2), SCALE);
  }

  /** One arm of the front / back view: shoulder, upper arm, forearm, fist. */
  function armFront(p, A, lit) {
    const [s, e, h] = A;
    const lift = lit ? 0 : -1;
    p.begin('all', 1);
    capsule(p, s, 4.4, e, 3.5, SCALE, { lift });
    p.end();
    p.begin('all', 1);
    capsule(p, e, 3.4, h, 2.6, SCALE, { lift });
    p.end();
    bracer(p, e, h, lift);
    p.begin('all', 0);
    fist(p, h[0], h[1]);
    p.end();
  }

  function tailFront(p, pts, back) {
    p.begin('all', 1);
    chain(p, pts, pts.map((_, i) => (back ? 3.6 : 3.2) - i * (back ? 0.9 : 0.8)), back ? SCALE : DARK, { lift: back ? 0 : -1 });
    p.end();
    if (back) {
      p.begin(null);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x, y] = pts[i];
        p.set(Math.round(x), Math.round(y - 1), BONE, 3);
      }
      p.end();
    }
  }

  /** Mirror a front rig for the back view (x → 64 − x; the arms swap screen sides). */
  function mirrorRig(R) {
    const m = (pt) => [64 - pt[0], pt[1], ...pt.slice(2)];
    return {
      ...R,
      hip: m(R.hip), chest: m(R.chest), head: m(R.head),
      armR: R.armR.map(m), armL: R.armL.map(m), legR: R.legR.map(m), legL: R.legL.map(m),
      tail: R.tail.map(m),
      blade: R.blade ? { ...R.blade, ang: 180 - R.blade.ang, edge: -R.blade.edge, front: !R.blade.front } : null,
    };
  }

  /** Paint the front (down) or back (up) view of a front rig. */
  function drawFront(p, R0, back) {
    const R = back ? mirrorRig(R0) : R0;
    const hand = R.blade ? (R.blade.hand === 'L' ? R.armL[2] : R.armR[2]) : null;
    // character's right side is lit in the front view (screen left), its left in the back view
    const rLit = !back;
    if (R.blade && !R.blade.front) cleaver(p, hand, R.blade.ang, R.blade.len, R.blade.edge);
    if (!back) tailFront(p, R.tail, false);
    legFront(p, R.legL, !rLit);
    legFront(p, R.legR, rLit);
    torsoFront(p, R, back);
    // the arm whose hand crosses the chest is drawn last
    const crossR = R.armR[2][0] > R.chest[0] - 4;
    if (!crossR) armFront(p, R.armR, rLit);
    armFront(p, R.armL, !rLit);
    // pauldrons: the skull on the character's left shoulder, a plain plate on the right
    pauldron(p, R.armL[0], back ? -1 : 1, back);
    p.begin('all', 0);
    body(p, R.armR[0][0], R.armR[0][1] - 0.5, 4.2, 3.4, BONE, { hi: 0.2, lo: -0.3, maxShade: 3 });
    p.end();
    if (back) tailFront(p, R.tail, true);
    headFront(p, R, back);
    if (crossR) armFront(p, R.armR, rLit);
    if (R.blade && R.blade.front) cleaver(p, hand, R.blade.ang, R.blade.len, R.blade.edge);
  }

  // -------------------------------------------------------------------------------------------
  // Side view (facing left)
  // -------------------------------------------------------------------------------------------

  /** A digitigrade leg in profile: thigh forward, shin back to the hock, the foot forward to the toes. */
  function legSide(p, L, near) {
    const [hip, knee, hock, toe] = L;
    const lift = near ? 0 : -1;
    const mat = near ? SCALE : DARK;
    p.begin(near ? 'all' : null, 1);
    capsule(p, hip, 4.8, knee, 3.6, mat, { lift });
    p.end();
    p.begin(near ? 'all' : null, 1);
    capsule(p, knee, 3.2, hock, 2.2, mat, { lift });
    capsule(p, hock, 2.1, [toe[0] + 1.5, toe[1] - 1], 1.6, mat, { lift });
    p.end();
    p.begin(null);
    p.set(toe[0] - 1, toe[1], BONE, near ? 3 : 2); p.set(toe[0], toe[1], BONE, near ? 2 : 1); p.set(toe[0] - 2, toe[1], BONE, near ? 4 : 2);
    p.set(hock[0] + 2, hock[1] + 1, BONE, near ? 2 : 1); // dew claw spur
    p.end();
  }

  function armSide(p, A, near) {
    const [s, e, h] = A;
    const lift = near ? 0 : -1;
    const mat = near ? SCALE : DARK;
    p.begin(near ? 'all' : null, 1);
    capsule(p, s, 4.0, e, 3.2, mat, { lift });
    p.end();
    p.begin(near ? 'all' : null, 1);
    capsule(p, e, 3.1, h, 2.4, mat, { lift });
    p.end();
    if (near) bracer(p, e, h, 0);
    p.begin(near ? 'all' : null, 0);
    fist(p, h[0], h[1], 2.4);
    p.end();
  }

  function headSide(p, S) {
    const [hx, hy] = S.head;
    const a = S.snout * DEG;
    const dx = Math.cos(a), dy = -Math.sin(a);
    // the far horn (darker), then the near horn sweeping back
    const H = S.horn;
    p.begin(null);
    chain(p, H.map(([x, y]) => [x + 2, y - 1]), [2.0, 1.7, 1.2, 0.6], BONE, { lift: -2 });
    p.end();
    // skull, then the long muzzle
    p.begin('all', 1);
    body(p, hx, hy, 5.2, 4.6, SCALE, { hi: 0.35 });
    p.end();
    const tip = [hx + dx * 9, hy + dy * 9 + 1];
    p.begin('all', 1);
    capsule(p, [hx + dx * 2, hy + dy * 2 + 0.5], 3.6, tip, 2.2, SCALE, { hi: 0.3 });
    p.end();
    // jaw (open: dropped with a glowing throat)
    const jawDrop = S.jaw ? 3 : 0;
    p.begin('all', 0);
    capsule(p, [hx + dx * 1, hy + dy * 1 + 3 + jawDrop * 0.4], 2.2, [tip[0] + 1 - dx * 1, tip[1] + 2 + jawDrop], 1.5, SCALE, { lift: -1 });
    p.end();
    p.begin(null);
    if (S.jaw) {
      for (let k = 1; k < 7; k++) p.set(Math.round(hx + dx * (1 + k)), Math.round(hy + dy * (1 + k) + 2 + jawDrop * 0.5), GLOW, k < 3 ? 4 : 3);
      p.set(Math.round(tip[0] + 1), Math.round(tip[1] + 1), BONE, 4); p.set(Math.round(tip[0] + 2), Math.round(tip[1] + 1 + jawDrop), BONE, 3);
    } else {
      for (let k = 1; k < 8; k++) p.set(Math.round(hx + dx * (1 + k)), Math.round(hy + dy * (1 + k) + 2.5), DARK, 0); // mouth line
      p.set(Math.round(tip[0] + 1), Math.round(tip[1] + 2), BONE, 4); // fang
      p.set(Math.round(tip[0] + 3), Math.round(tip[1] + 2), BONE, 3);
    }
    p.set(Math.round(tip[0] - 0.5), Math.round(tip[1] - 1), DARK, 0); // nostril
    p.set(Math.round(hx + dx * 4), Math.round(hy + dy * 4 - 2), SCALE, 4); // muzzle highlight
    p.end();
    // the near horn
    p.begin('all', 0);
    chain(p, H, [2.3, 1.9, 1.3, 0.7], BONE, { lift: 0 });
    p.end();
    for (let i = 1; i + 1 < H.length; i++) p.over(Math.round(H[i][0]), Math.round(H[i][1] + 1), BONE, 1);
    // brow and eye
    p.begin(null);
    const ex = Math.round(hx + dx * 1.5 - 0.5), ey = Math.round(hy - 1 + dy * 1.5);
    p.set(ex - 1, ey - 1, DARK, 0); p.set(ex, ey - 1, DARK, 0); p.set(ex + 1, ey - 1, DARK, 1);
    p.set(ex, ey, GLOW, 4); p.set(ex + 1, ey, GLOW, 3);
    p.end();
    // nape frill
    p.begin(null);
    for (let k = 0; k < 3; k++) { p.set(hx + 3 + k, hy - 3 + k * 2, DARK, 3); p.set(hx + 4 + k, hy - 3 + k * 2, DARK, 2); }
    p.end();
  }

  function drawSide(p, S) {
    const [cx, cy] = S.chest;
    const [px, py] = S.hip;
    const hand = S.blade ? (S.blade.hand ?? S.armN[2]) : null;
    if (S.blade && !S.blade.front) cleaver(p, hand, S.blade.ang, S.blade.len, S.blade.edge);
    // far limbs and the tail behind the body
    armSide(p, S.armF, false);
    legSide(p, S.legF, false);
    p.begin('all', 1);
    chain(p, S.tail, S.tail.map((_, i) => 4.0 - i * (3.2 / (S.tail.length - 1))), SCALE, { lift: 0 });
    p.end();
    p.begin(null);
    for (let i = 1; i < S.tail.length; i++) {
      const [x, y] = S.tail[i];
      const r = 4.0 - i * (3.2 / (S.tail.length - 1));
      p.set(Math.round(x), Math.round(y - r - 0.5), BONE, 3);
    }
    p.end();
    // the body: rump, the hunched chest
    p.begin('all', 1);
    body(p, px, py - 1, 7.4, 6.4, SCALE);
    body(p, (cx + px) / 2, (cy + py) / 2, 8.2, 8.2, SCALE);
    body(p, cx, cy, 9.6, 9.2, SCALE, { hi: 0.4 });
    p.end();
    // belly scutes along the front, a dark back
    p.begin(null);
    for (let y = Math.round(cy + 1); y <= py + 3; y++) {
      const t = (y - cy) / Math.max(1, py + 3 - cy);
      const x0 = Math.round(cx - 8 + t * 6);
      for (let x = x0; x <= x0 + 3; x++) p.over(x, y, BELLY, (y - Math.round(cy)) % 3 === 0 ? 1 : x === x0 ? 3 : 2);
    }
    p.end();
    scales(p, Math.round(cx - 10), Math.round(cy - 10), Math.round(px + 8), Math.round(py + 6), SCALE);
    // spines down the back
    p.begin('all', 0);
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      const x = Math.round(cx + 4 + t * (px + 6 - cx - 4));
      const y = Math.round(cy - 9 + t * (py - 5 - cy + 9));
      p.set(x + 1, y - 1, BONE, 3); p.set(x + 2, y - 2, BONE, 4); p.set(x + 1, y, BONE, 2);
    }
    p.end();
    // the rib plate and strap over the chest
    p.begin('all', 0);
    for (let i = 0; i < 3; i++) capsule(p, [cx - 5, cy - 3 + i * 3], 0.9, [cx - 1, cy - 2 + i * 3], 0.8, BONE, { lift: 1 });
    p.end();
    // the near leg in front of the body
    legSide(p, S.legN, true);
    // hide tasset
    p.begin('all', 1);
    K.fillPoly(p, [[px - 6, py - 3], [px - 1, py - 3], [px - 2, py + 4], [px - 4, py + 5], [px - 6, py + 3]], HIDE,
      (x, y) => (y > py + 3 ? 1 : x < px - 4 ? 3 : 2));
    p.end();
    p.begin(null);
    p.set(Math.round(px - 4), Math.round(py + 6), BONE, 3);
    p.end();
    headSide(p, S);
    // the skull pauldron on the near shoulder, the near arm, the cleaver
    armSide(p, S.armN, true);
    p.begin('all', 0);
    const [sx, sy] = S.armN[0];
    body(p, sx, sy - 1, 4.8, 4.0, BONE, { hi: 0.25, lo: -0.3 });
    p.end();
    p.begin(null);
    p.set(sx - 2, sy - 1, BONE, 0); p.set(sx - 1, sy - 1, BONE, 0);
    for (let k = -3; k <= 1; k++) p.set(sx + k, sy + 2, BONE, k & 1 ? 1 : 3);
    p.end();
    p.begin('all', 0);
    chain(p, [[sx + 1, sy - 4], [sx + 3, sy - 6], [sx + 4, sy - 7]], [1.3, 0.9, 0.5], BONE, { lift: 1 });
    p.end();
    if (S.blade && S.blade.front) cleaver(p, hand, S.blade.ang, S.blade.len, S.blade.edge);
  }

  // -------------------------------------------------------------------------------------------
  // Rigs per pose
  // -------------------------------------------------------------------------------------------

  /** @returns {FrontRig} */
  function frontRig(key) {
    /** @type {FrontRig} */
    const R = {
      hip: [32, 45], chest: [32, 32], head: [32, 18], look: 0, jaw: 0,
      armR: [[19, 27], [15, 36], [16, 44]], armL: [[45, 27], [49, 36], [48, 44]],
      legR: [[28, 46], [25, 52], [24, 58], [23, 62, 0]], legL: [[36, 46], [39, 52], [40, 58], [41, 62, 0]],
      blade: { hand: 'R', ang: -98, len: 17, edge: -1, front: true },
      tail: [[37, 51], [45, 55], [51, 59], [56, 61]],
    };
    const up = (d, parts = ['hip', 'chest', 'head']) => { for (const k of parts) R[k] = [R[k][0], R[k][1] + d]; };
    const arms = (d) => { R.armR = R.armR.map(([x, y]) => [x, y + d]); R.armL = R.armL.map(([x, y]) => [x, y + d]); };
    switch (key) {
      case 'idle1': up(1); arms(1); break;
      case 'move0':
        R.legL = [[36, 45], [39, 50], [40, 56], [41, 61, 2]]; up(-1); arms(-1);
        R.armR[2] = [17, 42]; R.armL[2] = [47, 44]; break;
      case 'move1': up(1); arms(1); break;
      case 'move2':
        R.legR = [[28, 45], [25, 50], [24, 56], [23, 61, 2]]; up(-1); arms(-1);
        R.armR[2] = [15, 44]; R.armL[2] = [49, 42]; break;
      case 'move3': up(1); arms(1); break;
      case 'windup':
        // the cleaver raised behind the right shoulder, the body twisted back
        R.chest = [31, 32]; R.head = [31, 18];
        R.armR = [[19, 27], [12, 22], [15, 14]];
        R.blade = { hand: 'R', ang: 112, len: 14, edge: -1, front: false };
        break;
      case 'attack':
        // the cleave: swept across the body to the left side, the torso turned through
        R.chest = [33, 33]; R.head = [33, 19]; R.hip = [32, 46];
        R.armR = [[20, 28], [27, 37], [37, 41]];
        R.armL = [[45, 28], [51, 34], [53, 40]];
        R.blade = { hand: 'R', ang: -22, len: 19, edge: -1, front: true };
        break;
      case 'cleave2':
        // the backhand: the blade swept back across the chest to the right side
        R.chest = [31, 33]; R.head = [31, 19];
        R.armR = [[19, 28], [20, 37], [27, 37]];
        R.blade = { hand: 'R', ang: 188, len: 18, edge: 1, front: true };
        break;
      case 'follow':
        R.chest = [33, 34]; R.head = [33, 21]; R.hip = [32, 46];
        R.armR = [[20, 29], [27, 40], [35, 48]];
        R.blade = { hand: 'R', ang: -48, len: 17, edge: -1, front: true };
        break;
      case 'goreWind':
      case 'gore0':
      case 'gore1': {
        // crouched low, the head down between the hunched shoulders, horns toward the viewer
        up(4, ['hip']); up(5, ['chest']); R.head = [32, 31]; R.look = -1;
        R.armR = [[19, 30], [13, 39], [12, 46]]; R.armL = [[45, 30], [51, 39], [52, 45]];
        R.legR = [[28, 49], [24, 54], [24, 59], [23, 62, 0]]; R.legL = [[36, 49], [40, 54], [40, 59], [41, 62, 0]];
        R.blade = { hand: 'R', ang: -120, len: 17, edge: -1, front: false };
        if (key === 'gore0') { R.legL = [[36, 48], [40, 52], [41, 57], [42, 60, 3]]; up(-1, ['chest', 'head']); }
        if (key === 'gore1') { R.legR = [[28, 48], [24, 52], [23, 57], [22, 60, 3]]; up(-1, ['chest', 'head']); }
        break;
      }
      case 'slamWind':
        // both hands overhead, the cleaver held back over the head
        R.chest = [32, 31]; R.head = [32, 18]; R.look = 1;
        R.armR = [[19, 27], [17, 17], [28, 9]]; R.armL = [[45, 27], [47, 17], [36, 9]];
        R.blade = { hand: 'R', ang: 96, len: 10, edge: -1, front: false };
        break;
      case 'slam':
        // driven down into the ground in front, crouched over it
        up(5, ['hip']); up(7, ['chest']); R.head = [32, 27]; R.look = -1;
        R.armR = [[20, 34], [24, 43], [30, 48]]; R.armL = [[44, 34], [40, 43], [34, 48]];
        R.legR = [[28, 50], [23, 55], [23, 59], [22, 62, 0]]; R.legL = [[36, 50], [41, 55], [41, 59], [42, 62, 0]];
        R.blade = { hand: 'R', ang: -88, len: 13, edge: -1, front: true };
        break;
      case 'roar':
        R.chest = [32, 31]; R.head = [32, 16]; R.look = 1; R.jaw = 1;
        R.armR = [[19, 27], [11, 29], [7, 25]]; R.armL = [[45, 27], [53, 29], [57, 25]];
        R.blade = { hand: 'R', ang: 78, len: 17, edge: -1, front: false };
        break;
      case 'hurt':
        R.chest = [33, 31]; R.head = [34, 17]; R.look = 1; R.jaw = 1;
        R.armR = [[20, 27], [15, 34], [13, 41]]; R.armL = [[46, 27], [51, 33], [53, 38]];
        R.blade = { hand: 'R', ang: -120, len: 15, edge: -1, front: true };
        break;
      default: break;
    }
    return R;
  }

  /** @returns {SideRig} */
  function sideRig(key) {
    /** @type {SideRig} */
    const S = {
      hip: [38, 45], chest: [30, 33], head: [20, 22], snout: 196, jaw: 0,
      armN: [[29, 28], [27, 37], [23, 44]], armF: [[36, 27], [39, 35], [37, 42]],
      legN: [[35, 46], [29, 52], [33, 57], [28, 62]], legF: [[39, 45], [34, 51], [39, 56], [35, 61]],
      blade: { ang: -112, len: 17, edge: 1, front: true },
      tail: [[44, 45], [50, 48], [55, 53], [59, 58], [61, 61]],
      horn: [[23, 17], [27, 14], [31, 14], [34, 17]],
    };
    const shift = (dx, dy, parts) => { for (const k of parts) S[k] = [S[k][0] + dx, S[k][1] + dy]; };
    const mv = (list, dx, dy) => list.map(([x, y]) => [x + dx, y + dy]);
    const upper = (dy) => {
      shift(0, dy, ['chest', 'head']);
      S.armN = mv(S.armN, 0, dy); S.armF = mv(S.armF, 0, dy); S.horn = mv(S.horn, 0, dy);
    };
    switch (key) {
      case 'idle1': upper(1); break;
      case 'move0':
        S.legN = [[35, 45], [27, 50], [30, 55], [24, 61]]; S.legF = [[39, 45], [37, 51], [43, 56], [41, 61]]; upper(-1);
        S.armN = [[29, 27], [29, 36], [27, 43]]; break;
      case 'move1':
        S.legN = [[35, 46], [30, 52], [35, 56], [31, 60]]; S.legF = [[39, 46], [33, 52], [37, 57], [32, 62]]; upper(1); break;
      case 'move2':
        S.legN = [[35, 45], [33, 51], [39, 56], [37, 61]]; S.legF = [[39, 45], [31, 50], [34, 55], [28, 61]]; upper(-1);
        S.armN = [[29, 27], [25, 36], [20, 42]]; break;
      case 'move3':
        S.legN = [[35, 46], [31, 52], [36, 57], [33, 62]]; S.legF = [[39, 46], [34, 52], [37, 56], [33, 60]]; upper(1); break;
      case 'windup':
        // leaning back, the cleaver raised back over the shoulder
        shift(2, 0, ['chest']); S.head = [22, 21]; S.horn = mv(S.horn, 2, -1);
        S.armN = [[31, 28], [33, 19], [33, 12]];
        S.blade = { ang: 38, len: 17, edge: -1, front: false };
        break;
      case 'attack':
        // the cleave: lunged forward, the blade swept forward and down
        S.chest = [27, 35]; S.head = [17, 26]; S.snout = 205; S.horn = mv(S.horn, -3, 4);
        S.armN = [[27, 30], [20, 36], [14, 41]];
        S.legN = [[34, 46], [26, 52], [29, 57], [23, 62]];
        S.blade = { ang: -158, len: 16, edge: 1, front: true };
        break;
      case 'cleave2':
        S.chest = [28, 34]; S.head = [18, 24]; S.horn = mv(S.horn, -2, 2);
        S.armN = [[28, 29], [22, 33], [17, 32]];
        S.blade = { ang: 164, len: 16, edge: -1, front: true };
        break;
      case 'follow':
        S.chest = [28, 36]; S.head = [18, 28]; S.snout = 208; S.horn = mv(S.horn, -2, 6);
        S.armN = [[28, 31], [24, 40], [21, 47]];
        S.legN = [[34, 46], [27, 52], [30, 57], [25, 62]];
        S.blade = { ang: -122, len: 16, edge: 1, front: true };
        break;
      case 'goreWind':
      case 'gore0':
      case 'gore1':
        // crouched, near horizontal, the head low with the horns forward
        S.hip = [40, 47]; S.chest = [29, 40]; S.head = [17, 39]; S.snout = 220;
        S.horn = [[20, 35], [16, 32], [12, 31], [9, 33]];
        S.armN = [[29, 35], [34, 42], [40, 46]]; S.armF = [[35, 35], [37, 43], [34, 48]];
        S.legN = [[37, 48], [30, 53], [35, 57], [30, 62]]; S.legF = [[41, 47], [37, 52], [43, 56], [40, 61]];
        S.tail = [[46, 46], [52, 47], [57, 49], [61, 52], [62, 56]];
        S.blade = { ang: -24, len: 15, edge: 1, front: false };
        if (key === 'gore0') { S.legN = [[37, 47], [27, 51], [28, 56], [21, 60]]; S.legF = [[41, 47], [43, 53], [50, 57], [49, 62]]; upper(-1); }
        if (key === 'gore1') { S.legN = [[37, 47], [40, 53], [46, 57], [44, 62]]; S.legF = [[41, 46], [32, 50], [32, 55], [25, 59]]; upper(-1); }
        break;
      case 'slamWind':
        // reared back, both hands over the head, the cleaver back over the shoulders
        S.chest = [32, 32]; S.head = [23, 20]; S.snout = 170; S.horn = mv(S.horn, 3, -2);
        S.armN = [[31, 27], [28, 17], [30, 9]]; S.armF = [[37, 26], [34, 16], [32, 9]];
        S.blade = { ang: 10, len: 16, edge: 1, front: false, hand: [31, 9] };
        break;
      case 'slam':
        // bent over the cleaver driven into the ground ahead
        S.hip = [40, 48]; S.chest = [28, 41]; S.head = [17, 37]; S.snout = 215; S.horn = [[20, 33], [24, 30], [28, 30], [31, 33]];
        S.armN = [[27, 36], [20, 43], [14, 48]]; S.armF = [[33, 36], [24, 43], [16, 48]];
        S.legN = [[37, 49], [29, 54], [33, 58], [27, 62]]; S.legF = [[41, 48], [37, 53], [43, 57], [40, 61]];
        S.tail = [[46, 47], [52, 49], [56, 53], [59, 58], [61, 61]];
        S.blade = { ang: -96, len: 13, edge: 1, front: true };
        break;
      case 'roar':
        S.chest = [31, 31]; S.head = [22, 18]; S.snout = 150; S.jaw = 1; S.horn = mv(S.horn, 2, -3);
        S.armN = [[30, 27], [24, 31], [18, 27]]; S.armF = [[37, 26], [42, 30], [46, 26]];
        S.blade = { ang: 105, len: 17, edge: -1, front: false };
        break;
      case 'hurt':
        S.chest = [33, 32]; S.head = [24, 21]; S.snout = 165; S.jaw = 1; S.horn = mv(S.horn, 4, -1);
        S.armN = [[32, 28], [31, 37], [29, 43]];
        S.blade = { ang: -80, len: 17, edge: 1, front: true };
        break;
      default: break;
    }
    return S;
  }

  /** The fallen brute: on its side, the head down to the left, the tail out to the right, the cleaver dropped. */
  function drawDead(p, view, G) {
    const back = view === 'up';
    p.begin('all', 1);
    chain(p, [[40, G - 4], [48, G - 3], [55, G - 2], [61, G - 1]], [4, 3, 2, 1], SCALE, { lift: -1 });
    p.end();
    p.begin('all', 1);
    body(p, 33, G - 5, 13, 5.6, SCALE);
    body(p, 22, G - 6, 6, 5, SCALE);
    p.end();
    scales(p, 18, G - 12, 46, G, SCALE);
    p.begin('all', 0);
    for (let k = 0; k < 4; k++) { p.set(28 + k * 4, G - 11, BONE, 3); p.set(28 + k * 4, G - 12, BONE, 4); }
    body(p, 24, G - 9, 4, 3, BONE, { hi: 0.25 });
    p.end();
    // the head on the ground, the horn up, the eye dark
    p.begin('all', 1);
    body(p, 13, G - 4, 5, 3.8, SCALE);
    capsule(p, [10, G - 3], 2.6, [4, G - 2], 1.8, SCALE);
    p.end();
    p.begin('all', 0);
    chain(p, [[15, G - 7], [19, G - 10], [24, G - 11], [27, G - 9]], [2, 1.6, 1.1, 0.6], BONE);
    p.end();
    p.begin(null);
    p.set(11, G - 5, DARK, 0); p.set(12, G - 5, DARK, 0);
    p.set(5, G - 1, BONE, 3);
    p.end();
    // a limp arm and a leg; the cleaver dropped flat beside the body
    p.begin('all', 1);
    capsule(p, [28, G - 7], 3, [20, G - 1], 2.2, SCALE);
    capsule(p, [40, G - 6], 3.6, [46, G - 1], 2.4, SCALE, { lift: -1 });
    p.end();
    cleaver(p, [back ? 40 : 34, G - 1], back ? 172 : 6, 15, -1);
  }

  /** @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} f */
  function draw(p, view, key, f) {
    // the rigs are laid out in a 64 × 64 box (ground row 62), drawn 6 px in and 8 px down
    p.ox = OX;
    p.oy = OY;
    if (key === 'dead') drawDead(p, view, f.G - OY);
    else if (view === 'side') drawSide(p, sideRig(key));
    else drawFront(p, frontRig(key), view === 'up');
    if (key === 'hurt') K.shear(p, view === 'side' ? -0.08 : 0.06, f.G);
  }

  return {
    fw: 64 + 2 * OX, fh: 64 + OY,
    columns: [...K.COMMON, 'cleave2', 'follow', 'goreWind', 'gore0', 'gore1', 'slamWind', 'slam', 'roar'],
    aliases: { cleave: 'attack', cleaveWind: 'windup' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([2.0, 0.9]) },
    draw,
    ramps: () => K.makeRamps({
      [SCALE]: K.ramp5(['#1c0b10', '#3b1119', '#5d1b22', '#86302c', '#b45a42']),
      [DARK]: K.ramp5(['#12070a', '#240c10', '#3a1218', '#561c20', '#76302c']),
      [BELLY]: K.ramp5(['#3c2414', '#6b4423', '#9a6834', '#c4904c', '#e6c27a']),
      [BONE]: K.ramp5(['#5e5446', '#948670', '#c6b898', '#e4d8b8', '#fbf4dc']),
      [IRON]: K.ramp5(['#1d1c22', '#36353e', '#585862', '#8a8c96', '#e2e4ea']),
      [HIDE]: K.ramp5(['#22140e', '#3e2618', '#5e3c24', '#7e5634', '#a07448']),
      [GRIP]: K.ramp5(['#1e120c', '#382216', '#54341e', '#70482a', '#8e6038']),
      [GLOW]: K.glowRamp(['#6a1a06', '#c4400e', '#ff7a1e', '#ffb84a', '#fff0a8']),
    }, SCALE),
  };
}
