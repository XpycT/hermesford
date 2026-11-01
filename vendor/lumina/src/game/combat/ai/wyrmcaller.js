/**
 * Wyrmcult Pyromancer — the fire caster of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.7).
 *
 * Idle — besieging (`besiegeStep` of ./drakeborn.js) from a spot 1.5 u beyond the house's ring: on
 * a 3.6 s cycle staggered by its index it raises the staff (pose `windup`, fire gathering in the orb)
 * and flings fire at the roof (pose `throw`): a fireball (`bruteFireball`, an ember trail) that
 * bursts on the wall high up (no damage: motion value 0, flying above any body), then flames on the
 * roof's edge (`bruteFlames`), embers and smoke and a `fireRoar`. No hitbox, no aggro side effects
 * (the same idle plays in a story scene's ambient step); without a house it wanders.
 *
 * Engage — keeps 5.5–9 u from its target (2.5 u/s), circling slowly, backing off along the best
 * clear way when pressed. A ranged token per spell. Moves (§7.3: every one with a ground marker):
 *  - **Fireball** (d ≤ 11, line of sight): wind-up 28 f (pose `windup`, fire gathering, `windup`),
 *    then the cast (pose `attack`, `fireballFall`): a fireball (`bruteFireball` with an ember
 *    trail) lobbed in an arc to the target's position 0.35 s ahead, landing after 0.8 s inside a
 *    circle marker r 1.8 that fills over the flight; the landing explodes (mv 1.25, kb 1.8: a flash,
 *    flame tongues, a bright core, `explosion`). Recover 16 f; cooldown 2.6 s. (The hit is a delayed
 *    hazard — it lands when the caster is interrupted, not when it dies: then the fireball lands
 *    harmless; the fireball itself is a look, motion value 0.)
 *  - **Flame pillars** (d ≤ 10, line of sight, 45 %, cooldown 9 s): wind-up 34 f (pose `channel`,
 *    `fireRoar`, the cult's sigil `bruteSigil` burning under it, embers at its feet), then three
 *    circles r 1.5 under the target — where it stands when each appears, 0.45 s apart — each with a
 *    sigil under it, filling over 0.8 s and erupting in a pillar of fire (`brutePillar`, mv 1.1,
 *    kb 1.4, `fireRoar`); it channels (pose `channel`, token held) until the last one erupts.
 *  - **Blink** (the target within 3 u for 30 f, or two melee hits taken within 1.5 s; cooldown 5 s):
 *    it sinks into a swirl of fire (pose `blink`, 14 f, `cackle`, `bruteFlames`) and reappears up
 *    to 5 u away along
 *    the best walkable way from the target, leaving a fire circle r 1.6 where it stood that erupts
 *    after 0.5 s (mv 0.6, kb 1.4).
 * Its staff's flame glows (`uGlow`), brighter while it casts.
 *
 * Death: it burns up — a flare of fire, flames on the body (`bruteFlames`), embers every 6 f
 * (its throes, `dead`) for 16 f, then a fade over 34 f.
 *
 * Test hook: `e.ai.force` = 'fireball' | 'pillars' | 'blink' makes that move the next one picked as
 * soon as its range allows (cooldowns ignored); null: the brain's own choice.
 */
import { aimVy } from '../Projectiles.js';
import { besiegeStep, siegeState, leaveSpot } from './drakeborn.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain, EnemyHazard, FxOptions, ProjectileLook } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

const SPEED = 2.5;
const KEEP = Object.freeze({ min: 5.5, max: 9 });
const SIEGE_PERIOD = 3.6;
const SIEGE_RING = 1.5;
/** Room kept round a pyromancer's besieging spot (a wide stance: its throws need it). */
const SIEGE_ROOM = 2.4;
const SIEGE_WIND = 0.7;
const SIEGE_THROW = 0.35;
const ROOF_Y = 2.9;
const ROOF_BOLT = Object.freeze({ speed: 9, y: 2.3, radius: 0.15 });

const FIREBALL = Object.freeze({ range: 11, windup: 28, cast: 12, flight: 0.8, lead: 0.35, r: 1.8, mv: 1.25, kb: 1.8,
  apex: 2.4, recover: 16, cooldown: 2.6 });
const PILLARS = Object.freeze({ range: 10, chance: 0.45, windup: 34, n: 3, every: 0.45, fill: 0.8, r: 1.5, mv: 1.1, kb: 1.4,
  recover: 20, cooldown: 9 });
const BLINK = Object.freeze({ near: 3.0, nearF: 30, hits: 2, hitWindow: 1.5, tuck: 14, dist: 5, cooldown: 5, r: 1.6, fill: 0.5,
  mv: 0.6, kb: 1.4 });
/** The death throes' frames: the burning body, the fade, the embers' beat. */
const DEATH = Object.freeze({ still: 16, fade: 34, embers: 6 });

// ---- the looks of its fire (atlas frames of src/engine/pixel/fx/bruteFx.js: one record each) ----

/** The fireball in flight; at its landing a flash, flame tongues and the boom. @type {ProjectileLook} */
const FIREBALL_LOOK = Object.freeze({
  frame: 'bruteFireball', mode: 'billboard', color: [3.0, 1.35, 0.42], scale: 1.35, fps: 14,
  trail: 'bruteEmbers', trailEvery: 0.04, trailCount: 2,
  hitBurst: 'bruteFireBlast', hitCount: 18, hitFx: 'impact', hitFxScale: 1.8, hitSfx: 'explosion', hitVolume: 0.9,
  fadeBurst: 'bruteEmbers', fadeCount: 4,
});
/** The besieger's smaller fireball at a roof: a burst on the wall, a soft roar. @type {ProjectileLook} */
const ROOF_LOOK = Object.freeze({
  frame: 'bruteFireball', mode: 'billboard', color: [2.8, 1.25, 0.4], scale: 0.95, fps: 14,
  trail: 'bruteEmbers', trailEvery: 0.05, trailCount: 1,
  hitBurst: 'bruteFireBlast', hitCount: 8, hitFx: 'impact', hitFxScale: 0.8, hitSfx: 'fireRoar', hitVolume: 0.35,
  fadeBurst: 'bruteEmbers', fadeCount: 3,
});
/** Flames licking a roof's edge, a blink's flare, a burning body. @type {FxOptions} */
const FLAMES_FX = { mode: 'billboard', lift: 0.65, color: [2.3, 1.0, 0.3], loop: true, duration: 1.2, scale: 1.3 };
/** The cult's sigil burning on the ground (48 px × 1.15 = 3.45 u across). @type {FxOptions} */
const SIGIL_FX = { mode: 'flat', lift: 0.04, color: [2.2, 0.9, 0.28], loops: 2, fps: 6, scale: 1.15, dirX: 0, dirZ: 1 };
/** A smaller sigil under each pillar's circle while it fills (r 1.5). @type {FxOptions} */
const PILLAR_SIGIL_FX = { mode: 'flat', lift: 0.05, color: [2.0, 0.8, 0.25], loops: 2, fps: 5, scale: 0.95, dirX: 0, dirZ: 1 };
/** The pillar of fire (24 × 56 px × 1.15 ≈ 1.7 × 4 u; its centre lifted half its height). @type {FxOptions} */
const PILLAR_FX = { mode: 'billboard', lift: 1.95, color: [2.4, 1.05, 0.32], loops: 2, fps: 14, scale: 1.15 };

/** @typedef {Required<ReturnType<typeof wyrmcaller.init>>} WyrmcallerAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const wyrmcaller = {
  init(e) {
    return {
      siege: siegeState(),
      move: /** @type {'fireball'|'pillars'} */ ('fireball'),
      /** Test hook: the next move ('fireball' | 'pillars' | 'blink'; null: the brain's choice). */
      force: /** @type {null|'fireball'|'pillars'|'blink'} */ (null),
      cd: F(e.rng.int(30, 80)),
      pillarCd: e.rng.range(2, 5),
      blinkCd: 0,
      blinking: false,
      blinkT: 0,
      nearT: 0,
      hitN: 0,
      hitT: 0,
      side: e.rng.chance(0.5) ? 1 : -1,
      strafeT: F(e.rng.int(60, 140)),
      awayT: 0,
      los: false, losT: 0,
      /** The pillars of the running channel (their hazards) and whether each has erupted. @type {EnemyHazard[]} */
      pillars: [],
      erupted: [false, false, false],
      /** Which pillar's circle has its sigil. */
      glyph: [false, false, false],
      /** The channel's next sigil (a frame index of the state); `each`'s counter. */
      sigilT: 0,
      each: 0,
    };
  },

  /** Besieging: fire flung at the roof. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {WyrmcallerAI} */ (e.ai);
    const t = besiegeStep(e, h, ctx, SIEGE_PERIOD, -1, SIEGE_RING, SIEGE_ROOM);
    if (t < 0) {
      if (ai.siege.there) e.anim('idle');
      return;
    }
    const s = ai.siege;
    const p = e.position;
    if (t < SIEGE_WIND) {
      e.pose('windup');
      if (Math.floor(t / 0.12) !== Math.floor((t - h) / 0.12)) {
        const o = orb(e);
        ctx.burst('bruteGather', o.x, o.y, o.z, 2);
      }
    } else if (t < SIEGE_WIND + SIEGE_THROW) {
      e.pose('throw');
      if (!s.hit) {
        s.hit = true;
        // the bolt to the roof's edge above the wall point
        const B = e.besiege;
        let dx = B.x - s.wx;
        let dz = B.z - s.wz;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const rx = s.wx + dx * 0.4;
        const rz = s.wz + dz * 0.4;
        const ry = s.wy + ROOF_Y;
        const y0 = p.y + ROOF_BOLT.y;
        const d = Math.hypot(rx - p.x, rz - p.z);
        const ps = e.projSpec();
        ps.kind = 'emberBolt';
        ps.x = p.x + e.facing.x * 0.3;
        ps.y = y0;
        ps.z = p.z + e.facing.z * 0.3;
        ps.dirX = d > 1e-3 ? (rx - p.x) / d : e.facing.x;
        ps.dirZ = d > 1e-3 ? (rz - p.z) / d : e.facing.z;
        ps.speed = ROOF_BOLT.speed;
        ps.vy = aimVy(y0, ry, ROOF_BOLT.speed, d);
        ps.range = d + 1;
        ps.radius = ROOF_BOLT.radius;
        ps.mv = 0;
        ps.kb = 0;
        ps.look = ROOF_LOOK;
        ctx.projectile(e, ps);
        ctx.sfx('fireballFall', p.x, p.z, { volume: 0.5 });
        s.fireAt = t + d / ROOF_BOLT.speed;
      }
    } else e.anim('idle');
    if (s.fireAt >= 0 && t >= s.fireAt) {
      s.fireAt = -1;
      const B = e.besiege;
      const rx = s.wx + (B.x - s.wx) * 0.12;
      const rz = s.wz + (B.z - s.wz) * 0.12;
      const ry = s.wy + ROOF_Y;
      ctx.burst('bruteFireCore', rx, ry, rz, 2);
      ctx.burst('bruteFireBlast', rx, ry, rz, 12);
      ctx.burst('bruteEmbers', rx, ry + 0.3, rz, 6);
      ctx.burst('bruteSmoke', rx, ry + 0.6, rz, 4);
      ctx.fx('bruteFlames', rx, ry - 0.2, rz, FLAMES_FX);
      ctx.sfx('fireRoar', rx, rz, { volume: 0.5 });
    }
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {WyrmcallerAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    leaveSpot(e);
    if (ai.cd > 0) ai.cd -= h;
    if (ai.pillarCd > 0) ai.pillarCd -= h;
    if (ai.blinkCd > 0) ai.blinkCd -= h;
    ai.hitT += h;
    if (ai.hitT > BLINK.hitWindow) ai.hitN = 0;
    ai.nearT = tp.d < BLINK.near ? ai.nearT + h : 0;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }
    if (ai.blinking) {
      blink(e, h, ctx);
      return;
    }
    const f = ai.force;
    const want = (move) => (f ? f === move : true);
    if (want('blink') && (f === 'blink' || (ai.blinkCd <= 0 && (ai.nearT >= F(BLINK.nearF) - EPS || ai.hitN >= BLINK.hits)))) {
      ai.force = null;
      ai.blinking = true;
      ai.blinkT = 0;
      blink(e, h, ctx);
      return;
    }
    const onScreen = e.canWindup(ctx);
    if (onScreen && ai.los) {
      if (want('pillars') && tp.d <= PILLARS.range
        && (f === 'pillars' || (ai.cd <= 0 && ai.pillarCd <= 0 && e.rng.chance(PILLARS.chance))) && e.takeToken(ctx)) {
        start(e, 'pillars');
        return;
      }
      if (want('fireball') && tp.d <= FIREBALL.range && (f === 'fireball' || ai.cd <= 0) && e.takeToken(ctx)) {
        start(e, 'fireball');
        return;
      }
      if (!f && ai.pillarCd <= 0) ai.pillarCd = 1.2;
    }
    // keep the range: back off when pressed, close in when far or out of sight, else circle
    if (tp.d < KEEP.min - 0.5) {
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
    if (tp.d > KEEP.max || ((ai.cd <= 0) && (!onScreen || !ai.los))) {
      e.chase(SPEED, h, ctx, 'walk');
      return;
    }
    ai.strafeT -= h;
    if (ai.strafeT <= 0) {
      if (e.rng.chance(0.5)) ai.side = -ai.side;
      ai.strafeT = F(e.rng.int(60, 140));
    }
    const fr = e.walk(-tp.dz * ai.side, tp.dx * ai.side, SPEED * 0.6, h, ctx, 'walk', false);
    e.face(P.x, P.z);
    if (fr < 0.25) ai.side = -ai.side;
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {WyrmcallerAI} */ (e.ai);
    if (ai.move === 'pillars') pillars(e, h, ctx);
    else fireball(e, h, ctx);
  },

  /** Melee hits count toward a blink. @type {Brain['onHit']} */
  onHit(e, info) {
    const ai = /** @type {WyrmcallerAI} */ (e.ai);
    if (info.source !== 'melee') return;
    if (ai.hitT > BLINK.hitWindow) ai.hitN = 0;
    ai.hitN++;
    ai.hitT = 0;
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {WyrmcallerAI} */ (e.ai);
    ai.blinking = false;
    ai.blinkT = 0;
    ai.pillars.length = 0;
    leaveSpot(e);
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.burst('bruteBlink', p.x, p.y + 0.8, p.z, 12);
    ctx.burst('bruteSmoke', p.x, p.y + 0.5, p.z, 5);
    ctx.fx('bruteFlames', p.x, p.y - 0.3, p.z, DEATH_FLAMES);
    ctx.sfx('fireRoar', p.x, p.z, { volume: 0.5, pitch: 1.2 });
  },

  /** Burning up: embers off the body while it burns, then its own fade. @type {Brain['dead']} */
  dead(e, h, ctx) {
    const p = e.position;
    const n = F(DEATH.embers);
    if (e.t < F(DEATH.still + DEATH.fade) && Math.floor(e.t / n) !== Math.floor((e.t - h) / n)) {
      ctx.burst('bruteEmbers', p.x, p.y + 0.3, p.z, 3);
    }
    const k = (e.t - F(DEATH.still)) / F(DEATH.fade);
    if (k > 0) e.sprite.opacity = Math.min(e.sprite.opacity, Math.max(0, 1 - k));
    return true;
  },

  /** The staff's flame; brighter while casting. @type {Brain['glow']} */
  glow(e, out) {
    const casting = e.state === 'windup' || e.state === 'active';
    out[0] = 1.0;
    out[1] = 0.55;
    out[2] = 0.2;
    out[3] = !e.alive ? 0.5 : casting ? 3.0 : 2.0;
  },
};

/** The flames on a burning body (no loop: they die down with it). @type {FxOptions} */
const DEATH_FLAMES = { mode: 'billboard', lift: 0.55, color: [2.2, 0.95, 0.3], loops: 3, fps: 12, scale: 1.4 };
/** The blink's flare where it vanishes and where it appears. @type {FxOptions} */
const BLINK_FX = { mode: 'billboard', lift: 0.6, color: [2.4, 1.05, 0.32], loops: 1, fps: 16, scale: 1.5 };

/** `orb`'s result (reused: the brains run one at a time). */
const _orb = { x: 0, y: 0, z: 0 };

/**
 * The staff's orb in the world (the staff is in the right hand: right of the facing).
 * @param {Enemy} e
 * @returns {{ x: number, y: number, z: number }} a reused record
 */
function orb(e) {
  const p = e.position;
  _orb.x = p.x - e.facing.z * 0.45 + e.facing.x * 0.2;
  _orb.y = p.y + 2.4;
  _orb.z = p.z + e.facing.x * 0.45 + e.facing.z * 0.2;
  return _orb;
}

/**
 * True once every `n` frames of the current state, from its first frame — counted, so a sub-step
 * shorter than a frame (a chilled or slowed caster) never fires it twice.
 * @param {Enemy} e
 * @param {WyrmcallerAI} ai
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
 * Begin a spell: its wind-up.
 * @param {Enemy} e
 * @param {'fireball'|'pillars'} move
 */
function start(e, move) {
  const ai = /** @type {WyrmcallerAI} */ (e.ai);
  ai.move = move;
  ai.force = null;
  e.setState('windup');
}

/**
 * The end of a spell: the token back, the cooldown.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @param {number} cd seconds
 */
function endMove(e, ctx, cd) {
  const ai = /** @type {WyrmcallerAI} */ (e.ai);
  e.dropToken(ctx);
  ai.cd = cd;
  e.setState('engage');
}

/**
 * The fireball: the gathering wind-up, the cast — a lobbed ember (its look) and the landing
 * circle (the hazard that explodes).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function fireball(e, h, ctx) {
  const P = ctx.player;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('windup', p.x, p.z);
    e.face(P.position.x, P.position.z);
    e.pose('windup');
    if (each(e, /** @type {WyrmcallerAI} */ (e.ai), 4)) {
      const o = orb(e);
      ctx.burst('bruteGather', o.x, o.y, o.z, 2);
    }
    if (e.after(FIREBALL.windup)) {
      let tx = P.position.x + P.velocity.x * FIREBALL.lead;
      let tz = P.position.z + P.velocity.z * FIREBALL.lead;
      let dx = tx - p.x;
      let dz = tz - p.z;
      const d0 = Math.hypot(dx, dz);
      if (d0 > FIREBALL.range + 1) {
        tx = p.x + (dx / d0) * (FIREBALL.range + 1);
        tz = p.z + (dz / d0) * (FIREBALL.range + 1);
        dx = tx - p.x;
        dz = tz - p.z;
      }
      // the hit: a delayed circle whose fill is the telegraph; its burst the explosion's core (the
      // flash, the flame tongues and the boom are the fireball's look)
      const hz = e.hazardCircle(tx, tz, FIREBALL.r, FIREBALL.flight);
      hz.mv = FIREBALL.mv;
      hz.kb = FIREBALL.kb;
      hz.burst = 'bruteFireCore';
      hz.burstN = 5;
      // the fireball itself: a lobbed look that lands with the hazard (its own hit is nothing)
      const o = orb(e);
      const dist = Math.hypot(tx - o.x, tz - o.z);
      const ps = e.projSpec();
      ps.kind = 'emberBolt';
      ps.x = o.x;
      ps.y = o.y;
      ps.z = o.z;
      ps.dirX = dist > 1e-3 ? (tx - o.x) / dist : e.facing.x;
      ps.dirZ = dist > 1e-3 ? (tz - o.z) / dist : e.facing.z;
      ps.speed = dist / FIREBALL.flight;
      ps.range = dist;
      ps.radius = 0.05;
      ps.mv = 0;
      ps.kb = 0;
      ps.arc = { tx, tz, time: FIREBALL.flight, apex: FIREBALL.apex };
      ps.look = FIREBALL_LOOK;
      ctx.projectile(e, ps);
      ctx.burst('bruteFireCore', o.x, o.y, o.z, 2);
      ctx.sfx('fireballFall', p.x, p.z);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('attack');
    if (e.after(FIREBALL.cast)) e.setState('recover');
    return;
  }
  e.anim('idle');
  if (e.after(FIREBALL.recover)) endMove(e, ctx, FIREBALL.cooldown);
}

/**
 * The flame pillars: the channel's wind-up, three tracking circles that erupt in turn, the channel
 * held until the last one.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function pillars(e, h, ctx) {
  const ai = /** @type {WyrmcallerAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('fireRoar', p.x, p.z, { volume: 0.6, pitch: 0.8 });
    e.face(P.x, P.z);
    e.pose('channel');
    if (each(e, ai, 4)) {
      const o = orb(e);
      ctx.burst('bruteGather', o.x, o.y, o.z, 2);
      if ((e.fr & 7) < 4) ctx.burst('bruteEmbers', p.x, p.y + 0.3, p.z, 3);
    }
    sigil(e, ctx);
    if (e.after(PILLARS.windup)) {
      ai.pillars.length = 0;
      for (let k = 0; k < PILLARS.n; k++) {
        const hz = e.hazardCircle(0, 0, PILLARS.r, PILLARS.fill, k * PILLARS.every, true);
        hz.mv = PILLARS.mv;
        hz.kb = PILLARS.kb;
        hz.burst = 'brutePillar';
        hz.burstN = 20;
        hz.sfx = 'fireRoar';
        ai.pillars.push(hz);
        ai.erupted[k] = false;
        ai.glyph[k] = false;
      }
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('channel');
    e.face(P.x, P.z);
    sigil(e, ctx);
    // each pillar: a sigil under its circle as it appears, its column of fire as it erupts (the
    // hazard's burst and sound are its own)
    for (let k = 0; k < ai.pillars.length; k++) {
      const hz = ai.pillars[k];
      if (!hz.on) continue;
      if (hz.started && !ai.glyph[k]) {
        ai.glyph[k] = true;
        ctx.fx('bruteSigil', hz.x, ctx.groundAt(hz.x, hz.z), hz.z, PILLAR_SIGIL_FX);
      }
      if (ai.erupted[k] || !hz.resolved) continue;
      ai.erupted[k] = true;
      const gy = ctx.groundAt(hz.x, hz.z);
      ctx.fx('brutePillar', hz.x, gy, hz.z, PILLAR_FX);
      ctx.burst('bruteFireCore', hz.x, gy + 0.6, hz.z, 3);
      ctx.burst('bruteSmoke', hz.x, gy + 1.6, hz.z, 3);
    }
    if (e.t >= (PILLARS.n - 1) * PILLARS.every + PILLARS.fill + F(2) - EPS) {
      ai.pillars.length = 0;
      e.setState('recover');
    }
    return;
  }
  e.anim('idle');
  if (e.after(PILLARS.recover)) {
    ai.pillarCd = PILLARS.cooldown;
    endMove(e, ctx, FIREBALL.cooldown);
  }
}

/**
 * The cult's sigil burning under a channelling pyromancer: played at the channel's start and again
 * every 40 f (each play two passes of its pulse, 0.67 s), so it goes out with the channel.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 */
function sigil(e, ctx) {
  const ai = /** @type {WyrmcallerAI} */ (e.ai);
  if (e.entered) ai.sigilT = 0;
  if (e.fr < ai.sigilT) return;
  ai.sigilT = e.fr + 40;
  const p = e.position;
  ctx.fx('bruteSigil', p.x, ctx.groundAt(p.x, p.z), p.z, SIGIL_FX);
}

/**
 * The blink: sink into a swirl of fire, reappear away from the target, a fire circle left behind.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function blink(e, h, ctx) {
  const ai = /** @type {WyrmcallerAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (ai.blinkT === 0) {
    ctx.burst('bruteBlink', p.x, p.y + 0.6, p.z, 10);
    ctx.fx('bruteFlames', p.x, p.y, p.z, BLINK_FX);
    ctx.sfx('cackle', p.x, p.z);
  }
  e.pose('blink');
  ai.blinkT += h;
  if (ai.blinkT < F(BLINK.tuck) - EPS) return;
  const x0 = p.x;
  const z0 = p.z;
  const hz = e.hazardCircle(x0, z0, BLINK.r, BLINK.fill);
  hz.mv = BLINK.mv;
  hz.kb = BLINK.kb;
  hz.burst = 'bruteFireBlast';
  hz.burstN = 12;
  hz.sfx = 'fireRoar';
  ctx.burst('deathPoof', p.x, p.y + 0.6, p.z, 6);
  if (!e.bestAway(P.x, P.z, BLINK.dist, ctx)) {
    e.away.x = -e.tp.dx;
    e.away.z = -e.tp.dz;
  }
  e.move(e.away.x * BLINK.dist, e.away.z * BLINK.dist, ctx);
  ctx.burst('bruteBlink', p.x, ctx.groundAt(p.x, p.z) + 0.6, p.z, 10);
  ctx.fx('bruteFlames', p.x, ctx.groundAt(p.x, p.z), p.z, BLINK_FX);
  e.face(P.x, P.z);
  e.anim('idle');
  ai.blinking = false;
  ai.blinkT = 0;
  ai.blinkCd = BLINK.cooldown;
  ai.nearT = 0;
  ai.hitN = 0;
}
