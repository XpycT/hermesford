/**
 * The Hush Cantor (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): a singer of the Hush, from
 * Amberfield on — the Hushguard's support. Owner: the foes package (this brain; its sheet
 * src/engine/pixel/monsters/cantor.js); registered by ./index.js.
 *
 * **The call** — every CALL_S (≈ 6 s, seeded ± 0.5): a 30-frame raise (`raise`: the handbell lifted
 * over the hood, rings of sound gathering over it, `evRing`), then the ring (`ring0` / `ring1`
 * swinging, 24 f; `waysideChime` at × 0.75: its handbell): every **broken** Hushguard within
 * 7 u seals again at once and takes a 4 s ward of −40 % (./hushguard.js `sealHushguard`: a rune ring
 * under it). The raise can be interrupted: a cantor is fragile (55 HP at level 1, poise 12: one
 * combo staggers it) — kill or stagger it before its bell rings. Its attack token is a *ranged* one
 * (`def.token.type`), so the party's "Archers & casters" rule goes for it first.
 *
 * **The hush** — its only attack (3.5 ≤ d ≤ 10, line of sight, cooldown 3–4.5 s; the ranged token):
 * a 24 f wind-up (`windup`: the free hand drawn in; a lane marker tracking 14 f, locked 10 f), a
 * shard of hushed frost (`evShard`, 9 u/s, range 11, mv 0.9, kb 0.4), `attack` for 14 f; recover 22 f.
 *
 * **Its ground**: it keeps its distance — backs off (`step`) inside 4.5 u, closes in beyond 9 u,
 * else drifts sideways round the target at 6–8 u, staying near its knights (it leans toward the
 * nearest Hushguard more than 6 u away).
 *
 * Test hook: `e.ai.force` = 'call' | 'hush' makes that move the next one (cooldowns ignored).
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { Brain, CombatContext, FxOptions, ProjectileLook } from '../../types.js'
 * @import { EnemyPackApi } from '../index.js'
 */
import { cantor as cantorSheet } from '../../../../engine/pixel/monsters/cantor.js';
import { sealHushguard, WARD_S } from './hushguard.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

/** The call: its period (s), the raise and the ring (frames), its reach (u). */
export const CALL_S = 6;
export const CALL_RAISE_F = 30;
const CALL_RING_F = 24;
export const CALL_R = 7;
const HUSH = Object.freeze({ min: 3.5, max: 10, windup: 24, track: 14, pose: 14, recover: 22, speed: 9, range: 11, radius: 0.3,
  mv: 0.9, kb: 0.4, cooldown: [3, 4.5], width: 0.7 });
const KEEP = Object.freeze({ near: 4.5, far: 9, ring: 7, speed: 2.4, back: 2.8, drift: 1.5, guard: 6 });

/** The rings over the raised bell. @type {FxOptions} */
const RING_FX = { mode: 'billboard', lift: 2.7, color: [0.7, 1.15, 1.5], loops: 1, scale: 1.2 };
/** The hush in flight. @type {ProjectileLook} */
const HUSH_LOOK = Object.freeze({
  frame: 'evShard', mode: 'flat', color: [0.55, 0.9, 1.5], scale: 1.3, rot: 0, spin: 0,
  hitBurst: 'evRimePuff', hitCount: 4, hitFx: 'evRing', hitFxScale: 0.8, hitSfx: 'iceCrack', hitVolume: 0.45, hitPitch: 1.8,
  fadeBurst: 'evRimePuff', fadeCount: 2,
});

/** The sounds by name (EVERMERE_CAMPAIGN.md §5.7): its handbell is the wayside chime pitched down. */
const SND = Object.freeze({ bell: 'waysideChime', hush: 'cantorHush', windup: 'windup' });

/** @typedef {'call'|'hush'} CantorMove */

/** Scratch list for `enemiesNear`. @type {Enemy[]} */
const NEAR = [];

/** @satisfies {Brain} */
export const cantorBrain = {
  init(e) {
    return {
      move: /** @type {CantorMove} */ ('hush'),
      callT: CALL_S * (0.4 + 0.6 * e.rng.next()),
      cd: e.rng.range(1.5, 3),
      side: e.rng.chance(0.5) ? 1 : -1,
      flip: e.rng.range(2, 4),
      aimX: 0, aimZ: 1, len: 1,
      /** Calls rung and Hushguard sealed by them (tests). */
      calls: 0,
      sealed: 0,
      /** Test hook: the next move (null: the brain's own). */
      force: /** @type {CantorMove|null} */ (null),
      stepT: 0,
    };
  },

  /** It waits, the bell held low. @type {Brain['idle']} */
  idle(e) {
    e.anim('idle');
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {any} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    ai.callT -= h;
    if (ai.cd > 0) ai.cd -= h;
    const f = ai.force;
    // the call: its own clock — it takes no token (it strikes no one)
    if ((f === 'call' || ai.callT <= 0) && f !== 'hush' && e.canWindup(ctx)) {
      ai.move = 'call';
      ai.force = null;
      e.dropToken(ctx);
      e.setState('windup');
      return;
    }
    if ((f === 'hush' || ai.cd <= 0) && tp.d >= HUSH.min && tp.d <= HUSH.max && e.canWindup(ctx) && ctx.los(p.x, p.z, P.x, P.z) && e.takeToken(ctx)) {
      ai.move = 'hush';
      ai.force = null;
      e.setState('windup');
      return;
    }
    // its ground: back off, close in, or drift round the target near its knights
    ai.flip -= h;
    if (ai.flip <= 0) {
      ai.flip = e.rng.range(2, 4);
      if (e.rng.chance(0.5)) ai.side = -ai.side;
    }
    if (tp.d < KEEP.near) {
      ai.stepT += h;
      const fr = e.walk(-tp.dx, -tp.dz, KEEP.back, h, ctx, null, false);
      e.face(P.x, P.z);
      e.pose(fr > 0.2 ? 'step' : 'idle0');
      if (fr < 0.2) ai.side = -ai.side;
      return;
    }
    if (tp.d > KEEP.far || !e.canMelee(ctx)) {
      e.chase(KEEP.speed, h, ctx, 'walk');
      return;
    }
    let dx = -tp.dz * ai.side + tp.dx * (tp.d - KEEP.ring) * 0.4;
    let dz = tp.dx * ai.side + tp.dz * (tp.d - KEEP.ring) * 0.4;
    const g = nearestGuard(e, ctx);
    if (g) {
      const gx = g.position.x - p.x;
      const gz = g.position.z - p.z;
      const gd = Math.hypot(gx, gz);
      if (gd > KEEP.guard) {
        dx += (gx / gd) * 0.8;
        dz += (gz / gd) * 0.8;
      }
    }
    const l = Math.hypot(dx, dz) || 1;
    const fr = e.walk(dx / l, dz / l, KEEP.drift, h, ctx, 'walk', false);
    e.face(P.x, P.z);
    if (fr < 0.25) ai.side = -ai.side;
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    if (/** @type {any} */ (e.ai).move === 'call') call(e, h, ctx);
    else hush(e, h, ctx);
  },

  /** The call broken off: its clock starts again (shorter). @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {any} */ (e.ai);
    if (ai.move === 'call' && ai.callT <= 0) ai.callT = CALL_S * 0.5;
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.burst('evRimePuff', p.x, p.y + 1.0, p.z, 8);
    ctx.sfx(SND.bell, p.x, p.z, { volume: 0.5, pitch: 0.6 });
  },

  /** The eyes under the hood, brighter as it calls. @type {Brain['glow']} */
  glow(e, out) {
    if (!e.alive) return;
    out[0] = 0.55;
    out[1] = 0.95;
    out[2] = 1.0;
    out[3] = e.state === 'windup' ? 3.0 : e.state === 'active' ? 3.4 : e.aggro ? 1.9 : 1.4;
  },
};

/**
 * The nearest live Hushguard (within 14 u), or null.
 * @param {Enemy} e @param {CombatContext} ctx
 * @returns {Enemy|null}
 */
function nearestGuard(e, ctx) {
  ctx.enemiesNear(e.position.x, e.position.z, 14, NEAR);
  let best = null;
  let bd = Infinity;
  for (const o of NEAR) {
    if (o.kind !== 'hushguard') continue;
    const d = Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  NEAR.length = 0;
  return best;
}

/**
 * The call: the bell raised, then rung — every broken Hushguard within reach sealed and warded.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function call(e, h, ctx) {
  const ai = /** @type {any} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    e.face(P.x, P.z);
    e.pose('raise');
    if (e.entered) ctx.sfx(SND.bell, p.x, p.z, { volume: 0.35, pitch: 0.9 });
    if (e.fr % 10 === 0 && e.fr > 0) ctx.fx('evRing', p.x, p.y, p.z, RING_FX);
    if (e.after(CALL_RAISE_F)) {
      ai.calls++;
      ctx.sfx(SND.bell, p.x, p.z, { volume: 1, pitch: 0.75 });
      RING_FX.scale = 1.7;
      ctx.fx('evRing', p.x, p.y, p.z, RING_FX);
      RING_FX.scale = 1.2;
      ctx.enemiesNear(p.x, p.z, CALL_R, NEAR);
      for (const o of NEAR) if (o.kind === 'hushguard' && sealHushguard(o, ctx, WARD_S)) ai.sealed++;
      NEAR.length = 0;
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose(Math.floor(e.fr / 6) % 2 ? 'ring1' : 'ring0');
    if (e.after(CALL_RING_F)) e.setState('recover');
    return;
  }
  e.anim('idle');
  if (e.after(12)) {
    ai.callT = CALL_S + e.rng.range(-0.5, 0.5);
    e.setState('engage');
  }
}

/**
 * The hush: the free hand drawn in on a lane marker, then thrust out — a shard of hushed frost.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function hush(e, h, ctx) {
  const ai = /** @type {any} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.windup, p.x, p.z, { volume: 0.6, pitch: 1.3 });
    e.pose('windup');
    if (e.t < F(HUSH.track) - EPS) {
      e.face(P.x, P.z);
      ai.aimX = e.facing.x;
      ai.aimZ = e.facing.z;
      ai.len = Math.min(HUSH.range, e.tp.d + 1);
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = ai.aimX;
    m.dirZ = ai.aimZ;
    m.len = ai.len;
    m.width = HUSH.width;
    m.progress = Math.min(1, e.t / F(HUSH.windup));
    m.flash = e.lockFlash(e.t - F(HUSH.track));
    e.mark(0, ctx, m);
    if (e.after(HUSH.windup)) {
      e.markProgress(0, ctx, 1);
      e.markToFade(0, ctx, F(14));
      const s = e.projSpec();
      s.kind = 'arrow';
      s.x = p.x + ai.aimX * 0.6;
      s.y = p.y + 1.1;
      s.z = p.z + ai.aimZ * 0.6;
      s.dirX = ai.aimX;
      s.dirZ = ai.aimZ;
      s.vy = 0;
      s.speed = HUSH.speed;
      s.range = HUSH.range;
      s.radius = HUSH.radius;
      s.mv = HUSH.mv;
      s.kb = HUSH.kb;
      s.look = HUSH_LOOK;
      ctx.projectile(e, s);
      ctx.sfx(SND.hush, p.x, p.z, { volume: 1, pitch: 1 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('attack');
    if (e.after(HUSH.pose)) e.setState('recover');
    return;
  }
  e.pose('idle0');
  if (e.after(HUSH.recover)) {
    e.dropToken(ctx);
    ai.cd = e.rng.range(HUSH.cooldown[0], HUSH.cooldown[1]);
    e.setState('engage');
  }
}

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerMonsterKind('cantor', cantorSheet);
  api.registerBrain('cantor', cantorBrain);
}
