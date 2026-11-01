/**
 * Ashen Hellhound — the fast pack hunter of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7).
 *
 * Idle — besieging (`besiegeStep` of ./drakeborn.js): it takes a spot close to the house's wall,
 * rears up and rakes at it (poses `claw0` / `claw1`, claw streaks `bruteClaw`, splinters and dust,
 * a scrape now and then) on a
 * 2.2 s cycle staggered by its index; every third cycle it howls instead (pose `howl`, `growl`).
 * No hitbox, no aggro side effects (the same idle plays in a story scene's ambient step); without a
 * house it wanders.
 *
 * Engage — fast (4.4 u/s) and never still: it circles the target at 2.8–4.6 u (the pack splits to
 * both sides by index; the side flips on a seeded coin or when blocked) and darts in to attack; the
 * first engage after a notice opens with a 12 f snarl. One melee token per attack. Moves (§7.3):
 *  - **Bite combo** (d ≤ 2.4): wind-up 20 f (pose `windup`: head low, jaws open, `growl`) with a
 *    sector marker r 1.7 ±45° filling over it (locked for the last 6 f; it closes in while > 1.4 u),
 *    5 f active (pose `attack`, a 1.0 u lunge, the jaws' snap `bruteBite`, sector hit mv 0.85,
 *    kb 0.6, `swing`); a second bite
 *    always and a third at 45 %, each with its own 18 f wind-up and marker; recover 26 f; cooldown
 *    40 f.
 *  - **Pounce** (3.5 ≤ d ≤ 7.5, line of sight, 50 %, cooldown 5 s): a coiled wind-up of 30 f (pose
 *    `crouch`, `growl`) aiming a landing circle r 1.6 at the target's position 0.25 s ahead
 *    (clamped to the hound's free run; locked for the last 8 f) that fills over the wind-up and the
 *    22 f leap (pose `leap`, an arc 1.1 u high); the landing hits it (mv 1.25, kb 2.2, knockdown;
 *    dust, embers, ember cracks `bruteQuake`, a thud); recover 34 f (pose `land`).
 *  - **Fire breath** (1.5 ≤ d ≤ 5.5, line of sight, 40 %, cooldown 8 s): reared back for 36 f
 *    (pose `breathWind`, the throat glowing, `growl`, embers at the jaws) with a cone marker r 5
 *    ±28° (locked for the last 10 f), then 54 f of fire (poses `breath0` / `breath1`, `breath`):
 *    the fan of flame `bruteBreath` on the ground (played again every 24 f, so it stops with the
 *    breath), flame bursts pour down the cone and a sector hit with a fresh tag every 9 f (mv 0.32, kb 0.25:
 *    six ticks for one who stays in it); recover 28 f.
 * A target out of melee reach is chased along the walk grid. Its mane and cracks glow (`uGlow`),
 * brighter as it winds up and breathes.
 *
 * Death: embers and smoke burst off it; its throes (`dead`) keep the body 20 f while the mane
 * gutters out (embers every 8 f), then fade it over 30 f.
 *
 * Test hook: `e.ai.force` = 'bite' | 'pounce' | 'breath' makes that move the next one picked as soon
 * as its range allows (cooldowns ignored); null: the brain's own choice.
 */
import { besiegeStep, siegeState, leaveSpot } from './drakeborn.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain, FxOptions } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

const SPEED = 4.4;
const STRAFE = Object.freeze({ min: 2.8, mid: 3.6, max: 4.6, speed: 3.4 });
const SNARL_F = 12;
const SIEGE_PERIOD = 2.2;
const SIEGE_REACH = 0.85;
const RAKE_S = 0.2;
const RAKES = 6;
const HOWL_S = 1.1;

const BITE = Object.freeze({ range: 2.4, windup: 20, follow: 18, lock: 6, r: 1.7, half: 45, active: 5, lunge: 1.0,
  mv: 0.85, kb: 0.6, third: 0.45, recover: 26, cooldown: 40, closeIn: 1.4 });
const POUNCE = Object.freeze({ min: 3.5, max: 7.5, chance: 0.5, windup: 30, lock: 8, air: 22, arc: 1.1, r: 1.6, lead: 0.25,
  mv: 1.25, kb: 2.2, recover: 34, cooldown: 5 });
const BREATH = Object.freeze({ min: 1.5, range: 5.5, chance: 0.4, windup: 36, lock: 10, r: 5.0, half: 28, active: 54, every: 9,
  mv: 0.32, kb: 0.25, recover: 28, cooldown: 8 });
/** The death throes' frames: the still body (its mane guttering), the fade. */
const DEATH = Object.freeze({ still: 20, fade: 30, embers: 8 });

// ---- the looks of its effects (atlas frames of src/engine/pixel/fx/bruteFx.js; one options record
// per effect, its direction written before each play) ----

/** The jaws' snap (billboard, at the bite's reach). @type {FxOptions} */
const BITE_FX = { mode: 'billboard', lift: 0.75, color: [2.1, 1.45, 0.75], loops: 1, scale: 1 };
/** The claw streaks on a besieged wall. @type {FxOptions} */
const CLAW_FX = { mode: 'billboard', lift: 1.05, color: [1.9, 1.25, 0.6], loops: 1, scale: 0.9 };
/**
 * The breath's fan of flame on the ground: 56 px × 1.5 = 5.25 u from the jaws (the frame's bottom
 * centre) to the far edge, the cone's r 5; two plays of its strip (0.43 s), played every 24 f.
 * @type {FxOptions}
 */
const BREATH_FX = { mode: 'flat', lift: 0.25, color: [2.4, 1.05, 0.32], loops: 2, fps: 14, scale: 1.5, dirX: 0, dirZ: 1 };
/** The breath frame's centre ahead of the hound: its jaws 0.6 u ahead + half the frame. */
const BREATH_FX_AHEAD = 0.6 + 2.62;
/** The pounce's landing: small ember cracks. @type {FxOptions} */
const LAND_FX = { mode: 'flat', lift: 0.04, color: [2.2, 0.95, 0.32], loops: 1, fps: 8, scale: 0.75, dirX: 0, dirZ: 1 };
/** The landing's dust (the named `dust`). @type {FxOptions} */
const LAND_DUST = { scale: 1.3 };

/** @typedef {Required<ReturnType<typeof ashhound.init>>} AshhoundAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const ashhound = {
  init(e) {
    return {
      siege: siegeState(),
      move: /** @type {'bite'|'pounce'|'breath'} */ ('bite'),
      /** Test hook: the next move ('bite' | 'pounce' | 'breath'; null: the brain's choice). */
      force: /** @type {null|'bite'|'pounce'|'breath'} */ (null),
      cd: F(e.rng.int(15, 45)),
      pounceCd: e.rng.range(0.5, 2.5),
      breathCd: e.rng.range(2, 5),
      snarl: false,
      snarlT: 0,
      n: 0,
      tag: 0,
      lx: 0, lz: 1,
      sx: 0, sz: 0, tx: 0, tz: 0,
      side: e.index % 2 ? 1 : -1,
      flip: F(e.rng.int(90, 200)),
      blocked: 0,
      los: false, losT: 0,
      howl: false,
      /** The breath's fan replays done; `each`'s counter. */
      fx: 0,
      each: 0,
    };
  },

  /** Besieging: rakes at the wall, a howl every third cycle. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {AshhoundAI} */ (e.ai);
    ai.snarl = true;
    const t = besiegeStep(e, h, ctx, SIEGE_PERIOD, SIEGE_REACH);
    if (t < 0) {
      if (ai.siege.there) e.anim('idle');
      return;
    }
    const s = ai.siege;
    const p = e.position;
    if (s.n % 3 === 2) {
      if (t < HOWL_S) {
        e.pose('howl');
        if (!s.hit) {
          s.hit = true;
          ctx.sfx('growl', p.x, p.z, { pitch: 1.35, volume: 0.75 });
        }
      } else e.anim('idle');
      return;
    }
    if (t < RAKE_S * RAKES) {
      const k = Math.floor(t / RAKE_S);
      e.pose(k & 1 ? 'claw1' : 'claw0');
      // each down-stroke scars the wall
      if ((k & 1) && !s.hit) {
        s.hit = true;
        ctx.burst('bruteSplinters', s.wx, s.wy + 1.1, s.wz, 4);
        ctx.burst('bruteDust', s.wx, s.wy + 0.5, s.wz, 2);
        ctx.fx('bruteClaw', s.wx, s.wy, s.wz, CLAW_FX);
        if (k % 4 === 1) ctx.sfx('wallHit', s.wx, s.wz, { volume: 0.45, pitch: 1.3 });
      } else if (!(k & 1)) s.hit = false;
    } else e.anim('idle');
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {AshhoundAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    leaveSpot(e);
    if (ai.cd > 0) ai.cd -= h;
    if (ai.pounceCd > 0) ai.pounceCd -= h;
    if (ai.breathCd > 0) ai.breathCd -= h;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }
    if (ai.snarl) {
      if (ai.snarlT === 0) ctx.sfx('growl', p.x, p.z, { pitch: 1.2 });
      ai.snarlT += h;
      e.face(P.x, P.z);
      e.pose('windup');
      if (ai.snarlT >= F(SNARL_F) - EPS) {
        ai.snarl = false;
        ai.snarlT = 0;
      }
      return;
    }
    const reach = e.canMelee(ctx);
    const onScreen = e.canWindup(ctx);
    const f = ai.force;
    const want = (move) => (f ? f === move : true);
    if (reach && onScreen) {
      if (want('breath') && tp.d >= BREATH.min && tp.d <= BREATH.range && ai.los
        && (f === 'breath' || (ai.cd <= 0 && ai.breathCd <= 0 && e.rng.chance(BREATH.chance))) && e.takeToken(ctx)) {
        start(e, 'breath');
        return;
      }
      if (want('pounce') && tp.d >= POUNCE.min && tp.d <= POUNCE.max && ai.los
        && (f === 'pounce' || (ai.cd <= 0 && ai.pounceCd <= 0 && e.rng.chance(POUNCE.chance))) && e.takeToken(ctx)) {
        start(e, 'pounce');
        return;
      }
      if (want('bite') && tp.d <= BITE.range && (f === 'bite' || ai.cd <= 0) && e.takeToken(ctx)) {
        start(e, 'bite');
        return;
      }
      // (a coin that said no: ask again in a while)
      if (!f && ai.breathCd <= 0) ai.breathCd = 1.0;
      if (!f && ai.pounceCd <= 0) ai.pounceCd = 0.8;
    }
    // far, out of reach, or wanting to bite but off screen: close in
    if (tp.d > STRAFE.max || !reach || (ai.cd <= 0 && !onScreen)) {
      e.chase(SPEED, h, ctx, 'run');
      return;
    }
    // ready to bite: dart in
    if (ai.cd <= 0 && tp.d > BITE.range) {
      e.chase(SPEED, h, ctx, 'run');
      return;
    }
    // circle the target, holding the strafe radius
    ai.flip -= h;
    if (ai.flip <= 0) {
      if (e.rng.chance(0.4)) ai.side = -ai.side;
      ai.flip = F(e.rng.int(90, 200));
    }
    let dx = -tp.dz * ai.side;
    let dz = tp.dx * ai.side;
    const radial = tp.d < STRAFE.min ? -0.8 : Math.max(-0.5, Math.min(0.8, (tp.d - STRAFE.mid) * 1.4));
    dx += tp.dx * radial;
    dz += tp.dz * radial;
    const l = Math.hypot(dx, dz) || 1;
    const fr = e.walk(dx / l, dz / l, STRAFE.speed, h, ctx, 'run');
    ai.blocked = fr < 0.25 ? ai.blocked + h : 0;
    if (ai.blocked > F(10)) {
      ai.side = -ai.side;
      ai.blocked = 0;
    }
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {AshhoundAI} */ (e.ai);
    if (ai.move === 'pounce') pounce(e, h, ctx);
    else if (ai.move === 'breath') breath(e, h, ctx);
    else bite(e, h, ctx);
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {AshhoundAI} */ (e.ai);
    ai.n = 0;
    ai.snarl = false;
    ai.snarlT = 0;
    e.lift = 0;
    leaveSpot(e);
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.burst('bruteEmbers', p.x, p.y + 0.8, p.z, 12);
    ctx.burst('bruteSmoke', p.x, p.y + 0.6, p.z, 6);
  },

  /** The mane gutters out (embers every 8 f) while the body lies; then its own fade. @type {Brain['dead']} */
  dead(e, h, ctx) {
    const p = e.position;
    const n = F(DEATH.embers);
    if (e.t < F(DEATH.still + DEATH.fade) && Math.floor(e.t / n) !== Math.floor((e.t - h) / n)) {
      ctx.burst('bruteEmbers', p.x - e.facing.x * 0.6, p.y + 0.4, p.z - e.facing.z * 0.6, 3);
    }
    const k = (e.t - F(DEATH.still)) / F(DEATH.fade);
    if (k > 0) e.sprite.opacity = Math.min(e.sprite.opacity, Math.max(0, 1 - k));
    return true;
  },

  /** The mane and the magma cracks; hotter in a wind-up and while breathing. @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {AshhoundAI|null} */ (e.ai);
    const hot = e.state === 'windup' || (e.state === 'active' && ai?.move === 'breath');
    out[0] = 1.0;
    out[1] = 0.45;
    out[2] = 0.14;
    out[3] = !e.alive ? 0.3 : hot ? 1.5 : 0.9;
  },
};

/**
 * True once every `n` frames of the current state, from its first frame — counted, so a sub-step
 * shorter than a frame (a chilled or slowed hound) never fires it twice.
 * @param {Enemy} e
 * @param {AshhoundAI} ai
 * @param {number} n
 * @returns {boolean}
 */
function each(e, ai, n) {
  if (e.entered) ai.each = 0;
  if (e.fr < ai.each * n) return false;
  ai.each = Math.floor(e.fr / n) + 1;
  return true;
}

/**
 * Begin a move: its wind-up.
 * @param {Enemy} e
 * @param {'bite'|'pounce'|'breath'} move
 */
function start(e, move) {
  const ai = /** @type {AshhoundAI} */ (e.ai);
  ai.move = move;
  ai.n = 0;
  ai.force = null;
  e.setState('windup');
}

/**
 * The end of a move: the token back, the cooldown.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @param {number} cd seconds
 */
function endMove(e, ctx, cd) {
  const ai = /** @type {AshhoundAI} */ (e.ai);
  e.dropToken(ctx);
  ai.cd = cd;
  ai.n = 0;
  e.setState('engage');
}

/**
 * The bite combo: two or three snapping lunges, each with its own wind-up and marker.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function bite(e, h, ctx) {
  const ai = /** @type {AshhoundAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  const tp = e.tp;
  if (e.state === 'windup') {
    const dur = ai.n > 0 ? BITE.follow : BITE.windup;
    if (e.entered) ctx.sfx('growl', p.x, p.z, { pitch: 1.25, volume: 0.6 });
    e.pose('windup');
    if (e.t < F(dur - BITE.lock) - EPS) {
      e.face(P.x, P.z);
      if (tp.d > BITE.closeIn) e.walk(tp.dx, tp.dz, SPEED * 0.6, h, ctx, null, false);
    }
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = BITE.r;
    m.halfAngle = BITE.half;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.entered) {
      ctx.sfx('swing', p.x, p.z, { pitch: 1.3, volume: 0.8 });
      ctx.fx('bruteBite', p.x + ai.lx * 1.4, p.y, p.z + ai.lz * 1.4, BITE_FX);
    }
    if (e.after(BITE.active)) {
      e.unmark(0, ctx);
      ai.n++;
      if (ai.n === 1 || (ai.n === 2 && e.rng.chance(BITE.third))) e.setState('windup');
      else e.setState('recover');
      return;
    }
    e.pose('attack');
    const v = BITE.lunge / F(BITE.active);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = BITE.r;
    s.halfAngle = BITE.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = BITE.mv;
    s.kb = BITE.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  if (e.fr < 8) e.pose('attack');
  else {
    e.face(P.x, P.z);
    e.anim('idle');
  }
  if (e.after(BITE.recover)) endMove(e, ctx, F(BITE.cooldown));
}

/**
 * The pounce: the coil with the landing circle, the leap, the landing.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function pounce(e, h, ctx) {
  const ai = /** @type {AshhoundAI} */ (e.ai);
  const P = ctx.player;
  const p = e.position;
  const total = F(POUNCE.windup + POUNCE.air);
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('growl', p.x, p.z, { pitch: 1.1 });
    e.pose('crouch');
    if (e.t < F(POUNCE.windup - POUNCE.lock) - EPS || e.entered) {
      // aim: the target's position a little ahead, within the leap's range and the free run
      let tx = P.position.x + P.velocity.x * POUNCE.lead;
      let tz = P.position.z + P.velocity.z * POUNCE.lead;
      let dx = tx - p.x;
      let dz = tz - p.z;
      let d = Math.hypot(dx, dz);
      if (d < 1e-3) { dx = e.facing.x; dz = e.facing.z; d = 1; } else { dx /= d; dz /= d; }
      e.faceDir(dx, dz);
      const run = e.freeRun(dx, dz, Math.min(POUNCE.max + 0.5, d), ctx);
      d = Math.max(1.2, Math.min(d, run));
      tx = p.x + dx * d;
      tz = p.z + dz * d;
      ai.sx = p.x;
      ai.sz = p.z;
      ai.tx = tx;
      ai.tz = tz;
    }
    const m = e.markerSpec('circle', ai.tx, ai.tz);
    m.r = POUNCE.r;
    m.progress = Math.min(1, e.t / total);
    e.mark(0, ctx, m);
    if (e.after(POUNCE.windup)) {
      ai.sx = p.x;
      ai.sz = p.z;
      ai.tag = e.newTag();
      ctx.burst('bruteDust', p.x, p.y + 0.2, p.z, 4);
      ctx.sfx('dodge', p.x, p.z, { pitch: 0.8 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    const T = F(POUNCE.air);
    const u0 = Math.min(1, e.t / T);
    const u1 = Math.min(1, (e.t + h) / T);
    // along the line from the take-off to the landing point (collisions through moveGround)
    const ddx = (ai.tx - ai.sx) * (u1 - u0);
    const ddz = (ai.tz - ai.sz) * (u1 - u0);
    if (Math.abs(ddx) + Math.abs(ddz) > 1e-6) e.move(ddx, ddz, ctx);
    e.lift = POUNCE.arc * 4 * u1 * (1 - u1);
    e.pose(u1 < 0.85 ? 'leap' : 'land');
    e.markProgress(0, ctx, Math.min(1, (F(POUNCE.windup) + e.t + h) / total));
    if (u1 >= 1 - EPS) {
      e.lift = 0;
      const gy = ctx.groundAt(p.x, p.z);
      const s = e.hitSpec();
      s.shape = 'circle';
      s.y = gy;
      s.r = POUNCE.r;
      s.mv = POUNCE.mv;
      s.kb = POUNCE.kb;
      s.knockdown = true;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      ctx.fx('dust', p.x, gy, p.z, LAND_DUST);
      LAND_FX.dirX = e.facing.x;
      LAND_FX.dirZ = e.facing.z;
      ctx.fx('bruteQuake', p.x, gy, p.z, LAND_FX);
      ctx.burst('bruteDust', p.x, gy + 0.3, p.z, 8);
      ctx.burst('emberBurst', p.x, gy + 0.4, p.z, 8);
      ctx.sfx('slam', p.x, p.z, { volume: 0.55, pitch: 1.2 });
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  e.pose(e.fr < 18 ? 'land' : 'idle0');
  if (e.fr >= 18) e.face(P.position.x, P.position.z);
  if (e.after(POUNCE.recover)) {
    ai.pounceCd = POUNCE.cooldown;
    endMove(e, ctx, F(BITE.cooldown));
  }
}

/**
 * The fire breath: reared back with the cone marker, then the stream down the cone.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function breath(e, h, ctx) {
  const ai = /** @type {AshhoundAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('growl', p.x, p.z, { pitch: 0.9 });
    e.pose('breathWind');
    if (e.t < F(BREATH.windup - BREATH.lock) - EPS) e.face(P.x, P.z);
    if (each(e, ai, 6)) ctx.burst('bruteEmbers', p.x + e.facing.x * 0.9, p.y + 1.5, p.z + e.facing.z * 0.9, 2);
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = BREATH.r;
    m.halfAngle = BREATH.half;
    m.progress = Math.min(1, e.t / F(BREATH.windup));
    e.mark(0, ctx, m);
    if (e.after(BREATH.windup)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.n = 0;
      ai.fx = 0;
      e.markProgress(0, ctx, 1);
      ctx.sfx('breath', p.x, p.z);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose((e.fr / 6) & 1 ? 'breath1' : 'breath0');
    // the fan of flame on the ground, played again every 24 f (it ends with the breath)
    if (e.fr >= ai.fx * 24) {
      ai.fx = Math.floor(e.fr / 24) + 1;
      BREATH_FX.dirX = ai.lx;
      BREATH_FX.dirZ = ai.lz;
      ctx.fx('bruteBreath', p.x + ai.lx * BREATH_FX_AHEAD, ctx.groundAt(p.x, p.z), p.z + ai.lz * BREATH_FX_AHEAD, BREATH_FX);
    }
    // the stream: bursts pouring outward along the cone, a little fan to each side
    if (each(e, ai, 2)) {
      const gy = ctx.groundAt(p.x, p.z);
      const k = (e.fr >> 1) % 6;
      const dist = 1.0 + k * 0.75;
      const fan = Math.sin(e.fr * 0.9) * BREATH.half * 0.6 * DEG * (dist / BREATH.r);
      const c = Math.cos(fan), sn = Math.sin(fan);
      const dx = ai.lx * c - ai.lz * sn;
      const dz = ai.lx * sn + ai.lz * c;
      ctx.burst('bruteBreath', p.x + dx * dist, gy + 1.0 - k * 0.1, p.z + dz * dist, 4 + (k > 2 ? 2 : 0));
      if (k === 0) ctx.burst('bruteFireCore', p.x + ai.lx * 1.0, gy + 1.0, p.z + ai.lz * 1.0, 1);
    }
    if (e.fr >= ai.n * BREATH.every) {
      ai.n++;
      ai.tag = e.newTag();
      if (ai.n === 4) ctx.sfx('breath', p.x, p.z, { volume: 0.7 });
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = BREATH.r;
    s.halfAngle = BREATH.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = BREATH.mv;
    s.kb = BREATH.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (e.after(BREATH.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  if (e.entered) ctx.burst('bruteSmoke', p.x + ai.lx, p.y + 1.1, p.z + ai.lz, 3);
  if (e.fr < 12) e.pose('breath0');
  else {
    e.face(P.x, P.z);
    e.anim('idle');
  }
  if (e.after(BREATH.recover)) {
    ai.breathCd = BREATH.cooldown;
    endMove(e, ctx, F(BITE.cooldown));
  }
}
