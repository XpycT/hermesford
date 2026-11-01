import { RNG, hashString, COMBAT_SFX_NAMES } from '../../engine/index.js';
import { FX_NAMES } from './CombatFx.js';
import { PICKUP_KINDS } from './Pickups.js';
import { PROJECTILE_KINDS } from './Projectiles.js';
import { LEVEL_CAP, SP_MAX, POTION_MAX } from './rules.js';
import { ALLY } from '../party/rules.js';

/**
 * @import { CombatHooks, MarkerShape, MarkerStyle } from './types.js'
 * @import { Enemy } from './Enemy.js'
 * @import { CombatSystem } from './CombatSystem.js'
 */

/**
 * `window.__game.combat` (COMBAT.md §20.1): test control of a combat level. Every hook works in
 * real time and in stepped mode (`step(n)` drives `engine.step(1/60)` with the loop stopped, so
 * a scripted sequence is exactly repeatable: `seed(n); reset()` gives the same state every time).
 * Virtual presses obey the resume / respawn guards like real input.
 * @param {CombatSystem} sys
 * @returns {CombatHooks}
 */
export function makeHooks(sys) {
  /** @type {(uid: string) => Enemy|null} */
  const byUid = (uid) => sys.enemies.find((e) => e.uid === uid) ?? null;
  /** @type {(e: Enemy) => boolean} not hidden: a pooled, unspawned add or a foe the story took away */
  const visible = (e) => !sys._hidden.has(e);
  /** @type {(e: Enemy) => boolean} in play: not of a group the story has taken away */
  const inPlay = (e) => !sys._absent.has(e);
  /** @type {(uid: string, fn: (e: Enemy) => void) => boolean} `fn` on one enemy or on 'all' */
  const each = (uid, fn) => {
    if (uid === 'all') {
      for (const e of sys.enemies) if (visible(e)) fn(e);
      return true;
    }
    const e = byUid(uid);
    if (e) fn(e);
    return !!e;
  };
  /** @type {(id: string) => import('../party/MemberCombat.js').MemberCombat|null} a companion by member id or name */
  const byAlly = (id) => {
    const s = String(id ?? '').trim().toLowerCase();
    return sys.allies.find((a) => a.id === id) ?? sys.allies.find((a) => a.id.toLowerCase() === s || a.member.name.toLowerCase() === s) ?? null;
  };
  const boss = () => sys._boss;
  /** The boss, unless the story has taken its group away (the control hooks leave it alone then). */
  const presentBoss = () => (sys._boss && !sys._absent.has(sys._boss) ? sys._boss : null);
  /** Stop a running death screen (its generation ends; it will not reset again) and hide it. */
  const endDeathScreen = () => {
    if (sys._respawning) {
      sys._deathGen++;
      sys._respawning = false;
      sys.game.busy = false;
    }
    sys.ui.combat?.death.hide();
  };

  /** @type {CombatHooks} */
  const hooks = {
    /** CombatState (§20.2). */
    state: () => sys.state(),

    /** Reseed: the combat RNG, every enemy RNG and the loot seed. */
    seed(n) {
      const s = Number(n) >>> 0;
      sys.seedValue = s;
      sys.rng = new RNG(s);
      for (const e of sys.enemies) e.rng = new RNG((hashString(e.uid) ^ s) >>> 0);
      for (const a of sys.allies) a.reseed(s);
      return s;
    },

    /** Full reset to a reproducible state (§20.1). Chests stay as they are. */
    reset() {
      const ctx = sys.ctx;
      const s = sys.seedValue;
      sys.rng = new RNG(s);
      for (const e of sys.enemies) {
        e.rng = new RNG((hashString(e.uid) ^ s) >>> 0);
        e.deathCount = 0;
        e.sprite.mesh.position.x = 0;
        e._barT = -Infinity;
        e._refillFrom = 0;
        if (e.isAdd) {
          e.reset(ctx);
          sys._hideAdd(e);
        } else e.reset(ctx);
      }
      // (a group the story has taken away stays away)
      for (const e of sys._absent) sys._hideAdd(e);
      sys.bossDefeated = false;
      sys._resetBoss();
      if (sys._map) for (const m of sys._bossMarkers) if (!sys._map.markers.includes(m)) sys._map.markers.push(m);
      sys._tokens.melee = 0;
      sys._tokens.ranged = 0;
      sys.projectiles.clear();
      sys._freeMarkersOf(null);
      sys.pickups.clear();
      sys.fx.clear();
      sys.tags.clear();
      sys.playerHits.clear();
      sys.enemyHits.clear();
      sys._contactN = 0;
      sys.targeting.reset();
      sys.stop = 0;
      sys._slow = 0;
      sys.playerScale = 1;
      sys.enemyScale = 1;
      sys._stopVictims.length = 0;
      sys.look.reset();
      sys.cin.reset();
      sys.kills = 0;
      sys.tutorial.combo = false;
      sys.tutorial.dodge = false;
      sys.tutorial.rewarded = false;
      sys.purchased.clear();
      sys.clock = 0;
      sys.frame = 0;
      sys.enemyTime = 0;
      sys.stepNo = 1;
      sys.ctx.time = 0;
      sys.ctx.frame = 0;
      sys.setEngaged(false);
      sys._timers.length = 0;
      sys._deathT = -1;
      endDeathScreen();
      sys.locksPlayer = false;
      sys._fightTime = 0;
      sys._phaseTimes = [0, 0, 0];
      sys._levelAfterResults = null;
      // the set pieces as at load (§29): wards gone, the intros on appearing and swarms armed again,
      // the focus boss the first
      sys._wards.length = 0;
      // (§30: no release pending, the packs' systems from the start)
      sys._releaseAsk.length = 0;
      for (const s of sys.systems) s.reset?.();
      sys._goldFeed = 0;
      sys._goldFeedT = 0;
      sys._goldFeedAge = 0;
      sys._boss = sys._bosses[0] ?? null;
      sys._armSetPieces();
      sys.music.reset();
      // (the level's own track: its `environment.soundtrack`, else Emberfall's — CombatMusic.tracks)
      const track = sys.music.tracks.emberfall;
      if (sys.audio.musicPlaying && sys.audio.musicTrack !== track) sys.audio.startMusic({ track, fade: 1.5 });
      sys.waystones.reset();
      sys.pc.reset();
      sys.player.sprite.mesh.position.x = 0;
      sys.player.sprite.mesh.visible = true;
      sys.ui.combat?.labels.clear();
      sys.ui.combat?.announcer.clear?.();
      sys._barOf?.fill(null);
      sys._edgeOf?.fill(null);
      // the party's companions: full, no kills or counters, their RNGs from the seed (PARTY.md §8)
      sys.allyHits.clear();
      for (const a of sys.allies) a.reset();
      return sys.state();
    },

    /** Stop the loop, advance n engine frames of `dt`, restart it if it was running. */
    step(n = 1, dt = 1 / 60) {
      const eng = sys.engine;
      const was = eng.running;
      eng.stop();
      for (let i = 0; i < Math.max(0, n | 0); i++) eng.step(dt);
      if (was) eng.start();
      return sys.state();
    },

    /**
     * Step one engine frame at a time until `pred(hooks)` is true, at most `maxFrames` frames
     * (hit-stop freezes whole sub-steps, so an action's length in frames is not its table length:
     * wait for a state, not a count — KNOWN_ISSUES COMBAT-04).
     * @param {(hooks: CombatHooks) => boolean} pred
     * @param {number} [maxFrames]
     * @param {number} [dt]
     * @returns {number} frames stepped when `pred` held (0: at once), −1 if it never did
     */
    stepUntil(pred, maxFrames = 600, dt = 1 / 60) {
      const eng = sys.engine;
      const was = eng.running;
      eng.stop();
      let n = -1;
      const max = Math.max(0, maxFrames | 0);
      for (let i = 0; i <= max; i++) {
        if (pred(hooks)) {
          n = i;
          break;
        }
        if (i < max) eng.step(dt);
      }
      if (was) eng.start();
      return n;
    },

    /** A virtual press (one edge, held `frames` engine frames). */
    press: (action, frames = 1) => sys.cin.press(action, frames),
    /** A virtual hold (e.g. `hold('lock', 30)` releases the lock). */
    hold: (action, frames = 30) => sys.cin.press(action, frames),

    /** World-space move vector for the player (null: real input again). */
    move(x, z) {
      sys.player.moveOverride = x === null || x === undefined ? null : { x: Number(x), z: Number(z) };
      return sys.player.moveOverride;
    },

    /** Aim-point override, like the mouse (null: off). */
    aim(x, z) {
      sys.aimOverride = x === null || x === undefined ? null : { x: Number(x), z: Number(z) };
      return sys.aimOverride;
    },

    /** Move an enemy (and its home) to (x, z). */
    place(uid, x, z) {
      return each(uid, (e) => {
        e.home.x = Number(x);
        e.home.z = Number(z);
        e.position.set(e.home.x, sys.groundAt(e.home.x, e.home.z), e.home.z);
      });
    },

    /** Force aggro (not a foe the story has taken away). */
    wake: (uid) => each(uid, (e) => {
      if (!e.alive || !inPlay(e)) return;
      e.dormant = false;
      e.wake(sys.ctx);
    }),

    /** Kill through the normal path (XP, loot, events); not a foe the story has taken away. */
    kill: (uid) => each(uid, (e) => {
      if (!e.alive || !inPlay(e)) return;
      e.hp = 0;
      sys._kill(e);
    }),

    /** Deal `n` damage (no RNG, no floors); a kill takes the normal path. Not a foe the story took away. */
    damage(uid, n) {
      return each(uid, (e) => {
        if (!e.alive || !inPlay(e)) return;
        const d = Math.max(0, Math.round(Number(n) || 0));
        e.hp = Math.max(0, e.hp - d);
        e.hitFlash = 4 / 60;
        e._barT = sys.clock;
        const p = e.position;
        sys.number(p.x, sys.bodyBase(e) + e.def.body[1] + 0.2, p.z, String(d), 'dmg');
        if (e.hp <= 0) sys._kill(e);
        else e.receiveHit({ damage: d, crit: false, mv: 1, kb: 0, kbDirX: 0, kbDirZ: 1, poise: 0, knockdown: false, source: 'melee', tag: 0, guarded: false }, sys.ctx);
      });
    },

    /** Direct damage to the player (ignores i-frames and god mode). */
    damagePlayer(n) {
      const pc = sys.pc;
      if (!pc.alive) return false;
      const d = Math.max(0, Math.round(Number(n) || 0));
      const p = sys.player.position;
      sys.number(p.x, p.y + 1.9, p.z, String(d), 'hurt');
      pc.hp = Math.max(0, pc.hp - d);
      if (pc.hp <= 0) pc.die();
      return pc.hp;
    },

    /**
     * Set player values ({ hp, mp, sp, level, xp, gold, potions, upgrades }); `upgrades` ({ maxHp,
     * maxMp, attack, def }, each optional) replaces those upgrade totals and refills HP / MP.
     */
    setPlayer(o = {}) {
      const pc = sys.pc;
      if (o.upgrades && typeof o.upgrades === 'object') {
        for (const k of ['maxHp', 'maxMp', 'attack', 'def']) {
          if (o.upgrades[k] !== undefined) pc.upgrades[k] = Math.max(0, Math.round(Number(o.upgrades[k]) || 0));
        }
        pc.refill();
      }
      if (o.level !== undefined) {
        pc.level = Math.max(1, Math.min(LEVEL_CAP, Math.round(Number(o.level) || 1)));
        pc.refill();
        // (the companions level with the player: their HP and MP keep their fractions)
        for (const a of sys.allies) a.syncLevel();
      }
      if (o.xp !== undefined) pc.xp = Math.max(0, Math.round(Number(o.xp) || 0));
      if (o.gold !== undefined) pc.gold = Math.max(0, Math.round(Number(o.gold) || 0));
      if (o.potions !== undefined) pc.potions = Math.max(0, Math.min(POTION_MAX, Math.round(Number(o.potions) || 0)));
      if (o.hp !== undefined) pc.hp = Math.max(1, Math.min(pc.hpMax, Number(o.hp)));
      if (o.mp !== undefined) pc.mp = Math.max(0, Math.min(pc.mpMax, Number(o.mp)));
      if (o.sp !== undefined) pc.sp = Math.max(0, Math.min(SP_MAX, Number(o.sp)));
      return sys.state().player;
    },

    /** The player takes no damage and no reactions. */
    god(on = true) {
      sys.god = !!on;
      return sys.god;
    },

    /** Enemies stop updating (hits, deaths and fades still happen). */
    freezeAI(on = true) {
      sys.freezeAI = !!on;
      return sys.freezeAI;
    },

    /**
     * Jump the boss to phase n (1–3) without its transition (the brain's `jumpPhase`, which
     * signals `bossPhase`); HP drops to that phase's threshold if it is above it.
     */
    bossPhase(n) {
      const b = presentBoss();
      if (!b || !b.alive) return null;
      const k = Math.max(1, Math.min(3, Number(n) || 1));
      const ph = b.def.phases ?? [0.7, 0.35];
      if (k >= 2) b.hp = Math.min(b.hp, Math.round(b.hpMax * ph[k - 2]));
      if (b.brain?.jumpPhase) b.brain.jumpPhase(b, k, sys.ctx);
      else {
        b.phase = k;
        sys._onSignal('bossPhase', b, k);
      }
      return b.phase;
    },

    /**
     * Boss test control (COMBAT-05; scripts no longer read the golem brain's internals):
     * - `force(move)`: only `move` ('slam' | 'sweep' | 'toss' | 'rain' | 'charge') may be picked
     *   next, at once (every other move waits 99 s); `force(null)`: no move at all;
     * - `info()`: `{ uid, state, t (frames in the state), phase, alive, move, pending, skid,
     *   hazards }`;
     * - `hazards(type?)`: snapshots of its live delayed hazards `{ type, x, z, r (current), rInner,
     *   delay, t, dur, mv, kb }` ('circle' | 'ring' | 'magma' | 'fade').
     */
    boss: {
      force(move) {
        const b = presentBoss();
        if (!b || !b.alive || !b.brain.force) return false;
        b.brain.force(b, move ?? null);
        return true;
      },
      info() {
        const b = boss();
        if (!b) return null;
        const bi = b.brain.info ? b.brain.info(b) : {};
        return { uid: b.uid, state: b.state, t: b.fr, phase: b.phase, alive: b.alive, hazards: b.hazardCount, ...bi };
      },
      hazards(type) {
        const b = boss();
        return b ? b.hazardList(type) : [];
      },
    },

    /**
     * A path on the enemies' walk grid (Nav.js) from (x0, z0) to (x1, z1): waypoints `[[x, z], …]`,
     * or null (no path within `maxU` units).
     */
    path(x0, z0, x1, z1, maxU = 80) {
      const out = new Float32Array(128);
      const n = sys.nav.findPath(Number(x0), Number(z0), Number(x1), Number(z1), Number(maxU), out);
      if (n < 0) return null;
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([+out[i * 2].toFixed(2), +out[i * 2 + 1].toFixed(2)]);
      return pts;
    },

    /** Set the boss's HP fraction (no floors: the brain notices the threshold). */
    setBossHp(frac) {
      const b = presentBoss();
      if (!b) return null;
      b.hp = Math.max(1, Math.round(b.hpMax * Math.max(0, Math.min(1, Number(frac)))));
      return b.hp;
    },

    /** Attune a waystone ('spawn' for the level start). */
    checkpoint(id) {
      const w = sys.waystones.byId(id);
      if (!w || w.absent) return null;
      sys.waystones.attune(w, { silent: true });
      return w.id;
    },

    /** Rest at once (no fade; not refused while engaged): at `id`, or the current checkpoint. */
    rest(id) {
      const ws = sys.waystones;
      const w = id ? ws.byId(id) : ws.checkpoint;
      if (!w || w.absent) return false;
      ws.attune(w, { silent: true });
      sys.restAll();
      return true;
    },

    /**
     * The death reset at once (no screen): enemies, boss, pickups, the player at the checkpoint.
     * A death screen already up is dismissed and stops (it does not reset a second time).
     */
    respawn() {
      sys._deathT = -1;
      endDeathScreen();
      sys.resetEncounter();
      sys._respawnAt(sys.waystones.checkpoint);
      return sys.state();
    },

    /** Fire every named effect, marker shape / style, projectile kind, pickup kind, burst and SFX once. */
    showcase() {
      const p = sys.player.position;
      const f = sys.player.facing;
      const x = p.x + f.x * 2.5;
      const z = p.z + f.z * 2.5;
      const y = sys.groundAt(x, z);
      FX_NAMES.forEach((name, i) => sys.fx.play(name, x + (i % 3) - 1, y, z + Math.floor(i / 3) - 1, { dirX: f.x, dirZ: f.z, duration: 1 }));
      const shapes = /** @satisfies {[MarkerShape, MarkerStyle][]} */ ([['circle', 'enemy'], ['ring', 'player'], ['sector', 'lock'], ['lane', 'enemy'], ['rect', 'barrier'], ['circle', 'magma']]);
      const ids = shapes.map(([shape, style], i) => {
        const id = sys.markerAllocCore();
        sys.markerSetCore(id, { shape, style, x: x + (i % 3) * 2 - 2, z: z + Math.floor(i / 3) * 2 - 1, r: 1.2, rInner: 0.8, len: 3, width: 0.8, w: 2, d: 1.5, dirX: f.x, dirZ: f.z, halfAngle: 45, progress: 0.6, alpha: 1 });
        return id;
      });
      sys._later(2, () => ids.forEach((id) => sys.markerFreeCore(id)));
      for (const kind of PROJECTILE_KINDS) {
        sys.spawnProjectile('fx', {
          kind, x: p.x, y: p.y + 0.9, z: p.z, dirX: -f.x, dirZ: -f.z, speed: 6, range: 3, radius: 0.2, mv: 0, kb: 0,
          arc: kind === 'boulder' ? { tx: p.x - f.x * 3, tz: p.z - f.z * 3, time: 0.6, apex: 2 } : null,
        });
      }
      const rng = new RNG(0x5ca1e);
      for (const kind of PICKUP_KINDS) sys.pickups.drop(kind, kind === 'coin25' ? 25 : kind === 'coin5' ? 5 : 1, x, y, z, rng, 'none');
      for (const b of ['hitSpark', 'emberBurst', 'deathPoof', 'gooPoof', 'healGlow', 'magicBurst', 'sparkle', 'splash', 'footstep', 'victoryEmbers', 'victorySparkle', 'levelSparkle']) sys.burst(b, x, y + 0.8, z, 8);
      COMBAT_SFX_NAMES.forEach((n, i) => sys.audio.playSfx(n, { volume: 0.2, delay: i * 0.05 }));
      return { fx: FX_NAMES.length, markers: ids.length, projectiles: PROJECTILE_KINDS.length, pickups: PICKUP_KINDS.length };
    },

    /** Every enemy (hidden adds excluded). */
    enemies() {
      return sys.enemies.filter(visible).map((e) => ({
        uid: e.uid, kind: e.kind, hp: Math.ceil(e.hp), hpMax: e.hpMax, state: e.state,
        x: +e.position.x.toFixed(3), z: +e.position.z.toFixed(3), aggro: e.aggro, dormant: e.dormant,
        zone: e.zone >= 0 ? sys.zones[e.zone].id : null,
      }));
    },

    /** { programs, programsAtLoad, drawCalls, tickMsP50, tickMsP95, pools }. */
    stats: () => sys.stats(),

    // ---- the party's companions (docs/specs/PARTY.md §8, COMBAT.md §28) ----

    /** Every companion's state (join order; [] without a party). */
    allies: () => sys.allies.map((a) => a.info()),

    /**
     * Deal `n` damage to a companion (member id or name; no RNG, no reaction — at 0 it goes down);
     * its HP after, null when there is no such companion.
     */
    allyHurt(id, n) {
      const a = byAlly(id);
      return a ? sys.hurtAlly(a, n) : null;
    },

    /**
     * Whom enemy `uid` fights: the companion's id, or 'player'; null without such an enemy. With
     * `who` it is set first (a companion's id or name; 'player' / null: the player), held as after
     * a companion's hit.
     */
    allyTarget(uid, who) {
      const e = byUid(uid);
      if (!e) return null;
      if (who !== undefined) {
        const a = who === null || who === 'player' ? null : byAlly(who);
        e.target = a && !a.down && !e.boss && !e.isAdd ? a : null;
        e.targetHold = e.target ? ALLY.holdTarget : 0;
        e.targetCheck = e.target ? ALLY.checkTarget : 0;
      }
      return e.target ? e.target.id : 'player';
    },

    /** Set a companion's values ({ hp, mp }; hp 0 puts it down); its state, null when unknown. */
    allySet(id, o = {}) {
      const a = byAlly(id);
      if (!a) return null;
      if (o.mp !== undefined) a.mp = Math.max(0, Math.min(a.mpMax, Number(o.mp) || 0));
      if (o.hp !== undefined) {
        const hp = Math.max(0, Math.min(a.hpMax, Number(o.hp) || 0));
        if (hp <= 0) sys.hurtAlly(a, a.hp);
        else {
          if (a.down) a.refill();
          a.hp = hp;
        }
      }
      return a.info();
    },

    /** No enemy hit reaches a companion; the flag. */
    allyGod(on = true) {
      sys.allyGod = !!on;
      return sys.allyGod;
    },

    /** The story's `heal` for the companions: every one full and up; how many. */
    healAllies: () => sys.healAllies(),

    // ---- Vanquish the Evil Dragon (COMBAT.md §29) ----

    /** The party's ward (a new one first with `frac` / `seconds`): the strongest now and every ward. */
    ward(frac, seconds) {
      if (frac !== undefined) sys.ward(Number(frac), Number(seconds));
      return { frac: +sys.wardFrac.toFixed(3), wards: sys._wards.map((w) => ({ frac: +w.frac.toFixed(3), t: +w.t.toFixed(3) })) };
    },

    /** An enemy's status effects, taunt and target (null: no such enemy). */
    statusOf(uid) {
      const e = byUid(uid);
      if (!e) return null;
      return {
        uid: e.uid, state: e.state, ...e.statusInfo(),
        taunt: e.tauntT > 0 && e.target ? e.target.id : null, tauntT: +Math.max(0, e.tauntT).toFixed(3),
        target: e.target ? e.target.id : 'player', aggro: e.aggro, swarm: e.swarm, besiege: e.besiege ? { ...e.besiege } : null,
        marks: e.marks, submerged: e.submerged, released: e.released,
      };
    },

    /** Status effects on an enemy (uid or 'all') as a player-side hit puts them (not a foe the story took away). */
    status: (uid, st) => each(uid, (e) => {
      if (!e.alive || !inPlay(e) || !st || typeof st !== 'object') return;
      sys._applyStatus(e, st);
    }),

    /** A companion's taunt at (x, z): the foes it drew; null without such a companion. */
    taunt(id, x, z, r, seconds) {
      const a = byAlly(id);
      return a ? sys.taunt(a, Number(x), Number(z), Number(r), Number(seconds)) : null;
    },

    /** `CombatSystem.strike(spec)`: an enemy-side area hit from no enemy. */
    strike: (spec) => sys.strike(spec),

    // ---- The Bells of Evermere (COMBAT.md §30) ----

    /** An enemy's resonance marks (with `n`: set first, 0–3, the 6 s renewed); null: no such enemy. */
    marks(uid, n) {
      const e = byUid(uid);
      if (!e) return null;
      if (n !== undefined && e.alive) {
        e.marks = 0;
        e.addMarks(Number(n));
      }
      return e.marks;
    },

    /** Submerge (true) or surface (false, at x, z when given) an enemy → its `submerged`; null: no such enemy. */
    submerge(uid, on, x, z) {
      const e = byUid(uid);
      if (!e) return null;
      if (on) sys.submerge(e);
      else sys.surface(e, x, z);
      return e.submerged;
    },

    /** `CombatSystem.pulse(spec)`: a hazard pulse over the party with safe discs. */
    pulse: (spec) => sys.pulse(spec),

    /** Release an enemy now (`CombatSystem.release`): false when there is none or it is not alive. */
    release(uid) {
      const e = byUid(uid);
      return !!e && sys.release(e);
    },

    /** The CombatSystem itself (scripts that need more than the hooks). */
    system: sys,
  };
  return hooks;
}
