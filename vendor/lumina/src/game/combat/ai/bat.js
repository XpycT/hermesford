/**
 * Cinder Bat — flier swarm (COMBAT.md §7.7). Flies with `ctx.moveFly` (ignores terrain and
 * colliders; clamped to home ± (radius + 8), the map and the arena exclusion); its group Y stays on
 * the ground and the quad / shadow proxy hover at `e.hover` (the blob stays on the ground).
 *
 * - Idle: flap-hovers in slow circles around its home; hover 1.3 + 0.15 sin(4t); eyes glow
 *   (`uGlow` (1.0, 0.3, 0.1) × 2.5).
 * - Engage: orbits the player at radius 3–4 u, 1.4 rad/s ± seeded noise, seeded direction.
 * - **Swoop** (token, on screen, every 90–180 f): wind-up 18 f (pose `windup`, SFX `batScreech`,
 *   circle marker r 0.6 at the dive point = the player's position at wind-up start), a dive at
 *   9 u/s straight through the dive point for ceil((dist + 1.5) / 9 · 60) f (dist = horizontal
 *   distance to the dive point at dive start; hover drops to 0.6; circle r 0.5 around the bat's
 *   ground point each sub-step, mv 1.0, kb 0.4), then a 36 f climb back to the hover height.
 * - Poise 0 (every hit interrupts), knockback ×1.5 (Enemy). Death: falls to the ground over 12 f,
 *   then fades (Enemy).
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { Brain, CombatContext } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;

const HOVER = 1.3;
const BOB = 0.15;
const DIVE_HOVER = 0.6;
const ORBIT_W = 1.4;
const WINDUP_F = 18;
const DIVE_SPEED = 9;
const CLIMB_F = 36;
const MARK_R = 0.6;

/** @typedef {Required<ReturnType<typeof bat.init>>} BatAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const bat = {
  init(e) {
    return {
      dir: e.rng.chance(0.5) ? 1 : -1,
      w: ORBIT_W + e.rng.range(-0.25, 0.25),
      R: e.rng.range(3, 4),
      ang: e.rng.next() * Math.PI * 2,
      idleAng: e.rng.next() * Math.PI * 2,
      cd: F(e.rng.int(90, 180)),
      diveX: 0, diveZ: 0, dx: 0, dz: 1, diveF: 0,
      tag: 0,
      clock: e.rng.next() * 10,
    };
  },

  /** Slow circles around home. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {BatAI} */ (e.ai);
    bob(e, h);
    ai.idleAng += 0.8 * h * ai.dir;
    const r = Math.min(1.2, e.homeRadius);
    const tx = e.home.x + Math.cos(ai.idleAng) * r;
    const tz = e.home.z + Math.sin(ai.idleAng) * r;
    fly(e, tx, tz, 1.5, h, ctx);
    e.anim('idle');
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {BatAI} */ (e.ai);
    const P = ctx.player.position;
    bob(e, h);
    if (ai.cd > 0) ai.cd -= h;
    if (ai.cd <= 0 && e.canWindup(ctx) && e.takeToken(ctx)) {
      ai.diveX = P.x;
      ai.diveZ = P.z;
      e.setState('windup');
      return;
    }
    // orbit (off screen with a swoop due: close in until on screen)
    const closing = ai.cd <= 0 && !e.canWindup(ctx);
    ai.ang += ai.w * ai.dir * h;
    const R = closing ? Math.max(1.5, ai.R - 1.5) : ai.R;
    const tx = P.x + Math.cos(ai.ang) * R;
    const tz = P.z + Math.sin(ai.ang) * R;
    fly(e, tx, tz, e.def.speed, h, ctx);
    e.face(P.x, P.z);
    e.anim('walk');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {BatAI} */ (e.ai);
    const p = e.position;
    if (e.state === 'windup') {
      bob(e, h);
      if (e.entered) ctx.sfx('batScreech', p.x, p.z);
      e.face(ai.diveX, ai.diveZ);
      e.pose('windup');
      const m = e.markerSpec('circle', ai.diveX, ai.diveZ);
      m.r = MARK_R;
      m.progress = Math.min(1, e.t / F(WINDUP_F));
      e.mark(0, ctx, m);
      if (e.after(WINDUP_F)) {
        const dx = ai.diveX - p.x;
        const dz = ai.diveZ - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) {
          ai.dx = dx / dist;
          ai.dz = dz / dist;
        } else {
          ai.dx = e.facing.x;
          ai.dz = e.facing.z;
        }
        ai.diveF = Math.ceil(((dist + 1.5) / DIVE_SPEED) * 60);
        ai.tag = e.newTag();
        e.markProgress(0, ctx, 1);
        e.setState('active');
      }
      return;
    }
    if (e.state === 'active') {
      if (e.after(ai.diveF)) {
        e.unmark(0, ctx);
        e.setState('recover');
        return;
      }
      e.pose('attack');
      e.hover += (DIVE_HOVER - e.hover) * Math.min(1, h / F(6));
      e.move(ai.dx * DIVE_SPEED * h, ai.dz * DIVE_SPEED * h, ctx);
      const s = e.hitSpec();
      s.shape = 'circle';
      s.r = 0.5;
      s.mv = 1.0;
      s.kb = 0.4;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      return;
    }
    // recover: climb back over 36 f
    const u = Math.min(1, (e.t + h) / F(CLIMB_F));
    e.hover = DIVE_HOVER + (HOVER - DIVE_HOVER) * (1 - (1 - u) * (1 - u));
    e.anim('walk');
    if (e.after(CLIMB_F)) {
      e.dropToken(ctx);
      ai.cd = F(e.rng.int(90, 180));
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    e.lift = 0;
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    out[0] = 1.0;
    out[1] = 0.3;
    out[2] = 0.1;
    out[3] = e.alive ? 2.5 : 0;
  },
};

/**
 * Hover 1.3 + 0.15 sin(4t) (eased back from a dive).
 * @param {Enemy} e
 * @param {number} h
 */
function bob(e, h) {
  const ai = /** @type {BatAI} */ (e.ai);
  ai.clock += h;
  const target = HOVER + BOB * Math.sin(4 * ai.clock);
  e.hover += (target - e.hover) * Math.min(1, h * 10);
}

/**
 * Fly toward a point at up to `speed` u/s.
 * @param {Enemy} e
 * @param {number} tx
 * @param {number} tz
 * @param {number} speed
 * @param {number} h
 * @param {CombatContext} ctx
 */
function fly(e, tx, tz, speed, h, ctx) {
  const p = e.position;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return;
  const s = Math.min(d, speed * h);
  e.move((dx / d) * s, (dz / d) * s, ctx);
}
