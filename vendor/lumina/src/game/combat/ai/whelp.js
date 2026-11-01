/**
 * Ashwing Whelp — the swarms' dragonling (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7; COMBAT.md §7.3–7.7). Owner: the swarm package. A pack foe (the pack helpers of
 * ./kobold.js: its place round the target by group index, the fanned approach, holding, turns by
 * token).
 *
 * - **Gait:** short hops — a 24 f cycle of crouch 4 f (pose `move0`), airborne 14 f (an arc of
 *   0.32 u on the quad: `move1` launch, `move2` wings spread, `move3` coming down) and landing 6 f
 *   (`move3`), most of the ground covered in the air; average 3.5 u/s, rushing 4.4 u/s from afar.
 *   Ring 3.7 u (the outer half 4.8).
 * - **Bite** (a token taken within 4.8 u, `canMelee`, on screen; it hops in to 2.6 u first, giving
 *   the token back after 1.2 s): wind-up 22 f (pose `windup`: rearing back, jaws open; SFX `growl`)
 *   stepping in at 4 u/s to 1.6 u, the facing locked for the last 6 f; a hop-bite of 1.3 u over 9 f
 *   (pose `attack`, arc 0.25 u): sector r 1.05 ±55° (mv 1.0, kb 0.5); recover 26 f; 75 % (seeded) a
 *   hop back of 1.4 u after it; cooldown 80–160 f (× 0.6 flanking).
 * - **Fire spit** (4 ≤ d ≤ 8, line of sight, on screen, a token; cooldown 300–450 f): wind-up
 *   34 f (pose `spitWind`: the head drawn back, the throat glowing brighter and brighter) with a lane
 *   marker (width 0.5, to the predicted point + 1.5 u, ≤ 8.5) tracking the target's position 0.3 s
 *   ahead for 22 f, locked for the last 12 f; at progress 1 a fire glob leaves the jaws (9 u/s,
 *   radius 0.25, mv 0.85, kb 0.3, aimed at the body's middle, §7.6) and the lane fades over its
 *   flight; recover 20 f (pose `spit`).
 * - Glow (`uGlow` ember (1.0, 0.45, 0.12)): the eyes and throat smoulder (× 1.6), rise to × 4 over the
 *   spit's wind-up and flare at the spit.
 * - Poise 0: every hit makes it flinch. Death: a puff of embers.
 */
import { aimVy } from '../Projectiles.js';
import { packInit, packPoint, packMove, packHold, packCloseIn, CLOSE_S, flanking } from './kobold.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { Brain, CombatContext } from '../types.js'
 * @import { PackState } from './kobold.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

const RING = 3.7;
const TIER = 1.1;
const NEAR = 2.0;
const RUSH = 4.4;
const HOLD_SPEED = 2.4;
/** The hop cycle (frames): crouch, airborne, landing. */
const CROUCH_F = 4;
const AIR_F = 14;
const HOP_F = 24;
const HOP_ARC = 0.32;
/** Speed multipliers on the ground and in the air (the cycle averages ≈ 1). */
const GROUND_MUL = 0.3;
const AIR_MUL = 1.55;
/** A token is taken within this; the wind-up starts within BITE_START (closing in first). */
const BITE_RANGE = 4.8;
const BITE_START = 2.6;
const BITE_WINDUP_F = 22;
const BITE_LOCK_F = 6;
const BITE_REACH = 1.6;
/** Step-in speed of the bite wind-up (u/s). */
const BITE_STEP = 4.0;
const BITE_ACTIVE_F = 9;
const BITE_DIST = 1.3;
const BITE_RECOVER_F = 26;
const BACK_CHANCE = 0.75;
const BACK_DIST = 1.4;
const BACK_F = 14;
const SPIT_MIN = 4.0;
const SPIT_MAX = 8.0;
const SPIT_WINDUP_F = 34;
const SPIT_TRACK_F = 22;
const SPIT_LEAD = 0.3;
const SPIT_SPEED = 9;
const SPIT_LEN_MAX = 8.5;
const SPIT_WIDTH = 0.5;
const SPIT_RECOVER_F = 20;
/** The spit's projectile kind (Projectiles.js LOOKS: the swarm atlas frame, sparks at its end). */
const SPIT_KIND = 'swarmSpit';
const GLOW = Object.freeze([1.0, 0.45, 0.12]);

/**
 * @typedef {PackState & { hop: number, cd: number, cdS: number, move: 'bite'|'spit', tag: number,
 *   lx: number, lz: number, px: number, pz: number, len: number, back: number, bx: number, bz: number,
 *   los: boolean, losT: number, glow: number }} WhelpAI the brain state (`e.ai`)
 */

/** @satisfies {Brain} */
export const whelp = {
  init(e) {
    return {
      ...packInit(e, RING, TIER),
      hop: e.rng.next() * F(HOP_F),
      cd: F(e.rng.int(30, 100)),
      cdS: F(e.rng.int(60, 200)),
      move: /** @type {'bite'|'spit'} */ ('bite'),
      tag: 0,
      lx: 0, lz: 1, px: 0, pz: 0, len: 4,
      back: -1, bx: 0, bz: 0,
      los: false, losT: 0,
      glow: 1.6,
    };
  },

  /** Wander by hops round home. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {WhelpAI} */ (e.ai);
    const p = e.position;
    const x0 = p.x;
    const z0 = p.z;
    e.wander(h, ctx, 0.45);
    const moved = Math.hypot(p.x - x0, p.z - z0) > 1e-4;
    hopVisual(e, ai, h, moved);
    ai.glow += (1.6 - ai.glow) * Math.min(1, h * 4);
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {WhelpAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.cdS > 0) ai.cdS -= h;
    ai.glow += (1.6 - ai.glow) * Math.min(1, h * 4);

    // the hop back after a bite
    if (ai.back >= 0) {
      const T = F(BACK_F);
      const t1 = Math.min(T, ai.back + h);
      const s = BACK_DIST * ((1 - (1 - t1 / T) ** 2) - (1 - (1 - ai.back / T) ** 2));
      e.move(ai.bx * s, ai.bz * s, ctx);
      e.face(P.x, P.z);
      e.pose(t1 < T * 0.4 ? 'move1' : 'move2');
      e.lift = HOP_ARC * Math.sin(Math.PI * t1 / T);
      ai.back = t1 >= T - EPS ? -1 : t1;
      if (ai.back < 0) { e.lift = 0; ai.hop = 0; }
      return;
    }

    // closing in for a bite (a token held)
    const cl = packCloseIn(e, ai, ctx, h, BITE_START, RUSH * gaitMul(ai), null);
    if (cl === 'busy') {
      if (e.state === 'engage') hopVisual(e, ai, h, true);
      else e.lift = 0;
      return;
    }
    if (cl === 'failed') ai.cd = F(e.rng.int(30, 60));

    const near = tp.d <= ai.ring + NEAR;
    const grounded = ai.hop < F(CROUCH_F) - EPS || ai.hop >= F(CROUCH_F + AIR_F) - EPS;
    if (near && grounded) {
      const reach = e.canMelee(ctx);
      if (ai.cd <= 0 && reach && tp.d <= BITE_RANGE && e.canWindup(ctx) && e.takeToken(ctx)) {
        ai.move = 'bite';
        if (tp.d <= BITE_START) {
          e.lift = 0;
          e.setState('windup');
        } else ai.closing = CLOSE_S;
        return;
      }
      ai.losT -= h;
      if (ai.losT <= 0) {
        ai.los = ctx.los(p.x, p.z, P.x, P.z);
        ai.losT = F(12);
      }
      if (ai.cdS <= 0 && ai.los && tp.d >= SPIT_MIN && tp.d <= SPIT_MAX && e.canWindup(ctx) && e.takeToken(ctx)) {
        ai.move = 'spit';
        e.lift = 0;
        e.setState('windup');
        return;
      }
    }
    if (near) {
      const x0 = p.x;
      const z0 = p.z;
      packHold(e, ai, ctx, HOLD_SPEED * gaitMul(ai), h, null);
      hopVisual(e, ai, h, Math.hypot(p.x - x0, p.z - z0) > 1e-4);
      return;
    }
    packPoint(e, ai, ctx, ai.ring, 2.4, 3.5);
    packMove(e, ai, ctx, (tp.d > 8 ? RUSH : e.def.speed) * gaitMul(ai), h, null);
    hopVisual(e, ai, h, true);
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {WhelpAI} */ (e.ai);
    if (ai.move === 'spit') spit(e, h, ctx);
    else bite(e, h, ctx);
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {WhelpAI} */ (e.ai);
    ai.back = -1;
    ai.hop = 0;
    ai.closing = 0;
    e.lift = 0;
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.burst('swarmSpark', p.x, p.y + 0.5, p.z, 6);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {WhelpAI} */ (e.ai);
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = e.alive ? (ai ? ai.glow : 1.6) : 0;
  },
};

/**
 * The speed multiplier of the current hop phase (slow on the ground, fast in the air).
 * @param {WhelpAI} ai
 * @returns {number}
 */
function gaitMul(ai) {
  return ai.hop >= F(CROUCH_F) - EPS && ai.hop < F(CROUCH_F + AIR_F) - EPS ? AIR_MUL : GROUND_MUL;
}

/**
 * Advance the hop cycle and show it: poses, the arc on the quad. Standing still, it finishes the
 * hop in the air and then breathes (idle).
 * @param {Enemy} e
 * @param {WhelpAI} ai
 * @param {number} h
 * @param {boolean} moving
 */
function hopVisual(e, ai, h, moving) {
  const airborne = ai.hop >= F(CROUCH_F) - EPS && ai.hop < F(CROUCH_F + AIR_F) - EPS;
  if (!moving && !airborne) {
    ai.hop = 0;
    e.lift = 0;
    e.anim('idle');
    return;
  }
  ai.hop += h;
  if (ai.hop >= F(HOP_F) - EPS) ai.hop -= F(HOP_F);
  const t = ai.hop;
  if (t < F(CROUCH_F) - EPS) {
    e.lift = 0;
    e.pose('move0');
  } else if (t < F(CROUCH_F + AIR_F) - EPS) {
    const u = Math.min(1, (t - F(CROUCH_F)) / F(AIR_F));
    e.lift = HOP_ARC * 4 * u * (1 - u);
    e.pose(u < 0.3 ? 'move1' : u < 0.75 ? 'move2' : 'move3');
  } else {
    e.lift = 0;
    e.pose('move3');
  }
}

/**
 * The bite.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function bite(e, h, ctx) {
  const ai = /** @type {WhelpAI} */ (e.ai);
  const P = ctx.player.position;
  const tp = e.tp;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('growl', p.x, p.z, { volume: 0.7, pitch: 1.5 + (e.index % 3) * 0.08 });
    e.pose('windup');
    ai.glow += (2.2 - ai.glow) * Math.min(1, h * 6);
    if (e.t < F(BITE_WINDUP_F - BITE_LOCK_F) - EPS) {
      e.face(P.x, P.z);
      if (tp.d > BITE_REACH) e.walk(tp.dx, tp.dz, BITE_STEP, h, ctx, null, false);
    }
    if (e.after(BITE_WINDUP_F)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      ctx.sfx('swing', p.x, p.z, { volume: 0.55, pitch: 1.5 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(BITE_ACTIVE_F)) {
      e.lift = 0;
      ctx.burst('swarmDust', p.x, p.y + 0.05, p.z, 3);
      e.setState('recover');
      return;
    }
    e.pose('attack');
    const step = Math.min(h, F(BITE_ACTIVE_F) - e.t);
    const v = BITE_DIST / F(BITE_ACTIVE_F);
    if (step > 0) e.move(ai.lx * v * step, ai.lz * v * step, ctx);
    const u = Math.min(1, (e.t + h) / F(BITE_ACTIVE_F));
    e.lift = 0.25 * 4 * u * (1 - u);
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = 1.05;
    s.halfAngle = 55;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = 1.0;
    s.kb = 0.5;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  if (e.fr < 6) e.pose('move3');
  else {
    e.face(P.x, P.z);
    e.anim('idle');
  }
  if (e.after(BITE_RECOVER_F)) {
    e.dropToken(ctx);
    ai.cd = F(e.rng.int(80, 160)) * (flanking(e, ctx) ? 0.6 : 1);
    if (e.rng.chance(BACK_CHANCE)) {
      ai.back = 0;
      ai.bx = -tp.dx;
      ai.bz = -tp.dz;
    }
    e.setState('engage');
  }
}

/**
 * The fire spit: a tracked, then locked lane; the glob at progress 1.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function spit(e, h, ctx) {
  const ai = /** @type {WhelpAI} */ (e.ai);
  const P = ctx.player;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('growl', p.x, p.z, { volume: 0.6, pitch: 1.2 });
    e.pose('spitWind');
    const prog = Math.min(1, e.t / F(SPIT_WINDUP_F));
    ai.glow = 1.6 + 2.4 * prog;
    if (e.t < F(SPIT_TRACK_F) - EPS) {
      ai.px = P.position.x + P.velocity.x * SPIT_LEAD;
      ai.pz = P.position.z + P.velocity.z * SPIT_LEAD;
      e.face(ai.px, ai.pz);
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.len = Math.min(SPIT_LEN_MAX, Math.hypot(ai.px - p.x, ai.pz - p.z) + 1.5);
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = ai.lx;
    m.dirZ = ai.lz;
    m.len = ai.len;
    m.width = SPIT_WIDTH;
    m.progress = prog;
    m.flash = e.lockFlash(e.t - F(SPIT_TRACK_F));
    e.mark(0, ctx, m);
    if (e.after(SPIT_WINDUP_F)) {
      e.markProgress(0, ctx, 1);
      const dist = Math.max(0.5, ai.len - 1.5);
      const y = p.y + 0.6;
      const ps = e.projSpec();
      ps.kind = SPIT_KIND;
      ps.x = p.x + ai.lx * 0.6;
      ps.z = p.z + ai.lz * 0.6;
      ps.y = y;
      ps.dirX = ai.lx;
      ps.dirZ = ai.lz;
      ps.vy = aimVy(y, ctx.groundAt(ai.px, ai.pz) + 0.9, SPIT_SPEED, dist);
      ps.speed = SPIT_SPEED;
      ps.range = ai.len;
      ps.radius = 0.25;
      ps.mv = 0.85;
      ps.kb = 0.3;
      ctx.projectile(e, ps);
      e.markToFade(0, ctx, ai.len / SPIT_SPEED);
      ctx.burst('swarmSpark', ps.x, y, ps.z, 4);
      ctx.sfx('bolt', p.x, p.z, { volume: 0.55, pitch: 1.45 });
      ai.glow = 4.2;
      e.setState('recover');
    }
    return;
  }
  // recover
  e.pose(e.fr < 12 ? 'spit' : 'idle0');
  if (e.after(SPIT_RECOVER_F)) {
    e.dropToken(ctx);
    ai.cdS = F(e.rng.int(300, 450));
    ai.cd = Math.max(ai.cd, F(30));
    e.setState('engage');
  }
}
