/**
 * Hit shapes (COMBAT.md §9.5): overlap tests of a HitSpec against a target circle, the per-tag
 * "one hit per target" registry, and a small pool of HitSpec records so registering hitboxes
 * every sub-step allocates nothing.
 *
 * HitSpec `{ shape: 'circle'|'sector'|'lane'|'ring', x, y (attacker ground), z, r = 1, rInner = 0,
 *   dirX = 0, dirZ = 1, halfAngle = 60 (deg), len = 1, width = 1, dy = 0.6, mv, kb, poise = 0,
 *   knockdown = false, flat = 0, thin = false, tag, fromX?, fromZ?, chill = 0, slow = 0, freeze = 0,
 *   stun = 0, feel = null }` (the last five: a player-side hit's status effects and feel, §29).
 * Overlap vs a target circle (tx, tz, tr = thin ? 0 : hurt radius): circle d < r + tr; sector
 * d < r + tr and the angle within halfAngle + asin(min(1, tr / d)); lane 0 ≤ t ≤ len and
 * |perp| < width / 2 + tr; ring rInner − tr < d < r + tr; plus |ty − y| ≤ dy with ty the target's
 * ground (fliers: the ground below them).
 *
 * Tags are small integers (KNOWN_ISSUES COMBAT-21: no string per attack): enemy `k` (a slot
 * 1 … TAG_SLOTS − 1) uses `k · TAG_SPAN + 0 … TAG_SPAN − 1` (`Enemy.newTag()`), the player and every
 * projectile draw from `TagRegistry.next()` above that range; 0 = untagged. All stay Smis.
 */

/**
 * @import { Enemy } from './Enemy.js'
 * @import { HitSpec, QueuedHit } from './types.js'
 * @import { MemberCombat } from '../party/MemberCombat.js'
 */

/**
 * A hit's target: an enemy, the player, or a party companion (PARTY.md §5.3).
 * @typedef {Enemy|'player'|MemberCombat} HitTarget
 */

/**
 * A tag's registry entry: the targets it hit and the last sub-step it was registered in.
 * @typedef {{ targets: HitTarget[], step: number }} TagEntry
 */

const DEG = Math.PI / 180;
/** Tags per enemy (its `newTag()` cycles through them). */
export const TAG_SPAN = 4096;
/** Enemy tag slots (slot 0 is unused: tag 0 means "untagged"). */
export const TAG_SLOTS = 65536;
/** `TagRegistry.next()` cycles through [TAG_NEXT_MIN, TAG_NEXT_MAX]. */
const TAG_NEXT_MIN = TAG_SPAN * TAG_SLOTS;
const TAG_NEXT_MAX = TAG_NEXT_MIN * 2 - 1;

/**
 * Does `spec` overlap a target standing at (tx, ty, tz) with hurt radius tr?
 * @param {HitSpec} spec
 * @param {number} tx
 * @param {number} ty target ground height
 * @param {number} tz
 * @param {number} tr hurt radius
 * @returns {boolean}
 */
export function hitOverlaps(spec, tx, ty, tz, tr) {
  const dy = spec.dy ?? 0.6;
  if (Math.abs(ty - (spec.y ?? 0)) > dy + 1e-6) return false;
  const r0 = spec.thin ? 0 : tr;
  const dx = tx - spec.x;
  const dz = tz - spec.z;
  const d = Math.hypot(dx, dz);
  const r = spec.r ?? 1;
  switch (spec.shape) {
    case 'circle':
      return d < r + r0;
    case 'ring':
      return d > (spec.rInner ?? 0) - r0 && d < r + r0;
    case 'sector': {
      if (d >= r + r0) return false;
      if (d < 1e-4) return true;
      let ax = spec.dirX ?? 0;
      let az = spec.dirZ ?? 1;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const cos = (dx * ax + dz * az) / d;
      const ang = Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
      return ang <= (spec.halfAngle ?? 60) * DEG + Math.asin(Math.min(1, r0 / d));
    }
    case 'lane': {
      let ax = spec.dirX ?? 0;
      let az = spec.dirZ ?? 1;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const t = dx * ax + dz * az;
      const perp = Math.abs(dx * az - dz * ax);
      return t >= 0 && t <= (spec.len ?? 1) && perp < (spec.width ?? 1) / 2 + r0;
    }
    default:
      return false;
  }
}

/**
 * Every HitSpec field with its default (the pool resets records to these): the status effects and
 * the feel of a player-side hit (COMBAT.md §29 V5, V6) and its resonance marks (§30.4) are none.
 * @type {Required<HitSpec>}
 */
const DEFAULTS = {
  shape: 'circle', x: 0, y: 0, z: 0, r: 1, rInner: 0, dirX: 0, dirZ: 1, halfAngle: 60, len: 1, width: 1,
  dy: 0.6, mv: 1, kb: 0, poise: 0, knockdown: false, flat: 0, thin: false, tag: 0, fromX: NaN, fromZ: NaN,
  chill: 0, slow: 0, freeze: 0, stun: 0, mark: 0, consume: 0, feel: null,
};
const KEYS = Object.keys(DEFAULTS);

/**
 * Registered hitboxes of one sub-step: `add(owner, spec)` copies the spec into a pooled record
 * (brains may reuse their objects), `clear()` empties the list for the next sub-step.
 */
export class HitQueue {
  /**
   * @param {number} [capacity] initial records (the queue grows past it)
   */
  constructor(capacity = 32) {
    /** @type {QueuedHit[]} live entries (0..length-1) */
    this.items = [];
    this.length = 0;
    for (let i = 0; i < capacity; i++) this.items.push({ owner: null, spec: { ...DEFAULTS } });
  }

  /**
   * @param {Enemy|'player'|MemberCombat} owner the attacker (a companion's hitboxes: its MemberCombat)
   * @param {HitSpec} spec copied (missing optional fields take DEFAULTS)
   * @returns {Required<HitSpec>} the stored spec
   */
  add(owner, spec) {
    if (this.length === this.items.length) this.items.push({ owner: null, spec: { ...DEFAULTS } });
    const it = this.items[this.length++];
    it.owner = owner;
    const s = it.spec;
    for (let k = 0; k < KEYS.length; k++) {
      const key = KEYS[k];
      const v = spec[key];
      s[key] = v === undefined ? DEFAULTS[key] : v;
    }
    return s;
  }

  clear() {
    for (let i = 0; i < this.length; i++) this.items[i].owner = null;
    this.length = 0;
  }
}

/**
 * "One hit per target per tag": a tag's entry lives while a hitbox with that tag is registered in
 * consecutive sub-steps (`touch`) and is dropped by `sweep` after a sub-step without one — so a
 * brain may reuse a tag for its next attack and a multi-frame active window still hits once.
 * Entries are pooled; tags are numbers (see the top of this file).
 */
export class TagRegistry {
  constructor() {
    /** @type {Map<number, TagEntry>} */
    this._map = new Map();
    this._seq = TAG_NEXT_MIN;
    /** @type {TagEntry[]} pooled entries */
    this._free = [];
    /** @type {number[]} tags `sweep` drops */
    this._dead = [];
    this._step = 0;
    // (Map#forEach with one bound callback: `for…of` over the entries made an entry array per tag)
    /** @type {(e: TagEntry, tag: number) => void} */
    this._collect = (e, tag) => { if (e.step < this._step) this._dead.push(tag); };
  }

  /**
   * A fresh tag for a player attack or a projectile (cycles far above every enemy's tags).
   * @returns {number}
   */
  next() {
    this._seq = this._seq >= TAG_NEXT_MAX ? TAG_NEXT_MIN + 1 : this._seq + 1;
    return this._seq;
  }

  /**
   * Mark `tag` as registered in sub-step `step`.
   * @param {number} tag
   * @param {number} step
   */
  touch(tag, step) {
    let e = this._map.get(tag);
    if (!e) {
      e = this._free.pop() ?? { targets: [], step: 0 };
      e.targets.length = 0;
      this._map.set(tag, e);
    }
    e.step = step;
  }

  /**
   * Keep an existing tag alive through sub-step `step` (a projectile still in flight).
   * @param {number} tag
   * @param {number} step
   */
  keep(tag, step) {
    const e = this._map.get(tag);
    if (e) e.step = step;
  }

  /**
   * Has `target` already been hit by `tag`?
   * @param {number} tag
   * @param {HitTarget} target
   * @returns {boolean}
   */
  has(tag, target) {
    const e = this._map.get(tag);
    return !!e && e.targets.includes(target);
  }

  /** @param {number} tag @param {HitTarget} target @param {number} step */
  add(tag, target, step) {
    this.touch(tag, step);
    this._map.get(tag).targets.push(target);
  }

  /**
   * Drop every tag not touched in sub-step `step`.
   * @param {number} step
   */
  sweep(step) {
    const dead = this._dead;
    dead.length = 0;
    this._step = step;
    this._map.forEach(this._collect);
    for (let i = 0; i < dead.length; i++) {
      const e = this._map.get(dead[i]);
      e.targets.length = 0;
      this._free.push(e);
      this._map.delete(dead[i]);
    }
  }

  /** Drop every tag and restart `next()` (a reset: identical runs draw identical tags). */
  clear() {
    for (const e of this._map.values()) {
      e.targets.length = 0;
      this._free.push(e);
    }
    this._map.clear();
    this._seq = TAG_NEXT_MIN;
  }
}
