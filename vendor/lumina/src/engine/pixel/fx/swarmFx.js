/**
 * The swarms' FX frames (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §6.7): an Ember
 * Imp's fire orb, an Ashwing Whelp's fire spit and the ring of fire an imp's diving burst throws
 * across the ground — painted into the combat FX atlas (../FxSprites.js: the module shape, the pen
 * and the kit) in grey levels that the FxQuads instance colour tints (white-hot cores). Owner: the
 * swarm package. RNG-free: closed-form shapes.
 *
 * - `swarmOrb` 12 × 12 × 4 (14 fps, billboard): a round white-hot core in a swirl of three flame
 *   tongues that turn a quarter round per frame — no travel direction baked in (a billboard does
 *   not know its flight), so it reads from every side.
 * - `swarmSpit` 10 × 10 × 3 (12 fps, billboard): a smaller, lumpier glob with a drip, wobbling.
 * - `swarmBurst` 32 × 32 × 4 (20 fps, flat on the ground): the burst's ring of flame tongues racing
 *   out (radius 5 → 14 px) and breaking up, a scorched core.
 *
 * @import { FxFrameSpec, FxPen, FxKit } from '../FxSprites.js'
 */

/** Frame name → { w, h, n, fps }. @type {Readonly<Record<string, FxFrameSpec>>} */
export const FRAMES = Object.freeze({
  swarmOrb: Object.freeze({ w: 12, h: 12, n: 4, fps: 14 }),
  swarmSpit: Object.freeze({ w: 10, h: 10, n: 3, fps: 12 }),
  swarmBurst: Object.freeze({ w: 32, h: 32, n: 4, fps: 20 }),
});

/**
 * Paint frame `i` of `name`.
 * @param {string} name @param {FxPen} pen @param {number} i @param {FxKit} K
 */
export function paint(name, pen, i, K) {
  if (name === 'swarmOrb') orb(pen, i, K);
  else if (name === 'swarmSpit') spit(pen, i, K);
  else if (name === 'swarmBurst') burst(pen, i, K);
}

/**
 * A fireball: the core, a hot ring, three swirling tongues (`i` turns them a quarter).
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function orb(pen, i, K) {
  const c = 6;
  const turn = (i * Math.PI) / 2 / 3;
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // three tongues swept round (a spiral: the angle shifts with the radius)
      const tongue = Math.max(0, Math.sin(3 * (a - turn) - r * 0.55));
      const edge = 3.3 + 2.2 * tongue * tongue;
      if (r > edge) continue;
      const v = r < 1.8 ? K.W : r < 2.9 ? K.L : r < edge - 0.9 ? K.MID : K.D;
      pen.set(x, y, v);
    }
  }
}

/**
 * A spit glob: an off-centre core, lumpy edge, a drip below that stretches and falls.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function spit(pen, i, K) {
  const cx = 5;
  const cy = 4.6;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy * 1.08);
      const a = Math.atan2(dy, dx);
      const edge = 3.1 + 0.55 * Math.sin(4 * a + i * 2.1) + 0.3 * Math.cos(7 * a - i);
      if (r > edge) continue;
      const hot = Math.hypot(dx + 0.6, dy + 0.6);
      pen.set(x, y, hot < 1.3 ? K.W : hot < 2.3 ? K.L : r < edge - 0.8 ? K.MID : K.D);
    }
  }
  // the drip: one hanging, then stretching, then falling free
  const drip = [[[5, 8]], [[5, 8], [5, 9]], [[4, 9]]][i] ?? [];
  for (const [x, y] of drip) pen.set(x, y, K.MID);
}

/**
 * The ground burst: a ring of flame tongues racing out and breaking up over four frames, a dim
 * scorched core inside it.
 * @param {FxPen} pen @param {number} i @param {FxKit} K
 */
function burst(pen, i, K) {
  const c = 16;
  const R = [5.5, 9, 12, 14.5][i];
  const band = [3.2, 2.8, 2.2, 1.5][i];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // tongues on the outer edge, breaking up as it spreads
      const tongues = 1.1 * Math.max(0, Math.sin(9 * a + i * 0.9)) + 0.6 * Math.max(0, Math.sin(5 * a - i * 1.3));
      const outer = R + tongues * (1.2 + i * 0.35);
      const inner = R - band;
      if (r <= outer && r >= inner) {
        if (i >= 2 && ((x * 7 + y * 3 + i) % 5 === 0)) continue; // the spent ring breaks up
        const t = (r - inner) / Math.max(0.5, outer - inner);
        const v = i === 0 ? (t < 0.6 ? K.W : K.L) : t > 0.75 ? K.D : t > 0.35 ? (i < 2 ? K.L : K.MID) : i < 3 ? K.MID : K.D;
        pen.set(x, y, v);
      } else if (r < inner && i < 2) {
        // the flash inside, fading to embers
        if (i === 0 ? r < inner : (x + y) % 3 === 0 && r < inner - 1) pen.set(x, y, i === 0 ? (r < 2.5 ? K.W : K.L) : K.S);
      }
    }
  }
}
