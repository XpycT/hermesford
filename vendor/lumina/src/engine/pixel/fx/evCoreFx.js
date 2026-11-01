/**
 * The combat core's FX frames for The Bells of Evermere (docs/contracts/COMBAT.md §30.2): the ice
 * gate of a boss arena whose def says `arena.wall.frames: 'evIceWall'` — painted into the combat FX
 * atlas (../FxSprites.js: the module shape, the pen and the kit) in grey levels that the FxQuads
 * instance colour tints. Registered at load by the Evermere pack (src/game/combat/packs/evermere/
 * core.js → `registerFxModule`), so a level without the pack never paints it; generation 3 (`late`),
 * packed after every shipped frame. Owner: the core package. RNG-free: closed-form shapes.
 *
 * - `evIceWall` 20 × 32 × 4 (still: BossArena gives each quad of the gate one of the four by its
 *   place, its foot on the ground): four clusters of two or three ice shards of unlike heights, each
 *   faceted — a lit left face, a shaded right face, a bright ridge, a dark crack —, standing on a
 *   ragged foot of rime, with a 1-texel dark rim all round so the wall reads on white snow as on
 *   dark stone.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps, late }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  evIceWall: Object.freeze({ w: 20, h: 32, n: 4, fps: 0, late: 3 }),
});

/**
 * The four clusters: each shard's ridge x at the foot, tip row, half width at the foot and lean of
 * the tip (texels) — back shards first, the front one last.
 */
const CLUSTERS = [
  [{ cx: 14, top: 12, half: 3.2, lean: 1.2 }, { cx: 7, top: 3, half: 4.4, lean: -0.6 }],
  [{ cx: 4, top: 15, half: 2.6, lean: -1.2 }, { cx: 16, top: 18, half: 2.4, lean: 1 }, { cx: 10, top: 1, half: 4.6, lean: 0.3 }],
  [{ cx: 5, top: 9, half: 3.4, lean: -0.5 }, { cx: 13, top: 6, half: 4, lean: 0.8 }],
  [{ cx: 3.5, top: 20, half: 2.2, lean: -0.8 }, { cx: 15, top: 9, half: 3, lean: 0.6 }, { cx: 9, top: 3, half: 3.8, lean: -0.3 }],
];
/** The foot of rime: its top row; the frame's last row is the ground. */
const FOOT = 28;
const BASE = 31;

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  if (name === 'evIceWall') iceWall(pen, i, K);
}

/**
 * One faceted shard from its tip to the foot: `half` texels wide each side at the foot, narrowing
 * over its upper part to the tip, which leans `lean` texels. The lit face left of the ridge, the
 * shaded one right of it, the ridge itself bright, a dark crack down the shaded face.
 * @param {FxPen} pen @param {{ cx: number, top: number, half: number, lean: number }} s @param {FxKit} K
 */
function shard(pen, s, K) {
  const { cx, top, half, lean } = s;
  for (let y = top; y <= BASE; y++) {
    const t = (y - top) / Math.max(1, BASE - top); // 0 tip … 1 foot
    const w = half * Math.min(1, 0.2 + t * 2);
    const c = cx + lean * (1 - t);
    for (let x = Math.floor(c - w); x <= Math.ceil(c + w); x++) {
      const d = x + 0.5 - c;
      if (Math.abs(d) > w) continue;
      /** @type {number} */
      let v = d < -0.5 ? K.L : d > 0.5 ? K.D : K.W;
      // the lit face pales toward its edge, the shaded one darkens
      if (d < -w * 0.65) v = K.MID;
      if (d > w * 0.6) v = K.S;
      pen.set(x, y, v);
    }
    // a crack down the shaded face, zigzagging every other row
    if (y > top + 4 && y < FOOT - 1 && w > 2) pen.set(Math.round(c + w * 0.35 + ((y >> 1) & 1)), y, K.S);
  }
}

/** @param {FxPen} pen @param {number} i @param {FxKit} K */
function iceWall(pen, i, K) {
  for (const s of CLUSTERS[i % CLUSTERS.length]) shard(pen, s, K);
  // the ragged foot of rime the shards stand in
  for (let y = FOOT; y <= BASE; y++) {
    for (let x = 1; x < 19; x++) {
      const edge = y === FOOT && ((x * 7 + i * 3) % 5 < 2);
      if (edge) continue;
      pen.set(x, y, (x * 5 + y * 3 + i) % 7 === 0 ? K.D : K.MID);
    }
  }
  // a 1-texel dark rim all round: it reads on white snow
  pen.rim(K.R);
}
