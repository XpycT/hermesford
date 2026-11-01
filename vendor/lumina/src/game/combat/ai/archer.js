import { aimVy } from '../Projectiles.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain } from '../types.js'
 */

/**
 * Thorn Archer — ranged kiter (COMBAT.md §7.7).
 *
 * Keeps 5–9 u: d < 4.5 → retreats along the best of 8 directions (distance gained, walkable
 * probes, a way the body fits on the walk grid) at 3.0 u/s; a retreat that has not moved for 20 f
 * (cornered) strafes for 60 f instead — it used to walk into the wall, harmless, for good; d > 10 →
 * approaches; otherwise strafes 60–120 f at a time. While it wants to
 * shoot but stands off screen it approaches (ignoring the outer bound) until it is on screen.
 *
 * Shot (ranged token, LOS, on screen, 4.5 ≤ d ≤ 11): wind-up 48 f (pose `windup` = bow drawn,
 * SFX `windup`) with a lane marker (width 0.5, length min(d + 2, 14), draped) that tracks the
 * predicted point P = player + velocity · 0.25 s for 33 f, then locks for 15 f; at progress 1 an
 * `arrow` leaves from ground + 0.9 toward P with vy aimed at groundAt(P) + 0.9 (§7.6): 14 u/s,
 * range 14, radius 0.2, mv 1.0, kb 0.4; the lane fades over the flight time; recover 18 f (pose
 * `attack`); cooldown 108–144 f (seeded). Every 3rd shot is a volley of 3 arrows at −12°, 0°, +12°
 * (three lanes, the same vy). Shove when the player stays within 1.6 u for 60 f: wind-up 18 f,
 * sector r 1.2 ±50°, mv 0.6, kb 1.5, then retreat.
 */
/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const DEG = Math.PI / 180;

const RETREAT_BELOW = 4.5;
const APPROACH_ABOVE = 10;
const SHOT_MIN = 4.5;
const SHOT_MAX = 11;
const WINDUP_F = 48;
const TRACK_F = 33;
const LEAD_S = 0.25;
const ARROW_SPEED = 14;
const ARROW_RANGE = 14;
const LANE_MAX = 14;
const LANE_WIDTH = 0.5;
const RECOVER_F = 18;
const VOLLEY = [-12 * DEG, 0, 12 * DEG];
const HUG_R = 1.6;
const HUG_F = 60;
const SHOVE_WINDUP_F = 18;
const SHOVE_ACTIVE_F = 4;
const SHOVE_RECOVER_F = 12;
const SPEED = 3.0;
/** A retreat blocked this long (cornered) strafes for CORNER_STRAFE_F instead. */
const CORNER_F = 20;
const CORNER_STRAFE_F = 60;
const STRAFE_SPEED = 2.2;

/** @typedef {Required<ReturnType<typeof archer.init>>} ArcherAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const archer = {
  init(e) {
    return {
      cd: F(e.rng.int(20, 60)),
      shots: 0,
      side: e.rng.chance(0.5) ? 1 : -1,
      strafeT: F(e.rng.int(60, 120)),
      awayT: 0, retreatT: 0, blockT: 0, cornerT: 0,
      hugT: 0,
      los: false, losT: 0,
      move: 'shot', n: 1,
      px: 0, pz: 0,
      tag: 0,
    };
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {ArcherAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.retreatT > 0) ai.retreatT -= h;
    if (ai.cornerT > 0) ai.cornerT -= h;
    ai.hugT = tp.d < HUG_R ? ai.hugT + h : 0;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }

    if (ai.hugT >= F(HUG_F) - 1e-6 && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.move = 'shove';
      e.setState('windup');
      return;
    }
    const wants = ai.cd <= 0;
    const onScreen = e.canWindup(ctx);
    if (wants && tp.d >= SHOT_MIN && tp.d <= SHOT_MAX && ai.los && onScreen && e.takeToken(ctx)) {
      ai.move = 'shot';
      e.setState('windup');
      return;
    }

    if ((tp.d < RETREAT_BELOW || ai.retreatT > 0) && ai.cornerT <= 0) {
      ai.awayT -= h;
      if (ai.awayT <= 0) {
        if (!e.bestAway(P.x, P.z, 1.5, ctx, true)) {
          e.away.x = -tp.dx;
          e.away.z = -tp.dz;
        }
        ai.awayT = F(12);
      }
      const fr = e.walk(e.away.x, e.away.z, SPEED, h, ctx, 'walk');
      ai.blockT = fr < 0.25 ? ai.blockT + h : 0;
      if (ai.blockT >= F(CORNER_F) - 1e-6) {
        // cornered: strafe (and so shove a player who stays close) instead of pushing at the wall
        ai.blockT = 0;
        ai.retreatT = 0;
        ai.cornerT = F(CORNER_STRAFE_F);
      }
      return;
    }
    if (tp.d > APPROACH_ABOVE || (wants && !onScreen)) {
      e.chase(SPEED, h, ctx, 'walk');
      return;
    }
    // strafe (also finds a line of sight again)
    ai.strafeT -= h;
    if (ai.strafeT <= 0) {
      if (e.rng.chance(0.5)) ai.side = -ai.side;
      ai.strafeT = F(e.rng.int(60, 120));
    }
    const fr = e.walk(-tp.dz * ai.side, tp.dx * ai.side, STRAFE_SPEED, h, ctx, 'walk', false);
    e.face(P.x, P.z);
    if (fr < 0.25) ai.side = -ai.side;
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {ArcherAI} */ (e.ai);
    if (ai.move === 'shove') {
      shove(e, h, ctx);
      return;
    }
    const P = ctx.player;
    const p = e.position;
    if (e.state === 'windup') {
      if (e.entered) {
        ctx.sfx('windup', p.x, p.z);
        ai.n = ai.shots % 3 === 2 ? 3 : 1;
      }
      if (e.t < F(TRACK_F) - 1e-6) {
        ai.px = P.position.x + P.velocity.x * LEAD_S;
        ai.pz = P.position.z + P.velocity.z * LEAD_S;
        e.face(ai.px, ai.pz);
      }
      e.pose('windup');
      if (e.after(WINDUP_F)) {
        release(e, ctx);
        e.setState('recover');
        return;
      }
      lanes(e, ctx, e.t / F(WINDUP_F));
      return;
    }
    // recover
    e.pose('attack');
    if (e.after(RECOVER_F)) {
      e.dropToken(ctx);
      ai.cd = F(e.rng.int(108, 144));
      e.setState('engage');
    }
  },
};

/**
 * Show / update the lane marker(s) toward the predicted point.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @param {number} progress
 */
function lanes(e, ctx, progress) {
  const ai = /** @type {ArcherAI} */ (e.ai);
  const p = e.position;
  const d = Math.hypot(ai.px - p.x, ai.pz - p.z);
  const len = Math.min(d + 2, LANE_MAX);
  for (let i = 0; i < ai.n; i++) {
    const a = ai.n === 1 ? 0 : VOLLEY[i];
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = e.facing.x * c - e.facing.z * s;
    m.dirZ = e.facing.x * s + e.facing.z * c;
    m.len = len;
    m.width = LANE_WIDTH;
    m.progress = Math.min(1, progress);
    m.flash = e.lockFlash(e.t - F(TRACK_F));
    e.mark(i, ctx, m);
  }
}

/**
 * Progress 1: the arrow(s) leave from ground + 0.9 aimed (vy) at groundAt(P) + 0.9 (§7.6).
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function release(e, ctx) {
  const ai = /** @type {ArcherAI} */ (e.ai);
  const p = e.position;
  lanes(e, ctx, 1);
  const dist = Math.hypot(ai.px - p.x, ai.pz - p.z);
  const y = p.y + 0.9;
  const vy = aimVy(y, ctx.groundAt(ai.px, ai.pz) + 0.9, ARROW_SPEED, dist);
  for (let i = 0; i < ai.n; i++) {
    const a = ai.n === 1 ? 0 : VOLLEY[i];
    const c = Math.cos(a);
    const s = Math.sin(a);
    const ps = e.projSpec();
    ps.kind = 'arrow';
    ps.y = y;
    ps.dirX = e.facing.x * c - e.facing.z * s;
    ps.dirZ = e.facing.x * s + e.facing.z * c;
    ps.vy = vy;
    ps.speed = ARROW_SPEED;
    ps.range = ARROW_RANGE;
    ps.radius = 0.2;
    ps.mv = 1.0;
    ps.kb = 0.4;
    ctx.projectile(e, ps);
    e.markToFade(i, ctx, Math.min(dist + 2, LANE_MAX) / ARROW_SPEED);
  }
  ctx.sfx('arrow', p.x, p.z);
  ai.shots++;
}

/**
 * Shove: wind-up 18 f, sector r 1.2 ±50° (mv 0.6, kb 1.5) for 4 f, recover 12 f, then retreat.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function shove(e, h, ctx) {
  const ai = /** @type {ArcherAI} */ (e.ai);
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('windup', e.position.x, e.position.z);
    if (e.t < F(SHOVE_WINDUP_F - 6) - 1e-6) e.face(P.x, P.z);
    e.pose('wind');
    if (e.after(SHOVE_WINDUP_F)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(SHOVE_ACTIVE_F)) {
      e.setState('recover');
      return;
    }
    e.pose('shove');
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = 1.2;
    s.halfAngle = 50;
    s.mv = 0.6;
    s.kb = 1.5;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose('follow');
  if (e.after(SHOVE_RECOVER_F)) {
    e.dropToken(ctx);
    ai.hugT = 0;
    ai.retreatT = F(45);
    ai.awayT = 0;
    ai.move = 'shot';
    e.setState('engage');
  }
}
