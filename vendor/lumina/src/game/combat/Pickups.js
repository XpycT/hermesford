/**
 * Pickups (COMBAT.md §7.8): coins, hearts, mana motes, draughts, upgrades and the Cinderheart
 * core — one pool of 64 FxQuads-drawn records.
 *
 *  - They pop out of the death point on a ballistic arc (0.4 s, 0.6–1.4 u, seeded by the loot
 *    RNG) onto standable ground: when the seeded point is not standable, the landing steps from
 *    the death point toward the player in 0.25 u increments (fallback: the player's position).
 *    A death point that is itself not standable (a bat over a pond) magnetises its pickups at once
 *    with the magnet radius doubled.
 *  - After 0.3 s they are magnetised within 2.2 u (coins 3.0 u), accelerating to 8 u/s, and
 *    collected within 0.5 u. Lifetime 40 s, blinking for the last 6 s. A full pool recycles the
 *    oldest coin. A pickup that would give nothing — a draught at the carry cap, a heart at full
 *    HP, a mana mote at full MP (`CombatSystem.wantsPickup`) — stays on the ground: it is not
 *    magnetised, a magnetised one that becomes useless mid-flight drops where it is, and walking
 *    over it does not use it up.
 */

/**
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { FxQuadParams } from '../../engine/fx/FxQuads.js'
 * @import { RNG } from '../../engine/index.js'
 */

/**
 * A pooled pickup (`Pickups.items`).
 * @typedef {object} LivePickup
 * @property {boolean} alive
 * @property {string} kind       a PICKUP_KINDS entry
 * @property {number} amount     gold value (coins) / 1
 * @property {string} extra      an upgrade pickup's kind ('maxHp' | 'maxMp' | 'attack')
 * @property {number} x          position (y: the drawn height)
 * @property {number} y
 * @property {number} z
 * @property {number} sx         arc start
 * @property {number} sy
 * @property {number} sz
 * @property {number} tx         landing point (ty: its ground)
 * @property {number} ty
 * @property {number} tz
 * @property {number} t          seconds since the drop
 * @property {number} apex       arc height (u)
 * @property {boolean} magnet    flying to the player
 * @property {boolean} instant   dropped over unstandable ground: magnetised at once (radius × 2)
 * @property {number} speed      magnet speed (u/s)
 * @property {number} h          FxQuads handle (−1: none)
 * @property {number} serial     drop counter (the oldest coin is recycled first)
 */

const CAPACITY = 64;
const POP_TIME = 0.4;
const MAGNET_DELAY = 0.3;
const MAGNET_R = 2.2;
const COIN_MAGNET_R = 3.0;
const MAGNET_SPEED = 8;
const MAGNET_ACCEL = 24;
const COLLECT_R = 0.5;
const LIFETIME = 40;
const BLINK = 6;

/**
 * kind → atlas frame, HDR colour, scale, hover (u above the ground).
 * @type {Record<string, { frame: string, color: number[], scale: number, lift: number }>}
 */
const LOOKS = {
  coin1: { frame: 'coin', color: [1.7, 0.95, 0.55], scale: 1.1, lift: 0.3 },
  coin5: { frame: 'coin', color: [1.9, 1.9, 2.0], scale: 1.2, lift: 0.3 },
  coin25: { frame: 'coin', color: [2.6, 2.0, 0.75], scale: 1.4, lift: 0.3 },
  heart: { frame: 'heart', color: [2.6, 0.7, 0.65], scale: 1.4, lift: 0.4 },
  mana: { frame: 'mana', color: [0.9, 1.7, 3.0], scale: 1.4, lift: 0.4 },
  draught: { frame: 'draught', color: [1.3, 2.4, 1.0], scale: 1.4, lift: 0.4 },
  upgrade: { frame: 'upgrade', color: [2.8, 2.2, 0.9], scale: 1.5, lift: 0.5 },
  core: { frame: 'core', color: [3.2, 1.5, 0.5], scale: 1.6, lift: 0.6 },
};
/** Every pickup kind (the showcase hook drops one of each). */
export const PICKUP_KINDS = Object.freeze(Object.keys(LOOKS));
/** @type {(kind: string) => boolean} */
const isCoin = (kind) => kind.startsWith('coin');

export class Pickups {
  /** @param {CombatSystem} sys the CombatSystem */
  constructor(sys) {
    this.sys = sys;
    /** @type {LivePickup[]} the pool (CAPACITY records, reused) */
    this.items = [];
    for (let i = 0; i < CAPACITY; i++) {
      this.items.push({
        alive: false, kind: 'coin1', amount: 0, extra: '', x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0,
        t: 0, apex: 0.8, magnet: false, instant: false, speed: 0, h: -1, serial: 0,
      });
    }
    this._serial = 0;
    this._count = 0;
    /** @type {FxQuadParams} scratch parameters for FxQuads#set */
    this._p = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1 };
  }

  get count() { return this._count; }

  /**
   * Drop one pickup from (ox, oy, oz).
   * @param {string} kind PICKUP_KINDS
   * @param {number} amount gold value (coins) / 1
   * @param {number} ox @param {number} oy @param {number} oz death point (oy: its ground)
   * @param {RNG} rng the loot RNG (direction and distance)
   * @param {string} [extra] upgrade kind ('maxHp' | 'maxMp' | 'attack')
   * @returns {number} slot or −1
   */
  drop(kind, amount, ox, oy, oz, rng, extra = '') {
    const sys = this.sys;
    const slot = this._slot();
    if (slot < 0) return -1;
    const ang = rng.next() * Math.PI * 2;
    const dist = 0.6 + 0.8 * rng.next();
    const pp = sys.player.position;
    let tx = ox + Math.cos(ang) * dist;
    let tz = oz + Math.sin(ang) * dist;
    const instant = !sys.standable(ox, oz);
    if (!sys.standable(tx, tz)) {
      // step from the death point toward the player until the ground holds
      const dx = pp.x - ox;
      const dz = pp.z - oz;
      const len = Math.hypot(dx, dz);
      let found = false;
      for (let d = 0; d <= len; d += 0.25) {
        const x = ox + (dx / (len || 1)) * d;
        const z = oz + (dz / (len || 1)) * d;
        if (sys.standable(x, z)) { tx = x; tz = z; found = true; break; }
      }
      if (!found) { tx = pp.x; tz = pp.z; }
    }
    const p = this.items[slot];
    p.alive = true;
    p.kind = LOOKS[kind] ? kind : 'coin1';
    p.amount = amount;
    p.extra = extra;
    p.sx = ox;
    p.sy = oy + 0.6;
    p.sz = oz;
    p.tx = tx;
    p.tz = tz;
    p.ty = sys.groundAt(tx, tz);
    p.x = p.sx;
    p.y = p.sy;
    p.z = p.sz;
    p.t = 0;
    p.apex = 0.7 + 0.5 * rng.next();
    p.magnet = false;
    p.instant = instant;
    p.speed = 0;
    p.serial = ++this._serial;
    p.h = sys.quads.alloc();
    this._count++;
    this._write(p);
    return slot;
  }

  /**
   * A free slot; a full pool recycles the oldest coin.
   * @returns {number} a slot, or −1
   */
  _slot() {
    let oldest = -1;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.items[i];
      if (!p.alive) return i;
      if (isCoin(p.kind) && (oldest < 0 || p.serial < this.items[oldest].serial)) oldest = i;
    }
    if (oldest >= 0) this._free(this.items[oldest]);
    return oldest;
  }

  /**
   * Arc, magnet, collection, lifetime.
   * @param {number} dt combat seconds (0 during hit-stop)
   */
  update(dt) {
    if (!this._count) return;
    const sys = this.sys;
    const pp = sys.player.position;
    const alive = sys.pc.alive;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      p.t += dt;
      if (p.t >= LIFETIME) { this._free(p); continue; }
      const L = LOOKS[p.kind];
      if (!p.magnet) {
        const u = Math.min(1, p.t / POP_TIME);
        p.x = p.sx + (p.tx - p.sx) * u;
        p.z = p.sz + (p.tz - p.sz) * u;
        p.y = p.sy + (p.ty + L.lift - p.sy) * u + p.apex * 4 * u * (1 - u);
        const ready = p.instant || p.t >= MAGNET_DELAY;
        if (ready && alive && sys.wantsPickup(p.kind)) {
          const r = (isCoin(p.kind) ? COIN_MAGNET_R : MAGNET_R) * (p.instant ? 2 : 1);
          const dx = pp.x - p.x;
          const dz = pp.z - p.z;
          if (dx * dx + dz * dz < r * r) p.magnet = true;
        }
      } else if (alive && !sys.wantsPickup(p.kind)) {
        // it became useless on the way (a second draught filled the satchel): rest where it is
        this._rest(p);
      } else if (alive) {
        p.speed = Math.min(MAGNET_SPEED, p.speed + MAGNET_ACCEL * dt);
        const dx = pp.x - p.x;
        const dz = pp.z - p.z;
        const dy = pp.y + 0.6 - p.y;
        const d = Math.hypot(dx, dz, dy);
        const s = p.speed * dt;
        if (d <= COLLECT_R || d <= s) {
          this._collect(p);
          continue;
        }
        p.x += (dx / d) * s;
        p.y += (dy / d) * s;
        p.z += (dz / d) * s;
      }
      if (!p.magnet && p.t >= POP_TIME) {
        // resting: collected when walked over even outside the magnet (draught at the cap too)
        const dx = pp.x - p.x;
        const dz = pp.z - p.z;
        if (alive && dx * dx + dz * dz < COLLECT_R * COLLECT_R && sys.wantsPickup(p.kind)) {
          this._collect(p);
          continue;
        }
      }
      this._write(p);
    }
  }

  /** @param {LivePickup} p */
  _collect(p) {
    if (this.sys.collectPickup(p.kind, p.amount, p.extra, p.x, p.y, p.z) === false) this._rest(p);
    else this._free(p);
  }

  /**
   * Stop a magnetised pickup and let it rest on standable ground where it is (else at the player).
   * @param {LivePickup} p
   */
  _rest(p) {
    const sys = this.sys;
    let x = p.x;
    let z = p.z;
    if (!sys.standable(x, z)) {
      x = sys.player.position.x;
      z = sys.player.position.z;
    }
    p.magnet = false;
    p.instant = false;
    p.speed = 0;
    p.sx = p.tx = x;
    p.sz = p.tz = z;
    p.ty = sys.groundAt(x, z);
    p.sy = p.ty + LOOKS[p.kind].lift;
    p.t = Math.max(p.t, POP_TIME);
  }

  /** @param {LivePickup} p */
  _write(p) {
    if (p.h < 0) return;
    const L = LOOKS[p.kind];
    const q = this._p;
    const fr = this.sys.atlasFrames?.[L.frame];
    const resting = !p.magnet && p.t >= POP_TIME;
    q.x = p.x;
    q.y = p.y + (resting ? 0.06 * Math.sin((p.t + p.serial) * 3) : 0);
    q.z = p.z;
    q.frame = L.frame;
    q.index = fr && fr.n > 1 ? Math.floor((p.t + p.serial * 0.13) * (fr.fps || 8)) % fr.n : 0;
    q.scale = L.scale;
    q.rot = 0;
    q.mode = 'billboard';
    q.r = L.color[0];
    q.g = L.color[1];
    q.b = L.color[2];
    // blink for the last 6 s (dithered fade on alternate eighths of a second)
    q.a = p.t > LIFETIME - BLINK && Math.floor(p.t * 8) % 2 === 1 ? 0.35 : 1;
    this.sys.quads.set(p.h, q);
  }

  /** @param {LivePickup} p */
  _free(p) {
    if (!p.alive) return;
    p.alive = false;
    if (p.h >= 0) this.sys.quads.free(p.h);
    p.h = -1;
    this._count--;
  }

  clear() {
    for (let i = 0; i < CAPACITY; i++) this._free(this.items[i]);
  }
}
