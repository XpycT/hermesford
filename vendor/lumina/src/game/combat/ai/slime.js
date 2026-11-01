/**
 * Moss Slime — swarm chaser (COMBAT.md §7.7).
 *
 * Moves in hops: a 42 f cycle of crouch 9 f (pose `move0`), airborne 27 f (arc 0.25 u on the quad,
 * poses `move1` / `move2`) and landing squash 6 f (pose `land`); a chase hop covers 1.54 u, so the
 * average speed is 2.2 u/s. Attack at d ≤ 2.2 with a token, on the ground: wind-up 30 f (pose
 * `windup`, SFX `slimeHop`), leap 2.4 u over 12 f along the direction locked at the leap (circle
 * r 0.6 around itself each sub-step, mv 1.0, kb 0.8; no marker — radius < 1.5), recover 42 f (pose
 * `land`), cooldown 84 f. Poise 0: every hit interrupts. Death: `gooPoof` 12 (Enemy.die). A player
 * out of melee reach (`e.canMelee(ctx)` false: on a ledge above) is chased along the walk grid,
 * never leapt at.
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

const CROUCH_F = 9;
const AIR_F = 27;
const HOP_F = 42;
const HOP_ARC = 0.25;
/** Chase hop length: 2.2 u/s × 42 f. */
const HOP_DIST = 2.2 * HOP_F / 60;
const WANDER_HOP = 0.7;
const ATTACK_RANGE = 2.2;
const WINDUP_F = 30;
const LEAP_F = 12;
const LEAP_DIST = 2.4;
const LEAP_ARC = 0.4;
const RECOVER_F = 42;
const COOLDOWN_F = 84;

/** @typedef {Required<ReturnType<typeof slime.init>>} SlimeAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const slime = {
  init() {
    return {
      hop: 0, // seconds into the hop cycle
      tx: 0, tz: 0, // hop target
      v: 0, // airborne speed of the current hop (u/s), fixed when the hop is aimed
      cd: 0,
      pause: 0,
      wander: false, wx: 0, wz: 0,
      side: 1,
      leapX: 0, leapZ: 1, tag: 0,
    };
  },

  /** Wander by short hops inside the home radius, with pauses. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {SlimeAI} */ (e.ai);
    if (ai.pause > 0 && ai.hop === 0) {
      ai.pause -= h;
      e.lift = 0;
      e.anim('idle');
      return;
    }
    if (ai.hop === 0) {
      if (!ai.wander) {
        const a = e.rng.next() * Math.PI * 2;
        const r = Math.sqrt(e.rng.next()) * e.homeRadius;
        ai.wx = e.home.x + Math.cos(a) * r;
        ai.wz = e.home.z + Math.sin(a) * r;
        ai.wander = true;
      }
      aimHop(e, ai.wx, ai.wz, WANDER_HOP);
    }
    if (hopStep(e, h, ctx, false)) {
      const p = e.position;
      if (Math.hypot(ai.wx - p.x, ai.wz - p.z) < 0.4 || e.stuck) {
        ai.wander = false;
        ai.pause = F(e.rng.int(30, 120));
        e.resetSeek(); // the stuck counter and any detour
      }
    }
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {SlimeAI} */ (e.ai);
    const tp = e.tp;
    if (ai.cd > 0) ai.cd -= h;
    const reach = e.canMelee(ctx);
    if (ai.hop < F(CROUCH_F) - EPS && ai.cd <= 0 && reach && tp.d <= ATTACK_RANGE && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.hop = 0;
      e.lift = 0;
      e.setState('windup');
      return;
    }
    if (ai.hop === 0) {
      const p = e.position;
      if (reach && tp.d <= ATTACK_RANGE + 0.6) {
        // close but waiting (cooldown / token): hop around the player, never stand still
        if (e.rng.chance(0.25)) ai.side = -ai.side;
        const sx = -tp.dz * ai.side;
        const sz = tp.dx * ai.side;
        const back = tp.d < 1.3 ? -0.6 : 0;
        aimHop(e, p.x + (sx + tp.dx * back) * 2, p.z + (sz + tp.dz * back) * 2, HOP_DIST * 0.6);
      } else {
        const c = e.chasePoint(ctx);
        aimHop(e, c.x, c.z, Math.min(HOP_DIST, Math.max(0.3, tp.d - 1.2)));
      }
    }
    hopStep(e, h, ctx, true);
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {SlimeAI} */ (e.ai);
    const P = ctx.player.position;
    const p = e.position;
    if (e.state === 'windup') {
      if (e.entered) ctx.sfx('slimeHop', p.x, p.z);
      e.face(P.x, P.z);
      e.pose('windup');
      if (e.after(WINDUP_F)) {
        ai.leapX = e.facing.x;
        ai.leapZ = e.facing.z;
        ai.tag = e.newTag();
        e.setState('active');
      }
      return;
    }
    if (e.state === 'active') {
      if (e.after(LEAP_F)) {
        e.lift = 0;
        ctx.burst('footstep', p.x, p.y + 0.05, p.z, 4);
        e.setState('recover');
        return;
      }
      e.pose('attack');
      const step = Math.min(h, F(LEAP_F) - e.t);
      if (step > 0) e.move(ai.leapX * (LEAP_DIST / F(LEAP_F)) * step, ai.leapZ * (LEAP_DIST / F(LEAP_F)) * step, ctx);
      const u = Math.min(1, (e.t + h) / F(LEAP_F));
      e.lift = LEAP_ARC * 4 * u * (1 - u);
      const s = e.hitSpec();
      s.shape = 'circle';
      s.r = 0.6;
      s.mv = 1.0;
      s.kb = 0.8;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      return;
    }
    // recover
    e.pose('land');
    if (e.after(RECOVER_F)) {
      e.dropToken(ctx);
      ai.cd = F(COOLDOWN_F);
      ai.hop = 0;
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    /** @type {SlimeAI} */ (e.ai).hop = 0;
    e.lift = 0;
  },
};

/**
 * Set the next hop's target: toward (x, z), at most `dist` away.
 * @param {Enemy} e
 * @param {number} x
 * @param {number} z
 * @param {number} dist
 */
function aimHop(e, x, z, dist) {
  const ai = /** @type {SlimeAI} */ (e.ai);
  const p = e.position;
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    ai.tx = p.x;
    ai.tz = p.z;
    ai.v = 0;
    return;
  }
  const k = Math.min(dist, d) / d;
  ai.tx = p.x + dx * k;
  ai.tz = p.z + dz * k;
  ai.v = (d * k) / F(AIR_F);
}

/**
 * Advance the hop cycle by h: crouch, airborne (moving toward the hop target through `seek`,
 * so blocked hops count toward the stuck test), landing. Returns true when a cycle ended.
 * The airborne speed is fixed when the hop is aimed (hop length / 27 f): a speed recomputed from
 * the distance left over the time left grew without bound while `seek` walked a detour away from
 * the target (slimes were flung up to ~11 u in one frame). A detour ends with its hop.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 * @param {boolean} loud the crouch plays `slimeHop` (chase hops, not the idle wander)
 * @returns {boolean}
 */
function hopStep(e, h, ctx, loud) {
  const ai = /** @type {SlimeAI} */ (e.ai);
  const t = ai.hop;
  const p = e.position;
  if (t < F(CROUCH_F) - EPS) {
    e.lift = 0;
    e.pose('move0');
    if (t + h >= F(CROUCH_F) - EPS && loud) ctx.sfx('slimeHop', p.x, p.z);
  } else if (t < F(CROUCH_F + AIR_F) - EPS) {
    const u0 = (t - F(CROUCH_F)) / F(AIR_F);
    const u = Math.min(1, u0 + h / F(AIR_F));
    e.lift = HOP_ARC * 4 * u * (1 - u);
    e.pose(u0 < 0.5 ? 'move1' : 'move2');
    if (ai.v > 0 && Math.hypot(ai.tx - p.x, ai.tz - p.z) > 1e-3) e.seek(ai.tx, ai.tz, ai.v, h, ctx, null);
  } else {
    e.lift = 0;
    e.pose('land');
  }
  ai.hop = t + h;
  if (ai.hop >= F(HOP_F) - EPS) {
    ai.hop = 0;
    e.endDetour();
    return true;
  }
  return false;
}
