/**
 * Drakeborn Ravager — the heavy brute of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.7). Also home of the brutes' shared **besieging** (`besiegeStep`), which the hellhound and
 * the pyromancer brains import.
 *
 * Idle — besieging (`e.besiege`, the group's house): each brute takes a spot on the house's ring
 * (from its home's side, spread by its index, clear of the other besiegers' spots, standable), walks
 * there, faces the house and swings at the wall in turn (a 2.6 s cycle staggered by its index):
 * the cleaver raised (`windup`), the chop (`attack`) — sparks, splinters and dust on the wall,
 * `wallHit` — the follow-through; every third swing an overhead chop (`slamWind` → `slam`) with more
 * dust and a `crash`. No hitbox, no aggro side effects (the combat core decides aggro; the same
 * idle plays in the ambient step of a story scene, `ctx.ambient`). Without a house it wanders.
 *
 * Engage — a slow, relentless advance (2.5 u/s on the walk grid); the first engage after a notice
 * opens with a roar (24 f, pose `roar`, `growl`). Three moves, each a telegraphed wind-up (§7.3:
 * ≥ 18 f, markers for every area), one melee token:
 *  - **Cleave** (d ≤ 3.0): wind-up 30 f (pose `windup`, `growl`), a sector marker r 2.6 ±70° that
 *    fills over it (the facing locks for the last 8 f; it steps in while > 1.8 u); 6 f active (pose
 *    `attack`, 0.6 u lunge, sector hit mv 1.3, kb 2.0, poise 0, `swingHeavy`, the `bruteCleave`
 *    crescent on the ground); 35 % a
 *    backhand follow-up with its own 20 f wind-up and marker (pose `follow` → `cleave2`, mv 1.1,
 *    kb 2.4); recover 36 f; cooldown 54 f.
 *  - **Ground slam** (d ≤ 3.6, 30 %, cooldown 6 s): wind-up 42 f (pose `slamWind`, `growl`), a
 *    circle marker r 3.0 centred 1.1 u ahead (the facing locks for the last 12 f); 4 f active
 *    (pose `slam`, circle hit mv 1.6, kb 2.8, knockdown), shake, `quake`, glowing cracks racing out
 *    (`bruteQuake`), dust, rubble, sparks; then a shockwave ring (r 1.2 → 5.4 at 10 u/s, 0.9 wide,
 *    mv 0.5, kb 1.6); recover 50 f.
 *  - **Charging gore** (4 ≤ d ≤ 9, line of sight, 55 %, cooldown 7 s): wind-up 44 f (pose
 *    `goreWind`, `growl`, dust pawed up every 12 f) with a lane marker 1.6 wide as long as its free
 *    run (≤ 10 u) that tracks the target for 32 f and locks for 12 f; the charge at 9.5 u/s (poses
 *    `gore0` / `gore1`, armoured, a circle hit r 1.0 ahead each sub-step, mv 1.5, kb 3.2, knockdown,
 *    dust every 6 f); into a wall or a collider: a `crash`, shake, and it reels 70 f (pose `hurt`,
 *    ×1.3 damage taken); else a 20 f skid and a 40 f recover.
 * A target out of melee reach is chased along the walk grid. Its ember eyes glow (`uGlow`).
 *
 * Death: it crashes down (pose `dead`, a pained growl, dust and rubble, a thud); its throes (`dead`)
 * keep the body there 30 f, an ember gasp rising off it, then fade it over 40 f.
 *
 * Test hook: `e.ai.force` = 'cleave' | 'slam' | 'gore' makes that move the next one picked as soon as
 * its range allows (cooldowns ignored); null: the brain's own choice.
 */

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain, FxOptions } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

// ---- the looks of its effects (atlas frames of src/engine/pixel/fx/bruteFx.js; one options record
// per effect, its direction written before each play: CombatFx copies what it reads) ----

/** The cleave's crescent on the ground (80 × 44 px = 5 × 2.75 u: the sector's r 2.6). @type {FxOptions} */
const CLEAVE_FX = { mode: 'flat', lift: 0.55, color: [1.9, 1.7, 1.45], loops: 1, scale: 1, dirX: 0, dirZ: 1, flip: false };
/** The cleave's frame centre ahead of its apex (half the frame's 2.75 u). */
const CLEAVE_FX_AHEAD = 1.35;
/** The slam's cracks glowing ember (64 px × 1.6 = 6.4 u across: the circle's r 3.0). @type {FxOptions} */
const QUAKE_FX = { mode: 'flat', lift: 0.04, color: [2.3, 0.95, 0.32], loops: 1, fps: 6, scale: 1.6, dirX: 0, dirZ: 1 };
/** The gore's crash into a wall: the same cracks, small. @type {FxOptions} */
const CRASH_FX = { mode: 'flat', lift: 0.04, color: [1.6, 0.8, 0.35], loops: 1, fps: 8, scale: 0.8, dirX: 0, dirZ: 1 };
/** A siege strike's flash on the wall (the named `impact`). @type {FxOptions} */
const WALL_FX = { scale: 0.9 };

// ---- besieging (shared by the brutes' brains) ----

/** Spots: tried at the house's ring (+0.5 u steps outward) round from the home's side. */
const SPOT_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
/**
 * The room a besieger keeps round its spot: three body radii (the drakeborn's 2.1 u, the hound's
 * 1.65 u), at least 1.35 u, or more when its brain asks (a caster's wider stance). Another
 * besieger's spot closer than the larger of the two rules a spot out; the ring is searched in steps
 * of about this arc.
 * @param {Enemy} e
 * @param {number} [min]
 */
const spotClear = (e, min = 0) => Math.max(1.35, e.def.radius * 3, min);
/** Walking to the spot: this fraction of the walk speed; arrived within 0.3 u; at most 8 s. */
const SIEGE_WALK = 0.55;
const SIEGE_ARRIVE = 0.3;
const SIEGE_WALK_MAX = 8;
/** Farther than this from its spot (pushed away), a besieger walks back. */
const SIEGE_PUSHED = 0.6;

/** A scratch list for `ctx.enemiesNear` (the brains run one at a time). @type {Enemy[]} */
const _near = [];

/**
 * The besieging state of a brute's brain (`e.ai.siege`): its spot, the wall point it strikes and
 * its height, the cycle clock and counters.
 * @typedef {object} SiegeState
 * @property {boolean} planned  the spot is chosen
 * @property {boolean} there    standing at it
 * @property {number} sx @property {number} sz  the spot
 * @property {number} wx @property {number} wz  the wall point (on the house's face, else 1 u ahead)
 * @property {number} wy  the ground height at the spot
 * @property {number} walk  seconds spent walking to the spot
 * @property {number} t  seconds into the current cycle
 * @property {number} n  cycles completed
 * @property {boolean} hit  this cycle's strike has fallen
 * @property {number} fireAt  the pyromancer's roof fire: cycle time of the bolt's arrival (−1: none)
 * @property {number} clear  the room it keeps round its spot (`spotClear`)
 */

/** @returns {SiegeState} */
export function siegeState() {
  return { planned: false, there: false, sx: 0, sz: 0, wx: 0, wz: 0, wy: 0, walk: 0, t: 0, n: 0, hit: false, fireAt: -1, clear: 1.35 };
}

/**
 * Is (x, z) a standable spot for `e`'s body (the point and four points at its move radius)?
 * @param {Enemy} e @param {CombatContext} ctx @param {number} x @param {number} z
 */
function standable(e, ctx, x, z) {
  const r = e.def.moveRadius;
  return ctx.walkable(x, z) && ctx.walkable(x + r, z) && ctx.walkable(x - r, z) && ctx.walkable(x, z + r) && ctx.walkable(x, z - r);
}

/**
 * Choose `e`'s spot round its house and the wall point it strikes from there.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @param {SiegeState} s
 * @param {number} reach the distance it keeps from the wall (−1: it stays on the ring)
 * @param {number} ring u beyond the house's ring radius where the search starts
 */
function planSpot(e, ctx, s, reach, ring) {
  const B = e.besiege;
  const hx = e.home.x - B.x;
  const hz = e.home.z - B.z;
  const a0 = Math.hypot(hx, hz) > 1e-3 ? Math.atan2(hz, hx) : e.index * 1.3;
  const step = s.clear / (B.r + ring + 0.6);
  // the index picks the first offset, so a pack spreads round the house's side it came from
  const first = SPOT_OFFSETS[e.index % 5];
  let found = false;
  for (let k = 0; k < SPOT_OFFSETS.length && !found; k++) {
    const a = a0 + (first + SPOT_OFFSETS[k]) * step;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    for (let rr = B.r + ring; rr <= B.r + ring + 2.5 + EPS && !found; rr += 0.5) {
      const x = B.x + cx * rr;
      const z = B.z + cz * rr;
      if (!standable(e, ctx, x, z) || !spotFree(e, ctx, x, z)) continue;
      s.sx = x;
      s.sz = z;
      found = true;
    }
  }
  if (!found) {
    s.sx = e.position.x;
    s.sz = e.position.z;
  }
  wallFrom(e, ctx, s, reach);
  s.planned = true;
}

/**
 * The wall point from the spot toward the house (the first unstandable sample, ≤ the spot's
 * distance from the house's centre); with `reach` ≥ 0 the spot moves up to `reach` u from it.
 * @param {Enemy} e @param {CombatContext} ctx @param {SiegeState} s @param {number} reach
 */
function wallFrom(e, ctx, s, reach) {
  const B = e.besiege;
  let dx = B.x - s.sx;
  let dz = B.z - s.sz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    dx = e.facing.x;
    dz = e.facing.z;
  } else {
    dx /= d;
    dz /= d;
  }
  let wall = -1;
  for (let u = 0.25; u <= Math.max(1, d) + EPS; u += 0.25) {
    if (!ctx.walkable(s.sx + dx * u, s.sz + dz * u)) {
      wall = u;
      break;
    }
  }
  if (wall < 0) wall = Math.min(1.2, Math.max(0.5, d - 0.5));
  else if (reach >= 0 && wall - reach > 0.3) {
    // step in toward the wall, as far as the body still stands
    for (let u = wall - reach; u > 0.1; u -= 0.25) {
      if (standable(e, ctx, s.sx + dx * u, s.sz + dz * u) && spotFree(e, ctx, s.sx + dx * u, s.sz + dz * u)) {
        s.sx += dx * u;
        s.sz += dz * u;
        wall -= u;
        break;
      }
    }
  }
  s.wx = s.sx + dx * wall;
  s.wz = s.sz + dz * wall;
  s.wy = ctx.groundAt(s.sx, s.sz);
}

/**
 * No other besieger's spot within the larger of the two's `clear` of (x, z) (besiegers up to 16 u
 * away: one may still walk to its spot).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} x @param {number} z
 */
function spotFree(e, ctx, x, z) {
  const clear = /** @type {SiegeState} */ (e.ai.siege).clear;
  const others = ctx.enemiesNear(x, z, 16, _near);
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const os = o !== e && o.ai ? /** @type {SiegeState|undefined} */ (o.ai.siege) : undefined;
    if (os && os.planned && Math.hypot(os.sx - x, os.sz - z) < Math.max(clear, os.clear)) return false;
  }
  return true;
}

/**
 * One idle sub-step of besieging: walk to the spot (planned on the first call), then stand facing
 * the house and run the swing cycle of `period` s, staggered by the brute's index so a pack strikes
 * in turn. Without a house it wanders. Never aggroes, never hits anyone.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 * @param {number} period seconds of one cycle
 * @param {number} reach the distance kept from the wall (−1: stay on the ring)
 * @param {number} [ring] u beyond the house's ring radius where its spot is sought (a caster
 *   keeps back)
 * @param {number} [room] the least room it keeps round its spot (`spotClear`)
 * @returns {number} seconds into the cycle (≥ 0) once at the spot; −1 while walking there or
 *   wandering. A new cycle resets `siege.hit` and counts `siege.n`.
 */
export function besiegeStep(e, h, ctx, period, reach, ring = 0, room = 0) {
  const B = e.besiege;
  if (!B) {
    e.wander(h, ctx);
    return -1;
  }
  const s = /** @type {SiegeState} */ (e.ai.siege);
  if (!s.planned) {
    s.clear = spotClear(e, room);
    planSpot(e, ctx, s, reach, ring);
    // the first swing waits for the brute's turn
    s.t = period * (((e.index * 0.37) % 1) - 1);
  }
  const p = e.position;
  // pushed off the spot (a passer-by, a knock): walk back to it, the cycle clock running on
  if (s.there && Math.hypot(s.sx - p.x, s.sz - p.z) > SIEGE_PUSHED) {
    s.there = false;
    s.walk = 0;
  }
  if (!s.there) {
    const d = Math.hypot(s.sx - p.x, s.sz - p.z);
    s.walk += h;
    if (d > SIEGE_ARRIVE && !e.stuck && s.walk < SIEGE_WALK_MAX) {
      e.seek(s.sx, s.sz, e.def.speed * SIEGE_WALK, h, ctx, 'walk');
      return -1;
    }
    if (d > SIEGE_ARRIVE) {
      // could not get there: besiege from here
      s.sx = p.x;
      s.sz = p.z;
      wallFrom(e, ctx, s, -1);
    }
    s.there = true;
    e.resetSeek();
  }
  e.face(B.x, B.z);
  const t0 = s.t;
  s.t += h;
  if (s.t >= period) {
    s.t -= period;
    s.n++;
    s.hit = false;
    s.fireAt = -1;
  }
  return t0 < 0 ? -1 : s.t;
}

/**
 * Leave the spot (a fight, a return): the next idle walks back to it.
 * @param {Enemy} e
 */
export function leaveSpot(e) {
  const s = /** @type {SiegeState|undefined} */ (e.ai?.siege);
  if (!s) return;
  s.there = false;
  s.walk = 0;
  s.hit = false;
  s.fireAt = -1;
}

// ---- the drakeborn ----

const SPEED = 2.5;
const SIEGE_PERIOD = 2.6;
const SIEGE_REACH = 1.25;
const SIEGE_WIND = 0.55;
const SIEGE_STRIKE = 0.22;
const SIEGE_FOLLOW = 0.4;

const ROAR_F = 24;
const CLEAVE = Object.freeze({ range: 3.0, windup: 30, follow: 20, lock: 8, r: 2.6, half: 70, active: 6, lunge: 0.6, lunge2: 0.4,
  mv: 1.3, kb: 2.0, mv2: 1.1, kb2: 2.4, chance2: 0.35, recover: 36, cooldown: 54, stepIn: 1.8 });
const SLAM = Object.freeze({ range: 3.6, chance: 0.3, windup: 42, lock: 12, ahead: 1.1, r: 3.0, active: 4, mv: 1.6, kb: 2.8,
  ring: Object.freeze({ r0: 1.2, rMax: 5.4, speed: 10, width: 0.9, mv: 0.5, kb: 1.6 }), recover: 50, cooldown: 6 });
const GORE = Object.freeze({ min: 4, max: 9, chance: 0.55, windup: 44, lock: 12, width: 1.6, run: 10, speed: 9.5, r: 1.0,
  mv: 1.5, kb: 3.2, reel: 70, skid: 20, recover: 40, cooldown: 7, overshoot: 0.8 });

/** @typedef {Required<ReturnType<typeof drakeborn.init>>} DrakebornAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const drakeborn = {
  init(e) {
    return {
      siege: siegeState(),
      move: /** @type {'cleave'|'slam'|'gore'} */ ('cleave'),
      /** Test hook: the next move ('cleave' | 'slam' | 'gore'; null: the brain's choice). */
      force: /** @type {null|'cleave'|'slam'|'gore'} */ (null),
      cd: F(e.rng.int(20, 50)),
      slamCd: e.rng.range(1.5, 3.5),
      goreCd: e.rng.range(2, 4),
      roar: false,
      roarT: 0,
      second: false,
      tag: 0,
      lx: 0, lz: 1,
      cx: 0, cz: 0,
      len: 0, end: 'max',
      run: 0, done: 0,
      skid: false, reel: false,
      dust: 0,
      los: false, losT: 0,
      side: e.rng.chance(0.5) ? 1 : -1,
    };
  },

  /** Besieging (see the header). @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {DrakebornAI} */ (e.ai);
    ai.roar = true;
    const t = besiegeStep(e, h, ctx, SIEGE_PERIOD, SIEGE_REACH);
    if (t < 0) {
      if (ai.siege.there) e.anim('idle');
      return;
    }
    const s = ai.siege;
    const heavy = s.n % 3 === 2;
    if (t < SIEGE_WIND) e.pose(heavy ? 'slamWind' : 'windup');
    else if (t < SIEGE_WIND + SIEGE_STRIKE) {
      e.pose(heavy ? 'slam' : 'attack');
      if (!s.hit) {
        s.hit = true;
        const y = s.wy + (heavy ? 0.7 : 1.2);
        ctx.burst('bruteSparks', s.wx, y, s.wz, heavy ? 10 : 7);
        ctx.burst('bruteSplinters', s.wx, y, s.wz, heavy ? 9 : 6);
        ctx.fx('impact', s.wx, y - 1.0, s.wz, WALL_FX);
        ctx.burst('bruteDust', s.wx, s.wy + 0.4, s.wz, heavy ? 8 : 3);
        ctx.sfx(heavy ? 'crash' : 'wallHit', s.wx, s.wz, { volume: heavy ? 0.7 : 0.8 });
      }
    } else if (t < SIEGE_WIND + SIEGE_STRIKE + SIEGE_FOLLOW) e.pose(heavy ? 'slam' : 'follow');
    else e.anim('idle');
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {DrakebornAI} */ (e.ai);
    const tp = e.tp;
    const P = ctx.player.position;
    const p = e.position;
    leaveSpot(e);
    if (ai.cd > 0) ai.cd -= h;
    if (ai.slamCd > 0) ai.slamCd -= h;
    if (ai.goreCd > 0) ai.goreCd -= h;
    ai.losT -= h;
    if (ai.losT <= 0) {
      ai.los = ctx.los(p.x, p.z, P.x, P.z);
      ai.losT = F(6);
    }
    // the roar that turns it on the party
    if (ai.roar) {
      if (ai.roarT === 0) ctx.sfx('growl', p.x, p.z, { pitch: 0.85 });
      ai.roarT += h;
      e.face(P.x, P.z);
      e.pose('roar');
      if (ai.roarT >= F(ROAR_F) - EPS) {
        ai.roar = false;
        ai.roarT = 0;
      }
      return;
    }
    const reach = e.canMelee(ctx);
    const onScreen = e.canWindup(ctx);
    const f = ai.force;
    const want = (move) => (f ? f === move : true);
    if (reach && onScreen) {
      // the slam (sometimes, close), the cleave (close), the gore (mid range, in sight)
      if (want('slam') && tp.d <= SLAM.range && (f === 'slam' || (ai.cd <= 0 && ai.slamCd <= 0 && e.rng.chance(SLAM.chance))) && e.takeToken(ctx)) {
        start(e, 'slam');
        return;
      }
      if (want('cleave') && tp.d <= CLEAVE.range && (f === 'cleave' || ai.cd <= 0) && e.takeToken(ctx)) {
        start(e, 'cleave');
        return;
      }
      if (want('gore') && tp.d >= GORE.min && tp.d <= GORE.max && ai.los
        && (f === 'gore' || (ai.cd <= 0 && ai.goreCd <= 0 && e.rng.chance(GORE.chance))) && e.takeToken(ctx)) {
        start(e, 'gore');
        return;
      }
      if (!f && ai.goreCd <= 0 && tp.d >= GORE.min) ai.goreCd = 1.2; // (the coin said no: ask again in a while)
    }
    // close and waiting (cooldown, token): hold the ground, edging sideways, facing the target
    if (reach && tp.d <= CLEAVE.range - 0.2) {
      const fr = e.walk(-tp.dz * ai.side, tp.dx * ai.side, SPEED * 0.35, h, ctx, 'walk', false);
      e.face(P.x, P.z);
      if (fr < 0.25) ai.side = -ai.side;
      return;
    }
    e.chase(SPEED, h, ctx, 'walk');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {DrakebornAI} */ (e.ai);
    if (ai.move === 'slam') slam(e, h, ctx);
    else if (ai.move === 'gore') gore(e, h, ctx);
    else cleave(e, h, ctx);
  },

  /** @type {Brain['stun']} */
  stun(e, h, ctx) {
    // reeling after a charge into a wall
    e.pose('hurt');
    if (e.after(GORE.reel)) {
      e.vuln = 1;
      e.dropToken(ctx);
      /** @type {DrakebornAI} */ (e.ai).cd = F(30);
      e.setState('engage');
    }
  },

  /** @type {Brain['cancel']} */
  cancel(e) {
    const ai = /** @type {DrakebornAI} */ (e.ai);
    ai.second = false;
    ai.skid = false;
    ai.roar = false;
    ai.roarT = 0;
    e.armored = false;
    e.vuln = 1;
    leaveSpot(e);
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const p = e.position;
    ctx.sfx('growl', p.x, p.z, { pitch: 0.7, volume: 0.8 });
    ctx.sfx('crash', p.x, p.z, { volume: 0.6, pitch: 0.75 });
    ctx.burst('bruteDust', p.x, p.y + 0.3, p.z, 12);
    ctx.burst('bruteRubble', p.x, p.y + 0.2, p.z, 6);
    ctx.fx('dust', p.x, p.y, p.z, DEATH_DUST);
  },

  /** The death throes: the body lies still, an ember gasp, then its own fade. @type {Brain['dead']} */
  dead(e, h, ctx) {
    const p = e.position;
    if (e.t - h < F(DEATH.gasp) - EPS && e.t >= F(DEATH.gasp) - EPS) ctx.burst('bruteEmbers', p.x, p.y + 0.6, p.z, 8);
    const k = (e.t - F(DEATH.still)) / F(DEATH.fade);
    if (k > 0) e.sprite.opacity = Math.min(e.sprite.opacity, Math.max(0, 1 - k));
    return true;
  },

  /** Ember eyes; brighter in a wind-up. @type {Brain['glow']} */
  glow(e, out) {
    out[0] = 1.0;
    out[1] = 0.45;
    out[2] = 0.15;
    out[3] = e.state === 'windup' ? 2.6 : 1.6;
  },
};

/** The death throes' frames: the ember gasp, the still body, the fade. */
const DEATH = Object.freeze({ gasp: 14, still: 30, fade: 40 });
/** The dust of the body crashing down. @type {FxOptions} */
const DEATH_DUST = { scale: 1.8 };

/**
 * Begin a move: its wind-up.
 * @param {Enemy} e
 * @param {'cleave'|'slam'|'gore'} move
 */
function start(e, move) {
  const ai = /** @type {DrakebornAI} */ (e.ai);
  ai.move = move;
  ai.second = false;
  ai.len = 0;
  ai.force = null;
  e.setState('windup');
}

/**
 * The end of a move: the token back, the cooldowns.
 * @param {Enemy} e
 * @param {CombatContext} ctx
 * @param {number} cd seconds before the next move
 */
function endMove(e, ctx, cd) {
  const ai = /** @type {DrakebornAI} */ (e.ai);
  e.dropToken(ctx);
  ai.cd = cd;
  e.setState('engage');
}

/**
 * The cleave (and its backhand follow-up).
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function cleave(e, h, ctx) {
  const ai = /** @type {DrakebornAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  const tp = e.tp;
  if (e.state === 'windup') {
    const dur = ai.second ? CLEAVE.follow : CLEAVE.windup;
    if (e.entered) ctx.sfx(ai.second ? 'windup' : 'growl', p.x, p.z, ai.second ? undefined : { volume: 0.7 });
    e.pose(ai.second ? 'follow' : 'windup');
    if (e.t < F(dur - CLEAVE.lock) - EPS) {
      e.face(P.x, P.z);
      if (!ai.second && tp.d > CLEAVE.stepIn) e.walk(tp.dx, tp.dz, SPEED, h, ctx, null, false);
    }
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = CLEAVE.r;
    m.halfAngle = CLEAVE.half;
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
      ctx.sfx('swingHeavy', p.x, p.z);
      CLEAVE_FX.dirX = ai.lx;
      CLEAVE_FX.dirZ = ai.lz;
      CLEAVE_FX.flip = ai.second;
      ctx.fx('bruteCleave', p.x + ai.lx * CLEAVE_FX_AHEAD, p.y, p.z + ai.lz * CLEAVE_FX_AHEAD, CLEAVE_FX);
    }
    if (e.after(CLEAVE.active)) {
      e.unmark(0, ctx);
      if (!ai.second && e.rng.chance(CLEAVE.chance2)) {
        ai.second = true;
        e.setState('windup');
      } else e.setState('recover');
      return;
    }
    e.pose(ai.second ? 'cleave2' : 'attack');
    const v = (ai.second ? CLEAVE.lunge2 : CLEAVE.lunge) / F(CLEAVE.active);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = CLEAVE.r;
    s.halfAngle = CLEAVE.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = ai.second ? CLEAVE.mv2 : CLEAVE.mv;
    s.kb = ai.second ? CLEAVE.kb2 : CLEAVE.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  // recover: the follow-through, then on guard
  if (e.fr < 16) e.pose(ai.second ? 'cleave2' : 'follow');
  else {
    e.face(P.x, P.z);
    e.anim('idle');
  }
  if (e.after(CLEAVE.recover)) {
    ai.second = false;
    endMove(e, ctx, F(CLEAVE.cooldown));
  }
}

/** The slam's dust cloud and flash (named effects). @type {FxOptions} */
const SLAM_DUST = { scale: 1.8 };
/** @type {FxOptions} */
const SLAM_FLASH = { scale: 1.4 };
/** The gore's dust at a wall. @type {FxOptions} */
const CRASH_DUST = { scale: 1.5 };

/**
 * The ground slam: the overhead wind-up, the impact, the shockwave ring.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function slam(e, h, ctx) {
  const ai = /** @type {DrakebornAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx('growl', p.x, p.z, { pitch: 0.9 });
    e.pose('slamWind');
    if (e.t < F(SLAM.windup - SLAM.lock) - EPS) e.face(P.x, P.z);
    ai.cx = p.x + e.facing.x * SLAM.ahead;
    ai.cz = p.z + e.facing.z * SLAM.ahead;
    const m = e.markerSpec('circle', ai.cx, ai.cz);
    m.r = SLAM.r;
    m.progress = Math.min(1, e.t / F(SLAM.windup));
    e.mark(0, ctx, m);
    if (e.after(SLAM.windup)) {
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('slam');
    if (e.entered) {
      const gy = ctx.groundAt(ai.cx, ai.cz);
      ctx.shake(0.35, 0.4);
      ctx.sfx('quake', ai.cx, ai.cz);
      QUAKE_FX.dirX = e.facing.x;
      QUAKE_FX.dirZ = e.facing.z;
      ctx.fx('bruteQuake', ai.cx, gy, ai.cz, QUAKE_FX);
      ctx.fx('dust', ai.cx, gy, ai.cz, SLAM_DUST);
      ctx.fx('impact', ai.cx, gy - 0.5, ai.cz, SLAM_FLASH);
      ctx.burst('bruteDust', ai.cx, gy + 0.3, ai.cz, 14);
      ctx.burst('bruteRubble', ai.cx, gy + 0.2, ai.cz, 14);
      ctx.burst('bruteSparks', ai.cx, gy + 0.4, ai.cz, 8);
    }
    if (e.after(SLAM.active)) {
      e.unmark(0, ctx);
      const R = SLAM.ring;
      const hz = e.hazardRing(ai.cx, ai.cz, R.r0, R.rMax, R.speed, R.width);
      hz.mv = R.mv;
      hz.kb = R.kb;
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = ai.cx;
    s.z = ai.cz;
    s.y = ctx.groundAt(ai.cx, ai.cz);
    s.r = SLAM.r;
    s.mv = SLAM.mv;
    s.kb = SLAM.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  if (e.fr < 30) e.pose('slam');
  else {
    e.face(P.x, P.z);
    e.anim('idle');
  }
  if (e.after(SLAM.recover)) {
    ai.slamCd = SLAM.cooldown;
    endMove(e, ctx, F(CLEAVE.cooldown));
  }
}

/**
 * The charging gore: the pawing wind-up with the lane, the armoured run, the crash or the skid.
 * @param {Enemy} e
 * @param {number} h
 * @param {CombatContext} ctx
 */
function gore(e, h, ctx) {
  const ai = /** @type {DrakebornAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) {
      ctx.sfx('growl', p.x, p.z, { pitch: 0.75 });
      ai.dust = 0;
    }
    if (e.fr >= ai.dust * 12) {
      ctx.burst('footstep', p.x, p.y + 0.05, p.z, 5);
      ai.dust++;
    }
    e.pose('goreWind');
    if (e.t < F(GORE.windup - GORE.lock) - EPS) {
      e.face(P.x, P.z);
      if (e.fr % 2 === 0 || ai.len === 0) {
        ai.len = e.freeRun(e.facing.x, e.facing.z, GORE.run, ctx);
        ai.end = e.runEnd;
      }
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.len = Math.max(0.5, ai.len);
    m.width = GORE.width;
    m.progress = Math.min(1, e.t / F(GORE.windup));
    m.flash = e.lockFlash(e.t - F(GORE.windup - GORE.lock));
    e.mark(0, ctx, m);
    if (e.after(GORE.windup)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.run = ai.len + (ai.end === 'obstacle' ? GORE.overshoot : 0);
      ai.done = 0;
      ai.tag = e.newTag();
      ai.skid = false;
      ai.dust = 0;
      e.armored = true;
      e.markProgress(0, ctx, 1);
      ctx.sfx('boarCharge', p.x, p.z, { pitch: 0.8 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.armored = true;
    e.pose((e.fr >> 2) & 1 ? 'gore1' : 'gore0');
    if (e.fr >= ai.dust * 6) {
      ctx.burst('footstep', p.x, p.y + 0.05, p.z, 4);
      ai.dust++;
    }
    const step = Math.min(GORE.speed * h, ai.run - ai.done);
    let blocked = false;
    if (step > 1e-5) {
      const x0 = p.x;
      const z0 = p.z;
      const fr = e.move(ai.lx * step, ai.lz * step, ctx);
      ai.done += Math.max(0, (p.x - x0) * ai.lx + (p.z - z0) * ai.lz);
      blocked = fr < 0.4;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx * 0.7;
    s.z = p.z + ai.lz * 0.7;
    s.r = GORE.r;
    s.mv = GORE.mv;
    s.kb = GORE.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    s.fromX = p.x;
    s.fromZ = p.z;
    ctx.hitbox(e, s);
    if (blocked && (e.blockedBy === 'terrain' || e.blockedBy === 'collider')) {
      // into a wall: it reels
      e.unmark(0, ctx);
      e.armored = false;
      e.vuln = 1.3;
      ctx.shake(0.25, 0.35);
      ctx.sfx('crash', p.x, p.z);
      ctx.fx('dust', p.x + ai.lx * 0.8, p.y, p.z + ai.lz * 0.8, CRASH_DUST);
      CRASH_FX.dirX = ai.lx;
      CRASH_FX.dirZ = ai.lz;
      ctx.fx('bruteQuake', p.x + ai.lx * 0.9, ctx.groundAt(p.x, p.z), p.z + ai.lz * 0.9, CRASH_FX);
      ctx.burst('bruteRubble', p.x + ai.lx * 0.8, p.y + 0.6, p.z + ai.lz * 0.8, 8);
      ctx.fx('stun', p.x, p.y + 1.4, p.z, { duration: GORE.reel / 60, follow: e.position });
      e.pose('hurt');
      e.setState('stun');
      return;
    }
    if (blocked || ai.done >= ai.run - 1e-3 || step <= 1e-5) {
      e.unmark(0, ctx);
      e.armored = false;
      ai.skid = true;
      e.setState('recover');
    }
    return;
  }
  // recover: the skid, then a breather
  if (ai.skid) {
    const u = Math.min(1, e.t / F(GORE.skid));
    const v = 5 * (1 - u) * (1 - u);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    e.pose('gore1');
    if (e.entered) ctx.burst('bruteDust', p.x, p.y + 0.2, p.z, 5);
    if (e.after(GORE.skid)) {
      ai.skid = false;
      e.setState('recover');
    }
    return;
  }
  if (e.entered) e.anim('idle');
  e.face(P.x, P.z);
  if (e.after(GORE.recover)) {
    ai.goreCd = GORE.cooldown;
    endMove(e, ctx, F(CLEAVE.cooldown));
  }
}
