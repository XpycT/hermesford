/**
 * An arm of Old Gullet (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §6.7): the
 * `tentacle`, one of the head's pooled adds (`adds: 'tentacle'`). It does nothing of its own: the
 * head (./gullet.js) picks the spot, opens the hole, and gives it an order — and the arm plays it,
 * rising through the ice, telegraphing, striking, lying there to be cut, and sinking back under to
 * wait for the next. Owner: the gullet package.
 *
 * Orders (`ai.order`, `ArmOrder`), each a timeline in the states `windup` / `active` / `recover`:
 * - `slam`: rises at the crack's far end, rears; the lane it will strike (2 wide, `len` long) tracks
 *   its prey, then locks — and the crack races along it (the ice breaking where it will fall); flung
 *   down flat (knockdown), the ice erupting along the lane; lies there `lie` frames, then sinks.
 * - `sweep`: rises in a lasting hole, swings back low; the sector (± 120°, r 4.6) round the hole
 *   tracks, then locks; swung across it; lies a moment, sinks.
 * - `rise`: up through the ice to sway a while (`hold` frames) and sink (the transitions).
 * While under (`ai.under`) it is hidden, guarded and still — an arm that sank is the head's to order
 * again. Cut (HP 0: `die` / `dead`) it slides back under for good; the head counts it.
 *
 * It is anchored in its hole: infinite mass (no knockback), infinite poise (no stagger), no leash; a
 * stun or a freeze (a hold, §29 V5) breaks off its order — it sinks when the hold ends.
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { CombatContext, Brain } from '../../types.js'
 * @import { GulletIce } from './gulletIce.js'
 */
import { TINTS } from '../../../../engine/pixel/fx/evGulletFx.js';
import { WARM_STYLE } from './gulletIce.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

/** How deep an arm waits under the ice (its 6 u frame below the waterline). */
export const ARM_DEEP = -6.4;
/** Frames to rise through the ice, and to sink back. */
const RISE_F = 14;
const SINK_F = 16;
/** The slam: the lane's lock (frames before the strike), the strike, the eruptions along the lane. */
const SLAM = { lock: 18, active: 6, width: 2, mv: 0.7, kb: 2.6, every: 1.4 };
/** The sweep: its sector, the strike's frames. */
const SWEEP = { lock: 16, active: 10, r: 4.6, half: 120, mv: 0.7, kb: 2.2 };

/**
 * The head's order to an arm.
 * @typedef {object} ArmOrder
 * @property {'slam'|'sweep'|'rise'} kind
 * @property {number} x        its hole
 * @property {number} z
 * @property {number} dx       toward its prey (unit)
 * @property {number} dz
 * @property {number} len      the slam's lane
 * @property {number} windup   frames from the rise to the strike
 * @property {number} lie      frames it lies there after the strike (the sweep's, the rise's hold)
 * @property {GulletIce|null} ice the ice stage (its crack)
 */

/**
 * The arm's state (`e.ai`).
 * @param {Enemy} e
 */
function initAI(e) {
  hide(e);
  // (in the fight from the start: the pool's `spawnAdd` resets and then wakes it, and an arm that
  // noticed the party would show the alert mark and play `enemyAlert` from under the ice — EVM-29;
  // a pooled arm out of play is made non-aggro again by core's `_hideAdd`)
  e.aggro = true;
  return {
    /** @type {ArmOrder|null} */
    order: null,
    under: true,
    /** The order struck (the head counts a slam). */
    struck: false,
    /** Sinking (after the order, or broken off). */
    sinking: false,
    sinkFrom: 0,
    sinkT: 0,
    tag: 0,
    lx: 0,
    lz: 1,
    cracked: false,
    /** The eruptions along the lane still to come: [x, z, at (s after the strike)]. */
    wave: /** @type {number[][]} */ ([]),
    waveT: 0,
    sweepA: 0,
    dieT: 0,
    deadLift: 0,
    /** Counted by the head (a cut arm). */
    counted: false,
  };
}

/** @typedef {ReturnType<typeof initAI>} ArmAI */

/**
 * Under the ice: hidden, guarded, deep.
 * @param {Enemy} e
 */
function hide(e) {
  e.sprite.visible = false;
  e.guarded = true;
  e.lift = ARM_DEEP;
}

/**
 * Give an arm an order: it rises at (order.x, order.z) at once.
 * @param {Enemy} e @param {ArmOrder} order @param {CombatContext} ctx
 */
export function orderArm(e, order, ctx) {
  const ai = /** @type {ArmAI} */ (e.ai);
  ai.order = order;
  ai.under = false;
  ai.struck = false;
  ai.sinking = false;
  ai.cracked = false;
  ai.wave.length = 0;
  e.home.x = order.x;
  e.home.z = order.z;
  e.position.set(order.x, ctx.groundAt(order.x, order.z), order.z);
  e.faceDir(order.dx, order.dz);
  e.lift = ARM_DEEP;
  e.sprite.visible = true;
  e.sprite.opacity = 1;
  e.guarded = false;
  e.setState('windup');
}

/** Is this arm under the ice, free for an order? @param {Enemy} e */
export function armFree(e) {
  const ai = /** @type {ArmAI|null} */ (e.ai);
  return !!ai && e.alive && ai.under && !ai.order;
}

/**
 * The ice thrown up where it breaks through: a small burst of slabs, spray and mist.
 * @param {CombatContext} ctx @param {number} x @param {number} z @param {number} [scale]
 */
export function breakThrough(ctx, x, z, scale = 0.8) {
  const y = ctx.groundAt(x, z);
  ctx.fx('gulletBurst', x, y, z, { mode: 'billboard', lift: 1.5 * scale, color: [...TINTS.gulletBurst], loops: 1, scale });
  ctx.burst('gulletIce', x, y + 0.2, z, Math.round(8 * scale + 2));
  ctx.burst('gulletSpray', x, y + 0.2, z, Math.round(8 * scale + 2));
  if (scale >= 0.8) ctx.burst('gulletMist', x, y + 0.2, z, 4);
}

/** @param {number} t 0..1 @returns {number} ease-out */
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** @satisfies {Brain} */
export const tentacleBrain = {
  init: initAI,

  /** Under the ice it waits (no wander). @type {Brain['idle']} */
  idle(e) {
    const ai = /** @type {ArmAI} */ (e.ai);
    if (ai.under) hide(e);
  },

  /**
   * No order: under the ice. An order broken off (a hold ended): it sinks.
   * @type {Brain['engage']}
   */
  engage(e, h, ctx) {
    const ai = /** @type {ArmAI} */ (e.ai);
    if (ai.under) {
      hide(e);
      return;
    }
    beginSink(e);
    e.setState('recover');
  },

  /** The order's timeline. @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {ArmAI} */ (e.ai);
    const o = ai.order;
    if (ai.sinking || !o) {
      sink(e, h, ctx);
      return;
    }
    if (o.kind === 'slam') slam(e, o, h, ctx);
    else if (o.kind === 'sweep') sweep(e, o, h, ctx);
    else rise(e, o, ctx);
  },

  /** Drop the order's marker (an interrupt, a death). @type {Brain['cancel']} */
  cancel(e, ctx) {
    if (ctx) e.unmarkAll(ctx);
  },

  /** Cut: it slides back under (`dead`). @type {Brain['die']} */
  die(e, ctx) {
    const ai = /** @type {ArmAI} */ (e.ai);
    ai.dieT = 0;
    ai.deadLift = e.lift;
    if (ctx && e.sprite.visible) {
      const p = e.position;
      ctx.burst('gulletSpray', p.x, p.y + 0.3, p.z, 10);
      ctx.sfx('iceBreak', p.x, p.z, { volume: 0.6, pitch: 1.25 });
    }
  },

  /**
   * Sliding back under the ice (0.55 s), then gone. True: it fades itself.
   * @type {Brain['dead']}
   */
  dead(e, h) {
    const ai = /** @type {ArmAI} */ (e.ai);
    ai.dieT += h;
    const u = Math.min(1, ai.dieT / 0.55);
    e.pose('dead');
    e.lift = ai.deadLift + (ARM_DEEP - ai.deadLift) * u * u;
    e.sprite.mesh.position.y = e.lift;
    e.sprite.shadowProxy.position.y = e.lift;
    if (u >= 1) e.sprite.opacity = 0;
    return true;
  },
};

/**
 * Up through the ice (the rise, `RISE_F` frames): the lift eased out, the rise pose first.
 * @param {Enemy} e @param {number} f frames into the order
 * @returns {boolean} still rising
 */
function rising(e, f) {
  const u = Math.min(1, f / RISE_F);
  e.lift = ARM_DEEP * (1 - easeOut(u));
  return u < 1;
}

/** @param {Enemy} e */
function beginSink(e) {
  const ai = /** @type {ArmAI} */ (e.ai);
  if (ai.sinking) return;
  ai.sinking = true;
  ai.sinkFrom = e.lift;
  ai.sinkT = 0;
}

/**
 * Sinking back under: guarded from the first frame, hidden at the end — free for the next order.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function sink(e, h, ctx) {
  const ai = /** @type {ArmAI} */ (e.ai);
  if (!ai.sinking) beginSink(e);
  if (ai.sinkT === 0) {
    e.unmarkAll(ctx);
    const p = e.position;
    ctx.burst('gulletSpray', p.x, p.y + 0.2, p.z, 6);
  }
  e.guarded = true;
  ai.sinkT += h;
  const u = Math.min(1, ai.sinkT / F(SINK_F));
  e.pose('dead');
  e.lift = ai.sinkFrom + (ARM_DEEP - ai.sinkFrom) * u * u;
  if (u >= 1) {
    ai.order = null;
    ai.sinking = false;
    ai.under = true;
    hide(e);
    e.setState('engage');
  }
}

/**
 * The slam: rise and rear, the lane tracking then locked, the crack racing along it, the strike and
 * the eruptions travelling down the lane, the lying there, the sink.
 * @param {Enemy} e @param {ArmOrder} o @param {number} h @param {CombatContext} ctx
 */
function slam(e, o, h, ctx) {
  const ai = /** @type {ArmAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) {
      breakThrough(ctx, o.x, o.z, 0.8);
      ctx.sfx('iceBreak', o.x, o.z, { volume: 0.7 });
      ai.lx = o.dx;
      ai.lz = o.dz;
    }
    const f = e.fr;
    e.pose(rising(e, f) && f < RISE_F * 0.6 ? 'rise' : 'windup');
    const lockAt = o.windup - SLAM.lock;
    if (e.t < F(lockAt) - EPS) {
      // tracking: the lane swings after its prey
      const P = ctx.player.position;
      const dx = P.x - o.x;
      const dz = P.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        // (turns at most 140°/s: a dodge to the side outruns it near the end)
        const want = Math.atan2(dx / d, dz / d);
        let cur = Math.atan2(ai.lx, ai.lz);
        let dd = want - cur;
        while (dd > Math.PI) dd -= 2 * Math.PI;
        while (dd < -Math.PI) dd += 2 * Math.PI;
        const max = (140 * Math.PI / 180) * h;
        cur += Math.max(-max, Math.min(max, dd));
        ai.lx = Math.sin(cur);
        ai.lz = Math.cos(cur);
      }
    } else if (!ai.cracked) {
      // locked: the crack races along the lane
      ai.cracked = true;
      o.ice?.crack(o.x + ai.lx * 0.9, o.z + ai.lz * 0.9, ai.lx, ai.lz, o.len - 0.9, F(SLAM.lock - 2), F(SLAM.lock + SLAM.active) + 1.6);
      ctx.sfx('iceCrack', o.x + ai.lx * o.len * 0.5, o.z + ai.lz * o.len * 0.5, { volume: 0.9 });
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        ctx.burst('gulletCrackDust', o.x + ai.lx * o.len * t, ctx.groundAt(o.x, o.z) + 0.1, o.z + ai.lz * o.len * t, 3);
      }
    }
    e.faceDir(ai.lx, ai.lz);
    const m = e.markerSpec('lane', o.x, o.z);
    m.dirX = ai.lx;
    m.dirZ = ai.lz;
    m.len = o.len;
    m.width = SLAM.width;
    m.style = 'crack';
    m.progress = Math.min(1, e.t / F(o.windup));
    m.flash = e.lockFlash(e.t - F(lockAt));
    e.mark(0, ctx, m);
    if (e.after(o.windup)) {
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('attack');
    e.lift = 0;
    if (e.entered) {
      ai.struck = true;
      ctx.shake(0.42, 0.42);
      ctx.sfx('tentacleSlam', p.x + ai.lx * 2, p.z + ai.lz * 2, { volume: 1 });
      ctx.sfx('iceBreak', p.x + ai.lx * o.len * 0.6, p.z + ai.lz * o.len * 0.6, { volume: 0.8, pitch: 0.85 });
      ai.wave.length = 0;
      ai.waveT = 0;
      for (let d = 1.2, k = 0; d <= o.len + 0.01; d += SLAM.every, k++) ai.wave.push([o.x + ai.lx * d, o.z + ai.lz * d, k * F(1.5)]);
    }
    const s = e.hitSpec();
    s.shape = 'lane';
    s.x = o.x;
    s.z = o.z;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.len = o.len;
    s.width = SLAM.width;
    s.mv = SLAM.mv;
    s.kb = SLAM.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    erupt(e, h, ctx);
    if (e.after(SLAM.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  // lying there, the eruptions finishing their run down the lane; then the sink
  erupt(e, h, ctx);
  e.pose(e.fr < 6 ? 'attack' : 'lie');
  if (e.after(o.lie)) beginSink(e);
}

/**
 * The eruptions travelling down the lane after a slam (one every 1.5 frames).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function erupt(e, h, ctx) {
  const ai = /** @type {ArmAI} */ (e.ai);
  if (!ai.wave.length) return;
  ai.waveT += h;
  while (ai.wave.length && ai.wave[0][2] <= ai.waveT + EPS) {
    const [x, z] = /** @type {number[]} */ (ai.wave.shift());
    breakThrough(ctx, x, z, 0.62);
  }
}

/**
 * The sweep: rise and swing back low, the sector tracking then locked, the swing across it (the
 * sprite turning through its rows), a moment low on the ice, the sink.
 * @param {Enemy} e @param {ArmOrder} o @param {number} h @param {CombatContext} ctx
 */
function sweep(e, o, h, ctx) {
  const ai = /** @type {ArmAI} */ (e.ai);
  if (e.state === 'windup') {
    if (e.entered) {
      breakThrough(ctx, o.x, o.z, 0.9);
      ctx.sfx('iceBreak', o.x, o.z, { volume: 0.7 });
      ai.lx = o.dx;
      ai.lz = o.dz;
    }
    const f = e.fr;
    e.pose(rising(e, f) && f < RISE_F * 0.6 ? 'rise' : 'sweepWind');
    if (e.t < F(o.windup - SWEEP.lock) - EPS) {
      const P = ctx.player.position;
      const d = Math.hypot(P.x - o.x, P.z - o.z);
      if (d > 0.5) {
        ai.lx = (P.x - o.x) / d;
        ai.lz = (P.z - o.z) / d;
      }
    }
    // (wound back: it faces away from the swing's end)
    const back = Math.atan2(ai.lx, ai.lz) + (100 * Math.PI) / 180;
    e.faceDir(Math.sin(back), Math.cos(back));
    const m = e.markerSpec('sector', o.x, o.z);
    m.r = SWEEP.r;
    m.halfAngle = SWEEP.half;
    m.dirX = ai.lx;
    m.dirZ = ai.lz;
    m.style = WARM_STYLE;
    m.progress = Math.min(1, e.t / F(o.windup));
    m.flash = e.lockFlash(e.t - F(o.windup - SWEEP.lock));
    e.mark(0, ctx, m);
    if (e.after(o.windup)) {
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.lift = 0;
    e.pose('sweep');
    const u = Math.min(1, e.t / F(SWEEP.active));
    const a = Math.atan2(ai.lx, ai.lz) + ((100 - 200 * u) * Math.PI) / 180;
    e.faceDir(Math.sin(a), Math.cos(a));
    if (e.entered) {
      ai.struck = true;
      ai.sweepA = -1;
      ctx.sfx('tentacleSlam', o.x, o.z, { volume: 0.9, pitch: 1.2 });
      ctx.shake(0.25, 0.3);
    }
    // the ice erupting along the arc as the arm sweeps through it (every other frame)
    const k = Math.floor(e.fr / 2);
    if (k !== ai.sweepA) {
      ai.sweepA = k;
      breakThrough(ctx, o.x + Math.sin(a) * 3.6, o.z + Math.cos(a) * 3.6, 0.55);
      const y = ctx.groundAt(o.x, o.z);
      ctx.burst('gulletSpray', o.x + Math.sin(a) * 2.2, y + 0.3, o.z + Math.cos(a) * 2.2, 4);
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.x = o.x;
    s.z = o.z;
    s.r = SWEEP.r;
    s.halfAngle = SWEEP.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = SWEEP.mv;
    s.kb = SWEEP.kb;
    s.fromX = o.x;
    s.fromZ = o.z;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (e.after(SWEEP.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  e.pose('sweep');
  if (e.after(o.lie)) beginSink(e);
}

/**
 * The transitions' rise: up through the ice, sway a while, sink.
 * @param {Enemy} e @param {ArmOrder} o @param {CombatContext} ctx
 */
function rise(e, o, ctx) {
  if (e.state === 'windup' && e.entered) {
    breakThrough(ctx, o.x, o.z, 0.8);
    ctx.sfx('iceBreak', o.x, o.z, { volume: 0.6 });
  }
  const f = e.state === 'windup' ? e.fr : 999;
  if (rising(e, f)) e.pose('rise');
  else e.anim('idle');
  if (e.state === 'windup' && e.after(o.lie)) beginSink(e);
}
