/**
 * Old Gullet, the Thing under the Bay (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md
 * §5.4, §6.7): the boss under Saltcombe's sea ice — a head that hides below it and its arms (the
 * `tentacle` adds, ./tentacle.js) that break through. Owner: the gullet package. Its art:
 * src/engine/pixel/monsters/gullet.js (the head) and tentacle.js, the FX frames
 * src/engine/pixel/fx/evGulletFx.js, the presets src/engine/fx/presets/evGullet.js, the ice it breaks
 * ./gulletIce.js; its stats ./defsGullet.js. Registered by ./index.js (`register` below registers
 * the arms too).
 *
 * Like the golem's and the dragon's, this brain drives every state of the head (`update`); core owns
 * the arena, the bar, the hit-stop, the music and the HP clamps (`e.hpFloor`: the next threshold).
 *
 * **Under and up.** The head spends the fight under the ice — hidden, guarded, out of every hit and
 * of the lock-on, its dark shape moving below the ice toward what it does next (the stage's shadow) —
 * and comes up only to look at who hurts it: after three slams of its arms, or three arms cut (or a
 * mix; `PAIN` — two in phase 3), it rises through a hole that glints gold first (50 f) and stays
 * up 6 s (5 s in phase 3): the punish window. Its poise (per phase) broken up there: Broken, 150 f more, vulnerable 1.3.
 *
 * **Moves** while it is under (seeded picks, cooldowns, never the same three times running; every
 * wind-up ≥ 18 f with its telegraph; phase 3 wind-ups × 0.8):
 * - Crack Slam (all phases): an arm rises 6.5–7.5 u from its prey (phase 2–3: in a lasting hole
 *   4–9 u off, when one is free), rears 54 f; the lane (2 × 8.5 u) tracks, locks 18 f before the
 *   strike — the crack races along it — and the arm is flung down along it (mv 0.7, knockdown), the
 *   ice erupting down the lane; it lies there 90 f to be cut (a player it knocked down gets up
 *   for the last half second of it), then sinks.
 * - Ice Burst (all phases): three circles (phase 3: four) r 1.5 under the party — the first where its
 *   prey will be in 0.45 s — fill 48 f and erupt (mv 0.75); each leaves a hole for 8 s.
 * - Tentacle Sweep (phase 2–3): an arm in a lasting hole within 6.5 u swings back 48 f and sweeps
 *   ± 120° r 4.6 round its hole (mv 0.7, kb 2.2: a shove, under the knockdown's 2.5).
 * - Shard Barrage (phase 3): six circles r 1.3, 8 f apart, each filling 60 f while a shard of ice
 *   arcs out of the nearest hole onto it (mv 0.8).
 * - Frost-Ink (phase 2–3, up): 40 f into a window, the siphon swells 42 f under a cone r 7 ± 35° and
 *   sprays it 36 f (three hits of mv 0.45).
 *
 * **The holes.** Open water: an ice burst's (8 s), the surfacing's (closed when the head is under
 * again), an arm's (closed when it sank), the four lasting holes of phase 2 (to the end). Standing in
 * one hurts every 0.5 s (4 flat) and knocks out of it — the party (the push skipped only while the
 * player rolls through that hole: no free perfect dodge) and any other foe (pushed out and chilled:
 * the brains have no way to hurt a foe). Only while the fight runs; their look is the ice stage's.
 *
 * **Phases** (`def.phases` [0.65, 0.30]): 2 — up, guarded, it roars; cracks run from it to four
 * spots and the lasting holes burst open (a push out of each), two arms rise in them; 3 — a roar,
 * the lasting holes heave. **Release** (HP 0): no death — its eye clears, the rime lifts off it in
 * motes, and it sinks back into the deep, freed; its arms slide back under; the holes stay open until
 * the thaw breaks the bay (`thawField`, the ice stage).
 *
 * **The companions** read its hints (`ALLY_HINTS` in its brain state, `ai.allyHints`: the party's
 * MemberCombat asks the boss of its fight — EVM-06): every spot they choose keeps out of the holes
 * that hurt, they roll out of its warm and crack telegraphs, and while its hole glints they wait at
 * the window; so they deal a quarter to a third of its damage (its HP, ./defsGullet.js, is tuned
 * with them).
 *
 * Under the ice it is the core's submerged foe (`ctx.submerge` / `ctx.surface`, COMBAT.md §30.5);
 * its telegraphs its own warm style on the ice (`gulletWarm`, ./gulletIce.js; the slams' lane the
 * pack's `crack`); its 0 HP the core's release (`def.release`, §30.7: `dead` holds the body while
 * it sinks). Its randomness is `e.rng` only.
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { CombatContext, Brain, BossMove, RectXZ, ProjectileLook } from '../../types.js'
 * @import { BossArena } from '../../BossArena.js'
 * @import { EnemyPackRegistrar } from '../index.js'
 */
import { gullet as paintGullet } from '../../../../engine/pixel/monsters/gullet.js';
import { tentacle as paintTentacle } from '../../../../engine/pixel/monsters/tentacle.js';
import * as gulletFx from '../../../../engine/pixel/fx/evGulletFx.js';
import { PRESETS } from '../../../../engine/fx/presets/evGullet.js';
import { iceOf, makeIceSystem, WARM_STYLE, WARM_ID, WARM_GLSL } from './gulletIce.js';
import { tentacleBrain, orderArm, armFree, breakThrough, ARM_DEEP } from './tentacle.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** How deep the head waits under the ice (its 6 u frame below the waterline). */
const DEEP = -5.8;
/** Frames: rising through the ice, sinking back. */
const RISE_F = 22;
const SINK_F = 20;
/** The intro's beats (frames). */
const INTRO = Object.freeze({ crack: 0, crack2: 22, burst: 44, roar: 70, look: 112, sink: 136, end: 156 });
/** The surfacing: the gold glint before it (frames, by phase), the punish window (frames, by phase). */
const SURFACE = Object.freeze({ glint: [54, 50, 42], up: [360, 360, 300], broken: 150 });
/** Slams and cut arms before it surfaces, by phase (phase 3: two — its windows are 5 s); seconds under before it surfaces anyway. */
const PAIN = Object.freeze([3, 3, 2]);
const LONELY_S = 14;
/** Frames between two moves while under, by phase. */
const GAP_F = [[46, 76], [40, 64], [28, 48]];
const SLAM = Object.freeze({ windup: 54, lie: 90, len: 8.5, reach: [6.5, 7.5], wait: 4 });
const BURST = Object.freeze({ windup: 48, n: [3, 3, 4], r: 1.5, spread: 3.4, apart: 1.9, lead: 0.45, mv: 0.75, kb: 1.6, hole: 8 });
const SWEEP = Object.freeze({ windup: 48, lie: 34, near: 6.5, wait: 3.5 });
const BARRAGE = Object.freeze({ n: 6, r: 1.3, spread: 4.5, apart: 1.6, every: 8, fill: 60, mv: 0.8, kb: 1.2, apex: 4.2 });
const INK = Object.freeze({ at: 40, windup: 42, track: 24, active: 36, every: 12, r: 7, half: 35, mv: 0.45, kb: 0.5, reach: 10 });
/** Move cooldowns (s), started when a move begins. */
const COOLDOWN = Object.freeze({ slam: 0, burst: 5, sweep: 4.5, barrage: 9, surface: 0 });
/** The holes: their hazard radius (water radius less the target's), the tick, its damage and push. */
const HOLE = Object.freeze({ big: 0.85, small: 0.45, tick: 0.5, flat: 4, kb: 2.4, foePush: 0.9, foeChill: 1.5 });
/** The lasting holes of phase 2: at these fractions of the arena's half sizes from its centre. */
const LASTING = Object.freeze([[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]);
/** The pool of arms (core's `ADD_LEVEL`). */
const ARM_LEVEL = 5;
/** The eye's frost glow and the freed eye's warmth. */
const GLOW = [0.55, 0.95, 1.15];
const WARM = [1.0, 0.85, 0.45];

/**
 * A shard of the barrage in flight (`ProjectileSpec.look`): the ice shard tumbling, its landing a
 * burst of ice and the ice's crack.
 * @type {ProjectileLook}
 */
const SHARD = Object.freeze({
  frame: 'gulletShard', mode: 'billboard', color: [...gulletFx.TINTS.gulletShard], scale: 1.2, spin: 9, fps: 8,
  hitBurst: 'gulletIce', hitCount: 10, hitSfx: 'iceBreak', hitVolume: 0.75, hitPitch: 1.15,
});

/**
 * The head's moves (`ai.move`; `boss.force(move)`).
 * @typedef {'slam'|'burst'|'sweep'|'barrage'|'surface'} GulletMove
 */

/**
 * A hole the brain keeps (its hazard; the stage draws it).
 * @typedef {{ id: number, x: number, z: number, r: number, until: number, lasting: boolean, arm: Enemy|null }} Hole
 */

/**
 * The brain state (`e.ai`), made at construction and every reset — back under the ice, the ice
 * whole again.
 * @param {Enemy} e
 */
function initAI(e) {
  hideHead(e);
  const ice = iceStage(e);
  ice?.clear();
  return {
    clock: 0,
    /** @type {GulletMove|null} */
    move: null,
    /** @type {GulletMove|null} */
    forced: null,
    /** @type {GulletMove|null} */
    last1: null,
    /** @type {GulletMove|null} */
    last2: null,
    gap: F(60),
    cd: { slam: 0, burst: 0, sweep: 0, barrage: 0, surface: 0 },
    pain: 0,
    underT: 0,
    /** The head is up (visible, hittable). */
    up: false,
    /** @type {Enemy[]} its arms (adds it was given) */
    arms: [],
    /** @type {Enemy|null} the arm of the move in progress */
    arm: null,
    /** @type {Hole[]} */
    holes: [],
    /** @type {Hole[]} the lasting holes (phase 2) */
    lasting: [],
    /** The surfacing: its spot, its hole (a lasting one is not closed after). */
    sx: e.home.x,
    sz: e.home.z,
    /** @type {Hole|null} */
    spotHole: null,
    upT: 0,
    /** The frost-ink: 'none' | 'wind' | 'spray' | 'done'. */
    ink: 'none',
    inkT: 0,
    ix: 0,
    iz: 1,
    inkTag: 0,
    /** Ice bursts filling: [x, z, marker, t, dur, tag]. @type {number[][]} */
    bursts: [],
    /** The barrage's circles: [x, z, marker, t, delay, fill, launched]. @type {number[][]} */
    barrage: [],
    /** The hole hazard's clock. */
    tick: 0,
    /** Where its shadow goes under the ice, and its strength. */
    shx: e.home.x,
    shz: e.home.z,
    sha: 0,
    trans: 0,
    phaseT: 0,
    rimeT: 0,
    dieT: 0,
    roared: false,
    awoke: false,
    /** One-shot cues of the current state (`once`): a bit each, cleared on every state entry. */
    cues: 0,
    cueAt: -1,
    /** @type {RectXZ|null} */
    inset: null,
    /** @type {Enemy[]} */
    near: [],
    /** What the companions read in its fight (`ALLY_HINTS`). */
    allyHints: ALLY_HINTS,
  };
}

/** @typedef {ReturnType<typeof initAI>} GulletAI */

/** How far (u) beyond a hole's reach a companion keeps. */
const ALLY_MARGIN = 0.35;

/**
 * What the party's companions read in this fight (src/game/party/MemberCombat.js, through the boss
 * of the fight's `ai.allyHints` — EVM-06; no other boss has any, so no other fight changes): the
 * holes that hurt to keep out of when they choose where to stand, the telegraph styles to roll out
 * of (the warm one on the ice, the slam's crack), and where the head is about to come up while its
 * hole glints, so they are at the window when it opens.
 */
const ALLY_HINTS = Object.freeze({
  evade: Object.freeze(['gulletWarm', 'crack']),
  /**
   * Is (x, z) within `r` (+ a margin) of a hole that hurts (not one an arm stands in, nor the
   * head's own while it is up)?
   * @param {Enemy} e @param {number} x @param {number} z @param {number} r
   */
  unsafe(e, x, z, r) {
    const ai = /** @type {GulletAI} */ (e.ai);
    for (const o of ai.holes) {
      if (o.arm || (o === ai.spotHole && ai.up)) continue;
      const m = o.r + r + ALLY_MARGIN;
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < m * m) return true;
    }
    return false;
  },
  /**
   * Where the head comes up next — its glinting hole, while it glints — else null.
   * @param {Enemy} e
   * @returns {{ x: number, z: number, r: number }|null}
   */
  focus(e) {
    const ai = /** @type {GulletAI} */ (e.ai);
    if (ai.up || ai.move !== 'surface' || e.state !== 'windup' || !ai.spotHole) return null;
    return { x: ai.sx, z: ai.sz, r: e.radius };
  },
});

/**
 * The combat system behind the head (its arena's), or null (an arena-less mock).
 * @param {Enemy} e
 */
function sysOf(e) {
  const a = /** @type {BossArena|null} */ (e.arena);
  return a && a.sys ? a.sys : null;
}

/** The ice stage of the head's combat, or null. @param {Enemy} e */
function iceStage(e) {
  const sys = sysOf(e);
  return sys && sys.quads ? iceOf(sys) : null;
}

/**
 * Hidden under the ice at construction and every reset (core's submerged state needs a context:
 * the first time it goes under is the intro's end).
 * @param {Enemy} e
 */
function hideHead(e) {
  e.sprite.visible = false;
  e.guarded = true;
  e.lift = DEEP;
  e.sprite.mesh.position.y = DEEP;
  e.sprite.shadowProxy.position.y = DEEP;
}

/**
 * Under the ice (core's submerged state: guarded, out of the hit loops and the lock-on, its sprite
 * fading out — it is already below the ice by then) or up through it where it stands (drawn,
 * hittable, fading in while it rises).
 * @param {Enemy} e @param {CombatContext} ctx @param {boolean} under
 */
function setUnder(e, ctx, under) {
  const ai = /** @type {GulletAI} */ (e.ai);
  ai.up = !under;
  if (under) {
    ctx.submerge?.(e);
    e.guarded = true;
    return;
  }
  // (never submerged yet — hidden at construction: drawn at once)
  const was = e.submerged;
  ctx.surface?.(e, e.position.x, e.position.z);
  if (!was) {
    e.sprite.visible = true;
    e.sprite.opacity = 1;
    e.guarded = false;
  }
}

/**
 * Put the head at (x, z) on the ice (under it: it moves with its shadow; up: at its hole).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} x @param {number} z
 */
function place(e, ctx, x, z) {
  e.position.set(x, ctx.groundAt(x, z), z);
}

/**
 * The arena's rect (an arena-less head: ± 8 × 6 round its home), inset by `m` (a reused object).
 * @param {Enemy} e @param {number} m
 * @returns {RectXZ}
 */
function rect(e, m) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const r = ai.inset ?? (ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  const a = e.arena?.rect ?? { minX: e.home.x - 8, maxX: e.home.x + 8, minZ: e.home.z - 6, maxZ: e.home.z + 6 };
  r.minX = a.minX + m;
  r.maxX = Math.max(r.minX, a.maxX - m);
  r.minZ = a.minZ + m;
  r.maxZ = Math.max(r.minZ, a.maxZ - m);
  return r;
}

/** @param {RectXZ} r @param {number} x @returns {number} */
const cx = (r, x) => Math.min(r.maxX, Math.max(r.minX, x));
/** @param {RectXZ} r @param {number} z @returns {number} */
const cz = (r, z) => Math.min(r.maxZ, Math.max(r.minZ, z));

/** The arena's centre. @param {Enemy} e */
function centre(e) {
  const r = rect(e, 0);
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
}

/**
 * Wind-up frames in the current phase (phase 3 × 0.8 rounded up, never below 18 f).
 * @param {Enemy} e @param {number} n
 */
function W(e, n) {
  return e.phase === 3 ? Math.max(18, Math.ceil(n * 0.8)) : n;
}

/**
 * Is (x, z) clear of every open hole by `m` u (and of the head's own spot while it is up)?
 * @param {GulletAI} ai @param {number} x @param {number} z @param {number} m
 */
function clearOfHoles(ai, x, z, m) {
  for (const o of ai.holes) if (Math.hypot(o.x - x, o.z - z) < m + (o.r > HOLE.small ? 1.3 : 0.9)) return false;
  return true;
}

/**
 * Open a hole (its hazard here, its look on the stage).
 * @param {Enemy} e @param {number} x @param {number} z @param {boolean} big @param {number} until
 *   enemy time it closes at (Infinity: when told)
 * @param {boolean} [lasting]
 * @returns {Hole}
 */
function openHole(e, x, z, big, until, lasting = false) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const id = iceStage(e)?.open(x, z, big) ?? 0;
  /** @type {Hole} */
  const o = { id, x, z, r: big ? HOLE.big : HOLE.small, until, lasting, arm: null };
  ai.holes.push(o);
  return o;
}

/**
 * Close a hole now (it refreezes; the stage dithers it out).
 * @param {Enemy} e @param {Hole} o
 */
function closeHole(e, o) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const i = ai.holes.indexOf(o);
  if (i >= 0) ai.holes.splice(i, 1);
  if (o.id) iceStage(e)?.close(o.id);
}

/**
 * An arm under the ice, free for an order — one of its own, else a fresh one from the pool.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} x @param {number} z
 * @returns {Enemy|null}
 */
function freeArm(e, ctx, x, z) {
  const ai = /** @type {GulletAI} */ (e.ai);
  for (const a of ai.arms) if (armFree(a)) return a;
  const a = ctx.spawnAdd('tentacle', x, z, ARM_LEVEL);
  if (!a) return null;
  if (!ai.arms.includes(a)) ai.arms.push(a);
  return a;
}

/** Arms up through the ice now. @param {GulletAI} ai */
function armsUp(ai) {
  let n = 0;
  for (const a of ai.arms) if (a.alive && !/** @type {any} */ (a.ai).under) n++;
  return n;
}

/**
 * The ice breaking open where the head comes through: a big burst, spray, mist, a ring of foam.
 * @param {CombatContext} ctx @param {number} x @param {number} z
 */
function bigBreak(ctx, x, z) {
  breakThrough(ctx, x, z, 1.25);
  const y = ctx.groundAt(x, z);
  ctx.fx('gulletFoam', x, y, z, { mode: 'flat', lift: 0.07, color: [...gulletFx.TINTS.gulletFoam], loops: 1, dirX: 0, dirZ: -1 });
  ctx.burst('gulletSpray', x, y + 0.4, z, 16);
}

/**
 * True the first time it is asked in the current state (a sub-step under slow motion repeats a
 * frame index: a cue keyed by frame would play twice).
 * @param {Enemy} e @param {number} bit
 */
function once(e, bit) {
  const ai = /** @type {GulletAI} */ (e.ai);
  if (ai.cueAt !== e.serial) {
    ai.cueAt = e.serial;
    ai.cues = 0;
  }
  if (ai.cues & bit) return false;
  ai.cues |= bit;
  return true;
}

/** @satisfies {Brain} */
export const gulletBrain = {
  init: initAI,

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {GulletAI} */ (e.ai);
    ai.clock += h;
    ai.phaseT += h;
    for (const k of /** @type {GulletMove[]} */ (['slam', 'burst', 'sweep', 'barrage'])) if (ai.cd[k] > 0) ai.cd[k] -= h;
    const fighting = e.state !== 'dormant' && e.state !== 'intro' && e.state !== 'phase';
    // the arms: a cut one hurts it (a slam's worth), a sunk one gives its hole back to the ice
    for (const a of ai.arms) {
      const aa = /** @type {any} */ (a.ai);
      if (!a.alive && !aa.counted) {
        aa.counted = true;
        ai.pain++;
      }
      if ((!a.alive || aa.under) && aa.hole) {
        const o = /** @type {Hole} */ (aa.hole);
        aa.hole = null;
        if (!o.lasting) o.until = ai.clock + 0.8;
        o.arm = null;
      }
    }
    // the phases: only while it is up and fighting (its HP moves only then)
    const phases = e.def.phases ?? [0.65, 0.3];
    if (ai.up && fighting && e.state !== 'stagger') {
      if (e.phase === 1 && e.hp <= e.hpMax * phases[0] + EPS) startPhase(e, 2, ctx);
      else if (e.phase === 2 && e.hp <= e.hpMax * phases[1] + EPS) startPhase(e, 3, ctx);
    }
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    holes(e, h, ctx);
    bursts(e, h, ctx);
    barrage(e, h, ctx);
    e.hpFloor = e.phase === 1 ? e.hpMax * phases[0] : e.phase === 2 ? e.hpMax * phases[1] : 0;
    // its shape under the ice; the head itself moves with it while it is under
    if (!ai.up && e.state !== 'dormant') {
      const s = iceStage(e)?.shadow;
      if (s && s.on) place(e, ctx, s.x, s.z);
    }
    iceStage(e)?.shadowTo(ai.shx, ai.shz, ai.up ? 0 : ai.sha, ai.shx - e.position.x, ai.shz - e.position.z);
  },

  /**
   * Its poise (per phase), spent only while it is up in a window: Broken.
   * @type {Brain['onHit']}
   */
  onHit(e, info, ctx) {
    const ai = /** @type {GulletAI} */ (e.ai);
    if (info.guarded || e.guarded || !ai.up || ai.move !== 'surface' || e.state !== 'active') return;
    e.poise -= info.poise || 0;
    if (e.poise > 0) return;
    e.poise = 0;
    endInk(e, ctx);
    e.vuln = 1.3;
    e.exposed = true;
    e.setState('stagger');
    ctx.sfx('stun', e.position.x, e.position.z);
    ctx.shake(0.3, 0.4);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    if (ctx) endInk(e, ctx);
  },

  /**
   * HP 0: no death — the release (`dead`). Its holes stay open until the thaw; its arms (core kills
   * the rest) slide back under.
   * @type {Brain['die']}
   */
  die(e, ctx) {
    const ai = /** @type {GulletAI} */ (e.ai);
    if (ctx) for (const b of ai.bursts) ctx.freeMarker(b[2]);
    if (ctx) for (const b of ai.barrage) ctx.freeMarker(b[2]);
    ai.bursts.length = 0;
    ai.barrage.length = 0;
    ai.holes.length = 0;
    ai.lasting.length = 0;
    ai.move = null;
    ai.dieT = 0;
    ai.rimeT = 0;
    iceStage(e)?.releaseAll();
    e.sprite.tint.setRGB(1, 1, 1);
    if (!ai.up) {
      // released while under the ice (a test hook): nothing to see
      e.sprite.opacity = 0;
      return;
    }
    e.pose('dead');
    if (ctx) ctx.shake(0.2, 0.8);
  },

  /**
   * The release: the eye clears and warms, the rime lifts off it in motes (1.3 s), then it sinks
   * back into the deep (2.4 s), foam on the water; gone. True: it fades itself.
   * @type {Brain['dead']}
   */
  dead(e, h, ctx) {
    const ai = /** @type {GulletAI} */ (e.ai);
    if (e.sprite.opacity <= 0.001) return true;
    ai.dieT += h;
    const t = ai.dieT;
    const p = e.position;
    e.pose('dead');
    ai.rimeT -= h;
    if (t < 2.6 && ai.rimeT <= 0) {
      ai.rimeT = 0.11;
      const a = e.rng.next() * TAU;
      ctx.burst('gulletRime', p.x + Math.cos(a) * 0.9, p.y + 1.6 + e.rng.next() * 2.2, p.z + Math.sin(a) * 0.5, 3);
    }
    if (t >= 0.25 && once(e, 1)) ctx.sfx('gulletRoar', p.x, p.z, { volume: 0.55, pitch: 0.62 });
    const u = Math.max(0, Math.min(1, (t - 1.3) / 2.4));
    e.lift = DEEP * u * u * (3 - 2 * u);
    e.sprite.mesh.position.y = e.lift;
    e.sprite.shadowProxy.position.y = e.lift;
    if ((t >= 1.5 && once(e, 2)) || (t >= 2.6 && once(e, 4))) {
      const y = ctx.groundAt(p.x, p.z);
      ctx.fx('gulletFoam', p.x, y, p.z, { mode: 'flat', lift: 0.07, color: [...gulletFx.TINTS.gulletFoam], loops: 1, dirX: 0, dirZ: -1 });
      ctx.burst('gulletBubbles', p.x, y + 0.1, p.z, 6);
    }
    if (u >= 1) e.sprite.opacity = 0;
    return true;
  },

  /**
   * Test hook `combat.boss.force(move)`: only `move` next, at once (the others wait 99 s); null:
   * none. Its moves: 'slam' | 'burst' | 'sweep' | 'barrage' | 'surface' ('surface' comes up now).
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {GulletAI} */ (e.ai);
    const m = /** @type {GulletMove|null} */ (/** @type {any} */ (move));
    for (const k of /** @type {GulletMove[]} */ (['slam', 'burst', 'sweep', 'barrage'])) ai.cd[k] = k === m ? 0 : 99;
    ai.forced = m && Object.hasOwn(COOLDOWN, m) ? m : null;
    ai.gap = 0;
  },

  /** Test hook `combat.boss.info()`. @type {Brain['info']} */
  info(e) {
    const ai = /** @type {GulletAI} */ (e.ai);
    return /** @type {any} */ ({
      move: ai.move, pending: null, skid: false, lift: +e.lift.toFixed(2), adds: ai.arms.filter((a) => a.alive && !/** @type {any} */ (a.ai).under).length,
      up: ai.up, pain: ai.pain, ink: ai.ink, holes: ai.holes.length, lasting: ai.lasting.length,
      spot: { x: +ai.sx.toFixed(2), z: +ai.sz.toFixed(2) },
    });
  },

  /** Test hook `bossPhase(n)`: no transition (the lasting holes open at once), signals `bossPhase`. @type {Brain['jumpPhase']} */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {GulletAI} */ (e.ai);
    n = Math.max(1, Math.min(3, n | 0));
    endInk(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    if (n >= 2 && !ai.lasting.length) openLasting(e, ctx, false);
    if (e.state !== 'dormant' && e.state !== 'intro') {
      if (ai.up) {
        ai.move = 'surface';
        e.setState('recover');
      } else endMove(e, F(30));
    }
    ctx.emit('bossPhase', e, n);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {GulletAI} */ (e.ai);
    let a;
    if (!e.alive) {
      out[0] = WARM[0];
      out[1] = WARM[1];
      out[2] = WARM[2];
      out[3] = Math.max(0, 0.7 * (1 - ai.dieT / 3));
      return;
    }
    if (!ai.up) a = 0;
    else if (e.state === 'intro') a = 0.6 + 0.8 * Math.min(1, Math.max(0, (e.t - F(INTRO.roar)) / F(20)));
    else if (e.phase === 3) a = 1.0 + 0.4 * (0.5 - 0.5 * Math.cos(TAU * 1.5 * ai.clock));
    else a = 0.85;
    if (ai.ink === 'wind') a += 1.4 * Math.min(1, ai.inkT / F(INK.windup));
    else if (ai.ink === 'spray') a += 0.8;
    if (e.state === 'stagger') a *= 0.45;
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = a;
  },
};

// -------------------------------------------------------------------------------------------------
// states
// -------------------------------------------------------------------------------------------------

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function step(e, h, ctx) {
  switch (e.state) {
    case 'dormant': dormant(e, ctx); break;
    case 'intro': intro(e, ctx); break;
    case 'engage': engage(e, h, ctx); break;
    case 'windup':
    case 'active':
    case 'recover': attack(e, h, ctx); break;
    case 'phase': phase(e, ctx); break;
    case 'stagger': broken(e, ctx); break;
    default: endMove(e);
  }
}

/**
 * Under the ice, still, until the player stands in its arena (an intro on appearing starts at once:
 * core, `introOnSpawn`).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  hideHead(e);
  ai.up = false;
  ai.sha = 0;
  e.aggro = false;
  const P = ctx.player;
  if (!P.alive || ctx.ambient) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 10;
  if (inside) e.setState('intro');
}

/**
 * The intro (156 f): the ice cracks round its spot, its shape darkens under it; it bursts up
 * through it (ice and spray), roars (`bossAwake`), looks at the party — and goes back under.
 * Guarded throughout.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function intro(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const ice = iceStage(e);
  e.aggro = true;
  e.guarded = true;
  const f = e.fr;
  if (e.entered) {
    const c = centre(e);
    ai.sx = c.x;
    ai.sz = c.z;
    ai.shx = c.x;
    ai.shz = c.z;
    ai.sha = 1;
    ai.roared = false;
    ai.awoke = false;
    ai.spotHole = null;
    place(e, ctx, c.x, c.z);
    ctx.emit('bossIntro', e);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + e.rng.range(-0.3, 0.3);
      ice?.crack(c.x + Math.sin(a) * 1.2, c.z + Math.cos(a) * 1.2, Math.sin(a), Math.cos(a), e.rng.range(3.2, 5.4), 0.7, 3.2);
    }
    ctx.sfx('iceCrack', c.x, c.z, { volume: 1 });
    ctx.shake(0.15, 0.7);
  }
  if (f >= INTRO.crack2 && once(e, 1)) ctx.sfx('iceCrack', ai.sx, ai.sz, { volume: 0.9, pitch: 0.8 });
  if (f >= INTRO.burst && !ai.spotHole) {
    ai.spotHole = openHole(e, ai.sx, ai.sz, true, Infinity);
    place(e, ctx, ai.sx, ai.sz);
    e.sprite.visible = true;
    e.sprite.opacity = 1;
    ai.up = true;
    e.guarded = true;
    bigBreak(ctx, ai.sx, ai.sz);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.5;
      breakThrough(ctx, ai.sx + Math.sin(a) * 2.4, ai.sz + Math.cos(a) * 2.4, 0.7);
    }
    ctx.sfx('iceBreak', ai.sx, ai.sz, { volume: 1 });
    ctx.sfx('gulletRoar', ai.sx, ai.sz, { volume: 0.6, pitch: 1.2 });
    ctx.shake(0.5, 0.6);
  }
  if (f < INTRO.burst) {
    e.lift = DEEP;
    return;
  }
  const P = ctx.player.position;
  e.face(P.x, P.z);
  if (f < INTRO.burst + 18) {
    const u = (f - INTRO.burst) / 18;
    e.lift = DEEP * (1 - u) * (1 - u);
    e.pose('burst');
  } else if (f < INTRO.look) {
    e.lift = 0;
    e.pose(f < INTRO.roar - 6 ? 'burst' : 'roar');
    if (f >= INTRO.roar && once(e, 2)) {
      ai.awoke = true;
      ctx.sfx('gulletRoar', ai.sx, ai.sz, { volume: 1 });
      ctx.shake(0.32, 0.9);
      ctx.burst('gulletSpray', ai.sx, ctx.groundAt(ai.sx, ai.sz) + 0.5, ai.sz, 14);
      ctx.emit('bossAwake', e);
    }
  } else if (f < INTRO.sink) {
    e.lift = 0;
    e.anim('idle');
  } else {
    const u = Math.min(1, (f - INTRO.sink) / (INTRO.end - INTRO.sink));
    e.lift = DEEP * u * u;
    e.pose('idle0');
  }
  if (e.after(INTRO.end)) {
    setUnder(e, ctx, true);
    e.lift = DEEP;
    if (ai.spotHole) ai.spotHole.until = ai.clock + 1.0;
    ai.spotHole = null;
    ai.pain = 0;
    ai.underT = 0;
    endMove(e, F(40));
  }
}

/**
 * Under the ice between moves: its shape circling its prey; the next move after the gap — only
 * while the fight runs (its arena closed on the party, its prey standing).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  e.guarded = true;
  e.lift = DEEP;
  if (ai.up) setUnder(e, ctx, true);
  const P = ctx.player;
  const ready = P.alive && !ctx.ambient && (!e.arena || e.arena.active);
  // its shape: a slow circle 3.5 u round its prey (the arena's centre while there is none)
  const r = rect(e, 1.6);
  if (ready) {
    const a = ai.clock * 0.35 + (e.index % 7);
    ai.shx = cx(r, P.position.x + Math.sin(a) * 3.5);
    ai.shz = cz(r, P.position.z + Math.cos(a) * 3.5);
    ai.sha = 1;
  } else {
    const c = centre(e);
    ai.shx = c.x;
    ai.shz = c.z;
    ai.sha = e.state === 'engage' && e.arena?.active ? 1 : 0.6;
  }
  if (!ready) return;
  ai.underT += h;
  ai.gap -= h;
  if (ai.gap > 0) return;
  const m = chooseMove(e, ctx);
  if (m) startMove(e, m, ctx);
  else ai.gap = F(12);
}

/**
 * The next move: the forced one; up when it hurts enough (or has been under too long); else a
 * seeded, weighted pick off cooldown, never the same three times running.
 * @param {Enemy} e @param {CombatContext} ctx
 * @returns {GulletMove|null}
 */
function chooseMove(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  if (ai.forced) {
    const m = ai.forced;
    ai.forced = null;
    return m;
  }
  if (ai.pain >= (PAIN[e.phase - 1] ?? 3) || ai.underT >= LONELY_S) return 'surface';
  const ph = e.phase;
  /** @type {(m: GulletMove) => boolean} */
  const ok = (m) => ai.cd[m] <= 0 && !(ai.last1 === m && ai.last2 === m);
  const P = ctx.player.position;
  const sweepHole = ph >= 2 ? lastingNear(ai, P.x, P.z, 0, SWEEP.near) : null;
  /** @type {[GulletMove, number][]} */
  const w = [
    ['slam', ok('slam') && armsUp(ai) < 3 ? (ph === 3 ? 2.5 : 3) : 0],
    ['burst', ok('burst') ? 2 : 0],
    ['sweep', ph >= 2 && sweepHole && ok('sweep') && armsUp(ai) < 3 ? 2.5 : 0],
    ['barrage', ph === 3 && ok('barrage') ? 2 : 0],
  ];
  const total = w.reduce((s, [, v]) => s + v, 0);
  // (nothing legal: the slam once more, the three-in-a-row rule waived — never one held off by `force`)
  if (total <= 0) return ai.cd.slam <= 0 && armsUp(ai) < 3 ? 'slam' : null;
  let x = e.rng.next() * total;
  for (const [m, v] of w) {
    x -= v;
    if (v > 0 && x < 0) return m;
  }
  return w.find(([, v]) => v > 0)?.[0] ?? null;
}

/**
 * The lasting hole without an arm nearest (x, z) between `dMin` and `dMax` u from it, or null.
 * @param {GulletAI} ai @param {number} x @param {number} z @param {number} dMin @param {number} dMax
 * @returns {Hole|null}
 */
function lastingNear(ai, x, z, dMin, dMax) {
  let best = null;
  let bd = Infinity;
  for (const o of ai.lasting) {
    if (o.arm || o === ai.spotHole) continue;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < dMin || d > dMax) continue;
    const k = Math.abs(d - (dMin + dMax) / 2);
    if (k < bd) {
      bd = k;
      best = o;
    }
  }
  return best;
}

/**
 * Begin a move: its cooldown, the history, its wind-up.
 * @param {Enemy} e @param {GulletMove} m @param {CombatContext} ctx
 */
function startMove(e, m, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  ai.move = m;
  ai.last2 = ai.last1;
  ai.last1 = m;
  if (m !== 'surface') ai.cd[m] = COOLDOWN[m];
  ai.arm = null;
  e.setState('windup');
}

/**
 * The move is over: under the ice again, the next after `gap` s (default: the phase's seeded gap).
 * @param {Enemy} e @param {number} [gap]
 */
function endMove(e, gap) {
  const ai = /** @type {GulletAI} */ (e.ai);
  ai.move = null;
  ai.arm = null;
  const g = GAP_F[e.phase - 1] ?? GAP_F[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function attack(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  switch (ai.move) {
    case 'slam': slamMove(e, ctx); break;
    case 'burst': burstMove(e, ctx); break;
    case 'sweep': sweepMove(e, ctx); break;
    case 'barrage': barrageMove(e, ctx); break;
    case 'surface': surface(e, h, ctx); break;
    default: endMove(e);
  }
}

/**
 * Crack Slam: an arm up through the ice at the crack's far end; the head waits for its strike.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function slamMove(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const P = ctx.player.position;
  if (e.state === 'windup') {
    let hole = e.phase >= 2 ? lastingNear(ai, P.x, P.z, 4, 9) : null;
    let x, z;
    if (hole) {
      x = hole.x;
      z = hole.z;
    } else {
      const r = rect(e, 1.4);
      x = P.x;
      z = P.z;
      for (let k = 0; k < 10; k++) {
        const a = e.rng.next() * TAU;
        const d = e.rng.range(SLAM.reach[0], SLAM.reach[1]);
        x = cx(r, P.x + Math.sin(a) * d);
        z = cz(r, P.z + Math.cos(a) * d);
        if (Math.hypot(x - P.x, z - P.z) >= 4 && clearOfHoles(ai, x, z, 0.6)) break;
      }
    }
    const arm = freeArm(e, ctx, x, z);
    if (!arm) {
      endMove(e, F(20));
      return;
    }
    if (!hole) hole = openHole(e, x, z, false, Infinity);
    hole.arm = arm;
    const d = Math.hypot(P.x - x, P.z - z) || 1;
    orderArm(arm, { kind: 'slam', x, z, dx: (P.x - x) / d, dz: (P.z - z) / d, len: SLAM.len, windup: W(e, SLAM.windup), lie: SLAM.lie, ice: iceStage(e) }, ctx);
    /** @type {any} */ (arm.ai).hole = hole;
    ai.arm = arm;
    ai.shx = x;
    ai.shz = z;
    ai.sha = 1;
    e.setState('active');
    return;
  }
  if (e.state === 'active') {
    const arm = ai.arm;
    const aa = /** @type {any} */ (arm?.ai);
    if (!arm || !arm.alive || !aa || aa.struck || !aa.order || e.after(SLAM.wait * 60)) {
      if (aa && aa.struck) ai.pain++;
      e.setState('recover');
    }
    return;
  }
  if (e.after(14)) endMove(e);
}

/**
 * Ice Burst: the circles under the party (they fill and erupt on their own: `bursts`).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function burstMove(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  if (e.state === 'windup') {
    if (e.entered) {
      const P = ctx.player;
      const r = rect(e, 1.2);
      const n = BURST.n[e.phase - 1] ?? 3;
      const dur = F(W(e, BURST.windup));
      /** @type {number[][]} */
      const pts = [];
      pts.push([cx(r, P.position.x + P.velocity.x * BURST.lead), cz(r, P.position.z + P.velocity.z * BURST.lead)]);
      for (let k = 1, tries = 0; k < n && tries < 40; tries++) {
        const a = e.rng.next() * TAU;
        const d = e.rng.range(1.6, BURST.spread);
        const x = cx(r, pts[0][0] + Math.sin(a) * d);
        const z = cz(r, pts[0][1] + Math.cos(a) * d);
        if (pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < BURST.apart)) continue;
        pts.push([x, z]);
        k++;
      }
      for (const [x, z] of pts) {
        const m = e.markerSpec('circle', x, z);
        m.r = BURST.r;
        m.style = WARM_STYLE;
        const hm = ctx.marker(m);
        ai.bursts.push([x, z, hm, 0, dur, e.newTag()]);
        ctx.burst('gulletCrackDust', x, ctx.groundAt(x, z) + 0.1, z, 3);
      }
      ctx.sfx('iceCrack', pts[0][0], pts[0][1], { volume: 0.8, pitch: 1.1 });
      ai.shx = pts[0][0];
      ai.shz = pts[0][1];
      ai.sha = 1;
    }
    if (e.after(W(e, BURST.windup) + 2)) e.setState('recover');
    return;
  }
  if (e.after(16)) endMove(e);
}

/**
 * The ice bursts filling and erupting: a hit, the eruption, a hole for 8 s.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function bursts(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  for (let i = ai.bursts.length - 1; i >= 0; i--) {
    const b = ai.bursts[i];
    b[3] += h;
    const prog = Math.min(1, b[3] / b[4]);
    if (b[2] >= 0) ctx.setMarker(b[2], { progress: prog });
    if (b[3] < b[4] - EPS) continue;
    const [x, z] = b;
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = x;
    s.z = z;
    s.y = ctx.groundAt(x, z);
    s.r = BURST.r;
    s.mv = BURST.mv;
    s.kb = BURST.kb;
    s.fromX = x;
    s.fromZ = z;
    s.tag = b[5];
    ctx.hitbox(e, s);
    breakThrough(ctx, x, z, 0.95);
    ctx.sfx('iceBreak', x, z, { volume: 0.85 });
    ctx.shake(0.22, 0.28);
    openHole(e, x, z, false, ai.clock + BURST.hole);
    ctx.freeMarker(b[2]);
    ai.bursts.splice(i, 1);
  }
}

/**
 * Tentacle Sweep: an arm in a lasting hole near its prey; the head waits for the sweep.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function sweepMove(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const P = ctx.player.position;
  if (e.state === 'windup') {
    const hole = lastingNear(ai, P.x, P.z, 0, SWEEP.near);
    const arm = hole ? freeArm(e, ctx, hole.x, hole.z) : null;
    if (!hole || !arm) {
      endMove(e, F(12));
      return;
    }
    hole.arm = arm;
    const d = Math.hypot(P.x - hole.x, P.z - hole.z) || 1;
    orderArm(arm, { kind: 'sweep', x: hole.x, z: hole.z, dx: (P.x - hole.x) / d, dz: (P.z - hole.z) / d, len: 0, windup: W(e, SWEEP.windup), lie: SWEEP.lie, ice: iceStage(e) }, ctx);
    /** @type {any} */ (arm.ai).hole = hole;
    ai.arm = arm;
    ai.shx = hole.x;
    ai.shz = hole.z;
    e.setState('active');
    return;
  }
  if (e.state === 'active') {
    const arm = ai.arm;
    const aa = /** @type {any} */ (arm?.ai);
    if (!arm || !arm.alive || !aa || aa.struck || !aa.order || e.after(SWEEP.wait * 60)) e.setState('recover');
    return;
  }
  if (e.after(10)) endMove(e);
}

/**
 * Shard Barrage: six circles, 8 f apart, each with a shard of ice arcing onto it (`barrage`).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function barrageMove(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  if (e.state === 'windup') {
    if (e.entered) {
      const P = ctx.player.position;
      const r = rect(e, 1.0);
      /** @type {number[][]} */
      const pts = [[cx(r, P.x), cz(r, P.z)]];
      for (let tries = 0; pts.length < BARRAGE.n && tries < 60; tries++) {
        const a = e.rng.next() * TAU;
        const d = e.rng.range(1.4, BARRAGE.spread);
        const x = cx(r, P.x + Math.sin(a) * d);
        const z = cz(r, P.z + Math.cos(a) * d);
        if (pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < BARRAGE.apart)) continue;
        pts.push([x, z]);
      }
      const fill = F(W(e, BARRAGE.fill));
      pts.forEach(([x, z], k) => ai.barrage.push([x, z, -1, 0, F(k * BARRAGE.every), fill, 0]));
      ctx.sfx('iceCrack', P.x, P.z, { volume: 1, pitch: 0.75 });
      ctx.shake(0.18, 0.6);
    }
    if (e.after(BARRAGE.n * BARRAGE.every + W(e, BARRAGE.fill) + 6)) e.setState('recover');
    return;
  }
  if (e.after(20)) endMove(e);
}

/**
 * The barrage's circles: each appears at its delay with its shard launched from the nearest hole
 * (or from the head's shape), and is gone when the shard has landed.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function barrage(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  for (let i = ai.barrage.length - 1; i >= 0; i--) {
    const b = ai.barrage[i];
    b[3] += h;
    const t = b[3] - b[4];
    if (t < 0) continue;
    const [x, z] = b;
    if (!b[6]) {
      b[6] = 1;
      const m = e.markerSpec('circle', x, z);
      m.r = BARRAGE.r;
      m.style = WARM_STYLE;
      b[2] = ctx.marker(m);
      // from the nearest hole (else from its shape under the ice)
      let sx = ai.shx;
      let sz = ai.shz;
      let bd = Infinity;
      for (const o of ai.holes) {
        const d = Math.hypot(o.x - x, o.z - z);
        if (d < bd && d > 1.2) {
          bd = d;
          sx = o.x;
          sz = o.z;
        }
      }
      const dist = Math.hypot(x - sx, z - sz) || 0.01;
      const ps = e.projSpec();
      ps.kind = 'boulder';
      ps.x = sx;
      ps.y = ctx.groundAt(sx, sz) - 0.2;
      ps.z = sz;
      ps.dirX = (x - sx) / dist;
      ps.dirZ = (z - sz) / dist;
      ps.speed = dist / b[5];
      ps.range = dist;
      ps.radius = BARRAGE.r;
      ps.mv = BARRAGE.mv;
      ps.kb = BARRAGE.kb;
      ps.arc = { tx: x, tz: z, time: b[5], apex: BARRAGE.apex };
      ps.look = SHARD;
      ctx.projectile(e, ps);
      ctx.burst('gulletSpray', sx, ctx.groundAt(sx, sz) + 0.3, sz, 4);
    }
    if (b[2] >= 0) ctx.setMarker(b[2], { progress: Math.min(1, t / b[5]) });
    if (t >= b[5] - EPS && b[6] === 1) {
      b[6] = 2;
      breakThrough(ctx, x, z, 0.55);
    }
    if (t >= b[5] + F(5)) {
      ctx.freeMarker(b[2]);
      ai.barrage.splice(i, 1);
    }
  }
}

/**
 * The surfacing: the gold glint at its spot (windup), up through the ice for its window (active;
 * the frost-ink from phase 2), back under (recover).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function surface(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const ice = iceStage(e);
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.entered) {
      let hole = e.phase >= 2 ? lastingNear(ai, P.x, P.z, 3, 8) : null;
      if (!hole) {
        const r = rect(e, 2.2);
        let x = P.x;
        let z = P.z;
        let best = -Infinity;
        for (let k = 0; k < 12; k++) {
          const a = e.rng.next() * TAU;
          const d = e.rng.range(3.5, 7);
          const tx = cx(r, P.x + Math.sin(a) * d);
          const tz = cz(r, P.z + Math.cos(a) * d);
          const dd = Math.hypot(tx - P.x, tz - P.z);
          const score = -Math.abs(dd - 5) + (clearOfHoles(ai, tx, tz, 0.4) ? 2 : 0);
          if (score > best) {
            best = score;
            x = tx;
            z = tz;
          }
        }
        hole = openHole(e, x, z, true, Infinity);
      }
      ai.spotHole = hole;
      ai.sx = hole.x;
      ai.sz = hole.z;
      ai.shx = hole.x;
      ai.shz = hole.z;
      ai.sha = 1;
      ice?.glint(hole.id, true);
      ctx.sfx('gulletRoar', hole.x, hole.z, { volume: 0.35, pitch: 0.7 });
    }
    if (e.fr % 9 === 0) ctx.burst('gulletBubbles', ai.sx, ctx.groundAt(ai.sx, ai.sz) + 0.05, ai.sz, 4);
    if (e.after(W(e, SURFACE.glint[e.phase - 1]))) {
      if (ai.spotHole) ice?.glint(ai.spotHole.id, false);
      place(e, ctx, ai.sx, ai.sz);
      setUnder(e, ctx, false);
      e.lift = DEEP;
      e.poise = e.poiseMax;
      ai.ink = 'none';
      bigBreak(ctx, ai.sx, ai.sz);
      ctx.sfx('iceBreak', ai.sx, ai.sz, { volume: 0.9 });
      ctx.shake(0.32, 0.4);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.guarded = false;
    const f = e.fr;
    if (ai.ink === 'none' || ai.ink === 'done') e.face(P.x, P.z);
    if (f < RISE_F) {
      const u = f / RISE_F;
      e.lift = DEEP * (1 - u) * (1 - u);
      e.pose(f < RISE_F * 0.6 ? 'burst' : 'idle0');
    } else {
      e.lift = 0;
      if (ai.ink === 'none' || ai.ink === 'done') e.anim('idle');
    }
    // the frost-ink (phase 2–3): once a window, its prey in reach
    if (e.phase >= 2 && ai.ink === 'none' && f >= INK.at && Math.hypot(P.x - e.position.x, P.z - e.position.z) <= INK.reach) {
      ai.ink = 'wind';
      ai.inkT = 0;
      const d = Math.hypot(P.x - e.position.x, P.z - e.position.z) || 1;
      ai.ix = (P.x - e.position.x) / d;
      ai.iz = (P.z - e.position.z) / d;
      ctx.sfx('windup', e.position.x, e.position.z);
    }
    if (ai.ink === 'wind' || ai.ink === 'spray') ink(e, h, ctx);
    if (e.after(SURFACE.up[e.phase - 1])) {
      endInk(e, ctx);
      e.setState('recover');
    }
    return;
  }
  // back under
  if (e.entered) {
    endInk(e, ctx);
    e.guarded = true;
    e.vuln = 1;
    e.exposed = false;
    ctx.burst('gulletSpray', e.position.x, e.position.y + 0.5, e.position.z, 8);
  }
  const u = Math.min(1, e.t / F(SINK_F));
  e.lift = DEEP * u * u;
  e.pose('idle0');
  if (u >= 1) {
    setUnder(e, ctx, true);
    e.lift = DEEP;
    const o = ai.spotHole;
    if (o && !o.lasting) o.until = ai.clock + 1.0;
    ai.spotHole = null;
    ai.pain = 0;
    ai.underT = 0;
    const y = ctx.groundAt(ai.sx, ai.sz);
    ctx.fx('gulletFoam', ai.sx, y, ai.sz, { mode: 'flat', lift: 0.07, color: [...gulletFx.TINTS.gulletFoam], loops: 1, dirX: 0, dirZ: -1 });
    endMove(e);
  }
}

/**
 * The frost-ink: the siphon swells under the cone (tracking 24 f, then locked), then sprays it —
 * dark ink and frost glitter streaming down the cone, a hit every 12 f.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function ink(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const p = e.position;
  ai.inkT += h;
  const wind = F(W(e, INK.windup));
  if (ai.ink === 'wind') {
    if (ai.inkT < F(INK.track)) {
      const P = ctx.player.position;
      const d = Math.hypot(P.x - p.x, P.z - p.z);
      if (d > 0.5) {
        ai.ix = (P.x - p.x) / d;
        ai.iz = (P.z - p.z) / d;
      }
    }
    e.faceDir(ai.ix, ai.iz);
    e.pose('windup');
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = INK.r;
    m.halfAngle = INK.half;
    m.dirX = ai.ix;
    m.dirZ = ai.iz;
    m.style = WARM_STYLE;
    m.progress = Math.min(1, ai.inkT / wind);
    m.flash = e.lockFlash(ai.inkT - F(INK.track));
    e.mark(1, ctx, m);
    if (ai.inkT >= wind - EPS) {
      ai.ink = 'spray';
      ai.inkT = 0;
      e.markProgress(1, ctx, 1);
      ctx.sfx('windGust', p.x, p.z, { volume: 0.9, pitch: 0.7 });
    }
    return;
  }
  // the spray
  e.faceDir(ai.ix, ai.iz);
  e.pose('attack');
  const f = Math.floor(ai.inkT * 60 + EPS);
  const y = ctx.groundAt(p.x, p.z);
  if (f % 3 === 0) {
    for (const k of [1.2, 2.6, 4.2, 5.8]) {
      const spread = (e.rng.next() - 0.5) * 2 * Math.tan(INK.half * DEG) * k * 0.7;
      ctx.burst('gulletInk', p.x + ai.ix * k - ai.iz * spread, y + 1.0, p.z + ai.iz * k + ai.ix * spread, 2);
    }
    ctx.burst('gulletInkFrost', p.x + ai.ix * 2.5, y + 1.1, p.z + ai.iz * 2.5, 3);
  }
  if (f % INK.every === 0 && Math.floor((ai.inkT - h) * 60 + EPS) !== f) ai.inkTag = e.newTag();
  const s = e.hitSpec();
  s.shape = 'sector';
  s.r = INK.r;
  s.halfAngle = INK.half;
  s.dirX = ai.ix;
  s.dirZ = ai.iz;
  s.mv = INK.mv;
  s.kb = INK.kb;
  s.tag = ai.inkTag || (ai.inkTag = e.newTag());
  ctx.hitbox(e, s);
  if (ai.inkT >= F(INK.active) - EPS) endInk(e, ctx);
}

/** The ink over (or broken off): its marker gone. @param {Enemy} e @param {CombatContext} ctx */
function endInk(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  if (ai.ink === 'wind' || ai.ink === 'spray') ai.ink = 'done';
  e.unmark(1, ctx);
  ai.inkTag = 0;
}

/**
 * Broken (its poise spent while it was up): dazed 150 f, vulnerable, exposed — then back under.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function broken(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  e.lift = 0;
  e.pose('daze');
  if (e.entered) ctx.burst('gulletSpray', e.position.x, e.position.y + 2.5, e.position.z, 6);
  if (e.after(SURFACE.broken)) {
    e.vuln = 1;
    e.exposed = false;
    e.poise = e.poiseMax;
    ai.move = 'surface';
    e.setState('recover');
  }
}

/**
 * The holes: the ones whose time is up close; standing in one hurts and knocks out of it (only
 * while the fight runs: never in a story scene, never before the intro is over).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function holes(e, h, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  for (let i = ai.holes.length - 1; i >= 0; i--) if (ai.clock >= ai.holes[i].until) closeHole(e, ai.holes[i]);
  if (ctx.ambient || e.state === 'dormant' || e.state === 'intro' || !ctx.player.alive) return;
  if (e.arena && !e.arena.active) return;
  ai.tick += h;
  if (ai.tick < HOLE.tick - EPS) return;
  ai.tick -= HOLE.tick;
  const P = ctx.player;
  for (const o of ai.holes) {
    if (o === ai.spotHole && ai.up) continue;
    if (o.arm) continue;
    // (the push lands on whoever stands in the water: skipped only while the player rolls through
    // this hole, so a companion in another is pushed out all the same)
    const push = !P.invulnerable || Math.hypot(P.position.x - o.x, P.position.z - o.z) >= o.r + P.radius + 0.05;
    const y = ctx.groundAt(o.x, o.z);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = o.x;
    s.y = y;
    s.z = o.z;
    s.r = o.r;
    s.mv = 0;
    s.kb = 0;
    s.flat = HOLE.flat;
    s.tag = e.newTag();
    ctx.hitbox(e, s);
    if (push) {
      const k = e.hitSpec();
      k.shape = 'circle';
      k.x = o.x;
      k.y = y;
      k.z = o.z;
      k.r = o.r;
      k.mv = 0;
      k.kb = HOLE.kb;
      k.fromX = o.x;
      k.fromZ = o.z;
      k.tag = e.newTag();
      ctx.hitbox(e, k);
    }
    // any other foe in the water: pushed out and chilled
    for (const f of ctx.enemiesNear(o.x, o.z, o.r + 0.3, ai.near)) {
      if (f === e || f.kind === 'tentacle' || f.boss) continue;
      let dx = f.position.x - o.x;
      let dz = f.position.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
      ctx.moveGround(f, dx * HOLE.foePush, dz * HOLE.foePush);
      f.chill(HOLE.foeChill);
    }
  }
}

/**
 * Open the four lasting holes (phase 2): the cracks run to them first unless `now`.
 * @param {Enemy} e @param {CombatContext} ctx @param {boolean} fx the eruptions and pushes
 */
function openLasting(e, ctx, fx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const r = rect(e, 0);
  const c = centre(e);
  const hw = (r.maxX - r.minX) / 2;
  const hd = (r.maxZ - r.minZ) / 2;
  const inner = rect(e, 2.2);
  for (const [fx0, fz0] of LASTING) {
    const x = cx(inner, c.x + fx0 * hw);
    const z = cz(inner, c.z + fz0 * hd);
    const o = openHole(e, x, z, true, Infinity, true);
    ai.lasting.push(o);
    if (!fx) continue;
    bigBreak(ctx, x, z);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = x;
    s.y = ctx.groundAt(x, z);
    s.z = z;
    s.r = 1.8;
    s.mv = 0;
    s.kb = 3.0;
    s.fromX = x;
    s.fromZ = z;
    s.tag = e.newTag();
    ctx.hitbox(e, s);
  }
}

/**
 * Start the transition to phase `n`: cancel the move, signal `bossPhase`, the roar.
 * @param {Enemy} e @param {number} n @param {CombatContext} ctx
 */
function startPhase(e, n, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  endInk(e, ctx);
  e.unmarkAll(ctx);
  e.phase = n;
  e.poise = e.poiseMax;
  e.vuln = 1;
  e.exposed = false;
  ai.phaseT = 0;
  ai.trans = n;
  ai.roared = false;
  ctx.emit('bossPhase', e, n);
  e.guarded = true;
  e.setState('phase');
}

/**
 * The transition (guarded, up at its spot): phase 2 — the roar, cracks running to four spots, the
 * lasting holes bursting open at f60 and two arms rising in them, back under at f150; phase 3 — the
 * roar, the lasting holes heaving, back under at f120.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function phase(e, ctx) {
  const ai = /** @type {GulletAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.lift = 0;
  e.pose('roar');
  const f = e.fr;
  if (e.entered) {
    ctx.sfx('gulletRoar', p.x, p.z, { volume: 1 });
    ctx.shake(0.45, 1.1);
    ctx.burst('gulletSpray', p.x, p.y + 0.5, p.z, 16);
    if (ai.trans === 2) {
      const r = rect(e, 0);
      const c = centre(e);
      const inner = rect(e, 2.2);
      for (const [fx0, fz0] of LASTING) {
        const x = cx(inner, c.x + fx0 * (r.maxX - r.minX) / 2);
        const z = cz(inner, c.z + fz0 * (r.maxZ - r.minZ) / 2);
        const d = Math.hypot(x - p.x, z - p.z) || 1;
        iceStage(e)?.crack(p.x + ((x - p.x) / d) * 1.6, p.z + ((z - p.z) / d) * 1.6, x - p.x, z - p.z, Math.max(0.5, d - 2.4), 0.9, 2.4);
      }
      ctx.sfx('iceCrack', p.x, p.z, { volume: 1, pitch: 0.85 });
    }
  }
  if (ai.trans === 2 && f >= 60 && once(e, 1)) {
    if (!ai.lasting.length) openLasting(e, ctx, true);
    ctx.sfx('iceBreak', p.x, p.z, { volume: 1, pitch: 0.8 });
    ctx.shake(0.5, 0.6);
    // two arms rise in them, the creature's own
    let k = 0;
    for (const o of ai.lasting) {
      if (k >= 2) break;
      const arm = freeArm(e, ctx, o.x, o.z);
      if (!arm) break;
      const P = ctx.player.position;
      const d = Math.hypot(P.x - o.x, P.z - o.z) || 1;
      orderArm(arm, { kind: 'rise', x: o.x, z: o.z, dx: (P.x - o.x) / d, dz: (P.z - o.z) / d, len: 0, windup: 0, lie: 80, ice: null }, ctx);
      /** @type {any} */ (arm.ai).hole = o;
      o.arm = arm;
      k++;
    }
  }
  if (ai.trans === 3 && ((f >= 30 && once(e, 2)) || (f >= 54 && once(e, 4)) || (f >= 78 && once(e, 8)))) {
    for (const o of ai.lasting) breakThrough(ctx, o.x, o.z, 0.7);
    ctx.sfx('iceCrack', p.x, p.z, { volume: 0.9 });
    ctx.shake(0.2, 0.3);
  }
  if (e.after(ai.trans === 2 ? 150 : 120)) {
    ai.trans = 0;
    ai.move = 'surface';
    e.setState('recover');
  }
}

// -------------------------------------------------------------------------------------------------
// the pack's registration
// -------------------------------------------------------------------------------------------------

/**
 * Old Gullet's part of the pack: the head's and the arms' sheets and brains, the FX frames, the
 * presets, the ice stage (a level system, COMBAT.md §30.1). (The arm is a kind of its own,
 * `tentacle`, an add only.)
 * @param {EnemyPackRegistrar} api
 */
export function register(api) {
  api.registerSystem('gulletIce', makeIceSystem);
  api.registerMarkerStyles({ gulletWarm: WARM_ID }, WARM_GLSL);
  api.registerMonsterKind('gullet', paintGullet);
  api.registerMonsterKind('tentacle', paintTentacle);
  api.registerFxModule(gulletFx);
  api.registerPresets(PRESETS);
  api.registerBrain('gullet', gulletBrain);
  api.registerBrain('tentacle', tentacleBrain);
}

/** For tests (sandbox/gullet.js): the depths and the timeline constants. */
export const GULLET_TUNING = Object.freeze({ DEEP, ARM_DEEP, INTRO, SURFACE, PAIN, LONELY_S, SLAM, BURST, SWEEP, BARRAGE, INK, HOLE, COOLDOWN });
