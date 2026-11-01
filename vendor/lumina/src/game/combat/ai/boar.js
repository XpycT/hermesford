/**
 * Ironhide Boar — heavy charger (COMBAT.md §7.7). Walks toward the player at 2.4 u/s with a turn
 * rate of 90°/s. Every attack uses its melee token of cost 2.
 *
 * - **Charge** (LOS, on screen, 4 ≤ d ≤ 10): paw wind-up 60 f (pose `windup`, `footstep` dust 4
 *   every 12 f, SFX `boarSnort`) with a lane marker 1.4 wide whose length is the boar's free run
 *   (≤ 12 u, `e.freeRun`: first unwalkable sample, a step > 0.55 or a static collider); the lane
 *   tracks the player for 45 f and locks for 15 f. Then it charges at 10 u/s along the locked lane
 *   (poses `charge0` / `charge1` every 4 f), **armoured**, hitting a circle r 0.8 ahead each
 *   sub-step (mv 1.4, kb 3.0, knockdown). A lane that ended at an obstacle is run 1 u further so
 *   the boar meets it: a sub-step whose moveGround fraction is < 0.4 with `blockedBy` 'terrain' or
 *   'collider' → **stunned** 120 f (pose `stun`, FX `stun`, vuln 1.5, exposed; shake 0.3/0.4, SFX
 *   `stun`); otherwise (open ground, lane end, the arena exclusion) a 30 f skid and a 72 f open
 *   recover. An elite follows a non-wall charge with a second charge (wind-up 30 f).
 * - **Gore** (d ≤ 2.0): wind-up 27 f with a sector marker (r 1.6, ±45°, filling over the wind-up;
 *   the direction locks for the last 9 f), a 0.9 u lunge over 6 f with the sector hit (mv 1.0,
 *   kb 1.5), recover 45 f.
 * - A player out of melee reach (`e.canMelee(ctx)` false: on a ledge above) is neither gored nor
 *   charged (the lane would end at the cliff): the boar walks the walk grid's path to it.
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const DEG = Math.PI / 180;

const SPEED = 2.4;
const TURN = 90 * DEG;
const CHARGE_MIN = 4;
const CHARGE_MAX = 10;
const WINDUP_F = 60;
const ELITE_WINDUP_F = 30;
const LOCK_F = 15;
const LANE_W = 1.4;
const RUN_MAX = 12;
const OVERSHOOT = 1.0;
const CHARGE_SPEED = 10;
const STUN_F = 120;
const SKID_F = 30;
const RECOVER_F = 72;
const CHARGE_COOLDOWN_F = 90;
const GORE_RANGE = 2.0;
const GORE_WINDUP_F = 27;
const GORE_LOCK_F = 9;
const GORE_ACTIVE_F = 6;
const GORE_RECOVER_F = 45;
const GORE_COOLDOWN_F = 60;

/** @typedef {Required<ReturnType<typeof boar.init>>} BoarAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const boar = {
  init(e) {
    return {
      yaw: 0,
      cd: F(e.rng.int(20, 60)),
      move: 'charge',
      second: false,
      len: 0, end: 'max', lx: 0, lz: 1,
      run: 0, done: 0,
      skid: false,
      dust: 0,
      tag: 0,
      los: false, losT: 0,
    };
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {BoarAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    if (ai.cd > 0) ai.cd -= h;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }
    const reach = e.canMelee(ctx);
    if (ai.cd <= 0 && reach && tp.d <= GORE_RANGE && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.move = 'gore';
      e.setState('windup');
      return;
    }
    if (ai.cd <= 0 && reach && tp.d >= CHARGE_MIN && tp.d <= CHARGE_MAX && ai.los && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.move = 'charge';
      ai.second = false;
      e.setState('windup');
      return;
    }
    // walk toward the player (or its footsteps) turning at most 90°/s
    const c = e.chasePoint(ctx);
    const want = Math.atan2(c.x - p.x, c.z - p.z);
    ai.yaw = Math.atan2(e.facing.x, e.facing.z);
    let d = want - ai.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const turn = Math.max(-TURN * h, Math.min(TURN * h, d));
    ai.yaw += turn;
    const fx = Math.sin(ai.yaw);
    const fz = Math.cos(ai.yaw);
    if (tp.d < 1.2 && reach) {
      e.faceDir(fx, fz);
      e.anim('idle');
      return;
    }
    const slow = Math.abs(d) > Math.PI / 2 ? 0.5 : 1;
    e.seek(p.x + fx * 2, p.z + fz * 2, SPEED * slow, h, ctx, 'walk');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    if (e.ai.move === 'gore') gore(e, h, ctx);
    else charge(e, h, ctx);
  },

  /** @type {Brain['stun']} */
  stun(e, h, ctx) {
    e.pose('stun');
    if (e.after(STUN_F)) {
      e.vuln = 1;
      e.exposed = false;
      e.dropToken(ctx);
      /** @type {BoarAI} */ (e.ai).cd = F(CHARGE_COOLDOWN_F);
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    /** @type {BoarAI} */ (e.ai).second = false;
    /** @type {BoarAI} */ (e.ai).skid = false;
    e.armored = false;
    e.vuln = 1;
    e.exposed = false;
  },
};

/**
 * The charge (and an elite's second charge): wind-up with the lane, the armoured run, stun / skid.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function charge(e, h, ctx) {
  const ai = /** @type {BoarAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    const dur = ai.second ? ELITE_WINDUP_F : WINDUP_F;
    if (e.entered) {
      ctx.sfx('boarSnort', p.x, p.z);
      ai.dust = 0;
    }
    // pawing dust: `footstep` 4 every 12 f
    if (e.fr >= ai.dust * 12) {
      ctx.burst('footstep', p.x, p.y + 0.05, p.z, 4);
      ai.dust++;
    }
    e.pose('windup');
    const tracking = e.t < F(dur - LOCK_F) - 1e-6;
    if (tracking) {
      e.face(P.x, P.z);
      if (e.fr % 2 === 0 || ai.len === 0) {
        ai.len = e.freeRun(e.facing.x, e.facing.z, RUN_MAX, ctx);
        ai.end = e.runEnd;
      }
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.len = Math.max(0.5, ai.len);
    m.width = LANE_W;
    m.progress = Math.min(1, e.t / F(dur));
    m.flash = e.lockFlash(e.t - F(dur - LOCK_F));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.run = ai.len + (ai.end === 'obstacle' ? OVERSHOOT : 0);
      ai.done = 0;
      ai.tag = e.newTag();
      ai.skid = false;
      e.armored = true;
      e.markProgress(0, ctx, 1);
      ctx.sfx('boarCharge', p.x, p.z);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    e.pose((e.fr >> 2) & 1 ? 'charge1' : 'charge0');
    const step = Math.min(CHARGE_SPEED * h, ai.run - ai.done);
    let blocked = false;
    if (step > 1e-5) {
      const x0 = p.x;
      const z0 = p.z;
      const fr = e.move(ai.lx * step, ai.lz * step, ctx);
      ai.done += Math.max(0, (p.x - x0) * ai.lx + (p.z - z0) * ai.lz);
      blocked = fr < 0.4;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx * 0.6;
    s.z = p.z + ai.lz * 0.6;
    s.r = 0.8;
    s.mv = 1.4;
    s.kb = 3.0;
    s.knockdown = true;
    s.tag = ai.tag;
    s.fromX = p.x;
    s.fromZ = p.z;
    ctx.hitbox(e, s);
    if (blocked && (e.blockedBy === 'terrain' || e.blockedBy === 'collider')) {
      // wall: stunned
      e.unmark(0, ctx);
      e.armored = false;
      e.vuln = 1.5;
      e.exposed = true;
      ctx.shake(0.3, 0.4);
      ctx.sfx('stun', p.x, p.z);
      ctx.fx('stun', p.x, p.y, p.z, { duration: STUN_F / 60, follow: e.position });
      e.pose('stun');
      e.setState('stun');
      return;
    }
    if (blocked || ai.done >= ai.run - 1e-3 || step <= 1e-5) {
      e.unmark(0, ctx);
      e.armored = false;
      ai.skid = true;
      e.setState('recover');
    }
    return;
  }
  // recover: skid 30 f (open), then 72 f; an elite charges again after its first (non-wall) charge
  if (ai.skid) {
    const u = Math.min(1, e.t / F(SKID_F));
    const v = 6 * (1 - u) * (1 - u);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    e.pose('charge1');
    if (e.entered) ctx.burst('footstep', p.x, p.y + 0.05, p.z, 4);
    if (e.after(SKID_F)) {
      ai.skid = false;
      if (e.elite && !ai.second) {
        ai.second = true;
        ai.len = 0;
        e.setState('windup');
        return;
      }
      e.setState('recover');
    }
    return;
  }
  if (e.entered) e.anim('idle');
  if (e.after(RECOVER_F)) {
    e.dropToken(ctx);
    ai.second = false;
    ai.cd = F(CHARGE_COOLDOWN_F);
    e.setState('engage');
  }
}

/**
 * The gore: sector wind-up, lunge with the sector hit, recover.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function gore(e, h, ctx) {
  const ai = /** @type {BoarAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('windup', p.x, p.z);
    if (e.t < F(GORE_WINDUP_F - GORE_LOCK_F) - 1e-6) e.face(P.x, P.z);
    e.pose('windup');
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = 1.6;
    m.halfAngle = 45;
    m.progress = Math.min(1, e.t / F(GORE_WINDUP_F));
    e.mark(0, ctx, m);
    if (e.after(GORE_WINDUP_F)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(GORE_ACTIVE_F)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    e.pose('attack');
    const v = 0.9 / F(GORE_ACTIVE_F);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = 1.6;
    s.halfAngle = 45;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = 1.0;
    s.kb = 1.5;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  if (e.entered) e.anim('idle');
  if (e.after(GORE_RECOVER_F)) {
    e.dropToken(ctx);
    ai.cd = F(GORE_COOLDOWN_F);
    e.setState('engage');
  }
}
