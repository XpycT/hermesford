/**
 * An arm of Old Gullet, the Thing under the Bay (docs/contracts/EVERMERE_CAMPAIGN.md §6.7): the
 * `tentacle`, an add the head raises through a hole or a crack in the sea ice — ≈ 5 u of
 * violet-navy arm in a 160 × 96 frame, its base at the frame's centre on the bottom row (the
 * waterline: the quad stands in its hole, what the brain sinks below the ice is hidden), the pale
 * underside and its suckers toward its prey, frost along its crest. Painted with the head's skin and
 * arm kit (./gullet.js `armKit`, `gulletRamps`), so the arms and the head read as one creature.
 * Owner: the gullet package.
 *
 * Columns: COMMON (`idle0` / `idle1` and `move0`–`move3` the swaying S-curl — its idle loop —,
 * `windup` reared high and arched back, the tip hooked toward its prey, `attack` the slam: flung
 * out flat along the ice, `hurt` the recoil, `dead` sliding back under) + `rise` (just through the
 * ice), `lie` (after the slam, the tip curling), `sweepWind` (low, swung back) and `sweep` (low,
 * swung across). The side view faces left; the front (`down`) view shows the suckers, the back
 * (`up`) the plain dorsal skin. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */
import { armKit, gulletRamps } from './gullet.js';

/**
 * A pose: the centreline per view (frame px, base first) and which side the underside faces (±1, 0:
 * none — the dorsal skin toward the viewer).
 * @typedef {{ pts: number[][], s: number }} ArmLine
 * @typedef {{ side: ArmLine, down: ArmLine, up?: ArmLine, r0?: number, rime?: boolean }} ArmPose
 */

/** Base of the arm: the frame's centre on the waterline (G = 94). */
const B = [80, 94];

/** @type {Record<string, ArmPose>} */
const POSES = {
  idle0: {
    side: { pts: [B, [79, 84], [83, 72], [85, 60], [81, 49], [73, 41], [66, 39], [62, 43], [65, 47]], s: -1 },
    down: { pts: [B, [81, 82], [77, 70], [78, 58], [84, 49], [85, 41], [80, 37], [75, 40], [76, 45]], s: 1 },
    rime: true,
  },
  idle1: {
    side: { pts: [B, [81, 84], [79, 72], [81, 60], [86, 50], [83, 41], [75, 36], [69, 38], [69, 43]], s: -1 },
    down: { pts: [B, [79, 82], [82, 70], [81, 58], [76, 49], [75, 41], [80, 36], [85, 39], [84, 44]], s: -1 },
    rime: true,
  },
  move0: {
    side: { pts: [B, [78, 84], [82, 72], [86, 61], [83, 50], [76, 42], [69, 40], [65, 44], [68, 48]], s: -1 },
    down: { pts: [B, [82, 83], [78, 71], [76, 59], [81, 50], [86, 43], [83, 37], [77, 38], [77, 43]], s: 1 },
    rime: true,
  },
  move1: {
    side: { pts: [B, [80, 84], [84, 72], [84, 60], [79, 50], [72, 44], [65, 43], [62, 47], [66, 50]], s: -1 },
    down: { pts: [B, [80, 82], [83, 70], [79, 58], [75, 50], [77, 42], [83, 38], [87, 42], [84, 46]], s: -1 },
    rime: true,
  },
  move2: {
    side: { pts: [B, [82, 84], [80, 72], [79, 60], [83, 49], [80, 40], [73, 35], [67, 37], [67, 42]], s: -1 },
    down: { pts: [B, [78, 82], [81, 70], [84, 58], [82, 48], [76, 42], [72, 38], [73, 34], [77, 35]], s: 1 },
    rime: true,
  },
  move3: {
    side: { pts: [B, [81, 84], [81, 72], [83, 60], [86, 50], [82, 40], [75, 36], [70, 39], [71, 44]], s: -1 },
    down: { pts: [B, [81, 82], [79, 70], [80, 58], [85, 50], [88, 42], [85, 36], [80, 36], [79, 41]], s: 1 },
    rime: true,
  },
  // reared high, arched back, the tip hooked forward over its prey
  windup: {
    side: { pts: [B, [82, 83], [88, 70], [94, 56], [97, 42], [93, 28], [85, 19], [75, 16], [67, 20], [64, 27], [68, 31]], s: -1 },
    down: { pts: [B, [80, 82], [79, 66], [80, 50], [83, 35], [83, 23], [78, 15], [71, 15], [68, 21], [71, 26]], s: 1 },
    r0: 11, rime: true,
  },
  // the slam: flung down flat along the ice toward its prey
  attack: {
    side: { pts: [B, [79, 86], [73, 82], [63, 84], [50, 88], [36, 90], [22, 91], [11, 90], [4, 88]], s: 1 },
    down: { pts: [B, [83, 84], [88, 68], [89, 52], [84, 40], [74, 36], [64, 42], [58, 56], [56, 72], [58, 86], [62, 93]], s: 1 },
    up: { pts: [B, [80, 88], [80, 78], [80, 66], [80, 54], [80, 44], [80, 36]], s: 0 },
    r0: 11,
  },
  // lying where it fell, the tip curling back up
  lie: {
    side: { pts: [B, [79, 87], [73, 84], [62, 86], [48, 89], [34, 91], [21, 90], [13, 86], [14, 81]], s: 1 },
    down: { pts: [B, [84, 88], [86, 81], [80, 77], [70, 79], [62, 85], [56, 91], [52, 90]], s: 1 },
    up: { pts: [B, [80, 88], [80, 78], [80, 68], [81, 58], [83, 51], [86, 49]], s: 0 },
    r0: 11,
  },
  hurt: {
    side: { pts: [B, [83, 84], [90, 74], [92, 64], [88, 56], [90, 48], [96, 44], [100, 46]], s: -1 },
    down: { pts: [B, [76, 84], [72, 74], [74, 64], [80, 58], [78, 50], [72, 46], [68, 48]], s: 1 },
  },
  // sliding back under the ice
  dead: {
    side: { pts: [B, [78, 88], [72, 86], [66, 88], [62, 92]], s: 1 },
    down: { pts: [B, [82, 88], [86, 86], [88, 89], [87, 92]], s: 1 },
  },
  // just through the ice
  rise: {
    side: { pts: [B, [80, 87], [82, 80], [80, 74], [76, 72], [74, 76]], s: -1 },
    down: { pts: [B, [80, 87], [78, 80], [80, 74], [84, 72], [85, 76]], s: 1 },
    rime: true,
  },
  // low and swung back, ready to sweep
  sweepWind: {
    side: { pts: [B, [84, 87], [94, 83], [108, 84], [120, 87], [128, 85], [130, 80]], s: -1 },
    down: { pts: [B, [86, 89], [98, 86], [112, 87], [122, 90], [128, 88], [129, 84]], s: 1 },
    r0: 11,
  },
  // low, swung across
  sweep: {
    side: { pts: [B, [76, 87], [66, 83], [52, 83], [40, 86], [30, 90], [23, 88], [21, 84]], s: 1 },
    down: { pts: [B, [74, 89], [62, 86], [48, 87], [38, 90], [32, 88], [31, 84]], s: -1 },
    r0: 11,
  },
};

/** Column names after COMMON. */
const EXTRA = ['rise', 'lie', 'sweepWind', 'sweep'];

/**
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function tentacle(K) {
  const A = armKit(K);

  /**
   * One frame: the arm along its pose's centreline for the view (the back view: the front view's
   * line, the dorsal skin toward the viewer).
   * @param {any} p @param {'down'|'up'|'side'} view @param {string} key
   */
  function draw(p, view, key) {
    const P = POSES[key] ?? POSES.idle0;
    const L = view === 'side' ? P.side : view === 'up' ? (P.up ?? { pts: P.down.pts, s: 0 }) : P.down;
    p.begin(null);
    // (the front view: a narrower pale band, so the arm reads as the dark creature it is)
    A.arm(p, L.pts, { r0: P.r0 ?? 10, r1: 1.4, side: L.s, rime: !!P.rime, seed: key.length * 5 + (view === 'side' ? 1 : 3), under: view === 'side' ? 0.25 : 0.5 });
    p.end();
    A.bounce(p);
  }

  return {
    fw: 160, fh: 96, columns: [...K.COMMON, ...EXTRA], aliases: { rear: 'windup', slam: 'attack', sink: 'dead' },
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.3, 0.6]) },
    idle: { poses: ['move0', 'move1', 'move2', 'move3'], fps: 5 },
    draw(p, view, key) {
      draw(p, view, key);
    },
    ramps: () => gulletRamps(K),
  };
}
