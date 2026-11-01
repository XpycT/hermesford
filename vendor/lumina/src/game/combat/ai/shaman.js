/**
 * Hex Shaman — caster / support (COMBAT.md §7.7).
 *
 * Keeps 5–8 u like the archer (speed 2.6). Its staff gem glows (`uGlow` (0.5, 1.0, 0.6) × 2.0).
 * - **Hex Flame** (ranged token, LOS, on screen, d ≤ 10): wind-up 24 f (pose `windup` = staff
 *   raised, SFX `windup`), then a circle marker r 1.6 at the player's position predicted 0.3 s
 *   ahead that fills over 66 f (the shaman channels, pose `attack`, holding its token) and erupts
 *   at progress 1: circle r 1.6, mv 1.3, kb 1.0, `emberBurst` 10, SFX `hexBurst`; cooldown 150 f.
 *   The placed circle is a hazard: it still erupts when the shaman is interrupted, not when it dies.
 * - **Mend**: every 480 f, when an ally within 6 u is below 60 % HP: 30 f cast (pose `attack`),
 *   then `ctx.heal(ally, round(0.3 · ally.hpMax))`.
 * - **Blink**: the player within 2.5 u for 60 f → pose `blink` (tuck) 12 f, `deathPoof` 8, then it
 *   reappears ≤ 4 u away along the best walkable of 8 directions away from the player (moved
 *   through moveGround, so walls, ledges and arenas still hold), cooldown 300 f.
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;

const KEEP_MIN = 5;
const KEEP_MAX = 8;
const SPEED = 2.6;
const HEX_RANGE = 10;
const WINDUP_F = 24;
const LEAD_S = 0.3;
const HEX_R = 1.6;
const HEX_FILL_F = 66;
const RECOVER_F = 12;
const HEX_COOLDOWN_F = 150;
const MEND_EVERY_F = 480;
const MEND_R = 6;
const MEND_BELOW = 0.6;
const MEND_CAST_F = 30;
const BLINK_R = 2.5;
const BLINK_NEAR_F = 60;
const BLINK_TUCK_F = 12;
const BLINK_DIST = 4;
const BLINK_COOLDOWN_F = 300;

/** @typedef {Required<ReturnType<typeof shaman.init>>} ShamanAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const shaman = {
  init(e) {
    return {
      cd: F(e.rng.int(30, 90)),
      mendT: 0,
      blinkCd: 0,
      nearT: 0,
      cast: null, // 'mend' | 'blink' (non-attack actions inside engage)
      castT: 0,
      ally: null,
      side: e.rng.chance(0.5) ? 1 : -1,
      strafeT: F(e.rng.int(60, 120)),
      awayT: 0,
      los: false, losT: 0,
      near: [],
    };
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {ShamanAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.blinkCd > 0) ai.blinkCd -= h;
    ai.mendT += h;
    ai.nearT = tp.d < BLINK_R ? ai.nearT + h : 0;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }

    if (ai.cast === 'mend') {
      mend(e, h, ctx);
      return;
    }
    if (ai.cast === 'blink') {
      blink(e, h, ctx);
      return;
    }
    if (ai.nearT >= F(BLINK_NEAR_F) - 1e-6 && ai.blinkCd <= 0) {
      ai.cast = 'blink';
      ai.castT = 0;
      blink(e, h, ctx);
      return;
    }
    if (ai.mendT >= F(MEND_EVERY_F) - 1e-6) {
      const ally = pickAlly(e, ctx);
      if (ally) {
        ai.cast = 'mend';
        ai.castT = 0;
        ai.ally = ally;
        mend(e, h, ctx);
        return;
      }
      ai.mendT = F(MEND_EVERY_F - 30); // look again in 0.5 s
    }
    const wants = ai.cd <= 0;
    const onScreen = e.canWindup(ctx);
    if (wants && tp.d <= HEX_RANGE && ai.los && onScreen && e.takeToken(ctx)) {
      e.setState('windup');
      return;
    }
    if (tp.d < KEEP_MIN - 0.5) {
      ai.awayT -= h;
      if (ai.awayT <= 0) {
        if (!e.bestAway(P.x, P.z, 1.5, ctx, true)) {
          e.away.x = -tp.dx;
          e.away.z = -tp.dz;
        }
        ai.awayT = F(12);
      }
      e.walk(e.away.x, e.away.z, SPEED, h, ctx, 'walk');
      return;
    }
    if (tp.d > KEEP_MAX || (wants && !onScreen) || (wants && !ai.los && tp.d > HEX_RANGE - 2)) {
      e.chase(SPEED, h, ctx, 'walk');
      return;
    }
    ai.strafeT -= h;
    if (ai.strafeT <= 0) {
      if (e.rng.chance(0.5)) ai.side = -ai.side;
      ai.strafeT = F(e.rng.int(60, 120));
    }
    const fr = e.walk(-tp.dz * ai.side, tp.dx * ai.side, SPEED * 0.7, h, ctx, 'walk', false);
    e.face(P.x, P.z);
    if (fr < 0.25) ai.side = -ai.side;
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {ShamanAI} */ (e.ai);
    const P = ctx.player;
    const p = e.position;
    if (e.state === 'windup') {
      if (e.entered) ctx.sfx('windup', p.x, p.z);
      e.face(P.position.x, P.position.z);
      e.pose('windup');
      if (e.after(WINDUP_F)) {
        // the circle at the player's position 0.3 s ahead: its own fill is the telegraph (§7.3)
        const x = P.position.x + P.velocity.x * LEAD_S;
        const z = P.position.z + P.velocity.z * LEAD_S;
        const hz = e.hazardCircle(x, z, HEX_R, F(HEX_FILL_F));
        hz.mv = 1.3;
        hz.kb = 1.0;
        hz.burst = 'emberBurst';
        hz.burstN = 10;
        hz.sfx = 'hexBurst';
        e.setState('active');
      }
      return;
    }
    if (e.state === 'active') {
      // channel while the circle fills (token held until it erupts)
      e.pose('attack');
      if (e.after(HEX_FILL_F)) e.setState('recover');
      return;
    }
    e.anim('idle');
    if (e.after(RECOVER_F)) {
      e.dropToken(ctx);
      ai.cd = F(HEX_COOLDOWN_F);
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {ShamanAI} */ (e.ai);
    ai.cast = null;
    ai.ally = null;
    e.lift = 0;
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    out[0] = 0.5;
    out[1] = 1.0;
    out[2] = 0.6;
    out[3] = 2.0;
  },
};

/**
 * The most hurt ally (non-dummy, non-boss, alive) within 6 u below 60 % HP, or null.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @returns {Enemy|null}
 */
function pickAlly(e, ctx) {
  const list = ctx.enemiesNear(e.position.x, e.position.z, MEND_R, /** @type {ShamanAI} */ (e.ai).near);
  let best = null;
  let bestFrac = MEND_BELOW;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === e || !o.alive || o.passive || o.boss) continue;
    const f = o.hp / o.hpMax;
    if (f < bestFrac - 1e-9) {
      bestFrac = f;
      best = o;
    }
  }
  return best;
}

/**
 * Mend: 30 f cast facing the ally, then the heal (core applies HP, number and glow).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function mend(e, h, ctx) {
  const ai = /** @type {ShamanAI} */ (e.ai);
  const a = ai.ally;
  if (a) e.face(a.position.x, a.position.z);
  e.pose('attack');
  ai.castT += h;
  if (ai.castT >= F(MEND_CAST_F) - 1e-6) {
    if (a && a.alive) ctx.heal(a, Math.round(0.3 * a.hpMax));
    ai.cast = null;
    ai.ally = null;
    ai.mendT = 0;
  }
}

/**
 * Blink: tuck 12 f, poof, reappear up to 4 u away from the player.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function blink(e, h, ctx) {
  const ai = /** @type {ShamanAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  e.pose('blink');
  ai.castT += h;
  if (ai.castT < F(BLINK_TUCK_F) - 1e-6) return;
  ctx.burst('deathPoof', p.x, p.y + 0.5, p.z, 8);
  if (!e.bestAway(P.x, P.z, BLINK_DIST, ctx)) {
    e.away.x = -e.tp.dx;
    e.away.z = -e.tp.dz;
  }
  e.move(e.away.x * BLINK_DIST, e.away.z * BLINK_DIST, ctx);
  ctx.burst('deathPoof', p.x, ctx.groundAt(p.x, p.z) + 0.5, p.z, 8);
  e.face(P.x, P.z);
  e.anim('idle');
  ai.cast = null;
  ai.blinkCd = F(BLINK_COOLDOWN_F);
  ai.nearT = 0;
}
