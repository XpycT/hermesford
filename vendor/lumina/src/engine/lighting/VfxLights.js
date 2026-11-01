import * as THREE from 'three';

/** @import { PointLightHandle, LightingSystem } from './LightingSystem.js' */

/**
 * A combat effect's light (`VfxLights.acquire`, World.acquireSpellLight).
 * @typedef {object} SpellLight
 * @property {(x: number, y: number, z: number, o?: { color?: number[] | string | number, intensity?: number,
 *   distance?: number, decay?: number, flicker?: number }) => void} set  move / colour it at once
 * @property {() => void} off  intensity 0, still held
 * @property {() => void} release  give it back (later calls do nothing)
 * @property {boolean} held  still this effect's light (false after its release, a minor one taken
 *   over by a spell, `releaseAll`, `dispose`)
 */

/** How many combat VFX lights every game has, on every level (CLAUDE.md invariants). */
export const VFX_LIGHT_COUNT = 4;

/**
 * VfxLights — a small fixed set of point lights for combat effects (the ice mage's spells,
 * src/game/party/IceSpellFx.js), **beside** the level's lamps (LightPool, at most 12): the lamps
 * never lend a light to an effect and an effect never darkens a lamp.
 *
 * The game makes them once, in its persistent half (Game.init, before the first level is built,
 * the first frame and the warm-up compile), on every page and every level — peaceful or combat,
 * a single level or a campaign, rooms too —, and never adds or removes one afterwards (a different
 * NUM_POINT_LIGHTS recompiles every lit program): the point-light count is the level's lamps +
 * `VFX_LIGHT_COUNT` from the first frame on, and no level file has to be read to decide it. A
 * free one is parked far below the world at intensity 0 (never `visible = false`). No shadows.
 *
 * The lamps look exactly as without them: these lights take no creation index (`addPointLight`
 * `indexed: false` — the lamps' flicker seeds stay those of their own creation order) and sit in a
 * group of their own after the lamps' (`lighting.group`), so the lamps keep their places in the
 * lights' uniform arrays; parked, they add exact zeros.
 */
export class VfxLights {
  /**
   * @param {LightingSystem} lighting
   * @param {{ count?: number }} [opts] count: lights to make (VFX_LIGHT_COUNT)
   */
  constructor(lighting, { count = VFX_LIGHT_COUNT } = {}) {
    this.lighting = lighting;
    /** The lights' own group, after the lamps' (`lighting.pointLightGroup`) in the scene. */
    this.group = new THREE.Group();
    this.group.name = 'VfxLights';
    lighting.group.add(this.group);
    /** @type {{ handle: PointLightHandle, loan: { minor: boolean } | null }[]} */
    this._slots = [];
    for (let k = 0; k < count; k++) {
      const handle = lighting.addPointLight({
        position: PARK, intensity: 0, distance: 8, decay: 1, flicker: 0, nightOnly: false, seed: 0x1ce5 + k * 7919, flickerSpeed: 9,
        indexed: false,
      });
      this.group.add(handle.light);
      handle.fade = 0;
      handle.tag = 'vfx';
      handle.desc = null;
      this._slots.push({ handle, loan: null });
    }
  }

  /** The lights (their count never changes). */
  get count() {
    return this._slots.length;
  }

  /** The lights' handles (tests, the debug stats). */
  get handles() {
    return this._slots.map((s) => s.handle);
  }

  /** Lights held now. */
  get held() {
    let n = 0;
    for (const s of this._slots) if (s.loan) n++;
    return n;
  }

  /** Lights lit now (held, intensity above 0). */
  get lit() {
    let n = 0;
    for (const s of this._slots) if (s.loan && s.handle.light.intensity > 0) n++;
    return n;
  }

  /**
   * One of the lights for an effect, or null when none is free. A `minor` request (a lance's
   * 0.16 s spark) takes a free light only; a request that finds none free takes the light of a
   * minor one (that handle's calls do nothing from then on), so a spell's field always gets its
   * light while fewer fields than lights are up.
   *
   * `set(x, y, z, o)` moves and colours it at once (no fade: a flash is lit this very frame);
   * `o`: `color` linear HDR [r, g, b] or a three.js colour ('#rrggbb' / 0xrrggbb, sRGB; default
   * [0.2, 0.45, 1.7], an icy blue), `intensity` (default 20), `distance` (range, default 9),
   * `decay` (default 1: a gentler falloff than the lamps' 2, so the light fills a ring of foes
   * without a hot spot under it), `flicker` 0..1 (default 0; fast, speed 9). It shines by day and
   * night alike (`pointLightMul` scales it with the lamps). `off()` darkens it (still held),
   * `release()` parks it and frees it; `held` says it is still the caller's. After a release, a
   * minor one's light taken over, `releaseAll` or `dispose`, its calls do nothing and `held` is false.
   * @param {{ minor?: boolean }} [opts]
   * @returns {SpellLight | null}
   */
  acquire({ minor = false } = {}) {
    let slot = this._slots.find((s) => !s.loan);
    if (!slot && !minor) {
      slot = this._slots.find((s) => s.loan.minor);
      if (slot) this._park(slot);
    }
    if (!slot) return null;
    const loan = { minor };
    slot.loan = loan;
    const h = slot.handle;
    const L = this.lighting;
    const live = () => slot.loan === loan;
    return {
      set(x, y, z, { color = [0.2, 0.45, 1.7], intensity = 20, distance = 9, decay = 1, flicker = 0 } = {}) {
        if (!live()) return;
        h.fade = 1;
        L.retargetPointLight(h, {
          position: { x, y, z }, color: Array.isArray(color) ? _color.setRGB(color[0], color[1], color[2]) : color,
          intensity, distance, decay, flicker,
        });
      },
      off() {
        if (!live()) return;
        h.intensity = 0;
        h.light.intensity = 0;
      },
      release: () => {
        if (live()) this._park(slot);
      },
      get held() {
        return live();
      },
    };
  }

  /** Every light parked and free (a travel, the combat gone): handles given out do nothing. */
  releaseAll() {
    for (const s of this._slots) if (s.loan) this._park(s);
  }

  dispose() {
    this.releaseAll();
    for (const s of this._slots) s.handle.dispose();
    this._slots.length = 0;
    this.group.removeFromParent();
  }

  /** @param {{ handle: PointLightHandle, loan: { minor: boolean } | null }} slot */
  _park(slot) {
    slot.loan = null;
    const h = slot.handle;
    h.fade = 0;
    h.intensity = 0;
    h.light.intensity = 0;
    h.light.position.copy(PARK);
  }
}

/** Where a free light waits (far below the world, intensity 0). */
const PARK = new THREE.Vector3(0, -500, 0);
/** `set`'s scratch colour (a linear [r, g, b]). */
const _color = new THREE.Color();
