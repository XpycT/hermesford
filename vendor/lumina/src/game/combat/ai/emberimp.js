/**
 * Ember Imp — the swarms' flier (Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §5.3,
 * §6.7; COMBAT.md §7.3–7.7). Owner: the swarm package. Flies with `ctx.moveFly` (over terrain and
 * colliders) at hover 1.6 + 0.15 sin(4t); its place in the pack (the helpers of ./kobold.js) is on a
 * high ring round the target (5.0 u, the outer half 5.9) that it circles slowly (≈ 20°/s, seeded
 * direction), so a cloud of imps wheels over the fight.
 *
 * - **Fire orb** (2.5 ≤ d ≤ 9, line of sight, on screen, a ranged token; cooldown 150–260 f):
 *   wind-up 30 f (pose `windup` = cast: the orb growing between its hands; SFX `cackle`; the glow
 *   rises) with a lane marker (width 0.45, to the predicted point + 2 u, ≤ 10) tracking the target's
 *   position 0.3 s ahead for 18 f, locked for the last 12 f; at progress 1 the orb flies from its
 *   hands (8.5 u/s, radius 0.25, mv 0.85, kb 0.3, aimed down at the body's middle, §7.6) and the lane
 *   fades over its flight; recover 16 f (pose `attack`). Every third cast throws two orbs at ±9°.
 * - **Diving burst** (2.5 ≤ d ≤ 6.5, on screen, a token; cooldown 360–540 f, the first after 5–10 s):
 *   wind-up 30 f (pose `flare`:
 *   the wings thrown up, a shriek — SFX `screech`; it rises to 2.2) with a circle marker r 1.5 at the
 *   target's position 0.2 s ahead, filling to 0.7 over the wind-up; the dive (pose `dive`) at
 *   ≈ 11 u/s down to 0.3 above the ground fills it to 1 as it lands: a burst there — circle r 1.5
 *   (mv 1.2, kb 1.2), embers, ash, dust, a small shake; it hangs low for 14 f (open to a riposte),
 *   then climbs back over 36 f, wheeling out to its place.
 * - Glow (`uGlow` (1.0, 0.45, 0.12)): it smoulders (× 1.3), burns up to × 3 over a cast and × 3.2 in the
 *   flare and dive. Poise 0, knockback × 1.5 (Enemy). Death: it falls (Enemy) in a puff of embers.
 */
import { aimVy } from '../Projectiles.js';
import { packInit, packPoint, flanking } from './kobold.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { Brain, CombatContext } from '../types.js'
 * @import { PackState } from './kobold.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

const HOVER = 1.6;
const BOB = 0.15;
const RING = 5.0;
const TIER = 0.9;
const NEAR = 3.0;
const RUSH = 5.6;
const ORBIT = 0.35;
const ORB_MIN = 2.5;
const ORB_MAX = 9.0;
const ORB_WINDUP_F = 30;
const ORB_TRACK_F = 18;
const ORB_LEAD = 0.3;
const ORB_SPEED = 8.5;
const ORB_LEN_MAX = 10;
const ORB_WIDTH = 0.45;
const ORB_RECOVER_F = 16;
const TWIN = 9 * DEG;
/** The orb's projectile kind (Projectiles.js LOOKS: the swarm atlas frame, sparks at its end). */
const ORB_KIND = 'swarmOrb';
const DIVE_MIN = 2.5;
const DIVE_MAX = 6.5;
const DIVE_WINDUP_F = 30;
const DIVE_LEAD = 0.2;
const DIVE_R = 1.5;
const DIVE_SPEED = 11;
const DIVE_HOVER = 0.3;
const DIVE_RISE = 2.2;
const DIVE_MARK = 0.7;
const DIVE_LOW_F = 14;
const DIVE_CLIMB_F = 36;
const GLOW = Object.freeze([1.0, 0.45, 0.12]);
/** uGlow strength: smouldering, and at the height of a cast, the flare and the dive. */
const GLOW_BASE = 1.3;
const GLOW_HOT = 3.2;

/**
 * @typedef {PackState & { cdO: number, cdD: number, move: 'orb'|'dive', casts: number, n: number,
 *   px: number, pz: number, lx: number, lz: number, len: number, dx: number, dz: number, diveF: number,
 *   h0: number, phase: 'windup'|'dive'|'low'|'climb', tag: number, los: boolean, losT: number,
 *   clock: number, idleAng: number, glow: number }} ImpAI the brain state (`e.ai`)
 */

/** @satisfies {Brain} */
export const emberimp = {
  init(e) {
    return {
      ...packInit(e, RING, TIER),
      cdO: F(e.rng.int(40, 160)),
      cdD: F(e.rng.int(300, 600)),
      move: /** @type {'orb'|'dive'} */ ('orb'),
      casts: 0, n: 1,
      px: 0, pz: 0, lx: 0, lz: 1, len: 6,
      dx: 0, dz: 1, diveF: 1, h0: HOVER,
      phase: /** @type {'windup'|'dive'|'low'|'climb'} */ ('windup'),
      tag: 0,
      los: false, losT: 0,
      clock: e.rng.next() * 10,
      idleAng: e.rng.next() * Math.PI * 2,
      glow: GLOW_BASE,
    };
  },

  /** Slow circles round home. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {ImpAI} */ (e.ai);
    bob(e, ai, h);
    ai.idleAng += 0.7 * h * ai.swayDir;
    const r = Math.min(1.4, e.homeRadius);
    fly(e, e.home.x + Math.cos(ai.idleAng) * r, e.home.z + Math.sin(ai.idleAng) * r, 1.6, h, ctx);
    e.anim('idle');
    ai.glow += (GLOW_BASE - ai.glow) * Math.min(1, h * 4);
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {ImpAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    bob(e, ai, h);
    if (ai.cdO > 0) ai.cdO -= h;
    if (ai.cdD > 0) ai.cdD -= h;
    ai.glow += (GLOW_BASE - ai.glow) * Math.min(1, h * 4);
    const near = tp.d <= ai.ring + NEAR;
    if (near) {
      if (ai.cdD <= 0 && tp.d >= DIVE_MIN && tp.d <= DIVE_MAX && e.canWindup(ctx) && e.takeToken(ctx)) {
        ai.move = 'dive';
        ai.phase = 'windup';
        ai.px = P.x + ctx.player.velocity.x * DIVE_LEAD;
        ai.pz = P.z + ctx.player.velocity.z * DIVE_LEAD;
        ai.h0 = e.hover;
        e.setState('windup');
        return;
      }
      ai.losT -= h;
      if (ai.losT <= 0) {
        ai.los = ctx.los(p.x, p.z, P.x, P.z);
        ai.losT = F(10);
      }
      if (ai.cdO <= 0 && ai.los && tp.d >= ORB_MIN && tp.d <= ORB_MAX && e.canWindup(ctx) && e.takeToken(ctx)) {
        ai.move = 'orb';
        ai.n = ai.casts % 3 === 2 ? 2 : 1;
        e.setState('windup');
        return;
      }
      // wheel round the target on its ring
      ai.off += ai.swayDir * ORBIT * h;
      packPoint(e, ai, ctx, ai.ring + Math.sin(ai.clock * 0.7) * 0.4, 3, 3);
      fly(e, ai.tx, ai.tz, e.def.speed, h, ctx);
    } else {
      packPoint(e, ai, ctx, ai.ring, 3, 4);
      fly(e, ai.tx, ai.tz, tp.d > 9 ? RUSH : e.def.speed, h, ctx);
    }
    e.face(P.x, P.z);
    e.anim('walk');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {ImpAI} */ (e.ai);
    if (ai.move === 'dive') dive(e, h, ctx);
    else orb(e, h, ctx);
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    e.lift = 0;
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.burst('swarmSpark', p.x, p.y + e.hover, p.z, 8);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {ImpAI} */ (e.ai);
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = e.alive ? (ai ? ai.glow : GLOW_BASE) : 0;
  },
};

/**
 * Hover 1.6 + 0.15 sin(4t), eased back from a dive.
 * @param {Enemy} e
 * @param {ImpAI} ai
 * @param {number} h
 */
function bob(e, ai, h) {
  ai.clock += h;
  const target = HOVER + BOB * Math.sin(4 * ai.clock);
  e.hover += (target - e.hover) * Math.min(1, h * 6);
}

/**
 * Fly toward a point at up to `speed` u/s (no stops: `moveFly`).
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

/**
 * The fire orb (one, or two at ±9°): tracked, then locked lanes; released at progress 1.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function orb(e, h, ctx) {
  const ai = /** @type {ImpAI} */ (e.ai);
  const P = ctx.player;
  const p = e.position;
  if (e.state === 'windup') {
    bob(e, ai, h);
    if (e.entered) ctx.sfx('cackle', p.x, p.z, { volume: 0.6, pitch: 1 + (e.index % 4) * 0.06 });
    e.pose('windup');
    const prog = Math.min(1, e.t / F(ORB_WINDUP_F));
    ai.glow = GLOW_BASE + 1.7 * prog;
    if (e.t < F(ORB_TRACK_F) - EPS) {
      ai.px = P.position.x + P.velocity.x * ORB_LEAD;
      ai.pz = P.position.z + P.velocity.z * ORB_LEAD;
      e.face(ai.px, ai.pz);
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.len = Math.min(ORB_LEN_MAX, Math.hypot(ai.px - p.x, ai.pz - p.z) + 2);
    }
    for (let i = 0; i < ai.n; i++) {
      const a = ai.n === 1 ? 0 : (i ? TWIN : -TWIN);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const m = e.markerSpec('lane', p.x, p.z);
      m.dirX = ai.lx * c - ai.lz * s;
      m.dirZ = ai.lx * s + ai.lz * c;
      m.len = ai.len;
      m.width = ORB_WIDTH;
      m.progress = prog;
      m.flash = e.lockFlash(e.t - F(ORB_TRACK_F));
      e.mark(i, ctx, m);
    }
    if (e.after(ORB_WINDUP_F)) {
      const y = p.y + e.hover + 0.1;
      const dist = Math.max(0.5, ai.len - 2);
      const vy = aimVy(y, ctx.groundAt(ai.px, ai.pz) + 0.9, ORB_SPEED, dist);
      for (let i = 0; i < ai.n; i++) {
        const a = ai.n === 1 ? 0 : (i ? TWIN : -TWIN);
        const c = Math.cos(a);
        const s = Math.sin(a);
        e.markProgress(i, ctx, 1);
        const ps = e.projSpec();
        ps.kind = ORB_KIND;
        ps.y = y;
        ps.dirX = ai.lx * c - ai.lz * s;
        ps.dirZ = ai.lx * s + ai.lz * c;
        ps.vy = vy;
        ps.speed = ORB_SPEED;
        ps.range = ai.len;
        ps.radius = 0.25;
        ps.mv = 0.85;
        ps.kb = 0.3;
        ctx.projectile(e, ps);
        e.markToFade(i, ctx, ai.len / ORB_SPEED);
      }
      ctx.sfx('bolt', p.x, p.z, { volume: 0.5, pitch: 1.3 });
      ai.casts++;
      ai.glow = GLOW_HOT;
      e.setState('recover');
    }
    return;
  }
  bob(e, ai, h);
  e.pose('attack');
  if (e.after(ORB_RECOVER_F)) {
    e.dropToken(ctx);
    ai.cdO = F(e.rng.int(150, 260)) * (flanking(e, ctx) ? 0.7 : 1);
    e.setState('engage');
  }
}

/**
 * The diving burst: the flare (marker filling to 0.7), the dive (to 1 at the landing), the burst,
 * a moment low, the climb.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function dive(e, h, ctx) {
  const ai = /** @type {ImpAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('screech', p.x, p.z, { volume: 0.75, pitch: 1.2 + (e.index % 3) * 0.05 });
    e.pose('flare');
    const prog = Math.min(1, e.t / F(DIVE_WINDUP_F));
    ai.glow = GLOW_BASE + (GLOW_HOT - GLOW_BASE) * prog;
    e.hover += (DIVE_RISE - e.hover) * Math.min(1, h * 5);
    e.face(ai.px, ai.pz);
    const m = e.markerSpec('circle', ai.px, ai.pz);
    m.r = DIVE_R;
    m.progress = DIVE_MARK * prog;
    e.mark(0, ctx, m);
    if (e.after(DIVE_WINDUP_F)) {
      const dx = ai.px - p.x;
      const dz = ai.pz - p.z;
      const dist = Math.hypot(dx, dz);
      ai.dx = dist > 1e-4 ? dx / dist : e.facing.x;
      ai.dz = dist > 1e-4 ? dz / dist : e.facing.z;
      ai.len = dist;
      ai.diveF = Math.max(8, Math.min(30, Math.ceil((dist / DIVE_SPEED) * 60)));
      ai.h0 = e.hover;
      ai.tag = e.newTag();
      ai.phase = 'dive';
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    const T = F(ai.diveF);
    if (ai.phase === 'dive') {
      e.pose('dive');
      ai.glow = GLOW_HOT;
      const step = Math.min(h, T - e.t);
      if (step > 0) {
        const v = ai.len / T;
        e.move(ai.dx * v * step, ai.dz * v * step, ctx);
      }
      const u = Math.min(1, (e.t + h) / T);
      e.hover = ai.h0 + (DIVE_HOVER - ai.h0) * u * u;
      e.markProgress(0, ctx, DIVE_MARK + (1 - DIVE_MARK) * u);
      if (e.after(ai.diveF)) {
        // the burst where it lands (the marker's point: progress 1 now)
        const gy = ctx.groundAt(ai.px, ai.pz);
        const s = e.hitSpec();
        s.shape = 'circle';
        s.x = ai.px;
        s.z = ai.pz;
        s.y = gy;
        s.r = DIVE_R;
        s.mv = 1.2;
        s.kb = 1.2;
        s.fromX = ai.px;
        s.fromZ = ai.pz;
        s.tag = ai.tag;
        ctx.hitbox(e, s);
        ctx.burst('swarmFlare', ai.px, gy + 0.3, ai.pz, 14);
        ctx.burst('swarmAsh', ai.px, gy + 0.2, ai.pz, 5);
        ctx.fx('swarmBurst', ai.px, gy, ai.pz);
        ctx.sfx('boltHit', ai.px, ai.pz, { volume: 0.9, pitch: 0.8 });
        ctx.shake(0.05, 0.12);
        e.unmark(0, ctx);
        ai.phase = 'low';
        e.setState('recover');
      }
    }
    return;
  }
  // recover: hang low (open), then climb back
  if (e.t < F(DIVE_LOW_F) - EPS) {
    e.pose('move2');
    e.hover = DIVE_HOVER + 0.1 * Math.sin(Math.PI * e.t / F(DIVE_LOW_F));
    return;
  }
  const u = Math.min(1, (e.t + h - F(DIVE_LOW_F)) / F(DIVE_CLIMB_F));
  e.hover = DIVE_HOVER + (HOVER - DIVE_HOVER) * (1 - (1 - u) * (1 - u));
  // climbing, it wheels back out to its place on the ring
  packPoint(e, ai, ctx, ai.ring, 3, 4);
  fly(e, ai.tx, ai.tz, e.def.speed * 0.8, h, ctx);
  e.face(ctx.player.position.x, ctx.player.position.z);
  e.anim('walk');
  if (e.after(DIVE_LOW_F + DIVE_CLIMB_F)) {
    e.dropToken(ctx);
    ai.cdD = F(e.rng.int(360, 540));
    ai.cdO = Math.max(ai.cdO, F(60));
    ai.phase = 'windup';
    e.setState('engage');
  }
}
