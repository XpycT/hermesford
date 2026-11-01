import { frostOf, statesOf, seasonOf } from '../LevelLook.js';
import { thawField, THAW_DEPTH } from '../../engine/world/ThawField.js';
import { thawKit } from '../SnowCover.js';
import { thawRunning, endThaw, thawSeconds } from './Frost.js';
import { ThawFront } from './ThawFront.js';
import { treeBurst, treeRelease, roofSlide, fallsBreak, shatter, puff, iceBreak } from './ThawFx.js';

/**
 * The frozen year's runtime (docs/contracts/EVERMERE_CAMPAIGN.md §5.2, §6.1, §7.3, §7.4): a level's
 * `environment.frost` and `environment.states` applied to the running game. A chunk of its own:
 * Game loads it (`game.thaw`) for the first level with a frost or states and keeps it for the page.
 *
 * - `applyLevelStates` at every arrival — the game's start and Continue (Game.init), a campaign's
 *   travel, a room attached again, a level built ahead (CampaignRuntime._enterLevel): the frost as
 *   the story stands (held — the weather's `snowHold`, the field frozen, the falls still, the ice
 *   walkable — or thawed), the patches, a holding state's hour and weather, at once.
 * - `levelStatesChanged` on every story change (StoryRunner `applyPresence`, before World.applyStory)
 *   and at a front's end: a frost whose `until` came to hold is **released** — staged by a running
 *   front (its ring takes the level; the release is its end), deferred while a story run holds the
 *   player until a `thaw` starts or the run ends, else at once: the level melts as a whole over
 *   ≈ 8 s through the same zones. A state that came or went blends its weather (≈ 3 s; with a
 *   front, when it reaches the camera's view), its hour glides (with a front over its run, else
 *   at the end of the story run: `time … <s>` glides it on its own) and `game.envNow` follows
 *   (`game.on('env')`).
 * - `runFront` (src/game/thaw/Frost.js, the `thaw` command): the front (ThawFront.js) — its ring
 *   and life, the one-shots where it passes (ThawFx.js, to a budget near the camera), the live
 *   story changes it stages (`gate`, World `thawGate`: what a change of the frost's flags brings or
 *   takes switches when the front reaches it; the frost foes shatter), the falls breaking, the ice
 *   melting from under the player's feet last.
 * - Every frame (Weather `thaw`): the field (src/engine/world/ThawField.js) and the uniforms of the
 *   thaw patch (src/game/thaw/ThawKit.js).
 *
 * Conditions read the story (`game.story.holds`: the flag rule of `when`); a level without a story
 * is frozen (it has a `frost`) and holds no state. Node-safe (the story runtime's test drives it on
 * a stub game): the kit (three.js) is reached through SnowCover `thawKit()` only.
 *
 * @import { Game } from '../Game.js'
 * @import { Level, LevelEnvironment, LevelState, LevelObject } from '../../engine/level/types.d.ts'
 */

/**
 * What a level's frost and states make of its environment as the story stands.
 * @param {Level} level
 * @param {((cond: string) => boolean)|null} holds the story's test, or null (no story)
 * @returns {{ frozen: boolean, frost: ReturnType<typeof frostOf>, states: LevelState[], key: string,
 *   env: Readonly<Partial<LevelEnvironment>> }} `key`: which states hold (one character each)
 */
export function evaluateLevelStates(level, holds) {
  /** @type {Partial<LevelEnvironment>} */
  const base = level?.environment ?? {};
  const frost = frostOf(base);
  const frozen = !!frost && !holds?.(frost.until);
  const all = holds ? statesOf(base) : [];
  const states = all.filter((s) => holds(s.when));
  let key = '';
  for (const s of all) key += states.includes(s) ? '1' : '0';
  /** @type {Partial<LevelEnvironment>} */
  const env = { ...base };
  for (const s of states) {
    if (s.time !== undefined) env.timeOfDay = s.time;
    if (s.weather !== undefined) env.weather = s.weather;
    if (s.aurora !== undefined) env.aurora = s.aurora;
    // (the tracks per part, the streaks into the cinematic settings)
    if (s.soundtrack) env.soundtrack = { ...(env.soundtrack ?? {}), ...s.soundtrack };
    if (s.streaks !== undefined) env.cinematic = { ...(env.cinematic ?? {}), streaks: s.streaks };
  }
  return { frozen, frost, states, key, env: Object.freeze(env) };
}

/** The last holding state's value of a field, or undefined. */
const last = (states, k) => {
  let v;
  for (const s of states) if (s[k] !== undefined) v = s[k];
  return v;
};

/**
 * `game.envNow` set; `env` listeners told.
 * @param {Game} game
 * @param {Readonly<Partial<LevelEnvironment>>} env
 */
function setEnv(game, env) {
  game.envNow = env;
  game.emit('env', env);
}

/** The flag names a condition reads (its words but `and`, `or`, `not`). @param {string} cond */
function namesOf(cond) {
  return new Set(String(cond ?? '').split(/[^A-Za-z0-9_:.\-]+/).filter((w) => w && !/^(and|or|not)$/i.test(w)));
}

/** The one-shots near the camera at most (u from the focus) and per second, by kind. */
const NEAR = 34;
const BUDGET = Object.freeze({ tree: 9, roof: 5 });

/**
 * The runtime of the running level (per game: `RUNTIMES`).
 */
class FrostRuntime {
  /**
   * @param {Game} game
   * @param {Level} level
   * @param {ReturnType<typeof evaluateLevelStates>} ev
   */
  constructor(game, level, ev) {
    this.game = game;
    this.level = level;
    this.frost = ev.frost;
    /** The names the frost's `until` reads: a change of them is the front's to stage. */
    this.untilNames = namesOf(ev.frost?.until ?? '');
    /** The frost held (the visible frozen state; a release under way ends it). */
    this.held = ev.frozen;
    /** A release that waits for the story run holding the player to end — or for a `thaw`. */
    this.pendingRelease = false;
    /** @type {ThawFront|null} */
    this.front = null;
    /** The front's end (its `runFront` promise). @type {(() => void)|null} */
    this._frontDone = null;
    /** The front is releasing the level (its frost's `until` holds). */
    this.releasing = false;
    /** The last front ran over the whole level: its release is at once. */
    this.covered = false;
    /** A front that ended without a release, shrinking back (s left). */
    this.recede = 0;
    this._recedeFrom = 0;
    this.fronts = 0;
    /** The patches (≤ 3): their ring now (−1: none) and the radius they grow to. */
    this.patches = (ev.frost?.patches ?? []).slice(0, 3).map((p) => ({ when: p.when, x: p.at[0], z: p.at[1], r: Math.max(0.5, p.r), cur: -1 }));
    /** What the presence gate answered last per object (`gate`). @type {WeakMap<object, boolean>} */
    this.seen = new WeakMap();
    /** Objects and groups held back by the gate: checked every frame until the front reaches them. */
    this.waiting = new Set();
    /** @type {Set<any>} */
    this.waitingGroups = new Set();
    /** A weather that waits for the front to reach the camera's view (or the release). @type {string|null} */
    this.weatherTo = null;
    /** An hour that waits: `run` (the story run's end) or `release`. @type {{ h: number, when: 'run'|'release' }|null} */
    this.hourTo = null;
    /** Ask the story for its presence again next frame (the staging moved). */
    this.needPresence = false;
    /** The falls broke / the ice let go under a level-wide melt. */
    this._meltIce = false;
    /** Registered one-shot points: thaw field id → what it is. @type {Map<number, { kind: string, obj?: LevelObject, fall?: number, h?: number, eave?: number[], y?: number, w?: number }>} */
    this.points = new Map();
    this._budget = { tree: 0, roof: 0 };
    /** Seconds until the ice's crack is heard again. */
    this._iceHeard = 0;
    this._focusReached = false;
  }

  get kit() {
    return thawKit();
  }

  /** The frost's `until` holds as the story stands (the level is to thaw; false without a frost or a story). */
  untilHolds() {
    const holds = this.game.story?.holds;
    return !!this.frost && !!holds && holds(this.frost.until);
  }

  // ---- arrival ------------------------------------------------------------------------------

  /**
   * The level as the story stands, at once (an arrival).
   * @param {ReturnType<typeof evaluateLevelStates>} ev
   */
  arrive(ev) {
    const g = this.game;
    const w = g.weather;
    const frost = this.frost;
    w.frostCover = frost ? frost.cover : 0;
    w.snowHold = frost && ev.frozen ? frost.cover : null;
    w.frostAmount = frost && ev.frozen ? 1 : 0;
    // (the snow there now: on a frozen level, how frozen it is — and the weather's own, which the
    // arrival's weather laid before the frost was known, settled again: `frost` weather lays none)
    if (frost) w.snowCover = ev.frozen ? frost.cover : 0;
    // (the snow a holding state keeps — `states[].cover`: a thawed level's soft snow)
    w.snowFloor = last(ev.states, 'cover') ?? 0;
    if (typeof w.settleSnow === 'function') w.settleSnow();
    thawField.reset(!!frost, ev.frozen);
    const holds = g.story?.holds;
    for (const p of this.patches) p.cur = ev.frozen && holds?.(p.when) ? p.r : -1;
    this._rings();
    const world = g.world;
    /** The world this runtime hooked (its gate and ice test, let go by `drop`). */
    this.world = world ?? null;
    if (frost && world) {
      // the frozen falls (those a patch thawed run), the one-shot points, the World's hooks
      if (frost.falls) world.falls.forEach((f, k) => this.kit?.freezeFalls(world, w, !thawField.reached(f.anchor.x, f.anchor.z, 3), k));
      this._register();
      world.thawGate = (grp) => this._groupMay(grp);
      if (world.thawIce) {
        world.thawIce.at = (c) => this._iceAt(c);
        // (laid as the story stands at the build or the attach: a patch thawed some — the story's
        // presence again next frame lifts them)
        this.needPresence = true;
      }
      // (the gate's memory of what the frost's changes stage: as the level shows them now)
      const present = g.story?.present;
      if (present) for (const o of g.level.objects) if (this._staged(o)) this.seen.set(o, !!present(o));
    }
    this.sync();
  }

  /** The thaw field's points of the level's trees, roofs and falls (their one-shots: `_pass`). */
  _register() {
    const g = this.game;
    for (const o of g.level.objects) {
      if (o.type === 'tree') this.points.set(thawField.register(o.x, o.z, 'tree'), { kind: 'tree', obj: o, h: Number(o.opts?.height) || 4.5 });
      else if (o.type === 'house') {
        const op = /** @type {any} */ (o.opts ?? {});
        const w = (Number(op.width) || 4) / 2;
        const d = (Number(op.depth) || 3) / 2;
        const rot = Number(o.rotation) || 0;
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        // the eave facing the camera (+z before the house's turn)
        const ex = (lx, lz) => [o.x + lx * c + lz * s, o.z - lx * s + lz * c];
        const [x0, z0] = ex(-w, d + 0.2);
        const [x1, z1] = ex(w, d + 0.2);
        const y = (g.world?.groundAt(o.x, o.z) ?? 0) + (Number(op.height) || 2.4) + 0.2;
        this.points.set(thawField.register(o.x, o.z + d, 'roof'), { kind: 'roof', obj: o, eave: [x0, z0, x1, z1, y] });
      }
    }
    if (this.frost.falls) (g.world?.falls ?? []).forEach((f, k) => this.points.set(thawField.register(f.anchor.x, f.anchor.z, 'falls'), { kind: 'falls', fall: k }));
    // the water's stretches (the walkable ice's pieces, or the water's own): the ice breaks there
    const chunks = g.world?.thawIce?.chunks ?? (g.world?.water ? this.kit?.iceChunks(g.world.tileMap) : null) ?? [];
    for (const c of chunks) {
      const r = c.rect;
      this.points.set(thawField.register((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, 'ice'), { kind: 'ice', y: r.y, w: Math.max(r.maxX - r.minX, r.maxZ - r.minZ) });
    }
  }

  // ---- the gate (live story changes staged by the front) ------------------------------------

  /** Does a change of this object belong to the front (its condition reads the frost's flags)? @param {any} o */
  _staged(o) {
    if (!o || !this.frost) return false;
    for (const c of [o.when, o.unless]) if (c) for (const n of namesOf(c)) if (this.untilNames.has(n)) return true;
    return false;
  }

  /**
   * Are the frost's changes being staged now (a releasing front, a release waiting for one — or
   * about to: the story's presence pass reads its villagers before `levelStatesChanged` holds it)?
   */
  get staging() {
    if (!this.frost) return false;
    if (this.pendingRelease || (!!this.front && !this.front.done)) return true;
    const run = /** @type {any} */ (this.game.story)?.run;
    return this.held && !!run && !run.fast && this.untilHolds();
  }

  /** Has the front reached (x, z)? (a release waiting for one: nothing is reached) */
  _reached(x, z) {
    return !!this.front && thawField.reached(x, z);
  }

  /**
   * The presence gate (StoryRunner.applyPresence, villagers and combat): while the frost's changes
   * are staged, an object they concern keeps what it had until the front reaches it.
   * @param {any} o @param {boolean} live
   */
  gated(o, live) {
    const seen = this.seen.get(o);
    let out = live;
    if (seen !== undefined && seen !== live && this.staging && this._staged(o) && !this._reached(o.x, o.z)) {
      out = seen;
      this.waiting.add(o);
    } else {
      this.waiting.delete(o);
      // a frost foe the thaw took: it shatters
      if (seen === true && !out && o.type === 'enemy' && this._staged(o)) this._shatter(o);
    }
    this.seen.set(o, out);
    return out;
  }

  /** The foes of an enemy group shattering where they stand. @param {any} o */
  _shatter(o) {
    const g = this.game;
    for (const e of g.combat?.enemies ?? []) {
      if (e.groupId !== o.id || !e.alive) continue;
      shatter(g, e.position.x, e.position.y, e.position.z);
    }
  }

  /**
   * World.applyStory: may a live story group that changed switch now? (Not while the frost's
   * change it belongs to is staged and the front has not reached its nearest point.)
   * @param {any} grp World's StoryGroup
   */
  _groupMay(grp) {
    if (!this.staging || !this._staged(grp.sample)) {
      this.waitingGroups.delete(grp);
      return true;
    }
    const b = groupBox(grp);
    const f = this.front;
    if (f) {
      const nx = Math.max(b.minX, Math.min(b.maxX, f.x));
      const nz = Math.max(b.minZ, Math.min(b.maxZ, f.z));
      if (thawField.reached(nx, nz)) {
        // (held back until now: a puff of steam and powder where it switches)
        if (this.waitingGroups.delete(grp)) puff(this.game, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.max(1, Math.min(6, b.maxX - b.minX, b.maxZ - b.minZ)));
        return true;
      }
    }
    this.waitingGroups.add(grp);
    return false;
  }

  /**
   * Is a piece of walkable ice there (World.applyStory)? While held, or until the thaw has passed
   * its farthest corner (the water's lead included): no one falls through ice still shown.
   * @param {{ rect: { minX: number, maxX: number, minZ: number, maxZ: number } }} c
   */
  _iceAt(c) {
    if (!this.frost) return false;
    const r = c.rect;
    for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]) if (thawField.inside(x, z, 3) < 0.75) return true;
    return false;
  }

  // ---- releases -----------------------------------------------------------------------------

  /**
   * The frost's `until` came to hold: release the level — staged by a running front, after it (a
   * front that is only its time), deferred while a story run holds the player, else now.
   * @param {Partial<LevelEnvironment>} env the environment now (its weather and hour)
   * @param {boolean} [fromUpdate] called by the runtime itself (the story's presence follows next frame)
   */
  release(env, fromUpdate = false) {
    const g = this.game;
    // (a front carries it already)
    if (this.releasing && this.front && !this.front.done) return false;
    if (this.front && !this.front.done) {
      this._releaseBy(env);
      return false;
    }
    if (thawRunning()) {
      // (a front that is only its time: the weather and the hour wait for its end with the release)
      this.weatherTo = env.weather ?? null;
      if (env.timeOfDay !== undefined) this.hourTo = { h: env.timeOfDay, when: 'release' };
      return false;
    }
    const run = /** @type {any} */ (g.story)?.run;
    if (!this.covered && run && !run.fast) {
      this.pendingRelease = true;
      this.weatherTo = env.weather ?? null;
      if (env.timeOfDay !== undefined) this.hourTo = { h: env.timeOfDay, when: 'release' };
      return false;
    }
    const w = g.weather;
    this.held = false;
    this.pendingRelease = false;
    this.releasing = false;
    w.snowHold = null;
    if (this.covered) w.frostAmount = 0;
    this.covered = false;
    thawField.frozen = false;
    this.front = null;
    this.recede = 0;
    // (a front thawed it all: the patches go with it; a level-wide melt keeps them till it is done)
    if (w.frostAmount === 0) for (const p of this.patches) p.cur = -1;
    this._rings();
    // the falls run; the near ones break with a burst (a level-wide melt: all at once)
    if (this.frost?.falls && g.world && this.kit) {
      const fp = g.rig?.focusPoint;
      for (const k of this.kit.freezeFalls(g.world, w, false)) {
        const f = g.world.falls[k];
        if (!fp || Math.hypot(f.anchor.x - fp.x, f.anchor.z - fp.z) < NEAR) fallsBreak(g, f, true);
      }
    }
    if (this.weatherTo ?? env.weather) w.setWeather(this.weatherTo ?? env.weather);
    this.weatherTo = null;
    const h = this.hourTo?.h ?? env.timeOfDay;
    if (this.hourTo && h !== undefined) this._glideHour(h, 2);
    this.hourTo = null;
    this._meltIce = true;
    if (fromUpdate) this.needPresence = true;
    this.sync();
    return true;
  }

  /**
   * A running front takes the release: the field thawing as it passes, the weather when it
   * reaches the camera's view, the hour gliding over the rest of its run.
   * @param {Partial<LevelEnvironment>} env
   */
  _releaseBy(env) {
    const g = this.game;
    this.releasing = true;
    this.pendingRelease = false;
    thawField.frozen = false;
    const to = this.weatherTo ?? env.weather ?? null;
    this.weatherTo = to && to !== g.weather.weather ? to : null;
    this._focusReached = false;
    const h = this.hourTo?.h ?? env.timeOfDay;
    if (h !== undefined && Math.abs(h - g.lighting.timeOfDay) > 0.01) this._glideHour(h, Math.max(3, this.front.left));
    this.hourTo = null;
    thawField.version++;
  }

  /** The frost's `until` stopped holding: frozen again (the snow settles back over ≈ 3 s). */
  freeze() {
    const g = this.game;
    const frost = this.frost;
    if (!frost) return;
    this.held = true;
    this.releasing = false;
    this.pendingRelease = false;
    // (what a front covered before is gone: the next release melts again)
    this.covered = false;
    g.weather.snowHold = frost.cover;
    thawField.frozen = true;
    if (frost.falls && g.world) this.kit?.freezeFalls(g.world, g.weather, true);
    this.needPresence = true;
    this.sync();
  }

  /**
   * Glide the shown hour (a running clock's too) to `h` over `s` seconds.
   * @param {number} h @param {number} s
   */
  _glideHour(h, s) {
    const w = this.game.weather;
    if (typeof w.setTime === 'function') w.setTime(h, { duration: s });
  }

  // ---- the front ----------------------------------------------------------------------------

  /**
   * A `thaw`: the front from (x, z) — a front already running ends first.
   * @param {{ x: number, z: number }} at
   * @param {number|undefined} seconds
   * @param {any} run
   * @returns {Promise<void>}
   */
  startFront(at, seconds, run) {
    const g = this.game;
    this._endFront();
    const front = new ThawFront(g, { x: at.x, z: at.z, seconds, n: this.fronts++ });
    this.front = front;
    this.recede = 0;
    this.covered = false;
    /** @type {any} */ (front).run = run;
    g.audio?.playSfx?.('thawSweep', { volume: 0.9 });
    // the frost's `until` holds already (or its release waits for this front): the front releases
    if (this.held && (this.pendingRelease || this.untilHolds())) this._releaseBy(evaluateLevelStates(g.level, g.story?.holds ?? null).env);
    this._rings();
    return new Promise((resolve) => { this._frontDone = resolve; });
  }

  /** The running front's promise resolved (its end, or a new front / a new level over it). */
  _endFront() {
    const done = this._frontDone;
    this._frontDone = null;
    done?.();
  }

  /**
   * The front reached its end: a release it carried — or one whose flag came while it was ending
   * (a skipped toll: the front finished, then the run's `set` before this frame) — is at once now
   * (the field is thawed everywhere): Frost.js tells `levelStatesChanged`, which releases (a level
   * released already loses its melt at once); else the frost comes back: the ring shrinks to
   * nothing over 1 s.
   */
  _frontEnded() {
    const f = this.front;
    if (!f) return;
    if (this.releasing || this.untilHolds()) {
      this.covered = true;
      if (!this.held) this.game.weather.frostAmount = 0;
    } else {
      this.recede = 1;
      this._recedeFrom = f.r;
    }
    this._endFront();
  }

  /** The rings into the field (the front's, the patches'). */
  _rings() {
    const R = thawField.rings;
    const f = this.front;
    if (f) {
      const r = this.recede > 0 ? this._recedeFrom * this.recede : f.r;
      R[0] = f.x; R[1] = f.z; R[2] = r;
      thawField.front = f.done ? null : { x: f.x, z: f.z, r };
    } else {
      R[2] = -1;
      thawField.front = null;
    }
    this.patches.forEach((p, i) => {
      R[4 * (i + 1)] = p.x;
      R[4 * (i + 1) + 1] = p.z;
      R[4 * (i + 1) + 2] = p.cur;
    });
    for (let i = this.patches.length; i < 3; i++) R[4 * (i + 1) + 2] = -1;
  }

  // ---- every frame --------------------------------------------------------------------------

  /** @param {number} dt */
  update(dt) {
    const g = this.game;
    const story = /** @type {any} */ (g.story);
    const run = story?.run;
    const free = !run || run.fast;
    // a release that waited for the run holding the player: the run ended without a thaw
    if (this.pendingRelease && free) {
      this.pendingRelease = false;
      if (this.untilHolds()) this.release(evaluateLevelStates(g.level, story?.holds ?? null).env, true);
      else this.needPresence = true;
    }
    // an hour that waited for the run's end (a glide of the story's own goes on)
    if (this.hourTo?.when === 'run' && free) {
      if (!g.weather.transitioning && Math.abs(this.hourTo.h - g.lighting.timeOfDay) > 0.01) this._glideHour(this.hourTo.h, 1.5);
      this.hourTo = null;
    }
    const f = this.front;
    // (a front finished outside a frame — a skipped run's `thaw`, a new front over it — ends here)
    if (f?.done && this._frontDone) this._frontEnded();
    if (f) {
      if (f.done && this.recede > 0) {
        this.recede = Math.max(0, this.recede - dt);
        if (this.recede === 0) {
          // the frost back where the front had been: the falls still again, the points armed again
          this.front = null;
          this._rings();
          if (this.frost?.falls && g.world) this.kit?.freezeFalls(g.world, g.weather, true);
          for (const p of thawField.points) p.passed = thawField.reached(p.x, p.z, p.kind === 'falls' ? 3 : 0);
          this.needPresence = true;
        }
      } else if (!f.done) {
        if (/** @type {any} */ (f).run?.fast) f.finish();
        else f.update(dt);
        f.life(dt);
        if (this.releasing && this.weatherTo) {
          // (the front coming into the camera's view: the weather clears while it crosses it)
          const fp = g.rig?.focusPoint;
          if (f.done || (fp && Math.hypot(fp.x - f.x, fp.z - f.z) <= f.r + 10)) {
            g.weather.setWeather(this.weatherTo);
            this.weatherTo = null;
          }
        }
        if (f.done) this._frontEnded();
      }
    }
    // the patches grow (≈ 1.4 s) or close (≈ 0.8 s) as their conditions come and go
    const holds = story?.holds;
    for (const p of this.patches) {
      // (held, or melting as a whole: a thawed patch stays till the melt has taken the rest)
      const on = (this.held || (g.weather.frostAmount ?? 0) > 0) && !!holds?.(p.when);
      if (on && p.cur < p.r) p.cur = Math.min(p.r, Math.max(0, p.cur) + (p.r / 1.4) * dt * (1.6 - p.cur / p.r));
      else if (!on && p.cur >= 0) {
        p.cur -= (p.r / 0.8) * dt;
        if (p.cur <= 0) {
          p.cur = -1;
          this.needPresence = true;
        }
      }
    }
    this._rings();
    this.sync();
    if (!this.frost) return;
    this._passes(dt);
    // what the gate held back: the front reached it → the story's presence again
    if (this.staging || this.waiting.size || this.waitingGroups.size) {
      for (const o of this.waiting) if (!this.staging || this._reached(o.x, o.z)) this.needPresence = true;
      for (const grp of this.waitingGroups) if (!this.staging || this._groupMay(grp)) this.needPresence = true;
    }
    // the walkable ice the thaw took (the front's, a patch's, a level-wide melt's)
    const ice = g.world?.thawIce;
    if (ice && !this.needPresence) for (const c of ice.chunks) if (c.on && !this._iceAt(c)) this.needPresence = true;
    if (this._meltIce && thawField.melt * THAW_DEPTH >= 0.8) {
      this._meltIce = false;
      this.needPresence = true;
    }
    if (this.needPresence && story?.applyPresence) {
      this.needPresence = false;
      story.applyPresence();
    }
  }

  /** The registered points the thaw crossed: their listeners and the one-shots (to a budget). @param {number} dt */
  _passes(dt) {
    const g = this.game;
    const B = this._budget;
    B.tree = Math.min(BUDGET.tree, B.tree + BUDGET.tree * dt);
    B.roof = Math.min(BUDGET.roof, B.roof + BUDGET.roof * dt);
    this._iceHeard -= dt;
    const fp = g.rig?.focusPoint;
    const season = seasonOf(g.envNow);
    const present = g.story?.present;
    for (const p of thawField.points) {
      if (p.passed || !thawField.reached(p.x, p.z, p.kind === 'falls' ? 3 : 0)) continue;
      thawField.pass(p);
      const it = this.points.get(p.id);
      if (!it) continue;
      const near = !fp || Math.hypot(p.x - fp.x, p.z - fp.z) < NEAR;
      if (it.kind === 'falls') {
        const k = it.fall ?? -1;
        if (this.frost.falls && g.world && this.kit?.freezeFalls(g.world, g.weather, false, k).length) fallsBreak(g, g.world.falls[k], near);
      } else if (!near || (it.obj && present && !present(it.obj))) continue;
      else if (it.kind === 'ice') {
        iceBreak(g, p.x, it.y ?? 0, p.z, it.w ?? 4);
        // (the crack heard once a second at most)
        if (this._iceHeard <= 0) {
          g.audio?.playSfx?.('iceBreak', { volume: 0.7 });
          this._iceHeard = 1;
        }
      }
      else if (it.kind === 'tree' && B.tree >= 1) {
        B.tree--;
        treeBurst(g, p.x, p.z, it.h ?? 4.5, treeRelease(String(/** @type {any} */ (it.obj?.opts)?.kind ?? 'oak'), season));
      } else if (it.kind === 'roof' && B.roof >= 1) {
        B.roof--;
        const e = it.eave;
        roofSlide(g, e[0], e[1], e[2], e[3], e[4]);
      }
    }
  }

  /** The field's melt and ice, the thaw patch's uniforms. */
  sync() {
    const w = this.game.weather;
    const frost = this.frost;
    const melt = frost ? 1 - (w.frostAmount ?? 0) : 1;
    if (thawField.melt !== melt) {
      thawField.melt = melt;
      thawField.version++;
    }
    // (the ice is gone once the melt is past its dithered edge; a front takes it as it runs)
    const f = this.front;
    const iceLeft = 1 - Math.min(1, (melt * THAW_DEPTH) / 0.75);
    thawField.ice = !frost ? 0 : iceLeft * (f && !f.done ? 1 - Math.min(1, f.r / f.rMax) : f && this.releasing ? 0 : 1);
    this.kit?.syncUniforms(thawField, frost ? w.frostAmount ?? 0 : 0, frost?.cover ?? 1);
  }

  /** This level is left: its front ends (its promise resolved), nothing of it stays in the world. */
  drop() {
    this._endFront();
    this.front = null;
    // (a world set aside and attached again reads its ice as the story stands until its arrival
    // gives it the next runtime's test)
    const world = this.world;
    if (world?.thawGate) world.thawGate = null;
    if (world?.thawIce) world.thawIce.at = null;
  }
}

/**
 * A live story group's ground box (its colliders, walk surfaces, objects and sample).
 * @param {any} grp
 */
function groupBox(grp) {
  if (grp._thawBox) return grp._thawBox;
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const add = (x0, x1, z0, z1) => {
    b.minX = Math.min(b.minX, x0); b.maxX = Math.max(b.maxX, x1);
    b.minZ = Math.min(b.minZ, z0); b.maxZ = Math.max(b.maxZ, z1);
  };
  for (const c of grp.colliders ?? []) {
    if (c.type === 'circle') add(c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r);
    else add(c.minX, c.maxX, c.minZ, c.maxZ);
  }
  for (const r of grp.walkRects ?? []) add(r.minX, r.maxX, r.minZ, r.maxZ);
  for (const o of grp.objects ?? []) add(o.position.x, o.position.x, o.position.z, o.position.z);
  if (grp.sample && Number.isFinite(grp.sample.x)) add(grp.sample.x, grp.sample.x, grp.sample.z, grp.sample.z);
  if (!(b.minX <= b.maxX)) add(0, 0, 0, 0);
  grp._thawBox = b;
  return b;
}

/** @type {WeakMap<object, FrostRuntime>} */
const RUNTIMES = new WeakMap();

/**
 * The level just became the running one (an arrival): its frost and states as the story stands,
 * at once.
 * @param {Game} game
 * @param {Level} [level]
 */
export function applyLevelStates(game, level = game.level) {
  endThaw();
  RUNTIMES.get(game)?.drop();
  const ev = evaluateLevelStates(level, game.story?.holds ?? null);
  game.levelStates = { level, frozen: ev.frozen, key: ev.key };
  const rt = new FrostRuntime(game, level, ev);
  RUNTIMES.set(game, rt);
  rt.arrive(ev);
  const time = last(ev.states, 'time');
  if (time !== undefined) game.setTime(time);
  const weather = last(ev.states, 'weather');
  if (weather !== undefined) game.weather.setWeather(weather, { instant: true });
  // (the runtime's per-frame work: the real Weather calls it; a level without frost or states needs none)
  if ('thaw' in game.weather) game.weather.thaw = rt.frost || ev.key ? rt : null;
  setEnv(game, ev.env);
}

/**
 * The story changed (or a front ended): a frost whose `until` came to hold is released (staged by a
 * front, deferred while a story run holds the player, else at once), one that stopped holding
 * freezes again; a state that came or went blends its weather and moves its hour (see the module
 * notes) and `envNow` follows. Nothing for a level the states were not applied to yet (it is being
 * built: its arrival applies them).
 * @param {Game} game
 */
export function levelStatesChanged(game) {
  const cur = game.levelStates;
  if (!cur || cur.level !== game.level || !game.weather) return;
  const rt = RUNTIMES.get(game);
  if (!rt) return;
  const ev = evaluateLevelStates(game.level, game.story?.holds ?? null);
  if (ev.frozen !== cur.frozen) {
    if (!ev.frozen) {
      if (rt.release(ev.env)) cur.frozen = false;
    } else {
      rt.freeze();
      cur.frozen = true;
    }
  }
  if (ev.key !== cur.key) {
    cur.key = ev.key;
    // the snow the level keeps (`states[].cover`): under a frost still held — a front, a release to
    // come — it lies at once (the front melts the frost down to it); on a thawed level it settles or
    // melts at the weather's pace
    const cover = last(ev.states, 'cover') ?? 0;
    const w = game.weather;
    if (w.snowFloor !== cover) {
      w.snowFloor = cover;
      if (rt.held && typeof w.settleSnow === 'function') w.settleSnow();
    }
    const weather = last(ev.states, 'weather') ?? game.level.environment?.weather;
    const time = last(ev.states, 'time') ?? game.level.environment?.timeOfDay;
    // (a release under way or still to come takes them along)
    if (rt.releasing || rt.pendingRelease || (rt.held && !ev.frozen)) {
      if (weather && weather !== game.weather.weather) rt.weatherTo = weather;
      if (time !== undefined && rt.releasing && rt.front) rt._glideHour(time, Math.max(3, rt.front.left));
      else if (time !== undefined) rt.hourTo = { h: time, when: 'release' };
    } else {
      if (weather && weather !== game.weather.weather) game.weather.setWeather(weather);
      if (time !== undefined && Math.abs(time - game.lighting.timeOfDay) > 0.01) {
        const run = /** @type {any} */ (game.story)?.run;
        if (run && !run.fast) rt.hourTo = { h: time, when: 'run' };
        else rt._glideHour(time, 2);
      }
    }
    setEnv(game, ev.env);
  }
}

/**
 * The `thaw` command's front (src/game/thaw/Frost.js `startThaw`): from `at` (default the
 * level's `frost.at`, else its middle) over about `seconds`. On a level without a frost it is only
 * its time.
 * @param {Game} game
 * @param {{ at?: { x: number, z: number }|null, seconds?: number, run?: any, wait?: (s: number) => Promise<void> }} opts
 * @param {{ finish: (() => void)|null }} handle Frost's: `finish` set (a skip: the end state at once)
 * @returns {Promise<void>}
 */
export function runFront(game, { at = null, seconds, run = null, wait }, handle) {
  const rt = RUNTIMES.get(game);
  if (!rt?.frost) return wait ? wait(Number.isFinite(seconds) ? seconds : thawSeconds(game.level)) : Promise.resolve();
  const L = game.level;
  const c = at ?? (rt.frost.at ? { x: rt.frost.at[0], z: rt.frost.at[1] } : { x: L.width / 2, z: L.depth / 2 });
  const p = rt.startFront(c, seconds, run);
  handle.finish = () => rt.front?.finish();
  if (run?.fast) rt.front.finish();
  return p;
}

/**
 * The presence gate for the story's villagers and combat (StoryRunner.applyPresence): while a
 * front stages the frost's changes, what they bring or take keeps its state until the front
 * reaches it (the frost foes shatter then). The test itself on a level without a frost.
 * @param {Game} game
 * @param {(o: any) => boolean} present the story's presence test
 * @returns {(o: any) => boolean}
 */
export function gate(game, present) {
  const rt = RUNTIMES.get(game);
  return rt?.frost ? (o) => rt.gated(o, !!present(o)) : present;
}
