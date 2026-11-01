/**
 * The Hushed King (docs/contracts/EVERMERE_CAMPAIGN.md §2.4, §5.4, §6.7): Osmund Halloway under the
 * crown of frost, the final boss — a bell-founder fighting with the bell-founder's own craft. Owner:
 * the king package; registered by ./index.js: his sheet (src/engine/pixel/monsters/hushedking.js),
 * his FX frames (src/engine/pixel/fx/evKingFx.js, `late: 3`), his particle presets
 * (src/engine/fx/presets/evKing.js) and this brain. Numbers: ./defsKing.js `KING_TUNING`.
 *
 * Like the golem's (../../ai/golem.js, COMBAT.md §8.1) the brain drives every state itself and only
 * signals the global moments (`bossIntro`, `bossAwake`, `bossPhase`); every attack has a wind-up of
 * ≥ 18 f with a marker, phase 3's × 0.75.
 *
 * States: `dormant` (standing by the Hush Bell, guarded, until the player stands in his arena) →
 * `intro` (108 f: he turns, hums, lifts the hammer; `bossAwake` at f60) → `engage` ⇄ `windup` /
 * `active` / `recover` (a move) — interrupts `phase` (the transitions, guarded), `kneel` (stunned
 * after his Carillon: 4 s, the crown exposed — every hit a critical by the core's kneel rule,
 * vulnerability 1.5), `stagger` (Broken: his poise per phase spent; 180 f, vulnerability 1.3).
 *
 * Phase 1, *the Bellkeeper* — Linnet's kit from the other side:
 * - Black Peal (d ≤ 5.2): a cone r 5.4 ± 35°, tracked, locked 12 f before it sounds.
 * - Black Toll: a black bell planted ≤ 6 u toward the player; it tolls four times, 1.5 s apart —
 *   each ring (r 3.5, its own filling marker) pushes everyone inside out: stand outside it.
 * - Leap Slam (4–12 u): a crouch, a tracked landing circle, 30 f in the air, the slam (knockdown).
 * - Hammer Sweep: the punish for lingering at his side or back (r 2.9 round him).
 * Phase 2 (65 %), *the Court*: he raises the hammer to the Hush Bell; two Hushguard and a Hush
 * Cantor come (`KING_TUNING.adds`); the Hush Bell tolls every 15 s and a brazier dies at each
 * (./HushToll.js). The slam leaves a refreeze wave; + Rime Lane (ice spikes racing along a lane).
 * Phase 3 (30 %), *the Crown*: the brain sets the flag `bc-crown-phase` (the authors' scene: Tin
 * steps between the Hush Bell and Linnet — combat stands still in it); every brazier goes out; he
 * rings the Hush Bell himself 8 s after each toll has passed (`ring`, the toll's `due`); + Black
 * Carillon: four black bells drop round him 12 f apart (the motif backwards), the chord a ring r 8.5
 * — then he kneels, stunned 4 s, the crown exposed: the punish window.
 *
 * The end is a release, not a death (§6.7): at 0 HP the crown shatters at once (the burst, the
 * splinters, `crownShatter`), he holds the struck pose `KING_TUNING.bare` frames and kneels
 * uncrowned (`kneelBare`) — and stays, until the story (the group's `unless: crown-broken`) takes
 * him and the villager `osmund` stands there. His def says `release: true` (COMBAT.md §30.7): at 0
 * HP the core releases him — a kill that is no death (XP, the group's `cleared`, the arena opens);
 * `die` shatters the crown, `dead` holds the body (true: never faded). The brain sets no story flag
 * for it — the authors' `cleared` event on his group does.
 *
 * Test hooks: `force(e, move)` (the core's `boss.force`, any of this brain's moves: 'peal' | 'toll'
 * | 'leap' | 'sweep' | 'lane' | 'carillon' | 'ring'), `info(e)`, `jumpPhase`.
 *
 * @import { EnemyPackApi } from '../index.js'
 * @import { Enemy } from '../../Enemy.js'
 * @import { CombatContext, Brain, RectXZ } from '../../types.js'
 */
import { hushedking as paintKing } from '../../../../engine/pixel/monsters/hushedking.js';
import * as evKingFx from '../../../../engine/pixel/fx/evKingFx.js';
import { PRESETS as KING_PRESETS } from '../../../../engine/fx/presets/evKing.js';
import { KING_TUNING as T } from './defsKing.js';
import { tollOf } from './HushToll.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

/**
 * The colours the game draws the king's FX frames in (also the sheet viewer's, sandbox/king.html).
 * @type {Readonly<Record<string, number[]>>}
 */
export const FX_TINTS = Object.freeze({
  evkBell: [0.62, 0.9, 1.3],
  evkBellDrop: [0.62, 0.9, 1.3],
  evkRing: [0.42, 0.7, 1.02],
  evkPeal: [0.55, 0.86, 1.25],
  evkWave: [0.5, 0.82, 1.25],
  evkWarm: [1.45, 0.8, 0.3],
  evkSpike: [0.78, 1.06, 1.36],
  evkBurst: [1.1, 1.42, 1.6],
});

/** The flag the brain sets as phase 3 begins (the authors' crown scene, §2.6.7). */
export const CROWN_PHASE_FLAG = 'bc-crown-phase';

const INTRO_F = 108;
const AWAKE_F = 60;
const TURN = [150 * DEG, 170 * DEG, 190 * DEG];
/** The glow (cyan: the crown's spikes, the hammer's rims). */
const GLOW = [0.45, 0.88, 1.0];
/** The Carillon's four notes, the motif backwards (pitch ratios). */
const CARILLON_NOTES = [1.335, 1.189, 1.0, 0.891];
/** Frames without a legal move before the no-three-in-a-row rule is waived. */
const STALL_F = 90;

/**
 * @typedef {'peal'|'toll'|'leap'|'sweep'|'lane'|'carillon'|'ring'} KingMove
 */
/** The weighted moves in pick order. @type {KingMove[]} */
const WEIGHTED = ['peal', 'toll', 'leap', 'lane', 'carillon'];

/**
 * A black bell on the field (its rings are hazards; this is its look): planted by Black Toll or
 * dropped by the Carillon.
 * `at`: the point its standing sprite follows (the release sinks it out of sight at once).
 * @typedef {{ x: number, z: number, t: number, life: number, rung: number, shown: boolean, toll: boolean,
 *   at: { x: number, y: number, z: number } }} BlackBell
 */

/**
 * The brain state (`e.ai`).
 * @typedef {ReturnType<typeof KING.init>} KingAI
 */

/** @satisfies {Brain} */
export const KING = {
  /** @param {Enemy} e */
  init(e) {
    return {
      yaw: Math.atan2(e.facing.x, e.facing.z),
      /** @type {KingMove|null} */ move: null,
      /** @type {KingMove|null} */ last1: null,
      /** @type {KingMove|null} */ last2: null,
      gap: F(40),
      cd: { peal: 0, toll: 0, leap: 0, sweep: 0, lane: 0, carillon: 0, ring: 0 },
      /** @type {Record<KingMove, number>} */ weights: { peal: 0, toll: 0, leap: 0, sweep: 0, lane: 0, carillon: 0, ring: 0 },
      offT: 0,
      stall: 0,
      cx: 0, cz: 0, tx: 0, tz: 0, sx: 0, sz: 0, lx: 0, lz: 1, len: 0, front: 0, spikes: 0, tag: 0, landed: false, carK: 0,
      /** @type {[number, number][]} */ car: [],
      trans: 0, phaseT: 0, awoke: false, addsDone: false,
      /** @type {Enemy[]} */ adds: [],
      /** @type {BlackBell[]} */ bells: [],
      released: false, relT: 0, relGlints: 0,
      clock: 0,
      /** @type {RectXZ|null} */ inset: null,
    };
  },

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {KingAI} */ (e.ai);
    ai.clock += h;
    ai.phaseT += h;
    for (const k in ai.cd) if (ai.cd[k] > 0) ai.cd[k] -= h;
    blackBells(e, h, ctx);
    if (ai.released) {
      releasedStep(e, h, ctx);
      return;
    }
    const phases = e.def.phases ?? [0.65, 0.3];
    const fighting = e.state !== 'dormant' && e.state !== 'intro';
    if (fighting && e.state !== 'phase') {
      if (e.phase === 1 && e.hp <= e.hpMax * phases[0] + EPS) startPhase(e, 2, ctx);
      else if (e.phase === 2 && e.hp <= e.hpMax * phases[1] + EPS) startPhase(e, 3, ctx);
    }
    // a state entered in this sub-step runs its frame 0 at once (like Enemy's own dispatch)
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    // (phase 3: down to 0 — his def's `release`: the core releases him, `die` / `dead` below)
    e.hpFloor = e.phase === 1 ? e.hpMax * phases[0] : e.phase === 2 ? e.hpMax * phases[1] : 0;
  },

  /**
   * His poise (one pool per phase): spent by hits outside the transitions and his armoured moves →
   * Broken.
   * @type {Brain['onHit']}
   */
  onHit(e, info, ctx) {
    if (info.guarded || e.guarded || e.armored) return;
    const s = e.state;
    if (s !== 'engage' && s !== 'windup' && s !== 'active' && s !== 'recover') return;
    e.poise -= info.poise || 0;
    if (e.poise > 0) return;
    cancelMove(e, ctx);
    e.vuln = T.broken.vuln;
    e.exposed = true;
    e.setState('stagger');
    e.pose('kneel');
    ctx.sfx('stun', e.position.x, e.position.z);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    if (ctx) cancelMove(e, ctx);
    else {
      e.lift = 0;
      e.armored = false;
    }
  },

  /**
   * The release (the core's, his def's `release`; a test's `kill` too): the crown shatters now;
   * `dead` keeps the body.
   * @type {Brain['die']}
   */
  die(e, ctx) {
    const ai = /** @type {KingAI} */ (e.ai);
    if (!ai.released) release(e, ctx);
    e.sprite.tint.setRGB(1, 1, 1);
  },

  /**
   * The released body: kneeling, uncrowned, never faded (the story takes it away).
   * @type {Brain['dead']}
   */
  dead(e, h, ctx) {
    blackBells(e, h, ctx);
    releasedStep(e, h, ctx);
    return true;
  },

  /**
   * Test hook (`boss.force`): only `move` may be picked next, at once (`ring` makes the toll due).
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {KingAI} */ (e.ai);
    const m = /** @type {string} */ (move);
    for (const k in ai.cd) ai.cd[k] = k === m ? 0 : 99;
    ai.gap = 0;
    ai.offT = 0;
    ai.stall = 0;
    ai.last1 = null;
    ai.last2 = null;
  },

  /** @type {Brain['info']} */
  info(e) {
    const ai = /** @type {KingAI} */ (e.ai);
    return /** @type {any} */ ({ move: ai.move, pending: null, skid: false, bells: ai.bells.filter((b) => b.t < b.life).length, released: ai.released, adds: ai.adds.filter((a) => a.alive).length, trans: ai.trans });
  },

  /** @type {Brain['jumpPhase']} */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {KingAI} */ (e.ai);
    n = Math.max(1, Math.min(3, n | 0));
    cancelMove(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    ai.trans = 0;
    if (n >= 3) ai.cd.carillon = T.carillon.first;
    if (e.state !== 'dormant' && e.state !== 'intro') {
      e.guarded = false;
      e.setState('engage');
      ai.gap = F(30);
    }
    ctx.emit('bossPhase', e, n);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {KingAI} */ (e.ai);
    let a;
    if (ai.released) a = ai.relT < F(T.bare) ? 3 * (1 - ai.relT / F(T.bare)) : 0;
    else if (!e.alive) a = 0;
    else if (e.state === 'dormant') a = 0.45;
    else if (e.state === 'intro') a = 0.45 + 0.45 * Math.min(1, e.t / F(INTRO_F));
    else if (e.state === 'kneel') a = 1.6 + 0.4 * Math.sin(2 * Math.PI * 3 * ai.clock);
    else if (e.phase === 1) a = 0.8;
    else if (e.phase === 2) a = 1.0 + 0.15 * Math.sin(2 * Math.PI * 0.5 * ai.clock);
    else a = 1.5 + 0.35 * Math.sin(2 * Math.PI * ai.clock);
    if (e.state === 'phase' && ai.trans === 3) a += 1.2 * Math.min(1, e.t / F(T.phase3));
    if (e.alive && e.state === 'windup') a += 0.35;
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = a;
  },
};

// -------------------------------------------------------------------------------------------------
// states
// -------------------------------------------------------------------------------------------------

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function step(e, h, ctx) {
  switch (e.state) {
    case 'dormant': dormant(e, ctx); break;
    case 'intro': intro(e, ctx); break;
    case 'engage': engage(e, h, ctx); break;
    case 'windup':
    case 'active':
    case 'recover': attack(e, h, ctx); break;
    case 'phase': phase(e, ctx); break;
    case 'kneel': kneel(e, ctx); break;
    case 'stagger':
      e.pose('kneel');
      if (e.after(T.broken.f)) {
        e.poise = e.poiseMax;
        e.vuln = 1;
        e.exposed = false;
        endMove(e);
      }
      break;
    default:
      e.setState('engage');
  }
}

/**
 * Standing by the Hush Bell, leaning on the hammer, guarded — until the player stands in his arena
 * (no arena: within 10 u).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  e.guarded = true;
  e.aggro = false;
  e.lift = 0;
  if (e.entered) e.faceDir(0, 1);
  e.anim('idle');
  const P = ctx.player;
  if (!P.alive) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 10;
  if (inside) e.setState('intro');
}

/**
 * The 108 f intro: `bossIntro` at f0; he turns to her and hums (f24–f60); `bossAwake` at f60 and the
 * hammer lifted.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function intro(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.aggro = true;
  if (e.entered) {
    ai.awoke = false;
    ctx.emit('bossIntro', e);
  }
  const P = ctx.player.position;
  if (e.fr < 24) e.anim('idle');
  else if (e.fr < AWAKE_F) {
    turnToward(e, P.x, P.z, 1 / 60, 3);
    e.pose('hum');
  } else {
    if (!ai.awoke) {
      ai.awoke = true;
      ctx.sfx('bellTollBlack', p.x, p.z, { volume: 0.7, pitch: 0.8 });
      ctx.burst('evkRime', p.x, p.y + 2.4, p.z, 8);
      ctx.emit('bossAwake', e);
    }
    e.pose(e.fr < 84 ? 'raise' : 'idle0');
  }
  if (e.after(INTRO_F)) {
    e.guarded = false;
    ai.gap = F(40);
    e.setState('engage');
  }
}

/**
 * Turn to the player, build up a Sweep, ring the Hush Bell when it is due (phase 3), pick moves,
 * close in.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const P = ctx.player;
  const tp = e.tp;
  e.guarded = false;
  e.lift = 0;
  if (!P.alive) {
    e.anim('idle');
    return;
  }
  turnToward(e, P.position.x, P.position.z, h, e.phase - 1);
  if (tp.d <= 3.2 && e.facing.x * tp.dx + e.facing.z * tp.dz < Math.cos(70 * DEG)) ai.offT += h;
  ai.gap -= h;
  const speed = e.def.phaseSpeeds?.[e.phase - 1] ?? e.def.speed;
  // phase 3: the Hush Bell first — he rings it himself when its period has passed
  const toll = tollOf(ctx);
  if (e.phase >= 3 && toll?.due && ai.gap <= F(30)) {
    startMove(e, 'ring', ctx);
    return;
  }
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
  if (tp.d > 4.6 || (stalled && tp.d > 2.4)) e.walk(e.facing.x, e.facing.z, speed, h, ctx, 'walk', false);
  else e.anim('idle');
}

/**
 * The guarded transitions: phase 2 (the court rises: he hums, raises the hammer to the Hush Bell,
 * the adds come at f60) and phase 3 (the crown flares; the scene's flag was set as it began).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function phase(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.lift = 0;
  if (ai.trans === 2) {
    if (e.entered) {
      ctx.sfx('bellTollBlack', p.x, p.z, { volume: 0.9, pitch: 0.82 });
      ctx.shake(0.2, 0.6);
    }
    if (e.fr < 30) e.pose('hum');
    else {
      const toll = tollOf(ctx);
      if (toll) {
        const [mx, , mz] = toll.mouth;
        turnToward(e, mx, mz, 1 / 60, 1);
      }
      e.pose('raise');
    }
    if (e.fr >= 60 && !ai.addsDone) {
      ai.addsDone = true;
      ctx.shake(0.35, 0.8);
      spawnAdds(e, ctx);
    }
    if (e.after(T.phase2)) {
      e.guarded = false;
      ai.trans = 0;
      endMove(e, F(30));
    }
    return;
  }
  // phase 3: the crown
  if (e.entered) {
    ctx.sfx('bellTollBlack', p.x, p.z, { volume: 1, pitch: 0.7 });
    ctx.shake(0.25, 0.8);
  }
  e.pose(e.fr < 45 ? 'hum' : 'raise');
  if (e.fr === 45) ctx.burst('evkRime', p.x, p.y + 2.5, p.z, 16);
  if (e.after(T.phase3)) {
    e.guarded = false;
    ai.trans = 0;
    endMove(e, F(24));
  }
}

/**
 * Stunned after his Carillon: kneeling 4 s, the crown tipped to the camera — exposed (the core's
 * kneel rule: every hit a critical), vulnerability 1.5.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function kneel(e, ctx) {
  e.guarded = false;
  e.armored = false;
  e.exposed = true;
  e.vuln = T.carillon.vuln;
  e.lift = 0;
  e.pose('kneel');
  if (e.entered) {
    const p = e.position;
    ctx.sfx('stun', p.x, p.z);
    ctx.fx('stun', p.x, p.y + 0.6, p.z, { duration: F(T.carillon.kneel) - 0.2, follow: e.position });
  }
  if (e.after(T.carillon.kneel)) {
    e.exposed = false;
    e.vuln = 1;
    endMove(e, F(24));
  }
}

/**
 * Begin phase `n` (2: the court; 3: the crown — and the scene's flag) and signal `bossPhase`.
 * @param {Enemy} e @param {number} n @param {CombatContext} ctx
 */
function startPhase(e, n, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  cancelMove(e, ctx);
  e.phase = n;
  e.poise = e.poiseMax;
  ai.phaseT = 0;
  ai.trans = n;
  e.guarded = true;
  ctx.emit('bossPhase', e, n);
  if (n === 3) {
    ai.cd.carillon = T.carillon.first;
    // (the authors' crown scene: Tin steps between the Hush Bell and Linnet; combat stands still in it)
    ctx.setFlag?.(CROWN_PHASE_FLAG, 1);
  }
  e.setState('phase');
}

// -------------------------------------------------------------------------------------------------
// moves
// -------------------------------------------------------------------------------------------------

/** Wind-up length in the current phase (phase 3 × 0.75 rounded up, ≥ 18 f). @param {Enemy} e @param {number} n */
function W(e, n) {
  return e.phase === 3 ? Math.max(18, Math.ceil(n * 0.75)) : Math.max(18, n);
}

/**
 * Seeded, distance-weighted pick; cooldowns; never the same move 3 times in a row (unless nothing
 * else was legal for STALL_F frames).
 * @param {Enemy} e
 * @returns {KingMove|null}
 */
function chooseMove(e) {
  const ai = /** @type {KingAI} */ (e.ai);
  const d = e.tp.d;
  const ph = e.phase;
  const waive = ai.stall >= F(STALL_F) - EPS;
  /** @type {(m: KingMove) => boolean} */
  const ok = (m) => ai.cd[m] <= 0 && (waive || !(ai.last1 === m && ai.last2 === m));
  if (ai.offT >= F(60) - EPS && ok('sweep')) return 'sweep';
  if (d <= 2.8 && ok('sweep') && e.rng.chance(0.25)) return 'sweep';
  const w = ai.weights;
  w.peal = d <= T.peal.range && ok('peal') ? (d <= 3.5 ? 4 : 3.5) : 0;
  w.toll = d >= 2 && d <= 12 && ok('toll') ? (ph >= 2 ? 2.5 : 2) : 0;
  w.leap = d >= T.leap.min && d <= T.leap.max && ok('leap') ? 2.5 : 0;
  w.lane = ph >= 2 && d >= 3 && d <= 13 && ok('lane') ? 2.2 : 0;
  w.carillon = ph >= 3 && d <= 9 && ok('carillon') ? 6 : 0;
  let total = 0;
  for (const m of WEIGHTED) total += w[m];
  if (total <= 0) return null;
  let r = e.rng.next() * total;
  for (const m of WEIGHTED) {
    r -= w[m];
    if (r < 0 && w[m] > 0) return m;
  }
  return WEIGHTED.filter((m) => w[m] > 0).pop() ?? null;
}

/** @param {Enemy} e @param {KingMove} m @param {CombatContext} ctx */
function startMove(e, m, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  ai.move = m;
  if (m !== 'ring') {
    ai.last2 = ai.last1;
    ai.last1 = m;
  }
  const cdF = m === 'toll' ? (e.phase >= 2 ? T.cooldown.toll2 : T.cooldown.toll)
    : m === 'carillon' ? T.carillon.cooldown * 60 : m === 'ring' ? 0 : T.cooldown[m];
  ai.cd[m] = F(cdF);
  ai.stall = 0;
  if (m === 'sweep') ai.offT = 0;
  ai.len = 0;
  ai.front = 0;
  ai.spikes = 0;
  ai.landed = false;
  ai.carK = 0;
  e.setState('windup');
  if (e.entered && m !== 'ring') ctx.sfx('windup', e.position.x, e.position.z, { volume: 0.7 });
}

/** The move is over: back to `engage` after `gap` s (default: the phase's seeded gap). @param {Enemy} e @param {number} [gap] */
function endMove(e, gap) {
  const ai = /** @type {KingAI} */ (e.ai);
  ai.move = null;
  e.armored = false;
  e.lift = 0;
  const g = T.gap[e.phase - 1] ?? T.gap[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/** Drop the move in progress (interrupts, phases, the release). @param {Enemy} e @param {CombatContext} ctx */
function cancelMove(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  e.unmarkAll(ctx);
  ai.move = null;
  e.armored = false;
  e.vuln = 1;
  e.exposed = false;
  e.lift = 0;
}

/** States `windup` / `active` / `recover`: the current move. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function attack(e, h, ctx) {
  switch (/** @type {KingAI} */ (e.ai).move) {
    case 'peal': peal(e, h, ctx); break;
    case 'toll': plantBell(e, h, ctx); break;
    case 'leap': leap(e, h, ctx); break;
    case 'sweep': sweep(e, ctx); break;
    case 'lane': lane(e, h, ctx); break;
    case 'carillon': carillon(e, h, ctx); break;
    case 'ring': ringHushBell(e, h, ctx); break;
    default: endMove(e);
  }
}

/**
 * Black Peal: the cone, tracked until 12 f before it sounds.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function peal(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.peal;
  if (e.state === 'windup') {
    const dur = W(e, S.windup);
    e.pose('pealWind');
    if (e.t < F(dur - 12) - EPS) turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 3);
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = S.r;
    m.halfAngle = S.half;
    m.progress = Math.min(1, e.t / F(dur));
    m.flash = e.lockFlash(e.t - F(dur - 12));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('peal');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('peal', p.x, p.z, { pitch: 0.72 });
      ctx.shake(0.15, 0.25);
      // the dark arcs fanning out (the frame's apex at its foot: its centre 1.25 u × scale ahead)
      const sc = S.r / (37 / 16);
      ctx.fx('evkPeal', p.x + e.facing.x * 1.25 * sc, p.y, p.z + e.facing.z * 1.25 * sc,
        { mode: 'flat', lift: 0.12, dirX: e.facing.x, dirZ: e.facing.z, color: FX_TINTS.evkPeal, loops: 1, scale: sc });
      ctx.burst('evkAsh', p.x + e.facing.x * 2.5, p.y + 0.6, p.z + e.facing.z * 2.5, 6);
    }
    if (e.after(S.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = S.r;
    s.halfAngle = S.half;
    s.mv = S.mv;
    s.kb = S.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose('peal');
  if (e.after(S.recover)) endMove(e);
}

/**
 * Black Toll: the hammer raised over the spot (its circle filling), struck down — a black bell
 * drops there and tolls four times (hazards: each ring's own marker fills before it sounds).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function plantBell(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.toll;
  if (e.state === 'windup') {
    const dur = W(e, S.windup);
    if (e.entered) {
      const P = ctx.player.position;
      let dx = P.x - p.x;
      let dz = P.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      const reach = Math.max(2.2, Math.min(S.reach, d - 0.4));
      ai.tx = p.x + dx * reach;
      ai.tz = p.z + dz * reach;
      const r = inset(e, 1.2);
      if (r) {
        ai.tx = Math.min(r.maxX, Math.max(r.minX, ai.tx));
        ai.tz = Math.min(r.maxZ, Math.max(r.minZ, ai.tz));
      }
      e.face(ai.tx, ai.tz);
    }
    e.pose('raise');
    const m = e.markerSpec('circle', ai.tx, ai.tz);
    m.r = S.r;
    m.progress = Math.min(1, e.t / F(dur)) * 0.35;
    e.mark(0, ctx, m);
    if (e.after(dur)) e.setState('active');
    return;
  }
  if (e.state === 'active') {
    e.pose('plant');
    e.unmark(0, ctx);
    const gy = ctx.groundAt(ai.tx, ai.tz);
    ctx.sfx('hammerHit', p.x, p.z, { pitch: 0.8 });
    ctx.shake(0.2, 0.3);
    ctx.fx('evkBellDrop', ai.tx, gy, ai.tz, { mode: 'billboard', lift: 1.25, color: FX_TINTS.evkBellDrop, loops: 1 });
    ai.bells.push({ x: ai.tx, z: ai.tz, t: 0, life: S.life, rung: 0, shown: false, toll: true, at: { x: ai.tx, y: gy, z: ai.tz } });
    for (let k = 0; k < S.rings; k++) {
      const delay = k === 0 ? 0 : S.first + S.every * (k - 1);
      const hz = e.hazardCircle(ai.tx, ai.tz, S.r, F(k === 0 ? S.first : S.every), F(delay));
      hz.mv = S.mv;
      hz.kb = S.kb;
      hz.burst = 'evkAsh';
      hz.burstN = 8;
    }
    e.setState('recover');
    return;
  }
  e.pose('plant');
  if (e.after(S.recover)) endMove(e);
}

/**
 * Leap Slam: the crouch (the landing circle tracks, then locks 12 f before he leaves), 30 f in the
 * air, the slam — phase ≥ 2 a refreeze wave rolls out of it.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function leap(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.leap;
  if (e.state === 'windup') {
    const dur = W(e, S.windup);
    e.pose('leapWind');
    if (e.t < F(dur - S.lock) - EPS || e.entered) {
      const P = ctx.player;
      ai.tx = P.position.x + P.velocity.x * S.lead;
      ai.tz = P.position.z + P.velocity.z * S.lead;
      const r = inset(e, 1.5);
      if (r) {
        ai.tx = Math.min(r.maxX, Math.max(r.minX, ai.tx));
        ai.tz = Math.min(r.maxZ, Math.max(r.minZ, ai.tz));
      }
      e.face(ai.tx, ai.tz);
    }
    const m = e.markerSpec('circle', ai.tx, ai.tz);
    m.r = S.r;
    m.progress = Math.min(1, e.t / F(dur + S.air));
    m.flash = e.lockFlash(e.t - F(dur - S.lock));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.sx = p.x;
      ai.sz = p.z;
      ai.landed = false;
      ai.tag = e.newTag();
      e.armored = true;
      ctx.sfx('swingHeavy', p.x, p.z, { pitch: 0.75 });
      ctx.fx('dust', p.x, p.y, p.z);
      ctx.burst('evkRime', p.x, p.y + 0.3, p.z, 6);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    const air = F(S.air);
    if (!ai.landed) {
      const u = Math.min(1, e.t / air);
      e.pose('leap');
      e.lift = S.apex * 4 * u * (1 - u);
      const m = e.markerSpec('circle', ai.tx, ai.tz);
      m.r = S.r;
      m.progress = Math.min(1, (F(W(e, S.windup)) + e.t) / F(W(e, S.windup) + S.air));
      m.flash = 0.35;
      e.mark(0, ctx, m);
      // along the line to the landing spot (the remaining way spread over the remaining frames)
      const rest = Math.max(h, air - e.t);
      const k = Math.min(1, h / rest);
      e.move((ai.tx - p.x) * k, (ai.tz - p.z) * k, ctx);
      if (e.t >= air - EPS) {
        ai.landed = true;
        ai.cx = p.x;
        ai.cz = p.z;
        e.lift = 0;
        e.unmark(0, ctx);
        const gy = ctx.groundAt(p.x, p.z);
        ctx.shake(0.45, 0.5);
        ctx.sfx('hammerSlam', p.x, p.z);
        ctx.fx('dust', p.x, gy, p.z);
        ctx.fx('evkRing', p.x, gy, p.z, { mode: 'flat', lift: 0.06, color: FX_TINTS.evkRing, loops: 1, scale: S.r / (22 / 16) });
        ctx.burst('evkRime', p.x, gy + 0.3, p.z, 14);
        if (e.phase >= 2) {
          const hz = e.hazardRing(p.x, p.z, 0.6, T.wave.rMax, T.wave.speed, T.wave.width);
          hz.mv = T.wave.mv;
          hz.kb = T.wave.kb;
        }
        ai.len = e.t;
      }
      return;
    }
    e.pose('slam');
    // the slam's hit: its first 6 f
    if (e.t - ai.len < F(6) - EPS) {
      const s = e.hitSpec();
      s.shape = 'circle';
      s.x = ai.cx;
      s.z = ai.cz;
      s.r = S.r;
      s.mv = S.mv;
      s.kb = S.kb;
      s.knockdown = true;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      return;
    }
    e.armored = false;
    e.setState('recover');
    return;
  }
  e.pose('slam');
  if (e.after(S.recover)) endMove(e);
}

/** Hammer Sweep: the circle round him. @param {Enemy} e @param {CombatContext} ctx */
function sweep(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.sweep;
  if (e.state === 'windup') {
    const dur = W(e, S.windup);
    e.pose('sweepWind');
    const m = e.markerSpec('circle', p.x, p.z);
    m.r = S.r;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('sweep');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('swingHeavy', p.x, p.z, { pitch: 0.8 });
      ctx.fx('spin', p.x, p.y, p.z, { color: [0.6, 0.85, 1.15], scale: 1.0 });
    }
    if (e.after(S.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.r = S.r;
    s.mv = S.mv;
    s.kb = S.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose('sweep');
  if (e.after(S.recover)) endMove(e);
}

/**
 * Rime Lane (phase ≥ 2): the lane tracked, locked 12 f before; the hammer struck into the ground;
 * ice spikes race along it at 26 u/s (one hit per target).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function lane(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.lane;
  if (e.state === 'windup') {
    const dur = W(e, S.windup);
    e.pose('pealWind');
    if (e.t < F(dur - S.lock) - EPS || ai.len === 0) {
      turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 3);
      ai.len = Math.max(2, e.freeRun(e.facing.x, e.facing.z, S.len, ctx, inset(e, 0.4)));
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.style = 'crack';
    m.len = ai.len;
    m.width = S.width;
    m.progress = Math.min(1, e.t / F(dur));
    m.flash = e.lockFlash(e.t - F(dur - S.lock));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.cx = p.x;
      ai.cz = p.z;
      ai.front = 0;
      ai.spikes = 0;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      ctx.sfx('hammerHit', p.x, p.z, { pitch: 0.7 });
      ctx.sfx('iceCrack', p.x, p.z);
      ctx.shake(0.2, 0.4);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('plant');
    ai.front = Math.min(ai.len, ai.front + S.speed * h);
    // the spikes as the front passes
    while (ai.spikes * S.every <= ai.front - 0.4) {
      const d = ai.spikes * S.every + 0.6;
      const x = ai.cx + ai.lx * d;
      const z = ai.cz + ai.lz * d;
      const gy = ctx.groundAt(x, z);
      ctx.fx('evkSpike', x, gy, z, { mode: 'billboard', lift: 0.75, color: FX_TINTS.evkSpike, loops: 1, fps: 8 });
      if (ai.spikes % 2 === 0) ctx.burst('evkRime', x, gy + 0.4, z, 3);
      ai.spikes++;
    }
    const s = e.hitSpec();
    s.shape = 'lane';
    s.x = ai.cx;
    s.z = ai.cz;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.len = Math.max(0.5, ai.front);
    s.width = S.width;
    s.mv = S.mv;
    s.kb = S.kb;
    s.knockdown = true;
    s.fromX = ai.cx;
    s.fromZ = ai.cz;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (ai.front >= ai.len - EPS) {
      e.markToFade(0, ctx, F(18));
      e.setState('recover');
    }
    return;
  }
  e.pose('plant');
  if (e.after(S.recover)) endMove(e);
}

/**
 * Black Carillon (phase 3): super armour, the hammer overhead; four bells drop round him 12 f apart
 * (each spot's circle filling from the move's start), the chord rolls out of him, then he kneels —
 * stunned 4 s, the crown exposed.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function carillon(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const S = T.carillon;
  const wind = W(e, S.windup);
  const total = wind + S.drop * 3 + S.chordAt;
  if (e.state === 'windup') {
    e.armored = true;
    e.pose('raise');
    if (e.entered) {
      // the four spots round him (a square turned to his facing), inside the arena
      const base = Math.atan2(e.facing.z, e.facing.x) + Math.PI / 4;
      const r = inset(e, 1.2);
      ai.car = [];
      for (let k = 0; k < 4; k++) {
        const a = base + (k * Math.PI) / 2;
        let x = p.x + Math.cos(a) * 3.2;
        let z = p.z + Math.sin(a) * 3.2;
        if (r) {
          x = Math.min(r.maxX, Math.max(r.minX, x));
          z = Math.min(r.maxZ, Math.max(r.minZ, z));
        }
        ai.car.push([x, z]);
        const hz = e.hazardCircle(x, z, S.bellR, F(wind + S.drop * k));
        hz.mv = S.bellMv;
        hz.kb = S.bellKb;
        hz.burst = 'evkAsh';
        hz.burstN = 6;
      }
      ctx.sfx('bellTollBlack', p.x, p.z, { volume: 0.8, pitch: 0.9 });
    }
    const m = e.markerSpec('circle', p.x, p.z);
    m.r = S.rMax;
    m.progress = Math.min(1, e.t / F(total));
    e.mark(0, ctx, m);
    if (e.after(wind)) {
      ai.carK = 0;
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    e.pose('raise');
    const m = e.markerSpec('circle', p.x, p.z);
    m.r = S.rMax;
    m.progress = Math.min(1, (F(wind) + e.t) / F(total));
    e.mark(0, ctx, m);
    while (ai.carK < 4 && e.t >= F(S.drop * ai.carK) - EPS) {
      const [x, z] = ai.car[ai.carK] ?? [p.x, p.z];
      const gy = ctx.groundAt(x, z);
      ctx.fx('evkBellDrop', x, gy, z, { mode: 'billboard', lift: 1.25, color: FX_TINTS.evkBellDrop, loops: 1 });
      ai.bells.push({ x, z, t: 0, life: F(S.drop * (3 - ai.carK) + S.chordAt + S.kneel) - 0.6, rung: 0, shown: false, toll: false, at: { x, y: gy, z } });
      ctx.sfx('carillon', x, z, { pitch: CARILLON_NOTES[ai.carK] });
      ai.carK++;
    }
    if (e.t >= F(S.drop * 3 + S.chordAt) - EPS) {
      // the chord
      e.unmark(0, ctx);
      const hz = e.hazardRing(p.x, p.z, 0.5, S.rMax, S.speed, S.width);
      hz.mv = S.mv;
      hz.kb = S.kb;
      hz.knockdown = true;
      ctx.sfx('carillon', p.x, p.z, { pitch: 0.75 });
      ctx.sfx('bellTollBlack', p.x, p.z, { pitch: 0.6 });
      ctx.shake(0.5, 0.6);
      const gy = ctx.groundAt(p.x, p.z);
      ctx.fx('evkRing', p.x, gy, p.z, { mode: 'flat', lift: 0.06, color: FX_TINTS.evkRing, loops: 1, scale: 3.2 });
      for (const [x, z] of ai.car) {
        ctx.fx('evkRing', x, ctx.groundAt(x, z), z, { mode: 'flat', lift: 0.06, color: FX_TINTS.evkRing, loops: 1, scale: 1.3 });
        ctx.burst('evkRime', x, ctx.groundAt(x, z) + 0.5, z, 6);
      }
      e.armored = false;
      ai.move = null;
      e.setState('kneel');
    }
    return;
  }
  endMove(e);
}

/**
 * Phase 3: he rings the Hush Bell himself — he turns to it, raises the hammer and strikes; its
 * three beats are the warning (HushToll).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function ringHushBell(e, h, ctx) {
  const toll = tollOf(ctx);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, T.ring.windup);
    if (toll) {
      const [mx, , mz] = toll.mouth;
      turnToward(e, mx, mz, h, 3);
    }
    e.pose('raise');
    if (e.after(dur)) {
      if (toll) toll.start();
      ctx.sfx('hammerHit', p.x, p.z, { pitch: 0.65 });
      ctx.burst('evkRime', p.x, p.y + 3.2, p.z, 8);
      e.setState('recover');
    }
    return;
  }
  e.pose('pealWind');
  if (e.after(T.ring.recover)) endMove(e, F(20));
}

// -------------------------------------------------------------------------------------------------
// the court, the bells, the release
// -------------------------------------------------------------------------------------------------

/**
 * Phase 2's court (`KING_TUNING.adds`): at the arena's north corners and its north middle (by the
 * Hush Bell), each its own sound of frost. A kind the pool lacks is skipped (`spawnAdd` → null).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function spawnAdds(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  const a = e.arena;
  const p = e.position;
  const r = a ? a.rect : { minX: p.x - 7, maxX: p.x + 7, minZ: p.z - 6, maxZ: p.z + 6 };
  const cx = (r.minX + r.maxX) / 2;
  const spots = [[r.minX + 2.5, r.minZ + 2.5], [r.maxX - 2.5, r.minZ + 2.5], [cx, r.minZ + 2], [cx - 3, r.minZ + 3], [cx + 3, r.minZ + 3]];
  let k = 0;
  for (const { kind, count } of T.adds) {
    for (let i = 0; i < count; i++) {
      const [x, z] = spots[k++ % spots.length];
      const add = ctx.spawnAdd(kind, x, z, 10);
      if (!add) continue;
      if (!ai.adds.includes(add)) ai.adds.push(add);
      const gy = ctx.groundAt(x, z);
      ctx.burst('evkSmoke', x, gy + 0.8, z, 6);
      ctx.burst('evkRime', x, gy + 1, z, 6);
    }
  }
  ctx.sfx('iceBreak', p.x, p.z, { volume: 0.8 });
}

/**
 * The black bells' look: the planted bell stands (after its 0.2 s drop) and swings, a dark ring
 * and frost ash at each toll; the Carillon's stand until he rises.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function blackBells(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  if (!ai.bells.length) return;
  const S = T.toll;
  for (const b of ai.bells) {
    if (b.t >= b.life) continue;
    b.t += h;
    const gy = ctx.groundAt(b.x, b.z);
    if (!b.shown && b.t >= 0.2) {
      b.shown = true;
      ctx.fx('evkBell', b.x, gy, b.z, { mode: 'billboard', lift: 0.75, color: FX_TINTS.evkBell, loop: true, duration: Math.max(0.1, b.life - 0.2), follow: b.at });
    }
    if (b.toll) {
      while (b.rung < S.rings && b.t >= F(S.first + S.every * b.rung) - EPS) {
        b.rung++;
        ctx.fx('evkRing', b.x, gy, b.z, { mode: 'flat', lift: 0.06, color: FX_TINTS.evkRing, loops: 1, scale: S.r / (22 / 16) });
        ctx.fx('evkBell', b.x, gy, b.z, { mode: 'billboard', lift: 0.78, color: [0.75, 1.05, 1.45], loops: 1, fps: 6, scale: 1.02 });
        ctx.sfx('tollBell', b.x, b.z, { pitch: 0.6 });
      }
    }
    if (b.t >= b.life) ctx.burst('evkSmoke', b.x, gy + 0.6, b.z, 5);
  }
  if (ai.bells.every((b) => b.t >= b.life)) ai.bells.length = 0;
}

/**
 * The release: the crown shatters now (a burst at the crown, splinters, glints, `crownShatter`);
 * the Hush Bell falls silent.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function release(e, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  if (ctx && e.alive) cancelMove(e, ctx);
  ai.released = true;
  // the black bells fall silent with the crown (§2.6.7's written silence): no ring, no toll; their
  // standing sprites sink out of sight at once (they follow `at`)
  for (const b of ai.bells) {
    b.toll = false;
    b.life = Math.min(b.life, b.t);
    b.at.y = -1e4;
  }
  ai.relT = 0;
  ai.relGlints = 0;
  e.lift = 0;
  e.guarded = true;
  e.pose('crownBreak');
  if (!ctx) return;
  const p = e.position;
  const cy = p.y + 2.05;
  ctx.fx('evkBurst', p.x, p.y, p.z, { mode: 'billboard', lift: 2.05, color: FX_TINTS.evkBurst, loops: 1, scale: 1.3 });
  ctx.burst('evkSplinter', p.x, cy, p.z, 20);
  ctx.burst('evkGlint', p.x, cy, p.z, 10);
  ctx.burst('evkRime', p.x, cy, p.z, 12);
  ctx.sfx('crownShatter', p.x, p.z, { volume: 1 });
  ctx.shake(0.3, 0.45);
  tollOf(ctx)?.silence();
}

/**
 * The released body: the struck pose for `KING_TUNING.bare` frames, then kneeling uncrowned —
 * never faded; the crown's last glints drift for 2 s.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function releasedStep(e, h, ctx) {
  const ai = /** @type {KingAI} */ (e.ai);
  ai.relT += h;
  e.lift = 0;
  e.sprite.opacity = 1;
  e.pose(ai.relT < F(T.bare) - EPS ? 'crownBreak' : 'kneelBare');
  if (ctx && ai.relGlints < 4 && ai.relT >= 0.5 * (ai.relGlints + 1)) {
    ai.relGlints++;
    const p = e.position;
    ctx.burst('evkGlint', p.x, p.y + 1.6, p.z, 3);
  }
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

/**
 * Turn the facing toward a point at the phase's turn rate (index 3 = at once).
 * @param {Enemy} e @param {number} x @param {number} z @param {number} h @param {number} rateIndex
 */
function turnToward(e, x, z, h, rateIndex) {
  const ai = /** @type {KingAI} */ (e.ai);
  const p = e.position;
  const want = Math.atan2(x - p.x, z - p.z);
  ai.yaw = Math.atan2(e.facing.x, e.facing.z);
  let d = want - ai.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const max = rateIndex >= 3 ? Math.PI : TURN[Math.max(0, rateIndex)] * h;
  ai.yaw += Math.max(-max, Math.min(max, d));
  e.faceDir(Math.sin(ai.yaw), Math.cos(ai.yaw));
}

/** The arena rect inset by `m` (reused object), or null without an arena. @param {Enemy} e @param {number} m */
function inset(e, m) {
  const a = e.arena;
  if (!a) return null;
  const ai = /** @type {KingAI} */ (e.ai);
  const r = ai.inset ?? (ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  r.minX = a.rect.minX + m;
  r.maxX = a.rect.maxX - m;
  r.minZ = a.rect.minZ + m;
  r.maxZ = a.rect.maxZ - m;
  return r;
}

/**
 * Register the Hushed King's sheet, FX frames, presets and brain (his stats: ./defsKing.js).
 * @param {EnemyPackApi} api
 */
export function register(api) {
  api.registerMonsterKind('hushedking', paintKing);
  api.registerFxModule(evKingFx);
  api.registerPresets(KING_PRESETS);
  api.registerBrain('hushedking', KING);
}

