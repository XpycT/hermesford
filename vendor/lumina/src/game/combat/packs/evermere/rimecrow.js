/**
 * The Rime Crow (docs/contracts/EVERMERE_CAMPAIGN.md §5.4, §6.6): the King's eyes — a wheeling
 * flier of Saltcombe, Amberfield and Rimeholt (and the Harvest Mawkin's adds). Owner: the foes
 * package (this brain; its sheet src/engine/pixel/monsters/rimecrow.js); registered by ./index.js.
 *
 * **Its flight** is the Cinder Bat's (src/game/combat/ai/bat.js, a neutral brain borrowed through
 * the pack API): slow circles round its home while idle, wheeling round its target at 3–4 u when
 * engaged, and the **diving peck** — an 18 f wind-up (the caw, the wings flung up, a circle marker at
 * the target's feet), a dive straight through it (mv 1.0, kb 0.4), the climb back. The bat's screech
 * is the crow's caw here (the borrowed brain runs on a view of the context whose `sfx` maps it).
 *
 * Its own move — the **ice-shard spit** (3 ≤ d ≤ 8, line of sight, cooldown 3–5 s, the crow's
 * token): a 22 f wind-up (`spitWind`: the head drawn back, a glint of ice in the beak; a lane marker
 * from the crow to the target tracking 14 f, locked 8 f), then the shard (`evShard`, 11 u/s, range
 * 10, mv 0.8, kb 0.3; ice chips where it breaks) and 12 f of `spit`; recover 20 f.
 *
 * It dies in a burst of black feathers and rime (`evFeathers`, `evRimePuff`) and falls (the bat's
 * fall, the Enemy's).
 *
 * Test hook: `e.ai.force` = 'dive' | 'spit' makes that move the next one (cooldowns ignored).
 *
 * @import { Enemy } from '../../Enemy.js'
 * @import { Brain, CombatContext, ProjectileLook } from '../../types.js'
 * @import { EnemyPackApi } from '../index.js'
 * @import { SfxName } from '../../../../engine/audio/AudioSystem.js'
 */
import { rimecrow as rimecrowSheet } from '../../../../engine/pixel/monsters/rimecrow.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;

const SPIT = Object.freeze({ min: 3, max: 8, windup: 22, track: 14, pose: 12, recover: 20, speed: 11, range: 10, radius: 0.25,
  mv: 0.8, kb: 0.3, cooldown: [3, 5], width: 0.6 });

/** The shard in flight (an atlas frame of evFoesFx.js, flat along the flight; kept by reference). @type {ProjectileLook} */
const SHARD = Object.freeze({
  frame: 'evShard', mode: 'flat', color: [0.6, 1.2, 1.6], scale: 1.1, rot: 0,
  trail: null, hitBurst: 'evIceChips', hitCount: 6, hitSfx: 'iceCrack', hitVolume: 0.5, hitPitch: 1.6,
  fadeBurst: 'evIceChips', fadeCount: 3,
});

/** The sounds by name (EVERMERE_CAMPAIGN.md §5.7). */
const SND = Object.freeze({ caw: 'crowCaw', spit: 'shardSpit', die: 'crowCaw' });

/** The bat's names → the crow's. @type {Readonly<Record<string, SfxName>>} */
const SFX_AS = Object.freeze({ batScreech: SND.caw });

/** real context → the crow's view of it. @type {WeakMap<CombatContext, CombatContext>} */
const VIEWS = new WeakMap();

/**
 * The context as the borrowed flight brain sees it: the bat's screech is the crow's caw.
 * @param {CombatContext} ctx
 * @returns {CombatContext}
 */
function crowView(ctx) {
  let v = VIEWS.get(ctx);
  if (v) return v;
  v = /** @type {CombatContext} */ (Object.create(ctx));
  v.sfx = (name, x, z, opts) => ctx.sfx(Object.hasOwn(SFX_AS, name) ? SFX_AS[name] : name, x, z, opts);
  VIEWS.set(ctx, v);
  return v;
}

/** @typedef {'dive'|'spit'} CrowMove */

/**
 * The Rime Crow's brain over a borrowed flight brain (the bat's).
 * @param {Brain} flight
 * @returns {Brain}
 */
export function makeRimecrowBrain(flight) {
  /** @param {Enemy} e */
  const AI = (e) => /** @type {any} */ (e.ai);
  return {
    init(e) {
      return {
        ...flight.init(e),
        move: /** @type {CrowMove} */ ('dive'),
        spitCd: e.rng.range(1.5, 3.5),
        aimX: 0, aimZ: 1, len: 1,
        /** Test hook: the next move (null: the brain's own). */
        force: /** @type {CrowMove|null} */ (null),
      };
    },

    /** @type {Brain['idle']} */
    idle(e, h, ctx) {
      flight.idle(e, h, crowView(ctx));
    },

    /** @type {Brain['engage']} */
    engage(e, h, ctx) {
      const ai = AI(e);
      const tp = e.tp;
      const P = ctx.player.position;
      if (ai.spitCd > 0) ai.spitCd -= h;
      const f = ai.force;
      if (f === 'dive') ai.cd = 0;
      const spit = f === 'spit' || (ai.spitCd <= 0 && f !== 'dive');
      if (spit && tp.d >= SPIT.min && tp.d <= SPIT.max && e.canWindup(ctx) && ctx.los(e.position.x, e.position.z, P.x, P.z) && e.takeToken(ctx)) {
        ai.move = 'spit';
        ai.force = null;
        e.setState('windup');
        return;
      }
      flight.engage(e, h, crowView(ctx));
      if (e.state === 'windup') {
        ai.move = 'dive';
        if (f === 'dive') ai.force = null;
      }
    },

    /** @type {Brain['attack']} */
    attack(e, h, ctx) {
      if (AI(e).move === 'spit') spitAttack(e, h, ctx);
      else flight.attack(e, h, crowView(ctx));
    },

    /** @type {Brain['cancel']} */
    cancel(e, ctx) {
      flight.cancel?.(e, ctx);
    },

    /** @type {Brain['die']} */
    die(e, ctx) {
      const p = e.position;
      const y = p.y + e.hover;
      ctx.burst('evFeathers', p.x, y, p.z, 12);
      ctx.burst('evRimePuff', p.x, y, p.z, 4);
      ctx.sfx(SND.die, p.x, p.z, { volume: 0.7, pitch: 0.75 });
    },

    /** The ice-pale eyes. @type {Brain['glow']} */
    glow(e, out) {
      if (!e.alive) return;
      out[0] = 0.6;
      out[1] = 0.92;
      out[2] = 1.0;
      out[3] = e.state === 'windup' ? 2.8 : 1.8;
    },
  };
}

/**
 * The spit: the head drawn back on a lane marker, then the shard.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function spitAttack(e, h, ctx) {
  const ai = /** @type {any} */ (e.ai);
  const P = ctx.player.position;
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) ctx.sfx(SND.caw, p.x, p.z, { volume: 0.8, pitch: 1.2 });
    e.pose('spitWind');
    if (e.t < F(SPIT.track) - EPS) {
      e.face(P.x, P.z);
      ai.aimX = e.facing.x;
      ai.aimZ = e.facing.z;
      ai.len = Math.min(SPIT.range, e.tp.d + 1);
    }
    const m = e.markerSpec('lane', p.x, p.z);
    m.dirX = ai.aimX;
    m.dirZ = ai.aimZ;
    m.len = ai.len;
    m.width = SPIT.width;
    m.progress = Math.min(1, e.t / F(SPIT.windup));
    m.flash = e.lockFlash(e.t - F(SPIT.track));
    e.mark(0, ctx, m);
    if (e.after(SPIT.windup)) {
      e.markProgress(0, ctx, 1);
      e.markToFade(0, ctx, F(14));
      const s = e.projSpec();
      s.kind = 'arrow';
      s.x = p.x + ai.aimX * 0.5;
      s.y = p.y + e.hover;
      s.z = p.z + ai.aimZ * 0.5;
      s.dirX = ai.aimX;
      s.dirZ = ai.aimZ;
      // (from its hover down to the target's chest over the flight)
      const t = ai.len / SPIT.speed;
      s.vy = (P.y + 1.0 - s.y) / Math.max(0.2, t);
      s.speed = SPIT.speed;
      s.range = SPIT.range;
      s.radius = SPIT.radius;
      s.mv = SPIT.mv;
      s.kb = SPIT.kb;
      s.look = SHARD;
      ctx.projectile(e, s);
      ctx.sfx(SND.spit, p.x, p.z, { volume: 1, pitch: 1 });
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    e.pose('spit');
    if (e.after(SPIT.pose)) e.setState('recover');
    return;
  }
  e.anim('walk');
  if (e.after(SPIT.recover)) {
    e.dropToken(ctx);
    ai.spitCd = e.rng.range(SPIT.cooldown[0], SPIT.cooldown[1]);
    e.setState('engage');
  }
}

/** @param {EnemyPackApi} api */
export function register(api) {
  api.registerMonsterKind('rimecrow', rimecrowSheet);
  const flight = api.brain('bat');
  if (flight) api.registerBrain('rimecrow', makeRimecrowBrain(flight));
}
