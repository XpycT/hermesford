import * as THREE from 'three';
import { lerp } from '../utils/math.js';
import { ownColor } from '../utils/own.js';

/** @import { PointLightHandle, LightingSystem } from './LightingSystem.js' */

/**
 * A light descriptor (see the LightPool notes): a lamp a pool light may draw. The raw ones a
 * level's built objects return (BuiltObject.lights) have this shape too; their numbers are
 * whatever the level holds until `sanitizeLightDescriptor` cleans them.
 * @typedef {object} LightDescriptor
 * @property {THREE.Vector3} position
 * @property {THREE.ColorRepresentation} [color]
 * @property {number} [intensity]
 * @property {number} [distance]
 * @property {number} [flicker]
 * @property {boolean} [nightOnly]
 * @property {number} [dayIntensity]
 * @property {number} [priority]
 * @property {string} [tag]
 * @property {number} [seed]
 * @property {number} [flickerSpeed]
 */
/**
 * A pooled slot.
 * @typedef {object} PoolSlot
 * @property {PointLightHandle} handle  the light
 * @property {LightDescriptor|null} desc  the descriptor it draws now
 * @property {LightDescriptor|null} target  the one it should draw
 * @property {number} fade
 */

/**
 * LightPool — a fixed set of LightingSystem point lights shared by any number of light
 * descriptors (lampposts, torches, campfires, window glows …).
 *
 * The light count never changes after construction (a different NUM_POINT_LIGHTS would recompile
 * every lit shader):
 *
 *  - **static** (descriptors ≤ size): one light per descriptor, created in the given order with
 *    exactly the parameters `LightingSystem.addPointLight` would get for it, permanently assigned.
 *    `update()` only keeps linked emissives in sync. A small level looks exactly as with
 *    hand-created lights.
 *  - **pooled** (descriptors > size): `size` lights. Every `interval` seconds the pool ranks the
 *    descriptors whose light sphere (range + `margin`) touches the camera frustum — nearest to the
 *    focus first, `priority × priorityWeight` added, a small bonus for lights already lit
 *    (hysteresis) and a penalty for lanterns that are dark by day — and hands the lights to the
 *    best ones. A light that changes owner fades out, moves and fades in (`fadeTime` each way), so
 *    nothing pops; a light that stays assigned is untouched.
 *
 * Descriptor: `{ position: Vector3, color?, intensity?, distance?, flicker?, nightOnly? (true),
 * dayIntensity?, priority? (3, lower = more important), tag?, seed?, flickerSpeed? }`. In pooled
 * mode each descriptor keeps its own flicker seed (derived from its position unless given), so a
 * lantern flickers the same whichever light currently draws it.
 *
 * Emissives linked to a descriptor (`registerEmissive(material, { light: desc })`, or
 * `lighting.registerEmissive(m, { flicker: pool.flickerSource(desc) })`) flicker in sync with it
 * whether or not it currently owns a light.
 *
 * Changing descriptor sets (the level editor rebuilds them on every edit): construct with
 * `fixed: true` (always `size` lights, the unused ones parked at intensity 0) and hand every new
 * set to `setDescriptors()`. It never creates or removes a light, and it picks the mode a new pool
 * of that set would have — static for ≤ `size` descriptors, pooled above — so an edit that crosses
 * the boundary changes no shader. A descriptor keeps its light across calls while the same object
 * is passed again (or, for a rebuilt one, another with the same `tag` and position in its tag's
 * list).
 *
 * `sanitizeLightDescriptors()` (below) turns the raw descriptors a level's built objects return
 * into the list the game hands to the pool: sorted by priority, numbers clamped.
 */
export class LightPool {
  /**
   * @param {LightingSystem} lighting
   * @param {LightDescriptor[]} [descriptors] light descriptors (see above), most important first
   *   for the static mode (its lights are created in this order)
   * @param {{ size?: number, interval?: number, fadeTime?: number, margin?: number,
   *           priorityWeight?: number, hysteresis?: number, nightDayIntensity?: number,
   *           dayPenalty?: number, fixed?: boolean }} [opts]
   *   - size (12): number of THREE point lights
   *   - interval (0.2 s): re-ranking period
   *   - fadeTime (0.35 s): fade-out and fade-in time of a light that changes owner
   *   - margin (4): world units added to a light's range for the view test (lights just outside
   *     the view are lit before they come in)
   *   - priorityWeight (1.5): score units (≈ world units of distance) per priority step (small: a
   *     lantern a few units from the player outranks a torch across the square; at 4 lamps 5–7
   *     units away stayed dark while torches 9–10 units away were lit)
   *   - hysteresis (2): score bonus of a descriptor that is already lit
   *   - nightDayIntensity (0.05): `dayIntensity` of nightOnly descriptors without their own (the
   *     demo's weather raises it under an overcast sky). Pooled mode reads it live; a static
   *     pool's lights take it once, when they are created (see the field)
   *   - dayPenalty (10): score penalty × (1 − current brightness factor): a lantern that is dark by
   *     day yields its light to the torches and campfires that burn
   *   - fixed (false): create exactly `size` lights whatever the descriptor count (the spare ones
   *     parked, intensity 0), so `setDescriptors` can switch between static and pooled mode
   *     without changing the light count. Without it a static pool has one light per descriptor
   *     (the game: a small level gets fewer than 12 lights).
   */
  constructor(lighting, descriptors = [], opts = {}) {
    this.lighting = lighting;
    this.descriptors = descriptors.slice();
    this.size = Math.max(0, Math.floor(opts.size ?? 12));
    /** Always `size` lights (see the `fixed` option). */
    this.fixed = !!opts.fixed;
    this.interval = opts.interval ?? 0.2;
    this.fadeTime = opts.fadeTime ?? 0.35;
    this.margin = opts.margin ?? 4;
    this.priorityWeight = opts.priorityWeight ?? 1.5;
    this.hysteresis = opts.hysteresis ?? 2;
    this.dayPenalty = opts.dayPenalty ?? 10;
    /**
     * dayIntensity of nightOnly descriptors that don't define one. Pooled mode: live — applied
     * when a light moves to a descriptor, to every lit light on each update and in the ranking.
     * Static mode (≤ `size` descriptors): read only when the lights are created (`update` returns
     * early), so a later change does not reach them — set their handles' `dayIntensity` instead,
     * as `WeatherLook.applyLampDayGlow` does (KNOWN_ISSUES LIT-11).
     */
    this.nightDayIntensity = opts.nightDayIntensity ?? 0.05;
    /** True when there are more descriptors than lights (dynamic assignment). */
    this.pooled = this.descriptors.length > this.size;

    /** @type {PointLightHandle[]} */
    this.handles = [];
    /** @type {PoolSlot[]} */
    this._slots = [];
    /** @type {Map<LightDescriptor, { flickerFactor: number }>} desc → flicker source of emissives */
    this._sources = new Map();
    this._emissives = [];
    this._timer = 0;
    this._snapNext = true;
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._scored = this.descriptors.map((d) => ({ d, s: 0 }));
    /** @type {Set<LightDescriptor>} */
    this._wanted = new Set();
    /** @type {Map<LightDescriptor, number>} descriptor → seed (pooled mode) */
    this._seeds = new Map();
    /** Each light's creation-order flicker seed (a static light's seed, see setDescriptors). */
    this._baseSeeds = [];
    /**
     * Descriptors switched off by `setHidden` (a lamp the story took away): no light draws them —
     * the descriptor set, and with it every other light's assignment, stays as it is.
     * @type {Set<LightDescriptor>}
     */
    this._hidden = new Set();
    /** Static mode: a light is fading in or out for `setHidden` (update steps it). */
    this._staticFading = false;

    if (this.fixed) {
      for (let k = 0; k < this.size; k++) this.handles.push(this._addParked());
      this._baseSeeds = this.handles.map((h) => h.seed);
      const descs = this.descriptors;
      this.descriptors = [];
      this.pooled = false;
      this.setDescriptors(descs, { snap: true });
      return;
    }
    if (!this.pooled) {
      for (const d of this.descriptors) {
        const h = lighting.addPointLight(this._staticParams(d));
        h.tag = d.tag;
        h.desc = d;
        this.handles.push(h);
      }
      this._baseSeeds = this.handles.map((h) => h.seed);
      return;
    }
    for (const d of this.descriptors) this._seeds.set(d, d.seed ?? seedOf(d.position));
    for (let k = 0; k < this.size; k++) {
      const h = lighting.addPointLight({ position: PARK, intensity: 0, distance: 8, flicker: 0, nightOnly: false });
      h.fade = 0;
      h.tag = '';
      h.desc = null;
      this.handles.push(h);
      this._slots.push({ handle: h, desc: null, target: null, fade: 0 });
    }
    this._baseSeeds = this.handles.map((h) => h.seed);
  }

  /** Number of descriptors currently drawn by a light (fading ones included). */
  get activeCount() {
    if (!this.pooled) return Math.min(this.handles.length, this.descriptors.length);
    let n = 0;
    for (const s of this._slots) if (s.desc) n++;
    return n;
  }

  /** Same as `activeCount` (the name the level editor's former pool used). */
  get used() {
    return this.activeCount;
  }

  /** Descriptors currently drawn by a light. */
  get active() {
    return this.pooled ? this._slots.filter((s) => s.desc).map((s) => s.desc) : this.descriptors.slice(0, this.handles.length);
  }

  /** Re-rank at the next update and jump there without fades (teleports, the first frame). */
  snap() {
    this._snapNext = true;
  }

  /**
   * Switch a descriptor's light off (or on again) without changing the descriptor set — a lamp the
   * story takes away or brings back while the player watches. Static mode: the light that draws it
   * fades (`fadeTime`); pooled mode: the descriptor ranks last, so its light fades to another lamp.
   * No light is created or removed (the point-light count, and every lit program, stays).
   * @param {LightDescriptor} desc
   * @param {boolean} hidden
   * @param {{ instant?: boolean }} [opts] instant: no fade (a level being built)
   */
  setHidden(desc, hidden, { instant = false } = {}) {
    if (!desc || hidden === this._hidden.has(desc)) return;
    if (hidden) this._hidden.add(desc);
    else this._hidden.delete(desc);
    if (this.pooled) {
      this._timer = 0;
      if (instant) this._snapNext = true;
      return;
    }
    const h = this.handles.find((x) => x.desc === desc);
    if (!h) return;
    if (instant) {
      h.fade = hidden ? 0 : 1;
      if (hidden) h.light.intensity = 0;
    } else this._staticFading = true;
  }

  /** Is a descriptor switched off by `setHidden`? @param {LightDescriptor} desc */
  isHidden(desc) {
    return this._hidden.has(desc);
  }

  /**
   * Replace the descriptor set without creating or removing a light (the level editor calls it
   * after every edit). The mode follows the new set: static (descriptor k owns light k, exactly
   * the parameters a new static pool would give it; spare lights parked) while it fits the
   * lights, pooled above (re-ranked at the next update; lights that change owner crossfade as
   * usual; coming from static mode, that ranking gives the formerly static lights no hysteresis
   * bonus, so it is the one a new pool of the set makes). Pass the same descriptor objects again
   * for unchanged lights: a descriptor that is
   * still in the set keeps its light (a rebuilt one — same `tag`, same index among that tag's
   * descriptors — takes over its predecessor's light), and every light re-reads its descriptor
   * (a moved or recoloured lamp follows at once). A pool created without `fixed` switches to
   * pooled mode as soon as the set outgrows the lights it has. A descriptor `setHidden` switched
   * off stays off while it is in the set (static mode: dark at once, or still fading out if it
   * keeps its light without `snap`); one that leaves the set is forgotten (`isHidden` → false).
   * @param {LightDescriptor[]} descriptors light descriptors (see the class notes), most
   *   important first
   * @param {{ snap?: boolean }} [opts] snap: jump to the new ranking without fades (a level load)
   */
  setDescriptors(descriptors, { snap = false } = {}) {
    const next = descriptors.slice();
    const prev = this.descriptors;
    const same = next.length === prev.length && next.every((d, i) => d === prev[i]);
    this.descriptors = next;
    if (!same) this._scored = next.map((d) => ({ d, s: 0 }));
    if (snap) this._snapNext = true;
    // `setHidden` marks only descriptors of the set (a campaign's shared pool would otherwise keep
    // the hidden lamps of every level it visited)
    if (!same && this._hidden.size) {
      const inSet = new Set(next);
      for (const d of this._hidden) if (!inSet.has(d)) this._hidden.delete(d);
    }
    const n = this.handles.length;
    const L = this.lighting;
    if (next.length <= n) {
      // static: light k draws descriptor k, the rest are parked
      this.pooled = false;
      this._slots.length = 0;
      this._seeds.clear();
      for (let k = 0; k < n; k++) {
        const h = this.handles[k];
        const d = next[k];
        if (!d) {
          this._park(h);
          continue;
        }
        // a lamp `setHidden` switched off stays off (one fading out keeps fading)
        const hidden = this._hidden.has(d);
        if (!hidden) h.fade = 1;
        else if (snap || h.desc !== d) h.fade = 0;
        else this._staticFading = true;
        L.retargetPointLight(h, this._params(d, d.seed ?? this._baseSeeds[k]));
        h.tag = d.tag;
        h.desc = d;
      }
      return;
    }
    // pooled
    const inSet = same ? null : new Set(next);
    const successor = same ? null : successorsOf(prev, next, inSet);
    const map = (d) => (!d || same || inSet.has(d) ? d : successor.get(d) ?? null);
    if (!same) {
      const seeds = new Map();
      for (const d of next) seeds.set(d, this._seeds.get(d) ?? d.seed ?? seedOf(d.position));
      this._seeds = seeds;
      for (const [d, src] of [...this._sources]) {
        const s = successor.get(d);
        if (s && !this._sources.has(s)) {
          this._sources.delete(d);
          this._sources.set(s, src);
        }
      }
    }
    if (!this.pooled) {
      // entering pooled mode: every light keeps drawing its static descriptor (if still wanted,
      // the next ranking leaves it there, without a fade), but none is a target yet: static
      // lights were never ranked, so they get no hysteresis bonus and that first ranking is
      // exactly a new pool's (the game's for this set and view)
      this.pooled = true;
      this._slots = this.handles.map((h) => {
        const d = map(h.desc ?? null);
        return { handle: h, desc: d, target: null, fade: d ? 1 : 0 };
      });
      for (const s of this._slots) {
        if (!s.desc) this._park(s.handle);
        s.handle.desc = s.desc;
        s.handle.fade = s.fade;
      }
    } else if (!same) {
      const claimed = new Set();
      for (const s of this._slots) {
        let d = s.desc;
        const d2 = map(d);
        // a descriptor that left the set without a successor stays drawn while it fades out
        if (d2 && d2 !== d && !claimed.has(d2)) d = d2;
        if (d !== s.desc) {
          s.desc = d;
          s.handle.desc = d;
        }
        if (s.desc && inSet.has(s.desc)) claimed.add(s.desc);
      }
      const targeted = new Set();
      for (const s of this._slots) {
        const t = map(s.target);
        s.target = t && !targeted.has(t) ? t : null;
        if (s.target) targeted.add(s.target);
      }
    }
    // every light re-reads its descriptor (moved / recoloured lamps), fade untouched
    for (const s of this._slots) {
      if (!s.desc) continue;
      L.retargetPointLight(s.handle, this._params(s.desc, this._seeds.get(s.desc) ?? s.handle.seed));
      s.handle.tag = s.desc.tag;
    }
    // (a new set: rank it at the next update)
    if (!same) this._timer = 0;
  }

  /**
   * An object whose `flickerFactor` follows the descriptor's flicker every update — pass it as
   * `flicker` to LightingSystem.registerEmissive to keep a lantern's glass in sync.
   * @param {LightDescriptor} desc
   * @returns {{ flickerFactor: number }}
   */
  flickerSource(desc) {
    let src = this._sources.get(desc);
    if (!src) {
      src = { flickerFactor: 1 };
      this._sources.set(desc, src);
    }
    return src;
  }

  /**
   * Register a night-glowing material whose glow flickers with a light descriptor.
   * @param {THREE.Material & {emissiveIntensity:number}} material
   * @param {{ day?: number, night?: number, light?: LightDescriptor | null }} [opts]
   */
  registerEmissive(material, { day = 0, night = 1.6, light = null } = {}) {
    const flicker = light ? this.flickerSource(light) : null;
    const entry = this.lighting.registerEmissive(material, { day, night, flicker });
    this._emissives.push(entry);
    return entry;
  }

  /**
   * Per frame (after the camera moved).
   * @param {number} dt seconds
   * @param {{ focus?: {x:number,y:number,z:number}, camera?: THREE.Camera }} [view]
   *   focus: the point lights are ranked around (the player / camera focus); camera: the view the
   *   lights must touch (none = every light is a candidate)
   */
  update(dt, { focus = null, camera = null } = {}) {
    this._updateSources();
    if (!this.pooled) {
      // (nothing to snap in static mode: a set that later outgrows the lights — setDescriptors —
      // crossfades from the static assignment)
      this._snapNext = false;
      if (this._staticFading) this._fadeStatic(dt);
      return;
    }
    const nd = this.nightDayIntensity;
    for (const s of this._slots) {
      if (s.desc && s.desc.nightOnly !== false && s.desc.dayIntensity === undefined) s.handle.dayIntensity = nd;
    }
    if (this._snapNext) {
      this._snapNext = false;
      this._timer = this.interval;
      this._assign(focus, camera);
      for (const s of this._slots) {
        const moved = s.target !== s.desc;
        if (moved) this._move(s, s.target);
        s.fade = s.desc ? 1 : 0;
        s.handle.fade = s.fade;
        // LightingSystem computed this frame's intensities before the pool ran: a light that just
        // moved would stay dark for one frame (a visible flash after every teleport) — refresh it
        if (moved && s.desc) this.lighting.retargetPointLight(s.handle, {});
      }
      return;
    }
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = this.interval;
      this._assign(focus, camera);
    }
    const step = this.fadeTime > 0 ? dt / this.fadeTime : 1;
    for (const s of this._slots) {
      if (s.target !== s.desc) {
        s.fade = s.desc ? Math.max(0, s.fade - step) : 0;
        if (s.fade === 0) this._move(s, s.target);
      } else if (s.desc) s.fade = Math.min(1, s.fade + step);
      // smoothstep: no visible kink at either end of the fade
      s.handle.fade = s.fade * s.fade * (3 - 2 * s.fade);
    }
  }

  /** Static mode: step the fades of lights `setHidden` switched (they stop at 0 / 1). */
  _fadeStatic(dt) {
    const step = this.fadeTime > 0 ? dt / this.fadeTime : 1;
    let moving = false;
    for (const h of this.handles) {
      if (!h.desc) continue;
      const target = this._hidden.has(h.desc) ? 0 : 1;
      if (h.fade === target) continue;
      h.fade = target > h.fade ? Math.min(1, h.fade + step) : Math.max(0, h.fade - step);
      if (h.fade !== target) moving = true;
    }
    this._staticFading = moving;
  }

  dispose() {
    for (const e of this._emissives) e.dispose();
    this._emissives.length = 0;
    for (const h of this.handles) h.dispose();
    this.handles.length = 0;
    this._slots.length = 0;
    this._sources.clear();
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * addPointLight parameters of a descriptor (static mode: exactly what a hand-wired light gets).
   * @param {LightDescriptor} d
   */
  _staticParams(d) {
    const nightOnly = d.nightOnly ?? true;
    return {
      position: d.position,
      color: d.color,
      intensity: d.intensity,
      distance: d.distance,
      flicker: d.flicker,
      nightOnly,
      // lanterns come on a little earlier in the evening, campfires / torches burn all day
      dayIntensity: d.dayIntensity ?? (nightOnly ? this.nightDayIntensity : 1),
      ...(d.seed !== undefined ? { seed: d.seed } : {}),
      ...(d.flickerSpeed !== undefined ? { flickerSpeed: d.flickerSpeed } : {}),
    };
  }

  /** A parked light (pooled spare): far below the world, intensity 0. */
  _addParked() {
    const h = this.lighting.addPointLight({ position: PARK, intensity: 0, distance: 8, flicker: 0, nightOnly: false });
    h.fade = 0;
    h.tag = '';
    h.desc = null;
    return h;
  }

  /**
   * Park a light (no descriptor): dark from this very frame.
   * @param {PointLightHandle} h
   */
  _park(h) {
    h.desc = null;
    h.tag = '';
    h.fade = 0;
    h.intensity = 0;
    h.light.intensity = 0;
    h.light.position.copy(PARK);
  }

  /**
   * Every retargetPointLight parameter of a descriptor, with addPointLight's defaults for the
   * missing ones (so a light that drew another descriptor keeps none of its values).
   * @param {LightDescriptor} d
   * @param {number} seed
   */
  _params(d, seed) {
    const nightOnly = d.nightOnly ?? true;
    return {
      position: d.position,
      color: d.color ?? 0xffb46b,
      intensity: d.intensity ?? 8,
      distance: d.distance ?? 8,
      flicker: d.flicker ?? 0.3,
      nightOnly,
      dayIntensity: d.dayIntensity ?? (nightOnly ? this.nightDayIntensity : 1),
      seed,
      flickerSpeed: d.flickerSpeed ?? 2.6,
    };
  }

  /**
   * Point a slot's light at `desc` (or park it) — only while its fade is 0.
   * @param {PoolSlot} slot
   * @param {LightDescriptor | null} desc
   */
  _move(slot, desc) {
    slot.desc = desc;
    const h = slot.handle;
    h.desc = desc;
    // dark from this very frame: LightingSystem computed this frame's intensity before the pool
    // ran, from last frame's (non-zero) fade
    h.fade = 0;
    h.light.intensity = 0;
    if (!desc) {
      h.tag = '';
      h.intensity = 0;
      h.light.position.copy(PARK);
      return;
    }
    const nightOnly = desc.nightOnly ?? true;
    this.lighting.retargetPointLight(h, {
      position: desc.position,
      color: desc.color ?? 0xffb46b,
      intensity: desc.intensity ?? 8,
      distance: desc.distance ?? 8,
      flicker: desc.flicker ?? 0.3,
      nightOnly,
      dayIntensity: desc.dayIntensity ?? (nightOnly ? this.nightDayIntensity : 1),
      seed: this._seeds.get(desc),
      flickerSpeed: desc.flickerSpeed ?? 2.6,
    });
    h.tag = desc.tag;
  }

  /**
   * Rank the descriptors and set every slot's target.
   * @param {{x:number,y:number,z:number} | null} focus
   * @param {THREE.Camera | null} camera
   */
  _assign(focus, camera) {
    const wanted = this._wanted;
    wanted.clear();
    let frustum = null;
    if (camera) {
      camera.updateMatrixWorld();
      this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum = this._frustum.setFromProjectionMatrix(this._m, camera.coordinateSystem);
    }
    const held = new Set();
    for (const s of this._slots) if (s.target) held.add(s.target);
    const night = this.lighting.nightFactor;
    const fx = focus?.x ?? 0;
    const fy = focus?.y ?? 0;
    const fz = focus?.z ?? 0;
    const scored = this._scored;
    let n = 0;
    for (let i = 0; i < scored.length; i++) {
      const e = scored[i];
      const d = e.d;
      const p = d.position;
      if (frustum) {
        this._sphere.center.copy(p);
        this._sphere.radius = (d.distance ?? 8) + this.margin;
        if (!frustum.intersectsSphere(this._sphere)) { e.s = Infinity; continue; }
      }
      if (this._hidden.size && this._hidden.has(d)) { e.s = Infinity; continue; }
      const nightOnly = d.nightOnly ?? true;
      const bright = nightOnly ? lerp(d.dayIntensity ?? this.nightDayIntensity, 1, night) : 1;
      e.s = (focus ? Math.hypot(p.x - fx, (p.y - fy) * 0.5, p.z - fz) : 0)
        + (d.priority ?? 3) * this.priorityWeight
        + (1 - Math.min(1, bright)) * this.dayPenalty
        - (held.has(d) ? this.hysteresis : 0);
      n++;
    }
    if (n) {
      scored.sort((a, b) => a.s - b.s);
      for (let i = 0; i < Math.min(this.size, n); i++) wanted.add(scored[i].d);
    }
    // keep the slots whose light is still wanted (or wanted again while it fades out)
    const claimed = new Set();
    for (const s of this._slots) {
      if (s.target && wanted.has(s.target) && !claimed.has(s.target)) claimed.add(s.target);
      else if (s.desc && wanted.has(s.desc) && !claimed.has(s.desc)) { s.target = s.desc; claimed.add(s.desc); }
      else s.target = null;
    }
    // hand the rest to free slots, dark ones first (they can fade in at once)
    const free = this._slots.filter((s) => !s.target).sort((a, b) => a.fade - b.fade);
    let k = 0;
    for (const d of wanted) {
      if (claimed.has(d)) continue;
      const s = free[k++];
      if (!s) break;
      s.target = d;
    }
  }

  _updateSources() {
    if (!this._sources.size) return;
    const L = this.lighting;
    for (const [d, src] of this._sources) {
      const h = this._handleOf(d);
      src.flickerFactor = h ? h.flickerFactor
        : L.flickerAt(this._seeds.get(d) ?? seedOf(d.position), d.flicker ?? 0.3, d.flickerSpeed ?? 2.6);
    }
  }

  /** @param {LightDescriptor} d @returns {PointLightHandle | null} */
  _handleOf(d) {
    if (!this.pooled) {
      const i = this.descriptors.indexOf(d);
      return i >= 0 ? this.handles[i] : null;
    }
    for (const s of this._slots) if (s.desc === d) return s.handle;
    return null;
  }
}

/** Where an unused pooled light waits (far below the world, intensity 0). */
const PARK = new THREE.Vector3(0, -500, 0);

/**
 * One light descriptor as the game hands it to a LightPool: a copy
 * `{ position, color, intensity, distance, flicker, nightOnly, priority, tag }` (`position` shared,
 * not copied) whose present-but-invalid numbers are sanitised — a NaN intensity from a hand-edited
 * `light` object would poison every lit pixel (and the bloom): `intensity` clamped to 0–200
 * (not a number → 8), `distance` 0.5–100 (→ 8), `flicker` 0–1 (→ 0.2). Absent numbers stay
 * absent (the lighting defaults apply); `nightOnly` defaults to true, `priority` to 3. A `color`
 * named "constructor" or "__proto__" (which three.js would turn black, KNOWN_ISSUES LVL-19) is
 * dropped with a warning (`ownColor`): the light takes the default colour (#ffb46b).
 * @param {LightDescriptor} d raw descriptor (BuiltObject.lights)
 * @returns {LightDescriptor}
 */
export function sanitizeLightDescriptor(d) {
  return {
    position: d.position,
    color: ownColor(d.color, THREE.Color.NAMES),
    intensity: num(d.intensity, 8, 0, 200),
    distance: num(d.distance, 8, 0.5, 100),
    flicker: num(d.flicker, 0.2, 0, 1),
    nightOnly: d.nightOnly ?? true,
    priority: d.priority ?? 3,
    tag: d.tag,
  };
}

/**
 * The light descriptors of a level's built objects, as the game hands them to its LightPool
 * (`World._wireLights`; the level editor's 3D preview uses the same list): sorted by `priority`
 * (lower first, default 3; ties keep the given order — the level's object order, which is also
 * the order a static pool creates its lights in) and sanitised (`sanitizeLightDescriptor`).
 * @param {LightDescriptor[]} descs raw descriptors (BuiltObject.lights of every object, in level
 *   order)
 * @param {{ cache?: WeakMap<LightDescriptor, LightDescriptor> }} [opts] cache: raw → sanitised
 *   descriptor, so the same raw descriptor yields the same object on every call
 *   (`LightPool.setDescriptors` keeps a descriptor's light by identity). Raw descriptors must not
 *   change after their first call then (their `position` may: it is shared).
 * @returns {LightDescriptor[]} a new array
 */
export function sanitizeLightDescriptors(descs, { cache = null } = {}) {
  return descs
    .map((d, i) => ({ d, i, p: d.priority ?? 3 }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map(({ d }) => {
      if (!cache) return sanitizeLightDescriptor(d);
      let s = cache.get(d);
      if (!s) {
        s = sanitizeLightDescriptor(d);
        cache.set(d, s);
      }
      return s;
    });
}

/**
 * A present number clamped to [lo, hi] (not a number → d); undefined stays undefined.
 * @param {unknown} v @param {number} d @param {number} lo @param {number} hi
 * @returns {number | undefined}
 */
function num(v, d, lo, hi) {
  return v === undefined ? undefined
    : Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d));
}

/**
 * Successors of the descriptors that left a set: the new descriptor with the same `tag` and the
 * same index among that tag's descriptors (a lamp the editor rebuilt), if it is new too.
 * @param {LightDescriptor[]} prev
 * @param {LightDescriptor[]} next
 * @param {Set<LightDescriptor>} inNext
 * @returns {Map<LightDescriptor, LightDescriptor>}
 */
function successorsOf(prev, next, inNext) {
  const out = new Map();
  const inPrev = new Set(prev);
  const fresh = new Map();
  const count = new Map();
  for (const d of next) {
    if (!d.tag) continue;
    const k = count.get(d.tag) ?? 0;
    count.set(d.tag, k + 1);
    if (!inPrev.has(d)) fresh.set(`${d.tag}#${k}`, d);
  }
  if (!fresh.size) return out;
  count.clear();
  for (const d of prev) {
    if (!d.tag) continue;
    const k = count.get(d.tag) ?? 0;
    count.set(d.tag, k + 1);
    if (inNext.has(d)) continue;
    const s = fresh.get(`${d.tag}#${k}`);
    if (s) out.set(d, s);
  }
  return out;
}

/**
 * Stable flicker seed from a position.
 * @param {{x:number,y:number,z:number} | null | undefined} p
 */
function seedOf(p) {
  if (!p) return 13;
  return ((Math.imul(Math.round(p.x * 64), 73856093) ^ Math.imul(Math.round(p.y * 64), 19349663) ^ Math.imul(Math.round(p.z * 64), 83492791)) >>> 0);
}
