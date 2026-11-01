/**
 * The Hush Bell's toll (docs/contracts/EVERMERE_CAMPAIGN.md §3 Rimeholt, §6.7): the level's toll as
 * a small system of the combat where a `belfry` of kind `hush` stands (Rimeholt and the Bell
 * Court). Owner: the king package; a level system of the combat core (COMBAT.md §30.1:
 * `registerSystem('hushToll', createHushToll)`, made after the enemies; its `frame` runs every
 * frame), registered by ./index.js.
 *
 * A toll: three beats 54 f apart — `hushToll`'s three strokes, the sound played once at the first —
 * (the black bell swings, every warm zone flashes its gold ring: the safe places, shown), then a dark ring rolls out of the bell's mouth across the
 * level at 22 u/s (flat FX quads along the arc the camera sees, frost ash at its front). When it
 * reaches the player one level-wide pulse lands — `ctx.pulse` (§30.8, instant; its own ring off:
 * this rolling ring is its warning and its look): a heavy flat hit and a knockdown on the player and
 * every companion outside warmth, harmful only while a fight is engaged in an active frame — never
 * in a story scene (the core's rules). Warmth: `ctx.warmthZones()` — the lit braziers (`monument`
 * kind `brazier`, fire `warm`, r 3.5) and Linnet's Toll bell (the hero's, `sys.addWarmth`).
 *
 * The period counts from a toll's end (its ring past the player) to the next first beat. Its mode
 * follows the Hushed King when the level has him (`_mode`): outside his fight `base` (20 s; harmless
 * there: no fight is engaged), `held` in his intro and phase 1 (the Bellkeeper fights alone),
 * `court` in phase 2 (15 s; after each landing the lit brazier nearest the player dies), `crown` in
 * phase 3 (he rings it himself: `due` tells his brain, `start` begins a toll; every brazier out,
 * relit ones again at each first beat — the only warmth is Linnet's Toll bell), `silent` once he is
 * released (`Enemy.released`) and on any level once the story holds `crown-broken` (Rimeholt in the
 * epilogue); no toll while its bell is not there. A fight that ends without his defeat (a wipe, a
 * rest) relights the braziers, and so does the combat's first active frame while he stands (a
 * Continue after an autosave that caught one dark).
 *
 * Putting a brazier out (the orchestrator's data shape): a lit brazier is a `monument` brazier with
 * fire `warm` whose `unless` is one bare flag — its dark twin carries `when` on the same flag; the
 * toll SETS that flag through the core's `ctx.setFlag(name, value)` (§30.9; cleared on a relight). A
 * lit brazier without such an `unless` cannot be put out. Rimeholt's braziers start dark and are lit
 * by the authors' `use` events (`when: rh-brazier-<n>` on the lit one): the toll never puts those out
 * (it runs in `base` mode there).
 *
 * Nothing here is random; no program (the FX quads, the atlas frames of ../../../../engine/pixel/fx/
 * evKingFx.js and warmed particle pools); no light.
 *
 * @import { EnemyPackApi, EnemyPackRegistrar } from '../index.js'
 * @import { CombatContext, CombatPackSystem, WarmthZone } from '../../types.js'
 * @import { Enemy } from '../../Enemy.js'
 * @import { CombatSystem } from '../../CombatSystem.js'
 * @import { LevelObject } from '../../../../engine/level/types.js'
 */
import { isFlagName } from '../../../../engine/level/StoryCondition.js';
import { TOLL_TUNING as T } from './defsKing.js';

/** The campaign's flag of the crown broken (EVERMERE_CAMPAIGN.md §2.5): the Hush Bell's last toll is past. */
const CROWN_BROKEN = 'crown-broken';

/** Wave quads along the visible arc. */
const SEGMENTS = 24;
/** Arc length (u) shown either side of the player's bearing. */
const ARC = 24;
/** The wave's colour: a navy body, a cyan front edge (×: FxQuads tints the grey frame). */
const WAVE_TINT = [0.5, 0.82, 1.25];
/** The warm zones' ring on each beat. */
const WARM_TINT = [1.45, 0.8, 0.3];
/** The ring's radius in the `evkWarm` frame (px). */
const WARM_PX = 29;

/** sys.ctx → its toll (the King's brain asks through its context). @type {WeakMap<object, HushToll>} */
const TOLLS = new WeakMap();

/**
 * The toll of the combat whose context this is (null: the level has no Hush Bell).
 * @param {CombatContext} ctx
 * @returns {HushToll|null}
 */
export function tollOf(ctx) {
  return (ctx && TOLLS.get(ctx)) ?? null;
}

/**
 * The pack-system factory: a toll where a `belfry` of kind `hush` stands, else null.
 * @param {CombatSystem} sys
 * @returns {HushToll|null}
 */
export function createHushToll(sys) {
  const obj = (sys.level?.objects ?? []).find((o) => o.type === 'belfry' && /** @type {any} */ (o).opts?.kind === 'hush');
  if (!obj) return null;
  const toll = new HushToll(sys, obj);
  TOLLS.set(sys.ctx, toll);
  return toll;
}

/** @implements {CombatPackSystem} */
export class HushToll {
  /**
   * @param {CombatSystem} sys
   * @param {LevelObject} obj the hush belfry
   */
  constructor(sys, obj) {
    this.sys = sys;
    this.obj = obj;
    this.id = String(obj.id ?? '');
    /** The bell's foot (where the ring rolls from). */
    this.x = Number(obj.x);
    this.z = Number(obj.z);
    /** The Hushed King of the level (his phase sets the mode), or null. @type {Enemy|null} */
    this.king = sys.enemies.find((e) => e.kind === 'hushedking' && !e.isAdd) ?? null;
    /**
     * The braziers a toll can put out: a lit (`warm`) brazier whose `unless` is one bare flag.
     * @type {{ x: number, z: number, flag: string, id: string }[]}
     */
    this.candidates = (sys.level?.objects ?? []).filter((o) => {
      const op = /** @type {any} */ (o).opts ?? {};
      return o.type === 'monument' && op.kind === 'brazier' && (op.fire ?? 'warm') === 'warm' && typeof o.unless === 'string' && isFlagName(o.unless);
    }).map((o) => ({ x: Number(o.x), z: Number(o.z), flag: /** @type {string} */ (o.unless), id: String(o.id ?? '') }));
    /** @type {'base'|'held'|'court'|'crown'|'silent'} */
    this.mode = 'base';
    /** Seconds until the next first beat (`base`, `court`; `crown`: until `due`). @type {number} */
    this.wait = T.first;
    /** A toll's stage: idle, the three beats, the rolling ring. @type {'idle'|'beats'|'wave'} */
    this.stage = 'idle';
    /** Seconds into the stage. */
    this.t = 0;
    /** Beats struck in this toll. */
    this.beat = 0;
    /** The ring's radius (u). */
    this.R = 0;
    /** The ring reached the player (the pulse landed) in this toll. */
    this.landed = false;
    /** A brazier to put out after this toll's landing: { flag, x, z, t }. @type {{ flag: string, x: number, z: number, t: number }|null} */
    this.douse = null;
    /** Flags this toll set (cleared on a relight). @type {Set<string>} */
    this.set = new Set();
    /** Counters for the tests. */
    this.tolls = 0;
    this.lands = 0;
    /** The safe zones of the last pulse. @type {WarmthZone[]} */
    this.lastSafe = [];
    /** The last pulse's result (`ctx.pulse`). @type {object|null} */
    this.lastPulse = null;
    /** @type {string[]} */
    this.doused = [];
    /** The wave's quad handles (−1: none). @type {number[]} */
    this._quads = [];
    /** The reused quad parameters. */
    this._q = { x: 0, y: 0, z: 0, frame: 'evkWave', index: 0, scale: 1, rot: 0, mode: 'flat', dirX: 0, dirZ: 1, r: WAVE_TINT[0], g: WAVE_TINT[1], b: WAVE_TINT[2], a: 1 };
    this._frame = 0;
    /** The combat's first active frame has run (the relight at the start). */
    this._started = false;
  }

  /** The combat's context. @returns {CombatContext} */
  get ctx() {
    return this.sys.ctx;
  }

  /** The Hush Bell (while present) or null. */
  get bell() {
    return this.ctx.bells?.get(this.id) ?? null;
  }

  /** The bell's mouth (world), for the King's facing and the beats' rings. @returns {[number, number, number]} */
  get mouth() {
    const b = this.bell;
    return b ? [b.mouth[0], b.mouth[1], b.mouth[2]] : [this.x, this.sys.groundAt(this.x, this.z) + 8, this.z];
  }

  /** A toll is running. */
  get busy() { return this.stage !== 'idle'; }

  /** `crown` mode: the King may ring it now (idle, its period done). */
  get due() { return this.mode === 'crown' && this.stage === 'idle' && this.wait <= 0; }

  /** The mode the King's state asks for (or `base` without him). @returns {HushToll['mode']} */
  _mode() {
    const k = this.king;
    if (this.mode === 'silent') return 'silent';
    // (the crown broken — the campaign's flag, §2.5 — the Hush Bell is silent everywhere)
    if (this.sys.game?.story?.holds?.(CROWN_BROKEN)) return 'silent';
    if (!this.bell) return 'held';
    if (!k) return 'base';
    if (k.released) return 'silent';
    if (!k.alive) return 'base';
    const fighting = this.sys.bossFight === k && k.state !== 'dormant';
    if (!fighting) return 'base';
    if (k.state === 'intro' || k.phase <= 1) return 'held';
    return k.phase >= 3 ? 'crown' : 'court';
  }

  /** @param {HushToll['mode']} mode */
  _enter(mode) {
    const was = this.mode;
    this.mode = mode;
    if (mode === 'held' || mode === 'silent') this._cancel();
    if (mode === 'court') this.wait = 3;
    if (mode === 'crown') {
      this.wait = 4;
      this.douseAll();
    }
    if (mode === 'base') {
      this._cancel();
      this.wait = T.first;
      // a fight that ended without the King's defeat: the braziers it put out burn again
      if (was === 'court' || was === 'crown' || was === 'held') this.relight();
    }
  }

  /** The period of the current mode (s). */
  get period() {
    return this.mode === 'court' ? T.period.court : this.mode === 'crown' ? T.period.crown : T.period.base;
  }

  /**
   * One frame (`CombatPackSystem.frame`, after the enemies' visuals): nothing while the combat is
   * held (a menu, a talk off a set-piece level); in a story scene (`ambient`) no toll runs.
   * @param {number} dt real seconds
   * @param {boolean} active
   * @param {boolean} [ambient] a story scene holds the player (the toll waits; a running one stops)
   */
  frame(dt, active, ambient = false) {
    if (!active && !ambient) return;
    // (the fight's start: a save that caught a brazier dark — an autosave in phase 2 — lights them all)
    if (active && !this._started) {
      this._started = true;
      if (this.king?.alive && !this.king.released) this.relight();
    }
    const mode = this._mode();
    if (mode !== this.mode) this._enter(mode);
    if (mode === 'silent' || mode === 'held') return;
    if (ambient) {
      // (a scene: no toll runs under it; the next comes a while after it)
      if (this.busy) {
        this._cancel();
        this.wait = Math.max(this.wait, 3);
      }
      return;
    }
    this._frame++;
    if (this.douse) {
      this.douse.t -= dt;
      if (this.douse.t <= 0) {
        const d = this.douse;
        this.douse = null;
        this._putOut(d);
      }
    }
    if (this.stage === 'idle') {
      if (this.wait > 0) this.wait -= dt;
      // (`crown`: the King rings it — `start` — when it is `due`)
      if (this.wait <= 0 && mode !== 'crown') this.start();
      return;
    }
    this.t += dt;
    if (this.stage === 'beats') {
      const gap = T.beatF / 60;
      while (this.beat < T.beats && this.t >= this.beat * gap - 1e-6) this._beat(this.beat++);
      if (this.t >= T.beats * gap - 1e-6) {
        this.stage = 'wave';
        this.t = 0;
        this.R = 0;
      }
      return;
    }
    // the ring rolling out
    this.R += T.wave * dt;
    const P = this.sys.player.position;
    const dP = Math.hypot(P.x - this.x, P.z - this.z);
    this._drawWave();
    if (!this.landed && this.R >= dP) this._land();
    if (this.landed && this.R > dP + ARC * 1.5) this._end();
  }

  /** Begin a toll now (idle only). @returns {boolean} begun */
  start() {
    if (this.stage !== 'idle' || this.mode === 'silent' || this.mode === 'held') return false;
    this.stage = 'beats';
    this.t = 0;
    this.beat = 0;
    this.R = 0;
    this.landed = false;
    this.tolls++;
    // (the crown: relit braziers go out again on the first beat — the Toll bell is the only warmth)
    if (this.mode === 'crown') this.douseAll();
    return true;
  }

  /** @param {number} k the beat 0…2 */
  _beat(k) {
    const sys = this.sys;
    const ctx = this.ctx;
    this.bell?.ring(0.65 + 0.15 * k);
    const [mx, my, mz] = this.mouth;
    const P = sys.player.position;
    const d = Math.hypot(P.x - mx, P.z - mz);
    // its three strokes are one sound (0, 0.9, 1.8 s), heard over the whole level: the bell is far up
    // the mountain, never silent
    if (k === 0) sys.audio.playSfx('hushToll', { volume: Math.max(0.55, 1 - d / 90) });
    ctx.fx('evkRing', mx, my - 0.8, mz, { mode: 'billboard', lift: 0, color: [0.55, 0.85, 1.2], loops: 1, scale: 1.4 + 0.25 * k });
    ctx.burst('evkAsh', mx, my - 1, mz, 6);
    // the safe places, shown
    for (const w of this._zones()) {
      ctx.fx('evkWarm', w.x, sys.groundAt(w.x, w.z), w.z, { mode: 'flat', lift: 0.07, color: WARM_TINT, loop: true, duration: 0.42, scale: w.r / (WARM_PX / 16) });
    }
  }

  /** The warm zones now (the lit braziers, Linnet's Toll bell): the pulse's safe list. @returns {WarmthZone[]} */
  _zones() {
    return this.ctx.warmthZones?.() ?? [];
  }

  /** The ring reached the player: the pulse (the core's), the cold wind, the court's brazier. */
  _land() {
    this.landed = true;
    this.lands++;
    const ctx = this.ctx;
    const safe = this._zones();
    this.lastSafe = safe;
    // (instant and level-wide; its own ring off — this rolling ring was its warning)
    this.lastPulse = ctx.pulse?.({ at: [this.x, this.z], power: T.power, knock: T.knock, safe, look: null }) ?? null;
    const P = this.sys.player.position;
    this.sys.sfxAt('windGust', P.x, P.z, { volume: 0.55, pitch: 0.8 });
    if (this.mode === 'court') {
      // the lit brazier nearest the player gutters out after the ring has passed
      let best = null;
      let bd = Infinity;
      for (const c of this._lit(safe)) {
        const d = Math.hypot(c.x - P.x, c.z - P.z);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) this.douse = { flag: best.flag, x: best.x, z: best.z, t: T.douse };
    }
  }

  /** The toll is over: the next one after the period. */
  _end() {
    this._freeQuads();
    this.stage = 'idle';
    this.t = 0;
    this.R = 0;
    this.wait = this.period;
  }

  /** Stop a running toll at once (a scene, the King's phase 1, silence; a scene keeps the court's douse). */
  _cancel() {
    this._freeQuads();
    this.stage = 'idle';
    this.t = 0;
    this.R = 0;
    if (this.mode !== 'court') this.douse = null;
  }

  /**
   * The candidates lit now (a warm zone at their spot).
   * @param {{ x: number, z: number, r: number }[]} zones
   */
  _lit(zones) {
    // (a candidate is lit while a warm zone stands at its spot: its group is present)
    return this.candidates.filter((c) => zones.some((w) => Math.abs(w.x - c.x) < 0.6 && Math.abs(w.z - c.z) < 0.6));
  }

  /** Put every lit brazier out (the crown). */
  douseAll() {
    for (const c of this._lit(this._zones())) this._putOut({ flag: c.flag, x: c.x, z: c.z });
  }

  /** @param {{ flag: string, x: number, z: number }} d */
  _putOut(d) {
    const ctx = this.ctx;
    if (!ctx.setFlag?.(d.flag, 1)) return;
    this.set.add(d.flag);
    this.doused.push(d.flag);
    const y = this.sys.groundAt(d.x, d.z);
    ctx.burst('evkSmoke', d.x, y + 1.0, d.z, 8);
    ctx.burst('evkAsh', d.x, y + 0.8, d.z, 6);
    ctx.sfx('iceCrack', d.x, d.z, { volume: 0.8 });
  }

  /** The King is released: the Hush Bell falls silent for good (a running toll stops). */
  silence() {
    if (this.mode !== 'silent') this._enter('silent');
  }

  /** Every brazier this toll can put out burns again (a fight lost, the combat's reset, its start). */
  relight() {
    const ctx = this.ctx;
    for (const c of this.candidates) if (this.sys.game?.story?.holds?.(c.flag)) ctx.setFlag?.(c.flag, 0);
    this.set.clear();
  }

  /** The ring's quads along the arc the camera sees around the player. */
  _drawWave() {
    const sys = this.sys;
    if (!this._quads.length) {
      for (let i = 0; i < SEGMENTS; i++) this._quads.push(sys.quads.alloc());
    }
    const P = sys.player.position;
    const R = this.R;
    const bx = this.x, bz = this.z;
    const th0 = Math.atan2(P.z - bz, P.x - bx);
    const span = Math.min(Math.PI, ARC / Math.max(R, 1e-3));
    const spacing = (2 * span * R) / (SEGMENTS - 1);
    const q = this._q;
    const W = sys.tileMap.width, D = sys.tileMap.depth;
    for (let i = 0; i < SEGMENTS; i++) {
      const h = this._quads[i];
      if (h < 0) continue;
      const th = th0 + span * ((2 * i) / (SEGMENTS - 1) - 1);
      const cx = Math.cos(th), cz = Math.sin(th);
      const x = bx + R * cx, z = bz + R * cz;
      q.x = x;
      q.z = z;
      q.y = x >= 0 && z >= 0 && x <= W && z <= D ? sys.groundAt(x, z) + 0.07 : -999;
      q.dirX = cx;
      q.dirZ = cz;
      q.index = (this._frame >> 3) + i;
      q.scale = Math.max(0.55, Math.min(1.5, spacing / 1.7));
      // fading toward the ends of the arc shown, and while it is still small round the bell
      const arcAt = Math.abs(span * ((2 * i) / (SEGMENTS - 1) - 1)) * R;
      q.a = (R < 1 ? 0 : Math.min(1, (R - 1) / 2)) * Math.max(0, Math.min(1, (ARC - arcAt) / 6));
      sys.quads.set(h, q);
    }
    // frost ash thrown up at the front (two points a frame along the arc)
    for (let k = 0; k < 2; k++) {
      const i = (this._frame * 7 + k * 11) % SEGMENTS;
      const th = th0 + span * ((2 * i) / (SEGMENTS - 1) - 1);
      const x = bx + R * Math.cos(th), z = bz + R * Math.sin(th);
      if (x < 0 || z < 0 || x > W || z > D) continue;
      sys.burst('evkAsh', x, sys.groundAt(x, z) + 0.15, z, 1);
    }
  }

  _freeQuads() {
    for (const h of this._quads) if (h >= 0) this.sys.quads.free(h);
    this._quads.length = 0;
  }

  /** The combat's reset (the reset hook, a death reset): back to `base`, the braziers lit again. */
  reset() {
    this._cancel();
    this.relight();
    this.mode = this.king?.released ? 'silent' : 'base';
    this.wait = T.first;
  }

  dispose() {
    this._freeQuads();
    TOLLS.delete(this.sys.ctx);
  }

  /** For tests: the king suites read it through `__game.combat.system.systems` (COMBAT.md §30.19). */
  info() {
    return {
      id: this.id, mode: this.mode, stage: this.stage, t: +this.t.toFixed(3), R: +this.R.toFixed(2), wait: +this.wait.toFixed(2),
      period: this.period, tolls: this.tolls, lands: this.lands, landed: this.landed,
      candidates: this.candidates.length, lit: this._lit(this._zones()).length, doused: [...this.doused], set: [...this.set],
      safe: this.lastSafe.length,
    };
  }
}

/**
 * Register the toll as the pack's level system `hushToll` (COMBAT.md §30.1: a toll on every combat
 * level of the pack where a Hush Bell stands). (Typed with the API; the pack's index hands it the
 * registrar — `EnemyPackRegistrar`.)
 * @param {EnemyPackApi} api
 */
export function register(api) {
  /** @type {EnemyPackRegistrar} */ (api).registerSystem('hushToll', createHushToll);
}
