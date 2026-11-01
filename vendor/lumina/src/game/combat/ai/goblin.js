/**
 * Bramble Goblin — melee flanker (COMBAT.md §7.7).
 *
 * Approaches to 3.0 u at 3.0 u/s, then circle-strafes at radius 2.5–3.5 u at 2.5 u/s; the strafe
 * direction flips on a seeded coin every 90–180 f (and at once when the strafe is blocked).
 * Attack at d ≤ 3.2 with a token: wind-up 27 f (pose `windup`, SFX `windup`) during which it steps
 * in to ~1.5 u (the facing locks for the last 6 f), a 0.8 u lunge over 6 f with a slash (active
 * f0–5: sector r 1.3 ±60°, mv 1.0, kb 0.6); 30 % (seeded) a follow-up with its own 18 f wind-up
 * (flash re-pulse, §7.3) and a second slash (pose `attack2`, same hit, 0.4 u lunge, token kept);
 * recover 36 f; cooldown 60 f. When the player starts a melee attack within 2.0 u and the goblin is
 * not attacking: 20 % (seeded) back-hop 1.2 u over 10 f (cooldown 90 f). A player out of melee
 * reach (`e.canMelee(ctx)` false: on a ledge above, or across a stair's side) is chased along the
 * walk grid, never wound up at.
 */

/** @import { Brain } from '../types.js' */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;

const APPROACH = 3.0;
const STRAFE_MIN = 2.5;
const STRAFE_MAX = 3.5;
const ATTACK_RANGE = 3.2;
const STEP_IN = 1.5;
const WINDUP_F = 27;
const FOLLOW_WINDUP_F = 18;
const LOCK_F = 6;
const ACTIVE_F = 6;
const LUNGE = 0.8;
const LUNGE2 = 0.4;
const FOLLOW_CHANCE = 0.3;
const RECOVER_F = 36;
const COOLDOWN_F = 60;
const HOP_CHANCE = 0.2;
const HOP_DIST = 1.2;
const HOP_F = 10;
const HOP_COOLDOWN_F = 90;

/**
 * Player actions that count as "starts a melee attack" (`PlayerAction` in ../types.d.ts): every
 * combo step and the roll slash run as 'attack', Whirl Slash as 'skill1' (`SKILLS[0].id`); Ember
 * Bolt and Radiant Nova are not melee. 'a1'–'a3' are the enemies sandbox mock's swings.
 */
const MELEE_ACTION = /^(attack|skill1|a[123])$/;

/** @typedef {Required<ReturnType<typeof goblin.init>>} GoblinAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const goblin = {
  init(e) {
    return {
      side: e.rng.chance(0.5) ? 1 : -1,
      flip: F(e.rng.int(90, 180)),
      blocked: 0,
      cd: 0,
      follow: false,
      tag: 0,
      lx: 0, lz: 1,
      hopT: -1, hopX: 0, hopZ: 0, hopCd: 0,
      prevAction: null,
      prevSwing: 0,
    };
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {GoblinAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.hopCd > 0) ai.hopCd -= h;

    // back-hop in progress
    if (ai.hopT >= 0) {
      const T = F(HOP_F);
      const t1 = Math.min(T, ai.hopT + h);
      const s = HOP_DIST * ((1 - (1 - t1 / T) ** 2) - (1 - (1 - ai.hopT / T) ** 2));
      e.move(ai.hopX * s, ai.hopZ * s, ctx);
      e.face(P.position.x, P.position.z);
      e.pose('tuck');
      ai.hopT = t1 >= T - 1e-6 ? -1 : t1;
      return;
    }
    // the player just started a melee swing close by: maybe hop back
    // (a new combo step keeps the action name 'attack': `P.swing` counts every swing started)
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
        e.pose('tuck');
        return;
      }
    }

    const wants = ai.cd <= 0;
    const reach = e.canMelee(ctx);
    if (wants && reach && tp.d <= ATTACK_RANGE && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.follow = false;
      e.setState('windup');
      return;
    }
    // off screen (wants to attack), far or out of melee height: approach; else circle-strafe
    // facing the player
    if (tp.d > STRAFE_MAX || !reach || (wants && tp.d > ATTACK_RANGE - 0.3 && !e.canWindup(ctx))) {
      e.chase(3.0, h, ctx, 'walk');
      return;
    }
    ai.flip -= h;
    if (ai.flip <= 0) {
      if (e.rng.chance(0.5)) ai.side = -ai.side;
      ai.flip = F(e.rng.int(90, 180));
    }
    let dx = -tp.dz * ai.side;
    let dz = tp.dx * ai.side;
    // hold the approach radius (3.0) while circling: inside 2.5 back off, beyond it close in
    const radial = tp.d < STRAFE_MIN ? -0.7 : Math.max(-0.5, Math.min(0.8, (tp.d - APPROACH) * 1.6));
    dx += tp.dx * radial;
    dz += tp.dz * radial;
    const l = Math.hypot(dx, dz) || 1;
    const fr = e.walk(dx / l, dz / l, 2.5, h, ctx, 'walk', false);
    e.face(P.position.x, P.position.z);
    ai.blocked = fr < 0.25 ? ai.blocked + h : 0;
    if (ai.blocked > F(12)) {
      ai.side = -ai.side;
      ai.blocked = 0;
    }
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {GoblinAI} */ (e.ai);
    const P = ctx.player.position;
    const tp = e.tp;
    if (e.state === 'windup') {
      const dur = ai.follow ? FOLLOW_WINDUP_F : WINDUP_F;
      if (e.entered) ctx.sfx('windup', e.position.x, e.position.z);
      e.pose('windup');
      // track the player until the last 6 f (the dodge cue), then the slash direction is fixed
      if (e.t < F(dur - LOCK_F) - 1e-6) {
        e.face(P.x, P.z);
        // step in while winding up (the first wind-up only), so the slash can connect
        if (!ai.follow && tp.d > STEP_IN) e.walk(tp.dx, tp.dz, 2.5, h, ctx, null, false);
      }
      if (e.after(dur)) {
        ai.lx = e.facing.x;
        ai.lz = e.facing.z;
        ai.tag = e.newTag();
        e.setState('active');
      }
      return;
    }
    if (e.state === 'active') {
      if (e.after(ACTIVE_F)) {
        if (!ai.follow && e.rng.chance(FOLLOW_CHANCE)) {
          ai.follow = true;
          e.setState('windup');
        } else {
          e.setState('recover');
        }
        return;
      }
      e.pose(ai.follow ? 'attack2' : 'attack');
      const lunge = ai.follow ? LUNGE2 : LUNGE;
      const v = lunge / F(ACTIVE_F);
      e.move(ai.lx * v * h, ai.lz * v * h, ctx);
      const s = e.hitSpec();
      s.shape = 'sector';
      s.r = 1.3;
      s.halfAngle = 60;
      s.dirX = ai.lx;
      s.dirZ = ai.lz;
      s.mv = 1.0;
      s.kb = 0.6;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      if (e.entered) ctx.sfx('swing', e.position.x, e.position.z);
      return;
    }
    // recover: follow-through, then stand guard
    if (e.fr < 12) e.pose('follow');
    else {
      e.face(P.x, P.z);
      e.anim('idle');
    }
    if (e.after(RECOVER_F)) {
      e.dropToken(ctx);
      ai.cd = F(COOLDOWN_F);
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    /** @type {GoblinAI} */ (e.ai).follow = false;
    /** @type {GoblinAI} */ (e.ai).hopT = -1;
  },
};
