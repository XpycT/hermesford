/**
 * Rimehart, the Stag of the Waking Wood (docs/contracts/EVERMERE_CAMPAIGN.md §2.6.3, §5.4, §6.7): the
 * first guardian — a great frost stag on the shrine hill of the Blossomwood, a forest spirit the Hush
 * froze. Two phases against Linnet and Corin (levels ≈ 5); at 0 HP it is not killed but released: it
 * kneels in a frost shell and waits, and when the toll's thaw front reaches it, it rises, shakes the
 * frost off and walks north out of the glade into the blossom ("It wasn't dead. It was waiting.").
 * Owner: the guardians package — this brain, the painter (src/engine/pixel/monsters/rimehart.js), the
 * guardians' FX frames (src/engine/pixel/fx/evGuardFx.js) and particle presets
 * (src/engine/fx/presets/evGuard.js), all registered here (`register`, ./index.js).
 *
 * Like the golem's (COMBAT.md §8) this brain drives every state itself (`update`); the Enemy supplies
 * timers, markers, hazards and movement; core owns the arena, the bar, the hit-stop, the music and
 * the HP floors (`e.hpFloor`: the phase threshold, so core's phase-3 kneel never applies).
 *
 * **Frames.** The sheet is laid out in strips (side facing left / right, front, back; the phase-2
 * cells `<pose>X` carry the ice crystals): the brain shows every frame itself (`show`) — the front
 * cell while the sprite's direction is `down` and the pose has one, the back cell while `up`, else
 * the side its facing points to on screen.
 *
 * **States.** `dormant` (still, frosted, guarded) → `intro` (150 f: `bossIntro` at f0; still 40 f,
 * the head raised 44 f, the bellow at f84 with `bossAwake`) → `engage` (turns to the player, walks
 * in, picks moves; idle while its arena is open — the player outside) ⇄ `windup` / `active` /
 * `recover`; interrupts `phase` (the transition, guarded), `stagger` (Broken: poise per phase spent,
 * 150 f, vuln 1.3, exposed) and `stun` (charged into a tree: 150 f, vuln 1.5, exposed). `dead`:
 * `die` + `dead` — the release (below).
 *
 * **Moves** (every wind-up ≥ 18 f with a marker in core's ice styles: `frost`, the charge's lane `crack`):
 * - Antler Charge (d ≥ 4.5): a lane 2.4 wide tracking the player 30 f, locked 12 f; the gallop at
 *   13 u/s, armoured, a circle r 1.5 ahead (mv 1.4, kb 3, knockdown). Into one of the glade's tree
 *   trunks (a static collider: `blockedBy === 'collider'`) it is **stunned 150 f, vuln 1.5,
 *   exposed** — bait and punish (snow shaken off the crown); at the arena's edge a 36 f skid. Phase 2
 *   charges twice in a row (the second tracks 18 f + 12 f locked) unless the first ended in a tree.
 * - Antler Sweep (d ≤ 4.4): 36 f (tracking 20, locked 16), a sector r 4 ±70°; 8 f (mv 1.15, kb 2.6);
 *   34 f recover.
 * - Rear & Stomp (d ≤ 3.6, or the player lingering at its flank 45 f): 46 f reared, a circle r 3
 *   1.2 u ahead; the stomp (mv 1.45, kb 2.6, knockdown) and a frost ring r 3 → 7.5 at 7 u/s, 0.7
 *   wide (mv 0.9, kb 1.8); 44 f recover.
 * - Frost Leap (phase 2, d ≥ 3): 30 f crouched; three landing circles r 2.2 marching at the player
 *   (its spot 0.4 s ahead, ≤ 12 u, clear of trees), each filling 30 f, 26 f apart; the stag lands on
 *   each as it fills (mv 1.25, kb 2; the last knocks down); 48 f recover — the punish window.
 * - Blizzard Bellow (phase 2, d ≤ 8): 40 f head raised (a cone r 7 ±30°, tracking 22 f); 54 f of
 *   frost breath, a hit every 10 f (mv 0.3, kb 0.9); three ice patches r 1.35 left in the cone for
 *   6 s (harmless their first 18 f, then 3 flat every 0.5 s — the three tick together under one tag:
 *   a player where two overlap takes one tick); 36 f recover.
 *
 * **Phases** (`def.phases` [0.55]): phase 2 — the transition (110 f, guarded: the head raised, at f50
 * ice crystals burst out on the antlers — the `X` cells from then on — a push ring, mv 0, kb 3),
 * faster (walk 2.8 u/s, turns quicker), the leap, the bellow, the double charge.
 *
 * **The release** (`die` + `dead`, which core calls every sub-step of the dead boss, the ambient step
 * included; true: the brain keeps the body and fades it itself): the fall (0.9 s, kneeling, head
 * bowed), the frost shell (frost burst, shards); it waits at least 2.5 s and until the toll's thaw
 * front has reached its spot (`thawField.reached`: on a level without frost at once); then the shell
 * cracks (0.5 s), it stands (0.6 s), shakes the frost off (1 s, snow flying), turns north with a
 * last look back over its shoulder (0.8 s) and walks north (`up`) at 1.5 u/s for 4 s through drifting petals, fading over the last
 * 1.6 s — a ground move (`ctx.moveGround`): round what stands in its way, held where nothing free
 * lies north (it stands and fades there). No death animation: its def's `release` makes the 0 HP a release (COMBAT.md §30.7 — the
 * fight ends as a kill, the body stays the brain's).
 *
 * Its randomness: `e.rng` (its own stream) for the move picks and the patch spots only.
 *
 * @import { EnemyPackApi } from '../index.js'
 * @import { Brain, CombatContext, BossMove, RectXZ, FxOptions, MarkerStyle } from '../../types.js'
 * @import { Enemy } from '../../Enemy.js'
 */
import { rimehart as rimehartSheet, RIMEHART_CRYSTAL } from '../../../../engine/pixel/monsters/rimehart.js';
import * as guardFx from '../../../../engine/pixel/fx/evGuardFx.js';
import { PRESETS as GUARD_PRESETS } from '../../../../engine/fx/presets/evGuard.js';
import { globalUniforms } from '../../../../engine/render/GlobalUniforms.js';
import { thawField } from '../../../../engine/world/ThawField.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

/** Rimehart's moves (`ai.move`; `boss.force(move)`). @typedef {'charge'|'sweep'|'stomp'|'leap'|'bellow'} HartMove */
/** @type {readonly HartMove[]} */
export const HART_MOVES = Object.freeze(['charge', 'sweep', 'stomp', 'leap', 'bellow']);

const INTRO = Object.freeze({ total: 150, still: 40, bellow: 84 });
const PHASE_F = 110;
const PHASE_BURST_F = 50;
const BROKEN_F = 150;
const STUN_F = 150;
const GAP_F = [[42, 72], [30, 54]];
/** Turn rates (rad/s) by phase. */
const TURN = [150 * DEG, 185 * DEG];
const CHARGE = Object.freeze({ track: 30, lock: 12, track2: 18, width: 2.4, speed: 13, r: 1.5, ahead: 1.3, mv: 1.4, kb: 3.0, max: 24, skid: 36, min: 4.5 });
const SWEEP = Object.freeze({ windup: 36, track: 20, active: 8, recover: 34, r: 4, half: 70, mv: 1.15, kb: 2.6, range: 4.4 });
const STOMP = Object.freeze({ windup: 46, active: 6, recover: 44, r: 3, ahead: 1.2, mv: 1.45, kb: 2.6, range: 3.6, flank: 45,
  ring: Object.freeze({ rMax: 7.5, speed: 7, width: 0.7, mv: 0.9, kb: 1.8 }) });
const LEAP = Object.freeze({ windup: 30, every: 26, fill: 30, air: 22, r: 2.2, mv: 1.25, kb: 2.0, recover: 48, max: 12, lead: 0.4, apex: 2.0, min: 3 });
const BELLOW = Object.freeze({ windup: 40, track: 22, active: 54, every: 10, recover: 36, r: 7, half: 30, mv: 0.3, kb: 0.9, range: 8,
  patches: 3, patchAt: 20, patchR: 1.35, patchLife: 6, patchSafe: 18, patchFlat: 3, patchTick: 0.5 });
/** Move cooldowns (f), started when a move begins. */
const COOLDOWN = Object.freeze({ charge: 240, sweep: 90, stomp: 150, leap: 420, bellow: 480 });
/** Frames without a legal move before the no-three-in-a-row rule is waived. */
const STALL_F = 90;
/** The release (seconds). */
const REL = Object.freeze({ fall: 0.9, wait: 2.5, crack: 0.5, stand: 0.6, shake: 1.0, look: 0.8, walk: 4.0, fade: 1.6, speed: 1.5 });
/** The telegraphs' looks (core's Evermere marker styles, COMBAT.md §30.6): ice; the charge's cracking lane. @type {MarkerStyle} */
const FROST = 'frost';
/** @type {MarkerStyle} */
const CRACK = 'crack';
/** The Enemy's own hazards' markers (the leap's circles, the stomp's ring) restyled to the ice. */
const ICE_STYLE = Object.freeze({ style: FROST });
/** The glow of the eyes and the phase-2 crystals (an ice cyan, below the bloom threshold on snow). */
const GLOW = Object.freeze([0.45, 0.85, 1.0]);

// the frost effects' looks (constant objects: CombatFx keeps `color` by reference)
/** @type {Readonly<Record<'burst'|'burstBig'|'patch', FxOptions>>} */
const FX = Object.freeze({
  burst: Object.freeze({ mode: 'flat', lift: 0.06, color: [0.62, 0.86, 1.02], loops: 1, scale: 1.6 }),
  burstBig: Object.freeze({ mode: 'flat', lift: 0.06, color: [0.62, 0.86, 1.02], loops: 1, scale: 2.4 }),
  patch: Object.freeze({ mode: 'flat', lift: 0.05, color: [0.58, 0.82, 0.98], loop: true, duration: BELLOW.patchLife, scale: (BELLOW.patchR * 2) / 2 }),
});

/** The poses with a phase-2 cell (`<pose>X`). */
const CRYSTAL = new Set(RIMEHART_CRYSTAL);

/**
 * The brain state (`e.ai`).
 * @typedef {ReturnType<typeof initAI>} HartAI
 */

/** @param {Enemy} e */
function initAI(e) {
  return {
    own: false,
    /** the cell shown (−1: show again) and the side the side view faces */
    col: -1, row: -1, side: /** @type {'left'|'right'} */ ('left'),
    yaw: Math.atan2(e.facing.x, e.facing.z),
    clock: 0, phaseT: 0, stride: 0,
    /** @type {HartMove|null} */ move: null,
    /** @type {HartMove|null} */ last1: null,
    /** @type {HartMove|null} */ last2: null,
    /** @type {HartMove|null} */ forced: null,
    gap: F(40), stall: 0, offT: 0,
    cd: { charge: 0, sweep: 0, stomp: 0, leap: 0, bellow: 0 },
    /** phase 2's crystals are out (the `X` cells) */
    crystal: false,
    awoke: false, burst: false,
    cx: 0, cz: 0, tag: 0,
    // the charge: its lane, run, the second charge of phase 2, the skid
    lx: 0, lz: 1, len: 0, end: 'max', run: 0, done: 0, again: 0, second: false, skid: false, trunk: false,
    // the leap: its three landings (x, z) and the take-off spot
    hops: [0, 0, 0, 0, 0, 0], hx: 0, hz: 0, landed: -1,
    // the bellow's ice patches (slots 1–3 of the Enemy's markers)
    patches: [mkPatch(), mkPatch(), mkPatch()], nextTick: 0, laid: false,
    /** the patches' hit tag per tick index (one for all three: a player on an overlap takes one tick) */
    patchTags: /** @type {number[]} */ ([]),
    // the release: the stage, its clock, the dust cadence
    rel: /** @type {''|'fall'|'shell'|'crack'|'stand'|'shake'|'look'|'walk'|'gone'} */ (''), relT: 0, relFx: 0,
    /** @type {RectXZ|null} */ inset: null,
  };
}

/** An ice patch record. */
function mkPatch() {
  return { on: false, x: 0, z: 0, t: 0, n: 0 };
}

/** @satisfies {Brain} */
export const rimehartBrain = {
  init: initAI,

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {HartAI} */ (e.ai);
    if (!ai.own) {
      // take the frames over (Enemy.pose shows a laid-out sheet's poses in the wrong row)
      ai.own = true;
      e.anim('idle');
      ai.col = -1;
    }
    ai.clock += h;
    ai.phaseT += h;
    for (const k of HART_MOVES) if (ai.cd[k] > 0) ai.cd[k] -= h;
    const p2 = e.def.phases?.[0] ?? 0.55;
    const fighting = e.state !== 'dormant' && e.state !== 'intro';
    if (fighting && e.phase === 1 && e.state !== 'phase' && e.hp <= e.hpMax * p2 + EPS) startPhase(e, ctx);
    icyHazards(e, ctx);
    patchesStep(e, h, ctx);
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    // (the phase threshold is the floor until the transition; phase 2 none: the kill is the release)
    e.hpFloor = e.phase === 1 ? e.hpMax * p2 : 0;
  },

  /**
   * Boss poise: spent by hits outside the transition → Broken.
   * @type {Brain['onHit']}
   */
  onHit(e, info, ctx) {
    if (info.guarded || e.guarded || e.armored) return;
    const s = e.state;
    if (s !== 'engage' && s !== 'windup' && s !== 'active' && s !== 'recover') return;
    e.poise -= info.poise || 0;
    if (e.poise > 0) return;
    cancelMove(e, ctx);
    e.vuln = 1.3;
    e.exposed = true;
    e.setState('stagger');
    ctx.sfx('stun', e.position.x, e.position.z);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    cancelMove(e, ctx);
    if (ctx) clearPatches(e, ctx);
  },

  /** The fall begins (the release: `dead` plays it). @type {Brain['die']} */
  die(e, ctx) {
    const ai = /** @type {HartAI} */ (e.ai);
    ai.move = null;
    ai.rel = 'fall';
    ai.relT = 0;
    ai.relFx = 0;
    e.lift = 0;
    e.sprite.tint.setRGB(1, 1, 1);
    e.sprite.opacity = 1;
    if (ctx) {
      const p = e.position;
      ctx.sfx('iceCrack', p.x, p.z, { volume: 0.9, pitch: 0.8 });
      ctx.burst('evgFrost', p.x, p.y + 0.3, p.z, 8);
    }
  },

  /**
   * The release (after `die`), every sub-step of the dead boss: the fall, the shell, the wait for the
   * thaw, the rise, the shake, the last look, the walk north and the fade. True: the brain keeps the
   * body (core's default fade off).
   * @param {Enemy} e @param {number} h @param {CombatContext} ctx
   * @returns {boolean}
   */
  dead(e, h, ctx) {
    return releaseStep(e, h, ctx);
  },

  /**
   * Test hook `combat.boss.force(move)`: only `move` may be picked next, at once (the others wait
   * 99 s); null: none. Rimehart's move names (`HART_MOVES`).
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {HartAI} */ (e.ai);
    const m = /** @type {string|null} */ (move);
    for (const k of HART_MOVES) ai.cd[k] = k === m ? 0 : 99;
    ai.forced = HART_MOVES.find((k) => k === m) ?? null;
    ai.gap = 0;
    ai.stall = 0;
    ai.offT = 0;
  },

  /** Test hook `combat.boss.info()`: the move in progress, the charge's skid. @type {Brain['info']} */
  info(e) {
    const ai = /** @type {HartAI} */ (e.ai);
    // (Rimehart's move names until core's BossMove lists them: report §2)
    return { move: ai.move, pending: null, skid: ai.skid };
  },

  /** Test hook `bossPhase(n)`: no transition, signals `bossPhase` (phase 2: the crystals out). @type {Brain['jumpPhase']} */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {HartAI} */ (e.ai);
    n = Math.max(1, Math.min(2, n | 0));
    cancelMove(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    ai.crystal = n >= 2;
    ai.col = -1;
    if (e.state !== 'dormant' && e.state !== 'intro') {
      e.guarded = false;
      e.setState('engage');
      ai.gap = F(30);
    }
    ctx.emit('bossPhase', e, n);
  },

  /** The eyes always; phase 2's crystals brighter; a flicker through every wind-up. @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {HartAI} */ (e.ai);
    let a;
    if (!e.alive) a = ai.rel === 'fall' || ai.rel === 'shell' ? 0.25 : 0;
    else if (e.state === 'dormant') a = 0.2;
    else if (e.state === 'intro') a = 0.2 + 0.5 * Math.min(1, e.t / F(INTRO.bellow));
    else if (!ai.crystal) a = 0.7;
    else a = 1.0 + 0.15 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 0.8 * ai.clock));
    if (e.alive && e.state === 'phase') a = e.t < F(PHASE_BURST_F) ? 0.7 + 0.6 * (e.t / F(PHASE_BURST_F)) : 1.3;
    if (e.alive && e.state === 'windup') a += 0.35 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 6 * e.t));
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = a;
  },
};

// -------------------------------------------------------------------------------------------------
// frames
// -------------------------------------------------------------------------------------------------

/**
 * Show a cell: the front one facing the camera, the back one facing away (when the pose has one),
 * else the side its facing points to on screen.
 * @param {Enemy} e @param {string} name
 */
function show(e, name) {
  const ai = /** @type {HartAI} */ (e.ai);
  const sheet = e.sheet;
  if (!sheet.cell) return;
  const dir = e.sprite.direction;
  const cells = sheet.cells;
  let d;
  if (dir === 'down' && cells?.down && Object.hasOwn(cells.down, name)) d = 'down';
  else if (dir === 'up' && cells?.up && Object.hasOwn(cells.up, name)) d = 'up';
  else {
    const yaw = globalUniforms.uCameraYaw.value;
    const rx = e.facing.x * Math.cos(yaw) - e.facing.z * Math.sin(yaw);
    if (rx > 0.2) ai.side = 'right';
    else if (rx < -0.2) ai.side = 'left';
    d = ai.side;
  }
  const c = sheet.cell(name, d);
  if (c.col === ai.col && c.row === ai.row) return;
  ai.col = c.col;
  ai.row = c.row;
  e.sprite.setFrame(c.col, c.row);
}

/** A fight pose: its phase-2 cell once the crystals are out. @param {Enemy} e @param {string} name */
function pose(e, name) {
  show(e, /** @type {HartAI} */ (e.ai).crystal && CRYSTAL.has(name) ? `${name}X` : name);
}

/** The breathing idle. @param {Enemy} e */
function idle(e) {
  const ai = /** @type {HartAI} */ (e.ai);
  pose(e, `idle${[0, 1, 2, 1][Math.floor(ai.clock * 2.5) % 4]}`);
}

/**
 * Walk along the facing at `speed`: the frames by the distance walked.
 * @param {Enemy} e @param {number} speed @param {number} h @param {CombatContext} ctx
 */
function stride(e, speed, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const x0 = p.x;
  const z0 = p.z;
  e.walk(e.facing.x, e.facing.z, speed, h, ctx, null, false);
  ai.stride += Math.hypot(p.x - x0, p.z - z0);
  pose(e, `walk${Math.floor(ai.stride / 0.42) % 4}`);
}

// -------------------------------------------------------------------------------------------------
// states
// -------------------------------------------------------------------------------------------------

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function step(e, h, ctx) {
  switch (e.state) {
    case 'dormant': dormant(e, ctx); break;
    case 'intro': intro(e, h, ctx); break;
    case 'engage': engage(e, h, ctx); break;
    case 'windup':
    case 'active':
    case 'recover': attack(e, h, ctx); break;
    case 'phase': phase(e, ctx); break;
    case 'stagger':
      pose(e, 'stun');
      if (e.after(BROKEN_F)) {
        e.poise = e.poiseMax;
        e.vuln = 1;
        e.exposed = false;
        endMove(e);
      }
      break;
    case 'stun':
      pose(e, 'stun');
      if (e.after(STUN_F)) {
        e.vuln = 1;
        e.exposed = false;
        endMove(e, F(20));
      }
      break;
    default:
      e.setState('engage');
  }
}

/**
 * Still and frosted, guarded, until the player stands inside its arena (no arena: within 10 u) —
 * or its group appears through the story (`introOnSpawn`: core starts the intro).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  e.guarded = true;
  e.aggro = false;
  show(e, 'idle0');
  const P = ctx.player;
  if (!P.alive || ctx.ambient) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 10;
  if (inside) e.setState('intro');
}

/**
 * The intro (150 f, the author's title card over it): still, then the head raised to the sky, the
 * bellow with `bossAwake`.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function intro(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.aggro = true;
  if (e.entered) {
    ai.awoke = false;
    ctx.emit('bossIntro', e);
  }
  const P = ctx.player.position;
  if (e.fr < INTRO.still) {
    turnToward(e, P.x, P.z, h, 60 * DEG);
    show(e, 'idle0');
  } else if (e.fr < INTRO.bellow) {
    turnToward(e, P.x, P.z, h, 60 * DEG);
    show(e, 'bellowWind');
  } else {
    if (!ai.awoke) {
      ai.awoke = true;
      ctx.sfx('stagBellow', p.x, p.z);
      ctx.shake(0.25, 0.6);
      breath(e, ctx, 4, 3.5);
      ctx.emit('bossAwake', e);
    }
    if (e.fr < INTRO.bellow + 44) {
      show(e, 'bellow');
      if (everyF(e, h, 6)) breath(e, ctx, 2, 2.5);
    } else idle(e);
  }
  if (e.after(INTRO.total)) {
    e.guarded = false;
    ai.gap = F(36);
    e.setState('engage');
  }
}

/** The fight is on: its arena closed with the player inside (no arena: always). @param {Enemy} e */
function fightOn(e) {
  return !e.arena || e.arena.active;
}

/**
 * Turn toward the player, walk in, pick moves; while its arena stands open (the player outside) it
 * waits, watching.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const P = ctx.player;
  const tp = e.tp;
  e.guarded = false;
  if (!P.alive || !fightOn(e)) {
    turnToward(e, P.position.x, P.position.z, h, 60 * DEG);
    idle(e);
    return;
  }
  turnToward(e, P.position.x, P.position.z, h, TURN[e.phase - 1]);
  // the player lingering at its flank or behind it builds up the Rear & Stomp
  const dot = e.facing.x * tp.dx + e.facing.z * tp.dz;
  if (tp.d <= 4.2 && dot < Math.cos(75 * DEG)) ai.offT += h;
  else ai.offT = Math.max(0, ai.offT - h * 0.5);
  ai.gap -= h;
  let stalled = false;
  if (ai.gap <= 0) {
    const m = chooseMove(e);
    if (m) {
      startMove(e, m, ctx);
      return;
    }
    ai.stall += h;
    stalled = true;
  }
  const speed = e.def.phaseSpeeds?.[e.phase - 1] ?? e.def.speed;
  if (tp.d > 3.4 || (stalled && tp.d > 2.4)) stride(e, speed, h, ctx);
  else idle(e);
}

/**
 * The transition to phase 2 (guarded): the head raised, the crystals bursting out at f50, the push.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function phase(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  if (e.entered) {
    ctx.sfx('stagBellow', p.x, p.z, { pitch: 0.92 });
    ctx.shake(0.3, 0.8);
    ai.burst = false;
  }
  if (e.fr < PHASE_BURST_F) show(e, 'bellowWind');
  else {
    if (!ai.burst) {
      ai.burst = true;
      ai.crystal = true;
      ai.col = -1;
      const top = crown(e);
      ctx.burst('evgShards', top.x, top.y, top.z, 14);
      ctx.burst('evgShards', top.x, top.y + 0.6, top.z, 10);
      ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burstBig);
      ctx.burst('evgFrost', p.x, p.y + 0.4, p.z, 10);
      ctx.sfx('iceCrack', p.x, p.z, { volume: 1 });
      ctx.shake(0.4, 0.8);
      // a push, not a hit: mv 0 (no damage), kb 3
      const hz = e.hazardRing(p.x, p.z, 0.5, 5, 9, 0.8);
      hz.thin = false;
      hz.mv = 0;
      hz.kb = 3.0;
    }
    pose(e, 'bellow');
  }
  if (e.after(PHASE_F)) {
    e.guarded = false;
    endMove(e, F(24));
  }
}

/** Start phase 2 and signal it. @param {Enemy} e @param {CombatContext} ctx */
function startPhase(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  cancelMove(e, ctx);
  e.phase = 2;
  e.poise = e.poiseMax;
  ai.phaseT = 0;
  ctx.emit('bossPhase', e, 2);
  e.guarded = true;
  e.setState('phase');
}

// -------------------------------------------------------------------------------------------------
// moves
// -------------------------------------------------------------------------------------------------

/**
 * A seeded, weighted pick by distance and phase; cooldowns; never the same move three times in a
 * row unless nothing was legal for STALL_F frames.
 * @param {Enemy} e
 * @returns {HartMove|null}
 */
function chooseMove(e) {
  const ai = /** @type {HartAI} */ (e.ai);
  const d = e.tp.d;
  const ph = e.phase;
  const waive = ai.stall >= F(STALL_F) - EPS;
  /** @type {(m: HartMove) => boolean} */
  const ok = (m) => ai.cd[m] <= 0 && (waive || !(ai.last1 === m && ai.last2 === m));
  if (ai.forced) return ok(ai.forced) ? ai.forced : null;
  if (ai.offT >= F(STOMP.flank) - EPS && ok('stomp')) return 'stomp';
  /** @type {[HartMove, number][]} */
  const w = [
    ['charge', d >= CHARGE.min && ok('charge') ? (ph === 2 ? 2.5 : 3) : 0],
    ['sweep', d <= SWEEP.range && ok('sweep') ? 3 : 0],
    ['stomp', d <= STOMP.range && ok('stomp') ? 2 : 0],
    ['leap', ph === 2 && d >= LEAP.min && ok('leap') ? 2.2 : 0],
    ['bellow', ph === 2 && d <= BELLOW.range && ok('bellow') ? 2 : 0],
  ];
  let total = 0;
  for (const [, v] of w) total += v;
  if (total <= 0) return null;
  let r = e.rng.next() * total;
  for (const [m, v] of w) {
    r -= v;
    if (r < 0 && v > 0) return m;
  }
  return null;
}

/**
 * Begin move `m`: its cooldown, the history, the wind-up.
 * @param {Enemy} e @param {HartMove} m @param {CombatContext} ctx
 */
function startMove(e, m, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  ai.move = m;
  ai.last2 = ai.last1;
  ai.last1 = m;
  ai.cd[m] = F(COOLDOWN[m]);
  ai.stall = 0;
  if (m === 'stomp') ai.offT = 0;
  ai.len = 0;
  ai.skid = false;
  ai.trunk = false;
  ai.second = false;
  ai.again = m === 'charge' && e.phase === 2 ? 1 : 0;
  e.setState('windup');
  ctx.sfx('windup', e.position.x, e.position.z);
}

/**
 * The move is over: back to `engage` after `gap` s (default: the phase's seeded gap).
 * @param {Enemy} e @param {number} [gap]
 */
function endMove(e, gap) {
  const ai = /** @type {HartAI} */ (e.ai);
  ai.move = null;
  ai.skid = false;
  e.armored = false;
  e.lift = 0;
  const g = GAP_F[e.phase - 1] ?? GAP_F[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/**
 * Drop the move in progress (interrupts, the transition, the fall): markers, armour, vulnerability.
 * @param {Enemy} e @param {CombatContext} [ctx]
 */
function cancelMove(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  if (ctx) e.unmark(0, ctx);
  ai.move = null;
  ai.skid = false;
  e.armored = false;
  e.vuln = 1;
  e.exposed = false;
  e.lift = 0;
}

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function attack(e, h, ctx) {
  switch (/** @type {HartAI} */ (e.ai).move) {
    case 'charge': charge(e, h, ctx); break;
    case 'sweep': sweep(e, h, ctx); break;
    case 'stomp': stomp(e, ctx); break;
    case 'leap': leap(e, h, ctx); break;
    case 'bellow': bellow(e, h, ctx); break;
    default: endMove(e);
  }
}

/**
 * Antler Charge: the tracking lane, the gallop, a tree (stunned) or the skid; phase 2 again.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function charge(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    const track = ai.second ? CHARGE.track2 : CHARGE.track;
    const dur = track + CHARGE.lock;
    pose(e, Math.floor(e.t * 6) % 2 ? 'chargeWind1' : 'chargeWind0');
    if (e.t < F(track) - EPS) {
      turnToward(e, P.x, P.z, h, Infinity);
      if (e.fr % 2 === 0 || ai.len === 0) {
        ai.len = e.freeRun(e.facing.x, e.facing.z, CHARGE.max, ctx, inset(e, 1));
        ai.end = e.runEnd;
      }
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.style = CRACK;
    m.len = Math.max(0.5, ai.len + (ai.end === 'obstacle' ? 0.6 : 0));
    m.width = CHARGE.width;
    m.progress = Math.min(1, e.t / F(dur));
    m.flash = e.lockFlash(e.t - F(track));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.run = ai.len + (ai.end === 'obstacle' ? 1.0 : 0);
      ai.done = 0;
      ai.tag = e.newTag();
      e.armored = true;
      e.markProgress(0, ctx, 1);
      ctx.sfx('boarCharge', p.x, p.z, { pitch: 0.8 });
      ctx.burst('evgFrost', p.x, p.y + 0.3, p.z, 5);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    pose(e, `run${Math.floor(e.t * 14) % 4}`);
    const stepLen = Math.min(CHARGE.speed * h, ai.run - ai.done);
    let blocked = false;
    if (stepLen > 1e-5) {
      const x0 = p.x;
      const z0 = p.z;
      const fr = e.move(ai.lx * stepLen, ai.lz * stepLen, ctx);
      ai.done += Math.max(0, (p.x - x0) * ai.lx + (p.z - z0) * ai.lz);
      blocked = fr < 0.4;
    }
    if (everyF(e, h, 6)) ctx.burst('evgFrost', p.x - ai.lx * 1.2, p.y + 0.2, p.z - ai.lz * 1.2, 2);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx * CHARGE.ahead;
    s.z = p.z + ai.lz * CHARGE.ahead;
    s.r = CHARGE.r;
    s.mv = CHARGE.mv;
    s.kb = CHARGE.kb;
    s.knockdown = true;
    s.fromX = p.x;
    s.fromZ = p.z;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (blocked && e.blockedBy === 'collider') {
      trunkStun(e, ctx);
      return;
    }
    if (blocked || ai.done >= ai.run - 1e-3 || stepLen <= 1e-5) {
      e.unmark(0, ctx);
      e.armored = false;
      if (ai.again > 0 && fightOn(e)) {
        // phase 2: at once again (a shorter tracking)
        ai.again--;
        ai.second = true;
        ai.len = 0;
        e.setState('windup');
        ctx.sfx('windup', p.x, p.z);
        return;
      }
      ai.skid = true;
      e.setState('recover');
    }
    return;
  }
  // the skid at the arena's edge or the lane's end (open, no vulnerability)
  const u = Math.min(1, e.t / F(CHARGE.skid));
  const v = 7 * (1 - u) * (1 - u);
  if (v > 0) e.move(ai.lx * v * h, ai.lz * v * h, ctx);
  pose(e, u < 0.6 ? 'land' : 'idle0');
  if (e.entered) {
    ctx.burst('evgFrost', p.x, p.y + 0.2, p.z, 6);
    ctx.burst('evgSnow', p.x + ai.lx, p.y + 0.4, p.z + ai.lz, 6);
  }
  if (e.after(CHARGE.skid)) endMove(e);
}

/**
 * Into a tree trunk: stunned 150 f, vulnerable and exposed; snow shaken off the crown above.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function trunkStun(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  e.unmark(0, ctx);
  e.armored = false;
  e.vuln = 1.5;
  e.exposed = true;
  ai.trunk = true;
  ai.move = null;
  ai.again = 0;
  ctx.shake(0.45, 0.5);
  ctx.sfx('stun', p.x, p.z);
  ctx.sfx('iceCrack', p.x, p.z, { volume: 0.8, pitch: 1.2 });
  // the stars over the crown (ctx.fx adds the effect's lift, 1.6)
  ctx.fx('stun', p.x, p.y + 3.6, p.z, { duration: STUN_F / 60, follow: e.position });
  // the tree's crown shakes its snow down: ahead of the antlers
  const tx = p.x + ai.lx * (e.def.moveRadius + 0.9);
  const tz = p.z + ai.lz * (e.def.moveRadius + 0.9);
  const gy = ctx.groundAt(tx, tz);
  ctx.burst('evgSnow', tx, gy + 3.6, tz, 14);
  ctx.burst('evgSnow', tx, gy + 2.6, tz, 10);
  ctx.burst('evgShards', p.x + ai.lx * 1.4, p.y + 3.2, p.z + ai.lz * 1.4, 8);
  e.setState('stun');
}

/**
 * Antler Sweep: the sector ahead (tracking, then locked), the swing.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function sweep(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.t < F(SWEEP.track) - EPS) turnToward(e, P.x, P.z, h, TURN[e.phase - 1] * 1.4);
    pose(e, 'sweepWind');
    const m = e.markerSpec('sector', p.x, p.z);
    m.style = FROST;
    m.r = SWEEP.r;
    m.halfAngle = SWEEP.half;
    m.progress = Math.min(1, e.t / F(SWEEP.windup));
    m.flash = e.lockFlash(e.t - F(SWEEP.track));
    e.mark(0, ctx, m);
    if (e.after(SWEEP.windup)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    pose(e, 'sweep');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('swingHeavy', p.x, p.z, { pitch: 0.85 });
      ctx.burst('evgSnow', p.x + e.facing.x * 2.5, p.y + 0.3, p.z + e.facing.z * 2.5, 8);
    }
    if (e.after(SWEEP.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = SWEEP.r;
    s.halfAngle = SWEEP.half;
    s.mv = SWEEP.mv;
    s.kb = SWEEP.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  pose(e, e.t < F(14) ? 'sweep' : 'idle0');
  if (e.after(SWEEP.recover)) endMove(e);
}

/**
 * Rear & Stomp: reared up (the circle where the forelegs come down), the stomp, the frost ring.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function stomp(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) {
      ai.cx = p.x + e.facing.x * STOMP.ahead;
      ai.cz = p.z + e.facing.z * STOMP.ahead;
    }
    pose(e, 'rear');
    const m = e.markerSpec('circle', ai.cx, ai.cz);
    m.style = FROST;
    m.r = STOMP.r;
    m.progress = Math.min(1, e.t / F(STOMP.windup));
    e.mark(0, ctx, m);
    if (e.after(STOMP.windup)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    pose(e, 'stomp');
    if (e.entered) {
      const gy = ctx.groundAt(ai.cx, ai.cz);
      e.markProgress(0, ctx, 1);
      ctx.shake(0.45, 0.5);
      ctx.sfx('slam', ai.cx, ai.cz, { pitch: 0.9 });
      ctx.sfx('iceCrack', ai.cx, ai.cz, { volume: 0.7 });
      ctx.fx('evgFrostBurst', ai.cx, gy, ai.cz, FX.burstBig);
      ctx.burst('evgFrost', ai.cx, gy + 0.3, ai.cz, 10);
      ctx.burst('evgShards', ai.cx, gy + 0.2, ai.cz, 8);
    }
    if (e.after(STOMP.active)) {
      e.unmark(0, ctx);
      const R = STOMP.ring;
      const hz = e.hazardRing(ai.cx, ai.cz, STOMP.r, R.rMax, R.speed, R.width);
      hz.mv = R.mv;
      hz.kb = R.kb;
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = ai.cx;
    s.z = ai.cz;
    s.r = STOMP.r;
    s.mv = STOMP.mv;
    s.kb = STOMP.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  pose(e, e.t < F(26) ? 'stomp' : 'idle1');
  if (e.after(STOMP.recover)) endMove(e);
}

/**
 * Frost Leap: the crouch, then three hops onto three landing circles marching at the player.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function leap(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player;
  if (e.state === 'windup') {
    turnToward(e, P.position.x, P.position.z, h, TURN[1]);
    pose(e, 'leapWind');
    if (e.after(LEAP.windup)) {
      planLeaps(e, ctx);
      ai.landed = -1;
      e.armored = true;
      ctx.sfx('windup', p.x, p.z, { pitch: 1.2 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    const f = e.t * 60;
    let k = -1;
    for (let i = 0; i < 3; i++) if (f >= i * LEAP.every + (LEAP.fill - LEAP.air) - EPS) k = i;
    if (k >= 0) {
      const t0 = k * LEAP.every + (LEAP.fill - LEAP.air);
      const u = Math.min(1, (f - t0) / LEAP.air);
      const fx = k === 0 ? ai.hx : ai.hops[(k - 1) * 2];
      const fz = k === 0 ? ai.hz : ai.hops[(k - 1) * 2 + 1];
      const tx = ai.hops[k * 2];
      const tz = ai.hops[k * 2 + 1];
      p.x = fx + (tx - fx) * u;
      p.z = fz + (tz - fz) * u;
      p.y = ctx.groundAt(p.x, p.z);
      e.lift = u < 1 ? LEAP.apex * 4 * u * (1 - u) : 0;
      e.faceDir(tx - fx, tz - fz);
      pose(e, u < 1 ? 'leap' : 'land');
      if (u >= 1 && ai.landed < k) {
        ai.landed = k;
        ctx.fx('evgFrostBurst', tx, p.y, tz, FX.burst);
        ctx.burst('evgFrost', tx, p.y + 0.3, tz, 6);
        ctx.shake(0.22, 0.25);
        ctx.sfx('slam', tx, tz, { volume: 0.7, pitch: 1.15 });
      }
    } else pose(e, 'leapWind');
    if (ai.landed >= 2 && e.t >= F(2 * LEAP.every + LEAP.fill + 4) - EPS) {
      e.lift = 0;
      e.armored = false;
      e.setState('recover');
    }
    return;
  }
  pose(e, 'land');
  if (e.after(LEAP.recover)) endMove(e);
}

/**
 * The three landings: toward the player's spot `lead` s ahead, at most `max` u (clear of trees and
 * inside the arena, inset 1.5), a third, two thirds and all the way; their circles fill 30 f, 26 f
 * apart.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function planLeaps(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player;
  let tx = P.position.x + P.velocity.x * LEAP.lead;
  let tz = P.position.z + P.velocity.z * LEAP.lead;
  let dx = tx - p.x;
  let dz = tz - p.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const run = e.freeRun(dx, dz, Math.min(LEAP.max, d), ctx, inset(e, 1.5));
  const len = Math.max(1.5, run);
  ai.hx = p.x;
  ai.hz = p.z;
  for (let k = 0; k < 3; k++) {
    const x = p.x + dx * len * ((k + 1) / 3);
    const z = p.z + dz * len * ((k + 1) / 3);
    ai.hops[k * 2] = x;
    ai.hops[k * 2 + 1] = z;
    const hz = e.hazardCircle(x, z, LEAP.r, F(LEAP.fill), F(k * LEAP.every));
    hz.mv = LEAP.mv;
    hz.kb = LEAP.kb;
    hz.knockdown = k === 2;
  }
  e.faceDir(dx, dz);
}

/**
 * Blizzard Bellow: the head raised over the cone (tracking, then locked), the breath, the patches.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function bellow(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.t < F(BELLOW.track) - EPS) turnToward(e, P.x, P.z, h, TURN[1] * 1.4);
    pose(e, 'bellowWind');
    const m = e.markerSpec('sector', p.x, p.z);
    m.style = FROST;
    m.r = BELLOW.r;
    m.halfAngle = BELLOW.half;
    m.progress = Math.min(1, e.t / F(BELLOW.windup));
    m.flash = e.lockFlash(e.t - F(BELLOW.track));
    e.mark(0, ctx, m);
    if (e.after(BELLOW.windup)) {
      ai.nextTick = 0;
      ai.laid = false;
      e.markProgress(0, ctx, 1);
      ctx.sfx('stagBellow', p.x, p.z);
      ctx.sfx('windGust', p.x, p.z, { volume: 0.9 });
      ctx.shake(0.2, 0.9);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    pose(e, 'bellow');
    if (everyF(e, h, 4)) breath(e, ctx, 3, BELLOW.r);
    if (e.t >= ai.nextTick - EPS) {
      ai.nextTick += F(BELLOW.every);
      const s = e.hitSpec();
      s.shape = 'sector';
      s.r = BELLOW.r;
      s.halfAngle = BELLOW.half;
      s.mv = BELLOW.mv;
      s.kb = BELLOW.kb;
      s.tag = e.newTag();
      ctx.hitbox(e, s);
    }
    if (!ai.laid && e.t >= F(BELLOW.patchAt) - EPS) {
      ai.laid = true;
      layPatches(e, ctx);
    }
    if (e.after(BELLOW.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  pose(e, e.t < F(16) ? 'bellow' : 'idle2');
  if (e.after(BELLOW.recover)) endMove(e);
}

/**
 * A puff of frost breath from the muzzle along the facing (the cone's look).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} n @param {number} reach u
 */
function breath(e, ctx, n, reach) {
  const p = e.position;
  const f = e.facing;
  const sp = reach * 1.1;
  ctx.burst('evgBreath', p.x + f.x * 2.4, p.y + 3.0, p.z + f.z * 2.4, n, { velocity: [f.x * sp, -0.6, f.z * sp], velocityVariance: [Math.abs(f.z) * 1.6 + 0.3, 0.3, Math.abs(f.x) * 1.6 + 0.3] });
}

// -------------------------------------------------------------------------------------------------
// the ice patches (the bellow's; markers in the Enemy's slots 1–3: freed with it on a reset)
// -------------------------------------------------------------------------------------------------

/**
 * Three patches inside the cone: one in each third of its reach, seeded angles within ±24°.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function layPatches(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const yaw = Math.atan2(e.facing.x, e.facing.z);
  const rect = inset(e, BELLOW.patchR);
  for (let k = 0; k < BELLOW.patches; k++) {
    const a = yaw + (e.rng.next() * 2 - 1) * 24 * DEG;
    const r = 2.4 + k * 1.9 + e.rng.next() * 0.6;
    let x = p.x + Math.sin(a) * r;
    let z = p.z + Math.cos(a) * r;
    if (rect) {
      x = Math.min(rect.maxX, Math.max(rect.minX, x));
      z = Math.min(rect.maxZ, Math.max(rect.minZ, z));
    }
    const q = ai.patches[k];
    q.on = true;
    q.x = x;
    q.z = z;
    q.t = 0;
    q.n = 0;
    ai.patchTags.length = 0;
    const m = e.markerSpec('circle', x, z);
    m.style = FROST;
    m.r = BELLOW.patchR;
    m.progress = 0;
    m.alpha = 0.75;
    e.mark(1 + k, ctx, m);
    ctx.fx('evgIcePatch', x, ctx.groundAt(x, z), z, FX.patch);
    ctx.burst('evgFrost', x, ctx.groundAt(x, z) + 0.2, z, 4);
  }
  ctx.sfx('iceCrack', p.x + e.facing.x * 4, p.z + e.facing.z * 4, { volume: 0.6 });
}

/**
 * Every sub-step: the live patches fill (harmless) for `patchSafe` frames, then hurt `patchFlat`
 * every `patchTick` s while the player stands on them, and end after `patchLife` s.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function patchesStep(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  for (let k = 0; k < ai.patches.length; k++) {
    const q = ai.patches[k];
    if (!q.on) continue;
    q.t += h;
    if (q.t >= BELLOW.patchLife - EPS) {
      q.on = false;
      e.unmark(1 + k, ctx);
      continue;
    }
    const safe = F(BELLOW.patchSafe);
    if (q.t < safe) {
      e.markProgress(1 + k, ctx, q.t / safe);
      continue;
    }
    const due = Math.floor((q.t - safe + EPS) / BELLOW.patchTick) + 1;
    if (due > q.n) {
      q.n = due;
      const s = e.hitSpec();
      s.shape = 'circle';
      s.x = q.x;
      s.z = q.z;
      s.y = ctx.groundAt(q.x, q.z);
      s.r = BELLOW.patchR;
      s.mv = 0;
      s.kb = 0;
      s.flat = BELLOW.patchFlat;
      // (laid together, the three tick together: one tag per tick index — overlapping patches hurt once)
      s.tag = ai.patchTags[due] ??= e.newTag();
      ctx.hitbox(e, s);
    }
  }
}

/**
 * The Enemy's own hazards (the leap's landing circles, the stomp's and the transition's rings) are
 * drawn in the enemy style: their live markers restyled to the ice every sub-step (after the Enemy's
 * hazard update; a ring rewrites its whole spec each sub-step).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function icyHazards(e, ctx) {
  for (const hz of e._hazards) if (hz.on && hz.h >= 0) ctx.setMarker(hz.h, ICE_STYLE);
}

/** End every patch (the markers freed). @param {Enemy} e @param {CombatContext} ctx */
function clearPatches(e, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  for (let k = 0; k < ai.patches.length; k++) {
    if (!ai.patches[k].on) continue;
    ai.patches[k].on = false;
    e.unmark(1 + k, ctx);
  }
}

// -------------------------------------------------------------------------------------------------
// the release
// -------------------------------------------------------------------------------------------------

/**
 * One sub-step of the release (see the module comment). True: the brain keeps the body.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 * @returns {boolean}
 */
function releaseStep(e, h, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  if (ai.relT === 0) {
    // (Enemy.die showed its own `dead` pose after `die`: take the frames over again)
    e.anim('idle');
    ai.col = -1;
    if (!ai.rel) ai.rel = 'fall';
  }
  ai.relT += h;
  const t = ai.relT;
  switch (ai.rel) {
    case 'fall':
      pose(e, 'bow');
      if (t >= REL.fall) next(e, 'shell', ctx);
      break;
    case 'shell':
      show(e, 'shell');
      if (t >= REL.wait && thawField.reached(p.x, p.z)) next(e, 'crack', ctx);
      break;
    case 'crack':
      show(e, 'rise0');
      if (t >= REL.crack) next(e, 'stand', ctx);
      break;
    case 'stand':
      show(e, 'rise1');
      if (t >= REL.stand) next(e, 'shake', ctx);
      break;
    case 'shake':
      show(e, Math.floor(t * 10) % 2 ? 'shake1' : 'shake0');
      ai.relFx -= h;
      if (ai.relFx <= 0) {
        ai.relFx = 0.16;
        ctx.burst('evgSnow', p.x, p.y + 2.6, p.z, 6);
        ctx.burst('evgShards', p.x, p.y + 3.0, p.z, 3);
      }
      if (t >= REL.shake) next(e, 'look', ctx);
      break;
    case 'look':
      // turned north, the head back over its shoulder toward the camera
      show(e, 'freeIdle');
      if (t >= REL.look) next(e, 'walk', ctx);
      break;
    case 'walk': {
      e.faceDir(0, -1);
      // (a ground move: round a trunk or a house in its way, never through it; held where nothing
      // free lies north — a cliff, the map's edge — it stands and fades there)
      const moved = ctx.moveGround(e, 0, -REL.speed * h);
      p.y = ctx.groundAt(p.x, p.z);
      ai.stride += REL.speed * h * moved;
      show(e, moved > 0.2 ? `free${Math.floor(ai.stride / 0.42) % 4}` : 'freeIdle');
      ai.relFx -= h;
      if (ai.relFx <= 0) {
        ai.relFx = 0.45;
        ctx.burst('evgPetals', p.x, p.y + 1.6, p.z + 0.8, 4);
      }
      const fadeAt = REL.walk - REL.fade;
      // (kept above core's cut-off — a body at ≤ 0.001 is no longer updated — until the stage ends)
      e.sprite.opacity = t < fadeAt ? 1 : Math.max(0.01, 1 - (t - fadeAt) / REL.fade);
      if (t >= REL.walk - 1e-6) next(e, 'gone', ctx);
      break;
    }
    default:
      e.sprite.opacity = 0;
  }
  return true;
}

/**
 * The next stage of the release and its cue.
 * @param {Enemy} e @param {HartAI['rel']} stage @param {CombatContext} ctx
 */
function next(e, stage, ctx) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  ai.rel = stage;
  ai.relT = Number.MIN_VALUE;
  ai.relFx = 0;
  if (stage === 'shell') {
    ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burstBig);
    ctx.burst('evgFrost', p.x, p.y + 0.6, p.z, 10);
    ctx.burst('evgShards', p.x, p.y + 1.2, p.z, 8);
    ctx.sfx('iceCrack', p.x, p.z, { volume: 0.8, pitch: 0.7 });
  } else if (stage === 'crack') {
    ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burstBig);
    ctx.burst('evgShards', p.x, p.y + 1.6, p.z, 16);
    ctx.burst('evgShards', p.x, p.y + 2.6, p.z, 10);
    ctx.burst('evgSnow', p.x, p.y + 2.0, p.z, 12);
    ctx.sfx('iceBreak', p.x, p.z, { volume: 0.9 });
  } else if (stage === 'look') {
    e.faceDir(0, -1);
    ai.col = -1;
  } else if (stage === 'gone') {
    e.sprite.opacity = 0;
  }
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

/**
 * Does this sub-step — the state's time [e.t, e.t + h) — hold a multiple of `n` frames (its frame 0
 * included)? Once per multiple whatever the step's length (a chilled boss steps less than a frame).
 * @param {Enemy} e @param {number} h @param {number} n
 */
function everyF(e, h, n) {
  const t0 = e.t * 60 - 1e-6;
  return Math.floor((t0 + h * 60) / n) !== Math.floor(t0 / n);
}


/**
 * Turn the facing toward a point at `rate` rad/s (Infinity: at once).
 * @param {Enemy} e @param {number} x @param {number} z @param {number} h @param {number} rate
 */
function turnToward(e, x, z, h, rate) {
  const ai = /** @type {HartAI} */ (e.ai);
  const p = e.position;
  const want = Math.atan2(x - p.x, z - p.z);
  ai.yaw = Math.atan2(e.facing.x, e.facing.z);
  let d = want - ai.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const max = rate === Infinity ? Math.PI : rate * h;
  ai.yaw += Math.max(-max, Math.min(max, d));
  e.faceDir(Math.sin(ai.yaw), Math.cos(ai.yaw));
}

/**
 * The arena rect inset by `m` (a reused object), or null without an arena.
 * @param {Enemy} e @param {number} m
 * @returns {RectXZ|null}
 */
function inset(e, m) {
  const a = e.arena;
  if (!a) return null;
  const ai = /** @type {HartAI} */ (e.ai);
  const r = ai.inset ?? (ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  r.minX = a.rect.minX + m;
  r.maxX = a.rect.maxX - m;
  r.minZ = a.rect.minZ + m;
  r.maxZ = a.rect.maxZ - m;
  return r;
}

/** The crown of antlers in the world (≈ 1.4 u ahead of the feet, 5.6 u up; a reused object). @param {Enemy} e */
function crown(e) {
  const p = e.position;
  return { x: p.x + e.facing.x * 1.4, y: p.y + 5.6, z: p.z + e.facing.z * 1.4 };
}

/**
 * Register Rimehart and the guardians' shared parts (once per page: ./index.js): the sheet, the FX
 * frames (generation 3), the particle presets and the brain.
 * @param {EnemyPackApi} api
 */
export function register(api) {
  api.registerMonsterKind('rimehart', rimehartSheet);
  api.registerFxModule(guardFx);
  api.registerPresets(GUARD_PRESETS);
  api.registerBrain('rimehart', rimehartBrain);
}
