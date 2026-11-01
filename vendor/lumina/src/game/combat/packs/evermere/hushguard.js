/**
 * The Hushguard (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): the valley's old belfry-guard
 * armour, empty and full of frost — the campaign's signature foe. Owner: the foes package (this
 * brain; its sheet src/engine/pixel/monsters/hushguard.js; the foes' FX frames
 * src/engine/pixel/fx/evFoesFx.js and particle presets src/engine/fx/presets/evFoes.js, registered
 * here for all four foes); registered by ./index.js.
 *
 * **The armour.** A Hushguard takes little damage (`e.vuln` = ARMOUR 0.35) until its poise breaks
 * (a hit that empties it: the bellwarden's Peal sends 60, her hammer double; poise 60, elites 90) —
 * then the plates blow open and the **frost core** shows: a burst of ice from the chest (`evCore`,
 * `evFrostBurst`, `iceCrack`), the core's glow texels in the sheet (`hurt`, `reel*`), the glow up;
 * for CORE_S (3 s from the break, the stagger included) it takes × CORE_VULN 1.6 and crits more
 * (`exposed`), and it does not attack: it reels back, a gauntlet to its chest, frost motes rising.
 * Kill it then, or the plates close again (`seal`: `evSeal`, rime, a hush; poise full, the armour
 * back). A status hold (Linnet's Carillon stuns) shows the core too: × CORE_VULN while it lasts
 * (set as the hold begins, `cancel`; not a break). A Hush Cantor's ring seals a
 * broken Hushguard at once and wards it (`sealHushguard`: × WARD 0.6 for 4 s, a rune ring under it).
 *
 * **Its arms** — by its group's seed (`armsOf`): sword and heater shield, or a halberd (the sheet's
 * `h_` columns, shown through a view of the sheet whose poses and animations point at them: the
 * Enemy's own `hurt`, `dead`, `idle` and `walk` then show the halberdier too).
 *
 * **Its moves** (§7.3: every wind-up ≥ 18 f with a ground marker; one melee token, cost 1.5: two
 * strike at once):
 *  - *Cut* (d ≤ reach): a 26 f wind-up (the weapon raised, a sector marker filling, the facing locked
 *    for the last 6 f), a 6 f cut (sword r 1.8 ±65°, halberd r 2.4 ±55°; mv 1.1, kb 0.8; `evArc`);
 *    55 % (seeded) a rising second cut with its own 18 f wind-up (mv 1.2); recover 34 f.
 *  - *Heavy*: the sword's **shield bash** (24 f wind-up, a lane 1.6 × 1.3 and a 0.6 u shove: mv 0.9,
 *    kb 2.2) or the halberd's **sweep** (30 f wind-up, a sector r 3.2 ±110°: mv 1.4, kb 1.6, the
 *    arc doubled); cooldown 4–6 s.
 *  - *Lunge* (3.2 ≤ d ≤ 5.6, line of sight): a 28 f wind-up with a lane marker (tracking 16 f, locked
 *    12 f), a 10 f thrust along it (sword 2.4 u + reach 1.1, halberd 1.8 u + reach 2.0; mv 1.3,
 *    kb 1.2); cooldown 5–7 s.
 * Between them the **guarded advance**: from 6 u it walks in at 1.8 u/s, shield (or haft) up
 * (`gmove0` / `gmove1`); farther it marches (`walk`) along the walk grid.
 *
 * **Idle**: it stands still where it was put — the old guard's stance, the eyes breathing — and
 * **turns its head** toward Linnet (`look` / `lookB`) while she is within LOOK_R (in a story scene's
 * ambient step too: every Hushguard on the level near her watches her).
 *
 * Test hook: `e.ai.force` = 'cut' | 'heavy' | 'lunge' makes that move the next one picked as soon
 * as its range allows (cooldowns ignored); `breakCore(e, ctx)` opens the core as a break would.
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { Brain, CombatContext, FxOptions, HitInfo } from '../../types.js'
 * @import { EnemyPackApi } from '../index.js'
 * @import { EnemySheet } from '../../types.js'
 */
import { hushguard as hushguardSheet, HUSHGUARD_POSES, HALBERD_PREFIX } from '../../../../engine/pixel/monsters/hushguard.js';
import * as evFoesFx from '../../../../engine/pixel/fx/evFoesFx.js';
import { PRESETS as EV_FOES_PRESETS } from '../../../../engine/fx/presets/evFoes.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

/** The armour's damage multiplier, the open core's, the cantor's ward's. */
export const ARMOUR = 0.35;
export const CORE_VULN = 1.6;
export const WARD = 0.6;
/** Seconds the core stays open after a break (the stagger included). */
export const CORE_S = 3;
/** Seconds of a cantor's ward. */
export const WARD_S = 4;
/** The seal's own beat (frames): the plates close, then it fights again. */
const SEAL_F = 18;

const MARCH = 2.6;
const ADVANCE = 1.8;
const GUARD_FROM = 6;
const REEL = 1.0;
/** Head-turn range (u): idle, and in a story scene's ambient step. */
const LOOK_R = 12;
const LOOK_R_AMBIENT = 16;

/** The moves' numbers per arm. */
const CUT = Object.freeze({
  sword: { reach: 2.1, r: 1.8, half: 65, step: 1.2 },
  halberd: { reach: 2.7, r: 2.4, half: 55, step: 0.8 },
  windup: 26, follow: 18, lock: 6, active: 6, lunge: 0.5, mv: 1.1, mv2: 1.2, kb: 0.8, second: 0.55, recover: 34, cooldown: [50, 80],
});
const BASH = Object.freeze({ windup: 24, active: 6, len: 1.6, width: 1.3, shove: 0.6, mv: 0.9, kb: 2.2, recover: 30 });
const SWEEP = Object.freeze({ windup: 30, active: 7, r: 3.2, half: 110, mv: 1.4, kb: 1.6, recover: 36 });
const HEAVY_CD = [4, 6];
const LUNGE = Object.freeze({
  min: 3.2, max: 5.6, windup: 28, track: 16, active: 10, mv: 1.3, kb: 1.2, recover: 32, cooldown: [5, 7], width: 0.9,
  sword: { dash: 2.4, reach: 1.1 }, halberd: { dash: 1.8, reach: 2.0 },
});

// ---- the looks (atlas frames of evFoesFx.js; one record per effect, its direction written before each play) ----

/** A cut's crescent, flat along the swing. @type {FxOptions} */
const ARC_FX = { mode: 'flat', lift: 0.85, color: [0.75, 1.15, 1.5], loops: 1, scale: 1, dirX: 0, dirZ: 1, flip: false };
/** The armour blown open: ice out of the chest. @type {FxOptions} */
const CORE_FX = { mode: 'billboard', lift: 1.35, color: [0.6, 1.7, 2.2], loops: 1, scale: 1.4, back: -0.3 };
/** The plates closing. @type {FxOptions} */
const SEAL_FX = { mode: 'billboard', lift: 1.35, color: [0.7, 1.2, 1.6], loops: 1, scale: 1.2, back: -0.3 };
/** A cantor's ward under it: the rune ring, flat, following it. @type {FxOptions} */
const WARD_FX = { mode: 'flat', lift: 0.05, color: [0.45, 1.1, 1.5], loop: true, duration: WARD_S, scale: 1.6, dirX: 0, dirZ: 1, follow: undefined };

/** The sounds by name (the composer's lazy pack maps the Evermere names; EVERMERE_CAMPAIGN.md §5.7). */
const SND = Object.freeze({ crack: 'iceCrack', seal: 'hushSeal', hush: 'waysideChime', ping: 'guard', fall: 'iceBreak', windup: 'windup', cut: 'swingHeavy', bash: 'slam', sweep: 'whirl', thrust: 'swing' });

/** @typedef {'sword'|'halberd'} Arms */
/** @typedef {'cut'|'heavy'|'lunge'} HushMove */

/**
 * The arms of a Hushguard: its group's seed (`e.group` — the level object's id and the enemy's
 * index), so a pack mixes them and a reload keeps them. A boss's adds (the King's court) alternate.
 * @param {Enemy} e
 * @returns {Arms}
 */
export function armsOf(e) {
  let h = 2166136261;
  const s = `${e.groupId}:${e.index}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 5) < 2 ? 'halberd' : 'sword';
}

/** sheet → its halberd view (shared by every halberdier of a CombatSystem). @type {WeakMap<object, EnemySheet>} */
const VIEWS = new WeakMap();
/** A view → the sheet it was made from. @type {WeakMap<object, EnemySheet>} */
const BASE = new WeakMap();

/**
 * The halberd's view of a Hushguard sheet: the same texture and cells, its `poses` and its
 * `idle` / `walk` / `run` animations pointing at the `h_` columns (the base names too, so the
 * Enemy's own `hurt`, `dead`, `idle` and `walk` show the halberdier).
 * @param {EnemySheet} base
 * @returns {EnemySheet}
 */
function halberdView(base) {
  let v = VIEWS.get(base);
  if (v) return v;
  const shift = HUSHGUARD_POSES.length;
  /** @type {Record<string, number>} */
  const poses = { ...base.poses };
  for (const n of HUSHGUARD_POSES) poses[n] = base.poses[HALBERD_PREFIX + n];
  /** @type {Record<string, { frames: { col: number, row: number }[], fps: number, loop: boolean }>} */
  const animations = {};
  for (const [k, a] of Object.entries(base.animations)) animations[k] = { ...a, frames: a.frames.map((f) => ({ col: f.col + shift, row: f.row })) };
  v = /** @type {EnemySheet} */ (Object.create(base));
  v.poses = poses;
  v.animations = animations;
  VIEWS.set(base, v);
  BASE.set(v, base);
  return v;
}

/**
 * Show the Hushguard with its arms: the halberdier through the halberd view of the sheet (the
 * sprite's animations resolved again).
 * @param {Enemy} e
 * @param {Arms} arms
 */
function dress(e, arms) {
  const base = BASE.get(e.sheet) ?? e.sheet;
  const want = arms === 'halberd' ? halberdView(base) : base;
  if (e.sheet === want) return;
  e.sheet = want;
  e.sprite.sheet = want;
  e.sprite._resolveCache.clear();
}

/** @typedef {ReturnType<typeof initAI>} HushAI the brain state (`e.ai`) */

/** @param {Enemy} e */
function initAI(e) {
  const arms = armsOf(e);
  return {
    arms,
    move: /** @type {HushMove} */ ('cut'),
    /** Test hook: the next move (null: the brain's choice). */
    force: /** @type {HushMove|null} */ (null),
    second: false,
    cd: F(e.rng.int(20, 60)),
    cdHeavy: e.rng.range(1.5, 3),
    cdLunge: e.rng.range(1, 3),
    tag: 0,
    lx: 0, lz: 1, len: 1,
    /** The core: open until this combat time (−∞: closed). */
    coreEnd: -Infinity,
    coreOpen: false,
    /** Breaks so far (tests). */
    breaks: 0,
    /** Seals so far, and how many of them a cantor's ring made. */
    seals: 0,
    sealsByCantor: 0,
    /** The seal's beat: frames left (0: none). */
    sealF: 0,
    /** The ward lasts until this combat time; its multiplier as last applied. */
    wardEnd: -Infinity,
    wardMul: 1,
    /** Frost motes of the open core: seconds to the next burst. */
    moteT: 0,
    /** The guarded advance's step pose clock. */
    stepT: 0,
    /** A clock for the eyes' breathing (s; advanced by the brain's calls). */
    clock: e.rng.next() * 3,
  };
}

/**
 * The damage multiplier now: the armour or the open core, × the ward while it lasts.
 * @param {Enemy} e @param {HushAI} ai @param {CombatContext} ctx
 */
function applyVuln(e, ai, ctx) {
  ai.wardMul = ctx.time < ai.wardEnd ? WARD : 1;
  e.vuln = (ai.coreOpen ? CORE_VULN : ARMOUR) * ai.wardMul;
  e.exposed = ai.coreOpen;
}

/**
 * Open the core (a break): the burst, the sound, the window.
 * @param {Enemy} e @param {CombatContext} ctx
 */
export function breakCore(e, ctx) {
  const ai = /** @type {HushAI} */ (e.ai);
  if (!e.alive || ai.coreOpen) return;
  ai.coreOpen = true;
  ai.coreEnd = ctx.time + CORE_S;
  ai.breaks++;
  ai.sealF = 0;
  ai.moteT = 0.2;
  applyVuln(e, ai, ctx);
  const p = e.position;
  ctx.fx('evCore', p.x, p.y, p.z, CORE_FX);
  ctx.burst('evFrostBurst', p.x, p.y + 1.35, p.z, 12);
  ctx.sfx(SND.crack, p.x, p.z, { volume: 1 });
  ctx.shake(0.08, 0.15);
}

/**
 * Close the core (its time ran out, or a cantor's ring): the plates seal in rime, poise full.
 * @param {Enemy} e @param {CombatContext} ctx @param {boolean} byCantor
 */
function seal(e, ctx, byCantor) {
  const ai = /** @type {HushAI} */ (e.ai);
  if (!ai.coreOpen) return;
  ai.coreOpen = false;
  ai.coreEnd = -Infinity;
  ai.seals++;
  if (byCantor) ai.sealsByCantor++;
  e.poise = e.poiseMax;
  applyVuln(e, ai, ctx);
  const p = e.position;
  ctx.fx('evSeal', p.x, p.y, p.z, SEAL_FX);
  ctx.burst('evRimePuff', p.x, p.y + 1.3, p.z, 6);
  ctx.sfx(SND.seal, p.x, p.z, { volume: 1, pitch: 1 });
  ctx.sfx(SND.hush, p.x, p.z, { volume: 0.3, pitch: 0.55 });
  // the seal's beat: it stands and closes up (only from its own engage; a stagger runs its course)
  if (e.state === 'engage') ai.sealF = SEAL_F;
}

/**
 * A Hush Cantor's ring on a Hushguard (./cantor.js): a broken one seals at once and takes a ward
 * (× WARD for `seconds`, a rune ring under it). A closed one is left as it is.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} [seconds]
 * @returns {boolean} it was broken and sealed
 */
export function sealHushguard(e, ctx, seconds = WARD_S) {
  if (e.kind !== 'hushguard' || !e.alive) return false;
  const ai = /** @type {HushAI} */ (e.ai);
  if (!ai.coreOpen) return false;
  seal(e, ctx, true);
  ai.wardEnd = ctx.time + seconds;
  applyVuln(e, ai, ctx);
  WARD_FX.follow = e.position;
  WARD_FX.duration = seconds;
  ctx.fx('evWard', e.position.x, e.position.y, e.position.z, WARD_FX);
  WARD_FX.follow = undefined;
  return true;
}

/**
 * Has the core's time run out? Then seal. Every brain call; also keeps the multiplier current.
 * @param {Enemy} e @param {HushAI} ai @param {CombatContext} ctx @param {number} h
 */
function tickCore(e, ai, ctx, h) {
  ai.clock += h;
  if (ai.coreOpen && ctx.time >= ai.coreEnd - EPS) seal(e, ctx, false);
  applyVuln(e, ai, ctx);
  if (ai.coreOpen) {
    ai.moteT -= h;
    if (ai.moteT <= 0) {
      ai.moteT += 0.28;
      ctx.burst('evMotes', e.position.x, e.position.y + 1.35, e.position.z, 2);
    }
  }
}

/**
 * Pick the next move in range (or the forced one).
 * @param {Enemy} e @param {HushAI} ai @param {CombatContext} ctx
 * @returns {HushMove|null}
 */
function pick(e, ai, ctx) {
  const d = e.tp.d;
  const reach = CUT[ai.arms].reach;
  const f = ai.force;
  if (f === 'lunge') return d >= LUNGE.min - 0.6 && d <= LUNGE.max + 1 ? 'lunge' : null;
  if (f === 'cut' || f === 'heavy') return d <= reach + (f === 'heavy' && ai.arms === 'halberd' ? 0.8 : 0) ? f : null;
  if (ai.cdLunge <= 0 && d >= LUNGE.min && d <= LUNGE.max && ctx.los(e.position.x, e.position.z, ctx.player.position.x, ctx.player.position.z)) {
    if (e.rng.chance(0.5)) return 'lunge';
    ai.cdLunge = e.rng.range(1, 2);
  }
  if (ai.cd > 0) return null;
  const heavyReach = ai.arms === 'halberd' ? SWEEP.r - 0.4 : reach;
  if (ai.cdHeavy <= 0 && d <= heavyReach && e.rng.chance(0.35)) return 'heavy';
  if (d <= reach) return 'cut';
  return null;
}

/** @satisfies {Brain} */
export const hushguardBrain = {
  init(e) {
    const ai = initAI(e);
    dress(e, ai.arms);
    e.vuln = ARMOUR;
    return ai;
  },

  /** It stands its post; its head turns to follow Linnet. @type {Brain['idle']} */
  idle(e, h, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    tickCore(e, ai, ctx, h);
    const tp = e.tp;
    const r = ctx.ambient ? LOOK_R_AMBIENT : LOOK_R;
    if (tp.d <= r && tp.d > 0.5) {
      // (the body keeps its facing; the helm turns to her side — straight ahead it just looks)
      const cross = e.facing.x * tp.dz - e.facing.z * tp.dx;
      const dot = e.facing.x * tp.dx + e.facing.z * tp.dz;
      if (dot > 0.87) e.anim('idle');
      else e.pose(cross > 0 ? 'look' : 'lookB');
    } else e.anim('idle');
  },

  /** @type {Brain['engage']} */
  engage(e, h, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    tickCore(e, ai, ctx, h);
    const tp = e.tp;
    const P = ctx.player.position;
    if (ai.cd > 0) ai.cd -= h;
    if (ai.cdHeavy > 0) ai.cdHeavy -= h;
    if (ai.cdLunge > 0) ai.cdLunge -= h;
    // the seal's beat: it straightens, the plates closing
    if (ai.sealF > 0) {
      ai.sealF -= h * 60;
      e.face(P.x, P.z);
      e.pose('seal');
      return;
    }
    // the core open: no attacks — it reels back, a gauntlet to its chest
    if (ai.coreOpen) {
      e.dropToken(ctx);
      ai.stepT += h;
      const fr = e.walk(-tp.dx, -tp.dz, REEL, h, ctx, null, false);
      e.face(P.x, P.z);
      e.pose(fr > 0.2 && Math.floor(ai.stepT * 3) % 2 ? 'reel1' : 'reel0');
      return;
    }
    const reach = e.canMelee(ctx);
    const want = reach && e.canWindup(ctx) ? pick(e, ai, ctx) : null;
    if (want && e.takeToken(ctx)) {
      ai.move = want;
      ai.force = null;
      ai.second = false;
      e.setState('windup');
      return;
    }
    if (tp.d > GUARD_FROM || !reach) {
      e.chase(MARCH, h, ctx, 'walk');
      return;
    }
    // the guarded advance: shield (haft) up, a measured step in
    ai.stepT += h;
    const close = tp.d > CUT[ai.arms].reach - 0.3;
    if (close) e.walk(tp.dx, tp.dz, ADVANCE, h, ctx, null, false);
    e.face(P.x, P.z);
    e.pose(close ? (Math.floor(ai.stepT * 2.6) % 2 ? 'gmove1' : 'gmove0') : 'guard');
  },

  /** @type {Brain['attack']} */
  attack(e, h, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    tickCore(e, ai, ctx, h);
    // (a core opened without a stagger — `breakCore` from outside a hit — breaks off a wind-up:
    // no attack while it is open)
    if (ai.coreOpen && e.state === 'windup') {
      e.unmarkAll(ctx);
      e.dropToken(ctx);
      ai.second = false;
      e.setState('engage');
      return;
    }
    if (ai.move === 'heavy') {
      if (ai.arms === 'halberd') sweep(e, h, ctx);
      else bash(e, h, ctx);
    } else if (ai.move === 'lunge') lunge(e, h, ctx);
    else cut(e, h, ctx);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    ai.second = false;
    ai.sealF = 0;
    // a status hold begins (the Enemy cancels the attack as it enters one: Linnet's Carillon stuns,
    // a freeze): the core shows and takes × CORE_VULN while the hold lasts — its brain is not called
    // in the hold; the next call (`tickCore`) closes it again. Not a break: no window, no cantor's
    // seal. (Review EV-80: no longer written from `glow`, which is read-only.)
    if (ctx && e.alive && !ai.coreOpen && e.statusInfo().stun > 0) {
      e.vuln = CORE_VULN * ai.wardMul;
      e.exposed = true;
    }
  },

  /** The armour rings under a hit; a break opens the core. @type {Brain['onHit']} */
  onHit(e, info, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    const p = e.position;
    if (ai.coreOpen) return;
    const breaks = !e.armored && e.state !== 'stagger' && e.state !== 'stun' && Number.isFinite(e.poiseMax)
      && (e.poise - (info.poise || 0) <= 0 || info.knockdown);
    if (breaks) breakCore(e, ctx);
    else ctx.sfx(SND.ping, p.x, p.z, { volume: 0.32, pitch: 1.25 });
  },

  /** @type {Brain['die']} */
  die(e, ctx) {
    const ai = /** @type {HushAI} */ (e.ai);
    ai.coreOpen = false;
    const p = e.position;
    ctx.burst('evRimePuff', p.x, p.y + 0.9, p.z, 10);
    ctx.burst('evIceChips', p.x, p.y + 1.2, p.z, 10);
    ctx.burst('evFrostBurst', p.x, p.y + 1.35, p.z, 8);
    ctx.sfx(SND.fall, p.x, p.z, { volume: 0.9 });
  },

  /**
   * The eyes in the slit (and the core while open): cyan, brighter as it notices, winds up, breaks.
   * Read-only (it writes `out` only). @type {Brain['glow']}
   */
  glow(e, out) {
    const ai = /** @type {HushAI} */ (e.ai);
    if (!e.alive || !ai) return;
    out[0] = 0.55;
    out[1] = 0.95;
    out[2] = 1.0;
    // (a stunned or frozen Hushguard — a status hold — shows its hurt pose and the core's glow; its
    // multiplier is set as the hold begins, `cancel`)
    const core = ai.coreOpen || e.state === 'stagger' || e.held;
    const base = core ? 2.8 : e.state === 'windup' ? 2.6 : e.aggro ? 2.1 : 1.5;
    out[3] = base + (core ? 0.4 : 0.3) * Math.sin(ai.clock * (core ? 9 : 2.2));
  },
};

// ---------------------------------------------------------------------------------------------
// The moves
// ---------------------------------------------------------------------------------------------

/**
 * The cut (and its rising second cut).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function cut(e, h, ctx) {
  const ai = /** @type {HushAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  const C = CUT[ai.arms];
  if (e.state === 'windup') {
    const dur = ai.second ? CUT.follow : CUT.windup;
    if (e.entered) ctx.sfx(SND.windup, p.x, p.z, { volume: 0.8, pitch: 0.85 });
    e.pose(ai.second ? 'swing2Wind' : 'windup');
    if (e.t < F(dur - CUT.lock) - EPS) {
      e.face(P.x, P.z);
      if (!ai.second && e.tp.d > C.reach - 0.6) e.walk(e.tp.dx, e.tp.dz, C.step, h, ctx, null, false);
    }
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = C.r;
    m.halfAngle = C.half;
    m.dirX = e.facing.x;
    m.dirZ = e.facing.z;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.markToFade(0, ctx, F(8));
      ARC_FX.dirX = ai.lx;
      ARC_FX.dirZ = ai.lz;
      ARC_FX.flip = ai.second;
      ARC_FX.scale = ai.arms === 'halberd' ? 1.25 : 1;
      ctx.fx('evArc', p.x + ai.lx * 0.4, p.y, p.z + ai.lz * 0.4, ARC_FX);
      ctx.sfx(SND.cut, p.x, p.z, { volume: 0.85, pitch: ai.second ? 1.08 : 0.92 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(CUT.active)) {
      if (!ai.second && e.rng.chance(CUT.second)) {
        ai.second = true;
        e.setState('windup');
      } else e.setState('recover');
      return;
    }
    e.pose(ai.second ? 'attack2' : 'attack');
    const v = CUT.lunge / F(CUT.active);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = C.r;
    s.halfAngle = C.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = ai.second ? CUT.mv2 : CUT.mv;
    s.kb = CUT.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose(e.fr < 12 ? (ai.second ? 'attack2' : 'attack') : 'guard');
  if (e.fr >= 12) e.face(P.x, P.z);
  if (e.after(CUT.recover)) {
    e.dropToken(ctx);
    ai.second = false;
    ai.cd = F(e.rng.int(CUT.cooldown[0], CUT.cooldown[1]));
    e.setState('engage');
  }
}

/**
 * The sword's shield bash: drawn back, then driven into the foe.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function bash(e, h, ctx) {
  const ai = /** @type {HushAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.windup, p.x, p.z, { volume: 0.8, pitch: 0.75 });
    e.pose('heavyWind');
    if (e.t < F(BASH.windup - 6) - EPS) e.face(P.x, P.z);
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = e.facing.x;
    m.dirZ = e.facing.z;
    m.len = BASH.len + BASH.shove;
    m.width = BASH.width;
    m.progress = Math.min(1, e.t / F(BASH.windup));
    e.mark(0, ctx, m);
    if (e.after(BASH.windup)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.markToFade(0, ctx, F(8));
      ctx.sfx(SND.bash, p.x, p.z, { volume: 0.6, pitch: 1.2 });
      ctx.burst('evSnowKick', p.x + ai.lx * 0.8, p.y + 0.1, p.z + ai.lz * 0.8, 5);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(BASH.active)) {
      e.setState('recover');
      return;
    }
    e.pose('heavy');
    const v = BASH.shove / F(BASH.active);
    e.move(ai.lx * v * h, ai.lz * v * h, ctx);
    const s = e.hitSpec();
    s.shape = 'lane';
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.len = BASH.len;
    s.width = BASH.width;
    s.mv = BASH.mv;
    s.kb = BASH.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose(e.fr < 14 ? 'heavy' : 'guard');
  if (e.after(BASH.recover)) {
    e.dropToken(ctx);
    ai.cdHeavy = e.rng.range(HEAVY_CD[0], HEAVY_CD[1]);
    ai.cd = F(e.rng.int(30, 60));
    e.setState('engage');
  }
}

/**
 * The halberd's sweep: drawn far back, then swept round across the front.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function sweep(e, h, ctx) {
  const ai = /** @type {HushAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.windup, p.x, p.z, { volume: 0.9, pitch: 0.7 });
    e.pose('heavyWind');
    if (e.t < F(SWEEP.windup - 8) - EPS) e.face(P.x, P.z);
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = SWEEP.r;
    m.halfAngle = SWEEP.half;
    m.dirX = e.facing.x;
    m.dirZ = e.facing.z;
    m.progress = Math.min(1, e.t / F(SWEEP.windup));
    e.mark(0, ctx, m);
    if (e.after(SWEEP.windup)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tag = e.newTag();
      e.markProgress(0, ctx, 1);
      e.markToFade(0, ctx, F(8));
      ARC_FX.dirX = ai.lx;
      ARC_FX.dirZ = ai.lz;
      ARC_FX.flip = false;
      ARC_FX.scale = 1.7;
      ctx.fx('evArc', p.x, p.y, p.z, ARC_FX);
      ctx.sfx(SND.sweep, p.x, p.z, { volume: 0.9, pitch: 0.8 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(SWEEP.active)) {
      e.setState('recover');
      return;
    }
    e.pose('heavy');
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = SWEEP.r;
    s.halfAngle = SWEEP.half;
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.mv = SWEEP.mv;
    s.kb = SWEEP.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose(e.fr < 16 ? 'heavy' : 'guard');
  if (e.after(SWEEP.recover)) {
    e.dropToken(ctx);
    ai.cdHeavy = e.rng.range(HEAVY_CD[0], HEAVY_CD[1]);
    ai.cd = F(e.rng.int(30, 60));
    e.setState('engage');
  }
}

/**
 * The lunge: a tracked, then locked lane; the thrust along it.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function lunge(e, h, ctx) {
  const ai = /** @type {HushAI} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  const L = LUNGE[ai.arms];
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.windup, p.x, p.z, { volume: 0.85, pitch: 1.05 });
    e.pose('lungeWind');
    if (e.t < F(LUNGE.track) - EPS) {
      e.face(P.x, P.z);
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.len = Math.max(0.5, e.freeRun(ai.lx, ai.lz, L.dash, ctx));
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = ai.lx;
    m.dirZ = ai.lz;
    m.len = ai.len + L.reach;
    m.width = LUNGE.width;
    m.progress = Math.min(1, e.t / F(LUNGE.windup));
    m.flash = e.lockFlash(e.t - F(LUNGE.track));
    e.mark(0, ctx, m);
    if (e.after(LUNGE.windup)) {
      e.markProgress(0, ctx, 1);
      ai.tag = e.newTag();
      ctx.burst('evSnowKick', p.x, p.y + 0.1, p.z, 5);
      ctx.sfx(SND.thrust, p.x, p.z, { volume: 0.9, pitch: 0.8 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(LUNGE.active)) {
      e.markToFade(0, ctx, F(10));
      e.setState('recover');
      return;
    }
    e.pose('lunge');
    const step = Math.min(h, F(LUNGE.active) - e.t);
    const v = ai.len / F(LUNGE.active);
    if (step > 0) e.move(ai.lx * v * step, ai.lz * v * step, ctx);
    const s = e.hitSpec();
    s.shape = 'lane';
    s.dirX = ai.lx;
    s.dirZ = ai.lz;
    s.len = L.reach;
    s.width = LUNGE.width;
    s.mv = LUNGE.mv;
    s.kb = LUNGE.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  e.pose(e.fr < 12 ? 'lunge' : 'guard');
  if (e.fr >= 12) e.face(P.x, P.z);
  if (e.after(LUNGE.recover)) {
    e.dropToken(ctx);
    ai.cdLunge = e.rng.range(LUNGE.cooldown[0], LUNGE.cooldown[1]);
    ai.cd = F(e.rng.int(30, 60));
    e.setState('engage');
  }
}

/**
 * Register the Hushguard — and the foes' FX frames and particle presets (one module for the four
 * foes: they register once, here).
 * @param {EnemyPackApi} api
 */
export function register(api) {
  api.registerMonsterKind('hushguard', hushguardSheet);
  api.registerFxModule(evFoesFx);
  api.registerPresets(EV_FOES_PRESETS);
  api.registerBrain('hushguard', hushguardBrain);
}
