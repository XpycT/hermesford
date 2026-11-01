/**
 * The combat core's part of The Bells of Evermere's enemy pack (docs/contracts/COMBAT.md §30): what
 * the core gives this campaign only, kept out of the CombatSystem chunk every combat level downloads
 * — loaded with the pack (../index.js `ENEMY_PACKS.evermere` imports it beside ./index.js) and
 * registered before the pack's kinds:
 * - the ice gate's FX frames (src/engine/pixel/fx/evCoreFx.js, generation 3);
 * - the marker styles `frost` and `crack` (their GLSL, `api.registerMarkerStyles`);
 * - the victory words of a release (`combatEv.*`, en / ja / zh) the pack's boss defs name;
 * - `EvCore`, a level system (`registerSystem('core', …)`) that makes `CombatSystem.ev` on a level
 *   with the pack: the submerged fades (`ctx.submerge` / `ctx.surface`, §30.5), the pulse with safe
 *   zones and its rings (`ctx.pulse`, §30.8) and the resonance marks drawn over the foes
 *   (`marksLook`, §30.4).
 * Owner: the core package.
 *
 * What a boss def of the pack sets to use them (COMBAT.md §30.2, §30.7):
 *   arena: { wall: { frames: 'evIceWall', color: [0.3, 0.68, 1.0] }, emitter: { preset: 'embers',
 *     … rime motes }, outline: 'frost' } (EV_ARENA below),
 *   victory: { title: 'combatEv.victory.title', line: 'combatEv.victory.<kind>', drop: … },
 *   release: true
 * (the defs files stay import-free: they copy the literal; `EV_ARENA` is the reference).
 *
 * @import { EnemyPackRegistrar } from '../index.js'
 * @import { BossArenaLook, PulseSpec, PulseResult, PointXZ, MarkerStyle, CombatPackSystem } from '../../types.js'
 * @import { CombatSystem } from '../../CombatSystem.js'
 * @import { MemberCombat } from '../../../party/MemberCombat.js'
 * @import { Enemy } from '../../Enemy.js'
 */
import { registerStrings, hasStrings } from '../../../../engine/i18n/I18n.js';
import * as evCoreFx from '../../../../engine/pixel/fx/evCoreFx.js';

/**
 * Evermere's ice arena (§30.2): the gate a row of cut-out ice shards (frost-blue, below bloom), the
 * phase-2 emitter rime motes rising slowly (the embers' program: point / emit / additive — dim, cold,
 * never white on snow), the outline the frost barrier.
 * @type {Readonly<BossArenaLook>}
 */
export const EV_ARENA = Object.freeze({
  wall: Object.freeze({ frames: 'evIceWall', color: Object.freeze([0.3, 0.68, 1.0]) }),
  emitter: Object.freeze({
    preset: 'embers', color: '#9fe6ff', colorEnd: '#3f7fc0', hdr: 1.25, size: Object.freeze([0.06, 0.1]),
    velocity: Object.freeze([0, 0.55, 0]), gravity: -0.05, twinkle: 0.6, count: 70,
  }),
  outline: 'frost',
});

/**
 * The marker styles (§30.6), spliced into GroundMarkers' fragment shader (its locals: see
 * `registerMarkerStyles`). Linear HDR, all below the bloom threshold.
 * - `frost` (5): an ice telegraph that reads on snow — a dark ink texel (0.03, 0.08, 0.16) outside a
 *   cyan line (0.22, 0.7, 1.05) that turns pale ice (0.62, 0.92, 1.05) at progress 1, a cyan fill
 *   (0.14, 0.5, 0.9) with a dark diagonal hatch every 4th world texel, alpha 0.24 → 0.5; a rect is
 *   the ice barrier (its outline: the dark texel outside a pulsing blue (0.2, 0.6, 0.95) one).
 * - `crack` (6): a lane of cracking ice — a jagged dark fissure down the lane (spokes from the
 *   centre for a round shape) with short branches and cyan-lit edges, grown with the progress, a
 *   dashed dark rim, a pale ice fill 0.12 → 0.3; at progress 1 the fissure glows cyan (0.45, 1.1, 1.35).
 */
const MARKER_GLSL = /* glsl */ `
	} else if ( style == 5 ) {
		bool outer = sd > - TX;
		if ( shape == 4 ) {
			if ( outer ) { col = vec3( 0.03, 0.08, 0.16 ); a = 0.9; }
			else if ( rim ) { col = vec3( 0.2, 0.6, 0.95 ) * ( 0.75 + 0.5 * pulse ); a = 0.95; }
		} else if ( rim ) {
			col = outer ? vec3( 0.03, 0.08, 0.16 ) : mix( vec3( 0.22, 0.7, 1.05 ) * ( 0.85 + 0.25 * pulse ), vec3( 0.62, 0.92, 1.05 ), flash );
			a = 0.92;
		} else if ( lead ) { col = vec3( 0.55, 1.15, 1.35 ); a = 0.85; }
		else {
			float hatch = mod( floor( pq.x * 16.0 ) + floor( pq.y * 16.0 ), 4.0 ) < 1.0 ? 1.0 : 0.0;
			col = mix( vec3( 0.14, 0.5, 0.9 ), vec3( 0.03, 0.12, 0.28 ), hatch );
			a = filled ? mix( 0.24, 0.5, prog ) : 0.1;
		}
	} else if ( style == 6 ) {
		float wob;
		float br = 1e3;
		if ( shape == 3 ) {
			float w = ( gmNoise( vec2( along * 1.7, 3.1 ) ) - 0.5 ) * p1 * 0.45;
			wob = abs( across - w );
			float seg = floor( along * 1.25 );
			float fa = fract( along * 1.25 ) * 0.8;
			if ( gmHash( vec2( seg, 4.3 ) ) < 0.6 && fa < 0.45 ) br = abs( across - w - ( gmHash( vec2( seg, 9.7 ) ) < 0.5 ? - fa : fa ) );
		} else {
			float k = ang / 6.2831853 * 7.0;
			float w = ( gmNoise( vec2( dist * 2.0, floor( k + 0.5 ) * 7.3 ) ) - 0.5 ) * 0.5;
			wob = abs( fract( k + 0.5 ) - 0.5 - w ) * dist * 0.8976;
		}
		bool fissure = wob < 1.2 * TX || br < 0.9 * TX;
		if ( rim && shape != 4 ) {
			if ( fract( dash ) < 0.55 ) { col = vec3( 0.03, 0.08, 0.16 ); a = 0.8; }
		} else if ( fissure ) {
			if ( filled ) { col = mix( vec3( 0.02, 0.05, 0.1 ), vec3( 0.45, 1.1, 1.35 ), flash ); a = 0.95; }
			else { col = vec3( 0.1, 0.2, 0.3 ); a = 0.3; }
		} else if ( lead ) { col = vec3( 0.55, 1.15, 1.35 ); a = 0.8; }
		else if ( filled && wob < 2.6 * TX ) { col = vec3( 0.3, 0.84, 1.1 ) * ( 0.8 + 0.3 * pulse ); a = 0.75; }
		else if ( shape != 4 ) { col = vec3( 0.35, 0.7, 0.95 ); a = filled ? mix( 0.12, 0.3, prog ) : 0.06; }`;

/** The release's words (§30.7): the banner's title and one line per boss of the pack. */
const STRINGS = {
  en: {
    'victory.title': 'Freed',
    'victory.rimehart': 'The frost lets the stag go',
    'victory.gullet': 'The bay is quiet again',
    'victory.mawkin': "The field's long watch is over",
    'victory.hushedking': 'The crown of frost is broken',
  },
  ja: {
    'victory.title': '解放',
    'victory.rimehart': '霜は牡鹿を手放した',
    'victory.gullet': '湾に静けさが戻った',
    'victory.mawkin': '畑の長い見張りは終わった',
    'victory.hushedking': '霜の冠は砕けた',
  },
  zh: {
    'victory.title': '解放',
    'victory.rimehart': '冰霜放开了雄鹿',
    'victory.gullet': '海湾重归平静',
    'victory.mawkin': '田野漫长的守望结束了',
    'victory.hushedking': '霜之冠已然破碎',
  },
};

/** Mark quads drawn at once (three on each of eight foes) and pulse rings at once. */
const MARK_QUADS = 24;
const PULSE_RINGS = 4;
/** The submerged fade (12 f each way). */
const SUBMERGE_S = 12 / 60;

/**
 * Where a pulse's `at` points (`[x, z]` or `{ x, z }`), else `fallback`.
 * @param {PulseSpec['at']} at
 * @param {PointXZ} fallback
 * @returns {PointXZ}
 */
function pointOf(at, fallback) {
  if (Array.isArray(at) && Number.isFinite(at[0]) && Number.isFinite(at[1])) return { x: at[0], z: at[1] };
  const p = /** @type {PointXZ} */ (at);
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return { x: p.x, z: p.z };
  return { x: fallback.x, z: fallback.z };
}

/**
 * The core's Evermere system on a level with the pack (`CombatSystem.ev`): the submerged fades,
 * the pulse and its rings, the marks over the foes. No RNG drawn.
 * @implements {CombatPackSystem}
 */
export class EvCore {
  /** @param {CombatSystem} sys */
  constructor(sys) {
    this.sys = sys;
    /** The pulse rings growing now: marker handle, centre, radius, end, speed, width, style, alpha. */
    this._rings = [];
    /** The mark quads' handles and their reused parameters. @type {number[]} */
    this._markH = [];
    this._markP = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1 };
    /** The submerged fades running: enemy → 1 going under, −1 coming up. @type {Map<Enemy, number>} */
    this._fades = new Map();
    sys.ev = this;
  }

  /**
   * `CombatSystem.submerge` (§30.5): under — guarded, out of the hit loops (`e.submerged`), its
   * sprite fading out over 12 f (`SUBMERGE_S`), then not drawn.
   * @param {Enemy} e
   */
  submerge(e) {
    e.submerged = true;
    e.guarded = true;
    e.sprite.visible = true;
    this._fades.set(e, 1);
  }

  /**
   * `CombatSystem.surface` (§30.5): up again, at (x, z) when given — drawn, hittable at once, fading
   * in over 12 f.
   * @param {Enemy} e
   * @param {number} [x]
   * @param {number} [z]
   */
  surface(e, x, z) {
    if (!e?.alive) return;
    if (Number.isFinite(x) && Number.isFinite(z)) e.position.set(x, this.sys.groundAt(x, z), z);
    if (!e.submerged && !this._fades.has(e)) return;
    e.submerged = false;
    if (e.state !== 'return' && e.state !== 'dormant') e.guarded = false;
    e.sprite.visible = true;
    this._fades.set(e, -1);
  }

  /**
   * Every sub-step (active and ambient): the submerged fades — the opacity toward its end, the sprite
   * hidden once under. A foe reset or fallen meanwhile leaves the fade.
   * @param {number} h
   */
  update(h) {
    if (!this._fades.size) return;
    for (const [e, dir] of this._fades) {
      if (!e.alive || (dir > 0) !== e.submerged) {
        this._fades.delete(e);
        continue;
      }
      const o = Math.min(1, Math.max(0, e.sprite.opacity - dir * (h / SUBMERGE_S)));
      e.sprite.opacity = o;
      if (dir > 0 ? o <= 0 : o >= 1) {
        if (dir > 0) e.sprite.visible = false;
        this._fades.delete(e);
      }
    }
  }

  /**
   * `CombatSystem.pulse` (§30.8): see its comment.
   * @param {PulseSpec} spec
   * @returns {PulseResult}
   */
  pulse(spec) {
    const sys = this.sys;
    /** @type {PulseResult} */
    const out = { harmful: false, player: false, allies: 0, spared: 0 };
    if (!spec) return out;
    const P = sys.player.position;
    const c = pointOf(spec.at, P);
    const R = Number.isFinite(spec.radius) && spec.radius > 0 ? spec.radius : Infinity;
    if (spec.look !== null) this._ring(c, R, spec.look ?? {});
    out.harmful = sys.engaged && sys._wasActive && !sys._ambient;
    if (!out.harmful) return out;
    const safe = Array.isArray(spec.safe) ? spec.safe : [];
    const power = Math.max(0, Math.round(Number(spec.power) || 0));
    const knock = Math.max(0, Number(spec.knock) || 0);
    /** @type {(x: number, z: number) => boolean} caught: within its reach, in no safe disc */
    const caught = (x, z) => {
      if (Math.hypot(x - c.x, z - c.z) > R) return false;
      for (const s of safe) if (s && Math.hypot(x - s.x, z - s.z) <= s.r) { out.spared++; return false; }
      return true;
    };
    if (sys.pc.alive && !sys.god && caught(P.x, P.z) && sys.pc.hittable) {
      this._hit(null, power, knock, c);
      out.player = true;
    }
    for (const a of sys.allies) {
      if (!a.present || !a.hittable || a.down || a.gone) continue;
      if (!caught(a.position.x, a.position.z)) continue;
      this._hit(a, power, knock, c);
      out.allies++;
    }
    sys.events.emit('pulse', out);
    return out;
  }

  /**
   * One pulse hit: flat damage (a ward takes its share), a knock-down push when `knock` > 0.
   * @param {MemberCombat|null} a  null: the player
   * @param {number} power
   * @param {number} knock
   * @param {PointXZ} c the pulse's centre
   */
  _hit(a, power, knock, c) {
    const sys = this.sys;
    const p = a ? a.position : sys.player.position;
    let dx = p.x - c.x;
    let dz = p.z - c.z;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = 0; dz = 1; }
    const wf = sys._wards.length ? sys.wardFrac : 0;
    const damage = power > 0 ? Math.max(1, Math.round(power * (1 - wf))) : 0;
    if (wf > 0 && damage > 0) sys._wardGlint(p);
    if (a) {
      if (damage > 0 || knock > 0) a.takeHit(damage, knock, dx, dz, knock > 0);
      if (damage > 0) sys.number(p.x, p.y + 1.9, p.z, String(damage), 'hurt');
      sys.events.emit('allyHurt', a.id, damage);
      return;
    }
    const pc = sys.pc;
    if (damage > 0 || knock > 0) pc.hurt({ damage, kb: knock, kbDirX: dx, kbDirZ: dz, knockdown: knock > 0 });
    if (damage > 0) {
      sys.number(p.x, p.y + 1.9, p.z, String(damage), 'hurt');
      sys.look.pulseHurt();
      sys.sfxAt('hurt', p.x, p.z, { volume: 1 });
      sys.events.emit('hit', 'player', damage, false, 'hazard');
      if (pc.alive) sys.events.emit('playerHurt', damage);
    }
    sys.hurtShake(knock > 0);
  }

  /**
   * A pulse's ring: a ground ring marker of `look.style` growing from (c) to `look.max` u (the
   * pulse's reach, else 30) at `look.speed` u/s. At most `PULSE_RINGS` at once (the oldest gives way).
   * @param {PointXZ} c
   * @param {number} R
   * @param {NonNullable<PulseSpec['look']>} look
   */
  _ring(c, R, look) {
    const sys = this.sys;
    if (this._rings.length >= PULSE_RINGS) this._ringEnd(0);
    const h = sys.markerAllocCore();
    if (h < 0) return;
    const max = Number.isFinite(look.max) && look.max > 0 ? look.max : Number.isFinite(R) ? R : 30;
    this._rings.push({
      h, x: c.x, z: c.z, r: 0, max, speed: Number.isFinite(look.speed) && look.speed > 0 ? look.speed : 24,
      width: Number.isFinite(look.width) && look.width > 0 ? look.width : 0.7,
      style: /** @type {MarkerStyle} */ (look.style ?? 'frost'), alpha: Number.isFinite(look.alpha) ? Math.min(1, Math.max(0, look.alpha)) : 1,
    });
    this._ringsStep(0);
  }

  /** @param {number} i a ring of `_rings` ends: its marker freed */
  _ringEnd(i) {
    this.sys.markerFreeCore(this._rings[i].h);
    this._rings.splice(i, 1);
  }

  /**
   * The rings grow (real seconds; held while the combat does not run) and fade over their last fifth.
   * @param {number} dt
   */
  _ringsStep(dt) {
    const s = this.sys._markerSpec;
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const g = this._rings[i];
      g.r += g.speed * dt;
      if (g.r >= g.max) {
        this._ringEnd(i);
        continue;
      }
      const r = Math.max(g.width, g.r);
      s.shape = 'ring';
      s.x = g.x;
      s.z = g.z;
      s.r = r;
      s.rInner = Math.max(0, r - g.width);
      s.progress = 1;
      s.style = g.style;
      s.alpha = g.alpha * Math.min(1, (g.max - g.r) / (g.max * 0.2));
      this.sys.markerSetCore(g.h, s);
    }
  }

  /**
   * The resonance marks over the foes (`sys.marksLook`, §30.4): `marks` quads in a row over each
   * marked foe drawn, at most `MARK_QUADS`; no look: none (the quads freed).
   */
  _drawMarks() {
    const sys = this.sys;
    const L = sys.marksLook;
    const H = this._markH;
    let n = 0;
    if (L) {
      const p = this._markP;
      p.frame = L.frame;
      p.scale = L.scale;
      p.r = L.color[0];
      p.g = L.color[1];
      p.b = L.color[2];
      const m = sys.engine.camera.matrixWorld.elements;
      const rl = Math.hypot(m[0], m[2]) || 1;
      const rx = m[0] / rl;
      const rz = m[2] / rl;
      for (let i = 0; i < sys.enemies.length && n < MARK_QUADS; i++) {
        const e = sys.enemies[i];
        if (!(e.marks > 0) || !e.alive || !e.sprite.visible || e.submerged) continue;
        const y = sys.bodyBase(e) + e.def.body[1] + L.lift;
        for (let k = 0; k < e.marks && n < MARK_QUADS; k++, n++) {
          const o = (k - (e.marks - 1) / 2) * L.spacing;
          p.x = e.position.x + rx * o;
          p.y = y;
          p.z = e.position.z + rz * o;
          if (n >= H.length) {
            const h = sys.quads.alloc();
            if (h < 0) break;
            H.push(h);
          }
          sys.quads.set(H[n], p);
        }
      }
    }
    while (H.length > n) sys.quads.free(/** @type {number} */ (H.pop()));
  }

  /**
   * Every frame (CombatSystem.afterPlayer, before the batches upload): the rings grow while the
   * combat runs (a scene's ambient step too), the marks follow their foes.
   * @param {number} dt
   * @param {boolean} active
   * @param {boolean} [ambient]
   */
  frame(dt, active, ambient = false) {
    if (this._rings.length) this._ringsStep(active || ambient ? dt : 0);
    if (this.sys.marksLook || this._markH.length) this._drawMarks();
  }

  /** The combat goes (its quads and markers with it). */
  dispose() {
    if (this.sys.ev === this) this.sys.ev = null;
    this._rings.length = 0;
    this._markH.length = 0;
    this._fades.clear();
  }

  /** For tests: the rings growing, the mark quads drawn, the submerged fades running. */
  info() {
    return { rings: this._rings.length, markQuads: this._markH.length, fades: this._fades.size };
  }
}

/**
 * Register the core's part of the pack (../index.js, once per page, before the pack's kinds; in the
 * editor the frames and the system are ignored or never made, the strings and styles harmless).
 * @param {EnemyPackRegistrar} api
 */
export function register(api) {
  api.registerFxModule(evCoreFx);
  api.registerMarkerStyles({ frost: 5, crack: 6 }, MARKER_GLSL);
  if (!hasStrings('combatEv')) registerStrings('combatEv', STRINGS);
  api.registerSystem('core', (sys) => new EvCore(sys));
}
