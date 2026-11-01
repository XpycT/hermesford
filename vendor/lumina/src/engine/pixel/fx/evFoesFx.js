/**
 * The foes' FX frames (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.6): painted into
 * the combat FX atlas (../FxSprites.js: the module shape, the pen and the kit) in grey levels that
 * the FxQuads instance colour tints. Generation `late: 3` (the campaign's batch: they pack after
 * every shipped frame). Owner: the foes package; registered by the pack's Hushguard module. On snow a
 * pale effect vanishes, so every frame here is a **cut-out**: a bright core inside a dark rim (the
 * kit's `R` / `S` greys tint to a deep teal), never a soft white glow. RNG-free.
 *
 * - `evArc` 48 × 24 × 4 (30 fps, flat along the swing): a Hushguard's cut — a steel crescent with a
 *   rime-white leading edge and a dark trailing rim, sweeping right to left (played flipped for the
 *   rising cut; scaled up for the halberd's sweep).
 * - `evCore` 24 × 24 × 4 (20 fps, billboard): the armour blown open — ice shards bursting out of a
 *   bright heart.
 * - `evSeal` 24 × 24 × 5 (14 fps, billboard): the plates closing — a ring of frost crystals drawn in
 *   to the chest, a last glint.
 * - `evWard` 32 × 32 × 4 (8 fps, flat on the ground, looped): a cantor's ward under a Hushguard — a
 *   ring of six frost runes turning.
 * - `evShard` 12 × 6 × 2 (12 fps, flat along the flight: +U forward): a rime crow's spat ice shard.
 * - `evBreath` 44 × 40 × 3 (12 fps, flat: the jaws at the bottom centre, +V forward): a frost wolf's
 *   breath — a fan of frost curling out.
 * - `evRing` 24 × 24 × 4 (12 fps, billboard): a sound made visible — a ring spreading from a handbell
 *   (the cantor's call), a howl.
 * - `evBite` 16 × 12 × 3 (24 fps, billboard): a wolf's snap — two fangs of light closing.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps, late }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  evArc: Object.freeze({ w: 48, h: 24, n: 4, fps: 30, late: 3 }),
  evCore: Object.freeze({ w: 24, h: 24, n: 4, fps: 20, late: 3 }),
  evSeal: Object.freeze({ w: 24, h: 24, n: 5, fps: 14, late: 3 }),
  evWard: Object.freeze({ w: 32, h: 32, n: 4, fps: 8, late: 3 }),
  evShard: Object.freeze({ w: 12, h: 6, n: 2, fps: 12, late: 3 }),
  evBreath: Object.freeze({ w: 44, h: 40, n: 3, fps: 12, late: 3 }),
  evRing: Object.freeze({ w: 24, h: 24, n: 4, fps: 12, late: 3 }),
  evBite: Object.freeze({ w: 16, h: 12, n: 3, fps: 24, late: 3 }),
});

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  switch (name) {
    case 'evArc': arc(pen, i, K); break;
    case 'evCore': core(pen, i, K); break;
    case 'evSeal': seal(pen, i, K); break;
    case 'evWard': ward(pen, i, K); break;
    case 'evShard': shard(pen, i, K); break;
    case 'evBreath': breath(pen, i, K); break;
    case 'evRing': ring(pen, i, K); break;
    case 'evBite': bite(pen, i, K); break;
    default: break;
  }
}

/**
 * A dark rim round everything painted so far (one pass, `v`): the cut-out that reads on snow.
 * @param {FxPen} pen @param {number} v
 */
function rim(pen, v) {
  pen.rim(v);
}

/**
 * The cut: a crescent bulging toward the frame top (+V: forward), revealed right → left over four
 * frames, its leading edge white, a dark rim behind.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function arc(pen, i, K) {
  const P = [[0.15, 1.3], [0.1, 2.3], [0.35, 3.0], [1.7, 3.05]][i];
  const cx = 24;
  const cy = 22.5;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 48; x++) {
      const dx = (x + 0.5 - cx) / 21.5;
      const dy = (cy - (y + 0.5)) / 20;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < P[0] || a > P[1] || dy < -0.05) continue;
      const u = (a - P[0]) / Math.max(1e-6, P[1] - P[0]);
      const t = 0.26 * (0.4 + 0.6 * u);
      if (r > 1 || r < 1 - t) continue;
      const edge = r > 1 - t * 0.35;
      pen.set(x, y, edge ? (u > 0.7 ? K.W : K.L) : u > 0.5 ? K.MID : K.D);
    }
  }
  if (i === 3) for (let x = 4; x < 20; x += 3) pen.set(x, 19 - (x % 2), K.D);
  rim(pen, K.R);
}

/**
 * The armour blown open: a bright heart, eight ice shards flying out (longer each frame), a ring.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function core(pen, i, K) {
  const c = 11.5;
  const reach = [4, 7, 9.5, 11][i];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.2;
    const len = reach * (k % 2 ? 0.75 : 1);
    const r0 = i === 3 ? len * 0.55 : 1.5;
    for (let s = r0; s <= len; s += 0.5) {
      const x = c + Math.cos(a) * s;
      const y = c + Math.sin(a) * s;
      const tip = s > len - 1.2;
      pen.max(x, y, tip ? K.W : s < len * 0.5 ? K.L : K.MID);
      if (s < len - 2 && i < 3) pen.max(x + Math.sin(a) * 0.8, y - Math.cos(a) * 0.8, K.D);
    }
  }
  if (i < 3) {
    const hr = [3, 2.5, 1.6][i];
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const d = Math.abs(x) + Math.abs(y) * 0.8;
      if (d <= hr) pen.set(c + x, c + y, d < hr * 0.5 ? K.W : K.L);
    }
  }
  if (i === 1 || i === 2) for (let a = 0; a < 24; a++) { const t = (a / 24) * Math.PI * 2; pen.max(c + Math.cos(t) * (4 + i * 2), c + Math.sin(t) * (4 + i * 2), K.S); }
  rim(pen, K.R);
}

/**
 * The seal: six frost crystals drawn in from a ring to the heart, then a glint.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function seal(pen, i, K) {
  const c = 11.5;
  if (i === 4) {
    // the last glint: a small four-point star
    for (let k = -4; k <= 4; k++) {
      const v = Math.abs(k) < 2 ? K.W : K.L;
      pen.set(c + k, c, v);
      pen.set(c, c + k, v);
    }
    rim(pen, K.R);
    return;
  }
  const r = [10, 7.5, 5, 2.8][i];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + i * 0.35;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    // a crystal: a small diamond pointing inward
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 2) continue;
      pen.max(x + dx, y + dy, Math.abs(dx) + Math.abs(dy) === 0 ? K.W : K.L);
    }
    // its trail toward the ring it came from
    for (let s = 1; s <= 3; s++) pen.max(x + Math.cos(a) * (s + 1.5), y + Math.sin(a) * (s + 1.5), K.D);
  }
  if (i >= 2) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) pen.max(c + x, c + y, K.MID);
  rim(pen, K.R);
}

/**
 * The ward: a ring (r 12–14 px) with six runes on it — a bell, a bar, a bell… — turning a twelfth
 * per frame; flat on the ground.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function ward(pen, i, K) {
  const c = 15.5;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const r = Math.hypot(x + 0.5 - c - 0.5, y + 0.5 - c - 0.5);
    if (r >= 12.6 && r <= 13.6) pen.set(x, y, (x + y + i) % 4 === 0 ? K.MID : K.L);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + (i / 4) * (Math.PI / 3);
    const x = c + 0.5 + Math.cos(a) * 13.1;
    const y = c + 0.5 + Math.sin(a) * 13.1;
    // a rune: a small bell (even) or a crossed bar (odd), 5 × 5
    const glyph = k % 2 === 0
      ? [[0, -2], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [0, 2]]
      : [[-2, -2], [2, -2], [-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1], [-2, 2], [2, 2]];
    for (const [dx, dy] of glyph) pen.set(x + dx, y + dy, K.W);
  }
  rim(pen, K.R);
}

/**
 * An ice shard along +U: a long sharp crystal, a facet line, a dark rim.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function shard(pen, i, K) {
  for (let x = 1; x < 11; x++) {
    const t = x / 10;
    const half = t < 0.75 ? 1 + Math.round(t * 1.4) : Math.round((1 - t) * 6);
    for (let dy = -half; dy <= half; dy++) {
      const v = dy === (i ? 0 : -1) ? K.W : dy < 0 ? K.L : K.MID;
      pen.set(x, 2.5 + dy, v);
    }
  }
  rim(pen, K.S);
}

/**
 * The frost breath: a fan spreading from the bottom centre toward the top, lumpy curls along its
 * edges, denser near the jaws; frames curl outward.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function breath(pen, i, K) {
  const ox = 22;
  const oy = 39.5;
  const half = 0.4;
  const reach = 33 + i * 3;
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 44; x++) {
      const dx = x + 0.5 - ox;
      const dy = oy - (y + 0.5);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dx, dy);
      if (dy < 1) continue;
      // a fan with curling, scalloped edges: billows along its rim, denser at the jaws
      const curl = 0.035 * Math.sin(r * 0.55 - i * 1.6);
      if (Math.abs(a) > half + curl + (r < 6 ? 0.25 : 0)) continue;
      const scallop = 1.6 * Math.max(0, Math.sin(a * 13 + i * 1.9));
      if (r > reach + scallop) continue;
      const billow = Math.sin(r * 0.45 - i * 2.2) * Math.cos(a * 7 + i);
      const edge = r > reach + scallop - 2.5 || Math.abs(a) > half + curl - 0.06;
      const v = r < 7 ? K.W : edge ? K.L : billow > 0.35 ? K.L : billow < -0.55 ? K.D : K.MID;
      pen.set(x, y, v);
    }
  }
  rim(pen, K.R);
}

/**
 * A sound made visible: three arcs (the upper half of rings) spreading from a point low in the
 * frame, the outer fading.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function ring(pen, i, K) {
  const c = 11.5;
  // a full ring spreading (dashed as it thins), a fainter one inside it, from the second frame
  for (const [k, r] of [[0, 3.5 + i * 2.4], [1, 1.5 + i * 2.4 - 2.6]]) {
    if (r < 1.5 || r > 11.2) continue;
    const n = Math.max(12, Math.round(r * 7));
    for (let a = 0; a < n; a++) {
      const t = (a / n) * Math.PI * 2;
      if (i >= 2 && a % 4 === 0) continue;
      pen.max(c + Math.cos(t) * r, c + Math.sin(t) * r, k === 0 ? (i < 2 ? K.W : K.L) : K.MID);
    }
  }
  rim(pen, K.R);
}

/**
 * A snap: two curved fangs of light closing on the middle.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function bite(pen, i, K) {
  const gap = [4, 2, 0.5][i];
  for (let x = 2; x < 14; x++) {
    const t = (x - 8) / 6;
    const curve = 2.5 * (1 - t * t);
    const yTop = 5.5 - gap - curve * 0.6;
    const yBot = 6.5 + gap + curve * 0.6;
    const v = Math.abs(t) < 0.4 ? K.W : K.L;
    pen.set(x, yTop, v);
    pen.set(x, yBot, v);
    if (Math.abs(t) < 0.7 && x % 3 === 0) {
      pen.set(x, yTop + 1, K.MID);
      pen.set(x, yBot - 1, K.MID);
    }
  }
  rim(pen, K.R);
}
