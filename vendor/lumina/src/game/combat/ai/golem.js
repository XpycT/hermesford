/**
 * Cinderheart — the boss (COMBAT.md §8). This brain drives every state of the golem itself
 * (`update`); the Enemy supplies timers, flash / glow writing, markers, hazards and movement.
 *
 * Division of work (§8.1, binding): the brain owns the boss's own behaviour — state, poses, glow,
 * markers, hitboxes, projectiles, adds (`ctx.spawnAdd`), its move shakes / SFX / FX, `guarded`,
 * `armored`, `exposed`, `vuln` — and only **signals** global moments with `ctx.emit('bossIntro',
 * e)` (intro f0), `ctx.emit('bossAwake', e)` (intro f60) and `ctx.emit('bossPhase', e, n)` (start
 * of each transition). Core applies arena close / open, `locksPlayer`, hit-stop, music, banner,
 * boss bar, emitters, look pulses, loot and the HP clamps (`e.hpFloor` states the floor: the next
 * phase threshold, and during the phase-3 kneel the 8 % damage cap).
 *
 * States: `dormant` (kneeling, guarded, until the player stands inside `e.arena.rect` with
 * |y − arena.y| < 1) → `intro` (108 f, guarded) → `engage` (move selection, 54–84 f between moves,
 * phase 3 36–60 f) ⇄ `windup` / `active` / `recover` (the move; `recover` is its punish window).
 * When no move is legal (e.g. two slams in a row with the player waiting 3–7 u away) the boss
 * closes in — within 3 u a Sweep becomes possible — and after 90 f without a legal move the
 * no-three-in-a-row rule is waived, so it never idles in place;
 * interrupts `phase` (transition roar, guarded), `kneel` (phase-3 exposed core, 90 f), `stagger`
 * (Broken: poise 250 per phase spent, 180 f, vuln 1.3, exposed), `stun` (a charge into a brazier:
 * 120 f, vuln 1.5, exposed); `dead` (Enemy.die: ember flash 6 f, 90 f fade).
 *
 * Moves (§8.2; phase-3 wind-ups × 0.75 rounded up, never below 18 f):
 * - Hammer Slam (d ≤ 4.5, approaches to ≤ 3.0): 60 f `slamWind`, circle r 2.6 centred 1.6 u ahead;
 *   6 f hit (mv 1.5, kb 2.5, knockdown), shake 0.45/0.5, `dust`; punish 60 f (`slam`). Phase ≥ 2
 *   leaves a magma pool (r 2.0, 240 f, flat 6 every 30 f); phase 3 turns it into the Shockwave
 *   Slam: 3 rings 18 f apart expanding at 6 u/s to r 10, 0.6 wide, `thin` (mv 1.2, kb 1.5).
 * - Sweep (the player > 70° off the facing within 3.2 u for 60 f cumulative, or 20 % at d ≤ 3):
 *   48 f `sweepWind`, circle r 2.6 around the boss; 6 f hit (mv 1.0, kb 3.0); punish 36 f.
 * - Rock Toss (d > 7): 36 f `throw`; 3 landing circles r 1.4 (the player predicted 0.5 s ahead,
 *   ±2.5 u lateral) filling 72 f while 3 `boulder` arc projectiles fly there (mv 1.1, kb 1.5);
 *   punish 48 f.
 * - Ember Rain (phase ≥ 2): 30 f `roar`; 6 circles (phase 3: 10) r 1.2, the first on the player,
 *   the others seeded within 4 u of it (inside the arena), staggered 15 f, each filling 66 f
 *   (mv 1.2, kb 1.0, `emberBurst` 10); a 90 f hittable channel.
 * - Charge (phase ≥ 2, d ≥ 5): 54 f `slamWind`, lane 1.8 wide over the boss's free run (to a
 *   brazier or the arena rect inset 1), tracking 42 f, locked 12 f; 12 u/s, circle r 1.4 ahead
 *   (mv 1.5, kb 3.0, knockdown), armoured; into a brazier (`blockedBy === 'collider'`) → stun
 *   120 f, shake 0.35/0.45; at the arena edge → 45 f skid (open, no vuln).
 *
 * Phases (§8.3): 70 % → phase 2 (roar 120 f guarded, shake 0.45/1.2, a push ring r 0.5 → 5 at f60
 * (kb 3.0, mv 0), glow ramps to 2.0 over 60 f with tint (1.0, 0.9, 0.85), 3 bat adds at the arena
 * corners farthest from the player; at ≤ 52 % once more 3 adds if fewer than 2 are alive);
 * 35 % → phase 3 (kneel 90 f exposed, then a guarded roar 60 f; glow 2.4 ↔ 3.4 at 2 Hz).
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { BossMove, CombatContext, Brain, RectXZ } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

const INTRO_F = 108;
const AWAKE_F = 60;
const RISE_F = 36;
const P2_ROAR_F = 120;
const P2_RING_F = 60;
const KNEEL_F = 90;
const P3_ROAR_F = 60;
const BROKEN_F = 180;
const STUN_F = 120;
const SKID_F = 45;
const GAP_F = [[54, 84], [54, 84], [36, 60]];
const TURN = [150 * DEG, 170 * DEG, 190 * DEG];
const GLOW = [1.0, 0.45, 0.15];

const SLAM = { windup: 60, active: 6, recover: 60, r: 2.6, ahead: 1.6, mv: 1.5, kb: 2.5, range: 4.5, near: 3.0 };
const SWEEP = { windup: 48, active: 6, recover: 36, r: 2.6, mv: 1.0, kb: 3.0 };
const TOSS = { windup: 36, recover: 48, r: 1.4, fill: 72, lead: 0.5, lateral: 2.5, mv: 1.1, kb: 1.5, apex: 3.5 };
const RAIN = { windup: 30, channel: 90, n: 6, n3: 10, r: 1.2, every: 15, fill: 66, spread: 4, mv: 1.2, kb: 1.0 };
const CHARGE = { windup: 54, lock: 12, speed: 12, width: 1.8, r: 1.4, mv: 1.5, kb: 3.0, max: 40 };
const MAGMA = { r: 2.0, dur: 240, flat: 6, tick: 30 };
const SHOCK = { rings: 3, every: 18, speed: 6, rMax: 10, width: 0.6, mv: 1.2, kb: 1.5 };
/** Move cooldowns (f), started when a move begins. */
const COOLDOWN = { slam: 0, sweep: 120, toss: 180, rain: 420, charge: 300 };
/** Default phase thresholds (defs.js `phases`) and the weighted moves in pick order. */
const PHASES = [0.7, 0.35];
/** @type {BossMove[]} */
const WEIGHTED = ['slam', 'toss', 'rain', 'charge'];
const ADD_KIND = 'bat';
/** Frames without a legal move before the no-three-in-a-row rule is waived. */
const STALL_F = 90;
/** While no move is legal the boss walks in to this distance (Sweep range is 3). */
const STALL_NEAR = 2.2;
const ADD_LEVEL = 5;

/**
 * The brain state (`e.ai`): init()'s fields, plus chooseMove's `weights` (made on first use).
 * @typedef GolemAI
 * @type {Required<ReturnType<typeof golem.init>>
 *   & { weights?: { slam: number, toss: number, rain: number, charge: number } }}
 */

/** @satisfies {Brain} */
export const golem = {
  init(e) {
    return {
      yaw: Math.atan2(e.facing.x, e.facing.z),
      move: null,
      pending: null, approachT: 0,
      last1: null, last2: null,
      gap: F(40),
      cd: { slam: 0, sweep: 0, toss: 0, rain: 0, charge: 0 },
      offT: 0,
      stall: 0,
      cx: 0, cz: 0, tag: 0,
      lx: 0, lz: 1, len: 0, end: 'max', run: 0, done: 0, skid: false,
      trans: 0, phaseT: 0, capFloor: 0, ringDone: false, awoke: false,
      adds: [], wave2: false,
      clock: 0,
      inset: null,
    };
  },

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {GolemAI} */ (e.ai);
    ai.clock += h;
    ai.phaseT += h;
    for (const k in ai.cd) if (ai.cd[k] > 0) ai.cd[k] -= h;

    const phases = e.def.phases ?? PHASES;
    const p2 = phases[0];
    const p3 = phases[1];
    const fighting = e.state !== 'dormant' && e.state !== 'intro';
    if (fighting) {
      if (e.state !== 'phase' && e.state !== 'kneel') {
        if (e.phase === 1 && e.hp <= e.hpMax * p2 + EPS) startPhase(e, 2, ctx);
        else if (e.phase === 2 && e.hp <= e.hpMax * p3 + EPS) startPhase(e, 3, ctx);
      }
      // the second wave (once): ≤ 52 % HP with fewer than 2 adds alive — only while it fights
      // (not during a roar, the exposed-core kneel, Broken or a stun: those are the player's)
      const busy = e.state === 'phase' || e.state === 'kneel' || e.state === 'stagger' || e.state === 'stun';
      if (e.phase >= 2 && !ai.wave2 && !busy && e.hp <= e.hpMax * 0.52 + EPS && aliveAdds(ai) < 2) {
        ai.wave2 = true;
        spawnAdds(e, ctx);
      }
    }
    // a state entered in this sub-step runs its frame 0 at once (like Enemy's own dispatch)
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    e.hpFloor = e.state === 'kneel' ? ai.capFloor
      : e.phase === 1 ? e.hpMax * p2 : e.phase === 2 ? e.hpMax * p3 : 0;
  },

  /**
   * Boss poise (§8.3): 250 per phase, spent by player hits outside transitions → Broken.
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
    e.pose('kneel');
    ctx.sfx('stun', e.position.x, e.position.z);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    cancelMove(e, ctx);
  },

  /** @type {Brain['die']} */
  die(e) {
    /** @type {GolemAI} */ (e.ai).move = null;
    /** @type {GolemAI} */ (e.ai).pending = null;
    e.sprite.tint.setRGB(1, 1, 1);
  },

  /**
   * Test hook `combat.boss.force(move)` (COMBAT-05): only `move` may be picked next, at once — the
   * other moves' cooldowns are set to 99 s, the gap, a pending approach, the Sweep build-up and the
   * stall counter are cleared; `null`: no move may be picked.
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {GolemAI} */ (e.ai);
    for (const k in ai.cd) ai.cd[k] = k === move ? 0 : 99;
    ai.gap = 0;
    ai.pending = null;
    ai.approachT = 0;
    ai.offT = 0;
    ai.stall = 0;
  },

  /**
   * Test hook `combat.boss.info()`: the move in progress, a pending approach, the charge skid.
   * @type {Brain['info']}
   */
  info(e) {
    const ai = /** @type {GolemAI} */ (e.ai);
    return { move: ai.move, pending: ai.pending, skid: ai.skid };
  },

  /**
   * Jump straight to a phase (test hook `bossPhase(n)`): no transition, signals `bossPhase`.
   * @type {Brain['jumpPhase']}
   */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {GolemAI} */ (e.ai);
    n = Math.max(1, Math.min(3, n | 0));
    cancelMove(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    ai.trans = 0;
    e.sprite.tint.setRGB(1, n >= 2 ? 0.9 : 1, n >= 2 ? 0.85 : 1);
    if (e.state !== 'dormant' && e.state !== 'intro') {
      e.guarded = false;
      e.setState('engage');
      ai.gap = F(30);
    }
    ctx.emit('bossPhase', e, n);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {GolemAI} */ (e.ai);
    let a;
    if (!e.alive) a = 0;
    else if (e.state === 'dormant') a = 0.4;
    else if (e.state === 'intro') a = 0.4 + 0.2 * Math.min(1, Math.max(0, (e.t - F(AWAKE_F)) / F(INTRO_F - AWAKE_F)));
    else if (e.phase === 1) a = 0.6;
    else if (e.phase === 2) a = 0.6 + 1.4 * Math.min(1, ai.phaseT / F(60));
    else a = 2.4 + 0.5 * (1 - Math.cos(2 * Math.PI * 2 * ai.clock));
    // wind-ups: the cracks flare at 8 Hz (the tint is kept faint on this dark sheet, so the
    // slamWind / sweepWind / throw pose stays readable; the ground marker is the main telegraph)
    if (e.alive && e.state === 'windup') a += 0.5 + 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 8 * e.t));
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = a;
  },
};

// -------------------------------------------------------------------------------------------------
// states
// -------------------------------------------------------------------------------------------------

/**
 * One pass of the state dispatch (`update` repeats it for a state entered in this sub-step).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
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
      if (e.after(BROKEN_F)) {
        e.poise = e.poiseMax;
        e.vuln = 1;
        e.exposed = false;
        endMove(e);
      }
      break;
    case 'stun':
      e.pose('kneel');
      if (e.after(STUN_F)) {
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
 * Kneeling, guarded, until the player stands inside the arena (no arena: within 10 u).
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  e.guarded = true;
  e.aggro = false;
  e.pose('kneel');
  const P = ctx.player;
  if (!P.alive) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 10;
  if (inside) e.setState('intro');
}

/**
 * The 108 f intro: `bossIntro` at f0, rise, the roar and `bossAwake` at f60.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function intro(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.aggro = true;
  if (e.entered) {
    ai.awoke = false;
    ctx.emit('bossIntro', e);
  }
  const P = ctx.player.position;
  if (e.fr < RISE_F) e.pose('kneel');
  else if (e.fr < AWAKE_F) {
    turnToward(e, P.x, P.z, 1 / 60, 3);
    e.pose('idle0');
  } else {
    if (!ai.awoke) {
      ai.awoke = true;
      ctx.sfx('bossRoar', p.x, p.z);
      ctx.shake(0.25, 0.6);
      ctx.emit('bossAwake', e);
    }
    e.pose('roar');
  }
  if (e.after(INTRO_F)) {
    e.guarded = false;
    ai.gap = F(40);
    e.setState('engage');
  }
}

/**
 * Turn toward the player, build up a Sweep, pick moves (a pending Slam approaches first).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const P = ctx.player;
  const tp = e.tp;
  e.guarded = false;
  if (!P.alive) {
    e.anim('idle');
    return;
  }
  turnToward(e, P.position.x, P.position.z, h, e.phase - 1);
  // the player lingering beside / behind it builds up a Sweep
  if (tp.d <= 3.2 && e.facing.x * tp.dx + e.facing.z * tp.dz < Math.cos(70 * DEG)) ai.offT += h;
  ai.gap -= h;
  const speed = e.def.phaseSpeeds?.[e.phase - 1] ?? e.def.speed;
  if (ai.pending) {
    ai.approachT += h;
    if (tp.d <= SLAM.near + EPS) {
      const m = ai.pending;
      ai.pending = null;
      startMove(e, m, ctx);
      return;
    }
    if (ai.approachT > F(120)) ai.pending = null;
    else {
      e.walk(e.facing.x, e.facing.z, speed, h, ctx, 'walk', false);
      return;
    }
  }
  let stalled = false;
  if (ai.gap <= 0) {
    const m = chooseMove(e);
    if (m === 'slam' && tp.d > SLAM.near + EPS) {
      ai.pending = 'slam';
      ai.approachT = 0;
    } else if (m) {
      startMove(e, m, ctx);
      return;
    } else {
      // nothing legal right now: close in (a Sweep needs d ≤ 3) and count toward the waiver
      ai.stall += h;
      stalled = true;
    }
  }
  if (tp.d > 4 || ai.pending || (stalled && tp.d > STALL_NEAR)) e.walk(e.facing.x, e.facing.z, speed, h, ctx, 'walk', false);
  else e.anim('idle');
}

/**
 * The guarded transition roar (phase 2: the push ring and the adds at f60; phase 3: 60 f).
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function phase(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.pose('roar');
  if (ai.trans === 2) {
    if (e.entered) {
      ctx.sfx('bossRoar', p.x, p.z);
      ctx.shake(0.45, 1.2);
      ai.ringDone = false;
    }
    if (e.fr >= P2_RING_F && !ai.ringDone) {
      ai.ringDone = true;
      // a push, not a hit: mv 0 (no damage), kb 3.0
      const hz = e.hazardRing(p.x, p.z, 0.5, 5, 9, 0.8);
      hz.thin = false;
      hz.mv = 0;
      hz.kb = 3.0;
      spawnAdds(e, ctx);
    }
    if (e.after(P2_ROAR_F)) {
      e.guarded = false;
      ai.trans = 0;
      endMove(e, F(30));
    }
    return;
  }
  // phase 3: the guarded roar after the kneel
  if (e.entered) {
    ctx.sfx('bossRoar', p.x, p.z);
    ctx.shake(0.3, 0.6);
  }
  if (e.after(P3_ROAR_F)) {
    e.guarded = false;
    ai.trans = 0;
    endMove(e, F(24));
  }
}

/**
 * The phase-3 kneel: exposed for 90 f, then the phase-3 roar.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function kneel(e, ctx) {
  e.guarded = false;
  e.exposed = true;
  e.pose('kneel');
  if (e.after(KNEEL_F)) {
    e.exposed = false;
    /** @type {GolemAI} */ (e.ai).trans = 3;
    e.setState('phase');
  }
}

/**
 * Start the transition to phase `n` (2: the roar; 3: the kneel) and signal `bossPhase`.
 * @param {Enemy} e
 * @param {number} n
 * @param {CombatContext} ctx
 */
function startPhase(e, n, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  cancelMove(e, ctx);
  e.phase = n;
  e.poise = e.poiseMax;
  ai.phaseT = 0;
  ctx.emit('bossPhase', e, n);
  if (n === 2) {
    ai.trans = 2;
    e.sprite.tint.setRGB(1.0, 0.9, 0.85);
    e.guarded = true;
    e.setState('phase');
  } else {
    ai.trans = 3;
    ai.capFloor = Math.max(0, e.hp - 0.08 * e.hpMax);
    e.guarded = false;
    e.exposed = true;
    e.setState('kneel');
    ctx.sfx('stun', e.position.x, e.position.z);
  }
}

// -------------------------------------------------------------------------------------------------
// moves
// -------------------------------------------------------------------------------------------------

/**
 * Wind-up length in the current phase (phase 3 × 0.75 rounded up, ≥ 18 f).
 * @param {Enemy} e
 * @param {number} n frames
 * @returns {number}
 */
function W(e, n) {
  return e.phase === 3 ? Math.max(18, Math.ceil(n * 0.75)) : n;
}

/**
 * Seeded, distance-weighted pick; cooldowns; never the same move 3 times in a row — unless no
 * move has been legal for STALL_F frames (then the repeat is allowed rather than idling).
 * @param {Enemy} e
 * @returns {BossMove|null}
 */
function chooseMove(e) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const d = e.tp.d;
  const ph = e.phase;
  const waive = ai.stall >= F(STALL_F) - EPS;
  /** @type {(m: BossMove) => boolean} off cooldown and not a third time in a row */
  const ok = (m) => ai.cd[m] <= 0 && (waive || !(ai.last1 === m && ai.last2 === m));
  if (ai.offT >= F(60) - EPS && ok('sweep')) return 'sweep';
  if (d <= 3 && ok('sweep') && e.rng.chance(0.2)) return 'sweep';
  const w = ai.weights ?? (ai.weights = { slam: 0, toss: 0, rain: 0, charge: 0 });
  w.slam = d <= SLAM.range && ok('slam') ? (d <= SLAM.near ? 4 : 3) : 0;
  w.toss = d > 7 && ok('toss') ? 3 : 0;
  w.rain = ph >= 2 && ok('rain') ? 1.5 : 0;
  w.charge = ph >= 2 && d >= 5 && ok('charge') ? 2.5 : 0;
  const total = w.slam + w.toss + w.rain + w.charge;
  if (total <= 0) return null;
  let r = e.rng.next() * total;
  for (const m of WEIGHTED) {
    r -= w[m];
    if (r < 0 && w[m] > 0) return m;
  }
  return w.charge > 0 ? 'charge' : w.rain > 0 ? 'rain' : w.toss > 0 ? 'toss' : 'slam';
}

/**
 * Begin move `m`: its cooldown, the no-three-in-a-row history, the wind-up.
 * @param {Enemy} e
 * @param {BossMove} m
 * @param {CombatContext} ctx
 */
function startMove(e, m, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  ai.move = m;
  ai.last2 = ai.last1;
  ai.last1 = m;
  ai.cd[m] = F(COOLDOWN[m]);
  ai.stall = 0;
  if (m === 'sweep') ai.offT = 0;
  ai.len = 0;
  ai.skid = false;
  e.setState('windup');
  if (e.entered) ctx.sfx('windup', e.position.x, e.position.z);
}

/**
 * The move is over: back to `engage` after `gap` s (default: the phase's seeded gap).
 * @param {Enemy} e
 * @param {number} [gap]
 */
function endMove(e, gap) {
  const ai = /** @type {GolemAI} */ (e.ai);
  ai.move = null;
  ai.skid = false;
  e.armored = false;
  const g = GAP_F[e.phase - 1] ?? GAP_F[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/**
 * Drop the move in progress (interrupts, phases, death): markers, armour, vulnerability.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function cancelMove(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  e.unmarkAll(ctx);
  ai.move = null;
  ai.pending = null;
  ai.skid = false;
  e.armored = false;
  e.vuln = 1;
  e.exposed = false;
}

/**
 * States `windup` / `active` / `recover`: the current move's timeline.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function attack(e, h, ctx) {
  switch (e.ai.move) {
    case 'slam': slam(e, h, ctx); break;
    case 'sweep': sweep(e, ctx); break;
    case 'toss': toss(e, h, ctx); break;
    case 'rain': rain(e, ctx); break;
    case 'charge': charge(e, h, ctx); break;
    default: endMove(e);
  }
}

/**
 * Hammer Slam (phase 2: + a magma pool; phase 3: + the shockwave rings).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function slam(e, h, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, SLAM.windup);
    if (e.entered) {
      ai.cx = p.x + e.facing.x * SLAM.ahead;
      ai.cz = p.z + e.facing.z * SLAM.ahead;
    }
    e.pose('slamWind');
    const m = e.markerSpec('circle', ai.cx, ai.cz);
    m.r = SLAM.r;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('slam');
    if (e.entered) {
      const gy = ctx.groundAt(ai.cx, ai.cz);
      e.markProgress(0, ctx, 1);
      ctx.shake(0.45, 0.5);
      ctx.sfx('slam', ai.cx, ai.cz);
      ctx.fx('dust', ai.cx, gy, ai.cz);
    }
    if (e.after(SLAM.active)) {
      e.unmark(0, ctx);
      if (e.phase >= 2) {
        e.hazardMagma(ai.cx, ai.cz, MAGMA.r, F(MAGMA.dur), MAGMA.flat, F(MAGMA.tick));
      }
      if (e.phase === 3) {
        for (let i = 0; i < SHOCK.rings; i++) {
          const hz = e.hazardRing(ai.cx, ai.cz, SHOCK.width, SHOCK.rMax, SHOCK.speed, SHOCK.width, F(i * SHOCK.every));
          hz.mv = SHOCK.mv;
          hz.kb = SHOCK.kb;
        }
      }
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = ai.cx;
    s.z = ai.cz;
    s.r = SLAM.r;
    s.mv = SLAM.mv;
    s.kb = SLAM.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose('slam');
  if (e.after(SLAM.recover)) endMove(e);
}

/**
 * Sweep: the circle around the boss.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function sweep(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, SWEEP.windup);
    e.pose('sweepWind');
    const m = e.markerSpec('circle', p.x, p.z);
    m.r = SWEEP.r;
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
      ctx.sfx('swingHeavy', p.x, p.z);
    }
    if (e.after(SWEEP.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.r = SWEEP.r;
    s.mv = SWEEP.mv;
    s.kb = SWEEP.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose('sweep');
  if (e.after(SWEEP.recover)) endMove(e);
}

/**
 * Rock Toss: the throw wind-up, then `throwRocks`.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function toss(e, h, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player;
  if (e.state === 'windup') {
    const dur = W(e, TOSS.windup);
    turnToward(e, P.position.x, P.position.z, h, 2);
    e.pose('throw');
    if (e.after(dur)) {
      throwRocks(e, ctx);
      e.setState('recover');
    }
    return;
  }
  e.pose('throw');
  if (e.after(TOSS.recover)) endMove(e);
}

/**
 * 3 landing circles (their fill is the telegraph) and 3 boulders landing at progress 1.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function throwRocks(e, ctx) {
  const p = e.position;
  const P = ctx.player;
  const px = P.position.x + P.velocity.x * TOSS.lead;
  const pz = P.position.z + P.velocity.z * TOSS.lead;
  let dx = px - p.x;
  let dz = pz - p.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const rect = inset(e, TOSS.r);
  const time = F(TOSS.fill);
  for (let k = -1; k <= 1; k++) {
    let tx = px - dz * TOSS.lateral * k;
    let tz = pz + dx * TOSS.lateral * k;
    if (rect) {
      tx = Math.min(rect.maxX, Math.max(rect.minX, tx));
      tz = Math.min(rect.maxZ, Math.max(rect.minZ, tz));
    }
    e.hazardVisual(tx, tz, TOSS.r, time);
    const ps = e.projSpec();
    const dist = Math.hypot(tx - p.x, tz - p.z);
    ps.kind = 'boulder';
    ps.y = p.y + 3.2;
    ps.dirX = dist > 1e-4 ? (tx - p.x) / dist : e.facing.x;
    ps.dirZ = dist > 1e-4 ? (tz - p.z) / dist : e.facing.z;
    ps.speed = dist / time;
    ps.range = dist;
    ps.radius = TOSS.r;
    ps.mv = TOSS.mv;
    ps.kb = TOSS.kb;
    ps.arc = { tx, tz, time, apex: TOSS.apex };
    ctx.projectile(e, ps);
  }
  ctx.sfx('rockToss', p.x, p.z);
}

/**
 * Ember Rain: the roar, the staggered circles (hazards), the hittable channel.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function rain(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, RAIN.windup);
    e.pose('roar');
    if (e.after(dur)) {
      // schedule the circles now: the first on the player, the others seeded within 4 u of it
      const n = e.phase === 3 ? RAIN.n3 : RAIN.n;
      const rect = inset(e, RAIN.r);
      for (let k = 0; k < n; k++) {
        let ox = 0;
        let oz = 0;
        if (k > 0) {
          const a = e.rng.next() * Math.PI * 2;
          const r = RAIN.spread * Math.sqrt(e.rng.next());
          ox = Math.cos(a) * r;
          oz = Math.sin(a) * r;
        }
        const hz = e.hazardCircle(ox, oz, RAIN.r, F(RAIN.fill), F(k * RAIN.every), true, rect);
        hz.mv = RAIN.mv;
        hz.kb = RAIN.kb;
        hz.burst = 'emberBurst';
        hz.burstN = 10;
        hz.sfx = 'hexBurst';
      }
      ctx.sfx('bossRoar', p.x, p.z);
      e.setState('active');
    }
    return;
  }
  // the channel (hittable)
  e.pose('roar');
  if (e.after(RAIN.channel)) endMove(e);
}

/**
 * Charge: the tracking lane, the armoured run, a brazier stun or the skid.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function charge(e, h, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    const dur = W(e, CHARGE.windup);
    e.pose('slamWind');
    if (e.t < F(dur - CHARGE.lock) - EPS) {
      turnToward(e, P.x, P.z, h, 3);
      if (e.fr % 2 === 0 || ai.len === 0) {
        ai.len = e.freeRun(e.facing.x, e.facing.z, CHARGE.max, ctx, inset(e, 1));
        ai.end = e.runEnd;
      }
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.len = Math.max(0.5, ai.len);
    m.width = CHARGE.width;
    m.progress = Math.min(1, e.t / F(dur));
    m.flash = e.lockFlash(e.t - F(dur - CHARGE.lock));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.run = ai.len + (ai.end === 'obstacle' ? 1.0 : 0);
      ai.done = 0;
      ai.tag = e.newTag();
      e.armored = true;
      e.markProgress(0, ctx, 1);
      ctx.sfx('boarCharge', p.x, p.z);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    e.pose('slam');
    const stepLen = Math.min(CHARGE.speed * h, ai.run - ai.done);
    let blocked = false;
    if (stepLen > 1e-5) {
      const x0 = p.x;
      const z0 = p.z;
      const fr = e.move(ai.lx * stepLen, ai.lz * stepLen, ctx);
      ai.done += Math.max(0, (p.x - x0) * ai.lx + (p.z - z0) * ai.lz);
      blocked = fr < 0.4;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx * 1.2;
    s.z = p.z + ai.lz * 1.2;
    s.r = CHARGE.r;
    s.mv = CHARGE.mv;
    s.kb = CHARGE.kb;
    s.knockdown = true;
    s.fromX = p.x;
    s.fromZ = p.z;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (blocked && e.blockedBy === 'collider') {
      // baited into a brazier: long stun, vulnerable and exposed
      e.unmark(0, ctx);
      e.armored = false;
      e.vuln = 1.5;
      e.exposed = true;
      ctx.shake(0.35, 0.45);
      ctx.sfx('stun', p.x, p.z);
      // ctx.fx takes the ground height and adds the effect's lift (1.6): stars over the 3.6 u body
      ctx.fx('stun', p.x, p.y + 2.6, p.z, { duration: STUN_F / 60, follow: e.position });
      ai.move = null;
      e.setState('stun');
      e.pose('kneel');
      return;
    }
    if (blocked || ai.done >= ai.run - 1e-3 || stepLen <= 1e-5) {
      e.unmark(0, ctx);
      e.armored = false;
      ai.skid = true;
      e.setState('recover');
    }
    return;
  }
  // skid 45 f at the arena edge / lane end (open, no vuln)
  const u = Math.min(1, e.t / F(SKID_F));
  const v = 8 * (1 - u) * (1 - u);
  if (v > 0) e.move(ai.lx * v * h, ai.lz * v * h, ctx);
  e.pose('slamWind');
  if (e.entered) ctx.fx('dust', p.x, p.y, p.z);
  if (e.after(SKID_F)) endMove(e);
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

/**
 * Turn the facing toward a point at the phase's turn rate (index 3 = instant).
 * @param {Enemy} e
 * @param {number} x
 * @param {number} z
 * @param {number} h
 * @param {number} rateIndex 0..2 = phase 1..3, 3 = instant
 */
function turnToward(e, x, z, h, rateIndex) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const p = e.position;
  const want = Math.atan2(x - p.x, z - p.z);
  ai.yaw = Math.atan2(e.facing.x, e.facing.z);
  let d = want - ai.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const max = rateIndex >= 3 ? Math.PI : TURN[rateIndex] * h;
  ai.yaw += Math.max(-max, Math.min(max, d));
  e.faceDir(Math.sin(ai.yaw), Math.cos(ai.yaw));
}

/**
 * The arena rect inset by `m` (reused object), or null without an arena.
 * @param {Enemy} e
 * @param {number} m
 * @returns {RectXZ|null}
 */
function inset(e, m) {
  const a = e.arena;
  if (!a) return null;
  const r = /** @type {GolemAI} */ (e.ai).inset ?? (e.ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  r.minX = a.rect.minX + m;
  r.maxX = a.rect.maxX - m;
  r.minZ = a.rect.minZ + m;
  r.maxZ = a.rect.maxZ - m;
  return r;
}

/**
 * Live adds of the brain state's list.
 * @param {{ adds: Enemy[] }} ai
 * @returns {number}
 */
function aliveAdds(ai) {
  let n = 0;
  for (const a of ai.adds) if (a && a.alive) n++;
  return n;
}

/**
 * 3 bat adds at the arena corners (inset 2 u) farthest from the player.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function spawnAdds(e, ctx) {
  const ai = /** @type {GolemAI} */ (e.ai);
  const a = e.arena;
  const p = e.position;
  const P = ctx.player.position;
  const r = a ? a.rect : { minX: p.x - 8, maxX: p.x + 8, minZ: p.z - 6, maxZ: p.z + 6 };
  const corners = [
    [r.minX + 2, r.minZ + 2], [r.maxX - 2, r.minZ + 2], [r.minX + 2, r.maxZ - 2], [r.maxX - 2, r.maxZ - 2],
  ];
  corners.sort((u, v) => Math.hypot(v[0] - P.x, v[1] - P.z) - Math.hypot(u[0] - P.x, u[1] - P.z));
  for (let i = 0; i < 3; i++) {
    const add = ctx.spawnAdd(ADD_KIND, corners[i][0], corners[i][1], ADD_LEVEL);
    if (!add) continue;
    const k = ai.adds.indexOf(add);
    if (k < 0) ai.adds.push(add);
  }
}
