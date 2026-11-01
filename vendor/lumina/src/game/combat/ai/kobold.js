/**
 * Scalekin Skirmisher — the swarms' spear (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7; COMBAT.md §7.3–7.7). Owner: the swarm package. This module also holds the **pack**
 * helpers the three swarm brains share (`packInit`, `packMove`, `packHold`, `flanking`; whelp.js and
 * emberimp.js import them).
 *
 * **The pack.** Every swarm foe has a place round its target (the player, or the companion that drew
 * it — `ctx.player` is the target's view): an angle `base + off` and a ring radius. `base` is the
 * bearing from the target to the foe's home when it first engages — a group shares it, so a pack
 * that appears ahead arrives from ahead —, `off` spreads the group by index round the full circle
 * (0, ±45°, ±90°, ±135°, 180° with a seeded jitter), the outer half of the group a ring further out.
 * From afar the foe runs toward a point that turns at most a few u per step toward its place, so a
 * pack fans out as it closes in and spirals round the target into its places instead of queueing up
 * behind the first (no conga line); where a rock stands in the way, the pack parts round it — each
 * foe round the side of its place —, and only where that is blocked too it follows a path of the
 * walk grid. Near its place it holds: shuffles round the ring facing the target, its guard up, now
 * and then a feint step in and out. Only a foe holding an attack token strikes (the defs give a
 * kobold or a whelp three quarters of a melee token: four at a time); the rest keep their places
 * until a token is free — the pack takes turns. Foes behind the target (`flanking`) are quicker to
 * strike.
 *
 * **Kobold.** Approach 3.8 u/s, rush 4.8 u/s (run). Ring 3.3 u (the outer half 4.4).
 * - *Jab* (a token taken within 4.4 u, `canMelee`, on screen; it runs in to 2.4 u first, giving the
 *   token back after 1.2 s): wind-up 20 f (pose `windup`: the spear drawn back behind the shield;
 *   SFX `yip`) darting in at 5 u/s to 1.3 u, the facing locked for the last 6 f;
 *   active 5 f: lane 1.75 × 0.55 along the spear (mv 0.85, kb 0.4), the `thrust` glint; 35 %
 *   (seeded) a second jab with its own 18 f wind-up (the flash re-pulses, §7.3); recover 22 f;
 *   cooldown 70–150 f (× 0.6 flanking).
 * - *Lunge* (3.4 ≤ d ≤ 5, the same conditions, its own cooldown 300–480 f): wind-up 32 f (pose
 *   `lungeWind`; SFX `yip`, pitched up) with a lane marker (width 0.8, the free run ≤ 3.4 u + 0.9
 *   reach) tracking the target for 20 f, locked for the last 12 f (rim flash); at progress 1 the dash:
 *   the free run over 12 f along the locked lane (pose `lunge`), a circle r 0.55 at the spear tip each sub-step
 *   (mv 1.25, kb 1.0), dust and the glint; recover 30 f. No marker on the jab (radius < 1.5).
 * - After every strike it hops back 1.1 u out of the press; a player swing that starts within 2 u:
 *   15 % (seeded) the same back-hop (cooldown 100 f).
 * - Poise 14: one swing does not break its guard; the combo's second does.
 */
/**
 * @import { Enemy } from '../Enemy.js'
 * @import { Brain, CombatContext } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Pack helpers (shared by the swarm brains)
// ---------------------------------------------------------------------------------------------

/** A path / straight-way re-check every this many frames (staggered by the enemy's uid). */
const WAY_EVERY = 8;

/**
 * The pack fields of a swarm brain's state (`e.ai` spreads them).
 * @typedef {object} PackState
 * @property {number} off    angle of its place relative to the pack's bearing (rad)
 * @property {number} ring   ring radius of its place (u)
 * @property {number} base   the pack's bearing from the target (NaN until it engages)
 * @property {number} sway   phase of the shuffle round its place
 * @property {number} swayDir ±1
 * @property {number} feint  seconds of a feint left (> 0: stepping in, then out)
 * @property {number} feintCd seconds to the next feint
 * @property {boolean} way   the straight way to its moving point was clear at the last check
 * @property {number} side   0, or ±1: going round an obstacle on that side (`sidePoint`)
 * @property {number} sideSign the side it tries first: its place's side of the pack
 * @property {boolean} holding it holds its place (`packHold`), not approaching
 * @property {boolean} stepping holding: it walks to its drifting place (else it stands)
 * @property {number} closing seconds left to close in before a melee wind-up (0: not closing)
 * @property {number} wayAt  frame of the next check
 * @property {number} tx     the point it moves to (scratch)
 * @property {number} tz
 */

/**
 * The pack part of a brain's state: its place round the target by group index — 0, +45°, −45°,
 * +90°, −90°, +135°, −135°, 180° (a seeded ±10° jitter), the outer half (index ≥ 4) on a ring
 * `tier` u further out (`ring` ± 0.2 seeded).
 * @param {Enemy} e
 * @param {number} ring inner ring radius (u)
 * @param {number} tier the outer ring's extra radius (u)
 * @returns {PackState}
 */
export function packInit(e, ring, tier) {
  const i = Math.max(0, e.index | 0) % 8;
  const k = i === 7 ? 4 : Math.ceil(i / 2) * (i % 2 ? 1 : -1);
  const swayDir = e.rng.chance(0.5) ? 1 : -1;
  return {
    off: k * (Math.PI / 4) + e.rng.range(-0.17, 0.17),
    ring: ring + (i >= 4 ? tier : 0) + e.rng.range(-0.2, 0.2),
    base: NaN,
    sway: e.rng.next() * TAU,
    swayDir,
    feint: 0,
    feintCd: e.rng.range(1.5, 4),
    way: true,
    wayAt: 0,
    side: 0,
    holding: false,
    stepping: false,
    closing: 0,
    sideSign: k > 0 ? 1 : k < 0 ? -1 : swayDir,
    tx: 0,
    tz: 0,
  };
}

/**
 * Wrap an angle into (−π, π].
 * @param {number} a
 * @returns {number}
 */
function wrap(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/**
 * The angle of the foe's place now (`base + off`), the bearing fixed at its first engage frame:
 * from the target to its home (the pack's side).
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @returns {number}
 */
export function placeAngle(e, ai, ctx) {
  if (Number.isNaN(ai.base)) {
    const P = ctx.player.position;
    const dx = e.home.x - P.x;
    const dz = e.home.z - P.z;
    ai.base = Math.hypot(dx, dz) > 0.5 ? Math.atan2(dz, dx) : Math.atan2(e.position.z - P.z, e.position.x - P.x);
  }
  return ai.base + ai.off;
}

/**
 * Write into `ai.tx`/`ai.tz` the point the foe moves to: toward its place round the target,
 * turning at most `min(0.9, lateral / d)` rad per call round the target (so a pack fans out and
 * spirals in), at a radius that closes by up to `close` u — or its place itself once near.
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @param {number} ring the radius to hold
 * @param {number} lateral u of sideways turn allowed per call when far
 * @param {number} close u the radius may shrink by per call
 * @returns {number} the angle still to turn to its place (rad, signed)
 */
export function packPoint(e, ai, ctx, ring, lateral, close) {
  const P = ctx.player.position;
  const p = e.position;
  const d = Math.max(1e-3, e.tp.d);
  const me = Math.atan2(p.z - P.z, p.x - P.x);
  const left = wrap(placeAngle(e, ai, ctx) - me);
  const turn = Math.min(0.9, lateral / d);
  const a = me + Math.max(-turn, Math.min(turn, left));
  const r = Math.max(ring, d - close);
  ai.tx = P.x + Math.cos(a) * r;
  ai.tz = P.z + Math.sin(a) * r;
  return left;
}

/**
 * Move a ground foe toward the point of `packPoint`: straight (`seek`, with its stuck detours)
 * while the way there is clear on the walk grid and the target is about level; where an obstacle
 * stands in it, round its side — a point turned further round the target toward the foe's place
 * (so a pack parts round a rock, half each way, instead of filing through one gap) — and only when
 * that is blocked too, `chase` along a path. Re-checked every WAY_EVERY frames, staggered.
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @param {number} speed
 * @param {number} h
 * @param {string|null} anim
 */
export function packMove(e, ai, ctx, speed, h, anim) {
  ai.holding = false;
  const nav = ctx.nav;
  const f = ctx.frame;
  const p = e.position;
  if (nav && (f >= ai.wayAt || f < ai.wayAt - WAY_EVERY)) {
    ai.wayAt = f + WAY_EVERY;
    const level = Math.abs(e.tp.dy) <= 0.3;
    ai.way = level && nav.lineClear(p.x, p.z, ai.tx, ai.tz, 0.3);
    ai.side = 0;
    if (level && !ai.way) {
      const s = sidePoint(e, ai, ctx);
      if (nav.lineClear(p.x, p.z, s.x, s.z, 0.3)) ai.side = ai.sideSign;
      else {
        ai.sideSign = -ai.sideSign;
        const o = sidePoint(e, ai, ctx);
        if (nav.lineClear(p.x, p.z, o.x, o.z, 0.3)) ai.side = ai.sideSign;
      }
    }
  }
  if (!nav || ai.way) e.seek(ai.tx, ai.tz, speed, h, ctx, anim);
  else if (ai.side) {
    const s = sidePoint(e, ai, ctx);
    e.seek(s.x, s.z, speed, h, ctx, anim);
  } else e.chase(speed, h, ctx, anim);
}

/** `sidePoint`'s result (reused). */
const _side = { x: 0, z: 0 };

/**
 * A point round an obstacle: turned `min(1.2, 5 / d)` rad round the target from where the foe
 * stands, toward `ai.sideSign`, at its distance less 1 u.
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @returns {{ x: number, z: number }}
 */
function sidePoint(e, ai, ctx) {
  const P = ctx.player.position;
  const p = e.position;
  const d = Math.max(1, e.tp.d);
  const a = Math.atan2(p.z - P.z, p.x - P.x) + ai.sideSign * Math.min(1.2, 5 / d);
  _side.x = P.x + Math.cos(a) * (d - 1);
  _side.z = P.z + Math.sin(a) * (d - 1);
  return _side;
}

/**
 * Hold the place near the target: walk (no stuck bookkeeping) toward the place point with a slow
 * shuffle round the ring and an occasional feint step in and out, facing the target. Returns the
 * fraction of the step it moved (0: it stands).
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @param {number} speed
 * @param {number} h
 * @param {string|null} anim the locomotion animation while it moves
 * @returns {number}
 */
export function packHold(e, ai, ctx, speed, h, anim) {
  const P = ctx.player.position;
  if (!ai.holding) {
    // (seek's stuck watch belongs to the approach: a window left open by it would read the
    // shuffling round the place as no progress)
    ai.holding = true;
    e.resetSeek();
  }
  ai.sway += h * 0.9;
  ai.feintCd -= h;
  let ring = ai.ring + Math.sin(ai.sway) * 0.35;
  if (ai.feint > 0) {
    ai.feint -= h;
    ring -= ai.feint > 0.25 ? 0.9 : 0;
  } else if (ai.feintCd <= 0) {
    ai.feint = 0.5;
    ai.feintCd = e.rng.range(2.5, 5.5);
  }
  ai.off += ai.swayDir * h * 0.12;
  packPoint(e, ai, ctx, ring, 2.5, 3);
  const p = e.position;
  const dx = ai.tx - p.x;
  const dz = ai.tz - p.z;
  const d = Math.hypot(dx, dz);
  // (a dead zone with hysteresis: it steps once its place has drifted 0.45 u, and stands again
  // within 0.12 u — no shuffling on the spot)
  if (ai.stepping ? d < 0.12 : d > 0.45) ai.stepping = !ai.stepping;
  let moved = 0;
  if (ai.stepping) {
    const v = Math.min(speed, d / h);
    moved = e.walk(dx / d, dz / d, v, h, ctx, anim, false);
  } else if (anim) e.anim('idle');
  e.face(P.x, P.z);
  return moved;
}

/** A foe closing in for a melee strike gives up (returns its token) after this long (s). */
export const CLOSE_S = 1.2;

/**
 * A foe that took an attack token from its place closes in before its wind-up: it runs at the
 * target (`chase`: straight, or along a path) until it is within `start` with the melee reach and
 * on screen — then its wind-up starts. Out of time (CLOSE_S) it returns the token.
 * @param {Enemy} e
 * @param {PackState} ai
 * @param {CombatContext} ctx
 * @param {number} h
 * @param {number} start the distance its wind-up starts from
 * @param {number} speed
 * @param {string|null} anim
 * @returns {'idle'|'busy'|'failed'} not closing; closing (or the wind-up began): the step is spent;
 *   it gave up this step
 */
export function packCloseIn(e, ai, ctx, h, start, speed, anim) {
  if (!(ai.closing > 0)) return 'idle';
  ai.closing -= h;
  if (e.tp.d <= start && e.canMelee(ctx) && e.canWindup(ctx)) {
    ai.closing = 0;
    e.setState('windup');
    return 'busy';
  }
  if (ai.closing <= 0) {
    ai.closing = 0;
    e.dropToken(ctx);
    return 'failed';
  }
  e.chase(speed, h, ctx, anim);
  return 'busy';
}

/**
 * Is the foe behind its target (relative to the target's facing)? Flankers strike sooner.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @returns {boolean}
 */
export function flanking(e, ctx) {
  const f = ctx.player.facing;
  return -(e.tp.dx * f.x + e.tp.dz * f.z) < -0.3;
}

// ---------------------------------------------------------------------------------------------
// The kobold
// ---------------------------------------------------------------------------------------------

const RING = 3.3;
const TIER = 1.1;
const RUSH = 4.8;
const HOLD_SPEED = 2.6;
/** Beyond its ring + this it runs (rush); within, it holds. */
const NEAR = 2.2;
/** A token is taken within this; the wind-up starts within JAB_START (closing in first). */
const JAB_RANGE = 4.4;
const JAB_START = 2.4;
const JAB_WINDUP_F = 20;
const JAB2_WINDUP_F = 18;
const JAB_LOCK_F = 6;
const JAB_ACTIVE_F = 5;
const JAB_RECOVER_F = 22;
const JAB_REACH = 1.3;
const JAB_STEP = 5.0;
const JAB_LEN = 1.75;
const JAB_WIDTH = 0.55;
const JAB2_CHANCE = 0.35;
const LUNGE_MIN = 3.4;
const LUNGE_MAX = 5.0;
const LUNGE_WINDUP_F = 32;
const LUNGE_TRACK_F = 20;
const LUNGE_DASH_F = 12;
const LUNGE_LEN = 3.4;
const LUNGE_REACH = 0.9;
const LUNGE_WIDTH = 0.8;
const LUNGE_RECOVER_F = 30;
const LUNGE_CHANCE = 0.5;
const HOP_CHANCE = 0.15;
const HOP_DIST = 1.1;
const HOP_F = 10;
const HOP_COOLDOWN_F = 100;
/** The player's actions that count as a melee swing (goblin.js). */
const MELEE_ACTION = /^(attack|skill1|a[123])$/;

/**
 * @typedef {PackState & { cd: number, cdL: number, move: 'jab'|'lunge', second: boolean, tag: number,
 *   lx: number, lz: number, len: number, hopT: number, hopX: number, hopZ: number, hopCd: number,
 *   prevAction: string|null, prevSwing: number }} KoboldAI the brain state (`e.ai`)
 */

/** @satisfies {Brain} */
export const kobold = {
  init(e) {
    return {
      ...packInit(e, RING, TIER),
      cd: F(e.rng.int(20, 90)),
      cdL: F(e.rng.int(60, 240)),
      move: /** @type {'jab'|'lunge'} */ ('jab'),
      second: false,
      tag: 0,
      lx: 0, lz: 1, len: LUNGE_LEN,
      hopT: -1, hopX: 0, hopZ: 0, hopCd: 0,
      prevAction: /** @type {string|null} */ (null),
      prevSwing: 0,
    };
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {KoboldAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.cdL > 0) ai.cdL -= h;
    if (ai.hopCd > 0) ai.hopCd -= h;

    // a back-hop in progress
    if (ai.hopT >= 0) {
      const T = F(HOP_F);
      const t1 = Math.min(T, ai.hopT + h);
      const s = HOP_DIST * ((1 - (1 - t1 / T) ** 2) - (1 - (1 - ai.hopT / T) ** 2));
      e.move(ai.hopX * s, ai.hopZ * s, ctx);
      e.face(P.position.x, P.position.z);
      e.pose('guard');
      e.lift = 0.22 * Math.sin(Math.PI * t1 / T);
      ai.hopT = t1 >= T - EPS ? -1 : t1;
      if (ai.hopT < 0) e.lift = 0;
      return;
    }
    // a swing starts close by: maybe hop back
    const act = P.action;
    const swing = P.swing ?? 0;
    if (act !== ai.prevAction || swing !== ai.prevSwing) {
      ai.prevAction = act;
      ai.prevSwing = swing;
      if (act && MELEE_ACTION.test(act) && tp.d <= 2.0 && ai.hopCd <= 0 && e.rng.chance(HOP_CHANCE)) {
        ai.hopT = 0;
        ai.hopX = -tp.dx;
        ai.hopZ = -tp.dz;
        ai.hopCd = F(HOP_COOLDOWN_F);
        e.pose('guard');
        return;
      }
    }

    // closing in for a jab (a token held)
    const cl = packCloseIn(e, ai, ctx, h, JAB_START, RUSH, 'run');
    if (cl === 'busy') return;
    if (cl === 'failed') ai.cd = F(e.rng.int(30, 60));

    const near = tp.d <= ai.ring + NEAR;
    if (near) {
      const reach = e.canMelee(ctx);
      // the lunge from the outer ring, the jab from close
      if (ai.cdL <= 0 && reach && tp.d >= LUNGE_MIN && tp.d <= LUNGE_MAX && e.canWindup(ctx)) {
        if (e.rng.chance(LUNGE_CHANCE) && e.takeToken(ctx)) {
          ai.move = 'lunge';
          e.setState('windup');
          return;
        }
        ai.cdL = F(e.rng.int(60, 120));
      }
      if (ai.cd <= 0 && reach && tp.d <= JAB_RANGE && e.canWindup(ctx) && e.takeToken(ctx)) {
        ai.move = 'jab';
        ai.second = false;
        if (tp.d <= JAB_START) e.setState('windup');
        else ai.closing = CLOSE_S;
        return;
      }
      // hold the place: shuffle, guard up when it stands
      const moved = packHold(e, ai, ctx, HOLD_SPEED, h, null);
      if (moved > 0.05) e.anim('walk');
      else guard(e, ctx);
      return;
    }
    // far: run toward its place (fanning out)
    packPoint(e, ai, ctx, ai.ring, 2.4, 3.5);
    packMove(e, ai, ctx, tp.d > 8 ? RUSH : e.def.speed, h, 'run');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {KoboldAI} */ (e.ai);
    if (ai.move === 'lunge') lunge(e, h, ctx);
    else jab(e, h, ctx);
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {KoboldAI} */ (e.ai);
    ai.second = false;
    ai.hopT = -1;
    ai.closing = 0;
    e.lift = 0;
  },
};

/**
 * After a strike the kobold hops back out of the press (the next one's turn; the hero stays in
 * sight).
 * @param {Enemy} e
 * @param {KoboldAI} ai
 */
function hopBack(e, ai) {
  ai.hopT = 0;
  ai.hopX = -e.tp.dx;
  ai.hopZ = -e.tp.dz;
}

/**
 * The waiting stance: the shield up, breathing (guard / guard2 at 2.5 Hz, out of step with the pack).
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function guard(e, ctx) {
  e.pose(Math.floor(ctx.time * 2.5 + e.index * 0.37) % 2 ? 'guard2' : 'guard');
}

/**
 * The jab (and its seeded second jab).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function jab(e, h, ctx) {
  const ai = /** @type {KoboldAI} */ (e.ai);
  const P = ctx.player.position;
  const tp = e.tp;
  const p = e.position;
  if (e.state === 'windup') {
    const dur = ai.second ? JAB2_WINDUP_F : JAB_WINDUP_F;
    if (e.entered && !ai.second) ctx.sfx('yip', p.x, p.z, { volume: 0.7, pitch: 1 + (e.index % 4) * 0.05 });
    e.pose('windup');
    if (e.t < F(dur - JAB_LOCK_F) - EPS) {
      e.face(P.x, P.z);
      if (tp.d > JAB_REACH) e.walk(tp.dx, tp.dz, JAB_STEP, h, ctx, null, false);
    }
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      ctx.fx('thrust', p.x + ai.lx * 1.0, p.y - 0.12, p.z + ai.lz * 1.0, { dirX: ai.lx, dirZ: ai.lz, scale: 0.42 });
      ctx.sfx('swing', p.x, p.z, { volume: 0.6, pitch: 1.35 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(JAB_ACTIVE_F)) {
      if (!ai.second && e.rng.chance(JAB2_CHANCE)) {
        ai.second = true;
        e.setState('windup');
      } else e.setState('recover');
      return;
    }
    e.pose('attack');
    const s = e.hitSpec();
    s.shape = 'lane';
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.len = JAB_LEN;
    s.width = JAB_WIDTH;
    s.mv = 0.85;
    s.kb = 0.4;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  // recover: the spear held out, then the guard
  if (e.fr < 10) e.pose('attack');
  else {
    e.face(P.x, P.z);
    e.pose('guard');
  }
  if (e.after(JAB_RECOVER_F)) {
    e.dropToken(ctx);
    ai.second = false;
    ai.cd = F(e.rng.int(70, 150)) * (flanking(e, ctx) ? 0.6 : 1);
    hopBack(e, ai);
    e.setState('engage');
  }
}

/**
 * The lunge: a tracked, then locked lane; the dash along it.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function lunge(e, h, ctx) {
  const ai = /** @type {KoboldAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('yip', p.x, p.z, { volume: 0.9, pitch: 1.25 });
    e.pose('lungeWind');
    if (e.t < F(LUNGE_TRACK_F) - EPS) {
      e.face(P.x, P.z);
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.len = Math.max(0.5, e.freeRun(ai.lx, ai.lz, LUNGE_LEN, ctx));
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = ai.lx;
    m.dirZ = ai.lz;
    m.len = ai.len + LUNGE_REACH;
    m.width = LUNGE_WIDTH;
    m.progress = Math.min(1, e.t / F(LUNGE_WINDUP_F));
    m.flash = e.lockFlash(e.t - F(LUNGE_TRACK_F));
    e.mark(0, ctx, m);
    if (e.after(LUNGE_WINDUP_F)) {
      e.markProgress(0, ctx, 1);
      ai.tag = e.newTag();
      ctx.burst('swarmDust', p.x, p.y + 0.1, p.z, 5);
      ctx.fx('thrust', p.x + ai.lx * 1.2, p.y - 0.05, p.z + ai.lz * 1.2, { dirX: ai.lx, dirZ: ai.lz, scale: 0.55 });
      ctx.sfx('swing', p.x, p.z, { volume: 0.8, pitch: 1.15 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(LUNGE_DASH_F)) {
      e.markToFade(0, ctx, F(10));
      e.setState('recover');
      return;
    }
    e.pose('lunge');
    const step = Math.min(h, F(LUNGE_DASH_F) - e.t);
    const v = ai.len / F(LUNGE_DASH_F);
    if (step > 0) e.move(ai.lx * v * step, ai.lz * v * step, ctx);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx * LUNGE_REACH * 0.6;
    s.z = p.z + ai.lz * LUNGE_REACH * 0.6;
    s.r = 0.55;
    s.mv = 1.25;
    s.kb = 1.0;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose(e.fr < 10 ? 'lunge' : 'guard');
  if (e.fr >= 10) e.face(P.x, P.z);
  if (e.after(LUNGE_RECOVER_F)) {
    e.dropToken(ctx);
    ai.cdL = F(e.rng.int(300, 480));
    ai.cd = F(e.rng.int(40, 80));
    hopBack(e, ai);
    e.setState('engage');
  }
}
