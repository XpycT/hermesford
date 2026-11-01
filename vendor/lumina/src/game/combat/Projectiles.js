import { SHOT_Y } from './rules.js';

/**
 * @import { LiveProjectile, ProjectileKind, ProjectileSpec } from './types.js'
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { FxQuadParams } from '../../engine/fx/FxQuads.js'
 * @import { Collider } from '../../engine/world/TileMap.js'
 * @import { Enemy } from './Enemy.js'
 * @import { MemberCombat } from '../party/MemberCombat.js'
 * @import { SfxName } from '../../engine/audio/AudioSystem.js'
 */

/**
 * Projectiles (COMBAT.md §7.6): one pool of 64 for arrows, the player's Ember Bolt and the boss's
 * boulders, drawn as FxQuads instances.
 *
 *  - Straight shots are swept circles, sub-stepped ≤ 0.25 u horizontally, with a vertical speed
 *    `vy` (the spawner aims with the height model: release at ground + 0.9, aim at the target's
 *    body middle) that they keep past the aim point until `range`. The height model blocks them
 *    where the ground rises above `y − 0.1` or inside a static collider.
 *  - A shot hits a target when the horizontal distance < radius + hurt radius and its vertical
 *    span [y − r, y + r] overlaps the target's body band. Player shots test the enemies, enemy
 *    shots the player, then the party's companions (PARTY.md §5.3); contacts are queued and
 *    resolved by the CombatSystem in its fixed order. Enemy shots fly through a player with
 *    i-frames (the perfect-dodge check sees them) and through a companion with i-frames.
 *  - A companion's shots (`spawn('player', spec, ally)`) are player shots owned by the companion
 *    (`owner` and `ally`): they test the enemies on the player's time scale and deal its damage.
 *  - Arc shots (`boulder`) never collide in flight: after `arc.time` they land at
 *    (tx, groundAt, tz) and resolve a circle hit there (melee height rule).
 *  - Vanquish the Evil Dragon (COMBAT.md §29): a shot may carry status effects and a feel (a
 *    companion's frost lance chills what it hits: copied into the contact) and its own `look` (a
 *    package's atlas frame, colour, spin, a particle trail along the flight and an impact burst /
 *    effect / sound) instead of its kind's. In the ambient step (`sys._ambient`) shots fly on and
 *    touch no one (they end at walls and at their range).
 */

const CAPACITY = 64;

/**
 * How a projectile kind ends (`LOOKS[kind].end`): a particle burst — `wall` particles at a wall,
 * `range` at the end of its range — and at a wall a sound.
 * @typedef {{ burst: string, wall: number, range: number, sfx?: SfxName, volume?: number, pitch?: number }} KindEnd
 */
/** The swarms' shots: sparks; at a wall a soft, high bolt hit. @type {Readonly<KindEnd>} */
const SWARM_END = Object.freeze({ burst: 'swarmSpark', wall: 5, range: 3, sfx: 'boltHit', volume: 0.45, pitch: 1.3 });
const SUBSTEP = 0.25;

/**
 * Look of each kind: atlas frame, quad mode, HDR colour, scale; `rot` turns the frame in its plane
 * (the atlas draws the arrow pointing +U; a flat quad's +V runs along the flight direction, so
 * `rot = π/2` lays the arrow along it); `end`: how a kind with one ends (`_expire`: a burst of
 * `wall` particles at a wall, `range` at the end of its range, a sound at a wall) — the arrow, the
 * Ember Bolt and the boulder keep their own code. The swarms' shots (the swarm package's frames,
 * src/engine/pixel/fx/swarmFx.js; DRAGON_CAMPAIGN.md §6.7): the imp's fire orb, the whelp's spit.
 * @type {Record<ProjectileKind, { frame: string, mode: 'flat'|'billboard', color: number[],
 *   scale: number, rot?: number, end?: Readonly<KindEnd> }>}
 */
const LOOKS = {
  arrow: { frame: 'arrow', mode: 'flat', color: [1.6, 1.35, 1.0], scale: 1, rot: Math.PI / 2 },
  emberBolt: { frame: 'emberBolt', mode: 'billboard', color: [3.2, 1.5, 0.5], scale: 1.2 },
  boulder: { frame: 'boulder', mode: 'billboard', color: [1.1, 0.95, 0.85], scale: 1.8 },
  swarmOrb: { frame: 'swarmOrb', mode: 'billboard', color: [2.4, 1.05, 0.32], scale: 1.0, end: SWARM_END },
  swarmSpit: { frame: 'swarmSpit', mode: 'billboard', color: [2.6, 0.95, 0.28], scale: 0.9, end: SWARM_END },
};
/** Every projectile kind (the showcase hook fires one of each). */
export const PROJECTILE_KINDS = Object.freeze(/** @type {ProjectileKind[]} */ (Object.keys(LOOKS)));

export class Projectiles {
  /**
   * @param {CombatSystem} sys the CombatSystem (tileMap, fx quads,
   *   contact queues, targets)
   */
  constructor(sys) {
    this.sys = sys;
    /** @type {LiveProjectile[]} the pool (CAPACITY records, reused) */
    this.items = [];
    for (let i = 0; i < CAPACITY; i++) {
      this.items.push({
        alive: false, owner: null, player: false, ally: null, kind: 'arrow', x: 0, y: 0, z: 0, dirX: 0, dirZ: 1, vy: 0,
        speed: 0, range: 0, traveled: 0, radius: 0.2, mv: 1, kb: 0, poise: 0, pierce: false,
        splash: null, splashTag: 0, arc: null, sx: 0, sy: 0, sz: 0, ty: 0, t: 0, tag: 0, h: -1, age: 0, serial: 0,
        _arc: { tx: 0, tz: 0, time: 0, apex: 2 },
        chill: 0, slow: 0, freeze: 0, stun: 0, mark: 0, consume: 0, feel: null, look: null, trailT: 0,
      });
    }
    this._serial = 0;
    /** @type {FxQuadParams} scratch parameters for FxQuads#set */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1 };
    /** @type {Collider[]} `queryColliders` scratch */
    this._colliders = [];
    this._count = 0;
  }

  get count() { return this._count; }

  /**
   * Launch a projectile (ProjectileSpec, §9.5).
   * @param {Enemy|'player'|'fx'} owner the shooter ('fx': a showcase shot
   *   that touches nothing)
   * @param {ProjectileSpec} spec
   * @param {MemberCombat|null} [ally] a party companion's shot (owner 'player': it tests the
   *   enemies on the player's time scale; the companion becomes its owner and deals its damage)
   * @returns {number} handle, or −1 when the pool is full
   */
  spawn(owner, spec, ally = null) {
    let slot = -1;
    for (let i = 0; i < CAPACITY; i++) if (!this.items[i].alive) { slot = i; break; }
    if (slot < 0) return -1;
    const p = this.items[slot];
    const len = Math.hypot(spec.dirX ?? 0, spec.dirZ ?? 1) || 1;
    p.alive = true;
    p.owner = ally ?? owner;
    p.player = owner === 'player';
    p.ally = ally;
    p.kind = LOOKS[spec.kind] ? spec.kind : 'arrow';
    p.x = spec.x;
    p.y = spec.y;
    p.z = spec.z;
    p.dirX = (spec.dirX ?? 0) / len;
    p.dirZ = (spec.dirZ ?? 1) / len;
    p.vy = spec.vy ?? 0;
    p.speed = spec.speed ?? 10;
    p.range = spec.range ?? 12;
    p.traveled = 0;
    p.radius = spec.radius ?? 0.2;
    p.mv = spec.mv ?? 1;
    p.kb = spec.kb ?? 0;
    p.poise = spec.poise ?? 0;
    p.pierce = !!spec.pierce;
    p.splash = spec.splash ?? null;
    // (a player-side shot's status effects and feel; any shot's own look: §29)
    p.chill = num(spec.chill);
    p.slow = num(spec.slow);
    p.freeze = num(spec.freeze);
    p.stun = num(spec.stun);
    // (resonance marks: put on, or consumed by, what it hits — COMBAT.md §30.4)
    p.mark = num(spec.mark);
    p.consume = num(spec.consume);
    p.feel = spec.feel ?? null;
    p.look = spec.look && typeof spec.look.frame === 'string' ? spec.look : null;
    p.trailT = 0;
    if (spec.arc) {
      const a = p._arc;
      a.tx = spec.arc.tx;
      a.tz = spec.arc.tz;
      a.time = Math.max(0.05, spec.arc.time);
      a.apex = spec.arc.apex ?? 2;
      p.arc = a;
    } else p.arc = null;
    p.sx = spec.x;
    p.sy = spec.y;
    p.sz = spec.z;
    p.ty = p.arc ? this.sys.groundAt(p.arc.tx, p.arc.tz) : 0;
    p.t = 0;
    p.age = 0;
    p.serial = ++this._serial;
    p.tag = this.sys.tags.next();
    p.splashTag = p.splash ? this.sys.tags.next() : 0;
    p.h = this.sys.quads.alloc();
    this._count++;
    this._write(p);
    return slot;
  }

  /**
   * Advance every projectile one sub-step and queue contacts.
   * @param {number} hPlayer player-scaled seconds
   * @param {number} hEnemy enemy-scaled seconds
   */
  step(hPlayer, hEnemy) {
    if (!this._count) return;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      const h = p.player ? hPlayer : hEnemy;
      p.age += h;
      this.sys.tags.keep(p.tag, this.sys.stepNo);
      if (p.arc) this._stepArc(p, h);
      else this._stepStraight(p, h);
      if (p.alive && p.look?.trail) this._trail(p, h);
    }
  }

  /**
   * A look's particle trail: one burst every `trailEvery` s of flight.
   * @param {LiveProjectile} p
   * @param {number} h
   */
  _trail(p, h) {
    const L = p.look;
    p.trailT -= h;
    if (p.trailT > 0) return;
    p.trailT += Math.max(0.016, L.trailEvery ?? 0.05);
    if (p.trailT <= 0) p.trailT = Math.max(0.016, L.trailEvery ?? 0.05);
    this.sys.burst(L.trail, p.x, p.y, p.z, L.trailCount ?? 2);
  }

  /**
   * A shot with its own look ended (a target, a wall, a landing): its impact burst, effect and
   * sound (`ProjectileLook.hit*`). Returns false for a shot without one (the kind's impact plays).
   * @param {LiveProjectile|import('./types.js').ProjectileContact} p the shot or its contact
   * @returns {boolean}
   */
  impact(p) {
    const L = p.look;
    if (!L) return false;
    const sys = this.sys;
    if (L.hitBurst) sys.burst(L.hitBurst, p.x, p.y, p.z, L.hitCount ?? 8);
    if (L.hitFx) sys.fx.play(L.hitFx, p.x, sys.groundAt(p.x, p.z), p.z, L.hitFxScale ? { scale: L.hitFxScale } : undefined);
    if (L.hitSfx) sys.sfxAt(L.hitSfx, p.x, p.z, { volume: L.hitVolume ?? 0.8, pitch: L.hitPitch ?? 1 });
    return true;
  }

  /** @param {LiveProjectile} p @param {number} h */
  _stepStraight(p, h) {
    const sys = this.sys;
    const tm = sys.tileMap;
    const dist = p.speed * h;
    const n = Math.max(1, Math.ceil(dist / SUBSTEP));
    const dd = dist / n;
    const dy = (p.vy * h) / n;
    for (let k = 0; k < n; k++) {
      p.x += p.dirX * dd;
      p.z += p.dirZ * dd;
      p.y += dy;
      p.traveled += dd;
      // the height model: the ground, map edges and static colliders stop the shot
      if (p.x < 0 || p.z < 0 || p.x > tm.width || p.z > tm.depth) { this._expire(p, false); return; }
      if (tm.getHeight(p.x, p.z) > p.y - 0.1 || this._inCollider(p.x, p.z)) { this._expire(p, true); return; }
      if (this._contact(p)) return;
      if (p.traveled >= p.range) { this._expire(p, false); return; }
    }
    this._write(p);
  }

  /** @param {LiveProjectile} p @param {number} h */
  _stepArc(p, h) {
    const a = p.arc;
    p.t += h;
    const u = Math.min(1, p.t / a.time);
    p.x = p.sx + (a.tx - p.sx) * u;
    p.z = p.sz + (a.tz - p.sz) * u;
    const base = p.sy + (p.ty - p.sy) * u;
    p.y = base + a.apex * 4 * u * (1 - u);
    if (u >= 1) {
      // landing: a circle hit at the target point (melee height rule)
      this.sys.queueLanding(p);
      this._free(p);
      return;
    }
    this._write(p);
  }

  /**
   * Test the shot's targets; true when it was consumed.
   * @param {LiveProjectile} p
   * @returns {boolean}
   */
  _contact(p) {
    const sys = this.sys;
    // showcase shots touch nothing; nor does any shot in the ambient step (a scene hurts no one)
    if (p.owner === 'fx' || sys._ambient) return false;
    if (p.player) {
      const list = sys.enemies;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive || e.dormant || !e.sprite.visible || e.submerged) continue;
        const dx = e.position.x - p.x;
        const dz = e.position.z - p.z;
        const rr = p.radius + e.radius;
        if (dx * dx + dz * dz >= rr * rr) continue;
        const base = sys.bodyBase(e);
        const b = e.def.body;
        if (p.y + p.radius < base + b[0] || p.y - p.radius > base + b[1]) continue;
        if (sys.tags.has(p.tag, e)) continue;
        sys.queueProjectileHit(p, e);
        if (!p.pierce) { this._free(p); return true; }
      }
      return false;
    }
    if (this._contactPlayer(p)) return true;
    // then the party's companions (PARTY.md §5.3)
    return sys.allies.length > 0 && this._contactAllies(p);
  }

  /**
   * An enemy shot against the player; true when it was consumed.
   * @param {LiveProjectile} p
   * @returns {boolean}
   */
  _contactPlayer(p) {
    const sys = this.sys;
    const pl = sys.player;
    if (!sys.pc.alive) return false;
    const dx = pl.position.x - p.x;
    const dz = pl.position.z - p.z;
    const rr = p.radius + pl.radius;
    if (dx * dx + dz * dz >= rr * rr) return false;
    const base = pl.position.y;
    if (p.y + p.radius < base || p.y - p.radius > base + sys.pc.body[1]) return false;
    if (sys.tags.has(p.tag, 'player')) return false;
    // a rolling player: the shot flies through (and may count as a perfect dodge)
    if (sys.pc.invulnerable) {
      sys.tags.add(p.tag, 'player', sys.stepNo);
      sys.pc.notePerfectDodge();
      return false;
    }
    sys.queueProjectileHit(p, 'player');
    if (!p.pierce) { this._free(p); return true; }
    return false;
  }

  /**
   * An enemy shot against the companions (join order), after the player: a companion with
   * i-frames lets it fly through; true when it was consumed.
   * @param {LiveProjectile} p
   * @returns {boolean}
   */
  _contactAllies(p) {
    const sys = this.sys;
    const A = sys.allies;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (!a.present) continue;
      const q = a.position;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const rr = p.radius + a.radius;
      if (dx * dx + dz * dz >= rr * rr) continue;
      if (p.y + p.radius < q.y + a.view.body[0] || p.y - p.radius > q.y + a.view.body[1]) continue;
      if (sys.tags.has(p.tag, a)) continue;
      if (!a.hittable) {
        sys.tags.add(p.tag, a, sys.stepNo);
        continue;
      }
      sys.queueProjectileHit(p, a);
      if (!p.pierce) { this._free(p); return true; }
    }
    return false;
  }

  /** @param {number} x @param {number} z @returns {boolean} */
  _inCollider(x, z) {
    const tm = this.sys.tileMap;
    const cs = tm.queryColliders(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this._colliders);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) return true;
      } else if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  }

  /**
   * The shot ends: against the world (`wall`) or out of range.
   * @param {LiveProjectile} p
   * @param {boolean} wall
   */
  _expire(p, wall) {
    const sys = this.sys;
    const end = LOOKS[p.kind].end;
    if (p.look) {
      // (its own impact at a wall, its fade at the end of its range; a bolt's splash as before)
      if (wall) {
        this.impact(p);
        if (p.splash) sys.queueSplash(p);
      } else if (p.look.fadeBurst) sys.burst(p.look.fadeBurst, p.x, p.y, p.z, p.look.fadeCount ?? 3);
    } else if (end) {
      sys.burst(end.burst, p.x, p.y, p.z, wall ? end.wall : end.range);
      if (wall && end.sfx) sys.sfxAt(end.sfx, p.x, p.z, { volume: end.volume ?? 1, pitch: end.pitch ?? 1 });
    } else if (wall) {
      if (p.kind === 'emberBolt') {
        sys.fx.play('impact', p.x, p.y - 1.0, p.z, { scale: 0.8 });
        sys.burst('emberBurst', p.x, p.y, p.z, 6);
        sys.sfxAt('boltHit', p.x, p.z);
        if (p.splash) sys.queueSplash(p);
      } else {
        sys.burst('footstep', p.x, p.y, p.z, 3);
        sys.sfxAt('arrowHit', p.x, p.z, { volume: 0.5 });
      }
    } else if (p.kind === 'emberBolt') {
      sys.burst('emberBurst', p.x, p.y, p.z, 4);
    }
    this._free(p);
  }

  /** @param {LiveProjectile} p */
  _free(p) {
    if (!p.alive) return;
    p.alive = false;
    p.owner = null;
    p.ally = null;
    p.feel = null;
    p.look = null;
    if (p.h >= 0) this.sys.quads.free(p.h);
    p.h = -1;
    this._count--;
  }

  /** @param {LiveProjectile} p */
  _write(p) {
    if (p.h < 0) return;
    const q = this._p;
    q.x = p.x;
    q.y = p.y;
    q.z = p.z;
    q.dirX = p.dirX;
    q.dirZ = p.dirZ;
    q.a = 1;
    const own = p.look;
    if (own) {
      // a package's look (§29 V10)
      const fr = this.sys.atlasFrames?.[own.frame];
      q.frame = own.frame;
      q.index = fr && fr.n > 1 ? Math.floor(p.age * (own.fps || fr.fps || 8)) % fr.n : 0;
      q.scale = own.scale ?? 1;
      q.rot = (own.rot ?? 0) + (own.spin ?? 0) * p.age;
      q.mode = own.mode === 'flat' ? 'flat' : 'billboard';
      const c = own.color;
      q.r = c?.[0] ?? 1;
      q.g = c?.[1] ?? 1;
      q.b = c?.[2] ?? 1;
      this.sys.quads.set(p.h, q);
      return;
    }
    const L = LOOKS[p.kind];
    q.frame = L.frame;
    const fr = this.sys.atlasFrames?.[L.frame];
    q.index = fr && fr.n > 1 ? Math.floor(p.age * (fr.fps || 8)) % fr.n : 0;
    q.scale = L.scale;
    q.rot = p.kind === 'boulder' ? p.age * 6 : L.rot ?? 0;
    q.mode = L.mode;
    q.r = L.color[0];
    q.g = L.color[1];
    q.b = L.color[2];
    this.sys.quads.set(p.h, q);
  }

  /**
   * Remove every projectile of `owner` (an enemy sent home by the boss intro, a companion that left).
   * @param {Enemy|'player'|'fx'|MemberCombat} owner
   */
  removeOwner(owner) {
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.items[i];
      if (p.alive && p.owner === owner) this._free(p);
    }
  }

  /** Remove the enemies' projectiles (boss intro keeps the player's). */
  clearEnemy() {
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.items[i];
      if (p.alive && !p.player) this._free(p);
    }
  }

  clear() {
    for (let i = 0; i < CAPACITY; i++) this._free(this.items[i]);
  }
}

/**
 * A seconds field of a spec (level / caller data): a finite number ≥ 0 (≤ 30), else 0.
 * @param {unknown} v
 * @returns {number}
 */
function num(v) {
  return typeof v === 'number' && v > 0 ? Math.min(30, v) : 0;
}

/**
 * The vertical speed of a straight shot from height `y` aimed at `aimY` over a horizontal
 * distance (COMBAT.md §7.6).
 * @param {number} y
 * @param {number} aimY
 * @param {number} speed
 * @param {number} horizontalDist
 * @returns {number}
 */
export function aimVy(y, aimY, speed, horizontalDist) {
  const v = ((aimY - y) * speed) / Math.max(0.5, horizontalDist);
  return Math.max(-0.6 * speed, Math.min(0.6 * speed, v));
}

export { SHOT_Y };
