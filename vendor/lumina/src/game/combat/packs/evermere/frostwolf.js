/**
 * The Frost Wolf (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): the packs of the Blossomwood and
 * Rimeholt. Owner: the foes package (this brain; its sheet src/engine/pixel/monsters/frostwolf.js);
 * registered by ./index.js.
 *
 * **The pack** is the Scalekin Skirmisher's (src/game/combat/ai/kobold.js, a neutral brain borrowed
 * through the pack API): each wolf takes a place round its target — the pack fans out and circles,
 * holds its ring growling (`guard` / `guard2`), takes turns on the attack tokens, flankers strike
 * sooner, and after a strike a wolf darts back out. Its *jab* is the wolf's **bite** (a 20 f coil,
 * the snap: lane 1.75 × 0.55, mv 0.85) and its *lunge* the **pounce** (a 32 f crouch with a lane
 * marker tracking, then locked; a leap of 12 f along it, off the ground, mv 1.25, kb 1.0). The
 * kobold's sounds and effects are the wolf's here: its brain runs on a view of the combat context
 * whose `sfx` / `fx` / `burst` map the kobold's names to the wolf's (a snarl, the snap `evBite`,
 * kicked-up snow) — so no sound or effect of Vanquish's is asked for.
 *
 * Its own moves:
 *  - **Frost breath** (1.8 ≤ d ≤ 4, line of sight, 35 % a check, cooldown 7–10 s; a melee token):
 *    reared back 30 f (`breathWind`, a sector marker r 3.6 ±28° tracking 18 f, locked 12 f), then
 *    30 f of breath (`breath`): the frost fan `evBreath` on the ground and mist pouring down the
 *    cone, a hit with a fresh tag every 10 f (mv 0.4, kb 0.3: three for one who stays). It chills
 *    nothing — the party takes no status (KNOWN_ISSUES VQ-02); recover 24 f.
 *  - **The howl** (once a fight: the pack's first wolf 1.5–3 s after it engages; any other below
 *    half its HP, 30 %): it stops, raises its muzzle (`howl`, 40 f; `wolfHowl`, a breath plume and
 *    `evRing`) — and the pack is pulled in: every wolf within 14 u wakes, presses its ring 30 %
 *    closer for 6 s and is ready to strike at once. Not an attack (no wind-up state, no hit).
 *
 * Test hook: `e.ai.force` = 'bite' | 'pounce' | 'breath' | 'howl' makes that move the next one as
 * soon as its range allows (cooldowns ignored).
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { Brain, CombatContext, FxOptions } from '../../types.js'
 * @import { EnemyPackApi } from '../index.js'
 * @import { SfxName } from '../../../../engine/audio/AudioSystem.js'
 */
import { frostwolf as frostwolfSheet } from '../../../../engine/pixel/monsters/frostwolf.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

const BREATH = Object.freeze({ min: 1.8, max: 4.0, chance: 0.35, windup: 30, track: 18, active: 30, every: 10, r: 3.6, half: 28,
  mv: 0.4, kb: 0.3, recover: 24, cooldown: [7, 10] });
const HOWL = Object.freeze({ frames: 40, reach: 14, press: 0.7, pressS: 6, leaderAt: [1.5, 3], hurtChance: 0.3 });
/**
 * The target cut off from the wolf's ring (review EV-23): on another level — more than a step up or
 * down (`dy`, u: a ledge, the stair's foot) — or across ground it cannot walk (water, a wall: the walk
 * grid's straight way shut), checked within `near` u of its ring every `every` frames.
 */
const CUT = Object.freeze({ dy: 0.6, near: 2, every: 8 });
/** The pounce's leap: its height (u) over the dash. */
const LEAP = 0.55;

// ---- the looks ----

/** The snap of the bite (billboard, at the jaws). @type {FxOptions} */
const BITE_FX = { mode: 'billboard', lift: 0.55, color: [0.8, 1.2, 1.5], loops: 1, scale: 0.9 };
/** The frost breath's fan on the ground (the jaws at the frame's bottom centre). @type {FxOptions} */
const BREATH_FX = { mode: 'flat', lift: 0.3, color: [0.6, 0.95, 1.25], loops: 2, fps: 12, scale: 1.4, dirX: 0, dirZ: 1 };
/** The breath frame's centre ahead of the jaws: its half length. */
const BREATH_AHEAD = 0.55 + (40 * 1.4) / 16 / 2;
/** The howl made visible over the muzzle. @type {FxOptions} */
const HOWL_FX = { mode: 'billboard', lift: 1.5, color: [0.7, 1.15, 1.5], loops: 2, scale: 1.1 };
/** The mist of the breath: its velocity down the cone (written per burst). */
const MIST = { velocity: [0, 0.1, 0] };

/** The sounds by name (the Evermere names: the composer's pack; EVERMERE_CAMPAIGN.md §5.7). */
const SND = Object.freeze({ snarl: 'wolfSnarl', howl: 'wolfHowl', breath: 'frostBreath' });

/**
 * The kobold's names → the wolf's (the brain it borrows asks for them), at the volume and pitch given
 * here (the composer's level: 1, 1) — the kobold's own options only where these leave one out.
 * @type {Readonly<Record<string, { name: SfxName, pitch?: number, volume?: number }>>}
 */
const SFX_AS = Object.freeze({ yip: { name: SND.snarl, pitch: 1, volume: 1 } });
/** @type {Readonly<Record<string, string>>} */
const BURST_AS = Object.freeze({ swarmDust: 'evSnowKick' });
/** @type {Readonly<Record<string, string>>} */
const FX_AS = Object.freeze({ thrust: 'evBite' });

/** real context → the wolf's view of it. @type {WeakMap<CombatContext, CombatContext>} */
const VIEWS = new WeakMap();
/** Reused sound options. */
const SFX_OPTS = { volume: 1, pitch: 1 };

/**
 * The combat context as the borrowed brain sees it: every member the context's (its live fields —
 * `player`, `time`, `frame`, `ambient` — read through), the kobold's sounds, effects and bursts
 * swapped for the wolf's.
 * @param {CombatContext} ctx
 * @returns {CombatContext}
 */
function wolfView(ctx) {
  let v = VIEWS.get(ctx);
  if (v) return v;
  v = /** @type {CombatContext} */ (Object.create(ctx));
  v.sfx = (name, x, z, opts) => {
    const as = Object.hasOwn(SFX_AS, name) ? SFX_AS[name] : null;
    if (!as) return ctx.sfx(name, x, z, opts);
    SFX_OPTS.volume = as.volume ?? opts?.volume ?? 1;
    SFX_OPTS.pitch = as.pitch ?? opts?.pitch ?? 1;
    return ctx.sfx(as.name, x, z, SFX_OPTS);
  };
  v.burst = (preset, x, y, z, count, opts) => ctx.burst(Object.hasOwn(BURST_AS, preset) ? BURST_AS[preset] : preset, x, y, z, count, opts);
  v.fx = (name, x, y, z, opts) => (Object.hasOwn(FX_AS, name) ? ctx.fx(FX_AS[name], x, y, z, BITE_FX) : ctx.fx(name, x, y, z, opts));
  VIEWS.set(ctx, v);
  return v;
}

/** @typedef {'bite'|'pounce'|'breath'|'howl'} WolfMove */

/**
 * The Frost Wolf's brain over a borrowed pack brain (the kobold's).
 * @param {Brain} pack
 * @returns {Brain}
 */
export function makeFrostwolfBrain(pack) {
  /** @param {Enemy} e */
  const AI = (e) => /** @type {any} */ (e.ai);
  return {
    init(e) {
      const base = pack.init(e);
      return {
        ...base,
        breathCd: e.rng.range(3, 6),
        breathCheck: 0,
        howled: false,
        howlAt: Infinity,
        howlF: -1,
        /** The pack pressed in until this combat time (its ring × HOWL.press). */
        pressEnd: -Infinity,
        ring0: base.ring,
        /** Test hook: the next move (null: the brain's own). */
        force: /** @type {WolfMove|null} */ (null),
        tick: 0,
        engaged: false,
        /** Its target cut off from its ring (`cutOff`), and the frame of the next check. */
        cut: false,
        cutAt: 0,
      };
    },

    /** @type {Brain['engage']} */
    engage(e, h, ctx) {
      const ai = AI(e);
      const tp = e.tp;
      const P = ctx.player.position;
      const p = e.position;
      if (ai.breathCd > 0) ai.breathCd -= h;
      if (!ai.engaged) {
        ai.engaged = true;
        if (e.index === 0 && !ai.howled) ai.howlAt = ctx.time + e.rng.range(HOWL.leaderAt[0], HOWL.leaderAt[1]);
      }
      // pressed in by a howl: the ring closer, back to its own after
      ai.ring = ctx.time < ai.pressEnd ? ai.ring0 * HOWL.press : ai.ring0;
      // the howl in progress (a stand, not an attack)
      if (ai.howlF >= 0) {
        ai.howlF += h * 60;
        e.face(P.x, P.z);
        e.pose('howl');
        if (ai.howlF >= 10 && ai.howlF - h * 60 < 10) {
          ctx.sfx(SND.howl, p.x, p.z, { volume: 1 });
          ctx.fx('evRing', p.x - e.facing.x * 0.3, p.y, p.z - e.facing.z * 0.3, HOWL_FX);
          ctx.burst('evRimePuff', p.x + e.facing.x * 0.6, p.y + 1.1, p.z + e.facing.z * 0.6, 4);
        }
        if (ai.howlF >= HOWL.frames) {
          ai.howlF = -1;
          rally(e, ctx);
        }
        return;
      }
      const f = ai.force;
      if (!ai.howled && (f === 'howl' || ctx.time >= ai.howlAt)) {
        ai.howled = true;
        ai.force = null;
        ai.howlF = 0;
        e.dropToken(ctx);
        return;
      }
      // its target cut off from its ring (a ledge above, the stair's foot below, the far bank): it
      // holds no ring there and breathes nothing across — it comes round by the walk grid, or, with no
      // way within its chase's reach, gives up and goes home (the Enemy's `unreachable`)
      if (f !== 'pounce' && f !== 'breath' && cutOff(e, ai, ctx)) {
        if (e.token) e.dropToken(ctx);
        ai.closing = 0;
        e.chase(e.def.speed, h, ctx, 'run');
        return;
      }
      // the frost breath (its own; the bite and the pounce are the pack brain's)
      ai.breathCheck -= h;
      const inBreath = tp.d >= BREATH.min && tp.d <= BREATH.max;
      if (inBreath && (f === 'breath' || (ai.breathCd <= 0 && ai.breathCheck <= 0)) && e.canWindup(ctx) && e.canMelee(ctx)
        && ctx.los(p.x, p.z, P.x, P.z)) {
        ai.breathCheck = 0.5;
        if ((f === 'breath' || e.rng.chance(BREATH.chance)) && e.takeToken(ctx)) {
          ai.move = 'breath';
          ai.force = null;
          ai.closing = 0;
          e.setState('windup');
          return;
        }
      }
      // forced pack moves: the pounce from the outer ring, the bite from close
      if (f === 'pounce') {
        ai.cdL = 0;
        if (tp.d >= 3.4 && tp.d <= 5 && e.canWindup(ctx) && e.takeToken(ctx)) {
          ai.force = null;
          ai.move = 'lunge';
          e.setState('windup');
          return;
        }
      } else if (f === 'bite') {
        ai.cd = 0;
        ai.cdL = 1;
        if (e.state === 'engage' && ai.closing > 0) ai.force = null;
      }
      pack.engage(e, h, wolfView(ctx));
      if (f === 'bite' && e.state === 'windup') ai.force = null;
    },

    /** @type {Brain['attack']} */
    attack(e, h, ctx) {
      const ai = AI(e);
      if (ai.move === 'breath') {
        breath(e, h, ctx);
        return;
      }
      pack.attack(e, h, wolfView(ctx));
      // the pounce leaves the ground: an arc over the dash
      if (ai.move === 'lunge') {
        if (e.state === 'active') e.lift = LEAP * Math.sin(Math.PI * Math.min(1, e.t / F(12)));
        else e.lift = 0;
        if (e.state === 'recover' && e.entered) ctx.burst('evSnowKick', e.position.x, e.position.y + 0.1, e.position.z, 6);
      }
    },

    /** @type {Brain['cancel']} */
    cancel(e, ctx) {
      const ai = AI(e);
      pack.cancel?.(e, ctx);
      ai.howlF = -1;
      ai.tick = 0;
      e.lift = 0;
    },

    /** @type {Brain['onHit']} */
    onHit(e, info, ctx) {
      const ai = AI(e);
      // (a wolf bleeding out howls for its pack, now and then)
      if (!ai.howled && e.hp < e.hpMax * 0.5 && e.rng.chance(HOWL.hurtChance)) ai.howlAt = ctx.time + 0.4;
      pack.onHit?.(e, info, ctx);
    },

    /** @type {Brain['die']} */
    die(e, ctx) {
      const p = e.position;
      ctx.burst('evRimePuff', p.x, p.y + 0.5, p.z, 6);
      ctx.burst('evSnowKick', p.x, p.y + 0.1, p.z, 6);
    },

    /** The ice-pale eyes, brighter as it strikes. @type {Brain['glow']} */
    glow(e, out) {
      if (!e.alive) return;
      out[0] = 0.6;
      out[1] = 0.9;
      out[2] = 1.0;
      out[3] = e.state === 'windup' || e.state === 'active' ? 2.6 : e.aggro ? 1.8 : 1.2;
    },
  };
}

/**
 * Is the wolf's target cut off from its ring (`CUT`)? Near its ring only (the pack's approach from
 * afar already chases by the walk grid when the level differs); re-checked every `CUT.every` frames.
 * @param {Enemy} e @param {any} ai @param {CombatContext} ctx
 * @returns {boolean}
 */
function cutOff(e, ai, ctx) {
  const nav = ctx.nav;
  if (!nav || e.tp.d > ai.ring + CUT.near) {
    ai.cut = false;
    return false;
  }
  const f = ctx.frame;
  if (f >= ai.cutAt || f < ai.cutAt - CUT.every) {
    ai.cutAt = f + CUT.every;
    const P = ctx.player.position;
    const p = e.position;
    ai.cut = Math.abs(e.tp.dy) > CUT.dy || !nav.lineClear(p.x, p.z, P.x, P.z, 0.3);
  }
  return ai.cut;
}

/**
 * The howl's call: every frost wolf within reach wakes and presses in, ready to strike.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function rally(e, ctx) {
  const near = /** @type {Enemy[]} */ ([]);
  ctx.enemiesNear(e.position.x, e.position.z, HOWL.reach, near);
  for (const o of near) {
    if (o.kind !== 'frostwolf' || !o.alive) continue;
    const ai = /** @type {any} */ (o.ai);
    ai.pressEnd = ctx.time + HOWL.pressS;
    ai.cd = Math.min(ai.cd ?? 0, F(10));
    if (o !== e) o.wake(ctx);
  }
}

/**
 * The frost breath: reared back with a cone marker, then the fan of frost.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function breath(e, h, ctx) {
  const ai = /** @type {any} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.snarl, p.x, p.z, { volume: 1, pitch: 1 });
    e.pose('breathWind');
    if (e.t < F(BREATH.track) - EPS) e.face(P.x, P.z);
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = BREATH.r;
    m.halfAngle = BREATH.half;
    m.dirX = e.facing.x;
    m.dirZ = e.facing.z;
    m.progress = Math.min(1, e.t / F(BREATH.windup));
    m.flash = e.lockFlash(e.t - F(BREATH.track));
    e.mark(0, ctx, m);
    if (e.after(BREATH.windup)) {
      ai.lx = e.facing.x;
      ai.lz = e.facing.z;
      ai.tick = 0;
      e.markProgress(0, ctx, 1);
      ctx.sfx(SND.breath, p.x, p.z, { volume: 1, pitch: 1 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    if (e.after(BREATH.active)) {
      e.markToFade(0, ctx, F(8));
      e.setState('recover');
      return;
    }
    e.pose('breath');
    const fr = e.fr;
    if (fr >= ai.tick * BREATH.every) {
      // the fan (played again each tick: it stops with the breath), a fresh hit, mist down the cone
      ai.tick++;
      BREATH_FX.dirX = ai.lx;
      BREATH_FX.dirZ = ai.lz;
      ctx.fx('evBreath', p.x + ai.lx * BREATH_AHEAD, p.y, p.z + ai.lz * BREATH_AHEAD, BREATH_FX);
      const s = e.hitSpec();
      s.shape = 'sector';
      s.r = BREATH.r;
      s.halfAngle = BREATH.half;
      s.dirX = ai.lx;
      s.dirZ = ai.lz;
      s.mv = BREATH.mv;
      s.kb = BREATH.kb;
      s.tag = e.newTag();
      ctx.hitbox(e, s);
    }
    if (fr % 5 === 0) {
      MIST.velocity[0] = ai.lx * 3.2;
      MIST.velocity[2] = ai.lz * 3.2;
      ctx.burst('evBreathMist', p.x + ai.lx * 0.7, p.y + 0.55, p.z + ai.lz * 0.7, 2, MIST);
    }
    return;
  }
  e.pose(e.fr < 10 ? 'breath' : 'guard');
  if (e.after(BREATH.recover)) {
    e.dropToken(ctx);
    ai.breathCd = e.rng.range(BREATH.cooldown[0], BREATH.cooldown[1]);
    ai.cd = Math.max(ai.cd ?? 0, F(40));
    e.setState('engage');
  }
}

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerMonsterKind('frostwolf', frostwolfSheet);
  const pack = api.brain('kobold');
  if (pack) api.registerBrain('frostwolf', makeFrostwolfBrain(pack));
}
