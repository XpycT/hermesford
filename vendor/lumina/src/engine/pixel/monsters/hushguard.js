/**
 * The Hushguard — the valley's old belfry-guard armour, empty and full of frost (The Bells of
 * Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): a great-helmed knight ≈ 2.2 u tall in
 * blued iron (`#505c7a`; its darkest tone `#2c3448` stays above the night's black, so the plates
 * read under Rimeholt's and the court's night — KNOWN_ISSUES EVM-05), a band of rime two texels
 * deep on every upper edge, a faded slate-blue tabard with a tarnished brass
 * bell, a T-slit in the helm through which two cyan eyes glow (glow texels: `uGlow` lights them) —
 * and nothing else inside. Two arms of the same guard: sword and heater shield (the base columns) or
 * a halberd (every column again, prefixed `h_`; the brain shows a Hushguard of that variant through
 * a view of the sheet whose poses and animations point at them). Tin, the companion, wears the same
 * armour. Owner: the foes package.
 *
 * Frame 72 × 60 (the halberd's reach and the sword raised over the helm fit; G = 58). Columns, per
 * variant: COMMON (`idle0`/`idle1` at rest, the eyes breathing; `move0`–`move3` a heavy march;
 * `windup` the weapon raised for the first swing; `attack` the cut; `hurt` the armour blown open,
 * the frost core bare; `dead` an empty heap of plates) and `swing2Wind` / `attack2` (the rising
 * second swing), `heavyWind` / `heavy` (the shield bash; the halberd's sweep), `lungeWind` / `lunge`
 * (the thrust), `guard` and `gmove0` / `gmove1` (the guarded advance: the shield or the haft up),
 * `look` / `lookB` (the helm turned to its left / right while the body stands: the head turned toward
 * Linnet), `reel0` / `reel1` (the core open: a gauntlet at the chest, staggering) and `seal` (the
 * plates closing over the core in rime). The core's glow texels show only in `hurt`, `reel*` and
 * `seal`. Painted like the other monsters (a label buffer, 5-tone ramps, light from the upper left,
 * the plum outline); the side view faces left and shows the shield side (the `right` row mirrors
 * it); the back view mirrors the front rig. RNG-free.
 *
 * @import { MonsterKit, MonsterKind } from '../MonsterSprites.js'
 */

/** @typedef {[number, number]} Pt */

/** Frame size and the ground row. */
const FW = 72;
const FH = 60;

/** The poses of one variant, in column order (the halberd's are the same names prefixed `h_`). */
export const HUSHGUARD_POSES = Object.freeze(['idle0', 'idle1', 'move0', 'move1', 'move2', 'move3', 'windup', 'attack',
  'swing2Wind', 'attack2', 'heavyWind', 'heavy', 'lungeWind', 'lunge', 'guard', 'gmove0', 'gmove1', 'look', 'lookB',
  'hurt', 'reel0', 'reel1', 'seal', 'dead']);
/** The halberd variant's column prefix. */
export const HALBERD_PREFIX = 'h_';

const DEG = Math.PI / 180;
/** Toward the light (the upper left). */
const LX = -0.55;
const LY = -0.8;

/**
 * A pose's rig, front view (the knight faces the viewer: its right hand is on the screen's left).
 * Hands are offsets from their shoulder; feet [dx, lift] from the stance.
 * @typedef {object} FrontPose
 * @property {number} [by]     upper body drop (px)
 * @property {number} [bx]     upper body shift (px)
 * @property {number} [crouch] hip drop (knees bend)
 * @property {number[]} [fR]   right foot [dx, lift]
 * @property {number[]} [fL]   left foot
 * @property {Pt} hR           right hand from the right shoulder
 * @property {Pt} hL           left hand from the left shoulder
 * @property {number} wa       the weapon's angle (deg; 0 = screen right, 90 = up)
 * @property {boolean} [wb]    the weapon (and the right arm) behind the body
 * @property {number} [reach]  halberd: the head's distance from the right hand (px)
 * @property {boolean} [two]   halberd: the left hand on the haft too
 * @property {'side'|'raised'|'bash'|'back'|'low'} [sh] the shield (sword variant)
 * @property {number} [turn]   the helm turned: −1 to the knight's right (screen left), 1 its left
 * @property {number} [hy]     the helm's drop (px)
 * @property {number} [core]   0 closed, 1 open (glowing), 2 sealing (rime over a dim glow)
 * @property {number} [eyes]   eye glow tone (3 default, 4 bright, 1 dim)
 * @property {boolean} [clutch] the left gauntlet on the chest (the core open)
 * @property {number} [wl]     the sword's blade foreshortened (a thrust at the viewer: 0.45)
 */

/**
 * A pose's rig, side view (facing left; the near side is the knight's left: the shield arm; the
 * far arm holds the sword — or the halberd with both hands).
 * @typedef {object} SidePose
 * @property {number} [by] @property {number} [bx] @property {number} [crouch]
 * @property {number} [lean]   the torso's lean forward (px at the shoulders)
 * @property {number[]} [fN]   near foot [dx, lift]
 * @property {number[]} [fF]   far foot
 * @property {Pt} hN           near hand from its shoulder
 * @property {Pt} hF           far hand from its shoulder
 * @property {number} wa       the weapon's angle (deg)
 * @property {boolean} [wb]    the weapon behind the body
 * @property {number} [reach]
 * @property {boolean} [two]
 * @property {'side'|'raised'|'bash'|'back'|'low'} [sh]
 * @property {number} [turn]   1: the helm turned toward the viewer
 * @property {number} [hy] @property {number} [core] @property {number} [eyes] @property {boolean} [clutch]
 */

/** @typedef {{ f: FrontPose, s: SidePose }} PoseRig */

// ---------------------------------------------------------------------------------------------
// The poses (the sword-and-shield arm; the halberd's below)
// ---------------------------------------------------------------------------------------------

/** @type {Record<string, PoseRig>} */
const SWORD = {
  idle0: { f: { hR: [-1, 10], hL: [2, 9], wa: -80, sh: 'side' }, s: { hN: [-2, 9], hF: [-3, 9], wa: -70, wb: true, sh: 'side' } },
  idle1: { f: { by: 1, hR: [-1, 10], hL: [2, 9], wa: -80, sh: 'side', eyes: 4 }, s: { by: 1, hN: [-2, 9], hF: [-3, 9], wa: -70, wb: true, sh: 'side', eyes: 4 } },
  move0: { f: { fR: [0, 2], fL: [0, 0], hR: [-1, 9], hL: [1, 8], wa: -60, sh: 'side' }, s: { fN: [-4, 0], fF: [4, 1], hN: [-3, 8], hF: [2, 9], wa: -40, wb: true, sh: 'side', lean: 1 } },
  move1: { f: { by: -1, fR: [0, 0], fL: [0, 0], hR: [-1, 10], hL: [1, 9], wa: -65, sh: 'side' }, s: { by: -1, fN: [0, 1], fF: [0, 0], hN: [-2, 9], hF: [0, 10], wa: -50, wb: true, sh: 'side', lean: 1 } },
  move2: { f: { fR: [0, 0], fL: [0, 2], hR: [-1, 9], hL: [1, 8], wa: -60, sh: 'side' }, s: { fN: [4, 1], fF: [-4, 0], hN: [-1, 9], hF: [-3, 8], wa: -55, wb: true, sh: 'side', lean: 1 } },
  move3: { f: { by: -1, fR: [0, 0], fL: [0, 0], hR: [-1, 10], hL: [1, 9], wa: -65, sh: 'side' }, s: { by: -1, fN: [0, 0], fF: [0, 1], hN: [-2, 9], hF: [0, 10], wa: -50, wb: true, sh: 'side', lean: 1 } },
  // the first swing: raised over the right shoulder, then cut down across the body
  windup: { f: { by: 1, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [-2, -9], hL: [-2, 4], wa: 120, wb: true, sh: 'raised', eyes: 4 }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [-4, 3], hF: [3, -8], wa: 140, wb: true, sh: 'raised', lean: -1, eyes: 4 } },
  attack: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [7, 9], hL: [1, 6], wa: -40, sh: 'low', eyes: 4 }, s: { by: 2, crouch: 2, fN: [-5, 0], fF: [3, 0], hN: [-1, 7], hF: [-9, 4], wa: -150, sh: 'low', lean: 3, eyes: 4 } },
  // the rising second swing: low on the left, swept up to the right
  swing2Wind: { f: { by: 2, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [9, 8], hL: [2, 5], wa: -20, sh: 'back', eyes: 4 }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [2, 6], hF: [4, 9], wa: -30, wb: true, sh: 'back', lean: 0, eyes: 4 } },
  attack2: { f: { by: 0, fR: [-2, 0], fL: [2, 0], hR: [-6, -5], hL: [1, 6], wa: 140, sh: 'low', eyes: 4 }, s: { by: 0, fN: [-5, 0], fF: [3, 0], hN: [-2, 7], hF: [-8, -6], wa: 160, sh: 'low', lean: 2, eyes: 4 } },
  // the shield bash: drawn back, then driven forward
  heavyWind: { f: { by: 2, crouch: 2, fR: [-1, 0], fL: [2, 0], hR: [-2, 8], hL: [5, 1], wa: -100, sh: 'back', eyes: 4 }, s: { by: 2, crouch: 2, fN: [-3, 0], fF: [4, 0], hN: [4, 2], hF: [1, 8], wa: -80, wb: true, sh: 'back', lean: -1, eyes: 4 } },
  heavy: { f: { by: 2, crouch: 1, fR: [-2, 0], fL: [2, 0], hR: [-2, 9], hL: [-4, 4], wa: -100, sh: 'bash', eyes: 4 }, s: { by: 1, crouch: 1, fN: [-6, 0], fF: [4, 0], hN: [-7, 2], hF: [1, 9], wa: -80, wb: true, sh: 'bash', lean: 3, eyes: 4 } },
  // the thrust: drawn back at the hip, then driven at the foe
  lungeWind: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [0, 8], hL: [0, 4], wa: -90, wb: true, sh: 'raised', eyes: 4 }, s: { by: 2, crouch: 2, fN: [-3, 0], fF: [4, 0], hN: [-3, 3], hF: [6, 6], wa: 180, wb: true, sh: 'raised', lean: -1, eyes: 4 } },
  lunge: { f: { by: 3, crouch: 3, fR: [-3, 0], fL: [2, 0], hR: [5, 7], hL: [1, 5], wa: -62, wl: 0.45, sh: 'low', eyes: 4 }, s: { by: 3, crouch: 3, fN: [-7, 0], fF: [5, 0], hN: [-2, 6], hF: [-10, 3], wa: 180, sh: 'low', lean: 4, eyes: 4 } },
  // the guarded advance: the shield up to the eyes, the sword over its rim
  guard: { f: { by: 1, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [3, 2], hL: [-3, 1], wa: 20, sh: 'raised' }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [-5, 1], hF: [-4, 0], wa: 175, sh: 'raised', lean: 1 } },
  gmove0: { f: { by: 1, crouch: 1, fR: [-1, 2], fL: [1, 0], hR: [3, 2], hL: [-3, 1], wa: 20, sh: 'raised' }, s: { by: 1, crouch: 1, fN: [-4, 0], fF: [3, 1], hN: [-5, 1], hF: [-4, 0], wa: 175, sh: 'raised', lean: 1 } },
  gmove1: { f: { by: 0, crouch: 1, fR: [-1, 0], fL: [1, 2], hR: [3, 2], hL: [-3, 1], wa: 20, sh: 'raised' }, s: { by: 0, crouch: 1, fN: [3, 1], fF: [-3, 0], hN: [-5, 1], hF: [-4, 0], wa: 175, sh: 'raised', lean: 1 } },
  // the helm turned (the body stands): to its left (screen right) / its right
  look: { f: { hR: [-1, 10], hL: [2, 9], wa: -80, sh: 'side', turn: 1, eyes: 4 }, s: { hN: [-2, 9], hF: [-3, 9], wa: -70, wb: true, sh: 'side', turn: 1, eyes: 4 } },
  lookB: { f: { hR: [-1, 10], hL: [2, 9], wa: -80, sh: 'side', turn: -1, eyes: 4 }, s: { hN: [-2, 9], hF: [-3, 9], wa: -70, wb: true, sh: 'side', turn: 1, eyes: 4 } },
  // the armour blown open: the core bare, reeling
  hurt: { f: { by: -1, bx: 1, fR: [-1, 0], fL: [2, 1], hR: [-5, 4], hL: [6, 3], wa: -150, sh: 'back', hy: -1, core: 1, eyes: 1 }, s: { by: -1, fN: [1, 1], fF: [3, 0], hN: [5, 3], hF: [6, 5], wa: -20, wb: true, sh: 'back', lean: -3, hy: -1, core: 1, eyes: 1 } },
  reel0: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [-2, 10], hL: [-6, 3], wa: -95, sh: 'low', hy: 1, core: 1, clutch: true, eyes: 1 }, s: { by: 2, crouch: 2, fN: [-2, 0], fF: [3, 0], hN: [-3, 2], hF: [0, 11], wa: -95, wb: true, sh: 'low', lean: 2, hy: 1, core: 1, clutch: true, eyes: 1 } },
  reel1: { f: { by: 3, crouch: 2, bx: -1, fR: [-1, 0], fL: [2, 1], hR: [-2, 11], hL: [-6, 4], wa: -100, sh: 'low', hy: 2, core: 1, clutch: true, eyes: 1 }, s: { by: 3, crouch: 2, fN: [-1, 1], fF: [3, 0], hN: [-3, 3], hF: [0, 12], wa: -100, wb: true, sh: 'low', lean: 3, hy: 2, core: 1, clutch: true, eyes: 1 } },
  seal: { f: { by: -1, fR: [-1, 0], fL: [1, 0], hR: [-6, 1], hL: [6, 1], wa: -130, sh: 'side', core: 2, eyes: 4 }, s: { by: -1, fN: [-1, 0], fF: [2, 0], hN: [3, 1], hF: [-4, 1], wa: -60, wb: true, sh: 'side', lean: -2, core: 2, eyes: 4 } },
  dead: { f: { hR: [0, 0], hL: [0, 0], wa: 0 }, s: { hN: [0, 0], hF: [0, 0], wa: 0 } },
};

/** The halberd's poses: the same names, the haft two-handed. @type {Record<string, PoseRig>} */
const HALBERD = {
  idle0: { f: { hR: [-2, 6], hL: [2, 9], wa: 92, reach: 24 }, s: { hN: [-2, 9], hF: [-4, 5], wa: 95, reach: 24, wb: true } },
  idle1: { f: { by: 1, hR: [-2, 6], hL: [2, 9], wa: 92, reach: 24, eyes: 4 }, s: { by: 1, hN: [-2, 9], hF: [-4, 5], wa: 95, reach: 24, wb: true, eyes: 4 } },
  move0: { f: { fR: [0, 2], hR: [-1, 6], hL: [-3, 4], wa: 62, reach: 20, two: true }, s: { fN: [-4, 0], fF: [4, 1], hN: [-3, 5], hF: [-1, 4], wa: 120, reach: 20, two: true, lean: 1 } },
  move1: { f: { by: -1, hR: [-1, 7], hL: [-3, 5], wa: 64, reach: 20, two: true }, s: { by: -1, fN: [0, 1], hN: [-3, 6], hF: [-1, 5], wa: 120, reach: 20, two: true, lean: 1 } },
  move2: { f: { fL: [0, 2], hR: [-1, 6], hL: [-3, 4], wa: 62, reach: 20, two: true }, s: { fN: [4, 1], fF: [-4, 0], hN: [-3, 5], hF: [-1, 4], wa: 120, reach: 20, two: true, lean: 1 } },
  move3: { f: { by: -1, hR: [-1, 7], hL: [-3, 5], wa: 64, reach: 20, two: true }, s: { by: -1, fF: [0, 1], hN: [-3, 6], hF: [-1, 5], wa: 120, reach: 20, two: true, lean: 1 } },
  windup: { f: { by: 1, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [-1, -7], hL: [-7, -2], wa: 138, reach: 19, two: true, wb: true, eyes: 4 }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [1, -6], hF: [4, -5], wa: 30, reach: 24, two: true, wb: true, lean: -1, eyes: 4 } },
  attack: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [5, 8], hL: [-2, 7], wa: -30, reach: 22, two: true, eyes: 4 }, s: { by: 2, crouch: 2, fN: [-5, 0], fF: [3, 0], hN: [-6, 6], hF: [-3, 5], wa: -160, reach: 24, two: true, lean: 3, eyes: 4 } },
  swing2Wind: { f: { by: 2, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [8, 9], hL: [1, 8], wa: -15, reach: 22, two: true, eyes: 4 }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [2, 7], hF: [4, 8], wa: -20, reach: 22, two: true, wb: true, eyes: 4 } },
  attack2: { f: { fR: [-2, 0], fL: [2, 0], hR: [-4, -3], hL: [-1, 2], wa: 122, reach: 19, two: true, eyes: 4 }, s: { fN: [-5, 0], fF: [3, 0], hN: [-5, -2], hF: [-2, 1], wa: 155, reach: 24, two: true, lean: 2, eyes: 4 } },
  // the sweep: the haft drawn far back to the right, then swept across
  heavyWind: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [-4, 5], hL: [-9, 6], wa: 168, reach: 16, two: true, wb: true, eyes: 4 }, s: { by: 2, crouch: 2, fN: [-3, 0], fF: [4, 0], hN: [3, 6], hF: [6, 5], wa: 12, reach: 18, two: true, wb: true, lean: -2, eyes: 4 } },
  heavy: { f: { by: 3, crouch: 3, fR: [-3, 0], fL: [3, 0], hR: [8, 6], hL: [2, 6], wa: -8, reach: 26, two: true, eyes: 4 }, s: { by: 3, crouch: 3, fN: [-6, 0], fF: [4, 0], hN: [-7, 5], hF: [-4, 5], wa: 185, reach: 26, two: true, lean: 3, eyes: 4 } },
  lungeWind: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [1, 8], hL: [4, 5], wa: -75, reach: 18, two: true, wb: true, eyes: 4 }, s: { by: 2, crouch: 2, fN: [-3, 0], fF: [4, 0], hN: [3, 6], hF: [6, 6], wa: 178, reach: 18, two: true, lean: -2, eyes: 4 } },
  lunge: { f: { by: 3, crouch: 3, fR: [-3, 0], fL: [2, 0], hR: [3, 6], hL: [-2, 6], wa: -100, reach: 14, two: true, eyes: 4 }, s: { by: 3, crouch: 3, fN: [-7, 0], fF: [5, 0], hN: [-8, 5], hF: [-4, 5], wa: 180, reach: 20, two: true, lean: 4, eyes: 4 } },
  guard: { f: { by: 1, crouch: 1, fR: [-1, 0], fL: [1, 0], hR: [3, 3], hL: [-3, 3], wa: 15, reach: 18, two: true }, s: { by: 1, crouch: 1, fN: [-3, 0], fF: [3, 0], hN: [-4, 3], hF: [-1, 2], wa: 150, reach: 18, two: true, lean: 1 } },
  gmove0: { f: { by: 1, crouch: 1, fR: [-1, 2], fL: [1, 0], hR: [3, 3], hL: [-3, 3], wa: 15, reach: 18, two: true }, s: { by: 1, crouch: 1, fN: [-4, 0], fF: [3, 1], hN: [-4, 3], hF: [-1, 2], wa: 150, reach: 18, two: true, lean: 1 } },
  gmove1: { f: { crouch: 1, fR: [-1, 0], fL: [1, 2], hR: [3, 3], hL: [-3, 3], wa: 15, reach: 18, two: true }, s: { crouch: 1, fN: [3, 1], fF: [-3, 0], hN: [-4, 3], hF: [-1, 2], wa: 150, reach: 18, two: true, lean: 1 } },
  look: { f: { hR: [-2, 6], hL: [2, 9], wa: 92, reach: 24, turn: 1, eyes: 4 }, s: { hN: [-2, 9], hF: [-4, 5], wa: 95, reach: 24, wb: true, turn: 1, eyes: 4 } },
  lookB: { f: { hR: [-2, 6], hL: [2, 9], wa: 92, reach: 24, turn: -1, eyes: 4 }, s: { hN: [-2, 9], hF: [-4, 5], wa: 95, reach: 24, wb: true, turn: 1, eyes: 4 } },
  hurt: { f: { by: -1, bx: 1, fR: [-1, 0], fL: [2, 1], hR: [-6, 3], hL: [6, 3], wa: 160, reach: 14, hy: -1, core: 1, eyes: 1 }, s: { by: -1, fN: [1, 1], fF: [3, 0], hN: [5, 3], hF: [7, 2], wa: 60, reach: 18, wb: true, lean: -3, hy: -1, core: 1, eyes: 1 } },
  reel0: { f: { by: 2, crouch: 2, fR: [-2, 0], fL: [2, 0], hR: [-3, 6], hL: [-6, 3], wa: 100, reach: 22, hy: 1, core: 1, clutch: true, eyes: 1 }, s: { by: 2, crouch: 2, fN: [-2, 0], fF: [3, 0], hN: [-3, 2], hF: [-2, 6], wa: 100, reach: 22, wb: true, lean: 2, hy: 1, core: 1, clutch: true, eyes: 1 } },
  reel1: { f: { by: 3, crouch: 2, bx: -1, fR: [-1, 0], fL: [2, 1], hR: [-3, 7], hL: [-6, 4], wa: 104, reach: 22, hy: 2, core: 1, clutch: true, eyes: 1 }, s: { by: 3, crouch: 2, fN: [-1, 1], fF: [3, 0], hN: [-3, 3], hF: [-2, 7], wa: 104, reach: 22, wb: true, lean: 3, hy: 2, core: 1, clutch: true, eyes: 1 } },
  seal: { f: { by: -1, fR: [-1, 0], fL: [1, 0], hR: [-5, 2], hL: [6, 1], wa: 95, reach: 24, core: 2, eyes: 4 }, s: { by: -1, fN: [-1, 0], fF: [2, 0], hN: [3, 1], hF: [-4, 2], wa: 95, reach: 24, wb: true, lean: -2, core: 2, eyes: 4 } },
  dead: { f: { hR: [0, 0], hL: [0, 0], wa: 0 }, s: { hN: [0, 0], hF: [0, 0], wa: 0 } },
};

/**
 * The Hushguard's sheet recipe.
 * @param {MonsterKit} K
 * @returns {MonsterKind}
 */
export function hushguard(K) {
  const { M } = K;
  // materials (ids of the label buffer; colours in `ramps`)
  const IRON = M.METAL;
  const DARK = M.HAT;      // the darker plates: the helm's shadowed half, lames, the gorget
  const RIME = M.WHITE;
  const VOID = M.SKIN;     // the dark inside the helm and the open breastplate
  const CLOTH = M.TOP;
  const BRASS = M.GOLD;
  const STRAP = M.LEATHER;
  const HAFT = M.WOOD;
  const FIELD = M.ACCENT;  // the shield's painted field
  const EDGE = M.STONE;    // a blade's honed, rimed edge
  const GLOW = M.GLOW;

  // ---------------------------------------------------------------------------------------------
  // Shape helpers
  // ---------------------------------------------------------------------------------------------

  /**
   * A tapered capsule a → b shaded as a cylinder lit from the upper left; `shine` (0–1) turns the
   * lit rim to tone 4.
   * @param {any} p @param {number[]} a @param {number} ar @param {number[]} b @param {number} br
   * @param {number} mat @param {{ lift?: number, shine?: number, max?: number }} [o]
   */
  function capsule(p, a, ar, b, br, mat, o = {}) {
    const { lift = 0, shine = 0.55, max = 4 } = o;
    const [ax, ay] = a;
    const [bx, by] = b;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy || 1e-9;
    const R = Math.max(ar, br);
    for (let y = Math.floor(Math.min(ay, by) - R - 1); y <= Math.ceil(Math.max(ay, by) + R + 1); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - R - 1); x <= Math.ceil(Math.max(ax, bx) + R + 1); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const r = ar + (br - ar) * t;
        const dx = px - (ax + vx * t);
        const dy = py - (ay + vy * t);
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const l = (dx * LX + dy * LY) / Math.max(0.5, r);
        let s = l > 0.42 ? 3 : l > -0.22 ? 2 : l > -0.72 ? 1 : 0;
        if (shine && l > shine && d2 > r * r * 0.25) s = 4;
        p.set(x, y, mat, Math.max(0, Math.min(max, s + lift)));
      }
    }
  }

  /** A shaded ellipse. @param {any} p @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} mat @param {object} [o] */
  function body(p, cx, cy, rx, ry, mat, o = {}) {
    K.blob(p, cx, cy, rx, ry, mat, { hi: 0.4, lo: -0.25, deep: -0.75, maxShade: 4, ...o });
  }

  /** A point `s` along a direction (deg) from `o`, and `u` across it. */
  function along(o, ang, s, u = 0) {
    const dx = Math.cos(ang * DEG);
    const dy = -Math.sin(ang * DEG);
    return [o[0] + dx * s - dy * u, o[1] + dy * s + dx * u];
  }

  /**
   * Rime on the upper edges: every iron or dark-plate texel with nothing above it turns frost-white
   * (the snow of seven winters on the shoulders, the helm, the arms), the lit ones brightest, and the
   * plate texel under it pale frost — a band two texels deep (`#e2fbff` over `#b4c4dc`), so the
   * armour keeps a light value step at night (review EV-46).
   * @param {any} p
   */
  function rime(p) {
    // (only runs of two or more along an upper edge: the flat tops hold snow, the corners of
    // small parts stay iron — single frosted pixels read as noise; the helm's crown under its ice
    // crest counts as open to the sky)
    const hits = [];
    for (let y = 1; y < FH; y++) {
      let run = [];
      for (let x = 0; x <= FW; x++) {
        const m = x < FW ? p.get(x, y) : 0;
        const up = p.get(x, y - 1);
        const ok = (m === IRON || m === DARK || m === FIELD) && (up === 0 || up === EDGE);
        if (ok) run.push([x, y, p.getShade(x, y)]);
        else {
          if (run.length >= 2) hits.push(...run);
          run = [];
        }
      }
    }
    for (const [x, y, s] of hits) {
      p.set(x, y, RIME, s >= 3 ? 4 : 3);
      const m = p.get(x, y + 1);
      if (m === IRON || m === DARK || m === FIELD) p.set(x, y + 1, RIME, s >= 2 ? 2 : 1);
    }
  }

  /**
   * Icicles hanging from a plate's lower edge: short drips of rime, the middle one longest.
   * @param {any} p @param {number} x0 @param {number} y @param {number} n @param {number} gap
   */
  function icicles(p, x0, y, n, gap) {
    p.begin(null);
    for (let i = 0; i < n; i++) {
      const x = Math.round(x0 + i * gap);
      const len = i === Math.floor(n / 2) ? 2 : 1;
      for (let k = 0; k < len; k++) if (!p.get(x, y + k)) p.set(x, y + k, RIME, 3 - k);
    }
    p.end();
  }

  /**
   * The crest of ice on the helm's crown: three short spikes of clear ice (two in profile).
   * @param {any} p @param {number} cx @param {number} top the crown's row @param {boolean} side
   */
  function iceCrest(p, cx, top, side) {
    p.begin('all', 0);
    const spikes = side ? [[-1.5, 1], [1.5, 2]] : [[-2.5, 1], [0, 2], [2.5, 1]];
    for (const [dx, h] of spikes) {
      const x = Math.round(cx - 0.5 + dx);
      for (let k = 1; k <= h; k++) p.set(x, top - k, EDGE, k === h ? 3 : dx <= 0 ? 2 : 1);
    }
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // Parts
  // ---------------------------------------------------------------------------------------------

  /**
   * A greaved leg: thigh (cuisse), knee cop, shin (greave), sabaton.
   * @param {any} p @param {number[]} hip @param {number[]} foot @param {number} bend knee forward (px; side view)
   * @param {number} lift tone shift (−1 the far leg)
   * @param {number} dir the toes' direction (−1 left, 1 right, 0 toward the viewer)
   */
  function leg(p, hip, foot, bend, lift, dir) {
    const knee = [(hip[0] + foot[0]) / 2 + bend, hip[1] + (foot[1] - hip[1]) * 0.48];
    const ankle = [foot[0], foot[1] - 2];
    p.begin('all', 1);
    capsule(p, hip, 2.9, knee, 2.4, IRON, { lift });
    p.end();
    p.begin('all', 1);
    capsule(p, knee, 2.3, ankle, 1.9, IRON, { lift });
    p.end();
    // the knee cop: a bright boss, a dark lame under it
    p.begin(null);
    p.set(Math.round(knee[0] - 0.5), Math.round(knee[1] - 0.5), IRON, Math.min(4, 4 + lift));
    p.set(Math.round(knee[0] + 0.5), Math.round(knee[1] - 0.5), IRON, Math.min(4, 3 + lift));
    p.set(Math.round(knee[0] - 1), Math.round(knee[1] + 1), DARK, 0);
    p.set(Math.round(knee[0]), Math.round(knee[1] + 1), DARK, 0);
    p.set(Math.round(knee[0] + 1), Math.round(knee[1] + 1), DARK, 0);
    p.end();
    // the sabaton: a pointed shoe of lames
    p.begin('all', 0);
    if (dir === 0) body(p, foot[0], foot[1] - 1, 2.4, 1.6, IRON, { lift });
    else {
      body(p, foot[0] + dir * 1.2, foot[1] - 1, 3.2, 1.5, IRON);
      p.set(Math.round(foot[0] + dir * 4), Math.round(foot[1]), IRON, 2 + lift);
    }
    p.end();
  }

  /**
   * An armoured arm: pauldron, upper arm (rerebrace), couter, vambrace, gauntlet.
   * @param {any} p @param {number[]} sh shoulder @param {number[]} hand @param {number} out the elbow's push
   *   (±px across the arm, toward the outside) @param {number} lift @param {boolean} [paul] draw the pauldron
   */
  function arm(p, sh, hand, out, lift, paul = true) {
    const mx = (sh[0] + hand[0]) / 2;
    const my = (sh[1] + hand[1]) / 2;
    const vx = hand[0] - sh[0];
    const vy = hand[1] - sh[1];
    const l = Math.hypot(vx, vy) || 1;
    const elbow = [mx - (vy / l) * out, my + (vx / l) * out];
    p.begin('all', 0);
    capsule(p, sh, 2.2, elbow, 1.9, IRON, { lift });
    capsule(p, elbow, 1.9, hand, 1.6, IRON, { lift });
    p.end();
    p.begin(null);
    p.set(Math.round(elbow[0]), Math.round(elbow[1]), IRON, Math.min(4, 4 + lift)); // the couter's boss
    p.end();
    // the gauntlet
    p.begin('all', 0);
    body(p, hand[0], hand[1], 1.8, 1.7, DARK, { lift });
    p.end();
    if (paul) pauldron(p, sh, lift);
  }

  /** A pauldron: a domed shoulder plate and two lames below it. @param {any} p @param {number[]} sh @param {number} lift */
  function pauldron(p, sh, lift) {
    p.begin('all', 0);
    body(p, sh[0], sh[1] - 0.5, 3.6, 2.9, IRON, { lift, hi: 0.3 });
    p.end();
    p.begin(null);
    for (let k = -2; k <= 2; k++) p.over(Math.round(sh[0] + k), Math.round(sh[1] + 2), DARK, 1 + (k < 0 ? 1 : 0));
    p.end();
    icicles(p, sh[0] - 2, Math.round(sh[1] + 3), 2, 4);
  }

  /**
   * The breastplate (front / back): an egg of plate with a central ridge, two lames below; the core
   * — open: a black rent with the frost heart glowing in it, cracks running out; sealing: the rent
   * filmed over with rime, the heart dim.
   * @param {any} p @param {number[]} c @param {boolean} back @param {number} core
   */
  function cuirass(p, c, back, core) {
    const [cx, cy] = c;
    p.begin('all', 0);
    body(p, cx, cy, 6.8, 6.2, IRON, { hi: 0.35, lo: -0.3 });
    p.end();
    p.begin(null);
    // the ridge (front) / the backplate's spine
    for (let y = Math.round(cy - 4); y <= Math.round(cy + 3); y++) {
      p.over(Math.round(cx - 1), y, IRON, back ? 2 : 4);
      p.over(Math.round(cx), y, IRON, back ? 1 : 3);
    }
    // the lames of the fauld
    for (let x = Math.round(cx - 6); x <= Math.round(cx + 6); x++) {
      p.over(x, Math.round(cy + 4), DARK, 0);
      p.over(x, Math.round(cy + 6), DARK, 0);
    }
    // rivets
    for (const k of [-5, 5]) p.over(Math.round(cx + k), Math.round(cy - 3), IRON, 4);
    p.end();
    if (back || !core) return;
    // the core: a rent in the plate, the frost heart inside
    p.begin(null);
    const rent = [[0, -4], [-2, -2], [-3, 0], [-2, 2], [0, 3], [2, 2], [3, 0], [2, -2]];
    K.fillPoly(p, rent.map(([x, y]) => [cx - 0.5 + x, cy + 0.5 + y]), VOID, 0);
    if (core === 1) {
      // the heart: a cyan crystal, brightest in the middle; cracks of light through the plate
      const heart = [[0, -2, 3], [-1, -1, 3], [0, -1, 4], [1, -1, 3], [-1, 0, 4], [0, 0, 4], [1, 0, 4], [-1, 1, 3], [0, 1, 4], [1, 1, 3], [0, 2, 3]];
      for (const [x, y, s] of heart) p.set(Math.round(cx - 0.5 + x), Math.round(cy + 0.5 + y), GLOW, s);
      for (const [x, y] of [[-4, -4], [-5, -5], [4, -3], [5, -4], [6, -5], [-4, 3], [-5, 4], [4, 4], [3, 5]]) p.over(Math.round(cx + x), Math.round(cy + y), GLOW, 2);
    } else {
      for (const [x, y] of [[0, -1], [0, 0], [0, 1]]) p.set(Math.round(cx - 0.5 + x), Math.round(cy + 0.5 + y), GLOW, 1);
      for (const [x, y] of [[-2, -2], [-1, -3], [1, -3], [2, -2], [-3, 0], [3, 0], [-2, 2], [2, 2], [0, 3], [-1, 2], [1, 2]]) p.set(Math.round(cx - 0.5 + x), Math.round(cy + 0.5 + y), RIME, 3);
    }
    p.end();
  }

  /**
   * The great helm (front / back): a barrel of plate with a flat crown and a crest ridge; in front
   * the T of the sights — a dark slit with the two cyan eyes in it — and the breaths below. `turn`
   * slides the face to one side (the head turned: ±1).
   * @param {any} p @param {number[]} c @param {boolean} back @param {number} turn @param {number} eyes
   */
  function helm(p, c, back, turn, eyes) {
    const [cx, cy] = c;
    p.begin('all', 0);
    K.fillPoly(p, [[cx - 4.6, cy - 3.8], [cx - 3.6, cy - 5], [cx + 3.6, cy - 5], [cx + 4.6, cy - 3.8], [cx + 4.8, cy + 3], [cx + 3.8, cy + 4.6], [cx - 3.8, cy + 4.6], [cx - 4.8, cy + 3]], IRON, (x, y) => {
      const u = (x + 0.5 - cx) / 4.8 - turn * 0.25;
      return u < -0.55 ? 3 : u < -0.1 ? 3 : u < 0.45 ? 2 : u < 0.8 ? 1 : 0;
    });
    p.end();
    p.begin(null);
    // the crown's ridge and the brow band
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 4); x++) p.over(x, Math.round(cy - 5), IRON, x < cx ? 4 : 2);
    const fx = Math.round(cx - 0.5 + turn * 1.6);
    for (let y = Math.round(cy - 5); y <= Math.round(cy + 4); y++) p.over(fx, y, IRON, back ? 2 : 4);
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 4); x++) p.over(x, Math.round(cy + 4), DARK, 0);
    if (!back) {
      // the sights: a dark slit across, the eyes glowing in it; the breaths below
      const y = Math.round(cy - 1);
      const x0 = Math.round(cx - 3.5 + turn * 1.6);
      const x1 = Math.round(cx + 3.5 + turn * 1.6);
      for (let x = Math.max(x0, Math.round(cx - 4.2)); x <= Math.min(x1, Math.round(cx + 4.2)); x++) p.set(x, y, VOID, 0);
      const e = eyes ?? 3;
      for (const ex of [fx - 2, fx + 2]) {
        if (Math.abs(ex - cx) > 4.2) continue;
        p.set(ex, y, GLOW, e);
        if (e >= 4) p.set(ex + (ex < fx ? -1 : 1), y, GLOW, 2);
      }
      for (let yy = y + 1; yy <= Math.round(cy + 2); yy++) p.set(fx, yy, VOID, 0);
    } else {
      // the back: a seam down the middle, a strap ring
      p.over(Math.round(cx - 0.5), Math.round(cy + 2), STRAP, 2);
    }
    p.end();
    iceCrest(p, cx, Math.round(cy - 5), false);
    icicles(p, cx - 3, Math.round(cy + 5), 3, 3);
  }

  /**
   * The great helm in profile (facing left); `turn` 1: turned toward the viewer (the sights show).
   * @param {any} p @param {number[]} c @param {number} turn @param {number} eyes
   */
  function helmSide(p, c, turn, eyes) {
    const [cx, cy] = c;
    p.begin('all', 0);
    K.fillPoly(p, [[cx - 4.4, cy - 3.8], [cx - 3.4, cy - 5], [cx + 3.2, cy - 5], [cx + 4.2, cy - 3.6], [cx + 4.4, cy + 3.4], [cx + 3.4, cy + 4.6], [cx - 3.8, cy + 4.6], [cx - 4.8, cy + 2.5], [cx - 4.8, cy - 1]], IRON, (x) => {
      const u = (x + 0.5 - cx) / 4.6;
      return u < -0.5 ? 3 : u < 0.2 ? 2 : u < 0.7 ? 1 : 0;
    });
    p.end();
    p.begin(null);
    for (let x = Math.round(cx - 3); x <= Math.round(cx + 3); x++) p.over(x, Math.round(cy - 5), IRON, x < cx ? 4 : 2);
    for (let x = Math.round(cx - 4); x <= Math.round(cx + 4); x++) p.over(x, Math.round(cy + 4), DARK, 0);
    const y = Math.round(cy - 1);
    const e = eyes ?? 3;
    if (turn > 0) {
      // three-quarter: the T on the front half, both eyes
      for (let x = Math.round(cx - 4.4); x <= Math.round(cx + 1); x++) p.set(x, y, VOID, 0);
      p.set(Math.round(cx - 3), y, GLOW, e);
      p.set(Math.round(cx), y, GLOW, Math.max(1, e - 1));
      for (let yy = y + 1; yy <= Math.round(cy + 2); yy++) p.set(Math.round(cx - 1.5), yy, VOID, 0);
    } else {
      // profile: the slit at the front, one eye, breaths on the cheek
      for (let x = Math.round(cx - 4.6); x <= Math.round(cx - 1); x++) p.set(x, y, VOID, 0);
      p.set(Math.round(cx - 3), y, GLOW, e);
      if (e >= 4) p.set(Math.round(cx - 4), y, GLOW, 2);
      for (const [dx, dy] of [[-3, 2], [-2, 3], [-4, 3]]) p.set(Math.round(cx + dx), Math.round(cy + dy), VOID, 0);
      // a hinge rivet
      p.set(Math.round(cx + 1), Math.round(cy), IRON, 4);
    }
    p.end();
    iceCrest(p, cx, Math.round(cy - 5), true);
  }

  /**
   * The tattered tabard skirt hanging from the waist: slate-blue cloth, a brass hem, ragged edge.
   * @param {any} p @param {number} cx @param {number} y0 @param {number} w half width
   * @param {number} len @param {number} sway px at the hem
   */
  function skirt(p, cx, y0, w, len, sway) {
    p.begin('all', 0);
    for (let y = y0; y <= y0 + len; y++) {
      const t = (y - y0) / len;
      const off = sway * t;
      const hw = w - t * 0.8;
      for (let x = Math.round(cx - hw + off); x <= Math.round(cx + hw + off); x++) {
        // the ragged hem: a few threads shorter
        if (y >= y0 + len - 1 && ((x * 7 + 3) % 5 === 0)) continue;
        const u = (x + 0.5 - cx - off) / (hw + 0.5);
        p.set(x, y, CLOTH, u < -0.4 ? 3 : u < 0.4 ? 2 : 1);
      }
    }
    p.end();
    p.begin(null);
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) p.over(x, y0, BRASS, x < cx ? 3 : 2);
    p.end();
  }

  /**
   * A longsword from the hand along `ang`: the pommel and the leather grip behind the fist, a brass
   * cross, a dark blade with a rimed edge.
   * @param {any} p @param {number[]} hand @param {number} ang @param {number} lift @param {number} [wl]
   */
  function sword(p, hand, ang, lift, wl = 1) {
    // (`wl` < 1: the blade foreshortened — a thrust at the viewer)
    const at = (s, u = 0) => along(hand, ang, s < 2.5 ? s : 2.5 + (s - 2.5) * wl, u);
    p.begin('all', 0);
    K.thickLine(p, ...at(-3), ...at(1.5), 1.6, STRAP, 2 + lift);
    p.set(Math.round(at(-4)[0]), Math.round(at(-4)[1]), BRASS, 3 + lift);
    p.end();
    p.begin('all', 0);
    K.thickLine(p, ...at(2, -3), ...at(2, 3), 1.4, BRASS, 2 + lift);
    p.end();
    p.begin('all', 0);
    K.fillPoly(p, [at(2.5, -1.2), at(15, -1), at(17.5, 0), at(15, 1), at(2.5, 1.2)], IRON, (x, y) => {
      const px = x + 0.5 - hand[0];
      const py = y + 0.5 - hand[1];
      const dx = Math.cos(ang * DEG);
      const dy = -Math.sin(ang * DEG);
      const u = -px * dy + py * dx;
      return Math.max(0, Math.min(4, (u < -0.3 ? 3 : 1) + lift));
    });
    p.end();
    // the fuller (dark) and the rimed edge
    p.begin(null);
    for (let s = 4; s <= 13; s++) { const [x, y] = at(s, 0); p.over(Math.round(x), Math.round(y), DARK, 1); }
    for (let s = 3; s <= 16; s++) { const [x, y] = at(s, -1); p.over(Math.round(x), Math.round(y), EDGE, s % 3 ? 3 : 4); }
    if (wl < 1) { const [x, y] = at(17.5, 0); p.set(Math.round(x), Math.round(y), EDGE, 4); }
    p.end();
  }

  /**
   * The halberd from the right hand along `ang`: a dark haft, the head `reach` px ahead — an axe
   * blade (to the left of the direction), a top spike, a back hook, langets; rime on the blade.
   * @param {any} p @param {number[]} hand @param {number} ang @param {number} reach @param {number} lift
   */
  function halberd(p, hand, ang, reach, lift) {
    const at = (s, u = 0) => along(hand, ang, s, u);
    const butt = reach - 40;
    p.begin('all', 0);
    K.thickLine(p, ...at(butt), ...at(reach + 1), 1.5, HAFT, (t) => Math.max(0, Math.min(4, (t > 0.6 ? 3 : 2) + lift)));
    p.end();
    p.begin(null);
    p.set(Math.round(at(butt)[0]), Math.round(at(butt)[1]), IRON, 2 + lift); // the ferrule
    p.end();
    // the axe blade: a broad crescent on one side of the haft
    p.begin('all', 0);
    K.fillPoly(p, [at(reach - 5, -0.5), at(reach - 6.5, -4), at(reach - 4, -6.5), at(reach + 1.5, -6.2), at(reach + 2.5, -4), at(reach + 1, -0.5)], IRON, (x, y) => {
      const px = x + 0.5 - hand[0];
      const py = y + 0.5 - hand[1];
      const dx = Math.cos(ang * DEG);
      const dy = -Math.sin(ang * DEG);
      const u = px * -dy + py * dx;
      return Math.max(0, Math.min(4, (u < -4.8 ? 3 : u < -2.5 ? 2 : 1) + lift));
    });
    p.end();
    // the top spike and the back hook
    p.begin('all', 0);
    K.thickLine(p, ...at(reach + 1), ...at(reach + 7), 1.2, IRON, 3 + lift);
    K.thickLine(p, ...at(reach - 3, 0.6), ...at(reach - 2, 3.2), 1.1, IRON, 1 + lift);
    p.end();
    p.begin(null);
    // the blade's rimed edge and the langets' rivets
    for (let s = reach - 5; s <= reach + 2; s++) { const [x, y] = at(s, -5.9); p.over(Math.round(x), Math.round(y), EDGE, 4); }
    for (const s of [reach - 7, reach - 9]) { const [x, y] = at(s, 0); p.over(Math.round(x), Math.round(y), IRON, 3 + lift); }
    p.end();
  }

  /**
   * The heater shield (front: its face; `back`: its strapped back).
   * @param {any} p @param {number[]} c its centre @param {number} sc size (1 normal, 1.25 thrust at the viewer)
   * @param {boolean} back @param {number} lift @param {number} [sx] its width (0.6: turned three-quarters)
   */
  function shield(p, c, sc, back, lift, sx = 1) {
    const [cx, cy] = c;
    const w = 5.6 * sc * sx;
    const h = 7.4 * sc;
    const pts = [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy - h * 0.15], [cx + w * 0.55, cy + h * 0.6], [cx, cy + h], [cx - w * 0.55, cy + h * 0.6], [cx - w, cy - h * 0.15]];
    p.begin('all', 0);
    K.fillPoly(p, pts, back ? IRON : FIELD, (x, y) => {
      const u = (x + 0.5 - cx) / w;
      const v = (y + 0.5 - cy) / h;
      const l = -u * 0.6 - v * 0.5;
      return Math.max(0, Math.min(4, (l > 0.35 ? 3 : l > -0.25 ? 2 : 1) + lift));
    });
    p.end();
    p.begin(null);
    // the iron rim
    for (let y = Math.floor(cy - h); y <= Math.ceil(cy + h); y++) {
      for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
        const m = p.get(x, y);
        if (m !== FIELD && m !== IRON) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = p.get(x + dx, y + dy); return n !== FIELD && n !== IRON && n !== BRASS; });
        if (edge) p.set(x, y, back ? DARK : IRON, x < cx ? 3 + lift : 1 + lift);
      }
    }
    if (back) {
      // the enarmes: two leather straps across
      for (let x = Math.round(cx - w + 2); x <= Math.round(cx + w - 2); x++) {
        p.over(x, Math.round(cy - h * 0.3), STRAP, 2);
        p.over(x, Math.round(cy + h * 0.25), STRAP, 1);
      }
    } else {
      // the bell, in tarnished brass: a crown loop, the waist, the flared lip and the clapper
      const b = (x, y, s) => p.over(Math.round(cx + x * sc * sx), Math.round(cy + y * sc), BRASS, Math.max(0, Math.min(4, s + lift)));
      b(0, -4.5, 3);
      for (const [x, y] of [[-1, -3.5], [0, -3.5], [1, -3.5], [-1.5, -2.5], [1.5, -2.5], [-2, -1], [2, -1], [-2, 0], [2, 0], [-3, 1.5], [3, 1.5]]) b(x, y, x < 0 ? 3 : 2);
      for (let x = -3; x <= 3; x++) b(x, 2, x < 0 ? 4 : 2);
      for (const [x, y] of [[-1, -2.5], [0, -2.5], [1, -2.5], [-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1]]) b(x, y, 2);
      b(0, 3, 3);
    }
    p.end();
  }

  // ---------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------

  /** The neutral joints of the front view. */
  const CX = 36;
  const G = FH - 2;

  /**
   * The front (`back` false) or back view of a pose. The back view mirrors the rig: the knight's
   * right hand is then on the screen's right.
   * @param {any} p @param {FrontPose} P @param {boolean} hal @param {boolean} back
   */
  function drawFront(p, P, hal, back) {
    const m = back ? -1 : 1;
    const X = (x) => CX + (x - CX) * m;
    const by = P.by ?? 0;
    const bx = (P.bx ?? 0) * m;
    const cr = P.crouch ?? 0;
    const hip = [CX + bx * 0.5, 45 + cr];
    const chest = [CX + bx, 37 + by];
    const shR = [X(28.5) + bx, 34 + by];
    const shL = [X(43.5) + bx, 34 + by];
    const head = [CX + bx + (P.turn ?? 0) * 0.5 * m, 27 + by + (P.hy ?? 0)];
    const fR = P.fR ?? [0, 0];
    const fL = P.fL ?? [0, 0];
    const footR = [X(32 + fR[0]), G - fR[1]];
    const footL = [X(40 + fL[0]), G - fL[1]];
    const hR = [shR[0] + P.hR[0] * m, shR[1] + P.hR[1]];
    const hL = [shL[0] + P.hL[0] * m, shL[1] + P.hL[1]];
    const wa = back ? 180 - P.wa : P.wa;
    const weapon = () => {
      if (hal) halberd(p, hR, wa, P.reach ?? 22, back ? -1 : 0);
      else sword(p, hR, wa, back ? -1 : 0, P.wl ?? 1);
    };
    // what lies behind the body: the weapon held behind, the shield on the far side (back view)
    const wBehind = (P.wb ?? false) !== back;
    if (wBehind) weapon();
    if (!hal && back) shieldFor(p, P, P.clutch ? [shL[0] + 2.5 * m, shL[1] + 9] : hL, true);
    if (wBehind) arm(p, shR, hR, -1.2 * m, back ? 0 : -1);
    // legs, the skirt
    leg(p, [hip[0] - 3.2 * m, hip[1]], footR, 0, back ? 0 : -1 + 1, 0);
    leg(p, [hip[0] + 3.2 * m, hip[1]], footL, 0, back ? -1 : 0, 0);
    skirt(p, hip[0], 43 + Math.max(by, cr), 3.6, 8 - cr, -bx * 0.5);
    // the torso, the gorget, the helm
    cuirass(p, chest, back, back ? 0 : P.core ?? 0);
    p.begin('all', 0);
    capsule(p, [head[0] - 2.4, 31.5 + by], 1.6, [head[0] + 2.4, 31.5 + by], 1.6, DARK);
    p.end();
    if (back) helm(p, head, true, 0, 0);
    // the arms in front (the left one; the right one unless behind)
    if (!P.clutch) arm(p, shL, hL, 1.2 * m, back ? -1 : 0);
    else arm(p, shL, [chest[0] + 4 * m, chest[1] + 3], 2 * m, 0); // (beside the rent: the core shows)
    if (!back) helm(p, head, false, (P.turn ?? 0), P.eyes ?? 3);
    if (!wBehind) {
      arm(p, shR, hR, -1.2 * m, 0);
      weapon();
      if (hal && P.two) {
        // the left gauntlet on the haft
        p.begin('all', 0);
        body(p, hL[0], hL[1], 1.8, 1.7, DARK);
        p.end();
      }
    }
    if (!hal && !back) shieldFor(p, P, P.clutch ? [shL[0] + 2.5 * m, shL[1] + 9] : hL, false); // (clutching the chest: the shield hangs at its side)
  }

  /**
   * The shield where the pose holds it (front / back view): hanging on the left forearm, raised to
   * the eyes, thrust at the viewer, drawn back or low.
   * @param {any} p @param {{ sh?: string }} P @param {number[]} hL @param {boolean} back
   */
  function shieldFor(p, P, hL, back) {
    const sh = P.sh ?? 'side';
    const c = sh === 'raised' ? [hL[0], hL[1] - 2] : sh === 'bash' ? [hL[0], hL[1] + 1] : sh === 'back' ? [hL[0] + (back ? -2 : 2), hL[1] + 1] : [hL[0] + (back ? -1 : 1), hL[1] + 1];
    shield(p, c, sh === 'bash' ? 1.22 : 1, back, back ? -1 : 0);
  }

  /**
   * The side view (facing left).
   * @param {any} p @param {SidePose} P @param {boolean} hal
   */
  function drawSide(p, P, hal) {
    const by = P.by ?? 0;
    const bx = P.bx ?? 0;
    const cr = P.crouch ?? 0;
    const lean = P.lean ?? 0;
    const hip = [CX + 1 + bx, 45 + cr];
    const chest = [CX - lean * 0.6 + bx, 37 + by];
    const shN = [CX - 1 - lean + bx, 34 + by];
    const shF = [CX + 2 - lean + bx, 33 + by];
    const head = [CX - 1 - lean * 1.2 + bx, 27 + by + (P.hy ?? 0)];
    const fN = P.fN ?? [0, 0];
    const fF = P.fF ?? [0, 0];
    const hN = [shN[0] + P.hN[0], shN[1] + P.hN[1]];
    const hF = [shF[0] + P.hF[0], shF[1] + P.hF[1]];
    const weapon = (lift) => {
      if (hal) halberd(p, hF, P.wa, P.reach ?? 22, lift);
      else sword(p, hF, P.wa, lift);
    };
    // the far side: the weapon arm (the halberd's far hand), the far leg
    if (P.wb) weapon(-1);
    arm(p, shF, hF, 1.4, -1, false);
    leg(p, [hip[0] + 1, hip[1]], [CX + 2 + fF[0] + bx * 0.5, G - fF[1]], -1.5, -1, -1);
    leg(p, [hip[0] - 1, hip[1]], [CX - 1 + fN[0] + bx * 0.5, G - fN[1]], -1.5, 0, -1);
    // the skirt (front and back flaps)
    skirt(p, hip[0] - 0.5, 43 + Math.max(by, cr), 3.2, 8 - cr, 0.5);
    // the torso in profile: the breastplate bulging forward, the backplate
    p.begin('all', 0);
    body(p, chest[0] + 0.6, chest[1], 6.6, 6.3, IRON, { hi: 0.3, lo: -0.3 });
    p.end();
    p.begin(null);
    for (let y = Math.round(chest[1] - 3); y <= Math.round(chest[1] + 3); y++) p.over(Math.round(chest[0] - 5), y, IRON, 4);
    for (let y = Math.round(chest[1] - 4); y <= Math.round(chest[1] + 2); y++) p.over(Math.round(chest[0] + 5), y, DARK, 0);
    for (let x = Math.round(chest[0] - 5); x <= Math.round(chest[0] + 5); x++) {
      p.over(x, Math.round(chest[1] + 4), DARK, 0);
      p.over(x, Math.round(chest[1] + 6), DARK, 0);
    }
    if (P.core) {
      // the open plate: the rent on the chest's front, the heart showing
      K.fillPoly(p, [[chest[0] - 5.5, chest[1] - 3], [chest[0] - 2.5, chest[1] - 2], [chest[0] - 2, chest[1] + 1], [chest[0] - 5.5, chest[1] + 2.5]], VOID, 0);
      if (P.core === 1) {
        for (const [x, y, s] of [[-4, -1, 4], [-3, -1, 3], [-4, 0, 4], [-3, 0, 4], [-4, 1, 3], [-5, 0, 3]]) p.set(Math.round(chest[0] + x), Math.round(chest[1] + y), GLOW, s);
        for (const [x, y] of [[-2, -4], [-1, -5], [-1, 3], [0, 4]]) p.over(Math.round(chest[0] + x), Math.round(chest[1] + y), GLOW, 2);
      } else {
        for (const [x, y] of [[-4, -1], [-3, 0], [-4, 1]]) p.set(Math.round(chest[0] + x), Math.round(chest[1] + y), GLOW, 1);
        for (const [x, y] of [[-5, -2], [-3, -2], [-2, 0], [-5, 2], [-3, 2]]) p.set(Math.round(chest[0] + x), Math.round(chest[1] + y), RIME, 3);
      }
    }
    p.end();
    p.begin('all', 0);
    capsule(p, [head[0] - 1.5, 31.5 + by], 1.6, [head[0] + 2, 31.5 + by], 1.6, DARK);
    p.end();
    helmSide(p, head, P.turn ?? 0, P.eyes ?? 3);
    // the near side: the shield arm, the shield; the weapon in front
    if (!P.wb) weapon(0);
    if (hal && P.two) arm(p, shN, hN, -1.4, 0);
    else if (P.clutch) arm(p, shN, [chest[0] - 3, chest[1]], -2, 0);
    else arm(p, shN, hN, -1.4, 0);
    if (!hal) {
      // the heater on the near arm, turned three-quarters toward the viewer (its bell squashed)
      const sh = P.sh ?? 'side';
      const c = sh === 'raised' ? [hN[0] - 1, hN[1] - 2] : sh === 'bash' ? [hN[0] - 3, hN[1]] : sh === 'back' ? [hN[0] + 1, hN[1] + 1] : [hN[0], hN[1] + 1];
      shield(p, c, sh === 'bash' ? 1.1 : 1, false, 0, 0.62);
    }
    if (hal && P.two) {
      p.begin('all', 0);
      body(p, hN[0], hN[1], 1.8, 1.7, DARK);
      p.end();
    }
    pauldron(p, shN, 0);
  }

  /**
   * The empty heap: the breastplate on its back, the helm rolled clear (its sights dark), a
   * gauntlet, a greave, the weapon on the snow, rime over all.
   * @param {any} p @param {string} view @param {boolean} hal
   */
  function drawDead(p, view, hal) {
    const flip = view === 'up' ? -1 : 1;
    const X = (x) => CX + (x - CX) * flip;
    // the weapon under the plates
    if (hal) halberd(p, [X(18), 55], view === 'up' ? 172 : 8, 30, -1);
    else sword(p, [X(24), 56], view === 'up' ? 168 : 12, -1);
    // a greave and a sabaton
    p.begin('all', 0);
    capsule(p, [X(44), 55], 1.9, [X(51), 56], 1.6, IRON, { lift: -1 });
    body(p, X(53), 56.5, 2.2, 1.3, IRON);
    p.end();
    // the breastplate, lying open-side up: its hollow dark, rime inside
    p.begin('all', 0);
    body(p, CX, 53.5, 7, 3.6, IRON, { hi: 0.3 });
    p.end();
    p.begin(null);
    K.fillPoly(p, [[CX - 4, 52], [CX + 4, 52], [CX + 3, 54], [CX - 3, 54]], VOID, 0);
    for (const x of [-3, -1, 2]) p.over(CX + x, 53, RIME, 3);
    p.end();
    // a pauldron, a gauntlet
    p.begin('all', 0);
    body(p, X(27), 55.5, 3, 2, IRON);
    body(p, X(45), 52.5, 1.8, 1.4, DARK);
    p.end();
    // the helm, rolled clear, its sights dark
    if (view === 'side') helmSide(p, [X(48) - 2, 52], 0, 0);
    else helm(p, [X(47), 52], false, flip, 0);
    // the frost that was in it, settling
    p.begin(null);
    for (const [x, y] of [[30, 51], [33, 50], [39, 51], [42, 50], [36, 49]]) p.set(X(x), y, RIME, 2);
    p.end();
  }

  /**
   * Paint one frame.
   * @param {any} p @param {'down'|'up'|'side'} view @param {string} key @param {{ G: number }} _f
   */
  function draw(p, view, key, _f) {
    const hal = key.startsWith(HALBERD_PREFIX);
    const name = hal ? key.slice(HALBERD_PREFIX.length) : key;
    const R = (hal ? HALBERD : SWORD)[name] ?? (hal ? HALBERD : SWORD).idle0;
    if (name === 'dead') drawDead(p, view, hal);
    else if (view === 'side') drawSide(p, R.s, hal);
    else drawFront(p, R.f, hal, view === 'up');
    rime(p);
    // (the glowing eyes and the core stay glow texels: re-lay any the rime pass reached)
  }

  const columns = [...HUSHGUARD_POSES, ...HUSHGUARD_POSES.map((n) => HALBERD_PREFIX + n)];
  return {
    fw: FW, fh: FH, columns,
    // (the Enemy's shared names: the attack's wind-up and strike, the stagger)
    aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.25, 0.6]) },
    idle: { poses: ['idle0', 'idle1'], fps: 1.6 },
    draw,
    ramps: () => K.makeRamps({
      [IRON]: K.ramp5(['#2c3448', '#3c465e', '#505c7a', '#7482a6', '#9eacce']),
      [DARK]: K.ramp5(['#1e2434', '#2a3246', '#38425c', '#4a5674', '#626e92']),
      [RIME]: K.ramp5(['#7d8fbe', '#b4c4dc', '#c8dcec', '#e2fbff', '#f4feff']),
      [VOID]: K.ramp5(['#020306', '#04060b', '#070a12', '#0c111c', '#121a28']),
      [CLOTH]: K.ramp5(['#2a3248', '#3a4664', '#4e5e86', '#62749e', '#788ab2']),
      [BRASS]: K.ramp5(['#2a1d0e', '#4e3818', '#7a5c28', '#a6843e', '#cfb064']),
      [STRAP]: K.ramp5(['#0e0a08', '#1e1610', '#30241a', '#463424', '#5e4832']),
      [HAFT]: K.ramp5(['#120c08', '#21170f', '#342618', '#4a3722', '#624a2e']),
      [FIELD]: K.ramp5(['#2c3652', '#3e5078', '#526a9a', '#667eac', '#7c92bc']),
      [EDGE]: K.ramp5(['#6a7e9c', '#94aac6', '#c0d4e8', '#e4f0fa', '#ffffff']),
      [GLOW]: K.glowRamp(['#0e5068', '#1c8cb0', '#46cdf0', '#9ff2ff', '#eaffff']),
    }, IRON),
  };
}
